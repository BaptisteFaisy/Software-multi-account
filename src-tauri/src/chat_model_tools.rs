//! Outils MCP exposes uniquement aux tours de chat normaux du serveur web.
//!
//! Chaque tour recoit un jeton de capacite aleatoire qui lie les actions du
//! modele au compte, au dossier et au chat source. Le modele ne peut donc ni
//! choisir un autre compte, ni rattacher l'agent a une autre conversation. Les
//! politiques partagees peuvent ignorer la cle du chat, mais jamais les bornes
//! de compte et de projet portees par cette capacite.

use crate::{
    autonomous::{
        AutonomousAgentSnapshot, AutonomousAgentStatus, AutonomousTriggerKind,
        CreateAutonomousAgentRequest, UpdateAutonomousAgentRequest,
    },
    chat::{ChatAppConnector, ChatTurnMode},
    metrics,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub const AUTONOMOUS_AGENT_TOOL_NAME: &str = "create_autonomous_agent";
pub const UPDATE_AUTONOMOUS_AGENT_TOOL_NAME: &str = "update_autonomous_agent";
pub const PAUSE_AUTONOMOUS_AGENT_TOOL_NAME: &str = "pause_autonomous_agent";
pub const APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME: &str = "apply_autonomous_agent_policy";
pub const ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME: &str = "activate_supervisor_general_report";
pub const CREATE_CHAT_TOOL_NAME: &str = "create_chat";
pub const LIST_OUTLOOK_MESSAGES_TOOL_NAME: &str = "list_outlook_messages";
pub const LIST_CALENDAR_EVENTS_TOOL_NAME: &str = "list_calendar_events";
pub const SEND_OUTLOOK_EMAIL_TOOL_NAME: &str = "send_outlook_email";
pub const CREATE_CALENDAR_EVENT_TOOL_NAME: &str = "create_calendar_event";
pub const UPDATE_CALENDAR_EVENT_TOOL_NAME: &str = "update_calendar_event";
pub const MCP_SERVER_NAME: &str = "cst_chat";
pub const MCP_BEARER_ENV: &str = "CST_CHAT_AUTONOMOUS_TOOL_TOKEN";
const CAPABILITY_TTL_SECONDS: i64 = 2 * 60 * 60;
const MAX_TOOL_CALLS_PER_TURN: u8 = 8;
const MAX_CHAT_CREATIONS_PER_TURN: u8 = 1;
/// Sous-quota des actions qui sortent de l'application (e-mail, agenda). Le
/// budget global de 8 appels est partage avec les outils d'agents : sans ce
/// plafond, une boucle de redaction epuiserait le tour a elle seule.
const MAX_EXTERNAL_ACTIONS_PER_TURN: u8 = 3;
const CHAT_OPEN_REQUEST_TTL_SECONDS: i64 = 2 * 60 * 60;
const MAX_PENDING_CHAT_OPEN_REQUESTS: usize = 32;
const MAX_CHAT_PROMPT_LENGTH: usize = 32_768;

#[derive(Debug, Clone)]
pub(crate) struct ChatModelToolServerConfig {
    pub url: String,
    pub bearer_token: String,
}

/// Etendue des outils accordee a un porteur de capacite.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ChatToolScope {
    /// Chat interactif : un humain lit la reponse et peut reagir.
    Full,
    /// Cycle d'agent autonome : uniquement les outils qui touchent aux donnees
    /// personnelles de son proprietaire. Un agent qui tourne seul, sans personne
    /// devant l'ecran, n'a rien a faire avec la creation d'autres agents ou
    /// l'ouverture de chats — il se dupliquerait sans controle.
    PersonalDataOnly,
}

/// Outils qui travaillent sur le compte Microsoft de l'utilisateur.
pub(crate) const MICROSOFT_TOOL_NAMES: [&str; 5] = [
    LIST_OUTLOOK_MESSAGES_TOOL_NAME,
    LIST_CALENDAR_EVENTS_TOOL_NAME,
    SEND_OUTLOOK_EMAIL_TOOL_NAME,
    CREATE_CALENDAR_EVENT_TOOL_NAME,
    UPDATE_CALENDAR_EVENT_TOOL_NAME,
];

