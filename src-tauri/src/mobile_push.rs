use chrono::Utc;
use reqwest::{redirect::Policy, Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::HashSet,
    env, fs,
    io::ErrorKind,
    path::{Path, PathBuf},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::Duration,
};
use uuid::Uuid;
use yup_oauth2::ServiceAccountKey;

const MOBILE_PUSH_DEVICES_FILE: &str = "mobile-push-devices.json";
const MOBILE_PUSH_CONFIGURATION_FILE: &str = "mobile-push-config.json";
const STORE_VERSION: u8 = 1;
const MAX_DEVICES: usize = 16;
const MAX_FIREBASE_INSTALLATION_ID_CHARS: usize = 512;
const MAX_APP_VERSION_CHARS: usize = 64;
const MAX_NOTIFICATION_FIELD_CHARS: usize = 160;
const MAX_NOTIFICATION_CONTENT_CHARS: usize = 600;
const MAX_CONFIGURATION_JSON_BYTES: usize = 64 * 1024;
const NOTIFICATION_QUEUE_CAPACITY: usize = 64;
const FCM_SCOPE: &str = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static NOTIFICATION_SENDER: OnceLock<mpsc::SyncSender<MobilePushNotificationJob>> = OnceLock::new();

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterMobilePushDeviceRequest {
    pub device_id: String,
    pub firebase_installation_id: String,
    #[serde(default)]
    pub app_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigureMobilePushRequest {
    #[serde(default)]
    pub google_services_json: Option<String>,
    #[serde(default)]
    pub service_account_json: Option<String>,
    #[serde(default)]
    pub android_package_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePushDeviceView {
    pub device_id: String,
    pub registered: bool,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePushStatusView {
    pub configured: bool,
    pub registered_devices: usize,
    pub provider: &'static str,
    pub note: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePushConfigurationView {
    pub configured: bool,
    pub android_configured: bool,
    pub service_account_configured: bool,
    pub project_id: Option<String>,
    pub android_package_name: Option<String>,
    pub android_application_id: Option<String>,
    pub android_api_key: Option<String>,
    pub sender_id: Option<String>,
    pub service_account_email: Option<String>,
    pub registered_devices: usize,
    pub credentials_source: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobilePushTestView {
    pub ok: bool,
    pub delivered_devices: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMobilePushDevice {
    device_id: String,
    /// Identifiant d'installation Firebase (FID). Il n'est jamais expose par
    /// l'API ni transmis a un agent, mais doit rester persiste pour joindre
    /// cette installation avec FCM.
    firebase_installation_id: String,
    #[serde(default)]
    app_version: Option<String>,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MobilePushDeviceStore {
    #[serde(default = "store_version")]
    version: u8,
    #[serde(default)]
    devices: Vec<StoredMobilePushDevice>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMobilePushConfiguration {
    #[serde(default = "store_version")]
    version: u8,
    #[serde(default)]
    project_id: Option<String>,
    #[serde(default)]
    sender_id: Option<String>,
    #[serde(default)]
    android_package_name: Option<String>,
    #[serde(default)]
    android_application_id: Option<String>,
    #[serde(default)]
    android_api_key: Option<String>,
    #[serde(default)]
    service_account: Option<ServiceAccountKey>,
    #[serde(default)]
    updated_at: i64,
}

#[derive(Debug, Clone)]
struct ParsedAndroidFirebaseConfiguration {
    project_id: String,
    sender_id: String,
    package_name: String,
    application_id: String,
    api_key: String,
}

#[derive(Debug, Clone)]
struct MobilePaymentNotificationJob {
    agent_id: String,
    agent_name: String,
    payment_id: String,
    merchant: String,
    amount_minor: u64,
    currency: String,
}

#[derive(Debug, Clone)]
struct MobileAgentNotificationJob {
    agent_id: String,
    agent_name: String,
    notification_id: String,
    content: String,
    attention_required: bool,
}

#[derive(Debug, Clone)]
enum MobilePushNotificationJob {
    Payment(MobilePaymentNotificationJob),
    AutonomousAgent(MobileAgentNotificationJob),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DeliveryResult {
    Delivered,
    StaleDevice,
}

fn store_version() -> u8 {
    STORE_VERSION
}

fn devices_path() -> Result<PathBuf, String> {
    crate::settings::runtime_data_path(MOBILE_PUSH_DEVICES_FILE)
}

fn configuration_path() -> Result<PathBuf, String> {
    crate::settings::runtime_data_path(MOBILE_PUSH_CONFIGURATION_FILE)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Verrou des notifications mobiles indisponible.".to_string())
}

fn load_store_from(path: &Path) -> Result<MobilePushDeviceStore, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(MobilePushDeviceStore {
                version: store_version(),
                ..MobilePushDeviceStore::default()
            })
        }
        Err(error) => {
            return Err(format!(
                "Lecture des appareils de notification impossible : {error}"
            ))
        }
    };
    let mut store = serde_json::from_str::<MobilePushDeviceStore>(&content)
        .map_err(|error| format!("Fichier des appareils de notification invalide : {error}"))?;
    store.version = store_version();
    store.devices.retain(|device| {
        validate_device_id(&device.device_id).is_ok()
            && validate_firebase_installation_id(&device.firebase_installation_id).is_ok()
    });
    if store.devices.len() > MAX_DEVICES {
        store
            .devices
            .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        store.devices.truncate(MAX_DEVICES);
    }
    Ok(store)
}

fn load_store() -> Result<MobilePushDeviceStore, String> {
    load_store_from(&devices_path()?)
}

fn protect_private_file(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!("Protection du fichier de notification impossible : {error}")
        })?;
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn persist_store_to(path: &Path, store: &MobilePushDeviceStore) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Serialisation des appareils mobiles impossible : {error}"))?;
    crate::fs_util::atomic_write(path, content)
        .map_err(|error| format!("Ecriture des appareils mobiles impossible : {error}"))?;
    protect_private_file(path)
}

fn persist_store(store: &MobilePushDeviceStore) -> Result<(), String> {
    persist_store_to(&devices_path()?, store)
}

fn load_configuration_from(path: &Path) -> Result<StoredMobilePushConfiguration, String> {
    let content = match fs::read(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(StoredMobilePushConfiguration {
                version: store_version(),
                ..StoredMobilePushConfiguration::default()
            })
        }
        Err(error) => {
            return Err(format!(
                "Lecture de la configuration Firebase impossible : {error}"
            ))
        }
    };
    if content.len() > MAX_CONFIGURATION_JSON_BYTES {
        return Err("Configuration Firebase trop volumineuse.".to_string());
    }
    let mut configuration = serde_json::from_slice::<StoredMobilePushConfiguration>(&content)
        .map_err(|error| format!("Configuration Firebase invalide : {error}"))?;
    configuration.version = store_version();
    Ok(configuration)
}

fn load_configuration() -> Result<StoredMobilePushConfiguration, String> {
    load_configuration_from(&configuration_path()?)
}

fn persist_configuration_to(
    path: &Path,
    configuration: &StoredMobilePushConfiguration,
) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(configuration).map_err(|error| {
        format!("Serialisation de la configuration Firebase impossible : {error}")
    })?;
    if content.len() > MAX_CONFIGURATION_JSON_BYTES {
        return Err("Configuration Firebase trop volumineuse.".to_string());
    }
    crate::fs_util::atomic_write(path, content)
        .map_err(|error| format!("Ecriture de la configuration Firebase impossible : {error}"))?;
    protect_private_file(path)
}

fn validate_device_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    Uuid::parse_str(value)
        .map(|_| value.to_string())
        .map_err(|_| "Identifiant d'installation mobile invalide.".to_string())
}

fn validate_firebase_installation_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if !(10..=MAX_FIREBASE_INSTALLATION_ID_CHARS).contains(&value.len())
        || !value.bytes().all(|byte| byte.is_ascii_graphic())
    {
        return Err("Identifiant d'installation Firebase invalide.".to_string());
    }
    Ok(value.to_string())
}

