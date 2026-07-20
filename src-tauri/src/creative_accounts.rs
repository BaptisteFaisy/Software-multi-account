use chrono::Utc;
use reqwest::{redirect::Policy, Client};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::Path,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use uuid::Uuid;

pub const DESKTOP_CREATIVE_OWNER: &str = "desktop";
pub const ENV_FAL_ACCOUNT_ID: &str = "environment-fal";
const CREATIVE_ACCOUNTS_FILE: &str = "creative-accounts.json";
const MAX_ACCOUNTS_PER_OWNER: usize = 12;
const MAX_LABEL_CHARS: usize = 60;
const MAX_KEY_CHARS: usize = 512;
const FAL_API_BASE_URL: &str = "https://api.fal.ai";

static STORE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreativeAccountView {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub key_hint: String,
    pub is_default: bool,
    pub source: String,
    pub created_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreativeAccountsView {
    pub accounts: Vec<CreativeAccountView>,
    pub default_account_id: Option<String>,
    pub provider: String,
    pub dashboard_url: String,
    pub authentication_note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectCreativeAccountRequest {
    pub label: String,
    pub api_key: String,
    #[serde(default = "default_true")]
    pub make_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreativeAccountIdRequest {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCreativeAccount {
    id: String,
    owner_id: String,
    provider: String,
    label: String,
    api_key: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreativeAccountStore {
    #[serde(default = "store_version")]
    version: u8,
    #[serde(default)]
    accounts: Vec<StoredCreativeAccount>,
    #[serde(default)]
    default_account_ids: HashMap<String, String>,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedFalAccount {
    pub id: String,
    pub api_key: String,
}

fn default_true() -> bool {
    true
}

fn store_version() -> u8 {
    1
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn fal_api_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(candidate) = std::env::var("CST_TEST_FAL_API_BASE_URL") {
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
    FAL_API_BASE_URL.to_string()
}

pub(crate) fn environment_fal_key() -> Option<String> {
    ["CST_FAL_KEY", "FAL_KEY"].into_iter().find_map(|name| {
        std::env::var(name)
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn key_hint(value: &str) -> String {
    let suffix = value.chars().rev().take(4).collect::<Vec<_>>();
    format!("••••{}", suffix.into_iter().rev().collect::<String>())
}

fn validate_label(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || char_count(value) > MAX_LABEL_CHARS
        || value.chars().any(char::is_control)
    {
        return Err(format!(
            "Le nom du compte doit contenir entre 1 et {MAX_LABEL_CHARS} caractères."
        ));
    }
    Ok(value.to_string())
}

fn validate_account_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value == ENV_FAL_ACCOUNT_ID {
        return Ok(value.to_string());
    }
    Uuid::parse_str(value)
        .map(|_| value.to_string())
        .map_err(|_| "Identifiant de compte créatif invalide.".to_string())
}

fn validate_fal_key_shape(value: &str) -> Result<String, String> {
    let value = value.trim();
    let valid = !value.is_empty()
        && value.len() <= MAX_KEY_CHARS
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
        && value
            .split_once(':')
            .map(|(id, secret)| !id.is_empty() && !secret.is_empty())
            .unwrap_or(false);
    if !valid {
        return Err(
            "Clé fal.ai invalide. Copie la clé API complète au format identifiant:secret."
                .to_string(),
        );
    }
    Ok(value.to_string())
}

fn accounts_path() -> Result<std::path::PathBuf, String> {
    crate::settings::runtime_data_path(CREATIVE_ACCOUNTS_FILE)
}

fn load_store_from(path: &Path) -> Result<CreativeAccountStore, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == ErrorKind::NotFound => {
            return Ok(CreativeAccountStore {
                version: store_version(),
                ..CreativeAccountStore::default()
            })
        }
        Err(error) => return Err(format!("Lecture des comptes créatifs impossible : {error}")),
    };
    let mut store = serde_json::from_str::<CreativeAccountStore>(&content)
        .map_err(|error| format!("Fichier des comptes créatifs invalide : {error}"))?;
    store.version = store_version();
    Ok(store)
}

fn load_store() -> Result<CreativeAccountStore, String> {
    load_store_from(&accounts_path()?)
}

fn persist_store_to(path: &Path, store: &CreativeAccountStore) -> Result<(), String> {
    let content = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("Sérialisation des comptes créatifs impossible : {error}"))?;
    crate::fs_util::atomic_write(path, content)
        .map_err(|error| format!("Écriture des comptes créatifs impossible : {error}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|error| {
            format!("Protection du fichier des comptes créatifs impossible : {error}")
        })?;
    }
    Ok(())
}

fn persist_store(store: &CreativeAccountStore) -> Result<(), String> {
    persist_store_to(&accounts_path()?, store)
}

fn lock_store() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    STORE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "Verrou des comptes créatifs indisponible.".to_string())
}

fn effective_default_id(
    store: &CreativeAccountStore,
    owner_id: &str,
    has_environment_key: bool,
) -> Option<String> {
    if let Some(id) = store.default_account_ids.get(owner_id) {
        let exists = (id == ENV_FAL_ACCOUNT_ID && has_environment_key)
            || store
                .accounts
                .iter()
                .any(|account| account.owner_id == owner_id && account.id == *id);
        if exists {
            return Some(id.clone());
        }
    }
    store
        .accounts
        .iter()
        .find(|account| account.owner_id == owner_id)
        .map(|account| account.id.clone())
        .or_else(|| has_environment_key.then(|| ENV_FAL_ACCOUNT_ID.to_string()))
}

fn account_views_from_store(
    store: &CreativeAccountStore,
    owner_id: &str,
    environment_key: Option<&str>,
) -> CreativeAccountsView {
    let default_account_id = effective_default_id(store, owner_id, environment_key.is_some());
    let mut accounts = store
        .accounts
        .iter()
        .filter(|account| account.owner_id == owner_id && account.provider == "fal")
        .map(|account| CreativeAccountView {
            id: account.id.clone(),
            provider: "fal".to_string(),
            label: account.label.clone(),
            key_hint: key_hint(&account.api_key),
            is_default: default_account_id.as_deref() == Some(account.id.as_str()),
            source: "stored".to_string(),
            created_at: Some(account.created_at),
        })
        .collect::<Vec<_>>();
    accounts.sort_by(|left, right| {
        right
            .is_default
            .cmp(&left.is_default)
            .then_with(|| left.label.to_lowercase().cmp(&right.label.to_lowercase()))
    });
    if let Some(key) = environment_key {
        accounts.push(CreativeAccountView {
            id: ENV_FAL_ACCOUNT_ID.to_string(),
            provider: "fal".to_string(),
            label: "Compte fal.ai du serveur".to_string(),
            key_hint: key_hint(key),
            is_default: default_account_id.as_deref() == Some(ENV_FAL_ACCOUNT_ID),
            source: "environment".to_string(),
            created_at: None,
        });
    }
    CreativeAccountsView {
        accounts,
        default_account_id,
        provider: "fal.ai".to_string(),
        dashboard_url: "https://fal.ai/dashboard/keys".to_string(),
        authentication_note: "fal.ai utilise des clés API liées à un compte personnel ou d’équipe. Les identifiants Google, Kling, Luma ou Alibaba ne sont jamais demandés par Switch."
            .to_string(),
    }
}

pub(crate) fn creative_accounts_for_owner(owner_id: &str) -> Result<CreativeAccountsView, String> {
    let _guard = lock_store()?;
    let store = load_store()?;
    Ok(account_views_from_store(
        &store,
        owner_id,
        environment_fal_key().as_deref(),
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn creative_accounts() -> Result<CreativeAccountsView, String> {
    creative_accounts_for_owner(DESKTOP_CREATIVE_OWNER)
}

async fn validate_fal_key_remotely(api_key: &str) -> Result<(), String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client fal.ai indisponible : {error}"))?;
    let response = client
        .get(format!("{}/v1/models?limit=1", fal_api_base_url()))
        .header("Authorization", format!("Key {api_key}"))
        .send()
        .await
        .map_err(|error| format!("Validation fal.ai impossible : {}", error.without_url()))?;
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .or_else(|| value.get("detail").and_then(Value::as_str))
                .or_else(|| value.get("message").and_then(Value::as_str))
                .map(str::to_string)
        })
        .unwrap_or_else(|| format!("HTTP {}", status.as_u16()))
        .replace(api_key, "***");
    Err(format!("Connexion fal.ai refusée : {detail}"))
}

pub(crate) async fn connect_creative_account_for_owner(
    owner_id: &str,
    request: ConnectCreativeAccountRequest,
) -> Result<CreativeAccountsView, String> {
    let label = validate_label(&request.label)?;
    let api_key = validate_fal_key_shape(&request.api_key)?;
    validate_fal_key_remotely(&api_key).await?;

    let _guard = lock_store()?;
    let mut store = load_store()?;
    let owner_accounts = store
        .accounts
        .iter()
        .filter(|account| account.owner_id == owner_id)
        .count();
    let had_default =
        effective_default_id(&store, owner_id, environment_fal_key().is_some()).is_some();
    if owner_accounts >= MAX_ACCOUNTS_PER_OWNER {
        return Err(format!(
            "La limite de {MAX_ACCOUNTS_PER_OWNER} comptes créatifs est atteinte."
        ));
    }
    if store
        .accounts
        .iter()
        .any(|account| account.owner_id == owner_id && account.api_key == api_key)
    {
        return Err("Cette clé fal.ai est déjà connectée.".to_string());
    }
    let now = Utc::now().timestamp();
    let id = Uuid::new_v4().to_string();
    store.accounts.push(StoredCreativeAccount {
        id: id.clone(),
        owner_id: owner_id.to_string(),
        provider: "fal".to_string(),
        label,
        api_key,
        created_at: now,
        updated_at: now,
    });
    if request.make_default || !had_default {
        store.default_account_ids.insert(owner_id.to_string(), id);
    }
    persist_store(&store)?;
    Ok(account_views_from_store(
        &store,
        owner_id,
        environment_fal_key().as_deref(),
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn connect_creative_account(
    request: ConnectCreativeAccountRequest,
) -> Result<CreativeAccountsView, String> {
    connect_creative_account_for_owner(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) fn delete_creative_account_for_owner(
    owner_id: &str,
    request: CreativeAccountIdRequest,
) -> Result<CreativeAccountsView, String> {
    let account_id = validate_account_id(&request.account_id)?;
    if account_id == ENV_FAL_ACCOUNT_ID {
        return Err(
            "Le compte fourni par l’environnement se retire dans la configuration du serveur."
                .to_string(),
        );
    }
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let previous_len = store.accounts.len();
    store
        .accounts
        .retain(|account| !(account.owner_id == owner_id && account.id == account_id));
    if store.accounts.len() == previous_len {
        return Err("Compte créatif introuvable.".to_string());
    }
    if store.default_account_ids.get(owner_id) == Some(&account_id) {
        store.default_account_ids.remove(owner_id);
    }
    let next_default = effective_default_id(&store, owner_id, environment_fal_key().is_some());
    if let Some(next_default) = next_default {
        store
            .default_account_ids
            .insert(owner_id.to_string(), next_default);
    }
    persist_store(&store)?;
    Ok(account_views_from_store(
        &store,
        owner_id,
        environment_fal_key().as_deref(),
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn delete_creative_account(
    request: CreativeAccountIdRequest,
) -> Result<CreativeAccountsView, String> {
    delete_creative_account_for_owner(DESKTOP_CREATIVE_OWNER, request)
}

pub(crate) fn set_default_creative_account_for_owner(
    owner_id: &str,
    request: CreativeAccountIdRequest,
) -> Result<CreativeAccountsView, String> {
    let account_id = validate_account_id(&request.account_id)?;
    let _guard = lock_store()?;
    let mut store = load_store()?;
    let exists = (account_id == ENV_FAL_ACCOUNT_ID && environment_fal_key().is_some())
        || store
            .accounts
            .iter()
            .any(|account| account.owner_id == owner_id && account.id == account_id);
    if !exists {
        return Err("Compte créatif introuvable.".to_string());
    }
    store
        .default_account_ids
        .insert(owner_id.to_string(), account_id);
    persist_store(&store)?;
    Ok(account_views_from_store(
        &store,
        owner_id,
        environment_fal_key().as_deref(),
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn set_default_creative_account(
    request: CreativeAccountIdRequest,
) -> Result<CreativeAccountsView, String> {
    set_default_creative_account_for_owner(DESKTOP_CREATIVE_OWNER, request)
}

pub(crate) fn resolve_fal_account(
    owner_id: &str,
    requested_account_id: Option<&str>,
) -> Result<ResolvedFalAccount, String> {
    let _guard = lock_store()?;
    let store = load_store()?;
    let environment_key = environment_fal_key();
    let account_id = match requested_account_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(account_id) => validate_account_id(account_id)?,
        None => {
            effective_default_id(&store, owner_id, environment_key.is_some()).ok_or_else(|| {
                "Aucun compte fal.ai connecté. Ajoute une clé API depuis le studio créatif."
                    .to_string()
            })?
        }
    };
    if account_id == ENV_FAL_ACCOUNT_ID {
        return environment_key
            .map(|api_key| ResolvedFalAccount {
                id: account_id,
                api_key,
            })
            .ok_or_else(|| "Le compte fal.ai du serveur n’est plus configuré.".to_string());
    }
    store
        .accounts
        .iter()
        .find(|account| account.owner_id == owner_id && account.id == account_id)
        .map(|account| ResolvedFalAccount {
            id: account.id.clone(),
            api_key: account.api_key.clone(),
        })
        .ok_or_else(|| {
            "Compte fal.ai introuvable ou non autorisé pour cet utilisateur.".to_string()
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store_with_account() -> CreativeAccountStore {
        CreativeAccountStore {
            version: store_version(),
            accounts: vec![StoredCreativeAccount {
                id: "11111111-1111-4111-8111-111111111111".to_string(),
                owner_id: "owner-a".to_string(),
                provider: "fal".to_string(),
                label: "Production".to_string(),
                api_key: "key-id:super-secret-value".to_string(),
                created_at: 1,
                updated_at: 1,
            }],
            default_account_ids: HashMap::from([(
                "owner-a".to_string(),
                "11111111-1111-4111-8111-111111111111".to_string(),
            )]),
        }
    }

    #[test]
    fn key_shape_requires_the_documented_id_secret_pair() {
        assert!(validate_fal_key_shape("key-id:secret").is_ok());
        assert!(validate_fal_key_shape("missing-separator").is_err());
        assert!(validate_fal_key_shape("id:").is_err());
        assert!(validate_fal_key_shape("id:secret with spaces").is_err());
    }

    #[test]
    fn account_views_never_expose_the_secret() {
        let view = account_views_from_store(&store_with_account(), "owner-a", None);
        let json = serde_json::to_string(&view).unwrap();
        assert!(json.contains("Production"));
        assert!(json.contains("alue"));
        assert!(!json.contains("super-secret-value"));
        assert!(!json.contains("apiKey"));
    }

    #[test]
    fn owners_only_see_their_own_accounts() {
        let store = store_with_account();
        let owner = account_views_from_store(&store, "owner-a", None);
        let stranger = account_views_from_store(&store, "owner-b", None);
        assert_eq!(owner.accounts.len(), 1);
        assert!(stranger.accounts.is_empty());
    }

    #[test]
    fn environment_account_is_a_non_secret_fallback() {
        let view = account_views_from_store(
            &CreativeAccountStore::default(),
            "owner-a",
            Some("env-key:abcd1234"),
        );
        assert_eq!(view.default_account_id.as_deref(), Some(ENV_FAL_ACCOUNT_ID));
        assert_eq!(view.accounts[0].source, "environment");
        assert_eq!(view.accounts[0].key_hint, "••••1234");
    }
}
