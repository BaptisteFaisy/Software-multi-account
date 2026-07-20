import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const site = process.env.CST_SMOKE_URL || "http://127.0.0.1:1420";
const chromeCandidates = [
  process.env.CST_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);
const executablePath = chromeCandidates.find(existsSync);

if (!executablePath) throw new Error("Chrome ou Chromium est introuvable.");

const workspace = "C:\\Smoke\\Projet responsive avec un nom volontairement long";
const accounts = Array.from({ length: 3 }, (_, index) => ({
  id: `responsive-account-${index + 1}`,
  label: `Compte responsive ${index + 1} avec un libellé volontairement très long`,
  provider: "codex",
  codexHome: `C:\\Smoke\\.codex-responsive-${index + 1}`,
  projectDir: workspace,
  bypass: false,
  model: "gpt-5-codex",
  reasoningEffort: "high",
}));
const designAccount = {
  id: "responsive-claude-design",
  label: "Compte Claude Design avec un libellé volontairement très long",
  provider: "claude",
  codexHome: "C:\\Smoke\\.claude-responsive-design",
  projectDir: workspace,
  bypass: false,
  model: "claude-sonnet-4-5",
  reasoningEffort: "high",
};
const settings = {
  accounts: [...accounts, designAccount],
  proxies: [],
  defaultAccountId: accounts[0].id,
  shell: "powershell",
  codexCommand: "codex",
  autoRunCodex: false,
  proxyControlsEnabled: false,
  pool: {
    port: 8787,
    apiKey: "",
    defaultModel: "gpt-5-codex",
    reasoningEffort: "high",
    upstream: "",
    requestTimeoutSecs: 120,
    cooldownSecs429: 60,
    concurrency: 1,
    clientIdOverride: "",
  },
  agents: [{
    id: "codex",
    label: "Codex",
    command: "codex",
    provider: "codex",
    kind: "cli",
    builtin: true,
  }],
  activeAgentId: "codex",
  kombai: {
    codeServerCommand: "code-server",
    port: 3000,
    extensionId: "",
    autoInstallExtension: false,
  },
  codexBypass: false,
  autoDiscoverAccounts: false,
  workspaces: [{ id: "smoke/responsive", label: "Projet responsive", path: workspace, memory: "" }],
  closedWorkspaceIds: [],
};

const today = new Date().toISOString().slice(0, 10);
const day = (offset, multiplier = 1) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  const totalTokens = (offset + 1) * 12_345 * multiplier;
  return {
    date: date.toISOString().slice(0, 10),
    sessions: offset % 4 + 1,
    inputTokens: Math.round(totalTokens * 0.72),
    cachedInputTokens: Math.round(totalTokens * 0.18),
    outputTokens: Math.round(totalTokens * 0.28),
    reasoningOutputTokens: Math.round(totalTokens * 0.08),
    totalTokens,
    costUsd: totalTokens / 1_000_000,
  };
};
const accountUsageAccounts = accounts.map((account, index) => {
  const days = Array.from({ length: 30 }, (_, offset) => day(offset, index + 1));
  const totalTokens = days.reduce((sum, item) => sum + item.totalTokens, 0);
  return {
    id: account.id,
    label: account.label,
    profileLabels: [account.label],
    codexHome: account.codexHome,
    hasTokens: true,
    usageSource: "codex-account",
    sourceError: null,
    sessionCount: 42 + index,
    inputTokens: Math.round(totalTokens * 0.72),
    cachedInputTokens: Math.round(totalTokens * 0.18),
    outputTokens: Math.round(totalTokens * 0.28),
    reasoningOutputTokens: Math.round(totalTokens * 0.08),
    totalTokens,
    costUsd: totalTokens / 1_000_000,
    todayTokens: days[0].totalTokens,
    todayCostUsd: days[0].costUsd,
    monthTokens: totalTokens,
    monthCostUsd: totalTokens / 1_000_000,
    firstActivity: Date.now() - 30 * 86_400_000,
    lastActivity: Date.now(),
    days,
    error: null,
  };
});
const totalTokens = accountUsageAccounts.reduce((sum, account) => sum + account.totalTokens, 0);
const accountUsage = {
  generatedAt: Date.now(),
  profileCount: accounts.length,
  totalTokens,
  totalCostUsd: totalTokens / 1_000_000,
  totalSessions: accountUsageAccounts.reduce((sum, account) => sum + account.sessionCount, 0),
  accounts: accountUsageAccounts,
};
const usageDay = {
  date: today,
  agentRunSeconds: 0,
  agentRuns: 0,
  apiRequests: 0,
  apiErrors: 0,
  apiSeconds: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  estimatedRequests: 0,
  costUsd: 0,
};
const usage = {
  generatedAt: Date.now(),
  totalAgentSeconds: 0,
  totalAgentRuns: 0,
  activeAgentCount: 0,
  totalApiRequests: 0,
  totalApiErrors: 0,
  totalTokens: 0,
  totalCostUsd: 0,
  today: usageDay,
  days: [usageDay],
};
const limits = accounts.map((account, index) => ({
  id: account.id,
  label: account.label,
  provider: account.provider,
  codexHome: account.codexHome,
  hasTokens: true,
  connectedAt: Date.now() - 3_600_000,
  sessionResetAt: Date.now() + (index + 1) * 3_600_000,
  weeklyResetAt: Date.now() + (index + 1) * 86_400_000,
  sessionRemainingSecs: (index + 1) * 3_600,
  weeklyRemainingSecs: (index + 1) * 86_400,
  sessionUsedPercent: 22 + index * 18,
  weeklyUsedPercent: 35 + index * 16,
  buckets: [{
    limitId: `limit-${index + 1}`,
    limitName: "Fenêtre de contexte avec un nom volontairement long",
    bucket: "primary",
    windowDurationMins: 300,
    resetsAt: Date.now() + (index + 1) * 3_600_000,
    usedPercent: 22 + index * 18,
    rateLimitReachedType: null,
    planType: "plus",
  }],
  refreshedAt: Date.now(),
  source: "server",
  error: null,
}));

const tasks = Array.from({ length: 9 }, (_, index) => ({
  id: `responsive-task-${index + 1}`,
  title: `Tâche responsive ${index + 1} avec un intitulé assez long pour éprouver les cartes`,
  completed: index % 4 === 0,
  createdAt: Date.now() - index * 60_000,
  completedAt: index % 4 === 0 ? Date.now() - index * 30_000 : null,
  priority: index % 3 === 0 ? "high" : index % 3 === 1 ? "normal" : "low",
  dueDate: today,
  environmentPath: workspace,
}));

const scheduledChats = Array.from({ length: 5 }, (_, index) => ({
  id: `responsive-scheduled-chat-${index + 1}`,
  prompt: `Tâche planifiée ${index + 1} avec une description assez longue pour vérifier le retour à la ligne et les actions de la carte.`,
  environmentPath: workspace,
  accountId: accounts[index % accounts.length].id,
  mode: index % 2 === 0 ? "build" : "plan",
  scheduledFor: Date.now() + (index + 1) * 3_600_000,
  status: "scheduled",
  createdAt: Date.now() - index * 60_000,
  updatedAt: Date.now() - index * 60_000,
  launchedAt: null,
  error: null,
}));

const promptItems = Array.from({ length: 8 }, (_, index) => ({
  id: `responsive-prompt-${index + 1}`,
  title: `Prompt responsive ${index + 1} avec un intitulé volontairement long pour éprouver les cartes`,
  content: `Analyse ce parcours complexe puis propose une interface claire, accessible et responsive. Conserve tous les détails utiles au scénario ${index + 1}.`,
  category: index % 2 === 0 ? "Interface et accessibilité" : "Développement frontend",
  tags: ["responsive", "accessibilité", `scénario-${index + 1}`],
  favorite: index % 3 === 0,
  createdAt: Date.now() - (index + 1) * 86_400_000,
  updatedAt: Date.now() - index * 3_600_000,
  useCount: index * 7,
  lastUsedAt: index === 0 ? null : Date.now() - index * 60_000,
}));

