import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TASKS_STORAGE_KEY,
  addTaskItem,
  clearCompletedTaskItems,
  filterTaskItems,
  loadTaskItems,
  normalizeTaskEnvironmentPath,
  normalizeTaskItems,
  persistTaskItems,
  removeTaskItem,
  renameTaskItem,
  renderTasksPanel,
  searchTaskItems,
  setTaskCompleted,
  taskDueState,
  taskItemsForEnvironment,
  taskScheduleGroup,
  taskStats,
  updateTaskDetails,
} from "../src/tasks.ts";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
};

test("normalise les tâches persistées et ignore les entrées invalides", () => {
  assert.deepEqual(
    normalizeTaskItems([
      { id: "a", title: "  Préparer   la démo  ", completed: false, createdAt: 10 },
      { id: "a", title: "doublon", completed: true, createdAt: 20 },
      { id: "b", title: "   " },
      null,
    ], 99),
    [{
      id: "a",
      title: "Préparer la démo",
      completed: false,
      createdAt: 10,
      completedAt: null,
      priority: "normal",
      dueDate: null,
      environmentPath: null,
    }],
  );
});

test("ajoute, modifie, termine, filtre et supprime une tâche", () => {
  const created = addTaskItem([], "  Écrire   les tests ", 1_000, "task-test");
  assert.deepEqual(created, [{
    id: "task-test",
    title: "Écrire les tests",
    completed: false,
    createdAt: 1_000,
    completedAt: null,
    priority: "normal",
    dueDate: null,
    environmentPath: null,
  }]);

  const renamed = renameTaskItem(created, "task-test", "Livrer les tests");
  const completed = setTaskCompleted(renamed, "task-test", true, 2_000);
  assert.equal(completed[0].title, "Livrer les tests");
  assert.equal(completed[0].completedAt, 2_000);
  assert.deepEqual(filterTaskItems(completed, "active"), []);
  assert.equal(filterTaskItems(completed, "completed").length, 1);
  assert.deepEqual(taskStats(completed), { total: 1, active: 0, completed: 1, progress: 100 });
  assert.deepEqual(clearCompletedTaskItems(completed), []);
  assert.deepEqual(removeTaskItem(completed, "task-test"), []);
});

test("gère les échéances, priorités, retards et la recherche", () => {
  const today = new Date(2026, 6, 14, 12).getTime();
  const tasks = addTaskItem([], "Préparer la livraison", today, "planned", {
    priority: "high",
    dueDate: "2026-07-13",
  });
  assert.equal(tasks[0].priority, "high");
  assert.equal(tasks[0].dueDate, "2026-07-13");
  assert.equal(taskDueState(tasks[0], today), "overdue");
  assert.equal(taskScheduleGroup(tasks[0], today), "today");
  assert.equal(searchTaskItems(tasks, "LIVRAISON").length, 1);
  assert.equal(searchTaskItems(tasks, "mobile").length, 0);

  const updated = updateTaskDetails(tasks, "planned", {
    priority: "low",
    dueDate: "2026-07-15",
  });
  assert.equal(updated[0].priority, "low");
  assert.equal(taskDueState(updated[0], today), "upcoming");
  assert.equal(taskScheduleGroup(updated[0], today), "tomorrow");

  const endOfWeek = updateTaskDetails(updated, "planned", {
    priority: "normal",
    dueDate: "2026-07-18",
  });
  assert.equal(taskScheduleGroup(endOfWeek[0], today), "week");
  assert.equal(taskScheduleGroup({ dueDate: null }, today), "today");

  const invalid = updateTaskDetails(updated, "planned", {
    priority: "urgente",
    dueDate: "2026-02-31",
  });
  assert.equal(invalid[0].priority, "normal");
  assert.equal(invalid[0].dueDate, null);
});

