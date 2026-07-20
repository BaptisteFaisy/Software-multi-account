import { PROMPTS_STORAGE_KEY } from "./prompt-shortcuts.ts";

export { PROMPTS_STORAGE_KEY } from "./prompt-shortcuts.ts";
export const PROMPT_TITLE_MAX_LENGTH = 160;
export const PROMPT_CONTENT_MAX_LENGTH = 50_000;
export const PROMPT_CATEGORY_MAX_LENGTH = 64;
export const PROMPT_TAG_MAX_LENGTH = 40;
export const PROMPT_TAG_LIMIT = 10;

export type PromptLibraryScope = "all" | "favorites";

export type PromptLibraryItem = {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt: number | null;
};

export type PromptLibraryDraft = {
  title: unknown;
  content: unknown;
  category?: unknown;
  tags?: unknown;
  favorite?: unknown;
};

export type PromptLibraryStorage = Pick<Storage, "getItem" | "setItem">;

type PromptLibraryPanelOptions = {
  storage?: PromptLibraryStorage | null;
  renderIcons?: (root: ParentNode) => void;
  onUsePrompt?: (prompt: PromptLibraryItem) => void | Promise<void>;
};

export type PromptQuickPickerOptions = PromptLibraryPanelOptions & {
  onManagePrompts?: () => void;
};

const DEFAULT_PROMPT_CATEGORY = "Général";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finiteTimestamp = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

const nullableTimestamp = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;

const normalizeSingleLine = (value: unknown, maxLength: number): string =>
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, maxLength)
    : "";

export const normalizePromptTitle = (value: unknown): string =>
  normalizeSingleLine(value, PROMPT_TITLE_MAX_LENGTH);

export const normalizePromptContent = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, PROMPT_CONTENT_MAX_LENGTH) : "";

export const normalizePromptCategory = (value: unknown): string =>
  normalizeSingleLine(value, PROMPT_CATEGORY_MAX_LENGTH) || DEFAULT_PROMPT_CATEGORY;

export const normalizePromptTags = (value: unknown): string[] => {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\n]/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of candidates) {
    const tag = normalizeSingleLine(candidate, PROMPT_TAG_MAX_LENGTH);
    const key = tag.toLocaleLowerCase("fr-FR");
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= PROMPT_TAG_LIMIT) break;
  }
  return tags;
};

export const normalizePromptItems = (
  value: unknown,
  fallbackTimestamp = Date.now(),
): PromptLibraryItem[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: PromptLibraryItem[] = [];

  value.forEach((candidate) => {
    if (!isRecord(candidate)) return;
    const id = normalizeSingleLine(candidate.id, 180);
    const title = normalizePromptTitle(candidate.title);
    const content = normalizePromptContent(candidate.content);
    if (!id || !title || !content || seen.has(id)) return;
    seen.add(id);

    const createdAt = finiteTimestamp(candidate.createdAt, fallbackTimestamp);
    const updatedAt = Math.max(createdAt, finiteTimestamp(candidate.updatedAt, createdAt));
    const rawUseCount = typeof candidate.useCount === "number" && Number.isFinite(candidate.useCount)
      ? candidate.useCount
      : 0;
    normalized.push({
      id,
      title,
      content,
      category: normalizePromptCategory(candidate.category),
      tags: normalizePromptTags(candidate.tags),
      favorite: candidate.favorite === true,
      createdAt,
      updatedAt,
      useCount: Math.max(0, Math.floor(rawUseCount)),
      lastUsedAt: nullableTimestamp(candidate.lastUsedAt),
    });
  });

  return normalized;
};

const browserPromptStorage = (): PromptLibraryStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const resolveStorage = (
  storage: PromptLibraryStorage | null | undefined,
): PromptLibraryStorage | null => storage === undefined ? browserPromptStorage() : storage;

export const loadPromptItems = (
  storage?: PromptLibraryStorage | null,
): PromptLibraryItem[] => {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const serialized = target.getItem(PROMPTS_STORAGE_KEY);
    return serialized ? normalizePromptItems(JSON.parse(serialized)) : [];
  } catch {
    return [];
  }
};

export const persistPromptItems = (
  items: readonly PromptLibraryItem[],
  storage?: PromptLibraryStorage | null,
): boolean => {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(normalizePromptItems(items)));
    return true;
  } catch {
    return false;
  }
};

