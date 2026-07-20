import {
  hasRemoteAuth,
  invoke,
  remoteBaseUrl,
  remoteNodesText,
  saveRemoteConfig,
} from "./platform";
import "./vps.css";

export type VpsDeployCapabilities = {
  supported: boolean;
  platform: string;
  powershell: string | null;
  scriptPath: string | null;
  missingCommands: string[];
  message: string;
};

export type VpsDeployJob = {
  id: string;
  nodeId: string;
  nodeLabel: string;
  sshTarget: string;
  localPort: number;
  status: "running" | "succeeded" | "failed";
  message: string;
  log: string;
  createdAt: number;
  finishedAt: number | null;
  exitCode: number | null;
};

export type GoogleCloudStatus = {
  supported: boolean;
  installed: boolean;
  authenticated: boolean;
  account: string | null;
  projects: string[];
  selectedProject: string | null;
  billingReady: boolean;
  billingEnabled: boolean;
  authInProgress: boolean;
  message: string;
};

type GoogleCloudAction = {
  started: boolean;
  message: string;
};

type VpsDraft = {
  sshTarget: string;
  identityFile: string;
  knownHostsFile: string;
  sshPort: string;
  remotePort: string;
  localPort: string;
  nodeId: string;
  nodeLabel: string;
  capacity: string;
  seedAccounts: boolean;
  acceptNewHostKey: boolean;
};

const draft: VpsDraft = {
  sshTarget: "",
  identityFile: "",
  knownHostsFile: "",
  sshPort: "22",
  remotePort: "8080",
  // Le site principal occupe deja 8080 sur la machine locale.
  localPort: "8081",
  nodeId: "vps-1",
  nodeLabel: "Mon VPS",
  capacity: "4",
  seedAccounts: true,
  acceptNewHostKey: false,
};

let capabilities: VpsDeployCapabilities | null = null;
let jobs: VpsDeployJob[] = [];
let googleStatus: GoogleCloudStatus | null = null;
let googleProjectId = "";
let googleActionBusy = false;
let loading = false;
let submitting = false;
let errorMessage = "";
let active = false;
let showAdvancedOptions = false;
let historyExpanded = false;
let refreshPromise: Promise<void> | null = null;
let pollTimer: number | null = null;

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatDate = (unix: number): string =>
  new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(unix * 1_000));

const jobLabel = (status: VpsDeployJob["status"]): string => {
  if (status === "running") return "En cours";
  if (status === "succeeded") return "Déployé";
  return "Échec";
};

const jobIcon = (status: VpsDeployJob["status"]): string => {
  if (status === "running") return "loader-circle";
  if (status === "succeeded") return "check";
  return "circle-alert";
};

const input = (
  name: keyof VpsDraft,
  label: string,
  options: { type?: string; placeholder?: string; min?: number; max?: number; wide?: boolean } = {},
): string => `
  <label class="vps-field ${options.wide ? "is-wide" : ""}">
    <span>${escapeHtml(label)}</span>
    <input
      name="${name}"
      type="${options.type ?? "text"}"
      value="${escapeHtml(draft[name])}"
      ${options.placeholder ? `placeholder="${escapeHtml(options.placeholder)}"` : ""}
      ${options.min !== undefined ? `min="${options.min}"` : ""}
      ${options.max !== undefined ? `max="${options.max}"` : ""}
      ${submitting ? "disabled" : ""}
    />
  </label>`;

const renderJob = (job: VpsDeployJob): string => {
  const command = `npm run connect:vps -- -Profile ${job.nodeId}`;
  return `
    <article class="vps-job is-${job.status}">
      <header>
        <span class="vps-job-icon"><i data-lucide="${jobIcon(job.status)}"></i></span>
        <span class="vps-job-title">
          <strong>${escapeHtml(job.nodeLabel)}</strong>
          <small>${escapeHtml(job.sshTarget)} · ${formatDate(job.createdAt)}</small>
        </span>
        <span class="vps-job-status">${jobLabel(job.status)}</span>
      </header>
      <p>${escapeHtml(job.message)}</p>
      ${job.status === "succeeded"
        ? `<div class="vps-next-step">
            <span>Connexion SSH depuis cette machine</span>
            <code>${escapeHtml(command)}</code>
          </div>`
        : ""}
      <details>
        <summary>Journal technique${job.exitCode === null ? "" : ` · code ${job.exitCode}`}</summary>
        <pre>${escapeHtml(job.log || "En attente de la première sortie…")}</pre>
      </details>
    </article>`;
};

