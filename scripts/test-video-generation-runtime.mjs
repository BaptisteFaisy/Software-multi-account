import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const executable = process.env.CST_SERVER_EXE || path.join(
  workspace,
  "src-tauri",
  "target",
  "debug",
  process.platform === "win32" ? "cst-server.exe" : "cst-server",
);

if (!existsSync(executable)) {
  throw new Error(`Serveur introuvable : ${executable}`);
}

const tempRoot = await mkdtemp(path.join(workspace, ".tmp-video-generation-runtime-"));
const dataDir = path.join(tempRoot, "data");
const staticDir = path.join(tempRoot, "static");
await Promise.all([mkdir(dataDir), mkdir(staticDir)]);

const nonce = `${Date.now()}-${process.pid}`;
const accountAKey = `account-a-${nonce}:secret-a-${nonce}`;
const accountBKey = `account-b-${nonce}:secret-b-${nonce}`;
const rejectedKey = `rejected-${nonce}:secret-rejected-${nonce}`;
const acceptedKeys = new Set([accountAKey, accountBKey]);
const providerRequests = [];
const statusReads = new Map();
const failures = [];
let assertions = 0;
let server = null;
let serverOutput = "";
let baseUrl = "";
let provider = null;
let providerBaseUrl = "";

const equal = (actual, expected, message) => {
  assertions += 1;
  if (actual !== expected) {
    failures.push(`${message} (recu ${JSON.stringify(actual)}, attendu ${JSON.stringify(expected)})`);
  }
};

const ok = (condition, message) => {
  assertions += 1;
  if (!condition) failures.push(message);
};

const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once("error", reject);
  probe.listen(0, "127.0.0.1", () => {
    const address = probe.address();
    const port = typeof address === "object" && address ? address.port : 0;
    probe.close((error) => error ? reject(error) : resolve(port));
  });
});

const readBody = (request) => new Promise((resolve, reject) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  request.once("error", reject);
});

const providerJson = (response, status, value) => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
    connection: "close",
  });
  response.end(body);
};

const requestIdForPrompt = (prompt) => {
  if (prompt === "Cycle complet") return "video-cycle-1";
  if (prompt === "Annulation") return "video-cancel-1";
  if (prompt === "Etat inconnu") return "video-unknown-1";
  if (prompt === "Etat absent") return "video-missing-1";
  if (prompt === "Echec rendu") return "video-failed-1";
  return null;
};

const startProvider = async () => {
  const port = await freePort();
  providerBaseUrl = `http://127.0.0.1:${port}`;
  provider = http.createServer(async (request, response) => {
    const rawBody = await readBody(request);
    let body = null;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    const entry = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization || "",
      body,
    };
    providerRequests.push(entry);

    if (request.url === "/v1/models?limit=1" && request.method === "GET") {
      const key = entry.authorization.replace(/^Key\s+/, "");
      if (acceptedKeys.has(key)) {
        providerJson(response, 200, { models: [] });
      } else {
        providerJson(response, 401, { error: { message: `cle refusee ${key}` } });
      }
      return;
    }

    const queueRoot = "/wan/v2.6/text-to-video";
    if (request.url === queueRoot && request.method === "POST") {
      if (body?.prompt === "Provider degrade") {
        providerJson(response, 503, {
          error: { message: `provider indisponible pour ${accountAKey}` },
        });
        return;
      }
      const requestId = requestIdForPrompt(body?.prompt);
      if (!requestId) {
        providerJson(response, 200, {});
        return;
      }
      providerJson(response, 202, { request_id: requestId, queue_position: 2 });
      return;
    }

    const match = request.url?.match(/^\/wan\/v2\.6\/text-to-video\/requests\/([A-Za-z0-9_-]+)(\/status\?logs=1|\/cancel)?$/);
    if (!match) {
      providerJson(response, 404, { error: { message: "route mock inconnue" } });
      return;
    }
    const [, requestId, suffix = ""] = match;
    if (request.method === "PUT" && suffix === "/cancel") {
      providerJson(response, 200, { status: "CANCELLED" });
      return;
    }
    if (request.method === "GET" && suffix === "/status?logs=1") {
      const reads = (statusReads.get(requestId) || 0) + 1;
      statusReads.set(requestId, reads);
      if (requestId === "video-cycle-1") {
        providerJson(response, 200, reads === 1 ? {
          status: "IN_PROGRESS",
          logs: [
            { message: " rendu en cours " },
            { message: "x".repeat(700) },
            { message: "   " },
          ],
          metrics: { inference_time: 1.25 },
        } : { status: "COMPLETED", metrics: { inference_time: 2.5 } });
        return;
      }
      if (requestId === "video-unknown-1") {
        providerJson(response, 200, { status: "PAUSED" });
        return;
      }
      if (requestId === "video-missing-1") {
        providerJson(response, 200, { queue_position: 4 });
        return;
      }
      if (requestId === "video-failed-1") {
        providerJson(response, 200, {
          status: "FAILED",
          error: { message: "rendu refuse" },
        });
        return;
      }
      providerJson(response, 200, { status: "IN_QUEUE", queue_position: 1 });
      return;
    }
    if (request.method === "GET" && suffix === "") {
      providerJson(response, 200, {
        video: { url: "https://cdn.example.invalid/video-cycle-1.mp4" },
        actual_prompt: "Cycle complet enrichi",
        seed: 42,
      });
      return;
    }
    providerJson(response, 405, { error: { message: "methode mock invalide" } });
  });
  await new Promise((resolve, reject) => {
    provider.once("error", reject);
    provider.listen(port, "127.0.0.1", resolve);
  });
};

