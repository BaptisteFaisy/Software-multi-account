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

const finiteNumber = (value: number) => Number.isFinite(value) ? value : 0;

export const chatMaxScrollTop = (metrics: ChatScrollMetrics): number =>
  Math.max(0, finiteNumber(metrics.scrollHeight) - finiteNumber(metrics.clientHeight));

export const chatIsAtBottom = (metrics: ChatScrollMetrics): boolean =>
  chatMaxScrollTop(metrics) - finiteNumber(metrics.scrollTop) <= CHAT_SCROLL_BOTTOM_EPSILON;

// Un scroll peut aussi etre declenche par un rendu ou un changement de taille.
// Il ne suspend le suivi que lorsque l'appelant a detecte une remontee utilisateur.
export const updateChatScrollState = (
  state: ChatScrollState,
  metrics: ChatScrollMetrics,
  userMovedAway = false,
): void => {
  state.scrollTop = Math.min(
    Math.max(0, finiteNumber(metrics.scrollTop)),
    chatMaxScrollTop(metrics),
  );
  if (chatIsAtBottom(metrics)) {
    state.followLatest = true;
  } else if (userMovedAway) {
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
  state.scrollTop = target;
  if (maxScrollTop <= CHAT_SCROLL_BOTTOM_EPSILON) state.followLatest = true;
  return target;
};
