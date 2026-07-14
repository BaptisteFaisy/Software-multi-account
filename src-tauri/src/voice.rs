//! Saisie vocale locale ou distante pour le compositeur de chat.
//!
//! Le navigateur capture un WAV mono 16 kHz. Ce module le transcrit soit avec
//! `whisper-cli` (whisper.cpp), soit avec une API distante compatible OpenAI,
//! puis demande a Ollama (local ou distant) de nettoyer la dictee. Les deux
//! moteurs sont appeles l'un apres l'autre afin de limiter la pression VRAM.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use reqwest::{multipart, redirect::Policy, Url};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

pub const MAX_REQUEST_BYTES: usize = 15 * 1024 * 1024;
const MAX_AUDIO_BYTES: usize = 10 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS: usize = 32_000;
const DEFAULT_WHISPER_MODEL: &str = "ggml-small-q5_1.bin";
const DEFAULT_REMOTE_TRANSCRIPTION_MODEL: &str = "whisper-1";
const DEFAULT_OLLAMA_MODEL: &str = "qwen3:4b-instruct-2507-q4_K_M";
const DEFAULT_OLLAMA_URL: &str = "http://127.0.0.1:11434";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProcessRequest {
    pub audio_base64: String,
    #[serde(default = "default_audio_mime_type")]
    pub mime_type: String,
    #[serde(default = "default_language")]
    pub language: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProcessResponse {
    pub transcript: String,
    pub summary: String,
    pub summarized: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    pub transcription_model: String,
    pub summary_model: String,
    pub transcription_provider: String,
    pub summary_provider: String,
    pub transcription_ms: u128,
    pub summary_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRuntimeStatus {
    pub mode: String,
    pub state: String,
    pub stage: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_location: Option<String>,
    pub transcription_model: String,
    pub summary_model: String,
    pub transcription_target: String,
    pub summary_target: String,
    pub whisper_ready: bool,
    pub ollama_reachable: bool,
    pub summary_model_loaded: bool,
    pub summary_model_on_gpu: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary_model_vram_mb: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<VoiceGpuStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity_at: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceGpuStatus {
    pub index: u32,
    pub name: String,
    pub utilization_percent: u32,
    pub memory_used_mb: u64,
    pub memory_total_mb: u64,
}

#[derive(Debug, Deserialize)]
struct RemoteTranscriptionResponse {
    text: String,
}

#[derive(Debug, Deserialize)]
struct OllamaChatResponse {
    message: OllamaMessage,
}

#[derive(Debug, Deserialize)]
struct OllamaMessage {
    content: String,
}

#[derive(Debug, Default, Deserialize)]
struct OllamaPsResponse {
    #[serde(default)]
    models: Vec<OllamaPsModel>,
}

#[derive(Debug, Default, Deserialize)]
struct OllamaPsModel {
    #[serde(default)]
    name: String,
    #[serde(default)]
    model: String,
    #[serde(default)]
    size_vram: u64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VoiceConfig {
    #[serde(default)]
    transcription_mode: Option<String>,
    #[serde(default)]
    whisper_model: Option<String>,
    #[serde(default)]
    remote_transcription_url: Option<String>,
    #[serde(default)]
    remote_transcription_model: Option<String>,
    #[serde(default)]
    remote_fallback_local: bool,
    #[serde(default)]
    ollama_model: Option<String>,
    #[serde(default)]
    ollama_url: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TranscriptionMode {
    Local,
    Remote,
}

#[derive(Debug, Default)]
struct VoiceActivityState {
    transcribing: u32,
    summarizing: u32,
    last_activity_at: Option<u64>,
}

#[derive(Debug, Clone, Copy)]
enum VoiceActivityPhase {
    Transcribing,
    Summarizing,
}

struct VoiceActivityGuard {
    phase: VoiceActivityPhase,
}

static VOICE_ACTIVITY: OnceLock<Mutex<VoiceActivityState>> = OnceLock::new();

struct TempVoiceDir(PathBuf);

impl TempVoiceDir {
    fn create() -> Result<Self, String> {
        let path = env::temp_dir()
            .join("codex-switch-terminal-voice")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&path).map_err(|error| {
            format!("Creation du dossier audio temporaire impossible : {error}")
        })?;
        Ok(Self(path))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempVoiceDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn voice_activity() -> &'static Mutex<VoiceActivityState> {
    VOICE_ACTIVITY.get_or_init(|| Mutex::new(VoiceActivityState::default()))
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

impl VoiceActivityGuard {
    fn begin() -> Self {
        if let Ok(mut state) = voice_activity().lock() {
            state.transcribing = state.transcribing.saturating_add(1);
        }
        Self {
            phase: VoiceActivityPhase::Transcribing,
        }
    }

    fn start_summarizing(&mut self) {
        if matches!(self.phase, VoiceActivityPhase::Summarizing) {
            return;
        }
        if let Ok(mut state) = voice_activity().lock() {
            state.transcribing = state.transcribing.saturating_sub(1);
            state.summarizing = state.summarizing.saturating_add(1);
        }
        self.phase = VoiceActivityPhase::Summarizing;
    }
}

impl Drop for VoiceActivityGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = voice_activity().lock() {
            match self.phase {
                VoiceActivityPhase::Transcribing => {
                    state.transcribing = state.transcribing.saturating_sub(1)
                }
                VoiceActivityPhase::Summarizing => {
                    state.summarizing = state.summarizing.saturating_sub(1)
                }
            }
            state.last_activity_at = Some(unix_time_ms());
        }
    }
}

fn voice_activity_snapshot() -> (String, Option<u64>) {
    let Ok(state) = voice_activity().lock() else {
        return ("idle".to_string(), None);
    };
    let stage = if state.summarizing > 0 {
        "summarizing"
    } else if state.transcribing > 0 {
        "transcribing"
    } else {
        "idle"
    };
    (stage.to_string(), state.last_activity_at)
}

fn default_audio_mime_type() -> String {
    "audio/wav".to_string()
}

fn default_language() -> String {
    "fr".to_string()
}

#[tauri::command]
pub async fn process_voice_input(
    audio_base64: String,
    mime_type: Option<String>,
    language: Option<String>,
) -> Result<VoiceProcessResponse, String> {
    process_voice_request(VoiceProcessRequest {
        audio_base64,
        mime_type: mime_type.unwrap_or_else(default_audio_mime_type),
        language: language.unwrap_or_else(default_language),
    })
    .await
}

pub async fn process_voice_request(
    request: VoiceProcessRequest,
) -> Result<VoiceProcessResponse, String> {
    let language = normalize_language(&request.language)?;
    let audio = decode_wav(&request.audio_base64, &request.mime_type)?;
    let voice_home = voice_home()?;
    let config = load_voice_config(&voice_home)?;
    let transcription_mode = configured_transcription_mode(&config)?;
    let mut activity = VoiceActivityGuard::begin();

    let transcription_started = Instant::now();
    let (transcript, transcription_model, transcription_provider, transcription_warning) =
        match transcription_mode {
            TranscriptionMode::Local => {
                let (transcript, model) = transcribe_with_local_whisper(
                    audio,
                    language,
                    &voice_home,
                    config.whisper_model.as_deref(),
                )
                .await?;
                (transcript, model, "whisper-local".to_string(), None)
            }
            TranscriptionMode::Remote => {
                let endpoint = configured_value(
                    "CST_VOICE_TRANSCRIPTION_URL",
                    config.remote_transcription_url.as_deref(),
                )
                .ok_or_else(|| {
                    "Le mode de transcription distant exige CST_VOICE_TRANSCRIPTION_URL ou remoteTranscriptionUrl dans config.json."
                        .to_string()
                })?;
                let endpoint = validate_remote_url(&endpoint, "URL de transcription")?;
                let model = configured_value(
                    "CST_VOICE_TRANSCRIPTION_MODEL",
                    config.remote_transcription_model.as_deref(),
                )
                .unwrap_or_else(|| DEFAULT_REMOTE_TRANSCRIPTION_MODEL.to_string());

                match transcribe_wav_remote(&audio, &language, &endpoint, &model).await {
                    Ok(transcript) => (
                        transcript,
                        model,
                        "openai-compatible-remote".to_string(),
                        None,
                    ),
                    Err(remote_error) if config.remote_fallback_local => {
                        let (transcript, local_model) = transcribe_with_local_whisper(
                            audio,
                            language,
                            &voice_home,
                            config.whisper_model.as_deref(),
                        )
                        .await
                        .map_err(|local_error| {
                            format!(
                                "Transcription distante indisponible ({remote_error}) et repli local impossible ({local_error})."
                            )
                        })?;
                        (
                            transcript,
                            local_model,
                            "whisper-local-fallback".to_string(),
                            Some(format!(
                                "GPU distant indisponible ; transcription locale utilisee : {remote_error}"
                            )),
                        )
                    }
                    Err(error) => return Err(error),
                }
            }
        };
    let transcription_ms = transcription_started.elapsed().as_millis();

    if transcript.chars().count() > MAX_TRANSCRIPT_CHARS {
        return Err(format!(
            "La transcription depasse {MAX_TRANSCRIPT_CHARS} caracteres. Enregistre un message plus court."
        ));
    }

    let summary_model = configured_value("CST_VOICE_OLLAMA_MODEL", config.ollama_model.as_deref())
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let ollama_base_url = configured_value("CST_VOICE_OLLAMA_URL", config.ollama_url.as_deref())
        .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string());
    let ollama_endpoint = ollama_chat_url(&ollama_base_url)?;
    let summary_provider = if is_loopback_url(&ollama_endpoint) {
        "ollama-local"
    } else {
        "ollama-remote"
    }
    .to_string();
    activity.start_summarizing();
    let summary_started = Instant::now();
    let summary_result = summarize_with_ollama(&transcript, &summary_model, &ollama_endpoint).await;
    let summary_ms = summary_started.elapsed().as_millis();

    let (summary, summarized, summary_warning) = match summary_result {
        Ok(summary) => (summary, true, None),
        Err(error) => (
            transcript.clone(),
            false,
            Some(format!("Transcription inseree sans resume : {error}")),
        ),
    };
    let warning = merge_warnings(transcription_warning, summary_warning);

    Ok(VoiceProcessResponse {
        transcript,
        summary,
        summarized,
        warning,
        transcription_model,
        summary_model,
        transcription_provider,
        summary_provider,
        transcription_ms,
        summary_ms,
    })
}

#[tauri::command]
pub async fn voice_runtime_status() -> Result<VoiceRuntimeStatus, String> {
    let voice_home = voice_home()?;
    let config = load_voice_config(&voice_home)?;
    let transcription_mode = configured_transcription_mode(&config)?;
    let (stage, last_activity_at) = voice_activity_snapshot();

    let whisper_ready = whisper_binary(&voice_home).is_ok()
        && whisper_model(&voice_home, config.whisper_model.as_deref()).is_ok();
    let (transcription_model, transcription_target, transcription_warning) =
        match transcription_mode {
            TranscriptionMode::Local => {
                let model = whisper_model(&voice_home, config.whisper_model.as_deref())
                    .ok()
                    .and_then(|path| {
                        path.file_name()
                            .map(|name| name.to_string_lossy().to_string())
                    })
                    .or_else(|| {
                        configured_value("CST_VOICE_WHISPER_MODEL", config.whisper_model.as_deref())
                            .and_then(|value| {
                                Path::new(&value)
                                    .file_name()
                                    .map(|name| name.to_string_lossy().to_string())
                            })
                    })
                    .unwrap_or_else(|| DEFAULT_WHISPER_MODEL.to_string());
                let warning = (!whisper_ready).then(|| {
                    "Whisper local est configure mais son binaire ou son modele est introuvable."
                        .to_string()
                });
                (model, "local".to_string(), warning)
            }
            TranscriptionMode::Remote => {
                let model = configured_value(
                    "CST_VOICE_TRANSCRIPTION_MODEL",
                    config.remote_transcription_model.as_deref(),
                )
                .unwrap_or_else(|| DEFAULT_REMOTE_TRANSCRIPTION_MODEL.to_string());
                let warning = configured_value(
                    "CST_VOICE_TRANSCRIPTION_URL",
                    config.remote_transcription_url.as_deref(),
                )
                .ok_or_else(|| "URL de transcription distante absente.".to_string())
                .and_then(|url| validate_remote_url(&url, "URL de transcription").map(|_| ()))
                .err();
                (model, "remote".to_string(), warning)
            }
        };

    let summary_model = configured_value("CST_VOICE_OLLAMA_MODEL", config.ollama_model.as_deref())
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let ollama_base_url = configured_value("CST_VOICE_OLLAMA_URL", config.ollama_url.as_deref())
        .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string());
    let ollama_ps_endpoint = ollama_api_url(&ollama_base_url, "/api/ps");
    let summary_target = ollama_ps_endpoint
        .as_ref()
        .map(|endpoint| {
            if is_loopback_url(endpoint) {
                "local"
            } else {
                "remote"
            }
        })
        .unwrap_or("unknown")
        .to_string();

    let (
        ollama_reachable,
        summary_model_loaded,
        summary_model_on_gpu,
        summary_model_vram_mb,
        ollama_warning,
    ) = match ollama_ps_endpoint {
        Ok(endpoint) => match probe_ollama_runtime(&endpoint, &summary_model).await {
            Ok((loaded, on_gpu, vram_mb)) => (true, loaded, on_gpu, vram_mb, None),
            Err(error) => (false, false, false, None, Some(error)),
        },
        Err(error) => (false, false, false, None, Some(error)),
    };

    let gpu = tokio::task::spawn_blocking(query_nvidia_gpu)
        .await
        .unwrap_or(None);
    let active_location = match stage.as_str() {
        "transcribing" => Some(transcription_target.clone()),
        "summarizing" => Some(summary_target.clone()),
        _ => None,
    };
    let unavailable = transcription_warning.is_some()
        || !ollama_reachable
        || (transcription_mode == TranscriptionMode::Local && !whisper_ready);
    let state = if active_location.is_some() {
        "active"
    } else if summary_model_loaded {
        "loaded"
    } else if unavailable {
        "unavailable"
    } else {
        "inactive"
    }
    .to_string();

    Ok(VoiceRuntimeStatus {
        mode: match transcription_mode {
            TranscriptionMode::Local => "local",
            TranscriptionMode::Remote => "remote",
        }
        .to_string(),
        state,
        stage,
        active_location,
        transcription_model,
        summary_model,
        transcription_target,
        summary_target,
        whisper_ready,
        ollama_reachable,
        summary_model_loaded,
        summary_model_on_gpu,
        summary_model_vram_mb,
        gpu,
        last_activity_at,
        warning: merge_warnings(transcription_warning, ollama_warning),
    })
}

fn configured_value(env_name: &str, configured: Option<&str>) -> Option<String> {
    env::var(env_name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            configured
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
}

fn configured_transcription_mode(config: &VoiceConfig) -> Result<TranscriptionMode, String> {
    match configured_value(
        "CST_VOICE_TRANSCRIPTION_MODE",
        config.transcription_mode.as_deref(),
    )
    .unwrap_or_else(|| "local".to_string())
    .to_ascii_lowercase()
    .as_str()
    {
        "local" => Ok(TranscriptionMode::Local),
        "remote" => Ok(TranscriptionMode::Remote),
        _ => Err(
            "Mode de transcription invalide : utilise local ou remote dans CST_VOICE_TRANSCRIPTION_MODE."
                .to_string(),
        ),
    }
}

fn env_flag(name: &str) -> bool {
    env::var(name).is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    })
}

fn is_loopback_url(url: &Url) -> bool {
    url.host_str().is_some_and(|host| {
        host.eq_ignore_ascii_case("localhost")
            || host.to_ascii_lowercase().ends_with(".localhost")
            || host
                .parse::<std::net::IpAddr>()
                .is_ok_and(|address| address.is_loopback())
    })
}

fn validate_remote_url(value: &str, label: &str) -> Result<Url, String> {
    validate_remote_url_with_policy(value, label, env_flag("CST_VOICE_ALLOW_INSECURE_REMOTE"))
}

fn validate_remote_url_with_policy(
    value: &str,
    label: &str,
    allow_insecure_remote: bool,
) -> Result<Url, String> {
    let url = Url::parse(value.trim()).map_err(|error| format!("{label} invalide : {error}"))?;
    if !url.username().is_empty() || url.password().is_some() {
        return Err(format!(
            "{label} ne doit pas contenir d'identifiants ; utilise les variables d'environnement de jeton."
        ));
    }
    if url.fragment().is_some() {
        return Err(format!("{label} ne doit pas contenir de fragment (#...)."));
    }
    match url.scheme() {
        "https" => {}
        "http" if is_loopback_url(&url) => {}
        "http" if allow_insecure_remote => {}
        "http" => {
            return Err(format!(
                "{label} doit utiliser HTTPS hors de cette machine. Pour un reseau prive temporaire, CST_VOICE_ALLOW_INSECURE_REMOTE=1 autorise explicitement HTTP."
            ))
        }
        scheme => {
            return Err(format!(
                "{label} utilise le protocole {scheme}, seuls HTTP local et HTTPS sont acceptes."
            ))
        }
    }
    Ok(url)
}

fn ollama_chat_url(base_url: &str) -> Result<Url, String> {
    ollama_api_url(base_url, "/api/chat")
}

fn ollama_api_url(base_url: &str, path: &str) -> Result<Url, String> {
    let base_url = base_url.trim().trim_end_matches('/');
    let base_url = base_url
        .strip_suffix("/api/chat")
        .or_else(|| base_url.strip_suffix("/api/ps"))
        .unwrap_or(base_url)
        .trim_end_matches('/');
    let endpoint = format!("{base_url}/{}", path.trim_start_matches('/'));
    validate_remote_url(&endpoint, "URL Ollama")
}

fn safe_url_label(url: &Url) -> String {
    let mut safe = url.clone();
    safe.set_query(None);
    safe.set_fragment(None);
    safe.to_string()
}

fn merge_warnings(first: Option<String>, second: Option<String>) -> Option<String> {
    match (first, second) {
        (Some(first), Some(second)) => Some(format!("{first} {second}")),
        (Some(warning), None) | (None, Some(warning)) => Some(warning),
        (None, None) => None,
    }
}

fn ollama_model_matches(running: &OllamaPsModel, configured: &str) -> bool {
    let configured = configured.trim();
    [&running.name, &running.model].iter().any(|candidate| {
        let candidate = candidate.trim();
        candidate == configured
            || candidate.strip_suffix(":latest") == Some(configured)
            || configured.strip_suffix(":latest") == Some(candidate)
    })
}

async fn probe_ollama_runtime(
    endpoint: &Url,
    model: &str,
) -> Result<(bool, bool, Option<u64>), String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client de statut Ollama indisponible : {error}"))?;
    let mut request = client.get(endpoint.clone());
    if let Some(token) = configured_value("CST_VOICE_OLLAMA_API_KEY", None) {
        request = request.bearer_auth(token);
    }
    let label = safe_url_label(endpoint);
    let response = request.send().await.map_err(|error| {
        let error = error.without_url();
        format!("Statut Ollama inaccessible sur {label} ({error}).")
    })?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Le statut Ollama a retourne HTTP {} sur {label}.",
            status.as_u16()
        ));
    }
    let payload = response
        .json::<OllamaPsResponse>()
        .await
        .map_err(|error| format!("Statut Ollama illisible : {error}"))?;
    let running = payload
        .models
        .iter()
        .find(|candidate| ollama_model_matches(candidate, model));
    let vram = running.map(|candidate| candidate.size_vram);
    Ok((
        running.is_some(),
        vram.is_some_and(|bytes| bytes > 0),
        vram.filter(|bytes| *bytes > 0)
            .map(|bytes| bytes / (1024 * 1024)),
    ))
}

