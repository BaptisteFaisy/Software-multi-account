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
/// Taille maximale d'un fichier envoye depuis l'onglet Transcrire.
/// Le flux HTTP reste binaire (sans surcout base64) sur le VPS.
pub const MAX_AUDIO_FILE_BYTES: usize = 100 * 1024 * 1024;
const MAX_AUDIO_BYTES: usize = 10 * 1024 * 1024;
const MAX_TRANSCRIPT_CHARS: usize = 32_000;
const MAX_AUDIO_FILE_TRANSCRIPT_CHARS: usize = 2_000_000;
const MAX_NORMALIZED_AUDIO_BYTES: u64 = 512 * 1024 * 1024;
const REMOTE_AUDIO_CHUNK_SECONDS: u64 = 15 * 60;
const OLLAMA_CHUNK_CHARS: usize = 9_000;
const DEFAULT_WHISPER_MODEL: &str = "ggml-large-v3-turbo-q5_0.bin";
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
    #[serde(default = "default_output_mode")]
    pub output_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProcessResponse {
    pub transcript: String,
    pub summary: String,
    pub summarized: bool,
    pub output_mode: String,
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
pub struct AudioFileTranscriptionResponse {
    pub text: String,
    pub file_name: String,
    pub language: String,
    pub model: String,
    pub provider: String,
    pub accelerator: String,
    pub output_mode: String,
    pub post_processed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub post_processing_model: Option<String>,
    pub post_processing_ms: u128,
    pub processing_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
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
    pub transcription_accelerator: String,
    pub transcription_ready: bool,
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
    transcription_accelerator: Option<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum VoiceOutputMode {
    Faithful,
    Clean,
    Summary,
}

impl VoiceOutputMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Faithful => "faithful",
            Self::Clean => "clean",
            Self::Summary => "summary",
        }
    }
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

fn default_output_mode() -> String {
    "clean".to_string()
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn process_voice_input(
    audio_base64: String,
    mime_type: Option<String>,
    language: Option<String>,
    output_mode: Option<String>,
) -> Result<VoiceProcessResponse, String> {
    process_voice_request(VoiceProcessRequest {
        audio_base64,
        mime_type: mime_type.unwrap_or_else(default_audio_mime_type),
        language: language.unwrap_or_else(default_language),
        output_mode: output_mode.unwrap_or_else(default_output_mode),
    })
    .await
}

/// Transcrit un fichier importe depuis l'onglet dedie, puis applique si besoin
/// le nettoyage ou le compte rendu Ollama choisi par l'utilisateur.
#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn transcribe_audio_file(
    audio_base64: String,
    file_name: String,
    mime_type: Option<String>,
    language: Option<String>,
    output_mode: Option<String>,
) -> Result<AudioFileTranscriptionResponse, String> {
    let audio = decode_audio_file_base64(&audio_base64)?;
    transcribe_audio_file_bytes(
        audio,
        file_name,
        mime_type.unwrap_or_else(|| "application/octet-stream".to_string()),
        language.unwrap_or_else(|| "auto".to_string()),
        output_mode.unwrap_or_else(default_output_mode),
    )
    .await
}

