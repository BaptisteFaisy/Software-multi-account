export type AutonomousAgentStatus =
  | "active"
  | "paused"
  | "completed"
  | "needs_attention";

export type AutonomousTriggerKind = "schedule" | "workspace_change";

export const AUTONOMOUS_TRIGGER_KINDS = ["schedule", "workspace_change"] as const;

export const isAutonomousTriggerKind = (value: unknown): value is AutonomousTriggerKind =>
  typeof value === "string" && AUTONOMOUS_TRIGGER_KINDS.includes(value as AutonomousTriggerKind);

export const parseAutonomousWatchPaths = (value: string): string[] =>
  Array.from(new Set(
    value
      .split(/[\n,;]+/)
      .map((path) => path.trim().replace(/\\/g, "/").replace(/^\.\//, ""))
      .filter(Boolean),
  ));

export type AutonomousAgentAction =
  | "pause"
  | "resume"
  | "runNow"
  | "testNow"
  | "complete"
  | "approveReview"
  | "authorizePayment"
  | "confirmPayment"
  | "rejectReview";

export type AutonomousReviewKind = "approval" | "decision" | "verification";

export const AUTONOMOUS_CONNECTOR_IDS = ["gmail", "google_calendar"] as const;

export type AutonomousConnectorId = (typeof AUTONOMOUS_CONNECTOR_IDS)[number];

export type AutonomousConnectorDefinition = {
  id: AutonomousConnectorId;
  label: string;
  description: string;
  icon: string;
};

export const AUTONOMOUS_CONNECTORS: readonly AutonomousConnectorDefinition[] = [
  {
    id: "gmail",
    label: "Gmail",
    description: "Lire et rechercher les messages ; toute action d’écriture reste soumise à autorisation.",
    icon: "mail",
  },
  {
    id: "google_calendar",
    label: "Google Agenda",
    description: "Consulter l’agenda ; créer ou modifier un événement exige une autorisation.",
    icon: "calendar-days",
  },
];

const AUTONOMOUS_CONNECTOR_ID_SET = new Set<string>(AUTONOMOUS_CONNECTOR_IDS);

export const isAutonomousConnectorId = (value: unknown): value is AutonomousConnectorId =>
  typeof value === "string" && AUTONOMOUS_CONNECTOR_ID_SET.has(value);

export const normalizeAutonomousConnectors = (values: unknown): AutonomousConnectorId[] => {
  if (!Array.isArray(values)) return [];
  const selected = new Set(values.filter(isAutonomousConnectorId));
  return AUTONOMOUS_CONNECTOR_IDS.filter((id) => selected.has(id));
};

export const toggleAutonomousConnector = (
  connectors: readonly AutonomousConnectorId[],
  id: AutonomousConnectorId,
): AutonomousConnectorId[] =>
  normalizeAutonomousConnectors(
    connectors.includes(id)
      ? connectors.filter((candidate) => candidate !== id)
      : [...connectors, id],
  );

export const autonomousConnectorLabel = (id: AutonomousConnectorId): string =>
  AUTONOMOUS_CONNECTORS.find((connector) => connector.id === id)?.label ?? id;

const autonomousPaymentHostIsPublic = (host: string): boolean => {
  const normalized = host.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    normalized === "localhost"
    || normalized.endsWith(".localhost")
    || normalized.endsWith(".local")
    || normalized.endsWith(".internal")
    || normalized.endsWith(".lan")
    || normalized.endsWith(".home")
    || normalized.endsWith(".home.arpa")
    || normalized.endsWith(".test")
    || normalized.endsWith(".invalid")
    || normalized.endsWith(".example")
    || normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("::ffff:")
    || (normalized.includes(":") && (
      normalized.startsWith("fc")
      || normalized.startsWith("fd")
      || normalized.startsWith("fe8")
      || normalized.startsWith("fe9")
      || normalized.startsWith("fea")
      || normalized.startsWith("feb")
    ))
  ) return false;
  if (!normalized.includes(".") && !normalized.includes(":")) return false;
  const ipv4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return true;
  const octets = ipv4.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return false;
  return !(
    octets[0] === 0
    || octets[0] === 10
    || octets[0] === 127
    || (octets[0] === 169 && octets[1] === 254)
    || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    || (octets[0] === 192 && octets[1] === 168)
    || octets[0] >= 224
  );
};

export const autonomousPaymentCheckoutUrl = (value: unknown): URL | null => {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:"
      || !url.hostname
      || url.username
      || url.password
      || !autonomousPaymentHostIsPublic(url.hostname)
    ) return null;
    url.hash = "";
    return url;
  } catch {
    return null;
  }
};

