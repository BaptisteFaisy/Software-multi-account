// Vue conversation interactive, facon OpenCode.
//
// Module PUR (donnees -> chaines HTML) : l'etat, les appels backend et le
// binding des listeners restent dans main.ts. Le fil (#chatFeed) est patche de
// maniere ciblee pour conserver le scroll et le brouillon pendant le streaming.

import { escapeHtml, renderMarkdown } from "./markdown";
import {
  formatChatDuration,
  formatChatResetCountdown,
  type RuntimeChatPart,
  type RuntimeChatMessage,
} from "./runtime";

export type ChatRole = "user" | "assistant";
export type ChatMode = "build" | "plan" | "ask";
export type ChatTurnStatus = "running" | "completed" | "failed" | "cancelled" | "idle";

export type ChatMessage = RuntimeChatMessage;
export type ChatPart = RuntimeChatPart;

export type ChatActivity = {
  id: string;
  kind: string;
  label: string;
  detail?: string | null;
  status: string;
};

export type ChatThought = {
  id: string;
  kind: "reasoning" | "commentary" | string;
  text: string;
  status: string;
};

export type ChatAccountOption = {
  id: string;
  label: string;
  providerLabel: string;
  model: string;
};

export type ChatSelectOption = {
  value: string;
  label: string;
};

export type ChatQuotaSuggestion = {
  accountId: string;
  accountLabel: string;
  remainingPercent: number;
  busy: boolean;
};

export type ChatQuotaStatus = {
  state: "loading" | "available" | "low" | "exhausted" | "unavailable" | "disconnected" | "error";
  remainingPercent: number | null;
  resetAt: number | null;
  detail: string;
};

export type ChatQuestionOption = {
  label: string;
  description?: string | null;
};

export type ChatQuestionPrompt = {
  header: string;
  question: string;
  options: ChatQuestionOption[];
  multiple: boolean;
};

export type ChatPendingQuestion = {
  id: number;
  questions: ChatQuestionPrompt[];
  askedAt: number;
};

export type ChatSyncState =
  | "connecting"
  | "live"
  | "reconnecting"
  | "closed"
  | "unsupported"
  | "polling";

export type ChatPanelModel = {
  title: string;
  subtitle: string;
  providerLabel: string;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  syncState: ChatSyncState;
  messages: ChatMessage[];
  activities: ChatActivity[];
  thoughts: ChatThought[];
  parts: ChatPart[];
  turnStatus: ChatTurnStatus;
  turnStartedAt: number | null;
  turnFinishedAt: number | null;
  turnError: string | null;
  waitingForUser: boolean;
  pendingQuestion: ChatPendingQuestion | null;
  quotaStatus: ChatQuotaStatus;
  quotaSuggestion: ChatQuotaSuggestion | null;
  accounts: ChatAccountOption[];
  selectedAccountId: string;
  selectedModel: string;
  modelSuggestions: string[];
  selectedReasoningEffort: string;
  reasoningEffortOptions: ChatSelectOption[];
  supportsReasoningEffort: boolean;
  mode: ChatMode;
  draft: string;
  newConversation: boolean;
  workspaceLabel: string;
  historyOpen: boolean;
};

export type ChatPanelRenderOptions = {
  instanceId?: string;
  paneIndex?: number;
  active?: boolean;
  compact?: boolean;
  fullscreen?: boolean;
};

export const chatSyncLabel = (state: ChatSyncState): string => {
  switch (state) {
    case "live":
      return "En direct";
    case "connecting":
      return "Connexion…";
    case "reconnecting":
      return "Reconnexion…";
    case "polling":
    case "unsupported":
      return "Actualisation auto";
    default:
      return "Local";
  }
};

