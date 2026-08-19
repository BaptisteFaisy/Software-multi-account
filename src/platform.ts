import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { TerminalInputBuffer, terminalTransportErrorMessage } from "./terminal-transport";
import {
  rankRemoteAllocations,
  type RemoteAllocationObservation,
} from "./remote-allocation";

export type UnlistenFn = () => void;

export type RealtimeConnectionState = "connecting" | "live" | "reconnecting" | "closed" | "unsupported";

export type DiscussionStreamMessage =
  | { type: "dashboard"; dashboard: unknown }
  | { type: "transcript"; accountId: string; sessionId: string; transcript: unknown }
  | { type: "error"; message: string }
  | { type: "pong" };

export type RuntimeSyncTopic = "activeChatTurns" | "autonomousAgents" | "privateMessages";

export type RuntimeSyncMessage =
  | { type: "hello" | "resync"; revision: number }
  | { type: "change"; topic: RuntimeSyncTopic; revision: number }
  | { type: "pong" };

type Listener<T> = (event: { payload: T }) => void;

type RemoteStartResponse = {
  id: number;
  workspaceId: string;
  workspacePath: string;
};

type RemoteNodeConfig = {
  id: string;
  label: string;
  baseUrl: string;
  token: string;
  priority: number;
};

type RemoteNodeHealth = {
  ok: boolean;
  nodeId: string;
  nodeLabel: string;
  publicBaseUrl: string;
  activeTerminals: number;
  activeChatTurns?: number;
  availableAccountIds?: string[];
  capacity: number;
  startedAt: number;
  // Champs ajoutes par le serveur self-updating. Optionnels : un ancien noeud
  // (avant cette version) ne les renvoie pas -> traite comme non draine / pret.
  version?: string;
  commit?: string;
  ready?: boolean;
  draining?: boolean;
};

type RemoteTerminalRoute = {
  label: string;
  baseUrl: string;
  token: string;
};

type RemoteWsMessage =
  | { type: "data"; id: number; data: string }
  | { type: "exit"; id: number }
  | { type: "error"; id: number; message: string }
  | { type: "status"; id: number; status: string; workspaceId: string; workspacePath: string }
  | { type: "pong"; id: number };

type ClientStartupConfig = {
  remoteMode: boolean;
  baseUrl?: string | null;
  token?: string | null;
  nodes?: string | null;
};

export type ChatExecutionTarget = {
  id: string;
  label: string;
  primary: boolean;
};

export type VoiceOutputMode = "faithful" | "clean" | "summary";

export type AudioFileTranscriptionResponse = {
  text: string;
  fileName: string;
  language: string;
  model: string;
  provider: string;
  accelerator: "gpu" | "cpu" | "distant" | string;
  outputMode: VoiceOutputMode;
  postProcessed: boolean;
  postProcessingModel?: string | null;
  postProcessingMs: number;
  processingMs: number;
  warning?: string | null;
};

export type TranscriptionRuntimeStatus = {
  mode: "local" | "remote" | string;
  state: "active" | "loaded" | "inactive" | "unavailable" | string;
  stage: "idle" | "transcribing" | "summarizing" | string;
  transcriptionModel: string;
  transcriptionTarget: string;
  transcriptionAccelerator?: string;
  transcriptionReady?: boolean;
  whisperReady: boolean;
  gpu?: {
    index: number;
    name: string;
    utilizationPercent: number;
    memoryUsedMb: number;
    memoryTotalMb: number;
  } | null;
  warning?: string | null;
};

export const MAX_TRANSCRIPTION_AUDIO_BYTES = 100 * 1024 * 1024;

type MobileBridge = {
  getBaseUrl?: () => string;
  getToken?: () => string;
  setConfig?: (baseUrl: string, token: string) => void;
  openSettings?: () => void;
  openPaymentSettings?: () => void;
  openGooglePaySettings?: () => void;
  openExternalHttpsUrl?: (url: string) => boolean;
  consumePaymentHandoff?: () => string;
  consumeAutonomousAgentHandoff?: () => string;
};

export type MobilePaymentHandoff = {
  agentId: string;
  paymentId: string;
};

export type MobileAutonomousAgentHandoff = {
  agentId: string;
};

const REMOTE_ENABLED_KEY = "codex-switch-terminal.remote.enabled";
const REMOTE_BASE_URL_KEY = "codex-switch-terminal.remote.base-url";
const REMOTE_TOKEN_KEY = "codex-switch-terminal.remote.token";
const REMOTE_NODES_KEY = "codex-switch-terminal.remote.nodes";
const REMOTE_BOOTSTRAP_TIMEOUT_MS = 8_000;

const listeners = new Map<string, Set<Listener<any>>>();
const remoteSockets = new Map<number, WebSocket>();
const remoteTerminalRoutes = new Map<number, RemoteTerminalRoute>();
const REMOTE_TERMINAL_OUTPUT_LIMIT = 32_768;
const remoteTerminalOutput = new Map<number, string>();
const remoteChatTurnRoutes = new Map<number, { route: RemoteTerminalRoute; remoteId: number }>();
const remoteChatTurnIds = new Map<string, number>();
const remoteSessionRoutes = new Map<string, RemoteTerminalRoute>();
const remoteStartingTerminals = new Set<number>();
const remotePendingTerminalInput = new TerminalInputBuffer();
const remoteTerminalReconnectTimers = new Map<number, number>();
const remoteTerminalReconnectAttempts = new Map<number, number>();
const remoteStoppingTerminals = new Set<number>();
let terminalCandidatesInFlight: {
  configKey: string;
  promise: Promise<RemoteTerminalRoute[]>;
} | null = null;
let nextRemoteChatTurnId = Number.MAX_SAFE_INTEGER;
let remoteChatStartQueue: Promise<void> = Promise.resolve();
let startupRemoteNodes = "";

const REMOTE_TERMINAL_MAX_RECONNECTS = 6;

const viteRemoteBase =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CST_API_BASE_URL
    ? String(import.meta.env.VITE_CST_API_BASE_URL)
    : "") || "";
const viteRemoteNodes =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_CST_REMOTE_NODES
    ? String(import.meta.env.VITE_CST_REMOTE_NODES)
    : "") || "";

export const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const isRemoteMode = () =>
  !isTauriRuntime() ||
  localStorage.getItem(REMOTE_ENABLED_KEY) === "1" ||
  viteRemoteBase.trim().length > 0;

export const remoteBaseUrl = () => {
  const saved = localStorage.getItem(REMOTE_BASE_URL_KEY)?.trim();
  if (saved) {
    try {
      const savedUrl = new URL(saved);
      const savedHost = savedUrl.hostname.toLowerCase();
      const currentHost = window.location.hostname.toLowerCase();
      const savedIsLoopback =
        savedHost === "127.0.0.1" || savedHost === "localhost" || savedHost === "::1";
      const currentIsLoopback =
        currentHost === "127.0.0.1" || currentHost === "localhost" || currentHost === "::1";

      // Une URL loopback enregistree sur le PC ne doit jamais etre reutilisee
      // depuis le site Tailscale sur un telephone : 127.0.0.1 pointerait alors
      // vers le telephone et tous les appels termineraient en "Failed to fetch".
      if (savedIsLoopback && !currentIsLoopback) {
        localStorage.removeItem(REMOTE_BASE_URL_KEY);
      } else {
        return saved.replace(/\/+$/, "");
      }
    } catch {
      localStorage.removeItem(REMOTE_BASE_URL_KEY);
    }
  }
  if (viteRemoteBase.trim()) return viteRemoteBase.trim().replace(/\/+$/, "");
  return window.location.origin.replace(/\/+$/, "");
};

export const remoteToken = () => localStorage.getItem(REMOTE_TOKEN_KEY)?.trim() ?? "";

export const remoteNodesText = () =>
  localStorage.getItem(REMOTE_NODES_KEY)?.trim() || startupRemoteNodes.trim() || viteRemoteNodes.trim();

export const hasRemoteAuth = () => !isRemoteMode() || remoteToken().length > 0;

const mobileBridge = (): MobileBridge | null => {
  if (typeof window === "undefined") return null;
  const nativeWindow = window as Window & {
    CstAndroid?: MobileBridge;
    CstIOS?: MobileBridge;
  };
  return nativeWindow.CstIOS ?? nativeWindow.CstAndroid ?? null;
};

export const hasMobileSettings = () =>
  typeof mobileBridge()?.openSettings === "function";

export const openMobileSettings = () => {
  const openSettings = mobileBridge()?.openSettings;
  if (!openSettings) return false;
  try {
    openSettings();
    return true;
  } catch {
    return false;
  }
};

export const hasMobilePaymentSettings = () =>
  typeof mobileBridge()?.openPaymentSettings === "function";

export const openMobilePaymentSettings = () => {
  const openSettings = mobileBridge()?.openPaymentSettings;
  if (!openSettings) return false;
  try {
    openSettings();
    return true;
  } catch {
    return false;
  }
};

export const hasMobileGooglePaySettings = () =>
  typeof mobileBridge()?.openGooglePaySettings === "function";

export const openMobileGooglePaySettings = () => {
  const openSettings = mobileBridge()?.openGooglePaySettings;
  if (!openSettings) return false;
  try {
    openSettings();
    return true;
  } catch {
    return false;
  }
};

const paymentHandoffIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseMobilePaymentHandoff = (value: unknown): MobilePaymentHandoff | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MobilePaymentHandoff>;
  if (
    typeof candidate.agentId !== "string"
    || typeof candidate.paymentId !== "string"
    || !paymentHandoffIdPattern.test(candidate.agentId)
    || !paymentHandoffIdPattern.test(candidate.paymentId)
  ) return null;
  return { agentId: candidate.agentId, paymentId: candidate.paymentId };
};

