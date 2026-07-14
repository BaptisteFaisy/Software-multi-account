import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AUTONOMOUS_AGENT_TEMPLATES,
  autonomousAgentIsRunning,
  autonomousAgentTemplateById,
  autonomousConnectorLabel,
  autonomousInitialMemoryFromChat,
  autonomousMemoryKindLabel,
  autonomousStatusLabel,
  autonomousTestStatusLabel,
  autonomousTriggerLabel,
  autonomousWorkItemStatusLabel,
  autonomousWorkPlanProgress,
  formatAutonomousInterval,
  formatAutonomousSchedule,
  normalizeAutonomousConnectors,
  parseAutonomousWatchPaths,
  toggleAutonomousConnector,
} from "../src/chat/autonomous.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const chatView = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src-tauri/src/autonomous.rs", import.meta.url), "utf8");
const chatBackend = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");
const modelTools = readFileSync(new URL("../src-tauri/src/chat_model_tools.rs", import.meta.url), "utf8");
const orchestration = readFileSync(new URL("../src-tauri/src/orchestration.rs", import.meta.url), "utf8");
const desktop = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const theme = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

const agent = (overrides = {}) => ({
  id: "agent-1",
  systemManaged: false,
  name: "Optimiseur web",
  objective: "Optimiser les ressources de la page web",
  role: "Ingénieur performance",
  accountId: "account-1",
  projectDir: "/project",
  sessionId: null,
  mode: "build",
  model: null,
  reasoningEffort: null,
  connectors: [],
  intervalSeconds: 900,
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 1_900,
  lastRunStartedAt: null,
  lastRunFinishedAt: null,
  currentTurnId: null,
  currentStartId: null,
  attemptCount: 0,
  runCount: 0,
  consecutiveFailures: 0,
  modelCapacityRetryCount: 0,
  lastError: null,
  lastSummary: null,
  memory: [],
  memoryStrategy: null,
  workItems: [],
  nextTaskId: null,
  testCommand: null,
  testTimeoutSeconds: 300,
  testStatus: "not_configured",
  currentTestId: null,
  testCompletionPending: false,
  consecutiveTestFailures: 0,
  lastTestStartedAt: null,
  lastTestFinishedAt: null,
  lastTestExitCode: null,
  lastTestDurationMs: null,
  lastTestOutput: null,
  events: [],
  ...overrides,
});

test("les statuts autonomes et leur planning sont lisibles", () => {
  assert.equal(autonomousStatusLabel("active"), "Actif");
  assert.equal(autonomousStatusLabel("needs_attention"), "Attention requise");
  assert.equal(formatAutonomousInterval(900), "15 min");
  assert.equal(formatAutonomousSchedule(agent(), 1_000), "Prochaine étape dans 15 min");
  assert.equal(
    formatAutonomousSchedule(agent({ nextRunAt: 1_006, modelCapacityRetryCount: 2 }), 1_000),
    "Modèle saturé · nouvel essai dans 6 s · tentative #2",
  );
  assert.equal(
    formatAutonomousSchedule(agent({ currentTurnId: 42 }), 1_000),
    "Travail en cours · tour #42",
  );
  assert.equal(autonomousAgentIsRunning(agent({ currentTurnId: 42 })), true);
  assert.equal(autonomousAgentIsRunning(agent({ status: "paused", currentTurnId: 42 })), false);
  assert.equal(formatAutonomousSchedule(agent({ currentTestId: "test-1" }), 1_000), "Validation des tests en cours");
  assert.equal(formatAutonomousSchedule(agent({ currentStartId: "start-1" }), 1_000), "Démarrage du prochain tour");
  assert.equal(autonomousTestStatusLabel("passed"), "Réussi");
  assert.equal(autonomousMemoryKindLabel("user"), "Vous");
  assert.equal(autonomousWorkItemStatusLabel("in_progress"), "En cours");
  assert.equal(
    formatAutonomousSchedule(agent({ triggerKind: "workspace_change", nextRunAt: null }), 1_000),
    "En veille · attend une modification",
  );
  assert.equal(
    autonomousTriggerLabel(agent({ triggerKind: "workspace_change" })),
    "Modification du projet",
  );
  assert.deepEqual(
    autonomousWorkPlanProgress(agent({
      workItems: [
        { id: "ui", status: "done" },
        { id: "api", status: "todo" },
        { id: "obsolete", status: "cancelled" },
      ],
    })),
    { done: 1, remaining: 1, total: 2 },
  );
});