export const formatAutonomousPaymentAmount = (
  payment: Pick<AutonomousPaymentRequest, "amountMinor" | "currency">,
  locale = "fr-FR",
): string => {
  const currency = payment.currency?.trim().toUpperCase();
  const amountMinor = Number(payment.amountMinor);
  if (!/^[A-Z]{3}$/.test(currency) || !Number.isSafeInteger(amountMinor) || amountMinor < 1) {
    return "Montant invalide";
  }
  try {
    const formatter = new Intl.NumberFormat(locale, { style: "currency", currency });
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
    return formatter.format(amountMinor / (10 ** digits));
  } catch {
    return `${amountMinor} ${currency} (unité mineure)`;
  }
};

export const autonomousPaymentStatusLabel = (status: AutonomousPaymentStatus): string => {
  switch (status) {
    case "pending": return "À confirmer";
    case "authorized": return "Checkout lancé";
    case "confirmed": return "Confirmé";
    case "rejected": return "Refusé";
    case "cancelled": return "Annulé";
  }
};

export type AutonomousReviewRequest = {
  id: string;
  kind: AutonomousReviewKind;
  request: string;
  createdAt: number;
  externalAction?: boolean;
  evidencePath?: string | null;
  payment?: AutonomousPaymentRequest | null;
};

export type AutonomousPaymentStatus = "pending" | "authorized" | "confirmed" | "rejected" | "cancelled";

export type AutonomousPaymentRequest = {
  id: string;
  reference: string;
  merchant: string;
  amountMinor: number;
  currency: string;
  description: string;
  checkoutUrl: string;
  status: AutonomousPaymentStatus;
  createdAt: number;
  authorizedAt?: number | null;
  resolvedAt?: number | null;
};

export type AutonomousReviewEvidence = {
  reviewId: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
};

export type AutonomousMemoryKind = "user" | "agent" | "test" | "supervisor";

export type AutonomousMemoryEntry = {
  id: string;
  kind: AutonomousMemoryKind;
  content: string;
  createdAt: number;
};

export type AutonomousAgentMessageMode = "guidance" | "objective";

export type AutonomousConversationEntry = {
  id: string;
  author: "user" | "agent";
  content: string;
  createdAt: number;
};

export type AutonomousWorkItemStatus =
  | "todo"
  | "in_progress"
  | "done"
  | "blocked"
  | "cancelled";

export type AutonomousWorkItem = {
  id: string;
  status: AutonomousWorkItemStatus;
  domain: string;
  description: string;
  evidence?: string | null;
  updatedAt: number;
};

export type AutonomousTestStatus =
  | "not_configured"
  | "idle"
  | "running"
  | "passed"
  | "failed"
  | "cancelled";

export type AutonomousAgentEvent = {
  timestamp: number;
  kind: string;
  message: string;
};

export type AutonomousTokenUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};

export type AutonomousAgentReport = {
  id: string;
  createdAt: number;
  runCount: number;
  content: string;
  readAt?: number | null;
  general?: boolean;
};

export type AutonomousAgentProposal = {
  id: string;
  title: string;
  objective: string;
  createdAt: number;
  runCount: number;
  reportId?: string | null;
};

export type AutonomousAgentSnapshot = {
  id: string;
  systemManaged?: boolean;
  name: string;
  objective: string;
  role?: string | null;
  sourceChatKey?: string | null;
  sourceProposalId?: string | null;
  sourceReportId?: string | null;
  sourceReportIdeaIndex?: number | null;
  accountId: string;
  projectDir?: string | null;
  sessionId?: string | null;
  mode: "build" | "plan" | "ask";
  model?: string | null;
  reasoningEffort?: string | null;
  connectors: AutonomousConnectorId[];
  whatsappNotificationChannelId?: string | null;
  telegramNotificationChannelId?: string | null;
  mobileNotificationsEnabled?: boolean;
  intervalSeconds: number;
  triggerKind?: AutonomousTriggerKind;
  watchPaths?: string[];
  debounceSeconds?: number;
  allowGitPublish?: boolean;
  eventCandidateSince?: number | null;
  lastTriggeredAt?: number | null;
  lastTriggerMessage?: string | null;
  triggerError?: string | null;
  status: AutonomousAgentStatus;
  createdAt: number;
  updatedAt: number;
  nextRunAt?: number | null;
  lastRunStartedAt?: number | null;
  lastRunFinishedAt?: number | null;
  currentTurnId?: number | null;
  currentStartId?: string | null;
  attemptCount: number;
  runCount: number;
  tokenUsage?: AutonomousTokenUsage;
  consecutiveFailures: number;
  modelCapacityRetryCount: number;
  lastError?: string | null;
  lastSummary?: string | null;
  reports?: AutonomousAgentReport[];
  proposals?: AutonomousAgentProposal[];
  requireUserReview?: boolean;
  requireVisualReviewEvidence?: boolean;
  pendingReview?: AutonomousReviewRequest | null;
  approvedReview?: AutonomousReviewRequest | null;
  payments?: AutonomousPaymentRequest[];
  memory: AutonomousMemoryEntry[];
  memoryStrategy?: string | null;
  workItems: AutonomousWorkItem[];
  nextTaskId?: string | null;
  testCommand?: string | null;
  testTimeoutSeconds: number;
  testStatus: AutonomousTestStatus;
  currentTestId?: string | null;
  testCompletionPending: boolean;
  consecutiveTestFailures: number;
  lastTestStartedAt?: number | null;
  lastTestFinishedAt?: number | null;
  lastTestExitCode?: number | null;
  lastTestDurationMs?: number | null;
  lastTestOutput?: string | null;
  events: AutonomousAgentEvent[];
};