pub async fn transcribe_audio_file_bytes(
    audio: Vec<u8>,
    file_name: String,
    mime_type: String,
    language: String,
    output_mode: String,
) -> Result<AudioFileTranscriptionResponse, String> {
    if audio.is_empty() {
        return Err("Le fichier audio est vide.".to_string());
    }
    if audio.len() > MAX_AUDIO_FILE_BYTES {
        return Err(format!(
            "Le fichier audio depasse la limite de {} Mo.",
            MAX_AUDIO_FILE_BYTES / (1024 * 1024)
        ));
    }

    let language = normalize_language(&language)?;
    let output_mode = normalize_output_mode(&output_mode)?;
    let (file_name, mime_type) = normalize_audio_file_metadata(&file_name, &mime_type)?;
    let voice_home = voice_home()?;
    let config = load_voice_config(&voice_home)?;
    let transcription_mode = configured_transcription_mode(&config)?;
    let mut activity = VoiceActivityGuard::begin();
    let started = Instant::now();

    let (transcript, model, provider, transcription_warning) = match transcription_mode {
        TranscriptionMode::Local => {
            let wav = normalize_uploaded_audio(audio, file_name.clone()).await?;
            let (text, model) = transcribe_with_local_whisper(
                wav,
                language.clone(),
                &voice_home,
                config.whisper_model.as_deref(),
            )
            .await?;
            (text, model, "whisper-local".to_string(), None)
        }
        TranscriptionMode::Remote => {
            let endpoint = configured_value(
                "CST_VOICE_TRANSCRIPTION_URL",
                config.remote_transcription_url.as_deref(),
            )
            .ok_or_else(|| {
                "Le VPS exige CST_VOICE_TRANSCRIPTION_URL pour transcrire les fichiers.".to_string()
            })?;
            let endpoint = validate_remote_url(&endpoint, "URL de transcription")?;
            let model = configured_value(
                "CST_VOICE_TRANSCRIPTION_MODEL",
                config.remote_transcription_model.as_deref(),
            )
            .unwrap_or_else(|| DEFAULT_REMOTE_TRANSCRIPTION_MODEL.to_string());

            match transcribe_audio_remote_chunked(
                &audio, &file_name, &mime_type, &language, &endpoint, &model,
            )
            .await
            {
                Ok((text, chunk_count)) => (
                    text,
                    model,
                    "openai-compatible-remote".to_string(),
                    (chunk_count > 1).then(|| {
                        format!(
                            "Audio long traite automatiquement en {chunk_count} segments pour eviter les passages manquants."
                        )
                    }),
                ),
                Err(remote_error) if config.remote_fallback_local => {
                    let wav = normalize_uploaded_audio(audio, file_name.clone())
                        .await
                        .map_err(|local_error| {
                            format!(
                                "Transcription distante indisponible ({remote_error}) et conversion locale impossible ({local_error})."
                            )
                        })?;
                    let (text, local_model) = transcribe_with_local_whisper(
                        wav,
                        language.clone(),
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
                        text,
                        local_model,
                        "whisper-local-fallback".to_string(),
                        Some(format!(
                            "Moteur distant indisponible ; transcription locale utilisee : {remote_error}"
                        )),
                    )
                }
                Err(error) => return Err(error),
            }
        }
    };

    if transcript.chars().count() > MAX_AUDIO_FILE_TRANSCRIPT_CHARS {
        return Err(format!(
            "La transcription depasse la limite de {MAX_AUDIO_FILE_TRANSCRIPT_CHARS} caracteres."
        ));
    }

    let summary_model = configured_value("CST_VOICE_OLLAMA_MODEL", config.ollama_model.as_deref())
        .unwrap_or_else(|| DEFAULT_OLLAMA_MODEL.to_string());
    let (text, post_processed, post_processing_model, post_processing_ms, processing_warning) =
        if output_mode == VoiceOutputMode::Faithful {
            (transcript, false, None, 0, None)
        } else {
            let ollama_base_url =
                configured_value("CST_VOICE_OLLAMA_URL", config.ollama_url.as_deref())
                    .unwrap_or_else(|| DEFAULT_OLLAMA_URL.to_string());
            let ollama_endpoint = ollama_chat_url(&ollama_base_url)?;
            activity.start_summarizing();
            let processing_started = Instant::now();
            match post_process_with_ollama(
                &transcript,
                &summary_model,
                &ollama_endpoint,
                output_mode,
            )
            .await
            {
                Ok(text) => (
                    text,
                    true,
                    Some(summary_model),
                    processing_started.elapsed().as_millis(),
                    None,
                ),
                Err(error) => (
                    transcript,
                    false,
                    None,
                    processing_started.elapsed().as_millis(),
                    Some(format!(
                        "Texte brut conserve car la reformulation locale a echoue : {error}"
                    )),
                ),
            }
        };

    if text.chars().count() > MAX_AUDIO_FILE_TRANSCRIPT_CHARS {
        return Err(format!(
            "Le texte produit depasse la limite de {MAX_AUDIO_FILE_TRANSCRIPT_CHARS} caracteres."
        ));
    }

    let accelerator = transcription_accelerator(&config, &provider).await?;
    Ok(AudioFileTranscriptionResponse {
        text,
        file_name,
        language,
        model,
        provider,
        accelerator,
        output_mode: output_mode.as_str().to_string(),
        post_processed,
        post_processing_model,
        post_processing_ms,
        processing_ms: started.elapsed().as_millis(),
        warning: merge_warnings(transcription_warning, processing_warning),
    })
}