impl ChatToolScope {
    pub fn allows(&self, tool_name: &str) -> bool {
        match self {
            Self::Full => true,
            Self::PersonalDataOnly => MICROSOFT_TOOL_NAMES.contains(&tool_name),
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct AutonomousAgentToolContext {
    pub account_id: String,
    pub scope: ChatToolScope,
    /// Compte utilisateur nominatif (`AuthIdentity.id`) qui a demarre le tour.
    /// `None` pour un tour lance avec le jeton administrateur. C'est la seule
    /// cle acceptable pour retrouver une boite Microsoft : `account_id` designe
    /// un profil CLI, partageable entre plusieurs personnes.
    pub user_id: Option<String>,
    pub source_chat_key: Option<String>,
    pub project_dir: Option<String>,
    pub mode: ChatTurnMode,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone)]
struct ChatToolCapability {
    context: AutonomousAgentToolContext,
    expires_at: i64,
    calls: u8,
    chat_creations: u8,
    external_actions: u8,
}

#[derive(Clone, Default)]
pub(crate) struct ChatToolCapabilityRegistry {
    inner: Arc<Mutex<HashMap<String, ChatToolCapability>>>,
}

impl ChatToolCapabilityRegistry {
    pub fn issue(&self, context: AutonomousAgentToolContext) -> Result<String, String> {
        let now = metrics::now_ts();
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        let mut entries = self
            .inner
            .lock()
            .map_err(|_| "Registre des outils du chat verrouille".to_string())?;
        entries.retain(|_, entry| entry.expires_at > now);
        entries.insert(
            token.clone(),
            ChatToolCapability {
                context,
                expires_at: now.saturating_add(CAPABILITY_TTL_SECONDS),
                calls: 0,
                chat_creations: 0,
                external_actions: 0,
            },
        );
        Ok(token)
    }

    pub fn authorize(&self, token: &str) -> Result<AutonomousAgentToolContext, String> {
        let now = metrics::now_ts();
        let mut entries = self
            .inner
            .lock()
            .map_err(|_| "Registre des outils du chat verrouille".to_string())?;
        entries.retain(|_, entry| entry.expires_at > now);
        entries
            .get(token)
            .map(|entry| entry.context.clone())
            .ok_or_else(|| "Capacite MCP absente ou expiree".to_string())
    }

    pub fn claim_call(&self, token: &str) -> Result<AutonomousAgentToolContext, String> {
        let now = metrics::now_ts();
        let mut entries = self
            .inner
            .lock()
            .map_err(|_| "Registre des outils du chat verrouille".to_string())?;
        entries.retain(|_, entry| entry.expires_at > now);
        let entry = entries
            .get_mut(token)
            .ok_or_else(|| "Capacite MCP absente ou expiree".to_string())?;
        if entry.calls >= MAX_TOOL_CALLS_PER_TURN {
            return Err("Limite d'actions autonomes atteinte pour ce tour".to_string());
        }
        entry.calls = entry.calls.saturating_add(1);
        Ok(entry.context.clone())
    }

    pub fn claim_chat_creation(&self, token: &str) -> Result<AutonomousAgentToolContext, String> {
        let now = metrics::now_ts();
        let mut entries = self
            .inner
            .lock()
            .map_err(|_| "Registre des outils du chat verrouille".to_string())?;
        entries.retain(|_, entry| entry.expires_at > now);
        let entry = entries
            .get_mut(token)
            .ok_or_else(|| "Capacite MCP absente ou expiree".to_string())?;
        if entry.calls >= MAX_TOOL_CALLS_PER_TURN {
            return Err("Limite d'actions autonomes atteinte pour ce tour".to_string());
        }
        if entry.chat_creations >= MAX_CHAT_CREATIONS_PER_TURN {
            return Err("Un seul nouveau chat peut etre cree par tour".to_string());
        }
        entry.calls = entry.calls.saturating_add(1);
        entry.chat_creations = entry.chat_creations.saturating_add(1);
        Ok(entry.context.clone())
    }

    /// Consomme un appel ET une action externe. Utilise par les outils qui
    /// preparent un e-mail ou une ecriture d'agenda : ils ne partent qu'apres
    /// confirmation humaine, mais chaque brouillon coute a l'utilisateur une
    /// carte a relire.
    pub fn claim_external_action(
        &self,
        token: &str,
    ) -> Result<AutonomousAgentToolContext, String> {
        let now = metrics::now_ts();
        let mut entries = self
            .inner
            .lock()
            .map_err(|_| "Registre des outils du chat verrouille".to_string())?;
        entries.retain(|_, entry| entry.expires_at > now);
        let entry = entries
            .get_mut(token)
            .ok_or_else(|| "Capacite MCP absente ou expiree".to_string())?;
        if entry.calls >= MAX_TOOL_CALLS_PER_TURN {
            return Err("Limite d'actions autonomes atteinte pour ce tour".to_string());
        }
        if entry.external_actions >= MAX_EXTERNAL_ACTIONS_PER_TURN {
            return Err(
                "Limite d'actions Microsoft atteinte pour ce tour ; traite les brouillons en attente avant d'en preparer d'autres"
                    .to_string(),
            );
        }
        entry.calls = entry.calls.saturating_add(1);
        entry.external_actions = entry.external_actions.saturating_add(1);
        Ok(entry.context.clone())
    }

    pub fn revoke(&self, token: &str) {
        if let Ok(mut entries) = self.inner.lock() {
            entries.remove(token);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateChatToolArguments {
    pub prompt: String,
    #[serde(default)]
    pub mode: Option<ChatTurnMode>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatOpenRequest {
    pub id: String,
    pub account_id: String,
    pub source_chat_key: Option<String>,
    pub project_dir: Option<String>,
    pub mode: ChatTurnMode,
    pub prompt: String,
    pub model: Option<String>,
    pub reasoning_effort: Option<String>,
    pub created_at: i64,
}

impl CreateChatToolArguments {
    pub fn into_request(
        self,
        context: &AutonomousAgentToolContext,
    ) -> Result<ChatOpenRequest, String> {
        let prompt = self.prompt.trim().to_string();
        if prompt.is_empty() {
            return Err("Le message initial du nouveau chat est requis".to_string());
        }
        if prompt.chars().count() > MAX_CHAT_PROMPT_LENGTH {
            return Err(format!(
                "Le message initial depasse {MAX_CHAT_PROMPT_LENGTH} caracteres"
            ));
        }
        Ok(ChatOpenRequest {
            id: Uuid::new_v4().to_string(),
            account_id: context.account_id.clone(),
            source_chat_key: context.source_chat_key.clone(),
            project_dir: context.project_dir.clone(),
            mode: self.mode.unwrap_or(context.mode),
            prompt,
            model: context.model.clone(),
            reasoning_effort: context.reasoning_effort.clone(),
            created_at: metrics::now_ts(),
        })
    }
}

#[derive(Clone, Default)]
pub(crate) struct ChatOpenRequestRegistry {
    inner: Arc<Mutex<VecDeque<ChatOpenRequest>>>,
}

impl ChatOpenRequestRegistry {
    pub fn enqueue(&self, request: ChatOpenRequest) -> Result<ChatOpenRequest, String> {
        let now = metrics::now_ts();
        let mut requests = self
            .inner
            .lock()
            .map_err(|_| "File d'ouverture des chats indisponible".to_string())?;
        requests.retain(|item| item.created_at + CHAT_OPEN_REQUEST_TTL_SECONDS >= now);
        if requests.len() >= MAX_PENDING_CHAT_OPEN_REQUESTS {
            return Err("Trop de demandes d'ouverture de chat sont en attente".to_string());
        }
        requests.push_back(request.clone());
        Ok(request)
    }

    pub fn claim(&self) -> Result<Vec<ChatOpenRequest>, String> {
        let now = metrics::now_ts();
        let mut requests = self
            .inner
            .lock()
            .map_err(|_| "File d'ouverture des chats indisponible".to_string())?;
        requests.retain(|item| item.created_at + CHAT_OPEN_REQUEST_TTL_SECONDS >= now);
        Ok(requests.drain(..).collect())
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateAutonomousAgentToolArguments {
    pub objective: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub mode: Option<ChatTurnMode>,
    #[serde(default)]
    pub interval_minutes: Option<u64>,
    #[serde(default)]
    pub require_user_review: Option<bool>,
    #[serde(default)]
    pub mobile_notifications_enabled: Option<bool>,
    #[serde(default)]
    pub initial_memory: Option<String>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub test_timeout_seconds: Option<u64>,
}

impl CreateAutonomousAgentToolArguments {
    pub fn into_request(
        self,
        context: AutonomousAgentToolContext,
    ) -> Result<CreateAutonomousAgentRequest, String> {
        let interval_seconds = self
            .interval_minutes
            .map(|minutes| {
                minutes
                    .checked_mul(60)
                    .ok_or_else(|| "Frequence autonome invalide".to_string())
            })
            .transpose()?;
        Ok(CreateAutonomousAgentRequest {
            name: self.name,
            objective: self.objective,
            role: self.role,
            source_chat_key: context.source_chat_key,
            source_proposal_id: None,
            source_report_id: None,
            source_report_idea_index: None,
            account_id: context.account_id,
            // L'agent cree depuis un chat herite du proprietaire de ce chat :
            // il travaillera plus tard sur la boite de cette personne, pas sur
            // une autre, et un tour administrateur n'en designe aucune.
            owner_id: context.user_id,
            project_dir: context.project_dir,
            mode: self.mode.unwrap_or(context.mode),
            require_user_review: self.require_user_review.unwrap_or(true),
            model: context.model,
            reasoning_effort: context.reasoning_effort,
            connectors: Vec::<ChatAppConnector>::new(),
            whatsapp_notification_channel_id: None,
            telegram_notification_channel_id: None,
            mobile_notifications_enabled: self.mobile_notifications_enabled.unwrap_or(false),
            interval_seconds,
            trigger_kind: AutonomousTriggerKind::Schedule,
            watch_paths: Vec::new(),
            debounce_seconds: None,
            allow_git_publish: false,
            initial_memory: self.initial_memory,
            test_command: self.test_command,
            test_timeout_seconds: self.test_timeout_seconds,
            defer_first_run: false,
        })
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateAutonomousAgentToolArguments {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub objective: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub clear_role: bool,
    #[serde(default)]
    pub mode: Option<ChatTurnMode>,
    #[serde(default)]
    pub interval_minutes: Option<u64>,
    #[serde(default)]
    pub require_user_review: Option<bool>,
    #[serde(default)]
    pub mobile_notifications_enabled: Option<bool>,
    #[serde(default)]
    pub test_command: Option<String>,
    #[serde(default)]
    pub clear_test_command: bool,
    #[serde(default)]
    pub test_timeout_seconds: Option<u64>,
}

impl UpdateAutonomousAgentToolArguments {
    pub fn into_request(
        self,
        agent: &AutonomousAgentSnapshot,
        activate: bool,
    ) -> Result<UpdateAutonomousAgentRequest, String> {
        let has_patch = self.name.is_some()
            || self.objective.is_some()
            || self.role.is_some()
            || self.clear_role
            || self.mode.is_some()
            || self.interval_minutes.is_some()
            || self.require_user_review.is_some()
            || self.mobile_notifications_enabled.is_some()
            || self.test_command.is_some()
            || self.clear_test_command
            || self.test_timeout_seconds.is_some();
        if !has_patch {
            return Err("Indique au moins une modification a appliquer".to_string());
        }
        if self.role.is_some() && self.clear_role {
            return Err("role et clearRole ne peuvent pas etre utilises ensemble".to_string());
        }
        if self.test_command.is_some() && self.clear_test_command {
            return Err(
                "testCommand et clearTestCommand ne peuvent pas etre utilises ensemble".to_string(),
            );
        }

        let interval_seconds = self
            .interval_minutes
            .map(|minutes| {
                minutes
                    .checked_mul(60)
                    .ok_or_else(|| "Frequence autonome invalide".to_string())
            })
            .transpose()?
            .unwrap_or(agent.interval_seconds);
        let role = if self.clear_role {
            None
        } else {
            self.role.or_else(|| agent.role.clone())
        };
        let test_command = if self.clear_test_command {
            None
        } else {
            self.test_command.or_else(|| agent.test_command.clone())
        };

        Ok(UpdateAutonomousAgentRequest {
            name: Some(self.name.unwrap_or_else(|| agent.name.clone())),
            objective: self.objective.unwrap_or_else(|| agent.objective.clone()),
            role,
            account_id: Some(agent.account_id.clone()),
            project_dir: agent.project_dir.clone(),
            mode: self.mode.unwrap_or(agent.mode),
            require_user_review: self
                .require_user_review
                .unwrap_or(agent.require_user_review),
            model: agent.model.clone(),
            reasoning_effort: agent.reasoning_effort.clone(),
            connectors: agent.connectors.clone(),
            whatsapp_notification_channel_id: None,
            telegram_notification_channel_id: None,
            mobile_notifications_enabled: self.mobile_notifications_enabled,
            interval_seconds: Some(interval_seconds),
            trigger_kind: Some(agent.trigger_kind),
            watch_paths: Some(agent.watch_paths.clone()),
            debounce_seconds: Some(agent.debounce_seconds),
            allow_git_publish: Some(agent.allow_git_publish),
            test_command,
            test_timeout_seconds: Some(
                self.test_timeout_seconds
                    .unwrap_or(agent.test_timeout_seconds),
            ),
            activate,
        })
    }
}

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum AutonomousAgentPolicyScope {
    CurrentProject,
    Account,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApplyAutonomousAgentPolicyToolArguments {
    pub instruction: String,
    #[serde(default)]
    pub require_visual_evidence: bool,
    #[serde(default)]
    pub scope: Option<AutonomousAgentPolicyScope>,
}

impl ApplyAutonomousAgentPolicyToolArguments {
    pub fn resolved_scope(
        &self,
        _context: &AutonomousAgentToolContext,
    ) -> AutonomousAgentPolicyScope {
        self.scope
            .unwrap_or(AutonomousAgentPolicyScope::CurrentProject)
    }
}

fn windows_style_project_path(value: &str) -> bool {
    value.contains('\\')
        || value
            .as_bytes()
            .get(1)
            .is_some_and(|separator| *separator == b':')
}

fn same_project(left: &str, right: &str) -> bool {
    let normalize = |value: &str| {
        value
            .trim()
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string()
    };
    let left_normalized = normalize(left);
    let right_normalized = normalize(right);
    if windows_style_project_path(left) || windows_style_project_path(right) {
        left_normalized.eq_ignore_ascii_case(&right_normalized)
    } else {
        left_normalized == right_normalized
    }
}

pub(crate) fn agents_for_policy_context(
    agents: &[AutonomousAgentSnapshot],
    context: &AutonomousAgentToolContext,
    scope: AutonomousAgentPolicyScope,
) -> Result<Vec<AutonomousAgentSnapshot>, String> {
    let project_dir = match scope {
        AutonomousAgentPolicyScope::CurrentProject => Some(
            context
                .project_dir
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    "Ce chat n'a pas de projet courant pour limiter la politique. Utilise la portee account uniquement si l'utilisateur vise explicitement tous ses projets."
                        .to_string()
                })?,
        ),
        AutonomousAgentPolicyScope::Account => None,
    };
    let mut selected = agents
        .iter()
        .filter(|agent| {
            !agent.system_managed
                && agent.account_id == context.account_id
                && matches!(
                    agent.status,
                    AutonomousAgentStatus::Active | AutonomousAgentStatus::NeedsAttention
                )
                && (agent.require_user_review
                    || agent.pending_review.is_some()
                    || agent.approved_review.is_some())
                && project_dir.is_none_or(|project| {
                    agent
                        .project_dir
                        .as_deref()
                        .is_some_and(|agent_project| same_project(agent_project, project))
                })
        })
        .cloned()
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| right.created_at.cmp(&left.created_at))
    });
    if selected.is_empty() {
        return Err(match scope {
            AutonomousAgentPolicyScope::CurrentProject => {
                "Aucun agent autonome actif avec review humaine n'est rattache au compte et au projet courants"
                    .to_string()
            }
            AutonomousAgentPolicyScope::Account => {
                "Aucun agent autonome actif avec review humaine n'est disponible pour ce compte"
                    .to_string()
            }
        });
    }
    Ok(selected)
}

pub(crate) fn linked_agent_for_context(
    agents: &[AutonomousAgentSnapshot],
    context: &AutonomousAgentToolContext,
) -> Result<AutonomousAgentSnapshot, String> {
    let source_chat_key = context.source_chat_key.as_deref().ok_or_else(|| {
        "Ce chat n'a pas de cle persistante permettant de retrouver son agent autonome".to_string()
    })?;
    agents
        .iter()
        .filter(|agent| {
            !agent.system_managed
                && agent.account_id == context.account_id
                && agent.source_chat_key.as_deref() == Some(source_chat_key)
        })
        .max_by_key(|agent| (agent.created_at, agent.updated_at))
        .cloned()
        .ok_or_else(|| {
            "Ce chat n'a pas d'agent autonome lie. Cree-le d'abord depuis ce chat.".to_string()
        })
}

pub(crate) fn initialize_response(
    id: Value,
    requested_version: Option<&str>,
    scope: ChatToolScope,
) -> Value {
    let protocol_version = requested_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("2025-06-18");
    if scope == ChatToolScope::PersonalDataOnly {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "protocolVersion": protocol_version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": {
                    "name": "codex-switch-terminal-chat-tools",
                    "title": "Outils du chat Codex Switch Terminal",
                    "version": env!("CARGO_PKG_VERSION")
                },
                "instructions": "Ces outils donnent acces au compte Microsoft 365 de l'utilisateur qui a cree cet agent : list_outlook_messages pour lire ou chercher ses e-mails, list_calendar_events pour consulter son agenda, send_outlook_email pour preparer un e-mail, create_calendar_event pour proposer un rendez-vous, update_calendar_event pour proposer la modification d'un evenement existant. La boite et l'agenda sont ceux de ce proprietaire : ne demande jamais d'adresse, d'identifiant ni de boite cible. Les trois derniers outils N'ENVOIENT ET N'ECRIVENT RIEN : ils deposent une carte que le proprietaire devra confirmer dans l'application. Comme personne ne lit ce cycle en direct, ecris des brouillons complets et autonomes, et indique clairement dans ton compte rendu ce qui attend une validation."
            }
        });
    }
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "protocolVersion": protocol_version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": {
                "name": "codex-switch-terminal-chat-tools",
                "title": "Outils du chat Codex Switch Terminal",
                "version": env!("CARGO_PKG_VERSION")
            },
            "instructions": "Quand l'utilisateur demande explicitement d'ouvrir, creer ou lancer un chat normal separe, appelle create_chat avec son message initial. Le nouveau chat herite du compte, du modele et de l'environnement courants ; un seul peut etre cree par tour. Quand l'utilisateur demande explicitement de creer, lancer ou demarrer un nouvel agent autonome, appelle create_autonomous_agent. Quand il demande explicitement de mettre en pause l'agent autonome lie a ce chat, appelle pause_autonomous_agent sans demander d'identifiant. Quand il demande explicitement de modifier l'agent autonome lie a ce chat, appelle update_autonomous_agent. Quand il demande au superviseur d'activer, produire ou relancer le compte rendu general des rapports non lus, appelle activate_supervisor_general_report ; cet outil fonctionne depuis n'importe quel chat et ne demande aucun identifiant. Quand il demande d'ajouter une meme regle durable a plusieurs agents deja actifs qui utilisent la review humaine, appelle apply_autonomous_agent_policy ; cet outil fonctionne sans cle de chat et reste limite au compte et, par defaut, au projet courants. Deduis une configuration sure, conserve les valeurs existantes et ne demande jamais d'identifiant d'agent. N'affirme jamais qu'une creation, une modification ou une mise en pause a reussi avant le succes de l'outil. N'appelle pas ces outils pour une question theorique. Cinq outils supplementaires donnent acces au compte Microsoft 365 lie a l'utilisateur connecte : list_outlook_messages pour lire ou chercher ses e-mails, list_calendar_events pour consulter son agenda, send_outlook_email pour preparer un e-mail, create_calendar_event pour proposer un rendez-vous et update_calendar_event pour proposer la modification d'un evenement existant. La boite et l'agenda sont ceux du compte connecte : ne demande jamais d'adresse, d'identifiant, de mot de passe ni de boite cible. Les trois derniers outils N'ENVOIENT ET N'ECRIVENT RIEN : ils preparent une carte que l'utilisateur doit confirmer. N'affirme donc jamais qu'un e-mail est parti ou qu'un rendez-vous est cree ; dis qu'il attend sa validation."
        }
    })
}

