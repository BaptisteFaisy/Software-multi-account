use chrono::Utc;
use hmac::{Hmac, Mac};
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use std::{
    fs,
    io::ErrorKind,
    path::Path,
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use uuid::Uuid;

pub const DESKTOP_WHATSAPP_OWNER: &str = "desktop";
pub(crate) const WHATSAPP_WEBHOOK_PATH: &str = "/api/notifications/whatsapp/webhook";
pub(crate) const MAX_WHATSAPP_WEBHOOK_BYTES: usize = 256 * 1024;
const WHATSAPP_CONNECTIONS_FILE: &str = "whatsapp-connections.json";
const GRAPH_API_BASE_URL: &str = "https://graph.facebook.com";
const GRAPH_API_VERSION: &str = "v25.0";
const META_WHATSAPP_DASHBOARD_URL: &str = "https://developers.facebook.com/apps/";
const MAX_ACCESS_TOKEN_CHARS: usize = 4_096;
const MAX_APP_SECRET_CHARS: usize = 512;
const MAX_PHONE_NUMBER_ID_CHARS: usize = 32;
const MAX_WEBHOOK_VERIFY_TOKEN_CHARS: usize = 256;
const MAX_TEMPLATE_NAME_CHARS: usize = 512;
const MAX_TEMPLATE_LANGUAGE_CHARS: usize = 16;
const MAX_NOTIFICATION_TEXT_CHARS: usize = 3_500;
const MAX_TEMPLATE_PARAMETER_CHARS: usize = 1_000;
const NOTIFICATION_QUEUE_CAPACITY: usize = 128;
const MAX_RECENT_INBOUND_MESSAGES: usize = 256;
const MAX_RECENT_OUTBOUND_AGENT_MESSAGES: usize = 256;

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static NOTIFICATION_SENDER: OnceLock<mpsc::SyncSender<WhatsAppNotificationJob>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppConnectionView {
    pub connected: bool,
    pub channel_id: Option<String>,
    pub phone_number_id: Option<String>,
    pub display_phone_number: Option<String>,
    pub verified_name: Option<String>,
    pub quality_rating: Option<String>,
    pub recipient_hint: Option<String>,
    pub conversation_enabled: bool,
    pub webhook_callback_url: Option<String>,
    pub webhook_verify_token: Option<String>,
    pub template_name: Option<String>,
    pub template_language: Option<String>,
    pub delivery_mode: String,
    pub graph_api_version: String,
    pub connected_at: Option<i64>,
    pub dashboard_url: String,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectWhatsAppRequest {
    pub access_token: String,
    pub app_secret: String,
    pub phone_number_id: String,
    pub recipient_phone_number: String,
    #[serde(default)]
    pub template_name: Option<String>,
    #[serde(default)]
    pub template_language: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WhatsAppSendResult {
    pub message_id: String,
    pub sent_at: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredWhatsAppConnection {
    id: String,
    owner_id: String,
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    app_secret: Option<String>,
    #[serde(default)]
    phone_number_id: Option<String>,
    #[serde(default)]
    recipient_phone_number: Option<String>,
    #[serde(default)]
    display_phone_number: Option<String>,
    #[serde(default)]
    verified_name: Option<String>,
    #[serde(default)]
    quality_rating: Option<String>,
    #[serde(default)]
    template_name: Option<String>,
    #[serde(default)]
    template_language: Option<String>,
    #[serde(default)]
    webhook_verify_token: Option<String>,
    #[serde(default)]
    recent_inbound_message_ids: Vec<String>,
    #[serde(default)]
    outbound_agent_messages: Vec<StoredOutboundAgentMessage>,
    created_at: i64,
    #[serde(default)]
    connected_at: Option<i64>,
    updated_at: i64,
}

impl StoredWhatsAppConnection {
    fn is_connected(&self) -> bool {
        self.access_token
            .as_deref()
            .is_some_and(|value| !value.is_empty())
            && self
                .phone_number_id
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            && self
                .recipient_phone_number
                .as_deref()
                .is_some_and(|value| !value.is_empty())
    }

    fn clear_credentials(&mut self, now: i64) {
        self.access_token = None;
        self.app_secret = None;
        self.phone_number_id = None;
        self.recipient_phone_number = None;
        self.display_phone_number = None;
        self.verified_name = None;
        self.quality_rating = None;
        self.template_name = None;
        self.template_language = None;
        self.connected_at = None;
        self.updated_at = now;
    }

    fn conversation_enabled(&self) -> bool {
        self.is_connected()
            && self
                .app_secret
                .as_deref()
                .is_some_and(|value| !value.is_empty())
            && self
                .webhook_verify_token
                .as_deref()
                .is_some_and(|value| !value.is_empty())
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredOutboundAgentMessage {
    message_id: String,
    agent_id: String,
    agent_name: String,
    sent_at: i64,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WhatsAppConnectionStore {
    #[serde(default = "store_version")]
    version: u8,
    #[serde(default)]
    connections: Vec<StoredWhatsAppConnection>,
}

#[derive(Debug, Clone)]
struct MetaPhoneView {
    display_phone_number: Option<String>,
    verified_name: Option<String>,
    quality_rating: Option<String>,
}

#[derive(Debug)]
struct WhatsAppNotificationJob {
    channel_id: String,
    agent_id: String,
    agent_name: String,
    content: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WhatsAppInboundMessage {
    pub channel_id: String,
    pub message_id: String,
    pub content: String,
    pub reply_to_message_id: Option<String>,
}

#[derive(Debug)]
pub(crate) enum WhatsAppWebhookError {
    Unauthorized(String),
    Invalid(String),
    Internal(String),
}

impl WhatsAppWebhookError {
    pub(crate) fn message(&self) -> &str {
        match self {
            Self::Unauthorized(message) | Self::Invalid(message) | Self::Internal(message) => {
                message
            }
        }
    }

    pub(crate) fn is_unauthorized(&self) -> bool {
        matches!(self, Self::Unauthorized(_))
    }

    pub(crate) fn is_internal(&self) -> bool {
        matches!(self, Self::Internal(_))
    }
}

fn store_version() -> u8 {
    2
}

fn graph_api_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(candidate) = std::env::var("CST_TEST_WHATSAPP_API_BASE_URL") {
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
    GRAPH_API_BASE_URL.to_string()
}

fn connections_path() -> Result<std::path::PathBuf, String> {
    crate::settings::runtime_data_path(WHATSAPP_CONNECTIONS_FILE)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Verrou de la connexion WhatsApp indisponible.".to_string())
}

fn load_store_from(path: &Path) -> Result<WhatsAppConnectionStore, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(WhatsAppConnectionStore {
                version: store_version(),
                ..WhatsAppConnectionStore::default()
            })
        }
        Err(error) => {
            return Err(format!(
                "Lecture de la connexion WhatsApp impossible : {error}"
            ))
        }
    };
    let mut store = serde_json::from_str::<WhatsAppConnectionStore>(&content)
        .map_err(|error| format!("Fichier de connexion WhatsApp invalide : {error}"))?;
    store.version = store_version();
    Ok(store)
}

fn load_store() -> Result<WhatsAppConnectionStore, String> {
    load_store_from(&connections_path()?)
}

fn persist_store_to(path: &Path, store: &WhatsAppConnectionStore) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Sérialisation de la connexion WhatsApp impossible : {error}"))?;
    crate::fs_util::atomic_write(path, content)
        .map_err(|error| format!("Écriture de la connexion WhatsApp impossible : {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!("Protection du fichier de connexion WhatsApp impossible : {error}")
        })?;
    }
    Ok(())
}

fn persist_store(store: &WhatsAppConnectionStore) -> Result<(), String> {
    persist_store_to(&connections_path()?, store)
}

fn validate_owner_id(owner_id: &str) -> Result<&str, String> {
    let owner_id = owner_id.trim();
    if owner_id.is_empty() || owner_id.len() > 256 || owner_id.chars().any(char::is_control) {
        return Err("Propriétaire de la connexion WhatsApp invalide.".to_string());
    }
    Ok(owner_id)
}

fn validate_access_token(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_ACCESS_TOKEN_CHARS
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("Jeton d’accès Meta invalide.".to_string());
    }
    Ok(value.to_string())
}

fn validate_app_secret(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_APP_SECRET_CHARS
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("Secret de l’application Meta invalide.".to_string());
    }
    Ok(value.to_string())
}

fn validate_phone_number_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > MAX_PHONE_NUMBER_ID_CHARS
        || !value.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(
            "L’identifiant du numéro WhatsApp doit contenir uniquement des chiffres.".to_string(),
        );
    }
    Ok(value.to_string())
}

