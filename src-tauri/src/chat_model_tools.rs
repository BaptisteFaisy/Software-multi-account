//! Outils MCP exposes uniquement aux tours de chat normaux du serveur web.
//!
//! Chaque tour recoit un jeton de capacite aleatoire qui lie les actions du
//! modele au compte, au dossier et au chat source. Le modele ne peut donc ni
//! choisir un autre compte, ni rattacher l'agent a une autre conversation.

use crate::{
    autonomous::{AutonomousAgentSnapshot, AutonomousTriggerKind, CreateAutonomousAgentRequest},
    chat::{ChatAppConnector, ChatTurnMode},
    metrics,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

pub const AUTONOMOUS_AGENT_TOOL_NAME: &str = "create_autonomous_agent";
pub const MCP_SERVER_NAME: &str = "cst_chat";
pub const MCP_BEARER_ENV: &str = "CST_CHAT_AUTONOMOUS_TOOL_TOKEN";
const CAPABILITY_TTL_SECONDS: i64 = 2 * 60 * 60;
const MAX_TOOL_CALLS_PER_TURN: u8 = 8;

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
            return Err("Limite de creations autonomes atteinte pour ce tour".to_string());
        }
        entry.calls = entry.calls.saturating_add(1);
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
            account_id: context.account_id,
            project_dir: context.project_dir,
            mode: self.mode.unwrap_or(context.mode),
            require_user_review: self.require_user_review.unwrap_or(true),
            model: context.model,
            reasoning_effort: context.reasoning_effort,
            connectors: Vec::<ChatAppConnector>::new(),
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
            "instructions": "Quand l'utilisateur demande explicitement de creer, lancer ou demarrer un agent autonome, appelle create_autonomous_agent. Deduis une configuration sure de sa demande et utilise les valeurs par defaut si elles suffisent. N'affirme jamais que l'agent existe avant le succes de l'outil. N'appelle pas cet outil pour une simple question sur les agents."
        }
    })
}

pub(crate) fn tools_list_response(id: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": {
            "tools": [{
                "name": AUTONOMOUS_AGENT_TOOL_NAME,
                "title": "Creer un agent autonome",
                "description": "Cree et demarre un agent autonome persistant, lie au chat courant. Utilise cet outil lorsque l'utilisateur demande explicitement de creer, lancer, demarrer ou rendre autonome un agent pour poursuivre une mission dans le temps. Le compte, le modele et l'environnement sont ceux du chat et ne doivent pas etre demandes a nouveau. Ne l'utilise pas pour une simple explication ou simulation.",
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
                "outputSchema": {
                    "type": "object",
                    "properties": {
                        "agentId": { "type": "string" },
                        "name": { "type": "string" },
                        "status": { "type": "string" },
                        "sourceChatKey": { "type": ["string", "null"] }
                    },
                    "required": ["agentId", "name", "status", "sourceChatKey"]
                },
                "annotations": {
                    "title": "Creer un agent autonome",
                    "readOnlyHint": false,
                    "destructiveHint": false,
                    "idempotentHint": false,
                    "openWorldHint": false
                }
            }]
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
    fn mcp_schema_teaches_the_model_when_to_create_an_agent() {
        let response = tools_list_response(json!(1));
        let tool = &response["result"]["tools"][0];
        assert_eq!(tool["name"], AUTONOMOUS_AGENT_TOOL_NAME);
        assert_eq!(tool["inputSchema"]["required"], json!(["objective"]));
        assert!(tool["description"]
            .as_str()
            .unwrap()
            .contains("demande explicitement"));
    }
}