export const installMobilePaymentHandoffListener = (
  handler: (handoff: MobilePaymentHandoff) => void,
): UnlistenFn => {
  const target = window as Window & { __cstPaymentHandoffReady?: boolean };
  const onHandoff = (event: Event) => {
    const handoff = parseMobilePaymentHandoff((event as CustomEvent<unknown>).detail);
    if (handoff) handler(handoff);
  };
  window.addEventListener("cst:payment-handoff", onHandoff);
  target.__cstPaymentHandoffReady = true;

  try {
    const raw = mobileBridge()?.consumePaymentHandoff?.()?.trim();
    if (raw) {
      const handoff = parseMobilePaymentHandoff(JSON.parse(raw));
      if (handoff) queueMicrotask(() => handler(handoff));
    }
  } catch {
    // Une intention native perimee ne doit jamais empecher le demarrage web.
  }

  return () => {
    window.removeEventListener("cst:payment-handoff", onHandoff);
    target.__cstPaymentHandoffReady = false;
  };
};

const parseMobileAutonomousAgentHandoff = (
  value: unknown,
): MobileAutonomousAgentHandoff | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<MobileAutonomousAgentHandoff>;
  if (
    typeof candidate.agentId !== "string"
    || !paymentHandoffIdPattern.test(candidate.agentId)
  ) return null;
  return { agentId: candidate.agentId };
};

export const installMobileAutonomousAgentHandoffListener = (
  handler: (handoff: MobileAutonomousAgentHandoff) => void,
): UnlistenFn => {
  const target = window as Window & { __cstAutonomousAgentHandoffReady?: boolean };
  const onHandoff = (event: Event) => {
    const handoff = parseMobileAutonomousAgentHandoff(
      (event as CustomEvent<unknown>).detail,
    );
    if (handoff) handler(handoff);
  };
  window.addEventListener("cst:autonomous-agent-handoff", onHandoff);
  target.__cstAutonomousAgentHandoffReady = true;

  try {
    const raw = mobileBridge()?.consumeAutonomousAgentHandoff?.()?.trim();
    if (raw) {
      const handoff = parseMobileAutonomousAgentHandoff(JSON.parse(raw));
      if (handoff) queueMicrotask(() => handler(handoff));
    }
  } catch {
    // Une intention native perimee ne doit jamais empecher le demarrage web.
  }

  return () => {
    window.removeEventListener("cst:autonomous-agent-handoff", onHandoff);
    target.__cstAutonomousAgentHandoffReady = false;
  };
};

export const openExternalHttpsUrl = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Seuls les liens HTTPS sans identifiants peuvent etre ouverts.");
  }

  const nativeOpen = mobileBridge()?.openExternalHttpsUrl;
  if (nativeOpen) {
    if (!nativeOpen(url.toString())) {
      throw new Error("Android a refusé l'ouverture de ce lien HTTPS.");
    }
    return;
  }

  if (isTauriRuntime()) {
    await tauriOpenUrl(url.toString());
    return;
  }

  const externalWindow = window.open(url.toString(), "_blank", "noopener,noreferrer");
  if (!externalWindow) {
    throw new Error("Le navigateur a bloque l'ouverture du paiement.");
  }
  externalWindow.opener = null;
};

const readMobileBridgeConfig = () => {
  const bridge = mobileBridge();
  if (!bridge) return null;

  try {
    return {
      baseUrl: bridge.getBaseUrl?.()?.trim() ?? "",
      token: bridge.getToken?.()?.trim() ?? "",
    };
  } catch {
    return null;
  }
};

export const saveRemoteConfig = (baseUrl: string, token: string, nodesText?: string) => {
  const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
  const normalizedToken = token.trim();
  localStorage.setItem(REMOTE_ENABLED_KEY, "1");
  localStorage.setItem(REMOTE_BASE_URL_KEY, normalizedBaseUrl);
  localStorage.setItem(REMOTE_TOKEN_KEY, normalizedToken);
  if (nodesText !== undefined) {
    const normalizedNodes = nodesText.trim();
    if (normalizedNodes) {
      localStorage.setItem(REMOTE_NODES_KEY, normalizedNodes);
    } else {
      localStorage.removeItem(REMOTE_NODES_KEY);
    }
  }

  try {
    mobileBridge()?.setConfig?.(normalizedBaseUrl, normalizedToken);
  } catch {
    // Les ponts Android/iOS sont optionnels ; localStorage reste la source web.
  }
};

export type RemoteConnectionRepairResult = {
  baseUrl: string;
  status: number;
};

