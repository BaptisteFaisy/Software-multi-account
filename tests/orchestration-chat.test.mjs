import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  orchestrationIsRunning,
  orchestrationOrchestratorAccountId,
  orchestrationPhaseLabel,
  orchestrationProgress,
  orchestrationStatusLabel,
  orchestrationTaskStatusLabel,
  orchestrationWorkerAccountId,
} from "../src/chat/orchestration.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const chatView = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/orchestration.rs", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

const run = (overrides = {}) => ({
  status: "active",
  phase: "working",
  currentTurnId: null,
  currentStartId: null,
  currentValidationId: null,
  tasks: [
    { id: "task-01", status: "accepted" },
    { id: "task-02", status: "revision_requested" },
  ],
  ...overrides,
});

test("les statuts et la progression du chat orchestré sont explicites", () => {
  assert.equal(orchestrationStatusLabel("needs_attention"), "Attention requise");
  assert.equal(orchestrationPhaseLabel("final_validation"), "Validation finale");
  assert.equal(orchestrationTaskStatusLabel("revision_requested"), "Correction demandée");
  assert.deepEqual(orchestrationProgress(run()), { accepted: 1, total: 2, percent: 50 });
  assert.equal(orchestrationIsRunning(run({ currentValidationId: "validation-1" })), true);
  assert.equal(orchestrationIsRunning(run({ status: "paused", currentTurnId: 42 })), false);
});

test("chaque rôle résout son propre compte avec migration des anciens snapshots", () => {
  const legacy = { accountId: "legacy" };
  assert.equal(orchestrationOrchestratorAccountId(legacy), "legacy");
  assert.equal(
    orchestrationOrchestratorAccountId({ ...legacy, orchestratorAccountId: "pilot" }),
    "pilot",
  );
  assert.equal(
    orchestrationWorkerAccountId(
      { accountId: "legacy", workerAccountIds: ["worker-1", "worker-2"] },
      { position: 2 },
    ),
    "worker-2",
  );
  assert.equal(
    orchestrationWorkerAccountId(
      { accountId: "legacy", workerAccountIds: ["worker-1"] },
      { position: 1, accountId: "replacement" },
    ),
    "replacement",
  );
});

test("la vue dédiée crée et expose chaque chat de l'équipe", () => {
  assert.match(main, /\| "orchestration"/);
  assert.match(main, /id="orchestrationCreateForm"/);
  assert.match(main, /id="orchestrationWorkerCount"[^>]*min="1"[^>]*max="12"/);
  assert.match(main, /id="orchestrationConvertWorkerCount"[^>]*min="1"[^>]*max="12"/);
  assert.match(main, /orchestratorSessionId: sessionId,[\s\S]*?workerCount|workerCount,[\s\S]*?orchestratorSessionId: sessionId/);
  assert.match(main, /Attends la fin du message en cours avant d'orchestrer ce chat/);
  assert.match(main, /Envoie ou annule les messages en attente avant d'orchestrer ce chat/);
  assert.match(main, /discussionForSession\(allDiscussions\(\), accountId, sessionId\)/);
  assert.match(main, /workerCount,/);
  assert.match(main, /workerAccountIds,/);
  assert.match(main, /data-orchestration-account-role/);
  assert.match(main, /Adresse e-mail \/ compte/);
  assert.match(main, /reassign_orchestration_account/);
  assert.match(main, /1 orchestrateur \+ \$\{workerCount\} worker/);
  assert.match(main, /id="orchestrationToggle"/);
  assert.match(main, /data-view="orchestration"/);
  assert.match(main, /create_orchestration/);
  assert.match(main, /control_orchestration/);
  assert.match(main, /delete_orchestration/);
  assert.match(main, /data-orchestration-open-session/);
  assert.match(main, /Preuve du travailleur/);
  assert.match(main, /Dernière revue orchestrateur/);
  assert.match(style, /\.orchestration-panel/);
  assert.match(style, /\.orchestration-task-list/);
  assert.match(style, /\.orchestration-workbench/);
  assert.match(style, /\.orchestration-member-account/);
  assert.match(style, /@media \(max-width: 860px\)[\s\S]*\.m-sheet-grid button\.m-orchestration-entry/);
});

test("un chat normal peut devenir l'orchestrateur et matérialiser ses workers", () => {
  assert.match(chatView, /data-chat-action="\$\{orchestration\.role === "available" \? "orchestrate" : "open-orchestration"\}"/);
  assert.match(chatView, /managedByOrchestration \? `<footer class="chat-orchestration-managed"/);
  assert.match(main, /id="orchestrationConvertForm"/);
  assert.match(main, /id="autonomousOrchestrationAccount"/);
  assert.match(main, /data-autonomous-orchestration-worker=/);
  assert.match(main, /workerAccountIds: state\.workerAccountIds\.slice/);
  assert.match(main, /orchestratorSessionId: sessionId/);
  assert.match(main, /pane\.orchestrationRole = "orchestrator"/);
  assert.match(main, /run\.tasks\.forEach\(\(task\) =>/);
  assert.match(main, /orchestrationRole: "worker"/);
  assert.match(main, /syncOrchestrationChatPanes/);
  assert.match(main, /activeView === "chat" && expertChatPanes\.some\(\(pane\) => !!pane\.orchestrationId\)/);
  assert.match(backend, /pub orchestrator_session_id: Option<String>/);
  assert.match(backend, /orchestrator_session_id: orchestrator_session_id\.clone\(\)/);
});

test("desktop et serveur partagent le contrat API orchestré", () => {
  for (const command of [
    "list_orchestrations",
    "create_orchestration",
    "control_orchestration",
    "reassign_orchestration_account",
    "delete_orchestration",
  ]) {
    assert.match(platform, new RegExp(`case "${command}"`));
    assert.match(lib, new RegExp(`orchestration::${command}`));
  }
  assert.match(server, /"\/orchestrations"/);
  assert.match(server, /"\/orchestrations\/:id\/control"/);
  assert.match(server, /"\/orchestrations\/:id\/account"/);
  assert.match(server, /check_admin_header\(&state, &headers\)/);
});

test("le moteur impose isolation, preuve, revue, test réel et publication prudente", () => {
  assert.match(backend, /worktree", "add", "--detach"/);
  assert.match(backend, /ORCHESTRATION_PLAN:/);
  assert.match(backend, /pub worker_count: u32/);
  assert.match(backend, /validate_worker_count/);
  assert.match(backend, /exactement \{\} taches d'implementation/);
  assert.match(backend, /validate_plan\(plan, run\.worker_count\)/);
  assert.match(backend, /copy_discussion_between/);
  assert.match(backend, /export_transcript_for_account/);
  assert.match(backend, /handoff_pending/);
  assert.match(backend, /ORCHESTRATION_PROOF:/);
  assert.match(backend, /ORCHESTRATION_REVIEW:/);
  assert.match(backend, /ORCHESTRATION_FINAL:/);
  assert.match(backend, /proof\.tests\.iter\(\)\.any\(\|test\| !test\.passed\)/);
  assert.match(backend, /run_validation_command/);
  assert.match(backend, /protocol_failures/);
  assert.match(backend, /reprise automatique en cours/);
  assert.match(backend, /"diff", "--cached"/);
  assert.match(backend, /Le projet source a change de commit pendant l'orchestration/);
  assert.match(backend, /git_sandboxes_apply_review_commit_and_publish_patch/);
});
