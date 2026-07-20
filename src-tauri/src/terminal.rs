use crate::{
    metrics,
    settings::{expand_home, load_settings_for_terminal, AccountProfile, AppSettings},
};
use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::Serialize;
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
};
use tauri::{AppHandle, Emitter, State};

#[derive(Default, Clone)]
pub struct TerminalManager {
    sessions: Arc<Mutex<HashMap<u64, Arc<TerminalSession>>>>,
    reservations: Arc<Mutex<HashSet<u64>>>,
    next_id: Arc<AtomicU64>,
}

struct TerminalSession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    child: Mutex<Box<dyn portable_pty::Child + Send>>,
    started_at: i64,
    account_id: String,
    account_label: String,
    recorded_end: AtomicBool,
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

struct TerminalIdReservation {
    reservations: Arc<Mutex<HashSet<u64>>>,
    id: u64,
}

impl TerminalManager {
    pub fn active_agent_runs(&self) -> Vec<metrics::ActiveAgentRun> {
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

    fn reserve_id(&self, requested: Option<u64>) -> Result<TerminalIdReservation, String> {
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
        Ok(TerminalIdReservation {
            reservations: self.reservations.clone(),
            id,
        })
    }
}

impl TerminalIdReservation {
    fn commit(self) {
        // Le live-id est desormais porte par `sessions`.
    }
}

impl Drop for TerminalIdReservation {
    fn drop(&mut self) {
        if let Ok(mut reservations) = self.reservations.lock() {
            reservations.remove(&self.id);
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct PtyDataEvent {
    id: u64,
    data: String,
}

#[derive(Debug, Clone, Serialize)]
struct PtyExitEvent {
    id: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartTerminalResponse {
    id: u64,
    workspace_id: String,
    workspace_path: String,
}

#[tauri::command]
pub fn start_terminal(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    id: Option<u64>,
    account_id: String,
    cols: u16,
    rows: u16,
    command: Option<String>,
    project_dir: Option<String>,
    login_only: bool,
) -> Result<StartTerminalResponse, String> {
    let settings = load_settings_for_terminal()?;
    let account = settings
        .accounts
        .iter()
        .find(|candidate| candidate.id == account_id)
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

    // Reserve avant toute operation couteuse : deux appels concurrents ne
    // peuvent plus spawner sous le meme identifiant puis s'ecraser dans la map.
    let id_reservation = state.reserve_id(id)?;
    let id = id_reservation.id;

    let account_home = expand_home(&account.codex_home)?;
    std::fs::create_dir_all(&account_home).map_err(|error| error.to_string())?;
    // L'authentification est independante de tout projet : son terminal
    // temporaire reste dans le home isole du compte. Les terminaux de travail
    // continuent d'exiger un environnement explicitement choisi.
    let project_dir = if login_only {
        account_home.clone()
    } else {
        resolve_terminal_environment(project_dir.as_deref())?
    };
    let workspace_path = project_dir.to_string_lossy().to_string();
    let workspace_id = workspace_path.clone();

    // Le terminal utilise le home permanent du compte et le dossier choisi.
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
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let mut builder = shell_command(&settings);
    // Isolation multi-comptes : Codex lit CODEX_HOME, Claude lit
    // CLAUDE_CONFIG_DIR. Voir `provider::Provider::home_env_var`.
    for (key, value) in provider.home_env(&account_home) {
        builder.env(key, value);
    }
    builder.env("TERM", "xterm-256color");
    builder.env("COLORTERM", "truecolor");
    builder.cwd(project_dir.as_os_str());
    builder.env("PWD", &workspace_path);

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

    let session = Arc::new(TerminalSession {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        child: Mutex::new(child),
        started_at: metrics::now_ts(),
        account_id: account.id.clone(),
        account_label: account.label.clone(),
        recorded_end: AtomicBool::new(false),
    });

    {
        let mut sessions = state
            .sessions
            .lock()
            .map_err(|_| "Etat terminal verrouille".to_string())?;
        if sessions.contains_key(&id) {
            return Err(format!("Identifiant terminal deja vivant: {id}"));
        }
        sessions.insert(id, session.clone());
    }
    id_reservation.commit();

    let sessions = state.sessions.clone();
    let reader_app = app.clone();
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let data = String::from_utf8_lossy(&buffer[..size]).to_string();
                    let _ = reader_app.emit("pty-data", PtyDataEvent { id, data });
                }
                Err(_) => break,
            }
        }

        let ended = sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(&id));
        if let Some(session) = ended {
            finish_session(&session);
        }
        let _ = reader_app.emit("pty-exit", PtyExitEvent { id });
    });

    emit_banner(
        &app,
        id,
        &account,
        proxy.map(|proxy| proxy.label.as_str()),
        Some(&project_dir),
    )?;
    let command = if login_only {
        // Ne lance jamais la commande normale du compte apres une reconnexion.
        command
    } else {
        command.or_else(|| account.startup_command.clone())
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
        workspace_path,
    })
}

#[tauri::command]
pub fn write_terminal(
    state: State<'_, TerminalManager>,
    id: u64,
    data: String,
) -> Result<(), String> {
    let session = get_session(&state, id)?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "Writer terminal verrouille".to_string())?;
    writer
        .write_all(data.as_bytes())
        .and_then(|_| writer.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn resize_terminal(
    state: State<'_, TerminalManager>,
    id: u64,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = get_session(&state, id)?;
    let result = {
        let master = session
            .master
            .lock()
            .map_err(|_| "PTY verrouille".to_string())?;
        master.resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(20),
            pixel_width: 0,
            pixel_height: 0,
        })
    };

    result.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn stop_terminal(state: State<'_, TerminalManager>, id: u64) -> Result<(), String> {
    let Some(session) = state
        .sessions
        .lock()
        .map_err(|_| "Etat terminal verrouille".to_string())?
        .remove(&id)
    else {
        return Ok(());
    };

    let result = {
        let mut child = session
            .child
            .lock()
            .map_err(|_| "Process terminal verrouille".to_string())?;
        finish_session(&session);
        child.kill()
    };

    result.map_err(|error| error.to_string())
}