pub async fn process_voice_request(
    request: VoiceProcessRequest,
) -> Result<VoiceProcessResponse, String> {
    let language = normalize_language(&request.language)?;
    let output_mode = normalize_output_mode(&request.output_mode)?;
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
    let (summary, summarized, summary_provider, summary_ms, summary_warning) = if output_mode
        == VoiceOutputMode::Faithful
    {
        (transcript.clone(), false, "disabled".to_string(), 0, None)
    } else {
        let ollama_base_url =
            configured_value("CST_VOICE_OLLAMA_URL", config.ollama_url.as_deref())
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
        let summary_result =
            post_process_with_ollama(&transcript, &summary_model, &ollama_endpoint, output_mode)
                .await;
        let summary_ms = summary_started.elapsed().as_millis();
        match summary_result {
            Ok(summary) => (summary, true, summary_provider, summary_ms, None),
            Err(error) => (
                transcript.clone(),
                false,
                summary_provider,
                summary_ms,
                Some(format!(
                    "Transcription inseree sans reformulation : {error}"
                )),
            ),
        }
    };
    let warning = merge_warnings(transcription_warning, summary_warning);

    Ok(VoiceProcessResponse {
        transcript,
        summary,
        summarized,
        output_mode: output_mode.as_str().to_string(),
        warning,
        transcription_model,
        summary_model,
        transcription_provider,
        summary_provider,
        transcription_ms,
        summary_ms,
    })
}

#[cfg_attr(feature = "desktop", tauri::command)]
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

    let status_provider = match transcription_mode {
        TranscriptionMode::Local => "whisper-local",
        TranscriptionMode::Remote => "openai-compatible-remote",
    };
    let transcription_accelerator = transcription_accelerator(&config, status_provider).await?;

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
        transcription_accelerator,
        transcription_ready: match transcription_mode {
            TranscriptionMode::Local => whisper_ready,
            TranscriptionMode::Remote => transcription_warning.is_none(),
        },
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

fn configure_ollama_request(
    mut request: reqwest::RequestBuilder,
) -> Result<reqwest::RequestBuilder, String> {
    if let Some(token) = configured_value("CST_VOICE_OLLAMA_API_KEY", None) {
        request = request.bearer_auth(token);
    }
    if let Some(host) = configured_value("CST_VOICE_OLLAMA_HOST_HEADER", None) {
        let host = reqwest::header::HeaderValue::from_str(&host)
            .map_err(|_| "CST_VOICE_OLLAMA_HOST_HEADER est invalide.".to_string())?;
        request = request.header(reqwest::header::HOST, host);
    }
    Ok(request)
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
    let request = configure_ollama_request(client.get(endpoint.clone()))?;
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

fn normalize_output_mode(value: &str) -> Result<VoiceOutputMode, String> {
    match value.trim().to_ascii_lowercase().as_str() {
        "faithful" | "raw" | "verbatim" => Ok(VoiceOutputMode::Faithful),
        "clean" | "cleaned" => Ok(VoiceOutputMode::Clean),
        "summary" | "report" => Ok(VoiceOutputMode::Summary),
        _ => Err("Mode de texte invalide : utilise faithful, clean ou summary.".to_string()),
    }
}

fn decode_audio_file_base64(encoded: &str) -> Result<Vec<u8>, String> {
    let payload = encoded
        .rsplit_once(',')
        .map(|(_, payload)| payload)
        .unwrap_or(encoded)
        .trim();
    let max_encoded_len = MAX_AUDIO_FILE_BYTES.saturating_mul(4) / 3 + 8;
    if payload.len() > max_encoded_len {
        return Err(format!(
            "Le fichier audio depasse la limite de {} Mo.",
            MAX_AUDIO_FILE_BYTES / (1024 * 1024)
        ));
    }
    let audio = STANDARD
        .decode(payload)
        .map_err(|_| "Fichier audio illisible (base64 invalide).".to_string())?;
    if audio.len() > MAX_AUDIO_FILE_BYTES {
        return Err(format!(
            "Le fichier audio depasse la limite de {} Mo.",
            MAX_AUDIO_FILE_BYTES / (1024 * 1024)
        ));
    }
    Ok(audio)
}

fn audio_extension_for_mime(mime_type: &str) -> Option<&'static str> {
    match mime_type {
        "audio/wav" | "audio/wave" | "audio/x-wav" => Some("wav"),
        "audio/mpeg" | "audio/mp3" => Some("mp3"),
        "audio/mp4" | "audio/x-m4a" | "video/mp4" => Some("m4a"),
        "audio/aac" => Some("aac"),
        "audio/flac" | "audio/x-flac" => Some("flac"),
        "audio/ogg" | "application/ogg" => Some("ogg"),
        "audio/opus" => Some("opus"),
        "audio/webm" | "video/webm" => Some("webm"),
        "audio/x-ms-wma" => Some("wma"),
        "audio/amr" => Some("amr"),
        "audio/aiff" | "audio/x-aiff" => Some("aiff"),
        _ => None,
    }
}

