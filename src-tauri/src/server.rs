use crate::{
    account_usage,
    auth::{self, AuthManager},
    autonomous::{
        AddAutonomousMemoryRequest, AutonomousAgentManager, ControlAutonomousAgentRequest,
        CreateAutonomousAgentRequest, ReassignAutonomousAgentAccountRequest,
        ScheduleAutonomousAgentRequest, UpdateAutonomousAgentRequest,
    },
    chat::{ChatTurnManager, StartChatTurnRequest},
    chat_model_tools::{
        self, AutonomousAgentToolContext, ChatModelToolServerConfig, ChatToolCapabilityRegistry,
        CreateAutonomousAgentToolArguments, AUTONOMOUS_AGENT_TOOL_NAME,
    },
    discussions,
    doctolib_lab::{self, DoctolibLabManager, DoctolibLabSearchRequest},
    kombai::{KombaiManager, KombaiStatus},
    metrics,
    orchestration::{
        ControlOrchestrationRequest, CreateOrchestrationRequest, OrchestrationManager,
        PromoteAutonomousAgentRequest, ReassignOrchestrationAccountRequest,
    },
    pool::{self, AccountStatus, PoolManager},
    settings::{self, AppSettings},
    voice, work_time,
};
use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        DefaultBodyLimit, Path as AxumPath, Query, Request, State,
    },
    http::{header::CACHE_CONTROL, HeaderMap, HeaderValue, StatusCode},
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
    autonomous: AutonomousAgentManager,
    orchestration: OrchestrationManager,
    doctolib_lab: Arc<DoctolibLabManager>,
    kombai: Arc<KombaiManager>,
    started_at: i64,
    /// Echeance Unix de la courte lease de drain. Une lease bornee evite qu'un
    /// updater interrompu laisse le noeud ferme aux autres agents. Les sessions
    /// deja ouvertes continuent et un redemarrage repart toujours non draine.
    drain_until: Arc<AtomicI64>,
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
struct ClaimSessionRequest {
    account_id: String,
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
        let selected_workspace = request
            .workspace_path
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());

        let (repo_dir, workspace_id, repo_label) = if request.login_only {
            // Le login reste hors de tout projet et utilise uniquement le home
            // isole du compte. La racine des workspaces demeure obligatoire
            // pour chaque terminal de travail.
            let label = display_path(&canonical_home);
            let workspace_id = workspace_id_for_dir(&canonical_home);
            (canonical_home.clone(), workspace_id, label)
        } else if let Some(raw) = selected_workspace {
            let dir = resolve_within_root(&config.workspaces_root, raw)?;
            let label = display_path(&dir);
            let workspace_id = workspace_id_for_dir(&dir);
            (dir, workspace_id, label)
        } else {
            let repo_url = request.repo_url.as_deref().unwrap_or("").trim();
            if repo_url.is_empty() {
                return Err("Environnement obligatoire avant d'ouvrir un terminal".to_string());
            } else {
                let workspace_id = format!("{id}-{}", Uuid::new_v4().simple());
                let repo_dir = config
                    .data_dir
                    .join("workspaces")
                    .join(&workspace_id)
                    .join("repo");
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
        builder.env(
            provider.home_env_var(),
            account_home.to_string_lossy().to_string(),
        );
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
            request.command
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

    fn get(&self, id: u64) -> Result<Arc<RemoteTerminalSession>, String> {
        self.sessions
            .lock()
            .map_err(|_| "Etat terminal verrouille".to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| "Session terminal introuvable".to_string())
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

async fn set_frontend_cache_control(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_string();
    let mut response = next.run(request).await;
    if let Some(cache_control) = frontend_cache_control(&path) {
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
    let user_auth = AuthManager::load(config.data_dir.clone(), &config.public_base_url)?;
    let chat = ChatTurnManager::default();
    let autonomous =
        AutonomousAgentManager::new(chat.clone(), config.data_dir.join("autonomous-agents.json"))?;
    let orchestration =
        OrchestrationManager::new(chat.clone(), config.data_dir.join("orchestrated-runs.json"))?;
    let state = Arc::new(ServerState {
        config: config.clone(),
        auth: user_auth.clone(),
        terminals: RemoteTerminalManager::default(),
        chat,
        chat_tool_capabilities: ChatToolCapabilityRegistry::default(),
        autonomous,
        orchestration,
        doctolib_lab: Arc::new(DoctolibLabManager::default()),
        kombai: Arc::new(KombaiManager::default()),
        started_at: metrics::now_ts(),
        drain_until: Arc::new(AtomicI64::new(0)),
    });

    spawn_workspace_cleanup(config.data_dir.clone(), state.terminals.clone());

    let api = Router::new()
        .route("/health", get(api_health))
        .route("/admin/drain", post(api_admin_drain))
        .route("/settings", get(api_get_settings).put(api_put_settings))
        .route("/accounts", get(api_get_accounts))
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
        .route("/discussions/claim", post(api_claim_session))
        .route("/discussions/delete", post(api_delete_discussion))
        .route(
            "/discussions/export",
            post(api_export_discussion_transcript),
        )
        .route("/chat/models", get(api_chat_models))
        .route("/chat/turns", post(api_start_chat_turn))
        .route("/chat/turns/active", get(api_list_active_chat_turns))
        .route(
            "/voice/process",
            post(api_process_voice).layer(DefaultBodyLimit::max(voice::MAX_REQUEST_BYTES)),
        )
        .route("/voice/status", get(api_voice_runtime_status))
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
            "/autonomous-agents/:id/memories",
            post(api_add_autonomous_agent_memory),
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
        .route("/workspaces", get(api_workspaces))
        .route("/workspaces/:id", delete(api_delete_workspace))
        .route("/fs/list", get(api_fs_list))
        .with_state(state.clone());

    let ws = Router::new()
        .route("/terminals/:id", get(ws_terminal))
        .route("/discussions", get(ws_discussions))
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

    let static_service = ServeDir::new(config.static_dir.clone())
        .not_found_service(ServeDir::new(config.static_dir.clone()));

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

async fn api_get_settings(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        settings::load_settings().map(json_response)
    })
}

async fn api_put_settings(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(settings): Json<AppSettings>,
) -> Response {
    auth_or(&state, &headers, || {
        settings::save_settings(settings).map(json_response)
    })
}

async fn api_get_accounts(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        settings::load_settings().map(|settings| json_response(settings.accounts))
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

async fn api_limits(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }

    match settings::account_limit_status().await {
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
    auth_or(&state, &headers, || {
        work_time::work_time_dashboard_for_server().map(json_response)
    })
}

async fn api_list_discussions(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    auth_or(&state, &headers, || {
        discussions::list_discussions_dashboard().map(json_response)
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
    auth_or(&state, &headers, || {
        discussions::transcript_for_account(query.account_id, query.session_id).map(json_response)
    })
}

async fn api_copy_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<CopyDiscussionRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        discussions::copy_discussion_between(
            request.session_id,
            request.source_account_id,
            request.target_account_id,
        )
        .map(json_response)
    })
}

async fn api_move_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<MoveDiscussionRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        let workspace =
            resolve_within_root(&state.config.workspaces_root, &request.workspace_path)?;
        discussions::move_discussion_for_account(
            request.account_id,
            request.session_id,
            display_path(&workspace),
        )
        .map(json_response)
    })
}

