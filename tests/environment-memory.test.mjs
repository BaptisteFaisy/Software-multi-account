import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const chat = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src-tauri/src/settings.rs", import.meta.url), "utf8");

test("chaque environnement expose une memoire partagee persistante", () => {
  assert.match(main, /id="environmentMemoryInput"/);
  assert.match(main, /saveEnvironmentMemory/);
  assert.match(main, /setWorkspaceMemory\(previousWorkspaces, environmentPath, memory\)/);
  assert.match(style, /\.terminal-environment-memory/);
  assert.match(settings, /pub memory: String/);
  assert.match(settings, /workspace_memory_for_path/);
});

test("un bouton ouvre la memoire de chaque environnement sans le selectionner", () => {
  assert.match(main, /data-view-environment-memory-id/);
  assert.match(main, /openEnvironmentMemory\(workspace\)/);
  assert.match(main, /environmentMemoryTargetId/);
  assert.match(style, /\.terminal-environment-menu-memory/);
});

test("la memoire est injectee hors du message visible pour Codex et Claude", () => {
  assert.match(chat, /workspace_memory_for_path\(&app_settings, path\)/);
  assert.match(chat, /developer_instructions=/);
  assert.match(chat, /--append-system-prompt/);
  assert.match(chat, /environment_memory_instructions/);
});

test("les chats Codex activent leur memoire automatique locale", () => {
  assert.match(chat, /command\.arg\("--enable"\)\.arg\("memories"\)/);
  assert.match(chat, /merge_codex_developer_instructions/);
});
