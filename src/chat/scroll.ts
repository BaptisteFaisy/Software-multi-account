export const CHAT_SCROLL_BOTTOM_EPSILON = 12;

export type ChatScrollMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

export type ChatScrollState = {
  followLatest: boolean;
  scrollTop: number;
};

export type ChatScrollUserIntent = "none" | "away" | "toward-latest";

const finiteNumber = (value: number) => Number.isFinite(value) ? value : 0;

export const chatMaxScrollTop = (metrics: ChatScrollMetrics): number =>
  Math.max(0, finiteNumber(metrics.scrollHeight) - finiteNumber(metrics.clientHeight));

export const chatIsAtBottom = (metrics: ChatScrollMetrics): boolean =>
  chatMaxScrollTop(metrics) - finiteNumber(metrics.scrollTop) <= CHAT_SCROLL_BOTTOM_EPSILON;

// Un scroll peut aussi etre declenche par un rendu ou un changement de taille.
// L'intention de suivi ne change donc qu'apres un geste utilisateur explicite.
export const updateChatScrollState = (
  state: ChatScrollState,
  metrics: ChatScrollMetrics,
  userIntent: ChatScrollUserIntent = "none",
): void => {
  const scrollTop = Math.min(
    Math.max(0, finiteNumber(metrics.scrollTop)),
    chatMaxScrollTop(metrics),
  );
  if (state.followLatest || userIntent !== "none") {
    state.scrollTop = scrollTop;
  }
  if (userIntent === "toward-latest" && chatIsAtBottom(metrics)) {
    state.followLatest = true;
  } else if (userIntent === "away") {
    state.followLatest = false;
  }
};

export const pauseChatScrollFollow = (
  state: ChatScrollState,
  metrics: ChatScrollMetrics,
): void => {
  state.scrollTop = Math.min(
    Math.max(0, finiteNumber(metrics.scrollTop)),
    chatMaxScrollTop(metrics),
  );
  state.followLatest = false;
};

export const restoreChatScrollTop = (
  state: ChatScrollState,
  metrics: ChatScrollMetrics,
): number => {
  const maxScrollTop = chatMaxScrollTop(metrics);
  const target = state.followLatest
    ? maxScrollTop
    : Math.min(Math.max(0, finiteNumber(state.scrollTop)), maxScrollTop);
  if (state.followLatest) state.scrollTop = target;
  return target;
};
