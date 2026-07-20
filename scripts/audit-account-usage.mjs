#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";

const SESSION_DIRS = ["sessions", "sessions-archive", "archived_sessions"];

const parseArgs = (argv) => {
  const options = {
    accountsDir: join(process.env.APPDATA ?? "", "codex-switch-terminal-server"),
    dataDirs: [],
    target: "",
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--accounts-dir") options.accountsDir = argv[++index] ?? "";
    else if (argument === "--data-dir") options.dataDirs.push(argv[++index] ?? "");
    else if (argument === "--target") options.target = argv[++index] ?? "";
    else if (argument === "--json") options.json = true;
    else if (argument === "--help") {
      process.stdout.write(
        [
          "Usage: node scripts/audit-account-usage.mjs [options]",
          "",
          "  --accounts-dir PATH  Repertoire qui contient settings.json",
          "  --data-dir PATH      CST_DATA_DIR a auditer (option repetable)",
          "  --target LABEL       Compte dont afficher le detail",
          "  --json               Sortie JSON exploitable par un test",
          "",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`Argument inconnu: ${argument}`);
    }
  }

  if (!options.accountsDir) throw new Error("--accounts-dir est vide");
  return options;
};

const pathKey = (value) => {
  const normalized = normalize(resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const shortHash = (value) =>
  createHash("sha256").update(String(value)).digest("hex").slice(0, 12);

const integer = (value) => {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.trunc(number);
};

const resolveHome = (configuredHome, dataDir) => {
  const expanded = String(configuredHome ?? "")
    .replaceAll("%CST_DATA_DIR%", dataDir)
    .replaceAll("${CST_DATA_DIR}", dataDir)
    .replaceAll("$CST_DATA_DIR", dataDir)
    .replace(/%([^%]+)%/g, (match, name) => process.env[name] ?? match);
  return normalize(isAbsolute(expanded) ? expanded : resolve(dataDir, expanded));
};

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

const directAccountIdentity = async (home) => {
  try {
    const auth = JSON.parse(await readFile(join(home, "auth.json"), "utf8"));
    for (const candidate of [
      auth?.tokens?.account_id,
      auth?.account_id,
      auth?.chatgpt_account_id,
    ]) {
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
  } catch {
    // L'absence ou l'invalidite est remontee dans le rapport, sans lire les secrets.
  }
  return null;
};

const discoverDataDirs = async (accountsDir) => {
  const parent = dirname(accountsDir);
  const prefix = basename(accountsDir).toLowerCase();
  const directories = [];
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    const name = entry.name.toLowerCase();
    if (entry.isDirectory() && (name === prefix || name.startsWith(`${prefix}-`))) {
      directories.push(join(parent, entry.name));
    }
  }
  return directories.sort((left, right) => left.localeCompare(right));
};

const collectRollouts = async (root) => {
  const files = [];
  const visit = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      ) {
        files.push(path);
      }
    }
  };
  await visit(root);
  return files;
};

const snapshotTotals = (usage) => {
  const input = integer(usage?.input_tokens);
  const cached = integer(usage?.cached_input_tokens);
  const output = integer(usage?.output_tokens);
  const reasoning = integer(usage?.reasoning_output_tokens);
  const rawTotal = integer(usage?.total_tokens);
  const derivedTotal = input + output;
  return {
    input,
    cached,
    output,
    reasoning,
    rawTotal,
    total: derivedTotal > 0 ? derivedTotal : rawTotal,
  };
};

const sameFileSnapshot = (left, right) =>
  left.size === right.size && left.mtimeMs === right.mtimeMs;