pub(crate) fn tools_list_response(id: Value, scope: ChatToolScope) -> Value {
    let mut response = all_tools_response(id);
    if scope != ChatToolScope::Full {
        if let Some(tools) = response
            .pointer_mut("/result/tools")
            .and_then(Value::as_array_mut)
        {
            tools.retain(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .is_some_and(|name| scope.allows(name))
            });
        }
    }
    response
}

fn all_tools_response(id: Value) -> Value {
    let output_schema = json!({
        "type": "object",
        "properties": {
            "agentId": { "type": "string" },
            "name": { "type": "string" },
            "status": { "type": "string" },
            "sourceChatKey": { "type": ["string", "null"] }
        },
        "required": ["agentId", "name", "status", "sourceChatKey"]
    });
    let policy_output_schema = json!({
        "type": "object",
        "properties": {
            "updatedCount": { "type": "integer" },
            "failedCount": { "type": "integer" },
            "agents": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "agentId": { "type": "string" },
                        "name": { "type": "string" },
                        "status": { "type": "string" }
                    },
                    "required": ["agentId", "name", "status"]
                }
            },
            "failures": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "agentId": { "type": "string" },
                        "name": { "type": "string" },
                        "error": { "type": "string" }
                    },
                    "required": ["agentId", "name", "error"]
                }
            }
        },
        "required": ["updatedCount", "failedCount", "agents", "failures"]
    });
    let general_report_output_schema = json!({
        "type": "object",
        "properties": {
            "enabled": { "type": "boolean" },
            "pendingUnreadReports": { "type": "integer" },
            "scheduled": { "type": "boolean" },
            "status": { "type": "string" }
        },
        "required": ["enabled", "pendingUnreadReports", "scheduled", "status"]
    });
    let chat_output_schema = json!({
        "type": "object",
        "properties": {
            "requestId": { "type": "string" },
            "status": { "type": "string" },
            "mode": { "type": "string" },
            "sourceChatKey": { "type": ["string", "null"] }
        },
        "required": ["requestId", "status", "mode", "sourceChatKey"]
    });
    let messages_output_schema = json!({
        "type": "object",
        "properties": {
            "count": { "type": "integer" },
            "messages": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "subject": { "type": "string" },
                        "from": { "type": "string" },
                        "fromName": { "type": "string" },
                        "receivedAt": { "type": "string" },
                        "preview": { "type": "string" },
                        "isRead": { "type": "boolean" },
                        "hasAttachments": { "type": "boolean" }
                    },
                    "required": ["id", "subject", "from", "receivedAt", "preview"]
                }
            }
        },
        "required": ["count", "messages"]
    });
    let events_output_schema = json!({
        "type": "object",
        "properties": {
            "count": { "type": "integer" },
            "window": {
                "type": "object",
                "properties": {
                    "start": { "type": "string" },
                    "end": { "type": "string" },
                    "timeZone": { "type": "string" }
                },
                "required": ["start", "end", "timeZone"]
            },
            "events": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": { "type": "string" },
                        "subject": { "type": "string" },
                        "start": { "type": "string" },
                        "end": { "type": "string" },
                        "timeZone": { "type": "string" },
                        "location": { "type": "string" },
                        "organizer": { "type": "string" },
                        "attendees": { "type": "array", "items": { "type": "string" } },
                        "isAllDay": { "type": "boolean" },
                        "isCancelled": { "type": "boolean" }
                    },
                    "required": ["id", "subject", "start", "end", "timeZone"]
                }
            }
        },
        "required": ["count", "events", "window"]
    });
    let pending_action_output_schema = json!({
        "type": "object",
        "properties": {
            "actionId": { "type": "string" },
            "status": { "type": "string" },
            "kind": { "type": "string" },
            "summary": { "type": "string" }
        },
        "required": ["actionId", "status", "kind", "summary"]
    });
    let instant_description =
        "Date et heure ISO 8601 avec decalage horaire explicite, par exemple 2026-07-25T14:00:00+02:00. Un instant sans decalage est refuse.";
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "tools": [
                {
                    "name": AUTONOMOUS_AGENT_TOOL_NAME,
                    "title": "Creer un agent autonome",
                    "description": "Cree et demarre un nouvel agent autonome persistant, lie au chat courant. Utilise cet outil lorsque l'utilisateur demande explicitement de creer, lancer, demarrer ou rendre autonome un agent pour poursuivre une mission dans le temps. Le compte, le modele et l'environnement sont ceux du chat et ne doivent pas etre demandes a nouveau. Ne l'utilise pas pour modifier un agent existant, une simple explication ou une simulation.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "objective": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 32768,
                                "description": "Mission durable, precise et directement actionnable par l'agent."
                            },
                            "name": {
                                "type": "string",
                                "maxLength": 120,
                                "description": "Nom court facultatif."
                            },
                            "role": {
                                "type": "string",
                                "maxLength": 4000,
                                "description": "Specialite, responsabilites et limites facultatives."
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["build", "plan", "ask"],
                                "description": "build pour agir, plan pour analyser sans modifier, ask pour conseiller."
                            },
                            "intervalMinutes": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 10080,
                                "description": "Delai entre deux cycles. Par defaut : 15 minutes."
                            },
                            "requireUserReview": {
                                "type": "boolean",
                                "description": "Par defaut true : demander une validation avant d'appliquer les changements."
                            },
                            "mobileNotificationsEnabled": {
                                "type": "boolean",
                                "description": "Envoie les nouveaux comptes rendus et les alertes dans l'app mobile configuree."
                            },
                            "initialMemory": {
                                "type": "string",
                                "maxLength": 2000,
                                "description": "Contraintes et decisions durables utiles, sans recopier toute la conversation."
                            },
                            "testCommand": {
                                "type": "string",
                                "maxLength": 8000,
                                "description": "Commande de validation facultative dans l'environnement courant."
                            },
                            "testTimeoutSeconds": {
                                "type": "integer",
                                "minimum": 5,
                                "maximum": 1800
                            }
                        },
                        "required": ["objective"]
                    },
                    "outputSchema": output_schema.clone(),
                    "annotations": {
                        "title": "Creer un agent autonome",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": false,
                        "openWorldHint": false
                    }
                },
                {
                    "name": UPDATE_AUTONOMOUS_AGENT_TOOL_NAME,
                    "title": "Modifier l'agent autonome de ce chat",
                    "description": "Modifie uniquement l'agent autonome le plus recent lie au chat courant. Utilise cet outil lorsque l'utilisateur demande explicitement de changer son nom, son objectif, son role, son mode, sa frequence, ses notifications mobiles, sa validation humaine ou sa commande de test. Ne demande et n'accepte aucun identifiant d'agent. Les champs absents conservent leur valeur actuelle. Ne l'utilise pas pour creer un nouvel agent ni pour cibler l'agent d'un autre chat.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "minProperties": 1,
                        "properties": {
                            "name": {
                                "type": "string",
                                "maxLength": 120,
                                "description": "Nouveau nom court."
                            },
                            "objective": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 32768,
                                "description": "Nouvelle mission durable et directement actionnable."
                            },
                            "role": {
                                "type": "string",
                                "maxLength": 4000,
                                "description": "Nouveau role. Ne pas combiner avec clearRole."
                            },
                            "clearRole": {
                                "type": "boolean",
                                "description": "true pour supprimer le role existant."
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["build", "plan", "ask"]
                            },
                            "intervalMinutes": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 10080,
                                "description": "Nouveau delai entre deux cycles."
                            },
                            "requireUserReview": {
                                "type": "boolean",
                                "description": "Active ou desactive la validation humaine."
                            },
                            "mobileNotificationsEnabled": {
                                "type": "boolean",
                                "description": "Active ou desactive les rapports et alertes dans l'app mobile."
                            },
                            "testCommand": {
                                "type": "string",
                                "maxLength": 8000,
                                "description": "Nouvelle commande de validation. Ne pas combiner avec clearTestCommand."
                            },
                            "clearTestCommand": {
                                "type": "boolean",
                                "description": "true pour supprimer la commande de validation."
                            },
                            "testTimeoutSeconds": {
                                "type": "integer",
                                "minimum": 5,
                                "maximum": 1800
                            }
                        }
                    },
                    "outputSchema": output_schema.clone(),
                    "annotations": {
                        "title": "Modifier l'agent autonome de ce chat",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": false,
                        "openWorldHint": false
                    }
                },
                {
                    "name": PAUSE_AUTONOMOUS_AGENT_TOOL_NAME,
                    "title": "Mettre en pause l'agent autonome de ce chat",
                    "description": "Met en pause uniquement l'agent autonome le plus recent lie au chat courant. La pause arrete son cycle ou sa validation en cours et supprime sa prochaine planification jusqu'a une reprise explicite depuis l'interface. Utilise cet outil seulement lorsque l'utilisateur demande explicitement de mettre cet agent en pause. Ne demande et n'accepte aucun identifiant d'agent. Un agent deja en pause reste en pause sans erreur.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {}
                    },
                    "outputSchema": output_schema.clone(),
                    "annotations": {
                        "title": "Mettre en pause l'agent autonome de ce chat",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": true,
                        "openWorldHint": false
                    }
                },
                {
                    "name": ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME,
                    "title": "Activer le compte rendu general du superviseur",
                    "description": "Active et, s'il existe des comptes rendus non lus, planifie immediatement le compte rendu general du superviseur. La synthese compile toutes les sources sans doublon et les classe par priorite critique, haute, moyenne puis basse. Utilise cet outil lorsque l'utilisateur demande explicitement cette capacite ou une synthese generale ; il fonctionne depuis n'importe quel chat et n'accepte aucun identifiant d'agent.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {}
                    },
                    "outputSchema": general_report_output_schema,
                    "annotations": {
                        "title": "Activer le compte rendu general",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": true,
                        "openWorldHint": false
                    }
                },
                {
                    "name": APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME,
                    "title": "Appliquer une regle aux agents actifs",
                    "description": "Ajoute sans l'ecraser une instruction durable aux agents autonomes actifs qui utilisent deja la review humaine, invalide leurs anciennes autorisations et relance proprement les cycles concernes. Utilise cet outil seulement si l'utilisateur demande explicitement d'appliquer une meme politique a plusieurs agents deja actifs, notamment une preuve visuelle avant/apres. La portee par defaut est le compte et le projet courants ; utilise account uniquement si l'utilisateur vise explicitement tous ses projets de ce compte. L'outil n'accepte aucun identifiant d'agent et ne modifie ni objectif, ni role, ni frequence.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "instruction": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 2000,
                                "description": "Regle durable, precise et verifiable a ajouter sans remplacer les missions existantes."
                            },
                            "scope": {
                                "type": "string",
                                "enum": ["current_project", "account"],
                                "description": "current_project par defaut. account seulement sur demande explicite visant tous les projets du compte."
                            },
                            "requireVisualEvidence": {
                                "type": "boolean",
                                "description": "true pour une politique visuelle : une image reelle sous .codex-proof devient obligatoire avant autorisation. false pour une regle non visuelle."
                            }
                        },
                        "required": ["instruction", "requireVisualEvidence"]
                    },
                    "outputSchema": policy_output_schema,
                    "annotations": {
                        "title": "Appliquer une regle aux agents actifs",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": true,
                        "openWorldHint": false
                    }
                },
                {
                    "name": CREATE_CHAT_TOOL_NAME,
                    "title": "Ouvrir un nouveau chat",
                    "description": "Ouvre dans l'interface web un chat normal separe et lui envoie le message initial. Utilise cet outil uniquement quand l'utilisateur demande explicitement d'ouvrir, creer ou lancer un autre chat. Le compte, le modele, l'effort de raisonnement et l'environnement sont herites du chat courant et ne doivent pas etre redemandes. Un seul nouveau chat peut etre cree par tour. Ne l'utilise pas pour une question theorique sur les chats ni pour creer un agent autonome.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "prompt": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 32768,
                                "description": "Message initial complet a envoyer dans le nouveau chat."
                            },
                            "mode": {
                                "type": "string",
                                "enum": ["build", "plan", "ask"],
                                "description": "Mode facultatif. Par defaut, reprend le mode du chat courant."
                            }
                        },
                        "required": ["prompt"]
                    },
                    "outputSchema": chat_output_schema,
                    "annotations": {
                        "title": "Ouvrir un nouveau chat",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": false,
                        "openWorldHint": false
                    }
                },
                {
                    "name": LIST_OUTLOOK_MESSAGES_TOOL_NAME,
                    "title": "Lire la boite Outlook de l'utilisateur",
                    "description": "Liste les e-mails de la boite Microsoft 365 liee au compte de l'utilisateur connecte. Utilise cet outil quand l'utilisateur demande de consulter, chercher, resumer ou verifier ses e-mails. La boite est deduite du compte connecte : ne demande jamais d'adresse, d'identifiant ni de mot de passe. Les corps complets ne sont pas retournes : appuie-toi sur l'objet, l'expediteur et l'apercu.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "query": {
                                "type": "string",
                                "maxLength": 200,
                                "description": "Recherche plein texte facultative, par exemple « facture » ou « from:jean@example.fr ». Sans guillemet."
                            },
                            "folder": {
                                "type": "string",
                                "enum": ["inbox", "sentitems", "drafts", "archive"],
                                "description": "Dossier a lire. Par defaut : inbox."
                            },
                            "limit": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 25,
                                "description": "Nombre de messages a retourner. Par defaut : 10."
                            }
                        }
                    },
                    "outputSchema": messages_output_schema,
                    "annotations": {
                        "title": "Lire la boite Outlook",
                        "readOnlyHint": true,
                        "destructiveHint": false,
                        "idempotentHint": true,
                        "openWorldHint": true
                    }
                },
                {
                    "name": LIST_CALENDAR_EVENTS_TOOL_NAME,
                    "title": "Consulter l'agenda Microsoft de l'utilisateur",
                    "description": "Liste les evenements de l'agenda Microsoft 365 lie au compte de l'utilisateur connecte, y compris les occurrences des series recurrentes. Utilise cet outil quand l'utilisateur demande son planning, ses rendez-vous, ses disponibilites ou un creneau libre. Les horaires renvoyes sont en UTC : convertis-les avant de les presenter. L'agenda est deduit du compte connecte et ne doit jamais etre demande.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "start": {
                                "type": "string",
                                "description": instant_description
                            },
                            "end": {
                                "type": "string",
                                "description": instant_description
                            },
                            "limit": {
                                "type": "integer",
                                "minimum": 1,
                                "maximum": 50,
                                "description": "Nombre d'evenements a retourner. Par defaut : 20."
                            }
                        }
                    },
                    "outputSchema": events_output_schema,
                    "annotations": {
                        "title": "Consulter l'agenda Microsoft",
                        "readOnlyHint": true,
                        "destructiveHint": false,
                        "idempotentHint": true,
                        "openWorldHint": true
                    }
                },
                {
                    "name": SEND_OUTLOOK_EMAIL_TOOL_NAME,
                    "title": "Preparer un e-mail Outlook a confirmer",
                    "description": "Prepare un e-mail depuis la boite Microsoft 365 de l'utilisateur connecte et l'affiche dans la conversation pour validation. CET OUTIL N'ENVOIE RIEN : l'e-mail ne part que si l'utilisateur clique sur Envoyer dans la carte de confirmation. Ne dis donc jamais que le message est parti ; annonce qu'il attend sa validation. Utilise cet outil quand l'utilisateur demande d'ecrire ou d'envoyer un e-mail. L'expediteur est le compte lie et ne doit jamais etre demande.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "to": {
                                "type": "array",
                                "minItems": 1,
                                "maxItems": 25,
                                "items": { "type": "string" },
                                "description": "Adresses des destinataires. Utilise uniquement des adresses fournies par l'utilisateur ou lues dans ses e-mails : n'en invente aucune."
                            },
                            "cc": {
                                "type": "array",
                                "maxItems": 25,
                                "items": { "type": "string" },
                                "description": "Adresses en copie."
                            },
                            "subject": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 255,
                                "description": "Objet du message."
                            },
                            "body": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 20000,
                                "description": "Corps du message en texte brut, redige et pret a partir, dans la langue de l'utilisateur."
                            }
                        },
                        "required": ["to", "subject", "body"]
                    },
                    "outputSchema": pending_action_output_schema.clone(),
                    "annotations": {
                        "title": "Preparer un e-mail Outlook",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": false,
                        "openWorldHint": true
                    }
                },
                {
                    "name": CREATE_CALENDAR_EVENT_TOOL_NAME,
                    "title": "Preparer un evenement d'agenda a confirmer",
                    "description": "Prepare un evenement dans l'agenda Microsoft 365 de l'utilisateur connecte et l'affiche dans la conversation pour validation. CET OUTIL NE CREE RIEN : l'evenement n'est ajoute et les invitations ne partent que si l'utilisateur confirme. Annonce donc une proposition en attente, jamais un rendez-vous cree. Verifie les disponibilites avec list_calendar_events avant de proposer un creneau.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "subject": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 255,
                                "description": "Titre de l'evenement."
                            },
                            "start": {
                                "type": "string",
                                "description": instant_description
                            },
                            "end": {
                                "type": "string",
                                "description": instant_description
                            },
                            "attendees": {
                                "type": "array",
                                "maxItems": 25,
                                "items": { "type": "string" },
                                "description": "Adresses des participants a inviter. N'en invente aucune."
                            },
                            "location": {
                                "type": "string",
                                "maxLength": 255,
                                "description": "Lieu affiche dans l'invitation."
                            },
                            "body": {
                                "type": "string",
                                "maxLength": 20000,
                                "description": "Description en texte brut."
                            },
                            "onlineMeeting": {
                                "type": "boolean",
                                "description": "true pour joindre un lien Teams a l'invitation."
                            }
                        },
                        "required": ["subject", "start", "end"]
                    },
                    "outputSchema": pending_action_output_schema.clone(),
                    "annotations": {
                        "title": "Preparer un evenement d'agenda",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": false,
                        "openWorldHint": true
                    }
                },
                {
                    "name": UPDATE_CALENDAR_EVENT_TOOL_NAME,
                    "title": "Preparer la modification d'un evenement",
                    "description": "Prepare la modification d'un evenement existant de l'agenda Microsoft 365 et l'affiche dans la conversation pour validation. CET OUTIL NE MODIFIE RIEN sans confirmation de l'utilisateur. L'identifiant provient obligatoirement d'un appel prealable a list_calendar_events : ne l'invente jamais et ne le demande pas a l'utilisateur. Un deplacement d'horaire exige start et end ensemble. Cet outil ne supprime ni n'annule un evenement.",
                    "inputSchema": {
                        "type": "object",
                        "additionalProperties": false,
                        "minProperties": 2,
                        "properties": {
                            "eventId": {
                                "type": "string",
                                "minLength": 1,
                                "maxLength": 512,
                                "description": "Identifiant retourne par list_calendar_events."
                            },
                            "subject": {
                                "type": "string",
                                "maxLength": 255,
                                "description": "Nouveau titre."
                            },
                            "start": {
                                "type": "string",
                                "description": instant_description
                            },
                            "end": {
                                "type": "string",
                                "description": instant_description
                            },
                            "location": {
                                "type": "string",
                                "maxLength": 255,
                                "description": "Nouveau lieu."
                            },
                            "body": {
                                "type": "string",
                                "maxLength": 20000,
                                "description": "Nouvelle description en texte brut."
                            }
                        },
                        "required": ["eventId"]
                    },
                    "outputSchema": pending_action_output_schema,
                    "annotations": {
                        "title": "Preparer la modification d'un evenement",
                        "readOnlyHint": false,
                        "destructiveHint": false,
                        "idempotentHint": false,
                        "openWorldHint": true
                    }
                }
            ]
        }
    })
}

