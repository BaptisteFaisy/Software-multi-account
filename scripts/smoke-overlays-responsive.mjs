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
const accountId = "overlay-account-1";
const accounts = Array.from({ length: 3 }, (_, index) => ({
  id: `overlay-account-${index + 1}`,
  label: `Compte responsive ${index + 1} avec un libellé volontairement long`,
  provider: "codex",
  codexHome: `C:\\Smoke\\.codex-overlay-${index + 1}`,
  projectDir: workspace,
  bypass: false,
  model: "gpt-5-codex",
  reasoningEffort: "high",
}));
const workspaces = Array.from({ length: 6 }, (_, index) => ({
  id: `smoke/overlay-${index + 1}`,
  label: `Environnement responsive ${index + 1}`,
  path: index === 0 ? workspace : `C:\\Smoke\\Projet-responsive-${index + 1}`,
  memory: index === 0 ? "Mémoire de test suffisamment longue pour afficher l'éditeur." : "",
}));
const agents = Array.from({ length: 8 }, (_, index) => ({
  id: index === 0 ? "codex" : `agent-overlay-${index + 1}`,
  label: `Agent responsive ${index + 1}`,
  command: index === 0 ? "codex" : `agent-${index + 1}`,
  provider: "codex",
  kind: "cli",
  builtin: index === 0,
}));
const settings = {
  accounts,
  proxies: [],
  defaultAccountId: accountId,
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
  agents,
  activeAgentId: "codex",
  kombai: {
    codeServerCommand: "code-server",
    port: 3000,
    extensionId: "",
    autoInstallExtension: false,
  },
  codexBypass: false,
  autoDiscoverAccounts: false,
  workspaces,
  closedWorkspaceIds: [],
};

