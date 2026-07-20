export type ChatTurnWindow = {
  requestedLimit: number | null;
  hiddenTurnCount: number;
  visibleTurnCount: number;
};

/** Normalise la fenetre de rendu sans dependre du DOM ni du moteur Markdown. */
export const resolveChatTurnWindow = (
  turnCount: number,
  visibleTurnLimit: number | null,
): ChatTurnWindow => {
  const normalizedTurnCount = Math.max(0, Math.floor(turnCount));
  const requestedLimit = Number.isInteger(visibleTurnLimit)
    ? Math.max(1, visibleTurnLimit ?? 1)
    : null;
  const hiddenTurnCount = requestedLimit === null
    ? 0
    : Math.max(0, normalizedTurnCount - requestedLimit);
  return {
    requestedLimit,
    hiddenTurnCount,
    visibleTurnCount: normalizedTurnCount - hiddenTurnCount,
  };
};
