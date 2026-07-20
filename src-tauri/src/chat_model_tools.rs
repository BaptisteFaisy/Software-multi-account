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
pub const MCP_SERVER_NAME: &str = "cst_chat";
pub const MCP_BEARER_ENV: &str = "CST_CHAT_AUTONOMOUS_TOOL_TOKEN";
const CAPABILITY_TTL_SECONDS: i64 = 2 * 60 * 60;
const MAX_TOOL_CALLS_PER_TURN: u8 = 8;
const MAX_CHAT_CREATIONS_PER_TURN: u8 = 1;
const CHAT_OPEN_REQUEST_TTL_SECONDS: i64 = 2 * 60 * 60;
const MAX_PENDING_CHAT_OPEN_REQUESTS: usize = 32;
const MAX_CHAT_PROMPT_LENGTH: usize = 32_768;

#[derive(Debug, Clone)]
pub(crate) struct ChatModelToolServerConfig {
    pub url: String,
    pub bearer_token: String,
}

#[derive(Debug, Clone)]
pub(crate) struct AutonomousAgentToolContext {
    pub account_id: String,
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

pub(crate) fn initialize_response(id: Value, requested_version: Option<&str>) -> Value {
    let protocol_version = requested_version
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("2025-06-18");
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
            "instructions": "Quand l'utilisateur demande explicitement d'ouvrir, creer ou lancer un chat normal separe, appelle create_chat avec son message initial. Le nouveau chat herite du compte, du modele et de l'environnement courants ; un seul peut etre cree par tour. Quand l'utilisateur demande explicitement de creer, lancer ou demarrer un nouvel agent autonome, appelle create_autonomous_agent. Quand il demande explicitement de mettre en pause l'agent autonome lie a ce chat, appelle pause_autonomous_agent sans demander d'identifiant. Quand il demande explicitement de modifier l'agent autonome lie a ce chat, appelle update_autonomous_agent. Quand il demande au superviseur d'activer, produire ou relancer le compte rendu general des rapports non lus, appelle activate_supervisor_general_report ; cet outil fonctionne depuis n'importe quel chat et ne demande aucun identifiant. Quand il demande d'ajouter une meme regle durable a plusieurs agents deja actifs qui utilisent la review humaine, appelle apply_autonomous_agent_policy ; cet outil fonctionne sans cle de chat et reste limite au compte et, par defaut, au projet courants. Deduis une configuration sure, conserve les valeurs existantes et ne demande jamais d'identifiant d'agent. N'affirme jamais qu'une creation, une modification ou une mise en pause a reussi avant le succes de l'outil. N'appelle pas ces outils pour une question theorique."
        }
    })
}

pub(crate) fn tools_list_response(id: Value) -> Value {
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
                }
            ]
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
        let response = tools_list_response(json!(1));
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
}
