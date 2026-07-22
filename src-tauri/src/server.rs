use crate::{
    account_usage,
    auth::{self, AuthIdentity, AuthManager},
    autonomous::{
        AddAutonomousMemoryRequest, ApplyAutonomousReviewPolicyRequest, AutonomousAgentAction,
        AutonomousAgentManager, AutonomousAgentStatus, ControlAutonomousAgentRequest,
        CreateAutonomousAgentRequest, ReassignAutonomousAgentAccountRequest,
        ScheduleAutonomousAgentRequest, SendAutonomousAgentMessageRequest,
        UpdateAutonomousAgentRequest,
    },
    chat::{ChatTurnManager, StartChatTurnRequest, MAX_CHAT_TURN_REQUEST_BYTES},
    chat_model_tools::{
        self, ApplyAutonomousAgentPolicyToolArguments, AutonomousAgentToolContext,
        ChatModelToolServerConfig, ChatOpenRequestRegistry, ChatToolCapabilityRegistry,
        CreateAutonomousAgentToolArguments, CreateChatToolArguments,
        UpdateAutonomousAgentToolArguments, ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME,
        APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME, AUTONOMOUS_AGENT_TOOL_NAME, CREATE_CHAT_TOOL_NAME,
        PAUSE_AUTONOMOUS_AGENT_TOOL_NAME, UPDATE_AUTONOMOUS_AGENT_TOOL_NAME,
    },
    creative_accounts::{self, ConnectCreativeAccountRequest, CreativeAccountIdRequest},
    discussions,
    doctolib_lab::{self, DoctolibLabManager, DoctolibLabSearchRequest},
    forum::{ForumAuthor, ForumError, ForumManager},
    git_docker_environment::{self, CreateGitDockerEnvironmentRequest},
    image_generation::{self, ImageGenerationRequest, ImageGenerationStatusRequest},
    kombai::{KombaiManager, KombaiStatus},
    metrics,
    mobile_push::{self, ConfigureMobilePushRequest, RegisterMobilePushDeviceRequest},
    orchestration::{
        ControlOrchestrationRequest, CreateOrchestrationRequest, OrchestrationManager,
        PromoteAutonomousAgentRequest, ReassignOrchestrationAccountRequest,
    },
    pool::{self, AccountStatus, PoolManager},
    private_messages::{
        PrivateMessageError, PrivateMessageImageRequest, PrivateMessageManager, PrivateMessageUser,
        MAX_PRIVATE_MESSAGE_REQUEST_BYTES,
    },
    runtime_sync::RuntimeSync,
    settings::{self, AccountProfile, AppSettings, Provider},
    telegram_notifications::{
        self, ConnectTelegramManagerRequest, ConnectTelegramRequest,
        PrepareManagedTelegramBotRequest,
    },
    video_generation::{self, VideoGenerationRequest, VideoGenerationStatusRequest},
    voice,
    vps_deploy::{
        StartGoogleCloudDeployRequest, StartVpsDeployRequest, VpsDeployError, VpsDeployManager,
    },
    whatsapp_notifications::{self, ConnectWhatsAppRequest},
    work_time,
    workspace_access::{WorkspaceAccessError, WorkspaceAccessErrorKind, WorkspaceAccessManager},
};
use axum::{
    body::Bytes,
    extract::{
        rejection::JsonRejection,
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path as AxumPath, Query, Request, State,
    },
    http::{
        header::{CACHE_CONTROL, CONTENT_TYPE},
        HeaderMap, HeaderValue, StatusCode,
    },
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use futures_util::{SinkExt, StreamExt};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI64, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};
use tokio::sync::broadcast;
use tower_http::{compression::CompressionLayer, cors::CorsLayer, services::ServeDir};
use uuid::Uuid;

const WORKSPACE_RETENTION_SECS: u64 = 7 * 24 * 60 * 60;
const DEFAULT_DRAIN_LEASE_SECS: u64 = 20;
const MAX_DRAIN_LEASE_SECS: u64 = 60;
// Le receiver conserve les sorties produites entre le demarrage du PTY et
// l'ouverture du WebSocket par le navigateur. Une capacite genereuse evite de
// perdre l'ecran ANSI initial d'une TUI telle que Codex.
const TERMINAL_EVENT_BUFFER: usize = 2_048;

/// Version du binaire, exposee par `/healthz`, `/api/health` et `--version`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
/// Commit git embarque au build (voir `build.rs`). "unknown" si indisponible.
pub const COMMIT: &str = match option_env!("CST_GIT_COMMIT") {
    Some(value) => value,
    None => "unknown",
};

#[derive(Debug, Clone)]
pub struct ServerConfig {
    bind: String,
    data_dir: PathBuf,
    static_dir: PathBuf,
    admin_token: String,
    git_pat: String,
    public_base_url: String,
    node_id: String,
    node_label: String,
    node_capacity: usize,
    /// Racine autorisee pour le navigateur de dossiers et les workspaces
    /// pointant un dossier EXISTANT (`workspacePath`). Definie via
    /// `CST_WORKSPACES_ROOT` (defaut : dossier personnel). Toute navigation ou
    /// selection en dehors de cette racine est refusee. Stockee sous forme
    /// canonique pour une comparaison de prefixe fiable.
    workspaces_root: PathBuf,
}

#[derive(Clone)]
struct ServerState {
    config: ServerConfig,
    auth: AuthManager,
    terminals: RemoteTerminalManager,
    chat: ChatTurnManager,
    chat_tool_capabilities: ChatToolCapabilityRegistry,
    chat_open_requests: ChatOpenRequestRegistry,
    autonomous: AutonomousAgentManager,
    orchestration: OrchestrationManager,
    forum: ForumManager,
    private_messages: PrivateMessageManager,
    workspace_access: WorkspaceAccessManager,
    doctolib_lab: Arc<DoctolibLabManager>,
    kombai: Arc<KombaiManager>,
    kombai_owner: Arc<Mutex<Option<String>>>,
    vps_deploy: VpsDeployManager,
    started_at: i64,
    /// Echeance Unix de la courte lease de drain. Une lease bornee evite qu'un
    /// updater interrompu laisse le noeud ferme aux autres agents. Les sessions
    /// deja ouvertes continuent et un redemarrage repart toujours non draine.
    drain_until: Arc<AtomicI64>,
}

#[derive(Debug, Clone)]
enum RequestActor {
    Administrator,
    User(AuthIdentity),
}

impl RequestActor {
    fn owner_id(&self) -> &str {
        match self {
            Self::Administrator => "server-admin",
            Self::User(identity) => &identity.id,
        }
    }

    fn user(&self) -> Option<&AuthIdentity> {
        match self {
            Self::Administrator => None,
            Self::User(identity) => Some(identity),
        }
    }

