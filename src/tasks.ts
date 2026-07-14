export const TASKS_STORAGE_KEY = "codex-switch-terminal.tasks.v1";
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

type TasksPanelOptions = {
  storage?: TaskStorage | null;
  renderIcons?: (root: ParentNode) => void;
  environment?: TaskEnvironment | null;
  onExecuteTask?: (task: TaskItem) => void;
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

export const loadTaskItems = (storage?: TaskStorage | null): TaskItem[] => {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const serialized = target.getItem(TASKS_STORAGE_KEY);
    return serialized ? normalizeTaskItems(JSON.parse(serialized)) : [];
  } catch {
    return [];
  }
};

export const persistTaskItems = (
  items: readonly TaskItem[],
  storage?: TaskStorage | null,
): boolean => {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(TASKS_STORAGE_KEY, JSON.stringify(normalizeTaskItems(items)));
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

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);

const formatTaskDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Ajoutée récemment";
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  if (sameDay) return "Ajoutée aujourd’hui";
  return `Ajoutée le ${new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(date)}`;
};

const taskCountLabel = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const taskPriorityLabel = (priority: TaskPriority): string => {
  if (priority === "high") return "Priorité haute";
  if (priority === "low") return "Priorité basse";
  return "Priorité normale";
};

const renderPriorityOptions = (priority: TaskPriority): string => [
  ["normal", "Priorité normale"],
  ["high", "Priorité haute"],
  ["low", "Priorité basse"],
].map(([value, label]) =>
  `<option value="${value}" ${priority === value ? "selected" : ""}>${label}</option>`,
).join("");

const renderTaskEnvironmentOptions = (
  environmentPath: string | null,
  environment: TaskEnvironment | null,
): string => {
  const personalSelected = environmentPath ? "" : "selected";
  const environmentSelected = environmentPath ? "selected" : "";
  return `
    <option value="personal" ${personalSelected}>Personnelle</option>
    <option value="environment" ${environmentSelected} ${environment ? "" : "disabled"}>${environment
      ? `Cet environnement · ${escapeHtml(environment.label)}`
      : "Aucun environnement sélectionné"}</option>`;
};

const taskDuePresentation = (task: TaskItem): { label: string; state: TaskDueState } | null => {
  if (!task.dueDate) return null;
  const state = taskDueState(task);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "short",
  }).format(new Date(`${task.dueDate}T12:00:00`));
  const dateLabel = task.dueDate === localTaskDateKey()
    ? "Aujourd’hui"
    : task.dueDate === localTaskDateKey(tomorrow.getTime())
      ? "Demain"
      : formatted;
  if (state === "overdue") return { label: `En retard · ${formatted}`, state };
  return { label: task.completed ? `Échéance · ${dateLabel}` : dateLabel, state };
};

let activeTaskFilter: TaskFilter = "all";
let editingTaskId: string | null = null;
let taskFeedback = "";
let taskSearch = "";

