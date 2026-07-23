// Integration Microsoft 365 : liaison du compte Entra ID et confirmation
// humaine des actions preparees par le modele (Outlook et Agenda).
//
// Etat au niveau module, comme vps.ts : main.ts insere les chaines produites
// ici dans son propre rendu puis rappelle bindMicrosoftConnectionUi apres
// chaque passe pour reattacher les ecouteurs.

import { isRemoteMode, remoteBaseUrl } from "./platform";

export type MicrosoftConnectionView = {
  configured: boolean;
  connected: boolean;
  /** Liaison existante mais revoquee cote Microsoft : il faut relier, pas connecter. */
  needsRelink: boolean;
  email: string | null;
  displayName: string | null;
  scopes: string[];
  linkedAt: number | null;
  tenant: string | null;
  redirectUri: string | null;
  loginUrl: string | null;
};

export type MicrosoftEmailDraft = {
  kind: "sendEmail";
  to: string[];
  cc: string[];
  subject: string;
  body: string;
};

export type MicrosoftEventDraft = {
  kind: "createEvent";
  subject: string;
  start: string;
  end: string;
  attendees: string[];
  location: string | null;
  body: string | null;
  onlineMeeting: boolean;
};

export type MicrosoftEventUpdateDraft = {
  kind: "updateEvent";
  eventId: string;
  subject: string | null;
  start: string | null;
  end: string | null;
  location: string | null;
  body: string | null;
  currentSubject: string | null;
};

export type MicrosoftDraft =
  | MicrosoftEmailDraft
  | MicrosoftEventDraft
  | MicrosoftEventUpdateDraft;

export type MicrosoftPendingAction = {
  id: string;
  kind: MicrosoftDraft["kind"];
  summary: string;
  sourceChatKey: string | null;
  createdAt: number;
  expiresAt: number;
  draft: MicrosoftDraft;
};

type Feedback = { tone: "success" | "error"; message: string };

class MicrosoftApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// Le noeud local (Tauri) n'a pas de session nominative : la liaison n'y existe
// pas et interroger /api/microsoft y produirait seulement des erreurs reseau.
const OFFLINE_CONNECTION: MicrosoftConnectionView = {
  configured: false,
  connected: false,
  needsRelink: false,
  email: null,
  displayName: null,
  scopes: [],
  linkedAt: null,
  tenant: null,
  redirectUri: null,
  loginUrl: null,
};

let connection: MicrosoftConnectionView | null = null;
let connectionLoaded = false;
let connectionInFlight: Promise<void> | null = null;
let connectionFeedback: Feedback | null = null;
let unlinkPending = false;
let unlinking = false;
let pendingActions: MicrosoftPendingAction[] = [];
let pendingActionsLoaded = false;
let pendingActionsInFlight: Promise<void> | null = null;
let busyActionId: string | null = null;
let actionFeedback: Feedback | null = null;
let oauthResultPending = false;
let rerender: () => void = () => {};

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const errorMessage = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/i, "");

const microsoftApi = async <T>(
  path: string,
  options: { method?: string; confirm?: boolean } = {},
): Promise<T> => {
  const response = await fetch(`${remoteBaseUrl()}/api/microsoft${path}`, {
    method: options.method ?? "GET",
    credentials: "include",
    // Les mutations exigent cet en-tete applicatif : sans lui le serveur refuse
    // l'envoi, precisement pour qu'un formulaire tiers ne puisse pas le declencher.
    headers: options.confirm ? { "X-CST-Confirm": "1" } : {},
  });
  const text = await response.text();
  let value: any = null;
  if (text) {
    try {
      value = JSON.parse(text);
    } catch {
      value = null;
    }
  }
  if (!response.ok) {
    throw new MicrosoftApiError(
      value?.error?.message || response.statusText || "Erreur Microsoft 365",
      response.status,
    );
  }
  return value as T;
};

/**
 * Graph renvoie une heure UTC au format `AAAA-MM-JJTHH:MM:SS`, sans suffixe.
 * Sans le « Z » ajoute ici, new Date() lirait la chaine en heure locale et
 * afficherait le rendez-vous avec deux heures d'ecart en France, sur la carte
 * censee justement empecher une erreur d'horaire.
 */
