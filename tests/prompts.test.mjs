import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PROMPTS_STORAGE_KEY,
  addPromptItem,
  filterPromptItems,
  loadPromptItems,
  markPromptUsed,
  mergePromptItems,
  normalizePromptItems,
  parsePromptImport,
  persistPromptItems,
  promptCategories,
  promptLibraryStats,
  recordPromptUse,
  removePromptItem,
  renderPromptLibraryPanel,
  searchPromptItems,
  togglePromptFavorite,
  updatePromptItem,
} from "../src/prompts.ts";
import {
  favoritePromptShortcutsFromValue,
  loadFavoritePromptShortcuts,
} from "../src/prompt-shortcuts.ts";

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
};

test("normalise les prompts persistés et ignore les entrées invalides", () => {
  assert.deepEqual(normalizePromptItems([
    {
      id: "prompt-a",
      title: "  Relecture   exigeante ",
      content: "  Analyse ce code.  ",
      category: "  Développement  ",
      tags: ["Code", " code ", "Qualité"],
      favorite: true,
      createdAt: 10,
      updatedAt: 20,
      useCount: 3.8,
      lastUsedAt: 30,
    },
    { id: "prompt-a", title: "Doublon", content: "Ignoré" },
    { id: "sans-contenu", title: "Vide", content: "   " },
    null,
  ], 99), [{
    id: "prompt-a",
    title: "Relecture exigeante",
    content: "Analyse ce code.",
    category: "Développement",
    tags: ["Code", "Qualité"],
    favorite: true,
    createdAt: 10,
    updatedAt: 20,
    useCount: 3,
    lastUsedAt: 30,
  }]);
});

test("ajoute, modifie, met en favori, comptabilise et supprime un prompt", () => {
  const created = addPromptItem([], {
    title: " Résumer un document ",
    content: "Résume ce document en cinq points.",
    category: "Rédaction",
    tags: "résumé, synthèse, résumé",
  }, 1_000, "prompt-test");

  assert.equal(created.length, 1);
  assert.equal(created[0].title, "Résumer un document");
  assert.deepEqual(created[0].tags, ["résumé", "synthèse"]);
  assert.equal(created[0].favorite, false);

  const updated = updatePromptItem(created, "prompt-test", {
    title: "Synthèse exécutive",
    content: "Produis une synthèse destinée à la direction.",
    category: "Travail",
    tags: ["Direction"],
    favorite: true,
  }, 2_000);
  assert.equal(updated[0].title, "Synthèse exécutive");
  assert.equal(updated[0].favorite, true);
  assert.equal(updated[0].updatedAt, 2_000);

  const unfavorited = togglePromptFavorite(updated, "prompt-test", 2_500);
  assert.equal(unfavorited[0].favorite, false);
  const used = markPromptUsed(unfavorited, "prompt-test", 3_000);
  assert.equal(used[0].useCount, 1);
  assert.equal(used[0].lastUsedAt, 3_000);
  assert.deepEqual(promptLibraryStats(used), {
    total: 1,
    favorites: 0,
    categories: 1,
    uses: 1,
  });
  assert.deepEqual(removePromptItem(used, "prompt-test"), []);
});

test("recherche sans accents et filtre par favori ou catégorie", () => {
  const first = addPromptItem([], {
    title: "Audit d’accessibilité",
    content: "Vérifie le contraste et la navigation clavier.",
    category: "Développement",
    tags: ["UI", "qualité"],
    favorite: true,
  }, 1_000, "audit");
  const prompts = addPromptItem(first, {
    title: "Plan éditorial",
    content: "Propose dix sujets pour le prochain trimestre.",
    category: "Rédaction",
    tags: ["contenu"],
  }, 2_000, "editorial");

  assert.deepEqual(searchPromptItems(prompts, "accessibilite clavier").map(({ id }) => id), ["audit"]);
  assert.deepEqual(searchPromptItems(prompts, "QUALITE").map(({ id }) => id), ["audit"]);
  assert.deepEqual(filterPromptItems(prompts, { scope: "favorites" }).map(({ id }) => id), ["audit"]);
  assert.deepEqual(filterPromptItems(prompts, { category: "rédaction" }).map(({ id }) => id), ["editorial"]);
  assert.deepEqual(promptCategories(prompts), [
    { name: "Développement", count: 1 },
    { name: "Rédaction", count: 1 },
  ]);
});

