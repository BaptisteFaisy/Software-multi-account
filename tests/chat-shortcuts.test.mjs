import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_CHAT_HOVER_SHORTCUT_BINDINGS,
  chatHoverShortcutAction,
  chatShortcutTargetConsumesDeletion,
} from "../src/chat/shortcuts.ts";
import { DEFAULT_KEYBOARD_SHORTCUTS } from "../src/keyboard-shortcuts.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

const deleteEvent = (overrides = {}) => ({
  key: "Delete",
  code: "Delete",
  repeat: false,
  isComposing: false,
  shiftKey: false,
  ctrlKey: false,
  altKey: false,
  metaKey: false,
  ...overrides,
});

test("les raccourcis de fermeture par defaut derivent du registre global", () => {
  assert.equal(
    DEFAULT_CHAT_HOVER_SHORTCUT_BINDINGS["close-chat"],
    DEFAULT_KEYBOARD_SHORTCUTS["close-chat"],
  );
  assert.equal(
    DEFAULT_CHAT_HOVER_SHORTCUT_BINDINGS["close-chat-and-discussion"],
    DEFAULT_KEYBOARD_SHORTCUTS["close-chat-and-discussion"],
  );
});

test("Suppr ferme le chat avec sa discussion", () => {
  assert.equal(chatHoverShortcutAction(deleteEvent()), "close-chat-and-discussion");
});

test("2 ferme uniquement le chat", () => {
  assert.equal(
    chatHoverShortcutAction(deleteEvent({ key: "2", code: "Digit2" })),
    "close-chat",
  );
});

test("les raccourcis de chat ignorent le maintien et les modificateurs", () => {
  assert.equal(chatHoverShortcutAction(deleteEvent({ repeat: true })), null);
  assert.equal(chatHoverShortcutAction(deleteEvent({ isComposing: true })), null);
  assert.equal(chatHoverShortcutAction(deleteEvent({ shiftKey: true })), null);
  assert.equal(chatHoverShortcutAction(deleteEvent({ ctrlKey: true })), null);
  assert.equal(chatHoverShortcutAction(deleteEvent({ altKey: true })), null);
  assert.equal(chatHoverShortcutAction(deleteEvent({ metaKey: true })), null);
});

test("Suppr et 2 ne ferment rien pendant la saisie", () => {
  const editableTarget = {
    closest: (selector) => (selector.includes("textarea") ? {} : null),
  };
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: editableTarget })), null);
  assert.equal(
    chatHoverShortcutAction(
      deleteEvent({ key: "2", code: "Digit2", target: editableTarget }),
    ),
    null,
  );
  assert.equal(
    chatHoverShortcutAction(deleteEvent({ target: { isContentEditable: true } })),
    null,
  );
});

test("Suppr reste actif dans un compositeur vide mais 2 reste une saisie", () => {
  const emptyComposer = {
    tagName: "TEXTAREA",
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    closest: () => emptyComposer,
  };
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: emptyComposer })), "close-chat-and-discussion");
  assert.equal(
    chatHoverShortcutAction(
      deleteEvent({ key: "2", code: "Digit2", target: emptyComposer }),
    ),
    null,
  );
});

test("un brouillon non vide reste toujours prioritaire", () => {
  const composer = {
    tagName: "TEXTAREA",
    value: "bonjour",
    selectionStart: 3,
    selectionEnd: 3,
    closest: () => composer,
  };
  assert.equal(chatShortcutTargetConsumesDeletion(composer), true);
  assert.equal(
    chatHoverShortcutAction(
      deleteEvent({ key: "2", code: "Digit2", target: composer }),
    ),
    null,
  );
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: composer })), null);
  composer.selectionStart = 0;
  composer.selectionEnd = 0;
  assert.equal(
    chatHoverShortcutAction(
      deleteEvent({ key: "2", code: "Digit2", target: composer }),
    ),
    null,
  );
  composer.selectionStart = composer.value.length;
  composer.selectionEnd = composer.value.length;
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: composer })), null);
});

test("les anciens noms de touche restent reconnus", () => {
  assert.equal(chatHoverShortcutAction(deleteEvent({ key: "Del", code: "" })), "close-chat-and-discussion");
});

test("le chat cible est resolu au point exact de la souris", () => {
  assert.match(main, /document\.elementFromPoint\(lastPointerClientX, lastPointerClientY\)/);
  assert.match(main, /closest<HTMLElement>\("\[data-chat-panel\]"\)/);
  assert.match(main, /const key = expertChatKeyAtPointer\(\)/);
  assert.match(main, /closeExpertChatPane\(pane\)/);
  assert.match(main, /closeExpertChatAndDiscussion\(pane\)/);
});

test("Suppr ferme le panneau avant l'archivage et le rescannage", () => {
  const closeStart = main.indexOf("const closeExpertChatAndDiscussion =");
  const closeEnd = main.indexOf("\nconst selectWorkspaceFilter =", closeStart);
  const close = main.slice(closeStart, closeEnd);
  const finalizeStart = main.indexOf("const finalizeClosedExpertChatDiscussion =");
  const finalizeEnd = main.indexOf("\nconst closeExpertChatAndDiscussion =", finalizeStart);
  const finalize = main.slice(finalizeStart, finalizeEnd);

  assert.ok(closeStart >= 0 && closeEnd > closeStart);
  assert.ok(finalizeStart >= 0 && finalizeEnd > finalizeStart);
  assert.match(close, /closeExpertChatPane\(pane\)/);
  assert.match(close, /void finalizeClosedExpertChatDiscussion\(discussion, pendingStatus\)/);
  assert.ok(
    close.indexOf("closeExpertChatPane(pane)")
      < close.indexOf("void finalizeClosedExpertChatDiscussion(discussion, pendingStatus)"),
  );
  assert.doesNotMatch(close, /await archiveDiscussionById|await refreshDiscussions/);
  assert.match(finalize, /await archiveDiscussionById/);
  assert.match(finalize, /await refreshDiscussions\(\)/);
  assert.doesNotMatch(finalize, /\brender\(\)/);
});

test("la grille explique visiblement les trois raccourcis de chat", () => {
  assert.match(
    main,
    /formatKeyboardShortcut\(keyboardShortcutBinding\("toggle-pane-fullscreen"\)\)/,
  );
  assert.match(
    main,
    /formatKeyboardShortcut\(keyboardShortcutBinding\("close-chat"\)\)/,
  );
  assert.match(
    main,
    /formatKeyboardShortcut\(keyboardShortcutBinding\("close-chat-and-discussion"\)\)/,
  );
  assert.match(main, /: agrandir\/réduire · [^\n]+ : fermer · [^\n]+ : fermer avec la discussion/);
});
