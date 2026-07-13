//! Arbitre d'integration durable, parallele en preparation et atomique par branche.

use crate::worktree::{GitControl, GitPublishTarget, MergeContext};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::{BufRead, BufReader, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc, Mutex, Weak,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const JOURNAL_FILE: &str = "merge-queue.jsonl";
const TASK_JOURNAL_FILE: &str = "tasks.jsonl";
const JOURNAL_COMPACT_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MERGE_WORKERS: usize = 4;
const MAX_MERGE_WORKERS: usize = 32;
const MAX_CAS_ATTEMPTS: u32 = 32;
const DEFAULT_VERIFY_TIMEOUT_SECS: u64 = 15 * 60;
const DEFAULT_NETWORK_TIMEOUT_SECS: u64 = 2 * 60;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MergeStatus {
    Queued,
    Running,
    Landed,
    Conflict,
    VerifyFailed,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeStatusView {
    pub id: u64,
    pub room_id: String,
    pub status: MergeStatus,
    pub agent_ident: String,
    pub workspace_id: String,
    pub commit_sha: String,
    pub base_sha: String,
    pub target_ref: String,
    pub landed_sha: Option<String>,
    pub conflicts: Vec<String>,
    pub error: Option<String>,
    pub verify: bool,
    pub submitted_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MergeJob {
    id: u64,
    #[serde(default = "default_room_id")]
    room_id: String,
    status: MergeStatus,
    agent_ident: String,
    workspace_id: String,
    context: MergeContext,
    commit_sha: String,
    /// Dernier commit d'integration durablement prepare avant le CAS/push.
    /// Permet de reconnaitre un land deja effectue si le processus s'arrete
    /// entre la publication et l'ecriture du statut terminal.
    #[serde(default)]
    attempt_sha: Option<String>,
    landed_sha: Option<String>,
    #[serde(default)]
    conflicts: Vec<String>,
    error: Option<String>,
    verify: bool,
    submitted_at: i64,
    updated_at: i64,
}

impl MergeJob {
    fn view(&self) -> MergeStatusView {
        MergeStatusView {
            id: self.id,
            room_id: self.room_id.clone(),
            status: self.status,
            agent_ident: self.agent_ident.clone(),
            workspace_id: self.workspace_id.clone(),
            commit_sha: self.commit_sha.clone(),
            base_sha: self.context.base_sha.clone(),
            target_ref: self.context.target_ref.clone(),
            landed_sha: self.landed_sha.clone(),
            conflicts: self.conflicts.clone(),
            error: self.error.clone(),
            verify: self.verify,
            submitted_at: self.submitted_at,
            updated_at: self.updated_at,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TaskStatus {
    Claimed,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskView {
    #[serde(default = "default_room_id")]
    pub room_id: String,
    pub id: String,
    pub description: String,
    pub status: TaskStatus,
    pub claimed_by: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeQueueSnapshot {
    pub queued: usize,
    pub running: usize,
    pub landed: usize,
    pub attention: usize,
    pub recent_landed: Vec<MergeStatusView>,
    pub tasks: Vec<TaskView>,
}

type Notifier = Arc<dyn Fn(MergeStatusView) + Send + Sync>;

#[derive(Clone)]
pub struct MergeQueue {
    inner: Arc<QueueInner>,
}

struct QueueInner {
    data_dir: PathBuf,
    jobs: Mutex<BTreeMap<u64, MergeJob>>,
    submit_lock: Mutex<()>,
    tasks: Mutex<HashMap<String, TaskView>>,
    next_id: AtomicU64,
    sender: mpsc::Sender<u64>,
    io_lock: Mutex<()>,
    task_io_lock: Mutex<()>,
    notifier: Mutex<Option<Notifier>>,
    target_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    integration_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    owner_lock: Option<crate::fs_util::ProcessFileLock>,
    verify_command: Option<String>,
    command_timeouts: CommandTimeouts,
    ephemeral: bool,
}

#[derive(Clone, Copy)]
struct CommandTimeouts {
    verify: Duration,
    network: Duration,
}

impl CommandTimeouts {
    fn from_env() -> Self {
        Self {
            verify: timeout_from_env("CST_MERGE_VERIFY_TIMEOUT_SECS", DEFAULT_VERIFY_TIMEOUT_SECS),
            network: timeout_from_env(
                "CST_MERGE_NETWORK_TIMEOUT_SECS",
                DEFAULT_NETWORK_TIMEOUT_SECS,
            ),
        }
    }
}

impl MergeQueue {
    pub fn new() -> Self {
        Self::build_with_mode(
            std::env::temp_dir().join(format!(
                "cst-merge-memory-{}",
                uuid::Uuid::new_v4().simple()
            )),
            None,
            true,
            merge_workers_from_env(),
        )
    }

    pub fn with_data_dir(data_dir: PathBuf) -> Self {
        let verify_command = std::env::var("CST_MERGE_VERIFY_COMMAND")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        Self::build(data_dir, verify_command)
    }

    fn build(data_dir: PathBuf, verify_command: Option<String>) -> Self {
        Self::build_with_mode(data_dir, verify_command, false, merge_workers_from_env())
    }

    fn build_with_mode(
        data_dir: PathBuf,
        verify_command: Option<String>,
        ephemeral: bool,
        worker_count: usize,
    ) -> Self {
        Self::build_with_timeouts(
            data_dir,
            verify_command,
            ephemeral,
            worker_count,
            CommandTimeouts::from_env(),
        )
    }

    fn build_with_timeouts(
        data_dir: PathBuf,
        verify_command: Option<String>,
        ephemeral: bool,
        worker_count: usize,
        command_timeouts: CommandTimeouts,
    ) -> Self {
        let _ = fs::create_dir_all(data_dir.join("integration"));
        let _ = fs::create_dir_all(data_dir.join("hooks-empty"));
        let owner_lock = crate::fs_util::try_process_lock(&data_dir.join(".owner.lock")).ok();
        let is_owner = owner_lock.is_some();
        if is_owner {
            for journal in [JOURNAL_FILE, TASK_JOURNAL_FILE] {
                if let Err(error) = repair_jsonl_tail(&data_dir.join(journal)) {
                    eprintln!("[merge_queue] reparation de {journal} impossible: {error}");
                }
            }
        }
        let (sender, receiver) = mpsc::channel();
        let (jobs, next_id) = load_jobs(&data_dir);
        let tasks = load_tasks(&data_dir);
        let pending = jobs
            .values()
            .filter(|job| matches!(job.status, MergeStatus::Queued | MergeStatus::Running))
            .map(|job| job.id)
            .collect::<Vec<_>>();
        let inner = Arc::new(QueueInner {
            data_dir,
            jobs: Mutex::new(jobs),
            submit_lock: Mutex::new(()),
            tasks: Mutex::new(tasks),
            next_id: AtomicU64::new(next_id),
            sender,
            io_lock: Mutex::new(()),
            task_io_lock: Mutex::new(()),
            notifier: Mutex::new(None),
            target_locks: Mutex::new(HashMap::new()),
            integration_locks: Mutex::new(HashMap::new()),
            owner_lock,
            verify_command,
            command_timeouts,
            ephemeral,
        });
        if is_owner {
            spawn_workers(Arc::downgrade(&inner), receiver, worker_count);
        } else {
            drop(receiver);
            eprintln!(
                "[merge_queue] store {} possede par un autre processus; worker passif",
                inner.data_dir.display()
            );
        }
        let queue = Self { inner };
        for id in pending {
            let _ = queue.inner.sender.send(id);
        }
        queue
    }

    #[cfg(test)]
    fn build_with_workers(
        data_dir: PathBuf,
        verify_command: Option<String>,
        worker_count: usize,
    ) -> Self {
        Self::build_with_mode(data_dir, verify_command, false, worker_count)
    }

    #[cfg(test)]
    fn build_with_test_timeouts(
        data_dir: PathBuf,
        verify_command: Option<String>,
        worker_count: usize,
        verify_timeout: Duration,
        network_timeout: Duration,
    ) -> Self {
        Self::build_with_timeouts(
            data_dir,
            verify_command,
            false,
            worker_count,
            CommandTimeouts {
                verify: verify_timeout,
                network: network_timeout,
            },
        )
    }

    pub fn set_notifier(&self, notifier: Notifier) {
        if let Ok(mut slot) = self.inner.notifier.lock() {
            *slot = Some(notifier);
        }
    }

    pub fn submit(
        &self,
        room_id: &str,
        agent_ident: &str,
        workspace_id: &str,
        mut context: MergeContext,
        commit_sha: Option<&str>,
        verify: bool,
    ) -> Result<MergeStatusView, String> {
        if self.inner.owner_lock.is_none() {
            return Err(
                "ce processus n'est pas proprietaire de la merge queue; utilise son endpoint MCP/REST"
                    .to_string(),
            );
        }
        let commit_sha = match commit_sha.map(str::trim).filter(|value| !value.is_empty()) {
            Some(value) => resolve_commit(&context.worktree, value)?,
            None => resolve_commit(&context.worktree, "HEAD")?,
        };
        let dirty = git_output(
            Command::new("git")
                .arg("-C")
                .arg(&context.worktree)
                .args(["status", "--porcelain"]),
            "lecture du statut de soumission",
        )?;
        if !dirty.is_empty() {
            return Err(
                "le worktree contient des changements non committes; commit puis resoumets"
                    .to_string(),
            );
        }
        if commit_sha == context.base_sha {
            return Err("aucun commit nouveau a integrer".to_string());
        }
        if !git_success(Command::new("git").arg("-C").arg(&context.worktree).args([
            "merge-base",
            "--is-ancestor",
            &context.base_sha,
            &commit_sha,
        ])) {
            return Err("le commit soumis ne descend pas de CST_BASE_SHA".to_string());
        }

        // Apres un conflit, l'agent peut avoir rebase sur la base annoncee dans
        // le salon. On ne remplace la base effective que si la cible a avance
        // depuis l'ancienne base ET que le commit soumis contient deja cette
        // nouvelle tete. Une cible en retard ne doit jamais faire rejouer puis
        // reecrire des commits qui existent deja dans la base de l'agent.
        if let Ok(current_target) = resolve_control_ref(&context.control, &context.target_ref) {
            if current_target != context.base_sha {
                if is_control_ancestor(&context.control, &context.base_sha, &current_target)
                    && is_control_ancestor(&context.control, &current_target, &commit_sha)
                {
                    context.base_sha = current_target;
                } else if !is_control_ancestor(&context.control, &current_target, &context.base_sha)
                    && !is_control_ancestor(&context.control, &context.base_sha, &current_target)
                {
                    return Err(
                        "la branche cible a diverge de CST_BASE_SHA; resynchronise le worktree avant de soumettre"
                            .to_string(),
                    );
                }
            }
        }

        let _submit = self
            .inner
            .submit_lock
            .lock()
            .map_err(|_| "soumissions de merge verrouillees".to_string())?;
        let id = self.inner.next_id.fetch_add(1, Ordering::SeqCst);
        let queue_ref = queue_ref(id);
        let mut control = control_command(&context.control);
        git_run(
            control.args(["update-ref", &queue_ref, &commit_sha]),
            "ancrage du commit dans la queue",
        )?;
        let now = now_ts();
        let job = MergeJob {
            id,
            room_id: normalized_room_id(room_id),
            status: MergeStatus::Queued,
            agent_ident: agent_ident.to_string(),
            workspace_id: workspace_id.to_string(),
            context,
            commit_sha,
            attempt_sha: None,
            landed_sha: None,
            conflicts: Vec::new(),
            error: None,
            verify,
            submitted_at: now,
            updated_at: now,
        };
        let view = job.view();
        self.inner
            .jobs
            .lock()
            .map_err(|_| "merge queue verrouillee".to_string())?
            .insert(id, job.clone());
        if let Err(error) = persist_job(&self.inner, &job) {
            if let Ok(mut jobs) = self.inner.jobs.lock() {
                jobs.remove(&id);
            }
            let mut control = control_command(&job.context.control);
            let _ = git_run(
                control.args(["update-ref", "-d", &queue_ref, &job.commit_sha]),
                "annulation de la ref queue",
            );
            return Err(format!(
                "soumission non journalisee; aucune publication effectuee: {error}"
            ));
        }
        self.inner
            .sender
            .send(id)
            .map_err(|_| "worker de merge indisponible".to_string())?;
        Ok(view)
    }

    pub fn status(&self, room_id: &str, id: u64) -> Result<MergeStatusView, String> {
        let room_id = normalized_room_id(room_id);
        self.inner
            .jobs
            .lock()
            .map_err(|_| "merge queue verrouillee".to_string())?
            .get(&id)
            .filter(|job| job.room_id == room_id)
            .map(MergeJob::view)
            .ok_or_else(|| format!("soumission de merge introuvable: {id}"))
    }

    pub fn list_landed(&self, room_id: &str, limit: usize) -> Vec<MergeStatusView> {
        let room_id = normalized_room_id(room_id);
        self.inner
            .jobs
            .lock()
            .map(|jobs| {
                jobs.values()
                    .rev()
                    .filter(|job| job.room_id == room_id && job.status == MergeStatus::Landed)
                    .take(limit.clamp(1, 200))
                    .map(MergeJob::view)
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn snapshot(&self, room_id: &str) -> MergeQueueSnapshot {
        let room_id = normalized_room_id(room_id);
        let (queued, running, landed, attention, recent_landed) = self
            .inner
            .jobs
            .lock()
            .map(|jobs| {
                let queued = jobs
                    .values()
                    .filter(|job| job.room_id == room_id && job.status == MergeStatus::Queued)
                    .count();
                let running = jobs
                    .values()
                    .filter(|job| job.room_id == room_id && job.status == MergeStatus::Running)
                    .count();
                let landed = jobs
                    .values()
                    .filter(|job| job.room_id == room_id && job.status == MergeStatus::Landed)
                    .count();
                let attention = jobs
                    .values()
                    .filter(|job| {
                        job.room_id == room_id
                            && matches!(
                                job.status,
                                MergeStatus::Conflict
                                    | MergeStatus::VerifyFailed
                                    | MergeStatus::Failed
                            )
                    })
                    .count();
                let recent_landed = jobs
                    .values()
                    .rev()
                    .filter(|job| job.room_id == room_id && job.status == MergeStatus::Landed)
                    .take(8)
                    .map(MergeJob::view)
                    .collect();
                (queued, running, landed, attention, recent_landed)
            })
            .unwrap_or_default();
        MergeQueueSnapshot {
            queued,
            running,
            landed,
            attention,
            recent_landed,
            tasks: self.list_tasks(&room_id),
        }
    }

    pub fn claim_task(
        &self,
        room_id: &str,
        task_id: &str,
        description: Option<&str>,
        agent_ident: &str,
    ) -> Result<TaskView, String> {
        self.ensure_owner()?;
        let room_id = normalized_room_id(room_id);
        let id = validate_task_id(task_id)?;
        let key = scoped_task_key(&room_id, &id);
        let mut tasks = self
            .inner
            .tasks
            .lock()
            .map_err(|_| "task board verrouille".to_string())?;
        if let Some(task) = tasks.get(&key) {
            if task.status == TaskStatus::Completed {
                return Err(format!("tache deja terminee: {id}"));
            }
            if task.claimed_by != agent_ident {
                return Err(format!("tache deja prise par {}", task.claimed_by));
            }
            return Ok(task.clone());
        }
        let task = TaskView {
            room_id,
            id: id.clone(),
            description: description
                .unwrap_or("")
                .trim()
                .chars()
                .take(2000)
                .collect(),
            status: TaskStatus::Claimed,
            claimed_by: agent_ident.to_string(),
            updated_at: now_ts(),
        };
        tasks.insert(key.clone(), task.clone());
        if let Err(error) = persist_task(&self.inner, &task) {
            tasks.remove(&key);
            return Err(format!("claim non journalise: {error}"));
        }
        Ok(task)
    }

    pub fn complete_task(
        &self,
        room_id: &str,
        task_id: &str,
        agent_ident: &str,
    ) -> Result<TaskView, String> {
        self.ensure_owner()?;
        let room_id = normalized_room_id(room_id);
        let id = validate_task_id(task_id)?;
        let key = scoped_task_key(&room_id, &id);
        let mut tasks = self
            .inner
            .tasks
            .lock()
            .map_err(|_| "task board verrouille".to_string())?;
        let task = tasks
            .get_mut(&key)
            .ok_or_else(|| format!("tache introuvable: {id}"))?;
        if task.claimed_by != agent_ident {
            return Err(format!("tache prise par {}", task.claimed_by));
        }
        let previous = task.clone();
        task.status = TaskStatus::Completed;
        task.updated_at = now_ts();
        let completed = task.clone();
        if let Err(error) = persist_task(&self.inner, &completed) {
            *task = previous;
            return Err(format!("completion non journalisee: {error}"));
        }
        let task = completed;
        Ok(task)
    }

    pub fn list_tasks(&self, room_id: &str) -> Vec<TaskView> {
        let room_id = normalized_room_id(room_id);
        let mut tasks = self
            .inner
            .tasks
            .lock()
            .map(|tasks| {
                tasks
                    .values()
                    .filter(|task| task.room_id == room_id)
                    .cloned()
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        tasks.sort_by(|a, b| {
            a.updated_at
                .cmp(&b.updated_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        tasks
    }

    fn ensure_owner(&self) -> Result<(), String> {
        if self.inner.owner_lock.is_some() {
            Ok(())
        } else {
            Err(
                "ce processus n'est pas proprietaire du store; utilise son endpoint MCP/REST"
                    .to_string(),
            )
        }
    }
}

impl Drop for QueueInner {
    fn drop(&mut self) {
        if self.ephemeral
            && self.data_dir.starts_with(std::env::temp_dir())
            && self
                .data_dir
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.starts_with("cst-merge-memory-"))
        {
            drop(self.owner_lock.take());
            let _ = fs::remove_dir_all(&self.data_dir);
        }
    }
}

impl Default for MergeQueue {
    fn default() -> Self {
        Self::new()
    }
}

fn spawn_workers(inner: Weak<QueueInner>, receiver: mpsc::Receiver<u64>, worker_count: usize) {
    let receiver = Arc::new(Mutex::new(receiver));
    for worker_slot in 0..worker_count.clamp(1, MAX_MERGE_WORKERS) {
        let inner = inner.clone();
        let receiver = Arc::clone(&receiver);
        thread::Builder::new()
            .name(format!("cst-merge-{worker_slot}"))
            .spawn(move || loop {
                let id = {
                    let Ok(receiver) = receiver.lock() else {
                        break;
                    };
                    match receiver.recv() {
                        Ok(id) => id,
                        Err(_) => break,
                    }
                };
                let Some(inner) = inner.upgrade() else {
                    break;
                };
                process_job(&inner, id, worker_slot);
            })
            .expect("demarrage d'un worker de merge impossible");
    }
}

fn process_job(inner: &Arc<QueueInner>, id: u64, worker_slot: usize) {
    let Some(mut job) = update_job(inner, id, |job| {
        job.status = MergeStatus::Running;
        job.error = None;
        job.conflicts.clear();
    }) else {
        return;
    };

    let result = land_job(inner, &job, worker_slot);
    job = match result {
        Ok(landed_sha) => update_job(inner, id, |current| {
            current.status = MergeStatus::Landed;
            current.landed_sha = Some(landed_sha.clone());
            current.error = None;
            current.conflicts.clear();
        }),
        Err(LandError::Conflict { files, error }) => update_job(inner, id, |current| {
            current.status = MergeStatus::Conflict;
            current.conflicts = files.clone();
            current.error = Some(error.clone());
        }),
        Err(LandError::Verify(error)) => update_job(inner, id, |current| {
            current.status = MergeStatus::VerifyFailed;
            current.error = Some(error.clone());
        }),
        Err(LandError::Failed(error)) => update_job(inner, id, |current| {
            current.status = MergeStatus::Failed;
            current.error = Some(error.clone());
        }),
    }
    .unwrap_or(job);

    if job.status == MergeStatus::Landed {
        let mut control = control_command(&job.context.control);
        let _ = git_run(
            control.args(["update-ref", "-d", &queue_ref(job.id), &job.commit_sha]),
            "retrait de la ref queue",
        );
        let mut control = control_command(&job.context.control);
        let _ = git_run(
            control.args(["update-ref", "-d", &attempt_ref(job.id)]),
            "retrait de la ref de tentative",
        );
    }
    if let Ok(notifier) = inner.notifier.lock() {
        if let Some(notifier) = notifier.as_ref() {
            notifier(job.view());
        }
    }
}

fn update_job(
    inner: &Arc<QueueInner>,
    id: u64,
    update: impl FnOnce(&mut MergeJob),
) -> Option<MergeJob> {
    let job = {
        let mut jobs = inner.jobs.lock().ok()?;
        let job = jobs.get_mut(&id)?;
        update(job);
        job.updated_at = now_ts();
        job.clone()
    };
    if let Err(error) = persist_job(inner, &job) {
        eprintln!(
            "[merge_queue] statut {} non journalise pour le job {id}: {error}",
            match job.status {
                MergeStatus::Queued => "queued",
                MergeStatus::Running => "running",
                MergeStatus::Landed => "landed",
                MergeStatus::Conflict => "conflict",
                MergeStatus::VerifyFailed => "verifyFailed",
                MergeStatus::Failed => "failed",
            }
        );
    }
    Some(job)
}

enum LandError {
    Conflict { files: Vec<String>, error: String },
    Verify(String),
    Failed(String),
}

fn land_job(
    inner: &Arc<QueueInner>,
    job: &MergeJob,
    worker_slot: usize,
) -> Result<String, LandError> {
    let integration = integration_path(&inner.data_dir, &job.context.control, worker_slot);
    let mut recorded_attempt = job.attempt_sha.clone();
    for _attempt in 0..MAX_CAS_ATTEMPTS {
        let mut expected_old = resolve_control_ref(&job.context.control, &job.context.target_ref)
            .map_err(LandError::Failed)?;

        // Reprise apres crash : la tentative est journalisee AVANT le CAS. Si
        // la cible la contient deja, le land a reussi et ne doit pas etre
        // rejoue. Pour une cible distante, un fetch borne couvre le cas ou le
        // push a ete accepte mais sa reponse n'est jamais revenue au worker.
        if let Some(attempt_sha) = recorded_attempt.as_deref() {
            if !is_control_ancestor(&job.context.control, attempt_sha, &expected_old) {
                if let Some(publish) = job.context.publish.as_ref() {
                    refresh_publish_target(
                        &job.context.control,
                        publish,
                        inner.command_timeouts.network,
                    )
                    .map_err(LandError::Failed)?;
                    expected_old =
                        resolve_control_ref(&job.context.control, &job.context.target_ref)
                            .map_err(LandError::Failed)?;
                }
            }
            if is_control_ancestor(&job.context.control, attempt_sha, &expected_old) {
                return Ok(attempt_sha.to_string());
            }
        }

        // L'arbitre n'integre que sur une histoire comparable. Si main a ete
        // force-push/reset sur une branche divergente, aucun patch ancien ne
        // doit pouvoir legitimiser cette reecriture ni ecraser silencieusement
        // les commits qui etaient presents lors de la soumission.
        let integration_base = if is_control_ancestor(
            &job.context.control,
            &job.context.base_sha,
            &expected_old,
        ) {
            expected_old.clone()
        } else if is_control_ancestor(&job.context.control, &expected_old, &job.context.base_sha) {
            // La ref publiee est simplement en retard sur la base de l'agent :
            // construire depuis la base preserve ses commits sans les rejouer.
            job.context.base_sha.clone()
        } else {
            return Err(LandError::Conflict {
                files: changed_paths(
                    &job.context.control,
                    &job.context.base_sha,
                    &expected_old,
                ),
                error: "branche cible divergente ou reecrite depuis CST_BASE_SHA; integration refusee pour proteger les changements recents"
                    .to_string(),
            });
        };

        ensure_integration(inner, &job.context.control, &integration, &integration_base)
            .map_err(LandError::Failed)?;
        reset_integration(&integration, &integration_base).map_err(LandError::Failed)?;

        let commits = git_output(
            Command::new("git").arg("-C").arg(&integration).args([
                "rev-list",
                "--reverse",
                &format!("{}..{}", job.context.base_sha, job.commit_sha),
            ]),
            "calcul des commits a rebaser",
        )
        .map_err(LandError::Failed)?;
        let commits = commits
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect::<Vec<_>>();
        if commits.is_empty() {
            return Err(LandError::Failed("aucun commit a integrer".to_string()));
        }
        for commit in commits {
            let mut cherry_pick = Command::new("git");
            cherry_pick
                .arg("-c")
                .arg(format!(
                    "core.hooksPath={}",
                    inner.data_dir.join("hooks-empty").to_string_lossy()
                ))
                .arg("-C")
                .arg(&integration)
                .args(["cherry-pick", commit]);
            if let Err(error) = git_run(&mut cherry_pick, "rebase/cherry-pick") {
                let files = git_output(
                    Command::new("git").arg("-C").arg(&integration).args([
                        "diff",
                        "--name-only",
                        "--diff-filter=U",
                    ]),
                    "lecture des conflits",
                )
                .unwrap_or_default()
                .lines()
                .map(ToString::to_string)
                .collect::<Vec<_>>();
                let _ = git_run(
                    Command::new("git")
                        .arg("-C")
                        .arg(&integration)
                        .args(["cherry-pick", "--abort"]),
                    "abort du cherry-pick",
                );
                if files.is_empty() {
                    return Err(LandError::Failed(error));
                }
                return Err(LandError::Conflict {
                    files,
                    error:
                        "une zone modifiee depuis la base serait remplacee; rebase le worktree puis resoumets"
                            .to_string(),
                });
            }
        }

        let new_sha = resolve_commit(&integration, "HEAD").map_err(LandError::Failed)?;
        if !git_success(Command::new("git").arg("-C").arg(&integration).args([
            "merge-base",
            "--is-ancestor",
            &expected_old,
            &new_sha,
        ])) {
            return Err(LandError::Failed(
                "arbitre anti-reset: le resultat ne conserve pas la tete courante".to_string(),
            ));
        }

        if job.verify {
            if let Err(error) = run_verify(
                &integration,
                inner.verify_command.as_deref(),
                inner.command_timeouts.verify,
            ) {
                let _ = reset_integration(&integration, &integration_base);
                return Err(LandError::Verify(error));
            }
        }
        record_attempt(inner, job.id, &job.context.control, &new_sha).map_err(LandError::Failed)?;
        recorded_attempt = Some(new_sha.clone());
        let target_lock = target_lock(inner, &job.context).map_err(LandError::Failed)?;
        let landed = {
            let _publish = target_lock
                .lock()
                .map_err(|_| LandError::Failed("arbitre de branche verrouille".to_string()))?;
            let current = resolve_control_ref(&job.context.control, &job.context.target_ref)
                .map_err(LandError::Failed)?;
            if current != expected_old {
                Ok(false)
            } else {
                cas_land(
                    &job.context.control,
                    &job.context.target_ref,
                    job.context.publish.as_ref(),
                    &new_sha,
                    &expected_old,
                    inner.command_timeouts.network,
                )
            }
        };
        match landed {
            Ok(true) => return Ok(new_sha),
            Ok(false) => {}
            Err(error) => return Err(LandError::Failed(error)),
        }
        // Une ecriture externe a gagne entre la lecture et le CAS : on repart
        // de la nouvelle tete, sans jamais perdre sa mise a jour.
    }
    Err(LandError::Failed(
        "la branche cible change trop vite; resoumets plus tard".to_string(),
    ))
}

/// Upstream configure : publication fast-forward non forcee, sans toucher au
/// checkout utilisateur. Bare/mirror : CAS `update-ref` exact. Repo local sans
/// upstream dont la branche cible est checkout : `git merge --ff-only` met a
/// jour ref + index + fichiers uniquement si le checkout est propre.
fn cas_land(
    control: &GitControl,
    target_ref: &str,
    publish: Option<&GitPublishTarget>,
    new_sha: &str,
    expected_old: &str,
    network_timeout: Duration,
) -> Result<bool, String> {
    if let Some(publish) = publish {
        if target_ref != publish.tracking_ref {
            return Err("cible de publication incoherente avec sa ref de suivi".to_string());
        }
        return publish_fast_forward(control, publish, new_sha, expected_old, network_timeout);
    }
    if let GitControl::WorkTree { repo_root } = control {
        let checked_out = git_output(
            Command::new("git")
                .arg("-C")
                .arg(repo_root)
                .args(["symbolic-ref", "-q", "HEAD"]),
            "lecture de la branche checkout",
        )
        .ok();
        if checked_out.as_deref() == Some(target_ref) {
            let status = git_output(
                Command::new("git")
                    .arg("-C")
                    .arg(repo_root)
                    .args(["status", "--porcelain"]),
                "verification du checkout principal",
            )?;
            if !status.is_empty() {
                return Err(
                    "checkout principal modifie; nettoie/commit avant de lander la queue"
                        .to_string(),
                );
            }
            let current = resolve_control_ref(control, target_ref)?;
            if current != expected_old {
                return Ok(false);
            }
            let mut merge = Command::new("git");
            merge
                .arg("-c")
                .arg("core.hooksPath=.git/cst-hooks-disabled")
                .arg("-C")
                .arg(repo_root)
                .args(["merge", "--ff-only", new_sha]);
            git_run(&mut merge, "fast-forward du checkout principal")?;
            return Ok(resolve_control_ref(control, target_ref)? == new_sha);
        }
    }

    let mut command = control_command(control);
    Ok(git_run(
        command.args(["update-ref", target_ref, new_sha, expected_old]),
        "CAS update-ref",
    )
    .is_ok())
}

fn publish_fast_forward(
    control: &GitControl,
    publish: &GitPublishTarget,
    new_sha: &str,
    expected_old: &str,
    timeout: Duration,
) -> Result<bool, String> {
    let refspec = format!("{new_sha}:{}", publish.remote_ref);
    let mut push = control_command(control);
    push.args([
        "push",
        "--porcelain",
        "--no-verify",
        &publish.remote,
        &refspec,
    ])
    .env("GIT_TERMINAL_PROMPT", "0");
    match git_run_with_timeout(&mut push, "publication fast-forward par l'arbitre", timeout) {
        Ok(()) => {
            // Git met normalement la remote-tracking ref a jour apres un push.
            // Le CAS best-effort couvre aussi les remotes/configurations qui ne
            // le font pas, sans jamais forcer une valeur plus recente.
            if resolve_control_ref(control, &publish.tracking_ref).as_deref() != Ok(new_sha) {
                let mut update = control_command(control);
                let _ = git_run(
                    update.args(["update-ref", &publish.tracking_ref, new_sha, expected_old]),
                    "mise a jour de la ref de suivi",
                );
            }
            Ok(true)
        }
        Err(push_error) => {
            // Un push concurrent a pu gagner. On rafraichit uniquement la ref
            // de suivi (jamais le checkout utilisateur), puis le worker rebase
            // et revalide son patch sur cette nouvelle tete.
            if let Err(fetch_error) = refresh_publish_target(control, publish, timeout) {
                return Err(format!("{push_error}; {fetch_error}"));
            }
            let current = resolve_control_ref(control, &publish.tracking_ref)?;
            if current == new_sha || is_control_ancestor(control, new_sha, &current) {
                Ok(true)
            } else if current != expected_old {
                Ok(false)
            } else {
                Err(push_error)
            }
        }
    }
}

fn refresh_publish_target(
    control: &GitControl,
    publish: &GitPublishTarget,
    timeout: Duration,
) -> Result<(), String> {
    let refspec = format!("+{}:{}", publish.remote_ref, publish.tracking_ref);
    let mut fetch = control_command(control);
    git_run_with_timeout(
        fetch
            .args(["fetch", "--quiet", "--no-tags", &publish.remote, &refspec])
            .env("GIT_TERMINAL_PROMPT", "0"),
        "actualisation de la tete publiee",
        timeout,
    )
}

/// Rend une tentative recuperable avant toute mutation de la cible. La ref Git
/// protege le commit candidat du GC et le journal permet de determiner, apres
/// redemarrage, si le CAS/push avait deja abouti.
fn record_attempt(
    inner: &Arc<QueueInner>,
    id: u64,
    control: &GitControl,
    new_sha: &str,
) -> Result<(), String> {
    let mut command = control_command(control);
    git_run(
        command.args(["update-ref", &attempt_ref(id), new_sha]),
        "ancrage de la tentative de merge",
    )?;
    let snapshot = {
        let mut jobs = inner
            .jobs
            .lock()
            .map_err(|_| "merge queue verrouillee".to_string())?;
        let job = jobs
            .get_mut(&id)
            .ok_or_else(|| format!("soumission de merge introuvable: {id}"))?;
        job.attempt_sha = Some(new_sha.to_string());
        job.updated_at = now_ts();
        job.clone()
    };
    persist_job(inner, &snapshot)
        .map_err(|error| format!("tentative non journalisee; publication annulee: {error}"))
}

fn target_lock(inner: &QueueInner, context: &MergeContext) -> Result<Arc<Mutex<()>>, String> {
    let control = control_key(&context.control);
    let target = context
        .publish
        .as_ref()
        .map(|publish| format!("{}:{}", publish.remote, publish.remote_ref))
        .unwrap_or_else(|| context.target_ref.clone());
    let key = format!("{control}\0{target}");
    let mut locks = inner
        .target_locks
        .lock()
        .map_err(|_| "registre des arbitres de branche verrouille".to_string())?;
    // Le nombre de dossiers peut croitre sans limite. Les entrees sans worker
    // actif sont donc elaguees au fil de l'eau au lieu de vivre jusqu'au
    // redemarrage du serveur.
    locks.retain(|_, lock| Arc::strong_count(lock) > 1);
    Ok(Arc::clone(
        locks.entry(key).or_insert_with(|| Arc::new(Mutex::new(()))),
    ))
}

fn integration_setup_lock(
    inner: &QueueInner,
    control: &GitControl,
) -> Result<Arc<Mutex<()>>, String> {
    let key = control_key(control);
    let mut locks = inner
        .integration_locks
        .lock()
        .map_err(|_| "registre de preparation des worktrees verrouille".to_string())?;
    locks.retain(|_, lock| Arc::strong_count(lock) > 1);
    Ok(Arc::clone(
        locks.entry(key).or_insert_with(|| Arc::new(Mutex::new(()))),
    ))
}

fn control_key(control: &GitControl) -> String {
    match control {
        GitControl::WorkTree { repo_root } => format!("worktree:{}", repo_root.display()),
        GitControl::Bare { git_dir } => format!("bare:{}", git_dir.display()),
    }
}

fn is_control_ancestor(control: &GitControl, ancestor: &str, descendant: &str) -> bool {
    let mut command = control_command(control);
    git_success(command.args(["merge-base", "--is-ancestor", ancestor, descendant]))
}

fn changed_paths(control: &GitControl, before: &str, after: &str) -> Vec<String> {
    let mut command = control_command(control);
    git_output(
        command.args([
            "diff",
            "--name-only",
            "--diff-filter=ACDMRTUXB",
            before,
            after,
        ]),
        "lecture des fichiers divergents",
    )
    .unwrap_or_default()
    .lines()
    .filter(|line| !line.trim().is_empty())
    .map(ToString::to_string)
    .collect()
}

fn ensure_integration(
    inner: &QueueInner,
    control: &GitControl,
    integration: &Path,
    expected: &str,
) -> Result<(), String> {
    let setup_lock = integration_setup_lock(inner, control)?;
    let _setup = setup_lock
        .lock()
        .map_err(|_| "preparation des worktrees d'integration verrouillee".to_string())?;
    if integration.join(".git").exists() {
        return Ok(());
    }
    if integration.exists() {
        safe_remove_integration(&inner.data_dir, integration);
    }
    if let Some(parent) = integration.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut prune = control_command(control);
    let _ = git_run(prune.args(["worktree", "prune"]), "prune integration");
    let mut add = control_command(control);
    git_run(
        add.args(["worktree", "add", "--detach"])
            .arg(integration)
            .arg(expected),
        "creation du worktree d'integration",
    )
}

fn reset_integration(integration: &Path, expected: &str) -> Result<(), String> {
    git_run(
        Command::new("git")
            .arg("-C")
            .arg(integration)
            .args(["reset", "--hard", expected]),
        "reset integration",
    )?;
    git_run(
        Command::new("git")
            .arg("-C")
            .arg(integration)
            .args(["clean", "-fd"]),
        "clean integration",
    )
}

fn run_verify(integration: &Path, script: Option<&str>, timeout: Duration) -> Result<(), String> {
    let Some(script) = script else {
        return Ok(());
    };
    let mut command = if cfg!(windows) {
        let mut command = Command::new("cmd.exe");
        command.args(["/D", "/S", "/C", script]);
        command
    } else {
        let mut command = Command::new("sh");
        command.args(["-lc", script]);
        command
    };
    command.current_dir(integration).stdin(Stdio::null());
    let output = command_output_with_timeout(&mut command, "verify", timeout)?;
    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        Err(format!(
            "verify a echoue ({}): {}{}",
            output.status,
            truncate(&stdout, 4000),
            truncate(&stderr, 4000)
        ))
    }
}

fn load_jobs(data_dir: &Path) -> (BTreeMap<u64, MergeJob>, u64) {
    let mut jobs = BTreeMap::new();
    let mut max_id = 0;
    if let Ok(file) = fs::File::open(data_dir.join(JOURNAL_FILE)) {
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if let Ok(mut job) = serde_json::from_str::<MergeJob>(&line) {
                if job.status == MergeStatus::Running {
                    job.status = MergeStatus::Queued;
                }
                max_id = max_id.max(job.id);
                jobs.insert(job.id, job);
            }
        }
    }
    (jobs, max_id + 1)
}

/// Une extinction brutale peut laisser le dernier JSON incomplet. Sans
/// reparation, le prochain append serait colle a ce fragment et deux mises a
/// jour seraient perdues au rechargement. Une derniere valeur complete sans
/// saut de ligne est conservee ; seul un fragment invalide est tronque.
fn repair_jsonl_tail(path: &Path) -> Result<(), String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    if bytes.is_empty() || bytes.last() == Some(&b'\n') {
        return Ok(());
    }
    let line_start = bytes
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map(|position| position + 1)
        .unwrap_or(0);
    let keep_len = if serde_json::from_slice::<serde_json::Value>(&bytes[line_start..]).is_ok() {
        bytes.len()
    } else {
        line_start
    };
    let mut file = fs::OpenOptions::new()
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.set_len(keep_len as u64)
        .map_err(|error| error.to_string())?;
    if keep_len == bytes.len() {
        file.seek(SeekFrom::End(0))
            .map_err(|error| error.to_string())?;
        writeln!(file).map_err(|error| error.to_string())?;
    }
    file.flush().map_err(|error| error.to_string())?;
    file.sync_data().map_err(|error| error.to_string())
}

fn load_tasks(data_dir: &Path) -> HashMap<String, TaskView> {
    let mut tasks = HashMap::new();
    if let Ok(file) = fs::File::open(data_dir.join(TASK_JOURNAL_FILE)) {
        for line in BufReader::new(file).lines().map_while(Result::ok) {
            if let Ok(task) = serde_json::from_str::<TaskView>(&line) {
                tasks.insert(scoped_task_key(&task.room_id, &task.id), task);
            }
        }
    }
    tasks
}

fn persist_job(inner: &QueueInner, job: &MergeJob) -> Result<(), String> {
    let line = serde_json::to_string(job).map_err(|error| error.to_string())?;
    let _io = inner
        .io_lock
        .lock()
        .map_err(|_| "journal de merge verrouille".to_string())?;
    let path = inner.data_dir.join(JOURNAL_FILE);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("ouverture de {} impossible: {error}", path.display()))?;
    writeln!(file, "{line}").map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    file.sync_data().map_err(|error| error.to_string())?;
    drop(file);
    if path.metadata().map(|meta| meta.len()).unwrap_or(0) > JOURNAL_COMPACT_BYTES {
        if let Ok(jobs) = inner.jobs.lock() {
            let compact = jobs
                .values()
                .filter_map(|job| serde_json::to_string(job).ok())
                .collect::<Vec<_>>()
                .join("\n");
            if let Err(error) = crate::fs_util::atomic_write(&path, format!("{compact}\n")) {
                eprintln!("[merge_queue] compaction du journal ignoree: {error}");
            }
        }
    }
    Ok(())
}

fn persist_task(inner: &QueueInner, task: &TaskView) -> Result<(), String> {
    let line = serde_json::to_string(task).map_err(|error| error.to_string())?;
    let _io = inner
        .task_io_lock
        .lock()
        .map_err(|_| "journal des taches verrouille".to_string())?;
    let path = inner.data_dir.join(TASK_JOURNAL_FILE);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("ouverture de {} impossible: {error}", path.display()))?;
    writeln!(file, "{line}").map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    file.sync_data().map_err(|error| error.to_string())?;
    Ok(())
}

fn integration_path(data_dir: &Path, control: &GitControl, worker_slot: usize) -> PathBuf {
    let identity = match control {
        GitControl::WorkTree { repo_root } => repo_root,
        GitControl::Bare { git_dir } => git_dir,
    };
    let digest = Sha256::digest(identity.to_string_lossy().as_bytes());
    let key = digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    data_dir
        .join("integration")
        .join(format!("worker-{worker_slot}"))
        .join(key)
}

fn resolve_control_ref(control: &GitControl, reference: &str) -> Result<String, String> {
    let mut command = control_command(control);
    git_output(
        command.args(["rev-parse", "--verify", reference]),
        "lecture de la branche cible",
    )
}

fn resolve_commit(worktree: &Path, value: &str) -> Result<String, String> {
    git_output(
        Command::new("git").arg("-C").arg(worktree).args([
            "rev-parse",
            "--verify",
            &format!("{value}^{{commit}}"),
        ]),
        "resolution du commit",
    )
}

fn control_command(control: &GitControl) -> Command {
    let mut command = Command::new("git");
    match control {
        GitControl::WorkTree { repo_root } => {
            command.arg("-C").arg(repo_root);
        }
        GitControl::Bare { git_dir } => {
            command.arg("--git-dir").arg(git_dir);
        }
    }
    command
}

fn git_output(command: &mut Command, operation: &str) -> Result<String, String> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let output = command
        .output()
        .map_err(|error| format!("{operation} impossible: {error}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "{operation} a echoue ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn git_output_with_timeout(
    command: &mut Command,
    operation: &str,
    timeout: Duration,
) -> Result<String, String> {
    let output = command_output_with_timeout(command, operation, timeout)?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(format!(
            "{operation} a echoue ({}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ))
    }
}

fn git_run(command: &mut Command, operation: &str) -> Result<(), String> {
    git_output(command, operation).map(|_| ())
}

fn git_run_with_timeout(
    command: &mut Command,
    operation: &str,
    timeout: Duration,
) -> Result<(), String> {
    git_output_with_timeout(command, operation, timeout).map(|_| ())
}

/// Execute une commande avec capture non bloquante et tue tout son arbre au
/// depassement du delai. Des fichiers temporaires evitent qu'un gros stdout
/// remplisse un pipe et soit confondu avec une commande figee.
fn command_output_with_timeout(
    command: &mut Command,
    operation: &str,
    timeout: Duration,
) -> Result<Output, String> {
    let capture_id = uuid::Uuid::new_v4().simple().to_string();
    let stdout_path = std::env::temp_dir().join(format!("cst-command-{capture_id}.stdout"));
    let stderr_path = std::env::temp_dir().join(format!("cst-command-{capture_id}.stderr"));
    let stdout_file = open_private_capture_file(&stdout_path)
        .map_err(|error| format!("capture stdout impossible: {error}"))?;
    let stderr_file = match open_private_capture_file(&stderr_path) {
        Ok(file) => file,
        Err(error) => {
            let _ = fs::remove_file(&stdout_path);
            return Err(format!("capture stderr impossible: {error}"));
        }
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file));
    configure_process_group(command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_file(&stdout_path);
            let _ = fs::remove_file(&stderr_path);
            return Err(format!("{operation} impossible: {error}"));
        }
    };
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => {
                thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                terminate_process_tree(&mut child);
                let _ = child.wait();
                let _ = fs::remove_file(&stdout_path);
                let _ = fs::remove_file(&stderr_path);
                return Err(format!(
                    "{operation} a depasse le delai de {} ms et a ete arretee",
                    timeout.as_millis()
                ));
            }
            Err(error) => {
                terminate_process_tree(&mut child);
                let _ = child.wait();
                let _ = fs::remove_file(&stdout_path);
                let _ = fs::remove_file(&stderr_path);
                return Err(format!("attente de {operation} impossible: {error}"));
            }
        }
    };
    let stdout = fs::read(&stdout_path).unwrap_or_default();
    let stderr = fs::read(&stderr_path).unwrap_or_default();
    let _ = fs::remove_file(&stdout_path);
    let _ = fs::remove_file(&stderr_path);
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn open_private_capture_file(path: &Path) -> std::io::Result<fs::File> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

#[cfg(unix)]
fn configure_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
fn configure_process_group(_command: &mut Command) {}

#[cfg(not(any(unix, windows)))]
fn configure_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn terminate_process_tree(child: &mut Child) {
    // Le process est leader du groupe cree dans `configure_process_group`.
    unsafe {
        libc::kill(-(child.id() as i32), libc::SIGKILL);
    }
    let _ = child.kill();
}

#[cfg(windows)]
fn terminate_process_tree(child: &mut Child) {
    // `Child::kill` ne termine pas les helpers ssh/git ni les hooks. taskkill /T
    // borne aussi ces descendants, puis `kill` couvre une course de sortie.
    let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let _ = child.kill();
}

#[cfg(not(any(unix, windows)))]
fn terminate_process_tree(child: &mut Child) {
    let _ = child.kill();
}

fn git_success(command: &mut Command) -> bool {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn queue_ref(id: u64) -> String {
    format!("refs/cst/queue/{id}")
}

fn attempt_ref(id: u64) -> String {
    format!("refs/cst/attempt/{id}")
}

fn validate_task_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || value.chars().count() > 160
        || value
            .chars()
            .any(|character| character.is_control() || character == '\0')
    {
        return Err("taskId invalide".to_string());
    }
    Ok(value.to_string())
}

fn default_room_id() -> String {
    crate::agent_room::DEFAULT_ROOM_ID.to_string()
}

fn normalized_room_id(value: &str) -> String {
    let value = value.trim();
    if value.is_empty() {
        default_room_id()
    } else {
        value.chars().take(160).collect()
    }
}

fn scoped_task_key(room_id: &str, task_id: &str) -> String {
    format!("{}\0{}", normalized_room_id(room_id), task_id)
}

fn safe_remove_integration(data_dir: &Path, target: &Path) {
    let root = data_dir
        .canonicalize()
        .unwrap_or_else(|_| data_dir.to_path_buf());
    let target_abs = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());
    if target_abs != root && target_abs.starts_with(&root) {
        let _ = fs::remove_dir_all(target);
    }
}

fn truncate(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn merge_workers_from_env() -> usize {
    std::env::var("CST_MERGE_WORKERS")
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_MERGE_WORKERS)
        .clamp(1, MAX_MERGE_WORKERS)
}

fn timeout_from_env(name: &str, default_secs: u64) -> Duration {
    let seconds = std::env::var(name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default_secs);
    Duration::from_secs(seconds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::worktree::WorktreeManager;
    use std::time::Duration;

    const ROOM: &str = "test-room";

    fn temp(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("cst-merge-{name}-{}", uuid::Uuid::new_v4()))
    }

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .unwrap();
        assert!(status.success(), "git {args:?}");
    }

    fn init_test_repo(root: &Path, name: &str) -> PathBuf {
        let repo = root.join(name);
        fs::create_dir_all(&repo).unwrap();
        git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("base.txt"), name).unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        repo
    }

    fn commit_file(repo: &Path, path: &str, contents: &str, message: &str) -> String {
        fs::write(repo.join(path), contents).unwrap();
        git(repo, &["add", path]);
        git(
            repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                message,
            ],
        );
        resolve_commit(repo, "HEAD").unwrap()
    }

    fn init_upstream_repo(root: &Path) -> (PathBuf, PathBuf) {
        let repo = init_test_repo(root, "repo");
        let origin = root.join("origin.git");
        fs::create_dir_all(&origin).unwrap();
        git(&origin, &["init", "--bare"]);
        let origin_url = origin.to_string_lossy().to_string();
        git(&repo, &["remote", "add", "origin", &origin_url]);
        git(&repo, &["push", "-u", "origin", "main"]);
        (repo, origin)
    }

    fn install_sleep_hook(origin: &Path, name: &str) -> PathBuf {
        let hook = origin.join("hooks").join(name);
        fs::write(&hook, "#!/bin/sh\nsleep 30\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
        }
        hook
    }

    fn install_verify_barrier(root: &Path) -> (String, PathBuf, PathBuf) {
        let ready = root.join("verify-ready");
        let release = root.join("verify-release");
        if cfg!(windows) {
            let script = root.join("verify-barrier.cmd");
            fs::write(
                &script,
                format!(
                    "@echo off\r\ntype nul > \"{}\"\r\n:wait\r\nif exist \"{}\" exit /b 0\r\nping -n 2 127.0.0.1 > nul\r\ngoto wait\r\n",
                    ready.display(),
                    release.display()
                ),
            )
            .unwrap();
            (script.display().to_string(), ready, release)
        } else {
            let script = root.join("verify-barrier.sh");
            fs::write(
                &script,
                format!(
                    "#!/bin/sh\n: > '{}'\nwhile [ ! -e '{}' ]; do sleep 0.05; done\n",
                    ready.display(),
                    release.display()
                ),
            )
            .unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
            }
            (script.display().to_string(), ready, release)
        }
    }

    fn wait_for_path(path: &Path) {
        for _ in 0..400 {
            if path.exists() {
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        panic!("fichier attendu absent: {}", path.display());
    }

    fn wait_terminal(queue: &MergeQueue, id: u64) -> MergeStatusView {
        for _ in 0..500 {
            let status = queue.status(ROOM, id).unwrap();
            if !matches!(status.status, MergeStatus::Queued | MergeStatus::Running) {
                return status;
            }
            thread::sleep(Duration::from_millis(30));
        }
        panic!("merge timeout")
    }

    #[test]
    fn same_target_cas_keeps_both_disjoint_changes() {
        let root = temp("fifo");
        let repo = root.join("repo");
        let home = root.join("home");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&home).unwrap();
        git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("base.txt"), "base").unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        let manager = WorktreeManager::new(root.join("runtime"), 2).unwrap();
        let a = manager.prepare_local("a", &home, Some(&repo)).unwrap();
        let b = manager.prepare_local("b", &home, Some(&repo)).unwrap();
        for (workspace, file) in [(&a, "a.txt"), (&b, "b.txt")] {
            fs::write(workspace.cwd().join(file), file).unwrap();
            git(workspace.cwd(), &["add", "."]);
            git(
                workspace.cwd(),
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    file,
                ],
            );
        }
        let queue = MergeQueue::with_data_dir(root.join("queue"));
        let first = queue
            .submit(
                ROOM,
                "a",
                a.workspace_id(),
                a.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let second = queue
            .submit(
                ROOM,
                "b",
                b.workspace_id(),
                b.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        assert_eq!(wait_terminal(&queue, first.id).status, MergeStatus::Landed);
        assert!(queue.status("other-room", first.id).is_err());
        assert_eq!(wait_terminal(&queue, second.id).status, MergeStatus::Landed);
        assert_eq!(queue.list_landed(ROOM, 10).len(), 2);
        assert!(repo.join("a.txt").is_file());
        assert!(repo.join("b.txt").is_file());
        drop(a);
        drop(b);
        drop(queue);
        let reloaded = MergeQueue::with_data_dir(root.join("queue"));
        assert_eq!(
            reloaded.status(ROOM, first.id).unwrap().status,
            MergeStatus::Landed
        );
        assert_eq!(
            reloaded.status(ROOM, second.id).unwrap().status,
            MergeStatus::Landed
        );
        drop(reloaded);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn independent_targets_are_prepared_and_verified_in_parallel() {
        let root = temp("parallel-workers");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let repo_a = init_test_repo(&root, "repo-a");
        let repo_b = init_test_repo(&root, "repo-b");
        let manager = WorktreeManager::new(root.join("runtime"), 2).unwrap();
        let agent_a = manager.prepare_local("a", &home, Some(&repo_a)).unwrap();
        let agent_b = manager.prepare_local("b", &home, Some(&repo_b)).unwrap();
        for (agent, file) in [(&agent_a, "a.txt"), (&agent_b, "b.txt")] {
            fs::write(agent.cwd().join(file), file).unwrap();
            git(agent.cwd(), &["add", "."]);
            git(
                agent.cwd(),
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    file,
                ],
            );
        }

        let queue_dir = root.join("queue");
        let integration_root = queue_dir.join("integration");
        let verify = if cfg!(windows) {
            let path = integration_root.to_string_lossy().replace('\'', "''");
            format!(
                "powershell -NoProfile -Command \"$deadline=(Get-Date).AddSeconds(5); Set-Content -LiteralPath 'cst-ready' -Value ready; while (@(Get-ChildItem -LiteralPath '{path}' -Filter 'cst-ready' -File -Recurse -ErrorAction SilentlyContinue).Count -lt 2) {{ if ((Get-Date) -gt $deadline) {{ exit 9 }}; Start-Sleep -Milliseconds 25 }}\""
            )
        } else {
            let path = integration_root.to_string_lossy().replace('\'', "'\"'\"'");
            format!(
                "touch cst-ready; i=0; while [ \"$(find '{path}' -name cst-ready -type f | wc -l)\" -lt 2 ]; do i=$((i+1)); [ \"$i\" -lt 200 ] || exit 9; sleep 0.025; done"
            )
        };
        let queue = MergeQueue::build_with_workers(queue_dir, Some(verify), 2);
        let first = queue
            .submit(
                ROOM,
                "a",
                agent_a.workspace_id(),
                agent_a.merge_context().unwrap(),
                None,
                true,
            )
            .unwrap();
        let second = queue
            .submit(
                ROOM,
                "b",
                agent_b.workspace_id(),
                agent_b.merge_context().unwrap(),
                None,
                true,
            )
            .unwrap();
        assert_eq!(wait_terminal(&queue, first.id).status, MergeStatus::Landed);
        assert_eq!(wait_terminal(&queue, second.id).status, MergeStatus::Landed);
        drop(agent_a);
        drop(agent_b);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hung_verify_is_bounded_and_the_only_worker_continues_with_next_folder() {
        let root = temp("verify-timeout");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let blocked_repo = init_test_repo(&root, "blocked-repo");
        let healthy_repo = init_test_repo(&root, "healthy-repo");
        let manager = WorktreeManager::new(root.join("runtime"), 2).unwrap();
        let blocked = manager
            .prepare_local("blocked", &home, Some(&blocked_repo))
            .unwrap();
        let healthy = manager
            .prepare_local("healthy", &home, Some(&healthy_repo))
            .unwrap();
        commit_file(blocked.cwd(), "hang.flag", "hang", "blocked verify");
        commit_file(healthy.cwd(), "healthy.txt", "ok", "healthy change");
        let verify = if cfg!(windows) {
            "ping -n 30 127.0.0.1 > nul"
        } else {
            "sleep 30"
        };
        let queue = MergeQueue::build_with_test_timeouts(
            root.join("queue"),
            Some(verify.to_string()),
            1,
            Duration::from_millis(350),
            Duration::from_secs(2),
        );
        let first = queue
            .submit(
                ROOM,
                "blocked",
                blocked.workspace_id(),
                blocked.merge_context().unwrap(),
                None,
                true,
            )
            .unwrap();
        let second = queue
            .submit(
                ROOM,
                "healthy",
                healthy.workspace_id(),
                healthy.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();

        let timed_out = wait_terminal(&queue, first.id);
        assert_eq!(timed_out.status, MergeStatus::VerifyFailed, "{timed_out:?}");
        assert!(
            timed_out
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("delai"),
            "{timed_out:?}"
        );
        let landed = wait_terminal(&queue, second.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        assert!(!blocked_repo.join("hang.flag").exists());
        assert_eq!(
            fs::read_to_string(healthy_repo.join("healthy.txt")).unwrap(),
            "ok"
        );
        drop(blocked);
        drop(healthy);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn blocked_push_times_out_without_moving_main_then_queue_recovers() {
        let root = temp("push-timeout");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let (repo, origin) = init_upstream_repo(&root);
        let base = resolve_commit(&repo, "refs/remotes/origin/main").unwrap();
        let hook = install_sleep_hook(&origin, "pre-receive");
        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("agent", &home, Some(&repo)).unwrap();
        commit_file(agent.cwd(), "agent.txt", "agent", "agent change");
        let queue = MergeQueue::build_with_test_timeouts(
            root.join("queue"),
            None,
            1,
            Duration::from_secs(2),
            Duration::from_secs(2),
        );
        let blocked = queue
            .submit(
                ROOM,
                "agent",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let failed = wait_terminal(&queue, blocked.id);
        assert_eq!(failed.status, MergeStatus::Failed, "{failed:?}");
        assert!(
            failed
                .error
                .as_deref()
                .unwrap_or_default()
                .contains("delai"),
            "{failed:?}"
        );
        assert_eq!(
            resolve_commit(&origin, "refs/heads/main").unwrap(),
            base,
            "un push bloque avant le CAS ne doit pas deplacer main"
        );

        fs::remove_file(hook).unwrap();
        let retry = queue
            .submit(
                ROOM,
                "agent",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let landed = wait_terminal(&queue, retry.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        assert_eq!(
            git_output(
                Command::new("git")
                    .arg("--git-dir")
                    .arg(&origin)
                    .args(["show", "refs/heads/main:agent.txt"]),
                "lecture du retry publie",
            )
            .unwrap(),
            "agent"
        );
        drop(agent);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn lost_push_response_is_recognized_as_landed() {
        let root = temp("push-response-lost");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let (repo, origin) = init_upstream_repo(&root);
        let _hook = install_sleep_hook(&origin, "post-receive");
        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("agent", &home, Some(&repo)).unwrap();
        commit_file(
            agent.cwd(),
            "landed.txt",
            "landed",
            "land despite lost response",
        );
        let queue = MergeQueue::build_with_test_timeouts(
            root.join("queue"),
            None,
            1,
            Duration::from_secs(2),
            Duration::from_secs(2),
        );
        let submitted = queue
            .submit(
                ROOM,
                "agent",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let landed = wait_terminal(&queue, submitted.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        assert_eq!(
            git_output(
                Command::new("git")
                    .arg("--git-dir")
                    .arg(&origin)
                    .args(["show", "refs/heads/main:landed.txt"]),
                "lecture apres reponse perdue",
            )
            .unwrap(),
            "landed"
        );
        drop(agent);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn concurrent_external_push_is_preserved_and_agent_patch_is_rebased() {
        let root = temp("concurrent-external-push");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let (repo, origin) = init_upstream_repo(&root);
        let external = root.join("external");
        let origin_url = origin.to_string_lossy().to_string();
        let external_path = external.to_string_lossy().to_string();
        git(
            &root,
            &[
                "clone",
                "--quiet",
                "--branch",
                "main",
                &origin_url,
                &external_path,
            ],
        );
        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("agent", &home, Some(&repo)).unwrap();
        commit_file(agent.cwd(), "agent.txt", "agent", "agent concurrent change");
        let (verify, ready, release) = install_verify_barrier(&root);
        let queue = MergeQueue::build_with_test_timeouts(
            root.join("queue"),
            Some(verify),
            1,
            Duration::from_secs(15),
            Duration::from_secs(5),
        );
        let submitted = queue
            .submit(
                ROOM,
                "agent",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                true,
            )
            .unwrap();
        wait_for_path(&ready);
        commit_file(
            &external,
            "external.txt",
            "external",
            "external concurrent push",
        );
        git(&external, &["push", "origin", "main"]);
        fs::write(&release, "release").unwrap();

        let landed = wait_terminal(&queue, submitted.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        for (path, expected) in [("agent.txt", "agent"), ("external.txt", "external")] {
            assert_eq!(
                git_output(
                    Command::new("git")
                        .arg("--git-dir")
                        .arg(&origin)
                        .args(["show", &format!("refs/heads/main:{path}"),]),
                    "lecture apres push concurrent",
                )
                .unwrap(),
                expected
            );
        }
        drop(agent);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn restart_after_cas_does_not_replay_an_already_landed_attempt() {
        let root = temp("restart-after-cas");
        let home = root.join("home");
        fs::create_dir_all(&home).unwrap();
        let repo = init_test_repo(&root, "repo");
        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("agent", &home, Some(&repo)).unwrap();
        let context = agent.merge_context().unwrap();
        let commit_sha = commit_file(agent.cwd(), "once.txt", "once", "land once");
        git(&repo, &["merge", "--ff-only", &commit_sha]);
        git(&repo, &["update-ref", &queue_ref(41), &commit_sha]);
        git(&repo, &["update-ref", &attempt_ref(41), &commit_sha]);

        let now = now_ts();
        let job = MergeJob {
            id: 41,
            room_id: ROOM.to_string(),
            status: MergeStatus::Running,
            agent_ident: "agent".to_string(),
            workspace_id: agent.workspace_id().to_string(),
            context,
            commit_sha: commit_sha.clone(),
            attempt_sha: Some(commit_sha.clone()),
            landed_sha: None,
            conflicts: Vec::new(),
            error: None,
            verify: false,
            submitted_at: now,
            updated_at: now,
        };
        let queue_dir = root.join("queue");
        fs::create_dir_all(&queue_dir).unwrap();
        fs::write(
            queue_dir.join(JOURNAL_FILE),
            format!("{}\n", serde_json::to_string(&job).unwrap()),
        )
        .unwrap();

        let queue = MergeQueue::build_with_test_timeouts(
            queue_dir,
            None,
            1,
            Duration::from_secs(2),
            Duration::from_secs(2),
        );
        let recovered = wait_terminal(&queue, 41);
        assert_eq!(recovered.status, MergeStatus::Landed, "{recovered:?}");
        assert_eq!(recovered.landed_sha.as_deref(), Some(commit_sha.as_str()));
        assert_eq!(
            git_output(
                Command::new("git").arg("-C").arg(&repo).args([
                    "rev-list",
                    "--count",
                    &format!("{}..main", job.context.base_sha)
                ]),
                "comptage apres reprise",
            )
            .unwrap(),
            "1",
            "la reprise ne doit pas dupliquer le patch"
        );
        assert!(!git_success(
            Command::new("git").arg("-C").arg(&repo).args([
                "show-ref",
                "--verify",
                "--quiet",
                &queue_ref(41)
            ])
        ));
        assert!(!git_success(
            Command::new("git").arg("-C").arg(&repo).args([
                "show-ref",
                "--verify",
                "--quiet",
                &attempt_ref(41)
            ])
        ));
        drop(agent);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn upstream_arbiter_publishes_without_touching_a_dirty_user_checkout() {
        let root = temp("upstream-dirty-checkout");
        let repo = root.join("repo");
        let origin = root.join("origin.git");
        let home = root.join("home");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&origin).unwrap();
        fs::create_dir_all(&home).unwrap();
        git(&origin, &["init", "--bare"]);
        git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("base.txt"), "base").unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        let local_main = resolve_commit(&repo, "HEAD").unwrap();
        let origin_url = origin.to_string_lossy().to_string();
        git(&repo, &["remote", "add", "origin", &origin_url]);
        git(&repo, &["push", "-u", "origin", "main"]);

        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("agent", &home, Some(&repo)).unwrap();
        assert!(agent.merge_context().unwrap().publish.is_some());
        fs::write(repo.join("personal-uncommitted.txt"), "do not touch").unwrap();
        fs::write(agent.cwd().join("agent.txt"), "agent change").unwrap();
        git(agent.cwd(), &["add", "."]);
        git(
            agent.cwd(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "agent change",
            ],
        );

        let queue = MergeQueue::build_with_workers(root.join("queue"), None, 2);
        let submitted = queue
            .submit(
                ROOM,
                "agent",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let landed = wait_terminal(&queue, submitted.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        assert_eq!(
            fs::read_to_string(repo.join("personal-uncommitted.txt")).unwrap(),
            "do not touch"
        );
        assert_eq!(
            resolve_commit(&repo, "refs/heads/main").unwrap(),
            local_main
        );
        assert_eq!(
            git_output(
                Command::new("git")
                    .arg("--git-dir")
                    .arg(&origin)
                    .args(["show", "refs/heads/main:agent.txt"]),
                "lecture du fichier publie",
            )
            .unwrap(),
            "agent change"
        );
        drop(agent);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn target_behind_agent_base_is_fast_forwarded_without_rewriting_recent_commits() {
        let root = temp("target-behind-base");
        let repo = root.join("repo");
        let home = root.join("home");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&home).unwrap();
        git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("base.txt"), "base").unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        let old_main = resolve_commit(&repo, "HEAD").unwrap();
        fs::write(repo.join("recent.txt"), "recent user work").unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=User",
                "-c",
                "user.email=user@example.com",
                "commit",
                "-m",
                "recent user work",
            ],
        );
        let recent_main = resolve_commit(&repo, "HEAD").unwrap();
        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("agent", &home, Some(&repo)).unwrap();
        fs::write(agent.cwd().join("agent.txt"), "agent").unwrap();
        git(agent.cwd(), &["add", "."]);
        git(
            agent.cwd(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "agent",
            ],
        );
        git(&repo, &["reset", "--hard", &old_main]);

        let queue = MergeQueue::with_data_dir(root.join("queue"));
        let submitted = queue
            .submit(
                ROOM,
                "agent",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let landed = wait_terminal(&queue, submitted.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        let final_main = resolve_commit(&repo, "refs/heads/main").unwrap();
        assert!(is_control_ancestor(
            &agent.merge_context().unwrap().control,
            &recent_main,
            &final_main,
        ));
        assert_eq!(
            fs::read_to_string(repo.join("recent.txt")).unwrap(),
            "recent user work"
        );
        assert_eq!(fs::read_to_string(repo.join("agent.txt")).unwrap(), "agent");
        drop(agent);
        drop(queue);
        drop(manager);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claim_task_is_atomic() {
        let root = temp("tasks");
        let queue = MergeQueue::with_data_dir(root.clone());
        let task = queue
            .claim_task(ROOM, "M1-1", Some("isoler"), "agent-a")
            .unwrap();
        assert_eq!(task.claimed_by, "agent-a");
        assert!(queue.claim_task(ROOM, "M1-1", None, "agent-b").is_err());
        assert_eq!(
            queue.complete_task(ROOM, "M1-1", "agent-a").unwrap().status,
            TaskStatus::Completed
        );
        let other = queue
            .claim_task("other-room", "M1-1", Some("autre repo"), "agent-b")
            .unwrap();
        assert_eq!(other.claimed_by, "agent-b");
        assert_eq!(queue.list_tasks(ROOM).len(), 1);
        assert_eq!(queue.list_tasks("other-room").len(), 1);
        drop(queue);
        let reloaded = MergeQueue::with_data_dir(root.clone());
        assert_eq!(reloaded.list_tasks(ROOM).len(), 1);
        assert_eq!(reloaded.list_tasks("other-room").len(), 1);
        drop(reloaded);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn truncated_journal_tail_is_repaired_before_future_appends() {
        let root = temp("journal-tail");
        fs::create_dir_all(&root).unwrap();
        let truncated = root.join("truncated.jsonl");
        fs::write(&truncated, b"{\"id\":1}\n{\"id\":").unwrap();
        repair_jsonl_tail(&truncated).unwrap();
        assert_eq!(fs::read(&truncated).unwrap(), b"{\"id\":1}\n");
        fs::OpenOptions::new()
            .append(true)
            .open(&truncated)
            .unwrap()
            .write_all(b"{\"id\":2}\n")
            .unwrap();
        let values = BufReader::new(fs::File::open(&truncated).unwrap())
            .lines()
            .map(|line| serde_json::from_str::<serde_json::Value>(&line.unwrap()).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(values.len(), 2);

        let complete = root.join("complete.jsonl");
        fs::write(&complete, b"{\"id\":3}").unwrap();
        repair_jsonl_tail(&complete).unwrap();
        assert_eq!(fs::read(&complete).unwrap(), b"{\"id\":3}\n");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn second_process_view_is_passive_until_owner_drops() {
        let root = temp("ownership");
        let owner = MergeQueue::with_data_dir(root.clone());
        let passive = MergeQueue::with_data_dir(root.clone());
        assert!(owner.ensure_owner().is_ok());
        assert!(passive.ensure_owner().is_err());
        assert!(passive.claim_task(ROOM, "x", None, "agent").is_err());
        drop(owner);
        let replacement = MergeQueue::with_data_dir(root.clone());
        assert!(replacement.ensure_owner().is_ok());
        drop(passive);
        drop(replacement);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn overlapping_changes_report_conflicting_files_without_moving_main_twice() {
        let root = temp("conflict");
        let repo = root.join("repo");
        let home = root.join("home");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&home).unwrap();
        git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("hot.txt"), "base\n").unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        let manager = WorktreeManager::new(root.join("runtime"), 2).unwrap();
        let a = manager.prepare_local("a", &home, Some(&repo)).unwrap();
        let b = manager.prepare_local("b", &home, Some(&repo)).unwrap();
        for (workspace, text) in [(&a, "from-a\n"), (&b, "from-b\n")] {
            fs::write(workspace.cwd().join("hot.txt"), text).unwrap();
            git(workspace.cwd(), &["add", "."]);
            git(
                workspace.cwd(),
                &[
                    "-c",
                    "user.name=Test",
                    "-c",
                    "user.email=test@example.com",
                    "commit",
                    "-m",
                    text.trim(),
                ],
            );
        }
        let queue = MergeQueue::with_data_dir(root.join("queue"));
        let first = queue
            .submit(
                ROOM,
                "a",
                a.workspace_id(),
                a.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let second = queue
            .submit(
                ROOM,
                "b",
                b.workspace_id(),
                b.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        assert_eq!(wait_terminal(&queue, first.id).status, MergeStatus::Landed);
        let conflict = wait_terminal(&queue, second.id);
        assert_eq!(conflict.status, MergeStatus::Conflict);
        assert_eq!(conflict.conflicts, vec!["hot.txt"]);
        assert_eq!(
            fs::read_to_string(repo.join("hot.txt")).unwrap().trim(),
            "from-a"
        );
        drop(a);
        drop(b);
        drop(queue);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn verify_failure_rolls_back_integration_and_keeps_target_unchanged() {
        let root = temp("verify");
        let repo = root.join("repo");
        let home = root.join("home");
        fs::create_dir_all(&repo).unwrap();
        fs::create_dir_all(&home).unwrap();
        git(&repo, &["init", "-b", "main"]);
        fs::write(repo.join("base.txt"), "base").unwrap();
        git(&repo, &["add", "."]);
        git(
            &repo,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        let base = git_output(
            Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(["rev-parse", "HEAD"]),
            "base",
        )
        .unwrap();
        let manager = WorktreeManager::new(root.join("runtime"), 1).unwrap();
        let agent = manager.prepare_local("a", &home, Some(&repo)).unwrap();
        fs::write(agent.cwd().join("new.txt"), "new").unwrap();
        git(agent.cwd(), &["add", "."]);
        git(
            agent.cwd(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "change",
            ],
        );
        let fail = if cfg!(windows) { "exit /b 7" } else { "exit 7" };
        let queue = MergeQueue::build(root.join("queue"), Some(fail.to_string()));
        let submitted = queue
            .submit(
                ROOM,
                "a",
                agent.workspace_id(),
                agent.merge_context().unwrap(),
                None,
                true,
            )
            .unwrap();
        assert_eq!(
            wait_terminal(&queue, submitted.id).status,
            MergeStatus::VerifyFailed
        );
        let target = git_output(
            Command::new("git")
                .arg("-C")
                .arg(&repo)
                .args(["rev-parse", "refs/heads/main"]),
            "target",
        )
        .unwrap();
        assert_eq!(target, base);
        drop(agent);
        drop(queue);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saas_mirror_reuse_keeps_landed_commits_when_remote_is_behind() {
        let root = temp("saas-mirror");
        let source = root.join("source");
        let home = root.join("home");
        fs::create_dir_all(&source).unwrap();
        fs::create_dir_all(&home).unwrap();
        git(&source, &["init", "-b", "main"]);
        fs::write(source.join("base.txt"), "base").unwrap();
        git(&source, &["add", "."]);
        git(
            &source,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "base",
            ],
        );
        let manager = WorktreeManager::new(root.join("runtime"), 2).unwrap();
        let source_url = source.to_string_lossy().to_string();
        let first = manager
            .prepare_remote("saas-a", &home, &source_url, &source_url, Some("main"))
            .unwrap();
        fs::write(first.cwd().join("landed.txt"), "landed").unwrap();
        git(first.cwd(), &["add", "."]);
        git(
            first.cwd(),
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-m",
                "landed",
            ],
        );
        let queue = MergeQueue::with_data_dir(root.join("queue"));
        let submitted = queue
            .submit(
                ROOM,
                "saas-a",
                first.workspace_id(),
                first.merge_context().unwrap(),
                None,
                false,
            )
            .unwrap();
        let landed = wait_terminal(&queue, submitted.id);
        assert_eq!(landed.status, MergeStatus::Landed, "{landed:?}");
        let landed_sha = landed.landed_sha.unwrap();
        drop(first);

        let second = manager
            .prepare_remote("saas-b", &home, &source_url, &source_url, Some("main"))
            .unwrap();
        assert_eq!(second.base_sha(), Some(landed_sha.as_str()));
        assert!(second.cwd().join("landed.txt").is_file());
        drop(second);
        drop(queue);
        let _ = fs::remove_dir_all(root);
    }
}
