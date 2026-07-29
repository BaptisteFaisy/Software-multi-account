//! Pont persistant entre les outils de chat du VPS et l'agent TikMatrix local.
//!
//! Le serveur ne connait jamais le port TikMatrix du poste Windows. Il conserve
//! seulement des campagnes confirmees. Le client desktop, deja authentifie au
//! VPS, reclame une campagne, prepare les fichiers locaux attendus par
//! TikMatrix, puis soumet la tache a son agent loopback.

use crate::{fs_util, metrics};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[cfg(feature = "desktop")]
use serde_json::{json, Map, Value};
#[cfg(feature = "desktop")]
use std::{collections::HashMap, time::Duration};

const STORE_VERSION: u32 = 1;
pub const MAX_TIKTOK_DM_RECIPIENTS: usize = 5;
pub const MAX_TIKTOK_DM_MESSAGE_CHARS: usize = 500;
// TikMatrix exposes a 1..=1000 input in Scrape Users. TikTok may still expose
// only about 50 visible followers, so this is a requested maximum rather than
// a promise that every follower will be returned.
pub const MAX_TIKTOK_FOLLOWER_RESULTS: usize = 1_000;
const MAX_TIKTOK_DM_CAMPAIGNS: usize = 500;
const MAX_TIKTOK_FOLLOWER_EXTRACTIONS: usize = 500;
const MAX_IDEMPOTENCY_KEY_CHARS: usize = 160;
const MIN_INTERVAL_MINUTES: u8 = 1;
const MAX_INTERVAL_MINUTES: u8 = 10;
const CLAIM_LEASE_SECONDS: i64 = 120;
const CONNECTOR_STALE_SECONDS: i64 = 30;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TikTokDmCampaignStatus {
    Draft,
    Queued,
    Claimed,
    Submitted,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TikTokDmCampaign {
    pub id: String,
    pub owner_id: String,
    pub recipients: Vec<String>,
    pub message: String,
    pub status: TikTokDmCampaignStatus,
    pub min_interval_minutes: u8,
    pub max_interval_minutes: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_serial: Option<String>,
    pub owned_accounts_confirmed: bool,
    pub send_confirmed: bool,
    pub created_by: String,
    pub idempotency_key: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claim_token: Option<String>,
    #[serde(default)]
    pub tikmatrix_task_count: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrepareTikTokDmCampaignRequest {
    pub recipients: Vec<String>,
    pub message: String,
    #[serde(default = "default_min_interval_minutes")]
    pub min_interval_minutes: u8,
    #[serde(default = "default_max_interval_minutes")]
    pub max_interval_minutes: u8,
    #[serde(default)]
    pub device_serial: Option<String>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmTikTokDmCampaignRequest {
    pub campaign_id: String,
    #[serde(default)]
    pub owned_accounts_confirmed: bool,
    #[serde(default)]
    pub send_confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TikTokConnectorStatus {
    pub connector_id: String,
    pub last_seen_at: i64,
    pub agent_healthy: bool,
    pub device_serials: Vec<String>,
    pub account_count: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_campaign_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl TikTokConnectorStatus {
    pub fn is_online(&self, now: i64) -> bool {
        self.last_seen_at
            .saturating_add(CONNECTOR_STALE_SECONDS)
            .ge(&now)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokConnectorHeartbeatRequest {
    pub connector_id: String,
    pub agent_healthy: bool,
    #[serde(default)]
    pub device_serials: Vec<String>,
    #[serde(default)]
    pub account_count: usize,
    #[serde(default)]
    pub current_campaign_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokConnectorJob {
    pub campaign_id: String,
    pub claim_token: String,
    pub recipients: Vec<String>,
    pub message: String,
    pub min_interval_minutes: u8,
    pub max_interval_minutes: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_serial: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokConnectorClaimRequest {
    pub connector_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokConnectorReportRequest {
    pub connector_id: String,
    pub campaign_id: String,
    pub claim_token: String,
    pub success: bool,
    #[serde(default)]
    pub tikmatrix_task_count: u64,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TikTokFollowerExtractionStatus {
    Queued,
    Claimed,
    Submitted,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerDmPipeline {
    pub owned_recipient_allowlist: Vec<String>,
    pub message: String,
    pub owned_accounts_confirmed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prepared_campaign_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerDmPipelineRequest {
    pub owned_recipient_allowlist: Vec<String>,
    pub message: String,
    #[serde(default)]
    pub owned_accounts_confirmed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerExtraction {
    pub id: String,
    pub owner_id: String,
    pub target_username: String,
    pub max_count: u16,
    pub status: TikTokFollowerExtractionStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_serial: Option<String>,
    pub authorized_account_confirmed: bool,
    pub created_by: String,
    pub idempotency_key: String,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claimed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub submitted_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub connector_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    claim_token: Option<String>,
    #[serde(default)]
    pub tikmatrix_task_count: u64,
    #[serde(default)]
    pub usernames: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dm_pipeline: Option<TikTokFollowerDmPipeline>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueTikTokFollowerExtractionRequest {
    pub target_username: String,
    #[serde(default = "default_follower_max_count")]
    pub max_count: u16,
    #[serde(default)]
    pub device_serial: Option<String>,
    #[serde(default)]
    pub authorized_account_confirmed: bool,
    #[serde(default)]
    pub dm_pipeline: Option<TikTokFollowerDmPipelineRequest>,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerConnectorJob {
    pub extraction_id: String,
    pub claim_token: String,
    pub target_username: String,
    pub max_count: u16,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device_serial: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerSubmissionReportRequest {
    pub connector_id: String,
    pub extraction_id: String,
    pub claim_token: String,
    pub success: bool,
    #[serde(default)]
    pub tikmatrix_task_count: u64,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerPendingResult {
    pub extraction_id: String,
    pub target_username: String,
    pub max_count: u16,
    pub submitted_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TikTokFollowerResultReportRequest {
    pub connector_id: String,
    pub extraction_id: String,
    pub success: bool,
    #[serde(default)]
    pub usernames: Vec<String>,
    #[serde(default)]
    pub output_file: Option<String>,
    #[serde(default)]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct TikTokDmStore {
    version: u32,
    #[serde(default)]
    campaigns: Vec<TikTokDmCampaign>,
    #[serde(default)]
    follower_extractions: Vec<TikTokFollowerExtraction>,
}

impl Default for TikTokDmStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            campaigns: Vec::new(),
            follower_extractions: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TikTokDmError {
    Validation(String),
    NotFound,
    Conflict(String),
    Internal(String),
}

impl fmt::Display for TikTokDmError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message) | Self::Conflict(message) | Self::Internal(message) => {
                formatter.write_str(message)
            }
            Self::NotFound => formatter.write_str("Campagne TikTok introuvable"),
        }
    }
}

impl std::error::Error for TikTokDmError {}

#[derive(Clone)]
pub struct TikTokDmManager {
    inner: Arc<TikTokDmInner>,
}

struct TikTokDmInner {
    storage_path: PathBuf,
    store: Mutex<TikTokDmStore>,
    connector: Mutex<Option<TikTokConnectorStatus>>,
}

impl TikTokDmManager {
    pub fn new(storage_path: PathBuf) -> Result<Self, String> {
        let store = load_store(&storage_path).map_err(|error| error.to_string())?;
        Ok(Self {
            inner: Arc::new(TikTokDmInner {
                storage_path,
                store: Mutex::new(store),
                connector: Mutex::new(None),
            }),
        })
    }

    pub fn prepare(
        &self,
        owner_id: &str,
        request: PrepareTikTokDmCampaignRequest,
        created_by: &str,
    ) -> Result<TikTokDmCampaign, TikTokDmError> {
        let owner_id = validate_owner_id(owner_id)?;
        let recipients = validate_recipients(request.recipients)?;
        let message = validate_message(request.message)?;
        let idempotency_key = validate_idempotency_key(&request.idempotency_key)?;
        validate_intervals(request.min_interval_minutes, request.max_interval_minutes)?;
        let device_serial = request
            .device_serial
            .as_deref()
            .map(validate_device_serial)
            .transpose()?;

        let mut current = self.lock_store()?;
        if let Some(existing) = current.campaigns.iter().find(|campaign| {
            campaign.owner_id == owner_id && campaign.idempotency_key == idempotency_key
        }) {
            return Ok(existing.clone());
        }
        if current.campaigns.len() >= MAX_TIKTOK_DM_CAMPAIGNS {
            return Err(TikTokDmError::Validation(
                "La limite de campagnes TikTok archivees est atteinte".to_string(),
            ));
        }
        let now = metrics::now_ts();
        let campaign = TikTokDmCampaign {
            id: Uuid::new_v4().to_string(),
            owner_id,
            recipients,
            message,
            status: TikTokDmCampaignStatus::Draft,
            min_interval_minutes: request.min_interval_minutes,
            max_interval_minutes: request.max_interval_minutes,
            device_serial,
            owned_accounts_confirmed: false,
            send_confirmed: false,
            created_by: normalize_creator(created_by),
            idempotency_key,
            created_at: now,
            updated_at: now,
            confirmed_at: None,
            claimed_at: None,
            submitted_at: None,
            connector_id: None,
            claim_token: None,
            tikmatrix_task_count: 0,
            error: None,
        };
        let mut next = current.clone();
        next.campaigns.push(campaign.clone());
        self.persist_and_replace(&mut current, next)?;
        Ok(campaign)
    }

    pub fn confirm(
        &self,
        owner_id: &str,
        request: ConfirmTikTokDmCampaignRequest,
    ) -> Result<TikTokDmCampaign, TikTokDmError> {
        if !request.owned_accounts_confirmed || !request.send_confirmed {
            return Err(TikTokDmError::Validation(
                "Confirmez que tous les destinataires sont vos comptes de test et que l'envoi est autorise"
                    .to_string(),
            ));
        }
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let campaign = next
            .campaigns
            .iter_mut()
            .find(|campaign| campaign.id == request.campaign_id && campaign.owner_id == owner_id)
            .ok_or(TikTokDmError::NotFound)?;
        if campaign.status != TikTokDmCampaignStatus::Draft
            && campaign.owned_accounts_confirmed
            && campaign.send_confirmed
        {
            return Ok(campaign.clone());
        }
        if campaign.status != TikTokDmCampaignStatus::Draft {
            return Err(TikTokDmError::Conflict(
                "Seul un brouillon TikTok peut etre confirme".to_string(),
            ));
        }
        let now = metrics::now_ts();
        campaign.owned_accounts_confirmed = true;
        campaign.send_confirmed = true;
        campaign.confirmed_at = Some(now);
        campaign.updated_at = now;
        campaign.status = TikTokDmCampaignStatus::Queued;
        campaign.error = None;
        let result = campaign.clone();
        self.persist_and_replace(&mut current, next)?;
        Ok(result)
    }

    pub fn list(&self, owner_id: &str) -> Result<Vec<TikTokDmCampaign>, TikTokDmError> {
        let store = self.lock_store()?;
        let mut campaigns = store
            .campaigns
            .iter()
            .filter(|campaign| campaign.owner_id == owner_id)
            .cloned()
            .collect::<Vec<_>>();
        campaigns.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(campaigns)
    }

    pub fn connector_status(&self) -> Result<Option<TikTokConnectorStatus>, TikTokDmError> {
        let connector =
            self.inner.connector.lock().map_err(|_| {
                TikTokDmError::Internal("Etat du connecteur verrouille".to_string())
            })?;
        Ok(connector.clone())
    }

    pub fn heartbeat(
        &self,
        request: TikTokConnectorHeartbeatRequest,
    ) -> Result<TikTokConnectorStatus, TikTokDmError> {
        let connector_id = validate_connector_id(&request.connector_id)?;
        let mut device_serials = request
            .device_serials
            .into_iter()
            .map(|serial| validate_device_serial(&serial))
            .collect::<Result<Vec<_>, _>>()?;
        device_serials.sort();
        device_serials.dedup();
        let status = TikTokConnectorStatus {
            connector_id,
            last_seen_at: metrics::now_ts(),
            agent_healthy: request.agent_healthy,
            device_serials,
            account_count: request.account_count.min(100),
            current_campaign_id: request
                .current_campaign_id
                .map(|value| validate_campaign_id(&value))
                .transpose()?,
            error: sanitize_detail(request.error),
        };
        let mut connector =
            self.inner.connector.lock().map_err(|_| {
                TikTokDmError::Internal("Etat du connecteur verrouille".to_string())
            })?;
        *connector = Some(status.clone());
        Ok(status)
    }

    pub fn claim_next(
        &self,
        connector_id: &str,
    ) -> Result<Option<TikTokConnectorJob>, TikTokDmError> {
        let connector_id = validate_connector_id(connector_id)?;
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let now = metrics::now_ts();
        for campaign in &mut next.campaigns {
            if campaign.status == TikTokDmCampaignStatus::Claimed
                && campaign
                    .claimed_at
                    .is_some_and(|claimed| claimed.saturating_add(CLAIM_LEASE_SECONDS) <= now)
            {
                campaign.status = TikTokDmCampaignStatus::Queued;
                campaign.claimed_at = None;
                campaign.connector_id = None;
                campaign.claim_token = None;
                campaign.updated_at = now;
                campaign.error = Some(
                    "Le connecteur precedent n'a pas confirme la soumission ; reprise securisee"
                        .to_string(),
                );
            }
        }
        let job = next
            .campaigns
            .iter_mut()
            .find(|campaign| campaign.status == TikTokDmCampaignStatus::Queued)
            .map(|campaign| {
                let claim_token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
                campaign.status = TikTokDmCampaignStatus::Claimed;
                campaign.claimed_at = Some(now);
                campaign.updated_at = now;
                campaign.connector_id = Some(connector_id);
                campaign.claim_token = Some(claim_token.clone());
                campaign.error = None;
                TikTokConnectorJob {
                    campaign_id: campaign.id.clone(),
                    claim_token,
                    recipients: campaign.recipients.clone(),
                    message: campaign.message.clone(),
                    min_interval_minutes: campaign.min_interval_minutes,
                    max_interval_minutes: campaign.max_interval_minutes,
                    device_serial: campaign.device_serial.clone(),
                }
            });
        if next != *current {
            self.persist_and_replace(&mut current, next)?;
        }
        Ok(job)
    }

    pub fn report(
        &self,
        request: TikTokConnectorReportRequest,
    ) -> Result<TikTokDmCampaign, TikTokDmError> {
        let connector_id = validate_connector_id(&request.connector_id)?;
        let campaign_id = validate_campaign_id(&request.campaign_id)?;
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let campaign = next
            .campaigns
            .iter_mut()
            .find(|campaign| campaign.id == campaign_id)
            .ok_or(TikTokDmError::NotFound)?;

        // Une reponse identique est acceptee : le client conserve un recu
        // local apres l'appel TikMatrix et peut devoir le renvoyer apres une
        // coupure reseau.
        if campaign.status == TikTokDmCampaignStatus::Submitted && request.success {
            return Ok(campaign.clone());
        }
        if campaign.status != TikTokDmCampaignStatus::Claimed
            || campaign.connector_id.as_deref() != Some(connector_id.as_str())
            || campaign.claim_token.as_deref() != Some(request.claim_token.trim())
        {
            return Err(TikTokDmError::Conflict(
                "Lease du connecteur absente ou expiree".to_string(),
            ));
        }

        let now = metrics::now_ts();
        campaign.updated_at = now;
        campaign.claim_token = None;
        if request.success {
            campaign.status = TikTokDmCampaignStatus::Submitted;
            campaign.submitted_at = Some(now);
            campaign.tikmatrix_task_count = request.tikmatrix_task_count;
            campaign.error = None;
        } else {
            campaign.status = TikTokDmCampaignStatus::Failed;
            campaign.error = Some(
                sanitize_detail(request.detail)
                    .unwrap_or_else(|| "Soumission TikMatrix impossible".to_string()),
            );
        }
        let result = campaign.clone();
        self.persist_and_replace(&mut current, next)?;
        Ok(result)
    }

    pub fn queue_follower_extraction(
        &self,
        owner_id: &str,
        request: QueueTikTokFollowerExtractionRequest,
        created_by: &str,
    ) -> Result<TikTokFollowerExtraction, TikTokDmError> {
        if !request.authorized_account_confirmed {
            return Err(TikTokDmError::Validation(
                "Confirmez que le compte source vous appartient ou que vous etes autorise a en extraire les followers"
                    .to_string(),
            ));
        }
        let owner_id = validate_owner_id(owner_id)?;
        let target_username = normalize_tiktok_username(&request.target_username)?;
        if request.max_count == 0 || usize::from(request.max_count) > MAX_TIKTOK_FOLLOWER_RESULTS {
            return Err(TikTokDmError::Validation(format!(
                "La collecte TikTok doit demander entre 1 et {MAX_TIKTOK_FOLLOWER_RESULTS} followers"
            )));
        }
        let idempotency_key = validate_idempotency_key(&request.idempotency_key)?;
        let device_serial = request
            .device_serial
            .as_deref()
            .map(validate_device_serial)
            .transpose()?;
        let dm_pipeline = request
            .dm_pipeline
            .map(|pipeline| {
                if !pipeline.owned_accounts_confirmed {
                    return Err(TikTokDmError::Validation(
                        "Confirmez que chaque destinataire de test de la liste vous appartient"
                            .to_string(),
                    ));
                }
                Ok(TikTokFollowerDmPipeline {
                    owned_recipient_allowlist: validate_recipients(
                        pipeline.owned_recipient_allowlist,
                    )?,
                    message: validate_message(pipeline.message)?,
                    owned_accounts_confirmed: true,
                    prepared_campaign_id: None,
                    note: None,
                })
            })
            .transpose()?;

        let mut current = self.lock_store()?;
        if let Some(existing) = current.follower_extractions.iter().find(|extraction| {
            extraction.owner_id == owner_id && extraction.idempotency_key == idempotency_key
        }) {
            return Ok(existing.clone());
        }
        if current.follower_extractions.len() >= MAX_TIKTOK_FOLLOWER_EXTRACTIONS {
            return Err(TikTokDmError::Validation(
                "La limite de collectes TikTok archivees est atteinte".to_string(),
            ));
        }
        let now = metrics::now_ts();
        let extraction = TikTokFollowerExtraction {
            id: Uuid::new_v4().to_string(),
            owner_id,
            target_username,
            max_count: request.max_count,
            status: TikTokFollowerExtractionStatus::Queued,
            device_serial,
            authorized_account_confirmed: true,
            created_by: normalize_creator(created_by),
            idempotency_key,
            created_at: now,
            updated_at: now,
            claimed_at: None,
            submitted_at: None,
            completed_at: None,
            connector_id: None,
            claim_token: None,
            tikmatrix_task_count: 0,
            usernames: Vec::new(),
            output_file: None,
            dm_pipeline,
            error: None,
        };
        let mut next = current.clone();
        next.follower_extractions.push(extraction.clone());
        self.persist_and_replace(&mut current, next)?;
        Ok(extraction)
    }

    pub fn list_follower_extractions(
        &self,
        owner_id: &str,
    ) -> Result<Vec<TikTokFollowerExtraction>, TikTokDmError> {
        let store = self.lock_store()?;
        let mut extractions = store
            .follower_extractions
            .iter()
            .filter(|extraction| extraction.owner_id == owner_id)
            .cloned()
            .collect::<Vec<_>>();
        extractions.sort_by(|left, right| {
            right
                .created_at
                .cmp(&left.created_at)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(extractions)
    }

    pub fn claim_next_follower_extraction(
        &self,
        connector_id: &str,
    ) -> Result<Option<TikTokFollowerConnectorJob>, TikTokDmError> {
        let connector_id = validate_connector_id(connector_id)?;
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let now = metrics::now_ts();
        for extraction in &mut next.follower_extractions {
            if extraction.status == TikTokFollowerExtractionStatus::Claimed
                && extraction
                    .claimed_at
                    .is_some_and(|claimed| claimed.saturating_add(CLAIM_LEASE_SECONDS) <= now)
            {
                extraction.status = TikTokFollowerExtractionStatus::Queued;
                extraction.claimed_at = None;
                extraction.connector_id = None;
                extraction.claim_token = None;
                extraction.updated_at = now;
                extraction.error = Some(
                    "Le connecteur precedent n'a pas confirme la collecte ; reprise securisee"
                        .to_string(),
                );
            }
        }
        let job = next
            .follower_extractions
            .iter_mut()
            .find(|extraction| extraction.status == TikTokFollowerExtractionStatus::Queued)
            .map(|extraction| {
                let claim_token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
                extraction.status = TikTokFollowerExtractionStatus::Claimed;
                extraction.claimed_at = Some(now);
                extraction.updated_at = now;
                extraction.connector_id = Some(connector_id);
                extraction.claim_token = Some(claim_token.clone());
                extraction.error = None;
                TikTokFollowerConnectorJob {
                    extraction_id: extraction.id.clone(),
                    claim_token,
                    target_username: extraction.target_username.clone(),
                    max_count: extraction.max_count,
                    device_serial: extraction.device_serial.clone(),
                }
            });
        if next != *current {
            self.persist_and_replace(&mut current, next)?;
        }
        Ok(job)
    }

    pub fn report_follower_submission(
        &self,
        request: TikTokFollowerSubmissionReportRequest,
    ) -> Result<TikTokFollowerExtraction, TikTokDmError> {
        let connector_id = validate_connector_id(&request.connector_id)?;
        let extraction_id = validate_campaign_id(&request.extraction_id)?;
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let extraction = next
            .follower_extractions
            .iter_mut()
            .find(|extraction| extraction.id == extraction_id)
            .ok_or(TikTokDmError::NotFound)?;
        if matches!(
            extraction.status,
            TikTokFollowerExtractionStatus::Submitted | TikTokFollowerExtractionStatus::Completed
        ) && request.success
        {
            return Ok(extraction.clone());
        }
        if extraction.status != TikTokFollowerExtractionStatus::Claimed
            || extraction.connector_id.as_deref() != Some(connector_id.as_str())
            || extraction.claim_token.as_deref() != Some(request.claim_token.trim())
        {
            return Err(TikTokDmError::Conflict(
                "Lease de collecte TikTok absente ou expiree".to_string(),
            ));
        }
        let now = metrics::now_ts();
        extraction.updated_at = now;
        extraction.claim_token = None;
        if request.success {
            extraction.status = TikTokFollowerExtractionStatus::Submitted;
            extraction.submitted_at = Some(now);
            extraction.tikmatrix_task_count = request.tikmatrix_task_count;
            extraction.error = None;
        } else {
            extraction.status = TikTokFollowerExtractionStatus::Failed;
            extraction.error =
                Some(sanitize_detail(request.detail).unwrap_or_else(|| {
                    "Soumission de la collecte TikMatrix impossible".to_string()
                }));
        }
        let result = extraction.clone();
        self.persist_and_replace(&mut current, next)?;
        Ok(result)
    }

    pub fn pending_follower_results(
        &self,
        connector_id: &str,
    ) -> Result<Vec<TikTokFollowerPendingResult>, TikTokDmError> {
        let connector_id = validate_connector_id(connector_id)?;
        let store = self.lock_store()?;
        Ok(store
            .follower_extractions
            .iter()
            .filter(|extraction| {
                extraction.status == TikTokFollowerExtractionStatus::Submitted
                    && extraction.connector_id.as_deref() == Some(connector_id.as_str())
            })
            .filter_map(|extraction| {
                Some(TikTokFollowerPendingResult {
                    extraction_id: extraction.id.clone(),
                    target_username: extraction.target_username.clone(),
                    max_count: extraction.max_count,
                    submitted_at: extraction.submitted_at?,
                })
            })
            .take(10)
            .collect())
    }

    pub fn report_follower_result(
        &self,
        request: TikTokFollowerResultReportRequest,
    ) -> Result<TikTokFollowerExtraction, TikTokDmError> {
        let connector_id = validate_connector_id(&request.connector_id)?;
        let extraction_id = validate_campaign_id(&request.extraction_id)?;
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let can_prepare_campaign = next.campaigns.len() < MAX_TIKTOK_DM_CAMPAIGNS;
        let mut prepared_campaign = None;
        let extraction = next
            .follower_extractions
            .iter_mut()
            .find(|extraction| extraction.id == extraction_id)
            .ok_or(TikTokDmError::NotFound)?;
        if extraction.status == TikTokFollowerExtractionStatus::Completed && request.success {
            return Ok(extraction.clone());
        }
        if extraction.status != TikTokFollowerExtractionStatus::Submitted
            || extraction.connector_id.as_deref() != Some(connector_id.as_str())
        {
            return Err(TikTokDmError::Conflict(
                "Collecte TikTok non soumise par ce connecteur".to_string(),
            ));
        }
        let now = metrics::now_ts();
        extraction.updated_at = now;
        if request.success {
            let mut seen = HashSet::new();
            let mut usernames = Vec::new();
            for value in request.usernames {
                let username = normalize_tiktok_username(&value)?;
                if seen.insert(username.to_ascii_lowercase()) {
                    usernames.push(username);
                }
                if usernames.len() >= usize::from(extraction.max_count) {
                    break;
                }
            }
            extraction.status = TikTokFollowerExtractionStatus::Completed;
            extraction.completed_at = Some(now);
            extraction.usernames = usernames;
            extraction.output_file = sanitize_output_file(request.output_file);
            extraction.error = None;
            let available = extraction
                .usernames
                .iter()
                .map(|username| username.to_ascii_lowercase())
                .collect::<HashSet<_>>();
            let owner_id = extraction.owner_id.clone();
            let device_serial = extraction.device_serial.clone();
            let extraction_id = extraction.id.clone();
            if let Some(pipeline) = extraction.dm_pipeline.as_mut() {
                let recipients = pipeline
                    .owned_recipient_allowlist
                    .iter()
                    .filter(|username| available.contains(&username.to_ascii_lowercase()))
                    .cloned()
                    .collect::<Vec<_>>();
                if recipients.is_empty() {
                    pipeline.note = Some(
                        "Aucun compte secondaire controle de la liste autorisee n'apparait dans le resultat ; aucun brouillon de message n'a ete cree."
                            .to_string(),
                    );
                } else if !can_prepare_campaign {
                    pipeline.note = Some(
                        "La collecte est terminee, mais la limite de campagnes TikTok archivees empeche de creer le brouillon."
                            .to_string(),
                    );
                } else {
                    let campaign_id = Uuid::new_v4().to_string();
                    pipeline.prepared_campaign_id = Some(campaign_id.clone());
                    pipeline.note = Some(format!(
                        "Brouillon prepare pour {} compte(s) secondaire(s) controle(s). Affichez l'apercu puis demandez une confirmation explicite avant l'envoi.",
                        recipients.len()
                    ));
                    prepared_campaign = Some(TikTokDmCampaign {
                        id: campaign_id,
                        owner_id,
                        recipients,
                        message: pipeline.message.clone(),
                        status: TikTokDmCampaignStatus::Draft,
                        min_interval_minutes: default_min_interval_minutes(),
                        max_interval_minutes: default_max_interval_minutes(),
                        device_serial,
                        owned_accounts_confirmed: true,
                        send_confirmed: false,
                        created_by: "scrape_to_dm_pipeline".to_string(),
                        idempotency_key: format!("scrape-dm:{extraction_id}"),
                        created_at: now,
                        updated_at: now,
                        confirmed_at: None,
                        claimed_at: None,
                        submitted_at: None,
                        connector_id: None,
                        claim_token: None,
                        tikmatrix_task_count: 0,
                        error: None,
                    });
                }
            }
        } else {
            extraction.status = TikTokFollowerExtractionStatus::Failed;
            extraction.error = Some(
                sanitize_detail(request.detail)
                    .unwrap_or_else(|| "Resultat de collecte TikMatrix introuvable".to_string()),
            );
        }
        let result = extraction.clone();
        if let Some(campaign) = prepared_campaign {
            next.campaigns.push(campaign);
        }
        self.persist_and_replace(&mut current, next)?;
        Ok(result)
    }

    fn lock_store(&self) -> Result<std::sync::MutexGuard<'_, TikTokDmStore>, TikTokDmError> {
        self.inner.store.lock().map_err(|_| {
            TikTokDmError::Internal("Etat des campagnes TikTok verrouille".to_string())
        })
    }

    fn persist_and_replace(
        &self,
        current: &mut std::sync::MutexGuard<'_, TikTokDmStore>,
        next: TikTokDmStore,
    ) -> Result<(), TikTokDmError> {
        persist_store(&self.inner.storage_path, &next)?;
        **current = next;
        Ok(())
    }
}

fn default_min_interval_minutes() -> u8 {
    1
}

fn default_max_interval_minutes() -> u8 {
    2
}

fn default_follower_max_count() -> u16 {
    MAX_TIKTOK_FOLLOWER_RESULTS as u16
}

fn validate_owner_id(value: &str) -> Result<String, TikTokDmError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 160 || value.chars().any(char::is_control) {
        return Err(TikTokDmError::Validation(
            "Proprietaire de campagne invalide".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn validate_recipients(values: Vec<String>) -> Result<Vec<String>, TikTokDmError> {
    if values.is_empty() || values.len() > MAX_TIKTOK_DM_RECIPIENTS {
        return Err(TikTokDmError::Validation(format!(
            "Ajoutez entre 1 et {MAX_TIKTOK_DM_RECIPIENTS} comptes TikTok de test"
        )));
    }
    let mut seen = HashSet::new();
    let mut recipients = Vec::with_capacity(values.len());
    for value in values {
        let username = normalize_tiktok_username(&value)?;
        if seen.insert(username.to_ascii_lowercase()) {
            recipients.push(username);
        }
    }
    if recipients.is_empty() {
        return Err(TikTokDmError::Validation(
            "Ajoutez au moins un compte TikTok de test".to_string(),
        ));
    }
    Ok(recipients)
}

fn normalize_tiktok_username(value: &str) -> Result<String, TikTokDmError> {
    let bare = value.trim().trim_start_matches('@');
    if bare.len() < 2
        || bare.len() > 24
        || !bare
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '.'))
    {
        return Err(TikTokDmError::Validation(format!(
            "Nom de compte TikTok invalide : {value}"
        )));
    }
    Ok(format!("@{bare}"))
}

fn validate_message(value: String) -> Result<String, TikTokDmError> {
    let value = value.trim();
    let count = value.chars().count();
    if count == 0 || count > MAX_TIKTOK_DM_MESSAGE_CHARS {
        return Err(TikTokDmError::Validation(format!(
            "Le message TikTok doit contenir entre 1 et {MAX_TIKTOK_DM_MESSAGE_CHARS} caracteres"
        )));
    }
    if value
        .chars()
        .any(|character| matches!(character, '\r' | '\n'))
    {
        return Err(TikTokDmError::Validation(
            "Le premier connecteur TikTok accepte un message sur une seule ligne".to_string(),
        ));
    }
    if value.chars().any(|character| character.is_control()) {
        return Err(TikTokDmError::Validation(
            "Le message TikTok contient un caractere de controle".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn validate_intervals(minimum: u8, maximum: u8) -> Result<(), TikTokDmError> {
    if minimum < MIN_INTERVAL_MINUTES || maximum > MAX_INTERVAL_MINUTES || minimum > maximum {
        return Err(TikTokDmError::Validation(format!(
            "La cadence TikTok doit etre comprise entre {MIN_INTERVAL_MINUTES} et {MAX_INTERVAL_MINUTES} minutes"
        )));
    }
    Ok(())
}

fn validate_idempotency_key(value: &str) -> Result<String, TikTokDmError> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > MAX_IDEMPOTENCY_KEY_CHARS
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
    {
        return Err(TikTokDmError::Validation(
            "Cle d'idempotence TikTok invalide".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn validate_device_serial(value: &str) -> Result<String, TikTokDmError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 96
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
    {
        return Err(TikTokDmError::Validation(
            "Identifiant d'appareil TikMatrix invalide".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn validate_connector_id(value: &str) -> Result<String, TikTokDmError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "._:-".contains(character))
    {
        return Err(TikTokDmError::Validation(
            "Identifiant de connecteur TikMatrix invalide".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn validate_campaign_id(value: &str) -> Result<String, TikTokDmError> {
    Uuid::parse_str(value.trim())
        .map(|uuid| uuid.to_string())
        .map_err(|_| TikTokDmError::Validation("Identifiant de campagne invalide".to_string()))
}

fn normalize_creator(value: &str) -> String {
    match value.trim() {
        "autonomous_agent" => "autonomous_agent".to_string(),
        _ => "human_chat".to_string(),
    }
}

fn sanitize_detail(value: Option<String>) -> Option<String> {
    let value = value?.trim().replace(['\r', '\n'], " ");
    (!value.is_empty()).then(|| value.chars().take(500).collect())
}

fn sanitize_output_file(value: Option<String>) -> Option<String> {
    let value = value?.trim().replace(['\r', '\n'], "");
    (!value.is_empty()).then(|| value.chars().take(260).collect())
}

fn load_store(path: &Path) -> Result<TikTokDmStore, TikTokDmError> {
    if !path.is_file() {
        return Ok(TikTokDmStore::default());
    }
    let bytes = fs::read(path).map_err(|error| {
        TikTokDmError::Internal(format!("Lecture des campagnes TikTok impossible : {error}"))
    })?;
    let store = serde_json::from_slice::<TikTokDmStore>(&bytes).map_err(|error| {
        TikTokDmError::Internal(format!("Campagnes TikTok illisibles : {error}"))
    })?;
    if store.version != STORE_VERSION {
        return Err(TikTokDmError::Internal(
            "Version du stockage TikTok non prise en charge".to_string(),
        ));
    }
    Ok(store)
}

fn persist_store(path: &Path, store: &TikTokDmStore) -> Result<(), TikTokDmError> {
    let bytes = serde_json::to_vec_pretty(store)
        .map_err(|error| TikTokDmError::Internal(error.to_string()))?;
    fs_util::atomic_write(path, bytes).map_err(|error| {
        TikTokDmError::Internal(format!(
            "Ecriture des campagnes TikTok impossible : {error}"
        ))
    })
}

#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct LocalReceiptStore {
    version: u32,
    #[serde(default)]
    receipts: HashMap<String, LocalReceipt>,
    #[serde(default)]
    follower_extractions: HashMap<String, LocalFollowerExtractionReceipt>,
}

#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalReceipt {
    task_count: u64,
    detail: String,
    submitted_at: i64,
}

#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalFollowerExtractionReceipt {
    target_username: String,
    max_count: u16,
    task_count: u64,
    detail: String,
    submitted_at: i64,
    #[serde(default)]
    result_reported: bool,
}

#[cfg(feature = "desktop")]
#[derive(Debug, Clone, Default)]
struct TikMatrixSnapshot {
    agent_healthy: bool,
    device_serials: Vec<String>,
    account_count: usize,
    error: Option<String>,
}

#[cfg(feature = "desktop")]
pub async fn run_tiktok_connector() {
    let startup = crate::client_startup::client_startup_config();
    if !startup.remote_mode {
        return;
    }
    let Some(base_url) = startup
        .base_url
        .map(|value| value.trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
    else {
        return;
    };
    let Some(token) = startup.token.filter(|value| !value.trim().is_empty()) else {
        return;
    };
    let connector_id = format!(
        "windows-{}",
        std::env::var("COMPUTERNAME")
            .unwrap_or_else(|_| "desktop".to_string())
            .chars()
            .filter(|character| character.is_ascii_alphanumeric() || "._-".contains(*character))
            .take(80)
            .collect::<String>()
    );
    let client = match reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(15))
        .build()
    {
        Ok(client) => client,
        Err(error) => {
            eprintln!("Connecteur TikMatrix indisponible : {error}");
            return;
        }
    };
    let receipts_path = match crate::settings::runtime_data_path("tiktok-connector-receipts.json") {
        Ok(path) => path,
        Err(error) => {
            eprintln!("Stockage du connecteur TikMatrix indisponible : {error}");
            return;
        }
    };
    let mut current_campaign_id: Option<String> = None;

    loop {
        let mut submitted_work = false;
        let snapshot = inspect_tikmatrix(&client).await;
        let heartbeat = TikTokConnectorHeartbeatRequest {
            connector_id: connector_id.clone(),
            agent_healthy: snapshot.agent_healthy,
            device_serials: snapshot.device_serials.clone(),
            account_count: snapshot.account_count,
            current_campaign_id: current_campaign_id.clone(),
            error: snapshot.error.clone(),
        };
        let _ = post_server_json::<Value>(
            &client,
            &base_url,
            &token,
            "/api/tiktok/connector/heartbeat",
            &heartbeat,
        )
        .await;

        let claim = post_server_json::<Value>(
            &client,
            &base_url,
            &token,
            "/api/tiktok/connector/jobs/claim",
            &TikTokConnectorClaimRequest {
                connector_id: connector_id.clone(),
            },
        )
        .await;
        if let Ok(value) = claim {
            if let Some(job_value) = value.get("job").filter(|value| !value.is_null()) {
                match serde_json::from_value::<TikTokConnectorJob>(job_value.clone()) {
                    Ok(job) => {
                        current_campaign_id = Some(job.campaign_id.clone());
                        let _ = post_server_json::<Value>(
                            &client,
                            &base_url,
                            &token,
                            "/api/tiktok/connector/heartbeat",
                            &TikTokConnectorHeartbeatRequest {
                                connector_id: connector_id.clone(),
                                agent_healthy: snapshot.agent_healthy,
                                device_serials: snapshot.device_serials.clone(),
                                account_count: snapshot.account_count,
                                current_campaign_id: current_campaign_id.clone(),
                                error: snapshot.error.clone(),
                            },
                        )
                        .await;
                        let report =
                            process_tiktok_job(&client, &receipts_path, &connector_id, &job).await;
                        let _ = post_server_json::<Value>(
                            &client,
                            &base_url,
                            &token,
                            "/api/tiktok/connector/jobs/report",
                            &report,
                        )
                        .await;
                        current_campaign_id = None;
                        submitted_work = true;
                    }
                    Err(error) => {
                        eprintln!("Travail TikTok invalide recu du VPS : {error}");
                    }
                }
            }
        }
        if !submitted_work {
            let claim = post_server_json::<Value>(
                &client,
                &base_url,
                &token,
                "/api/tiktok/connector/follower-extractions/claim",
                &TikTokConnectorClaimRequest {
                    connector_id: connector_id.clone(),
                },
            )
            .await;
            if let Ok(value) = claim {
                if let Some(job_value) = value.get("job").filter(|value| !value.is_null()) {
                    match serde_json::from_value::<TikTokFollowerConnectorJob>(job_value.clone()) {
                        Ok(job) => {
                            current_campaign_id = Some(job.extraction_id.clone());
                            let _ = post_server_json::<Value>(
                                &client,
                                &base_url,
                                &token,
                                "/api/tiktok/connector/heartbeat",
                                &TikTokConnectorHeartbeatRequest {
                                    connector_id: connector_id.clone(),
                                    agent_healthy: snapshot.agent_healthy,
                                    device_serials: snapshot.device_serials.clone(),
                                    account_count: snapshot.account_count,
                                    current_campaign_id: current_campaign_id.clone(),
                                    error: snapshot.error.clone(),
                                },
                            )
                            .await;
                            let report = process_tiktok_follower_job(
                                &client,
                                &receipts_path,
                                &connector_id,
                                &job,
                            )
                            .await;
                            let _ = post_server_json::<Value>(
                                &client,
                                &base_url,
                                &token,
                                "/api/tiktok/connector/follower-extractions/report",
                                &report,
                            )
                            .await;
                            current_campaign_id = None;
                        }
                        Err(error) => {
                            eprintln!("Collecte TikTok invalide recue du VPS : {error}");
                        }
                    }
                }
            }
        }
        sync_follower_results(&client, &base_url, &token, &receipts_path, &connector_id).await;
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
}

#[cfg(feature = "desktop")]
async fn post_server_json<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    path: &str,
    body: &impl Serialize,
) -> Result<T, String> {
    let response = client
        .post(format!("{base_url}{path}"))
        .bearer_auth(token.trim())
        .json(body)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!(
            "VPS {} : {}",
            status.as_u16(),
            String::from_utf8_lossy(&bytes)
                .chars()
                .take(300)
                .collect::<String>()
        ));
    }
    serde_json::from_slice(&bytes).map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
async fn inspect_tikmatrix(client: &reqwest::Client) -> TikMatrixSnapshot {
    let port = match tikmatrix_port() {
        Ok(port) => port,
        Err(error) => {
            return TikMatrixSnapshot {
                error: Some(error),
                ..TikMatrixSnapshot::default()
            }
        }
    };
    let base = format!("http://127.0.0.1:{port}");
    let devices = match get_tikmatrix_json(client, &base, "/api/device").await {
        Ok(value) => value,
        Err(error) => {
            return TikMatrixSnapshot {
                error: Some(error),
                ..TikMatrixSnapshot::default()
            }
        }
    };
    let accounts = match get_tikmatrix_json(client, &base, "/api/account").await {
        Ok(value) => value,
        Err(error) => {
            return TikMatrixSnapshot {
                agent_healthy: true,
                error: Some(error),
                ..TikMatrixSnapshot::default()
            }
        }
    };
    TikMatrixSnapshot {
        agent_healthy: true,
        device_serials: data_array(&devices)
            .iter()
            .filter(|device| device.get("status").and_then(Value::as_str) == Some("device"))
            .filter_map(|device| device.get("serial").and_then(Value::as_str))
            .map(str::to_string)
            .collect(),
        account_count: data_array(&accounts).len(),
        error: None,
    }
}

#[cfg(feature = "desktop")]
async fn process_tiktok_follower_job(
    client: &reqwest::Client,
    receipts_path: &Path,
    connector_id: &str,
    job: &TikTokFollowerConnectorJob,
) -> TikTokFollowerSubmissionReportRequest {
    if let Some(receipt) = load_local_receipts(receipts_path)
        .follower_extractions
        .get(&job.extraction_id)
        .cloned()
    {
        let (success, detail) = if receipt.submitted_at > 0 {
            (
                true,
                format!(
                    "{} (recu local rejoue apres une coupure de connexion)",
                    receipt.detail
                ),
            )
        } else {
            (
                false,
                "Etat de soumission de la collecte incertain apres une interruption. Aucun nouvel appel TikMatrix n'a ete effectue."
                    .to_string(),
            )
        };
        return TikTokFollowerSubmissionReportRequest {
            connector_id: connector_id.to_string(),
            extraction_id: job.extraction_id.clone(),
            claim_token: job.claim_token.clone(),
            success,
            tikmatrix_task_count: receipt.task_count,
            detail: Some(detail),
        };
    }

    let mut receipts = load_local_receipts(receipts_path);
    receipts.version = 1;
    receipts.follower_extractions.insert(
        job.extraction_id.clone(),
        LocalFollowerExtractionReceipt {
            target_username: job.target_username.clone(),
            max_count: job.max_count,
            task_count: 0,
            detail: "Soumission de la collecte TikMatrix demarree.".to_string(),
            submitted_at: 0,
            result_reported: false,
        },
    );
    if let Err(error) = persist_local_receipts(receipts_path, &receipts) {
        return TikTokFollowerSubmissionReportRequest {
            connector_id: connector_id.to_string(),
            extraction_id: job.extraction_id.clone(),
            claim_token: job.claim_token.clone(),
            success: false,
            tikmatrix_task_count: 0,
            detail: Some(format!(
                "Impossible d'enregistrer la protection anti-doublon de la collecte : {error}"
            )),
        };
    }

    let outcome = submit_tiktok_follower_job(client, job).await;
    match outcome {
        Ok((task_count, detail)) => {
            if let Some(receipt) = receipts.follower_extractions.get_mut(&job.extraction_id) {
                receipt.task_count = task_count;
                receipt.detail = detail.clone();
                receipt.submitted_at = metrics::now_ts();
            }
            if let Err(error) = persist_local_receipts(receipts_path, &receipts) {
                return TikTokFollowerSubmissionReportRequest {
                    connector_id: connector_id.to_string(),
                    extraction_id: job.extraction_id.clone(),
                    claim_token: job.claim_token.clone(),
                    success: false,
                    tikmatrix_task_count: 0,
                    detail: Some(format!(
                        "TikMatrix a accepte la collecte, mais son recu local n'a pas pu etre enregistre : {error}"
                    )),
                };
            }
            TikTokFollowerSubmissionReportRequest {
                connector_id: connector_id.to_string(),
                extraction_id: job.extraction_id.clone(),
                claim_token: job.claim_token.clone(),
                success: true,
                tikmatrix_task_count: task_count,
                detail: Some(detail),
            }
        }
        Err(error) => {
            receipts.follower_extractions.remove(&job.extraction_id);
            let detail = match persist_local_receipts(receipts_path, &receipts) {
                Ok(()) => error,
                Err(cleanup_error) => {
                    format!("{error} Le recu local n'a pas pu etre nettoye : {cleanup_error}")
                }
            };
            TikTokFollowerSubmissionReportRequest {
                connector_id: connector_id.to_string(),
                extraction_id: job.extraction_id.clone(),
                claim_token: job.claim_token.clone(),
                success: false,
                tikmatrix_task_count: 0,
                detail: Some(detail),
            }
        }
    }
}

#[cfg(feature = "desktop")]
async fn submit_tiktok_follower_job(
    client: &reqwest::Client,
    job: &TikTokFollowerConnectorJob,
) -> Result<(u64, String), String> {
    let snapshot = inspect_tikmatrix(client).await;
    if !snapshot.agent_healthy {
        return Err(snapshot
            .error
            .unwrap_or_else(|| "L'agent TikMatrix ne repond pas".to_string()));
    }
    if snapshot.account_count == 0 {
        return Err(
            "Aucun compte TikTok reconnu par TikMatrix ; connectez le compte puis lancez Match Accounts"
                .to_string(),
        );
    }
    let serial = select_tikmatrix_serial(&snapshot, job.device_serial.as_deref())?;
    let port = tikmatrix_port()?;
    let base = format!("http://127.0.0.1:{port}");
    let running = get_tikmatrix_json(client, &base, "/api/running_task").await?;
    if !data_array(&running).is_empty() {
        return Err(
            "Une tache TikMatrix est deja active ; attendez sa fin avant la collecte".to_string(),
        );
    }

    let data_dir = tikmatrix_data_dir()?;
    let settings_path = data_dir.join("scrape_users_settings.json");
    let mut settings = read_json_object(&settings_path);
    settings.insert("scrape_mode".to_string(), json!("followers"));
    settings.insert("target_username".to_string(), json!(job.target_username));
    settings.insert("search_keyword".to_string(), json!(""));
    settings.insert("max_scrape_count".to_string(), json!(job.max_count));
    let settings_bytes =
        serde_json::to_vec_pretty(&Value::Object(settings)).map_err(|error| error.to_string())?;
    fs_util::atomic_write(&settings_path, settings_bytes)
        .map_err(|error| format!("Reglages Scrape Users impossibles : {error}"))?;

    let response = client
        .post(format!("{base}/api/scrape_now"))
        .json(&json!({
            "serials": [serial],
            "mode": "followers",
            "target_username": job.target_username,
            "search_keyword": "",
            "max_scrape_count": job.max_count,
            "enable_multi_account": false,
            "rotate_proxy": false
        }))
        .send()
        .await
        .map_err(|error| format!("Appel Scrape Users impossible : {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    let value = serde_json::from_slice::<Value>(&bytes).unwrap_or_else(
        |_| json!({ "raw": String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>() }),
    );
    if !status.is_success()
        || value
            .get("code")
            .and_then(Value::as_i64)
            .is_some_and(|code| code != 0)
    {
        return Err(format!(
            "TikMatrix a refuse la collecte (HTTP {}) : {}",
            status.as_u16(),
            value
        ));
    }
    let task_count = value
        .get("data")
        .and_then(|data| {
            data.as_u64()
                .or_else(|| data.as_str().and_then(|value| value.parse::<u64>().ok()))
        })
        .unwrap_or(1);
    Ok((
        task_count,
        format!(
            "{task_count} tache(s) TikMatrix soumise(s) pour les followers de {}",
            job.target_username
        ),
    ))
}

#[cfg(feature = "desktop")]
async fn sync_follower_results(
    client: &reqwest::Client,
    base_url: &str,
    token: &str,
    receipts_path: &Path,
    connector_id: &str,
) {
    let pending = post_server_json::<Value>(
        client,
        base_url,
        token,
        "/api/tiktok/connector/follower-extractions/pending-results",
        &TikTokConnectorClaimRequest {
            connector_id: connector_id.to_string(),
        },
    )
    .await;
    let Ok(value) = pending else {
        return;
    };
    let running = match tikmatrix_port() {
        Ok(port) => get_tikmatrix_json(
            client,
            &format!("http://127.0.0.1:{port}"),
            "/api/running_task",
        )
        .await
        .map(|value| !data_array(&value).is_empty())
        .unwrap_or(true),
        Err(_) => true,
    };
    if running {
        return;
    }
    let pending = value
        .get("extractions")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for item in pending {
        let Ok(extraction) = serde_json::from_value::<TikTokFollowerPendingResult>(item) else {
            continue;
        };
        let outcome = find_follower_output_file(&extraction);
        let report = match outcome {
            Ok(Some(path)) => match read_follower_usernames(&path, extraction.max_count) {
                Ok(usernames) => TikTokFollowerResultReportRequest {
                    connector_id: connector_id.to_string(),
                    extraction_id: extraction.extraction_id.clone(),
                    success: true,
                    usernames,
                    output_file: path
                        .file_name()
                        .map(|name| name.to_string_lossy().to_string()),
                    detail: None,
                },
                Err(error) => TikTokFollowerResultReportRequest {
                    connector_id: connector_id.to_string(),
                    extraction_id: extraction.extraction_id.clone(),
                    success: false,
                    usernames: Vec::new(),
                    output_file: None,
                    detail: Some(error),
                },
            },
            Ok(None)
                if metrics::now_ts().saturating_sub(extraction.submitted_at) > 30 * 60 =>
            {
                TikTokFollowerResultReportRequest {
                    connector_id: connector_id.to_string(),
                    extraction_id: extraction.extraction_id.clone(),
                    success: false,
                    usernames: Vec::new(),
                    output_file: None,
                    detail: Some(
                        "TikMatrix a termine sans produire de fichier de followers apres 30 minutes"
                            .to_string(),
                    ),
                }
            }
            Ok(None) => continue,
            Err(error) => TikTokFollowerResultReportRequest {
                connector_id: connector_id.to_string(),
                extraction_id: extraction.extraction_id.clone(),
                success: false,
                usernames: Vec::new(),
                output_file: None,
                detail: Some(error),
            },
        };
        if post_server_json::<Value>(
            client,
            base_url,
            token,
            "/api/tiktok/connector/follower-extractions/report-result",
            &report,
        )
        .await
        .is_ok()
        {
            let mut receipts = load_local_receipts(receipts_path);
            if let Some(receipt) = receipts
                .follower_extractions
                .get_mut(&extraction.extraction_id)
            {
                receipt.result_reported = true;
                let _ = persist_local_receipts(receipts_path, &receipts);
            }
        }
    }
}

#[cfg(feature = "desktop")]
fn find_follower_output_file(
    extraction: &TikTokFollowerPendingResult,
) -> Result<Option<PathBuf>, String> {
    let download_dir = tikmatrix_download_dir()?;
    let target = extraction
        .target_username
        .trim_start_matches('@')
        .to_ascii_lowercase();
    let earliest = extraction.submitted_at.saturating_sub(10);
    let mut candidates = Vec::new();
    let entries = fs::read_dir(&download_dir)
        .map_err(|error| format!("Dossier de resultats TikMatrix illisible : {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("txt") {
            continue;
        }
        let name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if !name.starts_with("exported_users_")
            || !name.contains("_tiktok_")
            || !name.contains(&target)
        {
            continue;
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|metadata| metadata.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        if modified >= earliest {
            candidates.push((modified, path));
        }
    }
    candidates.sort_by(|left, right| right.0.cmp(&left.0));
    Ok(candidates.into_iter().next().map(|(_, path)| path))
}

#[cfg(feature = "desktop")]
fn read_follower_usernames(path: &Path, max_count: u16) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Lecture du resultat TikMatrix impossible : {error}"))?;
    let mut seen = HashSet::new();
    let mut usernames = Vec::new();
    for line in content.lines() {
        let value = line
            .trim()
            .trim_start_matches('\u{feff}')
            .split([',', ';', '\t'])
            .next()
            .unwrap_or("")
            .trim()
            .trim_matches(['"', '\'']);
        let Ok(username) = normalize_tiktok_username(value) else {
            continue;
        };
        if seen.insert(username.to_ascii_lowercase()) {
            usernames.push(username);
        }
        if usernames.len() >= usize::from(max_count) {
            break;
        }
    }
    Ok(usernames)
}

#[cfg(feature = "desktop")]
async fn process_tiktok_job(
    client: &reqwest::Client,
    receipts_path: &Path,
    connector_id: &str,
    job: &TikTokConnectorJob,
) -> TikTokConnectorReportRequest {
    if let Some(receipt) = load_local_receipts(receipts_path)
        .receipts
        .get(&job.campaign_id)
        .cloned()
    {
        let (success, detail) = if receipt.submitted_at > 0 {
            (
                true,
                format!(
                    "{} (recu local rejoue apres une coupure de connexion)",
                    receipt.detail
                ),
            )
        } else {
            (
                false,
                "Etat de soumission TikMatrix incertain apres une interruption. Aucun renvoi automatique n'a ete effectue afin d'eviter un doublon. Verifiez TikMatrix avant de recreer la campagne."
                    .to_string(),
            )
        };
        return TikTokConnectorReportRequest {
            connector_id: connector_id.to_string(),
            campaign_id: job.campaign_id.clone(),
            claim_token: job.claim_token.clone(),
            success,
            tikmatrix_task_count: receipt.task_count,
            detail: Some(detail),
        };
    }

    let mut receipts = load_local_receipts(receipts_path);
    receipts.version = 1;
    receipts.receipts.insert(
        job.campaign_id.clone(),
        LocalReceipt {
            task_count: 0,
            detail: "Soumission TikMatrix demarree ; resultat final non confirme.".to_string(),
            submitted_at: 0,
        },
    );
    if let Err(error) = persist_local_receipts(receipts_path, &receipts) {
        return TikTokConnectorReportRequest {
            connector_id: connector_id.to_string(),
            campaign_id: job.campaign_id.clone(),
            claim_token: job.claim_token.clone(),
            success: false,
            tikmatrix_task_count: 0,
            detail: Some(format!(
                "Impossible d'enregistrer la protection anti-doublon avant l'envoi : {error}"
            )),
        };
    }

    let outcome = submit_tiktok_job(client, job).await;
    match outcome {
        Ok((task_count, detail)) => {
            if let Some(receipt) = receipts.receipts.get_mut(&job.campaign_id) {
                receipt.task_count = task_count;
                receipt.detail = detail.clone();
                receipt.submitted_at = metrics::now_ts();
            }
            if let Err(error) = persist_local_receipts(receipts_path, &receipts) {
                return TikTokConnectorReportRequest {
                    connector_id: connector_id.to_string(),
                    campaign_id: job.campaign_id.clone(),
                    claim_token: job.claim_token.clone(),
                    success: false,
                    tikmatrix_task_count: 0,
                    detail: Some(format!(
                        "TikMatrix a accepte la tache, mais le recu anti-doublon n'a pas pu etre enregistre : {error}"
                    )),
                };
            }
            TikTokConnectorReportRequest {
                connector_id: connector_id.to_string(),
                campaign_id: job.campaign_id.clone(),
                claim_token: job.claim_token.clone(),
                success: true,
                tikmatrix_task_count: task_count,
                detail: Some(detail),
            }
        }
        Err(error) => {
            receipts.receipts.remove(&job.campaign_id);
            let detail = match persist_local_receipts(receipts_path, &receipts) {
                Ok(()) => error,
                Err(cleanup_error) => format!(
                    "{error} La reservation anti-doublon locale n'a pas pu etre supprimee : {cleanup_error}"
                ),
            };
            TikTokConnectorReportRequest {
                connector_id: connector_id.to_string(),
                campaign_id: job.campaign_id.clone(),
                claim_token: job.claim_token.clone(),
                success: false,
                tikmatrix_task_count: 0,
                detail: Some(detail),
            }
        }
    }
}

#[cfg(feature = "desktop")]
async fn submit_tiktok_job(
    client: &reqwest::Client,
    job: &TikTokConnectorJob,
) -> Result<(u64, String), String> {
    let snapshot = inspect_tikmatrix(client).await;
    if !snapshot.agent_healthy {
        return Err(snapshot
            .error
            .unwrap_or_else(|| "L'agent TikMatrix ne repond pas".to_string()));
    }
    if snapshot.account_count == 0 {
        return Err(
            "Aucun compte TikTok reconnu par TikMatrix ; connectez le compte puis lancez Match Accounts"
                .to_string(),
        );
    }
    let serial = match job.device_serial.as_deref() {
        Some(serial) if snapshot.device_serials.iter().any(|value| value == serial) => {
            serial.to_string()
        }
        Some(serial) => {
            return Err(format!(
                "L'appareil TikMatrix demande n'est pas connecte : {serial}"
            ))
        }
        None if snapshot.device_serials.len() == 1 => snapshot.device_serials[0].clone(),
        None if snapshot.device_serials.is_empty() => {
            return Err("Aucun appareil Android n'est connecte a TikMatrix".to_string())
        }
        None => {
            return Err(
                "Plusieurs appareils TikMatrix sont connectes ; indiquez deviceSerial".to_string(),
            )
        }
    };

    let port = tikmatrix_port()?;
    let base = format!("http://127.0.0.1:{port}");
    let running = get_tikmatrix_json(client, &base, "/api/running_task").await?;
    if !data_array(&running).is_empty() {
        return Err(
            "Une tache TikMatrix est deja active ; attendez sa fin avant cette campagne"
                .to_string(),
        );
    }

    let data_dir = tikmatrix_data_dir()?;
    let campaign_dir = data_dir.join("cst-dm-campaigns");
    let usernames_path = campaign_dir.join(format!("{}.txt", job.campaign_id));
    let usernames = job.recipients.join("\r\n") + "\r\n";
    fs_util::atomic_write(&usernames_path, usernames.as_bytes())
        .map_err(|error| format!("Ecriture de la liste TikTok impossible : {error}"))?;
    let portable_path = usernames_path.to_string_lossy().replace('\\', "/");

    let settings_path = data_dir.join("mass_dm_settings.json");
    let mut settings = read_json_object(&settings_path);
    settings.insert("message_contents".to_string(), json!(job.message));
    settings.insert("insert_emoji".to_string(), json!(false));
    settings.insert("target_username_path".to_string(), json!(portable_path));
    settings.insert("send_profile_card".to_string(), json!(""));
    settings.insert("open_user_method".to_string(), json!("direct"));
    settings.insert(
        "task_interval".to_string(),
        json!([job.min_interval_minutes, job.max_interval_minutes]),
    );
    let settings_bytes =
        serde_json::to_vec_pretty(&Value::Object(settings)).map_err(|error| error.to_string())?;
    fs_util::atomic_write(&settings_path, settings_bytes)
        .map_err(|error| format!("Reglages Mass DM impossibles : {error}"))?;

    let response = client
        .post(format!("{base}/api/message_now"))
        .json(&json!({
            "serials": [serial],
            "target_username_path": portable_path,
            "enable_multi_account": false,
            "rotate_proxy": false,
            "min_interval": job.min_interval_minutes,
            "max_interval": job.max_interval_minutes
        }))
        .send()
        .await
        .map_err(|error| format!("Appel TikMatrix impossible : {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    let value = serde_json::from_slice::<Value>(&bytes).unwrap_or_else(
        |_| json!({ "raw": String::from_utf8_lossy(&bytes).chars().take(300).collect::<String>() }),
    );
    if !status.is_success()
        || value
            .get("code")
            .and_then(Value::as_i64)
            .is_some_and(|code| code != 0)
    {
        return Err(format!(
            "TikMatrix a refuse la campagne (HTTP {}) : {}",
            status.as_u16(),
            value
        ));
    }
    let task_count = value
        .get("data")
        .and_then(|data| {
            data.as_u64()
                .or_else(|| data.as_str().and_then(|value| value.parse::<u64>().ok()))
        })
        .unwrap_or(1);
    Ok((
        task_count,
        format!(
            "{task_count} tache(s) TikMatrix soumise(s) pour {} compte(s) de test",
            job.recipients.len()
        ),
    ))
}

#[cfg(feature = "desktop")]
fn tikmatrix_port() -> Result<u16, String> {
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA est indisponible".to_string())?;
    let path = appdata.join("com.tikmatrix").join("port.txt");
    let raw = fs::read_to_string(&path)
        .map_err(|_| "TikMatrix n'est pas demarre ou son agent n'est pas initialise".to_string())?;
    raw.trim()
        .parse::<u16>()
        .ok()
        .filter(|port| *port > 0)
        .ok_or_else(|| "Port de l'agent TikMatrix invalide".to_string())
}

#[cfg(feature = "desktop")]
fn tikmatrix_data_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA est indisponible".to_string())?;
    let path = appdata.join("com.tikmatrix").join("data");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Dossier de donnees TikMatrix inaccessible : {error}"))?;
    Ok(path)
}

#[cfg(feature = "desktop")]
fn tikmatrix_download_dir() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "APPDATA est indisponible".to_string())?;
    let path = appdata.join("com.tikmatrix").join("download");
    fs::create_dir_all(&path)
        .map_err(|error| format!("Dossier de resultats TikMatrix inaccessible : {error}"))?;
    Ok(path)
}

#[cfg(feature = "desktop")]
fn select_tikmatrix_serial(
    snapshot: &TikMatrixSnapshot,
    requested: Option<&str>,
) -> Result<String, String> {
    match requested {
        Some(serial) if snapshot.device_serials.iter().any(|value| value == serial) => {
            Ok(serial.to_string())
        }
        Some(serial) => Err(format!(
            "L'appareil TikMatrix demande n'est pas connecte : {serial}"
        )),
        None if snapshot.device_serials.len() == 1 => Ok(snapshot.device_serials[0].clone()),
        None if snapshot.device_serials.is_empty() => {
            Err("Aucun appareil Android n'est connecte a TikMatrix".to_string())
        }
        None => {
            Err("Plusieurs appareils TikMatrix sont connectes ; indiquez deviceSerial".to_string())
        }
    }
}

#[cfg(feature = "desktop")]
async fn get_tikmatrix_json(
    client: &reqwest::Client,
    base: &str,
    path: &str,
) -> Result<Value, String> {
    let response = client
        .get(format!("{base}{path}"))
        .send()
        .await
        .map_err(|error| format!("Agent TikMatrix indisponible : {error}"))?;
    let status = response.status();
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("TikMatrix HTTP {}", status.as_u16()));
    }
    serde_json::from_slice(&bytes).map_err(|error| format!("Reponse TikMatrix invalide : {error}"))
}

#[cfg(feature = "desktop")]
fn data_array(value: &Value) -> &[Value] {
    value
        .get("data")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}

#[cfg(feature = "desktop")]
fn read_json_object(path: &Path) -> Map<String, Value> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| value.as_object().cloned())
        .unwrap_or_default()
}

#[cfg(feature = "desktop")]
fn load_local_receipts(path: &Path) -> LocalReceiptStore {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

#[cfg(feature = "desktop")]
fn persist_local_receipts(path: &Path, store: &LocalReceiptStore) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(store).map_err(|error| error.to_string())?;
    fs_util::atomic_write(path, bytes).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manager(name: &str) -> (PathBuf, TikTokDmManager) {
        let root = std::env::temp_dir().join(format!("cst-tiktok-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let manager = TikTokDmManager::new(root.join("campaigns.json")).unwrap();
        (root, manager)
    }

    fn request(key: &str) -> PrepareTikTokDmCampaignRequest {
        PrepareTikTokDmCampaignRequest {
            recipients: vec!["@secondaire_1".to_string(), "secondaire.2".to_string()],
            message: "Test controle".to_string(),
            min_interval_minutes: 1,
            max_interval_minutes: 2,
            device_serial: None,
            idempotency_key: key.to_string(),
        }
    }

    #[test]
    fn prepare_normalizes_and_is_idempotent() {
        let (root, manager) = manager("prepare");
        let first = manager
            .prepare("owner-1", request("chat-1"), "human_chat")
            .unwrap();
        let second = manager
            .prepare("owner-1", request("chat-1"), "human_chat")
            .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.recipients, vec!["@secondaire_1", "@secondaire.2"]);
        assert_eq!(first.status, TikTokDmCampaignStatus::Draft);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn five_recipients_and_confirmation_are_enforced() {
        let (root, manager) = manager("bounds");
        let mut too_many = request("too-many");
        too_many.recipients = (0..6).map(|index| format!("test_{index}")).collect();
        assert!(manager
            .prepare("owner-1", too_many, "human_chat")
            .unwrap_err()
            .to_string()
            .contains("entre 1 et 5"));

        let draft = manager
            .prepare("owner-1", request("ok"), "human_chat")
            .unwrap();
        let error = manager
            .confirm(
                "owner-1",
                ConfirmTikTokDmCampaignRequest {
                    campaign_id: draft.id.clone(),
                    owned_accounts_confirmed: true,
                    send_confirmed: false,
                },
            )
            .unwrap_err();
        assert!(error.to_string().contains("Confirmez"));
        let queued = manager
            .confirm(
                "owner-1",
                ConfirmTikTokDmCampaignRequest {
                    campaign_id: draft.id,
                    owned_accounts_confirmed: true,
                    send_confirmed: true,
                },
            )
            .unwrap();
        assert_eq!(queued.status, TikTokDmCampaignStatus::Queued);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn connector_claim_and_report_are_lease_bound() {
        let (root, manager) = manager("claim");
        let draft = manager
            .prepare("owner-1", request("job"), "autonomous_agent")
            .unwrap();
        manager
            .confirm(
                "owner-1",
                ConfirmTikTokDmCampaignRequest {
                    campaign_id: draft.id.clone(),
                    owned_accounts_confirmed: true,
                    send_confirmed: true,
                },
            )
            .unwrap();
        let job = manager.claim_next("windows-test").unwrap().unwrap();
        assert_eq!(job.campaign_id, draft.id);
        assert!(manager.claim_next("windows-test").unwrap().is_none());
        let submitted = manager
            .report(TikTokConnectorReportRequest {
                connector_id: "windows-test".to_string(),
                campaign_id: job.campaign_id,
                claim_token: job.claim_token,
                success: true,
                tikmatrix_task_count: 1,
                detail: None,
            })
            .unwrap();
        assert_eq!(submitted.status, TikTokDmCampaignStatus::Submitted);
        assert_eq!(submitted.tikmatrix_task_count, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn usernames_and_multiline_messages_are_rejected() {
        assert!(normalize_tiktok_username("@bad handle").is_err());
        assert!(normalize_tiktok_username("@ok.name_1").is_ok());
        assert!(validate_message("ligne 1\nligne 2".to_string()).is_err());
    }

    #[test]
    fn follower_extraction_is_authorized_bounded_and_completed() {
        let (root, manager) = manager("followers");
        let denied = QueueTikTokFollowerExtractionRequest {
            target_username: "@source_test".to_string(),
            max_count: 50,
            device_serial: None,
            authorized_account_confirmed: false,
            dm_pipeline: None,
            idempotency_key: "followers-denied".to_string(),
        };
        assert!(manager
            .queue_follower_extraction("owner-1", denied, "human_chat")
            .unwrap_err()
            .to_string()
            .contains("autorise"));

        let request = QueueTikTokFollowerExtractionRequest {
            target_username: "source_test".to_string(),
            max_count: 3,
            device_serial: None,
            authorized_account_confirmed: true,
            dm_pipeline: None,
            idempotency_key: "followers-ok".to_string(),
        };
        let queued = manager
            .queue_follower_extraction("owner-1", request, "autonomous_agent")
            .unwrap();
        assert_eq!(queued.target_username, "@source_test");
        assert_eq!(queued.status, TikTokFollowerExtractionStatus::Queued);
        let job = manager
            .claim_next_follower_extraction("windows-test")
            .unwrap()
            .unwrap();
        let submitted = manager
            .report_follower_submission(TikTokFollowerSubmissionReportRequest {
                connector_id: "windows-test".to_string(),
                extraction_id: job.extraction_id.clone(),
                claim_token: job.claim_token,
                success: true,
                tikmatrix_task_count: 1,
                detail: None,
            })
            .unwrap();
        assert_eq!(submitted.status, TikTokFollowerExtractionStatus::Submitted);
        let completed = manager
            .report_follower_result(TikTokFollowerResultReportRequest {
                connector_id: "windows-test".to_string(),
                extraction_id: job.extraction_id,
                success: true,
                usernames: vec![
                    "follower_one".to_string(),
                    "@follower_two".to_string(),
                    "follower_one".to_string(),
                    "follower_three".to_string(),
                    "ignored_four".to_string(),
                ],
                output_file: Some("exported_users_following_tiktok_source_test_3.txt".to_string()),
                detail: None,
            })
            .unwrap();
        assert_eq!(completed.status, TikTokFollowerExtractionStatus::Completed);
        assert_eq!(
            completed.usernames,
            vec!["@follower_one", "@follower_two", "@follower_three"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn follower_extraction_accepts_one_pass_tikmatrix_maximum() {
        let (root, manager) = manager("followers-maximum");
        let accepted = manager
            .queue_follower_extraction(
                "owner-1",
                QueueTikTokFollowerExtractionRequest {
                    target_username: "@source_test".to_string(),
                    max_count: 1_000,
                    device_serial: None,
                    authorized_account_confirmed: true,
                    dm_pipeline: None,
                    idempotency_key: "followers-maximum".to_string(),
                },
                "human_chat",
            )
            .unwrap();
        assert_eq!(accepted.max_count, 1_000);

        let rejected = manager
            .queue_follower_extraction(
                "owner-1",
                QueueTikTokFollowerExtractionRequest {
                    target_username: "@source_test".to_string(),
                    max_count: 1_001,
                    device_serial: None,
                    authorized_account_confirmed: true,
                    dm_pipeline: None,
                    idempotency_key: "followers-too-many".to_string(),
                },
                "human_chat",
            )
            .unwrap_err();
        assert!(rejected.to_string().contains("1000"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn follower_pipeline_prepares_only_owned_matches_as_a_draft() {
        let (root, manager) = manager("followers-to-dm");
        let queued = manager
            .queue_follower_extraction(
                "owner-1",
                QueueTikTokFollowerExtractionRequest {
                    target_username: "@source_test".to_string(),
                    max_count: 1_000,
                    device_serial: None,
                    authorized_account_confirmed: true,
                    dm_pipeline: Some(TikTokFollowerDmPipelineRequest {
                        owned_recipient_allowlist: vec![
                            "@secondaire_2".to_string(),
                            "@secondaire_absent".to_string(),
                        ],
                        message: "Message de test exact".to_string(),
                        owned_accounts_confirmed: true,
                    }),
                    idempotency_key: "followers-to-dm".to_string(),
                },
                "autonomous_agent",
            )
            .unwrap();
        let job = manager
            .claim_next_follower_extraction("windows-test")
            .unwrap()
            .unwrap();
        manager
            .report_follower_submission(TikTokFollowerSubmissionReportRequest {
                connector_id: "windows-test".to_string(),
                extraction_id: job.extraction_id.clone(),
                claim_token: job.claim_token,
                success: true,
                tikmatrix_task_count: 1,
                detail: None,
            })
            .unwrap();
        let completed = manager
            .report_follower_result(TikTokFollowerResultReportRequest {
                connector_id: "windows-test".to_string(),
                extraction_id: job.extraction_id,
                success: true,
                usernames: vec![
                    "@inconnu_1".to_string(),
                    "@secondaire_2".to_string(),
                    "@inconnu_2".to_string(),
                ],
                output_file: Some("exported_users_following_tiktok_source_test_3.txt".to_string()),
                detail: None,
            })
            .unwrap();
        let pipeline = completed.dm_pipeline.unwrap();
        let campaign_id = pipeline.prepared_campaign_id.unwrap();
        assert!(pipeline.note.unwrap().contains("Brouillon prepare"));

        let campaigns = manager.list("owner-1").unwrap();
        let campaign = campaigns
            .iter()
            .find(|campaign| campaign.id == campaign_id)
            .unwrap();
        assert_eq!(campaign.recipients, vec!["@secondaire_2"]);
        assert_eq!(campaign.message, "Message de test exact");
        assert_eq!(campaign.status, TikTokDmCampaignStatus::Draft);
        assert!(campaign.owned_accounts_confirmed);
        assert!(!campaign.send_confirmed);
        assert!(!campaign.recipients.contains(&"@inconnu_1".to_string()));

        let sent = manager
            .confirm(
                "owner-1",
                ConfirmTikTokDmCampaignRequest {
                    campaign_id,
                    owned_accounts_confirmed: true,
                    send_confirmed: true,
                },
            )
            .unwrap();
        assert_eq!(sent.status, TikTokDmCampaignStatus::Queued);
        assert_eq!(queued.target_username, "@source_test");
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(feature = "desktop")]
    #[test]
    fn follower_text_results_are_normalized_and_limited() {
        let root = std::env::temp_dir().join(format!("cst-tiktok-file-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("followers.txt");
        fs::write(
            &path,
            "\u{feff}@alpha\nbeta\n\"gamma\"\ninvalid handle\n@alpha\n",
        )
        .unwrap();
        assert_eq!(
            read_follower_usernames(&path, 3).unwrap(),
            vec!["@alpha", "@beta", "@gamma"]
        );
        fs::remove_dir_all(root).unwrap();
    }
}