const createPromptId = (timestamp: number): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `prompt-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const addPromptItem = (
  items: readonly PromptLibraryItem[],
  draft: PromptLibraryDraft,
  timestamp = Date.now(),
  id = createPromptId(timestamp),
): PromptLibraryItem[] => {
  const title = normalizePromptTitle(draft.title);
  const content = normalizePromptContent(draft.content);
  if (!title || !content) return [...items];
  const uniqueId = items.some((item) => item.id === id) ? createPromptId(timestamp + 1) : id;
  return [{
    id: uniqueId,
    title,
    content,
    category: normalizePromptCategory(draft.category),
    tags: normalizePromptTags(draft.tags),
    favorite: draft.favorite === true,
    createdAt: Math.floor(timestamp),
    updatedAt: Math.floor(timestamp),
    useCount: 0,
    lastUsedAt: null,
  }, ...items];
};

export const updatePromptItem = (
  items: readonly PromptLibraryItem[],
  id: string,
  draft: PromptLibraryDraft,
  timestamp = Date.now(),
): PromptLibraryItem[] => {
  const title = normalizePromptTitle(draft.title);
  const content = normalizePromptContent(draft.content);
  if (!title || !content) return [...items];
  return items.map((item) => item.id === id
    ? {
        ...item,
        title,
        content,
        category: normalizePromptCategory(draft.category),
        tags: normalizePromptTags(draft.tags),
        favorite: draft.favorite === true,
        updatedAt: Math.max(item.createdAt, Math.floor(timestamp)),
      }
    : item);
};

export const removePromptItem = (
  items: readonly PromptLibraryItem[],
  id: string,
): PromptLibraryItem[] => items.filter((item) => item.id !== id);

export const togglePromptFavorite = (
  items: readonly PromptLibraryItem[],
  id: string,
  timestamp = Date.now(),
): PromptLibraryItem[] => items.map((item) => item.id === id
  ? { ...item, favorite: !item.favorite, updatedAt: Math.max(item.createdAt, Math.floor(timestamp)) }
  : item);

export const markPromptUsed = (
  items: readonly PromptLibraryItem[],
  id: string,
  timestamp = Date.now(),
): PromptLibraryItem[] => items.map((item) => item.id === id
  ? {
      ...item,
      useCount: item.useCount + 1,
      lastUsedAt: Math.floor(timestamp),
    }
    : item);

export const recordPromptUse = (
  id: string,
  storage?: PromptLibraryStorage | null,
  timestamp = Date.now(),
): boolean => {
  const items = loadPromptItems(storage);
  if (!items.some((item) => item.id === id)) return false;
  return persistPromptItems(markPromptUsed(items, id, timestamp), storage);
};

const comparableText = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLocaleLowerCase("fr-FR");

export const searchPromptItems = (
  items: readonly PromptLibraryItem[],
  searchValue: unknown,
): PromptLibraryItem[] => {
  const search = typeof searchValue === "string" ? comparableText(searchValue.trim()) : "";
  if (!search) return [...items];
  const terms = search.split(/\s+/).filter(Boolean);
  return items.filter((item) => {
    const haystack = comparableText([
      item.title,
      item.content,
      item.category,
      ...item.tags,
    ].join("\n"));
    return terms.every((term) => haystack.includes(term));
  });
};

export const filterPromptItems = (
  items: readonly PromptLibraryItem[],
  options: {
    search?: unknown;
    category?: string | null;
    scope?: PromptLibraryScope;
  } = {},
): PromptLibraryItem[] => {
  const category = options.category && options.category !== "all"
    ? comparableText(options.category)
    : null;
  const filtered = searchPromptItems(items, options.search).filter((item) => {
    if (options.scope === "favorites" && !item.favorite) return false;
    return !category || comparableText(item.category) === category;
  });
  return filtered.sort((left, right) =>
    Number(right.favorite) - Number(left.favorite)
    || right.updatedAt - left.updatedAt
    || left.title.localeCompare(right.title, "fr-FR"));
};

export const promptCategories = (
  items: readonly PromptLibraryItem[],
): Array<{ name: string; count: number }> => {
  const categories = new Map<string, { name: string; count: number }>();
  items.forEach((item) => {
    const key = comparableText(item.category);
    const current = categories.get(key);
    if (current) current.count += 1;
    else categories.set(key, { name: item.category, count: 1 });
  });
  return Array.from(categories.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "fr-FR"));
};

export const promptLibraryStats = (items: readonly PromptLibraryItem[]) => ({
  total: items.length,
  favorites: items.filter((item) => item.favorite).length,
  categories: promptCategories(items).length,
  uses: items.reduce((sum, item) => sum + item.useCount, 0),
});

export const parsePromptImport = (
  value: unknown,
  fallbackTimestamp = Date.now(),
): PromptLibraryItem[] => {
  const rawItems = isRecord(value) && Array.isArray(value.prompts) ? value.prompts : value;
  if (!Array.isArray(rawItems)) return [];
  const prepared = rawItems.map((candidate, index) => {
    if (!isRecord(candidate)) return candidate;
    return {
      ...candidate,
      id: normalizeSingleLine(candidate.id, 180)
        || createPromptId(fallbackTimestamp + index),
    };
  });
  return normalizePromptItems(prepared, fallbackTimestamp);
};

export const mergePromptItems = (
  current: readonly PromptLibraryItem[],
  imported: readonly PromptLibraryItem[],
): PromptLibraryItem[] => {
  const merged = new Map(current.map((item) => [item.id, item]));
  imported.forEach((item) => {
    const existing = merged.get(item.id);
    if (!existing || item.updatedAt >= existing.updatedAt) merged.set(item.id, item);
  });
  return Array.from(merged.values()).sort((left, right) => right.updatedAt - left.updatedAt);
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character] ?? character);

const formatPromptDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Récemment";
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  if (sameDay) {
    return `Aujourd’hui, ${new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)}`;
  }
  return new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric",
  }).format(date);
};

const promptCountLabel = (count: number): string =>
  `${count} prompt${count === 1 ? "" : "s"}`;

let promptSearch = "";
let promptScope: PromptLibraryScope = "all";
let promptCategory = "all";
let promptEditorOpen = false;
let promptEditorId: string | null = null;
let promptFeedback = "";

const renderPromptEditor = (
  item: PromptLibraryItem | null,
  categories: readonly { name: string; count: number }[],
): string => {
  const category = item?.category ?? DEFAULT_PROMPT_CATEGORY;
  const tags = item?.tags.join(", ") ?? "";
  return `
    <section class="prompt-editor-card" aria-labelledby="promptEditorTitle">
      <div class="prompt-editor-head">
        <span><i data-lucide="message-square-text"></i></span>
        <div>
          <p>${item ? "Modification" : "Nouveau prompt"}</p>
          <h3 id="promptEditorTitle">${item ? escapeHtml(item.title) : "Ajouter à la bibliothèque"}</h3>
        </div>
        <button type="button" id="promptEditorCancel" class="prompt-icon-button" title="Fermer l’éditeur" aria-label="Fermer l’éditeur"><i data-lucide="x"></i></button>
      </div>
      <form id="promptEditorForm" class="prompt-editor-form">
        <div class="prompt-editor-meta">
          <label>
            <span>Titre <b>obligatoire</b></span>
            <input id="promptEditorTitleInput" name="title" maxlength="${PROMPT_TITLE_MAX_LENGTH}" value="${escapeHtml(item?.title ?? "")}" placeholder="Ex. Relecture de code exigeante" autocomplete="off" required />
          </label>
          <label>
            <span>Catégorie</span>
            <input id="promptEditorCategory" name="category" list="promptCategorySuggestions" maxlength="${PROMPT_CATEGORY_MAX_LENGTH}" value="${escapeHtml(category)}" placeholder="Général" autocomplete="off" />
            <datalist id="promptCategorySuggestions">${categories.map(({ name }) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
          </label>
          <label>
            <span>Tags <small>séparés par des virgules</small></span>
            <input id="promptEditorTags" name="tags" maxlength="${PROMPT_TAG_LIMIT * (PROMPT_TAG_MAX_LENGTH + 2)}" value="${escapeHtml(tags)}" placeholder="code, rédaction, analyse" autocomplete="off" />
          </label>
        </div>
        <label class="prompt-editor-content">
          <span>Contenu du prompt <b>obligatoire</b></span>
          <textarea id="promptEditorContent" name="content" maxlength="${PROMPT_CONTENT_MAX_LENGTH}" rows="10" placeholder="Écrivez ici les instructions que vous souhaitez réutiliser…" required>${escapeHtml(item?.content ?? "")}</textarea>
          <small><span id="promptContentCount">${item?.content.length ?? 0}</span> / ${PROMPT_CONTENT_MAX_LENGTH.toLocaleString("fr-FR")} caractères</small>
        </label>
        <div class="prompt-editor-footer">
          <label class="prompt-favorite-check">
            <input id="promptEditorFavorite" type="checkbox" ${item?.favorite ? "checked" : ""} />
            <span><i data-lucide="star"></i> Ajouter aux favoris</span>
          </label>
          <div>
            <button type="button" id="promptEditorCancelSecondary" class="prompt-secondary-button">Annuler</button>
            <button type="submit" class="prompt-primary-button"><i data-lucide="save"></i><span>${item ? "Enregistrer" : "Créer le prompt"}</span></button>
          </div>
        </div>
      </form>
    </section>`;
};

const renderPromptCard = (item: PromptLibraryItem): string => {
  const id = escapeHtml(item.id);
  const title = escapeHtml(item.title);
  const truncated = item.content.length > 520
    ? `${item.content.slice(0, 520).trimEnd()}…`
    : item.content;
  const usage = item.useCount
    ? `${item.useCount} utilisation${item.useCount > 1 ? "s" : ""}`
    : "Jamais utilisé";
  return `
    <article class="prompt-card ${item.favorite ? "is-favorite" : ""}" data-prompt-card="${id}" tabindex="-1">
      <header class="prompt-card-head">
        <span class="prompt-category-badge"><i data-lucide="tag"></i>${escapeHtml(item.category)}</span>
        <button type="button" class="prompt-favorite-button ${item.favorite ? "active" : ""}" data-prompt-favorite="${id}" aria-pressed="${item.favorite}" aria-label="${item.favorite ? "Retirer des favoris" : "Ajouter aux favoris"} : ${title}" title="${item.favorite ? "Retirer des favoris" : "Ajouter aux favoris"}"><i data-lucide="star"></i></button>
      </header>
      <div class="prompt-card-copy">
        <h3>${title}</h3>
        <p>${escapeHtml(truncated)}</p>
      </div>
      ${item.tags.length ? `<div class="prompt-tags" aria-label="Tags">${item.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <footer class="prompt-card-footer">
        <div class="prompt-card-meta">
          <span>Modifié ${escapeHtml(formatPromptDate(item.updatedAt))}</span>
          <small>${escapeHtml(usage)}</small>
        </div>
        <div class="prompt-card-actions">
          <button type="button" class="prompt-use-button" data-prompt-use="${id}" title="Placer ce prompt dans le chat"><i data-lucide="message-square-plus"></i><span>Utiliser</span></button>
          <button type="button" data-prompt-copy="${id}" title="Copier le prompt" aria-label="Copier : ${title}"><i data-lucide="copy"></i></button>
          <button type="button" data-prompt-edit="${id}" title="Modifier le prompt" aria-label="Modifier : ${title}"><i data-lucide="pencil"></i></button>
          <button type="button" class="prompt-delete-button" data-prompt-delete="${id}" title="Supprimer le prompt" aria-label="Supprimer : ${title}"><i data-lucide="trash-2"></i></button>
        </div>
      </footer>
    </article>`;
};

export const renderPromptLibraryPanel = (
  storage?: PromptLibraryStorage | null,
): string => {
  const items = loadPromptItems(storage);
  const stats = promptLibraryStats(items);
  const categories = promptCategories(items);
  if (promptCategory !== "all" && !categories.some(({ name }) => name === promptCategory)) {
    promptCategory = "all";
  }
  const visible = filterPromptItems(items, {
    search: promptSearch,
    category: promptCategory,
    scope: promptScope,
  });
  const editingItem = promptEditorId
    ? items.find((item) => item.id === promptEditorId) ?? null
    : null;
  const emptyTitle = items.length === 0
    ? "Votre bibliothèque est vide"
    : "Aucun prompt ne correspond";
  const emptyDetail = items.length === 0
    ? "Enregistrez vos meilleures instructions pour les retrouver en un instant."
    : "Essayez une autre recherche, catégorie ou affichez tous les prompts.";

  return `
    <section id="promptLibraryPanel" class="prompt-library-panel" aria-labelledby="promptLibraryTitle">
      <div class="prompt-library-shell">
        <header class="prompt-library-hero">
          <div class="prompt-library-heading">
            <span class="prompt-library-mark" aria-hidden="true"><i data-lucide="library"></i></span>
            <div>
              <p>Votre collection personnelle</p>
              <h2 id="promptLibraryTitle">Bibliothèque de prompts</h2>
              <span>Conservez, classez et réutilisez vos meilleures instructions.</span>
            </div>
          </div>
          <div class="prompt-library-hero-actions">
            <button type="button" id="promptImportButton" class="prompt-secondary-button"><i data-lucide="upload"></i><span>Importer</span></button>
            <input id="promptImportInput" type="file" accept="application/json,.json" hidden />
            <button type="button" id="promptExportButton" class="prompt-secondary-button" ${items.length ? "" : "disabled"}><i data-lucide="arrow-up-right"></i><span>Exporter</span></button>
            <button type="button" id="promptNewButton" class="prompt-primary-button"><i data-lucide="plus"></i><span>Nouveau prompt</span></button>
          </div>
        </header>

        <div class="prompt-library-overview" aria-label="Résumé de la bibliothèque">
          <div><span><i data-lucide="message-square-text"></i></span><p><strong>${stats.total}</strong><small>Prompt${stats.total === 1 ? "" : "s"}</small></p></div>
          <div><span><i data-lucide="star"></i></span><p><strong>${stats.favorites}</strong><small>Favori${stats.favorites === 1 ? "" : "s"}</small></p></div>
          <div><span><i data-lucide="tag"></i></span><p><strong>${stats.categories}</strong><small>Catégorie${stats.categories === 1 ? "" : "s"}</small></p></div>
          <div><span><i data-lucide="send"></i></span><p><strong>${stats.uses}</strong><small>Utilisation${stats.uses === 1 ? "" : "s"}</small></p></div>
        </div>

        ${promptEditorOpen ? renderPromptEditor(editingItem, categories) : ""}

        <div class="prompt-library-toolbar">
          <label class="prompt-search-field">
            <i data-lucide="search"></i>
            <span class="prompt-visually-hidden">Rechercher dans les prompts</span>
            <input id="promptLibrarySearch" type="search" value="${escapeHtml(promptSearch)}" placeholder="Rechercher un titre, un mot-clé, un tag…" autocomplete="off" />
            ${promptSearch ? `<button type="button" id="promptSearchClear" title="Effacer la recherche" aria-label="Effacer la recherche"><i data-lucide="x"></i></button>` : ""}
          </label>
          <div class="prompt-scope-tabs" role="group" aria-label="Filtrer les prompts">
            <button type="button" data-prompt-scope="all" class="${promptScope === "all" ? "active" : ""}" aria-pressed="${promptScope === "all"}">Tous <b>${stats.total}</b></button>
            <button type="button" data-prompt-scope="favorites" class="${promptScope === "favorites" ? "active" : ""}" aria-pressed="${promptScope === "favorites"}"><i data-lucide="star"></i> Favoris <b>${stats.favorites}</b></button>
          </div>
          <label class="prompt-category-select">
            <span class="prompt-visually-hidden">Filtrer par catégorie</span>
            <i data-lucide="tag"></i>
            <select id="promptCategoryFilter">
              <option value="all">Toutes les catégories</option>
              ${categories.map(({ name, count }) => `<option value="${escapeHtml(name)}" ${promptCategory === name ? "selected" : ""}>${escapeHtml(name)} · ${count}</option>`).join("")}
            </select>
            <i data-lucide="chevron-down"></i>
          </label>
        </div>

        <section class="prompt-library-results" aria-labelledby="promptResultsTitle">
          <header>
            <div><h3 id="promptResultsTitle">${promptScope === "favorites" ? "Prompts favoris" : "Tous les prompts"}</h3><span>${promptCountLabel(visible.length)} affiché${visible.length === 1 ? "" : "s"}</span></div>
            <p id="promptLibraryFeedback" aria-live="polite">${escapeHtml(promptFeedback)}</p>
          </header>
          ${visible.length
            ? `<div class="prompt-card-grid">${visible.map(renderPromptCard).join("")}</div>`
            : `<div class="prompt-library-empty"><span><i data-lucide="message-square-text"></i></span><h3>${emptyTitle}</h3><p>${emptyDetail}</p>${items.length === 0 ? `<button type="button" data-prompt-empty-create class="prompt-primary-button"><i data-lucide="plus"></i><span>Créer mon premier prompt</span></button>` : ""}</div>`}
        </section>

        <footer class="prompt-library-note"><i data-lucide="lock-keyhole"></i><span>Vos prompts sont enregistrés localement sur cet appareil. Utilisez l’export pour créer une sauvegarde.</span></footer>
      </div>
    </section>`;
};

const PROMPT_QUICK_PICKER_LIMIT = 12;

const quickPromptPreview = (content: string): string => {
  const compact = content.replace(/\s+/g, " ").trim();
  return compact.length > 150 ? `${compact.slice(0, 150).trimEnd()}…` : compact;
};

const renderPromptQuickResults = (
  items: readonly PromptLibraryItem[],
  search: string,
  scope: PromptLibraryScope,
): string => {
  const visible = filterPromptItems(items, { search, scope })
    .slice(0, PROMPT_QUICK_PICKER_LIMIT);
  if (!visible.length) {
    const libraryEmpty = items.length === 0;
    return `<div class="prompt-quick-empty">
      <span aria-hidden="true"><i data-lucide="${libraryEmpty ? "message-square-text" : "search-x"}"></i></span>
      <h3>${libraryEmpty ? "Aucun prompt enregistré" : "Aucun prompt trouvé"}</h3>
      <p>${libraryEmpty
        ? "Créez votre premier prompt pour pouvoir l’insérer ici en un clic."
        : "Modifiez la recherche ou affichez tous les prompts."}</p>
      ${libraryEmpty
        ? `<button type="button" class="prompt-primary-button" data-prompt-quick-manage><i data-lucide="plus"></i><span>Créer un prompt</span></button>`
        : ""}
    </div>`;
  }

  return `<div class="prompt-quick-list" role="list" aria-label="Prompts disponibles">
    ${visible.map((item) => {
      const id = escapeHtml(item.id);
      const title = escapeHtml(item.title);
      return `<article class="prompt-quick-item ${item.favorite ? "is-favorite" : ""}" role="listitem">
        <button type="button" class="prompt-quick-use" data-prompt-quick-use="${id}" title="Insérer : ${title}">
          <span class="prompt-quick-item-meta">
            <span><i data-lucide="tag"></i>${escapeHtml(item.category)}</span>
            ${item.favorite ? `<span class="prompt-quick-favorite"><i data-lucide="star"></i>Favori</span>` : ""}
          </span>
          <strong>${title}</strong>
          <small>${escapeHtml(quickPromptPreview(item.content))}</small>
        </button>
        <button type="button" class="prompt-quick-copy" data-prompt-quick-copy="${id}" title="Copier le prompt" aria-label="Copier : ${title}"><i data-lucide="copy"></i></button>
      </article>`;
    }).join("")}
  </div>`;
};

/**
 * Ouvre un sélecteur léger au-dessus du chat. Le prompt choisi est confié au
 * composeur appelant : il n'est jamais envoyé automatiquement.
 */
export const openPromptQuickPicker = (
  options: PromptQuickPickerOptions = {},
): void => {
  document.querySelector<HTMLDialogElement>("#promptQuickPicker")?.close();

  const items = loadPromptItems(options.storage);
  const dialog = document.createElement("dialog");
  dialog.id = "promptQuickPicker";
  dialog.className = "prompt-quick-picker";
  dialog.setAttribute("aria-labelledby", "promptQuickPickerTitle");
  dialog.innerHTML = `<div class="prompt-quick-shell">
    <header class="prompt-quick-head">
      <span aria-hidden="true"><i data-lucide="message-square-text"></i></span>
      <div>
        <p>Insertion rapide</p>
        <h2 id="promptQuickPickerTitle">Choisir un prompt</h2>
      </div>
      <button type="button" class="prompt-icon-button" data-prompt-quick-close title="Fermer" aria-label="Fermer le sélecteur de prompts"><i data-lucide="x"></i></button>
    </header>
    <div class="prompt-quick-tools">
      <label class="prompt-quick-search">
        <i data-lucide="search"></i>
        <span class="prompt-visually-hidden">Rechercher un prompt</span>
        <input id="promptQuickSearch" type="search" placeholder="Rechercher un prompt…" autocomplete="off" />
      </label>
      <div class="prompt-quick-scopes" role="group" aria-label="Filtrer les prompts">
        <button type="button" class="active" data-prompt-quick-scope="all" aria-pressed="true">Tous</button>
        <button type="button" data-prompt-quick-scope="favorites" aria-pressed="false"><i data-lucide="star"></i>Favoris</button>
      </div>
    </div>
    <div class="prompt-quick-results" data-prompt-quick-results>
      ${renderPromptQuickResults(items, "", "all")}
    </div>
    <footer class="prompt-quick-footer">
      <p data-prompt-quick-status role="status" aria-live="polite">${promptCountLabel(items.length)} disponible${items.length === 1 ? "" : "s"}</p>
      <button type="button" class="prompt-secondary-button" data-prompt-quick-manage><i data-lucide="library"></i><span>Gérer la bibliothèque</span></button>
    </footer>
  </div>`;

  const returnFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  let search = "";
  let scope: PromptLibraryScope = "all";
  let usingPrompt = false;
  let restoreFocus = true;

  const status = (message: string): void => {
    const target = dialog.querySelector<HTMLElement>("[data-prompt-quick-status]");
    if (target) target.textContent = message;
  };
  const renderResults = (): void => {
    const target = dialog.querySelector<HTMLElement>("[data-prompt-quick-results]");
    if (!target) return;
    target.innerHTML = renderPromptQuickResults(items, search, scope);
    options.renderIcons?.(target);
  };
  const close = (): void => {
    if (dialog.open) dialog.close();
    else dialog.remove();
  };

  dialog.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (target === dialog || target?.closest("[data-prompt-quick-close]")) {
      close();
      return;
    }

    const scopeButton = target?.closest<HTMLButtonElement>("[data-prompt-quick-scope]");
    if (scopeButton) {
      const nextScope = scopeButton.dataset.promptQuickScope;
      if (nextScope !== "all" && nextScope !== "favorites") return;
      scope = nextScope;
      dialog.querySelectorAll<HTMLButtonElement>("[data-prompt-quick-scope]").forEach((button) => {
        const active = button.dataset.promptQuickScope === scope;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", String(active));
      });
      status(scope === "favorites" ? "Prompts favoris" : "Tous les prompts");
      renderResults();
      return;
    }

    const manageButton = target?.closest<HTMLButtonElement>("[data-prompt-quick-manage]");
    if (manageButton) {
      restoreFocus = false;
      close();
      options.onManagePrompts?.();
      return;
    }

    const copyButton = target?.closest<HTMLButtonElement>("[data-prompt-quick-copy]");
    if (copyButton) {
      const item = items.find((candidate) => candidate.id === copyButton.dataset.promptQuickCopy);
      if (!item) return;
      void navigator.clipboard.writeText(item.content).then(() => {
        status(`« ${item.title} » copié dans le presse-papiers.`);
        copyButton.classList.add("copied");
        window.setTimeout(() => copyButton.classList.remove("copied"), 1200);
      }).catch(() => status("Copie impossible : le presse-papiers n’est pas disponible."));
      return;
    }

    const useButton = target?.closest<HTMLButtonElement>("[data-prompt-quick-use]");
    if (!useButton || usingPrompt) return;
    const item = items.find((candidate) => candidate.id === useButton.dataset.promptQuickUse);
    if (!item) return;
    usingPrompt = true;
    useButton.disabled = true;
    status(`Insertion de « ${item.title} »…`);
    const usedItems = markPromptUsed(items, item.id);
    const used = usedItems.find((candidate) => candidate.id === item.id) ?? item;
    void Promise.resolve()
      .then(() => options.onUsePrompt
        ? options.onUsePrompt(used)
        : navigator.clipboard.writeText(used.content))
      .then(() => {
        persistPromptItems(usedItems, options.storage);
        restoreFocus = false;
        close();
      })
      .catch(() => {
        usingPrompt = false;
        useButton.disabled = false;
        status("Impossible d’insérer ce prompt dans le chat.");
      });
  });
  dialog.querySelector<HTMLInputElement>("#promptQuickSearch")?.addEventListener(
    "input",
    (event) => {
      search = (event.currentTarget as HTMLInputElement).value.slice(0, 500);
      status(search ? "Résultats de la recherche" : promptCountLabel(items.length));
      renderResults();
    },
  );
  dialog.addEventListener("close", () => {
    dialog.remove();
    if (restoreFocus && returnFocus?.isConnected) {
      window.requestAnimationFrame(() => returnFocus.focus());
    }
  }, { once: true });

  document.body.appendChild(dialog);
  options.renderIcons?.(dialog);
  dialog.showModal();
  window.requestAnimationFrame(() =>
    dialog.querySelector<HTMLInputElement>("#promptQuickSearch")?.focus());
};