async fn api_claim_session(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ClaimSessionRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        discussions::claim_session_for_account(
            request.account_id,
            request.after_unix,
            request.exclude_session_ids,
            request.match_session_id,
        )
        .map(json_response)
    })
}

async fn api_delete_discussion(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<DeleteDiscussionRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        discussions::delete_discussion_for_account(
            request.account_id,
            request.session_id,
            request.archive,
        )
        .map(json_response)
    })
}

/// Continuation INTER-PROVIDER (mode web) : renvoie le transcript semantique
/// (chaine JSON) d'une discussion Codex ou Claude, a injecter comme amorce dans
/// une session neuve du provider cible cote client.
async fn api_export_discussion_transcript(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<ExportDiscussionRequest>,
) -> Response {
    auth_or(&state, &headers, || {
        discussions::export_transcript_for_account(request.account_id, request.session_id)
            .map(json_response)
    })
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux terminaux refuses",
            &state.config,
        );
    }
    let start_state = state.clone();
    match tokio::task::spawn_blocking(move || {
        start_state.terminals.start(&start_state.config, request)
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
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
        let resolved = match resolve_within_root(&state.config.workspaces_root, raw) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        };
        request.project_dir = Some(resolved.to_string_lossy().to_string());
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
    let start_state = state.clone();
    let result = tokio::task::spawn_blocking(move || {
        start_state
            .chat
            .start_with_model_tools(request, Some(tool_server))
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
            if name != AUTONOMOUS_AGENT_TOOL_NAME {
                return json_response(chat_model_tools::protocol_error(
                    id,
                    -32602,
                    "Outil MCP inconnu",
                ));
            }
            let context = match state.chat_tool_capabilities.claim_call(token) {
                Ok(value) => value,
                Err(error) => {
                    return json_response(chat_model_tools::tool_error_response(id, &error))
                }
            };
            if is_draining(&state) {
                return json_response(chat_model_tools::tool_error_response(
                    id,
                    "Le noeud est en drain ; aucun nouvel agent autonome ne peut demarrer.",
                ));
            }
            let arguments = payload
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            let arguments =
                match serde_json::from_value::<CreateAutonomousAgentToolArguments>(arguments) {
                    Ok(value) => value,
                    Err(error) => {
                        return json_response(chat_model_tools::tool_error_response(
                            id,
                            &format!("Arguments invalides pour l'agent autonome : {error}"),
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
                Ok(Ok(agent)) => json_response(chat_model_tools::tool_success_response(id, &agent)),
                Ok(Err(error)) => json_response(chat_model_tools::tool_error_response(id, &error)),
                Err(error) => json_response(chat_model_tools::tool_error_response(
                    id,
                    &format!("Creation autonome interrompue : {error}"),
                )),
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
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
    auth_or(&state, &headers, || state.chat.active().map(json_response))
}

async fn api_stop_chat_turn(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match state.chat.stop(id) {
        Ok(value) => json_response(value),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_list_autonomous_agents(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
) -> Response {
    auth_or(&state, &headers, || {
        state.autonomous.list().map(json_response)
    })
}

async fn api_create_autonomous_agent(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut request): Json<CreateAutonomousAgentRequest>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux agents autonomes refuses",
            &state.config,
        );
    }
    if let Some(raw) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved = match resolve_within_root(&state.config.workspaces_root, raw) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        };
        request.project_dir = Some(resolved.to_string_lossy().to_string());
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    if let Some(raw) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let resolved = match resolve_within_root(&state.config.workspaces_root, raw) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        };
        request.project_dir = Some(resolved.to_string_lossy().to_string());
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    let manager = state.autonomous.clone();
    match tokio::task::spawn_blocking(move || manager.control(&id, request.action)).await {
        Ok(Ok(value)) => json_response(value),
        Ok(Err(error)) => api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        Err(error) => api_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &format!("controle de l'agent autonome interrompu: {error}"),
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
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
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

async fn api_delete_autonomous_agent_memory(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath((id, memory_id)): AxumPath<(String, String)>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: promotion vers une orchestration refusée",
            &state.config,
        );
    }
    let resolved =
        match resolve_within_root(&state.config.workspaces_root, request.project_dir.trim()) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        };
    request.project_dir = resolved.to_string_lossy().to_string();
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
    auth_or(&state, &headers, || {
        state.orchestration.list().map(json_response)
    })
}

async fn api_create_orchestration(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(mut request): Json<CreateOrchestrationRequest>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    if is_draining(&state) {
        return api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "noeud en drain: nouveaux chats orchestres refuses",
            &state.config,
        );
    }
    let resolved =
        match resolve_within_root(&state.config.workspaces_root, request.project_dir.trim()) {
            Ok(path) => path,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        };
    request.project_dir = resolved.to_string_lossy().to_string();
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
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match state.terminals.write(id, request.data) {
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
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    match state.terminals.resize(id, request.cols, request.rows) {
        Ok(()) => json_response(json!({ "ok": true })),
        Err(error) => api_error(resource_error_status(&error), &error, &state.config),
    }
}

async fn api_stop_terminal(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<u64>,
) -> Response {
    auth_or(&state, &headers, || {
        state.terminals.stop(id)?;
        Ok(json_response(json!({ "ok": true })))
    })
}

async fn api_kombai_status(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        state
            .kombai
            .status()
            .map(|status| json_response(server_kombai_status(&state.config, status)))
    })
}

