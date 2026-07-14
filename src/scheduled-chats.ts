export const SCHEDULED_CHATS_STORAGE_KEY = "codex-switch-terminal.scheduled-chats.v1";
export const SCHEDULED_CHAT_PROMPT_MAX_LENGTH = 50_000;

export type ScheduledChatMode = "build" | "plan" | "ask";
export type ScheduledChatStatus =
  | "scheduled"
  | "launching"
  | "launched"
  | "failed"
  | "cancelled";

export type ScheduledChatItem = {
  id: string;
  prompt: string;
  environmentPath: string;
  accountId: string | null;
  mode: ScheduledChatMode;
  scheduledFor: number;
  status: ScheduledChatStatus;
  createdAt: number;
  updatedAt: number;
  launchedAt: number | null;
  error: string | null;
};

export type ScheduledChatEnvironment = {
  path: string;
  label: string;
};

export type ScheduledChatAccount = {
  id: string;
  label: string;
};

export type ScheduledChatStorage = Pick<Storage, "getItem" | "setItem">;

export type ScheduledChatDraft = {
  prompt: unknown;
  environmentPath: unknown;
  accountId?: unknown;
  mode?: unknown;
  scheduledFor: unknown;
};

export type ScheduledChatsPanelOptions = {
  storage?: ScheduledChatStorage | null;
  renderIcons?: (root: ParentNode) => void;
  environments?: readonly ScheduledChatEnvironment[];
  accounts?: readonly ScheduledChatAccount[];
  defaultEnvironmentPath?: string | null;
  defaultAccountId?: string | null;
  onItemsChanged?: (items: ScheduledChatItem[]) => void;
  onRequestDispatch?: () => void;
};

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

export const normalizeScheduledChatPrompt = (value: unknown): string =>
  typeof value === "string"
    ? value.replace(/\r\n?/g, "\n").trim().slice(0, SCHEDULED_CHAT_PROMPT_MAX_LENGTH)
    : "";

export const normalizeScheduledChatEnvironmentPath = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().slice(0, 4096);
  if (trimmed === "/" || /^[a-zA-Z]:[\\/]$/.test(trimmed)) return trimmed;
  return trimmed.replace(/[\\/]+$/, "");
};

export const normalizeScheduledChatMode = (value: unknown): ScheduledChatMode =>
  value === "plan" || value === "ask" ? value : "build";

const normalizeScheduledChatStatus = (value: unknown): ScheduledChatStatus => {
  if (
    value === "launching"
    || value === "launched"
    || value === "failed"
    || value === "cancelled"
  ) {
    return value;
  }
  return "scheduled";
};

export const normalizeScheduledChatItems = (
  value: unknown,
  fallbackTimestamp = Date.now(),
): ScheduledChatItem[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: ScheduledChatItem[] = [];

  value.forEach((candidate) => {
    if (!isRecord(candidate)) return;
    const id = normalizeSingleLine(candidate.id, 180);
    const prompt = normalizeScheduledChatPrompt(candidate.prompt);
    const environmentPath = normalizeScheduledChatEnvironmentPath(candidate.environmentPath);
    const scheduledFor = finiteTimestamp(candidate.scheduledFor, -1);
    if (!id || !prompt || !environmentPath || scheduledFor < 0 || seen.has(id)) return;
    seen.add(id);

    const createdAt = finiteTimestamp(candidate.createdAt, fallbackTimestamp);
    const updatedAt = Math.max(createdAt, finiteTimestamp(candidate.updatedAt, createdAt));
    const status = normalizeScheduledChatStatus(candidate.status);
    normalized.push({
      id,
      prompt,
      environmentPath,
      accountId: normalizeSingleLine(candidate.accountId, 180) || null,
      mode: normalizeScheduledChatMode(candidate.mode),
      scheduledFor,
      status,
      createdAt,
      updatedAt,
      launchedAt: status === "launched" ? nullableTimestamp(candidate.launchedAt) : null,
      error: status === "failed"
        ? normalizeSingleLine(candidate.error, 1_000) || "Le lancement a échoué."
        : null,
    });
  });

  return normalized;
};

