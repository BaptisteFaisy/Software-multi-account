export const TASKS_STORAGE_KEY = "codex-switch-terminal.tasks.v1";
export const TASKS_STORAGE_MIGRATION_KEY = `${TASKS_STORAGE_KEY}.account-owner`;
export const TASK_TITLE_MAX_LENGTH = 240;

export type TaskFilter = "all" | "active" | "completed";
export type TaskPriority = "low" | "normal" | "high";
export type TaskDueState = "none" | "overdue" | "today" | "upcoming";
export type TaskScheduleGroup = "today" | "tomorrow" | "week";

export type TaskItem = {
  id: string;
  title: string;
  completed: boolean;
  createdAt: number;
  completedAt: number | null;
  priority: TaskPriority;
  dueDate: string | null;
  /** Chemin du projet auquel la tâche appartient. `null` désigne une tâche personnelle. */
  environmentPath: string | null;
};

export type TaskEnvironment = {
  path: string;
  label: string;
};

export type TaskStorage = Pick<Storage, "getItem" | "setItem">;

export type TaskStats = {
  total: number;
  active: number;
  completed: number;
  progress: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const finiteTimestamp = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;

export const normalizeTaskTitle = (value: unknown): string =>
  typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").slice(0, TASK_TITLE_MAX_LENGTH)
    : "";

export const normalizeTaskPriority = (value: unknown): TaskPriority =>
  value === "low" || value === "high" ? value : "normal";

export const normalizeTaskDueDate = (value: unknown): string | null => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    ? value
    : null;
};

export const normalizeTaskEnvironmentPath = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 4096);
  const path = trimmed === "/" || /^[a-zA-Z]:[\\/]$/.test(trimmed)
    ? trimmed
    : trimmed.replace(/[\\/]+$/, "");
  return path || null;
};

const comparableTaskEnvironmentPath = (value: unknown): string | null => {
  const path = normalizeTaskEnvironmentPath(value)?.replaceAll("\\", "/") ?? null;
  if (!path) return null;
  return /^[a-zA-Z]:\//.test(path) || path.startsWith("//")
    ? path.toLocaleLowerCase("en-US")
    : path;
};

export const taskBelongsToEnvironment = (
  task: Pick<TaskItem, "environmentPath">,
  environmentPath: string | null | undefined,
): boolean => {
  const taskPath = comparableTaskEnvironmentPath(task.environmentPath);
  const requestedPath = comparableTaskEnvironmentPath(environmentPath);
  return taskPath !== null && requestedPath !== null && taskPath === requestedPath;
};

/**
 * Les tâches personnelles restent visibles partout. Les tâches projet sont
 * isolées dans l'environnement auquel elles ont été rattachées.
 */
export const taskItemsForEnvironment = (
  items: readonly TaskItem[],
  environmentPath: string | null | undefined,
): TaskItem[] => items.filter(
  (task) => !task.environmentPath || taskBelongsToEnvironment(task, environmentPath),
);

export const localTaskDateKey = (timestamp = Date.now()): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const taskDueState = (
  task: Pick<TaskItem, "completed" | "dueDate">,
  timestamp = Date.now(),
): TaskDueState => {
  if (!task.dueDate || task.completed) return "none";
  const today = localTaskDateKey(timestamp);
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return "upcoming";
};

export const taskScheduleGroup = (
  task: Pick<TaskItem, "dueDate">,
  timestamp = Date.now(),
): TaskScheduleGroup => {
  const today = localTaskDateKey(timestamp);
  if (!task.dueDate || task.dueDate <= today) return "today";
  const tomorrow = new Date(timestamp);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return task.dueDate === localTaskDateKey(tomorrow.getTime()) ? "tomorrow" : "week";
};

export const normalizeTaskItems = (
  value: unknown,
  fallbackTimestamp = Date.now(),
): TaskItem[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: TaskItem[] = [];

  value.forEach((candidate) => {
    if (!isRecord(candidate)) return;
    const id = typeof candidate.id === "string" ? candidate.id.trim().slice(0, 160) : "";
    const title = normalizeTaskTitle(candidate.title);
    if (!id || !title || seen.has(id)) return;
    seen.add(id);

    const completed = candidate.completed === true;
    const createdAt = finiteTimestamp(candidate.createdAt, fallbackTimestamp);
    normalized.push({
      id,
      title,
      completed,
      createdAt,
      completedAt: completed
        ? finiteTimestamp(candidate.completedAt, createdAt)
        : null,
      priority: normalizeTaskPriority(candidate.priority),
      dueDate: normalizeTaskDueDate(candidate.dueDate),
      environmentPath: normalizeTaskEnvironmentPath(candidate.environmentPath),
    });
  });

  return normalized;
};

const browserTaskStorage = (): TaskStorage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const resolveStorage = (storage: TaskStorage | null | undefined): TaskStorage | null =>
  storage === undefined ? browserTaskStorage() : storage;

const normalizedTaskAccountId = (accountId: string | null | undefined): string | null => {
  if (typeof accountId !== "string") return null;
  const normalized = accountId.trim().slice(0, 512);
  return normalized || null;
};