/// Reponse des outils Microsoft en lecture seule. Le texte est ce que le modele
/// lit ; `structuredContent` porte les donnees exploitables.
pub(crate) fn tool_microsoft_data_response(id: Value, text: &str, structured: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": text }],
            "structuredContent": structured,
            "isError": false
        }
    })
}

/// Reponse des outils Microsoft qui sortent de l'application. Le texte insiste
/// sur le fait que rien n'est parti : c'est la seule protection contre un
/// modele qui annoncerait un envoi imaginaire a l'utilisateur.
pub(crate) fn tool_pending_action_response(
    id: Value,
    action: &crate::microsoft::PendingMicrosoftAction,
) -> Value {
    let text = match action.kind.as_str() {
        "sendEmail" => format!(
            "Brouillon prepare : {}. L'e-mail N'EST PAS envoye : une carte de confirmation attend la validation de l'utilisateur dans la conversation.",
            action.summary
        ),
        "createEvent" => format!(
            "Proposition preparee : {}. L'evenement N'EST PAS cree tant que l'utilisateur n'a pas confirme dans la conversation.",
            action.summary
        ),
        _ => format!(
            "Modification preparee : {}. Elle N'EST PAS appliquee tant que l'utilisateur n'a pas confirme dans la conversation.",
            action.summary
        ),
    };
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": text }],
            "structuredContent": {
                "actionId": action.id,
                "status": "awaiting_confirmation",
                "kind": action.kind,
                "summary": action.summary,
            },
            "isError": false
        }
    })
}

