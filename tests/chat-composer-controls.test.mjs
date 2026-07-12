import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("le compositeur de chat n'affiche plus de selecteur de compte", () => {
  // Le compte est fige par conversation : on le choisit dans la modale
  // « Nouveau chat », plus dans la barre du compositeur.
  assert.doesNotMatch(view, /chat-account-select/);
  assert.doesNotMatch(view, /data-chat-control="account"/);
  assert.doesNotMatch(view, /id="\$\{id\("chatAccount"\)\}"/);
  // Le helper qui construisait les <option> de comptes doit disparaitre.
  assert.doesNotMatch(view, /const accountOptions = /);
});

test("plus aucun listener n'est cable sur le selecteur de compte du chat", () => {
  // Sans le <select>, les handlers de changement de compte seraient morts.
  assert.doesNotMatch(main, /#chatAccount"\)\?\.addEventListener/);
  assert.doesNotMatch(main, /\[data-chat-control='account'\]"\)\?\.addEventListener/);
});

test("le compositeur garde le selecteur d'intensite de raisonnement", () => {
  assert.match(view, /chat-effort-select/);
  assert.match(view, /data-chat-control="reasoning-effort"/);
  assert.match(view, /id="\$\{id\("chatReasoningEffort"\)\}"/);
});

test("les intensites proposees suivent le modele reel, pas une liste globale figee", () => {
  // Les <option> proviennent de model.reasoningEffortOptions (catalogue Codex du
  // modele selectionne), et le controle reste desactive quand le fournisseur ne
  // gere pas l'intensite de raisonnement.
  assert.match(view, /model\.reasoningEffortOptions\s*\n?\s*\.map\(/);
  assert.match(view, /!model\.supportsReasoningEffort/);
  // La valeur pre-selectionnee suit aussi le modele.
  assert.match(view, /option\.value === model\.selectedReasoningEffort/);
});

test("les options d'intensite du chat derivent du catalogue du modele", () => {
  // Cote main.ts, les options du chat passent par chatReasoningEffortOptions,
  // qui privilegie les efforts annonces par le catalogue du modele.
  assert.match(main, /reasoningEffortOptions: chatReasoningEffortOptions\(account, selectedModel\)/);
  assert.match(main, /chatCatalogModel\(account, model\)\?\.supportedReasoningEfforts/);
});
