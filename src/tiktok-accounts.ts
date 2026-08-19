import { invoke } from "./platform";
import "./tiktok-accounts.css";

export type TikTokSenderAccount = {
  username: string;
  deviceSerial: string;
  loggedIn: boolean;
  enabled: boolean;
  connected: boolean;
  selected: boolean;
};

export type TikTokAndroidDevice = {
  serial: string;
  state: "device" | "unauthorized" | "offline" | "unknown";
  transport: "usb" | "emulator" | "network" | "unknown";
  model?: string | null;
  product?: string | null;
  tikmatrixManaged: boolean;
};

export type TikTokSenderAccountsView = {
  accounts: TikTokSenderAccount[];
  devices: string[];
  deviceDetails: TikTokAndroidDevice[];
  bridgeOnline: boolean;
  connectorOnline: boolean;
  scrcpyAvailable: boolean;
  adbError: string | null;
  connectorError: string | null;
  setupRequired: boolean;
};

type TikTokSenderSetupAction = {
  id: string;
  action: "open_scrcpy" | "open_login" | "match_accounts";
  status: "queued" | "claimed" | "submitted" | "failed";
  deviceSerial: string;
  detail?: string | null;
};

type TikTokFeedback = {
  tone: "success" | "warning" | "error";
  message: string;
};

export type TikTokAccountsPanelOptions = {
  remoteMode: boolean;
};

export type TikTokAccountsUiOptions = {
  rerender: () => void;
  setStatus?: (message: string) => void;
};

const POLL_INTERVAL_MS = 4_000;

let snapshot: TikTokSenderAccountsView | null = null;
let snapshotSignature = "";
let loading = false;
let error = "";
let feedback: TikTokFeedback | null = null;
let pendingAction: "open_scrcpy" | "open_login" | "match_accounts" | "select" | null = null;
let selectedDevice = "";
let visible = false;
let pollTimer: number | null = null;
let panelRerender: (() => void) | null = null;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const escapeAttr = escapeHtml;

const readableError = (value: unknown): string => {
  const text = String(value instanceof Error ? value.message : value).trim();
  return text || "Une erreur inconnue est survenue.";
};

const deviceDetails = (): TikTokAndroidDevice[] => {
  if (snapshot?.deviceDetails?.length) return snapshot.deviceDetails;
  return (snapshot?.devices ?? []).map((serial) => ({
    serial,
    state: "device",
    transport: "unknown",
    tikmatrixManaged: true,
  }));
};

const readyDeviceSerials = (): string[] =>
  deviceDetails()
    .filter((device) => device.state === "device")
    .map((device) => device.serial);

const effectiveDevice = (): string => {
  const devices = readyDeviceSerials();
  if (selectedDevice && devices.includes(selectedDevice)) return selectedDevice;
  return devices.length === 1 ? devices[0] : "";
};

const syncSelectedDevice = (): void => {
  const devices = readyDeviceSerials();
  if (selectedDevice && devices.includes(selectedDevice)) return;
  selectedDevice = devices.length === 1 ? devices[0] : "";
};

export const refreshTikTokAccounts = async (
  rerender: () => void,
  options: { silent?: boolean } = {},
): Promise<boolean> => {
  if (loading) return false;
  loading = true;
  if (!options.silent) {
    error = "";
    rerender();
  }
  try {
    const next = await invoke<TikTokSenderAccountsView>("list_tiktok_sender_accounts");
    const nextSignature = JSON.stringify(next);
    const changed = nextSignature !== snapshotSignature;
    snapshot = next;
    snapshotSignature = nextSignature;
    error = "";
    syncSelectedDevice();
    loading = false;
    if (changed || !options.silent) rerender();
    return true;
  } catch (cause) {
    const nextError = readableError(cause);
    const changed = nextError !== error || snapshot !== null;
    error = nextError;
    snapshot = null;
    snapshotSignature = "";
    loading = false;
    if (changed || !options.silent) rerender();
    return false;
  }
};