fn parse_nvidia_gpu_csv(output: &str) -> Option<VoiceGpuStatus> {
    let line = output.lines().find(|line| !line.trim().is_empty())?;
    let values = line.split(',').map(str::trim).collect::<Vec<_>>();
    if values.len() != 5 {
        return None;
    }
    Some(VoiceGpuStatus {
        index: values[0].parse().ok()?,
        name: values[1].to_string(),
        utilization_percent: values[2].parse().ok()?,
        memory_used_mb: values[3].parse().ok()?,
        memory_total_mb: values[4].parse().ok()?,
    })
}

fn query_nvidia_gpu() -> Option<VoiceGpuStatus> {
    let mut command = Command::new("nvidia-smi");
    command.args([
        "--query-gpu=index,name,utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).to_string())
        .and_then(|stdout| parse_nvidia_gpu_csv(&stdout))
}

fn normalize_language(value: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized == "auto"
        || (normalized.len() >= 2
            && normalized.len() <= 3
            && normalized.bytes().all(|byte| byte.is_ascii_lowercase()))
    {
        Ok(normalized)
    } else {
        Err("Langue de transcription invalide (utilise par exemple fr, en ou auto).".to_string())
    }
}

fn decode_wav(encoded: &str, mime_type: &str) -> Result<Vec<u8>, String> {
    if !mime_type.trim().eq_ignore_ascii_case("audio/wav")
        && !mime_type.trim().eq_ignore_ascii_case("audio/wave")
        && !mime_type.trim().eq_ignore_ascii_case("audio/x-wav")
    {
        return Err("Le moteur vocal attend un enregistrement WAV.".to_string());
    }

    let payload = encoded
        .rsplit_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(encoded)
        .trim();
    let max_encoded_len = MAX_AUDIO_BYTES.saturating_mul(4) / 3 + 8;
    if payload.len() > max_encoded_len {
        return Err("Enregistrement trop long (maximum 5 minutes).".to_string());
    }
    let audio = STANDARD
        .decode(payload)
        .map_err(|_| "Enregistrement audio illisible (base64 invalide).".to_string())?;
    if audio.len() > MAX_AUDIO_BYTES {
        return Err("Enregistrement trop long (maximum 5 minutes).".to_string());
    }
    if audio.len() < 44 || &audio[0..4] != b"RIFF" || &audio[8..12] != b"WAVE" {
        return Err("Enregistrement WAV invalide.".to_string());
    }
    Ok(audio)
}

fn voice_home() -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("CST_VOICE_HOME") {
        let path = PathBuf::from(value);
        if !path.as_os_str().is_empty() {
            return Ok(path);
        }
    }
    if let Some(value) = env::var_os("APPDATA") {
        return Ok(PathBuf::from(value)
            .join("codex-switch-terminal")
            .join("voice"));
    }
    crate::settings::runtime_data_path("voice")
}

fn load_voice_config(voice_home: &Path) -> Result<VoiceConfig, String> {
    let path = voice_home.join("config.json");
    if !path.is_file() {
        return Ok(VoiceConfig::default());
    }
    let content = fs::read_to_string(&path)
        .map_err(|error| format!("Lecture de {} impossible : {error}", path.display()))?;
    serde_json::from_str(content.trim_start_matches('\u{feff}'))
        .map_err(|error| format!("Configuration vocale {} invalide : {error}", path.display()))
}

fn whisper_binary(voice_home: &Path) -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("CST_VOICE_WHISPER_BIN") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "CST_VOICE_WHISPER_BIN ne pointe pas vers un fichier : {}",
            path.display()
        ));
    }

    let root = voice_home.join("whisper");
    let names: &[&str] = if cfg!(windows) {
        &["whisper-cli.exe", "main.exe"]
    } else {
        &["whisper-cli", "main"]
    };
    find_named_file(&root, names, 5).ok_or_else(|| {
        format!(
            "whisper.cpp est introuvable dans {}. Lance scripts/setup-local-voice.ps1.",
            root.display()
        )
    })
}