pub(crate) fn tool_chat_open_response(id: Value, request: &ChatOpenRequest) -> Value {
    let structured = json!({
        "requestId": request.id,
        "status": "queued",
        "mode": request.mode,
        "sourceChatKey": request.source_chat_key,
    });
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{
                "type": "text",
                "text": "Le nouveau chat a ete demande. L'interface web va l'ouvrir et envoyer le message initial."
            }],
            "structuredContent": structured,
            "isError": false
        }
    })
}

pub(crate) fn tool_success_response(id: Value, agent: &AutonomousAgentSnapshot) -> Value {
    let structured = json!({
        "agentId": agent.id,
        "name": agent.name,
        "status": agent.status,
        "sourceChatKey": agent.source_chat_key,
    });
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{
                "type": "text",
                "text": format!(
                    "Agent autonome « {} » cree et demarre avec succes (id: {}). Il est lie au chat courant.",
                    agent.name, agent.id
                )
            }],
            "structuredContent": structured,
            "isError": false
        }
    })
}

pub(crate) fn tool_update_success_response(id: Value, agent: &AutonomousAgentSnapshot) -> Value {
    let structured = json!({
        "agentId": agent.id,
        "name": agent.name,
        "status": agent.status,
        "sourceChatKey": agent.source_chat_key,
    });
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{
                "type": "text",
                "text": format!(
                    "Agent autonome « {} » modifie avec succes (id: {}). Son etat est {}.",
                    agent.name,
                    agent.id,
                    match agent.status {
                        crate::autonomous::AutonomousAgentStatus::Active => "actif",
                        crate::autonomous::AutonomousAgentStatus::Paused => "en pause",
                        crate::autonomous::AutonomousAgentStatus::Completed => "termine",
                        crate::autonomous::AutonomousAgentStatus::NeedsAttention => {
                            "en attente d'attention"
                        }
                    }
                )
            }],
            "structuredContent": structured,
            "isError": false
        }
    })
}

