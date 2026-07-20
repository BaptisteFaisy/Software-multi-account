use crate::autonomous::AutonomousAgentManager;
use chrono::Utc;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::ErrorKind,
    path::Path,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use uuid::Uuid;

pub const DESKTOP_TELEGRAM_OWNER: &str = "desktop";
const TELEGRAM_CONNECTIONS_FILE: &str = "telegram-connections.json";
const TELEGRAM_API_BASE_URL: &str = "https://api.telegram.org";
const BOTFATHER_URL: &str = "https://t.me/BotFather";
const STORE_VERSION: u8 = 2;
const MAX_BOT_TOKEN_CHARS: usize = 256;
const MAX_MESSAGE_CHARS: usize = 3_900;
const PAIRING_TTL_SECONDS: i64 = 15 * 60;
const MANAGED_BOT_REQUEST_TTL_SECONDS: i64 = 24 * 60 * 60;
const NOTIFICATION_QUEUE_CAPACITY: usize = 128;
const MAX_RECENT_INBOUND_MESSAGES: usize = 256;
const MAX_RECENT_OUTBOUND_MESSAGES: usize = 256;

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static POLLING_MANAGER: OnceLock<AutonomousAgentManager> = OnceLock::new();
static ACTIVE_POLLERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static ACTIVE_MANAGER_POLLERS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static NOTIFICATION_SENDER: OnceLock<mpsc::SyncSender<TelegramNotificationJob>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConnectionView {
    pub connected: bool,
    pub paired: bool,
    pub channel_id: Option<String>,
    pub bot_username: Option<String>,
    pub bot_name: Option<String>,
    pub user_hint: Option<String>,
    pub pairing_url: Option<String>,
    pub pairing_expires_at: Option<i64>,
    pub connected_at: Option<i64>,
    pub paired_at: Option<i64>,
    pub botfather_url: String,
    pub free: bool,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTelegramRequest {
    pub bot_token: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramManagerView {
    pub connected: bool,
    pub management_enabled: bool,
    pub bot_username: Option<String>,
    pub bot_name: Option<String>,
    pub pending_bot_username: Option<String>,
    pub pending_bot_name: Option<String>,
    pub creation_url: Option<String>,
    pub pending_expires_at: Option<i64>,
    pub last_created_bot_username: Option<String>,
    pub last_created_at: Option<i64>,
    pub last_error: Option<String>,
    pub connected_at: Option<i64>,
    pub botfather_url: String,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectTelegramManagerRequest {
    pub bot_token: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareManagedTelegramBotRequest {
    pub username: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendResult {
    pub message_id: i64,
    pub sent_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTelegramConnection {
    id: String,
    owner_id: String,
    #[serde(default)]
    bot_token: Option<String>,
    #[serde(default)]
    bot_id: Option<i64>,
    #[serde(default)]
    bot_username: Option<String>,
    #[serde(default)]
    bot_name: Option<String>,
    #[serde(default)]
    chat_id: Option<i64>,
    #[serde(default)]
    telegram_user_id: Option<i64>,
    #[serde(default)]
    telegram_username: Option<String>,
    #[serde(default)]
    telegram_display_name: Option<String>,
    #[serde(default)]
    required_pairing_user_id: Option<i64>,
    #[serde(default)]
    pairing_code: Option<String>,
    #[serde(default)]
    pairing_expires_at: Option<i64>,
    #[serde(default)]
    next_update_offset: Option<i64>,
    #[serde(default)]
    recent_inbound_message_ids: Vec<i64>,
    #[serde(default)]
    outbound_agent_messages: Vec<StoredTelegramAgentMessage>,
    created_at: i64,
    #[serde(default)]
    connected_at: Option<i64>,
    #[serde(default)]
    paired_at: Option<i64>,
    updated_at: i64,
}

impl StoredTelegramConnection {
    fn connected(&self) -> bool {
        self.bot_token
            .as_deref()
            .is_some_and(|value| !value.is_empty())
            && self.bot_id.is_some()
            && self
                .bot_username
                .as_deref()
                .is_some_and(|value| !value.is_empty())
    }

    fn paired(&self) -> bool {
        self.connected() && self.chat_id.is_some() && self.telegram_user_id.is_some()
    }

    fn clear_credentials(&mut self, now: i64) {
        self.bot_token = None;
        self.bot_id = None;
        self.bot_username = None;
        self.bot_name = None;
        self.chat_id = None;
        self.telegram_user_id = None;
        self.telegram_username = None;
        self.telegram_display_name = None;
        self.required_pairing_user_id = None;
        self.pairing_code = None;
        self.pairing_expires_at = None;
        self.next_update_offset = None;
        self.recent_inbound_message_ids.clear();
        self.outbound_agent_messages.clear();
        self.connected_at = None;
        self.paired_at = None;
        self.updated_at = now;
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTelegramAgentMessage {
    message_id: i64,
    agent_id: String,
    agent_name: String,
    sent_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredTelegramManager {
    id: String,
    owner_id: String,
    #[serde(default)]
    bot_token: Option<String>,
    #[serde(default)]
    bot_id: Option<i64>,
    #[serde(default)]
    bot_username: Option<String>,
    #[serde(default)]
    bot_name: Option<String>,
    #[serde(default)]
    next_update_offset: Option<i64>,
    #[serde(default)]
    pending_bot_username: Option<String>,
    #[serde(default)]
    pending_bot_name: Option<String>,
    #[serde(default)]
    pending_created_at: Option<i64>,
    #[serde(default)]
    last_created_bot_username: Option<String>,
    #[serde(default)]
    last_created_at: Option<i64>,
    #[serde(default)]
    last_error: Option<String>,
    created_at: i64,
    #[serde(default)]
    connected_at: Option<i64>,
    updated_at: i64,
}

impl StoredTelegramManager {
    fn connected(&self) -> bool {
        self.bot_token
            .as_deref()
            .is_some_and(|value| !value.is_empty())
            && self.bot_id.is_some()
            && self
                .bot_username
                .as_deref()
                .is_some_and(|value| !value.is_empty())
    }

    fn pending_active(&self, now: i64) -> bool {
        self.connected()
            && self
                .pending_created_at
                .is_some_and(|created_at| created_at + MANAGED_BOT_REQUEST_TTL_SECONDS > now)
            && self
                .pending_bot_username
                .as_deref()
                .is_some_and(|value| !value.is_empty())
    }

    fn clear_pending(&mut self) {
        self.pending_bot_username = None;
        self.pending_bot_name = None;
        self.pending_created_at = None;
    }

    fn clear_credentials(&mut self, now: i64) {
        self.bot_token = None;
        self.bot_id = None;
        self.bot_username = None;
        self.bot_name = None;
        self.next_update_offset = None;
        self.clear_pending();
        self.last_error = None;
        self.connected_at = None;
        self.updated_at = now;
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramConnectionStore {
    #[serde(default = "store_version")]
    version: u8,
    #[serde(default)]
    connections: Vec<StoredTelegramConnection>,
    #[serde(default)]
    managers: Vec<StoredTelegramManager>,
}

#[derive(Debug)]
struct TelegramNotificationJob {
    channel_id: String,
    agent_id: String,
    agent_name: String,
    content: String,
}

#[derive(Debug, Clone)]
struct TelegramInboundMessage {
    channel_id: String,
    message_id: i64,
    content: String,
    reply_to_message_id: Option<i64>,
}

#[derive(Debug)]
enum TelegramUpdateAction {
    Paired {
        channel_id: String,
        chat_id: i64,
        bot_username: String,
    },
    InvalidPairing {
        channel_id: String,
        chat_id: i64,
    },
    Inbound(TelegramInboundMessage),
}

#[derive(Debug, Clone)]
struct TelegramBotView {
    id: i64,
    username: String,
    name: String,
    can_manage_bots: bool,
}

fn store_version() -> u8 {
    STORE_VERSION
}

fn connections_path() -> Result<std::path::PathBuf, String> {
    crate::settings::runtime_data_path(TELEGRAM_CONNECTIONS_FILE)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Verrou de la connexion Telegram indisponible.".to_string())
}

fn load_store_from(path: &Path) -> Result<TelegramConnectionStore, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(TelegramConnectionStore {
                version: store_version(),
                ..TelegramConnectionStore::default()
            })
        }
        Err(error) => {
            return Err(format!(
                "Lecture de la connexion Telegram impossible : {error}"
            ))
        }
    };
    let mut store = serde_json::from_str::<TelegramConnectionStore>(&content)
        .map_err(|error| format!("Fichier de connexion Telegram invalide : {error}"))?;
    store.version = store_version();
    Ok(store)
}

fn load_store() -> Result<TelegramConnectionStore, String> {
    load_store_from(&connections_path()?)
}

fn persist_store_to(path: &Path, store: &TelegramConnectionStore) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Sérialisation de la connexion Telegram impossible : {error}"))?;
    crate::fs_util::atomic_write(path, content)
        .map_err(|error| format!("Écriture de la connexion Telegram impossible : {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!("Protection du fichier de connexion Telegram impossible : {error}")
        })?;
    }
    Ok(())
}

fn persist_store(store: &TelegramConnectionStore) -> Result<(), String> {
    persist_store_to(&connections_path()?, store)
}

fn validate_owner_id(owner_id: &str) -> Result<&str, String> {
    let owner_id = owner_id.trim();
    if owner_id.is_empty() || owner_id.len() > 256 || owner_id.chars().any(char::is_control) {
        return Err("Propriétaire de la connexion Telegram invalide.".to_string());
    }
    Ok(owner_id)
}

fn validate_bot_token(value: &str) -> Result<String, String> {
    let value = value.trim();
    let Some((bot_id, secret)) = value.split_once(':') else {
        return Err("Jeton BotFather invalide.".to_string());
    };
    let valid_secret = (20..=160).contains(&secret.len())
        && secret
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'));
    if value.len() > MAX_BOT_TOKEN_CHARS
        || bot_id.is_empty()
        || !bot_id.bytes().all(|byte| byte.is_ascii_digit())
        || !valid_secret
    {
        return Err("Jeton BotFather invalide.".to_string());
    }
    Ok(value.to_string())
}

fn validate_channel_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    Uuid::parse_str(value)
        .map(|_| value.to_string())
        .map_err(|_| "Canal de notification Telegram invalide.".to_string())
}

fn new_pairing_code() -> String {
    Uuid::new_v4().simple().to_string()
}

fn truncate_message(value: &str, max_chars: usize) -> String {
    let mut chars = value.trim().chars();
    let content = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{}…", content.trim_end())
    } else {
        content
    }
}

fn telegram_api_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(candidate) = std::env::var("CST_TEST_TELEGRAM_API_BASE_URL") {
        let candidate = candidate.trim().trim_end_matches('/');
        if let Ok(url) = url::Url::parse(candidate) {
            let loopback = url
                .host_str()
                .and_then(|host| host.parse::<std::net::IpAddr>().ok())
                .is_some_and(|host| host.is_loopback());
            if url.scheme() == "http"
                && loopback
                && url.username().is_empty()
                && url.password().is_none()
                && matches!(url.path(), "" | "/")
                && url.query().is_none()
                && url.fragment().is_none()
            {
                return candidate.to_string();
            }
        }
    }
    TELEGRAM_API_BASE_URL.to_string()
}

fn graph_client(long_poll: bool) -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(if long_poll { 35 } else { 20 }))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client Telegram indisponible : {error}"))
}

fn telegram_error(value: &Value, status: reqwest::StatusCode, bot_token: &str) -> String {
    value
        .get("description")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|message| !message.trim().is_empty())
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()))
        .replace(bot_token, "***")
}

