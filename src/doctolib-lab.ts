export type DoctolibLabMode = "demo" | "live";

export type DoctolibLabStatus = {
  demoReady: boolean;
  liveReady: boolean;
  nodeReady: boolean;
  workerReady: boolean;
  chromeReady: boolean;
  connected: boolean | null;
  googleCalendarReady?: boolean;
  googleCalendarConnected?: boolean | null;
  detail: string;
};

export type DoctolibLabProposal = {
  id: string;
  mode: DoctolibLabMode;
  practitionerName: string;
  specialty: string;
  address: string;
  sector: string;
  visitMotive: string;
  startsAt: string;
  sourceUrl: string;
  acceptsNewPatients: boolean;
  expiresAt: number;
};

export type DoctolibLabSearchResponse = {
  mode: DoctolibLabMode;
  generatedAt: number;
  recommendedProposalId: string | null;
  proposals: DoctolibLabProposal[];
  note: string;
};

export type DoctolibLabConfirmation = {
  proposalId: string;
  status: "confirmed" | "needs_user" | "failed";
  verified: boolean;
  message: string;
  verificationCode: string | null;
  sourceUrl: string;
  googleCalendarStatus?: "pending" | "added" | "skipped" | "needs_user" | "failed";
  googleCalendarAdded?: boolean;
  googleCalendarMessage?: string;
  googleCalendarEventUrl?: string | null;
};

export type DoctolibLabBusyAction = "status" | "connect" | "calendar" | "search" | "confirm" | null;

export type DoctolibLabChatMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  tone?: "normal" | "success" | "warning";
};

export type DoctolibLabChatIntent =
  | { kind: "search"; specialty: string; location: string | null }
  | { kind: "confirm" }
  | { kind: "reject" }
  | { kind: "select"; index: number }
  | { kind: "connect" }
  | { kind: "connect-calendar" }
  | { kind: "mode"; mode: DoctolibLabMode }
  | { kind: "unsupported-specialty"; specialty: string }
  | { kind: "help" }
  | { kind: "unknown" };

export type DoctolibLabViewState = {
  mode: DoctolibLabMode;
  specialty: string;
  location: string;
  status: DoctolibLabStatus | null;
  search: DoctolibLabSearchResponse | null;
  selectedProposalId: string | null;
  confirmation: DoctolibLabConfirmation | null;
  busy: DoctolibLabBusyAction;
  error: string | null;
  messages: DoctolibLabChatMessage[];
  awaitingLocation: boolean;
  syncGoogleCalendar: boolean;
};

let doctolibLabMessageSequence = 0;

const chatMessage = (
  role: DoctolibLabChatMessage["role"],
  text: string,
  tone: DoctolibLabChatMessage["tone"] = "normal",
): DoctolibLabChatMessage => ({
  id: `rdv-message-${Date.now()}-${++doctolibLabMessageSequence}`,
  role,
  text,
  tone,
});

export const createDoctolibLabState = (): DoctolibLabViewState => ({
  mode: "live",
  specialty: "Médecin généraliste",
  location: "Paris",
  status: null,
  search: null,
  selectedProposalId: null,
  confirmation: null,
  busy: null,
  error: null,
  messages: [chatMessage(
    "assistant",
    "Bonjour, je suis configuré pour utiliser votre vrai compte Doctolib. Dites-moi par exemple : « Trouve-moi un médecin généraliste à Paris ». Si un compte n’est pas connecté, je vous guiderai dans la fenêtre officielle, puis je reprendrai automatiquement. Après un rendez-vous vérifié, je peux aussi l’ajouter à Google Calendar.",
  )],
  awaitingLocation: false,
  syncGoogleCalendar: true,
});

export const appendDoctolibLabMessage = (
  state: Pick<DoctolibLabViewState, "messages">,
  role: DoctolibLabChatMessage["role"],
  text: string,
  tone: DoctolibLabChatMessage["tone"] = "normal",
): void => {
  const content = text.trim();
  if (!content) return;
  state.messages.push(chatMessage(role, content, tone));
};

