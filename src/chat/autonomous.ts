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

export type AutonomousReviewRequest = {
  id: string;
  kind: AutonomousReviewKind;
  request: string;
  createdAt: number;
  externalAction?: boolean;
};

export type AutonomousMemoryKind = "user" | "agent" | "test";

export type AutonomousMemoryEntry = {
  id: string;
  kind: AutonomousMemoryKind;
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

export type AutonomousAgentSnapshot = {
  id: string;
  systemManaged?: boolean;
  name: string;
  objective: string;
  role?: string | null;
  sourceChatKey?: string | null;
  accountId: string;
  projectDir?: string | null;
  sessionId?: string | null;
  mode: "build" | "plan" | "ask";
  model?: string | null;
  reasoningEffort?: string | null;
  connectors: AutonomousConnectorId[];
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
  consecutiveFailures: number;
  modelCapacityRetryCount: number;
  lastError?: string | null;
  lastSummary?: string | null;
  requireUserReview?: boolean;
  pendingReview?: AutonomousReviewRequest | null;
  approvedReview?: AutonomousReviewRequest | null;
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
    objective: "Analyse en continu l’architecture, les fonctionnalités, les tests, la documentation et les changements récents du projet. À chaque tour, vérifie d’abord ce qui a réellement changé. Propose au maximum trois idées nouvelles et réalisables, chacune accompagnée du problème observé, de preuves précises dans le projet, du bénéfice attendu, de l’effort estimé et d’un niveau de confiance. Ne fabrique aucune suggestion si rien de suffisamment pertinent n’a changé, ne répète jamais une idée déjà enregistrée et ne modifie aucun fichier.",
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
    description: "Dort jusqu’à une modification stable du projet, puis valide, pousse sur GitHub et active le nouveau frontend sur le site.",
    role: "Ingénieur de livraison prudent, responsable de la validation, du push Git non destructif, de la publication atomique et de la vérification du site.",
    objective: "À chaque réveil provoqué par une modification du projet, inspecte précisément les changements Git et ne publie que des fichiers appartenant au projet. Refuse tout secret, cache, artefact lourd ou fichier sans rapport. Exécute `npm run verify:quick`, puis `npm run build:frontend`. Si les validations réussissent, crée un commit descriptif sans réécrire l’historique et pousse la branche courante avec `git push origin HEAD` (jamais de force push). Publie ensuite le build déjà produit avec `npm run deploy:web:local -- -SkipBuild`, exécute `npm run test:smoke` et vérifie que le site actif répond correctement. Ne déclare l’événement terminé que lorsque le commit distant et le site actif correspondent bien aux changements validés. Si GitHub, le serveur web ou une configuration indispensable est indisponible, arrête-toi avec un diagnostic précis sans contourner les garde-fous.",
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
    debounceSeconds: 12,
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