async fn telegram_api_call(
    bot_token: &str,
    method: &str,
    payload: Value,
    long_poll: bool,
) -> Result<Value, String> {
    let response = graph_client(long_poll)?
        .post(format!(
            "{}/bot{}/{}",
            telegram_api_base_url(),
            bot_token,
            method
        ))
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Telegram injoignable : {}", error.without_url()))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|_| "Réponse Telegram invalide.".to_string())?;
    if !status.is_success() || value.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(format!(
            "Telegram a refusé la requête : {}",
            telegram_error(&value, status, bot_token)
        ));
    }
    value
        .get("result")
        .cloned()
        .ok_or_else(|| "Réponse Telegram sans résultat.".to_string())
}

async fn validate_bot_remotely(bot_token: &str) -> Result<TelegramBotView, String> {
    let result = telegram_api_call(bot_token, "getMe", json!({}), false).await?;
    if result.get("is_bot").and_then(Value::as_bool) != Some(true) {
        return Err("Le jeton Telegram ne correspond pas à un bot.".to_string());
    }
    let id = result
        .get("id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Telegram n’a pas renvoyé l’identifiant du bot.".to_string())?;
    let username = result
        .get("username")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Le bot Telegram doit avoir un nom d’utilisateur.".to_string())?;
    let name = result
        .get("first_name")
        .and_then(Value::as_str)
        .unwrap_or(&username)
        .to_string();
    let can_manage_bots = result
        .get("can_manage_bots")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let webhook = telegram_api_call(bot_token, "getWebhookInfo", json!({}), false).await?;
    if webhook
        .get("url")
        .and_then(Value::as_str)
        .is_some_and(|url| !url.is_empty())
    {
        return Err(
            "Ce bot utilise déjà un webhook. Crée un bot dédié avec BotFather ou retire son webhook avant de le connecter."
                .to_string(),
        );
    }
    Ok(TelegramBotView {
        id,
        username,
        name,
        can_manage_bots,
    })
}

fn validate_managed_bot_username(value: &str) -> Result<String, String> {
    let value = value.trim().trim_start_matches('@');
    if !(5..=32).contains(&value.len())
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        || !value.to_ascii_lowercase().ends_with("bot")
    {
        return Err(
            "Le nom d’utilisateur doit contenir 5 à 32 lettres, chiffres ou _, et finir par bot."
                .to_string(),
        );
    }
    Ok(value.to_string())
}

fn validate_managed_bot_name(value: &str) -> Result<String, String> {
    let value = value.trim();
    let length = value.chars().count();
    if !(1..=64).contains(&length) || value.chars().any(char::is_control) {
        return Err("Le nom du bot doit contenir entre 1 et 64 caractères.".to_string());
    }
    Ok(value.to_string())
}

fn managed_bot_creation_url(
    manager_username: &str,
    bot_username: &str,
    bot_name: &str,
) -> Result<String, String> {
    let mut url = url::Url::parse("https://t.me")
        .map_err(|_| "Lien de création Telegram indisponible.".to_string())?;
    {
        let mut segments = url
            .path_segments_mut()
            .map_err(|_| "Lien de création Telegram indisponible.".to_string())?;
        segments
            .push("newbot")
            .push(manager_username)
            .push(bot_username);
    }
    url.query_pairs_mut().append_pair("name", bot_name);
    Ok(url.into())
}

fn disconnected_manager_view() -> TelegramManagerView {
    TelegramManagerView {
        connected: false,
        management_enabled: false,
        bot_username: None,
        bot_name: None,
        pending_bot_username: None,
        pending_bot_name: None,
        creation_url: None,
        pending_expires_at: None,
        last_created_bot_username: None,
        last_created_at: None,
        last_error: None,
        connected_at: None,
        botfather_url: BOTFATHER_URL.to_string(),
        note: "Crée une seule fois un bot gestionnaire dans BotFather et active Bot Management Mode. L’application pourra ensuite préparer et récupérer automatiquement les futurs bots."
            .to_string(),
    }
}