test("isole les tâches liées à leur environnement", () => {
  const personal = addTaskItem([], "Tâche personnelle", 1_000, "personal");
  const projectA = addTaskItem(personal, "Compiler le projet A", 2_000, "project-a", {
    environmentPath: " C:\\Projects\\A\\ ",
  });
  const projectB = addTaskItem(projectA, "Compiler le projet B", 3_000, "project-b", {
    environmentPath: "C:\\Projects\\B",
  });

  assert.equal(normalizeTaskEnvironmentPath(" C:\\Projects\\A\\ "), "C:\\Projects\\A");
  assert.deepEqual(
    taskItemsForEnvironment(projectB, "c:/projects/a").map((task) => task.id),
    ["project-a", "personal"],
  );
  assert.deepEqual(
    taskItemsForEnvironment(projectB, null).map((task) => task.id),
    ["personal"],
  );

  const updated = updateTaskDetails(projectB, "project-a", {
    priority: "high",
    dueDate: "2026-07-15",
  });
  assert.equal(updated.find((task) => task.id === "project-a")?.environmentPath, "C:\\Projects\\A");

  const madePersonal = updateTaskDetails(updated, "project-a", {
    priority: "high",
    dueDate: "2026-07-15",
    environmentPath: null,
  });
  assert.equal(madePersonal.find((task) => task.id === "project-a")?.environmentPath, null);
});

test("persiste la liste et résiste à un stockage corrompu", () => {
  const storage = memoryStorage();
  const tasks = addTaskItem([], "Tâche persistée", 3_000, "persisted");
  assert.equal(persistTaskItems(tasks, storage), true);
  assert.deepEqual(loadTaskItems(storage), tasks);
  assert.ok(storage.values.has(TASKS_STORAGE_KEY));

  storage.values.set(TASKS_STORAGE_KEY, "{invalide");
  assert.deepEqual(loadTaskItems(storage), []);
});

test("échappe le contenu saisi dans le panneau", () => {
  const storage = memoryStorage();
  const personal = addTaskItem([], '<img src=x onerror="alert(1)">', 4_000, "unsafe");
  const tasks = addTaskItem(personal, "Lancer les tests", 5_000, "environment-task", {
    environmentPath: "C:\\Projects\\Produit",
  });
  persistTaskItems(tasks, storage);
  const panel = renderTasksPanel(storage, {
    path: "c:/projects/produit",
    label: "Produit",
  });
  assert.doesNotMatch(panel, /<img src=x/);
  assert.match(panel, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(panel, /id="taskCreateForm"/);
  assert.match(panel, /data-task-toggle="unsafe"/);
  assert.match(panel, /data-task-group="today"/);
  assert.match(panel, /data-task-group="tomorrow"/);
  assert.match(panel, /data-task-group="week"/);
  assert.match(panel, /Tâches relatives à cet environnement/);
  assert.match(panel, /data-task-execute="environment-task"/);
  assert.match(panel, /id="taskEnvironment"/);
  assert.ok(panel.indexOf("Aujourd’hui") < panel.indexOf("Demain"));
  assert.ok(panel.indexOf("Demain") < panel.indexOf("Fin de la semaine"));
});

test("la vue Tâches est reliée aux navigations desktop et mobile", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

  assert.match(main, /\| "tasks"/);
  assert.match(main, /id="tasksToggle"/);
  assert.match(main, /role="menuitem" data-view="tasks"/);
  assert.match(main, /case "tasks":\s*return renderTasksPanel\(undefined, currentTaskEnvironment\(\)\);/);
  assert.match(main, /mountTasksPanel\(\{[\s\S]*?onExecuteTask:/);
  assert.match(main, /openNewChatModal\(\{ workspacePath: task\.environmentPath, task \}\)/);
  assert.match(main, /sendExpertChatMessage\(pane, root, prompt\)/);
  assert.match(main, /data-task-nav-count/);
  assert.match(style, /\.tasks-panel/);
  assert.match(style, /@media \(max-width: 560px\)[\s\S]*?\.task-create/);
});