test("persiste la bibliothèque et résiste à un stockage corrompu", () => {
  const storage = memoryStorage();
  const prompts = addPromptItem([], {
    title: "Prompt persistant",
    content: "Toujours disponible après le redémarrage.",
  }, 4_000, "persisted");

  assert.equal(persistPromptItems(prompts, storage), true);
  assert.deepEqual(loadPromptItems(storage), prompts);
  assert.ok(storage.values.has(PROMPTS_STORAGE_KEY));
  assert.equal(recordPromptUse("persisted", storage, 4_500), true);
  assert.equal(loadPromptItems(storage)[0].useCount, 1);
  assert.equal(loadPromptItems(storage)[0].lastUsedAt, 4_500);

  storage.values.set(PROMPTS_STORAGE_KEY, "{json-invalide");
  assert.deepEqual(loadPromptItems(storage), []);
});

test("expose chaque prompt favori comme raccourci de chat", () => {
  const storage = memoryStorage();
  storage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify([
    {
      id: "favori-recent",
      title: "  Relecture   finale  ",
      content: "Relis ce texte.",
      favorite: true,
      updatedAt: 2_000,
    },
    {
      id: "ordinaire",
      title: "Sans étoile",
      content: "Ne doit pas apparaître.",
      favorite: false,
      updatedAt: 3_000,
    },
    {
      id: "favori-ancien",
      title: "Plan détaillé",
      content: "Prépare un plan.",
      favorite: true,
      updatedAt: 1_000,
    },
  ]));

  assert.deepEqual(loadFavoritePromptShortcuts(storage), [
    { id: "favori-recent", title: "Relecture finale", content: "Relis ce texte." },
    { id: "favori-ancien", title: "Plan détaillé", content: "Prépare un plan." },
  ]);
  assert.deepEqual(favoritePromptShortcutsFromValue({ prompts: [] }), []);
});

test("importe les sauvegardes, crée les identifiants absents et fusionne par date", () => {
  const current = addPromptItem([], {
    title: "Version locale",
    content: "Contenu le plus récent.",
  }, 5_000, "shared");
  const imported = parsePromptImport({
    prompts: [
      {
        id: "shared",
        title: "Ancienne version",
        content: "Ne doit pas remplacer la version locale.",
        createdAt: 1_000,
        updatedAt: 2_000,
      },
      {
        title: "Prompt importé",
        content: "Identifiant généré automatiquement.",
        createdAt: 3_000,
        updatedAt: 3_000,
      },
    ],
  }, 6_000);

  assert.equal(imported.length, 2);
  assert.ok(imported.some((item) => item.id.startsWith("prompt-") || item.id.length > 10));
  const merged = mergePromptItems(current, imported);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === "shared")?.title, "Version locale");
});

