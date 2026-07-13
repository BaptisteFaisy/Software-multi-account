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

test("un noeud explicitement en drain n'est jamais utilise comme fallback terminal", () => {
  assert.match(platform, /eligible: acceptingTerminals/);
  assert.match(platform, /filter\(\(result\) => result\.eligible && !result\.healthy\)/);
  assert.match(platform, /Tous les noeuds terminaux sont en drain ou en maintenance/);
});