const scanRolloutOnce = async (path) => {
  const before = await stat(path);
  const decoder = new StringDecoder("utf8");
  const digest = createHash("sha256");
  const stream = createReadStream(path);
  let pending = "";
  let sessionId = null;
  let logicalSessionId = null;
  let tokenEvents = 0;
  let malformedRelevantLines = 0;
  let inconsistentRawTotals = 0;
  let downwardTransitions = 0;
  let unsafeIntegers = 0;
  let previousTotal = 0;
  let highTotal = 0;
  let highInput = 0;
  let highCached = 0;
  let highOutput = 0;
  let highReasoning = 0;
  let highWaterDeltaSum = 0;
  let oldResetTotal = 0;
  let lastUsageTokens = 0;
  let lastUsageTokensOnAdvancingEvents = 0;
  let lastUsageTokensOnNonAdvancingEvents = 0;
  let eventsWithoutLastUsage = 0;
  let nonAdvancingTokenEvents = 0;
  const cumulativeSnapshots = new Set();
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  let bestSnapshot = null;

  const processLine = (line) => {
    const relevantSession = sessionId === null && line.includes('"type":"session_meta"');
    const relevantTokens = line.includes('"type":"token_count"');
    if (!relevantSession && !relevantTokens) return;

    let value;
    try {
      value = JSON.parse(line);
    } catch {
      malformedRelevantLines += 1;
      return;
    }

    if (relevantSession && value?.type === "session_meta") {
      const candidate = value?.payload?.id;
      if (typeof candidate === "string" && candidate.trim()) sessionId = candidate.trim();
      const logicalCandidate = value?.payload?.session_id;
      if (typeof logicalCandidate === "string" && logicalCandidate.trim()) {
        logicalSessionId = logicalCandidate.trim();
      }
    }

    if (value?.payload?.type !== "token_count" || !value?.payload?.info?.total_token_usage) {
      return;
    }

    const totals = snapshotTotals(value.payload.info.total_token_usage);
    const lastUsageValue = value.payload.info.last_token_usage;
    const lastUsageTotal = lastUsageValue ? snapshotTotals(lastUsageValue).total : 0;
    const advancesHighWater = totals.total > highTotal;
    if (lastUsageValue) {
      lastUsageTokens += lastUsageTotal;
      if (advancesHighWater) lastUsageTokensOnAdvancingEvents += lastUsageTotal;
      else lastUsageTokensOnNonAdvancingEvents += lastUsageTotal;
    } else {
      eventsWithoutLastUsage += 1;
    }
    if (!advancesHighWater) nonAdvancingTokenEvents += 1;
    cumulativeSnapshots.add(
      `${totals.input}:${totals.cached}:${totals.output}:${totals.reasoning}:${totals.total}`,
    );
    for (const number of Object.values(totals)) {
      if (!Number.isSafeInteger(number)) unsafeIntegers += 1;
    }
    tokenEvents += 1;
    if (totals.rawTotal > 0 && totals.input + totals.output > 0 && totals.rawTotal !== totals.total) {
      inconsistentRawTotals += 1;
    }
    if (totals.total < previousTotal) downwardTransitions += 1;
    oldResetTotal += totals.total >= previousTotal ? totals.total - previousTotal : totals.total;
    previousTotal = totals.total;

    const nextHigh = Math.max(highTotal, totals.total);
    highWaterDeltaSum += nextHigh - highTotal;
    highTotal = nextHigh;
    highInput = Math.max(highInput, totals.input);
    highCached = Math.max(highCached, totals.cached);
    highOutput = Math.max(highOutput, totals.output);
    highReasoning = Math.max(highReasoning, totals.reasoning);

    const parsedTimestamp = Date.parse(value?.timestamp ?? "");
    const timestamp = Number.isFinite(parsedTimestamp) ? parsedTimestamp : Number.NEGATIVE_INFINITY;
    if (timestamp > latestTimestamp) latestTimestamp = timestamp;
    if (
      bestSnapshot === null ||
      totals.total > bestSnapshot.total ||
      (totals.total === bestSnapshot.total && timestamp > bestSnapshot.timestamp)
    ) {
      bestSnapshot = { ...totals, timestamp };
    }
  };

  for await (const chunk of stream) {
    digest.update(chunk);
    pending += decoder.write(chunk);
    let newline;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      processLine(line);
    }
  }
  pending += decoder.end();
  if (pending) processLine(pending.replace(/\r$/, ""));

  const after = await stat(path);
  return {
    path,
    name: basename(path),
    contentHash: digest.digest("hex"),
    stable: sameFileSnapshot(before, after),
    size: after.size,
    sessionId,
    logicalSessionId,
    tokenEvents,
    malformedRelevantLines,
    inconsistentRawTotals,
    downwardTransitions,
    unsafeIntegers,
    latestTimestamp,
    highWaterDeltaSum,
    oldResetTotal,
    lastUsageTokens,
    lastUsageTokensOnAdvancingEvents,
    lastUsageTokensOnNonAdvancingEvents,
    eventsWithoutLastUsage,
    nonAdvancingTokenEvents,
    repeatedCumulativeSnapshots: tokenEvents - cumulativeSnapshots.size,
    totals: {
      input: highInput,
      cached: highCached,
      output: highOutput,
      reasoning: highReasoning,
      total: highTotal,
    },
    coherent: bestSnapshot ?? {
      input: 0,
      cached: 0,
      output: 0,
      reasoning: 0,
      rawTotal: 0,
      total: 0,
      timestamp: Number.NEGATIVE_INFINITY,
    },
  };
};

