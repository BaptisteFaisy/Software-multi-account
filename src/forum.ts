import { invoke } from "./platform";
import {
  FORUM_REPLY_MAX_CHARS,
  FORUM_TITLE_MAX_CHARS,
  FORUM_TOPIC_MAX_CHARS,
  sortForumTopics,
  type ForumAuthor,
  type ForumTopic,
  type ForumTopicSummary,
} from "./forum-model";
import "./forum.css";

export {
  FORUM_REPLY_MAX_CHARS,
  FORUM_TITLE_MAX_CHARS,
  FORUM_TOPIC_MAX_CHARS,
  sortForumTopics,
};
export type { ForumAuthor, ForumReply, ForumTopic, ForumTopicSummary } from "./forum-model";

const FORUM_POLL_INTERVAL_MS = 8_000;

export type ForumUiOptions = {
  rerender: () => void;
  setStatus?: (message: string) => void;
};

let forumTopics: ForumTopicSummary[] = [];
let forumTopic: ForumTopic | null = null;
let forumSelectedId: string | null = null;
let forumLoaded = false;
let forumLoading = false;
let forumTopicLoading = false;
let forumSubmitting = false;
let forumError = "";
let forumNewTopicOpen = false;
let forumMobileDetailOpen = false;
let forumTitleDraft = "";
let forumBodyDraft = "";
let forumReplyDraft = "";
let forumRefreshPromise: Promise<void> | null = null;
let forumDetailRequest = 0;
let forumPollTimer: number | null = null;
let forumPollRerender: (() => void) | null = null;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const escapeAttr = escapeHtml;

