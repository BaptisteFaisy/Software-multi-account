import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_CONTEXT_SIDEBAR_COLLAPSED_WIDTH,
  CHAT_CONTEXT_SIDEBAR_DEFAULT_WIDTH,
  CHAT_CONTEXT_SIDEBAR_MAX_WIDTH,
  CHAT_CONTEXT_SIDEBAR_MIN_WIDTH,
  chatContextSidebarIsCompact,
  chatContextSidebarMaxWidth,
  clampChatContextSidebarWidth,
  defaultChatContextSidebarWidth,
} from "../src/chat/context-sidebar.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("le menu droit choisit une largeur adaptee a la fenetre", () => {
  assert.equal(defaultChatContextSidebarWidth(1440), CHAT_CONTEXT_SIDEBAR_DEFAULT_WIDTH);
  assert.equal(defaultChatContextSidebarWidth(1280), 72);
  assert.equal(defaultChatContextSidebarWidth(861), 72);
  assert.equal(defaultChatContextSidebarWidth(860), 0);
});

test("le redimensionnement du menu droit preserve la zone centrale", () => {
  assert.equal(chatContextSidebarMaxWidth(1440, 312), CHAT_CONTEXT_SIDEBAR_MAX_WIDTH);
  assert.equal(chatContextSidebarMaxWidth(981, 312), 309);
  assert.equal(clampChatContextSidebarWidth(500, 981, 312), 309);
  assert.equal(clampChatContextSidebarWidth(20, 1440, 312), CHAT_CONTEXT_SIDEBAR_MIN_WIDTH);
  assert.equal(
    clampChatContextSidebarWidth(0, 1440, 312),
    CHAT_CONTEXT_SIDEBAR_COLLAPSED_WIDTH,
  );
  assert.equal(clampChatContextSidebarWidth(236, 860, 0), 0);
});

test("le menu droit peut etre totalement masque puis restaure", () => {
  assert.equal(CHAT_CONTEXT_SIDEBAR_COLLAPSED_WIDTH, 0);
  assert.match(
    main,
    /id="chatContextSidebarCollapse"[^>]*data-toggle-chat-context-sidebar[^>]*aria-label="Masquer la barre de droite"/,
  );
  assert.match(
    main,
    /id="chatContextSidebarExpand"[^>]*data-toggle-chat-context-sidebar[^>]*aria-label="Afficher la barre de droite"/,
  );
  assert.match(main, /const toggleChatContextSidebar = \(\): void =>/);
  assert.match(main, /localStorage\.setItem\(\s*CHAT_CONTEXT_SIDEBAR_WIDTH_STORAGE_KEY/);
  assert.match(
    style,
    /\.chat-app-layout\.is-context-sidebar-collapsed \.chat-context-sidebar\s*\{[^}]*visibility:\s*hidden;[^}]*pointer-events:\s*none;/s,
  );
  assert.match(
    style,
    /\.chat-app-layout\.is-context-sidebar-collapsed \.chat-context-sidebar-expand\s*\{[^}]*display:\s*inline-flex;/s,
  );
});

test("le contenu du menu droit suit sa largeur reelle", () => {
  assert.equal(chatContextSidebarIsCompact(72), true);
  assert.equal(chatContextSidebarIsCompact(179), true);
  assert.equal(chatContextSidebarIsCompact(180), false);
});