fn audio_mime_for_extension(extension: &str) -> Option<&'static str> {
    match extension {
        "wav" => Some("audio/wav"),
        "mp3" | "mpeg" | "mpga" => Some("audio/mpeg"),
        "m4a" | "mp4" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "flac" => Some("audio/flac"),
        "ogg" | "oga" => Some("audio/ogg"),
        "opus" => Some("audio/opus"),
        "webm" => Some("audio/webm"),
        "wma" => Some("audio/x-ms-wma"),
        "amr" => Some("audio/amr"),
        "aif" | "aiff" => Some("audio/aiff"),
        _ => None,
    }
}

fn normalize_audio_file_metadata(
    file_name: &str,
    mime_type: &str,
) -> Result<(String, String), String> {
    let raw_name = file_name
        .rsplit(|character| character == '/' || character == '\\')
        .next()
        .unwrap_or("")
        .trim();
    let mut safe_name = raw_name
        .chars()
        .filter(|character| {
            character.is_alphanumeric()
                || matches!(character, ' ' | '.' | '-' | '_' | '(' | ')' | '[' | ']')
        })
        .take(180)
        .collect::<String>();
    while safe_name.starts_with('.') {
        safe_name.remove(0);
    }

    let normalized_mime = mime_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let extension = safe_name
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .filter(|extension| audio_mime_for_extension(extension).is_some())
        .or_else(|| audio_extension_for_mime(&normalized_mime).map(str::to_string))
        .ok_or_else(|| {
            "Format audio non pris en charge. Utilise WAV, MP3, M4A, AAC, FLAC, OGG, OPUS ou WebM."
                .to_string()
        })?;

    if audio_mime_for_extension(
        safe_name
            .rsplit_once('.')
            .map(|(_, value)| value.to_ascii_lowercase())
            .as_deref()
            .unwrap_or(""),
    )
    .is_none()
    {
        safe_name = format!("audio.{extension}");
    }
    if safe_name.is_empty() {
        safe_name = format!("audio.{extension}");
    }

    let mime_is_supported = normalized_mime.starts_with("audio/")
        || matches!(
            normalized_mime.as_str(),
            "video/mp4" | "video/webm" | "application/ogg" | "application/octet-stream"
        );
    let safe_mime = if mime_is_supported && normalized_mime != "application/octet-stream" {
        normalized_mime
    } else {
        audio_mime_for_extension(&extension)
            .unwrap_or("application/octet-stream")
            .to_string()
    };
    Ok((safe_name, safe_mime))
}

async fn normalize_uploaded_audio(audio: Vec<u8>, file_name: String) -> Result<Vec<u8>, String> {
    if audio.len() >= 12 && &audio[0..4] == b"RIFF" && &audio[8..12] == b"WAVE" {
        return Ok(audio);
    }
    tokio::task::spawn_blocking(move || normalize_uploaded_audio_blocking(&audio, &file_name))
        .await
        .map_err(|error| format!("Conversion audio interrompue : {error}"))?
}

