//! Moteur persistant des chats autonomes.
//!
//! Un agent autonome utilise des tours provider ephemeres, pilotes par un
//! ordonnanceur durable. Seuls son etat, sa memoire et son journal sont conserves
//! ici : ses rollouts ne deviennent jamais des discussions utilisateur. L'etat
//! est ecrit atomiquement apres chaque transition afin qu'un `cst-server` relance
//! par systemd puisse reprendre le travail sans dependre d'un onglet navigateur
//! ouvert.

use crate::{
    chat::{
        is_model_capacity_message, is_quota_exhaustion_message, ChatAppConnector, ChatTurnManager,
        ChatTurnMode, ChatTurnSnapshot, ChatTurnStatus, StartChatTurnRequest,
    },
    discussions, fs_util, metrics, settings,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::State;
use uuid::Uuid;

const STORE_VERSION: u32 = 9;
const MIN_INTERVAL_SECONDS: u64 = 60;
const MAX_INTERVAL_SECONDS: u64 = 7 * 24 * 60 * 60;
const MAX_SCHEDULE_AHEAD_SECONDS: i64 = 366 * 24 * 60 * 60;
const DEFAULT_INTERVAL_SECONDS: u64 = 15 * 60;
const MAX_OBJECTIVE_BYTES: usize = 32 * 1024;
const MAX_EVENTS: usize = 40;
const MAX_SUMMARY_CHARS: usize = 2_000;
const MAX_CONSECUTIVE_FAILURES: u32 = 3;
const MAX_RETRY_DELAY_SECONDS: u64 = 6 * 60 * 60;
const MODEL_CAPACITY_RETRY_MAX_DELAY_SECONDS: u64 = 60;
const MAX_AGENT_NAME_CHARS: usize = 120;
const MAX_ROLE_CHARS: usize = 4_000;
const MAX_SOURCE_CHAT_KEY_CHARS: usize = 160;
const MAX_MEMORY_ENTRIES: usize = 64;
const MAX_MEMORY_CHARS: usize = 2_000;
const MAX_MEMORY_STRATEGY_CHARS: usize = 2_000;
const MAX_WORK_ITEMS: usize = 128;
const MAX_WORK_ITEM_ID_CHARS: usize = 80;
const MAX_WORK_ITEM_DOMAIN_CHARS: usize = 160;
const MAX_WORK_ITEM_DESCRIPTION_CHARS: usize = 600;
const MAX_WORK_ITEM_EVIDENCE_CHARS: usize = 1_200;
const MAX_PROMPT_WORK_PLAN_CHARS: usize = 16_000;
const MAX_REVIEW_CHARS: usize = 2_000;
const MAX_PROMPT_MEMORY_CHARS: usize = 12_000;
const MAX_TEST_COMMAND_CHARS: usize = 8_000;
const DEFAULT_TEST_TIMEOUT_SECONDS: u64 = 5 * 60;
const MIN_TEST_TIMEOUT_SECONDS: u64 = 5;
const MAX_TEST_TIMEOUT_SECONDS: u64 = 30 * 60;
const MAX_TEST_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_CONSECUTIVE_TEST_FAILURES: u32 = 3;
const DEFAULT_DEBOUNCE_SECONDS: u64 = 10;
const MIN_DEBOUNCE_SECONDS: u64 = 2;
const MAX_DEBOUNCE_SECONDS: u64 = 10 * 60;
const EVENT_SCAN_INTERVAL_SECONDS: u64 = 2;
const MAX_WATCH_PATHS: usize = 32;
const MAX_WATCH_PATH_CHARS: usize = 240;
const MAX_WATCH_FILES: usize = 25_000;
const SYSTEM_SUPERVISOR_ID: &str = "cst-autonomous-supervisor";
const SYSTEM_SUPERVISOR_INTERVAL_SECONDS: u64 = 60 * 60;
const SYSTEM_SUPERVISOR_NAME: &str = "Superviseur des agents autonomes";
const SYSTEM_SUPERVISOR_OBJECTIVE: &str = "Verifier chaque heure que tous les agents autonomes actives fonctionnent correctement, diagnostiquer leurs erreurs et corriger de maniere sure les bugs logiciels qui les empechent d'avancer.";
const SYSTEM_SUPERVISOR_ROLE: &str = "Tu es le superviseur systeme de la flotte autonome. A chaque cycle, examine l'etat fourni par l'ordonnanceur, selectionne l'incident le plus important, confirme sa cause avec des preuves, applique une correction sure dans le code concerne quand elle est possible, puis execute une validation proportionnee. Ne modifie jamais directement autonomous-agents.json, ne contourne jamais une review humaine et ne reprends jamais un agent mis en pause ou termine volontairement. Si aucun incident n'est confirme, effectue seulement un controle leger et conserve les observations utiles pour le prochain passage.";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousAgentStatus {
    Active,
    Paused,
    Completed,
    NeedsAttention,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousTriggerKind {
    #[default]
    Schedule,
    WorkspaceChange,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousAgentEvent {
    pub timestamp: i64,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousReviewKind {
    Approval,
    Decision,
    Verification,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousReviewRequest {
    pub id: String,
    pub kind: AutonomousReviewKind,
    pub request: String,
    pub created_at: i64,
    #[serde(default)]
    pub external_action: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousMemoryKind {
    User,
    #[default]
    Agent,
    Test,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousMemoryEntry {
    pub id: String,
    pub kind: AutonomousMemoryKind,
    pub content: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousWorkItemStatus {
    #[default]
    Todo,
    InProgress,
    Done,
    Blocked,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousWorkItem {
    pub id: String,
    pub status: AutonomousWorkItemStatus,
    pub domain: String,
    pub description: String,
    #[serde(default)]
    pub evidence: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutonomousTestStatus {
    #[default]
    NotConfigured,
    Idle,
    Running,
    Passed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutonomousAgentSnapshot {
    pub id: String,
    /// Les agents geres par le moteur sont visibles, mais leur configuration et
    /// leur cycle de vie ne peuvent pas etre modifies depuis les API utilisateur.
    #[serde(default)]
    pub system_managed: bool,
    #[serde(default)]
    pub name: String,
    pub objective: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub source_chat_key: Option<String>,
    pub account_id: String,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub mode: ChatTurnMode,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub connectors: Vec<ChatAppConnector>,
    pub interval_seconds: u64,
    #[serde(default)]
    pub trigger_kind: AutonomousTriggerKind,
    #[serde(default)]
    pub watch_paths: Vec<String>,
    #[serde(default = "default_debounce_seconds")]
    pub debounce_seconds: u64,
    #[serde(default)]
    pub allow_git_publish: bool,
    #[serde(default)]
    pub event_fingerprint: Option<String>,
    #[serde(default)]
    pub event_candidate_fingerprint: Option<String>,
    #[serde(default)]
    pub event_candidate_since: Option<i64>,
    #[serde(default)]
    pub last_triggered_at: Option<i64>,
    #[serde(default)]
    pub last_trigger_message: Option<String>,
    #[serde(default)]
    pub trigger_error: Option<String>,
    pub status: AutonomousAgentStatus,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub next_run_at: Option<i64>,
    #[serde(default)]
    pub last_run_started_at: Option<i64>,
    #[serde(default)]
    pub last_run_finished_at: Option<i64>,
    #[serde(default)]
    pub current_turn_id: Option<u64>,
    #[serde(default)]
    pub current_start_id: Option<String>,
    #[serde(default)]
    pub attempt_count: u64,
    #[serde(default)]
    pub run_count: u64,
    #[serde(default)]
    pub consecutive_failures: u32,
    #[serde(default)]
    pub model_capacity_retry_count: u32,
    #[serde(default)]
    pub last_error: Option<String>,
    #[serde(default)]
    pub last_summary: Option<String>,
    #[serde(default)]
    pub require_user_review: bool,
    #[serde(default)]
    pub pending_review: Option<AutonomousReviewRequest>,
    #[serde(default)]
    pub approved_review: Option<AutonomousReviewRequest>,
    #[serde(default)]
    pub memory: Vec<AutonomousMemoryEntry>,
    #[serde(default)]
    pub memory_strategy: Option<String>,
    #[serde(default)]
    pub work_items: Vec<AutonomousWorkItem>,
    #[serde(default)]
    pub next_task_id: Option<String>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default = "default_test_timeout_seconds")]
    pub test_timeout_seconds: u64,
    #[serde(default)]
    pub test_status: AutonomousTestStatus,
    #[serde(default)]
    pub current_test_id: Option<String>,
    #[serde(default)]
    pub test_completion_pending: bool,
    #[serde(default)]
    pub consecutive_test_failures: u32,
    #[serde(default)]
    pub last_test_started_at: Option<i64>,
    #[serde(default)]
    pub last_test_finished_at: Option<i64>,
    #[serde(default)]
    pub last_test_exit_code: Option<i32>,
    #[serde(default)]
    pub last_test_duration_ms: Option<u64>,
    #[serde(default)]
    pub last_test_output: Option<String>,
    #[serde(default)]
    pub events: Vec<AutonomousAgentEvent>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAutonomousAgentRequest {
    #[serde(default)]
    pub name: Option<String>,
    pub objective: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub source_chat_key: Option<String>,
    pub account_id: String,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default)]
    pub mode: ChatTurnMode,
    #[serde(default)]
    pub require_user_review: bool,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub connectors: Vec<ChatAppConnector>,
    #[serde(default)]
    pub interval_seconds: Option<u64>,
    #[serde(default)]
    pub trigger_kind: AutonomousTriggerKind,
    #[serde(default)]
    pub watch_paths: Vec<String>,
    #[serde(default)]
    pub debounce_seconds: Option<u64>,
    #[serde(default)]
    pub allow_git_publish: bool,
    #[serde(default)]
    pub initial_memory: Option<String>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub test_timeout_seconds: Option<u64>,
    /// Crée l'agent sans planifier son premier cycle. Utilisé par le lancement
    /// direct en orchestration afin que la promotion transactionnelle soit la
    /// seule entité à démarrer du travail.
    #[serde(default)]
    pub defer_first_run: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateAutonomousAgentRequest {
    #[serde(default)]
    pub name: Option<String>,
    pub objective: String,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default)]
    pub mode: ChatTurnMode,
    #[serde(default)]
    pub require_user_review: bool,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub connectors: Vec<ChatAppConnector>,
    #[serde(default)]
    pub interval_seconds: Option<u64>,
    #[serde(default)]
    pub trigger_kind: Option<AutonomousTriggerKind>,
    #[serde(default)]
    pub watch_paths: Option<Vec<String>>,
    #[serde(default)]
    pub debounce_seconds: Option<u64>,
    #[serde(default)]
    pub allow_git_publish: Option<bool>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub test_timeout_seconds: Option<u64>,
    /// Reprend immediatement un agent en pause apres l'enregistrement. Une
    /// review en attente ne peut jamais etre contournee par ce raccourci.
    #[serde(default)]
    pub activate: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AutonomousAgentAction {
    Pause,
    Resume,
    RunNow,
    TestNow,
    Complete,
    ApproveReview,
    RejectReview,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlAutonomousAgentRequest {
    pub action: AutonomousAgentAction,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleAutonomousAgentRequest {
    pub next_run_at: i64,
    #[serde(default)]
    pub interval_seconds: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReassignAutonomousAgentAccountRequest {
    pub account_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddAutonomousMemoryRequest {
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AutonomousAgentStore {
    version: u32,
    #[serde(default)]
    agents: Vec<AutonomousAgentSnapshot>,
}

impl Default for AutonomousAgentStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            agents: Vec::new(),
        }
    }
}

#[derive(Clone)]
pub struct AutonomousAgentManager {
    inner: Arc<AutonomousAgentInner>,
}

/// Etat conservé pendant la bascule vers une orchestration. La session n'est
/// jamais supprimée : elle devient celle de l'orchestrateur si la transaction
/// aboutit, ou reste attachée à l'agent autonome en cas de retour arrière.
#[derive(Debug, Clone)]
pub(crate) struct AutonomousPromotionCheckpoint {
    pub snapshot: AutonomousAgentSnapshot,
}

struct AutonomousAgentInner {
    chat: ChatTurnManager,
    storage_path: PathBuf,
    store: Mutex<AutonomousAgentStore>,
    validation_runs: Mutex<HashMap<String, Arc<ValidationRun>>>,
}

struct ValidationRun {
    id: String,
    cancelled: AtomicBool,
}

struct ValidationResult {
    status: AutonomousTestStatus,
    exit_code: Option<i32>,
    duration_ms: u64,
    output: String,
}

#[derive(Default)]
struct SystemSupervisorMaintenance {
    turn_to_stop: Option<u64>,
    discussion_to_delete: Option<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AgentDirective {
    Continue,
    Complete,
    Blocked,
}

#[derive(Default)]
struct WorkPlanUpdate {
    memory_strategy: Option<String>,
    items: Vec<AutonomousWorkItem>,
    next_task_id: Option<String>,
}

fn agent_is_system_supervisor(agent: &AutonomousAgentSnapshot) -> bool {
    agent.system_managed || agent.id == SYSTEM_SUPERVISOR_ID
}

fn agent_keeps_supervisor_enabled(agent: &AutonomousAgentSnapshot) -> bool {
    !agent_is_system_supervisor(agent)
        && matches!(
            agent.status,
            AutonomousAgentStatus::Active | AutonomousAgentStatus::NeedsAttention
        )
}

fn supervisor_source_priority(agent: &AutonomousAgentSnapshot) -> u8 {
    if !agent_keeps_supervisor_enabled(agent) {
        return 0;
    }
    let has_runtime_incident = agent.last_error.is_some()
        || agent.trigger_error.is_some()
        || agent.test_status == AutonomousTestStatus::Failed;
    match (
        agent.status,
        agent.pending_review.is_some(),
        has_runtime_incident,
    ) {
        (AutonomousAgentStatus::NeedsAttention, false, _) => 5,
        (AutonomousAgentStatus::Active, _, true) => 4,
        (AutonomousAgentStatus::NeedsAttention, true, _) => 3,
        (AutonomousAgentStatus::Active, _, false) => 2,
        _ => 0,
    }
}

fn new_system_supervisor(source: &AutonomousAgentSnapshot, now: i64) -> AutonomousAgentSnapshot {
    let mut supervisor = AutonomousAgentSnapshot {
        id: SYSTEM_SUPERVISOR_ID.to_string(),
        system_managed: true,
        name: SYSTEM_SUPERVISOR_NAME.to_string(),
        objective: SYSTEM_SUPERVISOR_OBJECTIVE.to_string(),
        role: Some(SYSTEM_SUPERVISOR_ROLE.to_string()),
        source_chat_key: None,
        account_id: source.account_id.clone(),
        project_dir: source.project_dir.clone(),
        session_id: None,
        mode: ChatTurnMode::Build,
        model: source.model.clone(),
        reasoning_effort: source.reasoning_effort.clone(),
        connectors: Vec::new(),
        interval_seconds: SYSTEM_SUPERVISOR_INTERVAL_SECONDS,
        trigger_kind: AutonomousTriggerKind::Schedule,
        watch_paths: Vec::new(),
        debounce_seconds: DEFAULT_DEBOUNCE_SECONDS,
        allow_git_publish: false,
        event_fingerprint: None,
        event_candidate_fingerprint: None,
        event_candidate_since: None,
        last_triggered_at: None,
        last_trigger_message: None,
        trigger_error: None,
        status: AutonomousAgentStatus::Active,
        created_at: now,
        updated_at: now,
        next_run_at: Some(now),
        last_run_started_at: None,
        last_run_finished_at: None,
        current_turn_id: None,
        current_start_id: None,
        attempt_count: 0,
        run_count: 0,
        consecutive_failures: 0,
        model_capacity_retry_count: 0,
        last_error: None,
        last_summary: None,
        require_user_review: false,
        pending_review: None,
        approved_review: None,
        memory: Vec::new(),
        memory_strategy: None,
        work_items: Vec::new(),
        next_task_id: None,
        test_command: None,
        test_timeout_seconds: DEFAULT_TEST_TIMEOUT_SECONDS,
        test_status: AutonomousTestStatus::NotConfigured,
        current_test_id: None,
        test_completion_pending: false,
        consecutive_test_failures: 0,
        last_test_started_at: None,
        last_test_finished_at: None,
        last_test_exit_code: None,
        last_test_duration_ms: None,
        last_test_output: None,
        events: Vec::new(),
    };
    push_event(
        &mut supervisor,
        now,
        "system_supervisor_created",
        "Superviseur systeme cree automatiquement ; premier controle planifie maintenant"
            .to_string(),
    );
    supervisor
}

/// Maintient l'invariant de flotte : un superviseur systeme existe et reste
/// actif tant qu'au moins un agent utilisateur est actif ou en attention. Il
/// repare aussi les incoherences d'ordonnancement sans contourner les pauses,
/// les fins de mission ou les reviews humaines.
fn reconcile_system_supervisor(
    store: &mut AutonomousAgentStore,
    now: i64,
) -> (bool, SystemSupervisorMaintenance) {
    let mut changed = false;
    let mut maintenance = SystemSupervisorMaintenance::default();

    for agent in store
        .agents
        .iter_mut()
        .filter(|agent| !agent_is_system_supervisor(agent))
    {
        if agent.status == AutonomousAgentStatus::Active && agent.pending_review.is_some() {
            agent.status = AutonomousAgentStatus::NeedsAttention;
            agent.next_run_at = None;
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "supervisor_review_repaired",
                "Etat incoherent repare : la review en attente bloque de nouveau l'execution"
                    .to_string(),
            );
            changed = true;
        } else if agent.status == AutonomousAgentStatus::Active
            && agent.trigger_kind == AutonomousTriggerKind::Schedule
            && agent.current_turn_id.is_none()
            && agent.current_start_id.is_none()
            && agent.current_test_id.is_none()
            && agent.next_run_at.is_none()
        {
            agent.next_run_at = Some(now);
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "supervisor_schedule_repaired",
                "Planification manquante reparee par le superviseur systeme".to_string(),
            );
            changed = true;
        } else if agent.status != AutonomousAgentStatus::Active
            && agent.next_run_at.take().is_some()
        {
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "supervisor_schedule_cleared",
                "Planification obsolete retiree par le superviseur systeme".to_string(),
            );
            changed = true;
        }
    }

    let source = store
        .agents
        .iter()
        .filter(|agent| !agent_is_system_supervisor(agent))
        .max_by_key(|agent| supervisor_source_priority(agent))
        .filter(|agent| supervisor_source_priority(agent) > 0)
        .cloned();
    let supervisor_index = store.agents.iter().position(agent_is_system_supervisor);

    let Some(source) = source else {
        if let Some(index) = supervisor_index {
            let supervisor = &mut store.agents[index];
            if !supervisor.system_managed {
                supervisor.system_managed = true;
                changed = true;
            }
            if supervisor.status != AutonomousAgentStatus::Paused
                || supervisor.next_run_at.is_some()
                || supervisor.current_turn_id.is_some()
                || supervisor.current_start_id.is_some()
            {
                maintenance.turn_to_stop = supervisor.current_turn_id.take();
                maintenance.discussion_to_delete = supervisor
                    .session_id
                    .take()
                    .map(|session_id| (supervisor.account_id.clone(), session_id));
                supervisor.current_start_id = None;
                supervisor.status = AutonomousAgentStatus::Paused;
                supervisor.next_run_at = None;
                supervisor.updated_at = now;
                push_event(
                    supervisor,
                    now,
                    "system_supervisor_standby",
                    "Supervision mise en veille : aucun autre agent autonome n'est active"
                        .to_string(),
                );
                changed = true;
            }
        }
        return (changed, maintenance);
    };

    let Some(index) = supervisor_index else {
        store.agents.push(new_system_supervisor(&source, now));
        return (true, maintenance);
    };

    let supervisor = &mut store.agents[index];
    if !supervisor.system_managed {
        supervisor.system_managed = true;
        changed = true;
    }
    let idle = supervisor.current_turn_id.is_none()
        && supervisor.current_start_id.is_none()
        && supervisor.current_test_id.is_none();
    if idle
        && (supervisor.account_id != source.account_id
            || supervisor.project_dir != source.project_dir
            || supervisor.model != source.model
            || supervisor.reasoning_effort != source.reasoning_effort)
    {
        supervisor.account_id = source.account_id.clone();
        supervisor.project_dir = source.project_dir.clone();
        supervisor.model = source.model.clone();
        supervisor.reasoning_effort = source.reasoning_effort.clone();
        supervisor.session_id = None;
        supervisor.model_capacity_retry_count = 0;
        changed = true;
    }
    if supervisor.name != SYSTEM_SUPERVISOR_NAME
        || supervisor.objective != SYSTEM_SUPERVISOR_OBJECTIVE
        || supervisor.role.as_deref() != Some(SYSTEM_SUPERVISOR_ROLE)
        || supervisor.mode != ChatTurnMode::Build
        || supervisor.require_user_review
        || !supervisor.connectors.is_empty()
        || supervisor.interval_seconds != SYSTEM_SUPERVISOR_INTERVAL_SECONDS
        || supervisor.trigger_kind != AutonomousTriggerKind::Schedule
        || !supervisor.watch_paths.is_empty()
        || supervisor.allow_git_publish
    {
        supervisor.name = SYSTEM_SUPERVISOR_NAME.to_string();
        supervisor.objective = SYSTEM_SUPERVISOR_OBJECTIVE.to_string();
        supervisor.role = Some(SYSTEM_SUPERVISOR_ROLE.to_string());
        supervisor.mode = ChatTurnMode::Build;
        supervisor.require_user_review = false;
        supervisor.connectors.clear();
        supervisor.interval_seconds = SYSTEM_SUPERVISOR_INTERVAL_SECONDS;
        supervisor.trigger_kind = AutonomousTriggerKind::Schedule;
        supervisor.watch_paths.clear();
        supervisor.allow_git_publish = false;
        changed = true;
    }
    if supervisor.pending_review.take().is_some() || supervisor.approved_review.take().is_some() {
        changed = true;
    }
    if supervisor.status != AutonomousAgentStatus::Active {
        let resume_immediately = supervisor.status == AutonomousAgentStatus::Paused;
        supervisor.status = AutonomousAgentStatus::Active;
        supervisor.next_run_at = Some(if resume_immediately {
            now
        } else {
            now.saturating_add(SYSTEM_SUPERVISOR_INTERVAL_SECONDS as i64)
        });
        supervisor.consecutive_failures = 0;
        supervisor.model_capacity_retry_count = 0;
        supervisor.last_error = None;
        push_event(
            supervisor,
            now,
            "system_supervisor_resumed",
            if resume_immediately {
                "Supervision reactivee ; controle immediat planifie".to_string()
            } else {
                "Supervision retablie ; prochain controle conserve au rythme horaire".to_string()
            },
        );
        changed = true;
    } else if idle && supervisor.next_run_at.is_none() {
        supervisor.next_run_at = Some(now);
        changed = true;
    }
    if changed {
        supervisor.updated_at = now;
    }
    (changed, maintenance)
}

impl AutonomousAgentManager {
    pub fn new(chat: ChatTurnManager, storage_path: PathBuf) -> Result<Self, String> {
        let mut store = load_store(&storage_path)?;
        let stale_discussions = store
            .agents
            .iter()
            .filter_map(|agent| {
                agent
                    .session_id
                    .clone()
                    .map(|session_id| (agent.account_id.clone(), session_id))
            })
            .collect::<Vec<_>>();
        let now = metrics::now_ts();
        let recovered = normalize_loaded_store(&mut store, now);
        let (supervisor_changed, _) = reconcile_system_supervisor(&mut store, now);
        if recovered || supervisor_changed {
            persist_store(&storage_path, &store)?;
        }

        let inner = Arc::new(AutonomousAgentInner {
            chat,
            storage_path,
            store: Mutex::new(store),
            validation_runs: Mutex::new(HashMap::new()),
        });
        spawn_worker(Arc::downgrade(&inner));
        for (account_id, session_id) in stale_discussions {
            remove_autonomous_discussion(account_id, session_id);
        }
        Ok(Self { inner })
    }

    pub fn list(&self) -> Result<Vec<AutonomousAgentSnapshot>, String> {
        let mut agents = self
            .inner
            .store
            .lock()
            .map_err(|_| "Etat des agents autonomes verrouille".to_string())?
            .agents
            .clone();
        agents.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        Ok(agents)
    }

    /// Met l'agent au repos sans effacer sa conversation. Cette variante est
    /// volontairement distincte de `control(Pause)`, qui nettoie la discussion
    /// éphémère d'un cycle autonome une fois celui-ci interrompu.
    pub(crate) fn prepare_orchestration_promotion(
        &self,
        id: &str,
    ) -> Result<AutonomousPromotionCheckpoint, String> {
        let now = metrics::now_ts();
        let mut turn_to_stop = None;
        let mut validation_to_cancel = false;
        let checkpoint = self.inner.mutate_store(|store| {
            let agent = find_agent_mut(store, id)?;
            ensure_user_managed_agent(agent)?;
            let checkpoint = AutonomousPromotionCheckpoint {
                snapshot: agent.clone(),
            };
            turn_to_stop = agent.current_turn_id.take();
            agent.current_start_id = None;
            validation_to_cancel = cancel_validation_state(agent, now);
            agent.status = AutonomousAgentStatus::Paused;
            agent.next_run_at = None;
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "promotion_started",
                "Agent mis en pause avant sa promotion en orchestrateur".to_string(),
            );
            Ok(checkpoint)
        })?;

        if validation_to_cancel {
            self.inner.cancel_validation(id);
        }
        if let Some(turn_id) = turn_to_stop {
            if let Err(error) = self.inner.chat.stop(turn_id) {
                // Un tour déjà finalisé peut avoir disparu du registre entre la
                // capture et l'arrêt. Toute autre erreur laisse l'agent en pause
                // afin de ne jamais lancer deux moteurs sur la même session.
                if !error.contains("introuvable") {
                    return Err(format!(
                        "Agent sécurisé en pause, mais son travail courant n'a pas pu être arrêté : {error}"
                    ));
                }
            }
        }
        Ok(checkpoint)
    }

    /// Annule une promotion avant la suppression de l'agent autonome. Un tour
    /// interrompu n'est jamais réutilisé ; un agent auparavant actif repart sur
    /// un nouveau cycle avec la même session et le même contexte.
    pub(crate) fn rollback_orchestration_promotion(
        &self,
        checkpoint: &AutonomousPromotionCheckpoint,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let now = metrics::now_ts();
        self.inner.mutate_store(|store| {
            let current = find_agent_mut(store, &checkpoint.snapshot.id)?;
            let mut restored = checkpoint.snapshot.clone();
            restored.current_turn_id = None;
            restored.current_start_id = None;
            restored.current_test_id = None;
            if restored.status == AutonomousAgentStatus::Active {
                restored.next_run_at = Some(now);
            }
            restored.updated_at = now;
            push_event(
                &mut restored,
                now,
                "promotion_cancelled",
                "Promotion annulée ; l'agent autonome reprend son état précédent".to_string(),
            );
            *current = restored.clone();
            Ok(restored)
        })
    }

    /// Retire uniquement l'enveloppe autonome après création réussie de
    /// l'orchestration. La discussion est conservée car elle appartient
    /// désormais à l'orchestrateur.
    pub(crate) fn finalize_orchestration_promotion(&self, id: &str) -> Result<(), String> {
        self.inner.mutate_store(|store| {
            let index = store
                .agents
                .iter()
                .position(|agent| agent.id == id)
                .ok_or_else(|| "Agent autonome introuvable".to_string())?;
            let agent = &store.agents[index];
            ensure_user_managed_agent(agent)?;
            if agent.status != AutonomousAgentStatus::Paused
                || agent.current_turn_id.is_some()
                || agent.current_start_id.is_some()
                || agent.current_test_id.is_some()
            {
                return Err(
                    "L'agent autonome n'est pas complètement arrêté pour sa promotion".to_string(),
                );
            }
            store.agents.remove(index);
            Ok(())
        })
    }

    pub fn create(
        &self,
        request: CreateAutonomousAgentRequest,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let objective = validate_objective(&request.objective)?;
        let name = validate_agent_name(request.name.as_deref(), &objective)?;
        let role = validate_optional_text(request.role, MAX_ROLE_CHARS, "Le role de l'agent")?;
        let source_chat_key = validate_optional_text(
            request.source_chat_key,
            MAX_SOURCE_CHAT_KEY_CHARS,
            "L'identifiant du chat source",
        )?;
        let account_id = request.account_id.trim().to_string();
        if account_id.is_empty() {
            return Err("Compte obligatoire pour un agent autonome".to_string());
        }
        let app_settings = settings::load_settings_for_terminal()?;
        let account = app_settings
            .accounts
            .iter()
            .find(|candidate| candidate.id == account_id)
            .ok_or_else(|| "Compte introuvable".to_string())?;
        if !settings::account_has_auth_tokens(account) {
            return Err(format!(
                "Compte non authentifie : {}. Connecte ce compte avant de creer l'agent autonome.",
                account.label
            ));
        }
        let connectors = normalize_connectors(request.connectors);
        if !connectors.is_empty() && account.provider != settings::Provider::Codex {
            return Err(
                "Les connecteurs Gmail et Google Agenda necessitent un compte Codex".to_string(),
            );
        }

        let interval_seconds =
            validate_interval(request.interval_seconds.unwrap_or(DEFAULT_INTERVAL_SECONDS))?;
        let trigger_kind = request.trigger_kind;
        let watch_paths = validate_watch_paths(request.watch_paths, trigger_kind)?;
        let debounce_seconds = validate_debounce_seconds(
            request.debounce_seconds.unwrap_or(DEFAULT_DEBOUNCE_SECONDS),
        )?;
        let project_dir = normalize_optional(request.project_dir);
        let test_command = validate_optional_text(
            request.test_command,
            MAX_TEST_COMMAND_CHARS,
            "La commande de test",
        )?;
        if (test_command.is_some()
            || trigger_kind == AutonomousTriggerKind::WorkspaceChange
            || request.allow_git_publish)
            && project_dir.is_none()
        {
            return Err(
                "Un dossier projet est obligatoire pour les tests, la veille ou la publication"
                    .to_string(),
            );
        }
        if let Some(path) = project_dir.as_deref() {
            let path = Path::new(path);
            if (test_command.is_some()
                || trigger_kind == AutonomousTriggerKind::WorkspaceChange
                || request.allow_git_publish)
                && !path.is_dir()
            {
                return Err(format!(
                    "Le dossier projet n'existe pas ou n'est pas un dossier : {}",
                    path.display()
                ));
            }
        }
        if request.defer_first_run && trigger_kind != AutonomousTriggerKind::Schedule {
            return Err(
                "Le lancement direct en orchestration accepte uniquement un agent planifie"
                    .to_string(),
            );
        }
        let event_fingerprint = if trigger_kind == AutonomousTriggerKind::WorkspaceChange {
            Some(workspace_fingerprint(
                Path::new(project_dir.as_deref().expect("project_dir valide")),
                &watch_paths,
            )?)
        } else {
            None
        };
        if request.allow_git_publish {
            validate_git_publication_baseline(Path::new(
                project_dir.as_deref().expect("project_dir valide"),
            ))?;
        }
        let test_timeout_seconds = validate_test_timeout(
            request
                .test_timeout_seconds
                .unwrap_or(DEFAULT_TEST_TIMEOUT_SECONDS),
        )?;
        let now = metrics::now_ts();
        let mut memory = Vec::new();
        if let Some(content) = validate_optional_text(
            request.initial_memory,
            MAX_MEMORY_CHARS,
            "La memoire initiale",
        )? {
            memory.push(new_memory_entry(AutonomousMemoryKind::User, content, now));
        }
        let defer_first_run = request.defer_first_run;
        let mut agent = AutonomousAgentSnapshot {
            id: Uuid::new_v4().to_string(),
            system_managed: false,
            name,
            objective,
            role,
            source_chat_key,
            account_id,
            project_dir,
            session_id: None,
            mode: request.mode,
            model: normalize_optional(request.model),
            reasoning_effort: normalize_optional(request.reasoning_effort),
            connectors,
            interval_seconds,
            trigger_kind,
            watch_paths,
            debounce_seconds,
            allow_git_publish: request.allow_git_publish,
            event_fingerprint,
            event_candidate_fingerprint: None,
            event_candidate_since: None,
            last_triggered_at: None,
            last_trigger_message: None,
            trigger_error: None,
            status: if defer_first_run {
                AutonomousAgentStatus::Paused
            } else {
                AutonomousAgentStatus::Active
            },
            created_at: now,
            updated_at: now,
            next_run_at: if defer_first_run
                || trigger_kind == AutonomousTriggerKind::WorkspaceChange
            {
                None
            } else {
                Some(now)
            },
            last_run_started_at: None,
            last_run_finished_at: None,
            current_turn_id: None,
            current_start_id: None,
            attempt_count: 0,
            run_count: 0,
            consecutive_failures: 0,
            model_capacity_retry_count: 0,
            last_error: None,
            last_summary: None,
            require_user_review: request.require_user_review,
            pending_review: None,
            approved_review: None,
            memory,
            memory_strategy: None,
            work_items: Vec::new(),
            next_task_id: None,
            test_command: test_command.clone(),
            test_timeout_seconds,
            test_status: if test_command.is_some() {
                AutonomousTestStatus::Idle
            } else {
                AutonomousTestStatus::NotConfigured
            },
            current_test_id: None,
            test_completion_pending: false,
            consecutive_test_failures: 0,
            last_test_started_at: None,
            last_test_finished_at: None,
            last_test_exit_code: None,
            last_test_duration_ms: None,
            last_test_output: None,
            events: Vec::new(),
        };
        push_event(
            &mut agent,
            now,
            if defer_first_run {
                "created_deferred"
            } else if trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                "created_sleeping"
            } else {
                "created"
            },
            if defer_first_run {
                "Agent préparé en pause pour son lancement en orchestration".to_string()
            } else if trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                "Agent evenementiel arme ; il dort jusqu'a une modification stable du projet"
                    .to_string()
            } else {
                "Agent autonome cree et planifie immediatement".to_string()
            },
        );
        let created = agent.clone();
        self.inner.mutate_store(|store| {
            store.agents.push(agent);
            Ok(created)
        })
    }

    /// Met a jour la definition durable d'un agent entre deux cycles. Un tour
    /// ou un test deja demarre doit d'abord etre arrete : cela garantit qu'une
    /// meme fiche ne decrit jamais deux configurations concurrentes.
    pub fn update(
        &self,
        id: &str,
        request: UpdateAutonomousAgentRequest,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let previous = self
            .list()?
            .into_iter()
            .find(|agent| agent.id == id)
            .ok_or_else(|| "Agent autonome introuvable".to_string())?;
        ensure_user_managed_agent(&previous)?;
        let objective = validate_objective(&request.objective)?;
        let name = validate_agent_name(request.name.as_deref(), &objective)?;
        let role = validate_optional_text(request.role, MAX_ROLE_CHARS, "Le role de l'agent")?;
        let account_id = request
            .account_id
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(&previous.account_id)
            .to_string();
        let project_dir = normalize_optional(request.project_dir);
        let model = normalize_optional(request.model);
        let reasoning_effort = normalize_optional(request.reasoning_effort);
        let connectors = normalize_connectors(request.connectors);
        let interval_seconds = validate_interval(
            request
                .interval_seconds
                .unwrap_or(previous.interval_seconds),
        )?;
        let trigger_kind = request.trigger_kind.unwrap_or(previous.trigger_kind);
        let watch_paths = validate_watch_paths(
            request
                .watch_paths
                .unwrap_or_else(|| previous.watch_paths.clone()),
            trigger_kind,
        )?;
        let debounce_seconds = validate_debounce_seconds(
            request
                .debounce_seconds
                .unwrap_or(previous.debounce_seconds),
        )?;
        let allow_git_publish = request
            .allow_git_publish
            .unwrap_or(previous.allow_git_publish);
        let test_command = validate_optional_text(
            request.test_command,
            MAX_TEST_COMMAND_CHARS,
            "La commande de test",
        )?;
        if (test_command.is_some()
            || trigger_kind == AutonomousTriggerKind::WorkspaceChange
            || allow_git_publish)
            && project_dir.is_none()
        {
            return Err(
                "Un dossier projet est obligatoire pour les tests, la veille ou la publication"
                    .to_string(),
            );
        }
        if let Some(path) = project_dir.as_deref() {
            let path = Path::new(path);
            if (test_command.is_some()
                || trigger_kind == AutonomousTriggerKind::WorkspaceChange
                || allow_git_publish)
                && !path.is_dir()
            {
                return Err(format!(
                    "Le dossier projet n'existe pas ou n'est pas un dossier : {}",
                    path.display()
                ));
            }
        }
        let trigger_changed = previous.trigger_kind != trigger_kind
            || previous.project_dir != project_dir
            || previous.watch_paths != watch_paths;
        let reset_event_fingerprint =
            if trigger_kind == AutonomousTriggerKind::WorkspaceChange && trigger_changed {
                Some(workspace_fingerprint(
                    Path::new(project_dir.as_deref().expect("project_dir valide")),
                    &watch_paths,
                )?)
            } else {
                None
            };
        if allow_git_publish && (!previous.allow_git_publish || trigger_changed) {
            validate_git_publication_baseline(Path::new(
                project_dir.as_deref().expect("project_dir valide"),
            ))?;
        }
        let test_timeout_seconds = validate_test_timeout(
            request
                .test_timeout_seconds
                .unwrap_or(previous.test_timeout_seconds),
        )?;

        let app_settings = settings::load_settings_for_terminal()?;
        let account = app_settings
            .accounts
            .iter()
            .find(|candidate| candidate.id == account_id)
            .ok_or_else(|| "Compte introuvable".to_string())?;
        if !settings::account_has_auth_tokens(account) {
            return Err(format!(
                "Compte non authentifie : {}. Connecte ce compte avant de modifier l'agent autonome.",
                account.label
            ));
        }
        if !connectors.is_empty() && account.provider != settings::Provider::Codex {
            return Err(
                "Les connecteurs Gmail et Google Agenda necessitent un compte Codex".to_string(),
            );
        }

        let now = metrics::now_ts();
        let source_account_id = previous.account_id.clone();
        let mut discussion_to_delete = None;
        let updated = self.inner.mutate_store(|store| {
            let agent = find_agent_mut(store, id)?;
            if agent.account_id != source_account_id {
                return Err(
                    "Le compte de l'agent a change pendant la modification ; actualise la vue"
                        .to_string(),
                );
            }
            if agent.current_turn_id.is_some()
                || agent.current_start_id.is_some()
                || agent.current_test_id.is_some()
            {
                return Err(
                    "Mets l'agent en pause et attends l'arret du cycle courant avant de modifier sa configuration"
                        .to_string(),
                );
            }

            let objective_changed = agent.objective != objective;
            let account_changed = agent.account_id != account_id;
            let execution_changed = objective_changed
                || account_changed
                || agent.role != role
                || agent.project_dir != project_dir
                || agent.mode != request.mode
                || agent.model != model
                || agent.reasoning_effort != reasoning_effort
                || agent.connectors != connectors
                || agent.trigger_kind != trigger_kind
                || agent.watch_paths != watch_paths
                || agent.debounce_seconds != debounce_seconds
                || agent.allow_git_publish != allow_git_publish;
            let validation_changed = agent.project_dir != project_dir
                || agent.test_command != test_command
                || agent.test_timeout_seconds != test_timeout_seconds;

            agent.name = name;
            agent.objective = objective;
            agent.role = role;
            if account_changed {
                discussion_to_delete = agent
                    .session_id
                    .take()
                    .map(|session_id| (source_account_id.clone(), session_id));
                agent.account_id = account_id.clone();
                agent.model_capacity_retry_count = 0;
            }
            agent.project_dir = project_dir;
            agent.mode = request.mode;
            agent.require_user_review = request.require_user_review;
            agent.model = model;
            agent.reasoning_effort = reasoning_effort;
            agent.connectors = connectors;
            agent.interval_seconds = interval_seconds;
            agent.trigger_kind = trigger_kind;
            agent.watch_paths = watch_paths;
            agent.debounce_seconds = debounce_seconds;
            agent.allow_git_publish = allow_git_publish;
            if trigger_changed {
                agent.event_fingerprint = reset_event_fingerprint;
                agent.event_candidate_fingerprint = None;
                agent.event_candidate_since = None;
                agent.trigger_error = None;
                agent.last_trigger_message = None;
            }
            agent.test_command = test_command.clone();
            agent.test_timeout_seconds = test_timeout_seconds;

            if objective_changed {
                agent.memory_strategy = None;
                agent.work_items.clear();
                agent.next_task_id = None;
                agent.pending_review = None;
                agent.approved_review = None;
                agent.last_summary = None;
                agent.last_error = None;
                agent.consecutive_failures = 0;
                agent.model_capacity_retry_count = 0;
                if matches!(
                    agent.status,
                    AutonomousAgentStatus::Completed | AutonomousAgentStatus::NeedsAttention
                ) {
                    agent.status = AutonomousAgentStatus::Paused;
                    agent.next_run_at = None;
                }
            }

            if validation_changed {
                agent.test_status = if test_command.is_some() {
                    AutonomousTestStatus::Idle
                } else {
                    AutonomousTestStatus::NotConfigured
                };
                agent.test_completion_pending = false;
                agent.consecutive_test_failures = 0;
                agent.last_test_started_at = None;
                agent.last_test_finished_at = None;
                agent.last_test_exit_code = None;
                agent.last_test_duration_ms = None;
                agent.last_test_output = None;
            }

            if request.activate {
                if agent.pending_review.is_some() {
                    return Err(
                        "Examine puis autorise ou refuse la review en attente avant de reprendre l'agent"
                            .to_string(),
                    );
                }
                if agent.status == AutonomousAgentStatus::Completed && !objective_changed {
                    return Err(
                        "Modifie l'objectif avant de relancer un agent deja termine".to_string(),
                    );
                }
                agent.status = AutonomousAgentStatus::Active;
                agent.next_run_at = next_run_after_activation(agent, now);
                agent.last_error = None;
                agent.consecutive_failures = 0;
                agent.model_capacity_retry_count = 0;
            } else if agent.status == AutonomousAgentStatus::Active {
                if agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                    agent.next_run_at = None;
                } else if execution_changed {
                    agent.next_run_at = Some(now);
                } else {
                    let next_for_interval = now.saturating_add(interval_seconds as i64);
                    agent.next_run_at = Some(
                        agent
                            .next_run_at
                            .map(|scheduled| scheduled.min(next_for_interval))
                            .unwrap_or(next_for_interval),
                    );
                }
            }

            agent.updated_at = now;
            push_event(
                agent,
                now,
                "updated",
                if objective_changed {
                    "Objectif et configuration de l'agent mis a jour".to_string()
                } else {
                    "Configuration de l'agent mise a jour".to_string()
                },
            );
            Ok(agent.clone())
        })?;
        if let Some((account_id, session_id)) = discussion_to_delete {
            remove_autonomous_discussion(account_id, session_id);
        }
        Ok(updated)
    }

    /// Change le compte qui exécutera les prochains cycles. Les agents
    /// autonomes gardent leur continuité dans la mémoire et le carnet
    /// persistants : si un tour est actif, il est arrêté avant la réaffectation
    /// afin que deux comptes ne pilotent jamais le même agent en parallèle.
    pub fn reassign_account(
        &self,
        id: &str,
        request: ReassignAutonomousAgentAccountRequest,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let target_account_id = request.account_id.trim().to_string();
        if target_account_id.is_empty() {
            return Err("Compte cible obligatoire".to_string());
        }
        let app_settings = settings::load_settings_for_terminal()?;
        let target = app_settings
            .accounts
            .iter()
            .find(|account| account.id == target_account_id)
            .ok_or_else(|| "Compte cible introuvable".to_string())?;
        if !settings::account_has_auth_tokens(target) {
            return Err(format!(
                "Compte non authentifie : {}. Connecte ce compte avant de lui affecter l'agent autonome.",
                target.label
            ));
        }
        let target_label = target.label.clone();
        let target_provider = target.provider;
        let target_model = target.model.clone();
        let target_reasoning_effort = if target_provider == settings::Provider::Codex {
            target.reasoning_effort.clone()
        } else {
            None
        };
        let agent = self
            .list()?
            .into_iter()
            .find(|agent| agent.id == id)
            .ok_or_else(|| "Agent autonome introuvable".to_string())?;
        ensure_user_managed_agent(&agent)?;
        if agent.account_id == target_account_id {
            return Ok(agent);
        }
        if !agent.connectors.is_empty() && target_provider != settings::Provider::Codex {
            return Err(
                "Retire d'abord les connecteurs Gmail et Google Agenda : ils nécessitent un compte Codex"
                    .to_string(),
            );
        }
        if agent.current_start_id.is_some() {
            return Err("L'agent initialise un tour. Réessaie dans quelques secondes.".to_string());
        }

        let source_account_id = agent.account_id.clone();
        let mut discussion_to_delete = None;
        if let Some(turn_id) = agent.current_turn_id {
            let now = metrics::now_ts();
            self.inner.mutate_store(|store| {
                let current = find_agent_mut(store, id)?;
                if current.account_id != source_account_id
                    || current.current_turn_id != Some(turn_id)
                {
                    return Err(
                        "Le tour ou le compte a changé pendant la réaffectation ; actualise la vue"
                            .to_string(),
                    );
                }
                current.current_turn_id = None;
                current.current_start_id = None;
                current.next_run_at = None;
                discussion_to_delete = current
                    .session_id
                    .take()
                    .map(|session_id| (source_account_id.clone(), session_id));
                current.updated_at = now;
                push_event(
                    current,
                    now,
                    "account_handoff_stopping",
                    "Tour actif arrêté avant le changement de compte".to_string(),
                );
                Ok(())
            })?;
            match self.inner.chat.stop(turn_id) {
                Ok(stopped) => {
                    if discussion_to_delete.is_none() {
                        discussion_to_delete = stopped
                            .session_id
                            .map(|session_id| (stopped.account_id, session_id));
                    }
                }
                Err(error) if error.contains("introuvable") => {}
                Err(error) => {
                    let now = metrics::now_ts();
                    let _ = self.inner.mutate_store(|store| {
                        let current = find_agent_mut(store, id)?;
                        current.status = AutonomousAgentStatus::NeedsAttention;
                        current.next_run_at = None;
                        current.last_error = Some(format!(
                            "Changement de compte interrompu pendant l'arrêt du tour : {error}"
                        ));
                        current.updated_at = now;
                        push_event(
                            current,
                            now,
                            "account_handoff_failed",
                            "Réaffectation suspendue pour éviter une double exécution".to_string(),
                        );
                        Ok(())
                    });
                    return Err(error);
                }
            }
        }

        let now = metrics::now_ts();
        let updated = self.inner.mutate_store(|store| {
            let current = find_agent_mut(store, id)?;
            if current.account_id != source_account_id {
                return Err("Le compte de l'agent a déjà changé ; actualise la vue".to_string());
            }
            if current.current_turn_id.is_some() || current.current_start_id.is_some() {
                return Err(
                    "Un nouveau tour a démarré pendant la réaffectation ; réessaie".to_string(),
                );
            }
            if discussion_to_delete.is_none() {
                discussion_to_delete = current
                    .session_id
                    .take()
                    .map(|session_id| (source_account_id.clone(), session_id));
            }
            current.account_id = target_account_id.clone();
            current.model = target_model.clone();
            current.reasoning_effort = target_reasoning_effort.clone();
            current.model_capacity_retry_count = 0;
            if current.status == AutonomousAgentStatus::Active {
                current.next_run_at = next_run_after_activation(current, now);
            }
            current.updated_at = now;
            push_event(
                current,
                now,
                "account_reassigned",
                format!("Agent autonome réaffecté au compte {target_label}"),
            );
            Ok(current.clone())
        })?;
        if let Some((account_id, session_id)) = discussion_to_delete {
            remove_autonomous_discussion(account_id, session_id);
        }
        Ok(updated)
    }

    pub fn control(
        &self,
        id: &str,
        action: AutonomousAgentAction,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let now = metrics::now_ts();
        let mut turn_to_stop = None;
        let mut validation_to_cancel = false;
        let mut validation_to_start = None;
        let mut discussion_to_delete = None;
        let snapshot = self.inner.mutate_store(|store| {
            let agent = find_agent_mut(store, id)?;
            ensure_user_managed_agent(agent)?;
            match action {
                AutonomousAgentAction::Pause => {
                    if agent.status == AutonomousAgentStatus::Completed {
                        return Err("Un agent termine ne peut pas etre mis en pause".to_string());
                    }
                    turn_to_stop = agent.current_turn_id.take();
                    agent.current_start_id = None;
                    validation_to_cancel = cancel_validation_state(agent, now);
                    agent.status = AutonomousAgentStatus::Paused;
                    agent.next_run_at = None;
                    push_event(agent, now, "paused", "Agent mis en pause".to_string());
                }
                AutonomousAgentAction::Resume => {
                    if agent.status == AutonomousAgentStatus::Completed {
                        return Err("Un agent termine ne peut pas etre repris".to_string());
                    }
                    if agent.pending_review.is_some() {
                        return Err(
                            "Examine puis autorise ou refuse la demande de l'agent avant de le reprendre"
                                .to_string(),
                        );
                    }
                    agent.status = AutonomousAgentStatus::Active;
                    agent.next_run_at = Some(now);
                    agent.consecutive_failures = 0;
                    agent.model_capacity_retry_count = 0;
                    agent.last_error = None;
                    push_event(
                        agent,
                        now,
                        "resumed",
                        "Agent repris et replanifie immediatement".to_string(),
                    );
                }
                AutonomousAgentAction::RunNow => {
                    if agent.status != AutonomousAgentStatus::Active {
                        return Err("Reprends d'abord l'agent avant de le relancer".to_string());
                    }
                    if agent.current_turn_id.is_some()
                        || agent.current_start_id.is_some()
                        || agent.current_test_id.is_some()
                    {
                        return Err("Cet agent travaille deja".to_string());
                    }
                    agent.next_run_at = Some(now);
                    if agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                        agent.last_trigger_message =
                            Some("Execution manuelle demandee pendant la veille".to_string());
                    }
                    push_event(
                        agent,
                        now,
                        "scheduled",
                        "Execution demandee maintenant".to_string(),
                    );
                }
                AutonomousAgentAction::TestNow => {
                    if agent.status != AutonomousAgentStatus::Active {
                        return Err(
                            "Reprends d'abord l'agent avant de lancer ses tests".to_string()
                        );
                    }
                    if agent.current_turn_id.is_some()
                        || agent.current_start_id.is_some()
                        || agent.current_test_id.is_some()
                    {
                        return Err("Cet agent travaille deja".to_string());
                    }
                    let test_id = prepare_validation(agent, now, false)?;
                    validation_to_start = Some(test_id);
                    push_event(
                        agent,
                        now,
                        "test_started",
                        "Validation manuelle demarree".to_string(),
                    );
                }
                AutonomousAgentAction::Complete => {
                    turn_to_stop = agent.current_turn_id.take();
                    agent.current_start_id = None;
                    validation_to_cancel = cancel_validation_state(agent, now);
                    agent.status = AutonomousAgentStatus::Completed;
                    agent.next_run_at = None;
                    agent.model_capacity_retry_count = 0;
                    agent.pending_review = None;
                    agent.approved_review = None;
                    push_event(
                        agent,
                        now,
                        "completed",
                        "Objectif marque comme termine par l'utilisateur".to_string(),
                    );
                }
                AutonomousAgentAction::ApproveReview
                | AutonomousAgentAction::RejectReview => {
                    if agent.status != AutonomousAgentStatus::NeedsAttention {
                        return Err("Cet agent n'attend aucune verification humaine".to_string());
                    }
                    let review = agent.pending_review.take().ok_or_else(|| {
                        "Aucune demande structuree n'est disponible pour cet agent".to_string()
                    })?;
                    let approved = action == AutonomousAgentAction::ApproveReview;
                    agent.approved_review = if approved {
                        Some(review.clone())
                    } else {
                        None
                    };
                    let decision = if approved { "approuvee" } else { "refusee" };
                    let guidance = if approved {
                        format!(
                            "Demande {decision} par l'utilisateur : {}",
                            review.request
                        )
                    } else {
                        format!(
                            "Demande {decision} par l'utilisateur : {}. Chercher une alternative sure sans effectuer cette action.",
                            review.request
                        )
                    };
                    push_memory(agent, AutonomousMemoryKind::User, guidance, now);
                    agent.status = AutonomousAgentStatus::Active;
                    agent.next_run_at = Some(now);
                    agent.consecutive_failures = 0;
                    agent.model_capacity_retry_count = 0;
                    agent.last_error = None;
                    push_event(
                        agent,
                        now,
                        if approved {
                            "review_approved"
                        } else {
                            "review_rejected"
                        },
                        if approved {
                            "Demande autorisee ; reprise immediate de l'agent".to_string()
                        } else {
                            "Demande refusee ; recherche d'une alternative sure".to_string()
                        },
                    );
                }
            }
            discussion_to_delete = agent
                .session_id
                .take()
                .map(|session_id| (agent.account_id.clone(), session_id));
            agent.updated_at = now;
            Ok(agent.clone())
        })?;

        if let Some(turn_id) = turn_to_stop {
            if let Ok(stopped) = self.inner.chat.stop(turn_id) {
                if discussion_to_delete.is_none() {
                    discussion_to_delete = stopped
                        .session_id
                        .map(|session_id| (stopped.account_id, session_id));
                }
            }
        }
        if validation_to_cancel {
            self.inner.cancel_validation(id);
        }
        if let Some(test_id) = validation_to_start {
            launch_validation(&self.inner, snapshot.clone(), test_id);
        }
        if let Some((account_id, session_id)) = discussion_to_delete {
            remove_autonomous_discussion(account_id, session_id);
        }
        Ok(snapshot)
    }

    pub fn add_memory(&self, id: &str, content: &str) -> Result<AutonomousAgentSnapshot, String> {
        let content = validate_memory(content)?;
        let now = metrics::now_ts();
        self.inner.mutate_store(|store| {
            let agent = find_agent_mut(store, id)?;
            ensure_user_managed_agent(agent)?;
            if !push_memory(agent, AutonomousMemoryKind::User, content, now) {
                return Err("Cette memoire est deja presente".to_string());
            }
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "memory_added",
                "Memoire durable ajoutee par l'utilisateur".to_string(),
            );
            Ok(agent.clone())
        })
    }

    pub fn schedule(
        &self,
        id: &str,
        next_run_at: i64,
        interval_seconds: Option<u64>,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let now = metrics::now_ts();
        if next_run_at < now.saturating_sub(60) {
            return Err("La prochaine execution doit etre planifiee dans le futur".to_string());
        }
        if next_run_at > now.saturating_add(MAX_SCHEDULE_AHEAD_SECONDS) {
            return Err("La prochaine execution ne peut pas depasser un an".to_string());
        }
        let interval_seconds = interval_seconds.map(validate_interval).transpose()?;
        let scheduled_at = next_run_at.max(now);
        self.inner.mutate_store(|store| {
            let agent = find_agent_mut(store, id)?;
            ensure_user_managed_agent(agent)?;
            if agent.status != AutonomousAgentStatus::Active {
                return Err("Seul un agent actif peut etre replanifie".to_string());
            }
            if agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                return Err(
                    "Un agent evenementiel se rearme avec son declencheur ; utilise Executer maintenant pour un lancement manuel"
                        .to_string(),
                );
            }
            if agent.current_turn_id.is_some()
                || agent.current_start_id.is_some()
                || agent.current_test_id.is_some()
            {
                return Err("Attends la fin du travail en cours avant de replanifier".to_string());
            }
            if let Some(interval_seconds) = interval_seconds {
                agent.interval_seconds = interval_seconds;
            }
            agent.next_run_at = Some(scheduled_at);
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "rescheduled",
                interval_seconds
                    .map(|value| {
                        format!(
                            "Frequence modifiee par l'utilisateur : toutes les {value} secondes ; prochaine execution replanifiee"
                        )
                    })
                    .unwrap_or_else(|| {
                        "Prochaine execution modifiee par l'utilisateur".to_string()
                    }),
            );
            Ok(agent.clone())
        })
    }

    pub fn delete_memory(
        &self,
        id: &str,
        memory_id: &str,
    ) -> Result<AutonomousAgentSnapshot, String> {
        let now = metrics::now_ts();
        self.inner.mutate_store(|store| {
            let agent = find_agent_mut(store, id)?;
            ensure_user_managed_agent(agent)?;
            let index = agent
                .memory
                .iter()
                .position(|entry| entry.id == memory_id)
                .ok_or_else(|| "Memoire autonome introuvable".to_string())?;
            agent.memory.remove(index);
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "memory_deleted",
                "Memoire durable supprimee".to_string(),
            );
            Ok(agent.clone())
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut turn_to_stop = None;
        let mut validation_to_cancel = false;
        let mut discussion_to_delete = None;
        self.inner.mutate_store(|store| {
            let index = store
                .agents
                .iter()
                .position(|agent| agent.id == id)
                .ok_or_else(|| "Agent autonome introuvable".to_string())?;
            ensure_user_managed_agent(&store.agents[index])?;
            turn_to_stop = store.agents[index].current_turn_id;
            validation_to_cancel = store.agents[index].current_test_id.is_some();
            discussion_to_delete = store.agents[index]
                .session_id
                .clone()
                .map(|session_id| (store.agents[index].account_id.clone(), session_id));
            store.agents.remove(index);
            Ok(())
        })?;
        if let Some(turn_id) = turn_to_stop {
            if let Ok(stopped) = self.inner.chat.stop(turn_id) {
                if discussion_to_delete.is_none() {
                    discussion_to_delete = stopped
                        .session_id
                        .map(|session_id| (stopped.account_id, session_id));
                }
            }
        }
        if validation_to_cancel {
            self.inner.cancel_validation(id);
        }
        if let Some((account_id, session_id)) = discussion_to_delete {
            remove_autonomous_discussion(account_id, session_id);
        }
        Ok(())
    }
}

impl AutonomousAgentInner {
    fn mutate_store<T>(
        &self,
        mutate: impl FnOnce(&mut AutonomousAgentStore) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut store = self
            .store
            .lock()
            .map_err(|_| "Etat des agents autonomes verrouille".to_string())?;
        let previous = store.clone();
        let result = match mutate(&mut store) {
            Ok(result) => result,
            Err(error) => {
                *store = previous;
                return Err(error);
            }
        };
        let (_, supervisor_maintenance) =
            reconcile_system_supervisor(&mut store, metrics::now_ts());
        if *store == previous {
            return Ok(result);
        }
        if let Err(error) = persist_store(&self.storage_path, &store) {
            *store = previous;
            return Err(error);
        }
        drop(store);
        let mut discussion_to_delete = supervisor_maintenance.discussion_to_delete;
        if let Some(turn_id) = supervisor_maintenance.turn_to_stop {
            if let Ok(stopped) = self.chat.stop(turn_id) {
                if discussion_to_delete.is_none() {
                    discussion_to_delete = stopped
                        .session_id
                        .map(|session_id| (stopped.account_id, session_id));
                }
            }
        }
        if let Some((account_id, session_id)) = discussion_to_delete {
            remove_autonomous_discussion(account_id, session_id);
        }
        Ok(result)
    }

    fn cancel_validation(&self, agent_id: &str) {
        if let Ok(runs) = self.validation_runs.lock() {
            if let Some(run) = runs.get(agent_id) {
                run.cancelled.store(true, Ordering::SeqCst);
            }
        }
    }

    fn work_items(&self, now: i64) -> Vec<WorkerItem> {
        let Ok(store) = self.store.lock() else {
            return Vec::new();
        };
        store
            .agents
            .iter()
            .filter_map(|agent| {
                if agent.status != AutonomousAgentStatus::Active {
                    return None;
                }
                if agent.current_test_id.is_some() {
                    return None;
                }
                if agent.current_start_id.is_some() {
                    return None;
                }
                if let Some(turn_id) = agent.current_turn_id {
                    return Some(WorkerItem::Poll {
                        agent_id: agent.id.clone(),
                        turn_id,
                    });
                }
                if agent.next_run_at.is_some_and(|next| next <= now) {
                    return Some(WorkerItem::Start {
                        agent_id: agent.id.clone(),
                    });
                }
                None
            })
            .collect()
    }

    fn sleeping_workspace_agents(&self) -> Vec<AutonomousAgentSnapshot> {
        let Ok(store) = self.store.lock() else {
            return Vec::new();
        };
        store
            .agents
            .iter()
            .filter(|agent| {
                agent.status == AutonomousAgentStatus::Active
                    && agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange
                    && agent.current_turn_id.is_none()
                    && agent.current_start_id.is_none()
                    && agent.current_test_id.is_none()
                    && agent.next_run_at.is_none()
            })
            .cloned()
            .collect()
    }

    fn system_supervisor_context(&self, now: i64) -> Option<String> {
        let store = self.store.lock().ok()?;
        Some(render_system_supervisor_context(&store, now))
    }
}

enum WorkerItem {
    Start { agent_id: String },
    Poll { agent_id: String, turn_id: u64 },
}

fn spawn_worker(inner: Weak<AutonomousAgentInner>) {
    let _ = thread::Builder::new()
        .name("cst-autonomous-agents".to_string())
        .spawn(move || {
            let mut last_event_scan = Instant::now()
                .checked_sub(Duration::from_secs(EVENT_SCAN_INTERVAL_SECONDS))
                .unwrap_or_else(Instant::now);
            loop {
                let Some(inner) = inner.upgrade() else {
                    break;
                };
                let now = metrics::now_ts();
                if last_event_scan.elapsed() >= Duration::from_secs(EVENT_SCAN_INTERVAL_SECONDS) {
                    scan_workspace_events(&inner, now);
                    last_event_scan = Instant::now();
                }
                for item in inner.work_items(now) {
                    match item {
                        WorkerItem::Start { agent_id } => start_agent_run(&inner, &agent_id),
                        WorkerItem::Poll { agent_id, turn_id } => {
                            poll_agent_run(&inner, &agent_id, turn_id)
                        }
                    }
                }
                drop(inner);
                thread::sleep(Duration::from_secs(1));
            }
        });
}

fn scan_workspace_events(inner: &Arc<AutonomousAgentInner>, now: i64) {
    for snapshot in inner.sleeping_workspace_agents() {
        if let Err(error) =
            validate_watch_paths(snapshot.watch_paths.clone(), snapshot.trigger_kind)
        {
            record_workspace_trigger_error(inner, &snapshot, now, error);
            continue;
        }
        let project_dir = match snapshot.project_dir.as_deref() {
            Some(path) => Path::new(path),
            None => {
                record_workspace_trigger_error(
                    inner,
                    &snapshot,
                    now,
                    "Le dossier projet du declencheur est absent".to_string(),
                );
                continue;
            }
        };
        let fingerprint = match workspace_fingerprint(project_dir, &snapshot.watch_paths) {
            Ok(fingerprint) => fingerprint,
            Err(error) => {
                record_workspace_trigger_error(inner, &snapshot, now, error);
                continue;
            }
        };
        let agent_id = snapshot.id.clone();
        let expected_project_dir = snapshot.project_dir.clone();
        let expected_watch_paths = snapshot.watch_paths.clone();
        if let Err(error) = inner.mutate_store(|store| {
            let agent = find_agent_mut(store, &agent_id)?;
            if agent.status != AutonomousAgentStatus::Active
                || agent.trigger_kind != AutonomousTriggerKind::WorkspaceChange
                || agent.project_dir != expected_project_dir
                || agent.watch_paths != expected_watch_paths
                || agent.current_turn_id.is_some()
                || agent.current_start_id.is_some()
                || agent.current_test_id.is_some()
                || agent.next_run_at.is_some()
            {
                return Ok(());
            }

            apply_workspace_fingerprint(agent, fingerprint, now);
            Ok(())
        }) {
            eprintln!("[autonomous] declencheur {agent_id} non persiste: {error}");
        }
    }
}

fn apply_workspace_fingerprint(agent: &mut AutonomousAgentSnapshot, fingerprint: String, now: i64) {
    if agent.trigger_error.take().is_some() {
        push_event(
            agent,
            now,
            "trigger_recovered",
            "Le declencheur peut de nouveau lire les fichiers surveilles".to_string(),
        );
    }
    let Some(baseline) = agent.event_fingerprint.as_deref() else {
        agent.event_fingerprint = Some(fingerprint);
        agent.event_candidate_fingerprint = None;
        agent.event_candidate_since = None;
        agent.updated_at = now;
        push_event(
            agent,
            now,
            "trigger_armed",
            "Empreinte initiale enregistree ; agent en veille".to_string(),
        );
        return;
    };

    if baseline == fingerprint {
        let had_candidate = agent.event_candidate_fingerprint.take().is_some();
        let had_since = agent.event_candidate_since.take().is_some();
        if had_candidate || had_since {
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "trigger_reverted",
                "La modification a disparu avant la fin de la stabilisation".to_string(),
            );
        }
        return;
    }

    if agent.event_candidate_fingerprint.as_deref() != Some(fingerprint.as_str()) {
        agent.event_candidate_fingerprint = Some(fingerprint);
        agent.event_candidate_since = Some(now);
        agent.updated_at = now;
        push_event(
            agent,
            now,
            "change_detected",
            format!(
                "Modification detectee ; attente de {} s de stabilite",
                agent.debounce_seconds
            ),
        );
        return;
    }

    let stable_since = *agent.event_candidate_since.get_or_insert(now);
    if now.saturating_sub(stable_since) < agent.debounce_seconds as i64 {
        return;
    }
    let accepted = agent
        .event_candidate_fingerprint
        .take()
        .unwrap_or(fingerprint);
    agent.event_fingerprint = Some(accepted);
    agent.event_candidate_since = None;
    agent.last_triggered_at = Some(now);
    let watched = agent.watch_paths.join(", ");
    let message = format!("Modification stable des chemins surveilles : {watched}");
    agent.last_trigger_message = Some(message.clone());
    agent.next_run_at = Some(now);
    agent.updated_at = now;
    push_event(agent, now, "event_triggered", message);
}

