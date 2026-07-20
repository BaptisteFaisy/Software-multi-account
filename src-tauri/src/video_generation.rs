use crate::creative_accounts::{
    creative_accounts_for_owner, resolve_fal_account, DESKTOP_CREATIVE_OWNER,
};
use reqwest::{redirect::Policy, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::Duration;

pub const MAX_VIDEO_REQUEST_BYTES: usize = 12 * 1024 * 1024;
pub const MAX_INPUT_IMAGE_BYTES: usize = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS: usize = 1_500;
const MAX_NEGATIVE_PROMPT_CHARS: usize = 500;
const MAX_REQUEST_ID_CHARS: usize = 160;
const MAX_LOG_LINES: usize = 24;
const MAX_LOG_CHARS: usize = 600;
const FAL_QUEUE_BASE_URL: &str = "https://queue.fal.run";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum VideoGenerationMode {
    Text,
    Image,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoModelView {
    pub id: String,
    pub label: String,
    pub maker: String,
    pub description: String,
    pub quality: String,
    pub supports_image: bool,
    pub supports_audio: bool,
    pub aspect_ratios: Vec<String>,
    pub durations: Vec<u16>,
    pub resolutions: Vec<String>,
    pub default_aspect_ratio: String,
    pub default_duration: u16,
    pub default_resolution: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenerationCapabilities {
    pub configured: bool,
    pub service: String,
    pub configuration_hint: String,
    pub max_image_bytes: usize,
    pub models: Vec<VideoModelView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenerationRequest {
    #[serde(default)]
    pub account_id: Option<String>,
    pub model_id: String,
    pub mode: VideoGenerationMode,
    pub prompt: String,
    #[serde(default)]
    pub image_url: Option<String>,
    pub aspect_ratio: String,
    pub duration: u16,
    pub resolution: String,
    #[serde(default)]
    pub generate_audio: bool,
    #[serde(default)]
    pub negative_prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenerationStatusRequest {
    #[serde(default)]
    pub account_id: Option<String>,
    pub request_id: String,
    pub model_id: String,
    pub mode: VideoGenerationMode,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VideoGenerationStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoGenerationJob {
    pub account_id: String,
    pub request_id: String,
    pub model_id: String,
    pub mode: VideoGenerationMode,
    pub status: VideoGenerationStatus,
    pub queue_position: Option<u64>,
    pub logs: Vec<String>,
    pub video_url: Option<String>,
    pub actual_prompt: Option<String>,
    pub seed: Option<i64>,
    pub inference_seconds: Option<f64>,
    pub error: Option<String>,
}

#[derive(Clone, Copy)]
struct VideoModelSpec {
    id: &'static str,
    label: &'static str,
    maker: &'static str,
    description: &'static str,
    quality: &'static str,
    text_endpoint: &'static str,
    image_endpoint: Option<&'static str>,
    supports_audio: bool,
    aspect_ratios: &'static [&'static str],
    durations: &'static [u16],
    resolutions: &'static [&'static str],
    default_aspect_ratio: &'static str,
    default_duration: u16,
    default_resolution: &'static str,
}

const VIDEO_MODELS: &[VideoModelSpec] = &[
    VideoModelSpec {
        id: "wan-2.6",
        label: "Wan 2.6",
        maker: "Alibaba",
        description: "Polyvalent, multi-plan et idéal pour itérer.",
        quality: "Équilibré",
        text_endpoint: "wan/v2.6/text-to-video",
        image_endpoint: Some("wan/v2.6/image-to-video"),
        supports_audio: false,
        aspect_ratios: &["16:9", "9:16", "1:1", "4:3", "3:4"],
        durations: &[5, 10, 15],
        resolutions: &["720p", "1080p"],
        default_aspect_ratio: "16:9",
        default_duration: 5,
        default_resolution: "720p",
    },
    VideoModelSpec {
        id: "veo-3.1-fast",
        label: "Veo 3.1 Fast",
        maker: "Google",
        description: "Rendu premium avec son natif et mouvements réalistes.",
        quality: "Premium",
        text_endpoint: "fal-ai/veo3.1/fast",
        image_endpoint: Some("fal-ai/veo3.1/fast/image-to-video"),
        supports_audio: true,
        aspect_ratios: &["16:9", "9:16"],
        durations: &[4, 6, 8],
        resolutions: &["720p", "1080p", "4k"],
        default_aspect_ratio: "16:9",
        default_duration: 4,
        default_resolution: "720p",
    },
    VideoModelSpec {
        id: "kling-3-standard",
        label: "Kling 3.0",
        maker: "Kuaishou",
        description: "Cinématique, cohérent et capable de générer l’audio.",
        quality: "Cinématique",
        text_endpoint: "fal-ai/kling-video/v3/standard/text-to-video",
        image_endpoint: Some("fal-ai/kling-video/v3/standard/image-to-video"),
        supports_audio: true,
        aspect_ratios: &["16:9", "9:16", "1:1"],
        durations: &[3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
        resolutions: &["1080p"],
        default_aspect_ratio: "16:9",
        default_duration: 5,
        default_resolution: "1080p",
    },
    VideoModelSpec {
        id: "luma-ray-2",
        label: "Luma Ray 2",
        maker: "Luma AI",
        description: "Mouvements naturels et cadrages larges ou verticaux.",
        quality: "Mouvement",
        text_endpoint: "fal-ai/luma-dream-machine/ray-2",
        image_endpoint: Some("fal-ai/luma-dream-machine/ray-2/image-to-video"),
        supports_audio: false,
        aspect_ratios: &["16:9", "9:16", "4:3", "3:4", "21:9", "9:21"],
        durations: &[5, 9],
        resolutions: &["540p", "720p", "1080p"],
        default_aspect_ratio: "16:9",
        default_duration: 5,
        default_resolution: "540p",
    },
];

fn model_spec(id: &str) -> Result<VideoModelSpec, String> {
    VIDEO_MODELS
        .iter()
        .copied()
        .find(|model| model.id == id.trim())
        .ok_or_else(|| "Modèle vidéo inconnu ou non autorisé.".to_string())
}

fn model_view(spec: VideoModelSpec) -> VideoModelView {
    VideoModelView {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        maker: spec.maker.to_string(),
        description: spec.description.to_string(),
        quality: spec.quality.to_string(),
        supports_image: spec.image_endpoint.is_some(),
        supports_audio: spec.supports_audio,
        aspect_ratios: spec
            .aspect_ratios
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        durations: spec.durations.to_vec(),
        resolutions: spec
            .resolutions
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        default_aspect_ratio: spec.default_aspect_ratio.to_string(),
        default_duration: spec.default_duration,
        default_resolution: spec.default_resolution.to_string(),
    }
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn video_generation_capabilities() -> Result<VideoGenerationCapabilities, String> {
    video_generation_capabilities_for(DESKTOP_CREATIVE_OWNER)
}

pub(crate) fn video_generation_capabilities_for(
    owner_id: &str,
) -> Result<VideoGenerationCapabilities, String> {
    let accounts = creative_accounts_for_owner(owner_id)?;
    Ok(VideoGenerationCapabilities {
        configured: !accounts.accounts.is_empty(),
        service: "fal.ai".to_string(),
        configuration_hint: "Connecte un compte fal.ai dans le Studio IA, puis choisis-le avant de lancer une génération.".to_string(),
        max_image_bytes: MAX_INPUT_IMAGE_BYTES,
        models: VIDEO_MODELS.iter().copied().map(model_view).collect(),
    })
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn fal_queue_base_url() -> String {
    #[cfg(debug_assertions)]
    if let Ok(candidate) = std::env::var("CST_TEST_FAL_QUEUE_BASE_URL") {
        let candidate = candidate.trim().trim_end_matches('/');
        if let Ok(url) = url::Url::parse(candidate) {
            let loopback = url
                .host_str()
                .and_then(|host| host.parse::<std::net::IpAddr>().ok())
                .is_some_and(|host| host.is_loopback());
            if url.scheme() == "http"
                && loopback
                && url.username().is_empty()
                && url.password().is_none()
                && matches!(url.path(), "" | "/")
                && url.query().is_none()
                && url.fragment().is_none()
            {
                return candidate.to_string();
            }
        }
    }
    FAL_QUEUE_BASE_URL.to_string()
}

fn validate_image_url(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.starts_with("https://") {
        if value.len() > 4_096 || value.chars().any(char::is_control) {
            return Err("L’URL de l’image est invalide ou trop longue.".to_string());
        }
        return Ok(value.to_string());
    }

    const DATA_PREFIXES: &[&str] = &[
        "data:image/jpeg;base64,",
        "data:image/png;base64,",
        "data:image/webp;base64,",
        "data:image/bmp;base64,",
    ];
    let Some(prefix) = DATA_PREFIXES
        .iter()
        .find(|prefix| value.starts_with(**prefix))
    else {
        return Err(
            "Utilise une image JPEG, PNG, WebP ou BMP, ou une URL HTTPS publique.".to_string(),
        );
    };
    let encoded = &value[prefix.len()..];
    if encoded.is_empty()
        || !encoded
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'='))
    {
        return Err("Le contenu de l’image est invalide.".to_string());
    }
    let estimated_bytes = encoded.len().saturating_mul(3) / 4;
    if estimated_bytes > MAX_INPUT_IMAGE_BYTES {
        return Err(format!(
            "L’image dépasse la limite de {} Mo.",
            MAX_INPUT_IMAGE_BYTES / 1024 / 1024
        ));
    }
    Ok(value.to_string())
}

fn validate_request_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || char_count(value) > MAX_REQUEST_ID_CHARS
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Identifiant de génération vidéo invalide.".to_string());
    }
    Ok(value.to_string())
}

fn endpoint_for(spec: VideoModelSpec, mode: VideoGenerationMode) -> Result<&'static str, String> {
    match mode {
        VideoGenerationMode::Text => Ok(spec.text_endpoint),
        VideoGenerationMode::Image => spec
            .image_endpoint
            .ok_or_else(|| "Ce modèle ne prend pas en charge l’image vers vidéo.".to_string()),
    }
}

fn validate_generation_request(
    mut request: VideoGenerationRequest,
) -> Result<(VideoGenerationRequest, VideoModelSpec, &'static str), String> {
    let spec = model_spec(&request.model_id)?;
    let endpoint = endpoint_for(spec, request.mode)?;
    request.model_id = spec.id.to_string();
    request.prompt = request.prompt.trim().to_string();
    if request.prompt.is_empty() {
        return Err("Décris la vidéo à générer.".to_string());
    }
    if char_count(&request.prompt) > MAX_PROMPT_CHARS {
        return Err(format!(
            "Le prompt dépasse la limite de {MAX_PROMPT_CHARS} caractères."
        ));
    }
    if !spec.aspect_ratios.contains(&request.aspect_ratio.as_str()) {
        return Err("Format d’image non pris en charge par ce modèle.".to_string());
    }
    if !spec.durations.contains(&request.duration) {
        return Err("Durée non prise en charge par ce modèle.".to_string());
    }
    if !spec.resolutions.contains(&request.resolution.as_str()) {
        return Err("Résolution non prise en charge par ce modèle.".to_string());
    }
    if request.generate_audio && !spec.supports_audio {
        return Err("Ce modèle ne génère pas d’audio natif.".to_string());
    }
    request.negative_prompt = request
        .negative_prompt
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if request
        .negative_prompt
        .as_deref()
        .map(char_count)
        .unwrap_or(0)
        > MAX_NEGATIVE_PROMPT_CHARS
    {
        return Err(format!(
            "Le prompt négatif dépasse la limite de {MAX_NEGATIVE_PROMPT_CHARS} caractères."
        ));
    }
    request.image_url = match request.mode {
        VideoGenerationMode::Text => None,
        VideoGenerationMode::Image => Some(validate_image_url(
            request
                .image_url
                .as_deref()
                .ok_or_else(|| "Ajoute une image de départ.".to_string())?,
        )?),
    };
    Ok((request, spec, endpoint))
}

fn generation_payload(request: &VideoGenerationRequest, spec: VideoModelSpec) -> Value {
    let mut payload = Map::new();
    payload.insert("prompt".to_string(), json!(request.prompt));

    match spec.id {
        "veo-3.1-fast" => {
            payload.insert("aspect_ratio".to_string(), json!(request.aspect_ratio));
            payload.insert(
                "duration".to_string(),
                json!(format!("{}s", request.duration)),
            );
            payload.insert("resolution".to_string(), json!(request.resolution));
            payload.insert("generate_audio".to_string(), json!(request.generate_audio));
            payload.insert("auto_fix".to_string(), json!(true));
            payload.insert("safety_tolerance".to_string(), json!("4"));
        }
        "kling-3-standard" => {
            if request.mode == VideoGenerationMode::Text {
                payload.insert("aspect_ratio".to_string(), json!(request.aspect_ratio));
            }
            payload.insert("duration".to_string(), json!(request.duration.to_string()));
            payload.insert("generate_audio".to_string(), json!(request.generate_audio));
            payload.insert("shot_type".to_string(), json!("intelligent"));
            payload.insert("cfg_scale".to_string(), json!(0.5));
        }
        "wan-2.6" => {
            if request.mode == VideoGenerationMode::Text {
                payload.insert("aspect_ratio".to_string(), json!(request.aspect_ratio));
            }
            payload.insert("duration".to_string(), json!(request.duration.to_string()));
            payload.insert("resolution".to_string(), json!(request.resolution));
            payload.insert("enable_prompt_expansion".to_string(), json!(true));
            payload.insert("multi_shots".to_string(), json!(request.duration > 5));
            payload.insert("enable_safety_checker".to_string(), json!(true));
        }
        "luma-ray-2" => {
            payload.insert("aspect_ratio".to_string(), json!(request.aspect_ratio));
            payload.insert(
                "duration".to_string(),
                json!(format!("{}s", request.duration)),
            );
            payload.insert("resolution".to_string(), json!(request.resolution));
            payload.insert("loop".to_string(), json!(false));
        }
        _ => {}
    }

    if let Some(negative_prompt) = request.negative_prompt.as_deref() {
        payload.insert("negative_prompt".to_string(), json!(negative_prompt));
    }
    if let Some(image_url) = request.image_url.as_deref() {
        let field = if spec.id == "kling-3-standard" {
            "start_image_url"
        } else {
            "image_url"
        };
        payload.insert(field.to_string(), json!(image_url));
    }
    Value::Object(payload)
}

fn fal_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(45))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client de génération vidéo indisponible : {error}"))
}