pub(crate) fn tool_pause_success_response(
    id: Value,
    agent: &AutonomousAgentSnapshot,
    already_paused: bool,
) -> Value {
    let structured = json!({
        "agentId": agent.id,
        "name": agent.name,
        "status": agent.status,
        "sourceChatKey": agent.source_chat_key,
    });
    let message = if already_paused {
        format!("L'agent autonome « {} » etait deja en pause.", agent.name)
    } else {
        format!(
            "L'agent autonome « {} » a ete mis en pause. Son cycle courant a ete arrete et aucune nouvelle execution ne sera planifiee avant sa reprise.",
            agent.name
        )
    };
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "structuredContent": structured,
            "isError": false
        }
    })
}

pub(crate) fn tool_general_report_response(
    id: Value,
    supervisor: Option<&AutonomousAgentSnapshot>,
    pending_unread_reports: usize,
    scheduled: bool,
) -> Value {
    let status = supervisor
        .map(|agent| format!("{:?}", agent.status).to_ascii_lowercase())
        .unwrap_or_else(|| "standby".to_string());
    let structured = json!({
        "enabled": true,
        "pendingUnreadReports": pending_unread_reports,
        "scheduled": scheduled,
        "status": status,
    });
    let message = if pending_unread_reports == 0 {
        "Le compte rendu general du superviseur est actif. Aucun compte rendu non lu n'est actuellement a compiler.".to_string()
    } else if scheduled {
        format!(
            "Le compte rendu general du superviseur est actif et planifie immediatement pour compiler {pending_unread_reports} compte(s) rendu(s) non lu(s) par ordre de priorite."
        )
    } else {
        format!(
            "Le compte rendu general du superviseur est actif. {pending_unread_reports} compte(s) rendu(s) non lu(s) seront compiles au prochain passage."
        )
    };
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "structuredContent": structured,
            "isError": false
        }
    })
}

pub(crate) fn tool_policy_response(
    id: Value,
    updated: &[AutonomousAgentSnapshot],
    failures: &[(String, String, String)],
) -> Value {
    let agents = updated
        .iter()
        .map(|agent| {
            json!({
                "agentId": agent.id,
                "name": agent.name,
                "status": agent.status,
            })
        })
        .collect::<Vec<_>>();
    let failure_values = failures
        .iter()
        .map(|(agent_id, name, error)| {
            json!({
                "agentId": agent_id,
                "name": name,
                "error": error,
            })
        })
        .collect::<Vec<_>>();
    let structured = json!({
        "updatedCount": agents.len(),
        "failedCount": failure_values.len(),
        "agents": agents,
        "failures": failure_values,
    });
    let message = if failures.is_empty() {
        format!(
            "Politique durable appliquee avec succes a {} agent(s) autonome(s). La review humaine est active et les cycles concernes repartent avec la nouvelle regle.",
            updated.len()
        )
    } else {
        format!(
            "Politique appliquee a {} agent(s), mais {} mise(s) a jour ont echoue. N'affirme pas que tous les agents ont ete modifies et rapporte les echecs.",
            updated.len(),
            failures.len()
        )
    };
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "structuredContent": structured,
            "isError": !failures.is_empty()
        }
    })
}

