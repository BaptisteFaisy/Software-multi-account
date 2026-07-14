export const CHAT_READY_SOUND_STORAGE_KEY = "codex-switch-terminal.chat-ready-sound.v1";
export const CHAT_READY_SOUND_MAX_DURATION_SECONDS = 5;

export type ChatReadySoundPreferences = {
  enabled: boolean;
  customSoundDataUrl: string | null;
  customSoundName: string | null;
  customSoundDuration: number | null;
};

export type ChatReadySoundStorage = Pick<Storage, "getItem" | "setItem">;

export const DEFAULT_CHAT_READY_SOUND_PREFERENCES: ChatReadySoundPreferences = {
  enabled: false,
  customSoundDataUrl: null,
  customSoundName: null,
  customSoundDuration: null,
};

const isStoredMp3DataUrl = (value: unknown): value is string =>
  typeof value === "string" && /^data:audio\/(?:mpeg|mp3)(?:;[^,]*)?,/i.test(value);

export const normalizeChatReadySoundPreferences = (
  value: unknown,
): ChatReadySoundPreferences => {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CHAT_READY_SOUND_PREFERENCES };
  }

  const candidate = value as Partial<ChatReadySoundPreferences>;
  const customSoundDataUrl = isStoredMp3DataUrl(candidate.customSoundDataUrl)
    ? candidate.customSoundDataUrl
    : null;
  const duration = Number(candidate.customSoundDuration);

  return {
    enabled: candidate.enabled === true,
    customSoundDataUrl,
    customSoundName:
      customSoundDataUrl && typeof candidate.customSoundName === "string"
        ? candidate.customSoundName.trim().slice(0, 160) || "Son personnalisé.mp3"
        : null,
    customSoundDuration:
      customSoundDataUrl &&
      Number.isFinite(duration) &&
      duration > 0 &&
      duration <= CHAT_READY_SOUND_MAX_DURATION_SECONDS
        ? duration
        : null,
  };
};

export const loadChatReadySoundPreferences = (
  storage: Pick<ChatReadySoundStorage, "getItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): ChatReadySoundPreferences => {
  try {
    const stored = storage?.getItem(CHAT_READY_SOUND_STORAGE_KEY);
    return stored
      ? normalizeChatReadySoundPreferences(JSON.parse(stored))
      : { ...DEFAULT_CHAT_READY_SOUND_PREFERENCES };
  } catch {
    return { ...DEFAULT_CHAT_READY_SOUND_PREFERENCES };
  }
};

export const persistChatReadySoundPreferences = (
  preferences: ChatReadySoundPreferences,
  storage: Pick<ChatReadySoundStorage, "setItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): boolean => {
  try {
    if (!storage) return false;
    storage.setItem(
      CHAT_READY_SOUND_STORAGE_KEY,
      JSON.stringify(normalizeChatReadySoundPreferences(preferences)),
    );
    return true;
  } catch {
    return false;
  }
};

const turnIsBusy = (status: string | null | undefined): boolean =>
  status === "running" || status === "finalizing";

export const chatBecameAvailable = (
  previousStatus: string | null | undefined,
  nextStatus: string | null | undefined,
): boolean => turnIsBusy(previousStatus) && !turnIsBusy(nextStatus);

export const isMp3File = (file: Pick<File, "name" | "type">): boolean => {
  const mime = file.type.trim().toLowerCase();
  return mime === "audio/mpeg" || mime === "audio/mp3" || file.name.toLowerCase().endsWith(".mp3");
};

export const chatReadySoundDurationError = (duration: number): string | null => {
  if (!Number.isFinite(duration) || duration <= 0) {
    return "Impossible de lire la durée de ce MP3.";
  }
  if (duration > CHAT_READY_SOUND_MAX_DURATION_SECONDS) {
    return `Ce MP3 dure ${duration.toFixed(1)} s. La durée maximale est de ${CHAT_READY_SOUND_MAX_DURATION_SECONDS} s.`;
  }
  return null;
};

