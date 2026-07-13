//! Moteur de conversations sans terminal visible.
//!
//! Chaque message lance le provider en mode non interactif (`codex exec` ou
//! `claude --print`). Les sessions restent celles des CLI : les JSONL existants
//! continuent donc d'alimenter l'historique et le WebSocket de discussions.

use crate::{
    agent_room::{AgentMeta, PendingQuestion, QuestionAnswer, RoomState},
    discussions, metrics,
    settings::{self, AccountProfile, AppSettings, Provider},
    worktree::{AgentWorkspace, WorktreeManager},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    env,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::State;
use uuid::Uuid;

const MAX_PROMPT_BYTES: usize = 256 * 1024;
const MAX_ERROR_BYTES: usize = 24 * 1024;
const MAX_ACTIVITIES: usize = 32;
const MAX_THOUGHTS: usize = 32;
const MAX_PARTS: usize = 96;
const MAX_THOUGHT_CHARS: usize = 4_000;
const MAX_PART_DETAIL_CHARS: usize = 12_000;
const MAX_MODEL_CHARS: usize = 160;
const MAX_RETAINED_TURNS: usize = 500;

#[derive(Debug, Clone, Copy, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum ChatTurnMode {
    #[default]
    Build,
    Plan,
    Ask,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatTurnStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatActivity {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub detail: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatThought {
    pub id: String,
    pub kind: String,
    pub text: String,
    pub status: String,
}

/// Element ordonne d'un tour, sur le modele de la timeline OpenCode.
///
/// `reasoning`, `text` et `tool` partagent volontairement une seule liste :
/// l'interface peut ainsi conserver l'ordre exact dans lequel le provider a
/// raisonne, explique sa progression, appele un outil puis repris sa reponse.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatPart {
    pub id: String,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatTurnSnapshot {
    pub id: u64,
    pub account_id: String,
    pub session_id: Option<String>,
    pub status: ChatTurnStatus,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub error: Option<String>,
    pub activities: Vec<ChatActivity>,
    pub thoughts: Vec<ChatThought>,
    pub parts: Vec<ChatPart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_question: Option<PendingQuestion>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartChatTurnRequest {
    pub account_id: String,
    #[serde(default)]
    pub session_id: Option<String>,
    pub prompt: String,
    #[serde(default)]
    pub project_dir: Option<String>,
    #[serde(default)]
    pub mode: ChatTurnMode,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

struct ChatTurn {
    snapshot: Mutex<ChatTurnSnapshot>,
    child: Mutex<Option<Child>>,
    workspace: Mutex<Option<AgentWorkspace>>,
}

impl Drop for ChatTurn {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct ChatTurnManager {
    turns: Arc<Mutex<HashMap<u64, Arc<ChatTurn>>>>,
    claims: Arc<Mutex<HashSet<String>>>,
    next_id: Arc<AtomicU64>,
}

struct ChatClaim {
    claims: Arc<Mutex<HashSet<String>>>,
    key: String,
}

impl ChatTurnManager {
    pub fn start(
        &self,
        request: StartChatTurnRequest,
        worktrees: &WorktreeManager,
        room: &RoomState,
        room_url: Option<&str>,
    ) -> Result<ChatTurnSnapshot, String> {
        self.prune_finished_turns();
        let prompt = request.prompt.trim().to_string();
        if prompt.is_empty() {
            return Err("Le message est vide".to_string());
        }
        if prompt.len() > MAX_PROMPT_BYTES {
            return Err("Le message est trop volumineux".to_string());
        }
        if let Some(session_id) = request.session_id.as_deref() {
            Uuid::parse_str(session_id)
                .map_err(|_| "Identifiant de conversation invalide".to_string())?;
        }

        let app_settings = settings::load_settings_for_terminal()?;
        let account = app_settings
            .accounts
            .iter()
            .find(|candidate| candidate.id == request.account_id)
            .cloned()
            .ok_or_else(|| "Compte introuvable".to_string())?;
        if !settings::account_has_auth_tokens(&account) {
            return Err(format!(
                "Compte non authentifie : {}. Ouvre un terminal de connexion pour ce compte avant de lancer un chat.",
                account.label
            ));
        }
        let model = selected_model(request.model.as_deref(), account.model.as_deref())?;
        let reasoning_effort = selected_reasoning_effort(
            account.provider,
            request.reasoning_effort.as_deref(),
            account.reasoning_effort.as_deref(),
        )?;

        let claim = self.reserve_turn(&request)?;
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;

        let canonical_home = settings::expand_home(&account.codex_home)?;
        std::fs::create_dir_all(&canonical_home).map_err(|error| error.to_string())?;
        let source_project_dir = resolve_project_dir(&account, request.project_dir.as_deref())?;
        let workspace = worktrees.prepare_local(
            &format!("desktop-chat-{id}"),
            &canonical_home,
            source_project_dir.as_deref(),
        )?;
        let account_home = workspace.home().to_path_buf();
        let project_dir = Some(workspace.cwd().to_path_buf());
        account
            .provider
            .write_account_config(
                &account_home,
                account.bypass,
                account.model.as_deref(),
                account.reasoning_effort.as_deref(),
            )
            .map_err(|error| format!("Configuration du compte impossible : {error}"))?;

        let program = resolve_cli_program(&settings::command_for_provider(
            &app_settings,
            account.provider,
        ))?;
        let mut command = Command::new(program);
        configure_environment(
            &mut command,
            &app_settings,
            &account,
            &account_home,
            project_dir.as_deref(),
        );
        command.env("CST_AGENT_ID", format!("desktop-chat-{id}"));
        command.env("CST_WORKSPACE_ID", workspace.workspace_id());
        command.env("CST_ROOM_ID", workspace.room_id());
        if let Some(base_sha) = workspace.base_sha() {
            command.env("CST_BASE_SHA", base_sha);
        }
        let mut room_token = None;
        let mut workspace_collab_ready = false;
        // Collaboration workspace native sur desktop comme en SaaS.
        {
            let url = room_url.map(ToString::to_string).unwrap_or_else(|| {
                format!("http://127.0.0.1:{}/mcp", app_settings.agent_room.port)
            });
            let cli_bin = settings::command_for_provider(&app_settings, account.provider);
            match room.provision_home(account.provider, &cli_bin, &account_home, &url) {
                Ok(()) => {
                    workspace_collab_ready = true;
                    let token = room.register(AgentMeta {
                        agent_id: format!("chat-{id}"),
                        provider: account.provider,
                        account_id: account.id.clone(),
                        label: account.label.clone(),
                        cwd: Some(workspace.cwd().to_string_lossy().to_string()),
                        workspace_id: Some(workspace.workspace_id().to_string()),
                        room_id: workspace.room_id().to_string(),
                        merge_context: workspace.merge_context(),
                    });
                    command.env("CST_ROOM_TOKEN", &token);
                    room_token = Some(token);
                }
                Err(error) => eprintln!("[workspace_collab] provisioning chat ignore: {error}"),
            }
        }
        configure_provider_command(
            &mut command,
            &account,
            request.session_id.as_deref(),
            request.mode,
            model.as_deref(),
            reasoning_effort.as_deref(),
            workspace_collab_ready,
        );
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_process_window(&mut command);

        let snapshot = ChatTurnSnapshot {
            id,
            account_id: account.id.clone(),
            session_id: request.session_id.clone(),
            status: ChatTurnStatus::Running,
            started_at: metrics::now_ts(),
            finished_at: None,
            error: None,
            activities: vec![ChatActivity {
                id: "agent-start".to_string(),
                kind: "think".to_string(),
                label: format!("{} prépare la réponse", provider_label(account.provider)),
                detail: project_dir.as_ref().map(|path| display_path(path)),
                status: "running".to_string(),
            }],
            thoughts: vec![ChatThought {
                id: "agent-thinking".to_string(),
                kind: "reasoning".to_string(),
                text: format!(
                    "{} analyse la demande et prépare la prochaine étape.",
                    provider_label(account.provider)
                ),
                status: "running".to_string(),
            }],
            parts: Vec::new(),
            pending_question: None,
        };
        let turn = Arc::new(ChatTurn {
            snapshot: Mutex::new(snapshot.clone()),
            child: Mutex::new(None),
            workspace: Mutex::new(Some(workspace)),
        });

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                if let Some(token) = room_token.as_deref() {
                    room.deregister(token);
                }
                return Err(format!(
                    "Impossible de lancer {} : {error}",
                    provider_label(account.provider)
                ));
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let mut stdin = child.stdin.take();
        *turn
            .child
            .lock()
            .map_err(|_| "Etat du tour verrouillé".to_string())? = Some(child);
        self.turns
            .lock()
            .map_err(|_| "Etat des conversations verrouillé".to_string())?
            .insert(id, turn.clone());
        claim.commit();

        if let Some(mut writer) = stdin.take() {
            if let Err(error) = writer
                .write_all(prompt.as_bytes())
                .and_then(|_| writer.write_all(b"\n"))
            {
                let _ = self.stop(id, room);
                return Err(format!("Impossible d'envoyer le message : {error}"));
            }
        }

        let output_turn = turn.clone();
        let provider = account.provider;
        let stdout_thread = thread::spawn(move || {
            if let Some(stdout) = stdout {
                for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                    apply_provider_event(&output_turn, provider, &line);
                }
            }
        });

        let error_buffer = Arc::new(Mutex::new(String::new()));
        let error_writer = error_buffer.clone();
        let stderr_thread = thread::spawn(move || {
            if let Some(stderr) = stderr {
                let mut bytes = Vec::new();
                let _ = stderr.take(MAX_ERROR_BYTES as u64).read_to_end(&mut bytes);
                if let Ok(mut target) = error_writer.lock() {
                    *target = String::from_utf8_lossy(&bytes).trim().to_string();
                }
            }
        });

        let supervisor_turn = turn.clone();
        let account_id = account.id.clone();
        let account_label = account.label.clone();
        let logical_project_dir = source_project_dir
            .as_ref()
            .map(|path| path.to_string_lossy().to_string());
        let supervisor_room = room.clone();
        thread::spawn(move || {
            let exit = wait_for_child(&supervisor_turn);
            let _ = stdout_thread.join();
            let _ = stderr_thread.join();
            if let Ok(mut child) = supervisor_turn.child.lock() {
                child.take();
            }
            let stderr = error_buffer
                .lock()
                .map(|value| value.clone())
                .unwrap_or_default();
            // Le process est fini : fusionne les transcripts avant d'exposer
            // l'etat terminal, puis nettoie le home et le worktree isoles.
            if let Ok(mut workspace) = supervisor_turn.workspace.lock() {
                drop(workspace.take());
            }
            // Le provider a ecrit le cwd du worktree physique dans son JSONL.
            // Une fois le transcript fusionne dans le home canonique, remplace
            // ce chemin ephemere par le dossier logique choisi dans l'UI. La
            // prochaine reprise recreera ainsi un workspace dans la meme room.
            let completed_session_id = supervisor_turn
                .snapshot
                .lock()
                .ok()
                .and_then(|snapshot| snapshot.session_id.clone());
            if let (Some(folder), Some(session_id)) =
                (logical_project_dir.as_deref(), completed_session_id)
            {
                if let Err(error) = discussions::move_discussion_for_account(
                    account_id.clone(),
                    session_id,
                    folder.to_string(),
                ) {
                    eprintln!("[chat] dossier logique du transcript non restaure: {error}");
                }
            }
            if let Some(token) = room_token.as_deref() {
                supervisor_room.deregister(token);
            }
            finish_turn(&supervisor_turn, exit, &stderr);
            let _ = metrics::record_agent_run(
                &account_id,
                &account_label,
                snapshot.started_at,
                metrics::now_ts(),
            );
        });

        Ok(snapshot)
    }

    pub fn status(&self, id: u64, room: &RoomState) -> Result<ChatTurnSnapshot, String> {
        let turn = self
            .turns
            .lock()
            .map_err(|_| "Etat des conversations verrouillé".to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| "Tour de conversation introuvable".to_string())?;
        let mut snapshot = turn
            .snapshot
            .lock()
            .map_err(|_| "Etat du tour verrouillé".to_string())?
            .clone();
        snapshot.pending_question = room.pending_question_for_turn(id);
        Ok(snapshot)
    }

    pub fn stop(&self, id: u64, room: &RoomState) -> Result<ChatTurnSnapshot, String> {
        let turn = self
            .turns
            .lock()
            .map_err(|_| "Etat des conversations verrouillé".to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| "Tour de conversation introuvable".to_string())?;

        if let Ok(mut snapshot) = turn.snapshot.lock() {
            if snapshot.status == ChatTurnStatus::Running {
                snapshot.status = ChatTurnStatus::Cancelled;
                snapshot.finished_at = Some(metrics::now_ts());
                snapshot.error = None;
                complete_running_activities(&mut snapshot, "cancelled");
                complete_running_thoughts(&mut snapshot, "cancelled");
            }
        }
        if let Ok(mut child) = turn.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
            }
        }
        room.cancel_question_for_turn(id);
        self.status(id, room)
    }

    fn reserve_turn(&self, request: &StartChatTurnRequest) -> Result<ChatClaim, String> {
        let key = format!(
            "{}\0{}",
            request.account_id,
            request.session_id.as_deref().unwrap_or("")
        );
        let mut claims = self
            .claims
            .lock()
            .map_err(|_| "Reservations de conversations verrouillees".to_string())?;
        if claims.contains(&key) {
            return Err("Une réponse est déjà en cours dans cette conversation".to_string());
        }
        let turns = self
            .turns
            .lock()
            .map_err(|_| "Etat des conversations verrouillé".to_string())?;
        let duplicate = turns.values().any(|turn| {
            turn.snapshot
                .lock()
                .map(|snapshot| {
                    snapshot.status == ChatTurnStatus::Running
                        && snapshot.account_id == request.account_id
                        && snapshot.session_id == request.session_id
                })
                .unwrap_or(false)
        });
        if duplicate {
            Err("Une réponse est déjà en cours dans cette conversation".to_string())
        } else {
            claims.insert(key.clone());
            Ok(ChatClaim {
                claims: self.claims.clone(),
                key,
            })
        }
    }

    fn prune_finished_turns(&self) {
        let Ok(mut turns) = self.turns.lock() else {
            return;
        };
        if turns.len() <= MAX_RETAINED_TURNS {
            return;
        }
        let mut finished = turns
            .iter()
            .filter_map(|(id, turn)| {
                turn.snapshot
                    .lock()
                    .ok()
                    .and_then(|snapshot| snapshot.finished_at.map(|finished| (*id, finished)))
            })
            .collect::<Vec<_>>();
        finished.sort_by_key(|(_, timestamp)| *timestamp);
        let remove = turns.len().saturating_sub(MAX_RETAINED_TURNS);
        for (id, _) in finished.into_iter().take(remove) {
            turns.remove(&id);
        }
    }
}

impl ChatClaim {
    fn commit(self) {
        // La reservation est maintenant remplacee par le tour Running.
    }
}

impl Drop for ChatClaim {
    fn drop(&mut self) {
        if let Ok(mut claims) = self.claims.lock() {
            claims.remove(&self.key);
        }
    }
}

#[tauri::command]
pub fn start_chat_turn(
    state: State<'_, ChatTurnManager>,
    worktrees: State<'_, WorktreeManager>,
    room: State<'_, RoomState>,
    account_id: String,
    session_id: Option<String>,
    prompt: String,
    project_dir: Option<String>,
    mode: Option<ChatTurnMode>,
    model: Option<String>,
    reasoning_effort: Option<String>,
) -> Result<ChatTurnSnapshot, String> {
    state.start(
        StartChatTurnRequest {
            account_id,
            session_id,
            prompt,
            project_dir,
            mode: mode.unwrap_or_default(),
            model,
            reasoning_effort,
        },
        &worktrees,
        &room,
        None,
    )
}

#[tauri::command]
pub fn chat_turn_status(
    state: State<'_, ChatTurnManager>,
    room: State<'_, RoomState>,
    id: u64,
) -> Result<ChatTurnSnapshot, String> {
    state.status(id, &room)
}

#[tauri::command]
pub fn stop_chat_turn(
    state: State<'_, ChatTurnManager>,
    room: State<'_, RoomState>,
    id: u64,
) -> Result<ChatTurnSnapshot, String> {
    state.stop(id, &room)
}

#[tauri::command]
pub fn answer_chat_question(
    state: State<'_, ChatTurnManager>,
    room: State<'_, RoomState>,
    id: u64,
    question_id: u64,
    answers: Vec<QuestionAnswer>,
) -> Result<ChatTurnSnapshot, String> {
    room.answer_question_for_turn(id, question_id, answers)?;
    state.status(id, &room)
}

fn configure_provider_command(
    command: &mut Command,
    account: &AccountProfile,
    session_id: Option<&str>,
    mode: ChatTurnMode,
    model: Option<&str>,
    reasoning_effort: Option<&str>,
    workspace_collab_ready: bool,
) {
    match account.provider {
        Provider::Codex => {
            command.arg("exec");
            if session_id.is_some() {
                command.arg("resume");
            }
            command.arg("--json");
            // Expose uniquement les resumes prevus pour l'utilisateur. Le
            // raisonnement interne brut reste volontairement masque.
            command
                .arg("-c")
                .arg("hide_agent_reasoning=false")
                .arg("-c")
                .arg("show_raw_agent_reasoning=false");
            // Une question structuree reste un appel MCP ouvert jusqu'a la
            // reponse de l'utilisateur. Le defaut Codex (60 s) est trop court
            // pour une interaction humaine dans l'app.
            if workspace_collab_ready {
                command
                    .arg("-c")
                    .arg("mcp_servers.workspace_collab.tool_timeout_sec=86400");
            }
            if matches!(mode, ChatTurnMode::Plan | ChatTurnMode::Ask) {
                command.arg("-c").arg("sandbox_mode=\"read-only\"");
            } else if account.bypass {
                command.arg(account.provider.bypass_flag());
            }
            if let Some(model) = model {
                command.arg("--model").arg(model);
            }
            if let Some(effort) = reasoning_effort {
                command
                    .arg("-c")
                    .arg(format!("model_reasoning_effort=\"{effort}\""));
            }
            if let Some(session_id) = session_id {
                command.arg(session_id);
            }
            command.arg("-");
        }
        Provider::Claude => {
            command
                .arg("--print")
                .arg("--output-format")
                .arg("stream-json")
                .arg("--verbose");
            if let Some(session_id) = session_id {
                command.arg("--resume").arg(session_id);
            }
            match mode {
                ChatTurnMode::Plan | ChatTurnMode::Ask => {
                    command.arg("--permission-mode").arg("plan");
                }
                ChatTurnMode::Build if account.bypass => {
                    command.arg(account.provider.bypass_flag());
                }
                ChatTurnMode::Build => {
                    command.arg("--permission-mode").arg("acceptEdits");
                }
            }
            if let Some(model) = model {
                command.arg("--model").arg(model);
            }
        }
    }
}

fn selected_model(
    requested: Option<&str>,
    fallback: Option<&str>,
) -> Result<Option<String>, String> {
    let value = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| fallback.map(str::trim).filter(|value| !value.is_empty()));
    let Some(value) = value else {
        return Ok(None);
    };
    if value.chars().count() > MAX_MODEL_CHARS
        || value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
    {
        return Err("Nom de modele invalide".to_string());
    }
    Ok(Some(value.to_string()))
}

fn selected_reasoning_effort(
    provider: Provider,
    requested: Option<&str>,
    fallback: Option<&str>,
) -> Result<Option<String>, String> {
    if provider != Provider::Codex {
        return Ok(None);
    }
    let value = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| fallback.map(str::trim).filter(|value| !value.is_empty()));
    let Some(value) = value else {
        return Ok(None);
    };
    if !settings::is_valid_reasoning_effort(value) {
        return Err(format!("Intensite de raisonnement invalide : {value}"));
    }
    Ok(Some(value.to_string()))
}

