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

test("le plein ecran mobile reste dans la coque avec un compositeur compact", () => {
  const rdvLabIndex = style.indexOf("/* RDV Lab");
  const mobileChatIndex = style.lastIndexOf("@media (max-width: 860px) {", rdvLabIndex);
  const mobileChatStyle = style.slice(mobileChatIndex, rdvLabIndex);

  assert.ok(mobileChatIndex >= 0 && rdvLabIndex > mobileChatIndex);
  assert.match(
    mobileChatStyle,
    /\.chat-app-layout \.expert-chat-wall \.chat-panel--expert\.is-fullscreen\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*height:\s*100%;[^}]*max-height:\s*100%/,
  );
  assert.match(
    mobileChatStyle,
    /\.chat-panel--compact\.is-fullscreen \.chat-composer-toolbar\s*\{[^}]*flex-wrap:\s*wrap/,
  );
  assert.match(
    mobileChatStyle,
    /\.chat-panel--compact\.is-fullscreen \.chat-agent-tools\s*\{[^}]*order:\s*1;[^}]*display:\s*grid;[^}]*flex:\s*1 0 100%/,
  );
  assert.match(
    mobileChatStyle,
    /\.chat-panel--compact\.is-fullscreen \.chat-agent-tool span\s*\{[^}]*display:\s*none/,
  );
  assert.match(
    mobileChatStyle,
    /\.chat-panel--expert\.is-fullscreen \.chat-history-button\s*\{[^}]*width:\s*28px;[^}]*min-width:\s*28px;[^}]*height:\s*24px;[^}]*min-height:\s*24px;[^}]*max-height:\s*24px/,
  );
  assert.match(
    mobileChatStyle,
    /\.chat-panel--expert\.is-fullscreen \.expert-chat-autonomous-action span,[\s\S]*\.chat-panel--expert\.is-fullscreen \.expert-chat-orchestration-action span\s*\{[^}]*display:\s*none/,
  );
});