const renderTaskItem = (task: TaskItem, environment: TaskEnvironment | null): string => {
  const title = escapeHtml(task.title);
  const id = escapeHtml(task.id);
  const editing = editingTaskId === task.id;
  const due = taskDuePresentation(task);
  const priorityLabel = taskPriorityLabel(task.priority);
  const environmentLabel = escapeHtml(environment?.label ?? "Cet environnement");
  return `
    <li class="task-item priority-${task.priority} due-${due?.state ?? "none"} ${task.completed ? "is-completed" : ""} ${task.environmentPath ? "is-environment-task" : ""} ${editing ? "is-editing" : ""}">
      <label class="task-toggle" title="${task.completed ? "Rouvrir la tâche" : "Marquer comme terminée"}">
        <input type="checkbox" data-task-toggle="${id}" ${task.completed ? "checked" : ""} aria-label="${task.completed ? "Rouvrir" : "Terminer"} : ${title}" />
        <span aria-hidden="true"><i data-lucide="check"></i></span>
      </label>
      ${editing
        ? `<form class="task-edit-form" data-task-edit-form="${id}">
            <div class="task-edit-fields">
              <label class="task-visually-hidden" for="taskEdit-${id}">Modifier la tâche</label>
              <input id="taskEdit-${id}" data-task-edit-input="${id}" value="${title}" maxlength="${TASK_TITLE_MAX_LENGTH}" required />
              <div class="task-edit-details">
                <label><span>Échéance</span><input type="date" data-task-edit-due="${id}" value="${task.dueDate ?? ""}" /></label>
                <label><span>Priorité</span><select data-task-edit-priority="${id}">${renderPriorityOptions(task.priority)}</select></label>
                <label><span>Catégorie</span><select data-task-edit-environment="${id}">${renderTaskEnvironmentOptions(task.environmentPath, environment)}</select></label>
              </div>
            </div>
            <button type="submit" title="Enregistrer"><i data-lucide="check"></i><span>Enregistrer</span></button>
            <button type="button" data-task-edit-cancel="${id}" title="Annuler"><i data-lucide="x"></i><span class="task-visually-hidden">Annuler</span></button>
          </form>`
        : `<div class="task-copy">
            <strong>${title}</strong>
            <div class="task-metadata">
              <small>${task.completed ? "Terminée" : formatTaskDate(task.createdAt)}</small>
              ${due ? `<span class="task-due task-due-${due.state}"><i data-lucide="calendar-clock"></i>${escapeHtml(due.label)}</span>` : ""}
              ${task.priority !== "normal" ? `<span class="task-priority task-priority-${task.priority}">${escapeHtml(priorityLabel)}</span>` : ""}
              ${task.environmentPath ? `<span class="task-environment"><i data-lucide="folder"></i>${environmentLabel}</span>` : ""}
            </div>
          </div>
          <div class="task-actions">
            ${task.environmentPath ? `<button class="task-execute" type="button" data-task-execute="${id}" title="Exécuter cette tâche dans ${environmentLabel}" aria-label="Exécuter : ${title}"><i data-lucide="play"></i><span>Exécuter</span></button>` : ""}
            <button type="button" data-task-edit="${id}" title="Modifier la tâche" aria-label="Modifier : ${title}"><i data-lucide="pencil"></i></button>
            <button type="button" data-task-delete="${id}" title="Supprimer la tâche" aria-label="Supprimer : ${title}"><i data-lucide="trash-2"></i></button>
          </div>`}
    </li>`;
};

const taskScheduleGroups: Array<{
  id: TaskScheduleGroup;
  label: string;
  detail: string;
  icon: string;
}> = [
  { id: "today", label: "Aujourd’hui", detail: "À traiter maintenant", icon: "target" },
  { id: "tomorrow", label: "Demain", detail: "La prochaine étape", icon: "clock-3" },
  {
    id: "week",
    label: "Fin de la semaine",
    detail: "À garder en vue",
    icon: "calendar-clock",
  },
];

const renderTaskGroup = (
  definition: (typeof taskScheduleGroups)[number],
  tasks: readonly TaskItem[],
  environment: TaskEnvironment | null,
): string => {
  const groupTasks = tasks.filter((task) => taskScheduleGroup(task) === definition.id);
  const emptyLabel = taskSearch
    ? "Aucun résultat"
    : activeTaskFilter === "completed"
      ? "Rien de terminé"
      : "Aucune tâche";
  return `
    <section class="task-group task-group-${definition.id}" data-task-group="${definition.id}" aria-labelledby="taskGroup-${definition.id}">
      <header>
        <span class="task-group-icon" aria-hidden="true"><i data-lucide="${definition.icon}"></i></span>
        <div>
          <h3 id="taskGroup-${definition.id}">${definition.label}</h3>
          <small>${definition.detail}</small>
        </div>
        <b aria-label="${taskCountLabel(groupTasks.length, "tâche")}">${groupTasks.length}</b>
      </header>
      ${groupTasks.length
        ? `<ul class="task-list">${groupTasks.map((task) => renderTaskItem(task, environment)).join("")}</ul>`
        : `<div class="task-group-empty"><i data-lucide="check"></i><span>${emptyLabel}</span></div>`}
    </section>`;
};