fn normalize_recipient_phone_number(value: &str) -> Result<String, String> {
    let normalized = value
        .trim()
        .chars()
        .filter(|character| !matches!(character, '+' | ' ' | '-' | '(' | ')' | '.'))
        .collect::<String>();
    if normalized.starts_with('0') {
        return Err(
            "Ajoute l’indicatif international au numéro destinataire, par exemple +33 au lieu du 0 initial."
                .to_string(),
        );
    }
    if !(8..=15).contains(&normalized.len())
        || !normalized.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(
            "Le numéro destinataire doit être au format international, par exemple +33612345678."
                .to_string(),
        );
    }
    Ok(normalized)
}

fn validate_template_name(value: Option<String>) -> Result<Option<String>, String> {
    let Some(value) = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    else {
        return Ok(None);
    };
    if value.len() > MAX_TEMPLATE_NAME_CHARS
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(
            "Le nom du modèle WhatsApp accepte uniquement les minuscules, chiffres et underscores."
                .to_string(),
        );
    }
    Ok(Some(value))
}

fn validate_template_language(
    value: Option<String>,
    template_name: Option<&str>,
) -> Result<Option<String>, String> {
    if template_name.is_none() {
        return Ok(None);
    }
    let value = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "fr".to_string());
    let valid = value.len() <= MAX_TEMPLATE_LANGUAGE_CHARS
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
        && value
            .chars()
            .next()
            .is_some_and(|character| character.is_ascii_alphabetic());
    if !valid {
        return Err("Code de langue du modèle WhatsApp invalide.".to_string());
    }
    Ok(Some(value))
}

