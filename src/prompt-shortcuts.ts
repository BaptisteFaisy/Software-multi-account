export const PROMPTS_STORAGE_KEY = "codex-switch-terminal.prompts.v1";

export type FavoritePromptShortcut = {
  id: string;
  title: string;
  content: string;
};

export type PromptShortcutStorage = Pick<Storage, "getItem">;

type StoredFavoritePromptShortcut = FavoritePromptShortcut & {
  updatedAt: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const shortcutText = (value: unknown, maxLength: number): string =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

export const favoritePromptShortcutsFromValue = (
  value: unknown,
): FavoritePromptShortcut[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const shortcuts: StoredFavoritePromptShortcut[] = [];
  value.forEach((candidate) => {
    if (!isRecord(candidate) || candidate.favorite !== true) return;
    const id = shortcutText(candidate.id, 180);
    const title = shortcutText(candidate.title, 160).replace(/\s+/g, " ");
    const content = shortcutText(candidate.content, 50_000);
    if (!id || !title || !content || seen.has(id)) return;
    seen.add(id);
    shortcuts.push({
      id,
      title,
      content,
      updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
        ? candidate.updatedAt
        : 0,
    });
  });

  return shortcuts
    .sort((left, right) =>
      right.updatedAt - left.updatedAt
      || left.title.localeCompare(right.title, "fr-FR"))
    .map(({ id, title, content }) => ({ id, title, content }));
};

const browserStorage = (): PromptShortcutStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

let cachedStorage: PromptShortcutStorage | null = null;
let cachedSerialized: string | null | undefined;
let cachedShortcuts: FavoritePromptShortcut[] = [];

export const loadFavoritePromptShortcuts = (
  storage?: PromptShortcutStorage | null,
): FavoritePromptShortcut[] => {
  const target = storage === undefined ? browserStorage() : storage;
  if (!target) return [];
  try {
    const serialized = target.getItem(PROMPTS_STORAGE_KEY);
    if (target === cachedStorage && serialized === cachedSerialized) return cachedShortcuts;
    cachedStorage = target;
    cachedSerialized = serialized;
    cachedShortcuts = serialized
      ? favoritePromptShortcutsFromValue(JSON.parse(serialized))
      : [];
    return cachedShortcuts;
  } catch {
    cachedStorage = target;
    cachedSerialized = undefined;
    cachedShortcuts = [];
    return cachedShortcuts;
  }
};