type PromptFocusTarget =
  | "search"
  | "title"
  | { kind: "card" | "favorite"; id: string }
  | null;

const focusPromptTarget = (root: HTMLElement, target: PromptFocusTarget): void => {
  if (!target) return;
  if (target === "search") {
    const input = root.querySelector<HTMLInputElement>("#promptLibrarySearch");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    return;
  }
  if (target === "title") {
    root.querySelector<HTMLInputElement>("#promptEditorTitleInput")?.focus();
    return;
  }
  const selector = target.kind === "favorite"
    ? `[data-prompt-favorite="${CSS.escape(target.id)}"]`
    : `[data-prompt-card="${CSS.escape(target.id)}"]`;
  root.querySelector<HTMLElement>(selector)?.focus();
};

const downloadPromptExport = (items: readonly PromptLibraryItem[]): void => {
  const payload = JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    prompts: items,
  }, null, 2);
  const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bibliotheque-prompts-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

export const mountPromptLibraryPanel = (
  options: PromptLibraryPanelOptions = {},
): void => {
  const root = document.querySelector<HTMLElement>("#promptLibraryPanel");
  if (!root) return;

  const refresh = (focus: PromptFocusTarget = null): void => {
    const currentRoot = document.querySelector<HTMLElement>("#promptLibraryPanel");
    if (!currentRoot) return;
    currentRoot.outerHTML = renderPromptLibraryPanel(options.storage);
    const nextRoot = document.querySelector<HTMLElement>("#promptLibraryPanel");
    if (!nextRoot) return;
    options.renderIcons?.(nextRoot);
    mountPromptLibraryPanel(options);
    queueMicrotask(() => focusPromptTarget(nextRoot, focus));
  };

  const save = (
    items: PromptLibraryItem[],
    message: string,
    focus: PromptFocusTarget = null,
  ): boolean => {
    const persisted = persistPromptItems(items, options.storage);
    promptFeedback = persisted
      ? message
      : "Impossible d’enregistrer les prompts sur cet appareil.";
    refresh(focus);
    return persisted;
  };

  const openEditor = (id: string | null): void => {
    promptEditorId = id;
    promptEditorOpen = true;
    promptFeedback = "";
    refresh("title");
  };

  root.querySelector<HTMLButtonElement>("#promptNewButton")?.addEventListener("click", () =>
    openEditor(null));
  root.querySelector<HTMLButtonElement>("[data-prompt-empty-create]")?.addEventListener(
    "click",
    () => openEditor(null),
  );

  const closeEditor = (): void => {
    promptEditorOpen = false;
    promptEditorId = null;
    promptFeedback = "";
    refresh();
  };
  root.querySelector<HTMLButtonElement>("#promptEditorCancel")?.addEventListener(
    "click",
    closeEditor,
  );
  root.querySelector<HTMLButtonElement>("#promptEditorCancelSecondary")?.addEventListener(
    "click",
    closeEditor,
  );

  const editorContent = root.querySelector<HTMLTextAreaElement>("#promptEditorContent");
  editorContent?.addEventListener("input", () => {
    const counter = root.querySelector<HTMLElement>("#promptContentCount");
    if (counter) counter.textContent = String(editorContent.value.length);
    editorContent.setCustomValidity("");
  });
  root.querySelector<HTMLInputElement>("#promptEditorTitleInput")?.addEventListener(
    "input",
    (event) => (event.currentTarget as HTMLInputElement).setCustomValidity(""),
  );

  root.querySelector<HTMLFormElement>("#promptEditorForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const titleInput = root.querySelector<HTMLInputElement>("#promptEditorTitleInput");
    const contentInput = root.querySelector<HTMLTextAreaElement>("#promptEditorContent");
    const title = normalizePromptTitle(titleInput?.value);
    const content = normalizePromptContent(contentInput?.value);
    if (!title) {
      titleInput?.setCustomValidity("Donnez un titre à ce prompt.");
      titleInput?.reportValidity();
      return;
    }
    if (!content) {
      contentInput?.setCustomValidity("Le contenu du prompt ne peut pas être vide.");
      contentInput?.reportValidity();
      return;
    }
    titleInput?.setCustomValidity("");
    contentInput?.setCustomValidity("");
    const draft: PromptLibraryDraft = {
      title,
      content,
      category: root.querySelector<HTMLInputElement>("#promptEditorCategory")?.value,
      tags: root.querySelector<HTMLInputElement>("#promptEditorTags")?.value,
      favorite: root.querySelector<HTMLInputElement>("#promptEditorFavorite")?.checked,
    };
    const current = loadPromptItems(options.storage);
    const id = promptEditorId;
    const next = id
      ? updatePromptItem(current, id, draft)
      : addPromptItem(current, draft);
    const savedId = id ?? next.find((item) => !current.some((old) => old.id === item.id))?.id ?? null;
    promptEditorOpen = false;
    promptEditorId = null;
    save(next, id ? "Prompt modifié." : "Prompt ajouté à la bibliothèque.", savedId
      ? { kind: "card", id: savedId }
      : null);
  });

  root.querySelector<HTMLInputElement>("#promptLibrarySearch")?.addEventListener("input", (event) => {
    promptSearch = (event.currentTarget as HTMLInputElement).value.slice(0, 500);
    promptFeedback = "";
    refresh("search");
  });
  root.querySelector<HTMLButtonElement>("#promptSearchClear")?.addEventListener("click", () => {
    promptSearch = "";
    promptFeedback = "";
    refresh("search");
  });

  root.querySelectorAll<HTMLButtonElement>("[data-prompt-scope]").forEach((button) => {
    button.addEventListener("click", () => {
      const scope = button.dataset.promptScope;
      if (scope !== "all" && scope !== "favorites") return;
      promptScope = scope;
      promptFeedback = "";
      refresh();
    });
  });
  root.querySelector<HTMLSelectElement>("#promptCategoryFilter")?.addEventListener(
    "change",
    (event) => {
      promptCategory = (event.currentTarget as HTMLSelectElement).value;
      promptFeedback = "";
      refresh();
    },
  );

  root.querySelectorAll<HTMLButtonElement>("[data-prompt-favorite]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.promptFavorite;
      if (!id) return;
      const current = loadPromptItems(options.storage);
      const wasFavorite = current.find((item) => item.id === id)?.favorite === true;
      save(
        togglePromptFavorite(current, id),
        wasFavorite ? "Prompt retiré des favoris." : "Prompt ajouté aux favoris.",
        { kind: "favorite", id },
      );
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-prompt-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.promptEdit;
      if (id) openEditor(id);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-prompt-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.promptDelete;
      const current = loadPromptItems(options.storage);
      const item = current.find((candidate) => candidate.id === id);
      if (!id || !item || !window.confirm(`Supprimer définitivement « ${item.title} » ?`)) return;
      if (promptEditorId === id) {
        promptEditorId = null;
        promptEditorOpen = false;
      }
      save(removePromptItem(current, id), "Prompt supprimé.");
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-prompt-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.promptCopy;
      const item = loadPromptItems(options.storage).find((candidate) => candidate.id === id);
      if (!item) return;
      void navigator.clipboard.writeText(item.content).then(() => {
        promptFeedback = `« ${item.title} » copié dans le presse-papiers.`;
        refresh({ kind: "card", id: item.id });
      }).catch(() => {
        promptFeedback = "Copie impossible : le presse-papiers n’est pas disponible.";
        refresh({ kind: "card", id: item.id });
      });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-prompt-use]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.promptUse;
      const current = loadPromptItems(options.storage);
      const item = current.find((candidate) => candidate.id === id);
      if (!item) return;
      const next = markPromptUsed(current, item.id);
      const used = next.find((candidate) => candidate.id === item.id) ?? item;
      const persisted = persistPromptItems(next, options.storage);
      promptFeedback = persisted
        ? `« ${item.title} » est prêt dans le chat.`
        : "Le prompt va être utilisé, mais son compteur n’a pas pu être enregistré.";
      if (options.onUsePrompt) {
        void Promise.resolve(options.onUsePrompt(used)).catch(() => {
          promptFeedback = "Impossible d’ouvrir ce prompt dans le chat.";
          refresh({ kind: "card", id: item.id });
        });
      } else {
        void navigator.clipboard.writeText(item.content).then(() =>
          refresh({ kind: "card", id: item.id }));
      }
    });
  });

  root.querySelector<HTMLButtonElement>("#promptExportButton")?.addEventListener("click", () => {
    const items = loadPromptItems(options.storage);
    if (!items.length) return;
    downloadPromptExport(items);
    promptFeedback = "Sauvegarde JSON exportée.";
    refresh();
  });
  const importInput = root.querySelector<HTMLInputElement>("#promptImportInput");
  root.querySelector<HTMLButtonElement>("#promptImportButton")?.addEventListener("click", () =>
    importInput?.click());
  importInput?.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const imported = parsePromptImport(JSON.parse(text));
      if (!imported.length) throw new Error("empty");
      const current = loadPromptItems(options.storage);
      const next = mergePromptItems(current, imported);
      promptEditorOpen = false;
      promptEditorId = null;
      save(next, `${promptCountLabel(imported.length)} importé${imported.length === 1 ? "" : "s"}.`);
    }).catch(() => {
      promptFeedback = "Import impossible : choisissez une sauvegarde JSON valide.";
      refresh();
    });
  });
};
