// Vue conversation (phase 1 : lecture seule) — transcript d'une discussion
// rendu en bulles utilisateur/assistant, facon OpenCode.
//
// Module PUR (donnees -> chaines HTML) : l'etat, les appels backend et le
// binding des listeners restent dans main.ts. Le fil (#chatFeed) est patche de
// maniere ciblee selon le meme pattern que le salon d'agents (#roomFeed), pour
// survivre aux re-render globaux sans perdre le scroll.

import { escapeHtml, renderMarkdown } from "./markdown";

export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  text: string;
  // Secondes unix ; 0 = ligne sans horodatage.
  timestamp: number;
};

export type ChatPanelModel = {
  title: string;
  subtitle: string;
  // Badge fournisseur ("Codex" / "Claude") ; vide = pas de badge.
  providerLabel: string;
  loading: boolean;
  error: string | null;
  truncated: boolean;
  messages: ChatMessage[];
};

// « 14:32 » aujourd'hui, « 08/07 14:32 » sinon : assez pour se reperer dans un
// transcript sans surcharger chaque bulle.
const timeLabel = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const time = date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })} ${time}`;
};

const renderMessage = (message: ChatMessage): string => `
  <article class="chat-msg chat-msg--${message.role}">
    <div class="chat-msg-meta">
      <span class="chat-msg-role">${message.role === "user" ? "Vous" : "Assistant"}</span>
      ${message.timestamp ? `<span class="chat-msg-time">${escapeHtml(timeLabel(message.timestamp))}</span>` : ""}
    </div>
    <div class="chat-msg-body">${renderMarkdown(message.text)}</div>
  </article>`;

export const renderChatFeedInner = (model: ChatPanelModel): string => {
  if (model.loading) {
    return `<div class="chat-empty">Chargement de la conversation…</div>`;
  }
  if (model.error) {
    return `<div class="chat-error">${escapeHtml(model.error)}</div>`;
  }
  if (model.messages.length === 0) {
    return `<div class="chat-empty">Aucun message dans cette discussion</div>`;
  }
  const notice = model.truncated
    ? `<div class="chat-notice">Discussion très longue : seuls les derniers messages sont affichés.</div>`
    : "";
  return notice + model.messages.map(renderMessage).join("");
};

export const renderChatPanel = (model: ChatPanelModel): string => `
  <section class="chat-panel">
    <header class="chat-head">
      <button id="chatBack" class="icon-button wide" title="Retour aux discussions">
        <i data-lucide="arrow-left"></i>
      </button>
      <div class="chat-head-main">
        <strong class="chat-title" title="${escapeHtml(model.title)}">${escapeHtml(model.title)}</strong>
        <span class="chat-sub">${escapeHtml(model.subtitle)}</span>
      </div>
      <div class="chat-head-actions">
        ${model.providerLabel ? `<span class="chat-provider">${escapeHtml(model.providerLabel)}</span>` : ""}
        <button id="chatRefresh" class="icon-button wide" title="Actualiser">
          <i data-lucide="refresh-ccw"></i>
        </button>
        <button id="chatResume" class="tool-button primary" title="Reprendre cette discussion dans un terminal">
          <i data-lucide="play"></i><span>Reprendre</span>
        </button>
      </div>
    </header>
    <div id="chatFeed" class="chat-feed">${renderChatFeedInner(model)}</div>
  </section>`;