fn validate_channel_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    Uuid::parse_str(value)
        .map(|_| value.to_string())
        .map_err(|_| "Canal de notification WhatsApp invalide.".to_string())
}

fn recipient_hint(value: &str) -> String {
    let suffix = value.chars().rev().take(4).collect::<Vec<_>>();
    format!("+••••••{}", suffix.into_iter().rev().collect::<String>())
}

fn new_webhook_verify_token() -> String {
    format!("cst_{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn disconnected_view() -> WhatsAppConnectionView {
    WhatsAppConnectionView {
        connected: false,
        channel_id: None,
        phone_number_id: None,
        display_phone_number: None,
        verified_name: None,
        quality_rating: None,
        recipient_hint: None,
        conversation_enabled: false,
        webhook_callback_url: None,
        webhook_verify_token: None,
        template_name: None,
        template_language: None,
        delivery_mode: "disabled".to_string(),
        graph_api_version: GRAPH_API_VERSION.to_string(),
        connected_at: None,
        dashboard_url: META_WHATSAPP_DASHBOARD_URL.to_string(),
        note: "Connecte un numéro WhatsApp Business Cloud API. Les comptes WhatsApp personnels ne sont pas pris en charge."
            .to_string(),
    }
}

fn connection_view(connection: Option<&StoredWhatsAppConnection>) -> WhatsAppConnectionView {
    let Some(connection) = connection.filter(|connection| connection.is_connected()) else {
        return disconnected_view();
    };
    let template_name = connection.template_name.clone();
    WhatsAppConnectionView {
        connected: true,
        channel_id: Some(connection.id.clone()),
        phone_number_id: connection.phone_number_id.clone(),
        display_phone_number: connection.display_phone_number.clone(),
        verified_name: connection.verified_name.clone(),
        quality_rating: connection.quality_rating.clone(),
        recipient_hint: connection
            .recipient_phone_number
            .as_deref()
            .map(recipient_hint),
        conversation_enabled: connection.conversation_enabled(),
        webhook_callback_url: None,
        webhook_verify_token: connection
            .conversation_enabled()
            .then(|| connection.webhook_verify_token.clone())
            .flatten(),
        template_language: connection.template_language.clone(),
        delivery_mode: if template_name.is_some() {
            "template".to_string()
        } else {
            "session_text".to_string()
        },
        template_name,
        graph_api_version: GRAPH_API_VERSION.to_string(),
        connected_at: connection.connected_at,
        dashboard_url: META_WHATSAPP_DASHBOARD_URL.to_string(),
        note: if !connection.conversation_enabled() {
            "Reconfigure la liaison avec le secret de l’application Meta pour recevoir tes messages WhatsApp."
                .to_string()
        } else if connection.template_name.is_some() {
            "Les notifications utilisent le modèle approuvé configuré avec le compte rendu dans {{1}}."
                .to_string()
        } else {
            "Sans modèle approuvé, Meta autorise le texte libre uniquement dans la fenêtre de conversation de 24 heures."
                .to_string()
        },
    }
}

pub(crate) fn with_webhook_callback_url(
    mut view: WhatsAppConnectionView,
    public_base_url: &str,
) -> WhatsAppConnectionView {
    if view.conversation_enabled {
        let base = public_base_url.trim().trim_end_matches('/');
        if !base.is_empty() {
            view.webhook_callback_url = Some(format!("{base}{WHATSAPP_WEBHOOK_PATH}"));
        }
    }
    view
}

pub(crate) fn whatsapp_connection_for_owner(
    owner_id: &str,
) -> Result<WhatsAppConnectionView, String> {
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
pub fn whatsapp_connection() -> Result<WhatsAppConnectionView, String> {
    whatsapp_connection_for_owner(DESKTOP_WHATSAPP_OWNER)
}

async fn graph_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client WhatsApp indisponible : {error}"))
}

fn graph_error_detail(text: &str, status: reqwest::StatusCode, access_token: &str) -> String {
    let parsed = serde_json::from_str::<Value>(text).ok();
    let message = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/message").and_then(Value::as_str))
        .or_else(|| {
            parsed
                .as_ref()
                .and_then(|value| value.get("message").and_then(Value::as_str))
        })
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()));
    let code = parsed
        .as_ref()
        .and_then(|value| value.pointer("/error/code").and_then(Value::as_i64));
    let detail = match code {
        Some(code) => format!("{message} (Meta {code})"),
        None => message,
    };
    detail.replace(access_token, "***")
}

