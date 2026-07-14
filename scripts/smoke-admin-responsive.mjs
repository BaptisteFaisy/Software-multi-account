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
const settings = {
  accounts,
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

const jsonFor = (path) => {
  if (path === "/api/settings") return settings;
  if (path === "/api/limits") return limits;
  if (path === "/api/usage") return usage;
  if (path === "/api/account-usage") return accountUsage;
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
const viewMatrix = [
  { name: "settings", trigger: "#settingsToggle", root: ".settings-panel" },
  { name: "limits", trigger: "#limitsToggle", root: ".limits-panel" },
  { name: "dashboard", trigger: "#dashboardToggle", root: ".stats-dashboard" },
  { name: "tasks", trigger: "#tasksToggle", root: ".tasks-panel" },
];
const selectedNames = (value) => new Set(
  String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
);
const selectedViewports = selectedNames(process.env.CST_ADMIN_VIEWPORTS);
const selectedViews = selectedNames(process.env.CST_ADMIN_VIEWS);
const debugLayout = process.env.CST_ADMIN_DEBUG === "1";
const viewports = viewportMatrix.filter(
  ({ name }) => !selectedViewports.size || selectedViewports.has(name),
);
const views = viewMatrix.filter(({ name }) => !selectedViews.size || selectedViews.has(name));

if (!viewports.length || !views.length) {
  throw new Error("La sélection de vues ou de viewports du smoke admin est vide.");
}

const browser = await chromium.launch({ executablePath, headless: true });
const failures = [];
const measurements = [];

try {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    locale: "fr-FR",
    serviceWorkers: "block",
  });
  await context.addInitScript(({ workspacePath, taskItems }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "responsive-smoke-token");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
    localStorage.setItem("codex-switch-terminal.tasks.v1", JSON.stringify(taskItems));
  }, { workspacePath: workspace, taskItems: tasks });

  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => failures.push(`pageerror: ${error.stack || error}`));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: jsonFor(path) });
  });

  await page.goto(`${site}/?smoke=admin-responsive`, { waitUntil: "domcontentloaded" });
  await page.locator("#chatAppSidebar").waitFor({ state: "attached" });

  for (const viewport of viewports) {
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
      await page.waitForTimeout(view.name === "dashboard" ? 450 : 180);

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

  await context.close();
} finally {
  await browser.close();
}

process.stdout.write(`${JSON.stringify({ site, measurements, failures }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
