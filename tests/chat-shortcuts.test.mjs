import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  chatHoverShortcutAction,
  chatShortcutTargetConsumesDeletion,
} from "../src/chat/shortcuts.ts";

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

test("Suppr ferme le chat avec sa discussion", () => {
  assert.equal(chatHoverShortcutAction(deleteEvent()), "close-chat-and-discussion");
});

test("Retour arriere ferme uniquement le chat", () => {
  assert.equal(
    chatHoverShortcutAction(deleteEvent({ key: "Backspace", code: "Backspace" })),
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

test("Suppr et Retour arriere ne ferment rien pendant la saisie", () => {
  const editableTarget = {
    closest: (selector) => (selector.includes("textarea") ? {} : null),
  };
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: editableTarget })), null);
  assert.equal(
    chatHoverShortcutAction(
      deleteEvent({ key: "Backspace", code: "Backspace", target: editableTarget }),
    ),
    null,
  );
  assert.equal(
    chatHoverShortcutAction(deleteEvent({ target: { isContentEditable: true } })),
    null,
  );
});

test("un compositeur vide encore focalise laisse agir les raccourcis", () => {
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
      deleteEvent({ key: "Backspace", code: "Backspace", target: emptyComposer }),
    ),
    "close-chat",
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
      deleteEvent({ key: "Backspace", code: "Backspace", target: composer }),
    ),
    null,
  );
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: composer })), null);
  composer.selectionStart = 0;
  composer.selectionEnd = 0;
  assert.equal(
    chatHoverShortcutAction(
      deleteEvent({ key: "Backspace", code: "Backspace", target: composer }),
    ),
    null,
  );
  composer.selectionStart = composer.value.length;
  composer.selectionEnd = composer.value.length;
  assert.equal(chatHoverShortcutAction(deleteEvent({ target: composer })), null);
});

test("les anciens noms de touche restent reconnus", () => {
  assert.equal(chatHoverShortcutAction(deleteEvent({ key: "Del", code: "" })), "close-chat-and-discussion");
  assert.equal(
    chatHoverShortcutAction(deleteEvent({ key: "BackSpace", code: "" })),
    "close-chat",
  );
});

test("le chat cible est resolu au point exact de la souris", () => {
  assert.match(main, /document\.elementFromPoint\(lastPointerClientX, lastPointerClientY\)/);
  assert.match(main, /closest<HTMLElement>\("\[data-chat-panel\]"\)/);
  assert.match(main, /const key = expertChatKeyAtPointer\(\)/);
  assert.match(main, /closeExpertChatPane\(pane\)/);
  assert.match(main, /closeExpertChatAndDiscussion\(pane\)/);
});

test("la grille explique visiblement les deux raccourcis de chat", () => {
  assert.match(main, /Retour arrière : fermer/);
  assert.match(main, /Suppr : fermer avec la discussion/);
});