const forumSnapshot = () => JSON.stringify({
  forumTopics,
  forumTopic,
  forumSelectedId,
  forumLoaded,
  forumError,
});

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const forumDate = (timestamp: number) => {
  const date = new Date(timestamp * 1_000);
  if (!Number.isFinite(date.getTime())) return "Date inconnue";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const forumDateTime = (timestamp: number) => {
  const date = new Date(timestamp * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
};

const forumRelativeTime = (timestamp: number) => {
  const elapsed = Math.max(0, Math.floor(Date.now() / 1_000) - timestamp);
  if (elapsed < 45) return "À l’instant";
  if (elapsed < 3_600) return `Il y a ${Math.floor(elapsed / 60)} min`;
  if (elapsed < 86_400) {
    const hours = Math.floor(elapsed / 3_600);
    return `Il y a ${hours} h`;
  }
  const days = Math.floor(elapsed / 86_400);
  return days === 1 ? "Hier" : `Il y a ${days} j`;
};

const authorInitials = (author: ForumAuthor) => {
  const parts = author.username.trim().split(/[\s._-]+/).filter(Boolean);
  return (parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || "U")
    .slice(0, 2);
};

const safeAvatarUrl = (value: string | null | undefined) => {
  if (!value) return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
};

const renderForumAvatar = (author: ForumAuthor, size: "small" | "large" = "small") => {
  const avatar = safeAvatarUrl(author.avatarUrl);
  return avatar
    ? `<img class="forum-avatar ${size}" src="${escapeAttr(avatar)}" alt="" referrerpolicy="no-referrer" />`
    : `<span class="forum-avatar ${size}" aria-hidden="true">${escapeHtml(authorInitials(author))}</span>`;
};

const renderForumTopicRows = () => {
  if (forumLoading && !forumLoaded) {
    return `<div class="forum-list-loading" aria-label="Chargement des sujets">
      ${Array.from({ length: 5 }, () => '<span class="forum-topic-skeleton"></span>').join("")}
    </div>`;
  }
  if (!forumTopics.length) {
    return `<div class="forum-list-empty">
      <span><i data-lucide="messages-square"></i></span>
      <strong>Aucun sujet pour le moment</strong>
      <p>Lancez la première discussion du forum.</p>
    </div>`;
  }

  return forumTopics.map((topic, index) => {
    const active = topic.id === forumSelectedId && !forumNewTopicOpen;
    const activityAuthor = topic.lastReplyAuthor ?? topic.author;
    return `<button
      type="button"
      class="forum-topic-row${active ? " active" : ""}"
      data-forum-topic-id="${escapeAttr(topic.id)}"
      aria-current="${active ? "true" : "false"}"
    >
      <span class="forum-topic-rank" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
      <span class="forum-topic-copy">
        <strong>${escapeHtml(topic.title)}</strong>
        <span>${escapeHtml(topic.excerpt)}</span>
        <small>
          ${renderForumAvatar(activityAuthor)}
          <b>${escapeHtml(activityAuthor.username)}</b>
          <i aria-hidden="true"></i>
          <time datetime="${escapeAttr(forumDateTime(topic.lastActivityAt))}" title="${escapeAttr(forumDate(topic.lastActivityAt))}">${escapeHtml(forumRelativeTime(topic.lastActivityAt))}</time>
        </small>
      </span>
      <span class="forum-topic-replies" title="${topic.replyCount} réponse${topic.replyCount === 1 ? "" : "s"}">
        <i data-lucide="message-square"></i><b>${topic.replyCount}</b>
      </span>
    </button>`;
  }).join("");
};

const renderForumPost = (
  author: ForumAuthor,
  body: string,
  createdAt: number,
  label: string,
  id?: string,
) => `<article class="forum-post"${id ? ` id="forum-reply-${escapeAttr(id)}"` : ""}>
  <header>
    ${renderForumAvatar(author, "large")}
    <span><strong>${escapeHtml(author.username)}</strong><small>${escapeHtml(label)}</small></span>
    <time datetime="${escapeAttr(forumDateTime(createdAt))}" title="${escapeAttr(forumDate(createdAt))}">${escapeHtml(forumRelativeTime(createdAt))}</time>
  </header>
  <div class="forum-post-body">${escapeHtml(body)}</div>
</article>`;

const renderNewForumTopic = () => `<section class="forum-compose-topic" aria-labelledby="forumComposeTitle">
  <header>
    <button type="button" class="forum-mobile-back" data-forum-back aria-label="Retour aux sujets"><i data-lucide="arrow-left"></i></button>
    <span class="forum-compose-mark"><i data-lucide="pencil"></i></span>
    <div><span>Nouveau sujet</span><h3 id="forumComposeTitle">Ouvrir une discussion</h3></div>
  </header>
  <form id="forumTopicForm">
    <label>
      <span>Titre</span>
      <input id="forumTopicTitle" maxlength="${FORUM_TITLE_MAX_CHARS}" value="${escapeAttr(forumTitleDraft)}" placeholder="De quoi souhaitez-vous parler ?" required autofocus />
      <small><b data-forum-title-count>${[...forumTitleDraft].length}</b>/${FORUM_TITLE_MAX_CHARS}</small>
    </label>
    <label>
      <span>Message</span>
      <textarea id="forumTopicBody" maxlength="${FORUM_TOPIC_MAX_CHARS}" rows="10" placeholder="Décrivez votre idée, votre question ou le contexte utile…" required>${escapeHtml(forumBodyDraft)}</textarea>
      <small><b data-forum-body-count>${[...forumBodyDraft].length}</b>/${FORUM_TOPIC_MAX_CHARS}</small>
    </label>
    <p class="forum-compose-tip"><i data-lucide="arrow-up"></i><span>Chaque réponse fera automatiquement remonter ce sujet en haut du forum.</span></p>
    <footer>
      <button type="button" class="tool-button" id="forumTopicCancel">Annuler</button>
      <button type="submit" class="tool-button primary" ${forumSubmitting ? "disabled" : ""}>
        ${forumSubmitting ? '<i data-lucide="loader-circle" class="is-spinning"></i><span>Publication…</span>' : '<i data-lucide="send"></i><span>Publier le sujet</span>'}
      </button>
    </footer>
  </form>
</section>`;

const renderForumTopicDetail = () => {
  if (forumNewTopicOpen) return renderNewForumTopic();
  if (forumTopicLoading) {
    return `<div class="forum-detail-loading" aria-label="Chargement du sujet">
      <span></span><span></span><span></span>
    </div>`;
  }
  if (!forumTopic) {
    return `<div class="forum-detail-empty">
      <span><i data-lucide="messages-square"></i></span>
      <h3>${forumTopics.length ? "Choisissez un sujet" : "Le forum est prêt"}</h3>
      <p>${forumTopics.length ? "Sélectionnez une discussion dans la liste pour lire les réponses." : "Ouvrez un sujet pour commencer à échanger avec la communauté."}</p>
      <button type="button" class="tool-button primary" data-forum-new-topic><i data-lucide="plus"></i><span>Nouveau sujet</span></button>
    </div>`;
  }

  const topic = forumTopic;
  return `<section class="forum-thread" aria-labelledby="forumThreadTitle">
    <header class="forum-thread-head">
      <button type="button" class="forum-mobile-back" data-forum-back aria-label="Retour aux sujets"><i data-lucide="arrow-left"></i></button>
      <div>
        <span><i data-lucide="message-square"></i> Discussion</span>
        <h3 id="forumThreadTitle" tabindex="-1">${escapeHtml(topic.title)}</h3>
        <p>Ouvert par <strong>${escapeHtml(topic.author.username)}</strong> · ${escapeHtml(forumDate(topic.createdAt))}</p>
      </div>
      <span class="forum-thread-count"><b>${topic.replies.length}</b><small>réponse${topic.replies.length === 1 ? "" : "s"}</small></span>
    </header>
    <div class="forum-thread-feed" id="forumThreadFeed">
      ${renderForumPost(topic.author, topic.body, topic.createdAt, "Auteur du sujet")}
      ${topic.replies.length
        ? `<div class="forum-reply-divider"><span>${topic.replies.length} réponse${topic.replies.length === 1 ? "" : "s"}</span></div>${topic.replies.map((reply, index) => renderForumPost(reply.author, reply.body, reply.createdAt, `Réponse ${index + 1}`, reply.id)).join("")}`
        : `<div class="forum-no-replies"><i data-lucide="message-circle-question"></i><span><strong>Aucune réponse</strong><small>Soyez la première personne à participer.</small></span></div>`}
    </div>
    <form id="forumReplyForm" class="forum-reply-form">
      <label for="forumReplyBody">Votre réponse</label>
      <div>
        <textarea id="forumReplyBody" maxlength="${FORUM_REPLY_MAX_CHARS}" rows="4" placeholder="Partagez votre réponse…" required>${escapeHtml(forumReplyDraft)}</textarea>
        <footer>
          <small><kbd>Ctrl</kbd><span>+</span><kbd>Entrée</kbd> pour envoyer · <b data-forum-reply-count>${[...forumReplyDraft].length}</b>/${FORUM_REPLY_MAX_CHARS}</small>
          <button type="submit" class="tool-button primary" ${forumSubmitting ? "disabled" : ""}>
            ${forumSubmitting ? '<i data-lucide="loader-circle" class="is-spinning"></i><span>Envoi…</span>' : '<i data-lucide="send"></i><span>Répondre</span>'}
          </button>
        </footer>
      </div>
    </form>
  </section>`;
};

export const renderForumPanel = (): string => `
  <section id="forumPanel" class="forum-panel${forumMobileDetailOpen || forumNewTopicOpen ? " is-detail-open" : ""}" aria-labelledby="forumPanelTitle">
    <header class="forum-hero">
      <div class="forum-hero-mark"><i data-lucide="messages-square"></i></div>
      <div>
        <span>Communauté</span>
        <h2 id="forumPanelTitle">Forum</h2>
        <p>Ouvrez un sujet, échangez des idées et retrouvez les discussions actives en premier.</p>
      </div>
      <span class="forum-hero-stat"><b>${forumTopics.length}</b><small>sujet${forumTopics.length === 1 ? "" : "s"}</small></span>
      <button type="button" class="tool-button primary" data-forum-new-topic><i data-lucide="plus"></i><span>Nouveau sujet</span></button>
    </header>
    ${forumError ? `<div class="forum-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(forumError)}</span><button type="button" data-forum-dismiss-error aria-label="Fermer"><i data-lucide="x"></i></button></div>` : ""}
    <div class="forum-layout">
      <aside class="forum-topic-list" aria-label="Sujets du forum">
        <header>
          <span><strong>Sujets récents</strong><small>Triés par dernière activité</small></span>
          <button type="button" id="forumRefresh" aria-label="Actualiser les sujets" title="Actualiser"><i data-lucide="refresh-ccw"></i></button>
        </header>
        <div class="forum-topic-scroll" aria-live="polite">${renderForumTopicRows()}</div>
      </aside>
      <main class="forum-detail">${renderForumTopicDetail()}</main>
    </div>
  </section>`;

const loadSelectedForumTopic = async (id: string, rerender: () => void) => {
  const request = ++forumDetailRequest;
  forumSelectedId = id;
  forumNewTopicOpen = false;
  forumMobileDetailOpen = true;
  forumReplyDraft = "";
  if (forumTopic?.id !== id) forumTopic = null;
  forumTopicLoading = true;
  forumError = "";
  rerender();
  try {
    const topic = await invoke<ForumTopic>("get_forum_topic", { topicId: id });
    if (request !== forumDetailRequest || forumSelectedId !== id) return;
    forumTopic = topic;
  } catch (error) {
    if (request !== forumDetailRequest) return;
    forumError = errorMessage(error);
  } finally {
    if (request === forumDetailRequest) {
      forumTopicLoading = false;
      rerender();
    }
  }
};

export const refreshForum = (
  rerender: () => void,
  options: { silent?: boolean } = {},
): Promise<void> => {
  if (forumRefreshPromise) return forumRefreshPromise;
  const before = forumSnapshot();
  const initialLoading = !forumLoaded && !options.silent;
  if (initialLoading) {
    forumLoading = true;
    rerender();
  }

  const refresh = (async () => {
    try {
      const topics = sortForumTopics(await invoke<ForumTopicSummary[]>("list_forum_topics"));
      forumTopics = topics;
      forumLoaded = true;
      forumError = "";

      if (forumSelectedId && !topics.some((topic) => topic.id === forumSelectedId)) {
        forumSelectedId = null;
        forumTopic = null;
        forumMobileDetailOpen = false;
      }
      if (!forumSelectedId && topics.length) forumSelectedId = topics[0].id;

      const selectedId = forumSelectedId;
      if (selectedId) {
        try {
          const topic = await invoke<ForumTopic>("get_forum_topic", { topicId: selectedId });
          if (forumSelectedId === selectedId) forumTopic = topic;
        } catch (error) {
          if (forumSelectedId === selectedId) forumError = errorMessage(error);
        }
      }
    } catch (error) {
      forumError = errorMessage(error);
      forumLoaded = true;
    } finally {
      forumLoading = false;
      forumRefreshPromise = null;
      if (initialLoading || forumSnapshot() !== before) rerender();
    }
  })();
  forumRefreshPromise = refresh;
  return refresh;
};

export const openForumComposer = (rerender: () => void) => {
  forumNewTopicOpen = true;
  forumMobileDetailOpen = true;
  forumError = "";
  rerender();
  window.requestAnimationFrame(() =>
    document.querySelector<HTMLInputElement>("#forumTopicTitle")?.focus(),
  );
};

const publishForumTopic = async (options: ForumUiOptions, form: HTMLFormElement) => {
  forumTitleDraft = form.querySelector<HTMLInputElement>("#forumTopicTitle")?.value ?? forumTitleDraft;
  forumBodyDraft = form.querySelector<HTMLTextAreaElement>("#forumTopicBody")?.value ?? forumBodyDraft;
  if (!forumTitleDraft.trim() || !forumBodyDraft.trim()) {
    forumError = "Le titre et le message sont obligatoires.";
    options.rerender();
    return;
  }

  forumSubmitting = true;
  forumError = "";
  options.rerender();
  try {
    const topic = await invoke<ForumTopic>("create_forum_topic", {
      title: forumTitleDraft,
      body: forumBodyDraft,
    });
    forumSelectedId = topic.id;
    forumTopic = topic;
    forumNewTopicOpen = false;
    forumMobileDetailOpen = true;
    forumTitleDraft = "";
    forumBodyDraft = "";
    forumReplyDraft = "";
    forumTopics = sortForumTopics(await invoke<ForumTopicSummary[]>("list_forum_topics"));
    options.setStatus?.("Sujet publié — il apparaît en tête du forum");
  } catch (error) {
    forumError = errorMessage(error);
  } finally {
    forumSubmitting = false;
    options.rerender();
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>("#forumThreadTitle")?.focus(),
    );
  }
};

const publishForumReply = async (options: ForumUiOptions, form: HTMLFormElement) => {
  if (!forumSelectedId) return;
  forumReplyDraft = form.querySelector<HTMLTextAreaElement>("#forumReplyBody")?.value ?? forumReplyDraft;
  if (!forumReplyDraft.trim()) {
    forumError = "La réponse ne peut pas être vide.";
    options.rerender();
    return;
  }

  forumSubmitting = true;
  forumError = "";
  options.rerender();
  let publishedReplyId: string | null = null;
  try {
    const topic = await invoke<ForumTopic>("reply_to_forum_topic", {
      topicId: forumSelectedId,
      body: forumReplyDraft,
    });
    forumTopic = topic;
    forumReplyDraft = "";
    publishedReplyId = topic.replies.at(-1)?.id ?? null;
    // Le serveur renvoie deja le sujet actualise, puis cette liste confirme
    // sa remontee en tete pour l'utilisateur qui vient de repondre.
    forumTopics = sortForumTopics(await invoke<ForumTopicSummary[]>("list_forum_topics"));
    options.setStatus?.("Réponse publiée — le sujet est remonté en tête");
  } catch (error) {
    forumError = errorMessage(error);
  } finally {
    forumSubmitting = false;
    options.rerender();
    if (publishedReplyId) {
      const replyId = publishedReplyId;
      window.requestAnimationFrame(() => {
        document.getElementById(`forum-reply-${replyId}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
  }
};