const INTERNAL_AUTONOMOUS_REPORT_REFERENCE = String.raw`run:[A-Za-z0-9._:-]+`;
const INTERNAL_AUTONOMOUS_REPORT_SOURCE_LIST = new RegExp(
  String.raw`\s*Sources?\s*:\s*${INTERNAL_AUTONOMOUS_REPORT_REFERENCE}(?:\s*,\s*${INTERNAL_AUTONOMOUS_REPORT_REFERENCE})*[.;]?`,
  "gi",
);
const INTERNAL_AUTONOMOUS_REPORT_PARENTHESIZED_LIST = new RegExp(
  String.raw`\(\s*${INTERNAL_AUTONOMOUS_REPORT_REFERENCE}(?:\s*,\s*${INTERNAL_AUTONOMOUS_REPORT_REFERENCE})*\s*\)`,
  "gi",
);
const INTERNAL_AUTONOMOUS_REPORT_REFERENCE_ONLY = new RegExp(
  INTERNAL_AUTONOMOUS_REPORT_REFERENCE,
  "gi",
);

/**
 * Masque dans l'interface les anciennes references de suivi que le
 * superviseur devait autrefois recopier dans ses syntheses. Les donnees
 * persistantes restent intactes pour l'audit interne.
 */
export const autonomousHumanReportContent = (content: string): string =>
  content
    .replace(INTERNAL_AUTONOMOUS_REPORT_SOURCE_LIST, " ")
    .replace(INTERNAL_AUTONOMOUS_REPORT_PARENTHESIZED_LIST, " ")
    .replace(INTERNAL_AUTONOMOUS_REPORT_REFERENCE_ONLY, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .replace(/([([])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

/**
 * Retourne les comptes rendus du plus recent au plus ancien. Le repli sur
 * `lastSummary` garde l'interface compatible avec un serveur v9 pendant une
 * mise a jour progressive et utilise le meme identifiant que la migration
 * backend, afin de ne pas notifier deux fois le meme resultat.
 */
export const autonomousAgentReports = (
  agent: Pick<
    AutonomousAgentSnapshot,
    "id" | "systemManaged" | "reports" | "lastSummary" | "lastRunFinishedAt" | "updatedAt" | "runCount"
  >,
): AutonomousAgentReport[] => {
  const reports = Array.isArray(agent.reports)
    ? agent.reports
        .filter((report) =>
          !!report
          && typeof report.id === "string"
          && !!report.id.trim()
          && typeof report.content === "string"
          && !!report.content.trim(),
        )
        .map((report) => ({
          id: report.id.trim(),
          createdAt: Number.isFinite(report.createdAt) ? report.createdAt : 0,
          runCount: Number.isFinite(report.runCount) ? report.runCount : 0,
          content: autonomousHumanReportContent(report.content.trim()),
          readAt: Number.isFinite(report.readAt) ? report.readAt : null,
          general: report.general === true,
        }))
        .filter((report) => !!report.content)
    : [];
  const visibleReports = agent.systemManaged
    ? reports.filter((report) => report.general)
    : reports;
  const legacySummary = autonomousHumanReportContent(agent.lastSummary?.trim() ?? "");
  if (!visibleReports.length && !agent.systemManaged && legacySummary) {
    visibleReports.push({
      id: `run:${agent.id}:${agent.runCount}`,
      createdAt: agent.lastRunFinishedAt ?? agent.updatedAt,
      runCount: agent.runCount,
      content: legacySummary,
      readAt: null,
      general: false,
    });
  }
  return visibleReports.sort((left, right) =>
    right.createdAt - left.createdAt || right.runCount - left.runCount,
  );
};

export const autonomousAgentUnreadReports = (
  agent: Parameters<typeof autonomousAgentReports>[0],
  seenReportIds: ReadonlySet<string>,
): AutonomousAgentReport[] =>
  autonomousAgentReports(agent).filter((report) =>
    report.readAt == null && !seenReportIds.has(report.id),
  );

export const autonomousAgentProposals = (
  agent: Pick<AutonomousAgentSnapshot, "proposals">,
): AutonomousAgentProposal[] => {
  const seen = new Set<string>();
  return (Array.isArray(agent.proposals) ? agent.proposals : [])
    .filter((proposal) => {
      if (
        !proposal
        || typeof proposal.id !== "string"
        || !proposal.id.trim()
        || typeof proposal.objective !== "string"
        || !proposal.objective.trim()
      ) {
        return false;
      }
      const id = proposal.id.trim();
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((proposal) => {
      const objective = proposal.objective.trim();
      return {
        id: proposal.id.trim(),
        title: typeof proposal.title === "string" && proposal.title.trim()
          ? proposal.title.trim()
          : objective.slice(0, 160),
        objective,
        createdAt: Number.isFinite(proposal.createdAt) ? proposal.createdAt : 0,
        runCount: Number.isFinite(proposal.runCount) ? proposal.runCount : 0,
        reportId: typeof proposal.reportId === "string" && proposal.reportId.trim()
          ? proposal.reportId.trim()
          : null,
      };
    })
    .sort((left, right) =>
      right.createdAt - left.createdAt || right.runCount - left.runCount,
    );
};

export const autonomousProposalExecutionAgent = <T extends Pick<
  AutonomousAgentSnapshot,
  "sourceProposalId" | "createdAt"
>>(
  proposalId: string,
  agents: readonly T[],
): T | null =>
  agents
    .filter((agent) => agent.sourceProposalId?.trim() === proposalId.trim())
    .sort((left, right) => right.createdAt - left.createdAt)[0]
    ?? null;

export const autonomousAgentIsProjectRadar = (
  agent: Pick<AutonomousAgentSnapshot, "name" | "role">,
): boolean => {
  const name = agent.name.trim().toLocaleLowerCase("fr-FR");
  const role = agent.role?.trim().toLocaleLowerCase("fr-FR") ?? "";
  return name === "radar projet"
    || role.includes("analyste produit et architecture");
};

/**
 * Radar ecrit normalement une idee par ligne. Les anciens rapports, libres,
 * restent une seule idee afin de ne jamais decouper arbitrairement une phrase.
 */
export const autonomousRadarReportIdeas = (
  report: Pick<AutonomousAgentReport, "content">,
): string[] => {
  const content = report.content.trim();
  if (!content) return [];
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const ideaMarker = /^\s*id[eé]e(?:\s+\d{1,2})?\s*[:\-–—]\s*/iu;
  const numberedMarker = /^\s*\d{1,2}[.)]\s+/u;
  const bulletMarker = /^\s*[-*•]\s+/u;
  const marker = lines.some((line) => ideaMarker.test(line))
    ? ideaMarker
    : lines.some((line) => numberedMarker.test(line))
      ? numberedMarker
      : lines.some((line) => bulletMarker.test(line))
        ? bulletMarker
        : null;
  if (!marker) return [content];

  const ideas: string[] = [];
  let current = "";
  lines.forEach((line) => {
    if (marker.test(line)) {
      if (current) ideas.push(current);
      current = line.replace(marker, "").trim();
    } else if (current) {
      current = `${current} ${line}`;
    }
  });
  if (current) ideas.push(current);
  return ideas.length ? ideas : [content];
};

/**
 * Relie une idee affichee dans un compte rendu Radar a sa proposition
 * structuree lorsque l'agent en a publie une. Le repli par position ne
 * s'applique que si les deux listes ont la meme taille, afin de ne jamais
 * associer arbitrairement un resume global a la premiere proposition.
 */
export const autonomousRadarIdeaProposal = (
  agent: Pick<AutonomousAgentSnapshot, "proposals">,
  report: Pick<AutonomousAgentReport, "id" | "content">,
  ideaIndex: number,
): AutonomousAgentProposal | null => {
  const ideas = autonomousRadarReportIdeas(report);
  const idea = ideas[ideaIndex]?.trim();
  if (!idea || !Number.isInteger(ideaIndex) || ideaIndex < 0) return null;
  const proposals = autonomousAgentProposals(agent).filter(
    (proposal) => proposal.reportId === report.id,
  );
  if (!proposals.length) return null;

  const comparable = (value: string): string => value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("fr-FR")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const normalizedIdea = comparable(idea);
  const textualMatch = proposals.find((proposal) => {
    const objective = comparable(proposal.objective);
    const title = comparable(proposal.title);
    return objective === normalizedIdea
      || (objective.length >= 24 && normalizedIdea.includes(objective))
      || (title.length >= 8 && normalizedIdea.includes(title));
  });
  if (textualMatch) return textualMatch;
  return proposals.length === ideas.length ? proposals[ideaIndex] ?? null : null;
};

/** Retourne le dernier agent cree pour une idee precise d'un compte rendu. */
export const autonomousRadarImplementationAgent = <T extends Pick<
  AutonomousAgentSnapshot,
  "sourceReportId" | "sourceReportIdeaIndex" | "createdAt"
>>(
  reportId: string,
  ideaIndex: number,
  agents: readonly T[],
): T | null => agents
  .filter((agent) =>
    agent.sourceReportId?.trim() === reportId.trim()
    && agent.sourceReportIdeaIndex === ideaIndex,
  )
  .sort((left, right) => right.createdAt - left.createdAt)[0]
  ?? null;

/**
 * Construit le petit fil visible dans la fiche d'un agent. Les messages de
 * l'utilisateur viennent de la memoire durable et les reponses publiques des
 * comptes rendus : la conversation reste donc disponible apres redemarrage.
 */
export const autonomousConversationEntries = (
  agent: Pick<
    AutonomousAgentSnapshot,
    "id" | "systemManaged" | "memory" | "reports" | "lastSummary" | "lastRunFinishedAt" | "updatedAt" | "runCount"
  >,
  maxEntries = 8,
): AutonomousConversationEntry[] => {
  const userMessages = (Array.isArray(agent.memory) ? agent.memory : [])
    .filter((entry) => entry?.kind === "user" && !!entry.content?.trim())
    .map((entry) => ({
      id: `memory:${entry.id}`,
      author: "user" as const,
      content: entry.content.trim(),
      createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : 0,
    }));
  const agentMessages = autonomousAgentReports(agent).map((report) => ({
    id: `report:${report.id}`,
    author: "agent" as const,
    content: report.content,
    createdAt: report.createdAt,
  }));
  const limit = Math.max(1, Math.min(24, Math.floor(maxEntries) || 8));
  return [...userMessages, ...agentMessages]
    .sort((left, right) =>
      left.createdAt - right.createdAt
      || (left.author === right.author ? left.id.localeCompare(right.id) : left.author === "user" ? -1 : 1),
    )
    .slice(-limit);
};

export type AutonomousChatSeedMessage = {
  role: "user" | "assistant";
  text: string;
};

/**
 * Extrait un contexte court et durable d'un chat normal sans reutiliser sa
 * session d'execution. Les messages les plus recents sont prioritaires afin
 * que l'agent autonome parte de la derniere decision de la conversation.
 */
export const autonomousInitialMemoryFromChat = (
  messages: readonly AutonomousChatSeedMessage[],
  maxChars = 1_800,
): string => {
  const limit = Math.max(240, Math.min(2_000, Math.floor(maxChars)));
  const header = "Contexte initial extrait du chat normal (la conversation originale reste indépendante) :";
  const snippets = messages
    .map((message) => {
      const text = message.text.replace(/\s+/g, " ").trim();
      if (!text) return "";
      const clipped = text.length > 600 ? `${text.slice(0, 597).trimEnd()}…` : text;
      return `${message.role === "user" ? "Utilisateur" : "Assistant"} : ${clipped}`;
    })
    .filter(Boolean);
  if (!snippets.length) return "";

  const selected: string[] = [];
  let used = header.length;
  for (let index = snippets.length - 1; index >= 0; index -= 1) {
    const snippet = snippets[index];
    const remaining = limit - used - 1;
    if (remaining <= 0) break;
    if (snippet.length <= remaining) {
      selected.unshift(snippet);
      used += snippet.length + 1;
      continue;
    }
    if (!selected.length) {
      selected.unshift(`…${snippet.slice(-(remaining - 1))}`);
    }
    break;
  }
  return [header, ...selected].join("\n").slice(0, limit);
};

export const AUTONOMOUS_INTERVAL_OPTIONS = [
  { value: 5 * 60, label: "Toutes les 5 minutes" },
  { value: 15 * 60, label: "Toutes les 15 minutes" },
  { value: 60 * 60, label: "Toutes les heures" },
  { value: 6 * 60 * 60, label: "Toutes les 6 heures" },
  { value: 24 * 60 * 60, label: "Une fois par jour" },
] as const;

export const AUTONOMOUS_AGENT_TEMPLATE_IDS = [
  "project_radar",
  "frontend_bug_fixer",
  "backend_bug_fixer",
  "build_publisher",
] as const;

export type AutonomousAgentTemplateId = (typeof AUTONOMOUS_AGENT_TEMPLATE_IDS)[number];

export type AutonomousAgentTemplate = {
  id: AutonomousAgentTemplateId;
  name: string;
  category: string;
  description: string;
  role: string;
  objective: string;
  initialMemory: string;
  mode: "build" | "plan";
  intervalSeconds: number;
  triggerKind: AutonomousTriggerKind;
  watchPaths: string[];
  debounceSeconds: number;
  allowGitPublish: boolean;
  testCommand: string;
  requireUserReview: boolean;
  icon: string;
  tone: "ideas" | "frontend" | "backend" | "deploy";
  policyLabel: string;
};

export const AUTONOMOUS_AGENT_TEMPLATES: readonly AutonomousAgentTemplate[] = [
  {
    id: "project_radar",
    name: "Radar projet",
    category: "Idées et opportunités",
    description: "Analyse les évolutions du projet et fait émerger des idées utiles, argumentées et non répétitives.",
    role: "Analyste produit et architecture en lecture seule, curieux, factuel et attentif au rapport impact/effort.",
    objective: "Analyse en continu l’architecture, les fonctionnalités, les tests, la documentation et les changements récents du projet. À chaque tour, vérifie d’abord ce qui a réellement changé. Propose au maximum trois idées nouvelles et réalisables, chacune accompagnée du problème observé, de preuves précises dans le projet, du bénéfice attendu, de l’effort estimé et d’un niveau de confiance. Pour chaque idée suffisamment concrète pour être confiée à un autre agent, émets une ligne `AUTONOMOUS_PROPOSAL: titre court | mission précise, bornée et directement exécutable`. Résume aussi les idées elles-mêmes dans `AUTONOMOUS_REPORT` ; ne te limite jamais à annoncer qu’une idée a été trouvée ou enregistrée. Ne fabrique aucune suggestion si rien de suffisamment pertinent n’a changé, ne répète jamais une idée déjà enregistrée et ne modifie aucun fichier.",
    initialMemory: "Conserver un registre concis des suggestions déjà proposées, acceptées, refusées ou réalisées afin d’éviter tout doublon. Privilégier les idées utiles et spécifiques au projet plutôt que les conseils génériques.",
    mode: "plan",
    intervalSeconds: 6 * 60 * 60,
    triggerKind: "schedule",
    watchPaths: [],
    debounceSeconds: 10,
    allowGitPublish: false,
    testCommand: "",
    requireUserReview: false,
    icon: "scan-eye",
    tone: "ideas",
    policyLabel: "Lecture seule · 3 idées maximum",
  },
  {
    id: "frontend_bug_fixer",
    name: "Correcteur de bugs frontend",
    category: "Interface et expérience",
    description: "Recherche les régressions visibles, les reproduit et prépare une correction frontend testée.",
    role: "Ingénieur frontend spécialisé en diagnostic TypeScript, interface, CSS, responsive et accessibilité, prudent avec les contrats existants.",
    objective: "Surveille et corrige les bugs du frontend. Commence toujours par établir une reproduction ou une preuve fiable à partir des tests en échec, des erreurs, des changements récents ou du comportement observable. Traite un seul bug vérifié à la fois, recherche sa cause racine, applique le plus petit correctif sûr et ajoute ou renforce un test de non-régression. Vérifie le rendu desktop et mobile lorsque l’interface est concernée, puis exécute les validations frontend pertinentes. Préserve les comportements intentionnels et les modifications déjà présentes. Si la cause appartient au backend ou si aucun bug n’est démontré, ne modifie rien et fournis un diagnostic précis.",
    initialMemory: "Pour chaque bug, mémoriser la reproduction, la cause racine, les fichiers touchés et la preuve de validation. Ne jamais rouvrir un bug déjà validé sans nouvelle preuve de régression.",
    mode: "build",
    intervalSeconds: 15 * 60,
    triggerKind: "schedule",
    watchPaths: [],
    debounceSeconds: 10,
    allowGitPublish: false,
    testCommand: "",
    requireUserReview: true,
    icon: "app-window",
    tone: "frontend",
    policyLabel: "Correction avec review · Frontend uniquement",
  },
  {
    id: "backend_bug_fixer",
    name: "Correcteur de bugs backend",
    category: "API et services",
    description: "Diagnostique les erreurs serveur, sécurise leur correction et vérifie les contrats et la persistance.",
    role: "Ingénieur backend spécialisé en API, services, persistance, concurrence, sécurité et tests d’intégration, méthodique et conservateur.",
    objective: "Surveille et corrige les bugs du backend. Commence toujours par obtenir une reproduction ou une preuve fiable à partir des tests en échec, des journaux, des erreurs API ou des changements récents. Traite un seul bug vérifié à la fois, identifie sa cause racine et applique le plus petit correctif sûr. Vérifie systématiquement les contrats d’API, la gestion des erreurs, l’authentification, la persistance et les risques de concurrence concernés, puis ajoute un test de non-régression et exécute les validations backend pertinentes. Ne modifie ni les données utilisateur ni l’interface sans nécessité démontrée. Si la cause appartient au frontend ou si aucun bug n’est démontré, ne modifie rien et fournis un diagnostic précis.",
    initialMemory: "Pour chaque bug, mémoriser la reproduction, la cause racine, les contrats concernés et la preuve de validation. Ne jamais effectuer de migration destructive ni répéter une correction déjà validée sans nouvelle preuve.",
    mode: "build",
    intervalSeconds: 15 * 60,
    triggerKind: "schedule",
    watchPaths: [],
    debounceSeconds: 10,
    allowGitPublish: false,
    testCommand: "",
    requireUserReview: true,
    icon: "server",
    tone: "backend",
    policyLabel: "Correction avec review · Backend uniquement",
  },
  {
    id: "build_publisher",
    name: "Publieur du build",
    category: "GitHub et déploiement",
    description: "Dort jusqu’à une modification stable et une fenêtre sans autre agent actif, puis valide, pousse sur GitHub et active le nouveau frontend sur le site.",
    role: "Ingénieur de livraison prudent, responsable de la validation, du push Git non destructif, de la publication atomique et de la vérification du site.",
    objective: "À chaque réveil provoqué par une modification du projet, attends que les autres agents du même projet aient terminé leur tour, puis inspecte précisément les changements Git et ne publie que des fichiers appartenant au projet. Refuse tout secret, cache, artefact lourd ou fichier sans rapport. Exécute `npm run verify:quick`, puis `npm run build:frontend`. Si les validations réussissent, crée un commit descriptif sans réécrire l’historique et pousse la branche courante avec `git push origin HEAD` (jamais de force push). Publie ensuite le build déjà produit avec `npm run deploy:web:local -- -SkipBuild`, exécute `npm run test:smoke` et vérifie que le site actif répond correctement. Ne déclare l’événement terminé que lorsque le commit distant et le site actif correspondent bien aux changements validés. Si GitHub, le serveur web ou une configuration indispensable est indisponible, arrête-toi avec un diagnostic précis sans contourner les garde-fous.",
    initialMemory: "La cible web par défaut est le nœud local http://127.0.0.1:8080. Conserver pour chaque livraison le commit poussé, les validations exécutées et la preuve que le site actif répond. Ne jamais utiliser force push et ne jamais inclure de secret.",
    mode: "build",
    intervalSeconds: 60,
    triggerKind: "workspace_change",
    watchPaths: [
      "src",
      "src-tauri/src",
      "src-tauri/Cargo.toml",
      "src-tauri/Cargo.lock",
      "public",
      "scripts",
      "deploy",
      "tests",
      ".github",
      "index.html",
      "package.json",
      "package-lock.json",
      "vite.config.ts",
      "tsconfig.json",
      "README.md",
    ],
    debounceSeconds: 120,
    allowGitPublish: true,
    testCommand: "npm run verify:published-build",
    requireUserReview: false,
    icon: "rocket",
    tone: "deploy",
    policyLabel: "Événement · Git push et publication autorisés",
  },
];

export const autonomousAgentTemplateById = (
  value: unknown,
): AutonomousAgentTemplate | undefined =>
  AUTONOMOUS_AGENT_TEMPLATES.find((template) => template.id === value);

export const autonomousStatusLabel = (status: AutonomousAgentStatus): string => {
  switch (status) {
    case "active":
      return "Actif";
    case "paused":
      return "En pause";
    case "completed":
      return "Terminé";
    case "needs_attention":
      return "Attention requise";
  }
};

export const autonomousStatusTone = (status: AutonomousAgentStatus): string => {
  switch (status) {
    case "active":
      return "active";
    case "paused":
      return "paused";
    case "completed":
      return "completed";
    case "needs_attention":
      return "warning";
  }
};

export const formatAutonomousInterval = (seconds: number): string => {
  const safe = Math.max(60, Math.floor(Number.isFinite(seconds) ? seconds : 60));
  if (safe < 3_600) return `${Math.round(safe / 60)} min`;
  if (safe < 86_400) {
    const hours = Math.floor(safe / 3_600);
    const minutes = Math.floor((safe % 3_600) / 60);
    return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(safe / 86_400);
  const hours = Math.floor((safe % 86_400) / 3_600);
  return hours ? `${days} j ${hours} h` : `${days} j`;
};

export const formatAutonomousSchedule = (
  agent: AutonomousAgentSnapshot,
  now = Date.now() / 1000,
): string => {
  if (agent.currentTestId != null) return "Validation des tests en cours";
  if (agent.currentStartId != null) return "Démarrage du prochain tour";
  if (agent.currentTurnId != null) return `Travail en cours · tour #${agent.currentTurnId}`;
  if (agent.status === "paused") return "Aucune exécution pendant la pause";
  if (agent.status === "completed") return "Objectif terminé";
  if (agent.status === "needs_attention") return "En attente d'une intervention";
  if ((agent.triggerKind ?? "schedule") === "workspace_change") {
    if (agent.nextRunAt != null && agent.modelCapacityRetryCount > 0) {
      const remaining = Math.max(0, Math.ceil(agent.nextRunAt - now));
      return `Modèle saturé · nouvel essai dans ${remaining} s · tentative #${agent.modelCapacityRetryCount}`;
    }
    if (agent.nextRunAt != null) return "Modification stable · réveil imminent";
    if (agent.eventCandidateSince != null) {
      const remaining = Math.max(
        0,
        Math.ceil((agent.debounceSeconds ?? 10) - (now - agent.eventCandidateSince)),
      );
      return remaining > 0
        ? `Modification détectée · stabilisation ${remaining} s`
        : "Modification stable · préparation du réveil";
    }
    if (agent.triggerError) return "Veille interrompue · déclencheur à vérifier";
    return "En veille · attend une modification";
  }
  if (agent.nextRunAt == null) return "Planification en cours";
  const remaining = Math.max(0, Math.ceil(agent.nextRunAt - now));
  if (remaining === 0) return "Démarrage imminent";
  if (agent.modelCapacityRetryCount > 0) {
    return `Modèle saturé · nouvel essai dans ${remaining} s · tentative #${agent.modelCapacityRetryCount}`;
  }
  return `Prochaine étape dans ${formatAutonomousInterval(remaining)}`;
};

export const autonomousTriggerLabel = (
  agent: Pick<AutonomousAgentSnapshot, "triggerKind">,
): string =>
  (agent.triggerKind ?? "schedule") === "workspace_change"
    ? "Modification du projet"
    : "Planification récurrente";

export const autonomousAgentIsRunning = (agent: AutonomousAgentSnapshot): boolean =>
  agent.status === "active"
  && (agent.currentStartId != null || agent.currentTurnId != null || agent.currentTestId != null);

export const autonomousAgentsToPause = (
  agents: readonly AutonomousAgentSnapshot[],
): AutonomousAgentSnapshot[] =>
  agents.filter((agent) => agent.status === "active" && !agent.systemManaged);

export const autonomousTestStatusLabel = (status: AutonomousTestStatus): string => {
  switch (status) {
    case "not_configured":
      return "Sans test";
    case "idle":
      return "Prêt";
    case "running":
      return "En cours";
    case "passed":
      return "Réussi";
    case "failed":
      return "Échoué";
    case "cancelled":
      return "Annulé";
  }
};

export const autonomousMemoryKindLabel = (kind: AutonomousMemoryKind): string => {
  switch (kind) {
    case "user":
      return "Vous";
    case "agent":
      return "Agent";
    case "test":
      return "Test";
    case "supervisor":
      return "Superviseur";
  }
};

export const autonomousWorkItemStatusLabel = (status: AutonomousWorkItemStatus): string => {
  switch (status) {
    case "todo":
      return "À faire";
    case "in_progress":
      return "En cours";
    case "done":
      return "Fait";
    case "blocked":
      return "Bloqué";
    case "cancelled":
      return "Annulé";
  }
};

export const autonomousWorkPlanProgress = (
  agent: Pick<AutonomousAgentSnapshot, "workItems">,
): { done: number; remaining: number; total: number } => {
  const active = (agent.workItems ?? []).filter((item) => item.status !== "cancelled");
  const done = active.filter((item) => item.status === "done").length;
  return { done, remaining: active.length - done, total: active.length };
};

export const autonomousReviewKindLabel = (kind: AutonomousReviewKind): string => {
  switch (kind) {
    case "approval":
      return "Autorisation";
    case "decision":
      return "Décision";
    case "verification":
      return "Vérification";
  }
};
