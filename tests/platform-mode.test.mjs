import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");

test("un lancement desktop local desactive le mode Cloud memorise", () => {
  assert.match(
    platform,
    /if \(!config\.remoteMode\) \{[\s\S]*?localStorage\.removeItem\(REMOTE_ENABLED_KEY\);[\s\S]*?return;/,
  );
});

test("un lancement desktop Cloud reactive explicitement le mode distant", () => {
  assert.match(platform, /localStorage\.setItem\(REMOTE_ENABLED_KEY, "1"\)/);
});

test("le chargement initial distant expire au lieu de tourner sans fin", () => {
  assert.match(platform, /const REMOTE_BOOTSTRAP_TIMEOUT_MS = 8_000/);
  assert.match(
    platform,
    /case "load_settings":[\s\S]*?REMOTE_BOOTSTRAP_TIMEOUT_MS/,
  );
  assert.match(platform, /controller\?\.signal\.aborted/);
  assert.match(platform, /ne repond pas apres/);
});

test("un noeud explicitement en drain n'est jamais utilise comme fallback terminal", () => {
  assert.match(platform, /eligible: acceptingTerminals/);
  assert.match(platform, /filter\(\(result\) => result\.eligible && !result\.healthy\)/);
  assert.match(platform, /Tous les noeuds terminaux sont en drain ou en maintenance/);
});

test("le mode distant expose le catalogue des tours de chat actifs", () => {
  assert.match(
    platform,
    /case "list_active_chat_turns":[\s\S]*?\/api\/chat\/turns\/active/,
  );
});
