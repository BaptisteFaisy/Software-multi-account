import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_TURN_STATUS_DISPLAY_STORAGE_KEY,
  chatRuntimeShowsStateLabel,
  loadChatTurnStatusDisplayMode,
  normalizeChatTurnStatusDisplayMode,
  persistChatTurnStatusDisplayMode,
} from "../src/chat/status-display.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("le mode texte est le choix par défaut et les valeurs invalides sont filtrées", () => {
  assert.equal(normalizeChatTurnStatusDisplayMode("dot"), "dot");
  assert.equal(normalizeChatTurnStatusDisplayMode("label"), "label");
  assert.equal(normalizeChatTurnStatusDisplayMode("inconnu"), "label");
  assert.equal(loadChatTurnStatusDisplayMode({ getItem: () => null }), "label");
  assert.equal(loadChatTurnStatusDisplayMode({ getItem: () => "dot" }), "dot");
});

test("le mode choisi est persisté sur l'appareil", () => {
  const writes = [];
  assert.equal(
    persistChatTurnStatusDisplayMode("dot", {
      setItem: (key, value) => writes.push([key, value]),
    }),
    true,
  );
  assert.deepEqual(writes, [[CHAT_TURN_STATUS_DISPLAY_STORAGE_KEY, "dot"]]);
  assert.equal(
    persistChatTurnStatusDisplayMode("label", { setItem: () => { throw new Error("bloqué"); } }),
    false,
  );
});

test("les etats passifs redondants disparaissent du runtime", () => {
  assert.equal(chatRuntimeShowsStateLabel("idle", false), false);
  assert.equal(chatRuntimeShowsStateLabel("completed", false), false);
  assert.equal(chatRuntimeShowsStateLabel("running", false), true);
  assert.equal(chatRuntimeShowsStateLabel("finalizing", false), true);
  assert.equal(chatRuntimeShowsStateLabel("failed", false), true);
  assert.equal(chatRuntimeShowsStateLabel("cancelled", false), true);
  assert.equal(chatRuntimeShowsStateLabel("completed", true), true);
  assert.match(view, /chatRuntimeShowsStateLabel\(model\.turnStatus, waitingForUser\)/);
  assert.match(view, /showStateLabel && stateLabel/);
  assert.doesNotMatch(view, /turnStatus === "completed"\) stateLabel = "Termine"/);
});

test("les paramètres proposent le point coloré ou le texte et pilotent tous les bandeaux", () => {
  assert.match(main, /id="chatStatusDisplaySettingsTitle">Statut dans le bandeau/);
  assert.match(main, /data-chat-status-display-mode="dot"/);
  assert.match(main, /data-chat-status-display-mode="label"/);
  assert.match(main, /persistChatTurnStatusDisplayMode\(nextMode\)/);
  assert.equal((main.match(/turnStatusDisplayMode: chatTurnStatusDisplayMode/g) ?? []).length, 2);
  assert.match(view, /data-chat-status-display="\$\{displayMode\}"/);
  assert.match(view, /displayMode === "dot"/);
  assert.match(style, /\.chat-turn-status--dot\.chat-turn-status--idle \.chat-turn-status-dot \{[\s\S]*?background: #22c55e;/);
  assert.match(style, /\.chat-turn-status--dot\.chat-turn-status--running \.chat-turn-status-dot \{[\s\S]*?background: #f59e0b;/);
  assert.match(style, /\.chat-turn-status--dot\.chat-turn-status--question \.chat-turn-status-dot \{[\s\S]*?background: #ef4444;/);
});