fn record_workspace_trigger_error(
    inner: &Arc<AutonomousAgentInner>,
    snapshot: &AutonomousAgentSnapshot,
    now: i64,
    error: String,
) {
    let agent_id = snapshot.id.clone();
    let expected_project_dir = snapshot.project_dir.clone();
    let expected_watch_paths = snapshot.watch_paths.clone();
    let _ = inner.mutate_store(|store| {
        let agent = find_agent_mut(store, &agent_id)?;
        if agent.status != AutonomousAgentStatus::Active
            || agent.trigger_kind != AutonomousTriggerKind::WorkspaceChange
            || agent.project_dir != expected_project_dir
            || agent.watch_paths != expected_watch_paths
        {
            return Ok(());
        }
        if agent.trigger_error.as_deref() == Some(error.as_str()) {
            return Ok(());
        }
        agent.trigger_error = Some(error.clone());
        agent.updated_at = now;
        push_event(agent, now, "trigger_error", error);
        Ok(())
    });
}

fn next_run_after_activation(agent: &AutonomousAgentSnapshot, now: i64) -> Option<i64> {
    match agent.trigger_kind {
        AutonomousTriggerKind::Schedule => Some(now),
        AutonomousTriggerKind::WorkspaceChange => None,
    }
}

fn next_run_after_completed_step(agent: &AutonomousAgentSnapshot, now: i64) -> Option<i64> {
    match agent.trigger_kind {
        AutonomousTriggerKind::Schedule => Some(now.saturating_add(agent.interval_seconds as i64)),
        AutonomousTriggerKind::WorkspaceChange => None,
    }
}