const renderGoogleCloud = (running: VpsDeployJob | null): string => {
  const status = googleStatus;
  const infrastructureUnlocked = hasRemoteAuth();
  const googleAvailable = infrastructureUnlocked && status?.supported !== false;
  const connected = status?.authenticated === true;
  const billingReady = status?.billingReady === true;
  const readyToDeploy = googleAvailable && connected && billingReady;
  const statusLabel = !infrastructureUnlocked
    ? "Verrouillé"
    : status?.supported === false
      ? "Indisponible"
      : status?.authInProgress
    ? "Connexion en cours"
    : readyToDeploy
      ? "Prêt"
      : connected
        ? "Compte connecté"
        : "À connecter";
  const projects = status?.projects ?? [];
  const selectedProject = googleProjectId || status?.selectedProject || "";
  const projectOptions = projects.length
    ? `${projects.length > 1 ? `<option value="">Choisir un projet</option>` : ""}${projects
        .map((project) => `<option value="${escapeHtml(project)}" ${project === selectedProject ? "selected" : ""}>${escapeHtml(project)}</option>`)
        .join("")}`
    : `<option value="">Projet CST créé automatiquement</option>`;

  return `
    <section class="vps-card vps-google-card" aria-labelledby="vpsGoogleTitle">
      <div class="vps-card-heading">
        <div class="vps-card-title">
          <span><i data-lucide="cloud"></i></span>
          <div>
            <h2 id="vpsGoogleTitle">Google Cloud</h2>
            <p>Connexion officielle, crédit d’essai, VM puis déploiement automatique.</p>
          </div>
        </div>
        <span class="vps-google-state ${readyToDeploy ? "is-ready" : ""}">${escapeHtml(statusLabel)}</span>
      </div>

      <div class="vps-google-steps">
        <div class="${connected ? "is-complete" : "is-current"}">
          <span>${connected ? `<i data-lucide="check"></i>` : "1"}</span>
          <div><strong>Compte Google</strong><small>${connected ? escapeHtml(status?.account ?? "Connecté") : "Autorisation OAuth dans le navigateur Google"}</small></div>
        </div>
        <div class="${billingReady ? "is-complete" : connected ? "is-current" : ""}">
          <span>${billingReady ? `<i data-lucide="check"></i>` : "2"}</span>
          <div><strong>Essai gratuit</strong><small>${billingReady ? "Compte de facturation actif" : "Tu saisis la carte uniquement chez Google"}</small></div>
        </div>
        <div class="${readyToDeploy ? "is-current" : ""}">
          <span>3</span>
          <div><strong>VM 2 vCPU / 8 Go</strong><small>Ubuntu 24.04 · Europe · Ansible + Docker Compose</small></div>
        </div>
      </div>

      ${status?.message ? `<p class="vps-google-message">${escapeHtml(status.message)}</p>` : ""}

      ${connected
        ? `<label class="vps-google-project">
            <span>Projet Google Cloud</span>
            <select id="vpsGoogleProject" ${googleActionBusy || running ? "disabled" : ""}>${projectOptions}</select>
          </label>`
        : ""}

      <div class="vps-google-actions">
        <button id="vpsGoogleConnect" type="button" class="vps-secondary-button" ${!googleAvailable || googleActionBusy || status?.authInProgress ? "disabled" : ""}>
          <i data-lucide="${status?.authInProgress ? "loader-circle" : connected ? "refresh-cw" : "log-in"}"></i>
          <span>${status?.authInProgress ? "Connexion…" : connected ? "Changer de compte" : "Connecter Google"}</span>
        </button>
        <button id="vpsGoogleTrial" type="button" class="vps-secondary-button" ${!googleAvailable || googleActionBusy ? "disabled" : ""}>
          <i data-lucide="external-link"></i><span>${billingReady ? "Gérer la facturation" : "Activer l’essai"}</span>
        </button>
        <button id="vpsGoogleDeploy" type="button" class="vps-submit vps-google-deploy" ${!readyToDeploy || googleActionBusy || submitting || running || (projects.length > 1 && !selectedProject) ? "disabled" : ""}>
          <i data-lucide="${googleActionBusy || running?.nodeId === "google-trial" ? "loader-circle" : "server"}"></i>
          <span>${running?.nodeId === "google-trial" ? "Déploiement Google en cours…" : "Créer et déployer"}</span>
        </button>
      </div>

      <div class="vps-security-note vps-google-security">
        <i data-lucide="shield-check"></i>
        <span>
          <span>CST ne voit jamais ton mot de passe, ton MFA ni ta carte. Ces informations restent exclusivement sur les pages officielles Google.</span>
          <small>La VM 8 Go utilise le crédit d’essai ; elle devient facturable uniquement si le compte est ensuite passé volontairement au mode payant.</small>
        </span>
      </div>
    </section>`;
};

