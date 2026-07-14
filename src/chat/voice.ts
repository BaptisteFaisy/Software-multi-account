import { invoke } from "../platform";

const TARGET_SAMPLE_RATE = 16_000;
const MAX_RECORDING_MS = 5 * 60 * 1_000;
const MIN_RECORDING_MS = 350;

type VoiceProcessResponse = {
  transcript: string;
  summary: string;
  summarized: boolean;
  warning?: string | null;
  transcriptionModel: string;
  summaryModel: string;
  transcriptionProvider: string;
  summaryProvider: string;
  transcriptionMs: number;
  summaryMs: number;
};

type VoiceSessionState = "requesting" | "recording" | "processing";

type VoiceSession = {
  promptId: string;
  buttonId: string;
  statusId: string;
  state: VoiceSessionState;
  message: string;
  recorder: PcmVoiceRecorder | null;
  startedAt: number;
  elapsedTimer: number | null;
  limitTimer: number | null;
};

let activeSession: VoiceSession | null = null;

class PcmVoiceRecorder {
  private constructor(
    private readonly stream: MediaStream,
    private readonly context: AudioContext,
    private readonly source: MediaStreamAudioSourceNode,
    private readonly processor: ScriptProcessorNode,
    private readonly silentGain: GainNode,
    private readonly chunks: Float32Array[],
    private readonly startedAt: number,
  ) {}

  static async start(): Promise<PcmVoiceRecorder> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Le micro exige l'application desktop, localhost ou une page HTTPS.",
      );
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });

    try {
      const AudioContextConstructor = window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) {
        throw new Error("La capture audio Web Audio n'est pas disponible sur cet appareil.");
      }
      const context = new AudioContextConstructor();
      if (context.state === "suspended") await context.resume();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4_096, 1, 1);
      const silentGain = context.createGain();
      const chunks: Float32Array[] = [];
      silentGain.gain.value = 0;
      processor.onaudioprocess = (event) => {
        const channel = event.inputBuffer.getChannelData(0);
        chunks.push(new Float32Array(channel));
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      return new PcmVoiceRecorder(
        stream,
        context,
        source,
        processor,
        silentGain,
        chunks,
        performance.now(),
      );
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
  }

  async stop(): Promise<{ wav: Uint8Array; durationMs: number }> {
    this.processor.onaudioprocess = null;
    this.source.disconnect();
    this.processor.disconnect();
    this.silentGain.disconnect();
    this.stream.getTracks().forEach((track) => track.stop());
    await this.context.close().catch(() => undefined);

    const durationMs = performance.now() - this.startedAt;
    const samples = concatenateSamples(this.chunks);
    if (!samples.length || durationMs < MIN_RECORDING_MS) {
      throw new Error("L'enregistrement est trop court. Parle au moins une seconde.");
    }
    const mono16k = downsample(samples, this.context.sampleRate, TARGET_SAMPLE_RATE);
    return { wav: encodeWav(mono16k, TARGET_SAMPLE_RATE), durationMs };
  }
}

const concatenateSamples = (chunks: Float32Array[]): Float32Array => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, offset);
    offset += chunk.length;
  });
  return samples;
};

const downsample = (
  samples: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array => {
  if (sourceRate <= targetRate) return samples;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.floor(samples.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * ratio)));
    let sum = 0;
    for (let sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
      sum += samples[sourceIndex];
    }
    output[index] = sum / (end - start);
  }
  return output;
};

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const encodeWav = (samples: Float32Array, sampleRate: number): Uint8Array => {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, index) => {
    const sample = Math.max(-1, Math.min(1, value));
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  });
  return bytes;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(parts.join(""));
};

const voiceElements = (session: VoiceSession) => ({
  prompt: document.getElementById(session.promptId) as HTMLTextAreaElement | null,
  button: document.getElementById(session.buttonId) as HTMLButtonElement | null,
  status: document.getElementById(session.statusId) as HTMLElement | null,
});

const syncSessionUi = (session: VoiceSession) => {
  const { button, status } = voiceElements(session);
  if (button) {
    button.classList.toggle("is-requesting", session.state === "requesting");
    button.classList.toggle("is-recording", session.state === "recording");
    button.classList.toggle("is-processing", session.state === "processing");
    button.setAttribute("aria-pressed", String(session.state === "recording"));
    button.title = session.state === "recording"
      ? "Terminer la dictee"
      : session.state === "processing"
        ? "Transcription et resume local en cours"
        : "Autorisation du micro";
  }
  if (status) {
    status.textContent = session.message;
    status.dataset.tone = session.state === "recording" ? "recording" : "working";
  }
};

const clearSessionTimers = (session: VoiceSession) => {
  if (session.elapsedTimer !== null) window.clearInterval(session.elapsedTimer);
  if (session.limitTimer !== null) window.clearTimeout(session.limitTimer);
  session.elapsedTimer = null;
  session.limitTimer = null;
};

