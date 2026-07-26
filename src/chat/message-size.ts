/**
 * Bornes de taille d'un message de chat.
 *
 * L'application compose elle-meme certains prompts que personne n'a tapes :
 * l'amorce de reprise d'une conversation sur un autre compte, le passage de
 * relais d'une orchestration. Ils sont volumineux par construction. Affiches
 * bruts, ils remplissent la conversation d'un pave de plusieurs dizaines de
 * milliers de caracteres qui ressemble a un message de l'utilisateur.
 *
 * On separe donc ce qui est ENVOYE au modele -- complet, borne cote Rust par
 * `MAX_PROMPT_BYTES` -- de ce qui est AFFICHE dans la bulle, qui doit rester
 * lisible et dire explicitement ce qu'il masque.
 */

/** Au-dela, une bulle est tronquee et annonce ce qu'elle cache. */
export const CHAT_BUBBLE_MAX_CHARS = 20_000;

/**
 * Plafond du composeur. Il ne gene aucun collage reel ; il empeche seulement
 * qu'un collage accidentel de plusieurs mega-octets parte vers le serveur pour
 * y etre rejete apres coup.
 */
export const CHAT_COMPOSER_MAX_CHARS = 200_000;

const frenchCount = (value: number): string =>
  value.toLocaleString("fr-FR").replace(/ | /g, " ");

/**
 * Texte de la bulle utilisateur. `displayText` prend le pas quand l'appel est
 * une soumission engendree par l'application ; sinon un prompt demesure est
 * tronque avec la mention de ce qui manque.
 */
export const chatBubbleText = (prompt: string, displayText?: string | null): string => {
  if (displayText) return displayText;
  if (prompt.length <= CHAT_BUBBLE_MAX_CHARS) return prompt;
  const hidden = prompt.length - CHAT_BUBBLE_MAX_CHARS;
  return `${prompt.slice(0, CHAT_BUBBLE_MAX_CHARS)}\n\n[… message tronque a l'affichage : ${frenchCount(hidden)} caracteres masques. Le modele a recu le texte complet.]`;
};

/**
 * Resume affiche a la place d'une amorce de reprise. Le prompt reel part en
 * entier au modele : seule la bulle est remplacee.
 */
export const resumeSeedBubbleText = (prompt: string): string =>
  `↻ Reprise de la conversation sur un autre compte — ${frenchCount(prompt.length)} caracteres d'historique transmis au modele.`;
