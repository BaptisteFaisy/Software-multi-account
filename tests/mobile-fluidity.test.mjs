import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveChatTurnWindow } from "../src/chat/render-window.ts";
import { precompressDirectory } from "../scripts/precompress-frontend.mjs";

const read = (path) => readFile(new URL("../" + path, import.meta.url), "utf8");

test("le chat mobile ne monte que la fenetre de tours recente", () => {
  assert.deepEqual(resolveChatTurnWindow(60, 24), {
    requestedLimit: 24,
    hiddenTurnCount: 36,
    visibleTurnCount: 24,
  });
  assert.deepEqual(resolveChatTurnWindow(60, null), {
    requestedLimit: null,
    hiddenTurnCount: 0,
    visibleTurnCount: 60,
  });
  assert.equal(resolveChatTurnWindow(60, 0).visibleTurnCount, 1);
});

test("le patch de streaming ne remplace que le dernier tour", async () => {
  const [view, main] = await Promise.all([
    read("src/chat/view.ts"),
    read("src/main.ts"),
  ]);

  assert.match(view, /export const renderChatLatestTurn/);
  assert.match(view, /const latest = turns\.at\(-1\)/);
  assert.match(view, /resolveChatTurnWindow\(turns\.length, model\.visibleTurnLimit\)/);
  assert.match(main, /const latestHtml = renderChatLatestTurn/);
  assert.match(main, /latest\.outerHTML = latestHtml/);
});

test("le build produit des variantes Brotli et Gzip reutilisables", async () => {
  const root = await mkdtemp(join(tmpdir(), "cst-precompress-"));
  try {
    const assets = join(root, "assets");
    const sourcePath = join(assets, "app.js");
    const source = "const mobileFluidity = true;\n".repeat(400);
    await mkdir(assets);
    await writeFile(sourcePath, source);

    const result = await precompressDirectory({ root, minimumBytes: 1 });
    const [original, brotliInfo, gzipInfo, server] = await Promise.all([
      readFile(sourcePath, "utf8"),
      stat(sourcePath + ".br"),
      stat(sourcePath + ".gz"),
      read("src-tauri/src/server.rs"),
    ]);

    assert.equal(result.sourceFiles, 1);
    assert.equal(original, source);
    assert.ok(brotliInfo.size < Buffer.byteLength(source));
    assert.ok(gzipInfo.size < Buffer.byteLength(source));
    assert.match(server, /\.precompressed_br\(\)/);
    assert.match(server, /\.precompressed_gzip\(\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("le profil Android retire les effets couteux des surfaces fixes", async () => {
  const [html, css, main] = await Promise.all([
    read("index.html"),
    read("src/style.css"),
    read("src/main.ts"),
  ]);

  assert.match(html, /CodexTerminalAndroid/);
  assert.match(html, /classList\.add\("native-android"\)/);
  assert.match(css, /:root\.native-android \.m-topbar/);
  assert.match(css, /backdrop-filter: none/);
  assert.match(css, /:root\.native-android \.eh-accretion/);
  assert.match(main, /renderChatLatestTurn/);
  assert.match(main, /latest\.outerHTML = latestHtml/);
  assert.match(main, /scheduleIdleTask\(\(\) => \{\s*void refreshSkills\(\);\s*void refreshAutonomousAgents\(\);\s*void refreshLimitStatus\(true\);/);
});

test("le compositeur Android masque les outils et montre l'intensite du modele", async () => {
  const [css, view] = await Promise.all([
    read("src/style.css"),
    read("src/chat/view.ts"),
  ]);

  assert.match(
    css,
    /:root\.native-android \.chat-agent-tools\s*\{[^}]*display:\s*none\s*!important;/,
  );
  assert.match(
    css,
    /:root\.native-android \.chat-app-layout \.chat-effort-select\s*\{[^}]*display:\s*inline-flex;/,
  );
  assert.match(view, /data-chat-control="reasoning-effort"/);
  assert.match(view, /option\.value === model\.selectedReasoningEffort/);
});
