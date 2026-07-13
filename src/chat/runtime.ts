export type ChatDeliveryState = "pending" | "failed";

export type RuntimeChatPart = {
  id: string;
  kind: "reasoning" | "text" | "tool" | string;
  status: string;
  text?: string | null;
  tool?: string | null;
  title?: string | null;
  subtitle?: string | null;
  detail?: string | null;
  output?: string | null;
};

export type RuntimeChatMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  deliveryState?: ChatDeliveryState;
  parts?: RuntimeChatPart[];
};

/**
 * Transforme l'objectif saisi via le bouton Goal en demande utilisateur
 * explicite. Codex n'active un goal que lorsque l'utilisateur le demande : le
 * bouton doit donc conserver cette intention dans le transcript, quel que soit
 * le transport utilise (Tauri local ou API web).
 */
export const createGoalPrompt = (objective: string): string => {
  const normalized = objective.trim();
  if (!normalized) return "";
  return `Crée un goal avec l'outil create_goal pour l'objectif suivant, puis commence à le poursuivre :\n\n${normalized}`;
};

const sameMessageContent = (left: RuntimeChatMessage, right: RuntimeChatMessage): boolean =>
  left.role === right.role && left.text === right.text;

const timestampsCouldMatch = (left: RuntimeChatMessage, right: RuntimeChatMessage): boolean =>
  !left.timestamp || !right.timestamp || Math.abs(left.timestamp - right.timestamp) <= 120;

/**
 * Reconcile un transcript serveur avec les messages optimistes de l'interface.
 * Pendant un tour, un transcript legerement en retard ne doit jamais retirer la
 * fin du fil deja visible. Les messages optimistes disparaissent uniquement
 * lorsque leur equivalent persiste arrive du serveur.
 */
export const reconcileChatMessages = <T extends RuntimeChatMessage>(
  current: T[],
  incoming: T[],
  preserveStableTail = false,
): T[] => {
  const stableCurrent = current.filter((message) => !message.deliveryState);
  const incomingIsOlderPrefix =
    preserveStableTail &&
    incoming.length < stableCurrent.length &&
    incoming.every((message, index) => sameMessageContent(message, stableCurrent[index]));
  const merged = [...(incomingIsOlderPrefix ? stableCurrent : incoming)] as T[];

  current
    .filter((message) => !!message.deliveryState)
    .forEach((optimistic) => {
      const persisted = merged.some(
        (message) =>
          sameMessageContent(message, optimistic) && timestampsCouldMatch(message, optimistic),
      );
      if (persisted) return;

      const insertAt = merged.findIndex(
        (message) =>
          !!optimistic.timestamp &&
          !!message.timestamp &&
          message.timestamp > optimistic.timestamp,
      );
      if (insertAt < 0) merged.push(optimistic);
      else merged.splice(insertAt, 0, optimistic);
    });

  return merged;
};

export const chatMessagesEqual = (
  left: RuntimeChatMessage[],
  right: RuntimeChatMessage[],
): boolean =>
  left.length === right.length &&
  left.every(
    (message, index) =>
      sameMessageContent(message, right[index]) &&
      message.timestamp === right[index]?.timestamp &&
      message.deliveryState === right[index]?.deliveryState &&
      JSON.stringify(message.parts ?? []) === JSON.stringify(right[index]?.parts ?? []),
  );

export const markLatestPendingMessageFailed = <T extends RuntimeChatMessage>(messages: T[]): T[] => {
  let index = -1;
  for (let position = messages.length - 1; position >= 0; position -= 1) {
    if (messages[position]?.deliveryState === "pending") {
      index = position;
      break;
    }
  }
  if (index < 0) return messages;
  return messages.map((message, position) =>
    position === index ? ({ ...message, deliveryState: "failed" } as T) : message,
  );
};

/** Detecte une vraie demande de reponse dans le dernier paragraphe assistant. */
export const messageRequestsUserInput = (text: string | null | undefined): boolean => {
  if (!text?.trim()) return false;
  const withoutCode = text.replace(/```[\s\S]*?```/g, " ").trim();
  const paragraphs = withoutCode.split(/\n\s*\n/).filter(Boolean);
  const lastParagraph = paragraphs[paragraphs.length - 1]?.trim() ?? "";
  if (!lastParagraph) return false;
  if (/[?？](?:[\s*_`.)\]]*)$/.test(lastParagraph)) return true;

  return /\b(?:dites?-moi|dis-moi|choisis(?:sez)?|selectionnez|sélectionnez|preferez-vous|préférez-vous|souhaitez-vous|veux-tu|pouvez-vous|j['’]ai besoin de votre|your (?:choice|answer|input)|please (?:choose|confirm|tell me))\b/i.test(
    lastParagraph,
  );
};

export const conversationWaitsForUser = (messages: RuntimeChatMessage[]): boolean => {
  const last = messages[messages.length - 1];
  return !!last && last.role === "assistant" && messageRequestsUserInput(last.text);
};

export const formatChatDuration = (seconds: number): string => {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  if (safe < 60) return `${safe} s`;
  if (safe < 3600) {
    const minutes = Math.floor(safe / 60);
    const remainder = safe % 60;
    return remainder ? `${minutes} min ${remainder.toString().padStart(2, "0")} s` : `${minutes} min`;
  }
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return minutes ? `${hours} h ${minutes.toString().padStart(2, "0")} min` : `${hours} h`;
};

export const formatChatResetCountdown = (resetAt: number, now = Date.now() / 1000): string => {
  const remaining = Math.max(0, Math.floor(resetAt - now));
  if (remaining <= 0) return "maintenant";
  if (remaining < 60) return `dans ${remaining} s`;
  if (remaining < 3600) return `dans ${Math.ceil(remaining / 60)} min`;
  if (remaining < 86_400) {
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    return minutes ? `dans ${hours} h ${minutes} min` : `dans ${hours} h`;
  }
  const days = Math.floor(remaining / 86_400);
  const hours = Math.floor((remaining % 86_400) / 3600);
  return hours ? `dans ${days} j ${hours} h` : `dans ${days} j`;
};
