import { renderMarkdown } from "./chat/markdown";
import "./design.css";

export type DesignTool = "claude" | "kombai";
export type ClaudeDesignMode = "prototype" | "wireframe" | "presentation" | "system";

export type ClaudeDesignAccountOption = {
  id: string;
  label: string;
  model: string;
};

export type ClaudeDesignMessage = {
  role: "user" | "assistant";
  text: string;
  timestamp: number;
  deliveryState?: "pending" | "failed";
};

export type ClaudeDesignStudioModel = {
  accounts: ClaudeDesignAccountOption[];
  selectedAccountId: string;
  projectDir: string | null;
  messages: ClaudeDesignMessage[];
  livePartsHtml: string;
  status: "idle" | "running" | "finalizing" | "completed" | "failed" | "cancelled";
  error: string | null;
  draft: string;
  loading: boolean;
  mode: ClaudeDesignMode;
  sessionId: string | null;
};

type DesignPanelModel = {
  activeTool: DesignTool;
  projectDir: string | null;
  claudeStudio: ClaudeDesignStudioModel;
  kombaiPanelHtml: string;
  kombaiRunning: boolean;
};

type ModeMeta = {
  icon: string;
  label: string;
  description: string;
  starter: string;
};

const CLAUDE_DESIGN_MODES: Record<ClaudeDesignMode, ModeMeta> = {
  prototype: {
    icon: "layout-grid",
    label: "Prototype",
    description: "Une interface fonctionnelle, responsive et directement testable.",
    starter: "Crée un prototype moderne et responsive pour ",
  },
  wireframe: {
    icon: "layout-template",
    label: "Wireframe",
    description: "Structure les écrans, les parcours et la hiérarchie avant la finition.",
    starter: "Conçois le wireframe et le parcours utilisateur pour ",
  },
  presentation: {
    icon: "clapperboard",
    label: "Présentation",
    description: "Transforme une idée en narration visuelle claire et convaincante.",
    starter: "Crée une présentation visuelle claire sur ",
  },
  system: {
    icon: "library",
    label: "Design system",
    description: "Définis les composants, tokens et règles visuelles du produit.",
    starter: "Crée ou améliore le design system de ce projet en commençant par ",
  },
};

export const normalizeDesignTool = (value: unknown): DesignTool =>
  value === "kombai" ? "kombai" : "claude";

export const normalizeClaudeDesignMode = (value: unknown): ClaudeDesignMode =>
  value === "wireframe" || value === "presentation" || value === "system"
    ? value
    : "prototype";

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const renderClaudeDesignMessage = (
  message: ClaudeDesignMessage,
  index: number,
): string => {
  const assistant = message.role === "assistant";
  return `<article class="design-chat-message ${assistant ? "assistant" : "user"}" data-design-message="${index}">
    <span class="design-chat-avatar"><i data-lucide="${assistant ? "sparkles" : "users"}"></i></span>
    <div class="design-chat-bubble">
      <header><strong>${assistant ? "Claude" : "Vous"}</strong>${message.deliveryState === "failed" ? "<small>Échec de l’envoi</small>" : ""}</header>
      <div class="design-chat-copy">${assistant ? renderMarkdown(message.text) : `<p>${escapeHtml(message.text).replaceAll("\n", "<br>")}</p>`}</div>
    </div>
  </article>`;
};

const renderClaudeDesignFeed = (model: ClaudeDesignStudioModel): string => {
  if (model.loading && model.messages.length === 0) {
    return `<div class="design-chat-loading" role="status"><span></span><strong>Chargement de la session Claude…</strong></div>`;
  }

  const messages = model.messages
    .map((message, index) => renderClaudeDesignMessage(message, index))
    .join("");
  const empty = !messages && !model.livePartsHtml
    ? `<div class="design-chat-welcome">
        <span class="design-chat-welcome-mark"><i data-lucide="wand-sparkles"></i></span>
        <h2>Imagine, ajuste, construis.</h2>
        <p>Claude travaille ici, dans ton projet actuel. Décris le résultat visuel attendu et il peut analyser puis modifier les fichiers directement.</p>
        <div class="design-chat-starters">
          ${Object.entries(CLAUDE_DESIGN_MODES).map(([mode, meta]) => `<button type="button" data-design-starter="${escapeHtml(meta.starter)}" data-design-starter-mode="${mode}"><i data-lucide="${meta.icon}"></i><span><strong>${meta.label}</strong><small>${meta.description}</small></span></button>`).join("")}
        </div>
      </div>`
    : "";
  const live = model.livePartsHtml
    ? `<section id="claudeDesignLive" class="design-chat-live" aria-live="polite">${model.livePartsHtml}</section>`
    : `<section id="claudeDesignLive" class="design-chat-live" aria-live="polite"></section>`;
  const error = model.error
    ? `<div id="claudeDesignError" class="design-chat-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(model.error)}</span></div>`
    : `<div id="claudeDesignError" class="design-chat-error" role="alert" hidden></div>`;
  return `${empty}${messages}${live}${error}`;
};

