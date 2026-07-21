import { invoke } from "./platform";
import { accountScopedStorage } from "./account-storage";
import "./video.css";

export type VideoGenerationMode = "text" | "image";
export type VideoGenerationStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type VideoModel = {
  id: string;
  label: string;
  maker: string;
  description: string;
  quality: string;
  supportsImage: boolean;
  supportsAudio: boolean;
  aspectRatios: string[];
  durations: number[];
  resolutions: string[];
  defaultAspectRatio: string;
  defaultDuration: number;
  defaultResolution: string;
};

export type VideoGenerationCapabilities = {
  configured: boolean;
  service: string;
  configurationHint: string;
  maxImageBytes: number;
  models: VideoModel[];
};

export type CreativeAccount = {
  id: string;
  provider: "fal" | string;
  label: string;
  keyHint: string;
  isDefault: boolean;
  source: "stored" | "environment" | string;
  createdAt: number | null;
};

export type CreativeAccountsView = {
  accounts: CreativeAccount[];
  defaultAccountId: string | null;
  provider: string;
  dashboardUrl: string;
  authenticationNote: string;
};

export type ImageStyle = { id: string; label: string };

export type ImageModel = {
  id: string;
  label: string;
  maker: string;
  description: string;
  quality: string;
  imageSizes: string[];
  styles: ImageStyle[];
  maxImages: number;
  supportsNegativePrompt: boolean;
  defaultImageSize: string;
  defaultStyle: string;
};

export type ImageGenerationCapabilities = {
  configured: boolean;
  service: string;
  configurationHint: string;
  models: ImageModel[];
};

type VideoBackendJob = {
  accountId: string;
  requestId: string;
  modelId: string;
  mode: VideoGenerationMode;
  status: VideoGenerationStatus;
  queuePosition: number | null;
  logs: string[];
  videoUrl: string | null;
  actualPrompt: string | null;
  seed: number | null;
  inferenceSeconds: number | null;
  error: string | null;
};

type GeneratedImage = {
  url: string;
  width: number | null;
  height: number | null;
  contentType: string | null;
  fileName: string | null;
};

type ImageBackendJob = {
  accountId: string;
  requestId: string;
  modelId: string;
  status: VideoGenerationStatus;
  queuePosition: number | null;
  logs: string[];
  images: GeneratedImage[];
  seed: number | null;
  inferenceSeconds: number | null;
  error: string | null;
};

export type VideoGenerationRecord = VideoBackendJob & {
  localId: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  generateAudio: boolean;
  imageName: string | null;
  createdAt: number;
  updatedAt: number;
  trackingError: string | null;
};

export type ImageGenerationRecord = ImageBackendJob & {
  localId: string;
  prompt: string;
  negativePrompt: string;
  imageSize: string;
  style: string;
  numImages: number;
  createdAt: number;
  updatedAt: number;
  trackingError: string | null;
};

type VideoDraft = {
  mode: VideoGenerationMode;
  modelId: string;
  prompt: string;
  negativePrompt: string;
  aspectRatio: string;
  duration: number;
  resolution: string;
  generateAudio: boolean;
  imageUrl: string;
  imageName: string;
};

type ImageDraft = {
  modelId: string;
  prompt: string;
  negativePrompt: string;
  imageSize: string;
  style: string;
  numImages: number;
};

type RenderIcons = (root: ParentNode) => void;

export const VIDEO_HISTORY_STORAGE_KEY = "codex-switch-terminal.video-generations.v1";
export const VIDEO_HISTORY_LIMIT = 16;
export const IMAGE_HISTORY_STORAGE_KEY = "codex-switch-terminal.image-generations.v1";
export const IMAGE_HISTORY_LIMIT = 20;
const DEFAULT_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const POLL_DELAY_MS = 4_000;

const draft: VideoDraft = {
  mode: "text",
  modelId: "wan-2.6",
  prompt: "",
  negativePrompt: "texte illisible, filigrane, scintillement, déformation",
  aspectRatio: "16:9",
  duration: 5,
  resolution: "720p",
  generateAudio: false,
  imageUrl: "",
  imageName: "",
};

const imageDraft: ImageDraft = {
  modelId: "flux-2-flash",
  prompt: "",
  negativePrompt: "",
  imageSize: "square_hd",
  style: "auto",
  numImages: 1,
};

let capabilities: VideoGenerationCapabilities | null = null;
let imageCapabilities: ImageGenerationCapabilities | null = null;
let creativeAccounts: CreativeAccountsView | null = null;
let selectedAccountId = "";
let creativeKind: "video" | "image" = "video";
let capabilitiesLoading = false;
let capabilitiesError = "";
let submitError = "";
let submitting = false;
let advancedOpen = false;
let imageAdvancedOpen = false;
let accountManagerOpen = false;
let accountSaving = false;
let accountError = "";
let panelActive = false;
let jobs = loadVideoHistory();
let selectedJobId: string | null = jobs[0]?.localId ?? null;
let imageJobs = loadImageHistory();
let selectedImageJobId: string | null = imageJobs[0]?.localId ?? null;
let pollTimer: number | null = null;
let imagePollTimer: number | null = null;
let pollInFlight = false;
let imagePollInFlight = false;
let rerenderApp: (() => void) | null = null;
let renderIcons: RenderIcons | null = null;
const cancellingIds = new Set<string>();
const cancellingImageIds = new Set<string>();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const cleanString = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const finiteNumber = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const normalizeStatus = (value: unknown): VideoGenerationStatus | null =>
  value === "queued"
    || value === "in_progress"
    || value === "completed"
    || value === "failed"
    || value === "cancelled"
    ? value
    : null;

export const normalizeVideoHistory = (value: unknown): VideoGenerationRecord[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: VideoGenerationRecord[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const localId = cleanString(candidate.localId, 180);
    const requestId = cleanString(candidate.requestId, 180);
    const modelId = cleanString(candidate.modelId, 80);
    const status = normalizeStatus(candidate.status);
    const mode = candidate.mode === "image" ? "image" : candidate.mode === "text" ? "text" : null;
    const prompt = cleanString(candidate.prompt, 1_500);
    if (!localId || !requestId || !modelId || !status || !mode || !prompt || seen.has(localId)) {
      continue;
    }
    seen.add(localId);
    const videoUrl = cleanString(candidate.videoUrl, 8_192);
    const createdAt = finiteNumber(candidate.createdAt, Date.now());
    normalized.push({
      localId,
      accountId: cleanString(candidate.accountId, 180),
      requestId,
      modelId,
      mode,
      status,
      prompt,
      negativePrompt: cleanString(candidate.negativePrompt, 500),
      aspectRatio: cleanString(candidate.aspectRatio, 16) || "16:9",
      duration: Math.max(1, Math.floor(finiteNumber(candidate.duration, 5))),
      resolution: cleanString(candidate.resolution, 24) || "720p",
      generateAudio: candidate.generateAudio === true,
      imageName: cleanString(candidate.imageName, 240) || null,
      createdAt,
      updatedAt: finiteNumber(candidate.updatedAt, createdAt),
      queuePosition: typeof candidate.queuePosition === "number" ? candidate.queuePosition : null,
      logs: Array.isArray(candidate.logs)
        ? candidate.logs.map((line) => cleanString(line, 600)).filter(Boolean).slice(0, 24)
        : [],
      videoUrl: videoUrl.startsWith("https://") ? videoUrl : null,
      actualPrompt: cleanString(candidate.actualPrompt, 3_000) || null,
      seed: typeof candidate.seed === "number" ? candidate.seed : null,
      inferenceSeconds: typeof candidate.inferenceSeconds === "number"
        ? candidate.inferenceSeconds
        : null,
      error: cleanString(candidate.error, 2_000) || null,
      trackingError: cleanString(candidate.trackingError, 2_000) || null,
    });
    if (normalized.length >= VIDEO_HISTORY_LIMIT) break;
  }
  return normalized.sort((a, b) => b.createdAt - a.createdAt);
};

const normalizeGeneratedImages = (value: unknown): GeneratedImage[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate): GeneratedImage[] => {
    if (!isRecord(candidate)) return [];
    const url = cleanString(candidate.url, 8_192);
    if (!url.startsWith("https://")) return [];
    return [{
      url,
      width: typeof candidate.width === "number" ? candidate.width : null,
      height: typeof candidate.height === "number" ? candidate.height : null,
      contentType: cleanString(candidate.contentType, 120) || null,
      fileName: cleanString(candidate.fileName, 240) || null,
    }];
  }).slice(0, 4);
};

