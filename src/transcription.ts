import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  transcribeAudioFile,
  transcriptionRuntimeStatus,
  type AudioFileTranscriptionResponse,
  type TranscriptionRuntimeStatus,
  type VoiceOutputMode,
} from "./platform";
import "./transcription.css";

const AUDIO_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "amr",
  "flac",
  "m4a",
  "mp3",
  "mp4",
  "mpeg",
  "mpga",
  "oga",
  "ogg",
  "opus",
  "wav",
  "webm",
  "wma",
]);

let selectedFile: File | null = null;
let previewUrl = "";
let language = "auto";
let outputMode: VoiceOutputMode = "clean";
let result: AudioFileTranscriptionResponse | null = null;
let runtimeStatus: TranscriptionRuntimeStatus | null = null;
let runtimeError = "";
let runtimeLoading = false;
let errorMessage = "";
let busy = false;
let active = false;
let startedAt = 0;
let abortController: AbortController | null = null;
let elapsedTimer: number | null = null;
let feedbackTimer: number | null = null;
let copyFeedback = "";
let rerenderApp: (() => void) | null = null;

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
};

const formatDuration = (milliseconds: number): string => {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${String(seconds % 60).padStart(2, "0")} s` : `${seconds} s`;
};

const elapsedLabel = (): string => formatDuration(Date.now() - startedAt);

const extensionFor = (file: File): string =>
  file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";

const validateAudioFile = (file: File): string | null => {
  if (!file.size) return "Le fichier audio est vide.";
  if (file.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    return "Le fichier audio dépasse la limite de 100 Mo.";
  }
  const supportedMime = file.type.startsWith("audio/")
    || file.type === "video/mp4"
    || file.type === "video/webm"
    || file.type === "application/ogg";
  if (!supportedMime && !AUDIO_EXTENSIONS.has(extensionFor(file))) {
    return "Format non pris en charge. Utilise WAV, MP3, M4A, AAC, FLAC, OGG, OPUS ou WebM.";
  }
  return null;
};

const replacePreviewUrl = (file: File | null) => {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = file ? URL.createObjectURL(file) : "";
};

const chooseFile = (file: File) => {
  const validationError = validateAudioFile(file);
  if (validationError) {
    errorMessage = validationError;
    return;
  }
  selectedFile = file;
  replacePreviewUrl(file);
  result = null;
  errorMessage = "";
  copyFeedback = "";
};

const clearElapsedTimer = () => {
  if (elapsedTimer !== null) window.clearInterval(elapsedTimer);
  elapsedTimer = null;
};

const startElapsedTimer = () => {
  clearElapsedTimer();
  elapsedTimer = window.setInterval(() => {
    const target = document.querySelector<HTMLElement>("#transcriptionElapsed");
    if (target) target.textContent = elapsedLabel();
  }, 1_000);
};

const friendlyError = (error: unknown): string => {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Transcription annulée.";
  }
  return String(error instanceof Error ? error.message : error)
    .replace(/^Error:\s*/i, "")
    .replaceAll("annulee", "annulée")
    || "La transcription a échoué.";
};

const refreshRuntime = async (rerender = true) => {
  if (runtimeLoading) return;
  runtimeLoading = true;
  runtimeError = "";
  if (rerender && active) rerenderApp?.();
  try {
    runtimeStatus = await transcriptionRuntimeStatus();
  } catch (error) {
    runtimeError = friendlyError(error);
  } finally {
    runtimeLoading = false;
    if (rerender && active) rerenderApp?.();
  }
};

const submitTranscription = async () => {
  const file = selectedFile;
  if (!file || busy) return;
  const validationError = validateAudioFile(file);
  if (validationError) {
    errorMessage = validationError;
    rerenderApp?.();
    return;
  }

  busy = true;
  result = null;
  errorMessage = "";
  copyFeedback = "";
  startedAt = Date.now();
  abortController = new AbortController();
  rerenderApp?.();
  startElapsedTimer();
  void refreshRuntime(false);

  try {
    result = await transcribeAudioFile(file, language, outputMode, abortController.signal);
  } catch (error) {
    errorMessage = friendlyError(error);
  } finally {
    busy = false;
    abortController = null;
    clearElapsedTimer();
    void refreshRuntime(false);
    if (active) rerenderApp?.();
  }
};

const copyTranscript = async () => {
  if (!result?.text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(result.text);
    } else {
      const textarea = document.querySelector<HTMLTextAreaElement>("#transcriptionResultText");
      if (!textarea) throw new Error("Zone de texte introuvable");
      textarea.focus();
      textarea.select();
      if (!document.execCommand("copy")) throw new Error("Copie refusée");
    }
    copyFeedback = "Texte copié";
  } catch {
    copyFeedback = "Sélectionne le texte puis copie-le manuellement";
  }
  rerenderApp?.();
  if (feedbackTimer !== null) window.clearTimeout(feedbackTimer);
  feedbackTimer = window.setTimeout(() => {
    copyFeedback = "";
    if (active) rerenderApp?.();
  }, 4_000);
};

const downloadTranscript = () => {
  if (!result?.text) return;
  const baseName = (selectedFile?.name ?? result.fileName ?? "transcription")
    .replace(/\.[^.]+$/, "")
    .replace(/[^\p{L}\p{N}._-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    || "transcription";
  const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseName}.txt`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const resetPanel = () => {
  if (busy) return;
  selectedFile = null;
  replacePreviewUrl(null);
  result = null;
  errorMessage = "";
  copyFeedback = "";
  rerenderApp?.();
};

const statusPresentation = () => {
  if (runtimeLoading && !runtimeStatus) {
    return { tone: "checking", icon: "loader-circle", title: "Vérification du moteur…", detail: "Lecture du modèle configuré sur le VPS." };
  }
  if (!runtimeStatus) {
    return { tone: "error", icon: "circle-alert", title: "Moteur indisponible", detail: runtimeError || "Statut du VPS inconnu." };
  }
  const accelerator = runtimeStatus.transcriptionAccelerator
    || (runtimeStatus.gpu ? "gpu" : runtimeStatus.mode === "remote" ? "distant" : "cpu");
  const ready = runtimeStatus.transcriptionReady
    ?? (runtimeStatus.mode === "remote" || runtimeStatus.whisperReady);
  if (!ready) {
    return {
      tone: "error",
      icon: "circle-alert",
      title: "Whisper n’est pas configuré",
      detail: runtimeStatus.warning || "Configure le moteur de transcription sur le VPS.",
    };
  }
  if (runtimeStatus.stage === "transcribing") {
    return {
      tone: "active",
      icon: "audio-waveform",
      title: accelerator === "gpu" ? "GPU en transcription" : "Transcription en cours",
      detail: runtimeStatus.transcriptionModel,
    };
  }
  return {
    tone: "ready",
    icon: accelerator === "gpu" ? "badge-check" : "server",
    title: accelerator === "gpu" ? "GPU du VPS prêt" : "Moteur du VPS prêt",
    detail: runtimeStatus.transcriptionModel,
  };
};

const renderRuntimeStatus = (): string => {
  const presentation = statusPresentation();
  const gpu = runtimeStatus?.gpu;
  const accelerator = runtimeStatus?.transcriptionAccelerator
    || (gpu ? "gpu" : runtimeStatus?.mode === "remote" ? "distant" : "cpu");
  return `
    <aside class="transcription-runtime is-${presentation.tone}" aria-live="polite">
      <span class="transcription-runtime-icon"><i data-lucide="${presentation.icon}" class="${runtimeLoading ? "is-spinning" : ""}"></i></span>
      <span class="transcription-runtime-copy">
        <strong>${escapeHtml(presentation.title)}</strong>
        <small>${escapeHtml(presentation.detail)}</small>
      </span>
      <span class="transcription-runtime-meta">
        <b>${accelerator === "gpu" ? "CUDA" : accelerator === "cpu" ? "CPU" : "VPS"}</b>
        ${gpu ? `<small>${escapeHtml(gpu.name)} · ${gpu.memoryUsedMb}/${gpu.memoryTotalMb} Mo</small>` : ""}
      </span>
      <button type="button" id="transcriptionRuntimeRefresh" class="icon-button" title="Actualiser le moteur" aria-label="Actualiser le moteur" ${runtimeLoading ? "disabled" : ""}><i data-lucide="refresh-cw"></i></button>
    </aside>`;
};

const renderFilePicker = (): string => selectedFile
  ? `<div class="transcription-file-card">
      <span class="transcription-file-icon"><i data-lucide="file-audio"></i></span>
      <span class="transcription-file-copy">
        <strong>${escapeHtml(selectedFile.name)}</strong>
        <small>${formatBytes(selectedFile.size)} · ${escapeHtml(extensionFor(selectedFile).toUpperCase() || "AUDIO")}</small>
      </span>
      <audio controls preload="metadata" src="${escapeHtml(previewUrl)}"></audio>
      <button type="button" id="transcriptionFileRemove" class="icon-button" title="Retirer ce fichier" aria-label="Retirer ce fichier" ${busy ? "disabled" : ""}><i data-lucide="x"></i></button>
    </div>`
  : `<label class="transcription-dropzone" id="transcriptionDropzone" for="transcriptionFileInput">
      <input id="transcriptionFileInput" type="file" accept="audio/*,.mp3,.m4a,.mp4,.wav,.flac,.ogg,.oga,.opus,.webm,.aac,.wma,.amr,.aif,.aiff" />
      <span class="transcription-drop-icon"><i data-lucide="cloud-upload"></i></span>
      <span><strong>Dépose un fichier audio ici</strong><small>ou clique pour le choisir sur ton appareil</small></span>
      <b>WAV, MP3, M4A, FLAC, OGG, OPUS, WebM · 100 Mo max.</b>
    </label>`;

const renderBusyState = (): string => busy
  ? `<section class="transcription-progress" aria-live="polite">
      <span class="transcription-progress-icon"><i data-lucide="audio-waveform"></i></span>
      <span><strong>${outputMode === "faithful" ? "Whisper transcrit le fichier sur le GPU" : outputMode === "clean" ? "Transcription et nettoyage local en cours" : "Transcription et compte rendu en cours"}</strong><small>${outputMode === "faithful" ? "Les audios longs sont découpés automatiquement." : "Whisper transcrit, puis Qwen reformule le texte par blocs."}</small></span>
      <time id="transcriptionElapsed">${elapsedLabel()}</time>
      <span class="transcription-progress-track"><i></i></span>
      <button type="button" id="transcriptionCancel" class="tool-button"><i data-lucide="square"></i><span>Annuler</span></button>
    </section>`
  : "";

const renderResult = (): string => {
  if (!result) return "";
  const wordCount = result.text.trim() ? result.text.trim().split(/\s+/u).length : 0;
  const accelerator = result.accelerator === "gpu"
    ? "GPU CUDA"
    : result.accelerator === "cpu"
      ? "CPU"
      : "moteur distant";
  const outputLabel = result.outputMode === "summary"
    ? "Compte rendu"
    : result.outputMode === "clean" && result.postProcessed
      ? "Texte nettoyé"
      : "Transcription fidèle";
  const resultTitle = result.outputMode === "summary"
    ? "Compte rendu terminé"
    : result.outputMode === "clean" && result.postProcessed
      ? "Nettoyage terminé"
      : "Transcription terminée";
  const processingModel = result.postProcessingModel
    ? ` → ${escapeHtml(result.postProcessingModel)}`
    : "";
  return `<section class="transcription-result" aria-labelledby="transcriptionResultTitle">
    <header>
      <span><i data-lucide="file-check-2"></i></span>
      <div><h2 id="transcriptionResultTitle">${resultTitle}</h2><p>${escapeHtml(outputLabel)} · ${wordCount.toLocaleString("fr-FR")} mots · ${escapeHtml(result.model)}${processingModel} · ${escapeHtml(accelerator)} · ${formatDuration(result.processingMs)}</p></div>
      <div class="transcription-result-actions">
        <button type="button" id="transcriptionCopy" class="tool-button primary"><i data-lucide="copy"></i><span>Copier</span></button>
        <button type="button" id="transcriptionDownload" class="tool-button"><i data-lucide="download"></i><span>.txt</span></button>
      </div>
    </header>
    ${result.warning ? `<p class="transcription-warning"><i data-lucide="triangle-alert"></i>${escapeHtml(result.warning)}</p>` : ""}
    ${copyFeedback ? `<p class="transcription-copy-feedback" role="status">${escapeHtml(copyFeedback)}</p>` : ""}
    <textarea id="transcriptionResultText" readonly spellcheck="false" aria-label="Texte transcrit">${escapeHtml(result.text)}</textarea>
    <footer><span><i data-lucide="shield-check"></i>Le fichier temporaire est supprimé après traitement.</span><button type="button" id="transcriptionNew" class="tool-button"><i data-lucide="rotate-ccw"></i><span>Nouvel audio</span></button></footer>
  </section>`;
};

export const renderTranscriptionPanel = (): string => `
  <section class="transcription-page">
    <header class="transcription-hero">
      <div class="transcription-hero-copy">
        <span class="transcription-kicker"><i data-lucide="audio-lines"></i> Transcription GPU</span>
        <h1>Transforme un audio en texte</h1>
        <p>Envoie un enregistrement au VPS. Whisper le transcrit sur ton GPU, puis Qwen peut retirer les hésitations ou produire un compte rendu.</p>
      </div>
      <div class="transcription-hero-visual" aria-hidden="true">
        <i data-lucide="audio-waveform"></i><span></span><span></span><span></span><span></span><span></span>
      </div>
    </header>

    ${renderRuntimeStatus()}

    <form id="transcriptionForm" class="transcription-workbench">
      <section class="transcription-upload-card">
        <header><span><b>1</b><strong>Choisis l’audio</strong></span><small>Le fichier reste sélectionné tant que tu gardes cet onglet ouvert.</small></header>
        ${renderFilePicker()}
      </section>
      <section class="transcription-options-card">
        <header><span><b>2</b><strong>Choisis le résultat</strong></span><small>Le mode nettoyé conserve le fond tout en retirant les hésitations.</small></header>
        <div class="transcription-options-row">
          <label><span>Langue parlée</span><select id="transcriptionLanguage" ${busy ? "disabled" : ""}>
            <option value="auto" ${language === "auto" ? "selected" : ""}>Détection automatique</option>
            <option value="fr" ${language === "fr" ? "selected" : ""}>Français</option>
            <option value="en" ${language === "en" ? "selected" : ""}>Anglais</option>
            <option value="es" ${language === "es" ? "selected" : ""}>Espagnol</option>
            <option value="de" ${language === "de" ? "selected" : ""}>Allemand</option>
            <option value="it" ${language === "it" ? "selected" : ""}>Italien</option>
            <option value="pt" ${language === "pt" ? "selected" : ""}>Portugais</option>
          </select></label>
          <label><span>Format du texte</span><select id="transcriptionOutputMode" ${busy ? "disabled" : ""}>
            <option value="faithful" ${outputMode === "faithful" ? "selected" : ""}>Fidèle — sans reformulation</option>
            <option value="clean" ${outputMode === "clean" ? "selected" : ""}>Nettoyé — sans « euh » ni répétitions</option>
            <option value="summary" ${outputMode === "summary" ? "selected" : ""}>Compte rendu — structuré et concis</option>
          </select></label>
          <button type="submit" class="transcription-submit" ${!selectedFile || busy || runtimeStatus?.transcriptionReady === false ? "disabled" : ""}>
            <i data-lucide="sparkles"></i><span>${busy ? "Traitement en cours…" : outputMode === "faithful" ? "Transcrire sur le GPU" : outputMode === "clean" ? "Transcrire et nettoyer" : "Créer le compte rendu"}</span><i data-lucide="arrow-right"></i>
          </button>
        </div>
      </section>
    </form>

    ${errorMessage ? `<div class="transcription-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(errorMessage)}</span></div>` : ""}
    ${renderBusyState()}
    ${renderResult()}
  </section>`;

export const bindTranscriptionPanel = (rerender: () => void) => {
  rerenderApp = rerender;
  const input = document.querySelector<HTMLInputElement>("#transcriptionFileInput");
  input?.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) chooseFile(file);
    rerender();
  });

  const dropzone = document.querySelector<HTMLElement>("#transcriptionDropzone");
  if (dropzone) {
    const showDrag = (event: DragEvent) => {
      event.preventDefault();
      dropzone.classList.add("is-dragging");
    };
    dropzone.addEventListener("dragenter", showDrag);
    dropzone.addEventListener("dragover", showDrag);
    dropzone.addEventListener("dragleave", (event) => {
      if (!dropzone.contains(event.relatedTarget as Node | null)) dropzone.classList.remove("is-dragging");
    });
    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dropzone.classList.remove("is-dragging");
      const file = event.dataTransfer?.files?.[0];
      if (file) chooseFile(file);
      rerender();
    });
  }

  document.querySelector<HTMLButtonElement>("#transcriptionFileRemove")?.addEventListener("click", resetPanel);
  document.querySelector<HTMLSelectElement>("#transcriptionLanguage")?.addEventListener("change", (event) => {
    language = (event.currentTarget as HTMLSelectElement).value;
  });
  document.querySelector<HTMLSelectElement>("#transcriptionOutputMode")?.addEventListener("change", (event) => {
    outputMode = (event.currentTarget as HTMLSelectElement).value as VoiceOutputMode;
    rerender();
  });
  document.querySelector<HTMLFormElement>("#transcriptionForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitTranscription();
  });
  document.querySelector<HTMLButtonElement>("#transcriptionCancel")?.addEventListener("click", () => {
    abortController?.abort();
  });
  document.querySelector<HTMLButtonElement>("#transcriptionRuntimeRefresh")?.addEventListener("click", () => {
    void refreshRuntime();
  });
  document.querySelector<HTMLButtonElement>("#transcriptionCopy")?.addEventListener("click", () => {
    void copyTranscript();
  });
  document.querySelector<HTMLButtonElement>("#transcriptionDownload")?.addEventListener("click", downloadTranscript);
  document.querySelector<HTMLButtonElement>("#transcriptionNew")?.addEventListener("click", resetPanel);
};

export const activateTranscriptionPanel = (rerender: () => void) => {
  active = true;
  rerenderApp = rerender;
  if (!runtimeStatus && !runtimeLoading) void refreshRuntime();
  if (busy) startElapsedTimer();
};

export const deactivateTranscriptionPanel = () => {
  active = false;
  clearElapsedTimer();
};

export const refreshTranscriptionPanel = async (rerender: () => void, silent = false) => {
  rerenderApp = rerender;
  await refreshRuntime(!silent);
};
