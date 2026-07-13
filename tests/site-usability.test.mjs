import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("l'interface charge directement la grille de chats", () => {
  assert.match(main, /const renderChatFirstShell = \(\) =>/);
  assert.match(style, /\.chat-app-layout/);
});

test("la navigation mobile reste disponible dans la coque multi-chat", () => {
  const start = main.indexOf("const renderChatFirstShell = () =>");
  const end = main.indexOf("\nconst render = () =>", start);
  assert.ok(start >= 0 && end > start, "coque multi-chat introuvable");
  assert.match(main.slice(start, end), /ensureMobileChrome\(\);/);
});

test("le pool peut etre demarre et arrete depuis sa vue", () => {
  const start = main.indexOf("const renderPoolPanel = () =>");
  const end = main.indexOf("\nconst renderLimitsPanel = () =>", start);
  assert.ok(start >= 0 && end > start, "panneau pool introuvable");
  const panel = main.slice(start, end);
  assert.match(panel, /id="poolStart"/);
  assert.match(panel, /id="poolStop"/);
  assert.match(panel, /id="poolRuntimeStatus"/);
  assert.match(panel, /Démarrer le pool/);
  assert.match(panel, /Arrêter le pool/);
  assert.match(main, /runtimeStatus\.textContent = poolRuntimeSummary\(\);/);
});

test("l'ajout de proxy utilise un formulaire compatible mobile", () => {
  assert.match(main, /id="proxyUrlInput"/);
  assert.match(main, /const proxyUrl = input\?\.value\.trim\(\) \?\? "";/);
  const handlerStart = main.indexOf(
    'querySelector<HTMLButtonElement>("#addProxy")?.addEventListener',
  );
  const handlerEnd = main.indexOf(
    'querySelector<HTMLButtonElement>("#pickProjectDir")?.addEventListener',
    handlerStart,
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "gestionnaire proxy introuvable");
  assert.doesNotMatch(main.slice(handlerStart, handlerEnd), /window\.prompt/);
});

test("les informations d'etat visibles respectent une taille et un contraste lisibles", () => {
  assert.match(style, /--muted-2: #8a8a8a;/);
  assert.match(style, /\.chat-admin-head span \{[^}]*font-size: 12px;/);
  assert.match(style, /\.chat-status-toast \{[^}]*font-size: 12px;/);
  assert.match(
    style,
    /\.chat-workspace-empty \{[^}]*color: var\(--chat-muted\);[^}]*font-size: 12px;/,
  );
  assert.match(style, /\.chat-workspace-overview-copy \{[^}]*overflow: hidden;/);
  assert.match(
    style,
    /\.chat-workspace-overview-copy strong \{[^}]*font: 600 13px[^}]*overflow-wrap: anywhere;/,
  );
  assert.match(
    style,
    /\.chat-workspace-overview-copy small \{[^}]*font-size: 12px;[^}]*overflow-wrap: anywhere;/,
  );
  assert.match(
    style,
    /\.limits-head strong,\s*\.discussions-head > div > strong \{[^}]*text-transform: none;/,
  );
});
