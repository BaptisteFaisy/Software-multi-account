import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

const tempRoot = await mkdtemp(path.join(workspace, ".tmp-private-messaging-runtime-"));
const dataDir = path.join(tempRoot, "data");
const staticDir = path.join(tempRoot, "static");
await Promise.all([mkdir(dataDir), mkdir(staticDir)]);

let assertions = 0;
let server = null;
let serverOutput = "";
let baseUrl = "";
const runtimeSockets = [];

const equal = (actual, expected, message) => {
  assert.equal(actual, expected, message);
  assertions += 1;
};

const ok = (condition, message) => {
  assert.ok(condition, message);
  assertions += 1;
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

const waitFor = async (predicate, message, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  ok(predicate(), message);
};

const openRuntimeSocket = (cookie) => new Promise((resolve, reject) => {
  const url = new URL(baseUrl);
  const socket = net.createConnection(Number(url.port), url.hostname);
  const state = { socket, messages: [], closed: false };
  let upgraded = false;
  let buffer = Buffer.alloc(0);

  const parseFrames = () => {
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        const wideLength = buffer.readBigUInt64BE(2);
        if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          socket.destroy(new Error("Trame WebSocket trop grande."));
          return;
        }
        length = Number(wideLength);
        offset = 10;
      }
      const maskBytes = masked ? 4 : 0;
      if (buffer.length < offset + maskBytes + length) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskBytes;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) {
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      if (opcode === 0x1) {
        try {
          state.messages.push(JSON.parse(payload.toString("utf8")));
        } catch {
          // Une trame non JSON ne peut pas declencher une fausse notification.
        }
      } else if (opcode === 0x8) {
        state.closed = true;
        socket.end();
      }
    }
  };

  socket.once("connect", () => {
    const key = randomBytes(16).toString("base64");
    socket.write([
      "GET /ws/runtime HTTP/1.1",
      `Host: ${url.host}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      `Origin: ${url.origin}`,
      `Cookie: ${cookie}`,
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "",
      "",
    ].join("\r\n"));
  });
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!upgraded) {
      const boundary = buffer.indexOf("\r\n\r\n");
      if (boundary < 0) return;
      const headers = buffer.subarray(0, boundary).toString("utf8");
      buffer = buffer.subarray(boundary + 4);
      if (!/^HTTP\/1\.1 101\b/.test(headers)) {
        reject(new Error(`Ouverture WebSocket refusee: ${headers.split("\r\n")[0]}`));
        socket.destroy();
        return;
      }
      upgraded = true;
      runtimeSockets.push(state);
      resolve(state);
    }
    parseFrames();
  });
  socket.once("error", (error) => {
    if (!upgraded) reject(error);
  });
  socket.once("close", () => {
    state.closed = true;
  });
});

const stopServer = async () => {
  if (!server || server.exitCode !== null) {
    server = null;
    return;
  }
  const stopped = new Promise((resolve) => server.once("exit", resolve));
  server.kill();
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
      CST_BIND: `127.0.0.1:${port}`,
      CST_DATA_DIR: dataDir,
      CST_STATIC_DIR: staticDir,
      CST_AUTH_SECURE_COOKIE: "false",
      CST_PUBLIC_BASE_URL: baseUrl,
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
      // Le socket peut refuser les connexions pendant les premieres millisecondes.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Le serveur n'est pas devenu disponible.\n${serverOutput}`);
};

const request = async (route, { method = "GET", cookie, body } = {}) => {
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
  return { response, value };
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
  equal(result.response.status, 201, `Inscription impossible pour ${username}`);
  return {
    cookie: sessionCookie(result.response),
    user: result.value.user,
  };
};

const login = async (identifier, password) => {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { identifier, password },
  });
  equal(result.response.status, 200, `Connexion impossible pour ${identifier}`);
  return sessionCookie(result.response);
};

const nonce = `${Date.now()}-${process.pid}`;
const alicePassword = `Alice-${nonce}-A1!`;
const bobPassword = `Bob-${nonce}-B1!`;

