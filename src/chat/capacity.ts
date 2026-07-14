const normalizeCapacityError = (value: string): string =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

/**
 * Reconnait uniquement une saturation du modele, pas un quota de compte ni la
 * capacite d'un noeud local. Le texte exact est celui actuellement emis par
 * Codex ; les variantes "overloaded" couvrent le meme echec cote provider.
 */
export const isModelCapacityError = (
  error: string | null | undefined,
): boolean => {
  if (!error?.trim()) return false;
  const value = normalizeCapacityError(error);
  return (
    value.includes("selected model is at capacity") ||
    /\bmodel\b.{0,80}\b(?:at capacity|overloaded)\b/.test(value) ||
    /\b(?:at capacity|overloaded)\b.{0,80}\bmodel\b/.test(value)
  );
};

export const MODEL_CAPACITY_RETRY_LIMIT = 3;
export const MODEL_CAPACITY_CONTINUE_PROMPT = "continue";

/** Delais 3 s, 6 s puis 12 s pour ne pas marteler un modele sature. */
export const modelCapacityRetryDelayMs = (attempt: number): number => {
  const normalizedAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(12_000, 3_000 * 2 ** (normalizedAttempt - 1));
};

/**
 * Une session existante a deja conserve la demande qui a echoue : "continue"
 * reproduit la reprise manuelle sans dupliquer tout le prompt. Si le provider
 * a echoue avant de creer la session, il faut en revanche rejouer la demande.
 */
export const modelCapacityRetryPrompt = (
  resumeSessionId: string | null | undefined,
  originalPrompt: string,
): string => resumeSessionId ? MODEL_CAPACITY_CONTINUE_PROMPT : originalPrompt;