fn put_workspace_agent_to_sleep(agent: &mut AutonomousAgentSnapshot, now: i64, message: &str) {
    agent.status = AutonomousAgentStatus::Active;
    agent.next_run_at = None;
    agent.pending_review = None;
    agent.approved_review = None;
    agent.work_items.clear();
    agent.next_task_id = None;
    agent.test_completion_pending = false;
    agent.updated_at = now;
    push_event(agent, now, "event_handled", message.to_string());
}

fn effective_turn_mode(agent: &AutonomousAgentSnapshot) -> ChatTurnMode {
    if agent.require_user_review && agent.approved_review.is_none() {
        ChatTurnMode::Plan
    } else {
        agent.mode
    }
}

fn start_agent_run(inner: &Arc<AutonomousAgentInner>, agent_id: &str) {
    let now = metrics::now_ts();
    let start_id = Uuid::new_v4().to_string();
    let prepared = inner.mutate_store(|store| {
        let agent = find_agent_mut(store, agent_id)?;
        if agent.status != AutonomousAgentStatus::Active
            || agent.current_turn_id.is_some()
            || agent.current_start_id.is_some()
            || agent.current_test_id.is_some()
            || agent.next_run_at.is_none_or(|next| next > now)
        {
            return Ok(None);
        }
        activate_next_work_item(agent, now);
        agent.current_start_id = Some(start_id.clone());
        agent.next_run_at = None;
        agent.last_run_started_at = Some(now);
        agent.attempt_count = agent.attempt_count.saturating_add(1);
        agent.updated_at = now;
        push_event(
            agent,
            now,
            "run_started",
            format!("Execution autonome #{} demarree", agent.attempt_count),
        );
        Ok(Some(agent.clone()))
    });
    let agent = match prepared {
        Ok(Some(agent)) => agent,
        Ok(None) => return,
        Err(error) => {
            eprintln!("[autonomous] preparation de {agent_id} impossible: {error}");
            return;
        }
    };

    let request = StartChatTurnRequest {
        account_id: agent.account_id.clone(),
        // Chaque cycle est volontairement isole. La continuite vient de la
        // memoire et du carnet persistants de l'agent, jamais de Discussions.
        session_id: None,
        prompt: if agent_is_system_supervisor(&agent) {
            let fleet = inner.system_supervisor_context(now);
            autonomous_prompt_with_context(&agent, fleet.as_deref())
        } else {
            autonomous_prompt(&agent)
        },
        project_dir: agent.project_dir.clone(),
        mode: effective_turn_mode(&agent),
        model: agent.model.clone(),
        reasoning_effort: agent.reasoning_effort.clone(),
        app_connectors: Some(agent.connectors.clone()),
        app_write_approved: agent
            .approved_review
            .as_ref()
            .is_some_and(|review| review.external_action),
        agent_tools: Vec::new(),
        agent_skills: Vec::new(),
        question_tool: false,
        proof_tool: false,
        source_chat_key: None,
    };

    match inner.chat.start(request) {
        Ok(snapshot) => {
            let mut should_stop = false;
            let result = inner.mutate_store(|store| {
                let current = find_agent_mut(store, agent_id)?;
                if current.status != AutonomousAgentStatus::Active
                    || current.current_start_id.as_deref() != Some(start_id.as_str())
                    || current.current_test_id.is_some()
                {
                    should_stop = true;
                    return Ok(());
                }
                current.current_start_id = None;
                current.current_turn_id = Some(snapshot.id);
                if snapshot.session_id.is_some() {
                    current.session_id = snapshot.session_id.clone();
                }
                current.updated_at = metrics::now_ts();
                Ok(())
            });
            if let Err(error) = result {
                eprintln!("[autonomous] tour {agent_id} non persiste: {error}");
                should_stop = true;
            }
            if should_stop {
                if let Ok(stopped) = inner.chat.stop(snapshot.id) {
                    if let Some(session_id) = stopped.session_id {
                        remove_autonomous_discussion(stopped.account_id, session_id);
                    }
                }
            }
        }
        Err(error) => record_failure(inner, agent_id, None, Some(&start_id), error),
    }
}

fn poll_agent_run(inner: &Arc<AutonomousAgentInner>, agent_id: &str, turn_id: u64) {
    let snapshot = match inner.chat.status(turn_id) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            record_failure(inner, agent_id, Some(turn_id), None, error);
            return;
        }
    };

    match snapshot.status {
        ChatTurnStatus::Running | ChatTurnStatus::Finalizing => {
            if snapshot.session_id.is_none() {
                return;
            }
            let _ = inner.mutate_store(|store| {
                let agent = find_agent_mut(store, agent_id)?;
                if agent.current_turn_id != Some(turn_id) {
                    return Ok(());
                }
                if agent.session_id != snapshot.session_id {
                    agent.session_id = snapshot.session_id.clone();
                    agent.updated_at = metrics::now_ts();
                }
                Ok(())
            });
        }
        ChatTurnStatus::Completed => complete_run(inner, agent_id, turn_id, &snapshot),
        ChatTurnStatus::Failed => record_failure(
            inner,
            agent_id,
            Some(turn_id),
            None,
            snapshot
                .error
                .unwrap_or_else(|| "Le tour autonome a echoue".to_string()),
        ),
        ChatTurnStatus::Cancelled => record_failure(
            inner,
            agent_id,
            Some(turn_id),
            None,
            "Le tour autonome a ete annule".to_string(),
        ),
    }
}