fn valid_android_package_name(value: &str) -> bool {
    value.len() <= 160
        && value.split('.').count() >= 2
        && value.split('.').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
}

fn json_string(value: &serde_json::Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn parse_google_services_json(
    raw: &str,
    requested_package_name: Option<&str>,
) -> Result<ParsedAndroidFirebaseConfiguration, String> {
    if raw.len() > MAX_CONFIGURATION_JSON_BYTES {
        return Err("Le fichier google-services.json est trop volumineux.".to_string());
    }
    let document = serde_json::from_str::<serde_json::Value>(raw)
        .map_err(|error| format!("google-services.json n'est pas un JSON valide : {error}"))?;
    let project_id = json_string(&document, &["project_info", "project_id"])
        .filter(|value| valid_project_id(value))
        .ok_or_else(|| "project_info.project_id est absent ou invalide.".to_string())?;
    let sender_id = json_string(&document, &["project_info", "project_number"])
        .filter(|value| {
            (5..=32).contains(&value.len()) && value.bytes().all(|byte| byte.is_ascii_digit())
        })
        .ok_or_else(|| "project_info.project_number est absent ou invalide.".to_string())?;
    let clients = document
        .get("client")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "Aucun client Android dans google-services.json.".to_string())?;
    let requested_package_name = requested_package_name
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(package_name) = requested_package_name {
        if !valid_android_package_name(package_name) {
            return Err("Nom de package Android invalide.".to_string());
        }
    }
    let client = clients
        .iter()
        .find(|candidate| {
            let package_name = json_string(
                candidate,
                &["client_info", "android_client_info", "package_name"],
            );
            requested_package_name
                .map(|requested| package_name.as_deref() == Some(requested))
                .unwrap_or(clients.len() == 1)
        })
        .ok_or_else(|| {
            format!(
                "Aucun client Firebase ne correspond au package {}.",
                requested_package_name.unwrap_or("Android demande")
            )
        })?;
    let package_name = json_string(
        client,
        &["client_info", "android_client_info", "package_name"],
    )
    .filter(|value| valid_android_package_name(value))
    .ok_or_else(|| "Package Android Firebase absent ou invalide.".to_string())?;
    let application_id = json_string(client, &["client_info", "mobilesdk_app_id"])
        .filter(|value| {
            value.len() <= 256
                && value.starts_with("1:")
                && value.contains(":android:")
                && value.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .ok_or_else(|| "mobilesdk_app_id est absent ou invalide.".to_string())?;
    let api_key = client
        .get("api_key")
        .and_then(serde_json::Value::as_array)
        .and_then(|keys| {
            keys.iter()
                .find_map(|value| json_string(value, &["current_key"]))
        })
        .filter(|value| {
            (20..=256).contains(&value.len())
                && value.starts_with("AIza")
                && value.bytes().all(|byte| byte.is_ascii_graphic())
        })
        .ok_or_else(|| "Cle API Android Firebase absente ou invalide.".to_string())?;
    Ok(ParsedAndroidFirebaseConfiguration {
        project_id,
        sender_id,
        package_name,
        application_id,
        api_key,
    })
}

fn parse_service_account_json(raw: &str) -> Result<ServiceAccountKey, String> {
    if raw.len() > MAX_CONFIGURATION_JSON_BYTES {
        return Err("Le compte de service Firebase est trop volumineux.".to_string());
    }
    let key = serde_json::from_str::<ServiceAccountKey>(raw)
        .map_err(|error| format!("Compte de service Firebase invalide : {error}"))?;
    if key.key_type.as_deref() != Some("service_account") {
        return Err("Le JSON doit etre une cle de compte de service.".to_string());
    }
    if key
        .project_id
        .as_deref()
        .filter(|value| valid_project_id(value))
        .is_none()
    {
        return Err("project_id absent du compte de service.".to_string());
    }
    if !key.client_email.ends_with(".gserviceaccount.com")
        || key.client_email.len() > 320
        || !key.client_email.is_ascii()
    {
        return Err("Adresse du compte de service Firebase invalide.".to_string());
    }
    if !key.private_key.starts_with("-----BEGIN PRIVATE KEY-----")
        || !key.private_key.contains("-----END PRIVATE KEY-----")
    {
        return Err("Cle privee du compte de service Firebase invalide.".to_string());
    }
    if key.token_uri != FCM_TOKEN_URI {
        return Err("token_uri du compte de service Firebase non autorise.".to_string());
    }
    Ok(key)
}

fn normalize_app_version(value: Option<String>) -> Option<String> {
    let value = value?.trim().to_string();
    if value.is_empty() {
        return None;
    }
    Some(value.chars().take(MAX_APP_VERSION_CHARS).collect())
}

fn compact_notification_field_with_limit(value: &str, max_chars: usize) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(max_chars)
        .collect()
}

fn compact_notification_field(value: &str) -> String {
    compact_notification_field_with_limit(value, MAX_NOTIFICATION_FIELD_CHARS)
}

fn explicit_project_id() -> Option<String> {
    env::var("CST_FIREBASE_PROJECT_ID")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn credentials_path() -> Option<PathBuf> {
    env::var_os("GOOGLE_APPLICATION_CREDENTIALS")
        .map(PathBuf::from)
        .filter(|path| path.is_file())
}

fn valid_project_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b':' | b'.'))
}