const timeLabel = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${time}`;
};

const renderMessage = (
  message: ChatMessage,
  providerLabel: string,
  index: number,
  showIdentity: boolean,
  highlightQuestion: boolean,
  instanceId = "",
): string => `
  <article id="${instanceId ? `chat-message-${instanceId}-${index}` : `chat-message-${index}`}" data-chat-message-index="${index}" class="chat-msg chat-msg--${message.role} ${message.deliveryState ? `chat-msg--${message.deliveryState}` : ""} ${highlightQuestion ? "chat-msg--question" : ""}">
    ${showIdentity
      ? `<div class="chat-msg-meta">
          <span class="chat-msg-avatar ${message.role}">${message.role === "user" ? "V" : "S"}</span>
          <span class="chat-msg-role">${message.role === "user" ? "Vous" : escapeHtml(providerLabel || "Assistant")}</span>
          ${highlightQuestion ? `<span class="chat-msg-question-badge">Question</span>` : ""}
          ${message.deliveryState === "pending" ? `<span class="chat-msg-delivery chat-msg-delivery--pending">Synchronisation…</span>` : ""}
          ${message.deliveryState === "failed" ? `<span class="chat-msg-delivery chat-msg-delivery--failed">Non synchronisé</span>` : ""}
          ${message.timestamp ? `<span class="chat-msg-time">${escapeHtml(timeLabel(message.timestamp))}</span>` : ""}
        </div>`
      : ""}
    <div class="chat-msg-body">${renderMarkdown(message.text)}</div>
  </article>`;

const activityIcon = (kind: string): string => {
  switch (kind) {
    case "edit":
      return "save";
    case "search":
      return "search";
    case "plan":
      return "list-checks";
    case "tool":
      return "wrench";
    case "command":
      return "play";
    default:
      return "sparkles";
  }
};

const renderActivities = (activities: ChatActivity[]): string => {
  if (!activities.length) return "";
  return `<div class="chat-activities" aria-label="Activites de l'agent">
    ${activities
      .map(
        (activity) => `
        <div class="chat-activity chat-activity--${escapeHtml(activity.status)}">
          <span class="chat-activity-icon"><i data-lucide="${activityIcon(activity.kind)}"></i></span>
          <span class="chat-activity-copy">
            <strong>${escapeHtml(activity.label)}</strong>
            ${activity.detail ? `<small>${escapeHtml(activity.detail)}</small>` : ""}
          </span>
          <span class="chat-activity-state" aria-hidden="true"></span>
        </div>`,
      )
      .join("")}
  </div>`;
};

const renderThoughtStream = (
  thoughts: ChatThought[],
  turnStatus: ChatTurnStatus,
  pendingQuestion: ChatPendingQuestion | null,
): string => {
  const live = turnStatus === "running" && !pendingQuestion;
  if (!live && !thoughts.length) return "";
  const visibleThoughts = thoughts.length
    ? thoughts
    : [
        {
          id: "thinking-placeholder",
          kind: "reasoning",
          text: "L’agent travaille dans l'environnement et organise la prochaine étape…",
          status: "running",
        },
      ];
  return `<details data-chat-control="thinking" class="chat-thought-stream ${live ? "is-live" : "is-complete"}" ${live ? "open" : ""}>
    <summary>
      <span class="chat-thought-stream-icon"><i data-lucide="brain-circuit"></i></span>
      <span class="chat-thought-stream-title">
        <strong>${live ? "Pensée en direct" : "Réflexion du dernier tour"}</strong>
        <small>${live ? "Résumés et progression de l’agent" : `${visibleThoughts.length} étape(s) conservée(s)`}</small>
      </span>
      <span class="chat-thought-stream-state" aria-hidden="true"></span>
      <i class="chat-thought-stream-chevron" data-lucide="chevron-down"></i>
    </summary>
    <div class="chat-thought-list" aria-live="polite">
      ${visibleThoughts
        .map(
          (thought) => `<article class="chat-thought chat-thought--${escapeHtml(thought.kind)} chat-thought--${escapeHtml(thought.status)}">
            <span class="chat-thought-icon"><i data-lucide="${thought.kind === "commentary" ? "message-square-text" : "sparkles"}"></i></span>
            <div class="chat-thought-copy">
              <small>${thought.kind === "commentary" ? "Progression" : "Résumé de réflexion"}</small>
              <div>${renderMarkdown(thought.text)}</div>
            </div>
            <span class="chat-thought-state" aria-hidden="true"></span>
          </article>`,
        )
        .join("")}
    </div>
  </details>`;
};

const renderOpenCodeCopyAction = (label: string): string => `
  <button type="button" class="chat-part-copy" data-chat-copy title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">
    <i data-lucide="copy"></i>
  </button>`;

const renderOpenCodeUserMessage = (
  message: ChatMessage,
  index: number,
  instanceId: string,
): string => `
  <article id="${instanceId ? `chat-message-${instanceId}-${index}` : `chat-message-${index}`}" data-chat-message-index="${index}" data-component="user-message" class="chat-user-message ${message.deliveryState ? `chat-msg--${message.deliveryState}` : ""}">
    <div class="chat-user-bubble" data-chat-copy-source>
      <div class="chat-msg-body">${renderMarkdown(message.text)}</div>
    </div>
    <div class="chat-message-actions">
      ${message.deliveryState === "pending" ? `<span class="chat-msg-delivery chat-msg-delivery--pending">Synchronisation...</span>` : ""}
      ${message.deliveryState === "failed" ? `<span class="chat-msg-delivery chat-msg-delivery--failed">Non synchronise</span>` : ""}
      ${message.timestamp ? `<time>${escapeHtml(timeLabel(message.timestamp))}</time>` : ""}
      ${renderOpenCodeCopyAction("Copier le message")}
    </div>
  </article>`;

const renderOpenCodeToolOutput = (part: ChatPart): string => {
  const sections = [
    part.detail ? `<section><span>Entree</span><pre>${escapeHtml(part.detail)}</pre></section>` : "",
    part.output ? `<section><span>Sortie</span><pre>${escapeHtml(part.output)}</pre></section>` : "",
  ].filter(Boolean);
  return sections.length ? `<div class="chat-tool-details">${sections.join("")}</div>` : "";
};

const renderOpenCodeToolPart = (part: ChatPart): string => {
  const details = renderOpenCodeToolOutput(part);
  const running = part.status === "running" || part.status === "queued";
  const failed = part.status === "error" || part.status === "failed";
  const trigger = `
    <span class="chat-tool-icon" aria-hidden="true">${running ? `<span class="chat-tool-spinner"></span>` : `<i data-lucide="${failed ? "circle-alert" : activityIcon(part.tool || "tool")}"></i>`}</span>
    <span class="chat-tool-copy"><strong>${escapeHtml(part.title || "Outil")}</strong>${part.subtitle ? `<small>${escapeHtml(part.subtitle)}</small>` : ""}</span>
    ${details ? `<i class="chat-tool-chevron" data-lucide="chevron-down"></i>` : ""}`;
  if (!details) {
    return `<div data-component="tool-part" class="chat-tool-part chat-tool-part--${escapeHtml(part.status)}">${trigger}</div>`;
  }
  return `<details data-component="tool-part" class="chat-tool-part chat-tool-part--${escapeHtml(part.status)}" ${running ? "open" : ""}>
    <summary>${trigger}</summary>
    ${details}
  </details>`;
};

const renderOpenCodeAssistantMeta = (
  providerLabel: string,
  timestamp: number,
  startedAt: number | null,
  finishedAt: number | null,
): string => {
  const duration = startedAt
    ? formatChatDuration(Math.max(0, (finishedAt || Date.now() / 1000) - startedAt))
    : "";
  return `<div class="chat-assistant-meta">
    <span>${escapeHtml(providerLabel || "Assistant")}</span>
    ${timestamp ? `<time>${escapeHtml(timeLabel(timestamp))}</time>` : ""}
    ${duration ? `<span>${escapeHtml(duration)}</span>` : ""}
  </div>`;
};

const renderOpenCodePart = (
  part: ChatPart,
  options: {
    finalText: boolean;
    providerLabel: string;
    timestamp: number;
    startedAt: number | null;
    finishedAt: number | null;
  },
): string => {
  if (part.kind === "tool") return renderOpenCodeToolPart(part);
  if (!part.text?.trim()) return "";
  if (part.kind === "reasoning") {
    return `<div data-component="reasoning-part" class="chat-reasoning-part chat-part--${escapeHtml(part.status)}">
      <div class="chat-reasoning-markdown">${renderMarkdown(part.text)}</div>
    </div>`;
  }
  return `<article data-component="text-part" class="chat-text-part chat-part--${escapeHtml(part.status)}" data-chat-copy-source>
    <div class="chat-assistant-markdown">${renderMarkdown(part.text)}</div>
    ${options.finalText ? `<div class="chat-text-actions">${renderOpenCodeAssistantMeta(options.providerLabel, options.timestamp, options.startedAt, options.finishedAt)}${renderOpenCodeCopyAction("Copier la reponse")}</div>` : ""}
  </article>`;
};

const renderOpenCodeParts = (
  parts: ChatPart[],
  providerLabel: string,
  timestamp = 0,
  startedAt: number | null = null,
  finishedAt: number | null = null,
): string => {
  const visible = parts.filter((part) => part.kind === "tool" || !!part.text?.trim());
  const lastTextIndex = visible.map((part) => part.kind === "text").lastIndexOf(true);
  return `<div data-component="assistant-parts" class="chat-assistant-parts">
    ${visible.map((part, index) => renderOpenCodePart(part, {
      finalText: index === lastTextIndex,
      providerLabel,
      timestamp,
      startedAt,
      finishedAt,
    })).join("")}
  </div>`;
};

const renderOpenCodeThinking = (model: ChatPanelModel): string => {
  if (model.turnStatus !== "running" || model.pendingQuestion || model.parts.length) return "";
  return `<div data-component="thinking-row" class="chat-thinking-row" aria-live="polite">
    <span class="chat-thinking-shimmer">Thinking</span>
  </div>`;
};

type RenderTurn = {
  user: { message: ChatMessage; index: number } | null;
  assistants: Array<{ message: ChatMessage; index: number }>;
};

const groupMessagesIntoTurns = (messages: ChatMessage[]): RenderTurn[] => {
  const turns: RenderTurn[] = [];
  messages.forEach((message, index) => {
    if (message.role === "user") {
      turns.push({ user: { message, index }, assistants: [] });
      return;
    }
    if (!turns.length) turns.push({ user: null, assistants: [] });
    turns[turns.length - 1].assistants.push({ message, index });
  });
  return turns;
};

const openCodeMessageParts = (message: ChatMessage): ChatPart[] =>
  message.parts?.length
    ? message.parts
    : message.text.trim()
      ? [{
          id: `message-${message.timestamp}`,
          kind: "text",
          status: "complete",
          text: message.text,
        }]
      : [];

const renderOpenCodeTurn = (
  turn: RenderTurn,
  turnIndex: number,
  turnCount: number,
  model: ChatPanelModel,
  instanceId: string,
): string => {
  const lastTurn = turnIndex === turnCount - 1;
  const livePartsTakeOver = lastTurn && model.parts.length > 0 && model.turnStatus !== "completed";
  const assistantMessages = livePartsTakeOver ? [] : turn.assistants;
  const assistant = assistantMessages.map(({ message }, assistantIndex) => {
    const lastAssistant = assistantIndex === assistantMessages.length - 1;
    const currentCompletedTurn = lastTurn && model.turnStatus === "completed" && lastAssistant;
    return renderOpenCodeParts(
      openCodeMessageParts(message),
      model.providerLabel,
      message.timestamp,
      currentCompletedTurn ? model.turnStartedAt : null,
      currentCompletedTurn ? model.turnFinishedAt : null,
    );
  }).join("");
  const live = lastTurn && model.parts.length && (livePartsTakeOver || !assistantMessages.length)
    ? renderOpenCodeParts(model.parts, model.providerLabel, 0, model.turnStartedAt, model.turnFinishedAt)
    : "";
  return `<section data-component="session-turn" class="chat-turn ${lastTurn ? "is-latest" : ""}">
    ${turn.user ? renderOpenCodeUserMessage(turn.user.message, turn.user.index, instanceId) : ""}
    ${assistant}
    ${live}
    ${lastTurn ? renderOpenCodeThinking(model) : ""}
  </section>`;
};

const quotaStatusLabel = (quota: ChatQuotaStatus): string => {
  switch (quota.state) {
    case "loading":
      return "Lecture du quota…";
    case "disconnected":
      return "Compte non connecté";
    case "exhausted":
      return "Quota épuisé";
    case "unavailable":
      return "Quota non exposé";
    case "error":
      return "Quota indisponible";
    default:
      return `Quota ${Math.round(quota.remainingPercent ?? 0)} %`;
  }
};

const renderLegacyChatRuntimeStatus = (model: ChatPanelModel): string => {
  const structuredWaiting = !!model.pendingQuestion;
  const waitingForUser = structuredWaiting || (model.waitingForUser && model.turnStatus !== "running");
  const runningActivity = [...model.activities]
    .reverse()
    .find((activity) => activity.status === "running" || activity.status === "queued");
  const latestActivity = model.activities[model.activities.length - 1];
  let state = model.turnStatus;
  let title = "Prêt pour votre message";
  let detail = "L'agent attend vos instructions.";
  let icon = "circle";

  if (waitingForUser) {
    state = "idle";
    title = "Votre réponse est attendue";
    detail = structuredWaiting
      ? "Le tour est en pause et reprendra avec votre réponse."
      : "L'assistant vous a posé une question dans son dernier message.";
    icon = "message-circle-question";
  } else if (model.turnStatus === "running") {
    title = `${model.providerLabel || "L'agent"} travaille`;
    detail = runningActivity?.label || latestActivity?.label || "Analyse et préparation de la réponse";
    icon = "loader-circle";
  } else if (model.turnStatus === "completed") {
    title = "Réponse terminée";
    detail = latestActivity?.label || "Le dernier tour est terminé.";
    icon = "circle-check";
  } else if (model.turnStatus === "failed") {
    title = "La réponse a échoué";
    detail = model.turnError || "Consultez l'erreur affichée dans le fil.";
    icon = "triangle-alert";
  } else if (model.turnStatus === "cancelled") {
    title = "Réponse arrêtée";
    detail = "L'exécution a été interrompue.";
    icon = "square";
  }

  const startedAt = model.turnStartedAt ?? 0;
  const finishedAt = model.turnFinishedAt ?? 0;
  const duration = startedAt
    ? formatChatDuration(Math.max(0, (finishedAt || Date.now() / 1000) - startedAt))
    : "";
  const durationLabel = model.turnStatus === "running" ? "Tour" : "Total";
  const quota = model.quotaStatus;
  const quotaPercent = quota.remainingPercent === null
    ? null
    : Math.max(0, Math.min(100, quota.remainingPercent));
  const quotaReset = quota.resetAt ? formatChatResetCountdown(quota.resetAt) : "";
  const quotaTitle = [quota.detail, quotaReset ? `Réinitialisation ${quotaReset}` : ""]
    .filter(Boolean)
    .join(" · ");

  return `<section data-chat-control="runtime" class="chat-runtime chat-runtime--${waitingForUser ? "waiting" : escapeHtml(state)}" aria-live="polite">
    <span class="chat-runtime-icon" aria-hidden="true"><i data-lucide="${icon}"></i></span>
    <span class="chat-runtime-copy">
      <strong>${escapeHtml(title)}</strong>
      <small>${escapeHtml(detail)}</small>
    </span>
    <span class="chat-runtime-metrics">
      ${startedAt ? `<span class="chat-runtime-elapsed" data-chat-elapsed data-chat-started-at="${startedAt}" ${finishedAt ? `data-chat-finished-at="${finishedAt}"` : ""} title="Temps écoulé depuis le début du tour"><i data-lucide="clock-3"></i><span class="chat-runtime-elapsed-label">${durationLabel}</span><strong data-chat-elapsed-value>${escapeHtml(duration)}</strong></span>` : ""}
      <span class="chat-runtime-quota chat-runtime-quota--${escapeHtml(quota.state)}" title="${escapeHtml(quotaTitle)}">
        <i data-lucide="gauge"></i>
        <span>${escapeHtml(quotaStatusLabel(quota))}</span>
        ${quotaPercent === null ? "" : `<span class="chat-runtime-quota-meter" aria-hidden="true"><span style="width:${quotaPercent}%"></span></span>`}
        ${quota.resetAt ? `<small data-chat-reset data-chat-reset-at="${quota.resetAt}">${escapeHtml(quotaReset)}</small>` : ""}
      </span>
    </span>
    ${waitingForUser ? `<button type="button" class="tool-button primary chat-runtime-reply" data-chat-action="${structuredWaiting ? "focus-question" : "focus-prompt"}"><i data-lucide="reply"></i><span>Répondre</span></button>` : ""}
  </section>`;
};

export const renderChatRuntimeStatus = (model: ChatPanelModel): string => {
  const structuredWaiting = !!model.pendingQuestion;
  const waitingForUser = structuredWaiting || (model.waitingForUser && model.turnStatus !== "running");
  const runningActivity = [...model.activities]
    .reverse()
    .find((activity) => activity.status === "running" || activity.status === "queued");
  const latestPart = model.parts[model.parts.length - 1];
  const startedAt = model.turnStartedAt ?? 0;
  const finishedAt = model.turnFinishedAt ?? 0;
  const duration = startedAt
    ? formatChatDuration(Math.max(0, (finishedAt || Date.now() / 1000) - startedAt))
    : "";
  const quota = model.quotaStatus;
  const quotaPercent = quota.remainingPercent === null
    ? null
    : Math.max(0, Math.min(100, quota.remainingPercent));
  const quotaReset = quota.resetAt ? formatChatResetCountdown(quota.resetAt) : "";
  const quotaTitle = [quota.detail, quotaReset ? `Reinitialisation ${quotaReset}` : ""]
    .filter(Boolean)
    .join(" - ");

  let stateLabel = "Pret";
  if (waitingForUser) stateLabel = "Reponse attendue";
  else if (model.turnStatus === "running") {
    stateLabel = latestPart?.title || runningActivity?.label || "Thinking";
  } else if (model.turnStatus === "failed") stateLabel = "Echec";
  else if (model.turnStatus === "cancelled") stateLabel = "Arrete";
  else if (model.turnStatus === "completed") stateLabel = "Termine";

  return `<div data-chat-control="runtime" class="chat-runtime-inline chat-runtime-inline--${waitingForUser ? "waiting" : escapeHtml(model.turnStatus)}" aria-live="polite">
    <span class="chat-runtime-state" title="${escapeHtml(stateLabel)}">
      <span class="chat-runtime-dot" aria-hidden="true"></span>
      <span>${escapeHtml(stateLabel)}</span>
    </span>
    ${startedAt ? `<span class="chat-runtime-elapsed" data-chat-elapsed data-chat-started-at="${startedAt}" ${finishedAt ? `data-chat-finished-at="${finishedAt}"` : ""} title="Temps ecoule depuis le debut du tour"><i data-lucide="clock-3"></i><strong data-chat-elapsed-value>${escapeHtml(duration)}</strong></span>` : ""}
    <span class="chat-runtime-quota chat-runtime-quota--${escapeHtml(quota.state)}" title="${escapeHtml(quotaTitle)}">
      <i data-lucide="gauge"></i>
      <span>${escapeHtml(quotaStatusLabel(quota))}</span>
      ${quotaPercent === null ? "" : `<span class="chat-runtime-quota-meter" aria-hidden="true"><span style="width:${quotaPercent}%"></span></span>`}
      ${quota.resetAt ? `<small data-chat-reset data-chat-reset-at="${quota.resetAt}">${escapeHtml(quotaReset)}</small>` : ""}
    </span>
    ${waitingForUser ? `<button type="button" class="chat-runtime-reply" data-chat-action="${structuredWaiting ? "focus-question" : "focus-prompt"}"><i data-lucide="reply"></i><span>Repondre</span></button>` : ""}
  </div>`;
};

const renderChatQuestionDock = (model: ChatPanelModel, instanceId: string): string => {
  const pending = model.pendingQuestion;
  if (!pending?.questions.length) return "";
  const inputPrefix = `${instanceId || "main"}-question-${pending.id}`;
  return `<section class="chat-question-dock" data-component="dock-prompt" data-kind="question" data-chat-control="question" data-question-id="${pending.id}" data-question-count="${pending.questions.length}" data-question-active="0" aria-live="assertive">
    <div class="chat-question-shell" data-slot="question-body">
    <header class="chat-question-head" data-slot="question-header">
      <span class="chat-question-icon"><i data-lucide="message-circle-question"></i></span>
      <span><strong>Décision requise</strong><small>Le même tour reprendra après votre réponse.</small></span>
      <span class="chat-question-progress" data-question-progress>1 / ${pending.questions.length}</span>
    </header>
    <div class="chat-question-pages" data-slot="question-content">
      ${pending.questions.map((question, questionIndex) => {
        const inputType = question.multiple ? "checkbox" : "radio";
        const inputName = `${inputPrefix}-${questionIndex}`;
        return `<fieldset class="chat-question-page ${questionIndex === 0 ? "is-active" : ""}" data-question-index="${questionIndex}" data-question-multiple="${question.multiple ? "true" : "false"}" ${questionIndex === 0 ? "" : "hidden"}>
          <legend>${escapeHtml(question.header)}</legend>
          <p>${escapeHtml(question.question)}</p>
          <div class="chat-question-options">
            ${question.options.map((option) => `<label class="chat-question-option">
              <input type="${inputType}" name="${escapeHtml(inputName)}" value="${escapeHtml(option.label)}" />
              <span><strong>${escapeHtml(option.label)}</strong>${option.description ? `<small>${escapeHtml(option.description)}</small>` : ""}</span>
            </label>`).join("")}
            <label class="chat-question-custom">
              <span>Autre réponse</span>
              <input type="text" data-question-custom maxlength="2000" placeholder="Écrivez votre propre réponse…" autocomplete="off" />
            </label>
          </div>
        </fieldset>`;
      }).join("")}
    </div>
    </div>
    <footer class="chat-question-actions" data-slot="question-footer">
      <span class="chat-question-error" data-question-error role="alert"></span>
      <button type="button" class="tool-button" data-chat-action="question-prev" disabled><i data-lucide="chevron-left"></i><span>Précédente</span></button>
      <button type="button" class="tool-button" data-chat-action="question-next" ${pending.questions.length === 1 ? "hidden" : ""}><span>Suivante</span><i data-lucide="chevron-right"></i></button>
      <button type="button" class="tool-button primary" data-chat-action="answer-question" ${pending.questions.length === 1 ? "" : "hidden"}><i data-lucide="send"></i><span>Envoyer la réponse</span></button>
    </footer>
  </section>`;
};

const renderWelcome = (): string => `
  <div class="chat-welcome">
    <span class="chat-welcome-mark"><i data-lucide="sparkles"></i></span>
    <h1>Que voulez-vous construire ?</h1>
    <p>Decrivez le resultat attendu. L'agent explore l'environnement, modifie les fichiers et vous repond ici.</p>
    <div class="chat-starters">
      <button type="button" data-chat-starter="Analyse ce projet et explique-moi clairement son architecture.">
        <strong>Comprendre le projet</strong><span>Architecture, flux et points d'entree</span>
      </button>
      <button type="button" data-chat-starter="Aide-moi a diagnostiquer ce probleme : ">
        <strong>Trouver un bug</strong><span>Reproduction, cause et correction</span>
      </button>
      <button type="button" data-chat-starter="Ameliore l'interface de cette application, notamment son accessibilite et son responsive.">
        <strong>Ameliorer l'interface</strong><span>Accessibilite, responsive et finition</span>
      </button>
    </div>
  </div>`;

const renderLegacyChatFeedInner = (model: ChatPanelModel, instanceId = ""): string => {
  if (model.loading && model.messages.length === 0) {
    return `<div class="chat-empty"><span class="chat-loader"></span>Chargement de la conversation…</div>`;
  }
  if (model.error && model.messages.length === 0) {
    return `<div class="chat-error">${escapeHtml(model.error)}</div>`;
  }

  const notice = model.truncated
    ? `<div class="chat-notice">Discussion tres longue : seuls les derniers messages sont affiches.</div>`
    : "";
  const messages = model.messages.length
    ? model.messages
        .map((message, index) => {
          const previousMessage = model.messages[index - 1];
          const showIdentity = message.role !== "assistant" || previousMessage?.role !== "assistant";
          const highlightQuestion =
            model.waitingForUser &&
            index === model.messages.length - 1 &&
            message.role === "assistant";
          return renderMessage(message, model.providerLabel, index, showIdentity, highlightQuestion, instanceId);
        })
        .join("")
    : renderWelcome();
  const thinking = renderThoughtStream(model.thoughts, model.turnStatus, model.pendingQuestion);
  const turnError = model.turnError
    ? `<div class="chat-error chat-turn-error">${escapeHtml(model.turnError)}</div>`
    : "";
  const quotaSuggestion = model.quotaSuggestion
    ? `<div class="chat-quota-suggestion">
        <span>
          <strong>${escapeHtml(model.quotaSuggestion.accountLabel)}</strong> est le compte compatible
          qui possède le plus de quota (${Math.round(model.quotaSuggestion.remainingPercent)} % disponible).
        </span>
        <button
          type="button"
          class="tool-button primary"
          data-chat-action="quota-switch"
          data-quota-account="${escapeHtml(model.quotaSuggestion.accountId)}"
          ${model.quotaSuggestion.busy ? "disabled" : ""}
        >
          ${model.quotaSuggestion.busy ? "Déplacement…" : "Déplacer + continuer"}
        </button>
      </div>`
    : "";
  return notice + messages + thinking + renderActivities(model.activities) + turnError + quotaSuggestion;
};

export const renderChatFeedInner = (model: ChatPanelModel, instanceId = ""): string => {
  if (model.loading && model.messages.length === 0) {
    return `<div class="chat-empty"><span class="chat-loader"></span>Chargement de la conversation...</div>`;
  }
  if (model.error && model.messages.length === 0) {
    return `<div class="chat-error">${escapeHtml(model.error)}</div>`;
  }

  const notice = model.truncated
    ? `<div class="chat-notice">Discussion tres longue : seuls les derniers messages sont affiches.</div>`
    : "";
  const turns = groupMessagesIntoTurns(model.messages);
  if (!turns.length && model.parts.length) {
    turns.push({ user: null, assistants: [] });
  }
  const conversation = turns.length
    ? `<div data-component="message-timeline" class="chat-message-timeline">
        ${turns.map((turn, index) => renderOpenCodeTurn(turn, index, turns.length, model, instanceId)).join("")}
      </div>`
    : renderWelcome();
  const turnError = model.turnError
    ? `<div class="chat-error chat-turn-error"><i data-lucide="circle-alert"></i><span>${escapeHtml(model.turnError)}</span></div>`
    : "";
  const quotaSuggestion = model.quotaSuggestion
    ? `<div class="chat-quota-suggestion">
        <span>
          <strong>${escapeHtml(model.quotaSuggestion.accountLabel)}</strong> possede le plus de quota
          (${Math.round(model.quotaSuggestion.remainingPercent)} % disponible).
        </span>
        <button type="button" class="tool-button primary" data-chat-action="quota-switch" data-quota-account="${escapeHtml(model.quotaSuggestion.accountId)}" ${model.quotaSuggestion.busy ? "disabled" : ""}>
          ${model.quotaSuggestion.busy ? "Deplacement..." : "Deplacer + continuer"}
        </button>
      </div>`
    : "";
  return notice + conversation + turnError + quotaSuggestion;
};

const modelSuggestions = (model: ChatPanelModel): string =>
  Array.from(new Set([model.selectedModel, ...model.modelSuggestions].filter(Boolean)))
    .map((value) => `<option value="${escapeHtml(value)}"></option>`)
    .join("");

const reasoningEffortOptions = (model: ChatPanelModel): string => {
  if (!model.supportsReasoningEffort) {
    return `<option value="">Non applicable</option>`;
  }
  return model.reasoningEffortOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}" ${option.value === model.selectedReasoningEffort ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
};

const renderChatHistory = (model: ChatPanelModel, instanceId = ""): string => {
  if (!model.historyOpen) return "";
  const userMessages = model.messages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === "user");
  const content = userMessages.length
    ? `<ol class="chat-history-list">
        ${userMessages
          .map(
            ({ message, index }, position) => `
              <li>
                <button type="button" data-chat-history-message="${index}" title="Revenir a ce message dans le chat">
                  <span class="chat-history-index">${position + 1}</span>
                  <span class="chat-history-copy">${escapeHtml(message.text)}</span>
                  ${message.timestamp ? `<time>${escapeHtml(timeLabel(message.timestamp))}</time>` : ""}
                </button>
              </li>`,
          )
          .join("")}
      </ol>`
    : `<div class="chat-history-empty">Vous n'avez encore envoye aucun message dans ce chat.</div>`;
  return `
    <aside id="${instanceId ? `chatHistory-${instanceId}` : "chatHistory"}" data-chat-control="history" class="chat-history" aria-label="Historique de ce chat">
      <header>
        <div>
          <strong>Historique du chat</strong>
          <span>${userMessages.length} message(s) envoye(s)</span>
        </div>
        <button id="${instanceId ? `chatHistoryClose-${instanceId}` : "chatHistoryClose"}" data-chat-action="history-close" type="button" class="icon-button" title="Fermer l'historique" aria-label="Fermer l'historique">
          <i data-lucide="x"></i>
        </button>
      </header>
      ${model.truncated ? `<div class="chat-history-notice">Le debut de cette tres longue conversation n'est plus charge.</div>` : ""}
      ${content}
    </aside>`;
};

export const renderChatPanel = (
  model: ChatPanelModel,
  options: ChatPanelRenderOptions = {},
): string => {
  const running = model.turnStatus === "running";
  const userMessageCount = model.messages.filter((message) => message.role === "user").length;
  const instanceId = (options.instanceId ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
  const id = (base: string) => instanceId ? `${base}-${instanceId}` : base;
  const compact = options.compact === true;
  const fullscreen = options.fullscreen === true;
  const expertClass = instanceId
    ? `chat-panel--expert ${options.active ? "active" : ""} ${compact ? "chat-panel--compact" : ""} ${fullscreen ? "is-fullscreen" : ""}`
    : "";
  return `
  <section id="${id("chatPanel")}" data-chat-panel="${instanceId}" class="chat-panel ${expertClass} ${model.newConversation ? "chat-panel--new" : ""} ${model.historyOpen ? "chat-panel--history" : ""}">
    <header class="chat-head">
      ${compact ? "" : `<button id="${id("chatBack")}" data-chat-action="back" class="icon-button wide" title="Toutes les conversations" aria-label="Toutes les conversations">
        <i data-lucide="arrow-left"></i>
      </button>`}
      ${!compact && options.paneIndex ? `<span class="expert-chat-pane-index" title="Chat ${options.paneIndex}">${options.paneIndex}</span>` : ""}
      <div class="chat-head-main">
        <strong class="chat-title" title="${escapeHtml(model.title)}">${escapeHtml(model.title)}</strong>
        ${compact ? "" : `<span id="${id("chatSubtitle")}" data-chat-control="subtitle" class="chat-sub">${escapeHtml(model.subtitle)}</span>`}
      </div>
      <div class="chat-head-actions">
        ${compact ? "" : `<span id="${id("chatSync")}" data-chat-control="sync" class="chat-sync chat-sync--${model.syncState}" aria-live="polite">
          <span class="chat-sync-dot" aria-hidden="true"></span>
          <span data-chat-sync-label>${escapeHtml(chatSyncLabel(model.syncState))}</span>
        </span>
        <span class="chat-provider">${escapeHtml(model.providerLabel)}</span>
        <button id="${id("chatResume")}" type="button" data-open-discussions class="tool-button chat-resume-button" title="Choisir une discussion a reprendre" aria-label="Reprendre une discussion">
          <i data-lucide="messages-square"></i><span>Reprendre une discussion</span>
        </button>
        <button id="${id("chatHistoryToggle")}" data-chat-action="history-toggle" class="tool-button chat-history-button ${model.historyOpen ? "primary" : ""}" title="Afficher les messages envoyes dans ce chat" aria-label="Historique de ce chat" aria-expanded="${model.historyOpen}">
          <i data-lucide="history"></i><span>Historique</span><small>${userMessageCount}</small>
        </button>
         <button id="${id("chatRefresh")}" data-chat-action="refresh" class="icon-button wide" title="Actualiser" aria-label="Actualiser">
           <i data-lucide="refresh-ccw"></i>
         </button>`}
        ${compact && fullscreen ? `<button id="${id("chatHistoryToggle")}" data-chat-action="history-toggle" class="tool-button chat-history-button ${model.historyOpen ? "primary" : ""}" title="Afficher les messages envoyes dans ce chat" aria-label="Historique de ce chat" aria-expanded="${model.historyOpen}">
          <i data-lucide="history"></i><span>Historique</span><small>${userMessageCount}</small>
        </button>` : ""}
        ${compact ? "" : `<button id="${id("chatNew")}" data-chat-action="new" class="tool-button primary chat-new-button" title="Nouvelle conversation">
          <i data-lucide="plus"></i><span>Nouveau chat</span>
        </button>`}
      </div>
    </header>
    <div class="chat-conversation-body">
      <div id="${id("chatFeed")}" data-chat-control="feed" class="chat-feed">${renderChatFeedInner(model, instanceId)}</div>
      ${renderChatHistory(model, instanceId)}
    </div>
    ${renderChatQuestionDock(model, instanceId)}
    <form id="${id("chatComposer")}" data-chat-control="composer" class="chat-composer ${running ? "is-running" : ""} ${model.pendingQuestion ? "is-question-pending" : ""}">
      <div class="chat-composer-box">
        <textarea id="${id("chatPrompt")}" data-chat-control="prompt" rows="1" placeholder="Demandez a ${escapeHtml(model.providerLabel || "l'agent")} de construire quelque chose…" ${running ? "disabled" : ""}>${escapeHtml(model.draft)}</textarea>
        <div class="chat-composer-toolbar">
          <div class="chat-composer-context">
            <label class="chat-mode-select" title="Mode de travail">
              <i data-lucide="sparkles"></i>
              <select id="${id("chatMode")}" data-chat-control="mode" ${running ? "disabled" : ""} aria-label="Mode de travail">
                <option value="build" ${model.mode === "build" ? "selected" : ""}>Construire</option>
                <option value="plan" ${model.mode === "plan" ? "selected" : ""}>Planifier</option>
                <option value="ask" ${model.mode === "ask" ? "selected" : ""}>Question</option>
              </select>
            </label>
            <label class="chat-model-select" title="Modele utilise pour les prochains messages">
              <i data-lucide="cpu"></i>
              <input id="${id("chatModel")}" data-chat-control="model" list="${id("chatModelSuggestions")}" value="${escapeHtml(model.selectedModel)}" ${running || !model.selectedAccountId ? "disabled" : ""} aria-label="Modele" autocomplete="off" spellcheck="false" maxlength="160" />
              <datalist id="${id("chatModelSuggestions")}">${modelSuggestions(model)}</datalist>
            </label>
            <label class="chat-effort-select" title="${model.supportsReasoningEffort ? "Intensite de raisonnement Codex" : "Ce fournisseur ne gere pas l'intensite de raisonnement"}">
              <i data-lucide="gauge"></i>
              <select id="${id("chatReasoningEffort")}" data-chat-control="reasoning-effort" ${running || !model.selectedAccountId || !model.supportsReasoningEffort ? "disabled" : ""} aria-label="Intensite de raisonnement">
                ${reasoningEffortOptions(model)}
              </select>
            </label>
            <span class="chat-workspace-chip" title="${escapeHtml(model.workspaceLabel)}"><i data-lucide="folder-open"></i>${escapeHtml(model.workspaceLabel)}</span>
          </div>
          ${renderChatRuntimeStatus(model)}
          ${running
            ? `<button id="${id("chatStop")}" data-chat-action="stop" type="button" class="chat-send chat-stop" title="Arreter la reponse" aria-label="Arreter la reponse"><i data-lucide="square"></i></button>`
            : `<button id="${id("chatSend")}" data-chat-action="send" type="submit" class="chat-send" title="Envoyer" aria-label="Envoyer" ${model.accounts.length ? "" : "disabled"}><i data-lucide="arrow-up"></i></button>`}
        </div>
      </div>
      <small>Entree pour envoyer · Maj + Entree pour une nouvelle ligne</small>
    </form>
  </section>`;
};