fn finish_session(session: &Arc<TerminalSession>) {
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

fn get_session(
    state: &State<'_, TerminalManager>,
    id: u64,
) -> Result<Arc<TerminalSession>, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "Etat terminal verrouille".to_string())?
        .get(&id)
        .cloned()
        .ok_or_else(|| "Session terminal introuvable".to_string())
}

fn shell_command(settings: &AppSettings) -> CommandBuilder {
    let shell = settings.shell.trim();
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

fn resolve_terminal_environment(raw: Option<&str>) -> Result<PathBuf, String> {
    let Some(raw) = raw.map(str::trim).filter(|value| !value.is_empty()) else {
        return Err("Environnement obligatoire avant d'ouvrir un terminal".to_string());
    };

    let project_dir = expand_home(raw)?;
    if !project_dir.is_dir() {
        return Err(format!("Environnement introuvable: {raw}"));
    }

    Ok(project_dir)
}

fn emit_banner(
    app: &AppHandle,
    id: u64,
    account: &AccountProfile,
    proxy_label: Option<&str>,
    project_dir: Option<&Path>,
) -> Result<(), String> {
    let proxy = proxy_label.unwrap_or("sans proxy");
    let project = project_dir
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "dossier par defaut".to_string());
    let home_var = account.provider.home_env_var();
    let banner = format!(
        "\r\n[Codex Switch Terminal] session #{id} | provider: {} | compte: {} | {home_var}: {} | projet: {project} | proxy: {proxy}\r\n\r\n",
        account.provider.as_str(),
        account.label,
        account.codex_home
    );

    app.emit("pty-data", PtyDataEvent { id, data: banner })
        .map_err(|error| error.to_string())
}

/// Lance un editeur (agent "ide", ex. Kombai dans VS Code / Cursor / Windsurf /
/// Trae / Antigravity / Kiro) ouvert sur le dossier projet. Le process editeur
/// est detache : il survit a la fermeture de l'application.
#[tauri::command]
pub fn launch_ide(command: String, project_dir: Option<String>) -> Result<(), String> {
    let command = command.trim().to_string();
    if command.is_empty() {
        return Err("Commande IDE vide".to_string());
    }

    let dir = match project_dir
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(raw) => {
            let path = expand_home(raw)?;
            if !path.is_dir() {
                return Err(format!("Dossier projet introuvable: {raw}"));
            }
            Some(path)
        }
        None => None,
    };

    let mut builder = ide_command(&command, dir.as_deref());
    builder
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        builder.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    builder
        .spawn()
        .map(|_| ())
        .map_err(|error| format!("Lancement IDE impossible ({command}): {error}"))
}

fn ide_command(command: &str, project_dir: Option<&Path>) -> Command {
    if cfg!(windows) {
        // Les lanceurs d'editeurs (code, cursor, windsurf, ...) sont des scripts
        // .cmd sur le PATH : on passe par cmd.exe. On ne cite pas la commande
        // (pour laisser passer d'eventuels flags) ; seul le chemin est cite.
        let mut line = command.to_string();
        if let Some(path) = project_dir {
            line.push(' ');
            line.push_str(&quote_windows_arg(&path.to_string_lossy()));
        }
        let mut builder = Command::new("cmd.exe");
        builder.arg("/S").arg("/C").arg(line);
        if let Some(path) = project_dir {
            builder.current_dir(path);
        }
        builder
    } else {
        let mut parts = command.split_whitespace();
        let program = parts.next().unwrap_or(command);
        let mut builder = Command::new(program);
        builder.args(parts);
        if let Some(path) = project_dir {
            builder.arg(path);
            builder.current_dir(path);
        }
        builder
    }
}

fn quote_windows_arg(value: &str) -> String {
    if value.contains([' ', '\t']) && !value.starts_with('"') {
        format!("\"{}\"", value.replace('"', "\\\""))
    } else {
        value.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_terminal_id_is_reserved_atomically() {
        let manager = TerminalManager::default();
        let reservation = manager.reserve_id(Some(42)).unwrap();
        assert!(manager.reserve_id(Some(42)).is_err());
        drop(reservation);
        assert!(manager.reserve_id(Some(42)).is_ok());
    }

    #[test]
    fn start_response_uses_selected_directory_directly() {
        let value = serde_json::to_value(StartTerminalResponse {
            id: 42,
            workspace_id: "C:/projects/app".to_string(),
            workspace_path: "C:/projects/app".to_string(),
        })
        .unwrap();

        assert_eq!(value["id"], 42);
        assert_eq!(value["workspaceId"], "C:/projects/app");
        assert_eq!(value["workspacePath"], "C:/projects/app");
    }

    #[test]
    fn terminal_environment_is_mandatory() {
        assert!(resolve_terminal_environment(None).is_err());
        assert!(resolve_terminal_environment(Some("   ")).is_err());
        let temp = std::env::temp_dir();
        assert_eq!(resolve_terminal_environment(temp.to_str()).unwrap(), temp);
    }
}
