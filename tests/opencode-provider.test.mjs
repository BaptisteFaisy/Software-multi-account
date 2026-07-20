import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const provider = readFileSync(
  new URL("../src-tauri/src/provider.rs", import.meta.url),
  "utf8",
);
const chat = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");
const discussions = readFileSync(
  new URL("../src-tauri/src/discussions.rs", import.meta.url),
  "utf8",
);

test("OpenCode isole chaque compte dans ses propres repertoires", () => {
  for (const variable of [
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
    "XDG_STATE_HOME",
    "OPENCODE_CONFIG_DIR",
  ]) {
    assert.ok(provider.includes(variable), `variable manquante: ${variable}`);
  }
  assert.match(provider, /data"\)\.join\("opencode"\)\.join\("auth\.json"\)/);
  assert.match(provider, /value\.get\(provider\)/);
});

test("les chats OpenCode utilisent le protocole JSON officiel", () => {
  assert.match(chat, /command\s*\.arg\("run"\)/);
  assert.match(chat, /\.arg\("--format"\)[\s\S]*?\.arg\("json"\)/);
  assert.match(chat, /\.arg\("--thinking"\)/);
  assert.match(chat, /command\.arg\("--session"\)\.arg\(session_id\)/);
  assert.match(chat, /command\.arg\("--model"\)\.arg\(model\)/);
  assert.match(chat, /"tool_use"/);
});

test("l'historique OpenCode reste piloté par sa CLI publique", () => {
  assert.match(discussions, /\["session", "list", "--format", "json"\]/);
  assert.match(discussions, /\["export", session_id\]/);
  assert.match(discussions, /\["session", "delete", session_id\]/);
  assert.match(discussions, /archive_dir\.join\(format!\("\{session_id\}\.json"\)\)/);
});

test("les fournisseurs annexes demandes sont proposes", () => {
  for (const id of [
    "zai",
    "zai-coding-plan",
    "minimax",
    "minimax-coding-plan",
    "deepseek",
    "openrouter",
  ]) {
    assert.ok(main.includes(`id: "${id}"`), `fournisseur manquant: ${id}`);
  }
});