    fn is_administrator(&self) -> bool {
        matches!(self, Self::Administrator)
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartTerminalRequest {
    id: Option<u64>,
    account_id: String,
    /// Depot Git a cloner normalement sur le serveur. Les clones inutilises
    /// depuis sept jours sont nettoyes. Ignore si `workspace_path` est fourni.
    #[serde(default)]
    repo_url: Option<String>,
    /// Dossier EXISTANT sur le serveur (dans la racine autorisee) a utiliser
    /// directement comme cwd. Prioritaire sur `repo_url` ; jamais clone ni purge.
    #[serde(default)]
    workspace_path: Option<String>,
    branch: Option<String>,
    cols: u16,
    rows: u16,
    command: Option<String>,
    #[serde(default)]
    login_only: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StartTerminalResponse {
    id: u64,
    workspace_id: String,
    workspace_path: String,
}

/// Les anciennes pages web peuvent rester ouvertes pendant un deploiement et
/// continuer d'envoyer le login OAuth classique. Sur un noeud serveur, son
/// callback localhost revient vers le navigateur de l'utilisateur et laisse le
/// terminal bloque. Le serveur corrige donc les deux commandes Codex integrees
/// historiques, sans toucher aux commandes personnalisees ni aux autres
/// providers.
fn normalize_remote_login_command(provider: Provider, command: Option<String>) -> Option<String> {
    let command = command?;
    if provider != Provider::Codex {
        return Some(command);
    }

    match command.trim() {
        "codex login" => Some("codex login --device-auth".to_string()),
        "codex logout; codex login" => Some("codex logout; codex login --device-auth".to_string()),
        _ => Some(command),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HealthResponse {
    ok: bool,
    node_id: String,
    node_label: String,
    public_base_url: String,
    version: &'static str,
    commit: &'static str,
    ready: bool,
    draining: bool,
    active_terminals: usize,
    active_chat_turns: usize,
    available_account_ids: Vec<String>,
    capacity: usize,
    started_at: i64,
}

/// Liveness minimale NON authentifiee (`GET /healthz`), pour l'updater,
/// l'orchestrateur rolling et le routage client. Aucun secret : ni token, ni
/// compte, ni usage.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct LivenessResponse {
    ok: bool,
    node_id: String,
    version: &'static str,
    commit: &'static str,
    ready: bool,
    draining: bool,
    active_terminals: usize,
    active_chat_turns: usize,
    capacity: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DrainRequest {
    draining: bool,
    /// Lease courte, renouvelee par l'appelant si necessaire. Bornee cote
    /// serveur pour qu'un agent mort ne puisse pas verrouiller le noeud.
    #[serde(default)]
    ttl_seconds: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ImportAccountRequest {
    content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureAccountHomeRequest {
    codex_home: String,
    /// Absent => Codex (retro-compat des clients existants).
    #[serde(default)]
    provider: Option<settings::Provider>,
    #[serde(default = "default_true")]
    bypass: bool,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    reasoning_effort: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct WriteTerminalRequest {
    data: String,
}

#[derive(Debug, Deserialize)]
struct ResizeTerminalRequest {
    cols: u16,
    rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KombaiStartRequest {
    project_dir: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DoctolibLabConfirmRequest {
    proposal_id: String,
    #[serde(default)]
    add_to_google_calendar: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyDiscussionRequest {
    session_id: String,
    source_account_id: String,
    target_account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MoveDiscussionRequest {
    account_id: String,
    session_id: String,
    workspace_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameDiscussionRequest {
    account_id: String,
    session_id: String,
    title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimSessionRequest {
    account_id: String,
    #[serde(default)]
    terminal_id: Option<u64>,
    after_unix: i64,
    #[serde(default)]
    exclude_session_ids: Vec<String>,
    #[serde(default)]
    match_session_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteDiscussionRequest {
    account_id: String,
    session_id: String,
    #[serde(default)]
    archive: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompactChatSessionRequest {
    account_id: String,
    session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportDiscussionRequest {
    account_id: String,
    session_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceView {
    id: String,
    path: String,
    modified_at: Option<i64>,
    retained_until: Option<i64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsListResponse {
    /// Racine autorisee (borne haute de navigation).
    root: String,
    /// Dossier courant liste.
    path: String,
    /// Dossier parent, ou `null` si `path` est deja la racine.
    parent: Option<String>,
    entries: Vec<FsEntry>,
}

#[derive(Debug, Deserialize)]
struct FsListQuery {
    path: Option<String>,
}

#[derive(Debug, Deserialize)]
struct CreateWorkspaceRequest {
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestWorkspaceAccessRequest {
    share_code: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ServerWsMessage {
    Data {
        id: u64,
        data: String,
    },
    Exit {
        id: u64,
    },
    Error {
        id: u64,
        message: String,
    },
    Status {
        id: u64,
        status: String,
        workspace_id: String,
        workspace_path: String,
    },
    Pong {
        id: u64,
    },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ClientWsMessage {
    Input { data: String },
    Resize { cols: u16, rows: u16 },
    Stop,
    Ping,
}

#[derive(Clone, Default)]
struct RemoteTerminalManager {
    sessions: Arc<Mutex<HashMap<u64, Arc<RemoteTerminalSession>>>>,
    reservations: Arc<Mutex<HashSet<u64>>>,
    next_id: Arc<AtomicU64>,
}

struct RemoteTerminalSession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    events: broadcast::Sender<ServerWsMessage>,
    pending_events: Mutex<Option<broadcast::Receiver<ServerWsMessage>>>,
    started_at: i64,
    owner_id: String,
    account_id: String,
    account_label: String,
    workspace_id: String,
    workspace_path: PathBuf,
    recorded_end: AtomicBool,
}

impl Drop for RemoteTerminalSession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

struct RemoteTerminalIdReservation {
    reservations: Arc<Mutex<HashSet<u64>>>,
    id: u64,
}

impl RemoteTerminalManager {
    fn active_count(&self) -> usize {
        self.sessions
            .lock()
            .map(|sessions| sessions.len())
            .unwrap_or_default()
    }

    fn active_workspace_ids(&self) -> HashSet<String> {
        self.sessions
            .lock()
            .map(|sessions| {
                sessions
                    .values()
                    .map(|session| session.workspace_id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn reserve_id(&self, requested: Option<u64>) -> Result<RemoteTerminalIdReservation, String> {
        let mut reservations = self
            .reservations
            .lock()
            .map_err(|_| "Reservations terminal verrouillees".to_string())?;
        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "Etat terminal verrouille".to_string())?;
        let id = if let Some(id) = requested {
            if reservations.contains(&id) || sessions.contains_key(&id) {
                return Err(format!("Identifiant terminal deja vivant: {id}"));
            }
            id
        } else {
            loop {
                let candidate = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
                if !reservations.contains(&candidate) && !sessions.contains_key(&candidate) {
                    break candidate;
                }
            }
        };
        drop(sessions);
        reservations.insert(id);
        drop(reservations);
        Ok(RemoteTerminalIdReservation {
            reservations: self.reservations.clone(),
            id,
        })
    }

    fn active_agent_runs(&self) -> Vec<metrics::ActiveAgentRun> {
        let Ok(guard) = self.sessions.lock() else {
            return Vec::new();
        };

        guard
            .values()
            .filter(|session| !session.recorded_end.load(Ordering::Relaxed))
            .map(|session| metrics::ActiveAgentRun {
                started_at: session.started_at,
            })
            .collect()
    }

    fn start(
        &self,
        config: &ServerConfig,
        request: StartTerminalRequest,
        owner_id: String,
        authorized_workspace: Option<PathBuf>,
        generated_workspaces_root: PathBuf,
    ) -> Result<StartTerminalResponse, String> {
        let settings = settings::load_settings_for_terminal()?;
        let account = settings
            .accounts
            .iter()
            .find(|candidate| candidate.id == request.account_id)
            .cloned()
            .ok_or_else(|| "Compte introuvable".to_string())?;
        let provider = account.provider;
        let proxy = if settings.proxy_controls_enabled {
            account.proxy_id.as_ref().and_then(|id| {
                settings
                    .proxies
                    .iter()
                    .find(|candidate| candidate.id == *id)
            })
        } else {
            None
        };

        let id_reservation = self.reserve_id(request.id)?;
        let id = id_reservation.id;
        let canonical_home = settings::expand_home(&account.codex_home)?;
        fs::create_dir_all(&canonical_home).map_err(|error| error.to_string())?;

        // Un dossier existant est utilise directement. Un depot distant est
        // clone normalement avec sa branche et son upstream : les commandes Git
        // standard (pull, push, rebase) fonctionnent directement.
        let selected_workspace_requested = request
            .workspace_path
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty());

        let (repo_dir, workspace_id, repo_label) = if request.login_only {
            // Le login reste hors de tout projet et utilise uniquement le home
            // isole du compte. La racine des workspaces demeure obligatoire
            // pour chaque terminal de travail.
            let label = display_path(&canonical_home);
            let workspace_id = workspace_id_for_dir(&canonical_home);
            (canonical_home.clone(), workspace_id, label)
        } else if let Some(dir) = authorized_workspace {
            let label = display_path(&dir);
            let workspace_id = workspace_id_for_dir(&dir);
            (dir, workspace_id, label)
        } else {
            if selected_workspace_requested {
                return Err("Acces refuse a cet environnement".to_string());
            }
            let repo_url = request.repo_url.as_deref().unwrap_or("").trim();
            if repo_url.is_empty() {
                return Err("Environnement obligatoire avant d'ouvrir un terminal".to_string());
            } else {
                let workspace_id = format!("{id}-{}", Uuid::new_v4().simple());
                let repo_dir = generated_workspaces_root.join(&workspace_id).join("repo");
                let repo_label = prepare_workspace(
                    repo_url,
                    request.branch.as_deref(),
                    &repo_dir,
                    &config.git_pat,
                )
                .map_err(|error| redact_secrets(&error, config))?;
                (repo_dir, workspace_id, repo_label)
            }
        };

        let account_home = canonical_home;

        // Synchronise a chaque demarrage la config propre au compte, dans le
        // format du provider (Codex config.toml / Claude settings.json). Un echec
        // ne bloque pas le PTY.
        if let Err(error) = provider.write_account_config(
            &account_home,
            account.bypass,
            account.model.as_deref(),
            account.reasoning_effort.as_deref(),
        ) {
            eprintln!(
                "[config] config {} non ecrite pour {}: {error}",
                provider.as_str(),
                account.label
            );
        }

        let pty_system = NativePtySystem::default();
        let pair = pty_system
            .openpty(PtySize {
                rows: request.rows.max(8),
                cols: request.cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())?;

        let mut builder = shell_command(&settings);
        builder.cwd(repo_dir.as_os_str());
        for (key, value) in provider.home_env(&account_home) {
            builder.env(key, value);
        }
        builder.env("TERM", "xterm-256color");
        builder.env("COLORTERM", "truecolor");
        builder.env("PWD", repo_dir.to_string_lossy().to_string());

        if let Some(proxy) = proxy {
            for key in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
            ] {
                builder.env(key, proxy.proxy_url.clone());
            }
        }

        let child = pair
            .slave
            .spawn_command(builder)
            .map_err(|error| error.to_string())?;
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| error.to_string())?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| error.to_string())?;
        // Garder le receiver initial est essentiel : le shell peut produire son
        // prompt (et Codex son premier ecran ANSI) avant que le POST /terminals
        // ait repondu et que le navigateur ait ouvert son WebSocket.
        let (events, initial_events) = broadcast::channel(TERMINAL_EVENT_BUFFER);

        let session = Arc::new(RemoteTerminalSession {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            events: events.clone(),
            pending_events: Mutex::new(Some(initial_events)),
            started_at: metrics::now_ts(),
            owner_id,
            account_id: account.id.clone(),
            account_label: account.label.clone(),
            workspace_id: workspace_id.clone(),
            workspace_path: repo_dir.clone(),
            recorded_end: AtomicBool::new(false),
        });

        {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "Etat terminal verrouille".to_string())?;
            if sessions.contains_key(&id) {
                return Err(format!("Identifiant terminal deja vivant: {id}"));
            }
            sessions.insert(id, session.clone());
        }
        id_reservation.commit();

        let sessions = self.sessions.clone();
        let reader_events = events.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(size) => {
                        let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                        let _ = reader_events.send(ServerWsMessage::Data { id, data });
                    }
                    Err(error) => {
                        let _ = reader_events.send(ServerWsMessage::Error {
                            id,
                            message: error.to_string(),
                        });
                        break;
                    }
                }
            }

            let ended = sessions
                .lock()
                .ok()
                .and_then(|mut sessions| sessions.remove(&id));
            if let Some(session) = ended {
                finish_session(&session);
                let _ = session.events.send(ServerWsMessage::Exit { id });
            }
        });

        let banner = format!(
            "\r\n[Codex Switch Terminal SaaS] session #{id} | compte: {} | repo: {} | dossier: {}\r\n\r\n",
            account.label,
            repo_label,
            repo_dir.to_string_lossy()
        );
        let _ = events.send(ServerWsMessage::Data { id, data: banner });

        let command = if request.login_only {
            // Mode authentification strict : ne jamais retomber sur la commande
            // de demarrage du compte, qui pourrait ouvrir Codex normalement.
            normalize_remote_login_command(provider, request.command)
        } else {
            request.command.or_else(|| account.startup_command.clone())
        };
        if let Some(command) = command {
            let line = format!("{}\r", command.trim());
            session
                .writer
                .lock()
                .map_err(|_| "Writer terminal verrouille".to_string())?
                .write_all(line.as_bytes())
                .map_err(|error| error.to_string())?;
        }

        Ok(StartTerminalResponse {
            id,
            workspace_id,
            workspace_path: repo_dir.to_string_lossy().to_string(),
        })
    }

    fn write(&self, id: u64, data: String) -> Result<(), String> {
        let session = self.get(id)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Writer terminal verrouille".to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| error.to_string())
    }

    fn write_for_actor(&self, id: u64, data: String, actor: &RequestActor) -> Result<(), String> {
        let session = self.get_for_actor(id, actor)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| "Writer terminal verrouille".to_string())?;
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|error| error.to_string())
    }

    fn resize(&self, id: u64, cols: u16, rows: u16) -> Result<(), String> {
        let session = self.get(id)?;
        let master = session
            .master
            .lock()
            .map_err(|_| "PTY verrouille".to_string())?;
        master
            .resize(PtySize {
                rows: rows.max(8),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    fn resize_for_actor(
        &self,
        id: u64,
        cols: u16,
        rows: u16,
        actor: &RequestActor,
    ) -> Result<(), String> {
        let session = self.get_for_actor(id, actor)?;
        let master = session
            .master
            .lock()
            .map_err(|_| "PTY verrouille".to_string())?;
        master
            .resize(PtySize {
                rows: rows.max(8),
                cols: cols.max(20),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    fn stop(&self, id: u64) -> Result<(), String> {
        let Some(session) = self
            .sessions
            .lock()
            .map_err(|_| "Etat terminal verrouille".to_string())?
            .remove(&id)
        else {
            return Ok(());
        };

        finish_session(&session);
        let result = session
            .child
            .lock()
            .map_err(|_| "Process terminal verrouille".to_string())?
            .kill();
        let _ = session.events.send(ServerWsMessage::Exit { id });
        result.map_err(|error| error.to_string())
    }

    fn stop_for_actor(&self, id: u64, actor: &RequestActor) -> Result<(), String> {
        let session = {
            let mut sessions = self
                .sessions
                .lock()
                .map_err(|_| "Etat terminal verrouille".to_string())?;
            let Some(session) = sessions.get(&id) else {
                return Ok(());
            };
            if !actor.is_administrator() && session.owner_id != actor.owner_id() {
                return Err("Terminal introuvable ou inaccessible".to_string());
            }
            sessions.remove(&id)
        };
        let Some(session) = session else {
            return Ok(());
        };
        finish_session(&session);
        let result = session
            .child
            .lock()
            .map_err(|_| "Process terminal verrouille".to_string())?
            .kill();
        let _ = session.events.send(ServerWsMessage::Exit { id });
        result.map_err(|error| error.to_string())
    }

    fn get(&self, id: u64) -> Result<Arc<RemoteTerminalSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Etat terminal verrouille".to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| "Session terminal introuvable".to_string())
    }

    fn get_for_actor(
        &self,
        id: u64,
        actor: &RequestActor,
    ) -> Result<Arc<RemoteTerminalSession>, String> {
        let session = self.get(id)?;
        if actor.is_administrator() || session.owner_id == actor.owner_id() {
            Ok(session)
        } else {
            Err("Terminal introuvable ou inaccessible".to_string())
        }
    }
}

impl RemoteTerminalIdReservation {
    fn commit(self) {
        // La session inseree porte desormais l'identifiant vivant.
    }
}

impl Drop for RemoteTerminalIdReservation {
    fn drop(&mut self) {
        if let Ok(mut reservations) = self.reservations.lock() {
            reservations.remove(&self.id);
        }
    }
}

fn finish_session(session: &Arc<RemoteTerminalSession>) {
    if session.recorded_end.swap(true, Ordering::Relaxed) {
        return;
    }

    let _ = metrics::record_agent_run(
        &session.account_id,
        &session.account_label,
        session.started_at,
        metrics::now_ts(),
    );
}

fn frontend_cache_control(path: &str) -> Option<&'static str> {
    if path.starts_with("/api/")
        || path.starts_with("/ws/")
        || path.starts_with("/mcp")
        || path == "/healthz"
    {
        return None;
    }

    // Vite ajoute un hash de contenu aux fichiers sous /assets/. Ils peuvent
    // donc etre conserves tres longtemps sans jamais servir une ancienne
    // version : chaque build produit une nouvelle URL.
    if path.starts_with("/assets/") {
        return Some("public, max-age=31536000, immutable");
    }

    if path.starts_with("/icons/") || path == "/apple-touch-icon.png" {
        return Some("public, max-age=604800, stale-while-revalidate=2592000");
    }

    if path == "/manifest.webmanifest"
        || path.starts_with("/skills/")
        || path.starts_with("/impeccable/")
    {
        return Some("public, max-age=3600, stale-while-revalidate=86400");
    }

    // `no-cache` autorise un 304 conditionnel, contrairement a l'ancien
    // `no-store` qui retransmettait index.html et le service worker en entier.
    Some("no-cache, must-revalidate")
}

fn frontend_response_cache_control(path: &str, status: StatusCode) -> Option<&'static str> {
    if path.starts_with("/assets/") && !status.is_success() && status != StatusCode::NOT_MODIFIED {
        // Ne jamais rendre immuable un 404 de chunk : un proxy ou le cache HTTP
        // du navigateur ne doit pas memoriser pendant un an une publication
        // transitoirement incomplete.
        return Some("no-store");
    }
    frontend_cache_control(path)
}

async fn set_frontend_cache_control(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    if let Some(cache_control) = frontend_response_cache_control(&path, response.status()) {
        response
            .headers_mut()
            .insert(CACHE_CONTROL, HeaderValue::from_static(cache_control));
    }
    response
}

pub async fn run_from_env() -> Result<(), String> {
    let config = ServerConfig::from_env()?;
    fs::create_dir_all(config.data_dir.join("workspaces")).map_err(|error| error.to_string())?;
    fs::create_dir_all(config.data_dir.join("codex-homes")).map_err(|error| error.to_string())?;
    fs::create_dir_all(config.data_dir.join("logs")).map_err(|error| error.to_string())?;

    let settings = settings::load_settings_for_terminal()?;
    let pool_manager = Arc::new(PoolManager::build(&settings)?);
    let chat = ChatTurnManager::default();
    crate::chat::start_orphan_chat_image_sweeper();
    let user_auth = AuthManager::load(config.data_dir.clone(), &config.public_base_url)?
        .with_runtime_sync(chat.runtime_sync());
    let autonomous =
        AutonomousAgentManager::new(chat.clone(), config.data_dir.join("autonomous-agents.json"))?;
    let orchestration =
        OrchestrationManager::new(chat.clone(), config.data_dir.join("orchestrated-runs.json"))?;
    let forum = ForumManager::new(config.data_dir.join("forum.json"))?;
    let private_messages =
        PrivateMessageManager::new(config.data_dir.join("private-messages.json"))?;
    let workspace_access = WorkspaceAccessManager::load(config.data_dir.clone())?;
    let state = Arc::new(ServerState {
        config: config.clone(),
        auth: user_auth.clone(),
        terminals: RemoteTerminalManager::default(),
        chat,
        chat_tool_capabilities: ChatToolCapabilityRegistry::default(),
        chat_open_requests: ChatOpenRequestRegistry::default(),
        autonomous,
        orchestration,
        forum,
        private_messages,
        workspace_access,
        doctolib_lab: Arc::new(DoctolibLabManager::default()),
        kombai: Arc::new(KombaiManager::default()),
        kombai_owner: Arc::new(Mutex::new(None)),
        vps_deploy: VpsDeployManager::default(),
        started_at: metrics::now_ts(),
        drain_until: Arc::new(AtomicI64::new(0)),
    });
    telegram_notifications::start_polling(state.autonomous.clone());

    spawn_workspace_cleanup(config.data_dir.clone(), state.terminals.clone());

    let api = Router::new()
        .route("/health", get(api_health))
        .route("/admin/drain", post(api_admin_drain))
        .route("/vps/capabilities", get(api_vps_capabilities))
        .route("/vps/google/status", get(api_vps_google_status))
        .route("/vps/google/auth", post(api_vps_google_auth))
        .route("/vps/google/trial", post(api_vps_google_trial))
        .route(
            "/vps/google/deployments",
            post(api_vps_google_start_deployment),
        )
        .route(
            "/vps/deployments",
            get(api_vps_deployments).post(api_vps_start_deployment),
        )
        .route("/vps/deployments/:id", get(api_vps_deployment))
        .route("/settings", get(api_get_settings).put(api_put_settings))
        .route(
            "/accounts",
            get(api_get_accounts).post(api_add_shared_account),
        )
        .route("/accounts/import", post(api_import_account))
        .route("/accounts/home", post(api_ensure_account_home))
        .route("/accounts/:id", delete(api_remove_account))
        .route("/limits", get(api_limits))
        .route("/usage", get(api_usage))
        .route("/account-usage", get(api_account_usage))
        .route("/work-time", get(api_work_time))
        .route("/discussions", get(api_list_discussions))
        .route("/discussions/transcript", get(api_discussion_transcript))
        .route("/discussions/copy", post(api_copy_discussion))
        .route("/discussions/move", post(api_move_discussion))
        .route("/discussions/rename", post(api_rename_discussion))
        .route("/discussions/claim", post(api_claim_session))
        .route("/discussions/delete", post(api_delete_discussion))
        .route(
            "/discussions/export",
            post(api_export_discussion_transcript),
        )
        .route(
            "/forum/topics",
            get(api_list_forum_topics).post(api_create_forum_topic),
        )
        .route("/forum/topics/:id", get(api_get_forum_topic))
        .route("/forum/topics/:id/replies", post(api_reply_to_forum_topic))
        .route(
            "/private-messages/users",
            get(api_list_private_message_users),
        )
        .route(
            "/private-messages/conversations",
            get(api_list_private_message_conversations),
        )
        .route(
            "/private-messages/conversations/:user_id",
            get(api_get_private_message_conversation)
                .post(api_send_private_message)
                .layer(DefaultBodyLimit::max(MAX_PRIVATE_MESSAGE_REQUEST_BYTES)),
        )
        .route(
            "/private-messages/images/:image_id",
            get(api_get_private_message_image),
        )
        .route("/chat/models", get(api_chat_models))
        .route(
            "/chat/turns",
            post(api_start_chat_turn).layer(DefaultBodyLimit::max(MAX_CHAT_TURN_REQUEST_BYTES)),
        )
        .route("/chat/compact", post(api_compact_chat_session))
        .route("/chat/turns/active", get(api_list_active_chat_turns))
        .route(
            "/chat/open-requests/claim",
            post(api_claim_chat_open_requests),
        )
        .route(
            "/voice/process",
            post(api_process_voice).layer(DefaultBodyLimit::max(voice::MAX_REQUEST_BYTES)),
        )
        .route("/voice/status", get(api_voice_runtime_status))
        .route(
            "/transcriptions",
            post(api_transcribe_audio_file)
                .layer(DefaultBodyLimit::max(voice::MAX_AUDIO_FILE_BYTES)),
        )
        .route(
            "/creative/accounts",
            get(api_creative_accounts)
                .post(api_connect_creative_account)
                .layer(DefaultBodyLimit::max(16 * 1024)),
        )
        .route(
            "/creative/accounts/default",
            post(api_set_default_creative_account),
        )
        .route(
            "/creative/accounts/delete",
            post(api_delete_creative_account),
        )
        .route(
            "/notifications/whatsapp",
            get(api_whatsapp_connection)
                .post(api_connect_whatsapp)
                .delete(api_disconnect_whatsapp)
                .layer(DefaultBodyLimit::max(16 * 1024)),
        )
        .route("/notifications/whatsapp/test", post(api_test_whatsapp))
        .route(
            "/notifications/telegram",
            get(api_telegram_connection)
                .post(api_connect_telegram)
                .delete(api_disconnect_telegram)
                .layer(DefaultBodyLimit::max(16 * 1024)),
        )
        .route(
            "/notifications/telegram/pairing",
            post(api_refresh_telegram_pairing),
        )
        .route("/notifications/telegram/test", post(api_test_telegram))
        .route(
            "/notifications/telegram/manager",
            get(api_telegram_manager)
                .post(api_connect_telegram_manager)
                .delete(api_disconnect_telegram_manager)
                .layer(DefaultBodyLimit::max(16 * 1024)),
        )
        .route(
            "/notifications/telegram/manager/prepare",
            post(api_prepare_managed_telegram_bot).layer(DefaultBodyLimit::max(8 * 1024)),
        )
        .route("/notifications/mobile-push", get(api_mobile_push_status))
        .route(
            "/notifications/mobile-push/config",
            get(api_mobile_push_configuration)
                .post(api_configure_mobile_push)
                .layer(DefaultBodyLimit::max(128 * 1024)),
        )
        .route(
            "/notifications/mobile-push/devices",
            post(api_register_mobile_push_device).layer(DefaultBodyLimit::max(8 * 1024)),
        )
        .route(
            "/notifications/mobile-push/devices/:device_id",
            delete(api_unregister_mobile_push_device),
        )
        .route(
            "/notifications/mobile-push/test",
            post(api_test_mobile_push),
        )
        .route(
            "/notifications/whatsapp/webhook",
            get(api_verify_whatsapp_webhook)
                .post(api_receive_whatsapp_webhook)
                .layer(DefaultBodyLimit::max(
                    whatsapp_notifications::MAX_WHATSAPP_WEBHOOK_BYTES,
                )),
        )
        .route(
            "/image/capabilities",
            get(api_image_generation_capabilities),
        )
        .route(
            "/image/generations",
            post(api_start_image_generation).layer(DefaultBodyLimit::max(
                image_generation::MAX_IMAGE_GENERATION_REQUEST_BYTES,
            )),
        )
        .route(
            "/image/generations/status",
            post(api_image_generation_status),
        )
        .route(
            "/image/generations/cancel",
            post(api_cancel_image_generation),
        )
        .route(
            "/video/capabilities",
            get(api_video_generation_capabilities),
        )
        .route(
            "/video/generations",
            post(api_start_video_generation).layer(DefaultBodyLimit::max(
                video_generation::MAX_VIDEO_REQUEST_BYTES,
            )),
        )
        .route(
            "/video/generations/status",
            post(api_video_generation_status),
        )
        .route(
            "/video/generations/cancel",
            post(api_cancel_video_generation),
        )
        .route(
            "/chat/turns/:id",
            get(api_chat_turn_status).delete(api_stop_chat_turn),
        )
        .route(
            "/autonomous-agents",
            get(api_list_autonomous_agents).post(api_create_autonomous_agent),
        )
        .route(
            "/autonomous-agents/:id/control",
            post(api_control_autonomous_agent),
        )
        .route(
            "/autonomous-agents/:id/schedule",
            post(api_schedule_autonomous_agent),
        )
        .route(
            "/autonomous-agents/:id/account",
            post(api_reassign_autonomous_agent_account),
        )
        .route(
            "/autonomous-agents/:id/messages",
            post(api_send_autonomous_agent_message),
        )
        .route(
            "/autonomous-agents/:id/review-policy",
            post(api_apply_autonomous_review_policy),
        )
        .route(
            "/autonomous-agents/:id/reviews/:review_id/evidence",
            get(api_read_autonomous_review_evidence),
        )
        .route(
            "/autonomous-agents/:id/memories",
            post(api_add_autonomous_agent_memory),
        )
        .route(
            "/autonomous-agents/:id/reports/:report_id/read",
            post(api_mark_autonomous_agent_report_read),
        )
        .route(
            "/autonomous-agents/:id/memories/:memory_id",
            delete(api_delete_autonomous_agent_memory),
        )
        .route(
            "/autonomous-agents/:id/orchestration",
            post(api_promote_autonomous_agent_to_orchestration),
        )
        .route(
            "/autonomous-agents/:id",
            post(api_update_autonomous_agent).delete(api_delete_autonomous_agent),
        )
        .route(
            "/orchestrations",
            get(api_list_orchestrations).post(api_create_orchestration),
        )
        .route(
            "/orchestrations/:id/control",
            post(api_control_orchestration),
        )
        .route(
            "/orchestrations/:id/account",
            post(api_reassign_orchestration_account),
        )
        .route("/orchestrations/:id", delete(api_delete_orchestration))
        .route("/doctolib-lab/status", get(api_doctolib_lab_status))
        .route("/doctolib-lab/connect", post(api_doctolib_lab_connect))
        .route(
            "/doctolib-lab/google-calendar/connect",
            post(api_doctolib_lab_google_calendar_connect),
        )
        .route("/doctolib-lab/search", post(api_doctolib_lab_search))
        .route("/doctolib-lab/confirm", post(api_doctolib_lab_confirm))
        .route("/pool/status", get(api_pool_status))
        .route("/pool/start", post(api_pool_status))
        .route("/pool/stop", post(api_pool_stop))
        .route("/terminals", post(api_start_terminal))
        .route("/terminals/:id/write", post(api_write_terminal))
        .route("/terminals/:id/resize", post(api_resize_terminal))
        .route("/terminals/:id", delete(api_stop_terminal))
        .route("/kombai/status", get(api_kombai_status))
        .route("/kombai/start", post(api_kombai_start))
        .route("/kombai/stop", post(api_kombai_stop))
        .route(
            "/kombai/install-extension",
            post(api_kombai_install_extension),
        )
        .route(
            "/workspaces",
            get(api_workspaces).post(api_create_workspace),
        )
        .route("/workspaces/access", get(api_workspace_access))
        .route(
            "/workspaces/access/request",
            post(api_request_workspace_access),
        )
        .route(
            "/workspaces/:id/access-requests/:user_id/accept",
            post(api_accept_workspace_access),
        )
        .route(
            "/workspaces/:id/access-requests/:user_id/reject",
            post(api_reject_workspace_access),
        )
        .route(
            "/workspaces/:id/members/:user_id",
            delete(api_revoke_workspace_access),
        )
        .route(
            "/workspaces/git-docker",
            post(api_create_git_docker_environment),
        )
        .route("/workspaces/:id", delete(api_delete_workspace))
        .route("/fs/list", get(api_fs_list))
        .with_state(state.clone());

    let ws = Router::new()
        .route("/terminals/:id", get(ws_terminal))
        .route("/discussions", get(ws_discussions))
        .route("/runtime", get(ws_runtime))
        .with_state(state.clone());

    // Liveness NON authentifiee, a la racine (`/healthz`) : l'auth de ce projet
    // est appliquee par handler, pas par couche de routeur, donc ce handler est
    // simplement lisible sans token.
    let health = Router::new()
        .route("/healthz", get(api_healthz))
        .with_state(state.clone());

    let mcp = Router::new()
        .route(
            "/mcp/chat-tools",
            post(mcp_chat_tools).layer(DefaultBodyLimit::max(64 * 1024)),
        )
        .with_state(state.clone());

    // Les builds web produisent les variantes .br et .gz. ServeDir les envoie
    // directement selon Accept-Encoding : le premier telephone qui ouvre une
    // nouvelle version ne paie plus la compression des gros bundles a chaud.
    let static_service = ServeDir::new(config.static_dir.clone())
        .precompressed_br()
        .precompressed_gzip()
        .not_found_service(
            ServeDir::new(config.static_dir.clone())
                .precompressed_br()
                .precompressed_gzip(),
        );

    let app = Router::new()
        .merge(health)
        .merge(mcp)
        .nest("/api/auth", auth::router(user_auth))
        .nest("/api", api)
        .nest("/ws", ws)
        .merge(pool::router(pool_manager, Some(config.admin_token.clone())))
        .fallback_service(static_service)
        .layer(middleware::from_fn(set_frontend_cache_control))
        .layer(CompressionLayer::new())
        // Les clients mobiles peuvent joindre un noeud sur une autre origine.
        // Mettre en cache le preflight evite un OPTIONS avant chaque poll API.
        .layer(CorsLayer::very_permissive().max_age(Duration::from_secs(24 * 60 * 60)));

    let addr: SocketAddr = config
        .bind
        .parse()
        .map_err(|error| format!("CST_BIND invalide: {error}"))?;
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|error| format!("bind {addr} impossible: {error}"))?;

    println!(
        "Codex Switch Terminal SaaS listening on http://{} (node: {}, capacity: {}, data: {}, static: {})",
        addr,
        config.node_label,
        config.node_capacity,
        config.data_dir.display(),
        config.static_dir.display()
    );

    axum::serve(listener, app.into_make_service())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .map_err(|error| error.to_string())
}

/// Arret propre sur Ctrl-C (SIGINT) ET SIGTERM (envoye par `systemctl restart`
/// / `Stop-ScheduledTask`). Sans la branche SIGTERM, un redemarrage coupait
/// l'HTTP en vol au lieu de laisser Axum terminer les requetes en cours.
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }
}

impl ServerConfig {
    fn from_env() -> Result<Self, String> {
        let data_dir = std::env::var_os("CST_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/srv/cst"));
        // Loopback par defaut : un bind sur `0.0.0.0` declenche la fenetre
        // "Pare-feu Windows" (admin) a chaque demarrage tant qu'aucune regle
        // n'est acceptee. Pour exposer le serveur au LAN (telephone/tablette),
        // definir explicitement `CST_BIND=0.0.0.0:8080` (la fenetre pare-feu
        // n'apparait alors qu'une seule fois). Les noeuds de deploiement fixent
        // deja `CST_BIND` derriere un reverse-proxy, donc ce defaut ne les change
        // pas.
        let bind = std::env::var("CST_BIND").unwrap_or_else(|_| "127.0.0.1:8080".to_string());
        let admin_token = std::env::var("CST_ADMIN_TOKEN")
            .map(|value| value.trim().to_string())
            .unwrap_or_default();
        if admin_token.is_empty() {
            return Err("CST_ADMIN_TOKEN est requis pour lancer le serveur SaaS".to_string());
        }

        let static_dir = std::env::var_os("CST_STATIC_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(default_static_dir);
        let public_base_url =
            std::env::var("CST_PUBLIC_BASE_URL").unwrap_or_else(|_| format!("http://{bind}"));
        let node_id =
            std::env::var("CST_NODE_ID").unwrap_or_else(|_| default_node_name(&public_base_url));
        let node_label = std::env::var("CST_NODE_LABEL").unwrap_or_else(|_| node_id.clone());
        let node_capacity = std::env::var("CST_NODE_CAPACITY")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .filter(|value| *value > 0)
            .unwrap_or_else(default_node_capacity);
        let workspaces_root = resolve_workspaces_root(&data_dir);
        Ok(ServerConfig {
            bind,
            data_dir,
            static_dir,
            admin_token,
            git_pat: std::env::var("CST_GIT_PAT").unwrap_or_default(),
            public_base_url,
            node_id,
            node_label,
            node_capacity,
            workspaces_root,
        })
    }

    fn chat_tools_mcp_url(&self) -> Result<String, String> {
        let bound: SocketAddr = self
            .bind
            .parse()
            .map_err(|error| format!("CST_BIND invalide pour MCP : {error}"))?;
        let ip = if bound.ip().is_unspecified() {
            if bound.is_ipv4() {
                IpAddr::V4(Ipv4Addr::LOCALHOST)
            } else {
                IpAddr::V6(Ipv6Addr::LOCALHOST)
            }
        } else {
            bound.ip()
        };
        Ok(format!(
            "http://{}/mcp/chat-tools",
            SocketAddr::new(ip, bound.port())
        ))
    }
}

fn default_node_name(public_base_url: &str) -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .map(|value| value.trim().to_string())
        .ok()
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| public_base_url.replace([':', '/', '.'], "-"))
}

fn default_node_capacity() -> usize {
    std::thread::available_parallelism()
        .map(usize::from)
        .unwrap_or(1)
        .max(1)
}

fn default_static_dir() -> PathBuf {
    std::env::current_dir()
        .ok()
        .and_then(|cwd| cwd.parent().map(|parent| parent.join("dist")))
        .unwrap_or_else(|| PathBuf::from("dist"))
}

/// Racine du navigateur de dossiers / des workspaces "dossier existant".
/// Priorite : `CST_WORKSPACES_ROOT`, puis le dossier personnel
/// (`USERPROFILE`/`HOME`), puis le repertoire de donnees. Le dossier est cree si
/// besoin, puis canonicalise (best-effort) pour permettre une comparaison de
/// prefixe fiable lors de la validation des chemins.
fn resolve_workspaces_root(data_dir: &Path) -> PathBuf {
    let root = std::env::var_os("CST_WORKSPACES_ROOT")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| data_dir.to_path_buf());
    let _ = fs::create_dir_all(&root);
    fs::canonicalize(&root).unwrap_or(root)
}

/// Retire le prefixe Windows de chemin etendu (`\\?\`) pour un affichage propre
/// et un `cwd` utilisable. No-op sur les autres plateformes.
fn strip_extended_prefix(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            if let Some(unc) = rest.strip_prefix("UNC\\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn display_path(path: &Path) -> String {
    strip_extended_prefix(path).to_string_lossy().to_string()
}

/// Valide qu'un chemin demande (absolu, ou relatif a la racine) existe, est un
/// dossier, et se situe A L'INTERIEUR de la racine autorisee. Empeche les
/// echappements par `..` et par lien symbolique (grace a la canonicalisation).
/// Renvoie le chemin canonique nettoye (sans prefixe `\\?\`).
fn resolve_within_root(root: &Path, requested: &str) -> Result<PathBuf, String> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Ok(strip_extended_prefix(root));
    }
    let candidate = {
        // `settings::expand_home` traduit aussi les chemins absolus Windows
        // quand le serveur web tourne sous WSL (`C:\\...` -> `/mnt/c/...`).
        let expanded = settings::expand_home(requested)?;
        let path = expanded.as_path();
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            root.join(path)
        }
    };
    let canonical =
        fs::canonicalize(&candidate).map_err(|_| format!("dossier introuvable: {requested}"))?;
    // Comparaison sur les formes nettoyees pour eviter tout desaccord de prefixe
    // (`\\?\`) entre la racine et le candidat.
    let root_norm = strip_extended_prefix(root);
    let canonical_norm = strip_extended_prefix(&canonical);
    if !canonical_norm.starts_with(&root_norm) {
        return Err("dossier hors de la racine autorisee".to_string());
    }
    if !canonical_norm.is_dir() {
        return Err(format!("pas un dossier: {requested}"));
    }
    Ok(canonical_norm)
}

/// Liste UNIQUEMENT les sous-dossiers d'un repertoire (pour un selecteur de
/// dossier), tries par nom (insensible a la casse). Les fichiers sont ignores.
fn list_subdirs(dir: &Path) -> Result<Vec<FsEntry>, String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let is_dir = entry
            .file_type()
            .map(|file_type| file_type.is_dir())
            .unwrap_or_else(|_| path.is_dir());
        if !is_dir {
            continue;
        }
        entries.push(FsEntry {
            name: entry.file_name().to_string_lossy().to_string(),
            path: display_path(&path),
            is_dir: true,
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

/// Identifiant stable (sans separateur de chemin) pour un workspace pointant un
/// dossier existant. Sert d'etiquette de routage ; n'est jamais utilise pour
/// supprimer quoi que ce soit (la purge ne touche que `data_dir/workspaces`).
fn workspace_id_for_dir(dir: &Path) -> String {
    let mut id = String::from("dir-");
    for character in dir.to_string_lossy().chars() {
        if character.is_ascii_alphanumeric() {
            id.push(character.to_ascii_lowercase());
        } else if !id.ends_with('-') {
            id.push('-');
        }
    }
    id.trim_end_matches('-').chars().take(96).collect()
}

async fn api_healthz(State(state): State<Arc<ServerState>>) -> Response {
    let draining = is_draining(&state);
    json_response(LivenessResponse {
        ok: true,
        node_id: state.config.node_id.clone(),
        version: VERSION,
        commit: COMMIT,
        // `ready` = pret a accepter de NOUVEAUX terminaux. Un noeud en drain se
        // declare non pret (semantique readiness type k8s) tout en restant
        // vivant pour ses sessions en cours.
        ready: !draining,
        draining,
        active_terminals: state.terminals.active_count(),
        active_chat_turns: state.chat.active_count(),
        capacity: state.config.node_capacity,
    })
}

fn is_draining(state: &ServerState) -> bool {
    drain_lease_active(&state.drain_until, metrics::now_ts())
}

fn drain_lease_active(drain_until: &AtomicI64, now: i64) -> bool {
    loop {
        let deadline = drain_until.load(Ordering::Acquire);
        if deadline == 0 {
            return false;
        }
        if deadline > now {
            return true;
        }
        if drain_until
            .compare_exchange(deadline, 0, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return false;
        }
    }
}

async fn api_health(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        let draining = is_draining(&state);
        let available_account_ids = settings::load_settings_for_terminal()
            .map(|settings| {
                settings
                    .accounts
                    .into_iter()
                    .filter(settings::account_has_auth_tokens)
                    .map(|account| account.id)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        Ok(json_response(HealthResponse {
            ok: true,
            node_id: state.config.node_id.clone(),
            node_label: state.config.node_label.clone(),
            public_base_url: state.config.public_base_url.clone(),
            version: VERSION,
            commit: COMMIT,
            ready: !draining,
            draining,
            active_terminals: state.terminals.active_count(),
            active_chat_turns: state.chat.active_count(),
            available_account_ids,
            capacity: state.config.node_capacity,
            started_at: state.started_at,
        }))
    })
}

async fn api_admin_drain(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<DrainRequest>,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    let drain_until = if request.draining {
        let ttl = request
            .ttl_seconds
            .unwrap_or(DEFAULT_DRAIN_LEASE_SECS)
            .clamp(1, MAX_DRAIN_LEASE_SECS);
        metrics::now_ts().saturating_add(ttl as i64)
    } else {
        0
    };
    state.drain_until.store(drain_until, Ordering::Release);
    json_response(json!({
        "draining": request.draining,
        "drainUntil": (drain_until > 0).then_some(drain_until),
        "activeTerminals": state.terminals.active_count(),
    }))
}

async fn api_vps_capabilities(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    json_response(state.vps_deploy.capabilities())
}

async fn api_vps_google_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    let manager = state.vps_deploy.clone();
    match tokio::task::spawn_blocking(move || manager.google_status()).await {
        Ok(status) => json_response(status),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Lecture Google Cloud interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_vps_google_auth(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    let manager = state.vps_deploy.clone();
    match tokio::task::spawn_blocking(move || manager.start_google_auth()).await {
        Ok(Ok(action)) => json_response(action),
        Ok(Err(error)) => vps_deploy_api_error(&state, error),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Connexion Google Cloud interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_vps_google_trial(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    let manager = state.vps_deploy.clone();
    match tokio::task::spawn_blocking(move || manager.open_google_trial()).await {
        Ok(Ok(action)) => json_response(action),
        Ok(Err(error)) => vps_deploy_api_error(&state, error),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Ouverture de Google Cloud interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_vps_google_start_deployment(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<StartGoogleCloudDeployRequest>,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    let manager = state.vps_deploy.clone();
    match tokio::task::spawn_blocking(move || manager.start_google_deployment(request)).await {
        Ok(Ok(job)) => (StatusCode::CREATED, Json(job)).into_response(),
        Ok(Err(error)) => vps_deploy_api_error(&state, error),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("Provisionnement Google Cloud interrompu: {error}"),
            &state.config,
        ),
    }
}

async fn api_vps_deployments(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    json_response(state.vps_deploy.jobs())
}

async fn api_vps_deployment(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match state.vps_deploy.job(&id) {
        Some(job) => json_response(job),
        None => api_error(
            StatusCode::NOT_FOUND,
            "Deploiement VPS introuvable",
            &state.config,
        ),
    }
}

async fn api_vps_start_deployment(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<StartVpsDeployRequest>,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match state.vps_deploy.start(request) {
        Ok(job) => (StatusCode::CREATED, Json(job)).into_response(),
        Err(error) => vps_deploy_api_error(&state, error),
    }
}

fn vps_deploy_api_error(state: &Arc<ServerState>, error: VpsDeployError) -> Response {
    let status = match &error {
        VpsDeployError::Validation(_) => StatusCode::BAD_REQUEST,
        VpsDeployError::Unsupported(_) => StatusCode::SERVICE_UNAVAILABLE,
        VpsDeployError::Busy(_) => StatusCode::CONFLICT,
        VpsDeployError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    api_error(status, &error.to_string(), &state.config)
}

async fn api_get_settings(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let mut value = match settings::load_settings() {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    if let Some(identity) = actor.user() {
        let (workspaces, closed_workspace_ids) =
            match state.workspace_access.workspace_profiles_for(identity) {
                Ok(value) => value,
                Err(error) => return workspace_access_error(&state, error),
            };
        value.workspaces = workspaces;
        value.closed_workspace_ids = closed_workspace_ids;
    }
    json_response(value)
}

async fn api_put_settings(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut incoming): Json<AppSettings>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(error) = state.workspace_access.sync_profiles(
            identity,
            &incoming.workspaces,
            &incoming.closed_workspace_ids,
        ) {
            return workspace_access_error(&state, error);
        }
        // Le registre global historique ne doit jamais etre remplace par la
        // vue filtree d'un utilisateur. Les environnements SaaS restent dans
        // le registre ACL prive gere ci-dessus.
        let current = match settings::load_settings() {
            Ok(value) => value,
            Err(error) => {
                return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config)
            }
        };
        incoming.workspaces = current.workspaces;
        incoming.closed_workspace_ids = current.closed_workspace_ids;
    }

    let mut saved = match settings::save_settings(incoming) {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    if let Some(identity) = actor.user() {
        let (workspaces, closed_workspace_ids) =
            match state.workspace_access.workspace_profiles_for(identity) {
                Ok(value) => value,
                Err(error) => return workspace_access_error(&state, error),
            };
        saved.workspaces = workspaces;
        saved.closed_workspace_ids = closed_workspace_ids;
    }
    json_response(saved)
}

async fn api_get_accounts(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        settings::load_settings().map(|settings| json_response(settings.accounts))
    })
}

async fn api_add_shared_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(account): Json<AccountProfile>,
) -> Response {
    auth_or(&state, &headers, || {
        settings::add_shared_account(account).map(json_response)
    })
}

async fn api_import_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ImportAccountRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        settings::import_account_json(request.content).map(json_response)
    })
}

async fn api_ensure_account_home(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<EnsureAccountHomeRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        settings::ensure_account_home(
            request.codex_home,
            request.provider,
            request.bypass,
            request.model,
            request.reasoning_effort,
        )
        .map(|_| json_response(json!({ "ok": true })))
    })
}

#[derive(Debug, Deserialize)]
struct RemoveAccountQuery {
    #[serde(default, rename = "deleteFiles")]
    delete_files: Option<bool>,
}

async fn api_remove_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Query(query): Query<RemoveAccountQuery>,
) -> Response {
    let delete_files = query.delete_files.unwrap_or(false);
    auth_or(&state, &headers, || {
        settings::remove_account(id, delete_files).map(json_response)
    })
}

#[derive(Debug, Default, Deserialize)]
struct AccountLimitQuery {
    #[serde(default)]
    force: bool,
}

async fn api_limits(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<AccountLimitQuery>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }

    match settings::account_limit_status(Some(query.force)).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_usage(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        metrics::usage_dashboard_for_server(state.terminals.active_agent_runs()).map(json_response)
    })
}

async fn api_account_usage(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        account_usage::account_token_usage_dashboard().map(json_response)
    })
}

async fn api_work_time(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }

    match tokio::task::spawn_blocking(work_time::work_time_dashboard_for_server).await {
        Ok(Ok(dashboard)) => json_response(dashboard),
        Ok(Err(error)) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("analyse du temps de travail interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_list_discussions(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let dashboard = match discussions::list_discussions_dashboard() {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    match actor {
        RequestActor::Administrator => json_response(dashboard),
        RequestActor::User(identity) => json_response(filter_discussions_for_identity(
            &state, &identity, dashboard,
        )),
    }
}

fn filter_discussions_for_identity(
    state: &Arc<ServerState>,
    identity: &AuthIdentity,
    mut dashboard: discussions::DiscussionsDashboard,
) -> discussions::DiscussionsDashboard {
    for account in &mut dashboard.accounts {
        account.discussions.retain(|discussion| {
            discussion.cwd.as_deref().is_some_and(|cwd| {
                state
                    .workspace_access
                    .authorize_existing_environment(identity, cwd)
                    .is_ok()
            })
        });
        account.discussion_count = account.discussions.len() as u64;
    }
    dashboard
        .accounts
        .retain(|account| !account.discussions.is_empty());
    dashboard.total_discussions = dashboard
        .accounts
        .iter()
        .map(|account| account.discussion_count)
        .sum();
    dashboard
}

fn authorize_discussion_for_identity(
    state: &Arc<ServerState>,
    identity: &AuthIdentity,
    account_id: &str,
    session_id: &str,
) -> Result<(), Response> {
    let dashboard = discussions::list_discussions_dashboard()
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config))?;
    let discussion = dashboard
        .accounts
        .iter()
        .find(|account| account.account_id == account_id)
        .and_then(|account| {
            account.discussions.iter().find(|discussion| {
                discussion.session_id == session_id || discussion.rollout_id == session_id
            })
        })
        .ok_or_else(|| {
            api_error(
                StatusCode::NOT_FOUND,
                "Discussion introuvable ou inaccessible",
                &state.config,
            )
        })?;
    let cwd = discussion.cwd.as_deref().ok_or_else(|| {
        api_error(
            StatusCode::FORBIDDEN,
            "Cette discussion n'est liee a aucun environnement autorise",
            &state.config,
        )
    })?;
    state
        .workspace_access
        .authorize_existing_environment(identity, cwd)
        .map(|_| ())
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "Discussion introuvable ou inaccessible",
                &state.config,
            )
        })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TranscriptQuery {
    account_id: String,
    session_id: String,
}