test("les connecteurs autonomes sont explicites, ordonnes et dedupliques", () => {
  assert.deepEqual(
    normalizeAutonomousConnectors(["google_calendar", "gmail", "gmail", "inconnu"]),
    ["gmail", "google_calendar"],
  );
  assert.deepEqual(toggleAutonomousConnector(["gmail"], "google_calendar"), ["gmail", "google_calendar"]);
  assert.deepEqual(toggleAutonomousConnector(["gmail", "google_calendar"], "gmail"), ["google_calendar"]);
  assert.equal(autonomousConnectorLabel("google_calendar"), "Google Agenda");
});

test("le contexte recent d'un chat normal amorce l'agent sans partager sa session", () => {
  const memory = autonomousInitialMemoryFromChat([
    { role: "user", text: "Ancienne demande " + "x".repeat(700) },
    { role: "assistant", text: "Décision intermédiaire" },
    { role: "user", text: "Nouvel objectif prioritaire" },
  ], 260);
  assert.match(memory, /chat normal/);
  assert.match(memory, /Nouvel objectif prioritaire/);
  assert.ok(memory.length <= 260);
});

test("les agents suggeres couvrent les idees et les corrections frontend et backend", () => {
  assert.deepEqual(
    AUTONOMOUS_AGENT_TEMPLATES.map((template) => template.id),
    ["project_radar", "frontend_bug_fixer", "backend_bug_fixer", "build_publisher"],
  );

  const radar = autonomousAgentTemplateById("project_radar");
  assert.equal(radar?.name, "Radar projet");
  assert.equal(radar?.mode, "plan");
  assert.equal(radar?.requireUserReview, false);
  assert.match(radar?.objective ?? "", /trois id.es nouvelles/);
  assert.match(radar?.objective ?? "", /ne modifie aucun fichier/);

  for (const id of ["frontend_bug_fixer", "backend_bug_fixer"]) {
    const fixer = autonomousAgentTemplateById(id);
    assert.equal(fixer?.mode, "build");
    assert.equal(fixer?.requireUserReview, true);
    assert.match(fixer?.objective ?? "", /un seul bug v.rifi. . la fois/);
    assert.match(fixer?.objective ?? "", /test de non-r.gression/);
  }

  assert.match(autonomousAgentTemplateById("frontend_bug_fixer")?.name ?? "", /frontend/);
  assert.match(autonomousAgentTemplateById("backend_bug_fixer")?.name ?? "", /backend/);
  const publisher = autonomousAgentTemplateById("build_publisher");
  assert.equal(publisher?.triggerKind, "workspace_change");
  assert.equal(publisher?.allowGitPublish, true);
  assert.match(publisher?.objective ?? "", /git push origin HEAD/);
  assert.match(publisher?.objective ?? "", /deploy:web:local/);
  assert.deepEqual(
    parseAutonomousWatchPaths("src\npublic, src; package.json"),
    ["src", "public", "package.json"],
  );
  assert.equal(autonomousAgentTemplateById("unknown"), undefined);
});