const runSetupAction = async (
  action: "open_scrcpy" | "open_login" | "match_accounts",
  options: TikTokAccountsUiOptions,
): Promise<void> => {
  if (pendingAction) return;
  const deviceSerial = effectiveDevice();
  if (!deviceSerial) {
    feedback = {
      tone: "warning",
      message: "Choisissez d’abord l’appareil Android qui doit ouvrir TikTok.",
    };
    options.rerender();
    return;
  }
  pendingAction = action;
  error = "";
  feedback = null;
  options.rerender();
  try {
    const queued = await invoke<TikTokSenderSetupAction>("manage_tiktok_sender_login", {
      action,
      deviceSerial,
    });
    feedback = action === "open_scrcpy"
      ? {
          tone: "success",
          message: `scrcpy s’ouvre sur ${queued.deviceSerial} depuis le poste Windows connecté au VPS.`,
        }
      : action === "open_login"
        ? {
          tone: "success",
          message:
            `TikTok va s’ouvrir sur ${queued.deviceSerial}. Saisissez vos identifiants, ` +
            "puis effectuez le captcha ou la 2FA uniquement dans cette fenêtre.",
        }
      : {
          tone: "success",
          message:
            "La détection Match Accounts est lancée. Le compte apparaîtra automatiquement ci-dessous.",
        };
    options.setStatus?.(
      action === "open_scrcpy"
        ? "Ouverture de scrcpy demandée"
        : action === "open_login"
        ? "Ouverture de TikTok demandée"
        : "Synchronisation du compte TikTok demandée",
    );
  } catch (cause) {
    feedback = { tone: "error", message: readableError(cause) };
  } finally {
    pendingAction = null;
    options.rerender();
    if (action === "match_accounts") {
      window.setTimeout(() => void refreshTikTokAccounts(options.rerender, { silent: true }), 1_500);
    }
  }
};

const selectSenderAccount = async (
  username: string,
  options: TikTokAccountsUiOptions,
): Promise<void> => {
  if (pendingAction) return;
  pendingAction = "select";
  error = "";
  feedback = null;
  options.rerender();
  try {
    const account = await invoke<TikTokSenderAccount>("select_tiktok_sender_account", {
      username,
    });
    feedback = {
      tone: "success",
      message: `${account.username} est maintenant le compte émetteur TikTok par défaut.`,
    };
    options.setStatus?.(`Compte émetteur TikTok : ${account.username}`);
    await refreshTikTokAccounts(options.rerender, { silent: true });
  } catch (cause) {
    feedback = { tone: "error", message: readableError(cause) };
  } finally {
    pendingAction = null;
    options.rerender();
  }
};

const renderStatus = (): string => {
  if (!snapshot) {
    return `<span class="tiktok-connector-state is-offline"><i data-lucide="wifi-off"></i>Non vérifié</span>`;
  }
  return snapshot.connectorOnline
    ? `<span class="tiktok-connector-state is-online"><i data-lucide="plug-zap"></i>ADB et TikMatrix en ligne</span>`
    : snapshot.bridgeOnline
      ? `<span class="tiktok-connector-state is-warning"><i data-lucide="usb"></i>ADB en ligne · TikMatrix hors ligne</span>`
      : `<span class="tiktok-connector-state is-offline"><i data-lucide="wifi-off"></i>Pont Android hors ligne</span>`;
};

const transportLabel = (transport: TikTokAndroidDevice["transport"]): string => ({
  usb: "Téléphone USB",
  emulator: "Émulateur",
  network: "ADB réseau",
  unknown: "Appareil Android",
})[transport];

const stateLabel = (state: TikTokAndroidDevice["state"]): string => ({
  device: "Prêt",
  unauthorized: "Autorisation USB requise",
  offline: "Hors ligne",
  unknown: "État inconnu",
})[state];

const deviceLabel = (device: TikTokAndroidDevice): string =>
  device.model?.trim() || device.product?.trim() || device.serial;

const renderDeviceChoice = (): string => {
  const devices = deviceDetails();
  if (!devices.length) {
    return `<div class="tiktok-device-empty">
      <i data-lucide="usb"></i>
      <span><strong>Aucun appareil ADB détecté</strong><small>Branchez le téléphone avec le débogage USB activé, ou démarrez un émulateur.</small></span>
    </div>`;
  }
  if (devices.length === 1) {
    const device = devices[0];
    const ready = device.state === "device";
    return `<div class="tiktok-device-selected">
      <span><i data-lucide="${device.transport === "usb" ? "usb" : "smartphone"}"></i><small>${escapeHtml(transportLabel(device.transport))}</small><strong>${escapeHtml(deviceLabel(device))}</strong><small>${escapeHtml(device.serial)} · ${escapeHtml(stateLabel(device.state))}</small></span>
      <i data-lucide="${ready ? "badge-check" : "triangle-alert"}"></i>
    </div>`;
  }
  return `<label class="tiktok-device-picker" for="tiktokDevice">
    <span>Appareil de connexion</span>
    <select id="tiktokDevice">
      <option value="">Choisir un appareil…</option>
      ${devices
        .map(
          (device) =>
            `<option value="${escapeAttr(device.serial)}" ${effectiveDevice() === device.serial ? "selected" : ""} ${device.state === "device" ? "" : "disabled"}>${escapeHtml(deviceLabel(device))} · ${escapeHtml(transportLabel(device.transport))} · ${escapeHtml(stateLabel(device.state))}</option>`,
        )
        .join("")}
    </select>
    <small>Les téléphones USB doivent accepter la demande de débogage affichée sur leur écran.</small>
  </label>`;
};