fn whisper_model(voice_home: &Path, configured_model: Option<&str>) -> Result<PathBuf, String> {
    if let Some(value) = env::var_os("CST_VOICE_WHISPER_MODEL") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return Ok(path);
        }
        return Err(format!(
            "CST_VOICE_WHISPER_MODEL ne pointe pas vers un fichier : {}",
            path.display()
        ));
    }

    let configured = configured_model
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let path = configured
        .map(PathBuf::from)
        .map(|path| {
            if path.is_absolute() {
                path
            } else {
                voice_home.join("models").join(path)
            }
        })
        .unwrap_or_else(|| voice_home.join("models").join(DEFAULT_WHISPER_MODEL));
    path.is_file().then_some(path.clone()).ok_or_else(|| {
        format!(
            "Le modele Whisper {} est introuvable. Lance scripts/setup-local-voice.ps1.",
            path.display()
        )
    })
}

fn find_named_file(root: &Path, names: &[&str], depth: usize) -> Option<PathBuf> {
    if depth == 0 || !root.is_dir() {
        return None;
    }
    let entries = fs::read_dir(root).ok()?;
    let mut files = Vec::new();
    let mut directories = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            files.push(path);
        } else if path.is_dir() {
            directories.push(path);
        }
    }
    for name in names {
        if let Some(path) = files.iter().find(|path| {
            path.file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case(name))
        }) {
            return Some(path.clone());
        }
    }
    directories
        .into_iter()
        .find_map(|directory| find_named_file(&directory, names, depth - 1))
}