const videoHistory = Array.from({ length: 6 }, (_, index) => ({
  localId: `responsive-video-${index + 1}`,
  accountId: "responsive-fal-account",
  requestId: `responsive-request-${index + 1}`,
  modelId: index % 2 === 0 ? "wan-2.6" : "kling-3-standard",
  mode: "text",
  status: index === 0 ? "completed" : index === 1 ? "in_progress" : "failed",
  prompt: `Plan séquence cinématographique ${index + 1} avec une description assez longue pour tester la mise en page de l’historique vidéo`,
  negativePrompt: "texte illisible, filigrane, scintillement",
  aspectRatio: "16:9",
  duration: 5,
  resolution: "720p",
  generateAudio: index % 2 === 0,
  imageName: null,
  createdAt: Date.now() - index * 3_600_000,
  updatedAt: Date.now() - index * 3_000_000,
  queuePosition: index === 1 ? 2 : null,
  logs: [`Étape ${index + 1} prête`, "Traitement du rendu responsive"],
  videoUrl: index === 0 ? "https://example.com/responsive-video.mp4" : null,
  actualPrompt: null,
  seed: 12_345 + index,
  inferenceSeconds: index === 0 ? 42 : null,
  error: index > 1 ? "Le moteur distant a renvoyé un message d’erreur volontairement détaillé pour la preuve responsive." : null,
  trackingError: null,
}));

const imageHistory = Array.from({ length: 4 }, (_, index) => ({
  localId: `responsive-image-${index + 1}`,
  accountId: "responsive-fal-account",
  requestId: `responsive-image-request-${index + 1}`,
  modelId: "flux-2-flash",
  status: "failed",
  prompt: `Illustration responsive ${index + 1} avec une description volontairement longue pour éprouver l’historique du studio image`,
  negativePrompt: "texte illisible, artefacts",
  imageSize: index % 2 === 0 ? "landscape_16_9" : "portrait_9_16",
  style: index % 2 === 0 ? "photo" : "auto",
  numImages: 1,
  createdAt: Date.now() - index * 3_600_000,
  updatedAt: Date.now() - index * 3_000_000,
  queuePosition: null,
  logs: ["Préparation du rendu image", "État de démonstration responsive"],
  images: [],
  seed: 42_000 + index,
  inferenceSeconds: null,
  error: "État de démonstration avec un message assez long pour vérifier le retour à la ligne.",
  trackingError: null,
}));

const forumAuthor = {
  id: "responsive-forum-author",
  username: "Membre avec un pseudonyme volontairement très long",
  avatarUrl: null,
};
const forumTopics = Array.from({ length: 7 }, (_, index) => ({
  id: `responsive-topic-${index + 1}`,
  title: `Discussion responsive ${index + 1} avec un titre volontairement long sur l’amélioration des interfaces`,
  excerpt: "Retour d’expérience détaillé sur les petits écrans, les faibles hauteurs et les contenus très longs.",
  author: forumAuthor,
  createdAt: Math.floor(Date.now() / 1_000) - (index + 1) * 3_600,
  lastActivityAt: Math.floor(Date.now() / 1_000) - index * 600,
  activitySequence: 100 - index,
  replyCount: 5,
  lastReplyAuthor: forumAuthor,
}));
const forumTopic = {
  ...forumTopics[0],
  body: "Voici une description complète du problème rencontré sur mobile, avec des mots très longs et des chemins comme C:\\Projets\\Interface-responsive\\preuve-finale.",
  replies: Array.from({ length: 5 }, (_, index) => ({
    id: `responsive-reply-${index + 1}`,
    author: forumAuthor,
    body: `Réponse ${index + 1} : le contenu doit rester lisible, défilable et entièrement accessible quelle que soit la géométrie de la fenêtre.`,
    createdAt: Math.floor(Date.now() / 1_000) - index * 300,
  })),
};

const videoCapabilities = {
  configured: true,
  service: "moteur de génération responsive avec un nom long",
  configurationHint: "",
  maxImageBytes: 8 * 1024 * 1024,
  models: [{
    id: "wan-2.6",
    label: "WAN 2.6 cinématique haute fidélité",
    maker: "Fournisseur vidéo au libellé long",
    description: "Génération polyvalente avec mouvements de caméra et cohérence temporelle.",
    quality: "Haute qualité",
    supportsImage: true,
    supportsAudio: true,
    aspectRatios: ["16:9", "9:16", "1:1"],
    durations: [5, 10],
    resolutions: ["720p", "1080p"],
    defaultAspectRatio: "16:9",
    defaultDuration: 5,
    defaultResolution: "720p",
  }, {
    id: "kling-3-standard",
    label: "Kling 3 Standard avec un nom long",
    maker: "Kling",
    description: "Alternative rapide pour éprouver deux cartes de modèles côte à côte.",
    quality: "Standard",
    supportsImage: true,
    supportsAudio: false,
    aspectRatios: ["16:9", "9:16"],
    durations: [5],
    resolutions: ["720p"],
    defaultAspectRatio: "16:9",
    defaultDuration: 5,
    defaultResolution: "720p",
  }],
};

const creativeAccounts = {
  accounts: [{
    id: "responsive-fal-account",
    provider: "fal",
    label: "Compte fal.ai responsive avec un libellé volontairement long",
    keyHint: "resp…sive",
    isDefault: true,
    source: "stored",
    createdAt: Date.now(),
  }],
  defaultAccountId: "responsive-fal-account",
  provider: "fal.ai",
  dashboardUrl: "https://fal.ai/dashboard/keys",
  authenticationNote: "Compte de démonstration dont la clé reste exclusivement côté backend.",
};

const imageCapabilities = {
  configured: true,
  service: "fal.ai",
  configurationHint: "",
  models: [{
    id: "flux-2-flash",
    label: "Flux 2 Flash avec un nom volontairement long",
    maker: "Black Forest Labs",
    description: "Création rapide d’images détaillées pour les maquettes et illustrations.",
    quality: "Rapide",
    imageSizes: ["square_hd", "landscape_16_9", "portrait_9_16"],
    styles: [{ id: "auto", label: "Automatique" }, { id: "photo", label: "Photographique" }],
    maxImages: 4,
    supportsNegativePrompt: true,
    defaultImageSize: "square_hd",
    defaultStyle: "auto",
  }],
};

const vpsJobs = Array.from({ length: 3 }, (_, index) => ({
  id: `responsive-vps-job-${index + 1}`,
  nodeId: `vps-responsive-${index + 1}`,
  nodeLabel: `Nœud VPS responsive ${index + 1} avec un nom volontairement long`,
  sshTarget: `administrateur-responsive-${index + 1}@203.0.113.${20 + index}`,
  localPort: 8081 + index,
  status: index === 0 ? "succeeded" : index === 1 ? "running" : "failed",
  message: "Déploiement de contrôle avec un message assez long pour vérifier le retour à la ligne dans toutes les cartes.",
  log: "Préparation du serveur\nTransfert des fichiers\nVérification finale avec une ligne de journal volontairement très longue.",
  createdAt: Math.floor(Date.now() / 1_000) - index * 3_600,
  finishedAt: index === 1 ? null : Math.floor(Date.now() / 1_000) - index * 3_000,
  exitCode: index === 0 ? 0 : index === 1 ? null : 1,
}));