fn configure_environment(
    command: &mut Command,
    settings: &AppSettings,
    account: &AccountProfile,
    account_home: &Path,
    project_dir: Option<&Path>,
) {
    command.env(
        account.provider.home_env_var(),
        account_home.to_string_lossy().to_string(),
    );
    command.env("NO_COLOR", "1");
    if let Some(project_dir) = project_dir {
        command.current_dir(project_dir);
        command.env("PWD", project_dir.to_string_lossy().to_string());
    }
    if settings.proxy_controls_enabled {
        if let Some(proxy) = account.proxy_id.as_ref().and_then(|id| {
            settings
                .proxies
                .iter()
                .find(|candidate| candidate.id == *id)
        }) {
            for key in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                command.env(key, proxy.proxy_url.clone());
            }
        }
    }
}

fn resolve_project_dir(
    account: &AccountProfile,
    requested: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    let raw = requested
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| {
            account
                .project_dir
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
        });
    let Some(raw) = raw else {
        return Ok(None);
    };
    let path = settings::expand_home(raw)?;
    if !path.is_dir() {
        return Err(format!("Dossier introuvable : {raw}"));
    }
    Ok(Some(path))
}

fn resolve_cli_program(raw: &str) -> Result<PathBuf, String> {
    let value = raw.trim().trim_matches('"');
    if value.is_empty() {
        return Err("Commande du provider vide".to_string());
    }
    let direct = PathBuf::from(value);
    if direct.is_file() {
        return Ok(direct);
    }
    if direct.components().count() > 1 {
        return Err(format!("Commande introuvable : {value}"));
    }

    let extensions: &[&str] = if cfg!(windows) {
        &["exe", "cmd", "bat", "com", ""]
    } else {
        &[""]
    };
    if let Some(path) = env::var_os("PATH") {
        for directory in env::split_paths(&path) {
            for extension in extensions {
                let name = if extension.is_empty() {
                    value.to_string()
                } else {
                    format!("{value}.{extension}")
                };
                let candidate = directory.join(name);
                if candidate.is_file() {
                    return Ok(candidate);
                }
            }
        }
    }
    Err(format!("Commande introuvable : {value}"))
}

