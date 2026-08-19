//! Politique centralisee du connecteur TikTok.
//!
//! Ce module contient les autorisations, confirmations, limites et validations
//! appliquees avant que le pipeline de messagerie ou d'extraction ne modifie
//! son etat. Le reste du connecteur ne doit faire qu'appeler cette politique.

use crate::tiktok_messaging::{
    ConfirmTikTokDmCampaignRequest, PrepareTikTokDmCampaignRequest,
    QueueTikTokFollowerExtractionRequest, TikTokDmError, TikTokFollowerDmPipeline,
};
use std::collections::HashSet;
use uuid::Uuid;

pub(crate) const MAX_TIKTOK_DM_RECIPIENTS: usize = 5;
pub(crate) const MAX_TIKTOK_DM_MESSAGE_CHARS: usize = 500;
pub(crate) const MAX_TIKTOK_FOLLOWER_RESULTS: usize = 1_000;
pub(crate) const MAX_TIKTOK_DM_CAMPAIGNS: usize = 500;
pub(crate) const MAX_TIKTOK_FOLLOWER_EXTRACTIONS: usize = 500;

const MAX_IDEMPOTENCY_KEY_CHARS: usize = 160;
const MIN_INTERVAL_MINUTES: u8 = 1;
const MAX_INTERVAL_MINUTES: u8 = 10;

pub(crate) struct ValidatedCampaignRequest {
    pub owner_id: String,
    pub recipients: Vec<String>,
    pub message: String,
    pub min_interval_minutes: u8,
    pub max_interval_minutes: u8,
    pub device_serial: Option<String>,
    pub sender_account: Option<String>,
    pub idempotency_key: String,
}

pub(crate) struct ValidatedFollowerExtractionRequest {
    pub owner_id: String,
    pub target_username: String,
    pub max_count: u16,
    pub device_serial: Option<String>,
    pub authorized_account_confirmed: bool,
    pub dm_pipeline: Option<TikTokFollowerDmPipeline>,
    pub idempotency_key: String,
}

pub(crate) fn validate_campaign_request(
    owner_id: &str,
    request: PrepareTikTokDmCampaignRequest,
) -> Result<ValidatedCampaignRequest, TikTokDmError> {
    validate_intervals(request.min_interval_minutes, request.max_interval_minutes)?;
    Ok(ValidatedCampaignRequest {
        owner_id: validate_owner_id(owner_id)?,
        recipients: validate_recipients(request.recipients)?,
        message: validate_message(request.message)?,
        min_interval_minutes: request.min_interval_minutes,
        max_interval_minutes: request.max_interval_minutes,
        device_serial: request
            .device_serial
            .as_deref()
            .map(validate_device_serial)
            .transpose()?,
        sender_account: request
            .sender_account
            .as_deref()
            .map(normalize_tiktok_username)
            .transpose()?,
        idempotency_key: validate_idempotency_key(&request.idempotency_key)?,
    })
}

pub(crate) fn campaign_confirmation_guard(request: &ConfirmTikTokDmCampaignRequest) -> bool {
    request.owned_accounts_confirmed && request.send_confirmed
}

pub(crate) fn campaign_confirmation_rejection() -> TikTokDmError {
    TikTokDmError::Validation(
        "Confirmez que tous les destinataires sont vos comptes de test et que l'envoi est autorise"
            .to_string(),
    )
}

pub(crate) fn follower_extraction_guard(request: &QueueTikTokFollowerExtractionRequest) -> bool {
    request.authorized_account_confirmed
        && request.max_count > 0
        && usize::from(request.max_count) <= MAX_TIKTOK_FOLLOWER_RESULTS
}

pub(crate) fn follower_extraction_rejection(
    request: &QueueTikTokFollowerExtractionRequest,
) -> TikTokDmError {
    if !request.authorized_account_confirmed {
        TikTokDmError::Validation(
            "Confirmez que le compte source vous appartient ou que vous etes autorise a en extraire les followers"
                .to_string(),
        )
    } else {
        TikTokDmError::Validation(format!(
            "La collecte TikTok doit demander entre 1 et {MAX_TIKTOK_FOLLOWER_RESULTS} followers"
        ))
    }
}

pub(crate) fn validate_follower_extraction_request(
    owner_id: &str,
    request: QueueTikTokFollowerExtractionRequest,
) -> Result<ValidatedFollowerExtractionRequest, TikTokDmError> {
    let dm_pipeline = request
        .dm_pipeline
        .map(|pipeline| {
            Ok(TikTokFollowerDmPipeline {
                owned_recipient_allowlist: validate_recipients(pipeline.owned_recipient_allowlist)?,
                message: validate_message(pipeline.message)?,
                owned_accounts_confirmed: pipeline.owned_accounts_confirmed,
                prepared_campaign_id: None,
                note: None,
            })
        })
        .transpose()?;

    Ok(ValidatedFollowerExtractionRequest {
        owner_id: validate_owner_id(owner_id)?,
        target_username: normalize_tiktok_username(&request.target_username)?,
        max_count: request.max_count,
        device_serial: request
            .device_serial
            .as_deref()
            .map(validate_device_serial)
            .transpose()?,
        authorized_account_confirmed: request.authorized_account_confirmed,
        dm_pipeline,
        idempotency_key: validate_idempotency_key(&request.idempotency_key)?,
    })
}

pub(crate) fn ensure_campaign_capacity(current_count: usize) -> Result<(), TikTokDmError> {
    if current_count >= MAX_TIKTOK_DM_CAMPAIGNS {
        Err(TikTokDmError::Validation(
            "La limite de campagnes TikTok archivees est atteinte".to_string(),
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn campaign_capacity_available(current_count: usize) -> bool {
    current_count < MAX_TIKTOK_DM_CAMPAIGNS
}

pub(crate) fn campaign_capacity_note() -> String {
    "La collecte est terminee, mais la limite de campagnes TikTok archivees empeche de creer le brouillon."
        .to_string()
}

pub(crate) fn ensure_follower_extraction_capacity(
    current_count: usize,
) -> Result<(), TikTokDmError> {
    if current_count >= MAX_TIKTOK_FOLLOWER_EXTRACTIONS {
        Err(TikTokDmError::Validation(
            "La limite de collectes TikTok archivees est atteinte".to_string(),
        ))
    } else {
        Ok(())
    }
}

pub(crate) fn validate_owner_id(value: &str) -> Result<String, TikTokDmError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 160 || value.chars().any(char::is_control) {
        return Err(TikTokDmError::Validation(
            "Proprietaire de campagne invalide".to_string(),
        ));
    }
    Ok(value.to_string())
}

pub(crate) fn validate_recipients(values: Vec<String>) -> Result<Vec<String>, TikTokDmError> {
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

pub(crate) fn normalize_tiktok_username(value: &str) -> Result<String, TikTokDmError> {
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

pub(crate) fn validate_message(value: String) -> Result<String, TikTokDmError> {
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

pub(crate) fn validate_device_serial(value: &str) -> Result<String, TikTokDmError> {
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

pub(crate) fn validate_connector_id(value: &str) -> Result<String, TikTokDmError> {
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

pub(crate) fn validate_campaign_id(value: &str) -> Result<String, TikTokDmError> {
    Uuid::parse_str(value.trim())
        .map(|uuid| uuid.to_string())
        .map_err(|_| TikTokDmError::Validation("Identifiant de campagne invalide".to_string()))
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