export const renderTasksPanel = (
  storage?: TaskStorage | null,
  environment: TaskEnvironment | null = null,
): string => {
  const tasks = loadTaskItems(storage);
  const scopedTasks = taskItemsForEnvironment(tasks, environment?.path);
  const stats = taskStats(scopedTasks);
  const visibleTasks = searchTaskItems(filterTaskItems(scopedTasks, activeTaskFilter), taskSearch);
  const environmentTaskCount = environment
    ? scopedTasks.filter((task) => taskBelongsToEnvironment(task, environment.path)).length
    : 0;
  const filterButton = (filter: TaskFilter, label: string, count: number) => `
    <button type="button" data-task-filter="${filter}" class="${activeTaskFilter === filter ? "active" : ""}" aria-pressed="${activeTaskFilter === filter}">
      <span>${label}</span><b>${count}</b>
    </button>`;

  return `
    <section id="tasksPanel" class="tasks-panel" aria-labelledby="tasksPanelTitle">
      <div class="tasks-shell">
        <header class="tasks-hero">
          <div class="tasks-heading">
            <span class="tasks-heading-icon" aria-hidden="true"><i data-lucide="list-checks"></i></span>
            <div>
              <p>Organisation personnelle et projet</p>
              <h2 id="tasksPanelTitle">Mes tâches</h2>
              <span>${stats.active
                ? `${taskCountLabel(stats.active, "tâche")} à faire`
                : stats.total
                  ? "Vous êtes à jour"
                  : "Une liste simple pour garder le cap"}</span>
            </div>
          </div>
          <div class="tasks-progress" style="--tasks-progress: ${stats.progress}%" aria-label="${stats.progress} % des tâches terminées">
            <span><strong>${stats.progress}%</strong><small>terminé</small></span>
          </div>
        </header>

        <form id="taskCreateForm" class="task-create">
          <div class="task-create-main">
            <label class="task-visually-hidden" for="taskTitle">Nouvelle tâche</label>
            <span aria-hidden="true"><i data-lucide="plus"></i></span>
            <input id="taskTitle" name="title" type="text" maxlength="${TASK_TITLE_MAX_LENGTH}" placeholder="Ajouter une tâche…" autocomplete="off" required />
            <button type="submit"><i data-lucide="plus"></i><span>Ajouter</span></button>
          </div>
          <div class="task-create-details">
            <label><span>Échéance</span><input id="taskDueDate" name="dueDate" type="date" value="${localTaskDateKey()}" /></label>
            <label><span>Priorité</span><select id="taskPriority" name="priority">${renderPriorityOptions("normal")}</select></label>
            <label><span>Catégorie</span><select id="taskEnvironment" name="environment">${renderTaskEnvironmentOptions(null, environment)}</select></label>
          </div>
        </form>

        <div class="tasks-toolbar">
          <div class="task-filters" role="group" aria-label="Filtrer les tâches">
            ${filterButton("all", "Toutes", stats.total)}
            ${filterButton("active", "À faire", stats.active)}
            ${filterButton("completed", "Terminées", stats.completed)}
          </div>
          <label class="task-search">
            <i data-lucide="search"></i>
            <span class="task-visually-hidden">Rechercher une tâche</span>
            <input id="taskSearch" type="search" value="${escapeHtml(taskSearch)}" placeholder="Rechercher…" autocomplete="off" />
          </label>
        </div>

        ${environment ? `<aside class="task-environment-summary" data-task-environment-summary>
          <span aria-hidden="true"><i data-lucide="folder"></i></span>
          <div><strong>Tâches relatives à cet environnement</strong><small>${escapeHtml(environment.label)} · ${escapeHtml(environment.path)}</small></div>
          <b>${taskCountLabel(environmentTaskCount, "tâche")}</b>
        </aside>` : `<aside class="task-environment-summary is-unavailable" data-task-environment-summary>
          <span aria-hidden="true"><i data-lucide="folder-x"></i></span>
          <div><strong>Tâches relatives à un environnement</strong><small>Sélectionnez d’abord un environnement pour utiliser cette catégorie.</small></div>
        </aside>`}

        <div class="tasks-list-card">
          <div class="task-groups">${taskScheduleGroups
            .map((definition) => renderTaskGroup(definition, visibleTasks, environment))
            .join("")}</div>
        </div>

        <footer class="tasks-footer">
          <p id="tasksFeedback" aria-live="polite">${escapeHtml(taskFeedback)}</p>
          ${stats.completed
            ? `<button type="button" id="tasksClearCompleted"><i data-lucide="trash-2"></i><span>Effacer les terminées</span></button>`
            : `<span>Les tâches sont enregistrées sur cet appareil.</span>`}
        </footer>
      </div>
    </section>`;
};