fn complete_run(
    inner: &Arc<AutonomousAgentInner>,
    agent_id: &str,
    turn_id: u64,
    snapshot: &ChatTurnSnapshot,
) {
    let now = metrics::now_ts();
    let requested_directive = directive_from_snapshot(snapshot);
    let summary = summary_from_snapshot(snapshot);
    let pending_review = review_from_snapshot(snapshot, now, summary.as_deref());
    let memories = memories_from_snapshot(snapshot);
    let work_plan_update = work_plan_from_snapshot(snapshot, now);
    let mut validation_to_start = None;
    let mut discussion_to_delete = None;
    if let Err(error) = inner.mutate_store(|store| {
        let agent = find_agent_mut(store, agent_id)?;
        if agent.current_turn_id != Some(turn_id) {
            return Ok(());
        }
        agent.current_turn_id = None;
        discussion_to_delete = snapshot
            .session_id
            .clone()
            .or_else(|| agent.session_id.clone())
            .map(|session_id| (agent.account_id.clone(), session_id));
        agent.session_id = None;
        agent.last_run_finished_at = Some(now);
        agent.run_count = agent.run_count.saturating_add(1);
        agent.consecutive_failures = 0;
        agent.model_capacity_retry_count = 0;
        agent.last_error = None;
        agent.last_summary = summary.clone();
        agent.updated_at = now;
        for memory in &memories {
            push_memory(agent, AutonomousMemoryKind::Agent, memory.clone(), now);
        }
        apply_work_plan_update(agent, &work_plan_update, now);
        // Le superviseur est une mission durable : meme s'il considere le
        // controle courant termine ou bloque, il reste planifie pour le
        // prochain passage horaire tant que la flotte est active.
        let durable_directive = if agent_is_system_supervisor(agent) {
            AgentDirective::Continue
        } else {
            requested_directive
        };
        let directive = reconcile_completion_with_work_plan(agent, durable_directive, now);

        let approval_used = agent.approved_review.take().is_some();
        if agent.require_user_review && !approval_used && directive != AgentDirective::Blocked {
            agent.status = AutonomousAgentStatus::NeedsAttention;
            agent.next_run_at = None;
            agent.pending_review = Some(pending_review.clone());
            agent.last_error = Some(
                "Review utilisateur obligatoire avant d'appliquer les changements".to_string(),
            );
            push_event(
                agent,
                now,
                "review_required",
                "Plan prepare ; autorisation utilisateur requise avant application".to_string(),
            );
            return Ok(());
        }

        match directive {
            AgentDirective::Complete => {
                agent.pending_review = None;
                if agent.test_command.is_some() {
                    match prepare_validation(agent, now, true) {
                        Ok(test_id) => {
                            validation_to_start = Some(test_id);
                            push_event(
                                agent,
                                now,
                                "test_started",
                                "Objectif declare termine ; validation obligatoire demarree"
                                    .to_string(),
                            );
                        }
                        Err(error) => {
                            agent.status = AutonomousAgentStatus::NeedsAttention;
                            agent.next_run_at = None;
                            agent.test_status = AutonomousTestStatus::Failed;
                            agent.test_completion_pending = false;
                            agent.last_error = Some(error.clone());
                            push_event(agent, now, "test_unavailable", error);
                        }
                    }
                } else {
                    if agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                        put_workspace_agent_to_sleep(
                            agent,
                            now,
                            "Evenement traite ; agent rearme et rendormi",
                        );
                    } else {
                        agent.status = AutonomousAgentStatus::Completed;
                        agent.next_run_at = None;
                        push_event(
                            agent,
                            now,
                            "completed",
                            "L'agent a declare l'objectif termine".to_string(),
                        );
                    }
                }
            }
            AgentDirective::Blocked => {
                agent.status = AutonomousAgentStatus::NeedsAttention;
                agent.next_run_at = None;
                agent.pending_review = Some(pending_review.clone());
                agent.last_error =
                    Some("L'agent demande une decision ou une autorisation humaine".to_string());
                push_event(
                    agent,
                    now,
                    "blocked",
                    "Intervention humaine requise".to_string(),
                );
            }
            AgentDirective::Continue => {
                agent.status = AutonomousAgentStatus::Active;
                agent.next_run_at = Some(now.saturating_add(agent.interval_seconds as i64));
                agent.pending_review = None;
                push_event(
                    agent,
                    now,
                    "run_completed",
                    format!(
                        "Etape #{} terminee, prochaine execution dans {} s",
                        agent.run_count, agent.interval_seconds
                    ),
                );
            }
        }
        Ok(())
    }) {
        eprintln!("[autonomous] fin du tour {agent_id} non persistee: {error}");
        return;
    }
    if let Some(test_id) = validation_to_start {
        let agent = match inner.store.lock() {
            Ok(store) => store
                .agents
                .iter()
                .find(|agent| agent.id == agent_id)
                .cloned(),
            Err(_) => None,
        };
        if let Some(agent) = agent {
            launch_validation(inner, agent, test_id);
        }
    }
    if let Some((account_id, session_id)) = discussion_to_delete {
        remove_autonomous_discussion(account_id, session_id);
    }
}

fn prepare_validation(
    agent: &mut AutonomousAgentSnapshot,
    now: i64,
    completion_pending: bool,
) -> Result<String, String> {
    if agent.test_command.is_none() {
        return Err("Aucune commande de test n'est configuree pour cet agent".to_string());
    }
    let project_dir = agent
        .project_dir
        .as_deref()
        .ok_or_else(|| "Le dossier projet est requis pour lancer les tests".to_string())?;
    if !Path::new(project_dir).is_dir() {
        return Err(format!("Le dossier de test n'existe plus : {project_dir}"));
    }
    let test_id = Uuid::new_v4().to_string();
    agent.current_test_id = Some(test_id.clone());
    agent.test_status = AutonomousTestStatus::Running;
    agent.test_completion_pending = completion_pending;
    agent.last_test_started_at = Some(now);
    agent.last_test_finished_at = None;
    agent.last_test_exit_code = None;
    agent.last_test_duration_ms = None;
    agent.last_test_output = None;
    agent.next_run_at = None;
    agent.updated_at = now;
    Ok(test_id)
}

fn cancel_validation_state(agent: &mut AutonomousAgentSnapshot, now: i64) -> bool {
    if agent.current_test_id.take().is_none() {
        return false;
    }
    agent.test_status = AutonomousTestStatus::Cancelled;
    agent.test_completion_pending = false;
    agent.last_test_finished_at = Some(now);
    true
}

fn launch_validation(
    inner: &Arc<AutonomousAgentInner>,
    agent: AutonomousAgentSnapshot,
    test_id: String,
) {
    let run = Arc::new(ValidationRun {
        id: test_id.clone(),
        cancelled: AtomicBool::new(false),
    });
    if let Ok(mut runs) = inner.validation_runs.lock() {
        if let Some(previous) = runs.insert(agent.id.clone(), run.clone()) {
            previous.cancelled.store(true, Ordering::SeqCst);
        }
    }

    let thread_inner = Arc::clone(inner);
    let thread_agent = agent.clone();
    let thread_test_id = test_id.clone();
    let thread_run = run.clone();
    let spawned = thread::Builder::new()
        .name(format!("cst-agent-test-{}", short_id(&agent.id)))
        .spawn(move || {
            if !validation_is_current(&thread_inner, &thread_agent.id, &thread_test_id) {
                thread_run.cancelled.store(true, Ordering::SeqCst);
            }
            let result = run_validation_command(&thread_agent, &thread_run.cancelled);
            finish_validation(&thread_inner, &thread_agent.id, &thread_test_id, result);
            remove_validation_run(&thread_inner, &thread_agent.id, &thread_test_id);
        });

    if let Err(error) = spawned {
        finish_validation(
            inner,
            &agent.id,
            &test_id,
            ValidationResult {
                status: AutonomousTestStatus::Failed,
                exit_code: None,
                duration_ms: 0,
                output: format!("Impossible de demarrer le processus de test : {error}"),
            },
        );
        remove_validation_run(inner, &agent.id, &test_id);
    }
}

fn validation_is_current(inner: &AutonomousAgentInner, agent_id: &str, test_id: &str) -> bool {
    inner
        .store
        .lock()
        .ok()
        .and_then(|store| {
            store
                .agents
                .iter()
                .find(|agent| agent.id == agent_id)
                .map(|agent| {
                    agent.status == AutonomousAgentStatus::Active
                        && agent.current_test_id.as_deref() == Some(test_id)
                        && agent.test_status == AutonomousTestStatus::Running
                })
        })
        .unwrap_or(false)
}

fn remove_validation_run(inner: &AutonomousAgentInner, agent_id: &str, test_id: &str) {
    if let Ok(mut runs) = inner.validation_runs.lock() {
        if runs.get(agent_id).is_some_and(|run| run.id == test_id) {
            runs.remove(agent_id);
        }
    }
}

fn run_validation_command(
    agent: &AutonomousAgentSnapshot,
    cancelled: &AtomicBool,
) -> ValidationResult {
    let started = Instant::now();
    if cancelled.load(Ordering::SeqCst) {
        return ValidationResult {
            status: AutonomousTestStatus::Cancelled,
            exit_code: None,
            duration_ms: 0,
            output: "Validation annulee avant son demarrage".to_string(),
        };
    }

    let Some(command_text) = agent.test_command.as_deref() else {
        return ValidationResult {
            status: AutonomousTestStatus::Failed,
            exit_code: None,
            duration_ms: 0,
            output: "Commande de test absente".to_string(),
        };
    };
    let Some(project_dir) = agent.project_dir.as_deref() else {
        return ValidationResult {
            status: AutonomousTestStatus::Failed,
            exit_code: None,
            duration_ms: 0,
            output: "Dossier projet absent".to_string(),
        };
    };

    let mut command = shell_command(command_text);
    command
        .current_dir(project_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_process_window(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return ValidationResult {
                status: AutonomousTestStatus::Failed,
                exit_code: None,
                duration_ms: started.elapsed().as_millis() as u64,
                output: format!("Impossible de lancer `{command_text}` : {error}"),
            }
        }
    };

    let stdout_reader = child
        .stdout
        .take()
        .map(|stdout| thread::spawn(move || read_capped(stdout)));
    let stderr_reader = child
        .stderr
        .take()
        .map(|stderr| thread::spawn(move || read_capped(stderr)));
    let timeout = Duration::from_secs(agent.test_timeout_seconds.max(1));
    let mut forced_status = None;
    let exit_status = loop {
        if cancelled.load(Ordering::SeqCst) {
            forced_status = Some(AutonomousTestStatus::Cancelled);
            kill_process_tree(&mut child);
            break child.wait().ok();
        }
        if started.elapsed() >= timeout {
            forced_status = Some(AutonomousTestStatus::Failed);
            kill_process_tree(&mut child);
            break child.wait().ok();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => {
                kill_process_tree(&mut child);
                let mut output = collect_process_output(stdout_reader, stderr_reader);
                append_output(
                    &mut output,
                    &format!("Impossible de lire l'etat du test : {error}"),
                );
                return ValidationResult {
                    status: AutonomousTestStatus::Failed,
                    exit_code: None,
                    duration_ms: started.elapsed().as_millis() as u64,
                    output,
                };
            }
        }
    };

    let mut output = collect_process_output(stdout_reader, stderr_reader);
    let status = forced_status.unwrap_or_else(|| {
        if exit_status.as_ref().is_some_and(|status| status.success()) {
            AutonomousTestStatus::Passed
        } else {
            AutonomousTestStatus::Failed
        }
    });
    if status == AutonomousTestStatus::Cancelled {
        append_output(&mut output, "Validation annulee");
    } else if forced_status == Some(AutonomousTestStatus::Failed) {
        append_output(
            &mut output,
            &format!(
                "Delai de {} secondes depasse ; processus interrompu",
                agent.test_timeout_seconds
            ),
        );
    }
    if output.trim().is_empty() {
        output = if status == AutonomousTestStatus::Passed {
            "Tests termines sans sortie".to_string()
        } else {
            "La commande de test a echoue sans sortie".to_string()
        };
    }
    ValidationResult {
        status,
        exit_code: exit_status.and_then(|status| status.code()),
        duration_ms: started.elapsed().as_millis() as u64,
        output,
    }
}

fn finish_validation(
    inner: &Arc<AutonomousAgentInner>,
    agent_id: &str,
    test_id: &str,
    result: ValidationResult,
) {
    let now = metrics::now_ts();
    let ValidationResult {
        status,
        exit_code,
        duration_ms,
        output,
    } = result;
    let output = redact_test_output(&output);
    if let Err(error) = inner.mutate_store(|store| {
        let agent = find_agent_mut(store, agent_id)?;
        if agent.current_test_id.as_deref() != Some(test_id) {
            return Ok(());
        }
        agent.current_test_id = None;
        agent.test_status = status;
        agent.last_test_finished_at = Some(now);
        agent.last_test_exit_code = exit_code;
        agent.last_test_duration_ms = Some(duration_ms);
        agent.last_test_output = Some(output.clone());
        agent.updated_at = now;

        match status {
            AutonomousTestStatus::Passed => {
                agent.consecutive_test_failures = 0;
                agent.last_error = None;
                if agent.test_completion_pending {
                    if agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange {
                        put_workspace_agent_to_sleep(
                            agent,
                            now,
                            "Evenement traite, tests valides ; agent rearme et rendormi",
                        );
                    } else {
                        agent.status = AutonomousAgentStatus::Completed;
                        agent.next_run_at = None;
                        push_event(
                            agent,
                            now,
                            "completed",
                            "Objectif termine et commande de test validee".to_string(),
                        );
                    }
                } else {
                    agent.status = AutonomousAgentStatus::Active;
                    agent.next_run_at = next_run_after_completed_step(agent, now);
                    push_event(
                        agent,
                        now,
                        "test_passed",
                        format!("Validation reussie en {duration_ms} ms"),
                    );
                }
                agent.test_completion_pending = false;
            }
            AutonomousTestStatus::Failed => {
                agent.test_completion_pending = false;
                agent.consecutive_test_failures = agent.consecutive_test_failures.saturating_add(1);
                agent.last_error = Some(format!(
                    "La validation a echoue{} ; la sortie est conservee pour la prochaine etape",
                    exit_code
                        .map(|code| format!(" (code {code})"))
                        .unwrap_or_default()
                ));
                push_memory(
                    agent,
                    AutonomousMemoryKind::Test,
                    format!(
                        "Echec de validation #{} : {}",
                        agent.consecutive_test_failures,
                        output.chars().take(MAX_MEMORY_CHARS).collect::<String>()
                    ),
                    now,
                );
                upsert_validation_repair_task(agent, &output, now);
                if agent.consecutive_test_failures >= MAX_CONSECUTIVE_TEST_FAILURES {
                    agent.status = AutonomousAgentStatus::NeedsAttention;
                    agent.next_run_at = None;
                    push_event(
                        agent,
                        now,
                        "needs_attention",
                        format!(
                            "Agent suspendu apres {} validations echouees",
                            agent.consecutive_test_failures
                        ),
                    );
                } else {
                    agent.status = AutonomousAgentStatus::Active;
                    agent.next_run_at = Some(now);
                    push_event(
                        agent,
                        now,
                        "test_failed",
                        "Validation echouee ; correction autonome replanifiee immediatement"
                            .to_string(),
                    );
                }
            }
            AutonomousTestStatus::Cancelled => {
                agent.test_completion_pending = false;
                if agent.status == AutonomousAgentStatus::Active {
                    agent.next_run_at = Some(now);
                }
                push_event(
                    agent,
                    now,
                    "test_cancelled",
                    "Validation annulee".to_string(),
                );
            }
            AutonomousTestStatus::NotConfigured
            | AutonomousTestStatus::Idle
            | AutonomousTestStatus::Running => {}
        }
        Ok(())
    }) {
        eprintln!("[autonomous] resultat du test {agent_id} non persiste: {error}");
    }
}

fn read_capped(mut reader: impl Read) -> (Vec<u8>, bool) {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => {
                let available = MAX_TEST_OUTPUT_BYTES.saturating_sub(output.len());
                if available > 0 {
                    output.extend_from_slice(&buffer[..read.min(available)]);
                }
                if read > available {
                    truncated = true;
                }
            }
        }
    }
    (output, truncated)
}

fn collect_process_output(
    stdout: Option<thread::JoinHandle<(Vec<u8>, bool)>>,
    stderr: Option<thread::JoinHandle<(Vec<u8>, bool)>>,
) -> String {
    let (stdout, stdout_truncated) = stdout
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let (stderr, stderr_truncated) = stderr
        .and_then(|reader| reader.join().ok())
        .unwrap_or_default();
    let mut sections = Vec::new();
    if !stdout.is_empty() {
        sections.push(format!(
            "stdout:\n{}",
            String::from_utf8_lossy(&stdout).trim()
        ));
    }
    if !stderr.is_empty() {
        sections.push(format!(
            "stderr:\n{}",
            String::from_utf8_lossy(&stderr).trim()
        ));
    }
    if stdout_truncated || stderr_truncated {
        sections.push(format!(
            "[sortie tronquee a {} Kio par flux]",
            MAX_TEST_OUTPUT_BYTES / 1024
        ));
    }
    sections.join("\n\n")
}

fn append_output(output: &mut String, message: &str) {
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str(message);
}

fn redact_test_output(output: &str) -> String {
    const SENSITIVE_MARKERS: &[&str] = &[
        "authorization:",
        "bearer ",
        "api_key",
        "api-key",
        "access_token",
        "refresh_token",
        "password=",
        "password:",
        "passwd=",
        "secret=",
        "secret:",
        "token=",
    ];
    output
        .lines()
        .map(|line| {
            let normalized = line.to_ascii_lowercase();
            if SENSITIVE_MARKERS
                .iter()
                .any(|marker| normalized.contains(marker))
            {
                "[ligne potentiellement sensible masquee]"
            } else {
                line
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[cfg(windows)]
fn shell_command(command_text: &str) -> Command {
    let mut command = Command::new("cmd.exe");
    command.args(["/D", "/S", "/C", command_text]);
    command
}

#[cfg(not(windows))]
fn shell_command(command_text: &str) -> Command {
    use std::os::unix::process::CommandExt;

    let mut command = Command::new("sh");
    command.args(["-lc", command_text]);
    command.process_group(0);
    command
}

fn kill_process_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let mut taskkill = Command::new("taskkill");
        taskkill.args(["/PID", &child.id().to_string(), "/T", "/F"]);
        hide_process_window(&mut taskkill);
        let _ = taskkill.status();
    }
    #[cfg(not(windows))]
    {
        let process_group = format!("-{}", child.id());
        let _ = Command::new("kill")
            .args(["-KILL", &process_group])
            .status();
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn hide_process_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
}

#[cfg(not(windows))]
fn hide_process_window(_command: &mut Command) {}

fn short_id(value: &str) -> String {
    value.chars().take(8).collect()
}

#[derive(Debug, Clone)]
struct QuotaFailoverTarget {
    source_account_id: String,
    account_id: String,
    label: String,
    model: Option<String>,
    reasoning_effort: Option<String>,
    remaining_percent: f64,
}

fn remaining_quota_percent(limit: &settings::AccountLimitView) -> Option<f64> {
    if !limit.has_tokens || limit.provider != settings::Provider::Codex {
        return None;
    }
    if limit
        .buckets
        .iter()
        .any(|bucket| bucket.rate_limit_reached_type.is_some())
    {
        return Some(0.0);
    }

    let mut remaining = Vec::new();
    for used in [limit.session_used_percent, limit.weekly_used_percent]
        .into_iter()
        .flatten()
    {
        remaining.push((100.0 - used).clamp(0.0, 100.0));
    }
    for bucket in &limit.buckets {
        if let Some(used) = bucket.used_percent {
            remaining.push((100.0 - used).clamp(0.0, 100.0));
        }
    }
    remaining.into_iter().reduce(f64::min)
}

fn select_quota_failover_target(
    current_account_id: &str,
    accounts: &[settings::AccountProfile],
    limits: &[settings::AccountLimitView],
) -> Option<QuotaFailoverTarget> {
    let source = accounts
        .iter()
        .find(|account| account.id == current_account_id)?;
    if source.provider != settings::Provider::Codex {
        return None;
    }

    accounts
        .iter()
        .filter(|account| {
            account.id != current_account_id
                && account.provider == settings::Provider::Codex
                && !account.label.eq_ignore_ascii_case(&source.label)
        })
        .filter_map(|account| {
            let limit = limits.iter().find(|limit| limit.id == account.id)?;
            let remaining_percent = remaining_quota_percent(limit)?;
            (remaining_percent > 0.0).then(|| QuotaFailoverTarget {
                source_account_id: current_account_id.to_string(),
                account_id: account.id.clone(),
                label: account.label.clone(),
                model: account.model.clone(),
                reasoning_effort: account.reasoning_effort.clone(),
                remaining_percent,
            })
        })
        .max_by(|left, right| left.remaining_percent.total_cmp(&right.remaining_percent))
}

fn quota_failover_target(agent: &AutonomousAgentSnapshot) -> Option<QuotaFailoverTarget> {
    let app_settings = settings::load_settings_for_terminal().ok()?;
    let limits = settings::account_limit_views(&app_settings);
    select_quota_failover_target(&agent.account_id, &app_settings.accounts, &limits)
}

fn record_failure(
    inner: &Arc<AutonomousAgentInner>,
    agent_id: &str,
    expected_turn_id: Option<u64>,
    expected_start_id: Option<&str>,
    error: String,
) {
    let now = metrics::now_ts();
    let error = error.chars().take(MAX_SUMMARY_CHARS).collect::<String>();
    let model_capacity_error = is_model_capacity_message(&error);
    let quota_failover = if is_quota_exhaustion_message(&error) {
        inner
            .store
            .lock()
            .ok()
            .and_then(|store| {
                store
                    .agents
                    .iter()
                    .find(|agent| {
                        agent.id == agent_id && agent.status == AutonomousAgentStatus::Active
                    })
                    .cloned()
            })
            .and_then(|agent| quota_failover_target(&agent))
    } else {
        None
    };
    let mut discussion_to_delete = None;
    if let Err(persist_error) = inner.mutate_store(|store| {
        let agent = find_agent_mut(store, agent_id)?;
        if expected_turn_id.is_some() && agent.current_turn_id != expected_turn_id {
            return Ok(());
        }
        if expected_start_id.is_some() && agent.current_start_id.as_deref() != expected_start_id {
            return Ok(());
        }
        if agent.status != AutonomousAgentStatus::Active {
            return Ok(());
        }
        agent.current_start_id = None;
        agent.current_turn_id = None;
        discussion_to_delete = agent
            .session_id
            .take()
            .map(|session_id| (agent.account_id.clone(), session_id));
        agent.last_run_finished_at = Some(now);
        if let Some(target) = quota_failover
            .as_ref()
            .filter(|target| target.source_account_id == agent.account_id)
        {
            agent.account_id = target.account_id.clone();
            agent.model = target.model.clone();
            agent.reasoning_effort = target.reasoning_effort.clone();
            agent.consecutive_failures = 0;
            agent.model_capacity_retry_count = 0;
            agent.last_error = None;
            agent.next_run_at = Some(now);
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "quota_account_switched",
                format!(
                    "Quota epuise ; bascule automatique vers {} ({:.0}% restant)",
                    target.label, target.remaining_percent
                ),
            );
            return Ok(());
        }
        if model_capacity_error {
            agent.model_capacity_retry_count = agent.model_capacity_retry_count.saturating_add(1);
            let attempt = agent.model_capacity_retry_count;
            let retry_delay = model_capacity_retry_delay_seconds(attempt);
            agent.last_error = Some(error.clone());
            agent.next_run_at = Some(now.saturating_add(retry_delay as i64));
            agent.updated_at = now;
            push_event(
                agent,
                now,
                "model_capacity_retry",
                format!(
                    "Modele temporairement sature ; nouvelle tentative automatique #{attempt} dans {retry_delay} s"
                ),
            );
            return Ok(());
        }
        agent.model_capacity_retry_count = 0;
        agent.consecutive_failures = agent.consecutive_failures.saturating_add(1);
        agent.last_error = Some(error.clone());
        agent.updated_at = now;

        if agent.consecutive_failures >= MAX_CONSECUTIVE_FAILURES {
            agent.status = AutonomousAgentStatus::NeedsAttention;
            agent.next_run_at = None;
            push_event(
                agent,
                now,
                "needs_attention",
                format!(
                    "Agent suspendu apres {} echecs consecutifs",
                    agent.consecutive_failures
                ),
            );
        } else {
            let multiplier = 1_u64 << agent.consecutive_failures.saturating_sub(1).min(8);
            let retry_delay = agent
                .interval_seconds
                .saturating_mul(multiplier)
                .min(MAX_RETRY_DELAY_SECONDS);
            agent.next_run_at = Some(now.saturating_add(retry_delay as i64));
            push_event(
                agent,
                now,
                "run_failed",
                format!(
                    "Echec {}/{} ; nouvel essai dans {} s",
                    agent.consecutive_failures, MAX_CONSECUTIVE_FAILURES, retry_delay
                ),
            );
        }
        Ok(())
    }) {
        eprintln!("[autonomous] echec de {agent_id} non persiste: {persist_error}");
        return;
    }
    if let Some((account_id, session_id)) = discussion_to_delete {
        remove_autonomous_discussion(account_id, session_id);
    }
}

fn model_capacity_retry_delay_seconds(attempt: u32) -> u64 {
    let exponent = attempt.saturating_sub(1).min(8);
    3_u64
        .saturating_mul(1_u64 << exponent)
        .min(MODEL_CAPACITY_RETRY_MAX_DELAY_SECONDS)
}

fn remove_autonomous_discussion(account_id: String, session_id: String) {
    if Uuid::parse_str(&session_id).is_err() {
        return;
    }
    let _ = thread::Builder::new()
        .name("cst-autonomous-discussion-cleanup".to_string())
        .spawn(move || {
            for attempt in 0..20 {
                match discussions::delete_discussion_for_account(
                    account_id.clone(),
                    session_id.clone(),
                    false,
                ) {
                    Ok(_) => return,
                    Err(_) if attempt < 19 => {
                        thread::sleep(Duration::from_millis(250));
                    }
                    Err(error) => {
                        eprintln!(
                            "[autonomous] nettoyage de la discussion ephemere {session_id} impossible: {error}"
                        );
                        return;
                    }
                }
            }
        });
}

fn work_item_status_protocol(status: AutonomousWorkItemStatus) -> &'static str {
    match status {
        AutonomousWorkItemStatus::Todo => "todo",
        AutonomousWorkItemStatus::InProgress => "in_progress",
        AutonomousWorkItemStatus::Done => "done",
        AutonomousWorkItemStatus::Blocked => "blocked",
        AutonomousWorkItemStatus::Cancelled => "cancelled",
    }
}

fn work_item_is_actionable(status: AutonomousWorkItemStatus) -> bool {
    matches!(
        status,
        AutonomousWorkItemStatus::Todo | AutonomousWorkItemStatus::InProgress
    )
}

fn render_work_plan_for_prompt(agent: &AutonomousAgentSnapshot) -> String {
    let strategy = agent
        .memory_strategy
        .as_deref()
        .unwrap_or("A definir au debut du prochain tour.");
    if agent.work_items.is_empty() {
        return format!(
            "\n\nCARNET DE TRAVAIL PERSISTANT :\nStrategie de memoire : {strategy}\nAucune tache structuree n'est encore enregistree. La premiere action du prochain tour doit etre de segmenter l'objectif et de choisir une tache."
        );
    }

    let mut ordered = agent.work_items.iter().collect::<Vec<_>>();
    ordered.sort_by_key(|item| {
        let selected = usize::from(agent.next_task_id.as_deref() != Some(item.id.as_str()));
        let status = match item.status {
            AutonomousWorkItemStatus::InProgress => 0,
            AutonomousWorkItemStatus::Todo => 1,
            AutonomousWorkItemStatus::Blocked => 2,
            AutonomousWorkItemStatus::Done => 3,
            AutonomousWorkItemStatus::Cancelled => 4,
        };
        (selected, status)
    });

    let mut remaining = MAX_PROMPT_WORK_PLAN_CHARS;
    let mut rows = Vec::new();
    for item in ordered {
        let next = if agent.next_task_id.as_deref() == Some(item.id.as_str()) {
            " [PROCHAINE]"
        } else {
            ""
        };
        let evidence = item
            .evidence
            .as_deref()
            .map(|value| format!(" | preuve: {value}"))
            .unwrap_or_default();
        let row = format!(
            "- [{}] {} / {} : {}{}{}",
            work_item_status_protocol(item.status),
            item.id,
            item.domain,
            item.description,
            evidence,
            next
        );
        let row_len = row.chars().count();
        if row_len > remaining {
            break;
        }
        remaining = remaining.saturating_sub(row_len);
        rows.push(row);
    }
    let done = agent
        .work_items
        .iter()
        .filter(|item| item.status == AutonomousWorkItemStatus::Done)
        .count();
    format!(
        "\n\nCARNET DE TRAVAIL PERSISTANT ({done}/{} taches faites) :\nStrategie de memoire : {strategy}\n{}",
        agent.work_items.len(),
        rows.join("\n")
    )
}

fn normalize_work_item_id(value: &str) -> Option<String> {
    let mut normalized = String::new();
    let mut separator = false;
    for character in value.trim().chars() {
        if normalized.chars().count() >= MAX_WORK_ITEM_ID_CHARS {
            break;
        }
        if character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.') {
            normalized.push(character.to_ascii_lowercase());
            separator = false;
        } else if !normalized.is_empty() && !separator {
            normalized.push('-');
            separator = true;
        }
    }
    let normalized = normalized.trim_matches('-').to_string();
    (!normalized.is_empty()).then_some(normalized)
}

