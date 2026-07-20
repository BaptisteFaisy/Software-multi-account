export const CHAT_CONTEXT_SIDEBAR_DEFAULT_WIDTH = 236;
export const CHAT_CONTEXT_SIDEBAR_COMPACT_WIDTH = 72;
export const CHAT_CONTEXT_SIDEBAR_COLLAPSED_WIDTH = 0;
export const CHAT_CONTEXT_SIDEBAR_MIN_WIDTH = 72;
export const CHAT_CONTEXT_SIDEBAR_MAX_WIDTH = 420;
export const CHAT_CONTEXT_SIDEBAR_COMPACT_BREAKPOINT = 1280;
export const CHAT_CONTEXT_SIDEBAR_MOBILE_BREAKPOINT = 860;
export const CHAT_CONTEXT_SIDEBAR_COMPACT_MODE_MAX_WIDTH = 179;
export const CHAT_CONTEXT_WORKSPACE_MIN_WIDTH = 360;

export const defaultChatContextSidebarWidth = (viewportWidth: number): number => {
  if (viewportWidth <= CHAT_CONTEXT_SIDEBAR_MOBILE_BREAKPOINT) return 0;
  return viewportWidth <= CHAT_CONTEXT_SIDEBAR_COMPACT_BREAKPOINT
    ? CHAT_CONTEXT_SIDEBAR_COMPACT_WIDTH
    : CHAT_CONTEXT_SIDEBAR_DEFAULT_WIDTH;
};

export const chatContextSidebarMaxWidth = (
  viewportWidth: number,
  leftSidebarWidth: number,
): number => {
  if (viewportWidth <= CHAT_CONTEXT_SIDEBAR_MOBILE_BREAKPOINT) return 0;
  const availableWidth = Math.floor(
    viewportWidth - Math.max(0, leftSidebarWidth) - CHAT_CONTEXT_WORKSPACE_MIN_WIDTH,
  );
  return Math.max(
    CHAT_CONTEXT_SIDEBAR_MIN_WIDTH,
    Math.min(CHAT_CONTEXT_SIDEBAR_MAX_WIDTH, availableWidth),
  );
};

export const clampChatContextSidebarWidth = (
  width: number,
  viewportWidth: number,
  leftSidebarWidth: number,
): number => {
  if (viewportWidth <= CHAT_CONTEXT_SIDEBAR_MOBILE_BREAKPOINT) return 0;
  const fallback = defaultChatContextSidebarWidth(viewportWidth);
  const requested = Number.isFinite(width) ? Math.round(width) : fallback;
  if (requested <= CHAT_CONTEXT_SIDEBAR_COLLAPSED_WIDTH) {
    return CHAT_CONTEXT_SIDEBAR_COLLAPSED_WIDTH;
  }
  return Math.max(
    CHAT_CONTEXT_SIDEBAR_MIN_WIDTH,
    Math.min(chatContextSidebarMaxWidth(viewportWidth, leftSidebarWidth), requested),
  );
};

export const chatContextSidebarIsCompact = (width: number): boolean =>
  width > 0 && width <= CHAT_CONTEXT_SIDEBAR_COMPACT_MODE_MAX_WIDTH;