type TaskFocusTarget =
  | { kind: "create" }
  | { kind: "search" }
  | { kind: "filter"; filter: TaskFilter }
  | { kind: "toggle" | "edit" | "edit-input"; id: string }
  | null;

const focusTaskTarget = (root: HTMLElement, target: TaskFocusTarget) => {
  if (!target) return;
  if (target.kind === "create") {
    root.querySelector<HTMLInputElement>("#taskTitle")?.focus();
    return;
  }
  if (target.kind === "search") {
    const input = root.querySelector<HTMLInputElement>("#taskSearch");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
    return;
  }
  if (target.kind === "filter") {
    Array.from(root.querySelectorAll<HTMLButtonElement>("[data-task-filter]"))
      .find((button) => button.dataset.taskFilter === target.filter)
      ?.focus();
    return;
  }
  const attribute = target.kind === "toggle"
    ? "taskToggle"
    : target.kind === "edit"
      ? "taskEdit"
      : "taskEditInput";
  Array.from(root.querySelectorAll<HTMLElement>(`[data-${target.kind === "edit-input" ? "task-edit-input" : target.kind === "edit" ? "task-edit" : "task-toggle"}]`))
    .find((element) => element.dataset[attribute] === target.id)
    ?.focus();
};

export const syncTaskNavigationBadges = (
  items: readonly TaskItem[],
  environmentPath?: string | null,
): void => {
  if (typeof document === "undefined") return;
  const active = taskStats(taskItemsForEnvironment(items, environmentPath)).active;
  document.querySelectorAll<HTMLElement>("[data-task-nav-count]").forEach((badge) => {
    badge.hidden = active === 0;
    badge.textContent = active > 99 ? "99+" : String(active);
    badge.setAttribute("aria-label", taskCountLabel(active, "tâche") + " à faire");
  });
};