async fn validate_phone_remotely(
    access_token: &str,
    phone_number_id: &str,
) -> Result<MetaPhoneView, String> {
    let response = graph_client()
        .await?
        .get(format!(
            "{}/{}/{}",
            graph_api_base_url(),
            GRAPH_API_VERSION,
            phone_number_id
        ))
        .query(&[(
            "fields",
            "id,display_phone_number,verified_name,quality_rating",
        )])
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| format!("Validation WhatsApp impossible : {}", error.without_url()))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Connexion WhatsApp refusée : {}",
            graph_error_detail(&text, status, access_token)
        ));
    }
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|_| "Réponse Meta invalide pendant la validation WhatsApp.".to_string())?;
    if value.get("id").and_then(Value::as_str) != Some(phone_number_id) {
        return Err("Meta n’a pas confirmé l’identifiant du numéro WhatsApp.".to_string());
    }
    Ok(MetaPhoneView {
        display_phone_number: value
            .get("display_phone_number")
            .and_then(Value::as_str)
            .map(str::to_string),
        verified_name: value
            .get("verified_name")
            .and_then(Value::as_str)
            .map(str::to_string),
        quality_rating: value
            .get("quality_rating")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

pub(crate) async fn connect_whatsapp_for_owner(
    owner_id: &str,
    request: ConnectWhatsAppRequest,
) -> Result<WhatsAppConnectionView, String> {
    let owner_id = validate_owner_id(owner_id)?.to_string();
    let access_token = validate_access_token(&request.access_token)?;
    let app_secret = validate_app_secret(&request.app_secret)?;
    let phone_number_id = validate_phone_number_id(&request.phone_number_id)?;
    let recipient_phone_number = normalize_recipient_phone_number(&request.recipient_phone_number)?;
    let template_name = validate_template_name(request.template_name)?;
    let template_language =
        validate_template_language(request.template_language, template_name.as_deref())?;
    let phone = validate_phone_remotely(&access_token, &phone_number_id).await?;
    let now = Utc::now().timestamp();

    let _guard = lock_store()?;
    let mut store = load_store()?;
    let index = store
        .connections
        .iter()
        .position(|connection| connection.owner_id == owner_id);
    let connection = match index {
        Some(index) => {
            let connection = &mut store.connections[index];
            connection.access_token = Some(access_token);
            connection.app_secret = Some(app_secret);
            connection.phone_number_id = Some(phone_number_id);
            connection.recipient_phone_number = Some(recipient_phone_number);
            connection.display_phone_number = phone.display_phone_number;
            connection.verified_name = phone.verified_name;
            connection.quality_rating = phone.quality_rating;
            connection.template_name = template_name;
            connection.template_language = template_language;
            if connection.webhook_verify_token.is_none() {
                connection.webhook_verify_token = Some(new_webhook_verify_token());
            }
            connection.connected_at = Some(now);
            connection.updated_at = now;
            connection.clone()
        }
        None => {
            let connection = StoredWhatsAppConnection {
                id: Uuid::new_v4().to_string(),
                owner_id,
                access_token: Some(access_token),
                app_secret: Some(app_secret),
                phone_number_id: Some(phone_number_id),
                recipient_phone_number: Some(recipient_phone_number),
                display_phone_number: phone.display_phone_number,
                verified_name: phone.verified_name,
                quality_rating: phone.quality_rating,
                template_name,
                template_language,
                webhook_verify_token: Some(new_webhook_verify_token()),
                recent_inbound_message_ids: Vec::new(),
                outbound_agent_messages: Vec::new(),
                created_at: now,
                connected_at: Some(now),
                updated_at: now,
            };
            store.connections.push(connection.clone());
            connection
        }
    };
    persist_store(&store)?;
    Ok(connection_view(Some(&connection)))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn connect_whatsapp(
    request: ConnectWhatsAppRequest,
) -> Result<WhatsAppConnectionView, String> {
    connect_whatsapp_for_owner(DESKTOP_WHATSAPP_OWNER, request).await
}

pub(crate) fn disconnect_whatsapp_for_owner(
    owner_id: &str,
) -> Result<WhatsAppConnectionView, String> {
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
pub fn disconnect_whatsapp() -> Result<WhatsAppConnectionView, String> {
    disconnect_whatsapp_for_owner(DESKTOP_WHATSAPP_OWNER)
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
    let valid = store.connections.iter().any(|connection| {
        connection.id == channel_id && connection.owner_id == owner_id && connection.is_connected()
    });
    if !valid {
        return Err(
            "Le canal WhatsApp n’est pas connecté pour cet utilisateur. Reconnecte-le dans les paramètres."
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
        .any(|connection| connection.id == channel_id && connection.is_connected())
    {
        return Err(
            "Le canal WhatsApp n’est plus connecté. Reconnecte-le dans les paramètres.".to_string(),
        );
    }
    Ok(Some(channel_id))
}

fn connection_for_channel(channel_id: &str) -> Result<StoredWhatsAppConnection, String> {
    let channel_id = validate_channel_id(channel_id)?;
    let _guard = lock_store()?;
    let store = load_store()?;
    store
        .connections
        .into_iter()
        .find(|connection| connection.id == channel_id && connection.is_connected())
        .ok_or_else(|| {
            "Le canal WhatsApp de cet agent n’est plus connecté. Reconnecte-le dans les paramètres."
                .to_string()
        })
}

pub(crate) fn verify_webhook_challenge(
    mode: &str,
    verify_token: &str,
    challenge: &str,
) -> Result<String, WhatsAppWebhookError> {
    if mode.trim() != "subscribe" {
        return Err(WhatsAppWebhookError::Invalid(
            "Mode de vérification webhook Meta invalide.".to_string(),
        ));
    }
    let challenge = challenge.trim();
    if challenge.is_empty()
        || challenge.len() > 1_024
        || !challenge.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(WhatsAppWebhookError::Invalid(
            "Challenge webhook Meta invalide.".to_string(),
        ));
    }
    let verify_token = verify_token.trim();
    if verify_token.is_empty() || verify_token.len() > MAX_WEBHOOK_VERIFY_TOKEN_CHARS {
        return Err(WhatsAppWebhookError::Unauthorized(
            "Jeton de vérification webhook refusé.".to_string(),
        ));
    }
    let _guard = lock_store().map_err(WhatsAppWebhookError::Internal)?;
    let store = load_store().map_err(WhatsAppWebhookError::Internal)?;
    let authorized = store.connections.iter().any(|connection| {
        connection.conversation_enabled()
            && connection
                .webhook_verify_token
                .as_deref()
                .is_some_and(|expected| {
                    crate::security::constant_time_eq(expected.as_bytes(), verify_token.as_bytes())
                })
    });
    if !authorized {
        return Err(WhatsAppWebhookError::Unauthorized(
            "Jeton de vérification webhook refusé.".to_string(),
        ));
    }
    Ok(challenge.to_string())
}

fn decode_sha256_signature(value: &str) -> Option<[u8; 32]> {
    let value = value.trim().strip_prefix("sha256=")?;
    if value.len() != 64 {
        return None;
    }
    let mut decoded = [0_u8; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let high = (pair[0] as char).to_digit(16)? as u8;
        let low = (pair[1] as char).to_digit(16)? as u8;
        decoded[index] = (high << 4) | low;
    }
    Some(decoded)
}

fn webhook_signature_matches(app_secret: &str, signature: &str, body: &[u8]) -> bool {
    let Some(signature) = decode_sha256_signature(signature) else {
        return false;
    };
    let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(app_secret.as_bytes()) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&signature).is_ok()
}

fn inbound_message_content(message: &Value) -> Option<String> {
    let message_type = message.get("type").and_then(Value::as_str)?;
    let content = match message_type {
        "text" => message.pointer("/text/body").and_then(Value::as_str),
        "button" => message.pointer("/button/text").and_then(Value::as_str),
        "interactive" => message
            .pointer("/interactive/button_reply/title")
            .or_else(|| message.pointer("/interactive/list_reply/title"))
            .and_then(Value::as_str),
        _ => None,
    }?;
    let content = truncate_message(content, MAX_NOTIFICATION_TEXT_CHARS);
    (!content.is_empty()).then_some(content)
}

pub(crate) fn verify_and_extract_webhook_messages(
    signature: &str,
    body: &[u8],
) -> Result<Vec<WhatsAppInboundMessage>, WhatsAppWebhookError> {
    let path = connections_path().map_err(WhatsAppWebhookError::Internal)?;
    verify_and_extract_webhook_messages_from(&path, signature, body)
}

fn verify_and_extract_webhook_messages_from(
    path: &Path,
    signature: &str,
    body: &[u8],
) -> Result<Vec<WhatsAppInboundMessage>, WhatsAppWebhookError> {
    let payload = serde_json::from_slice::<Value>(body).map_err(|_| {
        WhatsAppWebhookError::Invalid("Corps du webhook WhatsApp invalide.".to_string())
    })?;
    if payload.get("object").and_then(Value::as_str) != Some("whatsapp_business_account") {
        return Err(WhatsAppWebhookError::Invalid(
            "Type de webhook WhatsApp invalide.".to_string(),
        ));
    }
    let entries = payload
        .get("entry")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            WhatsAppWebhookError::Invalid("Webhook WhatsApp sans entrée.".to_string())
        })?;

    let _guard = lock_store().map_err(WhatsAppWebhookError::Internal)?;
    let mut store = load_store_from(path).map_err(WhatsAppWebhookError::Internal)?;
    let mut inbound = Vec::new();
    let mut changed = false;
    let mut recognized_connection = false;

    for entry in entries {
        let Some(changes) = entry.get("changes").and_then(Value::as_array) else {
            continue;
        };
        for change in changes {
            if change.get("field").and_then(Value::as_str) != Some("messages") {
                continue;
            }
            let Some(value) = change.get("value") else {
                continue;
            };
            let Some(phone_number_id) = value
                .pointer("/metadata/phone_number_id")
                .and_then(Value::as_str)
            else {
                continue;
            };
            let matching_phone = store
                .connections
                .iter()
                .any(|connection| connection.phone_number_id.as_deref() == Some(phone_number_id));
            let Some(connection_index) = store.connections.iter().position(|connection| {
                connection.phone_number_id.as_deref() == Some(phone_number_id)
                    && connection.conversation_enabled()
                    && connection.app_secret.as_deref().is_some_and(|app_secret| {
                        webhook_signature_matches(app_secret, signature, body)
                    })
            }) else {
                if matching_phone {
                    return Err(WhatsAppWebhookError::Unauthorized(
                        "Signature du webhook WhatsApp refusée.".to_string(),
                    ));
                }
                continue;
            };
            recognized_connection = true;
            let connection = &mut store.connections[connection_index];
            let authorized_sender = connection
                .recipient_phone_number
                .as_deref()
                .unwrap_or_default()
                .to_string();
            let Some(messages) = value.get("messages").and_then(Value::as_array) else {
                continue;
            };
            for message in messages {
                let Some(message_id) = message.get("id").and_then(Value::as_str) else {
                    continue;
                };
                if message_id.is_empty() || message_id.len() > 512 {
                    continue;
                }
                let sender = message
                    .get("from")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if sender != authorized_sender || !sender.bytes().all(|byte| byte.is_ascii_digit())
                {
                    continue;
                }
                let Some(content) = inbound_message_content(message) else {
                    continue;
                };
                if connection
                    .recent_inbound_message_ids
                    .iter()
                    .any(|known| known == message_id)
                {
                    continue;
                }
                connection
                    .recent_inbound_message_ids
                    .push(message_id.to_string());
                if connection.recent_inbound_message_ids.len() > MAX_RECENT_INBOUND_MESSAGES {
                    let excess =
                        connection.recent_inbound_message_ids.len() - MAX_RECENT_INBOUND_MESSAGES;
                    connection.recent_inbound_message_ids.drain(0..excess);
                }
                changed = true;
                inbound.push(WhatsAppInboundMessage {
                    channel_id: connection.id.clone(),
                    message_id: message_id.to_string(),
                    content,
                    reply_to_message_id: message
                        .pointer("/context/id")
                        .and_then(Value::as_str)
                        .map(str::to_string),
                });
            }
        }
    }

    if !recognized_connection {
        return Err(WhatsAppWebhookError::Unauthorized(
            "Aucun canal WhatsApp ne correspond à ce webhook.".to_string(),
        ));
    }
    if changed {
        persist_store_to(path, &store).map_err(WhatsAppWebhookError::Internal)?;
    }
    Ok(inbound)
}

pub(crate) fn agent_target_for_outbound_message(
    channel_id: &str,
    message_id: &str,
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

fn record_outbound_agent_message(
    channel_id: &str,
    message_id: String,
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
        .ok_or_else(|| "Canal WhatsApp introuvable.".to_string())?;
    connection
        .outbound_agent_messages
        .push(StoredOutboundAgentMessage {
            message_id,
            agent_id,
            agent_name,
            sent_at: Utc::now().timestamp(),
        });
    if connection.outbound_agent_messages.len() > MAX_RECENT_OUTBOUND_AGENT_MESSAGES {
        let excess = connection.outbound_agent_messages.len() - MAX_RECENT_OUTBOUND_AGENT_MESSAGES;
        connection.outbound_agent_messages.drain(0..excess);
    }
    persist_store(&store)
}

pub(crate) fn record_conversation_reply_target(
    channel_id: &str,
    message_id: String,
    agent_id: String,
    agent_name: String,
) -> Result<(), String> {
    record_outbound_agent_message(channel_id, message_id, agent_id, agent_name)
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

fn message_payload(connection: &StoredWhatsAppConnection, content: &str) -> Value {
    let recipient = connection
        .recipient_phone_number
        .as_deref()
        .unwrap_or_default();
    if let Some(template_name) = connection.template_name.as_deref() {
        return json!({
            "messaging_product": "whatsapp",
            "to": recipient,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {
                    "code": connection.template_language.as_deref().unwrap_or("fr")
                },
                "components": [{
                    "type": "body",
                    "parameters": [{
                        "type": "text",
                        "text": truncate_message(content, MAX_TEMPLATE_PARAMETER_CHARS)
                    }]
                }]
            }
        });
    }
    json!({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": recipient,
        "type": "text",
        "text": {
            "preview_url": false,
            "body": truncate_message(content, MAX_NOTIFICATION_TEXT_CHARS)
        }
    })
}

fn conversation_text_payload(connection: &StoredWhatsAppConnection, content: &str) -> Value {
    json!({
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": connection.recipient_phone_number.as_deref().unwrap_or_default(),
        "type": "text",
        "text": {
            "preview_url": false,
            "body": truncate_message(content, MAX_NOTIFICATION_TEXT_CHARS)
        }
    })
}

async fn send_payload_with_connection(
    connection: &StoredWhatsAppConnection,
    payload: Value,
) -> Result<WhatsAppSendResult, String> {
    let access_token = connection
        .access_token
        .as_deref()
        .ok_or_else(|| "Jeton WhatsApp absent.".to_string())?;
    let phone_number_id = connection
        .phone_number_id
        .as_deref()
        .ok_or_else(|| "Identifiant du numéro WhatsApp absent.".to_string())?;
    let response = graph_client()
        .await?
        .post(format!(
            "{}/{}/{}/messages",
            graph_api_base_url(),
            GRAPH_API_VERSION,
            phone_number_id
        ))
        .bearer_auth(access_token)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("Envoi WhatsApp impossible : {}", error.without_url()))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "Envoi WhatsApp refusé : {}",
            graph_error_detail(&text, status, access_token)
        ));
    }
    let value = serde_json::from_str::<Value>(&text)
        .map_err(|_| "Réponse Meta invalide après l’envoi WhatsApp.".to_string())?;
    let message_id = value
        .pointer("/messages/0/id")
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| "Meta n’a renvoyé aucun identifiant de message WhatsApp.".to_string())?;
    Ok(WhatsAppSendResult {
        message_id,
        sent_at: Utc::now().timestamp(),
    })
}