const browserScheduledChatStorage = (): ScheduledChatStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const resolveStorage = (
  storage: ScheduledChatStorage | null | undefined,
): ScheduledChatStorage | null => storage === undefined ? browserScheduledChatStorage() : storage;

export const loadScheduledChatItems = (
  storage?: ScheduledChatStorage | null,
): ScheduledChatItem[] => {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const serialized = target.getItem(SCHEDULED_CHATS_STORAGE_KEY);
    return serialized ? normalizeScheduledChatItems(JSON.parse(serialized)) : [];
  } catch {
    return [];
  }
};

export const persistScheduledChatItems = (
  items: readonly ScheduledChatItem[],
  storage?: ScheduledChatStorage | null,
): boolean => {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(
      SCHEDULED_CHATS_STORAGE_KEY,
      JSON.stringify(normalizeScheduledChatItems(items)),
    );
    return true;
  } catch {
    return false;
  }
};

const createScheduledChatId = (timestamp: number): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId
    ?? `scheduled-chat-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const addScheduledChatItem = (
  items: readonly ScheduledChatItem[],
  draft: ScheduledChatDraft,
  timestamp = Date.now(),
  id = createScheduledChatId(timestamp),
): ScheduledChatItem[] => {
  const prompt = normalizeScheduledChatPrompt(draft.prompt);
  const environmentPath = normalizeScheduledChatEnvironmentPath(draft.environmentPath);
  const scheduledFor = finiteTimestamp(draft.scheduledFor, -1);
  if (!prompt || !environmentPath || scheduledFor <= timestamp) return [...items];
  const uniqueId = items.some((item) => item.id === id)
    ? createScheduledChatId(timestamp + 1)
    : id;
  return [{
    id: uniqueId,
    prompt,
    environmentPath,
    accountId: normalizeSingleLine(draft.accountId, 180) || null,
    mode: normalizeScheduledChatMode(draft.mode),
    scheduledFor,
    status: "scheduled",
    createdAt: Math.floor(timestamp),
    updatedAt: Math.floor(timestamp),
    launchedAt: null,
    error: null,
  }, ...items];
};

export const removeScheduledChatItem = (
  items: readonly ScheduledChatItem[],
  id: string,
): ScheduledChatItem[] => items.filter((item) => item.id !== id);

export const cancelScheduledChatItem = (
  items: readonly ScheduledChatItem[],
  id: string,
  timestamp = Date.now(),
): ScheduledChatItem[] => items.map((item) =>
  item.id === id && item.status === "scheduled"
    ? {
        ...item,
        status: "cancelled",
        updatedAt: Math.floor(timestamp),
        error: null,
      }
    : item,
);

export const rescheduleScheduledChatItem = (
  items: readonly ScheduledChatItem[],
  id: string,
  scheduledFor: number,
  timestamp = Date.now(),
): ScheduledChatItem[] => {
  if (!Number.isFinite(scheduledFor) || scheduledFor <= timestamp) return [...items];
  return items.map((item) => item.id === id
    ? {
        ...item,
        scheduledFor: Math.floor(scheduledFor),
        status: "scheduled",
        updatedAt: Math.floor(timestamp),
        launchedAt: null,
        error: null,
      }
    : item);
};

export const requestScheduledChatNow = (
  items: readonly ScheduledChatItem[],
  id: string,
  timestamp = Date.now(),
): ScheduledChatItem[] => items.map((item) => item.id === id && item.status !== "launching"
  ? {
      ...item,
      scheduledFor: Math.max(0, Math.floor(timestamp) - 1),
      status: "scheduled",
      updatedAt: Math.floor(timestamp),
      launchedAt: null,
      error: null,
    }
  : item);

export const claimScheduledChatItem = (
  items: readonly ScheduledChatItem[],
  id: string,
  timestamp = Date.now(),
): ScheduledChatItem[] => items.map((item) =>
  item.id === id && item.status === "scheduled" && item.scheduledFor <= timestamp
    ? {
        ...item,
        status: "launching",
        updatedAt: Math.floor(timestamp),
        error: null,
      }
    : item,
);

export const markScheduledChatLaunched = (
  items: readonly ScheduledChatItem[],
  id: string,
  timestamp = Date.now(),
): ScheduledChatItem[] => items.map((item) => item.id === id
  ? {
      ...item,
      status: "launched",
      updatedAt: Math.floor(timestamp),
      launchedAt: Math.floor(timestamp),
      error: null,
    }
  : item);

export const markScheduledChatFailed = (
  items: readonly ScheduledChatItem[],
  id: string,
  error: unknown,
  timestamp = Date.now(),
): ScheduledChatItem[] => items.map((item) => item.id === id
  ? {
      ...item,
      status: "failed",
      updatedAt: Math.floor(timestamp),
      launchedAt: null,
      error: normalizeSingleLine(error instanceof Error ? error.message : String(error), 1_000)
        || "Le lancement a échoué.",
    }
  : item);

export const recoverInterruptedScheduledChats = (
  items: readonly ScheduledChatItem[],
  timestamp = Date.now(),
  staleAfterMs = 5 * 60_000,
): ScheduledChatItem[] => items.map((item) =>
  item.status === "launching" && item.updatedAt <= timestamp - staleAfterMs
    ? {
        ...item,
        status: "failed",
        updatedAt: Math.floor(timestamp),
        error: "Le lancement a été interrompu. Vous pouvez relancer ce chat.",
      }
    : item,
);

export const dueScheduledChatItems = (
  items: readonly ScheduledChatItem[],
  timestamp = Date.now(),
): ScheduledChatItem[] => items
  .filter((item) => item.status === "scheduled" && item.scheduledFor <= timestamp)
  .sort((left, right) => left.scheduledFor - right.scheduledFor || left.createdAt - right.createdAt);

export const nextScheduledChatAt = (
  items: readonly ScheduledChatItem[],
): number | null => items.reduce<number | null>((next, item) => {
  if (item.status !== "scheduled") return next;
  return next === null || item.scheduledFor < next ? item.scheduledFor : next;
}, null);

export const scheduledChatPendingCount = (
  items: readonly ScheduledChatItem[],
): number => items.filter((item) => item.status === "scheduled" || item.status === "launching").length;

export const scheduledChatTitle = (item: Pick<ScheduledChatItem, "prompt">): string => {
  const firstLine = item.prompt.split("\n").find((line) => line.trim())?.trim() ?? "Chat planifié";
  return firstLine.length > 96 ? `${firstLine.slice(0, 95).trimEnd()}…` : firstLine;
};

export const localDateTimeInputValue = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

export const parseScheduledChatDateTime = (value: unknown): number | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

const defaultScheduledChatTimestamp = (timestamp = Date.now()): number => {
  const fiveMinutes = 5 * 60_000;
  return Math.ceil((timestamp + fiveMinutes) / fiveMinutes) * fiveMinutes;
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character] ?? character);

const formatScheduledChatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Date inconnue";
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const dateKey = (candidate: Date) => [
    candidate.getFullYear(),
    candidate.getMonth(),
    candidate.getDate(),
  ].join("-");
  const day = dateKey(date) === dateKey(now)
    ? "Aujourd’hui"
    : dateKey(date) === dateKey(tomorrow)
      ? "Demain"
      : new Intl.DateTimeFormat("fr-FR", {
          weekday: "short",
          day: "numeric",
          month: "short",
          year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
        }).format(date);
  const time = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  return `${day} à ${time}`;
};

const statusPresentation: Record<ScheduledChatStatus, {
  label: string;
  icon: string;
}> = {
  scheduled: { label: "Planifié", icon: "clock-3" },
  launching: { label: "Lancement…", icon: "loader-circle" },
  launched: { label: "Lancé", icon: "circle-check" },
  failed: { label: "À relancer", icon: "triangle-alert" },
  cancelled: { label: "Annulé", icon: "circle-slash" },
};

type ScheduledChatFormDraft = {
  prompt: string;
  scheduledFor: string;
  environmentPath: string;
  accountId: string;
  mode: ScheduledChatMode;
};

let scheduledChatFormDraft: ScheduledChatFormDraft | null = null;
let editingScheduledChatId: string | null = null;
let scheduledChatFeedback = "";

const panelEnvironments = (
  items: readonly ScheduledChatItem[],
  environments: readonly ScheduledChatEnvironment[],
): ScheduledChatEnvironment[] => {
  const byPath = new Map<string, ScheduledChatEnvironment>();
  environments.forEach((environment) => {
    const path = normalizeScheduledChatEnvironmentPath(environment.path);
    if (path) byPath.set(path.toLocaleLowerCase("en-US"), { ...environment, path });
  });
  items.forEach((item) => {
    const key = item.environmentPath.toLocaleLowerCase("en-US");
    if (!byPath.has(key)) byPath.set(key, { path: item.environmentPath, label: item.environmentPath });
  });
  return Array.from(byPath.values());
};

const ensureScheduledChatFormDraft = (
  options: ScheduledChatsPanelOptions,
  environments: readonly ScheduledChatEnvironment[],
): ScheduledChatFormDraft => {
  const availablePaths = new Set(environments.map((environment) => environment.path));
  const preferredEnvironment = normalizeScheduledChatEnvironmentPath(options.defaultEnvironmentPath);
  if (!scheduledChatFormDraft) {
    scheduledChatFormDraft = {
      prompt: "",
      scheduledFor: localDateTimeInputValue(defaultScheduledChatTimestamp()),
      environmentPath: availablePaths.has(preferredEnvironment)
        ? preferredEnvironment
        : environments[0]?.path ?? "",
      accountId: options.defaultAccountId ?? "",
      mode: "build",
    };
  }
  if (!availablePaths.has(scheduledChatFormDraft.environmentPath)) {
    scheduledChatFormDraft.environmentPath = availablePaths.has(preferredEnvironment)
      ? preferredEnvironment
      : environments[0]?.path ?? "";
  }
  return scheduledChatFormDraft;
};

const renderScheduledChatCard = (
  item: ScheduledChatItem,
  environments: readonly ScheduledChatEnvironment[],
  accounts: readonly ScheduledChatAccount[],
): string => {
  const id = escapeHtml(item.id);
  const status = statusPresentation[item.status];
  const environment = environments.find((candidate) =>
    candidate.path.toLocaleLowerCase("en-US") === item.environmentPath.toLocaleLowerCase("en-US"));
  const account = item.accountId
    ? accounts.find((candidate) => candidate.id === item.accountId)
    : null;
  const accountLabel = account?.label ?? (item.accountId ? "Compte indisponible" : "Compte par défaut");
  const modeLabel = item.mode === "plan" ? "Plan" : item.mode === "ask" ? "Question" : "Build";
  const editing = editingScheduledChatId === item.id;
  const canRun = item.status !== "launching";
  const canCancel = item.status === "scheduled";
  const isPending = item.status === "scheduled" || item.status === "launching";
  return `
    <article class="scheduled-chat-card status-${item.status}" data-scheduled-chat-card="${id}">
      <span class="scheduled-chat-card-time" aria-hidden="true">
        <strong>${escapeHtml(new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(item.scheduledFor)))}</strong>
        <small>${escapeHtml(new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "short" }).format(new Date(item.scheduledFor)))}</small>
      </span>
      <div class="scheduled-chat-card-copy">
        <header>
          <span class="scheduled-chat-status"><i data-lucide="${status.icon}"></i>${status.label}</span>
          <time datetime="${escapeHtml(new Date(item.scheduledFor).toISOString())}">${escapeHtml(formatScheduledChatDate(item.scheduledFor))}</time>
        </header>
        <h3>${escapeHtml(scheduledChatTitle(item))}</h3>
        <p>${escapeHtml(item.prompt)}</p>
        <div class="scheduled-chat-meta">
          <span><i data-lucide="folder"></i>${escapeHtml(environment?.label ?? item.environmentPath)}</span>
          <span><i data-lucide="user-round"></i>${escapeHtml(accountLabel)}</span>
          <span><i data-lucide="wrench"></i>${modeLabel}</span>
        </div>
        ${item.error ? `<div class="scheduled-chat-error"><i data-lucide="triangle-alert"></i><span>${escapeHtml(item.error)}</span></div>` : ""}
        ${editing ? `<form class="scheduled-chat-reschedule" data-scheduled-chat-reschedule-form="${id}">
          <label><span>Nouvelle date et heure</span><input type="datetime-local" data-scheduled-chat-reschedule-input="${id}" value="${localDateTimeInputValue(item.scheduledFor)}" min="${localDateTimeInputValue(Date.now())}" step="60" required /></label>
          <button type="submit" class="scheduled-chat-primary"><i data-lucide="save"></i><span>Enregistrer</span></button>
          <button type="button" data-scheduled-chat-reschedule-cancel="${id}">Annuler</button>
        </form>` : ""}
      </div>
      <div class="scheduled-chat-card-actions">
        ${canRun ? `<button type="button" data-scheduled-chat-run="${id}" title="Lancer ce chat maintenant"><i data-lucide="play"></i><span>Maintenant</span></button>` : ""}
        ${isPending && !editing ? `<button type="button" data-scheduled-chat-reschedule="${id}" title="Modifier l’heure"><i data-lucide="calendar-cog"></i><span>Reporter</span></button>` : ""}
        ${canCancel ? `<button type="button" data-scheduled-chat-cancel="${id}" title="Annuler cette programmation"><i data-lucide="circle-slash"></i><span>Annuler</span></button>` : ""}
        ${!isPending ? `<button type="button" data-scheduled-chat-delete="${id}" title="Supprimer de l’historique"><i data-lucide="trash-2"></i><span>Supprimer</span></button>` : ""}
      </div>
    </article>`;
};

export const renderScheduledChatsPanel = (
  options: ScheduledChatsPanelOptions = {},
): string => {
  const items = loadScheduledChatItems(options.storage);
  const environments = panelEnvironments(items, options.environments ?? []);
  const accounts = [...(options.accounts ?? [])];
  const draft = ensureScheduledChatFormDraft(options, environments);
  const pending = items
    .filter((item) => item.status === "scheduled" || item.status === "launching")
    .sort((left, right) => left.scheduledFor - right.scheduledFor);
  const history = items
    .filter((item) => item.status !== "scheduled" && item.status !== "launching")
    .sort((left, right) => right.updatedAt - left.updatedAt);
  const nextAt = nextScheduledChatAt(items);
  const launchedCount = items.filter((item) => item.status === "launched").length;
  const failedCount = items.filter((item) => item.status === "failed").length;
  const canSchedule = environments.length > 0 && accounts.length > 0;

  return `
    <section id="scheduledChatsPanel" class="scheduled-chats-panel" aria-labelledby="scheduledChatsTitle">
      <div class="scheduled-chats-shell">
        <header class="scheduled-chats-hero">
          <div class="scheduled-chats-heading">
            <span class="scheduled-chats-mark" aria-hidden="true"><i data-lucide="calendar-clock"></i></span>
            <div>
              <p>Automatisation ponctuelle</p>
              <h2 id="scheduledChatsTitle">Chat planifié</h2>
              <span>${nextAt === null
                ? "Programmez une tâche pour qu’un chat la démarre à l’heure choisie."
                : `Prochain lancement ${escapeHtml(formatScheduledChatDate(nextAt).toLocaleLowerCase("fr-FR"))}.`}</span>
            </div>
          </div>
          <div class="scheduled-chats-summary" aria-label="Résumé des chats planifiés">
            <span><strong>${pending.length}</strong><small>à venir</small></span>
            <span><strong>${launchedCount}</strong><small>lancé${launchedCount === 1 ? "" : "s"}</small></span>
            <span class="${failedCount ? "has-error" : ""}"><strong>${failedCount}</strong><small>à relancer</small></span>
          </div>
        </header>

        <form id="scheduledChatCreateForm" class="scheduled-chat-create">
          <label class="scheduled-chat-prompt-field">
            <span><i data-lucide="message-square-text"></i>Tâche à confier au chat</span>
            <textarea id="scheduledChatPrompt" maxlength="${SCHEDULED_CHAT_PROMPT_MAX_LENGTH}" rows="5" placeholder="Décrivez précisément la tâche à lancer…" required>${escapeHtml(draft.prompt)}</textarea>
          </label>
          <div class="scheduled-chat-create-options">
            <label><span>Date et heure</span><input id="scheduledChatDateTime" type="datetime-local" value="${escapeHtml(draft.scheduledFor)}" min="${localDateTimeInputValue(Date.now())}" step="60" required /></label>
            <label><span>Environnement</span><select id="scheduledChatEnvironment" required>
              ${environments.length
                ? environments.map((environment) => `<option value="${escapeHtml(environment.path)}" ${environment.path === draft.environmentPath ? "selected" : ""}>${escapeHtml(environment.label)}</option>`).join("")
                : `<option value="">Aucun environnement disponible</option>`}
            </select></label>
            <label><span>Compte</span><select id="scheduledChatAccount">
              <option value="" ${draft.accountId ? "" : "selected"}>Compte par défaut au lancement</option>
              ${accounts.map((account) => `<option value="${escapeHtml(account.id)}" ${account.id === draft.accountId ? "selected" : ""}>${escapeHtml(account.label)}</option>`).join("")}
            </select></label>
            <label><span>Mode</span><select id="scheduledChatMode">
              <option value="build" ${draft.mode === "build" ? "selected" : ""}>Build · exécuter</option>
              <option value="plan" ${draft.mode === "plan" ? "selected" : ""}>Plan · préparer</option>
              <option value="ask" ${draft.mode === "ask" ? "selected" : ""}>Question · analyser</option>
            </select></label>
          </div>
          <footer>
            <p><i data-lucide="info"></i><span>Switch doit être lancé à l’heure prévue. Une échéance manquée démarre automatiquement au prochain lancement.</span></p>
            <button type="submit" class="scheduled-chat-primary" ${canSchedule ? "" : "disabled"}><i data-lucide="calendar-plus"></i><span>Planifier le chat</span></button>
          </footer>
        </form>

        <section class="scheduled-chat-list-section" aria-labelledby="scheduledChatUpcomingTitle">
          <header><div><span><i data-lucide="clock-3"></i></span><div><h3 id="scheduledChatUpcomingTitle">À venir</h3><p>Les tâches démarrent automatiquement à l’heure locale de cet appareil.</p></div></div><b>${pending.length}</b></header>
          ${pending.length
            ? `<div class="scheduled-chat-list">${pending.map((item) => renderScheduledChatCard(item, environments, accounts)).join("")}</div>`
            : `<div class="scheduled-chat-empty"><span><i data-lucide="calendar-check"></i></span><h3>Aucun chat en attente</h3><p>La prochaine tâche que vous planifierez apparaîtra ici.</p></div>`}
        </section>

        ${history.length ? `<section class="scheduled-chat-list-section scheduled-chat-history" aria-labelledby="scheduledChatHistoryTitle">
          <header><div><span><i data-lucide="history"></i></span><div><h3 id="scheduledChatHistoryTitle">Historique</h3><p>Lancements terminés, annulés ou à reprendre.</p></div></div><b>${history.length}</b></header>
          <div class="scheduled-chat-list">${history.map((item) => renderScheduledChatCard(item, environments, accounts)).join("")}</div>
        </section>` : ""}

        <footer class="scheduled-chats-footer">
          <p id="scheduledChatsFeedback" aria-live="polite">${escapeHtml(scheduledChatFeedback)}</p>
          <span><i data-lucide="hard-drive"></i>Programmations enregistrées sur cet appareil</span>
        </footer>
      </div>
    </section>`;
};

type ScheduledChatFocusTarget =
  | "prompt"
  | { kind: "card" | "reschedule"; id: string }
  | null;

const focusScheduledChatTarget = (root: HTMLElement, target: ScheduledChatFocusTarget): void => {
  if (!target) return;
  if (target === "prompt") {
    root.querySelector<HTMLTextAreaElement>("#scheduledChatPrompt")?.focus();
    return;
  }
  if (target.kind === "reschedule") {
    Array.from(root.querySelectorAll<HTMLInputElement>("[data-scheduled-chat-reschedule-input]"))
      .find((input) => input.dataset.scheduledChatRescheduleInput === target.id)
      ?.focus();
    return;
  }
  Array.from(root.querySelectorAll<HTMLElement>("[data-scheduled-chat-card]"))
    .find((card) => card.dataset.scheduledChatCard === target.id)
    ?.focus();
};

export const syncScheduledChatNavigationBadges = (
  items: readonly ScheduledChatItem[],
): void => {
  if (typeof document === "undefined") return;
  const pending = scheduledChatPendingCount(items);
  document.querySelectorAll<HTMLElement>("[data-scheduled-chat-nav-count]").forEach((badge) => {
    badge.hidden = pending === 0;
    badge.textContent = pending > 99 ? "99+" : String(pending);
    badge.setAttribute(
      "aria-label",
      `${pending} chat${pending === 1 ? "" : "s"} planifié${pending === 1 ? "" : "s"}`,
    );
  });
};

export const mountScheduledChatsPanel = (
  options: ScheduledChatsPanelOptions = {},
): void => {
  const root = document.querySelector<HTMLElement>("#scheduledChatsPanel");
  if (!root) return;

  const refresh = (focus: ScheduledChatFocusTarget = null): void => {
    const currentRoot = document.querySelector<HTMLElement>("#scheduledChatsPanel");
    if (!currentRoot) return;
    currentRoot.outerHTML = renderScheduledChatsPanel(options);
    const nextRoot = document.querySelector<HTMLElement>("#scheduledChatsPanel");
    if (!nextRoot) return;
    options.renderIcons?.(nextRoot);
    mountScheduledChatsPanel(options);
    queueMicrotask(() => focusScheduledChatTarget(nextRoot, focus));
  };

  const save = (
    items: ScheduledChatItem[],
    message: string,
    focus: ScheduledChatFocusTarget = null,
  ): boolean => {
    const persisted = persistScheduledChatItems(items, options.storage);
    scheduledChatFeedback = persisted
      ? message
      : "Impossible d’enregistrer les chats planifiés sur cet appareil.";
    if (persisted) {
      syncScheduledChatNavigationBadges(items);
      options.onItemsChanged?.(items);
    }
    refresh(focus);
    return persisted;
  };

  const promptInput = root.querySelector<HTMLTextAreaElement>("#scheduledChatPrompt");
  const dateInput = root.querySelector<HTMLInputElement>("#scheduledChatDateTime");
  const environmentInput = root.querySelector<HTMLSelectElement>("#scheduledChatEnvironment");
  const accountInput = root.querySelector<HTMLSelectElement>("#scheduledChatAccount");
  const modeInput = root.querySelector<HTMLSelectElement>("#scheduledChatMode");
  promptInput?.addEventListener("input", () => {
    if (scheduledChatFormDraft) scheduledChatFormDraft.prompt = promptInput.value;
    promptInput.setCustomValidity("");
  });
  dateInput?.addEventListener("input", () => {
    if (scheduledChatFormDraft) scheduledChatFormDraft.scheduledFor = dateInput.value;
    dateInput.setCustomValidity("");
  });
  environmentInput?.addEventListener("change", () => {
    if (scheduledChatFormDraft) scheduledChatFormDraft.environmentPath = environmentInput.value;
    environmentInput.setCustomValidity("");
  });
  accountInput?.addEventListener("change", () => {
    if (scheduledChatFormDraft) scheduledChatFormDraft.accountId = accountInput.value;
  });
  modeInput?.addEventListener("change", () => {
    if (scheduledChatFormDraft) scheduledChatFormDraft.mode = normalizeScheduledChatMode(modeInput.value);
  });

  root.querySelector<HTMLFormElement>("#scheduledChatCreateForm")?.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const prompt = normalizeScheduledChatPrompt(promptInput?.value);
      const environmentPath = normalizeScheduledChatEnvironmentPath(environmentInput?.value);
      const scheduledFor = parseScheduledChatDateTime(dateInput?.value);
      if (!prompt) {
        promptInput?.setCustomValidity("Décrivez la tâche à lancer.");
        promptInput?.reportValidity();
        return;
      }
      if (!environmentPath) {
        environmentInput?.setCustomValidity("Choisissez un environnement.");
        environmentInput?.reportValidity();
        return;
      }
      if (scheduledFor === null || scheduledFor <= Date.now()) {
        dateInput?.setCustomValidity("Choisissez une date et une heure futures.");
        dateInput?.reportValidity();
        return;
      }
      promptInput?.setCustomValidity("");
      environmentInput?.setCustomValidity("");
      dateInput?.setCustomValidity("");
      const current = loadScheduledChatItems(options.storage);
      const next = addScheduledChatItem(current, {
        prompt,
        environmentPath,
        accountId: accountInput?.value,
        mode: modeInput?.value,
        scheduledFor,
      });
      scheduledChatFormDraft = {
        prompt: "",
        scheduledFor: localDateTimeInputValue(defaultScheduledChatTimestamp()),
        environmentPath,
        accountId: accountInput?.value ?? "",
        mode: normalizeScheduledChatMode(modeInput?.value),
      };
      editingScheduledChatId = null;
      save(next, `Chat planifié pour ${formatScheduledChatDate(scheduledFor)}.`, "prompt");
    },
  );

  root.querySelectorAll<HTMLButtonElement>("[data-scheduled-chat-run]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.scheduledChatRun;
      if (!id) return;
      editingScheduledChatId = null;
      const next = requestScheduledChatNow(loadScheduledChatItems(options.storage), id);
      if (save(next, "Lancement du chat demandé.")) options.onRequestDispatch?.();
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-scheduled-chat-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.scheduledChatCancel;
      if (!id) return;
      editingScheduledChatId = null;
      save(cancelScheduledChatItem(loadScheduledChatItems(options.storage), id), "Programmation annulée.");
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-scheduled-chat-reschedule]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.scheduledChatReschedule;
      if (!id) return;
      editingScheduledChatId = id;
      scheduledChatFeedback = "";
      refresh({ kind: "reschedule", id });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-scheduled-chat-reschedule-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.scheduledChatRescheduleCancel;
      editingScheduledChatId = null;
      scheduledChatFeedback = "";
      refresh(id ? { kind: "card", id } : null);
    });
  });

  root.querySelectorAll<HTMLFormElement>("[data-scheduled-chat-reschedule-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = form.dataset.scheduledChatRescheduleForm;
      const input = form.querySelector<HTMLInputElement>("[data-scheduled-chat-reschedule-input]");
      const scheduledFor = parseScheduledChatDateTime(input?.value);
      if (!id || scheduledFor === null || scheduledFor <= Date.now()) {
        input?.setCustomValidity("Choisissez une date et une heure futures.");
        input?.reportValidity();
        return;
      }
      input?.setCustomValidity("");
      editingScheduledChatId = null;
      save(
        rescheduleScheduledChatItem(loadScheduledChatItems(options.storage), id, scheduledFor),
        `Chat reporté à ${formatScheduledChatDate(scheduledFor)}.`,
        { kind: "card", id },
      );
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-scheduled-chat-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.scheduledChatDelete;
      if (!id) return;
      const current = loadScheduledChatItems(options.storage);
      const item = current.find((candidate) => candidate.id === id);
      if (!item || !window.confirm(`Supprimer « ${scheduledChatTitle(item)} » de l’historique ?`)) {
        return;
      }
      save(removeScheduledChatItem(current, id), "Entrée supprimée de l’historique.");
    });
  });
};