const scanRollout = async (path) => {
  let result;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await scanRolloutOnce(path);
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    if (result.stable) return result;
  }
  return result;
};

const sum = (values) => values.reduce((total, value) => total + value, 0);

const groupBy = (values, keyFor) => {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
};

const chooseMostAdvanced = (files) =>
  files.reduce((selected, candidate) => {
    if (!selected || candidate.coherent.total > selected.coherent.total) return candidate;
    if (
      candidate.coherent.total === selected.coherent.total &&
      candidate.latestTimestamp > selected.latestTimestamp
    ) {
      return candidate;
    }
    return selected;
  }, null);

const auditIdentity = (identity, files, profiles) => {
  const countedFiles = files.filter((file) => file.tokenEvents > 0);
  const bySession = groupBy(countedFiles, (file) =>
    file.sessionId ? `session:${file.sessionId}` : `missing:${file.contentHash}`,
  );
  const selected = [...bySession.values()].map(chooseMostAdvanced);
  const byName = groupBy(files, (file) => file.name.toLowerCase());
  const byHash = groupBy(files, (file) => file.contentHash);
  const duplicateSessionGroups = [...bySession.values()].filter((group) => group.length > 1);
  const duplicateNameGroups = [...byName.values()].filter((group) => group.length > 1);
  const duplicateHashGroups = [...byHash.values()].filter((group) => group.length > 1);
  const nameCollisionsWithDifferentSessions = duplicateNameGroups.filter(
    (group) => new Set(group.map((file) => file.sessionId ?? `missing:${file.contentHash}`)).size > 1,
  );
  const nameCollisionsWithDifferentContent = duplicateNameGroups.filter(
    (group) => new Set(group.map((file) => file.contentHash)).size > 1,
  );

  return {
    identityHash: shortHash(identity),
    primaryProfileId: profiles[0]?.id ?? null,
    profileCount: profiles.length,
    physicalFiles: files.length,
    tokenFiles: countedFiles.length,
    uniqueSessions: selected.length,
    missingSessionIds: countedFiles.filter((file) => !file.sessionId).length,
    logicalSessionGroups: groupBy(
      countedFiles.filter((file) => file.logicalSessionId),
      (file) => file.logicalSessionId,
    ).size,
    rolloutIdsDifferentFromLogicalIds: countedFiles.filter(
      (file) => file.logicalSessionId && file.logicalSessionId !== file.sessionId,
    ).length,
    duplicateSessionGroups: duplicateSessionGroups.length,
    duplicateFilenameGroups: duplicateNameGroups.length,
    duplicateContentGroups: duplicateHashGroups.length,
    filenameCollisionsDifferentSessions: nameCollisionsWithDifferentSessions.length,
    filenameCollisionsDifferentContent: nameCollisionsWithDifferentContent.length,
    unstableFiles: files.filter((file) => !file.stable).length,
    malformedRelevantLines: sum(files.map((file) => file.malformedRelevantLines)),
    unsafeIntegers: sum(files.map((file) => file.unsafeIntegers)),
    inconsistentRawTotalEvents: sum(files.map((file) => file.inconsistentRawTotals)),
    downwardTransitions: sum(files.map((file) => file.downwardTransitions)),
    componentHighWaterMismatches: countedFiles.filter(
      (file) => file.totals.input + file.totals.output !== file.totals.total,
    ).length,
    highWaterInvariantFailures: countedFiles.filter(
      (file) => file.highWaterDeltaSum !== file.totals.total,
    ).length,
    physicalNaiveTokens: sum(countedFiles.map((file) => file.coherent.total)),
    deduplicatedTokens: sum(selected.map((file) => file.coherent.total)),
    inputTokens: sum(selected.map((file) => file.coherent.input)),
    cachedInputTokens: sum(selected.map((file) => file.coherent.cached)),
    outputTokens: sum(selected.map((file) => file.coherent.output)),
    reasoningOutputTokens: sum(selected.map((file) => file.coherent.reasoning)),
    oldResetAlgorithmTokens: sum(selected.map((file) => file.oldResetTotal)),
    lastUsageTokens: sum(selected.map((file) => file.lastUsageTokens)),
    eventsWithoutLastUsage: sum(selected.map((file) => file.eventsWithoutLastUsage)),
    nonAdvancingTokenEvents: sum(selected.map((file) => file.nonAdvancingTokenEvents)),
    repeatedCumulativeSnapshots: sum(selected.map((file) => file.repeatedCumulativeSnapshots)),
    lastUsageTokensOnAdvancingEvents: sum(
      selected.map((file) => file.lastUsageTokensOnAdvancingEvents),
    ),
    lastUsageTokensOnNonAdvancingEvents: sum(
      selected.map((file) => file.lastUsageTokensOnNonAdvancingEvents),
    ),
    lastUsageMatchesHighWaterFiles: selected.filter(
      (file) => file.lastUsageTokens === file.coherent.total,
    ).length,
    lastUsageAboveHighWaterFiles: selected.filter(
      (file) => file.lastUsageTokens > file.coherent.total,
    ).length,
    lastUsageBelowHighWaterFiles: selected.filter(
      (file) => file.lastUsageTokens < file.coherent.total,
    ).length,
    lastUsageExcessTokens: sum(
      selected.map((file) => Math.max(0, file.lastUsageTokens - file.coherent.total)),
    ),
    highWaterExcessTokens: sum(
      selected.map((file) => Math.max(0, file.coherent.total - file.lastUsageTokens)),
    ),
    largestLastUsageExcessSessions: selected
      .map((file) => ({
        sessionHash: shortHash(file.sessionId ?? file.contentHash),
        tokenEvents: file.tokenEvents,
        downwardTransitions: file.downwardTransitions,
        highWaterTokens: file.coherent.total,
        lastUsageTokens: file.lastUsageTokens,
        excessTokens: Math.max(0, file.lastUsageTokens - file.coherent.total),
      }))
      .filter((item) => item.excessTokens > 0)
      .sort((left, right) => right.excessTokens - left.excessTokens)
      .slice(0, 10),
    selected,
  };
};