export const repairRemoteConnection = async (): Promise<RemoteConnectionRepairResult> => {
  const baseUrl = window.location.origin.replace(/\/+$/, "");
  const token = remoteToken();

  // La page courante est la seule origine fiable : sur un telephone, une
  // ancienne valeur 127.0.0.1 viserait le telephone et non le PC serveur.
  localStorage.setItem(REMOTE_ENABLED_KEY, "1");
  localStorage.setItem(REMOTE_BASE_URL_KEY, baseUrl);
  try {
    mobileBridge()?.setConfig?.(baseUrl, token);
  } catch {
    // localStorage suffit pour le navigateur et la PWA.
  }

  // Tailscale ou le reverse proxy peut demander quelques centaines de ms pour
  // retablir le tunnel : on tente deux fois la health check avant de declarer
  // le serveur injoignable. La cause de la premiere tentative est conservee
  // pour diagnostiquer l'erreur finale.
  let lastError: unknown = null;
  let response: Response | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    try {
      response = await fetch(`${baseUrl}/api/health`, {
        cache: "no-store",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        signal: controller.signal,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  if (!response) {
    const aborted = lastError instanceof Error
      && /abort/i.test(lastError.name);
    const detail = aborted
      ? "Le serveur ne repond pas apres 8 secondes."
      : "Le serveur reste injoignable.";
    throw new Error(`${detail} Verifiez Tailscale puis reessayez.`, {
      cause: lastError ?? undefined,
    });
  }

  // Supprime uniquement les caches statiques de l'application. Les donnees,
  // tokens et historiques de chats restent intacts.
  if (typeof caches !== "undefined") {
    const keys = await caches.keys().catch(() => []);
    await Promise.all(
      keys
        .filter((key) => key.startsWith("codex-terminal-static-"))
        .map((key) => caches.delete(key)),
    );
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => []);
    await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
  }

  return { baseUrl, status: response.status };
};

export const initializePlatform = async () => {
  const mobileConfig = readMobileBridgeConfig();
  if (mobileConfig?.baseUrl || mobileConfig?.token) {
    localStorage.setItem(REMOTE_ENABLED_KEY, "1");
    if (mobileConfig.baseUrl) {
      localStorage.setItem(REMOTE_BASE_URL_KEY, mobileConfig.baseUrl.replace(/\/+$/, ""));
    }
    if (mobileConfig.token) {
      localStorage.setItem(REMOTE_TOKEN_KEY, mobileConfig.token);
    }
  }

  if (!isTauriRuntime()) return;

  try {
    const config = await tauriInvoke<ClientStartupConfig>("client_startup_config");
    if (!config.remoteMode) {
      // L'application locale et l'application Cloud partagent le meme profil
      // WebView. Un ancien lancement Cloud ne doit pas forcer les lancements
      // locaux suivants a continuer d'utiliser fetch() vers ce serveur.
      localStorage.removeItem(REMOTE_ENABLED_KEY);
      return;
    }

    const startupNodes = config.nodes?.trim() ?? "";
    const startupPrimaryNode = startupNodes
      .split(/\r?\n/)
      .map((line, index) => parseRemoteNodeLine(line, index))
      .filter((node): node is RemoteNodeConfig => node !== null)
      .sort((left, right) => left.priority - right.priority)[0];
    const startupBaseUrl = config.baseUrl?.trim() || startupPrimaryNode?.baseUrl || "";
    const startupToken = config.token?.trim() || startupPrimaryNode?.token || "";

    localStorage.setItem(REMOTE_ENABLED_KEY, "1");
    if (startupBaseUrl) {
      localStorage.setItem(REMOTE_BASE_URL_KEY, startupBaseUrl.replace(/\/+$/, ""));
    }
    if (startupToken) {
      localStorage.setItem(REMOTE_TOKEN_KEY, startupToken);
    }
    // La liste peut contenir un token propre a chaque noeud. Lorsqu'elle vient
    // du lanceur, elle reste en memoire pour ne pas etre persistee dans le
    // profil WebView.
    startupRemoteNodes = startupNodes;
  } catch {
    // Older desktop builds do not have the command; keep local behavior.
  }
};

export const clearRemoteConfig = () => {
  localStorage.removeItem(REMOTE_TOKEN_KEY);
  try {
    mobileBridge()?.setConfig?.(remoteBaseUrl(), "");
  } catch {
    // La deconnexion web reste effective meme si le pont natif est indisponible.
  }
};

const tauriWindow = isTauriRuntime() ? getCurrentWindow() : null;

type BrowserFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type BrowserFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const browserFullscreenElement = () => {
  if (typeof document === "undefined") return null;
  const fullscreenDocument = document as BrowserFullscreenDocument;
  return document.fullscreenElement ?? fullscreenDocument.webkitFullscreenElement ?? null;
};

const setBrowserFullscreen = async (fullscreen: boolean) => {
  if (typeof document === "undefined") {
    throw new Error("Le plein ecran n'est pas disponible dans cet environnement.");
  }

  const fullscreenDocument = document as BrowserFullscreenDocument;
  if (fullscreen) {
    if (browserFullscreenElement()) return;
    const root = document.documentElement as BrowserFullscreenElement;
    const requestFullscreen = root.requestFullscreen?.bind(root) ??
      root.webkitRequestFullscreen?.bind(root);
    if (!requestFullscreen) {
      throw new Error("Ce navigateur ne prend pas en charge le mode plein ecran.");
    }
    await requestFullscreen();
    return;
  }

  if (!browserFullscreenElement()) return;
  const exitFullscreen = document.exitFullscreen?.bind(document) ??
    fullscreenDocument.webkitExitFullscreen?.bind(fullscreenDocument);
  if (!exitFullscreen) {
    throw new Error("Impossible de quitter le mode plein ecran dans ce navigateur.");
  }
  await exitFullscreen();
};

export const appWindow = {
  isFullscreen: async () =>
    tauriWindow ? tauriWindow.isFullscreen() : browserFullscreenElement() !== null,
  setFullscreen: async (fullscreen: boolean) => {
    if (tauriWindow) {
      await tauriWindow.setFullscreen(fullscreen);
      return;
    }
    await setBrowserFullscreen(fullscreen);
  },
};

export async function listen<T>(event: string, handler: Listener<T>): Promise<UnlistenFn> {
  if (!isRemoteMode()) {
    return tauriListen<T>(event, handler);
  }

  const set = listeners.get(event) ?? new Set<Listener<any>>();
  set.add(handler);
  listeners.set(event, set);
  return () => {
    set.delete(handler);
  };
}

/**
 * Souscrit au flux partage des discussions du serveur. Sans options, le flux
 * suit l'index ; avec accountId/sessionId il suit le transcript correspondant.
 * La reconnexion est automatique (reseau mobile, sortie de veille, WebView mise
 * en arriere-plan). Le runtime Tauri local utilise le repli par polling de
 * main.ts, car il n'a pas de serveur HTTP a joindre.
 */
export function subscribeDiscussionUpdates(
  options: { accountId?: string; sessionId?: string },
  onMessage: (message: DiscussionStreamMessage) => void,
  onState?: (state: RealtimeConnectionState) => void,
): UnlistenFn {
  if (!isRemoteMode()) {
    onState?.("unsupported");
    return () => undefined;
  }

  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: number | null = null;
  let heartbeatTimer: number | null = null;
  let retryCount = 0;
  let lastMessageAt = 0;

  const clearRetry = () => {
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const clearHeartbeat = () => {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const startHeartbeat = (target: WebSocket) => {
    clearHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (socket !== target || target.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt > 45_000) {
        target.close();
        return;
      }
      target.send(JSON.stringify({ type: "ping" }));
    }, 15_000);
  };

  const connect = () => {
    if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
      return;
    }
    clearRetry();
    onState?.(retryCount > 0 ? "reconnecting" : "connecting");

    const route = options.accountId && options.sessionId
      ? remoteSessionRoute(options.accountId, options.sessionId) ?? defaultRemoteRoute()
      : defaultRemoteRoute();
    const wsBase = route.baseUrl.startsWith("https://")
      ? route.baseUrl.replace(/^https:\/\//, "wss://")
      : route.baseUrl.replace(/^http:\/\//, "ws://");
    const query = new URLSearchParams({ token: route.token });
    if (options.accountId && options.sessionId) {
      query.set("accountId", options.accountId);
      query.set("sessionId", options.sessionId);
    }

    const next = new WebSocket(`${wsBase}/ws/discussions?${query.toString()}`);
    socket = next;
    next.addEventListener("open", () => {
      if (socket !== next || stopped) return;
      retryCount = 0;
      lastMessageAt = Date.now();
      startHeartbeat(next);
      onState?.("live");
    });
    next.addEventListener("message", (event) => {
      if (socket !== next || stopped) return;
      lastMessageAt = Date.now();
      try {
        onMessage(JSON.parse(String(event.data)) as DiscussionStreamMessage);
      } catch {
        // Ignore un paquet incomplet/inconnu ; le prochain snapshot est complet.
      }
    });
    next.addEventListener("close", () => {
      if (socket === next) socket = null;
      clearHeartbeat();
      if (stopped) return;
      retryCount += 1;
      onState?.("reconnecting");
      const delay = Math.min(10_000, 500 * 2 ** Math.min(retryCount - 1, 5));
      retryTimer = window.setTimeout(connect, delay);
    });
    next.addEventListener("error", () => {
      // `close` planifie la reconnexion et centralise les changements d'etat.
      next.close();
    });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    if (!socket) {
      connect();
    } else if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "ping" }));
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  connect();

  return () => {
    stopped = true;
    clearRetry();
    clearHeartbeat();
    document.removeEventListener("visibilitychange", onVisibilityChange);
    socket?.close();
    socket = null;
    onState?.("closed");
  };
}

export async function invoke<T = unknown>(command: string, args: Record<string, any> = {}): Promise<T> {
  if (!isRemoteMode()) {
    return tauriInvoke<T>(command, args);
  }

  // Le client desktop connecte a un VPS conserve le micro et les modeles
  // vocaux du poste. Un navigateur ou une app mobile, qui ne possede pas de
  // runtime Tauri local, continue d'utiliser le moteur expose par cst-server.
  // Le repli serveur permet aussi a un client desktop sans modele local de
  // profiter d'un moteur vocal configure sur le VPS ou dans un datacenter.
  if (
    isTauriRuntime()
    && (command === "process_voice_input" || command === "voice_runtime_status")
  ) {
    let localError: unknown = null;
    try {
      return await tauriInvoke<T>(command, args);
    } catch (error) {
      localError = error;
    }

    try {
      return await remoteInvoke<T>(command, args);
    } catch (remoteError) {
      const detail = (error: unknown) =>
        String(error instanceof Error ? error.message : error).replace(/^Error:\s*/i, "");
      const operation = command === "process_voice_input" ? "La transcription" : "Le statut vocal";
      throw new Error(
        `${operation} est indisponible sur ce poste (${detail(localError)}) et sur le VPS (${detail(remoteError)}).`,
      );
    }
  }

  return remoteInvoke<T>(command, args);
}

const fileAsBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const payload = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
      if (!payload) reject(new Error("Le fichier audio est vide ou illisible."));
      else resolve(payload);
    }, { once: true });
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Lecture du fichier audio impossible."));
    }, { once: true });
    reader.addEventListener("abort", () => reject(new DOMException("Lecture annulee", "AbortError")), {
      once: true,
    });
    reader.readAsDataURL(file);
  });

/**
 * Envoie un fichier brut au runtime distant. Le desktop connecte a un VPS ne
 * tente volontairement aucun moteur local : l'onglet Transcrire cible la carte
 * graphique du serveur selectionne.
 */
export async function transcribeAudioFile(
  file: File,
  language = "auto",
  outputMode: VoiceOutputMode = "clean",
  signal?: AbortSignal,
): Promise<AudioFileTranscriptionResponse> {
  if (!file.size) throw new Error("Le fichier audio est vide.");
  if (file.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    throw new Error("Le fichier audio depasse la limite de 100 Mo.");
  }
  if (signal?.aborted) throw new DOMException("Transcription annulee", "AbortError");

  if (!isRemoteMode()) {
    const audioBase64 = await fileAsBase64(file);
    if (signal?.aborted) throw new DOMException("Transcription annulee", "AbortError");
    return tauriInvoke<AudioFileTranscriptionResponse>("transcribe_audio_file", {
      audioBase64,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      language,
      outputMode,
    });
  }

  return uploadRemoteAudioFile(file, language, outputMode, signal);
}

export function transcriptionRuntimeStatus(): Promise<TranscriptionRuntimeStatus> {
  if (!isRemoteMode()) {
    return tauriInvoke<TranscriptionRuntimeStatus>("voice_runtime_status");
  }
  return api<TranscriptionRuntimeStatus>("GET", "/api/voice/status");
}

