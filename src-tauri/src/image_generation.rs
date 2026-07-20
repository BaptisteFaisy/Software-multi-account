use crate::{
    creative_accounts::{creative_accounts_for_owner, resolve_fal_account, DESKTOP_CREATIVE_OWNER},
    video_generation::VideoGenerationStatus,
};
use reqwest::{redirect::Policy, Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::time::Duration;

pub const MAX_IMAGE_GENERATION_REQUEST_BYTES: usize = 64 * 1024;
const MAX_PROMPT_CHARS: usize = 1_500;
const MAX_NEGATIVE_PROMPT_CHARS: usize = 500;
const MAX_REQUEST_ID_CHARS: usize = 160;
const MAX_LOG_LINES: usize = 24;
const MAX_LOG_CHARS: usize = 600;
const MAX_OUTPUT_IMAGES: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageStyleView {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageModelView {
    pub id: String,
    pub label: String,
    pub maker: String,
    pub description: String,
    pub quality: String,
    pub image_sizes: Vec<String>,
    pub styles: Vec<ImageStyleView>,
    pub max_images: u8,
    pub supports_negative_prompt: bool,
    pub default_image_size: String,
    pub default_style: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationCapabilities {
    pub configured: bool,
    pub service: String,
    pub configuration_hint: String,
    pub models: Vec<ImageModelView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationRequest {
    #[serde(default)]
    pub account_id: Option<String>,
    pub model_id: String,
    pub prompt: String,
    pub image_size: String,
    pub style: String,
    #[serde(default = "default_num_images")]
    pub num_images: u8,
    #[serde(default)]
    pub negative_prompt: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationStatusRequest {
    #[serde(default)]
    pub account_id: Option<String>,
    pub request_id: String,
    pub model_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImageView {
    pub url: String,
    pub width: Option<u64>,
    pub height: Option<u64>,
    pub content_type: Option<String>,
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerationJob {
    pub account_id: String,
    pub request_id: String,
    pub model_id: String,
    pub status: VideoGenerationStatus,
    pub queue_position: Option<u64>,
    pub logs: Vec<String>,
    pub images: Vec<GeneratedImageView>,
    pub seed: Option<i64>,
    pub inference_seconds: Option<f64>,
    pub error: Option<String>,
}

#[derive(Clone, Copy)]
struct ImageModelSpec {
    id: &'static str,
    label: &'static str,
    maker: &'static str,
    description: &'static str,
    quality: &'static str,
    endpoint: &'static str,
    image_sizes: &'static [&'static str],
    styles: &'static [(&'static str, &'static str)],
    max_images: u8,
    supports_negative_prompt: bool,
    default_image_size: &'static str,
    default_style: &'static str,
}

const COMMON_IMAGE_SIZES: &[&str] = &[
    "square_hd",
    "square",
    "portrait_4_3",
    "portrait_16_9",
    "landscape_4_3",
    "landscape_16_9",
];

const IMAGE_MODELS: &[ImageModelSpec] = &[
    ImageModelSpec {
        id: "flux-2-flash",
        label: "FLUX 2 Flash",
        maker: "Black Forest Labs",
        description: "Rapide, polyvalent et adapté aux séries de variantes.",
        quality: "Rapide",
        endpoint: "fal-ai/flux-2/flash",
        image_sizes: COMMON_IMAGE_SIZES,
        styles: &[("auto", "Automatique")],
        max_images: 4,
        supports_negative_prompt: false,
        default_image_size: "square_hd",
        default_style: "auto",
    },
    ImageModelSpec {
        id: "ideogram-v3",
        label: "Ideogram V3",
        maker: "Ideogram",
        description: "Excellent pour le texte lisible, les affiches et le design.",
        quality: "Design",
        endpoint: "fal-ai/ideogram/v3",
        image_sizes: COMMON_IMAGE_SIZES,
        styles: &[
            ("AUTO", "Automatique"),
            ("GENERAL", "Général"),
            ("REALISTIC", "Réaliste"),
            ("DESIGN", "Design"),
        ],
        max_images: 4,
        supports_negative_prompt: true,
        default_image_size: "square_hd",
        default_style: "AUTO",
    },
    ImageModelSpec {
        id: "recraft-v3",
        label: "Recraft V3",
        maker: "Recraft",
        description: "Illustration, rendu réaliste ou visuel vectoriel propre.",
        quality: "Illustration",
        endpoint: "fal-ai/recraft/v3/text-to-image",
        image_sizes: COMMON_IMAGE_SIZES,
        styles: &[
            ("realistic_image", "Image réaliste"),
            ("digital_illustration", "Illustration numérique"),
            ("vector_illustration", "Illustration vectorielle"),
        ],
        max_images: 1,
        supports_negative_prompt: false,
        default_image_size: "square_hd",
        default_style: "realistic_image",
    },
];

fn default_num_images() -> u8 {
    1
}

fn model_spec(id: &str) -> Result<ImageModelSpec, String> {
    IMAGE_MODELS
        .iter()
        .copied()
        .find(|model| model.id == id.trim())
        .ok_or_else(|| "Modèle image inconnu ou non autorisé.".to_string())
}

fn model_view(spec: ImageModelSpec) -> ImageModelView {
    ImageModelView {
        id: spec.id.to_string(),
        label: spec.label.to_string(),
        maker: spec.maker.to_string(),
        description: spec.description.to_string(),
        quality: spec.quality.to_string(),
        image_sizes: spec
            .image_sizes
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        styles: spec
            .styles
            .iter()
            .map(|(id, label)| ImageStyleView {
                id: (*id).to_string(),
                label: (*label).to_string(),
            })
            .collect(),
        max_images: spec.max_images,
        supports_negative_prompt: spec.supports_negative_prompt,
        default_image_size: spec.default_image_size.to_string(),
        default_style: spec.default_style.to_string(),
    }
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub fn image_generation_capabilities() -> Result<ImageGenerationCapabilities, String> {
    image_generation_capabilities_for(DESKTOP_CREATIVE_OWNER)
}

pub(crate) fn image_generation_capabilities_for(
    owner_id: &str,
) -> Result<ImageGenerationCapabilities, String> {
    let accounts = creative_accounts_for_owner(owner_id)?;
    Ok(ImageGenerationCapabilities {
        configured: !accounts.accounts.is_empty(),
        service: "fal.ai".to_string(),
        configuration_hint: "Connecte un compte fal.ai dans le Studio IA, puis choisis-le avant de lancer une génération.".to_string(),
        models: IMAGE_MODELS.iter().copied().map(model_view).collect(),
    })
}

fn char_count(value: &str) -> usize {
    value.chars().count()
}

fn validate_request_id(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty()
        || char_count(value) > MAX_REQUEST_ID_CHARS
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err("Identifiant de génération image invalide.".to_string());
    }
    Ok(value.to_string())
}

fn validate_generation_request(
    mut request: ImageGenerationRequest,
) -> Result<(ImageGenerationRequest, ImageModelSpec), String> {
    let spec = model_spec(&request.model_id)?;
    request.model_id = spec.id.to_string();
    request.prompt = request.prompt.trim().to_string();
    if request.prompt.is_empty() {
        return Err("Décris l’image à générer.".to_string());
    }
    if char_count(&request.prompt) > MAX_PROMPT_CHARS {
        return Err(format!(
            "Le prompt dépasse la limite de {MAX_PROMPT_CHARS} caractères."
        ));
    }
    if !spec.image_sizes.contains(&request.image_size.as_str()) {
        return Err("Format d’image non pris en charge par ce modèle.".to_string());
    }
    if !spec.styles.iter().any(|(style, _)| *style == request.style) {
        return Err("Style non pris en charge par ce modèle.".to_string());
    }
    if request.num_images == 0 || request.num_images > spec.max_images {
        return Err(format!(
            "Ce modèle accepte entre 1 et {} image(s) par génération.",
            spec.max_images
        ));
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
    if request.negative_prompt.is_some() && !spec.supports_negative_prompt {
        return Err("Ce modèle ne prend pas en charge le prompt négatif.".to_string());
    }
    Ok((request, spec))
}

fn generation_payload(request: &ImageGenerationRequest, spec: ImageModelSpec) -> Value {
    let mut payload = Map::new();
    payload.insert("prompt".to_string(), json!(request.prompt));
    payload.insert("image_size".to_string(), json!(request.image_size));

    match spec.id {
        "flux-2-flash" => {
            payload.insert("num_images".to_string(), json!(request.num_images));
            payload.insert("enable_prompt_expansion".to_string(), json!(true));
            payload.insert("enable_safety_checker".to_string(), json!(true));
            payload.insert("output_format".to_string(), json!("jpeg"));
        }
        "ideogram-v3" => {
            payload.insert("style".to_string(), json!(request.style));
            payload.insert("rendering_speed".to_string(), json!("BALANCED"));
            payload.insert("expand_prompt".to_string(), json!(true));
            payload.insert("num_images".to_string(), json!(request.num_images));
            if let Some(negative_prompt) = request.negative_prompt.as_deref() {
                payload.insert("negative_prompt".to_string(), json!(negative_prompt));
            }
        }
        "recraft-v3" => {
            payload.insert("style".to_string(), json!(request.style));
            payload.insert("enable_safety_checker".to_string(), json!(true));
        }
        _ => {}
    }
    Value::Object(payload)
}

fn fal_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(45))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("Client de génération image indisponible : {error}"))
}

fn auth_header(key: &str) -> String {
    format!("Key {key}")
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
    let value = serde_json::from_str::<Value>(&text).unwrap_or_else(
        |_| json!({ "message": text.trim().chars().take(2_000).collect::<String>() }),
    );
    if status.is_success() {
        return Ok(value);
    }
    let detail = fal_error_message(&value)
        .unwrap_or_else(|| format!("fal.ai a retourné HTTP {}", status.as_u16()))
        .replace(key, "***");
    Err(format!("Échec de {action} : {detail}"))
}

fn empty_job(
    account_id: String,
    request_id: String,
    model_id: String,
    status: VideoGenerationStatus,
) -> ImageGenerationJob {
    ImageGenerationJob {
        account_id,
        request_id,
        model_id,
        status,
        queue_position: None,
        logs: Vec::new(),
        images: Vec::new(),
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

fn output_images(value: &Value) -> Vec<GeneratedImageView> {
    ["/images", "/data/images", "/payload/images"]
        .into_iter()
        .find_map(|pointer| value.pointer(pointer).and_then(Value::as_array))
        .into_iter()
        .flatten()
        .filter_map(|image| {
            let url = image.get("url").and_then(Value::as_str)?.trim();
            if !url.starts_with("https://") || url.len() > 8_192 {
                return None;
            }
            Some(GeneratedImageView {
                url: url.to_string(),
                width: image.get("width").and_then(Value::as_u64),
                height: image.get("height").and_then(Value::as_u64),
                content_type: image
                    .get("content_type")
                    .and_then(Value::as_str)
                    .map(|value| value.chars().take(120).collect()),
                file_name: image
                    .get("file_name")
                    .and_then(Value::as_str)
                    .map(|value| value.chars().take(240).collect()),
            })
        })
        .take(MAX_OUTPUT_IMAGES)
        .collect()
}

fn status_request_parts(
    request: &ImageGenerationStatusRequest,
) -> Result<(ImageGenerationStatusRequest, ImageModelSpec), String> {
    let spec = model_spec(&request.model_id)?;
    Ok((
        ImageGenerationStatusRequest {
            account_id: request.account_id.clone(),
            request_id: validate_request_id(&request.request_id)?,
            model_id: spec.id.to_string(),
        },
        spec,
    ))
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn start_image_generation(
    request: ImageGenerationRequest,
) -> Result<ImageGenerationJob, String> {
    start_image_generation_for(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) async fn start_image_generation_for(
    owner_id: &str,
    request: ImageGenerationRequest,
) -> Result<ImageGenerationJob, String> {
    let (request, spec) = validate_generation_request(request)?;
    let account = resolve_fal_account(owner_id, request.account_id.as_deref())?;
    let response = fal_client()?
        .post(format!("https://queue.fal.run/{}", spec.endpoint))
        .header("Authorization", auth_header(&account.api_key))
        .header("Content-Type", "application/json")
        .json(&generation_payload(&request, spec))
        .send()
        .await
        .map_err(|error| format!("fal.ai est injoignable : {}", error.without_url()))?;
    let value = response_json(response, &account.api_key, "l’envoi de la génération").await?;
    let request_id = value
        .get("request_id")
        .and_then(Value::as_str)
        .ok_or_else(|| "fal.ai n’a pas renvoyé d’identifiant de génération.".to_string())?;
    let mut job = empty_job(
        account.id,
        validate_request_id(request_id)?,
        spec.id.to_string(),
        VideoGenerationStatus::Queued,
    );
    job.queue_position = value.get("queue_position").and_then(Value::as_u64);
    Ok(job)
}

async fn image_generation_status_inner(
    request: ImageGenerationStatusRequest,
    account_id: String,
    key: &str,
) -> Result<ImageGenerationJob, String> {
    let (request, spec) = status_request_parts(&request)?;
    let client = fal_client()?;
    let response = client
        .get(format!(
            "https://queue.fal.run/{}/requests/{}/status?logs=1",
            spec.endpoint, request.request_id
        ))
        .header("Authorization", auth_header(key))
        .send()
        .await
        .map_err(|error| format!("fal.ai est injoignable : {}", error.without_url()))?;
    let value = response_json(response, key, "la lecture de l’état").await?;
    let status = match value
        .get("status")
        .and_then(Value::as_str)
        .unwrap_or("IN_QUEUE")
    {
        "IN_PROGRESS" => VideoGenerationStatus::InProgress,
        "COMPLETED" => VideoGenerationStatus::Completed,
        "CANCELLED" | "CANCELED" => VideoGenerationStatus::Cancelled,
        "FAILED" | "ERROR" => VideoGenerationStatus::Failed,
        _ => VideoGenerationStatus::Queued,
    };
    let mut job = empty_job(
        account_id,
        request.request_id.clone(),
        spec.id.to_string(),
        status,
    );
    job.queue_position = value.get("queue_position").and_then(Value::as_u64);
    job.logs = sanitized_logs(&value);
    job.inference_seconds = value
        .pointer("/metrics/inference_time")
        .and_then(Value::as_f64);
    job.error = fal_error_message(&value);

    if job.status == VideoGenerationStatus::Completed && job.error.is_none() {
        let response = client
            .get(format!(
                "https://queue.fal.run/{}/requests/{}",
                spec.endpoint, request.request_id
            ))
            .header("Authorization", auth_header(key))
            .send()
            .await
            .map_err(|error| format!("Résultat fal.ai injoignable : {}", error.without_url()))?;
        let result = response_json(response, key, "la récupération des images").await?;
        job.images = output_images(&result);
        job.seed = result.get("seed").and_then(Value::as_i64);
        if job.images.is_empty() {
            job.status = VideoGenerationStatus::Failed;
            job.error = Some(
                "La génération est terminée, mais aucune URL d’image valide n’a été renvoyée."
                    .to_string(),
            );
        }
    } else if job.error.is_some() {
        job.status = VideoGenerationStatus::Failed;
    }
    Ok(job)
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn image_generation_status(
    request: ImageGenerationStatusRequest,
) -> Result<ImageGenerationJob, String> {
    image_generation_status_for(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) async fn image_generation_status_for(
    owner_id: &str,
    request: ImageGenerationStatusRequest,
) -> Result<ImageGenerationJob, String> {
    let account = resolve_fal_account(owner_id, request.account_id.as_deref())?;
    image_generation_status_inner(request, account.id, &account.api_key).await
}

#[cfg_attr(feature = "desktop", tauri::command)]
pub async fn cancel_image_generation(
    request: ImageGenerationStatusRequest,
) -> Result<ImageGenerationJob, String> {
    cancel_image_generation_for(DESKTOP_CREATIVE_OWNER, request).await
}

pub(crate) async fn cancel_image_generation_for(
    owner_id: &str,
    request: ImageGenerationStatusRequest,
) -> Result<ImageGenerationJob, String> {
    let account = resolve_fal_account(owner_id, request.account_id.as_deref())?;
    let (request, spec) = status_request_parts(&request)?;
    let response = fal_client()?
        .put(format!(
            "https://queue.fal.run/{}/requests/{}/cancel",
            spec.endpoint, request.request_id
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
            VideoGenerationStatus::Cancelled,
        ));
    }
    if status.as_u16() == 400 && text.contains("ALREADY_COMPLETED") {
        return image_generation_status_inner(request, account.id, &account.api_key).await;
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

    fn request(model_id: &str) -> ImageGenerationRequest {
        let spec = model_spec(model_id).unwrap();
        ImageGenerationRequest {
            account_id: None,
            model_id: model_id.to_string(),
            prompt: "Une maison moderniste dans une forêt brumeuse.".to_string(),
            image_size: spec.default_image_size.to_string(),
            style: spec.default_style.to_string(),
            num_images: 1,
            negative_prompt: None,
        }
    }

    #[test]
    fn catalog_exposes_three_allowlisted_models() {
        assert_eq!(IMAGE_MODELS.len(), 3);
        assert!(IMAGE_MODELS.iter().all(|model| model
            .endpoint
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "/-._".contains(c))));
    }

    #[test]
    fn ideogram_payload_contains_supported_controls() {
        let mut value = request("ideogram-v3");
        value.style = "DESIGN".to_string();
        value.num_images = 2;
        value.negative_prompt = Some("filigrane".to_string());
        let (value, spec) = validate_generation_request(value).unwrap();
        let payload = generation_payload(&value, spec);
        assert_eq!(payload["style"], "DESIGN");
        assert_eq!(payload["rendering_speed"], "BALANCED");
        assert_eq!(payload["num_images"], 2);
        assert_eq!(payload["negative_prompt"], "filigrane");
    }

    #[test]
    fn unsupported_options_are_rejected() {
        let mut value = request("recraft-v3");
        value.num_images = 2;
        assert!(validate_generation_request(value).is_err());

        let mut value = request("flux-2-flash");
        value.negative_prompt = Some("texte".to_string());
        assert!(validate_generation_request(value).is_err());
    }

    #[test]
    fn output_only_accepts_https_image_urls() {
        let value = json!({
            "images": [
                { "url": "https://cdn.example.test/image.jpg", "width": 1024 },
                { "url": "http://localhost/private.png" }
            ]
        });
        let images = output_images(&value);
        assert_eq!(images.len(), 1);
        assert_eq!(images[0].width, Some(1024));
    }

    #[test]
    fn request_ids_cannot_change_the_queue_url() {
        assert!(validate_request_id("abc-123_DEF").is_ok());
        assert!(validate_request_id("../../status?token=oops").is_err());
        assert!(model_spec("https://example.com/evil").is_err());
    }
}