export const microsoftGraphInstant = (value: string | null | undefined): Date | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const normalized = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatMicrosoftInstant = (value: string | null | undefined): string => {
  const date = microsoftGraphInstant(value);
  if (!date) return "Date inconnue";
  return date.toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
};

export const microsoftEventDuration = (
  start: string | null | undefined,
  end: string | null | undefined,
): string | null => {
  const from = microsoftGraphInstant(start);
  const to = microsoftGraphInstant(end);
  if (!from || !to) return null;
  const minutes = Math.round((to.getTime() - from.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} h`;
  return `${hours} h ${String(rest).padStart(2, "0")}`;
};

/**
 * Le resume est calcule cote serveur et cite l'instant brut du brouillon, en
 * UTC et sans suffixe : « Nouvel evenement « Point equipe » le
 * 2026-07-25T12:00:00 ». Affiche tel quel, l'en-tete de la carte annoncerait
 * 12:00 juste au-dessus de la ligne « Debut » qui affiche 14:00 en France.
 * Chaque horodatage du resume passe donc par le meme convertisseur que le
 * reste de la carte, pour qu'un seul et meme instant y soit lisible.
 */
const GRAPH_INSTANT_PATTERN =
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

export const localizeMicrosoftSummary = (summary: string | null | undefined): string =>
  String(summary ?? "").replace(GRAPH_INSTANT_PATTERN, (match) => {
    const formatted = formatMicrosoftInstant(match);
    return formatted === "Date inconnue" ? match : formatted;
  });

const formatUnixSeconds = (unix: number | null): string => {
  if (unix === null || !Number.isFinite(unix)) return "Date inconnue";
  return new Date(unix * 1_000).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  });
};

const SCOPE_LABELS: Record<string, string> = {
  "offline_access": "Rester connecté",
  "openid": "Identité",
  "profile": "Profil",
  "email": "Adresse e-mail",
  "user.read": "Lire le profil",
  "mail.send": "Envoyer des e-mails",
  "mail.read": "Lire les e-mails",
  "calendars.readwrite": "Lire et modifier l’agenda",
  "calendars.read": "Lire l’agenda",
};

const scopeLabel = (scope: string): string => {
  const bare = scope.split("/").pop() ?? scope;
  return SCOPE_LABELS[bare.toLowerCase()] ?? bare;
};

export const microsoftMark = (): string => `
  <svg class="microsoft-mark" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#F25022" d="M3 3h8.4v8.4H3z"/>
    <path fill="#7FBA00" d="M12.6 3H21v8.4h-8.4z"/>
    <path fill="#00A4EF" d="M3 12.6h8.4V21H3z"/>
    <path fill="#FFB900" d="M12.6 12.6H21V21h-8.4z"/>
  </svg>`;

// ---------------------------------------------------------------------------
// Retour de liaison OAuth
// ---------------------------------------------------------------------------

// Le serveur ne propage volontairement pas les messages bruts de Microsoft :
// ils citeraient le tenant et l'identifiant client dans l'URL. Ces cinq codes
// sont donc traduits ici.
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Liaison annulée.",
  invalid: "Réponse Microsoft incomplète, relancez la liaison.",
  conflict: "Ce compte Microsoft est déjà lié à un autre utilisateur de l’application.",
  session: "Votre session a expiré pendant la liaison, reconnectez-vous puis réessayez.",
  failed: "La liaison Microsoft a échoué. Vérifiez la configuration du serveur puis réessayez.",
};

export const consumeMicrosoftOAuthResult = (): void => {
  const url = new URL(window.location.href);
  const failure = url.searchParams.get("microsoft_error");
  const linked = url.searchParams.get("microsoft") === "linked";
  if (failure) {
    connectionFeedback = {
      tone: "error",
      message: OAUTH_ERROR_MESSAGES[failure] ?? OAUTH_ERROR_MESSAGES.failed,
    };
  } else if (linked) {
    connectionFeedback = { tone: "success", message: "Compte Microsoft 365 lié." };
  }
  if (url.searchParams.has("microsoft") || url.searchParams.has("microsoft_error")) {
    url.searchParams.delete("microsoft");
    url.searchParams.delete("microsoft_error");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    // La vue en memoire date d'avant la liaison : elle doit etre relue.
    connectionLoaded = false;
    oauthResultPending = true;
  }
};

/**
 * Le fournisseur renvoie sur « / », donc sur la conversation. Sans cette
 * bascule, le message de succes ou d'echec resterait sur une carte de reglages
 * que l'utilisateur ne regarde plus. Se consomme une seule fois.
 */
export const takeMicrosoftOAuthResultRedirect = (): boolean => {
  const pending = oauthResultPending;
  oauthResultPending = false;
  return pending;
};

// ---------------------------------------------------------------------------
// Liaison du compte
// ---------------------------------------------------------------------------

export const refreshMicrosoftConnection = (force = false): Promise<void> => {
  if (connectionInFlight) return connectionInFlight;
  if (connectionLoaded && !force) return Promise.resolve();
  if (!isRemoteMode()) {
    connection = OFFLINE_CONNECTION;
    connectionLoaded = true;
    return Promise.resolve();
  }
  const pending = (async () => {
    try {
      connection = await microsoftApi<MicrosoftConnectionView>("/connection");
    } catch (error) {
      // Un noeud plus ancien ne connait pas la route : ce n'est pas une panne,
      // c'est une integration absente de ce serveur.
      connection = OFFLINE_CONNECTION;
      if (!(error instanceof MicrosoftApiError && error.status === 404)) {
        connectionFeedback = { tone: "error", message: errorMessage(error) };
      }
    } finally {
      connectionLoaded = true;
      connectionInFlight = null;
      rerender();
    }
  })();
  connectionInFlight = pending;
  return pending;
};

export const microsoftLinkedAccountLabel = (): string | null => {
  if (!connection?.connected && !connection?.needsRelink) return null;
  const label = connection.email || connection.displayName || "Microsoft 365";
  return connection.needsRelink ? `${label} · à relier` : label;
};

const renderScopes = (scopes: string[]): string => {
  if (!scopes.length) return "";
  return `<div class="microsoft-scopes">
    <span>Permissions accordées</span>
    <div>${scopes
      .map((scope) => `<em title="${escapeHtml(scope)}">${escapeHtml(scopeLabel(scope))}</em>`)
      .join("")}</div>
  </div>`;
};

const renderRedirectUri = (redirectUri: string): string => `
  <label class="microsoft-redirect">
    <span>URI de redirection à déclarer dans Entra</span>
    <code>${escapeHtml(redirectUri)}</code>
    <button type="button" id="microsoftCopyRedirect" aria-label="Copier l’URI de redirection"><i data-lucide="copy"></i></button>
  </label>`;

export const renderMicrosoftConnectionSettings = (): string => {
  const view = connection;
  const configured = view?.configured === true;
  const connected = view?.connected === true;
  const needsRelink = view?.needsRelink === true;
  const hasLink = connected || needsRelink;
  const stateLabel = !connectionLoaded
    ? "Vérification…"
    : !configured
      ? "Non configuré"
      : needsRelink
        ? "À relier"
        : connected
          ? "Connecté"
          : "À connecter";
  const loading = !connectionLoaded
    ? `<div class="microsoft-loading"><i data-lucide="loader-circle"></i><span>Lecture de la liaison Microsoft 365…</span></div>`
    : "";

  const unavailable = connectionLoaded && !configured
    ? `<div class="microsoft-unavailable">
        <span><i data-lucide="info"></i></span>
        <div>
          <strong>Microsoft 365 n’est pas configuré sur ce serveur.</strong>
          <p>Renseignez <code>CST_MICROSOFT_CLIENT_ID</code> et <code>CST_MICROSOFT_CLIENT_SECRET</code> côté serveur, puis déclarez l’application dans Entra ID. La procédure complète est décrite dans <code>docs/microsoft-365.md</code>.</p>
        </div>
      </div>`
    : "";

  const summary = hasLink
    ? `<div class="microsoft-connection-summary ${needsRelink ? "is-stale" : ""}">
        <span class="microsoft-connection-state"><i data-lucide="${needsRelink ? "triangle-alert" : "badge-check"}"></i></span>
        <span>
          <small>${needsRelink ? "Autorisation expirée" : "Compte lié"}</small>
          <strong>${escapeHtml(view?.displayName || view?.email || "Compte Microsoft")}</strong>
          <em>${escapeHtml(view?.email || "Adresse indisponible")}</em>
        </span>
        <dl>
          <div><dt>Liaison</dt><dd>${escapeHtml(formatUnixSeconds(view?.linkedAt ?? null))}</dd></div>
          ${view?.tenant ? `<div><dt>Tenant</dt><dd>${escapeHtml(view.tenant)}</dd></div>` : ""}
        </dl>
      </div>
      ${needsRelink
        ? `<p class="microsoft-relink-note"><i data-lucide="info"></i><span>Microsoft a révoqué l’autorisation (mot de passe changé, consentement retiré ou 90 jours sans usage). Les jetons ont été effacés : reliez ce compte pour réactiver Outlook et l’Agenda.</span></p>`
        : ""}
      ${renderScopes(view?.scopes ?? [])}
      <div class="microsoft-connection-actions">
        ${unlinkPending
          ? `<button type="button" id="microsoftUnlinkConfirm" class="danger${unlinking ? " is-busy" : ""}" ${unlinking ? "disabled" : ""}><i data-lucide="${unlinking ? "loader-circle" : "unlink"}"></i><span>${unlinking ? "Déliaison…" : "Confirmer la déliaison"}</span></button>
             <button type="button" id="microsoftUnlinkCancel" ${unlinking ? "disabled" : ""}>Annuler</button>`
          : `<button type="button" id="microsoftUnlink" class="danger"><i data-lucide="unlink"></i><span>Délier</span></button>`}
      </div>`
    : "";

  const connect = configured && !connected
    ? `<div class="microsoft-connect">
        <a class="microsoft-connect-button" href="${escapeHtml(view?.loginUrl || `${remoteBaseUrl()}/api/microsoft/start`)}">
          ${microsoftMark()}<span>${needsRelink ? "Relier de nouveau Microsoft 365" : "Connecter Microsoft 365"}</span>
        </a>
        <p>Vous êtes redirigé vers la page officielle Microsoft. L’application ne voit ni votre mot de passe ni votre second facteur.</p>
      </div>`
    : "";

  const feedback = connectionFeedback
    ? `<p class="microsoft-feedback is-${connectionFeedback.tone}" role="status">${escapeHtml(connectionFeedback.message)}</p>`
    : "";

  return `<section id="microsoftConnectionSettings" class="microsoft-settings" aria-labelledby="microsoftSettingsTitle">
    <header class="microsoft-settings-head">
      <div class="appearance-settings-copy">
        <span class="settings-card-icon">${microsoftMark()}</span>
        <span>
          <strong id="microsoftSettingsTitle">Microsoft 365</strong>
          <small>Le chat lit votre boîte Outlook et votre agenda, et prépare vos envois. Aucun e-mail ni rendez-vous n’est écrit sans votre confirmation dans la conversation.</small>
        </span>
      </div>
      <span class="microsoft-state-pill ${connected ? "is-connected" : ""}">${escapeHtml(stateLabel)}</span>
    </header>
    ${loading}${unavailable}${summary}${connect}
    ${configured && view?.redirectUri ? renderRedirectUri(view.redirectUri) : ""}
    ${feedback}
  </section>`;
};

/**
 * Renvoi depuis les Reglages vers Mon compte. La liaison est nominative : elle
 * appartient a la personne connectee, pas au poste ni au serveur, et n'a donc
 * qu'un seul emplacement legitime. Ce raccourci evite que quelqu'un la cherche
 * ici, parmi Telegram et WhatsApp qui sont eux des reglages d'instance.
 */
export const renderMicrosoftAccountShortcut = (): string => {
  const view = connection;
  const state = !connectionLoaded
    ? ""
    : view?.configured !== true
      ? "Non configuré sur ce serveur"
      : view?.needsRelink === true
        ? "À relier"
        : view?.connected === true
          ? escapeHtml(view.email || "Compte lié")
          : "Aucun compte lié";
  const pending = pendingActions.length;
  return `<button type="button" id="settingsMicrosoftAccount" class="microsoft-shortcut">
    <span class="settings-card-icon">${microsoftMark()}</span>
    <span class="microsoft-shortcut-copy">
      <strong>Microsoft 365 — Outlook et Agenda</strong>
      <small>Se gère dans <b>Mon compte</b>${state ? ` · ${state}` : ""}</small>
    </span>
    ${pending ? `<span class="microsoft-shortcut-pending">${pending} à confirmer</span>` : ""}
    <i data-lucide="chevron-right"></i>
  </button>`;
};

export const bindMicrosoftConnectionUi = (nextRerender: () => void): void => {
  rerender = nextRerender;

  document.querySelector<HTMLButtonElement>("#microsoftCopyRedirect")?.addEventListener("click", async () => {
    const value = connection?.redirectUri || "";
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      connectionFeedback = { tone: "success", message: "URI de redirection copiée." };
    } catch {
      connectionFeedback = {
        tone: "error",
        message: "Copie impossible. Sélectionnez la valeur manuellement.",
      };
    }
    rerender();
  });

  document.querySelector<HTMLButtonElement>("#microsoftUnlink")?.addEventListener("click", () => {
    unlinkPending = true;
    connectionFeedback = null;
    rerender();
  });

  document.querySelector<HTMLButtonElement>("#microsoftUnlinkCancel")?.addEventListener("click", () => {
    unlinkPending = false;
    rerender();
  });

  document.querySelector<HTMLButtonElement>("#microsoftUnlinkConfirm")?.addEventListener("click", async () => {
    if (unlinking) return;
    unlinking = true;
    connectionFeedback = null;
    rerender();
    try {
      connection = await microsoftApi<MicrosoftConnectionView>("/connection", {
        method: "DELETE",
        confirm: true,
      });
      connectionLoaded = true;
      unlinkPending = false;
      connectionFeedback = {
        tone: "success",
        message: "Compte Microsoft délié. Les jetons ont été effacés du serveur.",
      };
    } catch (error) {
      connectionFeedback = { tone: "error", message: errorMessage(error) };
    } finally {
      unlinking = false;
      rerender();
    }
  });
};

// ---------------------------------------------------------------------------
// Actions en attente de confirmation
// ---------------------------------------------------------------------------

export const refreshMicrosoftPendingActions = (): Promise<void> => {
  if (pendingActionsInFlight) return pendingActionsInFlight;
  if (!isRemoteMode()) {
    pendingActions = [];
    pendingActionsLoaded = true;
    return Promise.resolve();
  }
  const pending = (async () => {
    try {
      const response = await microsoftApi<{ actions: MicrosoftPendingAction[] }>("/pending-actions");
      pendingActions = Array.isArray(response?.actions) ? response.actions : [];
    } catch {
      // Une file momentanement injoignable ne doit pas effacer les cartes deja
      // affichees : l'utilisateur perdrait de vue un envoi encore en attente.
      if (!pendingActionsLoaded) pendingActions = [];
    } finally {
      pendingActionsLoaded = true;
      pendingActionsInFlight = null;
      rerender();
    }
  })();
  pendingActionsInFlight = pending;
  return pending;
};

/** Signature du bloc de confirmation, pour le patch cible du fil de discussion. */
export const microsoftPendingActionsSignature = (): string =>
  JSON.stringify([
    pendingActions.map((action) => action.id),
    busyActionId,
    actionFeedback,
  ]);

const ACTION_TITLES: Record<MicrosoftDraft["kind"], string> = {
  sendEmail: "E-mail prêt à partir",
  createEvent: "Rendez-vous prêt à être créé",
  updateEvent: "Modification de rendez-vous prête",
};

const ACTION_ICONS: Record<MicrosoftDraft["kind"], string> = {
  sendEmail: "mail",
  createEvent: "calendar-plus",
  updateEvent: "calendar-clock",
};

/** `value` est deja du HTML : chaque appelant echappe ce qui vient du modele. */
const row = (label: string, value: string): string =>
  `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`;

const unchanged = `<span class="microsoft-unchanged">Inchangé</span>`;

const longText = (label: string, text: string): string => `
  <div class="microsoft-action-longtext">
    <span>${escapeHtml(label)}</span>
    <pre tabindex="0">${escapeHtml(text)}</pre>
  </div>`;

const renderEmailDraft = (draft: MicrosoftEmailDraft): string => `
  <dl class="microsoft-action-fields">
    ${row("Destinataires", draft.to.length ? escapeHtml(draft.to.join(", ")) : "Aucun destinataire")}
    ${draft.cc.length ? row("Copie", escapeHtml(draft.cc.join(", "))) : ""}
    ${row("Objet", draft.subject.trim() ? escapeHtml(draft.subject) : "(sans objet)")}
  </dl>
  ${longText("Corps du message", draft.body)}`;

const renderEventDraft = (draft: MicrosoftEventDraft): string => {
  const duration = microsoftEventDuration(draft.start, draft.end);
  return `
    <dl class="microsoft-action-fields">
      ${row("Titre", escapeHtml(draft.subject))}
      ${row("Début", escapeHtml(formatMicrosoftInstant(draft.start)))}
      ${row("Fin", escapeHtml(formatMicrosoftInstant(draft.end)))}
      ${duration ? row("Durée", escapeHtml(duration)) : ""}
      ${row("Lieu", draft.location ? escapeHtml(draft.location) : "Non précisé")}
      ${row("Participants", draft.attendees.length ? escapeHtml(draft.attendees.join(", ")) : "Aucun")}
      ${row("Réunion en ligne", draft.onlineMeeting ? "Oui, un lien Teams sera créé" : "Non")}
    </dl>
    ${draft.body ? longText("Description", draft.body) : ""}
    ${draft.attendees.length
      ? `<p class="microsoft-action-invite"><i data-lucide="send"></i><span>Confirmer enverra une invitation à ${draft.attendees.length} adresse${draft.attendees.length > 1 ? "s" : ""}.</span></p>`
      : ""}`;
};

const renderEventUpdateDraft = (draft: MicrosoftEventUpdateDraft): string => {
  const duration = microsoftEventDuration(draft.start, draft.end);
  const subjectRow = draft.subject === null
    ? unchanged
    : draft.currentSubject
      ? `<s>${escapeHtml(draft.currentSubject)}</s> <b>→</b> <strong>${escapeHtml(draft.subject)}</strong>`
      : `<strong>${escapeHtml(draft.subject)}</strong>`;
  return `
    <dl class="microsoft-action-fields">
      ${row("Événement", escapeHtml(draft.currentSubject || draft.eventId))}
      ${row("Titre", subjectRow)}
      ${row("Début", draft.start === null ? unchanged : escapeHtml(formatMicrosoftInstant(draft.start)))}
      ${row("Fin", draft.end === null ? unchanged : escapeHtml(formatMicrosoftInstant(draft.end)))}
      ${duration ? row("Durée", escapeHtml(duration)) : ""}
      ${row("Lieu", draft.location === null ? unchanged : escapeHtml(draft.location))}
      ${row("Description", draft.body === null ? unchanged : "Remplacée, voir ci-dessous")}
    </dl>
    ${draft.body === null ? "" : longText("Nouvelle description", draft.body)}`;
};

const renderDraft = (draft: MicrosoftDraft): string => {
  if (draft.kind === "sendEmail") return renderEmailDraft(draft);
  if (draft.kind === "createEvent") return renderEventDraft(draft);
  return renderEventUpdateDraft(draft);
};

const renderPendingAction = (action: MicrosoftPendingAction): string => {
  const busy = busyActionId === action.id;
  // Une seule action a la fois : un double clic ne doit pas partir deux fois.
  const disabled = busyActionId !== null;
  const confirmLabel = action.kind === "sendEmail" ? "Envoyer" : "Confirmer";
  const confirmIcon = action.kind === "sendEmail" ? "send" : "calendar-check";
  return `<article class="microsoft-action is-${escapeHtml(action.kind)}" data-microsoft-pending-action="${escapeHtml(action.id)}">
    <header>
      <span class="microsoft-action-mark"><i data-lucide="${escapeHtml(ACTION_ICONS[action.kind] ?? "mail")}"></i></span>
      <div>
        <strong>${escapeHtml(ACTION_TITLES[action.kind] ?? "Action à confirmer")}</strong>
        <small>${escapeHtml(localizeMicrosoftSummary(action.summary))}</small>
      </div>
      <span class="microsoft-action-expiry">Expire le ${escapeHtml(formatUnixSeconds(action.expiresAt))}</span>
    </header>
    ${renderDraft(action.draft)}
    <p class="microsoft-action-guard"><i data-lucide="shield-alert"></i><span>Rien n’est envoyé tant que vous n’avez pas confirmé ici. Relisez le contenu complet avant de valider.</span></p>
    <footer class="microsoft-action-buttons">
      <button type="button" class="primary${busy ? " is-busy" : ""}" data-microsoft-action="confirm" data-microsoft-action-id="${escapeHtml(action.id)}" ${disabled ? "disabled" : ""}>
        <i data-lucide="${busy ? "loader-circle" : confirmIcon}"></i><span>${busy ? "Envoi en cours…" : confirmLabel}</span>
      </button>
      <button type="button" data-microsoft-action="cancel" data-microsoft-action-id="${escapeHtml(action.id)}" ${disabled ? "disabled" : ""}>
        <i data-lucide="x"></i><span>Annuler</span>
      </button>
    </footer>
  </article>`;
};

let pendingPollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Sondage leger de la file de confirmation. Un agent autonome travaille sur son
 * propre calendrier : ses brouillons n'arrivent apres aucune action de
 * l'utilisateur, donc aucun rendu ne serait declenche pour les faire apparaitre.
 * Sans ce sondage, la pastille du bouton de compte ne bougerait qu'au prochain
 * tour de chat, et les brouillons expireraient au bout de six heures.
 */
export const startMicrosoftPendingPolling = (onChange: () => void): void => {
  if (pendingPollTimer !== null) return;
  pendingPollTimer = setInterval(() => {
    if (document.hidden) return;
    const before = pendingActions.length;
    void refreshMicrosoftPendingActions().then(() => {
      if (pendingActions.length !== before) onChange();
    });
  }, 90_000);
};

/**
 * Nombre d'actions qui attendent une validation humaine. Un agent autonome
 * depose ses brouillons pendant que personne ne regarde : sans ce compteur
 * visible depuis n'importe quelle vue, ils resteraient invisibles jusqu'a la
 * prochaine ouverture d'une conversation, puis expireraient au bout de six
 * heures sans que l'utilisateur ait jamais su qu'ils existaient.
 */
export const microsoftPendingActionCount = (): number => pendingActions.length;

export const renderMicrosoftPendingActions = (): string => {
  if (!pendingActions.length && !actionFeedback) return "";
  const notice = actionFeedback
    ? `<p class="microsoft-action-feedback is-${actionFeedback.tone}" role="status">
        <span>${escapeHtml(actionFeedback.message)}</span>
        <button type="button" data-microsoft-action="dismiss" aria-label="Masquer ce message"><i data-lucide="x"></i></button>
      </p>`
    : "";
  return `<section class="microsoft-pending" aria-label="Actions Microsoft 365 à confirmer">
    ${notice}${pendingActions.map(renderPendingAction).join("")}
  </section>`;
};

const resolveMicrosoftPendingAction = async (
  id: string,
  mode: "confirm" | "cancel",
): Promise<void> => {
  if (busyActionId) return;
  busyActionId = id;
  actionFeedback = null;
  rerender();
  try {
    if (mode === "confirm") {
      const result = await microsoftApi<{ status: string; message: string }>(
        `/pending-actions/${encodeURIComponent(id)}/confirm`,
        { method: "POST", confirm: true },
      );
      actionFeedback = { tone: "success", message: result?.message || "Action exécutée." };
    } else {
      await microsoftApi(`/pending-actions/${encodeURIComponent(id)}/cancel`, {
        method: "POST",
        confirm: true,
      });
      actionFeedback = { tone: "success", message: "Action annulée, rien n’a été envoyé." };
    }
  } catch (error) {
    actionFeedback = { tone: "error", message: errorMessage(error) };
  } finally {
    busyActionId = null;
    await refreshMicrosoftPendingActions();
    rerender();
  }
};

/**
 * Delegation partagee : les cartes vivent dans le fil de discussion, patche
 * hors du rendu principal, et main.ts pose ce relais aux deux endroits ou il
 * capte les clics d'action de chat.
 */
export const handleMicrosoftPendingActionClick = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : null;
  const button = element?.closest<HTMLButtonElement>("[data-microsoft-action]");
  if (!button) return false;
  const mode = button.dataset.microsoftAction;
  if (mode === "dismiss") {
    actionFeedback = null;
    rerender();
    return true;
  }
  const id = button.dataset.microsoftActionId ?? "";
  if (!id || (mode !== "confirm" && mode !== "cancel")) return false;
  void resolveMicrosoftPendingAction(id, mode);
  return true;
};
