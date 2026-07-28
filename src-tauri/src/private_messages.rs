//! Messagerie privee persistante entre les utilisateurs du serveur.
//!
//! Toutes les operations recoivent explicitement l'identite de l'appelant :
//! le stockage ne fournit jamais de methode permettant de lire une conversation
//! sans en etre l'un des deux participants.

use crate::{fs_util, metrics, runtime_sync::RuntimeSync};
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[cfg(feature = "desktop")]
use tauri::State;

const STORE_VERSION: u32 = 3;
const MAX_MESSAGE_CHARS: usize = 4_000;
const MAX_MESSAGES: usize = 200_000;
const MAX_CAMPAIGNS: usize = 1_000;
pub const MAX_CAMPAIGN_RECIPIENTS: usize = 100;
pub const MAX_CAMPAIGN_VARIANTS: usize = 20;
pub const MIN_CAMPAIGN_INTERVAL_SECONDS: u64 = 5;
pub const MAX_CAMPAIGN_INTERVAL_SECONDS: u64 = 3_600;
const MAX_MESSAGE_IMAGES: usize = 4;
const MAX_MESSAGE_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_TOTAL_BYTES: usize = 20 * 1024 * 1024;
pub(crate) const MAX_PRIVATE_MESSAGE_REQUEST_BYTES: usize = 28 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageUser {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

impl PrivateMessageUser {
    pub fn new(id: String, username: String, avatar_url: Option<String>) -> Self {
        Self {
            id,
            username,
            avatar_url,
        }
    }

    pub fn administrator() -> Self {
        Self::new(
            "server-admin".to_string(),
            "Administrateur".to_string(),
            None,
        )
    }

    #[cfg(feature = "desktop")]
    fn local() -> Self {
        Self::new(
            "local-user".to_string(),
            "Utilisateur local".to_string(),
            None,
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessage {
    pub id: String,
    pub sender: PrivateMessageUser,
    pub recipient: PrivateMessageUser,
    pub body: String,
    #[serde(default)]
    pub images: Vec<PrivateMessageImage>,
    pub created_at: i64,
    pub sequence: u64,
    #[serde(default)]
    pub read_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageImage {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageImageRequest {
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageImageContent {
    pub mime_type: String,
    pub data_base64: String,
}

struct PreparedPrivateMessageImage {
    metadata: PrivateMessageImage,
    bytes: Vec<u8>,
    extension: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateConversationSummary {
    pub user: PrivateMessageUser,
    pub last_message: PrivateMessage,
    pub unread_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateConversation {
    pub user: PrivateMessageUser,
    pub messages: Vec<PrivateMessage>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrivateMessageCampaignStatus {
    Draft,
    Running,
    Paused,
    Completed,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PrivateMessageCampaignDeliveryStatus {
    Queued,
    Sent,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageCampaignDelivery {
    pub recipient: PrivateMessageUser,
    pub body: String,
    pub status: PrivateMessageCampaignDeliveryStatus,
    #[serde(default)]
    pub sent_at: Option<i64>,
    #[serde(default)]
    pub message_id: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMessageCampaign {
    pub id: String,
    pub name: String,
    pub sender: PrivateMessageUser,
    pub status: PrivateMessageCampaignStatus,
    pub interval_seconds: u64,
    pub consent_confirmed: bool,
    pub created_by: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idempotency_key: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub next_delivery_at: Option<i64>,
    #[serde(default)]
    pub deliveries: Vec<PrivateMessageCampaignDelivery>,
}

impl PrivateMessageCampaign {
    pub fn sent_count(&self) -> usize {
        self.deliveries
            .iter()
            .filter(|delivery| delivery.status == PrivateMessageCampaignDeliveryStatus::Sent)
            .count()
    }

    pub fn failed_count(&self) -> usize {
        self.deliveries
            .iter()
            .filter(|delivery| delivery.status == PrivateMessageCampaignDeliveryStatus::Failed)
            .count()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreatePrivateMessageCampaignRequest {
    #[serde(default)]
    pub name: String,
    pub recipient_ids: Vec<String>,
    pub message_variants: Vec<String>,
    #[serde(default = "default_campaign_interval_seconds")]
    pub interval_seconds: u64,
    #[serde(default)]
    pub start_immediately: bool,
    #[serde(default)]
    pub consent_confirmed: bool,
    #[serde(default)]
    pub idempotency_key: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivateMessageCampaignAction {
    Start,
    Pause,
    Resume,
    Cancel,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct PrivateMessageStore {
    version: u32,
    #[serde(default)]
    next_sequence: u64,
    #[serde(default)]
    messages: Vec<PrivateMessage>,
    #[serde(default)]
    campaigns: Vec<PrivateMessageCampaign>,
}

impl Default for PrivateMessageStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            next_sequence: 0,
            messages: Vec::new(),
            campaigns: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PrivateMessageError {
    Validation(String),
    NotFound,
    Internal(String),
}

impl fmt::Display for PrivateMessageError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message) | Self::Internal(message) => formatter.write_str(message),
            Self::NotFound => formatter.write_str("Utilisateur introuvable"),
        }
    }
}

impl std::error::Error for PrivateMessageError {}

#[derive(Clone)]
pub struct PrivateMessageManager {
    inner: Arc<PrivateMessageInner>,
}

struct PrivateMessageInner {
    storage_path: PathBuf,
    images_path: PathBuf,
    store: Mutex<PrivateMessageStore>,
}

impl PrivateMessageManager {
    pub fn new(storage_path: PathBuf) -> Result<Self, String> {
        let mut store = load_store(&storage_path).map_err(|error| error.to_string())?;
        if normalize_store(&mut store) {
            persist_store(&storage_path, &store).map_err(|error| error.to_string())?;
        }
        let images_path = storage_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("private-message-images");
        Ok(Self {
            inner: Arc::new(PrivateMessageInner {
                storage_path,
                images_path,
                store: Mutex::new(store),
            }),
        })
    }

    pub fn list_conversations(
        &self,
        viewer_id: &str,
    ) -> Result<Vec<PrivateConversationSummary>, PrivateMessageError> {
        let store = self.lock_store()?;
        let mut by_user = HashMap::<String, PrivateConversationSummary>::new();

        for message in store
            .messages
            .iter()
            .filter(|message| message_involves(message, viewer_id))
        {
            let other = other_user(message, viewer_id).clone();
            let unread = message.recipient.id == viewer_id && message.read_at.is_none();
            let entry =
                by_user
                    .entry(other.id.clone())
                    .or_insert_with(|| PrivateConversationSummary {
                        user: other.clone(),
                        last_message: message.clone(),
                        unread_count: 0,
                    });
            // Les profils peuvent etre renommes. Le snapshot le plus recent est
            // celui qui doit etre presente dans la liste des conversations.
            if message.sequence >= entry.last_message.sequence {
                entry.user = other;
                entry.last_message = message.clone();
            }
            if unread {
                entry.unread_count = entry.unread_count.saturating_add(1);
            }
        }

        let mut conversations = by_user.into_values().collect::<Vec<_>>();
        conversations.sort_by(|left, right| {
            right
                .last_message
                .sequence
                .cmp(&left.last_message.sequence)
                .then_with(|| {
                    right
                        .last_message
                        .created_at
                        .cmp(&left.last_message.created_at)
                })
                .then_with(|| left.user.username.cmp(&right.user.username))
        });
        Ok(conversations)
    }

    pub fn conversation(
        &self,
        viewer: &PrivateMessageUser,
        other: &PrivateMessageUser,
    ) -> Result<PrivateConversation, PrivateMessageError> {
        self.conversation_with_read_status(viewer, other)
            .map(|(conversation, _)| conversation)
    }

    pub fn conversation_with_read_status(
        &self,
        viewer: &PrivateMessageUser,
        other: &PrivateMessageUser,
    ) -> Result<(PrivateConversation, bool), PrivateMessageError> {
        let viewer_id = viewer.id.clone();
        let other_id = other.id.clone();
        let mut marked_read = false;
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let mut messages = next
            .messages
            .iter_mut()
            .filter(|message| message_between(message, &viewer_id, &other_id))
            .map(|message| {
                if message.recipient.id == viewer_id && message.read_at.is_none() {
                    message.read_at = Some(metrics::now_ts());
                    marked_read = true;
                }
                message.clone()
            })
            .collect::<Vec<_>>();
        messages.sort_by(|left, right| {
            left.sequence
                .cmp(&right.sequence)
                .then_with(|| left.created_at.cmp(&right.created_at))
                .then_with(|| left.id.cmp(&right.id))
        });
        if marked_read {
            persist_store(&self.inner.storage_path, &next)?;
            *current = next;
        }
        Ok((
            PrivateConversation {
                user: other.clone(),
                messages,
            },
            marked_read,
        ))
    }

    #[cfg(test)]
    pub fn send(
        &self,
        sender: PrivateMessageUser,
        recipient: PrivateMessageUser,
        body: String,
    ) -> Result<PrivateMessage, PrivateMessageError> {
        self.send_with_images(sender, recipient, body, Vec::new())
    }

    pub fn send_with_images(
        &self,
        sender: PrivateMessageUser,
        recipient: PrivateMessageUser,
        body: String,
        images: Vec<PrivateMessageImageRequest>,
    ) -> Result<PrivateMessage, PrivateMessageError> {
        if sender.id == recipient.id {
            return Err(PrivateMessageError::Validation(
                "Vous ne pouvez pas vous envoyer un message".to_string(),
            ));
        }
        let prepared_images = prepare_private_message_images(images)?;
        let body = validate_body(body, !prepared_images.is_empty())?;

        let mut current = self.lock_store()?;
        if current.messages.len() >= MAX_MESSAGES {
            return Err(PrivateMessageError::Validation(
                "La messagerie a atteint sa limite de stockage".to_string(),
            ));
        }
        let mut next = current.clone();
        next.next_sequence = next.next_sequence.saturating_add(1).max(1);
        let message = PrivateMessage {
            id: Uuid::new_v4().to_string(),
            sender,
            recipient,
            body,
            images: prepared_images
                .iter()
                .map(|image| image.metadata.clone())
                .collect(),
            created_at: metrics::now_ts(),
            sequence: next.next_sequence,
            read_at: None,
        };
        next.messages.push(message.clone());

        let mut written_paths = Vec::with_capacity(prepared_images.len());
        for image in &prepared_images {
            let path = private_message_image_path(
                &self.inner.images_path,
                &image.metadata.id,
                image.extension,
            )?;
            if let Err(error) = fs_util::atomic_write(&path, &image.bytes) {
                remove_private_message_image_files(&written_paths);
                return Err(PrivateMessageError::Internal(format!(
                    "Enregistrement de l'image impossible : {error}"
                )));
            }
            written_paths.push(path);
        }
        if let Err(error) = persist_store(&self.inner.storage_path, &next) {
            remove_private_message_image_files(&written_paths);
            return Err(error);
        }
        *current = next;
        Ok(message)
    }

    pub fn create_campaign(
        &self,
        sender: PrivateMessageUser,
        recipients: Vec<PrivateMessageUser>,
        request: CreatePrivateMessageCampaignRequest,
        created_by: &str,
    ) -> Result<PrivateMessageCampaign, PrivateMessageError> {
        let CreatePrivateMessageCampaignRequest {
            name,
            recipient_ids: _,
            message_variants,
            interval_seconds,
            start_immediately,
            consent_confirmed,
            idempotency_key,
        } = request;
        if message_variants.is_empty() || message_variants.len() > MAX_CAMPAIGN_VARIANTS {
            return Err(PrivateMessageError::Validation(format!(
                "Ajoutez entre 1 et {MAX_CAMPAIGN_VARIANTS} variantes de message"
            )));
        }
        if interval_seconds < MIN_CAMPAIGN_INTERVAL_SECONDS
            || interval_seconds > MAX_CAMPAIGN_INTERVAL_SECONDS
        {
            return Err(PrivateMessageError::Validation(format!(
                "La cadence doit etre comprise entre {MIN_CAMPAIGN_INTERVAL_SECONDS} et {MAX_CAMPAIGN_INTERVAL_SECONDS} secondes"
            )));
        }
        if start_immediately && !consent_confirmed {
            return Err(PrivateMessageError::Validation(
                "Confirmez le consentement des destinataires avant de demarrer".to_string(),
            ));
        }

        let mut seen = HashSet::new();
        let recipients = recipients
            .into_iter()
            .filter(|recipient| recipient.id != sender.id)
            .filter(|recipient| seen.insert(recipient.id.clone()))
            .collect::<Vec<_>>();
        if recipients.is_empty() {
            return Err(PrivateMessageError::Validation(
                "Selectionnez au moins un destinataire different de l'expediteur".to_string(),
            ));
        }
        if recipients.len() > MAX_CAMPAIGN_RECIPIENTS {
            return Err(PrivateMessageError::Validation(format!(
                "Une campagne peut contenir au maximum {MAX_CAMPAIGN_RECIPIENTS} destinataires"
            )));
        }
        let variants = message_variants
            .into_iter()
            .map(|variant| validate_body(variant, false))
            .collect::<Result<Vec<_>, _>>()?;
        let now = metrics::now_ts();
        let total = recipients.len();
        let deliveries = recipients
            .into_iter()
            .enumerate()
            .map(|(index, recipient)| {
                let template = &variants[index % variants.len()];
                let body = validate_body(
                    render_campaign_message(template, &recipient, index + 1, total),
                    false,
                )?;
                Ok(PrivateMessageCampaignDelivery {
                    body,
                    recipient,
                    status: PrivateMessageCampaignDeliveryStatus::Queued,
                    sent_at: None,
                    message_id: None,
                    error: None,
                })
            })
            .collect::<Result<Vec<_>, PrivateMessageError>>()?;
        let supplied_name = name.trim();
        if supplied_name.chars().count() > 120 || supplied_name.chars().any(char::is_control) {
            return Err(PrivateMessageError::Validation(
                "Le nom de campagne est invalide".to_string(),
            ));
        }
        let idempotency_key = idempotency_key
            .as_deref()
            .map(validate_campaign_idempotency_key)
            .transpose()?;
        let campaign = PrivateMessageCampaign {
            id: Uuid::new_v4().to_string(),
            name: if supplied_name.is_empty() {
                format!("Campagne du {}", format_campaign_date(now))
            } else {
                supplied_name.to_string()
            },
            sender,
            status: if start_immediately {
                PrivateMessageCampaignStatus::Running
            } else {
                PrivateMessageCampaignStatus::Draft
            },
            interval_seconds,
            consent_confirmed,
            created_by: normalize_campaign_creator(created_by),
            idempotency_key: idempotency_key.clone(),
            created_at: now,
            updated_at: now,
            next_delivery_at: start_immediately.then_some(now),
            deliveries,
        };

        let mut current = self.lock_store()?;
        if let Some(existing) = idempotency_key.as_deref().and_then(|key| {
            current.campaigns.iter().find(|candidate| {
                candidate.sender.id == campaign.sender.id
                    && candidate.idempotency_key.as_deref() == Some(key)
            })
        }) {
            return Ok(existing.clone());
        }
        if current.campaigns.len() >= MAX_CAMPAIGNS {
            return Err(PrivateMessageError::Validation(
                "La limite de campagnes archivees est atteinte".to_string(),
            ));
        }
        let mut next = current.clone();
        next.campaigns.push(campaign.clone());
        persist_store(&self.inner.storage_path, &next)?;
        *current = next;
        Ok(campaign)
    }

    pub fn list_campaigns(
        &self,
        sender_id: &str,
    ) -> Result<Vec<PrivateMessageCampaign>, PrivateMessageError> {
        let store = self.lock_store()?;
        let mut campaigns = store
            .campaigns
            .iter()
            .filter(|campaign| campaign.sender.id == sender_id)
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

    pub fn control_campaign(
        &self,
        sender_id: &str,
        campaign_id: &str,
        action: PrivateMessageCampaignAction,
        consent_confirmed: bool,
    ) -> Result<PrivateMessageCampaign, PrivateMessageError> {
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let now = metrics::now_ts();
        let campaign = next
            .campaigns
            .iter_mut()
            .find(|campaign| campaign.id == campaign_id && campaign.sender.id == sender_id)
            .ok_or(PrivateMessageError::NotFound)?;
        match action {
            PrivateMessageCampaignAction::Start => {
                if campaign.status != PrivateMessageCampaignStatus::Draft {
                    return Err(PrivateMessageError::Validation(
                        "Seul un brouillon peut etre demarre".to_string(),
                    ));
                }
                if consent_confirmed {
                    campaign.consent_confirmed = true;
                }
                if !campaign.consent_confirmed {
                    return Err(PrivateMessageError::Validation(
                        "Le consentement des destinataires doit etre confirme".to_string(),
                    ));
                }
                campaign.status = PrivateMessageCampaignStatus::Running;
                campaign.next_delivery_at = Some(now);
            }
            PrivateMessageCampaignAction::Pause => {
                if campaign.status != PrivateMessageCampaignStatus::Running {
                    return Err(PrivateMessageError::Validation(
                        "Seule une campagne active peut etre mise en pause".to_string(),
                    ));
                }
                campaign.status = PrivateMessageCampaignStatus::Paused;
                campaign.next_delivery_at = None;
            }
            PrivateMessageCampaignAction::Resume => {
                if campaign.status != PrivateMessageCampaignStatus::Paused {
                    return Err(PrivateMessageError::Validation(
                        "Seule une campagne en pause peut etre reprise".to_string(),
                    ));
                }
                campaign.status = PrivateMessageCampaignStatus::Running;
                campaign.next_delivery_at = Some(now);
            }
            PrivateMessageCampaignAction::Cancel => {
                if matches!(
                    campaign.status,
                    PrivateMessageCampaignStatus::Completed
                        | PrivateMessageCampaignStatus::Cancelled
                        | PrivateMessageCampaignStatus::Failed
                ) {
                    return Err(PrivateMessageError::Validation(
                        "Cette campagne est deja terminee".to_string(),
                    ));
                }
                campaign.status = PrivateMessageCampaignStatus::Cancelled;
                campaign.next_delivery_at = None;
            }
        }
        campaign.updated_at = now;
        let result = campaign.clone();
        persist_store(&self.inner.storage_path, &next)?;
        *current = next;
        Ok(result)
    }

    /// Livre au plus un message par campagne due. L'ecriture du message et de
    /// l'avancement de campagne est atomique, ce qui empeche un doublon apres
    /// un redemarrage entre les deux operations.
    pub fn process_due_campaigns(
        &self,
        now: i64,
    ) -> Result<Vec<PrivateMessage>, PrivateMessageError> {
        let mut current = self.lock_store()?;
        let mut next = current.clone();
        let mut sent = Vec::new();
        let PrivateMessageStore {
            next_sequence,
            messages,
            campaigns,
            ..
        } = &mut next;

        for campaign in campaigns.iter_mut().filter(|campaign| {
            campaign.status == PrivateMessageCampaignStatus::Running
                && campaign.next_delivery_at.is_some_and(|due| due <= now)
        }) {
            let Some(delivery) = campaign
                .deliveries
                .iter_mut()
                .find(|delivery| delivery.status == PrivateMessageCampaignDeliveryStatus::Queued)
            else {
                campaign.status = PrivateMessageCampaignStatus::Completed;
                campaign.next_delivery_at = None;
                campaign.updated_at = now;
                continue;
            };
            if messages.len() >= MAX_MESSAGES {
                delivery.status = PrivateMessageCampaignDeliveryStatus::Failed;
                delivery.error = Some("Limite de stockage de la messagerie atteinte".to_string());
                campaign.status = PrivateMessageCampaignStatus::Failed;
                campaign.next_delivery_at = None;
                campaign.updated_at = now;
                continue;
            }
            *next_sequence = next_sequence.saturating_add(1).max(1);
            let message = PrivateMessage {
                id: Uuid::new_v4().to_string(),
                sender: campaign.sender.clone(),
                recipient: delivery.recipient.clone(),
                body: delivery.body.clone(),
                images: Vec::new(),
                created_at: now,
                sequence: *next_sequence,
                read_at: None,
            };
            delivery.status = PrivateMessageCampaignDeliveryStatus::Sent;
            delivery.sent_at = Some(now);
            delivery.message_id = Some(message.id.clone());
            messages.push(message.clone());
            sent.push(message);
            campaign.updated_at = now;
            if campaign
                .deliveries
                .iter()
                .all(|delivery| delivery.status != PrivateMessageCampaignDeliveryStatus::Queued)
            {
                campaign.status = PrivateMessageCampaignStatus::Completed;
                campaign.next_delivery_at = None;
            } else {
                campaign.next_delivery_at =
                    Some(now.saturating_add(campaign.interval_seconds as i64));
            }
        }

        if next != *current {
            persist_store(&self.inner.storage_path, &next)?;
            *current = next;
        }
        Ok(sent)
    }

    pub fn image_content(
        &self,
        viewer_id: &str,
        image_id: &str,
    ) -> Result<PrivateMessageImageContent, PrivateMessageError> {
        let metadata = {
            let store = self.lock_store()?;
            store
                .messages
                .iter()
                .filter(|message| message_involves(message, viewer_id))
                .flat_map(|message| message.images.iter())
                .find(|image| image.id == image_id)
                .cloned()
                .ok_or(PrivateMessageError::NotFound)?
        };
        let extension = private_message_image_extension(&metadata.mime_type)
            .ok_or_else(|| PrivateMessageError::Internal("Format d'image inconnu".to_string()))?;
        let path = private_message_image_path(&self.inner.images_path, &metadata.id, extension)?;
        let bytes = fs::read(path).map_err(|error| {
            PrivateMessageError::Internal(format!("Lecture de l'image impossible : {error}"))
        })?;
        if validated_private_message_image_extension(&metadata.mime_type, &bytes).is_none() {
            return Err(PrivateMessageError::Internal(
                "Le fichier image stocke est invalide".to_string(),
            ));
        }
        Ok(PrivateMessageImageContent {
            mime_type: metadata.mime_type,
            data_base64: BASE64_STANDARD.encode(bytes),
        })
    }

    pub fn known_participant(
        &self,
        user_id: &str,
    ) -> Result<Option<PrivateMessageUser>, PrivateMessageError> {
        let store = self.lock_store()?;
        Ok(store.messages.iter().rev().find_map(|message| {
            if message.sender.id == user_id {
                Some(message.sender.clone())
            } else if message.recipient.id == user_id {
                Some(message.recipient.clone())
            } else {
                None
            }
        }))
    }

    pub fn known_conversation_participant(
        &self,
        viewer_id: &str,
        user_id: &str,
    ) -> Result<Option<PrivateMessageUser>, PrivateMessageError> {
        let store = self.lock_store()?;
        Ok(store.messages.iter().rev().find_map(|message| {
            if !message_between(message, viewer_id, user_id) {
                return None;
            }
            Some(other_user(message, viewer_id).clone())
        }))
    }

    pub fn known_users(&self) -> Result<Vec<PrivateMessageUser>, PrivateMessageError> {
        let store = self.lock_store()?;
        let mut users = HashMap::<String, PrivateMessageUser>::new();
        for message in &store.messages {
            users.insert(message.sender.id.clone(), message.sender.clone());
            users.insert(message.recipient.id.clone(), message.recipient.clone());
        }
        Ok(users.into_values().collect())
    }

    fn lock_store(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, PrivateMessageStore>, PrivateMessageError> {
        self.inner.store.lock().map_err(|_| {
            PrivateMessageError::Internal("Etat de la messagerie verrouille".to_string())
        })
    }
}

pub(crate) async fn run_private_message_campaign_worker(
    manager: PrivateMessageManager,
    runtime_sync: RuntimeSync,
) {
    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        let worker = manager.clone();
        let delivered =
            tokio::task::spawn_blocking(move || worker.process_due_campaigns(metrics::now_ts()))
                .await;
        match delivered {
            Ok(Ok(messages)) => {
                for message in messages {
                    runtime_sync.notify_private_messages([message.sender.id, message.recipient.id]);
                }
            }
            Ok(Err(error)) => eprintln!("[messaging] campagne non traitee : {error}"),
            Err(error) => eprintln!("[messaging] worker de campagne interrompu : {error}"),
        }
    }
}

fn message_involves(message: &PrivateMessage, user_id: &str) -> bool {
    message.sender.id == user_id || message.recipient.id == user_id
}

fn message_between(message: &PrivateMessage, left_id: &str, right_id: &str) -> bool {
    (message.sender.id == left_id && message.recipient.id == right_id)
        || (message.sender.id == right_id && message.recipient.id == left_id)
}

fn other_user<'a>(message: &'a PrivateMessage, viewer_id: &str) -> &'a PrivateMessageUser {
    if message.sender.id == viewer_id {
        &message.recipient
    } else {
        &message.sender
    }
}

fn validate_body(body: String, has_images: bool) -> Result<String, PrivateMessageError> {
    let body = body.trim().to_string();
    if body.is_empty() && !has_images {
        return Err(PrivateMessageError::Validation(
            "Le message ne peut pas etre vide".to_string(),
        ));
    }
    if body.contains('\0') {
        return Err(PrivateMessageError::Validation(
            "Le message contient un caractere invalide".to_string(),
        ));
    }
    if body.chars().count() > MAX_MESSAGE_CHARS {
        return Err(PrivateMessageError::Validation(format!(
            "Le message ne peut pas depasser {MAX_MESSAGE_CHARS} caracteres"
        )));
    }
    Ok(body)
}

fn default_campaign_interval_seconds() -> u64 {
    30
}

fn normalize_campaign_creator(value: &str) -> String {
    match value.trim() {
        "autonomous_agent" => "autonomous_agent",
        _ => "human",
    }
    .to_string()
}

fn validate_campaign_idempotency_key(value: &str) -> Result<String, PrivateMessageError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 160
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._:-".contains(&byte))
    {
        return Err(PrivateMessageError::Validation(
            "La cle d'idempotence de campagne est invalide".to_string(),
        ));
    }
    Ok(value.to_string())
}

fn render_campaign_message(
    template: &str,
    recipient: &PrivateMessageUser,
    index: usize,
    total: usize,
) -> String {
    template
        .replace("{{username}}", &recipient.username)
        .replace("{{index}}", &index.to_string())
        .replace("{{total}}", &total.to_string())
}

fn format_campaign_date(timestamp: i64) -> String {
    chrono::DateTime::from_timestamp(timestamp, 0)
        .map(|date| date.format("%d/%m/%Y %H:%M").to_string())
        .unwrap_or_else(|| timestamp.to_string())
}

fn prepare_private_message_images(
    images: Vec<PrivateMessageImageRequest>,
) -> Result<Vec<PreparedPrivateMessageImage>, PrivateMessageError> {
    if images.len() > MAX_MESSAGE_IMAGES {
        return Err(PrivateMessageError::Validation(format!(
            "Un message peut contenir au maximum {MAX_MESSAGE_IMAGES} images"
        )));
    }

    let mut prepared = Vec::with_capacity(images.len());
    let mut total_bytes = 0_usize;
    for (index, image) in images.into_iter().enumerate() {
        let mime_type = image.mime_type.trim().to_ascii_lowercase();
        let encoded = image.data_base64.trim();
        let max_encoded_bytes = ((MAX_MESSAGE_IMAGE_BYTES + 2) / 3) * 4;
        if encoded.is_empty() || encoded.len() > max_encoded_bytes {
            return Err(PrivateMessageError::Validation(format!(
                "L'image {} depasse 8 Mo",
                index + 1
            )));
        }
        let bytes = BASE64_STANDARD.decode(encoded).map_err(|_| {
            PrivateMessageError::Validation(format!("Donnees de l'image {} invalides", index + 1))
        })?;
        if bytes.is_empty() || bytes.len() > MAX_MESSAGE_IMAGE_BYTES {
            return Err(PrivateMessageError::Validation(format!(
                "L'image {} depasse 8 Mo",
                index + 1
            )));
        }
        total_bytes = total_bytes.saturating_add(bytes.len());
        if total_bytes > MAX_MESSAGE_IMAGE_TOTAL_BYTES {
            return Err(PrivateMessageError::Validation(
                "Les images d'un message depassent 20 Mo au total".to_string(),
            ));
        }
        let extension =
            validated_private_message_image_extension(&mime_type, &bytes).ok_or_else(|| {
                PrivateMessageError::Validation(format!("Format de l'image {} invalide", index + 1))
            })?;
        let supplied_name = image.name.trim();
        if supplied_name.chars().count() > 160 || supplied_name.chars().any(char::is_control) {
            return Err(PrivateMessageError::Validation(format!(
                "Nom de l'image {} invalide",
                index + 1
            )));
        }
        let name = if supplied_name.is_empty() {
            format!("Image {}.{extension}", index + 1)
        } else {
            supplied_name.to_string()
        };
        prepared.push(PreparedPrivateMessageImage {
            metadata: PrivateMessageImage {
                id: Uuid::new_v4().to_string(),
                name,
                mime_type,
                size: bytes.len() as u64,
            },
            bytes,
            extension,
        });
    }
    Ok(prepared)
}

fn validated_private_message_image_extension(
    mime_type: &str,
    bytes: &[u8],
) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" if bytes.starts_with(b"\x89PNG\r\n\x1a\n") => Some("png"),
        "image/jpeg" if bytes.starts_with(&[0xff, 0xd8, 0xff]) => Some("jpg"),
        "image/webp"
            if bytes.len() >= 12
                && bytes.starts_with(b"RIFF")
                && bytes.get(8..12) == Some(b"WEBP") =>
        {
            Some("webp")
        }
        _ => None,
    }
}

fn private_message_image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        _ => None,
    }
}

fn private_message_image_path(
    images_path: &Path,
    image_id: &str,
    extension: &str,
) -> Result<PathBuf, PrivateMessageError> {
    let id = Uuid::parse_str(image_id)
        .map_err(|_| PrivateMessageError::Internal("Identifiant d'image invalide".to_string()))?;
    Ok(images_path.join(format!("{}.{extension}", id)))
}

fn remove_private_message_image_files(paths: &[PathBuf]) {
    for path in paths {
        let _ = fs::remove_file(path);
    }
}

fn normalize_store(store: &mut PrivateMessageStore) -> bool {
    let mut changed = false;
    if store.version != STORE_VERSION {
        store.version = STORE_VERSION;
        changed = true;
    }
    let mut next = store.next_sequence.max(
        store
            .messages
            .iter()
            .map(|message| message.sequence)
            .max()
            .unwrap_or(0),
    );
    for message in &mut store.messages {
        if message.sequence == 0 {
            next = next.saturating_add(1).max(1);
            message.sequence = next;
            changed = true;
        }
    }
    if store.next_sequence != next {
        store.next_sequence = next;
        changed = true;
    }
    changed
}

fn load_store(path: &Path) -> Result<PrivateMessageStore, PrivateMessageError> {
    if !path.exists() {
        return Ok(PrivateMessageStore::default());
    }
    let content = fs::read_to_string(path).map_err(|error| {
        PrivateMessageError::Internal(format!("Lecture de la messagerie impossible : {error}"))
    })?;
    match serde_json::from_str::<PrivateMessageStore>(&content) {
        Ok(store) if store.version <= STORE_VERSION => Ok(store),
        Ok(store) => Err(PrivateMessageError::Internal(format!(
            "Version de messagerie non supportee : {}",
            store.version
        ))),
        Err(error) => {
            let backup = path.with_extension(format!("corrupt-{}.json", metrics::now_ts()));
            fs::rename(path, &backup).map_err(|rename_error| {
                PrivateMessageError::Internal(format!(
                    "Messagerie illisible ({error}) et sauvegarde impossible ({rename_error})"
                ))
            })?;
            Ok(PrivateMessageStore::default())
        }
    }
}

fn persist_store(path: &Path, store: &PrivateMessageStore) -> Result<(), PrivateMessageError> {
    let content = serde_json::to_vec_pretty(store)
        .map_err(|error| PrivateMessageError::Internal(error.to_string()))?;
    fs_util::atomic_write(path, content).map_err(|error| {
        PrivateMessageError::Internal(format!("Ecriture de la messagerie impossible : {error}"))
    })
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn list_private_message_users(
    state: State<'_, PrivateMessageManager>,
) -> Result<Vec<PrivateMessageUser>, String> {
    let local_id = PrivateMessageUser::local().id;
    state
        .known_users()
        .map(|users| {
            users
                .into_iter()
                .filter(|user| user.id != local_id)
                .collect()
        })
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn list_private_message_conversations(
    state: State<'_, PrivateMessageManager>,
) -> Result<Vec<PrivateConversationSummary>, String> {
    state
        .list_conversations(&PrivateMessageUser::local().id)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn get_private_message_conversation(
    state: State<'_, PrivateMessageManager>,
    user_id: String,
) -> Result<PrivateConversation, String> {
    let other = state
        .known_participant(&user_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| PrivateMessageError::NotFound.to_string())?;
    state
        .conversation(&PrivateMessageUser::local(), &other)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn send_private_message(
    state: State<'_, PrivateMessageManager>,
    user_id: String,
    body: String,
    images: Option<Vec<PrivateMessageImageRequest>>,
) -> Result<PrivateMessage, String> {
    let recipient = state
        .known_participant(&user_id)
        .map_err(|error| error.to_string())?
        .ok_or_else(|| PrivateMessageError::NotFound.to_string())?;
    state
        .send_with_images(
            PrivateMessageUser::local(),
            recipient,
            body,
            images.unwrap_or_default(),
        )
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn get_private_message_image(
    state: State<'_, PrivateMessageManager>,
    image_id: String,
) -> Result<PrivateMessageImageContent, String> {
    state
        .image_content(&PrivateMessageUser::local().id, &image_id)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn list_private_message_campaigns(
    state: State<'_, PrivateMessageManager>,
) -> Result<Vec<PrivateMessageCampaign>, String> {
    state
        .list_campaigns(&PrivateMessageUser::local().id)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn create_private_message_campaign(
    state: State<'_, PrivateMessageManager>,
    request: CreatePrivateMessageCampaignRequest,
) -> Result<PrivateMessageCampaign, String> {
    let recipients = request
        .recipient_ids
        .iter()
        .map(|user_id| {
            state
                .known_participant(user_id)
                .map_err(|error| error.to_string())?
                .ok_or_else(|| PrivateMessageError::NotFound.to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    state
        .create_campaign(PrivateMessageUser::local(), recipients, request, "human")
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[tauri::command]
pub fn control_private_message_campaign(
    state: State<'_, PrivateMessageManager>,
    campaign_id: String,
    action: PrivateMessageCampaignAction,
    consent_confirmed: Option<bool>,
) -> Result<PrivateMessageCampaign, String> {
    state
        .control_campaign(
            &PrivateMessageUser::local().id,
            &campaign_id,
            action,
            consent_confirmed.unwrap_or(false),
        )
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manager(name: &str) -> (PathBuf, PrivateMessageManager) {
        let root = std::env::temp_dir().join(format!("cst-private-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let manager = PrivateMessageManager::new(root.join("private-messages.json")).unwrap();
        (root, manager)
    }

    fn user(id: &str) -> PrivateMessageUser {
        PrivateMessageUser::new(id.to_string(), format!("user-{id}"), None)
    }

    fn png_image(name: &str) -> PrivateMessageImageRequest {
        PrivateMessageImageRequest {
            name: name.to_string(),
            mime_type: "image/png".to_string(),
            data_base64: BASE64_STANDARD.encode(b"\x89PNG\r\n\x1a\nmessage-image"),
        }
    }

    fn campaign_request(recipients: &[&str]) -> CreatePrivateMessageCampaignRequest {
        CreatePrivateMessageCampaignRequest {
            name: "Bienvenue".to_string(),
            recipient_ids: recipients.iter().map(|id| (*id).to_string()).collect(),
            message_variants: vec![
                "Bonjour {{username}} ({{index}}/{{total}})".to_string(),
                "Salut {{username}}".to_string(),
            ],
            interval_seconds: MIN_CAMPAIGN_INTERVAL_SECONDS,
            start_immediately: true,
            consent_confirmed: true,
            idempotency_key: None,
        }
    }

    #[test]
    fn une_conversation_reste_invisible_aux_autres_utilisateurs() {
        let (root, manager) = test_manager("privacy");
        manager
            .send(user("a"), user("b"), "Secret AB".to_string())
            .unwrap();
        assert_eq!(manager.list_conversations("a").unwrap().len(), 1);
        assert_eq!(manager.list_conversations("b").unwrap().len(), 1);
        assert!(manager.list_conversations("c").unwrap().is_empty());
        assert!(manager
            .conversation(&user("c"), &user("a"))
            .unwrap()
            .messages
            .is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ouvrir_un_fil_marque_uniquement_les_messages_recus_comme_lus() {
        let (root, manager) = test_manager("unread");
        manager
            .send(user("a"), user("b"), "Bonjour B".to_string())
            .unwrap();
        manager
            .send(user("b"), user("a"), "Bonjour A".to_string())
            .unwrap();
        assert_eq!(manager.list_conversations("b").unwrap()[0].unread_count, 1);
        let (thread, marked_read) = manager
            .conversation_with_read_status(&user("b"), &user("a"))
            .unwrap();
        assert!(marked_read);
        assert!(thread.messages[0].read_at.is_some());
        assert!(thread.messages[1].read_at.is_none());
        assert_eq!(manager.list_conversations("b").unwrap()[0].unread_count, 0);
        assert!(
            !manager
                .conversation_with_read_status(&user("b"), &user("a"))
                .unwrap()
                .1
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn les_messages_survivent_au_rechargement() {
        let (root, manager) = test_manager("persistence");
        manager
            .send(user("a"), user("b"), "Message durable".to_string())
            .unwrap();
        let reloaded = PrivateMessageManager::new(root.join("private-messages.json")).unwrap();
        assert_eq!(
            reloaded
                .conversation(&user("a"), &user("b"))
                .unwrap()
                .messages[0]
                .body,
            "Message durable"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn une_image_seule_est_persistante_et_reservee_aux_participants() {
        let (root, manager) = test_manager("image");
        let sent = manager
            .send_with_images(
                user("a"),
                user("b"),
                String::new(),
                vec![png_image("preuve.png")],
            )
            .unwrap();
        assert!(sent.body.is_empty());
        assert_eq!(sent.images.len(), 1);
        assert_eq!(sent.images[0].name, "preuve.png");
        let image_id = sent.images[0].id.clone();
        let content = manager.image_content("b", &image_id).unwrap();
        assert_eq!(content.mime_type, "image/png");
        assert!(matches!(
            manager.image_content("c", &image_id),
            Err(PrivateMessageError::NotFound)
        ));

        let reloaded = PrivateMessageManager::new(root.join("private-messages.json")).unwrap();
        assert_eq!(
            reloaded.image_content("a", &image_id).unwrap().data_base64,
            content.data_base64
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn une_fausse_image_est_refusee_avant_ecriture() {
        let (root, manager) = test_manager("invalid-image");
        let invalid = PrivateMessageImageRequest {
            name: "fausse.png".to_string(),
            mime_type: "image/png".to_string(),
            data_base64: BASE64_STANDARD.encode(b"pas une image"),
        };
        assert!(matches!(
            manager.send_with_images(user("a"), user("b"), String::new(), vec![invalid]),
            Err(PrivateMessageError::Validation(_))
        ));
        assert!(manager.list_conversations("a").unwrap().is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn un_message_vide_est_refuse() {
        let (root, manager) = test_manager("validation");
        assert!(matches!(
            manager.send(user("a"), user("b"), "  ".to_string()),
            Err(PrivateMessageError::Validation(_))
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn une_campagne_personnalise_et_livre_sans_doublon() {
        let (root, manager) = test_manager("campaign");
        let mut request = campaign_request(&["b", "c"]);
        request.idempotency_key = Some("agent:welcome:2026-07".to_string());
        let campaign = manager
            .create_campaign(
                user("a"),
                vec![user("b"), user("c")],
                request,
                "autonomous_agent",
            )
            .unwrap();
        assert_eq!(campaign.status, PrivateMessageCampaignStatus::Running);
        assert_eq!(campaign.created_by, "autonomous_agent");
        assert_eq!(campaign.deliveries[0].body, "Bonjour user-b (1/2)");
        let mut retry_request = campaign_request(&["b", "c"]);
        retry_request.idempotency_key = Some("agent:welcome:2026-07".to_string());
        let retried = manager
            .create_campaign(
                user("a"),
                vec![user("b"), user("c")],
                retry_request,
                "autonomous_agent",
            )
            .unwrap();
        assert_eq!(retried.id, campaign.id);
        assert_eq!(manager.list_campaigns("a").unwrap().len(), 1);

        let first = manager.process_due_campaigns(campaign.created_at).unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(first[0].recipient.id, "b");
        assert!(manager
            .process_due_campaigns(campaign.created_at)
            .unwrap()
            .is_empty());
        let second = manager
            .process_due_campaigns(campaign.created_at + MIN_CAMPAIGN_INTERVAL_SECONDS as i64)
            .unwrap();
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].recipient.id, "c");

        let saved = manager.list_campaigns("a").unwrap().remove(0);
        assert_eq!(saved.status, PrivateMessageCampaignStatus::Completed);
        assert_eq!(saved.sent_count(), 2);
        assert_eq!(saved.failed_count(), 0);
        assert_eq!(
            manager
                .conversation(&user("a"), &user("b"))
                .unwrap()
                .messages
                .len(),
            1
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn une_campagne_ne_demarre_jamais_sans_consentement_confirme() {
        let (root, manager) = test_manager("campaign-consent");
        let mut request = campaign_request(&["b"]);
        request.consent_confirmed = false;
        assert!(matches!(
            manager.create_campaign(user("a"), vec![user("b")], request, "human"),
            Err(PrivateMessageError::Validation(_))
        ));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn une_campagne_dedoublonne_ses_destinataires() {
        let (root, manager) = test_manager("campaign-dedup");
        let campaign = manager
            .create_campaign(
                user("a"),
                vec![user("b"), user("b"), user("c")],
                campaign_request(&["b", "b", "c"]),
                "human",
            )
            .unwrap();
        assert_eq!(campaign.deliveries.len(), 2);
        assert_eq!(campaign.deliveries[0].recipient.id, "b");
        assert_eq!(campaign.deliveries[1].recipient.id, "c");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn une_lecture_non_persistable_ne_modifie_pas_les_non_lus_en_memoire() {
        let (root, manager) = test_manager("read-rollback");
        manager
            .send(user("a"), user("b"), "Bonjour B".to_string())
            .unwrap();
        assert_eq!(manager.list_conversations("b").unwrap()[0].unread_count, 1);

        fs::remove_dir_all(&root).unwrap();
        fs::write(&root, "bloque le repertoire de stockage").unwrap();

        assert!(matches!(
            manager.conversation(&user("b"), &user("a")),
            Err(PrivateMessageError::Internal(_))
        ));
        assert_eq!(manager.list_conversations("b").unwrap()[0].unread_count, 1);

        let _ = fs::remove_file(root);
    }
}