export const mountTasksPanel = (options: TasksPanelOptions = {}): void => {
  const root = document.querySelector<HTMLElement>("#tasksPanel");
  if (!root) return;

  const refresh = (focus: TaskFocusTarget = null) => {
    const currentRoot = document.querySelector<HTMLElement>("#tasksPanel");
    if (!currentRoot) return;
    currentRoot.outerHTML = renderTasksPanel(options.storage, options.environment ?? null);
    const nextRoot = document.querySelector<HTMLElement>("#tasksPanel");
    if (!nextRoot) return;
    options.renderIcons?.(nextRoot);
    mountTasksPanel(options);
    queueMicrotask(() => focusTaskTarget(nextRoot, focus));
  };

  const save = (items: TaskItem[], message: string, focus: TaskFocusTarget = null) => {
    const persisted = persistTaskItems(items, options.storage);
    taskFeedback = persisted ? message : "Impossible d’enregistrer les tâches sur cet appareil.";
    if (persisted) syncTaskNavigationBadges(items, options.environment?.path);
    refresh(focus);
  };

  root.querySelector<HTMLFormElement>("#taskCreateForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = root.querySelector<HTMLInputElement>("#taskTitle");
    const title = normalizeTaskTitle(input?.value);
    if (!input || !title) {
      input?.setCustomValidity("Saisissez une tâche.");
      input?.reportValidity();
      return;
    }
    input.setCustomValidity("");
    const dueDate = root.querySelector<HTMLInputElement>("#taskDueDate")?.value ?? null;
    const priority = root.querySelector<HTMLSelectElement>("#taskPriority")?.value ?? "normal";
    const category = root.querySelector<HTMLSelectElement>("#taskEnvironment")?.value;
    const next = addTaskItem(loadTaskItems(options.storage), title, Date.now(), undefined, {
      dueDate,
      priority,
      environmentPath: category === "environment" ? options.environment?.path : null,
    });
    editingTaskId = null;
    taskSearch = "";
    save(next, "Tâche ajoutée.", { kind: "create" });
  });

  root.querySelectorAll<HTMLInputElement>("[data-task-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.dataset.taskToggle;
      if (!id) return;
      const next = setTaskCompleted(loadTaskItems(options.storage), id, input.checked);
      const message = input.checked ? "Tâche terminée." : "Tâche rouverte.";
      save(next, message, { kind: "toggle", id });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-task-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.taskFilter as TaskFilter | undefined;
      if (!filter || !["all", "active", "completed"].includes(filter)) return;
      activeTaskFilter = filter;
      editingTaskId = null;
      taskFeedback = "";
      refresh({ kind: "filter", filter });
    });
  });

  root.querySelector<HTMLInputElement>("#taskSearch")?.addEventListener("input", (event) => {
    taskSearch = (event.currentTarget as HTMLInputElement).value.slice(0, TASK_TITLE_MAX_LENGTH);
    editingTaskId = null;
    taskFeedback = "";
    refresh({ kind: "search" });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-task-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.taskEdit;
      if (!id) return;
      editingTaskId = id;
      taskFeedback = "";
      refresh({ kind: "edit-input", id });
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-task-execute]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.taskExecute;
      if (!id) return;
      const task = loadTaskItems(options.storage).find((item) => item.id === id);
      if (!task?.environmentPath || !options.onExecuteTask) return;
      taskFeedback = `Ouverture d’un chat pour « ${task.title} »…`;
      options.onExecuteTask(task);
    });
  });

  root.querySelectorAll<HTMLFormElement>("[data-task-edit-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const id = form.dataset.taskEditForm;
      const input = form.querySelector<HTMLInputElement>("[data-task-edit-input]");
      const dueDate = form.querySelector<HTMLInputElement>("[data-task-edit-due]")?.value ?? null;
      const priority = form.querySelector<HTMLSelectElement>("[data-task-edit-priority]")?.value
        ?? "normal";
      const category = form.querySelector<HTMLSelectElement>("[data-task-edit-environment]")?.value;
      const title = normalizeTaskTitle(input?.value);
      if (!id || !input || !title) {
        input?.setCustomValidity("Le titre ne peut pas être vide.");
        input?.reportValidity();
        return;
      }
      input.setCustomValidity("");
      editingTaskId = null;
      const renamed = renameTaskItem(loadTaskItems(options.storage), id, title);
      save(updateTaskDetails(renamed, id, {
        dueDate,
        priority,
        environmentPath: category === "environment" ? options.environment?.path : null,
      }), "Tâche modifiée.", {
        kind: "edit",
        id,
      });
    });
    form.querySelector<HTMLInputElement>("[data-task-edit-input]")?.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        const id = form.dataset.taskEditForm;
        editingTaskId = null;
        taskFeedback = "";
        refresh(id ? { kind: "edit", id } : null);
      },
    );
  });

  root.querySelectorAll<HTMLButtonElement>("[data-task-edit-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.taskEditCancel;
      editingTaskId = null;
      taskFeedback = "";
      refresh(id ? { kind: "edit", id } : null);
    });
  });

  root.querySelectorAll<HTMLButtonElement>("[data-task-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.taskDelete;
      if (!id) return;
      editingTaskId = editingTaskId === id ? null : editingTaskId;
      save(removeTaskItem(loadTaskItems(options.storage), id), "Tâche supprimée.", { kind: "create" });
    });
  });

  root.querySelector<HTMLButtonElement>("#tasksClearCompleted")?.addEventListener("click", () => {
    const items = loadTaskItems(options.storage);
    const completedIds = new Set(
      taskItemsForEnvironment(items, options.environment?.path)
        .filter((task) => task.completed)
        .map((task) => task.id),
    );
    const count = completedIds.size;
    editingTaskId = null;
    save(
      items.filter((task) => !completedIds.has(task.id)),
      `${taskCountLabel(count, "tâche")} supprimée${count > 1 ? "s" : ""}.`,
      { kind: "create" },
    );
  });
};