fn normalize_uploaded_audio_blocking(audio: &[u8], file_name: &str) -> Result<Vec<u8>, String> {
    let temp = TempVoiceDir::create()?;
    let input_path = temp.path().join(file_name);
    let output_path = temp.path().join("normalized.wav");
    fs::write(&input_path, audio)
        .map_err(|error| format!("Ecriture du fichier audio impossible : {error}"))?;

    let ffmpeg = env::var("CST_VOICE_FFMPEG_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string());
    let output = Command::new(&ffmpeg)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-y")
        .arg("-i")
        .arg(&input_path)
        .arg("-vn")
        .arg("-ac")
        .arg("1")
        .arg("-ar")
        .arg("16000")
        .arg("-c:a")
        .arg("pcm_s16le")
        .arg(&output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            format!(
                "Impossible de convertir ce format audio avec ffmpeg ({ffmpeg}) : {error}. Installe ffmpeg ou utilise un fichier WAV."
            )
        })?;
    if !output.status.success() {
        return Err(format!(
            "Conversion audio impossible. {}",
            concise_process_error(&output.stderr, &output.stdout)
        ));
    }
    let metadata = fs::metadata(&output_path)
        .map_err(|error| format!("Lecture du WAV converti impossible : {error}"))?;
    if metadata.len() > MAX_NORMALIZED_AUDIO_BYTES {
        return Err("L'audio decode est trop long (maximum conseille : 4 heures).".to_string());
    }
    fs::read(&output_path).map_err(|error| format!("Lecture du WAV converti impossible : {error}"))
}

