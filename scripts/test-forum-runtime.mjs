import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
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

const tempRoot = await mkdtemp(path.join(workspace, ".tmp-forum-runtime-"));
const dataDir = path.join(tempRoot, "data");
const staticDir = path.join(tempRoot, "static");
await Promise.all([mkdir(dataDir), mkdir(staticDir)]);

const nonce = `${Date.now()}-${process.pid}`;
const adminToken = `forum-runtime-admin-${nonce}`;
let assertions = 0;
let server = null;
let serverOutput = "";
let baseUrl = "";

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
      CST_ADMIN_TOKEN: adminToken,
      CST_ALLOW_REGISTRATION: "true",
      CST_AUTH_SECURE_COOKIE: "false",
      CST_BIND: `127.0.0.1:${port}`,
      CST_DATA_DIR: dataDir,
      CST_STATIC_DIR: staticDir,
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

const request = async (route, {
  method = "GET",
  cookie,
  bearer,
  body,
} = {}) => {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (bearer) headers.authorization = `Bearer ${bearer}`;
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

const assertPublicAuthor = (author, expectedUser, message) => {
  equal(author.id, expectedUser.id, `${message} : identifiant incorrect.`);
  equal(author.username, expectedUser.username, `${message} : pseudonyme incorrect.`);
  ok(!("email" in author), `${message} : l'e-mail ne doit pas etre expose.`);
  ok(!("hasPassword" in author), `${message} : l'etat du mot de passe ne doit pas etre expose.`);
};

const aliceEmail = `alice_forum_${nonce}@example.invalid`;
const bobEmail = `bob_forum_${nonce}@example.invalid`;
const alicePassword = `Alice-${nonce}-A1!`;
const bobPassword = `Bob-${nonce}-B1!`;

try {
  await startServer();

  const unauthorizedList = await request("/api/forum/topics");
  equal(unauthorizedList.response.status, 401, "La liste des sujets doit exiger une authentification.");
  const unauthorizedCreate = await request("/api/forum/topics", {
    method: "POST",
    body: { title: "Interdit", body: "Sans session" },
  });
  equal(unauthorizedCreate.response.status, 401, "La creation d'un sujet doit exiger une authentification.");
  const unauthorizedMalformedCreate = await request("/api/forum/topics", {
    method: "POST",
    body: {},
  });
  equal(
    unauthorizedMalformedCreate.response.status,
    401,
    "L'authentification doit preceder la validation JSON d'un sujet.",
  );
  const unauthorizedDetail = await request("/api/forum/topics/inconnu");
  equal(unauthorizedDetail.response.status, 401, "La lecture d'un sujet doit exiger une authentification.");
  const unauthorizedReply = await request("/api/forum/topics/inconnu/replies", {
    method: "POST",
    body: { body: "Interdit" },
  });
  equal(unauthorizedReply.response.status, 401, "La reponse a un sujet doit exiger une authentification.");
  const unauthorizedMalformedReply = await request("/api/forum/topics/inconnu/replies", {
    method: "POST",
    body: {},
  });
  equal(
    unauthorizedMalformedReply.response.status,
    401,
    "L'authentification doit preceder la validation JSON d'une reponse.",
  );

  const alice = await register(`AliceForum_${nonce}`, aliceEmail, alicePassword);
  const bob = await register(`BobForum_${nonce}`, bobEmail, bobPassword);

  const initial = await request("/api/forum/topics", { cookie: alice.cookie });
  equal(initial.response.status, 200, "Le forum authentifie doit etre accessible.");
  equal(initial.response.headers.get("cache-control"), "no-store", "La liste dynamique du forum ne doit pas etre mise en cache.");
  equal(initial.value.length, 0, "Le forum isole doit demarrer vide.");

  const malformedTopic = await request("/api/forum/topics", {
    method: "POST",
    cookie: alice.cookie,
    body: { body: "Sans titre" },
  });
  equal(malformedTopic.response.status, 400, "Un sujet JSON incomplet doit etre refuse avec 400.");
  equal(
    malformedTopic.response.headers.get("cache-control"),
    "no-store",
    "Une erreur de schema du forum ne doit pas etre mise en cache.",
  );

  const emptyTitle = await request("/api/forum/topics", {
    method: "POST",
    cookie: alice.cookie,
    body: { title: "   ", body: "Corps" },
  });
  equal(emptyTitle.response.status, 400, "Un titre vide doit etre refuse.");
  const emptyBody = await request("/api/forum/topics", {
    method: "POST",
    cookie: alice.cookie,
    body: { title: "Titre", body: "  " },
  });
  equal(emptyBody.response.status, 400, "Un corps vide doit etre refuse.");
  const oversizedTitle = await request("/api/forum/topics", {
    method: "POST",
    cookie: alice.cookie,
    body: { title: "x".repeat(141), body: "Corps" },
  });
  equal(oversizedTitle.response.status, 400, "Un titre de plus de 140 caracteres doit etre refuse.");
  const oversizedBody = await request("/api/forum/topics", {
    method: "POST",
    cookie: alice.cookie,
    body: { title: "Titre", body: "x".repeat(20_001) },
  });
  equal(oversizedBody.response.status, 400, "Un sujet de plus de 20 000 caracteres doit etre refuse.");

  const first = await request("/api/forum/topics", {
    method: "POST",
    cookie: alice.cookie,
    body: { title: "  Sujet durable  ", body: "  Ligne une\n\nLigne deux  " },
  });
  equal(first.response.status, 201, "Le sujet valide d'Alice doit etre cree.");
  equal(first.response.headers.get("cache-control"), "no-store", "Le sujet cree ne doit pas etre mis en cache.");
  equal(first.value.title, "Sujet durable", "Le titre doit etre normalise.");
  equal(first.value.body, "Ligne une\n\nLigne deux", "Le corps doit etre normalise sans perdre ses retours internes.");
  assertPublicAuthor(first.value.author, alice.user, "Auteur du sujet");

  const second = await request("/api/forum/topics", {
    method: "POST",
    cookie: bob.cookie,
    body: { title: "Sujet recent", body: "Message de Bob" },
  });
  equal(second.response.status, 201, "Le sujet valide de Bob doit etre cree.");
  assertPublicAuthor(second.value.author, bob.user, "Auteur du second sujet");
  ok(second.value.activitySequence > first.value.activitySequence, "Le second sujet doit recevoir une sequence superieure.");

  const orderedBeforeReply = await request("/api/forum/topics", { cookie: alice.cookie });
  equal(orderedBeforeReply.value.length, 2, "Les deux sujets doivent etre listes.");
  equal(orderedBeforeReply.value[0].id, second.value.id, "Le sujet le plus recent doit etre en tete.");
  equal(orderedBeforeReply.value[1].replyCount, 0, "Le premier sujet doit commencer sans reponse.");

  const unknownTopic = await request("/api/forum/topics/inconnu", { cookie: alice.cookie });
  equal(unknownTopic.response.status, 404, "Un sujet inconnu doit retourner 404.");
  const emptyReply = await request(`/api/forum/topics/${first.value.id}/replies`, {
    method: "POST",
    cookie: bob.cookie,
    body: { body: "  " },
  });
  equal(emptyReply.response.status, 400, "Une reponse vide doit etre refusee.");
  const malformedReply = await request(`/api/forum/topics/${first.value.id}/replies`, {
    method: "POST",
    cookie: bob.cookie,
    body: {},
  });
  equal(malformedReply.response.status, 400, "Une reponse JSON incomplete doit etre refusee avec 400.");
  equal(
    malformedReply.response.headers.get("cache-control"),
    "no-store",
    "Une erreur de schema de reponse ne doit pas etre mise en cache.",
  );
  const oversizedReply = await request(`/api/forum/topics/${first.value.id}/replies`, {
    method: "POST",
    cookie: bob.cookie,
    body: { body: "x".repeat(12_001) },
  });
  equal(oversizedReply.response.status, 400, "Une reponse de plus de 12 000 caracteres doit etre refusee.");

  const replied = await request(`/api/forum/topics/${first.value.id}/replies`, {
    method: "POST",
    cookie: bob.cookie,
    body: { body: "  Reponse durable de Bob  " },
  });
  equal(replied.response.status, 201, "La reponse valide de Bob doit etre creee.");
  equal(replied.response.headers.get("cache-control"), "no-store", "Le sujet repondu ne doit pas etre mis en cache.");
  equal(replied.value.replies.length, 1, "La reponse doit etre ajoutee une seule fois.");
  equal(replied.value.replies[0].body, "Reponse durable de Bob", "La reponse doit etre normalisee.");
  assertPublicAuthor(replied.value.replies[0].author, bob.user, "Auteur de la reponse");
  ok(replied.value.activitySequence > second.value.activitySequence, "Une reponse doit remonter le sujet avec une nouvelle sequence.");

  const orderedAfterReply = await request("/api/forum/topics", { cookie: bob.cookie });
  equal(orderedAfterReply.value[0].id, first.value.id, "Le sujet repondu doit remonter en tete.");
  equal(orderedAfterReply.value[0].replyCount, 1, "Le resume doit compter la reponse.");
  assertPublicAuthor(orderedAfterReply.value[0].lastReplyAuthor, bob.user, "Dernier repondant");

  const detail = await request(`/api/forum/topics/${first.value.id}`, { cookie: alice.cookie });
  equal(detail.response.status, 200, "Alice doit pouvoir lire la reponse publique de Bob.");
  equal(detail.response.headers.get("cache-control"), "no-store", "Le detail du forum ne doit pas etre mis en cache.");
  equal(detail.value.replies[0].body, "Reponse durable de Bob", "Le detail doit contenir la reponse intacte.");

  const adminTopic = await request("/api/forum/topics", {
    method: "POST",
    bearer: adminToken,
    body: { title: "Annonce serveur", body: "Message administrateur" },
  });
  equal(adminTopic.response.status, 201, "Le client natif admin doit pouvoir creer un sujet.");
  equal(adminTopic.value.author.id, "server-admin", "Le sujet natif doit etre attribue a l'administrateur.");
  ok(!("email" in adminTopic.value.author), "L'auteur administrateur ne doit pas exposer d'e-mail.");

  const forumStore = await readFile(path.join(dataDir, "forum.json"), "utf8");
  ok(!forumStore.includes(aliceEmail), "Le stockage du forum ne doit pas recopier l'e-mail d'Alice.");
  ok(!forumStore.includes(bobEmail), "Le stockage du forum ne doit pas recopier l'e-mail de Bob.");
  ok(!forumStore.includes(alicePassword), "Le stockage du forum ne doit pas contenir de mot de passe.");

  await stopServer();
  await startServer();
  const aliceCookieAfterRestart = await login(aliceEmail, alicePassword);
  const persistedList = await request("/api/forum/topics", { cookie: aliceCookieAfterRestart });
  equal(persistedList.response.status, 200, "Le forum doit rester accessible apres redemarrage.");
  equal(persistedList.value.length, 3, "Les trois sujets doivent survivre au redemarrage.");
  equal(persistedList.value[0].id, adminTopic.value.id, "L'ordre d'activite doit survivre au redemarrage.");
  const persistedDetail = await request(`/api/forum/topics/${first.value.id}`, {
    cookie: aliceCookieAfterRestart,
  });
  equal(persistedDetail.value.replies.length, 1, "La reponse doit survivre au redemarrage.");
  equal(persistedDetail.value.replies[0].body, "Reponse durable de Bob", "La reponse persistee doit rester intacte.");

  process.stdout.write(`${JSON.stringify({
    assertions,
    restarts: 1,
    users: 2,
    topics: 3,
    replies: 1,
  }, null, 2)}\n`);
} finally {
  await stopServer().catch(() => {});
  const safePrefix = `${workspace}${path.sep}`.toLowerCase();
  const safeTemp = tempRoot.toLowerCase().startsWith(safePrefix)
    && path.basename(tempRoot).startsWith(".tmp-forum-runtime-");
  if (safeTemp) await rm(tempRoot, { recursive: true, force: true });
}