async function remoteInvoke<T>(command: string, args: Record<string, any>): Promise<T> {
  switch (command) {
    case "load_settings":
      return api<T>("GET", "/api/settings", undefined, REMOTE_BOOTSTRAP_TIMEOUT_MS);
    case "save_settings":
      return api<T>("PUT", "/api/settings", args.settings, REMOTE_BOOTSTRAP_TIMEOUT_MS);
    case "add_shared_account":
      return api<T>("POST", "/api/accounts", args.account, REMOTE_BOOTSTRAP_TIMEOUT_MS);
    case "ensure_account_home":
      return api<T>("POST", "/api/accounts/home", {
        codexHome: args.codexHome,
        provider: args.provider ?? null,
        bypass: args.bypass ?? true,
        model: args.model ?? null,
        reasoningEffort: args.reasoningEffort ?? null,
        fastMode: args.fastMode ?? false,
      });
    case "export_discussion_transcript":
      return remoteSessionApi<T>(args.accountId, args.sessionId, "POST", "/api/discussions/export", {
        accountId: args.accountId,
        sessionId: args.sessionId,
      });
    case "import_account_json":
      return api<T>("POST", "/api/accounts/import", { content: args.content });
    case "import_account_docs":
      throw new Error("En mode SaaS, colle le contenu JSON plutot qu'un chemin de fichier local.");
    case "remove_account":
      return api<T>(
        "DELETE",
        `/api/accounts/${encodeURIComponent(args.accountId)}?deleteFiles=${
          args.deleteFiles ? "true" : "false"
        }`,
      );
    case "account_limit_status":
      return api<T>("GET", `/api/limits${args.force ? "?force=true" : ""}`);
    case "usage_dashboard":
      return api<T>("GET", "/api/usage");
    case "account_token_usage":
      return api<T>("GET", "/api/account-usage");
    case "work_time_dashboard":
      return api<T>("GET", "/api/work-time");
    case "vps_deploy_capabilities":
      return api<T>("GET", "/api/vps/capabilities");
    case "vps_google_status":
      return api<T>("GET", "/api/vps/google/status");
    case "vps_google_start_auth":
      return api<T>("POST", "/api/vps/google/auth");
    case "vps_google_open_trial":
      return api<T>("POST", "/api/vps/google/trial");
    case "vps_google_start_deployment":
      return api<T>("POST", "/api/vps/google/deployments", args.request);
    case "vps_list_deployments":
      return api<T>("GET", "/api/vps/deployments");
    case "vps_start_deployment":
      return api<T>("POST", "/api/vps/deployments", args.request);
    case "vps_deployment_status":
      return api<T>(
        "GET",
        `/api/vps/deployments/${encodeURIComponent(String(args.id))}`,
      );
    case "pool_status":
      return api<T>("GET", "/api/pool/status");
    case "pool_start":
      return api<T>("POST", "/api/pool/start");
    case "pool_stop":
      return api<T>("POST", "/api/pool/stop");
    case "pool_pick_terminal_account":
      return pickRemotePoolAccount<T>();
    case "start_terminal":
      return startRemoteTerminal<T>(args);
    case "terminal_output_snapshot":
      return (remoteTerminalOutput.get(Number(args.id)) ?? "") as T;
    case "list_dir":
      return api<T>(
        "GET",
        `/api/fs/list${args.path ? `?path=${encodeURIComponent(String(args.path))}` : ""}`,
      );
    case "create_workspace":
      return api<T>("POST", "/api/workspaces", { name: args.name });
    case "create_git_docker_environment":
      return api<T>("POST", "/api/workspaces/git-docker", args.request);
    case "workspace_access":
      return api<T>("GET", "/api/workspaces/access");
    case "request_workspace_access":
      return api<T>("POST", "/api/workspaces/access/request", {
        shareCode: args.shareCode,
      });
    case "accept_workspace_access":
      return api<T>(
        "POST",
        `/api/workspaces/${encodeURIComponent(String(args.environmentId))}/access-requests/${encodeURIComponent(String(args.userId))}/accept`,
      );
    case "reject_workspace_access":
      return api<T>(
        "POST",
        `/api/workspaces/${encodeURIComponent(String(args.environmentId))}/access-requests/${encodeURIComponent(String(args.userId))}/reject`,
      );
    case "revoke_workspace_access":
      return api<T>(
        "DELETE",
        `/api/workspaces/${encodeURIComponent(String(args.environmentId))}/members/${encodeURIComponent(String(args.userId))}`,
      );
    case "write_terminal":
      writeRemoteTerminal(args.id, args.data);
      return undefined as T;
    case "resize_terminal":
      resizeRemoteTerminal(args.id, args.cols, args.rows);
      return undefined as T;
    case "stop_terminal":
      await stopRemoteTerminal(args.id);
      return undefined as T;
    case "pick_project_dir":
      return null as T;
    case "kombai_status":
      return api<T>("GET", "/api/kombai/status");
    case "kombai_start":
      return api<T>("POST", "/api/kombai/start", { projectDir: args.projectDir });
    case "kombai_stop":
      return api<T>("POST", "/api/kombai/stop");
    case "kombai_install_extension":
      return api<T>("POST", "/api/kombai/install-extension");
    case "launch_ide":
      throw new Error("Le lancement d'IDE local n'est pas disponible en mode SaaS.");
    case "doctolib_lab_status":
      return api<T>("GET", "/api/doctolib-lab/status");
    case "doctolib_lab_connect":
      return api<T>("POST", "/api/doctolib-lab/connect");
    case "doctolib_lab_google_calendar_connect":
      return api<T>("POST", "/api/doctolib-lab/google-calendar/connect");
    case "doctolib_lab_search":
      return api<T>("POST", "/api/doctolib-lab/search", args.request);
    case "doctolib_lab_confirm":
      return api<T>("POST", "/api/doctolib-lab/confirm", {
        proposalId: args.proposalId,
        addToGoogleCalendar: args.addToGoogleCalendar ?? false,
      });
    case "list_discussions":
      return listRemoteDiscussions<T>();
    case "get_discussion_transcript":
      return remoteSessionApi<T>(
        args.accountId,
        args.sessionId,
        "GET",
        `/api/discussions/transcript?accountId=${encodeURIComponent(String(args.accountId))}&sessionId=${encodeURIComponent(String(args.sessionId))}`,
      );
    case "list_forum_topics":
      return api<T>("GET", "/api/forum/topics");
    case "get_forum_topic":
      return api<T>(
        "GET",
        `/api/forum/topics/${encodeURIComponent(String(args.topicId))}`,
      );
    case "create_forum_topic":
      return api<T>("POST", "/api/forum/topics", {
        title: args.title,
        body: args.body,
      });
    case "reply_to_forum_topic":
      return api<T>(
        "POST",
        `/api/forum/topics/${encodeURIComponent(String(args.topicId))}/replies`,
        { body: args.body },
      );
    case "list_private_message_users":
      return api<T>("GET", "/api/private-messages/users");
    case "list_private_message_conversations":
      return api<T>("GET", "/api/private-messages/conversations");
    case "get_private_message_conversation":
      return api<T>(
        "GET",
        `/api/private-messages/conversations/${encodeURIComponent(String(args.userId))}`,
      );
    case "send_private_message":
      return api<T>(
        "POST",
        `/api/private-messages/conversations/${encodeURIComponent(String(args.userId))}`,
        { body: args.body, images: args.images ?? [] },
      );
    case "get_private_message_image":
      return api<T>(
        "GET",
        `/api/private-messages/images/${encodeURIComponent(String(args.imageId))}`,
      );
    case "list_private_message_campaigns":
      return api<T>("GET", "/api/private-messages/campaigns");
    case "create_private_message_campaign":
      return api<T>("POST", "/api/private-messages/campaigns", args.request);
    case "control_private_message_campaign":
      return api<T>(
        "POST",
        `/api/private-messages/campaigns/${encodeURIComponent(String(args.campaignId))}/control`,
        { action: args.action, consentConfirmed: args.consentConfirmed ?? false },
      );
    case "list_tiktok_dm_campaigns":
      return api<T>("GET", "/api/tiktok/dm-campaigns");
    case "list_tiktok_sender_accounts":
      return api<T>("GET", "/api/tiktok/sender-accounts");
    case "manage_tiktok_sender_login":
      return api<T>("POST", "/api/tiktok/sender-login", {
        action: args.action,
        deviceSerial: args.deviceSerial,
      });
    case "select_tiktok_sender_account":
      return api<T>("POST", "/api/tiktok/sender-accounts/select", {
        username: args.username,
      });
    case "prepare_tiktok_dm_campaign":
      return api<T>("POST", "/api/tiktok/dm-campaigns", args.request);
    case "confirm_tiktok_dm_campaign":
      return api<T>(
        "POST",
        `/api/tiktok/dm-campaigns/${encodeURIComponent(String(args.campaignId))}/confirm`,
        {
          ownedAccountsConfirmed: args.ownedAccountsConfirmed ?? false,
          sendConfirmed: args.sendConfirmed ?? false,
        },
      );
    case "list_tiktok_follower_extractions":
      return api<T>("GET", "/api/tiktok/follower-extractions");
    case "queue_tiktok_follower_extraction":
      return api<T>("POST", "/api/tiktok/follower-extractions", args.request);
    case "account_model_catalog":
      return api<T>(
        "GET",
        `/api/chat/models?accountId=${encodeURIComponent(String(args.accountId))}`,
      );
    case "start_chat_turn":
      return startRemoteChatTurn<T>(args);
    case "process_voice_input":
      return api<T>("POST", "/api/voice/process", {
        audioBase64: args.audioBase64,
        mimeType: args.mimeType ?? "audio/wav",
        language: args.language ?? "fr",
        outputMode: args.outputMode ?? "clean",
      });
    case "voice_runtime_status":
      return api<T>("GET", "/api/voice/status");
    case "creative_accounts":
      return api<T>("GET", "/api/creative/accounts");
    case "connect_creative_account":
      return api<T>("POST", "/api/creative/accounts", args.request);
    case "delete_creative_account":
      return api<T>("POST", "/api/creative/accounts/delete", args.request);
    case "set_default_creative_account":
      return api<T>("POST", "/api/creative/accounts/default", args.request);
    case "whatsapp_connection":
      return api<T>("GET", "/api/notifications/whatsapp");
    case "connect_whatsapp":
      return api<T>("POST", "/api/notifications/whatsapp", args.request);
    case "disconnect_whatsapp":
      return api<T>("DELETE", "/api/notifications/whatsapp");
    case "test_whatsapp":
      return api<T>("POST", "/api/notifications/whatsapp/test");
    case "telegram_connection":
      return api<T>("GET", "/api/notifications/telegram");
    case "connect_telegram":
      return api<T>("POST", "/api/notifications/telegram", args.request);
    case "refresh_telegram_pairing":
      return api<T>("POST", "/api/notifications/telegram/pairing");
    case "disconnect_telegram":
      return api<T>("DELETE", "/api/notifications/telegram");
    case "test_telegram":
      return api<T>("POST", "/api/notifications/telegram/test");
    case "telegram_manager":
      return api<T>("GET", "/api/notifications/telegram/manager");
    case "connect_telegram_manager":
      return api<T>("POST", "/api/notifications/telegram/manager", args.request);
    case "prepare_managed_telegram_bot":
      return api<T>("POST", "/api/notifications/telegram/manager/prepare", args.request);
    case "disconnect_telegram_manager":
      return api<T>("DELETE", "/api/notifications/telegram/manager");
    case "image_generation_capabilities":
      return api<T>("GET", "/api/image/capabilities");
    case "start_image_generation":
      return api<T>("POST", "/api/image/generations", args.request);
    case "image_generation_status":
      return api<T>("POST", "/api/image/generations/status", args.request);
    case "cancel_image_generation":
      return api<T>("POST", "/api/image/generations/cancel", args.request);
    case "video_generation_capabilities":
      return api<T>("GET", "/api/video/capabilities");
    case "start_video_generation":
      return api<T>("POST", "/api/video/generations", args.request);
    case "video_generation_status":
      return api<T>("POST", "/api/video/generations/status", args.request);
    case "cancel_video_generation":
      return api<T>("POST", "/api/video/generations/cancel", args.request);
    case "list_active_chat_turns":
      return listRemoteActiveChatTurns<T>();
    case "claim_chat_open_requests":
      return api<T>("POST", "/api/chat/open-requests/claim");
    case "chat_turn_status":
      return remoteChatTurnRequest<T>(args.id, "GET");
    case "stop_chat_turn":
      return remoteChatTurnRequest<T>(args.id, "DELETE");
    case "compact_chat_session":
      return remoteSessionApi<T>(args.accountId, args.sessionId, "POST", "/api/chat/compact", {
        accountId: args.accountId,
        sessionId: args.sessionId,
      });
    case "list_autonomous_agents":
      return api<T>("GET", "/api/autonomous-agents");
    case "create_autonomous_agent":
      return api<T>("POST", "/api/autonomous-agents", args.request);
    case "update_autonomous_agent":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}`,
        args.request,
      );
    case "control_autonomous_agent":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/control`,
        { action: args.action, paymentId: args.paymentId },
      );
    case "schedule_autonomous_agent":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/schedule`,
        { nextRunAt: args.nextRunAt, intervalSeconds: args.intervalSeconds },
      );
    case "reassign_autonomous_agent_account":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/account`,
        args.request,
      );
    case "send_autonomous_agent_message":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/messages`,
        args.request,
      );
    case "read_autonomous_review_evidence":
      return api<T>(
        "GET",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/reviews/${encodeURIComponent(String(args.reviewId))}/evidence`,
      );
    case "add_autonomous_agent_memory":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/memories`,
        { content: args.content },
      );
    case "mark_autonomous_agent_report_read":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/reports/${encodeURIComponent(String(args.reportId))}/read`,
      );
    case "delete_autonomous_agent_memory":
      return api<T>(
        "DELETE",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/memories/${encodeURIComponent(String(args.memoryId))}`,
      );
    case "delete_autonomous_agent":
      return api<T>(
        "DELETE",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}`,
      );
    case "promote_autonomous_agent_to_orchestration":
      return api<T>(
        "POST",
        `/api/autonomous-agents/${encodeURIComponent(String(args.id))}/orchestration`,
        args.request,
      );
    case "list_orchestrations":
      return api<T>("GET", "/api/orchestrations");
    case "create_orchestration":
      return api<T>("POST", "/api/orchestrations", args.request);
    case "control_orchestration":
      return api<T>(
        "POST",
        `/api/orchestrations/${encodeURIComponent(String(args.id))}/control`,
        { action: args.action },
      );
    case "reassign_orchestration_account":
      return api<T>(
        "POST",
        `/api/orchestrations/${encodeURIComponent(String(args.id))}/account`,
        args.request,
      );
    case "delete_orchestration":
      return api<T>(
        "DELETE",
        `/api/orchestrations/${encodeURIComponent(String(args.id))}`,
      );
    case "list_prompt_history":
      return {
        generatedAt: Math.floor(Date.now() / 1000),
        totalPrompts: 0,
        returned: 0,
        truncated: false,
        prompts: [],
      } as T;
    case "claim_session_for_terminal":
      return apiAt<T>(
        remoteTerminalRoutes.get(Number(args.terminalId)) ?? defaultRemoteRoute(),
        "POST",
        "/api/discussions/claim",
        {
        terminalId: args.terminalId,
        accountId: args.accountId,
        afterUnix: args.afterUnix,
        excludeSessionIds: args.excludeSessionIds ?? [],
        matchSessionId: args.matchSessionId ?? null,
        },
      );
    case "copy_discussion_to_account":
      return remoteSessionApi<T>(args.sourceAccountId, args.sessionId, "POST", "/api/discussions/copy", {
        sessionId: args.sessionId,
        sourceAccountId: args.sourceAccountId,
        targetAccountId: args.targetAccountId,
      });
    case "move_discussion":
      return remoteSessionApi<T>(args.accountId, args.sessionId, "POST", "/api/discussions/move", {
        accountId: args.accountId,
        sessionId: args.sessionId,
        workspacePath: args.workspacePath,
      });
    case "rename_discussion":
      return remoteSessionApi<T>(args.accountId, args.sessionId, "POST", "/api/discussions/rename", {
        accountId: args.accountId,
        sessionId: args.sessionId,
        title: args.title,
      });
    case "delete_discussion":
      return remoteSessionApi<T>(args.accountId, args.sessionId, "POST", "/api/discussions/delete", {
        accountId: args.accountId,
        sessionId: args.sessionId,
        archive: args.archive,
      });
    default:
      throw new Error(`Commande remote non supportee: ${command}`);
  }
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  return apiAt<T>(defaultRemoteRoute(), method, path, body, timeoutMs);
}