const readAudioDuration = (file: File): Promise<number> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const audio = document.createElement("audio");
    let timeout: ReturnType<typeof globalThis.setTimeout> | null = null;

    const cleanup = () => {
      if (timeout !== null) globalThis.clearTimeout(timeout);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("error", handleError);
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(objectUrl);
    };

    const handleLoadedMetadata = () => {
      const duration = audio.duration;
      cleanup();
      const error = chatReadySoundDurationError(duration);
      if (error) reject(new Error(error));
      else resolve(duration);
    };
    const handleError = () => {
      cleanup();
      reject(new Error("Ce fichier ne semble pas être un MP3 lisible."));
    };

    timeout = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error("La lecture du MP3 a pris trop de temps."));
    }, 10_000);
    audio.preload = "metadata";
    audio.addEventListener("loadedmetadata", handleLoadedMetadata, { once: true });
    audio.addEventListener("error", handleError, { once: true });
    audio.src = objectUrl;
  });

const readMp3DataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Impossible de lire ce MP3."));
    }, { once: true });
    reader.addEventListener("error", () => reject(new Error("Impossible de lire ce MP3.")), {
      once: true,
    });
    const mp3 = file.type === "audio/mpeg" ? file : new Blob([file], { type: "audio/mpeg" });
    reader.readAsDataURL(mp3);
  });

export const readChatReadySoundFile = async (
  file: File,
): Promise<Pick<ChatReadySoundPreferences, "customSoundDataUrl" | "customSoundName" | "customSoundDuration">> => {
  if (!isMp3File(file)) {
    throw new Error("Choisissez un fichier MP3.");
  }

  const duration = await readAudioDuration(file);
  const dataUrl = await readMp3DataUrl(file);
  if (!isStoredMp3DataUrl(dataUrl)) {
    throw new Error("Ce fichier ne semble pas être un MP3 valide.");
  }

  return {
    customSoundDataUrl: dataUrl,
    customSoundName: file.name.trim().slice(0, 160) || "Son personnalisé.mp3",
    customSoundDuration: duration,
  };
};

type WebkitAudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

let readySoundAudioContext: AudioContext | null = null;
let currentCustomAudio: HTMLAudioElement | null = null;

const getAudioContext = (): AudioContext | null => {
  if (readySoundAudioContext) return readySoundAudioContext;
  if (typeof window === "undefined") return null;
  const AudioContextConstructor = window.AudioContext ||
    (window as WebkitAudioWindow).webkitAudioContext;
  if (!AudioContextConstructor) return null;
  readySoundAudioContext = new AudioContextConstructor();
  return readySoundAudioContext;
};

export const unlockChatReadySound = async (): Promise<boolean> => {
  const context = getAudioContext();
  if (!context) return false;
  try {
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
};

const playDefaultReadyChime = async (): Promise<boolean> => {
  const context = getAudioContext();
  if (!context || !(await unlockChatReadySound())) return false;

  const now = context.currentTime + 0.015;
  const notes = [
    { frequency: 523.25, start: 0, duration: 0.52, volume: 0.045 },
    { frequency: 659.25, start: 0.11, duration: 0.62, volume: 0.04 },
    { frequency: 783.99, start: 0.22, duration: 0.72, volume: 0.035 },
  ];

  notes.forEach((note) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + note.start;
    const end = start + note.duration;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.volume, start + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
    oscillator.start(start);
    oscillator.stop(end + 0.02);
  });
  return true;
};

export const playChatReadySound = async (
  preferences: ChatReadySoundPreferences,
): Promise<boolean> => {
  if (!preferences.enabled) return false;

  if (preferences.customSoundDataUrl) {
    if (typeof Audio === "undefined") return false;
    try {
      currentCustomAudio?.pause();
      const audio = new Audio(preferences.customSoundDataUrl);
      audio.volume = 0.42;
      currentCustomAudio = audio;
      audio.addEventListener("ended", () => {
        if (currentCustomAudio === audio) currentCustomAudio = null;
      }, { once: true });
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  return playDefaultReadyChime();
};
