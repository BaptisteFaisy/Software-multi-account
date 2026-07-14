import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const SITE = process.env.CST_PROOF_URL || "http://127.0.0.1:8080";
const SCREENSHOT = "docs/chat-advanced-tools-8080.png";
const WORKSPACE = "C:\\Demo\\Projet-interface";
const ACCOUNT_ID = "demo-account";

const chromeCandidates = [
  process.env.CST_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);

const executablePath = chromeCandidates.find(existsSync);
if (!executablePath) throw new Error("Chrome ou Chromium est introuvable.");

const settings = {
  accounts: [{
    id: ACCOUNT_ID,
    label: "Compte de démonstration",
    provider: "codex",
    codexHome: "C:\\Demo\\.codex",
    projectDir: WORKSPACE,
    bypass: true,
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
  }],
  proxies: [],
  defaultAccountId: ACCOUNT_ID,
  shell: "powershell",
  codexCommand: "codex",
  autoRunCodex: false,
  proxyControlsEnabled: false,
  pool: {
    port: 8787,
    apiKey: "",
    defaultModel: "gpt-5.6-sol",
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
  codexBypass: true,
  autoDiscoverAccounts: false,
  workspaces: [{
    id: WORKSPACE.toLowerCase().replaceAll("\\", "/"),
    label: "Projet interface",
    path: WORKSPACE,
    memory: "",
  }],
  closedWorkspaceIds: [],
};

const turn = {
  id: 42,
  accountId: ACCOUNT_ID,
  sessionId: null,
  status: "completed",
  startedAt: Math.floor(Date.now() / 1000),
  finishedAt: Math.floor(Date.now() / 1000),
  error: null,
  activities: [],
  thoughts: [],
  parts: [],
};

let submitted = null;
const pageErrors = [];
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const context = await browser.newContext({
    viewport: { width: 1580, height: 980 },
    locale: "fr-FR",
    serviceWorkers: "block",
  });
  await context.addInitScript(({ workspace, accountId }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "preuve-locale");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspace);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspace]));
    localStorage.setItem("codex-switch-terminal.expert-open-chats.v1", JSON.stringify({
      v: 1,
      activeKey: "preuve-outils-avances",
      panes: [{
        key: "preuve-outils-avances",
        sessionId: null,
        accountId,
        draft: "",
        mode: "build",
        enabledTools: [],
        pendingWorkspace: workspace,
      }],
    }));
  }, { workspace: WORKSPACE, accountId: ACCOUNT_ID });

  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/settings") return route.fulfill({ json: settings });
    if (path === "/api/discussions") {
      return route.fulfill({
        json: {
          generatedAt: Date.now(),
          totalDiscussions: 0,
          accounts: [{
            accountId: ACCOUNT_ID,
            label: "Compte de démonstration",
            provider: "codex",
            codexHome: "C:\\Demo\\.codex",
            hasTokens: true,
            discussionCount: 0,
            discussions: [],
          }],
        },
      });
    }
    if (path === "/api/limits") {
      return route.fulfill({ json: [] });
    }
    if (path === "/api/chat/models") return route.fulfill({ json: [] });
    if (path === "/api/chat/turns" && request.method() === "POST") {
      submitted = request.postDataJSON();
      return route.fulfill({ json: turn });
    }
    if (path === "/api/chat/turns/42") return route.fulfill({ json: turn });
    if (path === "/api/autonomous-agents") return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto(`${SITE}/?preuve=outils-avances`, { waitUntil: "domcontentloaded" });
  const pane = page.locator(".chat-panel--expert").first();
  await pane.waitFor({ state: "visible" });
  // La restauration du panneau est asynchrone ; attendre le dernier rendu
  // garantit que les listeners vérifiés sont ceux du DOM définitif.
  await page.waitForTimeout(1_200);
  const skillsToggles = page.locator("#skillsToggle");
  let openedSkills = false;
  for (let index = 0; index < await skillsToggles.count(); index += 1) {
    const candidate = skillsToggles.nth(index);
    if (!await candidate.isVisible()) continue;
    await candidate.click();
    openedSkills = true;
    break;
  }
  if (!openedSkills) throw new Error("Le bouton de la vue Skills est introuvable.");

  const impeccablePin = page.locator('[data-skill-chat-button="impeccable"]');
  await impeccablePin.waitFor({ state: "visible" });
  const pinStateBefore = await impeccablePin.getAttribute("aria-pressed");
  await impeccablePin.click();
  const pinStateRemoved = await impeccablePin.getAttribute("aria-pressed");
  await impeccablePin.click();
  const pinStateRestored = await impeccablePin.getAttribute("aria-pressed");
  if (
    pinStateBefore !== "true"
    || pinStateRemoved !== "false"
    || pinStateRestored !== "true"
  ) {
    throw new Error(`Épinglage impossible : ${JSON.stringify({
      pinStateBefore,
      pinStateRemoved,
      pinStateRestored,
    })}`);
  }

  // Le démarrage normal revient sur les chats et doit restaurer les boutons
  // épinglés sans dépendre de la vue Skills encore ouverte.
  await page.reload({ waitUntil: "domcontentloaded" });
  await pane.waitFor({ state: "visible" });
  await page.waitForTimeout(1_200);
  const fullscreenButton = pane.locator("[data-chat-action='fullscreen']");
  await fullscreenButton.click();
  await page.waitForTimeout(500);

  const activePane = page.locator(".chat-panel--expert.is-fullscreen");
  if (await activePane.count() === 0) {
    throw new Error(`Le plein écran ne s'est pas activé : ${JSON.stringify({
      paneClass: await pane.getAttribute("class"),
      button: await fullscreenButton.evaluate((element) => element.outerHTML),
      pageErrors,
    })}`);
  }
  const thermo = activePane.locator(
    '[data-chat-tool="thermo-nuclear-code-quality-review"]',
  );
  const impeccable = activePane.locator(
    '[data-chat-tool="impeccable"]',
  );
  const interfaceSkill = activePane.locator(
    '[data-chat-tool="make-interfaces-feel-better"]',
  );
  await thermo.click();
  await impeccable.click();
  await interfaceSkill.click();
  await page.waitForTimeout(250);

  const states = {
    thermo: await thermo.getAttribute("aria-pressed"),
    impeccable: await impeccable.getAttribute("aria-pressed"),
    interface: await interfaceSkill.getAttribute("aria-pressed"),
  };
  if (
    states.thermo !== "true"
    || states.impeccable !== "true"
    || states.interface !== "true"
  ) {
    throw new Error(`Activation impossible : ${JSON.stringify(states)}`);
  }

  const persistedTools = await page.evaluate(() => {
    const state = JSON.parse(
      localStorage.getItem("codex-switch-terminal.expert-open-chats.v1") || "null",
    );
    return state?.panes?.[0]?.enabledTools ?? null;
  });

  await page.screenshot({ path: SCREENSHOT, fullPage: true });
  await activePane
    .locator("[data-chat-control='prompt']")
    .fill("Vérifie les deux nouveaux outils.");
  await activePane.locator("[data-chat-action='send']").click();
  for (let attempt = 0; attempt < 50 && !submitted; attempt += 1) {
    await page.waitForTimeout(100);
  }

  const expectedTools = [
    "thermo-nuclear-code-quality-review",
    "impeccable",
    "make-interfaces-feel-better",
  ];
  if (JSON.stringify(submitted?.agentTools) !== JSON.stringify([])) {
    throw new Error(`Payload inattendu : ${JSON.stringify(submitted)}`);
  }
  const submittedSkillIds = submitted?.agentSkills?.map((skill) => skill.id) ?? [];
  if (JSON.stringify(submittedSkillIds) !== JSON.stringify(expectedTools)) {
    throw new Error(`Skills inattendus : ${JSON.stringify(submittedSkillIds)}`);
  }
  if (JSON.stringify(persistedTools) !== JSON.stringify(expectedTools)) {
    throw new Error(`Persistance inattendue : ${JSON.stringify(persistedTools)}`);
  }

  process.stdout.write(`${JSON.stringify({
    url: page.url(),
    visibleButtons: await activePane.locator("[data-chat-tool]").count(),
    thermoPressed: states.thermo,
    impeccablePressed: states.impeccable,
    interfacePressed: states.interface,
    pinStateBefore,
    pinStateRemoved,
    pinStateRestored,
    persistedTools,
    submittedAgentTools: submitted.agentTools,
    submittedAgentSkills: submittedSkillIds,
    screenshot: SCREENSHOT,
    pageErrors,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