fn fal_error_message(value: &Value) -> Option<String> {
    value
        .pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| value.get("error").and_then(Value::as_str))
        .or_else(|| value.get("message").and_then(Value::as_str))
        .or_else(|| value.get("detail").and_then(Value::as_str))
        .map(|message| message.trim().chars().take(2_000).collect())
}

async fn response_json(response: Response, key: &str, action: &str) -> Result<Value, String> {
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Réponse fal.ai illisible pendant {action} : {error}"))?;
    let value = serde_json::from_str::<Value>(&text).unwrap_or_else(|_| {
        json!({
            "message": text.trim().chars().take(2_000).collect::<String>()
        })
    });
    if status.is_success() {
        return Ok(value);
    }
    let detail = fal_error_message(&value)
        .unwrap_or_else(|| format!("fal.ai a retourné HTTP {}", status.as_u16()))
        .replace(key, "***");
    Err(format!("Échec de {action} : {detail}"))
}

fn auth_header(key: &str) -> String {
    format!("Key {key}")
}

fn status_request_parts(
    request: &VideoGenerationStatusRequest,
) -> Result<(VideoGenerationStatusRequest, VideoModelSpec, &'static str), String> {
    let spec = model_spec(&request.model_id)?;
    let endpoint = endpoint_for(spec, request.mode)?;
    Ok((
        VideoGenerationStatusRequest {
            account_id: request.account_id.clone(),
            request_id: validate_request_id(&request.request_id)?,
            model_id: spec.id.to_string(),
            mode: request.mode,
        },
        spec,
        endpoint,
    ))
}

