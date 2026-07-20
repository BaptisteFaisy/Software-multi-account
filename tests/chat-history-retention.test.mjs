import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync(
  new URL("../src-tauri/src/discussions.rs", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("un rechargement de chat conserve tout le transcript durable", () => {
  const transcriptStart = backend.indexOf("pub fn transcript_for_account(");
  const transcriptEnd = backend.indexOf("pub(crate) fn context_usage_for_account", transcriptStart);
  const implementation = backend.slice(transcriptStart, transcriptEnd);

  assert.ok(transcriptStart >= 0 && transcriptEnd > transcriptStart);
  assert.doesNotMatch(implementation, /messages\.drain\s*\(/);
  assert.doesNotMatch(implementation, /TRANSCRIPT_MAX_MESSAGES/);
  assert.match(implementation, /messages,\s*\/\/ Le fichier de session est la source durable/);
  assert.match(implementation, /truncated:\s*false/);
});

test("les longs historiques sont bornes au rendu, pas supprimes des donnees", () => {
  assert.match(main, /const DESKTOP_CHAT_TURN_BATCH = 200/);
  assert.match(main, /const initialVisibleChatTurnLimit = \(\): number \| null =>\s*chatTurnBatchForViewport\(\)/);
  assert.match(
    main,
    /pane\.visibleTurnLimit = \(pane\.visibleTurnLimit \?\? 0\) \+ chatTurnBatchForViewport\(\)/,
  );
  assert.match(
    main,
    /chatVisibleTurnLimit = \(chatVisibleTurnLimit \?\? 0\) \+ chatTurnBatchForViewport\(\)/,
  );
});
