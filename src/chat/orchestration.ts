export type OrchestrationStatus = "active" | "paused" | "completed" | "needs_attention";

export type OrchestrationPhase =
  | "planning"
  | "working"
  | "reviewing"
  | "validating"
  | "final_review"
  | "final_validation"
  | "publishing"
  | "completed";

export type OrchestrationTaskStatus =
  | "pending"
  | "working"
  | "submitted"
  | "reviewing"
  | "validating"
  | "revision_requested"
  | "accepted";

export type OrchestrationProofTest = {
  command: string;
  result: string;
  passed: boolean;
};

export type OrchestrationProof = {
  summary: string;
  filesChanged: string[];
  tests: OrchestrationProofTest[];
  risks: string[];
  submittedAt: number;
};

export type OrchestrationReview = {
  decision: "accept" | "revise";
  summary: string;
  feedback: string;
  tests: OrchestrationProofTest[];
  createdAt: number;
};

export type OrchestrationTask = {
  id: string;
  position: number;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  status: OrchestrationTaskStatus;
  /** Compte affecte a ce worker. Absent uniquement sur les anciens snapshots. */
  accountId?: string;
  /** Une reprise par transcript sera injectee au prochain tour de ce worker. */
  handoffPending?: boolean;
  handoffCount?: number;
  sessionId: string | null;
  workspaceDir: string | null;
  baseCommit: string | null;
  workspaceGeneration: number;
  attemptCount: number;
  protocolFailures: number;
  evidence: OrchestrationProof | null;
  reviews: OrchestrationReview[];
  lastError: string | null;
};

export type OrchestrationEvent = {
  timestamp: number;
  kind: string;
  message: string;
};

export type OrchestrationSnapshot = {
  id: string;
  name: string;
  objective: string;
  /** Nombre de travailleurs choisis, sans compter l'orchestrateur. */
  workerCount: number;
  /** `accountId` reste le repli des snapshots crees avant les affectations par role. */
  accountId: string;
  orchestratorAccountId?: string;
  workerAccountIds?: string[];
  orchestratorHandoffPending?: boolean;
  orchestratorHandoffCount?: number;
  projectDir: string;
  model: string | null;
  reasoningEffort: string | null;
  testCommand: string;
  testTimeoutSeconds: number;
  status: OrchestrationStatus;
  phase: OrchestrationPhase;
  createdAt: number;
  updatedAt: number;
  baseCommit: string;
  integratedCommit: string;
  sandboxRoot: string;
  orchestratorDir: string;
  orchestratorSessionId: string | null;
  currentTurnId: number | null;
  currentTurnKind: "plan" | "worker" | "review" | "final_review" | null;
  currentTaskId: string | null;
  currentStartId: string | null;
  currentValidationId: string | null;
  currentValidationKind: "task" | "final" | null;
  nextActionAt: number | null;
  planSummary: string | null;
  tasks: OrchestrationTask[];
  finalSummary: string | null;
  lastError: string | null;
  consecutiveStartFailures: number;
  protocolFailures: number;
  publishApplied: boolean;
  events: OrchestrationEvent[];
};

export type OrchestrationAction = "pause" | "resume" | "retry";

export type OrchestrationAccountRole = "orchestrator" | "worker";

export const orchestrationOrchestratorAccountId = (
  run: Pick<OrchestrationSnapshot, "accountId" | "orchestratorAccountId">,
): string => run.orchestratorAccountId?.trim() || run.accountId;

export const orchestrationWorkerAccountId = (
  run: Pick<OrchestrationSnapshot, "accountId" | "workerAccountIds">,
  task: Pick<OrchestrationTask, "position" | "accountId">,
): string =>
  task.accountId?.trim()
  || run.workerAccountIds?.[Math.max(0, task.position - 1)]?.trim()
  || run.accountId;

export const orchestrationStatusLabel = (status: OrchestrationStatus): string => {
  switch (status) {
    case "active":
      return "En cours";
    case "paused":
      return "En pause";
    case "completed":
      return "Rendu";
    case "needs_attention":
      return "Attention requise";
  }
};

export const orchestrationPhaseLabel = (phase: OrchestrationPhase): string => {
  switch (phase) {
    case "planning":
      return "Planification par l’orchestrateur";
    case "working":
      return "Travail des agents";
    case "reviewing":
      return "Revue dans le sandbox orchestrateur";
    case "validating":
      return "Validation réelle de la contribution";
    case "final_review":
      return "Audit final";
    case "final_validation":
      return "Validation finale";
    case "publishing":
      return "Application du rendu";
    case "completed":
      return "Projet rendu";
  }
};

export const orchestrationTaskStatusLabel = (status: OrchestrationTaskStatus): string => {
  switch (status) {
    case "pending":
      return "Chat en attente";
    case "working":
      return "Agent au travail";
    case "submitted":
      return "Preuve soumise";
    case "reviewing":
      return "Revue orchestrateur";
    case "validating":
      return "Tests réels";
    case "revision_requested":
      return "Correction demandée";
    case "accepted":
      return "Acceptée et intégrée";
  }
};

export const orchestrationProgress = (
  run: Pick<OrchestrationSnapshot, "tasks" | "phase">,
): { accepted: number; total: number; percent: number } => {
  const total = run.tasks.length;
  const accepted = run.tasks.filter((task) => task.status === "accepted").length;
  if (!total) return { accepted, total, percent: run.phase === "planning" ? 0 : 100 };
  return { accepted, total, percent: Math.round((accepted / total) * 100) };
};

export const orchestrationIsRunning = (
  run: Pick<
    OrchestrationSnapshot,
    "status" | "currentTurnId" | "currentStartId" | "currentValidationId"
  >,
): boolean =>
  run.status === "active"
  && (run.currentTurnId != null || run.currentStartId != null || run.currentValidationId != null);
