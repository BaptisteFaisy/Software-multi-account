mod account_usage;
mod auth;
mod autonomous;
mod chat;
mod chat_model_tools;
pub mod chat_tools;
mod client_startup;
pub mod devices;
mod discussions;
mod doctolib_lab;
mod fs_util;
mod kombai;
mod metrics;
mod orchestration;
mod pool;
mod provider;
mod security;
pub mod server;
mod settings;
mod terminal;
mod voice;
mod work_time;

// `Provider` fait partie des DTOs publics du serveur.
pub use settings::Provider;

use pool::PoolManager;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
#[cfg(feature = "desktop")]
use tauri::Manager;

struct PoolRuntime {
    shutdown: tokio::sync::oneshot::Sender<()>,
    manager: Arc<PoolManager>,
}

#[derive(Default)]
struct PoolState {
    runtime: Mutex<Option<PoolRuntime>>,
    terminal_cursor: Mutex<usize>,
}

#[cfg(feature = "desktop")]
pub fn run() {
    let chat_manager = chat::ChatTurnManager::default();
    let autonomous_manager = autonomous::AutonomousAgentManager::new(
        chat_manager.clone(),
        settings::runtime_data_path("autonomous-agents.json")
            .expect("repertoire des agents autonomes introuvable"),
    )
    .expect("etat des agents autonomes illisible");
    let orchestration_manager = orchestration::OrchestrationManager::new(
        chat_manager.clone(),
        settings::runtime_data_path("orchestrated-runs.json")
            .expect("repertoire des chats orchestres introuvable"),
    )
    .expect("etat des chats orchestres illisible");

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(terminal::TerminalManager::default())
        .manage(chat_manager)
        .manage(autonomous_manager)
        .manage(orchestration_manager)
        .manage(doctolib_lab::DoctolibLabManager::default())
        .manage(PoolState::default())
        .manage(kombai::KombaiManager::default())
        .on_window_event(|window, event| {
            // Arrete le code-server embarque quand la fenetre se ferme, pour ne
            // pas laisser de process orphelin qui occuperait le port 8899.
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                window.state::<kombai::KombaiManager>().shutdown();
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings::load_settings,
            client_startup::client_startup_config,
            settings::save_settings,
            settings::ensure_account_home,
            settings::import_account_docs,
            settings::import_account_json,
            settings::remove_account,
            settings::account_limit_status,
            settings::account_model_catalog,
            settings::pick_project_dir,
            metrics::usage_dashboard,
            account_usage::account_token_usage,
            work_time::work_time_dashboard,
            discussions::list_discussions,
            discussions::list_prompt_history,
            discussions::claim_session_for_terminal,
            discussions::copy_discussion_to_account,
            discussions::move_discussion,
            discussions::export_discussion_transcript,
            discussions::get_discussion_transcript,
            discussions::delete_discussion,
            chat::start_chat_turn,
            chat::list_active_chat_turns,
            chat::chat_turn_status,
            chat::stop_chat_turn,
            autonomous::list_autonomous_agents,
            autonomous::create_autonomous_agent,
            autonomous::update_autonomous_agent,
            autonomous::control_autonomous_agent,
            autonomous::schedule_autonomous_agent,
            autonomous::reassign_autonomous_agent_account,
            autonomous::add_autonomous_agent_memory,
            autonomous::delete_autonomous_agent_memory,
            autonomous::delete_autonomous_agent,
            orchestration::list_orchestrations,
            orchestration::create_orchestration,
            orchestration::promote_autonomous_agent_to_orchestration,
            orchestration::control_orchestration,
            orchestration::reassign_orchestration_account,
            orchestration::delete_orchestration,
            doctolib_lab::doctolib_lab_status,
            doctolib_lab::doctolib_lab_connect,
            doctolib_lab::doctolib_lab_google_calendar_connect,
            doctolib_lab::doctolib_lab_search,
            doctolib_lab::doctolib_lab_confirm,
            voice::process_voice_input,
            voice::voice_runtime_status,
            terminal::start_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::stop_terminal,
            terminal::launch_ide,
            kombai::kombai_status,
            kombai::kombai_start,
            kombai::kombai_stop,
            kombai::kombai_install_extension,
            pool_start,
            pool_stop,
            pool_status,
            pool_pick_terminal_account
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Codex Switch Terminal");
}

fn stop_runtime(state: &PoolState) {
    if let Ok(mut guard) = state.runtime.lock() {
        if let Some(rt) = guard.take() {
            let _ = rt.shutdown.send(());
        }
    }
}

/// Adresse d'ecoute du proxy de pool. Le pool est un proxy PUREMENT LOCAL,
/// consomme via `http://localhost:{port}` : on bind donc sur loopback par
/// defaut. Cela evite la fenetre "Pare-feu Windows Defender / Autoriser l'acces"
/// (declenchee uniquement par un bind sur `0.0.0.0`), qui exige l'admin a chaque
/// lancement tant qu'aucune regle n'est acceptee. Un override explicite reste
/// possible via `CST_POOL_BIND=0.0.0.0:<port>` pour exposer le pool sur le LAN.
fn pool_bind_addr(port: u16) -> String {
    std::env::var("CST_POOL_BIND")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| format!("127.0.0.1:{port}"))
}

#[tauri::command]
async fn pool_start(state: tauri::State<'_, PoolState>) -> Result<Value, String> {
    stop_runtime(&state);

    let settings = settings::load_settings_for_terminal()?;
    let port = settings.pool.port;
    let addr = pool_bind_addr(port);

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("port {port} indisponible: {e}"))?;

    let manager = Arc::new(PoolManager::build(&settings)?);
    // Pool local desktop : proxy purement loopback, pas d'admin_token dans ce
    // process -> pas de jeton break-glass (l'auth reste facultative via la cle
    // API du pool si l'utilisateur en configure une).
    let router = pool::router(manager.clone(), None);
    let (tx, rx) = tokio::sync::oneshot::channel::<()>();

    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router.into_make_service())
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });

    if let Ok(mut guard) = state.runtime.lock() {
        *guard = Some(PoolRuntime {
            shutdown: tx,
            manager: manager.clone(),
        });
    }

    pool_snapshot(&manager, true, port)
}