#[cfg(windows)]
fn hide_process_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_process_window(_command: &mut Command) {}

fn wait_for_child(turn: &Arc<ChatTurn>) -> Result<ExitStatus, String> {
    loop {
        let result = turn
            .child
            .lock()
            .map_err(|_| "Processus du tour verrouillé".to_string())?
            .as_mut()
            .ok_or_else(|| "Processus du tour introuvable".to_string())?
            .try_wait()
            .map_err(|error| error.to_string())?;
        if let Some(status) = result {
            return Ok(status);
        }
        thread::sleep(Duration::from_millis(120));
    }
}

fn finish_turn(turn: &Arc<ChatTurn>, exit: Result<ExitStatus, String>, stderr: &str) {
    let Ok(mut snapshot) = turn.snapshot.lock() else {
        return;
    };
    if snapshot.status == ChatTurnStatus::Cancelled {
        return;
    }
    snapshot.finished_at = Some(metrics::now_ts());
    match exit {
        Ok(status) if status.success() => {
            snapshot.status = ChatTurnStatus::Completed;
            complete_running_activities(&mut snapshot, "complete");
            complete_running_thoughts(&mut snapshot, "complete");
            complete_running_parts(&mut snapshot, "complete");
            remove_final_commentary(&mut snapshot);
        }
        Ok(status) => {
            snapshot.status = ChatTurnStatus::Failed;
            let fallback = format!("Le provider s'est arrêté avec le code {:?}", status.code());
            snapshot.error = Some(first_non_empty(&snapshot.error, stderr, &fallback));
            complete_running_activities(&mut snapshot, "error");
            complete_running_thoughts(&mut snapshot, "error");
            complete_running_parts(&mut snapshot, "error");
        }
        Err(error) => {
            snapshot.status = ChatTurnStatus::Failed;
            snapshot.error = Some(first_non_empty(&snapshot.error, stderr, &error));
            complete_running_activities(&mut snapshot, "error");
            complete_running_thoughts(&mut snapshot, "error");
            complete_running_parts(&mut snapshot, "error");
        }
    }
}