async fn api_discussion_transcript(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<TranscriptQuery>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(response) = authorize_discussion_for_identity(
            &state,
            identity,
            &query.account_id,
            &query.session_id,
        ) {
            return response;
        }
    }
    match discussions::transcript_for_account(query.account_id, query.session_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_copy_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<CopyDiscussionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(response) = authorize_discussion_for_identity(
            &state,
            identity,
            &request.source_account_id,
            &request.session_id,
        ) {
            return response;
        }
    }
    match discussions::copy_discussion_between(
        request.session_id,
        request.source_account_id,
        request.target_account_id,
    ) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_move_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<MoveDiscussionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(response) = authorize_discussion_for_identity(
            &state,
            identity,
            &request.account_id,
            &request.session_id,
        ) {
            return response;
        }
    }
    let workspace = match actor.user() {
        Some(identity) => match state.workspace_access.claim_or_authorize_environment(
            identity,
            &request.workspace_path,
            None,
        ) {
            Ok(path) => path,
            Err(error) => return workspace_access_error(&state, error),
        },
        None => match resolve_within_root(&state.config.workspaces_root, &request.workspace_path) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        },
    };
    match discussions::move_discussion_for_account(
        request.account_id,
        request.session_id,
        display_path(&workspace),
    ) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_rename_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<RenameDiscussionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(response) = authorize_discussion_for_identity(
            &state,
            identity,
            &request.account_id,
            &request.session_id,
        ) {
            return response;
        }
    }
    match discussions::rename_discussion_for_account(
        request.account_id,
        request.session_id,
        request.title,
    ) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_claim_session(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ClaimSessionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if actor.user().is_some() {
        let Some(terminal_id) = request.terminal_id else {
            return api_error(
                StatusCode::BAD_REQUEST,
                "Le terminal proprietaire est obligatoire",
                &state.config,
            );
        };
        if let Err(error) = state.terminals.get_for_actor(terminal_id, &actor) {
            return api_error(StatusCode::NOT_FOUND, &error, &state.config);
        }
    }
    match discussions::claim_session_for_account(
        request.account_id,
        request.after_unix,
        request.exclude_session_ids,
        request.match_session_id,
    ) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_delete_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<DeleteDiscussionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(response) = authorize_discussion_for_identity(
            &state,
            identity,
            &request.account_id,
            &request.session_id,
        ) {
            return response;
        }
    }
    match discussions::delete_discussion_for_account(
        request.account_id,
        request.session_id,
        request.archive,
    ) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