async function uploadRemoteAudioFile(
  file: File,
  language: string,
  outputMode: VoiceOutputMode,
  signal?: AbortSignal,
): Promise<AudioFileTranscriptionResponse> {
  const route = defaultRemoteRoute();
  const query = new URLSearchParams({
    fileName: file.name.slice(0, 180),
    language,
    outputMode,
  });
  let response: Response;
  try {
    response = await fetch(`${route.baseUrl}/api/transcriptions?${query.toString()}`, {
      method: "POST",
      credentials: "include",
      headers: {
        ...(route.token ? { Authorization: `Bearer ${route.token}` } : {}),
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new DOMException("Transcription annulee", "AbortError");
    }
    throw new Error(`Envoi du fichier au VPS impossible : ${String(error)}`);
  }

  const text = await response.text();
  let value: any = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = null;
  }
  if (!response.ok) {
    if (response.status === 401 && route.baseUrl === remoteBaseUrl()) clearRemoteConfig();
    const message = value?.error?.message
      || value?.message
      || (response.status === 413 ? "Le fichier audio depasse la limite de 100 Mo." : response.statusText)
      || "La transcription a echoue.";
    throw new Error(message);
  }
  if (!value || typeof value.text !== "string") {
    throw new Error("Le VPS a renvoye une reponse de transcription illisible.");
  }
  return value as AudioFileTranscriptionResponse;
}

/**
 * Souscrit au signal leger partage par les tours actifs, les agents autonomes
 * et la messagerie privee. Un socket est ouvert par noeud afin que le catalogue
 * multi-VPS ne perde aucune transition. Les snapshots restent lus par REST
 * uniquement lors d'un signal ou pendant le repli de reconnexion.
 */
export function subscribeRuntimeUpdates(
  onMessage: (message: RuntimeSyncMessage) => void,
  onState?: (state: RealtimeConnectionState) => void,
): UnlistenFn {
  if (!isRemoteMode()) {
    onState?.("unsupported");
    return () => undefined;
  }

  type RuntimeSocketState = {
    route: RemoteTerminalRoute;
    socket: WebSocket | null;
    retryTimer: number | null;
    heartbeatTimer: number | null;
    retryCount: number;
    lastMessageAt: number;
    live: boolean;
  };

  const routes = [...parseRemoteNodes().map(nodeToRoute), defaultRemoteRoute()]
    .filter((route, index, values) => values.findIndex(
      (candidate) => remoteRouteKey(candidate) === remoteRouteKey(route),
    ) === index);
  const states = routes.map((route): RuntimeSocketState => ({
    route,
    socket: null,
    retryTimer: null,
    heartbeatTimer: null,
    retryCount: 0,
    lastMessageAt: 0,
    live: false,
  }));
  let stopped = false;
  let hasConnected = false;

  const reportState = () => {
    if (stopped) {
      onState?.("closed");
    } else if (states.every((state) => state.live)) {
      onState?.("live");
    } else if (hasConnected || states.some((state) => state.retryCount > 0)) {
      onState?.("reconnecting");
    } else {
      onState?.("connecting");
    }
  };

  const clearHeartbeat = (state: RuntimeSocketState) => {
    if (state.heartbeatTimer !== null) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }
  };

  const clearRetry = (state: RuntimeSocketState) => {
    if (state.retryTimer !== null) {
      clearTimeout(state.retryTimer);
      state.retryTimer = null;
    }
  };

  const connect = (state: RuntimeSocketState) => {
    if (
      stopped
      || state.socket?.readyState === WebSocket.OPEN
      || state.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    clearRetry(state);

    const wsBase = state.route.baseUrl.startsWith("https://")
      ? state.route.baseUrl.replace(/^https:\/\//, "wss://")
      : state.route.baseUrl.replace(/^http:\/\//, "ws://");
    const query = new URLSearchParams({ token: state.route.token });
    let next: WebSocket;
    try {
      next = new WebSocket(`${wsBase}/ws/runtime?${query.toString()}`);
    } catch {
      state.retryCount += 1;
      reportState();
      const delay = Math.min(10_000, 500 * 2 ** Math.min(state.retryCount - 1, 5));
      state.retryTimer = window.setTimeout(() => connect(state), delay);
      return;
    }
    state.socket = next;

    next.addEventListener("open", () => {
      if (state.socket !== next || stopped) return;
      state.retryCount = 0;
      state.lastMessageAt = Date.now();
      state.live = true;
      hasConnected = true;
      clearHeartbeat(state);
      state.heartbeatTimer = window.setInterval(() => {
        if (state.socket !== next || next.readyState !== WebSocket.OPEN) return;
        if (Date.now() - state.lastMessageAt > 45_000) {
          next.close();
          return;
        }
        next.send(JSON.stringify({ type: "ping" }));
      }, 15_000);
      reportState();
    });
    next.addEventListener("message", (event) => {
      if (state.socket !== next || stopped) return;
      state.lastMessageAt = Date.now();
      try {
        onMessage(JSON.parse(String(event.data)) as RuntimeSyncMessage);
      } catch {
        // Un signal incomplet est ignore ; hello/resync ou le repli REST
        // reconciliant ensuite des snapshots complets.
      }
    });
    next.addEventListener("close", () => {
      if (state.socket !== next) return;
      state.socket = null;
      state.live = false;
      clearHeartbeat(state);
      if (stopped) return;
      state.retryCount += 1;
      reportState();
      const delay = Math.min(10_000, 500 * 2 ** Math.min(state.retryCount - 1, 5));
      state.retryTimer = window.setTimeout(() => connect(state), delay);
    });
    next.addEventListener("error", () => {
      next.close();
    });
  };

  const onVisibilityChange = () => {
    if (document.visibilityState !== "visible") return;
    states.forEach((state) => {
      if (!state.socket) connect(state);
      else if (state.socket.readyState === WebSocket.OPEN) {
        state.socket.send(JSON.stringify({ type: "ping" }));
      }
    });
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  reportState();
  states.forEach(connect);

  return () => {
    stopped = true;
    document.removeEventListener("visibilitychange", onVisibilityChange);
    states.forEach((state) => {
      clearRetry(state);
      clearHeartbeat(state);
      state.socket?.close();
      state.socket = null;
      state.live = false;
    });
    reportState();
  };
}

async function apiAt<T>(
  route: RemoteTerminalRoute,
  method: string,
  path: string,
  body?: unknown,
  timeoutMs?: number,
): Promise<T> {
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? window.setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(`${route.baseUrl}${path}`, {
      method,
      credentials: "include",
      headers: {
        Authorization: `Bearer ${route.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller?.signal,
    });

    const text = await response.text();
    const value = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = value?.error?.message || value?.message || response.statusText;
      if (response.status === 401 && route.baseUrl === remoteBaseUrl()) clearRemoteConfig();
      // Marquer le rejet HTTP definitif (4xx/5xx JSON) pour le distinguer d'une
      // simple coupure de transport : un envoi de chat interrompu apres que le
      // serveur a deja lance le tour ne doit pas etre traite comme un echec.
      const rejection = new Error(message) as Error & { httpStatus?: number };
      rejection.httpStatus = response.status;
      throw rejection;
    }
    return value as T;
  } catch (error) {
    if (controller?.signal.aborted) {
      throw new Error(
        `Le serveur ${route.baseUrl} ne repond pas apres ${Math.ceil(timeoutMs! / 1_000)} s. Verifie son adresse puis reconnecte-toi.`,
      );
    }
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
}

function defaultRemoteRoute(): RemoteTerminalRoute {
  return {
    label: "Serveur principal",
    baseUrl: remoteBaseUrl(),
    token: remoteToken(),
  };
}

const remoteRouteKey = (route: RemoteTerminalRoute) => normalizeBaseUrl(route.baseUrl).toLowerCase();

const remoteSessionKey = (accountId: string, sessionId: string) =>
  `${accountId.trim()}\u0000${sessionId.trim()}`;

function rememberRemoteSessionRoute(
  accountId: unknown,
  sessionId: unknown,
  route: RemoteTerminalRoute,
  force = false,
) {
  const account = typeof accountId === "string" ? accountId.trim() : "";
  const session = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!account || !session) return;
  const key = remoteSessionKey(account, session);
  if (force || !remoteSessionRoutes.has(key)) remoteSessionRoutes.set(key, route);
}

function remoteSessionRoute(accountId: unknown, sessionId: unknown) {
  if (typeof accountId !== "string" || typeof sessionId !== "string") return null;
  return remoteSessionRoutes.get(remoteSessionKey(accountId, sessionId)) ?? null;
}

const remoteTurnKey = (route: RemoteTerminalRoute, remoteId: number) =>
  `${remoteRouteKey(route)}\u0000${remoteId}`;

function virtualRemoteTurnId(route: RemoteTerminalRoute, remoteId: number) {
  const key = remoteTurnKey(route, remoteId);
  const known = remoteChatTurnIds.get(key);
  if (known !== undefined) return known;
  const id = nextRemoteChatTurnId--;
  remoteChatTurnIds.set(key, id);
  remoteChatTurnRoutes.set(id, { route, remoteId });
  return id;
}

function decorateRemoteChatSnapshot<T>(
  value: T,
  route: RemoteTerminalRoute,
  remoteId?: number,
): T {
  if (!value || typeof value !== "object") return value;
  const snapshot = value as Record<string, any>;
  const resolvedRemoteId = Number(remoteId ?? snapshot.id);
  if (!Number.isFinite(resolvedRemoteId)) return value;
  rememberRemoteSessionRoute(snapshot.accountId, snapshot.sessionId, route, true);
  return {
    ...snapshot,
    id: virtualRemoteTurnId(route, resolvedRemoteId),
    nodeLabel: route.label,
    nodeId: remoteRouteKey(route),
  } as T;
}

function remoteChatRouteForId(id: unknown) {
  const parsed = Number(id);
  const mapped = remoteChatTurnRoutes.get(parsed);
  return mapped ?? { route: defaultRemoteRoute(), remoteId: parsed };
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function parseRemoteNodeLine(line: string, index: number): RemoteNodeConfig | null {
  const parts = line.split("|").map((part) => part.trim());
  if (!parts[0] || parts[0].startsWith("#")) return null;

  const hasLabel = parts[1]?.startsWith("http://") || parts[1]?.startsWith("https://");
  const label = hasLabel ? parts[0] : `Noeud ${index + 1}`;
  const baseUrl = normalizeBaseUrl(hasLabel ? parts[1] : parts[0]);
  if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) return null;

  const token = (hasLabel ? parts[2] : parts[1]) || remoteToken();
  const priorityRaw = hasLabel ? parts[3] : parts[2];
  const priority = Number.isFinite(Number(priorityRaw)) ? Number(priorityRaw) : 50 + index;

  return {
    id: `${label}-${baseUrl}`.toLowerCase(),
    label,
    baseUrl,
    token,
    priority,
  };
}

function parseRemoteNodes(): RemoteNodeConfig[] {
  const raw = remoteNodesText();
  const parsed = raw
    ? raw
        .split(/\r?\n/)
        .map((line, index) => parseRemoteNodeLine(line, index))
        .filter((node): node is RemoteNodeConfig => node !== null)
    : [];

  const primary: RemoteNodeConfig = {
    id: "primary",
    label: "Serveur principal",
    baseUrl: remoteBaseUrl(),
    token: remoteToken(),
    priority: 100,
  };
  // Une session utilisateur web s'authentifie avec son cookie HttpOnly et ne
  // possede volontairement aucun token administrateur dans localStorage. Le
  // serveur principal doit donc rester candidat sans token ; les noeuds tiers,
  // auxquels le cookie same-origin ne peut pas etre envoye, exigent toujours
  // un token explicite.
  const nodes = [...parsed, primary].filter(
    (node) => node.id === "primary" || node.token.trim().length > 0,
  );
  const seen = new Set<string>();
  return nodes
    .filter((node) => {
      const key = node.baseUrl.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.priority - b.priority);
}

/** Cibles explicitement selectionnables pour le premier tour d'un chat. */
export const remoteChatExecutionTargets = (): ChatExecutionTarget[] => {
  if (!isRemoteMode()) return [];
  const primaryUrl = normalizeBaseUrl(remoteBaseUrl()).toLowerCase();
  return parseRemoteNodes().map((node) => ({
    id: remoteRouteKey(nodeToRoute(node)),
    label: node.label,
    primary: normalizeBaseUrl(node.baseUrl).toLowerCase() === primaryUrl,
  }));
};

async function rankedRemoteNodeRoutes(
  workload: "chat" | "terminal",
  accountId?: string | null,
) {
  const observations = await Promise.all(
    parseRemoteNodes().map(async (node): Promise<RemoteAllocationObservation<RemoteNodeConfig>> => {
      const route = nodeToRoute(node);
      try {
        const health = await apiAt<RemoteNodeHealth>(
          route,
          "GET",
          "/api/health",
          undefined,
          1200,
        );
        return {
          node: { ...node, label: health.nodeLabel || node.label },
          health,
        };
      } catch {
        return { node, health: null };
      }
    }),
  );
  return rankRemoteAllocations(observations, workload, accountId)
    .map((candidate) => nodeToRoute(candidate.node));
}

async function terminalNodeCandidates(targetNodeId = "") {
  const nodes = parseRemoteNodes();
  const configKey = JSON.stringify(
    nodes.map((node) => [node.id, node.baseUrl, node.token, node.priority]),
  );
  // Les ouvertures simultanees partagent la meme sonde, mais le resultat n'est
  // pas conserve au-dela du vol courant : un noeud qui vient de passer en drain
  // doit etre exclu des la prochaine tentative.
  const promise = terminalCandidatesInFlight?.configKey === configKey
    ? terminalCandidatesInFlight.promise
    : (async () => rankedRemoteNodeRoutes("terminal"))();
  if (terminalCandidatesInFlight?.promise !== promise) {
    terminalCandidatesInFlight = { configKey, promise };
  }
  try {
    const candidates = await promise;
    const selected = targetNodeId
      ? candidates.filter((route) => remoteRouteKey(route) === targetNodeId)
      : candidates;
    if (selected.length === 0) {
      const target = remoteChatExecutionTargets().find((candidate) => candidate.id === targetNodeId);
      throw new Error(target
        ? `La cible ${target.label} est indisponible ou en maintenance.`
        : targetNodeId
          ? "Le VPS choisi pour cet environnement n'est plus configure."
          : "Tous les noeuds terminaux sont en drain ou en maintenance.");
    }
    return selected;
  } finally {
    if (terminalCandidatesInFlight?.promise === promise) terminalCandidatesInFlight = null;
  }
}

function nodeToRoute(node: RemoteNodeConfig): RemoteTerminalRoute {
  return {
    label: node.label,
    baseUrl: node.baseUrl,
    token: node.token,
  };
}

function serializeRemoteChatStart<T>(work: () => Promise<T>): Promise<T> {
  const result = remoteChatStartQueue.then(work, work);
  remoteChatStartQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function listRemoteDiscussions<T>(): Promise<T> {
  const routes = parseRemoteNodes().map(nodeToRoute);
  const results = await Promise.all(
    routes.map(async (route) => {
      try {
        return {
          route,
          dashboard: await apiAt<Record<string, any>>(route, "GET", "/api/discussions"),
          error: null as unknown,
        };
      } catch (error) {
        return { route, dashboard: null, error };
      }
    }),
  );
  const available = results.filter((result) => result.dashboard !== null);
  if (available.length === 0) {
    throw results.at(-1)?.error ?? new Error("Aucun noeud de discussions disponible.");
  }

  const merged = new Map<string, Record<string, any> & { _seen: Set<string> }>();
  let generatedAt = 0;
  for (const { route, dashboard } of available) {
    generatedAt = Math.max(generatedAt, Number(dashboard?.generatedAt) || 0);
    for (const group of Array.isArray(dashboard?.accounts) ? dashboard.accounts : []) {
      const accountId = String(group.accountId ?? "");
      const groupKey = `${String(group.provider ?? "")}\u0000${accountId}`;
      let target = merged.get(groupKey);
      if (!target) {
        const created: Record<string, any> & { _seen: Set<string> } = {
          ...group,
          discussions: [],
          discussionCount: 0,
          _seen: new Set<string>(),
        };
        merged.set(groupKey, created);
        target = created;
      } else {
        target.hasTokens = Boolean(target.hasTokens || group.hasTokens);
        target.error = target.error || group.error || null;
      }

      for (const discussion of Array.isArray(group.discussions) ? group.discussions : []) {
        const sessionId = String(discussion.sessionId ?? "");
        const rolloutId = String(discussion.rolloutId ?? "");
        rememberRemoteSessionRoute(accountId, sessionId, route);
        rememberRemoteSessionRoute(accountId, rolloutId, route);
        const identity = rolloutId || sessionId || String(discussion.filePath ?? "");
        if (!identity || target._seen.has(identity)) continue;
        target._seen.add(identity);
        target.discussions.push({
          ...discussion,
          nodeId: remoteRouteKey(route),
          nodeLabel: route.label,
        });
      }
    }
  }

  const accounts = [...merged.values()].map(({ _seen: _ignored, ...group }) => ({
    ...group,
    discussionCount: group.discussions.length,
  }));
  return {
    generatedAt: generatedAt || Math.floor(Date.now() / 1000),
    totalDiscussions: accounts.reduce((total, group) => total + group.discussionCount, 0),
    accounts,
    nodeErrors: results
      .filter((result) => result.error)
      .map((result) => ({ nodeLabel: result.route.label, message: String(result.error) })),
  } as T;
}

async function locateRemoteSession(accountId: string, sessionId: string) {
  const known = remoteSessionRoute(accountId, sessionId);
  if (known) return known;
  await listRemoteDiscussions<unknown>();
  return remoteSessionRoute(accountId, sessionId);
}

async function startRemoteChatTurn<T>(args: Record<string, any>): Promise<T> {
  return serializeRemoteChatStart(async () => {
    const accountId = String(args.accountId ?? "");
    const targetNodeId = typeof args.targetNodeId === "string"
      ? args.targetNodeId.trim().toLowerCase()
      : "";
    const sessionId = typeof args.sessionId === "string" && args.sessionId.trim()
      ? args.sessionId.trim()
      : null;
    let candidates: RemoteTerminalRoute[];
    if (sessionId) {
      const sticky = await locateRemoteSession(accountId, sessionId);
      if (!sticky) {
        throw new Error(
          "La session existe sur un autre noeud mais sa route n'a pas pu etre localisee. Recharge les discussions puis reessaie.",
        );
      }
      // Une reprise ne bascule jamais silencieusement : son historique et son
      // processus fournisseur appartiennent au noeud qui l'a creee.
      candidates = [sticky];
    } else {
      candidates = await rankedRemoteNodeRoutes("chat", accountId);
      if (targetNodeId) {
        candidates = candidates.filter((route) => remoteRouteKey(route) === targetNodeId);
      }
      if (candidates.length === 0) {
        const target = remoteChatExecutionTargets().find((candidate) => candidate.id === targetNodeId);
        throw new Error(target
          ? `La cible ${target.label} est indisponible, en maintenance ou ne possede pas ce compte.`
          : "Aucun noeud sain ne possede ce compte ou tous les noeuds sont en maintenance.");
      }
    }

    const agentTools = Array.isArray(args.agentTools) ? args.agentTools : [];
    const agentSkills = Array.isArray(args.agentSkills) ? args.agentSkills : [];
    const imageAttachments = Array.isArray(args.imageAttachments) ? args.imageAttachments : [];
    const payload = {
      accountId,
      sessionId,
      prompt: args.prompt,
      imageAttachments,
      projectDir: args.projectDir ?? null,
      mode: args.mode ?? "build",
      model: args.model ?? null,
      reasoningEffort: args.reasoningEffort ?? null,
      sourceChatKey: args.sourceChatKey ?? null,
      agentTools,
      agentSkills,
      questionTool: agentTools.includes("question"),
      proofTool: agentTools.includes("proof"),
    };
    let lastError: unknown = null;
    for (const route of candidates) {
      try {
        const snapshot = await postChatTurnWithTransportRetry(route, payload);
        rememberRemoteSessionRoute(accountId, sessionId, route, true);
        return decorateRemoteChatSnapshot(snapshot, route) as T;
      } catch (error) {
        lastError = error;
        if (sessionId) break;
      }
    }
    throw lastError ?? new Error("Aucun noeud de chat disponible.");
  });
}

/**
 * Detecte une panne de transport (TypeError "Failed to fetch" ou equiv.) en
 * l'absence de httpStatus : seul cas ou le serveur a PU creer le tour malgre
 * la reponse perdue, et ou un rejoue de la demande est donc legitime.
 */
export const isTransportError = (error: unknown): boolean => {
  if (typeof (error as { httpStatus?: number } | null | undefined)?.httpStatus === "number") {
    return false;
  }
  const raw = String(error);
  return error instanceof TypeError
    || /failed to fetch|networkerror|network request failed|load failed/i.test(raw);
};

const platformSleep = (ms: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/**
 * POST /api/chat/turns avec un rejoue antichute. Sur panne de transport, le
 * serveur a pu lancer le tour sans que la reponse nous revienne : on interroge
 * /api/chat/turns/active (filtrage accountId + sourceChatKey) pour le recuperer
 * avant de retenter l'envoi, sinon l'on dupliquerait la conversation.
 *
 * Une reponse HTTP 4xx/5xx (httpStatus present) est definitive : pas de rejoue.
 */
async function postChatTurnWithTransportRetry(
  route: RemoteTerminalRoute,
  payload: Record<string, any>,
): Promise<Record<string, any>> {
  try {
    return await apiAt<Record<string, any>>(route, "POST", "/api/chat/turns", payload);
  } catch (error) {
    if (!isTransportError(error)) throw error;

    // Laisser au reseau/Tailscale le temps de se retablir avant la verification.
    await platformSleep(800);

    const accountId = String(payload.accountId ?? "");
    const sourceChatKey = typeof payload.sourceChatKey === "string"
      ? payload.sourceChatKey
      : null;
    if (sourceChatKey) {
      try {
        const active = await apiAt<Record<string, any>[]>(
          route,
          "GET",
          "/api/chat/turns/active",
          undefined,
          3_000,
        );
        const match = active.find((turn) =>
          String(turn.accountId ?? "") === accountId
          && String(turn.sourceChatKey ?? "") === sourceChatKey,
        );
        if (match) return match;
      } catch {
        // Sondage de dedoublonnement injoignable : on tente quand meme le rejoue.
      }
    }

    // Aucun tour actif correspondant : la premiere requete n'est pas arrivee,
    // retenter l'envoi est sur et evite le message "Non synchronise".
    return await apiAt<Record<string, any>>(route, "POST", "/api/chat/turns", payload);
  }
}

async function remoteChatTurnRequest<T>(
  id: unknown,
  method: "GET" | "DELETE",
): Promise<T> {
  const { route, remoteId } = remoteChatRouteForId(id);
  const snapshot = await apiAt<Record<string, any>>(
    route,
    method,
    `/api/chat/turns/${encodeURIComponent(String(remoteId))}`,
  );
  return decorateRemoteChatSnapshot(snapshot, route, remoteId) as T;
}

async function listRemoteActiveChatTurns<T>(): Promise<T> {
  const routes = parseRemoteNodes().map(nodeToRoute);
  const results = await Promise.all(
    routes.map(async (route) => {
      try {
        const turns = await apiAt<Record<string, any>[]>(
          route,
          "GET",
          "/api/chat/turns/active",
          undefined,
          1800,
        );
        return { route, turns, error: null as unknown };
      } catch (error) {
        return { route, turns: null, error };
      }
    }),
  );
  if (results.every((result) => result.turns === null)) {
    throw results.at(-1)?.error ?? new Error("Aucun noeud de chat disponible.");
  }
  return results.flatMap((result) =>
    (result.turns ?? []).map((turn) => decorateRemoteChatSnapshot(turn, result.route)),
  ) as T;
}

async function remoteSessionApi<T>(
  accountId: unknown,
  sessionId: unknown,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const route = remoteSessionRoute(accountId, sessionId)
    ?? (typeof accountId === "string" && typeof sessionId === "string"
      ? await locateRemoteSession(accountId, sessionId)
      : null)
    ?? defaultRemoteRoute();
  const response = await apiAt<T>(route, method, path, body);
  if (!response || typeof response !== "object" || Array.isArray(response)) return response;
  const value = response as Record<string, any>;
  const responseAccountId = value.accountId ?? accountId;
  rememberRemoteSessionRoute(responseAccountId, value.sessionId ?? sessionId, route, true);
  rememberRemoteSessionRoute(responseAccountId, value.rolloutId, route, true);
  return {
    ...value,
    nodeId: remoteRouteKey(route),
    nodeLabel: route.label,
  } as T;
}

async function pickRemotePoolAccount<T>() {
  const settings: any = await api("GET", "/api/settings");
  const account = settings.accounts?.find((item: any) => item.codexHome) ?? settings.accounts?.[0];
  if (!account) throw new Error("Aucun compte disponible dans le pool SaaS.");
  return account as T;
}

async function startRemoteTerminal<T>(args: Record<string, any>): Promise<T> {
  const requestedId = Number(args.id);
  const targetNodeId = typeof args.targetNodeId === "string"
    ? normalizeBaseUrl(args.targetNodeId).toLowerCase()
    : "";
  if (Number.isFinite(requestedId)) {
    remoteStartingTerminals.add(requestedId);
    remoteTerminalOutput.delete(requestedId);
  }

  const payload = {
    id: args.id,
    accountId: args.accountId,
    repoUrl: args.repoUrl,
    workspacePath: args.workspacePath,
    branch: args.branch,
    cols: args.cols,
    rows: args.rows,
    command: args.command,
    agentId: args.agentId,
    loginOnly: args.loginOnly ?? false,
  };
  let lastError: unknown = null;

  try {
    const candidates = await terminalNodeCandidates(targetNodeId);
    for (const route of candidates) {
      try {
        const response = await apiAt<RemoteStartResponse>(route, "POST", "/api/terminals", payload);
        if (Number.isFinite(requestedId) && requestedId !== response.id) {
          movePendingTerminalInput(requestedId, response.id);
          moveRemoteTerminalOutput(requestedId, response.id);
        }
        remoteTerminalRoutes.set(response.id, route);
        emitRemoteTerminalData(
          response.id,
          `\r\n[Route] Terminal sur ${route.label} (${route.baseUrl})\r\n`,
        );
        openTerminalSocket(response.id, route);
        return response as T;
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError ?? new Error("Aucun noeud terminal disponible.");
  } finally {
    if (Number.isFinite(requestedId)) {
      remoteStartingTerminals.delete(requestedId);
      if (!remoteTerminalRoutes.has(requestedId)) remotePendingTerminalInput.clear(requestedId);
    }
  }
}

function openTerminalSocket(id: number, route = remoteTerminalRoutes.get(id) ?? defaultRemoteRoute()) {
  clearRemoteTerminalReconnectTimer(id);
  const previous = remoteSockets.get(id);
  if (previous && previous.readyState !== WebSocket.CLOSED) previous.close();

  const base = route.baseUrl;
  const wsBase = base.startsWith("https://")
    ? base.replace(/^https:\/\//, "wss://")
    : base.replace(/^http:\/\//, "ws://");
  let socket: WebSocket;
  try {
    socket = new WebSocket(`${wsBase}/ws/terminals/${id}?token=${encodeURIComponent(route.token)}`);
  } catch (error) {
    emitTerminalTransportError(id, route, error);
    scheduleRemoteTerminalReconnect(id, route);
    return;
  }
  remoteSockets.set(id, socket);

  socket.addEventListener("open", () => {
    if (remoteSockets.get(id) !== socket) return;
    remoteTerminalReconnectAttempts.delete(id);
    const pending = takePendingTerminalInput(id);
    if (pending) socket.send(JSON.stringify({ type: "input", data: pending }));
  });

  socket.addEventListener("message", (event) => {
    if (remoteSockets.get(id) !== socket) return;
    const message = JSON.parse(String(event.data)) as RemoteWsMessage;
    if (message.type === "data") {
      emitRemoteTerminalData(message.id, message.data);
    } else if (message.type === "exit") {
      remoteSockets.delete(message.id);
      remoteTerminalRoutes.delete(message.id);
      clearRemoteTerminalReconnectTimer(message.id);
      remoteTerminalReconnectAttempts.delete(message.id);
      remotePendingTerminalInput.clear(message.id);
      emit("pty-exit", { id: message.id });
      window.setTimeout(() => remoteTerminalOutput.delete(message.id), 30_000);
    } else if (message.type === "error") {
      emitRemoteTerminalData(message.id, `\r\n${message.message}\r\n`);
    } else if (message.type === "status") {
      // Message de controle uniquement. L'injecter dans xterm deplace le
      // curseur a l'insu de la TUI et son prochain redraw peut alors effacer la
      // ligne en cours. Le chemin du dossier figure deja dans la banniere PTY.
    }
  });

  socket.addEventListener("close", () => {
    if (remoteSockets.get(id) !== socket) return;
    remoteSockets.delete(id);
    if (remoteStoppingTerminals.has(id) || !remoteTerminalRoutes.has(id)) return;
    scheduleRemoteTerminalReconnect(id, route);
  });

  socket.addEventListener("error", () => {
    try {
      socket.close();
    } catch {
      scheduleRemoteTerminalReconnect(id, route);
    }
  });
}

function writeRemoteTerminal(id: number, data: string) {
  const socket = remoteSockets.get(id);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data }));
    return;
  }

  if (socket?.readyState === WebSocket.CONNECTING || remoteStartingTerminals.has(id)) {
    queuePendingTerminalInput(id, data);
    return;
  }

  const route = remoteTerminalRoutes.get(id) ?? defaultRemoteRoute();
  void apiAt(route, "POST", `/api/terminals/${id}/write`, { data }).catch((error) => {
    const message = terminalTransportErrorMessage(route.baseUrl, error);
    emit("pty-data", { id, data: `\r\n${message}\r\n` });
    if (/session terminal introuvable/i.test(String(error))) {
      remoteTerminalRoutes.delete(id);
      clearRemoteTerminalReconnectTimer(id);
      remoteTerminalReconnectAttempts.delete(id);
      remotePendingTerminalInput.clear(id);
      emit("pty-exit", { id });
    }
  });
}

function resizeRemoteTerminal(id: number, cols: number, rows: number) {
  const socket = remoteSockets.get(id);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "resize", cols, rows }));
    return;
  }
  if (socket?.readyState === WebSocket.CONNECTING || remoteStartingTerminals.has(id)) return;
  const route = remoteTerminalRoutes.get(id) ?? defaultRemoteRoute();
  void apiAt(route, "POST", `/api/terminals/${id}/resize`, { cols, rows }).catch(() => undefined);
}

async function stopRemoteTerminal(id: number) {
  const route = remoteTerminalRoutes.get(id) ?? defaultRemoteRoute();
  remoteStoppingTerminals.add(id);
  clearRemoteTerminalReconnectTimer(id);
  remoteTerminalReconnectAttempts.delete(id);
  remotePendingTerminalInput.clear(id);
  const socket = remoteSockets.get(id);
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "stop" }));
  }
  socket?.close();
  remoteSockets.delete(id);
  remoteTerminalRoutes.delete(id);
  remoteTerminalOutput.delete(id);
  try {
    await apiAt(route, "DELETE", `/api/terminals/${id}`);
  } catch {
    // La fermeture locale reste effective meme si le noeud est deja parti.
  } finally {
    remoteStoppingTerminals.delete(id);
  }
}

function queuePendingTerminalInput(id: number, data: string) {
  remotePendingTerminalInput.append(id, data);
}

function takePendingTerminalInput(id: number) {
  return remotePendingTerminalInput.take(id);
}

function movePendingTerminalInput(from: number, to: number) {
  remotePendingTerminalInput.move(from, to);
}

function emitRemoteTerminalData(id: number, data: string) {
  const previous = remoteTerminalOutput.get(id) ?? "";
  remoteTerminalOutput.set(id, `${previous}${data}`.slice(-REMOTE_TERMINAL_OUTPUT_LIMIT));
  emit("pty-data", { id, data });
}

function moveRemoteTerminalOutput(from: number, to: number) {
  const output = remoteTerminalOutput.get(from);
  if (output !== undefined) remoteTerminalOutput.set(to, output);
  remoteTerminalOutput.delete(from);
}

function clearRemoteTerminalReconnectTimer(id: number) {
  const timer = remoteTerminalReconnectTimers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  remoteTerminalReconnectTimers.delete(id);
}

function scheduleRemoteTerminalReconnect(id: number, route: RemoteTerminalRoute) {
  if (
    remoteStoppingTerminals.has(id) ||
    !remoteTerminalRoutes.has(id) ||
    remoteTerminalReconnectTimers.has(id)
  ) {
    return;
  }

  const attempt = (remoteTerminalReconnectAttempts.get(id) ?? 0) + 1;
  remoteTerminalReconnectAttempts.set(id, attempt);
  if (attempt > REMOTE_TERMINAL_MAX_RECONNECTS) {
    remoteTerminalRoutes.delete(id);
    remotePendingTerminalInput.clear(id);
    emit("pty-data", {
      id,
      data: "\r\nConnexion au terminal perdue. Ouvre un nouveau terminal pour continuer.\r\n",
    });
    emit("pty-exit", { id });
    return;
  }

  const delay = Math.min(5_000, 250 * 2 ** (attempt - 1));
  const timer = window.setTimeout(() => {
    remoteTerminalReconnectTimers.delete(id);
    if (!remoteTerminalRoutes.has(id) || remoteStoppingTerminals.has(id)) return;
    openTerminalSocket(id, remoteTerminalRoutes.get(id) ?? route);
  }, delay);
  remoteTerminalReconnectTimers.set(id, timer);
}

function emitTerminalTransportError(id: number, route: RemoteTerminalRoute, error: unknown) {
  const message = terminalTransportErrorMessage(route.baseUrl, error);
  emit("pty-data", { id, data: `\r\n${message}\r\n` });
}

function emit<T>(event: string, payload: T) {
  listeners.get(event)?.forEach((handler) => handler({ payload }));
}