fn empty_job(
    account_id: String,
    request_id: String,
    model_id: String,
    mode: VideoGenerationMode,
    status: VideoGenerationStatus,
) -> VideoGenerationJob {
    VideoGenerationJob {
        account_id,
        request_id,
        model_id,
        mode,
        status,
        queue_position: None,
        logs: Vec::new(),
        video_url: None,
        actual_prompt: None,
        seed: None,
        inference_seconds: None,
        error: None,
    }
}

fn sanitized_logs(value: &Value) -> Vec<String> {
    value
        .get("logs")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|line| line.get("message").and_then(Value::as_str))
        .map(|line| line.trim().chars().take(MAX_LOG_CHARS).collect::<String>())
        .filter(|line| !line.is_empty())
        .take(MAX_LOG_LINES)
        .collect()
}

fn output_video_url(value: &Value) -> Option<String> {
    ["/video/url", "/data/video/url", "/payload/video/url"]
        .into_iter()
        .find_map(|pointer| value.pointer(pointer).and_then(Value::as_str))
        .map(str::trim)
        .filter(|url| url.starts_with("https://") && url.len() <= 8_192)
        .map(str::to_string)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn start_video_generation(
    request: VideoGenerationRequest,
) -> Result<VideoGenerationJob, String> {
    start_video_generation_for(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) async fn start_video_generation_for(
    owner_id: &str,
    request: VideoGenerationRequest,
) -> Result<VideoGenerationJob, String> {
    let (request, spec, endpoint) = validate_generation_request(request)?;
    let account = resolve_fal_account(owner_id, request.account_id.as_deref())?;
    let payload = generation_payload(&request, spec);
    let response = fal_client()?
        .post(format!("{}/{endpoint}", fal_queue_base_url()))
        .header("Authorization", auth_header(&account.api_key))
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|error| format!("fal.ai est injoignable : {}", error.without_url()))?;
    let value = response_json(response, &account.api_key, "l’envoi de la génération").await?;
    let request_id = value
        .get("request_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "fal.ai n’a pas renvoyé d’identifiant de génération.".to_string())?;
    let request_id = validate_request_id(request_id)?;
    let mut job = empty_job(
        account.id,
        request_id,
        spec.id.to_string(),
        request.mode,
        VideoGenerationStatus::Queued,
    );
    job.queue_position = value.get("queue_position").and_then(Value::as_u64);
    Ok(job)
}

async fn video_generation_status_inner(
    request: VideoGenerationStatusRequest,
    account_id: String,
    key: &str,
) -> Result<VideoGenerationJob, String> {
    let (request, _spec, endpoint) = status_request_parts(&request)?;
    let client = fal_client()?;
    let queue_base_url = fal_queue_base_url();
    let status_response = client
        .get(format!(
            "{queue_base_url}/{endpoint}/requests/{}/status?logs=1",
            request.request_id
        ))
        .header("Authorization", auth_header(key))
        .send()
        .await
        .map_err(|error| format!("fal.ai est injoignable : {}", error.without_url()))?;
    let value = response_json(status_response, key, "la lecture de l’état").await?;
    let remote_status = value
        .get("status")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|status| !status.is_empty())
        .ok_or_else(|| "fal.ai a renvoyé un état de génération vide ou absent.".to_string())?;
    let status = match remote_status.to_ascii_uppercase().as_str() {
        "IN_QUEUE" | "QUEUED" => VideoGenerationStatus::Queued,
        "IN_PROGRESS" => VideoGenerationStatus::InProgress,
        "COMPLETED" => VideoGenerationStatus::Completed,
        "CANCELLED" | "CANCELED" => VideoGenerationStatus::Cancelled,
        "FAILED" | "ERROR" => VideoGenerationStatus::Failed,
        _ => return Err("fal.ai a renvoyé un état de génération inconnu.".to_string()),
    };
    let mut job = empty_job(
        account_id,
        request.request_id.clone(),
        request.model_id.clone(),
        request.mode,
        status,
    );
    job.queue_position = value.get("queue_position").and_then(Value::as_u64);
    job.logs = sanitized_logs(&value);
    job.inference_seconds = value
        .pointer("/metrics/inference_time")
        .and_then(Value::as_f64);
    job.error = fal_error_message(&value);

    if job.status == VideoGenerationStatus::Completed && job.error.is_none() {
        let result_response = client
            .get(format!(
                "{queue_base_url}/{endpoint}/requests/{}",
                request.request_id
            ))
            .header("Authorization", auth_header(key))
            .send()
            .await
            .map_err(|error| format!("Résultat fal.ai injoignable : {}", error.without_url()))?;
        let result = response_json(result_response, key, "la récupération de la vidéo").await?;
        job.video_url = output_video_url(&result);
        job.actual_prompt = result
            .get("actual_prompt")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(|value| value.chars().take(MAX_PROMPT_CHARS * 2).collect());
        job.seed = result.get("seed").and_then(Value::as_i64);
        if job.video_url.is_none() {
            job.status = VideoGenerationStatus::Failed;
            job.error = Some(
                "La génération est terminée, mais aucune URL vidéo valide n’a été renvoyée."
                    .to_string(),
            );
        }
    } else if job.error.is_some() {
        job.status = VideoGenerationStatus::Failed;
    }
    Ok(job)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn video_generation_status(
    request: VideoGenerationStatusRequest,
) -> Result<VideoGenerationJob, String> {
    video_generation_status_for(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) async fn video_generation_status_for(
    owner_id: &str,
    request: VideoGenerationStatusRequest,
) -> Result<VideoGenerationJob, String> {
    let account = resolve_fal_account(owner_id, request.account_id.as_deref())?;
    video_generation_status_inner(request, account.id, &account.api_key).await
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn cancel_video_generation(
    request: VideoGenerationStatusRequest,
) -> Result<VideoGenerationJob, String> {
    cancel_video_generation_for(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) async fn cancel_video_generation_for(
    owner_id: &str,
    request: VideoGenerationStatusRequest,
) -> Result<VideoGenerationJob, String> {
    let account = resolve_fal_account(owner_id, request.account_id.as_deref())?;
    let (request, _spec, endpoint) = status_request_parts(&request)?;
    let response = fal_client()?
        .put(format!(
            "{}/{endpoint}/requests/{}/cancel",
            fal_queue_base_url(),
            request.request_id
        ))
        .header("Authorization", auth_header(&account.api_key))
        .send()
        .await
        .map_err(|error| format!("fal.ai est injoignable : {}", error.without_url()))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if status.is_success() {
        return Ok(empty_job(
            account.id,
            request.request_id,
            request.model_id,
            request.mode,
            VideoGenerationStatus::Cancelled,
        ));
    }
    if status.as_u16() == 400 && text.contains("ALREADY_COMPLETED") {
        return video_generation_status_inner(request, account.id, &account.api_key).await;
    }
    let detail = serde_json::from_str::<Value>(&text)
        .ok()
        .as_ref()
        .and_then(fal_error_message)
        .unwrap_or_else(|| format!("fal.ai a retourné HTTP {}", status.as_u16()))
        .replace(&account.api_key, "***");
    Err(format!("Annulation impossible : {detail}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(model_id: &str) -> VideoGenerationRequest {
        let spec = model_spec(model_id).unwrap();
        VideoGenerationRequest {
            account_id: None,
            model_id: model_id.to_string(),
            mode: VideoGenerationMode::Text,
            prompt: "Une caméra traverse une forêt brumeuse au lever du soleil.".to_string(),
            image_url: None,
            aspect_ratio: spec.default_aspect_ratio.to_string(),
            duration: spec.default_duration,
            resolution: spec.default_resolution.to_string(),
            generate_audio: spec.supports_audio,
            negative_prompt: Some("texte, filigrane".to_string()),
        }
    }

    #[test]
    fn catalog_exposes_distinct_allowlisted_models() {
        let models = VIDEO_MODELS
            .iter()
            .copied()
            .map(model_view)
            .collect::<Vec<_>>();
        assert_eq!(models.len(), 4);
        let mut ids = models
            .iter()
            .map(|model| model.id.as_str())
            .collect::<Vec<_>>();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), models.len());
        assert!(models.iter().all(|model| model.supports_image));
    }

    #[test]
    fn veo_payload_uses_documented_duration_and_safety_fields() {
        let (request, spec, endpoint) =
            validate_generation_request(request("veo-3.1-fast")).unwrap();
        let payload = generation_payload(&request, spec);
        assert_eq!(endpoint, "fal-ai/veo3.1/fast");
        assert_eq!(payload["duration"], "4s");
        assert_eq!(payload["generate_audio"], true);
        assert_eq!(payload["safety_tolerance"], "4");
        assert!(payload.get("image_url").is_none());
    }

    #[test]
    fn image_mode_requires_a_supported_safe_input() {
        let mut value = request("wan-2.6");
        value.mode = VideoGenerationMode::Image;
        assert!(validate_generation_request(value.clone()).is_err());
        value.image_url = Some("http://localhost/private.png".to_string());
        assert!(validate_generation_request(value.clone()).is_err());
        value.image_url = Some("data:image/png;base64,aGVsbG8=".to_string());
        let (value, _, endpoint) = validate_generation_request(value).unwrap();
        assert_eq!(endpoint, "wan/v2.6/image-to-video");
        assert!(value
            .image_url
            .unwrap()
            .starts_with("data:image/png;base64,"));
    }

    #[test]
    fn kling_image_payload_uses_the_documented_start_image_field() {
        let mut value = request("kling-3-standard");
        value.mode = VideoGenerationMode::Image;
        value.image_url = Some("data:image/png;base64,aGVsbG8=".to_string());
        let (value, spec, endpoint) = validate_generation_request(value).unwrap();
        let payload = generation_payload(&value, spec);
        assert_eq!(endpoint, "fal-ai/kling-video/v3/standard/image-to-video");
        assert!(payload.get("start_image_url").is_some());
        assert!(payload.get("aspect_ratio").is_none());
    }

    #[test]
    fn unsupported_options_are_rejected_before_any_network_call() {
        let mut value = request("luma-ray-2");
        value.generate_audio = true;
        assert!(validate_generation_request(value).is_err());

        let mut value = request("kling-3-standard");
        value.resolution = "4k".to_string();
        assert!(validate_generation_request(value).is_err());
    }

    #[test]
    fn request_ids_cannot_change_the_allowlisted_queue_url() {
        assert!(validate_request_id("abc-123_DEF").is_ok());
        assert!(validate_request_id("../../status?token=oops").is_err());
        assert!(model_spec("https://example.com/evil").is_err());
    }
}