const renderAccounts = (): string => {
  const accounts = snapshot?.accounts ?? [];
  if (!accounts.length) {
    return `<div class="tiktok-account-empty">
      <span><i data-lucide="user-plus"></i></span>
      <strong>Aucun compte émetteur synchronisé</strong>
      <p>Ouvrez TikTok, terminez la connexion, puis lancez la détection du compte.</p>
    </div>`;
  }
  return `<div class="tiktok-account-list">
    ${accounts
      .map((account) => {
        const ready = account.connected && account.loggedIn && account.enabled;
        const disabled = !ready || !!pendingAction;
        return `<article class="tiktok-account-card ${account.selected ? "is-selected" : ""}">
          <span class="tiktok-account-avatar"><i data-lucide="music-2"></i></span>
          <span class="tiktok-account-copy">
            <span><strong>${escapeHtml(account.username)}</strong>${account.selected ? "<b>Émetteur par défaut</b>" : ""}</span>
            <small><i data-lucide="smartphone"></i>${escapeHtml(account.deviceSerial)}</small>
            <span class="tiktok-account-flags">
              <em class="${account.connected ? "is-ready" : ""}">${account.connected ? "Appareil connecté" : "Appareil hors ligne"}</em>
              <em class="${account.loggedIn ? "is-ready" : ""}">${account.loggedIn ? "Session active" : "Connexion requise"}</em>
            </span>
          </span>
          <button type="button" class="tool-button ${account.selected ? "" : "primary"}" data-tiktok-select="${escapeAttr(account.username)}" ${disabled || account.selected ? "disabled" : ""}>
            <i data-lucide="${account.selected ? "check" : "send"}"></i>
            <span>${account.selected ? "Sélectionné" : "Utiliser ce compte"}</span>
          </button>
        </article>`;
      })
      .join("")}
  </div>`;
};