test("la nouvelle vue cree et pilote un agent autonome", () => {
  assert.match(main, /\| "autonomous"/);
  assert.match(main, /id="autonomousCreateForm"/);
  assert.match(main, /id="autonomousTemplateTitle">Agents sugg.r.s/);
  assert.match(main, /data-autonomous-template=/);
  assert.match(main, /autonomousAgentTemplateById\(button\.dataset\.autonomousTemplate\)/);
  assert.match(main, /autonomousNameDraft = template\.name/);
  assert.match(main, /autonomousRequireUserReview = template\.requireUserReview/);
  assert.match(main, /id="autonomousToggle"/);
  assert.match(main, /class="chat-side-autonomous-entry/);
  assert.match(main, /class="m-autonomous-entry" role="menuitem" data-view="autonomous"/);
  assert.match(main, /Agents autonomes<\/strong><small>Création et suivi 24\/7/);
  assert.match(main, /create_autonomous_agent/);
  assert.match(main, /control_autonomous_agent/);
  assert.match(main, /delete_autonomous_agent/);
  assert.match(main, /add_autonomous_agent_memory/);
  assert.match(main, /delete_autonomous_agent_memory/);
  assert.match(main, /schedule_autonomous_agent/);
  assert.match(main, /type="datetime-local"/);
  assert.match(main, /data-autonomous-schedule-open/);
  assert.match(main, /data-autonomous-frequency-input/);
  assert.match(main, /Fréquence récurrente/);
  assert.match(main, /Fréquence & heure/);
  assert.match(main, /intervalSeconds/);
  assert.match(main, /id="autonomousTriggerKind"/);
  assert.match(main, /value="workspace_change"/);
  assert.match(main, /id="autonomousWatchPaths"/);
  assert.match(main, /id="autonomousDebounceSeconds"/);
  assert.match(main, /id="autonomousAllowGitPublish"/);
  assert.match(main, /Créer et mettre en veille/);
  assert.match(main, /triggerKind: eventTriggered \? "workspace_change" : "schedule"/);
  assert.match(main, /allowGitPublish: eventTriggered && autonomousAllowGitPublish/);
  assert.match(main, /id="autonomousTestCommand"/);
  assert.match(main, /id="autonomousLaunchMode"/);
  assert.match(main, /value="orchestrator"/);
  assert.match(main, /id="autonomousLaunchWorkerCount"/);
  assert.match(main, /data-autonomous-launch-worker=/);
  assert.match(main, /deferFirstRun: launchOrchestration/);
  assert.match(main, /Agent lancé directement en mode orchestrateur/);
  assert.match(main, /id="autonomousEnvironmentPreset"/);
  assert.match(main, /Autre chemin…/);
  assert.match(main, /id="autonomousRequireUserReview" type="checkbox"/);
  assert.match(main, /requireUserReview: autonomousRequireUserReview/);
  assert.match(main, /data-autonomous-connector=/);
  assert.match(main, /connectors: accountProvider\(account\) === "codex" \? autonomousConnectors : \[\]/);
  assert.match(main, /Lecture autonome\. Envoi d’e-mail/);
  assert.match(main, /ouvre \/plugins, installe Gmail et\/ou Google Calendar/);
  assert.match(main, /L’agent et les connecteurs s’exécutent sur l’hôte du site :8080/);
  assert.match(main, /review\.externalAction/);
  assert.match(main, /Review par l'utilisateur avant d'appliquer les changements/);
  assert.match(main, /data-autonomous-action="testNow"/);
  assert.match(main, /Créer un agent autonome/);
  assert.match(main, /id="autonomousCreateShell"/);
  assert.match(main, /id="autonomousNewAgent"/);
  assert.match(main, /class="autonomous-agent-details"/);
  assert.match(main, /data-autonomous-edit-open=/);
  assert.match(main, /data-autonomous-edit-form=/);
  assert.match(main, /Enregistrer les modifications/);
  assert.match(main, /Plan de travail/);
  assert.match(main, /Strat.gie de m.moire/);
  assert.match(main, /Prochaine boucle/);
  assert.match(main, /id="autonomousMonitorHost"/);
  assert.match(main, /id="autonomousMonitorLauncher"/);
  assert.match(main, /id="autonomousMonitorWindow"/);
  assert.match(main, /renderChatTurnParts/);
  assert.match(main, /chat_turn_status/);
  assert.match(main, /data-autonomous-monitor-review="approveReview"/);
  assert.match(main, /data-autonomous-monitor-review="rejectReview"/);
  assert.match(main, /data-autonomous-monitor-delete=/);
  assert.match(main, /data-autonomous-monitor-delete-confirm=/);
  assert.match(main, /data-autonomous-monitor-delete-cancel/);
  assert.match(main, /data-autonomous-account=/);
  assert.match(main, /Adresse e-mail \/ compte/);
  assert.match(main, /data-autonomous-orchestrate=/);
  assert.match(main, /id="autonomousOrchestrationForm"/);
  assert.match(main, /id="autonomousOrchestrationAccount"/);
  assert.match(main, /data-autonomous-orchestration-worker=/);
  assert.match(main, /id="autonomousOrchestrationWorkersUseOrchestrator"/);
  assert.match(main, /promote_autonomous_agent_to_orchestration/);
  assert.match(main, /Bascule sans double exécution/);
  assert.match(main, /Connecteurs non transférés/);
  assert.match(main, /Aucun chat autonome n'est conservé dans Discussions/);
  assert.match(main, /autonomous-agent-delete-trigger/);
  assert.doesNotMatch(main, /data-autonomous-open-chat/);
  assert.doesNotMatch(main, /data-autonomous-monitor-chat/);
  assert.match(main, /vrai fonctionnement 24\/7/);
  assert.match(style, /\.autonomous-agent-card/);
  assert.match(style, /\.autonomous-agent-editor/);
  assert.match(style, /\.autonomous-agent-card\.is-editing/);
  assert.match(theme, /data-theme="light"\] \.autonomous-agent-editor/);
  assert.match(style, /\.autonomous-template-grid/);
  assert.match(style, /\.autonomous-template-card\.tone-frontend/);
  assert.match(style, /\.autonomous-template-card\.tone-backend/);
  assert.match(style, /\.autonomous-template-card\.tone-deploy/);
  assert.match(style, /\.autonomous-event-config/);
  assert.match(style, /\.autonomous-agent-edit-trigger/);
  assert.match(style, /\.autonomous-work-plan/);
  assert.match(style, /@media \(max-width: 760px\)[\s\S]*\.autonomous-panel/);
  assert.match(style, /\.chat-side-tools \.chat-side-autonomous-entry/);
  assert.match(style, /\.m-sheet-grid button\.m-autonomous-entry/);
  assert.match(style, /\.chat-admin-panel > \.autonomous-panel/);
  assert.match(style, /\.chat-app-layout\.is-autonomous \.chat-admin-head/);
  assert.match(style, /\.autonomous-monitor-window/);
  assert.match(style, /\.autonomous-monitor-delete-confirm/);
  assert.match(style, /\.autonomous-review-toggle/);
  assert.match(style, /\.autonomous-agent-review-policy/);
  assert.match(style, /\.autonomous-connector-access/);
  assert.match(style, /\.autonomous-agent-connectors/);
  assert.match(style, /\.autonomous-monitor-external-notice/);
  assert.match(style, /\.autonomous-schedule-editor/);
  assert.match(style, /@media \(max-width: 860px\)[\s\S]*#autonomousMonitorLauncher/);
});

test("le lanceur des agents autonomes peut etre reduit durablement", () => {
  assert.match(main, /AUTONOMOUS_MONITOR_COMPACT_STORAGE_KEY/);
  assert.match(main, /id="autonomousMonitorCompactToggle"/);
  assert.match(main, /Réduire le bouton Agents autonomes/);
  assert.match(main, /localStorage\.setItem\(AUTONOMOUS_MONITOR_COMPACT_STORAGE_KEY/);
  assert.match(style, /\.autonomous-monitor-host\.is-compact #autonomousMonitorLauncher/);
  assert.match(style, /\.autonomous-monitor-host\.is-compact \.autonomous-monitor-launcher-copy \{ display: none; \}/);
  assert.match(theme, /data-theme="light"\] #autonomousMonitorCompactToggle/);
});

test("desktop et serveur partagent le meme contrat API autonome", () => {
  for (const command of [
    "list_autonomous_agents",
    "create_autonomous_agent",
    "update_autonomous_agent",
    "control_autonomous_agent",
    "schedule_autonomous_agent",
    "reassign_autonomous_agent_account",
    "add_autonomous_agent_memory",
    "delete_autonomous_agent_memory",
    "delete_autonomous_agent",
    "promote_autonomous_agent_to_orchestration",
  ]) {
    assert.match(platform, new RegExp(`case "${command}"`));
  }
  assert.match(server, /"\/autonomous-agents"/);
  assert.match(
    server,
    /AutonomousAgentManager::new\(chat\.clone\(\), config\.data_dir\.join\("autonomous-agents\.json"\)\)/,
  );
  assert.match(server, /"\/autonomous-agents\/:id\/control"/);
  assert.match(server, /"\/autonomous-agents\/:id\/schedule"/);
  assert.match(server, /"\/autonomous-agents\/:id\/account"/);
  assert.match(server, /"\/autonomous-agents\/:id\/memories"/);
  assert.match(server, /"\/autonomous-agents\/:id\/memories\/:memory_id"/);
  assert.match(server, /"\/autonomous-agents\/:id\/orchestration"/);
  assert.match(server, /check_admin_header\(&state, &headers\)/);
  assert.match(platform, /case "create_autonomous_agent":\s*return api<T>\("POST", "\/api\/autonomous-agents", args\.request\)/);
  assert.match(platform, /case "update_autonomous_agent":[\s\S]*?\/api\/autonomous-agents\/\$\{encodeURIComponent/);
  assert.match(server, /post\(api_update_autonomous_agent\)\.delete\(api_delete_autonomous_agent\)/);
  assert.match(desktop, /autonomous::update_autonomous_agent/);
  assert.match(platform, /case "reassign_autonomous_agent_account":[\s\S]*?\/account`/);
  assert.match(desktop, /autonomous::reassign_autonomous_agent_account/);
  assert.match(desktop, /orchestration::promote_autonomous_agent_to_orchestration/);
});

test("un chat normal cree, conserve et modifie son agent autonome", () => {
  assert.match(chatView, /data-chat-action="\$\{autonomous\.role === "linked" \? "edit-autonomous" : "autonomize"\}"/);
  assert.match(main, /id="autonomousChatForm"/);
  assert.match(main, /id="autonomousChatAccount"/);
  assert.match(main, /id="autonomousChatModel"/);
  assert.match(main, /id="autonomousChatReasoningEffort"/);
  assert.match(main, /autonomousInitialMemoryFromChat\(pane\.messages\)/);
  assert.match(main, /pane\.autonomousAgentId = saved\.id/);
  assert.match(main, /autonomousAgentId: pane\.autonomousAgentId/);
  assert.match(main, /"update_autonomous_agent"/);
  assert.match(main, /accountId: account\.id/);
  assert.match(main, /Le chat reste une conversation normale/);
  assert.match(main, /Le moteur autonome n'efface ni ne verrouille ce chat/);
  assert.match(main, /id="autonomousChatPause"/);
  assert.match(backend, /pub struct UpdateAutonomousAgentRequest/);
  assert.match(backend, /pub fn update\(/);
  assert.match(backend, /Mets l'agent en pause et attends l'arret du cycle courant/);
  assert.match(backend, /agent\.work_items\.clear\(\)/);
  assert.match(backend, /agent\.memory_strategy = None/);
  assert.match(style, /\.expert-chat-autonomous-action/);
  assert.match(style, /\.autonomous-chat-modal/);
});

test("le modele d'un chat web cree lui-meme l'agent avec un outil natif", () => {
  assert.match(main, /sourceChatKey: pane\.key/);
  assert.match(platform, /sourceChatKey: args\.sourceChatKey \?\? null/);
  assert.match(backend, /pub source_chat_key: Option<String>/);
  assert.match(server, /"\/mcp\/chat-tools"/);
  assert.match(server, /start_with_model_tools\(request, Some\(tool_server\)\)/);
  assert.match(server, /chat_tool_capabilities\.claim_call\(token\)/);
  assert.match(chatBackend, /fn autonomous_agent_tool_instructions\(\)/);
  assert.match(chatBackend, /configure_codex_model_tool\(command, model_tool_server\)/);
  assert.match(chatBackend, /--mcp-config/);
  assert.match(chatBackend, /--allowedTools/);
  assert.match(modelTools, /AUTONOMOUS_AGENT_TOOL_NAME: &str = "create_autonomous_agent"/);
  assert.match(modelTools, /Le modele ne peut donc ni[\s\S]*choisir un autre compte/);
  assert.match(modelTools, /source_chat_key: context\.source_chat_key/);
  assert.match(modelTools, /N'affirme jamais que l'agent existe avant le succes de l'outil/);
});

test("un agent cree expose tous ses reglages dans un editeur persistant", () => {
  for (const field of [
    "name",
    "objective",
    "role",
    "accountId",
    "projectDir",
    "mode",
    "intervalMinutes",
    "triggerKind",
    "watchPaths",
    "debounceSeconds",
    "allowGitPublish",
    "model",
    "reasoningEffort",
    "requireUserReview",
    "testCommand",
    "testTimeoutSeconds",
    "activate",
  ]) {
    assert.match(main, new RegExp(`data-autonomous-edit-field="${field}"`));
  }
  assert.match(main, /data-autonomous-edit-connector=/);
  assert.match(main, /connectors: provider === "codex" \? draft\.connectors : \[\]/);
  assert.match(main, /activate: automaticallyPaused \|\| draft\.activate/);
  assert.match(main, /"update_autonomous_agent"/);
  assert.match(backend, /pub account_id: Option<String>/);
  assert.match(backend, /let account_changed = agent\.account_id != account_id/);
  assert.match(backend, /discussion_to_delete = agent[\s\S]*?\.session_id[\s\S]*?\.take\(\)/);
  assert.match(server, /api_update_autonomous_agent/);
});

test("la reaffectation d'un agent autonome protege le changement de compte", () => {
  assert.match(backend, /pub struct ReassignAutonomousAgentAccountRequest/);
  assert.match(backend, /pub fn reassign_account/);
  assert.match(backend, /account_has_auth_tokens\(target\)/);
  assert.match(backend, /agent\.current_start_id\.is_some\(\)/);
  assert.match(backend, /self\.inner\.chat\.stop\(turn_id\)/);
  assert.match(backend, /current\.account_id = target_account_id\.clone\(\)/);
  assert.match(backend, /remove_autonomous_discussion\(account_id, session_id\)/);
  assert.match(main, /invoke<AutonomousAgentSnapshot>\(\s*"reassign_autonomous_agent_account"/);
});

test("le lancement direct en orchestration differe tout cycle autonome", () => {
  assert.match(backend, /pub defer_first_run: bool/);
  assert.match(backend, /status: if defer_first_run \{\s*AutonomousAgentStatus::Paused/);
  assert.match(
    backend,
    /next_run_at: if defer_first_run[\s\S]*?\|\| trigger_kind == AutonomousTriggerKind::WorkspaceChange[\s\S]*?\{\s*None/,
  );
  assert.match(backend, /Agent préparé en pause pour son lancement en orchestration/);
  assert.match(main, /promote_autonomous_agent_to_orchestration/);
  assert.match(main, /workerAccountIds,/);
});

test("un quota autonome epuise bascule vers le meilleur autre compte", () => {
  assert.match(backend, /is_quota_exhaustion_message\(&error\)/);
  assert.match(backend, /settings::account_limit_views\(&app_settings\)/);
  assert.match(backend, /select_quota_failover_target/);
  assert.match(backend, /remaining_quota_percent/);
  assert.match(backend, /target\.source_account_id == agent\.account_id/);
  assert.match(backend, /agent\.account_id = target\.account_id\.clone\(\)/);
  assert.match(backend, /"quota_account_switched"/);
  assert.match(backend, /agent\.next_run_at = Some\(now\)/);
});

test("la promotion autonome est transactionnelle et conserve la session", () => {
  assert.match(backend, /prepare_orchestration_promotion/);
  assert.match(backend, /rollback_orchestration_promotion/);
  assert.match(backend, /finalize_orchestration_promotion/);
  assert.match(backend, /La discussion est conservée car elle appartient/);
  assert.match(orchestration, /create_internal\(create_request, true\)/);
  assert.match(orchestration, /autonomous\.finalize_orchestration_promotion\(id\)/);
  assert.match(orchestration, /self\.control\(&created\.id, OrchestrationAction::Resume\)/);
  assert.match(orchestration, /orchestrator_session_id: agent\.session_id\.clone\(\)/);
});

test("le smoke test web :8080 transmet les connecteurs Google au serveur", () => {
  const smoke = readFileSync(new URL("../scripts/smoke-site.mjs", import.meta.url), "utf8");
  assert.match(smoke, /data-autonomous-connector="gmail"/);
  assert.match(smoke, /data-autonomous-connector="google_calendar"/);
  assert.match(smoke, /autonomousPayload\.connectors/);
  assert.match(smoke, /\["gmail", "google_calendar"\]/);
  assert.match(smoke, /\/api\/autonomous-agents\/autonomous-smoke\/orchestration/);
  assert.match(smoke, /\/api\/autonomous-agents\/autonomous-smoke\/account/);
  assert.match(smoke, /autonomousOrchestrationForm/);
  assert.match(smoke, /data-autonomous-orchestration-worker/);
  assert.match(smoke, /autonomousAccountMutation/);
  assert.match(smoke, /promotionMutation\.payload\.workerAccountIds/);
  assert.match(smoke, /workerAccountMutation\.payload\.role !== "worker"/);
  assert.match(smoke, /workerAccountMutation\.payload\.workerIndex !== 1/);
  assert.match(smoke, /directCreateMutation\.payload\.deferFirstRun !== true/);
  assert.match(smoke, /autonomous-direct-orchestrator-launch/);
});

test("le moteur persiste, reprend et se suspend apres les echecs", () => {
  assert.match(backend, /AutonomousAgentStore/);
  assert.match(backend, /pub enum AutonomousTriggerKind/);
  assert.match(backend, /WorkspaceChange/);
  assert.match(backend, /scan_workspace_events/);
  assert.match(backend, /workspace_fingerprint/);
  assert.match(backend, /apply_workspace_fingerprint/);
  assert.match(backend, /put_workspace_agent_to_sleep/);
  assert.match(backend, /AUTORISATION EXPLICITE GIT ET PUBLICATION/);
  assert.match(backend, /fs_util::atomic_write/);
  assert.match(backend, /normalize_loaded_store/);
  assert.match(backend, /Processus interrompu detecte/);
  assert.match(backend, /MAX_CONSECUTIVE_FAILURES: u32 = 3/);
  assert.match(backend, /MODEL_CAPACITY_RETRY_MAX_DELAY_SECONDS: u64 = 60/);
  assert.match(backend, /is_model_capacity_message/);
  assert.match(backend, /"model_capacity_retry"/);
  assert.match(backend, /"model_capacity_recovered"/);
  assert.match(backend, /if model_capacity_error \{/);
  assert.doesNotMatch(backend, /model_capacity_error\s*&&/);
  assert.match(backend, /AutonomousAgentStatus::NeedsAttention/);
  assert.match(backend, /pending_review/);
  assert.match(backend, /require_user_review/);
  assert.match(backend, /approved_review/);
  assert.match(backend, /effective_turn_mode/);
  assert.match(backend, /ChatTurnMode::Plan/);
  assert.match(backend, /GARDE-FOU REVIEW UTILISATEUR ACTIF/);
  assert.match(backend, /AUTONOMOUS_REVIEW:/);
  assert.match(backend, /AUTONOMOUS_REVIEW_EXTERNAL:/);
  assert.match(backend, /ChatAppConnector::Gmail/);
  assert.match(backend, /app_connectors: Some\(agent\.connectors\.clone\(\)\)/);
  assert.match(backend, /Les suppressions restent interdites/);
  assert.match(backend, /AutonomousAgentAction::ApproveReview/);
  assert.match(backend, /AutonomousAgentAction::RejectReview/);
  assert.match(backend, /AUTONOMOUS_STATUS: continue/);
  assert.match(backend, /create_goal/);
  assert.match(backend, /AUTONOMOUS_MEMORY:/);
  assert.match(backend, /AUTONOMOUS_MEMORY_STRATEGY:/);
  assert.match(backend, /AUTONOMOUS_TASK:/);
  assert.match(backend, /AUTONOMOUS_NEXT_TASK:/);
  assert.match(backend, /reconcile_completion_with_work_plan/);
  assert.match(backend, /run_validation_command/);
  assert.match(backend, /MAX_CONSECUTIVE_TEST_FAILURES: u32 = 3/);
  assert.match(backend, /test_completion_pending/);
  assert.match(backend, /pub fn schedule\(/);
  assert.match(backend, /"rescheduled"/);
  assert.match(backend, /MAX_SCHEDULE_AHEAD_SECONDS/);
  assert.match(backend, /interval_seconds: Option<u64>/);
  assert.match(backend, /agent\.interval_seconds = interval_seconds/);
  assert.match(backend, /remove_autonomous_discussion/);
  assert.match(backend, /session_id: None,[\s\S]*memoire et du carnet persistants/);
  assert.match(backend, /CST_AUTONOMOUS_AGENT_SESSION: true/);
});

test("un superviseur systeme est cree et execute un controle horaire", () => {
  assert.match(backend, /SYSTEM_SUPERVISOR_ID: &str = "cst-autonomous-supervisor"/);
  assert.match(backend, /SYSTEM_SUPERVISOR_INTERVAL_SECONDS: u64 = 60 \* 60/);
  assert.match(backend, /fn reconcile_system_supervisor\(/);
  assert.match(backend, /agent_keeps_supervisor_enabled/);
  assert.match(backend, /supervisor_schedule_repaired/);
  assert.match(backend, /render_system_supervisor_context/);
  assert.match(backend, /autonomous_prompt_with_context/);
  assert.match(backend, /Ne modifie jamais le fichier d'etat persistant/);
  assert.match(backend, /ensure_user_managed_agent/);
  assert.match(main, /agent\.systemManaged/);
  assert.match(main, /Géré par le système · toutes les heures/);
  assert.match(main, /Cycle de supervision protégé/);
  assert.match(style, /\.autonomous-system-managed/);
});
