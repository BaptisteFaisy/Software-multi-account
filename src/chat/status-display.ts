export const CHAT_TURN_STATUS_DISPLAY_STORAGE_KEY =
  "codex-switch-terminal.chat-turn-status-display.v1";

export type ChatTurnStatusDisplayMode = "dot" | "label";

export const DEFAULT_CHAT_TURN_STATUS_DISPLAY_MODE: ChatTurnStatusDisplayMode = "label";

type ChatTurnStatusDisplayStorage = Pick<Storage, "getItem" | "setItem">;

export const normalizeChatTurnStatusDisplayMode = (
  value: unknown,
): ChatTurnStatusDisplayMode => value === "dot" ? "dot" : DEFAULT_CHAT_TURN_STATUS_DISPLAY_MODE;

export const chatRuntimeShowsStateLabel = (
  turnStatus: string,
  waitingForUser: boolean,
): boolean => waitingForUser || ["running", "finalizing", "failed", "cancelled"].includes(turnStatus);

export const loadChatTurnStatusDisplayMode = (
  storage: Pick<ChatTurnStatusDisplayStorage, "getItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): ChatTurnStatusDisplayMode => {
  try {
    return normalizeChatTurnStatusDisplayMode(
      storage?.getItem(CHAT_TURN_STATUS_DISPLAY_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_CHAT_TURN_STATUS_DISPLAY_MODE;
  }
};

export const persistChatTurnStatusDisplayMode = (
  mode: ChatTurnStatusDisplayMode,
  storage: Pick<ChatTurnStatusDisplayStorage, "setItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): boolean => {
  try {
    if (!storage) return false;
    storage.setItem(
      CHAT_TURN_STATUS_DISPLAY_STORAGE_KEY,
      normalizeChatTurnStatusDisplayMode(mode),
    );
    return true;
  } catch {
    return false;
  }
};
