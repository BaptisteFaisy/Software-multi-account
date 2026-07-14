import {
  keyboardShortcutMatches,
  type KeyboardShortcutEvent,
} from "../keyboard-shortcuts.ts";

type ChatHoverShortcutEvent = KeyboardShortcutEvent &
  Partial<Pick<KeyboardEvent, "target">>;

type EditableShortcutTarget = {
  isContentEditable?: boolean;
  tagName?: string;
  value?: unknown;
  selectionStart?: number | null;
  selectionEnd?: number | null;
  closest?: (selector: string) => unknown;
};

const EDITABLE_SHORTCUT_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [contenteditable='plaintext-only']";

const editableShortcutTarget = (target: unknown): EditableShortcutTarget | null => {
  if (!target || typeof target !== "object") return null;
  const element = target as EditableShortcutTarget;
  if (element.isContentEditable) return element;
  if (typeof element.closest !== "function") return null;
  const editable = element.closest(EDITABLE_SHORTCUT_SELECTOR);
  return editable && typeof editable === "object"
    ? editable as EditableShortcutTarget
    : null;
};

export const chatShortcutTargetIsEditable = (target: unknown): boolean => {
  return editableShortcutTarget(target) !== null;
};

export type ChatHoverShortcutAction = "close-chat" | "close-chat-and-discussion";

export type ChatHoverShortcutBindings = Record<ChatHoverShortcutAction, string>;

export const DEFAULT_CHAT_HOVER_SHORTCUT_BINDINGS: Readonly<ChatHoverShortcutBindings> = {
  "close-chat": "Backspace",
  "close-chat-and-discussion": "Delete",
};

export const chatShortcutTargetConsumesDeletion = (
  target: unknown,
): boolean => {
  const editable = editableShortcutTarget(target);
  if (!editable) return false;

  // Les select et les zones contenteditable ont des comportements de selection
  // trop varies pour intercepter leur touche de suppression sans risque.
  const tagName = editable.tagName?.toUpperCase();
  if (editable.isContentEditable || tagName === "SELECT") return true;

  // Un input/textarea vide garde souvent le focus apres l'ouverture ou l'envoi
  // d'un chat. Dans ce cas la touche ne modifierait rien : le raccourci peut donc
  // fermer le panneau. Un brouillon non vide reste toujours protege, meme si le
  // curseur se trouve a une extremite du texte.
  if (
    (tagName !== "INPUT" && tagName !== "TEXTAREA") ||
    typeof editable.value !== "string" ||
    typeof editable.selectionStart !== "number" ||
    typeof editable.selectionEnd !== "number"
  ) {
    return true;
  }

  return editable.value.length > 0 || editable.selectionStart !== editable.selectionEnd;
};

const chatHoverShortcutActionFromKey = (
  event: ChatHoverShortcutEvent,
  bindings: Readonly<ChatHoverShortcutBindings>,
): ChatHoverShortcutAction | null => {
  if (keyboardShortcutMatches(event, bindings["close-chat-and-discussion"])) {
    return "close-chat-and-discussion";
  }
  if (keyboardShortcutMatches(event, bindings["close-chat"])) {
    return "close-chat";
  }
  return null;
};

const eventUsesDeletionKey = (event: ChatHoverShortcutEvent): boolean =>
  event.key === "Delete" ||
  event.key === "Del" ||
  event.code === "Delete" ||
  event.key === "Backspace" ||
  event.key === "BackSpace" ||
  event.code === "Backspace";

export const chatHoverShortcutAction = (
  event: ChatHoverShortcutEvent,
  bindings: Readonly<ChatHoverShortcutBindings> = DEFAULT_CHAT_HOVER_SHORTCUT_BINDINGS,
): ChatHoverShortcutAction | null => {
  const action = chatHoverShortcutActionFromKey(event, bindings);
  if (!action) return null;
  if (event.repeat || event.isComposing) return null;
  if (eventUsesDeletionKey(event)) {
    if (chatShortcutTargetConsumesDeletion(event.target)) return null;
  } else if (
    chatShortcutTargetIsEditable(event.target) &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey
  ) return null;
  return action;
};