fn first_non_empty(existing: &Option<String>, stderr: &str, fallback: &str) -> String {
    existing
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| (!stderr.trim().is_empty()).then_some(stderr.trim()))
        .unwrap_or(fallback)
        .chars()
        .take(1200)
        .collect()
}

fn complete_running_activities(snapshot: &mut ChatTurnSnapshot, status: &str) {
    for activity in &mut snapshot.activities {
        if activity.status == "running" || activity.status == "queued" {
            activity.status = status.to_string();
        }
    }
}

fn complete_running_thoughts(snapshot: &mut ChatTurnSnapshot, status: &str) {
    for thought in &mut snapshot.thoughts {
        if thought.status == "running" || thought.status == "queued" {
            thought.status = status.to_string();
        }
    }
}

fn complete_running_parts(snapshot: &mut ChatTurnSnapshot, status: &str) {
    for part in &mut snapshot.parts {
        if part.status == "running" || part.status == "queued" {
            part.status = status.to_string();
        }
    }
}

fn remove_final_commentary(snapshot: &mut ChatTurnSnapshot) {
    if let Some(index) = snapshot
        .thoughts
        .iter()
        .rposition(|thought| thought.kind == "commentary")
    {
        snapshot.thoughts.remove(index);
    }
}

fn apply_provider_event(turn: &Arc<ChatTurn>, provider: Provider, line: &str) {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return;
    };
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    let Ok(mut snapshot) = turn.snapshot.lock() else {
        return;
    };

    if event_type == "thread.started" {
        snapshot.session_id = value
            .get("thread_id")
            .and_then(Value::as_str)
            .map(ToString::to_string);
        mark_agent_started(&mut snapshot);
        return;
    }
    if provider == Provider::Claude && event_type == "system" {
        if let Some(session_id) = value.get("session_id").and_then(Value::as_str) {
            snapshot.session_id = Some(session_id.to_string());
            mark_agent_started(&mut snapshot);
        }
        return;
    }
    if provider == Provider::Claude && event_type == "assistant" {
        if let Some(part) = claude_part_from_event(&value) {
            upsert_part(&mut snapshot, part);
        }
        if let Some(thought) = claude_commentary_from_event(&value) {
            upsert_thought(&mut snapshot, thought);
        }
        return;
    }
    if event_type == "turn.failed" || event_type == "error" {
        snapshot.error = event_error(&value);
        return;
    }
    if event_type != "item.started" && event_type != "item.completed" {
        return;
    }
    let Some(item) = value.get("item") else {
        return;
    };
    let completed = event_type == "item.completed";
    if let Some(part) = part_from_item(item, completed) {
        upsert_part(&mut snapshot, part);
    }
    if let Some(thought) = thought_from_item(item, completed) {
        upsert_thought(&mut snapshot, thought);
    }
    if let Some(activity) = activity_from_item(item, completed) {
        upsert_activity(&mut snapshot, activity);
    }
}