const stopProvider = async () => {
  if (!provider) return;
  const current = provider;
  provider = null;
  await new Promise((resolve) => current.close(resolve));
};

const stopServer = async () => {
  if (!server || server.exitCode !== null) {
    server = null;
    return;
  }
  const current = server;
  const stopped = new Promise((resolve) => current.once("exit", resolve));
  current.kill();
  await Promise.race([
    stopped,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error("Le serveur ne s'est pas arrete dans le delai imparti.")),
      5_000,
    )),
  ]);
  server = null;
};

const startServer = async () => {
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverOutput = "";
  server = spawn(executable, [], {
    cwd: workspace,
    env: {
      ...process.env,
      CST_ADMIN_TOKEN: `video-runtime-admin-${nonce}`,
      CST_ALLOW_REGISTRATION: "true",
      CST_AUTH_SECURE_COOKIE: "false",
      CST_BIND: `127.0.0.1:${port}`,
      CST_DATA_DIR: dataDir,
      CST_FAL_KEY: "",
      FAL_KEY: "",
      CST_PUBLIC_BASE_URL: baseUrl,
      CST_STATIC_DIR: staticDir,
      CST_TEST_FAL_API_BASE_URL: providerBaseUrl,
      CST_TEST_FAL_QUEUE_BASE_URL: providerBaseUrl,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const collect = (chunk) => {
    serverOutput = `${serverOutput}${chunk}`.slice(-16_000);
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Le serveur s'est arrete avant le test.\n${serverOutput}`);
    }
    try {
      const response = await fetch(`${baseUrl}/healthz`, {
        signal: AbortSignal.timeout(750),
      });
      if (response.ok) return;
    } catch {
      // Le socket peut refuser les connexions pendant le demarrage.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Le serveur n'est pas devenu disponible.\n${serverOutput}`);
};

const request = async (route, {
  method = "GET",
  cookie,
  body,
} = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  });
  const text = await response.text();
  let value = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = text;
    }
  }
  return { response, value, text };
};

const sessionCookie = (response) => {
  const header = response.headers.get("set-cookie") || "";
  const match = header.match(/(?:^|,\s*)cst_session=([^;]+)/);
  assert.ok(match, "Le cookie cst_session est absent.");
  return `cst_session=${match[1]}`;
};

const register = async (username, email, password) => {
  const result = await request("/api/auth/register", {
    method: "POST",
    body: { username, email, password },
  });
  assert.equal(result.response.status, 201, `Inscription impossible pour ${username}`);
  return { cookie: sessionCookie(result.response), user: result.value.user };
};