export const renderVpsPanel = (): string => {
  const running = jobs.find((job) => job.status === "running") ?? null;
  const historyVisible = historyExpanded;
  const needsAdminToken = !hasRemoteAuth();
  const ready = capabilities?.supported === true;
  const capabilityTone = capabilities || needsAdminToken ? "blocked" : "checking";
  const capabilityTitle = needsAdminToken
    ? "Jeton administrateur requis"
    : capabilities
      ? "Action requise"
      : "Vérification…";
  const capabilityIcon = needsAdminToken
    ? "lock-keyhole"
    : capabilities
        ? "triangle-alert"
        : "loader-circle";

  return `
    <section id="vpsPanel" class="vps-panel" aria-labelledby="vpsPanelTitle">
      <header class="vps-heading">
        <div>
          <h1 id="vpsPanelTitle">Déployer un VPS</h1>
          <p>Installe le même environnement avec Ansible et Docker Compose.</p>
        </div>
        <button id="vpsRefresh" type="button" class="vps-secondary-button" aria-label="Actualiser l’état du serveur" ${loading ? "disabled" : ""}>
          <i data-lucide="refresh-ccw"></i><span>${loading ? "Vérification…" : "Actualiser"}</span>
        </button>
      </header>

      ${ready
        ? ""
        : `<div class="vps-capability is-${capabilityTone}" role="status">
            <span><i data-lucide="${capabilityIcon}"></i></span>
            <div>
              <strong>${capabilityTitle}</strong>
              <p>${escapeHtml(needsAdminToken
                ? "Déverrouille cette vue avec le jeton administrateur du serveur :8080."
                : capabilities?.message ?? "Vérification des outils requis sur le serveur :8080.")}</p>
            </div>
          </div>`}

      ${needsAdminToken
        ? `<form id="vpsAdminUnlock" class="vps-admin-unlock">
            <div><i data-lucide="lock-keyhole"></i><span><strong>Accès infrastructure</strong><small>Le jeton reste dans la configuration locale déjà utilisée par l’interface distante.</small></span></div>
            <label><span>Jeton admin</span><input id="vpsAdminToken" type="password" autocomplete="current-password" required /></label>
            <button type="submit"><i data-lucide="lock-open"></i><span>Déverrouiller</span></button>
          </form>`
        : ""}

      ${errorMessage
        ? `<div class="vps-alert" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(errorMessage)}</span></div>`
        : ""}

      <div class="vps-layout">
        ${renderGoogleCloud(running)}
        <form id="vpsDeployForm" class="vps-card vps-form">
          <div class="vps-card-heading">
            <div class="vps-card-title">
              <span><i data-lucide="server"></i></span>
              <div><h2>Connexion SSH</h2><p>Trois informations suffisent, quel que soit le fournisseur.</p></div>
            </div>
            <button
              id="vpsDetailsToggle"
              type="button"
              class="vps-details-toggle"
              aria-expanded="${showAdvancedOptions}"
              aria-controls="vpsAdvancedSettings"
            >
              <i data-lucide="${showAdvancedOptions ? "chevron-up" : "sliders-horizontal"}"></i>
              <span>${showAdvancedOptions ? "Masquer les options" : "Options avancées"}</span>
            </button>
          </div>

          <div class="vps-form-grid vps-form-grid-primary">
            ${input("sshTarget", "Cible SSH", { placeholder: "ubuntu@203.0.113.10", wide: true })}
            ${input("identityFile", "Chemin de la clé privée", { placeholder: "C:\\Users\\vous\\.ssh\\id_ed25519", wide: true })}
            ${input("nodeLabel", "Nom affiché", { placeholder: "Mon VPS" })}
          </div>

          <section id="vpsAdvancedSettings" class="vps-advanced-settings" ${showAdvancedOptions ? "" : "hidden"}>
            <div class="vps-section-heading">
              <h3>Réglages avancés</h3>
              <p>Les valeurs proposées conviennent à la plupart des installations.</p>
            </div>

            <div class="vps-form-grid">
              ${input("knownHostsFile", "Fichier known_hosts (optionnel)", { placeholder: "C:\\Users\\vous\\.ssh\\known_hosts", wide: true })}
              ${input("sshPort", "Port SSH", { type: "number", min: 1, max: 65535 })}
              ${input("remotePort", "Port distant", { type: "number", min: 1, max: 65535 })}
              ${input("localPort", "Port local du tunnel", { type: "number", min: 1, max: 65535 })}
              ${input("nodeId", "Identifiant", { placeholder: "vps-1" })}
              ${input("capacity", "Chats simultanés", { type: "number", min: 1, max: 1024 })}
            </div>

            <div class="vps-options">
              <label>
                <input name="seedAccounts" type="checkbox" ${draft.seedAccounts ? "checked" : ""} ${submitting ? "disabled" : ""} />
                <span><strong>Copier les comptes locaux</strong><small>Amorce les mêmes comptes Codex sur le VPS lors de la première installation.</small></span>
              </label>
              <label>
                <input name="acceptNewHostKey" type="checkbox" ${draft.acceptNewHostKey ? "checked" : ""} ${submitting ? "disabled" : ""} />
                <span><strong>Accepter une nouvelle empreinte SSH</strong><small>À activer uniquement après avoir vérifié l’empreinte du serveur chez l’hébergeur.</small></span>
              </label>
            </div>

            <div class="vps-security-note">
              <i data-lucide="lock-keyhole"></i>
              <span>La clé est lue sur la machine qui héberge ce site, jamais envoyée au navigateur. Ubuntu/Debian, Python 3 et <code>sudo -n</code> sont requis.</span>
            </div>

            <div class="vps-process">
              <div class="vps-section-heading">
                <h3>Déroulement</h3>
                <p>Test, transfert, conteneurisation puis contrôle de santé.</p>
              </div>
              <ol>
                <li><b>1</b><span><strong>Tester SSH</strong><small>Clé, empreinte et privilèges.</small></span></li>
                <li><b>2</b><span><strong>Transférer</strong><small>Application et comptes optionnels.</small></span></li>
                <li><b>3</b><span><strong>Installer</strong><small>Docker Compose piloté par Ansible.</small></span></li>
                <li><b>4</b><span><strong>Valider</strong><small>Contrôle de santé du nœud.</small></span></li>
              </ol>
            </div>
          </section>

          ${showAdvancedOptions
            ? ""
            : `<p class="vps-defaults-hint"><i data-lucide="sparkles"></i><span>Les réglages recommandés sont déjà appliqués.</span></p>`}

          <button class="vps-submit" type="submit" ${!ready || submitting || running ? "disabled" : ""}>
            <i data-lucide="${submitting || running ? "loader-circle" : "server"}"></i>
            <span>${submitting ? "Démarrage…" : running ? `Déploiement de ${escapeHtml(running.nodeId)} en cours…` : "Déployer avec Ansible + Docker"}</span>
          </button>
        </form>
      </div>

      <section class="vps-history ${historyVisible ? "" : "is-collapsed"}" aria-labelledby="vpsHistoryTitle">
        <div class="vps-history-heading">
          <div>
            <h2 id="vpsHistoryTitle">Déploiements récents</h2>
            ${jobs.length === 0
              ? `<p>Aucun déploiement lancé.</p>`
              : historyVisible
                ? `<p>Les journaux restent uniquement en mémoire sur ce serveur.</p>`
                : `<p>${jobs.length} opération${jobs.length === 1 ? "" : "s"} masquée${jobs.length === 1 ? "" : "s"}.</p>`}
          </div>
          <div class="vps-history-actions">
            <span>${jobs.length}</span>
            ${jobs.length
              ? `<button id="vpsHistoryToggle" type="button" aria-expanded="${historyVisible}" aria-controls="vpsHistoryContent">
                  <i data-lucide="${historyVisible ? "chevron-up" : "chevron-down"}"></i>
                  <span>${historyVisible ? "Masquer" : "Afficher"}</span>
                </button>`
              : ""}
          </div>
        </div>
        ${jobs.length && historyVisible
          ? `<div id="vpsHistoryContent" class="vps-job-list">${jobs.map(renderJob).join("")}</div>`
          : ""}
      </section>
    </section>`;
};