async fn api_kombai_start(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Json(request): Json<KombaiStartRequest>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }

    match state.kombai.start(request.project_dir).await {
        Ok(status) => json_response(server_kombai_status(&state.config, status)),
        Err(error) => api_error(StatusCode::INTERNAL_SERVER_ERROR, &error, &state.config),
    }
}

async fn api_kombai_stop(State(state): State<Arc<ServerState>>, headers: HeaderMap) -> Response {
    auth_or(&state, &headers, || {
        state
            .kombai
            .stop()
            .map(|status| json_response(server_kombai_status(&state.config, status)))
    })
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
    auth_or(&state, &headers, || {
        list_workspaces(&state.config.data_dir).map(json_response)
    })
}

async fn api_delete_workspace(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    AxumPath(id): AxumPath<String>,
) -> Response {
    auth_or(&state, &headers, || {
        delete_workspace(
            &state.config.data_dir,
            &id,
            &state.terminals.active_workspace_ids(),
        )?;
        Ok(json_response(json!({ "ok": true })))
    })
}

/// Navigateur de dossiers borne a la racine autorisee (`workspaces_root`).
/// Renvoie uniquement les sous-dossiers, plus le parent (sauf a la racine). Sert
/// au selecteur de workspace cote web.
async fn api_fs_list(
    State(state): State<Arc<ServerState>>,
    headers: HeaderMap,
    Query(query): Query<FsListQuery>,
) -> Response {
    if let Err(response) = check_admin_header(&state, &headers) {
        return response;
    }
    let root = &state.config.workspaces_root;
    let dir = match query
        .path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(path) => match resolve_within_root(root, path) {
            Ok(dir) => dir,
            Err(error) => return api_error(StatusCode::BAD_REQUEST, &error, &state.config),
        },
        None => strip_extended_prefix(root),
    };
    let root_display = display_path(root);
    let dir_display = dir.to_string_lossy().to_string();
    let parent = if dir_display == root_display {
        None
    } else {
        dir.parent()
            .map(|parent| parent.to_string_lossy().to_string())
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
    if !crate::security::constant_time_eq(token.as_bytes(), state.config.admin_token.as_bytes()) {
        if let Err(response) = check_admin_header(&state, &headers) {
            return response;
        }
    }

    let session = match state.terminals.get(id) {
        Ok(session) => session,
        Err(error) => return api_error(StatusCode::NOT_FOUND, &error, &state.config),
    };

    ws.on_upgrade(move |socket| handle_terminal_socket(socket, state, id, session))
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
    if !crate::security::constant_time_eq(token.as_bytes(), state.config.admin_token.as_bytes()) {
        if let Err(response) = check_admin_header(&state, &headers) {
            return response;
        }
    }

    let account_id = params.get("accountId").cloned();
    let session_id = params.get("sessionId").cloned();
    if account_id.is_some() != session_id.is_some() {
        return api_error(
            StatusCode::BAD_REQUEST,
            "accountId et sessionId doivent etre fournis ensemble",
            &state.config,
        );
    }

    ws.on_upgrade(move |socket| handle_discussions_socket(socket, account_id, session_id))
}

async fn handle_discussions_socket(
    socket: WebSocket,
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
    account_id: Option<String>,
    session_id: Option<String>,
    last_revision: Option<u64>,
) -> Result<Option<(u64, serde_json::Value, String)>, String> {
    if let (Some(account_id), Some(session_id)) = (account_id, session_id) {
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
    let dashboard = tokio::task::spawn_blocking(move || {
        discussions::list_discussions_dashboard_at_revision(revision)
    })
    .await
    .map_err(|error| error.to_string())??;
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

/// Les operations de maintenance automatisee (drain / mise a jour) restent
/// reservees au secret administrateur et ne sont jamais ouvertes aux comptes
/// utilisateurs ordinaires.
fn check_maintenance_header(
    state: &Arc<ServerState>,
    headers: &HeaderMap,
) -> Result<(), Response> {
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
