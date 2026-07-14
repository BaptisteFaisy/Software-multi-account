import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

const block = (startMarker, endMarker) => {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `bloc introuvable: ${startMarker}`);
  assert.ok(end > start, `fin de bloc introuvable: ${endMarker}`);
  return main.slice(start, end);
};

test("changer le compte du nouveau chat ne reconstruit plus l'application", () => {
  const selection = block(
    "const selectNewChatAccount =",
    "const openAutonomousOrchestrationPromotion =",
  );

  assert.match(selection, /classList\.toggle\("selected", selected\)/);
  assert.match(selection, /setAttribute\("aria-checked", String\(selected\)\)/);
  assert.match(selection, /modelInput\.value = newChatModel/);
  assert.match(selection, /newChatModelDrafts\.set/);
  assert.doesNotMatch(selection, /\brender\(\)/);

  const binding = block(
    "const newChatAccountButtons =",
    "const newChatModelInput =",
  );
  assert.match(binding, /selectNewChatAccount\(button\.dataset\.newChatAccount/);
  assert.match(binding, /"ArrowDown"/);
  assert.doesNotMatch(binding, /\brender\(\)/);
});

test("changer le compte du nouveau terminal met seulement ses champs a jour", () => {
  const sync = block("const syncNewTerminalAccountUi =", "const renderAgentsModal =");
  assert.match(sync, /#newTerminalCodexHome/);
  assert.match(sync, /#newTerminalProjectDir/);
  assert.match(sync, /#newTerminalModel/);
  assert.match(sync, /#newTerminalReasoningEffort/);
  assert.match(sync, /details\.animate/);
  assert.doesNotMatch(sync, /\brender\(\)/);

  assert.match(
    main,
    /#newTerminalAccount"\)\?\.addEventListener\("change",[\s\S]*?syncNewTerminalAccountUi\(account\)/,
  );
});

test("un transfert de quota reutilise le panneau existant et sait revenir en arriere", () => {
  const resume = block("type ExpertChatAccountTransferSnapshot =", "const toggleExpertChatFullscreen =");

  assert.match(resume, /captureExpertChatAccountTransfer/);
  assert.match(resume, /prepareExpertChatAccountTransfer/);
  assert.match(resume, /restoreExpertChatAfterAccountTransfer/);
  assert.match(resume, /const pane = reusePane \?\?/);
  assert.match(resume, /if \(!sent && transferSnapshot\)/);
  assert.match(
    main,
    /continueDiscussionWith\(currentDiscussion, suggestion\.accountId, pane\)/,
  );
});

test("la progression de bascule est visible, accessible et animee sans mouvement force", () => {
  assert.match(view, /accountTransition\?:/);
  assert.match(view, /class="chat-account-transition" role="status" aria-live="polite"/);
  assert.match(view, /aria-busy="true"/);
  assert.match(style, /\.chat-account-transition\s*\{/);
  assert.match(style, /@keyframes chat-account-transition-progress/);
  assert.match(style, /prefers-reduced-motion: reduce/);
});

test("le chargement du catalogue modele ne declenche plus de rendu global", () => {
  const catalog = block("const loadChatModelCatalog =", "const reasoningEffortOptions =");
  assert.match(catalog, /visiblePanes\.forEach\(\(pane\) => refreshExpertChatPane\(pane\)\)/);
  assert.doesNotMatch(catalog, /\brender\(\)/);
});