fn manager_view(manager: Option<&StoredTelegramManager>) -> TelegramManagerView {
    let Some(manager) = manager.filter(|manager| manager.connected()) else {
        return disconnected_manager_view();
    };
    let now = Utc::now().timestamp();
    let pending_active = manager.pending_active(now);
    let creation_url = if pending_active {
        match (
            manager.bot_username.as_deref(),
            manager.pending_bot_username.as_deref(),
            manager.pending_bot_name.as_deref(),
        ) {
            (Some(manager_username), Some(bot_username), Some(bot_name)) => {
                managed_bot_creation_url(manager_username, bot_username, bot_name).ok()
            }
            _ => None,
        }
    } else {
        None
    };
    TelegramManagerView {
        connected: true,
        management_enabled: true,
        bot_username: manager.bot_username.clone(),
        bot_name: manager.bot_name.clone(),
        pending_bot_username: pending_active
            .then(|| manager.pending_bot_username.clone())
            .flatten(),
        pending_bot_name: pending_active
            .then(|| manager.pending_bot_name.clone())
            .flatten(),
        creation_url,
        pending_expires_at: pending_active
            .then(|| {
                manager
                    .pending_created_at
                    .map(|created_at| created_at + MANAGED_BOT_REQUEST_TTL_SECONDS)
            })
            .flatten(),
        last_created_bot_username: manager.last_created_bot_username.clone(),
        last_created_at: manager.last_created_at,
        last_error: manager.last_error.clone(),
        connected_at: manager.connected_at,
        botfather_url: BOTFATHER_URL.to_string(),
        note: if pending_active {
            "Confirme la création dans Telegram sans modifier le @username proposé. Le jeton sera récupéré sans être affiché."
                .to_string()
        } else {
            "Bot gestionnaire prêt. Prépare un bot de notification quand tu en as besoin."
                .to_string()
        },
    }
}