const renderClaudeSetup = (projectDir: string | null): string => `
  <div class="design-claude-setup">
    <span class="design-claude-setup-mark"><i data-lucide="sparkles"></i></span>
    <small>Claude Design intégré</small>
    <h2>Ajoute un compte Claude pour créer ici.</h2>
    <p>Le studio utilise Claude Code en arrière-plan et garde toute l’expérience dans cette fenêtre. Aucun onglet externe n’est nécessaire.</p>
    <button id="designClaudeConfigure" type="button" class="tool-button primary"><i data-lucide="user-plus"></i><span>Configurer un compte Claude</span></button>
    ${projectDir ? `<code>${escapeHtml(projectDir)}</code>` : ""}
  </div>`;

export const renderClaudeDesignWorkspace = (model: ClaudeDesignStudioModel): string => {
  if (model.accounts.length === 0) return renderClaudeSetup(model.projectDir);

  const busy = model.status === "running" || model.status === "finalizing";
  const canWriteLocally = !!model.projectDir;
  const composerDisabled = busy || !canWriteLocally;
  const mode = CLAUDE_DESIGN_MODES[model.mode];
  const selectedAccount = model.accounts.find((account) => account.id === model.selectedAccountId)
    ?? model.accounts[0];
  const stateLabel = model.loading
    ? "Chargement"
    : model.status === "running"
      ? "Claude travaille"
      : model.status === "finalizing"
        ? "Finalisation"
        : model.status === "failed"
          ? "Échec"
          : "Prêt";

  return `<div class="design-claude-workspace" data-design-status="${model.status}">
    <section class="design-studio-shell">
      <header class="design-studio-toolbar">
        <div class="design-studio-identity">
          <span><i data-lucide="sparkles"></i></span>
          <div><strong>Claude Design</strong><small>Intégré à cette fenêtre</small></div>
        </div>
        <div class="design-studio-controls">
          <label class="design-account-select"><span>Compte</span><select id="claudeDesignAccount" ${busy ? "disabled" : ""}>${model.accounts.map((account) => `<option value="${escapeHtml(account.id)}" ${account.id === selectedAccount.id ? "selected" : ""}>${escapeHtml(account.label)} · ${escapeHtml(account.model)}</option>`).join("")}</select></label>
          <span id="claudeDesignRunState" class="design-run-state ${busy ? "is-running" : ""} ${!canWriteLocally ? "needs-project" : ""}"><i data-lucide="${!canWriteLocally ? "folder-x" : busy ? "loader-circle" : "circle-check"}"></i>${!canWriteLocally ? "Dossier requis" : stateLabel}</span>
          <button id="claudeDesignNew" type="button" class="icon-button" title="Nouvelle session Design" aria-label="Nouvelle session Design" ${busy ? "disabled" : ""}><i data-lucide="message-square-plus"></i></button>
        </div>
      </header>

      <div id="claudeDesignFeed" class="design-chat-feed">${renderClaudeDesignFeed(model)}</div>

      <form id="claudeDesignComposer" class="design-composer ${!canWriteLocally ? "is-blocked" : ""}" data-local-save="required">
        <div class="design-mode-picker" aria-label="Type de création">
          ${Object.entries(CLAUDE_DESIGN_MODES).map(([value, item]) => `<button type="button" data-claude-design-mode="${value}" class="${value === model.mode ? "active" : ""}" aria-pressed="${value === model.mode}" title="${escapeHtml(item.description)}"><i data-lucide="${item.icon}"></i><span>${item.label}</span></button>`).join("")}
        </div>
        <div class="design-composer-box">
          <textarea id="claudeDesignPrompt" rows="1" maxlength="120000" placeholder="${canWriteLocally ? "Décris l’écran, le parcours ou le style à créer…" : "Sélectionne d’abord un environnement local…"}" ${composerDisabled ? "disabled" : ""}>${escapeHtml(model.draft)}</textarea>
          ${busy
            ? `<button id="claudeDesignStop" type="button" class="design-send-button stop" title="Arrêter Claude" aria-label="Arrêter Claude"><i data-lucide="square"></i></button>`
            : `<button id="claudeDesignSend" type="submit" class="design-send-button" title="${canWriteLocally ? "Envoyer à Claude et sauvegarder dans le projet" : "Sélectionne un environnement local"}" aria-label="${canWriteLocally ? "Envoyer à Claude et sauvegarder dans le projet" : "Sélectionne un environnement local"}" ${canWriteLocally ? "" : "disabled"}><i data-lucide="arrow-up"></i></button>`}
        </div>
        <small>${canWriteLocally ? `Sauvegarde locale obligatoire dans <strong>${escapeHtml(model.projectDir)}</strong>` : "Choisis un environnement : aucune génération ne sera lancée sans dossier de sauvegarde local."}</small>
      </form>
    </section>

    <aside class="design-context-card design-canvas-brief">
      <header>
        <span><i data-lucide="${mode.icon}"></i></span>
        <div><small>Canvas actif</small><strong>${mode.label}</strong></div>
      </header>
      <p>${mode.description}</p>
      <div class="design-brief-preview" aria-hidden="true">
        <div class="design-brief-top"><i data-lucide="sparkles"></i><span></span><span></span></div>
        <div class="design-brief-body"><span></span><strong></strong><strong class="short"></strong><div><i></i><i></i><i></i></div></div>
      </div>
      <div class="design-project-path">
        <code>${escapeHtml(model.projectDir ?? "Aucun environnement sélectionné")}</code>
        ${model.projectDir ? `<button id="designCopyProjectPath" type="button" class="icon-button" title="Copier le chemin du projet" aria-label="Copier le chemin du projet"><i data-lucide="copy"></i></button>` : ""}
      </div>
      <div class="design-studio-note">
        <i data-lucide="save"></i>
        <span><strong>Sauvegarde locale obligatoire</strong><small>Chaque livrable généré est écrit dans ce projet sur le PC. Claude doit vérifier les fichiers puis indiquer leurs chemins exacts dans sa réponse.</small></span>
      </div>
      ${model.sessionId ? `<small class="design-session-id" title="${escapeHtml(model.sessionId)}"><i data-lucide="messages-square"></i> Session Design active</small>` : ""}
    </aside>
  </div>`;
};

