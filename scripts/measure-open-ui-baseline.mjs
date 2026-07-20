import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import { chromium, request as playwrightRequest } from "playwright-core";

const scriptPath = new URL(import.meta.url).pathname.replace(/^\/(?:[A-Za-z]:)/, (value) => value.slice(1));
const projectRoot = resolve(dirname(scriptPath), "..");
const samplerPath = resolve(projectRoot, "scripts", "measure-server-resources.ps1");
const defaultStaticDir = resolve(projectRoot, "dist");

export const POLL_ROUTES = Object.freeze([
  "/api/chat/turns/active",
  "/api/autonomous-agents",
  "/api/limits",
  "/api/private-messages/users",
  "/api/private-messages/conversations",
]);

const RUNTIME_SIGNAL_ROUTES = new Set([
  POLL_ROUTES[0],
  POLL_ROUTES[1],
  POLL_ROUTES[3],
  POLL_ROUTES[4],
]);

export const CPU_ATTRIBUTION_RESOLUTION_SECONDS = 0.016;

const POLL_INTERVAL_MILLISECONDS = Object.freeze({
  [POLL_ROUTES[0]]: 1_000,
  [POLL_ROUTES[1]]: 2_000,
  [POLL_ROUTES[2]]: 30_000,
  [POLL_ROUTES[3]]: 8_000,
  [POLL_ROUTES[4]]: 8_000,
});

export const expectedPollRequestRange = (path, durationSeconds) => {
  const interval = POLL_INTERVAL_MILLISECONDS[path];
  if (!interval) throw new Error(`Intervalle de poll inconnu: ${path}`);
  const expected = durationSeconds * 1_000 / interval;
  return {
    minimum: expected < 1 ? 0 : Math.max(1, Math.round(expected) - 1),
    maximum: Math.round(expected) + 1,
  };
};

const ROUTE_PHASES = Object.freeze([
  { id: "active-turns-only", route: POLL_ROUTES[0] },
  { id: "autonomous-agents-only", route: POLL_ROUTES[1] },
  { id: "limits-only", route: POLL_ROUTES[2] },
  { id: "private-message-users-only", route: POLL_ROUTES[3] },
  { id: "private-message-conversations-only", route: POLL_ROUTES[4] },
]);

const POLL_BOOT_ATTEMPTS = Object.freeze(Object.fromEntries(
  POLL_ROUTES.map((path) => [path, path.startsWith("/api/private-messages/") ? 2 : 1]),
));

const PHASES = Object.freeze([
  { id: "shared-sync-only", allowedRoutes: [] },
  ...ROUTE_PHASES.map((phase) => ({ id: phase.id, allowedRoutes: [phase.route] })),
  { id: "full-interface", allowedRoutes: [...POLL_ROUTES] },
]);

const sleep = (milliseconds) => new Promise((resolvePromise) => {
  setTimeout(resolvePromise, milliseconds);
});

const round = (value, digits = 3) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

