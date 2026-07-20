export const BUG_REPORT_SOURCE_PREFIX = "bug-report:";

export const BUG_REPORT_SEVERITIES = [
  { value: "blocking", label: "Bloquant", description: "Empêche de continuer ou entraîne une perte de données." },
  { value: "high", label: "Élevée", description: "Fonction importante inutilisable, sans solution simple." },
  { value: "medium", label: "Moyenne", description: "Comportement gênant avec un contournement possible." },
  { value: "low", label: "Faible", description: "Défaut mineur, visuel ou occasionnel." },
] as const;

export type BugReportSeverity = (typeof BUG_REPORT_SEVERITIES)[number]["value"];

export type BugReportDraft = {
  title: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  severity: BugReportSeverity;
  accountId: string;
  projectDir: string;
  testCommand: string;
  requireUserReview: boolean;
};

export type BugReportAgentLike = {
  sourceChatKey?: string | null;
  name?: string | null;
};

export const emptyBugReportDraft = (): BugReportDraft => ({
  title: "",
  description: "",
  steps: "",
  expected: "",
  actual: "",
  severity: "medium",
  accountId: "",
  projectDir: "",
  testCommand: "",
  requireUserReview: false,
});

export const bugReportSeverityLabel = (severity: BugReportSeverity): string =>
  BUG_REPORT_SEVERITIES.find((candidate) => candidate.value === severity)?.label ?? "Moyenne";

export const createBugReportSourceKey = (id: string): string => {
  const normalized = id.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${BUG_REPORT_SOURCE_PREFIX}${normalized || "report"}`;
};

export const isBugReportAgent = (agent: BugReportAgentLike): boolean =>
  agent.sourceChatKey?.startsWith(BUG_REPORT_SOURCE_PREFIX) ?? false;

export const bugReportTitleFromAgent = (agent: BugReportAgentLike): string => {
  const name = agent.name?.trim() ?? "";
  return name.replace(/^Bug\s*[·:-]\s*/i, "").trim() || "Bug signalé";
};

const section = (label: string, content: string): string => {
  const normalized = content.trim();
  return normalized ? `${label}\n${normalized}` : "";
};

/**
 * Transforme le formulaire en mission autonome explicite. Le texte demande une
 * reproduction et une preuve de validation afin qu'un simple symptôme ne
 * déclenche pas une modification hasardeuse du projet.
 */
export const buildBugReportObjective = (draft: BugReportDraft): string => {
  const severity = bugReportSeverityLabel(draft.severity);
  const report = [
    `Titre\n${draft.title.trim()}`,
    `Gravité\n${severity}`,
    section("Description du problème", draft.description),
    section("Étapes de reproduction", draft.steps),
    section("Résultat attendu", draft.expected),
    section("Résultat observé", draft.actual),
  ].filter(Boolean).join("\n\n");

  return `Tu traites un bug précis signalé par l'utilisateur dans Codex Switch Terminal.\n\n${report}\n\nMission\n1. Inspecte le projet et reproduis le bug, ou établis une preuve fiable de sa cause avant toute modification.\n2. Identifie la cause racine et applique le plus petit correctif sûr, sans écraser les changements déjà présents dans le dossier de travail.\n3. Ajoute ou renforce un test de non-régression adapté au bug.\n4. Exécute les validations pertinentes${draft.testCommand.trim() ? `, notamment \`${draft.testCommand.trim()}\`` : ""}, puis vérifie le comportement concerné.\n5. Résume la cause, les fichiers modifiés et les preuves de validation. Lorsque le correctif est réellement vérifié, marque cet objectif comme terminé afin d'arrêter les relances en arrière-plan.\n\nGarde-fous\n- Ne publie rien, ne pousse aucun commit et ne contacte aucun service externe.\n- Ne modifie rien si le bug ne peut pas être démontré ; consigne alors un diagnostic précis et ce qui manque pour continuer.\n- Reste strictement dans le périmètre de ce signalement.`;
};