fn part_status(item: &Value, completed: bool) -> &'static str {
    let failed = item
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| matches!(status, "failed" | "error"));
    if failed {
        "error"
    } else if completed {
        "complete"
    } else {
        "running"
    }
}

fn part_from_item(item: &Value, completed: bool) -> Option<ChatPart> {
    let item_kind = item.get("type").and_then(Value::as_str)?;
    let id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(item_kind)
        .to_string();
    let status = part_status(item, completed).to_string();

    if matches!(item_kind, "agent_message" | "reasoning") {
        let text = safe_item_text(item)?;
        return Some(ChatPart {
            id,
            kind: if item_kind == "reasoning" {
                "reasoning".to_string()
            } else {
                "text".to_string()
            },
            status,
            text: Some(text),
            tool: None,
            title: None,
            subtitle: None,
            detail: None,
            output: None,
        });
    }

    let (tool, title, subtitle, detail, output) = match item_kind {
        "command_execution" => {
            let command = item.get("command").and_then(Value::as_str);
            let output = first_item_string(item, &["aggregated_output", "output", "stdout"]);
            (
                "command",
                if completed {
                    "Commande executee"
                } else {
                    "Execution d'une commande"
                },
                command.map(short_detail),
                command.map(limit_part_detail),
                output.map(limit_part_detail),
            )
        }
        "file_change" => {
            let changes = item.get("changes");
            let count = changes.and_then(Value::as_array).map(Vec::len).unwrap_or(0);
            (
                "edit",
                if completed {
                    "Fichiers modifies"
                } else {
                    "Modification de fichiers"
                },
                Some(format!("{count} changement(s)")),
                changes
                    .and_then(compact_json)
                    .map(|value| limit_part_detail(&value)),
                None,
            )
        }
        "mcp_tool_call" => {
            let name = item
                .get("tool")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str);
            let detail = item
                .get("arguments")
                .or_else(|| item.get("input"))
                .and_then(compact_json)
                .map(|value| limit_part_detail(&value));
            let output = item
                .get("result")
                .or_else(|| item.get("output"))
                .or_else(|| item.get("error"))
                .and_then(compact_json)
                .map(|value| limit_part_detail(&value));
            (
                "tool",
                "Utilisation d'un outil",
                name.map(short_detail),
                detail,
                output,
            )
        }
        "web_search" => {
            let query = item.get("query").and_then(Value::as_str);
            (
                "search",
                "Recherche web",
                query.map(short_detail),
                query.map(limit_part_detail),
                None,
            )
        }
        "plan" => (
            "plan",
            "Mise a jour du plan",
            None,
            compact_json(item).map(|value| limit_part_detail(&value)),
            None,
        ),
        _ => return None,
    };

    Some(ChatPart {
        id,
        kind: "tool".to_string(),
        status,
        text: None,
        tool: Some(tool.to_string()),
        title: Some(title.to_string()),
        subtitle,
        detail,
        output,
    })
}