async fn transcribe_with_local_whisper(
    audio: Vec<u8>,
    language: String,
    voice_home: &Path,
    configured_model: Option<&str>,
) -> Result<(String, String), String> {
    let whisper_binary = whisper_binary(voice_home)?;
    let whisper_model = whisper_model(voice_home, configured_model)?;
    let model_name = whisper_model
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(DEFAULT_WHISPER_MODEL)
        .to_string();
    let transcript = tokio::task::spawn_blocking(move || {
        transcribe_wav(&audio, &language, &whisper_binary, &whisper_model)
    })
    .await
    .map_err(|error| format!("Transcription interrompue : {error}"))??;
    Ok((transcript, model_name))
}

fn transcribe_wav(
    audio: &[u8],
    language: &str,
    whisper_binary: &Path,
    whisper_model: &Path,
) -> Result<String, String> {
    let temp = TempVoiceDir::create()?;
    let input_path = temp.path().join("recording.wav");
    let output_base = temp.path().join("transcript");
    fs::write(&input_path, audio)
        .map_err(|error| format!("Ecriture de l'enregistrement impossible : {error}"))?;

    let threads = std::thread::available_parallelism()
        .map(|value| value.get().clamp(1, 8))
        .unwrap_or(4);
    let mut command = Command::new(whisper_binary);
    command
        .arg("--model")
        .arg(whisper_model)
        .arg("--file")
        .arg(&input_path)
        .arg("--language")
        .arg(language)
        .arg("--output-txt")
        .arg("--output-file")
        .arg(&output_base)
        .arg("--no-timestamps")
        .arg("--no-prints")
        .arg("--threads")
        .arg(threads.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(directory) = whisper_binary.parent() {
        command.current_dir(directory);
    }

    let output = command.output().map_err(|error| {
        format!(
            "Impossible de lancer whisper.cpp ({}) : {error}",
            whisper_binary.display()
        )
    })?;
    if !output.status.success() {
        let detail = concise_process_error(&output.stderr, &output.stdout);
        return Err(format!(
            "whisper.cpp a echoue (code {}). {detail}",
            output.status.code().unwrap_or(-1)
        ));
    }

    let transcript_path = output_base.with_extension("txt");
    let transcript = fs::read_to_string(&transcript_path).map_err(|error| {
        format!(
            "La transcription n'a pas ete produite ({}): {error}",
            transcript_path.display()
        )
    })?;
    let transcript = transcript.trim().to_string();
    if transcript.is_empty() {
        return Err(
            "Aucune parole n'a ete detectee. Rapproche-toi du micro et recommence.".to_string(),
        );
    }
    Ok(transcript)
}

async fn transcribe_wav_remote(
    audio: &[u8],
    language: &str,
    endpoint: &Url,
    model: &str,
) -> Result<String, String> {
    let audio_part = multipart::Part::bytes(audio.to_vec())
        .file_name("recording.wav")
        .mime_str("audio/wav")
        .map_err(|error| format!("Preparation du WAV distant impossible : {error}"))?;
    let mut form = multipart::Form::new()
        .part("file", audio_part)
        .text("model", model.to_string())
        .text("response_format", "json");
    if language != "auto" {
        form = form.text("language", language.to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client de transcription distante indisponible : {error}"))?;
    let mut request = client.post(endpoint.clone()).multipart(form);
    if let Some(token) = configured_value("CST_VOICE_TRANSCRIPTION_API_KEY", None) {
        request = request.bearer_auth(token);
    }
    let label = safe_url_label(endpoint);
    let response = request.send().await.map_err(|error| {
        let error = error.without_url();
        format!("Le serveur de transcription distant ne repond pas sur {label} ({error}).")
    })?;
    let status = response.status();
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        let detail = detail.chars().take(2_000).collect::<String>();
        return Err(format!(
            "Le serveur de transcription distant a retourne HTTP {}. {}",
            status.as_u16(),
            detail.trim()
        ));
    }

    let payload = response
        .json::<RemoteTranscriptionResponse>()
        .await
        .map_err(|error| format!("Reponse de transcription distante illisible : {error}"))?;
    let transcript = payload.text.trim().to_string();
    if transcript.is_empty() {
        return Err(
            "Le serveur distant n'a detecte aucune parole. Rapproche-toi du micro et recommence."
                .to_string(),
        );
    }
    Ok(transcript)
}

fn concise_process_error(stderr: &[u8], stdout: &[u8]) -> String {
    let text = if stderr.is_empty() { stdout } else { stderr };
    let text = String::from_utf8_lossy(text);
    let tail = text
        .chars()
        .rev()
        .take(2_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect::<String>();
    tail.trim().replace(['\r', '\n'], " ")
}

async fn summarize_with_ollama(
    transcript: &str,
    model: &str,
    endpoint: &Url,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client Ollama indisponible : {error}"))?;
    let mut request = client.post(endpoint.clone()).json(&json!({
            "model": model,
            "stream": false,
            "think": false,
            "keep_alive": "10m",
            "messages": [
                {
                    "role": "system",
                    "content": "Tu reformules une dictee en message clair pret a envoyer a un assistant de programmation. Conserve toutes les demandes, contraintes, negations, noms de fichiers, chemins, commandes, nombres et exemples. Supprime seulement les hesitations, mots de remplissage et repetitions. N'invente rien et ne reponds pas a la demande. Garde la langue de la dictee. Retourne uniquement le message final, sans titre ni commentaire."
                },
                {
                    "role": "user",
                    "content": transcript
                }
            ],
            "options": {
                "temperature": 0.1,
                "num_ctx": 4096,
                "num_predict": 768
            }
        }));
    if let Some(token) = configured_value("CST_VOICE_OLLAMA_API_KEY", None) {
        request = request.bearer_auth(token);
    }
    let label = safe_url_label(endpoint);
    let response = request.send().await.map_err(|error| {
        let error = error.without_url();
        format!("Ollama ne repond pas sur {label} ({error}). Verifie le service et le reseau.")
    })?;
    let status = response.status();
    if !status.is_success() {
        let detail = response
            .text()
            .await
            .unwrap_or_default()
            .chars()
            .take(2_000)
            .collect::<String>();
        let hint = if detail.to_ascii_lowercase().contains("model")
            && (detail.to_ascii_lowercase().contains("not found") || status.as_u16() == 404)
        {
            if is_loopback_url(endpoint) {
                format!(" Lance : ollama pull {model}.")
            } else {
                format!(" Installe le modele {model} sur le serveur Ollama distant.")
            }
        } else {
            String::new()
        };
        return Err(format!(
            "Ollama a retourne HTTP {}.{} {}",
            status.as_u16(),
            hint,
            detail.trim()
        ));
    }

    let payload = response
        .json::<OllamaChatResponse>()
        .await
        .map_err(|error| format!("Reponse Ollama illisible : {error}"))?;
    let summary = strip_thinking(&payload.message.content);
    if summary.is_empty() {
        return Err("Ollama a renvoye un resume vide.".to_string());
    }
    Ok(summary)
}

fn strip_thinking(value: &str) -> String {
    let trimmed = value.trim();
    if let Some(index) = trimmed.rfind("</think>") {
        return trimmed[index + "</think>".len()..].trim().to_string();
    }
    trimmed.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn language_validation_accepts_short_codes_and_auto() {
        assert_eq!(normalize_language(" FR ").unwrap(), "fr");
        assert_eq!(normalize_language("auto").unwrap(), "auto");
        assert!(normalize_language("fr-FR").is_err());
        assert!(normalize_language("../../x").is_err());
    }

    #[test]
    fn wav_validation_rejects_non_audio_content() {
        let encoded = STANDARD.encode(b"not a wav file");
        assert!(decode_wav(&encoded, "audio/wav").is_err());
        assert!(decode_wav(&encoded, "audio/webm").is_err());
    }

    #[test]
    fn thinking_prefix_is_not_inserted_in_the_composer() {
        assert_eq!(
            strip_thinking("<think>analyse interne</think>\nMessage final"),
            "Message final"
        );
        assert_eq!(strip_thinking("Message direct"), "Message direct");
    }

    #[test]
    fn executable_discovery_prefers_whisper_cli_over_deprecated_main() {
        let temp = TempVoiceDir::create().unwrap();
        fs::write(temp.path().join("main.exe"), b"deprecated").unwrap();
        fs::write(temp.path().join("whisper-cli.exe"), b"current").unwrap();
        let selected = find_named_file(temp.path(), &["whisper-cli.exe", "main.exe"], 2).unwrap();
        assert_eq!(selected.file_name().unwrap(), "whisper-cli.exe");
    }

    #[test]
    fn gpu_status_parses_nvidia_smi_csv() {
        let status =
            parse_nvidia_gpu_csv("0, NVIDIA GeForce RTX 3060 Ti, 37, 4276, 8192\n").unwrap();
        assert_eq!(status.index, 0);
        assert_eq!(status.name, "NVIDIA GeForce RTX 3060 Ti");
        assert_eq!(status.utilization_percent, 37);
        assert_eq!(status.memory_used_mb, 4276);
        assert_eq!(status.memory_total_mb, 8192);
    }

    #[test]
    fn ollama_status_matches_latest_alias_and_preserves_proxy_path() {
        let running = OllamaPsModel {
            name: "qwen3:4b-instruct-2507-q4_K_M".to_string(),
            model: String::new(),
            size_vram: 3_200_000_000,
        };
        assert!(ollama_model_matches(
            &running,
            "qwen3:4b-instruct-2507-q4_K_M"
        ));
        let aliased = OllamaPsModel {
            name: "voice-model:latest".to_string(),
            ..OllamaPsModel::default()
        };
        assert!(ollama_model_matches(&aliased, "voice-model"));
        assert_eq!(
            ollama_api_url("https://gpu.example.test/ollama", "/api/ps")
                .unwrap()
                .as_str(),
            "https://gpu.example.test/ollama/api/ps"
        );
    }

    #[test]
    fn remote_urls_require_tls_but_allow_loopback_for_development() {
        assert!(validate_remote_url_with_policy(
            "https://voice.example.test/v1/audio/transcriptions",
            "STT",
            false,
        )
        .is_ok());
        assert!(validate_remote_url_with_policy(
            "http://127.0.0.1:8000/v1/audio/transcriptions",
            "STT",
            false,
        )
        .is_ok());
        assert!(validate_remote_url_with_policy(
            "http://voice.example.test/v1/audio/transcriptions",
            "STT",
            false,
        )
        .is_err());
        assert!(validate_remote_url_with_policy(
            "http://voice.example.test/v1/audio/transcriptions",
            "STT",
            true,
        )
        .is_ok());
        assert!(validate_remote_url_with_policy(
            "https://token@voice.example.test/v1/audio/transcriptions",
            "STT",
            false,
        )
        .is_err());
    }

    #[tokio::test]
    async fn remote_transcription_uses_the_openai_multipart_contract() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0_u8; 4_096];
            let (header_end, content_length) = loop {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0, "requete HTTP interrompue avant les en-tetes");
                request.extend_from_slice(&buffer[..read]);
                if let Some(header_end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                    let header_end = header_end + 4;
                    let headers = String::from_utf8_lossy(&request[..header_end]);
                    let content_length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length:")
                                .and_then(|value| value.trim().parse::<usize>().ok())
                        })
                        .expect("Content-Length multipart absent");
                    break (header_end, content_length);
                }
            };
            while request.len() < header_end + content_length {
                let read = stream.read(&mut buffer).await.unwrap();
                assert!(read > 0, "corps multipart interrompu");
                request.extend_from_slice(&buffer[..read]);
            }

            let headers = String::from_utf8_lossy(&request[..header_end]);
            let body = String::from_utf8_lossy(&request[header_end..]);
            assert!(headers.starts_with("POST /v1/audio/transcriptions HTTP/1.1"));
            assert!(headers
                .to_ascii_lowercase()
                .contains("content-type: multipart/form-data; boundary="));
            assert!(body.contains("name=\"file\"; filename=\"recording.wav\""));
            assert!(body.contains("name=\"model\""));
            assert!(body.contains("Systran/faster-whisper-small"));
            assert!(body.contains("name=\"language\""));
            assert!(body.contains("fr"));

            let payload = r#"{"text":"Dictee recue par le GPU distant."}"#;
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                payload.len(),
                payload
            );
            stream.write_all(response.as_bytes()).await.unwrap();
        });

        let endpoint = Url::parse(&format!("http://{address}/v1/audio/transcriptions")).unwrap();
        let transcript = transcribe_wav_remote(
            b"RIFFmockWAVEdata",
            "fr",
            &endpoint,
            "Systran/faster-whisper-small",
        )
        .await
        .unwrap();
        assert_eq!(transcript, "Dictee recue par le GPU distant.");
        server.await.unwrap();
    }
}