fn external_service_account_key() -> Option<ServiceAccountKey> {
    let path = credentials_path()?;
    serde_json::from_slice::<ServiceAccountKey>(&fs::read(path).ok()?).ok()
}

fn effective_service_account_key(
    configuration: &StoredMobilePushConfiguration,
) -> Option<ServiceAccountKey> {
    external_service_account_key().or_else(|| configuration.service_account.clone())
}

fn fcm_is_configured() -> bool {
    let Ok(configuration) = load_configuration() else {
        return false;
    };
    let Some(service_account) = effective_service_account_key(&configuration) else {
        return false;
    };
    let Some(project_id) = explicit_project_id()
        .or(service_account.project_id)
        .filter(|value| valid_project_id(value))
    else {
        return false;
    };
    configuration
        .project_id
        .as_deref()
        .map(|android_project| android_project == project_id)
        .unwrap_or(true)
}

pub fn mobile_push_status() -> Result<MobilePushStatusView, String> {
    let _guard = lock_store()?;
    let store = load_store()?;
    Ok(MobilePushStatusView {
        configured: fcm_is_configured(),
        registered_devices: store.devices.len(),
        provider: "firebase_cloud_messaging",
        note: "Les notifications d'agents et les handoffs de paiement sont construits localement par l'app mobile.",
    })
}