export const normalizeImageHistory = (value: unknown): ImageGenerationRecord[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: ImageGenerationRecord[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    const localId = cleanString(candidate.localId, 180);
    const requestId = cleanString(candidate.requestId, 180);
    const modelId = cleanString(candidate.modelId, 80);
    const status = normalizeStatus(candidate.status);
    const prompt = cleanString(candidate.prompt, 1_500);
    if (!localId || !requestId || !modelId || !status || !prompt || seen.has(localId)) continue;
    seen.add(localId);
    const createdAt = finiteNumber(candidate.createdAt, Date.now());
    normalized.push({
      localId,
      accountId: cleanString(candidate.accountId, 180),
      requestId,
      modelId,
      status,
      prompt,
      negativePrompt: cleanString(candidate.negativePrompt, 500),
      imageSize: cleanString(candidate.imageSize, 32) || "square_hd",
      style: cleanString(candidate.style, 80) || "auto",
      numImages: Math.max(1, Math.min(4, Math.floor(finiteNumber(candidate.numImages, 1)))),
      createdAt,
      updatedAt: finiteNumber(candidate.updatedAt, createdAt),
      queuePosition: typeof candidate.queuePosition === "number" ? candidate.queuePosition : null,
      logs: Array.isArray(candidate.logs)
        ? candidate.logs.map((line) => cleanString(line, 600)).filter(Boolean).slice(0, 24)
        : [],
      images: normalizeGeneratedImages(candidate.images),
      seed: typeof candidate.seed === "number" ? candidate.seed : null,
      inferenceSeconds: typeof candidate.inferenceSeconds === "number"
        ? candidate.inferenceSeconds
        : null,
      error: cleanString(candidate.error, 2_000) || null,
      trackingError: cleanString(candidate.trackingError, 2_000) || null,
    });
    if (normalized.length >= IMAGE_HISTORY_LIMIT) break;
  }
  return normalized.sort((a, b) => b.createdAt - a.createdAt);
};

export function loadImageHistory(
  storage: Pick<Storage, "getItem"> | null = browserStorage(),
): ImageGenerationRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(IMAGE_HISTORY_STORAGE_KEY);
    return raw ? normalizeImageHistory(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function persistImageHistory(
  records: readonly ImageGenerationRecord[],
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      IMAGE_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeImageHistory(records).slice(0, IMAGE_HISTORY_LIMIT)),
    );
    return true;
  } catch {
    return false;
  }
}

export function loadVideoHistory(storage: Pick<Storage, "getItem"> | null = browserStorage()): VideoGenerationRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(VIDEO_HISTORY_STORAGE_KEY);
    return raw ? normalizeVideoHistory(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function persistVideoHistory(
  records: readonly VideoGenerationRecord[],
  storage: Pick<Storage, "setItem"> | null = browserStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(
      VIDEO_HISTORY_STORAGE_KEY,
      JSON.stringify(normalizeVideoHistory(records).slice(0, VIDEO_HISTORY_LIMIT)),
    );
    return true;
  } catch {
    return false;
  }
}

function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  return typeof window === "undefined" ? null : accountScopedStorage;
}

const selectedModel = (): VideoModel | null =>
  capabilities?.models.find((model) => model.id === draft.modelId)
  ?? capabilities?.models[0]
  ?? null;

const modelById = (id: string): VideoModel | null =>
  capabilities?.models.find((model) => model.id === id) ?? null;

const selectedImageModel = (): ImageModel | null =>
  imageCapabilities?.models.find((model) => model.id === imageDraft.modelId)
  ?? imageCapabilities?.models[0]
  ?? null;

const imageModelById = (id: string): ImageModel | null =>
  imageCapabilities?.models.find((model) => model.id === id) ?? null;

const selectedAccount = (): CreativeAccount | null =>
  creativeAccounts?.accounts.find((account) => account.id === selectedAccountId)
  ?? creativeAccounts?.accounts.find((account) => account.isDefault)
  ?? creativeAccounts?.accounts[0]
  ?? null;

const imageDefinesAspectRatio = (modelId: string, mode: VideoGenerationMode): boolean =>
  mode === "image" && (modelId === "wan-2.6" || modelId === "kling-3-standard");

const activeStatuses = new Set<VideoGenerationStatus>(["queued", "in_progress"]);
const activeJobs = (): VideoGenerationRecord[] => jobs.filter((job) => activeStatuses.has(job.status));
const activeImageJobs = (): ImageGenerationRecord[] =>
  imageJobs.filter((job) => activeStatuses.has(job.status));

const statusLabel = (status: VideoGenerationStatus): string => {
  if (status === "queued") return "Dans la file";
  if (status === "in_progress") return "Génération";
  if (status === "completed") return "Terminée";
  if (status === "cancelled") return "Annulée";
  return "Échec";
};

const statusIcon = (status: VideoGenerationStatus): string => {
  if (status === "queued") return "clock-3";
  if (status === "in_progress") return "loader-circle";
  if (status === "completed") return "check";
  if (status === "cancelled") return "x";
  return "circle-alert";
};

const formatDate = (timestamp: number): string =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));

const formatBytes = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} Mo`;

const modelOptions = (): string => (capabilities?.models ?? []).map((model) => `
  <label class="video-model-card ${model.id === draft.modelId ? "is-selected" : ""}">
    <input type="radio" name="videoModel" value="${escapeHtml(model.id)}" ${model.id === draft.modelId ? "checked" : ""} ${submitting ? "disabled" : ""} />
    <span class="video-model-mark"><i data-lucide="${model.id.includes("veo") ? "sparkles" : model.id.includes("kling") ? "film" : model.id.includes("luma") ? "orbit" : "wand-sparkles"}"></i></span>
    <span class="video-model-copy">
      <span><strong>${escapeHtml(model.label)}</strong><b>${escapeHtml(model.quality)}</b></span>
      <small>${escapeHtml(model.maker)} · ${escapeHtml(model.description)}</small>
    </span>
  </label>`).join("");

const optionTags = (values: readonly (string | number)[], selected: string | number, suffix = ""): string =>
  values.map((value) => `<option value="${escapeHtml(value)}" ${String(value) === String(selected) ? "selected" : ""}>${escapeHtml(value)}${suffix}</option>`).join("");

const renderImageInput = (): string => {
  if (draft.mode !== "image") return "";
  const hasImage = draft.imageUrl.startsWith("data:image/") || draft.imageUrl.startsWith("https://");
  return `
    <section class="video-reference-block" aria-labelledby="videoReferenceTitle">
      <div class="video-section-title">
        <span><i data-lucide="image"></i></span>
        <div><h3 id="videoReferenceTitle">Image de départ</h3><p>Elle devient la première image du plan.</p></div>
      </div>
      ${hasImage
        ? `<div class="video-reference-preview">
            <img src="${escapeHtml(draft.imageUrl)}" alt="Aperçu de l’image de départ" />
            <span><strong>${escapeHtml(draft.imageName || "Image distante")}</strong><small>Prête à être animée</small></span>
            <button type="button" id="videoImageRemove" aria-label="Retirer l’image"><i data-lucide="x"></i></button>
          </div>`
        : `<label id="videoDropzone" class="video-dropzone" for="videoImageFile">
            <input id="videoImageFile" type="file" accept="image/jpeg,image/png,image/webp,image/bmp" ${submitting ? "disabled" : ""} />
            <span><i data-lucide="upload"></i></span>
            <strong>Dépose une image ici</strong>
            <small>JPEG, PNG, WebP ou BMP · ${formatBytes(capabilities?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES)} max.</small>
          </label>`}
      <label class="video-url-field">
        <span>Ou colle une URL HTTPS publique</span>
        <input id="videoImageUrl" type="url" inputmode="url" placeholder="https://…/image.jpg" value="${draft.imageUrl.startsWith("https://") ? escapeHtml(draft.imageUrl) : ""}" ${submitting ? "disabled" : ""} />
      </label>
    </section>`;
};

const currentPreviewJob = (): VideoGenerationRecord | null =>
  jobs.find((job) => job.localId === selectedJobId)
  ?? activeJobs()[0]
  ?? jobs[0]
  ?? null;

const renderPreview = (): string => {
  const job = currentPreviewJob();
  if (!job) {
    return `<section class="video-preview-card is-empty" aria-label="Aperçu vidéo">
      <div class="video-empty-reel"><span></span><span></span><i data-lucide="play"></i></div>
      <strong>Ta prochaine scène apparaîtra ici</strong>
      <p>Décris le sujet, le mouvement, la caméra, la lumière et l’ambiance.</p>
    </section>`;
  }
  const model = modelById(job.modelId);
  if (job.status === "completed" && job.videoUrl) {
    const aspectLabel = imageDefinesAspectRatio(job.modelId, job.mode)
      ? "format de l’image source"
      : job.aspectRatio;
    return `<section class="video-preview-card has-result" aria-label="Vidéo générée">
      <div class="video-player-frame" style="aspect-ratio: ${escapeHtml(job.aspectRatio.replace(":", " / "))}">
        <video controls playsinline preload="metadata" src="${escapeHtml(job.videoUrl)}"></video>
      </div>
      <div class="video-result-meta">
        <span><strong>${escapeHtml(model?.label ?? job.modelId)}</strong><small>${job.duration} s · ${escapeHtml(job.resolution)} · ${escapeHtml(aspectLabel)}${job.generateAudio ? " · audio" : ""}</small></span>
        <a href="${escapeHtml(job.videoUrl)}" target="_blank" rel="noopener noreferrer" class="video-download-button"><i data-lucide="download"></i><span>Télécharger</span></a>
      </div>
      <p>${escapeHtml(job.prompt)}</p>
    </section>`;
  }
  if (activeStatuses.has(job.status)) {
    const latestLog = job.logs.at(-1);
    return `<section class="video-preview-card is-working" aria-live="polite">
      <div class="video-working-visual">
        <span class="video-working-orbit"><i data-lucide="sparkles"></i></span>
        <div class="video-working-bars"><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <span class="video-status-pill is-${job.status}"><i data-lucide="${statusIcon(job.status)}"></i>${statusLabel(job.status)}</span>
      <strong>${job.status === "queued" ? "La scène attend son moteur" : "La scène prend vie"}</strong>
      <p>${escapeHtml(latestLog || (job.queuePosition != null ? `${job.queuePosition} génération(s) devant la tienne` : "La génération vidéo peut prendre plusieurs minutes."))}</p>
      ${job.trackingError ? `<small class="video-tracking-warning"><i data-lucide="wifi-off"></i>${escapeHtml(job.trackingError)}</small>` : ""}
      <button type="button" class="video-cancel-button" data-video-cancel="${escapeHtml(job.localId)}" ${cancellingIds.has(job.localId) ? "disabled" : ""}><i data-lucide="square"></i><span>${cancellingIds.has(job.localId) ? "Annulation…" : "Annuler"}</span></button>
    </section>`;
  }
  return `<section class="video-preview-card is-error" role="status">
    <span><i data-lucide="${statusIcon(job.status)}"></i></span>
    <strong>${statusLabel(job.status)}</strong>
    <p>${escapeHtml(job.error || "Cette génération n’a pas produit de vidéo.")}</p>
    <button type="button" class="video-reuse-button" data-video-reuse="${escapeHtml(job.localId)}"><i data-lucide="rotate-ccw"></i><span>Réutiliser les réglages</span></button>
  </section>`;
};

const renderHistoryItem = (job: VideoGenerationRecord): string => {
  const selected = currentPreviewJob()?.localId === job.localId;
  const model = modelById(job.modelId);
  return `<article class="video-history-item is-${job.status} ${selected ? "is-selected" : ""}" data-video-select="${escapeHtml(job.localId)}" tabindex="0" role="button" aria-pressed="${selected}">
    <span class="video-history-thumb">
      ${job.status === "completed" && job.videoUrl
        ? `<video muted playsinline preload="metadata" src="${escapeHtml(job.videoUrl)}"></video>`
        : `<i data-lucide="${statusIcon(job.status)}"></i>`}
    </span>
    <span class="video-history-copy">
      <span><strong>${escapeHtml(model?.label ?? job.modelId)}</strong><b>${statusLabel(job.status)}</b></span>
      <small>${escapeHtml(job.prompt)}</small>
      <em>${formatDate(job.createdAt)} · ${job.duration} s · ${escapeHtml(job.aspectRatio)}</em>
    </span>
    <button type="button" data-video-remove="${escapeHtml(job.localId)}" aria-label="Retirer de l’historique"><i data-lucide="trash-2"></i></button>
  </article>`;
};

const renderStudioToolbar = (): string => {
  const account = selectedAccount();
  const accounts = creativeAccounts?.accounts ?? [];
  return `<section class="creative-toolbar" aria-label="Mode et compte du studio">
    <div class="creative-kind-switch" role="tablist" aria-label="Type de création">
      <button type="button" role="tab" data-creative-kind="video" class="${creativeKind === "video" ? "is-active" : ""}" aria-selected="${creativeKind === "video"}"><i data-lucide="clapperboard"></i><span>Vidéo</span></button>
      <button type="button" role="tab" data-creative-kind="image" class="${creativeKind === "image" ? "is-active" : ""}" aria-selected="${creativeKind === "image"}"><i data-lucide="image"></i><span>Image</span></button>
    </div>
    <div class="creative-account-picker">
      <label for="creativeAccountSelect"><span>Compte de génération</span>
        <select id="creativeAccountSelect" ${accounts.length ? "" : "disabled"}>
          ${accounts.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === account?.id ? "selected" : ""}>${escapeHtml(item.label)} · ${escapeHtml(item.keyHint)}</option>`).join("") || `<option>Aucun compte connecté</option>`}
        </select>
      </label>
      <button type="button" id="creativeAccountsOpen"><i data-lucide="key-round"></i><span>Gérer les comptes</span></button>
    </div>
  </section>`;
};