const readDraft = (form: HTMLFormElement): void => {
  const data = new FormData(form);
  draft.sshTarget = String(data.get("sshTarget") ?? "").trim();
  draft.identityFile = String(data.get("identityFile") ?? "").trim();
  draft.knownHostsFile = String(data.get("knownHostsFile") ?? "").trim();
  draft.sshPort = String(data.get("sshPort") ?? "22");
  draft.remotePort = String(data.get("remotePort") ?? "8080");
  draft.localPort = String(data.get("localPort") ?? "8081");
  draft.nodeId = String(data.get("nodeId") ?? "").trim();
  draft.nodeLabel = String(data.get("nodeLabel") ?? "").trim();
  draft.capacity = String(data.get("capacity") ?? "1");
  draft.seedAccounts = data.has("seedAccounts");
  draft.acceptNewHostKey = data.has("acceptNewHostKey");
};

const requestFromDraft = () => ({
  sshTarget: draft.sshTarget,
  identityFile: draft.identityFile,
  knownHostsFile: draft.knownHostsFile,
  sshPort: Number(draft.sshPort),
  remotePort: Number(draft.remotePort),
  localPort: Number(draft.localPort),
  nodeId: draft.nodeId,
  nodeLabel: draft.nodeLabel,
  capacity: Number(draft.capacity),
  seedAccounts: draft.seedAccounts,
  acceptNewHostKey: draft.acceptNewHostKey,
});