fn configuration_view_from(
    configuration: &StoredMobilePushConfiguration,
    registered_devices: usize,
) -> MobilePushConfigurationView {
    let external_key = external_service_account_key();
    let service_account = external_key
        .clone()
        .or_else(|| configuration.service_account.clone());
    let credentials_source = if external_key.is_some() {
        "environment"
    } else if configuration.service_account.is_some() {
        "managed"
    } else {
        "none"
    };
    let android_configured = configuration.project_id.is_some()
        && configuration.sender_id.is_some()
        && configuration.android_package_name.is_some()
        && configuration.android_application_id.is_some()
        && configuration.android_api_key.is_some();
    let service_project_id = explicit_project_id().or_else(|| {
        service_account
            .as_ref()
            .and_then(|key| key.project_id.clone())
    });
    let projects_match = match (
        configuration.project_id.as_deref(),
        service_project_id.as_deref(),
    ) {
        (Some(android), Some(service)) => android == service,
        _ => false,
    };
    MobilePushConfigurationView {
        configured: android_configured && service_account.is_some() && projects_match,
        android_configured,
        service_account_configured: service_account.is_some(),
        project_id: configuration
            .project_id
            .clone()
            .or(service_project_id.clone()),
        android_package_name: configuration.android_package_name.clone(),
        android_application_id: configuration.android_application_id.clone(),
        android_api_key: configuration.android_api_key.clone(),
        sender_id: configuration.sender_id.clone(),
        service_account_email: service_account.map(|key| key.client_email),
        registered_devices,
        credentials_source,
    }
}

pub fn mobile_push_configuration() -> Result<MobilePushConfigurationView, String> {
    let _guard = lock_store()?;
    let configuration = load_configuration()?;
    let registered_devices = load_store()?.devices.len();
    Ok(configuration_view_from(&configuration, registered_devices))
}

fn configure_mobile_push_in(
    path: &Path,
    request: ConfigureMobilePushRequest,
) -> Result<StoredMobilePushConfiguration, String> {
    let mut configuration = load_configuration_from(path)?;
    let google_services_json = request
        .google_services_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let service_account_json = request
        .service_account_json
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if google_services_json.is_none() && service_account_json.is_none() {
        return Err("Colle au moins un fichier de configuration Firebase.".to_string());
    }
    if let Some(raw) = google_services_json {
        let parsed = parse_google_services_json(raw, request.android_package_name.as_deref())?;
        configuration.project_id = Some(parsed.project_id);
        configuration.sender_id = Some(parsed.sender_id);
        configuration.android_package_name = Some(parsed.package_name);
        configuration.android_application_id = Some(parsed.application_id);
        configuration.android_api_key = Some(parsed.api_key);
    }
    if let Some(raw) = service_account_json {
        configuration.service_account = Some(parse_service_account_json(raw)?);
    }
    if let (Some(android_project), Some(service_project)) = (
        configuration.project_id.as_deref(),
        configuration
            .service_account
            .as_ref()
            .and_then(|key| key.project_id.as_deref()),
    ) {
        if android_project != service_project {
            return Err(format!(
                "Les deux JSON n'utilisent pas le meme projet Firebase ({android_project} / {service_project})."
            ));
        }
    }
    if let (Some(android_project), Some(environment_project)) = (
        configuration.project_id.as_deref(),
        explicit_project_id()
            .or_else(|| external_service_account_key().and_then(|key| key.project_id))
            .as_deref(),
    ) {
        if android_project != environment_project {
            return Err(format!(
                "Le projet Android {android_project} ne correspond pas au compte de service serveur {environment_project}."
            ));
        }
    }
    configuration.version = store_version();
    configuration.updated_at = Utc::now().timestamp();
    persist_configuration_to(path, &configuration)?;
    Ok(configuration)
}