#[tauri::command]
fn pool_stop(state: tauri::State<'_, PoolState>) -> Result<Value, String> {
    stop_runtime(&state);
    Ok(json!({ "running": false }))
}

#[tauri::command]
fn pool_status(state: tauri::State<'_, PoolState>) -> Result<Value, String> {
    let guard = state
        .runtime
        .lock()
        .map_err(|_| "etat pool verrouille".to_string())?;
    match guard.as_ref() {
        Some(rt) => pool_snapshot(&rt.manager, true, rt.manager.config().port),
        None => {
            // Pool a l'arret : on construit quand meme un snapshot depuis les
            // settings pour que l'UI affiche tous les comptes (avec leur statut
            // de tokens) sans avoir a demarrer le serveur.
            let settings = settings::load_settings_for_terminal()?;
            let port = settings.pool.port;
            let manager = Arc::new(PoolManager::build(&settings)?);
            pool_snapshot(&manager, false, port)
        }
    }
}

#[tauri::command]
fn pool_pick_terminal_account(
    state: tauri::State<'_, PoolState>,
) -> Result<settings::AccountProfile, String> {
    let settings = settings::load_settings_for_terminal()?;
    // Le pool ChatGPT ne rotationne que des comptes Codex authentifies (auth.json).
    let accounts = settings
        .accounts
        .into_iter()
        .filter(|account| account.provider == settings::Provider::Codex)
        .filter(settings::account_has_auth_tokens)
        .collect::<Vec<_>>();

    if accounts.is_empty() {
        return Err(
            "Aucun compte Codex avec auth.json dans le pool. Importe d'abord des JSON.".to_string(),
        );
    }

    let mut cursor = state
        .terminal_cursor
        .lock()
        .map_err(|_| "curseur pool verrouille".to_string())?;
    let index = *cursor % accounts.len();
    *cursor = (*cursor + 1) % accounts.len();

    Ok(accounts[index].clone())
}

fn pool_snapshot(manager: &Arc<PoolManager>, running: bool, port: u16) -> Result<Value, String> {
    let views = manager.status_view();
    let total = views.len();
    let idle = views
        .iter()
        .filter(|a| a.status == pool::AccountStatus::Idle)
        .count();
    Ok(json!({
        "running": running,
        "started_at": manager.started_at(),
        "base_url": format!("http://localhost:{port}"),
        "model": manager.config().default_model,
        "upstream": manager.config().upstream,
        "total": total,
        "idle": idle,
        "accounts": views,
    }))
}