const clearPoll = (): void => {
  if (pollTimer !== null) window.clearTimeout(pollTimer);
  pollTimer = null;
};

const schedulePoll = (rerender: () => void): void => {
  clearPoll();
  if (
    !active
    || (!jobs.some((job) => job.status === "running") && !googleStatus?.authInProgress)
  ) return;
  pollTimer = window.setTimeout(() => void refreshVpsPanel(rerender, true), 1_500);
};

export const refreshVpsPanel = (
  rerender: () => void,
  silent = false,
): Promise<void> => {
  if (!hasRemoteAuth()) {
    loading = false;
    errorMessage = "";
    if (active) rerender();
    return Promise.resolve();
  }
  if (refreshPromise) return refreshPromise;
  const pending = (async () => {
    if (!silent) loading = true;
    try {
      const [nextCapabilities, nextJobs, nextGoogleStatus] = await Promise.all([
        invoke<VpsDeployCapabilities>("vps_deploy_capabilities"),
        invoke<VpsDeployJob[]>("vps_list_deployments"),
        invoke<GoogleCloudStatus>("vps_google_status"),
      ]);
      const revealRunningJob = !jobs.some((job) => job.status === "running")
        && nextJobs.some((job) => job.status === "running");
      capabilities = nextCapabilities;
      jobs = nextJobs;
      googleStatus = nextGoogleStatus;
      if (
        !googleProjectId
        || (nextGoogleStatus.projects.length > 0
          && !nextGoogleStatus.projects.includes(googleProjectId))
      ) {
        googleProjectId = nextGoogleStatus.selectedProject
          ?? (nextGoogleStatus.projects.length === 1 ? nextGoogleStatus.projects[0] : "");
      }
      if (revealRunningJob) historyExpanded = true;
      errorMessage = "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errorMessage = /token admin|authentification|unauthorized/i.test(message)
        ? "Cet onglet exige le jeton administrateur du serveur :8080. Reconnecte l’interface avec ce jeton pour gérer l’infrastructure."
        : message;
    } finally {
      loading = false;
      refreshPromise = null;
      if (active) rerender();
      schedulePoll(rerender);
    }
  })();
  refreshPromise = pending;
  return pending;
};