pub fn configure_mobile_push(
    request: ConfigureMobilePushRequest,
) -> Result<MobilePushConfigurationView, String> {
    let _guard = lock_store()?;
    let configuration = configure_mobile_push_in(&configuration_path()?, request)?;
    let registered_devices = load_store()?.devices.len();
    Ok(configuration_view_from(&configuration, registered_devices))
}

fn register_mobile_push_device_in(
    path: &Path,
    request: RegisterMobilePushDeviceRequest,
) -> Result<MobilePushDeviceView, String> {
    let device_id = validate_device_id(&request.device_id)?;
    let firebase_installation_id =
        validate_firebase_installation_id(&request.firebase_installation_id)?;
    let app_version = normalize_app_version(request.app_version);
    let now = Utc::now().timestamp();
    let mut store = load_store_from(path)?;

    // Un FID ne doit router que vers un appareil dans ce registre. Sa rotation
    // remplace donc toute occurrence anterieure avant l'upsert.
    store.devices.retain(|device| {
        device.device_id == device_id || device.firebase_installation_id != firebase_installation_id
    });
    if let Some(device) = store
        .devices
        .iter_mut()
        .find(|device| device.device_id == device_id)
    {
        device.firebase_installation_id = firebase_installation_id;
        device.app_version = app_version;
        device.updated_at = now;
    } else {
        store.devices.push(StoredMobilePushDevice {
            device_id: device_id.clone(),
            firebase_installation_id,
            app_version,
            created_at: now,
            updated_at: now,
        });
    }
    store
        .devices
        .sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    store.devices.truncate(MAX_DEVICES);
    persist_store_to(path, &store)?;
    Ok(MobilePushDeviceView {
        device_id,
        registered: true,
        updated_at: now,
    })
}

pub fn register_mobile_push_device(
    request: RegisterMobilePushDeviceRequest,
) -> Result<MobilePushDeviceView, String> {
    let _guard = lock_store()?;
    register_mobile_push_device_in(&devices_path()?, request)
}

fn unregister_mobile_push_device_in(path: &Path, device_id: &str) -> Result<(), String> {
    let device_id = validate_device_id(device_id)?;
    let mut store = load_store_from(path)?;
    store.devices.retain(|device| device.device_id != device_id);
    persist_store_to(path, &store)
}

pub fn unregister_mobile_push_device(device_id: &str) -> Result<(), String> {
    let _guard = lock_store()?;
    unregister_mobile_push_device_in(&devices_path()?, device_id)
}

fn fcm_client() -> Result<Client, String> {
    Client::builder()
        .redirect(Policy::none())
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Client FCM indisponible : {error}"))
}

fn notification_payload(
    device: &StoredMobilePushDevice,
    job: &MobilePushNotificationJob,
) -> serde_json::Value {
    match job {
        MobilePushNotificationJob::Payment(job) => json!({
            "message": {
                "fid": device.firebase_installation_id,
                "data": {
                    "type": "payment_handoff",
                    "agentId": job.agent_id,
                    "agentName": job.agent_name,
                    "paymentId": job.payment_id,
                    "merchant": job.merchant,
                    "amountMinor": job.amount_minor.to_string(),
                    "currency": job.currency
                },
                "android": {
                    "priority": "high",
                    "ttl": "900s",
                    "collapse_key": format!("payment-{}", job.payment_id)
                }
            }
        }),
        MobilePushNotificationJob::AutonomousAgent(job) => json!({
            "message": {
                "fid": device.firebase_installation_id,
                "data": {
                    "type": if job.attention_required {
                        "autonomous_agent_alert"
                    } else {
                        "autonomous_agent_report"
                    },
                    "agentId": job.agent_id,
                    "agentName": job.agent_name,
                    "notificationId": job.notification_id,
                    "content": job.content
                },
                "android": {
                    "priority": "high",
                    "ttl": "3600s",
                    "collapse_key": format!("autonomous-agent-{}", job.agent_id)
                }
            }
        }),
    }
}

