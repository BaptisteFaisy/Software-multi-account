import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const discussions = readFileSync(
  new URL("../src-tauri/src/discussions.rs", import.meta.url),
  "utf8",
);

const block = (startMarker, endMarker) => {
  const start = main.indexOf(startMarker);
  const end = main.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `bloc introuvable: ${startMarker}`);
  assert.ok(end > start, `fin de bloc introuvable: ${endMarker}`);
  return main.slice(start, end);
};

test("le routage du nouveau chat reste local et propose l'automatique par defaut", () => {
  const selection = block(
    "const syncNewChatRoutingUi =",
    "const openAutonomousOrchestrationPromotion =",
  );

  assert.match(selection, /classList\.toggle\("selected", selected\)/);
  assert.match(selection, /setAttribute\("aria-checked", String\(selected\)\)/);
  assert.match(selection, /const selectNewChatAutomaticRouting =/);
  assert.match(selection, /newChatRoutingMode = options\.automatic \? "automatic" : "manual"/);
  assert.match(selection, /modelInput\.value = newChatModel/);
  assert.match(selection, /newChatModelDrafts\.set/);
  assert.doesNotMatch(selection, /\brender\(\)/);

  const binding = block(
    "const newChatAccountButtons =",
    "const newChatModelInput =",
  );
  assert.match(binding, /selectNewChatAccount\(button\.dataset\.newChatAccount/);
  assert.match(binding, /selectNewChatAutomaticRouting\(\)/);
  assert.match(binding, /"ArrowDown"/);
  assert.doesNotMatch(binding, /\brender\(\)/);
});

test("le parcours principal masque le compte derriere une attribution facultative", () => {
  const modal = block("const renderNewChatModal =", "const openChatAccountIdsForQuotaSelection =");

  assert.match(modal, /Continuité automatique/);
  assert.match(modal, /class="new-chat-routing-details"/);
  assert.match(modal, /<summary>/);
  assert.match(modal, /data-new-chat-routing-auto/);
  assert.match(modal, /id="confirmNewChat"/);
  assert.doesNotMatch(modal, /id="confirmBestQuotaNewChat"|Compte \/ agent|Choisis le compte/);
  assert.match(style, /\.new-chat-routing-details\s*\{/);
  assert.match(style, /\.new-chat-routing-details:not\(\[open\]\) > \.new-chat-account-options\s*\{[^}]*display:\s*none/s);
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
  assert.match(resume, /let pane = reusePane/);
  assert.match(resume, /if \(!sent && transferSnapshot\)/);
  assert.match(
    main,
    /continueDiscussionWith\(currentDiscussion, suggestion\.accountId, pane, \{\s*preserveNavigation: true,\s*\}\)/,
  );
  assert.match(resume, /const preserveNavigation = options\.preserveNavigation === true/);
  assert.match(resume, /const activateReusePane = !!reusePane && !preserveNavigation/);
});

test("la progression de bascule est visible, accessible et animee sans mouvement force", () => {
  assert.match(view, /accountTransition\?:/);
  assert.match(view, /class="chat-account-transition" role="status" aria-live="polite"/);
  assert.match(view, /aria-busy="true"/);
  assert.match(style, /\.chat-account-transition\s*\{/);
  assert.match(style, /@keyframes chat-account-transition-progress/);
  assert.match(style, /\.chat-account-transition\s*\{[^}]*position:\s*absolute/s);
  assert.match(style, /prefers-reduced-motion: reduce/);
});

test("la reprise automatique ne montre plus le changement de compte", () => {
  const continuation = block("const continueDiscussionWith =", "const discussionHasRunningTurn =");

  assert.match(continuation, /label: "Continuité automatique"/);
  assert.match(continuation, /Préparation de la suite de la conversation/);
  assert.doesNotMatch(continuation, /Changement de compte|sourceLabel.*target\.label/);
  assert.match(view, /Continuité automatique\.<\/strong> Une capacité compatible prend le relais/);
  assert.doesNotMatch(view, /Transfert automatique vers/);
});

test("le chargement du catalogue modele ne declenche plus de rendu global", () => {
  const catalog = block("const loadChatModelCatalog =", "const reasoningEffortOptions =");
  assert.match(catalog, /visiblePanes\.forEach\(\(pane\) => refreshExpertChatPane\(pane\)\)/);
  assert.doesNotMatch(catalog, /\brender\(\)/);
});

test("le nouveau compte est libere avant l'archivage et le rescannage", () => {
  const finalization = block(
    "const finalizeTransferredDiscussion =",
    "const releaseTransferredDiscussion =",
  );
  const release = block(
    "const releaseTransferredDiscussion =",
    "const expertPaneForDiscussion =",
  );
  const continuation = block(
    "const continueDiscussionWith =",
    "const discussionHasRunningTurn =",
  );

  assert.match(finalization, /await archiveTransferredDiscussion\(discussion\)/);
  assert.match(finalization, /discussionBusyId === discussion\.sessionId/);
  assert.match(finalization, /await refreshDiscussions\(\)/);
  assert.match(release, /setExpertChatAccountTransition\(transferPane, null\)/);
  assert.match(release, /void finalizeTransferredDiscussion\(discussion, target, pendingStatus\)/);
  assert.doesNotMatch(release, /await archiveTransferredDiscussion|await refreshDiscussions/);
  assert.doesNotMatch(release, /discussionBusyId = null/);
  assert.equal(
    (continuation.match(/releaseTransferredDiscussion\(discussion, target, transferPane\)/g) ?? [])
      .length,
    2,
  );
});

test("la copie Codex ne recharge ni ne rescane tout le transcript", () => {
  const start = discussions.indexOf("fn copy_discussion(");
  const end = discussions.indexOf(
    "\n// ---------------------------------------------------------------------------\n// (d) move_discussion",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const copy = discussions.slice(start, end);

  assert.match(copy, /cached_rollout_path_for_id\(&source, &session_id\)/);
  assert.match(copy, /cached_file_summary\(&src, &source, scan_discussion_file\)/);
  assert.match(copy, /BufReader::with_capacity\(DISCUSSION_COPY_BUFFER_BYTES/);
  assert.match(copy, /BufWriter::with_capacity\(DISCUSSION_COPY_BUFFER_BYTES/);
  assert.match(copy, /std::io::copy\(&mut reader, &mut writer\)/);
  assert.match(copy, /summary_cache_key\(&dest, &target\)/);
  assert.doesNotMatch(copy, /scan_discussion_file\(&dest, &target\)/);
  assert.doesNotMatch(copy, /fs::read_to_string\(&src\)/);
});