const formatElapsed = (milliseconds: number) => {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const resetVoiceButton = (buttonId: string) => {
  const button = document.getElementById(buttonId) as HTMLButtonElement | null;
  button?.classList.remove("is-requesting", "is-recording", "is-processing");
  button?.setAttribute("aria-pressed", "false");
  if (button) button.title = "Dicter puis resumer localement";
};

const showFinalStatus = (
  buttonId: string,
  statusId: string,
  message: string,
  tone: "success" | "warning" | "error",
) => {
  resetVoiceButton(buttonId);
  const status = document.getElementById(statusId) as HTMLElement | null;
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
  window.setTimeout(() => {
    const current = document.getElementById(statusId) as HTMLElement | null;
    if (current?.textContent === message) {
      current.textContent = "";
      delete current.dataset.tone;
    }
  }, tone === "error" ? 12_000 : 8_000);
};

const insertVoiceText = (prompt: HTMLTextAreaElement, text: string) => {
  const cleaned = text.trim();
  if (!cleaned) return;
  const previous = prompt.value.trimEnd();
  prompt.value = previous ? `${previous}\n\n${cleaned}` : cleaned;
  prompt.dispatchEvent(new Event("input", { bubbles: true }));
  prompt.focus();
  prompt.setSelectionRange(prompt.value.length, prompt.value.length);
};

const friendlyVoiceError = (error: unknown): string => {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Acces au micro refuse. Autorise le micro dans Windows ou dans le navigateur.";
    }
    if (error.name === "NotFoundError") return "Aucun micro n'a ete detecte.";
    if (error.name === "NotReadableError") return "Le micro est deja utilise par une autre application.";
  }
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "") || "La saisie vocale a echoue.";
};

const finishVoiceSession = async (session: VoiceSession) => {
  if (activeSession !== session || session.state !== "recording" || !session.recorder) return;
  clearSessionTimers(session);
  session.state = "processing";
  session.message = "Transcription et reformulation en cours...";
  syncSessionUi(session);

  try {
    const { wav, durationMs } = await session.recorder.stop();
    if (durationMs < MIN_RECORDING_MS) {
      throw new Error("L'enregistrement est trop court. Parle au moins une seconde.");
    }
    const result = await invoke<VoiceProcessResponse>("process_voice_input", {
      audioBase64: bytesToBase64(wav),
      mimeType: "audio/wav",
      language: (navigator.language || "fr").split("-")[0].toLowerCase(),
    });
    const { prompt } = voiceElements(session);
    if (!prompt) throw new Error("Le champ du chat a ete ferme pendant la transcription.");
    insertVoiceText(prompt, result.summary || result.transcript);
    activeSession = null;
    if (result.warning || !result.summarized) {
      showFinalStatus(
        session.buttonId,
        session.statusId,
        result.warning || "Transcription inseree; resume local indisponible.",
        "warning",
      );
    } else {
      const elapsed = ((result.transcriptionMs + result.summaryMs) / 1_000).toFixed(1);
      const location = result.transcriptionProvider.includes("remote") ||
          result.summaryProvider.includes("remote")
        ? "via GPU distant"
        : "en local";
      showFinalStatus(
        session.buttonId,
        session.statusId,
        `Texte vocal insere ${location} (${elapsed} s)`,
        "success",
      );
    }
  } catch (error) {
    activeSession = null;
    showFinalStatus(
      session.buttonId,
      session.statusId,
      friendlyVoiceError(error),
      "error",
    );
  }
};

const startVoiceSession = async (
  prompt: HTMLTextAreaElement,
  button: HTMLButtonElement,
  status: HTMLElement,
) => {
  if (activeSession) {
    if (activeSession.promptId === prompt.id && activeSession.state === "recording") {
      await finishVoiceSession(activeSession);
      return;
    }
    const current = activeSession;
    current.message = current.state === "processing"
      ? "Le message vocal est deja en cours de traitement."
      : "Un autre chat utilise deja le micro.";
    syncSessionUi(current);
    return;
  }

  const session: VoiceSession = {
    promptId: prompt.id,
    buttonId: button.id,
    statusId: status.id,
    state: "requesting",
    message: "Autorisation du micro...",
    recorder: null,
    startedAt: performance.now(),
    elapsedTimer: null,
    limitTimer: null,
  };
  activeSession = session;
  syncSessionUi(session);

  try {
    session.recorder = await PcmVoiceRecorder.start();
    if (activeSession !== session) {
      await session.recorder.stop().catch(() => undefined);
      return;
    }
    session.state = "recording";
    session.startedAt = performance.now();
    session.message = "Ecoute 0:00 - clique pour terminer";
    syncSessionUi(session);
    session.elapsedTimer = window.setInterval(() => {
      if (activeSession !== session || session.state !== "recording") return;
      session.message = `Ecoute ${formatElapsed(performance.now() - session.startedAt)} - clique pour terminer`;
      syncSessionUi(session);
    }, 500);
    session.limitTimer = window.setTimeout(() => {
      void finishVoiceSession(session);
    }, MAX_RECORDING_MS);
  } catch (error) {
    activeSession = null;
    showFinalStatus(button.id, status.id, friendlyVoiceError(error), "error");
  }
};

/** Branche le bouton vocal d'un compositeur, principal ou multi-chat. */
export const bindVoiceComposer = (root: ParentNode) => {
  const prompt = root.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']");
  const button = root.querySelector<HTMLButtonElement>("[data-chat-action='voice']");
  const status = root.querySelector<HTMLElement>("[data-chat-control='voice-status']");
  if (!prompt || !button || !status || button.dataset.voiceBound === "true") return;
  button.dataset.voiceBound = "true";
  button.addEventListener("click", () => {
    void startVoiceSession(prompt, button, status);
  });
  if (activeSession?.promptId === prompt.id) syncSessionUi(activeSession);
};