export const taskStorageKeyForAccount = (
  accountId: string | null | undefined,
): string => {
  const normalized = normalizedTaskAccountId(accountId);
  return normalized
    ? `${TASKS_STORAGE_KEY}.account.${encodeURIComponent(normalized)}`
    : TASKS_STORAGE_KEY;
};

const migrateLegacyTaskItems = (
  storage: TaskStorage,
  accountId: string,
  accountStorageKey: string,
): string | null => {
  const legacyItems = storage.getItem(TASKS_STORAGE_KEY);
  if (!legacyItems || storage.getItem(TASKS_STORAGE_MIGRATION_KEY)) return null;
  storage.setItem(accountStorageKey, legacyItems);
  storage.setItem(TASKS_STORAGE_MIGRATION_KEY, accountId);
  return legacyItems;
};

export const loadTaskItems = (
  storage?: TaskStorage | null,
  accountId?: string | null,
): TaskItem[] => {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const normalizedAccountId = normalizedTaskAccountId(accountId);
    const storageKey = taskStorageKeyForAccount(normalizedAccountId);
    const serialized = target.getItem(storageKey)
      ?? (normalizedAccountId
        ? migrateLegacyTaskItems(target, normalizedAccountId, storageKey)
        : null);
    return serialized ? normalizeTaskItems(JSON.parse(serialized)) : [];
  } catch {
    return [];
  }
};

export const persistTaskItems = (
  items: readonly TaskItem[],
  storage?: TaskStorage | null,
  accountId?: string | null,
): boolean => {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    const normalizedAccountId = normalizedTaskAccountId(accountId);
    target.setItem(
      taskStorageKeyForAccount(normalizedAccountId),
      JSON.stringify(normalizeTaskItems(items)),
    );
    if (normalizedAccountId && !target.getItem(TASKS_STORAGE_MIGRATION_KEY)) {
      target.setItem(TASKS_STORAGE_MIGRATION_KEY, normalizedAccountId);
    }
    return true;
  } catch {
    return false;
  }
};

const createTaskId = (timestamp: number): string => {
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `task-${timestamp.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const addTaskItem = (
  items: readonly TaskItem[],
  titleValue: unknown,
  timestamp = Date.now(),
  id = createTaskId(timestamp),
  details: { priority?: unknown; dueDate?: unknown; environmentPath?: unknown } = {},
): TaskItem[] => {
  const title = normalizeTaskTitle(titleValue);
  if (!title) return [...items];
  const uniqueId = items.some((item) => item.id === id) ? createTaskId(timestamp + 1) : id;
  return [
    {
      id: uniqueId,
      title,
      completed: false,
      createdAt: Math.floor(timestamp),
      completedAt: null,
      priority: normalizeTaskPriority(details.priority),
      dueDate: normalizeTaskDueDate(details.dueDate),
      environmentPath: normalizeTaskEnvironmentPath(details.environmentPath),
    },
    ...items,
  ];
};

export const renameTaskItem = (
  items: readonly TaskItem[],
  id: string,
  titleValue: unknown,
): TaskItem[] => {
  const title = normalizeTaskTitle(titleValue);
  if (!title) return [...items];
  return items.map((item) => item.id === id ? { ...item, title } : item);
};

export const updateTaskDetails = (
  items: readonly TaskItem[],
  id: string,
  details: { priority?: unknown; dueDate?: unknown; environmentPath?: unknown },
): TaskItem[] =>
  items.map((item) => item.id === id
    ? {
        ...item,
        priority: normalizeTaskPriority(details.priority),
        dueDate: normalizeTaskDueDate(details.dueDate),
        environmentPath: Object.hasOwn(details, "environmentPath")
          ? normalizeTaskEnvironmentPath(details.environmentPath)
          : item.environmentPath,
      }
    : item);

export const setTaskCompleted = (
  items: readonly TaskItem[],
  id: string,
  completed: boolean,
  timestamp = Date.now(),
): TaskItem[] =>
  items.map((item) =>
    item.id === id
      ? {
          ...item,
          completed,
          completedAt: completed ? Math.floor(timestamp) : null,
        }
      : item,
  );

export const removeTaskItem = (items: readonly TaskItem[], id: string): TaskItem[] =>
  items.filter((item) => item.id !== id);

export const clearCompletedTaskItems = (items: readonly TaskItem[]): TaskItem[] =>
  items.filter((item) => !item.completed);

export const filterTaskItems = (
  items: readonly TaskItem[],
  filter: TaskFilter,
): TaskItem[] => {
  if (filter === "active") return items.filter((item) => !item.completed);
  if (filter === "completed") return items.filter((item) => item.completed);
  return [...items];
};

export const searchTaskItems = (
  items: readonly TaskItem[],
  searchValue: unknown,
): TaskItem[] => {
  const search = normalizeTaskTitle(searchValue).toLocaleLowerCase("fr-FR");
  if (!search) return [...items];
  return items.filter((item) => item.title.toLocaleLowerCase("fr-FR").includes(search));
};

export const taskStats = (items: readonly TaskItem[]): TaskStats => {
  const completed = items.filter((item) => item.completed).length;
  const total = items.length;
  return {
    total,
    active: total - completed,
    completed,
    progress: total ? Math.round((completed / total) * 100) : 0,
  };
};