async fn send_to_device(
    client: &Client,
    project_id: &str,
    bearer: &str,
    device: &StoredMobilePushDevice,
    job: &MobilePushNotificationJob,
) -> Result<DeliveryResult, String> {
    let endpoint = format!("https://fcm.googleapis.com/v1/projects/{project_id}/messages:send");
    let payload = notification_payload(device, job);
    let response = client
        .post(endpoint)
        .bearer_auth(bearer)
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("FCM est injoignable : {}", error.without_url()))?;
    let status = response.status();
    let response_body = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(DeliveryResult::Delivered);
    }
    if status == StatusCode::NOT_FOUND
        || response_body.contains("UNREGISTERED")
        || response_body.contains("registration-token-not-registered")
    {
        return Ok(DeliveryResult::StaleDevice);
    }
    Err(format!("Envoi FCM refuse (HTTP {}).", status.as_u16()))
}

async fn send_test_to_device(
    client: &Client,
    project_id: &str,
    bearer: &str,
    device: &StoredMobilePushDevice,
) -> Result<DeliveryResult, String> {
    let endpoint = format!("https://fcm.googleapis.com/v1/projects/{project_id}/messages:send");
    let response = client
        .post(endpoint)
        .bearer_auth(bearer)
        .json(&json!({
            "message": {
                "fid": device.firebase_installation_id,
                "data": { "type": "configuration_test" },
                "android": {
                    "priority": "high",
                    "ttl": "60s",
                    "collapse_key": "mobile-push-configuration-test"
                }
            }
        }))
        .send()
        .await
        .map_err(|error| format!("FCM est injoignable : {}", error.without_url()))?;
    let status = response.status();
    let response_body = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(DeliveryResult::Delivered);
    }
    if status == StatusCode::NOT_FOUND
        || response_body.contains("UNREGISTERED")
        || response_body.contains("registration-token-not-registered")
    {
        return Ok(DeliveryResult::StaleDevice);
    }
    Err(format!("Test FCM refuse (HTTP {}).", status.as_u16()))
}

async fn fcm_authorization() -> Result<(String, String), String> {
    let service_account = if let Some(path) = credentials_path() {
        yup_oauth2::read_service_account_key(path)
            .await
            .map_err(|error| format!("Lecture des identifiants FCM impossible : {error}"))?
    } else {
        let _guard = lock_store()?;
        load_configuration()?
            .service_account
            .ok_or_else(|| "Compte de service FCM non configure.".to_string())?
    };
    let project_id = explicit_project_id()
        .or_else(|| service_account.project_id.clone())
        .filter(|value| valid_project_id(value))
        .ok_or_else(|| "Projet Firebase introuvable dans la configuration FCM.".to_string())?;
    let authenticator = yup_oauth2::ServiceAccountAuthenticator::builder(service_account)
        .build()
        .await
        .map_err(|error| format!("Authentification FCM impossible : {error}"))?;
    let access_token = authenticator
        .token(&[FCM_SCOPE])
        .await
        .map_err(|error| format!("Jeton OAuth FCM impossible : {error}"))?;
    let bearer = access_token
        .token()
        .ok_or_else(|| "Google n'a renvoye aucun jeton OAuth FCM.".to_string())?
        .to_string();
    Ok((project_id, bearer))
}

async fn deliver_notification(job: MobilePushNotificationJob) -> Result<(), String> {
    let (project_id, bearer) = fcm_authorization().await?;
    let devices = {
        let _guard = lock_store()?;
        load_store()?.devices
    };
    if devices.is_empty() {
        return Ok(());
    }

    let client = fcm_client()?;
    let mut stale_devices = HashSet::new();
    let mut first_error = None;
    for device in devices {
        match send_to_device(&client, &project_id, &bearer, &device, &job).await {
            Ok(DeliveryResult::Delivered) => {}
            Ok(DeliveryResult::StaleDevice) => {
                stale_devices.insert(device.device_id);
            }
            Err(error) => {
                if first_error.is_none() {
                    first_error = Some(error);
                }
            }
        }
    }
    if !stale_devices.is_empty() {
        let _guard = lock_store()?;
        let mut store = load_store()?;
        store
            .devices
            .retain(|device| !stale_devices.contains(&device.device_id));
        persist_store(&store)?;
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    Ok(())
}

pub async fn test_mobile_push_configuration() -> Result<MobilePushTestView, String> {
    let (project_id, bearer) = fcm_authorization().await?;
    let devices = {
        let _guard = lock_store()?;
        load_store()?.devices
    };
    if devices.is_empty() {
        return Err(
            "Aucun appareil mobile enregistre. Accepte les notifications puis reessaie."
                .to_string(),
        );
    }
    let client = fcm_client()?;
    let mut delivered_devices = 0;
    let mut stale_devices = HashSet::new();
    let mut first_error = None;
    for device in devices {
        match send_test_to_device(&client, &project_id, &bearer, &device).await {
            Ok(DeliveryResult::Delivered) => delivered_devices += 1,
            Ok(DeliveryResult::StaleDevice) => {
                stale_devices.insert(device.device_id);
            }
            Err(error) if first_error.is_none() => first_error = Some(error),
            Err(_) => {}
        }
    }
    if !stale_devices.is_empty() {
        let _guard = lock_store()?;
        let mut store = load_store()?;
        store
            .devices
            .retain(|device| !stale_devices.contains(&device.device_id));
        persist_store(&store)?;
    }
    if let Some(error) = first_error {
        return Err(error);
    }
    if delivered_devices == 0 {
        return Err("Aucun appareil FCM encore valide.".to_string());
    }
    Ok(MobilePushTestView {
        ok: true,
        delivered_devices,
    })
}

fn notification_sender() -> &'static mpsc::SyncSender<MobilePushNotificationJob> {
    NOTIFICATION_SENDER.get_or_init(|| {
        let (sender, receiver) =
            mpsc::sync_channel::<MobilePushNotificationJob>(NOTIFICATION_QUEUE_CAPACITY);
        thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    eprintln!("[mobile-push] runtime indisponible : {error}");
                    return;
                }
            };
            while let Ok(job) = receiver.recv() {
                if let Err(error) = runtime.block_on(deliver_notification(job)) {
                    eprintln!("[mobile-push] notification non envoyee : {error}");
                }
            }
        });
        sender
    })
}