export const aggregateRequests = (requests, startedAt, endedAt) => {
  const counts = new Map();
  for (const request of requests) {
    if (request.at < startedAt || request.at > endedAt) continue;
    const key = `${request.method} ${request.path}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
};

export const summarizePhaseRuns = (runs) => {
  const summaries = {};
  for (const phase of PHASES) {
    const matching = runs.filter((run) => run.phase === phase.id);
    if (!matching.length) continue;
    const cpuSamples = matching.map((run) => run.resources.aggregate.cpuSeconds);
    const minimumCpuSeconds = Math.min(...cpuSamples);
    const maximumCpuSeconds = Math.max(...cpuSamples);
    const cpuSpreadSeconds = round(maximumCpuSeconds - minimumCpuSeconds);
    summaries[phase.id] = {
      repetitions: matching.length,
      cpuSeconds: round(median(cpuSamples) ?? 0),
      cpuRangeSeconds: {
        minimum: round(minimumCpuSeconds),
        maximum: round(maximumCpuSeconds),
        spread: cpuSpreadSeconds,
      },
      cpuRepetitionsStable: cpuSpreadSeconds <= CPU_ATTRIBUTION_RESOLUTION_SECONDS,
      cpuCorePercent: round(median(matching.map((run) => run.resources.aggregate.cpuCorePercent)) ?? 0, 2),
      peakWorkingSetMiB: round(median(matching.map((run) => run.resources.aggregate.workingSetMiB.peak)) ?? 0, 2),
      routeCounts: Object.fromEntries(POLL_ROUTES.map((path) => {
        const key = `GET ${path}`;
        return [path, round(median(matching.map((run) => run.forwardedRequests[key] ?? 0)) ?? 0, 1)];
      })),
    };
  }

  const shared = summaries["shared-sync-only"]?.cpuSeconds ?? 0;
  const candidates = ROUTE_PHASES.map(({ route: path, id: phase }) => {
    const phaseCpu = summaries[phase]?.cpuSeconds ?? shared;
    const requestCount = summaries[phase]?.routeCounts[path] ?? 0;
    const observedDeltaCpuSeconds = round(phaseCpu - shared);
    const deltaAboveResolution = (
      requestCount > 0
      && observedDeltaCpuSeconds >= CPU_ATTRIBUTION_RESOLUTION_SECONDS
    );
    return {
      path,
      phase,
      requestCount,
      observedDeltaCpuSeconds,
      deltaAboveResolution,
      candidateCpuSeconds: deltaAboveResolution ? observedDeltaCpuSeconds : 0,
    };
  });
  const candidatePredictedFullCpuSeconds = round(
    shared + candidates.reduce((total, item) => total + item.candidateCpuSeconds, 0),
  );
  const observedFullCpuSeconds = summaries["full-interface"]?.cpuSeconds ?? null;
  const candidateResidualCpuSeconds = observedFullCpuSeconds === null
    ? null
    : round(observedFullCpuSeconds - candidatePredictedFullCpuSeconds);
  const repetitionsStable = Object.values(summaries).every(
    (phase) => phase.cpuRepetitionsStable,
  );
  const modelConsistent = (
    observedFullCpuSeconds !== null
    && repetitionsStable
    && Math.abs(candidateResidualCpuSeconds) <= CPU_ATTRIBUTION_RESOLUTION_SECONDS
  );
  const attributions = Object.fromEntries(candidates.map((candidate) => {
    const phaseStable = (
      summaries["shared-sync-only"]?.cpuRepetitionsStable === true
      && summaries[candidate.phase]?.cpuRepetitionsStable === true
    );
    const measurable = candidate.deltaAboveResolution && phaseStable && modelConsistent;
    const cpuSeconds = measurable ? candidate.observedDeltaCpuSeconds : null;
    return [candidate.path, {
      requestCount: candidate.requestCount,
      cpuSeconds,
      cpuSecondsPerRequest: measurable ? round(cpuSeconds / candidate.requestCount, 6) : null,
      observedDeltaCpuSeconds: candidate.observedDeltaCpuSeconds,
      deltaAboveResolution: candidate.deltaAboveResolution,
      phaseRepetitionsStable: phaseStable,
      measurable,
      method: `${candidate.phase} minus shared-sync-only`,
    }];
  }));

  return {
    phases: summaries,
    attribution: {
      cpuResolutionSeconds: CPU_ATTRIBUTION_RESOLUTION_SECONDS,
      sharedSyncAndBackgroundCpuSeconds: shared,
      repetitionsStable,
      modelConsistent,
      routes: attributions,
      predictedFullCpuSeconds: modelConsistent ? candidatePredictedFullCpuSeconds : null,
      candidatePredictedFullCpuSeconds,
      observedFullCpuSeconds,
      candidateResidualCpuSeconds,
    },
  };
};

export const summarizeRuntimeSignalRuns = (runs) => {
  const fullInterface = summarizePhaseRuns(runs).phases["full-interface"];
  const removedRouteCounts = Object.fromEntries(
    [...RUNTIME_SIGNAL_ROUTES].map((path) => [path, fullInterface?.routeCounts[path] ?? 0]),
  );
  return {
    phases: fullInterface ? { "full-interface": fullInterface } : {},
    runtimeSignal: {
      removedRouteCounts,
      periodicGetCount: fullInterface
        ? round(Object.values(fullInterface.routeCounts).reduce((sum, count) => sum + count, 0), 1)
        : 0,
      stable: runs.length > 0 && runs.every((run) => (
        [...RUNTIME_SIGNAL_ROUTES].every((path) => (
          (run.forwardedRequests[`GET ${path}`] ?? 0) === 0
        ))
        && run.websocket.runtimeConnectionOpenBeforeWindow
        && (run.websocket.runtimeEventsDuringWindow.close ?? 0) === 0
      )),
    },
  };
};

export const summarizeBrowserRuns = (runs) => ({
  repetitions: runs.length,
  cpuSeconds: round(median(runs.map((run) => run.browserResources.aggregate.cpuSeconds)) ?? 0),
  cpuCorePercent: round(median(runs.map((run) => run.browserResources.aggregate.cpuCorePercent)) ?? 0, 2),
  peakWorkingSetMiB: round(median(runs.map(
    (run) => run.browserResources.aggregate.workingSetMiB.peak,
  )) ?? 0, 2),
  peakPrivateMemoryMiB: round(median(runs.map(
    (run) => run.browserResources.aggregate.privateMemoryMiB.peak,
  )) ?? 0, 2),
  peakProcessCount: Math.max(...runs.map(
    (run) => run.browserResources.aggregate.processCount.peak,
  )),
});

const parseArguments = (argv) => {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) throw new Error(`Argument inattendu: ${item}`);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Valeur manquante pour ${item}`);
    values.set(item.slice(2), next);
    index += 1;
  }

  const serverPath = values.get("server-path");
  if (!serverPath) throw new Error("--server-path est obligatoire.");
  const durationSeconds = Number(values.get("duration-seconds") ?? 30);
  const repetitions = Number(values.get("repetitions") ?? 2);
  const chatCount = Number(values.get("chat-count") ?? 4);
  const syncMode = values.get("sync-mode") ?? "legacy-poll";
  const emulateLegacyPolls = values.get("emulate-legacy-polls") === "true";
  const fullInterfaceOnly = values.get("full-interface-only") === "true";
  if (!Number.isInteger(durationSeconds) || durationSeconds < 2 || durationSeconds > 600) {
    throw new Error("--duration-seconds doit etre un entier entre 2 et 600.");
  }
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) {
    throw new Error("--repetitions doit etre un entier entre 1 et 5.");
  }
  if (!Number.isInteger(chatCount) || chatCount < 1 || chatCount > 50) {
    throw new Error("--chat-count doit etre un entier entre 1 et 50.");
  }
  if (syncMode !== "legacy-poll" && syncMode !== "runtime-signal") {
    throw new Error("--sync-mode doit valoir legacy-poll ou runtime-signal.");
  }
  return {
    serverPath: resolve(serverPath),
    staticDir: resolve(values.get("static-dir") ?? defaultStaticDir),
    chromePath: values.get("chrome-path") ? resolve(values.get("chrome-path")) : null,
    output: values.get("output") ? resolve(values.get("output")) : null,
    durationSeconds,
    repetitions,
    chatCount,
    syncMode,
    emulateLegacyPolls,
    fullInterfaceOnly,
  };
};