const jsonFor = (path) => {
  if (path === "/api/settings") return settings;
  if (path === "/api/limits") return limits;
  if (path === "/api/usage") return usage;
  if (path === "/api/account-usage") return accountUsage;
  if (path === "/api/forum/topics") return forumTopics;
  if (path.startsWith("/api/forum/topics/")) return forumTopic;
  if (path === "/api/creative/accounts") return creativeAccounts;
  if (path === "/api/video/capabilities") return videoCapabilities;
  if (path === "/api/image/capabilities") return imageCapabilities;
  if (path === "/api/vps/capabilities") {
    return {
      supported: true,
      platform: "win32",
      powershell: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      scriptPath: "C:\\Smoke\\scripts\\deploy-vps.ps1",
      missingCommands: [],
      message: "Prêt",
    };
  }
  if (path === "/api/vps/google/status") {
    return {
      supported: true,
      installed: true,
      authenticated: false,
      account: null,
      projects: [],
      selectedProject: null,
      billingReady: false,
      billingEnabled: false,
      authInProgress: false,
      message: "Connecte un compte Google pour continuer.",
    };
  }
  if (path === "/api/vps/deployments") return vpsJobs;
  if (path === "/api/discussions") {
    return { generatedAt: Date.now(), totalDiscussions: 0, accounts: [] };
  }
  if (path === "/api/chat/models" || path === "/api/autonomous-agents" || path === "/api/orchestrations") return [];
  if (path.includes("/events") || path.includes("/history") || path.includes("skills")) return [];
  if (path.includes("pool") && path.includes("status")) return { running: false, accounts: [] };
  if (path.includes("voice") || path.includes("gpu")) {
    return {
      mode: "local",
      state: "unavailable",
      stage: "idle",
      transcriptionModel: "whisper",
      summaryModel: "llama",
      transcriptionTarget: "local",
      summaryTarget: "unknown",
      whisperReady: false,
      ollamaReachable: false,
      summaryModelLoaded: false,
      summaryModelOnGpu: false,
    };
  }
  return {};
};