async fn send_with_connection(
    connection: &StoredWhatsAppConnection,
    content: &str,
) -> Result<WhatsAppSendResult, String> {
    send_payload_with_connection(connection, message_payload(connection, content)).await
}

pub(crate) async fn send_conversation_reply(
    channel_id: &str,
    content: &str,
) -> Result<WhatsAppSendResult, String> {
    let connection = connection_for_channel(channel_id)?;
    if !connection.conversation_enabled() {
        return Err("La conversation WhatsApp n’est pas activée pour ce canal.".to_string());
    }
    send_payload_with_connection(&connection, conversation_text_payload(&connection, content)).await
}

pub(crate) async fn test_whatsapp_for_owner(owner_id: &str) -> Result<WhatsAppSendResult, String> {
    let owner_id = validate_owner_id(owner_id)?;
    let connection = {
        let _guard = lock_store()?;
        let store = load_store()?;
        store
            .connections
            .into_iter()
            .find(|connection| connection.owner_id == owner_id && connection.is_connected())
            .ok_or_else(|| {
                "Aucun compte WhatsApp Business connecté. Ajoute-le dans les paramètres."
                    .to_string()
            })?
    };
    send_with_connection(
        &connection,
        "Test Codex Switch Terminal : les notifications WhatsApp sont opérationnelles.",
    )
    .await
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn test_whatsapp() -> Result<WhatsAppSendResult, String> {
    test_whatsapp_for_owner(DESKTOP_WHATSAPP_OWNER).await
}

fn notification_sender() -> &'static mpsc::SyncSender<WhatsAppNotificationJob> {
    NOTIFICATION_SENDER.get_or_init(|| {
        let (sender, receiver) =
            mpsc::sync_channel::<WhatsAppNotificationJob>(NOTIFICATION_QUEUE_CAPACITY);
        thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("[whatsapp] runtime de notification indisponible : {error}");
                    return;
                }
            };
            while let Ok(job) = receiver.recv() {
                let result = connection_for_channel(&job.channel_id).and_then(|connection| {
                    let content = format!(
                        "Agent autonome — {}\n\n{}\n\nOuvre Codex Switch Terminal pour le détail.",
                        job.agent_name, job.content
                    );
                    runtime.block_on(send_with_connection(&connection, &content))
                });
                match result {
                    Ok(sent) => {
                        if let Err(error) = record_outbound_agent_message(
                            &job.channel_id,
                            sent.message_id,
                            job.agent_id,
                            job.agent_name,
                        ) {
                            eprintln!("[whatsapp] routage de réponse non persisté : {error}");
                        }
                    }
                    Err(error) => {
                        eprintln!("[whatsapp] notification non envoyée : {error}");
                    }
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
    let job = WhatsAppNotificationJob {
        channel_id,
        agent_id,
        agent_name: truncate_message(&agent_name, 120),
        content: truncate_message(&content, MAX_NOTIFICATION_TEXT_CHARS),
    };
    if let Err(error) = notification_sender().try_send(job) {
        eprintln!("[whatsapp] file de notifications saturée : {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn webhook_signature(secret: &str, body: &[u8]) -> String {
        let mut mac = Hmac::<Sha256>::new_from_slice(secret.as_bytes()).unwrap();
        mac.update(body);
        let digest = mac.finalize().into_bytes();
        format!(
            "sha256={}",
            digest
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        )
    }

    fn stored_connection() -> StoredWhatsAppConnection {
        StoredWhatsAppConnection {
            id: "11111111-1111-4111-8111-111111111111".to_string(),
            owner_id: "owner-a".to_string(),
            access_token: Some("EAAB-super-secret-token".to_string()),
            app_secret: Some("meta-app-secret".to_string()),
            phone_number_id: Some("1234567890".to_string()),
            recipient_phone_number: Some("33612345678".to_string()),
            display_phone_number: Some("+33 1 23 45 67 89".to_string()),
            verified_name: Some("Codex Switch".to_string()),
            quality_rating: Some("GREEN".to_string()),
            template_name: None,
            template_language: None,
            webhook_verify_token: Some("cst-test-verify-token".to_string()),
            recent_inbound_message_ids: Vec::new(),
            outbound_agent_messages: Vec::new(),
            created_at: 1,
            connected_at: Some(2),
            updated_at: 2,
        }
    }

    #[test]
    fn connection_view_never_exposes_the_access_token_or_recipient() {
        let view = connection_view(Some(&stored_connection()));
        let json = serde_json::to_string(&view).unwrap();
        assert!(json.contains("Codex Switch"));
        assert!(json.contains("5678"));
        assert!(!json.contains("super-secret-token"));
        assert!(!json.contains("meta-app-secret"));
        assert!(!json.contains("33612345678"));
        assert!(!json.contains("accessToken"));
        assert!(view.conversation_enabled);
    }

    #[test]
    fn recipient_is_normalized_to_cloud_api_digits() {
        assert_eq!(
            normalize_recipient_phone_number("+33 6 12-34-56-78").unwrap(),
            "33612345678"
        );
        assert!(normalize_recipient_phone_number("06 12 34").is_err());
        assert!(normalize_recipient_phone_number("0612345678").is_err());
        assert!(normalize_recipient_phone_number("+33 6 12 ABC 78").is_err());
    }

    #[test]
    fn verifies_meta_hmac_signatures() {
        let body = br#"{"object":"whatsapp_business_account"}"#;
        let signature = webhook_signature("secret", body);
        assert!(webhook_signature_matches("secret", &signature, body));
        assert!(!webhook_signature_matches("wrong", &signature, body));
        assert!(!webhook_signature_matches("secret", "sha256=bad", body));
    }

    #[test]
    fn extracts_only_authorized_webhook_messages_once() {
        let dir = std::env::temp_dir().join(format!("cst-whatsapp-webhook-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("connections.json");
        persist_store_to(
            &path,
            &WhatsAppConnectionStore {
                version: store_version(),
                connections: vec![stored_connection()],
            },
        )
        .unwrap();

        let body = r#"{
          "object":"whatsapp_business_account",
          "entry":[{"changes":[{"field":"messages","value":{
            "metadata":{"phone_number_id":"1234567890"},
            "messages":[{"from":"33612345678","id":"wamid.inbound-1","type":"text","text":{"body":"Avance sur la priorité 1"},"context":{"id":"wamid.outbound-1"}}]
          }}]}]
        }"#
        .as_bytes();
        let signature = webhook_signature("meta-app-secret", body);
        let messages = verify_and_extract_webhook_messages_from(&path, &signature, body).unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Avance sur la priorité 1");
        assert_eq!(
            messages[0].reply_to_message_id.as_deref(),
            Some("wamid.outbound-1")
        );
        assert!(
            verify_and_extract_webhook_messages_from(&path, &signature, body)
                .unwrap()
                .is_empty()
        );

        let other_sender = String::from_utf8(body.to_vec())
            .unwrap()
            .replace("33612345678", "33600000000")
            .replace("wamid.inbound-1", "wamid.inbound-2");
        let other_signature = webhook_signature("meta-app-secret", other_sender.as_bytes());
        assert!(verify_and_extract_webhook_messages_from(
            &path,
            &other_signature,
            other_sender.as_bytes(),
        )
        .unwrap()
        .is_empty());
        assert!(matches!(
            verify_and_extract_webhook_messages_from(&path, "sha256=bad", body),
            Err(WhatsAppWebhookError::Unauthorized(_))
        ));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn template_names_follow_meta_naming_rules() {
        assert_eq!(
            validate_template_name(Some("agent_notification_1".to_string())).unwrap(),
            Some("agent_notification_1".to_string())
        );
        assert!(validate_template_name(Some("Agent Notification".to_string())).is_err());
    }

    #[test]
    fn free_text_payload_never_enables_url_previews() {
        let payload = message_payload(&stored_connection(), "Rapport prêt");
        assert_eq!(payload["type"], "text");
        assert_eq!(payload["text"]["preview_url"], false);
        assert_eq!(payload["to"], "33612345678");
    }

    #[test]
    fn template_payload_passes_the_report_as_first_body_parameter() {
        let mut connection = stored_connection();
        connection.template_name = Some("agent_notification".to_string());
        connection.template_language = Some("fr".to_string());
        let payload = message_payload(&connection, "Rapport prêt");
        assert_eq!(payload["type"], "template");
        assert_eq!(payload["template"]["name"], "agent_notification");
        assert_eq!(
            payload["template"]["components"][0]["parameters"][0]["text"],
            "Rapport prêt"
        );
    }

    #[test]
    fn disconnect_clears_secrets_but_keeps_the_stable_channel_id() {
        let mut connection = stored_connection();
        let id = connection.id.clone();
        connection.clear_credentials(10);
        assert_eq!(connection.id, id);
        assert!(!connection.is_connected());
        assert!(connection.access_token.is_none());
        assert!(connection.app_secret.is_none());
        assert!(connection.recipient_phone_number.is_none());
    }
}