fn parse_work_item_status(value: &str) -> Option<AutonomousWorkItemStatus> {
    match value.trim().to_ascii_lowercase().as_str() {
        "todo" | "pending" | "a_faire" => Some(AutonomousWorkItemStatus::Todo),
        "in_progress" | "in-progress" | "en_cours" => Some(AutonomousWorkItemStatus::InProgress),
        "done" | "complete" | "fait" => Some(AutonomousWorkItemStatus::Done),
        "blocked" | "bloque" => Some(AutonomousWorkItemStatus::Blocked),
        "cancelled" | "canceled" | "annule" => Some(AutonomousWorkItemStatus::Cancelled),
        _ => None,
    }
}

fn work_plan_from_snapshot(snapshot: &ChatTurnSnapshot, updated_at: i64) -> WorkPlanUpdate {
    let mut update = WorkPlanUpdate {
        memory_strategy: protocol_value_from_snapshot(
            snapshot,
            "AUTONOMOUS_MEMORY_STRATEGY",
            MAX_MEMORY_STRATEGY_CHARS,
        ),
        next_task_id: protocol_value_from_snapshot(
            snapshot,
            "AUTONOMOUS_NEXT_TASK",
            MAX_WORK_ITEM_ID_CHARS,
        )
        .filter(|value| !value.eq_ignore_ascii_case("none"))
        .and_then(|value| normalize_work_item_id(&value)),
        ..WorkPlanUpdate::default()
    };

    let texts = snapshot
        .parts
        .iter()
        .filter_map(|part| part.text.as_deref())
        .chain(
            snapshot
                .thoughts
                .iter()
                .map(|thought| thought.text.as_str()),
        );
    for line in texts.flat_map(str::lines) {
        let Some((candidate, value)) = line.trim().split_once(':') else {
            continue;
        };
        if !candidate.trim().eq_ignore_ascii_case("AUTONOMOUS_TASK") {
            continue;
        }
        let fields = value.splitn(5, '|').map(str::trim).collect::<Vec<_>>();
        if fields.len() < 4 {
            continue;
        }
        let Some(id) = normalize_work_item_id(fields[0]) else {
            continue;
        };
        let Some(status) = parse_work_item_status(fields[1]) else {
            continue;
        };
        let domain = fields[2]
            .chars()
            .take(MAX_WORK_ITEM_DOMAIN_CHARS)
            .collect::<String>();
        let description = fields[3]
            .chars()
            .take(MAX_WORK_ITEM_DESCRIPTION_CHARS)
            .collect::<String>();
        if domain.is_empty() || description.is_empty() {
            continue;
        }
        let evidence = fields
            .get(4)
            .map(|value| {
                value
                    .chars()
                    .take(MAX_WORK_ITEM_EVIDENCE_CHARS)
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty());
        let item = AutonomousWorkItem {
            id: id.clone(),
            status,
            domain,
            description,
            evidence,
            updated_at,
        };
        if let Some(existing) = update.items.iter_mut().find(|item| item.id == id) {
            *existing = item;
        } else if update.items.len() < MAX_WORK_ITEMS {
            update.items.push(item);
        }
    }
    update
}

fn find_actionable_work_item<'a>(
    agent: &'a AutonomousAgentSnapshot,
    id: &str,
) -> Option<&'a AutonomousWorkItem> {
    agent
        .work_items
        .iter()
        .find(|item| item.id == id && work_item_is_actionable(item.status))
}

fn choose_next_work_item_id(
    agent: &AutonomousAgentSnapshot,
    requested: Option<&str>,
) -> Option<String> {
    requested
        .and_then(|id| find_actionable_work_item(agent, id))
        .or_else(|| {
            agent
                .next_task_id
                .as_deref()
                .and_then(|id| find_actionable_work_item(agent, id))
        })
        .or_else(|| {
            agent
                .work_items
                .iter()
                .find(|item| item.status == AutonomousWorkItemStatus::InProgress)
        })
        .or_else(|| {
            agent
                .work_items
                .iter()
                .find(|item| item.status == AutonomousWorkItemStatus::Todo)
        })
        .map(|item| item.id.clone())
}

fn apply_work_plan_update(
    agent: &mut AutonomousAgentSnapshot,
    update: &WorkPlanUpdate,
    updated_at: i64,
) {
    if let Some(strategy) = update.memory_strategy.as_deref() {
        let strategy = strategy
            .trim()
            .chars()
            .take(MAX_MEMORY_STRATEGY_CHARS)
            .collect::<String>();
        if !strategy.is_empty() {
            agent.memory_strategy = Some(strategy);
        }
    }

    for incoming in &update.items {
        if let Some(existing) = agent
            .work_items
            .iter_mut()
            .find(|item| item.id == incoming.id)
        {
            let previous_evidence = existing.evidence.clone();
            *existing = incoming.clone();
            if existing.status == AutonomousWorkItemStatus::Done && existing.evidence.is_none() {
                existing.evidence = previous_evidence;
                if existing.evidence.is_none() {
                    existing.status = AutonomousWorkItemStatus::InProgress;
                }
            }
            existing.updated_at = updated_at;
        } else if agent.work_items.len() < MAX_WORK_ITEMS {
            let mut incoming = incoming.clone();
            if incoming.status == AutonomousWorkItemStatus::Done && incoming.evidence.is_none() {
                incoming.status = AutonomousWorkItemStatus::InProgress;
            }
            agent.work_items.push(incoming);
        }
    }
    agent.next_task_id = choose_next_work_item_id(agent, update.next_task_id.as_deref());
}

fn activate_next_work_item(agent: &mut AutonomousAgentSnapshot, updated_at: i64) {
    let next = choose_next_work_item_id(agent, agent.next_task_id.as_deref());
    agent.next_task_id = next.clone();
    let Some(next) = next else {
        return;
    };
    if let Some(item) = agent.work_items.iter_mut().find(|item| item.id == next) {
        if item.status == AutonomousWorkItemStatus::Todo {
            item.status = AutonomousWorkItemStatus::InProgress;
            item.updated_at = updated_at;
        }
    }
}

fn reconcile_completion_with_work_plan(
    agent: &mut AutonomousAgentSnapshot,
    requested: AgentDirective,
    now: i64,
) -> AgentDirective {
    if requested != AgentDirective::Complete {
        return requested;
    }
    if agent.work_items.is_empty() {
        push_event(
            agent,
            now,
            "plan_required",
            "Conclusion reportee : le carnet de travail structure doit d'abord etre cree"
                .to_string(),
        );
        return AgentDirective::Continue;
    }

    let open_count = agent
        .work_items
        .iter()
        .filter(|item| {
            !matches!(
                item.status,
                AutonomousWorkItemStatus::Done | AutonomousWorkItemStatus::Cancelled
            )
        })
        .count();
    if open_count == 0 {
        agent.next_task_id = None;
        return AgentDirective::Complete;
    }
    let blocked_count = agent
        .work_items
        .iter()
        .filter(|item| item.status == AutonomousWorkItemStatus::Blocked)
        .count();
    if blocked_count == open_count {
        push_event(
            agent,
            now,
            "plan_blocked",
            format!(
                "Conclusion impossible : {} tache(s) du carnet restent bloquees",
                open_count
            ),
        );
        return AgentDirective::Blocked;
    }

    agent.next_task_id = choose_next_work_item_id(agent, agent.next_task_id.as_deref());
    push_event(
        agent,
        now,
        "completion_deferred",
        format!(
            "Conclusion reportee : {} tache(s) du carnet restent a traiter",
            open_count
        ),
    );
    AgentDirective::Continue
}

fn upsert_validation_repair_task(
    agent: &mut AutonomousAgentSnapshot,
    output: &str,
    updated_at: i64,
) {
    let id = "validation-repair".to_string();
    let task = AutonomousWorkItem {
        id: id.clone(),
        status: AutonomousWorkItemStatus::Todo,
        domain: "Validation finale".to_string(),
        description:
            "Corriger la cause de la derniere validation echouee et relancer la commande configuree"
                .to_string(),
        evidence: Some(
            output
                .chars()
                .take(MAX_WORK_ITEM_EVIDENCE_CHARS)
                .collect::<String>(),
        ),
        updated_at,
    };
    if let Some(existing) = agent.work_items.iter_mut().find(|item| item.id == id) {
        *existing = task;
    } else {
        if agent.work_items.len() >= MAX_WORK_ITEMS {
            if let Some(index) = agent.work_items.iter().position(|item| {
                matches!(
                    item.status,
                    AutonomousWorkItemStatus::Done | AutonomousWorkItemStatus::Cancelled
                )
            }) {
                agent.work_items.remove(index);
            }
        }
        if agent.work_items.len() < MAX_WORK_ITEMS {
            agent.work_items.push(task);
        }
    }
    agent.next_task_id = Some(id);
}

fn autonomous_status_protocol(status: AutonomousAgentStatus) -> &'static str {
    match status {
        AutonomousAgentStatus::Active => "active",
        AutonomousAgentStatus::Paused => "paused",
        AutonomousAgentStatus::Completed => "completed",
        AutonomousAgentStatus::NeedsAttention => "needs_attention",
    }
}

fn test_status_protocol(status: AutonomousTestStatus) -> &'static str {
    match status {
        AutonomousTestStatus::NotConfigured => "not_configured",
        AutonomousTestStatus::Idle => "idle",
        AutonomousTestStatus::Running => "running",
        AutonomousTestStatus::Passed => "passed",
        AutonomousTestStatus::Failed => "failed",
        AutonomousTestStatus::Cancelled => "cancelled",
    }
}

fn trigger_kind_protocol(trigger_kind: AutonomousTriggerKind) -> &'static str {
    match trigger_kind {
        AutonomousTriggerKind::Schedule => "schedule",
        AutonomousTriggerKind::WorkspaceChange => "workspace_change",
    }
}

fn render_system_supervisor_context(store: &AutonomousAgentStore, now: i64) -> String {
    let agents = store
        .agents
        .iter()
        .filter(|agent| !agent_is_system_supervisor(agent))
        .collect::<Vec<_>>();
    let enabled_count = agents
        .iter()
        .filter(|agent| agent_keeps_supervisor_enabled(agent))
        .count();
    let mut context = format!(
        "ETAT DE FLOTTE FOURNI PAR L'ORDONNANCEUR (timestamp {now}) :\n- {} agent(s) utilisateur au total ; {} actif(s) ou en attention.\n",
        agents.len(), enabled_count
    );
    for agent in agents {
        let objective = agent.objective.chars().take(600).collect::<String>();
        let last_error = agent
            .last_error
            .as_deref()
            .map(|value| value.chars().take(1_200).collect::<String>())
            .unwrap_or_else(|| "aucune".to_string());
        let last_summary = agent
            .last_summary
            .as_deref()
            .map(|value| value.chars().take(1_200).collect::<String>())
            .unwrap_or_else(|| "aucun".to_string());
        let test_failure = agent
            .last_test_output
            .as_deref()
            .filter(|_| agent.test_status == AutonomousTestStatus::Failed)
            .map(|value| value.chars().take(1_600).collect::<String>())
            .unwrap_or_else(|| "aucune".to_string());
        let trigger_error = agent
            .trigger_error
            .as_deref()
            .map(|value| value.chars().take(1_200).collect::<String>())
            .unwrap_or_else(|| "aucune".to_string());
        context.push_str(&format!(
            "\nAGENT {} — {}\n  statut={} ; compte={} ; dossier={}\n  declencheur={} ; chemins_surveillance={:?} ; derniere_detection={:?} ; erreur_declencheur={}\n  execution: tour={:?}, demarrage={:?}, test={:?}, prochaine={:?}, intervalle={}s\n  compteurs: tentatives={}, tours_reussis={}, echecs_consecutifs={}, echecs_tests={}\n  validation={} ; review_en_attente={}\n  objectif: {}\n  derniere_erreur: {}\n  dernier_resume: {}\n  derniere_sortie_test_echouee: {}\n",
            agent.id,
            agent.name,
            autonomous_status_protocol(agent.status),
            agent.account_id,
            agent.project_dir.as_deref().unwrap_or("non configure"),
            trigger_kind_protocol(agent.trigger_kind),
            &agent.watch_paths,
            agent.last_trigger_message.as_deref(),
            trigger_error,
            agent.current_turn_id,
            agent.current_start_id,
            agent.current_test_id,
            agent.next_run_at,
            agent.interval_seconds,
            agent.attempt_count,
            agent.run_count,
            agent.consecutive_failures,
            agent.consecutive_test_failures,
            test_status_protocol(agent.test_status),
            agent.pending_review.is_some(),
            objective,
            last_error,
            last_summary,
            test_failure,
        ));
        if context.chars().count() >= 24_000 {
            context = context.chars().take(24_000).collect();
            context.push_str("\n[etat de flotte tronque a 24000 caracteres]");
            break;
        }
    }
    context.push_str(
        "\nCONSIGNES DE SUPERVISION : traite en priorite les erreurs, tests echoues, planifications incoherentes et regressions du moteur autonome. Une pause, une fin de mission ou une review en attente est un etat volontaire a respecter, pas un bug a contourner. Ne modifie jamais le fichier d'etat persistant. Pour un bug logiciel confirme, travaille dans le dossier projet indique, preserve les changements existants et valide la correction. Choisis une seule correction bornee par passage ; si tout est sain, consigne la preuve du controle puis attends le prochain cycle horaire avec AUTONOMOUS_STATUS: continue.",
    );
    context
}

fn autonomous_prompt(agent: &AutonomousAgentSnapshot) -> String {
    autonomous_prompt_with_context(agent, None)
}

fn autonomous_prompt_with_context(
    agent: &AutonomousAgentSnapshot,
    system_context: Option<&str>,
) -> String {
    let objective = agent.objective.trim();
    let role = agent
        .role
        .as_deref()
        .map(|role| format!("\n\nRole et cadre de travail :\n{role}"))
        .unwrap_or_default();
    let system_context = system_context
        .map(|context| format!("\n\n{context}"))
        .unwrap_or_default();
    let event_context = if agent.trigger_kind == AutonomousTriggerKind::WorkspaceChange {
        let watched = agent.watch_paths.join(", ");
        let event = agent
            .last_trigger_message
            .as_deref()
            .unwrap_or("Execution manuelle demandee pendant la veille");
        format!(
            "\n\nDECLENCHEUR EVENEMENTIEL : cet agent dort entre les evenements et se rearme automatiquement apres une reussite. Evenement courant : {event}. Chemins surveilles : {watched}. Traite uniquement cet evenement. Emets AUTONOMOUS_STATUS: complete quand cette occurrence est entierement traitee et verifiee ; le moteur remettra alors l'agent en veille au lieu de terminer sa mission durable."
        )
    } else {
        String::new()
    };
    let publication_permission = if agent.allow_git_publish {
        "\n\nAUTORISATION EXPLICITE GIT ET PUBLICATION : la configuration de cet agent autorise, pour son objectif et le depot courant uniquement, la creation d'un commit, `git push origin HEAD` sans force et l'execution des commandes de deploiement deja prevues par le projet. Verifie les changements, les tests, la branche distante et la sante du site. Cette autorisation n'inclut jamais force push, suppression de branche ou de donnees, rotation/exposition de secrets, publication d'un fichier sensible, changement de depot ou depense. En cas d'ambiguite sur le contenu a publier ou la cible, bloque le cycle et demande une decision."
            .to_string()
    } else {
        "\n\nPUBLICATION EXTERNE NON AUTORISEE : ne cree aucun push Git et ne deploie aucun site avec cette configuration. Une action de publication exige une autorisation explicite dans la fiche de l'agent."
            .to_string()
    };
    let memory = if agent.memory.is_empty() {
        String::new()
    } else {
        let mut remaining = MAX_PROMPT_MEMORY_CHARS;
        let mut selected = Vec::new();
        for entry in agent.memory.iter().rev().take(24) {
            let prefix = format!("- [{}] ", memory_kind_label(entry.kind));
            let content_budget = remaining.saturating_sub(prefix.chars().count());
            if content_budget == 0 {
                break;
            }
            let content = entry
                .content
                .chars()
                .take(content_budget)
                .collect::<String>();
            let line = format!("{prefix}{content}");
            remaining = remaining.saturating_sub(line.chars().count());
            selected.push(line);
        }
        selected.reverse();
        let entries = selected.join("\n");
        format!("\n\nMemoire durable de l'agent (faits et decisions deja conserves) :\n{entries}")
    };
    let work_plan = render_work_plan_for_prompt(agent);
    let validation = agent
        .test_command
        .as_deref()
        .map(|command| {
            let failure = agent
                .last_test_output
                .as_deref()
                .filter(|_| agent.test_status == AutonomousTestStatus::Failed)
                .map(|output| {
                    format!(
                        "\nDerniere validation echouee (corrige cette cause avant de conclure) :\n{}",
                        output.chars().take(8_000).collect::<String>()
                    )
                })
                .unwrap_or_default();
            format!(
                "\n\nValidation finale configuree : `{command}` (timeout {} s). Quand tu declares complete, le moteur execute reellement cette commande et ne termine l'objectif que si elle reussit.{failure}",
                agent.test_timeout_seconds
            )
        })
        .unwrap_or_default();
    let connectors = if agent.connectors.is_empty() {
        "\n\nACCES AUX SERVICES EXTERNES : aucun connecteur n'est autorise pour cet agent. N'utilise aucune app ou integration externe, meme si elle apparait dans la configuration globale du compte."
            .to_string()
    } else {
        let labels = agent
            .connectors
            .iter()
            .map(|connector| match connector {
                ChatAppConnector::Gmail => "Gmail",
                ChatAppConnector::GoogleCalendar => "Google Agenda",
            })
            .collect::<Vec<_>>()
            .join(", ");
        format!(
            "\n\nACCES AUX SERVICES EXTERNES AUTORISES : {labels}. Utilise uniquement les outils des connecteurs de cette liste. Les lectures et recherches peuvent etre realisees de facon autonome. Avant d'envoyer un message, creer ou modifier un evenement, ou effectuer toute autre ecriture externe, n'appelle pas encore l'outil : termine le tour avec AUTONOMOUS_STATUS: blocked, AUTONOMOUS_REVIEW_KIND: approval, AUTONOMOUS_REVIEW_EXTERNAL: true et une AUTONOMOUS_REVIEW decrivant exactement l'action, le destinataire ou calendrier, le contenu utile et l'impact. Une autorisation est valable pour cette action et un seul tour. Les suppressions restent interdites. Si un connecteur est absent ou non authentifie, demande son installation ou sa connexion dans le compte Codex selectionne ; ne demande jamais de mot de passe ou de jeton et ne contourne pas le connecteur par du scraping navigateur."
        )
    };
    let review_gate = if let Some(review) = agent.approved_review.as_ref() {
        format!(
            "\n\nAUTORISATION UTILISATEUR VALABLE POUR CE TOUR UNIQUEMENT :\n{}\nApplique uniquement cette tranche autorisee, verifie le resultat, puis considere cette autorisation comme consommee. Toute autre modification devra faire l'objet d'une nouvelle review.",
            review.request
        )
    } else if agent.require_user_review {
        "\n\nGARDE-FOU REVIEW UTILISATEUR ACTIF : ce tour est force en mode Plan et ne doit modifier aucun fichier, lancer aucune commande destructive ni appliquer aucun changement. Inspecte l'environnement, prepare la tranche de changements exacte et les validations prevues, puis termine obligatoirement avec AUTONOMOUS_STATUS: blocked, AUTONOMOUS_REVIEW_KIND: approval et AUTONOMOUS_REVIEW: suivi du plan precis, de son impact et de son risque. L'application ne sera autorisee qu'apres le clic explicite de l'utilisateur."
            .to_string()
    } else {
        String::new()
    };
    let protocol = r#"CST_AUTONOMOUS_AGENT_SESSION: true

PILOTAGE OBLIGATOIRE DE CHAQUE BOUCLE :
Avant toute action, relis l'objectif, la memoire durable, le carnet de travail et l'etat reel. Puis :
1. decide quelles informations stables meritent d'etre conservees et lesquelles sont seulement du bruit temporaire ;
2. cree ou actualise une decomposition en domaines non redondants et en taches bornees, chacune avec un resultat verifiable ;
3. reconcilie les taches deja faites avec leurs preuves et les taches encore a faire ;
4. choisis exactement une prochaine tache utile et sure, puis execute cette tranche sans refaire un domaine deja valide.
Pour un objectif de recherche de bugs, le domaine est une surface de test : conserve explicitement les surfaces testees avec leur preuve et les surfaces restant a tester.

Le carnet est persistant et fusionne par identifiant stable. A la fin du tour, emets sa mise a jour avec ce protocole (le caractere | separe les champs) :
AUTONOMOUS_MEMORY_STRATEGY: informations a retenir, niveau de preuve exige et informations a ne pas stocker
AUTONOMOUS_TASK: identifiant-stable | todo, in_progress, done, blocked ou cancelled | domaine | tache bornee et resultat attendu | preuve concise ou vide
AUTONOMOUS_NEXT_TASK: identifiant-stable
Au premier tour, la strategie, toutes les taches connues et la prochaine tache sont obligatoires. Aux tours suivants, emets au minimum les taches creees ou modifiees et la prochaine tache. Utilise AUTONOMOUS_NEXT_TASK: none seulement s'il ne reste reellement aucune tache. Ne marque done qu'avec une preuve concrete (test, mesure, fichier, observation ou resultat).

Si tu apprends un fait stable utile aux prochains tours, ajoute une ou plusieurs lignes :
AUTONOMOUS_MEMORY: fait ou decision concise a conserver
La memoire libre contient les faits et decisions durables ; l'avancement, les domaines faits/a faire et les preuves appartiennent au carnet de travail. N'y place jamais de secret, token, mot de passe ou donnee personnelle inutile.

A la fin de ce tour, ajoute exactement une ligne de controle :
AUTONOMOUS_STATUS: continue
ou AUTONOMOUS_STATUS: complete si l'objectif est entierement atteint et verifie,
ou AUTONOMOUS_STATUS: blocked si une decision, un secret ou une autorisation humaine est indispensable.

Si et seulement si le statut est blocked, ajoute aussi ces trois lignes afin que l'interface affiche exactement ce qui doit etre examine :
AUTONOMOUS_REVIEW_KIND: approval, decision ou verification
AUTONOMOUS_REVIEW_EXTERNAL: true uniquement si l'autorisation porte sur une ecriture Gmail ou Google Agenda, sinon false
AUTONOMOUS_REVIEW: action ou question precise, impact attendu et risque principal, sans aucun secret"#;

    if agent.session_id.is_none() && agent.run_count == 0 {
        format!(
            "Tu ouvres un chat de type agent autonome nomme « {} », execute par un ordonnanceur persistant.\n\nObjectif durable :\n{objective}{role}{system_context}{event_context}{publication_permission}{memory}{work_plan}{validation}{connectors}{review_gate}\n\nCree un goal avec l'outil create_goal s'il est disponible, puis commence immediatement a le poursuivre. Commence par le cycle de pilotage obligatoire : definis la strategie de memoire, segmente l'objectif et choisis la premiere tache avant de l'executer. Travaille par etapes mesurables et verifiables dans le dossier fourni. Mesure l'etat avant/apres lorsque l'objectif concerne les performances ou les ressources. Respecte les changements deja presents. N'effectue aucune publication, depense, suppression de donnees utilisateur, rotation de secret ou autre action externe irreversible sans l'autorisation explicite correspondante ci-dessus. Si le travail peut continuer sans intervention, ne pose pas de question et choisis l'etape sure la plus utile.\n\n{protocol}",
            agent.name
        )
    } else {
        format!(
            "Poursuis de maniere autonome l'objectif durable de cette conversation :\n\n{objective}{role}{system_context}{event_context}{publication_permission}{memory}{work_plan}{validation}{connectors}{review_gate}\n\nCommence par reconcilier le carnet avec l'etat reel et confirme ou remplace la prochaine tache. Realise ensuite une seule tranche utile, sure et verifiable. Evite de refaire un travail deja valide. N'effectue aucune action externe irreversible sans l'autorisation explicite correspondante ci-dessus.\n\n{protocol}"
        )
    }
}