pub(crate) fn tool_error_response(id: Value, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "content": [{ "type": "text", "text": message }],
            "isError": true
        }
    })
}

pub(crate) fn protocol_error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> AutonomousAgentToolContext {
        AutonomousAgentToolContext {
            account_id: "account-1".to_string(),
            scope: ChatToolScope::Full,
            user_id: Some("user-1".to_string()),
            source_chat_key: Some("chat-1".to_string()),
            project_dir: Some("C:/project".to_string()),
            mode: ChatTurnMode::Build,
            model: Some("gpt-test".to_string()),
            reasoning_effort: Some("high".to_string()),
        }
    }

    fn snapshot(id: &str, created_at: i64) -> AutonomousAgentSnapshot {
        serde_json::from_value(json!({
            "id": id,
            "name": format!("Agent {id}"),
            "objective": "Objectif initial",
            "role": "Role initial",
            "sourceChatKey": "chat-1",
            "accountId": "account-1",
            "projectDir": "C:/original",
            "mode": "plan",
            "model": "gpt-original",
            "reasoningEffort": "medium",
            "connectors": [],
            "intervalSeconds": 900,
            "triggerKind": "workspace_change",
            "watchPaths": ["src"],
            "debounceSeconds": 12,
            "allowGitPublish": true,
            "status": "paused",
            "createdAt": created_at,
            "updatedAt": created_at,
            "requireUserReview": true,
            "testCommand": "npm test",
            "testTimeoutSeconds": 120
        }))
        .unwrap()
    }

    #[test]
    fn capability_binds_the_tool_to_the_source_chat() {
        let registry = ChatToolCapabilityRegistry::default();
        let token = registry.issue(context()).unwrap();
        let claimed = registry.claim_call(&token).unwrap();
        assert_eq!(claimed.account_id, "account-1");
        assert_eq!(claimed.source_chat_key.as_deref(), Some("chat-1"));
        registry.revoke(&token);
        assert!(registry.authorize(&token).is_err());
    }

    #[test]
    fn capability_carries_the_authenticated_user() {
        let registry = ChatToolCapabilityRegistry::default();
        let token = registry.issue(context()).unwrap();
        assert_eq!(
            registry.claim_call(&token).unwrap().user_id.as_deref(),
            Some("user-1")
        );
    }

    #[test]
    fn capability_bounds_external_actions_below_the_call_budget() {
        let registry = ChatToolCapabilityRegistry::default();
        let token = registry.issue(context()).unwrap();
        for _ in 0..MAX_EXTERNAL_ACTIONS_PER_TURN {
            assert!(registry.claim_external_action(&token).is_ok());
        }
        assert!(registry
            .claim_external_action(&token)
            .unwrap_err()
            .contains("Limite d'actions Microsoft"));
        // Le budget global reste disponible pour les autres outils.
        assert!(registry.claim_call(&token).is_ok());
    }

    #[test]
    fn capability_allows_only_one_chat_creation_per_turn() {
        let registry = ChatToolCapabilityRegistry::default();
        let token = registry.issue(context()).unwrap();
        assert!(registry.claim_chat_creation(&token).is_ok());
        assert_eq!(
            registry.claim_chat_creation(&token).unwrap_err(),
            "Un seul nouveau chat peut etre cree par tour"
        );
    }

    #[test]
    fn chat_open_request_inherits_the_source_context_and_is_claimed_once() {
        let arguments: CreateChatToolArguments = serde_json::from_value(json!({
            "prompt": "  Verifie les tests dans un chat separe.  ",
            "mode": "plan"
        }))
        .unwrap();
        let request = arguments.into_request(&context()).unwrap();
        assert_eq!(request.account_id, "account-1");
        assert_eq!(request.source_chat_key.as_deref(), Some("chat-1"));
        assert_eq!(request.project_dir.as_deref(), Some("C:/project"));
        assert_eq!(request.model.as_deref(), Some("gpt-test"));
        assert_eq!(request.reasoning_effort.as_deref(), Some("high"));
        assert_eq!(request.mode, ChatTurnMode::Plan);
        assert_eq!(request.prompt, "Verifie les tests dans un chat separe.");

        let registry = ChatOpenRequestRegistry::default();
        registry.enqueue(request).unwrap();
        assert_eq!(registry.claim().unwrap().len(), 1);
        assert!(registry.claim().unwrap().is_empty());
    }

    #[test]
    fn tool_arguments_cannot_override_account_or_environment() {
        let arguments: CreateAutonomousAgentToolArguments = serde_json::from_value(json!({
            "objective": "Surveiller les regressions",
            "intervalMinutes": 30
        }))
        .unwrap();
        let request = arguments.into_request(context()).unwrap();
        assert_eq!(request.account_id, "account-1");
        assert_eq!(request.source_chat_key.as_deref(), Some("chat-1"));
        assert_eq!(request.project_dir.as_deref(), Some("C:/project"));
        assert_eq!(request.interval_seconds, Some(1800));
        assert!(request.require_user_review);
        // L'agent herite du proprietaire du chat : c'est ce qui lui donnera plus
        // tard acces a la boite mail de cette personne, et d'aucune autre.
        assert_eq!(request.owner_id.as_deref(), Some("user-1"));

        // Un tour lance au jeton administrateur ne designe personne : l'agent
        // cree ne doit alors heriter d'aucune boite.
        let mut anonymous = context();
        anonymous.user_id = None;
        let arguments: CreateAutonomousAgentToolArguments = serde_json::from_value(json!({
            "objective": "Surveiller les regressions"
        }))
        .unwrap();
        assert!(arguments.into_request(anonymous).unwrap().owner_id.is_none());
    }

    #[test]
    fn update_arguments_apply_a_patch_without_moving_the_agent() {
        let agent = snapshot("agent-1", 10);
        let arguments: UpdateAutonomousAgentToolArguments = serde_json::from_value(json!({
            "objective": "Nouvel objectif",
            "intervalMinutes": 30,
            "clearRole": true
        }))
        .unwrap();
        let request = arguments.into_request(&agent, false).unwrap();
        assert_eq!(request.objective, "Nouvel objectif");
        assert_eq!(request.role, None);
        assert_eq!(request.account_id.as_deref(), Some("account-1"));
        assert_eq!(request.project_dir.as_deref(), Some("C:/original"));
        assert_eq!(request.mode, ChatTurnMode::Plan);
        assert_eq!(request.model.as_deref(), Some("gpt-original"));
        assert_eq!(request.interval_seconds, Some(1800));
        assert_eq!(
            request.trigger_kind,
            Some(AutonomousTriggerKind::WorkspaceChange)
        );
        assert_eq!(request.watch_paths, Some(vec!["src".to_string()]));
        assert_eq!(request.allow_git_publish, Some(true));
        assert_eq!(request.test_command.as_deref(), Some("npm test"));
        assert!(!request.activate);
    }

    #[test]
    fn update_tool_selects_only_the_newest_agent_linked_to_this_chat() {
        let older = snapshot("older", 10);
        let newer = snapshot("newer", 20);
        let mut other_chat = snapshot("other-chat", 30);
        other_chat.source_chat_key = Some("chat-2".to_string());
        let mut other_account = snapshot("other-account", 40);
        other_account.account_id = "account-2".to_string();
        let selected =
            linked_agent_for_context(&[older, newer, other_chat, other_account], &context())
                .unwrap();
        assert_eq!(selected.id, "newer");
    }

    #[test]
    fn policy_tool_selects_running_agents_without_a_source_chat_key() {
        let mut context = context();
        context.source_chat_key = None;
        let arguments: ApplyAutonomousAgentPolicyToolArguments = serde_json::from_value(json!({
            "instruction": "Regle partagee",
            "requireVisualEvidence": true
        }))
        .unwrap();
        assert!(arguments.require_visual_evidence);
        assert_eq!(
            arguments.resolved_scope(&context),
            AutonomousAgentPolicyScope::CurrentProject
        );

        let mut current_project = snapshot("current-project", 10);
        current_project.project_dir = Some("c:\\PROJECT\\".to_string());
        current_project.status = AutonomousAgentStatus::Active;
        let mut other_project = snapshot("other-project", 20);
        other_project.project_dir = Some("C:/other".to_string());
        other_project.status = AutonomousAgentStatus::NeedsAttention;
        let mut other_account = snapshot("other-account", 30);
        other_account.account_id = "account-2".to_string();
        other_account.status = AutonomousAgentStatus::Active;
        let paused = snapshot("paused", 40);

        let project_agents = agents_for_policy_context(
            &[
                current_project.clone(),
                other_project.clone(),
                other_account.clone(),
                paused.clone(),
            ],
            &context,
            AutonomousAgentPolicyScope::CurrentProject,
        )
        .unwrap();
        assert_eq!(
            project_agents
                .iter()
                .map(|agent| agent.id.as_str())
                .collect::<Vec<_>>(),
            vec!["current-project"]
        );

        let account_agents = agents_for_policy_context(
            &[current_project, other_project, other_account, paused],
            &context,
            AutonomousAgentPolicyScope::Account,
        )
        .unwrap();
        assert_eq!(account_agents.len(), 2);
        assert!(account_agents
            .iter()
            .any(|agent| agent.id == "current-project"));
        assert!(account_agents
            .iter()
            .any(|agent| agent.id == "other-project"));
    }

    #[test]
    fn mcp_schema_teaches_the_model_when_to_control_an_agent() {
        let response = tools_list_response(json!(1), ChatToolScope::Full);
        let tools = response["result"]["tools"].as_array().unwrap();
        assert!(tools.len() >= 6);
        let tool = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(AUTONOMOUS_AGENT_TOOL_NAME))
            .unwrap();
        assert_eq!(tool["name"], AUTONOMOUS_AGENT_TOOL_NAME);
        assert_eq!(tool["inputSchema"]["required"], json!(["objective"]));
        assert!(tool["description"]
            .as_str()
            .unwrap()
            .contains("demande explicitement"));
        let update_tool = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(UPDATE_AUTONOMOUS_AGENT_TOOL_NAME))
            .unwrap();
        assert_eq!(update_tool["name"], UPDATE_AUTONOMOUS_AGENT_TOOL_NAME);
        assert_eq!(update_tool["inputSchema"]["minProperties"], 1);
        assert!(update_tool["inputSchema"]["properties"]
            .get("agentId")
            .is_none());
        let pause_tool = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(PAUSE_AUTONOMOUS_AGENT_TOOL_NAME))
            .unwrap();
        assert_eq!(pause_tool["name"], PAUSE_AUTONOMOUS_AGENT_TOOL_NAME);
        assert_eq!(pause_tool["inputSchema"]["properties"], json!({}));
        assert!(pause_tool["inputSchema"]["properties"]
            .get("agentId")
            .is_none());
        assert_eq!(pause_tool["annotations"]["idempotentHint"], true);
        assert!(pause_tool["description"]
            .as_str()
            .unwrap()
            .contains("cycle ou sa validation en cours"));
        let pause_response = tool_pause_success_response(json!(2), &snapshot("paused", 10), false);
        assert_eq!(
            pause_response["result"]["structuredContent"]["status"],
            "paused"
        );
        assert_eq!(pause_response["result"]["isError"], false);
        let general_report_tool = tools
            .iter()
            .find(|tool| {
                tool["name"].as_str() == Some(ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME)
            })
            .unwrap();
        assert_eq!(
            general_report_tool["name"],
            ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME
        );
        assert_eq!(general_report_tool["inputSchema"]["properties"], json!({}));
        assert!(general_report_tool["description"]
            .as_str()
            .unwrap()
            .contains("n'importe quel chat"));
        let general_response = tool_general_report_response(json!(2), None, 3, true);
        assert_eq!(
            general_response["result"]["structuredContent"]["pendingUnreadReports"],
            3
        );
        assert_eq!(
            general_response["result"]["structuredContent"]["enabled"],
            true
        );

        let policy_tool = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME))
            .unwrap();
        assert_eq!(policy_tool["name"], APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME);
        assert_eq!(
            policy_tool["inputSchema"]["required"],
            json!(["instruction", "requireVisualEvidence"])
        );
        assert!(policy_tool["inputSchema"]["properties"]
            .get("agentId")
            .is_none());

        let create_chat_tool = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(CREATE_CHAT_TOOL_NAME))
            .unwrap();
        assert_eq!(
            create_chat_tool["inputSchema"]["required"],
            json!(["prompt"])
        );
        assert!(create_chat_tool["inputSchema"]["properties"]
            .get("accountId")
            .is_none());
        assert!(create_chat_tool["description"]
            .as_str()
            .unwrap()
            .contains("Un seul nouveau chat"));
    }

    #[test]
    fn an_autonomous_agent_only_sees_the_microsoft_tools() {
        let response = tools_list_response(json!(1), ChatToolScope::PersonalDataOnly);
        let tools = response["result"]["tools"].as_array().unwrap();
        let names = tools
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), MICROSOFT_TOOL_NAMES.len());
        for name in MICROSOFT_TOOL_NAMES {
            assert!(names.contains(&name), "{name} manquant pour un agent");
        }
        // Un agent autonome qui pourrait se dupliquer ou ouvrir des chats
        // echapperait a tout controle : ces outils lui restent fermes.
        for forbidden in [
            AUTONOMOUS_AGENT_TOOL_NAME,
            UPDATE_AUTONOMOUS_AGENT_TOOL_NAME,
            PAUSE_AUTONOMOUS_AGENT_TOOL_NAME,
            APPLY_AUTONOMOUS_AGENT_POLICY_TOOL_NAME,
            ACTIVATE_SUPERVISOR_GENERAL_REPORT_TOOL_NAME,
            CREATE_CHAT_TOOL_NAME,
        ] {
            assert!(!names.contains(&forbidden), "{forbidden} accessible a un agent");
            assert!(!ChatToolScope::PersonalDataOnly.allows(forbidden));
        }
        // La liste et le dispatch doivent refuser exactement les memes outils.
        assert!(ChatToolScope::Full.allows(CREATE_CHAT_TOOL_NAME));
        assert!(ChatToolScope::PersonalDataOnly.allows(SEND_OUTLOOK_EMAIL_TOOL_NAME));
    }

    #[test]
    fn microsoft_tools_never_expose_a_mailbox_selector() {
        let response = tools_list_response(json!(1), ChatToolScope::Full);
        let tools = response["result"]["tools"].as_array().unwrap();
        for name in [
            LIST_OUTLOOK_MESSAGES_TOOL_NAME,
            LIST_CALENDAR_EVENTS_TOOL_NAME,
            SEND_OUTLOOK_EMAIL_TOOL_NAME,
            CREATE_CALENDAR_EVENT_TOOL_NAME,
            UPDATE_CALENDAR_EVENT_TOOL_NAME,
        ] {
            let tool = tools
                .iter()
                .find(|tool| tool["name"].as_str() == Some(name))
                .unwrap_or_else(|| panic!("outil {name} absent de tools/list"));
            let properties = &tool["inputSchema"]["properties"];
            // La boite vient du compte connecte : aucun champ ne doit permettre
            // au modele de viser une autre identite.
            for forbidden in ["userId", "accountId", "mailbox", "from", "sender", "owner"] {
                assert!(
                    properties.get(forbidden).is_none(),
                    "{name} expose {forbidden}"
                );
            }
            assert_eq!(tool["inputSchema"]["additionalProperties"], false);
            // Ces outils sortent de l'application : annoncer un monde ferme au
            // client MCP masquerait le risque reel.
            assert_eq!(tool["annotations"]["openWorldHint"], true);
        }

        for name in [
            SEND_OUTLOOK_EMAIL_TOOL_NAME,
            CREATE_CALENDAR_EVENT_TOOL_NAME,
            UPDATE_CALENDAR_EVENT_TOOL_NAME,
        ] {
            let tool = tools
                .iter()
                .find(|tool| tool["name"].as_str() == Some(name))
                .unwrap();
            let description = tool["description"].as_str().unwrap();
            assert!(
                description.contains("N'ENVOIE RIEN")
                    || description.contains("NE CREE RIEN")
                    || description.contains("NE MODIFIE RIEN"),
                "{name} ne previent pas le modele que rien ne part sans confirmation"
            );
        }

        // Les pieces jointes sont volontairement absentes : le corps MCP est
        // plafonne a 64 Kio et un fichier encode en base64 serait rejete par
        // axum avant meme d'atteindre le dispatch.
        let send = tools
            .iter()
            .find(|tool| tool["name"].as_str() == Some(SEND_OUTLOOK_EMAIL_TOOL_NAME))
            .unwrap();
        assert!(send["inputSchema"]["properties"]
            .get("attachments")
            .is_none());
        assert_eq!(
            send["inputSchema"]["required"],
            json!(["to", "subject", "body"])
        );
    }
}