const syncDraftCounter = (selector: string, length: number) => {
  const counter = document.querySelector<HTMLElement>(selector);
  if (counter) counter.textContent = String(length);
};

export const bindForumUi = (options: ForumUiOptions) => {
  document.querySelectorAll<HTMLButtonElement>("[data-forum-new-topic]").forEach((button) => {
    button.addEventListener("click", () => openForumComposer(options.rerender));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-forum-topic-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.forumTopicId;
      if (id) void loadSelectedForumTopic(id, options.rerender);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-forum-back]").forEach((button) => {
    button.addEventListener("click", () => {
      forumMobileDetailOpen = false;
      forumNewTopicOpen = false;
      forumError = "";
      options.rerender();
    });
  });
  document.querySelector<HTMLButtonElement>("#forumTopicCancel")?.addEventListener("click", () => {
    forumNewTopicOpen = false;
    forumMobileDetailOpen = false;
    forumError = "";
    options.rerender();
  });
  document.querySelector<HTMLButtonElement>("#forumRefresh")?.addEventListener("click", () => {
    void refreshForum(options.rerender);
  });
  document.querySelector<HTMLButtonElement>("[data-forum-dismiss-error]")?.addEventListener("click", () => {
    forumError = "";
    options.rerender();
  });

  document.querySelector<HTMLInputElement>("#forumTopicTitle")?.addEventListener("input", (event) => {
    forumTitleDraft = (event.currentTarget as HTMLInputElement).value;
    syncDraftCounter("[data-forum-title-count]", [...forumTitleDraft].length);
  });
  document.querySelector<HTMLTextAreaElement>("#forumTopicBody")?.addEventListener("input", (event) => {
    forumBodyDraft = (event.currentTarget as HTMLTextAreaElement).value;
    syncDraftCounter("[data-forum-body-count]", [...forumBodyDraft].length);
  });
  const replyInput = document.querySelector<HTMLTextAreaElement>("#forumReplyBody");
  replyInput?.addEventListener("input", (event) => {
    forumReplyDraft = (event.currentTarget as HTMLTextAreaElement).value;
    syncDraftCounter("[data-forum-reply-count]", [...forumReplyDraft].length);
  });
  replyInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    document.querySelector<HTMLFormElement>("#forumReplyForm")?.requestSubmit();
  });

  document.querySelector<HTMLFormElement>("#forumTopicForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void publishForumTopic(options, event.currentTarget as HTMLFormElement);
  });
  document.querySelector<HTMLFormElement>("#forumReplyForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void publishForumReply(options, event.currentTarget as HTMLFormElement);
  });
};

export const startForumPolling = (rerender: () => void) => {
  forumPollRerender = rerender;
  if (forumPollTimer !== null) return;
  forumPollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible" && forumPollRerender) {
      void refreshForum(forumPollRerender, { silent: true });
    }
  }, FORUM_POLL_INTERVAL_MS);
};

export const stopForumPolling = () => {
  if (forumPollTimer !== null) window.clearInterval(forumPollTimer);
  forumPollTimer = null;
  forumPollRerender = null;
};