fn claude_part_from_event(value: &Value) -> Option<ChatPart> {
    let message = value.get("message")?;
    let text = safe_text_value(message.get("content")?)?;
    Some(ChatPart {
        id: message
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("claude-commentary")
            .to_string(),
        kind: "text".to_string(),
        status: "complete".to_string(),
        text: Some(text),
        tool: None,
        title: None,
        subtitle: None,
        detail: None,
        output: None,
    })
}

fn compact_json(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(text) => Some(text.to_string()),
        _ => serde_json::to_string_pretty(value).ok(),
    }
}

fn first_item_string<'a>(item: &'a Value, keys: &[&str]) -> Option<&'a str> {
    keys.iter()
        .find_map(|key| item.get(*key).and_then(Value::as_str))
}

fn limit_part_detail(value: &str) -> String {
    let clipped = value
        .chars()
        .take(MAX_PART_DETAIL_CHARS)
        .collect::<String>();
    if value.chars().count() > MAX_PART_DETAIL_CHARS {
        format!("{clipped}...")
    } else {
        clipped
    }
}

fn mark_agent_started(snapshot: &mut ChatTurnSnapshot) {
    if let Some(activity) = snapshot
        .activities
        .iter_mut()
        .find(|item| item.id == "agent-start")
    {
        activity.label = "Conversation démarrée".to_string();
        activity.status = "complete".to_string();
    }
}

fn event_error(value: &Value) -> Option<String> {
    value
        .get("error")
        .and_then(|error| {
            error
                .get("message")
                .and_then(Value::as_str)
                .or_else(|| error.as_str())
        })
        .or_else(|| value.get("message").and_then(Value::as_str))
        .map(|message| message.chars().take(1200).collect())
}

fn thought_from_item(item: &Value, completed: bool) -> Option<ChatThought> {
    let kind = item.get("type").and_then(Value::as_str)?;
    if !matches!(kind, "agent_message" | "reasoning") {
        return None;
    }
    let failed = item
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| matches!(status, "failed" | "error"));
    let status = if failed {
        "error"
    } else if completed {
        "complete"
    } else {
        "running"
    };
    let text = safe_item_text(item);
    if kind == "agent_message" && text.is_none() {
        return None;
    }
    let text = text.unwrap_or_else(|| "Analyse en cours…".to_string());
    let id = if kind == "reasoning" && text == "Analyse en cours…" {
        "agent-thinking".to_string()
    } else {
        item.get("id")
            .and_then(Value::as_str)
            .unwrap_or(kind)
            .to_string()
    };
    Some(ChatThought {
        id,
        kind: if kind == "reasoning" {
            "reasoning".to_string()
        } else {
            "commentary".to_string()
        },
        text,
        status: status.to_string(),
    })
}

fn claude_commentary_from_event(value: &Value) -> Option<ChatThought> {
    let message = value.get("message")?;
    let text = safe_text_value(message.get("content")?)?;
    let id = message
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or("claude-commentary")
        .to_string();
    Some(ChatThought {
        id,
        kind: "commentary".to_string(),
        text,
        status: "complete".to_string(),
    })
}

fn safe_item_text(item: &Value) -> Option<String> {
    ["text", "summary_text", "summary", "content"]
        .iter()
        .find_map(|key| item.get(*key).and_then(safe_text_value))
}

