import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("le nom du compte est affiche a droite du bandeau de chaque chat", () => {
  assert.match(view, /<div class="chat-head-actions">[\s\S]*?<\/div>\s*<span class="chat-account-name"/);
  assert.match(view, /escapeHtml\(model\.accountLabel\)/);
  assert.match(style, /\.chat-account-name\s*\{/);
});

test("les vues de chat simple et multi-chat fournissent le nom du compte", () => {
  const labels = main.match(/accountLabel:\s*account\?\.label \?\? discussion\?\.accountLabel \?\? "Aucun compte"/g) ?? [];
  assert.equal(labels.length, 2);
});

test("le nom du compte reste visible dans le bandeau compact", () => {
  assert.match(style, /\.chat-panel--compact \.chat-account-name\s*\{/);
  assert.doesNotMatch(style, /\.chat-panel--expert:not\(\.active\) \.chat-account-name\s*\{[^}]*display:\s*none/);
});