const viewportMatrix = [
  { name: "phone-portrait", width: 390, height: 844 },
  { name: "phone-compact", width: 390, height: 568 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "tablet-landscape", width: 1024, height: 768 },
];
const specializedViewportMatrix = [
  {
    name: "phone-compact",
    width: 390,
    height: 568,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  {
    name: "keyboard-portrait",
    width: 390,
    height: 360,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
  {
    name: "phone-landscape",
    width: 844,
    height: 390,
    safeArea: { top: 0, right: 47, bottom: 21, left: 47 },
  },
  {
    name: "keyboard-landscape",
    width: 667,
    height: 320,
    safeArea: { top: 0, right: 47, bottom: 21, left: 47 },
  },
];
const selectedVideoKind = process.env.CST_ADMIN_VIDEO_KIND === "image" ? "image" : "video";
const shellViewportMatrix = [
  { name: "desktop-wide", width: 1440, height: 900, mobile: false },
  { name: "desktop-low", width: 1180, height: 480, mobile: false },
  { name: "tablet-above-compact", width: 981, height: 620, mobile: false },
  { name: "tablet-compact", width: 980, height: 620, mobile: false },
  { name: "tablet-mobile-edge-low", width: 861, height: 390, mobile: false },
  { name: "mobile-edge-low", width: 860, height: 390, mobile: true },
  { name: "desktop-return", width: 1180, height: 720, mobile: false },
];
const viewMatrix = [
  { name: "settings", trigger: "#settingsToggle", root: ".settings-panel" },
  { name: "limits", trigger: "#limitsToggle", root: ".limits-panel" },
  { name: "dashboard", trigger: "#dashboardToggle", root: ".stats-dashboard" },
  { name: "tasks", trigger: "#tasksToggle", root: ".tasks-panel" },
  { name: "scheduled-chat", trigger: "#scheduledChatToggle", root: ".scheduled-chats-panel" },
  { name: "forum", trigger: "#forumToggle", root: ".forum-panel" },
  { name: "design", trigger: "#designToggle", root: ".design-panel" },
  { name: "video", trigger: "#videoToggle", root: ".video-panel", creativeKind: selectedVideoKind },
  { name: "vps", trigger: "#vpsToggle", root: ".vps-panel" },
  { name: "prompts", trigger: "#promptsToggle", root: ".prompt-library-panel" },
];
const specializedStateMatrix = [
  {
    name: "forum-detail",
    view: "forum",
    trigger: "#forumToggle",
    viewRoot: ".forum-panel",
    root: ".forum-panel",
    action: "forum-detail",
    ready: ".forum-thread",
    required: ["[data-forum-back]", "#forumReplyBody", ".forum-reply-form button[type='submit']"],
  },
  {
    name: "forum-compose",
    view: "forum",
    trigger: "#forumToggle",
    viewRoot: ".forum-panel",
    root: ".forum-panel",
    action: "forum-compose",
    ready: ".forum-compose-topic",
    required: ["#forumTopicTitle", "#forumTopicBody", "#forumTopicCancel", "#forumTopicForm button[type='submit']"],
  },
  {
    name: "prompt-editor",
    view: "prompts",
    trigger: "#promptsToggle",
    viewRoot: ".prompt-library-panel",
    root: ".prompt-library-panel",
    action: "prompt-editor",
    ready: ".prompt-editor-card",
    required: ["#promptEditorTitleInput", "#promptEditorContent", "#promptEditorCancel", "#promptEditorForm button[type='submit']"],
  },
  {
    name: "vps-options",
    view: "vps",
    trigger: "#vpsToggle",
    viewRoot: ".vps-panel",
    root: ".vps-panel",
    action: "vps-options",
    ready: "#vpsAdvancedSettings",
    required: ["#vpsDetailsToggle", "#vpsAdvancedSettings input", ".vps-submit"],
  },
  {
    name: "creative-accounts",
    view: "video",
    trigger: "#videoToggle",
    viewRoot: ".video-panel",
    root: ".creative-account-modal",
    action: "creative-accounts",
    ready: ".creative-account-modal",
    overlay: true,
    required: ["#creativeAccountsClose", "#creativeAccountLabel", "#creativeAccountKey", "#creativeAccountForm button[type='submit']"],
  },
];
const selectedNames = (value) => new Set(
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const selectedViewports = selectedNames(process.env.CST_ADMIN_VIEWPORTS);
const selectedViews = selectedNames(process.env.CST_ADMIN_VIEWS);
const selectedStates = selectedNames(process.env.CST_ADMIN_STATES);
const debugLayout = process.env.CST_ADMIN_DEBUG === "1";
const shellOnly = process.env.CST_ADMIN_SHELL_ONLY === "1";
const skipShell = process.env.CST_ADMIN_SKIP_SHELL === "1";
const shellScreenshotPath = process.env.CST_ADMIN_SHELL_SCREENSHOT?.trim() || "";
const specializedStates = process.env.CST_ADMIN_SPECIALIZED_STATES === "1";
const viewports = (specializedStates ? specializedViewportMatrix : viewportMatrix).filter(
  ({ name }) => !selectedViewports.size || selectedViewports.has(name),
);
const views = viewMatrix.filter(({ name }) => !selectedViews.size || selectedViews.has(name));
const states = specializedStateMatrix.filter(({ name, view }) =>
  (!selectedStates.size || selectedStates.has(name))
  && (!selectedViews.size || selectedViews.has(view)));

if (!shellOnly && (!viewports.length || (!specializedStates && !views.length))) {
  throw new Error("La sélection de vues ou de viewports du smoke admin est vide.");
}
if (specializedStates && !states.length) {
  throw new Error("La sélection d’états spécialisés du smoke admin est vide.");
}
if (shellOnly && skipShell) {
  throw new Error("CST_ADMIN_SHELL_ONLY et CST_ADMIN_SKIP_SHELL ne peuvent pas être combinés.");
}

const browser = await chromium.launch({ executablePath, headless: true });
const failures = [];
const measurements = [];
const stateMeasurements = [];
const shellMeasurements = [];
let sidebarToggleMeasurement = null;
let contextSidebarResizeMeasurement = null;
const contextNavigationMeasurements = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    locale: "fr-FR",
    serviceWorkers: "block",
  });
  await context.addInitScript(({ workspacePath, taskItems, scheduledChatItems, prompts, videos, images }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "responsive-smoke-token");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
    localStorage.setItem("codex-switch-terminal.tasks.v1", JSON.stringify(taskItems));
    localStorage.setItem(
      "codex-switch-terminal.scheduled-chats.v1",
      JSON.stringify(scheduledChatItems),
    );
    localStorage.setItem("codex-switch-terminal.prompts.v1", JSON.stringify(prompts));
    localStorage.setItem("codex-switch-terminal.video-generations.v1", JSON.stringify(videos));
    localStorage.setItem("codex-switch-terminal.image-generations.v1", JSON.stringify(images));
  }, {
    workspacePath: workspace,
    taskItems: tasks,
    scheduledChatItems: scheduledChats,
    prompts: promptItems,
    videos: videoHistory,
    images: imageHistory,
  });

  const page = await context.newPage();
  const cdpSession = specializedStates ? await context.newCDPSession(page) : null;
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack || error}`));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: jsonFor(path) });
  });

  await page.goto(`${site}/?smoke=admin-responsive`, { waitUntil: "domcontentloaded" });
  await page.locator("#chatAppSidebar").waitFor({ state: "attached" });

  if (!skipShell) {
  for (const viewport of shellViewportMatrix) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    // La sidebar mobile est animee pendant 180 ms : mesurer son etat final,
    // pas une image intermediaire de la transition 860/861 px.
    await page.waitForTimeout(240);

    const diagnostic = await page.evaluate(() => {
      const layout = document.querySelector(".chat-app-layout");
      const sidebar = document.querySelector(".chat-app-sidebar");
      const contextSidebar = document.querySelector(".chat-context-sidebar");
      const workspaceElement = document.querySelector(".chat-main-workspace");
      const resizer = document.querySelector(".chat-sidebar-resizer");
      const chrome = document.querySelector(".m-chrome");
      const topbar = document.querySelector(".m-topbar");
      const bottomnav = document.querySelector(".m-bottomnav");
      if (!(layout instanceof HTMLElement)
        || !(sidebar instanceof HTMLElement)
        || !(contextSidebar instanceof HTMLElement)
        || !(workspaceElement instanceof HTMLElement)
        || !(resizer instanceof HTMLElement)) return null;

      const bounds = (element) => {
        if (!(element instanceof HTMLElement)) return null;
        const rect = element.getBoundingClientRect();
        return {
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          left: rect.left,
          width: rect.width,
          height: rect.height,
        };
      };
      const isRendered = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const labelFor = (element) => element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
        || element.id
        || element.tagName;
      const canScrollTo = (element, axis, boundary) => {
        for (let parent = element.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          const overflow = axis === "x" ? style.overflowX : style.overflowY;
          const scrollSize = axis === "x" ? parent.scrollWidth : parent.scrollHeight;
          const clientSize = axis === "x" ? parent.clientWidth : parent.clientHeight;
          if (["auto", "scroll"].includes(overflow) && scrollSize > clientSize + 1) return true;
          if (parent === boundary) break;
        }
        return false;
      };
      const unreachableControls = (boundary) => {
        const boundaryRect = boundary.getBoundingClientRect();
        return [...boundary.querySelectorAll(
          "button, a[href], input:not([type='hidden']), select, textarea, summary, [tabindex]",
        )]
          .filter(isRendered)
          .flatMap((element) => {
            const rect = element.getBoundingClientRect();
            const horizontal = rect.left < boundaryRect.left - 1 || rect.right > boundaryRect.right + 1;
            const vertical = rect.top < boundaryRect.top - 1 || rect.bottom > boundaryRect.bottom + 1;
            const blockedHorizontally = horizontal && !canScrollTo(element, "x", boundary);
            const blockedVertically = vertical && !canScrollTo(element, "y", boundary);
            return blockedHorizontally || blockedVertically ? [labelFor(element)] : [];
          });
      };

      const layoutStyle = getComputedStyle(layout);
      const sidebarStyle = getComputedStyle(sidebar);
      const contextSidebarStyle = getComputedStyle(contextSidebar);
      const workspaceStyle = getComputedStyle(workspaceElement);
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight },
        documentOverflow: Math.max(
          document.documentElement.scrollWidth,
          document.body.scrollWidth,
        ) - window.innerWidth,
        layout: {
          ...bounds(layout),
          clientWidth: layout.clientWidth,
          scrollWidth: layout.scrollWidth,
          display: layoutStyle.display,
          gridTemplateColumns: layoutStyle.gridTemplateColumns,
        },
        sidebar: {
          ...bounds(sidebar),
          clientHeight: sidebar.clientHeight,
          scrollHeight: sidebar.scrollHeight,
          clientWidth: sidebar.clientWidth,
          scrollWidth: sidebar.scrollWidth,
          position: sidebarStyle.position,
          overflowX: sidebarStyle.overflowX,
          overflowY: sidebarStyle.overflowY,
          transform: sidebarStyle.transform,
        },
        contextSidebar: {
          ...bounds(contextSidebar),
          clientHeight: contextSidebar.clientHeight,
          scrollHeight: contextSidebar.scrollHeight,
          clientWidth: contextSidebar.clientWidth,
          scrollWidth: contextSidebar.scrollWidth,
          display: contextSidebarStyle.display,
          overflowX: contextSidebarStyle.overflowX,
          overflowY: contextSidebarStyle.overflowY,
        },
        workspace: {
          ...bounds(workspaceElement),
          clientWidth: workspaceElement.clientWidth,
          scrollWidth: workspaceElement.scrollWidth,
          overflowX: workspaceStyle.overflowX,
          overflowY: workspaceStyle.overflowY,
        },
        resizer: {
          ...bounds(resizer),
          display: getComputedStyle(resizer).display,
        },
        mobileChromeDisplay: chrome instanceof HTMLElement ? getComputedStyle(chrome).display : null,
        topbar: bounds(topbar),
        bottomnav: bounds(bottomnav),
        bodyClasses: [...document.body.classList],
        sidebarControlsOutsideReach: unreachableControls(sidebar),
        contextSidebarControlsOutsideReach: unreachableControls(contextSidebar),
        workspaceControlsOutsideReach: unreachableControls(workspaceElement),
      };
    });

    if (!diagnostic) {
      failures.push(`${viewport.name}: coque non mesurable`);
      continue;
    }
    shellMeasurements.push({ name: viewport.name, ...diagnostic });
    const prefix = `shell/${viewport.name}`;
    const {
      layout,
      sidebar,
      contextSidebar,
      workspace: shellWorkspace,
      resizer,
    } = diagnostic;
    if (diagnostic.documentOverflow > 1
      || layout.scrollWidth > layout.clientWidth + 1
      || sidebar.scrollWidth > sidebar.clientWidth + 1
      || contextSidebar.scrollWidth > contextSidebar.clientWidth + 1
      || shellWorkspace.scrollWidth > shellWorkspace.clientWidth + 1) {
      failures.push(`${prefix}: debordement horizontal ${JSON.stringify(diagnostic)}`);
    }
    if (Math.abs(layout.left) > 1
      || Math.abs(layout.top) > 1
      || Math.abs(layout.right - viewport.width) > 1
      || Math.abs(layout.bottom - viewport.height) > 1) {
      failures.push(`${prefix}: coque hors viewport ${JSON.stringify(diagnostic)}`);
    }
    if (diagnostic.workspaceControlsOutsideReach.length) {
      failures.push(`${prefix}: controles du contenu inaccessibles ${JSON.stringify(diagnostic.workspaceControlsOutsideReach)}`);
    }

    if (viewport.mobile) {
      if (diagnostic.mobileChromeDisplay === "none"
        || sidebar.position !== "fixed"
        || sidebar.right > 1
        || contextSidebar.display !== "none"
        || resizer.display !== "none"
        || !diagnostic.topbar
        || !diagnostic.bottomnav
        || shellWorkspace.top < diagnostic.topbar.bottom - 1
        || shellWorkspace.bottom > diagnostic.bottomnav.top + 1
        || Math.abs(shellWorkspace.left) > 1
        || Math.abs(shellWorkspace.right - viewport.width) > 1) {
        failures.push(`${prefix}: transition mobile incorrecte ${JSON.stringify(diagnostic)}`);
      }
    } else {
      if (diagnostic.mobileChromeDisplay !== "none"
        || sidebar.position !== "relative"
        || sidebar.width <= 0
        || contextSidebar.display === "none"
        || contextSidebar.width <= 0
        || Math.abs(sidebar.left) > 1
        || Math.abs(sidebar.top) > 1
        || Math.abs(sidebar.bottom - viewport.height) > 1
        || resizer.display === "none"
        || Math.abs(shellWorkspace.left - sidebar.right) > 1
        || Math.abs(shellWorkspace.right - contextSidebar.left) > 1
        || Math.abs(contextSidebar.right - viewport.width) > 1
        || Math.abs(shellWorkspace.top) > 1
        || Math.abs(shellWorkspace.bottom - viewport.height) > 1) {
        failures.push(`${prefix}: repartition desktop incorrecte ${JSON.stringify(diagnostic)}`);
      }
      if (diagnostic.sidebarControlsOutsideReach.length) {
        failures.push(`${prefix}: controles de sidebar inaccessibles ${JSON.stringify(diagnostic.sidebarControlsOutsideReach)}`);
      }
      if (diagnostic.contextSidebarControlsOutsideReach.length) {
        failures.push(`${prefix}: controles du menu droit inaccessibles ${JSON.stringify(diagnostic.contextSidebarControlsOutsideReach)}`);
      }
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(240);
  await page.locator("#chatContextSidebarResizer").dblclick();
  await page.waitForTimeout(80);
  const contextBefore = await page.evaluate(() => {
    const sidebar = document.querySelector(".chat-context-sidebar");
    const workspaceElement = document.querySelector(".chat-main-workspace");
    if (!(sidebar instanceof HTMLElement) || !(workspaceElement instanceof HTMLElement)) return null;
    return {
      width: sidebar.getBoundingClientRect().width,
      workspaceWidth: workspaceElement.getBoundingClientRect().width,
    };
  });
  const contextResizerBox = await page.locator("#chatContextSidebarResizer").boundingBox();
  if (contextResizerBox) {
    const startX = contextResizerBox.x + contextResizerBox.width / 2;
    const startY = contextResizerBox.y + contextResizerBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 84, startY, { steps: 6 });
    await page.mouse.up();
  }
  await page.waitForTimeout(100);
  const contextAfterDrag = await page.evaluate(() => {
    const layout = document.querySelector(".chat-app-layout");
    const sidebar = document.querySelector(".chat-context-sidebar");
    const workspaceElement = document.querySelector(".chat-main-workspace");
    const resizer = document.querySelector("#chatContextSidebarResizer");
    if (!(layout instanceof HTMLElement)
      || !(sidebar instanceof HTMLElement)
      || !(workspaceElement instanceof HTMLElement)
      || !(resizer instanceof HTMLElement)) return null;
    return {
      width: sidebar.getBoundingClientRect().width,
      workspaceWidth: workspaceElement.getBoundingClientRect().width,
      compact: layout.classList.contains("is-context-sidebar-compact"),
      stored: localStorage.getItem("codex-switch-terminal.chat-context-sidebar-width.v1"),
      ariaValue: resizer.getAttribute("aria-valuenow"),
    };
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator("#chatContextSidebarResizer").waitFor({ state: "visible" });
  const contextAfterReload = await page.evaluate(() => {
    const sidebar = document.querySelector(".chat-context-sidebar");
    return sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : null;
  });
  await page.locator("#chatContextSidebarResizer").focus();
  await page.keyboard.press("Home");
  const contextAfterHome = await page.evaluate(() => {
    const layout = document.querySelector(".chat-app-layout");
    const sidebar = document.querySelector(".chat-context-sidebar");
    if (!(layout instanceof HTMLElement) || !(sidebar instanceof HTMLElement)) return null;
    return {
      width: sidebar.getBoundingClientRect().width,
      compact: layout.classList.contains("is-context-sidebar-compact"),
    };
  });
  await page.locator("#chatContextSidebarResizer").dblclick();
  await page.waitForTimeout(80);
  const contextAfterReset = await page.evaluate(() => {
    const sidebar = document.querySelector(".chat-context-sidebar");
    return {
      width: sidebar instanceof HTMLElement ? sidebar.getBoundingClientRect().width : null,
      stored: localStorage.getItem("codex-switch-terminal.chat-context-sidebar-width.v1"),
    };
  });
  contextSidebarResizeMeasurement = {
    before: contextBefore,
    afterDrag: contextAfterDrag,
    afterReload: contextAfterReload,
    afterHome: contextAfterHome,
    afterReset: contextAfterReset,
  };
  if (!contextBefore
    || !contextResizerBox
    || !contextAfterDrag
    || !contextAfterHome
    || !contextAfterReset
    || Math.abs(contextAfterDrag.width - (contextBefore.width + 84)) > 2
    || Math.abs(Number(contextAfterDrag.stored) - contextAfterDrag.width) > 2
    || Math.abs(Number(contextAfterDrag.ariaValue) - contextAfterDrag.width) > 2
    || Math.abs((contextAfterReload ?? 0) - contextAfterDrag.width) > 2
    || contextAfterDrag.workspaceWidth < 360
    || Math.abs(contextAfterHome.width - 72) > 1
    || !contextAfterHome.compact
    || Math.abs((contextAfterReset.width ?? 0) - 236) > 1
    || contextAfterReset.stored !== null) {
    failures.push(`shell/context-sidebar-resize: largeur non conservee ${JSON.stringify(contextSidebarResizeMeasurement)}`);
  }

  const contextNavigationMatrix = [
    { name: "messages", trigger: "#messagingToggle", root: ".messaging-panel" },
    { name: "tasks", trigger: "#tasksToggle", root: ".tasks-panel" },
    { name: "scheduled", trigger: "#scheduledChatToggle", root: ".scheduled-chats-panel" },
    { name: "tutorial", trigger: "#tutorialToggle", root: ".tutorial-panel" },
    { name: "prompts", trigger: "#promptsToggle", root: ".prompt-library-panel" },
    { name: "discussions", trigger: "#sideDiscussions", root: ".discussions-panel" },
    { name: "dashboard", trigger: "#dashboardToggle", root: ".stats-dashboard" },
    { name: "limits", trigger: "#limitsToggle", root: ".limits-panel" },
    { name: "settings", trigger: "#settingsToggle", root: ".settings-panel" },
  ];
  for (const item of contextNavigationMatrix) {
    try {
      await page.locator(item.trigger).click();
      await page.locator(item.root).waitFor({ state: "visible" });
      const current = await page.locator(item.trigger).getAttribute("aria-current");
      contextNavigationMeasurements.push({ name: item.name, current });
      if (current !== "page") failures.push(`shell/context-navigation/${item.name}: bouton non actif`);
    } catch (error) {
      failures.push(`shell/context-navigation/${item.name}: ${String(error)}`);
    }
  }
  await page.locator("#chatSideMoreToggle").click();
  await page.locator("#chatSideMoreMenu").waitFor({ state: "visible" });
  await page.locator("#poolToggle").click();
  await page.locator(".pool-panel").waitFor({ state: "visible" });
  contextNavigationMeasurements.push({
    name: "more-pool",
    current: await page.locator("#poolToggle").getAttribute("aria-current"),
  });
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme || "dark");
  await page.locator("#themeToggle").click();
  await page.waitForFunction((before) => (document.documentElement.dataset.theme || "dark") !== before, themeBefore);
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme || "dark");
  await page.locator("#themeToggle").click();
  contextNavigationMeasurements.push({ name: "theme", before: themeBefore, after: themeAfter });

  await page.setViewportSize({ width: 1180, height: 720 });
  await page.waitForTimeout(240);

  await page.locator("#chatSidebarCollapse").click();
  await page.waitForFunction(() => document.querySelector(".chat-app-layout")?.classList.contains("is-sidebar-collapsed"));
  const collapsed = await page.evaluate(() => {
    const layout = document.querySelector(".chat-app-layout");
    const sidebar = document.querySelector(".chat-app-sidebar");
    const contextSidebar = document.querySelector(".chat-context-sidebar");
    const workspaceElement = document.querySelector(".chat-main-workspace");
    const expand = document.querySelector(".chat-sidebar-expand");
    if (!(layout instanceof HTMLElement)
      || !(sidebar instanceof HTMLElement)
      || !(contextSidebar instanceof HTMLElement)
      || !(workspaceElement instanceof HTMLElement)
      || !(expand instanceof HTMLElement)) return null;
    const sidebarStyle = getComputedStyle(sidebar);
    const workspaceRect = workspaceElement.getBoundingClientRect();
    const contextSidebarRect = contextSidebar.getBoundingClientRect();
    return {
      collapsed: layout.classList.contains("is-sidebar-collapsed"),
      sidebarVisibility: sidebarStyle.visibility,
      sidebarPointerEvents: sidebarStyle.pointerEvents,
      workspaceLeft: workspaceRect.left,
      workspaceRight: workspaceRect.right,
      contextSidebarLeft: contextSidebarRect.left,
      contextSidebarRight: contextSidebarRect.right,
      expandDisplay: getComputedStyle(expand).display,
    };
  });
  await page.locator(".chat-sidebar-expand").click();
  await page.waitForFunction(() => !document.querySelector(".chat-app-layout")?.classList.contains("is-sidebar-collapsed"));
  const restored = await page.evaluate(() => {
    const sidebar = document.querySelector(".chat-app-sidebar");
    const contextSidebar = document.querySelector(".chat-context-sidebar");
    const workspaceElement = document.querySelector(".chat-main-workspace");
    if (!(sidebar instanceof HTMLElement)
      || !(contextSidebar instanceof HTMLElement)
      || !(workspaceElement instanceof HTMLElement)) return null;
    const sidebarRect = sidebar.getBoundingClientRect();
    const contextSidebarRect = contextSidebar.getBoundingClientRect();
    const workspaceRect = workspaceElement.getBoundingClientRect();
    return {
      sidebarWidth: sidebarRect.width,
      sidebarRight: sidebarRect.right,
      workspaceLeft: workspaceRect.left,
      workspaceRight: workspaceRect.right,
      contextSidebarLeft: contextSidebarRect.left,
      contextSidebarRight: contextSidebarRect.right,
    };
  });
  sidebarToggleMeasurement = { collapsed, restored };
  if (!collapsed
    || !restored
    || !collapsed.collapsed
    || collapsed.sidebarVisibility !== "hidden"
    || collapsed.sidebarPointerEvents !== "none"
    || Math.abs(collapsed.workspaceLeft) > 1
    || Math.abs(collapsed.workspaceRight - collapsed.contextSidebarLeft) > 1
    || Math.abs(collapsed.contextSidebarRight - 1180) > 1
    || collapsed.expandDisplay === "none"
    || restored.sidebarWidth <= 0
    || Math.abs(restored.workspaceLeft - restored.sidebarRight) > 1
    || Math.abs(restored.workspaceRight - restored.contextSidebarLeft) > 1
    || Math.abs(restored.contextSidebarRight - 1180) > 1) {
    failures.push(`shell/sidebar-toggle: etat non restaure ${JSON.stringify(sidebarToggleMeasurement)}`);
  }

  if (shellScreenshotPath) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(240);
    await page.screenshot({ path: shellScreenshotPath, fullPage: true });
  }
  }

  for (const viewport of shellOnly || specializedStates ? [] : viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.waitForTimeout(80);

    for (const view of views) {
      const activated = await page.evaluate((selector) => {
        const button = document.querySelector(selector);
        if (!(button instanceof HTMLElement)) return false;
        button.click();
        return true;
      }, view.trigger);
      if (!activated) {
        failures.push(`${viewport.name}/${view.name}: déclencheur absent`);
        continue;
      }
      await page.locator(view.root).waitFor({ state: "visible" });
      if (view.creativeKind) {
        const kindButton = page.locator(`[data-creative-kind="${view.creativeKind}"]`);
        await kindButton.waitFor({ state: "visible" });
        if ((await kindButton.getAttribute("aria-selected")) !== "true") await kindButton.click();
        await page.locator(view.creativeKind === "image" ? "#imageGenerationForm" : "#videoGenerationForm")
          .waitFor({ state: "visible" });
      }
      await page.waitForTimeout(["dashboard", "forum", "video", "vps"].includes(view.name) ? 450 : 180);

      const diagnostic = await page.evaluate(({ rootSelector, debug }) => {
        const panel = document.querySelector(".chat-admin-panel");
        const root = document.querySelector(rootSelector);
        if (!(panel instanceof HTMLElement) || !(root instanceof HTMLElement)) return null;

        const isVisible = (element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const scrollContainerFor = (element) => {
          for (let parent = element.parentElement; parent && parent !== panel; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if ((style.overflowX === "auto" || style.overflowX === "scroll")
              && parent.scrollWidth > parent.clientWidth + 1) return parent;
          }
          return null;
        };
        const labelFor = (element) => element.getAttribute("aria-label")
          || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
          || element.id
          || element.className
          || element.tagName;

        const panelRect = panel.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        const topbar = document.querySelector(".m-topbar");
        const bottomnav = document.querySelector(".m-bottomnav");
        const topbarRect = topbar instanceof HTMLElement && isVisible(topbar) ? topbar.getBoundingClientRect() : null;
        const bottomnavRect = bottomnav instanceof HTMLElement && isVisible(bottomnav) ? bottomnav.getBoundingClientRect() : null;
        const interactive = [...root.querySelectorAll(
          "button, a[href], input:not([type='hidden']), select, textarea, summary, [tabindex]",
        )].filter(isVisible);
        const clippedControls = interactive.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const clipped = rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1;
          return clipped && !scrollContainerFor(element) ? [labelFor(element)] : [];
        });
        const horizontalOffenders = [...root.querySelectorAll("*")]
          .filter(isVisible)
          .flatMap((element) => {
            const rect = element.getBoundingClientRect();
            const clipped = rect.left < panelRect.left - 1 || rect.right > panelRect.right + 1;
            return clipped && !scrollContainerFor(element) ? [labelFor(element)] : [];
          })
          .slice(0, 12);

        const initialScrollTop = panel.scrollTop;
        panel.scrollTop = panel.scrollHeight;
        const rootBottomAtEnd = root.getBoundingClientRect().bottom;
        const endScrollTop = panel.scrollTop;
        panel.scrollTop = initialScrollTop;
        const panelStyle = getComputedStyle(panel);
        const shellDetails = debug
          ? Object.fromEntries([
            ".chat-app-layout",
            ".chat-app-sidebar",
            ".chat-main-workspace",
            ".chat-admin-head",
            ".chat-admin-panel",
          ].map((selector) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement)) return [selector, null];
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return [selector, {
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
              clientHeight: element.clientHeight,
              scrollHeight: element.scrollHeight,
              position: style.position,
              display: style.display,
              boxSizing: style.boxSizing,
              paddingTop: style.paddingTop,
              paddingBottom: style.paddingBottom,
              borderTopWidth: style.borderTopWidth,
              borderBottomWidth: style.borderBottomWidth,
              flex: style.flex,
            }];
          }))
          : undefined;
        const layoutDetails = debug
          ? [...root.querySelectorAll("*")]
            .filter(isVisible)
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                tag: element.tagName.toLowerCase(),
                id: element.id || null,
                classes: [...element.classList].join(" "),
                left: rect.left,
                right: rect.right,
                width: rect.width,
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                display: style.display,
                minWidth: style.minWidth,
                gridTemplateColumns: style.gridTemplateColumns,
                whiteSpace: style.whiteSpace,
              };
            })
            .filter((item) => item.scrollWidth > item.clientWidth + 1
              || item.left < panelRect.left - 1
              || item.right > panelRect.right + 1)
            .sort((a, b) => (b.scrollWidth - b.clientWidth) - (a.scrollWidth - a.clientWidth))
            .slice(0, 30)
          : undefined;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          panel: {
            top: panelRect.top,
            right: panelRect.right,
            bottom: panelRect.bottom,
            left: panelRect.left,
            clientWidth: panel.clientWidth,
            scrollWidth: panel.scrollWidth,
            clientHeight: panel.clientHeight,
            scrollHeight: panel.scrollHeight,
            overflowX: panelStyle.overflowX,
            overflowY: panelStyle.overflowY,
          },
          root: {
            width: rootRect.width,
            clientWidth: root.clientWidth,
            scrollWidth: root.scrollWidth,
            rootBottomAtEnd,
            endScrollTop,
          },
          topbarBottom: topbarRect?.bottom ?? null,
          bottomnavTop: bottomnavRect?.top ?? null,
          documentOverflow: Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ) - window.innerWidth,
          clippedControls,
          horizontalOffenders,
          shellDetails,
          layoutDetails,
        };
      }, { rootSelector: view.root, debug: debugLayout });

      if (!diagnostic) {
        failures.push(`${viewport.name}/${view.name}: panneau non mesurable`);
        continue;
      }
      measurements.push({ ...diagnostic, viewport: viewport.name, view: view.name });
      const prefix = `${viewport.name}/${view.name}`;
      if (diagnostic.documentOverflow > 1) {
        failures.push(`${prefix}: document débordant de ${diagnostic.documentOverflow}px`);
      }
      if (diagnostic.panel.scrollWidth > diagnostic.panel.clientWidth + 1) {
        failures.push(`${prefix}: panneau débordant horizontalement`);
      }
      if (diagnostic.root.scrollWidth > diagnostic.root.clientWidth + 1) {
        failures.push(`${prefix}: contenu racine débordant horizontalement`);
      }
      if (diagnostic.clippedControls.length || diagnostic.horizontalOffenders.length) {
        failures.push(`${prefix}: éléments tronqués ${JSON.stringify({
          controls: diagnostic.clippedControls,
          elements: diagnostic.horizontalOffenders,
        })}`);
      }
      if (diagnostic.topbarBottom !== null && diagnostic.panel.top < diagnostic.topbarBottom - 1) {
        failures.push(`${prefix}: panneau sous la barre haute`);
      }
      if (diagnostic.bottomnavTop !== null && diagnostic.panel.bottom > diagnostic.bottomnavTop + 1) {
        failures.push(`${prefix}: panneau sous la navigation basse`);
      }
      if (diagnostic.panel.scrollHeight > diagnostic.panel.clientHeight + 1
        && !["auto", "scroll"].includes(diagnostic.panel.overflowY)) {
        failures.push(`${prefix}: contenu vertical non défilable`);
      }
      if (diagnostic.root.rootBottomAtEnd > diagnostic.panel.bottom + 1) {
        failures.push(`${prefix}: fin du contenu inaccessible après défilement`);
      }
    }
  }

  if (specializedStates && !shellOnly && cdpSession) {
    const clickAttached = (selector) => page.evaluate((target) => {
      const element = document.querySelector(target);
      if (!(element instanceof HTMLElement)) return false;
      element.click();
      return true;
    }, selector);

    const closeState = async (state) => {
      if (state.action === "forum-detail") await clickAttached("[data-forum-back]");
      if (state.action === "forum-compose") await clickAttached("#forumTopicCancel");
      if (state.action === "prompt-editor") await clickAttached("#promptEditorCancel");
      if (state.action === "vps-options") {
        const expanded = await page.locator("#vpsDetailsToggle").getAttribute("aria-expanded").catch(() => null);
        if (expanded === "true") await clickAttached("#vpsDetailsToggle");
      }
      if (state.action === "creative-accounts") await clickAttached("#creativeAccountsClose");
    };

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await cdpSession.send("Emulation.setSafeAreaInsetsOverride", {
        insets: {
          top: viewport.safeArea.top,
          topMax: viewport.safeArea.top,
          right: viewport.safeArea.right,
          rightMax: viewport.safeArea.right,
          bottom: viewport.safeArea.bottom,
          bottomMax: viewport.safeArea.bottom,
          left: viewport.safeArea.left,
          leftMax: viewport.safeArea.left,
        },
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.locator("#chatAppSidebar").waitFor({ state: "attached" });
      await page.waitForTimeout(120);

      for (const state of states) {
        const prefix = `${viewport.name}/${state.name}`;
        try {
          if (!(await clickAttached(state.trigger))) {
            failures.push(`${prefix}: déclencheur absent`);
            continue;
          }
          await page.locator(state.viewRoot).waitFor({ state: "visible" });
          await page.waitForTimeout(["forum", "video", "vps"].includes(state.view) ? 450 : 180);

          let opened = false;
          if (state.action === "forum-detail") opened = await clickAttached("[data-forum-topic-id]");
          if (state.action === "forum-compose") opened = await clickAttached("[data-forum-new-topic]");
          if (state.action === "prompt-editor") opened = await clickAttached("#promptNewButton");
          if (state.action === "vps-options") {
            const expanded = await page.locator("#vpsDetailsToggle").getAttribute("aria-expanded");
            opened = expanded === "true" || await clickAttached("#vpsDetailsToggle");
          }
          if (state.action === "creative-accounts") opened = await clickAttached("#creativeAccountsOpen");
          if (!opened) {
            failures.push(`${prefix}: état impossible à ouvrir`);
            continue;
          }

          await page.locator(state.ready).waitFor({ state: "visible" });
          await page.waitForTimeout(100);

          const diagnostic = await page.evaluate(({ rootSelector, required, overlay, debug }) => {
            const root = document.querySelector(rootSelector);
            const panel = document.querySelector(".chat-admin-panel");
            if (!(root instanceof HTMLElement) || !(panel instanceof HTMLElement)) return null;

            const safeAreaProbe = document.createElement("div");
            safeAreaProbe.style.cssText = [
              "position:fixed",
              "visibility:hidden",
              "pointer-events:none",
              "padding-top:env(safe-area-inset-top)",
              "padding-right:env(safe-area-inset-right)",
              "padding-bottom:env(safe-area-inset-bottom)",
              "padding-left:env(safe-area-inset-left)",
            ].join(";");
            document.body.appendChild(safeAreaProbe);
            const probeStyle = getComputedStyle(safeAreaProbe);
            const safeArea = {
              top: Number.parseFloat(probeStyle.paddingTop) || 0,
              right: Number.parseFloat(probeStyle.paddingRight) || 0,
              bottom: Number.parseFloat(probeStyle.paddingBottom) || 0,
              left: Number.parseFloat(probeStyle.paddingLeft) || 0,
            };
            safeAreaProbe.remove();

            const visualViewport = window.visualViewport;
            const visual = {
              top: visualViewport?.offsetTop ?? 0,
              left: visualViewport?.offsetLeft ?? 0,
              right: (visualViewport?.offsetLeft ?? 0) + (visualViewport?.width ?? window.innerWidth),
              bottom: (visualViewport?.offsetTop ?? 0) + (visualViewport?.height ?? window.innerHeight),
            };
            const usable = {
              top: visual.top + safeArea.top,
              right: visual.right - safeArea.right,
              bottom: visual.bottom - safeArea.bottom,
              left: visual.left + safeArea.left,
            };
            const panelRect = panel.getBoundingClientRect();
            const boundary = overlay
              ? usable
              : {
                top: Math.max(panelRect.top, usable.top),
                right: Math.min(panelRect.right, usable.right),
                bottom: Math.min(panelRect.bottom, usable.bottom),
                left: Math.max(panelRect.left, usable.left),
              };

            const isRendered = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== "none"
                && style.visibility !== "hidden"
                && Number(style.opacity) > 0
                && rect.width > 0
                && rect.height > 0;
            };
            const labelFor = (element) => element.getAttribute("aria-label")
              || element.getAttribute("title")
              || element.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
              || element.id
              || [...element.classList].join(" ")
              || element.tagName;
            const canScrollTo = (element, axis) => {
              for (let parent = element.parentElement; parent; parent = parent.parentElement) {
                const style = getComputedStyle(parent);
                const overflow = axis === "x" ? style.overflowX : style.overflowY;
                const scrollSize = axis === "x" ? parent.scrollWidth : parent.scrollHeight;
                const clientSize = axis === "x" ? parent.clientWidth : parent.clientHeight;
                if (["auto", "scroll"].includes(overflow) && scrollSize > clientSize + 1) return true;
                if (parent === panel || (overlay && parent === root)) break;
              }
              return false;
            };
            const reachability = (element) => {
              const rect = element.getBoundingClientRect();
              const horizontal = rect.left < boundary.left - 1 || rect.right > boundary.right + 1;
              const vertical = rect.top < boundary.top - 1 || rect.bottom > boundary.bottom + 1;
              return {
                rect: {
                  top: rect.top,
                  right: rect.right,
                  bottom: rect.bottom,
                  left: rect.left,
                },
                horizontal,
                vertical,
                blockedHorizontally: horizontal && !canScrollTo(element, "x"),
                blockedVertically: vertical && !canScrollTo(element, "y"),
              };
            };

            const controls = [...root.querySelectorAll(
              "button, a[href], input:not([type='hidden']), select, textarea, summary, [tabindex]",
            )].filter(isRendered);
            const unreachable = controls.flatMap((element) => {
              const reach = reachability(element);
              return reach.blockedHorizontally || reach.blockedVertically
                ? [{ label: labelFor(element), ...reach }]
                : [];
            });
            const meaningful = [...root.querySelectorAll(
              "h1, h2, h3, p, label, strong, small, button, a[href], input:not([type='hidden']), select, textarea",
            )].filter(isRendered);
            const unsafeHorizontalContent = meaningful.flatMap((element) => {
              const rect = element.getBoundingClientRect();
              const outside = rect.left < usable.left - 1 || rect.right > usable.right + 1;
              return outside && !canScrollTo(element, "x") ? [labelFor(element)] : [];
            }).slice(0, 16);
            const requiredControls = required.map((selector) => {
              const element = root.querySelector(selector);
              if (!(element instanceof HTMLElement)) return { selector, present: false };
              const rendered = isRendered(element);
              const reach = rendered ? reachability(element) : null;
              return {
                selector,
                present: true,
                rendered,
                reachable: Boolean(reach && !reach.blockedHorizontally && !reach.blockedVertically),
                reach,
              };
            });

            const scrollCandidates = [...new Set([
              panel,
              root,
              ...root.querySelectorAll("*"),
            ])].filter((element) => {
              if (!(element instanceof HTMLElement) || !isRendered(element)) return false;
              const style = getComputedStyle(element);
              return ["auto", "scroll"].includes(style.overflowY)
                && element.scrollHeight > element.clientHeight + 1;
            });
            const scrollRegions = scrollCandidates.map((element) => {
              const initial = element.scrollTop;
              const maximum = element.scrollHeight - element.clientHeight;
              element.scrollTop = element.scrollHeight;
              const reached = element.scrollTop;
              element.scrollTop = initial;
              return {
                label: labelFor(element),
                clientHeight: element.clientHeight,
                scrollHeight: element.scrollHeight,
                maximum,
                reached,
              };
            });

            const panelStyle = getComputedStyle(panel);
            const rootStyle = getComputedStyle(root);
            const rootRect = root.getBoundingClientRect();
            const initialPanelScroll = panel.scrollTop;
            panel.scrollTop = panel.scrollHeight;
            const rootBottomAtPanelEnd = root.getBoundingClientRect().bottom;
            const panelEndScrollTop = panel.scrollTop;
            panel.scrollTop = initialPanelScroll;
            return {
              visual,
              safeArea,
              usable,
              boundary,
              documentOverflow: Math.max(
                document.documentElement.scrollWidth,
                document.body.scrollWidth,
              ) - window.innerWidth,
              panel: {
                top: panelRect.top,
                right: panelRect.right,
                bottom: panelRect.bottom,
                left: panelRect.left,
                clientWidth: panel.clientWidth,
                scrollWidth: panel.scrollWidth,
                clientHeight: panel.clientHeight,
                scrollHeight: panel.scrollHeight,
                overflowX: panelStyle.overflowX,
                overflowY: panelStyle.overflowY,
                panelEndScrollTop,
                rootBottomAtPanelEnd,
              },
              root: {
                top: rootRect.top,
                right: rootRect.right,
                bottom: rootRect.bottom,
                left: rootRect.left,
                clientWidth: root.clientWidth,
                scrollWidth: root.scrollWidth,
                clientHeight: root.clientHeight,
                scrollHeight: root.scrollHeight,
                overflowX: rootStyle.overflowX,
                overflowY: rootStyle.overflowY,
              },
              controlCount: controls.length,
              unreachable,
              unsafeHorizontalContent,
              requiredControls,
              scrollRegions,
              debug: debug ? {
                activeElement: document.activeElement instanceof HTMLElement
                  ? labelFor(document.activeElement)
                  : null,
              } : undefined,
            };
          }, {
            rootSelector: state.root,
            required: state.required,
            overlay: Boolean(state.overlay),
            debug: debugLayout,
          });

          if (!diagnostic) {
            failures.push(`${prefix}: état non mesurable`);
            continue;
          }
          stateMeasurements.push({ viewport: viewport.name, state: state.name, ...diagnostic });
          for (const side of ["top", "right", "bottom", "left"]) {
            if (Math.abs(diagnostic.safeArea[side] - viewport.safeArea[side]) > 0.5) {
              failures.push(`${prefix}: zone sûre ${side} non émulée`);
            }
          }
          if (diagnostic.documentOverflow > 1
            || diagnostic.panel.scrollWidth > diagnostic.panel.clientWidth + 1
            || diagnostic.root.scrollWidth > diagnostic.root.clientWidth + 1) {
            failures.push(`${prefix}: débordement horizontal ${JSON.stringify({
              document: diagnostic.documentOverflow,
              panel: [diagnostic.panel.clientWidth, diagnostic.panel.scrollWidth],
              root: [diagnostic.root.clientWidth, diagnostic.root.scrollWidth],
            })}`);
          }
          if (diagnostic.unreachable.length || diagnostic.unsafeHorizontalContent.length) {
            failures.push(`${prefix}: contenu inaccessible ou sous une zone sûre ${JSON.stringify({
              controls: diagnostic.unreachable,
              content: diagnostic.unsafeHorizontalContent,
            })}`);
          }
          const invalidRequired = diagnostic.requiredControls.filter((control) =>
            !control.present || !control.rendered || !control.reachable);
          if (invalidRequired.length) {
            failures.push(`${prefix}: contrôles requis inaccessibles ${JSON.stringify(invalidRequired)}`);
          }
          const incompleteScroll = diagnostic.scrollRegions.filter((region) =>
            Math.abs(region.maximum - region.reached) > 1);
          if (incompleteScroll.length) {
            failures.push(`${prefix}: fin de défilement inaccessible ${JSON.stringify(incompleteScroll)}`);
          }
          if (diagnostic.panel.scrollHeight > diagnostic.panel.clientHeight + 1
            && !["auto", "scroll"].includes(diagnostic.panel.overflowY)) {
            failures.push(`${prefix}: panneau vertical non défilable`);
          }
          if (!state.overlay
            && diagnostic.panel.panelEndScrollTop > 0
            && diagnostic.panel.rootBottomAtPanelEnd > diagnostic.panel.bottom + 1) {
            failures.push(`${prefix}: fin du contenu racine inaccessible`);
          }
          if (state.overlay && (
            diagnostic.root.top < diagnostic.usable.top - 1
            || diagnostic.root.left < diagnostic.usable.left - 1
            || diagnostic.root.right > diagnostic.usable.right + 1
            || diagnostic.root.bottom > diagnostic.usable.bottom + 1
          )) {
            failures.push(`${prefix}: modale hors zone sûre`);
          }
          if (state.overlay
            && diagnostic.root.scrollHeight > diagnostic.root.clientHeight + 1
            && !["auto", "scroll"].includes(diagnostic.root.overflowY)) {
            failures.push(`${prefix}: contenu de modale non défilable`);
          }
        } catch (error) {
          failures.push(`${prefix}: ${String(error)}`);
        } finally {
          await closeState(state).catch(() => {});
          await page.waitForTimeout(60);
        }
      }
    }
  }

  await context.close();
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify({
  site,
  shellMeasurements,
  sidebarToggleMeasurement,
  contextSidebarResizeMeasurement,
  contextNavigationMeasurements,
  measurements,
  stateMeasurements,
  failures,
}, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