pub fn enqueue_payment_handoff(
    agent_id: String,
    agent_name: String,
    payment_id: String,
    merchant: String,
    amount_minor: u64,
    currency: String,
) {
    if !fcm_is_configured() {
        return;
    }
    let job = MobilePushNotificationJob::Payment(MobilePaymentNotificationJob {
        agent_id,
        agent_name: compact_notification_field(&agent_name),
        payment_id,
        merchant: compact_notification_field(&merchant),
        amount_minor,
        currency: currency.trim().to_ascii_uppercase(),
    });
    if let Err(error) = notification_sender().try_send(job) {
        eprintln!("[mobile-push] file de notifications saturee : {error}");
    }
}

pub fn enqueue_agent_notification(
    agent_id: String,
    agent_name: String,
    notification_id: String,
    content: String,
    attention_required: bool,
) {
    if !fcm_is_configured() {
        return;
    }
    let content = compact_notification_field_with_limit(&content, MAX_NOTIFICATION_CONTENT_CHARS);
    let job = MobilePushNotificationJob::AutonomousAgent(MobileAgentNotificationJob {
        agent_id,
        agent_name: compact_notification_field(&agent_name),
        notification_id: compact_notification_field(&notification_id),
        content: if content.is_empty() {
            "Un nouveau compte rendu est disponible.".to_string()
        } else {
            content
        },
        attention_required,
    });
    if let Err(error) = notification_sender().try_send(job) {
        eprintln!("[mobile-push] file de notifications saturee : {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registration(device_id: &str, fid_suffix: &str) -> RegisterMobilePushDeviceRequest {
        RegisterMobilePushDeviceRequest {
            device_id: device_id.to_string(),
            firebase_installation_id: format!("firebase-installation-id-long-enough-{fid_suffix}"),
            app_version: Some("0.1.0-debug".to_string()),
        }
    }

    fn google_services(package_name: &str, project_id: &str) -> String {
        json!({
            "project_info": {
                "project_number": "123456789012",
                "project_id": project_id
            },
            "client": [{
                "client_info": {
                    "mobilesdk_app_id": "1:123456789012:android:abcdef1234567890",
                    "android_client_info": { "package_name": package_name }
                },
                "api_key": [{ "current_key": "AIzaSyExamplePublicAndroidKey1234567890" }]
            }]
        })
        .to_string()
    }

    fn service_account(project_id: &str) -> String {
        json!({
            "type": "service_account",
            "project_id": project_id,
            "private_key": "-----BEGIN PRIVATE KEY-----\nZmFrZQ==\n-----END PRIVATE KEY-----\n",
            "client_email": format!("firebase-adminsdk@{project_id}.iam.gserviceaccount.com"),
            "token_uri": FCM_TOKEN_URI
        })
        .to_string()
    }

    #[test]
    fn registration_rotates_fids_without_exposing_them() {
        let dir = std::env::temp_dir().join(format!("cst-mobile-push-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("devices.json");
        let id = Uuid::new_v4().to_string();
        let view = register_mobile_push_device_in(&path, registration(&id, "one")).unwrap();
        assert!(view.registered);
        register_mobile_push_device_in(&path, registration(&id, "two")).unwrap();

        let store = load_store_from(&path).unwrap();
        assert_eq!(store.devices.len(), 1);
        assert!(store.devices[0].firebase_installation_id.ends_with("two"));
        let view_json = serde_json::to_string(&view).unwrap();
        assert!(!view_json.contains("firebase-installation-id"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn unregister_requires_the_exact_device_id() {
        let dir = std::env::temp_dir().join(format!("cst-mobile-push-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("devices.json");
        let id = Uuid::new_v4().to_string();
        register_mobile_push_device_in(&path, registration(&id, "one")).unwrap();
        assert!(unregister_mobile_push_device_in(&path, "not-a-uuid").is_err());
        unregister_mobile_push_device_in(&path, &id).unwrap();
        assert!(load_store_from(&path).unwrap().devices.is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn managed_configuration_extracts_both_json_files_without_exposing_the_private_key() {
        let dir = std::env::temp_dir().join(format!("cst-mobile-push-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let package_name = "com.codexswitch.terminal.debug";
        let configuration = configure_mobile_push_in(
            &path,
            ConfigureMobilePushRequest {
                google_services_json: Some(google_services(package_name, "cst-payments")),
                service_account_json: Some(service_account("cst-payments")),
                android_package_name: Some(package_name.to_string()),
            },
        )
        .unwrap();

        assert_eq!(configuration.project_id.as_deref(), Some("cst-payments"));
        assert_eq!(
            configuration.android_package_name.as_deref(),
            Some(package_name)
        );
        assert!(configuration.service_account.is_some());
        let public_view =
            serde_json::to_string(&configuration_view_from(&configuration, 0)).unwrap();
        assert!(!public_view.contains("BEGIN PRIVATE KEY"));
        assert!(!public_view.contains("private_key"));
        assert!(fs::read_to_string(&path)
            .unwrap()
            .contains("BEGIN PRIVATE KEY"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn managed_configuration_rejects_mismatched_projects() {
        let dir = std::env::temp_dir().join(format!("cst-mobile-push-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("config.json");
        let result = configure_mobile_push_in(
            &path,
            ConfigureMobilePushRequest {
                google_services_json: Some(google_services(
                    "com.codexswitch.terminal.debug",
                    "android-project",
                )),
                service_account_json: Some(service_account("server-project")),
                android_package_name: Some("com.codexswitch.terminal.debug".to_string()),
            },
        );
        assert!(result.unwrap_err().contains("meme projet Firebase"));
        assert!(!path.exists());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn autonomous_report_payload_is_private_and_routes_to_the_agent() {
        let device = StoredMobilePushDevice {
            device_id: Uuid::new_v4().to_string(),
            firebase_installation_id: "firebase-installation-id-long-enough-test".to_string(),
            app_version: None,
            created_at: 1,
            updated_at: 1,
        };
        let agent_id = Uuid::new_v4().to_string();
        let payload = notification_payload(
            &device,
            &MobilePushNotificationJob::AutonomousAgent(MobileAgentNotificationJob {
                agent_id: agent_id.clone(),
                agent_name: "Veille projet".to_string(),
                notification_id: format!("run:{agent_id}:4"),
                content: "La verification est terminee.".to_string(),
                attention_required: false,
            }),
        );

        assert_eq!(
            payload
                .pointer("/message/data/type")
                .and_then(|value| value.as_str()),
            Some("autonomous_agent_report")
        );
        assert_eq!(
            payload
                .pointer("/message/data/agentId")
                .and_then(|value| value.as_str()),
            Some(agent_id.as_str())
        );
        assert_eq!(
            payload
                .pointer("/message/data/content")
                .and_then(|value| value.as_str()),
            Some("La verification est terminee.")
        );
        assert!(payload.pointer("/message/data/paymentId").is_none());
    }

    #[test]
    fn autonomous_attention_payload_has_a_distinct_type() {
        let device = StoredMobilePushDevice {
            device_id: Uuid::new_v4().to_string(),
            firebase_installation_id: "firebase-installation-id-long-enough-alert".to_string(),
            app_version: None,
            created_at: 1,
            updated_at: 1,
        };
        let agent_id = Uuid::new_v4().to_string();
        let payload = notification_payload(
            &device,
            &MobilePushNotificationJob::AutonomousAgent(MobileAgentNotificationJob {
                agent_id,
                agent_name: "Agent".to_string(),
                notification_id: "attention:test".to_string(),
                content: "Intervention requise.".to_string(),
                attention_required: true,
            }),
        );

        assert_eq!(
            payload
                .pointer("/message/data/type")
                .and_then(|value| value.as_str()),
            Some("autonomous_agent_alert")
        );
    }
}