const timestamp = Math.floor(Date.now() / 1000);
const discussion = {
  sessionId: "overlay-session",
  rolloutId: "overlay-session",
  forkCount: 2,
  provider: "codex",
  accountId,
  accountLabel: accounts[0].label,
  codexHome: accounts[0].codexHome,
  filePath: "C:\\Smoke\\rollout-overlay-session.jsonl",
  folderPath: workspace,
  cwd: workspace,
  startedAt: timestamp - 600,
  lastActivity: timestamp,
  title: "Discussion responsive avec un titre volontairement très long",
  preview: "Contenu de test",
  messageCount: 4,
  totalTokens: 1_234,
  cliVersion: "smoke",
};
const autonomousAgent = {
  id: "overlay-autonomous-agent",
  name: "Agent autonome responsive avec un nom volontairement long",
  objective: "Vérifier que toutes les actions du moniteur restent accessibles en faible hauteur.",
  role: "Vérificateur prudent",
  accountId,
  projectDir: workspace,
  sessionId: null,
  mode: "build",
  model: "gpt-5-codex",
  reasoningEffort: "high",
  connectors: [],
  intervalSeconds: 300,
  triggerKind: "schedule",
  systemManaged: false,
  status: "active",
  createdAt: timestamp - 3_600,
  updatedAt: timestamp,
  nextRunAt: timestamp + 300,
  lastRunStartedAt: timestamp - 120,
  lastRunFinishedAt: timestamp - 60,
  currentTurnId: null,
  currentStartId: null,
  attemptCount: 3,
  runCount: 2,
  consecutiveFailures: 0,
  lastError: null,
  lastSummary: "Contrôle terminé sans anomalie fonctionnelle.",
  requireUserReview: true,
  pendingReview: null,
  approvedReview: null,
  memory: [],
  testCommand: null,
  testTimeoutSeconds: 120,
  testStatus: "not_configured",
  currentTestId: null,
  testCompletionPending: false,
  consecutiveTestFailures: 0,
  lastTestStartedAt: null,
  lastTestFinishedAt: null,
  lastTestExitCode: null,
  lastTestDurationMs: null,
  lastTestOutput: null,
  events: [{ timestamp, kind: "completed", message: "Boucle responsive terminée" }],
};
const today = new Date().toISOString().slice(0, 10);
const emptyUsageDay = {
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

const jsonFor = (path) => {
  if (path === "/api/auth/config") {
    return { enabled: true, registrationEnabled: true, googleEnabled: true };
  }
  if (path === "/api/auth/me") {
    return {
      user: {
        id: "overlay-user",
        username: "responsive.user",
        email: "responsive@example.test",
        avatarUrl: null,
        hasPassword: true,
        googleLinked: true,
        createdAt: timestamp - 86_400,
        updatedAt: timestamp,
      },
    };
  }
  if (path === "/api/settings") return settings;
  if (path === "/api/discussions") {
    return {
      generatedAt: Date.now(),
      totalDiscussions: 1,
      accounts: [{
        accountId,
        label: accounts[0].label,
        provider: "codex",
        codexHome: accounts[0].codexHome,
        hasTokens: true,
        discussionCount: 1,
        discussions: [discussion],
      }],
    };
  }
  if (path === "/api/fs/list") {
    return {
      root: "C:\\Smoke",
      path: workspace,
      parent: "C:\\Smoke",
      entries: Array.from({ length: 10 }, (_, index) => ({
        name: `Sous-dossier-responsive-${index + 1}`,
        path: `${workspace}\\Sous-dossier-responsive-${index + 1}`,
        isDir: true,
      })),
    };
  }
  if (path === "/api/autonomous-agents") return [autonomousAgent];
  if (path === "/api/usage") {
    return {
      generatedAt: Date.now(),
      totalAgentSeconds: 0,
      totalAgentRuns: 0,
      activeAgentCount: 1,
      totalApiRequests: 0,
      totalApiErrors: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      today: emptyUsageDay,
      days: [emptyUsageDay],
    };
  }
  if (path === "/api/chat/turns/active" || path === "/api/chat/models") return [];
  if (path === "/api/limits" || path === "/api/orchestrations") return [];
  if (path.includes("/events") || path.includes("/history") || path.includes("skills")) return [];
  if (path.includes("pool") && path.includes("status")) return { running: false, accounts: [] };
  if (path.includes("kombai") && path.includes("status")) {
    return { running: false, started: false, port: 3000, command: "code-server", binaryAvailable: false };
  }
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
  {
    name: "phone-portrait",
    width: 390,
    height: 844,
    safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
  },
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
const selectedNames = new Set(
  String(process.env.CST_OVERLAY_VIEWPORTS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const selectedCases = new Set(
  String(process.env.CST_OVERLAY_CASES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const viewports = viewportMatrix.filter(
  ({ name }) => !selectedNames.size || selectedNames.has(name),
);
if (!viewports.length) throw new Error("La sélection de viewports du smoke overlays est vide.");

process.stderr.write("[overlay-smoke] lancement du navigateur\n");
const browser = await chromium.launch({ executablePath, headless: true });
const failures = [];
const measurements = [];

try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "fr-FR",
    serviceWorkers: "block",
    hasTouch: true,
    isMobile: true,
  });
  process.stderr.write("[overlay-smoke] contexte prêt\n");
  await context.addInitScript(({ workspacePath }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "overlay-smoke-token");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
  }, { workspacePath: workspace });

  const page = await context.newPage();
  const cdpSession = await context.newCDPSession(page);
  let holdWorkspaceBrowse = false;
  let releaseWorkspaceBrowse = null;
  page.setDefaultTimeout(6_000);
  page.setDefaultNavigationTimeout(20_000);
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack || error}`));
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/fs/list" && holdWorkspaceBrowse) {
      await new Promise((resolve) => {
        releaseWorkspaceBrowse = resolve;
      });
      releaseWorkspaceBrowse = null;
    }
    return route.fulfill({ json: jsonFor(path) });
  });
  const loadApplication = async (matrixKey) => {
    let lastError;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const query = new URLSearchParams({
          smoke: "overlays-responsive",
          matrix: matrixKey,
          attempt: String(attempt),
        });
        await page.goto(`${site}/?${query}`, { waitUntil: "domcontentloaded" });
        await page.locator("#chatAppSidebar").waitFor({ state: "attached" });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await page.waitForTimeout(120);
      }
    }
    throw lastError;
  };
  await loadApplication("initial");
  process.stderr.write("[overlay-smoke] application prête\n");

  const clickAttached = async (selector) => page.evaluate((target) => {
    const element = document.querySelector(target);
    if (!(element instanceof HTMLElement)) return false;
    element.click();
    return true;
  }, selector);

  const ensureExpertChat = async () => {
    if (await page.locator(".chat-panel--expert").count()) return true;
    if (!(await clickAttached("[data-open-chat]"))) return false;
    await page.locator(".chat-panel--expert").waitFor({ state: "visible" });
    return true;
  };

  const auditOverlay = async ({ viewport, name, root }) => {
    const diagnostic = await page.locator(root).evaluate((element) => {
      const visible = (candidate) => {
        const style = getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && rect.width > 0
          && rect.height > 0;
      };
      const labelFor = (candidate) => candidate.getAttribute("aria-label")
        || candidate.getAttribute("title")
        || candidate.textContent?.trim().replace(/\s+/g, " ").slice(0, 80)
        || candidate.id
        || candidate.className
        || candidate.tagName;
      const hasVisibleGlyph = (candidate) => {
        const walker = document.createTreeWalker(candidate, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (
            /[\p{L}\p{N}\p{P}\p{S}]/u.test(node.textContent || "")
            && node.parentElement
            && visible(node.parentElement)
          ) return true;
        }
        const visualContent = [...candidate.querySelectorAll(
          "svg, img, canvas, video, input:not([type='hidden']), select, textarea, button, progress, meter",
        )];
        if (visualContent.some(visible)) return true;
        return [...candidate.querySelectorAll("*")].some((item) => {
          if (!(item instanceof HTMLElement) || !visible(item)) return false;
          const style = getComputedStyle(item);
          const pseudoContent = ["::before", "::after"].some((pseudo) => {
            const content = getComputedStyle(item, pseudo).content;
            return content !== "none" && content !== "normal" && content !== '\"\"';
          });
          return pseudoContent
            || style.animationName !== "none"
            || /(?:^|[-_])(icon|dot|mark|loader|spinner|shimmer|indicator|progress)(?:$|[-_])/i
              .test(typeof item.className === "string" ? item.className : "");
        });
      };
      const emptyReservations = [...element.querySelectorAll("div, section, aside, footer, header, nav, ul, ol")]
        .filter((candidate) => {
          if (!(candidate instanceof HTMLElement) || !visible(candidate)) return false;
          const identity = `${candidate.id} ${candidate.className}`;
          if (!/(?:^|[-_])(panel|overlay|modal|body|content|list|actions?|footer|status|feedback|notice|message|bubble|card|section|results?)(?:$|[-_])/i.test(identity)) {
            return false;
          }
          if (hasVisibleGlyph(candidate)) return false;
          const style = getComputedStyle(candidate);
          const rect = candidate.getBoundingClientRect();
          const padding = [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
            .reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
          const border = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth]
            .reduce((total, value) => total + (Number.parseFloat(value) || 0), 0);
          return rect.width >= 8 && rect.height >= 8 && (rect.height >= 24 || padding > 0 || border > 0);
        })
        .map((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return {
            tag: candidate.tagName.toLowerCase(),
            id: candidate.id,
            className: candidate.className,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        })
        .slice(0, 12);
      const visual = window.visualViewport
        ? {
            top: window.visualViewport.offsetTop,
            left: window.visualViewport.offsetLeft,
            right: window.visualViewport.offsetLeft + window.visualViewport.width,
            bottom: window.visualViewport.offsetTop + window.visualViewport.height,
          }
        : { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
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
      const safeAreaStyle = getComputedStyle(safeAreaProbe);
      const safeArea = {
        top: Number.parseFloat(safeAreaStyle.paddingTop) || 0,
        right: Number.parseFloat(safeAreaStyle.paddingRight) || 0,
        bottom: Number.parseFloat(safeAreaStyle.paddingBottom) || 0,
        left: Number.parseFloat(safeAreaStyle.paddingLeft) || 0,
      };
      safeAreaProbe.remove();
      const usable = {
        top: visual.top + safeArea.top,
        right: visual.right - safeArea.right,
        bottom: visual.bottom - safeArea.bottom,
        left: visual.left + safeArea.left,
      };
      const rootRect = element.getBoundingClientRect();
      const controls = [...element.querySelectorAll(
        "button, a[href], input:not([type='hidden']), select, textarea, summary, [tabindex]",
      )].filter(visible);
      const unreachable = [];
      const unreachableDetails = [];

      for (const control of controls) {
        control.scrollIntoView({ block: "center", inline: "center" });
        const rect = control.getBoundingClientRect();
        const currentRootRect = element.getBoundingClientRect();
        if (
          rect.left < Math.max(usable.left, currentRootRect.left) - 1
          || rect.right > Math.min(usable.right, currentRootRect.right) + 1
          || rect.top < Math.max(usable.top, currentRootRect.top) - 1
          || rect.bottom > Math.min(usable.bottom, currentRootRect.bottom) + 1
        ) {
          const label = labelFor(control);
          unreachable.push(label);
          unreachableDetails.push({
            label,
            rect: {
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
              left: rect.left,
            },
            root: {
              top: currentRootRect.top,
              right: currentRootRect.right,
              bottom: currentRootRect.bottom,
              left: currentRootRect.left,
            },
          });
        }
      }

      const rootStyle = getComputedStyle(element);
      const scrollRegions = [element, ...element.querySelectorAll("*")]
        .filter((candidate) => {
          if (!(candidate instanceof HTMLElement) || !visible(candidate)) return false;
          const style = getComputedStyle(candidate);
          return candidate.scrollHeight > candidate.clientHeight + 1
            && ["auto", "scroll"].includes(style.overflowY);
        })
        .map((candidate) => ({
          label: labelFor(candidate),
          clientHeight: candidate.clientHeight,
          scrollHeight: candidate.scrollHeight,
        }))
        .slice(0, 8);

      return {
        visual,
        safeArea,
        usable,
        root: {
          top: rootRect.top,
          right: rootRect.right,
          bottom: rootRect.bottom,
          left: rootRect.left,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
          overflowX: rootStyle.overflowX,
          overflowY: rootStyle.overflowY,
        },
        documentOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
          - window.innerWidth,
        controlCount: controls.length,
        unreachable,
        unreachableDetails,
        scrollRegions,
        emptyReservations,
      };
    });

    const prefix = `${viewport.name}/${name}`;
    measurements.push({ viewport: viewport.name, overlay: name, ...diagnostic });
    for (const side of ["top", "right", "bottom", "left"]) {
      if (Math.abs(diagnostic.safeArea[side] - viewport.safeArea[side]) > 0.5) {
        failures.push(
          `${prefix}: zone sûre ${side} non émulée `
          + `(${diagnostic.safeArea[side]}px au lieu de ${viewport.safeArea[side]}px)`,
        );
      }
    }
    if (
      diagnostic.root.top < diagnostic.visual.top - 1
      || diagnostic.root.left < diagnostic.visual.left - 1
      || diagnostic.root.right > diagnostic.visual.right + 1
      || diagnostic.root.bottom > diagnostic.visual.bottom + 1
    ) {
      failures.push(`${prefix}: fenêtre hors zone visuelle`);
    }
    if (diagnostic.documentOverflow > 1) {
      failures.push(`${prefix}: document débordant de ${diagnostic.documentOverflow}px`);
    }
    if (diagnostic.root.scrollWidth > diagnostic.root.clientWidth + 1) {
      failures.push(`${prefix}: fenêtre débordant horizontalement`);
    }
    if (
      diagnostic.root.scrollHeight > diagnostic.root.clientHeight + 1
      && !["auto", "scroll"].includes(diagnostic.root.overflowY)
    ) {
      failures.push(`${prefix}: contenu vertical rogné par overflow:${diagnostic.root.overflowY}`);
    }
    if (diagnostic.unreachable.length) {
      failures.push(
        `${prefix}: contrôles inaccessibles ${JSON.stringify(diagnostic.unreachableDetails)}`,
      );
    }
    if (diagnostic.emptyReservations.length) {
      failures.push(
        `${prefix}: conteneurs vides qui reservent de l'espace `
        + `${JSON.stringify(diagnostic.emptyReservations)}`,
      );
    }
  };

  const cases = [
    {
      name: "new-chat",
      root: "#newChatBackdrop [role='dialog']",
      open: async () => {
        await clickAttached('[data-view="chat"]');
        return clickAttached('[data-m="new"]');
      },
      close: async () => clickAttached("#closeNewChatModal"),
    },
    {
      name: "environment-menu",
      root: "#terminalEnvironmentMenuBackdrop [role='dialog']",
      open: async () => clickAttached("#wsOpenFolder"),
      close: async () => clickAttached("#closeTerminalEnvironmentMenu"),
    },
    {
      name: "workspace-browser",
      root: "#workspaceBackdrop [role='dialog']",
      open: async () => {
        if (!(await clickAttached("#wsOpenFolder"))) return false;
        await page.locator("#terminalEnvironmentMenuBackdrop").waitFor({ state: "visible" });
        return clickAttached("#createEnvironmentFromMenu");
      },
      close: async () => clickAttached("#closeWorkspaceModal"),
    },
    {
      name: "workspace-browser-loading",
      root: "#workspaceBackdrop [role='dialog']",
      open: async () => {
        holdWorkspaceBrowse = true;
        if (!(await clickAttached("#wsOpenFolder"))) return false;
        await page.locator("#terminalEnvironmentMenuBackdrop").waitFor({ state: "visible" });
        if (!(await clickAttached("#createEnvironmentFromMenu"))) return false;
        await page.locator("#workspaceBackdrop .ws-hint").waitFor({ state: "visible" });
        return true;
      },
      close: async () => {
        holdWorkspaceBrowse = false;
        releaseWorkspaceBrowse?.();
        releaseWorkspaceBrowse = null;
        return clickAttached("#closeWorkspaceModal");
      },
    },
    {
      name: "agents-manager",
      root: "#agentsBackdrop [role='dialog']",
      open: async () => {
        if (!(await clickAttached("#settingsToggle"))) return false;
        await page.locator("#settingsAgents").waitFor({ state: "attached" });
        return clickAttached("#settingsAgents");
      },
      close: async () => clickAttached("#closeAgentsModal"),
    },
    {
      name: "new-terminal",
      root: "#newTerminalBackdrop [role='dialog']",
      open: async () => {
        if (!(await clickAttached('[data-view="terminal"]'))) return false;
        return clickAttached('[data-m="new"]');
      },
      close: async () => {
        await clickAttached("#closeNewTerminalModal");
        return clickAttached('[data-view="chat"]');
      },
    },
    {
      name: "user-profile",
      root: "[data-user-profile-dialog]",
      open: async () => clickAttached("#userProfileToggle"),
      close: async () => clickAttached("[data-user-profile-dialog] [data-user-profile-close]"),
    },
    {
      name: "discussion-archive",
      root: "#discussionArchiveBackdrop [role='dialog']",
      open: async () => clickAttached("[data-delete-session]"),
      close: async () => clickAttached("#closeDiscussionArchive"),
    },
    {
      name: "autonomous-chat",
      root: "#autonomousChatBackdrop [role='dialog']",
      open: async () => {
        if (!(await ensureExpertChat())) return false;
        return clickAttached("[data-chat-action='autonomize']");
      },
      close: async () => clickAttached("#closeAutonomousChat"),
    },
    {
      name: "prompt-quick-picker",
      root: "#promptQuickPicker",
      open: async () => {
        if (!(await ensureExpertChat())) return false;
        return clickAttached("[data-chat-action='prompts']");
      },
      close: async () => clickAttached("#promptQuickPicker [data-prompt-quick-close]"),
    },
    {
      name: "autonomous-orchestration",
      root: "#autonomousOrchestrationBackdrop [role='dialog']",
      open: async () => {
        if (!(await clickAttached("#autonomousMonitorLauncher"))) return false;
        await page.locator("#autonomousMonitorWindow").waitFor({ state: "visible" });
        return clickAttached("#autonomousMonitorWindow [data-autonomous-orchestrate]");
      },
      close: async () => {
        await clickAttached("#closeAutonomousOrchestration");
        return clickAttached("#autonomousMonitorWindow [data-autonomous-monitor-close]");
      },
    },
    {
      name: "autonomous-monitor",
      root: "#autonomousMonitorWindow",
      open: async () => clickAttached("#autonomousMonitorLauncher"),
      close: async () => clickAttached("#autonomousMonitorWindow [data-autonomous-monitor-close]"),
    },
    {
      name: "mobile-drawer",
      root: "#chatAppSidebar",
      open: async () => {
        if (!(await clickAttached("[data-m='drawer']"))) return false;
        await page.waitForFunction(() => document.body.classList.contains("chat-sidebar-open"));
        await page.waitForFunction(() => (
          document.querySelector("#chatAppSidebar")?.getBoundingClientRect().left ?? -Infinity
        ) >= -1);
        return true;
      },
      close: async () => clickAttached("#chatSidebarClose"),
    },
    {
      name: "mobile-sheet",
      root: ".m-sheet-panel",
      open: async () => {
        if (!(await clickAttached("[data-m='menu']"))) return false;
        await page.waitForFunction(() => document.body.classList.contains("m-sheet-open"));
        return true;
      },
      close: async () => clickAttached("[data-m='scrim']"),
    },
  ].filter(({ name }) => !selectedCases.size || selectedCases.has(name));

  if (!cases.length) throw new Error("La sélection de fenêtres du smoke overlays est vide.");

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
    await loadApplication(viewport.name);
    await page.waitForTimeout(100);

    for (const overlay of cases) {
      process.stderr.write(`[overlay-smoke] ${viewport.name}/${overlay.name}\n`);
      let completed = false;
      let lastError;
      for (let attempt = 1; attempt <= 2 && !completed; attempt += 1) {
        try {
          const opened = await overlay.open();
          if (!opened) throw new Error("déclencheur absent");
          await page.locator(overlay.root).waitFor({ state: "visible" });
          await page.waitForTimeout(240);
          await auditOverlay({ viewport, name: overlay.name, root: overlay.root });
          completed = true;
        } catch (error) {
          lastError = error;
        } finally {
          try {
            await overlay.close();
            await page.waitForTimeout(40);
          } catch {
            await page.keyboard.press("Escape");
          }
        }
        if (!completed && attempt < 2) {
          await loadApplication(`${viewport.name}-${overlay.name}-retry`);
          await page.waitForTimeout(100);
        }
      }
      if (!completed) {
        failures.push(`${viewport.name}/${overlay.name}: ${String(lastError)}`);
      }
    }
  }

  await context.close();
  process.stderr.write("[overlay-smoke] contexte fermé\n");
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify({ site, measurements, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