/// Continuation INTER-PROVIDER (mode web) : renvoie le transcript semantique
/// (chaine JSON) d'une discussion Codex ou Claude, a injecter comme amorce dans
/// une session neuve du provider cible cote client.
async fn api_export_discussion_transcript(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ExportDiscussionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        if let Err(response) = authorize_discussion_for_identity(
            &state,
            identity,
            &request.account_id,
            &request.session_id,
        ) {
            return response;
        }
    }
    match discussions::export_transcript_for_account(request.account_id, request.session_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

#[derive(Debug, Deserialize)]
struct CreateForumTopicRequest {
    title: String,
    body: String,
}

#[derive(Debug, Deserialize)]
struct CreateForumReplyRequest {
    body: String,
}

async fn api_list_forum_topics(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match state.forum.list_topics() {
        Ok(topics) => forum_no_store(json_response(topics)),
        Err(error) => forum_api_error(&state, error),
    }
}

async fn api_get_forum_topic(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match state.forum.topic(&id) {
        Ok(topic) => forum_no_store(json_response(topic)),
        Err(error) => forum_api_error(&state, error),
    }
}

async fn api_create_forum_topic(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<CreateForumTopicRequest>, JsonRejection>,
) -> Response {
    let author = match forum_author(&state, &headers) {
        Ok(author) => author,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return forum_json_rejection(&state, error),
    };
    match state
        .forum
        .create_topic(author, request.title, request.body)
    {
        Ok(topic) => forum_no_store((StatusCode::CREATED, Json(topic)).into_response()),
        Err(error) => forum_api_error(&state, error),
    }
}

async fn api_reply_to_forum_topic(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    request: Result<Json<CreateForumReplyRequest>, JsonRejection>,
) -> Response {
    let author = match forum_author(&state, &headers) {
        Ok(author) => author,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return forum_json_rejection(&state, error),
    };
    match state.forum.add_reply(author, &id, request.body) {
        Ok(topic) => forum_no_store((StatusCode::CREATED, Json(topic)).into_response()),
        Err(error) => forum_api_error(&state, error),
    }
}

fn forum_author(state: &Arc<ServerState>, headers: &HeaderMap) -> Result<ForumAuthor, Response> {
    check_admin_header(state, headers)?;
    match state.auth.identity_from_headers(headers) {
        Ok(Some(identity)) => Ok(ForumAuthor::new(
            identity.id,
            identity.username,
            identity.avatar_url,
        )),
        // Les clients natifs peuvent utiliser le jeton administrateur sans
        // cookie de session. Leurs messages restent clairement identifies.
        Ok(None) => Ok(ForumAuthor::administrator()),
        Err(error) => Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error,
            &state.config,
        )),
    }
}

fn forum_api_error(state: &Arc<ServerState>, error: ForumError) -> Response {
    let status = match &error {
        ForumError::Validation(_) => StatusCode::BAD_REQUEST,
        ForumError::NotFound => StatusCode::NOT_FOUND,
        ForumError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    forum_no_store(api_error(status, &error.to_string(), &state.config))
}

fn forum_json_rejection(state: &Arc<ServerState>, _error: JsonRejection) -> Response {
    forum_no_store(api_error(
        StatusCode::BAD_REQUEST,
        "requete JSON du forum invalide",
        &state.config,
    ))
}

fn forum_no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

#[derive(Debug, Deserialize)]
struct SendPrivateMessageRequest {
    #[serde(default)]
    body: String,
    #[serde(default)]
    images: Vec<PrivateMessageImageRequest>,
}

async fn api_list_private_message_users(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let actor = match private_message_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let identities = match state.auth.public_identities() {
        Ok(identities) => identities,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    let mut users = identities
        .into_iter()
        .map(private_message_user_from_identity)
        .filter(|user| user.id != actor.id)
        .collect::<Vec<_>>();
    if actor.id != "server-admin" {
        users.push(PrivateMessageUser::administrator());
    }
    users.sort_by(|left, right| {
        left.username
            .to_lowercase()
            .cmp(&right.username.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
    private_message_no_store(json_response(users))
}

async fn api_list_private_message_conversations(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let actor = match private_message_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match state.private_messages.list_conversations(&actor.id) {
        Ok(conversations) => private_message_no_store(json_response(conversations)),
        Err(error) => private_message_api_error(&state, error),
    }
}

async fn api_get_private_message_conversation(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<String>,
) -> Response {
    let actor = match private_message_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let recipient = match private_message_recipient(&state, &actor, &user_id) {
        Ok(recipient) => recipient,
        Err(response) => return response,
    };
    match state
        .private_messages
        .conversation_with_read_status(&actor, &recipient)
    {
        Ok((conversation, marked_read)) => {
            if marked_read {
                notify_private_message_participants(&state, &actor, &recipient);
            }
            private_message_no_store(json_response(conversation))
        }
        Err(error) => private_message_api_error(&state, error),
    }
}

async fn api_send_private_message(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(user_id): AxumPath<String>,
    Json(request): Json<SendPrivateMessageRequest>,
) -> Response {
    let actor = match private_message_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let recipient = match private_message_recipient(&state, &actor, &user_id) {
        Ok(recipient) => recipient,
        Err(response) => return response,
    };
    match state.private_messages.send_with_images(
        actor.clone(),
        recipient.clone(),
        request.body,
        request.images,
    ) {
        Ok(message) => {
            notify_private_message_participants(&state, &actor, &recipient);
            private_message_no_store((StatusCode::CREATED, Json(message)).into_response())
        }
        Err(error) => private_message_api_error(&state, error),
    }
}

async fn api_get_private_message_image(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(image_id): AxumPath<String>,
) -> Response {
    let actor = match private_message_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match state.private_messages.image_content(&actor.id, &image_id) {
        Ok(image) => private_message_no_store(json_response(image)),
        Err(error) => private_message_api_error(&state, error),
    }
}

fn notify_private_message_participants(
    state: &Arc<ServerState>,
    left: &PrivateMessageUser,
    right: &PrivateMessageUser,
) {
    state
        .chat
        .runtime_sync()
        .notify_private_messages([left.id.clone(), right.id.clone()]);
}

fn private_message_user_from_identity(identity: AuthIdentity) -> PrivateMessageUser {
    PrivateMessageUser::new(identity.id, identity.username, identity.avatar_url)
}

fn private_message_actor(
    state: &Arc<ServerState>,
    headers: &HeaderMap,
) -> Result<PrivateMessageUser, Response> {
    check_admin_header(state, headers)?;
    match state.auth.identity_from_headers(headers) {
        Ok(Some(identity)) => Ok(private_message_user_from_identity(identity)),
        Ok(None) => Ok(PrivateMessageUser::administrator()),
        Err(error) => Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error,
            &state.config,
        )),
    }
}

fn private_message_recipient(
    state: &Arc<ServerState>,
    actor: &PrivateMessageUser,
    user_id: &str,
) -> Result<PrivateMessageUser, Response> {
    let user_id = user_id.trim();
    if user_id.is_empty() || user_id == actor.id {
        return Err(api_error(
            StatusCode::BAD_REQUEST,
            "Destinataire invalide",
            &state.config,
        ));
    }
    if user_id == "server-admin" {
        return Ok(PrivateMessageUser::administrator());
    }
    match state.auth.public_identity_by_id(user_id) {
        Ok(Some(identity)) => return Ok(private_message_user_from_identity(identity)),
        Ok(None) => {}
        Err(error) => {
            return Err(api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &error,
                &state.config,
            ))
        }
    }
    match state
        .private_messages
        .known_conversation_participant(&actor.id, user_id)
    {
        Ok(Some(user)) => Ok(user),
        Ok(None) => Err(api_error(
            StatusCode::NOT_FOUND,
            "Utilisateur introuvable",
            &state.config,
        )),
        Err(error) => Err(private_message_api_error(state, error)),
    }
}

fn private_message_api_error(state: &Arc<ServerState>, error: PrivateMessageError) -> Response {
    let status = match &error {
        PrivateMessageError::Validation(_) => StatusCode::BAD_REQUEST,
        PrivateMessageError::NotFound => StatusCode::NOT_FOUND,
        PrivateMessageError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    };
    api_error(status, &error.to_string(), &state.config)
}

fn private_message_no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

async fn api_pool_status(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        let settings = settings::load_settings_for_terminal()?;
        let manager = PoolManager::build(&settings)?;
        Ok(pool_status_response(
            &state.config,
            &settings,
            &manager,
            true,
        ))
    })
}

async fn api_pool_stop(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        Ok(json_response(json!({ "running": false })))
    })
}

async fn api_start_terminal(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<StartTerminalRequest>,
) -> Response {
    // Auth d'abord (401 pour un appelant sans token), puis refus explicite en
    // 503 si le noeud est en drain. On NE passe PAS par auth_or ici : auth_or
    // mappe toute Err en 500, or on veut un 503 distinguable que le client
    // interprete comme "essaie un autre noeud".
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux terminaux refuses",
            &state.config,
        );
    }
    let authorized_workspace = if request.login_only {
        None
    } else if let Some(raw) = request
        .workspace_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        match actor.user() {
            Some(identity) => match state
                .workspace_access
                .claim_or_authorize_environment(identity, raw, None)
            {
                Ok(path) => Some(path),
                Err(error) => return workspace_access_error(&state, error),
            },
            None => match resolve_within_root(&state.config.workspaces_root, raw) {
                Ok(path) => Some(path),
                Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
            },
        }
    } else {
        None
    };
    // Une authentification de compte utilise exclusivement le home partage du
    // compte. Elle ne doit ni creer ni valider un espace personnel utilisateur.
    let generated_workspaces_root = if request.login_only {
        state.config.data_dir.join("workspaces")
    } else {
        match actor.user() {
            Some(identity) => match state.workspace_access.personal_root(identity) {
                Ok(path) => path,
                Err(error) => return workspace_access_error(&state, error),
            },
            None => state.config.data_dir.join("workspaces"),
        }
    };
    let owner_id = actor.owner_id().to_string();
    let identity = actor.user().cloned();
    let start_state = state.clone();
    match tokio::task::spawn_blocking(move || {
        let login_only = request.login_only;
        let value = start_state.terminals.start(
            &start_state.config,
            request,
            owner_id,
            authorized_workspace,
            generated_workspaces_root,
        )?;
        if !login_only {
            if let Some(identity) = identity.as_ref() {
                start_state
                    .workspace_access
                    .claim_or_authorize_environment(identity, &value.workspace_path, None)
                    .map_err(|error| error.message)?;
            }
        }
        Ok::<_, String>(value)
    })
    .await
    {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(agent_start_status(&error), &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("spawn terminal interrompu: {error}"),
            &state.config,
        ),
    }
}

fn normalize_source_chat_key(value: Option<String>) -> Result<Option<String>, String> {
    let value = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let Some(value) = value else {
        return Ok(None);
    };
    if value.chars().count() > 160 || value.chars().any(char::is_control) {
        return Err("Identifiant du chat source invalide".to_string());
    }
    Ok(Some(value))
}

async fn api_start_chat_turn(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut request): Json<StartChatTurnRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux messages refusés",
            &state.config,
        );
    }
    if let Some(raw) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved = match actor.user() {
            Some(identity) => match state
                .workspace_access
                .claim_or_authorize_environment(identity, raw, None)
            {
                Ok(path) => path,
                Err(error) => return workspace_access_error(&state, error),
            },
            None => match resolve_within_root(&state.config.workspaces_root, raw) {
                Ok(path) => path,
                Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
            },
        };
        request.project_dir = Some(display_path(&resolved));
    } else if actor.user().is_some() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Un environnement personnel ou partage est obligatoire",
            &state.config,
        );
    }
    if let (Some(identity), Some(session_id)) = (actor.user(), request.session_id.as_deref()) {
        if let Err(response) =
            authorize_discussion_for_identity(&state, identity, &request.account_id, session_id)
        {
            return response;
        }
    }
    request.source_chat_key = match normalize_source_chat_key(request.source_chat_key.take()) {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
    };
    let token = match state
        .chat_tool_capabilities
        .issue(AutonomousAgentToolContext {
            account_id: request.account_id.clone(),
            source_chat_key: request.source_chat_key.clone(),
            project_dir: request.project_dir.clone(),
            mode: request.mode,
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort.clone(),
        }) {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    let tool_server = match state.config.chat_tools_mcp_url() {
        Ok(url) => ChatModelToolServerConfig {
            url,
            bearer_token: token.clone(),
        },
        Err(error) => {
            state.chat_tool_capabilities.revoke(&token);
            return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config);
        }
    };
    let owner_id = actor.user().map(|identity| identity.id.clone());
    let start_state = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        let value = start_state
            .chat
            .start_with_model_tools(request, Some(tool_server))?;
        if let Some(owner_id) = owner_id.as_deref() {
            if let Err(error) = start_state.chat.assign_owner(value.id, owner_id) {
                let _ = start_state.chat.stop(value.id);
                return Err(error);
            }
        }
        Ok::<_, String>(value)
    })
    .await;
    match result {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => {
            state.chat_tool_capabilities.revoke(&token);
            api_error(agent_start_status(&error), &error, &state.config)
        }
        Err(error) => {
            state.chat_tool_capabilities.revoke(&token);
            api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("spawn chat interrompu: {error}"),
                &state.config,
            )
        }
    }
}

fn mcp_origin_is_allowed(headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok()) else {
        return true;
    };
    let normalized = origin.trim().to_ascii_lowercase();
    normalized.starts_with("http://127.0.0.1:")
        || normalized.starts_with("http://localhost:")
        || normalized.starts_with("http://[::1]:")
}

fn bearer_from_headers(headers: &HeaderMap) -> &str {
    let value = headers
        .get("authorization")
        .and_then(|header| header.to_str().ok())
        .unwrap_or("");
    value.strip_prefix("Bearer ").unwrap_or(value).trim()
}