export const activateVpsPanel = (rerender: () => void): void => {
  active = true;
  if (!hasRemoteAuth()) {
    rerender();
    return;
  }
  void refreshVpsPanel(rerender, capabilities !== null);
};

export const deactivateVpsPanel = (): void => {
  active = false;
  clearPoll();
};

export const bindVpsPanel = (rerender: () => void): void => {
  document.querySelector<HTMLFormElement>("#vpsAdminUnlock")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#vpsAdminToken");
    const token = input?.value.trim() ?? "";
    if (!token) {
      input?.setCustomValidity("Jeton administrateur requis");
      input?.reportValidity();
      return;
    }
    saveRemoteConfig(remoteBaseUrl(), token, remoteNodesText());
    capabilities = null;
    errorMessage = "";
    void refreshVpsPanel(rerender);
  });

  document.querySelector<HTMLButtonElement>("#vpsRefresh")?.addEventListener("click", () => {
    void refreshVpsPanel(rerender);
  });

  document.querySelector<HTMLButtonElement>("#vpsDetailsToggle")?.addEventListener("click", () => {
    showAdvancedOptions = !showAdvancedOptions;
    rerender();
  });

  document.querySelector<HTMLButtonElement>("#vpsHistoryToggle")?.addEventListener("click", () => {
    historyExpanded = !historyExpanded;
    rerender();
  });

  document.querySelector<HTMLSelectElement>("#vpsGoogleProject")?.addEventListener("change", (event) => {
    googleProjectId = (event.currentTarget as HTMLSelectElement).value.trim();
    rerender();
  });

  document.querySelector<HTMLButtonElement>("#vpsGoogleConnect")?.addEventListener("click", () => {
    googleActionBusy = true;
    errorMessage = "";
    rerender();
    void (async () => {
      try {
        const action = await invoke<GoogleCloudAction>("vps_google_start_auth");
        if (googleStatus) {
          googleStatus = {
            ...googleStatus,
            authInProgress: action.started || googleStatus.authInProgress,
            message: action.message,
          };
        }
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        googleActionBusy = false;
        await refreshVpsPanel(rerender, true);
      }
    })();
  });

  document.querySelector<HTMLButtonElement>("#vpsGoogleTrial")?.addEventListener("click", () => {
    googleActionBusy = true;
    errorMessage = "";
    rerender();
    void (async () => {
      try {
        await invoke<GoogleCloudAction>("vps_google_open_trial");
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        googleActionBusy = false;
        if (active) rerender();
      }
    })();
  });

  document.querySelector<HTMLButtonElement>("#vpsGoogleDeploy")?.addEventListener("click", () => {
    googleActionBusy = true;
    historyExpanded = true;
    errorMessage = "";
    rerender();
    void (async () => {
      try {
        const job = await invoke<VpsDeployJob>("vps_google_start_deployment", {
          request: {
            projectId: googleProjectId,
            seedAccounts: draft.seedAccounts,
          },
        });
        jobs = [job, ...jobs.filter((candidate) => candidate.id !== job.id)];
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        googleActionBusy = false;
        if (active) rerender();
        schedulePoll(rerender);
      }
    })();
  });

  const form = document.querySelector<HTMLFormElement>("#vpsDeployForm");
  if (!form) return;
  form.addEventListener("input", () => readDraft(form));
  form.addEventListener("change", () => readDraft(form));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    readDraft(form);
    submitting = true;
    historyExpanded = true;
    errorMessage = "";
    rerender();
    void (async () => {
      try {
        const job = await invoke<VpsDeployJob>("vps_start_deployment", {
          request: requestFromDraft(),
        });
        jobs = [job, ...jobs.filter((candidate) => candidate.id !== job.id)];
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      } finally {
        submitting = false;
        if (active) rerender();
        schedulePoll(rerender);
      }
    })();
  });
};