const findChrome = (explicitPath) => {
  const candidates = [
    explicitPath,
    process.env.CST_CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA ?? ""}/Google/Chrome/Application/chrome.exe`,
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error("Chrome ou Chromium est introuvable.");
  return resolve(found);
};

const getFreePort = () => new Promise((resolvePromise, reject) => {
  const listener = net.createServer();
  listener.once("error", reject);
  listener.listen(0, "127.0.0.1", () => {
    const address = listener.address();
    const port = typeof address === "object" && address ? address.port : null;
    listener.close((error) => {
      if (error) reject(error);
      else if (!port) reject(new Error("Port loopback ephemere introuvable."));
      else resolvePromise(port);
    });
  });
});

const sha256File = async (path) => {
  const content = await readFile(path);
  return createHash("sha256").update(content).digest("hex");
};

const fingerprintDirectory = async (root) => {
  const files = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  await visit(root);
  const hash = createHash("sha256");
  let bytes = 0;
  for (const path of files) {
    const content = await readFile(path);
    const name = relative(root, path).replaceAll("\\", "/");
    bytes += content.byteLength;
    hash.update(name);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return { algorithm: "sha256", digest: hash.digest("hex"), fileCount: files.length, bytes };
};

export const snapshotArtifacts = async (serverPath, staticDir, tempRoot) => {
  const artifactRoot = join(tempRoot, "artifacts");
  const serverSnapshot = join(artifactRoot, basename(serverPath));
  const staticSnapshot = join(artifactRoot, "frontend");
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await rm(artifactRoot, { recursive: true, force: true });
      await mkdir(artifactRoot, { recursive: true });
      const [serverBefore, frontendBefore, serverMode] = await Promise.all([
        sha256File(serverPath),
        fingerprintDirectory(staticDir),
        stat(serverPath),
      ]);
      await Promise.all([
        copyFile(serverPath, serverSnapshot),
        cp(staticDir, staticSnapshot, { recursive: true, force: false, errorOnExist: true }),
      ]);
      const [serverAfter, copiedServer, frontendAfter, copiedFrontend] = await Promise.all([
        sha256File(serverPath),
        sha256File(serverSnapshot),
        fingerprintDirectory(staticDir),
        fingerprintDirectory(staticSnapshot),
      ]);
      const frontendStable = (
        frontendBefore.digest === frontendAfter.digest
        && frontendBefore.digest === copiedFrontend.digest
        && frontendBefore.fileCount === copiedFrontend.fileCount
        && frontendBefore.bytes === copiedFrontend.bytes
      );
      if (serverBefore === serverAfter && serverBefore === copiedServer && frontendStable) {
        await chmod(serverSnapshot, serverMode.mode);
        return {
          serverPath: serverSnapshot,
          staticDir: staticSnapshot,
          serverSha256: copiedServer,
          frontend: copiedFrontend,
        };
      }
      lastError = new Error(`artefacts modifies pendant la copie (tentative ${attempt})`);
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(
    `Impossible de figer les artefacts apres 3 tentatives: ${lastError instanceof Error ? lastError.message : lastError}`,
  );
};

const fixtureSettings = (home, workspace) => ({
  accounts: [{
    id: "perf-account",
    label: "Compte mesure",
    provider: "codex",
    codexHome: home,
    projectDir: workspace,
    bypass: false,
    model: "gpt-5-codex",
    reasoningEffort: "high",
  }],
  proxies: [],
  defaultAccountId: "perf-account",
  shell: "powershell",
  codexCommand: "codex",
  autoRunCodex: false,
  proxyControlsEnabled: false,
  pool: {
    port: 8787,
    apiKey: "",
    defaultModel: "gpt-5-codex",
    reasoningEffort: "high",
    upstream: "",
    requestTimeoutSecs: 120,
    cooldownSecs429: 60,
    concurrency: 1,
    clientIdOverride: "",
  },
  agents: [{
    id: "codex",
    label: "Codex",
    command: "codex",
    provider: "codex",
    kind: "cli",
    builtin: true,
  }],
  activeAgentId: "codex",
  kombai: {
    codeServerCommand: "code-server",
    port: 3000,
    extensionId: "",
    autoInstallExtension: false,
  },
  codexBypass: false,
  autoDiscoverAccounts: false,
  workspaces: [{ id: "perf-workspace", label: "Projet mesure", path: workspace, memory: "" }],
  closedWorkspaceIds: [],
});

const createFixture = async (root, chatCount) => {
  const home = join(root, "codex-home");
  const workspace = join(root, "workspace");
  const sessions = join(home, "sessions", "2026", "07", "15");
  await Promise.all([mkdir(sessions, { recursive: true }), mkdir(workspace, { recursive: true })]);
  await writeFile(join(root, "settings.json"), JSON.stringify(fixtureSettings(home, workspace), null, 2));
  for (let index = 1; index <= chatCount; index += 1) {
    const suffix = String(index).padStart(12, "0");
    const id = `019f6500-0000-7000-8000-${suffix}`;
    const seconds = String(index).padStart(2, "0");
    const meta = {
      timestamp: `2026-07-15T08:00:${seconds}.000Z`,
      type: "session_meta",
      payload: {
        session_id: id,
        id,
        timestamp: `2026-07-15T08:00:${seconds}.000Z`,
        cwd: workspace,
        thread_source: "user",
        cli_version: "performance-fixture",
      },
    };
    const user = {
      timestamp: `2026-07-15T08:01:${seconds}.000Z`,
      type: "user_message",
      payload: { message: `Conversation de mesure ${index}` },
    };
    const assistant = {
      timestamp: `2026-07-15T08:02:${seconds}.000Z`,
      type: "agent_message",
      payload: { message: `Reponse stable ${index}` },
    };
    const content = `${JSON.stringify(meta)}\n${JSON.stringify(user)}\n${JSON.stringify(assistant)}\n`;
    await writeFile(join(sessions, `rollout-2026-07-15T08-00-${seconds}-${id}.jsonl`), content);
  }
  return { home, workspace };
};

const waitForServer = async (baseUrl, child, stderr) => {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Le serveur isole a quitte avant la mesure: ${stderr()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok && (await response.json()).ready === true) return;
    } catch {
      // Le bind peut ne pas etre encore pret.
    }
    await sleep(100);
  }
  throw new Error("Le serveur isole n'est pas pret apres 20 secondes.");
};

const stopProcessTree = async (child) => {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    child.kill("SIGTERM");
  }
  await Promise.race([
    new Promise((resolvePromise) => child.once("exit", resolvePromise)),
    sleep(5_000),
  ]);
};

const registerFixtureUser = async (baseUrl) => {
  const client = await playwrightRequest.newContext({ baseURL: baseUrl });
  try {
    const nonce = randomUUID().replaceAll("-", "").slice(0, 16);
    const response = await client.post("/api/auth/register", {
      data: {
        username: `perf_${nonce}`,
        email: `perf_${nonce}@example.invalid`,
        password: `Perf-${nonce}-A1!`,
      },
    });
    if (!response.ok()) throw new Error(`Creation de session fixture refusee: HTTP ${response.status()}`);
    return client.storageState();
  } finally {
    await client.dispose();
  }
};

const capturePollRouteFixtures = async (baseUrl, storageState, token) => {
  const client = await playwrightRequest.newContext({
    baseURL: baseUrl,
    storageState,
    extraHTTPHeaders: { authorization: `Bearer ${token}` },
  });
  try {
    const fixtures = {};
    for (const path of POLL_ROUTES) {
      const response = await client.get(path, { timeout: 10_000 });
      if (!response.ok()) {
        throw new Error(`Fixture de poll refusee pour ${path}: HTTP ${response.status()}`);
      }
      fixtures[path] = {
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "application/json",
        body: await response.text(),
      };
    }
    return fixtures;
  } finally {
    await client.dispose();
  }
};

const runSampler = (rootProcessId, durationSeconds, label) => new Promise((resolvePromise, reject) => {
  const child = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", samplerPath,
    "-RootProcessId", String(rootProcessId),
    "-DurationSeconds", String(durationSeconds),
    "-SampleIntervalMilliseconds", "1000",
    "-ProcessTreeRefreshMilliseconds", "4000",
    "-Label", label,
  ], { cwd: projectRoot, windowsHide: true, shell: false });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.once("error", reject);
  child.once("close", (code) => {
    if (code !== 0) {
      reject(new Error(`Sampler interrompu (code ${code}): ${stderr.trim()}`));
      return;
    }
    try {
      resolvePromise(JSON.parse(stdout.trim().replace(/^\uFEFF/, "")));
    } catch (error) {
      reject(new Error(`JSON du sampler invalide: ${error instanceof Error ? error.message : error}`));
    }
  });
});

const sanitizeCapture = (capture) => ({
  window: {
    requestedDurationSeconds: capture.window.requestedDurationSeconds,
    observedDurationSeconds: capture.window.observedDurationSeconds,
    sampleIntervalMilliseconds: capture.window.sampleIntervalMilliseconds,
    sampleCount: capture.window.sampleCount,
    endedEarly: capture.window.endedEarly,
    endReason: capture.window.endReason,
  },
  aggregate: capture.aggregate,
  byProcessName: capture.byProcessName,
  topology: capture.topology,
  observedProcessNames: capture.observedProcessNames,
});

const runPhase = async ({
  browser,
  storageState,
  baseUrl,
  token,
  workspace,
  serverPid,
  browserPid,
  phase,
  repetition,
  durationSeconds,
  chatCount,
  routeFixtures,
  syncMode,
  emulateLegacyPolls,
}) => {
  const expectRuntimeSignal = syncMode === "runtime-signal";
  const blockedRoutes = new Set(POLL_ROUTES.filter((path) => !phase.allowedRoutes.includes(path)));
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "fr-FR",
    serviceWorkers: "block",
    storageState,
  });
  await context.addInitScript(({ workspacePath, adminToken, serverBaseUrl }) => {
    localStorage.setItem("codex-switch-terminal.remote.enabled", "1");
    localStorage.setItem("codex-switch-terminal.remote.base-url", serverBaseUrl);
    localStorage.setItem("codex-switch-terminal.remote.token", adminToken);
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
  }, { workspacePath: workspace, adminToken: token, serverBaseUrl: baseUrl });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  page.setDefaultNavigationTimeout(45_000);
  const requests = [];
  const websocketEvents = [];
  const failures = [];

  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push({ at: Date.now(), method: request.method(), path: url.pathname });
  });
  page.on("requestfailed", (request) => failures.push(
    `requestfailed ${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText ?? "inconnue"}`,
  ));
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
  page.on("websocket", (socket) => {
    const path = new URL(socket.url()).pathname;
    websocketEvents.push({ at: Date.now(), kind: "open", path });
    socket.on("framereceived", () => websocketEvents.push({ at: Date.now(), kind: "received", path }));
    socket.on("framesent", () => websocketEvents.push({ at: Date.now(), kind: "sent", path }));
    socket.on("close", () => websocketEvents.push({ at: Date.now(), kind: "close", path }));
    socket.on("socketerror", (error) => failures.push(`websocket ${path}: ${error}`));
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
      failures.push(`requete externe refusee: ${url.origin}${url.pathname}`);
      await route.abort("blockedbyclient");
      return;
    }
    if (request.method() === "GET" && blockedRoutes.has(url.pathname)) {
      await route.fulfill(routeFixtures[url.pathname]);
      return;
    }
    await route.continue();
  });

  try {
    let response;
    try {
      response = await page.goto(`${baseUrl}/?open-ui-baseline=1`, { waitUntil: "domcontentloaded" });
    } catch (error) {
      let probe = "sonde directe indisponible";
      try {
        const direct = await fetch(`${baseUrl}/?open-ui-baseline-probe=1`, {
          signal: AbortSignal.timeout(3_000),
        });
        const body = await direct.arrayBuffer();
        probe = `sonde directe HTTP ${direct.status}, ${direct.headers.get("content-type") ?? "type inconnu"}, ${body.byteLength} octets`;
      } catch (probeError) {
        probe = `sonde directe en echec: ${probeError instanceof Error ? probeError.message : probeError}`;
      }
      throw new Error(
        `${error instanceof Error ? error.message : error}; ${probe}`,
      );
    }
    if (!response?.ok()) throw new Error(`Navigation refusee: HTTP ${response?.status() ?? "inconnu"}`);
    await page.locator("#chatAppSidebar").waitFor({ state: "visible" });
    await page.waitForFunction((expected) => (
      document.querySelectorAll("#chatSideConversations .chat-side-item").length === expected
    ), chatCount);
    await page.waitForFunction(() => document.visibilityState === "visible");

    if (emulateLegacyPolls) {
      await page.evaluate(({ intervals, bearerToken }) => {
        const poll = (path) => fetch(path, {
          headers: { authorization: `Bearer ${bearerToken}` },
          cache: "no-store",
        }).catch(() => undefined);
        for (const [path, interval] of Object.entries(intervals)) {
          void poll(path);
          window.setInterval(() => void poll(path), interval);
        }
      }, {
        intervals: Object.fromEntries([...RUNTIME_SIGNAL_ROUTES].map(
          (path) => [path, POLL_INTERVAL_MILLISECONDS[path]],
        )),
        bearerToken: token,
      });
    }

    const websocketDeadline = Date.now() + 10_000;
    while (
      (
        !websocketEvents.some((event) => event.kind === "open" && event.path === "/ws/discussions")
        || (
          expectRuntimeSignal
          && !websocketEvents.some((event) => event.kind === "received" && event.path === "/ws/runtime")
        )
      )
      && Date.now() < websocketDeadline
    ) {
      await sleep(100);
    }
    if (!websocketEvents.some((event) => event.kind === "open" && event.path === "/ws/discussions")) {
      throw new Error("Le WebSocket d'index des discussions n'est pas ouvert.");
    }
    if (
      expectRuntimeSignal
      && !websocketEvents.some((event) => event.kind === "received" && event.path === "/ws/runtime")
    ) {
      throw new Error("Le WebSocket de synchronisation runtime n'a pas recu son hello.");
    }

    // Attend tous les snapshots de demarrage, y compris ceux demandes par le
    // hello runtime : aucun import paresseux ne doit tomber dans la fenetre.
    const pollAttemptCount = (path) => requests.filter((request) => (
      request.method === "GET" && request.path === path
    )).length;
    const bootPollRoutes = POLL_ROUTES;
    const bootAttempts = expectRuntimeSignal
      ? Object.fromEntries(POLL_ROUTES.map((path) => [path, 1]))
      : POLL_BOOT_ATTEMPTS;
    const pollBootDeadline = Date.now() + 30_000;
    while (
      !bootPollRoutes.every((path) => pollAttemptCount(path) >= bootAttempts[path])
      && Date.now() < pollBootDeadline
    ) {
      await sleep(100);
    }
    const missingBootPolls = bootPollRoutes.filter(
      (path) => pollAttemptCount(path) < bootAttempts[path],
    );
    if (missingBootPolls.length) {
      throw new Error(`Poll(s) non initialise(s) avant mesure: ${missingBootPolls.join(", ")}`);
    }
    await page.waitForTimeout(500);
    process.stderr.write(
      `[open-ui] repetition ${repetition}, phase ${phase.id}: ${durationSeconds}s\n`,
    );
    const [capture, browserCapture] = await Promise.all([
      runSampler(serverPid, durationSeconds, `open-ui-${phase.id}-r${repetition}-server`),
      runSampler(browserPid, durationSeconds, `open-ui-${phase.id}-r${repetition}-browser`),
    ]);
    await page.waitForTimeout(250);

    const startedAt = Date.parse(capture.window.startedAtUtc);
    const endedAt = Date.parse(capture.window.endedAtUtc);
    const attemptedRequests = aggregateRequests(requests, startedAt, endedAt);
    const forwardedRequests = Object.fromEntries(
      Object.entries(attemptedRequests).filter(([key]) => {
        const space = key.indexOf(" ");
        const method = key.slice(0, space);
        const path = key.slice(space + 1);
        return !(method === "GET" && blockedRoutes.has(path));
      }),
    );
    const discussionFallbacks = forwardedRequests["GET /api/discussions"] ?? 0;
    if (discussionFallbacks > 0) {
      failures.push(`${discussionFallbacks} poll(s) REST discussions: WebSocket non stable`);
    }
    const expectedRequestKeys = new Set(POLL_ROUTES.map((path) => `GET ${path}`));
    const unexpectedRequests = Object.keys(forwardedRequests).filter(
      (key) => !expectedRequestKeys.has(key),
    );
    if (unexpectedRequests.length) {
      failures.push(`requete(s) periodique(s) non attribuee(s): ${unexpectedRequests.join(", ")}`);
    }
    for (const path of POLL_ROUTES) {
      const key = `GET ${path}`;
      const count = attemptedRequests[key] ?? 0;
      if (expectRuntimeSignal && RUNTIME_SIGNAL_ROUTES.has(path)) {
        if (count !== 0) failures.push(`${key}: ${count} poll(s), attendu 0 avec /ws/runtime`);
        continue;
      }
      const range = expectedPollRequestRange(path, durationSeconds);
      if (count < range.minimum || count > range.maximum) {
        failures.push(
          `${key}: ${count} tentative(s), attendu ${range.minimum}-${range.maximum} sur ${durationSeconds}s`,
        );
      }
    }
    const state = await page.evaluate(() => ({
      visibility: document.visibilityState,
      visibleChats: document.querySelectorAll("#chatSideConversations .chat-side-item").length,
      sidebarVisible: !!document.querySelector("#chatAppSidebar"),
    }));
    if (state.visibility !== "visible" || state.visibleChats !== chatCount || !state.sidebarVisible) {
      failures.push(`etat final inattendu: ${JSON.stringify(state)}`);
    }
    if (capture.window.endedEarly) failures.push(`sampler termine tot: ${capture.window.endReason}`);
    if (
      expectRuntimeSignal
      && websocketEvents.some((event) => (
        event.kind === "close"
        && event.path === "/ws/runtime"
        && event.at >= startedAt
        && event.at <= endedAt
      ))
    ) {
      failures.push("fermeture du WebSocket runtime pendant la mesure");
    }
    if (failures.length) throw new Error(failures.join("; "));

    const websocketWindow = websocketEvents.filter((event) => (
      event.at >= startedAt && event.at <= endedAt
    ));
    return {
      phase: phase.id,
      repetition,
      blockedRoutes: [...blockedRoutes],
      interfaceState: state,
      attemptedRequests,
      forwardedRequests,
      websocket: {
        indexConnectionOpenBeforeWindow: websocketEvents.some((event) => (
          event.kind === "open" && event.path === "/ws/discussions" && event.at < startedAt
        )),
        eventsDuringWindow: Object.fromEntries(["received", "sent", "close"].map((kind) => [
          kind,
          websocketWindow.filter((event) => event.kind === kind && event.path === "/ws/discussions").length,
        ])),
        runtimeConnectionOpenBeforeWindow: websocketEvents.some((event) => (
          event.kind === "open" && event.path === "/ws/runtime" && event.at < startedAt
        )),
        runtimeEventsDuringWindow: Object.fromEntries(["received", "sent", "close"].map((kind) => [
          kind,
          websocketWindow.filter((event) => event.kind === kind && event.path === "/ws/runtime").length,
        ])),
      },
      resources: sanitizeCapture(capture),
      browserResources: sanitizeCapture(browserCapture),
    };
  } finally {
    await context.close();
  }
};

const serverVersion = (serverPath) => {
  const result = spawnSync(serverPath, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });
  if (result.status !== 0) return "unknown";
  return result.stdout.trim();
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (!existsSync(options.serverPath)) throw new Error(`Serveur introuvable: ${options.serverPath}`);
  if (!existsSync(options.staticDir)) throw new Error(`Frontend introuvable: ${options.staticDir}`);
  if (!existsSync(join(options.staticDir, "index.html"))) {
    throw new Error(`Frontend incomplet (index.html absent): ${options.staticDir}`);
  }
  if (!existsSync(samplerPath)) throw new Error(`Sampler introuvable: ${samplerPath}`);
  const chromePath = findChrome(options.chromePath);
  const tempRoot = await mkdtemp(join(tmpdir(), "cst-open-ui-baseline-"));
  const token = randomUUID().replaceAll("-", "");
  let server = null;
  let browser = null;
  let browserServer = null;
  let serverStderr = "";

  try {
    const artifactSnapshot = await snapshotArtifacts(
      options.serverPath,
      options.staticDir,
      tempRoot,
    );
    const artifactEvidence = {
      serverVersion: serverVersion(artifactSnapshot.serverPath),
      serverSha256: artifactSnapshot.serverSha256,
      frontend: artifactSnapshot.frontend,
    };
    const runtimeRoot = join(tempRoot, "runtime");
    const fixture = await createFixture(runtimeRoot, options.chatCount);
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const env = {
      ...process.env,
      CST_ACCOUNTS_DIR: runtimeRoot,
      CST_ADMIN_TOKEN: token,
      CST_BIND: `127.0.0.1:${port}`,
      CST_DATA_DIR: runtimeRoot,
      CST_GIT_PAT: "",
      CST_GOOGLE_CLIENT_ID: "",
      CST_GOOGLE_CLIENT_SECRET: "",
      CST_NODE_CAPACITY: "1",
      CST_NODE_ID: "open-ui-baseline",
      CST_NODE_LABEL: "Open UI baseline",
      CST_PUBLIC_BASE_URL: baseUrl,
      CST_STATIC_DIR: artifactSnapshot.staticDir,
      CST_WORKSPACES_ROOT: fixture.workspace,
    };
    server = spawn(artifactSnapshot.serverPath, [], {
      cwd: dirname(artifactSnapshot.serverPath),
      env,
      windowsHide: true,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    server.stdout.on("data", () => undefined);
    server.stderr.on("data", (chunk) => {
      serverStderr = `${serverStderr}${chunk}`.slice(-8_000);
    });
    await waitForServer(baseUrl, server, () => serverStderr.trim());
    const storageState = await registerFixtureUser(baseUrl);
    const routeFixtures = await capturePollRouteFixtures(baseUrl, storageState, token);
    browserServer = await chromium.launchServer({
      executablePath: chromePath,
      headless: true,
      args: [
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-features=CalculateNativeWinOcclusion",
        "--disable-renderer-backgrounding",
        "--disable-sync",
        "--metrics-recording-only",
        "--no-first-run",
      ],
    });
    browser = await chromium.connect(browserServer.wsEndpoint());
    const browserVersion = browser.version();

    const runs = [];
    const measuredPhases = options.syncMode === "runtime-signal" || options.fullInterfaceOnly
      ? [PHASES.at(-1)]
      : PHASES;
    for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
      const phases = repetition % 2 === 1 ? measuredPhases : [...measuredPhases].reverse();
      for (const phase of phases) {
        runs.push(await runPhase({
          browser,
          storageState,
          baseUrl,
          token,
          workspace: fixture.workspace,
          serverPid: server.pid,
          browserPid: browserServer.process().pid,
          phase,
          repetition,
          durationSeconds: options.durationSeconds,
          chatCount: options.chatCount,
          routeFixtures,
          syncMode: options.syncMode,
          emulateLegacyPolls: options.emulateLegacyPolls,
        }));
        await sleep(500);
      }
    }

    const result = {
      schemaVersion: 2,
      label: options.syncMode === "runtime-signal"
        ? "open-ui-runtime-signal"
        : "open-ui-poll-baseline",
      scenario: {
        isolated: true,
        browser: { executable: basename(chromePath), version: browserVersion },
        headless: true,
        host: { platform: process.platform, arch: process.arch },
        viewport: { width: 1440, height: 900 },
        pageVisibility: "visible",
        chatCount: options.chatCount,
        activeTurnCount: 0,
        autonomousAgentCount: 0,
        terminalCount: 0,
        repetitions: options.repetitions,
        durationSeconds: options.durationSeconds,
        syncMode: options.syncMode,
      },
      artifacts: artifactEvidence,
      summary: options.syncMode === "runtime-signal"
        ? { ...summarizeRuntimeSignalRuns(runs), browser: summarizeBrowserRuns(runs) }
        : { ...summarizePhaseRuns(runs), browser: summarizeBrowserRuns(
          runs.filter((run) => run.phase === "full-interface"),
        ) },
      runs,
      methodology: [
        `Le serveur, ses donnees et les ${options.chatCount} rollouts sont jetables; aucun processus ou terminal existant n'est modifie.`,
        "Le binaire serveur et le frontend sont copies avant la premiere phase; un build concurrent ne peut pas modifier l'artefact mesure.",
        "Chaque phase garde la meme page visible et le meme WebSocket; une route exclue recoit localement la reponse exacte capturee sur le serveur fixture avant la mesure.",
        "Le CPU d'une route n'est attribue que si son delta depasse la resolution, si les repetitions sont stables et si la somme predit la phase complete a une resolution pres; sinon le delta brut reste seulement une observation.",
        "Les requetes sont comptees uniquement entre les horodatages exacts du sampler serveur; le boot et les PID/ports ephemeres sont exclus.",
        options.syncMode === "runtime-signal"
          ? "Tous les snapshots REST de demarrage doivent etre termines avant le sampler; aucune lecture differee ne peut tomber dans la fenetre."
          : "Chaque poll doit etre initialise avant le sampler; la messagerie chargee en idle accomplit deux cycles pour aligner sa periode de huit secondes. Toute autre requete HTTP invalide la capture.",
        "Chaque fenetre doit respecter la plage de requetes calculee depuis l'intervalle du poll; une activite retardee par la machine invalide la comparaison CPU.",
        options.syncMode === "runtime-signal"
          ? "Les routes tours actifs, agents et messagerie doivent rester a zero pendant toute la fenetre; /ws/runtime doit avoir livre son hello avant le sampler et ne pas se fermer."
          : "Le mode historique exige la cadence nominale des cinq polls afin de conserver la reference avant optimisation.",
        "Les phases sont inversees une repetition sur deux pour limiter un biais d'ordre et de chauffe.",
        "Toute requete non loopback, perte du WebSocket, poll REST discussions ou variation du nombre de chats invalide la capture.",
      ],
    };
    const serialized = `${JSON.stringify(result, null, 2)}\n`;
    if (options.output) {
      await mkdir(dirname(options.output), { recursive: true });
      await writeFile(options.output, serialized);
      process.stderr.write(`[open-ui] resultat: ${options.output}\n`);
    } else {
      process.stdout.write(serialized);
    }
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (browserServer) await browserServer.close().catch(() => undefined);
    await stopProcessTree(server);
    const resolvedTemp = resolve(tempRoot);
    const resolvedSystemTemp = resolve(tmpdir());
    if (
      resolvedTemp.startsWith(resolvedSystemTemp)
      && basename(resolvedTemp).startsWith("cst-open-ui-baseline-")
    ) {
      await rm(resolvedTemp, { recursive: true, force: true });
    }
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