fn directive_from_snapshot(snapshot: &ChatTurnSnapshot) -> AgentDirective {
    let mut texts = snapshot
        .parts
        .iter()
        .filter_map(|part| part.text.as_deref())
        .collect::<Vec<_>>();
    texts.extend(
        snapshot
            .thoughts
            .iter()
            .map(|thought| thought.text.as_str()),
    );
    directive_from_text(&texts.join("\n"))
}

fn directive_from_text(text: &str) -> AgentDirective {
    text.lines()
        .rev()
        .find_map(|line| {
            let normalized = line.trim().to_ascii_lowercase();
            let value = normalized.strip_prefix("autonomous_status:")?.trim();
            match value {
                "complete" => Some(AgentDirective::Complete),
                "blocked" => Some(AgentDirective::Blocked),
                "continue" => Some(AgentDirective::Continue),
                _ => None,
            }
        })
        .unwrap_or(AgentDirective::Continue)
}

fn protocol_value_from_snapshot(
    snapshot: &ChatTurnSnapshot,
    key: &str,
    max_chars: usize,
) -> Option<String> {
    snapshot
        .parts
        .iter()
        .filter_map(|part| part.text.as_deref())
        .chain(
            snapshot
                .thoughts
                .iter()
                .map(|thought| thought.text.as_str()),
        )
        .flat_map(str::lines)
        .filter_map(|line| {
            let (candidate, value) = line.trim().split_once(':')?;
            candidate
                .trim()
                .eq_ignore_ascii_case(key)
                .then_some(value.trim())
        })
        .filter(|value| !value.is_empty())
        .next_back()
        .map(|value| value.chars().take(max_chars).collect::<String>())
}

fn review_from_snapshot(
    snapshot: &ChatTurnSnapshot,
    created_at: i64,
    fallback: Option<&str>,
) -> AutonomousReviewRequest {
    let kind = match protocol_value_from_snapshot(snapshot, "AUTONOMOUS_REVIEW_KIND", 32)
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "decision" => AutonomousReviewKind::Decision,
        "verification" => AutonomousReviewKind::Verification,
        _ => AutonomousReviewKind::Approval,
    };
    let request = protocol_value_from_snapshot(snapshot, "AUTONOMOUS_REVIEW", MAX_REVIEW_CHARS)
        .or_else(|| fallback.map(|value| value.chars().take(MAX_REVIEW_CHARS).collect::<String>()))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "Examiner la demande de l'agent avant de poursuivre".to_string());
    let external_action = protocol_value_from_snapshot(snapshot, "AUTONOMOUS_REVIEW_EXTERNAL", 16)
        .is_some_and(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "true" | "1" | "yes"
            )
        });
    AutonomousReviewRequest {
        id: Uuid::new_v4().to_string(),
        kind,
        request,
        created_at,
        external_action,
    }
}

fn memories_from_snapshot(snapshot: &ChatTurnSnapshot) -> Vec<String> {
    let mut memories = Vec::new();
    let texts = snapshot
        .parts
        .iter()
        .filter_map(|part| part.text.as_deref())
        .chain(
            snapshot
                .thoughts
                .iter()
                .map(|thought| thought.text.as_str()),
        );
    for line in texts.flat_map(str::lines) {
        let trimmed = line.trim();
        if !trimmed
            .to_ascii_lowercase()
            .starts_with("autonomous_memory:")
        {
            continue;
        }
        let content = trimmed
            .split_once(':')
            .map(|(_, content)| content.trim())
            .unwrap_or_default()
            .chars()
            .take(MAX_MEMORY_CHARS)
            .collect::<String>();
        if !content.is_empty() && !memories.iter().any(|known| known == &content) {
            memories.push(content);
        }
        if memories.len() >= MAX_MEMORY_ENTRIES {
            break;
        }
    }
    memories
}

fn summary_from_snapshot(snapshot: &ChatTurnSnapshot) -> Option<String> {
    let raw = snapshot
        .parts
        .iter()
        .rev()
        .filter_map(|part| part.text.as_deref())
        .find(|text| !text.trim().is_empty())
        .or_else(|| {
            snapshot
                .thoughts
                .iter()
                .rev()
                .map(|thought| thought.text.as_str())
                .find(|text| !text.trim().is_empty())
        })?;
    let cleaned = raw
        .lines()
        .filter(|line| {
            let normalized = line.trim().to_ascii_lowercase();
            !normalized.starts_with("autonomous_status:")
                && !normalized.starts_with("autonomous_memory:")
                && !normalized.starts_with("autonomous_memory_strategy:")
                && !normalized.starts_with("autonomous_task:")
                && !normalized.starts_with("autonomous_next_task:")
                && !normalized.starts_with("autonomous_review:")
                && !normalized.starts_with("autonomous_review_kind:")
                && !normalized.starts_with("autonomous_review_external:")
        })
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .chars()
        .take(MAX_SUMMARY_CHARS)
        .collect::<String>();
    (!cleaned.is_empty()).then_some(cleaned)
}

fn validate_objective(value: &str) -> Result<String, String> {
    let objective = value.trim();
    if objective.is_empty() {
        return Err("L'objectif autonome est vide".to_string());
    }
    if objective.len() > MAX_OBJECTIVE_BYTES {
        return Err("L'objectif autonome est trop volumineux".to_string());
    }
    Ok(objective.to_string())
}

fn validate_agent_name(value: Option<&str>, objective: &str) -> Result<String, String> {
    let provided = value.map(str::trim).filter(|name| !name.is_empty());
    if let Some(name) = provided {
        if name.chars().count() > MAX_AGENT_NAME_CHARS {
            return Err(format!(
                "Le nom de l'agent depasse {MAX_AGENT_NAME_CHARS} caracteres"
            ));
        }
        return Ok(name.to_string());
    }
    Ok(default_agent_name(objective))
}

fn default_agent_name(objective: &str) -> String {
    let name = objective
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("Agent autonome")
        .trim()
        .chars()
        .take(60)
        .collect::<String>();
    if name.is_empty() {
        "Agent autonome".to_string()
    } else {
        name
    }
}

fn validate_optional_text(
    value: Option<String>,
    max_chars: usize,
    label: &str,
) -> Result<Option<String>, String> {
    let value = normalize_optional(value);
    if value
        .as_ref()
        .is_some_and(|value| value.chars().count() > max_chars)
    {
        return Err(format!("{label} depasse {max_chars} caracteres"));
    }
    Ok(value)
}

fn validate_memory(value: &str) -> Result<String, String> {
    let memory = value.trim();
    if memory.is_empty() {
        return Err("La memoire a ajouter est vide".to_string());
    }
    if memory.chars().count() > MAX_MEMORY_CHARS {
        return Err(format!("La memoire depasse {MAX_MEMORY_CHARS} caracteres"));
    }
    Ok(memory.to_string())
}

fn validate_interval(value: u64) -> Result<u64, String> {
    if !(MIN_INTERVAL_SECONDS..=MAX_INTERVAL_SECONDS).contains(&value) {
        return Err(format!(
            "L'intervalle doit etre compris entre {MIN_INTERVAL_SECONDS} et {MAX_INTERVAL_SECONDS} secondes"
        ));
    }
    Ok(value)
}

fn default_debounce_seconds() -> u64 {
    DEFAULT_DEBOUNCE_SECONDS
}

fn validate_debounce_seconds(value: u64) -> Result<u64, String> {
    if !(MIN_DEBOUNCE_SECONDS..=MAX_DEBOUNCE_SECONDS).contains(&value) {
        return Err(format!(
            "La stabilisation des changements doit etre comprise entre {MIN_DEBOUNCE_SECONDS} et {MAX_DEBOUNCE_SECONDS} secondes"
        ));
    }
    Ok(value)
}

fn validate_watch_paths(
    values: Vec<String>,
    trigger_kind: AutonomousTriggerKind,
) -> Result<Vec<String>, String> {
    if trigger_kind == AutonomousTriggerKind::Schedule {
        return Ok(Vec::new());
    }
    if values.len() > MAX_WATCH_PATHS {
        return Err(format!(
            "La veille accepte au maximum {MAX_WATCH_PATHS} chemins"
        ));
    }

    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim().replace('\\', "/");
        let value = value.strip_prefix("./").unwrap_or(&value).trim_matches('/');
        if value.is_empty() {
            continue;
        }
        if value.chars().count() > MAX_WATCH_PATH_CHARS {
            return Err(format!(
                "Un chemin de veille depasse {MAX_WATCH_PATH_CHARS} caracteres"
            ));
        }
        let path = Path::new(value);
        if value.contains('\0')
            || value.split('/').any(|component| component == "..")
            || path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(format!(
                "Le chemin de veille doit rester relatif au projet : {value}"
            ));
        }
        if !normalized.iter().any(|existing| existing == value) {
            normalized.push(value.to_string());
        }
    }
    if normalized.is_empty() {
        return Err("Ajoute au moins un fichier ou dossier a surveiller".to_string());
    }
    Ok(normalized)
}

fn validate_git_publication_baseline(project_dir: &Path) -> Result<(), String> {
    let status = git_output(
        project_dir,
        &["status", "--porcelain=v1", "--untracked-files=all"],
    )?;
    if !status.trim().is_empty() {
        let count = status.lines().count();
        return Err(format!(
            "L'auto-publication exige un depot propre au moment de l'armement ({count} changement(s) present(s)). Commit ou mets de cote ces changements, puis rearme l'agent."
        ));
    }
    let branch = git_output(project_dir, &["symbolic-ref", "--quiet", "--short", "HEAD"])?;
    if branch.trim().is_empty() {
        return Err(
            "L'auto-publication exige une branche Git active, pas un HEAD detache".to_string(),
        );
    }
    let remote = git_output(project_dir, &["remote", "get-url", "origin"])?;
    if remote.trim().is_empty() {
        return Err("Le depot ne possede aucun remote Git 'origin'".to_string());
    }
    Ok(())
}