fn safe_text_value(value: &Value) -> Option<String> {
    let fragments = match value {
        Value::String(text) => vec![text.trim().to_string()],
        Value::Array(values) => values
            .iter()
            .filter_map(|value| match value {
                Value::String(text) => Some(text.trim().to_string()),
                Value::Object(object) => object
                    .get("text")
                    .or_else(|| object.get("summary_text"))
                    .and_then(Value::as_str)
                    .map(|text| text.trim().to_string()),
                _ => None,
            })
            .collect(),
        Value::Object(object) => object
            .get("text")
            .or_else(|| object.get("summary_text"))
            .and_then(Value::as_str)
            .map(|text| vec![text.trim().to_string()])
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    let combined = fragments
        .into_iter()
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    if combined.is_empty() {
        return None;
    }
    let truncated = combined.chars().take(MAX_THOUGHT_CHARS).collect::<String>();
    Some(if combined.chars().count() > MAX_THOUGHT_CHARS {
        format!("{truncated}…")
    } else {
        truncated
    })
}

fn activity_from_item(item: &Value, completed: bool) -> Option<ChatActivity> {
    let kind = item.get("type").and_then(Value::as_str)?;
    if matches!(kind, "agent_message" | "reasoning") {
        return None;
    }
    let id = item
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or(kind)
        .to_string();
    let failed = item
        .get("status")
        .and_then(Value::as_str)
        .is_some_and(|status| matches!(status, "failed" | "error"));
    let status = if failed {
        "error"
    } else if completed {
        "complete"
    } else {
        "running"
    };
    let (ui_kind, label, detail) = match kind {
        "command_execution" => (
            "command",
            if completed {
                "Commande exécutée"
            } else {
                "Exécution d'une commande"
            },
            item.get("command")
                .and_then(Value::as_str)
                .map(short_detail),
        ),
        "file_change" => (
            "edit",
            if completed {
                "Fichiers modifiés"
            } else {
                "Modification de fichiers"
            },
            item.get("changes")
                .and_then(Value::as_array)
                .map(|changes| format!("{} changement(s)", changes.len())),
        ),
        "mcp_tool_call" => (
            "tool",
            "Utilisation d'un outil",
            item.get("tool")
                .or_else(|| item.get("name"))
                .and_then(Value::as_str)
                .map(short_detail),
        ),
        "web_search" => (
            "search",
            "Recherche web",
            item.get("query").and_then(Value::as_str).map(short_detail),
        ),
        "plan" => ("plan", "Mise à jour du plan", None),
        _ => return None,
    };
    Some(ChatActivity {
        id,
        kind: ui_kind.to_string(),
        label: label.to_string(),
        detail,
        status: status.to_string(),
    })
}

fn upsert_activity(snapshot: &mut ChatTurnSnapshot, activity: ChatActivity) {
    if let Some(existing) = snapshot
        .activities
        .iter_mut()
        .find(|item| item.id == activity.id)
    {
        *existing = activity;
        return;
    }
    if snapshot.activities.len() < MAX_ACTIVITIES {
        snapshot.activities.push(activity);
    }
}

fn upsert_thought(snapshot: &mut ChatTurnSnapshot, thought: ChatThought) {
    if thought.id != "agent-thinking" {
        if let Some(starter) = snapshot
            .thoughts
            .iter_mut()
            .find(|item| item.id == "agent-thinking" && item.status == "running")
        {
            starter.status = "complete".to_string();
        }
    }
    if let Some(existing) = snapshot
        .thoughts
        .iter_mut()
        .find(|item| item.id == thought.id)
    {
        *existing = thought;
        return;
    }
    if snapshot.thoughts.len() >= MAX_THOUGHTS {
        snapshot.thoughts.remove(0);
    }
    snapshot.thoughts.push(thought);
}

fn upsert_part(snapshot: &mut ChatTurnSnapshot, part: ChatPart) {
    if let Some(existing) = snapshot.parts.iter_mut().find(|item| item.id == part.id) {
        *existing = part;
        return;
    }
    if snapshot.parts.len() >= MAX_PARTS {
        snapshot.parts.remove(0);
    }
    snapshot.parts.push(part);
}

fn short_detail(value: &str) -> String {
    let flattened = value.split_whitespace().collect::<Vec<_>>().join(" ");
    if flattened.chars().count() > 120 {
        format!("{}…", flattened.chars().take(117).collect::<String>())
    } else {
        flattened
    }
}

fn provider_label(provider: Provider) -> &'static str {
    match provider {
        Provider::Codex => "Codex",
        Provider::Claude => "Claude",
    }
}