test("échappe le contenu utilisateur dans le panneau", () => {
  const storage = memoryStorage();
  const prompts = addPromptItem([], {
    title: '<img src=x onerror="alert(1)">',
    content: '<script>alert("xss")</script>\nAnalyse ensuite le résultat.',
    category: '<b>Dangereux</b>',
    tags: ['<svg onload="alert(2)">'],
  }, 7_000, "unsafe");
  persistPromptItems(prompts, storage);

  const panel = renderPromptLibraryPanel(storage);
  assert.doesNotMatch(panel, /<script>alert/);
  assert.doesNotMatch(panel, /<img src=x/);
  assert.match(panel, /&lt;script&gt;alert\(&quot;xss&quot;\)&lt;\/script&gt;/);
  assert.match(panel, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(panel, /id="promptLibraryPanel"/);
  assert.match(panel, /data-prompt-use="unsafe"/);
  assert.match(panel, /data-prompt-edit="unsafe"/);
  assert.match(panel, /data-prompt-delete="unsafe"/);
});

test("la bibliothèque est reliée aux navigations desktop et mobile", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
  const promptView = readFileSync(new URL("../src/prompts-view.ts", import.meta.url), "utf8");
  const promptStyle = readFileSync(new URL("../src/prompts.css", import.meta.url), "utf8");

  assert.match(main, /\| "prompts"/);
  assert.match(main, /id="promptsToggle"/);
  assert.match(main, /role="menuitem" data-view="prompts"/);
  assert.match(main, /import type \{ PromptLibraryItem \} from "\.\/prompts";/);
  assert.match(main, /promptLibraryModulePromise = import\("\.\/prompts-view"\)/);
  assert.match(main, /if \(view === "prompts" && !promptLibraryModule\)/);
  assert.match(main, /case "prompts":\s*return promptLibraryModule\?\.renderPromptLibraryPanel\(\) \?\? "";/);
  assert.match(main, /promptLibraryModule\?\.mountPromptLibraryPanel\(\{[\s\S]*?onUsePrompt: useLibraryPromptInChat/);
  assert.match(main, /prompt\?: string \| null/);
  assert.match(main, /pane\.draft = pendingPrompt/);
  assert.match(promptView, /import "\.\/prompts\.css";/);
  assert.match(promptView, /renderPromptLibraryPanel/);
  assert.doesNotMatch(style, /\.prompt-library-panel/);
  assert.match(promptStyle, /\.prompt-library-panel/);
  assert.match(promptStyle, /@media \(max-width: 520px\)[\s\S]*?\.prompt-library-hero-actions/);
});

test("le composeur ouvre un sélecteur rapide et insère le prompt sans l'envoyer", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
  const prompts = readFileSync(new URL("../src/prompts.ts", import.meta.url), "utf8");
  const promptView = readFileSync(new URL("../src/prompts-view.ts", import.meta.url), "utf8");
  const promptStyle = readFileSync(new URL("../src/prompts.css", import.meta.url), "utf8");
  const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

  assert.match(view, /data-chat-action="prompts"/);
  assert.match(view, /class="chat-prompt-button"/);
  assert.match(promptView, /openPromptQuickPicker/);
  assert.match(prompts, /export const openPromptQuickPicker/);
  assert.match(prompts, /id = "promptQuickPicker"/);
  assert.match(prompts, /data-prompt-quick-use/);
  assert.match(prompts, /markPromptUsed\(items, item\.id\)/);
  assert.match(main, /openMainChatPromptQuickPicker/);
  assert.match(main, /openExpertChatPromptQuickPicker\(pane, root\)/);
  assert.match(main, /insertPromptAtComposerSelection/);
  assert.match(main, /currentInput\.dispatchEvent\(new Event\("input"/);
  assert.match(view, /model\.favoritePrompts\.length/);
  assert.match(view, /data-chat-action="favorite-prompt"/);
  assert.match(main, /favoritePrompts: loadFavoritePromptShortcuts\(\)/);
  assert.match(main, /insertFavoritePromptInMainChat/);
  assert.match(main, /insertFavoritePromptInExpertChat/);
  assert.match(main, /recordPromptShortcutUse/);
  assert.match(style, /\.chat-favorite-prompts/);
  assert.match(style, /\.chat-favorite-prompt-button/);
  assert.doesNotMatch(
    prompts.match(/export const openPromptQuickPicker[\s\S]*?type PromptFocusTarget/)?.[0] ?? "",
    /sendChatMessage|sendExpertChatMessage|requestSubmit/,
  );
  assert.match(promptStyle, /\.prompt-quick-picker::backdrop/);
  assert.match(promptStyle, /\.prompt-quick-results \{[^}]*min-height: 0;[^}]*overflow-y: auto;/);
  assert.match(promptStyle, /--prompt-quick-max-height: min\(84dvh, 720px\)/);
  assert.match(promptStyle, /padding-right: env\(safe-area-inset-right\)/);
  assert.match(promptStyle, /padding-left: env\(safe-area-inset-left\)/);
  assert.match(promptStyle, /padding-bottom: max\(9px, env\(safe-area-inset-bottom\)\)/);
  assert.match(promptStyle, /@media \(max-width: 700px\)[\s\S]*?\.prompt-quick-picker/);
});