fn git_output(project_dir: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    command.arg("-C").arg(project_dir).args(args);
    hide_process_window(&mut command);
    let output = command
        .output()
        .map_err(|error| format!("Impossible de lancer Git : {error}"))?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        return Err(if detail.is_empty() {
            "La verification Git de l'auto-publication a echoue".to_string()
        } else {
            format!("La verification Git de l'auto-publication a echoue : {detail}")
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn workspace_fingerprint(project_dir: &Path, watch_paths: &[String]) -> Result<String, String> {
    if !project_dir.is_dir() {
        return Err(format!(
            "Le dossier projet n'existe pas ou n'est pas un dossier : {}",
            project_dir.display()
        ));
    }

    let mut hasher = Sha256::new();
    hasher.update(b"cst-workspace-watch-v1\0");
    let mut visited = 0_usize;
    for watch_path in watch_paths {
        hasher.update(watch_path.as_bytes());
        hasher.update(b"\0");
        let relative = watch_path
            .split('/')
            .fold(PathBuf::new(), |path, component| path.join(component));
        hash_workspace_entry(
            project_dir,
            &project_dir.join(relative),
            &mut hasher,
            &mut visited,
        )?;
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn hash_workspace_entry(
    root: &Path,
    path: &Path,
    hasher: &mut Sha256,
    visited: &mut usize,
) -> Result<(), String> {
    *visited = visited.saturating_add(1);
    if *visited > MAX_WATCH_FILES {
        return Err(format!(
            "La veille depasse {MAX_WATCH_FILES} fichiers ; reduis les chemins surveilles"
        ));
    }

    let relative = path.strip_prefix(root).unwrap_or(path);
    let relative = relative.to_string_lossy().replace('\\', "/");
    hasher.update(relative.as_bytes());
    hasher.update(b"\0");
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            hasher.update(b"missing\0");
            return Ok(());
        }
        Err(error) => {
            return Err(format!(
                "Impossible de lire le chemin surveille {} : {error}",
                path.display()
            ));
        }
    };

    if metadata.file_type().is_symlink() {
        hasher.update(b"symlink\0");
        let target = fs::read_link(path).map_err(|error| {
            format!(
                "Impossible de lire le lien surveille {} : {error}",
                path.display()
            )
        })?;
        hasher.update(target.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        return Ok(());
    }

    if metadata.is_dir() {
        hasher.update(b"dir\0");
        let mut entries = fs::read_dir(path)
            .map_err(|error| format!("Impossible de lire {} : {error}", path.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("Impossible de lire {} : {error}", path.display()))?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            hash_workspace_entry(root, &entry.path(), hasher, visited)?;
        }
        return Ok(());
    }

    hasher.update(b"file\0");
    hasher.update(metadata.len().to_le_bytes());
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Impossible d'ouvrir {} : {error}", path.display()))?;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Impossible de lire {} : {error}", path.display()))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(())
}

fn default_test_timeout_seconds() -> u64 {
    DEFAULT_TEST_TIMEOUT_SECONDS
}

fn validate_test_timeout(value: u64) -> Result<u64, String> {
    if !(MIN_TEST_TIMEOUT_SECONDS..=MAX_TEST_TIMEOUT_SECONDS).contains(&value) {
        return Err(format!(
            "Le timeout de test doit etre compris entre {MIN_TEST_TIMEOUT_SECONDS} et {MAX_TEST_TIMEOUT_SECONDS} secondes"
        ));
    }
    Ok(value)
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn normalize_connectors(values: Vec<ChatAppConnector>) -> Vec<ChatAppConnector> {
    [ChatAppConnector::Gmail, ChatAppConnector::GoogleCalendar]
        .into_iter()
        .filter(|connector| values.contains(connector))
        .collect()
}

fn find_agent_mut<'a>(
    store: &'a mut AutonomousAgentStore,
    id: &str,
) -> Result<&'a mut AutonomousAgentSnapshot, String> {
    store
        .agents
        .iter_mut()
        .find(|agent| agent.id == id)
        .ok_or_else(|| "Agent autonome introuvable".to_string())
}

fn ensure_user_managed_agent(agent: &AutonomousAgentSnapshot) -> Result<(), String> {
    if agent_is_system_supervisor(agent) {
        return Err(
            "Le superviseur systeme est gere automatiquement tant qu'un agent autonome est active"
                .to_string(),
        );
    }
    Ok(())
}

fn push_event(agent: &mut AutonomousAgentSnapshot, timestamp: i64, kind: &str, message: String) {
    agent.events.push(AutonomousAgentEvent {
        timestamp,
        kind: kind.to_string(),
        message,
    });
    if agent.events.len() > MAX_EVENTS {
        agent.events.drain(0..agent.events.len() - MAX_EVENTS);
    }
}

fn new_memory_entry(
    kind: AutonomousMemoryKind,
    content: String,
    created_at: i64,
) -> AutonomousMemoryEntry {
    AutonomousMemoryEntry {
        id: Uuid::new_v4().to_string(),
        kind,
        content,
        created_at,
    }
}

fn push_memory(
    agent: &mut AutonomousAgentSnapshot,
    kind: AutonomousMemoryKind,
    content: String,
    created_at: i64,
) -> bool {
    let content = content
        .trim()
        .chars()
        .take(MAX_MEMORY_CHARS)
        .collect::<String>();
    if content.is_empty()
        || agent
            .memory
            .iter()
            .any(|entry| entry.content.eq_ignore_ascii_case(&content))
    {
        return false;
    }
    if agent.memory.len() >= MAX_MEMORY_ENTRIES {
        let removable = agent
            .memory
            .iter()
            .position(|entry| entry.kind != AutonomousMemoryKind::User)
            .unwrap_or(0);
        agent.memory.remove(removable);
    }
    agent
        .memory
        .push(new_memory_entry(kind, content, created_at));
    true
}

fn memory_kind_label(kind: AutonomousMemoryKind) -> &'static str {
    match kind {
        AutonomousMemoryKind::User => "utilisateur",
        AutonomousMemoryKind::Agent => "agent",
        AutonomousMemoryKind::Test => "test",
    }
}

fn normalize_loaded_work_plan(agent: &mut AutonomousAgentSnapshot) -> bool {
    let previous_strategy = agent.memory_strategy.clone();
    let previous_items = agent.work_items.clone();
    let previous_next = agent.next_task_id.clone();

    agent.memory_strategy = agent
        .memory_strategy
        .take()
        .map(|value| {
            value
                .trim()
                .chars()
                .take(MAX_MEMORY_STRATEGY_CHARS)
                .collect::<String>()
        })
        .filter(|value| !value.is_empty());

    let mut normalized_items: Vec<AutonomousWorkItem> = Vec::new();
    for mut item in std::mem::take(&mut agent.work_items) {
        let Some(id) = normalize_work_item_id(&item.id) else {
            continue;
        };
        item.id = id.clone();
        item.domain = item
            .domain
            .trim()
            .chars()
            .take(MAX_WORK_ITEM_DOMAIN_CHARS)
            .collect();
        item.description = item
            .description
            .trim()
            .chars()
            .take(MAX_WORK_ITEM_DESCRIPTION_CHARS)
            .collect();
        item.evidence = item
            .evidence
            .take()
            .map(|value| {
                value
                    .trim()
                    .chars()
                    .take(MAX_WORK_ITEM_EVIDENCE_CHARS)
                    .collect::<String>()
            })
            .filter(|value| !value.is_empty());
        if item.status == AutonomousWorkItemStatus::Done && item.evidence.is_none() {
            item.status = AutonomousWorkItemStatus::InProgress;
        }
        if item.domain.is_empty() || item.description.is_empty() {
            continue;
        }
        if let Some(existing) = normalized_items.iter_mut().find(|known| known.id == id) {
            *existing = item;
        } else if normalized_items.len() < MAX_WORK_ITEMS {
            normalized_items.push(item);
        }
    }
    agent.work_items = normalized_items;
    let requested_next = agent
        .next_task_id
        .take()
        .and_then(|id| normalize_work_item_id(&id));
    agent.next_task_id = choose_next_work_item_id(agent, requested_next.as_deref());

    agent.memory_strategy != previous_strategy
        || agent.work_items != previous_items
        || agent.next_task_id != previous_next
}

fn normalize_loaded_store(store: &mut AutonomousAgentStore, now: i64) -> bool {
    let mut changed = store.version != STORE_VERSION;
    store.version = STORE_VERSION;
    for agent in &mut store.agents {
        if agent.session_id.take().is_some() {
            changed = true;
        }
        let loaded_connectors = std::mem::take(&mut agent.connectors);
        let normalized_connectors = normalize_connectors(loaded_connectors.clone());
        if loaded_connectors != normalized_connectors {
            changed = true;
        }
        agent.connectors = normalized_connectors;
        if agent.name.trim().is_empty() {
            agent.name = default_agent_name(&agent.objective);
            changed = true;
        }
        if agent.status == AutonomousAgentStatus::NeedsAttention
            && agent.pending_review.is_none()
            && agent
                .last_error
                .as_deref()
                .is_some_and(is_model_capacity_message)
        {
            agent.status = AutonomousAgentStatus::Active;
            agent.next_run_at = Some(now);
            agent.consecutive_failures = 0;
            agent.model_capacity_retry_count = 0;
            push_event(
                agent,
                now,
                "model_capacity_recovered",
                "Agent automatiquement repris apres une saturation du modele".to_string(),
            );
            changed = true;
        }
        if agent.status != AutonomousAgentStatus::NeedsAttention && agent.pending_review.is_some() {
            agent.pending_review = None;
            changed = true;
        }
        if (agent.status == AutonomousAgentStatus::Completed || agent.pending_review.is_some())
            && agent.approved_review.is_some()
        {
            agent.approved_review = None;
            changed = true;
        }
        if validate_test_timeout(agent.test_timeout_seconds).is_err() {
            agent.test_timeout_seconds = DEFAULT_TEST_TIMEOUT_SECONDS;
            changed = true;
        }
        if validate_debounce_seconds(agent.debounce_seconds).is_err() {
            agent.debounce_seconds = DEFAULT_DEBOUNCE_SECONDS;
            changed = true;
        }
        match agent.trigger_kind {
            AutonomousTriggerKind::Schedule => {
                let had_event_state = !agent.watch_paths.is_empty()
                    || agent.event_fingerprint.is_some()
                    || agent.event_candidate_fingerprint.is_some()
                    || agent.event_candidate_since.is_some()
                    || agent.trigger_error.is_some()
                    || agent.last_trigger_message.is_some();
                agent.watch_paths.clear();
                agent.event_fingerprint = None;
                agent.event_candidate_fingerprint = None;
                agent.event_candidate_since = None;
                agent.trigger_error = None;
                agent.last_trigger_message = None;
                if had_event_state {
                    changed = true;
                }
            }
            AutonomousTriggerKind::WorkspaceChange => {
                match validate_watch_paths(agent.watch_paths.clone(), agent.trigger_kind) {
                    Ok(paths) if paths != agent.watch_paths => {
                        agent.watch_paths = paths;
                        agent.event_fingerprint = None;
                        agent.event_candidate_fingerprint = None;
                        agent.event_candidate_since = None;
                        changed = true;
                    }
                    Ok(_) => {}
                    Err(error) => {
                        if agent.trigger_error.as_deref() != Some(error.as_str()) {
                            agent.trigger_error = Some(error);
                            changed = true;
                        }
                    }
                }
                if agent.event_fingerprint.is_none() && agent.trigger_error.is_none() {
                    let baseline = agent
                        .project_dir
                        .as_deref()
                        .ok_or_else(|| "Dossier projet absent".to_string())
                        .and_then(|path| {
                            workspace_fingerprint(Path::new(path), &agent.watch_paths)
                        });
                    match baseline {
                        Ok(fingerprint) => {
                            agent.event_fingerprint = Some(fingerprint);
                            changed = true;
                        }
                        Err(error) => {
                            agent.trigger_error = Some(error);
                            changed = true;
                        }
                    }
                }
            }
        }
        let memory_count = agent.memory.len();
        agent
            .memory
            .retain(|entry| !entry.content.trim().is_empty());
        if agent.memory.len() != memory_count {
            changed = true;
        }
        if agent.memory.len() > MAX_MEMORY_ENTRIES {
            agent
                .memory
                .drain(0..agent.memory.len() - MAX_MEMORY_ENTRIES);
            changed = true;
        }
        if normalize_loaded_work_plan(agent) {
            changed = true;
        }
        let interrupted_test = agent.current_test_id.take().is_some()
            || agent.test_status == AutonomousTestStatus::Running;
        if interrupted_test {
            agent.test_status = AutonomousTestStatus::Cancelled;
            agent.test_completion_pending = false;
            agent.last_test_finished_at = Some(now);
            agent.last_error = Some(
                "Validation interrompue par le redemarrage ; elle sera relancee apres reprise"
                    .to_string(),
            );
            push_event(
                agent,
                now,
                "test_recovered",
                "Validation interrompue detectee au redemarrage".to_string(),
            );
            changed = true;
        }
        if agent.test_command.is_none() {
            if agent.test_status != AutonomousTestStatus::NotConfigured {
                agent.test_status = AutonomousTestStatus::NotConfigured;
                changed = true;
            }
            agent.test_completion_pending = false;
        } else if agent.test_status == AutonomousTestStatus::NotConfigured {
            agent.test_status = AutonomousTestStatus::Idle;
            changed = true;
        }
        if agent.status == AutonomousAgentStatus::Active {
            let had_turn = agent.current_turn_id.take().is_some();
            let had_start = agent.current_start_id.take().is_some();
            if had_turn || had_start {
                push_event(
                    agent,
                    now,
                    "recovered",
                    "Processus interrompu detecte ; agent replanifie apres redemarrage".to_string(),
                );
                changed = true;
            }
            if (had_turn || had_start || interrupted_test) && agent.next_run_at.is_none() {
                agent.next_run_at = Some(now);
                changed = true;
            } else if agent.trigger_kind == AutonomousTriggerKind::Schedule
                && agent.next_run_at.is_none()
            {
                agent.next_run_at = Some(now);
                changed = true;
            }
        } else {
            let had_turn = agent.current_turn_id.take().is_some();
            let had_start = agent.current_start_id.take().is_some();
            let had_schedule = agent.next_run_at.take().is_some();
            if had_turn || had_start || had_schedule {
                changed = true;
            }
        }
    }
    changed
}

fn load_store(path: &Path) -> Result<AutonomousAgentStore, String> {
    if !path.exists() {
        return Ok(AutonomousAgentStore::default());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    match serde_json::from_str::<AutonomousAgentStore>(&content) {
        Ok(store) if store.version <= STORE_VERSION => Ok(store),
        Ok(store) => Err(format!(
            "Version d'etat des agents autonomes non supportee : {}",
            store.version
        )),
        Err(error) => {
            let backup = path.with_extension(format!("corrupt-{}.json", metrics::now_ts()));
            fs::rename(path, &backup).map_err(|rename_error| {
                format!(
                    "Etat des agents autonomes illisible ({error}) et sauvegarde impossible ({rename_error})"
                )
            })?;
            eprintln!(
                "[autonomous] etat illisible deplace vers {}: {error}",
                backup.display()
            );
            Ok(AutonomousAgentStore::default())
        }
    }
}

fn persist_store(path: &Path, store: &AutonomousAgentStore) -> Result<(), String> {
    let content = serde_json::to_string_pretty(store).map_err(|error| error.to_string())?;
    fs_util::atomic_write(path, content).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn list_autonomous_agents(
    state: State<'_, AutonomousAgentManager>,
) -> Result<Vec<AutonomousAgentSnapshot>, String> {
    state.list()
}

#[tauri::command]
pub fn create_autonomous_agent(
    state: State<'_, AutonomousAgentManager>,
    request: CreateAutonomousAgentRequest,
) -> Result<AutonomousAgentSnapshot, String> {
    state.create(request)
}

#[tauri::command]
pub fn update_autonomous_agent(
    state: State<'_, AutonomousAgentManager>,
    id: String,
    request: UpdateAutonomousAgentRequest,
) -> Result<AutonomousAgentSnapshot, String> {
    state.update(&id, request)
}

#[tauri::command]
pub fn control_autonomous_agent(
    state: State<'_, AutonomousAgentManager>,
    id: String,
    action: AutonomousAgentAction,
) -> Result<AutonomousAgentSnapshot, String> {
    state.control(&id, action)
}

#[tauri::command]
pub fn schedule_autonomous_agent(
    state: State<'_, AutonomousAgentManager>,
    id: String,
    next_run_at: i64,
    interval_seconds: Option<u64>,
) -> Result<AutonomousAgentSnapshot, String> {
    state.schedule(&id, next_run_at, interval_seconds)
}

#[tauri::command]
pub fn reassign_autonomous_agent_account(
    state: State<'_, AutonomousAgentManager>,
    id: String,
    request: ReassignAutonomousAgentAccountRequest,
) -> Result<AutonomousAgentSnapshot, String> {
    state.reassign_account(&id, request)
}

#[tauri::command]
pub fn add_autonomous_agent_memory(
    state: State<'_, AutonomousAgentManager>,
    id: String,
    content: String,
) -> Result<AutonomousAgentSnapshot, String> {
    state.add_memory(&id, &content)
}

#[tauri::command]
pub fn delete_autonomous_agent_memory(
    state: State<'_, AutonomousAgentManager>,
    id: String,
    memory_id: String,
) -> Result<AutonomousAgentSnapshot, String> {
    state.delete_memory(&id, &memory_id)
}

#[tauri::command]
pub fn delete_autonomous_agent(
    state: State<'_, AutonomousAgentManager>,
    id: String,
) -> Result<(), String> {
    state.delete(&id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::ChatPart;

    #[test]
    fn update_request_accepts_an_atomic_account_change() {
        let request: UpdateAutonomousAgentRequest = serde_json::from_value(serde_json::json!({
            "objective": "Nouvelle mission",
            "accountId": "account-target",
            "mode": "plan",
            "intervalSeconds": 3600
        }))
        .expect("valid update request");

        assert_eq!(request.account_id.as_deref(), Some("account-target"));
        assert_eq!(request.objective, "Nouvelle mission");
        assert_eq!(request.mode, ChatTurnMode::Plan);
        assert_eq!(request.interval_seconds, Some(3600));
    }

    fn sample_agent(status: AutonomousAgentStatus) -> AutonomousAgentSnapshot {
        AutonomousAgentSnapshot {
            id: "agent-1".to_string(),
            system_managed: false,
            name: "Optimiseur web".to_string(),
            objective: "Reduire les ressources de la page".to_string(),
            role: Some("Ingenieur performance".to_string()),
            source_chat_key: None,
            account_id: "account-1".to_string(),
            project_dir: Some("/project".to_string()),
            session_id: None,
            mode: ChatTurnMode::Build,
            model: None,
            reasoning_effort: None,
            connectors: Vec::new(),
            interval_seconds: 900,
            trigger_kind: AutonomousTriggerKind::Schedule,
            watch_paths: Vec::new(),
            debounce_seconds: DEFAULT_DEBOUNCE_SECONDS,
            allow_git_publish: false,
            event_fingerprint: None,
            event_candidate_fingerprint: None,
            event_candidate_since: None,
            last_triggered_at: None,
            last_trigger_message: None,
            trigger_error: None,
            status,
            created_at: 10,
            updated_at: 10,
            next_run_at: None,
            last_run_started_at: None,
            last_run_finished_at: None,
            current_turn_id: None,
            current_start_id: None,
            attempt_count: 0,
            run_count: 0,
            consecutive_failures: 0,
            model_capacity_retry_count: 0,
            last_error: None,
            last_summary: None,
            require_user_review: false,
            pending_review: None,
            approved_review: None,
            memory: Vec::new(),
            memory_strategy: None,
            work_items: Vec::new(),
            next_task_id: None,
            test_command: None,
            test_timeout_seconds: DEFAULT_TEST_TIMEOUT_SECONDS,
            test_status: AutonomousTestStatus::NotConfigured,
            current_test_id: None,
            test_completion_pending: false,
            consecutive_test_failures: 0,
            last_test_started_at: None,
            last_test_finished_at: None,
            last_test_exit_code: None,
            last_test_duration_ms: None,
            last_test_output: None,
            events: Vec::new(),
        }
    }

    #[test]
    fn system_supervisor_is_created_immediately_and_runs_hourly() {
        let mut store = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![sample_agent(AutonomousAgentStatus::Active)],
        };

        let (changed, maintenance) = reconcile_system_supervisor(&mut store, 100);

        assert!(changed);
        assert!(maintenance.turn_to_stop.is_none());
        let supervisor = store
            .agents
            .iter()
            .find(|agent| agent.id == SYSTEM_SUPERVISOR_ID)
            .expect("system supervisor");
        assert!(supervisor.system_managed);
        assert_eq!(supervisor.status, AutonomousAgentStatus::Active);
        assert_eq!(
            supervisor.interval_seconds,
            SYSTEM_SUPERVISOR_INTERVAL_SECONDS
        );
        assert_eq!(supervisor.next_run_at, Some(100));
        assert_eq!(supervisor.mode, ChatTurnMode::Build);
        assert!(!supervisor.require_user_review);
        assert_eq!(
            next_run_after_completed_step(supervisor, 100),
            Some(100 + SYSTEM_SUPERVISOR_INTERVAL_SECONDS as i64)
        );
    }

    #[test]
    fn system_supervisor_is_not_created_for_a_fully_inactive_fleet() {
        let mut store = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![sample_agent(AutonomousAgentStatus::Paused)],
        };

        let (changed, maintenance) = reconcile_system_supervisor(&mut store, 100);

        assert!(!changed);
        assert!(maintenance.turn_to_stop.is_none());
        assert_eq!(store.agents.len(), 1);
    }

    #[test]
    fn system_supervisor_stays_for_attention_and_sleeps_after_an_explicit_pause() {
        let mut target = sample_agent(AutonomousAgentStatus::NeedsAttention);
        target.last_error = Some("test backend failed".to_string());
        let mut store = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![target],
        };
        reconcile_system_supervisor(&mut store, 100);
        assert_eq!(store.agents.len(), 2);

        let supervisor = store
            .agents
            .iter_mut()
            .find(|agent| agent.id == SYSTEM_SUPERVISOR_ID)
            .unwrap();
        supervisor.current_turn_id = Some(42);
        supervisor.session_id = Some("supervisor-session".to_string());
        store.agents[0].status = AutonomousAgentStatus::Paused;

        let (changed, maintenance) = reconcile_system_supervisor(&mut store, 200);

        assert!(changed);
        assert_eq!(maintenance.turn_to_stop, Some(42));
        assert_eq!(
            maintenance.discussion_to_delete,
            Some(("account-1".to_string(), "supervisor-session".to_string()))
        );
        let supervisor = store
            .agents
            .iter()
            .find(|agent| agent.id == SYSTEM_SUPERVISOR_ID)
            .unwrap();
        assert_eq!(supervisor.status, AutonomousAgentStatus::Paused);
        assert_eq!(supervisor.next_run_at, None);
    }

    #[test]
    fn system_supervisor_repairs_safe_scheduler_invariants_and_receives_fleet_state() {
        let mut target = sample_agent(AutonomousAgentStatus::Active);
        target.last_error = Some("validation failed".to_string());
        target.test_status = AutonomousTestStatus::Failed;
        target.last_test_output = Some("assertion mismatch".to_string());
        let mut store = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![target],
        };

        reconcile_system_supervisor(&mut store, 300);

        assert_eq!(store.agents[0].next_run_at, Some(300));
        assert!(store.agents[0]
            .events
            .iter()
            .any(|event| event.kind == "supervisor_schedule_repaired"));
        let context = render_system_supervisor_context(&store, 300);
        assert!(context.contains("agent-1"));
        assert!(context.contains("validation failed"));
        assert!(context.contains("assertion mismatch"));
        assert!(context.contains("Ne modifie jamais le fichier d'etat persistant"));
        let supervisor = store
            .agents
            .iter()
            .find(|agent| agent.id == SYSTEM_SUPERVISOR_ID)
            .unwrap();
        let prompt = autonomous_prompt_with_context(supervisor, Some(&context));
        assert!(prompt.contains("ETAT DE FLOTTE FOURNI PAR L'ORDONNANCEUR"));
        assert!(prompt.contains("AUTONOMOUS_STATUS: continue"));
    }

    #[test]
    fn system_supervisor_rejects_user_mutations() {
        let target = sample_agent(AutonomousAgentStatus::Active);
        let supervisor = new_system_supervisor(&target, 100);
        assert!(ensure_user_managed_agent(&supervisor).is_err());
        assert!(ensure_user_managed_agent(&target).is_ok());
    }

    fn quota_profile(id: &str, label: &str, model: &str) -> settings::AccountProfile {
        settings::AccountProfile {
            id: id.to_string(),
            label: label.to_string(),
            created_at: None,
            provider: settings::Provider::Codex,
            codex_home: format!("/accounts/{id}"),
            project_dir: None,
            proxy_id: None,
            startup_command: None,
            limits: settings::AccountLimitTracking::default(),
            bypass: true,
            model: Some(model.to_string()),
            reasoning_effort: Some("medium".to_string()),
        }
    }

    fn quota_view(id: &str, used_percent: f64) -> settings::AccountLimitView {
        settings::AccountLimitView {
            id: id.to_string(),
            label: id.to_string(),
            provider: settings::Provider::Codex,
            codex_home: format!("/accounts/{id}"),
            has_tokens: true,
            connected_at: Some(1),
            session_reset_at: Some(10),
            weekly_reset_at: Some(20),
            session_remaining_secs: Some(9),
            weekly_remaining_secs: Some(19),
            session_used_percent: Some(used_percent),
            weekly_used_percent: Some(used_percent),
            buckets: Vec::new(),
            refreshed_at: Some(1),
            source: "test".to_string(),
            error: None,
        }
    }

    #[test]
    fn quota_failover_chooses_the_best_distinct_authenticated_account() {
        let accounts = vec![
            quota_profile("current", "same@example.com", "model-current"),
            quota_profile("duplicate", "same@example.com", "model-duplicate"),
            quota_profile("exhausted", "empty@example.com", "model-empty"),
            quota_profile("available", "available@example.com", "model-best"),
            quota_profile("lower", "lower@example.com", "model-lower"),
        ];
        let limits = vec![
            quota_view("current", 100.0),
            quota_view("duplicate", 5.0),
            quota_view("exhausted", 100.0),
            quota_view("available", 25.0),
            quota_view("lower", 80.0),
        ];

        let target = select_quota_failover_target("current", &accounts, &limits)
            .expect("un compte alternatif avec quota");

        assert_eq!(target.account_id, "available");
        assert_eq!(target.model.as_deref(), Some("model-best"));
        assert_eq!(target.reasoning_effort.as_deref(), Some("medium"));
        assert_eq!(target.remaining_percent, 75.0);
    }

    #[test]
    fn model_capacity_retries_continue_without_penalizing_the_agent() {
        assert_eq!(
            [1, 2, 3, 4, 5, 6, 20].map(model_capacity_retry_delay_seconds),
            [3, 6, 12, 24, 48, 60, 60]
        );

        let dir =
            std::env::temp_dir().join(format!("cst-autonomous-capacity-retry-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.current_turn_id = Some(1);
        let inner = Arc::new(AutonomousAgentInner {
            chat: ChatTurnManager::default(),
            storage_path: dir.join("autonomous-agents.json"),
            store: Mutex::new(AutonomousAgentStore {
                version: STORE_VERSION,
                agents: vec![agent],
            }),
            validation_runs: Mutex::new(HashMap::new()),
        });
        let capacity_error =
            "Selected model is at capacity. Please try a different model.".to_string();

        for attempt in 1..=8 {
            let turn_id = attempt as u64;
            if attempt > 1 {
                inner.store.lock().unwrap().agents[0].current_turn_id = Some(turn_id);
            }
            let before = metrics::now_ts();
            record_failure(
                &inner,
                "agent-1",
                Some(turn_id),
                None,
                capacity_error.clone(),
            );
            let store = inner.store.lock().unwrap();
            let retried = &store.agents[0];
            assert_eq!(retried.status, AutonomousAgentStatus::Active);
            assert_eq!(retried.current_turn_id, None);
            assert_eq!(retried.model_capacity_retry_count, attempt);
            assert_eq!(retried.consecutive_failures, 0);
            let delay = model_capacity_retry_delay_seconds(attempt) as i64;
            assert!(retried.next_run_at.is_some_and(|next| {
                next >= before + delay && next <= metrics::now_ts() + delay
            }));
            assert!(retried
                .events
                .last()
                .is_some_and(|event| event.kind == "model_capacity_retry"));
        }
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn quota_failover_respects_the_most_constrained_bucket() {
        let mut limit = quota_view("available", 20.0);
        limit.weekly_used_percent = Some(95.0);
        assert_eq!(remaining_quota_percent(&limit), Some(5.0));

        limit.buckets.push(settings::AccountRateLimitBucketView {
            limit_id: "codex".to_string(),
            limit_name: None,
            bucket: "weekly".to_string(),
            window_duration_mins: 10_080,
            resets_at: 20,
            used_percent: Some(95.0),
            rate_limit_reached_type: Some("rate_limit_reached".to_string()),
            plan_type: None,
        });
        assert_eq!(remaining_quota_percent(&limit), Some(0.0));
    }

    fn snapshot_with_text(text: &str) -> ChatTurnSnapshot {
        ChatTurnSnapshot {
            id: 1,
            account_id: "account-1".to_string(),
            session_id: Some("session-1".to_string()),
            status: ChatTurnStatus::Completed,
            started_at: 1,
            finished_at: Some(2),
            error: None,
            activities: Vec::new(),
            thoughts: Vec::new(),
            parts: vec![ChatPart {
                id: "part-1".to_string(),
                kind: "text".to_string(),
                status: "completed".to_string(),
                text: Some(text.to_string()),
                tool: None,
                title: None,
                subtitle: None,
                detail: None,
                output: None,
            }],
        }
    }

    #[test]
    fn control_directive_uses_the_last_valid_line() {
        assert_eq!(
            directive_from_text("AUTONOMOUS_STATUS: blocked\nnotes\nAUTONOMOUS_STATUS: complete"),
            AgentDirective::Complete
        );
        assert_eq!(
            directive_from_text("aucun protocole"),
            AgentDirective::Continue
        );
    }

    #[test]
    fn first_prompt_creates_a_goal_and_declares_safety_protocol() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        push_memory(
            &mut agent,
            AutonomousMemoryKind::User,
            "Ne jamais depasser 120 ko de JavaScript".to_string(),
            10,
        );
        let prompt = autonomous_prompt(&agent);
        assert!(prompt.contains("create_goal"));
        assert!(prompt.contains("Reduire les ressources de la page"));
        assert!(prompt.contains("Ne jamais depasser 120 ko de JavaScript"));
        assert!(prompt.contains("Ingenieur performance"));
        assert!(prompt.contains("AUTONOMOUS_STATUS: continue"));
        assert!(prompt.contains("AUTONOMOUS_MEMORY:"));
        assert!(prompt.contains("AUTONOMOUS_MEMORY_STRATEGY:"));
        assert!(prompt.contains("AUTONOMOUS_TASK:"));
        assert!(prompt.contains("AUTONOMOUS_NEXT_TASK:"));
        assert!(prompt.contains("surfaces testees"));
        assert!(prompt.contains("AUTONOMOUS_REVIEW_KIND:"));
        assert!(prompt.contains("AUTONOMOUS_REVIEW_EXTERNAL:"));
        assert!(prompt.contains("AUTONOMOUS_REVIEW:"));
        assert!(prompt.contains("action externe irreversible"));
        assert!(prompt.contains("aucun connecteur n'est autorise"));
    }

    #[test]
    fn connector_prompt_allows_reads_but_gates_external_writes() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.connectors = vec![ChatAppConnector::Gmail, ChatAppConnector::GoogleCalendar];

        let prompt = autonomous_prompt(&agent);

        assert!(prompt.contains("Gmail, Google Agenda"));
        assert!(prompt.contains("lectures et recherches peuvent etre realisees"));
        assert!(prompt.contains("AUTONOMOUS_REVIEW_EXTERNAL: true"));
        assert!(prompt.contains("Les suppressions restent interdites"));
        assert!(prompt.contains("ne demande jamais de mot de passe ou de jeton"));
    }

    #[test]
    fn user_review_gate_forces_plan_until_one_application_is_approved() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.require_user_review = true;

        assert_eq!(effective_turn_mode(&agent), ChatTurnMode::Plan);
        let planning_prompt = autonomous_prompt(&agent);
        assert!(planning_prompt.contains("GARDE-FOU REVIEW UTILISATEUR ACTIF"));
        assert!(planning_prompt.contains("ne doit modifier aucun fichier"));

        agent.approved_review = Some(AutonomousReviewRequest {
            id: "review-approved".to_string(),
            kind: AutonomousReviewKind::Approval,
            request: "Modifier uniquement src/main.ts puis lancer les tests".to_string(),
            created_at: 20,
            external_action: false,
        });

        assert_eq!(effective_turn_mode(&agent), ChatTurnMode::Build);
        let approved_prompt = autonomous_prompt(&agent);
        assert!(
            approved_prompt.contains("AUTORISATION UTILISATEUR VALABLE POUR CE TOUR UNIQUEMENT")
        );
        assert!(approved_prompt.contains("Modifier uniquement src/main.ts"));
    }

    #[test]
    fn completed_plan_waits_for_review_and_consumes_the_approval_once() {
        let dir =
            std::env::temp_dir().join(format!("cst-autonomous-review-gate-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.require_user_review = true;
        agent.current_turn_id = Some(1);
        let manager = AutonomousAgentManager {
            inner: Arc::new(AutonomousAgentInner {
                chat: ChatTurnManager::default(),
                storage_path: dir.join("autonomous-agents.json"),
                store: Mutex::new(AutonomousAgentStore {
                    version: STORE_VERSION,
                    agents: vec![agent],
                }),
                validation_runs: Mutex::new(HashMap::new()),
            }),
        };
        let snapshot = |id, text: &str| ChatTurnSnapshot {
            id,
            account_id: "account-1".to_string(),
            session_id: Some("session-1".to_string()),
            status: ChatTurnStatus::Completed,
            started_at: 1,
            finished_at: Some(2),
            error: None,
            activities: Vec::new(),
            thoughts: Vec::new(),
            parts: vec![ChatPart {
                id: format!("part-{id}"),
                kind: "text".to_string(),
                status: "completed".to_string(),
                text: Some(text.to_string()),
                tool: None,
                title: None,
                subtitle: None,
                detail: None,
                output: None,
            }],
        };

        complete_run(
            &manager.inner,
            "agent-1",
            1,
            &snapshot(
                1,
                "Plan: modifier src/main.ts.\nAUTONOMOUS_STATUS: continue",
            ),
        );
        let waiting = manager
            .list()
            .unwrap()
            .into_iter()
            .find(|agent| agent.id == "agent-1")
            .expect("agent utilisateur");
        assert_eq!(waiting.status, AutonomousAgentStatus::NeedsAttention);
        assert!(waiting.pending_review.is_some());

        let approved = manager
            .control("agent-1", AutonomousAgentAction::ApproveReview)
            .unwrap();
        assert!(approved.approved_review.is_some());
        manager
            .inner
            .mutate_store(|store| {
                find_agent_mut(store, "agent-1")?.current_turn_id = Some(2);
                Ok(())
            })
            .unwrap();
        complete_run(
            &manager.inner,
            "agent-1",
            2,
            &snapshot(
                2,
                "Changement applique et verifie.\nAUTONOMOUS_STATUS: continue",
            ),
        );
        let applied = manager
            .list()
            .unwrap()
            .into_iter()
            .find(|agent| agent.id == "agent-1")
            .expect("agent utilisateur");
        assert_eq!(applied.status, AutonomousAgentStatus::Active);
        assert!(applied.pending_review.is_none());
        assert!(applied.approved_review.is_none());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn restart_replans_only_active_agents() {
        let mut active = sample_agent(AutonomousAgentStatus::Active);
        active.current_turn_id = Some(42);
        let mut paused = sample_agent(AutonomousAgentStatus::Paused);
        paused.id = "agent-2".to_string();
        paused.current_turn_id = Some(43);
        paused.next_run_at = Some(200);
        let mut store = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![active, paused],
        };

        assert!(normalize_loaded_store(&mut store, 100));
        assert_eq!(store.agents[0].current_turn_id, None);
        assert_eq!(store.agents[0].next_run_at, Some(100));
        assert!(store.agents[0]
            .events
            .iter()
            .any(|event| event.kind == "recovered"));
        assert_eq!(store.agents[1].current_turn_id, None);
        assert_eq!(store.agents[1].next_run_at, None);
    }

    #[test]
    fn restart_recovers_an_agent_previously_blocked_by_model_capacity() {
        let mut blocked = sample_agent(AutonomousAgentStatus::NeedsAttention);
        blocked.consecutive_failures = MAX_CONSECUTIVE_FAILURES;
        blocked.last_error =
            Some("Selected model is at capacity. Please try a different model.".to_string());
        let mut store = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![blocked],
        };

        assert!(normalize_loaded_store(&mut store, 100));
        let recovered = &store.agents[0];
        assert_eq!(recovered.status, AutonomousAgentStatus::Active);
        assert_eq!(recovered.consecutive_failures, 0);
        assert_eq!(recovered.model_capacity_retry_count, 0);
        assert_eq!(recovered.next_run_at, Some(100));
        assert!(recovered
            .events
            .iter()
            .any(|event| event.kind == "model_capacity_recovered"));
    }

    #[test]
    fn version_one_state_migrates_identity_and_interrupted_validation() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.name.clear();
        agent.session_id = Some("019f0000-0000-7000-8000-0000000000e5".to_string());
        agent.test_command = Some("echo ok".to_string());
        agent.test_status = AutonomousTestStatus::Running;
        agent.current_test_id = Some("old-test".to_string());
        agent.test_completion_pending = true;
        let mut store = AutonomousAgentStore {
            version: 1,
            agents: vec![agent],
        };

        assert!(normalize_loaded_store(&mut store, 100));
        assert_eq!(store.version, STORE_VERSION);
        assert!(!store.agents[0].name.is_empty());
        assert_eq!(store.agents[0].session_id, None);
        assert_eq!(store.agents[0].current_test_id, None);
        assert_eq!(store.agents[0].test_status, AutonomousTestStatus::Cancelled);
        assert!(!store.agents[0].test_completion_pending);
        assert_eq!(store.agents[0].next_run_at, Some(100));
    }

    #[test]
    fn interval_has_safe_bounds() {
        assert!(validate_interval(59).is_err());
        assert_eq!(validate_interval(900).unwrap(), 900);
        assert!(validate_interval(MAX_INTERVAL_SECONDS + 1).is_err());
    }

    #[test]
    fn next_run_can_be_rescheduled_only_while_the_agent_is_idle_and_active() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-schedule-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let active = sample_agent(AutonomousAgentStatus::Active);
        let mut running = active.clone();
        running.id = "agent-running".to_string();
        running.current_turn_id = Some(42);
        let mut paused = active.clone();
        paused.id = "agent-paused".to_string();
        paused.status = AutonomousAgentStatus::Paused;
        let manager = AutonomousAgentManager {
            inner: Arc::new(AutonomousAgentInner {
                chat: ChatTurnManager::default(),
                storage_path: dir.join("autonomous-agents.json"),
                store: Mutex::new(AutonomousAgentStore {
                    version: STORE_VERSION,
                    agents: vec![active, running, paused],
                }),
                validation_runs: Mutex::new(HashMap::new()),
            }),
        };
        let scheduled_at = metrics::now_ts() + 3_600;

        let scheduled = manager
            .schedule("agent-1", scheduled_at, Some(3_600))
            .unwrap();
        assert_eq!(scheduled.next_run_at, Some(scheduled_at));
        assert_eq!(scheduled.interval_seconds, 3_600);
        assert!(scheduled
            .events
            .iter()
            .any(|event| event.kind == "rescheduled"));
        let persisted = load_store(&dir.join("autonomous-agents.json")).unwrap();
        assert_eq!(persisted.agents[0].interval_seconds, 3_600);
        assert_eq!(persisted.agents[0].next_run_at, Some(scheduled_at));
        assert!(manager
            .schedule("agent-running", scheduled_at, Some(3_600))
            .is_err());
        assert!(manager
            .schedule("agent-paused", scheduled_at, Some(3_600))
            .is_err());
        assert!(manager
            .schedule("agent-1", metrics::now_ts() - 3_600, Some(3_600))
            .is_err());
        assert!(manager
            .schedule("agent-1", scheduled_at, Some(MAX_INTERVAL_SECONDS + 1))
            .is_err());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn orchestration_promotion_preserves_session_and_supports_rollback() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-promotion-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let session_id = Uuid::new_v4().to_string();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.session_id = Some(session_id.clone());
        agent.current_start_id = Some("start-in-flight".to_string());
        agent.next_run_at = Some(metrics::now_ts() + 600);
        let manager = AutonomousAgentManager {
            inner: Arc::new(AutonomousAgentInner {
                chat: ChatTurnManager::default(),
                storage_path: dir.join("autonomous-agents.json"),
                store: Mutex::new(AutonomousAgentStore {
                    version: STORE_VERSION,
                    agents: vec![agent],
                }),
                validation_runs: Mutex::new(HashMap::new()),
            }),
        };

        let checkpoint = manager.prepare_orchestration_promotion("agent-1").unwrap();
        assert_eq!(
            checkpoint.snapshot.session_id.as_deref(),
            Some(session_id.as_str())
        );
        let paused = manager.list().unwrap().remove(0);
        assert_eq!(paused.status, AutonomousAgentStatus::Paused);
        assert_eq!(paused.session_id.as_deref(), Some(session_id.as_str()));
        assert!(paused.current_start_id.is_none());

        let restored = manager
            .rollback_orchestration_promotion(&checkpoint)
            .unwrap();
        assert_eq!(restored.status, AutonomousAgentStatus::Active);
        assert_eq!(restored.session_id.as_deref(), Some(session_id.as_str()));
        assert!(restored.current_start_id.is_none());
        assert!(restored.next_run_at.is_some());

        manager.prepare_orchestration_promotion("agent-1").unwrap();
        manager.finalize_orchestration_promotion("agent-1").unwrap();
        let remaining = manager.list().unwrap();
        assert_eq!(remaining.len(), 1);
        assert!(remaining[0].system_managed);
        assert_eq!(remaining[0].status, AutonomousAgentStatus::Paused);
        let persisted = load_store(&dir.join("autonomous-agents.json")).unwrap();
        assert_eq!(persisted.agents.len(), 1);
        assert!(persisted.agents[0].system_managed);
        assert_eq!(persisted.agents[0].status, AutonomousAgentStatus::Paused);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn memory_protocol_is_parsed_deduplicated_and_hidden_from_summary() {
        let snapshot = ChatTurnSnapshot {
            id: 1,
            account_id: "account-1".to_string(),
            session_id: Some("session-1".to_string()),
            status: ChatTurnStatus::Completed,
            started_at: 1,
            finished_at: Some(2),
            error: None,
            activities: Vec::new(),
            thoughts: Vec::new(),
            parts: vec![ChatPart {
                id: "part-1".to_string(),
                kind: "text".to_string(),
                status: "completed".to_string(),
                text: Some(
                    "Optimisation mesuree.\nAUTONOMOUS_MEMORY: budget JS = 120 ko\nAUTONOMOUS_MEMORY: budget JS = 120 ko\nAUTONOMOUS_STATUS: continue"
                        .to_string(),
                ),
                tool: None,
                title: None,
                subtitle: None,
                detail: None,
                output: None,
            }],
        };

        assert_eq!(
            memories_from_snapshot(&snapshot),
            vec!["budget JS = 120 ko".to_string()]
        );
        assert_eq!(
            summary_from_snapshot(&snapshot),
            Some("Optimisation mesuree.".to_string())
        );
    }

    #[test]
    fn work_plan_is_parsed_merged_and_reinjected_with_the_next_task() {
        let snapshot = snapshot_with_text(
            "Audit en cours.\nAUTONOMOUS_MEMORY_STRATEGY: conserver les surfaces testees et la commande qui prouve le resultat\nAUTONOMOUS_TASK: auth-login | done | Authentification | Tester la connexion valide et invalide | cargo test login : ok\nAUTONOMOUS_TASK: api-errors | todo | API | Tester les erreurs 4xx et 5xx |\nAUTONOMOUS_TASK: ui-unproved | done | Interface | Tester le formulaire sans preuve |\nAUTONOMOUS_NEXT_TASK: api-errors\nAUTONOMOUS_STATUS: continue",
        );
        let update = work_plan_from_snapshot(&snapshot, 42);

        assert_eq!(
            update.memory_strategy.as_deref(),
            Some("conserver les surfaces testees et la commande qui prouve le resultat")
        );
        assert_eq!(update.items.len(), 3);
        assert_eq!(update.items[0].status, AutonomousWorkItemStatus::Done);
        assert_eq!(update.items[1].status, AutonomousWorkItemStatus::Todo);
        assert_eq!(update.next_task_id.as_deref(), Some("api-errors"));
        assert_eq!(
            summary_from_snapshot(&snapshot),
            Some("Audit en cours.".to_string())
        );

        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        apply_work_plan_update(&mut agent, &update, 42);
        assert_eq!(agent.work_items.len(), 3);
        assert_eq!(agent.next_task_id.as_deref(), Some("api-errors"));
        assert_eq!(
            agent
                .work_items
                .iter()
                .find(|item| item.id == "ui-unproved")
                .unwrap()
                .status,
            AutonomousWorkItemStatus::InProgress,
            "une tache sans preuve ne peut pas rester terminee"
        );
        activate_next_work_item(&mut agent, 43);
        assert_eq!(
            agent
                .work_items
                .iter()
                .find(|item| item.id == "api-errors")
                .unwrap()
                .status,
            AutonomousWorkItemStatus::InProgress
        );

        let prompt = autonomous_prompt(&agent);
        assert!(prompt.contains("CARNET DE TRAVAIL PERSISTANT"));
        assert!(prompt.contains("[done] auth-login"));
        assert!(prompt.contains("[PROCHAINE]"));
        assert!(prompt.contains("surfaces testees"));
    }

    #[test]
    fn completion_waits_for_a_structured_and_closed_work_plan() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        assert_eq!(
            reconcile_completion_with_work_plan(&mut agent, AgentDirective::Complete, 20),
            AgentDirective::Continue
        );
        assert!(agent
            .events
            .iter()
            .any(|event| event.kind == "plan_required"));

        agent.work_items.push(AutonomousWorkItem {
            id: "ui".to_string(),
            status: AutonomousWorkItemStatus::Todo,
            domain: "Interface".to_string(),
            description: "Tester le formulaire".to_string(),
            evidence: None,
            updated_at: 20,
        });
        assert_eq!(
            reconcile_completion_with_work_plan(&mut agent, AgentDirective::Complete, 21),
            AgentDirective::Continue
        );
        assert_eq!(agent.next_task_id.as_deref(), Some("ui"));

        agent.work_items[0].status = AutonomousWorkItemStatus::Blocked;
        assert_eq!(
            reconcile_completion_with_work_plan(&mut agent, AgentDirective::Complete, 22),
            AgentDirective::Blocked
        );

        agent.work_items[0].status = AutonomousWorkItemStatus::Done;
        agent.work_items[0].evidence = Some("test navigateur reussi".to_string());
        assert_eq!(
            reconcile_completion_with_work_plan(&mut agent, AgentDirective::Complete, 23),
            AgentDirective::Complete
        );
        assert_eq!(agent.next_task_id, None);
    }

    #[test]
    fn blocked_turn_exposes_a_structured_human_review() {
        let snapshot = ChatTurnSnapshot {
            id: 1,
            account_id: "account-1".to_string(),
            session_id: Some("session-1".to_string()),
            status: ChatTurnStatus::Completed,
            started_at: 1,
            finished_at: Some(2),
            error: None,
            activities: Vec::new(),
            thoughts: Vec::new(),
            parts: vec![ChatPart {
                id: "part-review".to_string(),
                kind: "text".to_string(),
                status: "completed".to_string(),
                text: Some(
                    "La publication necessite une confirmation.\nAUTONOMOUS_REVIEW_KIND: approval\nAUTONOMOUS_REVIEW_EXTERNAL: true\nAUTONOMOUS_REVIEW: Publier la version 2 sur le serveur de production ; le changement devient visible par les utilisateurs.\nAUTONOMOUS_STATUS: blocked"
                        .to_string(),
                ),
                tool: None,
                title: None,
                subtitle: None,
                detail: None,
                output: None,
            }],
        };

        let summary = summary_from_snapshot(&snapshot);
        let review = review_from_snapshot(&snapshot, 42, summary.as_deref());

        assert_eq!(review.kind, AutonomousReviewKind::Approval);
        assert!(review.request.contains("Publier la version 2"));
        assert_eq!(review.created_at, 42);
        assert!(review.external_action);
        assert_eq!(
            summary,
            Some("La publication necessite une confirmation.".to_string())
        );
    }

    #[test]
    fn human_review_decision_is_memorized_before_the_agent_resumes() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-review-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut approved = sample_agent(AutonomousAgentStatus::NeedsAttention);
        approved.pending_review = Some(AutonomousReviewRequest {
            id: "review-1".to_string(),
            kind: AutonomousReviewKind::Approval,
            request: "Publier la version de test".to_string(),
            created_at: 20,
            external_action: false,
        });
        let mut rejected = approved.clone();
        rejected.id = "agent-2".to_string();
        rejected.pending_review.as_mut().unwrap().id = "review-2".to_string();
        let manager = AutonomousAgentManager {
            inner: Arc::new(AutonomousAgentInner {
                chat: ChatTurnManager::default(),
                storage_path: dir.join("autonomous-agents.json"),
                store: Mutex::new(AutonomousAgentStore {
                    version: STORE_VERSION,
                    agents: vec![approved, rejected],
                }),
                validation_runs: Mutex::new(HashMap::new()),
            }),
        };

        assert!(manager
            .control("agent-1", AutonomousAgentAction::Resume)
            .is_err());
        let approved = manager
            .control("agent-1", AutonomousAgentAction::ApproveReview)
            .unwrap();
        let rejected = manager
            .control("agent-2", AutonomousAgentAction::RejectReview)
            .unwrap();

        assert_eq!(approved.status, AutonomousAgentStatus::Active);
        assert!(approved.pending_review.is_none());
        assert!(approved.approved_review.is_some());
        assert!(approved
            .memory
            .iter()
            .any(|entry| entry.content.contains("approuvee")));
        assert_eq!(rejected.status, AutonomousAgentStatus::Active);
        assert!(rejected.pending_review.is_none());
        assert!(rejected.approved_review.is_none());
        assert!(rejected
            .memory
            .iter()
            .any(|entry| entry.content.contains("alternative sure")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn configured_test_command_is_executed_and_captured() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.project_dir = Some(dir.to_string_lossy().to_string());
        #[cfg(windows)]
        let command = "echo validation-ok";
        #[cfg(not(windows))]
        let command = "printf validation-ok";
        agent.test_command = Some(command.to_string());
        // Les suites Windows lancent plusieurs processus en parallele ; laisse
        // assez de marge a cmd.exe sous forte charge sans ralentir le cas normal.
        agent.test_timeout_seconds = 30;
        agent.test_status = AutonomousTestStatus::Idle;

        let result = run_validation_command(&agent, &AtomicBool::new(false));

        assert_eq!(result.status, AutonomousTestStatus::Passed);
        assert_eq!(result.exit_code, Some(0));
        assert!(result.output.contains("validation-ok"));

        #[cfg(windows)]
        let failing_command = "echo validation-failed 1>&2 & exit /b 7";
        #[cfg(not(windows))]
        let failing_command = "printf validation-failed >&2; exit 7";
        agent.test_command = Some(failing_command.to_string());
        let failed = run_validation_command(&agent, &AtomicBool::new(false));
        assert_eq!(failed.status, AutonomousTestStatus::Failed);
        assert_eq!(failed.exit_code, Some(7));
        assert!(failed.output.contains("validation-failed"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_output_masks_common_secret_shapes_before_persistence() {
        let output = redact_test_output(
            "build ok\nAuthorization: Bearer abc\nAPI_KEY=top-secret\n4 assertions",
        );
        assert!(output.contains("build ok"));
        assert!(output.contains("4 assertions"));
        assert!(!output.contains("abc"));
        assert!(!output.contains("top-secret"));
    }

    #[test]
    fn completion_validation_has_a_persistent_pending_state() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-gate-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.project_dir = Some(dir.to_string_lossy().to_string());
        agent.test_command = Some("echo ok".to_string());
        agent.test_status = AutonomousTestStatus::Idle;

        let test_id = prepare_validation(&mut agent, 100, true).unwrap();

        assert_eq!(agent.current_test_id.as_deref(), Some(test_id.as_str()));
        assert_eq!(agent.test_status, AutonomousTestStatus::Running);
        assert!(agent.test_completion_pending);
        assert_eq!(agent.next_run_at, None);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_validation_is_memorized_and_replans_a_repair() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-repair-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.project_dir = Some(dir.to_string_lossy().to_string());
        agent.test_command = Some("echo validation".to_string());
        agent.test_status = AutonomousTestStatus::Running;
        agent.current_test_id = Some("test-failure".to_string());
        agent.test_completion_pending = true;
        let inner = Arc::new(AutonomousAgentInner {
            chat: ChatTurnManager::default(),
            storage_path: dir.join("autonomous-agents.json"),
            store: Mutex::new(AutonomousAgentStore {
                version: STORE_VERSION,
                agents: vec![agent],
            }),
            validation_runs: Mutex::new(HashMap::new()),
        });

        finish_validation(
            &inner,
            "agent-1",
            "test-failure",
            ValidationResult {
                status: AutonomousTestStatus::Failed,
                exit_code: Some(1),
                duration_ms: 42,
                output: "assertion attendue != valeur recue".to_string(),
            },
        );

        let store = inner.store.lock().unwrap();
        let repaired = &store.agents[0];
        assert_eq!(repaired.status, AutonomousAgentStatus::Active);
        assert_eq!(repaired.test_status, AutonomousTestStatus::Failed);
        assert_eq!(repaired.current_test_id, None);
        assert!(!repaired.test_completion_pending);
        assert!(repaired
            .next_run_at
            .is_some_and(|next| next <= metrics::now_ts()));
        assert!(repaired.memory.iter().any(|entry| {
            entry.kind == AutonomousMemoryKind::Test && entry.content.contains("assertion attendue")
        }));
        assert_eq!(repaired.next_task_id.as_deref(), Some("validation-repair"));
        let repair = repaired
            .work_items
            .iter()
            .find(|item| item.id == "validation-repair")
            .expect("la validation echouee doit creer une tache de correction");
        assert_eq!(repair.status, AutonomousWorkItemStatus::Todo);
        assert!(repair
            .evidence
            .as_deref()
            .is_some_and(|value| value.contains("assertion attendue")));
        drop(store);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn failed_state_transition_is_rolled_back_in_memory() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-rollback-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let inner = AutonomousAgentInner {
            chat: ChatTurnManager::default(),
            storage_path: dir.join("autonomous-agents.json"),
            store: Mutex::new(AutonomousAgentStore {
                version: STORE_VERSION,
                agents: vec![sample_agent(AutonomousAgentStatus::Active)],
            }),
            validation_runs: Mutex::new(HashMap::new()),
        };

        let result: Result<(), String> = inner.mutate_store(|store| {
            store.agents[0].status = AutonomousAgentStatus::Completed;
            Err("transition refusee".to_string())
        });

        assert!(result.is_err());
        assert_eq!(
            inner.store.lock().unwrap().agents[0].status,
            AutonomousAgentStatus::Active
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn start_reservation_prevents_chat_and_test_overlap() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-start-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.current_start_id = Some("start-current".to_string());
        agent.next_run_at = Some(0);
        let inner = Arc::new(AutonomousAgentInner {
            chat: ChatTurnManager::default(),
            storage_path: dir.join("autonomous-agents.json"),
            store: Mutex::new(AutonomousAgentStore {
                version: STORE_VERSION,
                agents: vec![agent],
            }),
            validation_runs: Mutex::new(HashMap::new()),
        });

        assert!(inner.work_items(metrics::now_ts()).is_empty());
        record_failure(
            &inner,
            "agent-1",
            None,
            Some("start-obsolete"),
            "ancienne erreur".to_string(),
        );
        assert_eq!(
            inner.store.lock().unwrap().agents[0]
                .current_start_id
                .as_deref(),
            Some("start-current")
        );
        record_failure(
            &inner,
            "agent-1",
            None,
            Some("start-current"),
            "demarrage impossible".to_string(),
        );
        let store = inner.store.lock().unwrap();
        assert_eq!(store.agents[0].current_start_id, None);
        assert_eq!(store.agents[0].consecutive_failures, 1);
        drop(store);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn persistent_store_round_trip_keeps_the_schedule() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-{}", Uuid::new_v4()));
        let path = dir.join("autonomous-agents.json");
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.next_run_at = Some(1_234);
        let expected = AutonomousAgentStore {
            version: STORE_VERSION,
            agents: vec![agent],
        };

        persist_store(&path, &expected).unwrap();
        let loaded = load_store(&path).unwrap();

        assert_eq!(loaded, expected);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_fingerprint_detects_same_size_content_changes() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-watch-{}", Uuid::new_v4()));
        fs::create_dir_all(dir.join("src")).unwrap();
        let file = dir.join("src").join("main.ts");
        fs::write(&file, "alpha").unwrap();
        let paths = vec!["src".to_string()];
        let before = workspace_fingerprint(&dir, &paths).unwrap();

        fs::write(&file, "bravo").unwrap();
        let after = workspace_fingerprint(&dir, &paths).unwrap();

        assert_ne!(before, after);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn workspace_trigger_waits_for_stability_then_wakes_once() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.trigger_kind = AutonomousTriggerKind::WorkspaceChange;
        agent.watch_paths = vec!["src".to_string(), "package.json".to_string()];
        agent.debounce_seconds = 10;
        agent.event_fingerprint = Some("baseline".to_string());

        apply_workspace_fingerprint(&mut agent, "candidate".to_string(), 100);
        assert_eq!(agent.event_candidate_since, Some(100));
        assert_eq!(agent.next_run_at, None);

        apply_workspace_fingerprint(&mut agent, "candidate".to_string(), 109);
        assert_eq!(agent.next_run_at, None);
        apply_workspace_fingerprint(&mut agent, "candidate".to_string(), 110);

        assert_eq!(agent.next_run_at, Some(110));
        assert_eq!(agent.last_triggered_at, Some(110));
        assert_eq!(agent.event_fingerprint.as_deref(), Some("candidate"));
        assert!(agent
            .events
            .iter()
            .any(|event| event.kind == "event_triggered"));
    }

    #[test]
    fn completed_workspace_event_rearms_instead_of_ending_the_agent() {
        let mut agent = sample_agent(AutonomousAgentStatus::Completed);
        agent.trigger_kind = AutonomousTriggerKind::WorkspaceChange;
        agent.next_run_at = Some(42);
        agent.work_items.push(AutonomousWorkItem {
            id: "publish".to_string(),
            status: AutonomousWorkItemStatus::Done,
            domain: "livraison".to_string(),
            description: "Publier le build".to_string(),
            evidence: Some("site actif".to_string()),
            updated_at: 42,
        });

        put_workspace_agent_to_sleep(&mut agent, 50, "livraison terminee");

        assert_eq!(agent.status, AutonomousAgentStatus::Active);
        assert_eq!(agent.next_run_at, None);
        assert!(agent.work_items.is_empty());
        assert_eq!(
            agent.events.last().map(|event| event.kind.as_str()),
            Some("event_handled")
        );
    }

    #[test]
    fn publication_permission_is_explicit_and_scoped_in_the_prompt() {
        let mut agent = sample_agent(AutonomousAgentStatus::Active);
        agent.trigger_kind = AutonomousTriggerKind::WorkspaceChange;
        agent.watch_paths = vec!["src".to_string()];
        agent.allow_git_publish = true;
        agent.last_trigger_message = Some("Modification stable de src".to_string());

        let prompt = autonomous_prompt(&agent);

        assert!(prompt.contains("DECLENCHEUR EVENEMENTIEL"));
        assert!(prompt.contains("AUTORISATION EXPLICITE GIT ET PUBLICATION"));
        assert!(prompt.contains("git push origin HEAD"));
        assert!(prompt.contains("force push"));
    }

    #[test]
    fn workspace_watch_paths_cannot_escape_the_project() {
        assert!(validate_watch_paths(
            vec!["../secret.env".to_string()],
            AutonomousTriggerKind::WorkspaceChange,
        )
        .is_err());
        assert_eq!(
            validate_watch_paths(
                vec!["src".to_string(), "./src".to_string()],
                AutonomousTriggerKind::WorkspaceChange,
            )
            .unwrap(),
            vec!["src".to_string()]
        );
    }

    #[test]
    fn git_publication_baseline_must_be_clean_and_have_an_origin() {
        let dir = std::env::temp_dir().join(format!("cst-autonomous-git-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            let status = Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args(args)
                .status()
                .unwrap();
            assert!(status.success(), "git {args:?}");
        };
        run(&["init", "-b", "main"]);
        run(&["config", "user.email", "autonomous-test@example.invalid"]);
        run(&["config", "user.name", "Autonomous Test"]);
        fs::write(dir.join("README.md"), "baseline\n").unwrap();
        run(&["add", "README.md"]);
        run(&["commit", "-m", "baseline"]);
        run(&[
            "remote",
            "add",
            "origin",
            "https://example.invalid/project.git",
        ]);

        assert!(validate_git_publication_baseline(&dir).is_ok());
        fs::write(dir.join("README.md"), "dirty\n").unwrap();
        assert!(validate_git_publication_baseline(&dir).is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
