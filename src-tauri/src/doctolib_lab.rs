use chrono::{DateTime, Duration, Utc};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use uuid::Uuid;

const PROPOSAL_TTL_SECONDS: i64 = 10 * 60;
const MAX_PROPOSALS: usize = 12;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DoctolibLabMode {
    Demo,
    Live,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctolibLabSearchRequest {
    pub mode: DoctolibLabMode,
    pub specialty: String,
    pub location: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctolibLabStatus {
    demo_ready: bool,
    live_ready: bool,
    node_ready: bool,
    worker_ready: bool,
    chrome_ready: bool,
    connected: Option<bool>,
    google_calendar_ready: bool,
    google_calendar_connected: Option<bool>,
    detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctolibLabProposalView {
    id: String,
    mode: DoctolibLabMode,
    practitioner_name: String,
    specialty: String,
    address: String,
    sector: String,
    visit_motive: String,
    starts_at: String,
    source_url: String,
    accepts_new_patients: bool,
    expires_at: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctolibLabSearchResponse {
    mode: DoctolibLabMode,
    generated_at: i64,
    recommended_proposal_id: Option<String>,
    proposals: Vec<DoctolibLabProposalView>,
    note: String,
}

#[derive(Debug, Clone)]
struct PendingProposal {
    view: DoctolibLabProposalView,
    search_url: String,
}

#[derive(Default)]
pub struct DoctolibLabManager {
    pending: Mutex<HashMap<String, PendingProposal>>,
    booking_in_progress: AtomicBool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerProbeResponse {
    ready: bool,
    chrome_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerProvider {
    practitioner_name: String,
    specialty: String,
    address: String,
    sector: String,
    visit_motive: String,
    accepts_new_patients: bool,
    source_url: String,
    search_url: String,
    slots: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerSearchResponse {
    providers: Vec<WorkerProvider>,
    search_url: String,
    note: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctolibLabConnectResponse {
    connected: bool,
    message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerConfirmationResponse {
    status: String,
    verified: bool,
    message: String,
    verification_code: Option<String>,
    source_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerCalendarResponse {
    status: String,
    added: bool,
    message: String,
    event_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DoctolibLabConfirmationView {
    proposal_id: String,
    status: String,
    verified: bool,
    message: String,
    verification_code: Option<String>,
    source_url: String,
    google_calendar_status: String,
    google_calendar_added: bool,
    google_calendar_message: String,
    google_calendar_event_url: Option<String>,
}

impl DoctolibLabManager {
    fn register(
        &self,
        mode: DoctolibLabMode,
        mut providers: Vec<WorkerProvider>,
        note: String,
    ) -> Result<DoctolibLabSearchResponse, String> {
        let now = Utc::now().timestamp();
        let expires_at = now + PROPOSAL_TTL_SECONDS;
        let mut candidates = providers
            .drain(..)
            .flat_map(|provider| {
                let slots = provider.slots.into_iter().take(3).collect::<Vec<_>>();
                slots.into_iter().map(move |starts_at| {
                    let id = Uuid::new_v4().to_string();
                    PendingProposal {
                        view: DoctolibLabProposalView {
                            id,
                            mode,
                            practitioner_name: provider.practitioner_name.clone(),
                            specialty: provider.specialty.clone(),
                            address: provider.address.clone(),
                            sector: provider.sector.clone(),
                            visit_motive: provider.visit_motive.clone(),
                            starts_at,
                            source_url: provider.source_url.clone(),
                            accepts_new_patients: provider.accepts_new_patients,
                            expires_at,
                        },
                        search_url: provider.search_url.clone(),
                    }
                })
            })
            .filter(|proposal| valid_future_slot(&proposal.view.starts_at))
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| left.view.starts_at.cmp(&right.view.starts_at));
        candidates.truncate(MAX_PROPOSALS);

        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "État RDV Lab verrouillé".to_string())?;
        pending.retain(|_, proposal| proposal.view.expires_at > now);
        let proposals = candidates
            .into_iter()
            .map(|proposal| {
                let view = proposal.view.clone();
                pending.insert(view.id.clone(), proposal);
                view
            })
            .collect::<Vec<_>>();
        let recommended_proposal_id = proposals.first().map(|proposal| proposal.id.clone());
        Ok(DoctolibLabSearchResponse {
            mode,
            generated_at: now,
            recommended_proposal_id,
            proposals,
            note,
        })
    }

    fn take(&self, proposal_id: &str) -> Result<PendingProposal, String> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| "État RDV Lab verrouillé".to_string())?;
        let proposal = pending.remove(proposal_id).ok_or_else(|| {
            "Cette proposition est inconnue, expirée ou a déjà été utilisée. Relancez la recherche."
                .to_string()
        })?;
        if proposal.view.expires_at <= Utc::now().timestamp() {
            return Err("Cette proposition a expiré. Relancez la recherche.".to_string());
        }
        validate_proposal(&proposal)?;
        Ok(proposal)
    }
}

fn valid_future_slot(value: &str) -> bool {
    DateTime::parse_from_rfc3339(value)
        .map(|date| {
            let now = Utc::now();
            date.with_timezone(&Utc) > now - Duration::minutes(2)
                && date.with_timezone(&Utc) < now + Duration::days(90)
        })
        .unwrap_or(false)
}

fn validate_proposal(proposal: &PendingProposal) -> Result<(), String> {
    if !valid_future_slot(&proposal.view.starts_at) {
        return Err("Le créneau n'est plus valide. Relancez la recherche.".to_string());
    }
    for url in [&proposal.view.source_url, &proposal.search_url] {
        if !url.starts_with("https://www.doctolib.fr/") {
            return Err("La proposition ne pointe pas vers Doctolib France.".to_string());
        }
    }
    if proposal.view.practitioner_name.trim().is_empty() {
        return Err("La proposition ne contient aucun soignant.".to_string());
    }
    Ok(())
}

fn demo_providers(location: &str) -> Vec<WorkerProvider> {
    let base = Utc::now() + Duration::days(1);
    let slot = |days: i64, hour: u32, minute: u32| {
        (base + Duration::days(days))
            .date_naive()
            .and_hms_opt(hour, minute, 0)
            .expect("heure de démonstration valide")
            .and_utc()
            .to_rfc3339()
    };
    let address_city = if location.trim().is_empty() {
        "Paris"
    } else {
        location.trim()
    };
    let search_url = format!(
        "https://www.doctolib.fr/medecin-generaliste/{}",
        simple_slug(address_city)
    );
    vec![
        WorkerProvider {
            practitioner_name: "Dr Camille Martin (démo)".to_string(),
            specialty: "Médecin généraliste".to_string(),
            address: format!("12 rue du Laboratoire, {address_city}"),
            sector: "Secteur 1".to_string(),
            visit_motive: "Première consultation de médecine générale".to_string(),
            accepts_new_patients: true,
            source_url: search_url.clone(),
            search_url: search_url.clone(),
            slots: vec![slot(0, 9, 30), slot(0, 14, 0)],
        },
        WorkerProvider {
            practitioner_name: "Dr Alex Bernard (démo)".to_string(),
            specialty: "Médecin généraliste".to_string(),
            address: format!("8 avenue du Prototype, {address_city}"),
            sector: "Secteur 2".to_string(),
            visit_motive: "Consultation de médecine générale".to_string(),
            accepts_new_patients: true,
            source_url: search_url.clone(),
            search_url,
            slots: vec![slot(1, 11, 15), slot(2, 16, 45)],
        },
    ]
}

fn simple_slug(value: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in value.chars() {
        if character.is_ascii_alphanumeric() {
            if separator && !slug.is_empty() {
                slug.push('-');
            }
            slug.push(character.to_ascii_lowercase());
            separator = false;
        } else {
            separator = true;
        }
    }
    if slug.is_empty() {
        "paris".to_string()
    } else {
        slug
    }
}

fn profile_dir() -> Result<PathBuf, String> {
    let path = crate::settings::runtime_data_path("doctolib-lab-profile")?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Profil navigateur RDV Lab impossible à créer : {error}"))?;
    Ok(path)
}

fn google_calendar_profile_dir() -> Result<PathBuf, String> {
    let path = crate::settings::runtime_data_path("google-calendar-profile")?;
    fs::create_dir_all(&path)
        .map_err(|error| format!("Profil Google Calendar impossible à créer : {error}"))?;
    Ok(path)
}

fn worker_path() -> Option<PathBuf> {
    if let Some(path) = env::var_os("CST_DOCTOLIB_LAB_WORKER") {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(current) = env::current_dir() {
        candidates.push(current.join("scripts").join("doctolib-lab-worker.mjs"));
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    if let Some(root) = manifest.parent() {
        candidates.push(root.join("scripts").join("doctolib-lab-worker.mjs"));
    }
    if let Ok(executable) = env::current_exe() {
        if let Some(parent) = executable.parent() {
            candidates.push(
                parent
                    .join("resources")
                    .join("scripts")
                    .join("doctolib-lab-worker.mjs"),
            );
            candidates.push(parent.join("scripts").join("doctolib-lab-worker.mjs"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.is_file())
}

fn node_binary() -> String {
    env::var("CST_NODE_BINARY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "node".to_string())
}

#[cfg(windows)]
fn hide_process_window(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}

#[cfg(not(windows))]
fn hide_process_window(_command: &mut Command) {}

fn node_is_ready() -> bool {
    let mut command = Command::new(node_binary());
    command
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    hide_process_window(&mut command);
    command
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

fn compact_error(value: impl AsRef<str>) -> String {
    value.as_ref().chars().take(2_000).collect::<String>()
}

fn run_worker<T: DeserializeOwned>(request: Value) -> Result<T, String> {
    let worker = worker_path().ok_or_else(|| {
        "Worker RDV Lab introuvable. Lancez l'application depuis le dossier du projet.".to_string()
    })?;
    let mut command = Command::new(node_binary());
    command
        .arg(&worker)
        .current_dir(
            worker
                .parent()
                .and_then(Path::parent)
                .unwrap_or_else(|| Path::new(".")),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hide_process_window(&mut command);
    let mut child = command
        .spawn()
        .map_err(|error| format!("Impossible de lancer le worker RDV Lab : {error}"))?;
    let payload = serde_json::to_vec(&request)
        .map_err(|error| format!("Requête RDV Lab invalide : {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "Entrée du worker RDV Lab indisponible".to_string())?
        .write_all(&payload)
        .map_err(|error| format!("Envoi au worker RDV Lab impossible : {error}"))?;
    let output = child
        .wait_with_output()
        .map_err(|error| format!("Worker RDV Lab interrompu : {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Worker RDV Lab : {}", compact_error(stderr.trim())));
    }
    serde_json::from_slice::<T>(&output.stdout).map_err(|error| {
        format!(
            "Réponse du worker RDV Lab illisible ({error}) : {}",
            compact_error(String::from_utf8_lossy(&output.stdout).trim())
        )
    })
}

async fn blocking<T>(task: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String>
where
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| format!("Tâche RDV Lab interrompue : {error}"))?
}

/// Contrat partagé par la commande Tauri et l'API HTTP du serveur : le worker
/// s'exécute toujours sur la machine qui héberge le runtime appelé.
pub async fn status() -> Result<DoctolibLabStatus, String> {
    let profile = profile_dir().ok();
    let google_profile = google_calendar_profile_dir().ok();
    blocking(move || {
        let node_ready = node_is_ready();
        let worker_ready = worker_path().is_some();
        let probe = if node_ready && worker_ready {
            run_worker::<WorkerProbeResponse>(json!({ "action": "probe" })).ok()
        } else {
            None
        };
        let chrome_ready = probe.as_ref().map(|value| value.ready).unwrap_or(false);
        let live_ready = node_ready && worker_ready && chrome_ready;
        let session = if live_ready {
            profile.as_ref().and_then(|profile| {
                run_worker::<DoctolibLabConnectResponse>(json!({
                    "action": "session",
                    "profileDir": profile,
                }))
                .ok()
            })
        } else {
            None
        };
        let connected = session.as_ref().map(|value| value.connected);
        let google_session = if live_ready {
            google_profile.as_ref().and_then(|profile| {
                run_worker::<DoctolibLabConnectResponse>(json!({
                    "action": "calendar_session",
                    "profileDir": profile,
                }))
                .ok()
            })
        } else {
            None
        };
        let google_calendar_connected = google_session.as_ref().map(|value| value.connected);
        let detail = if live_ready {
            let chrome = probe
                .and_then(|value| value.chrome_path)
                .unwrap_or_else(|| "Chrome".to_string());
            let account = session
                .as_ref()
                .map(|value| value.message.clone())
                .unwrap_or_else(|| "État de la session Doctolib inconnu.".to_string());
            let calendar = google_session
                .as_ref()
                .map(|value| value.message.clone())
                .unwrap_or_else(|| "État de Google Calendar inconnu.".to_string());
            format!("{chrome} prêt. {account} {calendar}")
        } else {
            let missing = [
                (!node_ready).then_some("Node"),
                (!worker_ready).then_some("worker"),
                (!chrome_ready).then_some("Chrome"),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", ");
            format!("Composants manquants : {missing}")
        };
        Ok(DoctolibLabStatus {
            demo_ready: true,
            live_ready,
            node_ready,
            worker_ready,
            chrome_ready,
            connected,
            google_calendar_ready: live_ready,
            google_calendar_connected,
            detail,
        })
    })
    .await
}

pub async fn connect() -> Result<DoctolibLabConnectResponse, String> {
    let profile = profile_dir()?;
    blocking(move || {
        run_worker(json!({
            "action": "connect",
            "profileDir": profile,
        }))
    })
    .await
}

pub async fn connect_google_calendar() -> Result<DoctolibLabConnectResponse, String> {
    let profile = google_calendar_profile_dir()?;
    blocking(move || {
        run_worker(json!({
            "action": "calendar_connect",
            "profileDir": profile,
        }))
    })
    .await
}

pub async fn search(
    state: &DoctolibLabManager,
    request: DoctolibLabSearchRequest,
) -> Result<DoctolibLabSearchResponse, String> {
    let specialty = request.specialty.trim();
    let location = request.location.trim();
    if specialty.is_empty() || location.is_empty() {
        return Err("La spécialité et la ville sont obligatoires.".to_string());
    }
    if request.mode == DoctolibLabMode::Demo {
        return state.register(
            DoctolibLabMode::Demo,
            demo_providers(location),
            "Données fictives : vous pouvez tester le clic « Oui » sans créer de rendez-vous réel."
                .to_string(),
        );
    }

    let profile = profile_dir()?;
    let specialty = specialty.to_string();
    let location = location.to_string();
    let worker = blocking(move || {
        run_worker::<WorkerSearchResponse>(json!({
            "action": "search",
            "profileDir": profile,
            "specialty": specialty,
            "location": location,
        }))
    })
    .await?;
    let providers = worker
        .providers
        .into_iter()
        .map(|mut provider| {
            if provider.search_url.trim().is_empty() {
                provider.search_url = worker.search_url.clone();
            }
            provider
        })
        .collect();
    state.register(DoctolibLabMode::Live, providers, worker.note)
}

pub async fn confirm(
    state: &DoctolibLabManager,
    proposal_id: String,
    add_to_google_calendar: bool,
) -> Result<DoctolibLabConfirmationView, String> {
    if state
        .booking_in_progress
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("Une réservation RDV Lab est déjà en cours.".to_string());
    }

    let proposal = match state.take(proposal_id.trim()) {
        Ok(proposal) => proposal,
        Err(error) => {
            state.booking_in_progress.store(false, Ordering::Release);
            return Err(error);
        }
    };
    let view = proposal.view.clone();
    let id = view.id.clone();
    let mut result = if view.mode == DoctolibLabMode::Demo {
        Ok(DoctolibLabConfirmationView {
            proposal_id: id.clone(),
            status: "confirmed".to_string(),
            verified: true,
            message: format!(
                "Simulation réussie : le rendez-vous avec {} est enregistré et relu dans le bac à sable.",
                view.practitioner_name
            ),
            verification_code: Some(format!("LAB-{}", &id[..8].to_uppercase())),
            source_url: view.source_url.clone(),
            google_calendar_status: "skipped".to_string(),
            google_calendar_added: false,
            google_calendar_message: "Le bac à sable ne crée aucun événement Google Calendar."
                .to_string(),
            google_calendar_event_url: None,
        })
    } else {
        let profile = profile_dir();
        match profile {
            Err(error) => Err(error),
            Ok(profile) => {
                let request = json!({
                    "action": "confirm",
                    "profileDir": profile,
                    "practitionerName": view.practitioner_name.clone(),
                    "startsAt": view.starts_at.clone(),
                    "sourceUrl": view.source_url.clone(),
                    "searchUrl": proposal.search_url,
                });
                blocking(move || run_worker::<WorkerConfirmationResponse>(request))
                    .await
                    .map(|worker| DoctolibLabConfirmationView {
                        proposal_id: id,
                        status: worker.status,
                        verified: worker.verified,
                        message: worker.message,
                        verification_code: worker.verification_code,
                        source_url: worker.source_url,
                        google_calendar_status: "pending".to_string(),
                        google_calendar_added: false,
                        google_calendar_message: "En attente de la confirmation Doctolib."
                            .to_string(),
                        google_calendar_event_url: None,
                    })
            }
        }
    };

    if let Ok(confirmation) = result.as_mut() {
        if confirmation.verified && add_to_google_calendar && view.mode == DoctolibLabMode::Live {
            let calendar_result = match google_calendar_profile_dir() {
                Err(error) => Err(error),
                Ok(profile) => {
                    let request = json!({
                        "action": "calendar_add",
                        "profileDir": profile,
                        "summary": format!("Rendez-vous médical — {}", view.practitioner_name),
                        "practitionerName": view.practitioner_name,
                        "startsAt": view.starts_at,
                        "durationMinutes": 30,
                        "location": view.address,
                        "description": format!(
                            "Rendez-vous Doctolib. Motif : {}. Lien : {}",
                            view.visit_motive, view.source_url
                        ),
                    });
                    blocking(move || run_worker::<WorkerCalendarResponse>(request)).await
                }
            };
            match calendar_result {
                Ok(calendar) => {
                    confirmation.google_calendar_status = calendar.status;
                    confirmation.google_calendar_added = calendar.added;
                    confirmation.google_calendar_message = calendar.message;
                    confirmation.google_calendar_event_url = calendar.event_url;
                }
                Err(error) => {
                    confirmation.google_calendar_status = "failed".to_string();
                    confirmation.google_calendar_message = format!(
                        "Le rendez-vous Doctolib est confirmé, mais Google Calendar a échoué : {error}"
                    );
                }
            }
        } else if confirmation.verified {
            confirmation.google_calendar_status = "skipped".to_string();
            confirmation.google_calendar_message = if add_to_google_calendar {
                "Aucun événement réel n’est ajouté depuis le bac à sable.".to_string()
            } else {
                "Ajout Google Calendar désactivé par l’utilisateur.".to_string()
            };
        } else {
            confirmation.google_calendar_status = "skipped".to_string();
            confirmation.google_calendar_message =
                "Google Calendar attend une confirmation Doctolib vérifiée.".to_string();
        }
    }
    state.booking_in_progress.store(false, Ordering::Release);
    result
}

#[tauri::command]
pub async fn doctolib_lab_status() -> Result<DoctolibLabStatus, String> {
    status().await
}

#[tauri::command]
pub async fn doctolib_lab_connect() -> Result<DoctolibLabConnectResponse, String> {
    connect().await
}

#[tauri::command]
pub async fn doctolib_lab_google_calendar_connect() -> Result<DoctolibLabConnectResponse, String> {
    connect_google_calendar().await
}

#[tauri::command]
pub async fn doctolib_lab_search(
    state: tauri::State<'_, DoctolibLabManager>,
    request: DoctolibLabSearchRequest,
) -> Result<DoctolibLabSearchResponse, String> {
    search(&state, request).await
}

#[tauri::command]
pub async fn doctolib_lab_confirm(
    state: tauri::State<'_, DoctolibLabManager>,
    proposal_id: String,
    add_to_google_calendar: bool,
) -> Result<DoctolibLabConfirmationView, String> {
    confirm(&state, proposal_id, add_to_google_calendar).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn demo_creates_sorted_one_time_proposals() {
        let manager = DoctolibLabManager::default();
        let response = manager
            .register(
                DoctolibLabMode::Demo,
                demo_providers("Paris"),
                "test".to_string(),
            )
            .expect("propositions de démonstration");
        assert_eq!(response.proposals.len(), 4);
        assert_eq!(
            response.recommended_proposal_id.as_deref(),
            response
                .proposals
                .first()
                .map(|proposal| proposal.id.as_str())
        );
        assert!(response
            .proposals
            .windows(2)
            .all(|pair| pair[0].starts_at <= pair[1].starts_at));

        let id = response.proposals[0].id.clone();
        assert!(manager.take(&id).is_ok());
        assert!(manager.take(&id).is_err());
    }

    #[test]
    fn external_urls_are_refused() {
        let proposal = PendingProposal {
            view: DoctolibLabProposalView {
                id: "test".to_string(),
                mode: DoctolibLabMode::Live,
                practitioner_name: "Dr Test".to_string(),
                specialty: "Médecin généraliste".to_string(),
                address: "Paris".to_string(),
                sector: "Secteur 1".to_string(),
                visit_motive: "Consultation".to_string(),
                starts_at: (Utc::now() + Duration::days(1)).to_rfc3339(),
                source_url: "https://example.com/slot".to_string(),
                accepts_new_patients: true,
                expires_at: Utc::now().timestamp() + 60,
            },
            search_url: "https://www.doctolib.fr/medecin-generaliste/paris".to_string(),
        };
        assert!(validate_proposal(&proposal).is_err());
    }
}