const publicIdentityAudit = ({ selected, ...audit }) => audit;

const formatNumber = (value) => new Intl.NumberFormat("fr-FR").format(value);

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const accountsDir = resolve(options.accountsDir);
  const settings = JSON.parse(await readFile(join(accountsDir, "settings.json"), "utf8"));
  const accounts = (settings.accounts ?? []).filter(
    (account) => !account.provider || account.provider === "codex",
  );
  const dataDirs = (options.dataDirs.length
    ? options.dataDirs.map((value) => resolve(value))
    : await discoverDataDirs(accountsDir)
  ).filter((value, index, values) => values.findIndex((item) => pathKey(item) === pathKey(value)) === index);

  const homes = new Map();
  const profileIdentities = new Map();
  for (const account of accounts) {
    for (const dataDir of dataDirs) {
      const home = resolveHome(account.codexHome, dataDir);
      if (!(await exists(home))) continue;
      const identity = await directAccountIdentity(home);
      const key = pathKey(home);
      if (!homes.has(key)) homes.set(key, { path: home, identity, files: [] });
      const identities = profileIdentities.get(account.id) ?? new Set();
      identities.add(identity ?? `missing:${key}`);
      profileIdentities.set(account.id, identities);
    }
  }

  const enumerateSnapshot = async () => {
    const filesByHome = new Map();
    for (const [homeKey, home] of homes) {
      const unique = new Map();
      for (const directory of SESSION_DIRS) {
        for (const file of await collectRollouts(join(home.path, directory))) {
          unique.set(pathKey(file), file);
        }
      }
      filesByHome.set(
        homeKey,
        [...unique.values()].sort((left, right) => left.localeCompare(right)),
      );
    }
    const paths = [...new Set([...filesByHome.values()].flat())].sort((left, right) =>
      left.localeCompare(right),
    );
    return { filesByHome, paths };
  };

  const samePathSet = (left, right) =>
    left.length === right.length && left.every((path, index) => pathKey(path) === pathKey(right[index]));

  let snapshot;
  let scans;
  let snapshotStable = false;
  let snapshotAttempts = 0;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    snapshotAttempts = attempt;
    snapshot = await enumerateSnapshot();
    scans = new Map();
    for (const path of snapshot.paths) {
      const result = await scanRollout(path);
      if (result) scans.set(pathKey(path), result);
    }
    const after = await enumerateSnapshot();
    snapshotStable =
      samePathSet(snapshot.paths, after.paths) &&
      scans.size === snapshot.paths.length &&
      [...scans.values()].every((file) => file.stable);
    if (snapshotStable) break;
  }

  const allPaths = snapshot.paths.filter((path) => scans.has(pathKey(path)));
  for (const [homeKey, home] of homes) {
    home.files = (snapshot.filesByHome.get(homeKey) ?? []).filter((path) => scans.has(pathKey(path)));
  }

  const identityFiles = new Map();
  for (const [homeKey, home] of homes) {
    const identity = home.identity ?? `missing-home:${homeKey}`;
    const files = identityFiles.get(identity) ?? new Map();
    for (const path of home.files) files.set(pathKey(path), scans.get(pathKey(path)));
    identityFiles.set(identity, files);
  }

  const profilesByIdentity = new Map();
  for (const account of accounts) {
    for (const identity of profileIdentities.get(account.id) ?? []) {
      const profiles = profilesByIdentity.get(identity) ?? [];
      if (!profiles.some((profile) => profile.id === account.id)) profiles.push(account);
      profilesByIdentity.set(identity, profiles);
    }
  }

  const audits = [...identityFiles.entries()].map(([identity, files]) =>
    auditIdentity(identity, [...files.values()], profilesByIdentity.get(identity) ?? []),
  );
  const selectedAcrossIdentities = audits.flatMap((audit) =>
    audit.selected.map((file) => ({ identityHash: audit.identityHash, file })),
  );
  const crossSessionGroups = [...groupBy(
    selectedAcrossIdentities.filter(({ file }) => file.sessionId),
    ({ file }) => file.sessionId,
  ).values()].filter((group) => new Set(group.map(({ identityHash }) => identityHash)).size > 1);
  const crossContentGroups = [...groupBy(
    selectedAcrossIdentities,
    ({ file }) => file.contentHash,
  ).values()].filter((group) => new Set(group.map(({ identityHash }) => identityHash)).size > 1);

  const inconsistentProfiles = [...profileIdentities.values()].filter((items) => items.size > 1).length;
  const targetAccount = options.target
    ? accounts.find((account) => account.label === options.target)
    : null;
  const targetIdentities = targetAccount ? [...(profileIdentities.get(targetAccount.id) ?? [])] : [];
  const targetAudits = audits.filter((audit) =>
    targetIdentities.some((identity) => audit.identityHash === shortHash(identity)),
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    accountsDir,
    dataDirs,
    profiles: accounts.length,
    physicalHomes: homes.size,
    realIdentities: audits.length,
    physicalRolloutFiles: allPaths.length,
    physicalBytes: sum([...scans.values()].map((file) => file.size)),
    snapshotStable,
    snapshotAttempts,
    tokenFiles: sum(audits.map((audit) => audit.tokenFiles)),
    uniqueSessions: sum(audits.map((audit) => audit.uniqueSessions)),
    duplicateSessionGroups: sum(audits.map((audit) => audit.duplicateSessionGroups)),
    duplicateFilenameGroups: sum(audits.map((audit) => audit.duplicateFilenameGroups)),
    duplicateContentGroups: sum(audits.map((audit) => audit.duplicateContentGroups)),
    filenameCollisionsDifferentSessions: sum(
      audits.map((audit) => audit.filenameCollisionsDifferentSessions),
    ),
    filenameCollisionsDifferentContent: sum(
      audits.map((audit) => audit.filenameCollisionsDifferentContent),
    ),
    crossIdentitySessionGroups: crossSessionGroups.length,
    crossIdentityContentGroups: crossContentGroups.length,
    profilesWithDifferentRuntimeIdentities: inconsistentProfiles,
    unstableFiles: sum(audits.map((audit) => audit.unstableFiles)),
    malformedRelevantLines: sum(audits.map((audit) => audit.malformedRelevantLines)),
    unsafeIntegers: sum(audits.map((audit) => audit.unsafeIntegers)),
    highWaterInvariantFailures: sum(audits.map((audit) => audit.highWaterInvariantFailures)),
    componentHighWaterMismatches: sum(audits.map((audit) => audit.componentHighWaterMismatches)),
    inconsistentRawTotalEvents: sum(audits.map((audit) => audit.inconsistentRawTotalEvents)),
    downwardTransitions: sum(audits.map((audit) => audit.downwardTransitions)),
    deduplicatedTokens: sum(audits.map((audit) => audit.deduplicatedTokens)),
    inputTokens: sum(audits.map((audit) => audit.inputTokens)),
    outputTokens: sum(audits.map((audit) => audit.outputTokens)),
    targetFound: targetAccount !== null,
    targetIdentityCount: targetIdentities.length,
  };

  const report = {
    summary,
    identities: audits.map(publicIdentityAudit),
    target: targetAudits.length === 1 ? publicIdentityAudit(targetAudits[0]) : null,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      "Audit independant des stats locales",
      `- Profils / identites reelles : ${summary.profiles} / ${summary.realIdentities}`,
      `- Homes physiques / rollouts : ${summary.physicalHomes} / ${summary.physicalRolloutFiles}`,
      `- Sessions avec tokens / uniques : ${summary.tokenFiles} / ${summary.uniqueSessions}`,
      `- Doublons de session dedupliques : ${summary.duplicateSessionGroups}`,
      `- Collisions de nom avec sessions differentes : ${summary.filenameCollisionsDifferentSessions}`,
      `- Sessions presentes sous plusieurs comptes reels : ${summary.crossIdentitySessionGroups}`,
      `- Contenus identiques sous plusieurs comptes reels : ${summary.crossIdentityContentGroups}`,
      `- Fichiers instables / lignes invalides : ${summary.unstableFiles} / ${summary.malformedRelevantLines}`,
      `- Snapshot global stable / tentatives : ${summary.snapshotStable} / ${summary.snapshotAttempts}`,
      `- Echecs invariant high-water : ${summary.highWaterInvariantFailures}`,
      `- Total deduplique : ${formatNumber(summary.deduplicatedTokens)} tokens`,
      ...(report.target
        ? [
            "",
            `Cible ${options.target}`,
            `- Fichiers avec tokens / sessions uniques : ${report.target.tokenFiles} / ${report.target.uniqueSessions}`,
            `- Total physique naif : ${formatNumber(report.target.physicalNaiveTokens)}`,
            `- Total deduplique : ${formatNumber(report.target.deduplicatedTokens)}`,
            `- Entree + sortie : ${formatNumber(report.target.inputTokens)} + ${formatNumber(report.target.outputTokens)}`,
            `- Ancien algorithme de reset : ${formatNumber(report.target.oldResetAlgorithmTokens)}`,
            `- Somme independante last_token_usage : ${formatNumber(report.target.lastUsageTokens)}`,
            `- Baisses de snapshots entrelaces : ${report.target.downwardTransitions}`,
          ]
        : options.target
          ? ["", `Cible introuvable ou ambigue : ${options.target}`]
          : []),
      "",
    ].join("\n"),
  );
};

main().catch((error) => {
  process.stderr.write(`Audit impossible: ${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