pub(crate) fn telegram_manager_for_owner(owner_id: &str) -> Result<TelegramManagerView, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    Ok(manager_view(
        store
            .managers
            .iter()
            .find(|manager| manager.owner_id == owner_id),
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn telegram_manager() -> Result<TelegramManagerView, String> {
    telegram_manager_for_owner(DESKTOP_TELEGRAM_OWNER)
}

pub(crate) async fn connect_telegram_manager_for_owner(
    owner_id: &str,
    request: ConnectTelegramManagerRequest,
) -> Result<TelegramManagerView, String> {
    let owner_id = validate_owner_id(owner_id)?.to_string();
    let bot_token = validate_bot_token(&request.bot_token)?;
    let bot = validate_bot_remotely(&bot_token).await?;
    if !bot.can_manage_bots {
        return Err(
            "Bot Management Mode n’est pas activé pour ce bot. Active-le dans les réglages BotFather, puis réessaie."
                .to_string(),
        );
    }
    let now = Utc::now().timestamp();
    let manager_id;
    let view;
    {
        let _guard = lock_store()?;
        let mut store = load_store()?;
        if store
            .connections
            .iter()
            .any(|connection| connection.bot_id == Some(bot.id) && connection.connected())
        {
            return Err(
                "Ce bot sert déjà aux notifications. Utilise un bot gestionnaire dédié."
                    .to_string(),
            );
        }
        if store.managers.iter().any(|manager| {
            manager.owner_id != owner_id && manager.bot_id == Some(bot.id) && manager.connected()
        }) {
            return Err("Ce bot gestionnaire est déjà lié à un autre utilisateur.".to_string());
        }
        let index = store
            .managers
            .iter()
            .position(|manager| manager.owner_id == owner_id);
        let manager = match index {
            Some(index) => {
                let manager = &mut store.managers[index];
                let same_bot = manager.bot_id == Some(bot.id);
                manager.bot_token = Some(bot_token);
                manager.bot_id = Some(bot.id);
                manager.bot_username = Some(bot.username);
                manager.bot_name = Some(bot.name);
                if !same_bot {
                    manager.next_update_offset = None;
                    manager.clear_pending();
                    manager.last_created_bot_username = None;
                    manager.last_created_at = None;
                }
                manager.last_error = None;
                manager.connected_at = Some(now);
                manager.updated_at = now;
                manager.clone()
            }
            None => StoredTelegramManager {
                id: Uuid::new_v4().to_string(),
                owner_id,
                bot_token: Some(bot_token),
                bot_id: Some(bot.id),
                bot_username: Some(bot.username),
                bot_name: Some(bot.name),
                next_update_offset: None,
                pending_bot_username: None,
                pending_bot_name: None,
                pending_created_at: None,
                last_created_bot_username: None,
                last_created_at: None,
                last_error: None,
                created_at: now,
                connected_at: Some(now),
                updated_at: now,
            },
        };
        if index.is_none() {
            store.managers.push(manager.clone());
        }
        manager_id = manager.id.clone();
        view = manager_view(Some(&manager));
        persist_store(&store)?;
    }
    ensure_manager_poller(&manager_id);
    Ok(view)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn connect_telegram_manager(
    request: ConnectTelegramManagerRequest,
) -> Result<TelegramManagerView, String> {
    connect_telegram_manager_for_owner(DESKTOP_TELEGRAM_OWNER, request).await
}

pub(crate) fn prepare_managed_telegram_bot_for_owner(
    owner_id: &str,
    request: PrepareManagedTelegramBotRequest,
) -> Result<TelegramManagerView, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let username = validate_managed_bot_username(&request.username)?;
    let name = validate_managed_bot_name(&request.name)?;
    let now = Utc::now().timestamp();
    let manager_id;
    let view;
    {
        let _guard = lock_store()?;
        let mut store = load_store()?;
        let manager = store
            .managers
            .iter_mut()
            .find(|manager| manager.owner_id == owner_id && manager.connected())
            .ok_or_else(|| "Aucun bot gestionnaire Telegram connecté.".to_string())?;
        manager.pending_bot_username = Some(username);
        manager.pending_bot_name = Some(name);
        manager.pending_created_at = Some(now);
        manager.last_error = None;
        manager.updated_at = now;
        manager_id = manager.id.clone();
        view = manager_view(Some(manager));
        persist_store(&store)?;
    }
    ensure_manager_poller(&manager_id);
    Ok(view)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn prepare_managed_telegram_bot(
    request: PrepareManagedTelegramBotRequest,
) -> Result<TelegramManagerView, String> {
    prepare_managed_telegram_bot_for_owner(DESKTOP_TELEGRAM_OWNER, request)
}

pub(crate) fn disconnect_telegram_manager_for_owner(
    owner_id: &str,
) -> Result<TelegramManagerView, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let _guard = lock_store()?;
    let mut store = load_store()?;
    if let Some(manager) = store
        .managers
        .iter_mut()
        .find(|manager| manager.owner_id == owner_id)
    {
        manager.clear_credentials(Utc::now().timestamp());
        persist_store(&store)?;
    }
    Ok(disconnected_manager_view())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn disconnect_telegram_manager() -> Result<TelegramManagerView, String> {
    disconnect_telegram_manager_for_owner(DESKTOP_TELEGRAM_OWNER)
}

fn disconnected_view() -> TelegramConnectionView {
    TelegramConnectionView {
        connected: false,
        paired: false,
        channel_id: None,
        bot_username: None,
        bot_name: None,
        user_hint: None,
        pairing_url: None,
        pairing_expires_at: None,
        connected_at: None,
        paired_at: None,
        botfather_url: BOTFATHER_URL.to_string(),
        free: true,
        note: "Crée gratuitement un bot avec BotFather, puis colle son jeton ici. Aucun numéro de téléphone n’est conservé."
            .to_string(),
    }
}

fn connection_view(connection: Option<&StoredTelegramConnection>) -> TelegramConnectionView {
    let Some(connection) = connection.filter(|connection| connection.connected()) else {
        return disconnected_view();
    };
    let now = Utc::now().timestamp();
    let pairing_active = !connection.paired()
        && connection
            .pairing_expires_at
            .is_some_and(|expiry| expiry > now)
        && connection
            .pairing_code
            .as_deref()
            .is_some_and(|code| !code.is_empty());
    let pairing_url = pairing_active.then(|| {
        format!(
            "https://t.me/{}?start={}",
            connection.bot_username.as_deref().unwrap_or_default(),
            connection.pairing_code.as_deref().unwrap_or_default()
        )
    });
    let user_hint = connection
        .telegram_username
        .as_deref()
        .map(|username| format!("@{username}"))
        .or_else(|| connection.telegram_display_name.clone());
    TelegramConnectionView {
        connected: true,
        paired: connection.paired(),
        channel_id: Some(connection.id.clone()),
        bot_username: connection.bot_username.clone(),
        bot_name: connection.bot_name.clone(),
        user_hint,
        pairing_url,
        pairing_expires_at: pairing_active
            .then_some(connection.pairing_expires_at)
            .flatten(),
        connected_at: connection.connected_at,
        paired_at: connection.paired_at,
        botfather_url: BOTFATHER_URL.to_string(),
        free: true,
        note: if connection.paired() {
            "Conversation Telegram active. Réponds à un rapport ou utilise /agents pour choisir un agent."
                .to_string()
        } else if pairing_active {
            "Ouvre le lien d’appairage dans Telegram et appuie sur Démarrer.".to_string()
        } else {
            "Le lien d’appairage a expiré. Génère un nouveau lien.".to_string()
        },
    }
}

pub(crate) fn telegram_connection_for_owner(
    owner_id: &str,
) -> Result<TelegramConnectionView, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    Ok(connection_view(
        store
            .connections
            .iter()
            .find(|connection| connection.owner_id == owner_id),
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn telegram_connection() -> Result<TelegramConnectionView, String> {
    telegram_connection_for_owner(DESKTOP_TELEGRAM_OWNER)
}

fn store_connected_bot_for_owner(
    owner_id: String,
    bot_token: String,
    bot: TelegramBotView,
    required_pairing_user_id: Option<i64>,
) -> Result<TelegramConnectionView, String> {
    if bot.can_manage_bots {
        return Err(
            "Ce bot a Bot Management Mode activé. Utilise-le comme gestionnaire et connecte un bot de notification distinct."
                .to_string(),
        );
    }
    let now = Utc::now().timestamp();
    let channel_id;
    let view;
    {
        let _guard = lock_store()?;
        let mut store = load_store()?;
        if store
            .managers
            .iter()
            .any(|manager| manager.bot_id == Some(bot.id) && manager.connected())
        {
            return Err(
                "Ce bot sert déjà de gestionnaire. Utilise un bot de notification distinct."
                    .to_string(),
            );
        }
        if store.connections.iter().any(|connection| {
            connection.owner_id != owner_id
                && connection.bot_id == Some(bot.id)
                && connection.connected()
        }) {
            return Err("Ce bot Telegram est déjà lié à un autre utilisateur.".to_string());
        }
        let index = store
            .connections
            .iter()
            .position(|connection| connection.owner_id == owner_id);
        let connection = match index {
            Some(index) => {
                let connection = &mut store.connections[index];
                let same_bot = connection.bot_id == Some(bot.id);
                let same_pairing_owner =
                    connection.required_pairing_user_id == required_pairing_user_id;
                connection.bot_token = Some(bot_token);
                connection.bot_id = Some(bot.id);
                connection.bot_username = Some(bot.username);
                connection.bot_name = Some(bot.name);
                connection.required_pairing_user_id = required_pairing_user_id;
                if !same_bot || !same_pairing_owner {
                    connection.chat_id = None;
                    connection.telegram_user_id = None;
                    connection.telegram_username = None;
                    connection.telegram_display_name = None;
                    connection.paired_at = None;
                    connection.next_update_offset = None;
                    connection.recent_inbound_message_ids.clear();
                    connection.outbound_agent_messages.clear();
                }
                if !connection.paired() {
                    connection.pairing_code = Some(new_pairing_code());
                    connection.pairing_expires_at = Some(now + PAIRING_TTL_SECONDS);
                }
                connection.connected_at = Some(now);
                connection.updated_at = now;
                connection.clone()
            }
            None => StoredTelegramConnection {
                id: Uuid::new_v4().to_string(),
                owner_id,
                bot_token: Some(bot_token),
                bot_id: Some(bot.id),
                bot_username: Some(bot.username),
                bot_name: Some(bot.name),
                chat_id: None,
                telegram_user_id: None,
                telegram_username: None,
                telegram_display_name: None,
                required_pairing_user_id,
                pairing_code: Some(new_pairing_code()),
                pairing_expires_at: Some(now + PAIRING_TTL_SECONDS),
                next_update_offset: None,
                recent_inbound_message_ids: Vec::new(),
                outbound_agent_messages: Vec::new(),
                created_at: now,
                connected_at: Some(now),
                paired_at: None,
                updated_at: now,
            },
        };
        if index.is_none() {
            store.connections.push(connection.clone());
        }
        channel_id = connection.id.clone();
        view = connection_view(Some(&connection));
        persist_store(&store)?;
    }
    ensure_poller(&channel_id);
    Ok(view)
}

pub(crate) async fn connect_telegram_for_owner(
    owner_id: &str,
    request: ConnectTelegramRequest,
) -> Result<TelegramConnectionView, String> {
    let owner_id = validate_owner_id(owner_id)?.to_string();
    let bot_token = validate_bot_token(&request.bot_token)?;
    let bot = validate_bot_remotely(&bot_token).await?;
    store_connected_bot_for_owner(owner_id, bot_token, bot, None)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn connect_telegram(
    request: ConnectTelegramRequest,
) -> Result<TelegramConnectionView, String> {
    connect_telegram_for_owner(DESKTOP_TELEGRAM_OWNER, request).await
}

pub(crate) fn refresh_telegram_pairing_for_owner(
    owner_id: &str,
) -> Result<TelegramConnectionView, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let now = Utc::now().timestamp();
    let channel_id;
    let view;
    {
        let _guard = lock_store()?;
        let mut store = load_store()?;
        let connection = store
            .connections
            .iter_mut()
            .find(|connection| connection.owner_id == owner_id && connection.connected())
            .ok_or_else(|| "Aucun bot Telegram connecté.".to_string())?;
        connection.chat_id = None;
        connection.telegram_user_id = None;
        connection.telegram_username = None;
        connection.telegram_display_name = None;
        connection.paired_at = None;
        connection.pairing_code = Some(new_pairing_code());
        connection.pairing_expires_at = Some(now + PAIRING_TTL_SECONDS);
        connection.updated_at = now;
        channel_id = connection.id.clone();
        view = connection_view(Some(connection));
        persist_store(&store)?;
    }
    ensure_poller(&channel_id);
    Ok(view)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn refresh_telegram_pairing() -> Result<TelegramConnectionView, String> {
    refresh_telegram_pairing_for_owner(DESKTOP_TELEGRAM_OWNER)
}

pub(crate) fn disconnect_telegram_for_owner(
    owner_id: &str,
) -> Result<TelegramConnectionView, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let _guard = lock_store()?;
    let mut store = load_store()?;
    if let Some(connection) = store
        .connections
        .iter_mut()
        .find(|connection| connection.owner_id == owner_id)
    {
        connection.clear_credentials(Utc::now().timestamp());
        persist_store(&store)?;
    }
    Ok(disconnected_view())
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn disconnect_telegram() -> Result<TelegramConnectionView, String> {
    disconnect_telegram_for_owner(DESKTOP_TELEGRAM_OWNER)
}

pub(crate) fn validate_channel_for_owner(
    owner_id: &str,
    channel_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(channel_id) = channel_id
        .map(str::trim)
        .filter(|channel_id| !channel_id.is_empty())
    else {
        return Ok(None);
    };
    let owner_id = validate_owner_id(owner_id)?;
    let channel_id = validate_channel_id(channel_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    if !store.connections.iter().any(|connection| {
        connection.owner_id == owner_id && connection.id == channel_id && connection.paired()
    }) {
        return Err(
            "Le canal Telegram n’est pas appairé pour cet utilisateur. Termine la liaison dans les paramètres."
                .to_string(),
        );
    }
    Ok(Some(channel_id))
}

pub(crate) fn validate_connected_channel(
    channel_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(channel_id) = channel_id
        .map(str::trim)
        .filter(|channel_id| !channel_id.is_empty())
    else {
        return Ok(None);
    };
    let channel_id = validate_channel_id(channel_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    if !store
        .connections
        .iter()
        .any(|connection| connection.id == channel_id && connection.paired())
    {
        return Err("Le canal Telegram n’est plus appairé.".to_string());
    }
    Ok(Some(channel_id))
}

fn connection_for_channel(channel_id: &str) -> Result<StoredTelegramConnection, String> {
    let channel_id = validate_channel_id(channel_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    store
        .connections
        .into_iter()
        .find(|connection| connection.id == channel_id && connection.connected())
        .ok_or_else(|| "Canal Telegram déconnecté.".to_string())
}

async fn send_text_with_connection(
    connection: &StoredTelegramConnection,
    content: &str,
) -> Result<TelegramSendResult, String> {
    let token = connection
        .bot_token
        .as_deref()
        .ok_or_else(|| "Jeton Telegram absent.".to_string())?;
    let chat_id = connection
        .chat_id
        .ok_or_else(|| "Compte Telegram non appairé.".to_string())?;
    let result = telegram_api_call(
        token,
        "sendMessage",
        json!({
            "chat_id": chat_id,
            "text": truncate_message(content, MAX_MESSAGE_CHARS),
            "link_preview_options": { "is_disabled": true }
        }),
        false,
    )
    .await?;
    let message_id = result
        .get("message_id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Telegram n’a renvoyé aucun identifiant de message.".to_string())?;
    Ok(TelegramSendResult {
        message_id,
        sent_at: Utc::now().timestamp(),
    })
}

pub(crate) async fn test_telegram_for_owner(owner_id: &str) -> Result<TelegramSendResult, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let connection = {
        let _guard = lock_store()?;
        let store = load_store()?;
        store
            .connections
            .into_iter()
            .find(|connection| connection.owner_id == owner_id && connection.paired())
            .ok_or_else(|| "Aucun compte Telegram appairé.".to_string())?
    };
    send_text_with_connection(
        &connection,
        "Test Codex Switch Terminal : les messages Telegram sont opérationnels.",
    )
    .await
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn test_telegram() -> Result<TelegramSendResult, String> {
    test_telegram_for_owner(DESKTOP_TELEGRAM_OWNER).await
}

fn record_outbound_agent_message(
    channel_id: &str,
    message_id: i64,
    agent_id: String,
    agent_name: String,
) -> Result<(), String> {
    let channel_id = validate_channel_id(channel_id)?;
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let connection = store
        .connections
        .iter_mut()
        .find(|connection| connection.id == channel_id)
        .ok_or_else(|| "Canal Telegram introuvable.".to_string())?;
    connection
        .outbound_agent_messages
        .push(StoredTelegramAgentMessage {
            message_id,
            agent_id,
            agent_name,
            sent_at: Utc::now().timestamp(),
        });
    if connection.outbound_agent_messages.len() > MAX_RECENT_OUTBOUND_MESSAGES {
        let excess = connection.outbound_agent_messages.len() - MAX_RECENT_OUTBOUND_MESSAGES;
        connection.outbound_agent_messages.drain(0..excess);
    }
    persist_store(&store)
}

pub(crate) fn agent_target_for_outbound_message(
    channel_id: &str,
    message_id: i64,
) -> Result<Option<String>, String> {
    let channel_id = validate_channel_id(channel_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    Ok(store
        .connections
        .iter()
        .find(|connection| connection.id == channel_id)
        .and_then(|connection| {
            connection
                .outbound_agent_messages
                .iter()
                .rev()
                .find(|message| message.message_id == message_id)
        })
        .map(|message| message.agent_id.clone()))
}

async fn fetch_updates(connection: &StoredTelegramConnection) -> Result<Vec<Value>, String> {
    let token = connection
        .bot_token
        .as_deref()
        .ok_or_else(|| "Jeton Telegram absent.".to_string())?;
    let mut payload = json!({
        "limit": 100,
        "timeout": 25,
        "allowed_updates": ["message"]
    });
    if let Some(offset) = connection.next_update_offset {
        payload["offset"] = json!(offset);
    }
    let result = telegram_api_call(token, "getUpdates", payload, true).await?;
    result
        .as_array()
        .cloned()
        .ok_or_else(|| "Liste de mises à jour Telegram invalide.".to_string())
}

fn manager_for_id(manager_id: &str) -> Result<StoredTelegramManager, String> {
    let manager_id = validate_channel_id(manager_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    store
        .managers
        .into_iter()
        .find(|manager| manager.id == manager_id && manager.connected())
        .ok_or_else(|| "Bot gestionnaire Telegram déconnecté.".to_string())
}

async fn fetch_manager_updates(manager: &StoredTelegramManager) -> Result<Vec<Value>, String> {
    let token = manager
        .bot_token
        .as_deref()
        .ok_or_else(|| "Jeton du bot gestionnaire absent.".to_string())?;
    let mut payload = json!({
        "limit": 100,
        "timeout": 25,
        "allowed_updates": ["managed_bot"]
    });
    if let Some(offset) = manager.next_update_offset {
        payload["offset"] = json!(offset);
    }
    let result = telegram_api_call(token, "getUpdates", payload, true).await?;
    result
        .as_array()
        .cloned()
        .ok_or_else(|| "Liste de mises à jour du bot gestionnaire invalide.".to_string())
}

fn advance_manager_offset(manager_id: &str, update_id: i64) -> Result<(), String> {
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let manager = store
        .managers
        .iter_mut()
        .find(|manager| manager.id == manager_id && manager.connected())
        .ok_or_else(|| "Bot gestionnaire Telegram déconnecté.".to_string())?;
    manager.next_update_offset = Some(update_id.saturating_add(1));
    manager.updated_at = Utc::now().timestamp();
    persist_store(&store)
}

fn record_manager_error(
    manager_id: &str,
    update_id: Option<i64>,
    error: &str,
    clear_pending: bool,
) -> Result<(), String> {
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let manager = store
        .managers
        .iter_mut()
        .find(|manager| manager.id == manager_id && manager.connected())
        .ok_or_else(|| "Bot gestionnaire Telegram déconnecté.".to_string())?;
    if let Some(update_id) = update_id {
        manager.next_update_offset = Some(update_id.saturating_add(1));
    }
    if clear_pending {
        manager.clear_pending();
    }
    manager.last_error = Some(truncate_message(error, 500));
    manager.updated_at = Utc::now().timestamp();
    persist_store(&store)
}

fn finalize_managed_bot_update(
    manager_id: &str,
    update_id: i64,
    bot_username: &str,
) -> Result<(), String> {
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let manager = store
        .managers
        .iter_mut()
        .find(|manager| manager.id == manager_id && manager.connected())
        .ok_or_else(|| "Bot gestionnaire Telegram déconnecté.".to_string())?;
    manager.next_update_offset = Some(update_id.saturating_add(1));
    if manager
        .pending_bot_username
        .as_deref()
        .is_some_and(|pending| pending.eq_ignore_ascii_case(bot_username))
    {
        manager.clear_pending();
    }
    manager.last_created_bot_username = Some(bot_username.to_string());
    manager.last_created_at = Some(Utc::now().timestamp());
    manager.last_error = None;
    manager.updated_at = Utc::now().timestamp();
    persist_store(&store)
}

fn disconnect_managed_child_after_owner_change(owner_id: &str, bot_id: i64) -> Result<(), String> {
    let _guard = lock_store()?;
    let mut store = load_store()?;
    if let Some(connection) = store.connections.iter_mut().find(|connection| {
        connection.owner_id == owner_id
            && connection.bot_id == Some(bot_id)
            && connection.connected()
    }) {
        connection.clear_credentials(Utc::now().timestamp());
        persist_store(&store)?;
    }
    Ok(())
}

async fn process_manager_update(manager_id: &str, update: &Value) -> Result<(), String> {
    let update_id = update
        .get("update_id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Mise à jour du bot gestionnaire sans identifiant.".to_string())?;
    let Some(managed_bot) = update.get("managed_bot") else {
        return advance_manager_offset(manager_id, update_id);
    };
    let creator_user_id = managed_bot
        .pointer("/user/id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Création de bot sans propriétaire Telegram.".to_string())?;
    let bot_id = managed_bot
        .pointer("/bot/id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Création de bot sans identifiant.".to_string())?;
    let bot_username = managed_bot
        .pointer("/bot/username")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Création de bot sans nom d’utilisateur.".to_string())?
        .to_string();
    let bot_name = managed_bot
        .pointer("/bot/first_name")
        .and_then(Value::as_str)
        .unwrap_or(&bot_username)
        .to_string();
    let manager = manager_for_id(manager_id)?;
    let (pending_matches, existing_managed_bot, expected_user_id) = {
        let _guard = lock_store()?;
        let store = load_store()?;
        let pending_matches = manager.pending_active(Utc::now().timestamp())
            && manager
                .pending_bot_username
                .as_deref()
                .is_some_and(|pending| pending.eq_ignore_ascii_case(&bot_username));
        let owner_connection = store
            .connections
            .iter()
            .find(|connection| connection.owner_id == manager.owner_id && connection.connected());
        let existing_managed_bot = owner_connection.is_some_and(|connection| {
            connection.bot_id == Some(bot_id) && connection.required_pairing_user_id.is_some()
        });
        let expected_user_id = if pending_matches {
            owner_connection.and_then(|connection| connection.telegram_user_id)
        } else {
            owner_connection.and_then(|connection| connection.required_pairing_user_id)
        };
        (pending_matches, existing_managed_bot, expected_user_id)
    };
    if !pending_matches && !existing_managed_bot {
        return advance_manager_offset(manager_id, update_id);
    }
    if expected_user_id.is_some_and(|expected| expected != creator_user_id) {
        if existing_managed_bot {
            disconnect_managed_child_after_owner_change(&manager.owner_id, bot_id)?;
        }
        let message = if existing_managed_bot {
            "Le propriétaire Telegram du bot géré a changé. Le bot de notification a été déconnecté par sécurité."
        } else {
            "La création a été confirmée par un autre compte Telegram. Prépare un nouveau @username depuis ton propre compte."
        };
        record_manager_error(manager_id, Some(update_id), message, pending_matches)?;
        return Ok(());
    }
    let manager_token = manager
        .bot_token
        .as_deref()
        .ok_or_else(|| "Jeton du bot gestionnaire absent.".to_string())?;
    if let Err(error) = telegram_api_call(
        manager_token,
        "setManagedBotAccessSettings",
        json!({
            "user_id": bot_id,
            "is_access_restricted": true
        }),
        false,
    )
    .await
    {
        record_manager_error(manager_id, None, &error, false)?;
        return Err(error);
    }
    let token_result = match telegram_api_call(
        manager_token,
        "getManagedBotToken",
        json!({ "user_id": bot_id }),
        false,
    )
    .await
    {
        Ok(result) => result,
        Err(error) => {
            record_manager_error(manager_id, None, &error, false)?;
            return Err(error);
        }
    };
    let bot_token = match token_result
        .as_str()
        .ok_or_else(|| "Telegram n’a pas renvoyé le jeton du bot géré.".to_string())
        .and_then(validate_bot_token)
    {
        Ok(token) => token,
        Err(error) => {
            record_manager_error(manager_id, None, &error, false)?;
            return Err(error);
        }
    };
    let bot = match validate_bot_remotely(&bot_token).await {
        Ok(bot) => bot,
        Err(error) => {
            record_manager_error(manager_id, None, &error, false)?;
            return Err(error);
        }
    };
    if bot.id != bot_id || !bot.username.eq_ignore_ascii_case(&bot_username) {
        let error = "Telegram a renvoyé un jeton qui ne correspond pas au bot créé.";
        record_manager_error(manager_id, Some(update_id), error, pending_matches)?;
        return Err(error.to_string());
    }
    let bot = TelegramBotView {
        id: bot.id,
        username: bot.username,
        name: if bot.name.trim().is_empty() {
            bot_name
        } else {
            bot.name
        },
        can_manage_bots: bot.can_manage_bots,
    };
    if let Err(error) = store_connected_bot_for_owner(
        manager.owner_id.clone(),
        bot_token,
        bot,
        Some(creator_user_id),
    ) {
        record_manager_error(manager_id, None, &error, false)?;
        return Err(error);
    }
    finalize_managed_bot_update(manager_id, update_id, &bot_username)
}

fn start_parameter(text: &str) -> Option<&str> {
    let mut parts = text.split_whitespace();
    let command = parts.next()?;
    if !command
        .split('@')
        .next()
        .is_some_and(|value| value.eq_ignore_ascii_case("/start"))
    {
        return None;
    }
    parts.next()
}

fn telegram_display_name(from: &Value) -> Option<String> {
    let first = from
        .get("first_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let last = from
        .get("last_name")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let value = format!("{first} {last}").trim().to_string();
    (!value.is_empty()).then_some(value)
}

fn persist_update_and_extract_action(
    channel_id: &str,
    update: &Value,
) -> Result<Option<TelegramUpdateAction>, String> {
    let update_id = update
        .get("update_id")
        .and_then(Value::as_i64)
        .ok_or_else(|| "Mise à jour Telegram sans identifiant.".to_string())?;
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let connection = store
        .connections
        .iter_mut()
        .find(|connection| connection.id == channel_id && connection.connected())
        .ok_or_else(|| "Canal Telegram déconnecté.".to_string())?;
    connection.next_update_offset = Some(update_id.saturating_add(1));
    connection.updated_at = Utc::now().timestamp();

    let mut action = None;
    if let Some(message) = update.get("message") {
        let chat = message.get("chat");
        let from = message.get("from");
        let private_chat = chat
            .and_then(|chat| chat.get("type"))
            .and_then(Value::as_str)
            == Some("private");
        let sender_is_bot = from
            .and_then(|from| from.get("is_bot"))
            .and_then(Value::as_bool)
            == Some(true);
        let chat_id = chat.and_then(|chat| chat.get("id")).and_then(Value::as_i64);
        let user_id = from.and_then(|from| from.get("id")).and_then(Value::as_i64);
        let message_id = message.get("message_id").and_then(Value::as_i64);
        let text = message
            .get("text")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if private_chat && !sender_is_bot {
            if let (Some(chat_id), Some(user_id), Some(message_id), Some(text)) =
                (chat_id, user_id, message_id, text)
            {
                if !connection.paired() {
                    if let Some(provided) = start_parameter(text) {
                        let valid = connection.pairing_code.as_deref().is_some_and(|expected| {
                            crate::security::constant_time_eq(
                                expected.as_bytes(),
                                provided.as_bytes(),
                            )
                        }) && connection
                            .pairing_expires_at
                            .is_some_and(|expiry| expiry > Utc::now().timestamp())
                            && connection
                                .required_pairing_user_id
                                .map_or(true, |expected_user_id| expected_user_id == user_id);
                        if valid {
                            connection.chat_id = Some(chat_id);
                            connection.telegram_user_id = Some(user_id);
                            connection.telegram_username = from
                                .and_then(|from| from.get("username"))
                                .and_then(Value::as_str)
                                .map(str::to_string);
                            connection.telegram_display_name = from.and_then(telegram_display_name);
                            connection.pairing_code = None;
                            connection.pairing_expires_at = None;
                            connection.paired_at = Some(Utc::now().timestamp());
                            action = Some(TelegramUpdateAction::Paired {
                                channel_id: connection.id.clone(),
                                chat_id,
                                bot_username: connection.bot_username.clone().unwrap_or_default(),
                            });
                        } else {
                            action = Some(TelegramUpdateAction::InvalidPairing {
                                channel_id: connection.id.clone(),
                                chat_id,
                            });
                        }
                    }
                } else if connection.chat_id == Some(chat_id)
                    && connection.telegram_user_id == Some(user_id)
                    && !connection.recent_inbound_message_ids.contains(&message_id)
                {
                    connection.recent_inbound_message_ids.push(message_id);
                    if connection.recent_inbound_message_ids.len() > MAX_RECENT_INBOUND_MESSAGES {
                        let excess = connection.recent_inbound_message_ids.len()
                            - MAX_RECENT_INBOUND_MESSAGES;
                        connection.recent_inbound_message_ids.drain(0..excess);
                    }
                    action = Some(TelegramUpdateAction::Inbound(TelegramInboundMessage {
                        channel_id: connection.id.clone(),
                        message_id,
                        content: truncate_message(text, MAX_MESSAGE_CHARS),
                        reply_to_message_id: message
                            .pointer("/reply_to_message/message_id")
                            .and_then(Value::as_i64),
                    }));
                }
            }
        }
    }
    persist_store(&store)?;
    Ok(action)
}

async fn send_to_chat(
    channel_id: &str,
    chat_id: i64,
    content: &str,
) -> Result<TelegramSendResult, String> {
    let mut connection = connection_for_channel(channel_id)?;
    connection.chat_id = Some(chat_id);
    send_text_with_connection(&connection, content).await
}

fn handle_update_action(
    runtime: &tokio::runtime::Runtime,
    manager: &AutonomousAgentManager,
    action: TelegramUpdateAction,
) {
    match action {
        TelegramUpdateAction::Paired {
            channel_id,
            chat_id,
            bot_username,
        } => {
            let message = format!(
                "Compte appairé avec @{bot_username}. Active Telegram dans un agent, puis réponds à ses rapports ou utilise /agents."
            );
            if let Err(error) = runtime.block_on(send_to_chat(&channel_id, chat_id, &message)) {
                eprintln!("[telegram] confirmation d’appairage non envoyée : {error}");
            }
        }
        TelegramUpdateAction::InvalidPairing {
            channel_id,
            chat_id,
        } => {
            if let Err(error) = runtime.block_on(send_to_chat(
                &channel_id,
                chat_id,
                "Lien d’appairage invalide ou expiré. Génère un nouveau lien dans Codex Switch Terminal.",
            )) {
                eprintln!("[telegram] refus d’appairage non envoyé : {error}");
            }
        }
        TelegramUpdateAction::Inbound(message) => {
            let reply_target = message
                .reply_to_message_id
                .and_then(|message_id| {
                    agent_target_for_outbound_message(&message.channel_id, message_id)
                        .ok()
                        .flatten()
                });
            let dispatch = manager.receive_telegram_message(
                &message.channel_id,
                reply_target.as_deref(),
                &message.content,
            );
            let (reply, agent_target) = match dispatch {
                Ok(value) => value,
                Err(error) => {
                    eprintln!(
                        "[telegram] message entrant {} non transmis : {error}",
                        message.message_id
                    );
                    (
                        "Je n’ai pas pu transmettre ce message à l’agent. Vérifie son état dans Codex Switch Terminal."
                            .to_string(),
                        None,
                    )
                }
            };
            match runtime.block_on(async {
                let connection = connection_for_channel(&message.channel_id)?;
                send_text_with_connection(&connection, &reply).await
            }) {
                Ok(sent) => {
                    if let Some((agent_id, agent_name)) = agent_target {
                        if let Err(error) = record_outbound_agent_message(
                            &message.channel_id,
                            sent.message_id,
                            agent_id,
                            agent_name,
                        ) {
                            eprintln!("[telegram] continuité de conversation non persistée : {error}");
                        }
                    }
                }
                Err(error) => eprintln!("[telegram] réponse non envoyée : {error}"),
            }
        }
    }
}

fn poller_registry() -> &'static Mutex<HashSet<String>> {
    ACTIVE_POLLERS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn ensure_poller(channel_id: &str) {
    if POLLING_MANAGER.get().is_none() {
        return;
    }
    let channel_id = channel_id.to_string();
    let inserted = poller_registry()
        .lock()
        .map(|mut registry| registry.insert(channel_id.clone()))
        .unwrap_or(false);
    if !inserted {
        return;
    }
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("[telegram] runtime de polling indisponible : {error}");
                if let Ok(mut registry) = poller_registry().lock() {
                    registry.remove(&channel_id);
                }
                return;
            }
        };
        loop {
            let connection = match connection_for_channel(&channel_id) {
                Ok(connection) if connection.connected() => connection,
                _ => break,
            };
            match runtime.block_on(fetch_updates(&connection)) {
                Ok(updates) => {
                    let Some(manager) = POLLING_MANAGER.get() else {
                        break;
                    };
                    for update in updates {
                        match persist_update_and_extract_action(&channel_id, &update) {
                            Ok(Some(action)) => handle_update_action(&runtime, manager, action),
                            Ok(None) => {}
                            Err(error) => {
                                eprintln!("[telegram] mise à jour non persistée : {error}")
                            }
                        }
                    }
                }
                Err(error) => {
                    eprintln!("[telegram] polling interrompu : {error}");
                    thread::sleep(Duration::from_secs(3));
                }
            }
        }
        if let Ok(mut registry) = poller_registry().lock() {
            registry.remove(&channel_id);
        }
        if connection_for_channel(&channel_id).is_ok() {
            ensure_poller(&channel_id);
        }
    });
}

fn manager_poller_registry() -> &'static Mutex<HashSet<String>> {
    ACTIVE_MANAGER_POLLERS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn ensure_manager_poller(manager_id: &str) {
    let manager_id = manager_id.to_string();
    let inserted = manager_poller_registry()
        .lock()
        .map(|mut registry| registry.insert(manager_id.clone()))
        .unwrap_or(false);
    if !inserted {
        return;
    }
    thread::spawn(move || {
        let runtime = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("[telegram-manager] runtime de polling indisponible : {error}");
                if let Ok(mut registry) = manager_poller_registry().lock() {
                    registry.remove(&manager_id);
                }
                return;
            }
        };
        loop {
            let manager = match manager_for_id(&manager_id) {
                Ok(manager) if manager.connected() => manager,
                _ => break,
            };
            match runtime.block_on(fetch_manager_updates(&manager)) {
                Ok(updates) => {
                    let mut failed = false;
                    for update in updates {
                        if let Err(error) =
                            runtime.block_on(process_manager_update(&manager_id, &update))
                        {
                            eprintln!("[telegram-manager] mise à jour non traitée : {error}");
                            failed = true;
                            break;
                        }
                    }
                    if failed {
                        thread::sleep(Duration::from_secs(3));
                    }
                }
                Err(error) => {
                    eprintln!("[telegram-manager] polling interrompu : {error}");
                    thread::sleep(Duration::from_secs(3));
                }
            }
        }
        if let Ok(mut registry) = manager_poller_registry().lock() {
            registry.remove(&manager_id);
        }
        if manager_for_id(&manager_id).is_ok() {
            ensure_manager_poller(&manager_id);
        }
    });
}

pub(crate) fn start_polling(manager: AutonomousAgentManager) {
    let _ = POLLING_MANAGER.set(manager);
    let (channels, managers) = {
        let Ok(_guard) = lock_store() else {
            return;
        };
        let Ok(store) = load_store() else {
            return;
        };
        (
            store
                .connections
                .iter()
                .filter(|connection| connection.connected())
                .map(|connection| connection.id.clone())
                .collect::<Vec<_>>(),
            store
                .managers
                .iter()
                .filter(|manager| manager.connected())
                .map(|manager| manager.id.clone())
                .collect::<Vec<_>>(),
        )
    };
    for channel_id in channels {
        ensure_poller(&channel_id);
    }
    for manager_id in managers {
        ensure_manager_poller(&manager_id);
    }
}

fn notification_sender() -> &'static mpsc::SyncSender<TelegramNotificationJob> {
    NOTIFICATION_SENDER.get_or_init(|| {
        let (sender, receiver) =
            mpsc::sync_channel::<TelegramNotificationJob>(NOTIFICATION_QUEUE_CAPACITY);
        thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("[telegram] runtime de notification indisponible : {error}");
                    return;
                }
            };
            while let Ok(job) = receiver.recv() {
                let result = connection_for_channel(&job.channel_id).and_then(|connection| {
                    if !connection.paired() {
                        return Err("Compte Telegram non appairé.".to_string());
                    }
                    let content = format!(
                        "Agent autonome — {}\n\n{}\n\nRéponds à ce message pour parler à cet agent.",
                        job.agent_name, job.content
                    );
                    runtime.block_on(send_text_with_connection(&connection, &content))
                });
                match result {
                    Ok(sent) => {
                        if let Err(error) = record_outbound_agent_message(
                            &job.channel_id,
                            sent.message_id,
                            job.agent_id,
                            job.agent_name,
                        ) {
                            eprintln!("[telegram] routage de réponse non persisté : {error}");
                        }
                    }
                    Err(error) => eprintln!("[telegram] notification non envoyée : {error}"),
                }
            }
        });
        sender
    })
}

pub(crate) fn enqueue_agent_notification(
    channel_id: String,
    agent_id: String,
    agent_name: String,
    content: String,
) {
    let job = TelegramNotificationJob {
        channel_id,
        agent_id,
        agent_name: truncate_message(&agent_name, 120),
        content: truncate_message(&content, MAX_MESSAGE_CHARS),
    };
    if let Err(error) = notification_sender().try_send(job) {
        eprintln!("[telegram] file de notifications saturée : {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stored_connection() -> StoredTelegramConnection {
        StoredTelegramConnection {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            owner_id: "owner-a".to_string(),
            bot_token: Some("123456789:abcdefghijklmnopqrstuvwxyz_ABCDE".to_string()),
            bot_id: Some(123456789),
            bot_username: Some("switch_agent_bot".to_string()),
            bot_name: Some("Switch Agent".to_string()),
            chat_id: None,
            telegram_user_id: None,
            telegram_username: None,
            telegram_display_name: None,
            required_pairing_user_id: None,
            pairing_code: Some("pairing-code".to_string()),
            pairing_expires_at: Some(Utc::now().timestamp() + 60),
            next_update_offset: None,
            recent_inbound_message_ids: Vec::new(),
            outbound_agent_messages: Vec::new(),
            created_at: 1,
            connected_at: Some(2),
            paired_at: None,
            updated_at: 2,
        }
    }

    fn stored_manager() -> StoredTelegramManager {
        StoredTelegramManager {
            id: "22222222-2222-4222-8222-222222222222".to_string(),
            owner_id: "owner-a".to_string(),
            bot_token: Some("987654321:abcdefghijklmnopqrstuvwxyz_ABCDE".to_string()),
            bot_id: Some(987654321),
            bot_username: Some("SwitchManagerBot".to_string()),
            bot_name: Some("Switch Manager".to_string()),
            next_update_offset: Some(12),
            pending_bot_username: Some("OwnerAgentBot".to_string()),
            pending_bot_name: Some("Owner Agent".to_string()),
            pending_created_at: Some(Utc::now().timestamp()),
            last_created_bot_username: None,
            last_created_at: None,
            last_error: None,
            created_at: 1,
            connected_at: Some(2),
            updated_at: 2,
        }
    }

    #[test]
    fn validates_botfather_tokens() {
        assert!(validate_bot_token("123456789:abcdefghijklmnopqrstuvwxyz_ABCDE").is_ok());
        assert!(validate_bot_token("invalid").is_err());
        assert!(validate_bot_token("abc:abcdefghijklmnopqrstuvwxyz_ABCDE").is_err());
    }

    #[test]
    fn public_view_never_exposes_token_or_chat_id() {
        let view = connection_view(Some(&stored_connection()));
        let serialized = serde_json::to_string(&view).unwrap();
        assert!(!serialized.contains("abcdefghijklmnopqrstuvwxyz_ABCDE"));
        assert!(!serialized.contains("chatId"));
        assert!(serialized.contains("switch_agent_bot"));
        assert!(view.pairing_url.is_some());
    }

    #[test]
    fn validates_managed_bot_identity_and_encodes_creation_link() {
        assert_eq!(
            validate_managed_bot_username("@Owner_AgentBot").unwrap(),
            "Owner_AgentBot"
        );
        assert!(validate_managed_bot_username("agent").is_err());
        assert!(validate_managed_bot_username("bad-agent-bot").is_err());
        assert!(validate_managed_bot_name("").is_err());
        let url =
            managed_bot_creation_url("SwitchManagerBot", "OwnerAgentBot", "Mon agent").unwrap();
        assert_eq!(
            url,
            "https://t.me/newbot/SwitchManagerBot/OwnerAgentBot?name=Mon+agent"
        );
    }

    #[test]
    fn manager_public_view_never_exposes_credentials_or_ids() {
        let view = manager_view(Some(&stored_manager()));
        let serialized = serde_json::to_string(&view).unwrap();
        assert!(view.connected);
        assert!(view.management_enabled);
        assert!(view.creation_url.is_some());
        assert!(!serialized.contains("abcdefghijklmnopqrstuvwxyz_ABCDE"));
        assert!(!serialized.contains("987654321"));
        assert!(!serialized.contains("nextUpdateOffset"));
    }

    #[test]
    fn start_parameter_accepts_private_deep_links() {
        assert_eq!(start_parameter("/start abc_123"), Some("abc_123"));
        assert_eq!(
            start_parameter("/start@switch_agent_bot abc_123"),
            Some("abc_123")
        );
        assert_eq!(start_parameter("bonjour"), None);
    }

    #[test]
    fn disconnect_keeps_stable_channel_id() {
        let mut connection = stored_connection();
        let id = connection.id.clone();
        connection.clear_credentials(10);
        assert_eq!(connection.id, id);
        assert!(!connection.connected());
        assert!(connection.bot_token.is_none());
    }
}