async fn transcription_accelerator(config: &VoiceConfig, provider: &str) -> Result<String, String> {
    let preference = configured_value(
        "CST_VOICE_TRANSCRIPTION_ACCELERATOR",
        config.transcription_accelerator.as_deref(),
    )
    .unwrap_or_else(|| "auto".to_string())
    .to_ascii_lowercase();
    match preference.as_str() {
        "gpu" => Ok("gpu".to_string()),
        "cpu" => Ok("cpu".to_string()),
        "auto" if provider.contains("remote") => Ok("distant".to_string()),
        "auto" => {
            let gpu = tokio::task::spawn_blocking(query_nvidia_gpu)
                .await
                .unwrap_or(None);
            Ok(if gpu.is_some() { "gpu" } else { "cpu" }.to_string())
        }
        _ => Err(
            "Accelerateur de transcription invalide : utilise auto, gpu ou cpu dans CST_VOICE_TRANSCRIPTION_ACCELERATOR."
                .to_string(),
        ),
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
    transcribe_audio_remote(
        audio,
        "recording.wav",
        "audio/wav",
        language,
        endpoint,
        model,
    )
    .await
}

async fn transcribe_audio_remote_chunked(
    audio: &[u8],
    file_name: &str,
    mime_type: &str,
    language: &str,
    endpoint: &Url,
    model: &str,
) -> Result<(String, usize), String> {
    let owned_audio = audio.to_vec();
    let owned_name = file_name.to_string();
    let chunks =
        tokio::task::spawn_blocking(move || split_long_audio_blocking(&owned_audio, &owned_name))
            .await
            .map_err(|error| format!("Decoupage audio interrompu : {error}"))??;

    let Some(chunks) = chunks else {
        let text =
            transcribe_audio_remote(audio, file_name, mime_type, language, endpoint, model).await?;
        return Ok((text, 1));
    };

    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("audio");
    let chunk_count = chunks.len();
    let mut transcripts = Vec::with_capacity(chunk_count);
    for (index, chunk) in chunks.into_iter().enumerate() {
        let chunk_name = format!("{stem}-partie-{:03}.wav", index + 1);
        let text =
            transcribe_audio_remote(&chunk, &chunk_name, "audio/wav", language, endpoint, model)
                .await
                .map_err(|error| {
                    format!(
                        "La partie {} sur {chunk_count} n'a pas pu etre transcrite : {error}",
                        index + 1
                    )
                })?;
        transcripts.push(text);
    }
    Ok((transcripts.join("\n\n"), chunk_count))
}

fn split_long_audio_blocking(
    audio: &[u8],
    file_name: &str,
) -> Result<Option<Vec<Vec<u8>>>, String> {
    let temp = TempVoiceDir::create()?;
    let input_path = temp.path().join(file_name);
    fs::write(&input_path, audio)
        .map_err(|error| format!("Ecriture du fichier audio impossible : {error}"))?;

    let ffmpeg = env::var("CST_VOICE_FFMPEG_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ffmpeg".to_string());
    let ffprobe = env::var("CST_VOICE_FFPROBE_BIN")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "ffprobe".to_string());
    let probe = match Command::new(&ffprobe)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(&input_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
    {
        Ok(output) => output,
        Err(_) => return Ok(None),
    };
    if !probe.status.success() {
        return Ok(None);
    }
    let duration = String::from_utf8_lossy(&probe.stdout)
        .trim()
        .parse::<f64>()
        .unwrap_or_default();
    if !duration.is_finite() || duration <= REMOTE_AUDIO_CHUNK_SECONDS as f64 {
        return Ok(None);
    }

    let chunk_count = (duration / REMOTE_AUDIO_CHUNK_SECONDS as f64).ceil() as usize;
    let mut chunks = Vec::with_capacity(chunk_count);
    for index in 0..chunk_count {
        let start = index as u64 * REMOTE_AUDIO_CHUNK_SECONDS;
        let output_path = temp.path().join(format!("chunk-{index:03}.wav"));
        let output = Command::new(&ffmpeg)
            .arg("-hide_banner")
            .arg("-loglevel")
            .arg("error")
            .arg("-nostdin")
            .arg("-y")
            .arg("-ss")
            .arg(start.to_string())
            .arg("-i")
            .arg(&input_path)
            .arg("-t")
            .arg(REMOTE_AUDIO_CHUNK_SECONDS.to_string())
            .arg("-vn")
            .arg("-ac")
            .arg("1")
            .arg("-ar")
            .arg("16000")
            .arg("-c:a")
            .arg("pcm_s16le")
            .arg(&output_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Impossible de decouper l'audio avec ffmpeg : {error}"))?;
        if !output.status.success() {
            return Err(format!(
                "Decoupage audio impossible. {}",
                concise_process_error(&output.stderr, &output.stdout)
            ));
        }
        let chunk = fs::read(&output_path)
            .map_err(|error| format!("Lecture d'un segment audio impossible : {error}"))?;
        if chunk.len() > 44 {
            chunks.push(chunk);
        }
    }
    if chunks.len() < 2 {
        return Ok(None);
    }
    Ok(Some(chunks))
}

async fn transcribe_audio_remote(
    audio: &[u8],
    file_name: &str,
    mime_type: &str,
    language: &str,
    endpoint: &Url,
    model: &str,
) -> Result<String, String> {
    let audio_part = multipart::Part::bytes(audio.to_vec())
        .file_name(file_name.to_string())
        .mime_str(mime_type)
        .map_err(|error| format!("Preparation du fichier audio distant impossible : {error}"))?;
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

async fn post_process_with_ollama(
    transcript: &str,
    model: &str,
    endpoint: &Url,
    output_mode: VoiceOutputMode,
) -> Result<String, String> {
    if output_mode == VoiceOutputMode::Faithful {
        return Ok(transcript.trim().to_string());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client Ollama indisponible : {error}"))?;

    let chunks = split_transcript_for_ollama(transcript, OLLAMA_CHUNK_CHARS);
    let mut outputs = Vec::with_capacity(chunks.len());
    for (index, chunk) in chunks.iter().enumerate() {
        let prompt = match output_mode {
            VoiceOutputMode::Clean => "Nettoie cette transcription sans la resumer. Supprime uniquement les hesitations (par exemple euh, hum), tics de langage, repetitions accidentelles et faux departs. Retablis une ponctuation et des paragraphes naturels. Conserve absolument toutes les informations utiles, demandes, contraintes, negations, noms propres, noms de fichiers, chemins, commandes, nombres, dates, exemples et nuances. Ne reponds pas au contenu, n'ajoute rien et garde sa langue. Retourne uniquement le texte nettoye.",
            VoiceOutputMode::Summary => "Transforme cette partie de transcription en compte rendu clair et concis. Supprime les hesitations, repetitions, digressions sans consequence et faux departs. Conserve les faits, decisions, actions, responsables, objections, incertitudes, dates, nombres, noms propres et details techniques utiles. Structure avec de courts paragraphes ou listes si cela aide. N'invente rien, ne reponds pas au contenu et garde sa langue. Retourne uniquement le compte rendu.",
            VoiceOutputMode::Faithful => unreachable!(),
        };
        let num_predict = match output_mode {
            VoiceOutputMode::Clean => (chunk.chars().count() / 2 + 256).clamp(768, 4_096),
            VoiceOutputMode::Summary => 1_536,
            VoiceOutputMode::Faithful => unreachable!(),
        };
        let output =
            ollama_rewrite_once(&client, chunk, model, endpoint, prompt, 8_192, num_predict)
                .await
                .map_err(|error| {
                    if chunks.len() > 1 {
                        format!(
                            "Traitement du bloc {} sur {} impossible : {error}",
                            index + 1,
                            chunks.len()
                        )
                    } else {
                        error
                    }
                })?;
        outputs.push(output);
    }

    if output_mode == VoiceOutputMode::Summary && outputs.len() > 1 {
        let intermediate = outputs.join("\n\n");
        return ollama_rewrite_once(
            &client,
            &intermediate,
            model,
            endpoint,
            "Fusionne ces comptes rendus partiels en un seul compte rendu coherent, concis et bien structure. Elimine les doublons mais conserve tous les faits, decisions, actions, responsables, objections, incertitudes, dates, nombres, noms propres et details techniques utiles. Respecte l'ordre logique ou chronologique. N'invente rien et retourne uniquement le compte rendu final.",
            16_384,
            2_048,
        )
        .await;
    }

    Ok(outputs.join("\n\n"))
}

fn split_transcript_for_ollama(transcript: &str, max_chars: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for word in transcript.split_whitespace() {
        let separator = usize::from(!current.is_empty());
        if !current.is_empty()
            && current.chars().count() + separator + word.chars().count() > max_chars
        {
            chunks.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    if chunks.is_empty() {
        chunks.push(String::new());
    }
    chunks
}

async fn ollama_rewrite_once(
    client: &reqwest::Client,
    text: &str,
    model: &str,
    endpoint: &Url,
    system_prompt: &str,
    num_ctx: usize,
    num_predict: usize,
) -> Result<String, String> {
    let request = client.post(endpoint.clone()).json(&json!({
        "model": model,
        "stream": false,
        "think": false,
        "keep_alive": "10m",
        "messages": [
            {
                "role": "system",
                "content": system_prompt
            },
            {
                "role": "user",
                "content": text
            }
        ],
        "options": {
            "temperature": 0.1,
            "num_ctx": num_ctx,
            "num_predict": num_predict
        }
    }));
    let request = configure_ollama_request(request)?;
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
    let rewritten = strip_thinking(&payload.message.content);
    if rewritten.is_empty() {
        return Err("Ollama a renvoye un texte vide.".to_string());
    }
    Ok(rewritten)
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
    fn output_modes_default_to_clean_and_reject_unknown_values() {
        assert_eq!(default_output_mode(), "clean");
        assert_eq!(
            normalize_output_mode("faithful").unwrap(),
            VoiceOutputMode::Faithful
        );
        assert_eq!(
            normalize_output_mode(" CLEAN ").unwrap(),
            VoiceOutputMode::Clean
        );
        assert_eq!(
            normalize_output_mode("summary").unwrap(),
            VoiceOutputMode::Summary
        );
        assert!(normalize_output_mode("aggressive").is_err());
    }

    #[test]
    fn long_transcripts_are_split_without_losing_words() {
        let transcript = (0..120)
            .map(|index| format!("mot-{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let chunks = split_transcript_for_ollama(&transcript, 90);
        assert!(chunks.len() > 1);
        assert!(chunks.iter().all(|chunk| chunk.chars().count() <= 90));
        assert_eq!(chunks.join(" "), transcript);
    }

    #[test]
    fn wav_validation_rejects_non_audio_content() {
        let encoded = STANDARD.encode(b"not a wav file");
        assert!(decode_wav(&encoded, "audio/wav").is_err());
        assert!(decode_wav(&encoded, "audio/webm").is_err());
    }

    #[test]
    fn uploaded_audio_metadata_accepts_common_formats_and_removes_paths() {
        assert_eq!(
            normalize_audio_file_metadata("../../reunion finale.MP3", "audio/mpeg; charset=utf-8")
                .unwrap(),
            ("reunion finale.MP3".to_string(), "audio/mpeg".to_string())
        );
        assert_eq!(
            normalize_audio_file_metadata("sans-extension", "audio/x-m4a").unwrap(),
            ("audio.m4a".to_string(), "audio/x-m4a".to_string())
        );
        assert!(normalize_audio_file_metadata("notes.txt", "text/plain").is_err());
    }

    #[test]
    fn uploaded_audio_base64_is_bounded_and_validated() {
        assert_eq!(
            decode_audio_file_base64(&STANDARD.encode(b"audio")).unwrap(),
            b"audio"
        );
        assert!(decode_audio_file_base64("pas du base64").is_err());
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
