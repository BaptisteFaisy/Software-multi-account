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

/** Position visee, sans effet de bord, ecretee a la hauteur mesurable. */
export const chatScrollTarget = (
  state: ChatScrollState,
  metrics: ChatScrollMetrics,
): number => {
  const maxScrollTop = chatMaxScrollTop(metrics);
  return state.followLatest
    ? maxScrollTop
    : Math.min(Math.max(0, finiteNumber(state.scrollTop)), maxScrollTop);
};

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
  const target = chatScrollTarget(state, metrics);
  if (state.followLatest) state.scrollTop = target;
  return target;
};

/**
 * Les tours hors ecran portent `content-visibility: auto`. Tant que le
 * navigateur ne les a pas rendus, ils ne pesent que leur taille de repli : la
 * hauteur mesuree est bien inferieure a la hauteur reelle et la position visee
 * se retrouve ecretee tres haut dans la conversation. Rendre les sous-arbres
 * sautes prend plusieurs trames, et chaque passage qui rapproche de la cible en
 * fait rendre de nouveaux. On reapplique donc la position jusqu'a ce que la
 * hauteur cesse de bouger, au lieu de faire confiance a la premiere mesure.
 */
export const CHAT_SCROLL_SETTLE_FRAMES = 30;

/** Trames consecutives sans variation de hauteur avant de considerer la mise en page finie. */
export const CHAT_SCROLL_SETTLE_STABLE_FRAMES = 2;

export type ChatScrollSettleState = {
  framesLeft: number;
  stableFrames: number;
  lastScrollHeight: number;
};

export const createChatScrollSettleState = (
  metrics: ChatScrollMetrics,
): ChatScrollSettleState => ({
  framesLeft: CHAT_SCROLL_SETTLE_FRAMES,
  stableFrames: 0,
  lastScrollHeight: finiteNumber(metrics.scrollHeight),
});

/** Vrai tant qu'une trame supplementaire est utile. Fait avancer `settle`. */
export const chatScrollSettleContinues = (
  settle: ChatScrollSettleState,
  state: ChatScrollState,
  metrics: ChatScrollMetrics,
): boolean => {
  const scrollHeight = finiteNumber(metrics.scrollHeight);
  settle.stableFrames = scrollHeight === settle.lastScrollHeight ? settle.stableFrames + 1 : 0;
  settle.lastScrollHeight = scrollHeight;
  settle.framesLeft -= 1;
  if (settle.framesLeft <= 0) return false;
  const reached =
    Math.abs(finiteNumber(metrics.scrollTop) - chatScrollTarget(state, metrics)) <= 0.5;
  return !(reached && settle.stableFrames >= CHAT_SCROLL_SETTLE_STABLE_FRAMES);
};