async fn mcp_chat_tools(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(payload): Json<serde_json::Value>,
) -> Response {
    if !mcp_origin_is_allowed(&headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    let token = bearer_from_headers(&headers);
    if state.chat_tool_capabilities.authorize(token).is_err() {
        return StatusCode::UNAUTHORIZED.into_response();
    }

    let id = payload
        .get("id")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let method = payload
        .get("method")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    if payload.get("id").is_none() {
        return match method {
            "notifications/initialized" | "notifications/cancelled" => {
                StatusCode::ACCEPTED.into_response()
            }
            _ => StatusCode::ACCEPTED.into_response(),
        };
    }

    match method {
        "initialize" => {
            let requested_version = payload
                .pointer("/params/protocolVersion")
                .and_then(serde_json::Value::as_str);
            json_response(chat_model_tools::initialize_response(id, requested_version))
        }
        "ping" => json_response(json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {}
        })),
        "tools/list" => json_response(chat_model_tools::tools_list_response(id)),
        "tools/call" => {
            let name = payload
                .pointer("/params/name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("");
            if name != AUTONOMOUS_AGENT_TOOL_NAME
                && name != UPDATE_AUTONOMOUS_AGENT_TOOL_NAME
                && name != PAUSE_AUTONOMOUS_AGENT_TOOL_NAME
                && name != ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME
                && name != APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME
                && name != CREATE_CHAT_TOOL_NAME
            {
                return json_response(chat_model_tools::protocol_error(
                    id,
                    -32602,
                    "Outil MCP inconnu",
                ));
            }
            let context_result = if name == CREATE_CHAT_TOOL_NAME {
                state.chat_tool_capabilities.claim_chat_creation(token)
            } else {
                state.chat_tool_capabilities.claim_call(token)
            };
            let context = match context_result {
                Ok(value) => value,
                Err(error) => {
                    return json_response(chat_model_tools::tool_error_response(id, &error))
                }
            };
            if is_draining(&state) {
                return json_response(chat_model_tools::tool_error_response(
                    id,
                    "Le noeud est en drain ; aucune nouvelle action ne peut etre demarree.",
                ));
            }
            let arguments = payload
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            match name {
                CREATE_CHAT_TOOL_NAME => {
                    let arguments =
                        match serde_json::from_value::<CreateChatToolArguments>(arguments) {
                            Ok(value) => value,
                            Err(error) => {
                                return json_response(chat_model_tools::tool_error_response(
                                    id,
                                    &format!(
                                        "Arguments invalides pour l'ouverture du chat : {error}"
                                    ),
                                ))
                            }
                        };
                    let request = match arguments.into_request(&context) {
                        Ok(value) => value,
                        Err(error) => {
                            return json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                    };
                    match state.chat_open_requests.enqueue(request) {
                        Ok(request) => {
                            json_response(chat_model_tools::tool_chat_open_response(id, &request))
                        }
                        Err(error) => {
                            json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                    }
                }
                AUTONOMOUS_AGENT_TOOL_NAME => {
                    let arguments = match serde_json::from_value::<CreateAutonomousAgentToolArguments>(
                        arguments,
                    ) {
                        Ok(value) => value,
                        Err(error) => {
                            return json_response(chat_model_tools::tool_error_response(
                                id,
                                &format!("Arguments invalides pour la creation autonome : {error}"),
                            ))
                        }
                    };
                    let request = match arguments.into_request(context) {
                        Ok(value) => value,
                        Err(error) => {
                            return json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                    };
                    let manager = state.autonomous.clone();
                    match tokio::task::spawn_blocking(move || manager.create(request)).await {
                        Ok(Ok(agent)) => {
                            json_response(chat_model_tools::tool_success_response(id, &agent))
                        }
                        Ok(Err(error)) => {
                            json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                        Err(error) => json_response(chat_model_tools::tool_error_response(
                            id,
                            &format!("Creation autonome interrompue : {error}"),
                        )),
                    }
                }
                UPDATE_AUTONOMOUS_AGENT_TOOL_NAME => {
                    let arguments = match serde_json::from_value::<UpdateAutonomousAgentToolArguments>(
                        arguments,
                    ) {
                        Ok(value) => value,
                        Err(error) => {
                            return json_response(chat_model_tools::tool_error_response(
                                id,
                                &format!(
                                    "Arguments invalides pour la modification autonome : {error}"
                                ),
                            ))
                        }
                    };
                    let manager = state.autonomous.clone();
                    let updated = tokio::task::spawn_blocking(move || {
                        let agents = manager.list()?;
                        let target = chat_model_tools::linked_agent_for_context(&agents, &context)?;
                        let was_active = target.status == AutonomousAgentStatus::Active;
                        let request = arguments.into_request(&target, was_active)?;
                        if was_active {
                            manager.control(&target.id, AutonomousAgentAction::Pause, None)?;
                        }
                        match manager.update(&target.id, request) {
                            Ok(agent) => Ok(agent),
                            Err(error) => {
                                if was_active {
                                    if let Err(resume_error) =
                                        manager.control(
                                            &target.id,
                                            AutonomousAgentAction::Resume,
                                            None,
                                        )
                                    {
                                        return Err(format!(
                                            "{error}. L'agent a ete securise en pause et sa reprise a echoue : {resume_error}"
                                        ));
                                    }
                                }
                                Err(error)
                            }
                        }
                    })
                    .await;
                    match updated {
                        Ok(Ok(agent)) => json_response(
                            chat_model_tools::tool_update_success_response(id, &agent),
                        ),
                        Ok(Err(error)) => {
                            json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                        Err(error) => json_response(chat_model_tools::tool_error_response(
                            id,
                            &format!("Modification autonome interrompue : {error}"),
                        )),
                    }
                }
                PAUSE_AUTONOMOUS_AGENT_TOOL_NAME => {
                    if !arguments
                        .as_object()
                        .is_some_and(|arguments| arguments.is_empty())
                    {
                        return json_response(chat_model_tools::tool_error_response(
                            id,
                            "La mise en pause ne prend aucun argument ni identifiant d'agent",
                        ));
                    }
                    let manager = state.autonomous.clone();
                    let paused = tokio::task::spawn_blocking(move || -> Result<_, String> {
                        let agents = manager.list()?;
                        let target = chat_model_tools::linked_agent_for_context(&agents, &context)?;
                        if target.status == AutonomousAgentStatus::Paused {
                            Ok((target, true))
                        } else {
                            manager
                                .control(&target.id, AutonomousAgentAction::Pause, None)
                                .map(|agent| (agent, false))
                        }
                    })
                    .await;
                    match paused {
                        Ok(Ok((agent, already_paused))) => {
                            json_response(chat_model_tools::tool_pause_success_response(
                                id,
                                &agent,
                                already_paused,
                            ))
                        }
                        Ok(Err(error)) => {
                            json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                        Err(error) => json_response(chat_model_tools::tool_error_response(
                            id,
                            &format!("Mise en pause autonome interrompue : {error}"),
                        )),
                    }
                }
                ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME => {
                    if !arguments
                        .as_object()
                        .is_some_and(|arguments| arguments.is_empty())
                    {
                        return json_response(chat_model_tools::tool_error_response(
                            id,
                            "Le compte rendu general ne prend aucun argument ni identifiant d'agent",
                        ));
                    }
                    let manager = state.autonomous.clone();
                    let activated =
                        tokio::task::spawn_blocking(move || manager.activate_general_report())
                            .await;
                    match activated {
                        Ok(Ok((supervisor, pending, scheduled))) => {
                            json_response(chat_model_tools::tool_general_report_response(
                                id,
                                supervisor.as_ref(),
                                pending,
                                scheduled,
                            ))
                        }
                        Ok(Err(error)) => {
                            json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                        Err(error) => json_response(chat_model_tools::tool_error_response(
                            id,
                            &format!("Activation du compte rendu general interrompue : {error}"),
                        )),
                    }
                }
                APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME => {
                    let arguments = match serde_json::from_value::<
                        ApplyAutonomousAgentPolicyToolArguments,
                    >(arguments)
                    {
                        Ok(value) => value,
                        Err(error) => {
                            return json_response(chat_model_tools::tool_error_response(
                                id,
                                &format!(
                                    "Arguments invalides pour la politique autonome : {error}"
                                ),
                            ))
                        }
                    };
                    let scope = arguments.resolved_scope(&context);
                    let require_visual_evidence = arguments.require_visual_evidence;
                    let instruction = arguments.instruction.trim().to_string();
                    if instruction.is_empty() || instruction.chars().count() > 2_000 {
                        return json_response(chat_model_tools::tool_error_response(
                            id,
                            "La politique doit contenir entre 1 et 2000 caracteres",
                        ));
                    }
                    let manager = state.autonomous.clone();
                    let applied = tokio::task::spawn_blocking(move || -> Result<_, String> {
                        let agents = manager.list()?;
                        let targets =
                            chat_model_tools::agents_for_policy_context(&agents, &context, scope)?;
                        let mut updated = Vec::new();
                        let mut failures = Vec::new();
                        for target in targets {
                            let was_active = target.status == AutonomousAgentStatus::Active;
                            let activate = was_active || target.pending_review.is_some();
                            if was_active {
                                if let Err(error) =
                                    manager.control(
                                        &target.id,
                                        AutonomousAgentAction::Pause,
                                        None,
                                    )
                                {
                                    failures.push((target.id, target.name, error));
                                    continue;
                                }
                            }
                            match manager.apply_review_policy(
                                &target.id,
                                &instruction,
                                require_visual_evidence,
                                activate,
                            ) {
                                Ok(agent) => updated.push(agent),
                                Err(error) => {
                                    let error = if was_active {
                                        match manager
                                            .control(
                                                &target.id,
                                                AutonomousAgentAction::Resume,
                                                None,
                                            )
                                        {
                                            Ok(_) => error,
                                            Err(resume_error) => format!(
                                                "{error}. L'agent reste en pause car sa reprise a echoue : {resume_error}"
                                            ),
                                        }
                                    } else {
                                        error
                                    };
                                    failures.push((target.id, target.name, error));
                                }
                            }
                        }
                        Ok((updated, failures))
                    })
                    .await;
                    match applied {
                        Ok(Ok((updated, failures))) => json_response(
                            chat_model_tools::tool_policy_response(id, &updated, &failures),
                        ),
                        Ok(Err(error)) => {
                            json_response(chat_model_tools::tool_error_response(id, &error))
                        }
                        Err(error) => json_response(chat_model_tools::tool_error_response(
                            id,
                            &format!("Application de la politique interrompue : {error}"),
                        )),
                    }
                }
                _ => unreachable!("outil valide avant le dispatch"),
            }
        }
        _ => json_response(chat_model_tools::protocol_error(
            id,
            -32601,
            "Methode MCP inconnue",
        )),
    }
}

async fn api_process_voice(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<voice::VoiceProcessRequest>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match voice::process_voice_request(request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

async fn api_voice_runtime_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match voice::voice_runtime_status().await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AudioTranscriptionQuery {
    #[serde(default)]
    file_name: String,
    #[serde(default = "default_transcription_language")]
    language: String,
    #[serde(default = "default_transcription_output_mode")]
    output_mode: String,
}

fn default_transcription_language() -> String {
    "auto".to_string()
}

fn default_transcription_output_mode() -> String {
    "clean".to_string()
}

async fn api_transcribe_audio_file(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<AudioTranscriptionQuery>,
    body: Bytes,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    let mime_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .to_string();
    let file_name = if query.file_name.trim().is_empty() {
        "audio.bin".to_string()
    } else {
        query.file_name
    };

    match voice::transcribe_audio_file_bytes(
        body.to_vec(),
        file_name,
        mime_type,
        query.language,
        query.output_mode,
    )
    .await
    {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

fn creative_owner_id(state: &Arc<ServerState>, headers: &HeaderMap) -> Result<String, Response> {
    let bearer = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let provided = bearer.strip_prefix("Bearer ").unwrap_or(bearer).trim();
    if crate::security::constant_time_eq(provided.as_bytes(), state.config.admin_token.as_bytes()) {
        return Ok("server-admin".to_string());
    }
    match state.auth.identity_from_headers(headers) {
        Ok(Some(identity)) => Ok(identity.id),
        Ok(None) => Err(api_error(
            StatusCode::UNAUTHORIZED,
            "authentification requise",
            &state.config,
        )),
        Err(error) => Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error,
            &state.config,
        )),
    }
}

fn creative_generation_error_status(error: &str) -> StatusCode {
    let normalized = error.to_lowercase();
    if normalized.contains("aucun compte") || normalized.contains("n’est plus configuré") {
        StatusCode::SERVICE_UNAVAILABLE
    } else if normalized.contains("lecture")
        || normalized.contains("écriture")
        || normalized.contains("fichier")
        || normalized.contains("verrou")
        || normalized.contains("client de génération")
        || normalized.contains("client fal.ai indisponible")
    {
        StatusCode::INTERNAL_SERVER_ERROR
    } else if normalized.contains("injoignable")
        || normalized.starts_with("validation fal.ai impossible")
        || normalized.starts_with("connexion fal.ai refusée")
        || normalized.starts_with("échec de ")
        || normalized.starts_with("réponse fal.ai")
        || normalized.starts_with("résultat fal.ai")
        || normalized.starts_with("fal.ai n’a pas renvoyé")
        || normalized.starts_with("fal.ai a renvoyé")
        || normalized.starts_with("annulation impossible")
    {
        StatusCode::BAD_GATEWAY
    } else {
        StatusCode::BAD_REQUEST
    }
}

fn creative_json_rejection(state: &Arc<ServerState>, _error: JsonRejection) -> Response {
    api_error(
        StatusCode::BAD_REQUEST,
        "requête JSON créative invalide",
        &state.config,
    )
}

async fn api_creative_accounts(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match creative_accounts::creative_accounts_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_connect_creative_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<ConnectCreativeAccountRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return creative_json_rejection(&state, error),
    };
    match creative_accounts::connect_creative_account_for_owner(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_delete_creative_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<CreativeAccountIdRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return creative_json_rejection(&state, error),
    };
    match creative_accounts::delete_creative_account_for_owner(&owner_id, request) {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_set_default_creative_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<CreativeAccountIdRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return creative_json_rejection(&state, error),
    };
    match creative_accounts::set_default_creative_account_for_owner(&owner_id, request) {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

fn telegram_error_status(error: &str) -> StatusCode {
    let normalized = error.to_lowercase();
    if normalized.contains("lecture")
        || normalized.contains("écriture")
        || normalized.contains("sérialisation")
        || normalized.contains("verrou")
    {
        StatusCode::INTERNAL_SERVER_ERROR
    } else if normalized.contains("telegram injoignable")
        || normalized.contains("telegram a refusé")
        || normalized.contains("réponse telegram")
    {
        StatusCode::BAD_GATEWAY
    } else {
        StatusCode::BAD_REQUEST
    }
}

async fn api_telegram_connection(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match telegram_notifications::telegram_connection_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_connect_telegram(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<ConnectTelegramRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => {
            return api_error(
                StatusCode::BAD_REQUEST,
                "requête JSON Telegram invalide",
                &state.config,
            )
        }
    };
    match telegram_notifications::connect_telegram_for_owner(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_refresh_telegram_pairing(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match telegram_notifications::refresh_telegram_pairing_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_disconnect_telegram(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match telegram_notifications::disconnect_telegram_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_test_telegram(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match telegram_notifications::test_telegram_for_owner(&owner_id).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_telegram_manager(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match telegram_notifications::telegram_manager_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_connect_telegram_manager(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<ConnectTelegramManagerRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => {
            return api_error(
                StatusCode::BAD_REQUEST,
                "requête JSON du bot gestionnaire Telegram invalide",
                &state.config,
            )
        }
    };
    match telegram_notifications::connect_telegram_manager_for_owner(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_prepare_managed_telegram_bot(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<PrepareManagedTelegramBotRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => {
            return api_error(
                StatusCode::BAD_REQUEST,
                "requête JSON de création Telegram invalide",
                &state.config,
            )
        }
    };
    match telegram_notifications::prepare_managed_telegram_bot_for_owner(&owner_id, request) {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_disconnect_telegram_manager(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match telegram_notifications::disconnect_telegram_manager_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(telegram_error_status(&error), &error, &state.config),
    }
}

async fn api_mobile_push_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match mobile_push::mobile_push_status() {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_mobile_push_configuration(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match mobile_push::mobile_push_configuration() {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_configure_mobile_push(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ConfigureMobilePushRequest>,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match mobile_push::configure_mobile_push(request) {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
    }
}

async fn api_register_mobile_push_device(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<RegisterMobilePushDeviceRequest>,
) -> Response {
    // Le client natif conserve le token administrateur dans Android Keystore.
    // Une session web ordinaire ne peut pas enregistrer silencieusement un
    // appareil qui recevrait les validations financieres de toute la flotte.
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match mobile_push::register_mobile_push_device(request) {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
    }
}

async fn api_unregister_mobile_push_device(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(device_id): AxumPath<String>,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match mobile_push::unregister_mobile_push_device(&device_id) {
        Ok(()) => StatusCode::NO_CONTENT.into_response(),
        Err(error) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
    }
}

async fn api_test_mobile_push(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_maintenance_header(&state, &headers) {
        return response;
    }
    match mobile_push::test_mobile_push_configuration().await {
        Ok(value) => json_response(value),
        Err(error) => {
            let status = if error.contains("Aucun appareil") {
                StatusCode::BAD_REQUEST
            } else {
                StatusCode::BAD_GATEWAY
            };
            api_error(status, &error, &state.config)
        }
    }
}

fn whatsapp_error_status(error: &str) -> StatusCode {
    let normalized = error.to_lowercase();
    if normalized.contains("lecture")
        || normalized.contains("écriture")
        || normalized.contains("sérialisation")
        || normalized.contains("verrou")
    {
        StatusCode::INTERNAL_SERVER_ERROR
    } else if normalized.contains("meta")
        || normalized.contains("whatsapp impossible")
        || normalized.contains("whatsapp refusé")
        || normalized.contains("whatsapp refusée")
        || normalized.contains("réponse")
    {
        StatusCode::BAD_GATEWAY
    } else {
        StatusCode::BAD_REQUEST
    }
}

async fn api_whatsapp_connection(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match whatsapp_notifications::whatsapp_connection_for_owner(&owner_id) {
        Ok(value) => json_response(whatsapp_notifications::with_webhook_callback_url(
            value,
            &state.config.public_base_url,
        )),
        Err(error) => api_error(whatsapp_error_status(&error), &error, &state.config),
    }
}

async fn api_connect_whatsapp(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<ConnectWhatsAppRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(_) => {
            return api_error(
                StatusCode::BAD_REQUEST,
                "requête JSON WhatsApp invalide",
                &state.config,
            )
        }
    };
    match whatsapp_notifications::connect_whatsapp_for_owner(&owner_id, request).await {
        Ok(value) => json_response(whatsapp_notifications::with_webhook_callback_url(
            value,
            &state.config.public_base_url,
        )),
        Err(error) => api_error(whatsapp_error_status(&error), &error, &state.config),
    }
}

async fn api_disconnect_whatsapp(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match whatsapp_notifications::disconnect_whatsapp_for_owner(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(whatsapp_error_status(&error), &error, &state.config),
    }
}

async fn api_test_whatsapp(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match whatsapp_notifications::test_whatsapp_for_owner(&owner_id).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(whatsapp_error_status(&error), &error, &state.config),
    }
}

#[derive(Debug, Deserialize)]
struct WhatsAppWebhookVerificationQuery {
    #[serde(rename = "hub.mode")]
    mode: Option<String>,
    #[serde(rename = "hub.verify_token")]
    verify_token: Option<String>,
    #[serde(rename = "hub.challenge")]
    challenge: Option<String>,
}

async fn api_verify_whatsapp_webhook(
    State(state): State<Arc<ServerState>>,
    Query(query): Query<WhatsAppWebhookVerificationQuery>,
) -> Response {
    let result = whatsapp_notifications::verify_webhook_challenge(
        query.mode.as_deref().unwrap_or_default(),
        query.verify_token.as_deref().unwrap_or_default(),
        query.challenge.as_deref().unwrap_or_default(),
    );
    match result {
        Ok(challenge) => (StatusCode::OK, challenge).into_response(),
        Err(error) => {
            let status = if error.is_internal() {
                StatusCode::INTERNAL_SERVER_ERROR
            } else if error.is_unauthorized() {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::BAD_REQUEST
            };
            api_error(status, error.message(), &state.config)
        }
    }
}

async fn api_receive_whatsapp_webhook(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let signature = headers
        .get("x-hub-signature-256")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let messages =
        match whatsapp_notifications::verify_and_extract_webhook_messages(signature, body.as_ref())
        {
            Ok(messages) => messages,
            Err(error) => {
                let status = if error.is_internal() {
                    StatusCode::INTERNAL_SERVER_ERROR
                } else if error.is_unauthorized() {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::BAD_REQUEST
                };
                return api_error(status, error.message(), &state.config);
            }
        };

    for message in messages {
        let manager = state.autonomous.clone();
        tokio::spawn(async move {
            let channel_id = message.channel_id.clone();
            let reply_to_message_id = message.reply_to_message_id.clone();
            let content = message.content.clone();
            let message_id = message.message_id.clone();
            let routed = tokio::task::spawn_blocking(move || {
                manager.receive_whatsapp_message(
                    &channel_id,
                    reply_to_message_id.as_deref(),
                    &content,
                )
            })
            .await;
            let (reply, agent_target) = match routed {
                Ok(Ok(dispatch)) => dispatch,
                Ok(Err(error)) => {
                    eprintln!(
                        "[whatsapp] message entrant {message_id} non transmis à l’agent : {error}"
                    );
                    (
                        "Je n’ai pas pu transmettre ce message à l’agent. Vérifie son état dans Codex Switch Terminal."
                            .to_string(),
                        None,
                    )
                }
                Err(error) => {
                    eprintln!(
                        "[whatsapp] traitement du message entrant {message_id} interrompu : {error}"
                    );
                    (
                        "Le traitement du message a été interrompu. Réessaie dans un instant."
                            .to_string(),
                        None,
                    )
                }
            };
            match whatsapp_notifications::send_conversation_reply(&message.channel_id, &reply).await
            {
                Ok(sent) => {
                    if let Some((agent_id, agent_name)) = agent_target {
                        if let Err(error) = whatsapp_notifications::record_conversation_reply_target(
                            &message.channel_id,
                            sent.message_id,
                            agent_id,
                            agent_name,
                        ) {
                            eprintln!(
                                "[whatsapp] continuité de conversation non persistée : {error}"
                            );
                        }
                    }
                }
                Err(error) => {
                    eprintln!(
                        "[whatsapp] réponse au message entrant {} non envoyée : {error}",
                        message.message_id
                    );
                }
            }
        });
    }

    (StatusCode::OK, "EVENT_RECEIVED").into_response()
}

async fn api_image_generation_capabilities(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match image_generation::image_generation_capabilities_for(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_start_image_generation(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ImageGenerationRequest>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match image_generation::start_image_generation_for(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_image_generation_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ImageGenerationStatusRequest>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match image_generation::image_generation_status_for(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_cancel_image_generation(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ImageGenerationStatusRequest>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match image_generation::cancel_image_generation_for(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_video_generation_capabilities(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    match video_generation::video_generation_capabilities_for(&owner_id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_start_video_generation(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<VideoGenerationRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return creative_json_rejection(&state, error),
    };
    match video_generation::start_video_generation_for(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_video_generation_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<VideoGenerationStatusRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return creative_json_rejection(&state, error),
    };
    match video_generation::video_generation_status_for(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_cancel_video_generation(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    request: Result<Json<VideoGenerationStatusRequest>, JsonRejection>,
) -> Response {
    let owner_id = match creative_owner_id(&state, &headers) {
        Ok(owner_id) => owner_id,
        Err(response) => return response,
    };
    let Json(request) = match request {
        Ok(request) => request,
        Err(error) => return creative_json_rejection(&state, error),
    };
    match video_generation::cancel_video_generation_for(&owner_id, request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(
            creative_generation_error_status(&error),
            &error,
            &state.config,
        ),
    }
}

async fn api_doctolib_lab_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match doctolib_lab::status().await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

async fn api_doctolib_lab_connect(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match doctolib_lab::connect().await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

async fn api_doctolib_lab_google_calendar_connect(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match doctolib_lab::connect_google_calendar().await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

async fn api_doctolib_lab_search(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<DoctolibLabSearchRequest>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match doctolib_lab::search(state.doctolib_lab.as_ref(), request).await {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_GATEWAY, &error, &state.config),
    }
}

async fn api_doctolib_lab_confirm(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<DoctolibLabConfirmRequest>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match doctolib_lab::confirm(
        state.doctolib_lab.as_ref(),
        request.proposal_id,
        request.add_to_google_calendar,
    )
    .await
    {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChatModelsQuery {
    account_id: String,
}

async fn api_chat_models(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<ChatModelsQuery>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match tokio::task::spawn_blocking(move || {
        settings::load_account_model_catalog(&query.account_id)
    })
    .await
    {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error.to_string(),
            &state.config,
        ),
    }
}

async fn api_chat_turn_status(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        match state.chat.is_owned_by(id, &identity.id) {
            Ok(true) => {}
            Ok(false) => {
                return api_error(
                    StatusCode::NOT_FOUND,
                    "Tour de conversation introuvable ou inaccessible",
                    &state.config,
                )
            }
            Err(error) => {
                return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config)
            }
        }
    }
    match state.chat.status(id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_list_active_chat_turns(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let result = match actor {
        RequestActor::Administrator => state.chat.active(),
        RequestActor::User(identity) => state.chat.active_for_owner(&identity.id),
    };
    match result {
        Ok(value) => json_response(value),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_claim_chat_open_requests(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    auth_or(&state, &headers, || {
        state.chat_open_requests.claim().map(json_response)
    })
}

async fn api_compact_chat_session(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<CompactChatSessionRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: compaction refusee",
            &state.config,
        );
    }
    let manager = state.chat.clone();
    let account_id = request.account_id;
    let session_id = request.session_id;
    if let Some(identity) = actor.user() {
        if let Err(response) =
            authorize_discussion_for_identity(&state, identity, &account_id, &session_id)
        {
            return response;
        }
    }
    match tokio::task::spawn_blocking(move || manager.compact(account_id, session_id)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(resource_error_status(&error), &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("compaction interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_stop_chat_turn(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(identity) = actor.user() {
        match state.chat.is_owned_by(id, &identity.id) {
            Ok(true) => {}
            Ok(false) => {
                return api_error(
                    StatusCode::NOT_FOUND,
                    "Tour de conversation introuvable ou inaccessible",
                    &state.config,
                )
            }
            Err(error) => {
                return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config)
            }
        }
    }
    match state.chat.stop(id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

fn resolve_actor_environment(
    state: &Arc<ServerState>,
    actor: &RequestActor,
    raw: &str,
    claim_personal: bool,
) -> Result<PathBuf, Response> {
    match actor.user() {
        Some(identity) if claim_personal => state
            .workspace_access
            .claim_or_authorize_environment(identity, raw, None)
            .map_err(|error| workspace_access_error(state, error)),
        Some(identity) => state
            .workspace_access
            .authorize_existing_environment(identity, raw)
            .map_err(|error| workspace_access_error(state, error)),
        None => resolve_within_root(&state.config.workspaces_root, raw)
            .map_err(|error| api_error(StatusCode::BAD_REQUEST, &error, &state.config)),
    }
}

fn authorize_autonomous_resource(
    state: &Arc<ServerState>,
    actor: &RequestActor,
    id: &str,
) -> Result<(), Response> {
    let Some(identity) = actor.user() else {
        return Ok(());
    };
    let agents = state
        .autonomous
        .list()
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config))?;
    let agent = agents.iter().find(|agent| agent.id == id).ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "Agent autonome introuvable ou inaccessible",
            &state.config,
        )
    })?;
    let project_dir = agent.project_dir.as_deref().ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "Agent autonome introuvable ou inaccessible",
            &state.config,
        )
    })?;
    state
        .workspace_access
        .authorize_existing_environment(identity, project_dir)
        .map(|_| ())
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "Agent autonome introuvable ou inaccessible",
                &state.config,
            )
        })
}

fn authorize_orchestration_resource(
    state: &Arc<ServerState>,
    actor: &RequestActor,
    id: &str,
) -> Result<(), Response> {
    let Some(identity) = actor.user() else {
        return Ok(());
    };
    let runs = state
        .orchestration
        .list()
        .map_err(|error| api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config))?;
    let run = runs.iter().find(|run| run.id == id).ok_or_else(|| {
        api_error(
            StatusCode::NOT_FOUND,
            "Orchestration introuvable ou inaccessible",
            &state.config,
        )
    })?;
    state
        .workspace_access
        .authorize_existing_environment(identity, &run.project_dir)
        .map(|_| ())
        .map_err(|_| {
            api_error(
                StatusCode::NOT_FOUND,
                "Orchestration introuvable ou inaccessible",
                &state.config,
            )
        })
}

async fn api_list_autonomous_agents(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let mut agents = match state.autonomous.list() {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    if let Some(identity) = actor.user() {
        agents.retain(|agent| {
            agent.project_dir.as_deref().is_some_and(|project_dir| {
                state
                    .workspace_access
                    .authorize_existing_environment(identity, project_dir)
                    .is_ok()
            })
        });
    }
    json_response(agents)
}

async fn api_create_autonomous_agent(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut request): Json<CreateAutonomousAgentRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux agents autonomes refuses",
            &state.config,
        );
    }
    if request
        .whatsapp_notification_channel_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        let owner_id = match creative_owner_id(&state, &headers) {
            Ok(owner_id) => owner_id,
            Err(response) => return response,
        };
        request.whatsapp_notification_channel_id =
            match whatsapp_notifications::validate_channel_for_owner(
                &owner_id,
                request.whatsapp_notification_channel_id.as_deref(),
            ) {
                Ok(channel_id) => channel_id,
                Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
            };
    } else {
        request.whatsapp_notification_channel_id = None;
    }
    if request
        .telegram_notification_channel_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        let owner_id = match creative_owner_id(&state, &headers) {
            Ok(owner_id) => owner_id,
            Err(response) => return response,
        };
        request.telegram_notification_channel_id =
            match telegram_notifications::validate_channel_for_owner(
                &owner_id,
                request.telegram_notification_channel_id.as_deref(),
            ) {
                Ok(channel_id) => channel_id,
                Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
            };
    } else {
        request.telegram_notification_channel_id = None;
    }
    if let Some(raw) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved = match resolve_actor_environment(&state, &actor, raw, true) {
            Ok(path) => path,
            Err(response) => return response,
        };
        request.project_dir = Some(display_path(&resolved));
    } else if actor.user().is_some() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Un environnement personnel ou partage est obligatoire pour un agent autonome",
            &state.config,
        );
    }

    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.create(request)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(agent_start_status(&error), &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("creation de l'agent autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_update_autonomous_agent(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(mut request): Json<UpdateAutonomousAgentRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    if request
        .whatsapp_notification_channel_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        let owner_id = match creative_owner_id(&state, &headers) {
            Ok(owner_id) => owner_id,
            Err(response) => return response,
        };
        request.whatsapp_notification_channel_id =
            match whatsapp_notifications::validate_channel_for_owner(
                &owner_id,
                request.whatsapp_notification_channel_id.as_deref(),
            ) {
                Ok(channel_id) => channel_id,
                Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
            };
    }
    if request
        .telegram_notification_channel_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        let owner_id = match creative_owner_id(&state, &headers) {
            Ok(owner_id) => owner_id,
            Err(response) => return response,
        };
        request.telegram_notification_channel_id =
            match telegram_notifications::validate_channel_for_owner(
                &owner_id,
                request.telegram_notification_channel_id.as_deref(),
            ) {
                Ok(channel_id) => channel_id,
                Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
            };
    }
    if let Some(raw) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved = match resolve_actor_environment(&state, &actor, raw, true) {
            Ok(path) => path,
            Err(response) => return response,
        };
        request.project_dir = Some(display_path(&resolved));
    } else if actor.user().is_some() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "L'environnement autorise de l'agent ne peut pas etre retire",
            &state.config,
        );
    }

    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.update(&id, request)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("mise a jour de l'agent autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_control_autonomous_agent(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<ControlAutonomousAgentRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || {
        manager.control(&id, request.action, request.payment_id.as_deref())
    })
    .await
    {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("controle de l'agent autonome interrompu: {error}"),
            &state.config,
        ),
    }
}

async fn api_send_autonomous_agent_message(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<SendAutonomousAgentMessageRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.send_message(&id, request)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("envoi du message autonome interrompu: {error}"),
            &state.config,
        ),
    }
}

async fn api_apply_autonomous_review_policy(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<ApplyAutonomousReviewPolicyRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || {
        manager.apply_review_policy(
            &id,
            &request.instruction,
            request.require_visual_evidence,
            request.activate,
        )
    })
    .await
    {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("application de la politique de review interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_read_autonomous_review_evidence(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, review_id)): AxumPath<(String, String)>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.review_evidence(&id, &review_id)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("lecture de la preuve visuelle interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_schedule_autonomous_agent(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<ScheduleAutonomousAgentRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || {
        manager.schedule(&id, request.next_run_at, request.interval_seconds)
    })
    .await
    {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("replanification de l'agent autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_reassign_autonomous_agent_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<ReassignAutonomousAgentAccountRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.reassign_account(&id, request)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("réaffectation du compte autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_add_autonomous_agent_memory(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<AddAutonomousMemoryRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.add_memory(&id, &request.content)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("ajout de memoire autonome interrompu: {error}"),
            &state.config,
        ),
    }
}

async fn api_mark_autonomous_agent_report_read(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, report_id)): AxumPath<(String, String)>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.mark_report_read(&id, &report_id)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("lecture du compte rendu autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_delete_autonomous_agent_memory(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, memory_id)): AxumPath<(String, String)>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.delete_memory(&id, &memory_id)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("suppression de memoire autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_delete_autonomous_agent(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.delete(&id)).await {
        Ok(Ok(())) => json_response(json!({ "ok": true })),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("suppression de l'agent autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_promote_autonomous_agent_to_orchestration(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(mut request): Json<PromoteAutonomousAgentRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_autonomous_resource(&state, &actor, &id) {
        return response;
    }
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: promotion vers une orchestration refusée",
            &state.config,
        );
    }
    let resolved = match resolve_actor_environment(&state, &actor, request.project_dir.trim(), true)
    {
        Ok(path) => path,
        Err(response) => return response,
    };
    request.project_dir = display_path(&resolved);
    let orchestration = state.orchestration.clone();
    let autonomous = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || {
        orchestration.promote_autonomous_agent(&autonomous, &id, request)
    })
    .await
    {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(agent_start_status(&error), &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("promotion de l'agent autonome interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_list_orchestrations(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let mut runs = match state.orchestration.list() {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    if let Some(identity) = actor.user() {
        runs.retain(|run| {
            state
                .workspace_access
                .authorize_existing_environment(identity, &run.project_dir)
                .is_ok()
        });
    }
    json_response(runs)
}

async fn api_create_orchestration(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut request): Json<CreateOrchestrationRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux chats orchestres refuses",
            &state.config,
        );
    }
    let resolved = match resolve_actor_environment(&state, &actor, request.project_dir.trim(), true)
    {
        Ok(path) => path,
        Err(response) => return response,
    };
    request.project_dir = display_path(&resolved);
    let manager = state.orchestration.clone();
    match tokio::task::spawn_blocking(move || manager.create(request)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(agent_start_status(&error), &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("creation du chat orchestre interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_control_orchestration(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<ControlOrchestrationRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_orchestration_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.orchestration.clone();
    match tokio::task::spawn_blocking(move || manager.control(&id, request.action)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("controle du chat orchestre interrompu: {error}"),
            &state.config,
        ),
    }
}

async fn api_reassign_orchestration_account(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
    Json(request): Json<ReassignOrchestrationAccountRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_orchestration_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.orchestration.clone();
    match tokio::task::spawn_blocking(move || manager.reassign_account(&id, request)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("reprise du compte orchestre interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_delete_orchestration(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Err(response) = authorize_orchestration_resource(&state, &actor, &id) {
        return response;
    }
    let manager = state.orchestration.clone();
    match tokio::task::spawn_blocking(move || manager.delete(&id)).await {
        Ok(Ok(())) => json_response(json!({ "ok": true })),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("suppression du chat orchestre interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_write_terminal(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
    Json(request): Json<WriteTerminalRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match state.terminals.write_for_actor(id, request.data, &actor) {
        Ok(()) => json_response(json!({ "ok": true })),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_resize_terminal(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
    Json(request): Json<ResizeTerminalRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match state
        .terminals
        .resize_for_actor(id, request.cols, request.rows, &actor)
    {
        Ok(()) => json_response(json!({ "ok": true })),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_stop_terminal(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match state.terminals.stop_for_actor(id, &actor) {
        Ok(()) => json_response(json!({ "ok": true })),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_kombai_status(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let owner = match state.kombai_owner.lock() {
        Ok(owner) => owner.clone(),
        Err(_) => {
            return api_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Proprietaire Kombai verrouille",
                &state.config,
            )
        }
    };
    if !actor.is_administrator() && owner.as_deref().is_some_and(|id| id != actor.owner_id()) {
        return api_error(
            StatusCode::NOT_FOUND,
            "Espace Kombai introuvable ou inaccessible",
            &state.config,
        );
    }
    match state.kombai.status() {
        Ok(status) => json_response(server_kombai_status(&state.config, status)),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_kombai_start(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut request): Json<KombaiStartRequest>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    if let Some(raw) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved = match resolve_actor_environment(&state, &actor, raw, true) {
            Ok(path) => path,
            Err(response) => return response,
        };
        request.project_dir = Some(display_path(&resolved));
    } else if actor.user().is_some() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "Un environnement autorise est obligatoire pour Kombai",
            &state.config,
        );
    }

    let owner_id = actor.owner_id().to_string();
    let newly_claimed = {
        let mut owner = match state.kombai_owner.lock() {
            Ok(owner) => owner,
            Err(_) => {
                return api_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Proprietaire Kombai verrouille",
                    &state.config,
                )
            }
        };
        if owner
            .as_deref()
            .is_some_and(|current| current != owner_id && !actor.is_administrator())
        {
            return api_error(
                StatusCode::CONFLICT,
                "Kombai est deja utilise dans l'espace d'un autre compte",
                &state.config,
            );
        }
        if owner.is_none() {
            *owner = Some(owner_id.clone());
            true
        } else {
            false
        }
    };

    match state.kombai.start(request.project_dir).await {
        Ok(status) => json_response(server_kombai_status(&state.config, status)),
        Err(error) => {
            if newly_claimed {
                if let Ok(mut owner) = state.kombai_owner.lock() {
                    if owner.as_deref() == Some(owner_id.as_str()) {
                        *owner = None;
                    }
                }
            }
            api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config)
        }
    }
}

async fn api_kombai_stop(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let allowed = state
        .kombai_owner
        .lock()
        .map(|owner| {
            actor.is_administrator()
                || owner.is_none()
                || owner.as_deref() == Some(actor.owner_id())
        })
        .unwrap_or(false);
    if !allowed {
        return api_error(
            StatusCode::NOT_FOUND,
            "Espace Kombai introuvable ou inaccessible",
            &state.config,
        );
    }
    match state.kombai.stop() {
        Ok(status) => {
            if let Ok(mut owner) = state.kombai_owner.lock() {
                *owner = None;
            }
            json_response(server_kombai_status(&state.config, status))
        }
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_kombai_install_extension(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }

    match state.kombai.install_extension().await {
        Ok(status) => json_response(server_kombai_status(&state.config, status)),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_workspaces(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match actor {
        RequestActor::Administrator => match list_workspaces(&state.config.data_dir) {
            Ok(value) => json_response(value),
            Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
        },
        RequestActor::User(identity) => match state.workspace_access.list_for(&identity) {
            Ok(value) => json_response(value),
            Err(error) => workspace_access_error(&state, error),
        },
    }
}

async fn api_create_workspace(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<CreateWorkspaceRequest>,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    match state
        .workspace_access
        .create_environment(&identity, &request.name)
    {
        Ok(value) => (StatusCode::CREATED, Json(value)).into_response(),
        Err(error) => workspace_access_error(&state, error),
    }
}

async fn api_workspace_access(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    match state.workspace_access.list_for(&identity) {
        Ok(value) => json_response(value),
        Err(error) => workspace_access_error(&state, error),
    }
}

async fn api_request_workspace_access(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<RequestWorkspaceAccessRequest>,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    match state
        .workspace_access
        .request_access(&identity, &request.share_code)
    {
        Ok(()) => (StatusCode::ACCEPTED, Json(json!({ "requested": true }))).into_response(),
        Err(error) => workspace_access_error(&state, error),
    }
}

async fn api_accept_workspace_access(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, user_id)): AxumPath<(String, String)>,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    match state
        .workspace_access
        .accept_request(&identity, &id, &user_id)
    {
        Ok(value) => json_response(value),
        Err(error) => workspace_access_error(&state, error),
    }
}

async fn api_reject_workspace_access(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, user_id)): AxumPath<(String, String)>,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    match state
        .workspace_access
        .reject_request(&identity, &id, &user_id)
    {
        Ok(value) => json_response(value),
        Err(error) => workspace_access_error(&state, error),
    }
}

async fn api_revoke_workspace_access(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, user_id)): AxumPath<(String, String)>,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    match state
        .workspace_access
        .revoke_member(&identity, &id, &user_id)
    {
        Ok(value) => json_response(value),
        Err(error) => workspace_access_error(&state, error),
    }
}

async fn api_create_git_docker_environment(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<CreateGitDockerEnvironmentRequest>,
) -> Response {
    let identity = match require_user_actor(&state, &headers) {
        Ok(identity) => identity,
        Err(response) => return response,
    };
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: creation d'environnement refusee",
            &state.config,
        );
    }
    let projects_root = match state.workspace_access.personal_root(&identity) {
        Ok(root) => root,
        Err(error) => return workspace_access_error(&state, error),
    };
    let bundles_root = projects_root
        .parent()
        .unwrap_or(&projects_root)
        .join("docker-images");
    let access = state.workspace_access.clone();
    match tokio::task::spawn_blocking(move || {
        let result = git_docker_environment::create_git_docker_environment_in(
            &projects_root,
            &bundles_root,
            request,
        )?;
        access
            .claim_or_authorize_environment(&identity, &result.workspace_path, None)
            .map_err(|error| error.message)?;
        Ok::<_, String>(result)
    })
    .await
    {
        Ok(Ok(result)) => json_response(result),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("creation de l'environnement interrompue: {error}"),
            &state.config,
        ),
    }
}

async fn api_delete_workspace(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    match actor {
        RequestActor::Administrator => match delete_workspace(
            &state.config.data_dir,
            &id,
            &state.terminals.active_workspace_ids(),
        ) {
            Ok(()) => json_response(json!({ "ok": true })),
            Err(error) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        },
        RequestActor::User(identity) => {
            let view = match state.workspace_access.list_for(&identity) {
                Ok(environments) => environments
                    .into_iter()
                    .find(|environment| environment.id == id),
                Err(error) => return workspace_access_error(&state, error),
            };
            let Some(view) = view else {
                return api_error(
                    StatusCode::NOT_FOUND,
                    "Environnement introuvable ou inaccessible",
                    &state.config,
                );
            };
            let active_id = fs::canonicalize(&view.path)
                .ok()
                .map(|path| workspace_id_for_dir(&path));
            if active_id
                .as_ref()
                .is_some_and(|active_id| state.terminals.active_workspace_ids().contains(active_id))
            {
                return api_error(
                    StatusCode::CONFLICT,
                    "Environnement encore utilise par un terminal actif",
                    &state.config,
                );
            }
            match state
                .workspace_access
                .remove_owned_environment(&identity, &id)
            {
                Ok(()) => json_response(json!({ "ok": true })),
                Err(error) => workspace_access_error(&state, error),
            }
        }
    }
}

/// Navigateur de dossiers borne a la racine autorisee (`workspaces_root`).
/// Renvoie uniquement les sous-dossiers, plus le parent (sauf a la racine). Sert
/// au selecteur de workspace cote web.
async fn api_fs_list(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<FsListQuery>,
) -> Response {
    let actor = match request_actor(&state, &headers) {
        Ok(actor) => actor,
        Err(response) => return response,
    };
    let (dir, root) = match actor {
        RequestActor::Administrator => {
            let root = state.config.workspaces_root.clone();
            let dir = match query
                .path
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                Some(path) => match resolve_within_root(&root, path) {
                    Ok(dir) => dir,
                    Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
                },
                None => strip_extended_prefix(&root),
            };
            (dir, root)
        }
        RequestActor::User(identity) => {
            match state
                .workspace_access
                .authorize_browse_path(&identity, query.path.as_deref())
            {
                Ok(value) => value,
                Err(error) => return workspace_access_error(&state, error),
            }
        }
    };
    let root_display = display_path(&root);
    let dir_display = display_path(&dir);
    let canonical_dir = fs::canonicalize(&dir).unwrap_or_else(|_| dir.clone());
    let canonical_root = fs::canonicalize(&root).unwrap_or_else(|_| root.clone());
    let parent = if canonical_dir == canonical_root {
        None
    } else {
        dir.parent()
            .filter(|parent| parent.starts_with(&canonical_root))
            .map(display_path)
    };
    let entries = match list_subdirs(&dir) {
        Ok(entries) => entries,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    json_response(FsListResponse {
        root: root_display,
        path: dir_display,
        parent,
        entries,
    })
}

async fn ws_terminal(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
    Query(params): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    let token = params.get("token").map(String::as_str).unwrap_or("");
    let actor =
        if crate::security::constant_time_eq(token.as_bytes(), state.config.admin_token.as_bytes())
        {
            RequestActor::Administrator
        } else {
            if !websocket_origin_allowed(&state.config, &headers) {
                return api_error(
                    StatusCode::FORBIDDEN,
                    "origine WebSocket non autorisee",
                    &state.config,
                );
            }
            match request_actor(&state, &headers) {
                Ok(actor) => actor,
                Err(response) => return response,
            }
        };

    let session = match state.terminals.get_for_actor(id, &actor) {
        Ok(session) => session,
        Err(error) => return api_error(StatusCode::NOT_FOUND, &error, &state.config),
    };

    ws.on_upgrade(move |socket| handle_terminal_socket(socket, state, id, session))
}

/// Signal partage des changements runtime. Le flux ne transporte aucune donnee
/// metier : le client relit le snapshot REST correspondant apres chaque
/// revision, avec son authentification habituelle. Les changements de
/// messagerie sont filtres selon l'identite de session avant tout envoi.
async fn ws_runtime(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    let token = params.get("token").map(String::as_str).unwrap_or("");
    if !crate::security::constant_time_eq(token.as_bytes(), state.config.admin_token.as_bytes()) {
        if !websocket_origin_allowed(&state.config, &headers) {
            return api_error(
                StatusCode::FORBIDDEN,
                "origine WebSocket non autorisee",
                &state.config,
            );
        }
        if let Err(response) = check_admin_header(&state, &headers) {
            return response;
        }
    }

    let user_id = match state.auth.identity_from_headers(&headers) {
        Ok(Some(identity)) => identity.id,
        Ok(None) => PrivateMessageUser::administrator().id,
        Err(error) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    };
    let sync = state.chat.runtime_sync();
    ws.on_upgrade(move |socket| handle_runtime_socket(socket, sync, user_id))
}

async fn handle_runtime_socket(socket: WebSocket, sync: RuntimeSync, user_id: String) {
    let mut events = sync.subscribe();
    let (mut sender, mut receiver) = socket.split();
    if send_ws_value(
        &mut sender,
        &json!({ "type": "hello", "revision": sync.revision() }),
    )
    .await
    .is_err()
    {
        return;
    }

    loop {
        tokio::select! {
            event = events.recv() => {
                match event {
                    Ok(event) if event.is_visible_to(&user_id) => {
                        if send_ws_value(
                            &mut sender,
                            &json!({
                                "type": "change",
                                "topic": event.topic,
                                "revision": event.revision,
                            }),
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Ok(_) => {}
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        if send_ws_value(
                            &mut sender,
                            &json!({ "type": "resync", "revision": sync.revision() }),
                        )
                        .await
                        .is_err()
                        {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else {
                    break;
                };
                match message {
                    Message::Close(_) => break,
                    Message::Ping(data) => {
                        if sender.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Message::Text(text) if text.contains("\"type\":\"ping\"") => {
                        if send_ws_value(&mut sender, &json!({ "type": "pong" })).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Flux temps reel des discussions, utilise notamment par la WebView Android.
/// Sans `accountId`/`sessionId`, il pousse l'index complet lorsqu'un fichier de
/// session change. Avec les deux parametres, il pousse le transcript cible.
async fn ws_discussions(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    ws: WebSocketUpgrade,
) -> Response {
    let token = params.get("token").map(String::as_str).unwrap_or("");
    let actor =
        if crate::security::constant_time_eq(token.as_bytes(), state.config.admin_token.as_bytes())
        {
            RequestActor::Administrator
        } else {
            if !websocket_origin_allowed(&state.config, &headers) {
                return api_error(
                    StatusCode::FORBIDDEN,
                    "origine WebSocket non autorisee",
                    &state.config,
                );
            }
            match request_actor(&state, &headers) {
                Ok(actor) => actor,
                Err(response) => return response,
            }
        };

    let account_id = params.get("accountId").cloned();
    let session_id = params.get("sessionId").cloned();
    if account_id.is_some() != session_id.is_some() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "accountId et sessionId doivent etre fournis ensemble",
            &state.config,
        );
    }

    if let (Some(identity), Some(account_id), Some(session_id)) =
        (actor.user(), account_id.as_deref(), session_id.as_deref())
    {
        if let Err(response) =
            authorize_discussion_for_identity(&state, identity, account_id, session_id)
        {
            return response;
        }
    }

    let identity = actor.user().cloned();
    ws.on_upgrade(move |socket| {
        handle_discussions_socket(socket, state, identity, account_id, session_id)
    })
}

async fn handle_discussions_socket(
    socket: WebSocket,
    state: Arc<ServerState>,
    identity: Option<AuthIdentity>,
    account_id: Option<String>,
    session_id: Option<String>,
) {
    let (mut sender, mut receiver) = socket.split();
    let mut ticker = tokio::time::interval(Duration::from_millis(750));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_revision: Option<u64> = None;
    let mut last_payload: Option<String> = None;
    let mut last_error: Option<String> = None;

    loop {
        tokio::select! {
            _ = ticker.tick() => {
                let update = discussion_ws_update(
                    state.clone(),
                    identity.clone(),
                    account_id.clone(),
                    session_id.clone(),
                    last_revision,
                ).await;

                match update {
                    Ok(Some((revision, payload, signature))) => {
                        // La revision source peut changer pour un evenement outil
                        // qui n'ajoute aucun tour visible. Dans ce cas on memorise
                        // la revision sans renvoyer inutilement le meme transcript.
                        last_revision = Some(revision);
                        last_error = None;
                        if last_payload.as_deref() != Some(signature.as_str()) {
                            if send_ws_value(&mut sender, &payload).await.is_err() {
                                break;
                            }
                            last_payload = Some(signature);
                        }
                    }
                    Ok(None) => {}
                    Err(error) => {
                        if last_error.as_deref() != Some(error.as_str()) {
                            let payload = json!({ "type": "error", "message": error });
                            if send_ws_value(&mut sender, &payload).await.is_err() {
                                break;
                            }
                            last_error = payload
                                .get("message")
                                .and_then(|value| value.as_str())
                                .map(ToString::to_string);
                        }
                    }
                }
            }
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else {
                    break;
                };
                match message {
                    Message::Close(_) => break,
                    Message::Ping(data) => {
                        if sender.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Message::Text(text) if text.contains("\"type\":\"ping\"") => {
                        if send_ws_value(&mut sender, &json!({ "type": "pong" })).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }
}

/// Renvoie un snapshot uniquement si l'empreinte disque a change depuis le
/// dernier tick. Le scan/parsing de JSONL reste dans le pool bloquant pour ne
/// jamais immobiliser les workers async d'Axum.
async fn discussion_ws_update(
    state: Arc<ServerState>,
    identity: Option<AuthIdentity>,
    account_id: Option<String>,
    session_id: Option<String>,
    last_revision: Option<u64>,
) -> Result<Option<(u64, serde_json::Value, String)>, String> {
    if let (Some(account_id), Some(session_id)) = (account_id, session_id) {
        if let Some(identity) = identity.as_ref() {
            authorize_discussion_for_identity(&state, identity, &account_id, &session_id)
                .map_err(|_| "Discussion introuvable ou inaccessible".to_string())?;
        }
        let revision_account = account_id.clone();
        let revision_session = session_id.clone();
        let revision = tokio::task::spawn_blocking(move || {
            discussions::transcript_revision_for_account(&revision_account, &revision_session)
        })
        .await
        .map_err(|error| error.to_string())??;
        if last_revision == Some(revision) {
            return Ok(None);
        }

        let transcript_account = account_id.clone();
        let transcript_session = session_id.clone();
        let transcript = tokio::task::spawn_blocking(move || {
            discussions::transcript_for_account(transcript_account, transcript_session)
        })
        .await
        .map_err(|error| error.to_string())??;
        let payload = json!({
            "type": "transcript",
            "accountId": account_id,
            "sessionId": session_id,
            "transcript": transcript,
        });
        let signature = payload.to_string();
        return Ok(Some((revision, payload, signature)));
    }

    let revision = tokio::task::spawn_blocking(discussions::discussions_revision)
        .await
        .map_err(|error| error.to_string())??;
    if last_revision == Some(revision) {
        return Ok(None);
    }
    let mut dashboard = tokio::task::spawn_blocking(move || {
        discussions::list_discussions_dashboard_at_revision(revision)
    })
    .await
    .map_err(|error| error.to_string())??;
    if let Some(identity) = identity.as_ref() {
        dashboard = filter_discussions_for_identity(&state, identity, dashboard);
    }
    let payload = json!({ "type": "dashboard", "dashboard": dashboard });
    // generatedAt est volontairement exclu de la signature fonctionnelle : sa
    // variation seule ne constitue pas une mise a jour visible.
    let mut stable = payload.clone();
    if let Some(dashboard) = stable
        .get_mut("dashboard")
        .and_then(|value| value.as_object_mut())
    {
        dashboard.remove("generatedAt");
    }
    let signature = stable.to_string();
    Ok(Some((revision, payload, signature)))
}

async fn handle_terminal_socket(
    socket: WebSocket,
    state: Arc<ServerState>,
    id: u64,
    session: Arc<RemoteTerminalSession>,
) {
    let (mut sender, mut receiver) = socket.split();
    // Le premier socket recupere le receiver cree avant le spawn du PTY. Les
    // sockets suivants reprennent le receiver remis en attente a la fermeture,
    // ce qui couvre aussi la courte fenetre d'une reconnexion.
    let mut events = take_terminal_event_receiver(&session.events, &session.pending_events);
    let hello = ServerWsMessage::Status {
        id,
        status: "active".to_string(),
        workspace_id: session.workspace_id.clone(),
        workspace_path: session.workspace_path.to_string_lossy().to_string(),
    };
    let _ = send_ws(&mut sender, &hello).await;

    loop {
        tokio::select! {
            event = events.recv() => {
                match event {
                    Ok(event) => {
                        if send_ws(&mut sender, &event).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = receiver.next() => {
                let Some(Ok(message)) = incoming else {
                    break;
                };
                if let Message::Text(text) = message {
                    match serde_json::from_str::<ClientWsMessage>(&text) {
                        Ok(ClientWsMessage::Input { data }) => {
                            let _ = state.terminals.write(id, data);
                        }
                        Ok(ClientWsMessage::Resize { cols, rows }) => {
                            let _ = state.terminals.resize(id, cols, rows);
                        }
                        Ok(ClientWsMessage::Stop) => {
                            let _ = state.terminals.stop(id);
                            break;
                        }
                        Ok(ClientWsMessage::Ping) => {
                            let _ = send_ws(&mut sender, &ServerWsMessage::Pong { id }).await;
                        }
                        Err(error) => {
                            let event = ServerWsMessage::Error {
                                id,
                                message: format!("message websocket invalide: {error}"),
                            };
                            let _ = send_ws(&mut sender, &event).await;
                        }
                    }
                }
            }
        }
    }

    restore_terminal_event_receiver(&session.pending_events, events);
}

fn take_terminal_event_receiver(
    events: &broadcast::Sender<ServerWsMessage>,
    pending_events: &Mutex<Option<broadcast::Receiver<ServerWsMessage>>>,
) -> broadcast::Receiver<ServerWsMessage> {
    pending_events
        .lock()
        .ok()
        .and_then(|mut pending| pending.take())
        .unwrap_or_else(|| events.subscribe())
}

fn restore_terminal_event_receiver(
    pending_events: &Mutex<Option<broadcast::Receiver<ServerWsMessage>>>,
    receiver: broadcast::Receiver<ServerWsMessage>,
) {
    if let Ok(mut pending) = pending_events.lock() {
        if pending.is_none() {
            *pending = Some(receiver);
        }
    }
}

async fn send_ws(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &ServerWsMessage,
) -> Result<(), axum::Error> {
    let text = serde_json::to_string(event).unwrap_or_else(|_| "{}".to_string());
    sender.send(Message::Text(text)).await
}

async fn send_ws_value(
    sender: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    event: &serde_json::Value,
) -> Result<(), axum::Error> {
    sender.send(Message::Text(event.to_string())).await
}

fn auth_or(
    state: &Arc<ServerState>,
    headers: &HeaderMap,
    f: impl FnOnce() -> Result<Response, String>,
) -> Response {
    if let Err(response) = check_admin_header(state, headers) {
        return response;
    }

    match f() {
        Ok(response) => response,
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

fn request_actor(state: &Arc<ServerState>, headers: &HeaderMap) -> Result<RequestActor, Response> {
    let bearer = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let provided = bearer.strip_prefix("Bearer ").unwrap_or(bearer).trim();
    if crate::security::constant_time_eq(provided.as_bytes(), state.config.admin_token.as_bytes()) {
        return Ok(RequestActor::Administrator);
    }
    match state.auth.identity_from_headers(headers) {
        Ok(Some(identity)) => Ok(RequestActor::User(identity)),
        Ok(None) => Err(api_error(
            StatusCode::UNAUTHORIZED,
            "authentification requise",
            &state.config,
        )),
        Err(error) => Err(api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &error,
            &state.config,
        )),
    }
}

fn require_user_actor(
    state: &Arc<ServerState>,
    headers: &HeaderMap,
) -> Result<AuthIdentity, Response> {
    match request_actor(state, headers)? {
        RequestActor::User(identity) => Ok(identity),
        RequestActor::Administrator => Err(api_error(
            StatusCode::FORBIDDEN,
            "Cette action exige une session utilisateur nominative",
            &state.config,
        )),
    }
}

fn workspace_access_error(state: &Arc<ServerState>, error: WorkspaceAccessError) -> Response {
    let status = match error.kind {
        WorkspaceAccessErrorKind::Validation => StatusCode::BAD_REQUEST,
        WorkspaceAccessErrorKind::Unauthorized => StatusCode::UNAUTHORIZED,
        WorkspaceAccessErrorKind::Forbidden => StatusCode::FORBIDDEN,
        WorkspaceAccessErrorKind::NotFound => StatusCode::NOT_FOUND,
        WorkspaceAccessErrorKind::Conflict => StatusCode::CONFLICT,
        WorkspaceAccessErrorKind::Internal => StatusCode::INTERNAL_SERVER_ERROR,
    };
    api_error(status, &error.message, &state.config)
}

fn check_admin_header(state: &Arc<ServerState>, headers: &HeaderMap) -> Result<(), Response> {
    let bearer = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let provided = bearer.strip_prefix("Bearer ").unwrap_or(bearer).trim();
    if crate::security::constant_time_eq(provided.as_bytes(), state.config.admin_token.as_bytes())
        || state.auth.authorize_headers(headers)
    {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::UNAUTHORIZED,
            "authentification requise",
            &state.config,
        ))
    }
}

fn websocket_origin_allowed(config: &ServerConfig, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get("origin").and_then(|value| value.to_str().ok()) else {
        // Les clients non navigateur peuvent ne pas envoyer Origin. Ils doivent
        // tout de meme presenter une session ou un token valide juste apres.
        return true;
    };
    let (Ok(origin), Ok(expected)) = (
        url::Url::parse(origin.trim()),
        url::Url::parse(config.public_base_url.trim()),
    ) else {
        return false;
    };
    origin.scheme() == expected.scheme()
        && origin.host_str() == expected.host_str()
        && origin.port_or_known_default() == expected.port_or_known_default()
}

/// Les operations de maintenance automatisee (drain / mise a jour) restent
/// reservees au secret administrateur et ne sont jamais ouvertes aux comptes
/// utilisateurs ordinaires.
fn check_maintenance_header(state: &Arc<ServerState>, headers: &HeaderMap) -> Result<(), Response> {
    let bearer = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("");
    let provided = bearer.strip_prefix("Bearer ").unwrap_or(bearer).trim();
    if crate::security::constant_time_eq(provided.as_bytes(), state.config.admin_token.as_bytes()) {
        Ok(())
    } else {
        Err(api_error(
            StatusCode::UNAUTHORIZED,
            "token admin invalide",
            &state.config,
        ))
    }
}

fn json_response(value: impl Serialize) -> Response {
    Json(value).into_response()
}

fn server_kombai_status(_config: &ServerConfig, status: KombaiStatus) -> KombaiStatus {
    status
}

fn api_error(status: StatusCode, message: &str, config: &ServerConfig) -> Response {
    let message = redact_secrets(message, config);
    (
        status,
        Json(json!({
            "error": {
                "message": message,
                "code": status.as_u16()
            }
        })),
    )
        .into_response()
}

fn agent_start_status(error: &str) -> StatusCode {
    if error.starts_with("capacite agents atteinte") {
        StatusCode::TOO_MANY_REQUESTS
    } else if error.contains("deja vivant") || error.contains("déjà en cours") {
        StatusCode::CONFLICT
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn resource_error_status(error: &str) -> StatusCode {
    if error.to_lowercase().contains("introuvable") {
        StatusCode::NOT_FOUND
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

fn pool_status_response(
    config: &ServerConfig,
    settings: &AppSettings,
    manager: &PoolManager,
    running: bool,
) -> Response {
    let views = manager.status_view();
    let total = views.len();
    let idle = views
        .iter()
        .filter(|account| account.status == AccountStatus::Idle)
        .count();
    json_response(json!({
        "running": running,
        "startedAt": manager.started_at(),
        "baseUrl": config.public_base_url,
        "model": settings.pool.default_model,
        "upstream": settings.pool.upstream,
        "total": total,
        "idle": idle,
        "accounts": views,
    }))
}

fn shell_command(settings: &AppSettings) -> CommandBuilder {
    let raw = settings.shell.trim();
    let shell = if raw.is_empty() || (cfg!(unix) && raw.to_ascii_lowercase().contains("powershell"))
    {
        "/bin/bash"
    } else {
        raw
    };
    let mut builder = CommandBuilder::new(shell);
    let lower = shell.to_ascii_lowercase();
    if lower.ends_with("powershell.exe")
        || lower.ends_with("pwsh.exe")
        || lower == "powershell"
        || lower == "pwsh"
    {
        builder.arg("-NoLogo");
    }
    builder
}

fn prepare_workspace(
    repo_url: &str,
    branch: Option<&str>,
    target: &Path,
    git_pat: &str,
) -> Result<String, String> {
    let repo_url = repo_url.trim();
    if repo_url.is_empty() {
        fs::create_dir_all(target).map_err(|error| error.to_string())?;
        return Ok("workspace vide".to_string());
    }

    clone_repo(repo_url, branch, target, git_pat)?;
    Ok(repo_url.to_string())
}

fn clone_repo(
    repo_url: &str,
    branch: Option<&str>,
    target: &Path,
    git_pat: &str,
) -> Result<(), String> {
    let repo_url = validate_repo_url(repo_url)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let authed_url = authenticated_repo_url(&repo_url, git_pat);
    let mut command = Command::new("git");
    command.arg("clone");
    if let Some(branch) = branch.map(str::trim).filter(|value| !value.is_empty()) {
        command.arg("--branch").arg(branch);
    }
    command
        .arg(&authed_url)
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|error| format!("git clone impossible: {error}"))?;
    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    Err(format!(
        "git clone a echoue ({}): {}{}",
        output.status, stdout, stderr
    ))
}

fn validate_repo_url(repo_url: &str) -> Result<String, String> {
    let value = repo_url.trim();
    if value.is_empty() {
        return Err("repoUrl requis en mode SaaS".to_string());
    }
    if value.contains([' ', '\n', '\r', '\t']) {
        return Err("repoUrl contient un caractere invalide".to_string());
    }
    let allowed = [
        "https://github.com/",
        "https://gitlab.com/",
        "https://bitbucket.org/",
    ];
    if allowed.iter().any(|prefix| value.starts_with(prefix)) {
        Ok(value.to_string())
    } else {
        Err("repoUrl doit commencer par https://github.com/, https://gitlab.com/ ou https://bitbucket.org/".to_string())
    }
}

fn authenticated_repo_url(repo_url: &str, git_pat: &str) -> String {
    let token = git_pat.trim();
    if token.is_empty() || repo_url.contains('@') {
        return repo_url.to_string();
    }
    if let Some(path) = repo_url.strip_prefix("https://github.com/") {
        return format!("https://x-access-token:{token}@github.com/{path}");
    }
    if let Some(path) = repo_url.strip_prefix("https://gitlab.com/") {
        return format!("https://oauth2:{token}@gitlab.com/{path}");
    }
    if let Some(path) = repo_url.strip_prefix("https://bitbucket.org/") {
        return format!("https://x-token-auth:{token}@bitbucket.org/{path}");
    }
    repo_url.to_string()
}

fn redact_secrets(value: &str, config: &ServerConfig) -> String {
    let mut redacted = value.to_string();
    for secret in [&config.git_pat, &config.admin_token] {
        let secret = secret.trim();
        if !secret.is_empty() {
            redacted = redacted.replace(secret, "***");
        }
    }
    redacted
}

fn spawn_workspace_cleanup(data_dir: PathBuf, terminals: RemoteTerminalManager) {
    tokio::spawn(async move {
        loop {
            let _ = cleanup_old_workspaces(&data_dir, &terminals.active_workspace_ids());
            tokio::time::sleep(Duration::from_secs(60 * 60)).await;
        }
    });
}

fn cleanup_old_workspaces(data_dir: &Path, active: &HashSet<String>) -> Result<(), String> {
    let now = SystemTime::now();
    let root = data_dir.join("workspaces");
    if !root.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if active.contains(&entry.file_name().to_string_lossy().to_string()) {
            continue;
        }
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if !metadata.is_dir() {
            continue;
        }
        let modified = metadata.modified().unwrap_or(now);
        let age = now
            .duration_since(modified)
            .unwrap_or_else(|_| Duration::from_secs(0));
        if age.as_secs() >= WORKSPACE_RETENTION_SECS {
            fs::remove_dir_all(entry.path()).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn list_workspaces(data_dir: &Path) -> Result<Vec<WorkspaceView>, String> {
    let mut views = Vec::new();
    for root in [data_dir.join("workspaces")] {
        if !root.is_dir() {
            continue;
        }
        for entry in fs::read_dir(root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            if !metadata.is_dir() {
                continue;
            }
            let modified_at = metadata.modified().ok().and_then(system_time_to_unix);
            views.push(WorkspaceView {
                id: entry.file_name().to_string_lossy().to_string(),
                path: entry.path().to_string_lossy().to_string(),
                modified_at,
                retained_until: modified_at.map(|ts| ts + WORKSPACE_RETENTION_SECS as i64),
            });
        }
    }
    views.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(views)
}

fn delete_workspace(data_dir: &Path, id: &str, active: &HashSet<String>) -> Result<(), String> {
    if id.contains(['/', '\\']) || id == "." || id == ".." {
        return Err("identifiant de dossier invalide".to_string());
    }
    if active.contains(id) {
        return Err("dossier encore utilise par un agent actif".to_string());
    }
    for target in [data_dir.join("workspaces").join(id)] {
        if target.is_dir() {
            let root = target
                .parent()
                .and_then(|parent| parent.canonicalize().ok())
                .ok_or_else(|| "racine des dossiers invalide".to_string())?;
            let resolved = target.canonicalize().map_err(|error| error.to_string())?;
            if resolved.starts_with(&root) && resolved != root {
                fs::remove_dir_all(&resolved).map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

fn system_time_to_unix(value: SystemTime) -> Option<i64> {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expired_drain_lease_reopens_the_node() {
        let drain_until = AtomicI64::new(120);
        assert!(drain_lease_active(&drain_until, 119));
        assert!(!drain_lease_active(&drain_until, 120));
        assert_eq!(drain_until.load(Ordering::Acquire), 0);
    }

    #[test]
    fn drain_request_accepts_a_camel_case_ttl() {
        let request: DrainRequest =
            serde_json::from_str(r#"{"draining":true,"ttlSeconds":12}"#).unwrap();
        assert!(request.draining);
        assert_eq!(request.ttl_seconds, Some(12));
    }

    #[test]
    fn missing_resources_are_not_reported_as_server_failures() {
        assert_eq!(
            resource_error_status("Tour de conversation introuvable"),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            resource_error_status("Session terminal introuvable"),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            resource_error_status("Etat des conversations verrouille"),
            StatusCode::INTERNAL_SERVER_ERROR
        );
    }

    #[test]
    fn hashed_frontend_assets_are_cached_but_entrypoints_are_revalidated() {
        assert_eq!(
            frontend_cache_control("/assets/index-ABC123.js"),
            Some("public, max-age=31536000, immutable")
        );
        assert_eq!(
            frontend_cache_control("/"),
            Some("no-cache, must-revalidate")
        );
        assert_eq!(
            frontend_cache_control("/service-worker.js"),
            Some("no-cache, must-revalidate")
        );
        assert_eq!(frontend_cache_control("/api/settings"), None);
        assert_eq!(frontend_cache_control("/ws/discussions"), None);
        assert_eq!(
            frontend_response_cache_control(
                "/assets/prompts-view-ancien.js",
                StatusCode::NOT_FOUND
            ),
            Some("no-store")
        );
        assert_eq!(
            frontend_response_cache_control("/assets/prompts-view-courant.js", StatusCode::OK),
            Some("public, max-age=31536000, immutable")
        );
    }

    #[test]
    fn remote_live_terminal_id_is_reserved_atomically() {
        let manager = RemoteTerminalManager::default();
        let reservation = manager.reserve_id(Some(77)).unwrap();
        assert!(manager.reserve_id(Some(77)).is_err());
        drop(reservation);
        assert!(manager.reserve_id(Some(77)).is_ok());
    }

    #[test]
    fn stale_codex_login_commands_use_device_auth_on_the_server() {
        assert_eq!(
            normalize_remote_login_command(Provider::Codex, Some("codex login".to_string())),
            Some("codex login --device-auth".to_string())
        );
        assert_eq!(
            normalize_remote_login_command(
                Provider::Codex,
                Some("codex logout; codex login".to_string())
            ),
            Some("codex logout; codex login --device-auth".to_string())
        );
        assert_eq!(
            normalize_remote_login_command(Provider::Codex, Some("custom-codex-login".to_string())),
            Some("custom-codex-login".to_string())
        );
        assert_eq!(
            normalize_remote_login_command(Provider::Claude, Some("claude auth login".to_string())),
            Some("claude auth login".to_string())
        );
    }

    #[test]
    fn terminal_output_emitted_before_socket_is_replayed() {
        let (events, initial_receiver) = broadcast::channel(8);
        let pending = Mutex::new(Some(initial_receiver));

        events
            .send(ServerWsMessage::Data {
                id: 7,
                data: "initial ANSI screen".to_string(),
            })
            .expect("the retained receiver must keep pre-connection output");

        let mut receiver = take_terminal_event_receiver(&events, &pending);
        match receiver
            .try_recv()
            .expect("pre-connection output must be replayed")
        {
            ServerWsMessage::Data { id, data } => {
                assert_eq!(id, 7);
                assert_eq!(data, "initial ANSI screen");
            }
            other => panic!("unexpected terminal event: {other:?}"),
        }
    }

    #[test]
    fn terminal_output_emitted_between_sockets_is_replayed() {
        let (events, initial_receiver) = broadcast::channel(8);
        let pending = Mutex::new(Some(initial_receiver));

        let receiver = take_terminal_event_receiver(&events, &pending);
        restore_terminal_event_receiver(&pending, receiver);

        events
            .send(ServerWsMessage::Data {
                id: 9,
                data: "while disconnected".to_string(),
            })
            .expect("the restored receiver must keep reconnect output");

        let mut resumed = take_terminal_event_receiver(&events, &pending);
        match resumed
            .try_recv()
            .expect("disconnect output must be replayed")
        {
            ServerWsMessage::Data { id, data } => {
                assert_eq!(id, 9);
                assert_eq!(data, "while disconnected");
            }
            other => panic!("unexpected terminal event: {other:?}"),
        }
    }

    #[test]
    fn resolve_within_root_confines_to_root() {
        // Racine reelle sous le repertoire temporaire, canonicalisee comme le
        // fait `resolve_workspaces_root` en production.
        let uid = format!("{}-{:p}", std::process::id(), &0u8 as *const u8);
        let base = std::env::temp_dir().join(format!("cst-ws-root-{uid}"));
        let child = base.join("projects").join("alpha");
        fs::create_dir_all(&child).expect("create child dir");
        let outside = std::env::temp_dir().join(format!("cst-ws-out-{uid}"));
        fs::create_dir_all(&outside).expect("create outside dir");
        let root = fs::canonicalize(&base).expect("canonicalize root");

        // Chemin absolu valide dans la racine.
        let resolved = resolve_within_root(&root, &child.to_string_lossy())
            .expect("child abs path must resolve");
        assert!(resolved.ends_with("alpha"));

        // Chemin relatif a la racine.
        let rel = resolve_within_root(&root, "projects/alpha").expect("relative path must resolve");
        assert!(rel.ends_with("alpha"));

        // Chemin vide -> racine elle-meme.
        let root_resolved = resolve_within_root(&root, "  ").expect("empty resolves to root");
        assert_eq!(root_resolved, strip_extended_prefix(&root));

        // Echappement par `..` vers un dossier hors racine : refuse.
        let escape = base.join("..").join(outside.file_name().unwrap());
        assert!(
            resolve_within_root(&root, &escape.to_string_lossy()).is_err(),
            "path traversal via .. must be rejected"
        );

        // Dossier existant mais hors de la racine : refuse.
        assert!(
            resolve_within_root(&root, &outside.to_string_lossy()).is_err(),
            "absolute path outside root must be rejected"
        );

        // Chemin inexistant : refuse.
        assert!(resolve_within_root(&root, "does/not/exist").is_err());

        let _ = fs::remove_dir_all(&base);
        let _ = fs::remove_dir_all(&outside);
    }

    #[test]
    fn workspace_id_for_dir_has_no_path_separators() {
        let id = workspace_id_for_dir(Path::new("/home/user/My Projects/app"));
        assert!(id.starts_with("dir-"));
        assert!(!id.contains('/'));
        assert!(!id.contains('\\'));
        assert!(!id.contains(' '));
    }
}
