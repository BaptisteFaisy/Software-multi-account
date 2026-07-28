import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");

// Replique isolée de isTransportError pour les tests unitaires : on ne peut pas
// importer platform.ts directement sous Node (imports @tauri-apps/* non
// resolus hors bundler). Toute evolution de la fonction doit etre refletée ici.
const isTransportError = (error) => {
  if (typeof error?.httpStatus === "number") return false;
  const raw = String(error);
  return error instanceof TypeError
    || /failed to fetch|networkerror|network request failed|load failed/i.test(raw);
};

test("isTransportError reconnait une panne reseau du navigateur", () => {
  assert.equal(isTransportError(new TypeError("Failed to fetch")), true);
  // Safari renvoie "Load failed" sans TypeError.
  assert.equal(isTransportError(new Error("Load failed")), true);
  assert.equal(isTransportError(new Error("Network request failed")), true);
});

test("isTransportError ignore une erreur HTTP definitive (httpStatus present)", () => {
  const http429 = new Error("Too many requests");
  http429.httpStatus = 429;
  assert.equal(isTransportError(http429), false);

  const http500 = new Error("internal");
  http500.httpStatus = 500;
  assert.equal(isTransportError(http500), false);
});

test("isTransportError ignore un timeout explicite (AbortController)", () => {
  // apiAt transforme un abort en message long sans httpStatus ni signature
  // TypeError : on ne veut surtout pas le rejouer silencieusement.
  assert.equal(isTransportError(new Error("Le serveur ne repond pas apres 30 s.")), false);
});

test("startRemoteChatTurn delegue l'envoi au helper de rejoue antichute", () => {
  // Le rejoue antichute est branche a la place de l'envoi direct dans la
  // boucle de candidats, et non ailleurs.
  const startFn = platform.slice(
    platform.indexOf("async function startRemoteChatTurn"),
    platform.indexOf("async function postChatTurnWithTransportRetry"),
  );
  assert.match(startFn, /await postChatTurnWithTransportRetry\(route, payload\)/);
  assert.doesNotMatch(startFn, /apiAt<[^>]*>\(\s*route,\s*"POST",\s*"\/api\/chat\/turns"/);
});

test("le helper rejoue une seule fois apres dedoublonnement par sourceChatKey", () => {
  const helperStart = platform.indexOf("async function postChatTurnWithTransportRetry");
  const helperEnd = platform.indexOf("\n}\n", helperStart);
  const helper = platform.slice(helperStart, helperEnd);
  // Une erreur HTTP definitive (httpStatus present) ne doit pas etre rejouee.
  assert.match(helper, /if \(!isTransportError\(error\)\) throw error/);
  // Avant de retenter, on interroge les tours actifs pour ne pas dupliquer.
  assert.match(helper, /\/api\/chat\/turns\/active[\s\S]*?sourceChatKey/);
  // Et on ne retente qu'une fois : exactement deux appels POST dans le helper.
  const postMatches = helper.match(/"POST",\s*"\/api\/chat\/turns"/g) ?? [];
  assert.equal(postMatches.length, 2);
});

test("le rejoue antichute reste dedie au demarrage de tour", () => {
  // Aucun autre endpoint (status, stop, compact...) n'est concerne.
  const retryUsages = platform.match(/postChatTurnWithTransportRetry\(/g) ?? [];
  // 1 declaration + 1 appel dans startRemoteChatTurn.
  assert.equal(retryUsages.length, 2);
});

test("repairRemoteConnection retente le health check une fois avant d'abandonner", () => {
  // Tailscale peut demander quelques centaines de ms pour retablir le tunnel
  // au moment ou l'utilisateur clique sur « Reparer la connexion » : on evite
  // un echec immediat en retentant une fois.
  const repairStart = platform.indexOf("export const repairRemoteConnection");
  const repairEnd = platform.indexOf("\n};\n", repairStart);
  const repair = platform.slice(repairStart, repairEnd);
  assert.match(repair, /for \(let attempt = 1; attempt <= 2; attempt/);
  const healthMatches = repair.match(/fetch\(`\$\{baseUrl\}\/api\/health`/g) ?? [];
  assert.equal(healthMatches.length, 1); // un seul fetch, repris dans la boucle
  assert.match(repair, /await new Promise<void>\(\(resolve\) => window\.setTimeout\(resolve, 1_000\)\)/);
});

test("le formulaire de connexion au VPS remonte toujours l'erreur au lieu de l'avaler", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const submitAnchor = main.indexOf('"#remoteLoginForm"');
  assert.ok(submitAnchor > 0, "le formulaire de connexion distant doit exister");
  // On extrait le bloc du handler jusqu'au prochain "; fermant la fonction flechee.
  const submit = main.slice(submitAnchor, submitAnchor + 2_500);
  // boot() est enveloppe d'un try/catch systematique : l'erreur ne doit plus
  // jamais etre avalee silencieusement (causait le " rien ne se passe" senti
  // par l'utilisateur lors d'un timeout TCP vers le VPS).
  assert.match(submit, /try \{\s*await boot\(\);\s*\} catch \(error\) \{/);
  // Sur panne de transport, un message explicite remplace le TypeError brut.
  assert.match(submit, /isTransportError\(error\)/);
  assert.match(submit, /Le serveur .* n'est pas joignable/);
  assert.match(submit, /renderRemoteLogin\(/);
  // Un statut "Connexion en cours..." desactive le bouton pendant la tentative.
  assert.match(submit, /Connexion en cours/);
});