const renderAccountManager = (): string => {
  if (!accountManagerOpen) return "";
  const accounts = creativeAccounts?.accounts ?? [];
  const dashboardUrl = creativeAccounts?.dashboardUrl || "https://fal.ai/dashboard/keys";
  return `<div class="creative-account-overlay" role="presentation">
    <section class="creative-account-modal" role="dialog" aria-modal="true" aria-labelledby="creativeAccountsTitle">
      <header>
        <span><i data-lucide="key-round"></i><span><strong id="creativeAccountsTitle">Comptes de génération</strong><small>Clés personnelles ou d’équipe fal.ai</small></span></span>
        <button type="button" id="creativeAccountsClose" aria-label="Fermer"><i data-lucide="x"></i></button>
      </header>
      <p class="creative-auth-note">${escapeHtml(creativeAccounts?.authenticationNote || "Connecte une clé API fal.ai. Les identifiants natifs des plateformes ne sont jamais demandés.")}</p>
      ${accountError ? `<div class="creative-account-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(accountError)}</span></div>` : ""}
      <form id="creativeAccountForm" class="creative-account-form">
        <label><span>Nom du compte</span><input id="creativeAccountLabel" maxlength="60" required placeholder="Mon compte fal.ai" ${accountSaving ? "disabled" : ""} /></label>
        <label><span>Clé API fal.ai</span><input id="creativeAccountKey" type="password" maxlength="512" required autocomplete="off" spellcheck="false" placeholder="identifiant:secret" ${accountSaving ? "disabled" : ""} /></label>
        <label class="creative-default-check"><input id="creativeAccountDefault" type="checkbox" checked ${accountSaving ? "disabled" : ""} /><span>Utiliser par défaut</span></label>
        <button type="submit" ${accountSaving ? "disabled" : ""}><i data-lucide="${accountSaving ? "loader-circle" : "plug-zap"}"></i><span>${accountSaving ? "Vérification…" : "Connecter le compte"}</span></button>
      </form>
      <a class="creative-dashboard-link" href="${escapeHtml(dashboardUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="external-link"></i>Créer ou copier une clé sur fal.ai</a>
      <div class="creative-account-list">
        <h3>Comptes connectés <small>${accounts.length}/12</small></h3>
        ${accounts.map((item) => `<article>
          <span class="creative-account-icon"><i data-lucide="${item.source === "environment" ? "server" : "user-round"}"></i></span>
          <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.keyHint)}${item.isDefault ? " · par défaut" : ""}</small></span>
          <div>
            ${item.isDefault ? `<b>Actif</b>` : `<button type="button" data-creative-default="${escapeHtml(item.id)}" title="Définir par défaut"><i data-lucide="star"></i></button>`}
            ${item.source === "stored" ? `<button type="button" data-creative-delete="${escapeHtml(item.id)}" title="Déconnecter"><i data-lucide="trash-2"></i></button>` : ""}
          </div>
        </article>`).join("") || `<p>Aucun compte connecté. Ajoute une clé ci-dessus.</p>`}
      </div>
      <footer><i data-lucide="shield-check"></i><span>La clé reste côté backend. Elle n’est ni renvoyée à l’interface ni enregistrée dans le navigateur.</span></footer>
    </section>
  </div>`;
};

const renderSetupNotice = (): string => {
  if (capabilitiesLoading && !capabilities) {
    return `<div class="video-setup-notice is-loading" role="status"><i data-lucide="loader-circle"></i><span><strong>Connexion au studio…</strong><small>Vérification des comptes et moteurs disponibles.</small></span></div>`;
  }
  if (capabilitiesError) {
    return `<div class="video-setup-notice is-error" role="alert"><i data-lucide="circle-alert"></i><span><strong>Studio indisponible</strong><small>${escapeHtml(capabilitiesError)}</small></span><button type="button" id="videoCapabilitiesRefresh">Réessayer</button></div>`;
  }
  if (creativeAccounts && creativeAccounts.accounts.length === 0) {
    return `<div class="video-setup-notice is-config" role="status"><i data-lucide="key-round"></i><span><strong>Connecte un compte fal.ai</strong><small>Une seule clé personnelle ou d’équipe donne accès aux moteurs image et vidéo du studio.</small></span><button type="button" id="creativeAccountsOpenNotice">Ajouter un compte</button></div>`;
  }
  return "";
};

export const renderVideoPanel = (): string => {
  if (creativeKind === "image") return renderImageStudioPanel();
  const model = selectedModel();
  const account = selectedAccount();
  const canSubmit = capabilities?.configured === true && !!account && !!model && !submitting;
  const promptCount = [...draft.prompt].length;
  const sourceControlsAspect = model ? imageDefinesAspectRatio(model.id, draft.mode) : false;
  return `<section id="videoPanel" class="video-panel" aria-labelledby="videoPanelTitle">
    <header class="video-hero">
      <div class="video-hero-copy">
        <span class="video-eyebrow"><i data-lucide="wand-sparkles"></i>Studio IA génératif</span>
        <h1 id="videoPanelTitle">Imagine. Cadre. <em>Anime.</em></h1>
        <p>Génère des vidéos et des images avec plusieurs modèles, depuis le compte fal.ai de ton choix.</p>
      </div>
      <div class="video-provider-state ${account ? "is-ready" : ""}">
        <i></i><span><strong>${account ? escapeHtml(account.label) : "Compte requis"}</strong><small>${account ? escapeHtml(account.keyHint) : "via fal.ai"}</small></span>
      </div>
    </header>

    ${renderSetupNotice()}
    ${renderStudioToolbar()}
    ${submitError ? `<div class="video-submit-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(submitError)}</span><button type="button" id="videoErrorDismiss" aria-label="Fermer"><i data-lucide="x"></i></button></div>` : ""}

    <div class="video-studio-layout">
      <form id="videoGenerationForm" class="video-composer">
        <div class="video-mode-switch" role="radiogroup" aria-label="Type de génération">
          <button type="button" data-video-mode="text" class="${draft.mode === "text" ? "is-active" : ""}" aria-pressed="${draft.mode === "text"}"><i data-lucide="type"></i><span>Texte vers vidéo</span></button>
          <button type="button" data-video-mode="image" class="${draft.mode === "image" ? "is-active" : ""}" aria-pressed="${draft.mode === "image"}"><i data-lucide="image"></i><span>Image vers vidéo</span></button>
        </div>

        ${renderImageInput()}

        <label class="video-prompt-field">
          <span><strong>${draft.mode === "image" ? "Décris le mouvement" : "Décris ta scène"}</strong><small id="videoPromptCount">${promptCount}/1500</small></span>
          <textarea id="videoPrompt" maxlength="1500" required placeholder="${draft.mode === "image" ? "La caméra avance lentement, les cheveux bougent dans le vent…" : "Un plan drone cinématique traverse une ville futuriste sous la pluie…"}" ${submitting ? "disabled" : ""}>${escapeHtml(draft.prompt)}</textarea>
          <span class="video-prompt-hints"><i data-lucide="lightbulb"></i>Sujet · action · caméra · lumière · ambiance</span>
        </label>

        <fieldset class="video-model-picker" ${submitting ? "disabled" : ""}>
          <legend><span>Choisis le moteur</span><small>Chaque IA a sa signature</small></legend>
          <div>${modelOptions() || `<span class="video-model-skeleton"></span><span class="video-model-skeleton"></span>`}</div>
        </fieldset>

        ${model ? `<section class="video-controls" aria-label="Réglages vidéo">
          <label class="${sourceControlsAspect ? "is-source-controlled" : ""}"><span><i data-lucide="ratio"></i>Format</span><select id="videoAspectRatio" title="${sourceControlsAspect ? "Le format est déterminé par l’image de départ" : "Format de la vidéo"}" ${submitting || sourceControlsAspect ? "disabled" : ""}>${sourceControlsAspect ? `<option value="${escapeHtml(draft.aspectRatio)}">Image source</option>` : optionTags(model.aspectRatios, draft.aspectRatio)}</select></label>
          <label><span><i data-lucide="clock-3"></i>Durée</span><select id="videoDuration" ${submitting ? "disabled" : ""}>${optionTags(model.durations, draft.duration, " s")}</select></label>
          <label><span><i data-lucide="scan-line"></i>Qualité</span><select id="videoResolution" ${submitting ? "disabled" : ""}>${optionTags(model.resolutions, draft.resolution)}</select></label>
          <label class="video-audio-toggle ${model.supportsAudio ? "" : "is-disabled"}"><span><i data-lucide="volume-2"></i>Audio natif</span><input id="videoGenerateAudio" type="checkbox" ${draft.generateAudio && model.supportsAudio ? "checked" : ""} ${!model.supportsAudio || submitting ? "disabled" : ""} /><i></i></label>
        </section>` : ""}

        <button type="button" id="videoAdvancedToggle" class="video-advanced-toggle" aria-expanded="${advancedOpen}" aria-controls="videoAdvancedSettings"><span><i data-lucide="sliders-horizontal"></i>Réglages avancés</span><i data-lucide="chevron-${advancedOpen ? "up" : "down"}"></i></button>
        <section id="videoAdvancedSettings" class="video-advanced" ${advancedOpen ? "" : "hidden"}>
          <label><span>Éléments à éviter</span><textarea id="videoNegativePrompt" maxlength="500" placeholder="flou, texte, artefacts…" ${submitting ? "disabled" : ""}>${escapeHtml(draft.negativePrompt)}</textarea></label>
          <p><i data-lucide="shield-check"></i>Les filtres de sécurité du fournisseur restent toujours actifs.</p>
        </section>

        <div class="video-submit-row">
          <button type="submit" class="video-generate-button" ${canSubmit ? "" : "disabled"}>
            <span><i data-lucide="${submitting ? "loader-circle" : "sparkles"}"></i>${submitting ? "Envoi au moteur…" : "Générer la vidéo"}</span>
            <small>${model ? `${escapeHtml(model.label)} · ${draft.duration} secondes` : "Choisis un moteur"}</small>
          </button>
          <p><i data-lucide="circle-dollar-sign"></i>Une génération utilise le crédit du compte fal.ai. Le prix varie selon le moteur et les options.</p>
        </div>
      </form>

      <aside class="video-output-column">
        ${renderPreview()}
        <section class="video-history" aria-labelledby="videoHistoryTitle">
          <header><span><strong id="videoHistoryTitle">Créations récentes</strong><small>${jobs.length ? `${jobs.length} scène${jobs.length > 1 ? "s" : ""}` : "Aucune création"}</small></span>${jobs.length ? `<button type="button" id="videoHistoryClear"><i data-lucide="trash-2"></i><span>Nettoyer</span></button>` : ""}</header>
          <div>${jobs.map(renderHistoryItem).join("") || `<p class="video-history-empty">Les générations restent suivies ici, même si tu changes d’onglet.</p>`}</div>
        </section>
      </aside>
    </div>
    ${renderAccountManager()}
  </section>`;
};

const imageSizeLabel = (value: string): string => ({
  square_hd: "Carré HD",
  square: "Carré",
  portrait_4_3: "Portrait 3:4",
  portrait_16_9: "Portrait 9:16",
  landscape_4_3: "Paysage 4:3",
  landscape_16_9: "Paysage 16:9",
}[value] ?? value);

const imageModelOptions = (): string => (imageCapabilities?.models ?? []).map((model) => `
  <label class="video-model-card ${model.id === imageDraft.modelId ? "is-selected" : ""}">
    <input type="radio" name="imageModel" value="${escapeHtml(model.id)}" ${model.id === imageDraft.modelId ? "checked" : ""} ${submitting ? "disabled" : ""} />
    <span class="video-model-mark"><i data-lucide="${model.id.includes("ideogram") ? "type" : model.id.includes("recraft") ? "pen-tool" : "zap"}"></i></span>
    <span class="video-model-copy">
      <span><strong>${escapeHtml(model.label)}</strong><b>${escapeHtml(model.quality)}</b></span>
      <small>${escapeHtml(model.maker)} · ${escapeHtml(model.description)}</small>
    </span>
  </label>`).join("");

const currentImagePreviewJob = (): ImageGenerationRecord | null =>
  imageJobs.find((job) => job.localId === selectedImageJobId)
  ?? activeImageJobs()[0]
  ?? imageJobs[0]
  ?? null;

const renderImagePreview = (): string => {
  const job = currentImagePreviewJob();
  if (!job) {
    return `<section class="video-preview-card creative-image-empty is-empty" aria-label="Aperçu image">
      <div class="creative-image-placeholder"><i data-lucide="image-plus"></i></div>
      <strong>Tes prochaines images apparaîtront ici</strong>
      <p>Décris précisément le sujet, le style, la composition, la lumière et les couleurs.</p>
    </section>`;
  }
  const model = imageModelById(job.modelId);
  if (job.status === "completed" && job.images.length) {
    return `<section class="video-preview-card creative-image-result has-result" aria-label="Images générées">
      <div class="creative-image-gallery count-${job.images.length}">
        ${job.images.map((image, index) => `<figure>
          <img src="${escapeHtml(image.url)}" alt="Image générée ${index + 1}" loading="lazy" />
          <a href="${escapeHtml(image.url)}" target="_blank" rel="noopener noreferrer" aria-label="Ouvrir l’image ${index + 1}"><i data-lucide="download"></i></a>
          <button type="button" data-image-animate="${escapeHtml(image.url)}" title="Utiliser comme image de départ d’une vidéo" aria-label="Animer l’image ${index + 1}"><i data-lucide="clapperboard"></i></button>
        </figure>`).join("")}
      </div>
      <div class="video-result-meta"><span><strong>${escapeHtml(model?.label ?? job.modelId)}</strong><small>${escapeHtml(imageSizeLabel(job.imageSize))} · ${job.images.length} image${job.images.length > 1 ? "s" : ""}${job.seed != null ? ` · seed ${job.seed}` : ""}</small></span></div>
      <p>${escapeHtml(job.prompt)}</p>
    </section>`;
  }
  if (activeStatuses.has(job.status)) {
    const latestLog = job.logs.at(-1);
    return `<section class="video-preview-card is-working" aria-live="polite">
      <div class="creative-image-generating"><i data-lucide="wand-sparkles"></i><span></span><span></span><span></span></div>
      <span class="video-status-pill is-${job.status}"><i data-lucide="${statusIcon(job.status)}"></i>${statusLabel(job.status)}</span>
      <strong>${job.status === "queued" ? "La création attend son moteur" : "Les pixels prennent forme"}</strong>
      <p>${escapeHtml(latestLog || (job.queuePosition != null ? `${job.queuePosition} génération(s) devant la tienne` : "La génération prend généralement quelques secondes."))}</p>
      ${job.trackingError ? `<small class="video-tracking-warning"><i data-lucide="wifi-off"></i>${escapeHtml(job.trackingError)}</small>` : ""}
      <button type="button" class="video-cancel-button" data-image-cancel="${escapeHtml(job.localId)}" ${cancellingImageIds.has(job.localId) ? "disabled" : ""}><i data-lucide="square"></i><span>${cancellingImageIds.has(job.localId) ? "Annulation…" : "Annuler"}</span></button>
    </section>`;
  }
  return `<section class="video-preview-card is-error" role="status">
    <span><i data-lucide="${statusIcon(job.status)}"></i></span>
    <strong>${statusLabel(job.status)}</strong>
    <p>${escapeHtml(job.error || "Cette génération n’a pas produit d’image.")}</p>
    <button type="button" class="video-reuse-button" data-image-reuse="${escapeHtml(job.localId)}"><i data-lucide="rotate-ccw"></i><span>Réutiliser les réglages</span></button>
  </section>`;
};

const renderImageHistoryItem = (job: ImageGenerationRecord): string => {
  const selected = currentImagePreviewJob()?.localId === job.localId;
  const model = imageModelById(job.modelId);
  return `<article class="video-history-item is-${job.status} ${selected ? "is-selected" : ""}" data-image-select="${escapeHtml(job.localId)}" tabindex="0" role="button" aria-pressed="${selected}">
    <span class="video-history-thumb">
      ${job.status === "completed" && job.images[0]
        ? `<img src="${escapeHtml(job.images[0].url)}" alt="" loading="lazy" />`
        : `<i data-lucide="${statusIcon(job.status)}"></i>`}
    </span>
    <span class="video-history-copy">
      <span><strong>${escapeHtml(model?.label ?? job.modelId)}</strong><b>${statusLabel(job.status)}</b></span>
      <small>${escapeHtml(job.prompt)}</small>
      <em>${formatDate(job.createdAt)} · ${escapeHtml(imageSizeLabel(job.imageSize))}</em>
    </span>
    <button type="button" data-image-remove="${escapeHtml(job.localId)}" aria-label="Retirer de l’historique"><i data-lucide="trash-2"></i></button>
  </article>`;
};

const renderImageStudioPanel = (): string => {
  const model = selectedImageModel();
  const account = selectedAccount();
  const canSubmit = imageCapabilities?.configured === true && !!account && !!model && !submitting;
  const promptCount = [...imageDraft.prompt].length;
  return `<section id="videoPanel" class="video-panel creative-image-panel" aria-labelledby="videoPanelTitle">
    <header class="video-hero">
      <div class="video-hero-copy">
        <span class="video-eyebrow"><i data-lucide="wand-sparkles"></i>Studio IA génératif</span>
        <h1 id="videoPanelTitle">Imagine. Compose. <em>Crée.</em></h1>
        <p>Génère des images avec FLUX, Ideogram ou Recraft, depuis le compte fal.ai de ton choix.</p>
      </div>
      <div class="video-provider-state ${account ? "is-ready" : ""}">
        <i></i><span><strong>${account ? escapeHtml(account.label) : "Compte requis"}</strong><small>${account ? escapeHtml(account.keyHint) : "via fal.ai"}</small></span>
      </div>
    </header>

    ${renderSetupNotice()}
    ${renderStudioToolbar()}
    ${submitError ? `<div class="video-submit-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(submitError)}</span><button type="button" id="videoErrorDismiss" aria-label="Fermer"><i data-lucide="x"></i></button></div>` : ""}

    <div class="video-studio-layout">
      <form id="imageGenerationForm" class="video-composer">
        <label class="video-prompt-field">
          <span><strong>Décris ton image</strong><small id="imagePromptCount">${promptCount}/1500</small></span>
          <textarea id="imagePrompt" maxlength="1500" required placeholder="Une affiche éditoriale minimaliste, lumière dorée, typographie nette…" ${submitting ? "disabled" : ""}>${escapeHtml(imageDraft.prompt)}</textarea>
          <span class="video-prompt-hints"><i data-lucide="lightbulb"></i>Sujet · composition · lumière · style · couleurs</span>
        </label>

        <fieldset class="video-model-picker" ${submitting ? "disabled" : ""}>
          <legend><span>Choisis le moteur</span><small>Trois signatures visuelles</small></legend>
          <div>${imageModelOptions() || `<span class="video-model-skeleton"></span><span class="video-model-skeleton"></span>`}</div>
        </fieldset>

        ${model ? `<section class="video-controls creative-image-controls" aria-label="Réglages image">
          <label><span><i data-lucide="ratio"></i>Format</span><select id="imageSize" ${submitting ? "disabled" : ""}>${model.imageSizes.map((size) => `<option value="${escapeHtml(size)}" ${size === imageDraft.imageSize ? "selected" : ""}>${escapeHtml(imageSizeLabel(size))}</option>`).join("")}</select></label>
          <label><span><i data-lucide="palette"></i>Style</span><select id="imageStyle" ${submitting ? "disabled" : ""}>${model.styles.map((style) => `<option value="${escapeHtml(style.id)}" ${style.id === imageDraft.style ? "selected" : ""}>${escapeHtml(style.label)}</option>`).join("")}</select></label>
          <label><span><i data-lucide="copy"></i>Variantes</span><select id="imageCount" ${submitting ? "disabled" : ""}>${optionTags(Array.from({ length: model.maxImages }, (_, index) => index + 1), imageDraft.numImages)}</select></label>
        </section>` : ""}

        <button type="button" id="imageAdvancedToggle" class="video-advanced-toggle" aria-expanded="${imageAdvancedOpen}" aria-controls="imageAdvancedSettings"><span><i data-lucide="sliders-horizontal"></i>Réglages avancés</span><i data-lucide="chevron-${imageAdvancedOpen ? "up" : "down"}"></i></button>
        <section id="imageAdvancedSettings" class="video-advanced" ${imageAdvancedOpen ? "" : "hidden"}>
          ${model?.supportsNegativePrompt
            ? `<label><span>Éléments à éviter</span><textarea id="imageNegativePrompt" maxlength="500" placeholder="filigrane, flou, texte déformé…" ${submitting ? "disabled" : ""}>${escapeHtml(imageDraft.negativePrompt)}</textarea></label>`
            : `<p><i data-lucide="info"></i>${escapeHtml(model?.label ?? "Ce modèle")} ne propose pas de prompt négatif.</p>`}
          <p><i data-lucide="shield-check"></i>Les filtres de sécurité du fournisseur restent toujours actifs.</p>
        </section>

        <div class="video-submit-row">
          <button type="submit" class="video-generate-button" ${canSubmit ? "" : "disabled"}>
            <span><i data-lucide="${submitting ? "loader-circle" : "sparkles"}"></i>${submitting ? "Envoi au moteur…" : "Générer les images"}</span>
            <small>${model ? `${escapeHtml(model.label)} · ${imageDraft.numImages} variante${imageDraft.numImages > 1 ? "s" : ""}` : "Choisis un moteur"}</small>
          </button>
          <p><i data-lucide="circle-dollar-sign"></i>La génération utilise le crédit du compte fal.ai sélectionné.</p>
        </div>
      </form>

      <aside class="video-output-column">
        ${renderImagePreview()}
        <section class="video-history" aria-labelledby="imageHistoryTitle">
          <header><span><strong id="imageHistoryTitle">Images récentes</strong><small>${imageJobs.length ? `${imageJobs.length} création${imageJobs.length > 1 ? "s" : ""}` : "Aucune création"}</small></span>${imageJobs.length ? `<button type="button" id="imageHistoryClear"><i data-lucide="trash-2"></i><span>Nettoyer</span></button>` : ""}</header>
          <div>${imageJobs.map(renderImageHistoryItem).join("") || `<p class="video-history-empty">Les générations restent suivies ici, même si tu changes d’onglet.</p>`}</div>
        </section>
      </aside>
    </div>
    ${renderAccountManager()}
  </section>`;
};

const syncDraftFromForm = (): void => {
  const prompt = document.querySelector<HTMLTextAreaElement>("#videoPrompt");
  const negative = document.querySelector<HTMLTextAreaElement>("#videoNegativePrompt");
  const aspect = document.querySelector<HTMLSelectElement>("#videoAspectRatio");
  const duration = document.querySelector<HTMLSelectElement>("#videoDuration");
  const resolution = document.querySelector<HTMLSelectElement>("#videoResolution");
  const audio = document.querySelector<HTMLInputElement>("#videoGenerateAudio");
  const imageUrl = document.querySelector<HTMLInputElement>("#videoImageUrl");
  if (prompt) draft.prompt = prompt.value;
  if (negative) draft.negativePrompt = negative.value;
  if (aspect) draft.aspectRatio = aspect.value;
  if (duration) draft.duration = Number(duration.value);
  if (resolution) draft.resolution = resolution.value;
  if (audio) draft.generateAudio = audio.checked;
  if (imageUrl?.value.trim()) {
    draft.imageUrl = imageUrl.value.trim();
    draft.imageName = "Image distante";
  }
};

const applyModelDefaults = (model: VideoModel): void => {
  draft.modelId = model.id;
  draft.aspectRatio = model.defaultAspectRatio;
  draft.duration = model.defaultDuration;
  draft.resolution = model.defaultResolution;
  draft.generateAudio = false;
};

const syncImageDraftFromForm = (): void => {
  const prompt = document.querySelector<HTMLTextAreaElement>("#imagePrompt");
  const negative = document.querySelector<HTMLTextAreaElement>("#imageNegativePrompt");
  const size = document.querySelector<HTMLSelectElement>("#imageSize");
  const style = document.querySelector<HTMLSelectElement>("#imageStyle");
  const count = document.querySelector<HTMLSelectElement>("#imageCount");
  if (prompt) imageDraft.prompt = prompt.value;
  if (negative) imageDraft.negativePrompt = negative.value;
  if (size) imageDraft.imageSize = size.value;
  if (style) imageDraft.style = style.value;
  if (count) imageDraft.numImages = Number(count.value);
};

const applyImageModelDefaults = (model: ImageModel): void => {
  imageDraft.modelId = model.id;
  imageDraft.imageSize = model.defaultImageSize;
  imageDraft.style = model.defaultStyle;
  imageDraft.numImages = 1;
  if (!model.supportsNegativePrompt) imageDraft.negativePrompt = "";
};

const redrawPanel = (): void => {
  const current = document.querySelector<HTMLElement>("#videoPanel");
  if (!current) return;
  current.outerHTML = renderVideoPanel();
  const next = document.querySelector<HTMLElement>("#videoPanel");
  if (next && renderIcons) renderIcons(next);
  bindVideoPanel(rerenderApp ?? (() => undefined), renderIcons ?? undefined);
};

const fileDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
  reader.addEventListener("error", () => reject(new Error("Impossible de lire cette image.")));
  reader.readAsDataURL(file);
});

const loadReferenceImage = async (file: File): Promise<void> => {
  const maxBytes = capabilities?.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
  if (!/^image\/(jpeg|png|webp|bmp)$/.test(file.type)) {
    throw new Error("Utilise une image JPEG, PNG, WebP ou BMP.");
  }
  if (file.size > maxBytes) {
    throw new Error(`L’image dépasse la limite de ${formatBytes(maxBytes)}.`);
  }
  draft.imageUrl = await fileDataUrl(file);
  draft.imageName = file.name.slice(0, 240);
};

const createLocalId = (requestId: string): string =>
  `${requestId}-${Date.now().toString(36)}`;

const updateJob = (localId: string, remote: VideoBackendJob): void => {
  jobs = jobs.map((job) => job.localId === localId
    ? {
        ...job,
        ...remote,
        logs: remote.logs.length ? remote.logs : job.logs,
        updatedAt: Date.now(),
        trackingError: null,
      }
    : job);
  persistVideoHistory(jobs);
};

const submitGeneration = async (): Promise<void> => {
  syncDraftFromForm();
  const model = selectedModel();
  const account = selectedAccount();
  submitError = "";
  if (!capabilities?.configured || !model || !account) {
    submitError = capabilities?.configurationHint || "Le service vidéo n’est pas configuré.";
    redrawPanel();
    return;
  }
  const prompt = draft.prompt.trim();
  if (!prompt) {
    submitError = "Décris la vidéo que tu veux créer.";
    redrawPanel();
    document.querySelector<HTMLTextAreaElement>("#videoPrompt")?.focus();
    return;
  }
  if (draft.mode === "image" && !draft.imageUrl.trim()) {
    submitError = "Ajoute une image de départ ou colle son URL HTTPS.";
    redrawPanel();
    return;
  }
  submitting = true;
  redrawPanel();
  try {
    const remote = await invoke<VideoBackendJob>("start_video_generation", {
      request: {
        accountId: account.id,
        modelId: model.id,
        mode: draft.mode,
        prompt,
        imageUrl: draft.mode === "image" ? draft.imageUrl : null,
        aspectRatio: draft.aspectRatio,
        duration: draft.duration,
        resolution: draft.resolution,
        generateAudio: model.supportsAudio && draft.generateAudio,
        negativePrompt: draft.negativePrompt.trim() || null,
      },
    });
    const now = Date.now();
    const record: VideoGenerationRecord = {
      ...remote,
      localId: createLocalId(remote.requestId),
      prompt,
      negativePrompt: draft.negativePrompt.trim(),
      aspectRatio: draft.aspectRatio,
      duration: draft.duration,
      resolution: draft.resolution,
      generateAudio: model.supportsAudio && draft.generateAudio,
      imageName: draft.mode === "image" ? draft.imageName || "Image distante" : null,
      createdAt: now,
      updatedAt: now,
      trackingError: null,
    };
    jobs = [record, ...jobs].slice(0, VIDEO_HISTORY_LIMIT);
    selectedJobId = record.localId;
    persistVideoHistory(jobs);
    schedulePoll(500);
  } catch (error) {
    submitError = String(error instanceof Error ? error.message : error);
  } finally {
    submitting = false;
    redrawPanel();
  }
};

const pollJobs = async (): Promise<void> => {
  if (pollInFlight) return;
  const pending = activeJobs();
  if (!pending.length) {
    stopPollTimer();
    return;
  }
  pollInFlight = true;
  let changed = false;
  await Promise.all(pending.map(async (job) => {
    try {
      const remote = await invoke<VideoBackendJob>("video_generation_status", {
        request: {
          accountId: job.accountId || selectedAccount()?.id || null,
          requestId: job.requestId,
          modelId: job.modelId,
          mode: job.mode,
        },
      });
      updateJob(job.localId, remote);
      changed = true;
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      jobs = jobs.map((candidate) => candidate.localId === job.localId
        ? { ...candidate, trackingError: message, updatedAt: Date.now() }
        : candidate);
      persistVideoHistory(jobs);
      changed = true;
    }
  }));
  pollInFlight = false;
  if (changed && panelActive) redrawPanel();
  if (activeJobs().length) schedulePoll();
  else stopPollTimer();
};

const stopPollTimer = (): void => {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
};

const schedulePoll = (delay = POLL_DELAY_MS): void => {
  stopPollTimer();
  if (!activeJobs().length) return;
  pollTimer = window.setTimeout(() => void pollJobs(), delay);
};

const cancelJob = async (localId: string): Promise<void> => {
  const job = jobs.find((candidate) => candidate.localId === localId);
  if (!job || !activeStatuses.has(job.status) || cancellingIds.has(localId)) return;
  cancellingIds.add(localId);
  redrawPanel();
  try {
    const remote = await invoke<VideoBackendJob>("cancel_video_generation", {
      request: {
        accountId: job.accountId || selectedAccount()?.id || null,
        requestId: job.requestId,
        modelId: job.modelId,
        mode: job.mode,
      },
    });
    updateJob(localId, remote);
  } catch (error) {
    submitError = String(error instanceof Error ? error.message : error);
  } finally {
    cancellingIds.delete(localId);
    redrawPanel();
  }
};

const reuseJob = (localId: string): void => {
  const job = jobs.find((candidate) => candidate.localId === localId);
  const model = job ? modelById(job.modelId) : null;
  if (!job || !model) return;
  draft.mode = job.mode;
  draft.modelId = job.modelId;
  draft.prompt = job.prompt;
  draft.negativePrompt = job.negativePrompt;
  draft.aspectRatio = model.aspectRatios.includes(job.aspectRatio)
    ? job.aspectRatio
    : model.defaultAspectRatio;
  draft.duration = model.durations.includes(job.duration) ? job.duration : model.defaultDuration;
  draft.resolution = model.resolutions.includes(job.resolution)
    ? job.resolution
    : model.defaultResolution;
  draft.generateAudio = model.supportsAudio && job.generateAudio;
  draft.imageUrl = "";
  draft.imageName = "";
  submitError = job.mode === "image" ? "Ajoute de nouveau l’image de départ avant de relancer." : "";
  redrawPanel();
  document.querySelector<HTMLTextAreaElement>("#videoPrompt")?.focus();
};

const updateImageJob = (localId: string, remote: ImageBackendJob): void => {
  imageJobs = imageJobs.map((job) => job.localId === localId
    ? {
        ...job,
        ...remote,
        logs: remote.logs.length ? remote.logs : job.logs,
        images: remote.images.length ? remote.images : job.images,
        updatedAt: Date.now(),
        trackingError: null,
      }
    : job);
  persistImageHistory(imageJobs);
};

const submitImageGeneration = async (): Promise<void> => {
  syncImageDraftFromForm();
  const model = selectedImageModel();
  const account = selectedAccount();
  submitError = "";
  if (!imageCapabilities?.configured || !model || !account) {
    submitError = imageCapabilities?.configurationHint || "Connecte un compte fal.ai.";
    redrawPanel();
    return;
  }
  const prompt = imageDraft.prompt.trim();
  if (!prompt) {
    submitError = "Décris l’image que tu veux créer.";
    redrawPanel();
    document.querySelector<HTMLTextAreaElement>("#imagePrompt")?.focus();
    return;
  }
  submitting = true;
  redrawPanel();
  try {
    const remote = await invoke<ImageBackendJob>("start_image_generation", {
      request: {
        accountId: account.id,
        modelId: model.id,
        prompt,
        imageSize: imageDraft.imageSize,
        style: imageDraft.style,
        numImages: imageDraft.numImages,
        negativePrompt: model.supportsNegativePrompt
          ? imageDraft.negativePrompt.trim() || null
          : null,
      },
    });
    const now = Date.now();
    const record: ImageGenerationRecord = {
      ...remote,
      localId: createLocalId(remote.requestId),
      prompt,
      negativePrompt: model.supportsNegativePrompt ? imageDraft.negativePrompt.trim() : "",
      imageSize: imageDraft.imageSize,
      style: imageDraft.style,
      numImages: imageDraft.numImages,
      createdAt: now,
      updatedAt: now,
      trackingError: null,
    };
    imageJobs = [record, ...imageJobs].slice(0, IMAGE_HISTORY_LIMIT);
    selectedImageJobId = record.localId;
    persistImageHistory(imageJobs);
    scheduleImagePoll(500);
  } catch (error) {
    submitError = String(error instanceof Error ? error.message : error);
  } finally {
    submitting = false;
    redrawPanel();
  }
};

const pollImageJobs = async (): Promise<void> => {
  if (imagePollInFlight) return;
  const pending = activeImageJobs();
  if (!pending.length) {
    stopImagePollTimer();
    return;
  }
  imagePollInFlight = true;
  let changed = false;
  await Promise.all(pending.map(async (job) => {
    try {
      const remote = await invoke<ImageBackendJob>("image_generation_status", {
        request: {
          accountId: job.accountId || selectedAccount()?.id || null,
          requestId: job.requestId,
          modelId: job.modelId,
        },
      });
      updateImageJob(job.localId, remote);
      changed = true;
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      imageJobs = imageJobs.map((candidate) => candidate.localId === job.localId
        ? { ...candidate, trackingError: message, updatedAt: Date.now() }
        : candidate);
      persistImageHistory(imageJobs);
      changed = true;
    }
  }));
  imagePollInFlight = false;
  if (changed && panelActive && creativeKind === "image") redrawPanel();
  if (activeImageJobs().length) scheduleImagePoll();
  else stopImagePollTimer();
};

const stopImagePollTimer = (): void => {
  if (imagePollTimer !== null) window.clearTimeout(imagePollTimer);
  imagePollTimer = null;
};

const scheduleImagePoll = (delay = POLL_DELAY_MS): void => {
  stopImagePollTimer();
  if (!activeImageJobs().length) return;
  imagePollTimer = window.setTimeout(() => void pollImageJobs(), delay);
};

const cancelImageJob = async (localId: string): Promise<void> => {
  const job = imageJobs.find((candidate) => candidate.localId === localId);
  if (!job || !activeStatuses.has(job.status) || cancellingImageIds.has(localId)) return;
  cancellingImageIds.add(localId);
  redrawPanel();
  try {
    const remote = await invoke<ImageBackendJob>("cancel_image_generation", {
      request: {
        accountId: job.accountId || selectedAccount()?.id || null,
        requestId: job.requestId,
        modelId: job.modelId,
      },
    });
    updateImageJob(localId, remote);
  } catch (error) {
    submitError = String(error instanceof Error ? error.message : error);
  } finally {
    cancellingImageIds.delete(localId);
    redrawPanel();
  }
};

const reuseImageJob = (localId: string): void => {
  const job = imageJobs.find((candidate) => candidate.localId === localId);
  const model = job ? imageModelById(job.modelId) : null;
  if (!job || !model) return;
  imageDraft.modelId = model.id;
  imageDraft.prompt = job.prompt;
  imageDraft.negativePrompt = model.supportsNegativePrompt ? job.negativePrompt : "";
  imageDraft.imageSize = model.imageSizes.includes(job.imageSize)
    ? job.imageSize
    : model.defaultImageSize;
  imageDraft.style = model.styles.some((style) => style.id === job.style)
    ? job.style
    : model.defaultStyle;
  imageDraft.numImages = Math.min(model.maxImages, Math.max(1, job.numImages));
  if (creativeAccounts?.accounts.some((account) => account.id === job.accountId)) {
    selectedAccountId = job.accountId;
  }
  submitError = "";
  redrawPanel();
  document.querySelector<HTMLTextAreaElement>("#imagePrompt")?.focus();
};

const applyCreativeAccounts = (view: CreativeAccountsView, preferredId = selectedAccountId): void => {
  creativeAccounts = view;
  selectedAccountId = view.accounts.some((account) => account.id === preferredId)
    ? preferredId
    : view.defaultAccountId && view.accounts.some((account) => account.id === view.defaultAccountId)
      ? view.defaultAccountId
      : view.accounts[0]?.id ?? "";
  if (capabilities) capabilities.configured = view.accounts.length > 0;
  if (imageCapabilities) imageCapabilities.configured = view.accounts.length > 0;
};

const connectCreativeAccount = async (): Promise<void> => {
  const label = document.querySelector<HTMLInputElement>("#creativeAccountLabel")?.value.trim() ?? "";
  const apiKey = document.querySelector<HTMLInputElement>("#creativeAccountKey")?.value.trim() ?? "";
  const makeDefault = document.querySelector<HTMLInputElement>("#creativeAccountDefault")?.checked !== false;
  if (!label || !apiKey) {
    accountError = "Renseigne un nom et la clé API fal.ai complète.";
    redrawPanel();
    return;
  }
  accountSaving = true;
  accountError = "";
  const previousIds = new Set((creativeAccounts?.accounts ?? []).map((account) => account.id));
  redrawPanel();
  try {
    const view = await invoke<CreativeAccountsView>("connect_creative_account", {
      request: { label, apiKey, makeDefault },
    });
    const connectedAccount = view.accounts.find((account) => !previousIds.has(account.id));
    applyCreativeAccounts(view, connectedAccount?.id ?? view.defaultAccountId ?? "");
  } catch (error) {
    accountError = String(error instanceof Error ? error.message : error);
  } finally {
    accountSaving = false;
    redrawPanel();
  }
};

const setDefaultCreativeAccount = async (accountId: string): Promise<void> => {
  if (!accountId || accountSaving) return;
  accountSaving = true;
  accountError = "";
  redrawPanel();
  try {
    const view = await invoke<CreativeAccountsView>("set_default_creative_account", {
      request: { accountId },
    });
    applyCreativeAccounts(view, accountId);
  } catch (error) {
    accountError = String(error instanceof Error ? error.message : error);
  } finally {
    accountSaving = false;
    redrawPanel();
  }
};

const deleteCreativeAccount = async (accountId: string): Promise<void> => {
  const account = creativeAccounts?.accounts.find((item) => item.id === accountId);
  if (!account || account.source !== "stored" || accountSaving) return;
  const runningCount = activeJobs().filter((job) => job.accountId === accountId).length
    + activeImageJobs().filter((job) => job.accountId === accountId).length;
  const warning = runningCount
    ? ` ${runningCount} génération(s) en cours ne pourront plus être suivies.`
    : "";
  if (!window.confirm(`Déconnecter « ${account.label} » du Studio IA ?${warning}`)) return;
  accountSaving = true;
  accountError = "";
  redrawPanel();
  try {
    const view = await invoke<CreativeAccountsView>("delete_creative_account", {
      request: { accountId },
    });
    applyCreativeAccounts(view);
  } catch (error) {
    accountError = String(error instanceof Error ? error.message : error);
  } finally {
    accountSaving = false;
    redrawPanel();
  }
};

export const refreshVideoPanel = async (rerender?: () => void, silent = false): Promise<void> => {
  if (rerender) rerenderApp = rerender;
  if (capabilitiesLoading) return;
  capabilitiesLoading = true;
  if (!silent) capabilitiesError = "";
  if (panelActive) redrawPanel();
  try {
    const [videoView, imageView, accountsView] = await Promise.all([
      invoke<VideoGenerationCapabilities>("video_generation_capabilities"),
      invoke<ImageGenerationCapabilities>("image_generation_capabilities"),
      invoke<CreativeAccountsView>("creative_accounts"),
    ]);
    capabilities = videoView;
    imageCapabilities = imageView;
    applyCreativeAccounts(accountsView);
    const model = selectedModel();
    if (model && (!model.aspectRatios.includes(draft.aspectRatio)
      || !model.durations.includes(draft.duration)
      || !model.resolutions.includes(draft.resolution))) {
      applyModelDefaults(model);
    }
    const imageModel = selectedImageModel();
    if (imageModel && (!imageModel.imageSizes.includes(imageDraft.imageSize)
      || !imageModel.styles.some((style) => style.id === imageDraft.style)
      || imageDraft.numImages > imageModel.maxImages)) {
      applyImageModelDefaults(imageModel);
    }
    capabilitiesError = "";
  } catch (error) {
    capabilitiesError = String(error instanceof Error ? error.message : error);
  } finally {
    capabilitiesLoading = false;
    if (panelActive) {
      if (document.querySelector("#videoPanel")) redrawPanel();
      else rerenderApp?.();
    }
  }
};

export const activateVideoPanel = (rerender: () => void): void => {
  panelActive = true;
  rerenderApp = rerender;
  if (!capabilities && !capabilitiesLoading) void refreshVideoPanel(rerender);
  if (activeJobs().length) {
    schedulePoll(250);
  }
  if (activeImageJobs().length) {
    scheduleImagePoll(250);
  }
};

export const deactivateVideoPanel = (): void => {
  panelActive = false;
};

const activateHistoryItem = (element: HTMLElement): void => {
  const id = element.dataset.videoSelect;
  if (!id) return;
  selectedJobId = id;
  redrawPanel();
};

export const bindVideoPanel = (
  rerender: () => void,
  iconRenderer?: RenderIcons,
): void => {
  const root = document.querySelector<HTMLElement>("#videoPanel");
  if (!root) return;
  rerenderApp = rerender;
  if (iconRenderer) renderIcons = iconRenderer;

  root.querySelectorAll<HTMLButtonElement>("[data-creative-kind]").forEach((button) => {
    button.addEventListener("click", () => {
      if (creativeKind === "video") syncDraftFromForm();
      else syncImageDraftFromForm();
      creativeKind = button.dataset.creativeKind === "image" ? "image" : "video";
      submitError = "";
      redrawPanel();
    });
  });
  root.querySelector<HTMLSelectElement>("#creativeAccountSelect")?.addEventListener("change", (event) => {
    if (creativeKind === "video") syncDraftFromForm();
    else syncImageDraftFromForm();
    selectedAccountId = (event.currentTarget as HTMLSelectElement).value;
    submitError = "";
    redrawPanel();
  });
  const openAccountManager = (): void => {
    if (creativeKind === "video") syncDraftFromForm();
    else syncImageDraftFromForm();
    accountManagerOpen = true;
    accountError = "";
    redrawPanel();
    document.querySelector<HTMLInputElement>("#creativeAccountLabel")?.focus();
  };
  root.querySelector<HTMLButtonElement>("#creativeAccountsOpen")?.addEventListener("click", openAccountManager);
  root.querySelector<HTMLButtonElement>("#creativeAccountsOpenNotice")?.addEventListener("click", openAccountManager);
  root.querySelector<HTMLButtonElement>("#creativeAccountsClose")?.addEventListener("click", () => {
    accountManagerOpen = false;
    accountError = "";
    redrawPanel();
  });
  root.querySelector<HTMLElement>(".creative-account-overlay")?.addEventListener("click", (event) => {
    if (event.target !== event.currentTarget) return;
    accountManagerOpen = false;
    accountError = "";
    redrawPanel();
  });
  root.querySelector<HTMLFormElement>("#creativeAccountForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void connectCreativeAccount();
  });
  root.querySelectorAll<HTMLButtonElement>("[data-creative-default]").forEach((button) => {
    button.addEventListener("click", () => void setDefaultCreativeAccount(button.dataset.creativeDefault ?? ""));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-creative-delete]").forEach((button) => {
    button.addEventListener("click", () => void deleteCreativeAccount(button.dataset.creativeDelete ?? ""));
  });
  root.querySelector<HTMLButtonElement>("#videoErrorDismiss")?.addEventListener("click", () => {
    submitError = "";
    redrawPanel();
  });
  root.querySelector<HTMLButtonElement>("#videoCapabilitiesRefresh")?.addEventListener("click", () => {
    void refreshVideoPanel(rerender);
  });

  if (creativeKind === "image") {
    root.querySelector<HTMLFormElement>("#imageGenerationForm")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitImageGeneration();
    });
    root.querySelector<HTMLTextAreaElement>("#imagePrompt")?.addEventListener("input", (event) => {
      imageDraft.prompt = (event.currentTarget as HTMLTextAreaElement).value;
      const count = root.querySelector<HTMLElement>("#imagePromptCount");
      if (count) count.textContent = `${[...imageDraft.prompt].length}/1500`;
    });
    root.querySelectorAll<HTMLInputElement>('input[name="imageModel"]').forEach((input) => {
      input.addEventListener("change", () => {
        if (!input.checked) return;
        syncImageDraftFromForm();
        const model = imageModelById(input.value);
        if (model) applyImageModelDefaults(model);
        redrawPanel();
      });
    });
    ["#imageSize", "#imageStyle", "#imageCount"].forEach((selector) => {
      root.querySelector<HTMLSelectElement>(selector)?.addEventListener("change", () => {
        syncImageDraftFromForm();
        redrawPanel();
      });
    });
    root.querySelector<HTMLButtonElement>("#imageAdvancedToggle")?.addEventListener("click", () => {
      syncImageDraftFromForm();
      imageAdvancedOpen = !imageAdvancedOpen;
      redrawPanel();
    });
    root.querySelectorAll<HTMLElement>("[data-image-select]").forEach((item) => {
      const activate = (): void => {
        const id = item.dataset.imageSelect;
        if (!id) return;
        selectedImageJobId = id;
        redrawPanel();
      };
      item.addEventListener("click", (event) => {
        if ((event.target as Element | null)?.closest("[data-image-remove]")) return;
        activate();
      });
      item.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate();
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-image-cancel]").forEach((button) => {
      button.addEventListener("click", () => void cancelImageJob(button.dataset.imageCancel ?? ""));
    });
    root.querySelectorAll<HTMLButtonElement>("[data-image-reuse]").forEach((button) => {
      button.addEventListener("click", () => reuseImageJob(button.dataset.imageReuse ?? ""));
    });
    root.querySelectorAll<HTMLButtonElement>("[data-image-animate]").forEach((button) => {
      button.addEventListener("click", () => {
        const imageUrl = button.dataset.imageAnimate ?? "";
        if (!imageUrl.startsWith("https://")) return;
        syncImageDraftFromForm();
        draft.mode = "image";
        draft.imageUrl = imageUrl;
        draft.imageName = "Image générée dans le Studio IA";
        creativeKind = "video";
        submitError = "";
        redrawPanel();
      });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-image-remove]").forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const id = button.dataset.imageRemove;
        if (!id) return;
        imageJobs = imageJobs.filter((job) => job.localId !== id);
        if (selectedImageJobId === id) selectedImageJobId = imageJobs[0]?.localId ?? null;
        persistImageHistory(imageJobs);
        redrawPanel();
      });
    });
    root.querySelector<HTMLButtonElement>("#imageHistoryClear")?.addEventListener("click", () => {
      const running = activeImageJobs();
      imageJobs = running;
      selectedImageJobId = running[0]?.localId ?? null;
      persistImageHistory(imageJobs);
      redrawPanel();
    });
    return;
  }

  root.querySelector<HTMLFormElement>("#videoGenerationForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitGeneration();
  });
  root.querySelector<HTMLTextAreaElement>("#videoPrompt")?.addEventListener("input", (event) => {
    draft.prompt = (event.currentTarget as HTMLTextAreaElement).value;
    const count = root.querySelector<HTMLElement>("#videoPromptCount");
    if (count) count.textContent = `${[...draft.prompt].length}/1500`;
  });
  root.querySelectorAll<HTMLButtonElement>("[data-video-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      syncDraftFromForm();
      draft.mode = button.dataset.videoMode === "image" ? "image" : "text";
      submitError = "";
      redrawPanel();
    });
  });
  root.querySelectorAll<HTMLInputElement>('input[name="videoModel"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      syncDraftFromForm();
      const model = modelById(input.value);
      if (model) applyModelDefaults(model);
      redrawPanel();
    });
  });
  root.querySelector<HTMLButtonElement>("#videoAdvancedToggle")?.addEventListener("click", () => {
    syncDraftFromForm();
    advancedOpen = !advancedOpen;
    redrawPanel();
  });
  root.querySelector<HTMLButtonElement>("#videoImageRemove")?.addEventListener("click", () => {
    draft.imageUrl = "";
    draft.imageName = "";
    redrawPanel();
  });
  const imageFile = root.querySelector<HTMLInputElement>("#videoImageFile");
  imageFile?.addEventListener("change", () => {
    const file = imageFile.files?.[0];
    if (!file) return;
    void loadReferenceImage(file)
      .then(() => {
        submitError = "";
        redrawPanel();
      })
      .catch((error) => {
        submitError = String(error instanceof Error ? error.message : error);
        redrawPanel();
      });
  });
  const dropzone = root.querySelector<HTMLElement>("#videoDropzone");
  dropzone?.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("is-dragging"));
  dropzone?.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    void loadReferenceImage(file)
      .then(() => {
        submitError = "";
        redrawPanel();
      })
      .catch((error) => {
        submitError = String(error instanceof Error ? error.message : error);
        redrawPanel();
      });
  });
  root.querySelector<HTMLInputElement>("#videoImageUrl")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    draft.imageUrl = input.value.trim();
    draft.imageName = draft.imageUrl ? "Image distante" : "";
    if (draft.imageUrl && !draft.imageUrl.startsWith("https://")) {
      submitError = "L’image distante doit utiliser une URL HTTPS.";
    } else {
      submitError = "";
    }
    redrawPanel();
  });
  root.querySelectorAll<HTMLElement>("[data-video-select]").forEach((item) => {
    item.addEventListener("click", (event) => {
      if ((event.target as Element | null)?.closest("[data-video-remove]")) return;
      activateHistoryItem(item);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      activateHistoryItem(item);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-video-cancel]").forEach((button) => {
    button.addEventListener("click", () => void cancelJob(button.dataset.videoCancel ?? ""));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-video-reuse]").forEach((button) => {
    button.addEventListener("click", () => reuseJob(button.dataset.videoReuse ?? ""));
  });
  root.querySelectorAll<HTMLButtonElement>("[data-video-remove]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.videoRemove;
      if (!id) return;
      jobs = jobs.filter((job) => job.localId !== id);
      if (selectedJobId === id) selectedJobId = jobs[0]?.localId ?? null;
      persistVideoHistory(jobs);
      redrawPanel();
    });
  });
  root.querySelector<HTMLButtonElement>("#videoHistoryClear")?.addEventListener("click", () => {
    const running = activeJobs();
    jobs = running;
    selectedJobId = running[0]?.localId ?? null;
    persistVideoHistory(jobs);
    redrawPanel();
  });
};
