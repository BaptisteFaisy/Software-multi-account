export type ExpertGridLayout = "auto" | "2" | "3" | "4";

export const EXPERT_CHAT_PAGE_SIZES = [6, 9, 12, 16] as const;
export type ExpertChatPageSize = (typeof EXPERT_CHAT_PAGE_SIZES)[number];
export type ExpertChatPageSizeMode = "auto" | ExpertChatPageSize;
export type ExpertChatDisplayMode = "all" | "available";

export const DEFAULT_EXPERT_CHAT_PAGE_SIZE: ExpertChatPageSize = 6;
export const DEFAULT_EXPERT_CHAT_PAGE_SIZE_MODE: ExpertChatPageSizeMode = "auto";
export const DEFAULT_EXPERT_CHAT_DISPLAY_MODE: ExpertChatDisplayMode = "all";
export const normalizeExpertChatPageSize = (value: unknown): ExpertChatPageSize =>
  EXPERT_CHAT_PAGE_SIZES.find((pageSize) => pageSize === Number(value))
  ?? DEFAULT_EXPERT_CHAT_PAGE_SIZE;

export const normalizeExpertChatPageSizeMode = (value: unknown): ExpertChatPageSizeMode => {
  if (value === "auto") return "auto";
  const numericValue = Number(value);
  return EXPERT_CHAT_PAGE_SIZES.find((pageSize) => pageSize === numericValue)
    ?? DEFAULT_EXPERT_CHAT_PAGE_SIZE_MODE;
};

export const normalizeExpertChatDisplayMode = (value: unknown): ExpertChatDisplayMode =>
  value === "available" ? "available" : DEFAULT_EXPERT_CHAT_DISPLAY_MODE;

/**
 * Le filtre reste independant du modele de chat : l'appelant fournit la notion
 * de disponibilite correspondant a son runtime (tour running/finalizing).
 */
export const expertChatsForDisplay = <T>(
  chats: readonly T[],
  mode: ExpertChatDisplayMode,
  isAvailable: (chat: T) => boolean,
): T[] => mode === "available" ? chats.filter(isAvailable) : [...chats];

/**
 * Le mode automatique conserve tous les chats visibles jusqu'a la capacite
 * maximale de la grille. Au-dela, la pagination existante prend le relais.
 */
export const resolveExpertChatPageSize = (
  mode: ExpertChatPageSizeMode,
): ExpertChatPageSize => mode === "auto" ? 16 : mode;

export const expertChatColumnCount = (pageSize: ExpertChatPageSize): number =>
  pageSize === 16 ? 4 : 3;

const normalizeCount = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;

export const expertChatPageCount = (
  openChatCount: number,
  pageSizeMode: ExpertChatPageSizeMode,
): number => Math.max(
  1,
  Math.ceil(normalizeCount(openChatCount) / resolveExpertChatPageSize(pageSizeMode)),
);

export const clampExpertChatPage = (
  page: number,
  openChatCount: number,
  pageSizeMode: ExpertChatPageSizeMode,
): number => {
  const lastPage = expertChatPageCount(openChatCount, pageSizeMode) - 1;
  const normalizedPage = Number.isFinite(page) ? Math.max(0, Math.trunc(page)) : 0;
  return Math.min(normalizedPage, lastPage);
};

export const expertChatPageForIndex = (
  index: number,
  pageSizeMode: ExpertChatPageSizeMode,
): number => Math.floor(normalizeCount(index) / resolveExpertChatPageSize(pageSizeMode));

export const expertChatsOnPage = <T>(
  chats: readonly T[],
  page: number,
  pageSizeMode: ExpertChatPageSizeMode,
): T[] => {
  const pageSize = resolveExpertChatPageSize(pageSizeMode);
  const normalizedPage = clampExpertChatPage(page, chats.length, pageSizeMode);
  const start = normalizedPage * pageSize;
  return chats.slice(start, start + pageSize);
};

export const expertChatRowCount = (pageSize: ExpertChatPageSize): number =>
  pageSize / expertChatColumnCount(pageSize);

export type ExpertChatGridDimensions = {
  columns: number;
  rows: number;
};

/**
 * En mode automatique, les panneaux remplissent les cases correspondant aux
 * chats reellement visibles au lieu de conserver les cases vides d'une page
 * de 6, 9, 12 ou 16 elements.
 */
export const expertChatGridDimensions = (
  visibleChatCount: number,
  mode: ExpertChatPageSizeMode,
): ExpertChatGridDimensions => {
  if (mode !== "auto") {
    return {
      columns: expertChatColumnCount(mode),
      rows: expertChatRowCount(mode),
    };
  }

  const count = Math.min(resolveExpertChatPageSize(mode), normalizeCount(visibleChatCount));
  if (count <= 1) return { columns: 1, rows: 1 };

  const columns = count <= 3
    ? count
    : count <= 4
      ? 2
      : count <= 12
        ? 3
        : 4;
  return { columns, rows: Math.ceil(count / columns) };
};
