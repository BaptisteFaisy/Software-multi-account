//! Forum persistant partage par les utilisateurs du serveur.
//!
//! Contrairement aux `discussions` (sessions Codex), un sujet de forum est un
//! echange entre utilisateurs. Chaque nouvelle reponse recoit un numero
//! d'activite strictement croissant : le sujet remonte donc toujours en tete,
//! meme lorsque plusieurs messages sont publies pendant la meme seconde.

use crate::{fs_util, metrics};
use serde::{Deserialize, Serialize};
use std::{
    fmt, fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[cfg(feature = "desktop")]
use tauri::State;

const STORE_VERSION: u32 = 1;
const MAX_TITLE_CHARS: usize = 140;
const MAX_TOPIC_BODY_CHARS: usize = 20_000;
const MAX_REPLY_BODY_CHARS: usize = 12_000;
const MAX_TOPICS: usize = 10_000;
const MAX_REPLIES_PER_TOPIC: usize = 20_000;
const EXCERPT_CHARS: usize = 220;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForumAuthor {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub avatar_url: Option<String>,
}

impl ForumAuthor {
    pub fn new(id: String, username: String, avatar_url: Option<String>) -> Self {
        Self {
            id,
            username,
            avatar_url,
        }
    }

    #[cfg(feature = "desktop")]
    fn local() -> Self {
        Self::new(
            "local-user".to_string(),
            "Utilisateur local".to_string(),
            None,
        )
    }

    pub fn administrator() -> Self {
        Self::new(
            "server-admin".to_string(),
            "Administrateur".to_string(),
            None,
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForumReply {
    pub id: String,
    pub author: ForumAuthor,
    pub body: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForumTopic {
    pub id: String,
    pub title: String,
    pub body: String,
    pub author: ForumAuthor,
    pub created_at: i64,
    pub last_activity_at: i64,
    #[serde(default)]
    pub activity_sequence: u64,
    #[serde(default)]
    pub replies: Vec<ForumReply>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ForumTopicSummary {
    pub id: String,
    pub title: String,
    pub excerpt: String,
    pub author: ForumAuthor,
    pub created_at: i64,
    pub last_activity_at: i64,
    pub activity_sequence: u64,
    pub reply_count: u64,
    pub last_reply_author: Option<ForumAuthor>,
}

impl From<&ForumTopic> for ForumTopicSummary {
    fn from(topic: &ForumTopic) -> Self {
        Self {
            id: topic.id.clone(),
            title: topic.title.clone(),
            excerpt: text_excerpt(&topic.body, EXCERPT_CHARS),
            author: topic.author.clone(),
            created_at: topic.created_at,
            last_activity_at: topic.last_activity_at,
            activity_sequence: topic.activity_sequence,
            reply_count: topic.replies.len() as u64,
            last_reply_author: topic.replies.last().map(|reply| reply.author.clone()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ForumStore {
    version: u32,
    #[serde(default)]
    next_activity_sequence: u64,
    #[serde(default)]
    topics: Vec<ForumTopic>,
}

impl Default for ForumStore {
    fn default() -> Self {
        Self {
            version: STORE_VERSION,
            next_activity_sequence: 0,
            topics: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForumError {
    Validation(String),
    NotFound,
    Internal(String),
}

impl fmt::Display for ForumError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Validation(message) | Self::Internal(message) => formatter.write_str(message),
            Self::NotFound => formatter.write_str("Sujet de forum introuvable"),
        }
    }
}

impl std::error::Error for ForumError {}

#[derive(Clone)]
pub struct ForumManager {
    inner: Arc<ForumInner>,
}

struct ForumInner {
    storage_path: PathBuf,
    store: Mutex<ForumStore>,
}

impl ForumManager {
    pub fn new(storage_path: PathBuf) -> Result<Self, String> {
        let mut store = load_store(&storage_path).map_err(|error| error.to_string())?;
        let normalized = normalize_store(&mut store);
        if normalized {
            persist_store(&storage_path, &store).map_err(|error| error.to_string())?;
        }
        Ok(Self {
            inner: Arc::new(ForumInner {
                storage_path,
                store: Mutex::new(store),
            }),
        })
    }

    pub fn list_topics(&self) -> Result<Vec<ForumTopicSummary>, ForumError> {
        let store = self
            .inner
            .store
            .lock()
            .map_err(|_| ForumError::Internal("Etat du forum verrouille".to_string()))?;
        let mut topics = store
            .topics
            .iter()
            .map(ForumTopicSummary::from)
            .collect::<Vec<_>>();
        topics.sort_by(|left, right| {
            right
                .activity_sequence
                .cmp(&left.activity_sequence)
                .then_with(|| right.last_activity_at.cmp(&left.last_activity_at))
                .then_with(|| right.created_at.cmp(&left.created_at))
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(topics)
    }

    pub fn topic(&self, id: &str) -> Result<ForumTopic, ForumError> {
        let normalized_id = id.trim();
        let store = self
            .inner
            .store
            .lock()
            .map_err(|_| ForumError::Internal("Etat du forum verrouille".to_string()))?;
        store
            .topics
            .iter()
            .find(|topic| topic.id == normalized_id)
            .cloned()
            .ok_or(ForumError::NotFound)
    }

    pub fn create_topic(
        &self,
        author: ForumAuthor,
        title: String,
        body: String,
    ) -> Result<ForumTopic, ForumError> {
        let title = validate_text(title, MAX_TITLE_CHARS, "Le titre")?;
        let body = validate_text(body, MAX_TOPIC_BODY_CHARS, "Le message")?;
        self.mutate_store(move |store| {
            if store.topics.len() >= MAX_TOPICS {
                return Err(ForumError::Validation(
                    "Le forum a atteint sa limite de sujets".to_string(),
                ));
            }
            let activity_sequence = next_activity_sequence(store);
            let now = metrics::now_ts();
            let topic = ForumTopic {
                id: Uuid::new_v4().to_string(),
                title,
                body,
                author,
                created_at: now,
                last_activity_at: now,
                activity_sequence,
                replies: Vec::new(),
            };
            store.topics.push(topic.clone());
            Ok(topic)
        })
    }

    pub fn add_reply(
        &self,
        author: ForumAuthor,
        topic_id: &str,
        body: String,
    ) -> Result<ForumTopic, ForumError> {
        let topic_id = topic_id.trim().to_string();
        let body = validate_text(body, MAX_REPLY_BODY_CHARS, "La reponse")?;
        self.mutate_store(move |store| {
            let Some(index) = store.topics.iter().position(|topic| topic.id == topic_id) else {
                return Err(ForumError::NotFound);
            };
            if store.topics[index].replies.len() >= MAX_REPLIES_PER_TOPIC {
                return Err(ForumError::Validation(
                    "Ce sujet a atteint sa limite de reponses".to_string(),
                ));
            }

            // Ce compteur, plutot que l'horodatage seul, garantit la remontee
            // du sujet lorsqu'il recoit plusieurs reponses dans la meme seconde.
            let activity_sequence = next_activity_sequence(store);
            let now = metrics::now_ts();
            let topic = &mut store.topics[index];
            topic.replies.push(ForumReply {
                id: Uuid::new_v4().to_string(),
                author,
                body,
                created_at: now,
            });
            topic.last_activity_at = now;
            topic.activity_sequence = activity_sequence;
            Ok(topic.clone())
        })
    }

    fn mutate_store<T>(
        &self,
        mutation: impl FnOnce(&mut ForumStore) -> Result<T, ForumError>,
    ) -> Result<T, ForumError> {
        let mut current = self
            .inner
            .store
            .lock()
            .map_err(|_| ForumError::Internal("Etat du forum verrouille".to_string()))?;
        let mut next = current.clone();
        let result = mutation(&mut next)?;
        persist_store(&self.inner.storage_path, &next)?;
        *current = next;
        Ok(result)
    }
}

fn next_activity_sequence(store: &mut ForumStore) -> u64 {
    store.next_activity_sequence = store.next_activity_sequence.saturating_add(1).max(1);
    store.next_activity_sequence
}

fn normalize_store(store: &mut ForumStore) -> bool {
    let mut changed = false;
    if store.version != STORE_VERSION {
        store.version = STORE_VERSION;
        changed = true;
    }

    let mut next = store.next_activity_sequence.max(
        store
            .topics
            .iter()
            .map(|topic| topic.activity_sequence)
            .max()
            .unwrap_or(0),
    );
    // Une ancienne version sans sequence est reconstruite dans l'ordre
    // chronologique. Les egalites restent deterministes grace a l'index.
    let mut missing = store
        .topics
        .iter()
        .enumerate()
        .filter(|(_, topic)| topic.activity_sequence == 0)
        .map(|(index, topic)| (index, topic.last_activity_at, topic.created_at))
        .collect::<Vec<_>>();
    missing.sort_by_key(|(index, last_activity, created)| (*last_activity, *created, *index));
    for (index, _, _) in missing {
        next = next.saturating_add(1).max(1);
        store.topics[index].activity_sequence = next;
        changed = true;
    }
    if store.next_activity_sequence != next {
        store.next_activity_sequence = next;
        changed = true;
    }
    changed
}

fn validate_text(value: String, max_chars: usize, label: &str) -> Result<String, ForumError> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(ForumError::Validation(format!("{label} est obligatoire")));
    }
    if value.contains('\0') {
        return Err(ForumError::Validation(format!(
            "{label} contient un caractere invalide"
        )));
    }
    let length = value.chars().count();
    if length > max_chars {
        return Err(ForumError::Validation(format!(
            "{label} ne peut pas depasser {max_chars} caracteres"
        )));
    }
    Ok(value)
}

fn text_excerpt(value: &str, max_chars: usize) -> String {
    let compact = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let excerpt = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        format!("{excerpt}…")
    } else {
        excerpt
    }
}

fn load_store(path: &Path) -> Result<ForumStore, ForumError> {
    if !path.exists() {
        return Ok(ForumStore::default());
    }
    let content = fs::read_to_string(path)
        .map_err(|error| ForumError::Internal(format!("Lecture du forum impossible : {error}")))?;
    match serde_json::from_str::<ForumStore>(&content) {
        Ok(store) if store.version <= STORE_VERSION => Ok(store),
        Ok(store) => Err(ForumError::Internal(format!(
            "Version du forum non supportee : {}",
            store.version
        ))),
        Err(error) => {
            let backup = path.with_extension(format!("corrupt-{}.json", metrics::now_ts()));
            fs::rename(path, &backup).map_err(|rename_error| {
                ForumError::Internal(format!(
                    "Forum illisible ({error}) et sauvegarde impossible ({rename_error})"
                ))
            })?;
            Ok(ForumStore::default())
        }
    }
}

fn persist_store(path: &Path, store: &ForumStore) -> Result<(), ForumError> {
    let content = serde_json::to_vec_pretty(store)
        .map_err(|error| ForumError::Internal(error.to_string()))?;
    fs_util::atomic_write(path, content)
        .map_err(|error| ForumError::Internal(format!("Ecriture du forum impossible : {error}")))
}

#[cfg(feature = "desktop")]
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn list_forum_topics(state: State<'_, ForumManager>) -> Result<Vec<ForumTopicSummary>, String> {
    state.list_topics().map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn get_forum_topic(
    state: State<'_, ForumManager>,
    topic_id: String,
) -> Result<ForumTopic, String> {
    state.topic(&topic_id).map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn create_forum_topic(
    state: State<'_, ForumManager>,
    title: String,
    body: String,
) -> Result<ForumTopic, String> {
    state
        .create_topic(ForumAuthor::local(), title, body)
        .map_err(|error| error.to_string())
}

#[cfg(feature = "desktop")]
#[cfg(feature = "desktop")]
#[tauri::command]
pub fn reply_to_forum_topic(
    state: State<'_, ForumManager>,
    topic_id: String,
    body: String,
) -> Result<ForumTopic, String> {
    state
        .add_reply(ForumAuthor::local(), &topic_id, body)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manager(name: &str) -> (PathBuf, ForumManager) {
        let root = std::env::temp_dir().join(format!("cst-forum-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let manager = ForumManager::new(root.join("forum.json")).unwrap();
        (root, manager)
    }

    fn author(id: &str) -> ForumAuthor {
        ForumAuthor::new(id.to_string(), format!("user-{id}"), None)
    }

    #[test]
    fn une_reponse_remonte_toujours_le_sujet_en_tete() {
        let (root, manager) = test_manager("bump");
        let first = manager
            .create_topic(author("a"), "Premier".to_string(), "Message A".to_string())
            .unwrap();
        let second = manager
            .create_topic(author("b"), "Second".to_string(), "Message B".to_string())
            .unwrap();
        assert_eq!(manager.list_topics().unwrap()[0].id, second.id);

        let updated = manager
            .add_reply(author("c"), &first.id, "Nouvelle reponse".to_string())
            .unwrap();
        let topics = manager.list_topics().unwrap();
        assert_eq!(topics[0].id, first.id);
        assert_eq!(topics[0].reply_count, 1);
        assert!(updated.activity_sequence > second.activity_sequence);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn les_sujets_et_reponses_survivent_au_rechargement() {
        let (root, manager) = test_manager("persistence");
        let topic = manager
            .create_topic(
                author("a"),
                "Sujet durable".to_string(),
                "Corps".to_string(),
            )
            .unwrap();
        manager
            .add_reply(author("b"), &topic.id, "Reponse durable".to_string())
            .unwrap();

        let reloaded = ForumManager::new(root.join("forum.json")).unwrap();
        let stored = reloaded.topic(&topic.id).unwrap();
        assert_eq!(stored.replies.len(), 1);
        assert_eq!(stored.replies[0].body, "Reponse durable");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn les_messages_vides_sont_refuses() {
        let (root, manager) = test_manager("validation");
        let error = manager
            .create_topic(author("a"), "  ".to_string(), "Message".to_string())
            .unwrap_err();
        assert!(matches!(error, ForumError::Validation(_)));
        let _ = fs::remove_dir_all(root);
    }
}
