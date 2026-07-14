import {
  appWindow,
  hasRemoteAuth,
  initializePlatform,
  invoke,
  isRemoteMode,
  listen,
  remoteBaseUrl,
  remoteNodesText,
  saveRemoteConfig,
  subscribeDiscussionUpdates,
  type DiscussionStreamMessage,
  type RealtimeConnectionState,
  type UnlistenFn,
} from "./platform";
import { initPwaSupport } from "./pwa";
import {
  bindUserAccountUi,
  initializeUserAuth,
  renderUserAccountButton,
  renderUserAuthGate,
  renderUserProfileModal,
} from "./user-auth";
import {
  chatHoverShortcutAction,
  type ChatHoverShortcutAction,
} from "./chat/shortcuts";
import {
  DEFAULT_KEYBOARD_SHORTCUTS,
  KEYBOARD_SHORTCUT_DEFINITIONS,
  KEYBOARD_SHORTCUT_GROUPS,
  formatKeyboardShortcut,
  keyboardShortcutConflict,
  keyboardShortcutDisplayParts,
  keyboardShortcutFromEvent,
  keyboardShortcutMatches,
  loadKeyboardShortcutOverrides,
  persistKeyboardShortcutOverrides,
  resolveKeyboardShortcuts,
  withKeyboardShortcutOverride,
  type KeyboardShortcutId,
  type KeyboardShortcutOverrides,
} from "./keyboard-shortcuts";
import {
  CHAT_AGENT_TOOLS,
  chatAgentToolLabel,
  chatSkillToolDefinition,
  isChatAgentModeId,
  isChatAgentToolId,
  migratePersistedChatAgentTools,
  toggleChatAgentTool,
  type ChatAgentToolDefinition,
  type ChatAgentToolId,
} from "./chat/agent-tools";
import { bindVoiceComposer } from "./chat/voice";
import {
  chatSyncLabel,
  renderChatFeedInner,
  renderChatPanel,
  renderChatRuntimeStatus,
  renderChatTurnParts,
  renderChatTurnStatus,
  type ChatActivity,
  type ChatPart,
  type ChatThought,
  type ChatMode,
  type ChatMessage,
  type ChatPanelModel,
  type ChatQuotaSuggestion,
  type ChatQuotaStatus,
  type ChatSyncState,
  type ChatTurnStatus,
} from "./chat/view";
import {
  bestQuotaAccount,
  bestQuotaAccountForNewChat,
  deduplicateQuotaAccountsForDisplay,
  isQuotaExhaustionError,
  OPEN_CHAT_QUOTA_RESERVATION_PERCENT,
  quotaAfterOpenChatReservations,
  remainingQuotaPercent,
  shouldRecoverRunningQuotaTurn,
} from "./chat/quota";
import {
  MODEL_CAPACITY_RETRY_LIMIT,
  isModelCapacityError,
  modelCapacityRetryDelayMs,
  modelCapacityRetryPrompt,
} from "./chat/capacity";
import { accountCatalogMatchesLimitRows } from "./chat/accounts";
import {
  AUTONOMOUS_AGENT_TEMPLATES,
  AUTONOMOUS_CONNECTORS,
  AUTONOMOUS_INTERVAL_OPTIONS,
  autonomousAgentIsRunning,
  autonomousAgentTemplateById,
  autonomousConnectorLabel,
  autonomousInitialMemoryFromChat,
  autonomousMemoryKindLabel,
  autonomousReviewKindLabel,
  autonomousStatusLabel,
  autonomousStatusTone,
  autonomousTestStatusLabel,
  autonomousTriggerLabel,
  autonomousWorkItemStatusLabel,
  autonomousWorkPlanProgress,
  formatAutonomousInterval,
  formatAutonomousSchedule,
  isAutonomousConnectorId,
  isAutonomousTriggerKind,
  normalizeAutonomousConnectors,
  parseAutonomousWatchPaths,
  toggleAutonomousConnector,
  type AutonomousAgentAction,
  type AutonomousAgentSnapshot,
  type AutonomousAgentTemplateId,
  type AutonomousConnectorId,
  type AutonomousReviewRequest,
  type AutonomousTriggerKind,
} from "./chat/autonomous";
import {
  orchestrationIsRunning,
  orchestrationOrchestratorAccountId,
  orchestrationPhaseLabel,
  orchestrationProgress,
  orchestrationStatusLabel,
  orchestrationTaskStatusLabel,
  orchestrationWorkerAccountId,
  type OrchestrationAction,
  type OrchestrationAccountRole,
  type OrchestrationSnapshot,
  type OrchestrationTask,
} from "./chat/orchestration";
import {
  chatMessagesEqual,
  chatTurnIsBusy,
  conversationWaitsForUser,
  createGoalPrompt,
  formatChatDuration,
  formatChatResetCountdown,
  markLatestPendingMessageFailed,
  partWaitsForUserInput,
  reconcileChatMessages,
  shouldAdoptActiveChatTurn,
} from "./chat/runtime";
import {
  pauseChatScrollFollow,
  restoreChatScrollTop,
  updateChatScrollState,
  type ChatScrollState,
} from "./chat/scroll";
import {
  CHAT_SIDEBAR_DEFAULT_WIDTH,
  CHAT_SIDEBAR_MAX_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
  activeChatTurnForDiscussion,
  chatSidebarStatus,
  chatSidebarStatusLabel,
  chatSidebarMaxWidth,
  clampChatSidebarWidth,
  defaultChatSidebarWidth,
  discussionForSession,
  orderChatSidebarDiscussions,
} from "./chat/sidebar";
import {
  DEFAULT_EXPERT_CHAT_DISPLAY_MODE,
  DEFAULT_EXPERT_CHAT_PAGE_SIZE_MODE,
  clampExpertChatPage,
  expertChatGridDimensions,
  expertChatPageCount,
  expertChatPageForIndex,
  expertChatsForDisplay,
  expertChatsOnPage,
  normalizeExpertChatDisplayMode,
  normalizeExpertChatPageSizeMode,
  resolveExpertChatPageSize,
  type ExpertChatDisplayMode,
  type ExpertChatPageSizeMode,
  type ExpertGridLayout,
} from "./chat/expert";
import {
  closeWorkspaceRegistry,
  draftEnvironmentChatPanes,
  mergeClosedWorkspaceIds,
  mergeWorkspaceProfiles,
  normalizeWorkspacePath,
  openWorkspaceRegistry,
  setWorkspaceMemory,
  terminalsForFolder,
  userEnvironmentPath,
  workspaceBaseName,
  workspaceIdForPath,
  workspacePathBreadcrumbs,
  type WorkspaceProfile,
} from "./workspace";
import {
  STATS_RANGE_OPTIONS,
  WORK_TIME_GRANULARITY_OPTIONS,
  accountTokenUsageForDate,
  buildAccountTokenSeries,
  buildWorkTimeBuckets,
  deduplicateAccountTokenAccounts,
  sumTokenUsage,
  type DailyTokenUsage,
  type StatsRangeDays,
  type WorkTimeBucket,
  type WorkTimeDay,
  type WorkTimeGranularity,
} from "./stats";
import {
  appendDoctolibLabMessage,
  createDoctolibLabState,
  interpretDoctolibLabMessage,
  renderDoctolibLabPanel,
  selectedDoctolibLabProposal,
  type DoctolibLabConfirmation,
  type DoctolibLabSearchResponse,
  type DoctolibLabStatus,
} from "./doctolib-lab";
import {
  loadTaskItems,
  mountTasksPanel,
  renderTasksPanel,
  taskItemsForEnvironment,
  taskStats,
  type TaskEnvironment,
  type TaskItem,
} from "./tasks";
import {
  mountPromptLibraryPanel,
  renderPromptLibraryPanel,
  type PromptLibraryItem,
} from "./prompts";
import {
  claimScheduledChatItem,
  dueScheduledChatItems,
  loadScheduledChatItems,
  markScheduledChatFailed,
  markScheduledChatLaunched,
  mountScheduledChatsPanel,
  nextScheduledChatAt,
  persistScheduledChatItems,
  recoverInterruptedScheduledChats,
  renderScheduledChatsPanel,
  scheduledChatPendingCount,
  scheduledChatTitle,
  syncScheduledChatNavigationBadges,
  type ScheduledChatItem,
  type ScheduledChatsPanelOptions,
} from "./scheduled-chats";
import {
  applyThemeToDocument,
  loadTheme,
  oppositeTheme,
  persistTheme,
  terminalThemeFor,
  type ThemeMode,
} from "./theme";
import {
  chatBecameAvailable,
  loadChatReadySoundPreferences,
  persistChatReadySoundPreferences,
  playChatReadySound,
  readChatReadySoundFile,
  unlockChatReadySound,
  type ChatReadySoundPreferences,
} from "./chat/ready-sound";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import {
  Activity,
  AppWindow,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowUpRight,
  BadgeCheck,
  BarChart3,
  BellOff,
  BellRing,
  Bot,
  BrainCircuit,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  CopyCheck,
  FlaskConical,
  FolderOpen,
  GitBranch,
  History,
  Info,
  Keyboard,
  LayoutGrid,
  List,
  ListPlus,
  ListTree,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Maximize2,
  Minimize2,
  Play,
  PlugZap,
  Plus,
  Power,
  Radar,
  Radio,
  RefreshCcw,
  Save,
  Server,
  Shuffle,
  SquareTerminal,
  Stethoscope,
  Star,
  Sun,
  Tag,
  Target,
  Trash2,
  Upload,
  Unplug,
  Users,
  X,
  Copy,
  Cpu,
  Gauge,
  MessagesSquare,
  Music2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ScanEye,
  FolderX,
  Library,
  ListChecks,
  MessageCircleQuestion,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareText,
  Mic,
  Square,
  Reply,
  RotateCcw,
  Wrench,
  Settings,
  Settings2,
  Folder,
  FolderPlus,
  Folders,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pause,
  Pencil,
  ShieldQuestion,
  TriangleAlert,
  Moon,
  UserPlus,
  createElement as createLucideElement,
  type IconNode,
} from "lucide";
import "./style.css";
import "./theme.css";

type CodexReasoningEffort = string;

// Fournisseur CLI d'un compte / agent. Absent des configs anterieures => Codex.
type Provider = "codex" | "claude";

type AccountProfile = {
  id: string;
  label: string;
  // Date d'ajout (secondes Unix). Absente sur les comptes historiques, qui ne
  // sont jamais concernes par l'expiration de premiere connexion.
  createdAt?: number | null;
  // Fournisseur CLI de ce compte. Optionnel pour la retro-compat (defaut Codex).
  provider?: Provider;
  codexHome: string;
  projectDir?: string | null;
  proxyId?: string | null;
  startupCommand?: string | null;
  limits?: AccountLimitTracking;
  // Bypass Codex par compte (defaut ON). Absent des configs anterieures : on
  // retombe alors sur le defaut global `codexBypass`, puis `true`.
  bypass?: boolean;
  // Preferences Codex propres a ce CODEX_HOME. Optionnelles pour rester
  // compatible avec les settings.json crees avant leur introduction.
  model?: string | null;
  reasoningEffort?: CodexReasoningEffort | null;
};

const DEFAULT_CODEX_MODEL = "gpt-5.6-sol";
const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "medium";
// Claude Code : alias de modele (pas d'intensite de raisonnement).
const DEFAULT_CLAUDE_MODEL = "sonnet";
const CLAUDE_MODEL_SUGGESTIONS = [
  "sonnet",
  "opus",
  "haiku",
  "claude-sonnet-4-5",
  "claude-opus-4-1",
];
const CODEX_MODEL_SUGGESTIONS = [
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
];
const CODEX_REASONING_EFFORTS: Array<{ value: CodexReasoningEffort; label: string }> = [
  { value: "minimal", label: "Minimale" },
  { value: "low", label: "Faible" },
  { value: "medium", label: "Moyenne" },
  { value: "high", label: "Elevee" },
  { value: "xhigh", label: "Tres elevee" },
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

type ModelReasoningEffortView = {
  reasoningEffort: string;
  description?: string | null;
};

type AccountModelView = {
  id: string;
  displayName: string;
  defaultReasoningEffort?: string | null;
  supportedReasoningEfforts: ModelReasoningEffortView[];
};

type AccountLimitTracking = {
  connectedAt?: number | null;
  sessionAnchorAt?: number | null;
  weeklyAnchorAt?: number | null;
};

type ProxyProfile = {
  id: string;
  label: string;
  proxyUrl: string;
  note?: string | null;
};

type AgentKind = "cli" | "ide";

type AgentProfile = {
  id: string;
  label: string;
  command: string;
  provider?: Provider;
  kind?: AgentKind;
  builtin?: boolean;
  loginCommand?: string | null;
  statusCommand?: string | null;
  doctorCommand?: string | null;
};

// Lanceurs d'editeurs connus qui hebergent l'extension Kombai. Tous ouvrent un
// dossier via `<cmd> <chemin>`.
const KNOWN_IDE_COMMANDS = ["code", "cursor", "windsurf", "trae", "antigravity", "kiro"];

type KombaiConfig = {
  codeServerCommand: string;
  port: number;
  extensionId: string;
  autoInstallExtension: boolean;
};

type KombaiStatus = {
  running: boolean;
  started: boolean;
  url?: string | null;
  port: number;
  projectDir?: string | null;
  command: string;
  binaryAvailable: boolean;
  extensionId: string;
  message?: string | null;
};

type VoiceGpuStatus = {
  index: number;
  name: string;
  utilizationPercent: number;
  memoryUsedMb: number;
  memoryTotalMb: number;
};

type VoiceRuntimeStatus = {
  mode: "local" | "remote";
  state: "active" | "loaded" | "inactive" | "unavailable";
  stage: "idle" | "transcribing" | "summarizing";
  activeLocation?: "local" | "remote" | null;
  transcriptionModel: string;
  summaryModel: string;
  transcriptionTarget: "local" | "remote";
  summaryTarget: "local" | "remote" | "unknown";
  whisperReady: boolean;
  ollamaReachable: boolean;
  summaryModelLoaded: boolean;
  summaryModelOnGpu: boolean;
  summaryModelVramMb?: number | null;
  gpu?: VoiceGpuStatus | null;
  lastActivityAt?: number | null;
  warning?: string | null;
};

// Entree/reponse du navigateur de dossiers du serveur (mode web). En desktop on
// utilise le dialogue natif (`pick_project_dir`), pas cette API.
type FsEntry = { name: string; path: string; isDir: boolean };
type FsListResponse = {
  root: string;
  path: string;
  parent: string | null;
  entries: FsEntry[];
};

type AppSettings = {
  accounts: AccountProfile[];
  proxies: ProxyProfile[];
  defaultAccountId?: string | null;
  shell: string;
  codexCommand: string;
  autoRunCodex: boolean;
  proxyControlsEnabled: boolean;
  pool: PoolConfig;
  agents: AgentProfile[];
  activeAgentId?: string | null;
  kombai: KombaiConfig;
  codexBypass: boolean;
  autoDiscoverAccounts: boolean;
  // Empeche l'auto-decouverte de recreer un profil expire a partir de son
  // dossier de configuration reste sur le disque.
  expiredUnconnectedAccountHomes?: string[];
  // Registre synchronise des workspaces (dossiers projets ouverts). Optionnel
  // pour la retro-compat : un settings.json anterieur ne le porte pas encore.
  // Le workspace ACTIF reste local a l'appareil (WORKSPACE_STORAGE_KEY) : seule
  // la LISTE se synchronise entre appareils.
  workspaces?: WorkspaceProfile[];
  // Tombstones synchronises : une ancienne discussion ne doit pas rouvrir un
  // workspace que l'utilisateur a explicitement ferme.
  closedWorkspaceIds?: string[];
};

type PoolConfig = {
  port: number;
  apiKey: string;
  defaultModel: string;
  reasoningEffort: string;
  upstream: string;
  requestTimeoutSecs: number;
  cooldownSecs429: number;
  concurrency: number;
  clientIdOverride: string;
};

type PoolAccountView = {
  id: string;
  label: string;
  codexHome: string;
  hasProxy: boolean;
  proxyMasked: string;
  accountId: string;
  hasTokens: boolean;
  hasRefreshToken: boolean;
  oauthClient: string;
  accessExp?: number | null;
  status: string;
  cooldownUntil?: number | null;
  lastUsed?: number | null;
  served: number;
  errors: number;
  lastError?: string | null;
};

type PoolStatus = {
  running: boolean;
  startedAt?: number;
  baseUrl?: string;
  model?: string;
  upstream?: string;
  total?: number;
  idle?: number;
  accounts?: PoolAccountView[];
};

type UsageDayView = {
  date: string;
  agentRunSeconds: number;
  agentRuns: number;
  apiRequests: number;
  apiErrors: number;
  apiSeconds: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedRequests: number;
  costUsd: number;
};

type UsageDashboard = {
  generatedAt: number;
  totalAgentSeconds: number;
  totalAgentRuns: number;
  activeAgentCount: number;
  totalApiRequests: number;
  totalApiErrors: number;
  totalTokens: number;
  totalCostUsd: number;
  today: UsageDayView;
  days: UsageDayView[];
};

type AccountUsageDay = {
  date: string;
  sessions: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
};

type AccountUsageView = {
  id: string;
  label: string;
  profileLabels: string[];
  codexHome: string;
  hasTokens: boolean;
  usageSource: "codex-account" | "local-sessions" | "unavailable";
  sourceError?: string | null;
  sessionCount: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  costUsd: number;
  todayTokens: number;
  todayCostUsd: number;
  monthTokens: number;
  monthCostUsd: number;
  firstActivity?: number | null;
  lastActivity?: number | null;
  days: AccountUsageDay[];
  error?: string | null;
};

type AccountUsageDashboard = {
  generatedAt: number;
  profileCount: number;
  totalTokens: number;
  totalCostUsd: number;
  totalSessions: number;
  accounts: AccountUsageView[];
};

type WorkTimeDashboard = {
  generatedAt: number;
  totalSeconds: number;
  trackedChats: number;
  trackedTurns: number;
  firstActivity?: number | null;
  lastActivity?: number | null;
  days: WorkTimeDay[];
};

type AccountLimitView = {
  id: string;
  label: string;
  provider: Provider;
  codexHome: string;
  hasTokens: boolean;
  connectedAt?: number | null;
  sessionResetAt?: number | null;
  weeklyResetAt?: number | null;
  sessionRemainingSecs?: number | null;
  weeklyRemainingSecs?: number | null;
  sessionUsedPercent?: number | null;
  weeklyUsedPercent?: number | null;
  buckets: AccountRateLimitBucketView[];
  refreshedAt?: number | null;
  source: string;
  error?: string | null;
};

type AccountRateLimitBucketView = {
  limitId: string;
  limitName?: string | null;
  bucket: string;
  windowDurationMins: number;
  resetsAt: number;
  usedPercent?: number | null;
  rateLimitReachedType?: string | null;
  planType?: string | null;
};

type PtyDataEvent = {
  id: number;
  data: string;
};

type PtyExitEvent = {
  id: number;
};

type TerminalStartResponse = {
  id: number;
  workspaceId: string;
  workspacePath: string;
};

type TerminalSession = {
  key: string;
  ptyId: number | null;
  accountId: string;
  agentId: string;
  title: string;
  // Un terminal d'authentification est temporaire : il ne doit jamais etre
  // restaure comme un terminal de travail au prochain login / rechargement.
  loginOnly: boolean;
  // Dossier choisi par l'utilisateur et utilise directement par le terminal.
  folderPath: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
  projectDir: string | null;
  proxySummary: string;
  status: string;
  running: boolean;
  startedAtUnix: number | null;
  codexSessionId: string | null;
  resumeSessionId: string | null;
  sessionCaptureDone: boolean;
  terminal: Terminal;
  fitAddon: FitAddon;
};

type PersistedTerminalRecord = {
  key: string;
  accountId: string;
  agentId: string;
  codexSessionId?: string | null;
  folderPath?: string | null;
  workspaceId?: string | null;
  workspacePath?: string | null;
  projectDir?: string | null;
};

type PersistedTerminalState = {
  v: 4;
  activeKey: string | null;
  terminals: PersistedTerminalRecord[];
};

type AppView =
  | "terminal"
  | "tasks"
  | "prompts"
  | "scheduled-chat"
  | "pool"
  | "limits"
  | "dashboard"
  | "kombai"
  | "doctolib-lab"
  | "autonomous"
  | "orchestration"
  | "discussions"
  | "history"
  | "audit"
  | "skills"
  | "settings"
  | "chat";

type DiscussionSummary = {
  // Identite LOGIQUE de la conversation (stable a travers les reprises/forks).
  // Sert de cle de regroupement et de suppression.
  sessionId: string;
  // Identite du fichier rollout HEAD (le plus recent). Cible de `codex resume`
  // et de la copie vers un autre compte.
  rolloutId: string;
  // Nombre de fichiers rollout regroupes sous ce sessionId (>1 = repris).
  forkCount: number;
  // Fournisseur d'origine (codex/claude) : badge + routage de la continuation.
  provider?: Provider;
  accountId: string;
  accountLabel: string;
  codexHome: string;
  filePath: string;
  // Dossier restaure par l'UI et persiste dans `cwd` par le backend.
  folderPath?: string | null;
  cwd: string | null;
  startedAt: number;
  lastActivity: number;
  title: string | null;
  preview: string | null;
  messageCount: number;
  totalTokens: number | null;
  cliVersion: string | null;
};

type DiscussionAccountGroup = {
  accountId: string;
  label: string;
  provider?: Provider;
  codexHome: string;
  hasTokens: boolean;
  discussionCount: number;
  discussions: DiscussionSummary[];
  error?: string | null;
};

type DiscussionsView = {
  generatedAt: number;
  totalDiscussions: number;
  accounts: DiscussionAccountGroup[];
};

// Transcript structure d'une discussion pour la vue conversation (bulles).
type DiscussionTranscriptView = {
  sessionId: string;
  messages: ChatMessage[];
  truncated: boolean;
};

type ChatTurnSnapshot = {
  id: number;
  accountId: string;
  sessionId?: string | null;
  status: Exclude<ChatTurnStatus, "idle">;
  startedAt: number;
  finishedAt?: number | null;
  error?: string | null;
  activities: ChatActivity[];
  thoughts: ChatThought[];
  parts: ChatPart[];
};

type ActiveChatTurnSummary = {
  id: number;
  accountId: string;
  sessionId?: string | null;
  status: Exclude<ChatTurnStatus, "idle">;
  startedAt: number;
  waitingForUser: boolean;
};

type ChatSubmitIntent = "message" | "goal";

type QueuedChatSubmission = {
  prompt: string;
  accountId: string;
  mode: ChatMode;
  model: string;
  reasoningEffort: string | null;
  enabledTools: ChatAgentToolId[];
  agentSkills: ChatAgentSkillPrompt[];
  /** Reprise interne d'une saturation : conserve strictement modele et effort. */
  automaticCapacityRetry?: boolean;
  /** Session a reprendre meme si son resume n'est pas encore charge dans l'UI. */
  resumeSessionId?: string | null;
};

type ExpertChatPane = {
  key: string;
  discussion: DiscussionSummary | null;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  syncState: ChatSyncState;
  liveUnlisten: UnlistenFn | null;
  fallbackPoll: number | null;
  loadInFlight: boolean;
  turn: ChatTurnSnapshot | null;
  turnPoll: number | null;
  turnPollInFlight: boolean;
  draft: string;
  queuedSubmissions: QueuedChatSubmission[];
  queueDrainInFlight: boolean;
  activeSubmission: QueuedChatSubmission | null;
  capacityRetryAttempt: number;
  capacityRetryTimer: number | null;
  mode: ChatMode;
  enabledTools: ChatAgentToolId[];
  accountId: string | null;
  historyOpen: boolean;
  pendingWorkspace: string | null;
  autonomousAgentId: string | null;
  orchestrationId: string | null;
  orchestrationRole: "orchestrator" | "worker" | null;
  orchestrationTaskId: string | null;
  followLatest: boolean;
  scrollTop: number;
};

type PersistedExpertChatPane = {
  key: string;
  sessionId: string | null;
  accountId: string | null;
  draft: string;
  mode: ChatMode;
  enabledTools?: ChatAgentToolId[];
  /** Champs historiques conservés uniquement pour migrer les chats déjà ouverts. */
  questionToolEnabled?: boolean;
  proofToolEnabled?: boolean;
  pendingWorkspace: string | null;
  autonomousAgentId?: string | null;
  orchestrationId?: string | null;
  orchestrationRole?: "orchestrator" | "worker" | null;
  orchestrationTaskId?: string | null;
};

type OrchestrationConversionState = {
  paneKey: string;
  name: string;
  objective: string;
  projectDir: string;
  testCommand: string;
  workerCount: number;
  testTimeoutSeconds: number;
  busy: boolean;
};

type AutonomousChatEditorState = {
  paneKey: string;
  agentId: string | null;
  accountId: string;
  name: string;
  objective: string;
  role: string;
  projectDir: string;
  mode: ChatMode;
  model: string;
  reasoningEffort: string;
  intervalSeconds: number;
  requireUserReview: boolean;
  connectors: AutonomousConnectorId[];
  initialMemory: string;
  testCommand: string;
  testTimeoutSeconds: number;
  activate: boolean;
  busy: boolean;
};

type AutonomousOrchestrationPromotionState = {
  agentId: string;
  orchestratorAccountId: string;
  workerAccountIds: string[];
  name: string;
  objective: string;
  projectDir: string;
  testCommand: string;
  workerCount: number;
  testTimeoutSeconds: number;
  busy: boolean;
};

type PersistedExpertChats = {
  v: 1;
  activeKey: string | null;
  panes: PersistedExpertChatPane[];
};

type PromptEntry = {
  sessionId: string;
  accountId: string;
  accountLabel: string;
  codexHome: string;
  filePath: string;
  cwd: string | null;
  timestamp: number;
  sessionTitle: string | null;
  text: string;
};

type PromptHistoryView = {
  generatedAt: number;
  totalPrompts: number;
  returned: number;
  truncated: boolean;
  prompts: PromptEntry[];
};

type PromptSessionHistory = {
  key: string;
  sessionId: string;
  accountId: string;
  accountLabel: string;
  cwd: string | null;
  sessionTitle: string | null;
  firstTimestamp: number;
  lastTimestamp: number;
  prompts: PromptEntry[];
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing #app");
}

// Le theme est applique avant le premier rendu applicatif. index.html fait la
// meme lecture pendant le splash afin d'eviter tout flash sombre en mode clair.
let activeTheme: ThemeMode = loadTheme();
let chatReadySoundPreferences = loadChatReadySoundPreferences();
let chatReadySoundFeedback: { message: string; tone: "success" | "error" } | null = null;
let keyboardShortcutOverrides: KeyboardShortcutOverrides = loadKeyboardShortcutOverrides();
let keyboardShortcutCaptureId: KeyboardShortcutId | null = null;
let keyboardShortcutFeedback: { message: string; tone: "success" | "error" } | null = null;
applyThemeToDocument(activeTheme);

// Event Horizon : fond « trou noir » (disque d'accretion + singularite +
// vignette) injecte une seule fois, hors de #app, pour survivre aux re-render
// et laisser l'animation tourner sans interruption. Respecte prefers-reduced-motion
// via la CSS (.eh-accretion). aria-hidden : purement decoratif.
function ensureEventHorizonBackground(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (document.querySelector(".eh-bg")) return;
  const bg = document.createElement("div");
  bg.className = "eh-bg";
  bg.setAttribute("aria-hidden", "true");
  bg.innerHTML =
    '<div class="eh-accretion"></div><div class="eh-singularity"></div><div class="eh-vignette"></div>';
  document.body.prepend(bg);
}

ensureEventHorizonBackground();

let settings: AppSettings | null = null;
let selectedAccountId: string | null = null;
let activeTerminalKey: string | null = null;
let lastPointerClientX: number | null = null;
let lastPointerClientY: number | null = null;
let expertTerminalFullscreenKey: string | null = null;
let statusText = "Pret";
let ptyIdSeed = Date.now();
let terminalSessions: TerminalSession[] = [];
const terminalSessionsByPtyId = new Map<number, TerminalSession>();

const syncThemeControls = (): void => {
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === activeTheme;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });

  const toggle = document.querySelector<HTMLButtonElement>("#themeToggle");
  const next = oppositeTheme(activeTheme);
  if (toggle) {
    const label = next === "light" ? "Activer le mode clair" : "Activer le mode sombre";
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("aria-pressed", String(activeTheme === "light"));
    const copy = toggle.querySelector<HTMLElement>(".theme-toggle-label");
    if (copy) copy.textContent = activeTheme === "light" ? "Mode clair" : "Mode sombre";
  }
};

const setAppTheme = (theme: ThemeMode): void => {
  if (theme !== "dark" && theme !== "light") return;
  activeTheme = theme;
  persistTheme(theme);
  applyThemeToDocument(theme);
  terminalSessions.forEach((session) => {
    session.terminal.options.theme = terminalThemeFor(theme);
    session.terminal.refresh(0, Math.max(0, session.terminal.rows - 1));
  });
  syncThemeControls();
};
// Dossier dont la session est actuellement ouverte. `null` signifie qu'aucun
// environnement n'a encore ete choisi : on affiche alors le sas de selection,
// jamais les terminaux de plusieurs projets dans un meme mur.
let terminalFolderFilter: string | null = null;
// Creations de terminaux en vol (pas encore poussees dans terminalSessions) :
// permet de faire respecter la limite EXPERT_MAX_TERMINALS malgre les await
// (deux creations concurrentes ne peuvent plus reserver le meme dernier slot).
let pendingTerminalCreations = 0;
// Un double clic (ou deux handlers rapproches) partage la meme creation de
// terminal de connexion pour un compte donne.
const loginTerminalCreations = new Map<string, Promise<TerminalSession | null>>();
// Terminal qui detenait le focus juste avant le dernier render() (capture avant
// la destruction du DOM) : restaure de facon synchrone au remontage pour ne pas
// perdre les frappes lors d'un re-render incident (ex: sortie d'un PTY voisin).
let focusedTerminalKeyBeforeRender: string | null = null;
// Terminal a focaliser volontairement au prochain montage (nouveau terminal,
// selection dans la liste, affichage du mur de terminaux).
let requestTerminalFocusKey: string | null = null;
let globalMobileListenersBound = false;
let mobileRefitTimer = 0;
let unlistenData: UnlistenFn | null = null;
let unlistenExit: UnlistenFn | null = null;
let activeView: AppView = "chat";
let scheduledChatTimer: number | null = null;
let scheduledChatDispatchInFlight = false;
let scheduledChatSchedulerStarted = false;
const doctolibLab = createDoctolibLabState();
let expertGridLayout: ExpertGridLayout = "auto";
let expertChatPageSizeMode: ExpertChatPageSizeMode = DEFAULT_EXPERT_CHAT_PAGE_SIZE_MODE;
let expertChatDisplayMode: ExpertChatDisplayMode = DEFAULT_EXPERT_CHAT_DISPLAY_MODE;
let expertChatPage = 0;
let expertChatToolbarHidden = false;
let terminalRestoreAttempted = false;
let terminalRestorePromise: Promise<void> | null = null;
let poolStatus: PoolStatus | null = null;
let poolPoll: number | null = null;
let poolStatusInFlight = false;
let poolRowsSignature = "";
let voiceRuntimeStatus: VoiceRuntimeStatus | null = null;
let voiceRuntimeError: string | null = null;
let voiceRuntimeInFlight = false;
let voiceRuntimePoll: number | null = null;
let poolImportPaths = "";
let poolNewAccountLabel = "";
let poolNewAccountProxyId = "";
let poolNewAccountBypass = true;
let poolNewAccountModel = DEFAULT_CODEX_MODEL;
let poolNewAccountReasoningEffort: CodexReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT;
let pendingDeleteAccountId: string | null = null;
let limitStatus: AccountLimitView[] = [];
let limitStatusLoaded = false;
let limitPoll: number | null = null;
let unconnectedAccountCleanupTimer: number | null = null;
let unconnectedAccountCleanupInFlight = false;
let limitStatusInFlight = false;
let limitStatusRefreshPromise: Promise<void> | null = null;
let limitStatusSignature = "";
let usageDashboard: UsageDashboard | null = null;
let usagePoll: number | null = null;
let usageDashboardInFlight = false;
let usageDashboardSignature = "";
let accountUsage: AccountUsageDashboard | null = null;
let accountUsageLoaded = false;
let accountUsageInFlight = false;
let accountUsageSignature = "";
let statsRangeDays: StatsRangeDays = 30;
let selectedStatsDate: string | null = null;
let statsActiveTab: "tokens" | "work-time" = "tokens";
let workTimeDashboard: WorkTimeDashboard | null = null;
let workTimeLoaded = false;
let workTimeInFlight = false;
let workTimeSignature = "";
let workTimeGranularity: WorkTimeGranularity = "day";
let selectedWorkTimeBucket: string | null = null;
let kombaiStatus: KombaiStatus | null = null;
let kombaiLoaded = false;
let kombaiPoll: number | null = null;
let kombaiStatusError = false;
let kombaiStatusInFlight = false;
let isFullscreen = false;
let newTerminalModalOpen = false;
let newTerminalAccountId: string | null = null;
let newTerminalAgentId: string | null = null;
let newTerminalWorkspacePath: string | null = null;
let newTerminalAccountLabel = "";
let newTerminalAccountProvider: Provider = "codex";
let newTerminalAccountBypass = true;
let newTerminalAccountModel = DEFAULT_CODEX_MODEL;
let newTerminalAccountReasoningEffort: CodexReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT;
// Fenetre "nouveau chat" : on choisit le compte, le modele et le mode avant
// d'ouvrir reellement le pane (tous les points d'entree "nouveau chat" y passent).
let newChatModalOpen = false;
let newChatAccountId: string | null = null;
let newChatMode: ChatMode = "build";
let newChatModel = "";
const newChatModelDrafts = new Map<string, string>();
let newChatPendingWorkspace: string | null = null;
let newChatPendingTaskTitle: string | null = null;
let newChatPendingPrompt: string | null = null;
let newChatPendingPromptAutoSend = false;
let newChatBestQuotaInFlight = false;
let newChatBestQuotaRequestId = 0;
let agentsModalOpen = false;
let autonomousAgents: AutonomousAgentSnapshot[] = [];
let autonomousAgentsLoaded = false;
let autonomousAgentsInFlight = false;
let autonomousAgentsPoll: number | null = null;
let autonomousAgentsSignature = "";
let autonomousNameDraft = "";
let autonomousObjectiveDraft = "";
let autonomousRoleDraft = "";
let autonomousInitialMemoryDraft = "";
let autonomousTemplateId: AutonomousAgentTemplateId | null = null;
let autonomousAccountId: string | null = null;
let autonomousProjectDir = "";
let autonomousEnvironmentCustom = false;
let autonomousIntervalSeconds = 15 * 60;
let autonomousTriggerKind: AutonomousTriggerKind = "schedule";
let autonomousWatchPathsDraft = "src\npublic\nindex.html\npackage.json";
let autonomousDebounceSeconds = 10;
let autonomousAllowGitPublish = false;
let autonomousMode: ChatMode = "build";
type AutonomousLaunchMode = "autonomous" | "orchestrator";
let autonomousLaunchMode: AutonomousLaunchMode = "autonomous";
let autonomousLaunchWorkerCount = 3;
let autonomousLaunchWorkerAccountIds: string[] = [];
let autonomousRequireUserReview = true;
let autonomousConnectors: AutonomousConnectorId[] = [];
let autonomousTestCommandDraft = "";
let autonomousTestTimeoutSeconds = 5 * 60;
let autonomousCreateOpen = false;
let autonomousCreatePreferenceSet = false;
type AutonomousAgentEditDraft = {
  name: string;
  objective: string;
  role: string;
  accountId: string;
  projectDir: string;
  mode: ChatMode;
  model: string;
  reasoningEffort: string;
  connectors: AutonomousConnectorId[];
  intervalSeconds: number;
  triggerKind: AutonomousTriggerKind;
  watchPaths: string;
  debounceSeconds: number;
  allowGitPublish: boolean;
  requireUserReview: boolean;
  testCommand: string;
  testTimeoutSeconds: number;
  activate: boolean;
};
let autonomousEditingId: string | null = null;
let autonomousEditDraft: AutonomousAgentEditDraft | null = null;
const AUTONOMOUS_MONITOR_COMPACT_STORAGE_KEY = "codex-switch-terminal.autonomous-monitor-compact.v1";
let autonomousMonitorOpen = false;
let autonomousMonitorCompact = localStorage.getItem(AUTONOMOUS_MONITOR_COMPACT_STORAGE_KEY) === "1";
let autonomousMonitorAgentId: string | null = null;
let autonomousMonitorInstructionDraft = "";
let autonomousMonitorTurn: ChatTurnSnapshot | null = null;
let autonomousMonitorTurnAgentId: string | null = null;
let autonomousMonitorTurnSignature = "";
let autonomousMonitorTurnInFlight = false;
let autonomousMonitorTurnPoll: number | null = null;
let autonomousMonitorError = "";
const autonomousMemoryDrafts = new Map<string, string>();
let autonomousBusyId: string | null = null;
let autonomousDeletePendingId: string | null = null;
let autonomousScheduleEditingId: string | null = null;
const autonomousScheduleDrafts = new Map<string, string>();
const autonomousFrequencyDrafts = new Map<string, number>();
let orchestrations: OrchestrationSnapshot[] = [];
let orchestrationsLoaded = false;
let orchestrationsInFlight = false;
let orchestrationsPoll: number | null = null;
let orchestrationsSignature = "";
let orchestrationNameDraft = "";
let orchestrationObjectiveDraft = "";
let orchestrationAccountId: string | null = null;
let orchestrationProjectDir = "";
let orchestrationTestCommandDraft = "";
let orchestrationTestTimeoutSeconds = 10 * 60;
let orchestrationWorkerCount = 3;
let orchestrationWorkerAccountIds: string[] = [];
let orchestrationCreateOpen = false;
let orchestrationCreatePreferenceSet = false;
let orchestrationBusyId: string | null = null;
let orchestrationAssignmentBusy: string | null = null;
let orchestrationDeletePendingId: string | null = null;
let orchestrationSelectedRunId: string | null = null;
let orchestrationConversion: OrchestrationConversionState | null = null;
let autonomousOrchestrationPromotion: AutonomousOrchestrationPromotionState | null = null;
let autonomousChatEditor: AutonomousChatEditorState | null = null;
let discussions: DiscussionsView | null = null;
let discussionsLoaded = false;
let discussionsPoll: number | null = null;
let discussionsLiveUnlisten: UnlistenFn | null = null;
let discussionsSyncState: RealtimeConnectionState = "closed";
let discussionsRenderSignature = "";
let discussionsRefreshPromise: Promise<void> | null = null;
let discussionSearch = "";
let chatSidebarSearch = "";
let chatSidebarWidth = CHAT_SIDEBAR_DEFAULT_WIDTH;
// Compte cible choisi par discussion (sessionId -> accountId). Defaut : le
// compte d'origine. Persiste entre les re-rendus (poll 60s) pour ne pas perdre
// le choix en cours.
const discussionTargetSel = new Map<string, string>();
let discussionBusyId: string | null = null;
let discussionArchiveCandidate: DiscussionSummary | null = null;
type ChatAccountTransition = {
  label: string;
  detail: string;
};
// Etat purement visuel et ephemere : une bascule conserve le panneau existant
// pendant que son contexte passe au compte cible. Rien n'est persiste ici.
const expertChatAccountTransitions = new Map<string, ChatAccountTransition>();
const CHAT_DRAG_MIME = "application/x-cst-chat";
let draggedChatSessionId: string | null = null;
// Vue conversation : discussion ouverte en bulles + son transcript charge.
let chatDiscussion: DiscussionSummary | null = null;
let chatMessages: ChatMessage[] = [];
let chatLoading = false;
let chatError: string | null = null;
let chatTruncated = false;
let chatSyncState: ChatSyncState = "closed";
let chatLiveUnlisten: UnlistenFn | null = null;
let chatFallbackPoll: number | null = null;
let chatLoadInFlight = false;
let chatTurn: ChatTurnSnapshot | null = null;
let chatTurnPoll: number | null = null;
let chatTurnPollInFlight = false;
let activeChatTurns: ActiveChatTurnSummary[] = [];
let activeChatTurnsPoll: number | null = null;
let activeChatTurnsInFlight = false;
let activeChatTurnsSidebarSignature = "";
let chatRuntimeClock: number | null = null;
let chatDraft = "";
let chatQueuedSubmissions: QueuedChatSubmission[] = [];
let chatQueueDrainInFlight = false;
let chatActiveSubmission: QueuedChatSubmission | null = null;
let chatCapacityRetryAttempt = 0;
let chatCapacityRetryTimer: number | null = null;
let chatMode: ChatMode = "build";
let chatEnabledTools: ChatAgentToolId[] = [];
let chatAccountId: string | null = null;
let chatHistoryOpen = false;
// Le fil est mis a jour plusieurs fois par seconde pendant une reponse. Garder
// l'intention de suivi en memoire evite de ramener de force au bas un utilisateur
// qui vient juste de commencer a remonter avec la molette ou au tactile.
const chatScrollState: ChatScrollState = {
  followLatest: true,
  scrollTop: 0,
};
let skipNextChatScrollCapture = false;
let chatPreferencesSave: Promise<void> = Promise.resolve();
const chatModelCatalogs = new Map<string, AccountModelView[]>();
const chatModelCatalogLoads = new Set<string>();
let expertChatPanes: ExpertChatPane[] = [];
let activeExpertChatKey: string | null = null;
let expertChatFullscreenKey: string | null = null;
let expertChatsRestored = false;
let promptHistory: PromptHistoryView | null = null;
let promptHistoryLoaded = false;
let promptSearch = "";
// Selecteur de workspace (mode web) : modale de navigation de dossiers serveur.
type WorkspacePickerTarget = "active" | "new-terminal";
let workspaceModalOpen = false;
let workspacePickerTarget: WorkspacePickerTarget = "active";
let workspaceBrowse: FsListResponse | null = null;
let workspaceBrowseLoading = false;
let workspaceBrowseError = "";
let terminalEnvironmentMenuOpen = false;
let environmentMemoryTargetId: string | null = null;
let environmentMemoryDraftId: string | null = null;
let environmentMemoryDraft = "";
let environmentMemorySaving = false;

type ManagedDialog =
  | "agents"
  | "autonomous-chat"
  | "autonomous-orchestration"
  | "discussion-archive"
  | "environment"
  | "new-chat"
  | "new-terminal"
  | "orchestration-convert"
  | "workspace";

type DialogFocusTarget = {
  id: string | null;
  dataAttribute: string | null;
  dataValue: string | null;
  fallbackId: string | null;
};

const dialogReturnFocus = new Map<ManagedDialog, DialogFocusTarget>();
const DIALOG_TRIGGER_DATA_ATTRIBUTES = [
  "data-m",
  "data-act",
  "data-view",
  "data-delete-session",
] as const;
const DIALOG_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const activeModalDialog = (): HTMLElement | null =>
  [...document.querySelectorAll<HTMLElement>(".modal-backdrop [role='dialog']")].at(-1) ?? null;

const isVisibleDialogControl = (element: HTMLElement): boolean => {
  const style = window.getComputedStyle(element);
  return (
    !element.closest("[hidden]") &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    element.getClientRects().length > 0
  );
};

const dialogFocusableElements = (dialog: HTMLElement): HTMLElement[] =>
  [...dialog.querySelectorAll<HTMLElement>(DIALOG_FOCUSABLE_SELECTOR)].filter(
    isVisibleDialogControl,
  );

const rememberDialogTrigger = (dialog: ManagedDialog, fallbackId: string | null) => {
  if (dialogReturnFocus.has(dialog)) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const dataAttribute = DIALOG_TRIGGER_DATA_ATTRIBUTES.find((attribute) =>
    active?.hasAttribute(attribute),
  ) ?? null;
  dialogReturnFocus.set(dialog, {
    id: active?.id || null,
    dataAttribute,
    dataValue: dataAttribute ? active?.getAttribute(dataAttribute) ?? null : null,
    fallbackId,
  });
};

const takeDialogTrigger = (dialog: ManagedDialog): DialogFocusTarget | null => {
  const target = dialogReturnFocus.get(dialog) ?? null;
  dialogReturnFocus.delete(dialog);
  return target;
};

const forgetDialogTrigger = (dialog: ManagedDialog) => {
  dialogReturnFocus.delete(dialog);
};

const resolveDialogFocusTarget = (target: DialogFocusTarget | null): HTMLElement | null => {
  if (!target) return null;
  if (target.id) {
    const byId = document.getElementById(target.id);
    if (byId instanceof HTMLElement) return byId;
  }
  if (target.dataAttribute) {
    const byData = [...document.querySelectorAll<HTMLElement>(`[${target.dataAttribute}]`)].find(
      (candidate) => candidate.getAttribute(target.dataAttribute!) === target.dataValue,
    );
    if (byData) return byData;
  }
  return target.fallbackId ? document.getElementById(target.fallbackId) : null;
};

const restoreDialogTrigger = (target: DialogFocusTarget | null) => {
  window.setTimeout(() => {
    const candidate = resolveDialogFocusTarget(target);
    const dialog = activeModalDialog();
    if (candidate && (!dialog || dialog.contains(candidate))) {
      candidate.focus();
      return;
    }
    syncActiveDialogAccessibility();
  }, 0);
};

const syncActiveDialogAccessibility = () => {
  const dialog = activeModalDialog();
  const layout = document.querySelector<HTMLElement>(".chat-app-layout");
  const mobileChrome = document.querySelector<HTMLElement>(".m-chrome");
  if (layout) layout.inert = !!dialog;
  if (mobileChrome) mobileChrome.inert = !!dialog;
  document.body.classList.toggle("has-active-dialog", !!dialog);
  if (!dialog || dialog.contains(document.activeElement)) return;

  window.setTimeout(() => {
    const currentDialog = activeModalDialog();
    if (!currentDialog || currentDialog.contains(document.activeElement)) return;
    if (window.matchMedia("(max-width: 860px)").matches) {
      currentDialog.focus();
      return;
    }
    const preferredSelectors = [
      "[data-dialog-initial-focus]",
      "[aria-checked='true']",
      "[aria-current='true']",
      "input:not([disabled]):not([type='hidden'])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "button:not([disabled])",
    ];
    const preferred = preferredSelectors
      .map((selector) => currentDialog.querySelector<HTMLElement>(selector))
      .find((candidate): candidate is HTMLElement =>
        !!candidate && isVisibleDialogControl(candidate),
      );
    (preferred ?? currentDialog)?.focus();
  }, 0);
};

const revealSelectedStatsPoint = () => {
  window.requestAnimationFrame(() => {
    const chart = document.querySelector<HTMLElement>(".stats-point-chart");
    const selected = chart?.querySelector<SVGGElement>(".stats-day-point.is-selected");
    if (!chart || !selected) return;
    const chartRect = chart.getBoundingClientRect();
    const pointRect = selected.getBoundingClientRect();
    const margin = 28;
    if (
      pointRect.left >= chartRect.left + margin &&
      pointRect.right <= chartRect.right - margin
    ) {
      return;
    }
    chart.scrollLeft +=
      pointRect.left - chartRect.left - chart.clientWidth / 2 + pointRect.width / 2;
  });
};

const trapActiveDialogFocus = (event: KeyboardEvent) => {
  if (event.key !== "Tab") return;
  const dialog = activeModalDialog();
  if (!dialog) return;
  const focusable = dialogFocusableElements(dialog);
  if (!focusable.length) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
  const nextIndex = event.shiftKey
    ? currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
    : currentIndex < 0 || currentIndex === focusable.length - 1 ? 0 : currentIndex + 1;
  event.preventDefault();
  focusable[nextIndex]?.focus();
};

// --- Audit design (détecteur Impeccable) -----------------------------------
// Un finding = un anti-pattern détecté sur un élément de la page courante.
type AuditFinding = {
  type: string;
  category: string;
  severity: string;
  detail: string;
  name: string;
  description: string;
  selector: string;
  tagName: string;
};

// Résultats du dernier audit (null tant qu'aucun audit n'a été lancé).
let auditFindings: AuditFinding[] | null = null;
let auditLoading = false;
let auditError: string | null = null;
// Libellé de la vue auditée (affiché dans l'en-tête du rapport).
let auditViewLabel: string | null = null;
// Chargement mémoïsé du bundle détecteur (injecté à la demande, une seule fois).
let impeccableLoadPromise: Promise<void> | null = null;

// --- Bibliothèque de skills (fichiers embarqués) -----------------------------
type SkillEntry = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  buttonLabel: string;
  icon: string;
  content: string;
};
type ChatAgentSkillPrompt = Pick<SkillEntry, "id" | "name" | "content">;
let skillsList: SkillEntry[] | null = null;
let skillsLoaded = false;
let skillsError: string | null = null;
let chatSkillButtonIds: string[] | null = null;

const lucideIcons = {
  Activity,
  ArrowUpRight,
  ArrowRight,
  Check,
  LayoutGrid,
  List,
  ListPlus,
  ListTree,
  LoaderCircle,
  LogIn,
  MessageSquare,
  MessageSquarePlus,
  AppWindow,
  ArrowLeft,
  ArrowUp,
  BadgeCheck,
  BarChart3,
  BellOff,
  BellRing,
  Bot,
  BrainCircuit,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  Clock3,
  CopyCheck,
  FlaskConical,
  FolderOpen,
  GitBranch,
  History,
  Info,
  Keyboard,
  Maximize2,
  Minimize2,
  Play,
  PlugZap,
  Plus,
  Power,
  Radar,
  Radio,
  RefreshCcw,
  Save,
  Server,
  Shuffle,
  SquareTerminal,
  Stethoscope,
  Star,
  Sun,
  Tag,
  Target,
  Trash2,
  Upload,
  Unplug,
  UserPlus,
  Users,
  X,
  Copy,
  Cpu,
  Gauge,
  MessagesSquare,
  Music2,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  ScanEye,
  FolderX,
  Library,
  ListChecks,
  LockKeyhole,
  MessageCircleQuestion,
  MessageSquareText,
  Mic,
  Square,
  Reply,
  RotateCcw,
  Wrench,
  Settings,
  Settings2,
  Folder,
  FolderPlus,
  Folders,
  ChevronsUpDown,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
  Pause,
  Pencil,
  ShieldQuestion,
  TriangleAlert,
  Moon,
};

// `lucide.createIcons()` reparcourt puis remplace toutes les icones du document
// a chaque patch de DOM. Pendant un tour actif cela pouvait recreer des dizaines
// de SVG deux fois par seconde. On ne transforme ici que les nouveaux <i> du
// sous-arbre modifie ; les SVG deja montes restent intacts.
const lucideComponentName = (name: string) =>
  name.replace(/(\w)(\w*)(_|-|\s*)/g, (_match, first: string, rest: string) =>
    first.toUpperCase() + rest.toLowerCase());

const renderIcons = (root: ParentNode = document) => {
  const placeholders = Array.from(root.querySelectorAll<HTMLElement>("i[data-lucide]"));
  if (root instanceof HTMLElement && root.matches("i[data-lucide]")) {
    placeholders.unshift(root);
  }
  placeholders.forEach((placeholder) => {
    const name = placeholder.dataset.lucide;
    if (!name) return;
    const componentName = lucideComponentName(name) as keyof typeof lucideIcons;
    const icon = lucideIcons[componentName] as IconNode | undefined;
    if (!icon) return;
    const svg = createLucideElement(icon);
    Array.from(placeholder.attributes).forEach((attribute) => {
      if (attribute.name !== "class") svg.setAttribute(attribute.name, attribute.value);
    });
    svg.setAttribute(
      "class",
      ["lucide", `lucide-${name}`, placeholder.className].filter(Boolean).join(" "),
    );
    placeholder.replaceWith(svg);
  });
};

const chatFeedSignatures = new WeakMap<HTMLElement, string>();
const chatRuntimeSignatures = new WeakMap<object, string>();

const chatFeedRenderSignature = (model: ChatPanelModel) => JSON.stringify([
  model.providerLabel,
  model.loading,
  model.error,
  model.truncated,
  model.messages,
  model.activities,
  model.thoughts,
  model.parts,
  model.turnStatus,
  model.turnStartedAt,
  model.turnFinishedAt,
  model.turnError,
  model.waitingForUser,
  model.quotaSuggestion,
]);

const chatRuntimeRenderSignature = (model: ChatPanelModel) => JSON.stringify([
  model.turnStatus,
  model.turnStartedAt,
  model.turnFinishedAt,
  model.waitingForUser,
  model.activities.at(-1),
  model.parts.at(-1),
  model.turnError,
  model.quotaStatus,
]);

const OPEN_TERMINALS_STORAGE_KEY = "codex-switch-terminal.open-terminals.v4";
const LEGACY_OPEN_TERMINALS_STORAGE_KEYS = [
  "codex-switch-terminal.open-terminals.v3",
  "codex-switch-terminal.open-terminals.v2",
] as const;
const EXPERT_GRID_LAYOUT_STORAGE_KEY = "codex-switch-terminal.expert-grid-layout.v1";
const EXPERT_CHATS_PER_PAGE_STORAGE_KEY = "codex-switch-terminal.expert-chats-per-page.v1";
const EXPERT_CHAT_DISPLAY_MODE_STORAGE_KEY =
  "codex-switch-terminal.expert-chat-display-mode.v1";
const EXPERT_CHAT_TOOLBAR_HIDDEN_STORAGE_KEY =
  "codex-switch-terminal.expert-chat-toolbar-hidden.v1";
const EXPERT_MAX_TERMINALS = 16;
const TERMINAL_RESTORE_CONCURRENCY = 4;
const EXPERT_OPEN_CHATS_STORAGE_KEY = "codex-switch-terminal.expert-open-chats.v1";
// v2 applique la largeur plus lisible de la nouvelle coque sans conserver une
// ancienne valeur par defaut trop etroite comme preference utilisateur.
const CHAT_SIDEBAR_WIDTH_STORAGE_KEY = "codex-switch-terminal.chat-sidebar-width.v2";
const CHAT_SIDEBAR_SNAP_CLOSED_WIDTH = 48;
const LIMIT_POLL_INTERVAL_MS = 30_000;
const UNCONNECTED_ACCOUNT_EXPIRY_MS = 10 * 60 * 1_000;
const UNCONNECTED_ACCOUNT_CLEANUP_RETRY_MS = 30_000;
const LOCAL_TRANSCRIPT_POLL_INTERVAL_MS = 2_000;
let terminalRuntimePromise: Promise<typeof import("./terminal-runtime")> | null = null;

const loadTerminalRuntime = () =>
  (terminalRuntimePromise ??= import("./terminal-runtime"));

const runWhenPageVisible = (task: () => void) => {
  if (document.visibilityState === "visible") task();
};

const loadExpertGridLayout = (): ExpertGridLayout => {
  const value = localStorage.getItem(EXPERT_GRID_LAYOUT_STORAGE_KEY);
  return value === "2" || value === "3" || value === "4" ? value : "auto";
};

const loadExpertChatPageSizeMode = (): ExpertChatPageSizeMode =>
  normalizeExpertChatPageSizeMode(localStorage.getItem(EXPERT_CHATS_PER_PAGE_STORAGE_KEY));

const loadExpertChatDisplayMode = (): ExpertChatDisplayMode =>
  normalizeExpertChatDisplayMode(localStorage.getItem(EXPERT_CHAT_DISPLAY_MODE_STORAGE_KEY));

const setExpertChatDisplayMode = (mode: ExpertChatDisplayMode): void => {
  const nextMode = normalizeExpertChatDisplayMode(mode);
  if (nextMode === expertChatDisplayMode) return;
  expertChatDisplayMode = nextMode;
  localStorage.setItem(EXPERT_CHAT_DISPLAY_MODE_STORAGE_KEY, nextMode);
  expertChatPage = 0;
  reconcileExpertChatPage();
  statusText = nextMode === "available"
    ? "La fenêtre principale n'affiche que les chats disponibles"
    : "La fenêtre principale affiche tous les chats";
  render();
  if (activeView === "chat") startAllExpertChatWork();
};

const loadExpertChatToolbarHidden = (): boolean =>
  localStorage.getItem(EXPERT_CHAT_TOOLBAR_HIDDEN_STORAGE_KEY) === "true";

const syncExpertChatToolbarDom = () => {
  const workspace = document.querySelector<HTMLElement>(".expert-chat-workspace");
  const toolbar = document.querySelector<HTMLElement>("#expertChatToolbar");
  const restoreButton = document.querySelector<HTMLButtonElement>("#expertChatToolbarShow");
  workspace?.classList.toggle("is-toolbar-hidden", expertChatToolbarHidden);
  toolbar?.setAttribute("aria-hidden", String(expertChatToolbarHidden));
  if (restoreButton) {
    restoreButton.setAttribute("aria-hidden", String(!expertChatToolbarHidden));
    restoreButton.tabIndex = expertChatToolbarHidden ? 0 : -1;
  }
};

const setExpertChatToolbarHidden = (hidden: boolean) => {
  expertChatToolbarHidden = hidden;
  localStorage.setItem(EXPERT_CHAT_TOOLBAR_HIDDEN_STORAGE_KEY, String(hidden));
  syncExpertChatToolbarDom();
  const focusTarget = document.querySelector<HTMLButtonElement>(
    hidden ? "#expertChatToolbarShow" : "#expertChatToolbarHide",
  );
  focusTarget?.focus({ preventScroll: true });
};

const loadChatSidebarWidth = (): number => {
  const stored = localStorage.getItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY);
  if (stored === null) return defaultChatSidebarWidth(window.innerWidth);
  const parsed = Number(stored);
  if (!Number.isFinite(parsed)) return defaultChatSidebarWidth(window.innerWidth);
  return Math.max(
    CHAT_SIDEBAR_MIN_WIDTH,
    Math.min(CHAT_SIDEBAR_MAX_WIDTH, Math.round(parsed)),
  );
};

const displayedChatSidebarWidth = (): number =>
  clampChatSidebarWidth(chatSidebarWidth, window.innerWidth);

const syncChatSidebarWidthDom = () => {
  const layout = document.querySelector<HTMLElement>(".chat-app-layout");
  const resizer = document.querySelector<HTMLElement>("#chatSidebarResizer");
  if (!layout || !resizer) return;
  const width = displayedChatSidebarWidth();
  layout.style.setProperty("--chat-sidebar-width", `${width}px`);
  layout.classList.toggle("is-sidebar-collapsed", width === 0);
  resizer.setAttribute("aria-valuenow", String(width));
  resizer.setAttribute("aria-valuemax", String(chatSidebarMaxWidth(window.innerWidth)));
  resizer.setAttribute("aria-valuetext", width === 0 ? "Colonne masquée" : `${width} pixels`);
};

const setChatSidebarWidth = (width: number, persist = true) => {
  chatSidebarWidth = clampChatSidebarWidth(width, window.innerWidth);
  syncChatSidebarWidthDom();
  if (persist) {
    localStorage.setItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY, String(chatSidebarWidth));
  }
};

const bindChatSidebarResizer = () => {
  const resizer = document.querySelector<HTMLElement>("#chatSidebarResizer");
  if (!resizer) return;

  let pointerId: number | null = null;
  let pointerStartX = 0;
  let widthAtPointerStart = 0;

  const finishResize = (event: PointerEvent) => {
    if (pointerId !== event.pointerId) return;
    const capturedPointerId = pointerId;
    pointerId = null;
    document.body.classList.remove("chat-sidebar-resizing");
    if (displayedChatSidebarWidth() <= CHAT_SIDEBAR_SNAP_CLOSED_WIDTH) {
      setChatSidebarWidth(0);
    } else {
      localStorage.setItem(CHAT_SIDEBAR_WIDTH_STORAGE_KEY, String(chatSidebarWidth));
    }
    if (resizer.hasPointerCapture(capturedPointerId)) {
      resizer.releasePointerCapture(capturedPointerId);
    }
    fitAndResizeVisibleTerminals();
  };

  resizer.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    pointerId = event.pointerId;
    pointerStartX = event.clientX;
    widthAtPointerStart = displayedChatSidebarWidth();
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add("chat-sidebar-resizing");
  });
  resizer.addEventListener("pointermove", (event) => {
    if (pointerId !== event.pointerId) return;
    setChatSidebarWidth(widthAtPointerStart + event.clientX - pointerStartX, false);
  });
  resizer.addEventListener("pointerup", finishResize);
  resizer.addEventListener("pointercancel", finishResize);
  resizer.addEventListener("lostpointercapture", finishResize);
  resizer.addEventListener("dblclick", () => {
    setChatSidebarWidth(defaultChatSidebarWidth(window.innerWidth));
    fitAndResizeVisibleTerminals();
  });
  resizer.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 16;
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") nextWidth = displayedChatSidebarWidth() - step;
    if (event.key === "ArrowRight") nextWidth = displayedChatSidebarWidth() + step;
    if (event.key === "Home") nextWidth = CHAT_SIDEBAR_MIN_WIDTH;
    if (event.key === "End") nextWidth = chatSidebarMaxWidth(window.innerWidth);
    if (nextWidth === null) return;
    event.preventDefault();
    setChatSidebarWidth(nextWidth);
    fitAndResizeVisibleTerminals();
  });
};

// Workspace actif = valeur proposee aux PROCHAINS terminaux. Chaque session en
// capture ensuite une copie immuable. Memorise par appareil (localStorage) : en
// web c'est un dossier du serveur ; en desktop un dossier local.
const WORKSPACE_STORAGE_KEY = "codex-switch-terminal.workspace.path";
const WORKSPACES_STORAGE_KEY = "codex-switch-terminal.workspaces.v1";
const MAX_ENVIRONMENT_MEMORY_CHARS = 8_000;

const loadWorkspacePaths = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(WORKSPACES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const sanitized = parsed
      .filter((path): path is string => typeof path === "string" && path.trim().length > 0)
      .map((path) => userEnvironmentPath(path))
      .filter((path): path is string => !!path)
      .filter((path) => {
        const key = normalizeWorkspacePath(path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    if (JSON.stringify(parsed) !== JSON.stringify(sanitized)) {
      localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
  } catch {
    return [];
  }
};

const storeWorkspacePaths = (paths: readonly string[]) => {
  localStorage.setItem(WORKSPACES_STORAGE_KEY, JSON.stringify(paths));
};

const rememberWorkspace = (path: string) => {
  const trimmed = userEnvironmentPath(path);
  if (!trimmed) return;
  const key = normalizeWorkspacePath(trimmed);
  const paths = loadWorkspacePaths().filter((item) => normalizeWorkspacePath(item) !== key);
  storeWorkspacePaths([trimmed, ...paths].slice(0, 12));
};

const forgetWorkspace = (path: string) => {
  const id = workspaceIdForPath(path);
  storeWorkspacePaths(
    loadWorkspacePaths().filter((item) => workspaceIdForPath(item) !== id),
  );
};

const currentWorkspace = (): string | null => {
  const stored = localStorage.getItem(WORKSPACE_STORAGE_KEY);
  const environment = userEnvironmentPath(stored);
  if (stored?.trim() && !environment) localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  return environment;
};

const setCurrentWorkspace = (path: string | null) => {
  const trimmed = userEnvironmentPath(path);
  if (trimmed) {
    rememberWorkspace(trimmed);
    localStorage.setItem(WORKSPACE_STORAGE_KEY, trimmed);
  } else {
    localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  }
};

// --- Workspaces (dossiers projets, contexte des chats) ---------------------
// Un workspace regroupe les chats faits dans un meme dossier. L'appartenance
// d'un chat est DERIVEE du cwd de sa discussion (aucune reference stockee). Le
// registre synchronise vit dans settings.workspaces (backend) ; la selection
// locale indique le workspace cible sans masquer les autres groupes.
const WORKSPACE_ALL = "__all__";
const WORKSPACE_UNKNOWN = "__unknown__";
const CHAT_WS_FILTER_KEY = "codex-switch-terminal.chat-workspace-filter";

const chatWorkspaceFilterRaw = (): string | null =>
  localStorage.getItem(CHAT_WS_FILTER_KEY);
const activeChatWorkspaceFilter = (): string => {
  const stored = chatWorkspaceFilterRaw();
  return stored || WORKSPACE_ALL;
};
const setChatWorkspaceFilter = (value: string) => {
  localStorage.setItem(CHAT_WS_FILTER_KEY, value);
};

// Workspace lie a un NOUVEAU chat (capture-a-la-creation) : garantit que le
// dossier d'un chat cree dans le workspace X reste X meme si l'utilisateur
// change de workspace avant d'envoyer le premier message.
let pendingChatWorkspace: string | null = null;
let workspaceClosingId: string | null = null;

const closedWorkspaceIds = (): Set<string> =>
  new Set(mergeClosedWorkspaceIds(settings?.closedWorkspaceIds ?? []));

const workspaceIsClosed = (path: string): boolean =>
  closedWorkspaceIds().has(workspaceIdForPath(path));

// Un transcript enregistre le dossier courant. Une ancienne association de
// terminal reste prioritaire pour conserver la compatibilite des sessions.
const folderPathForRuntimePath = (rawPath: string | null | undefined): string | null => {
  const path = rawPath?.trim();
  if (!path) return null;
  const linkedTerminal = terminalSessions.find(
    (session) =>
      session.workspacePath &&
      normalizeWorkspacePath(session.workspacePath) === normalizeWorkspacePath(path),
  );
  return userEnvironmentPath(linkedTerminal?.folderPath) ?? userEnvironmentPath(path);
};

const discussionFolderPath = (
  discussion: DiscussionSummary | null | undefined,
): string | null =>
  userEnvironmentPath(discussion?.folderPath) ?? folderPathForRuntimePath(discussion?.cwd);

// Une reouverture explicite restaure aussi le contexte global du dossier pour
// les terminaux et les prochains messages.
const activateDiscussionFolder = (discussion: DiscussionSummary): string | null => {
  const folderPath = discussionFolderPath(discussion);
  if (!folderPath) return null;
  discussion.folderPath = folderPath;
  setCurrentWorkspace(folderPath);
  setChatWorkspaceFilter(workspaceIdForPath(folderPath));
  terminalFolderFilter = folderPath;
  void upsertWorkspaceRegistry(folderPath);
  return folderPath;
};

// Enumeration des workspaces connus : union du registre synchronise, du MRU
// local, du workspace actif, et des cwd distincts des discussions. Trie : actif
// d'abord, puis par activite la plus recente, puis alphabetique.
const knownWorkspaces = (): WorkspaceProfile[] => {
  const byId = new Map<string, WorkspaceProfile>();
  const closedIds = closedWorkspaceIds();
  const add = (rawPath: string | null | undefined) => {
    const path = userEnvironmentPath(rawPath);
    if (!path) return;
    const id = workspaceIdForPath(path);
    if (closedIds.has(id)) return;
    if (!byId.has(id)) {
      byId.set(id, { id, label: workspaceBaseName(path), path, memory: "" });
    }
  };

  mergeWorkspaceProfiles(settings?.workspaces ?? []).workspaces.forEach((ws) => {
    if (closedIds.has(ws.id)) return;
    if (!byId.has(ws.id)) byId.set(ws.id, ws);
  });
  add(currentWorkspace());
  loadWorkspacePaths().forEach(add);
  terminalSessions.forEach((session) => add(session.folderPath));
  allDiscussions().forEach((discussion) => add(discussionFolderPath(discussion)));

  const lastActivity = new Map<string, number>();
  allDiscussions().forEach((discussion) => {
    const folderPath = discussionFolderPath(discussion);
    if (!folderPath) return;
    const id = workspaceIdForPath(folderPath);
    lastActivity.set(id, Math.max(lastActivity.get(id) ?? 0, discussion.lastActivity));
  });

  const active = currentWorkspace();
  const activeId = active ? workspaceIdForPath(active) : null;
  return [...byId.values()].sort((left, right) => {
    if (left.id === activeId) return -1;
    if (right.id === activeId) return 1;
    const delta = (lastActivity.get(right.id) ?? 0) - (lastActivity.get(left.id) ?? 0);
    if (delta !== 0) return delta;
    return left.label.localeCompare(right.label);
  });
};

const workspaceProfileForPath = (
  path: string | null | undefined,
): WorkspaceProfile | null => {
  const environmentPath = userEnvironmentPath(path);
  if (!environmentPath) return null;
  const id = workspaceIdForPath(environmentPath);
  return knownWorkspaces().find((workspace) => workspace.id === id) ?? null;
};

const openEnvironmentMemory = (workspace: WorkspaceProfile) => {
  environmentMemoryTargetId = workspace.id;
  environmentMemoryDraftId = workspace.id;
  environmentMemoryDraft = workspace.memory;
  statusText = workspace.memory.trim()
    ? `Memoire de ${workspace.label}`
    : `Aucun souvenir partage dans ${workspace.label}`;
  render();
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLTextAreaElement>("#environmentMemoryInput")?.focus();
  });
};

const clearEnvironmentMemoryDraft = () => {
  environmentMemoryTargetId = null;
  environmentMemoryDraftId = null;
  environmentMemoryDraft = "";
  environmentMemorySaving = false;
};

const saveEnvironmentMemory = async (): Promise<void> => {
  if (!settings || environmentMemorySaving) return;
  const target = environmentMemoryTargetId
    ? knownWorkspaces().find((workspace) => workspace.id === environmentMemoryTargetId) ?? null
    : null;
  const environmentPath = userEnvironmentPath(target?.path);
  if (!target || !environmentPath) {
    statusText = "Choisissez la memoire d'un environnement";
    return;
  }
  const input = document.querySelector<HTMLTextAreaElement>("#environmentMemoryInput");
  const memory = (input?.value ?? environmentMemoryDraft).trim();
  if ([...memory].length > MAX_ENVIRONMENT_MEMORY_CHARS) {
    statusText = `La memoire est limitee a ${MAX_ENVIRONMENT_MEMORY_CHARS} caracteres`;
    input?.setCustomValidity(statusText);
    input?.reportValidity();
    return;
  }

  const previousWorkspaces = settings.workspaces ?? [];
  const update = setWorkspaceMemory(previousWorkspaces, environmentPath, memory);
  if (!update.changed) {
    statusText = memory ? "Memoire d'environnement deja a jour" : "Memoire deja vide";
    render();
    return;
  }

  environmentMemorySaving = true;
  document.querySelector<HTMLButtonElement>("#saveEnvironmentMemory")?.setAttribute("disabled", "");
  settings.workspaces = update.workspaces;
  try {
    settings = await invoke<AppSettings>("save_settings", { settings });
    const saved = workspaceProfileForPath(environmentPath);
    environmentMemoryTargetId = workspaceIdForPath(environmentPath);
    environmentMemoryDraftId = workspaceIdForPath(environmentPath);
    environmentMemoryDraft = saved?.memory ?? memory;
    statusText = memory
      ? `Memoire de ${target.label} partagee avec tous ses chats`
      : `Memoire de ${target.label} effacee`;
  } catch (error) {
    settings.workspaces = previousWorkspaces;
    statusText = String(error);
  } finally {
    environmentMemorySaving = false;
    render();
  }
};

// Ajoute un dossier au registre synchronise s'il en est absent, puis persiste.
const upsertWorkspaceRegistry = async (path: string): Promise<void> => {
  if (!settings) return;
  const trimmed = userEnvironmentPath(path);
  if (!trimmed) return;
  rememberWorkspace(trimmed);
  const update = openWorkspaceRegistry(
    settings.workspaces ?? [],
    settings.closedWorkspaceIds ?? [],
    trimmed,
  );
  if (!update.changed) return;
  settings.workspaces = update.workspaces;
  settings.closedWorkspaceIds = update.closedWorkspaceIds;
  try {
    settings = await invoke<AppSettings>("save_settings", { settings });
  } catch (error) {
    statusText = String(error);
  }
};

// Migration au demarrage : peuple le registre synchronise depuis le MRU + le
// workspace actif locaux (utilisateurs existants), miroir le registre dans le
// MRU local (nouvel appareil), puis fixe un filtre par defaut pour cet appareil.
const syncWorkspaceRegistry = async (): Promise<void> => {
  if (!settings) return;
  const storedClosedIds = settings.closedWorkspaceIds ?? [];
  const normalizedClosedIds = mergeClosedWorkspaceIds(storedClosedIds);
  const closedIds = new Set(normalizedClosedIds);
  const merged = mergeWorkspaceProfiles(settings.workspaces ?? []);
  const openProfiles = merged.workspaces.filter((workspace) => !closedIds.has(workspace.id));
  const byId = new Map<string, WorkspaceProfile>(
    openProfiles.map((ws) => [ws.id, ws]),
  );
  let changed =
    merged.changed ||
    openProfiles.length !== merged.workspaces.length ||
    normalizedClosedIds.length !== storedClosedIds.length ||
    normalizedClosedIds.some(
      (closedId, index) => closedId !== storedClosedIds[index],
    );

  settings.closedWorkspaceIds = normalizedClosedIds;

  const rememberedPaths = loadWorkspacePaths();
  const openRememberedPaths = rememberedPaths.filter(
    (path) => !closedIds.has(workspaceIdForPath(path)),
  );
  if (openRememberedPaths.length !== rememberedPaths.length) {
    storeWorkspacePaths(openRememberedPaths);
  }
  const activePath = currentWorkspace();
  if (activePath && closedIds.has(workspaceIdForPath(activePath))) {
    setCurrentWorkspace(null);
    setChatWorkspaceFilter(WORKSPACE_ALL);
  }

  const seed = (rawPath: string | null | undefined) => {
    const path = rawPath?.trim();
    if (!path) return;
    const id = workspaceIdForPath(path);
    if (closedIds.has(id)) return;
    if (!byId.has(id)) {
      byId.set(id, { id, label: workspaceBaseName(path), path, memory: "" });
      changed = true;
    }
  };
  seed(currentWorkspace());
  openRememberedPaths.forEach(seed);

  // Miroir inverse : rend les workspaces synchronises visibles sur cet appareil.
  byId.forEach((ws) => rememberWorkspace(ws.path));

  // Sur le web, localStorage appartient au navigateur et peut donc etre vide
  // alors que le serveur connait deja le projet. Avec un seul environnement il
  // n'existe aucune ambiguite : l'activer evite un ecran de selection inutile.
  if (!currentWorkspace() && byId.size === 1) {
    const onlyWorkspace = byId.values().next().value as WorkspaceProfile | undefined;
    if (onlyWorkspace) {
      setCurrentWorkspace(onlyWorkspace.path);
      setChatWorkspaceFilter(onlyWorkspace.id);
    }
  }

  if (changed) {
    settings.workspaces = [...byId.values()];
    try {
      settings = await invoke<AppSettings>("save_settings", { settings });
    } catch {
      // best-effort : la migration retentera au prochain demarrage.
    }
  }

  // Valeur de compatibilite pour les utilisateurs existants. La barre laterale
  // affiche desormais tous les groupes, quelle que soit cette selection.
  if (chatWorkspaceFilterRaw() === null) {
    setChatWorkspaceFilter(WORKSPACE_ALL);
  }
};

const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const EMPTY_TERMINAL_STATE: PersistedTerminalState = { v: 4, activeKey: null, terminals: [] };

const loadOpenTerminalRecords = (): PersistedTerminalState => {
  try {
    const raw =
      localStorage.getItem(OPEN_TERMINALS_STORAGE_KEY) ??
      LEGACY_OPEN_TERMINALS_STORAGE_KEYS
        .map((key) => localStorage.getItem(key))
        .find((value): value is string => value !== null);
    if (!raw) return { ...EMPTY_TERMINAL_STATE };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.terminals)) return { ...EMPTY_TERMINAL_STATE };
    const legacyWorkspaceWasFolder = Number(parsed.v ?? 3) < 4;

    const terminals = parsed.terminals
      .map((item: any): PersistedTerminalRecord | null => {
        if (!item || typeof item.key !== "string" || typeof item.accountId !== "string") {
          return null;
        }
        return {
          key: item.key,
          accountId: item.accountId,
          agentId: typeof item.agentId === "string" ? item.agentId : "codex",
          codexSessionId: typeof item.codexSessionId === "string" ? item.codexSessionId : null,
          folderPath:
            typeof item.folderPath === "string"
              ? item.folderPath
              : legacyWorkspaceWasFolder && typeof item.workspacePath === "string"
                ? item.workspacePath
                : null,
          workspaceId: typeof item.workspaceId === "string" ? item.workspaceId : null,
          workspacePath:
            !legacyWorkspaceWasFolder && typeof item.workspacePath === "string"
              ? item.workspacePath
              : null,
          projectDir: typeof item.projectDir === "string" ? item.projectDir : null,
        };
      })
      .filter((item: PersistedTerminalRecord | null): item is PersistedTerminalRecord => item !== null);

    return {
      v: 4,
      activeKey: typeof parsed.activeKey === "string" ? parsed.activeKey : null,
      terminals,
    };
  } catch {
    return { ...EMPTY_TERMINAL_STATE };
  }
};

const saveOpenTerminalRecords = (state: PersistedTerminalState) => {
  localStorage.setItem(OPEN_TERMINALS_STORAGE_KEY, JSON.stringify(state));
  LEGACY_OPEN_TERMINALS_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
};

const persistTerminalSessions = () => {
  // Les PTY sont charges paresseusement. Ne jamais ecraser leur etat persiste
  // tant que le mur de terminaux n'a pas ete ouvert. Un terminal de login peut
  // exister avant cette restauration, mais il est volontairement temporaire.
  if (!terminalRestoreAttempted) return;
  saveOpenTerminalRecords({
    v: 4,
    activeKey: activeTerminalKey,
    terminals: terminalSessions
      .filter((session) => session.status !== "Ferme" && !session.loginOnly)
      .map((session) => ({
        key: session.key,
        accountId: session.accountId,
        agentId: session.agentId,
        codexSessionId: session.codexSessionId,
        folderPath: session.folderPath,
        workspaceId: session.workspaceId,
        workspacePath: session.workspacePath,
        projectDir: session.projectDir,
      })),
  });
};

// --- Reprise des discussions Codex ---------------------------------------
// Un rollout Codex = une discussion (rollout-<ts>-<uuid>.jsonl). On garde
// l'uuid (session id) pour relancer `codex resume <uuid>` a la reouverture.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const isPlausibleSessionId = (id: string | null | undefined): id is string => !!id && UUID_RE.test(id);

// Commande de reprise d'une discussion, selon le provider du compte cible :
// Codex -> `codex … resume <id>` ; Claude -> `claude … --resume <id>`. Le flag
// bypass (propre au provider) est ajoute par `agentRunCommand`.
const buildResumeCommand = (id: string, account: AccountProfile | null | undefined = null) => {
  const provider = accountProvider(account);
  const base = agentRunCommand(agentById(providerAgentId(provider)), account);
  return provider === "claude" ? `${base} --resume ${id}` : `${base} resume ${id}`;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SESSION_CAPTURE_DELAYS_MS = [1200, 2000, 3000, 4500, 7000, 10000];

// Ids de sessions Codex deja attribues a un terminal (capture ou reprise). Sert
// a garantir qu'un meme rollout n'est jamais revendique par deux terminaux.
const claimedSessionIds = new Set<string>();
// File d'attente serialisant les appels claim_session_for_terminal : deux
// captures simultanees ne doivent pas revendiquer le meme rollout en meme
// temps. Chaque claim voit les ids deja pris et enregistre le sien avant le
// claim suivant.
let claimQueue: Promise<unknown> = Promise.resolve();

const claimSessionForTerminal = (session: TerminalSession): Promise<string | null> => {
  const run = async (): Promise<string | null> => {
    if (session.sessionCaptureDone || session.codexSessionId) return null;
    if (!terminalSessions.includes(session) || session.ptyId === null) return null;
    const afterUnix = session.startedAtUnix ?? Math.floor(Date.now() / 1000);
    const exclude = Array.from(
      new Set<string>([
        ...claimedSessionIds,
        ...terminalSessions
          .filter((other) => other !== session && other.codexSessionId)
          .map((other) => other.codexSessionId as string),
      ]),
    );
    const id = await invoke<string | null>("claim_session_for_terminal", {
      accountId: session.accountId,
      afterUnix,
      excludeSessionIds: exclude,
      matchSessionId: session.resumeSessionId,
    });
    if (id) claimedSessionIds.add(id);
    return id;
  };
  const result = claimQueue.then(run, run);
  claimQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

// Apres le lancement de Codex dans un terminal, retrouve l'uuid du rollout que
// Codex vient de creer afin de l'associer a ce terminal (puis le persister).
const captureCodexSessionId = async (session: TerminalSession) => {
  if (session.sessionCaptureDone) return;

  for (const delay of SESSION_CAPTURE_DELAYS_MS) {
    if (!terminalSessions.includes(session) || session.ptyId === null) return;
    await sleep(delay);
    if (!terminalSessions.includes(session) || session.ptyId === null) return;

    try {
      const id = await claimSessionForTerminal(session);
      if (id) {
        session.codexSessionId = id;
        session.sessionCaptureDone = true;
        persistTerminalSessions();
        return;
      }
    } catch {
      // transitoire : on retente au prochain delai
    }
  }

  if (session.resumeSessionId && !session.codexSessionId) {
    session.codexSessionId = session.resumeSessionId;
    claimedSessionIds.add(session.resumeSessionId);
  }
  session.sessionCaptureDone = true;
  persistTerminalSessions();
};

const reservePtyId = () => {
  ptyIdSeed += 1;
  return ptyIdSeed;
};

const waitForFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const selectedAccount = () =>
  settings?.accounts.find((account) => account.id === selectedAccountId) ?? null;

const newTerminalAccount = () =>
  settings?.accounts.find((account) => account.id === newTerminalAccountId) ?? null;

const agentById = (id: string | null | undefined) =>
  settings?.agents.find((agent) => agent.id === id) ?? null;

const accountById = (id: string | null | undefined) =>
  settings?.accounts.find((account) => account.id === id) ?? null;

const activeAgent = () => agentById(settings?.activeAgentId) ?? settings?.agents[0] ?? null;

const newTerminalAgent = () => agentById(newTerminalAgentId) ?? activeAgent();

// L'id de l'agent Codex integre : le pool (comptes Codex + OAuth ChatGPT) doit
// toujours lancer Codex, quel que soit l'agent actif dans la barre d'outils.
const codexAgentId = () =>
  settings?.agents.find((agent) => agent.id === "codex")?.id ??
  settings?.agents.find((agent) => agent.builtin)?.id ??
  "codex";

// --- Multi-provider (Codex / Claude Code) --------------------------------
// Provider d'un compte / d'un agent (defaut Codex pour les configs anterieures).
const accountProvider = (account: AccountProfile | null | undefined): Provider =>
  account?.provider ?? "codex";
const agentProvider = (agent: AgentProfile | null | undefined): Provider =>
  agent?.provider ?? (agent?.id === "claude" ? "claude" : "codex");
const providerLabel = (provider: Provider) => (provider === "claude" ? "Claude" : "Codex");

// Id de l'agent integre correspondant a un provider : sert a lancer un compte
// Claude avec l'agent Claude, un compte Codex avec l'agent Codex.
const providerAgentId = (provider: Provider): string =>
  settings?.agents.find((agent) => (agent.provider ?? "codex") === provider && agent.builtin)?.id ??
  settings?.agents.find((agent) => agent.id === provider)?.id ??
  provider;

const agentCommand = (agent: AgentProfile | null | undefined) => agent?.command.trim() || "codex";

// Agent CLI "premier rang" (Codex ou Claude Code integre) : recoit un flag
// bypass et voit ses sessions capturees pour la reprise. Un agent CLI generique
// (autre binaire) n'en beneficie pas.
const isFirstPartyAgent = (agent: AgentProfile | null | undefined) =>
  agent?.builtin === true || agent?.id === "codex" || agent?.id === "claude";

// Vrai uniquement pour un agent Codex (chemins specifiques au pool ChatGPT).
const isCodexAgent = (agent: AgentProfile | null | undefined) => agentProvider(agent) === "codex";

const CODEX_BYPASS_FLAG = "--dangerously-bypass-approvals-and-sandbox";
const CLAUDE_BYPASS_FLAG = "--dangerously-skip-permissions";
const providerBypassFlag = (provider: Provider) =>
  provider === "claude" ? CLAUDE_BYPASS_FLAG : CODEX_BYPASS_FLAG;

// Le bypass est un reglage PAR COMPTE (defaut ON). Un compte sans champ `bypass`
// (config anterieure) retombe sur le defaut global `codexBypass`, puis `true`.
const accountBypassEnabled = (account: AccountProfile | null | undefined) =>
  account?.bypass ?? settings?.codexBypass ?? true;

const isCodexReasoningEffort = (value: string | null | undefined): value is CodexReasoningEffort =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{0,31}$/.test(value);

const normalizeCodexReasoningEffort = (
  value: string | null | undefined,
): CodexReasoningEffort =>
  isCodexReasoningEffort(value) ? value : DEFAULT_CODEX_REASONING_EFFORT;

const providerDefaultModel = (provider: Provider) =>
  provider === "claude" ? DEFAULT_CLAUDE_MODEL : DEFAULT_CODEX_MODEL;

const accountModel = (account: AccountProfile | null | undefined) =>
  account?.model?.trim() || providerDefaultModel(accountProvider(account));

const accountReasoningEffort = (account: AccountProfile | null | undefined) =>
  normalizeCodexReasoningEffort(account?.reasoningEffort);

const reasoningEffortLabel = (effort: CodexReasoningEffort) =>
  CODEX_REASONING_EFFORTS.find((item) => item.value === effort)?.label ?? effort;

const chatCatalogModel = (
  account: AccountProfile | null | undefined,
  model: string,
): AccountModelView | null =>
  (account ? chatModelCatalogs.get(account.id) : undefined)?.find(
    (candidate) => candidate.id.toLocaleLowerCase() === model.toLocaleLowerCase(),
  ) ?? null;

const fallbackReasoningEffortsForModel = (model: string): CodexReasoningEffort[] => {
  const normalized = model.toLocaleLowerCase();
  if (normalized === "gpt-5.6-sol" || normalized === "gpt-5.6-terra") {
    return ["low", "medium", "high", "xhigh", "max", "ultra"];
  }
  if (normalized === "gpt-5.6-luna") {
    return ["low", "medium", "high", "xhigh", "max"];
  }
  return ["low", "medium", "high", "xhigh"];
};

const reasoningEffortsForChatModel = (
  account: AccountProfile | null | undefined,
  model: string,
): CodexReasoningEffort[] => {
  const advertised =
    chatCatalogModel(account, model)?.supportedReasoningEfforts
      .map((item) => item.reasoningEffort)
      .filter(isCodexReasoningEffort) ?? [];
  return advertised.length ? advertised : fallbackReasoningEffortsForModel(model);
};

const reasoningEffortForChatModel = (
  account: AccountProfile | null | undefined,
  model: string,
  requested: string | null | undefined,
): CodexReasoningEffort => {
  const supported = reasoningEffortsForChatModel(account, model);
  if (isCodexReasoningEffort(requested) && supported.includes(requested)) return requested;
  const advertisedDefault = chatCatalogModel(account, model)?.defaultReasoningEffort;
  if (isCodexReasoningEffort(advertisedDefault) && supported.includes(advertisedDefault)) {
    return advertisedDefault;
  }
  if (supported.includes(DEFAULT_CODEX_REASONING_EFFORT)) {
    return DEFAULT_CODEX_REASONING_EFFORT;
  }
  return supported[0] ?? DEFAULT_CODEX_REASONING_EFFORT;
};

const chatReasoningEffortOptions = (
  account: AccountProfile | null | undefined,
  model: string,
) =>
  reasoningEffortsForChatModel(account, model).map((value) => ({
    value,
    label: reasoningEffortLabel(value),
  }));

const loadChatModelCatalog = async (accountId: string | null | undefined) => {
  if (!accountId || chatModelCatalogs.has(accountId) || chatModelCatalogLoads.has(accountId)) return;
  const account = accountById(accountId);
  if (!account || accountProvider(account) !== "codex") return;
  chatModelCatalogLoads.add(accountId);
  try {
    const catalog = await invoke<AccountModelView[]>("account_model_catalog", { accountId });
    if (catalog.length) chatModelCatalogs.set(accountId, catalog);
  } catch {
    // Les valeurs de secours restent utilisables avec un ancien backend/CLI.
  } finally {
    chatModelCatalogLoads.delete(accountId);
    const visiblePanes = expertChatPanes.filter(
      (pane) => expertChatSelectedAccount(pane)?.id === accountId,
    );
    // Le catalogue ne modifie que les controles modele/effort des panneaux
    // concernes. Un rendu global demonterait tous les chats pour cette seule
    // mise a jour, ce qui rendait surtout les changements de compte saccades.
    if (activeView === "chat") {
      visiblePanes.forEach((pane) => refreshExpertChatPane(pane));
    }
  }
};

const reasoningEffortOptions = (selected: string | null | undefined) => {
  const normalized = normalizeCodexReasoningEffort(selected);
  return CODEX_REASONING_EFFORTS.map(
    (item) =>
      `<option value="${item.value}" ${item.value === normalized ? "selected" : ""}>${item.label}</option>`,
  ).join("");
};

const renderCodexModelSuggestions = () => `
  <datalist id="codexModelSuggestions">
    ${[...CODEX_MODEL_SUGGESTIONS, ...CLAUDE_MODEL_SUGGESTIONS]
      .map((model) => `<option value="${escapeAttr(model)}"></option>`)
      .join("")}
  </datalist>
`;

const provisionAccountHome = (account: AccountProfile) =>
  invoke("ensure_account_home", {
    codexHome: account.codexHome,
    provider: accountProvider(account),
    bypass: accountBypassEnabled(account),
    model: accountModel(account),
    reasoningEffort: accountReasoningEffort(account),
  });

// Commande a taper dans le PTY pour lancer un agent. Pour Codex, ajoute le flag
// bypass quand le compte concerne l'a active (defaut), sauf s'il est deja
// present dans une commande personnalisee.
const agentRunCommand = (
  agent: AgentProfile | null | undefined,
  account: AccountProfile | null | undefined = null,
) => {
  const base = agentCommand(agent);
  if (isFirstPartyAgent(agent) && accountBypassEnabled(account)) {
    const flag = providerBypassFlag(agentProvider(agent));
    if (!base.includes(flag)) return `${base} ${flag}`;
  }
  return base;
};

const agentIsIde = (agent: AgentProfile | null | undefined) => agent?.kind === "ide";

// Dossier projet a ouvrir pour un agent IDE / Kombai. Pour une action liee au
// terminal actif, son workspace gagne toujours sur le selecteur global.
const currentProjectDir = () =>
  activeTerminal()?.workspacePath ??
  currentWorkspace() ??
  activeTerminal()?.projectDir ??
  selectedAccount()?.projectDir?.trim() ??
  null;

const launchIde = async (agent: AgentProfile, projectDir: string | null = currentProjectDir()) => {
  try {
    await invoke("launch_ide", { command: agentCommand(agent), projectDir });
    statusText = projectDir
      ? `${agent.label} ouvert dans ${agent.command} (${projectDir})`
      : `${agent.label} ouvert dans ${agent.command}`;
  } catch (error) {
    statusText = String(error);
  }
  render();
};

const agentSubcommand = (agent: AgentProfile | null | undefined, sub?: string | null) => {
  const base = agentCommand(agent);
  const suffix = sub?.trim();
  return suffix ? `${base} ${suffix}` : base;
};

// Une reconnexion Codex doit d'abord retirer les credentials locaux : `codex
// login` seul peut conserver un auth.json present mais revoque. Le separateur
// `;` fonctionne avec PowerShell et les shells POSIX ; cmd.exe utilise `&`.
const shellCommandSeparator = () => {
  const shell = (settings?.shell ?? "").trim().toLowerCase().replaceAll("\\", "/");
  const executable = shell.split("/").pop() ?? shell;
  return executable === "cmd" || executable === "cmd.exe" ? " & " : "; ";
};

const reconnectCommandForAccount = (
  account: AccountProfile,
  agent: AgentProfile | null | undefined,
) => {
  const provider = accountProvider(account);
  const loginSub =
    agent?.loginCommand?.trim() || (provider === "claude" ? "auth login" : "login");
  // Connexion classique : on ouvre le flux OAuth standard (callback navigateur),
  // sans passer par les codes du device flow, y compris en mode remote/Tailscale.
  const loginCommand = agentSubcommand(agent, loginSub);
  return provider === "codex"
    ? `${agentSubcommand(agent, "logout")}${shellCommandSeparator()}${loginCommand}`
    : loginCommand;
};

const setActiveAgent = (id: string | null) => {
  if (!settings) return;
  if (!settings.agents.some((agent) => agent.id === id)) return;
  settings.activeAgentId = id;
  const agent = agentById(id);
  statusText = agent ? `Agent actif: ${agent.label}` : "Agent actif";
  render();
  void invoke<AppSettings>("save_settings", { settings }).catch(() => undefined);
};

const proxyControlsEnabled = () => settings?.proxyControlsEnabled ?? true;

const proxyForAccount = (account: AccountProfile | null) =>
  proxyControlsEnabled() ? (settings?.proxies.find((proxy) => proxy.id === account?.proxyId) ?? null) : null;

const selectedProxy = () => proxyForAccount(selectedAccount());

const activeTerminal = () =>
  terminalSessions.find((session) => session.key === activeTerminalKey) ?? null;

const terminalSessionsForFolder = (folderPath: string | null | undefined) =>
  terminalsForFolder(terminalSessions, folderPath);

const expertTerminalSessions = () =>
  terminalFolderFilter === null
    ? []
    : terminalSessionsForFolder(terminalFolderFilter).slice(0, EXPERT_MAX_TERMINALS);

const expertGridSlotCount = () => Math.max(2, expertTerminalSessions().length);

const expertGridColumnCount = (slotCount = expertGridSlotCount()) => {
  if (expertGridLayout !== "auto") {
    return Math.min(Number(expertGridLayout), slotCount);
  }
  if (slotCount <= 2) return 2;
  if (slotCount <= 4) return 2;
  if (slotCount <= 9) return 3;
  return 4;
};

type TerminalWorkspaceGroup = {
  key: string;
  path: string | null;
  label: string;
  detail: string;
  selectable: boolean;
  sessions: TerminalSession[];
};

const DEFAULT_WORKSPACE_KEY = "workspace:default";

const workspaceKeyForPath = (path: string) => `workspace:${normalizeWorkspacePath(path)}`;

const terminalWorkspaceDescriptor = (
  session: TerminalSession,
): Omit<TerminalWorkspaceGroup, "sessions"> => {
  const folderPath = session.folderPath?.trim();
  if (folderPath) {
    return {
      key: workspaceKeyForPath(folderPath),
      path: folderPath,
      label: workspaceBaseName(folderPath),
      detail: folderPath,
      selectable: true,
    };
  }

  // En mode web, projectDir est une URL Git et non un chemin navigable du
  // serveur. On regroupe quand meme les terminaux du meme depot, sans proposer
  // cette URL comme workspace existant.
  const repository = isRemoteMode() ? session.projectDir?.trim() : null;
  if (repository) {
    return {
      key: `repository:${repository.toLocaleLowerCase()}`,
      path: null,
      label: workspaceBaseName(repository),
      detail: repository,
      selectable: false,
    };
  }

  return {
    key: DEFAULT_WORKSPACE_KEY,
    path: null,
    label: "Sans environnement",
    detail: isRemoteMode() ? "Environnement genere par le serveur" : "Environnement non selectionne",
    selectable: true,
  };
};

const terminalWorkspaceGroups = (): TerminalWorkspaceGroup[] => {
  const groups = new Map<string, TerminalWorkspaceGroup>();
  const addPath = (path: string, label = workspaceBaseName(path)) => {
    const trimmed = path.trim();
    if (!trimmed) return;
    const key = workspaceKeyForPath(trimmed);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        path: trimmed,
        label,
        detail: trimmed,
        selectable: true,
        sessions: [],
      });
    }
  };

  // La liste canonique contient le registre synchronise, le MRU local, le
  // workspace actif et ceux derives des discussions. Un meme chemin ne cree
  // donc qu'un groupe, auquel toutes ses sessions sont ajoutees ci-dessous.
  knownWorkspaces().forEach((workspace) => addPath(workspace.path, workspace.label));

  terminalSessions.forEach((session) => {
    const descriptor = terminalWorkspaceDescriptor(session);
    let group = groups.get(descriptor.key);
    if (!group) {
      group = { ...descriptor, sessions: [] };
      groups.set(descriptor.key, group);
    }
    group.sessions.push(session);
  });

  if (groups.size === 0) {
    groups.set(DEFAULT_WORKSPACE_KEY, {
      key: DEFAULT_WORKSPACE_KEY,
      path: null,
      label: "Sans environnement",
      detail: isRemoteMode() ? "Environnement genere par le serveur" : "Environnement non selectionne",
      selectable: true,
      sessions: [],
    });
  }

  return Array.from(groups.values());
};

type TerminalEnvironmentGroup = TerminalWorkspaceGroup & { path: string };

const terminalEnvironmentGroups = (): TerminalEnvironmentGroup[] =>
  terminalWorkspaceGroups().filter((group): group is TerminalEnvironmentGroup => {
    const path = userEnvironmentPath(group.path);
    return !!path && !workspaceIsClosed(path);
  }).sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      normalizeWorkspacePath(left.path).localeCompare(normalizeWorkspacePath(right.path)),
  );

// L'environnement est le contexte global de travail des conversations et terminaux.
const selectEnvironment = (path: string): void => {
  const returnFocus = takeDialogTrigger("environment");
  const environmentPath = userEnvironmentPath(path);
  if (!environmentPath) {
    statusText = "Les workspaces techniques des agents ne peuvent pas devenir des environnements";
    terminalEnvironmentMenuOpen = false;
    clearEnvironmentMemoryDraft();
    render();
    restoreDialogTrigger(returnFocus);
    return;
  }
  setCurrentWorkspace(environmentPath);
  setChatWorkspaceFilter(workspaceIdForPath(environmentPath));
  pendingChatWorkspace = null;
  terminalFolderFilter = environmentPath;
  terminalEnvironmentMenuOpen = false;
  clearEnvironmentMemoryDraft();
  expertChatFullscreenKey = null;
  expertTerminalFullscreenKey = null;
  void upsertWorkspaceRegistry(environmentPath);
  expertChatPage = 0;
  reconcileExpertChatPage();
  setActiveView("chat");
  restoreDialogTrigger(returnFocus);
};

const openTerminalEnvironmentMenu = () => {
  if (!settings) return;
  rememberDialogTrigger("environment", "wsOpenFolder");
  clearEnvironmentMemoryDraft();
  terminalEnvironmentMenuOpen = true;
  statusText = "Menu des environnements";
  render();
};

const closeTerminalEnvironmentMenu = () => {
  if (!terminalEnvironmentMenuOpen) return;
  const returnFocus = takeDialogTrigger("environment");
  terminalEnvironmentMenuOpen = false;
  clearEnvironmentMemoryDraft();
  render();
  restoreDialogTrigger(returnFocus);
};

const toggleTerminalEnvironmentMenu = () => {
  if (terminalEnvironmentMenuOpen) closeTerminalEnvironmentMenu();
  else openTerminalEnvironmentMenu();
};

const activateTerminalSession = (session: TerminalSession) => {
  activeTerminalKey = session.key;
  selectedAccountId = session.accountId;
  // Un terminal deja ouvert reste utilisable apres fermeture de son dossier,
  // sans le rouvrir implicitement. Seule une action explicite sur le groupe ou
  // le selecteur retire le tombstone synchronise.
  if (!session.folderPath || !workspaceIsClosed(session.folderPath)) {
    setCurrentWorkspace(session.folderPath);
  }
  terminalFolderFilter = session.folderPath;
  if (settings && session.agentId && settings.agents.some((agent) => agent.id === session.agentId)) {
    settings.activeAgentId = session.agentId;
  }
};

const toggleExpertTerminalFullscreen = (session: TerminalSession) => {
  if (!terminalSessions.includes(session)) return;
  expertTerminalFullscreenKey =
    expertTerminalFullscreenKey === session.key ? null : session.key;
  activateTerminalSession(session);
  requestTerminalFocusKey = session.key;
  statusText = expertTerminalFullscreenKey
    ? `Terminal en plein ecran: ${terminalTitle(session)}`
    : "Mur de terminaux";
  render();
};

const fitAndResizeTerminal = (session: TerminalSession) => {
  const element = session.terminal.element;
  const host = element?.parentElement;
  if (!host || host.clientWidth < 2 || host.clientHeight < 2) return;

  try {
    session.fitAddon.fit();
  } catch {
    return;
  }

  if (session.ptyId !== null) {
    void invoke("resize_terminal", {
      id: session.ptyId,
      cols: session.terminal.cols,
      rows: session.terminal.rows,
    }).catch(() => undefined);
  }
};

const fitAndResizeActiveTerminal = () => {
  const session = activeTerminal();
  if (session) fitAndResizeTerminal(session);
};

const fitAndResizeExpertTerminals = () => {
  expertTerminalSessions().forEach(fitAndResizeTerminal);
};

const fitAndResizeVisibleTerminals = () => {
  if (activeView === "terminal") {
    fitAndResizeExpertTerminals();
  } else {
    fitAndResizeActiveTerminal();
  }
};

const projectFieldLabel = () => (isRemoteMode() ? "Repo Git optionnel" : "Environnement projet");
const projectFieldPlaceholder = () =>
  isRemoteMode() ? "https://github.com/org/repo.git" : "C:\\chemin\\vers\\projet";
const displayProjectDir = (projectDir?: string | null) =>
  projectDir?.trim() || (isRemoteMode() ? "environnement vide" : "environnement non selectionne");

const maskProxy = (value: string) =>
  value.replace(/:\/\/([^:@/]+):([^@/]+)@/, "://$1:***@");

let fullscreenToggleInFlight = false;
let fullscreenSyncQueued = false;
let fullscreenSyncFrame: number | null = null;

const scheduleFullscreenSync = () => {
  if (fullscreenToggleInFlight) {
    fullscreenSyncQueued = true;
    return;
  }
  if (fullscreenSyncFrame !== null) return;

  fullscreenSyncFrame = window.requestAnimationFrame(() => {
    fullscreenSyncFrame = null;
    void appWindow.isFullscreen().then(async (fullscreen) => {
      if (fullscreen === isFullscreen) return;
      isFullscreen = fullscreen;
      statusText = fullscreen ? "Mode plein ecran" : "Mode fenetre";
      render();
      await waitForFrame();
      fitAndResizeVisibleTerminals();
    }).catch(() => undefined);
  });
};

const toggleFullscreen = async () => {
  fullscreenToggleInFlight = true;
  try {
    const nextFullscreen = !(await appWindow.isFullscreen());
    await appWindow.setFullscreen(nextFullscreen);
    isFullscreen = await appWindow.isFullscreen();
    statusText = isFullscreen ? "Mode plein ecran" : "Mode fenetre";
    render();
    await waitForFrame();
    fitAndResizeVisibleTerminals();
  } catch (error) {
    statusText = String(error);
    render();
  } finally {
    fullscreenToggleInFlight = false;
    if (fullscreenSyncQueued) {
      fullscreenSyncQueued = false;
      scheduleFullscreenSync();
    }
  }
};

const saveSettings = async () => {
  if (!settings) return;
  try {
    settings.defaultAccountId = selectedAccountId;
    settings = await invoke<AppSettings>("save_settings", { settings });
    reconcileAccountSelections();
    scheduleUnconnectedAccountCleanup();
    const account = selectedAccount();
    if (account) {
      await provisionAccountHome(account);
    }
    statusText = "Configuration enregistree";
  } catch (error) {
    statusText = String(error);
  }
  render();
};

const readPoolForm = () => {
  if (!settings) return;
  const port = Number(document.querySelector<HTMLInputElement>("#poolPort")?.value);
  if (Number.isFinite(port) && port > 0) settings.pool.port = port;
  settings.pool.defaultModel =
    document.querySelector<HTMLInputElement>("#poolModel")?.value.trim() || settings.pool.defaultModel;
  settings.pool.reasoningEffort =
    document.querySelector<HTMLInputElement>("#poolEffort")?.value.trim() || settings.pool.reasoningEffort;
  settings.pool.apiKey = document.querySelector<HTMLInputElement>("#poolApiKey")?.value ?? "";
  settings.pool.upstream =
    document.querySelector<HTMLInputElement>("#poolUpstream")?.value.trim() || settings.pool.upstream;
  poolImportPaths = document.querySelector<HTMLTextAreaElement>("#poolImportPaths")?.value ?? poolImportPaths;
};

const startPool = async () => {
  if (!settings) return;
  readPoolForm();
  try {
    settings = await invoke<AppSettings>("save_settings", { settings });
    poolStatus = await invoke<PoolStatus>("pool_start");
    statusText = `Pool actif sur ${poolStatus.baseUrl ?? ""}`;
    startPoolPoll();
  } catch (error) {
    statusText = String(error);
  }
  render();
};

const stopPool = async () => {
  try {
    poolStatus = await invoke<PoolStatus>("pool_stop");
    stopPoolPoll();
    statusText = "Pool arrete";
  } catch (error) {
    statusText = String(error);
  }
  render();
};

const refreshPoolStatus = async () => {
  if (poolStatusInFlight) return;
  poolStatusInFlight = true;
  try {
    try {
      poolStatus = await invoke<PoolStatus>("pool_status");
    } catch {
      return;
    }
    const nextRowsSignature = JSON.stringify(poolStatus.accounts ?? []);
    const rowsChanged = nextRowsSignature !== poolRowsSignature;
    poolRowsSignature = nextRowsSignature;
    if (activeView === "pool") {
      const runtimeStatus = document.querySelector<HTMLElement>("#poolRuntimeStatus");
      const startButton = document.querySelector<HTMLButtonElement>("#poolStart");
      const stopButton = document.querySelector<HTMLButtonElement>("#poolStop");
      if (runtimeStatus) runtimeStatus.textContent = poolRuntimeSummary();
      if (startButton) startButton.disabled = poolStatus.running;
      if (stopButton) stopButton.disabled = !poolStatus.running;
    }
    if (activeView === "pool" && poolStatus?.running && rowsChanged) {
      const rows = document.querySelector<HTMLTableSectionElement>("#poolRows");
      if (rows) {
        rows.innerHTML = poolStatus.accounts?.map(renderPoolRow).join("") ?? "";
        renderIcons(rows);
      } else {
        render();
      }
    }
  } finally {
    poolStatusInFlight = false;
  }
};

const startPoolPoll = () => {
  stopPoolPoll();
  poolPoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshPoolStatus()),
    3000,
  );
};

const stopPoolPoll = () => {
  if (poolPoll !== null) {
    clearInterval(poolPoll);
    poolPoll = null;
  }
};

const bindVoiceRuntimeRefresh = (root: ParentNode = document) => {
  root.querySelector<HTMLButtonElement>("#voiceRuntimeRefresh")?.addEventListener("click", () => {
    void refreshVoiceRuntimeStatus();
  });
};

const patchVoiceRuntimeStatus = () => {
  if (activeView !== "settings") return;
  const card = document.querySelector<HTMLElement>("#voiceRuntimeStatus");
  if (!card) return;
  card.innerHTML = renderVoiceRuntimeStatusContent();
  renderIcons(card);
  bindVoiceRuntimeRefresh(card);
};

const refreshVoiceRuntimeStatus = async () => {
  if (voiceRuntimeInFlight) return;
  voiceRuntimeInFlight = true;
  voiceRuntimeError = null;
  patchVoiceRuntimeStatus();
  try {
    voiceRuntimeStatus = await invoke<VoiceRuntimeStatus>("voice_runtime_status");
  } catch (error) {
    voiceRuntimeError = String(error).replace(/^Error:\s*/i, "");
  } finally {
    voiceRuntimeInFlight = false;
    patchVoiceRuntimeStatus();
  }
};

const startVoiceRuntimePoll = () => {
  if (voiceRuntimePoll !== null) return;
  voiceRuntimePoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshVoiceRuntimeStatus()),
    2_000,
  );
};

const stopVoiceRuntimePoll = () => {
  if (voiceRuntimePoll !== null) {
    clearInterval(voiceRuntimePoll);
    voiceRuntimePoll = null;
  }
};


// ---------------------------------------------------------------------------
// Audit design (détecteur Impeccable, exécuté côté navigateur)
// ---------------------------------------------------------------------------
// Le détecteur Impeccable (bundle autonome Apache-2.0, vendu dans
// public/impeccable/) analyse la PAGE COURANTE et renvoie la liste des
// anti-patterns de design. Il tourne dans le navigateur, donc identiquement en
// desktop (webview Tauri) et en web/mobile — aucun backend requis. On force
// `autoScan:false` pour qu'il ne dessine aucun overlay au chargement : la
// détection n'a lieu que sur clic du bouton « Auditer cette page ».

const IMPECCABLE_DETECTOR_SRC = "/impeccable/detect-antipatterns-browser.js";
// error < warning < advisory ; les sévérités inconnues sont triées en dernier.
const AUDIT_SEVERITY_RANK: Record<string, number> = { error: 0, warning: 1, advisory: 2 };
// Sévérité inconnue → triée après les sévérités connues.
const auditSeverityRank = (severity: string): number =>
  AUDIT_SEVERITY_RANK[severity] ?? Number.MAX_SAFE_INTEGER;
// Message « rien à signaler » (source unique, affiché une seule fois).
const AUDIT_CLEAN_MESSAGE = "Aucun anti-pattern détecté 🎉";

// Libellé FR de la vue auditée, pour l'en-tête du rapport.
const auditViewLabelFor = (view: AppView): string => {
  switch (view) {
    case "audit":
      return "écran d'audit";
    case "pool":
      return "vue Pool";
    case "limits":
      return "vue Limites";
    case "dashboard":
      return "vue Stats";
    case "kombai":
      return "vue Kombai";
    case "discussions":
      return "vue Discussions";
    case "history":
      return "vue Historique";
    case "prompts":
      return "bibliothèque de prompts";
    case "scheduled-chat":
      return "vue Chat planifié";
    case "settings":
      return "vue Paramètres";
    case "chat":
      return "vue Conversation";
    default:
      return "vue Terminal";
  }
};

type ImpeccableWindow = Window & {
  impeccableDetect?: (options?: Record<string, unknown>) => unknown;
  __IMPECCABLE_CONFIG__?: Record<string, unknown>;
};

const auditSeverityLabel = (severity: string): string =>
  severity === "error"
    ? "Erreur"
    : severity === "warning"
      ? "Alerte"
      : severity === "advisory"
        ? "Conseil"
        : severity;

const auditCategoryLabel = (category: string): string =>
  category === "slop" ? "IA slop" : category === "quality" ? "Qualité" : category;

// Injecte le bundle détecteur une seule fois (mémoïsé). `__IMPECCABLE_CONFIG__`
// est posé AVANT l'insertion du <script> pour désactiver le scan auto : sinon le
// bundle dessine des overlays sur toute l'app dès son chargement.
const ensureImpeccableLoaded = (): Promise<void> => {
  const impeccableWindow = window as ImpeccableWindow;
  if (typeof impeccableWindow.impeccableDetect === "function") return Promise.resolve();
  if (impeccableLoadPromise) return impeccableLoadPromise;

  impeccableWindow.__IMPECCABLE_CONFIG__ = {
    ...(impeccableWindow.__IMPECCABLE_CONFIG__ ?? {}),
    autoScan: false,
  };

  impeccableLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = IMPECCABLE_DETECTOR_SRC;
    script.async = true;
    script.dataset.impeccable = "true";
    script.addEventListener("load", () => {
      if (typeof impeccableWindow.impeccableDetect === "function") resolve();
      else reject(new Error("Détecteur chargé mais API absente"));
    });
    script.addEventListener("error", () =>
      reject(new Error("Chargement du détecteur Impeccable impossible")),
    );
    document.head.appendChild(script);
  }).catch((error) => {
    // Autorise une nouvelle tentative au prochain clic.
    impeccableLoadPromise = null;
    throw error;
  });

  return impeccableLoadPromise;
};

// La sortie sérialisée du détecteur est un tableau de groupes
// {selector, tagName, findings[]}. On l'aplati en une liste de findings enrichis
// du sélecteur de leur élément (pour pouvoir les mettre en évidence ensuite).
const flattenAuditFindings = (raw: unknown): AuditFinding[] => {
  if (!Array.isArray(raw)) return [];
  const findings: AuditFinding[] = [];
  for (const group of raw) {
    const selector = typeof group?.selector === "string" ? group.selector : "";
    const tagName = typeof group?.tagName === "string" ? group.tagName : "";
    const groupFindings = Array.isArray(group?.findings) ? group.findings : [];
    for (const item of groupFindings) {
      findings.push({
        type: String(item?.type ?? "unknown"),
        category: String(item?.category ?? "quality"),
        severity: String(item?.severity ?? "warning"),
        detail: String(item?.detail ?? ""),
        name: String(item?.name ?? item?.type ?? "Anti-pattern"),
        description: String(item?.description ?? ""),
        selector,
        tagName,
      });
    }
  }
  return findings;
};

const runAudit = async (sourceLabel: string): Promise<void> => {
  auditLoading = true;
  auditError = null;
  auditViewLabel = sourceLabel;
  statusText = `Audit design de la ${sourceLabel}…`;
  render();
  try {
    await ensureImpeccableLoaded();
    const detect = (window as ImpeccableWindow).impeccableDetect;
    if (typeof detect !== "function") throw new Error("Détecteur indisponible");
    auditFindings = flattenAuditFindings(detect({ serialize: true }));
    statusText = `Audit design : ${auditFindings.length} problème(s) détecté(s)`;
  } catch (error) {
    auditError = String((error as Error)?.message ?? error);
    statusText = "Audit design : échec";
  } finally {
    auditLoading = false;
    render();
  }
};

// Ouvre/ferme la vue d'audit. À l'OUVERTURE, on lance d'abord le détecteur sur la
// VUE COURANTE (avant de basculer : son DOM n'est plus monté une fois la vue
// « audit » affichée), puis on montre le rapport.
const toggleAudit = async (): Promise<void> => {
  if (activeView === "audit") {
    setActiveView("audit"); // referme la vue (revient au terminal)
    return;
  }
  await runAudit(auditViewLabelFor(activeView));
  setActiveView("audit");
};

// Fait défiler jusqu'à l'élément fautif et l'entoure brièvement.
const highlightAuditTarget = (selector: string): void => {
  if (!selector) return;
  let target: Element | null = null;
  try {
    target = document.querySelector(selector);
  } catch {
    target = null;
  }
  if (!target) {
    statusText = "Élément introuvable dans la page (le DOM a peut-être changé)";
    render();
    return;
  }
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("audit-highlight");
  window.setTimeout(() => target?.classList.remove("audit-highlight"), 2200);
};

const renderAuditFinding = (finding: AuditFinding): string => {
  const location = finding.selector
    ? `${finding.tagName || "élément"} · ${finding.selector}`
    : "niveau page";
  return `
    <button type="button" class="audit-finding" data-audit-selector="${escapeAttr(finding.selector)}" title="Mettre en évidence dans la page">
      <span class="audit-badge sev-${escapeAttr(finding.severity)}">${escapeHtml(auditSeverityLabel(finding.severity))}</span>
      <span class="audit-finding-main">
        <span class="audit-finding-head">
          <strong>${escapeHtml(finding.name)}</strong>
          <span class="audit-cat">${escapeHtml(auditCategoryLabel(finding.category))}</span>
        </span>
        ${finding.detail ? `<span class="audit-detail">${escapeHtml(finding.detail)}</span>` : ""}
        ${finding.description ? `<span class="audit-desc">${escapeHtml(finding.description)}</span>` : ""}
        <span class="audit-target">${escapeHtml(location)}</span>
      </span>
    </button>`;
};

const renderAuditPanel = (): string => {
  const findings = auditFindings ?? [];
  const ran = auditFindings !== null;
  const target = auditViewLabel ?? "interface";
  const sorted = [...findings].sort(
    (a, b) =>
      auditSeverityRank(a.severity) - auditSeverityRank(b.severity) ||
      a.category.localeCompare(b.category) ||
      a.name.localeCompare(b.name),
  );
  const counts = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
  const countsText = Object.entries(counts)
    .sort(([a], [b]) => auditSeverityRank(a) - auditSeverityRank(b))
    .map(([severity, n]) => `${n} ${auditSeverityLabel(severity).toLowerCase()}`)
    .join(" · ");

  const summary = ran
    ? `Audit · ${target} — ${findings.length} problème(s)${findings.length ? ` · ${countsText}` : ""}`
    : "Depuis la vue à auditer, clique « Audit » dans la barre d'outils. Le détecteur Impeccable analyse l'interface affichée, entièrement dans le navigateur (rien n'est envoyé à un serveur).";

  const body = auditError
    ? `<div class="empty audit-error">${escapeHtml(auditError)}</div>`
    : auditLoading
      ? `<div class="empty">Analyse en cours…</div>`
      : !ran
        ? `<div class="empty">Aucun audit lancé pour l'instant.</div>`
        : findings.length === 0
          ? `<div class="empty">${AUDIT_CLEAN_MESSAGE}</div>`
          : `<div id="auditList" class="audit-list">${sorted.map(renderAuditFinding).join("")}</div>`;

  return `
    <div class="panel audit-panel">
      <div class="panel-head">
        <div>
          <h2>Audit design</h2>
          <p class="panel-sub">${escapeHtml(summary)}</p>
        </div>
        <div class="panel-actions">
          <button id="auditRun" class="tool-button primary" ${auditLoading ? "disabled" : ""} title="Relancer l'audit sur l'écran actuel">
            <i data-lucide="scan-eye"></i><span>${ran ? "Relancer" : "Auditer"}</span>
          </button>
        </div>
      </div>
      ${body}
    </div>`;
};

// ---------------------------------------------------------------------------
// Bibliothèque de skills (vue « Skills »)
// ---------------------------------------------------------------------------
// Source indépendante du backend : fichiers statiques
// embarqués sous public/skills/ (copiés dans dist/ au build, servis à /skills/…).
// On lit le manifeste index.json puis le contenu .md de chaque skill par fetch —
// identique en desktop (webview), web et mobile, sans backend. Ajouter un skill =
// déposer un .md dans public/skills/ et l'ajouter à index.json.
const SKILLS_INDEX_URL = "/skills/index.json";
const CHAT_SKILL_BUTTONS_STORAGE_KEY = "codex-switch-terminal.chat-skill-buttons.v1";

const storedChatSkillButtonIds = (): string[] | null => {
  try {
    const raw = localStorage.getItem(CHAT_SKILL_BUTTONS_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? [...new Set(parsed.filter(isChatAgentToolId))]
      : null;
  } catch {
    localStorage.removeItem(CHAT_SKILL_BUTTONS_STORAGE_KEY);
    return null;
  }
};

const persistChatSkillButtonIds = () => {
  localStorage.setItem(
    CHAT_SKILL_BUTTONS_STORAGE_KEY,
    JSON.stringify(chatSkillButtonIds ?? []),
  );
};

const chatAgentToolDefinitions = (): ChatAgentToolDefinition[] => {
  const skillsById = new Map((skillsList ?? []).map((skill) => [skill.id, skill]));
  const skillTools = (chatSkillButtonIds ?? [])
    .map((id) => skillsById.get(id))
    .filter((skill): skill is SkillEntry => !!skill)
    .map(chatSkillToolDefinition);
  return [...CHAT_AGENT_TOOLS, ...skillTools];
};

const chatAgentSkillPrompts = (
  enabledTools: readonly ChatAgentToolId[],
): ChatAgentSkillPrompt[] =>
  (skillsList ?? [])
    .filter((skill) => enabledTools.includes(skill.id) && skill.content.trim())
    .map(({ id, name, content }) => ({ id, name, content }));

const enabledToolsVisibleInChat = (
  enabledTools: readonly ChatAgentToolId[],
): ChatAgentToolId[] => {
  const visibleSkills = new Set(chatSkillButtonIds ?? []);
  return enabledTools.filter((id) => isChatAgentModeId(id) || visibleSkills.has(id));
};

const reconcileChatSkillButtons = () => {
  const availableIds = (skillsList ?? [])
    .map((skill) => skill.id)
    .filter((id) => isChatAgentToolId(id) && !isChatAgentModeId(id));
  const available = new Set(availableIds);
  const stored = chatSkillButtonIds ?? storedChatSkillButtonIds();
  const next = (stored ?? availableIds).filter((id) => available.has(id));
  chatSkillButtonIds = [...new Set(next)];
  persistChatSkillButtonIds();

  chatEnabledTools = enabledToolsVisibleInChat(chatEnabledTools);
  let panesChanged = false;
  expertChatPanes.forEach((pane) => {
    const enabledTools = enabledToolsVisibleInChat(pane.enabledTools);
    if (JSON.stringify(enabledTools) === JSON.stringify(pane.enabledTools)) return;
    pane.enabledTools = enabledTools;
    panesChanged = true;
  });
  if (panesChanged) persistExpertChats();
};

const toggleSkillChatButton = (id: string) => {
  const skill = (skillsList ?? []).find((entry) => entry.id === id);
  if (!skill || !isChatAgentToolId(id) || isChatAgentModeId(id)) return;
  const current = chatSkillButtonIds ?? [];
  const added = !current.includes(id);
  chatSkillButtonIds = added
    ? [...current, id]
    : current.filter((candidate) => candidate !== id);
  persistChatSkillButtonIds();
  if (!added) {
    chatEnabledTools = enabledToolsVisibleInChat(chatEnabledTools);
    expertChatPanes.forEach((pane) => {
      pane.enabledTools = enabledToolsVisibleInChat(pane.enabledTools);
    });
    persistExpertChats();
  }
  statusText = added
    ? `Bouton « ${skill.name} » ajouté aux chats`
    : `Bouton « ${skill.name} » retiré des chats`;
  render();
};

const refreshSkills = async (): Promise<void> => {
  try {
    const indexResponse = await fetch(SKILLS_INDEX_URL, { cache: "no-cache" });
    if (!indexResponse.ok) throw new Error(`index.json: HTTP ${indexResponse.status}`);
    const index = (await indexResponse.json()) as { skills?: unknown };
    const entries = Array.isArray(index.skills) ? index.skills : [];
    skillsList = await Promise.all(
      entries.map(async (raw): Promise<SkillEntry> => {
        const entry = (raw ?? {}) as Record<string, unknown>;
        const file = String(entry.file ?? "");
        let content = "";
        try {
          const contentResponse = await fetch(`/skills/${file}`, { cache: "no-cache" });
          if (contentResponse.ok) content = await contentResponse.text();
        } catch {
          // contenu indisponible : la carte reste affichée sans corps
        }
        return {
          id: String(entry.id ?? file),
          name: String(entry.name ?? entry.id ?? "skill"),
          description: String(entry.description ?? ""),
          tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
          buttonLabel: String(entry.buttonLabel ?? entry.name ?? entry.id ?? "Skill"),
          icon: String(entry.icon ?? "sparkles"),
          content,
        };
      }),
    );
    reconcileChatSkillButtons();
    skillsError = null;
  } catch (error) {
    skillsError = String((error as Error)?.message ?? error);
  }
  skillsLoaded = true;
  if (activeView === "skills" || activeView === "chat") render();
};

// Colle du texte (potentiellement multi-lignes) dans la session Codex active via
// le MODE PASTE (bracketed paste : ESC[200~ … ESC[201~), SANS Entrée : le contenu
// atterrit dans le composer de Codex, l'utilisateur relit puis valide. `sendLine`
// (qui ajoute \r) soumettrait dès le premier saut de ligne.
const pasteToActiveSession = async (text: string): Promise<boolean> => {
  const session = activeTerminal();
  if (!session?.running || session.ptyId === null) return false;
  try {
    await invoke("write_terminal", {
      id: session.ptyId,
      data: `[200~${text}[201~`,
    });
    return true;
  } catch (error) {
    statusText = String(error);
    return false;
  }
};

const applySkill = async (id: string): Promise<void> => {
  const skill = (skillsList ?? []).find((entry) => entry.id === id);
  if (!skill) return;
  const content = skill.content.trim();
  if (!content) {
    statusText = `Le contenu du skill « ${skill.name} » est indisponible`;
    render();
    return;
  }

  // L'injection cible le panneau actif et précède le brouillon existant afin
  // que les instructions du skill encadrent bien la demande déjà saisie.
  const pane = activeExpertChatPane();
  if (!pane) return;
  const existingDraft = pane.draft.trim();
  pane.draft = existingDraft ? `${content}\n\n${existingDraft}` : content;
  setActiveView("chat");
  statusText = `Skill « ${skill.name} » ajouté au chat`;
  window.setTimeout(() => {
    const input = expertChatPaneRoot(pane)?.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']");
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 0);
};

const useLibraryPromptInChat = async (prompt: PromptLibraryItem): Promise<void> => {
  const content = prompt.content.trim();
  if (!content) return;

  const pane = activeExpertChatPane();
  if (!pane) {
    const workspacePath = userEnvironmentPath(currentWorkspace());
    if (!workspacePath) {
      try {
        await navigator.clipboard.writeText(content);
        statusText = `Prompt « ${prompt.title} » copié · choisissez un environnement pour ouvrir un chat`;
      } catch {
        statusText = "Choisissez un environnement et ouvrez un chat pour utiliser ce prompt";
      }
      render();
      return;
    }
    openNewChatModal({ workspacePath, prompt: content });
    return;
  }

  const existingDraft = pane.draft.trim();
  pane.draft = existingDraft ? `${content}\n\n${existingDraft}` : content;
  persistExpertChats();
  setActiveView("chat");
  statusText = `Prompt « ${prompt.title} » ajouté au chat`;
  window.setTimeout(() => focusExpertChatPrompt(pane), 0);
};

const copySkill = async (id: string): Promise<void> => {
  const skill = (skillsList ?? []).find((entry) => entry.id === id);
  if (!skill) return;
  try {
    await navigator.clipboard.writeText(skill.content);
    statusText = `Skill « ${skill.name} » copié dans le presse-papiers`;
  } catch {
    statusText = "Copie impossible (presse-papiers indisponible)";
  }
  render();
};

const renderSkillCard = (
  skill: SkillEntry,
  applyTarget: "chat" | "terminal",
  hasActiveSession: boolean,
): string => {
  const tags = skill.tags
    .slice(0, 6)
    .map((tag) => `<span class="skill-tag">${escapeHtml(tag)}</span>`)
    .join("");
  const applyToChat = applyTarget === "chat";
  const buttonAdded = (chatSkillButtonIds ?? []).includes(skill.id);
  const hasContent = skill.content.trim().length > 0;
  const canApply = hasContent && (applyToChat || hasActiveSession);
  const applyLabel = applyToChat ? "Ajouter au chat" : "Injecter dans Codex";
  const applyTitle = !hasContent
    ? "Contenu du skill indisponible"
    : applyToChat
      ? "Ajouter le skill au brouillon du chat"
      : hasActiveSession
        ? "Coller le skill dans la session Codex active (relis puis Entrée)"
        : "Aucune session Codex active";
  return `
    <div class="skill-card">
      <div class="skill-card-head">
        <strong>${escapeHtml(skill.name)}</strong>
      </div>
      ${skill.description ? `<p class="skill-desc">${escapeHtml(skill.description)}</p>` : ""}
      ${tags ? `<div class="skill-tags">${tags}</div>` : ""}
      <div class="skill-actions">
        <button class="tool-button ${buttonAdded ? "skill-chat-button-active" : "primary"}" data-skill-chat-button="${escapeAttr(skill.id)}" aria-pressed="${buttonAdded}" title="${buttonAdded ? "Retirer ce bouton de toutes les fenêtres de chat" : "Ajouter ce bouton à toutes les fenêtres de chat"}">
          <i data-lucide="${buttonAdded ? "x" : "plus"}"></i><span>${buttonAdded ? "Retirer des chats" : "Ajouter aux chats"}</span>
        </button>
        <button class="tool-button" data-skill-apply="${escapeAttr(skill.id)}" ${canApply ? "" : "disabled"} title="${escapeAttr(applyTitle)}">
          <i data-lucide="send"></i><span>${applyLabel === "Ajouter au chat" ? "Ajouter au message" : applyLabel}</span>
        </button>
        <button class="tool-button" data-skill-copy="${escapeAttr(skill.id)}" title="Copier le contenu du skill dans le presse-papiers">
          <i data-lucide="copy"></i><span>Copier</span>
        </button>
      </div>
      <details class="skill-details">
        <summary>Voir le contenu</summary>
        <pre class="skill-content">${escapeHtml(skill.content)}</pre>
      </details>
    </div>`;
};

const renderSkillsPanel = (): string => {
  const skills = skillsList ?? [];
  const applyTarget = "chat" as const;
  const hasActiveSession = activeTerminal()?.running ?? false;
  const sub = !skillsLoaded
    ? "Chargement…"
    : applyTarget === "chat"
      ? `${skills.length} skill(s) disponible(s) · choisis les boutons affichés dans toutes les fenêtres de chat`
      : `${skills.length} skill(s) disponible(s)${hasActiveSession ? "" : " · démarre un terminal Codex pour pouvoir les injecter"}`;

  const body = skillsError
    ? `<div class="empty audit-error">${escapeHtml(skillsError)}</div>`
    : !skillsLoaded
      ? `<div class="empty">Chargement des skills…</div>`
      : skills.length === 0
        ? `<div class="empty">Aucun skill trouvé (<code>public/skills/index.json</code>).</div>`
        : `<div id="skillsList" class="skills-list">${skills.map((skill) => renderSkillCard(skill, applyTarget, hasActiveSession)).join("")}</div>`;

  return `
    <div class="panel audit-panel skills-panel">
      <div class="panel-head">
        <div>
          <h2>Skills</h2>
          <p class="panel-sub">${escapeHtml(sub)}</p>
        </div>
        <div class="panel-actions">
          <button id="skillsRefresh" class="icon-button wide" title="Rafraîchir la bibliothèque"><i data-lucide="refresh-ccw"></i></button>
        </div>
      </div>
      ${body}
    </div>`;
};


const removeAccount = async (id: string | null, deleteFiles = false) => {
  if (!settings || !id) return;
  const account = settings.accounts.find((candidate) => candidate.id === id);
  if (!account) return;

  pendingDeleteAccountId = null;
  try {
    settings = await invoke<AppSettings>("remove_account", { accountId: id, deleteFiles });
    if (selectedAccountId === id) {
      selectedAccountId = settings.defaultAccountId ?? settings.accounts[0]?.id ?? null;
    }
    if (poolStatus?.running) {
      poolStatus = await invoke<PoolStatus>("pool_start");
      startPoolPoll();
    } else {
      poolStatus = await invoke<PoolStatus>("pool_status");
    }
    statusText = deleteFiles
      ? `Compte « ${account.label} » supprimé (environnement effacé du disque)`
      : `Compte « ${account.label} » retiré du pool`;
  } catch (error) {
    statusText = String(error);
  }
  render();
};

const ensureTerminalsRestored = async () => {
  if (terminalRestoreAttempted) {
    await terminalRestorePromise;
    return;
  }

  terminalRestoreAttempted = true;
  terminalRestorePromise = restoreTerminals();
  try {
    await terminalRestorePromise;
  } finally {
    terminalRestorePromise = null;
  }
};

const stopAutonomousAgentsPoll = () => {
  if (autonomousAgentsPoll !== null) {
    clearInterval(autonomousAgentsPoll);
    autonomousAgentsPoll = null;
  }
};

const refreshAutonomousScheduleLabels = () => {
  const now = Date.now() / 1000;
  document.querySelectorAll<HTMLElement>("[data-autonomous-schedule]").forEach((element) => {
    const id = element.dataset.autonomousSchedule;
    const agent = autonomousAgents.find((candidate) => candidate.id === id);
    if (agent) element.textContent = formatAutonomousSchedule(agent, now);
  });
};

const syncAutonomousChatPanes = (): ExpertChatPane[] => {
  if (!autonomousAgentsLoaded) return [];
  const knownIds = new Set(autonomousAgents.map((agent) => agent.id));
  const latestBySourceChat = new Map<string, AutonomousAgentSnapshot>();
  autonomousAgents.forEach((agent) => {
    const sourceChatKey = agent.sourceChatKey?.trim();
    if (!sourceChatKey) return;
    const current = latestBySourceChat.get(sourceChatKey);
    if (!current || agent.createdAt >= current.createdAt) {
      latestBySourceChat.set(sourceChatKey, agent);
    }
  });
  const changed: ExpertChatPane[] = [];
  expertChatPanes.forEach((pane) => {
    const previousId = pane.autonomousAgentId;
    if (pane.autonomousAgentId && !knownIds.has(pane.autonomousAgentId)) {
      pane.autonomousAgentId = null;
    }
    const createdFromChat = latestBySourceChat.get(pane.key);
    const current = pane.autonomousAgentId
      ? autonomousAgents.find((agent) => agent.id === pane.autonomousAgentId) ?? null
      : null;
    if (
      createdFromChat
      && createdFromChat.id !== pane.autonomousAgentId
      && (!current || createdFromChat.createdAt >= current.createdAt)
    ) {
      pane.autonomousAgentId = createdFromChat.id;
    }
    if (pane.autonomousAgentId !== previousId) changed.push(pane);
  });
  if (changed.length) persistExpertChats();
  return changed;
};

const refreshAutonomousAgents = async (announce = false) => {
  if (autonomousAgentsInFlight) return;
  autonomousAgentsInFlight = true;
  if (announce && activeView === "autonomous") statusText = "Actualisation des agents autonomes";
  try {
    const next = await invoke<AutonomousAgentSnapshot[]>("list_autonomous_agents");
    const signature = JSON.stringify(next);
    const changed = signature !== autonomousAgentsSignature;
    autonomousAgents = next;
    autonomousAgentsSignature = signature;
    autonomousAgentsLoaded = true;
    if (autonomousEditingId && !next.some((agent) => agent.id === autonomousEditingId)) {
      closeAutonomousAgentEditor();
    }
    const unlinkedPanes = syncAutonomousChatPanes();
    if (announce && activeView === "autonomous") statusText = "Agents autonomes actualises";
    if (changed && activeView === "autonomous") render();
    else if (changed) {
      syncAutonomousMonitorUi();
      if (activeView === "chat") {
        const panes = new Set([
          ...expertChatPanes.filter((pane) => !!pane.autonomousAgentId),
          ...unlinkedPanes,
        ]);
        panes.forEach((pane) => refreshExpertChatPane(pane));
      }
    }
    else refreshAutonomousScheduleLabels();
  } catch (error) {
    autonomousAgentsLoaded = true;
    if (activeView === "autonomous") {
      statusText = String(error);
      if (announce) render();
    }
  } finally {
    autonomousAgentsInFlight = false;
  }
};

const startAutonomousAgentsPoll = () => {
  if (autonomousAgentsPoll !== null) return;
  autonomousAgentsPoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshAutonomousAgents()),
    2_000,
  );
};

const stopOrchestrationsPoll = () => {
  if (orchestrationsPoll !== null) {
    clearInterval(orchestrationsPoll);
    orchestrationsPoll = null;
  }
};

const refreshOrchestrations = async (announce = false) => {
  if (orchestrationsInFlight) return;
  orchestrationsInFlight = true;
  if (announce && activeView === "orchestration") statusText = "Actualisation des chats orchestrés";
  try {
    const next = await invoke<OrchestrationSnapshot[]>("list_orchestrations");
    const signature = JSON.stringify(next);
    const changed = signature !== orchestrationsSignature;
    orchestrations = next;
    if (!orchestrations.some((run) => run.id === orchestrationSelectedRunId)) {
      orchestrationSelectedRunId = orchestrations[0]?.id ?? null;
    }
    orchestrationsSignature = signature;
    orchestrationsLoaded = true;
    let paneSync = syncOrchestrationChatPanes();
    if (paneSync.missingDiscussions) {
      await refreshDiscussions();
      const afterDiscussions = syncOrchestrationChatPanes();
      paneSync = {
        changed: paneSync.changed || afterDiscussions.changed,
        missingDiscussions: afterDiscussions.missingDiscussions,
      };
    }
    if (announce && activeView === "orchestration") statusText = "Chats orchestrés actualisés";
    if (changed && activeView === "orchestration") render();
    if (
      activeView === "chat"
      && (
        paneSync.changed
        || (changed && expertChatPanes.some((pane) => !!pane.orchestrationId))
      )
    ) {
      render();
      startAllExpertChatWork();
    }
  } catch (error) {
    orchestrationsLoaded = true;
    if (activeView === "orchestration") {
      statusText = String(error);
      if (announce) render();
    }
  } finally {
    orchestrationsInFlight = false;
  }
};

const startOrchestrationsPoll = () => {
  if (orchestrationsPoll !== null) return;
  orchestrationsPoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshOrchestrations()),
    2_000,
  );
};

const stopAutonomousMonitorTurnPoll = () => {
  if (autonomousMonitorTurnPoll !== null) {
    clearInterval(autonomousMonitorTurnPoll);
    autonomousMonitorTurnPoll = null;
  }
  autonomousMonitorTurnInFlight = false;
};

const pollAutonomousMonitorTurn = async () => {
  if (!autonomousMonitorOpen || autonomousMonitorTurnInFlight) return;
  const agent = selectedAutonomousMonitorAgent();
  const turnId = agent?.currentTurnId ?? null;
  if (!agent || turnId == null) {
    const hadTurn = autonomousMonitorTurn !== null;
    autonomousMonitorTurn = null;
    autonomousMonitorTurnAgentId = null;
    autonomousMonitorTurnSignature = "";
    if (hadTurn) syncAutonomousMonitorLiveUi();
    return;
  }
  autonomousMonitorTurnInFlight = true;
  try {
    const snapshot = await invoke<ChatTurnSnapshot>("chat_turn_status", { id: turnId });
    const signature = JSON.stringify(snapshot);
    const changed = signature !== autonomousMonitorTurnSignature
      || autonomousMonitorTurnAgentId !== agent.id;
    autonomousMonitorTurn = snapshot;
    autonomousMonitorTurnAgentId = agent.id;
    autonomousMonitorTurnSignature = signature;
    if (changed) syncAutonomousMonitorLiveUi();
  } catch {
    autonomousMonitorTurn = null;
    autonomousMonitorTurnAgentId = agent.id;
    autonomousMonitorTurnSignature = "";
  } finally {
    autonomousMonitorTurnInFlight = false;
  }
};

const startAutonomousMonitorTurnPoll = () => {
  if (!autonomousMonitorOpen) return;
  if (autonomousMonitorTurnPoll === null) {
    autonomousMonitorTurnPoll = window.setInterval(
      () => runWhenPageVisible(() => void pollAutonomousMonitorTurn()),
      800,
    );
  }
  void pollAutonomousMonitorTurn();
};

const setActiveView = (view: AppView) => {
  document.body.classList.remove("chat-sidebar-open", "m-drawer-open", "m-sheet-open");
  if (view !== "settings") keyboardShortcutCaptureId = null;
  if (view === "terminal" && !userEnvironmentPath(terminalFolderFilter)) {
    terminalFolderFilter = userEnvironmentPath(currentWorkspace());
  }
  activeView = view;
  const viewStatus: Partial<Record<AppView, string>> = {
    tasks: "Vue tâches",
    prompts: "Bibliothèque de prompts",
    "scheduled-chat": "Chat planifié",
    pool: "Vue pool",
    limits: "Vue limites",
    dashboard: "Vue dashboard",
    "doctolib-lab": "RDV Lab expérimental",
    autonomous: "Agents autonomes",
    orchestration: "Chats orchestrés",
    kombai: "Vue Kombai",
    discussions: "Vue discussions",
    history: "Vue historique",
    audit: "Audit design",
    skills: "Skills",
    settings: "Paramètres",
    chat: "Vue conversation",
  };
  statusText = viewStatus[activeView]
    ?? (terminalFolderFilter
      ? `Session terminal: ${workspaceBaseName(terminalFolderFilter)}`
      : "Choisis un environnement terminal");

  if (
    activeView === "limits" || activeView === "chat" ||
    chatTurnIsBusy(chatTurn?.status) ||
    expertChatPanes.some((pane) => chatTurnIsBusy(pane.turn?.status))
  ) {
    startLimitPoll();
  } else {
    stopLimitPoll();
  }

  if (activeView === "dashboard") {
    startUsagePoll();
  } else {
    stopUsagePoll();
  }

  if (activeView === "kombai") {
    startKombaiPoll();
  } else {
    stopKombaiPoll();
  }

  if (activeView === "settings") {
    startVoiceRuntimePoll();
  } else {
    stopVoiceRuntimePoll();
  }

  if (activeView === "autonomous") {
    if (!autonomousAccountId) {
      autonomousAccountId = selectedAccountId ?? settings?.defaultAccountId ?? null;
    }
    if (!autonomousProjectDir) autonomousProjectDir = currentWorkspace() ?? "";
  }
  startAutonomousAgentsPoll();

  if (
    activeView === "orchestration"
    || (activeView === "chat" && expertChatPanes.some((pane) => !!pane.orchestrationId))
  ) {
    if (!orchestrationAccountId) {
      orchestrationAccountId = selectedAccountId ?? settings?.defaultAccountId ?? null;
    }
    normalizeOrchestrationWorkerDrafts(orchestrationWorkerCount, orchestrationAccountId ?? "");
    if (!orchestrationProjectDir) orchestrationProjectDir = currentWorkspace() ?? "";
    startOrchestrationsPoll();
  } else {
    stopOrchestrationsPoll();
  }

  if (activeView === "discussions" || activeView === "chat") {
    startDiscussionsPoll();
  } else {
    stopDiscussionsPoll();
  }

  if (activeView === "chat") startAllExpertChatWork();
  else stopAllExpertChatWork();

  render();

  if (activeView === "pool") void refreshPoolStatus();
  if (activeView === "limits") void refreshLimitStatus();
  if (activeView === "chat" && !limitStatusLoaded) void refreshLimitStatus(true);
  if (activeView === "dashboard") {
    void refreshUsageDashboard();
    void refreshAccountUsage();
    void refreshWorkTimeDashboard();
  }
  if (activeView === "kombai") void refreshKombaiStatus();
  if (activeView === "autonomous") void refreshAutonomousAgents(!autonomousAgentsLoaded);
  if (
    activeView === "orchestration"
    || (activeView === "chat" && expertChatPanes.some((pane) => !!pane.orchestrationId))
  ) {
    void refreshOrchestrations(!orchestrationsLoaded);
  }
  if (activeView === "discussions") void refreshDiscussions();
  if (activeView === "history" && !promptHistoryLoaded) void refreshPromptHistory();
  if (activeView === "skills") void refreshSkills();
  if (activeView === "settings") void refreshVoiceRuntimeStatus();
  if (activeView === "doctolib-lab" && !doctolibLab.status) {
    void refreshDoctolibLabStatus();
  }
};

const refreshLimitStatus = (silent = false): Promise<void> => {
  if (limitStatusRefreshPromise) return limitStatusRefreshPromise;
  const pending = (async () => {
    limitStatusInFlight = true;
    const announceInLimitsView = !silent && activeView === "limits";
    if (announceInLimitsView) {
      statusText = "Lecture des limites serveur";
    }
    let statusChanged = false;
    let accountSettingsChanged = false;
    try {
      limitStatus = await invoke<AccountLimitView[]>("account_limit_status");
      if (
        settings &&
        !accountCatalogMatchesLimitRows(settings.accounts, limitStatus)
      ) {
        const previousAccounts = JSON.stringify(settings.accounts);
        const freshSettings = await invoke<AppSettings>("load_settings");
        settings = freshSettings;
        scheduleUnconnectedAccountCleanup();
        accountSettingsChanged = JSON.stringify(freshSettings.accounts) !== previousAccounts;

        if (!freshSettings.accounts.some((account) => account.id === selectedAccountId)) {
          selectedAccountId = freshSettings.defaultAccountId ?? freshSettings.accounts[0]?.id ?? null;
        }
        if (!freshSettings.accounts.some((account) => account.id === chatAccountId)) {
          chatAccountId = selectedAccountId;
        }
        if (!freshSettings.accounts.some((account) => account.id === newChatAccountId)) {
          newChatAccountId = selectedAccountId;
        }
      }
      const nextSignature = JSON.stringify(limitStatus);
      statusChanged = nextSignature !== limitStatusSignature;
      limitStatusSignature = nextSignature;
      limitStatusLoaded = true;
      if (announceInLimitsView) statusText = "Limites serveur actualisees";
      recoverQuotaExhaustedChatTurns();
    } catch (error) {
      if (announceInLimitsView) statusText = String(error);
      limitStatusLoaded = true;
    } finally {
      limitStatusInFlight = false;
    }

    if (newChatModalOpen) syncNewChatAccountUsageUi();

    if (
      activeView === "limits" &&
      (statusChanged || accountSettingsChanged || announceInLimitsView)
    ) {
      render();
    } else if (activeView === "chat" && (statusChanged || accountSettingsChanged)) {
      if (accountSettingsChanged) render();
      else refreshAllChatRuntimeStatus();
    }
    if (
      activeView !== "chat" &&
      activeView !== "limits" &&
      !chatTurnIsBusy(chatTurn?.status) &&
      !expertChatPanes.some((pane) => chatTurnIsBusy(pane.turn?.status))
    ) {
      stopLimitPoll();
    }
  })();
  limitStatusRefreshPromise = pending;
  const clear = () => {
    if (limitStatusRefreshPromise === pending) limitStatusRefreshPromise = null;
  };
  void pending.then(clear, clear);
  return pending;
};

// Ouvre un terminal interactif `codex login` (ou l'equivalent du provider) pour
// le compte cible : c'est la seule facon de regenerer une session revoquee /
// expiree, sans laquelle la vue Limites ne peut relire aucun quota. On reutilise
// la machinerie terminal existante (meme CODEX_HOME/agent que le compte).
const reloginAccount = async (accountId: string) => {
  if (!settings) return;
  const account = settings.accounts.find((candidate) => candidate.id === accountId);
  if (!account) {
    statusText = "Compte introuvable";
    render();
    return;
  }
  const provider = accountProvider(account);
  const agentId = providerAgentId(provider);
  const agent = agentById(agentId);
  const reconnectCommand = reconnectCommandForAccount(account, agent);
  // Un login n'a besoin d'aucun projet : son terminal temporaire travaille dans
  // le home isole du compte. Le backend reserve toujours l'exigence d'un vrai
  // environnement aux terminaux de travail.
  const environmentPath = userEnvironmentPath(account.codexHome);
  if (!environmentPath) {
    statusText = "Dossier du compte introuvable";
    render();
    return;
  }
  statusText = `Ouverture de la connexion ${providerLabel(provider)} pour ${account.label}…`;
  await createNewTerminal(
    accountId,
    true,
    reconnectCommand,
    agentId,
    null,
    environmentPath,
    true,
  );
};

const nextUnconnectedAccountExpiry = (): number | null => {
  if (!settings) return null;
  let next: number | null = null;
  for (const account of settings.accounts) {
    if (account.limits?.connectedAt != null || !Number.isFinite(account.createdAt)) continue;
    const deadline = Number(account.createdAt) * 1_000 + UNCONNECTED_ACCOUNT_EXPIRY_MS;
    next = next === null ? deadline : Math.min(next, deadline);
  }
  return next;
};

const stopUnconnectedAccountCleanup = () => {
  if (unconnectedAccountCleanupTimer !== null) {
    clearTimeout(unconnectedAccountCleanupTimer);
    unconnectedAccountCleanupTimer = null;
  }
};

const reconcileAccountSelections = () => {
  if (!settings) return;
  const fallback = settings.defaultAccountId ?? settings.accounts[0]?.id ?? null;
  const keepOrFallback = (accountId: string | null) =>
    settings?.accounts.some((account) => account.id === accountId) ? accountId : fallback;

  selectedAccountId = keepOrFallback(selectedAccountId);
  chatAccountId = keepOrFallback(chatAccountId);
  newChatAccountId = keepOrFallback(newChatAccountId);
  newTerminalAccountId = keepOrFallback(newTerminalAccountId);
  autonomousAccountId = keepOrFallback(autonomousAccountId);
  orchestrationAccountId = keepOrFallback(orchestrationAccountId);
};

const scheduleUnconnectedAccountCleanup = (minimumDelayMs = 0) => {
  stopUnconnectedAccountCleanup();
  const deadline = nextUnconnectedAccountExpiry();
  if (deadline === null) return;

  const delay = Math.max(minimumDelayMs, deadline - Date.now() + 25);
  unconnectedAccountCleanupTimer = window.setTimeout(
    () => void cleanupExpiredUnconnectedAccounts(),
    Math.min(delay, 2_147_000_000),
  );
};

const cleanupExpiredUnconnectedAccounts = async () => {
  if (!settings || unconnectedAccountCleanupInFlight) return;
  stopUnconnectedAccountCleanup();
  unconnectedAccountCleanupInFlight = true;
  const previousAccounts = settings.accounts;

  try {
    const freshSettings = await invoke<AppSettings>("load_settings");
    const freshIds = new Set(freshSettings.accounts.map((account) => account.id));
    const removed = previousAccounts.filter((account) => !freshIds.has(account.id));
    settings = freshSettings;
    reconcileAccountSelections();
    limitStatus = limitStatus.filter((row) => freshIds.has(row.id));
    limitStatusSignature = JSON.stringify(limitStatus);
    removed.forEach((account) => chatModelCatalogs.delete(account.id));

    if (removed.length > 0 && poolStatus?.running) {
      try {
        poolStatus = await invoke<PoolStatus>("pool_start");
        startPoolPoll();
      } catch {
        // Le profil est bien supprime meme si le pool ne peut pas etre relance.
      }
    }

    if (removed.length > 0) {
      const labels = removed.map((account) => `« ${account.label} »`).join(", ");
      statusText = `${removed.length === 1 ? "Compte" : "Comptes"} ${labels} supprime${removed.length === 1 ? "" : "s"} automatiquement : aucune connexion dans les 10 minutes`;
      render();
    }

    // Si un serveur plus ancien n'a pas encore applique l'expiration, evite
    // une boucle immediate tout en retentant regulierement.
    const nextDeadline = nextUnconnectedAccountExpiry();
    scheduleUnconnectedAccountCleanup(
      nextDeadline !== null && nextDeadline <= Date.now()
        ? UNCONNECTED_ACCOUNT_CLEANUP_RETRY_MS
        : 0,
    );
  } catch {
    scheduleUnconnectedAccountCleanup(UNCONNECTED_ACCOUNT_CLEANUP_RETRY_MS);
  } finally {
    unconnectedAccountCleanupInFlight = false;
  }
};

const startLimitPoll = () => {
  if (limitPoll !== null) return;
  limitPoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshLimitStatus()),
    LIMIT_POLL_INTERVAL_MS,
  );
};

const stopLimitPoll = () => {
  if (limitPoll !== null) {
    clearInterval(limitPoll);
    limitPoll = null;
  }
};

const refreshUsageDashboard = async () => {
  if (usageDashboardInFlight) return;
  usageDashboardInFlight = true;
  let dashboardChanged = false;
  try {
    try {
      usageDashboard = await invoke<UsageDashboard>("usage_dashboard");
      const nextSignature = JSON.stringify(usageDashboard);
      dashboardChanged = nextSignature !== usageDashboardSignature;
      usageDashboardSignature = nextSignature;
    } catch (error) {
      statusText = String(error);
      dashboardChanged = true;
    }

    if (activeView === "dashboard" && dashboardChanged) {
      render();
    }
  } finally {
    usageDashboardInFlight = false;
  }
};

// Le backend met en cache les rollouts inchangés et la lecture distante du
// compte. Le poll peut donc suivre les sessions actives sans reparcourir tout
// l'historique toutes les cinq secondes.
const normalizeAccountUsageDashboard = (
  dashboard: AccountUsageDashboard,
): AccountUsageDashboard => {
  const normalizedAccounts = (Array.isArray(dashboard.accounts) ? dashboard.accounts : []).map(
    (account) => {
      const profileLabels = Array.isArray(account.profileLabels)
        ? account.profileLabels.filter(
            (label): label is string => typeof label === "string" && label.trim().length > 0,
          )
        : [];
      const usageSource =
        account.usageSource === "codex-account" ||
        account.usageSource === "local-sessions" ||
        account.usageSource === "unavailable"
          ? account.usageSource
          : "local-sessions";
      return {
        ...account,
        profileLabels: profileLabels.length ? profileLabels : [account.label],
        usageSource,
        sourceError: account.sourceError ?? account.error ?? null,
        days: Array.isArray(account.days) ? account.days : [],
      };
    },
  );
  const fallbackProfileCount = normalizedAccounts.reduce(
    (total, account) => total + Math.max(1, account.profileLabels.length),
    0,
  );
  const accounts = deduplicateAccountTokenAccounts(normalizedAccounts);
  return {
    ...dashboard,
    accounts,
    totalTokens: accounts.reduce((total, account) => total + (account.totalTokens || 0), 0),
    totalCostUsd: accounts.reduce((total, account) => total + (account.costUsd || 0), 0),
    totalSessions: accounts.reduce((total, account) => total + (account.sessionCount || 0), 0),
    profileCount:
      Number.isFinite(dashboard.profileCount) && dashboard.profileCount > 0
        ? dashboard.profileCount
        : fallbackProfileCount,
  };
};

const refreshAccountUsage = async () => {
  if (accountUsageInFlight) return;
  accountUsageInFlight = true;
  let accountUsageChanged = false;
  try {
    const nextAccountUsage = normalizeAccountUsageDashboard(
      await invoke<AccountUsageDashboard>("account_token_usage"),
    );
    const nextSignature = JSON.stringify({
      totalTokens: nextAccountUsage.totalTokens,
      totalSessions: nextAccountUsage.totalSessions,
      accounts: nextAccountUsage.accounts,
    });
    accountUsageChanged =
      !accountUsageLoaded || nextSignature !== accountUsageSignature;
    accountUsage = nextAccountUsage;
    accountUsageSignature = nextSignature;
    accountUsageLoaded = true;
  } catch (error) {
    statusText = String(error);
    accountUsageChanged = !accountUsageLoaded;
    accountUsageLoaded = true;
  } finally {
    accountUsageInFlight = false;
  }

  if (activeView === "dashboard" && accountUsageChanged) {
    render();
  }
};

const normalizeWorkTimeDashboard = (dashboard: WorkTimeDashboard): WorkTimeDashboard => ({
  ...dashboard,
  totalSeconds: Math.max(0, Number(dashboard.totalSeconds) || 0),
  trackedChats: Math.max(0, Number(dashboard.trackedChats) || 0),
  trackedTurns: Math.max(0, Number(dashboard.trackedTurns) || 0),
  days: (Array.isArray(dashboard.days) ? dashboard.days : [])
    .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date))
    .map((day) => ({
      date: day.date,
      activeSeconds: Math.max(0, Number(day.activeSeconds) || 0),
      turnCount: Math.max(0, Number(day.turnCount) || 0),
    })),
});

const refreshWorkTimeDashboard = async () => {
  if (workTimeInFlight) return;
  workTimeInFlight = true;
  let workTimeChanged = false;
  try {
    const nextDashboard = normalizeWorkTimeDashboard(
      await invoke<WorkTimeDashboard>("work_time_dashboard"),
    );
    const nextSignature = JSON.stringify({
      totalSeconds: nextDashboard.totalSeconds,
      trackedChats: nextDashboard.trackedChats,
      trackedTurns: nextDashboard.trackedTurns,
      firstActivity: nextDashboard.firstActivity,
      lastActivity: nextDashboard.lastActivity,
      days: nextDashboard.days,
    });
    workTimeChanged = !workTimeLoaded || nextSignature !== workTimeSignature;
    workTimeDashboard = nextDashboard;
    workTimeSignature = nextSignature;
    workTimeLoaded = true;
  } catch (error) {
    statusText = String(error);
    workTimeChanged = !workTimeLoaded;
    workTimeLoaded = true;
  } finally {
    workTimeInFlight = false;
  }

  if (activeView === "dashboard" && workTimeChanged) {
    render();
  }
};

const startUsagePoll = () => {
  stopUsagePoll();
  usagePoll = window.setInterval(
    () =>
      runWhenPageVisible(() => {
        void refreshUsageDashboard();
        void refreshAccountUsage();
        void refreshWorkTimeDashboard();
      }),
    5000,
  );
};

const stopUsagePoll = () => {
  if (usagePoll !== null) {
    clearInterval(usagePoll);
    usagePoll = null;
  }
};

const kombaiStatusSummary = (status: KombaiStatus) =>
  status.running ? "Kombai actif" : status.started ? "Kombai en cours de demarrage" : "Kombai arrete";

const refreshKombaiStatus = async () => {
  if (kombaiStatusInFlight) return;
  kombaiStatusInFlight = true;
  try {
    try {
      const wasRunning = kombaiStatus?.running ?? false;
      kombaiStatus = await invoke<KombaiStatus>("kombai_status");
      kombaiLoaded = true;
      const recoveredFromError = kombaiStatusError;
      const runningChanged = kombaiStatus.running !== wasRunning;
      kombaiStatusError = false;
      if (activeView === "kombai") {
        if (recoveredFromError || runningChanged) {
          statusText = kombaiStatusSummary(kombaiStatus);
        }
        // Evite de recharger l'iframe a chaque tick : on ne re-render que si
        // l'etat "running" change (ou tant qu'on n'est pas encore lance).
        if (recoveredFromError || !kombaiStatus.running || runningChanged || !document.querySelector("#kombaiFrame")) {
          render();
        }
      }
    } catch (error) {
      kombaiStatusError = true;
      statusText = String(error);
      kombaiLoaded = true;
      if (activeView === "kombai") render();
    }
  } finally {
    kombaiStatusInFlight = false;
  }
};

const startKombaiPoll = () => {
  stopKombaiPoll();
  kombaiPoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshKombaiStatus()),
    2000,
  );
};

const stopKombaiPoll = () => {
  if (kombaiPoll !== null) {
    clearInterval(kombaiPoll);
    kombaiPoll = null;
  }
};

const applyDiscussionsSnapshot = (snapshot: DiscussionsView) => {
  discussions = snapshot;
  discussionsLoaded = true;
  const nextRenderSignature = JSON.stringify([snapshot.totalDiscussions, snapshot.accounts]);
  if (nextRenderSignature === discussionsRenderSignature) return;
  discussionsRenderSignature = nextRenderSignature;
  const latestBySession = new Map(
    snapshot.accounts.flatMap((group) => group.discussions).map((discussion) => [discussion.sessionId, discussion]),
  );
  const syncPanelTitle = (root: ParentNode | null, discussion: DiscussionSummary) => {
    const element = root?.querySelector<HTMLElement>(".chat-title");
    if (!element) return;
    const title = discussion.title?.trim() || "Nouvelle conversation";
    element.textContent = title;
    element.title = title;
  };
  if (chatDiscussion) {
    const latest = latestBySession.get(chatDiscussion.sessionId);
    if (latest) {
      Object.assign(chatDiscussion, latest);
      syncPanelTitle(document.querySelector<HTMLElement>("#chatPanel"), chatDiscussion);
    }
  }
  expertChatPanes.forEach((pane) => {
    if (!pane.discussion) return;
    const latest = latestBySession.get(pane.discussion.sessionId);
    if (latest) {
      Object.assign(pane.discussion, latest);
      syncPanelTitle(expertChatPaneRoot(pane), pane.discussion);
    }
  });
  if (activeView === "discussions") {
    const host = document.querySelector<HTMLDivElement>("#discussionGroups");
    if (host) {
      refreshDiscussionList();
    } else {
      render();
    }
  } else if (activeView === "chat") {
    const host = document.querySelector<HTMLElement>("#chatSideConversations");
    // Ne remplace jamais le DOM sous le pointeur pendant un drag natif : sinon
    // le navigateur annule le geste avant que le drop atteigne son workspace.
    if (host && !draggedChatSessionId) {
      host.innerHTML = renderChatSidebarConversations();
      renderIcons(host);
      bindDiscussionRowUi();
      bindWorkspaceSwitcherUi(host);
    }
    // Garde le compteur global des workspaces et conversations a jour.
    refreshWorkspaceSwitcher();
  }
};

const refreshDiscussions = (): Promise<void> => {
  if (discussionsRefreshPromise) return discussionsRefreshPromise;
  const pending = (async () => {
    try {
      applyDiscussionsSnapshot(await invoke<DiscussionsView>("list_discussions"));
    } catch (error) {
      statusText = String(error);
      discussionsLoaded = true;
    }
  })();
  discussionsRefreshPromise = pending;
  const clear = () => {
    if (discussionsRefreshPromise === pending) discussionsRefreshPromise = null;
  };
  void pending.then(clear, clear);
  return pending;
};

const startDiscussionsPoll = () => {
  stopDiscussionsPoll();
  if (isRemoteMode()) {
    discussionsSyncState = "connecting";
    discussionsLiveUnlisten = subscribeDiscussionUpdates(
      {},
      (message: DiscussionStreamMessage) => {
        if (message.type === "dashboard") {
          applyDiscussionsSnapshot(message.dashboard as DiscussionsView);
        } else if (message.type === "error") {
          statusText = `Synchronisation des discussions : ${message.message}`;
        }
      },
      (state) => {
        discussionsSyncState = state;
      },
    );
    // Filet de securite si un proxy intermediaire coupe durablement les WS.
    discussionsPoll = window.setInterval(() => {
      runWhenPageVisible(() => {
        if (discussionsSyncState !== "live") void refreshDiscussions();
      });
    }, 2000);
  } else {
    // Le bureau local n'a pas de serveur WebSocket : le scan ne tourne que tant
    // que la vue est ouverte, avec une cadence assez courte pour suivre un chat.
    discussionsPoll = window.setInterval(
      () => runWhenPageVisible(() => void refreshDiscussions()),
      2000,
    );
  }
  startActiveChatTurnsPoll();
};

const stopDiscussionsPoll = () => {
  stopActiveChatTurnsPoll();
  discussionsLiveUnlisten?.();
  discussionsLiveUnlisten = null;
  discussionsSyncState = "closed";
  if (discussionsPoll !== null) {
    clearInterval(discussionsPoll);
    discussionsPoll = null;
  }
};

const allDiscussions = (): DiscussionSummary[] =>
  discussions?.accounts.flatMap((group) => group.discussions) ?? [];

const findDiscussion = (id: string | null | undefined) =>
  (id && allDiscussions().find((discussion) => discussion.sessionId === id)) || null;

const discussionMatches = (discussion: DiscussionSummary, label: string) => {
  const query = discussionSearch.trim().toLowerCase();
  if (!query) return true;
  return [discussion.title ?? "", discussion.preview ?? "", discussionFolderPath(discussion) ?? "", discussion.sessionId, label]
    .some((field) => field.toLowerCase().includes(query));
};

const persistDiscussionFolder = async (
  discussion: DiscussionSummary,
  folderPath: string,
): Promise<DiscussionSummary> => {
  discussion.folderPath = folderPath;
  if (
    discussion.cwd?.trim() &&
    normalizeWorkspacePath(discussion.cwd) === normalizeWorkspacePath(folderPath)
  ) {
    return discussion;
  }
  const moved = await invoke<DiscussionSummary>("move_discussion", {
    accountId: discussion.accountId,
    sessionId: discussion.sessionId,
    workspacePath: folderPath,
  });
  moved.folderPath = folderPath;
  Object.assign(discussion, moved);
  return discussion;
};

const restoreDiscussionFolder = async (
  discussion: DiscussionSummary,
): Promise<string | null> => {
  const folderPath = activateDiscussionFolder(discussion);
  if (!folderPath) return null;
  await persistDiscussionFolder(discussion, folderPath);
  return folderPath;
};

// Quand un terminal se ferme, on retrouve son transcript par son id (ou par le
// dossier courant pour une nouvelle session), puis on persiste ce dossier afin
// que la prochaine reprise restaure le meme contexte.
const persistTerminalDiscussionFolder = async (session: TerminalSession): Promise<void> => {
  const folderPath = session.folderPath?.trim();
  if (!folderPath) return;
  const linkedIds = new Set(
    [session.codexSessionId, session.resumeSessionId].filter(
      (id): id is string => !!id,
    ),
  );

  for (const delay of [0, 200, 600]) {
    if (delay) await sleep(delay);
    await refreshDiscussions();
    const discussion = allDiscussions().find(
      (candidate) =>
        candidate.accountId === session.accountId &&
        (linkedIds.has(candidate.sessionId) || linkedIds.has(candidate.rolloutId)),
    ) ?? allDiscussions()
      .filter(
        (candidate) =>
          candidate.accountId === session.accountId &&
          !!candidate.cwd &&
          !!session.workspacePath &&
          normalizeWorkspacePath(candidate.cwd) === normalizeWorkspacePath(session.workspacePath) &&
          candidate.lastActivity >= (session.startedAtUnix ?? 0) - 5,
      )
      .sort((left, right) => right.lastActivity - left.lastActivity)[0];
    if (!discussion) continue;
    await persistDiscussionFolder(discussion, folderPath);
    await refreshDiscussions();
    return;
  }
};

// Reprise dans le compte D'ORIGINE : ouvre le fil dans le chat classique et
// lance automatiquement un nouveau tour sur le rollout HEAD. Aucun terminal
// interactif n'est cree par ce bouton.
const resumeDiscussion = async (discussion: DiscussionSummary) => {
  try {
    const folderPath = userEnvironmentPath(await restoreDiscussionFolder(discussion));
    if (!folderPath) {
      throw new Error("la discussion n'a pas d'environnement associe");
    }
    const resumed = await resumeDiscussionInChat(
      discussion,
      discussion.accountId,
      folderPath,
      "continue",
    );
    if (!resumed) {
      statusText = "Le chat n'a pas pu demarrer cette discussion";
      render();
    }
  } catch (error) {
    statusText = `Impossible de restaurer l'environnement de la discussion : ${String(error)}`;
    render();
  }
};

// Archive la version source APRES que la continuation cible est prete. Elle
// disparait ainsi de l'onglet Discussions, tout en restant recuperable dans le
// dossier d'archive si un retour arriere est necessaire.
const closeTransferredDiscussionSource = (discussion: DiscussionSummary) => {
  const sourceIds = new Set([discussion.sessionId, discussion.rolloutId]);
  const isSourceDiscussion = (candidate: DiscussionSummary | null | undefined) =>
    !!candidate &&
    candidate.accountId === discussion.accountId &&
    (sourceIds.has(candidate.sessionId) || sourceIds.has(candidate.rolloutId));

  const closedPanes = expertChatPanes.filter((pane) => isSourceDiscussion(pane.discussion));
  closedPanes.forEach((pane) => {
    stopExpertChatSync(pane);
    stopExpertChatTurnPoll(pane);
    resetExpertModelCapacityRetry(pane);
    expertChatAccountTransitions.delete(pane.key);
  });
  expertChatPanes = expertChatPanes.filter((pane) => !isSourceDiscussion(pane.discussion));
  if (closedPanes.some((pane) => pane.key === activeExpertChatKey)) {
    activeExpertChatKey = expertChatPanes.at(-1)?.key ?? null;
  }
  if (closedPanes.some((pane) => pane.key === expertChatFullscreenKey)) {
    expertChatFullscreenKey = null;
  }
  if (closedPanes.length) {
    reconcileExpertChatPage();
    persistExpertChats();
  }

  if (isSourceDiscussion(chatDiscussion)) {
    stopChatSync();
    stopChatTurnPoll();
    resetMainModelCapacityRetry();
    chatDiscussion = null;
    chatMessages = [];
    chatTurn = null;
    chatQueuedSubmissions = [];
    chatQueueDrainInFlight = false;
    chatError = null;
    chatLoading = false;
    chatTruncated = false;
    chatHistoryOpen = false;
  }
};

const archiveTransferredDiscussion = async (discussion: DiscussionSummary): Promise<number> => {
  const result = await invoke<{ count?: number }>("delete_discussion", {
    accountId: discussion.accountId,
    // sessionId (identite logique) archive aussi tous les anciens forks Codex.
    sessionId: discussion.sessionId,
    archive: true,
  });
  discussionTargetSel.delete(discussion.sessionId);
  closeTransferredDiscussionSource(discussion);
  return result?.count ?? 1;
};

const transferredDiscussionStatus = (
  target: AccountProfile,
  archivedCount: number,
) => {
  const forkNote = archivedCount > 1 ? ` (${archivedCount} anciennes reprises archivees)` : "";
  return `Discussion deplacee vers « ${target.label} »${forkNote} et reprise automatiquement`;
};

const syncStatusTextDom = () => {
  document.querySelectorAll<HTMLElement>(".chat-status-toast").forEach((element) => {
    element.textContent = statusText;
  });
};

const refreshAccountTransitionUi = (pane: ExpertChatPane | null) => {
  syncStatusTextDom();
  if (pane && activeView === "chat" && expertChatPanes.includes(pane)) {
    // Un chat d'une autre page peut basculer en arriere-plan : ne jamais
    // deplacer la page courante ni reconstruire la grille pour lui.
    if (expertChatPaneRoot(pane)) refreshExpertChatPane(pane);
    return;
  }
  render();
};

const setExpertChatAccountTransition = (
  pane: ExpertChatPane | null,
  transition: ChatAccountTransition | null,
) => {
  if (!pane) {
    refreshAccountTransitionUi(null);
    return;
  }
  if (transition) {
    expertChatAccountTransitions.set(pane.key, transition);
  } else if (!expertChatAccountTransitions.delete(pane.key)) {
    // Le chemin d'echec a deja restaure le panneau. Il ne reste qu'a annoncer
    // le nouveau statut, sans remplacer une deuxieme fois son DOM.
    syncStatusTextDom();
    return;
  }
  refreshAccountTransitionUi(pane);
};

const expertPaneForDiscussion = (
  discussion: DiscussionSummary,
  preferred: ExpertChatPane | null = null,
): ExpertChatPane | null => {
  const ids = new Set([discussion.sessionId, discussion.rolloutId]);
  const matches = (pane: ExpertChatPane | null | undefined) =>
    !!pane?.discussion &&
    pane.discussion.accountId === discussion.accountId &&
    (ids.has(pane.discussion.sessionId) || ids.has(pane.discussion.rolloutId));
  if (matches(preferred)) return preferred;
  return expertChatPanes.find(matches) ?? null;
};

// Reprise dans un AUTRE compte = deplacement, pas duplication. Deux cas :
//  - MEME provider Codex : copie FIDELE du rollout HEAD vers le compte cible,
//    reprise native, puis archivage de la chaine source.
//  - INTER-provider (ou impliquant Claude) : export du transcript, injection
//    dans une session NEUVE du provider cible, puis archivage de la source.
//
// Dans les deux cas, la source n'est archivee qu'une fois le tour du chat cible
// demarre. Un echec conserve donc l'ancienne discussion dans la liste.
const continueDiscussionWith = async (
  discussion: DiscussionSummary,
  targetAccountId: string,
  preferredPane: ExpertChatPane | null = null,
) => {
  if (discussionBusyId) return;
  if (!settings || !targetAccountId || targetAccountId === discussion.accountId) return;
  const target = accountById(targetAccountId);
  if (!target) return;
  const sourceLabel = accountById(discussion.accountId)?.label ?? discussion.accountLabel;
  const transferPane = expertPaneForDiscussion(discussion, preferredPane);
  const sourceProvider = discussion.provider ?? accountProvider(accountById(discussion.accountId));
  const targetProvider = accountProvider(target);
  discussionBusyId = discussion.sessionId;
  if (transferPane) {
    setExpertChatAccountTransition(transferPane, {
      label: "Changement de compte",
      detail: `${sourceLabel} → ${target.label} · préparation du contexte`,
    });
  } else {
    render();
  }
  try {
    const folderPath = userEnvironmentPath(await restoreDiscussionFolder(discussion));
    if (!folderPath) {
      throw new Error("la discussion n'a pas d'environnement associe");
    }
    if (sourceProvider === "codex" && targetProvider === "codex") {
      const copied = await invoke<DiscussionSummary>("copy_discussion_to_account", {
        sessionId: discussion.rolloutId || discussion.sessionId,
        sourceAccountId: discussion.accountId,
        targetAccountId,
      });
      const resumeId = copied.rolloutId || copied.sessionId;
      if (!isPlausibleSessionId(resumeId)) {
        discussionBusyId = null;
        statusText = "Copie effectuee mais identifiant invalide";
        setExpertChatAccountTransition(transferPane, null);
        await refreshDiscussions();
        return;
      }
      copied.folderPath = folderPath;
      const resumed = await resumeDiscussionInChat(
        copied,
        targetAccountId,
        folderPath,
        "continue",
        transferPane,
      );
      if (!resumed) {
        discussionBusyId = null;
        statusText = `La nouvelle discussion est disponible dans « ${target.label} », mais le chat n'a pas demarre. L'ancienne a ete conservee.`;
        setExpertChatAccountTransition(transferPane, null);
        await refreshDiscussions();
        return;
      }
      setExpertChatAccountTransition(transferPane, {
        label: "Compte remplacé",
        detail: `${target.label} a repris la conversation · finalisation`,
      });
      const archivedCount = await archiveTransferredDiscussion(discussion);
      discussionBusyId = null;
      statusText = transferredDiscussionStatus(target, archivedCount);
      setExpertChatAccountTransition(transferPane, null);
      await refreshDiscussions();
      return;
    }

    // Inter-provider : export du transcript puis amorce dans une session neuve.
    const transcript = await invoke<string>("export_discussion_transcript", {
      accountId: discussion.accountId,
      sessionId: discussion.rolloutId || discussion.sessionId,
    });
    const resumed = await resumeDiscussionInChat(
      null,
      targetAccountId,
      folderPath,
      transcript,
      transferPane,
    );
    if (!resumed) {
      discussionBusyId = null;
      statusText = "Le chat cible n'a pas demarre. L'ancienne discussion a ete conservee.";
      setExpertChatAccountTransition(transferPane, null);
      return;
    }
    setExpertChatAccountTransition(transferPane, {
      label: "Compte remplacé",
      detail: `${target.label} a repris la conversation · finalisation`,
    });
    const archivedCount = await archiveTransferredDiscussion(discussion);
    discussionBusyId = null;
    statusText = transferredDiscussionStatus(target, archivedCount);
    setExpertChatAccountTransition(transferPane, null);
    await refreshDiscussions();
  } catch (error) {
    discussionBusyId = null;
    statusText = `Deplacement incomplet : ${String(error)}. L'ancienne discussion a ete conservee si son archivage n'avait pas commence.`;
    setExpertChatAccountTransition(transferPane, null);
  }
};

const discussionHasRunningTurn = (discussion: DiscussionSummary): boolean =>
  (chatDiscussion?.sessionId === discussion.sessionId && chatTurnIsBusy(chatTurn?.status)) ||
  expertChatPanes.some(
    (pane) =>
      pane.discussion?.sessionId === discussion.sessionId && chatTurnIsBusy(pane.turn?.status),
  );

// Deplacement persistant utilise par le drag-and-drop de la barre laterale.
// Le backend reecrit le cwd (et relocalise la session Claude si necessaire),
// puis renvoie le resume a jour pour les chats deja ouverts.
const moveDiscussionToWorkspace = async (
  discussion: DiscussionSummary,
  workspace: WorkspaceProfile,
) => {
  if (discussionBusyId) return;
  if (discussionHasRunningTurn(discussion)) {
    statusText = "Arretez la reponse en cours avant de deplacer cette conversation";
    render();
    return;
  }
  if (
    discussionFolderPath(discussion) &&
    normalizeWorkspacePath(discussionFolderPath(discussion)!) === normalizeWorkspacePath(workspace.path)
  ) {
    statusText = `La conversation est deja dans ${workspace.label}`;
    return;
  }

  discussionBusyId = discussion.sessionId;
  statusText = `Deplacement vers ${workspace.label}…`;
  render();

  try {
    const moved = await invoke<DiscussionSummary>("move_discussion", {
      accountId: discussion.accountId,
      sessionId: discussion.sessionId,
      workspacePath: workspace.path,
    });
    moved.folderPath = workspace.path;
    Object.assign(discussion, moved);
    if (chatDiscussion?.sessionId === moved.sessionId) {
      Object.assign(chatDiscussion, moved);
    }
    expertChatPanes.forEach((pane) => {
      if (pane.discussion?.sessionId === moved.sessionId) {
        Object.assign(pane.discussion, moved);
        pane.pendingWorkspace = workspace.path;
      }
    });
    discussionBusyId = null;
    statusText = `Conversation deplacee vers ${workspace.label}`;
    await refreshDiscussions();
    render();
  } catch (error) {
    discussionBusyId = null;
    statusText = `Deplacement impossible : ${String(error)}`;
    render();
  }
};

const discussionMatchesAnyId = (
  discussion: DiscussionSummary | null | undefined,
  ids: ReadonlySet<string>,
): boolean => !!discussion && (ids.has(discussion.sessionId) || ids.has(discussion.rolloutId));

const removeArchivedDiscussionFromUi = (ids: ReadonlySet<string>) => {
  ids.forEach((id) => discussionTargetSel.delete(id));
  const closedExpertPanes = expertChatPanes.filter((pane) =>
    discussionMatchesAnyId(pane.discussion, ids),
  );
  closedExpertPanes.forEach((pane) => {
    stopExpertChatSync(pane);
    stopExpertChatTurnPoll(pane);
    resetExpertModelCapacityRetry(pane);
  });
  expertChatPanes = expertChatPanes.filter(
    (pane) => !discussionMatchesAnyId(pane.discussion, ids),
  );
  if (closedExpertPanes.some((pane) => pane.key === activeExpertChatKey)) {
    activeExpertChatKey = expertChatPanes[0]?.key ?? null;
  }
  reconcileExpertChatPage();
  if (closedExpertPanes.length) persistExpertChats();
  if (discussionMatchesAnyId(chatDiscussion, ids)) {
    resetMainModelCapacityRetry();
    chatDiscussion = null;
    chatMessages = [];
    chatTurn = null;
    chatQueuedSubmissions = [];
    chatQueueDrainInFlight = false;
    chatError = null;
    chatLoading = false;
    chatTruncated = false;
  }
};

const archiveDiscussionById = async (
  accountId: string,
  archiveId: string,
  relatedIds: readonly string[] = [],
): Promise<number> => {
  const result = await invoke<{ count?: number }>("delete_discussion", {
    accountId,
    sessionId: archiveId,
    archive: true,
  });
  removeArchivedDiscussionFromUi(new Set([archiveId, ...relatedIds]));
  return result?.count ?? 1;
};

const openDiscussionArchiveModal = (discussion: DiscussionSummary) => {
  if (discussionBusyId) return;
  rememberDialogTrigger("discussion-archive", null);
  discussionArchiveCandidate = discussion;
  render();
};

const closeDiscussionArchiveModal = () => {
  if (!discussionArchiveCandidate) return;
  const returnFocus = takeDialogTrigger("discussion-archive");
  discussionArchiveCandidate = null;
  render();
  restoreDialogTrigger(returnFocus);
};

const deleteDiscussion = async () => {
  const discussion = discussionArchiveCandidate;
  if (!discussion || discussionBusyId) return;
  forgetDialogTrigger("discussion-archive");
  discussionArchiveCandidate = null;
  discussionBusyId = discussion.sessionId;
  render();
  try {
    const count = await archiveDiscussionById(
      discussion.accountId,
      discussion.sessionId,
      [discussion.rolloutId],
    );
    statusText = count > 1 ? `Discussion archivee (${count} fichiers)` : "Discussion archivee";
  } catch (error) {
    statusText = String(error);
  }
  discussionBusyId = null;
  await refreshDiscussions();
};

// Compte cible retenu pour une discussion (defaut = compte d'origine, borne
// aux comptes existants pour rester valide meme si la liste a change).
const discussionTargetFor = (discussion: DiscussionSummary): string => {
  const stored = discussionTargetSel.get(discussion.sessionId);
  if (stored && settings?.accounts.some((account) => account.id === stored)) return stored;
  return discussion.accountId;
};

// Le backend conserve le premier message complet dans `preview` pour que la
// recherche porte sur davantage que le titre. Pour l'affichage, on retire le
// titre (qui est un prefixe exact de ce message) afin de ne pas presenter deux
// fois le meme texte dans la carte.
const discussionSubtitle = (discussion: DiscussionSummary): string => {
  const preview = discussion.preview?.trim() ?? "";
  const title = discussion.title?.trim() ?? "";
  if (!preview || !title || !preview.startsWith(title)) return preview;
  return preview
    .slice(title.length)
    .replace(/^[\s:;,.!?\u2014\u2013-]+/, "")
    .trim();
};

// --- Vue conversation interactive -------------------------------------------
// Le provider tourne en arriere-plan, sans TUI visible. Son JSONL reste la
// source de verite : desktop, web et Android voient donc le meme fil.

const chatSelectedAccount = (): AccountProfile | null => {
  const preferred = chatDiscussion?.accountId ?? chatAccountId ?? settings?.defaultAccountId;
  return accountById(preferred) ?? settings?.accounts[0] ?? null;
};

const quotaAlternativeForAccount = (
  currentAccountId: string,
  discussion: DiscussionSummary,
): ChatQuotaSuggestion | null => {
  if (!settings) return null;
  const current = accountById(currentAccountId);
  if (!current) return null;
  const provider = accountProvider(current);
  const eligibleAccountIds = settings.accounts
    .filter(
      (account) => account.id !== current.id && accountProvider(account) === provider,
    )
    .map((account) => account.id);
  const best = bestQuotaAccount(limitStatus, current.id, eligibleAccountIds);
  if (!best) return null;

  return {
    accountId: best.account.id,
    accountLabel: best.account.label,
    remainingPercent: best.remainingPercent,
    busy: discussionBusyId === discussion.sessionId,
  };
};

const quotaSuggestionFor = (
  turn: ChatTurnSnapshot | null,
  discussion: DiscussionSummary | null,
): ChatQuotaSuggestion | null => {
  if (
    !turn ||
    turn.status !== "failed" ||
    !isQuotaExhaustionError(turn.error) ||
    !discussion ||
    !settings
  ) {
    return null;
  }
  return quotaAlternativeForAccount(turn.accountId, discussion);
};

const remainingFromUsedPercent = (value?: number | null): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(100, 100 - value))
    : null;

const chatQuotaResetAt = (quota: AccountLimitView): number | null => {
  const candidates: Array<{ remaining: number; resetAt: number }> = [];
  const add = (usedPercent?: number | null, resetAt?: number | null, exhausted = false) => {
    if (typeof resetAt !== "number" || !Number.isFinite(resetAt)) return;
    const remaining = exhausted ? 0 : remainingFromUsedPercent(usedPercent);
    if (remaining !== null) candidates.push({ remaining, resetAt });
  };

  add(quota.sessionUsedPercent, quota.sessionResetAt);
  add(quota.weeklyUsedPercent, quota.weeklyResetAt);
  quota.buckets.forEach((bucket) => {
    add(bucket.usedPercent, bucket.resetsAt, !!bucket.rateLimitReachedType?.trim());
  });
  candidates.sort((left, right) => left.remaining - right.remaining || left.resetAt - right.resetAt);
  return candidates[0]?.resetAt ?? null;
};

const chatQuotaStatusFor = (account: AccountProfile | null): ChatQuotaStatus => {
  if (!account) {
    return {
      state: "unavailable",
      remainingPercent: null,
      resetAt: null,
      detail: "Aucun compte n'est associé à ce chat.",
    };
  }
  if (!limitStatusLoaded) {
    return {
      state: "loading",
      remainingPercent: null,
      resetAt: null,
      detail: `Lecture des limites de ${account.label}.`,
    };
  }

  const quota = limitStatus.find((candidate) => candidate.id === account.id);
  if (!quota) {
    return {
      state: "unavailable",
      remainingPercent: null,
      resetAt: null,
      detail: `Aucune limite disponible pour ${account.label}.`,
    };
  }
  if (!quota.hasTokens) {
    return {
      state: "disconnected",
      remainingPercent: null,
      resetAt: null,
      detail: `${account.label} doit être connecté avant de pouvoir lire son quota.`,
    };
  }

  const remainingPercent = remainingQuotaPercent(quota);
  const resetAt = chatQuotaResetAt(quota);
  const windows = [
    remainingFromUsedPercent(quota.sessionUsedPercent) === null
      ? ""
      : `5 h : ${Math.round(remainingFromUsedPercent(quota.sessionUsedPercent) ?? 0)} % restant`,
    remainingFromUsedPercent(quota.weeklyUsedPercent) === null
      ? ""
      : `semaine : ${Math.round(remainingFromUsedPercent(quota.weeklyUsedPercent) ?? 0)} % restant`,
  ].filter(Boolean);
  const detail = windows.join(" · ") || quota.error || `Limite fournie par ${quota.source}.`;

  if (remainingPercent === null) {
    return {
      state: quota.error ? "error" : "unavailable",
      remainingPercent: null,
      resetAt,
      detail,
    };
  }
  return {
    state: remainingPercent <= 0 ? "exhausted" : remainingPercent <= 15 ? "low" : "available",
    remainingPercent,
    resetAt,
    detail,
  };
};

let quotaAlternativeRefresh: Promise<void> | null = null;
const refreshQuotaAlternatives = (): Promise<void> => {
  if (quotaAlternativeRefresh) return quotaAlternativeRefresh;
  const pending = refreshLimitStatus(true).finally(() => {
    if (quotaAlternativeRefresh === pending) quotaAlternativeRefresh = null;
    if (activeView !== "chat") return;
    if (isQuotaExhaustionError(chatTurn?.error)) refreshChatFeed();
    expertChatPanes
      .filter((pane) => isQuotaExhaustionError(pane.turn?.error))
      .forEach((pane) => refreshExpertChatPane(pane));
  });
  quotaAlternativeRefresh = pending;
  return pending;
};

const automaticQuotaTransferAttempts = new Set<string>();
let automaticQuotaTransferQueue: Promise<void> = Promise.resolve();
const QUOTA_DURING_COMMAND_ERROR = "Quota epuise detecte pendant une commande en cours";

const failedTurnHasExhaustedQuota = (turn: ChatTurnSnapshot | null | undefined): boolean =>
  turn?.status === "failed" && isQuotaExhaustionError(turn.error);

const quotaTurnNeedsAutomaticTransfer = (
  turn: ChatTurnSnapshot | null | undefined,
): boolean =>
  failedTurnHasExhaustedQuota(turn) || shouldRecoverRunningQuotaTurn(turn, limitStatus);

const sameQuotaTransferTurn = (
  current: ChatTurnSnapshot | null | undefined,
  expected: ChatTurnSnapshot,
): current is ChatTurnSnapshot =>
  !!current &&
  current.id === expected.id &&
  current.accountId === expected.accountId &&
  current.startedAt === expected.startedAt;

const automaticallyTransferQuotaExhaustedDiscussion = (
  discussion: DiscussionSummary,
  turn: ChatTurnSnapshot,
  pane: ExpertChatPane | null = null,
) => {
  if (!quotaTurnNeedsAutomaticTransfer(turn)) return;
  const attemptKey = JSON.stringify([
    pane?.key ?? "main-chat",
    discussion.accountId,
    discussion.sessionId,
    turn.id,
    turn.startedAt,
  ]);
  if (automaticQuotaTransferAttempts.has(attemptKey)) return;
  automaticQuotaTransferAttempts.add(attemptKey);

  automaticQuotaTransferQueue = automaticQuotaTransferQueue
    .catch(() => undefined)
    .then(async () => {
      await refreshQuotaAlternatives();

      const currentDiscussion = pane ? pane.discussion : chatDiscussion;
      const currentTurn = pane ? pane.turn : chatTurn;
      const sourceStillOpen = pane ? expertChatPanes.includes(pane) : !!chatDiscussion;
      if (
        !sourceStillOpen ||
        !currentDiscussion ||
        currentDiscussion.accountId !== discussion.accountId ||
        currentDiscussion.sessionId !== discussion.sessionId ||
        !sameQuotaTransferTurn(currentTurn, turn) ||
        currentDiscussion.accountId !== currentTurn.accountId ||
        !quotaTurnNeedsAutomaticTransfer(currentTurn)
      ) {
        return;
      }

      const suggestion = failedTurnHasExhaustedQuota(currentTurn)
        ? quotaSuggestionFor(currentTurn, currentDiscussion)
        : quotaAlternativeForAccount(currentTurn.accountId, currentDiscussion);
      if (!suggestion) {
        statusText = "Quota epuise : aucun autre compte compatible avec du quota disponible";
        if (activeView === "chat") {
          if (pane) refreshExpertChatPane(pane);
          else render();
        }
        return;
      }

      if (shouldRecoverRunningQuotaTurn(currentTurn, limitStatus)) {
        statusText = `Quota epuise : arret de la commande avant transfert vers « ${suggestion.accountLabel} »...`;
        if (activeView === "chat") {
          if (pane) refreshExpertChatPane(pane);
          else render();
        }

        const stopped = await invoke<ChatTurnSnapshot>("stop_chat_turn", {
          id: currentTurn.id,
        });
        const latestTurn = pane ? pane.turn : chatTurn;
        if (!sameQuotaTransferTurn(latestTurn, turn)) return;

        const stoppedWithQuotaFailure = failedTurnHasExhaustedQuota(stopped);
        if (stopped.status !== "cancelled" && !stoppedWithQuotaFailure) {
          if (pane) await applyExpertChatTurnSnapshot(pane, stopped);
          else await applyChatTurnSnapshot(stopped);
          return;
        }

        const failedTurn = stoppedWithQuotaFailure
          ? stopped
          : {
              ...stopped,
              status: "failed" as const,
              finishedAt: stopped.finishedAt ?? Math.floor(Date.now() / 1000),
              error: QUOTA_DURING_COMMAND_ERROR,
            };
        if (pane) {
          pane.messages = markLatestPendingMessageFailed(pane.messages);
          pane.turn = failedTurn;
          stopExpertChatTurnPoll(pane);
          if (activeView === "chat") refreshExpertChatPane(pane);
        } else {
          chatMessages = markLatestPendingMessageFailed(chatMessages);
          chatTurn = failedTurn;
          stopChatTurnPoll();
          if (activeView === "chat") render();
        }
      }

      const transferDiscussion = pane ? pane.discussion : chatDiscussion;
      const transferTurn = pane ? pane.turn : chatTurn;
      if (
        !transferDiscussion ||
        transferDiscussion.accountId !== discussion.accountId ||
        transferDiscussion.sessionId !== discussion.sessionId ||
        !sameQuotaTransferTurn(transferTurn, turn) ||
        !failedTurnHasExhaustedQuota(transferTurn)
      ) {
        return;
      }

      statusText = `Quota epuise : transfert automatique vers « ${suggestion.accountLabel} »...`;
      await continueDiscussionWith(currentDiscussion, suggestion.accountId, pane);
    })
    .catch((error) => {
      statusText = `Transfert automatique impossible : ${String(error)}`;
      if (activeView === "chat") render();
    })
    .finally(() => {
      automaticQuotaTransferAttempts.delete(attemptKey);
    });
};

// Le provider peut rester vivant dans un outil local sans emettre d'erreur de
// quota. Le polling des limites sert alors de watchdog : il traite les chats
// standards et tous les panneaux experts, y compris ceux hors de la page
// visible de la grille.
const recoverQuotaExhaustedChatTurns = () => {
  if (chatDiscussion && chatTurn && quotaTurnNeedsAutomaticTransfer(chatTurn)) {
    automaticallyTransferQuotaExhaustedDiscussion(chatDiscussion, chatTurn);
  }
  expertChatPanes.forEach((pane) => {
    if (
      !pane.orchestrationId
      && pane.discussion
      && pane.turn
      && quotaTurnNeedsAutomaticTransfer(pane.turn)
    ) {
      automaticallyTransferQuotaExhaustedDiscussion(pane.discussion, pane.turn, pane);
    }
  });
};

const sameModelCapacityRetryTurn = (
  current: ChatTurnSnapshot | null | undefined,
  expected: ChatTurnSnapshot,
): current is ChatTurnSnapshot =>
  !!current &&
  current.id === expected.id &&
  current.accountId === expected.accountId &&
  current.sessionId === expected.sessionId &&
  current.startedAt === expected.startedAt &&
  current.status === "failed" &&
  isModelCapacityError(current.error);

const modelCapacityResumeSessionId = (
  turn: ChatTurnSnapshot,
  discussion: DiscussionSummary | null,
): string | null =>
  turn.sessionId?.trim() || discussion?.rolloutId || discussion?.sessionId || null;

const resetMainModelCapacityRetry = (clearActiveSubmission = true) => {
  if (chatCapacityRetryTimer !== null) {
    window.clearTimeout(chatCapacityRetryTimer);
    chatCapacityRetryTimer = null;
  }
  chatCapacityRetryAttempt = 0;
  if (clearActiveSubmission) chatActiveSubmission = null;
};

const resetExpertModelCapacityRetry = (
  pane: ExpertChatPane,
  clearActiveSubmission = true,
) => {
  if (pane.capacityRetryTimer !== null) {
    window.clearTimeout(pane.capacityRetryTimer);
    pane.capacityRetryTimer = null;
  }
  pane.capacityRetryAttempt = 0;
  if (clearActiveSubmission) pane.activeSubmission = null;
};

const modelCapacityTurnError = (
  turn: ChatTurnSnapshot | null | undefined,
  activeSubmission: QueuedChatSubmission | null,
  retryAttempt: number,
  retryScheduled: boolean,
): string | null => {
  if (turn?.status !== "failed") return null;
  const fallback = turn.error ?? "La reponse a echoue";
  if (!isModelCapacityError(turn.error) || !activeSubmission) return fallback;
  if (retryScheduled) {
    return `Le modele ${activeSubmission.model} est temporairement sature. Nouvelle tentative automatique avec le meme modele (${retryAttempt}/${MODEL_CAPACITY_RETRY_LIMIT}).`;
  }
  if (retryAttempt >= MODEL_CAPACITY_RETRY_LIMIT) {
    return `Le modele ${activeSubmission.model} reste sature apres ${MODEL_CAPACITY_RETRY_LIMIT} tentatives automatiques. Vous pouvez renvoyer « continue » plus tard.`;
  }
  return fallback;
};

const scheduleMainModelCapacityRetry = (turn: ChatTurnSnapshot): boolean => {
  if (turn.status !== "failed" || !isModelCapacityError(turn.error)) return false;
  if (chatCapacityRetryTimer !== null) return true;
  const activeSubmission = chatActiveSubmission;
  if (!activeSubmission) return false;
  if (chatCapacityRetryAttempt >= MODEL_CAPACITY_RETRY_LIMIT) {
    statusText = `Le modele ${activeSubmission.model} reste sature apres ${MODEL_CAPACITY_RETRY_LIMIT} tentatives automatiques`;
    return false;
  }

  chatCapacityRetryAttempt += 1;
  const attempt = chatCapacityRetryAttempt;
  const delay = modelCapacityRetryDelayMs(attempt);
  statusText = `Modele ${activeSubmission.model} sature · nouvelle tentative dans ${Math.ceil(delay / 1_000)} s (${attempt}/${MODEL_CAPACITY_RETRY_LIMIT})`;
  chatCapacityRetryTimer = window.setTimeout(() => {
    chatCapacityRetryTimer = null;
    if (!sameModelCapacityRetryTurn(chatTurn, turn)) return;
    const resumeSessionId = modelCapacityResumeSessionId(turn, chatDiscussion);
    statusText = `Reprise automatique avec ${activeSubmission.model} (${attempt}/${MODEL_CAPACITY_RETRY_LIMIT})`;
    void sendChatMessage("message", {
      ...activeSubmission,
      prompt: modelCapacityRetryPrompt(resumeSessionId, activeSubmission.prompt),
      model: activeSubmission.model,
      reasoningEffort: activeSubmission.reasoningEffort,
      automaticCapacityRetry: true,
      resumeSessionId,
    });
  }, delay);
  return true;
};

const scheduleExpertModelCapacityRetry = (
  pane: ExpertChatPane,
  turn: ChatTurnSnapshot,
): boolean => {
  if (turn.status !== "failed" || !isModelCapacityError(turn.error)) return false;
  if (pane.capacityRetryTimer !== null) return true;
  const activeSubmission = pane.activeSubmission;
  if (!activeSubmission || !expertChatPanes.includes(pane)) return false;
  if (pane.capacityRetryAttempt >= MODEL_CAPACITY_RETRY_LIMIT) {
    statusText = `Le modele ${activeSubmission.model} reste sature apres ${MODEL_CAPACITY_RETRY_LIMIT} tentatives automatiques`;
    return false;
  }

  pane.capacityRetryAttempt += 1;
  const attempt = pane.capacityRetryAttempt;
  const delay = modelCapacityRetryDelayMs(attempt);
  statusText = `Modele ${activeSubmission.model} sature · nouvelle tentative dans ${Math.ceil(delay / 1_000)} s (${attempt}/${MODEL_CAPACITY_RETRY_LIMIT})`;
  pane.capacityRetryTimer = window.setTimeout(() => {
    pane.capacityRetryTimer = null;
    if (
      !expertChatPanes.includes(pane) ||
      !sameModelCapacityRetryTurn(pane.turn, turn)
    ) {
      return;
    }
    const resumeSessionId = modelCapacityResumeSessionId(turn, pane.discussion);
    statusText = `Reprise automatique avec ${activeSubmission.model} (${attempt}/${MODEL_CAPACITY_RETRY_LIMIT})`;
    void sendExpertChatMessage(
      pane,
      expertChatPaneRoot(pane),
      undefined,
      "message",
      {
        ...activeSubmission,
        prompt: modelCapacityRetryPrompt(resumeSessionId, activeSubmission.prompt),
        model: activeSubmission.model,
        reasoningEffort: activeSubmission.reasoningEffort,
        automaticCapacityRetry: true,
        resumeSessionId,
      },
    );
  }, delay);
  return true;
};

const readChatPreferences = (account: AccountProfile, root: ParentNode = document) => {
  const provider = accountProvider(account);
  const previousModel = accountModel(account);
  const previousReasoningEffort = accountReasoningEffort(account);
  const model =
    root.querySelector<HTMLInputElement>("[data-chat-control='model'], #chatModel")?.value.trim() || previousModel;
  const reasoningEffort =
    provider === "codex"
      ? reasoningEffortForChatModel(
          account,
          model,
          root.querySelector<HTMLSelectElement>("[data-chat-control='reasoning-effort'], #chatReasoningEffort")?.value ??
            previousReasoningEffort,
        )
      : null;

  if (model.length > 160 || /\s/.test(model)) {
    return {
      model,
      reasoningEffort,
      changed: false,
      error: "Le nom du modele doit faire 160 caracteres maximum et ne contenir aucun espace",
    };
  }

  account.model = model;
  if (reasoningEffort) account.reasoningEffort = reasoningEffort;

  return {
    model,
    reasoningEffort,
    changed:
      model !== previousModel ||
      (provider === "codex" && reasoningEffort !== previousReasoningEffort),
    error: null,
  };
};

// Les controles du chat deviennent aussi les valeurs par defaut du compte.
// Les sauvegardes sont serialisees pour qu'un changement rapide de
// modele puis d'intensite ne puisse pas s'ecraser dans settings.json.
const persistChatPreferences = (accountId: string) => {
  chatPreferencesSave = chatPreferencesSave
    .catch(() => undefined)
    .then(async () => {
      if (!settings) return;
      await invoke<AppSettings>("save_settings", { settings });
      const account = accountById(accountId);
      if (account) await provisionAccountHome(account);
    })
    .catch((error) => {
      statusText = `Preferences du chat non enregistrees : ${String(error)}`;
    });
};

const chatPanelModel = (): ChatPanelModel => {
  const discussion = chatDiscussion;
  const account = chatSelectedAccount();
  const provider = accountProvider(account);
  const selectedModel = accountModel(account);
  const catalog = account ? chatModelCatalogs.get(account.id) : undefined;
  const workspace =
    discussionFolderPath(discussion) ?? pendingChatWorkspace ?? currentWorkspace() ?? account?.projectDir ?? null;
  const metaParts = discussion
    ? [
        discussion.accountLabel,
        workspace ? displayProjectDir(workspace) : "",
        `${chatMessages.length || discussion.messageCount} message(s)`,
      ].filter(Boolean)
    : [account?.label ?? "Choisissez un compte", workspace ? displayProjectDir(workspace) : "Environnement a choisir"];
  return {
    title: discussion?.title?.trim() || "Nouvelle conversation",
    subtitle: metaParts.join(" \u00b7 "),
    accountLabel: account?.label ?? discussion?.accountLabel ?? "Aucun compte",
    providerLabel: providerLabel(accountProvider(account)),
    loading: chatLoading,
    error: chatError,
    truncated: chatTruncated,
    syncState: discussion ? chatSyncState : "closed",
    messages: chatMessages,
    activities: chatTurn?.activities ?? [],
    thoughts: chatTurn?.thoughts ?? [],
    parts: chatTurn?.parts ?? [],
    turnStatus: chatTurn?.status ?? "idle",
    turnStartedAt: chatTurn?.startedAt ?? null,
    turnFinishedAt: chatTurn?.finishedAt ?? null,
    turnError: modelCapacityTurnError(
      chatTurn,
      chatActiveSubmission,
      chatCapacityRetryAttempt,
      chatCapacityRetryTimer !== null,
    ),
    waitingForUser: conversationWaitsForUser(chatMessages, chatTurn?.parts ?? []),
    quotaStatus: chatQuotaStatusFor(account),
    quotaSuggestion: quotaSuggestionFor(chatTurn, discussion),
    accounts: (settings?.accounts ?? []).map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      providerLabel: providerLabel(accountProvider(candidate)),
      model: accountModel(candidate),
    })),
    selectedAccountId: account?.id ?? "",
    selectedModel,
    modelSuggestions:
      provider === "claude"
        ? CLAUDE_MODEL_SUGGESTIONS
        : catalog?.map((model) => model.id) ?? CODEX_MODEL_SUGGESTIONS,
    selectedReasoningEffort: reasoningEffortForChatModel(
      account,
      selectedModel,
      accountReasoningEffort(account),
    ),
    reasoningEffortOptions: chatReasoningEffortOptions(account, selectedModel),
    supportsReasoningEffort: provider === "codex",
    supportsGoals: provider === "codex",
    agentTools: chatAgentToolDefinitions(),
    enabledTools: chatEnabledTools,
    mode: chatMode,
    draft: chatDraft,
    queuedCount: chatQueuedSubmissions.length,
    newConversation: !discussion,
    workspaceLabel: workspace ? displayProjectDir(workspace) : "Environnement",
    historyOpen: chatHistoryOpen,
  };
};

const patchChatRuntimeStatus = (root: ParentNode, model: ChatPanelModel): boolean => {
  const current = root.querySelector<HTMLElement>("[data-chat-control='runtime']");
  const turnStatus = root.querySelector<HTMLElement>("[data-chat-control='turn-status']");
  if (!current && !turnStatus) return false;
  const signature = chatRuntimeRenderSignature(model);
  if (chatRuntimeSignatures.get(root) === signature) return false;
  if (current) current.outerHTML = renderChatRuntimeStatus(model);
  if (turnStatus) turnStatus.outerHTML = renderChatTurnStatus(model);
  chatRuntimeSignatures.set(root, signature);
  return true;
};

const refreshAllChatRuntimeStatus = () => {
  if (activeView !== "chat") return;
  const mainPanel = document.querySelector<HTMLElement>("#chatPanel");
  if (mainPanel && patchChatRuntimeStatus(mainPanel, chatPanelModel())) renderIcons(mainPanel);
  expertChatPanes.forEach((pane) => {
    const root = expertChatPaneRoot(pane);
    if (root && patchChatRuntimeStatus(root, expertChatPanelModel(pane))) renderIcons(root);
  });
  refreshChatRuntimeClocks();
};

const refreshChatRuntimeClocks = () => {
  const now = Date.now() / 1000;
  document.querySelectorAll<HTMLElement>("[data-chat-elapsed]").forEach((element) => {
    const startedAt = Number(element.dataset.chatStartedAt);
    const finishedAt = Number(element.dataset.chatFinishedAt || 0);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return;
    const value = element.querySelector<HTMLElement>("[data-chat-elapsed-value]");
    if (value) {
      value.textContent = formatChatDuration(Math.max(0, (finishedAt || now) - startedAt));
    }
  });
  document.querySelectorAll<HTMLElement>("[data-chat-reset]").forEach((element) => {
    const resetAt = Number(element.dataset.chatResetAt);
    if (Number.isFinite(resetAt) && resetAt > 0) {
      element.textContent = formatChatResetCountdown(resetAt, now);
    }
  });
  refreshAutonomousScheduleLabels();
};

const startChatRuntimeClock = () => {
  if (chatRuntimeClock !== null) return;
  refreshChatRuntimeClocks();
  chatRuntimeClock = window.setInterval(
    () => runWhenPageVisible(refreshChatRuntimeClocks),
    1000,
  );
};

const stopChatRuntimeClock = () => {
  if (chatRuntimeClock !== null) {
    clearInterval(chatRuntimeClock);
    chatRuntimeClock = null;
  }
};

const refreshChatSyncIndicator = () => {
  const indicator = document.querySelector<HTMLSpanElement>("#chatSync");
  if (!indicator) return;
  indicator.className = `chat-sync chat-sync--${chatSyncState}`;
  const label = indicator.querySelector<HTMLElement>("[data-chat-sync-label]");
  if (label) label.textContent = chatSyncLabel(chatSyncState);
};

const rememberChatFeedScroll = (
  feed: HTMLElement,
  state: ChatScrollState,
  userMovedAway = false,
) => updateChatScrollState(state, feed, userMovedAway);

const captureChatFeedScroll = () => {
  if (skipNextChatScrollCapture) {
    skipNextChatScrollCapture = false;
    return;
  }
  const feed = document.querySelector<HTMLDivElement>("#chatFeed");
  if (feed) rememberChatFeedScroll(feed, chatScrollState);
};

const restoreChatFeedScroll = (
  feed: HTMLElement | null,
  state: ChatScrollState = chatScrollState,
) => {
  if (!feed) return;
  const applyPosition = () => {
    feed.scrollTop = restoreChatScrollTop(state, feed);
    state.scrollTop = feed.scrollTop;
  };
  applyPosition();

  // Le premier calcul peut preceder la mise en page finale (police, icones,
  // changement de hauteur du composer). Un second passage garde le dernier
  // message visible sans contrer une remontee effectuee entre-temps.
  window.requestAnimationFrame(() => {
    if (feed.isConnected && state.followLatest) applyPosition();
  });
};

const resetChatFeedScroll = () => {
  chatScrollState.followLatest = true;
  chatScrollState.scrollTop = 0;
  // Le DOM contient encore l'ancien chat jusqu'au prochain render : ne pas
  // capturer sa position apres avoir demande la remise a zero.
  skipNextChatScrollCapture = true;
};

const bindChatFeedScroll = (
  feed: HTMLDivElement,
  state: ChatScrollState = chatScrollState,
) => {
  let pointerDown = false;
  feed.addEventListener("scroll", () => {
    const userMovedAway = feed.scrollTop < state.scrollTop - 0.5;
    rememberChatFeedScroll(feed, state, userMovedAway);
  }, { passive: true });

  // Le listener scroll arrive apres le geste. On desactive donc le suivi des le
  // debut d'une remontee afin qu'un tick de streaming concurrent ne l'annule pas.
  feed.addEventListener(
    "wheel",
    (event) => {
      if (event.deltaY < 0 && feed.scrollTop > 0) {
        pauseChatScrollFollow(state, feed);
      }
    },
    { passive: true },
  );

  feed.addEventListener("pointerdown", (event) => {
    pointerDown = true;
    const bounds = feed.getBoundingClientRect();
    const usesScrollbar =
      event.pointerType === "mouse" &&
      feed.scrollHeight > feed.clientHeight &&
      event.clientX >= bounds.left + feed.clientWidth;
    if (usesScrollbar && feed.scrollTop > 0) pauseChatScrollFollow(state, feed);
  }, { passive: true });
  feed.addEventListener("pointerup", () => {
    pointerDown = false;
  }, { passive: true });
  feed.addEventListener("pointercancel", () => {
    pointerDown = false;
  }, { passive: true });
  feed.addEventListener("pointerleave", (event) => {
    if (pointerDown && event.buttons > 0 && feed.scrollTop > 0) {
      pauseChatScrollFollow(state, feed);
    }
    pointerDown = false;
  }, { passive: true });

  feed.addEventListener("keydown", (event) => {
    if (event.target !== feed || feed.scrollTop <= 0) return;
    const movesUp =
      event.key === "ArrowUp" ||
      event.key === "PageUp" ||
      event.key === "Home" ||
      (event.key === " " && event.shiftKey);
    if (movesUp) pauseChatScrollFollow(state, feed);
  });

  let lastTouchY: number | null = null;
  feed.addEventListener(
    "touchstart",
    (event) => {
      lastTouchY = event.touches[0]?.clientY ?? null;
    },
    { passive: true },
  );
  feed.addEventListener(
    "touchmove",
    (event) => {
      const touchY = event.touches[0]?.clientY ?? null;
      if (touchY !== null && lastTouchY !== null && touchY > lastTouchY && feed.scrollTop > 0) {
        pauseChatScrollFollow(state, feed);
      }
      lastTouchY = touchY;
    },
    { passive: true },
  );
  feed.addEventListener("touchend", () => {
    lastTouchY = null;
  }, { passive: true });
  feed.addEventListener("touchcancel", () => {
    lastTouchY = null;
  }, { passive: true });
};

// Patch cible du fil (#chatFeed) : pas de re-render global. Le suivi
// reste actif jusqu'a une remontee explicite, puis reprend quand le bas est
// atteint. La position absolue est conservee pendant le remplacement du HTML.
const refreshChatFeed = () => {
  const feed = document.querySelector<HTMLDivElement>("#chatFeed");
  if (!feed) {
    render();
    return;
  }
  chatScrollState.scrollTop = feed.scrollTop;
  const model = chatPanelModel();
  const feedSignature = chatFeedRenderSignature(model);
  const feedChanged = chatFeedSignatures.get(feed) !== feedSignature;
  if (feedChanged) {
    feed.innerHTML = renderChatFeedInner(model);
    chatFeedSignatures.set(feed, feedSignature);
  }
  const panel = document.querySelector<HTMLElement>("#chatPanel");
  const runtimeChanged = panel ? patchChatRuntimeStatus(panel, model) : false;
  const subtitle = document.querySelector<HTMLSpanElement>("#chatSubtitle");
  if (subtitle) subtitle.textContent = model.subtitle;
  const historyCount = document.querySelector<HTMLElement>("#chatHistoryToggle small");
  if (historyCount) {
    historyCount.textContent = String(chatMessages.filter((message) => message.role === "user").length);
  }
  refreshChatSyncIndicator();
  if (feedChanged || runtimeChanged) renderIcons(panel ?? feed);
  if (feedChanged) restoreChatFeedScroll(feed);
};

const stopChatTurnPoll = () => {
  if (chatTurnPoll !== null) {
    clearInterval(chatTurnPoll);
    chatTurnPoll = null;
  }
  chatTurnPollInFlight = false;
};

const findDiscussionByRollout = (sessionId: string) =>
  allDiscussions().find(
    (discussion) => discussion.sessionId === sessionId || discussion.rolloutId === sessionId,
  ) ?? null;

const attachCreatedChat = async (sessionId: string): Promise<boolean> => {
  if (chatDiscussion) return true;
  let discussion = findDiscussionByRollout(sessionId);
  if (!discussion) {
    await refreshDiscussions();
    discussion = findDiscussionByRollout(sessionId);
  }
  if (!discussion) return false;

  chatDiscussion = discussion;
  chatAccountId = discussion.accountId;
  void loadChatModelCatalog(chatAccountId);
  chatLoading = false;
  chatError = null;
  startChatSync();
  void loadChatTranscript();
  return true;
};

const applyChatTurnSnapshot = async (snapshot: ChatTurnSnapshot) => {
  const pane = expertChatPanes.find(
    (candidate) =>
      !!candidate.turn &&
      chatTurnIsBusy(candidate.turn?.status) &&
      (candidate.turn.id === 0 || candidate.turn.id === snapshot.id) &&
      candidate.turn.accountId === snapshot.accountId,
  ) ?? activeExpertChatPane();
  if (pane?.turn && chatTurnIsBusy(pane.turn.status)) {
    await applyExpertChatTurnSnapshot(pane, snapshot);
    return;
  }
  if (chatTurn && chatTurn.id !== 0 && snapshot.id !== chatTurn.id) return;
  const previousStatus = chatTurn?.status;
  const previousStartedAt = chatTurn?.startedAt;
  const previousTurnId = chatTurn?.id;
  if (
    previousStartedAt != null &&
    (previousTurnId === 0 || previousTurnId === snapshot.id)
  ) {
    snapshot = { ...snapshot, startedAt: Math.min(previousStartedAt, snapshot.startedAt) };
  }
  chatTurn = snapshot;
  const quotaExhausted =
    snapshot.status === "failed" &&
    isQuotaExhaustionError(snapshot.error);
  const modelCapacityReached =
    snapshot.status === "failed" &&
    isModelCapacityError(snapshot.error);
  const attached = snapshot.sessionId ? await attachCreatedChat(snapshot.sessionId) : !!chatDiscussion;

  if (snapshot.status === "finalizing") {
    statusText = "Reponse terminee, synchronisation…";
  } else if (snapshot.status === "completed") {
    statusText = "Reponse terminee";
    if (attached) await loadChatTranscript();
    stopChatTurnPoll();
  } else if (snapshot.status === "failed") {
    chatMessages = markLatestPendingMessageFailed(chatMessages);
    statusText = snapshot.error || "La reponse a echoue";
    stopChatTurnPoll();
  } else if (snapshot.status === "cancelled") {
    statusText = "Reponse arretee";
    stopChatTurnPoll();
  } else {
    statusText = `${chatPanelModel().providerLabel} travaille…`;
  }

  if (modelCapacityReached) {
    scheduleMainModelCapacityRetry(snapshot);
  } else if (!chatTurnIsBusy(snapshot.status)) {
    resetMainModelCapacityRetry();
  }

  if (
    !quotaExhausted &&
    chatTurnIsBusy(previousStatus) &&
    !chatTurnIsBusy(snapshot.status)
  ) {
    void refreshLimitStatus(true);
  }
  if (chatBecameAvailable(previousStatus, snapshot.status)) {
    void playChatReadySound(chatReadySoundPreferences);
  }
  const promptHadFocus = document.activeElement ===
    document.querySelector<HTMLTextAreaElement>("#chatPrompt");
  if (activeView === "chat") {
    if (previousStatus !== snapshot.status) render();
    else refreshChatFeed();
  }
  if (promptHadFocus) focusMainChatPrompt();
  if (quotaExhausted) {
    if (chatDiscussion) automaticallyTransferQuotaExhaustedDiscussion(chatDiscussion, snapshot);
    else void refreshQuotaAlternatives();
  } else if (modelCapacityReached) {
    // La file utilisateur attend d'abord la reprise automatique de ce tour.
  } else if (!chatTurnIsBusy(snapshot.status)) {
    void drainChatSubmissionQueue();
  }
};

const pollChatTurn = async () => {
  if (!chatTurn || chatTurn.id === 0 || chatTurnPollInFlight) return;
  chatTurnPollInFlight = true;
  try {
    const snapshot = await invoke<ChatTurnSnapshot>("chat_turn_status", { id: chatTurn.id });
    await applyChatTurnSnapshot(snapshot);
  } catch (error) {
    statusText = `Suivi de la reponse : ${String(error)}`;
  } finally {
    chatTurnPollInFlight = false;
  }
};

const startChatTurnPoll = () => {
  stopChatTurnPoll();
  chatTurnPoll = window.setInterval(
    () => {
      if (chatQueuedSubmissions.length > 0) void pollChatTurn();
      else runWhenPageVisible(() => void pollChatTurn());
    },
    550,
  );
};

const chatSubmissionPrompt = (
  input: HTMLTextAreaElement | null,
  fallback: string,
  intent: ChatSubmitIntent,
): string => {
  const value = (input?.value ?? fallback).trim();
  if (!value) {
    if (intent === "goal" && input) {
      input.setCustomValidity("Décrivez l'objectif du goal avant de le créer.");
      input.reportValidity();
      input.focus();
    }
    return "";
  }
  input?.setCustomValidity("");
  return intent === "goal" ? createGoalPrompt(value) : value;
};

const focusMainChatPrompt = () => {
  window.requestAnimationFrame(() => {
    const input = document.querySelector<HTMLTextAreaElement>("#chatPrompt");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
};

const sendChatMessage = async (
  intent: ChatSubmitIntent = "message",
  queuedSubmission: QueuedChatSubmission | null = null,
): Promise<boolean> => {
  const input = queuedSubmission
    ? null
    : document.querySelector<HTMLTextAreaElement>("#chatPrompt");
  const prompt = queuedSubmission?.prompt ?? chatSubmissionPrompt(input, chatDraft, intent);
  const account = queuedSubmission
    ? accountById(queuedSubmission.accountId)
    : chatSelectedAccount();
  if (!prompt || !account) {
    statusText = account
      ? intent === "goal" ? "Décrivez le goal" : "Ecrivez un message"
      : "Ajoutez d'abord un compte agent";
    return false;
  }
  if (intent === "goal" && accountProvider(account) !== "codex") {
    statusText = "Les goals sont disponibles avec Codex";
    return false;
  }
  const preferences = queuedSubmission
    ? {
        model: queuedSubmission.model,
        reasoningEffort: queuedSubmission.reasoningEffort,
        changed: false,
        error: null,
      }
    : readChatPreferences(account);
  if (preferences.error) {
    const modelInput = document.querySelector<HTMLInputElement>("#chatModel");
    modelInput?.setCustomValidity(preferences.error);
    modelInput?.reportValidity();
    statusText = preferences.error;
    return false;
  }
  if (preferences.changed) persistChatPreferences(account.id);

  const submission = queuedSubmission ?? {
    prompt,
    accountId: account.id,
    mode: chatMode,
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    enabledTools: [...chatEnabledTools],
    agentSkills: chatAgentSkillPrompts(chatEnabledTools),
  };
  if (
    chatTurnIsBusy(chatTurn?.status) ||
    (!queuedSubmission && chatQueuedSubmissions.length > 0)
  ) {
    if (queuedSubmission) chatQueuedSubmissions.unshift(submission);
    else chatQueuedSubmissions.push(submission);
    if (!queuedSubmission) chatDraft = "";
    statusText = chatTurnIsBusy(chatTurn?.status)
      ? `Message mis en attente · ${chatQueuedSubmissions.length} dans la file`
      : "Envoi du prochain message en attente";
    render();
    focusMainChatPrompt();
    if (!chatTurnIsBusy(chatTurn?.status)) void drainChatSubmissionQueue();
    return true;
  }

  if (!submission.automaticCapacityRetry) resetMainModelCapacityRetry();
  chatActiveSubmission = submission;
  const resumeSessionId =
    submission.resumeSessionId ??
    chatDiscussion?.rolloutId ??
    chatDiscussion?.sessionId ??
    null;
  if (!queuedSubmission) chatDraft = "";
  chatError = null;
  chatMessages = [
    ...chatMessages,
    {
      role: "user",
      text: prompt,
      timestamp: Math.floor(Date.now() / 1000),
      deliveryState: "pending",
    },
  ];
  chatTurn = {
    id: 0,
    accountId: account.id,
    sessionId: resumeSessionId,
    status: "running",
    startedAt: Math.floor(Date.now() / 1000),
    finishedAt: null,
    error: null,
    activities: [
      {
        id: "preparing",
        kind: "think",
        label: `${providerLabel(accountProvider(account))} prepare la reponse`,
        detail: null,
        status: "running",
      },
    ],
    thoughts: [
      {
        id: "preparing-thought",
        kind: "reasoning",
        text: `${providerLabel(accountProvider(account))} analyse la demande et prépare la prochaine étape.`,
        status: "running",
      },
    ],
    parts: [],
  };
  statusText = `${providerLabel(accountProvider(account))} travaille…`;
  resetChatFeedScroll();
  render();
  focusMainChatPrompt();

  try {
    const snapshot = await invoke<ChatTurnSnapshot>("start_chat_turn", {
      accountId: account.id,
      sessionId: resumeSessionId,
      prompt,
      projectDir:
        discussionFolderPath(chatDiscussion) ?? pendingChatWorkspace ?? currentWorkspace() ?? account.projectDir ?? null,
      mode: submission.mode,
      model: preferences.model,
      reasoningEffort: preferences.reasoningEffort,
      sourceChatKey: activeExpertChatKey,
      agentTools: submission.enabledTools.filter(isChatAgentModeId),
      agentSkills: submission.agentSkills,
    });
    const pane = expertChatPanes.find(
      (candidate) =>
        candidate.turn?.status === "running" &&
        candidate.turn.id === 0 &&
        candidate.turn.accountId === snapshot.accountId,
    );
    if (pane) {
      pane.activeSubmission ??= chatActiveSubmission;
      const optimisticStartedAt = pane.turn?.startedAt;
      pane.turn = optimisticStartedAt == null
        ? snapshot
        : { ...snapshot, startedAt: Math.min(optimisticStartedAt, snapshot.startedAt) };
      startExpertChatTurnPoll(pane);
      await applyExpertChatTurnSnapshot(pane, pane.turn);
      return snapshot.status !== "failed" && snapshot.status !== "cancelled";
    }
    const optimisticStartedAt = chatTurn?.startedAt;
    chatTurn = optimisticStartedAt == null
      ? snapshot
      : { ...snapshot, startedAt: Math.min(optimisticStartedAt, snapshot.startedAt) };
    startChatTurnPoll();
    await applyChatTurnSnapshot(chatTurn);
    return snapshot.status !== "failed" && snapshot.status !== "cancelled";
  } catch (error) {
    chatMessages = markLatestPendingMessageFailed(chatMessages);
    const pane = expertChatPanes.find(
      (candidate) =>
        candidate.turn?.status === "running" &&
        candidate.turn.id === 0 &&
        candidate.turn.accountId === account.id,
    );
    if (pane) {
      pane.activeSubmission ??= chatActiveSubmission;
      const failedTurn = {
        ...pane.turn!,
        status: "failed",
        finishedAt: Math.floor(Date.now() / 1000),
        error: String(error),
      } as ChatTurnSnapshot;
      pane.turn = failedTurn;
      statusText = String(error);
      const modelCapacityReached = isModelCapacityError(String(error));
      if (modelCapacityReached) {
        scheduleExpertModelCapacityRetry(pane, failedTurn);
      } else {
        resetExpertModelCapacityRetry(pane);
      }
      refreshExpertChatPane(pane);
      if (isQuotaExhaustionError(String(error))) {
        if (pane.discussion) {
          automaticallyTransferQuotaExhaustedDiscussion(pane.discussion, failedTurn, pane);
        } else {
          void refreshQuotaAlternatives();
        }
      }
      if (!isQuotaExhaustionError(String(error)) && !modelCapacityReached) {
        void drainExpertChatSubmissionQueue(pane);
      }
      return false;
    }
    const failedTurn = {
      ...chatTurn,
      id: 0,
      status: "failed",
      finishedAt: Math.floor(Date.now() / 1000),
      error: String(error),
    } as ChatTurnSnapshot;
    chatTurn = failedTurn;
    statusText = String(error);
    const modelCapacityReached = isModelCapacityError(String(error));
    if (modelCapacityReached) {
      scheduleMainModelCapacityRetry(failedTurn);
    } else {
      resetMainModelCapacityRetry();
    }
    render();
    if (isQuotaExhaustionError(String(error))) {
      if (chatDiscussion) {
        automaticallyTransferQuotaExhaustedDiscussion(chatDiscussion, failedTurn);
      } else {
        void refreshQuotaAlternatives();
      }
    } else if (!modelCapacityReached) {
      void drainChatSubmissionQueue();
    }
    return false;
  }
};

const drainChatSubmissionQueue = async (): Promise<void> => {
  if (
    chatQueueDrainInFlight ||
    chatTurnIsBusy(chatTurn?.status) ||
    chatQueuedSubmissions.length === 0
  ) {
    return;
  }
  const submission = chatQueuedSubmissions.shift();
  if (!submission) return;
  chatQueueDrainInFlight = true;
  try {
    await sendChatMessage("message", submission);
  } finally {
    chatQueueDrainInFlight = false;
    if (
      !chatTurnIsBusy(chatTurn?.status) &&
      !isQuotaExhaustionError(chatTurn?.error) &&
      !isModelCapacityError(chatTurn?.error) &&
      chatQueuedSubmissions.length > 0
    ) {
      void drainChatSubmissionQueue();
    }
  }
};

const closeWorkspace = async (
  workspace: WorkspaceProfile,
  removedFromEnvironmentMenu = false,
): Promise<void> => {
  if (!settings || workspaceClosingId) return;
  const id = workspaceIdForPath(workspace.path);
  const terminalCount = terminalSessions.filter(
    (session) => session.folderPath && workspaceIdForPath(session.folderPath) === id,
  ).length;

  workspaceClosingId = id;
  const previousWorkspaces = settings.workspaces;
  const previousClosedIds = settings.closedWorkspaceIds;
  const update = closeWorkspaceRegistry(
    settings.workspaces ?? [],
    settings.closedWorkspaceIds ?? [],
    workspace.path,
  );
  settings.workspaces = update.workspaces;
  settings.closedWorkspaceIds = update.closedWorkspaceIds;

  try {
    settings = await invoke<AppSettings>("save_settings", { settings });
  } catch (error) {
    settings.workspaces = previousWorkspaces;
    settings.closedWorkspaceIds = previousClosedIds;
    workspaceClosingId = null;
    statusText = `Fermeture impossible : ${String(error)}`;
    render();
    return;
  }

  forgetWorkspace(workspace.path);
  const activePath = currentWorkspace();
  const closedActiveWorkspace = !!activePath && workspaceIdForPath(activePath) === id;
  if (closedActiveWorkspace) {
    setCurrentWorkspace(null);
  }
  if (terminalFolderFilter && workspaceIdForPath(terminalFolderFilter) === id) {
    terminalFolderFilter = null;
  }
  if (activeChatWorkspaceFilter() === id) setChatWorkspaceFilter(WORKSPACE_ALL);
  if (pendingChatWorkspace && workspaceIdForPath(pendingChatWorkspace) === id) {
    pendingChatWorkspace = null;
  }
  if (newTerminalWorkspacePath && workspaceIdForPath(newTerminalWorkspacePath) === id) {
    newTerminalWorkspacePath = null;
  }
  let expertChatsChanged = false;
  expertChatPanes.forEach((pane) => {
    if (
      !pane.discussion &&
      pane.pendingWorkspace &&
      workspaceIdForPath(pane.pendingWorkspace) === id
    ) {
      pane.pendingWorkspace = null;
      expertChatsChanged = true;
    }
  });
  if (expertChatsChanged) persistExpertChats();

  workspaceClosingId = null;
  const action = removedFromEnvironmentMenu ? "supprime de Switch" : "ferme";
  statusText = terminalCount
    ? `Environnement « ${workspace.label} » ${action} · ${terminalCount} terminal${terminalCount > 1 ? "s restent" : " reste"} ouvert${terminalCount > 1 ? "s" : ""}`
    : `Environnement « ${workspace.label} » ${action}`;
  render();
};

const stopCurrentChatTurn = async () => {
  if (!chatTurn || chatTurn.status !== "running") return;
  if (chatTurn.id === 0) {
    chatTurn = { ...chatTurn, status: "cancelled" };
    stopChatTurnPoll();
    render();
    focusMainChatPrompt();
    void drainChatSubmissionQueue();
    return;
  }
  try {
    await applyChatTurnSnapshot(
      await invoke<ChatTurnSnapshot>("stop_chat_turn", { id: chatTurn.id }),
    );
  } catch (error) {
    statusText = String(error);
  }
};

const openNewChat = () => {
  openNewChatModal();
};

const applyChatTranscript = (
  discussion: DiscussionSummary,
  transcript: DiscussionTranscriptView,
) => {
  if (chatDiscussion !== discussion) return;
  const wasLoading = chatLoading;
  const nextMessages = reconcileChatMessages(
    chatMessages,
    transcript.messages,
    true,
  );
  const changed = !chatMessagesEqual(chatMessages, nextMessages);
  const truncationChanged = chatTruncated !== transcript.truncated;
  chatMessages = nextMessages;
  chatTruncated = transcript.truncated;
  chatLoading = false;
  chatError = null;
  if (activeView === "chat" && (changed || truncationChanged || wasLoading)) {
    if (chatHistoryOpen && changed) render();
    else refreshChatFeed();
  } else if (activeView === "chat") {
    refreshChatSyncIndicator();
  }
};

const loadChatTranscript = async () => {
  const discussion = chatDiscussion;
  if (!discussion || chatLoadInFlight) return;
  chatLoadInFlight = true;
  if (chatMessages.length === 0) {
    chatLoading = true;
    chatError = null;
  }
  try {
    const transcript = await invoke<DiscussionTranscriptView>("get_discussion_transcript", {
      accountId: discussion.accountId,
      // rolloutId = fichier HEAD : l'historique le plus complet a travers les
      // reprises (cf. collapse_forks cote backend).
      sessionId: discussion.rolloutId || discussion.sessionId,
    });
    applyChatTranscript(discussion, transcript);
  } catch (error) {
    if (chatDiscussion !== discussion) return;
    chatLoading = false;
    const empty = chatMessages.length === 0;
    if (empty) chatError = String(error);
    statusText = `Conversation : ${String(error)}`;
    if (activeView === "chat") {
      if (empty) refreshChatFeed();
      else refreshChatSyncIndicator();
    }
  } finally {
    chatLoadInFlight = false;
  }
};

const stopChatSync = () => {
  chatLiveUnlisten?.();
  chatLiveUnlisten = null;
  if (chatFallbackPoll !== null) {
    clearInterval(chatFallbackPoll);
    chatFallbackPoll = null;
  }
  chatSyncState = "closed";
};

const startChatSync = () => {
  stopChatSync();
  const discussion = chatDiscussion;
  if (!discussion) return;

  if (!isRemoteMode()) {
    chatSyncState = "polling";
    chatFallbackPoll = window.setInterval(
      () => runWhenPageVisible(() => void loadChatTranscript()),
      LOCAL_TRANSCRIPT_POLL_INTERVAL_MS,
    );
    return;
  }

  chatSyncState = "connecting";
  const watchedSessionId = discussion.rolloutId || discussion.sessionId;
  chatLiveUnlisten = subscribeDiscussionUpdates(
    { accountId: discussion.accountId, sessionId: watchedSessionId },
    (message: DiscussionStreamMessage) => {
      if (chatDiscussion !== discussion) return;
      if (
        message.type === "transcript" &&
        message.accountId === discussion.accountId &&
        message.sessionId === watchedSessionId
      ) {
        applyChatTranscript(discussion, message.transcript as DiscussionTranscriptView);
      } else if (message.type === "error") {
        chatLoading = false;
        const empty = chatMessages.length === 0;
        if (empty) chatError = message.message;
        statusText = `Conversation : ${message.message}`;
        if (activeView === "chat") {
          if (empty) refreshChatFeed();
          else refreshChatSyncIndicator();
        }
      }
    },
    (state: RealtimeConnectionState) => {
      if (chatDiscussion !== discussion) return;
      chatSyncState = state;
      if (activeView === "chat") refreshChatSyncIndicator();
    },
  );
  // Si un reverse-proxy refuse les WebSockets, le REST garde la conversation
  // vivante pendant les tentatives de reconnexion.
  chatFallbackPoll = window.setInterval(() => {
    runWhenPageVisible(() => {
      if (chatSyncState !== "live") void loadChatTranscript();
    });
  }, 2000);
};

const openDiscussionChat = async (discussion: DiscussionSummary) => {
  closeMobileOverlays();
  try {
    await restoreDiscussionFolder(discussion);
    openDiscussionInExpert(discussion);
  } catch (error) {
    statusText = `Environnement de la discussion non restaure : ${String(error)}`;
    render();
  }
};

// --- Grille de chats persistants, indépendants et paginés -------------------

const createExpertChatPane = (
  discussion: DiscussionSummary | null = null,
  persisted: Partial<PersistedExpertChatPane> = {},
): ExpertChatPane => {
  const capturedWorkspace = userEnvironmentPath(persisted.pendingWorkspace);
  if (discussion && capturedWorkspace && !discussion.folderPath) {
    discussion.folderPath = capturedWorkspace;
  }

  return {
    key: persisted.key || uid("chat-pane"),
    discussion,
    messages: [],
    loading: !!discussion,
    error: null,
    truncated: false,
    syncState: "closed",
    liveUnlisten: null,
    fallbackPoll: null,
    loadInFlight: false,
    turn: null,
    turnPoll: null,
    turnPollInFlight: false,
    draft: persisted.draft ?? "",
    queuedSubmissions: [],
    queueDrainInFlight: false,
    activeSubmission: null,
    capacityRetryAttempt: 0,
    capacityRetryTimer: null,
    mode:
      persisted.mode === "plan" || persisted.mode === "ask" ? persisted.mode : "build",
    enabledTools: migratePersistedChatAgentTools(persisted),
    accountId:
      discussion?.accountId ??
      persisted.accountId ??
      selectedAccountId ??
      settings?.defaultAccountId ??
      settings?.accounts[0]?.id ??
      null,
    historyOpen: false,
    pendingWorkspace:
      discussionFolderPath(discussion) ?? capturedWorkspace ?? currentWorkspace(),
    autonomousAgentId: persisted.autonomousAgentId ?? null,
    orchestrationId: persisted.orchestrationId ?? null,
    orchestrationRole:
      persisted.orchestrationRole === "orchestrator" || persisted.orchestrationRole === "worker"
        ? persisted.orchestrationRole
        : null,
    orchestrationTaskId: persisted.orchestrationTaskId ?? null,
    followLatest: true,
    scrollTop: 0,
  };
};

const expertChatPaneEnvironmentPath = (pane: ExpertChatPane): string | null =>
  userEnvironmentPath(
    pane.orchestrationId
      ? pane.pendingWorkspace
      : discussionFolderPath(pane.discussion) ?? pane.pendingWorkspace,
  );

const expertChatPanesForCurrentEnvironment = (): ExpertChatPane[] => {
  const environmentPath = userEnvironmentPath(currentWorkspace());
  if (!environmentPath) return [];
  const environmentId = workspaceIdForPath(environmentPath);
  return expertChatPanes.filter((pane) => {
    const panePath = expertChatPaneEnvironmentPath(pane);
    return !!panePath && workspaceIdForPath(panePath) === environmentId;
  });
};

const expertChatPaneIsAvailable = (pane: ExpertChatPane): boolean =>
  !chatTurnIsBusy(pane.turn?.status);

const displayedExpertChatPanesForCurrentEnvironment = (): ExpertChatPane[] =>
  expertChatsForDisplay(
    expertChatPanesForCurrentEnvironment(),
    expertChatDisplayMode,
    expertChatPaneIsAvailable,
  );

const activeExpertChatPane = (): ExpertChatPane | null =>
  expertChatPanesForCurrentEnvironment().find((pane) => pane.key === activeExpertChatKey) ??
  displayedExpertChatPanesForCurrentEnvironment()[0] ??
  expertChatPanesForCurrentEnvironment()[0] ??
  null;

const expertChatPageTotal = (): number =>
  expertChatPageCount(
    displayedExpertChatPanesForCurrentEnvironment().length,
    expertChatPageSizeMode,
  );

const visibleExpertChatPanes = (): ExpertChatPane[] =>
  expertChatsOnPage(
    displayedExpertChatPanesForCurrentEnvironment(),
    expertChatPage,
    expertChatPageSizeMode,
  );

const expertChatStatusText = (): string => {
  const totalCount = expertChatPanesForCurrentEnvironment().length;
  const count = displayedExpertChatPanesForCurrentEnvironment().length;
  const totalPages = expertChatPageTotal();
  if (expertChatDisplayMode === "available") {
    return `${count} chat${count > 1 ? "s" : ""} disponible${count > 1 ? "s" : ""} sur ${totalCount} · page ${expertChatPage + 1}/${totalPages}`;
  }
  return `${count} chat${count > 1 ? "s" : ""} dans cet environnement · page ${expertChatPage + 1}/${totalPages}`;
};

const moveExpertChatPageToPane = (pane: ExpertChatPane | null) => {
  const panes = displayedExpertChatPanesForCurrentEnvironment();
  const index = pane ? panes.indexOf(pane) : -1;
  expertChatPage = index >= 0
    ? expertChatPageForIndex(index, expertChatPageSizeMode)
    : clampExpertChatPage(expertChatPage, panes.length, expertChatPageSizeMode);
};

const reconcileExpertChatPage = () => {
  const panes = displayedExpertChatPanesForCurrentEnvironment();
  const active = panes.find((pane) => pane.key === activeExpertChatKey) ?? panes[0] ?? null;
  if (active) {
    activeExpertChatKey = active.key;
    moveExpertChatPageToPane(active);
    return;
  }
  activeExpertChatKey = null;
  expertChatPage = clampExpertChatPage(
    expertChatPage,
    panes.length,
    expertChatPageSizeMode,
  );
};

const refreshExpertChatDisplayAfterAvailabilityChange = (
  pane: ExpertChatPane,
  wasAvailable: boolean,
): boolean => {
  if (
    activeView !== "chat"
    || expertChatDisplayMode !== "available"
    || wasAvailable === expertChatPaneIsAvailable(pane)
  ) {
    return false;
  }
  reconcileExpertChatPage();
  render();
  startAllExpertChatWork();
  return true;
};

const expertChatPaneRoot = (pane: ExpertChatPane): HTMLElement | null =>
  document.getElementById(`chatPanel-${pane.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`);

const expertChatSelectedAccount = (pane: ExpertChatPane): AccountProfile | null => {
  const preferred = pane.discussion?.accountId ?? pane.accountId ?? settings?.defaultAccountId;
  return accountById(preferred) ?? settings?.accounts[0] ?? null;
};

const orchestrationRunForPane = (pane: ExpertChatPane): OrchestrationSnapshot | null =>
  pane.orchestrationId
    ? orchestrations.find((run) => run.id === pane.orchestrationId) ?? null
    : null;

const orchestrationTaskForPane = (
  pane: ExpertChatPane,
  run = orchestrationRunForPane(pane),
): OrchestrationTask | null =>
  pane.orchestrationRole === "worker" && pane.orchestrationTaskId && run
    ? run.tasks.find((task) => task.id === pane.orchestrationTaskId) ?? null
    : null;

const expertChatResumeSessionId = (pane: ExpertChatPane): string | null =>
  pane.discussion?.rolloutId?.trim()
  || pane.turn?.sessionId?.trim()
  || pane.discussion?.sessionId?.trim()
  || null;

const autonomousAgentForPane = (pane: ExpertChatPane): AutonomousAgentSnapshot | null =>
  pane.autonomousAgentId
    ? autonomousAgents.find((agent) => agent.id === pane.autonomousAgentId) ?? null
    : null;

const expertChatAutonomousOption = (
  pane: ExpertChatPane,
): NonNullable<Parameters<typeof renderChatPanel>[1]>["autonomous"] => {
  if (pane.orchestrationRole) return undefined;
  const agent = autonomousAgentForPane(pane);
  if (agent) {
    return {
      role: "linked",
      label: autonomousStatusLabel(agent.status),
      detail: `${agent.name || "Agent autonome"} · ${autonomousStatusLabel(agent.status)}. Modifier depuis ce chat.`,
      tone: autonomousStatusTone(agent.status) as "active" | "paused" | "completed" | "warning",
    };
  }
  if (pane.autonomousAgentId && !autonomousAgentsLoaded) {
    return {
      role: "linked",
      label: "Autonome",
      detail: "Chargement de l'agent autonome lié à ce chat.",
      tone: "paused",
      disabled: true,
    };
  }

  const busy =
    chatTurnIsBusy(pane.turn?.status)
    || (pane.discussion ? discussionHasRunningTurn(pane.discussion) : false)
    || pane.queueDrainInFlight
    || pane.queuedSubmissions.length > 0;
  return {
    role: "available",
    label: "Autonomiser",
    detail: busy
      ? "Attendez la fin du tour et de la file avant de créer l'agent autonome."
      : "Créer un agent autonome à partir de ce chat sans fermer la conversation.",
    tone: "paused",
    disabled: busy,
  };
};

const expertChatOrchestrationOption = (
  pane: ExpertChatPane,
): NonNullable<Parameters<typeof renderChatPanel>[1]>["orchestration"] => {
  if (autonomousAgentForPane(pane) || (pane.autonomousAgentId && !autonomousAgentsLoaded)) {
    return undefined;
  }
  const run = orchestrationRunForPane(pane);
  if (pane.orchestrationRole === "orchestrator") {
    return {
      role: "orchestrator",
      label: "Orchestrateur",
      detail: run
        ? `${run.name} · ${orchestrationPhaseLabel(run.phase)}. Ouvrir le suivi.`
        : "Chat orchestrateur · ouvrir le suivi.",
    };
  }
  if (pane.orchestrationRole === "worker") {
    const task = orchestrationTaskForPane(pane, run);
    return {
      role: "worker",
      label: task ? `Worker ${task.position}` : "Worker",
      detail: task
        ? `${task.title} · ${orchestrationTaskStatusLabel(task.status)}. Ouvrir le suivi.`
        : "Chat worker · ouvrir le suivi.",
    };
  }

  const sessionId = expertChatResumeSessionId(pane);
  const busy =
    chatTurnIsBusy(pane.turn?.status)
    || (pane.discussion ? discussionHasRunningTurn(pane.discussion) : false)
    || pane.queueDrainInFlight
    || pane.queuedSubmissions.length > 0;
  return {
    role: "available",
    label: "Orchestrer",
    detail: !sessionId
      ? "Envoyez un premier message avant de transformer ce chat en orchestration."
      : busy
        ? "Attendez la fin du tour et de la file d’attente avant de lancer l’orchestration."
        : "Transformer ce chat en orchestration et ouvrir des fenêtres workers.",
    disabled: !sessionId || busy || orchestrationConversion?.busy === true,
  };
};

const expertChatPanelModel = (pane: ExpertChatPane): ChatPanelModel => {
  const discussion = pane.discussion;
  const run = orchestrationRunForPane(pane);
  const task = orchestrationTaskForPane(pane, run);
  const managedByOrchestration = !!pane.orchestrationRole;
  const account = expertChatSelectedAccount(pane);
  const provider = accountProvider(account);
  const selectedModel = accountModel(account);
  const catalog = account ? chatModelCatalogs.get(account.id) : undefined;
  const workspace =
    discussionFolderPath(discussion) ?? pane.pendingWorkspace ?? currentWorkspace() ?? account?.projectDir ?? null;
  const metaParts = managedByOrchestration
    ? [
        pane.orchestrationRole === "orchestrator" ? "Orchestrateur" : `Worker ${task?.position ?? ""}`.trim(),
        task ? orchestrationTaskStatusLabel(task.status) : run ? orchestrationPhaseLabel(run.phase) : "Orchestration",
        workspace ? displayProjectDir(workspace) : "",
      ].filter(Boolean)
    : discussion
    ? [
        discussion.accountLabel,
        workspace ? displayProjectDir(workspace) : "",
        `${pane.messages.length || discussion.messageCount} message(s)`,
      ].filter(Boolean)
    : [account?.label ?? "Choisissez un compte", workspace ? displayProjectDir(workspace) : "Environnement a choisir"];
  return {
    title:
      pane.orchestrationRole === "orchestrator"
        ? run?.name || discussion?.title?.trim() || "Orchestrateur"
        : pane.orchestrationRole === "worker"
          ? task?.title || "Worker en préparation"
          : discussion?.title?.trim() || "Nouvelle conversation",
    subtitle: metaParts.join(" \u00b7 "),
    accountLabel: account?.label ?? discussion?.accountLabel ?? "Aucun compte",
    providerLabel: providerLabel(provider),
    loading: pane.loading || (managedByOrchestration && !discussion),
    error: pane.error,
    truncated: pane.truncated,
    syncState: discussion ? pane.syncState : "closed",
    messages: pane.messages,
    activities: pane.turn?.activities ?? [],
    thoughts: pane.turn?.thoughts ?? [],
    parts: pane.turn?.parts ?? [],
    turnStatus: pane.turn?.status ?? "idle",
    turnStartedAt: pane.turn?.startedAt ?? null,
    turnFinishedAt: pane.turn?.finishedAt ?? null,
    turnError: modelCapacityTurnError(
      pane.turn,
      pane.activeSubmission,
      pane.capacityRetryAttempt,
      pane.capacityRetryTimer !== null,
    ),
    waitingForUser: conversationWaitsForUser(pane.messages, pane.turn?.parts ?? []),
    quotaStatus: chatQuotaStatusFor(account),
    quotaSuggestion: managedByOrchestration ? null : quotaSuggestionFor(pane.turn, discussion),
    accounts: (settings?.accounts ?? []).map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      providerLabel: providerLabel(accountProvider(candidate)),
      model: accountModel(candidate),
    })),
    selectedAccountId: account?.id ?? "",
    selectedModel,
    modelSuggestions:
      provider === "claude"
        ? CLAUDE_MODEL_SUGGESTIONS
        : catalog?.map((model) => model.id) ?? CODEX_MODEL_SUGGESTIONS,
    selectedReasoningEffort: reasoningEffortForChatModel(
      account,
      selectedModel,
      accountReasoningEffort(account),
    ),
    reasoningEffortOptions: chatReasoningEffortOptions(account, selectedModel),
    supportsReasoningEffort: provider === "codex",
    supportsGoals: provider === "codex",
    agentTools: chatAgentToolDefinitions(),
    enabledTools: pane.enabledTools,
    mode: pane.mode,
    draft: pane.draft,
    queuedCount: pane.queuedSubmissions.length,
    newConversation: !discussion && !managedByOrchestration,
    workspaceLabel: workspace ? displayProjectDir(workspace) : "Environnement",
    historyOpen: pane.historyOpen,
  };
};

const expertChatSidebarStatus = (
  pane: ExpertChatPane | null,
  discussion: DiscussionSummary | null = pane?.discussion ?? null,
) => {
  const serverTurn = activeChatTurnForDiscussion(activeChatTurns, discussion);
  const localTurn = pane?.turn;
  const turn = chatTurnIsBusy(localTurn?.status)
    ? localTurn
    : serverTurn && serverTurn.id !== localTurn?.id
      ? serverTurn
      : localTurn ?? serverTurn;
  const localWaitsForUser = conversationWaitsForUser(
    pane?.messages ?? [],
    localTurn?.parts ?? [],
  );
  const serverWaitsForUser = !!serverTurn &&
    (!localTurn || serverTurn.id !== localTurn.id || chatTurnIsBusy(localTurn.status)) &&
    serverTurn.waitingForUser;
  return chatSidebarStatus(
    turn?.status,
    localWaitsForUser || serverWaitsForUser,
  );
};

const renderChatSidebarStatus = (
  pane: ExpertChatPane | null,
  discussion: DiscussionSummary | null = pane?.discussion ?? null,
): string => {
  const status = expertChatSidebarStatus(pane, discussion);
  const label = chatSidebarStatusLabel(status);
  const paneAttribute = pane
    ? ` data-chat-status-pane="${escapeAttr(pane.key)}"`
    : "";
  return `<span class="chat-side-status chat-side-status--${status}"${paneAttribute} role="img" title="${escapeAttr(label)}" aria-label="Statut : ${escapeAttr(label)}"></span>`;
};

const refreshExpertChatSidebarStatus = (pane: ExpertChatPane) => {
  const status = expertChatSidebarStatus(pane);
  const label = chatSidebarStatusLabel(status);
  const indicator = [...document.querySelectorAll<HTMLElement>("[data-chat-status-pane]")]
    .find((candidate) => candidate.dataset.chatStatusPane === pane.key);
  if (!indicator) return;
  indicator.classList.remove(
    "chat-side-status--idle",
    "chat-side-status--running",
    "chat-side-status--question",
  );
  indicator.classList.add(`chat-side-status--${status}`);
  indicator.title = label;
  indicator.setAttribute("aria-label", `Statut : ${label}`);
};

const persistExpertChats = () => {
  // Ne pas ecraser l'etat local par une liste vide avant sa restauration.
  if (!expertChatsRestored && expertChatPanes.length === 0) return;
  const state: PersistedExpertChats = {
    v: 1,
    activeKey: activeExpertChatKey,
    panes: expertChatPanes.map((pane) => ({
      key: pane.key,
      sessionId: pane.discussion?.sessionId ?? null,
      accountId: pane.accountId,
      draft: pane.draft,
      mode: pane.mode,
      enabledTools: pane.enabledTools,
      pendingWorkspace: pane.pendingWorkspace,
      autonomousAgentId: pane.autonomousAgentId,
      orchestrationId: pane.orchestrationId,
      orchestrationRole: pane.orchestrationRole,
      orchestrationTaskId: pane.orchestrationTaskId,
    })),
  };
  localStorage.setItem(EXPERT_OPEN_CHATS_STORAGE_KEY, JSON.stringify(state));
};

const restoreExpertChats = () => {
  if (expertChatsRestored) return;
  expertChatsRestored = true;
  let persisted: PersistedExpertChats | null = null;
  try {
    const parsed = JSON.parse(localStorage.getItem(EXPERT_OPEN_CHATS_STORAGE_KEY) ?? "null") as Partial<PersistedExpertChats> | null;
    if (parsed?.v === 1 && Array.isArray(parsed.panes)) {
      persisted = parsed as PersistedExpertChats;
    }
  } catch {
    localStorage.removeItem(EXPERT_OPEN_CHATS_STORAGE_KEY);
  }

  expertChatPanes = (persisted?.panes ?? [])
    .flatMap((record) => {
      if (!record || typeof record.key !== "string") return [];
      const discussion = record.sessionId ? findDiscussion(record.sessionId) : null;
      if (
        record.sessionId
        && !discussion
        && !record.orchestrationId
        && !record.autonomousAgentId
      ) return [];
      return [createExpertChatPane(discussion, record)];
    });
  activeExpertChatKey =
    (persisted?.activeKey && expertChatPanes.some((pane) => pane.key === persisted.activeKey)
      ? persisted.activeKey
      : expertChatPanes[0]?.key) ?? null;
  reconcileExpertChatPage();
  persistExpertChats();
};

const captureExpertChatScroll = (pane: ExpertChatPane, root = expertChatPaneRoot(pane)) => {
  const feed = root?.querySelector<HTMLElement>("[data-chat-control='feed']");
  if (!feed) return;
  rememberChatFeedScroll(feed, pane);
};

const restoreExpertChatScroll = (pane: ExpertChatPane, root = expertChatPaneRoot(pane)) => {
  const feed = root?.querySelector<HTMLElement>("[data-chat-control='feed']");
  if (!feed) return;
  restoreChatFeedScroll(feed, pane);
};

const captureAllExpertChatScroll = () => expertChatPanes.forEach((pane) => captureExpertChatScroll(pane));

const renderExpertChatPane = (pane: ExpertChatPane): string =>
  renderChatPanel(expertChatPanelModel(pane), {
    instanceId: pane.key,
    paneIndex: expertChatPanes.indexOf(pane) + 1,
    active: pane.key === activeExpertChatKey,
    compact: true,
    fullscreen: pane.key === expertChatFullscreenKey,
    autonomous: expertChatAutonomousOption(pane),
    orchestration: expertChatOrchestrationOption(pane),
    accountTransition: expertChatAccountTransitions.get(pane.key),
  });

const refreshExpertChatSyncIndicator = (pane: ExpertChatPane) => {
  const indicator = expertChatPaneRoot(pane)?.querySelector<HTMLElement>("[data-chat-control='sync']");
  if (!indicator) return;
  indicator.className = `chat-sync chat-sync--${pane.syncState}`;
  const label = indicator.querySelector<HTMLElement>("[data-chat-sync-label]");
  if (label) label.textContent = chatSyncLabel(pane.syncState);
};

const refreshExpertChatFeed = (pane: ExpertChatPane) => {
  refreshExpertChatSidebarStatus(pane);
  const root = expertChatPaneRoot(pane);
  const feed = root?.querySelector<HTMLElement>("[data-chat-control='feed']");
  if (!root || !feed) return;
  const model = expertChatPanelModel(pane);
  const feedSignature = chatFeedRenderSignature(model);
  const feedChanged = chatFeedSignatures.get(feed) !== feedSignature;
  if (feedChanged) {
    pane.scrollTop = feed.scrollTop;
    feed.innerHTML = renderChatFeedInner(model, pane.key);
    chatFeedSignatures.set(feed, feedSignature);
  }
  const runtimeChanged = patchChatRuntimeStatus(root, model);
  const subtitle = root.querySelector<HTMLElement>("[data-chat-control='subtitle']");
  if (subtitle) subtitle.textContent = model.subtitle;
  const historyCount = root.querySelector<HTMLElement>("[data-chat-action='history-toggle'] small");
  if (historyCount) {
    historyCount.textContent = String(pane.messages.filter((message) => message.role === "user").length);
  }
  refreshExpertChatSyncIndicator(pane);
  if (feedChanged || runtimeChanged) renderIcons(root);
  if (feedChanged) restoreExpertChatScroll(pane, root);
};

const refreshExpertChatPane = (pane: ExpertChatPane) => {
  refreshExpertChatSidebarStatus(pane);
  const root = expertChatPaneRoot(pane);
  if (!root) return;
  const prompt = root.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']");
  const promptHadFocus = document.activeElement === prompt;
  const selectionStart = prompt?.selectionStart ?? pane.draft.length;
  const selectionEnd = prompt?.selectionEnd ?? selectionStart;
  captureExpertChatScroll(pane, root);
  root.outerHTML = renderExpertChatPane(pane);
  const nextRoot = expertChatPaneRoot(pane);
  if (nextRoot) renderIcons(nextRoot);
  if (nextRoot) bindExpertChatPaneUi(pane, nextRoot);
  if (promptHadFocus) {
    const nextPrompt = nextRoot?.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']");
    nextPrompt?.focus();
    nextPrompt?.setSelectionRange(
      Math.min(selectionStart, nextPrompt.value.length),
      Math.min(selectionEnd, nextPrompt.value.length),
    );
  }
  restoreExpertChatScroll(pane, nextRoot);
};

const stopExpertChatTurnPoll = (pane: ExpertChatPane) => {
  if (pane.turnPoll !== null) {
    clearInterval(pane.turnPoll);
    pane.turnPoll = null;
  }
  pane.turnPollInFlight = false;
};

const stopExpertChatSync = (pane: ExpertChatPane) => {
  pane.liveUnlisten?.();
  pane.liveUnlisten = null;
  if (pane.fallbackPoll !== null) {
    clearInterval(pane.fallbackPoll);
    pane.fallbackPoll = null;
  }
  pane.syncState = "closed";
};

const stopAllExpertChatWork = () => {
  expertChatPanes.forEach((pane) => {
    stopExpertChatSync(pane);
    if (
      pane.queuedSubmissions.length > 0 &&
      pane.turn &&
      chatTurnIsBusy(pane.turn.status) &&
      pane.turn.id !== 0
    ) {
      if (pane.turnPoll === null) startExpertChatTurnPoll(pane);
    } else {
      stopExpertChatTurnPoll(pane);
    }
  });
};

const applyExpertChatTranscript = (
  pane: ExpertChatPane,
  discussion: DiscussionSummary,
  transcript: DiscussionTranscriptView,
) => {
  if (!expertChatPanes.includes(pane) || pane.discussion !== discussion) return;
  const wasLoading = pane.loading;
  const nextMessages = reconcileChatMessages(
    pane.messages,
    transcript.messages,
    true,
  );
  const changed = !chatMessagesEqual(pane.messages, nextMessages);
  const truncationChanged = pane.truncated !== transcript.truncated;
  pane.messages = nextMessages;
  pane.truncated = transcript.truncated;
  pane.loading = false;
  pane.error = null;
  if (activeView === "chat" && (changed || truncationChanged || wasLoading)) {
    if (pane.historyOpen && changed) refreshExpertChatPane(pane);
    else refreshExpertChatFeed(pane);
  } else if (activeView === "chat") {
    refreshExpertChatSyncIndicator(pane);
  }
};

const loadExpertChatTranscript = async (pane: ExpertChatPane) => {
  const discussion = pane.discussion;
  if (!discussion || pane.loadInFlight || !expertChatPanes.includes(pane)) return;
  pane.loadInFlight = true;
  if (pane.messages.length === 0) {
    pane.loading = true;
    pane.error = null;
  }
  try {
    const transcript = await invoke<DiscussionTranscriptView>("get_discussion_transcript", {
      accountId: discussion.accountId,
      sessionId: discussion.rolloutId || discussion.sessionId,
    });
    applyExpertChatTranscript(pane, discussion, transcript);
  } catch (error) {
    if (!expertChatPanes.includes(pane) || pane.discussion !== discussion) return;
    pane.loading = false;
    if (pane.messages.length === 0) pane.error = String(error);
    statusText = `Conversation : ${String(error)}`;
    if (activeView === "chat") refreshExpertChatPane(pane);
  } finally {
    pane.loadInFlight = false;
  }
};

const startExpertChatSync = (pane: ExpertChatPane) => {
  stopExpertChatSync(pane);
  const discussion = pane.discussion;
  if (!discussion) return;

  if (!isRemoteMode()) {
    pane.syncState = "polling";
    pane.fallbackPoll = window.setInterval(
      () => runWhenPageVisible(() => void loadExpertChatTranscript(pane)),
      LOCAL_TRANSCRIPT_POLL_INTERVAL_MS,
    );
    return;
  }

  pane.syncState = "connecting";
  const watchedSessionId = discussion.rolloutId || discussion.sessionId;
  pane.liveUnlisten = subscribeDiscussionUpdates(
    { accountId: discussion.accountId, sessionId: watchedSessionId },
    (message: DiscussionStreamMessage) => {
      if (!expertChatPanes.includes(pane) || pane.discussion !== discussion) return;
      if (
        message.type === "transcript" &&
        message.accountId === discussion.accountId &&
        message.sessionId === watchedSessionId
      ) {
        applyExpertChatTranscript(pane, discussion, message.transcript as DiscussionTranscriptView);
      } else if (message.type === "error") {
        pane.loading = false;
        if (pane.messages.length === 0) pane.error = message.message;
        statusText = `Conversation : ${message.message}`;
        if (activeView === "chat") refreshExpertChatPane(pane);
      }
    },
    (state: RealtimeConnectionState) => {
      if (!expertChatPanes.includes(pane) || pane.discussion !== discussion) return;
      pane.syncState = state;
      if (activeView === "chat") refreshExpertChatSyncIndicator(pane);
    },
  );
  pane.fallbackPoll = window.setInterval(() => {
    runWhenPageVisible(() => {
      if (pane.syncState !== "live") void loadExpertChatTranscript(pane);
    });
  }, 2000);
};

const attachCreatedExpertChat = async (
  pane: ExpertChatPane,
  sessionId: string,
): Promise<boolean> => {
  if (pane.discussion) return true;
  let discussion = findDiscussionByRollout(sessionId);
  if (!discussion) {
    await refreshDiscussions();
    discussion = findDiscussionByRollout(sessionId);
  }
  if (!discussion || !expertChatPanes.includes(pane)) return false;
  const capturedWorkspace = userEnvironmentPath(pane.pendingWorkspace);
  if (capturedWorkspace) {
    // Conserver l'environnement capture a la creation empeche le panneau de
    // disparaitre de la grille avant la persistance du cwd dans le JSONL.
    discussion.folderPath = capturedWorkspace;
    pane.pendingWorkspace = capturedWorkspace;
  }
  pane.discussion = discussion;
  pane.accountId = discussion.accountId;
  pane.loading = false;
  pane.error = null;
  void loadChatModelCatalog(pane.accountId);
  startExpertChatSync(pane);
  persistExpertChats();
  void loadExpertChatTranscript(pane);
  return true;
};

const applyExpertChatTurnSnapshot = async (
  pane: ExpertChatPane,
  snapshot: ChatTurnSnapshot,
) => {
  if (!expertChatPanes.includes(pane)) return;
  if (pane.turn && pane.turn.id !== 0 && snapshot.id !== pane.turn.id) return;
  const wasAvailable = expertChatPaneIsAvailable(pane);
  const previousStatus = pane.turn?.status;
  const previousStartedAt = pane.turn?.startedAt;
  const previousTurnId = pane.turn?.id;
  if (
    previousStartedAt != null &&
    (previousTurnId === 0 || previousTurnId === snapshot.id)
  ) {
    snapshot = { ...snapshot, startedAt: Math.min(previousStartedAt, snapshot.startedAt) };
  }
  pane.turn = snapshot;
  const quotaExhausted =
    snapshot.status === "failed" &&
    isQuotaExhaustionError(snapshot.error);
  const modelCapacityReached =
    snapshot.status === "failed" &&
    isModelCapacityError(snapshot.error);
  const attached = snapshot.sessionId
    ? await attachCreatedExpertChat(pane, snapshot.sessionId)
    : !!pane.discussion;

  if (snapshot.status === "finalizing") {
    statusText = "Reponse terminee, synchronisation…";
  } else if (snapshot.status === "completed") {
    statusText = "Reponse terminee";
    if (attached) await loadExpertChatTranscript(pane);
    stopExpertChatTurnPoll(pane);
  } else if (snapshot.status === "failed") {
    pane.messages = markLatestPendingMessageFailed(pane.messages);
    statusText = snapshot.error || "La reponse a echoue";
    stopExpertChatTurnPoll(pane);
  } else if (snapshot.status === "cancelled") {
    statusText = "Reponse arretee";
    stopExpertChatTurnPoll(pane);
  } else {
    statusText = `${expertChatPanelModel(pane).providerLabel} travaille…`;
  }

  if (modelCapacityReached) {
    scheduleExpertModelCapacityRetry(pane, snapshot);
  } else if (!chatTurnIsBusy(snapshot.status)) {
    resetExpertModelCapacityRetry(pane);
  }

  if (
    !quotaExhausted &&
    chatTurnIsBusy(previousStatus) &&
    !chatTurnIsBusy(snapshot.status)
  ) {
    void refreshLimitStatus(true);
  }
  if (chatBecameAvailable(previousStatus, snapshot.status)) {
    void playChatReadySound(chatReadySoundPreferences);
  }
  if (activeView === "chat") {
    const displayChanged = refreshExpertChatDisplayAfterAvailabilityChange(
      pane,
      wasAvailable,
    );
    if (!displayChanged) {
      if (previousStatus !== snapshot.status) refreshExpertChatPane(pane);
      else refreshExpertChatFeed(pane);
    }
  }
  if (quotaExhausted && !pane.orchestrationId) {
    if (pane.discussion) {
      automaticallyTransferQuotaExhaustedDiscussion(pane.discussion, snapshot, pane);
    } else {
      void refreshQuotaAlternatives();
    }
  } else if (modelCapacityReached) {
    // Les messages suivants restent en file jusqu'a la reprise du meme modele.
  } else if (!chatTurnIsBusy(snapshot.status)) {
    void drainExpertChatSubmissionQueue(pane);
  }
};

const pollExpertChatTurn = async (pane: ExpertChatPane) => {
  if (!pane.turn || pane.turn.id === 0 || pane.turnPollInFlight || !expertChatPanes.includes(pane)) return;
  pane.turnPollInFlight = true;
  try {
    const snapshot = await invoke<ChatTurnSnapshot>("chat_turn_status", { id: pane.turn.id });
    await applyExpertChatTurnSnapshot(pane, snapshot);
  } catch (error) {
    statusText = `Suivi de la reponse : ${String(error)}`;
  } finally {
    pane.turnPollInFlight = false;
  }
};

const startExpertChatTurnPoll = (pane: ExpertChatPane) => {
  stopExpertChatTurnPoll(pane);
  pane.turnPoll = window.setInterval(
    () => {
      if (pane.queuedSubmissions.length > 0) void pollExpertChatTurn(pane);
      else runWhenPageVisible(() => void pollExpertChatTurn(pane));
    },
    550,
  );
};

const focusExpertChatPrompt = (pane: ExpertChatPane) => {
  window.requestAnimationFrame(() => {
    const input = expertChatPaneRoot(pane)
      ?.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']");
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  });
};

const sendExpertChatMessage = async (
  pane: ExpertChatPane,
  root: HTMLElement | null,
  promptOverride?: string,
  intent: ChatSubmitIntent = "message",
  queuedSubmission: QueuedChatSubmission | null = null,
): Promise<boolean> => {
  const input = queuedSubmission
    ? null
    : root?.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']") ?? null;
  const prompt = queuedSubmission?.prompt ?? chatSubmissionPrompt(
    promptOverride === undefined ? input : null,
    promptOverride ?? pane.draft,
    intent,
  );
  const account = queuedSubmission
    ? accountById(queuedSubmission.accountId)
    : expertChatSelectedAccount(pane);
  if (!prompt || !account) {
    statusText = account
      ? intent === "goal" ? "Décrivez le goal" : "Ecrivez un message"
      : "Ajoutez d'abord un compte agent";
    return false;
  }
  if (intent === "goal" && accountProvider(account) !== "codex") {
    statusText = "Les goals sont disponibles avec Codex";
    return false;
  }
  const preferences = queuedSubmission
    ? {
        model: queuedSubmission.model,
        reasoningEffort: queuedSubmission.reasoningEffort,
        changed: false,
        error: null,
      }
    : readChatPreferences(account, root ?? document);
  if (preferences.error) {
    const modelInput = root?.querySelector<HTMLInputElement>("[data-chat-control='model']");
    modelInput?.setCustomValidity(preferences.error);
    modelInput?.reportValidity();
    statusText = preferences.error;
    return false;
  }
  if (preferences.changed) persistChatPreferences(account.id);

  const submission = queuedSubmission ?? {
    prompt,
    accountId: account.id,
    mode: pane.mode,
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
    enabledTools: [...pane.enabledTools],
    agentSkills: chatAgentSkillPrompts(pane.enabledTools),
  };
  if (
    chatTurnIsBusy(pane.turn?.status) ||
    (!queuedSubmission && pane.queuedSubmissions.length > 0)
  ) {
    if (queuedSubmission) pane.queuedSubmissions.unshift(submission);
    else pane.queuedSubmissions.push(submission);
    if (!queuedSubmission) pane.draft = "";
    statusText = chatTurnIsBusy(pane.turn?.status)
      ? `Message mis en attente · ${pane.queuedSubmissions.length} dans la file`
      : "Envoi du prochain message en attente";
    persistExpertChats();
    refreshExpertChatPane(pane);
    if (!queuedSubmission) focusExpertChatPrompt(pane);
    if (!chatTurnIsBusy(pane.turn?.status)) {
      void drainExpertChatSubmissionQueue(pane);
    }
    return true;
  }

  const wasAvailable = expertChatPaneIsAvailable(pane);
  if (!submission.automaticCapacityRetry) resetExpertModelCapacityRetry(pane);
  pane.activeSubmission = submission;
  const resumeSessionId =
    submission.resumeSessionId ??
    pane.discussion?.rolloutId ??
    pane.discussion?.sessionId ??
    null;
  if (!queuedSubmission) pane.draft = "";
  pane.error = null;
  pane.messages = [
    ...pane.messages,
    {
      role: "user",
      text: prompt,
      timestamp: Math.floor(Date.now() / 1000),
      deliveryState: "pending",
    },
  ];
  pane.turn = {
    id: 0,
    accountId: account.id,
    sessionId: resumeSessionId,
    status: "running",
    startedAt: Math.floor(Date.now() / 1000),
    finishedAt: null,
    error: null,
    activities: [
      {
        id: "preparing",
        kind: "think",
        label: `${providerLabel(accountProvider(account))} prepare la reponse`,
        detail: null,
        status: "running",
      },
    ],
    thoughts: [
      {
        id: "preparing-thought",
        kind: "reasoning",
        text: `${providerLabel(accountProvider(account))} analyse la demande et prépare la prochaine étape.`,
        status: "running",
      },
    ],
    parts: [],
  };
  pane.followLatest = true;
  pane.scrollTop = 0;
  statusText = `${providerLabel(accountProvider(account))} travaille…`;
  persistExpertChats();
  const displayChanged = refreshExpertChatDisplayAfterAvailabilityChange(
    pane,
    wasAvailable,
  );
  if (!displayChanged) refreshExpertChatPane(pane);
  if (!queuedSubmission && !displayChanged) focusExpertChatPrompt(pane);

  try {
    const snapshot = await invoke<ChatTurnSnapshot>("start_chat_turn", {
      accountId: account.id,
      sessionId: resumeSessionId,
      prompt,
      projectDir:
        discussionFolderPath(pane.discussion) ?? pane.pendingWorkspace ?? currentWorkspace() ?? account.projectDir ?? null,
      mode: submission.mode,
      model: preferences.model,
      reasoningEffort: preferences.reasoningEffort,
      sourceChatKey: pane.key,
      agentTools: submission.enabledTools.filter(isChatAgentModeId),
      agentSkills: submission.agentSkills,
    });
    if (!expertChatPanes.includes(pane)) return false;
    const wasAvailableBeforeSnapshot = expertChatPaneIsAvailable(pane);
    const optimisticStartedAt = pane.turn?.startedAt;
    pane.turn = optimisticStartedAt == null
      ? snapshot
      : { ...snapshot, startedAt: Math.min(optimisticStartedAt, snapshot.startedAt) };
    startExpertChatTurnPoll(pane);
    await applyExpertChatTurnSnapshot(pane, pane.turn);
    refreshExpertChatDisplayAfterAvailabilityChange(
      pane,
      wasAvailableBeforeSnapshot,
    );
    return snapshot.status !== "failed" && snapshot.status !== "cancelled";
  } catch (error) {
    if (!expertChatPanes.includes(pane)) return false;
    const wasAvailableBeforeFailure = expertChatPaneIsAvailable(pane);
    pane.messages = markLatestPendingMessageFailed(pane.messages);
    const failedTurn = {
      ...pane.turn,
      id: 0,
      status: "failed",
      finishedAt: Math.floor(Date.now() / 1000),
      error: String(error),
    } as ChatTurnSnapshot;
    pane.turn = failedTurn;
    statusText = String(error);
    const modelCapacityReached = isModelCapacityError(String(error));
    if (modelCapacityReached) {
      scheduleExpertModelCapacityRetry(pane, failedTurn);
    } else {
      resetExpertModelCapacityRetry(pane);
    }
    if (isQuotaExhaustionError(String(error))) {
      if (pane.discussion) {
        automaticallyTransferQuotaExhaustedDiscussion(pane.discussion, failedTurn, pane);
      } else {
        void refreshQuotaAlternatives();
      }
    } else if (!modelCapacityReached) {
      void drainExpertChatSubmissionQueue(pane);
    }
    if (!refreshExpertChatDisplayAfterAvailabilityChange(pane, wasAvailableBeforeFailure)) {
      refreshExpertChatPane(pane);
    }
    return false;
  }
};

const drainExpertChatSubmissionQueue = async (pane: ExpertChatPane): Promise<void> => {
  if (
    !expertChatPanes.includes(pane) ||
    pane.queueDrainInFlight ||
    chatTurnIsBusy(pane.turn?.status) ||
    pane.queuedSubmissions.length === 0
  ) {
    return;
  }
  const submission = pane.queuedSubmissions.shift();
  if (!submission) return;
  pane.queueDrainInFlight = true;
  try {
    await sendExpertChatMessage(
      pane,
      expertChatPaneRoot(pane),
      undefined,
      "message",
      submission,
    );
  } finally {
    pane.queueDrainInFlight = false;
    if (
      expertChatPanes.includes(pane) &&
      !chatTurnIsBusy(pane.turn?.status) &&
      !isQuotaExhaustionError(pane.turn?.error) &&
      !isModelCapacityError(pane.turn?.error) &&
      pane.queuedSubmissions.length > 0
    ) {
      void drainExpertChatSubmissionQueue(pane);
    }
  }
};

const stopExpertChatTurn = async (pane: ExpertChatPane) => {
  if (!pane.turn || pane.turn.status !== "running") return;
  if (pane.turn.id === 0) {
    const wasAvailable = expertChatPaneIsAvailable(pane);
    pane.turn = { ...pane.turn, status: "cancelled" };
    stopExpertChatTurnPoll(pane);
    const displayChanged = refreshExpertChatDisplayAfterAvailabilityChange(
      pane,
      wasAvailable,
    );
    if (!displayChanged) {
      refreshExpertChatPane(pane);
      focusExpertChatPrompt(pane);
    }
    void drainExpertChatSubmissionQueue(pane);
    return;
  }
  try {
    await applyExpertChatTurnSnapshot(
      pane,
      await invoke<ChatTurnSnapshot>("stop_chat_turn", { id: pane.turn.id }),
    );
  } catch (error) {
    statusText = String(error);
  }
};

const startAllExpertChatWork = () => {
  const visiblePanes = new Set(visibleExpertChatPanes());
  const currentEnvironmentPanes = new Set(expertChatPanesForCurrentEnvironment());
  expertChatPanes.forEach((pane) => {
    if (visiblePanes.has(pane) && pane.discussion) {
      startExpertChatSync(pane);
      void loadExpertChatTranscript(pane);
    } else {
      stopExpertChatSync(pane);
    }
    if (
      (
        visiblePanes.has(pane)
        || pane.queuedSubmissions.length > 0
        || (
          expertChatDisplayMode === "available"
          && currentEnvironmentPanes.has(pane)
        )
      )
      && pane.turn
      && chatTurnIsBusy(pane.turn.status)
      && pane.turn.id !== 0
    ) {
      startExpertChatTurnPoll(pane);
    } else {
      stopExpertChatTurnPoll(pane);
    }
  });
};

const activateExpertChatPane = (pane: ExpertChatPane, focusPrompt = false) => {
  if (!expertChatPanes.includes(pane)) return;
  activeExpertChatKey = pane.key;
  moveExpertChatPageToPane(pane);
  document.querySelectorAll<HTMLElement>("[data-chat-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.chatPanel === pane.key);
  });
  persistExpertChats();
  if (focusPrompt) {
    expertChatPaneRoot(pane)
      ?.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']")
      ?.focus();
  }
};

const setExpertChatPage = (requestedPage: number) => {
  captureAllExpertChatScroll();
  const environmentPanes = displayedExpertChatPanesForCurrentEnvironment();
  expertChatPage = clampExpertChatPage(
    requestedPage,
    environmentPanes.length,
    expertChatPageSizeMode,
  );
  const panes = visibleExpertChatPanes();
  if (!panes.some((pane) => pane.key === activeExpertChatKey)) {
    activeExpertChatKey = panes[0]?.key ?? null;
  }
  statusText = expertChatStatusText();
  persistExpertChats();
  render();
  startAllExpertChatWork();
};

const addExpertChatPane = (
  accountId: string | null = null,
  options: { mode?: ChatMode; pendingWorkspace?: string | null } = {},
) => {
  const environmentPath = userEnvironmentPath(options.pendingWorkspace ?? currentWorkspace());
  if (!environmentPath) {
    openTerminalEnvironmentMenu();
    return null;
  }
  const pane = createExpertChatPane(null, {
    accountId: accountId ?? selectedAccountId ?? settings?.defaultAccountId ?? null,
    pendingWorkspace: environmentPath,
    mode: options.mode,
  });
  expertChatPanes.push(pane);
  activeExpertChatKey = pane.key;
  moveExpertChatPageToPane(pane);
  activeView = "chat";
  statusText = expertChatStatusText();
  persistExpertChats();
  render();
  startAllExpertChatWork();
  window.setTimeout(() => activateExpertChatPane(pane, true), 0);
  return pane;
};

const openDiscussionInExpert = (discussion: DiscussionSummary): ExpertChatPane => {
  const existing = expertChatPanes.find(
    (pane) => pane.discussion?.sessionId === discussion.sessionId,
  );
  if (existing) {
    activeView = "chat";
    activateExpertChatPane(existing);
    statusText = expertChatStatusText();
    render();
    startAllExpertChatWork();
    return existing;
  }
  const pane = createExpertChatPane(discussion);
  expertChatPanes.push(pane);
  activeExpertChatKey = pane.key;
  moveExpertChatPageToPane(pane);
  activeView = "chat";
  statusText = expertChatStatusText();
  void loadChatModelCatalog(pane.accountId);
  persistExpertChats();
  render();
  startAllExpertChatWork();
  return pane;
};

const dismissedOrchestrationWorkerPanes = new Set<string>();

const orchestrationWorkerPaneKey = (runId: string, taskId: string): string =>
  `${runId}:${taskId}`;

const attachOrchestrationDiscussion = (
  pane: ExpertChatPane,
  sessionId: string | null,
  accountId: string,
): boolean => {
  let changed = false;
  if (pane.accountId !== accountId) {
    pane.accountId = accountId;
    void loadChatModelCatalog(accountId);
    changed = true;
  }
  const attachedDiscussionMatches = !!pane.discussion
    && !!sessionId
    && discussionForSession([pane.discussion], accountId, sessionId) !== null;
  if (
    pane.discussion
    && !attachedDiscussionMatches
  ) {
    stopExpertChatSync(pane);
    pane.discussion = null;
    pane.messages = [];
    pane.loading = false;
    pane.error = null;
    changed = true;
  }
  if (!sessionId || pane.discussion) return changed;
  const discussion = discussionForSession(allDiscussions(), accountId, sessionId);
  if (!discussion) return changed;
  pane.discussion = discussion;
  pane.accountId = discussion.accountId;
  pane.loading = true;
  pane.error = null;
  void loadChatModelCatalog(pane.accountId);
  if (activeView === "chat") {
    startExpertChatSync(pane);
    void loadExpertChatTranscript(pane);
  }
  return true;
};

const syncOrchestrationChatPanes = (): {
  changed: boolean;
  missingDiscussions: boolean;
} => {
  let changed = false;
  let missingDiscussions = false;
  const runsById = new Map(orchestrations.map((run) => [run.id, run]));

  if (orchestrationsLoaded) {
    expertChatPanes = expertChatPanes.filter((pane) => {
      if (!pane.orchestrationId || runsById.has(pane.orchestrationId)) return true;
      if (pane.orchestrationRole === "worker") {
        stopExpertChatSync(pane);
        stopExpertChatTurnPoll(pane);
        changed = true;
        return false;
      }
      pane.orchestrationId = null;
      pane.orchestrationRole = null;
      pane.orchestrationTaskId = null;
      changed = true;
      return true;
    });
  }

  const boundRunIds = new Set(
    expertChatPanes
      .map((pane) => pane.orchestrationId)
      .filter((id): id is string => !!id),
  );
  boundRunIds.forEach((runId) => {
    const run = runsById.get(runId);
    if (!run) return;
    const taskIds = new Set(run.tasks.map((task) => task.id));

    expertChatPanes
      .filter((pane) => pane.orchestrationId === run.id)
      .forEach((pane) => {
        if (pane.pendingWorkspace !== run.projectDir) {
          pane.pendingWorkspace = run.projectDir;
          changed = true;
        }
        if (pane.orchestrationRole === "orchestrator") {
          const attached = attachOrchestrationDiscussion(
            pane,
            run.orchestratorSessionId,
            orchestrationOrchestratorAccountId(run),
          );
          changed = attached || changed;
          if (run.orchestratorSessionId && !pane.discussion) missingDiscussions = true;
        }
      });

    expertChatPanes = expertChatPanes.filter((pane) => {
      if (
        pane.orchestrationId !== run.id
        || pane.orchestrationRole !== "worker"
        || !pane.orchestrationTaskId
        || taskIds.has(pane.orchestrationTaskId)
      ) {
        return true;
      }
      stopExpertChatSync(pane);
      stopExpertChatTurnPoll(pane);
      changed = true;
      return false;
    });

    run.tasks.forEach((task) => {
      const dismissedKey = orchestrationWorkerPaneKey(run.id, task.id);
      let pane = expertChatPanes.find(
        (candidate) =>
          candidate.orchestrationId === run.id
          && candidate.orchestrationRole === "worker"
          && candidate.orchestrationTaskId === task.id,
      );
      if (!pane && !dismissedOrchestrationWorkerPanes.has(dismissedKey)) {
        pane = createExpertChatPane(null, {
          accountId: orchestrationWorkerAccountId(run, task),
          pendingWorkspace: run.projectDir,
          mode: "build",
          orchestrationId: run.id,
          orchestrationRole: "worker",
          orchestrationTaskId: task.id,
        });
        expertChatPanes.push(pane);
        changed = true;
      }
      if (!pane) return;
      const attached = attachOrchestrationDiscussion(
        pane,
        task.sessionId,
        orchestrationWorkerAccountId(run, task),
      );
      changed = attached || changed;
      if (task.sessionId && !pane.discussion) missingDiscussions = true;
    });
  });

  if (changed) {
    reconcileExpertChatPage();
    persistExpertChats();
  }
  return { changed, missingDiscussions };
};

const releaseOrchestrationChatPanes = (runId: string) => {
  expertChatPanes = expertChatPanes.filter((pane) => {
    if (pane.orchestrationId !== runId) return true;
    if (pane.orchestrationRole === "worker") {
      stopExpertChatSync(pane);
      stopExpertChatTurnPoll(pane);
      return false;
    }
    pane.orchestrationId = null;
    pane.orchestrationRole = null;
    pane.orchestrationTaskId = null;
    return true;
  });
  [...dismissedOrchestrationWorkerPanes]
    .filter((key) => key.startsWith(`${runId}:`))
    .forEach((key) => dismissedOrchestrationWorkerPanes.delete(key));
  reconcileExpertChatPage();
  persistExpertChats();
};

type ExpertChatAccountTransferSnapshot = {
  discussion: DiscussionSummary | null;
  accountId: string | null;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  turn: ChatTurnSnapshot | null;
  draft: string;
  queuedSubmissions: QueuedChatSubmission[];
  queueDrainInFlight: boolean;
  activeSubmission: QueuedChatSubmission | null;
  capacityRetryAttempt: number;
  mode: ChatMode;
  enabledTools: ChatAgentToolId[];
  pendingWorkspace: string | null;
  historyOpen: boolean;
  followLatest: boolean;
  scrollTop: number;
};

const captureExpertChatAccountTransfer = (
  pane: ExpertChatPane,
): ExpertChatAccountTransferSnapshot => ({
  discussion: pane.discussion,
  accountId: pane.accountId,
  messages: [...pane.messages],
  loading: pane.loading,
  error: pane.error,
  truncated: pane.truncated,
  turn: pane.turn,
  draft: pane.draft,
  queuedSubmissions: pane.queuedSubmissions.map((submission) => ({ ...submission })),
  queueDrainInFlight: pane.queueDrainInFlight,
  activeSubmission: pane.activeSubmission ? { ...pane.activeSubmission } : null,
  capacityRetryAttempt: pane.capacityRetryAttempt,
  mode: pane.mode,
  enabledTools: [...pane.enabledTools],
  pendingWorkspace: pane.pendingWorkspace,
  historyOpen: pane.historyOpen,
  followLatest: pane.followLatest,
  scrollTop: pane.scrollTop,
});

const prepareExpertChatAccountTransfer = (
  pane: ExpertChatPane,
  discussion: DiscussionSummary | null,
  account: AccountProfile,
  folderPath: string,
  activatePane: boolean,
) => {
  stopExpertChatSync(pane);
  stopExpertChatTurnPoll(pane);
  resetExpertModelCapacityRetry(pane);

  pane.discussion = discussion;
  pane.accountId = account.id;
  pane.loading = false;
  pane.error = null;
  pane.turn = null;
  pane.activeSubmission = null;
  pane.capacityRetryAttempt = 0;
  pane.queueDrainInFlight = false;
  pane.queuedSubmissions = pane.queuedSubmissions.map((submission) => ({
    ...submission,
    accountId: account.id,
    model: accountModel(account),
    reasoningEffort: accountProvider(account) === "codex"
      ? accountReasoningEffort(account)
      : null,
    automaticCapacityRetry: false,
    resumeSessionId: null,
  }));
  pane.mode = "build";
  pane.pendingWorkspace = folderPath;
  pane.loadInFlight = false;
  pane.turnPollInFlight = false;
  if (activatePane) {
    activeExpertChatKey = pane.key;
    moveExpertChatPageToPane(pane);
  }
  activeView = "chat";

  const transition = expertChatAccountTransitions.get(pane.key);
  if (transition) {
    expertChatAccountTransitions.set(pane.key, {
      ...transition,
      detail: `Contexte conservé · reprise avec ${account.label}`,
    });
  }

  void loadChatModelCatalog(account.id);
  if (discussion) startExpertChatSync(pane);
  persistExpertChats();
  if (expertChatPaneRoot(pane)) refreshExpertChatPane(pane);
  else if (activatePane) render();
  refreshChatSidebarConversations();
};

const restoreExpertChatAfterAccountTransfer = (
  pane: ExpertChatPane,
  snapshot: ExpertChatAccountTransferSnapshot,
) => {
  stopExpertChatSync(pane);
  stopExpertChatTurnPoll(pane);
  resetExpertModelCapacityRetry(pane);
  expertChatAccountTransitions.delete(pane.key);

  pane.discussion = snapshot.discussion;
  pane.accountId = snapshot.accountId;
  pane.messages = snapshot.messages;
  pane.loading = snapshot.loading;
  pane.error = snapshot.error;
  pane.truncated = snapshot.truncated;
  pane.turn = snapshot.turn;
  pane.draft = snapshot.draft;
  pane.queuedSubmissions = snapshot.queuedSubmissions;
  pane.queueDrainInFlight = snapshot.queueDrainInFlight;
  pane.activeSubmission = snapshot.activeSubmission;
  pane.capacityRetryAttempt = snapshot.capacityRetryAttempt;
  pane.capacityRetryTimer = null;
  pane.mode = snapshot.mode;
  pane.enabledTools = snapshot.enabledTools;
  pane.pendingWorkspace = snapshot.pendingWorkspace;
  pane.historyOpen = snapshot.historyOpen;
  pane.followLatest = snapshot.followLatest;
  pane.scrollTop = snapshot.scrollTop;
  pane.loadInFlight = false;
  pane.turnPollInFlight = false;

  if (pane.discussion) {
    startExpertChatSync(pane);
    void loadExpertChatTranscript(pane);
  }
  persistExpertChats();
  if (expertChatPaneRoot(pane)) refreshExpertChatPane(pane);
  else if (activeView !== "chat") render();
  refreshChatSidebarConversations();
};

// Ouvre la continuation dans la grille de chats et demarre son premier tour en
// arriere-plan. Les boutons « Reprendre » et « Deplacer + reprendre » restent
// ainsi dans l'interface de chat, sans creer de terminal interactif.
const resumeDiscussionInChat = async (
  discussion: DiscussionSummary | null,
  accountId: string,
  folderPath: string,
  prompt: string,
  reusePane: ExpertChatPane | null = null,
): Promise<ExpertChatPane | null> => {
  if (discussion) discussion.folderPath = folderPath;
  const targetAccount = accountById(accountId);
  if (!targetAccount) return null;
  const transferSnapshot = reusePane
    ? captureExpertChatAccountTransfer(reusePane)
    : null;
  const activateReusePane = !!reusePane && activeView !== "chat";
  const pane = reusePane ?? (discussion
    ? openDiscussionInExpert(discussion)
    : addExpertChatPane(accountId, { mode: "build", pendingWorkspace: folderPath }));
  if (!pane) return null;

  if (transferSnapshot) {
    prepareExpertChatAccountTransfer(
      pane,
      discussion,
      targetAccount,
      folderPath,
      activateReusePane,
    );
  } else {
    pane.accountId = accountId;
    pane.pendingWorkspace = folderPath;
    pane.mode = "build";
  }
  if (
    (!transferSnapshot || activateReusePane) &&
    expertChatFullscreenKey &&
    expertChatFullscreenKey !== pane.key
  ) {
    expertChatFullscreenKey = pane.key;
  }
  persistExpertChats();

  let root = expertChatPaneRoot(pane);
  if (!root && !transferSnapshot) {
    render();
    await waitForFrame();
    root = expertChatPaneRoot(pane);
  }
  if (!root && !transferSnapshot) {
    return null;
  }

  const transferSubmission: QueuedChatSubmission | null = transferSnapshot
    ? {
        prompt,
        accountId: targetAccount.id,
        mode: "build",
        model: accountModel(targetAccount),
        reasoningEffort: accountProvider(targetAccount) === "codex"
          ? reasoningEffortForChatModel(
              targetAccount,
              accountModel(targetAccount),
              accountReasoningEffort(targetAccount),
            )
          : null,
        enabledTools: [...pane.enabledTools],
        agentSkills: chatAgentSkillPrompts(pane.enabledTools),
        resumeSessionId: discussion?.rolloutId || discussion?.sessionId || null,
      }
    : null;
  const sent = await sendExpertChatMessage(
    pane,
    root,
    transferSnapshot ? undefined : prompt,
    "message",
    transferSubmission,
  );
  if (!sent && transferSnapshot) {
    restoreExpertChatAfterAccountTransfer(pane, transferSnapshot);
  }
  return sent ? pane : null;
};

const toggleExpertChatFullscreen = (pane: ExpertChatPane) => {
  if (!expertChatPanes.includes(pane)) return;
  expertChatFullscreenKey = expertChatFullscreenKey === pane.key ? null : pane.key;
  if (expertChatFullscreenKey) activeExpertChatKey = pane.key;
  render();
  if (expertChatFullscreenKey) {
    window.requestAnimationFrame(() => {
      expertChatPaneRoot(pane)
        ?.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']")
        ?.focus();
    });
  }
};

const closeExpertChatPane = (pane: ExpertChatPane) => {
  if (chatTurnIsBusy(pane.turn?.status)) {
    statusText = pane.turn?.status === "finalizing"
      ? "La conversation termine sa synchronisation"
      : "Arretez la reponse avant de fermer ce chat";
    return;
  }
  const index = expertChatPanes.indexOf(pane);
  if (index < 0) return;
  if (pane.orchestrationId && pane.orchestrationRole === "worker" && pane.orchestrationTaskId) {
    dismissedOrchestrationWorkerPanes.add(
      orchestrationWorkerPaneKey(pane.orchestrationId, pane.orchestrationTaskId),
    );
  }
  stopExpertChatSync(pane);
  stopExpertChatTurnPoll(pane);
  resetExpertModelCapacityRetry(pane);
  expertChatAccountTransitions.delete(pane.key);
  expertChatPanes.splice(index, 1);
  const environmentPanes = expertChatPanesForCurrentEnvironment();
  if (activeExpertChatKey === pane.key) {
    activeExpertChatKey = environmentPanes[0]?.key ?? null;
  }
  if (expertChatFullscreenKey === pane.key) expertChatFullscreenKey = null;
  reconcileExpertChatPage();
  statusText = expertChatStatusText();
  persistExpertChats();
  render();
  startAllExpertChatWork();
};

const bindExpertChatPaneUi = (pane: ExpertChatPane, root: HTMLElement) => {
  root.addEventListener("pointerdown", () => {
    if (pane.key !== activeExpertChatKey) activateExpertChatPane(pane);
  });
  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("[data-chat-action='focus-prompt']")) return;
    activateExpertChatPane(pane, true);
  });

  root.querySelector<HTMLButtonElement>("[data-chat-action='back']")?.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      document.body.classList.add("chat-sidebar-open");
      syncMobileDrawerAccessibility(true, true);
    } else {
      setActiveView("discussions");
    }
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='new']")?.addEventListener("click", () => openNewChatModal());
  root.querySelectorAll<HTMLButtonElement>("[data-chat-action='autonomize'], [data-chat-action='edit-autonomous']")
    .forEach((button) => {
      button.addEventListener("click", () => openAutonomousChatEditor(pane));
    });
  root.querySelector<HTMLButtonElement>("[data-chat-action='orchestrate']")?.addEventListener("click", () => {
    openOrchestrationConversion(pane);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-chat-action='open-orchestration']").forEach((button) => {
    button.addEventListener("click", () => setActiveView("orchestration"));
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='close']")?.addEventListener("click", () => closeExpertChatPane(pane));
  root.querySelector<HTMLButtonElement>("[data-chat-action='fullscreen']")?.addEventListener("click", () => toggleExpertChatFullscreen(pane));
  root.querySelector<HTMLButtonElement>("[data-chat-action='refresh']")?.addEventListener("click", () => {
    if (pane.discussion) void loadExpertChatTranscript(pane);
    else void refreshDiscussions();
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='history-toggle']")?.addEventListener("click", () => {
    pane.historyOpen = !pane.historyOpen;
    refreshExpertChatPane(pane);
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='history-close']")?.addEventListener("click", () => {
    pane.historyOpen = false;
    refreshExpertChatPane(pane);
  });
  root.querySelectorAll<HTMLButtonElement>("[data-chat-history-message]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.chatHistoryMessage);
      if (!Number.isInteger(index)) return;
      const reveal = () => {
        const message = root.querySelector<HTMLElement>(`[data-chat-message-index='${index}']`);
        message?.scrollIntoView({ behavior: "smooth", block: "center" });
        message?.classList.add("chat-msg--located");
        window.setTimeout(() => message?.classList.remove("chat-msg--located"), 1400);
      };
      if (window.matchMedia("(max-width: 760px)").matches) {
        pane.historyOpen = false;
        refreshExpertChatPane(pane);
        window.requestAnimationFrame(() => {
          const nextRoot = expertChatPaneRoot(pane);
          const message = nextRoot?.querySelector<HTMLElement>(`[data-chat-message-index='${index}']`);
          message?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      } else {
        reveal();
      }
    });
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='stop']")?.addEventListener("click", () => {
    void stopExpertChatTurn(pane);
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='clear-queue']")?.addEventListener("click", () => {
    pane.queuedSubmissions = [];
    statusText = "File d'attente annulée";
    refreshExpertChatPane(pane);
    focusExpertChatPrompt(pane);
  });
  root.querySelector<HTMLButtonElement>("[data-chat-action='goal']")?.addEventListener("click", () => {
    void sendExpertChatMessage(pane, root, undefined, "goal");
  });
  root.querySelectorAll<HTMLButtonElement>("[data-chat-action='toggle-agent-tool']").forEach((button) => {
    button.addEventListener("click", () => {
      const toolId = button.dataset.chatTool;
      if (!isChatAgentToolId(toolId)) return;
      pane.enabledTools = toggleChatAgentTool(pane.enabledTools, toolId);
      const enabled = pane.enabledTools.includes(toolId);
      statusText = `${chatAgentToolLabel(toolId, chatAgentToolDefinitions())} ${enabled ? "activé" : "désactivé"} pour ce chat`;
      persistExpertChats();
      refreshExpertChatPane(pane);
      focusExpertChatPrompt(pane);
    });
  });
  const prompt = root.querySelector<HTMLTextAreaElement>("[data-chat-control='prompt']");
  const promptMaxHeight = root.matches(".chat-panel--compact:not(.is-fullscreen)") ? 64 : 132;
  const resizePrompt = () => {
    if (!prompt) return;
    prompt.style.height = "0px";
    prompt.style.height = `${Math.min(prompt.scrollHeight, promptMaxHeight)}px`;
  };
  prompt?.addEventListener("input", () => {
    pane.draft = prompt.value;
    prompt.setCustomValidity("");
    resizePrompt();
  });
  prompt?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendExpertChatMessage(pane, root);
    }
  });
  resizePrompt();
  bindVoiceComposer(root);
  root.querySelector<HTMLFormElement>("[data-chat-control='composer']")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendExpertChatMessage(pane, root);
  });
  root.querySelector<HTMLSelectElement>("[data-chat-control='mode']")?.addEventListener("change", (event) => {
    pane.mode = (event.currentTarget as HTMLSelectElement).value as ChatMode;
    persistExpertChats();
  });

  const modelInput = root.querySelector<HTMLInputElement>("[data-chat-control='model']");
  const commitPreferences = () => {
    const account = expertChatSelectedAccount(pane);
    if (!account) return false;
    const preferences = readChatPreferences(account, root);
    modelInput?.setCustomValidity(preferences.error ?? "");
    if (preferences.error) {
      modelInput?.reportValidity();
      statusText = preferences.error;
      return false;
    }
    if (preferences.changed) persistChatPreferences(account.id);
    return true;
  };
  modelInput?.addEventListener("input", () => modelInput.setCustomValidity(""));
  modelInput?.addEventListener("change", () => {
    if (commitPreferences()) refreshExpertChatPane(pane);
  });
  modelInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    modelInput.blur();
  });
  root.querySelector<HTMLSelectElement>("[data-chat-control='reasoning-effort']")?.addEventListener("change", commitPreferences);
  root.querySelectorAll<HTMLButtonElement>("[data-chat-starter]").forEach((button) => {
    button.addEventListener("click", () => {
      pane.draft = button.dataset.chatStarter ?? "";
      if (prompt) {
        prompt.value = pane.draft;
        prompt.dispatchEvent(new Event("input"));
        prompt.focus();
        prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      }
    });
  });

  const feed = root.querySelector<HTMLDivElement>("[data-chat-control='feed']");
  if (feed) bindChatFeedScroll(feed, pane);
  feed?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(".chat-code-copy, [data-chat-copy]");
    if (!button) return;
    const code = button.matches("[data-chat-copy]")
      ? button.closest(".chat-user-message, [data-chat-copy-source]")?.querySelector<HTMLElement>(".chat-msg-body, .chat-assistant-markdown")?.innerText ?? ""
      : button.closest(".chat-code")?.querySelector("code")?.textContent ?? "";
    if (!code) return;
    void navigator.clipboard.writeText(code).then(() => {
      button.classList.add("copied");
      window.setTimeout(() => button.classList.remove("copied"), 1200);
    });
  });
};

const bindExpertChatGridUi = () => {
  expertChatPanes.forEach((pane) => {
    const root = expertChatPaneRoot(pane);
    if (root) {
      bindExpertChatPaneUi(pane, root);
      restoreExpertChatScroll(pane, root);
    }
  });
};

const renderDiscussionRow = (discussion: DiscussionSummary, accountLabel: string) => {
  const busy = discussionBusyId === discussion.sessionId;
  const title = discussion.title?.trim() || "(sans titre)";
  const subtitle = discussionSubtitle(discussion);
  const provider = discussion.provider ?? "codex";
  const folderPath = discussionFolderPath(discussion);
  const meta = [
    `<span class="discussion-badge prov-${provider}" title="Fournisseur d'origine"><i data-lucide="cpu"></i>${escapeHtml(providerLabel(provider))}</span>`,
    folderPath
      ? `<span title="${escapeAttr(folderPath)}"><i data-lucide="folder-open"></i>${escapeHtml(displayProjectDir(folderPath))}</span>`
      : "",
    `<span><i data-lucide="clock-3"></i>${escapeHtml(formatTimestamp(discussion.lastActivity))}</span>`,
    discussion.totalTokens
      ? `<span><i data-lucide="bar-chart-3"></i>${escapeHtml(formatTokens(discussion.totalTokens))} tok</span>`
      : "",
    `<span>${discussion.messageCount} msg</span>`,
    discussion.forkCount > 1
      ? `<span title="Reprises regroupees (${discussion.forkCount} fichiers)"><i data-lucide="history"></i>${discussion.forkCount - 1} reprise${discussion.forkCount - 1 > 1 ? "s" : ""}</span>`
      : "",
  ]
    .filter(Boolean)
    .join("");

  // Compte cible : origine EN PREMIER (marquee), puis les autres. Choisir un
  // autre compte transforme la reprise en deplacement (copie fidele puis
  // archivage de la source) — logique portee par continueDiscussionWith.
  const accounts = settings?.accounts ?? [];
  const target = discussionTargetFor(discussion);
  const willCopy = target !== discussion.accountId;
  const options =
    accounts
      .map((account) => {
        const selected = account.id === target ? " selected" : "";
        const suffix = account.id === discussion.accountId ? " (origine)" : "";
        return `<option value="${escapeAttr(account.id)}"${selected}>${escapeHtml(account.label)}${suffix}</option>`;
      })
      .join("") ||
    `<option value="${escapeAttr(discussion.accountId)}" selected>${escapeHtml(accountLabel)}</option>`;

  return `
    <div class="discussion-row ${busy ? "busy" : ""}">
      <div class="discussion-main">
        <strong class="discussion-title" title="${escapeAttr(title)}">${escapeHtml(title)}</strong>
        ${subtitle ? `<span class="discussion-preview">${escapeHtml(subtitle)}</span>` : ""}
        <span class="discussion-meta">${meta}</span>
      </div>
      <div class="discussion-actions">
        <label class="discussion-account" title="Choisir le compte dans lequel reprendre cette discussion">
          <i data-lucide="users"></i>
          <select class="discussion-target" data-target-for="${escapeAttr(discussion.sessionId)}">
            ${options}
          </select>
        </label>
        <button class="tool-button" data-resume-session="${escapeAttr(discussion.sessionId)}" title="${willCopy ? "Déplacer la discussion dans le compte choisi puis la reprendre automatiquement" : "Reprendre automatiquement dans le chat"}">
          <i data-lucide="${willCopy ? "copy" : "play"}"></i><span data-resume-label>${willCopy ? "Déplacer + reprendre" : "Reprendre"}</span>
        </button>
        <button class="tool-button primary" data-open-chat="${escapeAttr(discussion.sessionId)}" title="Ouvrir cette conversation dans le chat">
          <i data-lucide="messages-square"></i><span>Ouvrir le chat</span>
        </button>
        <button class="icon-button wide danger" data-delete-session="${escapeAttr(discussion.sessionId)}" title="Retirer de l'historique (archive toutes les reprises)">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    </div>
  `;
};

const renderDiscussionGroups = () => {
  if (!discussionsLoaded) {
    return `<div class="pool-empty">Lecture des discussions Codex…</div>`;
  }
  const groups = discussions?.accounts ?? [];
  if (groups.length === 0) {
    return `<div class="pool-empty">Aucune discussion trouvee</div>`;
  }

  const blocks = groups
    .map((group) => {
      const rows = group.discussions.filter((discussion) => discussionMatches(discussion, group.label));
      if (rows.length === 0) return "";
      return `
        <section class="discussion-group">
          <header class="discussion-group-head">
            <strong>${escapeHtml(group.label)}</strong>
            <span>${rows.length}/${group.discussionCount} discussion(s)${group.hasTokens ? "" : " · deconnecte"}</span>
          </header>
          ${group.error ? `<div class="limit-error">${escapeHtml(group.error)}</div>` : ""}
          <div class="discussion-list">${rows.map((discussion) => renderDiscussionRow(discussion, group.label)).join("")}</div>
        </section>
      `;
    })
    .filter(Boolean)
    .join("");

  return blocks || `<div class="pool-empty">Aucune discussion ne correspond a « ${escapeHtml(discussionSearch)} »</div>`;
};

const renderDiscussionsPanel = () => {
  const groups = discussions?.accounts ?? [];
  const total = groups.reduce((sum, group) => sum + group.discussionCount, 0);
  const connected = groups.filter((group) => group.hasTokens).length;
  return `
    <section class="discussions-panel">
      <div class="discussions-head">
        <div>
          <strong>Discussions</strong>
          <span>${total} discussion(s) · ${connected}/${settings?.accounts.length ?? 0} compte(s)</span>
        </div>
        <div class="discussions-tools">
          <label class="discussion-search">
            <i data-lucide="search"></i>
            <input id="discussionSearch" type="search" placeholder="Rechercher (titre, environnement, id)" value="${escapeAttr(discussionSearch)}" />
          </label>
          <button id="refreshDiscussions" class="tool-button" title="Actualiser">
            <i data-lucide="refresh-ccw"></i><span>Actualiser</span>
          </button>
        </div>
      </div>
      <div class="discussion-groups" id="discussionGroups">${renderDiscussionGroups()}</div>
    </section>
  `;
};

const refreshDiscussionList = () => {
  const host = document.querySelector<HTMLDivElement>("#discussionGroups");
  if (!host) {
    render();
    return;
  }
  host.innerHTML = renderDiscussionGroups();
  renderIcons(host);
  bindDiscussionRowUi();
};

const clearChatDragUi = () => {
  draggedChatSessionId = null;
  document
    .querySelectorAll<HTMLElement>(".chat-side-item.dragging, .chat-workspace-group.drag-over")
    .forEach((element) => element.classList.remove("dragging", "drag-over"));
  document.body.classList.remove("chat-dragging");
};

// Attache les gestionnaires de la liste de workspaces. Le root optionnel permet
// de rebinder seulement les groupes remplaces par un rafraichissement cible.
const bindWorkspaceSwitcherUi = (root: ParentNode = document) => {
  root.querySelector<HTMLButtonElement>("#chooseEnvironmentFromSidebar")?.addEventListener(
    "click",
    openTerminalEnvironmentMenu,
  );
  root.querySelectorAll<HTMLButtonElement>("[data-ws-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const value = button.dataset.wsSelect;
      if (value) void openFolderTerminals(value);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-open-folder-terminal]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = terminalSessions.find(
        (candidate) => candidate.key === button.dataset.openFolderTerminal,
      );
      if (!session) return;
      activateTerminalSession(session);
      requestTerminalFocusKey = session.key;
      activeView = "terminal";
      stopLimitPoll();
      stopUsagePoll();
      stopKombaiPoll();
      stopDiscussionsPoll();
      stopChatSync();
      statusText = `Terminal actif: ${terminalTitle(session)}`;
      render();
      persistTerminalSessions();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-new-chat-workspace]").forEach((button) => {
    button.addEventListener("click", () => {
      const workspace = knownWorkspaces().find(
        (candidate) => candidate.id === button.dataset.newChatWorkspace,
      );
      if (!workspace) return;
      setCurrentWorkspace(workspace.path);
      setChatWorkspaceFilter(workspace.id);
      pendingChatWorkspace = workspace.path;
      void upsertWorkspaceRegistry(workspace.path);
      openNewChat();
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-close-workspace]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = button.dataset.closeWorkspace;
      const workspace = knownWorkspaces().find((candidate) => candidate.id === id);
      if (workspace) void closeWorkspace(workspace);
    });
  });
  root.querySelector<HTMLButtonElement>("#wsOpenFolder")?.addEventListener("click", () => {
    openTerminalEnvironmentMenu();
  });
  root
    .querySelectorAll<HTMLElement>("[data-drag-chat][draggable=\"true\"]")
    .forEach((row) => {
      row.addEventListener("dragstart", (event) => {
        const dragEvent = event as DragEvent;
        const sessionId = row.dataset.dragChat;
        const discussion = findDiscussion(sessionId);
        if (!sessionId || !discussion || discussionBusyId || discussionHasRunningTurn(discussion)) {
          dragEvent.preventDefault();
          return;
        }
        draggedChatSessionId = sessionId;
        dragEvent.dataTransfer?.setData(CHAT_DRAG_MIME, sessionId);
        dragEvent.dataTransfer?.setData("text/plain", sessionId);
        if (dragEvent.dataTransfer) dragEvent.dataTransfer.effectAllowed = "move";
        document.body.classList.add("chat-dragging");
        window.requestAnimationFrame(() => row.classList.add("dragging"));
      });
      row.addEventListener("dragend", clearChatDragUi);
    });

  root.querySelectorAll<HTMLElement>("[data-chat-drop-workspace]").forEach((target) => {
    const dropContext = (event: DragEvent) => {
      const sessionId =
        draggedChatSessionId || event.dataTransfer?.getData(CHAT_DRAG_MIME) || null;
      const discussion = findDiscussion(sessionId);
      const workspace = knownWorkspaces().find(
        (candidate) => candidate.id === target.dataset.chatDropWorkspace,
      );
      if (!discussion || !workspace || discussionBusyId || discussionHasRunningTurn(discussion)) {
        return null;
      }
      const folderPath = discussionFolderPath(discussion);
      if (folderPath && normalizeWorkspacePath(folderPath) === normalizeWorkspacePath(workspace.path)) {
        return null;
      }
      return { discussion, workspace };
    };

    target.addEventListener("dragover", (event) => {
      const dragEvent = event as DragEvent;
      if (!dropContext(dragEvent)) return;
      dragEvent.preventDefault();
      if (dragEvent.dataTransfer) dragEvent.dataTransfer.dropEffect = "move";
      document
        .querySelectorAll<HTMLElement>(".chat-workspace-group.drag-over")
        .forEach((group) => group.classList.toggle("drag-over", group === target));
    });
    target.addEventListener("dragleave", (event) => {
      const related = (event as DragEvent).relatedTarget;
      if (related instanceof Node && target.contains(related)) return;
      target.classList.remove("drag-over");
    });
    target.addEventListener("drop", (event) => {
      const dragEvent = event as DragEvent;
      const context = dropContext(dragEvent);
      if (!context) return;
      dragEvent.preventDefault();
      clearChatDragUi();
      void moveDiscussionToWorkspace(context.discussion, context.workspace);
    });
  });
};

// Rafraichit uniquement l'en-tete des workspaces sans re-render global.
const refreshWorkspaceSwitcher = () => {
  const current = document.querySelector<HTMLElement>("#chatWsSwitcher");
  if (!current) return;
  // Rien n'a change depuis le dernier rendu : on ne touche pas au DOM (evite
  // repaint/perte de focus inutiles a chaque poll).
  if (current.dataset.wsSig === workspaceSwitcherSignature()) return;
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderWorkspaceSwitcher();
  const next = wrapper.firstElementChild;
  if (!next) return;
  current.replaceWith(next);
  renderIcons(next);
  bindWorkspaceSwitcherUi(next);
};

const bindDiscussionRowUi = () => {
  document.querySelectorAll<HTMLButtonElement>("[data-delete-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const discussion = findDiscussion(button.dataset.deleteSession);
      if (discussion) openDiscussionArchiveModal(discussion);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-open-chat]").forEach((button) => {
    button.addEventListener("click", () => {
      const discussion = findDiscussion(button.dataset.openChat);
      if (discussion) openDiscussionChat(discussion);
    });
  });
  // Rangees de brouillons (chats ouverts sans discussion listee) : activees et
  // fermees par cle de pane, faute de sessionId a resoudre.
  document.querySelectorAll<HTMLButtonElement>("[data-open-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      const pane = expertChatPanes.find((item) => item.key === button.dataset.openPane);
      if (!pane) return;
      closeMobileOverlays();
      activeView = "chat";
      activateExpertChatPane(pane, true);
      statusText = expertChatStatusText();
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-close-pane]").forEach((button) => {
    button.addEventListener("click", () => {
      const pane = expertChatPanes.find((item) => item.key === button.dataset.closePane);
      if (pane) closeExpertChatPane(pane);
    });
  });
  // Changement de compte cible : on memorise le choix et on met a jour, sans
  // re-render complet, le libelle/icone du bouton (Reprendre <-> Deplacer +
  // reprendre) pour ne pas voler le focus du select.
  document.querySelectorAll<HTMLSelectElement>(".discussion-target[data-target-for]").forEach((select) => {
    select.addEventListener("change", () => {
      const id = select.dataset.targetFor ?? "";
      const discussion = findDiscussion(id);
      if (!discussion) return;
      discussionTargetSel.set(id, select.value);
      const willCopy = select.value !== discussion.accountId;
      const row = select.closest(".discussion-row");
      const button = row?.querySelector<HTMLButtonElement>("[data-resume-session]");
      const label = button?.querySelector<HTMLElement>("[data-resume-label]");
      if (label) label.textContent = willCopy ? "Déplacer + reprendre" : "Reprendre";
      if (button) {
        button.title = willCopy
          ? "Déplacer la discussion dans le compte choisi puis la reprendre automatiquement"
          : "Reprendre automatiquement dans le chat";
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-resume-session]").forEach((button) => {
    button.addEventListener("click", () => {
      const discussion = findDiscussion(button.dataset.resumeSession);
      if (!discussion) return;
      const target = discussionTargetFor(discussion);
      if (target && target !== discussion.accountId) {
        void continueDiscussionWith(discussion, target);
      } else {
        void resumeDiscussion(discussion);
      }
    });
  });
};

// --- Historique des demandes, regroupe par chat / terminal ----------------
// Le backend renvoie les messages utilisateur individuellement. La vue les
// regroupe par session ET par compte afin qu'une carte resume exclusivement les
// messages envoyes dans le chat ou le terminal correspondant.
const PROMPT_RENDER_LIMIT = 400;

const refreshPromptHistory = async () => {
  try {
    promptHistory = await invoke<PromptHistoryView>("list_prompt_history", { limit: 4000 });
    promptHistoryLoaded = true;
  } catch (error) {
    statusText = String(error);
    promptHistoryLoaded = true;
  }

  // Rerender complet quand on est sur la vue : reconstruit aussi l'en-tete
  // (compteur « X demande(s) » + note de troncature), pas seulement la liste.
  if (activeView === "history") render();
};

const allPrompts = (): PromptEntry[] => promptHistory?.prompts ?? [];

const promptSessions = (): PromptSessionHistory[] => {
  const groups = new Map<string, PromptSessionHistory>();
  for (const entry of allPrompts()) {
    const key = `${entry.accountId}\u0000${entry.sessionId}`;
    const existing = groups.get(key);
    if (existing) {
      const duplicate = existing.prompts.some(
        (candidate) => candidate.timestamp === entry.timestamp && candidate.text === entry.text,
      );
      if (!duplicate) existing.prompts.push(entry);
      existing.firstTimestamp = Math.min(existing.firstTimestamp, entry.timestamp);
      existing.lastTimestamp = Math.max(existing.lastTimestamp, entry.timestamp);
      existing.cwd ||= entry.cwd;
      existing.sessionTitle ||= entry.sessionTitle;
      continue;
    }
    groups.set(key, {
      key,
      sessionId: entry.sessionId,
      accountId: entry.accountId,
      accountLabel: entry.accountLabel,
      cwd: entry.cwd,
      sessionTitle: entry.sessionTitle,
      firstTimestamp: entry.timestamp,
      lastTimestamp: entry.timestamp,
      prompts: [entry],
    });
  }
  return [...groups.values()]
    .map((session) => ({
      ...session,
      prompts: session.prompts.sort((left, right) => left.timestamp - right.timestamp),
    }))
    .sort((left, right) => right.lastTimestamp - left.lastTimestamp);
};

const promptSessionMatches = (session: PromptSessionHistory) => {
  const query = promptSearch.trim().toLowerCase();
  if (!query) return true;
  return [
    ...session.prompts.map((entry) => entry.text),
    session.cwd ?? "",
    session.accountLabel,
    session.sessionTitle ?? "",
    session.sessionId,
  ].some((field) => field.toLowerCase().includes(query));
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Surligne les occurrences de la requete en matchant sur le texte BRUT (les
// bornes <mark> tombent donc toujours sur des frontieres de caracteres reels,
// jamais au milieu d'une entite HTML ni decalees par toLowerCase), puis echappe
// CHAQUE tranche emise : aucune injection possible et le rendu reste exact.
const highlightMatch = (text: string, query: string) => {
  const needle = query.trim();
  if (!needle) return escapeHtml(text);
  const re = new RegExp(escapeRegExp(needle), "gi");
  let result = "";
  let last = 0;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    if (match[0].length === 0) break;
    result += escapeHtml(text.slice(last, start));
    result += `<mark>${escapeHtml(match[0])}</mark>`;
    last = start + match[0].length;
  }
  result += escapeHtml(text.slice(last));
  return result;
};

const renderPromptSession = (session: PromptSessionHistory) => {
  const meta = [
    `<span><i data-lucide="clock-3"></i>${escapeHtml(formatTimestamp(session.lastTimestamp))}</span>`,
    `<span><i data-lucide="users"></i>${escapeHtml(session.accountLabel)}</span>`,
    session.cwd
      ? `<span title="${escapeAttr(session.cwd)}"><i data-lucide="folder-open"></i>${escapeHtml(displayProjectDir(session.cwd))}</span>`
      : "",
    `<span><i data-lucide="message-square-text"></i>${session.prompts.length} message(s) envoye(s)</span>`,
  ]
    .filter(Boolean)
    .join("");
  const title = session.sessionTitle?.trim() || session.prompts[0]?.text.trim() || "Session sans titre";
  const messages = session.prompts
    .map(
      (entry, index) => `
        <li>
          <span class="prompt-message-index">${index + 1}</span>
          <span>${highlightMatch(entry.text, promptSearch)}</span>
          <time>${escapeHtml(formatTimestamp(entry.timestamp))}</time>
        </li>`,
    )
    .join("");
  return `
    <div class="prompt-row prompt-session-row">
      <div class="prompt-main">
        <strong class="prompt-session-title">${highlightMatch(title, promptSearch)}</strong>
        <span class="prompt-meta">${meta}</span>
        <ol class="prompt-session-messages">${messages}</ol>
      </div>
      <div class="prompt-actions">
        <button class="tool-button" data-prompt-discussion="${escapeAttr(session.sessionId)}" data-prompt-account="${escapeAttr(session.accountId)}" title="Voir la conversation">
          <i data-lucide="messages-square"></i><span>Conversation</span>
        </button>
      </div>
    </div>
  `;
};

const renderPromptRows = () => {
  if (!promptHistoryLoaded) {
    return `<div class="pool-empty">Lecture des demandes Codex…</div>`;
  }
  const all = promptSessions();
  if (all.length === 0) {
    return `<div class="pool-empty">Aucune demande trouvee</div>`;
  }
  const matches = all.filter(promptSessionMatches);
  if (matches.length === 0) {
    return `<div class="pool-empty">Aucune demande ne correspond a « ${escapeHtml(promptSearch)} »</div>`;
  }
  const shown = matches.slice(0, PROMPT_RENDER_LIMIT);
  const capped =
    matches.length > shown.length
      ? `<div class="prompt-more">Affichage limite a ${PROMPT_RENDER_LIMIT} sur ${matches.length} resultats — affine la recherche.</div>`
      : "";
  return `${shown.map(renderPromptSession).join("")}${capped}`;
};

const renderPromptHistoryPanel = () => {
  const returned = promptHistory?.returned ?? 0;
  const truncatedNote = promptHistory?.truncated ? ` · ${returned} plus recentes indexees` : "";
  const sessions = promptSessions();
  const sessionCount = sessions.length;
  const messageCount = sessions.reduce((sum, session) => sum + session.prompts.length, 0);
  const countLabel = promptHistoryLoaded
    ? `${sessionCount} chat(s) / terminal(aux) · ${messageCount} message(s)${truncatedNote}`
    : "Lecture…";
  return `
    <section class="discussions-panel">
      <div class="discussions-head">
        <div>
          <strong>Historique par chat ou terminal</strong>
          <span>${escapeHtml(countLabel)}</span>
        </div>
        <div class="discussions-tools">
          <label class="discussion-search">
            <i data-lucide="search"></i>
            <input id="promptSearch" type="search" placeholder="Rechercher dans les chats, terminaux et messages" value="${escapeAttr(promptSearch)}" />
          </label>
          <button id="refreshPromptHistory" class="tool-button" title="Actualiser">
            <i data-lucide="refresh-ccw"></i><span>Actualiser</span>
          </button>
        </div>
      </div>
      <div class="discussion-groups" id="promptList">${renderPromptRows()}</div>
    </section>
  `;
};

const refreshPromptList = () => {
  const host = document.querySelector<HTMLDivElement>("#promptList");
  if (!host) {
    render();
    return;
  }
  host.innerHTML = renderPromptRows();
  renderIcons(host);
  bindPromptRowUi();
};

const openDiscussionForSession = (accountId: string, sessionId: string) => {
  const discussion = discussionForSession(allDiscussions(), accountId, sessionId);
  if (discussion) {
    openDiscussionChat(discussion);
    return;
  }
  discussionSearch = sessionId;
  if (activeView === "discussions") {
    refreshDiscussionList();
  } else {
    setActiveView("discussions");
  }
};

const bindPromptRowUi = () => {
  document.querySelectorAll<HTMLButtonElement>("[data-prompt-discussion]").forEach((button) => {
    button.addEventListener("click", () => {
      const sessionId = button.dataset.promptDiscussion;
      const accountId = button.dataset.promptAccount;
      if (accountId && sessionId) openDiscussionForSession(accountId, sessionId);
    });
  });
};

const restoreTerminals = async () => {
  if (!settings) return;
  const state = loadOpenTerminalRecords();
  const eligibleRecords = state.terminals.filter(
    (record) =>
      settings!.accounts.some((account) => account.id === record.accountId) &&
      !!userEnvironmentPath(record.folderPath),
  );
  // Un login temporaire peut deja etre affiche sans avoir declenche la
  // restauration. Ne jamais depasser la limite en ajoutant les sessions
  // sauvegardees a celles qui sont deja en memoire / en cours de creation.
  const availableSlots = Math.max(
    0,
    EXPERT_MAX_TERMINALS - terminalSessions.length - pendingTerminalCreations,
  );
  const records = eligibleRecords.slice(0, availableSlots);
  if (records.length === 0) {
    if (eligibleRecords.length === 0 && state.terminals.length > 0) persistTerminalSessions();
    return;
  }

  const restored: TerminalSession[] = [];
  for (const record of records) {
    const account = settings.accounts.find((candidate) => candidate.id === record.accountId);
    if (!account) continue;
    const agentId =
      record.agentId && settings.agents.some((agent) => agent.id === record.agentId)
        ? record.agentId
        : codexAgentId();
    const restoredFolder = userEnvironmentPath(record.folderPath);
    if (!restoredFolder) continue;
    const session = await createTerminalSession(
      account,
      proxyForAccount(account),
      agentId,
      restoredFolder,
    );
    session.key = record.key;
    session.codexSessionId = record.codexSessionId ?? null;
    session.resumeSessionId = record.codexSessionId ?? null;
    session.workspaceId = record.workspaceId?.trim() || null;
    session.workspacePath = record.workspacePath?.trim() || null;
    session.projectDir = record.projectDir?.trim() || account.projectDir?.trim() || null;
    if (session.codexSessionId) claimedSessionIds.add(session.codexSessionId);
    terminalSessions.push(session);
    restored.push(session);
  }

  if (restored.length === 0) return;

  activeTerminalKey =
    (state.activeKey && restored.some((session) => session.key === state.activeKey) && state.activeKey) ||
    restored[0].key;
  const restoredActive = activeTerminal();
  if (restoredActive && activeView === "terminal") activateTerminalSession(restoredActive);
  if (activeView === "terminal") render();

  for (let index = 0; index < restored.length; index += TERMINAL_RESTORE_CONCURRENCY) {
    const batch = restored.slice(index, index + TERMINAL_RESTORE_CONCURRENCY);
    await Promise.all(batch.map((session) => {
      const command = isPlausibleSessionId(session.codexSessionId)
        ? buildResumeCommand(session.codexSessionId, accountById(session.accountId))
        : null;
      return startTerminalSession(session, command, false, false);
    }));
    if (activeView === "terminal") render();
  }

  if (eligibleRecords.length > records.length) {
    statusText = `${records.length} terminaux restaures; la limite de la fenetre est atteinte`;
  }
  persistTerminalSessions();
};

const startKombai = async () => {
  kombaiStatusError = false;
  statusText = "Demarrage de Kombai (VS Code embarque)...";
  render();
  try {
    kombaiStatus = await invoke<KombaiStatus>("kombai_start", { projectDir: currentProjectDir() });
    kombaiLoaded = true;
    statusText = kombaiStatus.message ?? "Kombai en cours de demarrage";
  } catch (error) {
    kombaiStatusError = true;
    statusText = String(error);
  }
  render();
  startKombaiPoll();
};

const stopKombai = async () => {
  try {
    kombaiStatus = await invoke<KombaiStatus>("kombai_stop");
    kombaiStatusError = false;
    statusText = "Kombai arrete";
  } catch (error) {
    kombaiStatusError = true;
    statusText = String(error);
  }
  render();
};

const installKombaiExtension = async () => {
  kombaiStatusError = false;
  statusText = "Installation de l'extension Kombai...";
  render();
  try {
    kombaiStatus = await invoke<KombaiStatus>("kombai_install_extension");
    kombaiLoaded = true;
    statusText = kombaiStatus.message ?? "Extension Kombai installee";
  } catch (error) {
    kombaiStatusError = true;
    statusText = String(error);
  }
  render();
};

const reloadKombaiFrame = () => {
  const frame = document.querySelector<HTMLIFrameElement>("#kombaiFrame");
  if (frame) frame.src = frame.src;
};

const testPool = async () => {
  if (!settings) return;
  if (!poolStatus?.running) {
    statusText = "Demarre le pool avant de lancer le test";
    render();
    return;
  }

  const session = activeTerminal();
  if (!session?.running || session.ptyId === null) {
    const accountId = selectedAccountId ?? settings.accounts[0]?.id ?? null;
    if (!accountId) {
      statusText = "Ajoute un compte avant de tester le pool";
      render();
      return;
    }

    selectedAccountId = accountId;
    openNewTerminalModal(null);
    statusText = "Choisis l'environnement du terminal de test, puis relance le test";
    render();
    return;
  }

  const base = poolStatus?.baseUrl ?? `http://localhost:${settings?.pool.port ?? 8787}`;
  const model = settings?.pool.defaultModel ?? "gpt-5-codex";
  const key = settings?.pool.apiKey ? `-H "Authorization: Bearer ${settings.pool.apiKey}" ` : "";
  const cmd = `curl -N ${base}/v1/chat/completions ${key}-H "Content-Type: application/json" -d "{\\"model\\":\\"${model}\\",\\"stream\\":true,\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"ping\\"}]}"`;
  const sent = await sendLine(cmd);
  if (!sent) {
    statusText = "Aucun terminal actif pour lancer le test";
    render();
  }
};

const parseImportPaths = (value: string) =>
  value
    .split(/[\n;,]+/)
    .map((item) => item.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);

const isJsonObjectText = (value: string) => {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
};

const normalizeImportJsonText = (value: string) => {
  const trimmed = value.trim();
  if (isJsonObjectText(trimmed)) return trimmed;

  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === "string" && isJsonObjectText(parsed)) return parsed.trim();
  } catch {
    // Rust will produce the detailed JSON error for malformed pasted content.
  }

  if (
    trimmed.startsWith('"{') ||
    trimmed.startsWith('"[') ||
    trimmed.startsWith('"{\\"') ||
    trimmed.startsWith('"[\\"') ||
    trimmed.startsWith('{\\"') ||
    trimmed.startsWith('[\\"')
  ) {
    return trimmed;
  }

  return null;
};

const finishPoolImport = async (message: string) => {
  selectedAccountId = settings?.defaultAccountId || settings?.accounts[0]?.id || null;
  await refreshPoolAfterAccountChange(message);
};

const importPoolFiles = async () => {
  if (!settings) return;
  readPoolForm();

  if (poolImportPaths.trim().length === 0) {
    statusText = "Colle un blob de session ou un chemin JSON";
    render();
    return;
  }

  try {
    settings = await invoke<AppSettings>("save_settings", { settings });

    const jsonContent = normalizeImportJsonText(poolImportPaths);
    if (jsonContent !== null) {
      settings = await invoke<AppSettings>("import_account_json", { content: jsonContent });
      await finishPoolImport("Compte importe depuis le JSON colle");
      return;
    }

    const paths = parseImportPaths(poolImportPaths);
    if (paths.length === 0) {
      statusText = "Ajoute au moins un chemin JSON";
      render();
      return;
    }

    settings = await invoke<AppSettings>("import_account_docs", { paths });
    await finishPoolImport(`${paths.length} source(s) importee(s) dans le pool`);
  } catch (error) {
    statusText = String(error);
  }

  render();
};

const pickProjectDir = async () => {
  if (!settings) return;

  readSettingsForm();
  const currentDir = selectedAccount()?.projectDir ?? "";

  try {
    const picked = await invoke<string | null>("pick_project_dir", { currentDir });
    if (!picked) {
      statusText = "Selection annulee";
      render();
      return;
    }

    const account = selectedAccount();
    if (!account) return;

    account.projectDir = picked;
    syncSessionsForAccount(account);
    settings.defaultAccountId = selectedAccountId;
    settings = await invoke<AppSettings>("save_settings", { settings });
    statusText = "Environnement projet associe";
  } catch (error) {
    statusText = String(error);
  }

  render();
};

// --- Selecteur de workspace ----------------------------------------------
// Ouvre le choix de l'environnement actif ou celui du terminal en cours de
// creation. Desktop : dialogue natif. Web : navigateur de dossiers du serveur.
const workspacePickerPath = () =>
  userEnvironmentPath(
    workspacePickerTarget === "new-terminal" ? newTerminalWorkspacePath : currentWorkspace(),
  );

const chooseWorkspace = (
  path: string | null,
  target: WorkspacePickerTarget = workspacePickerTarget,
) => {
  const requested = path?.trim() || null;
  const trimmed = userEnvironmentPath(requested);
  if (requested && !trimmed) {
    statusText = "Ce dossier est un workspace technique temporaire et ne peut pas etre ajoute";
    render();
    return;
  }
  if (target === "new-terminal") {
    newTerminalWorkspacePath = trimmed;
    if (trimmed) rememberWorkspace(trimmed);
    statusText = trimmed
      ? `Environnement du nouveau terminal: ${trimmed}`
      : "Choisis un environnement: aucun terminal ne peut utiliser un contexte implicite";
  } else {
    if (trimmed) {
      const returnFocus = takeDialogTrigger("workspace");
      workspaceModalOpen = false;
      void selectEnvironment(trimmed);
      restoreDialogTrigger(returnFocus);
      return;
    }
    setCurrentWorkspace(null);
    setChatWorkspaceFilter(WORKSPACE_ALL);
    pendingChatWorkspace = null;
    terminalFolderFilter = null;
    activeView = "chat";
    startDiscussionsPoll();
    statusText = "Choisis un environnement pour commencer";
  }
  const returnFocus = takeDialogTrigger("workspace");
  workspaceModalOpen = false;
  render();
  restoreDialogTrigger(returnFocus);
};

// Selectionne le workspace cible depuis son groupe lateral. Tous les groupes
// restent affiches ; un workspace reel devient le cwd des prochains chats.
const openFolderTerminals = async (value: string): Promise<void> => {
  const workspace = knownWorkspaces().find((candidate) => candidate.id === value);
  if (!workspace) return;

  setChatWorkspaceFilter(workspace.id);
  setCurrentWorkspace(workspace.path);
  pendingChatWorkspace = null;
  terminalFolderFilter = workspace.path;
  void upsertWorkspaceRegistry(workspace.path);
  activeView = "terminal";
  stopLimitPoll();
  stopUsagePoll();
  stopKombaiPoll();
  stopOrchestrationsPoll();
  stopDiscussionsPoll();
  stopChatSync();
  statusText = `Ouverture de l'environnement ${workspace.label}`;
  render();

  await ensureTerminalsRestored();
  const sessions = terminalSessionsForFolder(workspace.path);
  const current = sessions.find((session) => session.key === activeTerminalKey) ?? sessions[0];
  if (current) activateTerminalSession(current);
  else activeTerminalKey = null;
  terminalFolderFilter = workspace.path;
  const terminalLabel = sessions.length === 1 ? "1 terminal associe" : `${sessions.length} terminaux associes`;
  statusText = `${workspace.label} · ${terminalLabel}`;
  render();
};

const closeExpertChatAndDiscussion = async (pane: ExpertChatPane) => {
  if (!expertChatPanes.includes(pane)) return;
  if (chatTurnIsBusy(pane.turn?.status)) {
    statusText = pane.turn?.status === "finalizing"
      ? "La conversation termine sa synchronisation"
      : "Arretez la reponse avant de fermer ce chat";
    render();
    return;
  }
  const discussion = pane.discussion;
  if (!discussion) {
    closeExpertChatPane(pane);
    return;
  }
  if (discussionHasRunningTurn(discussion)) {
    statusText = "Arretez la reponse avant de supprimer cette discussion";
    render();
    return;
  }

  discussionBusyId = discussion.sessionId;
  let finalStatus: string;
  try {
    const count = await archiveDiscussionById(
      discussion.accountId,
      discussion.sessionId,
      [discussion.rolloutId],
    );
    finalStatus = count > 1
      ? `Chat ferme et discussion archivee (${count} fichiers)`
      : "Chat ferme et discussion archivee";
  } catch (error) {
    finalStatus = `Suppression du chat impossible : ${String(error)}`;
  }
  discussionBusyId = null;
  await refreshDiscussions();
  statusText = finalStatus;
  render();
};

const selectWorkspaceFilter = (value: string) => {
  setChatWorkspaceFilter(value);
  pendingChatWorkspace = null;
  if (value !== WORKSPACE_ALL && value !== WORKSPACE_UNKNOWN) {
    const workspace = knownWorkspaces().find((ws) => ws.id === value);
    if (workspace) {
      setCurrentWorkspace(workspace.path);
      void upsertWorkspaceRegistry(workspace.path);
      statusText = `Environnement actif: ${workspace.label}`;
    }
  } else {
    statusText =
      value === WORKSPACE_UNKNOWN ? "Chats sans environnement" : "Toutes les conversations";
  }
  if (activeView !== "chat") {
    setActiveView("chat");
  } else {
    render();
  }
};

const openWorkspacePicker = async (target: WorkspacePickerTarget = "active") => {
  workspacePickerTarget = target;
  if (isRemoteMode()) {
    rememberDialogTrigger(
      "workspace",
      target === "new-terminal" ? "pickNewTerminalWorkspace" : "wsOpenFolder",
    );
    workspaceModalOpen = true;
    workspaceBrowse = null;
    workspaceBrowseError = "";
    render();
    await loadWorkspaceDir(workspacePickerPath());
    return;
  }

  try {
    const picked = await invoke<string | null>("pick_project_dir", {
      currentDir: workspacePickerPath() ?? "",
    });
    if (picked) {
      chooseWorkspace(picked, target);
      return;
    } else {
      statusText = "Selection annulee";
    }
  } catch (error) {
    statusText = String(error);
  }
  render();
};

const loadWorkspaceDir = async (path: string | null) => {
  workspaceBrowseLoading = true;
  workspaceBrowseError = "";
  render();
  try {
    workspaceBrowse = await invoke<FsListResponse>("list_dir", {
      path: path ?? undefined,
    });
  } catch (error) {
    workspaceBrowseError = String(error);
    workspaceBrowse = null;
  }
  workspaceBrowseLoading = false;
  render();
};

const closeWorkspaceModal = () => {
  const returnFocus = takeDialogTrigger("workspace");
  workspaceModalOpen = false;
  render();
  restoreDialogTrigger(returnFocus);
};

const createPoolTerminal = async () => {
  await ensureTerminalsRestored();
  if (terminalSessions.length >= EXPERT_MAX_TERMINALS) {
    statusText = `Limite atteinte: ${EXPERT_MAX_TERMINALS} terminaux maximum dans une fenetre`;
    render();
    return;
  }
  try {
    const picked = await invoke<AccountProfile>("pool_pick_terminal_account");
    settings = await invoke<AppSettings>("load_settings");
    selectedAccountId = picked.id;
    openNewTerminalModal(null);
    statusText = `Pool -> ${picked.label} · choisis l'environnement avant de demarrer`;
    render();
  } catch (error) {
    statusText = String(error);
    render();
  }
};

const formatPoolTokens = (account: PoolAccountView) => {
  if (!account.hasTokens) return "non";
  const base = account.hasRefreshToken ? "access + refresh" : "access seul";
  return `${base} (${account.oauthClient} client)`;
};

const renderPoolRow = (account: PoolAccountView) => {
  const pending = account.id === pendingDeleteAccountId;
  const actions = pending
    ? `<div class="pool-row-actions">
        <button class="icon-button danger" data-remove-account-confirm="${escapeAttr(account.id)}" title="Retirer du pool (garder les fichiers sur le disque)">
          <i data-lucide="check"></i>
        </button>
        <button class="icon-button danger" data-remove-account-purge="${escapeAttr(account.id)}" title="Retirer ET supprimer l'environnement du disque (irréversible)">
          <i data-lucide="folder-x"></i>
        </button>
        <button class="icon-button" data-remove-account-cancel="${escapeAttr(account.id)}" title="Annuler">
          <i data-lucide="x"></i>
        </button>
      </div>`
    : `<button class="icon-button danger" data-remove-account="${escapeAttr(account.id)}" title="Retirer ce compte du pool">
        <i data-lucide="trash-2"></i>
      </button>`;
  return `
  <tr>
    <td>${escapeHtml(account.label)}</td>
    <td><span class="pool-badge ${account.status}">${escapeHtml(account.status)}</span></td>
    <td>${escapeHtml(account.proxyMasked)}</td>
    <td>${escapeHtml(formatPoolTokens(account))}</td>
    <td>${account.served}</td>
    <td>${account.errors}</td>
    <td class="wrap">${escapeHtml(account.lastError ?? "")}</td>
    <td class="pool-row-actions-cell">${actions}</td>
  </tr>
`;
};

const terminalTitle = (session: TerminalSession) =>
  settings?.accounts.find((account) => account.id === session.accountId)?.label ?? session.title;

const syncSessionsForAccount = (account: AccountProfile) => {
  const proxy = proxyForAccount(account);
  const proxySummary = proxy ? maskProxy(proxy.proxyUrl) : "sans proxy";

  terminalSessions.forEach((session) => {
    if (session.accountId === account.id) {
      session.title = account.label;
      // Le dossier/repo est un instantane du lancement. Modifier le compte ne
      // doit pas reclasser un terminal deja ouvert dans un autre workspace.
      session.proxySummary = proxySummary;
    }
  });
};

// --- Coque mobile : barre haute + navigation basse + tiroir lateral, injectes
// une seule fois hors de #app (comme .eh-bg) pour survivre aux re-render. Les
// controles pilotent directement les fonctions internes (setActiveView,
// modales...) plutot que de simuler des clics : rien a re-binder a chaque rendu.
const syncMobileSheetAccessibility = (open: boolean, focusFirst = false): void => {
  const sheet = document.querySelector<HTMLElement>(".m-sheet");
  const trigger = document.querySelector<HTMLButtonElement>("[data-m='menu']");
  if (sheet) {
    sheet.inert = !open;
    sheet.setAttribute("aria-hidden", open ? "false" : "true");
  }
  trigger?.setAttribute("aria-expanded", open ? "true" : "false");
  if (open && focusFirst) {
    window.requestAnimationFrame(() =>
      sheet?.querySelector<HTMLButtonElement>("[role='menuitem']")?.focus(),
    );
  }
};

const syncMobileDrawerAccessibility = (open: boolean, focusFirst = false): void => {
  const sidebar = document.querySelector<HTMLElement>(".chat-app-sidebar");
  const trigger = document.querySelector<HTMLButtonElement>("[data-m='drawer']");
  const mobile = window.matchMedia("(max-width: 860px)").matches;
  if (sidebar) {
    sidebar.inert = mobile && !open;
    if (mobile) sidebar.setAttribute("aria-hidden", open ? "false" : "true");
    else sidebar.removeAttribute("aria-hidden");
  }
  trigger?.setAttribute("aria-expanded", open ? "true" : "false");
  if (mobile && open && focusFirst) {
    window.requestAnimationFrame(() =>
      sidebar?.querySelector<HTMLButtonElement>("#chatSidebarClose")?.focus(),
    );
  }
};

function closeMobileOverlays(): void {
  const sheetWasOpen = document.body.classList.contains("m-sheet-open");
  const drawerWasOpen = document.body.classList.contains("chat-sidebar-open");
  document.body.classList.remove("m-drawer-open", "m-sheet-open", "chat-sidebar-open");
  syncMobileSheetAccessibility(false);
  syncMobileDrawerAccessibility(false);
  if (sheetWasOpen) {
    document.querySelector<HTMLButtonElement>("[data-m='menu']")?.focus();
  } else if (drawerWasOpen) {
    document.querySelector<HTMLButtonElement>("[data-m='drawer']")?.focus();
  }
}

function mobileViewLabel(view: AppView): string {
  switch (view) {
    case "tasks":
      return "Tâches";
    case "prompts":
      return "Prompts";
    case "scheduled-chat":
      return "Chat planifié";
    case "pool":
      return "Pool";
    case "limits":
      return "Limites";
    case "dashboard":
      return "Stats";
    case "doctolib-lab":
      return "RDV Lab";
    case "autonomous":
      return "Agents autonomes";
    case "orchestration":
      return "Chats orchestrés";
    case "kombai":
      return "Kombai";
    case "discussions":
      return "Discussions";
    case "chat":
      return "Conversation";
    case "history":
      return "Historique";
    case "audit":
      return "Audit";
    case "skills":
      return "Skills";
    case "settings":
      return "Paramètres";
    default:
      return "Terminal";
  }
}

function syncMobileChrome(): void {
  const chrome = document.querySelector(".m-chrome");
  if (!chrome) return;
  const chatContext = activeView === "chat" || activeView === "discussions";
  chrome.classList.toggle("is-chat-context", chatContext);
  chrome.querySelectorAll<HTMLElement>(".m-tab[data-view]").forEach((tab) => {
    const view = tab.getAttribute("data-view");
    const active =
      view === "chat"
        ? chatContext
        : view === "terminal"
          ? activeView === "terminal"
          : activeView === view;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  const title = document.getElementById("mTitle");
  if (title) {
    const session = activeTerminal();
    title.textContent =
      activeView === "chat"
        ? activeExpertChatPane()?.discussion?.title?.trim() ||
          (currentWorkspace() ? workspaceBaseName(currentWorkspace()!) : "Chats")
        : activeView !== "terminal"
        ? mobileViewLabel(activeView)
        : session
          ? terminalTitle(session)
          : "Codex Terminal";
  }
  const newAction = chrome.querySelector<HTMLButtonElement>("[data-m='new']");
  if (newAction) {
    const terminalContext = activeView === "terminal";
    const tasksContext = activeView === "tasks";
    const promptsContext = activeView === "prompts";
    const scheduledChatContext = activeView === "scheduled-chat";
    const available = chatContext
      || terminalContext
      || tasksContext
      || promptsContext
      || scheduledChatContext;
    const label = chatContext
      ? "Ouvrir un nouveau chat"
      : tasksContext
        ? "Ajouter une tâche"
        : promptsContext
          ? "Ajouter un prompt"
          : scheduledChatContext
            ? "Planifier un chat"
            : "Ouvrir un nouveau terminal";
    newAction.setAttribute("aria-label", label);
    newAction.title = label;
    newAction.classList.toggle("is-placeholder", !available);
    newAction.disabled = !available;
    newAction.setAttribute("aria-hidden", available ? "false" : "true");
    newAction.tabIndex = available ? 0 : -1;
  }
  syncMobileDrawerAccessibility(document.body.classList.contains("chat-sidebar-open"));
}

const bindGlobalMobileListeners = () => {
  if (globalMobileListenersBound) return;
  globalMobileListenersBound = true;
  document.addEventListener("click", (event) => {
    if (
      (event.target as HTMLElement).closest(
        "[data-terminal-key],[data-close-terminal],[data-workspace-key],[data-new-terminal-workspace],[data-close-workspace],#newTerminalSide,#workspaceAddSide",
      )
    ) {
      document.body.classList.remove("m-drawer-open");
    }
  });
  document.addEventListener("keydown", (event) => {
    if (
      !document.body.classList.contains("chat-sidebar-open") ||
      !window.matchMedia("(max-width: 860px)").matches ||
      activeModalDialog()
    ) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMobileOverlays();
      return;
    }
    if (event.key !== "Tab") return;
    const sidebar = document.querySelector<HTMLElement>(".chat-app-sidebar");
    const focusable = sidebar ? dialogFocusableElements(sidebar) : [];
    if (!sidebar || !focusable.length) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? current <= 0 ? focusable.length - 1 : current - 1
      : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
    event.preventDefault();
    focusable[next]?.focus();
  });
  const refit = () => {
    window.clearTimeout(mobileRefitTimer);
    mobileRefitTimer = window.setTimeout(() => {
      const mobile = window.matchMedia("(max-width: 860px)").matches;
      if (!mobile) document.body.classList.remove("m-sheet-open");
      syncMobileSheetAccessibility(
        mobile && document.body.classList.contains("m-sheet-open"),
      );
      syncMobileDrawerAccessibility(document.body.classList.contains("chat-sidebar-open"));
      fitAndResizeVisibleTerminals();
    }, 120);
  };
  window.visualViewport?.addEventListener("resize", refit);
  window.addEventListener("resize", refit);
  window.addEventListener("orientationchange", () =>
    window.setTimeout(() => fitAndResizeVisibleTerminals(), 280),
  );
};

function ensureMobileChrome(): void {
  if (typeof document === "undefined" || !document.body) return;
  if (document.querySelector(".m-chrome")) {
    syncMobileChrome();
    return;
  }

  const chrome = document.createElement("div");
  chrome.className = "m-chrome";
  chrome.innerHTML = `
    <header class="m-topbar">
      <button class="m-icon" type="button" data-m="drawer" aria-label="Ouvrir les conversations et l'environnement" aria-expanded="false" aria-controls="chatAppSidebar">
        <i data-lucide="panel-left-open"></i>
      </button>
      <div class="m-title"><strong id="mTitle">Codex Terminal</strong></div>
      <button class="m-icon" type="button" data-m="new" aria-label="Nouveau terminal">
        <i data-lucide="plus"></i>
      </button>
    </header>
    <nav class="m-bottomnav" aria-label="Navigation">
      <button class="m-tab" type="button" data-view="chat"><i data-lucide="messages-square"></i><span>Chats</span></button>
      <button class="m-tab" type="button" data-view="terminal"><i data-lucide="square-terminal"></i><span>Terminal</span></button>
      <button class="m-tab" type="button" data-view="pool"><i data-lucide="users"></i><span>Comptes</span></button>
      <button class="m-tab" type="button" data-view="dashboard"><i data-lucide="bar-chart-3"></i><span>Stats</span></button>
      <button class="m-tab" type="button" data-m="menu" aria-haspopup="menu" aria-expanded="false" aria-controls="mobileActionSheet"><i data-lucide="layout-grid"></i><span>Menu</span></button>
    </nav>
    <div class="m-scrim" data-m="scrim"></div>
    <div class="m-sheet" id="mobileActionSheet" aria-hidden="true" inert>
      <div class="m-sheet-panel" role="menu" aria-label="Plus d'actions">
        <div class="m-sheet-handle"></div>
        <div class="m-sheet-grid">
          <button type="button" role="menuitem" data-view="tasks"><i data-lucide="list-checks"></i><span>Tâches</span></button>
          <button type="button" role="menuitem" data-view="scheduled-chat"><i data-lucide="calendar-clock"></i><span>Chat planifié</span></button>
          <button type="button" role="menuitem" data-view="prompts"><i data-lucide="message-square-text"></i><span>Prompts</span></button>
          <button type="button" role="menuitem" data-view="limits"><i data-lucide="calendar-clock"></i><span>Limites</span></button>
          <button type="button" class="m-autonomous-entry" role="menuitem" data-view="autonomous"><i data-lucide="bot"></i><span><strong>Agents autonomes</strong><small>Création et suivi 24/7</small></span><b>24/7</b></button>
          <button type="button" class="m-orchestration-entry" role="menuitem" data-view="orchestration"><i data-lucide="users"></i><span><strong>Chats orchestrés</strong><small>Plan, preuves et revue</small></span><b>Bêta</b></button>
          <button type="button" role="menuitem" data-view="kombai"><i data-lucide="bot"></i><span>Kombai</span></button>
          <button type="button" role="menuitem" data-view="discussions"><i data-lucide="messages-square"></i><span>Discussions</span></button>
          <button type="button" role="menuitem" data-view="history"><i data-lucide="history"></i><span>Historique</span></button>
          <button type="button" role="menuitem" data-view="skills"><i data-lucide="library"></i><span>Skills</span></button>
          <button type="button" role="menuitem" data-view="audit"><i data-lucide="scan-eye"></i><span>Audit</span></button>
          <button type="button" role="menuitem" data-act="poolTerminal"><i data-lucide="shuffle"></i><span>Pool term</span></button>
          <button type="button" role="menuitem" data-act="agents"><i data-lucide="bot"></i><span>Agents</span></button>
          <button type="button" role="menuitem" data-act="fullscreen"><i data-lucide="maximize-2"></i><span>Plein ecran</span></button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(chrome);

  const gotoView = (view: AppView) => {
    if (view === "terminal") {
      if (activeView !== "terminal") setActiveView("terminal");
    } else if (activeView !== view) {
      setActiveView(view);
    }
    closeMobileOverlays();
    syncMobileChrome();
  };

  chrome.addEventListener("click", (event) => {
    const el = (event.target as HTMLElement).closest<HTMLElement>(
      "[data-m],[data-view],[data-act]",
    );
    if (!el) return;

    const view = el.getAttribute("data-view");
    if (view) {
      gotoView(view as AppView);
      return;
    }

    const act = el.getAttribute("data-act");
    if (act) {
      closeMobileOverlays();
      if (act === "poolTerminal") void createPoolTerminal();
      else if (act === "agents") openAgentsModal();
      else if (act === "fullscreen") void toggleFullscreen();
      return;
    }

    switch (el.getAttribute("data-m")) {
      case "drawer":
        document.body.classList.remove("m-sheet-open");
        document.body.classList.remove("m-drawer-open");
        document.body.classList.toggle("chat-sidebar-open");
        syncMobileSheetAccessibility(false);
        syncMobileDrawerAccessibility(
          document.body.classList.contains("chat-sidebar-open"),
          true,
        );
        break;
      case "new":
        closeMobileOverlays();
        if (activeView === "chat" || activeView === "discussions") openNewChat();
        else if (activeView === "terminal") openNewTerminalModal();
        else if (activeView === "tasks") {
          window.setTimeout(() => document.querySelector<HTMLInputElement>("#taskTitle")?.focus(), 0);
        }
        else if (activeView === "prompts") {
          document.querySelector<HTMLButtonElement>("#promptNewButton")?.click();
        }
        else if (activeView === "scheduled-chat") {
          document.querySelector<HTMLTextAreaElement>("#scheduledChatPrompt")?.focus();
        }
        break;
      case "menu":
        document.body.classList.remove("m-drawer-open", "chat-sidebar-open");
        syncMobileDrawerAccessibility(false);
        document.body.classList.toggle("m-sheet-open");
        syncMobileSheetAccessibility(
          document.body.classList.contains("m-sheet-open"),
          true,
        );
        break;
      case "scrim":
        closeMobileOverlays();
        break;
    }
  });

  chrome.addEventListener("keydown", (event) => {
    if (!document.body.classList.contains("m-sheet-open")) return;
    const items = [
      ...chrome.querySelectorAll<HTMLButtonElement>(".m-sheet [role='menuitem']"),
    ];
    if (!items.length) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMobileOverlays();
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "Tab") {
      next = event.shiftKey
        ? current <= 0 ? items.length - 1 : current - 1
        : current < 0 || current === items.length - 1 ? 0 : current + 1;
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      next = current < 0 || current === items.length - 1 ? 0 : current + 1;
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      next = current <= 0 ? items.length - 1 : current - 1;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = items.length - 1;
    }
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  });

  bindGlobalMobileListeners();

  renderIcons(chrome);
  syncMobileChrome();
}

type ChatWorkspaceSidebarGroup = {
  id: string;
  label: string;
  path: string | null;
  terminals: TerminalSession[];
  discussions: DiscussionSummary[];
};

// Tous les dossiers restent visibles et leurs conversations sont rangees juste
// dessous.
const chatWorkspaceSidebarGroups = (): ChatWorkspaceSidebarGroup[] => {
  const groups = new Map<string, ChatWorkspaceSidebarGroup>();
  const closedIds = closedWorkspaceIds();
  knownWorkspaces().forEach((workspace) => {
    groups.set(workspace.id, {
      id: workspace.id,
      label: workspace.label,
      path: workspace.path,
      terminals: [],
      discussions: [],
    });
  });

  let unknown: ChatWorkspaceSidebarGroup | null = null;
  allDiscussions().forEach((discussion) => {
    const path = discussionFolderPath(discussion);
    if (!path) {
      unknown ??= {
        id: WORKSPACE_UNKNOWN,
        label: "Sans environnement",
        path: null,
        terminals: [],
        discussions: [],
      };
      unknown.discussions.push(discussion);
      return;
    }

    const id = workspaceIdForPath(path);
    if (closedIds.has(id)) return;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: workspaceBaseName(path),
        path,
        terminals: [],
        discussions: [],
      };
      groups.set(id, group);
    }
    group.discussions.push(discussion);
  });

  terminalSessions.forEach((session) => {
    const path = session.folderPath?.trim();
    if (!path) {
      unknown ??= {
        id: WORKSPACE_UNKNOWN,
        label: "Sans environnement",
        path: null,
        terminals: [],
        discussions: [],
      };
      unknown.terminals.push(session);
      return;
    }

    const id = workspaceIdForPath(path);
    if (closedIds.has(id)) return;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        label: workspaceBaseName(path),
        path,
        terminals: [],
        discussions: [],
      };
      groups.set(id, group);
    }
    group.terminals.push(session);
  });

  const result = [...groups.values()];
  if (unknown) result.push(unknown);
  return result;
};

const terminalSearchValues = (session: TerminalSession): string[] => {
  const agent = agentById(session.agentId);
  const account = accountById(session.accountId);
  return [
    terminalTitle(session),
    session.status,
    agent?.label ?? session.agentId,
    account?.label ?? session.accountId,
    session.folderPath ?? "",
    session.workspaceId ?? "",
    session.workspacePath ?? "",
  ];
};

const renderFolderTerminalGroups = (sessions: TerminalSession[]): string => {
  if (!sessions.length) return `<div class="chat-workspace-empty">Aucun terminal</div>`;
  const byAgent = new Map<string, TerminalSession[]>();
  sessions.forEach((session) => {
    const list = byAgent.get(session.agentId) ?? [];
    list.push(session);
    byAgent.set(session.agentId, list);
  });

  return [...byAgent.entries()]
    .map(([agentId, agentSessions]) => {
      const agentLabel = agentById(agentId)?.label ?? agentId;
      const items = agentSessions
        .sort((left, right) => (right.startedAtUnix ?? 0) - (left.startedAtUnix ?? 0))
        .map((session) => {
          const workspaceDetail = session.workspacePath ?? session.folderPath ?? "Dossier en preparation";
          return `<button type="button" class="chat-folder-terminal ${session.key === activeTerminalKey ? "active" : ""}" data-open-folder-terminal="${escapeAttr(session.key)}" title="${escapeAttr(workspaceDetail)}">
            <span class="live-dot ${session.running ? "on" : ""}"></span>
            <span class="chat-folder-terminal-copy">
              <strong>${escapeHtml(terminalTitle(session))}</strong>
              <small>${escapeHtml(session.status)} · ${escapeHtml(workspaceBaseName(workspaceDetail))}</small>
            </span>
            <i data-lucide="square-terminal"></i>
          </button>`;
        })
        .join("");
      return `<section class="chat-folder-agent-group">
        <header><span><i data-lucide="bot"></i>${escapeHtml(agentLabel)}</span><b>${agentSessions.length}</b></header>
        ${items}
      </section>`;
    })
    .join("");
};

const renderChatSidebarConversations = (): string => {
  const query = chatSidebarSearch.trim().toLocaleLowerCase();
  const environmentPath = userEnvironmentPath(currentWorkspace());

  if (!environmentPath) {
    return `<button type="button" class="chat-side-empty chat-side-choose-environment" id="chooseEnvironmentFromSidebar">
      <i data-lucide="folders"></i>
      <strong>Choisir un environnement</strong>
      <small>Les chats et les agents apparaitront ici.</small>
    </button>`;
  }

  if (!discussionsLoaded && terminalSessions.length === 0) {
    return `<div class="chat-side-empty"><span class="chat-loader"></span>Chargement…</div>`;
  }

  const environmentId = workspaceIdForPath(environmentPath);
  const discussions = orderChatSidebarDiscussions(
    allDiscussions()
      .filter((discussion) => {
        const path = discussionFolderPath(discussion);
        return !!path && workspaceIdForPath(path) === environmentId;
      })
      .filter((discussion) => {
        if (!query) return true;
        return [
          discussion.title ?? "",
          discussion.preview ?? "",
          discussion.accountLabel,
          providerLabel(discussion.provider ?? "codex"),
        ].some((value) => value.toLocaleLowerCase().includes(query));
      }),
  );

  const conversationItems = discussions
    .map((discussion) => {
      const openedPane = expertChatPanes.find(
        (pane) => pane.discussion?.sessionId === discussion.sessionId,
      );
      const current = openedPane?.key === activeExpertChatKey;
      const title = discussion.title?.trim() || "Conversation sans titre";
      const busy = discussionBusyId === discussion.sessionId;
      return `<div class="chat-side-item ${openedPane ? "active" : ""} ${current ? "current" : ""} ${busy ? "moving" : ""}" aria-busy="${busy}">
        <button type="button" class="chat-side-open" data-open-chat="${escapeAttr(discussion.sessionId)}" title="${escapeAttr(title)}">
          ${renderChatSidebarStatus(openedPane ?? null, discussion)}
          <i class="chat-side-terminal-icon" data-lucide="message-square"></i>
          <span class="chat-side-copy">
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(discussion.accountLabel)} · ${escapeHtml(providerLabel(discussion.provider ?? "codex"))}</small>
          </span>
        </button>
        <button type="button" class="chat-side-delete" data-delete-session="${escapeAttr(discussion.sessionId)}" title="Supprimer la conversation" aria-label="Supprimer ${escapeAttr(title)}">
          <i data-lucide="trash-2"></i>
        </button>
      </div>`;
    })
    .join("");

  // La grille de chats compte chaque pane ouvert de l'environnement (y compris
  // un nouveau chat sans premier message, ou un chat dont la discussion n'a pas
  // de dossier resolu). La barre laterale doit refleter la meme source de verite
  // sinon elle affiche « Aucun chat » alors qu'un chat est bien actif. La
  // recherche ne cible que les discussions persistees : un brouillon n'a pas
  // encore de texte a filtrer.
  const draftPanes = query
    ? []
    : draftEnvironmentChatPanes(
        expertChatPanesForCurrentEnvironment(),
        discussions.map((discussion) => discussion.sessionId),
      );

  const draftItems = draftPanes
    .map((pane) => {
      const current = pane.key === activeExpertChatKey;
      const account = expertChatSelectedAccount(pane);
      const title = pane.discussion?.title?.trim() || "Nouveau chat";
      const subtitle = account
        ? `${account.label} · ${providerLabel(accountProvider(account))}`
        : "Choisissez un agent";
      return `<div class="chat-side-item active ${current ? "current" : ""}">
        <button type="button" class="chat-side-open" data-open-pane="${escapeAttr(pane.key)}" title="${escapeAttr(title)}">
          ${renderChatSidebarStatus(pane)}
          <i class="chat-side-terminal-icon" data-lucide="message-square-plus"></i>
          <span class="chat-side-copy">
            <strong>${escapeHtml(title)}</strong>
            <small>${escapeHtml(subtitle)}</small>
          </span>
        </button>
        <button type="button" class="chat-side-delete" data-close-pane="${escapeAttr(pane.key)}" title="Fermer ce chat" aria-label="Fermer ${escapeAttr(title)}">
          <i data-lucide="x"></i>
        </button>
      </div>`;
    })
    .join("");

  const totalCount = discussions.length + draftPanes.length;
  const listItems = `${draftItems}${conversationItems}`;

  return `<section class="chat-workspace-group active chat-current-environment-chats">
    <div class="chat-folder-section-label"><span>Chats de cet environnement</span><b>${totalCount}</b></div>
    <div class="chat-workspace-terminals">
      ${listItems || `<div class="chat-workspace-empty">${query ? "Aucun resultat" : "Aucun chat. Ouvrez-en un avec l'agent de votre choix."}</div>`}
    </div>
  </section>`;
};

const refreshChatSidebarConversations = () => {
  if (activeView !== "chat" || draggedChatSessionId) return;
  const host = document.querySelector<HTMLElement>("#chatSideConversations");
  if (!host) return;
  host.innerHTML = renderChatSidebarConversations();
  renderIcons(host);
  bindDiscussionRowUi();
  bindWorkspaceSwitcherUi(host);
};

const activeChatTurnsStatusSignature = (turns: ActiveChatTurnSummary[]): string =>
  JSON.stringify(
    turns.map((turn) => [
      turn.id,
      turn.accountId,
      turn.sessionId ?? null,
      turn.status,
      turn.waitingForUser,
    ]),
  );

const refreshActiveChatTurns = async () => {
  if (activeChatTurnsInFlight) return;
  activeChatTurnsInFlight = true;
  try {
    const next = await invoke<ActiveChatTurnSummary[]>("list_active_chat_turns");
    const nextSidebarSignature = activeChatTurnsStatusSignature(next);
    const sidebarChanged = nextSidebarSignature !== activeChatTurnsSidebarSignature;
    activeChatTurns = next;
    activeChatTurnsSidebarSignature = nextSidebarSignature;

    const visiblePanes = new Set(visibleExpertChatPanes());
    await Promise.allSettled(expertChatPanes.map(async (pane) => {
      const candidate = activeChatTurnForDiscussion(next, pane.discussion);
      if (candidate && shouldAdoptActiveChatTurn(pane.turn, candidate)) {
        if (
          pane.turn?.id !== candidate.id ||
          pane.turn.status !== candidate.status
        ) {
          const snapshot = await invoke<ChatTurnSnapshot>("chat_turn_status", {
            id: candidate.id,
          });
          if (shouldAdoptActiveChatTurn(pane.turn, snapshot)) {
            await applyExpertChatTurnSnapshot(pane, snapshot);
          }
        }
        if (
          visiblePanes.has(pane) &&
          chatTurnIsBusy(pane.turn?.status) &&
          pane.turn?.id !== 0 &&
          pane.turnPoll === null
        ) {
          startExpertChatTurnPoll(pane);
        }
      } else if (
        !candidate &&
        chatTurnIsBusy(pane.turn?.status) &&
        pane.turn?.id !== 0
      ) {
        // Le catalogue actif vient de perdre ce tour : lire une derniere fois
        // son snapshot terminal pour ne pas laisser un panneau hors page en
        // « En cours » apres sa fin.
        await pollExpertChatTurn(pane);
      }
    }));

    if (sidebarChanged) refreshChatSidebarConversations();
  } catch {
    // Une panne de cette reconciliation ne doit jamais effacer un etat local
    // encore suivi individuellement par son poll de tour.
  } finally {
    activeChatTurnsInFlight = false;
  }
};

const stopActiveChatTurnsPoll = () => {
  if (activeChatTurnsPoll !== null) {
    clearInterval(activeChatTurnsPoll);
    activeChatTurnsPoll = null;
  }
};

const startActiveChatTurnsPoll = () => {
  stopActiveChatTurnsPoll();
  void refreshActiveChatTurns();
  activeChatTurnsPoll = window.setInterval(
    () => runWhenPageVisible(() => void refreshActiveChatTurns()),
    1_000,
  );
};

// Signature legere de l'en-tete : evite tout churn DOM au poll quand les
// workspaces et le nombre total de conversations n'ont pas change.
const workspaceSwitcherSignature = (): string => {
  const all = allDiscussions();
  const counts = new Map<string, number>();
  all.forEach((discussion) => {
    const folderPath = discussionFolderPath(discussion);
    if (folderPath) {
      const id = workspaceIdForPath(folderPath);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  });
  const ws = knownWorkspaces()
    .map((workspace) => `${workspace.id}:${counts.get(workspace.id) ?? 0}`)
    .join(",");
  const terminals = terminalSessions
    .map((session) => `${session.key}:${session.folderPath ?? ""}:${session.status}:${session.workspaceId ?? ""}`)
    .join(",");
  return `${all.length}|${ws}|${terminals}`;
};

// Le seul point d'entree pour changer de contexte : le menu d'environnement
// reste separe des conversations de l'environnement actif.
const renderWorkspaceSwitcher = (): string => {
  const environmentPath = userEnvironmentPath(currentWorkspace());
  const environment = environmentPath
    ? knownWorkspaces().find((workspace) => workspace.id === workspaceIdForPath(environmentPath))
    : null;
  const label = environment?.label ?? (environmentPath ? workspaceBaseName(environmentPath) : "Choisir un environnement");
  const detail = environmentPath ?? "Chats et terminaux";

  return `
    <section class="chat-workspace-overview" id="chatWsSwitcher" data-ws-sig="${escapeAttr(workspaceSwitcherSignature())}">
      <button type="button" id="wsOpenFolder" class="chat-environment-selector" title="Changer d'environnement avec la touche accent grave" aria-label="Choisir un environnement">
        <span class="chat-workspace-overview-mark"><i data-lucide="folders"></i></span>
        <span class="chat-workspace-overview-copy">
          <small>Environnement</small>
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(detail)}</small>
        </span>
        <kbd aria-label="Raccourci accent grave">&#96;</kbd>
        <i data-lucide="chevrons-up-down"></i>
      </button>
    </section>`;
};

const formatAutonomousTimestamp = (timestamp: number | null | undefined): string => {
  if (!timestamp) return "Jamais";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
};

const autonomousScheduleInputValue = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const autonomousAgentCanReschedule = (agent: AutonomousAgentSnapshot): boolean =>
  !agent.systemManaged
  && (agent.triggerKind ?? "schedule") === "schedule"
  && agent.status === "active"
  && !autonomousAgentIsRunning(agent);

const renderAutonomousScheduleEditor = (agent: AutonomousAgentSnapshot): string => {
  const now = Date.now() / 1000;
  const fallback = Math.max(
    Math.ceil(now / 60) * 60,
    Math.ceil((agent.nextRunAt ?? now + agent.intervalSeconds) / 60) * 60,
  );
  const value = autonomousScheduleDrafts.get(agent.id) ?? autonomousScheduleInputValue(fallback);
  const min = autonomousScheduleInputValue(Math.ceil(now / 60) * 60);
  const max = autonomousScheduleInputValue(now + 366 * 24 * 60 * 60);
  const intervalSeconds = autonomousFrequencyDrafts.get(agent.id) ?? agent.intervalSeconds;
  const knownInterval = AUTONOMOUS_INTERVAL_OPTIONS.some((option) => option.value === intervalSeconds);
  const intervalOptions = `${knownInterval ? "" : `<option value="${intervalSeconds}">${escapeHtml(`Toutes les ${formatAutonomousInterval(intervalSeconds)} (actuelle)`)}</option>`}${AUTONOMOUS_INTERVAL_OPTIONS.map(
    (option) => `<option value="${option.value}" ${option.value === intervalSeconds ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
  ).join("")}`;
  return `<section class="autonomous-schedule-editor" aria-label="Modifier la prochaine planification">
    <div><span><i data-lucide="calendar-clock"></i></span><div><strong>Planification et fréquence</strong><small>Choisis le prochain passage et le rythme récurrent des cycles suivants.</small></div></div>
    <label><span>Fréquence récurrente</span><select data-autonomous-frequency-input="${escapeAttr(agent.id)}">${intervalOptions}</select></label>
    <label><span>Date et heure</span><input type="datetime-local" min="${escapeAttr(min)}" max="${escapeAttr(max)}" step="60" value="${escapeAttr(value)}" data-autonomous-schedule-input="${escapeAttr(agent.id)}" /></label>
    <div class="autonomous-schedule-editor-actions"><button type="button" class="tool-button primary" data-autonomous-schedule-save="${escapeAttr(agent.id)}"><i data-lucide="check"></i><span>Enregistrer</span></button><button type="button" class="tool-button" data-autonomous-schedule-cancel><span>Annuler</span></button></div>
  </section>`;
};

const autonomousAccountLabel = (agent: AutonomousAgentSnapshot): string =>
  accountById(agent.accountId)?.label ?? agent.accountId;

const selectedAutonomousMonitorAgent = (): AutonomousAgentSnapshot | null => {
  const selected = autonomousAgents.find((agent) => agent.id === autonomousMonitorAgentId);
  if (selected) return selected;
  return autonomousAgents.find((agent) => agent.pendingReview)
    ?? autonomousAgents.find(autonomousAgentIsRunning)
    ?? autonomousAgents.find((agent) => agent.status === "needs_attention")
    ?? autonomousAgents.find((agent) => agent.status === "active")
    ?? autonomousAgents[0]
    ?? null;
};

const autonomousMonitorReviewTitle = (review: AutonomousReviewRequest): string => {
  switch (review.kind) {
    case "approval":
      return "L'agent demande ton autorisation";
    case "decision":
      return "L'agent attend ta décision";
    case "verification":
      return "Une vérification humaine est demandée";
  }
};

const renderAutonomousMonitorTimeline = (agent: AutonomousAgentSnapshot): string => {
  const rows = agent.events
    .slice(-8)
    .reverse()
    .map((event) => `<li class="event-${escapeAttr(event.kind)}">
      <span aria-hidden="true"></span>
      <div><strong>${escapeHtml(event.message)}</strong><time>${escapeHtml(formatAutonomousTimestamp(event.timestamp))}</time></div>
    </li>`)
    .join("");
  return rows
    ? `<section class="autonomous-monitor-timeline"><header><i data-lucide="list-tree"></i><span>Journal en direct</span></header><ol>${rows}</ol></section>`
    : "";
};

const renderAutonomousMonitorReview = (
  agent: AutonomousAgentSnapshot,
  review: AutonomousReviewRequest,
): string => {
  const busy = autonomousBusyId === agent.id;
  const approveLabel = review.externalAction
    ? "Autoriser cette action et reprendre"
    : review.kind === "verification" ? "Valider et reprendre" : "Autoriser et reprendre";
  const rejectLabel = review.kind === "verification" ? "Demander une correction" : "Refuser cette action";
  return `<section class="autonomous-monitor-review review-${escapeAttr(review.kind)}">
    <header>
      <span><i data-lucide="shield-question"></i></span>
      <div><small>${escapeHtml(autonomousReviewKindLabel(review.kind))} requise${review.externalAction ? " · action externe" : ""}</small><h3>${escapeHtml(autonomousMonitorReviewTitle(review))}</h3></div>
    </header>
    <div class="autonomous-monitor-request">
      <small>Ce que l'agent veut faire</small>
      <p>${escapeHtml(review.request)}</p>
    </div>
    ${review.externalAction ? `<p class="autonomous-monitor-external-notice"><i data-lucide="unplug"></i><span>Cette autorisation ne vaut que pour l’action décrite et sera consommée après le prochain tour. Les suppressions restent bloquées.</span></p>` : ""}
    ${agent.lastSummary ? `<details><summary>Contexte fourni par l'agent <i data-lucide="chevron-down"></i></summary><p>${escapeHtml(agent.lastSummary)}</p></details>` : ""}
    <label><span>Instruction complémentaire <small>facultatif</small></span><textarea id="autonomousMonitorInstruction" maxlength="2000" placeholder="Précise une limite, une condition ou le résultat attendu…" ${busy ? "disabled" : ""}>${escapeHtml(autonomousMonitorInstructionDraft)}</textarea></label>
    <div class="autonomous-monitor-review-actions">
      <button type="button" class="tool-button primary" data-autonomous-monitor-review="approveReview" data-autonomous-id="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="check"></i><span>${approveLabel}</span></button>
      <button type="button" class="tool-button" data-autonomous-monitor-review="rejectReview" data-autonomous-id="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="x"></i><span>${rejectLabel}</span></button>
    </div>
  </section>`;
};

const renderAutonomousMonitorLive = (agent: AutonomousAgentSnapshot | null): string => {
  if (!agent) {
    return `<div class="autonomous-monitor-empty"><i data-lucide="bot"></i><strong>Aucun agent autonome</strong><p>Crée un agent pour suivre son travail depuis n'importe quelle page.</p><button type="button" class="tool-button primary" data-autonomous-monitor-page><i data-lucide="plus"></i><span>Créer un agent</span></button></div>`;
  }
  if (agent.pendingReview) return renderAutonomousMonitorReview(agent, agent.pendingReview);

  const turn = autonomousMonitorTurnAgentId === agent.id
    && autonomousMonitorTurn?.id === agent.currentTurnId
    ? autonomousMonitorTurn
    : null;
  const waitingForInput = !!turn?.parts.some(partWaitsForUserInput);
  const liveParts = turn?.parts.length
    ? renderChatTurnParts(
        turn.parts,
        autonomousAccountLabel(agent),
        turn.startedAt,
        turn.finishedAt ?? null,
      )
    : "";
  if (agent.currentTestId != null) {
    return `<section class="autonomous-monitor-stage is-running">
      <header><span class="autonomous-monitor-stage-icon"><i data-lucide="flask-conical"></i></span><div><small>Validation automatique</small><h3>Le test réel est en cours</h3></div><span class="autonomous-monitor-pulse"><i></i><i></i><i></i></span></header>
      ${agent.testCommand ? `<code>${escapeHtml(agent.testCommand)}</code>` : ""}
      <p>Le moteur attend le résultat avant de décider si l'objectif est réellement terminé.</p>
    </section>`;
  }
  if (agent.currentStartId != null || agent.currentTurnId != null) {
    return `<section class="autonomous-monitor-stage is-running">
      <header><span class="autonomous-monitor-stage-icon"><i data-lucide="bot"></i></span><div><small>Activité en direct</small><h3>${waitingForInput ? "L'agent attend une vérification" : agent.currentTurnId != null ? `Tour #${agent.currentTurnId} en cours` : "Démarrage du tour"}</h3></div><span class="autonomous-monitor-pulse"><i></i><i></i><i></i></span></header>
      ${waitingForInput ? `<p class="autonomous-monitor-inline-warning"><i data-lucide="circle-alert"></i><span>Ouvre l'action ci-dessous pour voir exactement ce que l'agent demande.</span></p>` : ""}
      ${liveParts || `<div class="autonomous-monitor-loading"><span></span><p>Connexion au flux d'activité…</p></div>`}
    </section>`;
  }
  if (agent.status === "needs_attention") {
    const busy = autonomousBusyId === agent.id;
    return `<section class="autonomous-monitor-stage needs-attention">
      <header><span class="autonomous-monitor-stage-icon"><i data-lucide="triangle-alert"></i></span><div><small>Intervention nécessaire</small><h3>L'agent ne peut plus avancer seul</h3></div></header>
      <p>${escapeHtml(agent.lastError || "Ajoute une instruction avant de relancer l'agent.")}</p>
      ${agent.lastSummary ? `<div class="autonomous-monitor-summary"><small>Dernier compte rendu</small><p>${escapeHtml(agent.lastSummary)}</p></div>` : ""}
      <label><span>Instruction pour la reprise</span><textarea id="autonomousMonitorInstruction" maxlength="2000" placeholder="Explique comment contourner le blocage…" ${busy ? "disabled" : ""}>${escapeHtml(autonomousMonitorInstructionDraft)}</textarea></label>
      <button type="button" class="tool-button primary" data-autonomous-monitor-action="resume" data-autonomous-id="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="play"></i><span>Ajouter l'instruction et reprendre</span></button>
    </section>`;
  }
  const lastTestTone = agent.testStatus === "passed" ? "passed" : agent.testStatus === "failed" ? "failed" : "idle";
  return `<section class="autonomous-monitor-stage stage-${escapeAttr(agent.status)}">
    <header><span class="autonomous-monitor-stage-icon"><i data-lucide="${agent.status === "completed" ? "badge-check" : agent.status === "paused" ? "pause" : "clock-3"}"></i></span><div><small>${escapeHtml(autonomousStatusLabel(agent.status))}</small><h3>${escapeHtml(formatAutonomousSchedule(agent))}</h3></div></header>
    ${agent.lastSummary ? `<div class="autonomous-monitor-summary"><small>Dernier compte rendu</small><p>${escapeHtml(agent.lastSummary)}</p></div>` : `<p>L'agent n'a pas encore produit de compte rendu.</p>`}
    ${agent.testCommand ? `<details class="autonomous-monitor-test test-${lastTestTone}"><summary><span><i data-lucide="flask-conical"></i>Dernière validation : ${escapeHtml(autonomousTestStatusLabel(agent.testStatus))}</span><i data-lucide="chevron-down"></i></summary><code>${escapeHtml(agent.testCommand)}</code>${agent.lastTestOutput ? `<pre>${escapeHtml(agent.lastTestOutput)}</pre>` : ""}</details>` : ""}
  </section>`;
};

const renderAutonomousMonitor = (): string => {
  if (activeView === "orchestration") return "";
  const attention = autonomousAgents.filter((agent) => agent.pendingReview || agent.status === "needs_attention");
  const running = autonomousAgents.filter(autonomousAgentIsRunning);
  const active = autonomousAgents.filter((agent) => agent.status === "active");
  const selected = selectedAutonomousMonitorAgent();
  const launcherTone = attention.length ? "attention" : running.length ? "running" : active.length ? "active" : "idle";
  const launcherTitle = !autonomousAgentsLoaded
    ? "Chargement des agents"
    : attention.length
      ? `${attention.length} vérification${attention.length > 1 ? "s" : ""} requise${attention.length > 1 ? "s" : ""}`
      : running.length
        ? `${running.length} agent${running.length > 1 ? "s" : ""} travaille${running.length > 1 ? "nt" : ""}`
        : active.length
          ? `${active.length} agent${active.length > 1 ? "s" : ""} actif${active.length > 1 ? "s" : ""}`
          : autonomousAgents.length
            ? "Aucun travail en cours"
            : "Aucun agent configuré";
  const tabs = autonomousAgents.map((agent) => {
    const tone = autonomousStatusTone(agent.status);
    const selectedTab = agent.id === selected?.id;
    return `<button type="button" class="autonomous-monitor-agent-tab tone-${tone} ${selectedTab ? "is-selected" : ""}" data-autonomous-monitor-agent="${escapeAttr(agent.id)}" aria-pressed="${selectedTab}">
      <span><i></i><strong>${escapeHtml(agent.name || agent.objective)}</strong></span>
      <small>${escapeHtml(agent.pendingReview ? autonomousReviewKindLabel(agent.pendingReview.kind) + " requise" : formatAutonomousSchedule(agent))}</small>
    </button>`;
  }).join("");
  const busy = selected && autonomousBusyId === selected.id;
  const deletePending = Boolean(selected && autonomousDeletePendingId === selected.id);
  const lifecycle = selected?.systemManaged
    ? ""
    : selected?.status === "active"
    ? `<button type="button" class="tool-button" data-autonomous-monitor-action="pause" data-autonomous-id="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="pause"></i><span>Pause</span></button>`
    : selected?.status === "paused" || (selected?.status === "needs_attention" && !selected.pendingReview)
      ? `<button type="button" class="tool-button" data-autonomous-monitor-action="resume" data-autonomous-id="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="play"></i><span>Reprendre</span></button>`
      : "";
  const compactToggleLabel = autonomousMonitorCompact
    ? "Agrandir le bouton Agents autonomes"
    : "Réduire le bouton Agents autonomes";
  return `<div id="autonomousMonitorHost" class="autonomous-monitor-host tone-${launcherTone} ${autonomousMonitorOpen ? "is-open" : ""} ${autonomousMonitorCompact ? "is-compact" : ""}">
    <div class="autonomous-monitor-launcher-shell">
      <button id="autonomousMonitorLauncher" type="button" aria-expanded="${autonomousMonitorOpen}" aria-controls="autonomousMonitorWindow" aria-label="Suivre les agents autonomes : ${escapeAttr(launcherTitle)}" title="Suivre les agents autonomes">
        <span class="autonomous-monitor-launcher-mark"><i data-lucide="bot"></i><b></b></span>
        <span class="autonomous-monitor-launcher-copy"><small>Agents autonomes</small><strong>${escapeHtml(launcherTitle)}</strong></span>
        <span class="autonomous-monitor-launcher-count">${attention.length || running.length || active.length || autonomousAgents.length}</span>
      </button>
      <button id="autonomousMonitorCompactToggle" type="button" aria-controls="autonomousMonitorLauncher" aria-pressed="${autonomousMonitorCompact}" aria-label="${compactToggleLabel}" title="${compactToggleLabel}"><i data-lucide="${autonomousMonitorCompact ? "chevron-left" : "chevron-right"}" aria-hidden="true"></i></button>
    </div>
    ${autonomousMonitorOpen ? `<button type="button" class="autonomous-monitor-scrim" data-autonomous-monitor-close aria-label="Fermer le moniteur"></button>
      <aside id="autonomousMonitorWindow" class="autonomous-monitor-window" role="dialog" aria-modal="false" aria-labelledby="autonomousMonitorTitle">
        <header class="autonomous-monitor-head">
          <span class="autonomous-monitor-head-mark"><i data-lucide="activity"></i></span>
          <div><small>Suivi permanent</small><h2 id="autonomousMonitorTitle">Activité des agents</h2></div>
          <span class="autonomous-monitor-global-state"><i></i>${running.length ? `${running.length} en cours` : attention.length ? `${attention.length} à vérifier` : "À jour"}</span>
          <button type="button" class="icon-button" data-autonomous-monitor-close aria-label="Fermer"><i data-lucide="x"></i></button>
        </header>
        ${tabs ? `<nav class="autonomous-monitor-agent-tabs" aria-label="Agents autonomes">${tabs}</nav>` : ""}
        <div class="autonomous-monitor-body">
          ${selected ? `<section class="autonomous-monitor-agent-head">
            <div><span class="autonomous-status status-${autonomousStatusTone(selected.status)}"><i></i>${escapeHtml(autonomousStatusLabel(selected.status))}</span>${selected.systemManaged ? `<span class="autonomous-system-managed"><i data-lucide="shield-check"></i>Géré par le système · contrôle horaire</span>` : ""}${selected.requireUserReview ? `<span class="autonomous-review-policy ${selected.approvedReview ? "is-approved" : ""}"><i data-lucide="shield-check"></i>${selected.approvedReview ? "Application autorisée" : "Review obligatoire"}</span>` : ""}<h3>${escapeHtml(selected.name || selected.objective)}</h3><p>${escapeHtml(selected.objective)}</p></div>
            <dl><div><dt>Compte</dt><dd>${escapeHtml(autonomousAccountLabel(selected))}</dd></div><div><dt>Tours</dt><dd>${selected.runCount}</dd></div><div><dt>Test</dt><dd>${escapeHtml(autonomousTestStatusLabel(selected.testStatus))}</dd></div></dl>
          </section>` : ""}
          ${autonomousMonitorError ? `<p class="autonomous-monitor-error"><i data-lucide="circle-alert"></i><span>${escapeHtml(autonomousMonitorError)}</span></p>` : ""}
          ${selected && autonomousScheduleEditingId === selected.id && autonomousAgentCanReschedule(selected) ? renderAutonomousScheduleEditor(selected) : ""}
          <div id="autonomousMonitorLive">${renderAutonomousMonitorLive(selected)}</div>
          ${selected ? renderAutonomousWorkPlan(selected, true) : ""}
          ${selected ? renderAutonomousMonitorTimeline(selected) : ""}
        </div>
        ${selected && !selected.systemManaged && deletePending ? `<section class="autonomous-monitor-delete-confirm" role="alert">
          <div class="autonomous-monitor-delete-copy"><span><i data-lucide="triangle-alert"></i></span><div><strong>Supprimer « ${escapeHtml(selected.name || selected.objective)} » ?</strong><small>${autonomousAgentIsRunning(selected) ? "Son travail en cours sera arrêté. " : ""}Sa configuration, sa mémoire autonome et son historique d'activité seront supprimés. Aucun chat autonome n'est conservé dans Discussions.</small></div></div>
          <div class="autonomous-monitor-delete-actions">
            <button type="button" class="tool-button danger" data-autonomous-monitor-delete-confirm="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="trash-2"></i><span>Supprimer définitivement</span></button>
            <button type="button" class="tool-button" data-autonomous-monitor-delete-cancel><span>Annuler</span></button>
          </div>
        </section>` : ""}
        <footer class="autonomous-monitor-footer">
          <div>${lifecycle}${selected?.status === "active" && !selected.systemManaged && !autonomousAgentIsRunning(selected) ? `<button type="button" class="tool-button" data-autonomous-monitor-action="runNow" data-autonomous-id="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="refresh-ccw"></i><span>Exécuter</span></button>` : ""}${selected && autonomousAgentCanReschedule(selected) && autonomousScheduleEditingId !== selected.id ? `<button type="button" class="tool-button" data-autonomous-schedule-open="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="calendar-clock"></i><span>Planifier</span></button>` : ""}${selected && !selected.systemManaged && !deletePending ? `<button type="button" class="tool-button danger" data-autonomous-monitor-delete="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="trash-2"></i><span>Supprimer</span></button>` : ""}</div>
          <div>${selected && !selected.systemManaged ? `<button type="button" class="tool-button primary" data-autonomous-orchestrate="${escapeAttr(selected.id)}" ${busy ? "disabled" : ""}><i data-lucide="users"></i><span>Orchestrer</span></button>` : ""}<button type="button" class="tool-button" data-autonomous-monitor-page><i data-lucide="panel-right-open"></i><span>Page complète</span></button></div>
        </footer>
      </aside>` : ""}
  </div>`;
};

const syncAutonomousMonitorLiveUi = () => {
  const live = document.querySelector<HTMLElement>("#autonomousMonitorLive");
  if (!live) return;
  const openDetails = [...live.querySelectorAll<HTMLDetailsElement>("details")]
    .map((details, index) => details.open ? index : -1)
    .filter((index) => index >= 0);
  live.innerHTML = renderAutonomousMonitorLive(selectedAutonomousMonitorAgent());
  const nextDetails = [...live.querySelectorAll<HTMLDetailsElement>("details")];
  openDetails.forEach((index) => {
    if (nextDetails[index]) nextDetails[index].open = true;
  });
  renderIcons(live);
  bindAutonomousMonitorLiveUi();
};

const syncAutonomousMonitorUi = () => {
  const host = document.querySelector<HTMLElement>("#autonomousMonitorHost");
  if (!host) return;
  const bodyScroll = host.querySelector<HTMLElement>(".autonomous-monitor-body")?.scrollTop ?? 0;
  host.outerHTML = renderAutonomousMonitor();
  const next = document.querySelector<HTMLElement>("#autonomousMonitorHost");
  if (!next) return;
  renderIcons(next);
  bindAutonomousMonitorUi();
  const body = next.querySelector<HTMLElement>(".autonomous-monitor-body");
  if (body) body.scrollTop = bodyScroll;
  if (autonomousMonitorOpen) startAutonomousMonitorTurnPoll();
};

const openAutonomousMonitor = (agentId?: string | null) => {
  autonomousMonitorAgentId = agentId
    ?? selectedAutonomousMonitorAgent()?.id
    ?? null;
  autonomousMonitorOpen = true;
  autonomousMonitorError = "";
  syncAutonomousMonitorUi();
};

const closeAutonomousMonitor = () => {
  autonomousMonitorOpen = false;
  autonomousMonitorError = "";
  stopAutonomousMonitorTurnPoll();
  autonomousMonitorTurn = null;
  autonomousMonitorTurnAgentId = null;
  autonomousMonitorTurnSignature = "";
  syncAutonomousMonitorUi();
  document.querySelector<HTMLButtonElement>("#autonomousMonitorLauncher")?.focus();
};

const controlAutonomousAgentFromMonitor = async (
  id: string,
  action: AutonomousAgentAction,
) => {
  if (autonomousBusyId) return;
  if (autonomousAgents.find((agent) => agent.id === id)?.systemManaged) return;
  autonomousBusyId = id;
  autonomousMonitorError = "";
  syncAutonomousMonitorUi();
  try {
    const instruction = autonomousMonitorInstructionDraft.trim();
    if (instruction) {
      const withMemory = await invoke<AutonomousAgentSnapshot>("add_autonomous_agent_memory", {
        id,
        content: instruction,
      });
      updateAutonomousAgentLocally(withMemory);
    }
    const updated = await invoke<AutonomousAgentSnapshot>("control_autonomous_agent", { id, action });
    updateAutonomousAgentLocally(updated);
    autonomousMonitorInstructionDraft = "";
    statusText = action === "approveReview"
      ? "Demande autorisée ; l'agent reprend son travail"
      : action === "rejectReview"
        ? "Demande refusée ; l'agent cherche une alternative"
        : action === "pause"
          ? "Agent autonome mis en pause"
          : action === "resume"
            ? "Agent autonome repris"
            : "Exécution autonome planifiée";
  } catch (error) {
    autonomousMonitorError = String(error);
  } finally {
    autonomousBusyId = null;
    if (activeView === "autonomous") render();
    else syncAutonomousMonitorUi();
    void refreshAutonomousAgents();
  }
};

const removeAutonomousAgentLocally = (id: string): void => {
  autonomousAgents = autonomousAgents.filter((agent) => agent.id !== id);
  autonomousAgentsSignature = JSON.stringify(autonomousAgents);
  autonomousAgentsLoaded = true;
  autonomousMemoryDrafts.delete(id);
  autonomousScheduleDrafts.delete(id);
  autonomousFrequencyDrafts.delete(id);
  if (autonomousScheduleEditingId === id) autonomousScheduleEditingId = null;
  if (autonomousEditingId === id) closeAutonomousAgentEditor();
  autonomousDeletePendingId = null;
  if (autonomousMonitorAgentId === id) autonomousMonitorAgentId = null;
  if (autonomousMonitorTurnAgentId === id) {
    stopAutonomousMonitorTurnPoll();
    autonomousMonitorTurn = null;
    autonomousMonitorTurnAgentId = null;
    autonomousMonitorTurnSignature = "";
  }
};

const deleteAutonomousAgent = async (id: string) => {
  if (autonomousBusyId) return;
  if (autonomousAgents.find((agent) => agent.id === id)?.systemManaged) return;
  autonomousBusyId = id;
  autonomousMonitorError = "";
  if (activeView === "autonomous") render();
  else syncAutonomousMonitorUi();
  try {
    await invoke("delete_autonomous_agent", { id });
    removeAutonomousAgentLocally(id);
    statusText = "Agent autonome supprimé";
  } catch (error) {
    const message = String(error);
    autonomousMonitorError = message;
    statusText = message;
  } finally {
    autonomousBusyId = null;
    if (activeView === "autonomous") render();
    else syncAutonomousMonitorUi();
    void refreshAutonomousAgents();
  }
};

const renderAutonomousSchedulingState = () => {
  if (activeView === "autonomous") render();
  else syncAutonomousMonitorUi();
};

const openAutonomousScheduleEditor = (id: string) => {
  const agent = autonomousAgents.find((candidate) => candidate.id === id);
  if (!agent || !autonomousAgentCanReschedule(agent)) return;
  const now = Date.now() / 1000;
  const next = Math.max(
    Math.ceil(now / 60) * 60,
    Math.ceil((agent.nextRunAt ?? now + agent.intervalSeconds) / 60) * 60,
  );
  autonomousScheduleEditingId = id;
  autonomousScheduleDrafts.set(id, autonomousScheduleInputValue(next));
  autonomousFrequencyDrafts.set(id, agent.intervalSeconds);
  autonomousMonitorError = "";
  renderAutonomousSchedulingState();
};

const saveAutonomousSchedule = async (id: string) => {
  if (autonomousBusyId) return;
  const input = Array.from(document.querySelectorAll<HTMLInputElement>("[data-autonomous-schedule-input]"))
    .find((candidate) => candidate.dataset.autonomousScheduleInput === id);
  const value = autonomousScheduleDrafts.get(id) ?? input?.value ?? "";
  const frequencyInput = Array.from(document.querySelectorAll<HTMLSelectElement>("[data-autonomous-frequency-input]"))
    .find((candidate) => candidate.dataset.autonomousFrequencyInput === id);
  const intervalSeconds = autonomousFrequencyDrafts.get(id) ?? Number(frequencyInput?.value);
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 7 * 24 * 60 * 60) {
    frequencyInput?.setCustomValidity("Choisis une fréquence entre une minute et sept jours.");
    frequencyInput?.reportValidity();
    return;
  }
  const milliseconds = new Date(value).getTime();
  if (!value || !Number.isFinite(milliseconds)) {
    input?.setCustomValidity("Choisis une date et une heure valides.");
    input?.reportValidity();
    return;
  }
  const nextRunAt = Math.floor(milliseconds / 1000);
  if (nextRunAt < Date.now() / 1000 - 60) {
    input?.setCustomValidity("Choisis une heure future.");
    input?.reportValidity();
    return;
  }
  if (nextRunAt > Date.now() / 1000 + 366 * 24 * 60 * 60) {
    input?.setCustomValidity("Choisis une date dans l'année à venir.");
    input?.reportValidity();
    return;
  }
  autonomousBusyId = id;
  autonomousMonitorError = "";
  renderAutonomousSchedulingState();
  try {
    const updated = await invoke<AutonomousAgentSnapshot>("schedule_autonomous_agent", { id, nextRunAt, intervalSeconds });
    updateAutonomousAgentLocally(updated);
    autonomousScheduleEditingId = null;
    autonomousScheduleDrafts.delete(id);
    autonomousFrequencyDrafts.delete(id);
    statusText = `Fréquence réglée toutes les ${formatAutonomousInterval(updated.intervalSeconds)} · prochaine exécution le ${formatAutonomousTimestamp(updated.nextRunAt)}`;
  } catch (error) {
    const message = String(error);
    autonomousMonitorError = message;
    statusText = message;
  } finally {
    autonomousBusyId = null;
    renderAutonomousSchedulingState();
    void refreshAutonomousAgents();
  }
};

const bindAutonomousScheduleUi = (root: ParentNode | null) => {
  if (!root) return;
  root.querySelectorAll<HTMLButtonElement>("[data-autonomous-schedule-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousScheduleOpen;
      if (id) openAutonomousScheduleEditor(id);
    });
  });
  root.querySelectorAll<HTMLInputElement>("[data-autonomous-schedule-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const id = input.dataset.autonomousScheduleInput;
      if (id) autonomousScheduleDrafts.set(id, input.value);
      input.setCustomValidity("");
    });
  });
  root.querySelectorAll<HTMLSelectElement>("[data-autonomous-frequency-input]").forEach((select) => {
    select.addEventListener("change", () => {
      const id = select.dataset.autonomousFrequencyInput;
      if (id) autonomousFrequencyDrafts.set(id, Number(select.value));
      select.setCustomValidity("");
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-autonomous-schedule-save]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousScheduleSave;
      if (id) void saveAutonomousSchedule(id);
    });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-autonomous-schedule-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      if (autonomousScheduleEditingId) autonomousScheduleDrafts.delete(autonomousScheduleEditingId);
      if (autonomousScheduleEditingId) autonomousFrequencyDrafts.delete(autonomousScheduleEditingId);
      autonomousScheduleEditingId = null;
      renderAutonomousSchedulingState();
    });
  });
};

const bindAutonomousMonitorLiveUi = () => {
  document.querySelector<HTMLTextAreaElement>("#autonomousMonitorInstruction")?.addEventListener("input", (event) => {
    autonomousMonitorInstructionDraft = (event.currentTarget as HTMLTextAreaElement).value;
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-review]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousId;
      const action = button.dataset.autonomousMonitorReview as AutonomousAgentAction | undefined;
      if (id && action) void controlAutonomousAgentFromMonitor(id, action);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("#autonomousMonitorLive [data-autonomous-monitor-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousId;
      const action = button.dataset.autonomousMonitorAction as AutonomousAgentAction | undefined;
      if (id && action) void controlAutonomousAgentFromMonitor(id, action);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("#autonomousMonitorLive [data-autonomous-monitor-page]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousMonitorOpen = false;
      stopAutonomousMonitorTurnPoll();
      setActiveView("autonomous");
    });
  });
};

const bindAutonomousMonitorUi = () => {
  document.querySelector<HTMLButtonElement>("#autonomousMonitorLauncher")?.addEventListener("click", () => openAutonomousMonitor());
  document.querySelector<HTMLButtonElement>("#autonomousMonitorCompactToggle")?.addEventListener("click", () => {
    autonomousMonitorCompact = !autonomousMonitorCompact;
    localStorage.setItem(AUTONOMOUS_MONITOR_COMPACT_STORAGE_KEY, autonomousMonitorCompact ? "1" : "0");
    syncAutonomousMonitorUi();
    document.querySelector<HTMLButtonElement>("#autonomousMonitorCompactToggle")?.focus();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-close]").forEach((button) => {
    button.addEventListener("click", closeAutonomousMonitor);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-agent]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousMonitorAgentId = button.dataset.autonomousMonitorAgent ?? null;
      autonomousMonitorInstructionDraft = "";
      autonomousMonitorError = "";
      autonomousMonitorTurn = null;
      autonomousMonitorTurnAgentId = null;
      autonomousMonitorTurnSignature = "";
      syncAutonomousMonitorUi();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousDeletePendingId = button.dataset.autonomousMonitorDelete ?? null;
      autonomousMonitorError = "";
      syncAutonomousMonitorUi();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-delete-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousDeletePendingId = null;
      syncAutonomousMonitorUi();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-delete-confirm]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousMonitorDeleteConfirm;
      if (id) void deleteAutonomousAgent(id);
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".autonomous-monitor-footer [data-autonomous-monitor-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousId;
      const action = button.dataset.autonomousMonitorAction as AutonomousAgentAction | undefined;
      if (id && action) void controlAutonomousAgentFromMonitor(id, action);
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".autonomous-monitor-window [data-autonomous-monitor-page]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousMonitorOpen = false;
      stopAutonomousMonitorTurnPoll();
      setActiveView("autonomous");
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".autonomous-monitor-window [data-autonomous-orchestrate]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousOrchestrate;
      if (id) openAutonomousOrchestrationPromotion(id);
    });
  });
  bindAutonomousMonitorLiveUi();
  bindAutonomousScheduleUi(document.querySelector("#autonomousMonitorWindow"));
};

const renderAutonomousWorkPlan = (
  agent: AutonomousAgentSnapshot,
  compact = false,
): string => {
  const workItems = agent.workItems ?? [];
  const progress = autonomousWorkPlanProgress({ workItems });
  const nextTask = workItems.find((item) => item.id === agent.nextTaskId);
  const statusRank = { in_progress: 0, todo: 1, blocked: 2, done: 3, cancelled: 4 } as const;
  const ordered = workItems
    .slice()
    .sort((left, right) => {
      if (left.id === agent.nextTaskId) return -1;
      if (right.id === agent.nextTaskId) return 1;
      return statusRank[left.status] - statusRank[right.status];
    });
  const visible = compact ? ordered.slice(0, 4) : ordered;
  const rows = visible
    .map((item) => {
      const selected = item.id === agent.nextTaskId;
      const icon = item.status === "done"
        ? "check"
        : item.status === "blocked"
          ? "triangle-alert"
          : item.status === "cancelled"
            ? "ban"
            : item.status === "in_progress"
              ? "loader-circle"
              : "circle";
      return `<li class="status-${escapeAttr(item.status)} ${selected ? "is-next" : ""}">
        <span class="autonomous-work-plan-state"><i data-lucide="${icon}"></i></span>
        <div><small>${escapeHtml(item.domain)} · ${escapeHtml(autonomousWorkItemStatusLabel(item.status))}${selected ? " · Prochaine tâche" : ""}</small><strong>${escapeHtml(item.description)}</strong>${item.evidence ? `<p><i data-lucide="badge-check"></i>${escapeHtml(item.evidence)}</p>` : ""}</div>
      </li>`;
    })
    .join("");
  const hidden = compact && ordered.length > visible.length
    ? `<small class="autonomous-work-plan-hidden">+${ordered.length - visible.length} autre${ordered.length - visible.length > 1 ? "s" : ""} tâche${ordered.length - visible.length > 1 ? "s" : ""}</small>`
    : "";
  return `<section class="autonomous-work-plan ${compact ? "is-compact" : ""}">
    <header><span><i data-lucide="list-checks"></i></span><div><small>Carnet persistant</small><strong>Plan de travail</strong></div><b>${progress.total ? `${progress.done}/${progress.total} faites` : "À structurer"}</b></header>
    ${agent.memoryStrategy ? `<p class="autonomous-memory-strategy"><i data-lucide="brain-circuit"></i><span><small>Stratégie de mémoire</small>${escapeHtml(agent.memoryStrategy)}</span></p>` : `<p class="autonomous-work-plan-empty"><i data-lucide="sparkles"></i>L'agent définira sa stratégie de mémoire et ses domaines au premier tour.</p>`}
    ${nextTask ? `<div class="autonomous-next-task"><small>Prochaine boucle</small><strong>${escapeHtml(nextTask.domain)} · ${escapeHtml(nextTask.description)}</strong></div>` : ""}
    ${rows ? `<ul>${rows}</ul>${hidden}` : `<p class="autonomous-work-plan-empty"><i data-lucide="list-plus"></i>Aucun domaine planifié pour le moment.</p>`}
  </section>`;
};

const autonomousAgentEditDraftFromSnapshot = (
  agent: AutonomousAgentSnapshot,
): AutonomousAgentEditDraft => {
  const account = accountById(agent.accountId);
  const model = agent.model?.trim() || accountModel(account);
  return {
    name: agent.name,
    objective: agent.objective,
    role: agent.role?.trim() ?? "",
    accountId: agent.accountId,
    projectDir: agent.projectDir?.trim() ?? "",
    mode: agent.mode,
    model,
    reasoningEffort: accountProvider(account) === "codex"
      ? reasoningEffortForChatModel(account, model, agent.reasoningEffort)
      : "",
    connectors: normalizeAutonomousConnectors(agent.connectors),
    intervalSeconds: agent.intervalSeconds,
    triggerKind: agent.triggerKind ?? "schedule",
    watchPaths: (agent.watchPaths ?? []).join("\n"),
    debounceSeconds: agent.debounceSeconds ?? 10,
    allowGitPublish: !!agent.allowGitPublish,
    requireUserReview: !!agent.requireUserReview,
    testCommand: agent.testCommand?.trim() ?? "",
    testTimeoutSeconds: agent.testTimeoutSeconds ?? 5 * 60,
    activate: false,
  };
};

const renderAutonomousAgentEditor = (
  agent: AutonomousAgentSnapshot,
  draft: AutonomousAgentEditDraft,
  busy: boolean,
): string => {
  const account = accountById(draft.accountId);
  const provider = accountProvider(account);
  const connectorsSupported = !!account && provider === "codex";
  const disabled = busy ? "disabled" : "";
  const intervalMinutes = Number((Math.max(60, draft.intervalSeconds) / 60).toFixed(2));
  const environmentListId = `autonomousEditEnvironments-${agent.id}`;
  const environmentOptions = knownWorkspaces()
    .map((workspace) => `<option value="${escapeAttr(workspace.path)}">${escapeHtml(workspace.label)}</option>`)
    .join("");
  const modelSuggestions = (provider === "claude" ? CLAUDE_MODEL_SUGGESTIONS : CODEX_MODEL_SUGGESTIONS)
    .map((model) => `<option value="${escapeAttr(model)}"></option>`)
    .join("");
  const effortValues = provider === "codex"
    ? chatReasoningEffortOptions(account, draft.model)
    : [];
  if (
    provider === "codex"
    && draft.reasoningEffort
    && !effortValues.some((option) => option.value === draft.reasoningEffort)
  ) {
    effortValues.push({
      value: draft.reasoningEffort,
      label: reasoningEffortLabel(draft.reasoningEffort),
    });
  }
  const connectorOptions = AUTONOMOUS_CONNECTORS.map(
    (connector) => `<label class="autonomous-agent-edit-connector ${draft.connectors.includes(connector.id) ? "is-selected" : ""}">
      <input type="checkbox" data-autonomous-edit-connector="${escapeAttr(connector.id)}" ${draft.connectors.includes(connector.id) ? "checked" : ""} ${connectorsSupported ? disabled : "disabled"} />
      <span><i data-lucide="${escapeAttr(connector.icon)}"></i><span><strong>${escapeHtml(connector.label)}</strong><small>${escapeHtml(connector.description)}</small></span></span>
    </label>`,
  ).join("");
  const runningNotice = autonomousAgentIsRunning(agent)
    ? "Le cycle en cours sera arrêté proprement, la configuration sera enregistrée, puis l’agent reprendra automatiquement."
    : agent.status === "active"
      ? "La nouvelle configuration sera utilisée dès le prochain cycle."
      : "L’agent restera arrêté tant que tu ne demandes pas sa reprise.";

  return `<section class="autonomous-agent-editor" aria-label="Modifier ${escapeAttr(agent.name || agent.objective)}">
    <header>
      <span><i data-lucide="settings-2"></i></span>
      <div><small>Configuration complète</small><strong>Modifier l’agent autonome</strong><p>${escapeHtml(runningNotice)}</p></div>
      <button type="button" class="icon-button" data-autonomous-edit-cancel title="Fermer sans enregistrer" aria-label="Fermer sans enregistrer" ${disabled}><i data-lucide="x"></i></button>
    </header>
    <form data-autonomous-edit-form="${escapeAttr(agent.id)}">
      <div class="autonomous-agent-edit-grid">
        <label><span>Nom</span><input data-autonomous-edit-field="name" maxlength="120" value="${escapeAttr(draft.name)}" placeholder="Nom court de l’agent" ${disabled} /></label>
        <label><span>Compte d’exécution</span><select data-autonomous-edit-field="accountId" ${settings?.accounts.length && !busy ? "" : "disabled"}>${orchestrationAccountOptions(draft.accountId)}</select></label>
        <label class="autonomous-agent-edit-role"><span>Rôle / spécialité</span><textarea data-autonomous-edit-field="role" maxlength="4000" placeholder="Responsabilités, expertise et limites" ${disabled}>${escapeHtml(draft.role)}</textarea></label>
        <label class="autonomous-agent-edit-objective"><span>Objectif <small>obligatoire</small></span><textarea data-autonomous-edit-field="objective" maxlength="32768" required placeholder="Résultat durable à poursuivre" ${disabled}>${escapeHtml(draft.objective)}</textarea></label>
        <label class="autonomous-agent-edit-project"><span>Environnement / dossier projet</span><input data-autonomous-edit-field="projectDir" list="${escapeAttr(environmentListId)}" value="${escapeAttr(draft.projectDir)}" placeholder="Aucun, ou chemin du projet" ${disabled} /><datalist id="${escapeAttr(environmentListId)}">${environmentOptions}</datalist></label>
        <label><span>Mode</span><select data-autonomous-edit-field="mode" ${disabled}><option value="build" ${draft.mode === "build" ? "selected" : ""}>Construire et modifier</option><option value="plan" ${draft.mode === "plan" ? "selected" : ""}>Analyser et planifier</option><option value="ask" ${draft.mode === "ask" ? "selected" : ""}>Conseiller uniquement</option></select></label>
        <label><span>Déclenchement</span><select data-autonomous-edit-field="triggerKind" ${disabled}><option value="schedule" ${draft.triggerKind === "schedule" ? "selected" : ""}>Planning récurrent</option><option value="workspace_change" ${draft.triggerKind === "workspace_change" ? "selected" : ""}>Modification du projet</option></select></label>
        ${draft.triggerKind === "schedule"
          ? `<label><span>Fréquence</span><span class="autonomous-agent-edit-unit"><input data-autonomous-edit-field="intervalMinutes" type="number" min="1" max="10080" step="any" required value="${intervalMinutes}" ${disabled} /><small>minutes</small></span></label>`
          : `<label><span>Stabilisation</span><span class="autonomous-agent-edit-unit"><input data-autonomous-edit-field="debounceSeconds" type="number" min="2" max="600" step="1" required value="${draft.debounceSeconds}" ${disabled} /><small>secondes</small></span></label>`}
        <label><span>Modèle</span><input data-autonomous-edit-field="model" list="autonomousEditModels-${escapeAttr(agent.id)}" maxlength="160" required value="${escapeAttr(draft.model)}" placeholder="${provider === "claude" ? "sonnet" : DEFAULT_CODEX_MODEL}" ${disabled} /><datalist id="autonomousEditModels-${escapeAttr(agent.id)}">${modelSuggestions}</datalist></label>
        ${provider === "codex" ? `<label><span>Effort de raisonnement</span><select data-autonomous-edit-field="reasoningEffort" ${disabled}>${effortValues.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === draft.reasoningEffort ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>` : `<div class="autonomous-agent-edit-readonly"><span>Effort de raisonnement</span><small>Géré directement par Claude Code.</small></div>`}
      </div>

      ${draft.triggerKind === "workspace_change" ? `<section class="autonomous-agent-edit-trigger">
        <header><i data-lucide="bell-ring"></i><span><strong>Agent dormant déclenché par événement</strong><small>L’empreinte actuelle devient la référence ; seuls les changements futurs et stables réveillent l’agent.</small></span></header>
        <label><span>Fichiers et dossiers surveillés <small>un chemin relatif par ligne</small></span><textarea data-autonomous-edit-field="watchPaths" maxlength="8000" required placeholder="src&#10;public&#10;package.json" ${disabled}>${escapeHtml(draft.watchPaths)}</textarea></label>
        <label class="autonomous-review-toggle autonomous-agent-edit-review autonomous-publish-toggle">
          <input data-autonomous-edit-field="allowGitPublish" type="checkbox" ${draft.allowGitPublish ? "checked" : ""} ${disabled} />
          <span><strong>Autoriser le push GitHub et la publication du site</strong><small>Exige une branche propre avec <code>origin</code> ; autorise uniquement un push sans force du dépôt courant et les commandes de déploiement prévues.</small></span>
          <i data-lucide="git-branch"></i>
        </label>
      </section>` : ""}

      <fieldset class="autonomous-agent-edit-connectors ${connectorsSupported ? "" : "is-disabled"}">
        <legend>Services externes</legend>
        <div>${connectorOptions}</div>
        <small>${connectorsSupported ? "Les accès restent propres à cet agent ; les écritures externes demandent toujours une autorisation." : "Les connecteurs Gmail et Google Agenda nécessitent un compte Codex."}</small>
      </fieldset>

      <label class="autonomous-review-toggle autonomous-agent-edit-review">
        <input data-autonomous-edit-field="requireUserReview" type="checkbox" ${draft.requireUserReview ? "checked" : ""} ${disabled} />
        <span><strong>Review utilisateur avant d’appliquer les changements</strong><small>L’agent prépare son plan, puis attend ton autorisation avant toute modification.</small></span>
        <i data-lucide="shield-check"></i>
      </label>

      <div class="autonomous-agent-edit-validation">
        <label><span>Commande de validation</span><textarea data-autonomous-edit-field="testCommand" maxlength="8000" placeholder="Ex. npm test && npm run build" ${disabled}>${escapeHtml(draft.testCommand)}</textarea></label>
        <label><span>Timeout</span><span class="autonomous-agent-edit-unit"><input data-autonomous-edit-field="testTimeoutSeconds" type="number" min="5" max="1800" step="1" required value="${draft.testTimeoutSeconds}" ${disabled} /><small>secondes</small></span></label>
      </div>

      ${agent.status !== "active" ? `<label class="autonomous-agent-edit-activate"><input data-autonomous-edit-field="activate" type="checkbox" ${draft.activate ? "checked" : ""} ${disabled} /><span><strong>Reprendre après l’enregistrement</strong><small>${agent.status === "completed" ? "Pour un agent terminé, modifie aussi l’objectif afin de démarrer une nouvelle mission." : draft.triggerKind === "workspace_change" ? "La veille sera réarmée et attendra la prochaine modification stable." : "La prochaine boucle démarrera immédiatement avec cette configuration."}</small></span></label>` : ""}

      <footer>
        <small><i data-lucide="triangle-alert"></i>Modifier l’objectif réinitialise le plan de travail, la review en attente et le dernier résultat.</small>
        <span><button type="button" class="tool-button" data-autonomous-edit-cancel ${disabled}><span>Annuler</span></button><button type="submit" class="tool-button primary" ${disabled}><i data-lucide="save"></i><span>${busy ? "Enregistrement…" : "Enregistrer les modifications"}</span></button></span>
      </footer>
    </form>
  </section>`;
};

const renderAutonomousAgentCard = (agent: AutonomousAgentSnapshot): string => {
  const busy = autonomousBusyId === agent.id;
  const systemManaged = Boolean(agent.systemManaged);
  const eventTriggered = (agent.triggerKind ?? "schedule") === "workspace_change";
  const running = autonomousAgentIsRunning(agent);
  const editDraft = autonomousEditingId === agent.id ? autonomousEditDraft : null;
  const tone = autonomousStatusTone(agent.status);
  const testStatus = agent.testStatus ?? (agent.testCommand ? "idle" : "not_configured");
  const memories = agent.memory ?? [];
  const workPlanProgress = autonomousWorkPlanProgress({ workItems: agent.workItems ?? [] });
  const connectors = normalizeAutonomousConnectors(agent.connectors);
  const connectorBadges = connectors
    .map((id) => {
      const definition = AUTONOMOUS_CONNECTORS.find((connector) => connector.id === id);
      return `<span><i data-lucide="${escapeAttr(definition?.icon ?? "unplug")}"></i>${escapeHtml(autonomousConnectorLabel(id))}</span>`;
    })
    .join("");
  const events = agent.events
    .slice(-4)
    .reverse()
    .map(
      (event) => `<li>
        <time>${escapeHtml(formatAutonomousTimestamp(event.timestamp))}</time>
        <span>${escapeHtml(event.message)}</span>
      </li>`,
    )
    .join("");
  const memoryRows = memories
    .slice()
    .reverse()
    .map(
      (entry) => `<li>
        <span class="autonomous-memory-kind kind-${entry.kind}">${escapeHtml(autonomousMemoryKindLabel(entry.kind))}</span>
        <p>${escapeHtml(entry.content)}</p>
        ${systemManaged ? "" : `<button type="button" class="icon-button danger" data-autonomous-memory-delete="${escapeAttr(entry.id)}" data-autonomous-id="${escapeAttr(agent.id)}" title="Supprimer ce souvenir" ${busy ? "disabled" : ""}><i data-lucide="x"></i></button>`}
      </li>`,
    )
    .join("");
  const memoryDraft = autonomousMemoryDrafts.get(agent.id) ?? "";
  const deletePending = autonomousDeletePendingId === agent.id;
  const lifecycleAction = systemManaged
    ? ""
    : agent.status === "active"
    ? `<button type="button" class="tool-button" data-autonomous-action="pause" data-autonomous-id="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="pause"></i><span>Pause</span></button>`
    : agent.pendingReview
      ? `<button type="button" class="tool-button primary" data-autonomous-monitor-open="${escapeAttr(agent.id)}"><i data-lucide="shield-question"></i><span>Examiner la demande</span></button>`
      : agent.status === "paused" || agent.status === "needs_attention"
      ? `<button type="button" class="tool-button primary" data-autonomous-action="resume" data-autonomous-id="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="play"></i><span>Reprendre</span></button>`
      : "";
  const deleteAction = systemManaged
    ? ""
    : deletePending
    ? `<span class="autonomous-delete-confirm">
        <button type="button" class="tool-button danger" data-autonomous-delete-confirm="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="trash-2"></i><span>Confirmer</span></button>
        <button type="button" class="tool-button" data-autonomous-delete-cancel="${escapeAttr(agent.id)}"><span>Annuler</span></button>
      </span>`
    : `<button type="button" class="tool-button danger autonomous-agent-delete-trigger" data-autonomous-delete="${escapeAttr(agent.id)}" title="Supprimer cet agent autonome" aria-label="Supprimer ${escapeAttr(agent.name || agent.objective)}" ${busy ? "disabled" : ""}><i data-lucide="trash-2"></i><span>Supprimer</span></button>`;

  return `<article class="autonomous-agent-card tone-${tone} ${running ? "is-running" : ""} ${editDraft ? "is-editing" : ""}">
    <header class="autonomous-agent-card-head">
      <span class="autonomous-agent-orb" aria-hidden="true"><i data-lucide="bot"></i></span>
      <div class="autonomous-agent-title">
        <span class="autonomous-status status-${tone}"><i></i>${escapeHtml(autonomousStatusLabel(agent.status))}</span>
        ${systemManaged ? `<span class="autonomous-system-managed"><i data-lucide="shield-check"></i>Géré par le système · toutes les heures</span>` : ""}
        <h3>${escapeHtml(agent.name || agent.objective)}</h3>
        ${agent.role ? `<small>${escapeHtml(agent.role)}</small>` : ""}
      </div>
      <div class="autonomous-agent-head-actions">
        ${editDraft || systemManaged ? "" : `<button type="button" class="icon-button" data-autonomous-edit-open="${escapeAttr(agent.id)}" title="Modifier toute la configuration" aria-label="Modifier ${escapeAttr(agent.name || agent.objective)}" ${busy ? "disabled" : ""}><i data-lucide="pencil"></i></button>`}
        ${editDraft ? "" : deleteAction}
      </div>
    </header>
    <p class="autonomous-agent-objective">${escapeHtml(agent.objective)}</p>
    ${editDraft ? renderAutonomousAgentEditor(agent, editDraft, busy) : ""}
    ${agent.pendingReview ? `<button type="button" class="autonomous-agent-review-callout" data-autonomous-monitor-open="${escapeAttr(agent.id)}"><span><i data-lucide="shield-question"></i></span><div><small>${escapeHtml(autonomousReviewKindLabel(agent.pendingReview.kind))} requise</small><strong>${escapeHtml(agent.pendingReview.request)}</strong></div><i data-lucide="arrow-up-right"></i></button>` : ""}
    <div class="autonomous-agent-state-grid">
      <div class="autonomous-agent-schedule">
        <span><i data-lucide="${eventTriggered ? "bell-ring" : "clock-3"}"></i></span>
        <div>
          <small>${escapeHtml(autonomousTriggerLabel(agent))}</small>
          <strong data-autonomous-schedule="${escapeAttr(agent.id)}">${escapeHtml(formatAutonomousSchedule(agent))}</strong>
          <small>${eventTriggered
            ? `${(agent.watchPaths ?? []).length} chemin${(agent.watchPaths ?? []).length > 1 ? "s" : ""} · stabilité ${agent.debounceSeconds ?? 10} s`
            : `Toutes les ${escapeHtml(formatAutonomousInterval(agent.intervalSeconds))}`}</small>
        </div>
        ${running ? `<span class="autonomous-live-wave" aria-label="Agent en cours d'exécution"><i></i><i></i><i></i></span>` : ""}
      </div>
      <div class="autonomous-agent-signal test-${testStatus}">
        <span><i data-lucide="flask-conical"></i></span>
        <div><small>Validation</small><strong>${escapeHtml(autonomousTestStatusLabel(testStatus))}</strong></div>
      </div>
    </div>
    ${autonomousScheduleEditingId === agent.id && autonomousAgentCanReschedule(agent) ? renderAutonomousScheduleEditor(agent) : ""}
    <dl class="autonomous-agent-metrics">
      <div><dt>Compte</dt><dd>${escapeHtml(autonomousAccountLabel(agent))}</dd></div>
      <div><dt>Tours</dt><dd>${agent.runCount}</dd></div>
      <div><dt>Plan</dt><dd>${workPlanProgress.total ? `${workPlanProgress.done} / ${workPlanProgress.total}` : "À créer"}</dd></div>
      <div><dt>Activité</dt><dd>${escapeHtml(formatAutonomousTimestamp(agent.lastTestFinishedAt ?? agent.lastRunFinishedAt ?? agent.lastRunStartedAt))}</dd></div>
    </dl>
    ${agent.projectDir ? `<p class="autonomous-agent-path"><i data-lucide="folder-open"></i><span>${escapeHtml(agent.projectDir)}</span></p>` : ""}
    ${eventTriggered ? `<p class="autonomous-agent-trigger-paths"><i data-lucide="radar"></i><span><strong>Surveille</strong>${escapeHtml((agent.watchPaths ?? []).join(", "))}</span></p>` : ""}
    ${systemManaged ? `<p class="autonomous-system-managed-note"><i data-lucide="lock-keyhole"></i><span>Compte d’exécution sélectionné automatiquement parmi les agents supervisés : <strong>${escapeHtml(autonomousAccountLabel(agent))}</strong>.</span></p>` : `<label class="orchestration-member-account autonomous-agent-account">
      <span>Adresse e-mail / compte</span>
      <select data-autonomous-account="${escapeAttr(agent.id)}" aria-label="Adresse e-mail ou compte de ${escapeAttr(agent.name || agent.objective)}" ${busy || !settings?.accounts.length ? "disabled" : ""}>
        ${orchestrationAccountOptions(agent.accountId)}
      </select>
      <small>Le prochain cycle utilisera ce compte ; un tour actif sera arrêté proprement avant le changement.</small>
    </label>`}
    ${connectorBadges ? `<div class="autonomous-agent-connectors"><small>Accès externe</small>${connectorBadges}</div>` : ""}
    ${agent.allowGitPublish ? `<p class="autonomous-agent-publish-policy"><i data-lucide="git-branch"></i><span>Push GitHub sans force et publication du site autorisés pour cet agent</span></p>` : ""}
    ${agent.requireUserReview ? `<p class="autonomous-agent-review-policy ${agent.approvedReview ? "is-approved" : ""}"><i data-lucide="shield-check"></i><span>${agent.approvedReview ? "Review validée · application autorisée pour le prochain tour" : "Review utilisateur obligatoire avant chaque application"}</span></p>` : ""}
    ${renderAutonomousWorkPlan(agent)}
    ${agent.lastSummary ? `<section class="autonomous-agent-summary"><small>Dernier compte rendu</small><p>${escapeHtml(agent.lastSummary)}</p></section>` : ""}
    ${agent.lastError ? `<p class="autonomous-agent-error"><i data-lucide="circle-alert"></i><span>${escapeHtml(agent.lastError)}</span></p>` : ""}
    ${agent.triggerError ? `<p class="autonomous-agent-error"><i data-lucide="bell-off"></i><span>${escapeHtml(agent.triggerError)}</span></p>` : ""}
    <details class="autonomous-agent-details">
      <summary>
        <span><i data-lucide="brain-circuit"></i>Détails, mémoire et journal</span>
        <small>${workPlanProgress.total} tâche${workPlanProgress.total > 1 ? "s" : ""} · ${memories.length} souvenir${memories.length > 1 ? "s" : ""}</small>
        <i data-lucide="chevron-down"></i>
      </summary>
      <div class="autonomous-agent-details-body">
        ${agent.testCommand ? `<section class="autonomous-test-box test-${testStatus}">
          <header><span><i data-lucide="flask-conical"></i>Validation réelle</span><strong>${escapeHtml(autonomousTestStatusLabel(testStatus))}</strong></header>
          <code>${escapeHtml(agent.testCommand)}</code>
          <small>Timeout ${agent.testTimeoutSeconds ?? 300} s${agent.lastTestDurationMs != null ? ` · dernière durée ${(agent.lastTestDurationMs / 1000).toFixed(1)} s` : ""}${agent.lastTestExitCode != null ? ` · code ${agent.lastTestExitCode}` : ""}</small>
          ${agent.lastTestOutput ? `<details><summary>Sortie du dernier test</summary><pre>${escapeHtml(agent.lastTestOutput)}</pre></details>` : ""}
        </section>` : `<p class="autonomous-no-test"><i data-lucide="flask-conical"></i><span>Aucune commande de validation configurée.</span></p>`}
        <details class="autonomous-memory" ${memories.length ? "" : "open"}>
          <summary><span><i data-lucide="brain-circuit"></i>Mémoire durable</span><small>${memories.length}/64</small></summary>
          ${memoryRows ? `<ul>${memoryRows}</ul>` : `<p class="autonomous-memory-empty">Aucun souvenir. Ajoute le contexte stable que l'agent doit conserver entre ses tours.</p>`}
          ${systemManaged ? "" : `<form data-autonomous-memory-form="${escapeAttr(agent.id)}">
            <input maxlength="2000" value="${escapeAttr(memoryDraft)}" placeholder="Fait, contrainte ou décision à retenir" ${busy ? "disabled" : ""} />
            <button type="submit" class="tool-button" ${busy ? "disabled" : ""}><i data-lucide="plus"></i><span>Retenir</span></button>
          </form>`}
        </details>
        ${events ? `<details class="autonomous-agent-events"><summary>Journal récent</summary><ul>${events}</ul></details>` : ""}
      </div>
    </details>
    <footer>
      <div>
        ${systemManaged ? `<span class="autonomous-system-managed-note"><i data-lucide="shield-check"></i><span>Cycle de supervision protégé</span></span>` : `<button type="button" class="tool-button" data-autonomous-edit-open="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="pencil"></i><span>Modifier</span></button>`}
        ${lifecycleAction}
        ${systemManaged ? "" : `<button type="button" class="tool-button primary" data-autonomous-orchestrate="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="users"></i><span>Passer en orchestration</span></button>`}
        ${agent.status === "active" && !systemManaged ? `<button type="button" class="tool-button" data-autonomous-action="runNow" data-autonomous-id="${escapeAttr(agent.id)}" ${busy || running ? "disabled" : ""}><i data-lucide="refresh-ccw"></i><span>Exécuter maintenant</span></button>` : ""}
        ${autonomousAgentCanReschedule(agent) && autonomousScheduleEditingId !== agent.id ? `<button type="button" class="tool-button" data-autonomous-schedule-open="${escapeAttr(agent.id)}" ${busy ? "disabled" : ""}><i data-lucide="calendar-clock"></i><span>Fréquence & heure</span></button>` : ""}
        ${agent.status === "active" && !systemManaged && agent.testCommand ? `<button type="button" class="tool-button" data-autonomous-action="testNow" data-autonomous-id="${escapeAttr(agent.id)}" ${busy || running ? "disabled" : ""}><i data-lucide="flask-conical"></i><span>Tester maintenant</span></button>` : ""}
      </div>
    </footer>
  </article>`;
};

const normalizeAutonomousLaunchWorkerAccounts = (fallbackAccountId: string): string[] => {
  autonomousLaunchWorkerAccountIds = Array.from(
    { length: autonomousLaunchWorkerCount },
    (_, index) => autonomousLaunchWorkerAccountIds[index] || fallbackAccountId,
  );
  return autonomousLaunchWorkerAccountIds;
};

const renderAutonomousLaunchWorkerAccounts = (fallbackAccountId: string): string =>
  normalizeAutonomousLaunchWorkerAccounts(fallbackAccountId)
    .map((workerAccountId, index) => `<label class="orchestration-create-worker">
      <span><b>W${index + 1}</b><span><strong>Worker ${index + 1}</strong><small>Adresse indépendante</small></span></span>
      <select data-autonomous-launch-worker="${index}" aria-label="Adresse e-mail ou compte du worker ${index + 1}">${orchestrationAccountOptions(workerAccountId)}</select>
    </label>`)
    .join("");

const renderAutonomousPanel = (): string => {
  const accountId = accountById(autonomousAccountId)?.id ?? settings?.defaultAccountId ?? settings?.accounts[0]?.id ?? "";
  const connectorAccount = accountById(accountId);
  const launchOrchestration = autonomousLaunchMode === "orchestrator";
  const eventTriggered = !launchOrchestration && autonomousTriggerKind === "workspace_change";
  const connectorsSupported = !launchOrchestration && !!connectorAccount && accountProvider(connectorAccount) === "codex";
  const connectorPrerequisite = isRemoteMode()
    ? "Prérequis sur le serveur : ouvre un chat ou terminal Codex avec ce même compte, lance /plugins, installe Gmail et/ou Google Calendar, puis connecte ton compte Google. L’agent et les connecteurs s’exécutent sur l’hôte du site :8080 ; aucun mot de passe n’est stocké dans le navigateur."
    : "Prérequis : dans le même compte Codex, ouvre /plugins, installe Gmail et/ou Google Calendar, puis connecte ton compte Google. Aucun mot de passe n’est stocké ici.";
  const accountOptions = settings?.accounts
    .map(
      (account) => `<option value="${escapeAttr(account.id)}" ${account.id === accountId ? "selected" : ""}>${escapeHtml(account.label)} · ${escapeHtml(providerLabel(accountProvider(account)))}</option>`,
    )
    .join("") ?? "";
  const intervalOptions = AUTONOMOUS_INTERVAL_OPTIONS.map(
    (option) => `<option value="${option.value}" ${option.value === autonomousIntervalSeconds ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
  ).join("");
  const connectorOptions = AUTONOMOUS_CONNECTORS.map(
    (connector) => `<label class="autonomous-connector-option ${autonomousConnectors.includes(connector.id) ? "is-selected" : ""}">
      <input type="checkbox" data-autonomous-connector="${escapeAttr(connector.id)}" ${autonomousConnectors.includes(connector.id) ? "checked" : ""} ${connectorsSupported ? "" : "disabled"} />
      <span><i data-lucide="${escapeAttr(connector.icon)}"></i></span>
      <span><strong>${escapeHtml(connector.label)}</strong><small>${escapeHtml(connector.description)}</small></span>
    </label>`,
  ).join("");
  const templateCards = AUTONOMOUS_AGENT_TEMPLATES.map((template) => {
    const selected = autonomousTemplateId === template.id;
    return `<article class="autonomous-template-card tone-${escapeAttr(template.tone)} ${selected ? "is-selected" : ""}">
      <header>
        <span class="autonomous-template-icon"><i data-lucide="${escapeAttr(template.icon)}"></i></span>
        <span><small>${escapeHtml(template.category)}</small><strong>${escapeHtml(template.name)}</strong></span>
        ${selected ? `<em><i data-lucide="check"></i>Chargé</em>` : ""}
      </header>
      <p>${escapeHtml(template.description)}</p>
      <footer>
        <span><i data-lucide="${template.requireUserReview ? "shield-check" : "scan-eye"}"></i>${escapeHtml(template.policyLabel)}</span>
        <button type="button" class="tool-button" data-autonomous-template="${escapeAttr(template.id)}" aria-pressed="${selected}" aria-label="Configurer ${escapeAttr(template.name)}"><i data-lucide="arrow-right"></i><span>${selected ? "Modèle chargé" : "Configurer"}</span></button>
      </footer>
    </article>`;
  }).join("");
  const environments = knownWorkspaces();
  const knownEnvironment = autonomousProjectDir
    ? environments.find((workspace) => workspaceIdForPath(workspace.path) === workspaceIdForPath(autonomousProjectDir))
    : null;
  const environmentPreset = autonomousEnvironmentCustom
    ? "__custom__"
    : knownEnvironment?.path ?? (autonomousProjectDir ? "__custom__" : "");
  const environmentOptions = environments
    .map((workspace) => `<option value="${escapeAttr(workspace.path)}" ${environmentPreset === workspace.path ? "selected" : ""}>${escapeHtml(workspace.label)} · ${escapeHtml(workspace.path)}</option>`)
    .join("");
  const activeCount = autonomousAgents.filter((agent) => agent.status === "active").length;
  const workingCount = autonomousAgents.filter(autonomousAgentIsRunning).length;
  const validatedCount = autonomousAgents.filter((agent) => agent.testStatus === "passed").length;
  const createOpen = autonomousCreateOpen || (!autonomousCreatePreferenceSet && autonomousAgentsLoaded && autonomousAgents.length === 0);
  const hostMessage = isRemoteMode()
    ? "Le moteur tourne sur cst-server, même lorsque ce navigateur est fermé. Le service doit rester démarré."
    : "En mode desktop, le moteur tourne tant que l'application reste ouverte. Utilise cst-server comme service pour un vrai fonctionnement 24/7.";

  return `<div class="panel autonomous-panel">
    <header class="autonomous-page-head">
      <div class="autonomous-page-title">
        <span class="autonomous-page-mark" aria-hidden="true"><i data-lucide="bot"></i></span>
        <div>
          <span class="autonomous-kicker"><i data-lucide="sparkles"></i>Travail continu et vérifiable</span>
          <h2>Agents autonomes</h2>
          <p>Confie un objectif durable, impose une preuve de réussite et laisse l’agent reprendre exactement là où il s’est arrêté.</p>
        </div>
      </div>
      <div class="autonomous-head-actions">
        <span class="autonomous-service-pill"><i></i><span><strong>${isRemoteMode() ? "Moteur serveur actif" : "Moteur desktop actif"}</strong><small>${escapeHtml(hostMessage)}</small></span></span>
        <button id="autonomousNewAgent" type="button" class="tool-button primary"><i data-lucide="plus"></i><span>Nouvel agent</span></button>
      </div>
    </header>

    <section class="autonomous-overview" aria-label="État des agents autonomes">
      <article><span><i data-lucide="bot"></i></span><div><strong>${autonomousAgents.length}</strong><small>Agents créés</small></div></article>
      <article><span><i data-lucide="play"></i></span><div><strong>${activeCount}</strong><small>Actifs</small></div></article>
      <article><span><i data-lucide="refresh-ccw"></i></span><div><strong>${workingCount}</strong><small>En cours</small></div></article>
      <article class="is-validated"><span><i data-lucide="shield-check"></i></span><div><strong>${validatedCount}</strong><small>Validés par un test</small></div></article>
    </section>

    <section class="autonomous-template-section" aria-labelledby="autonomousTemplateTitle">
      <header class="autonomous-template-head">
        <div><span class="autonomous-section-kicker">Prêts à configurer</span><strong id="autonomousTemplateTitle">Agents suggérés</strong><small>Choisis une spécialité : la mission, le rythme et les garde-fous sont préremplis.</small></div>
      </header>
      <div class="autonomous-template-grid">${templateCards}</div>
    </section>

    <details id="autonomousCreateShell" class="autonomous-create-shell" ${createOpen ? "open" : ""}>
      <summary>
        <span class="autonomous-create-summary-mark"><i data-lucide="target"></i></span>
        <span><strong>Créer un agent autonome</strong><small>Mission, environnement, rythme et garde-fous.</small></span>
        <span class="autonomous-create-summary-action"><b>${createOpen ? "Fermer" : "Configurer"}</b><i data-lucide="chevron-down"></i></span>
      </summary>
      <form id="autonomousCreateForm" class="autonomous-create-card">
        <section class="autonomous-form-block">
          <header><b>1</b><span><strong>Définir la mission</strong><small>Un nom court et un résultat observable.</small></span></header>
          <div class="autonomous-create-grid autonomous-identity-grid">
            <label><span>Nom de l'agent</span><input id="autonomousName" maxlength="120" value="${escapeAttr(autonomousNameDraft)}" placeholder="Ex. Optimiseur web" /></label>
            <label class="autonomous-role-field"><span>Rôle / spécialité</span><input id="autonomousRole" maxlength="4000" value="${escapeAttr(autonomousRoleDraft)}" placeholder="Ex. Ingénieur performance prudent et orienté mesures" /></label>
          </div>
          <label class="autonomous-objective-field">
            <span>Objectif <small>obligatoire</small></span>
            <textarea id="autonomousObjective" maxlength="32768" placeholder="Ex. Réduire l’utilisation des ressources de la page web et fournir des mesures avant/après." ${autonomousBusyId === "create" ? "disabled" : ""}>${escapeHtml(autonomousObjectiveDraft)}</textarea>
          </label>
        </section>

        <section class="autonomous-form-block">
          <header><b>2</b><span><strong>Choisir l’exécution</strong><small>Où, avec quel compte et à quel rythme l’agent travaille.</small></span></header>
          <div class="autonomous-create-grid autonomous-runtime-grid">
            <label><span>Compte agent</span><select id="autonomousAccount" ${accountOptions ? "" : "disabled"}>${accountOptions || `<option value="">Aucun compte</option>`}</select></label>
            <label><span>Type de lancement</span><select id="autonomousLaunchMode"><option value="autonomous" ${launchOrchestration ? "" : "selected"}>Agent autonome</option><option value="orchestrator" ${launchOrchestration ? "selected" : ""}>Orchestrateur + workers</option></select></label>
            ${launchOrchestration
              ? `<label><span>Workers <small>hors orchestrateur</small></span><span class="orchestration-worker-count"><input id="autonomousLaunchWorkerCount" type="number" min="1" max="12" step="1" required value="${autonomousLaunchWorkerCount}" /><small>${autonomousLaunchWorkerCount + 1} agents au total</small></span></label>`
              : `<label><span>Déclenchement</span><select id="autonomousTriggerKind"><option value="schedule" ${eventTriggered ? "" : "selected"}>Planning récurrent</option><option value="workspace_change" ${eventTriggered ? "selected" : ""}>Modification du projet</option></select></label>`}
            ${!launchOrchestration && !eventTriggered ? `<label><span>Rythme</span><select id="autonomousInterval">${intervalOptions}</select></label>` : ""}
            ${eventTriggered ? `<label><span>Stabilisation</span><span class="autonomous-timeout-input"><input id="autonomousDebounceSeconds" type="number" min="2" max="600" step="1" value="${autonomousDebounceSeconds}" /><small>secondes</small></span></label>` : ""}
            <label><span>Mode</span><select id="autonomousMode"><option value="build" ${autonomousMode === "build" ? "selected" : ""}>Construire et modifier</option><option value="plan" ${autonomousMode === "plan" ? "selected" : ""}>Analyser et planifier</option></select></label>
            <label class="autonomous-project-field"><span>Environnement de l'agent <small>projet isolé</small></span><select id="autonomousEnvironmentPreset"><option value="" ${environmentPreset === "" ? "selected" : ""}>Aucun environnement</option>${environmentOptions}<option value="__custom__" ${environmentPreset === "__custom__" ? "selected" : ""}>Autre chemin…</option></select><input id="autonomousProjectDir" value="${escapeAttr(autonomousProjectDir)}" placeholder="Ex. C:/projets/mon-site" ${environmentPreset === "__custom__" ? "" : "hidden"} />${knownEnvironment ? `<small class="autonomous-environment-path"><i data-lucide="folder-open"></i>${escapeHtml(knownEnvironment.path)}</small>` : `<small class="autonomous-environment-path">Choisis un environnement connu ou saisis un chemin personnalisé.</small>`}</label>
          </div>
          ${eventTriggered ? `<section class="autonomous-event-config">
            <header><span><i data-lucide="bell-ring"></i></span><div><strong>Veille événementielle</strong><small>L’agent enregistre l’état actuel, dort, puis se réveille après une future modification stable.</small></div><em>0 tour pendant la veille</em></header>
            <label><span>Fichiers et dossiers surveillés <small>chemins relatifs, un par ligne</small></span><textarea id="autonomousWatchPaths" maxlength="8000" required placeholder="src&#10;public&#10;package.json">${escapeHtml(autonomousWatchPathsDraft)}</textarea></label>
            <label class="autonomous-review-toggle autonomous-publish-toggle">
              <input id="autonomousAllowGitPublish" type="checkbox" ${autonomousAllowGitPublish ? "checked" : ""} />
              <span><strong>Autoriser le push GitHub et la publication du site</strong><small>Exige une branche propre avec <code>origin</code> ; limité à <code>git push origin HEAD</code> sans force et aux commandes de déploiement prévues.</small></span>
              <i data-lucide="git-branch"></i>
            </label>
          </section>` : ""}
          ${launchOrchestration ? `<section class="orchestration-create-team autonomous-launch-team">
            <header><span><small>Équipe orchestrée</small><strong>Choisir l’adresse de chaque worker</strong></span><button id="autonomousLaunchWorkersUseOrchestrator" type="button" class="tool-button"><i data-lucide="copy-check"></i><span>Même compte pour tous</span></button></header>
            <div id="autonomousLaunchWorkerAccounts">${renderAutonomousLaunchWorkerAccounts(accountId)}</div>
          </section>` : ""}
          <section class="autonomous-connector-access ${connectorsSupported ? "" : "is-disabled"}" aria-labelledby="autonomousConnectorTitle">
            <header><span><i data-lucide="unplug"></i></span><div><strong id="autonomousConnectorTitle">Services Google</strong><small>Accès explicite, propre à cet agent.</small></div><em>Codex uniquement</em></header>
            <div class="autonomous-connector-grid">${connectorOptions}</div>
            <p><i data-lucide="shield-check"></i><span>Lecture autonome. Envoi d’e-mail, création ou modification d’événement : autorisation ponctuelle dans le moniteur. Les suppressions sont bloquées.</span></p>
            <small class="autonomous-connector-prerequisite">${launchOrchestration
              ? "Les connecteurs autonomes ne sont pas transférés aux workers orchestrés."
              : connectorsSupported
              ? connectorPrerequisite
              : "Sélectionne un compte Codex pour utiliser Gmail ou Google Agenda. Les comptes Claude ne chargent pas ces connecteurs."}</small>
          </section>
          <label class="autonomous-review-toggle">
            <input id="autonomousRequireUserReview" type="checkbox" ${autonomousRequireUserReview ? "checked" : ""} />
            <span><strong>Review par l'utilisateur avant d'appliquer les changements</strong><small>L'agent prépare d'abord son plan sans modifier les fichiers. Il applique seulement après ton autorisation dans le moniteur.</small></span>
            <i data-lucide="shield-check"></i>
          </label>
        </section>

        <details class="autonomous-advanced" ${autonomousInitialMemoryDraft.trim() || autonomousTestCommandDraft.trim() ? "open" : ""}>
          <summary><span><i data-lucide="shield-check"></i><span><strong>Garde-fous et mémoire</strong><small>Recommandé pour un agent fiable.</small></span></span><i data-lucide="chevron-down"></i></summary>
          <div class="autonomous-advanced-body">
            <label class="autonomous-objective-field autonomous-memory-seed-field">
              <span>Mémoire initiale <small>optionnelle</small></span>
              <textarea id="autonomousInitialMemory" maxlength="2000" placeholder="Contraintes durables, architecture connue, décisions déjà prises…">${escapeHtml(autonomousInitialMemoryDraft)}</textarea>
            </label>
            <section class="autonomous-validation-config">
              <div><i data-lucide="flask-conical"></i><span><strong>Preuve de réussite</strong><small>Cette commande doit réussir avant que l’agent puisse terminer son objectif.</small></span></div>
              <label class="autonomous-test-command-field"><span>Commande de test ${launchOrchestration ? "<small>obligatoire en orchestration</small>" : ""}</span><input id="autonomousTestCommand" maxlength="8000" value="${escapeAttr(autonomousTestCommandDraft)}" placeholder="Ex. npm test && npm run build" ${launchOrchestration ? "required" : ""} /></label>
              <label><span>Timeout</span><span class="autonomous-timeout-input"><input id="autonomousTestTimeout" type="number" min="5" max="1800" value="${autonomousTestTimeoutSeconds}" /><small>secondes</small></span></label>
            </section>
          </div>
        </details>

        <div class="autonomous-create-actions">
          <small><i data-lucide="circle-alert"></i>Après 3 échecs, l’agent se suspend et attend ton intervention.</small>
          <button class="tool-button primary" type="submit" ${accountOptions && autonomousBusyId !== "create" ? "" : "disabled"}><i data-lucide="${launchOrchestration ? "users" : eventTriggered ? "moon-star" : "play"}"></i><span>${autonomousBusyId === "create" ? "Création…" : launchOrchestration ? "Créer et lancer l’orchestration" : eventTriggered ? "Créer et mettre en veille" : "Créer et démarrer"}</span></button>
        </div>
      </form>
    </details>

    <section class="autonomous-agents-section">
      <header class="autonomous-list-head">
        <div><span class="autonomous-section-kicker">Suivi en temps réel</span><strong>Mes agents</strong><small>Chaque objectif, sa validation et sa mémoire durable.</small></div>
        <button id="autonomousRefresh" type="button" class="icon-button" title="Actualiser" aria-label="Actualiser les agents"><i data-lucide="refresh-ccw"></i></button>
      </header>
      <div class="autonomous-agent-list">
        ${!autonomousAgentsLoaded
          ? `<div class="autonomous-empty"><i data-lucide="loader-circle"></i><strong>Chargement des agents…</strong></div>`
          : autonomousAgents.map(renderAutonomousAgentCard).join("") || `<div class="autonomous-empty"><i data-lucide="bot"></i><strong>Aucun agent autonome</strong><span>Ouvre « Créer un agent autonome » pour définir ton premier objectif.</span></div>`}
      </div>
    </section>
  </div>`;
};

const updateAutonomousAgentLocally = (updated: AutonomousAgentSnapshot) => {
  const index = autonomousAgents.findIndex((agent) => agent.id === updated.id);
  if (index >= 0) autonomousAgents[index] = updated;
  else autonomousAgents.unshift(updated);
  autonomousAgentsSignature = JSON.stringify(autonomousAgents);
  autonomousAgentsLoaded = true;
};

const closeAutonomousAgentEditor = (): void => {
  autonomousEditingId = null;
  autonomousEditDraft = null;
};

const saveAutonomousAgentEdit = async (id: string): Promise<void> => {
  const draft = autonomousEditingId === id ? autonomousEditDraft : null;
  const original = autonomousAgents.find((agent) => agent.id === id);
  const account = accountById(draft?.accountId);
  if (!draft || !original || original.systemManaged || !account || autonomousBusyId) return;

  const objective = draft.objective.trim();
  const projectDir = draft.projectDir.trim();
  const testCommand = draft.testCommand.trim();
  const watchPaths = parseAutonomousWatchPaths(draft.watchPaths);
  const provider = accountProvider(account);
  if (!objective) {
    statusText = "Décris l’objectif autonome à poursuivre";
    render();
    return;
  }
  if ((testCommand || draft.triggerKind === "workspace_change" || draft.allowGitPublish) && !projectDir) {
    statusText = "Choisis un dossier projet pour les tests, la veille ou la publication";
    render();
    return;
  }
  if (draft.triggerKind === "workspace_change" && !watchPaths.length) {
    statusText = "Ajoute au moins un fichier ou dossier à surveiller";
    render();
    return;
  }
  if (draft.connectors.length && provider !== "codex") {
    statusText = "Les connecteurs Gmail et Google Agenda nécessitent un compte Codex";
    render();
    return;
  }

  autonomousBusyId = id;
  statusText = "Enregistrement de toute la configuration de l’agent";
  render();
  let automaticallyPaused = false;
  try {
    const current = autonomousAgents.find((agent) => agent.id === id) ?? original;
    const hasWorkInFlight = current.currentStartId != null
      || current.currentTurnId != null
      || current.currentTestId != null;
    if (hasWorkInFlight) {
      if (current.status !== "active") {
        throw new Error("L’agent termine une opération ; réessaie dans quelques secondes.");
      }
      const paused = await invoke<AutonomousAgentSnapshot>("control_autonomous_agent", {
        id,
        action: "pause",
      });
      updateAutonomousAgentLocally(paused);
      automaticallyPaused = true;
    }

    const model = draft.model.trim() || accountModel(account);
    const reasoningEffort = provider === "codex"
      ? reasoningEffortForChatModel(account, model, draft.reasoningEffort)
      : null;
    const updated = await invoke<AutonomousAgentSnapshot>("update_autonomous_agent", {
      id,
      request: {
        name: draft.name.trim() || null,
        objective,
        role: draft.role.trim() || null,
        accountId: account.id,
        projectDir: projectDir || null,
        mode: draft.mode,
        requireUserReview: draft.requireUserReview,
        model,
        reasoningEffort,
        connectors: provider === "codex" ? draft.connectors : [],
        intervalSeconds: Math.max(60, Math.min(7 * 24 * 60 * 60, Math.round(draft.intervalSeconds))),
        triggerKind: draft.triggerKind,
        watchPaths: draft.triggerKind === "workspace_change" ? watchPaths : [],
        debounceSeconds: Math.max(2, Math.min(600, Math.round(draft.debounceSeconds))),
        allowGitPublish: draft.triggerKind === "workspace_change" && draft.allowGitPublish,
        testCommand: testCommand || null,
        testTimeoutSeconds: Math.max(5, Math.min(1800, Math.round(draft.testTimeoutSeconds))),
        activate: automaticallyPaused || draft.activate,
      },
    });
    updateAutonomousAgentLocally(updated);
    closeAutonomousAgentEditor();
    statusText = automaticallyPaused
      ? "Configuration enregistrée ; l’agent a repris avec les nouveaux réglages"
      : draft.activate
        ? "Configuration enregistrée ; l’agent démarre maintenant"
        : "Toute la configuration de l’agent a été enregistrée";
  } catch (error) {
    statusText = automaticallyPaused
      ? `Modification interrompue ; l’agent reste en pause : ${String(error)}`
      : `Modification annulée : ${String(error)}`;
  } finally {
    autonomousBusyId = null;
    render();
    void refreshAutonomousAgents();
  }
};

const bindAutonomousAgentEditUi = (): void => {
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-edit-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousEditOpen;
      const agent = autonomousAgents.find((candidate) => candidate.id === id);
      if (!agent || agent.systemManaged || autonomousBusyId) return;
      autonomousEditingId = agent.id;
      autonomousEditDraft = autonomousAgentEditDraftFromSnapshot(agent);
      autonomousDeletePendingId = null;
      autonomousScheduleEditingId = null;
      void loadChatModelCatalog(agent.accountId);
      render();
      window.setTimeout(() => {
        const form = Array.from(document.querySelectorAll<HTMLFormElement>("[data-autonomous-edit-form]"))
          .find((candidate) => candidate.dataset.autonomousEditForm === agent.id);
        form?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        form?.querySelector<HTMLInputElement>('[data-autonomous-edit-field="name"]')?.focus();
      }, 0);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-edit-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      if (autonomousBusyId) return;
      closeAutonomousAgentEditor();
      render();
    });
  });
  document.querySelectorAll<HTMLFormElement>("[data-autonomous-edit-form]").forEach((form) => {
    const id = form.dataset.autonomousEditForm;
    if (!id || id !== autonomousEditingId || !autonomousEditDraft) return;
    const draft = autonomousEditDraft;
    const controls = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      "[data-autonomous-edit-field]",
    );
    controls.forEach((control) => {
      const sync = () => {
        const field = control.dataset.autonomousEditField;
        switch (field) {
          case "name":
          case "objective":
          case "role":
          case "projectDir":
          case "model":
          case "reasoningEffort":
          case "testCommand":
          case "watchPaths":
            draft[field] = control.value;
            break;
          case "mode":
            draft.mode = control.value === "plan" ? "plan" : control.value === "ask" ? "ask" : "build";
            break;
          case "intervalMinutes":
            draft.intervalSeconds = Math.round((Number(control.value) || 0) * 60);
            break;
          case "triggerKind":
            if (isAutonomousTriggerKind(control.value)) {
              draft.triggerKind = control.value;
              if (draft.triggerKind === "schedule") draft.allowGitPublish = false;
              render();
            }
            break;
          case "debounceSeconds":
            draft.debounceSeconds = Number(control.value) || 0;
            break;
          case "testTimeoutSeconds":
            draft.testTimeoutSeconds = Number(control.value) || 0;
            break;
          case "requireUserReview":
            draft.requireUserReview = control instanceof HTMLInputElement && control.checked;
            break;
          case "allowGitPublish":
            draft.allowGitPublish = control instanceof HTMLInputElement && control.checked;
            break;
          case "activate":
            draft.activate = control instanceof HTMLInputElement && control.checked;
            break;
        }
        control.setCustomValidity("");
      };
      control.addEventListener("input", sync);
      control.addEventListener("change", sync);
    });
    form.querySelector<HTMLSelectElement>('[data-autonomous-edit-field="accountId"]')
      ?.addEventListener("change", (event) => {
        const accountId = (event.currentTarget as HTMLSelectElement).value;
        const account = accountById(accountId);
        if (!account) return;
        draft.accountId = account.id;
        draft.model = accountModel(account);
        draft.reasoningEffort = accountProvider(account) === "codex"
          ? reasoningEffortForChatModel(account, draft.model, accountReasoningEffort(account))
          : "";
        if (accountProvider(account) !== "codex") draft.connectors = [];
        void loadChatModelCatalog(account.id);
        render();
      });
    form.querySelectorAll<HTMLInputElement>("[data-autonomous-edit-connector]").forEach((input) => {
      input.addEventListener("change", () => {
        const connectorId = input.dataset.autonomousEditConnector;
        if (!isAutonomousConnectorId(connectorId)) return;
        draft.connectors = toggleAutonomousConnector(draft.connectors, connectorId);
        input.closest(".autonomous-agent-edit-connector")?.classList.toggle("is-selected", input.checked);
      });
    });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const projectInput = form.querySelector<HTMLInputElement>('[data-autonomous-edit-field="projectDir"]');
      if (
        (draft.testCommand.trim() || draft.triggerKind === "workspace_change" || draft.allowGitPublish)
        && !draft.projectDir.trim()
      ) {
        projectInput?.setCustomValidity("Un dossier projet est obligatoire pour les tests, la veille ou la publication.");
        projectInput?.reportValidity();
        return;
      }
      if (draft.triggerKind === "workspace_change" && !parseAutonomousWatchPaths(draft.watchPaths).length) {
        form.querySelector<HTMLTextAreaElement>('[data-autonomous-edit-field="watchPaths"]')?.setCustomValidity(
          "Ajoute au moins un chemin relatif à surveiller.",
        );
        form.querySelector<HTMLTextAreaElement>('[data-autonomous-edit-field="watchPaths"]')?.reportValidity();
        return;
      }
      void saveAutonomousAgentEdit(id);
    });
  });
};

const bindAutonomousPanelUi = () => {
  const createShell = document.querySelector<HTMLDetailsElement>("#autonomousCreateShell");
  const syncCreateShell = () => {
    // Un render remplace le <details>. Son ancien evenement `toggle` peut etre
    // livre apres le detach et ne doit pas refermer le nouveau formulaire.
    if (!createShell?.isConnected) return;
    autonomousCreatePreferenceSet = true;
    autonomousCreateOpen = createShell.open;
    const label = createShell.querySelector<HTMLElement>(".autonomous-create-summary-action b");
    if (label) label.textContent = createShell.open ? "Fermer" : "Configurer";
  };
  createShell?.addEventListener("toggle", syncCreateShell);
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-template]").forEach((button) => {
    button.addEventListener("click", () => {
      const template = autonomousAgentTemplateById(button.dataset.autonomousTemplate);
      if (!template) return;
      autonomousTemplateId = template.id;
      autonomousNameDraft = template.name;
      autonomousRoleDraft = template.role;
      autonomousObjectiveDraft = template.objective;
      autonomousInitialMemoryDraft = template.initialMemory;
      autonomousIntervalSeconds = template.intervalSeconds;
      autonomousTriggerKind = template.triggerKind;
      autonomousWatchPathsDraft = template.watchPaths.join("\n");
      autonomousDebounceSeconds = template.debounceSeconds;
      autonomousAllowGitPublish = template.allowGitPublish;
      autonomousMode = template.mode;
      autonomousRequireUserReview = template.requireUserReview;
      autonomousConnectors = [];
      autonomousTestCommandDraft = template.testCommand;
      autonomousTestTimeoutSeconds = 5 * 60;
      autonomousCreateOpen = true;
      autonomousCreatePreferenceSet = true;
      statusText = `Modèle « ${template.name} » chargé ; vérifie l'environnement puis démarre l'agent`;
      render();
      window.setTimeout(() => {
        const shell = document.querySelector<HTMLDetailsElement>("#autonomousCreateShell");
        shell?.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelector<HTMLSelectElement>("#autonomousEnvironmentPreset")?.focus();
      }, 0);
    });
  });
  document.querySelector<HTMLButtonElement>("#autonomousNewAgent")?.addEventListener("click", () => {
    if (!createShell) return;
    createShell.open = true;
    syncCreateShell();
    createShell.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.querySelector<HTMLInputElement>("#autonomousName")?.focus(), 220);
  });
  document.querySelector<HTMLInputElement>("#autonomousName")?.addEventListener("input", (event) => {
    autonomousNameDraft = (event.currentTarget as HTMLInputElement).value;
  });
  document.querySelector<HTMLInputElement>("#autonomousRole")?.addEventListener("input", (event) => {
    autonomousRoleDraft = (event.currentTarget as HTMLInputElement).value;
  });
  const objective = document.querySelector<HTMLTextAreaElement>("#autonomousObjective");
  objective?.addEventListener("input", () => {
    autonomousObjectiveDraft = objective.value;
    objective.setCustomValidity("");
  });
  document.querySelector<HTMLTextAreaElement>("#autonomousInitialMemory")?.addEventListener("input", (event) => {
    autonomousInitialMemoryDraft = (event.currentTarget as HTMLTextAreaElement).value;
  });
  document.querySelector<HTMLSelectElement>("#autonomousAccount")?.addEventListener("change", (event) => {
    const previousAccountId = autonomousAccountId;
    autonomousAccountId = (event.currentTarget as HTMLSelectElement).value || null;
    if (autonomousLaunchMode === "orchestrator" && autonomousAccountId) {
      autonomousLaunchWorkerAccountIds = autonomousLaunchWorkerAccountIds.map((workerAccountId) =>
        !workerAccountId || workerAccountId === previousAccountId ? autonomousAccountId! : workerAccountId,
      );
    }
    render();
  });
  document.querySelector<HTMLSelectElement>("#autonomousLaunchMode")?.addEventListener("change", (event) => {
    autonomousLaunchMode = (event.currentTarget as HTMLSelectElement).value === "orchestrator"
      ? "orchestrator"
      : "autonomous";
    if (autonomousLaunchMode === "orchestrator") {
      autonomousConnectors = [];
      autonomousTriggerKind = "schedule";
      autonomousAllowGitPublish = false;
      normalizeAutonomousLaunchWorkerAccounts(autonomousAccountId ?? "");
    }
    render();
  });
  document.querySelector<HTMLInputElement>("#autonomousLaunchWorkerCount")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const value = Number(input.value);
    if (Number.isInteger(value) && value >= 1 && value <= 12) {
      autonomousLaunchWorkerCount = value;
      normalizeAutonomousLaunchWorkerAccounts(autonomousAccountId ?? "");
      const host = document.querySelector<HTMLElement>("#autonomousLaunchWorkerAccounts");
      if (host) {
        host.innerHTML = renderAutonomousLaunchWorkerAccounts(autonomousAccountId ?? "");
        renderIcons(host);
      }
    }
    input.setCustomValidity("");
  });
  document.querySelector<HTMLFormElement>("#autonomousCreateForm")?.addEventListener("change", (event) => {
    const select = event.target instanceof HTMLSelectElement
      ? event.target.closest<HTMLSelectElement>("[data-autonomous-launch-worker]")
      : null;
    if (!select) return;
    const index = Number(select.dataset.autonomousLaunchWorker);
    if (Number.isInteger(index) && index >= 0 && index < autonomousLaunchWorkerCount) {
      autonomousLaunchWorkerAccountIds[index] = select.value;
    }
  });
  document.querySelector<HTMLButtonElement>("#autonomousLaunchWorkersUseOrchestrator")?.addEventListener("click", () => {
    autonomousLaunchWorkerAccountIds = Array.from(
      { length: autonomousLaunchWorkerCount },
      () => autonomousAccountId ?? "",
    );
    const host = document.querySelector<HTMLElement>("#autonomousLaunchWorkerAccounts");
    if (host) {
      host.innerHTML = renderAutonomousLaunchWorkerAccounts(autonomousAccountId ?? "");
      renderIcons(host);
    }
  });
  document.querySelector<HTMLSelectElement>("#autonomousInterval")?.addEventListener("change", (event) => {
    autonomousIntervalSeconds = Number((event.currentTarget as HTMLSelectElement).value) || 15 * 60;
  });
  document.querySelector<HTMLSelectElement>("#autonomousTriggerKind")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    autonomousTriggerKind = isAutonomousTriggerKind(value) ? value : "schedule";
    if (autonomousTriggerKind === "schedule") autonomousAllowGitPublish = false;
    render();
  });
  document.querySelector<HTMLTextAreaElement>("#autonomousWatchPaths")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLTextAreaElement;
    autonomousWatchPathsDraft = input.value;
    input.setCustomValidity("");
  });
  document.querySelector<HTMLInputElement>("#autonomousDebounceSeconds")?.addEventListener("input", (event) => {
    autonomousDebounceSeconds = Number((event.currentTarget as HTMLInputElement).value) || 10;
  });
  document.querySelector<HTMLInputElement>("#autonomousAllowGitPublish")?.addEventListener("change", (event) => {
    autonomousAllowGitPublish = (event.currentTarget as HTMLInputElement).checked;
  });
  document.querySelector<HTMLSelectElement>("#autonomousMode")?.addEventListener("change", (event) => {
    autonomousMode = (event.currentTarget as HTMLSelectElement).value === "plan" ? "plan" : "build";
  });
  document.querySelector<HTMLSelectElement>("#autonomousEnvironmentPreset")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    autonomousEnvironmentCustom = value === "__custom__";
    autonomousProjectDir = value === "__custom__" ? "" : value;
    render();
    if (autonomousEnvironmentCustom) {
      window.setTimeout(() => document.querySelector<HTMLInputElement>("#autonomousProjectDir")?.focus(), 0);
    }
  });
  const projectInput = document.querySelector<HTMLInputElement>("#autonomousProjectDir");
  projectInput?.addEventListener("input", (event) => {
    autonomousEnvironmentCustom = true;
    autonomousProjectDir = (event.currentTarget as HTMLInputElement).value;
    projectInput.setCustomValidity("");
  });
  document.querySelector<HTMLInputElement>("#autonomousRequireUserReview")?.addEventListener("change", (event) => {
    autonomousRequireUserReview = (event.currentTarget as HTMLInputElement).checked;
  });
  document.querySelectorAll<HTMLInputElement>("[data-autonomous-connector]").forEach((input) => {
    input.addEventListener("change", () => {
      const connectorId = input.dataset.autonomousConnector;
      if (!isAutonomousConnectorId(connectorId)) return;
      autonomousConnectors = toggleAutonomousConnector(autonomousConnectors, connectorId);
      render();
    });
  });
  document.querySelector<HTMLInputElement>("#autonomousTestCommand")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    autonomousTestCommandDraft = input.value;
    input.setCustomValidity("");
    projectInput?.setCustomValidity("");
  });
  document.querySelector<HTMLInputElement>("#autonomousTestTimeout")?.addEventListener("input", (event) => {
    autonomousTestTimeoutSeconds = Number((event.currentTarget as HTMLInputElement).value) || 5 * 60;
  });
  document.querySelector<HTMLFormElement>("#autonomousCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selectedAccountId = document.querySelector<HTMLSelectElement>("#autonomousAccount")?.value;
    const account = accountById(selectedAccountId || autonomousAccountId);
    const normalizedObjective = autonomousObjectiveDraft.trim();
    const launchOrchestration = autonomousLaunchMode === "orchestrator";
    const eventTriggered = !launchOrchestration && autonomousTriggerKind === "workspace_change";
    const watchPaths = parseAutonomousWatchPaths(autonomousWatchPathsDraft);
    if (!normalizedObjective) {
      objective?.setCustomValidity("Décris l'objectif autonome à poursuivre.");
      objective?.reportValidity();
      return;
    }
    if (!account) {
      statusText = "Choisis un compte pour l'agent autonome";
      render();
      return;
    }
    if (
      (launchOrchestration || eventTriggered || autonomousAllowGitPublish || autonomousTestCommandDraft.trim())
      && !autonomousProjectDir.trim()
    ) {
      autonomousEnvironmentCustom = true;
      autonomousCreateOpen = true;
      autonomousCreatePreferenceSet = true;
      render();
      window.setTimeout(() => {
        const input = document.querySelector<HTMLInputElement>("#autonomousProjectDir");
        input?.setCustomValidity(launchOrchestration
          ? "Choisis le dépôt Git dans lequel l'équipe orchestrée travaillera."
          : eventTriggered
            ? "Choisis le projet dans lequel l'agent surveillera les modifications."
            : "Choisis l'environnement dans lequel la commande de test sera exécutée.");
        input?.reportValidity();
      }, 0);
      return;
    }
    if (eventTriggered && !watchPaths.length) {
      const input = document.querySelector<HTMLTextAreaElement>("#autonomousWatchPaths");
      input?.setCustomValidity("Ajoute au moins un fichier ou dossier relatif à surveiller.");
      input?.reportValidity();
      return;
    }
    const testCommandInput = document.querySelector<HTMLInputElement>("#autonomousTestCommand");
    if (launchOrchestration && !autonomousTestCommandDraft.trim()) {
      testCommandInput?.setCustomValidity("Indique la commande qui prouvera le travail de l'équipe.");
      testCommandInput?.reportValidity();
      return;
    }
    const workerAccountIds = launchOrchestration
      ? normalizeAutonomousLaunchWorkerAccounts(account.id).slice(0, autonomousLaunchWorkerCount)
      : [];
    if (launchOrchestration && workerAccountIds.some((workerAccountId) => !accountById(workerAccountId))) {
      statusText = "Choisis un compte valide pour chaque worker";
      render();
      return;
    }
    autonomousBusyId = "create";
    statusText = launchOrchestration
      ? "Préparation de l'agent puis lancement de son orchestration"
      : eventTriggered
        ? "Création et armement de l'agent dormant"
        : "Création de l'agent autonome";
    render();
    let stagedAgent: AutonomousAgentSnapshot | null = null;
    try {
      const created = await invoke<AutonomousAgentSnapshot>("create_autonomous_agent", {
        request: {
          name: autonomousNameDraft.trim() || null,
          objective: normalizedObjective,
          role: autonomousRoleDraft.trim() || null,
          accountId: account.id,
          projectDir: autonomousProjectDir.trim() || null,
          mode: autonomousMode,
          requireUserReview: autonomousRequireUserReview,
          connectors: accountProvider(account) === "codex" ? autonomousConnectors : [],
          model: accountModel(account),
          reasoningEffort: accountProvider(account) === "codex" ? accountReasoningEffort(account) : null,
          intervalSeconds: autonomousIntervalSeconds,
          triggerKind: eventTriggered ? "workspace_change" : "schedule",
          watchPaths: eventTriggered ? watchPaths : [],
          debounceSeconds: Math.max(2, Math.min(600, Math.round(autonomousDebounceSeconds))),
          allowGitPublish: eventTriggered && autonomousAllowGitPublish,
          initialMemory: autonomousInitialMemoryDraft.trim() || null,
          testCommand: autonomousTestCommandDraft.trim() || null,
          testTimeoutSeconds: Math.max(5, Math.min(1800, Math.round(autonomousTestTimeoutSeconds))),
          deferFirstRun: launchOrchestration,
        },
      });
      updateAutonomousAgentLocally(created);
      stagedAgent = created;
      if (launchOrchestration) {
        const context = [
          normalizedObjective,
          autonomousRoleDraft.trim() ? `Rôle de l'orchestrateur : ${autonomousRoleDraft.trim()}` : "",
          autonomousInitialMemoryDraft.trim()
            ? `Contexte initial durable : ${autonomousInitialMemoryDraft.trim()}`
            : "",
        ].filter(Boolean).join("\n\n");
        const orchestration = await invoke<OrchestrationSnapshot>(
          "promote_autonomous_agent_to_orchestration",
          {
            id: created.id,
            request: {
              name: autonomousNameDraft.trim() || null,
              objective: context,
              workerCount: autonomousLaunchWorkerCount,
              workerAccountIds,
              projectDir: autonomousProjectDir.trim(),
              testCommand: autonomousTestCommandDraft.trim(),
              testTimeoutSeconds: Math.max(5, Math.min(1800, Math.round(autonomousTestTimeoutSeconds))),
            },
          },
        );
        autonomousAgents = autonomousAgents.filter((agent) => agent.id !== created.id);
        autonomousAgentsSignature = JSON.stringify(autonomousAgents);
        updateOrchestrationLocally(orchestration);
      }
      autonomousNameDraft = "";
      autonomousObjectiveDraft = "";
      autonomousRoleDraft = "";
      autonomousInitialMemoryDraft = "";
      autonomousTemplateId = null;
      autonomousConnectors = [];
      autonomousTestCommandDraft = "";
      autonomousTriggerKind = "schedule";
      autonomousWatchPathsDraft = "src\npublic\nindex.html\npackage.json";
      autonomousDebounceSeconds = 10;
      autonomousAllowGitPublish = false;
      autonomousLaunchWorkerAccountIds = [];
      autonomousLaunchMode = "autonomous";
      autonomousCreateOpen = false;
      autonomousCreatePreferenceSet = true;
      if (launchOrchestration) {
        setActiveView("orchestration");
        statusText = "Agent lancé directement en mode orchestrateur";
      } else if (eventTriggered) {
        statusText = "Agent dormant créé et armé ; il attend une future modification stable";
      } else {
        statusText = "Agent autonome créé ; première étape planifiée";
      }
    } catch (error) {
      if (stagedAgent && launchOrchestration) {
        autonomousCreateOpen = false;
        autonomousCreatePreferenceSet = true;
        statusText = `L'orchestration n'a pas démarré ; l'agent préparé reste en pause : ${String(error)}`;
      } else {
        statusText = String(error);
      }
    } finally {
      autonomousBusyId = null;
      render();
      void refreshAutonomousAgents();
      if (launchOrchestration) void refreshOrchestrations();
    }
  });

  document.querySelector<HTMLButtonElement>("#autonomousRefresh")?.addEventListener("click", () => {
    void refreshAutonomousAgents(true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-monitor-open]").forEach((button) => {
    button.addEventListener("click", () => openAutonomousMonitor(button.dataset.autonomousMonitorOpen));
  });
  document.querySelectorAll<HTMLSelectElement>(".autonomous-panel [data-autonomous-account]").forEach((select) => {
    select.addEventListener("change", async () => {
      const id = select.dataset.autonomousAccount;
      const account = accountById(select.value);
      if (!id || !account || autonomousBusyId) return;
      autonomousBusyId = id;
      statusText = `Réaffectation de l'agent à ${account.label}`;
      render();
      try {
        const updated = await invoke<AutonomousAgentSnapshot>(
          "reassign_autonomous_agent_account",
          { id, request: { accountId: account.id } },
        );
        updateAutonomousAgentLocally(updated);
        statusText = `L'agent autonome utilisera maintenant ${account.label}`;
      } catch (error) {
        statusText = `Changement de compte annulé : ${String(error)}`;
      } finally {
        autonomousBusyId = null;
        render();
        void refreshAutonomousAgents();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>(".autonomous-panel [data-autonomous-orchestrate]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.autonomousOrchestrate;
      if (id) openAutonomousOrchestrationPromotion(id);
    });
  });
  document.querySelectorAll<HTMLFormElement>("[data-autonomous-memory-form]").forEach((form) => {
    const id = form.dataset.autonomousMemoryForm;
    const input = form.querySelector<HTMLInputElement>("input");
    input?.addEventListener("input", () => {
      if (id) autonomousMemoryDrafts.set(id, input.value);
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const content = input?.value.trim() ?? "";
      if (!id || !content) {
        input?.focus();
        return;
      }
      autonomousMemoryDrafts.set(id, content);
      autonomousBusyId = id;
      render();
      try {
        const updated = await invoke<AutonomousAgentSnapshot>("add_autonomous_agent_memory", { id, content });
        updateAutonomousAgentLocally(updated);
        autonomousMemoryDrafts.delete(id);
        statusText = "Souvenir ajouté à la mémoire durable";
      } catch (error) {
        statusText = String(error);
      } finally {
        autonomousBusyId = null;
        render();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-memory-delete]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.autonomousId;
      const memoryId = button.dataset.autonomousMemoryDelete;
      if (!id || !memoryId) return;
      autonomousBusyId = id;
      render();
      try {
        const updated = await invoke<AutonomousAgentSnapshot>("delete_autonomous_agent_memory", { id, memoryId });
        updateAutonomousAgentLocally(updated);
        statusText = "Souvenir supprimé";
      } catch (error) {
        statusText = String(error);
      } finally {
        autonomousBusyId = null;
        render();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.autonomousId;
      const action = button.dataset.autonomousAction as AutonomousAgentAction | undefined;
      if (!id || !action) return;
      autonomousBusyId = id;
      render();
      try {
        const updated = await invoke<AutonomousAgentSnapshot>("control_autonomous_agent", { id, action });
        updateAutonomousAgentLocally(updated);
        statusText = action === "pause"
          ? "Agent autonome mis en pause"
          : action === "resume"
            ? "Agent autonome repris"
            : action === "testNow"
              ? "Validation de l'agent démarrée"
              : "Exécution autonome planifiée";
      } catch (error) {
        statusText = String(error);
      } finally {
        autonomousBusyId = null;
        render();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousDeletePendingId = button.dataset.autonomousDelete ?? null;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-delete-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      autonomousDeletePendingId = null;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-autonomous-delete-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.autonomousDeleteConfirm;
      if (!id) return;
      await deleteAutonomousAgent(id);
    });
  });
  bindAutonomousAgentEditUi();
  bindAutonomousScheduleUi(document.querySelector(".autonomous-panel"));
};

const orchestrationAccountLabel = (accountId: string): string =>
  accountById(accountId)?.label ?? accountId;

const orchestrationAccountOptions = (selectedAccountId: string): string => {
  const known = settings?.accounts ?? [];
  const missing = selectedAccountId && !known.some((account) => account.id === selectedAccountId)
    ? `<option value="${escapeAttr(selectedAccountId)}" selected>Compte indisponible · ${escapeHtml(selectedAccountId)}</option>`
    : "";
  return missing + known.map((account) => `
    <option value="${escapeAttr(account.id)}" ${account.id === selectedAccountId ? "selected" : ""}>
      ${escapeHtml(account.label)} · ${escapeHtml(providerLabel(accountProvider(account)))}
    </option>`).join("");
};

const normalizeOrchestrationWorkerDrafts = (
  workerCount: number,
  fallbackAccountId: string,
): string[] => {
  orchestrationWorkerAccountIds = Array.from({ length: workerCount }, (_, index) => {
    const current = orchestrationWorkerAccountIds[index];
    return accountById(current)?.id ?? fallbackAccountId;
  });
  return orchestrationWorkerAccountIds;
};

const orchestrationAssignmentKey = (
  runId: string,
  role: OrchestrationAccountRole,
  workerIndex?: number,
): string => `${runId}:${role}:${workerIndex ?? 0}`;

const orchestrationMemberIsCurrent = (
  run: OrchestrationSnapshot,
  role: OrchestrationAccountRole,
  task: OrchestrationTask | null,
): boolean => {
  if (run.status !== "active" || (!run.currentTurnId && !run.currentStartId)) return false;
  if (role === "orchestrator") return run.currentTurnKind !== "worker";
  return run.currentTurnKind === "worker" && run.currentTaskId === task?.id;
};

const renderOrchestrationMember = (
  run: OrchestrationSnapshot,
  role: OrchestrationAccountRole,
  workerIndex: number | null,
  task: OrchestrationTask | null,
): string => {
  const accountId = role === "orchestrator"
    ? orchestrationOrchestratorAccountId(run)
    : task
      ? orchestrationWorkerAccountId(run, task)
      : run.workerAccountIds?.[(workerIndex ?? 1) - 1] || run.accountId;
  const account = accountById(accountId);
  const sessionId = role === "orchestrator" ? run.orchestratorSessionId : task?.sessionId ?? null;
  const handoffPending = role === "orchestrator"
    ? !!run.orchestratorHandoffPending
    : !!task?.handoffPending;
  const handoffCount = role === "orchestrator"
    ? run.orchestratorHandoffCount ?? 0
    : task?.handoffCount ?? 0;
  const assignmentKey = orchestrationAssignmentKey(run.id, role, workerIndex ?? undefined);
  const assignmentBusy = orchestrationAssignmentBusy === assignmentKey;
  const isCurrent = orchestrationMemberIsCurrent(run, role, task);
  const roleName = role === "orchestrator" ? "Orchestrateur" : `Worker ${workerIndex}`;
  const status = role === "orchestrator"
    ? orchestrationPhaseLabel(run.phase)
    : task
      ? orchestrationTaskStatusLabel(task.status)
      : "En attente du plan";
  const chatAction = sessionId
    ? `<button type="button" class="icon-button" data-orchestration-open-session="${escapeAttr(sessionId)}" data-orchestration-account="${escapeAttr(accountId)}" title="Ouvrir le chat de ${escapeAttr(roleName)}"><i data-lucide="message-square"></i></button>`
    : `<span class="orchestration-member-chat-pending" title="La session apparaîtra au prochain tour"><i data-lucide="clock-3"></i></span>`;
  return `<article class="orchestration-member ${role} ${isCurrent ? "is-current" : ""} ${handoffPending ? "has-handoff" : ""}">
    <span class="orchestration-member-avatar"><i data-lucide="${role === "orchestrator" ? "brain-circuit" : "bot"}"></i></span>
    <div class="orchestration-member-copy"><small>${escapeHtml(roleName)}</small><strong>${escapeHtml(task?.title || (role === "orchestrator" ? "Pilotage, revue et validation" : "Mission en préparation"))}</strong><span>${escapeHtml(status)}</span></div>
    <div class="orchestration-member-state">
      ${isCurrent ? '<b class="orchestration-live-pill"><i></i>En cours</b>' : ""}
      ${handoffPending ? '<b class="orchestration-handoff-pill">Reprise préparée</b>' : handoffCount ? `<b class="orchestration-handoff-pill is-done">${handoffCount} reprise${handoffCount > 1 ? "s" : ""}</b>` : ""}
    </div>
    <label class="orchestration-member-account">
      <span>Adresse e-mail / compte</span>
      <select data-orchestration-account-role="${role}" data-orchestration-run-id="${escapeAttr(run.id)}" ${workerIndex ? `data-orchestration-worker-index="${workerIndex}"` : ""} aria-label="Adresse e-mail ou compte de ${escapeAttr(roleName)}" ${orchestrationAssignmentBusy || !settings?.accounts.length ? "disabled" : ""}>
        ${orchestrationAccountOptions(accountId)}
      </select>
      <small>${escapeHtml(account ? providerLabel(accountProvider(account)) : "Compte supprimé")} · changement avec reprise de session</small>
    </label>
    <div class="orchestration-member-chat">${assignmentBusy ? '<i class="orchestration-member-loader" data-lucide="loader-circle"></i>' : chatAction}</div>
  </article>`;
};

const renderOrchestrationTeam = (run: OrchestrationSnapshot): string => {
  const workers = Array.from({ length: run.workerCount }, (_, offset) => {
    const workerIndex = offset + 1;
    const task = run.tasks.find((candidate) => candidate.position === workerIndex) ?? null;
    return renderOrchestrationMember(run, "worker", workerIndex, task);
  }).join("");
  return `<section class="orchestration-team-console">
    <header><span><small>Équipe et comptes</small><strong>Postes de reprise</strong></span><p>Chaque membre garde son historique et peut être repris indépendamment par un autre compte.</p></header>
    <div class="orchestration-team-list">
      ${renderOrchestrationMember(run, "orchestrator", null, null)}
      ${workers}
    </div>
  </section>`;
};

const renderOrchestrationTask = (
  run: OrchestrationSnapshot,
  task: OrchestrationTask,
): string => {
  const latestReview = task.reviews.at(-1) ?? null;
  const evidence = task.evidence;
  const tests = evidence?.tests
    .map((test) => `<li class="${test.passed ? "passed" : "failed"}"><i data-lucide="${test.passed ? "check" : "circle-alert"}"></i><span><code>${escapeHtml(test.command)}</code><small>${escapeHtml(test.result)}</small></span></li>`)
    .join("") ?? "";
  const files = evidence?.filesChanged
    .map((file) => `<code>${escapeHtml(file)}</code>`)
    .join("") ?? "";
  const chatAction = task.sessionId
    ? `<button type="button" class="tool-button" data-orchestration-open-session="${escapeAttr(task.sessionId)}" data-orchestration-account="${escapeAttr(orchestrationWorkerAccountId(run, task))}"><i data-lucide="message-square"></i><span>Ouvrir le chat</span></button>`
    : `<span class="orchestration-chat-pending"><i data-lucide="clock-3"></i>Chat créé dès que cette tâche démarre</span>`;
  return `<article class="orchestration-task status-${escapeAttr(task.status)}">
    <header>
      <span class="orchestration-task-index">${task.position}</span>
      <div><strong>${escapeHtml(task.title)}</strong><small>${escapeHtml(orchestrationTaskStatusLabel(task.status))} · ${task.attemptCount} tentative${task.attemptCount > 1 ? "s" : ""}</small></div>
      <span class="orchestration-task-state"><i data-lucide="${task.status === "accepted" ? "shield-check" : task.status === "revision_requested" ? "reply" : "bot"}"></i></span>
    </header>
    <p>${escapeHtml(task.description)}</p>
    <details>
      <summary><span>Critères, preuve et revues</span><i data-lucide="chevron-down"></i></summary>
      <div class="orchestration-task-details">
        <section><small>Critères d’acceptation</small><ul>${task.acceptanceCriteria.map((criterion) => `<li>${escapeHtml(criterion)}</li>`).join("")}</ul></section>
        ${evidence ? `<section class="orchestration-proof"><small>Preuve du travailleur</small><p>${escapeHtml(evidence.summary)}</p><div class="orchestration-proof-files">${files}</div><ul>${tests}</ul>${evidence.risks.length ? `<p class="orchestration-risk"><b>Risques déclarés :</b> ${escapeHtml(evidence.risks.join(" · "))}</p>` : ""}</section>` : ""}
        ${latestReview ? `<section class="orchestration-review decision-${latestReview.decision}"><small>Dernière revue orchestrateur · ${latestReview.decision === "accept" ? "acceptée" : "correction demandée"}</small><p>${escapeHtml(latestReview.summary)}</p>${latestReview.feedback ? `<p>${escapeHtml(latestReview.feedback)}</p>` : ""}</section>` : ""}
        ${task.lastError ? `<p class="orchestration-error"><i data-lucide="circle-alert"></i><span>${escapeHtml(task.lastError)}</span></p>` : ""}
        <div class="orchestration-task-actions">${chatAction}${task.workspaceDir ? `<span title="${escapeAttr(task.workspaceDir)}"><i data-lucide="folder-open"></i>Sandbox #${task.workspaceGeneration}</span>` : ""}</div>
      </div>
    </details>
  </article>`;
};

const renderOrchestrationCard = (run: OrchestrationSnapshot): string => {
  const progress = orchestrationProgress(run);
  const running = orchestrationIsRunning(run);
  const busy = orchestrationBusyId === run.id
    || String(orchestrationAssignmentBusy ?? "").startsWith(`${run.id}:`);
  const deletePending = orchestrationDeletePendingId === run.id;
  const events = run.events.slice(-5).reverse().map((event) => `<li><time>${escapeHtml(formatAutonomousTimestamp(event.timestamp))}</time><span>${escapeHtml(event.message)}</span></li>`).join("");
  const controls = run.status === "completed"
    ? ""
    : run.status === "active"
      ? `<button type="button" class="tool-button" data-orchestration-action="pause" data-orchestration-id="${escapeAttr(run.id)}" ${busy ? "disabled" : ""}><i data-lucide="pause"></i><span>Pause</span></button>`
      : `<button type="button" class="tool-button primary" data-orchestration-action="${run.status === "needs_attention" ? "retry" : "resume"}" data-orchestration-id="${escapeAttr(run.id)}" ${busy ? "disabled" : ""}><i data-lucide="play"></i><span>${run.status === "needs_attention" ? "Réessayer" : "Reprendre"}</span></button>`;
  const orchestratorChat = run.orchestratorSessionId
    ? `<button type="button" class="tool-button" data-orchestration-open-session="${escapeAttr(run.orchestratorSessionId)}" data-orchestration-account="${escapeAttr(orchestrationOrchestratorAccountId(run))}"><i data-lucide="brain-circuit"></i><span>Chat orchestrateur</span></button>`
    : "";
  const deleteAction = deletePending
    ? `<span class="orchestration-delete-confirm"><small>Supprimer les sandboxes ?</small><button type="button" class="tool-button danger" data-orchestration-delete-confirm="${escapeAttr(run.id)}" ${busy ? "disabled" : ""}>Supprimer</button><button type="button" class="tool-button" data-orchestration-delete-cancel>Annuler</button></span>`
    : `<button type="button" class="icon-button danger" data-orchestration-delete="${escapeAttr(run.id)}" title="Supprimer ce chat orchestré" ${busy ? "disabled" : ""}><i data-lucide="trash-2"></i></button>`;
  const workerCount = Math.max(1, run.workerCount || run.tasks.length || 1);
  return `<article class="orchestration-card orchestration-command-center status-${escapeAttr(run.status)} ${running ? "is-running" : ""}">
    <header class="orchestration-card-head">
      <span class="orchestration-orb"><i data-lucide="users"></i></span>
      <div><span class="orchestration-status"><i></i>${escapeHtml(orchestrationStatusLabel(run.status))}</span><h3>${escapeHtml(run.name)}</h3><small>${escapeHtml(orchestrationPhaseLabel(run.phase))}</small></div>
      ${deleteAction}
    </header>
    <p class="orchestration-objective">${escapeHtml(run.objective)}</p>
    <div class="orchestration-progress" aria-label="${progress.accepted} tâches acceptées sur ${progress.total}"><span><i style="width:${progress.percent}%"></i></span><small><b>${progress.accepted}/${progress.total || "–"}</b> tâches intégrées · ${progress.percent}%</small></div>
    <dl class="orchestration-meta">
      <div><dt>Orchestrateur</dt><dd>${escapeHtml(orchestrationAccountLabel(orchestrationOrchestratorAccountId(run)))}</dd></div>
      <div><dt>Équipe</dt><dd>1 orchestrateur + ${workerCount} worker${workerCount > 1 ? "s" : ""}</dd></div>
      <div><dt>Projet</dt><dd title="${escapeAttr(run.projectDir)}">${escapeHtml(workspaceBaseName(run.projectDir))}</dd></div>
      <div><dt>Validation</dt><dd><code>${escapeHtml(run.testCommand)}</code></dd></div>
      <div><dt>Isolation</dt><dd>${workerCount + 1} environnements</dd></div>
    </dl>
    ${renderOrchestrationTeam(run)}
    ${run.planSummary ? `<section class="orchestration-plan-summary"><small>Plan de l’orchestrateur</small><p>${escapeHtml(run.planSummary)}</p></section>` : ""}
    ${run.lastError ? `<p class="orchestration-error"><i data-lucide="circle-alert"></i><span>${escapeHtml(run.lastError)}</span></p>` : ""}
    <section class="orchestration-missions"><header><span><small>Exécution contrôlée</small><strong>Missions, preuves et revues</strong></span><b>${progress.accepted}/${progress.total || "–"}</b></header><div class="orchestration-task-list">${run.tasks.map((task) => renderOrchestrationTask(run, task)).join("") || `<div class="orchestration-planning"><i data-lucide="list-checks"></i><span><strong>L’orchestrateur construit le plan</strong><small>Les chats travailleurs apparaîtront ici.</small></span></div>`}</div></section>
    ${run.finalSummary ? `<section class="orchestration-final"><i data-lucide="shield-check"></i><div><small>Rendu final</small><p>${escapeHtml(run.finalSummary)}</p></div></section>` : ""}
    <details class="orchestration-journal"><summary><span><i data-lucide="history"></i>Journal de contrôle</span><i data-lucide="chevron-down"></i></summary><ul>${events || "<li>Aucun événement</li>"}</ul></details>
    <footer><div>${controls}${orchestratorChat}</div><small><i data-lucide="folder-open"></i><span title="${escapeAttr(run.sandboxRoot)}">Sandboxes privés conservés jusqu’à suppression</span></small></footer>
  </article>`;
};

const renderOrchestrationPanel = (): string => {
  const accountId = accountById(orchestrationAccountId)?.id ?? settings?.defaultAccountId ?? settings?.accounts[0]?.id ?? "";
  const accountOptions = orchestrationAccountOptions(accountId);
  const workerAccountIds = normalizeOrchestrationWorkerDrafts(orchestrationWorkerCount, accountId);
  const workerDrafts = workerAccountIds.map((workerAccountId, index) => `<label class="orchestration-create-worker">
    <span><b>W${index + 1}</b><span><strong>Worker ${index + 1}</strong><small>Adresse modifiable après création</small></span></span>
    <select data-orchestration-worker-draft="${index}" aria-label="Adresse e-mail ou compte du worker ${index + 1}" ${accountOptions ? "" : "disabled"}>${orchestrationAccountOptions(workerAccountId)}</select>
  </label>`).join("");
  const activeCount = orchestrations.filter((run) => run.status === "active").length;
  const completedCount = orchestrations.filter((run) => run.status === "completed").length;
  const revisionCount = orchestrations.flatMap((run) => run.tasks).filter((task) => task.status === "revision_requested").length;
  const createOpen = orchestrationCreateOpen
    || (!orchestrationCreatePreferenceSet && orchestrationsLoaded && orchestrations.length === 0);
  const selectedRun = orchestrations.find((run) => run.id === orchestrationSelectedRunId)
    ?? orchestrations[0]
    ?? null;
  if (selectedRun && orchestrationSelectedRunId !== selectedRun.id) {
    orchestrationSelectedRunId = selectedRun.id;
  }
  const runRail = orchestrations.map((run) => {
    const progress = orchestrationProgress(run);
    const selected = run.id === selectedRun?.id;
    return `<button type="button" class="orchestration-run-entry status-${escapeAttr(run.status)} ${selected ? "active" : ""}" data-orchestration-select-run="${escapeAttr(run.id)}" aria-pressed="${selected}">
      <span class="orchestration-run-entry-status"><i></i><b>${escapeHtml(orchestrationStatusLabel(run.status))}</b></span>
      <strong>${escapeHtml(run.name)}</strong>
      <small>${escapeHtml(orchestrationPhaseLabel(run.phase))}</small>
      <span class="orchestration-run-entry-progress"><i style="width:${progress.percent}%"></i></span>
      <span><b>${progress.accepted}/${progress.total || "–"}</b><small>${run.workerCount} worker${run.workerCount > 1 ? "s" : ""}</small></span>
    </button>`;
  }).join("");
  return `<div class="panel orchestration-panel">
    <header class="orchestration-page-head">
      <div><span class="orchestration-page-mark"><i data-lucide="users"></i></span><span><small>Plan · travailleurs · preuves · revue</small><h2>Chats orchestrés</h2><p>Un orchestrateur découpe la feature, ouvre un chat isolé par tâche, vérifie chaque preuve dans son propre environnement puis rend le diff final.</p></span></div>
      <button id="orchestrationNew" type="button" class="tool-button primary"><i data-lucide="plus"></i><span>Nouveau chat orchestré</span></button>
    </header>
    <section class="orchestration-overview">
      <article><i data-lucide="users"></i><span><strong>${orchestrations.length}</strong><small>Orchestrations</small></span></article>
      <article><i data-lucide="play"></i><span><strong>${activeCount}</strong><small>En cours</small></span></article>
      <article><i data-lucide="reply"></i><span><strong>${revisionCount}</strong><small>Retours travailleurs</small></span></article>
      <article><i data-lucide="shield-check"></i><span><strong>${completedCount}</strong><small>Rendus validés</small></span></article>
    </section>
    <details id="orchestrationCreateShell" class="orchestration-create" ${createOpen ? "open" : ""}>
      <summary><span><i data-lucide="target"></i><strong>Configurer une feature orchestrée</strong><small>Dépôt Git propre et commande de validation obligatoires.</small></span><i data-lucide="chevron-down"></i></summary>
      <form id="orchestrationCreateForm">
        <label><span>Nom <small>optionnel</small></span><input id="orchestrationName" maxlength="120" value="${escapeAttr(orchestrationNameDraft)}" placeholder="Ex. Nouveau système de permissions" /></label>
        <label class="orchestration-objective-field"><span>Objectif <small>obligatoire</small></span><textarea id="orchestrationObjective" maxlength="65536" required placeholder="Décris la feature complète et le résultat observable…">${escapeHtml(orchestrationObjectiveDraft)}</textarea></label>
        <div class="orchestration-form-grid">
          <label><span>Adresse e-mail / compte orchestrateur</span><select id="orchestrationAccount" required ${accountOptions ? "" : "disabled"}>${accountOptions || '<option value="">Aucun compte</option>'}</select></label>
          <label><span>Dépôt Git propre</span><input id="orchestrationProjectDir" required value="${escapeAttr(orchestrationProjectDir)}" placeholder="C:/projets/mon-app" /></label>
          <label class="orchestration-test-field"><span>Commande de validation réelle</span><input id="orchestrationTestCommand" required maxlength="8000" value="${escapeAttr(orchestrationTestCommandDraft)}" placeholder="npm test && npm run build" /></label>
          <label><span>Workers <small>hors orchestrateur</small></span><span class="orchestration-worker-count"><input id="orchestrationWorkerCount" type="number" min="1" max="12" step="1" required value="${orchestrationWorkerCount}" /><small id="orchestrationTeamTotal">${orchestrationWorkerCount + 1} agents au total</small></span></label>
          <label><span>Timeout</span><span class="orchestration-timeout"><input id="orchestrationTestTimeout" type="number" min="5" max="1800" value="${orchestrationTestTimeoutSeconds}" /><small>secondes</small></span></label>
        </div>
        <section class="orchestration-create-team">
          <header><span><small>Affectations initiales</small><strong>Choisir l'adresse de chaque worker</strong></span><button id="orchestrationWorkersUseOrchestrator" type="button" class="tool-button"><i data-lucide="copy-check"></i><span>Même compte pour tous</span></button></header>
          <div>${workerDrafts}</div>
        </section>
        <aside><i data-lucide="shield-check"></i><span><strong>Publication prudente</strong><small>Le rendu n’est appliqué au dossier source que si son commit et son état sont restés inchangés. Les changements finaux restent non commités.</small></span></aside>
        <footer><small><i data-lucide="circle-alert"></i>Les workers s’exécutent séquentiellement pour garantir une base d’intégration déterministe.</small><button type="submit" class="tool-button primary" ${accountOptions && orchestrationBusyId !== "create" ? "" : "disabled"}><i data-lucide="play"></i><span>${orchestrationBusyId === "create" ? "Création…" : "Créer l’orchestrateur"}</span></button></footer>
      </form>
    </details>
    <section class="orchestration-runs orchestration-workbench">
      <aside class="orchestration-run-rail">
        <header><span><small>Centre de commande</small><strong>Orchestrations</strong></span><button id="orchestrationRefresh" type="button" class="icon-button" title="Actualiser"><i data-lucide="refresh-ccw"></i></button></header>
        <div>${!orchestrationsLoaded ? `<div class="orchestration-run-loading"><i data-lucide="loader-circle"></i><span>Chargement…</span></div>` : runRail || `<div class="orchestration-run-loading"><i data-lucide="users"></i><span>Aucune orchestration</span></div>`}</div>
      </aside>
      <main class="orchestration-workbench-main">${!orchestrationsLoaded ? `<div class="orchestration-empty"><i data-lucide="loader-circle"></i><strong>Chargement…</strong></div>` : selectedRun ? renderOrchestrationCard(selectedRun) : `<div class="orchestration-empty"><i data-lucide="users"></i><strong>Aucun chat orchestré</strong><span>Crée une première feature pour lancer le planificateur.</span></div>`}</main>
    </section>
  </div>`;
};

const updateOrchestrationLocally = (updated: OrchestrationSnapshot) => {
  const index = orchestrations.findIndex((run) => run.id === updated.id);
  if (index >= 0) orchestrations[index] = updated;
  else orchestrations.unshift(updated);
  orchestrationSelectedRunId = updated.id;
  orchestrationsSignature = JSON.stringify(orchestrations);
  orchestrationsLoaded = true;
};

const bindOrchestrationPanelUi = () => {
  const createShell = document.querySelector<HTMLDetailsElement>("#orchestrationCreateShell");
  createShell?.addEventListener("toggle", () => {
    orchestrationCreatePreferenceSet = true;
    orchestrationCreateOpen = createShell.open;
  });
  document.querySelector<HTMLButtonElement>("#orchestrationNew")?.addEventListener("click", () => {
    if (!createShell) return;
    createShell.open = true;
    orchestrationCreateOpen = true;
    orchestrationCreatePreferenceSet = true;
    createShell.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => document.querySelector<HTMLInputElement>("#orchestrationName")?.focus(), 200);
  });
  document.querySelector<HTMLInputElement>("#orchestrationName")?.addEventListener("input", (event) => {
    orchestrationNameDraft = (event.currentTarget as HTMLInputElement).value;
  });
  const objective = document.querySelector<HTMLTextAreaElement>("#orchestrationObjective");
  objective?.addEventListener("input", () => {
    orchestrationObjectiveDraft = objective.value;
    objective.setCustomValidity("");
  });
  const project = document.querySelector<HTMLInputElement>("#orchestrationProjectDir");
  project?.addEventListener("input", () => {
    orchestrationProjectDir = project.value;
    project.setCustomValidity("");
  });
  const testCommand = document.querySelector<HTMLInputElement>("#orchestrationTestCommand");
  testCommand?.addEventListener("input", () => {
    orchestrationTestCommandDraft = testCommand.value;
    testCommand.setCustomValidity("");
  });
  document.querySelector<HTMLSelectElement>("#orchestrationAccount")?.addEventListener("change", (event) => {
    orchestrationAccountId = (event.currentTarget as HTMLSelectElement).value || null;
  });
  document.querySelectorAll<HTMLSelectElement>("[data-orchestration-worker-draft]").forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.orchestrationWorkerDraft);
      if (Number.isInteger(index) && index >= 0) {
        orchestrationWorkerAccountIds[index] = select.value;
      }
    });
  });
  document.querySelector<HTMLButtonElement>("#orchestrationWorkersUseOrchestrator")?.addEventListener("click", () => {
    const selected = document.querySelector<HTMLSelectElement>("#orchestrationAccount")?.value
      || orchestrationAccountId
      || "";
    orchestrationWorkerAccountIds = Array.from({ length: orchestrationWorkerCount }, () => selected);
    render();
  });
  document.querySelector<HTMLInputElement>("#orchestrationTestTimeout")?.addEventListener("input", (event) => {
    orchestrationTestTimeoutSeconds = Number((event.currentTarget as HTMLInputElement).value) || 600;
  });
  const workerCountInput = document.querySelector<HTMLInputElement>("#orchestrationWorkerCount");
  workerCountInput?.addEventListener("input", () => {
    const value = Number(workerCountInput.value);
    if (Number.isInteger(value)) orchestrationWorkerCount = value;
    workerCountInput.setCustomValidity("");
    const total = document.querySelector<HTMLElement>("#orchestrationTeamTotal");
    if (total && Number.isInteger(value) && value >= 1 && value <= 12) {
      total.textContent = `${value + 1} agents au total`;
    }
  });
  workerCountInput?.addEventListener("change", () => {
    const value = Number(workerCountInput.value);
    if (!Number.isInteger(value) || value < 1 || value > 12) return;
    orchestrationWorkerCount = value;
    normalizeOrchestrationWorkerDrafts(
      value,
      orchestrationAccountId || settings?.defaultAccountId || settings?.accounts[0]?.id || "",
    );
    render();
  });
  document.querySelector<HTMLFormElement>("#orchestrationCreateForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const account = accountById(document.querySelector<HTMLSelectElement>("#orchestrationAccount")?.value || orchestrationAccountId);
    if (!objective?.value.trim()) {
      objective?.setCustomValidity("Décris la feature à construire.");
      objective?.reportValidity();
      return;
    }
    if (!project?.value.trim()) {
      project?.setCustomValidity("Choisis un dépôt Git propre.");
      project?.reportValidity();
      return;
    }
    if (!testCommand?.value.trim()) {
      testCommand?.setCustomValidity("Indique la commande qui prouve que le projet fonctionne.");
      testCommand?.reportValidity();
      return;
    }
    const workerCount = Number(workerCountInput?.value);
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 12) {
      workerCountInput?.setCustomValidity("Choisis entre 1 et 12 workers, sans compter l’orchestrateur.");
      workerCountInput?.reportValidity();
      return;
    }
    if (!account) {
      statusText = "Choisis un compte pour l’équipe d’agents";
      render();
      return;
    }
    const workerAccountIds = normalizeOrchestrationWorkerDrafts(workerCount, account.id).slice();
    if (workerAccountIds.some((workerAccountId) => !accountById(workerAccountId))) {
      statusText = "Choisis un compte valide pour chaque worker";
      render();
      return;
    }
    orchestrationBusyId = "create";
    statusText = "Création du sandbox orchestrateur";
    render();
    try {
      const created = await invoke<OrchestrationSnapshot>("create_orchestration", {
        request: {
          name: orchestrationNameDraft.trim() || null,
          objective: orchestrationObjectiveDraft.trim(),
          workerCount,
          accountId: account.id,
          orchestratorAccountId: account.id,
          workerAccountIds,
          projectDir: orchestrationProjectDir.trim(),
          model: accountModel(account),
          reasoningEffort: accountProvider(account) === "codex" ? accountReasoningEffort(account) : null,
          testCommand: orchestrationTestCommandDraft.trim(),
          testTimeoutSeconds: Math.max(5, Math.min(1800, Math.round(orchestrationTestTimeoutSeconds))),
        },
      });
      updateOrchestrationLocally(created);
      orchestrationNameDraft = "";
      orchestrationObjectiveDraft = "";
      orchestrationCreateOpen = false;
      orchestrationCreatePreferenceSet = true;
      statusText = "Orchestrateur créé ; planification démarrée";
    } catch (error) {
      statusText = String(error);
    } finally {
      orchestrationBusyId = null;
      render();
      void refreshOrchestrations();
    }
  });
  document.querySelector<HTMLButtonElement>("#orchestrationRefresh")?.addEventListener("click", () => {
    void refreshOrchestrations(true);
  });
  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-select-run]").forEach((button) => {
    button.addEventListener("click", () => {
      orchestrationSelectedRunId = button.dataset.orchestrationSelectRun ?? null;
      render();
    });
  });
  document.querySelectorAll<HTMLSelectElement>("[data-orchestration-account-role]").forEach((select) => {
    select.addEventListener("change", async () => {
      const id = select.dataset.orchestrationRunId;
      const role = select.dataset.orchestrationAccountRole as OrchestrationAccountRole | undefined;
      const workerIndex = role === "worker"
        ? Number(select.dataset.orchestrationWorkerIndex)
        : undefined;
      const accountId = select.value;
      if (
        !id
        || (role !== "orchestrator" && role !== "worker")
        || (role === "worker" && (!Number.isInteger(workerIndex) || !workerIndex))
        || !accountById(accountId)
      ) return;
      const key = orchestrationAssignmentKey(id, role, workerIndex);
      orchestrationAssignmentBusy = key;
      const memberLabel = role === "orchestrator" ? "l’orchestrateur" : `le worker ${workerIndex}`;
      statusText = `Préparation de la reprise de ${memberLabel}`;
      render();
      try {
        const updated = await invoke<OrchestrationSnapshot>("reassign_orchestration_account", {
          id,
          request: { role, workerIndex, accountId },
        });
        updateOrchestrationLocally(updated);
        await refreshDiscussions();
        syncOrchestrationChatPanes();
        statusText = `${memberLabel[0].toUpperCase()}${memberLabel.slice(1)} est maintenant repris par ${orchestrationAccountLabel(accountId)}`;
      } catch (error) {
        statusText = `Reprise annulée : ${String(error)}`;
      } finally {
        orchestrationAssignmentBusy = null;
        render();
        void refreshOrchestrations();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.orchestrationId;
      const action = button.dataset.orchestrationAction as OrchestrationAction | undefined;
      if (!id || !action) return;
      orchestrationBusyId = id;
      render();
      try {
        const updated = await invoke<OrchestrationSnapshot>("control_orchestration", { id, action });
        updateOrchestrationLocally(updated);
        statusText = action === "pause" ? "Chat orchestré mis en pause" : "Chat orchestré repris";
      } catch (error) {
        statusText = String(error);
      } finally {
        orchestrationBusyId = null;
        render();
      }
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-open-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sessionId = button.dataset.orchestrationOpenSession;
      const accountId = button.dataset.orchestrationAccount;
      if (!sessionId || !accountId) return;
      await refreshDiscussions();
      openDiscussionForSession(accountId, sessionId);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      orchestrationDeletePendingId = button.dataset.orchestrationDelete ?? null;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-delete-cancel]").forEach((button) => {
    button.addEventListener("click", () => {
      orchestrationDeletePendingId = null;
      render();
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-orchestration-delete-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.orchestrationDeleteConfirm;
      if (!id) return;
      orchestrationBusyId = id;
      render();
      try {
        await invoke("delete_orchestration", { id });
        orchestrations = orchestrations.filter((run) => run.id !== id);
        if (orchestrationSelectedRunId === id) {
          orchestrationSelectedRunId = orchestrations[0]?.id ?? null;
        }
        orchestrationsSignature = JSON.stringify(orchestrations);
        releaseOrchestrationChatPanes(id);
        orchestrationDeletePendingId = null;
        statusText = "Chat orchestré et sandboxes supprimés";
      } catch (error) {
        statusText = String(error);
      } finally {
        orchestrationBusyId = null;
        render();
      }
    });
  });
};

const refreshDoctolibLabStatus = async (): Promise<void> => {
  if (doctolibLab.busy) return;
  doctolibLab.busy = "status";
  doctolibLab.error = null;
  if (activeView === "doctolib-lab") render();
  try {
    doctolibLab.status = await invoke<DoctolibLabStatus>("doctolib_lab_status");
    statusText = doctolibLab.status.liveReady
      ? doctolibLab.status.connected
        ? "Vrai compte Doctolib connecté"
        : "Moteur réel prêt · connexion Doctolib requise"
      : "RDV Lab : le bac à sable est prêt";
  } catch (error) {
    doctolibLab.error = String(error);
  } finally {
    doctolibLab.busy = null;
    if (activeView === "doctolib-lab") render();
  }
};

const connectDoctolibLab = async (): Promise<void> => {
  if (doctolibLab.busy) return;
  appendDoctolibLabMessage(
    doctolibLab,
    "assistant",
    "Connexion guidée : 1. Chrome ouvre la page officielle Doctolib. 2. Saisissez vous-même votre identifiant et votre mot de passe. 3. Validez le code de double authentification s’il est demandé. 4. Laissez la fenêtre ouverte : je détecterai la connexion et reprendrai automatiquement. Je ne vois ni ne stocke votre mot de passe.",
  );
  doctolibLab.busy = "connect";
  doctolibLab.error = null;
  doctolibLab.confirmation = null;
  statusText = "Terminez la connexion dans la fenêtre Chrome";
  render();
  try {
    const result = await invoke<{ connected: boolean; message: string }>("doctolib_lab_connect");
    if (doctolibLab.status) {
      doctolibLab.status = { ...doctolibLab.status, connected: result.connected };
    }
    statusText = result.message;
    if (result.connected) {
      appendDoctolibLabMessage(doctolibLab, "assistant", result.message, "success");
    } else {
      doctolibLab.error = result.message;
    }
  } catch (error) {
    doctolibLab.error = String(error);
    statusText = "Connexion Doctolib non terminée";
  } finally {
    doctolibLab.busy = null;
    render();
  }
};

const connectGoogleCalendar = async (): Promise<boolean> => {
  if (doctolibLab.busy) return false;
  appendDoctolibLabMessage(
    doctolibLab,
    "assistant",
    "Connexion Google guidée : 1. Chrome ouvre la page officielle Google Calendar. 2. Choisissez votre compte et saisissez vous-même vos identifiants. 3. Validez la double authentification si Google la demande. 4. Laissez la fenêtre ouverte jusqu’à ce que je confirme la connexion. Le profil Google est séparé du profil Doctolib.",
  );
  doctolibLab.busy = "calendar";
  doctolibLab.error = null;
  statusText = "Terminez la connexion Google Calendar dans Chrome";
  render();
  try {
    const result = await invoke<{ connected: boolean; message: string }>(
      "doctolib_lab_google_calendar_connect",
    );
    if (doctolibLab.status) {
      doctolibLab.status = {
        ...doctolibLab.status,
        googleCalendarConnected: result.connected,
      };
    }
    statusText = result.message;
    if (result.connected) {
      appendDoctolibLabMessage(doctolibLab, "assistant", result.message, "success");
      return true;
    }
    doctolibLab.error = result.message;
    return false;
  } catch (error) {
    doctolibLab.error = String(error);
    statusText = "Connexion Google Calendar non terminée";
    return false;
  } finally {
    doctolibLab.busy = null;
    render();
  }
};

const searchDoctolibLab = async (): Promise<void> => {
  if (doctolibLab.busy) return;
  doctolibLab.busy = "search";
  doctolibLab.error = null;
  doctolibLab.search = null;
  doctolibLab.selectedProposalId = null;
  doctolibLab.confirmation = null;
  doctolibLab.awaitingLocation = false;
  statusText = doctolibLab.mode === "demo"
    ? "Création de propositions de démonstration"
    : "Recherche des créneaux Doctolib";
  render();
  try {
    const response = await invoke<DoctolibLabSearchResponse>("doctolib_lab_search", {
      request: {
        mode: doctolibLab.mode,
        specialty: doctolibLab.specialty,
        location: doctolibLab.location,
      },
    });
    doctolibLab.search = response;
    doctolibLab.selectedProposalId = response.recommendedProposalId;
    const recommended = selectedDoctolibLabProposal(doctolibLab);
    if (recommended) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        `J’ai trouvé ${response.proposals.length} créneau${response.proposals.length > 1 ? "x" : ""}. Je recommande le premier : ${recommended.practitionerName}, ${recommended.address}, ${new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(recommended.startsAt))}. Choisissez une autre option si besoin, puis répondez « oui » pour m’autoriser à le prendre.`,
      );
    } else {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        `Je n’ai trouvé aucun créneau pour ${doctolibLab.specialty} à ${doctolibLab.location}. Donnez-moi une autre ville et je relancerai la recherche.`,
        "warning",
      );
      doctolibLab.awaitingLocation = true;
    }
    statusText = response.proposals.length
      ? `${response.proposals.length} proposition(s) · votre validation est requise`
      : "Aucun créneau proposé";
  } catch (error) {
    doctolibLab.error = String(error);
    statusText = "Recherche RDV Lab interrompue";
  } finally {
    doctolibLab.busy = null;
    render();
  }
};

const confirmDoctolibLab = async (): Promise<void> => {
  if (doctolibLab.busy) return;
  const proposal = selectedDoctolibLabProposal(doctolibLab);
  if (!proposal) {
    doctolibLab.error = "Sélectionnez une proposition avant de confirmer.";
    render();
    return;
  }
  if (proposal.mode === "live" && doctolibLab.syncGoogleCalendar) {
    if (!doctolibLab.status) await refreshDoctolibLabStatus();
    if (doctolibLab.status?.googleCalendarConnected !== true) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        "L’ajout à Google Calendar est activé. Je connecte d’abord votre agenda, avant toute réservation Doctolib, afin de ne pas vous laisser avec un rendez-vous confirmé mais non synchronisé.",
      );
      const connected = await connectGoogleCalendar();
      if (!connected) {
        appendDoctolibLabMessage(
          doctolibLab,
          "assistant",
          "Google Calendar n’est pas encore connecté. Je n’ai pas touché au créneau Doctolib ; vous pouvez terminer la connexion ou décocher l’ajout à l’agenda.",
          "warning",
        );
        render();
        return;
      }
    }
  }
  doctolibLab.busy = "confirm";
  doctolibLab.error = null;
  doctolibLab.confirmation = null;
  statusText = proposal.mode === "demo"
    ? "Simulation de la réservation"
    : "Réservation Doctolib en cours dans Chrome";
  render();
  try {
    const result = await invoke<DoctolibLabConfirmation>("doctolib_lab_confirm", {
      proposalId: proposal.id,
      addToGoogleCalendar: proposal.mode === "live" && doctolibLab.syncGoogleCalendar,
    });
    doctolibLab.confirmation = result;
    appendDoctolibLabMessage(
      doctolibLab,
      "assistant",
      result.verified
        ? result.googleCalendarAdded
          ? "C’est fait. Le rendez-vous est confirmé dans Doctolib et l’événement est vérifié dans Google Calendar."
          : `Le rendez-vous est bien confirmé dans Doctolib. ${result.googleCalendarMessage ?? "Aucun événement Google Calendar n’a été ajouté."}`
        : result.message,
      result.verified && (!doctolibLab.syncGoogleCalendar || result.googleCalendarAdded) ? "success" : "warning",
    );
    statusText = result.message;
  } catch (error) {
    doctolibLab.error = String(error);
    statusText = "Le rendez-vous n'a pas été confirmé";
  } finally {
    // Une proposition est un jeton à usage unique côté backend. On force une
    // nouvelle recherche après toute tentative, réussie ou non.
    doctolibLab.search = null;
    doctolibLab.selectedProposalId = null;
    doctolibLab.busy = null;
    render();
  }
};

const doctolibLabHasConnectedAccount = (): boolean => doctolibLab.status?.connected === true;

const handleDoctolibLabMessage = async (rawMessage: string): Promise<void> => {
  const message = rawMessage.trim();
  if (!message || doctolibLab.busy) return;

  appendDoctolibLabMessage(doctolibLab, "user", message);
  doctolibLab.error = null;
  const intent = interpretDoctolibLabMessage(message, {
    awaitingLocation: doctolibLab.awaitingLocation,
  });

  if (intent.kind === "search") {
    if (!intent.location) {
      doctolibLab.awaitingLocation = true;
      appendDoctolibLabMessage(doctolibLab, "assistant", "Dans quelle ville dois-je chercher ?");
      render();
      return;
    }
    if (doctolibLab.mode === "live") {
      if (!doctolibLab.status) await refreshDoctolibLabStatus();
      if (!doctolibLab.status?.liveReady) {
        appendDoctolibLabMessage(
          doctolibLab,
          "assistant",
          "Le navigateur réel n’est pas encore prêt. Passez en mode démonstration ou demandez-moi de revérifier le serveur.",
          "warning",
        );
        render();
        return;
      }
      if (!doctolibLabHasConnectedAccount()) {
        await connectDoctolibLab();
        if (!doctolibLabHasConnectedAccount()) {
          appendDoctolibLabMessage(
            doctolibLab,
            "assistant",
            "La connexion au vrai compte n’est pas terminée. Je n’effectue aucune recherche ni réservation réelle tant que le compte n’est pas vérifié.",
            "warning",
          );
          render();
          return;
        }
      }
    }
    doctolibLab.specialty = intent.specialty;
    doctolibLab.location = intent.location;
    doctolibLab.awaitingLocation = false;
    await searchDoctolibLab();
    return;
  }

  if (intent.kind === "confirm") {
    if (!selectedDoctolibLabProposal(doctolibLab)) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        "Je n’ai aucun créneau prêt à confirmer. Dites-moi d’abord quel rendez-vous chercher.",
        "warning",
      );
      render();
      return;
    }
    await confirmDoctolibLab();
    return;
  }

  if (intent.kind === "reject") {
    doctolibLab.selectedProposalId = null;
    doctolibLab.confirmation = null;
    appendDoctolibLabMessage(
      doctolibLab,
      "assistant",
      doctolibLab.search
        ? "D’accord, je ne réserve rien. Vous pouvez choisir un autre numéro ou me demander une nouvelle recherche."
        : "D’accord, aucune action n’a été effectuée.",
    );
    statusText = "Proposition refusée · aucune action effectuée";
    render();
    return;
  }

  if (intent.kind === "select") {
    const proposal = doctolibLab.search?.proposals[intent.index];
    if (!proposal) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        "Ce numéro ne correspond à aucune proposition affichée.",
        "warning",
      );
    } else {
      doctolibLab.selectedProposalId = proposal.id;
      doctolibLab.confirmation = null;
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        `J’ai sélectionné le choix ${intent.index + 1}, avec ${proposal.practitionerName}. Répondez « oui » si je dois prendre ce rendez-vous.`,
      );
    }
    render();
    return;
  }

  if (intent.kind === "mode") {
    if (intent.mode === "live" && !doctolibLab.status) {
      await refreshDoctolibLabStatus();
    }
    if (intent.mode === "live" && !doctolibLab.status?.liveReady) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        "Le mode réel n’est pas disponible sur cette machine pour le moment. Le bac à sable reste actif.",
        "warning",
      );
      render();
      return;
    }
    doctolibLab.mode = intent.mode;
    doctolibLab.search = null;
    doctolibLab.selectedProposalId = null;
    doctolibLab.confirmation = null;
    doctolibLab.awaitingLocation = false;
    appendDoctolibLabMessage(
      doctolibLab,
      "assistant",
      intent.mode === "live"
        ? "Mode Doctolib réel activé. Je chercherai de vrais créneaux ; aucune réservation ne partira sans votre « oui »."
        : "Mode démonstration activé. Tout le parcours sera simulé, sans contacter Doctolib.",
      intent.mode === "live" ? "warning" : "normal",
    );
    render();
    return;
  }

  if (intent.kind === "connect") {
    if (!doctolibLab.status) await refreshDoctolibLabStatus();
    if (!doctolibLab.status?.liveReady) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        "Je ne peux pas ouvrir Doctolib : Chrome ou le worker n’est pas prêt sur la machine serveur.",
        "warning",
      );
      render();
      return;
    }
    await connectDoctolibLab();
    return;
  }

  if (intent.kind === "connect-calendar") {
    if (!doctolibLab.status) await refreshDoctolibLabStatus();
    if (!(doctolibLab.status?.googleCalendarReady ?? doctolibLab.status?.liveReady)) {
      appendDoctolibLabMessage(
        doctolibLab,
        "assistant",
        "Je ne peux pas ouvrir Google Calendar : Chrome ou le worker n’est pas prêt sur la machine serveur.",
        "warning",
      );
      render();
      return;
    }
    await connectGoogleCalendar();
    return;
  }

  if (intent.kind === "unsupported-specialty") {
    appendDoctolibLabMessage(
      doctolibLab,
      "assistant",
      `Cette première version sait chercher uniquement un médecin généraliste. ${intent.specialty[0].toUpperCase()}${intent.specialty.slice(1)} sera ajouté dans une prochaine étape.`,
      "warning",
    );
    render();
    return;
  }

  if (intent.kind === "help") {
    appendDoctolibLabMessage(
      doctolibLab,
      "assistant",
      "Demandez par exemple « Trouve-moi un généraliste à Paris ». Vous pourrez choisir avec « le 2 », répondre « oui » pour autoriser la réservation, « non » pour l’annuler, dire « connecte Google Calendar » ou « passe en mode réel ».",
    );
    render();
    return;
  }

  appendDoctolibLabMessage(
    doctolibLab,
    "assistant",
    "Je n’ai pas encore compris cette demande. Essayez par exemple : « Trouve-moi un médecin généraliste à Paris ».",
    "warning",
  );
  render();
};

const bindDoctolibLabUi = (): void => {
  document.querySelectorAll<HTMLInputElement>('input[name="doctolibLabMode"]').forEach((input) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      void handleDoctolibLabMessage(input.value === "live" ? "Passe en mode réel" : "Passe en mode démo");
    });
  });
  const chatForm = document.querySelector<HTMLFormElement>("#doctolibLabChatForm");
  const chatInput = document.querySelector<HTMLTextAreaElement>("#doctolibLabMessage");
  chatForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = chatInput?.value.trim() ?? "";
    if (!message) return;
    if (chatInput) chatInput.value = "";
    void handleDoctolibLabMessage(message);
  });
  chatInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    chatForm?.requestSubmit();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-doctolib-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      void handleDoctolibLabMessage(button.dataset.doctolibPrompt ?? "");
    });
  });
  document.querySelectorAll<HTMLInputElement>('input[name="doctolibLabProposal"]').forEach((input, index) => {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      void handleDoctolibLabMessage(`Choix ${index + 1}`);
    });
  });
  document.querySelector<HTMLButtonElement>("#doctolibLabConfirm")?.addEventListener("click", () => {
    void handleDoctolibLabMessage("Oui");
  });
  document.querySelector<HTMLButtonElement>("#doctolibLabReject")?.addEventListener("click", () => {
    void handleDoctolibLabMessage("Non");
  });
  document.querySelector<HTMLButtonElement>("#doctolibLabConnect")?.addEventListener("click", () => {
    void handleDoctolibLabMessage("Connecte-moi à Doctolib");
  });
  document.querySelector<HTMLButtonElement>("#doctolibLabGoogleCalendarConnect")?.addEventListener("click", () => {
    void handleDoctolibLabMessage("Connecte Google Calendar");
  });
  document.querySelector<HTMLInputElement>("#doctolibLabGoogleCalendarSync")?.addEventListener("change", (event) => {
    doctolibLab.syncGoogleCalendar = (event.currentTarget as HTMLInputElement).checked;
    statusText = doctolibLab.syncGoogleCalendar
      ? "Ajout Google Calendar activé après confirmation"
      : "Ajout Google Calendar désactivé";
  });
  document.querySelector<HTMLButtonElement>("#doctolibLabStatusRefresh")?.addEventListener("click", () => {
    void refreshDoctolibLabStatus();
  });
  const thread = document.querySelector<HTMLElement>("#doctolibLabThread");
  if (thread) thread.scrollTop = thread.scrollHeight;
};

const appViewTitle = (view: AppView): string => {
  switch (view) {
    case "terminal":
      return terminalFolderFilter
        ? `Terminaux · ${workspaceBaseName(terminalFolderFilter)}`
        : "Choisir un environnement";
    case "pool":
      return "Comptes";
    case "tasks":
      return "Tâches";
    case "prompts":
      return "Bibliothèque de prompts";
    case "scheduled-chat":
      return "Chat planifié";
    case "limits":
      return "Limites";
    case "dashboard":
      return "Statistiques";
    case "doctolib-lab":
      return "RDV Lab · expérimental";
    case "autonomous":
      return "Agents autonomes";
    case "orchestration":
      return "Chats orchestrés";
    case "kombai":
      return "Kombai";
    case "discussions":
      return "Toutes les conversations";
    case "history":
      return "Historique";
    case "audit":
      return "Audit de l'interface";
    case "skills":
      return "Bibliotheque de skills";
    case "settings":
      return "Paramètres";
    default:
      return "Conversation";
  }
};

// Page « Paramètres » : regroupe la configuration de l'app. Les comptes
// (anciennement dans la barre latérale) vivent désormais ici ; l'entrée latérale
// affiche à la place « Discussions » (reprise d'une conversation dans un autre
// compte). Chaque carte ouvre la vue/modale dédiée existante.
const keyboardShortcutBinding = (id: KeyboardShortcutId): string =>
  resolveKeyboardShortcuts(keyboardShortcutOverrides)[id];

const keyboardShortcutMatchesAction = (
  id: KeyboardShortcutId,
  event: KeyboardEvent,
): boolean => keyboardShortcutMatches(event, keyboardShortcutBinding(id));

const renderKeyboardShortcutKeycaps = (binding: string): string => {
  const parts = keyboardShortcutDisplayParts(binding);
  return parts.length
    ? parts.map((part) => `<kbd>${escapeHtml(part)}</kbd>`).join('<span aria-hidden="true">+</span>')
    : '<span class="keyboard-shortcut-disabled">Désactivé</span>';
};

const focusKeyboardShortcutCapture = (): void => {
  if (!keyboardShortcutCaptureId) return;
  const id = keyboardShortcutCaptureId;
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLButtonElement>(
      `[data-record-keyboard-shortcut="${id}"]`,
    )?.focus();
  });
};

const commitKeyboardShortcutOverrides = (
  next: KeyboardShortcutOverrides,
  successMessage: string,
): void => {
  keyboardShortcutOverrides = next;
  const persisted = persistKeyboardShortcutOverrides(next);
  keyboardShortcutFeedback = persisted
    ? { message: successMessage, tone: "success" }
    : {
        message: "Le raccourci fonctionne pour cette session, mais n’a pas pu être enregistré sur cet appareil.",
        tone: "error",
      };
  if (activeView === "settings") render();
};

const startKeyboardShortcutCapture = (id: KeyboardShortcutId): void => {
  keyboardShortcutCaptureId = id;
  keyboardShortcutFeedback = {
    message: "Appuyez sur la nouvelle combinaison. Échap annule la modification.",
    tone: "success",
  };
  render();
  focusKeyboardShortcutCapture();
};

const stopKeyboardShortcutCapture = (): void => {
  keyboardShortcutCaptureId = null;
  keyboardShortcutFeedback = { message: "Modification annulée.", tone: "success" };
  if (activeView === "settings") render();
};

const resetKeyboardShortcut = (id: KeyboardShortcutId): void => {
  const next = { ...keyboardShortcutOverrides };
  delete next[id];
  keyboardShortcutCaptureId = null;
  commitKeyboardShortcutOverrides(
    next,
    `« ${formatKeyboardShortcut(DEFAULT_KEYBOARD_SHORTCUTS[id])} » restauré pour cette action.`,
  );
};

const clearKeyboardShortcut = (id: KeyboardShortcutId): void => {
  const next = withKeyboardShortcutOverride(keyboardShortcutOverrides, id, "");
  if (!next) return;
  keyboardShortcutCaptureId = null;
  commitKeyboardShortcutOverrides(next, "Raccourci désactivé.");
};

const resetAllKeyboardShortcuts = (): void => {
  keyboardShortcutCaptureId = null;
  commitKeyboardShortcutOverrides({}, "Tous les raccourcis par défaut ont été restaurés.");
};

const captureKeyboardShortcut = (event: KeyboardEvent): boolean => {
  const id = keyboardShortcutCaptureId;
  if (!id) return false;
  event.preventDefault();
  event.stopImmediatePropagation();

  if (
    event.key === "Escape" &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey
  ) {
    stopKeyboardShortcutCapture();
    return true;
  }

  const binding = keyboardShortcutFromEvent(event);
  // Les touches de modification seules font partie de la combinaison en cours :
  // on attend la touche principale sans faire clignoter l'interface.
  if (!binding) return true;

  const conflict = keyboardShortcutConflict(id, binding, keyboardShortcutOverrides);
  if (conflict) {
    keyboardShortcutFeedback = {
      message: `« ${formatKeyboardShortcut(binding)} » est déjà utilisé par « ${conflict.label} ».`,
      tone: "error",
    };
    render();
    focusKeyboardShortcutCapture();
    return true;
  }

  const next = withKeyboardShortcutOverride(keyboardShortcutOverrides, id, binding);
  if (!next) {
    keyboardShortcutFeedback = {
      message: "Cette combinaison ne peut pas être utilisée.",
      tone: "error",
    };
    render();
    focusKeyboardShortcutCapture();
    return true;
  }

  keyboardShortcutCaptureId = null;
  commitKeyboardShortcutOverrides(
    next,
    `Nouveau raccourci : ${formatKeyboardShortcut(binding)}.`,
  );
  return true;
};

const renderKeyboardShortcutSettings = (): string => {
  const resolved = resolveKeyboardShortcuts(keyboardShortcutOverrides);
  const hasOverrides = Object.keys(keyboardShortcutOverrides).length > 0;
  const groups = KEYBOARD_SHORTCUT_GROUPS.map((group) => {
    const rows = KEYBOARD_SHORTCUT_DEFINITIONS
      .filter((definition) => definition.group === group.id)
      .map((definition) => {
        const binding = resolved[definition.id];
        const custom = Object.prototype.hasOwnProperty.call(
          keyboardShortcutOverrides,
          definition.id,
        );
        const recording = keyboardShortcutCaptureId === definition.id;
        return `<div class="keyboard-shortcut-row${recording ? " is-recording" : ""}">
          <span class="keyboard-shortcut-copy">
            <span><strong>${escapeHtml(definition.label)}</strong>${custom ? '<em>Personnalisé</em>' : ""}</span>
            <small>${escapeHtml(definition.description)}</small>
          </span>
          <span class="keyboard-shortcut-controls">
            <button
              type="button"
              class="keyboard-shortcut-recorder${recording ? " is-recording" : ""}"
              data-record-keyboard-shortcut="${definition.id}"
              aria-pressed="${recording}"
              aria-label="${recording ? "Saisissez maintenant la nouvelle combinaison" : `Modifier le raccourci ${escapeAttr(definition.label)}`}"
            >${recording
              ? '<span class="keyboard-shortcut-listening"><i data-lucide="radio"></i> Appuyez sur les touches…</span>'
              : renderKeyboardShortcutKeycaps(binding)}</button>
            <button
              type="button"
              class="keyboard-shortcut-icon"
              data-clear-keyboard-shortcut="${definition.id}"
              title="Désactiver ce raccourci"
              aria-label="Désactiver le raccourci ${escapeAttr(definition.label)}"
              ${binding ? "" : "disabled"}
            ><i data-lucide="x"></i></button>
            ${custom ? `<button
              type="button"
              class="keyboard-shortcut-icon"
              data-reset-keyboard-shortcut="${definition.id}"
              title="Rétablir ${escapeAttr(formatKeyboardShortcut(definition.defaultBinding))}"
              aria-label="Rétablir le raccourci par défaut de ${escapeAttr(definition.label)}"
            ><i data-lucide="rotate-ccw"></i></button>` : ""}
          </span>
        </div>`;
      })
      .join("");
    return `<section class="keyboard-shortcut-group" aria-labelledby="keyboardShortcutGroup-${group.id}">
      <h3 id="keyboardShortcutGroup-${group.id}">${escapeHtml(group.label)}</h3>
      <div>${rows}</div>
    </section>`;
  }).join("");
  const feedback = keyboardShortcutFeedback
    ? `<p class="keyboard-shortcut-feedback is-${keyboardShortcutFeedback.tone}" role="status">${escapeHtml(keyboardShortcutFeedback.message)}</p>`
    : "";

  return `<section class="keyboard-shortcut-settings" aria-labelledby="keyboardShortcutSettingsTitle">
    <header class="keyboard-shortcut-head">
      <div class="appearance-settings-copy">
        <span class="settings-card-icon"><i data-lucide="keyboard"></i></span>
        <span>
          <strong id="keyboardShortcutSettingsTitle">Raccourcis clavier</strong>
          <small>Cliquez sur une combinaison puis saisissez la nouvelle. Enregistré sur cet appareil.</small>
        </span>
      </div>
      <button type="button" id="resetKeyboardShortcuts" class="keyboard-shortcut-reset-all" ${hasOverrides ? "" : "disabled"}>
        <i data-lucide="rotate-ccw"></i><span>Tout réinitialiser</span>
      </button>
    </header>
    <div class="keyboard-shortcut-groups">${groups}</div>
    <p class="keyboard-shortcut-help"><i data-lucide="info"></i><span>Les doublons sont refusés. Utilisez <b>×</b> pour désactiver une action.</span></p>
    ${feedback}
  </section>`;
};

const voiceRuntimeTopology = (status: VoiceRuntimeStatus): string => {
  if (status.transcriptionTarget === "local" && status.summaryTarget === "local") return "Local";
  if (status.transcriptionTarget === "remote" && status.summaryTarget === "remote") {
    return "Datacenter";
  }
  return "Hybride";
};

const voiceRuntimePresentation = (status: VoiceRuntimeStatus | null) => {
  if (!status) {
    return {
      tone: voiceRuntimeError ? "error" : "checking",
      title: voiceRuntimeError ? "Statut indisponible" : "Lecture du statut...",
      detail: voiceRuntimeError ?? "Interrogation locale sans charger les modeles.",
    };
  }
  if (status.state === "active") {
    const task = status.stage === "transcribing" ? "Transcription" : "Reformulation";
    const location = status.activeLocation === "remote" ? "GPU distant" : "GPU de ce PC";
    return { tone: "active", title: `${task} en cours`, detail: `Calcul actif sur le ${location}.` };
  }
  if (status.state === "loaded") {
    const location = status.summaryTarget === "remote" ? "dans le datacenter" : "sur ce PC";
    const processor = status.summaryModelOnGpu ? "GPU" : "CPU";
    const allocation = status.summaryModelOnGpu ? "VRAM allouee" : "modele resident en RAM";
    return {
      tone: "ready",
      title: `Modele charge sur ${processor}`,
      detail: `En attente ${location} : ${allocation}, aucun calcul vocal en cours.`,
    };
  }
  if (status.state === "unavailable") {
    return {
      tone: "error",
      title: "Moteur vocal indisponible",
      detail: status.warning || "Whisper ou Ollama ne repond pas.",
    };
  }
  return {
    tone: "inactive",
    title: "Inactif",
    detail: "Aucun calcul vocal et aucun modele Ollama charge.",
  };
};

const formatVoiceActivityTime = (timestamp?: number | null): string => {
  if (!timestamp) return "Aucune depuis ce lancement";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Inconnue";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

const renderVoiceRuntimeStatusContent = (): string => {
  const status = voiceRuntimeStatus;
  const presentation = voiceRuntimePresentation(status);
  const gpu = status?.gpu;
  const gpuValue = gpu
    ? `${escapeHtml(gpu.name)} · ${gpu.utilizationPercent}% · ${gpu.memoryUsedMb}/${gpu.memoryTotalMb} Mio`
    : "Aucun GPU NVIDIA detecte par nvidia-smi";
  const topology = status ? voiceRuntimeTopology(status) : "Lecture...";
  const models = status
    ? `${escapeHtml(status.transcriptionModel)} → ${escapeHtml(status.summaryModel)}`
    : "—";
  const ollama = status
    ? status.ollamaReachable
      ? status.summaryModelLoaded
        ? `Charge${status.summaryModelOnGpu ? " sur GPU" : " sur CPU"}${status.summaryModelVramMb ? ` · ${status.summaryModelVramMb} Mio` : ""}`
        : "Joignable · modele decharge"
      : "Injoignable"
    : "—";
  return `
    <div class="voice-runtime-head">
      <div>
        <span class="voice-runtime-eyebrow"><i data-lucide="mic"></i> Voix et GPU</span>
        <h3>Execution vocale</h3>
      </div>
      <button type="button" id="voiceRuntimeRefresh" class="voice-runtime-refresh" title="Actualiser le statut" ${voiceRuntimeInFlight ? "disabled" : ""}>
        <i data-lucide="refresh-ccw" class="${voiceRuntimeInFlight ? "is-spinning" : ""}"></i>
        <span>Actualiser</span>
      </button>
    </div>
    <div class="voice-runtime-primary" data-state="${presentation.tone}">
      <span class="voice-runtime-dot" aria-hidden="true"></span>
      <span><strong>${escapeHtml(presentation.title)}</strong><small>${escapeHtml(presentation.detail)}</small></span>
    </div>
    <dl class="voice-runtime-grid">
      <div><dt>Topologie</dt><dd>${escapeHtml(topology)}</dd></div>
      <div><dt>Ollama</dt><dd>${escapeHtml(ollama)}</dd></div>
      <div class="voice-runtime-wide"><dt>Modeles</dt><dd>${models}</dd></div>
      <div class="voice-runtime-wide"><dt>GPU local · activite totale</dt><dd>${gpuValue}</dd></div>
      <div><dt>Whisper local</dt><dd>${status ? (status.whisperReady ? "Pret" : "Absent") : "—"}</dd></div>
      <div><dt>Derniere activite vocale</dt><dd>${escapeHtml(formatVoiceActivityTime(status?.lastActivityAt))}</dd></div>
    </dl>
    ${status?.warning && status.state !== "unavailable" ? `<p class="voice-runtime-warning"><i data-lucide="circle-alert"></i>${escapeHtml(status.warning)}</p>` : ""}
    <p class="voice-runtime-note">L'activite GPU affichee est celle de toute la carte. Le voyant principal ne passe en actif que pendant une transcription ou une reformulation vocale.</p>`;
};

const updateChatReadySoundPreferences = (
  next: ChatReadySoundPreferences,
  successMessage: string,
): void => {
  chatReadySoundPreferences = next;
  const persisted = persistChatReadySoundPreferences(next);
  chatReadySoundFeedback = persisted
    ? { message: successMessage, tone: "success" }
    : {
        message: "Le réglage fonctionne pour cette session, mais n'a pas pu être enregistré sur cet appareil.",
        tone: "error",
      };
  if (activeView === "settings") render();
};

const renderChatReadySoundSettings = (): string => {
  const preferences = chatReadySoundPreferences;
  const custom = !!preferences.customSoundDataUrl;
  const soundName = custom
    ? preferences.customSoundName || "Son personnalisé.mp3"
    : "Clochette douce (par défaut)";
  const duration = custom && preferences.customSoundDuration
    ? ` · ${preferences.customSoundDuration.toFixed(1)} s`
    : "";
  const feedback = chatReadySoundFeedback
    ? `<p class="chat-ready-sound-feedback is-${chatReadySoundFeedback.tone}" role="status">${escapeHtml(chatReadySoundFeedback.message)}</p>`
    : "";

  return `<section class="chat-ready-sound-settings" aria-labelledby="chatReadySoundTitle">
    <div class="chat-ready-sound-head">
      <div class="appearance-settings-copy">
        <span class="settings-card-icon"><i data-lucide="bell-ring"></i></span>
        <span>
          <strong id="chatReadySoundTitle">Son quand un chat est disponible</strong>
          <small>Joué uniquement lors du passage « En cours » → « Disponible ».</small>
        </span>
      </div>
      <label class="chat-ready-sound-toggle">
        <input id="chatReadySoundEnabled" type="checkbox" ${preferences.enabled ? "checked" : ""} />
        <span class="chat-ready-sound-toggle-track" aria-hidden="true"><span></span></span>
        <b>${preferences.enabled ? "Activé" : "Désactivé"}</b>
      </label>
    </div>
    <div class="chat-ready-sound-body">
      <div class="chat-ready-sound-current">
        <i data-lucide="music-2"></i>
        <span><small>Son actuel</small><strong>${escapeHtml(soundName)}${escapeHtml(duration)}</strong></span>
      </div>
      <div class="chat-ready-sound-actions">
        <button type="button" id="chatReadySoundPreview"><i data-lucide="play"></i><span>Écouter</span></button>
        <button type="button" id="chatReadySoundChoose" class="chat-ready-sound-file-button"><i data-lucide="upload"></i><span>Choisir un MP3</span></button>
        <input id="chatReadySoundFile" class="chat-ready-sound-file" type="file" accept=".mp3,audio/mpeg,audio/mp3" />
        ${custom ? '<button type="button" id="chatReadySoundReset"><i data-lucide="rotate-ccw"></i><span>Son par défaut</span></button>' : ""}
      </div>
    </div>
    <p class="chat-ready-sound-help">MP3 uniquement, d'une durée maximale de 5 secondes. Le fichier reste sur cet appareil.</p>
    ${feedback}
  </section>`;
};

const renderSettingsPanel = (): string => {
  const accountCount = settings?.accounts.length ?? 0;
  return `
    <div class="panel settings-panel">
      <div class="panel-head">
        <div>
          <h2>Paramètres</h2>
          <p class="panel-sub">Apparence, raccourcis, comptes et configuration de l'application</p>
        </div>
      </div>
      <section class="appearance-settings" aria-labelledby="appearanceSettingsTitle">
        <div class="appearance-settings-copy">
          <span class="settings-card-icon"><i data-lucide="sun"></i></span>
          <span>
            <strong id="appearanceSettingsTitle">Apparence</strong>
            <small>Le choix est conservé sur cet appareil.</small>
          </span>
        </div>
        <div class="theme-choice-group" role="group" aria-label="Thème de l'interface">
          <button type="button" data-theme-choice="light" class="${activeTheme === "light" ? "active" : ""}" aria-pressed="${activeTheme === "light"}">
            <i data-lucide="sun"></i><span>Clair</span>
          </button>
          <button type="button" data-theme-choice="dark" class="${activeTheme === "dark" ? "active" : ""}" aria-pressed="${activeTheme === "dark"}">
            <i data-lucide="moon"></i><span>Sombre</span>
          </button>
        </div>
      </section>
      <section class="appearance-settings chat-display-settings" aria-labelledby="chatDisplaySettingsTitle">
        <div class="appearance-settings-copy">
          <span class="settings-card-icon"><i data-lucide="layout-grid"></i></span>
          <span>
            <strong id="chatDisplaySettingsTitle">Affichage de la fenêtre principale</strong>
            <small>En mode Disponibles, un chat disparaît pendant sa tâche puis revient automatiquement à la fin.</small>
          </span>
        </div>
        <div class="theme-choice-group chat-display-choice-group" role="group" aria-label="Chats affichés dans la fenêtre principale">
          <button type="button" data-chat-display-mode="all" class="${expertChatDisplayMode === "all" ? "active" : ""}" aria-pressed="${expertChatDisplayMode === "all"}">
            <i data-lucide="layout-grid"></i><span>Tous</span>
          </button>
          <button type="button" data-chat-display-mode="available" class="${expertChatDisplayMode === "available" ? "active" : ""}" aria-pressed="${expertChatDisplayMode === "available"}">
            <i data-lucide="badge-check"></i><span>Disponibles</span>
          </button>
        </div>
      </section>
      ${renderKeyboardShortcutSettings()}
      ${renderChatReadySoundSettings()}
      <section id="voiceRuntimeStatus" class="voice-runtime-card" aria-live="polite">
        ${renderVoiceRuntimeStatusContent()}
      </section>
      <div class="settings-cards">
        <button type="button" id="settingsAccounts" class="settings-card">
          <span class="settings-card-icon"><i data-lucide="users"></i></span>
          <span class="settings-card-copy">
            <strong>Comptes</strong>
            <small>${accountCount} compte(s)</small>
          </span>
        </button>
        <button type="button" id="settingsAgents" class="settings-card">
          <span class="settings-card-icon"><i data-lucide="bot"></i></span>
          <span class="settings-card-copy">
            <strong>Réglages des agents</strong>
            <small>Fournisseurs, modèles et commandes de lancement</small>
          </span>
        </button>
      </div>
    </div>`;
};

const currentTaskEnvironment = (): TaskEnvironment | null => {
  const path = userEnvironmentPath(currentWorkspace());
  if (!path) return null;
  const workspace = knownWorkspaces().find(
    (candidate) => candidate.id === workspaceIdForPath(path),
  );
  return { path, label: workspace?.label ?? workspaceBaseName(path) };
};

const scheduledChatsPanelOptions = (): ScheduledChatsPanelOptions => ({
  environments: knownWorkspaces().map((workspace) => ({
    path: workspace.path,
    label: workspace.label,
  })),
  accounts: (settings?.accounts ?? []).map((account) => ({
    id: account.id,
    label: account.label,
  })),
  defaultEnvironmentPath: currentWorkspace(),
  defaultAccountId: selectedAccountId ?? settings?.defaultAccountId ?? null,
});

const renderActiveAppPanel = (): string => {
  switch (activeView) {
    case "terminal":
      return renderExpertTerminalGrid();
    case "pool":
      return renderAccountsAndPool();
    case "tasks":
      return renderTasksPanel(undefined, currentTaskEnvironment());
    case "prompts":
      return renderPromptLibraryPanel();
    case "scheduled-chat":
      return renderScheduledChatsPanel(scheduledChatsPanelOptions());
    case "limits":
      return renderLimitsPanel();
    case "dashboard":
      return renderDashboardPanel();
    case "doctolib-lab":
      return renderDoctolibLabPanel(doctolibLab, { remoteMode: isRemoteMode() });
    case "autonomous":
      return renderAutonomousPanel();
    case "orchestration":
      return renderOrchestrationPanel();
    case "kombai":
      return renderKombaiPanel();
    case "discussions":
      return renderDiscussionsPanel();
    case "history":
      return renderPromptHistoryPanel();
    case "audit":
      return renderAuditPanel();
    case "skills":
      return renderSkillsPanel();
    case "settings":
      return renderSettingsPanel();
    default:
      return renderChatPanel(chatPanelModel());
  }
};

const renderTerminalEnvironmentMenu = (): string => {
  if (!terminalEnvironmentMenuOpen) return "";
  const activePath = userEnvironmentPath(currentWorkspace());
  const activeId = activePath ? workspaceIdForPath(activePath) : null;
  const workspacesById = new Map(knownWorkspaces().map((workspace) => [workspace.id, workspace]));
  const memoryWorkspace = environmentMemoryTargetId
    ? workspacesById.get(environmentMemoryTargetId) ?? null
    : null;
  const storedMemory = memoryWorkspace?.memory ?? "";
  const memoryValue = memoryWorkspace && environmentMemoryDraftId === memoryWorkspace.id
    ? environmentMemoryDraft
    : storedMemory;
  const memoryDirty = memoryValue.trim() !== storedMemory.trim();
  const memoryState = environmentMemorySaving
    ? "Enregistrement..."
    : memoryDirty
      ? "Non enregistree"
      : storedMemory
        ? "Active"
        : "Vide";
  const memoryEditor = memoryWorkspace
    ? `<details class="terminal-environment-memory" open>
        <summary>
          <span class="terminal-environment-memory-icon"><i data-lucide="brain-circuit"></i></span>
          <span><strong>Mémoire partagée</strong><small>Contexte durable de ${escapeHtml(memoryWorkspace.label)}</small></span>
          <b>${escapeHtml(memoryState)}</b>
          <i data-lucide="chevron-down"></i>
        </summary>
        <div class="terminal-environment-memory-editor">
          <label for="environmentMemoryInput">Faits, decisions et contraintes a retenir dans tous les chats</label>
          <textarea
            id="environmentMemoryInput"
            maxlength="${MAX_ENVIRONMENT_MEMORY_CHARS}"
            rows="5"
            placeholder="Ex. API publique en v2 ; conserver SQLite ; les tests de paiement sont prioritaires."
            aria-describedby="environmentMemoryHelp"
          >${escapeHtml(memoryValue)}</textarea>
          <div class="terminal-environment-memory-actions">
            <small id="environmentMemoryHelp"><span id="environmentMemoryCount">${[...memoryValue].length}</span>/${MAX_ENVIRONMENT_MEMORY_CHARS} · Evitez les secrets.</small>
            <button type="button" class="tool-button primary" id="saveEnvironmentMemory" ${environmentMemorySaving ? "disabled" : ""}>
              <i data-lucide="save"></i><span>Enregistrer</span>
            </button>
          </div>
        </div>
      </details>`
    : "";
  const sidebarGroups = chatWorkspaceSidebarGroups();
  const environments = terminalEnvironmentGroups()
    .map((group) => {
      const id = workspaceIdForPath(group.path);
      const active = id === activeId;
      const discussionCount = sidebarGroups.find((candidate) => candidate.id === id)?.discussions.length ?? 0;
      const draftPanes = expertChatPanes.filter((pane) => {
        const panePath = expertChatPaneEnvironmentPath(pane);
        return !pane.discussion && !!panePath && workspaceIdForPath(panePath) === id;
      });
      const agentIds = new Set([
        ...(sidebarGroups.find((candidate) => candidate.id === id)?.discussions.map((discussion) => discussion.accountId) ?? []),
        ...draftPanes.map((pane) => pane.accountId).filter((accountId): accountId is string => !!accountId),
        ...group.sessions.map((session) => session.accountId),
      ]);
      const chatCount = discussionCount + draftPanes.length;
      const deleting = workspaceClosingId === id;
      const hasMemory = !!workspacesById.get(id)?.memory.trim();
      return `<div class="terminal-environment-menu-row">
        <button
          type="button"
          class="terminal-environment-menu-item ${active ? "active" : ""}"
          data-environment-menu-id="${escapeAttr(id)}"
          aria-current="${active ? "true" : "false"}"
          title="${escapeAttr(group.path)}"
        >
          <span class="terminal-environment-menu-icon"><i data-lucide="folder${active ? "-open" : ""}"></i></span>
          <span class="terminal-environment-menu-copy">
            <strong>${escapeHtml(group.label)}</strong>
            <small>${escapeHtml(group.path)}</small>
          </span>
          <span class="terminal-environment-menu-state">
            <b>${chatCount} chat${chatCount > 1 ? "s" : ""}</b>
            <small>${agentIds.size} agent${agentIds.size > 1 ? "s" : ""}${hasMemory ? " · memoire" : ""}</small>
          </span>
          <i data-lucide="chevron-right"></i>
        </button>
        <button
          type="button"
          class="terminal-environment-menu-memory ${hasMemory ? "has-memory" : ""} ${environmentMemoryTargetId === id ? "active" : ""}"
          data-view-environment-memory-id="${escapeAttr(id)}"
          title="${hasMemory ? "Voir" : "Ajouter"} la mémoire de ${escapeAttr(group.label)}"
          aria-label="${hasMemory ? "Voir" : "Ajouter"} la mémoire de ${escapeAttr(group.label)}"
          aria-pressed="${environmentMemoryTargetId === id ? "true" : "false"}"
        >
          <i data-lucide="brain-circuit"></i><span>Mémoire</span>
        </button>
        <button
          type="button"
          class="terminal-environment-menu-delete"
          data-delete-environment-id="${escapeAttr(id)}"
          title="Supprimer l'environnement ${escapeAttr(group.label)} de Switch"
          aria-label="Supprimer l'environnement ${escapeAttr(group.label)}"
          ${deleting ? "disabled" : ""}
        >
          <i data-lucide="trash-2"></i>
        </button>
      </div>`;
    })
    .join("");

  return `<div class="modal-backdrop terminal-environment-menu-backdrop" id="terminalEnvironmentMenuBackdrop">
    <section class="terminal-environment-menu" role="dialog" aria-modal="true" aria-labelledby="terminalEnvironmentMenuTitle" tabindex="-1">
      <header class="terminal-environment-menu-head">
        <span class="terminal-environment-menu-mark"><i data-lucide="folders"></i></span>
        <span>
          <h2 id="terminalEnvironmentMenuTitle">Choisir un environnement</h2>
          <p>Un environnement regroupe ses chats et ses terminaux.</p>
        </span>
        <kbd aria-label="Raccourci accent grave">&#96;</kbd>
        <button type="button" class="icon-button" id="closeTerminalEnvironmentMenu" title="Fermer le menu" aria-label="Fermer le menu">
          <i data-lucide="x"></i>
        </button>
      </header>
      <div class="terminal-environment-menu-list">
        ${memoryEditor}
        ${environments || `<div class="terminal-environment-menu-empty"><i data-lucide="folder-open"></i><strong>Aucun environnement</strong><small>Parcourez les dossiers pour choisir votre premier environnement.</small></div>`}
      </div>
      <footer class="terminal-environment-menu-actions">
        <span><i data-lucide="folder-open"></i>Selectionnez un dossier existant sur votre machine</span>
        <button type="button" class="tool-button primary" id="createEnvironmentFromMenu" title="Afficher les dossiers et parcourir l'arborescence">
          <i data-lucide="folder-open"></i><span>Parcourir les dossiers</span>
        </button>
      </footer>
    </section>
  </div>`;
};

const renderExpertTerminalGrid = () => {
  const folderPath = userEnvironmentPath(terminalFolderFilter);
  if (!folderPath) {
    return `<section class="terminal-environment-gate" data-folder-terminal-view="unselected">
      <div class="terminal-environment-gate-card">
        <span class="terminal-environment-gate-icon"><i data-lucide="folders"></i></span>
        <strong>Choisis d'abord un environnement</strong>
        <p>Les terminaux s'ouvriront ensuite dans l'environnement actif.</p>
        <button type="button" id="chooseTerminalEnvironment" class="tool-button primary">
          <i data-lucide="folder-open"></i><span>Choisir l'environnement</span>
        </button>
      </div>
    </section>`;
  }

  const sessions = expertTerminalSessions();
  const folderProfile = folderPath
    ? knownWorkspaces().find((workspace) => workspace.id === workspaceIdForPath(folderPath))
    : null;
  const folderLabel = folderProfile?.label ?? workspaceBaseName(folderPath);
  const agentCounts = new Map<string, number>();
  sessions.forEach((session) => {
    agentCounts.set(session.agentId, (agentCounts.get(session.agentId) ?? 0) + 1);
  });
  const agentChips = [...agentCounts.entries()]
    .map(([agentId, count]) => `<span><i data-lucide="bot"></i>${escapeHtml(agentById(agentId)?.label ?? agentId)} <b>${count}</b></span>`)
    .join("");
  if (expertTerminalFullscreenKey && !sessions.some((session) => session.key === expertTerminalFullscreenKey)) {
    expertTerminalFullscreenKey = null;
  }
  const slotCount = Math.max(2, sessions.length);
  const columns = expertGridColumnCount(slotCount);
  const rows = Math.ceil(slotCount / columns);
  const chatSidebarHidden = displayedChatSidebarWidth() === 0;
  const panes = sessions
    .map((session, index) => {
      const sessionAgentLabel = agentById(session.agentId)?.label ?? session.agentId;
      const workspaceDetail = session.workspacePath ?? session.folderPath ?? "Dossier en preparation";
      const workspaceLabel = workspaceBaseName(workspaceDetail);
      return `
        <article class="expert-terminal-pane ${session.key === activeTerminalKey ? "active" : ""} ${session.running ? "running" : ""} ${session.key === expertTerminalFullscreenKey ? "is-fullscreen" : ""}" data-expert-terminal-pane="${escapeAttr(session.key)}">
          <header class="expert-terminal-pane-head">
            <button type="button" class="expert-pane-identity" data-focus-terminal="${escapeAttr(session.key)}" title="${escapeAttr(`${workspaceDetail} · Survolez puis appuyez sur la barre d'espace pour agrandir`)}">
              <span class="expert-pane-index">${index + 1}</span>
              <span class="live-dot ${session.running ? "on" : ""}"></span>
              <span class="expert-pane-copy">
                <strong>${escapeHtml(terminalTitle(session))}</strong>
                <small>${escapeHtml(`${sessionAgentLabel} · ${workspaceLabel}`)}</small>
              </span>
            </button>
            <span class="expert-pane-status">${escapeHtml(session.ptyId ? `PTY ${session.ptyId}` : session.status)}</span>
            <button type="button" class="expert-pane-toggle-chat" data-toggle-chat-sidebar title="${chatSidebarHidden ? "Afficher la fenêtre de chat" : "Masquer la fenêtre de chat"}" aria-label="${chatSidebarHidden ? "Afficher la fenêtre de chat" : "Masquer la fenêtre de chat"}" aria-pressed="${!chatSidebarHidden}">
              <i data-lucide="${chatSidebarHidden ? "panel-left-open" : "panel-left-close"}"></i>
            </button>
            <button type="button" class="expert-pane-fullscreen" data-toggle-terminal-fullscreen="${escapeAttr(session.key)}" title="${session.key === expertTerminalFullscreenKey ? "Quitter le plein ecran" : "Afficher ce terminal en plein ecran"}" aria-label="${session.key === expertTerminalFullscreenKey ? "Quitter le plein ecran" : "Afficher ce terminal en plein ecran"}" aria-pressed="${session.key === expertTerminalFullscreenKey}">
              <i data-lucide="${session.key === expertTerminalFullscreenKey ? "minimize-2" : "maximize-2"}"></i>
            </button>
            <button type="button" class="expert-pane-close" data-close-terminal="${escapeAttr(session.key)}" title="Fermer ce terminal" aria-label="Fermer ${escapeAttr(terminalTitle(session))}">
              <i data-lucide="x"></i>
            </button>
          </header>
          <div class="expert-terminal-host" data-terminal-host="${escapeAttr(session.key)}"></div>
        </article>
      `;
    })
    .join("");
  const emptySlots = Array.from({ length: Math.max(0, columns * rows - sessions.length) }, (_, index) => `
    <button type="button" class="expert-terminal-empty" data-add-expert-terminal ${terminalSessions.length >= EXPERT_MAX_TERMINALS ? "disabled" : ""}>
      <span class="expert-empty-icon"><i data-lucide="plus"></i></span>
      <strong>${sessions.length === 0 && index === 0 ? "Ouvrir le premier terminal" : "Ajouter un terminal"}</strong>
      <small>Agent au choix dans cet environnement</small>
    </button>
  `).join("");

  return `
    <section class="folder-terminal-panel" data-folder-terminal-view="${escapeAttr(folderPath)}">
      <header class="folder-terminal-head">
        <span class="folder-terminal-mark"><i data-lucide="folder-open"></i></span>
        <span class="folder-terminal-copy">
          <strong>${escapeHtml(folderLabel)}</strong>
          <small>${escapeHtml(folderPath ?? "Tous les environnements ouverts")}</small>
        </span>
        <span class="folder-terminal-stats">
          <b>${sessions.length}</b> terminaux · <b>${agentCounts.size}</b> agents
        </span>
        <span class="folder-terminal-actions">
          <button type="button" id="folderNewChat" class="tool-button" title="Nouvelle conversation dans cet environnement"><i data-lucide="messages-square"></i><span>Chat</span></button>
          <button type="button" id="folderNewTerminal" class="tool-button primary" title="Nouveau terminal dans ${escapeAttr(folderLabel)}" ${terminalSessions.length >= EXPERT_MAX_TERMINALS ? "disabled" : ""}><i data-lucide="square-terminal"></i><span>Terminal</span></button>
        </span>
      </header>
      <div class="folder-agent-summary">
        <span class="folder-isolation-chip"><i data-lucide="folder-open"></i>Environnement actif</span>
        ${agentChips}
      </div>
      <div class="expert-terminal-wall" style="--expert-columns: ${columns}; --expert-rows: ${rows}" aria-label="Mur de ${sessions.length} terminaux">
        ${panes}${emptySlots}
      </div>
    </section>
  `;
};

const renderExpertChatGrid = () => {
  const environmentPath = userEnvironmentPath(currentWorkspace());
  if (!environmentPath) {
    return `<section class="chat-environment-gate">
      <span><i data-lucide="folders"></i></span>
      <h2>Choisissez un environnement</h2>
      <p>Vous pourrez ensuite y ouvrir plusieurs chats avec des agents differents.</p>
      <button type="button" id="chooseEnvironmentFromChat" class="tool-button primary">
        <i data-lucide="chevrons-up-down"></i><span>Choisir un environnement</span>
      </button>
    </section>`;
  }
  const allEnvironmentPanes = expertChatPanesForCurrentEnvironment();
  const environmentPanes = displayedExpertChatPanesForCurrentEnvironment();
  const totalCount = allEnvironmentPanes.length;
  const count = environmentPanes.length;
  expertChatPage = clampExpertChatPage(expertChatPage, count, expertChatPageSizeMode);
  const totalPages = expertChatPageTotal();
  const pagePanes = visibleExpertChatPanes();
  const pageSize = resolveExpertChatPageSize(expertChatPageSizeMode);
  const { columns, rows } = expertChatGridDimensions(
    pagePanes.length,
    expertChatPageSizeMode,
  );
  const firstVisible = count ? expertChatPage * pageSize + 1 : 0;
  const lastVisible = expertChatPage * pageSize + pagePanes.length;
  const environment = knownWorkspaces().find(
    (workspace) => workspace.id === workspaceIdForPath(environmentPath),
  );
  const environmentLabel = environment?.label ?? workspaceBaseName(environmentPath);
  const hasAccounts = (settings?.accounts?.length ?? 0) > 0;
  const environmentId = workspaceIdForPath(environmentPath);
  const environmentDiscussions = allDiscussions()
    .filter((discussion) => {
      const path = discussionFolderPath(discussion);
      return !!path && workspaceIdForPath(path) === environmentId;
    })
    .sort((left, right) => right.lastActivity - left.lastActivity);
  const latestDiscussion = environmentDiscussions[0] ?? null;
  const latestTitle = latestDiscussion?.title?.trim() || "Conversation sans titre";
  const emptyState = `
    <div class="expert-chat-environment-empty">
      <span class="expert-chat-empty-mark"><i data-lucide="messages-square"></i></span>
      <div class="expert-chat-empty-copy">
        <span class="expert-chat-empty-eyebrow">${environmentDiscussions.length
          ? `${environmentDiscussions.length} discussion${environmentDiscussions.length > 1 ? "s" : ""} disponible${environmentDiscussions.length > 1 ? "s" : ""}`
          : "Environnement prêt"}</span>
        <h1>${latestDiscussion ? "Reprenez là où vous vous êtes arrêté" : "Commencez une nouvelle conversation"}</h1>
        <p>${hasAccounts
          ? `Travaillez dans <strong>${escapeHtml(environmentLabel)}</strong> avec le compte et le modèle de votre choix.`
          : "Ajoutez un compte agent pour commencer à travailler dans cet environnement."}</p>
      </div>
      ${latestDiscussion ? `<button type="button" class="expert-chat-empty-recent" data-open-chat="${escapeAttr(latestDiscussion.sessionId)}" title="Reprendre ${escapeAttr(latestTitle)}">
        <span><i data-lucide="history"></i></span>
        <span><small>Dernière discussion</small><strong>${escapeHtml(latestTitle)}</strong><em>${escapeHtml(latestDiscussion.accountLabel)}</em></span>
        <i data-lucide="arrow-right"></i>
      </button>` : ""}
      <div class="expert-chat-empty-actions">
        ${hasAccounts
          ? `<button type="button" id="emptyNewChat" class="tool-button primary"><i data-lucide="plus"></i><span>Nouveau chat</span></button>`
          : `<button type="button" id="emptyConfigureAccounts" class="tool-button primary"><i data-lucide="user-plus"></i><span>Ajouter un compte</span></button>`}
        ${environmentDiscussions.length
          ? `<button type="button" data-open-discussions class="tool-button"><i data-lucide="list"></i><span>Voir toutes les discussions</span></button>`
          : ""}
      </div>
      <small class="expert-chat-empty-hint"><kbd>Ctrl</kbd><kbd>N</kbd> ouvre aussi un nouveau chat.</small>
    </div>`;
  const allChatsWorkingState = `
    <div class="expert-chat-environment-empty expert-chat-availability-empty">
      <span class="expert-chat-empty-mark"><i data-lucide="loader-circle" class="is-spinning"></i></span>
      <div class="expert-chat-empty-copy">
        <span class="expert-chat-empty-eyebrow">${totalCount} chat${totalCount > 1 ? "s" : ""} en cours</span>
        <h1>Tous les chats travaillent</h1>
        <p>Ils réapparaîtront automatiquement ici dès que leur tâche sera terminée.</p>
      </div>
      <div class="expert-chat-empty-actions">
        ${hasAccounts
          ? `<button type="button" id="emptyNewChat" class="tool-button primary"><i data-lucide="plus"></i><span>Nouveau chat disponible</span></button>`
          : `<button type="button" id="emptyConfigureAccounts" class="tool-button primary"><i data-lucide="user-plus"></i><span>Ajouter un compte</span></button>`}
        <button type="button" data-open-discussions class="tool-button"><i data-lucide="list"></i><span>Suivre les chats en cours</span></button>
      </div>
    </div>`;
  const wallEmptyState =
    expertChatDisplayMode === "available" && totalCount > 0 && count === 0
      ? allChatsWorkingState
      : emptyState;
  return `
    <section class="expert-chat-workspace${expertChatToolbarHidden ? " is-toolbar-hidden" : ""}" aria-label="${count} chats affichés sur ${totalCount}, page ${expertChatPage + 1} sur ${totalPages}" title="Dans un chat : Retour arrière : fermer · Suppr : fermer avec la discussion">
      <header id="expertChatToolbar" class="expert-chat-toolbar" aria-hidden="${expertChatToolbarHidden}">
        <div>
          <button type="button" class="icon-button chat-sidebar-expand" data-toggle-chat-sidebar title="Afficher la barre latérale" aria-label="Afficher la barre latérale" aria-controls="chatAppSidebar">
            <i data-lucide="panel-left-open" aria-hidden="true"></i>
          </button>
          <span class="expert-chat-toolbar-mark"><i data-lucide="folder-open"></i></span>
          <span><strong>${escapeHtml(environmentLabel)}</strong><small>${escapeHtml(environmentPath)}</small></span>
        </div>
        <div class="expert-chat-toolbar-actions">
          <span class="expert-chat-count" title="${expertChatDisplayMode === "available" ? `${totalCount - count} chat${totalCount - count > 1 ? "s" : ""} en cours masqué${totalCount - count > 1 ? "s" : ""}` : `${totalCount} chat${totalCount > 1 ? "s" : ""} ouvert${totalCount > 1 ? "s" : ""}`}"><strong>${count}</strong> ${expertChatDisplayMode === "available" ? `disponible${count > 1 ? "s" : ""}` : `chat${count > 1 ? "s" : ""}`}</span>
          <label class="expert-grid-control expert-page-size-control" title="Adapter la taille des chats ouverts ou choisir une grille fixe">
            <span><i data-lucide="app-window"></i><small>Affichage</small></span>
            <select id="expertChatPageSize" aria-label="Mode de disposition des chats">
              <option value="auto" ${expertChatPageSizeMode === "auto" ? "selected" : ""}>Auto</option>
              <option value="6" ${expertChatPageSizeMode === 6 ? "selected" : ""}>6 chats</option>
              <option value="9" ${expertChatPageSizeMode === 9 ? "selected" : ""}>9 chats</option>
              <option value="12" ${expertChatPageSizeMode === 12 ? "selected" : ""}>12 chats</option>
              <option value="16" ${expertChatPageSizeMode === 16 ? "selected" : ""}>16 chats</option>
            </select>
          </label>
          <nav class="expert-chat-pagination" aria-label="Pages de chats">
            <button id="expertChatPrevPage" type="button" ${expertChatPage === 0 ? "disabled" : ""} title="Page precedente" aria-label="Page precedente">
              <i data-lucide="chevron-left"></i>
            </button>
            <span aria-live="polite" title="Chats ${firstVisible} a ${lastVisible} sur ${count}"><strong>${expertChatPage + 1}</strong><small>/ ${totalPages}</small></span>
            <button id="expertChatNextPage" type="button" ${expertChatPage + 1 >= totalPages ? "disabled" : ""} title="Page suivante" aria-label="Page suivante">
              <i data-lucide="chevron-right"></i>
            </button>
          </nav>
          <button type="button" data-open-discussions class="tool-button resume-discussion-button" title="Choisir une discussion a reprendre">
            <i data-lucide="messages-square"></i><span>Reprendre une discussion</span>
          </button>
          <button id="addExpertChat" type="button" class="tool-button primary" title="Ouvrir un nouveau chat dans cet environnement" ${hasAccounts ? "" : "disabled"}>
            <i data-lucide="plus"></i><span>Ouvrir un chat</span>
          </button>
          <button id="expertChatToolbarHide" type="button" class="icon-button expert-chat-toolbar-toggle" title="Masquer le bandeau supérieur" aria-label="Masquer le bandeau supérieur">
            <i data-lucide="chevron-down"></i>
          </button>
        </div>
      </header>
      <button id="expertChatToolbarShow" type="button" class="expert-chat-toolbar-restore" title="Afficher le bandeau supérieur" aria-label="Afficher le bandeau supérieur" aria-controls="expertChatToolbar" aria-hidden="${!expertChatToolbarHidden}" tabindex="${expertChatToolbarHidden ? "0" : "-1"}">
        <i data-lucide="chevron-down"></i>
      </button>
      <div class="expert-chat-wall" style="--expert-chat-columns: ${columns}; --expert-chat-rows: ${rows}" aria-label="Chats ${firstVisible} a ${lastVisible}">
        ${pagePanes.map(renderExpertChatPane).join("") || wallEmptyState}
      </div>
    </section>`;
};

const renderChatFirstShell = () => {
  const isChat = activeView === "chat";
  const activeTaskCount = taskStats(
    taskItemsForEnvironment(loadTaskItems(), currentWorkspace()),
  ).active;
  const scheduledChatCount = scheduledChatPendingCount(loadScheduledChatItems());
  const visibleSidebarWidth = displayedChatSidebarWidth();
  const sidebarMaxWidth = chatSidebarMaxWidth(window.innerWidth);
  captureAllExpertChatScroll();
  document.querySelector(".m-chrome")?.remove();
  document.body.classList.remove("m-drawer-open", "m-sheet-open", "chat-sidebar-resizing");

  app.innerHTML = `
    <div class="layout chat-app-layout ${isChat ? "is-chat" : "is-admin"} ${activeView === "autonomous" ? "is-autonomous" : ""} ${activeView === "orchestration" ? "is-orchestration" : ""} ${visibleSidebarWidth === 0 ? "is-sidebar-collapsed" : ""}" style="--chat-sidebar-width: ${visibleSidebarWidth}px">
      <aside class="sidebar chat-app-sidebar" id="chatAppSidebar">
        <header class="chat-side-brand">
          <button type="button" id="chatHome" class="chat-brand-button" title="Accueil des conversations">
            <span class="chat-brand-mark"><i data-lucide="sparkles"></i></span>
            <span><strong>Switch</strong><small>Agent d'environnement</small></span>
          </button>
          <button type="button" id="chatSidebarClose" class="icon-button chat-sidebar-close" aria-label="Fermer le menu"><i data-lucide="x"></i></button>
          <button type="button" id="chatSidebarCollapse" class="icon-button chat-sidebar-collapse" data-toggle-chat-sidebar title="Masquer la barre latérale" aria-label="Masquer la barre latérale" aria-controls="chatAppSidebar">
            <i data-lucide="panel-left-close" aria-hidden="true"></i>
          </button>
        </header>

        ${renderWorkspaceSwitcher()}

        <label class="chat-side-search">
          <i data-lucide="search"></i>
          <input id="chatSidebarSearch" type="search" value="${escapeAttr(chatSidebarSearch)}" placeholder="Rechercher dans cet environnement" aria-label="Rechercher dans l'environnement actif" />
        </label>
        <nav class="chat-side-conversations" id="chatSideConversations" aria-label="Chats de l'environnement actif">${renderChatSidebarConversations()}</nav>

        <nav class="chat-side-tools" aria-label="Outils">
          <button type="button" id="tasksToggle" class="${activeView === "tasks" ? "active" : ""}" title="Gérer les tâches" ${activeView === "tasks" ? 'aria-current="page"' : ""}><i data-lucide="list-checks"></i><span>Tâches</span><b class="chat-side-task-count" data-task-nav-count ${activeTaskCount ? "" : "hidden"} aria-label="${activeTaskCount} tâche${activeTaskCount > 1 ? "s" : ""} à faire">${activeTaskCount > 99 ? "99+" : activeTaskCount}</b></button>
          <button type="button" id="scheduledChatToggle" class="${activeView === "scheduled-chat" ? "active" : ""}" title="Programmer une tâche dans un chat" ${activeView === "scheduled-chat" ? 'aria-current="page"' : ""}><i data-lucide="calendar-clock"></i><span>Chat planifié</span><b class="chat-side-task-count" data-scheduled-chat-nav-count ${scheduledChatCount ? "" : "hidden"} aria-label="${scheduledChatCount} chat${scheduledChatCount === 1 ? "" : "s"} planifié${scheduledChatCount === 1 ? "" : "s"}">${scheduledChatCount > 99 ? "99+" : scheduledChatCount}</b></button>
          <button type="button" id="promptsToggle" class="${activeView === "prompts" ? "active" : ""}" title="Bibliothèque de prompts" ${activeView === "prompts" ? 'aria-current="page"' : ""}><i data-lucide="message-square-text"></i><span>Prompts</span></button>
          <button type="button" id="autonomousToggle" class="chat-side-autonomous-entry ${activeView === "autonomous" ? "active" : ""}" title="Créer et suivre des agents autonomes persistants" ${activeView === "autonomous" ? 'aria-current="page"' : ""}>
            <span class="chat-side-autonomous-mark"><i data-lucide="bot"></i></span>
            <span class="chat-side-autonomous-copy"><strong>Agents autonomes</strong><small>Création et suivi continu</small></span>
            <b>24/7</b>
          </button>
          <button type="button" id="orchestrationToggle" class="chat-side-orchestration-entry ${activeView === "orchestration" ? "active" : ""}" title="Construire une feature avec un orchestrateur et des chats travailleurs isolés" ${activeView === "orchestration" ? 'aria-current="page"' : ""}>
            <span class="chat-side-orchestration-mark"><i data-lucide="users"></i></span>
            <span class="chat-side-orchestration-copy"><strong>Chats orchestrés</strong><small>Plan, preuves et revue</small></span>
            <b>Bêta</b>
          </button>
          <button id="sideDiscussions" class="${activeView === "discussions" ? "active" : ""}" title="Discussions — reprendre une conversation dans un autre compte"><i data-lucide="messages-square"></i><span>Discussions</span></button>
          <button id="dashboardToggle" class="${activeView === "dashboard" ? "active" : ""}" title="Statistiques"><i data-lucide="bar-chart-3"></i><span>Stats</span></button>
          <button id="limitsToggle" class="${activeView === "limits" ? "active" : ""}" title="Limites"><i data-lucide="calendar-clock"></i><span>Limites</span></button>
          <button id="skillsToggle" class="${activeView === "skills" ? "active" : ""}" title="Skills"><i data-lucide="library"></i><span>Skills</span></button>
        </nav>

        <footer class="chat-side-footer">
          ${renderUserAccountButton()}
          <button id="settingsToggle" class="${activeView === "settings" ? "active" : ""}" title="Paramètres (comptes, pool, agents)"><i data-lucide="settings"></i><span>Paramètres</span></button>
          <button id="themeToggle" class="theme-quick-toggle" title="${activeTheme === "dark" ? "Activer le mode clair" : "Activer le mode sombre"}" aria-label="${activeTheme === "dark" ? "Activer le mode clair" : "Activer le mode sombre"}" aria-pressed="${activeTheme === "light"}">
            <i class="theme-toggle-icon theme-toggle-icon-light" data-lucide="sun"></i>
            <i class="theme-toggle-icon theme-toggle-icon-dark" data-lucide="moon"></i>
            <span class="theme-toggle-label">${activeTheme === "light" ? "Mode clair" : "Mode sombre"}</span>
          </button>
        </footer>
      </aside>
      <div
        id="chatSidebarResizer"
        class="chat-sidebar-resizer"
        role="separator"
        tabindex="0"
        aria-label="Redimensionner la colonne des conversations"
        aria-orientation="vertical"
        aria-controls="chatAppSidebar chatMainWorkspace"
        aria-valuemin="${CHAT_SIDEBAR_MIN_WIDTH}"
        aria-valuemax="${sidebarMaxWidth}"
        aria-valuenow="${visibleSidebarWidth}"
        aria-valuetext="${visibleSidebarWidth === 0 ? "Colonne masquée" : `${visibleSidebarWidth} pixels`}"
        title="Faire glisser pour redimensionner · Double-cliquer pour réinitialiser"
      ></div>
      <button type="button" id="chatSidebarScrim" class="chat-sidebar-scrim" aria-label="Fermer le menu"></button>

      <main class="workspace chat-main-workspace" id="chatMainWorkspace">
        ${isChat
          ? renderExpertChatGrid()
          : `<header class="chat-admin-head">
              <button type="button" class="icon-button chat-sidebar-expand" data-toggle-chat-sidebar title="Afficher la barre latérale" aria-label="Afficher la barre latérale" aria-controls="chatAppSidebar">
                <i data-lucide="panel-left-open" aria-hidden="true"></i>
              </button>
              <button type="button" id="adminBackChat" class="icon-button" title="Retour aux chats" aria-label="Retour aux chats"><i data-lucide="arrow-left" aria-hidden="true"></i></button>
              <div><strong>${escapeHtml(appViewTitle(activeView))}</strong><span>${escapeHtml(statusText)}</span></div>
              <div class="chat-admin-actions">
                ${activeView !== "discussions" ? `<button id="discussionsToggle" type="button" data-open-discussions class="tool-button" title="Choisir une discussion a reprendre"><i data-lucide="messages-square"></i><span>Reprendre une discussion</span></button>` : ""}
                <button id="kombaiToggle" class="icon-button" title="Kombai"><i data-lucide="bot"></i></button>
                <button id="historyToggle" class="icon-button" title="Historique"><i data-lucide="history"></i></button>
                <button id="auditToggle" class="icon-button" title="Audit"><i data-lucide="scan-eye"></i></button>
              </div>
            </header>
            <section class="terminal-shell chat-admin-panel">${renderActiveAppPanel()}</section>`}
        <div class="chat-status-toast" aria-live="polite">${escapeHtml(statusText)}</div>
      </main>
    </div>
    ${renderAutonomousMonitor()}
    ${renderDiscussionArchiveModal()}
    ${renderNewChatModal()}
    ${renderAutonomousOrchestrationPromotionModal()}
    ${renderAutonomousChatEditor()}
    ${renderOrchestrationConversionModal()}
    ${renderNewTerminalModal()}
    ${renderAgentsModal()}
    ${renderWorkspaceModal()}
    ${renderTerminalEnvironmentMenu()}
    ${renderCodexModelSuggestions()}
    ${renderUserProfileModal()}
  `;

  renderIcons(app);
  bindUserAccountUi(() => render());
  bindUi();
  bindExpertChatGridUi();
  if (activeView === "terminal") mountExpertTerminals();
  ensureMobileChrome();
  syncActiveDialogAccessibility();
  revealSelectedStatsPoint();
};

const render = () => {
  if (draggedChatSessionId) clearChatDragUi();
  if (!settings) {
    app.innerHTML = `<main class="boot">Chargement</main>`;
    return;
  }

  captureChatFeedScroll();

  // Plusieurs raccourcis ouvrent directement un chat sans passer par
  // setActiveView. Le polling suit donc aussi la vue réellement rendue.
  if (activeView === "chat" || activeView === "limits") startLimitPoll();
  else stopLimitPoll();

  const activeEl = document.activeElement;
  focusedTerminalKeyBeforeRender =
    (activeEl &&
      terminalSessions.find((session) => session.terminal.element?.contains(activeEl))?.key) ||
    null;

  // Preserve la position de defilement des vues admin (comptes, limites,
  // stats…). renderChatFirstShell remplace tout le DOM (app.innerHTML), ce qui
  // remettrait sinon le scroll a 0 et "ferait remonter" l'utilisateur a chaque
  // re-rendu — tres visible en supprimant un compte en bas de page.
  const adminScrollTop =
    document.querySelector<HTMLElement>(".chat-admin-panel")?.scrollTop ?? 0;
  const adminContentScrollTop =
    document.querySelector<HTMLElement>(".chat-admin-panel > :first-child")?.scrollTop ?? 0;

  terminalSessions.forEach((session) => {
    const element = session.terminal.element;
    element?.parentElement?.removeChild(element);
  });

  renderChatFirstShell();

  if (adminScrollTop > 0) {
    const restoredAdminPanel = document.querySelector<HTMLElement>(".chat-admin-panel");
    if (restoredAdminPanel) restoredAdminPanel.scrollTop = adminScrollTop;
  }
  if (adminContentScrollTop > 0) {
    const restoredAdminContent = document.querySelector<HTMLElement>(
      ".chat-admin-panel > :first-child",
    );
    if (restoredAdminContent) restoredAdminContent.scrollTop = adminContentScrollTop;
  }
};

// Ancienne coque plein ecran des terminaux, conservee pour les outils PTY
// historiques. L'interface principale n'utilise plus cette coque.
const renderLegacyTerminalShell = () => {
  if (!settings || !app) return;

  const account = selectedAccount();
  const proxiesEnabled = proxyControlsEnabled();
  const proxy = selectedProxy();
  const activeSession = activeTerminal();
  const activeRunning = activeSession?.running ?? false;
  const terminalActionReturnsToGrid = activeView !== "terminal";
  const agent = activeAgent();
  const agentOptions = settings.agents
    .map(
      (item) =>
        `<option value="${escapeAttr(item.id)}" ${item.id === agent?.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
    )
    .join("");
  const contextProxy = proxiesEnabled
    ? (activeSession?.proxySummary ?? (proxy ? maskProxy(proxy.proxyUrl) : "sans proxy"))
    : "proxy off";
  const contextProject = displayProjectDir(
    activeSession?.workspacePath ?? activeSession?.folderPath ?? activeSession?.projectDir ?? account?.projectDir,
  );
  const workspacePath = currentWorkspace();
  const workspaceChipLabel = workspacePath ? workspaceBaseName(workspacePath) : "Environnement";
  const workspaceTitle = workspacePath
    ? `Environnement actif et des prochains terminaux: ${workspacePath}`
    : "Aucun environnement actif: une selection est obligatoire";
  const terminalCountLabel =
    terminalSessions.length === 1 ? "1 terminal" : `${terminalSessions.length} terminaux`;
  const workspaceSideItems = terminalWorkspaceGroups()
    .map((group) => {
      const groupClosed = !!group.path && workspaceIsClosed(group.path);
      const groupActive = group.sessions.some((session) => session.key === activeTerminalKey) ||
        (!activeSession && group.path && workspacePath &&
          normalizeWorkspacePath(group.path) === normalizeWorkspacePath(workspacePath));
      const terminals = group.sessions
        .map((session) => {
          const sessionAgentLabel = agentById(session.agentId)?.label ?? session.agentId;
          return `
        <div class="terminal-side-item ${session.key === activeTerminalKey ? "active" : ""}">
          <button class="terminal-side-button" data-terminal-key="${escapeAttr(session.key)}" title="${escapeAttr(terminalTitle(session))}">
            <i data-lucide="square-terminal"></i>
            <span class="terminal-side-main">
              <span class="terminal-side-title">${escapeHtml(terminalTitle(session))}</span>
              <span class="terminal-side-meta">${escapeHtml(`${session.ptyId ? `#${session.ptyId}` : session.status} · ${sessionAgentLabel}`)}</span>
            </span>
            <span class="live-dot ${session.running ? "on" : ""}"></span>
          </button>
          <button class="terminal-side-close" data-close-terminal="${escapeAttr(session.key)}" title="Fermer terminal">
            <i data-lucide="x"></i>
          </button>
        </div>
      `;
        })
        .join("");
      return `
        <section class="workspace-side-group ${groupActive ? "active" : ""} ${groupClosed ? "closed" : ""}">
          <div class="workspace-side-head">
            <button class="workspace-side-select" data-workspace-key="${escapeAttr(group.key)}" title="${escapeAttr(groupClosed ? `${group.detail} · environnement ferme (cliquer pour rouvrir)` : group.detail)}">
              <i data-lucide="${groupClosed ? "folder-x" : "folder-open"}"></i>
              <span class="workspace-side-copy">
                <strong>${escapeHtml(group.label)}</strong>
                <small>${escapeHtml(groupClosed ? `${group.detail} · ferme` : group.detail)}</small>
              </span>
              <span class="workspace-terminal-count">${group.sessions.length}</span>
            </button>
            ${group.selectable
              ? `<button class="workspace-side-new" data-new-terminal-workspace="${escapeAttr(group.key)}" title="${terminalSessions.length >= EXPERT_MAX_TERMINALS ? "Limite de 16 terminaux atteinte" : `Nouveau terminal dans ${escapeAttr(group.label)}`}" ${terminalSessions.length >= EXPERT_MAX_TERMINALS ? "disabled" : ""}>
                <i data-lucide="plus"></i>
              </button>`
              : ""}
            ${group.path && !groupClosed
              ? `<button class="workspace-side-close" data-close-workspace="${escapeAttr(workspaceIdForPath(group.path))}" title="Fermer l'environnement ${escapeAttr(group.label)}" aria-label="Fermer l'environnement ${escapeAttr(group.label)}">
                <i data-lucide="x"></i>
              </button>`
              : ""}
          </div>
          <div class="terminal-side-list">${terminals || `<div class="workspace-empty">Aucun terminal</div>`}</div>
        </section>
      `;
    })
    .join("");

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <header class="brand expert-brand">
          <div class="expert-brand-copy">
            <i data-lucide="square-terminal"></i>
            <span>
              <strong>Switch Terminals</strong>
              <small>${escapeHtml(terminalCountLabel)} · 16 maximum</small>
            </span>
          </div>
        </header>

        <section class="side-section">
          <div class="section-row">
            <span>Environnements</span>
            <span class="section-actions">
              <button class="icon-button" id="workspaceAddSide" title="Choisir ou ajouter un environnement">
                <i data-lucide="folder-open"></i>
              </button>
              <button class="icon-button" id="newTerminalSide" title="${terminalSessions.length >= EXPERT_MAX_TERMINALS ? "Limite de 16 terminaux atteinte" : "Nouveau terminal dans l'environnement actif"}" ${terminalSessions.length >= EXPERT_MAX_TERMINALS ? "disabled" : ""}>
                <i data-lucide="plus"></i>
              </button>
            </span>
          </div>
          <div class="workspace-side-list">${workspaceSideItems}</div>
        </section>
      </aside>

      <main class="workspace">
        <header class="topbar">
          <div class="session-title">
            <span class="live-dot ${activeRunning ? "on" : ""}"></span>
            <div>
              <strong id="expertActiveTitle">${escapeHtml(activeSession ? terminalTitle(activeSession) : (account?.label ?? "Aucun terminal"))}</strong>
              <span id="expertActiveMeta">${escapeHtml(`${contextProxy} | ${contextProject}`)}</span>
            </div>
          </div>
          <div class="actions">
            ${activeView === "terminal"
              ? `<label class="expert-grid-control" title="Disposition du mur de terminaux">
                  <span><i data-lucide="square-terminal"></i><strong>${terminalSessions.length}</strong><small>/ ${EXPERT_MAX_TERMINALS}</small></span>
                  <select id="expertGridLayout" aria-label="Nombre de colonnes">
                    <option value="auto" ${expertGridLayout === "auto" ? "selected" : ""}>Auto</option>
                    <option value="2" ${expertGridLayout === "2" ? "selected" : ""}>2 col.</option>
                    <option value="3" ${expertGridLayout === "3" ? "selected" : ""}>3 col.</option>
                    <option value="4" ${expertGridLayout === "4" ? "selected" : ""}>4 col.</option>
                  </select>
                </label>`
              : ""}
            <div class="workspace-control" title="${escapeAttr(workspaceTitle)}">
              <button id="workspacePick" class="tool-button ${workspacePath ? "primary" : ""}" title="${escapeAttr(workspaceTitle)}">
                <i data-lucide="folder-open"></i>
                <span>${escapeHtml(workspaceChipLabel)}</span>
              </button>
              ${workspacePath
                ? `<button id="workspaceClear" class="icon-button" title="Fermer l'environnement actif" aria-label="Fermer l'environnement actif">
                <i data-lucide="x"></i>
              </button>`
                : ""}
            </div>
            <button id="fullscreenToggle" class="icon-button wide ${isFullscreen ? "active" : ""}" title="${isFullscreen ? "Quitter plein ecran (F11)" : "Plein ecran (F11)"}" aria-label="${isFullscreen ? "Quitter plein ecran" : "Plein ecran"}" aria-pressed="${isFullscreen}">
              <i data-lucide="${isFullscreen ? "minimize-2" : "maximize-2"}"></i>
            </button>
            <button id="poolToggle" class="tool-button ${activeView === "pool" ? "primary" : ""}" title="Comptes">
              <i data-lucide="users"></i>
              <span>Comptes</span>
            </button>
            <button id="limitsToggle" class="tool-button ${activeView === "limits" ? "primary" : ""}" title="Resets limites">
              <i data-lucide="calendar-clock"></i>
              <span>Limites</span>
            </button>
            <button id="dashboardToggle" class="tool-button ${activeView === "dashboard" ? "primary" : ""}" title="Dashboard usage">
              <i data-lucide="bar-chart-3"></i>
              <span>Stats</span>
            </button>
            <button id="kombaiToggle" class="tool-button ${activeView === "kombai" ? "primary" : ""}" title="Kombai (VS Code embarque)">
              <i data-lucide="bot"></i>
              <span>Kombai</span>
            </button>
            <button id="discussionsToggle" data-open-discussions class="tool-button ${activeView === "discussions" ? "primary" : ""}" title="Choisir une discussion a reprendre">
              <i data-lucide="messages-square"></i>
              <span>Reprendre une discussion</span>
            </button>
            <button id="historyToggle" class="tool-button ${activeView === "history" ? "primary" : ""}" title="Historique des demandes (recherche)">
              <i data-lucide="history"></i>
              <span>Historique</span>
            </button>
            <button id="promptsToggle" class="tool-button ${activeView === "prompts" ? "primary" : ""}" title="Bibliothèque de prompts">
              <i data-lucide="message-square-text"></i>
              <span>Prompts</span>
            </button>
            <button id="auditToggle" class="tool-button ${activeView === "audit" ? "primary" : ""}" title="Audit design de la vue affichée (détecteur Impeccable)">
              <i data-lucide="scan-eye"></i>
              <span>Audit</span>
            </button>
            <button id="skillsToggle" class="tool-button ${activeView === "skills" ? "primary" : ""}" title="Bibliothèque de skills">
              <i data-lucide="library"></i>
              <span>Skills</span>
            </button>
            <button id="expertTerminalAction" class="tool-button primary" title="${terminalActionReturnsToGrid ? "Revenir au mur de terminaux" : terminalSessions.length >= EXPERT_MAX_TERMINALS ? "Limite de 16 terminaux atteinte" : "Nouveau terminal"}" ${!terminalActionReturnsToGrid && terminalSessions.length >= EXPERT_MAX_TERMINALS ? "disabled" : ""}>
              <i data-lucide="${terminalActionReturnsToGrid ? "square-terminal" : "plus"}"></i>
              <span>${terminalActionReturnsToGrid ? "Terminaux" : "Nouveau"}</span>
            </button>
            <button id="poolTerminal" class="tool-button" title="Terminal depuis le pool">
              <i data-lucide="shuffle"></i>
              <span>Pool term</span>
            </button>
            <div class="agent-control" title="Agent a lancer dans le terminal actif">
              <select id="agentSelect" class="agent-select" title="Agent actif" aria-label="Agent actif" ${settings.agents.length ? "" : "disabled"}>
                ${agentOptions || `<option value="">Aucun agent</option>`}
              </select>
              <button id="runAgent" class="tool-button agent-run" title="${agent ? (agentIsIde(agent) ? `Ouvrir ${escapeAttr(agent.label)} dans ${escapeAttr(agent.command)}` : `Lancer ${escapeAttr(agent.label)}`) : "Lancer l'agent"}" ${agent && (agentIsIde(agent) || activeRunning) ? "" : "disabled"}>
                <i data-lucide="${agent && agentIsIde(agent) ? "bot" : "play"}"></i>
                <span>${escapeHtml(agent?.label ?? "Agent")}</span>
              </button>
            </div>
            <button id="manageAgents" class="icon-button wide" title="Gerer les agents">
              <i data-lucide="bot"></i>
            </button>
            ${agent?.statusCommand
              ? `<button id="loginStatus" class="icon-button wide" title="Statut login" ${activeRunning ? "" : "disabled"}>
              <i data-lucide="badge-check"></i>
            </button>`
              : ""}
            ${agent?.doctorCommand
              ? `<button id="doctor" class="icon-button wide" title="Doctor" ${activeRunning ? "" : "disabled"}>
              <i data-lucide="stethoscope"></i>
            </button>`
              : ""}
          </div>
        </header>

        <section class="terminal-shell ${activeView === "terminal" ? "expert-terminal-shell" : ""}">
          ${activeView === "terminal"
            ? renderExpertTerminalGrid()
            : activeView === "pool"
              ? renderPoolPanel()
              : activeView === "limits"
                ? renderLimitsPanel()
                : activeView === "dashboard"
                  ? renderDashboardPanel()
                  : activeView === "kombai"
                    ? renderKombaiPanel()
                    : activeView === "discussions"
                      ? renderDiscussionsPanel()
                      : activeView === "history"
                        ? renderPromptHistoryPanel()
                        : activeView === "scheduled-chat"
                          ? renderScheduledChatsPanel(scheduledChatsPanelOptions())
                          : activeView === "prompts"
                            ? renderPromptLibraryPanel()
                        : activeView === "audit"
                            ? renderAuditPanel()
                            : activeView === "skills"
                              ? renderSkillsPanel()
                              : renderChatPanel(chatPanelModel())}
        </section>

        <footer class="statusbar">
          <span>${escapeHtml(statusText)}</span>
          <span>${activeSession?.ptyId ? `PTY #${activeSession.ptyId}` : "PTY inactif"}</span>
        </footer>
      </main>
    </div>
    ${renderDiscussionArchiveModal()}
    ${renderNewChatModal()}
    ${renderAutonomousOrchestrationPromotionModal()}
    ${renderAutonomousChatEditor()}
    ${renderOrchestrationConversionModal()}
    ${renderNewTerminalModal()}
    ${renderAgentsModal()}
    ${renderWorkspaceModal()}
    ${renderTerminalEnvironmentMenu()}
    ${renderCodexModelSuggestions()}
  `;

  renderIcons(app);
  bindUi();
  if (activeView === "terminal") mountExpertTerminals();
  ensureMobileChrome();
  syncActiveDialogAccessibility();
  revealSelectedStatsPoint();
};

const renderAccountsPanel = () => {
  if (!settings) return "";

  const accounts = settings.accounts
    .map((item) => {
      const provider = accountProvider(item);
      const providerName = providerLabel(provider);
      return `
        <article class="simple-account-card ${item.id === selectedAccountId ? "active" : ""}">
          <div class="simple-account-identity">
            <span class="simple-account-provider-icon ${provider}" aria-hidden="true">
              <i data-lucide="${provider === "claude" ? "sparkles" : "cpu"}"></i>
            </span>
            <span class="simple-account-copy">
              <strong>${escapeHtml(item.label)}</strong>
              <small>${escapeHtml(providerName)}</small>
            </span>
          </div>
          <div class="simple-account-actions">
            <button type="button" class="tool-button" data-login-account="${escapeAttr(item.id)}" title="Se connecter avec ${escapeAttr(providerName)}">
              <i data-lucide="log-in"></i><span>Se connecter</span>
            </button>
            <button type="button" class="icon-button wide danger" data-delete-account="${escapeAttr(item.id)}" title="Supprimer ${escapeAttr(item.label)}" aria-label="Supprimer ${escapeAttr(item.label)}">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </article>`;
    })
    .join("");

  return `
    <section class="accounts-panel">
      <div class="accounts-head">
        <div>
          <strong>Comptes</strong>
          <span>Ajoute un compte, connecte-le, ou supprime-le.</span>
        </div>
      </div>

      <form id="addAccountForm" class="simple-account-add">
        <label class="simple-account-name-field">
          <span>Nom du compte</span>
          <input id="newAccountLabel" name="accountLabel" placeholder="Perso, Pro..." maxlength="80" autocomplete="off" />
        </label>
        <fieldset class="simple-provider-field">
          <legend>Se connecter avec</legend>
          <div class="simple-provider-options">
            <label>
              <input type="radio" name="newAccountProvider" value="codex" checked />
              <span><i data-lucide="cpu"></i>Codex</span>
            </label>
            <label>
              <input type="radio" name="newAccountProvider" value="claude" />
              <span><i data-lucide="sparkles"></i>Claude</span>
            </label>
          </div>
        </fieldset>
        <button id="addAccount" type="submit" class="tool-button primary">
          <i data-lucide="user-plus"></i><span>Ajouter et se connecter</span>
        </button>
      </form>

      <section class="simple-accounts-list" aria-labelledby="accountsListTitle">
        <div class="simple-accounts-list-head">
          <strong id="accountsListTitle">Mes comptes</strong>
          <span>${settings.accounts.length}</span>
        </div>
        <div class="simple-account-cards">
          ${accounts || `<div class="simple-accounts-empty"><i data-lucide="user-plus"></i><strong>Aucun compte</strong><span>Ajoute ton premier compte ci-dessus.</span></div>`}
        </div>
      </section>
    </section>
  `;
};

// Le nom interne de la vue reste `pool` pour conserver les reglages et liens
// existants, mais l'interface ne montre plus que la gestion simple des comptes.
const renderAccountsAndPool = (): string => {
  if (!settings) return "";
  return `<div class="accounts-pool-view">${renderAccountsPanel()}</div>`;
};

const renderDiscussionArchiveModal = () => {
  const discussion = discussionArchiveCandidate;
  if (!discussion) return "";
  const title = discussion.title?.trim() || "Conversation sans titre";
  const forkCount = Math.max(1, discussion.forkCount || 1);
  const fileSummary = forkCount > 1
    ? `${forkCount} fichiers, reprises incluses`
    : "1 fichier de session";

  return `
    <div class="modal-backdrop discussion-archive-backdrop" id="discussionArchiveBackdrop">
      <section class="modal discussion-archive-modal" role="dialog" aria-modal="true" aria-labelledby="discussionArchiveTitle" aria-describedby="discussionArchiveDescription discussionArchiveRecovery" tabindex="-1">
        <header class="modal-head discussion-archive-head">
          <div class="discussion-archive-heading">
            <span class="discussion-archive-mark" aria-hidden="true"><i data-lucide="trash-2"></i></span>
            <div>
              <span class="discussion-archive-eyebrow">Historique</span>
              <h2 id="discussionArchiveTitle">Retirer cette discussion ?</h2>
              <p id="discussionArchiveDescription">Elle ne sera plus affichée dans la colonne de gauche.</p>
            </div>
          </div>
          <button type="button" class="icon-button" id="closeDiscussionArchive" title="Fermer" aria-label="Fermer la confirmation">
            <i data-lucide="x"></i>
          </button>
        </header>
        <div class="modal-body">
          <section class="modal-section discussion-archive-content">
            <div class="discussion-archive-target">
              <span aria-hidden="true"><i data-lucide="message-square"></i></span>
              <span>
                <strong title="${escapeAttr(title)}">${escapeHtml(title)}</strong>
                <small>${escapeHtml(discussion.accountLabel)} · ${escapeHtml(fileSummary)}</small>
              </span>
            </div>
            <aside class="discussion-archive-recovery" id="discussionArchiveRecovery">
              <i data-lucide="history" aria-hidden="true"></i>
              <span><strong>Cette action reste récupérable</strong><small>Les fichiers seront déplacés dans <code>sessions-archive</code>, sans être supprimés définitivement.</small></span>
            </aside>
          </section>
        </div>
        <footer class="modal-actions discussion-archive-actions">
          <button type="button" class="tool-button" id="cancelDiscussionArchive" data-dialog-initial-focus>Annuler</button>
          <button type="button" class="tool-button danger" id="confirmDiscussionArchive">
            <i data-lucide="trash-2"></i><span>Retirer de l’historique</span>
          </button>
        </footer>
      </section>
    </div>`;
};

const renderNewChatModal = () => {
  if (!settings || !newChatModalOpen) return "";

  const accounts = settings.accounts;
  const account = accountById(newChatAccountId) ?? accounts[0] ?? null;
  const provider = accountProvider(account);
  const environmentPath = userEnvironmentPath(newChatPendingWorkspace ?? currentWorkspace());
  const environmentLabel = environmentPath
    ? knownWorkspaces().find((workspace) => workspace.id === workspaceIdForPath(environmentPath))?.label
      ?? workspaceBaseName(environmentPath)
    : null;
  const modelValue = newChatModel || accountModel(account);
  const pendingTaskTitle = newChatPendingTaskTitle;

  const accountOptions = accounts
    .map((item) => {
      const selected = item.id === account?.id;
      const usage = newChatAccountUsageFor(item);
      return `<button
        type="button"
        class="new-chat-account-option ${selected ? "selected" : ""}"
        data-new-chat-account="${escapeAttr(item.id)}"
        role="radio"
        aria-checked="${selected}"
        aria-label="${escapeAttr(`${item.label}, ${providerLabel(accountProvider(item))}, ${usage.announcement}`)}"
        tabindex="${selected ? "0" : "-1"}"
        title="${escapeAttr(`${item.label} · ${usage.detail}`)}"
      >
        <span class="new-chat-account-dot" aria-hidden="true"></span>
        <span class="new-chat-account-copy">
          <strong>${escapeHtml(item.label)}</strong>
          <small>${escapeHtml(providerLabel(accountProvider(item)))} · ${escapeHtml(accountModel(item))}</small>
        </span>
        <span
          class="new-chat-account-usage ${usage.state}"
          data-new-chat-account-usage="${escapeAttr(item.id)}"
          title="${escapeAttr(usage.detail)}"
          aria-hidden="true"
        >
          <strong>${escapeHtml(usage.value)}</strong>
          <small>${escapeHtml(usage.caption)}</small>
        </span>
        <i data-lucide="${accountProvider(item) === "claude" ? "sparkles" : "cpu"}"></i>
      </button>`;
    })
    .join("");

  return `
    <div class="modal-backdrop" id="newChatBackdrop">
      <section class="modal new-chat-modal" role="dialog" aria-modal="true" aria-labelledby="newChatModalTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="newChatModalTitle">${pendingTaskTitle ? "Exécuter une tâche" : "Nouveau chat"}</h2>
            <p>${pendingTaskTitle
              ? `Choisis l’agent qui exécutera cette tâche dans <strong>${escapeHtml(environmentLabel ?? "cet environnement")}</strong>.`
              : environmentLabel
                ? `Compte, modele et mode pour ce chat dans <strong>${escapeHtml(environmentLabel)}</strong>.`
                : "Choisis le compte, le modele et le mode de ce chat."}</p>
          </div>
          <button class="icon-button" id="closeNewChatModal" title="Fermer" aria-label="Fermer">
            <i data-lucide="x"></i>
          </button>
        </header>

        <div class="modal-body">
          ${pendingTaskTitle ? `<aside class="new-chat-task-context">
            <span aria-hidden="true"><i data-lucide="list-checks"></i></span>
            <div><small>Tâche à exécuter</small><strong>${escapeHtml(pendingTaskTitle)}</strong></div>
          </aside>` : ""}
          <section class="modal-section">
            <span class="new-chat-field-title">Compte / agent</span>
            ${accounts.length
              ? `<div class="new-chat-account-options" role="radiogroup" aria-label="Compte du nouveau chat">${accountOptions}</div>`
              : `<div class="empty">Aucun compte agent : ajoutez-en un dans les parametres.</div>`}
            <span id="newChatAccountStatus" class="visually-hidden" role="status" aria-live="polite"></span>
            <p class="new-chat-auto-status" id="newChatAutoStatus" role="status" aria-live="polite">
              <i data-lucide="sparkles"></i>
              <span>${newChatBestQuotaInFlight
                ? "Lecture des quotas disponibles…"
                : `Le choix automatique ajoute ${OPEN_CHAT_QUOTA_RESERVATION_PERCENT} % d’utilisation par chat déjà ouvert sur le compte.`}</span>
            </p>
            <label>
              <span>Modele</span>
              <input id="newChatModel" list="codexModelSuggestions" value="${escapeAttr(modelValue)}" placeholder="${escapeAttr(providerDefaultModel(provider))}" autocomplete="off" spellcheck="false" maxlength="160" ${account ? "" : "disabled"} />
            </label>
            <label>
              <span>Mode</span>
              <select id="newChatMode" ${account ? "" : "disabled"}>
                <option value="build" ${newChatMode === "build" ? "selected" : ""}>Construire</option>
                <option value="plan" ${newChatMode === "plan" ? "selected" : ""}>Planifier</option>
                <option value="ask" ${newChatMode === "ask" ? "selected" : ""}>Question</option>
              </select>
            </label>
          </section>
        </div>

        <footer class="modal-actions">
          <button class="tool-button" id="cancelNewChat">Annuler</button>
          <button
            class="tool-button new-chat-best-quota"
            id="confirmBestQuotaNewChat"
            aria-describedby="newChatAutoStatus"
            title="Choisir le quota restant le plus élevé, avec 20 % d’utilisation ajoutée par chat déjà ouvert"
            ${account && environmentPath && !newChatBestQuotaInFlight ? "" : "disabled"}
          >
            <i data-lucide="sparkles"></i>
            <span>${newChatBestQuotaInFlight
              ? "Recherche…"
              : pendingTaskTitle ? "Lancer avec le plus de tokens" : "Ouvrir avec le plus de tokens"}</span>
          </button>
          <button class="tool-button primary" id="confirmNewChat" ${account && environmentPath ? "" : "disabled"}>
            <i data-lucide="${pendingTaskTitle ? "play" : "plus"}"></i>
            <span>${pendingTaskTitle ? "Lancer l’exécution" : "Ouvrir le chat"}</span>
          </button>
        </footer>
      </section>
    </div>
  `;
};

const openChatAccountIdsForQuotaSelection = (): string[] => {
  const accountIds = expertChatPanes
    .map((pane) => pane.accountId ?? pane.discussion?.accountId ?? null)
    .filter((accountId): accountId is string => !!accountId);
  const paneSessionIds = new Set(
    expertChatPanes
      .map((pane) => pane.discussion?.sessionId)
      .filter((sessionId): sessionId is string => !!sessionId),
  );

  // Le lecteur historique hors grille ne compte que si aucun pane ouvert ne
  // represente deja la meme conversation.
  if (chatDiscussion && !paneSessionIds.has(chatDiscussion.sessionId)) {
    accountIds.push(chatAccountId ?? chatDiscussion.accountId);
  }
  return accountIds;
};

const openChatCountForAccount = (accountId: string): number =>
  openChatAccountIdsForQuotaSelection().filter((candidate) => candidate === accountId).length;

const newChatAccountUsageFor = (account: AccountProfile) => {
  const status = chatQuotaStatusFor(account);
  if (status.remainingPercent !== null) {
    const serverUsedPercent = Math.round(100 - status.remainingPercent);
    const openChatCount = openChatCountForAccount(account.id);
    const { effectiveRemainingPercent, reservedPercent } =
      quotaAfterOpenChatReservations(status.remainingPercent, openChatCount);
    const usedPercent = Math.round(100 - effectiveRemainingPercent);
    const weightedState = effectiveRemainingPercent <= 0
      ? "exhausted"
      : effectiveRemainingPercent <= 15 ? "low" : "available";
    const reservationDetail = openChatCount > 0
      ? ` · ${serverUsedPercent} % serveur + ${Math.round(reservedPercent)} % pour ${openChatCount} chat${openChatCount > 1 ? "s" : ""} ouvert${openChatCount > 1 ? "s" : ""}`
      : "";
    return {
      state: weightedState,
      value: `${usedPercent} %`,
      caption: openChatCount > 0 ? "pondéré" : "utilisé",
      announcement: openChatCount > 0
        ? `${usedPercent} % d’utilisation pondérée, dont ${Math.round(reservedPercent)} % réservés pour ${openChatCount} chat${openChatCount > 1 ? "s" : ""} ouvert${openChatCount > 1 ? "s" : ""}`
        : `${usedPercent} % utilisé`,
      detail: openChatCount > 0
        ? `${usedPercent} % d’utilisation pondérée${reservationDetail} · ${status.detail}`
        : `${usedPercent} % utilisé · ${status.detail}`,
    };
  }

  if (status.state === "loading") {
    return {
      state: status.state,
      value: "…",
      caption: "quota",
      announcement: "utilisation en cours de chargement",
      detail: status.detail,
    };
  }

  const disconnected = status.state === "disconnected";
  return {
    state: status.state,
    value: "—",
    caption: disconnected ? "connexion" : "indisponible",
    announcement: disconnected ? "compte non connecté" : "utilisation indisponible",
    detail: status.detail,
  };
};

const syncNewChatAccountUsageUi = () => {
  document.querySelectorAll<HTMLElement>("[data-new-chat-account-usage]").forEach((element) => {
    const account = accountById(element.dataset.newChatAccountUsage);
    if (!account) return;
    const usage = newChatAccountUsageFor(account);
    element.className = `new-chat-account-usage ${usage.state}`;
    element.querySelector<HTMLElement>("strong")!.textContent = usage.value;
    element.querySelector<HTMLElement>("small")!.textContent = usage.caption;
    element.title = usage.detail;

    const button = element.closest<HTMLButtonElement>("[data-new-chat-account]");
    if (!button) return;
    button.title = `${account.label} · ${usage.detail}`;
    button.setAttribute(
      "aria-label",
      `${account.label}, ${providerLabel(accountProvider(account))}, ${usage.announcement}`,
    );
  });
};

// La selection d'un compte ne touche qu'aux controles de la modale. L'ancien
// chemin rappelait render(), demontait toute l'application (chats, terminaux,
// focus), puis reconstruisait exactement le meme ecran autour de la modale.
const selectNewChatAccount = (accountId: string | null) => {
  const account = accountById(accountId);
  if (!account) return;

  const modelInput = document.querySelector<HTMLInputElement>("#newChatModel");
  if (newChatAccountId && modelInput) {
    newChatModelDrafts.set(newChatAccountId, modelInput.value);
  }
  const modeSelect = document.querySelector<HTMLSelectElement>("#newChatMode");
  if (modeSelect) newChatMode = (modeSelect.value as ChatMode) || newChatMode;

  newChatAccountId = account.id;
  newChatModel = newChatModelDrafts.get(account.id) ?? accountModel(account);
  newChatModelDrafts.set(account.id, newChatModel);

  document.querySelectorAll<HTMLButtonElement>("[data-new-chat-account]").forEach((button) => {
    const selected = button.dataset.newChatAccount === account.id;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });

  if (modelInput) {
    modelInput.value = newChatModel;
    modelInput.placeholder = providerDefaultModel(accountProvider(account));
    modelInput.disabled = false;
    modelInput.setCustomValidity("");
  }
  const confirm = document.querySelector<HTMLButtonElement>("#confirmNewChat");
  if (confirm) {
    confirm.disabled = !userEnvironmentPath(newChatPendingWorkspace ?? currentWorkspace());
  }
  const status = document.querySelector<HTMLElement>("#newChatAccountStatus");
  if (status) {
    const usage = newChatAccountUsageFor(account);
    status.textContent = `${account.label} sélectionné · ${usage.announcement} · modèle ${newChatModel}`;
  }
  void loadChatModelCatalog(account.id);
};

const openAutonomousOrchestrationPromotion = (agentId: string): void => {
  if (autonomousBusyId) return;
  const agent = autonomousAgents.find((candidate) => candidate.id === agentId);
  if (!agent) {
    statusText = "Cet agent autonome n'existe plus";
    render();
    return;
  }
  const account = accountById(agent.accountId);
  rememberDialogTrigger("autonomous-orchestration", null);
  autonomousOrchestrationPromotion = {
    agentId,
    orchestratorAccountId: agent.accountId,
    workerAccountIds: Array.from(
      { length: Math.max(1, Math.min(12, orchestrationWorkerCount)) },
      () => agent.accountId,
    ),
    name: agent.name.trim(),
    objective: agent.objective.trim(),
    projectDir:
      agent.projectDir?.trim()
      || userEnvironmentPath(currentWorkspace())
      || account?.projectDir
      || "",
    testCommand: agent.testCommand?.trim() || orchestrationTestCommandDraft.trim(),
    workerCount: Math.max(1, Math.min(12, orchestrationWorkerCount)),
    testTimeoutSeconds: Math.max(
      5,
      Math.min(1800, agent.testTimeoutSeconds ?? orchestrationTestTimeoutSeconds),
    ),
    busy: false,
  };
  autonomousMonitorOpen = false;
  stopAutonomousMonitorTurnPoll();
  statusText = "Configurer la promotion en orchestration";
  render();
};

const closeAutonomousOrchestrationPromotion = (): void => {
  if (!autonomousOrchestrationPromotion || autonomousOrchestrationPromotion.busy) return;
  const returnFocus = takeDialogTrigger("autonomous-orchestration");
  autonomousOrchestrationPromotion = null;
  render();
  restoreDialogTrigger(returnFocus);
};

const normalizeAutonomousPromotionWorkerAccounts = (
  state: AutonomousOrchestrationPromotionState,
): string[] => {
  state.workerAccountIds = Array.from({ length: state.workerCount }, (_, index) =>
    state.workerAccountIds[index] || state.orchestratorAccountId,
  );
  return state.workerAccountIds;
};

const renderAutonomousPromotionWorkerAccounts = (
  state: AutonomousOrchestrationPromotionState,
): string => normalizeAutonomousPromotionWorkerAccounts(state)
  .map((accountId, index) => `<label class="orchestration-create-worker">
    <span><b>W${index + 1}</b><span><strong>Worker ${index + 1}</strong><small>Adresse indépendante</small></span></span>
    <select data-autonomous-orchestration-worker="${index}" aria-label="Adresse e-mail ou compte du worker ${index + 1}" ${state.busy ? "disabled" : ""}>${orchestrationAccountOptions(accountId)}</select>
  </label>`)
  .join("");

const renderAutonomousOrchestrationPromotionModal = (): string => {
  const state = autonomousOrchestrationPromotion;
  if (!state) return "";
  const agent = autonomousAgents.find((candidate) => candidate.id === state.agentId);
  if (!agent) return "";
  const connectors = normalizeAutonomousConnectors(agent.connectors);
  const sessionLabel = agent.sessionId && state.orchestratorAccountId === agent.accountId
    ? `La conversation ${agent.sessionId.slice(0, 8)} et son contexte deviennent ceux de l'orchestrateur.`
    : agent.sessionId
      ? "Le compte change : le cycle courant sera arrêté et la mémoire persistante amorcera une nouvelle session."
    : "Aucune conversation n'est encore attachée : l'orchestrateur ouvrira une nouvelle session avec cet objectif.";

  return `
    <div class="modal-backdrop" id="autonomousOrchestrationBackdrop">
      <section class="modal orchestration-convert-modal" role="dialog" aria-modal="true" aria-labelledby="autonomousOrchestrationTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="autonomousOrchestrationTitle">Passer en mode orchestration</h2>
            <p><strong>${escapeHtml(agent.name || agent.objective)}</strong> devient l'orchestrateur d'une équipe de workers.</p>
          </div>
          <button type="button" class="icon-button" id="closeAutonomousOrchestration" title="Fermer" aria-label="Fermer" ${state.busy ? "disabled" : ""}>
            <i data-lucide="x"></i>
          </button>
        </header>
        <form id="autonomousOrchestrationForm">
          <div class="modal-body">
            <section class="modal-section orchestration-convert-summary">
              <div class="orchestration-convert-agent">
                <span><i data-lucide="brain-circuit"></i></span>
                <div><small>Futur orchestrateur</small><strong id="autonomousOrchestrationAccountLabel">${escapeHtml(orchestrationAccountLabel(state.orchestratorAccountId))}</strong><p id="autonomousOrchestrationSessionLabel">${escapeHtml(sessionLabel)}</p></div>
              </div>
              <label><span>Adresse e-mail / compte orchestrateur</span><select id="autonomousOrchestrationAccount" required ${state.busy || !settings?.accounts.length ? "disabled" : ""}>${orchestrationAccountOptions(state.orchestratorAccountId)}</select></label>
              <label><span>Nom <small>optionnel</small></span><input id="autonomousOrchestrationName" maxlength="120" value="${escapeAttr(state.name)}" placeholder="Ex. Refonte des permissions" ${state.busy ? "disabled" : ""} /></label>
              <label><span>Objectif de l'équipe</span><textarea id="autonomousOrchestrationObjective" maxlength="65536" required placeholder="Décris le résultat complet que l'orchestrateur doit répartir…" ${state.busy ? "disabled" : ""}>${escapeHtml(state.objective)}</textarea></label>
              <div class="orchestration-convert-grid">
                <label><span>Dépôt Git</span><input id="autonomousOrchestrationProject" required value="${escapeAttr(state.projectDir)}" spellcheck="false" ${state.busy ? "disabled" : ""} /></label>
                <label><span>Commande de validation</span><input id="autonomousOrchestrationTestCommand" required maxlength="8000" value="${escapeAttr(state.testCommand)}" placeholder="npm test && npm run build" spellcheck="false" ${state.busy ? "disabled" : ""} /></label>
                <label><span>Workers <small>hors orchestrateur</small></span><span class="orchestration-worker-count"><input id="autonomousOrchestrationWorkerCount" type="number" min="1" max="12" step="1" required value="${state.workerCount}" ${state.busy ? "disabled" : ""} /><small id="autonomousOrchestrationTeamTotal">${state.workerCount + 1} agents au total</small></span></label>
                <label><span>Timeout des tests</span><span class="orchestration-timeout"><input id="autonomousOrchestrationTimeout" type="number" min="5" max="1800" required value="${state.testTimeoutSeconds}" ${state.busy ? "disabled" : ""} /><small>secondes</small></span></label>
              </div>
              <section class="orchestration-create-team autonomous-orchestration-team">
                <header><span><small>Affectations initiales</small><strong>Choisir l'adresse de chaque worker</strong></span><button id="autonomousOrchestrationWorkersUseOrchestrator" type="button" class="tool-button" ${state.busy ? "disabled" : ""}><i data-lucide="copy-check"></i><span>Même compte pour tous</span></button></header>
                <div id="autonomousOrchestrationWorkerAccounts">${renderAutonomousPromotionWorkerAccounts(state)}</div>
              </section>
              <aside class="orchestration-convert-note"><i data-lucide="shield-check"></i><span><strong>Bascule sans double exécution</strong><small>Le cycle autonome courant est arrêté avant la création. L'agent autonome n'est retiré qu'une fois l'équipe prête ; en cas d'échec, il retrouve son état précédent.</small></span></aside>
              ${connectors.length ? `<aside class="orchestration-convert-note"><i data-lucide="unplug"></i><span><strong>Connecteurs non transférés</strong><small>${escapeHtml(connectors.map(autonomousConnectorLabel).join(", "))} restent propres au mode autonome et ne seront pas disponibles aux workers.</small></span></aside>` : ""}
            </section>
          </div>
          <footer class="modal-actions">
            <button type="button" class="tool-button" id="cancelAutonomousOrchestration" ${state.busy ? "disabled" : ""}>Annuler</button>
            <button type="submit" class="tool-button primary" ${state.busy ? "disabled" : ""}>
              <i data-lucide="${state.busy ? "loader-circle" : "users"}"></i>
              <span>${state.busy ? "Promotion de l'agent…" : "Créer l'équipe orchestrée"}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  `;
};

const bindAutonomousOrchestrationPromotionUi = (): void => {
  const state = autonomousOrchestrationPromotion;
  if (!state) return;
  const form = document.querySelector<HTMLFormElement>("#autonomousOrchestrationForm");
  const name = document.querySelector<HTMLInputElement>("#autonomousOrchestrationName");
  const objective = document.querySelector<HTMLTextAreaElement>("#autonomousOrchestrationObjective");
  const project = document.querySelector<HTMLInputElement>("#autonomousOrchestrationProject");
  const testCommand = document.querySelector<HTMLInputElement>("#autonomousOrchestrationTestCommand");
  const orchestratorAccount = document.querySelector<HTMLSelectElement>("#autonomousOrchestrationAccount");
  const workerCountInput = document.querySelector<HTMLInputElement>("#autonomousOrchestrationWorkerCount");
  const timeoutInput = document.querySelector<HTMLInputElement>("#autonomousOrchestrationTimeout");
  const workerAccounts = document.querySelector<HTMLElement>("#autonomousOrchestrationWorkerAccounts");

  name?.addEventListener("input", () => {
    state.name = name.value;
  });
  objective?.addEventListener("input", () => {
    state.objective = objective.value;
    objective.setCustomValidity("");
  });
  project?.addEventListener("input", () => {
    state.projectDir = project.value;
    project.setCustomValidity("");
  });
  testCommand?.addEventListener("input", () => {
    state.testCommand = testCommand.value;
    testCommand.setCustomValidity("");
  });
  orchestratorAccount?.addEventListener("change", () => {
    const previous = state.orchestratorAccountId;
    state.orchestratorAccountId = orchestratorAccount.value;
    state.workerAccountIds = state.workerAccountIds.map((accountId) =>
      accountId === previous ? state.orchestratorAccountId : accountId,
    );
    if (workerAccounts) {
      workerAccounts.innerHTML = renderAutonomousPromotionWorkerAccounts(state);
      renderIcons(workerAccounts);
    }
    const agent = autonomousAgents.find((candidate) => candidate.id === state.agentId);
    const accountLabel = document.querySelector<HTMLElement>("#autonomousOrchestrationAccountLabel");
    const sessionLabel = document.querySelector<HTMLElement>("#autonomousOrchestrationSessionLabel");
    if (accountLabel) accountLabel.textContent = orchestrationAccountLabel(state.orchestratorAccountId);
    if (sessionLabel && agent) {
      sessionLabel.textContent = agent.sessionId && state.orchestratorAccountId === agent.accountId
        ? `La conversation ${agent.sessionId.slice(0, 8)} et son contexte deviennent ceux de l'orchestrateur.`
        : agent.sessionId
          ? "Le compte change : le cycle courant sera arrêté et la mémoire persistante amorcera une nouvelle session."
          : "Aucune conversation n'est encore attachée : l'orchestrateur ouvrira une nouvelle session avec cet objectif.";
    }
  });
  workerCountInput?.addEventListener("input", () => {
    const value = Number(workerCountInput.value);
    if (Number.isInteger(value) && value >= 1 && value <= 12) {
      state.workerCount = value;
      if (workerAccounts) {
        workerAccounts.innerHTML = renderAutonomousPromotionWorkerAccounts(state);
        renderIcons(workerAccounts);
      }
    }
    workerCountInput.setCustomValidity("");
    const total = document.querySelector<HTMLElement>("#autonomousOrchestrationTeamTotal");
    if (total && Number.isInteger(value) && value >= 1 && value <= 12) {
      total.textContent = `${value + 1} agents au total`;
    }
  });
  timeoutInput?.addEventListener("input", () => {
    const value = Number(timeoutInput.value);
    if (Number.isFinite(value)) state.testTimeoutSeconds = value;
    timeoutInput.setCustomValidity("");
  });
  form?.addEventListener("change", (event) => {
    const select = event.target instanceof HTMLSelectElement
      ? event.target.closest<HTMLSelectElement>("[data-autonomous-orchestration-worker]")
      : null;
    if (!select) return;
    const index = Number(select.dataset.autonomousOrchestrationWorker);
    if (Number.isInteger(index) && index >= 0 && index < state.workerCount) {
      state.workerAccountIds[index] = select.value;
    }
  });
  document.querySelector<HTMLButtonElement>("#autonomousOrchestrationWorkersUseOrchestrator")?.addEventListener("click", () => {
    state.workerAccountIds = Array.from(
      { length: state.workerCount },
      () => state.orchestratorAccountId,
    );
    if (workerAccounts) {
      workerAccounts.innerHTML = renderAutonomousPromotionWorkerAccounts(state);
      renderIcons(workerAccounts);
    }
  });

  document.querySelector<HTMLButtonElement>("#closeAutonomousOrchestration")?.addEventListener("click", closeAutonomousOrchestrationPromotion);
  document.querySelector<HTMLButtonElement>("#cancelAutonomousOrchestration")?.addEventListener("click", closeAutonomousOrchestrationPromotion);
  document.querySelector<HTMLDivElement>("#autonomousOrchestrationBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAutonomousOrchestrationPromotion();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    const agent = autonomousAgents.find((candidate) => candidate.id === state.agentId);
    const workerCount = Number(workerCountInput?.value);
    const timeout = Number(timeoutInput?.value);
    if (!agent) {
      autonomousOrchestrationPromotion = null;
      statusText = "Cet agent autonome n'existe plus";
      render();
      return;
    }
    if (!objective?.value.trim()) {
      objective?.setCustomValidity("Décris le résultat que l'équipe doit construire.");
      objective?.reportValidity();
      return;
    }
    if (!project?.value.trim()) {
      project?.setCustomValidity("Choisis le dépôt Git à orchestrer.");
      project?.reportValidity();
      return;
    }
    if (!testCommand?.value.trim()) {
      testCommand?.setCustomValidity("Indique la commande qui valide le rendu.");
      testCommand?.reportValidity();
      return;
    }
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 12) {
      workerCountInput?.setCustomValidity("Choisis entre 1 et 12 workers.");
      workerCountInput?.reportValidity();
      return;
    }
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 1800) {
      timeoutInput?.setCustomValidity("Choisis un timeout entre 5 et 1800 secondes.");
      timeoutInput?.reportValidity();
      return;
    }
    const targetOrchestratorAccount = accountById(orchestratorAccount?.value || state.orchestratorAccountId);
    state.workerCount = workerCount;
    state.workerAccountIds = normalizeAutonomousPromotionWorkerAccounts(state);
    if (!targetOrchestratorAccount) {
      statusText = "Choisis un compte valide pour l'orchestrateur";
      render();
      return;
    }
    if (state.workerAccountIds.some((accountId) => !accountById(accountId))) {
      statusText = "Choisis un compte valide pour chaque worker";
      render();
      return;
    }

    state.orchestratorAccountId = targetOrchestratorAccount.id;
    state.name = name?.value.trim() ?? "";
    state.objective = objective.value.trim();
    state.projectDir = project.value.trim();
    state.testCommand = testCommand.value.trim();
    state.testTimeoutSeconds = timeout;
    state.busy = true;
    autonomousBusyId = agent.id;
    statusText = "Promotion de l'agent vers l'orchestration";
    render();
    try {
      let promotionAgent = agent;
      if (promotionAgent.accountId !== state.orchestratorAccountId) {
        promotionAgent = await invoke<AutonomousAgentSnapshot>(
          "reassign_autonomous_agent_account",
          {
            id: promotionAgent.id,
            request: { accountId: state.orchestratorAccountId },
          },
        );
        updateAutonomousAgentLocally(promotionAgent);
      }
      const created = await invoke<OrchestrationSnapshot>(
        "promote_autonomous_agent_to_orchestration",
        {
          id: promotionAgent.id,
          request: {
            name: state.name || null,
            objective: state.objective,
            workerCount: state.workerCount,
            workerAccountIds: state.workerAccountIds.slice(0, state.workerCount),
            projectDir: state.projectDir,
            testCommand: state.testCommand,
            testTimeoutSeconds: state.testTimeoutSeconds,
          },
        },
      );
      updateOrchestrationLocally(created);
      removeAutonomousAgentLocally(promotionAgent.id);
      orchestrationSelectedRunId = created.id;
      orchestrationWorkerCount = created.workerCount;
      orchestrationTestCommandDraft = created.testCommand;
      orchestrationTestTimeoutSeconds = created.testTimeoutSeconds;
      forgetDialogTrigger("autonomous-orchestration");
      autonomousOrchestrationPromotion = null;
      autonomousBusyId = null;
      syncOrchestrationChatPanes();
      statusText = created.status === "active"
        ? "Agent promu en orchestrateur ; les workers sont en préparation"
        : "Agent promu en orchestrateur, actuellement en pause";
      setActiveView("orchestration");
      startOrchestrationsPoll();
      void refreshOrchestrations();
      void refreshAutonomousAgents();
    } catch (error) {
      state.busy = false;
      autonomousBusyId = null;
      statusText = String(error);
      render();
      void refreshAutonomousAgents();
      void refreshOrchestrations();
    }
  });
};

const openAutonomousChatEditor = (pane: ExpertChatPane): void => {
  if (pane.orchestrationRole) {
    statusText = "Ce chat est déjà piloté par une orchestration";
    refreshExpertChatPane(pane);
    return;
  }
  const linkedAgent = autonomousAgentForPane(pane);
  if (!linkedAgent && pane.autonomousAgentId && autonomousAgentsLoaded) {
    pane.autonomousAgentId = null;
    persistExpertChats();
  }
  if (
    !linkedAgent
    && (
      chatTurnIsBusy(pane.turn?.status)
      || (pane.discussion ? discussionHasRunningTurn(pane.discussion) : false)
    )
  ) {
    statusText = "Attends la fin du message en cours avant d'autonomiser ce chat";
    refreshExpertChatPane(pane);
    return;
  }
  if (!linkedAgent && (pane.queueDrainInFlight || pane.queuedSubmissions.length > 0)) {
    statusText = "Envoie ou annule les messages en attente avant d'autonomiser ce chat";
    refreshExpertChatPane(pane);
    return;
  }

  const account = linkedAgent
    ? accountById(linkedAgent.accountId)
    : expertChatSelectedAccount(pane);
  if (!account) {
    statusText = "Le compte de ce chat est introuvable";
    refreshExpertChatPane(pane);
    return;
  }
  const lastUserMessage = [...pane.messages]
    .reverse()
    .find((message) => message.role === "user")?.text.trim() ?? "";
  const projectDir = linkedAgent?.projectDir?.trim()
    || discussionFolderPath(pane.discussion)
    || userEnvironmentPath(pane.pendingWorkspace)
    || userEnvironmentPath(currentWorkspace())
    || account.projectDir
    || "";
  const model = linkedAgent?.model?.trim() || accountModel(account);
  const reasoningEffort = accountProvider(account) === "codex"
    ? reasoningEffortForChatModel(
        account,
        model,
        linkedAgent?.reasoningEffort ?? accountReasoningEffort(account),
      )
    : "";
  rememberDialogTrigger("autonomous-chat", null);
  autonomousChatEditor = {
    paneKey: pane.key,
    agentId: linkedAgent?.id ?? null,
    accountId: account.id,
    name: linkedAgent?.name.trim() || pane.discussion?.title?.trim() || "",
    objective: linkedAgent?.objective.trim()
      || pane.draft.trim()
      || lastUserMessage
      || pane.discussion?.preview?.trim()
      || "",
    role: linkedAgent?.role?.trim() || "",
    projectDir,
    mode: linkedAgent?.mode ?? pane.mode,
    model,
    reasoningEffort,
    intervalSeconds: linkedAgent?.intervalSeconds ?? 15 * 60,
    requireUserReview: linkedAgent?.requireUserReview ?? true,
    connectors: normalizeAutonomousConnectors(linkedAgent?.connectors ?? []),
    initialMemory: linkedAgent ? "" : autonomousInitialMemoryFromChat(pane.messages),
    testCommand: linkedAgent?.testCommand?.trim() || "",
    testTimeoutSeconds: linkedAgent?.testTimeoutSeconds ?? 5 * 60,
    activate: false,
    busy: false,
  };
  statusText = linkedAgent
    ? `Modifier ${linkedAgent.name || "l'agent autonome"} depuis ce chat`
    : "Configurer l'agent autonome de ce chat";
  void loadChatModelCatalog(account.id).then(() => {
    if (
      autonomousChatEditor?.paneKey === pane.key
      && autonomousChatEditor.accountId === account.id
    ) {
      render();
    }
  });
  render();
};

const closeAutonomousChatEditor = (): void => {
  if (!autonomousChatEditor || autonomousChatEditor.busy) return;
  const returnFocus = takeDialogTrigger("autonomous-chat");
  autonomousChatEditor = null;
  render();
  restoreDialogTrigger(returnFocus);
};

const autonomousChatIntervalOptions = (selected: number): string => {
  const known = AUTONOMOUS_INTERVAL_OPTIONS.some((option) => option.value === selected);
  return [
    ...AUTONOMOUS_INTERVAL_OPTIONS.map(
      (option) => `<option value="${option.value}" ${option.value === selected ? "selected" : ""}>${escapeHtml(option.label)}</option>`,
    ),
    ...(!known
      ? [`<option value="${selected}" selected>Toutes les ${escapeHtml(formatAutonomousInterval(selected))}</option>`]
      : []),
  ].join("");
};

const renderAutonomousChatEditor = (): string => {
  const state = autonomousChatEditor;
  if (!state) return "";
  const pane = expertChatPanes.find((candidate) => candidate.key === state.paneKey);
  if (!pane) return "";
  const agent = state.agentId
    ? autonomousAgents.find((candidate) => candidate.id === state.agentId) ?? null
    : null;
  const account = accountById(state.accountId);
  const provider = accountProvider(account);
  const catalog = account ? chatModelCatalogs.get(account.id) : undefined;
  const modelSuggestions = (provider === "claude"
    ? CLAUDE_MODEL_SUGGESTIONS
    : catalog?.map((model) => model.id) ?? CODEX_MODEL_SUGGESTIONS)
    .map((model) => `<option value="${escapeAttr(model)}"></option>`)
    .join("");
  const effortOptions = provider === "codex"
    ? chatReasoningEffortOptions(account, state.model)
    : [];
  const editing = !!agent;
  const running = !!agent && autonomousAgentIsRunning(agent);
  const supportsConnectors = provider === "codex";
  const connectors = AUTONOMOUS_CONNECTORS.map((connector) => {
    const selected = state.connectors.includes(connector.id);
    return `<label class="autonomous-chat-connector ${selected ? "is-selected" : ""}">
      <input type="checkbox" data-autonomous-chat-connector="${escapeAttr(connector.id)}" ${selected ? "checked" : ""} ${supportsConnectors && !state.busy ? "" : "disabled"} />
      <span><i data-lucide="${connector.icon}"></i></span>
      <span><strong>${escapeHtml(connector.label)}</strong><small>${escapeHtml(connector.description)}</small></span>
    </label>`;
  }).join("");
  const canReactivate = !!agent && agent.status !== "active";

  return `
    <div class="modal-backdrop" id="autonomousChatBackdrop">
      <section class="modal orchestration-convert-modal autonomous-chat-modal" role="dialog" aria-modal="true" aria-labelledby="autonomousChatTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="autonomousChatTitle">${editing ? "Modifier l'agent autonome" : "Autonomiser ce chat"}</h2>
            <p>${editing
              ? `<strong>${escapeHtml(agent?.name || "Agent autonome")}</strong> reste lié à cette conversation pour être modifié sans changer de vue.`
              : "Le chat reste une conversation normale ; l'agent reçoit un contexte initial séparé et travaille ensuite en continu."}</p>
          </div>
          <button type="button" class="icon-button" id="closeAutonomousChat" title="Fermer" aria-label="Fermer" ${state.busy ? "disabled" : ""}>
            <i data-lucide="x"></i>
          </button>
        </header>
        <form id="autonomousChatForm">
          <div class="modal-body">
            <section class="modal-section autonomous-chat-summary">
              <div class="orchestration-convert-agent autonomous-chat-agent-summary">
                <span><i data-lucide="bot"></i></span>
                <div><small>${editing ? "Agent lié à ce chat" : "Agent utilisé"}</small><strong>${escapeHtml(account?.label || "Compte indisponible")}</strong><p>${escapeHtml(state.model || "Modèle à choisir")} · ${editing ? escapeHtml(autonomousStatusLabel(agent!.status)) : "démarrage immédiat"}</p></div>
              </div>
              ${running ? `<aside class="autonomous-chat-running"><i data-lucide="circle-alert"></i><span><strong>Un cycle est en cours</strong><small>Mets l'agent en pause avant d'enregistrer afin que sa configuration ne change pas en plein travail.</small></span><button type="button" class="tool-button" id="autonomousChatPause" ${state.busy ? "disabled" : ""}><i data-lucide="pause"></i><span>Mettre en pause</span></button></aside>` : ""}
              <div class="autonomous-chat-identity-grid">
                <label><span>Nom <small>optionnel</small></span><input id="autonomousChatName" maxlength="120" value="${escapeAttr(state.name)}" placeholder="Ex. Veille qualité" ${state.busy ? "disabled" : ""} /></label>
                <label><span>Rôle <small>optionnel</small></span><input id="autonomousChatRole" maxlength="4000" value="${escapeAttr(state.role)}" placeholder="Ex. Ingénieur qualité prudent et méthodique" ${state.busy ? "disabled" : ""} /></label>
              </div>
              <div class="autonomous-chat-model-grid">
                <label><span>Compte d'exécution</span><select id="autonomousChatAccount" required ${settings?.accounts.length && !state.busy ? "" : "disabled"}>${orchestrationAccountOptions(state.accountId)}</select></label>
                <label><span>Modèle</span><input id="autonomousChatModel" list="autonomousChatModels" maxlength="160" required value="${escapeAttr(state.model)}" placeholder="${provider === "claude" ? "sonnet" : DEFAULT_CODEX_MODEL}" ${state.busy ? "disabled" : ""} /><datalist id="autonomousChatModels">${modelSuggestions}</datalist></label>
                ${provider === "codex"
                  ? `<label><span>Effort de raisonnement</span><select id="autonomousChatReasoningEffort" ${state.busy ? "disabled" : ""}>${effortOptions.map((option) => `<option value="${escapeAttr(option.value)}" ${option.value === state.reasoningEffort ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`
                  : `<label><span>Effort de raisonnement</span><input value="Géré par Claude Code" disabled /></label>`}
              </div>
              <label><span>Objectif autonome</span><textarea id="autonomousChatObjective" maxlength="32768" required placeholder="Décris le résultat durable à poursuivre…" ${state.busy ? "disabled" : ""}>${escapeHtml(state.objective)}</textarea></label>
              <div class="autonomous-chat-runtime-grid">
                <label><span>Environnement</span><input id="autonomousChatProject" value="${escapeAttr(state.projectDir)}" spellcheck="false" placeholder="Dossier projet" ${state.busy ? "disabled" : ""} /></label>
                <label><span>Fréquence</span><select id="autonomousChatInterval" ${state.busy ? "disabled" : ""}>${autonomousChatIntervalOptions(state.intervalSeconds)}</select></label>
                <label><span>Mode</span><select id="autonomousChatMode" ${state.busy ? "disabled" : ""}><option value="build" ${state.mode === "build" ? "selected" : ""}>Construire</option><option value="plan" ${state.mode === "plan" ? "selected" : ""}>Planifier</option><option value="ask" ${state.mode === "ask" ? "selected" : ""}>Question</option></select></label>
                <label><span>Timeout des tests</span><span class="orchestration-timeout"><input id="autonomousChatTestTimeout" type="number" min="5" max="1800" value="${state.testTimeoutSeconds}" ${state.busy ? "disabled" : ""} /><small>secondes</small></span></label>
              </div>
              <label><span>Commande de validation <small>optionnelle</small></span><input id="autonomousChatTestCommand" maxlength="8000" value="${escapeAttr(state.testCommand)}" placeholder="npm test && npm run build" spellcheck="false" ${state.busy ? "disabled" : ""} /></label>
              ${editing ? "" : `<label><span>Contexte initial importé <small>modifiable</small></span><textarea id="autonomousChatInitialMemory" maxlength="2000" placeholder="Les décisions utiles du chat seront reprises ici." ${state.busy ? "disabled" : ""}>${escapeHtml(state.initialMemory)}</textarea></label>`}
              <section class="autonomous-chat-connectors ${supportsConnectors ? "" : "is-disabled"}">
                <header><span><i data-lucide="unplug"></i></span><div><strong>Services autorisés</strong><small>Lecture autonome ; toute écriture externe reste soumise à validation.</small></div></header>
                <div>${connectors}</div>
                ${supportsConnectors ? "" : "<p>Les connecteurs nécessitent le compte Codex du chat.</p>"}
              </section>
              <label class="autonomous-chat-toggle">
                <input id="autonomousChatReview" type="checkbox" ${state.requireUserReview ? "checked" : ""} ${state.busy ? "disabled" : ""} />
                <span><strong>Demander ma validation avant d'appliquer des changements</strong><small>L'agent prépare d'abord son plan et attend ton accord dans le moniteur.</small></span>
              </label>
              ${canReactivate ? `<label class="autonomous-chat-toggle">
                <input id="autonomousChatActivate" type="checkbox" ${state.activate ? "checked" : ""} ${state.busy ? "disabled" : ""} />
                <span><strong>Relancer immédiatement après l'enregistrement</strong><small>${agent?.pendingReview ? "Traite la validation en attente ou remplace l'objectif avant la relance." : "Le prochain cycle utilisera la nouvelle configuration."}</small></span>
              </label>` : ""}
              <aside class="orchestration-convert-note autonomous-chat-isolation-note"><i data-lucide="shield-check"></i><span><strong>Conversation préservée</strong><small>Le moteur autonome n'efface ni ne verrouille ce chat. Ses cycles utilisent leur propre contexte pour éviter toute exécution concurrente.</small></span></aside>
            </section>
          </div>
          <footer class="modal-actions autonomous-chat-actions">
            <span>${editing ? `<button type="button" class="tool-button" id="autonomousChatMonitor" ${state.busy ? "disabled" : ""}><i data-lucide="panel-right-open"></i><span>Suivre l'agent</span></button>` : ""}</span>
            <div><button type="button" class="tool-button" id="cancelAutonomousChat" ${state.busy ? "disabled" : ""}>Annuler</button><button type="submit" class="tool-button primary" ${account && !running && !state.busy ? "" : "disabled"}><i data-lucide="${state.busy ? "loader-circle" : editing ? "check" : "play"}"></i><span>${state.busy ? "Enregistrement…" : editing ? "Enregistrer" : "Créer et démarrer"}</span></button></div>
          </footer>
        </form>
      </section>
    </div>`;
};

const bindAutonomousChatEditorUi = (): void => {
  const state = autonomousChatEditor;
  if (!state) return;
  const pane = expertChatPanes.find((candidate) => candidate.key === state.paneKey);
  const agent = state.agentId
    ? autonomousAgents.find((candidate) => candidate.id === state.agentId) ?? null
    : null;
  const form = document.querySelector<HTMLFormElement>("#autonomousChatForm");
  const accountSelect = document.querySelector<HTMLSelectElement>("#autonomousChatAccount");
  const modelInput = document.querySelector<HTMLInputElement>("#autonomousChatModel");
  const reasoningEffort = document.querySelector<HTMLSelectElement>("#autonomousChatReasoningEffort");
  const name = document.querySelector<HTMLInputElement>("#autonomousChatName");
  const role = document.querySelector<HTMLInputElement>("#autonomousChatRole");
  const objective = document.querySelector<HTMLTextAreaElement>("#autonomousChatObjective");
  const project = document.querySelector<HTMLInputElement>("#autonomousChatProject");
  const interval = document.querySelector<HTMLSelectElement>("#autonomousChatInterval");
  const mode = document.querySelector<HTMLSelectElement>("#autonomousChatMode");
  const testCommand = document.querySelector<HTMLInputElement>("#autonomousChatTestCommand");
  const testTimeout = document.querySelector<HTMLInputElement>("#autonomousChatTestTimeout");
  const initialMemory = document.querySelector<HTMLTextAreaElement>("#autonomousChatInitialMemory");
  const review = document.querySelector<HTMLInputElement>("#autonomousChatReview");
  const activate = document.querySelector<HTMLInputElement>("#autonomousChatActivate");

  accountSelect?.addEventListener("change", () => {
    const account = accountById(accountSelect.value);
    if (!account) return;
    state.accountId = account.id;
    state.model = accountModel(account);
    state.reasoningEffort = accountProvider(account) === "codex"
      ? reasoningEffortForChatModel(account, state.model, accountReasoningEffort(account))
      : "";
    if (accountProvider(account) !== "codex") state.connectors = [];
    void loadChatModelCatalog(account.id).then(() => {
      if (autonomousChatEditor === state && state.accountId === account.id) render();
    });
    render();
  });
  modelInput?.addEventListener("input", () => {
    state.model = modelInput.value;
    modelInput.setCustomValidity("");
  });
  modelInput?.addEventListener("change", () => {
    const account = accountById(state.accountId);
    if (accountProvider(account) !== "codex" || !state.model.trim()) return;
    state.reasoningEffort = reasoningEffortForChatModel(
      account,
      state.model.trim(),
      state.reasoningEffort,
    );
    render();
  });
  reasoningEffort?.addEventListener("change", () => {
    state.reasoningEffort = reasoningEffort.value;
  });
  name?.addEventListener("input", () => { state.name = name.value; });
  role?.addEventListener("input", () => { state.role = role.value; });
  objective?.addEventListener("input", () => {
    state.objective = objective.value;
    objective.setCustomValidity("");
  });
  project?.addEventListener("input", () => {
    state.projectDir = project.value;
    project.setCustomValidity("");
  });
  interval?.addEventListener("change", () => {
    state.intervalSeconds = Number(interval.value);
  });
  mode?.addEventListener("change", () => {
    if (mode.value === "build" || mode.value === "plan" || mode.value === "ask") {
      state.mode = mode.value;
    }
  });
  testCommand?.addEventListener("input", () => { state.testCommand = testCommand.value; });
  testTimeout?.addEventListener("input", () => {
    state.testTimeoutSeconds = Number(testTimeout.value);
    testTimeout.setCustomValidity("");
  });
  initialMemory?.addEventListener("input", () => { state.initialMemory = initialMemory.value; });
  review?.addEventListener("change", () => { state.requireUserReview = review.checked; });
  activate?.addEventListener("change", () => { state.activate = activate.checked; });
  document.querySelectorAll<HTMLInputElement>("[data-autonomous-chat-connector]").forEach((input) => {
    input.addEventListener("change", () => {
      const connector = input.dataset.autonomousChatConnector;
      if (!isAutonomousConnectorId(connector)) return;
      state.connectors = toggleAutonomousConnector(state.connectors, connector);
      input.closest(".autonomous-chat-connector")?.classList.toggle("is-selected", input.checked);
    });
  });

  document.querySelector<HTMLButtonElement>("#closeAutonomousChat")?.addEventListener("click", closeAutonomousChatEditor);
  document.querySelector<HTMLButtonElement>("#cancelAutonomousChat")?.addEventListener("click", closeAutonomousChatEditor);
  document.querySelector<HTMLDivElement>("#autonomousChatBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeAutonomousChatEditor();
  });
  document.querySelector<HTMLButtonElement>("#autonomousChatMonitor")?.addEventListener("click", () => {
    if (!agent) return;
    forgetDialogTrigger("autonomous-chat");
    autonomousChatEditor = null;
    openAutonomousMonitor(agent.id);
  });
  document.querySelector<HTMLButtonElement>("#autonomousChatPause")?.addEventListener("click", async () => {
    if (!agent || state.busy) return;
    state.busy = true;
    statusText = "Mise en pause avant modification";
    render();
    try {
      const updated = await invoke<AutonomousAgentSnapshot>("control_autonomous_agent", {
        id: agent.id,
        action: "pause",
      });
      updateAutonomousAgentLocally(updated);
      state.busy = false;
      statusText = "Agent en pause · configuration modifiable";
      render();
    } catch (error) {
      state.busy = false;
      statusText = String(error);
      render();
    }
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!pane || state.busy) return;
    const currentAgent = state.agentId
      ? autonomousAgents.find((candidate) => candidate.id === state.agentId) ?? null
      : null;
    if (currentAgent && autonomousAgentIsRunning(currentAgent)) {
      statusText = "Mets l'agent en pause avant d'enregistrer";
      render();
      return;
    }
    const account = accountById(state.accountId);
    const selectedModel = (modelInput?.value ?? state.model).trim();
    const timeout = Number(testTimeout?.value ?? state.testTimeoutSeconds);
    const intervalSeconds = Number(interval?.value ?? state.intervalSeconds);
    if (!objective?.value.trim()) {
      objective?.setCustomValidity("Décris l'objectif autonome à poursuivre.");
      objective?.reportValidity();
      return;
    }
    if (!selectedModel) {
      modelInput?.setCustomValidity("Choisis le modèle utilisé par l'agent.");
      modelInput?.reportValidity();
      return;
    }
    if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 604800) {
      interval?.setCustomValidity("Choisis une fréquence valide.");
      interval?.reportValidity();
      return;
    }
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 1800) {
      testTimeout?.setCustomValidity("Choisis un timeout entre 5 et 1800 secondes.");
      testTimeout?.reportValidity();
      return;
    }
    if (testCommand?.value.trim() && !project?.value.trim()) {
      project?.setCustomValidity("Un environnement est requis pour exécuter les tests.");
      project?.reportValidity();
      return;
    }
    if (!account) {
      statusText = "Le compte de ce chat n'est plus disponible";
      closeAutonomousChatEditor();
      return;
    }

    state.name = name?.value.trim() ?? "";
    state.role = role?.value.trim() ?? "";
    state.objective = objective.value.trim();
    state.projectDir = project?.value.trim() ?? "";
    state.model = selectedModel;
    state.reasoningEffort = accountProvider(account) === "codex"
      ? reasoningEffortForChatModel(
          account,
          selectedModel,
          reasoningEffort?.value ?? state.reasoningEffort,
        )
      : "";
    state.intervalSeconds = intervalSeconds;
    state.testCommand = testCommand?.value.trim() ?? "";
    state.testTimeoutSeconds = timeout;
    state.initialMemory = initialMemory?.value.trim() ?? state.initialMemory.trim();
    state.requireUserReview = review?.checked ?? state.requireUserReview;
    state.activate = activate?.checked ?? false;
    state.busy = true;
    statusText = currentAgent ? "Mise à jour de l'agent autonome" : "Création de l'agent autonome";
    render();

    try {
      const saved = currentAgent
        ? await invoke<AutonomousAgentSnapshot>("update_autonomous_agent", {
            id: currentAgent.id,
            request: {
              name: state.name || null,
              objective: state.objective,
              role: state.role || null,
              accountId: account.id,
              projectDir: state.projectDir || null,
              mode: state.mode,
              requireUserReview: state.requireUserReview,
              model: state.model,
              reasoningEffort: accountProvider(account) === "codex"
                ? state.reasoningEffort
                : null,
              connectors: accountProvider(account) === "codex" ? state.connectors : [],
              intervalSeconds: state.intervalSeconds,
              testCommand: state.testCommand || null,
              testTimeoutSeconds: state.testTimeoutSeconds,
              activate: state.activate,
            },
          })
        : await invoke<AutonomousAgentSnapshot>("create_autonomous_agent", {
            request: {
              name: state.name || null,
              objective: state.objective,
              role: state.role || null,
              sourceChatKey: pane.key,
              accountId: account.id,
              projectDir: state.projectDir || null,
              mode: state.mode,
              requireUserReview: state.requireUserReview,
              model: state.model,
              reasoningEffort: accountProvider(account) === "codex"
                ? state.reasoningEffort
                : null,
              connectors: accountProvider(account) === "codex" ? state.connectors : [],
              intervalSeconds: state.intervalSeconds,
              initialMemory: state.initialMemory || null,
              testCommand: state.testCommand || null,
              testTimeoutSeconds: state.testTimeoutSeconds,
            },
          });
      updateAutonomousAgentLocally(saved);
      pane.autonomousAgentId = saved.id;
      if (!currentAgent) pane.draft = "";
      persistExpertChats();
      forgetDialogTrigger("autonomous-chat");
      autonomousChatEditor = null;
      statusText = currentAgent
        ? `Agent « ${saved.name} » mis à jour depuis le chat`
        : `Agent « ${saved.name} » créé et lié à ce chat`;
      render();
      startAutonomousAgentsPoll();
      void refreshAutonomousAgents();
    } catch (error) {
      state.busy = false;
      statusText = String(error);
      render();
    }
  });
};

const openOrchestrationConversion = (pane: ExpertChatPane): void => {
  if (pane.orchestrationRole) {
    setActiveView("orchestration");
    return;
  }
  if (
    chatTurnIsBusy(pane.turn?.status)
    || (pane.discussion ? discussionHasRunningTurn(pane.discussion) : false)
  ) {
    statusText = "Attends la fin du message en cours avant d'orchestrer ce chat";
    refreshExpertChatPane(pane);
    return;
  }
  if (pane.queueDrainInFlight || pane.queuedSubmissions.length > 0) {
    statusText = "Envoie ou annule les messages en attente avant d'orchestrer ce chat";
    refreshExpertChatPane(pane);
    return;
  }
  const sessionId = expertChatResumeSessionId(pane);
  const account = expertChatSelectedAccount(pane);
  if (!sessionId || !account) {
    statusText = sessionId
      ? "Le compte de ce chat est introuvable"
      : "Envoyez un premier message avant de transformer ce chat en orchestration";
    refreshExpertChatPane(pane);
    return;
  }
  const lastUserMessage = [...pane.messages]
    .reverse()
    .find((message) => message.role === "user")?.text.trim();
  rememberDialogTrigger("orchestration-convert", null);
  orchestrationConversion = {
    paneKey: pane.key,
    name: pane.discussion?.title?.trim() || "",
    objective: pane.draft.trim() || lastUserMessage || pane.discussion?.preview?.trim() || "",
    projectDir:
      discussionFolderPath(pane.discussion)
      ?? userEnvironmentPath(pane.pendingWorkspace)
      ?? userEnvironmentPath(currentWorkspace())
      ?? account.projectDir
      ?? "",
    testCommand: orchestrationTestCommandDraft,
    workerCount: Math.max(1, Math.min(12, orchestrationWorkerCount)),
    testTimeoutSeconds: Math.max(5, Math.min(1800, orchestrationTestTimeoutSeconds)),
    busy: false,
  };
  statusText = "Configurer l'équipe orchestrée";
  render();
};

const closeOrchestrationConversion = (): void => {
  if (!orchestrationConversion || orchestrationConversion.busy) return;
  const returnFocus = takeDialogTrigger("orchestration-convert");
  orchestrationConversion = null;
  render();
  restoreDialogTrigger(returnFocus);
};

const renderOrchestrationConversionModal = () => {
  const state = orchestrationConversion;
  if (!state) return "";
  const pane = expertChatPanes.find((candidate) => candidate.key === state.paneKey);
  if (!pane) return "";
  const account = expertChatSelectedAccount(pane);
  const sessionId = expertChatResumeSessionId(pane);
  const chatTitle = pane.discussion?.title?.trim() || "Conversation actuelle";

  return `
    <div class="modal-backdrop" id="orchestrationConvertBackdrop">
      <section class="modal orchestration-convert-modal" role="dialog" aria-modal="true" aria-labelledby="orchestrationConvertTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="orchestrationConvertTitle">Transformer en chat orchestré</h2>
            <p><strong>${escapeHtml(chatTitle)}</strong> devient l’orchestrateur et conserve tout son contexte.</p>
          </div>
          <button type="button" class="icon-button" id="closeOrchestrationConvert" title="Fermer" aria-label="Fermer" ${state.busy ? "disabled" : ""}>
            <i data-lucide="x"></i>
          </button>
        </header>
        <form id="orchestrationConvertForm">
          <div class="modal-body">
            <section class="modal-section orchestration-convert-summary">
              <div class="orchestration-convert-agent">
                <span><i data-lucide="brain-circuit"></i></span>
                <div><small>Orchestrateur actuel</small><strong>${escapeHtml(account?.label || "Agent courant")}</strong><p>${escapeHtml(account ? accountModel(account) : "Modèle courant")} · session ${escapeHtml(sessionId?.slice(0, 8) || "en attente")}</p></div>
              </div>
              <label><span>Nom <small>optionnel</small></span><input id="orchestrationConvertName" maxlength="120" value="${escapeAttr(state.name)}" placeholder="Ex. Refonte des permissions" ${state.busy ? "disabled" : ""} /></label>
              <label><span>Objectif de l’équipe</span><textarea id="orchestrationConvertObjective" maxlength="65536" required placeholder="Décris le résultat complet que l’orchestrateur doit répartir…" ${state.busy ? "disabled" : ""}>${escapeHtml(state.objective)}</textarea></label>
              <div class="orchestration-convert-grid">
                <label><span>Dépôt Git</span><input id="orchestrationConvertProject" required value="${escapeAttr(state.projectDir)}" spellcheck="false" ${state.busy ? "disabled" : ""} /></label>
                <label><span>Commande de validation</span><input id="orchestrationConvertTestCommand" required maxlength="8000" value="${escapeAttr(state.testCommand)}" placeholder="npm test && npm run build" spellcheck="false" ${state.busy ? "disabled" : ""} /></label>
                <label><span>Workers <small>hors orchestrateur</small></span><span class="orchestration-worker-count"><input id="orchestrationConvertWorkerCount" type="number" min="1" max="12" step="1" required value="${state.workerCount}" ${state.busy ? "disabled" : ""} /><small id="orchestrationConvertTeamTotal">${state.workerCount + 1} agents au total</small></span></label>
                <label><span>Timeout des tests</span><span class="orchestration-timeout"><input id="orchestrationConvertTimeout" type="number" min="5" max="1800" required value="${state.testTimeoutSeconds}" ${state.busy ? "disabled" : ""} /><small>secondes</small></span></label>
              </div>
              <aside class="orchestration-convert-note"><i data-lucide="users"></i><span><strong>Les fenêtres workers s’ouvriront ici</strong><small>Le chat actuel sera piloté par le moteur d’orchestration pendant le plan, les revues et la validation. Son compositeur sera verrouillé pour éviter deux commandes concurrentes.</small></span></aside>
            </section>
          </div>
          <footer class="modal-actions">
            <button type="button" class="tool-button" id="cancelOrchestrationConvert" ${state.busy ? "disabled" : ""}>Annuler</button>
            <button type="submit" class="tool-button primary" ${account && sessionId && !state.busy ? "" : "disabled"}>
              <i data-lucide="${state.busy ? "loader-circle" : "users"}"></i>
              <span>${state.busy ? "Création de l’équipe…" : "Créer les workers"}</span>
            </button>
          </footer>
        </form>
      </section>
    </div>
  `;
};

const bindOrchestrationConversionUi = (): void => {
  const state = orchestrationConversion;
  if (!state) return;
  const pane = expertChatPanes.find((candidate) => candidate.key === state.paneKey);
  const form = document.querySelector<HTMLFormElement>("#orchestrationConvertForm");
  const name = document.querySelector<HTMLInputElement>("#orchestrationConvertName");
  const objective = document.querySelector<HTMLTextAreaElement>("#orchestrationConvertObjective");
  const project = document.querySelector<HTMLInputElement>("#orchestrationConvertProject");
  const testCommand = document.querySelector<HTMLInputElement>("#orchestrationConvertTestCommand");
  const workerCountInput = document.querySelector<HTMLInputElement>("#orchestrationConvertWorkerCount");
  const timeoutInput = document.querySelector<HTMLInputElement>("#orchestrationConvertTimeout");

  name?.addEventListener("input", () => {
    state.name = name.value;
  });
  objective?.addEventListener("input", () => {
    state.objective = objective.value;
    objective.setCustomValidity("");
  });
  project?.addEventListener("input", () => {
    state.projectDir = project.value;
    project.setCustomValidity("");
  });
  testCommand?.addEventListener("input", () => {
    state.testCommand = testCommand.value;
    testCommand.setCustomValidity("");
  });
  workerCountInput?.addEventListener("input", () => {
    const value = Number(workerCountInput.value);
    if (Number.isInteger(value)) state.workerCount = value;
    workerCountInput.setCustomValidity("");
    const total = document.querySelector<HTMLElement>("#orchestrationConvertTeamTotal");
    if (total && Number.isInteger(value) && value >= 1 && value <= 12) {
      total.textContent = `${value + 1} agents au total`;
    }
  });
  timeoutInput?.addEventListener("input", () => {
    const value = Number(timeoutInput.value);
    if (Number.isFinite(value)) state.testTimeoutSeconds = value;
    timeoutInput.setCustomValidity("");
  });

  document.querySelector<HTMLButtonElement>("#closeOrchestrationConvert")?.addEventListener("click", closeOrchestrationConversion);
  document.querySelector<HTMLButtonElement>("#cancelOrchestrationConvert")?.addEventListener("click", closeOrchestrationConversion);
  document.querySelector<HTMLDivElement>("#orchestrationConvertBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeOrchestrationConversion();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) return;
    if (!pane) {
      orchestrationConversion = null;
      statusText = "Le chat à orchestrer n'existe plus";
      render();
      return;
    }
    if (
      chatTurnIsBusy(pane.turn?.status)
      || (pane.discussion ? discussionHasRunningTurn(pane.discussion) : false)
    ) {
      statusText = "Le chat a repris du travail ; attends sa fin avant de l'orchestrer";
      closeOrchestrationConversion();
      return;
    }
    if (pane.queueDrainInFlight || pane.queuedSubmissions.length > 0) {
      statusText = "Des messages sont encore en attente dans ce chat";
      closeOrchestrationConversion();
      return;
    }
    const account = expertChatSelectedAccount(pane);
    const sessionId = expertChatResumeSessionId(pane);
    const workerCount = Number(workerCountInput?.value);
    const timeout = Number(timeoutInput?.value);
    if (!objective?.value.trim()) {
      objective?.setCustomValidity("Décris le résultat que l'équipe doit construire.");
      objective?.reportValidity();
      return;
    }
    if (!project?.value.trim()) {
      project?.setCustomValidity("Choisis le dépôt Git à orchestrer.");
      project?.reportValidity();
      return;
    }
    if (!testCommand?.value.trim()) {
      testCommand?.setCustomValidity("Indique la commande qui valide le rendu.");
      testCommand?.reportValidity();
      return;
    }
    if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 12) {
      workerCountInput?.setCustomValidity("Choisis entre 1 et 12 workers.");
      workerCountInput?.reportValidity();
      return;
    }
    if (!Number.isInteger(timeout) || timeout < 5 || timeout > 1800) {
      timeoutInput?.setCustomValidity("Choisis un timeout entre 5 et 1800 secondes.");
      timeoutInput?.reportValidity();
      return;
    }
    if (!account || !sessionId) {
      statusText = "Le compte ou la session de ce chat n'est plus disponible";
      closeOrchestrationConversion();
      return;
    }

    state.name = name?.value.trim() ?? "";
    state.objective = objective.value.trim();
    state.projectDir = project.value.trim();
    state.testCommand = testCommand.value.trim();
    state.workerCount = workerCount;
    state.testTimeoutSeconds = timeout;
    state.busy = true;
    statusText = "Création de l'équipe orchestrée";
    render();
    try {
      const created = await invoke<OrchestrationSnapshot>("create_orchestration", {
        request: {
          name: state.name || null,
          objective: state.objective,
          workerCount: state.workerCount,
          orchestratorSessionId: sessionId,
          orchestratorAccountId: account.id,
          workerAccountIds: Array.from({ length: state.workerCount }, () => account.id),
          accountId: account.id,
          projectDir: state.projectDir,
          model: accountModel(account),
          reasoningEffort: accountProvider(account) === "codex" ? accountReasoningEffort(account) : null,
          testCommand: state.testCommand,
          testTimeoutSeconds: state.testTimeoutSeconds,
        },
      });
      updateOrchestrationLocally(created);
      pane.orchestrationId = created.id;
      pane.orchestrationRole = "orchestrator";
      pane.orchestrationTaskId = null;
      pane.pendingWorkspace = created.projectDir;
      pane.draft = "";
      pane.queuedSubmissions = [];
      orchestrationWorkerCount = created.workerCount;
      forgetDialogTrigger("orchestration-convert");
      orchestrationConversion = null;
      syncOrchestrationChatPanes();
      persistExpertChats();
      statusText = "Chat transformé en orchestrateur ; workers en préparation";
      render();
      startAllExpertChatWork();
      startOrchestrationsPoll();
      void refreshOrchestrations();
    } catch (error) {
      state.busy = false;
      statusText = String(error);
      render();
    }
  });
};

const renderNewTerminalModal = () => {
  if (!settings || !newTerminalModalOpen) return "";

  const account = newTerminalAccount();
  const selectedAgent = newTerminalAgent();
  const accountOptions = settings.accounts
    .map(
      (item) =>
        `<option value="${escapeAttr(item.id)}" ${item.id === account?.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
    )
    .join("");
  const agentOptions = settings.agents
    .map(
      (item) =>
        `<option value="${escapeAttr(item.id)}" ${item.id === selectedAgent?.id ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
    )
    .join("");
  const proxyOptions = [
    `<option value="">Aucun proxy</option>`,
    ...settings.proxies.map(
      (item) =>
        `<option value="${escapeAttr(item.id)}" ${item.id === account?.proxyId ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
    ),
  ].join("");
  const selectedEnvironment = userEnvironmentPath(newTerminalWorkspacePath);
  const environmentOptions = terminalEnvironmentGroups()
    .map((group) => {
      const selected =
        !!selectedEnvironment &&
        workspaceIdForPath(group.path) === workspaceIdForPath(selectedEnvironment);
      return `<button
        type="button"
        class="new-terminal-environment-option ${selected ? "selected" : ""}"
        data-new-terminal-environment-path="${escapeAttr(group.path)}"
        aria-pressed="${selected}"
        title="${escapeAttr(group.path)}"
      >
        <i data-lucide="folder${selected ? "-open" : ""}"></i>
        <span><strong>${escapeHtml(group.label)}</strong><small>${escapeHtml(group.path)}</small></span>
        <b>${group.sessions.length}</b>
      </button>`;
    })
    .join("");

  return `
    <div class="modal-backdrop" id="newTerminalBackdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="newTerminalTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="newTerminalTitle">Nouvelle session terminal</h2>
            <p>L'environnement est obligatoire et reste verrouille pendant toute la session.</p>
          </div>
          <button class="icon-button" id="closeNewTerminalModal" title="Fermer" aria-label="Fermer">
            <i data-lucide="x"></i>
          </button>
        </header>

        <div class="modal-body">
          <section class="modal-section">
            <div class="new-terminal-environment-required ${selectedEnvironment ? "selected" : "missing"}">
              <span class="new-terminal-environment-required-icon"><i data-lucide="shield-check"></i></span>
              <span>
                <strong>1. Choisir l'environnement isole</strong>
                <small>${selectedEnvironment ? escapeHtml(selectedEnvironment) : "Aucun terminal ne peut demarrer sans environnement explicite"}</small>
              </span>
            </div>
            ${environmentOptions
              ? `<div class="new-terminal-environment-options" role="radiogroup" aria-label="Environnements recents">${environmentOptions}</div>`
              : ""}
            <label class="new-terminal-environment-field">
              <span>Environnement de ce terminal / session (obligatoire)</span>
              <div class="field-row">
                <input id="newTerminalWorkspace" value="${escapeAttr(selectedEnvironment ?? "")}" placeholder="${escapeAttr(isRemoteMode() ? "/chemin/vers/environnement" : "C:\\chemin\\vers\\environnement")}" spellcheck="false" required aria-required="true" aria-invalid="${!selectedEnvironment}" />
                <button id="pickNewTerminalWorkspace" type="button" class="icon-button" title="Choisir l'environnement">
                  <i data-lucide="folder-open"></i>
                </button>
              </div>
              <small class="new-terminal-environment-help">Le terminal utilisera directement ce dossier avec le home habituel du compte.</small>
            </label>
            <label>
              <span>2. Agent</span>
              <select id="newTerminalAgent" ${settings.agents.length > 0 ? "" : "disabled"}>
                ${agentOptions || `<option value="">Aucun agent</option>`}
              </select>
            </label>
            <label>
              <span>3. Compte</span>
              <select id="newTerminalAccount" aria-describedby="newTerminalAccountStatus" ${settings.accounts.length > 0 ? "" : "disabled"}>
                ${accountOptions || `<option value="">Aucun compte</option>`}
              </select>
              <span id="newTerminalAccountStatus" class="visually-hidden" role="status" aria-live="polite"></span>
            </label>
            <div class="account-create-box">
              <strong>Ajouter un nouveau compte agent</strong>
              <div class="account-create-grid">
                <label>
                  <span>Nom du compte</span>
                  <input id="newTerminalAccountLabel" value="${escapeAttr(newTerminalAccountLabel)}" placeholder="perso, pro, client" />
                </label>
                <label>
                  <span>Fournisseur</span>
                  <select id="newAccountProvider">
                    <option value="codex" ${newTerminalAccountProvider === "codex" ? "selected" : ""}>Codex (ChatGPT)</option>
                    <option value="claude" ${newTerminalAccountProvider === "claude" ? "selected" : ""}>Claude Code</option>
                  </select>
                </label>
                <label>
                  <span>Modele par defaut</span>
                  <input id="newAccountModel" list="codexModelSuggestions" value="${escapeAttr(newTerminalAccountModel)}" placeholder="${DEFAULT_CODEX_MODEL} / sonnet" />
                </label>
                <label title="Intensite de raisonnement : Codex uniquement (ignoree pour Claude)">
                  <span>Intensite (Codex)</span>
                  <select id="newAccountReasoningEffort">${reasoningEffortOptions(newTerminalAccountReasoningEffort)}</select>
                </label>
                <label class="modal-check" title="Sans approbations / sans sandbox (Codex : bypass ; Claude : skip permissions)">
                  <input id="newAccountBypass" type="checkbox" ${newTerminalAccountBypass ? "checked" : ""} />
                  <span>Mode bypass</span>
                </label>
              </div>
              <button class="tool-button" id="addAccountFromModal">
                <i data-lucide="plus"></i><span>Ajouter ce compte</span>
              </button>
            </div>
          </section>

          <section id="newTerminalAccountDetails" class="modal-section new-terminal-account-details">
            <label>
              <span>CODEX_HOME</span>
              <input id="newTerminalCodexHome" value="${escapeAttr(account?.codexHome ?? "")}" placeholder="%USERPROFILE%\\.codex-perso" ${account ? "" : "disabled"} />
            </label>
            <label>
              <span>${projectFieldLabel()}</span>
              <input id="newTerminalProjectDir" value="${escapeAttr(account?.projectDir ?? "")}" placeholder="${escapeAttr(projectFieldPlaceholder())}" ${account ? "" : "disabled"} />
            </label>
            <label>
              <span>Proxy</span>
              <select id="newTerminalProxy" ${account && settings.proxyControlsEnabled ? "" : "disabled"}>
                ${proxyOptions}
              </select>
            </label>
            <label>
              <span>Modele Codex par defaut</span>
              <input id="newTerminalModel" list="codexModelSuggestions" value="${escapeAttr(accountModel(account))}" ${account ? "" : "disabled"} />
            </label>
            <label>
              <span>Intensite par defaut</span>
              <select id="newTerminalReasoningEffort" ${account ? "" : "disabled"}>${reasoningEffortOptions(accountReasoningEffort(account))}</select>
            </label>
            <label class="modal-check" title="Sans approbations et sans sandbox Codex">
              <input id="newTerminalBypass" type="checkbox" ${accountBypassEnabled(account) ? "checked" : ""} ${account ? "" : "disabled"} />
              <span>Mode bypass pour ce compte</span>
            </label>
            <label class="modal-check">
              <input id="newTerminalAutoRun" type="checkbox" ${settings.autoRunCodex ? "checked" : ""} />
              <span>Lancer l'agent au demarrage${selectedAgent ? ` (${escapeHtml(selectedAgent.label)})` : ""}</span>
            </label>
          </section>
        </div>

        <footer class="modal-actions">
          <button class="tool-button" id="cancelNewTerminal">Annuler</button>
          ${selectedAgent?.loginCommand
            ? `<button class="tool-button" id="loginNewTerminal" ${account && selectedEnvironment ? "" : "disabled"}>
            <i data-lucide="badge-check"></i>
            <span>Login ${escapeHtml(selectedAgent.label)}</span>
          </button>`
            : ""}
          <button class="tool-button primary" id="confirmNewTerminal" ${account && selectedEnvironment ? "" : "disabled"}>
            <i data-lucide="square-terminal"></i>
            <span>Creer le terminal</span>
          </button>
        </footer>
      </section>
    </div>
  `;
};

const syncNewTerminalAccountUi = (account: AccountProfile) => {
  const home = document.querySelector<HTMLInputElement>("#newTerminalCodexHome");
  const project = document.querySelector<HTMLInputElement>("#newTerminalProjectDir");
  const proxy = document.querySelector<HTMLSelectElement>("#newTerminalProxy");
  const model = document.querySelector<HTMLInputElement>("#newTerminalModel");
  const effort = document.querySelector<HTMLSelectElement>("#newTerminalReasoningEffort");
  const bypass = document.querySelector<HTMLInputElement>("#newTerminalBypass");

  if (home) {
    home.value = account.codexHome;
    home.disabled = false;
  }
  if (project) {
    project.value = account.projectDir ?? "";
    project.disabled = false;
  }
  if (proxy) {
    proxy.value = account.proxyId ?? "";
    proxy.disabled = !settings?.proxyControlsEnabled;
  }
  if (model) {
    model.value = accountModel(account);
    model.disabled = false;
  }
  if (effort) {
    effort.innerHTML = reasoningEffortOptions(accountReasoningEffort(account));
    effort.disabled = false;
  }
  if (bypass) {
    bypass.checked = accountBypassEnabled(account);
    bypass.disabled = false;
  }

  const hasEnvironment = !!userEnvironmentPath(newTerminalWorkspacePath);
  const confirm = document.querySelector<HTMLButtonElement>("#confirmNewTerminal");
  const login = document.querySelector<HTMLButtonElement>("#loginNewTerminal");
  if (confirm) confirm.disabled = !hasEnvironment;
  if (login) login.disabled = !hasEnvironment;

  const status = document.querySelector<HTMLElement>("#newTerminalAccountStatus");
  if (status) status.textContent = `${account.label} sélectionné`;
  const details = document.querySelector<HTMLElement>("#newTerminalAccountDetails");
  if (details) {
    details.dataset.accountId = account.id;
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      details.animate(
        [
          { opacity: 0.72, transform: "translateY(3px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 170, easing: "ease-out" },
      );
    }
  }
  void loadChatModelCatalog(account.id);
};

const renderAgentsModal = () => {
  if (!settings || !agentsModalOpen) return "";

  const rows = settings.agents
    .map((item) => {
      const isIde = agentIsIde(item);
      return `
        <div class="agent-row">
          <div class="agent-row-head">
            <span class="agent-row-title">
              <i data-lucide="${isIde ? "app-window" : "bot"}"></i>
              ${escapeHtml(item.label || item.id)}
              ${item.builtin ? `<span class="agent-tag">integre</span>` : ""}
              ${isIde ? `<span class="agent-tag ide">IDE</span>` : ""}
            </span>
            <button class="icon-button danger" data-remove-agent="${escapeAttr(item.id)}" title="${item.builtin ? "Agent integre non supprimable" : "Supprimer l'agent"}" ${item.builtin ? "disabled" : ""}>
              <i data-lucide="trash-2"></i>
            </button>
          </div>
          <div class="agent-row-grid">
            <label>
              <span>Nom</span>
              <input data-agent-field="label" data-agent-id="${escapeAttr(item.id)}" value="${escapeAttr(item.label)}" ${item.builtin ? "disabled" : ""} />
            </label>
            <label>
              <span>Type</span>
              <select data-agent-field="kind" data-agent-id="${escapeAttr(item.id)}" ${item.builtin ? "disabled" : ""}>
                <option value="cli" ${isIde ? "" : "selected"}>CLI (terminal)</option>
                <option value="ide" ${isIde ? "selected" : ""}>IDE (editeur)</option>
              </select>
            </label>
            <label>
              <span>${isIde ? "Editeur" : "Commande"}</span>
              <input data-agent-field="command" data-agent-id="${escapeAttr(item.id)}" value="${escapeAttr(item.command)}" ${isIde ? `list="ideCommands"` : ""} placeholder="${isIde ? "code" : "codex"}" />
            </label>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="modal-backdrop" id="agentsBackdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-labelledby="agentsModalTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="agentsModalTitle">Agents</h2>
            <p>Agents lancables dans un terminal (CLI, ex. Codex) ou dans un editeur (IDE, ex. Kombai).</p>
          </div>
          <button class="icon-button" id="closeAgentsModal" title="Fermer" aria-label="Fermer">
            <i data-lucide="x"></i>
          </button>
        </header>

        <datalist id="ideCommands">
          ${KNOWN_IDE_COMMANDS.map((cmd) => `<option value="${escapeAttr(cmd)}"></option>`).join("")}
        </datalist>

        <div class="modal-body">
          <section class="modal-section agent-manager-list">
            ${rows || `<div class="empty">Aucun agent</div>`}
          </section>
          <button class="tool-button" id="addAgent">
            <i data-lucide="plus"></i>
            <span>Ajouter un agent</span>
          </button>
          <p class="agent-hint">Kombai est une extension d'IDE : un agent <strong>IDE</strong> ouvre l'editeur choisi (code, cursor, windsurf, trae, antigravity, kiro) sur l'environnement projet, ou tu utilises le panneau Kombai.</p>
        </div>

        <footer class="modal-actions">
          <button class="tool-button" id="cancelAgentsModal">Annuler</button>
          <button class="tool-button primary" id="saveAgentsModal">
            <i data-lucide="save"></i>
            <span>Enregistrer</span>
          </button>
        </footer>
      </section>
    </div>
  `;
};

const renderWorkspaceModal = () => {
  if (!workspaceModalOpen) return "";

  const data = workspaceBrowse;
  const entries = data?.entries ?? [];
  const selectableBrowsePath = userEnvironmentPath(data?.path);
  const breadcrumbs = workspacePathBreadcrumbs(data?.root, data?.path);
  const breadcrumbTrail = breadcrumbs
    .map(
      (breadcrumb, index) => `
        <span class="ws-breadcrumb-part">
          ${index ? `<i data-lucide="chevron-right"></i>` : ""}
          <button type="button" data-ws-dir="${escapeAttr(breadcrumb.path)}" ${index === breadcrumbs.length - 1 ? 'aria-current="location"' : ""} title="${escapeAttr(breadcrumb.path)}">${escapeHtml(breadcrumb.label)}</button>
        </span>`,
    )
    .join("");
  const browseId = data?.path ? workspaceIdForPath(data.path) : null;
  const quickAccess = knownWorkspaces()
    .filter((workspace) => workspace.id !== browseId)
    .slice(0, 8)
    .map(
      (workspace) => `
        <button type="button" class="ws-quick-entry" data-ws-dir="${escapeAttr(workspace.path)}" title="${escapeAttr(workspace.path)}">
          <i data-lucide="folder"></i>
          <span><strong>${escapeHtml(workspace.label)}</strong><small>${escapeHtml(workspace.path)}</small></span>
        </button>`,
    )
    .join("");
  const list = entries
    .map(
      (entry) => `
        <button type="button" class="ws-entry ws-folder-entry" data-ws-dir="${escapeAttr(entry.path)}" data-ws-name="${escapeAttr(entry.name.toLocaleLowerCase())}" title="Ouvrir ${escapeAttr(entry.path)}">
          <i data-lucide="folder-open"></i>
          <span class="ws-entry-copy"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.path)}</small></span>
          <i data-lucide="chevron-right"></i>
        </button>`,
    )
    .join("");
  const selected = workspacePickerPath();
  const pickingForTerminal = workspacePickerTarget === "new-terminal";

  return `
    <div class="modal-backdrop" id="workspaceBackdrop">
      <section class="modal workspace-browser-modal" role="dialog" aria-modal="true" aria-labelledby="workspaceModalTitle" tabindex="-1">
        <header class="modal-head">
          <div>
            <h2 id="workspaceModalTitle">${pickingForTerminal ? "Environnement du nouveau terminal" : "Choisir l'environnement actif"}</h2>
            <p>${pickingForTerminal ? "Naviguez puis choisissez le dossier fixe de cette session." : "Parcourez les dossiers puis choisissez celui qui regroupera les chats et les agents."}</p>
          </div>
          <button class="icon-button" id="closeWorkspaceModal" title="Fermer" aria-label="Fermer">
            <i data-lucide="x"></i>
          </button>
        </header>

        <div class="modal-body workspace-browser-body">
          ${breadcrumbTrail ? `<nav class="ws-breadcrumb" aria-label="Chemin du dossier">${breadcrumbTrail}</nav>` : ""}
          <div class="ws-path-row">
            <input id="workspacePathInput" value="${escapeAttr(data?.path ?? "")}" placeholder="Chemin du dossier" spellcheck="false" aria-label="Chemin du dossier" />
            <button class="tool-button" id="workspaceGo" title="Aller a ce chemin">
              <i data-lucide="search"></i>
              <span>Aller</span>
            </button>
          </div>
          ${selected ? `<div class="ws-current">Environnement actif : <strong>${escapeHtml(selected)}</strong></div>` : ""}
          ${quickAccess ? `<section class="ws-quick-access"><header><span>Acces rapides</span><small>Environnements connus</small></header><div>${quickAccess}</div></section>` : ""}
          <div class="ws-folder-toolbar">
            <label for="workspaceFolderSearch"><i data-lucide="search"></i><input id="workspaceFolderSearch" type="search" placeholder="Filtrer les sous-dossiers..." autocomplete="off" /></label>
            <span id="workspaceVisibleFolderCount">${entries.length} dossier${entries.length > 1 ? "s" : ""}</span>
          </div>
          ${data?.parent
            ? `<button class="ws-entry ws-parent" data-ws-dir="${escapeAttr(data.parent)}" title="${escapeAttr(data.parent)}">
                 <i data-lucide="arrow-left"></i>
                 <span class="ws-entry-copy"><strong>Dossier parent</strong><small>${escapeHtml(data.parent)}</small></span>
               </button>`
            : ""}
          ${workspaceBrowseLoading ? `<div class="ws-hint">Chargement...</div>` : ""}
          ${workspaceBrowseError ? `<div class="ws-error">${escapeHtml(workspaceBrowseError)}</div>` : ""}
          ${data?.path && !selectableBrowsePath ? `<div class="ws-error">Ce dossier appartient au runtime temporaire des agents. Il ne peut pas devenir un environnement.</div>` : ""}
          <div class="ws-list">${list || (workspaceBrowseLoading ? "" : `<div class="empty">Aucun sous-dossier</div>`)}</div>
          <div class="empty ws-search-empty" id="workspaceSearchEmpty" hidden>Aucun dossier ne correspond a la recherche.</div>
        </div>

        <footer class="modal-actions">
          <button class="tool-button" id="cancelWorkspaceModal">Annuler</button>
          ${pickingForTerminal ? "" : `<button class="tool-button" id="clearWorkspaceModal">Fermer l'environnement</button>`}
          <button class="tool-button primary" id="confirmWorkspaceModal" ${selectableBrowsePath ? "" : "disabled"}>
            <i data-lucide="badge-check"></i>
            <span>Choisir ce dossier</span>
          </button>
        </footer>
      </section>
    </div>
  `;
};

const renderKombaiPanel = () => {
  const status = kombaiStatus;
  const projectDir = currentProjectDir();
  const running = status?.running ?? false;
  const started = status?.started ?? false;
  const binaryAvailable = status?.binaryAvailable ?? true;
  const port = status?.port ?? settings?.kombai?.port ?? 8899;
  const command = status?.command ?? settings?.kombai?.codeServerCommand ?? "code-server";
  const extensionId = status?.extensionId ?? settings?.kombai?.extensionId ?? "kombai.kombai";

  if (running && status?.url) {
    const src = projectDir
      ? `${status.url}/?folder=${encodeURIComponent(projectDir)}`
      : status.url;
    return `
      <section class="kombai-panel running">
        <div class="kombai-bar">
          <div class="kombai-bar-info">
            <span class="live-dot on"></span>
            <strong>Kombai</strong>
            <span>${escapeHtml(`${status.url} | ${projectDir ?? "aucun environnement"}`)}</span>
          </div>
          <div class="kombai-bar-actions">
            <button id="kombaiReload" class="tool-button" title="Recharger l'onglet Kombai">
              <i data-lucide="refresh-ccw"></i><span>Recharger</span>
            </button>
            <button id="kombaiStop" class="tool-button danger" title="Arreter le VS Code embarque">
              <i data-lucide="power"></i><span>Arreter</span>
            </button>
          </div>
        </div>
        <iframe id="kombaiFrame" class="kombai-frame" src="${escapeAttr(src)}" title="Kombai" allow="clipboard-read; clipboard-write"></iframe>
      </section>
    `;
  }

  return `
    <section class="kombai-panel setup">
      <div class="kombai-hero">
        <span class="kombai-hero-icon"><i data-lucide="bot"></i></span>
        <div>
          <h2>Kombai dans l'app</h2>
          <p>Kombai n'a ni CLI ni API : c'est une extension d'IDE. Pour l'utiliser nativement ici, l'app lance un VS Code embarque (code-server) avec l'extension Kombai, affiche dans cet onglet. Aucune fenetre d'editeur externe ne s'ouvre.</p>
        </div>
      </div>

      ${!binaryAvailable
        ? `<div class="kombai-warn">
             <strong>code-server introuvable.</strong> Installe-le une fois, puis reviens ici :
             <code>npm install -g code-server</code>
             <span>(ou renseigne le chemin exact dans le fichier de reglages, cle kombai.codeServerCommand)</span>
           </div>`
        : ""}
      ${status?.message ? `<div class="kombai-note">${escapeHtml(status.message)}</div>` : ""}

      <div class="kombai-meta">
        <div><span>Commande</span><strong>${escapeHtml(command)}</strong></div>
        <div><span>Port</span><strong>${port}</strong></div>
        <div><span>Extension</span><strong>${escapeHtml(extensionId)}</strong></div>
        <div><span>Environnement projet</span><strong>${escapeHtml(projectDir ?? "aucun (compte sans projet)")}</strong></div>
      </div>

      <div class="kombai-actions">
        <button id="kombaiStart" class="tool-button primary" ${binaryAvailable ? "" : "disabled"}>
          <i data-lucide="play"></i><span>${started ? "Redemarrer" : "Demarrer Kombai"}</span>
        </button>
        <button id="kombaiInstall" class="tool-button" ${binaryAvailable ? "" : "disabled"} title="Installer / mettre a jour l'extension Kombai">
          <i data-lucide="upload"></i><span>Installer l'extension</span>
        </button>
        <button id="kombaiRefresh" class="icon-button wide" title="Actualiser le statut">
          <i data-lucide="refresh-ccw"></i>
        </button>
      </div>

      ${started && !running
        ? `<div class="kombai-hint">code-server demarre... l'onglet Kombai s'affichera des qu'il repond (port ${port}).</div>`
        : ""}
      ${!kombaiLoaded ? `<div class="kombai-hint">Lecture du statut...</div>` : ""}
    </section>
  `;
};

const poolRuntimeSummary = (): string =>
  poolStatus?.running
    ? `Actif${poolStatus.baseUrl ? ` · ${poolStatus.baseUrl}` : ""}`
    : "Arrêté";

const renderPoolPanel = () => {
  const accounts = poolStatus?.accounts ?? [];
  const proxiesEnabled = proxyControlsEnabled();
  const poolProxyOptions =
    settings?.proxies
      .map(
        (item) =>
          `<option value="${escapeAttr(item.id)}" ${item.id === poolNewAccountProxyId ? "selected" : ""}>${escapeHtml(item.label)}</option>`,
      )
      .join("") ?? "";
  return `
    <section class="pool-panel">
      <div class="pool-runtime-toolbar">
        <div>
          <strong>Pool de service</strong>
          <span id="poolRuntimeStatus">${escapeHtml(poolRuntimeSummary())}</span>
        </div>
        <div class="pool-actions">
          <button id="poolStart" type="button" class="tool-button primary" ${poolStatus?.running ? "disabled" : ""}>
            <i data-lucide="play"></i><span>Démarrer le pool</span>
          </button>
          <button id="poolStop" type="button" class="tool-button danger" ${poolStatus?.running ? "" : "disabled"}>
            <i data-lucide="square"></i><span>Arrêter le pool</span>
          </button>
        </div>
      </div>
      <form id="poolAddAccount" class="pool-add">
        <div class="pool-add-grid">
          <label>
            <span>Nouveau compte</span>
            <input id="poolNewAccountLabel" value="${escapeAttr(poolNewAccountLabel)}" placeholder="Nom du compte" />
          </label>
          <label>
            <span>Proxy</span>
            <select id="poolNewAccountProxy" ${proxiesEnabled ? "" : "disabled"}>
              <option value="" ${poolNewAccountProxyId ? "" : "selected"}>Sans proxy</option>
              ${poolProxyOptions}
            </select>
          </label>
          <label>
            <span>Modele Codex par defaut</span>
            <input id="poolNewAccountModel" list="codexModelSuggestions" value="${escapeAttr(poolNewAccountModel)}" placeholder="${DEFAULT_CODEX_MODEL}" />
          </label>
          <label>
            <span>Intensite par defaut</span>
            <select id="poolNewAccountReasoningEffort">${reasoningEffortOptions(poolNewAccountReasoningEffort)}</select>
          </label>
          <label class="pool-check" title="Sans approbations et sans sandbox Codex">
            <input id="poolNewAccountBypass" type="checkbox" ${poolNewAccountBypass ? "checked" : ""} />
            <span>Mode bypass</span>
          </label>
        </div>
        <button class="tool-button" type="submit">
          <i data-lucide="plus"></i><span>Ajouter compte</span>
        </button>
      </form>
      <div class="pool-import">
        <label>
          <span>JSON pool (blob de session colle ou chemin fichier)</span>
          <textarea id="poolImportPaths" rows="5" placeholder="Colle ici le JSON de chatgpt.com/api/auth/session ({&quot;accessToken&quot;:&quot;eyJ...&quot;,...}) ou un chemin C:\\...\\*.json">${escapeHtml(poolImportPaths)}</textarea>
        </label>
        <button id="poolImport" class="tool-button">
          <i data-lucide="upload"></i><span>Importer JSON</span>
        </button>
      </div>
      <div class="pool-table-wrap table-wrap" tabindex="0" aria-label="Comptes du pool, tableau defilable horizontalement">
        <table class="pool-table">
        <thead>
          <tr><th>Compte</th><th>État</th><th>Proxy</th><th>Tokens</th><th>Servis</th><th>Erreurs</th><th>Dernière erreur</th><th></th></tr>
        </thead>
        <tbody id="poolRows">
          ${accounts.map(renderPoolRow).join("") ||
          `<tr><td colspan="8" class="pool-empty">Aucun compte. Ajoute un nom de compte, puis attribue un proxy si besoin.</td></tr>`}
        </tbody>
        </table>
      </div>
    </section>
  `;
};

const renderLimitsPanel = () => {
  const displayedAccounts = deduplicateQuotaAccountsForDisplay(limitStatus);
  const connected = displayedAccounts.filter((account) => account.hasTokens).length;
  const configuredCount = deduplicateQuotaAccountsForDisplay(settings?.accounts ?? []).length;
  const nextSession = nextLimitTimestamp("sessionResetAt");
  const nextWeekly = nextLimitTimestamp("weeklyResetAt");
  const availableCount = displayedAccounts.filter(
    (account) => account.source === "server" || account.source === "session",
  ).length;

  return `
    <section class="limits-panel">
      <header class="limits-page-head">
        <div class="limits-page-copy">
          <span class="limits-eyebrow"><i data-lucide="gauge"></i> Suivi des quotas</span>
          <h2>Limites</h2>
          <p>Les quotas sont consultés ici. Les connexions se gèrent uniquement depuis la page Comptes.</p>
        </div>
        <button id="refreshLimits" class="tool-button limits-refresh" title="Actualiser les limites serveur">
          <i data-lucide="refresh-ccw"></i>
          <span>Actualiser</span>
        </button>
      </header>

      <div class="limits-overview" aria-label="Résumé des limites">
        <div class="limits-overview-card">
          <span class="limits-overview-icon"><i data-lucide="badge-check"></i></span>
          <span><small>Comptes actifs</small><strong>${connected}<em>/ ${configuredCount}</em></strong></span>
        </div>
        <div class="limits-overview-card">
          <span class="limits-overview-icon"><i data-lucide="gauge"></i></span>
          <span><small>Quotas lisibles</small><strong>${availableCount}</strong></span>
        </div>
        <div class="limits-overview-card">
          <span class="limits-overview-icon"><i data-lucide="clock-3"></i></span>
          <span><small>Prochain reset 5 h</small><strong>${formatTimestamp(nextSession)}</strong></span>
        </div>
        <div class="limits-overview-card">
          <span class="limits-overview-icon"><i data-lucide="calendar-clock"></i></span>
          <span><small>Prochain reset hebdo</small><strong>${formatTimestamp(nextWeekly)}</strong></span>
        </div>
      </div>

      <section class="limits-accounts" aria-labelledby="limitsAccountsTitle">
        <header>
          <div>
            <strong id="limitsAccountsTitle">Comptes</strong>
            <span>État et consommation de chaque compte</span>
          </div>
          <b>${displayedAccounts.length}</b>
        </header>
        <div class="limit-card-grid" aria-live="polite">${renderLimitCards()}</div>
      </section>
    </section>
  `;
};

const renderLimitCards = () => {
  if (!limitStatusLoaded) {
    return `<div class="limit-cards-state"><i data-lucide="loader-circle" class="is-spinning"></i><strong>Chargement des limites</strong><span>Lecture des quotas serveur…</span></div>`;
  }

  const displayedAccounts = deduplicateQuotaAccountsForDisplay(limitStatus);
  if (displayedAccounts.length === 0) {
    return `<div class="limit-cards-state"><i data-lucide="gauge"></i><strong>Aucune limite disponible</strong><span>Les comptes configurés apparaîtront ici.</span></div>`;
  }

  return displayedAccounts.map(renderLimitCard).join("");
};

// Le serveur 8080 peut etre mis a jour independamment du frontend. Les
// settings restent donc la source de verite du fournisseur tant qu'une ancienne
// reponse `/api/limits` ne contient pas encore le champ `provider`.
const limitRowProvider = (account: AccountLimitView): Provider => {
  const configured = accountById(account.id);
  return configured
    ? accountProvider(configured)
    : account.provider === "claude"
      ? "claude"
      : "codex";
};

const renderLimitMeter = (
  label: string,
  usedPercent?: number | null,
  resetAt?: number | null,
  remainingSeconds?: number | null,
): string => {
  const remainingPercent = remainingFromUsedPercent(usedPercent);
  const tone = remainingPercent === null
    ? "unknown"
    : remainingPercent <= 10
      ? "critical"
      : remainingPercent <= 30
        ? "warning"
        : "healthy";
  const roundedRemaining = remainingPercent === null ? null : Math.round(remainingPercent);
  const progressAttributes = roundedRemaining === null
    ? ""
    : `role="progressbar" aria-label="${escapeAttr(label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${roundedRemaining}"`;
  return `
    <section class="limit-meter ${tone}">
      <div class="limit-meter-head">
        <span>${escapeHtml(label)}</span>
        <strong>${roundedRemaining === null ? "Non exposé" : `${roundedRemaining} % restant`}</strong>
      </div>
      <div class="limit-meter-track" ${progressAttributes}>
        <i style="width:${roundedRemaining ?? 0}%"></i>
      </div>
      <div class="limit-meter-meta">
        <span>Reset ${escapeHtml(formatTimestamp(resetAt))}</span>
        <small>${remainingSeconds == null ? "Durée indisponible" : escapeHtml(formatRemaining(remainingSeconds))}${usedPercent == null ? "" : ` · ${escapeHtml(formatPercent(usedPercent))} utilisé`}</small>
      </div>
    </section>`;
};

const renderLimitCard = (account: AccountLimitView) => {
  const provider = limitRowProvider(account);
  const providerName = provider === "claude" ? "Claude" : "Codex";
  const buckets = provider === "codex" && account.buckets.length > 0
    ? `<div class="limit-card-buckets"><span>Fenêtres détectées</span><div class="limit-buckets">${renderLimitBuckets(account.buckets)}</div></div>`
    : "";
  const quotaContent = provider === "claude"
    ? `<div class="limit-card-unavailable"><i data-lucide="sparkles"></i><span><strong>Quotas non exposés</strong><small>Claude ne transmet pas encore ses fenêtres de consommation.</small></span></div>`
    : `<div class="limit-card-meters">
         ${renderLimitMeter("Fenêtre 5 h", account.sessionUsedPercent, account.sessionResetAt, account.sessionRemainingSecs)}
         ${renderLimitMeter("Fenêtre hebdomadaire", account.weeklyUsedPercent, account.weeklyResetAt, account.weeklyRemainingSecs)}
       </div>`;
  return `
    <article class="limit-card ${limitBadgeClass(account)}">
      <header class="limit-card-head">
        <div class="limit-card-identity">
          <span class="limit-card-provider ${provider}"><i data-lucide="${provider === "claude" ? "sparkles" : "cpu"}"></i></span>
          <span><strong>${escapeHtml(account.label)}</strong><small>${providerName}</small></span>
        </div>
        <span class="limit-badge ${limitBadgeClass(account)}">${escapeHtml(limitSourceLabel(account))}</span>
      </header>
      ${account.error && provider === "codex" ? `<p class="limit-error"><i data-lucide="circle-alert"></i><span>${escapeHtml(account.error)}</span></p>` : ""}
      ${quotaContent}
      ${buckets}
      <footer class="limit-card-foot"><span><i data-lucide="refresh-ccw"></i> Actualisé ${escapeHtml(formatTimestamp(account.refreshedAt))}</span></footer>
    </article>`;
};

const limitBadgeClass = (account: AccountLimitView) => {
  if (!account.hasTokens) return "missing";
  if (limitRowProvider(account) === "claude") return "connected";
  if (account.error && AUTH_LIMIT_ERROR.test(account.error)) return "error";
  if (
    account.source === "server" ||
    account.source === "session" ||
    account.source === "authenticated"
  ) return "connected";
  if (account.source === "server-empty") return "empty";
  return "error";
};

const limitSourceLabel = (account: AccountLimitView) => {
  if (!account.hasTokens) return "non connecte";
  if (limitRowProvider(account) === "claude") return "connecte";
  if (account.error && AUTH_LIMIT_ERROR.test(account.error)) return "session expiree";
  if (account.source === "authenticated") return "connecte";
  if (account.source === "server") return "serveur";
  if (account.source === "session") return "session Codex";
  if (account.source === "server-empty") return "vide";
  return "erreur";
};

// Un token revoque/invalide (`token_invalidated`, `refresh_token_invalidated`,
// 401...) laisse un compte « connecte » cote fichier mais illisible cote serveur.
const AUTH_LIMIT_ERROR =
  /token[_ ]?invalidat|refresh[_ ]?token|revoked|revoqu|\b401\b|unauthor|authentication|session (?:has )?ended|sign(?:ing)? ?in again|log ?in again|not logged in|connexion requise|authentication required/i;

const renderLimitBuckets = (buckets: AccountRateLimitBucketView[]) => {
  if (buckets.length === 0) return `<span class="limit-empty">aucun bucket</span>`;

  return buckets
    .map(
      (bucket) => `
        <span class="limit-bucket" title="${escapeAttr(`${bucket.limitId} ${bucket.bucket}`)}">
          ${escapeHtml(formatWindow(bucket.windowDurationMins))}
          ${escapeHtml(formatPercent(bucket.usedPercent))}
          <small>${escapeHtml(formatTimestamp(bucket.resetsAt))}</small>
        </span>
      `,
    )
    .join("");
};

const formatWindow = (minutes: number) => {
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "hebdo";
  if (minutes % 1440 === 0) return `${minutes / 1440}j`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
};

const formatPercent = (value?: number | null) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${Math.round(value)}%`;
};

const nextLimitTimestamp = (key: "sessionResetAt" | "weeklyResetAt") => {
  const values = limitStatus
    .filter((account) => account.hasTokens)
    .map((account) => account[key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return values.length > 0 ? Math.min(...values) : null;
};

const formatTimestamp = (timestamp?: number | null) => {
  if (!timestamp) return "n/a";
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
};

const formatRemaining = (seconds?: number | null) => {
  if (seconds === null || seconds === undefined) return "n/a";
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
};

const localDateKey = (timestamp: number): string => {
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const STATS_ACCOUNT_COLORS = [
  "#f2f2ee",
  "#8fd6c8",
  "#e7bd70",
  "#9eb4ff",
  "#e99aa7",
  "#afd77f",
  "#c6a4e8",
  "#79c2e2",
];

const STATS_ACCOUNT_COLORS_LIGHT = [
  "#27312a",
  "#187666",
  "#96640e",
  "#3d5fb0",
  "#a64050",
  "#527f25",
  "#70469c",
  "#257694",
];

const statsAccountColorStyle = (index: number): string =>
  `--stats-account-color-dark:${STATS_ACCOUNT_COLORS[index % STATS_ACCOUNT_COLORS.length]};` +
  `--stats-account-color-light:${STATS_ACCOUNT_COLORS_LIGHT[index % STATS_ACCOUNT_COLORS_LIGHT.length]}`;

const statsSourceLabel = (source: AccountUsageView["usageSource"]) => {
  if (source === "codex-account") return "Compte Codex · toutes surfaces";
  if (source === "local-sessions") return "Historique local";
  return "Indisponible";
};

const renderStatsTabs = () => `
  <nav class="stats-tabs" aria-label="Analyse des statistiques">
    <button
      class="${statsActiveTab === "tokens" ? "active" : ""}"
      data-stats-tab="tokens"
      aria-selected="${statsActiveTab === "tokens" ? "true" : "false"}"
    ><i data-lucide="bar-chart-3"></i><span>Usage tokens</span></button>
    <button
      class="${statsActiveTab === "work-time" ? "active" : ""}"
      data-stats-tab="work-time"
      aria-selected="${statsActiveTab === "work-time" ? "true" : "false"}"
    ><i data-lucide="clock-3"></i><span>Temps de travail</span></button>
  </nav>
`;

const renderDashboardPanel = () => {
  if (statsActiveTab === "work-time") {
    return renderWorkTimeDashboardPanel();
  }
  if (!accountUsageLoaded) {
    return `
      <section class="dashboard-panel stats-dashboard stats-loading" aria-busy="true">
        ${renderStatsTabs()}
        <div class="stats-loading-mark"><i data-lucide="gauge"></i></div>
        <strong>Synchronisation des comptes</strong>
        <span>Lecture de l’usage Codex quotidien, toutes surfaces confondues…</span>
      </section>
    `;
  }

  if (!accountUsage) {
    return `
      <section class="dashboard-panel stats-dashboard stats-loading">
        ${renderStatsTabs()}
        <div class="stats-loading-mark is-error"><i data-lucide="circle-alert"></i></div>
        <strong>Les statistiques sont indisponibles</strong>
        <span>La lecture des comptes n’a pas abouti.</span>
        <button id="dashboardRefresh" class="tool-button primary"><i data-lucide="refresh-ccw"></i><span>Réessayer</span></button>
      </section>
    `;
  }

  const data = accountUsage;
  const endDate = usageDashboard?.today.date ?? localDateKey(data.generatedAt);
  const last30Days = buildAccountTokenSeries(data, endDate, 30);
  const selectedDays = last30Days.slice(-statsRangeDays);
  const lastDay = selectedDays[selectedDays.length - 1];
  const latestActiveDay = [...selectedDays].reverse().find((day) => day.totalTokens > 0);
  if (!selectedStatsDate || !selectedDays.some((day) => day.date === selectedStatsDate)) {
    selectedStatsDate = latestActiveDay?.date ?? lastDay?.date ?? endDate;
  }
  const selectedDate = selectedStatsDate;
  const selectedDay =
    selectedDays.find((day) => day.date === selectedDate) ??
    ({
      date: selectedDate,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    } satisfies DailyTokenUsage);
  const dayAccounts = accountTokenUsageForDate(data, selectedDate);
  const todayUsage = sumTokenUsage(last30Days.slice(-1));
  const last7DaysUsage = sumTokenUsage(last30Days.slice(-7));
  const last30DaysUsage = sumTokenUsage(last30Days);
  const selectedUsage = sumTokenUsage(selectedDays);
  const selectedRange =
    STATS_RANGE_OPTIONS.find((range) => range.days === statsRangeDays) ?? STATS_RANGE_OPTIONS[2];
  const globalAccountCount = data.accounts.filter(
    (account) => account.usageSource === "codex-account",
  ).length;
  const fallbackAccountCount = data.accounts.filter(
    (account) => account.usageSource === "local-sessions",
  ).length;
  const profileCount =
    data.profileCount ||
    data.accounts.reduce(
      (total, account) => total + Math.max(1, account.profileLabels?.length ?? 1),
      0,
    );

  return `
    <section class="dashboard-panel stats-dashboard">
      ${renderStatsTabs()}
      <header class="stats-hero">
        <div class="stats-hero-copy">
          <span class="stats-eyebrow"><i data-lucide="sparkles"></i> Statistiques d’usage</span>
          <h1>Vos tokens, compte par compte.</h1>
          <p>${globalAccountCount} compte(s) synchronisé(s) avec Codex${fallbackAccountCount > 0 ? ` · ${fallbackAccountCount} en repli local` : ""}. Les profils liés au même compte sont regroupés pour éviter les doublons.</p>
        </div>
        <div class="stats-hero-actions">
          <span class="stats-freshness"><i data-lucide="server"></i> ${profileCount} profil(s) · mis à jour ${escapeHtml(formatTimestamp(data.generatedAt))}</span>
          <button id="dashboardRefresh" class="tool-button stats-refresh"><i data-lucide="refresh-ccw"></i><span>Actualiser</span></button>
        </div>
      </header>

      <div class="stats-metric-grid">
        ${renderStatsMetric("Aujourd’hui", todayUsage.totalTokens, "Tous les comptes", "calendar-clock")}
        ${renderStatsMetric("7 derniers jours", last7DaysUsage.totalTokens, `${formatTokens(last7DaysUsage.totalTokens / 7)} / jour`, "scan-eye")}
        ${renderStatsMetric("30 derniers jours", last30DaysUsage.totalTokens, `${data.accounts.length} compte(s) réel(s)`, "bar-chart-3")}
        ${renderStatsMetric("Cumul des comptes", data.totalTokens, "Valeur à vie remontée par Codex", "gauge")}
      </div>

      <section class="stats-timeline-card">
        <div class="stats-card-head">
          <div>
            <span class="stats-card-kicker">Chronologie quotidienne</span>
            <strong>Un point, une journée</strong>
            <small>${escapeHtml(selectedRange.label)} · ${escapeHtml(formatTokens(selectedUsage.totalTokens))} tokens</small>
          </div>
          <div class="dashboard-segment stats-range" role="group" aria-label="Période du graphique">
            ${STATS_RANGE_OPTIONS.map(
              (range) => `
                <button
                  class="${range.days === statsRangeDays ? "active" : ""}"
                  data-stats-range="${range.days}"
                  aria-pressed="${range.days === statsRangeDays ? "true" : "false"}"
                >${escapeHtml(range.label)}</button>
              `,
            ).join("")}
          </div>
        </div>
        ${renderStatsPointChart(selectedDays, selectedDate)}
        <div class="stats-timeline-caption">
          <span><i data-lucide="target"></i> Cliquez sur un point pour ouvrir sa répartition.</span>
          <span>Source prioritaire : usage du compte Codex, même hors de cette application.</span>
        </div>
      </section>

      ${renderStatsDayDetail(selectedDay, dayAccounts)}
      ${renderStatsAccountOverview(data.accounts)}
    </section>
  `;
};

const renderStatsMetric = (label: string, value: number, detail: string, icon: string) => `
  <article class="stats-metric">
    <span class="stats-metric-icon"><i data-lucide="${icon}"></i></span>
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatTokens(value))}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  </article>
`;

const formatWorkDuration = (seconds: number, compact = false) => {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${totalMinutes} min`;
  if (compact || minutes === 0) return minutes === 0 ? `${hours} h` : `${hours} h ${minutes}`;
  return `${hours} h ${String(minutes).padStart(2, "0")}`;
};

const renderStatsDurationMetric = (
  label: string,
  seconds: number,
  detail: string,
  icon: string,
) => `
  <article class="stats-metric work-time-metric">
    <span class="stats-metric-icon"><i data-lucide="${icon}"></i></span>
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatWorkDuration(seconds))}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  </article>
`;

const workTimeBucketTitle = (bucket: WorkTimeBucket, granularity: WorkTimeGranularity) => {
  if (granularity === "day") return formatFullDayLabel(bucket.startDate);
  if (granularity === "week") {
    return `Du ${formatDayLabel(bucket.startDate)} au ${formatDayLabel(bucket.endDate)}`;
  }
  const parsed = new Date(`${bucket.startDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return bucket.key;
  const label = new Intl.DateTimeFormat("fr-FR", {
    month: "long",
    year: "numeric",
  }).format(parsed);
  return `${label.charAt(0).toLocaleUpperCase("fr-FR")}${label.slice(1)}`;
};

const workTimeBucketShortLabel = (
  bucket: WorkTimeBucket,
  granularity: WorkTimeGranularity,
) => {
  if (granularity === "day") return formatDayLabel(bucket.startDate);
  if (granularity === "week") return formatDayLabel(bucket.startDate);
  const parsed = new Date(`${bucket.startDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return bucket.key;
  return new Intl.DateTimeFormat("fr-FR", { month: "short" }).format(parsed);
};

const renderWorkTimeChart = (
  buckets: WorkTimeBucket[],
  selectedKey: string,
  granularity: WorkTimeGranularity,
) => {
  const maximum = Math.max(1, ...buckets.map((bucket) => bucket.activeSeconds));
  return `
    <div class="work-time-chart" role="list" aria-label="Temps de travail par ${escapeAttr(granularity)}">
      ${buckets
        .map((bucket) => {
          const selected = bucket.key === selectedKey;
          const level = Math.max(0, Math.min(1, bucket.activeSeconds / maximum));
          const title = `${workTimeBucketTitle(bucket, granularity)} : ${formatWorkDuration(bucket.activeSeconds)}`;
          return `
            <button
              class="work-time-column${selected ? " is-selected" : ""}${bucket.activeSeconds === 0 ? " is-empty" : ""}"
              data-work-time-bucket="${escapeAttr(bucket.key)}"
              style="--work-time-level:${level.toFixed(4)}"
              role="listitem"
              aria-label="${escapeAttr(title)}"
              aria-pressed="${selected ? "true" : "false"}"
            >
              <span class="work-time-column-value">${escapeHtml(formatWorkDuration(bucket.activeSeconds, true))}</span>
              <span class="work-time-bar" aria-hidden="true"><i></i></span>
              <small>${escapeHtml(workTimeBucketShortLabel(bucket, granularity))}</small>
            </button>
          `;
        })
        .join("")}
    </div>
  `;
};

const renderWorkTimeDashboardPanel = () => {
  if (!workTimeLoaded) {
    return `
      <section class="dashboard-panel stats-dashboard stats-loading" aria-busy="true">
        ${renderStatsTabs()}
        <div class="stats-loading-mark"><i data-lucide="clock-3"></i></div>
        <strong>Analyse du temps actif</strong>
        <span>Lecture des tours de chats ordinaires, sans les agents autonomes…</span>
      </section>
    `;
  }
  if (!workTimeDashboard) {
    return `
      <section class="dashboard-panel stats-dashboard stats-loading">
        ${renderStatsTabs()}
        <div class="stats-loading-mark is-error"><i data-lucide="circle-alert"></i></div>
        <strong>Le temps de travail est indisponible</strong>
        <span>Les historiques locaux n’ont pas pu être analysés.</span>
        <button id="dashboardRefresh" class="tool-button primary"><i data-lucide="refresh-ccw"></i><span>Réessayer</span></button>
      </section>
    `;
  }

  const data = workTimeDashboard;
  const endDate = localDateKey(data.generatedAt);
  const dailyBuckets = buildWorkTimeBuckets(data.days, endDate, "day");
  const weeklyBuckets = buildWorkTimeBuckets(data.days, endDate, "week");
  const monthlyBuckets = buildWorkTimeBuckets(data.days, endDate, "month");
  const today = dailyBuckets[dailyBuckets.length - 1];
  const currentWeek = weeklyBuckets[weeklyBuckets.length - 1];
  const currentMonth = monthlyBuckets[monthlyBuckets.length - 1];
  const averageActiveDay = currentMonth.activeDays > 0
    ? currentMonth.activeSeconds / currentMonth.activeDays
    : 0;
  const buckets =
    workTimeGranularity === "day"
      ? dailyBuckets
      : workTimeGranularity === "week"
        ? weeklyBuckets
        : monthlyBuckets;
  if (!selectedWorkTimeBucket || !buckets.some((bucket) => bucket.key === selectedWorkTimeBucket)) {
    selectedWorkTimeBucket =
      [...buckets].reverse().find((bucket) => bucket.activeSeconds > 0)?.key ??
      buckets[buckets.length - 1]?.key ??
      null;
  }
  const selectedBucket =
    buckets.find((bucket) => bucket.key === selectedWorkTimeBucket) ?? buckets[buckets.length - 1];
  const selectedKey = selectedBucket?.key ?? "";

  return `
    <section class="dashboard-panel stats-dashboard work-time-dashboard">
      ${renderStatsTabs()}
      <header class="stats-hero">
        <div class="stats-hero-copy">
          <span class="stats-eyebrow"><i data-lucide="clock-3"></i> Temps de travail</span>
          <h1>Votre temps réellement actif.</h1>
          <p>La mesure suit uniquement les tours où un chat ordinaire traite une demande. Les agents autonomes et les sous-agents sont exclus, et deux chats simultanés ne doublent jamais le temps.</p>
        </div>
        <div class="stats-hero-actions">
          <span class="stats-freshness"><i data-lucide="history"></i> ${data.trackedChats} chat(s) · mis à jour ${escapeHtml(formatTimestamp(data.generatedAt))}</span>
          <button id="dashboardRefresh" class="tool-button stats-refresh"><i data-lucide="refresh-ccw"></i><span>Actualiser</span></button>
        </div>
      </header>

      <div class="stats-metric-grid">
        ${renderStatsDurationMetric("Aujourd’hui", today?.activeSeconds ?? 0, `${today?.turnCount ?? 0} tour(s) actif(s)`, "calendar-clock")}
        ${renderStatsDurationMetric("Cette semaine", currentWeek?.activeSeconds ?? 0, `${currentWeek?.activeDays ?? 0} jour(s) actif(s)`, "history")}
        ${renderStatsDurationMetric("Ce mois", currentMonth?.activeSeconds ?? 0, `${currentMonth?.turnCount ?? 0} tour(s) mesuré(s)`, "bar-chart-3")}
        ${renderStatsDurationMetric("Moyenne / jour actif", averageActiveDay, "Sur le mois en cours", "activity")}
      </div>

      <section class="stats-timeline-card work-time-card">
        <div class="stats-card-head">
          <div>
            <span class="stats-card-kicker">Rythme de travail</span>
            <strong>Temps actif par ${workTimeGranularity === "day" ? "jour" : workTimeGranularity === "week" ? "semaine" : "mois"}</strong>
            <small>${data.trackedTurns} tour(s) analysé(s) dans l’historique local</small>
          </div>
          <div class="dashboard-segment stats-range work-time-range" role="group" aria-label="Regroupement du temps de travail">
            ${WORK_TIME_GRANULARITY_OPTIONS.map(
              (option) => `
                <button
                  class="${option.id === workTimeGranularity ? "active" : ""}"
                  data-work-time-granularity="${option.id}"
                  aria-pressed="${option.id === workTimeGranularity ? "true" : "false"}"
                >${escapeHtml(option.label)}</button>
              `,
            ).join("")}
          </div>
        </div>
        ${renderWorkTimeChart(buckets, selectedKey, workTimeGranularity)}
        <div class="stats-timeline-caption">
          <span><i data-lucide="target"></i> Sélectionnez une barre pour voir le détail.</span>
          <span>Mesure locale · agents autonomes exclus.</span>
        </div>
      </section>

      ${selectedBucket ? `
        <section class="work-time-detail" aria-live="polite">
          <div class="work-time-detail-primary">
            <span class="stats-card-kicker">Période sélectionnée</span>
            <strong>${escapeHtml(workTimeBucketTitle(selectedBucket, workTimeGranularity))}</strong>
            <b>${escapeHtml(formatWorkDuration(selectedBucket.activeSeconds))}</b>
            <small>${selectedBucket.turnCount} tour(s) · ${selectedBucket.activeDays} jour(s) actif(s)</small>
          </div>
          <div class="work-time-method">
            <span><i data-lucide="shield-check"></i></span>
            <div>
              <strong>Comment ce temps est calculé</strong>
              <p>Chaque intervalle commence quand un tour de chat démarre et se termine au dernier événement de traitement. Les pauses entre deux demandes ne comptent pas. Si plusieurs chats tournent ensemble, leur chevauchement ne compte qu’une fois.</p>
            </div>
          </div>
        </section>
      ` : ""}
    </section>
  `;
};

const renderStatsPointChart = (days: DailyTokenUsage[], selectedDate: string) => {
  if (days.length === 0) {
    return `<div class="stats-point-chart empty">Aucune journée disponible</div>`;
  }

  const width = 1000;
  const height = 304;
  const padLeft = 76;
  const padRight = 32;
  const padTop = 42;
  const padBottom = 52;
  const bottom = height - padBottom;
  const right = width - padRight;
  const innerWidth = right - padLeft;
  const actualMax = Math.max(0, ...days.map((day) => day.totalTokens));
  const scaleMax = Math.max(1, actualMax);
  const points = days.map((day, index) => ({
    day,
    x:
      padLeft +
      (days.length === 1 ? innerWidth / 2 : (index / (days.length - 1)) * innerWidth),
    y: bottom - (day.totalTokens / scaleMax) * (bottom - padTop),
  }));
  const linePath =
    points.length > 1
      ? points
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
          )
          .join(" ")
      : "";
  const grid = [0, 1, 2, 3].map((step) => {
    const y = padTop + ((bottom - padTop) / 3) * step;
    const value = actualMax === 0 ? 0 : actualMax * (1 - step / 3);
    return `
      <line x1="${padLeft}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}"></line>
      <text x="${padLeft - 14}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatCompactTokens(value))}</text>
    `;
  });

  const labelStep = Math.max(1, Math.ceil(days.length / 8));
  const lastPointIndex = points.length - 1;
  const lastRegularLabelIndex = Math.floor(lastPointIndex / labelStep) * labelStep;
  const labels = points
    .filter(
      (_, index) =>
        index % labelStep === 0 ||
        (index === lastPointIndex && index - lastRegularLabelIndex >= 2),
    )
    .map(
      (point) =>
        `<text x="${point.x.toFixed(2)}" y="${height - 14}" text-anchor="middle">${escapeHtml(formatDayLabel(point.day.date))}</text>`,
    )
    .join("");
  const selected = points.find((point) => point.day.date === selectedDate);
  const hitRadius = days.length === 1 ? 65 : days.length <= 7 ? 36 : 16;

  return `
    <div class="stats-point-chart range-${days.length}">
      <svg viewBox="0 0 ${width} ${height}" role="group" aria-label="Tokens utilisés chaque jour. Chaque point est sélectionnable.">
        <title>Utilisation quotidienne totale de tous les comptes</title>
        <g class="stats-chart-grid">${grid.join("")}</g>
        ${selected ? `<line class="stats-selected-guide" x1="${selected.x.toFixed(2)}" y1="${padTop}" x2="${selected.x.toFixed(2)}" y2="${bottom}"></line>` : ""}
        ${linePath ? `<path class="stats-chart-line" d="${linePath}"></path>` : ""}
        <g class="stats-chart-points">
          ${points
            .map((point) => {
              const isSelected = point.day.date === selectedDate;
              const pointLabel = `${formatFullDayLabel(point.day.date)} : ${formatTokens(point.day.totalTokens)} tokens`;
              return `
                <g
                  class="stats-day-point${isSelected ? " is-selected" : ""}${point.day.totalTokens > 0 ? " has-value" : " is-empty"}"
                  data-stats-date="${escapeAttr(point.day.date)}"
                  role="button"
                  tabindex="0"
                  aria-label="${escapeAttr(pointLabel)}"
                  aria-pressed="${isSelected ? "true" : "false"}"
                >
                  <circle class="stats-point-hit" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${hitRadius}"></circle>
                  <circle class="stats-point-halo" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${isSelected ? 11 : 8}"></circle>
                  <circle class="stats-point-core" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="${isSelected ? 5.5 : 4}"></circle>
                  <title>${escapeHtml(pointLabel)}</title>
                </g>
              `;
            })
            .join("")}
        </g>
        ${selected ? `<g class="stats-selected-value" transform="translate(${selected.x.toFixed(2)} ${Math.max(23, selected.y - 24).toFixed(2)})"><text text-anchor="middle">${escapeHtml(formatCompactTokens(selected.day.totalTokens))}</text></g>` : ""}
        <g class="stats-chart-labels">${labels}</g>
      </svg>
    </div>
  `;
};

const renderStatsDayDetail = (
  day: DailyTokenUsage,
  accounts: ReturnType<typeof accountTokenUsageForDate>,
) => {
  const activeAccounts = accounts.filter((account) => account.totalTokens > 0).length;
  return `
    <section class="stats-day-card" aria-live="polite">
      <div class="stats-day-summary">
        <span class="stats-card-kicker">Journée sélectionnée</span>
        <strong>${escapeHtml(formatFullDayLabel(day.date))}</strong>
        <div class="stats-day-total">
          <b>${escapeHtml(formatTokens(day.totalTokens))}</b>
          <span>tokens utilisés</span>
        </div>
        <p>${activeAccounts} compte(s) actif(s) sur ${accounts.length}. Le total ci-dessus additionne chaque source une seule fois.</p>
      </div>
      <div class="stats-account-breakdown">
        <div class="stats-breakdown-head">
          <strong>Source par compte</strong>
          <span>Part du total journalier</span>
        </div>
        <div class="stats-source-list">
          ${accounts
            .map((account, index) => {
              const unavailable = account.usageSource === "unavailable";
              const aliases =
                account.profileLabels.length > 1
                  ? `${account.profileLabels.length} profils regroupés`
                  : statsSourceLabel(account.usageSource as AccountUsageView["usageSource"]);
              return `
                <article class="stats-source-row${account.totalTokens === 0 ? " is-zero" : ""}${unavailable ? " is-unavailable" : ""}" style="${statsAccountColorStyle(index)}" ${account.error ? `title="${escapeAttr(account.error)}"` : ""}>
                  <span class="stats-account-dot" aria-hidden="true"></span>
                  <div class="stats-source-name">
                    <strong>${escapeHtml(account.label)}</strong>
                    <small>${escapeHtml(aliases)}</small>
                  </div>
                  <div class="stats-source-share" aria-label="${Math.round(account.share * 100)} pour cent du total">
                    <span><i style="width:${Math.max(0, Math.min(100, account.share * 100)).toFixed(2)}%"></i></span>
                    <small>${Math.round(account.share * 100)}%</small>
                  </div>
                  <div class="stats-source-value">
                    <strong>${unavailable ? "—" : escapeHtml(formatTokens(account.totalTokens))}</strong>
                    <small>${unavailable ? "non lisible" : "tokens"}</small>
                  </div>
                </article>
              `;
            })
            .join("") || `<div class="pool-empty">Aucun compte configuré</div>`}
        </div>
      </div>
    </section>
  `;
};

const renderStatsAccountOverview = (accounts: AccountUsageView[]) => `
  <section class="stats-account-card">
    <div class="stats-card-head">
      <div>
        <span class="stats-card-kicker">Vue d’ensemble</span>
        <strong>Cumul par compte</strong>
        <small>Le cumul à vie est fourni par le compte Codex quand il est disponible.</small>
      </div>
    </div>
    <div class="stats-account-grid">
      ${accounts
        .map((account, index) => {
          const aliases = account.profileLabels?.length ?? 1;
          return `
            <article class="stats-account-tile${account.usageSource === "unavailable" ? " is-unavailable" : ""}" style="${statsAccountColorStyle(index)}" ${account.sourceError ? `title="${escapeAttr(account.sourceError)}"` : ""}>
              <div class="stats-account-tile-head">
                <span class="stats-account-dot"></span>
                <div>
                  <strong>${escapeHtml(account.label)}</strong>
                  <small>${aliases > 1 ? `${aliases} profils liés` : statsSourceLabel(account.usageSource)}</small>
                </div>
                <span class="stats-source-badge source-${escapeAttr(account.usageSource)}">${account.usageSource === "codex-account" ? "Global" : account.usageSource === "local-sessions" ? "Local" : "Erreur"}</span>
              </div>
              <div class="stats-account-tile-value">
                <strong>${account.usageSource === "unavailable" ? "—" : escapeHtml(formatTokens(account.totalTokens))}</strong>
                <span>tokens cumulés</span>
              </div>
              <div class="stats-account-tile-today">
                <span>Aujourd’hui</span>
                <strong>${escapeHtml(formatTokens(account.todayTokens))}</strong>
              </div>
            </article>
          `;
        })
        .join("") || `<div class="pool-empty">Aucun compte configuré</div>`}
    </div>
  </section>
`;

const renderLegacyDashboardPanel = () => {
  if (!accountUsageLoaded) {
    return `<section class="dashboard-panel"><div class="pool-empty">Calcul des tokens de tous les comptes…</div></section>`;
  }

  if (!accountUsage) {
    return `
      <section class="dashboard-panel">
        <div class="pool-empty">Impossible de lire les statistiques des comptes.</div>
        <div class="dashboard-table-actions dashboard-empty-action">
          <button id="dashboardRefresh"><i data-lucide="refresh-ccw"></i><span>Réessayer</span></button>
        </div>
      </section>
    `;
  }

  // La série est indépendante des jours disponibles dans le pool : elle couvre
  // toujours 30 jours calendaires et additionne chaque compte pour chaque date.
  const endDate = usageDashboard?.today.date ?? localDateKey(accountUsage.generatedAt);
  const last30Days = buildAccountTokenSeries(accountUsage, endDate, 30);
  const todayUsage = sumTokenUsage(last30Days.slice(-1));
  const last7DaysUsage = sumTokenUsage(last30Days.slice(-7));
  const last30DaysUsage = sumTokenUsage(last30Days);
  const selectedDays = last30Days.slice(-statsRangeDays);
  const selectedUsage = sumTokenUsage(selectedDays);
  const selectedRange =
    STATS_RANGE_OPTIONS.find((range) => range.days === statsRangeDays) ?? STATS_RANGE_OPTIONS[2];
  const readableAccounts = accountUsage.accounts.filter((account) => !account.error).length;
  const accountValue =
    readableAccounts === accountUsage.accounts.length
      ? String(readableAccounts)
      : `${readableAccounts}/${accountUsage.accounts.length}`;

  return `
    <section class="dashboard-panel">
      <div class="metric-grid">
        ${renderMetricCard("Aujourd'hui", formatTokens(todayUsage.totalTokens), `${formatTokens(todayUsage.inputTokens)} entrée · ${formatTokens(todayUsage.outputTokens)} sortie`, "tous comptes", "calendar-clock")}
        ${renderMetricCard("7 derniers jours", formatTokens(last7DaysUsage.totalTokens), `${formatTokens(last7DaysUsage.totalTokens / 7)} tokens / jour`, "cumul", "bar-chart-3")}
        ${renderMetricCard("30 derniers jours", formatTokens(last30DaysUsage.totalTokens), formatUsd(last30DaysUsage.costUsd), "cumul", "bar-chart-3")}
        ${renderMetricCard("Comptes additionnés", accountValue, `${accountUsage.totalSessions} sessions analysées`, "source Codex", "users")}
      </div>

      <section class="usage-chart-card">
        <div class="dashboard-card-head">
          <div>
            <strong>Total des tokens utilisés</strong>
            <span>${escapeHtml(selectedRange.label)} · ${formatTokens(selectedUsage.totalTokens)} tokens · tous les comptes additionnés</span>
          </div>
          <div class="dashboard-segment" role="group" aria-label="Période du graphique">
            ${STATS_RANGE_OPTIONS.map(
              (range) => `
                <button
                  class="${range.days === statsRangeDays ? "active" : ""}"
                  data-stats-range="${range.days}"
                  aria-pressed="${range.days === statsRangeDays ? "true" : "false"}"
                >${escapeHtml(range.label)}</button>
              `,
            ).join("")}
          </div>
        </div>
        ${renderUsageAreaChart(selectedDays)}
        <p class="usage-chart-note">Chaque point correspond au total journalier de tous les comptes configurés.</p>
      </section>

      <div class="dashboard-table-toolbar">
        <div class="dashboard-table-actions">
          <button id="dashboardRefresh"><i data-lucide="refresh-ccw"></i><span>Actualiser</span></button>
        </div>
      </div>

      <div class="usage-table-wrap">
        <table class="usage-table">
          <thead>
            <tr>
              <th>Jour</th>
              <th>Tokens</th>
              <th>Entrée</th>
              <th>Cache</th>
              <th>Sortie</th>
              <th>Coût estimé</th>
            </tr>
          </thead>
          <tbody>
            ${[...selectedDays].reverse().map(renderTokenUsageDayRow).join("")}
          </tbody>
        </table>
      </div>

      ${renderAccountUsagePanel()}
    </section>
  `;
};

const renderAccountUsagePanel = () => {
  if (!accountUsageLoaded) {
    return `
      <section class="account-usage-card">
        <div class="dashboard-card-head">
          <div><strong>Tokens par compte</strong><span>Lecture des sessions Codex…</span></div>
        </div>
      </section>
    `;
  }

  const data = accountUsage;
  if (!data || data.accounts.length === 0) {
    return `
      <section class="account-usage-card">
        <div class="dashboard-card-head">
          <div><strong>Tokens par compte</strong><span>Aucune session Codex trouvee</span></div>
          <div class="dashboard-table-actions">
            <button id="accountUsageRefresh"><i data-lucide="refresh-ccw"></i><span>Actualiser</span></button>
          </div>
        </div>
      </section>
    `;
  }

  return `
    <section class="account-usage-card">
      <div class="dashboard-card-head">
        <div>
          <strong>Tokens par compte</strong>
          <span>${data.accounts.length} compte(s) · ${escapeHtml(formatTokens(data.totalTokens))} tokens · ${data.totalSessions} sessions · ${escapeHtml(formatUsd(data.totalCostUsd))}</span>
        </div>
        <div class="dashboard-table-actions">
          <button id="accountUsageRefresh"><i data-lucide="refresh-ccw"></i><span>Actualiser</span></button>
        </div>
      </div>
      <div class="usage-table-wrap">
        <table class="usage-table">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Sessions</th>
              <th>Total tokens</th>
              <th>Entree</th>
              <th>Cache</th>
              <th>Sortie</th>
              <th>Cout total</th>
              <th>Ce mois</th>
              <th>Derniere activite</th>
            </tr>
          </thead>
          <tbody>
            ${data.accounts.map(renderAccountUsageRow).join("")}
          </tbody>
        </table>
      </div>
      <p class="account-usage-hint">Reconstruit depuis les sessions Codex actives et archivées. Le coût est une estimation.</p>
    </section>
  `;
};

const renderAccountUsageRow = (account: AccountUsageView) => {
  if (account.error) {
    return `
      <tr class="muted">
        <td><div class="limit-account"><strong>${escapeHtml(account.label)}</strong><small>${escapeHtml(account.codexHome)}</small></div></td>
        <td colspan="8"><small class="limit-error">${escapeHtml(account.error)}</small></td>
      </tr>
    `;
  }

  return `
    <tr class="${account.totalTokens > 0 ? "" : "muted"}">
      <td>
        <div class="limit-account">
          <strong>${escapeHtml(account.label)}${account.hasTokens ? "" : " <small>(deconnecte)</small>"}</strong>
          <small>${escapeHtml(account.codexHome)}</small>
        </div>
      </td>
      <td>${account.sessionCount}</td>
      <td>${escapeHtml(formatTokens(account.totalTokens))}</td>
      <td>${escapeHtml(formatTokens(account.inputTokens))}</td>
      <td>${escapeHtml(formatTokens(account.cachedInputTokens))}</td>
      <td>${escapeHtml(formatTokens(account.outputTokens))}</td>
      <td>${escapeHtml(formatUsd(account.costUsd))}</td>
      <td>${escapeHtml(formatTokens(account.monthTokens))}${account.monthCostUsd > 0 ? `<small>${escapeHtml(formatUsd(account.monthCostUsd))}</small>` : ""}</td>
      <td>${account.lastActivity ? escapeHtml(formatTimestamp(account.lastActivity)) : "n/a"}</td>
    </tr>
  `;
};

const renderMetricCard = (label: string, value: string, detail: string, badge: string, icon: string) => `
  <div class="metric-card">
    <div class="metric-card-top">
      <span>${escapeHtml(label)}</span>
      <em><i data-lucide="${icon}"></i>${escapeHtml(badge)}</em>
    </div>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(detail)}</small>
  </div>
`;

const renderUsageAreaChart = (days: DailyTokenUsage[]) => {
  const chartDays = days.length > 0 ? days : [];
  if (chartDays.length === 0) {
    return `<div class="usage-area-chart empty">Aucune donnee</div>`;
  }

  const width = 960;
  const height = 270;
  const padLeft = 78;
  const padRight = 24;
  const padTop = 34;
  const padBottom = 42;
  const bottom = height - padBottom;
  const right = width - padRight;
  const innerWidth = right - padLeft;
  const actualMaxTokens = Math.max(0, ...chartDays.map((day) => day.totalTokens));
  const scaleMaxTokens = Math.max(1, actualMaxTokens);
  const points = chartDays.map((day, index) => {
    const x =
      padLeft +
      (chartDays.length === 1 ? innerWidth / 2 : (index / (chartDays.length - 1)) * innerWidth);
    const y = bottom - (day.totalTokens / scaleMaxTokens) * (bottom - padTop);
    return { day, x, y };
  });
  const linePath =
    points.length === 1
      ? `M ${padLeft} ${points[0].y.toFixed(2)} L ${right} ${points[0].y.toFixed(2)}`
      : points
          .map(
            (point, index) =>
              `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
          )
          .join(" ");
  const areaPath = `${linePath} L ${right} ${bottom} L ${padLeft} ${bottom} Z`;
  const gridLines = [0, 1, 2, 3].map((step) => {
    const y = padTop + ((bottom - padTop) / 3) * step;
    const tokenValue = actualMaxTokens === 0 ? 0 : actualMaxTokens * (1 - step / 3);
    return `
      <line x1="${padLeft}" y1="${y.toFixed(2)}" x2="${right}" y2="${y.toFixed(2)}" />
      <text x="${padLeft - 12}" y="${(y + 4).toFixed(2)}" text-anchor="end">${escapeHtml(formatCompactTokens(tokenValue))}</text>
    `;
  });
  const labelStep = Math.max(1, Math.ceil(chartDays.length / 7));
  const labels = points
    .filter((_, index) => index % labelStep === 0 || index === points.length - 1)
    .map(
      (point) =>
        `<text x="${point.x.toFixed(2)}" y="${height - 11}" text-anchor="middle">${escapeHtml(formatDayLabel(point.day.date))}</text>`,
    );
  const valueLabels =
    points.length <= 7
      ? points.map(
          (point) =>
            `<text x="${point.x.toFixed(2)}" y="${Math.max(padTop + 14, point.y - 11).toFixed(2)}" text-anchor="middle">${escapeHtml(formatCompactTokens(point.day.totalTokens))}</text>`,
        )
      : [];

  return `
    <div class="usage-area-chart">
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Total des tokens utilisés par tous les comptes">
        <title>Total journalier des tokens utilisés par tous les comptes</title>
        <g class="chart-grid chart-y-labels">${gridLines.join("")}</g>
        <path class="chart-area" d="${areaPath}"></path>
        <path class="chart-line" d="${linePath}"></path>
        <g class="chart-points">${points
          .map(
            (point) => `
              <circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="3.5">
                <title>${escapeHtml(formatDayLabel(point.day.date))} : ${escapeHtml(formatTokens(point.day.totalTokens))} tokens</title>
              </circle>
            `,
          )
          .join("")}</g>
        <g class="chart-value-labels">${valueLabels.join("")}</g>
        <g class="chart-labels">${labels.join("")}</g>
      </svg>
    </div>
  `;
};

const renderTokenUsageDayRow = (day: DailyTokenUsage) => `
  <tr>
    <td>${escapeHtml(formatDayLabel(day.date))}</td>
    <td>${escapeHtml(formatTokens(day.totalTokens))}</td>
    <td>${escapeHtml(formatTokens(day.inputTokens))}</td>
    <td>${escapeHtml(formatTokens(day.cachedInputTokens))}</td>
    <td>${escapeHtml(formatTokens(day.outputTokens))}</td>
    <td>${escapeHtml(formatUsd(day.costUsd))}</td>
  </tr>
`;

const formatDuration = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  if (days > 0) return `${days}j ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${secs}s`;
  return `${secs}s`;
};

const formatTokens = (value: number) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.max(0, Math.round(value)));

const formatCompactTokens = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Math.max(0, Math.round(value)));

const formatUsd = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value > 0 && value < 1 ? 4 : 2,
    maximumFractionDigits: value > 0 && value < 1 ? 4 : 2,
  }).format(Number.isFinite(value) ? value : 0);

const formatDayLabel = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
  }).format(parsed);
};

const formatFullDayLabel = (date: string) => {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const formatted = new Intl.DateTimeFormat("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(parsed);
  return `${formatted.charAt(0).toLocaleUpperCase("fr-FR")}${formatted.slice(1)}`;
};

const defaultCodexHomeForLabel = (label: string, provider: Provider = "codex") => {
  const slug =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "account";
  if (isRemoteMode()) {
    return `${userHomeHint()}/${provider === "claude" ? "claude-" : ""}${slug}`;
  }
  // Home isole par compte : `.codex-<slug>` (CODEX_HOME) ou `.claude-<slug>`
  // (CLAUDE_CONFIG_DIR).
  const prefix = provider === "claude" ? ".claude-" : ".codex-";
  return `${userHomeHint()}\\${prefix}${slug}`;
};

const normalizeCodexHome = (value: string) => value.trim().replaceAll("/", "\\").toLowerCase();

const uniqueCodexHomeForLabel = (label: string, provider: Provider = "codex") => {
  const used = new Set((settings?.accounts ?? []).map((account) => normalizeCodexHome(account.codexHome)));
  let candidate = defaultCodexHomeForLabel(label, provider);
  if (!used.has(normalizeCodexHome(candidate))) return candidate;

  for (let index = 2; index < 1000; index += 1) {
    candidate = defaultCodexHomeForLabel(`${label}-${index}`, provider);
    if (!used.has(normalizeCodexHome(candidate))) return candidate;
  }

  return defaultCodexHomeForLabel(`${label}-${Date.now().toString(36)}`, provider);
};

type NewAccountPreferences = {
  provider?: Provider;
  bypass?: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
};

const newAccountProfile = (
  label: string,
  codexHome: string | undefined = undefined,
  projectDir: string | null = null,
  proxyId: string | null = null,
  preferences: NewAccountPreferences = {},
): AccountProfile => {
  const provider = preferences.provider ?? "codex";
  return {
    id: uid("account"),
    label,
    createdAt: Math.floor(Date.now() / 1_000),
    provider,
    codexHome: codexHome ?? defaultCodexHomeForLabel(label, provider),
    projectDir,
    proxyId,
    startupCommand: null,
    bypass: preferences.bypass ?? settings?.codexBypass ?? true,
    model: preferences.model?.trim() || providerDefaultModel(provider),
    // L'intensite de raisonnement ne concerne que Codex ; on la laisse par
    // defaut pour Claude (le backend l'ignore).
    reasoningEffort: normalizeCodexReasoningEffort(preferences.reasoningEffort),
  };
};

const refreshPoolAfterAccountChange = async (message: string) => {
  if (poolStatus?.running) {
    poolStatus = await invoke<PoolStatus>("pool_start");
    startPoolPoll();
  } else {
    poolStatus = await invoke<PoolStatus>("pool_status");
  }

  statusText = message;
  render();
};

const readPoolNewAccountForm = () => {
  poolNewAccountLabel =
    document.querySelector<HTMLInputElement>("#poolNewAccountLabel")?.value.trim() ?? poolNewAccountLabel;
  poolNewAccountProxyId =
    document.querySelector<HTMLSelectElement>("#poolNewAccountProxy")?.value ?? poolNewAccountProxyId;
  poolNewAccountBypass =
    document.querySelector<HTMLInputElement>("#poolNewAccountBypass")?.checked ?? poolNewAccountBypass;
  poolNewAccountModel =
    document.querySelector<HTMLInputElement>("#poolNewAccountModel")?.value.trim() ||
    poolNewAccountModel ||
    DEFAULT_CODEX_MODEL;
  poolNewAccountReasoningEffort = normalizeCodexReasoningEffort(
    document.querySelector<HTMLSelectElement>("#poolNewAccountReasoningEffort")?.value ??
      poolNewAccountReasoningEffort,
  );
};

const clearPoolNewAccountForm = () => {
  poolNewAccountLabel = "";
  poolNewAccountProxyId = "";
  poolNewAccountBypass = settings?.codexBypass ?? true;
  poolNewAccountModel = DEFAULT_CODEX_MODEL;
  poolNewAccountReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT;
};

const addPoolAccount = async () => {
  if (!settings) return;
  readPoolForm();
  readPoolNewAccountForm();

  const label = poolNewAccountLabel || "Nouveau compte";
  const codexHome = uniqueCodexHomeForLabel(label);
  const proxyId = settings.proxyControlsEnabled ? poolNewAccountProxyId || null : null;

  try {
    const account = newAccountProfile(label, codexHome, null, proxyId, {
      bypass: poolNewAccountBypass,
      model: poolNewAccountModel,
      reasoningEffort: poolNewAccountReasoningEffort,
    });
    // Provisionne les permissions des la creation. Sans cela, le compte etait
    // marque bypass dans settings.json mais son config.toml ne l'etait qu'au
    // premier lancement d'un terminal.
    await provisionAccountHome(account);
    settings.accounts.push(account);
    settings.defaultAccountId = account.id;
    selectedAccountId = account.id;
    settings = await invoke<AppSettings>("save_settings", { settings });
    scheduleUnconnectedAccountCleanup();
    clearPoolNewAccountForm();
    await refreshPoolAfterAccountChange(`Compte ${label} ajoute au pool`);
  } catch (error) {
    statusText = String(error);
    render();
  }
};

const startNewChatWithPrompt = async (
  pane: ExpertChatPane,
  prompt: string,
): Promise<void> => {
  let root = expertChatPaneRoot(pane);
  if (!root) {
    await waitForFrame();
    root = expertChatPaneRoot(pane);
  }
  if (root && await sendExpertChatMessage(pane, root, prompt)) return;

  // En cas de rendu tardif ou d'indisponibilité ponctuelle du compte, ne pas
  // perdre la tâche : elle reste prête dans le compositeur du nouveau chat.
  pane.draft = prompt;
  persistExpertChats();
  if (activeView === "chat") refreshExpertChatPane(pane);
  focusExpertChatPrompt(pane);
};

const executeScheduledChatItem = async (item: ScheduledChatItem): Promise<void> => {
  if (!settings) throw new Error("Les paramètres de l’application ne sont pas chargés.");
  const environmentPath = userEnvironmentPath(item.environmentPath);
  if (!environmentPath) throw new Error("L’environnement associé à ce chat n’est plus disponible.");
  const account = accountById(item.accountId)
    ?? accountById(settings.defaultAccountId)
    ?? settings.accounts[0]
    ?? null;
  if (!account) throw new Error("Aucun compte agent n’est disponible pour lancer ce chat.");

  setCurrentWorkspace(environmentPath);
  setChatWorkspaceFilter(workspaceIdForPath(environmentPath));
  terminalFolderFilter = environmentPath;
  void upsertWorkspaceRegistry(environmentPath);
  const pane = addExpertChatPane(account.id, {
    mode: item.mode,
    pendingWorkspace: environmentPath,
  });
  if (!pane) throw new Error("Le nouveau chat n’a pas pu être créé.");
  await startNewChatWithPrompt(pane, item.prompt);
};

const stopScheduledChatScheduler = (): void => {
  scheduledChatSchedulerStarted = false;
  if (scheduledChatTimer !== null) {
    window.clearTimeout(scheduledChatTimer);
    scheduledChatTimer = null;
  }
};

const armScheduledChatTimer = (): void => {
  if (scheduledChatTimer !== null) {
    window.clearTimeout(scheduledChatTimer);
    scheduledChatTimer = null;
  }
  if (!scheduledChatSchedulerStarted) return;
  const nextAt = nextScheduledChatAt(loadScheduledChatItems());
  if (nextAt === null) return;
  // Une vérification au plus tard chaque minute absorbe les changements
  // d’horloge et le réveil d’un ordinateur, tout en déclenchant précisément
  // lorsque l’échéance se trouve dans la minute courante.
  const delay = Math.min(60_000, Math.max(0, nextAt - Date.now()));
  scheduledChatTimer = window.setTimeout(() => {
    scheduledChatTimer = null;
    void dispatchDueScheduledChats();
  }, delay);
};

const dispatchDueScheduledChats = async (): Promise<void> => {
  if (!scheduledChatSchedulerStarted || scheduledChatDispatchInFlight || !settings) return;
  scheduledChatDispatchInFlight = true;
  try {
    let due = dueScheduledChatItems(loadScheduledChatItems());
    while (due.length) {
      const item = due[0];
      const claimedItems = claimScheduledChatItem(loadScheduledChatItems(), item.id);
      const claimed = claimedItems.find((candidate) => candidate.id === item.id);
      if (!claimed || claimed.status !== "launching") {
        due = dueScheduledChatItems(loadScheduledChatItems());
        continue;
      }
      if (!persistScheduledChatItems(claimedItems)) {
        statusText = `Impossible d’enregistrer le lancement de « ${scheduledChatTitle(item)} »`;
        break;
      }
      syncScheduledChatNavigationBadges(claimedItems);

      try {
        await executeScheduledChatItem(claimed);
        const launched = markScheduledChatLaunched(loadScheduledChatItems(), item.id);
        persistScheduledChatItems(launched);
        syncScheduledChatNavigationBadges(launched);
        statusText = `Chat planifié lancé : ${scheduledChatTitle(item)}`;
      } catch (error) {
        const failed = markScheduledChatFailed(loadScheduledChatItems(), item.id, error);
        persistScheduledChatItems(failed);
        syncScheduledChatNavigationBadges(failed);
        statusText = `Échec du chat planifié : ${String(error)}`;
        if (activeView === "scheduled-chat") render();
      }

      due = dueScheduledChatItems(loadScheduledChatItems());
    }
  } finally {
    scheduledChatDispatchInFlight = false;
    armScheduledChatTimer();
  }
};

const startScheduledChatScheduler = (): void => {
  if (scheduledChatSchedulerStarted) {
    armScheduledChatTimer();
    return;
  }
  scheduledChatSchedulerStarted = true;
  const current = loadScheduledChatItems();
  // Un statut « lancement » ne peut pas survivre à un redémarrage du frontend :
  // il redevient une erreur explicite et relançable au lieu de rester bloqué.
  const recovered = recoverInterruptedScheduledChats(current, Date.now(), 0);
  if (JSON.stringify(recovered) !== JSON.stringify(current)) {
    persistScheduledChatItems(recovered);
  }
  syncScheduledChatNavigationBadges(recovered);
  void dispatchDueScheduledChats();
};

const cancelNewChatBestQuotaRequest = () => {
  newChatBestQuotaRequestId += 1;
  newChatBestQuotaInFlight = false;
};

const setNewChatBestQuotaButtonBusy = (busy: boolean) => {
  const button = document.querySelector<HTMLButtonElement>("#confirmBestQuotaNewChat");
  if (!button) return;
  button.disabled = busy
    || !settings?.accounts.length
    || !userEnvironmentPath(newChatPendingWorkspace ?? currentWorkspace());
  button.setAttribute("aria-busy", String(busy));
  const label = button.querySelector<HTMLElement>("span");
  if (label) {
    label.textContent = busy
      ? "Recherche…"
      : newChatPendingTaskTitle ? "Lancer avec le plus de tokens" : "Ouvrir avec le plus de tokens";
  }
};

const setNewChatAutoStatus = (message: string) => {
  const status = document.querySelector<HTMLElement>("#newChatAutoStatus span");
  if (status) status.textContent = message;
};

const confirmNewChatWithBestQuota = async (): Promise<void> => {
  if (!settings || newChatBestQuotaInFlight) return;
  const requestId = ++newChatBestQuotaRequestId;
  newChatBestQuotaInFlight = true;
  setNewChatBestQuotaButtonBusy(true);
  setNewChatAutoStatus("Lecture des quotas disponibles…");

  try {
    await refreshLimitStatus(true);
    if (
      requestId !== newChatBestQuotaRequestId
      || !newChatModalOpen
      || !settings
    ) {
      return;
    }

    const best = bestQuotaAccountForNewChat(
      limitStatus,
      settings.accounts.map((account) => account.id),
      openChatAccountIdsForQuotaSelection(),
    );
    if (!best) {
      const message = "Aucun compte connecté n’expose assez de quota pour un choix automatique.";
      statusText = message;
      setNewChatAutoStatus(message);
      return;
    }

    selectNewChatAccount(best.account.id);
    const reservation = best.openChatCount > 0
      ? ` après ${Math.round(best.reservedPercent)} % réservés pour ${best.openChatCount} chat${best.openChatCount > 1 ? "s" : ""} ouvert${best.openChatCount > 1 ? "s" : ""}`
      : "";
    setNewChatAutoStatus(
      `${best.account.label} sélectionné : ${Math.round(best.effectiveRemainingPercent)} % disponibles${reservation}.`,
    );
    confirmNewChatModal();
  } finally {
    if (requestId === newChatBestQuotaRequestId) {
      newChatBestQuotaInFlight = false;
      if (newChatModalOpen) setNewChatBestQuotaButtonBusy(false);
    }
  }
};

const openNewChatModal = (
  options: {
    workspacePath?: string | null;
    accountId?: string | null;
    task?: Pick<TaskItem, "title"> | null;
    prompt?: string | null;
  } = {},
) => {
  if (!settings) return;
  cancelNewChatBestQuotaRequest();
  const environmentPath = userEnvironmentPath(options.workspacePath ?? currentWorkspace());
  if (!environmentPath) {
    // Pas d'environnement isole : on conserve le garde-fou existant.
    openTerminalEnvironmentMenu();
    return;
  }
  newChatPendingWorkspace = environmentPath;
  const requestedAccountId = accountById(options.accountId)?.id ?? null;
  newChatAccountId = requestedAccountId ??
    selectedAccountId ?? settings.defaultAccountId ?? settings.accounts[0]?.id ?? null;
  newChatModel = accountModel(accountById(newChatAccountId));
  newChatModelDrafts.clear();
  if (newChatAccountId) newChatModelDrafts.set(newChatAccountId, newChatModel);
  newChatMode = "build";
  newChatPendingTaskTitle = options.task?.title.trim() || null;
  const storedPrompt = options.prompt?.trim() || null;
  newChatPendingPrompt = storedPrompt ?? (newChatPendingTaskTitle
    ? `Exécute cette tâche dans l’environnement courant :\n\n${newChatPendingTaskTitle}`
    : null);
  newChatPendingPromptAutoSend = !storedPrompt && !!newChatPendingTaskTitle;
  rememberDialogTrigger("new-chat", null);
  newChatModalOpen = true;
  statusText = newChatPendingTaskTitle
    ? "Choisis le compte, le modèle et le mode pour exécuter cette tâche"
    : storedPrompt
      ? "Choisis le compte, le modèle et le mode pour utiliser ce prompt"
    : "Choisis le compte, le modele et le mode de ce chat";
  render();
  void refreshLimitStatus(true);
  if (!window.matchMedia("(max-width: 860px)").matches) {
    window.setTimeout(() => {
      document.querySelector<HTMLInputElement>("#newChatModel")?.focus();
    }, 0);
  }
};

const closeNewChatModal = () => {
  if (!newChatModalOpen) return;
  const returnFocus = takeDialogTrigger("new-chat");
  cancelNewChatBestQuotaRequest();
  newChatModalOpen = false;
  newChatPendingTaskTitle = null;
  newChatPendingPrompt = null;
  newChatPendingPromptAutoSend = false;
  newChatModelDrafts.clear();
  render();
  restoreDialogTrigger(returnFocus);
};

const confirmNewChatModal = () => {
  if (!settings) return;
  cancelNewChatBestQuotaRequest();
  const account = accountById(newChatAccountId) ?? settings.accounts[0] ?? null;
  if (!account) {
    statusText = "Ajoute d'abord un compte agent";
    render();
    return;
  }
  const modelInput = document.querySelector<HTMLInputElement>("#newChatModel");
  const modeSelect = document.querySelector<HTMLSelectElement>("#newChatMode");
  const requestedModel = (modelInput?.value ?? newChatModel).trim();
  if (requestedModel.length > 160 || /\s/.test(requestedModel)) {
    modelInput?.setCustomValidity(
      "Le nom du modele doit faire 160 caracteres maximum et ne contenir aucun espace",
    );
    modelInput?.reportValidity();
    statusText = "Nom de modele invalide";
    return;
  }
  const mode = (modeSelect?.value as ChatMode) || newChatMode;
  const previousModel = accountModel(account);
  const nextModel = requestedModel || previousModel;
  if (nextModel !== previousModel) {
    account.model = nextModel;
    persistChatPreferences(account.id);
  }
  selectedAccountId = account.id;
  const pendingWorkspace = newChatPendingWorkspace;
  const pendingPrompt = newChatPendingPrompt;
  const pendingPromptAutoSend = newChatPendingPromptAutoSend;
  forgetDialogTrigger("new-chat");
  newChatModalOpen = false;
  newChatPendingTaskTitle = null;
  newChatPendingPrompt = null;
  newChatPendingPromptAutoSend = false;
  newChatModelDrafts.clear();
  const pane = addExpertChatPane(account.id, { mode, pendingWorkspace });
  if (pane && pendingPrompt) {
    if (pendingPromptAutoSend) {
      void startNewChatWithPrompt(pane, pendingPrompt);
    } else {
      pane.draft = pendingPrompt;
      persistExpertChats();
      refreshExpertChatPane(pane);
      focusExpertChatPrompt(pane);
    }
  }
  void loadChatModelCatalog(account.id);
};

const openNewTerminalModal = (folderPath: string | null | undefined = undefined) => {
  if (!settings) return;
  if (terminalSessions.length >= EXPERT_MAX_TERMINALS) {
    statusText = `Limite atteinte: ${EXPERT_MAX_TERMINALS} terminaux maximum dans une fenetre`;
    render();
    return;
  }
  newTerminalAccountId = selectedAccountId || settings.defaultAccountId || settings.accounts[0]?.id || null;
  newTerminalAgentId = settings.activeAgentId || settings.agents[0]?.id || null;
  newTerminalWorkspacePath =
    folderPath === undefined ? null : userEnvironmentPath(folderPath);
  newTerminalAccountLabel = "";
  newTerminalAccountBypass = settings.codexBypass ?? true;
  newTerminalAccountModel = DEFAULT_CODEX_MODEL;
  newTerminalAccountReasoningEffort = DEFAULT_CODEX_REASONING_EFFORT;
  rememberDialogTrigger("new-terminal", "folderNewTerminal");
  newTerminalModalOpen = true;
  statusText = "Choisis obligatoirement l'environnement, puis l'agent et le compte";
  render();
};

const closeNewTerminalModal = () => {
  const returnFocus = takeDialogTrigger("new-terminal");
  newTerminalModalOpen = false;
  render();
  restoreDialogTrigger(returnFocus);
};

const openAgentsModal = () => {
  if (!settings) return;
  rememberDialogTrigger("agents", "manageAgents");
  agentsModalOpen = true;
  statusText = "Gestion des agents";
  render();
};

const closeAgentsModal = () => {
  const returnFocus = takeDialogTrigger("agents");
  agentsModalOpen = false;
  render();
  restoreDialogTrigger(returnFocus);
};

const readAgentsModalForm = () => {
  if (!settings) return;
  document.querySelectorAll<HTMLElement>("[data-agent-id]").forEach((element) => {
    const input = element as HTMLInputElement | HTMLSelectElement;
    const id = input.dataset.agentId;
    const field = input.dataset.agentField;
    const agent = settings?.agents.find((candidate) => candidate.id === id);
    if (!agent || !field) return;
    if (field === "label") {
      const value = input.value.trim();
      if (value || !agent.builtin) agent.label = value || agent.label;
    } else if (field === "command") {
      agent.command = input.value.trim();
    } else if (field === "kind" && !agent.builtin) {
      agent.kind = input.value === "ide" ? "ide" : "cli";
    }
  });
};

const addAgent = () => {
  if (!settings) return;
  readAgentsModalForm();
  settings.agents.push({
    id: uid("agent"),
    label: "Nouvel agent",
    command: "",
    kind: "cli",
    builtin: false,
    loginCommand: null,
    statusCommand: null,
    doctorCommand: null,
  });
  statusText = "Agent ajoute";
  render();
};

const removeAgent = (id: string | null) => {
  if (!settings || !id) return;
  const agent = settings.agents.find((candidate) => candidate.id === id);
  if (!agent || agent.builtin) return;
  readAgentsModalForm();
  settings.agents = settings.agents.filter((candidate) => candidate.id !== id);
  if (settings.activeAgentId === id) {
    settings.activeAgentId = settings.agents[0]?.id ?? null;
  }
  statusText = "Agent supprime";
  render();
};

const saveAgentsModal = async () => {
  if (!settings) return;
  readAgentsModalForm();
  // Un agent non integre sans commande ne peut pas etre lance : on l'ecarte
  // pour eviter qu'un "run" retombe silencieusement sur Codex.
  settings.agents = settings.agents.filter((agent) => agent.builtin || agent.command.trim());
  forgetDialogTrigger("agents");
  agentsModalOpen = false;
  await saveSettings();
};

const readNewTerminalModalForm = () => {
  if (!settings || !newTerminalAccountId) return null;
  const account = settings.accounts.find((candidate) => candidate.id === newTerminalAccountId);
  if (!account) return null;

  newTerminalWorkspacePath =
    document.querySelector<HTMLInputElement>("#newTerminalWorkspace")?.value.trim() || null;

  account.codexHome =
    document.querySelector<HTMLInputElement>("#newTerminalCodexHome")?.value.trim() ||
    account.codexHome ||
    defaultCodexHomeForLabel(account.label);
  account.projectDir =
    document.querySelector<HTMLInputElement>("#newTerminalProjectDir")?.value.trim() || null;
  if (settings.proxyControlsEnabled) {
    account.proxyId = document.querySelector<HTMLSelectElement>("#newTerminalProxy")?.value || null;
  }
  account.model =
    document.querySelector<HTMLInputElement>("#newTerminalModel")?.value.trim() ||
    accountModel(account);
  account.reasoningEffort = normalizeCodexReasoningEffort(
    document.querySelector<HTMLSelectElement>("#newTerminalReasoningEffort")?.value ??
      account.reasoningEffort,
  );
  account.bypass =
    document.querySelector<HTMLInputElement>("#newTerminalBypass")?.checked ??
    accountBypassEnabled(account);
  const agentSelect = document.querySelector<HTMLSelectElement>("#newTerminalAgent");
  if (agentSelect) newTerminalAgentId = agentSelect.value || newTerminalAgentId;
  settings.autoRunCodex = document.querySelector<HTMLInputElement>("#newTerminalAutoRun")?.checked ?? settings.autoRunCodex;
  return account;
};

const readNewTerminalAccountDraft = () => {
  newTerminalAccountLabel =
    document.querySelector<HTMLInputElement>("#newTerminalAccountLabel")?.value.trim() ??
    newTerminalAccountLabel;
  const providerValue = document.querySelector<HTMLSelectElement>("#newAccountProvider")?.value;
  newTerminalAccountProvider = providerValue === "claude" ? "claude" : "codex";
  newTerminalAccountBypass =
    document.querySelector<HTMLInputElement>("#newAccountBypass")?.checked ??
    newTerminalAccountBypass;
  newTerminalAccountModel =
    document.querySelector<HTMLInputElement>("#newAccountModel")?.value.trim() ||
    newTerminalAccountModel ||
    DEFAULT_CODEX_MODEL;
  newTerminalAccountReasoningEffort = normalizeCodexReasoningEffort(
    document.querySelector<HTMLSelectElement>("#newAccountReasoningEffort")?.value ??
      newTerminalAccountReasoningEffort,
  );
};

const addAccountFromModal = () => {
  if (!settings) return;
  readNewTerminalAccountDraft();
  const label = newTerminalAccountLabel;
  if (!label) {
    statusText = "Nom de compte manquant";
    render();
    return;
  }

  // Si l'utilisateur passe en Claude sans toucher au champ modele (encore sur le
  // defaut Codex), on laisse le defaut Claude s'appliquer plutot que d'heriter
  // d'un modele Codex incoherent.
  const model =
    newTerminalAccountProvider === "claude" && newTerminalAccountModel === DEFAULT_CODEX_MODEL
      ? null
      : newTerminalAccountModel;
  const account = newAccountProfile(label, undefined, null, null, {
    provider: newTerminalAccountProvider,
    bypass: newTerminalAccountBypass,
    model,
    reasoningEffort: newTerminalAccountReasoningEffort,
  });
  settings.accounts.push(account);
  scheduleUnconnectedAccountCleanup();
  selectedAccountId = account.id;
  newTerminalAccountId = account.id;
  newTerminalAccountLabel = "";
  const providerNote = providerLabel(accountProvider(account));
  const loginHint =
    account.provider === "claude" ? " — lance-le puis tape /login pour t'authentifier" : "";
  statusText = `Compte ${providerNote} ajoute (${account.bypass ? "bypass" : "sandbox"}, ${account.model})${loginHint}`;
  render();
};

// Depuis la page Comptes : cree un home isole pour le fournisseur choisi,
// persiste le compte, puis ouvre directement sa connexion interactive.
const addAccountAndLogin = async () => {
  if (!settings) return;
  const submitButton = document.querySelector<HTMLButtonElement>("#addAccount");
  if (submitButton?.disabled) return;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.setAttribute("aria-busy", "true");
  }
  const providerValue = document.querySelector<HTMLInputElement>(
    'input[name="newAccountProvider"]:checked',
  )?.value;
  const provider: Provider = providerValue === "claude" ? "claude" : "codex";
  const requestedLabel =
    document.querySelector<HTMLInputElement>("#newAccountLabel")?.value.trim() ?? "";
  const label = requestedLabel || `Nouveau compte ${providerLabel(provider)}`;
  const account = newAccountProfile(
    label,
    uniqueCodexHomeForLabel(label, provider),
    null,
    null,
    { provider },
  );
  settings.accounts.push(account);
  selectedAccountId = account.id;
  settings.defaultAccountId = account.id;
  try {
    settings = await invoke<AppSettings>("save_settings", { settings });
    scheduleUnconnectedAccountCleanup();
  } catch (error) {
    statusText = String(error);
    render();
    return;
  }
  render();
  // Ouvre directement le terminal temporaire de connexion du compte.
  await reloginAccount(account.id);
};

// Suppression depuis la liste simple. Avec l'auto-detection active, les fichiers
// locaux doivent aussi partir pour eviter que le compte reapparaisse au prochain
// chargement. Un seul dialogue confirme toute l'operation.
const deleteSelectedAccount = async () => {
  if (!settings || !selectedAccountId) return;
  const id = selectedAccountId;
  const target = settings.accounts.find((account) => account.id === id);
  const label = target?.label ?? "";
  if (!target) return;

  const deleteFiles = settings.autoDiscoverAccounts;
  const confirmed = window.confirm(
    deleteFiles
      ? `Supprimer « ${label} » et ses données de connexion locales ?\n\nCette action est définitive.`
      : `Supprimer le compte « ${label} » ?`,
  );
  if (!confirmed) return;

  try {
    settings = await invoke<AppSettings>("remove_account", { accountId: id, deleteFiles });
    statusText = deleteFiles
      ? `Compte « ${label} » supprimé (fichiers effacés)`
      : `Compte « ${label} » supprimé`;
  } catch (error) {
    // Un compte cree dans une autre vue peut encore n'exister qu'en memoire.
    // Pour toute autre erreur (dossier protege, verrouille…), on ne contourne
    // jamais les garde-fous du backend.
    if (!/Compte introuvable/i.test(String(error))) {
      statusText = String(error);
      render();
      return;
    }
    settings.accounts = settings.accounts.filter((account) => account.id !== id);
    if (settings.defaultAccountId === id) {
      settings.defaultAccountId = settings.accounts[0]?.id ?? null;
    }
    try {
      settings = await invoke<AppSettings>("save_settings", { settings });
      statusText = `Compte « ${label} » retiré`;
    } catch (error) {
      statusText = String(error);
      render();
      return;
    }
  }
  selectedAccountId = settings.defaultAccountId ?? settings.accounts[0]?.id ?? null;
  scheduleUnconnectedAccountCleanup();
  render();
};

const bindUi = () => {
  bindChatSidebarResizer();
  bindDoctolibLabUi();
  mountTasksPanel({
    renderIcons,
    environment: currentTaskEnvironment(),
    onExecuteTask: (task) => {
      if (!task.environmentPath) return;
      openNewChatModal({ workspacePath: task.environmentPath, task });
    },
  });
  mountPromptLibraryPanel({
    renderIcons,
    onUsePrompt: useLibraryPromptInChat,
  });
  mountScheduledChatsPanel({
    ...scheduledChatsPanelOptions(),
    renderIcons,
    onItemsChanged: () => armScheduledChatTimer(),
    onRequestDispatch: () => void dispatchDueScheduledChats(),
  });

  document
    .querySelectorAll<HTMLButtonElement>("#chooseTerminalEnvironment, #chooseEnvironmentFromChat")
    .forEach((button) => {
      button.addEventListener("click", openTerminalEnvironmentMenu);
    });

  document.querySelectorAll<HTMLButtonElement>("[data-environment-menu-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.environmentMenuId;
      const group = terminalEnvironmentGroups().find(
        (candidate) => id && workspaceIdForPath(candidate.path) === id,
      );
      if (!group) return;
      void selectEnvironment(group.path);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-view-environment-memory-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.viewEnvironmentMemoryId;
      const workspace = knownWorkspaces().find((candidate) => candidate.id === id);
      if (workspace) openEnvironmentMemory(workspace);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-delete-environment-id]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteEnvironmentId;
      const workspace = knownWorkspaces().find((candidate) => candidate.id === id);
      if (!workspace) return;
      const memoryWarning = workspace.memory.trim()
        ? "\n\nSa memoire partagee sera egalement effacee."
        : "";
      const confirmed = window.confirm(
        `Supprimer l'environnement « ${workspace.label} » de Switch ?\n\nLe repertoire et ses fichiers resteront sur le disque.${memoryWarning}`,
      );
      if (confirmed) void closeWorkspace(workspace, true);
    });
  });
  document
    .querySelector<HTMLTextAreaElement>("#environmentMemoryInput")
    ?.addEventListener("input", (event) => {
      const input = event.currentTarget as HTMLTextAreaElement;
      environmentMemoryDraftId = environmentMemoryTargetId;
      environmentMemoryDraft = input.value;
      input.setCustomValidity("");
      const count = document.querySelector<HTMLElement>("#environmentMemoryCount");
      if (count) count.textContent = String([...input.value].length);
    });
  document
    .querySelector<HTMLButtonElement>("#saveEnvironmentMemory")
    ?.addEventListener("click", () => void saveEnvironmentMemory());
  document
    .querySelector<HTMLButtonElement>("#closeTerminalEnvironmentMenu")
    ?.addEventListener("click", closeTerminalEnvironmentMenu);
  document
    .querySelector<HTMLButtonElement>("#createEnvironmentFromMenu")
    ?.addEventListener("click", () => {
      forgetDialogTrigger("environment");
      terminalEnvironmentMenuOpen = false;
      clearEnvironmentMemoryDraft();
      render();
      void openWorkspacePicker("active");
    });
  document
    .querySelector<HTMLDivElement>("#terminalEnvironmentMenuBackdrop")
    ?.addEventListener("click", (event) => {
      if (event.target === event.currentTarget) closeTerminalEnvironmentMenu();
    });

  document.querySelector<HTMLSelectElement>("#expertGridLayout")?.addEventListener("change", (event) => {
    const value = (event.currentTarget as HTMLSelectElement).value;
    expertGridLayout = value === "2" || value === "3" || value === "4" ? value : "auto";
    localStorage.setItem(EXPERT_GRID_LAYOUT_STORAGE_KEY, expertGridLayout);
    statusText = expertGridLayout === "auto" ? "Disposition automatique" : `${expertGridLayout} colonnes`;
    render();
  });

  document.querySelector<HTMLSelectElement>("#expertChatPageSize")?.addEventListener("change", (event) => {
    captureAllExpertChatScroll();
    expertChatPageSizeMode = normalizeExpertChatPageSizeMode(
      (event.currentTarget as HTMLSelectElement).value,
    );
    localStorage.setItem(EXPERT_CHATS_PER_PAGE_STORAGE_KEY, String(expertChatPageSizeMode));
    reconcileExpertChatPage();
    statusText = expertChatPageSizeMode === "auto"
      ? `Taille automatique · ${expertChatStatusText()}`
      : `${expertChatPageSizeMode} chats par page · ${expertChatStatusText()}`;
    persistExpertChats();
    render();
    startAllExpertChatWork();
  });

  document.querySelector<HTMLButtonElement>("#expertChatPrevPage")?.addEventListener("click", () => {
    setExpertChatPage(expertChatPage - 1);
  });
  document.querySelector<HTMLButtonElement>("#expertChatNextPage")?.addEventListener("click", () => {
    setExpertChatPage(expertChatPage + 1);
  });

  document.querySelector<HTMLButtonElement>("#expertChatToolbarHide")?.addEventListener("click", () => {
    setExpertChatToolbarHidden(true);
  });
  document.querySelector<HTMLButtonElement>("#expertChatToolbarShow")?.addEventListener("click", () => {
    setExpertChatToolbarHidden(false);
  });

  document.querySelector<HTMLButtonElement>("#addExpertChat")?.addEventListener("click", () => {
    openNewChatModal();
  });
  document.querySelector<HTMLButtonElement>("#emptyNewChat")?.addEventListener("click", () => {
    openNewChatModal();
  });
  document.querySelector<HTMLButtonElement>("#emptyConfigureAccounts")?.addEventListener("click", () => {
    setActiveView("pool");
  });
  document.querySelectorAll<HTMLButtonElement>("[data-add-expert-terminal]").forEach((button) => {
    button.addEventListener("click", () => openNewTerminalModal(terminalFolderFilter ?? undefined));
  });
  document.querySelector<HTMLButtonElement>("#folderNewTerminal")?.addEventListener("click", () => {
    openNewTerminalModal(terminalFolderFilter ?? undefined);
  });
  document.querySelector<HTMLButtonElement>("#folderNewChat")?.addEventListener("click", () => {
    if (terminalFolderFilter) {
      setCurrentWorkspace(terminalFolderFilter);
      setChatWorkspaceFilter(workspaceIdForPath(terminalFolderFilter));
    }
    openNewChat();
  });
  const focusExpertSession = (session: TerminalSession, focus = false) => {
    activateTerminalSession(session);
    statusText = `Terminal actif: ${terminalTitle(session)}`;
    document.querySelectorAll<HTMLElement>("[data-expert-terminal-pane]").forEach((pane) => {
      pane.classList.toggle("active", pane.dataset.expertTerminalPane === session.key);
    });
    document.querySelectorAll<HTMLElement>(".terminal-side-item").forEach((item) => {
      const key = item.querySelector<HTMLElement>("[data-terminal-key]")?.dataset.terminalKey;
      item.classList.toggle("active", key === session.key);
    });
    const title = document.querySelector<HTMLElement>("#expertActiveTitle");
    const meta = document.querySelector<HTMLElement>("#expertActiveMeta");
    if (title) title.textContent = terminalTitle(session);
    if (meta) {
      meta.textContent = `${session.proxySummary} | ${displayProjectDir(session.workspacePath ?? session.folderPath ?? session.projectDir)}`;
    }
    persistTerminalSessions();
    if (focus) session.terminal.focus();
  };

  document.querySelectorAll<HTMLButtonElement>("[data-focus-terminal]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = terminalSessions.find((candidate) => candidate.key === button.dataset.focusTerminal);
      if (session) focusExpertSession(session, true);
    });
  });

  document.querySelectorAll<HTMLElement>("[data-expert-terminal-pane]").forEach((pane) => {
    pane.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest("[data-close-terminal],[data-toggle-chat-sidebar],[data-toggle-terminal-fullscreen]")) return;
      const session = terminalSessions.find(
        (candidate) => candidate.key === pane.dataset.expertTerminalPane,
      );
      if (session && session.key !== activeTerminalKey) focusExpertSession(session);
    });

  });

  document.querySelectorAll<HTMLButtonElement>("[data-toggle-terminal-fullscreen]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = terminalSessions.find(
        (candidate) => candidate.key === button.dataset.toggleTerminalFullscreen,
      );
      if (session) toggleExpertTerminalFullscreen(session);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-account]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedAccountId = button.dataset.account ?? null;
      statusText = "Compte selectionne";
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-terminal-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const session = terminalSessions.find(
        (candidate) => candidate.key === button.dataset.terminalKey,
      );
      if (!session) return;
      activateTerminalSession(session);
      requestTerminalFocusKey = session.key;
      activeView = "terminal";
      stopLimitPoll();
      stopUsagePoll();
      stopKombaiPoll();
      stopDiscussionsPoll();
      stopChatSync();
      statusText = "Terminal selectionne";
      render();
      persistTerminalSessions();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-workspace-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const group = terminalWorkspaceGroups().find(
        (candidate) => candidate.key === button.dataset.workspaceKey,
      );
      if (!group) return;
      const session =
        group.sessions.find((candidate) => candidate.key === activeTerminalKey) ?? group.sessions[0];
      if (session) {
        activateTerminalSession(session);
      } else {
        activeTerminalKey = null;
      }
      setCurrentWorkspace(group.path);
      terminalFolderFilter = group.path;
      if (group.path) void upsertWorkspaceRegistry(group.path);
      activeView = "terminal";
      stopLimitPoll();
      stopUsagePoll();
      stopKombaiPoll();
      stopDiscussionsPoll();
      stopChatSync();
      statusText = `Environnement actif: ${group.label}`;
      render();
      persistTerminalSessions();
    });
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-new-terminal-workspace]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const group = terminalWorkspaceGroups().find(
          (candidate) => candidate.key === button.dataset.newTerminalWorkspace,
        );
        if (!group) return;
        setCurrentWorkspace(group.path);
        terminalFolderFilter = group.path;
        if (group.path) void upsertWorkspaceRegistry(group.path);
        openNewTerminalModal(group.path);
      });
    });

  document.querySelectorAll<HTMLButtonElement>("[data-close-terminal]").forEach((button) => {
    button.addEventListener("click", () => {
      const key = button.dataset.closeTerminal;
      if (key) void closeTerminalSession(key);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-toggle-chat-sidebar]").forEach((button) => {
    button.addEventListener("click", () => {
      const sidebarWasHidden = displayedChatSidebarWidth() === 0;
      if (sidebarWasHidden) {
        setChatSidebarWidth(defaultChatSidebarWidth(window.innerWidth));
      } else {
        setChatSidebarWidth(0);
      }
      fitAndResizeVisibleTerminals();
      const focusTarget = button.classList.contains("chat-sidebar-collapse")
        ? ".chat-sidebar-expand"
        : button.classList.contains("chat-sidebar-expand")
          ? "#chatSidebarCollapse"
          : null;
      if (focusTarget) {
        window.requestAnimationFrame(() =>
          document.querySelector<HTMLButtonElement>(focusTarget)?.focus(),
        );
      }
    });
  });

  document.querySelector<HTMLFormElement>("#addAccountForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void addAccountAndLogin();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-login-account]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset.loginAccount;
      if (!accountId) return;
      selectedAccountId = accountId;
      void reloginAccount(accountId);
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-delete-account]").forEach((button) => {
    button.addEventListener("click", () => {
      const accountId = button.dataset.deleteAccount;
      if (!accountId) return;
      selectedAccountId = accountId;
      void deleteSelectedAccount();
    });
  });

  document.querySelector<HTMLButtonElement>("#addProxy")?.addEventListener("click", () => {
    if (!settings || !proxyControlsEnabled()) return;
    const input = document.querySelector<HTMLInputElement>("#proxyUrlInput");
    const proxyUrl = input?.value.trim() ?? "";
    if (!proxyUrl) {
      statusText = "Saisis une URL de proxy";
      input?.focus();
      return;
    }
    const id = uid("proxy");
    settings.proxies.push({
      id,
      label: "Proxy",
      proxyUrl,
      note: null,
    });
    const account = selectedAccount();
    if (account) account.proxyId = id;
    statusText = "Proxy ajouté";
    render();
  });

  document.querySelector<HTMLButtonElement>("#pickProjectDir")?.addEventListener("click", () => {
    void pickProjectDir();
  });

  document.querySelector<HTMLButtonElement>("#workspacePick")?.addEventListener("click", () => {
    void openWorkspacePicker("active");
  });

  document.querySelector<HTMLButtonElement>("#workspaceAddSide")?.addEventListener("click", () => {
    void openWorkspacePicker("active");
  });

  // Switcher de workspace (barre laterale du chat) : selection d'un dossier /
  // filtre, ou ouverture d'un nouveau dossier.
  bindWorkspaceSwitcherUi();

  document.querySelector<HTMLButtonElement>("#workspaceClear")?.addEventListener("click", () => {
    const path = currentWorkspace();
    const workspace = path
      ? knownWorkspaces().find((candidate) => candidate.id === workspaceIdForPath(path))
      : null;
    if (workspace) void closeWorkspace(workspace);
  });

  document.querySelectorAll<HTMLButtonElement>("[data-ws-dir]").forEach((button) => {
    button.addEventListener("click", () => {
      const path = button.dataset.wsDir;
      if (path) void loadWorkspaceDir(path);
    });
  });

  document.querySelector<HTMLButtonElement>("#workspaceGo")?.addEventListener("click", () => {
    const value = document.querySelector<HTMLInputElement>("#workspacePathInput")?.value.trim();
    void loadWorkspaceDir(value || null);
  });

  document.querySelector<HTMLInputElement>("#workspacePathInput")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      const value = (event.currentTarget as HTMLInputElement).value.trim();
      void loadWorkspaceDir(value || null);
    }
  });

  document.querySelector<HTMLInputElement>("#workspaceFolderSearch")?.addEventListener("input", (event) => {
    const query = (event.currentTarget as HTMLInputElement).value.trim().toLocaleLowerCase();
    let visible = 0;
    document.querySelectorAll<HTMLButtonElement>(".ws-folder-entry").forEach((entry) => {
      const matches = !query || (entry.dataset.wsName ?? "").includes(query);
      entry.hidden = !matches;
      if (matches) visible += 1;
    });
    const count = document.querySelector<HTMLElement>("#workspaceVisibleFolderCount");
    if (count) count.textContent = `${visible} dossier${visible > 1 ? "s" : ""}`;
    const empty = document.querySelector<HTMLElement>("#workspaceSearchEmpty");
    if (empty) empty.hidden = !query || visible > 0;
  });

  document.querySelector<HTMLButtonElement>("#confirmWorkspaceModal")?.addEventListener("click", () => {
    const path = workspaceBrowse?.path?.trim();
    if (path) chooseWorkspace(path);
  });

  document.querySelector<HTMLButtonElement>("#clearWorkspaceModal")?.addEventListener("click", () => {
    chooseWorkspace(null, workspacePickerTarget);
  });

  document.querySelector<HTMLButtonElement>("#cancelWorkspaceModal")?.addEventListener("click", () => {
    closeWorkspaceModal();
  });

  document.querySelector<HTMLButtonElement>("#closeWorkspaceModal")?.addEventListener("click", () => {
    closeWorkspaceModal();
  });

  document.querySelector<HTMLDivElement>("#workspaceBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeWorkspaceModal();
    }
  });

  document.querySelector<HTMLButtonElement>("#closeDiscussionArchive")?.addEventListener("click", () => {
    closeDiscussionArchiveModal();
  });
  document.querySelector<HTMLButtonElement>("#cancelDiscussionArchive")?.addEventListener("click", () => {
    closeDiscussionArchiveModal();
  });
  document.querySelector<HTMLButtonElement>("#confirmDiscussionArchive")?.addEventListener("click", () => {
    void deleteDiscussion();
  });
  document.querySelector<HTMLDivElement>("#discussionArchiveBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeDiscussionArchiveModal();
  });

  document.querySelector<HTMLButtonElement>("#expertTerminalAction")?.addEventListener("click", () => {
    if (activeView !== "terminal") {
      setActiveView("terminal");
      return;
    }
    openNewTerminalModal();
  });

  document.querySelector<HTMLButtonElement>("#newTerminalSide")?.addEventListener("click", () => {
    openNewTerminalModal();
  });

  document.querySelector<HTMLButtonElement>("#pickNewTerminalWorkspace")?.addEventListener("click", () => {
    readNewTerminalAccountDraft();
    readNewTerminalModalForm();
    void openWorkspacePicker("new-terminal");
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-new-terminal-environment-path]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        readNewTerminalAccountDraft();
        readNewTerminalModalForm();
        newTerminalWorkspacePath = userEnvironmentPath(
          button.dataset.newTerminalEnvironmentPath,
        );
        if (newTerminalWorkspacePath) rememberWorkspace(newTerminalWorkspacePath);
        statusText = `Environnement selectionne: ${newTerminalWorkspacePath}`;
        render();
      });
    });

  document.querySelector<HTMLInputElement>("#newTerminalWorkspace")?.addEventListener("input", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    newTerminalWorkspacePath = userEnvironmentPath(input.value);
    const hasEnvironment = !!newTerminalWorkspacePath;
    input.setAttribute("aria-invalid", String(!hasEnvironment));
    document
      .querySelector<HTMLElement>(".new-terminal-environment-required")
      ?.classList.toggle("missing", !hasEnvironment);
    document
      .querySelector<HTMLElement>(".new-terminal-environment-required")
      ?.classList.toggle("selected", hasEnvironment);
    const accountAvailable = !!newTerminalAccount();
    const confirm = document.querySelector<HTMLButtonElement>("#confirmNewTerminal");
    const login = document.querySelector<HTMLButtonElement>("#loginNewTerminal");
    if (confirm) confirm.disabled = !accountAvailable || !hasEnvironment;
    if (login) login.disabled = !accountAvailable || !hasEnvironment;
  });

  document.querySelector<HTMLButtonElement>("#closeNewChatModal")?.addEventListener("click", () => {
    closeNewChatModal();
  });
  document.querySelector<HTMLButtonElement>("#cancelNewChat")?.addEventListener("click", () => {
    closeNewChatModal();
  });
  document.querySelector<HTMLDivElement>("#newChatBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeNewChatModal();
  });
  const newChatAccountButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>("[data-new-chat-account]"),
  );
  newChatAccountButtons.forEach((button, index) => {
    button.addEventListener("click", () => {
      selectNewChatAccount(button.dataset.newChatAccount || null);
    });
    button.addEventListener("keydown", (event) => {
      if (!["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End"].includes(event.key)) {
        return;
      }
      event.preventDefault();
      const last = newChatAccountButtons.length - 1;
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowDown" || event.key === "ArrowRight"
            ? (index + 1) % newChatAccountButtons.length
            : (index - 1 + newChatAccountButtons.length) % newChatAccountButtons.length;
      const next = newChatAccountButtons[nextIndex];
      next?.focus();
      selectNewChatAccount(next?.dataset.newChatAccount || null);
    });
  });
  const newChatModelInput = document.querySelector<HTMLInputElement>("#newChatModel");
  newChatModelInput?.addEventListener("input", () => {
    newChatModelInput.setCustomValidity("");
    newChatModel = newChatModelInput.value;
    if (newChatAccountId) newChatModelDrafts.set(newChatAccountId, newChatModel);
  });
  document.querySelector<HTMLSelectElement>("#newChatMode")?.addEventListener("change", (event) => {
    newChatMode = (event.currentTarget as HTMLSelectElement).value as ChatMode;
  });
  document.querySelector<HTMLButtonElement>("#confirmBestQuotaNewChat")?.addEventListener("click", () => {
    void confirmNewChatWithBestQuota();
  });
  document.querySelector<HTMLButtonElement>("#confirmNewChat")?.addEventListener("click", () => {
    confirmNewChatModal();
  });

  document.querySelector<HTMLButtonElement>("#closeNewTerminalModal")?.addEventListener("click", () => {
    closeNewTerminalModal();
  });

  document.querySelector<HTMLButtonElement>("#cancelNewTerminal")?.addEventListener("click", () => {
    closeNewTerminalModal();
  });

  document.querySelector<HTMLDivElement>("#newTerminalBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeNewTerminalModal();
    }
  });

  document.querySelector<HTMLSelectElement>("#newTerminalAccount")?.addEventListener("change", (event) => {
    readNewTerminalAccountDraft();
    readNewTerminalModalForm();
    newTerminalAccountId = (event.currentTarget as HTMLSelectElement).value || null;
    const account = newTerminalAccount();
    if (account) syncNewTerminalAccountUi(account);
  });

  document.querySelector<HTMLSelectElement>("#newTerminalAgent")?.addEventListener("change", (event) => {
    // Committe les champs saisis (CODEX_HOME, projet, proxy) avant le re-render,
    // sinon changer d'agent (qui ne change pas de compte) les remettrait a zero.
    readNewTerminalAccountDraft();
    readNewTerminalModalForm();
    newTerminalAgentId = (event.currentTarget as HTMLSelectElement).value || null;
    render();
  });

  document.querySelector<HTMLButtonElement>("#addAccountFromModal")?.addEventListener("click", () => {
    addAccountFromModal();
  });

  document.querySelector<HTMLButtonElement>("#confirmNewTerminal")?.addEventListener("click", () => {
    const account = readNewTerminalModalForm();
    if (!account) {
      statusText = "Choisis ou ajoute un compte";
      render();
      return;
    }
    const environmentPath = userEnvironmentPath(newTerminalWorkspacePath);
    if (!environmentPath) {
      statusText = "Choisis un environnement avant de creer le terminal";
      render();
      return;
    }
    newTerminalWorkspacePath = environmentPath;
    setCurrentWorkspace(environmentPath);
    terminalFolderFilter = environmentPath;
    void upsertWorkspaceRegistry(environmentPath);
    forgetDialogTrigger("new-terminal");
    newTerminalModalOpen = false;
    void createNewTerminal(
      account.id,
      true,
      null,
      newTerminalAgentId,
      null,
      newTerminalWorkspacePath,
    );
  });

  document.querySelector<HTMLButtonElement>("#loginNewTerminal")?.addEventListener("click", () => {
    const account = readNewTerminalModalForm();
    if (!account || !settings) {
      statusText = "Choisis ou ajoute un compte";
      render();
      return;
    }
    const environmentPath = userEnvironmentPath(newTerminalWorkspacePath);
    if (!environmentPath) {
      statusText = "Choisis un environnement avant d'ouvrir le terminal de connexion";
      render();
      return;
    }
    newTerminalWorkspacePath = environmentPath;
    setCurrentWorkspace(environmentPath);
    terminalFolderFilter = environmentPath;
    void upsertWorkspaceRegistry(environmentPath);
    const agent = newTerminalAgent();
    if (!agent?.loginCommand) {
      statusText = "Cet agent n'a pas de commande de login";
      render();
      return;
    }
    forgetDialogTrigger("new-terminal");
    newTerminalModalOpen = false;
    void createNewTerminal(
      account.id,
      true,
      reconnectCommandForAccount(account, agent),
      agent.id,
      null,
      newTerminalWorkspacePath,
      true,
    );
  });

  document.querySelector<HTMLButtonElement>("#poolTerminal")?.addEventListener("click", () => {
    void createPoolTerminal();
  });

  document.querySelector<HTMLButtonElement>("#fullscreenToggle")?.addEventListener("click", () => {
    void toggleFullscreen();
  });

  document.querySelector<HTMLButtonElement>("#poolToggle")?.addEventListener("click", () => {
    setActiveView("pool");
  });

  document.querySelector<HTMLButtonElement>("#autonomousToggle")?.addEventListener("click", () => {
    setActiveView("autonomous");
  });

  document.querySelector<HTMLButtonElement>("#orchestrationToggle")?.addEventListener("click", () => {
    setActiveView("orchestration");
  });

  // Barre latérale : « Discussions » (à la place de l'ancien « Comptes ») ouvre
  // la liste des conversations avec le sélecteur de compte de reprise.
  document.querySelector<HTMLButtonElement>("#sideDiscussions")?.addEventListener("click", () => {
    setActiveView("discussions");
  });
  // « Paramètres » : page dédiée qui héberge aussi l'accès aux comptes.
  document.querySelector<HTMLButtonElement>("#settingsToggle")?.addEventListener("click", () => {
    setActiveView("settings");
  });
  document.querySelector<HTMLButtonElement>("#settingsAccounts")?.addEventListener("click", () => {
    setActiveView("pool");
  });
  document.querySelector<HTMLButtonElement>("#settingsAgents")?.addEventListener("click", () => {
    openAgentsModal();
  });
  document.querySelector<HTMLButtonElement>("#themeToggle")?.addEventListener("click", () => {
    setAppTheme(oppositeTheme(activeTheme));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const theme = button.dataset.themeChoice;
      if (theme === "light" || theme === "dark") setAppTheme(theme);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-record-keyboard-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.recordKeyboardShortcut as KeyboardShortcutId | undefined;
      if (id) startKeyboardShortcutCapture(id);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-clear-keyboard-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.clearKeyboardShortcut as KeyboardShortcutId | undefined;
      if (id) clearKeyboardShortcut(id);
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-reset-keyboard-shortcut]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.resetKeyboardShortcut as KeyboardShortcutId | undefined;
      if (id) resetKeyboardShortcut(id);
    });
  });
  document.querySelector<HTMLButtonElement>("#resetKeyboardShortcuts")?.addEventListener("click", () => {
    resetAllKeyboardShortcuts();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-chat-display-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      setExpertChatDisplayMode(
        normalizeExpertChatDisplayMode(button.dataset.chatDisplayMode),
      );
    });
  });
  document.querySelector<HTMLInputElement>("#chatReadySoundEnabled")?.addEventListener("change", (event) => {
    const enabled = (event.currentTarget as HTMLInputElement).checked;
    if (enabled) void unlockChatReadySound();
    updateChatReadySoundPreferences(
      { ...chatReadySoundPreferences, enabled },
      enabled ? "Notification sonore activée." : "Notification sonore désactivée.",
    );
  });
  document.querySelector<HTMLButtonElement>("#chatReadySoundPreview")?.addEventListener("click", () => {
    void (async () => {
      const played = await playChatReadySound({ ...chatReadySoundPreferences, enabled: true });
      chatReadySoundFeedback = played
        ? { message: "Aperçu du son joué.", tone: "success" }
        : { message: "Le navigateur a empêché la lecture du son.", tone: "error" };
      if (activeView === "settings") render();
    })();
  });
  document.querySelector<HTMLButtonElement>("#chatReadySoundChoose")?.addEventListener("click", () => {
    document.querySelector<HTMLInputElement>("#chatReadySoundFile")?.click();
  });
  document.querySelector<HTMLInputElement>("#chatReadySoundFile")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    chatReadySoundFeedback = { message: "Vérification du MP3…", tone: "success" };
    if (activeView === "settings") render();
    void (async () => {
      try {
        const customSound = await readChatReadySoundFile(file);
        updateChatReadySoundPreferences(
          { ...chatReadySoundPreferences, ...customSound },
          `« ${customSound.customSoundName} » est maintenant utilisé.`,
        );
      } catch (error) {
        chatReadySoundFeedback = { message: String(error instanceof Error ? error.message : error), tone: "error" };
        if (activeView === "settings") render();
      }
    })();
  });
  document.querySelector<HTMLButtonElement>("#chatReadySoundReset")?.addEventListener("click", () => {
    updateChatReadySoundPreferences(
      {
        ...chatReadySoundPreferences,
        customSoundDataUrl: null,
        customSoundName: null,
        customSoundDuration: null,
      },
      "La clochette douce par défaut est à nouveau utilisée.",
    );
  });
  bindVoiceRuntimeRefresh();

  bindAutonomousPanelUi();
  bindOrchestrationPanelUi();
  bindAutonomousOrchestrationPromotionUi();
  bindAutonomousChatEditorUi();
  bindOrchestrationConversionUi();
  bindAutonomousMonitorUi();

  document.querySelector<HTMLButtonElement>("#limitsToggle")?.addEventListener("click", () => {
    setActiveView("limits");
  });

  document.querySelector<HTMLButtonElement>("#refreshLimits")?.addEventListener("click", () => {
    void refreshLimitStatus();
  });

  document.querySelector<HTMLButtonElement>("#dashboardToggle")?.addEventListener("click", () => {
    setActiveView("dashboard");
  });

  document.querySelector<HTMLButtonElement>("#tasksToggle")?.addEventListener("click", () => {
    setActiveView("tasks");
  });

  document.querySelector<HTMLButtonElement>("#scheduledChatToggle")?.addEventListener("click", () => {
    setActiveView("scheduled-chat");
  });

  document.querySelector<HTMLButtonElement>("#promptsToggle")?.addEventListener("click", () => {
    setActiveView("prompts");
  });

  document.querySelectorAll<HTMLButtonElement>("[data-stats-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const tab = button.dataset.statsTab;
      if ((tab !== "tokens" && tab !== "work-time") || tab === statsActiveTab) return;
      statsActiveTab = tab;
      if (tab === "work-time" && !workTimeLoaded) void refreshWorkTimeDashboard();
      render();
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-stats-range]").forEach((button) => {
    button.addEventListener("click", () => {
      const range = Number(button.dataset.statsRange);
      if (range !== 1 && range !== 7 && range !== 30) return;
      statsRangeDays = range;
      render();
    });
  });

  document.querySelectorAll<SVGGElement>("[data-stats-date]").forEach((point) => {
    const selectDate = () => {
      const date = point.dataset.statsDate;
      if (!date || date === selectedStatsDate) return;
      selectedStatsDate = date;
      render();
    };
    point.addEventListener("click", selectDate);
    point.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectDate();
    });
  });

  document
    .querySelectorAll<HTMLButtonElement>("[data-work-time-granularity]")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const granularity = button.dataset.workTimeGranularity;
        if (
          (granularity !== "day" && granularity !== "week" && granularity !== "month") ||
          granularity === workTimeGranularity
        ) {
          return;
        }
        workTimeGranularity = granularity;
        selectedWorkTimeBucket = null;
        render();
      });
    });

  document.querySelectorAll<HTMLButtonElement>("[data-work-time-bucket]").forEach((button) => {
    button.addEventListener("click", () => {
      const bucket = button.dataset.workTimeBucket;
      if (!bucket || bucket === selectedWorkTimeBucket) return;
      selectedWorkTimeBucket = bucket;
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#dashboardRefresh")?.addEventListener("click", () => {
    // Le « général » agrège désormais les tokens/coût par-compte : on relit
    // aussi les logs Codex pour que le rafraîchissement mette tout à jour.
    void refreshUsageDashboard();
    void refreshAccountUsage();
    void refreshWorkTimeDashboard();
  });

  document.querySelector<HTMLButtonElement>("#kombaiToggle")?.addEventListener("click", () => {
    setActiveView("kombai");
  });

  document.querySelector<HTMLButtonElement>("#auditToggle")?.addEventListener("click", () => {
    void toggleAudit();
  });

  document.querySelector<HTMLButtonElement>("#auditRun")?.addEventListener("click", () => {
    void runAudit(auditViewLabelFor("audit"));
  });

  document.querySelector<HTMLDivElement>("#auditList")?.addEventListener("click", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-audit-selector]");
    if (row?.dataset.auditSelector) highlightAuditTarget(row.dataset.auditSelector);
  });

  document.querySelector<HTMLButtonElement>("#skillsToggle")?.addEventListener("click", () => {
    setActiveView("skills");
  });

  document.querySelector<HTMLButtonElement>("#skillsRefresh")?.addEventListener("click", () => {
    void refreshSkills();
  });

  document.querySelector<HTMLDivElement>("#skillsList")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const chatButtonEl = target.closest<HTMLElement>("[data-skill-chat-button]");
    if (chatButtonEl?.dataset.skillChatButton) {
      toggleSkillChatButton(chatButtonEl.dataset.skillChatButton);
      return;
    }
    const applyEl = target.closest<HTMLElement>("[data-skill-apply]");
    if (applyEl?.dataset.skillApply) {
      void applySkill(applyEl.dataset.skillApply);
      return;
    }
    const copyEl = target.closest<HTMLElement>("[data-skill-copy]");
    if (copyEl?.dataset.skillCopy) void copySkill(copyEl.dataset.skillCopy);
  });

  document.querySelector<HTMLButtonElement>("#kombaiStart")?.addEventListener("click", () => {
    void startKombai();
  });

  document.querySelector<HTMLButtonElement>("#kombaiStop")?.addEventListener("click", () => {
    void stopKombai();
  });

  document.querySelector<HTMLButtonElement>("#kombaiInstall")?.addEventListener("click", () => {
    void installKombaiExtension();
  });

  document.querySelector<HTMLButtonElement>("#kombaiRefresh")?.addEventListener("click", () => {
    void refreshKombaiStatus();
  });

  document.querySelector<HTMLButtonElement>("#kombaiReload")?.addEventListener("click", () => {
    reloadKombaiFrame();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-open-discussions]").forEach((button) => {
    button.addEventListener("click", () => setActiveView("discussions"));
  });

  const returnToChat = () => {
    closeMobileOverlays();
    activeView = "chat";
    statusText = expertChatStatusText();
    startAllExpertChatWork();
    render();
  };
  document.querySelector<HTMLButtonElement>("#chatHome")?.addEventListener("click", returnToChat);
  document.querySelector<HTMLButtonElement>("#adminBackChat")?.addEventListener("click", returnToChat);
  document.querySelector<HTMLButtonElement>("#chatSidebarClose")?.addEventListener("click", () => {
    closeMobileOverlays();
  });
  document.querySelector<HTMLButtonElement>("#chatSidebarScrim")?.addEventListener("click", () => {
    closeMobileOverlays();
  });
  document.querySelector<HTMLInputElement>("#chatSidebarSearch")?.addEventListener("input", (event) => {
    chatSidebarSearch = (event.currentTarget as HTMLInputElement).value;
    const host = document.querySelector<HTMLElement>("#chatSideConversations");
    if (host) {
      host.innerHTML = renderChatSidebarConversations();
      renderIcons(host);
      bindDiscussionRowUi();
      bindWorkspaceSwitcherUi(host);
    }
  });

  document.querySelector<HTMLButtonElement>("#refreshDiscussions")?.addEventListener("click", () => {
    void refreshDiscussions();
  });

  // Vue conversation : navigation, composer, arret et copie des blocs de code.
  document.querySelector<HTMLButtonElement>("#chatBack")?.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 760px)").matches) {
      document.body.classList.add("chat-sidebar-open");
      syncMobileDrawerAccessibility(true, true);
    } else {
      setActiveView("discussions");
    }
  });
  document.querySelector<HTMLButtonElement>("#chatRefresh")?.addEventListener("click", () => {
    if (chatDiscussion) void loadChatTranscript();
    else void refreshDiscussions();
  });
  document.querySelector<HTMLButtonElement>("#chatHistoryToggle")?.addEventListener("click", () => {
    chatHistoryOpen = !chatHistoryOpen;
    render();
  });
  document.querySelector<HTMLButtonElement>("#chatHistoryClose")?.addEventListener("click", () => {
    chatHistoryOpen = false;
    render();
  });
  document.querySelectorAll<HTMLButtonElement>("#chatPanel [data-chat-history-message]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.chatHistoryMessage);
      if (!Number.isInteger(index)) return;
      const reveal = () => {
        const message = document.querySelector<HTMLElement>(`#chat-message-${index}`);
        message?.scrollIntoView({ behavior: "smooth", block: "center" });
        message?.classList.add("chat-msg--located");
        window.setTimeout(() => message?.classList.remove("chat-msg--located"), 1400);
      };
      if (window.matchMedia("(max-width: 760px)").matches) {
        chatHistoryOpen = false;
        render();
        window.requestAnimationFrame(reveal);
      } else {
        reveal();
      }
    });
  });
  document.querySelector<HTMLButtonElement>("#chatNew")?.addEventListener("click", openNewChat);
  document.querySelector<HTMLButtonElement>("#chatStop")?.addEventListener("click", () => {
    void stopCurrentChatTurn();
  });
  document
    .querySelector<HTMLButtonElement>("#chatPanel [data-chat-action='clear-queue']")
    ?.addEventListener("click", () => {
      chatQueuedSubmissions = [];
      statusText = "File d'attente annulée";
      render();
      focusMainChatPrompt();
    });
  document.querySelector<HTMLButtonElement>("#chatGoal")?.addEventListener("click", () => {
    void sendChatMessage("goal");
  });
  const mainChatPanel = document.querySelector<HTMLElement>("#chatPanel");
  mainChatPanel
    ?.querySelectorAll<HTMLButtonElement>("[data-chat-action='toggle-agent-tool']")
    .forEach((button) => {
      button.addEventListener("click", () => {
        const toolId = button.dataset.chatTool;
        if (!isChatAgentToolId(toolId)) return;
        chatEnabledTools = toggleChatAgentTool(chatEnabledTools, toolId);
        const enabled = chatEnabledTools.includes(toolId);
        statusText = `${chatAgentToolLabel(toolId, chatAgentToolDefinitions())} ${enabled ? "activé" : "désactivé"} pour ce chat`;
        render();
        focusMainChatPrompt();
      });
    });
  mainChatPanel?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("[data-chat-action='focus-prompt']")) return;
    document.querySelector<HTMLTextAreaElement>("#chatPrompt")?.focus();
  });

  const chatPrompt = document.querySelector<HTMLTextAreaElement>("#chatPrompt");
  const resizeChatPrompt = () => {
    if (!chatPrompt) return;
    chatPrompt.style.height = "0px";
    chatPrompt.style.height = `${Math.min(chatPrompt.scrollHeight, 132)}px`;
  };
  chatPrompt?.addEventListener("input", () => {
    chatDraft = chatPrompt.value;
    chatPrompt.setCustomValidity("");
    resizeChatPrompt();
  });
  chatPrompt?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void sendChatMessage();
    }
  });
  resizeChatPrompt();
  if (mainChatPanel) bindVoiceComposer(mainChatPanel);
  document.querySelector<HTMLFormElement>("#chatComposer")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendChatMessage();
  });
  document.querySelector<HTMLSelectElement>("#chatMode")?.addEventListener("change", (event) => {
    chatMode = (event.currentTarget as HTMLSelectElement).value as ChatMode;
  });
  const chatModelInput = document.querySelector<HTMLInputElement>("#chatModel");
  const commitChatPreferences = () => {
    const account = chatSelectedAccount();
    if (!account) return false;
    const preferences = readChatPreferences(account);
    chatModelInput?.setCustomValidity(preferences.error ?? "");
    if (preferences.error) {
      chatModelInput?.reportValidity();
      statusText = preferences.error;
      return false;
    }
    if (preferences.changed) persistChatPreferences(account.id);
    return true;
  };
  chatModelInput?.addEventListener("input", () => chatModelInput.setCustomValidity(""));
  chatModelInput?.addEventListener("change", () => {
    if (commitChatPreferences()) render();
  });
  chatModelInput?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    chatModelInput.blur();
  });
  document
    .querySelector<HTMLSelectElement>("#chatReasoningEffort")
    ?.addEventListener("change", commitChatPreferences);
  document.querySelectorAll<HTMLButtonElement>("#chatPanel [data-chat-starter]").forEach((button) => {
    button.addEventListener("click", () => {
      chatDraft = button.dataset.chatStarter ?? "";
      const prompt = document.querySelector<HTMLTextAreaElement>("#chatPrompt");
      if (prompt) {
        prompt.value = chatDraft;
        prompt.dispatchEvent(new Event("input"));
        prompt.focus();
        prompt.setSelectionRange(prompt.value.length, prompt.value.length);
      }
    });
  });
  // Delegation sur le conteneur : les boutons copier sont recrees a chaque
  // patch du fil, le listener sur #chatFeed (stable) les couvre tous.
  const mainChatFeed = document.querySelector<HTMLDivElement>("#chatFeed");
  if (mainChatFeed) {
    bindChatFeedScroll(mainChatFeed);
    restoreChatFeedScroll(mainChatFeed);
  }
  mainChatFeed?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLButtonElement>(".chat-code-copy, [data-chat-copy]");
    if (!button) return;
    const code = button.matches("[data-chat-copy]")
      ? button.closest(".chat-user-message, [data-chat-copy-source]")?.querySelector<HTMLElement>(".chat-msg-body, .chat-assistant-markdown")?.innerText ?? ""
      : button.closest(".chat-code")?.querySelector("code")?.textContent ?? "";
    if (!code) return;
    void navigator.clipboard.writeText(code).then(() => {
      button.classList.add("copied");
      window.setTimeout(() => button.classList.remove("copied"), 1200);
    });
  });

  document.querySelector<HTMLInputElement>("#discussionSearch")?.addEventListener("input", (event) => {
    discussionSearch = (event.currentTarget as HTMLInputElement).value;
    refreshDiscussionList();
  });

  bindDiscussionRowUi();

  document.querySelector<HTMLButtonElement>("#historyToggle")?.addEventListener("click", () => {
    setActiveView("history");
  });

  document.querySelector<HTMLButtonElement>("#refreshPromptHistory")?.addEventListener("click", () => {
    promptHistoryLoaded = false;
    void refreshPromptHistory();
  });

  document.querySelector<HTMLInputElement>("#promptSearch")?.addEventListener("input", (event) => {
    promptSearch = (event.currentTarget as HTMLInputElement).value;
    refreshPromptList();
  });

  bindPromptRowUi();

  document.querySelector<HTMLButtonElement>("#accountUsageRefresh")?.addEventListener("click", () => {
    void refreshAccountUsage();
  });

  document.querySelector<HTMLButtonElement>("#poolStart")?.addEventListener("click", () => {
    void startPool();
  });

  document.querySelector<HTMLButtonElement>("#poolStop")?.addEventListener("click", () => {
    void stopPool();
  });

  document.querySelector<HTMLButtonElement>("#poolTest")?.addEventListener("click", () => {
    void testPool();
  });

  document.querySelector<HTMLFormElement>("#poolAddAccount")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void addPoolAccount();
  });

  document
    .querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "#poolNewAccountLabel, #poolNewAccountProxy, #poolNewAccountBypass, #poolNewAccountModel, #poolNewAccountReasoningEffort",
    )
    .forEach((input) => {
      input.addEventListener("input", readPoolNewAccountForm);
      input.addEventListener("change", readPoolNewAccountForm);
    });

  document.querySelector<HTMLTextAreaElement>("#poolImportPaths")?.addEventListener("input", (event) => {
    poolImportPaths = (event.currentTarget as HTMLTextAreaElement).value;
  });

  document.querySelector<HTMLButtonElement>("#poolImport")?.addEventListener("click", () => {
    void importPoolFiles();
  });

  // Delegation : le tbody #poolRows est reecrit par le poll 3s (innerHTML), donc
  // on ecoute sur le conteneur qui, lui, persiste entre deux rafraichissements.
  document.querySelector<HTMLTableSectionElement>("#poolRows")?.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const confirmBtn = target.closest<HTMLElement>("[data-remove-account-confirm]");
    if (confirmBtn) {
      void removeAccount(confirmBtn.dataset.removeAccountConfirm ?? null, false);
      return;
    }
    const purgeBtn = target.closest<HTMLElement>("[data-remove-account-purge]");
    if (purgeBtn) {
      const id = purgeBtn.dataset.removeAccountPurge ?? null;
      const acc = poolStatus?.accounts?.find((item) => item.id === id);
      const home = acc?.codexHome ?? "";
      const confirmed = window.confirm(
        `Supprimer définitivement le compte « ${acc?.label ?? id ?? ""} » ET son environnement sur le disque ?\n\n${home}\n\nCette action est irréversible : auth.json, sessions, config… seront effacés.`,
      );
      if (confirmed) {
        void removeAccount(id, true);
      } else {
        pendingDeleteAccountId = null;
        render();
      }
      return;
    }
    const cancelBtn = target.closest<HTMLElement>("[data-remove-account-cancel]");
    if (cancelBtn) {
      pendingDeleteAccountId = null;
      render();
      return;
    }
    const removeBtn = target.closest<HTMLElement>("[data-remove-account]");
    if (removeBtn) {
      pendingDeleteAccountId = removeBtn.dataset.removeAccount ?? null;
      render();
    }
  });

  document.querySelector<HTMLSelectElement>("#agentSelect")?.addEventListener("change", (event) => {
    setActiveAgent((event.currentTarget as HTMLSelectElement).value || null);
  });

  document.querySelector<HTMLButtonElement>("#runAgent")?.addEventListener("click", () => {
    const agent = activeAgent();
    if (!agent) return;
    if (agentIsIde(agent)) {
      void launchIde(agent);
    } else {
      void sendLine(agentRunCommand(agent, accountById(activeTerminal()?.accountId)));
    }
  });

  document.querySelector<HTMLButtonElement>("#manageAgents")?.addEventListener("click", () => {
    openAgentsModal();
  });

  document.querySelector<HTMLButtonElement>("#loginStatus")?.addEventListener("click", () => {
    const agent = activeAgent();
    if (agent?.statusCommand) void sendLine(agentSubcommand(agent, agent.statusCommand));
  });

  document.querySelector<HTMLButtonElement>("#doctor")?.addEventListener("click", () => {
    const agent = activeAgent();
    if (agent?.doctorCommand) void sendLine(agentSubcommand(agent, agent.doctorCommand));
  });

  document.querySelector<HTMLButtonElement>("#closeAgentsModal")?.addEventListener("click", () => {
    closeAgentsModal();
  });

  document.querySelector<HTMLButtonElement>("#cancelAgentsModal")?.addEventListener("click", () => {
    closeAgentsModal();
  });

  document.querySelector<HTMLDivElement>("#agentsBackdrop")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) {
      closeAgentsModal();
    }
  });

  document.querySelector<HTMLButtonElement>("#addAgent")?.addEventListener("click", () => {
    addAgent();
  });

  document.querySelectorAll<HTMLButtonElement>("[data-remove-agent]").forEach((button) => {
    button.addEventListener("click", () => {
      removeAgent(button.dataset.removeAgent ?? null);
    });
  });

  document.querySelectorAll<HTMLSelectElement>('[data-agent-field="kind"]').forEach((select) => {
    select.addEventListener("change", () => {
      readAgentsModalForm();
      render();
    });
  });

  document.querySelector<HTMLButtonElement>("#saveAgentsModal")?.addEventListener("click", () => {
    void saveAgentsModal();
  });

  document.querySelector<HTMLButtonElement>("#saveSettings")?.addEventListener("click", () => {
    readSettingsForm();
    void saveSettings();
  });

  document.querySelector<HTMLButtonElement>("#removeAccount")?.addEventListener("click", () => {
    void deleteSelectedAccount();
  });

  document.querySelector<HTMLInputElement>("#autoRun")?.addEventListener("change", (event) => {
    if (!settings) return;
    settings.autoRunCodex = (event.currentTarget as HTMLInputElement).checked;
  });

  document.querySelector<HTMLInputElement>("#proxyControls")?.addEventListener("change", (event) => {
    if (!settings) return;
    settings.proxyControlsEnabled = (event.currentTarget as HTMLInputElement).checked;
    settings.accounts.forEach(syncSessionsForAccount);
    statusText = settings.proxyControlsEnabled ? "Proxies actives" : "Proxies desactives";
    render();
  });

  document.querySelector<HTMLSelectElement>("#proxySelect")?.addEventListener("change", (event) => {
    if (!proxyControlsEnabled()) return;
    const account = selectedAccount();
    if (!account) return;
    account.proxyId = (event.currentTarget as HTMLSelectElement).value || null;
    syncSessionsForAccount(account);
    statusText = "Proxy associe";
    render();
  });

  document.querySelector<HTMLInputElement>("#accountBypass")?.addEventListener("change", () => {
    if (!settings || !selectedAccount()) return;
    // Lit tout le formulaire (dont la case bypass) puis persiste tout de suite,
    // pour que le reglage par compte survive au rechargement.
    readSettingsForm();
    void invoke<AppSettings>("save_settings", { settings })
      .then(async (updated) => {
        settings = updated;
        const account = selectedAccount();
        if (account) await provisionAccountHome(account);
        statusText = account?.bypass
          ? "Bypass active pour ce compte"
          : "Bypass desactive : sandbox workspace-write active";
        render();
      })
      .catch((error) => {
        statusText = String(error);
        render();
      });
  });
};

const readSettingsForm = () => {
  if (!settings) return;
  const proxyControls = document.querySelector<HTMLInputElement>("#proxyControls");
  if (proxyControls) {
    settings.proxyControlsEnabled = proxyControls.checked;
  }

  const account = selectedAccount();
  const accountLabel = document.querySelector<HTMLInputElement>("#accountLabel");
  const accountHome = document.querySelector<HTMLInputElement>("#accountHome");
  const projectDir = document.querySelector<HTMLInputElement>("#projectDir");
  const proxySelect = document.querySelector<HTMLSelectElement>("#proxySelect");
  const accountBypass = document.querySelector<HTMLInputElement>("#accountBypass");
  const accountModelInput = document.querySelector<HTMLInputElement>("#accountModel");
  const accountReasoningEffortSelect =
    document.querySelector<HTMLSelectElement>("#accountReasoningEffort");

  if (
    account &&
    (accountLabel ||
      accountHome ||
      projectDir ||
      proxySelect ||
      accountBypass ||
      accountModelInput ||
      accountReasoningEffortSelect)
  ) {
    if (accountLabel) account.label = accountLabel.value.trim() || account.label;
    if (accountHome) account.codexHome = accountHome.value.trim() || account.codexHome;
    if (projectDir) account.projectDir = projectDir.value.trim() || null;
    if (settings.proxyControlsEnabled) {
      account.proxyId = proxySelect?.value || null;
    }
    if (accountBypass) account.bypass = accountBypass.checked;
    if (accountModelInput) account.model = accountModelInput.value.trim() || DEFAULT_CODEX_MODEL;
    if (accountReasoningEffortSelect) {
      account.reasoningEffort = normalizeCodexReasoningEffort(accountReasoningEffortSelect.value);
    }
    syncSessionsForAccount(account);
  }

  const shellInput = document.querySelector<HTMLInputElement>("#shellInput");
  const codexCommand = document.querySelector<HTMLInputElement>("#codexCommand");
  const autoRun = document.querySelector<HTMLInputElement>("#autoRun");
  const codexBypass = document.querySelector<HTMLInputElement>("#codexBypass");
  const autoDiscover = document.querySelector<HTMLInputElement>("#autoDiscover");
  if (shellInput) settings.shell = shellInput.value.trim() || settings.shell;
  if (codexCommand) settings.codexCommand = codexCommand.value.trim() || settings.codexCommand || "codex";
  if (autoRun) settings.autoRunCodex = autoRun.checked;
  if (codexBypass) settings.codexBypass = codexBypass.checked;
  if (autoDiscover) settings.autoDiscoverAccounts = autoDiscover.checked;
};

const createTerminalSession = async (
  account: AccountProfile,
  proxy: ProxyProfile | null,
  agentId: string,
  folderPath: string,
): Promise<TerminalSession> => {
  const capturedEnvironment = userEnvironmentPath(folderPath);
  if (!capturedEnvironment) {
    throw new Error("Environnement terminal obligatoire");
  }
  const { createTerminalRuntime } = await loadTerminalRuntime();
  const { terminal, fitAddon } = createTerminalRuntime(activeTheme);

  const session: TerminalSession = {
    key: uid("terminal"),
    ptyId: null,
    accountId: account.id,
    agentId,
    title: account.label,
    loginOnly: false,
    folderPath: capturedEnvironment,
    workspaceId: null,
    workspacePath: null,
    projectDir: account.projectDir?.trim() || null,
    proxySummary: proxy ? maskProxy(proxy.proxyUrl) : "sans proxy",
    status: "Pret",
    running: false,
    startedAtUnix: null,
    codexSessionId: null,
    resumeSessionId: null,
    sessionCaptureDone: false,
    terminal,
    fitAddon,
  };

  terminal.onData((data) => {
    if (session.ptyId !== null) {
      void invoke("write_terminal", { id: session.ptyId, data }).catch(() => undefined);
    }
  });

  return session;
};

const mountExpertTerminals = () => {
  const sessions = expertTerminalSessions();
  const sessionByKey = new Map(sessions.map((session) => [session.key, session]));
  const fontSize = sessions.length > 9 ? 10 : sessions.length > 4 ? 11 : 12;

  document.querySelectorAll<HTMLDivElement>("[data-terminal-host]").forEach((host) => {
    const session = sessionByKey.get(host.dataset.terminalHost ?? "");
    if (!session) return;
    session.terminal.options.fontSize = session.key === expertTerminalFullscreenKey ? 13 : fontSize;
    if (session.terminal.element) {
      host.appendChild(session.terminal.element);
    } else {
      session.terminal.open(host);
    }
  });

  const modalOpen =
    newTerminalModalOpen ||
    agentsModalOpen ||
    workspaceModalOpen ||
    terminalEnvironmentMenuOpen;
  const focusKey = requestTerminalFocusKey ?? focusedTerminalKeyBeforeRender;
  if (!modalOpen && focusKey) sessionByKey.get(focusKey)?.terminal.focus();
  requestTerminalFocusKey = null;
  requestAnimationFrame(() => fitAndResizeExpertTerminals());
};

const createNewTerminalOnce = async (
  accountId = selectedAccountId,
  settingsAlreadyRead = false,
  commandOverride: string | null = null,
  agentId: string | null = null,
  resumeSessionId: string | null = null,
  folderPath: string | null | undefined = undefined,
  loginOnly = false,
) => {
  if (!settings) return null;
  const environmentPath = userEnvironmentPath(folderPath);
  if (!environmentPath) {
    statusText = "Creation bloquee: choisis d'abord un environnement";
    render();
    return null;
  }

  activeView = "terminal";
  // Ouvrir un login ne doit pas faire apparaitre en meme temps tous les
  // terminaux de travail sauvegardes. Si une restauration a deja commence, on
  // l'attend toutefois pour conserver un comptage de slots coherent.
  if (!loginOnly || terminalRestoreAttempted) {
    await ensureTerminalsRestored();
  }
  if (terminalSessions.length + pendingTerminalCreations >= EXPERT_MAX_TERMINALS) {
    statusText = `Limite atteinte: ${EXPERT_MAX_TERMINALS} terminaux maximum dans une fenetre`;
    render();
    return null;
  }
  pendingTerminalCreations += 1;
  let terminalSlotReserved = true;
  const releaseTerminalSlot = () => {
    if (terminalSlotReserved) {
      terminalSlotReserved = false;
      pendingTerminalCreations -= 1;
    }
  };

  if (!settingsAlreadyRead) {
    readSettingsForm();
  }
  const account = settings.accounts.find((candidate) => candidate.id === accountId) ?? null;
  if (!account) {
    releaseTerminalSlot();
    return null;
  }

  const agents = settings.agents;
  const activeId = settings.activeAgentId ?? null;
  let chosenAgentId =
    (agentId && agents.some((agent) => agent.id === agentId) && agentId) ||
    (activeId && agents.some((agent) => agent.id === activeId) && activeId) ||
    agents[0]?.id ||
    "codex";

  // L'agent CLI lance doit correspondre au provider du compte : un compte Claude
  // se lance avec l'agent Claude (CLAUDE_CONFIG_DIR + `claude`), un compte Codex
  // avec Codex. Sinon la variable de home et la commande se contrediraient. On
  // ne force que pour les agents CLI "premier rang" (on laisse les agents IDE /
  // customs intacts).
  const wantedProvider = accountProvider(account);
  const chosenAgent = agentById(chosenAgentId);
  if (isFirstPartyAgent(chosenAgent) && agentProvider(chosenAgent) !== wantedProvider) {
    chosenAgentId = providerAgentId(wantedProvider);
  }

  selectedAccountId = account.id;
  settings.defaultAccountId = account.id;
  settings.activeAgentId = chosenAgentId;
  try {
    settings = await invoke<AppSettings>("save_settings", { settings });
  } catch (error) {
    releaseTerminalSlot();
    throw error;
  }

  const savedAccount = settings.accounts.find((candidate) => candidate.id === account.id) ?? null;
  if (!savedAccount) {
    releaseTerminalSlot();
    return null;
  }

  const session = await createTerminalSession(
    savedAccount,
    proxyForAccount(savedAccount),
    chosenAgentId,
    environmentPath,
  );
  session.loginOnly = loginOnly;
  session.resumeSessionId = resumeSessionId;
  if (resumeSessionId) {
    session.codexSessionId = resumeSessionId;
    claimedSessionIds.add(resumeSessionId);
  }
  terminalSessions.push(session);
  releaseTerminalSlot();
  activateTerminalSession(session);
  requestTerminalFocusKey = session.key;
  activeView = "terminal";
  stopLimitPoll();
  stopUsagePoll();
  stopDiscussionsPoll();
  stopChatSync();
  stopChatTurnPoll();
  statusText = "Demarrage terminal";
  render();

  await startTerminalSession(session, commandOverride, loginOnly);
  persistTerminalSessions();
  return session;
};

const createNewTerminal = async (
  accountId = selectedAccountId,
  settingsAlreadyRead = false,
  commandOverride: string | null = null,
  agentId: string | null = null,
  resumeSessionId: string | null = null,
  folderPath: string | null | undefined = undefined,
  loginOnly = false,
): Promise<TerminalSession | null> => {
  const create = () =>
    createNewTerminalOnce(
      accountId,
      settingsAlreadyRead,
      commandOverride,
      agentId,
      resumeSessionId,
      folderPath,
      loginOnly,
    );

  if (!loginOnly || !accountId) return create();

  const inFlightLogin = loginTerminalCreations.get(accountId);
  if (inFlightLogin) {
    statusText = "Connexion deja en cours dans le terminal ouvert";
    render();
    return inFlightLogin;
  }

  const creation = create();
  loginTerminalCreations.set(accountId, creation);
  try {
    return await creation;
  } finally {
    if (loginTerminalCreations.get(accountId) === creation) {
      loginTerminalCreations.delete(accountId);
    }
  }
};

const startTerminalSession = async (
  session: TerminalSession,
  commandOverride: string | null = null,
  loginOnly = false,
  renderProgress = true,
) => {
  if (!settings) return;
  const folder = userEnvironmentPath(session.folderPath);
  if (!folder) {
    session.running = false;
    session.status = "Bloque";
    statusText = "Demarrage refuse: aucun environnement selectionne";
    render();
    return;
  }

  await waitForFrame();
  fitAndResizeTerminal(session);

  const requestedId = reservePtyId();
  session.ptyId = requestedId;
  terminalSessionsByPtyId.set(requestedId, session);
  session.running = true;
  session.status = "Demarrage";
  session.startedAtUnix = Math.floor(Date.now() / 1000);
  statusText = "Demarrage terminal";
  if (renderProgress) render();

  const sessionAgent = agentById(session.agentId);
  const isIde = agentIsIde(sessionAgent);
  // Un agent IDE ne se tape pas dans le PTY : on ouvre l'editeur apres coup.
  const autoRunCommand =
    !loginOnly && settings.autoRunCodex && !isIde
      ? agentRunCommand(sessionAgent, accountById(session.accountId))
      : null;

  try {
    // Workspace capture dans CETTE session :
    //  - web  : envoye au serveur comme `workspacePath` (cwd = ce dossier ; le
    //           serveur ignore alors `repoUrl`) ;
    //  - desktop : envoye comme `projectDir` (override du dossier du compte).
    const started = await invoke<number | TerminalStartResponse>("start_terminal", {
      id: requestedId,
      accountId: session.accountId,
      repoUrl: isRemoteMode() ? session.projectDir ?? "" : undefined,
      workspacePath: isRemoteMode() ? folder ?? undefined : undefined,
      projectDir: !isRemoteMode() ? folder ?? undefined : undefined,
      branch: null,
      cols: session.terminal.cols,
      rows: session.terminal.rows,
      command: commandOverride ?? autoRunCommand,
      agentId: session.agentId,
      loginOnly,
    });
    const ptyId = typeof started === "number" ? started : started.id;
    if (ptyId !== requestedId) terminalSessionsByPtyId.delete(requestedId);
    session.ptyId = ptyId;
    terminalSessionsByPtyId.set(ptyId, session);
    session.workspaceId = typeof started === "number" ? null : started.workspaceId;
    session.workspacePath = typeof started === "number" ? null : started.workspacePath;
    session.running = true;
    session.status = "Actif";
    statusText = "Terminal actif";
    if (!loginOnly && settings.autoRunCodex && isIde && sessionAgent && !commandOverride) {
      // Utilise le workspace capture par cette session, meme si l'utilisateur
      // en a selectionne un autre pendant le demarrage du PTY.
      void launchIde(sessionAgent, session.workspacePath ?? session.folderPath ?? session.projectDir);
    }
    persistTerminalSessions();
    const startedAccount = settings.accounts.find((candidate) => candidate.id === session.accountId) ?? null;
    const effectiveCommand = commandOverride ?? autoRunCommand ?? startedAccount?.startupCommand ?? null;
    if (
      !loginOnly &&
      (session.resumeSessionId || (isCodexAgent(sessionAgent) && !isIde && !!effectiveCommand))
    ) {
      void captureCodexSessionId(session);
    }
  } catch (error) {
    terminalSessionsByPtyId.delete(requestedId);
    if (session.ptyId !== null) terminalSessionsByPtyId.delete(session.ptyId);
    session.ptyId = null;
    session.running = false;
    session.status = "Erreur";
    statusText = String(error);
    session.terminal.writeln(`\r\n${String(error)}`);
  }

  if (renderProgress) render();
};

const closeTerminalSession = async (key: string) => {
  const index = terminalSessions.findIndex((session) => session.key === key);
  if (index === -1) return;

  const [session] = terminalSessions.splice(index, 1);
  if (expertTerminalFullscreenKey === key) expertTerminalFullscreenKey = null;
  const closedWorkspaceKey = terminalWorkspaceDescriptor(session).key;
  const ptyId = session.ptyId;
  if (ptyId !== null) terminalSessionsByPtyId.delete(ptyId);
  session.ptyId = null;
  session.running = false;
  session.terminal.dispose();

  if (activeTerminalKey === key) {
    const replacement =
      terminalSessions.find(
        (candidate) => terminalWorkspaceDescriptor(candidate).key === closedWorkspaceKey,
      ) ?? terminalSessions[Math.max(0, index - 1)] ?? terminalSessions[0] ?? null;
    if (replacement) {
      activateTerminalSession(replacement);
    } else {
      activeTerminalKey = null;
    }
  }

  statusText = "Terminal ferme";
  render();
  persistTerminalSessions();

  if (ptyId !== null) {
    await invoke("stop_terminal", { id: ptyId }).catch(() => undefined);
  }
  await persistTerminalDiscussionFolder(session).catch(() => undefined);
};

const sendLine = async (line: string) => {
  const session = activeTerminal();
  if (!session?.running || session.ptyId === null) return false;
  try {
    await invoke("write_terminal", { id: session.ptyId, data: `${line}\r` });
    return true;
  } catch (error) {
    statusText = String(error);
    render();
    return false;
  }
};


const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const escapeAttr = escapeHtml;

const userHomeHint = () => (isRemoteMode() ? "%CST_DATA_DIR%\\codex-homes" : "%USERPROFILE%");

const expertChatKeyFromElement = (element: Element | null): string | null => {
  return element?.closest<HTMLElement>("[data-chat-panel]")?.dataset.chatPanel || null;
};

const expertChatKeyAtPointer = (): string | null => {
  const pointedElement = lastPointerClientX !== null && lastPointerClientY !== null
    ? document.elementFromPoint(lastPointerClientX, lastPointerClientY)
    : null;
  const pointedKey = expertChatKeyFromElement(pointedElement);
  if (pointedKey) return pointedKey;

  return document.querySelector<HTMLElement>("[data-chat-panel]:hover")?.dataset.chatPanel || null;
};

const closeHoveredExpertChat = (action: ChatHoverShortcutAction): boolean => {
  if (activeView !== "chat") return false;
  if (document.querySelector(".modal-backdrop")) return false;

  const key = expertChatKeyAtPointer();
  const pane = expertChatPanes.find((candidate) => candidate.key === key);
  if (!pane) return false;

  if (action === "close-chat-and-discussion") {
    void closeExpertChatAndDiscussion(pane);
  } else {
    closeExpertChatPane(pane);
  }
  return true;
};

const toggleHoveredExpertFullscreen = (): boolean => {
  if (activeView === "terminal") {
    const hoveredPane = document.querySelector<HTMLElement>("[data-expert-terminal-pane]:hover");
    const key = expertTerminalFullscreenKey ?? hoveredPane?.dataset.expertTerminalPane;
    const session = terminalSessions.find((candidate) => candidate.key === key);
    if (!session) return false;
    toggleExpertTerminalFullscreen(session);
    return true;
  }

  if (activeView === "chat") {
    const hoveredPane = document.querySelector<HTMLElement>("[data-chat-panel]:hover");
    const key = expertChatFullscreenKey ?? hoveredPane?.dataset.chatPanel;
    const pane = expertChatPanes.find((candidate) => candidate.key === key);
    if (!pane) return false;
    toggleExpertChatFullscreen(pane);
    return true;
  }

  return false;
};

type HoveredTerminalShortcutAction =
  | "close-terminal"
  | "maximize-terminal"
  | "restore-terminal";

const handleHoveredExpertTerminalShortcut = (
  action: HoveredTerminalShortcutAction,
): boolean => {
  if (activeView !== "terminal") return false;
  const hoveredPane = document.querySelector<HTMLElement>("[data-expert-terminal-pane]:hover");
  const key = hoveredPane?.dataset.expertTerminalPane ?? expertTerminalFullscreenKey;
  if (!key) return false;
  const session = terminalSessions.find((candidate) => candidate.key === key);
  if (!session) return false;

  if (action === "close-terminal") {
    void closeTerminalSession(session.key);
    return true;
  }
  if (action === "maximize-terminal") {
    if (expertTerminalFullscreenKey !== session.key) {
      toggleExpertTerminalFullscreen(session);
    }
    return true;
  }
  if (action === "restore-terminal") {
    if (expertTerminalFullscreenKey === session.key) {
      toggleExpertTerminalFullscreen(session);
    }
    return true;
  }
  return false;
};

const setupEvents = async () => {
  window.addEventListener("keydown", (event) => {
    captureKeyboardShortcut(event);
  }, true);
  window.addEventListener("keydown", trapActiveDialogFocus, true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    refreshChatRuntimeClocks();
    void dispatchDueScheduledChats();
    if ((nextUnconnectedAccountExpiry() ?? Number.POSITIVE_INFINITY) <= Date.now()) {
      void cleanupExpiredUnconnectedAccounts();
    }
    if (activeView === "chat" || activeView === "discussions") {
      void refreshDiscussions();
      void refreshActiveChatTurns();
    }
    if (
      activeView === "limits" || activeView === "chat" ||
      chatTurnIsBusy(chatTurn?.status) ||
      expertChatPanes.some((pane) => chatTurnIsBusy(pane.turn?.status))
    ) {
      void refreshLimitStatus(true);
    }
    if (activeView === "pool") void refreshPoolStatus();
    if (activeView === "dashboard") {
      void refreshUsageDashboard();
      void refreshAccountUsage();
      void refreshWorkTimeDashboard();
    }
    if (activeView === "kombai") void refreshKombaiStatus();
    if (activeView === "settings") void refreshVoiceRuntimeStatus();
    void refreshAutonomousAgents();
    if (activeView === "orchestration") void refreshOrchestrations();
    if (activeView === "chat") {
      if (chatTurn?.status === "running") void pollChatTurn();
      visibleExpertChatPanes().forEach((pane) => {
        if (pane.turn?.status === "running") void pollExpertChatTurn(pane);
      });
    }
  });
  document.addEventListener("fullscreenchange", scheduleFullscreenSync);
  document.addEventListener("webkitfullscreenchange", scheduleFullscreenSync);
  window.addEventListener("resize", scheduleFullscreenSync);
  window.addEventListener("pointermove", (event) => {
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
  }, true);
  window.addEventListener("pointerdown", (event) => {
    lastPointerClientX = event.clientX;
    lastPointerClientY = event.clientY;
  }, true);
  document.addEventListener("pointerleave", () => {
    lastPointerClientX = null;
    lastPointerClientY = null;
  });
  window.addEventListener("blur", () => {
    lastPointerClientX = null;
    lastPointerClientY = null;
  });

  unlistenData = await listen<PtyDataEvent>("pty-data", (event) => {
    const session = terminalSessionsByPtyId.get(event.payload.id);
    session?.terminal.write(event.payload.data);
  });

  unlistenExit = await listen<PtyExitEvent>("pty-exit", (event) => {
    const session = terminalSessionsByPtyId.get(event.payload.id);
    if (!session) return;
    terminalSessionsByPtyId.delete(event.payload.id);

    session.ptyId = null;
    session.running = false;
    session.status = "Ferme";

    if (session.key === activeTerminalKey) {
      statusText = "Terminal ferme";
    }

    // Ne pas re-render tant que l'iframe Kombai tourne : un render() reconstruit
    // app.innerHTML et rechargerait l'editeur embarque (perte de l'etat). L'etat
    // terminal est deja a jour en memoire ; la sidebar se rafraichit au prochain
    // render (changement de vue, clic terminal...).
    if (!(activeView === "kombai" && (kombaiStatus?.running ?? false))) {
      render();
    }
    persistTerminalSessions();
    void persistTerminalDiscussionFolder(session).catch(() => undefined);
  });

  window.addEventListener("resize", () => {
    syncChatSidebarWidthDom();
    fitAndResizeVisibleTerminals();
  });

  window.addEventListener("keydown", (event) => {
    if (!keyboardShortcutMatchesAction("toggle-environments", event) || !settings) return;
    if (
      !terminalEnvironmentMenuOpen &&
      (newTerminalModalOpen || agentsModalOpen || workspaceModalOpen)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    toggleTerminalEnvironmentMenu();
  }, true);

  window.addEventListener("keydown", (event) => {
    const action = chatHoverShortcutAction(event, {
      "close-chat": keyboardShortcutBinding("close-chat"),
      "close-chat-and-discussion": keyboardShortcutBinding("close-chat-and-discussion"),
    });
    if (!action || !closeHoveredExpertChat(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("keydown", (event) => {
    if (!keyboardShortcutMatchesAction("toggle-pane-fullscreen", event)) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true) return;
    if (document.querySelector(".modal-backdrop")) return;
    if (!toggleHoveredExpertFullscreen()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("keydown", (event) => {
    const action: HoveredTerminalShortcutAction | null =
      keyboardShortcutMatchesAction("close-terminal", event)
        ? "close-terminal"
        : keyboardShortcutMatchesAction("maximize-terminal", event)
          ? "maximize-terminal"
          : keyboardShortcutMatchesAction("restore-terminal", event)
            ? "restore-terminal"
            : null;
    if (!action) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable === true) return;
    if (document.querySelector(".modal-backdrop")) return;
    if (!handleHoveredExpertTerminalShortcut(action)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  window.addEventListener("keydown", (event) => {
    if (keyboardShortcutMatchesAction("new-chat", event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openNewChat();
      return;
    }

    if (keyboardShortcutMatchesAction("new-terminal", event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      openNewTerminalModal();
      return;
    }

    if (keyboardShortcutMatchesAction("open-settings", event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveView("settings");
      return;
    }

    if (keyboardShortcutMatchesAction("open-discussions", event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setActiveView("discussions");
      return;
    }

    if (keyboardShortcutMatchesAction("search-discussions", event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!window.matchMedia("(max-width: 760px)").matches && displayedChatSidebarWidth() === 0) {
        setChatSidebarWidth(defaultChatSidebarWidth(window.innerWidth));
      }
      document.body.classList.add("chat-sidebar-open");
      if (window.matchMedia("(max-width: 860px)").matches) {
        syncMobileDrawerAccessibility(true, true);
      } else {
        document.querySelector<HTMLInputElement>("#chatSidebarSearch")?.focus();
      }
      return;
    }

    if (event.key === "Escape" && autonomousMonitorOpen) {
      event.preventDefault();
      closeAutonomousMonitor();
      return;
    }

    if (event.key === "Escape" && discussionArchiveCandidate) {
      event.preventDefault();
      closeDiscussionArchiveModal();
      return;
    }

    if (event.key === "Escape" && terminalEnvironmentMenuOpen) {
      event.preventDefault();
      closeTerminalEnvironmentMenu();
      return;
    }

    if (event.key === "Escape" && workspaceModalOpen) {
      event.preventDefault();
      closeWorkspaceModal();
      return;
    }

    if (event.key === "Escape" && document.body.classList.contains("m-sheet-open")) {
      event.preventDefault();
      closeMobileOverlays();
      return;
    }

    if (event.key === "Escape" && document.body.classList.contains("chat-sidebar-open")) {
      event.preventDefault();
      closeMobileOverlays();
      return;
    }

    if (event.key === "Escape" && agentsModalOpen) {
      event.preventDefault();
      closeAgentsModal();
      return;
    }

    if (event.key === "Escape" && orchestrationConversion) {
      event.preventDefault();
      closeOrchestrationConversion();
      return;
    }

    if (event.key === "Escape" && autonomousChatEditor) {
      event.preventDefault();
      closeAutonomousChatEditor();
      return;
    }

    if (event.key === "Escape" && autonomousOrchestrationPromotion) {
      event.preventDefault();
      closeAutonomousOrchestrationPromotion();
      return;
    }

    if (event.key === "Escape" && newChatModalOpen) {
      event.preventDefault();
      closeNewChatModal();
      return;
    }

    if (event.key === "Escape" && newTerminalModalOpen) {
      event.preventDefault();
      closeNewTerminalModal();
      return;
    }

    if (event.key !== "F11") return;
    event.preventDefault();
    void toggleFullscreen();
  });
};

const renderRemoteLogin = (error: string | null = null) => {
  app.innerHTML = `
    <main class="remote-login">
      <section class="remote-login-panel">
        <div class="remote-login-head">
          <span><i data-lucide="server"></i></span>
          <div>
            <h1>Codex Switch Terminal</h1>
            <p>Connexion au serveur SaaS</p>
          </div>
        </div>
        ${error ? `<div class="remote-login-error">${escapeHtml(error)}</div>` : ""}
        <form id="remoteLoginForm" class="remote-login-form">
          <label>
            <span>Serveur</span>
            <input id="remoteBaseUrl" value="${escapeAttr(remoteBaseUrl())}" placeholder="http://IP_VM:8080" />
          </label>
          <label>
            <span>Token admin</span>
            <input id="remoteToken" type="password" autocomplete="current-password" />
          </label>
          <label>
            <span>Noeuds terminaux auto</span>
            <textarea id="remoteNodes" placeholder="PC fixe|http://100.x.x.x:8080||0&#10;Oracle free|http://100.y.y.y:8080||20">${escapeHtml(remoteNodesText())}</textarea>
          </label>
          <button class="tool-button primary" type="submit">
            <i data-lucide="badge-check"></i>
            <span>Se connecter</span>
          </button>
        </form>
      </section>
    </main>
  `;
  renderIcons(app);
  document.querySelector<HTMLFormElement>("#remoteLoginForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const baseUrl = document.querySelector<HTMLInputElement>("#remoteBaseUrl")?.value.trim() || remoteBaseUrl();
    const token = document.querySelector<HTMLInputElement>("#remoteToken")?.value.trim() || "";
    if (!token) {
      renderRemoteLogin("Token admin requis");
      return;
    }
    const nodes = document.querySelector<HTMLTextAreaElement>("#remoteNodes")?.value ?? "";
    saveRemoteConfig(baseUrl, token, nodes);
    await boot();
  });
};

type IdleCapableWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
};

const scheduleIdleTask = (task: () => void) => {
  const requestIdle = (window as IdleCapableWindow).requestIdleCallback;
  if (requestIdle) requestIdle.call(window, task, { timeout: 4_000 });
  else window.setTimeout(task, 1_000);
};

const initDesktopUpdaterDeferred = () => {
  if (!("__TAURI_INTERNALS__" in window)) return;
  scheduleIdleTask(() => {
    void import("./updater").then(({ initDesktopUpdater }) => initDesktopUpdater());
  });
};

const boot = async () => {
  await initializePlatform();

  if (isRemoteMode()) {
    const userAuth = await initializeUserAuth();
    if (userAuth === "required") {
      renderUserAuthGate(app, boot);
      return;
    }
    if (userAuth === "unsupported" && !hasRemoteAuth()) {
      renderRemoteLogin();
      return;
    }
  }

  try {
    settings = await invoke<AppSettings>("load_settings");
  } catch (error) {
    if (isRemoteMode()) {
      renderRemoteLogin(String(error));
      return;
    }
    throw error;
  }
  selectedAccountId = settings.defaultAccountId || settings.accounts[0]?.id || null;
  chatAccountId = selectedAccountId;
  scheduleUnconnectedAccountCleanup();
  poolNewAccountBypass = settings.codexBypass ?? true;
  // Migre le registre de workspaces (localStorage -> settings) et fixe le
  // filtre par defaut, avant le premier rendu de la barre laterale.
  expertGridLayout = loadExpertGridLayout();
  expertChatPageSizeMode = loadExpertChatPageSizeMode();
  expertChatDisplayMode = loadExpertChatDisplayMode();
  expertChatToolbarHidden = loadExpertChatToolbarHidden();
  chatSidebarWidth = loadChatSidebarWidth();
  const [fullscreen] = await Promise.all([
    appWindow.isFullscreen().catch(() => false),
    setupEvents(),
    syncWorkspaceRegistry(),
  ]);
  isFullscreen = fullscreen;
  activeView = "chat";
  render();
  void refreshSkills();
  startAutonomousAgentsPoll();
  void refreshAutonomousAgents();
  initDesktopUpdaterDeferred();
  startChatRuntimeClock();
  startLimitPoll();
  void refreshLimitStatus(true);
  startDiscussionsPoll();
  void refreshDiscussions().then(() => {
    restoreExpertChats();
    if (activeView === "chat") {
      render();
      startAllExpertChatWork();
    }
    expertChatPanes.forEach((pane) => void loadChatModelCatalog(pane.accountId));
  });
};

window.addEventListener("beforeunload", () => {
  persistTerminalSessions();
  persistExpertChats();
  unlistenData?.();
  unlistenExit?.();
  stopPoolPoll();
  stopLimitPoll();
  stopUnconnectedAccountCleanup();
  stopUsagePoll();
  stopKombaiPoll();
  stopAutonomousAgentsPoll();
  stopAutonomousMonitorTurnPoll();
  stopOrchestrationsPoll();
  stopDiscussionsPoll();
  stopChatSync();
  stopChatTurnPoll();
  stopChatRuntimeClock();
  stopAllExpertChatWork();
  // Le navigateur web ne possede pas le code-server partage du noeud : fermer
  // un onglet ne doit jamais arreter Kombai pour les autres clients. En desktop
  // local, on nettoie uniquement une instance que cette application sait lancee.
  if (!isRemoteMode() && (kombaiStatus?.running || kombaiStatus?.started)) {
    void invoke("kombai_stop").catch(() => undefined);
  }
  terminalSessions.forEach((session) => {
    if (session.ptyId !== null) {
      void invoke("stop_terminal", { id: session.ptyId }).catch(() => undefined);
    }
  });
});

initPwaSupport();

void boot().catch((error) => {
  app.innerHTML = `<main class="boot error">${escapeHtml(String(error))}</main>`;
});