const login = async (identifier, password) => {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { identifier, password },
  });
  assert.equal(result.response.status, 200, `Connexion impossible pour ${identifier}`);
  return sessionCookie(result.response);
};

const videoRequest = (accountId, prompt) => ({
  accountId,
  modelId: "wan-2.6",
  mode: "text",
  prompt,
  imageUrl: null,
  aspectRatio: "16:9",
  duration: 5,
  resolution: "720p",
  generateAudio: false,
  negativePrompt: "filigrane",
});

const statusRequest = (accountId, requestId) => ({
  accountId,
  requestId,
  modelId: "wan-2.6",
  mode: "text",
});

const aliceEmail = `alice_video_${nonce}@example.invalid`;
const bobEmail = `bob_video_${nonce}@example.invalid`;
const alicePassword = `Alice-${nonce}-A1!`;
const bobPassword = `Bob-${nonce}-B1!`;

try {
  await startProvider();
  await startServer();

  const unauthorizedAccounts = await request("/api/creative/accounts");
  equal(unauthorizedAccounts.response.status, 401, "Les comptes creatifs doivent exiger une session.");
  for (const [route, method] of [
    ["/api/creative/accounts", "POST"],
    ["/api/creative/accounts/default", "POST"],
    ["/api/creative/accounts/delete", "POST"],
    ["/api/video/generations", "POST"],
    ["/api/video/generations/status", "POST"],
    ["/api/video/generations/cancel", "POST"],
  ]) {
    const malformed = await request(route, { method, body: {} });
    equal(
      malformed.response.status,
      401,
      `L'authentification doit preceder la validation JSON de ${route}.`,
    );
  }

  const alice = await register(`AliceVideo_${nonce}`, aliceEmail, alicePassword);
  const bob = await register(`BobVideo_${nonce}`, bobEmail, bobPassword);

  const initialAccounts = await request("/api/creative/accounts", { cookie: alice.cookie });
  equal(initialAccounts.response.status, 200, "Le catalogue des comptes doit etre accessible.");
  equal(initialAccounts.value.accounts.length, 0, "Le stockage isole doit demarrer sans compte.");

  const malformedAuthenticated = await request("/api/video/generations", {
    method: "POST",
    cookie: alice.cookie,
    body: {},
  });
  equal(malformedAuthenticated.response.status, 400, "Un JSON video incomplet doit retourner 400.");

  const rejected = await request("/api/creative/accounts", {
    method: "POST",
    cookie: alice.cookie,
    body: { label: "Refuse", apiKey: rejectedKey, makeDefault: true },
  });
  equal(rejected.response.status, 502, "Un compte refuse par le fournisseur doit retourner 502.");
  ok(!rejected.text.includes(rejectedKey), "Une erreur de connexion ne doit jamais exposer la cle fal.ai.");

  const connectedA = await request("/api/creative/accounts", {
    method: "POST",
    cookie: alice.cookie,
    body: { label: "Compte A", apiKey: accountAKey, makeDefault: true },
  });
  equal(connectedA.response.status, 200, "Le premier compte valide doit etre connecte.");
  equal(connectedA.value.accounts.length, 1, "Le premier compte doit etre liste une seule fois.");
  const accountA = connectedA.value.accounts[0];
  equal(accountA.isDefault, true, "Le premier compte doit devenir le compte par defaut.");
  ok(!JSON.stringify(connectedA.value).includes(accountAKey), "La vue des comptes ne doit pas exposer la cle complete.");

  const connectedB = await request("/api/creative/accounts", {
    method: "POST",
    cookie: alice.cookie,
    body: { label: "Compte B", apiKey: accountBKey, makeDefault: false },
  });
  equal(connectedB.response.status, 200, "Le second compte valide doit etre connecte.");
  equal(connectedB.value.accounts.length, 2, "Les deux comptes d'Alice doivent etre listes.");
  const accountB = connectedB.value.accounts.find((account) => account.label === "Compte B");
  assert.ok(accountB, "Le compte B connecte est absent.");

  const bobAccounts = await request("/api/creative/accounts", { cookie: bob.cookie });
  equal(bobAccounts.value.accounts.length, 0, "Bob ne doit voir aucun compte d'Alice.");
  const bobStealsDefault = await request("/api/creative/accounts/default", {
    method: "POST",
    cookie: bob.cookie,
    body: { accountId: accountA.id },
  });
  equal(bobStealsDefault.response.status, 400, "Bob ne doit pas selectionner un compte d'Alice.");

  const setDefaultB = await request("/api/creative/accounts/default", {
    method: "POST",
    cookie: alice.cookie,
    body: { accountId: accountB.id },
  });
  equal(setDefaultB.response.status, 200, "Alice doit pouvoir changer de compte par defaut.");
  equal(setDefaultB.value.defaultAccountId, accountB.id, "Le compte B doit devenir le compte par defaut.");
  const deleteB = await request("/api/creative/accounts/delete", {
    method: "POST",
    cookie: alice.cookie,
    body: { accountId: accountB.id },
  });
  equal(deleteB.response.status, 200, "Alice doit pouvoir deconnecter le compte B.");
  equal(deleteB.value.accounts.length, 1, "Le compte B doit disparaitre sans supprimer le compte A.");
  equal(deleteB.value.defaultAccountId, accountA.id, "Le compte A doit redevenir le compte par defaut.");

  await stopServer();
  await startServer();
  const aliceCookie = await login(aliceEmail, alicePassword);
  const persistedAccounts = await request("/api/creative/accounts", { cookie: aliceCookie });
  equal(persistedAccounts.value.accounts.length, 1, "Le compte A doit survivre au redemarrage.");
  equal(persistedAccounts.value.accounts[0].id, accountA.id, "L'identifiant du compte persiste doit rester stable.");

  const capabilities = await request("/api/video/capabilities", { cookie: aliceCookie });
  equal(capabilities.response.status, 200, "Les capacites video doivent etre disponibles.");
  equal(capabilities.value.configured, true, "Les capacites doivent detecter le compte persiste.");
  equal(capabilities.value.models.length, 4, "Les quatre modeles video autorises doivent etre exposes.");

  const providerCountBeforeInvalid = providerRequests.length;
  const invalidModel = await request("/api/video/generations", {
    method: "POST",
    cookie: aliceCookie,
    body: { ...videoRequest(accountA.id, "Modele interdit"), modelId: "modele-inconnu" },
  });
  equal(invalidModel.response.status, 400, "Un modele hors liste blanche doit etre refuse.");
  equal(providerRequests.length, providerCountBeforeInvalid, "Une requete invalide ne doit pas joindre le fournisseur.");

  const started = await request("/api/video/generations", {
    method: "POST",
    cookie: aliceCookie,
    body: videoRequest(accountA.id, "Cycle complet"),
  });
  equal(started.response.status, 200, "Le lancement video valide doit reussir.");
  equal(started.value.status, "queued", "Le lancement doit retourner l'etat queued.");
  equal(started.value.requestId, "video-cycle-1", "L'identifiant fournisseur doit etre conserve.");

  const bobTracksAlice = await request("/api/video/generations/status", {
    method: "POST",
    cookie: bob.cookie,
    body: statusRequest(accountA.id, started.value.requestId),
  });
  equal(bobTracksAlice.response.status, 400, "Bob ne doit pas suivre une generation du compte d'Alice.");

  const progressing = await request("/api/video/generations/status", {
    method: "POST",
    cookie: aliceCookie,
    body: statusRequest(accountA.id, started.value.requestId),
  });
  equal(progressing.response.status, 200, "Le premier suivi doit reussir.");
  equal(progressing.value.status, "in_progress", "Le fournisseur doit passer la video en cours.");
  equal(progressing.value.logs.length, 2, "Les journaux vides doivent etre retires.");
  equal(progressing.value.logs[1].length, 600, "Les journaux fournisseur doivent etre bornes.");

  const completed = await request("/api/video/generations/status", {
    method: "POST",
    cookie: aliceCookie,
    body: statusRequest(accountA.id, started.value.requestId),
  });
  equal(completed.response.status, 200, "Le suivi termine doit reussir.");
  equal(completed.value.status, "completed", "La video doit atteindre l'etat completed.");
  equal(completed.value.videoUrl, "https://cdn.example.invalid/video-cycle-1.mp4", "L'URL video finale doit etre restituee.");
  equal(completed.value.seed, 42, "La graine fournisseur doit etre restituee.");

  const cancelStart = await request("/api/video/generations", {
    method: "POST",
    cookie: aliceCookie,
    body: videoRequest(accountA.id, "Annulation"),
  });
  equal(cancelStart.response.status, 200, "La generation a annuler doit demarrer.");
  const cancelled = await request("/api/video/generations/cancel", {
    method: "POST",
    cookie: aliceCookie,
    body: statusRequest(accountA.id, cancelStart.value.requestId),
  });
  equal(cancelled.response.status, 200, "L'annulation fournisseur doit reussir.");
  equal(cancelled.value.status, "cancelled", "L'annulation doit retourner l'etat cancelled.");

  const failedStart = await request("/api/video/generations", {
    method: "POST",
    cookie: aliceCookie,
    body: videoRequest(accountA.id, "Echec rendu"),
  });
  const failed = await request("/api/video/generations/status", {
    method: "POST",
    cookie: aliceCookie,
    body: statusRequest(accountA.id, failedStart.value.requestId),
  });
  equal(failed.response.status, 200, "Un echec de rendu connu doit rester un etat de job lisible.");
  equal(failed.value.status, "failed", "L'echec fournisseur doit devenir l'etat failed.");
  equal(failed.value.error, "rendu refuse", "Le motif fournisseur doit etre restitue sans secret.");

  for (const [prompt, expectedRequestId] of [
    ["Etat inconnu", "video-unknown-1"],
    ["Etat absent", "video-missing-1"],
  ]) {
    const degradedStart = await request("/api/video/generations", {
      method: "POST",
      cookie: aliceCookie,
      body: videoRequest(accountA.id, prompt),
    });
    equal(degradedStart.response.status, 200, `${prompt} doit demarrer avant le suivi degrade.`);
    const degradedStatus = await request("/api/video/generations/status", {
      method: "POST",
      cookie: aliceCookie,
      body: statusRequest(accountA.id, expectedRequestId),
    });
    equal(
      degradedStatus.response.status,
      502,
      `${prompt} ne doit pas etre transforme en attente infinie.`,
    );
  }

  const providerDown = await request("/api/video/generations", {
    method: "POST",
    cookie: aliceCookie,
    body: videoRequest(accountA.id, "Provider degrade"),
  });
  equal(providerDown.response.status, 502, "Une panne fournisseur doit retourner 502.");
  ok(!providerDown.text.includes(accountAKey), "Une panne fournisseur ne doit pas recopier la cle API.");

  const queueRequests = providerRequests.filter((entry) => entry.url?.startsWith("/wan/"));
  ok(queueRequests.length >= 13, "Le mock doit avoir observe le cycle de generation complet.");
  ok(
    queueRequests.every((entry) => entry.authorization === `Key ${accountAKey}`),
    "Chaque appel de file doit utiliser uniquement le compte selectionne.",
  );
  ok(
    providerRequests.every((entry) => !String(entry.url).includes("secret-")),
    "Aucune cle ne doit etre placee dans une URL fournisseur.",
  );

  if (failures.length) {
    throw new Error(`Regressions video runtime (${failures.length}) :\n- ${failures.join("\n- ")}`);
  }

  process.stdout.write(`${JSON.stringify({
    assertions,
    restarts: 1,
    users: 2,
    accountsConnected: 2,
    providerRequests: providerRequests.length,
    generationScenarios: 6,
  }, null, 2)}\n`);
} finally {
  await stopServer().catch(() => {});
  await stopProvider().catch(() => {});
  const safePrefix = `${workspace}${path.sep}`.toLowerCase();
  const safeTemp = tempRoot.toLowerCase().startsWith(safePrefix)
    && path.basename(tempRoot).startsWith(".tmp-video-generation-runtime-");
  if (safeTemp) await rm(tempRoot, { recursive: true, force: true });
}