const normalizedMessage = (value: string): string => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[’']/g, "'")
  .replace(/\s+/g, " ")
  .trim()
  .toLowerCase();

const cleanLocation = (value: string): string => value
  .trim()
  .replace(/^[,;:\s]+|[,;:\s]+$/g, "")
  .replace(/\s+/g, " ")
  .replace(/\b(?:demain|aujourd'hui|cette semaine|ce soir|le matin|l'apres-midi)\b.*$/i, "")
  .trim();

const locationFromMessage = (value: string): string | null => {
  const match = value.match(
    /(?:^|\s)(?:à|a|sur|vers|près\s+de|proche\s+de|autour\s+de|dans\s+la\s+ville\s+de)\s+([\p{L}\d][\p{L}\d'’\-\s]{0,60}?)(?=\s+(?:demain|aujourd'hui|cette\s+semaine|ce\s+soir|le\s+matin|l'après-midi|pour|avec|sans|qui)\b|[,.!?;]|$)/iu,
  );
  const location = cleanLocation(match?.[1] ?? "");
  return location || null;
};

const selectionIndex = (message: string): number | null => {
  const numeric = message.match(/^(?:le\s+)?(?:choix|créneau|creneau|numéro|numero|n°)?\s*([1-9])\b/);
  if (numeric) return Number(numeric[1]) - 1;
  const words: Array<[RegExp, number]> = [
    [/\b(?:premier|première|premiere)\b/, 0],
    [/\b(?:deuxième|deuxieme|second|seconde)\b/, 1],
    [/\b(?:troisième|troisieme)\b/, 2],
    [/\b(?:quatrième|quatrieme)\b/, 3],
    [/\b(?:cinquième|cinquieme)\b/, 4],
  ];
  return words.find(([pattern]) => pattern.test(message))?.[1] ?? null;
};

export const interpretDoctolibLabMessage = (
  rawMessage: string,
  context: { awaitingLocation?: boolean } = {},
): DoctolibLabChatIntent => {
  const raw = rawMessage.trim();
  const message = normalizedMessage(raw);
  if (!message) return { kind: "unknown" };

  if (/^(?:oui|ok|d'accord|vas-y|confirme|je confirme|reserve(?:-le)?|prends(?:-le)?)(?:\s+(?:ce|le)\s+(?:rdv|rendez-vous|creneau))?[.!]*$/.test(message)) {
    return { kind: "confirm" };
  }
  if (/^(?:non|annule|stop|laisse tomber|pas celui-ci)[.!]*$/.test(message)) {
    return { kind: "reject" };
  }

  const index = selectionIndex(message);
  if (index !== null && /(?:choix|creneau|rendez-vous|rdv|premier|premiere|deuxieme|second|troisieme|quatrieme|cinquieme|^[1-9]\b)/.test(message)) {
    return { kind: "select", index };
  }

  if (/\b(?:connecte|connexion|identifie|login)\b.*\b(?:google\s+calendar|agenda\s+google)\b|^(?:google\s+calendar|agenda\s+google)$/i.test(message)) {
    return { kind: "connect-calendar" };
  }
  if (/\b(?:connecte|connexion|identifie|login)\b.*\bdoctolib\b|^connecte(?:-moi)?$/i.test(message)) {
    return { kind: "connect" };
  }
  if (/\b(?:mode\s+)?(?:reel|vrai|production)\b/.test(message)) {
    return { kind: "mode", mode: "live" };
  }
  if (/\b(?:mode\s+)?(?:demo|demonstration|bac a sable|test)\b/.test(message)) {
    return { kind: "mode", mode: "demo" };
  }

  const unsupported = [
    ["dentiste", /\b(?:dentiste|dentaire)\b/],
    ["dermatologue", /\b(?:dermatologue|dermato)\b/],
    ["ophtalmologue", /\b(?:ophtalmologue|ophtalmo)\b/],
    ["gynécologue", /\b(?:gynecologue|gyneco)\b/],
    ["pédiatre", /\b(?:pediatre|pediatrie)\b/],
  ] as const;
  const unsupportedSpecialty = unsupported.find(([, pattern]) => pattern.test(message));
  if (unsupportedSpecialty) {
    return { kind: "unsupported-specialty", specialty: unsupportedSpecialty[0] };
  }

  const asksForAppointment = /\b(?:rdv|rendez-vous|generaliste|medecin|docteur|creneau|cherche|trouve|prendre|besoin)\b/.test(message);
  if (asksForAppointment) {
    return {
      kind: "search",
      specialty: "Médecin généraliste",
      location: locationFromMessage(raw),
    };
  }

  if (context.awaitingLocation) {
    const location = cleanLocation(raw);
    if (location && location.length <= 80) {
      return { kind: "search", specialty: "Médecin généraliste", location };
    }
  }

  if (/^(?:aide|help|que peux-tu faire|comment ca marche|comment ça marche)\??$/.test(message)) {
    return { kind: "help" };
  }
  return { kind: "unknown" };
};

export const selectedDoctolibLabProposal = (
  state: Pick<DoctolibLabViewState, "search" | "selectedProposalId">,
): DoctolibLabProposal | null =>
  state.search?.proposals.find((proposal) => proposal.id === state.selectedProposalId) ?? null;

const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const formatDoctolibLabSlot = (startsAt: string): string => {
  const date = new Date(startsAt);
  if (Number.isNaN(date.getTime())) return startsAt;
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const statusItem = (ready: boolean, label: string) => `
  <span class="doctolib-lab-check ${ready ? "is-ready" : "is-missing"}">
    <i data-lucide="${ready ? "check" : "x"}"></i>${escapeHtml(label)}
  </span>`;

const renderEnvironmentStatus = (
  status: DoctolibLabStatus | null,
  remoteMode: boolean,
  busy: DoctolibLabBusyAction,
): string => {
  if (!status) {
    return `<div class="doctolib-lab-runtime">
      <i data-lucide="loader-circle" class="spin"></i>
      <div><strong>Vérification ${remoteMode ? "du serveur" : "du poste"}…</strong><small>Chrome, Node et le worker ${remoteMode ? "de la machine :8080" : "local"} sont contrôlés.</small></div>
    </div>`;
  }
  return `<div class="doctolib-lab-runtime ${status.liveReady ? "is-ready" : "is-warning"}">
    <div class="doctolib-lab-runtime-copy">
      <strong>${status.liveReady
        ? status.connected
          ? `Compte Doctolib réel connecté${remoteMode ? " sur le serveur" : ""}`
          : `Navigateur réel prêt${remoteMode ? " sur le serveur" : ""} · connexion requise`
        : "Mode réel à configurer"}</strong>
      <small>${escapeHtml(status.detail)}</small>
      ${remoteMode ? "<small>Chrome s’ouvrira sur la machine qui héberge le port 8080.</small>" : ""}
      <div class="doctolib-lab-checks">
        ${statusItem(status.nodeReady, "Node")}
        ${statusItem(status.workerReady, "Worker")}
        ${statusItem(status.chromeReady, "Chrome")}
        ${statusItem(status.connected === true, "Compte réel")}
      </div>
    </div>
    <div class="doctolib-lab-runtime-actions">
      <button id="doctolibLabStatusRefresh" type="button" class="icon-button" title="Revérifier le poste" ${busy ? "disabled" : ""}><i data-lucide="refresh-ccw"></i></button>
      <button id="doctolibLabConnect" type="button" class="tool-button" ${!status.liveReady || busy ? "disabled" : ""}>
        <i data-lucide="log-in"></i><span>${busy === "connect" ? "Connexion…" : status.connected ? "Changer de compte" : "Connecter le vrai compte"}</span>
      </button>
    </div>
  </div>`;
};

const renderGoogleCalendarStatus = (
  status: DoctolibLabStatus | null,
  remoteMode: boolean,
  busy: DoctolibLabBusyAction,
): string => {
  if (!status) return "";
  const ready = status.googleCalendarReady ?? status.liveReady;
  const connected = status.googleCalendarConnected === true;
  return `<div class="doctolib-lab-calendar-runtime ${connected ? "is-ready" : "is-warning"}">
    <span class="doctolib-lab-calendar-icon"><i data-lucide="calendar-plus"></i></span>
    <div>
      <strong>${connected ? "Google Calendar connecté" : "Google Calendar à connecter"}</strong>
      <small>${connected
        ? "Le rendez-vous sera ajouté seulement après une confirmation Doctolib vérifiée et si l’option est cochée."
        : `La connexion se fait dans une fenêtre Google officielle${remoteMode ? " ouverte sur la machine du serveur" : ""} ; l’application ne lit jamais votre mot de passe.`}</small>
    </div>
    <button id="doctolibLabGoogleCalendarConnect" type="button" class="tool-button" ${!ready || busy ? "disabled" : ""}>
      <i data-lucide="${connected ? "refresh-cw" : "log-in"}"></i>
      <span>${busy === "calendar" ? "Connexion…" : connected ? "Changer de compte Google" : "Connecter Google Calendar"}</span>
    </button>
  </div>`;
};

const renderProposal = (proposal: DoctolibLabProposal, selected: boolean, index: number): string => `
  <label class="doctolib-lab-proposal ${selected ? "is-selected" : ""}">
    <input type="radio" name="doctolibLabProposal" value="${escapeHtml(proposal.id)}" ${selected ? "checked" : ""} />
    <span class="doctolib-lab-proposal-main">
      <span class="doctolib-lab-proposal-head">
        <strong><b>${index + 1}</b>${escapeHtml(proposal.practitionerName)}</strong>
        <em>${escapeHtml(proposal.sector)}</em>
      </span>
      <span class="doctolib-lab-slot"><i data-lucide="calendar-clock"></i>${escapeHtml(formatDoctolibLabSlot(proposal.startsAt))}</span>
      <small>${escapeHtml(proposal.address)} · ${escapeHtml(proposal.visitMotive)}</small>
    </span>
  </label>`;

const renderConfirmation = (
  proposal: DoctolibLabProposal | null,
  busy: DoctolibLabBusyAction,
  syncGoogleCalendar: boolean,
  googleCalendarConnected: boolean,
): string => {
  if (!proposal) return "";
  return `<aside class="doctolib-lab-confirm-card">
    <div class="doctolib-lab-confirm-icon"><i data-lucide="shield-check"></i></div>
    <div class="doctolib-lab-confirm-copy">
      <span>Action proposée</span>
      <strong>Prendre le rendez-vous avec ${escapeHtml(proposal.practitionerName)}</strong>
      <small>${escapeHtml(formatDoctolibLabSlot(proposal.startsAt))} · ${escapeHtml(proposal.address)}</small>
      <p>${proposal.mode === "demo"
        ? "Le bac à sable simulera et vérifiera la réservation, sans contacter Doctolib."
        : "Votre « oui » autorise la sélection du créneau et la confirmation finale dans le navigateur Doctolib visible."}</p>
      <label class="doctolib-lab-calendar-consent ${proposal.mode === "demo" ? "is-disabled" : ""}">
        <input id="doctolibLabGoogleCalendarSync" type="checkbox" ${proposal.mode === "live" && syncGoogleCalendar ? "checked" : ""} ${proposal.mode === "demo" || busy ? "disabled" : ""} />
        <span><strong>Ajouter ensuite à Google Calendar</strong><small>${proposal.mode === "demo"
          ? "Désactivé dans le bac à sable : aucun événement réel ne sera créé."
          : googleCalendarConnected
            ? "Ce même « oui » autorise l’événement uniquement si Doctolib confirme réellement le rendez-vous."
            : "Avant de réserver, je vous guiderai pour connecter Google Calendar."}</small></span>
      </label>
    </div>
    <div class="doctolib-lab-confirm-actions">
      <button id="doctolibLabReject" type="button" class="tool-button" ${busy ? "disabled" : ""}><i data-lucide="x"></i><span>Non</span></button>
      <button id="doctolibLabConfirm" type="button" class="tool-button primary" ${busy ? "disabled" : ""}>
        <i data-lucide="${busy === "confirm" ? "loader-circle" : "check"}" class="${busy === "confirm" ? "spin" : ""}"></i>
        <span>${busy === "confirm" ? "Réservation…" : "Oui, prendre ce RDV"}</span>
      </button>
    </div>
  </aside>`;
};

const renderResult = (confirmation: DoctolibLabConfirmation | null): string => {
  if (!confirmation) return "";
  const success = confirmation.status === "confirmed" && confirmation.verified;
  const icon = success ? "badge-check" : confirmation.status === "needs_user" ? "circle-alert" : "x";
  const calendarMessage = confirmation.googleCalendarMessage?.trim();
  const calendarSuccess = confirmation.googleCalendarAdded === true;
  return `<div class="doctolib-lab-result ${success ? "is-success" : "is-warning"}" role="status">
    <i data-lucide="${icon}"></i>
    <div>
      <strong>${success ? "Rendez-vous vérifié" : confirmation.status === "needs_user" ? "Intervention demandée" : "Réservation non confirmée"}</strong>
      <span>${escapeHtml(confirmation.message)}</span>
      ${confirmation.verificationCode ? `<small>Référence : ${escapeHtml(confirmation.verificationCode)}</small>` : ""}
      ${calendarMessage ? `<small class="doctolib-lab-calendar-result ${calendarSuccess ? "is-success" : "is-warning"}"><i data-lucide="${calendarSuccess ? "calendar-check" : "calendar-x"}"></i>${escapeHtml(calendarMessage)}</small>` : ""}
    </div>
  </div>`;
};

const renderChatMessage = (message: DoctolibLabChatMessage): string => `
  <article class="doctolib-lab-message is-${message.role} ${message.tone && message.tone !== "normal" ? `is-${message.tone}` : ""}">
    ${message.role === "assistant" ? '<span class="doctolib-lab-avatar"><i data-lucide="bot"></i></span>' : ""}
    <div class="doctolib-lab-bubble">${escapeHtml(message.text)}</div>
  </article>`;

const busyLabel = (busy: DoctolibLabBusyAction): string => {
  if (busy === "search") return "Je cherche les créneaux disponibles…";
  if (busy === "confirm") return "Je tente la réservation et je vérifie le résultat…";
  if (busy === "connect") return "J’attends la connexion dans Chrome…";
  if (busy === "calendar") return "J’attends la connexion Google Calendar dans Chrome…";
  return "Je vérifie le moteur RDV…";
};

export const renderDoctolibLabPanel = (
  state: DoctolibLabViewState,
  options: { remoteMode: boolean },
): string => {
  const selected = selectedDoctolibLabProposal(state);
  const busy = state.busy;
  const liveDisabled = state.status === null || !state.status.liveReady;
  const proposals = state.search?.proposals ?? [];
  return `<section class="doctolib-lab panel" aria-labelledby="doctolibLabTitle">
    <header class="doctolib-lab-hero">
      <span class="doctolib-lab-mark"><i data-lucide="stethoscope"></i></span>
      <div>
        <span class="doctolib-lab-kicker"><i data-lucide="flask-conical"></i>Feature séparée · expérimental</span>
        <h2 id="doctolibLabTitle">Assistant RDV</h2>
        <p>Décrivez votre besoin comme dans un chat. L’assistant comprend la demande, cherche les créneaux et exécute les étapes à votre place.</p>
      </div>
    </header>

    <div class="doctolib-lab-safety">
      <i data-lucide="shield-check"></i>
      <p><strong>${state.mode === "live"
        ? "Le mode réel est actif : votre « oui » peut créer un vrai rendez-vous."
        : "Le bac à sable est actif : aucun vrai rendez-vous ne sera créé."}</strong> ${state.mode === "live"
          ? `Chrome s’ouvre ${options.remoteMode ? "sur la machine du serveur :8080" : "sur ce poste"}. L’assistant ne contourne jamais connexion, 2FA ou CAPTCHA et vérifie la confirmation dans votre compte.`
          : "Repassez au vrai compte lorsque vous voulez effectuer une réservation réelle."}</p>
    </div>

    <div class="doctolib-lab-modes" role="radiogroup" aria-label="Mode du test">
      <label class="${state.mode === "live" ? "is-selected" : ""} ${liveDisabled ? "is-disabled" : ""}">
        <input type="radio" name="doctolibLabMode" value="live" ${state.mode === "live" ? "checked" : ""} ${liveDisabled || busy ? "disabled" : ""} />
        <span><strong>Vrai compte Doctolib</strong><small>Mode principal · réservation réelle après votre « oui »</small></span>
      </label>
      <label class="${state.mode === "demo" ? "is-selected" : ""}">
        <input type="radio" name="doctolibLabMode" value="demo" ${state.mode === "demo" ? "checked" : ""} ${busy ? "disabled" : ""} />
        <span><strong>Bac à sable</strong><small>Uniquement pour tester sans créer de rendez-vous</small></span>
      </label>
    </div>

    ${renderEnvironmentStatus(state.status, options.remoteMode, busy)}
    ${renderGoogleCalendarStatus(state.status, options.remoteMode, busy)}

    <section class="doctolib-lab-chat" aria-label="Conversation avec l’assistant de rendez-vous">
      <div id="doctolibLabThread" class="doctolib-lab-thread" aria-live="polite">
        ${state.messages.map(renderChatMessage).join("")}

        ${state.search ? `<article class="doctolib-lab-message is-assistant is-tool">
          <span class="doctolib-lab-avatar"><i data-lucide="calendar-search"></i></span>
          <section class="doctolib-lab-proposals">
            <header><div><span>${state.mode === "demo" ? "Propositions de test" : "Créneaux Doctolib détectés"}</span><strong>${proposals.length} option${proposals.length > 1 ? "s" : ""}</strong></div><small>${escapeHtml(state.search.note)}</small></header>
            ${proposals.length
              ? `<div class="doctolib-lab-proposal-list">${proposals.map((proposal, index) => renderProposal(proposal, proposal.id === state.selectedProposalId, index)).join("")}</div>`
              : `<div class="doctolib-lab-empty"><i data-lucide="calendar-clock"></i><strong>Aucun créneau trouvé</strong><span>Écrivez une autre ville pour relancer la recherche.</span></div>`}
          </section>
        </article>` : ""}

        ${selected ? `<article class="doctolib-lab-message is-assistant is-tool">
          <span class="doctolib-lab-avatar"><i data-lucide="bot"></i></span>
          ${renderConfirmation(selected, busy, state.syncGoogleCalendar, state.status?.googleCalendarConnected === true)}
        </article>` : ""}

        ${state.confirmation ? `<article class="doctolib-lab-message is-assistant is-tool">
          <span class="doctolib-lab-avatar"><i data-lucide="bot"></i></span>
          ${renderResult(state.confirmation)}
        </article>` : ""}

        ${state.error ? `<article class="doctolib-lab-message is-assistant is-tool">
          <span class="doctolib-lab-avatar"><i data-lucide="bot"></i></span>
          <div class="doctolib-lab-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(state.error)}</span></div>
        </article>` : ""}

        ${busy ? `<article class="doctolib-lab-message is-assistant is-typing">
          <span class="doctolib-lab-avatar"><i data-lucide="bot"></i></span>
          <div class="doctolib-lab-bubble"><i data-lucide="loader-circle" class="spin"></i>${escapeHtml(busyLabel(busy))}</div>
        </article>` : ""}
      </div>

      ${!busy && !state.search ? `<div class="doctolib-lab-suggestions" aria-label="Exemples de demandes">
        <button type="button" data-doctolib-prompt="Trouve-moi un médecin généraliste à Paris">Généraliste à Paris</button>
        <button type="button" data-doctolib-prompt="Passe en mode ${state.mode === "live" ? "démo" : "réel"}">Passer en mode ${state.mode === "live" ? "démo" : "réel"}</button>
        ${state.mode === "live" && state.status?.connected !== true ? '<button type="button" data-doctolib-prompt="Connecte-moi à Doctolib">Connecter le vrai compte</button>' : ""}
        ${state.mode === "live" && state.status?.googleCalendarConnected !== true ? '<button type="button" data-doctolib-prompt="Connecte Google Calendar">Connecter Google Calendar</button>' : ""}
      </div>` : ""}

      <form id="doctolibLabChatForm" class="doctolib-lab-composer">
        <textarea id="doctolibLabMessage" rows="1" maxlength="600" placeholder="Ex. Trouve-moi un généraliste à Paris…" aria-label="Votre demande de rendez-vous" ${busy ? "disabled" : ""}></textarea>
        <button type="submit" class="tool-button primary" title="Envoyer" ${busy ? "disabled" : ""}>
          <i data-lucide="send"></i><span>Envoyer</span>
        </button>
      </form>
      <small class="doctolib-lab-chat-hint">Entrée pour envoyer · vous pouvez répondre « oui », « non » ou choisir un numéro.</small>
    </section>
  </section>`;
};
