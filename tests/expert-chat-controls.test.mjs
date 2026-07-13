import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("la bordure de chaque chat expert affiche les controles de fenetre", () => {
  assert.match(view, /class="expert-chat-pane-controls"/);
  assert.match(view, /class="expert-chat-pane-fullscreen" data-chat-action="fullscreen"/);
  assert.match(view, /class="expert-chat-pane-close" data-chat-action="close"/);
  assert.match(view, /fullscreen \? "minimize-2" : "maximize-2"/);
  assert.match(view, /aria-pressed="\$\{fullscreen\}"/);
});

test("les controles appellent les actions de plein ecran et de fermeture", () => {
  assert.match(main, /\[data-chat-action='fullscreen'\][\s\S]*toggleExpertChatFullscreen\(pane\)/);
  assert.match(main, /\[data-chat-action='close'\][\s\S]*closeExpertChatPane\(pane\)/);
});

test("les controles restent visibles dans le bandeau des chats inactifs", () => {
  assert.match(style, /\.expert-chat-pane-controls\s*\{[\s\S]*display:\s*flex/);
  assert.doesNotMatch(style, /chat-panel--expert:not\(\.active\)[^{]*\.expert-chat-pane-controls\s*\{[^}]*display:\s*none/);
});