export const renderTikTokAccountsPanel = ({
  remoteMode,
}: TikTokAccountsPanelOptions): string => {
  if (!remoteMode) {
    return `<div class="tiktok-accounts-panel">
      <section class="tiktok-unavailable">
        <span><i data-lucide="server"></i></span>
        <h2>Connexion VPS requise</h2>
        <p>Connectez Codex Switch Terminal Cloud à votre VPS pour piloter le connecteur TikMatrix.</p>
      </section>
    </div>`;
  }

  const deviceReady = !!effectiveDevice();
  const connectorReady = snapshot?.connectorOnline === true;
  const bridgeReady = snapshot?.bridgeOnline === true || connectorReady;
  const scrcpyActionDisabled =
    !bridgeReady || !deviceReady || snapshot?.scrcpyAvailable !== true || !!pendingAction;
  const tikMatrixActionsDisabled = !connectorReady || !deviceReady || !!pendingAction;
  const accountCount = snapshot?.accounts.length ?? 0;
  return `<div class="tiktok-accounts-panel">
    <section class="tiktok-accounts-hero">
      <div class="tiktok-hero-copy">
        <span class="tiktok-hero-mark"><i data-lucide="music-2"></i></span>
        <span>
          <small>Comptes émetteurs</small>
          <h2>Connecter TikTok à vos chats</h2>
          <p>La session reste dans TikTok et TikMatrix. Aucun mot de passe, captcha, code 2FA ou token n’est envoyé au VPS.</p>
        </span>
      </div>
      <div class="tiktok-hero-status">
        ${renderStatus()}
        <button type="button" id="tiktokRefresh" class="icon-button" title="Actualiser" aria-label="Actualiser les comptes TikTok" ${loading ? "disabled" : ""}>
          <i data-lucide="refresh-cw" class="${loading ? "is-spinning" : ""}"></i>
        </button>
      </div>
    </section>

    ${error ? `<div class="tiktok-feedback is-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(error)}</span></div>` : ""}
    ${feedback ? `<div class="tiktok-feedback is-${feedback.tone}" role="status"><i data-lucide="${feedback.tone === "success" ? "circle-check" : feedback.tone === "warning" ? "triangle-alert" : "circle-alert"}"></i><span>${escapeHtml(feedback.message)}</span></div>` : ""}
    ${snapshot?.adbError ? `<div class="tiktok-feedback is-warning"><i data-lucide="triangle-alert"></i><span>${escapeHtml(snapshot.adbError)}</span></div>` : ""}
    ${snapshot?.connectorError ? `<div class="tiktok-feedback is-warning"><i data-lucide="triangle-alert"></i><span>${escapeHtml(snapshot.connectorError)}</span></div>` : ""}

    <div class="tiktok-setup-grid">
      <section class="tiktok-setup-card">
        <header><span>1</span><div><strong>Choisir l’appareil</strong><small>USB, émulateur ou ADB réseau</small></div></header>
        ${renderDeviceChoice()}
        <button type="button" id="tiktokOpenScrcpy" class="tool-button" ${scrcpyActionDisabled ? "disabled" : ""}>
          <i data-lucide="${pendingAction === "open_scrcpy" ? "loader-circle" : "smartphone"}" class="${pendingAction === "open_scrcpy" ? "is-spinning" : ""}"></i>
          <span>${pendingAction === "open_scrcpy" ? "Ouverture…" : "Afficher avec scrcpy"}</span>
        </button>
        ${snapshot && !snapshot.scrcpyAvailable ? `<small class="tiktok-device-help">scrcpy n’est pas installé ou CST_SCRCPY_PATH n’est pas configuré sur le PC.</small>` : ""}
      </section>
      <section class="tiktok-setup-card">
        <header><span>2</span><div><strong>Se connecter dans TikTok</strong><small>Identifiants et vérifications locales</small></div></header>
        <p>Ouvrez TikTok, puis saisissez vos informations directement dans l’application Android.</p>
        <button type="button" id="tiktokOpenLogin" class="tool-button primary" ${tikMatrixActionsDisabled ? "disabled" : ""}>
          <i data-lucide="${pendingAction === "open_login" ? "loader-circle" : "log-in"}" class="${pendingAction === "open_login" ? "is-spinning" : ""}"></i>
          <span>${pendingAction === "open_login" ? "Ouverture…" : "Ouvrir TikTok et me connecter"}</span>
        </button>
      </section>
      <section class="tiktok-setup-card">
        <header><span>3</span><div><strong>Détecter la session</strong><small>Après le captcha ou la 2FA</small></div></header>
        <p>Une fois la page d’accueil TikTok visible, demandez à TikMatrix de reconnaître le compte.</p>
        <button type="button" id="tiktokMatchAccounts" class="tool-button" ${tikMatrixActionsDisabled ? "disabled" : ""}>
          <i data-lucide="${pendingAction === "match_accounts" ? "loader-circle" : "scan-line"}" class="${pendingAction === "match_accounts" ? "is-spinning" : ""}"></i>
          <span>${pendingAction === "match_accounts" ? "Détection…" : "J’ai terminé · détecter le compte"}</span>
        </button>
      </section>
    </div>

    <section class="tiktok-accounts-section">
      <header>
        <span><small>Comptes disponibles</small><strong>${accountCount} compte${accountCount === 1 ? "" : "s"} reconnu${accountCount === 1 ? "" : "s"}</strong></span>
        <span class="tiktok-security-note"><i data-lucide="shield-check"></i>Session locale protégée</span>
      </header>
      ${loading && !snapshot ? `<div class="tiktok-account-loading"><i data-lucide="loader-circle" class="is-spinning"></i><span>Recherche du connecteur TikMatrix…</span></div>` : renderAccounts()}
    </section>
  </div>`;
};

export const bindTikTokAccountsUi = (options: TikTokAccountsUiOptions): void => {
  document.querySelector<HTMLSelectElement>("#tiktokDevice")?.addEventListener("change", (event) => {
    selectedDevice = (event.currentTarget as HTMLSelectElement).value;
    feedback = null;
    options.rerender();
  });
  document.querySelector<HTMLButtonElement>("#tiktokRefresh")?.addEventListener("click", () => {
    void refreshTikTokAccounts(options.rerender);
  });
  document.querySelector<HTMLButtonElement>("#tiktokOpenScrcpy")?.addEventListener("click", () => {
    void runSetupAction("open_scrcpy", options);
  });
  document.querySelector<HTMLButtonElement>("#tiktokOpenLogin")?.addEventListener("click", () => {
    void runSetupAction("open_login", options);
  });
  document.querySelector<HTMLButtonElement>("#tiktokMatchAccounts")?.addEventListener("click", () => {
    void runSetupAction("match_accounts", options);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-tiktok-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const username = button.dataset.tiktokSelect;
      if (username) void selectSenderAccount(username, options);
    });
  });
};

export const activateTikTokAccountsPanel = (
  rerender: () => void,
  remoteMode = true,
): void => {
  visible = true;
  panelRerender = rerender;
  if (!remoteMode) return;
  if (pollTimer === null) {
    pollTimer = window.setInterval(() => {
      if (visible && panelRerender) {
        void refreshTikTokAccounts(panelRerender, { silent: true });
      }
    }, POLL_INTERVAL_MS);
  }
  void refreshTikTokAccounts(rerender, { silent: snapshot !== null });
};

export const deactivateTikTokAccountsPanel = (): void => {
  visible = false;
  panelRerender = null;
  if (pollTimer !== null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
};
