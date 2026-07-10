mod account_usage;
mod client_startup;
mod discussions;
mod kombai;
mod metrics;
mod pool;
pub mod server;
mod settings;
mod terminal;

use pool::PoolManager;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
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

pub fn run() {
    tauri::Builder::default()
        .manage(terminal::TerminalManager::default())
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
            settings::pick_project_dir,
            metrics::usage_dashboard,
            account_usage::account_token_usage,
            discussions::list_discussions,
            discussions::list_prompt_history,
            discussions::claim_session_for_terminal,
            discussions::copy_discussion_to_account,
            discussions::delete_discussion,
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

#[tauri::command]
async fn pool_start(state: tauri::State<'_, PoolState>) -> Result<Value, String> {
    stop_runtime(&state);

    let settings = settings::load_settings_for_terminal()?;
    let port = settings.pool.port;
    let addr = format!("0.0.0.0:{port}");

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("port {port} indisponible: {e}"))?;

    let manager = Arc::new(PoolManager::build(&settings)?);
    let router = pool::router(manager.clone());
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
    let accounts = settings
        .accounts
        .into_iter()
        .filter(settings::account_has_auth_tokens)
        .collect::<Vec<_>>();

    if accounts.is_empty() {
        return Err(
            "Aucun compte avec auth.json dans le pool. Importe d'abord des JSON.".to_string(),
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