fn display_path(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(ToString::to_string)
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_account(provider: Provider) -> AccountProfile {
        AccountProfile {
            id: "account".to_string(),
            label: "Compte test".to_string(),
            provider,
            codex_home: ".codex-test".to_string(),
            project_dir: None,
            proxy_id: None,
            startup_command: None,
            limits: Default::default(),
            bypass: true,
            model: Some("modele-par-defaut".to_string()),
            reasoning_effort: Some("medium".to_string()),
        }
    }

    fn test_turn() -> Arc<ChatTurn> {
        Arc::new(ChatTurn {
            snapshot: Mutex::new(ChatTurnSnapshot {
                id: 1,
                account_id: "account".to_string(),
                session_id: None,
                status: ChatTurnStatus::Running,
                started_at: 0,
                finished_at: None,
                error: None,
                activities: Vec::new(),
                thoughts: Vec::new(),
                parts: Vec::new(),
                pending_question: None,
            }),
            child: Mutex::new(None),
            workspace: Mutex::new(None),
        })
    }

    #[test]
    fn codex_events_capture_thread_and_tools() {
        let turn = test_turn();
        apply_provider_event(
            &turn,
            Provider::Codex,
            r#"{"type":"thread.started","thread_id":"0199a213-81c0-7800-8aa1-bbab2a035a53"}"#,
        );
        apply_provider_event(
            &turn,
            Provider::Codex,
            r#"{"type":"item.started","item":{"id":"item_1","type":"command_execution","command":"npm test","status":"in_progress"}}"#,
        );
        apply_provider_event(
            &turn,
            Provider::Codex,
            r#"{"type":"item.completed","item":{"id":"item_1","type":"command_execution","command":"npm test","status":"completed"}}"#,
        );
        apply_provider_event(
            &turn,
            Provider::Codex,
            r#"{"type":"item.completed","item":{"id":"reason_1","type":"reasoning","summary":[{"text":"Je vérifie les tests avant de conclure."}]}}"#,
        );
        apply_provider_event(
            &turn,
            Provider::Codex,
            r#"{"type":"item.completed","item":{"id":"message_1","type":"agent_message","text":"Les tests sont terminés."}}"#,
        );

        let snapshot = turn.snapshot.lock().unwrap();
        assert_eq!(
            snapshot.session_id.as_deref(),
            Some("0199a213-81c0-7800-8aa1-bbab2a035a53")
        );
        assert_eq!(snapshot.activities.len(), 1);
        assert_eq!(snapshot.activities[0].status, "complete");
        assert_eq!(snapshot.thoughts.len(), 2);
        assert_eq!(snapshot.thoughts[0].kind, "reasoning");
        assert_eq!(
            snapshot.thoughts[0].text,
            "Je vérifie les tests avant de conclure."
        );
        assert_eq!(snapshot.thoughts[1].kind, "commentary");
        assert_eq!(snapshot.parts.len(), 3);
        assert_eq!(snapshot.parts[0].kind, "tool");
        assert_eq!(snapshot.parts[0].status, "complete");
        assert_eq!(snapshot.parts[1].kind, "reasoning");
        assert_eq!(snapshot.parts[2].kind, "text");
    }

    #[test]
    fn codex_command_applies_chat_model_and_effort_overrides() {
        let account = test_account(Provider::Codex);
        let mut command = Command::new("codex");
        configure_provider_command(
            &mut command,
            &account,
            None,
            ChatTurnMode::Build,
            Some("gpt-chat-test"),
            Some("ultra"),
            true,
        );

        let args = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(args
            .windows(2)
            .any(|pair| pair == ["--model", "gpt-chat-test"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-c", "model_reasoning_effort=\"ultra\""]));
        assert!(args
            .windows(2)
            .any(|pair| { pair == ["-c", "mcp_servers.workspace_collab.tool_timeout_sec=86400"] }));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-c", "hide_agent_reasoning=false"]));
        assert!(args
            .windows(2)
            .any(|pair| pair == ["-c", "show_raw_agent_reasoning=false"]));
    }

    #[test]
    fn thought_parser_never_falls_back_to_encrypted_reasoning() {
        let turn = test_turn();
        apply_provider_event(
            &turn,
            Provider::Codex,
            r#"{"type":"item.completed","item":{"id":"reason_1","type":"reasoning","summary":[],"encrypted_content":"private-payload"}}"#,
        );

        let snapshot = turn.snapshot.lock().unwrap();
        assert_eq!(snapshot.thoughts.len(), 1);
        assert_eq!(snapshot.thoughts[0].id, "agent-thinking");
        assert_eq!(snapshot.thoughts[0].text, "Analyse en cours…");
        assert!(!snapshot.thoughts[0].text.contains("private-payload"));
        assert!(
            snapshot.parts.is_empty(),
            "un raisonnement chiffre sans resume visible ne devient jamais une part"
        );
    }

    #[test]
    fn chat_overrides_are_validated_and_remain_backward_compatible() {
        let request: StartChatTurnRequest = serde_json::from_value(serde_json::json!({
            "accountId": "account",
            "prompt": "Bonjour"
        }))
        .unwrap();
        assert_eq!(request.model, None);
        assert_eq!(request.reasoning_effort, None);

        assert_eq!(
            selected_model(Some(" gpt-chat-test "), Some("fallback")).unwrap(),
            Some("gpt-chat-test".to_string())
        );
        assert!(selected_model(Some("modele invalide"), None).is_err());
        assert_eq!(
            selected_reasoning_effort(Provider::Codex, Some("max"), None).unwrap(),
            Some("max".to_string())
        );
        assert_eq!(
            selected_reasoning_effort(Provider::Codex, Some("ultra"), None).unwrap(),
            Some("ultra".to_string())
        );
        assert!(selected_reasoning_effort(Provider::Codex, Some("ultra mode"), None).is_err());
        assert_eq!(
            selected_reasoning_effort(Provider::Claude, Some("high"), Some("medium")).unwrap(),
            None
        );
    }

    #[test]
    fn conversation_claim_closes_the_check_then_insert_race() {
        let manager = ChatTurnManager::default();
        let request = StartChatTurnRequest {
            account_id: "account".to_string(),
            session_id: Some("0199a213-81c0-7800-8aa1-bbab2a035a53".to_string()),
            prompt: "test".to_string(),
            project_dir: None,
            mode: ChatTurnMode::Build,
            model: None,
            reasoning_effort: None,
        };
        let claim = manager.reserve_turn(&request).unwrap();
        assert!(manager.reserve_turn(&request).is_err());
        drop(claim);
        assert!(manager.reserve_turn(&request).is_ok());
    }
}
