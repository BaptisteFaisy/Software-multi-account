import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("xterm et l'updater restent hors du chemin de demarrage", async () => {
  const [main, terminalRuntime] = await Promise.all([
    read("src/main.ts"),
    read("src/terminal-runtime.ts"),
  ]);

  assert.match(main, /import\("\.\/terminal-runtime"\)/);
  assert.match(main, /import\("\.\/updater"\)/);
  assert.match(
    main,
    /const initDesktopUpdaterDeferred[\s\S]*?if \(isRemoteMode\(\)\) return;[\s\S]*?import\("\.\/updater"\)/,
  );
  assert.match(main, /import type \{ Terminal \} from "@xterm\/xterm"/);
  assert.match(terminalRuntime, /new Terminal\(/);
  assert.match(terminalRuntime, /@xterm\/xterm\/css\/xterm\.css/);
});

test("le rendu partiel ne recree pas toutes les icones et les polices sont locales", async () => {
  const [main, style, markdown] = await Promise.all([
    read("src/main.ts"),
    read("src/style.css"),
    read("src/chat/markdown.ts"),
  ]);

  assert.match(main, /querySelectorAll<HTMLElement>\("i\[data-lucide\]"\)/);
  assert.doesNotMatch(main, /createIcons\(\{ icons:/);
  assert.doesNotMatch(style, /fonts\.googleapis\.com/);
  assert.match(markdown, /MARKDOWN_CACHE_MAX_WEIGHT/);
});

test("les taches de fond et les scans couteux sont dedupliques", async () => {
  const [main, discussions] = await Promise.all([
    read("src/main.ts"),
    read("src-tauri/src/discussions.rs"),
  ]);

  assert.match(main, /document\.visibilityState === "visible"/);
  assert.match(main, /discussionsRefreshPromise/);
  assert.match(discussions, /static SUMMARY_CACHE:/);
  assert.match(discussions, /static DASHBOARD_CACHE:/);
  assert.match(discussions, /cached_file_summary/);
});

test("le serveur conserve les assets hashes et les preflights", async () => {
  const server = await read("src-tauri/src/server.rs");

  assert.match(server, /max-age=31536000, immutable/);
  assert.match(server, /frontend_response_cache_control/);
  assert.match(server, /path\.starts_with\("\/assets\/"\)[\s\S]*?Some\("no-store"\)/);
  assert.match(server, /stale-while-revalidate/);
  assert.match(server, /CorsLayer::very_permissive\(\)\.max_age/);
});