try {
  await startServer();

  const unauthorized = await request("/api/private-messages/users");
  equal(unauthorized.response.status, 401, "La liste des utilisateurs doit exiger une session.");

  const alice = await register(`Alice_${nonce}`, `alice_${nonce}@example.invalid`, alicePassword);
  const bob = await register(`Bob_${nonce}`, `bob_${nonce}@example.invalid`, bobPassword);
  const charlie = await register(`Charlie_${nonce}`, `charlie_${nonce}@example.invalid`, `Charlie-${nonce}-C1!`);

  const [aliceRuntime, bobRuntime, charlieRuntime] = await Promise.all([
    openRuntimeSocket(alice.cookie),
    openRuntimeSocket(bob.cookie),
    openRuntimeSocket(charlie.cookie),
  ]);
  await waitFor(
    () => [aliceRuntime, bobRuntime, charlieRuntime]
      .every((runtime) => runtime.messages.some((message) => message.type === "hello")),
    "Chaque utilisateur doit recevoir le hello runtime.",
  );
  const privateChangeCount = (runtime) => runtime.messages.filter((message) => (
    message.type === "change" && message.topic === "privateMessages"
  )).length;
  const directoryCounts = [aliceRuntime, bobRuntime, charlieRuntime].map(privateChangeCount);
  await register(`Dana_${nonce}`, `dana_${nonce}@example.invalid`, `Dana-${nonce}-D1!`);
  await waitFor(
    () => [aliceRuntime, bobRuntime, charlieRuntime].every(
      (runtime, index) => privateChangeCount(runtime) > directoryCounts[index],
    ),
    "Une inscription doit actualiser le catalogue de chaque utilisateur connecte.",
  );

  const users = await request("/api/private-messages/users", { cookie: alice.cookie });
  equal(users.response.status, 200, "La liste des destinataires doit etre disponible.");
  equal(users.response.headers.get("cache-control"), "no-store", "La liste privee ne doit pas etre mise en cache.");
  ok(users.value.some((user) => user.id === bob.user.id), "Bob doit etre visible par Alice.");
  ok(users.value.some((user) => user.id === charlie.user.id), "Charlie doit etre visible par Alice.");
  ok(users.value.some((user) => user.id === "server-admin"), "L'administrateur doit etre joignable.");
  ok(!users.value.some((user) => user.id === alice.user.id), "Alice ne doit pas pouvoir se choisir elle-meme.");
  ok(users.value.every((user) => !("email" in user)), "Les e-mails ne doivent pas etre exposes.");

  const selfMessage = await request(`/api/private-messages/conversations/${alice.user.id}`, {
    method: "POST",
    cookie: alice.cookie,
    body: { body: "auto-message" },
  });
  equal(selfMessage.response.status, 400, "Un auto-message doit etre refuse.");

  const unknownMessage = await request("/api/private-messages/conversations/utilisateur-inconnu", {
    method: "POST",
    cookie: alice.cookie,
    body: { body: "introuvable" },
  });
  equal(unknownMessage.response.status, 404, "Un destinataire inconnu doit etre refuse.");

  const emptyMessage = await request(`/api/private-messages/conversations/${bob.user.id}`, {
    method: "POST",
    cookie: alice.cookie,
    body: { body: "   " },
  });
  equal(emptyMessage.response.status, 400, "Un message vide doit etre refuse.");

  const oversizedMessage = await request(`/api/private-messages/conversations/${bob.user.id}`, {
    method: "POST",
    cookie: alice.cookie,
    body: { body: "x".repeat(4_001) },
  });
  equal(oversizedMessage.response.status, 400, "Un message de plus de 4 000 caracteres doit etre refuse.");

  const imageBase64 = Buffer.from("\x89PNG\r\n\x1a\nprivate-message-image", "binary").toString("base64");
  const invalidImage = await request(`/api/private-messages/conversations/${bob.user.id}`, {
    method: "POST",
    cookie: alice.cookie,
    body: {
      body: "",
      images: [{ name: "fausse.png", mimeType: "image/png", dataBase64: Buffer.from("fausse").toString("base64") }],
    },
  });
  equal(invalidImage.response.status, 400, "Une image dont la signature ne correspond pas au type doit etre refusee.");

  const beforeSend = [aliceRuntime, bobRuntime, charlieRuntime].map(privateChangeCount);
  const sent = await request(`/api/private-messages/conversations/${bob.user.id}`, {
    method: "POST",
    cookie: alice.cookie,
    body: {
      body: "  Secret entre Alice et Bob  ",
      images: [{ name: "preuve.png", mimeType: "image/png", dataBase64: imageBase64 }],
    },
  });
  equal(sent.response.status, 201, "Le message valide doit etre cree.");
  equal(sent.response.headers.get("cache-control"), "no-store", "Le message cree ne doit pas etre mis en cache.");
  equal(sent.value.body, "Secret entre Alice et Bob", "Le corps doit etre normalise.");
  equal(sent.value.sender.id, alice.user.id, "L'expediteur doit provenir de la session Alice.");
  equal(sent.value.recipient.id, bob.user.id, "Le destinataire doit etre Bob.");
  equal(sent.value.images.length, 1, "Le message doit exposer les metadonnees de l'image.");
  equal(sent.value.images[0].name, "preuve.png", "Le nom de l'image doit etre conserve.");
  const imageId = sent.value.images[0].id;
  const aliceImage = await request(`/api/private-messages/images/${imageId}`, { cookie: alice.cookie });
  equal(aliceImage.response.status, 200, "L'expeditrice doit pouvoir charger son image.");
  equal(aliceImage.value.dataBase64, imageBase64, "Les donnees de l'image doivent rester intactes.");
  const charlieImage = await request(`/api/private-messages/images/${imageId}`, { cookie: charlie.cookie });
  equal(charlieImage.response.status, 404, "Un tiers ne doit pas pouvoir charger une image privee.");
  await waitFor(
    () => privateChangeCount(aliceRuntime) > beforeSend[0]
      && privateChangeCount(bobRuntime) > beforeSend[1],
    "L'emetteur et le destinataire doivent recevoir le signal du message.",
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  equal(
    privateChangeCount(charlieRuntime),
    beforeSend[2],
    "Un tiers ne doit pas recevoir le signal d'une conversation privee.",
  );

  const bobBeforeRead = await request("/api/private-messages/conversations", { cookie: bob.cookie });
  equal(bobBeforeRead.response.status, 200, "Bob doit pouvoir lister ses conversations.");
  equal(bobBeforeRead.value.length, 1, "Bob doit voir exactement une conversation.");
  equal(bobBeforeRead.value[0].unreadCount, 1, "Le message recu doit etre non lu.");

  const charlieConversations = await request("/api/private-messages/conversations", { cookie: charlie.cookie });
  equal(charlieConversations.value.length, 0, "Charlie ne doit voir aucune conversation d'Alice et Bob.");
  const charlieAlice = await request(`/api/private-messages/conversations/${alice.user.id}`, { cookie: charlie.cookie });
  equal(charlieAlice.response.status, 200, "Charlie doit pouvoir demarrer son propre fil avec Alice.");
  equal(charlieAlice.value.messages.length, 0, "Le fil de Charlie ne doit pas exposer le secret Alice-Bob.");

  const beforeRead = [aliceRuntime, bobRuntime, charlieRuntime].map(privateChangeCount);
  const bobThread = await request(`/api/private-messages/conversations/${alice.user.id}`, { cookie: bob.cookie });
  equal(bobThread.response.status, 200, "Bob doit pouvoir ouvrir le fil avec Alice.");
  equal(bobThread.value.messages.length, 1, "Le fil Alice-Bob doit contenir le message envoye.");
  equal(bobThread.value.messages[0].body, "Secret entre Alice et Bob", "Le contenu persiste doit etre intact.");
  equal(bobThread.value.messages[0].images[0].id, imageId, "Le fil doit contenir l'image envoyee.");
  const bobImage = await request(`/api/private-messages/images/${imageId}`, { cookie: bob.cookie });
  equal(bobImage.response.status, 200, "Le destinataire doit pouvoir charger l'image privee.");
  ok(bobThread.value.messages[0].readAt !== null, "L'ouverture du fil doit marquer le message recu comme lu.");
  await waitFor(
    () => privateChangeCount(aliceRuntime) > beforeRead[0]
      && privateChangeCount(bobRuntime) > beforeRead[1],
    "L'accuse de lecture doit signaler les deux participants.",
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  equal(
    privateChangeCount(charlieRuntime),
    beforeRead[2],
    "Un tiers ne doit pas recevoir le signal d'un accuse de lecture.",
  );

  const bobAfterRead = await request("/api/private-messages/conversations", { cookie: bob.cookie });
  equal(bobAfterRead.value[0].unreadCount, 0, "Le compteur non lu doit etre remis a zero.");

  runtimeSockets.splice(0).forEach((runtime) => runtime.socket.destroy());

  await stopServer();
  await startServer();
  const bobCookieAfterRestart = await login(`bob_${nonce}@example.invalid`, bobPassword);
  const persistedThread = await request(`/api/private-messages/conversations/${alice.user.id}`, {
    cookie: bobCookieAfterRestart,
  });
  equal(persistedThread.response.status, 200, "Le fil doit rester accessible apres redemarrage.");
  equal(persistedThread.value.messages.length, 1, "Le message doit survivre au redemarrage.");
  equal(persistedThread.value.messages[0].images[0].id, imageId, "L'image doit survivre au redemarrage.");
  ok(persistedThread.value.messages[0].readAt !== null, "L'accuse de lecture doit survivre au redemarrage.");

  process.stdout.write(`${JSON.stringify({ assertions, restarts: 1, users: 4, isolatedRealtimeSignals: 2 }, null, 2)}\n`);
} finally {
  runtimeSockets.splice(0).forEach((runtime) => runtime.socket.destroy());
  await stopServer().catch(() => {});
  const safePrefix = `${workspace}${path.sep}`.toLowerCase();
  const safeTemp = tempRoot.toLowerCase().startsWith(safePrefix)
    && path.basename(tempRoot).startsWith(".tmp-private-messaging-runtime-");
  if (safeTemp) await rm(tempRoot, { recursive: true, force: true });
}