export const renderDesignPanel = ({
  activeTool,
  projectDir,
  claudeStudio,
  kombaiPanelHtml,
  kombaiRunning,
}: DesignPanelModel): string => `
  <section class="design-panel" data-active-design-tool="${activeTool}">
    <header class="design-panel-head">
      <div class="design-panel-title">
        <span class="design-panel-mark"><i data-lucide="layout-template"></i></span>
        <div>
          <small>Espace créatif</small>
          <h1>Design</h1>
          <p>Conçois avec Claude ou transforme une maquette avec Kombai, sans quitter l’application.</p>
        </div>
      </div>
      <nav class="design-tool-tabs" role="tablist" aria-label="Outils de design">
        <button type="button" id="designClaudeTab" data-design-tool-choice="claude" role="tab" aria-selected="${activeTool === "claude"}" class="${activeTool === "claude" ? "active" : ""}">
          <span class="design-tool-icon claude"><i data-lucide="sparkles"></i></span>
          <span><strong>Claude Design</strong><small>Studio intégré</small></span>
          <b>Local</b>
        </button>
        <button type="button" id="designKombaiTab" data-design-tool-choice="kombai" role="tab" aria-selected="${activeTool === "kombai"}" class="${activeTool === "kombai" ? "active" : ""}">
          <span class="design-tool-icon kombai"><i data-lucide="bot"></i></span>
          <span><strong>Kombai</strong><small>IDE frontend</small></span>
          <b class="${kombaiRunning ? "is-live" : ""}">${kombaiRunning ? "Actif" : "IDE"}</b>
        </button>
      </nav>
    </header>
    <div class="design-tool-stage" role="tabpanel" aria-labelledby="${activeTool === "claude" ? "designClaudeTab" : "designKombaiTab"}">
      ${activeTool === "claude"
        ? renderClaudeDesignWorkspace({ ...claudeStudio, projectDir })
        : `<div class="design-kombai-workspace">${kombaiPanelHtml}</div>`}
    </div>
  </section>
`;
