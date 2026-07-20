import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") {
  throw new Error("Le harnais update-node runtime cible Windows et ses jonctions NTFS.");
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const updater = path.join(root, "scripts", "update-node.ps1");
const powershell = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
const cscCandidates = [
  "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe",
  "C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe",
];
const csc = cscCandidates.find(existsSync);

if (!existsSync(updater)) throw new Error(`Updater introuvable: ${updater}`);
if (!existsSync(powershell)) throw new Error(`Windows PowerShell introuvable: ${powershell}`);
if (!csc) throw new Error("Compilateur C# .NET Framework introuvable.");

const testRoot = await mkdtemp(path.join(os.tmpdir(), "cst-update-runtime-"));
const wrapperPath = path.join(testRoot, "invoke-update-node.ps1");
const stubSourcePath = path.join(testRoot, "version-stub.cs");
const stubExePath = path.join(testRoot, "cst-server.exe");
const concurrencyOnly = process.argv.includes("--concurrency-only");
const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--concurrency-only");
let assertions = 0;

if (unknownArguments.length > 0) {
  throw new Error(`Arguments inconnus: ${unknownArguments.join(", ")}`);
}

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

function canonical(candidate) {
  return path.resolve(candidate).replaceAll("/", "\\").toLowerCase();
}

function eventIndex(events, predicate, after = -1) {
  return events.findIndex((event, index) => index > after && predicate(event));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body ? JSON.parse(body) : {};
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

async function writeRelease(releaseDir, version, commit, runtimeCommit = commit) {
  const dist = path.join(releaseDir, "dist");
  await mkdir(dist, { recursive: true });
  await copyFile(stubExePath, path.join(releaseDir, "cst-server.exe"));
  await writeFile(
    path.join(dist, "harness-release.txt"),
    `${version}\n${commit}\n${runtimeCommit}\n`,
  );
  await writeFile(path.join(dist, "index.html"), `<title>${version}</title>\n`);
  return { exe: path.join(releaseDir, "cst-server.exe"), dist };
}

function startPowerShell(args, label, timeoutMs = 30_000) {
  const child = spawn(powershell, args, {
    cwd: root,
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });

  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      reject(new Error(`${label}: PowerShell timeout (${timeoutMs} ms)\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
  return { child, result };
}

async function runPowerShell(args, label, timeoutMs = 30_000) {
  return await startPowerShell(args, label, timeoutMs).result;
}

async function waitForValue(probe, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label}: signal non recu sous ${timeoutMs} ms`);
}

function getProcessStartTicks(pid) {
  const result = spawnSync(powershell, [
    "-NoProfile",
    "-Command",
    `[Console]::Out.Write((Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks)`,
  ], { encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(`Identite du processus ${pid} illisible:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function terminatePowerShell(run) {
  if (run?.child && run.child.exitCode === null && run.child.signalCode === null) {
    spawnSync("taskkill", ["/pid", String(run.child.pid), "/t", "/f"], { windowsHide: true });
  }
}

async function runScenario({
  name,
  candidateVersion,
  candidateCommit,
  runtimeCommit,
  expectSuccess,
  activeChatPolls = 0,
  chatApiMode = "ok",
}) {
  const scenarioRoot = path.join(testRoot, name);
  const appData = path.join(scenarioRoot, "appdata");
  const localAppData = path.join(scenarioRoot, "localappdata");
  const nodeHome = path.join(localAppData, "codex-switch-terminal-node");
  const releasesDir = path.join(nodeHome, "releases");
  const currentLink = path.join(nodeHome, "current");
  const oldRelease = path.join(releasesDir, "1.0.0-old-good");
  const staleRelease = path.join(releasesDir, "0.9.0-stale");
  const candidateSource = path.join(scenarioRoot, "candidate");
  const envDir = path.join(appData, "codex-switch-terminal-server");

  await mkdir(releasesDir, { recursive: true });
  await mkdir(envDir, { recursive: true });
  await writeFile(
    path.join(envDir, "server.local.env.ps1"),
    '$env:CST_ADMIN_TOKEN = "update-runtime-local-proof"\n',
  );
  await writeRelease(oldRelease, "1.0.0", "old-good");
  await mkdir(staleRelease, { recursive: true });
  await writeFile(path.join(staleRelease, "obsolete.txt"), "obsolete\n");
  const candidate = await writeRelease(
    candidateSource,
    candidateVersion,
    candidateCommit,
    runtimeCommit,
  );
  await symlink(oldRelease, currentLink, "junction");

  const state = {
    running: true,
    ready: true,
    draining: false,
    version: "1.0.0",
    commit: "old-good",
    activeChatPolls,
  };
  const events = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/healthz") {
        if (!state.running) {
          sendJson(response, 503, { ok: false, ready: false });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          version: state.version,
          commit: state.commit,
          ready: state.ready,
          draining: state.draining,
          activeTerminals: 0,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/chat/turns/active") {
        const active = state.running && state.activeChatPolls > 0;
        events.push({ type: "chat-poll", active, mode: chatApiMode });
        if (chatApiMode === "unavailable") {
          sendJson(response, 503, { error: "chat API unavailable" });
          return;
        }
        if (chatApiMode === "malformed") {
          sendJson(response, 200, { turns: [] });
          return;
        }
        if (active) state.activeChatPolls -= 1;
        sendJson(response, 200, active ? [{ id: 42, status: "running" }] : []);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/admin/drain") {
        const body = await readJson(request);
        state.draining = Boolean(body.draining);
        events.push({ type: "drain", value: state.draining, ttlSeconds: body.ttlSeconds });
        sendJson(response, 200, { draining: state.draining });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/terminals") {
        events.push({ type: "probe", version: state.version, commit: state.commit });
        if (!state.running || state.draining) {
          sendJson(response, 503, { error: "unavailable" });
        } else {
          sendJson(response, 400, { error: "fixture account" });
        }
        return;
      }
      if (request.method === "POST" && url.pathname === "/__harness/stop") {
        events.push({ type: "stop", version: state.version, commit: state.commit });
        state.running = false;
        state.ready = false;
        state.draining = false;
        sendJson(response, 200, { stopped: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/__harness/start") {
        const body = await readJson(request);
        state.running = true;
        state.ready = true;
        state.draining = false;
        state.version = String(body.version);
        state.commit = String(body.runtimeCommit || body.commit);
        events.push({
          type: "start",
          version: state.version,
          commit: state.commit,
          advertisedCommit: String(body.commit),
        });
        sendJson(response, 200, { started: true });
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const controlBase = `http://127.0.0.1:${address.port}`;

  let result;
  try {
    result = await runPowerShell([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      wrapperPath,
      "-Updater",
      updater,
      "-AppData",
      appData,
      "-LocalAppData",
      localAppData,
      "-ControlBase",
      controlBase,
      "-Port",
      String(address.port),
      "-CandidateExe",
      candidate.exe,
      "-CandidateDist",
      candidate.dist,
      "-VerifyTimeoutSec",
      expectSuccess ? "4" : "1",
    ], name);
  } finally {
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  equal(result.code, expectSuccess ? 0 : 1, `${name}: code de sortie inattendu\n${diagnostic}`);

  const drain = eventIndex(events, (event) => event.type === "drain" && event.value === true);
  const firstStop = eventIndex(events, (event) => event.type === "stop", drain);
  const candidateStart = eventIndex(
    events,
    (event) => event.type === "start" && event.advertisedCommit === candidateCommit,
    firstStop,
  );
  const activeTarget = await realpath(currentLink);
  const releaseNames = (await readdir(releasesDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (chatApiMode !== "ok") {
    check(
      events.some((event) => event.type === "chat-poll" && event.mode === chatApiMode),
      `${name}: la defaillance de l'API chat doit etre exercee`,
    );
    equal(drain, -1, `${name}: aucun drain ne doit etre arme`);
    equal(firstStop, -1, `${name}: aucun arret ne doit etre demande`);
    equal(
      eventIndex(events, (event) => event.type === "start"),
      -1,
      `${name}: aucun redemarrage ne doit etre demande`,
    );
    equal(canonical(activeTarget), canonical(oldRelease), `${name}: current ne doit pas basculer`);
    check(existsSync(oldRelease), `${name}: la release active doit etre conservee`);
    check(existsSync(staleRelease), `${name}: aucune purge ne doit etre lancee`);
    equal(
      releaseNames.filter((entry) => entry.startsWith(`${candidateVersion}-${candidateCommit}`)).length,
      0,
      `${name}: la candidate preparee doit etre nettoyee`,
    );
    check(state.running && state.ready && !state.draining, `${name}: le noeud doit rester disponible`);
    equal(state.commit, "old-good", `${name}: le commit actif doit rester inchange`);
    check(
      chatApiMode === "unavailable"
        ? /Impossible de verifier les tours de chat actifs/.test(diagnostic)
        : /Reponse invalide pour les tours de chat actifs/.test(diagnostic),
      `${name}: le diagnostic doit identifier l'API chat`,
    );
    return { name, events: events.map((event) => event.type) };
  }

  check(drain >= 0, `${name}: le drain doit etre active`);
  equal(events[drain]?.ttlSeconds, 5, `${name}: la lease de drain doit etre bornee`);
  check(firstStop > drain, `${name}: le serveur doit etre arrete apres le drain`);
  check(candidateStart > firstStop, `${name}: la candidate doit demarrer apres la bascule`);
  if (activeChatPolls > 0) {
    const busyChatPoll = eventIndex(events, (event) => event.type === "chat-poll" && event.active);
    const idleChatPoll = eventIndex(
      events,
      (event) => event.type === "chat-poll" && !event.active,
      busyChatPoll,
    );
    check(busyChatPoll >= 0, `${name}: le tour de chat actif doit etre observe`);
    check(idleChatPoll > busyChatPoll, `${name}: l'updater doit attendre que le tour se termine`);
    check(drain > idleChatPoll, `${name}: le drain ne doit commencer qu'apres le tour actif`);
  }

  if (expectSuccess) {
    const probe = eventIndex(
      events,
      (event) => event.type === "probe" && event.commit === candidateCommit,
      candidateStart,
    );
    check(probe > candidateStart, `${name}: la candidate doit accepter la sonde finale`);
    check(
      path.basename(activeTarget).startsWith(`${candidateVersion}-${candidateCommit}`),
      `${name}: current doit cibler la nouvelle release`,
    );
    equal(releaseNames.length, 1, `${name}: seule la release valide doit rester`);
    equal(releaseNames[0], path.basename(activeTarget), `${name}: la purge doit conserver current`);
    check(!existsSync(oldRelease), `${name}: l'ancienne release doit etre purgee apres verification`);
    check(!existsSync(staleRelease), `${name}: la release obsolete doit etre purgee`);
    check(
      !existsSync(path.join(activeTarget, ".update-in-progress")),
      `${name}: le marqueur de mise a jour doit etre retire`,
    );
    check(state.running && state.commit === candidateCommit, `${name}: la candidate doit rester saine`);
  } else {
    const rollbackStop = eventIndex(
      events,
      (event) => event.type === "stop" && event.commit === runtimeCommit,
      candidateStart,
    );
    const rollbackStart = eventIndex(
      events,
      (event) => event.type === "start" && event.commit === "old-good",
      rollbackStop,
    );
    const rollbackProbe = eventIndex(
      events,
      (event) => event.type === "probe" && event.commit === "old-good",
      rollbackStart,
    );
    check(rollbackStop > candidateStart, `${name}: la candidate malsaine doit etre arretee`);
    check(rollbackStart > rollbackStop, `${name}: l'ancienne release doit etre redemarree`);
    check(rollbackProbe > rollbackStart, `${name}: le rollback doit etre sonde`);
    equal(canonical(activeTarget), canonical(oldRelease), `${name}: current doit etre restaure`);
    check(existsSync(oldRelease), `${name}: la release precedente doit etre conservee`);
    check(existsSync(staleRelease), `${name}: aucune purge ne doit preceder une verification reussie`);
    equal(
      releaseNames.filter((entry) => entry.startsWith(`${candidateVersion}-${candidateCommit}`)).length,
      0,
      `${name}: la candidate echouee doit etre nettoyee`,
    );
    check(state.running && state.ready && !state.draining, `${name}: le noeud restaure doit etre disponible`);
    equal(state.commit, "old-good", `${name}: le commit precedent doit etre restaure`);
    check(/Rollback OK/.test(diagnostic), `${name}: la restauration doit etre confirmee`);
  }

  return { name, events: events.map((event) => event.type) };
}

async function runConcurrencyScenario() {
  const name = "concurrent-switch";
  const scenarioRoot = path.join(testRoot, name);
  const appData = path.join(scenarioRoot, "appdata");
  const localAppData = path.join(scenarioRoot, "localappdata");
  const nodeHome = path.join(localAppData, "codex-switch-terminal-node");
  const releasesDir = path.join(nodeHome, "releases");
  const currentLink = path.join(nodeHome, "current");
  const oldRelease = path.join(releasesDir, "1.0.0-old-good");
  const obsoleteRelease = path.join(releasesDir, "0.9.0-obsolete");
  const protectedRelease = path.join(releasesDir, "0.8.0-active-marker");
  const staleMarkerRelease = path.join(releasesDir, "0.7.0-stale-marker");
  const envDir = path.join(appData, "codex-switch-terminal-server");
  const winnerLockedPath = path.join(scenarioRoot, "winner-locked");
  const allowWinnerPath = path.join(scenarioRoot, "allow-winner");

  await mkdir(releasesDir, { recursive: true });
  await mkdir(envDir, { recursive: true });
  await writeFile(
    path.join(envDir, "server.local.env.ps1"),
    '$env:CST_ADMIN_TOKEN = "update-runtime-local-proof"\n',
  );
  await writeRelease(oldRelease, "1.0.0", "old-good");
  await mkdir(obsoleteRelease, { recursive: true });
  await writeFile(path.join(obsoleteRelease, "obsolete.txt"), "obsolete\n");
  await mkdir(protectedRelease, { recursive: true });
  await writeFile(
    path.join(protectedRelease, ".update-in-progress"),
    `${process.pid}|${getProcessStartTicks(process.pid)}`,
  );
  await mkdir(staleMarkerRelease, { recursive: true });
  await writeFile(path.join(staleMarkerRelease, ".update-in-progress"), "99999999|1");
  const winnerCandidate = await writeRelease(
    path.join(scenarioRoot, "winner-candidate"),
    "3.0.0",
    "winner-good",
  );
  const contenderCandidate = await writeRelease(
    path.join(scenarioRoot, "contender-candidate"),
    "3.0.1",
    "contender-blocked",
  );
  const crashCandidate = await writeRelease(
    path.join(scenarioRoot, "crash-candidate"),
    "3.1.0",
    "crash-holder",
  );
  const recoveryCandidate = await writeRelease(
    path.join(scenarioRoot, "recovery-candidate"),
    "3.1.1",
    "recovery-good",
  );
  await symlink(oldRelease, currentLink, "junction");

  const state = {
    running: true,
    ready: true,
    draining: false,
    version: "1.0.0",
    commit: "old-good",
  };
  const events = [];
  let pauseNextHealth = false;
  let healthGate = Promise.resolve();
  let releasePausedHealth = () => {};
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/healthz") {
        if (pauseNextHealth) {
          pauseNextHealth = false;
          events.push({ type: "health-paused" });
          await healthGate;
        }
        if (!state.running) {
          sendJson(response, 503, { ok: false, ready: false });
          return;
        }
        sendJson(response, 200, {
          ok: true,
          version: state.version,
          commit: state.commit,
          ready: state.ready,
          draining: state.draining,
          activeTerminals: 0,
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/api/chat/turns/active") {
        events.push({ type: "chat-poll" });
        sendJson(response, 200, []);
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/admin/drain") {
        const body = await readJson(request);
        state.draining = Boolean(body.draining);
        events.push({ type: "drain", value: state.draining, ttlSeconds: body.ttlSeconds });
        sendJson(response, 200, { draining: state.draining });
        return;
      }
      if (request.method === "POST" && url.pathname === "/api/terminals") {
        events.push({ type: "probe", version: state.version, commit: state.commit });
        sendJson(response, state.running && !state.draining ? 400 : 503, {
          error: "harness probe",
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/__harness/stop") {
        events.push({ type: "stop", version: state.version, commit: state.commit });
        state.running = false;
        state.ready = false;
        state.draining = false;
        sendJson(response, 200, { stopped: true });
        return;
      }
      if (request.method === "POST" && url.pathname === "/__harness/start") {
        const body = await readJson(request);
        state.running = true;
        state.ready = true;
        state.draining = false;
        state.version = String(body.version);
        state.commit = String(body.runtimeCommit || body.commit);
        events.push({
          type: "start",
          version: state.version,
          commit: state.commit,
          advertisedCommit: String(body.commit),
        });
        sendJson(response, 200, { started: true });
        return;
      }
      sendJson(response, 404, { error: "not found" });
    } catch (error) {
      sendJson(response, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  const controlBase = `http://127.0.0.1:${address.port}`;
  const updaterArgs = (candidate, role) => [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    wrapperPath,
    "-Updater",
    updater,
    "-AppData",
    appData,
    "-LocalAppData",
    localAppData,
    "-ControlBase",
    controlBase,
    "-Port",
    String(address.port),
    "-CandidateExe",
    candidate.exe,
    "-CandidateDist",
    candidate.dist,
    "-VerifyTimeoutSec",
    "4",
    "-Role",
    role,
    "-WinnerLockedPath",
    winnerLockedPath,
    "-AllowWinnerPath",
    allowWinnerPath,
  ];

  let winnerRun;
  let contenderRun;
  let crashRun;
  let recoveryRun;
  try {
    winnerRun = startPowerShell(updaterArgs(winnerCandidate, "winner"), "concurrency-winner", 45_000);
    await waitForValue(
      () => existsSync(winnerLockedPath),
      "le gagnant n'a pas signale le mutex",
      30_000,
    );
    check(
      winnerRun.child.exitCode === null && winnerRun.child.signalCode === null,
      "concurrent-switch: le gagnant doit rester vivant sous mutex",
    );
    check(
      events.some((event) => event.type === "start" && event.commit === "winner-good"),
      "concurrent-switch: le gagnant doit atteindre le redemarrage sous mutex",
    );

    pauseNextHealth = true;
    healthGate = new Promise((resolve) => { releasePausedHealth = resolve; });
    contenderRun = startPowerShell(
      updaterArgs(contenderCandidate, "contender"),
      "concurrency-contender",
      30_000,
    );
    await waitForValue(
      () => events.some((event) => event.type === "health-paused"),
      "le concurrent n'a pas atteint la sonde bloquee",
      30_000,
    );
    const contenderRelease = await waitForValue(async () => {
      const names = await readdir(releasesDir);
      const releaseName = names.find((entry) => entry.startsWith("3.0.1-contender-blocked"));
      if (!releaseName) return null;
      const releasePath = path.join(releasesDir, releaseName);
      return existsSync(path.join(releasePath, ".update-in-progress")) ? releasePath : null;
    }, "le marqueur du concurrent n'a pas ete observe", 30_000);
    const marker = (await readFile(
      path.join(contenderRelease, ".update-in-progress"),
      "utf8",
    )).trim().split("|");
    equal(marker.length, 2, "concurrent-switch: le marqueur concurrent doit etre complet");
    equal(
      Number(marker[0]),
      contenderRun.child.pid,
      "concurrent-switch: le marqueur doit appartenir au second updater",
    );
    equal(
      marker[1],
      getProcessStartTicks(contenderRun.child.pid),
      "concurrent-switch: le marqueur doit porter l'identite exacte du processus",
    );
    check(
      contenderRun.child.exitCode === null && winnerRun.child.exitCode === null,
      "concurrent-switch: les deux updaters doivent se chevaucher reellement",
    );

    releasePausedHealth();
    const contenderResult = await contenderRun.result;
    const contenderDiagnostic = `${contenderResult.stdout}\n${contenderResult.stderr}`;
    equal(
      contenderResult.code,
      1,
      `concurrent-switch: le concurrent doit echouer sur la contention\n${contenderDiagnostic}`,
    );
    check(
      /Une autre mise a jour effectue deja la bascule/.test(contenderDiagnostic),
      "concurrent-switch: le diagnostic de contention doit etre explicite",
    );
    check(
      !existsSync(contenderRelease),
      "concurrent-switch: la release abandonnee du concurrent doit etre nettoyee",
    );
    equal(
      events.filter((event) => event.type === "drain" && event.value === true).length,
      1,
      "concurrent-switch: le concurrent ne doit pas armer un second drain",
    );
    equal(
      events.filter((event) => event.type === "start").length,
      1,
      "concurrent-switch: le concurrent ne doit pas redemarrer le service",
    );

    await writeFile(allowWinnerPath, "continue\n");
    const winnerResult = await winnerRun.result;
    const winnerDiagnostic = `${winnerResult.stdout}\n${winnerResult.stderr}`;
    equal(
      winnerResult.code,
      0,
      `concurrent-switch: le gagnant doit terminer avec succes\n${winnerDiagnostic}`,
    );
    check(
      winnerDiagnostic.includes(
        "Release conservee car une mise a jour l'utilise: 0.8.0-active-marker",
      ),
      "concurrent-switch: la purge doit tracer la protection du marqueur actif",
    );

    const activeTarget = await realpath(currentLink);
    const releaseNames = (await readdir(releasesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    check(
      path.basename(activeTarget).startsWith("3.0.0-winner-good"),
      "concurrent-switch: current doit cibler la release gagnante",
    );
    check(existsSync(protectedRelease), "concurrent-switch: la release au marqueur actif doit rester");
    check(
      existsSync(path.join(protectedRelease, ".update-in-progress")),
      "concurrent-switch: le marqueur actif ne doit pas etre retire",
    );
    check(
      !existsSync(staleMarkerRelease),
      "concurrent-switch: la release au marqueur perime doit etre purgee",
    );
    check(!existsSync(oldRelease), "concurrent-switch: l'ancienne release active doit etre purgee");
    check(!existsSync(obsoleteRelease), "concurrent-switch: la release obsolete doit etre purgee");
    check(
      !existsSync(path.join(activeTarget, ".update-in-progress")),
      "concurrent-switch: le marqueur du gagnant doit etre retire",
    );
    equal(releaseNames.length, 2, "concurrent-switch: seules gagnante et release protegee doivent rester");
    equal(
      releaseNames.filter((entry) => entry.startsWith("3.0.1-contender-blocked")).length,
      0,
      "concurrent-switch: aucune release concurrente ne doit subsister",
    );
    equal(
      events.filter((event) => event.type === "stop").length,
      1,
      "concurrent-switch: un seul arret doit avoir lieu",
    );
    check(
      events.some((event) => event.type === "probe" && event.commit === "winner-good"),
      "concurrent-switch: la gagnante doit etre verifiee avant la purge",
    );
    check(
      state.running && state.ready && !state.draining && state.commit === "winner-good",
      "concurrent-switch: le noeud gagnant doit rester sain et ouvert",
    );

    const mutexProbe = await runPowerShell([
      "-NoProfile",
      "-Command",
      `$mutex = [Threading.Mutex]::new($false, "Local\\CST-Deploy-${address.port}"); `
        + "$held = $false; $code = 0; try { $held = $mutex.WaitOne(0); if (-not $held) { $code = 2 } } "
        + "catch [Threading.AbandonedMutexException] { $held = $true } finally { "
        + "if ($held) { $mutex.ReleaseMutex() }; $mutex.Dispose() }; exit $code",
    ], "concurrency-mutex-reuse");
    equal(mutexProbe.code, 0, "concurrent-switch: le mutex doit etre reutilisable apres les deux sorties");

    await rm(winnerLockedPath, { force: true });
    await rm(allowWinnerPath, { force: true });
    const startsBeforeCrash = events.filter((event) => event.type === "start").length;
    crashRun = startPowerShell(
      updaterArgs(crashCandidate, "crash-holder"),
      "abandoned-mutex-holder",
      45_000,
    );
    await waitForValue(
      () => existsSync(winnerLockedPath),
      "le detenteur a tuer n'a pas atteint la bascule sous mutex",
      30_000,
    );
    check(
      crashRun.child.exitCode === null && crashRun.child.signalCode === null,
      "abandoned-mutex-recovery: le detenteur doit etre vivant sous mutex",
    );

    const crashedTarget = await realpath(currentLink);
    check(
      path.basename(crashedTarget).startsWith("3.1.0-crash-holder"),
      "abandoned-mutex-recovery: current doit avoir bascule avant le crash",
    );
    check(
      !state.running && !state.ready,
      "abandoned-mutex-recovery: le crash doit survenir pendant l'indisponibilite de bascule",
    );
    const crashedMarkerPath = path.join(crashedTarget, ".update-in-progress");
    check(
      existsSync(crashedMarkerPath),
      "abandoned-mutex-recovery: le marqueur du detenteur doit exister avant le crash",
    );
    const crashedMarker = (await readFile(crashedMarkerPath, "utf8")).trim().split("|");
    equal(crashedMarker.length, 2, "abandoned-mutex-recovery: le marqueur doit etre complet");
    equal(
      Number(crashedMarker[0]),
      crashRun.child.pid,
      "abandoned-mutex-recovery: le marqueur doit appartenir au detenteur tue",
    );
    equal(
      crashedMarker[1],
      getProcessStartTicks(crashRun.child.pid),
      "abandoned-mutex-recovery: le marqueur doit identifier exactement le detenteur",
    );

    check(
      crashRun.child.kill("SIGKILL"),
      "abandoned-mutex-recovery: le detenteur du mutex doit pouvoir etre tue",
    );
    const crashResult = await crashRun.result;
    check(
      crashResult.code !== 0 || crashResult.signal !== null,
      "abandoned-mutex-recovery: le detenteur ne doit pas sortir normalement",
    );
    check(
      existsSync(crashedMarkerPath),
      "abandoned-mutex-recovery: le crash doit laisser un marqueur perime",
    );
    equal(
      events.filter((event) => event.type === "start" && event.commit === "crash-holder").length,
      0,
      "abandoned-mutex-recovery: le service interrompu ne doit pas avoir redemarre",
    );

    recoveryRun = startPowerShell(
      updaterArgs(recoveryCandidate, "recovery"),
      "abandoned-mutex-recovery",
      45_000,
    );
    const recoveryResult = await recoveryRun.result;
    const recoveryDiagnostic = `${recoveryResult.stdout}\n${recoveryResult.stderr}`;
    equal(
      recoveryResult.code,
      0,
      `abandoned-mutex-recovery: le successeur doit reprendre le mutex abandonne\n${recoveryDiagnostic}`,
    );
    check(
      /OK : noeud en 3\.1\.1 \(recovery-good\), pret et non draine\./.test(recoveryDiagnostic),
      "abandoned-mutex-recovery: la reprise doit confirmer la disponibilite exacte",
    );

    const recoveredTarget = await realpath(currentLink);
    const recoveredReleaseNames = (await readdir(releasesDir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    check(
      path.basename(recoveredTarget).startsWith("3.1.1-recovery-good"),
      "abandoned-mutex-recovery: current doit cibler la release de reprise",
    );
    check(
      !existsSync(crashedTarget),
      "abandoned-mutex-recovery: la release au marqueur perime doit etre nettoyee",
    );
    check(
      !existsSync(path.join(recoveredTarget, ".update-in-progress")),
      "abandoned-mutex-recovery: le marqueur du successeur doit etre retire",
    );
    check(
      existsSync(protectedRelease) && existsSync(path.join(protectedRelease, ".update-in-progress")),
      "abandoned-mutex-recovery: une release encore utilisee doit rester protegee",
    );
    equal(
      recoveredReleaseNames.length,
      2,
      "abandoned-mutex-recovery: seules reprise et release protegee doivent rester",
    );
    equal(
      events.filter((event) => event.type === "start").length,
      startsBeforeCrash + 1,
      "abandoned-mutex-recovery: seul le successeur doit redemarrer apres le crash",
    );
    check(
      events.some((event) => event.type === "probe" && event.commit === "recovery-good"),
      "abandoned-mutex-recovery: la release de reprise doit etre sondee",
    );
    check(
      state.running && state.ready && !state.draining && state.commit === "recovery-good",
      "abandoned-mutex-recovery: le noeud doit etre sain, disponible et ouvert",
    );

    const recoveredMutexProbe = await runPowerShell([
      "-NoProfile",
      "-Command",
      `$mutex = [Threading.Mutex]::new($false, "Local\\CST-Deploy-${address.port}"); `
        + "$held = $false; $code = 0; try { $held = $mutex.WaitOne(0); if (-not $held) { $code = 2 } } "
        + "catch [Threading.AbandonedMutexException] { $held = $true } finally { "
        + "if ($held) { $mutex.ReleaseMutex() }; $mutex.Dispose() }; exit $code",
    ], "abandoned-mutex-final-reuse");
    equal(
      recoveredMutexProbe.code,
      0,
      "abandoned-mutex-recovery: le mutex doit rester reutilisable apres la reprise",
    );

    return { name, events: events.map((event) => event.type) };
  } finally {
    releasePausedHealth();
    if (!existsSync(allowWinnerPath)) {
      await writeFile(allowWinnerPath, "cleanup\n").catch(() => {});
    }
    terminatePowerShell(recoveryRun);
    terminatePowerShell(crashRun);
    terminatePowerShell(contenderRun);
    terminatePowerShell(winnerRun);
    await Promise.allSettled(
      [recoveryRun?.result, crashRun?.result, contenderRun?.result, winnerRun?.result].filter(Boolean),
    );
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
}

try {
  await writeFile(
    stubSourcePath,
    String.raw`using System;
using System.IO;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 1 || args[0] != "--version") return 64;
        string config = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "dist", "harness-release.txt");
        string[] lines = File.ReadAllLines(config);
        if (lines.Length < 2) return 65;
        Console.WriteLine("cst-server {0} ({1})", lines[0].Trim(), lines[1].Trim());
        return 0;
    }
}
`,
  );
  const compile = spawnSync(csc, [
    "/nologo",
    "/optimize+",
    "/target:exe",
    `/out:${stubExePath}`,
    stubSourcePath,
  ], { encoding: "utf8", windowsHide: true });
  if (compile.status !== 0 || !existsSync(stubExePath)) {
    throw new Error(`Compilation de la fixture impossible:\n${compile.stdout}\n${compile.stderr}`);
  }

  await writeFile(
    wrapperPath,
    String.raw`param(
  [Parameter(Mandatory = $true)][string]$Updater,
  [Parameter(Mandatory = $true)][string]$AppData,
  [Parameter(Mandatory = $true)][string]$LocalAppData,
  [Parameter(Mandatory = $true)][string]$ControlBase,
  [Parameter(Mandatory = $true)][int]$Port,
  [Parameter(Mandatory = $true)][string]$CandidateExe,
  [Parameter(Mandatory = $true)][string]$CandidateDist,
  [Parameter(Mandatory = $true)][int]$VerifyTimeoutSec,
  [string]$Role = "single",
  [string]$WinnerLockedPath = "",
  [string]$AllowWinnerPath = ""
)

$ErrorActionPreference = "Stop"
$env:APPDATA = $AppData
$env:LOCALAPPDATA = $LocalAppData

function Wait-HarnessMutexGate {
  Set-Content -LiteralPath $WinnerLockedPath -Value "locked" -Encoding ASCII
  $harnessDeadline = (Get-Date).AddSeconds(15)
  while (-not (Test-Path -LiteralPath $AllowWinnerPath) -and (Get-Date) -lt $harnessDeadline) {
    Start-Sleep -Milliseconds 50
  }
  if (-not (Test-Path -LiteralPath $AllowWinnerPath)) {
    throw "Le harnais n'a pas libere le detenteur sous mutex."
  }
}

function Get-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskName)
  return [pscustomobject]@{ TaskName = $TaskName }
}

function Stop-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskName)
  Invoke-RestMethod -Uri "$ControlBase/__harness/stop" -Method Post -ContentType "application/json" -Body "{}" -TimeoutSec 3 | Out-Null
}

function Start-ScheduledTask {
  [CmdletBinding()]
  param([string]$TaskName)
  $config = Join-Path $LocalAppData "codex-switch-terminal-node\current\dist\harness-release.txt"
  $lines = @(Get-Content -LiteralPath $config)
  if ($lines.Count -lt 2) { throw "Fixture de release invalide: $config" }
  $runtimeCommit = if ($lines.Count -ge 3) { [string]$lines[2] } else { [string]$lines[1] }
  if ($Role -eq "crash-holder" -and $WinnerLockedPath -and $AllowWinnerPath) {
    Wait-HarnessMutexGate
  }
  $body = @{
    version = [string]$lines[0]
    commit = [string]$lines[1]
    runtimeCommit = $runtimeCommit
  } | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$ControlBase/__harness/start" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 3 | Out-Null
  if ($Role -eq "winner" -and $WinnerLockedPath -and $AllowWinnerPath) {
    Wait-HarnessMutexGate
  }
}

function New-ScheduledTaskAction {
  [CmdletBinding()]
  param([string]$Execute, [string]$Argument)
  return [pscustomobject]@{ Execute = $Execute; Argument = $Argument }
}

function New-ScheduledTaskTrigger {
  [CmdletBinding()]
  param([switch]$AtLogOn, [string]$User)
  return [pscustomobject]@{ AtLogOn = [bool]$AtLogOn; User = $User }
}

function New-ScheduledTaskSettingsSet {
  [CmdletBinding()]
  param(
    [switch]$AllowStartIfOnBatteries,
    [switch]$DontStopIfGoingOnBatteries,
    [switch]$StartWhenAvailable,
    [int]$RestartCount,
    [TimeSpan]$RestartInterval,
    [TimeSpan]$ExecutionTimeLimit
  )
  return [pscustomobject]@{ RestartCount = $RestartCount }
}

function New-ScheduledTaskPrincipal {
  [CmdletBinding()]
  param([string]$UserId, [object]$LogonType, [object]$RunLevel)
  return [pscustomobject]@{ UserId = $UserId }
}

function Register-ScheduledTask {
  [CmdletBinding()]
  param(
    [string]$TaskName,
    [object]$Action,
    [object]$Trigger,
    [object]$Settings,
    [object]$Principal,
    [string]$Description,
    [switch]$Force
  )
  return [pscustomobject]@{ TaskName = $TaskName }
}

& $Updater -Port $Port -TaskName "CST Update Runtime $PID" -DrainTimeoutSec 3 -DrainLeaseSec 5 -StopTimeoutSec 1 -VerifyTimeoutSec $VerifyTimeoutSec -SkipBuild -BuiltExePath $CandidateExe -BuiltDistPath $CandidateDist
exit $LASTEXITCODE
`,
  );

  const covered = [];
  const coveredFeatures = [];
  if (!concurrencyOnly) {
    covered.push(await runScenario({
      name: "success-prune",
      candidateVersion: "2.0.0",
      candidateCommit: "new-good",
      runtimeCommit: "new-good",
      expectSuccess: true,
    }));
    covered.push(await runScenario({
      name: "wait-active-chat-turn",
      candidateVersion: "2.0.1",
      candidateCommit: "new-after-chat",
      runtimeCommit: "new-after-chat",
      expectSuccess: true,
      activeChatPolls: 1,
    }));
    covered.push(await runScenario({
      name: "failed-switch-rollback",
      candidateVersion: "2.1.0",
      candidateCommit: "new-bad",
      runtimeCommit: "broken-health",
      expectSuccess: false,
    }));
    covered.push(await runScenario({
      name: "chat-api-unavailable",
      candidateVersion: "2.2.0",
      candidateCommit: "must-not-switch-unavailable",
      runtimeCommit: "must-not-switch-unavailable",
      expectSuccess: false,
      chatApiMode: "unavailable",
    }));
    covered.push(await runScenario({
      name: "chat-api-malformed",
      candidateVersion: "2.2.1",
      candidateCommit: "must-not-switch-malformed",
      runtimeCommit: "must-not-switch-malformed",
      expectSuccess: false,
      chatApiMode: "malformed",
    }));
    coveredFeatures.push(
      "bounded-drain",
      "active-chat-drain",
      "switch",
      "post-switch-verification-failure",
      "rollback",
      "verified-release-pruning",
      "failed-release-cleanup",
      "chat-api-unavailable-fail-closed",
      "chat-api-malformed-fail-closed",
    );
  }
  covered.push(await runConcurrencyScenario());
  coveredFeatures.push(
    "windows-update-mutex",
    "concurrent-updater-contention",
    "active-release-marker-protection",
    "stale-release-marker-cleanup",
    "contender-release-cleanup",
    "mutex-reuse",
    "abandoned-mutex-recovery",
    "dead-owner-marker-cleanup",
    "crash-window-service-restoration",
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    scenarios: covered,
    covered: coveredFeatures,
  })}\n`);
} finally {
  try {
    await rm(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(`Temporary cleanup warning: ${error.message}\n`);
  }
}
