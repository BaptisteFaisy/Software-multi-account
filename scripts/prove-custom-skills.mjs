import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const site = process.env.CST_PROOF_URL || "http://127.0.0.1:1420";
const executablePath = [
  process.env.CST_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean).find(existsSync);

if (!executablePath) throw new Error("Chrome ou Chromium est introuvable.");

const workspace = "C:\\SkillProof";
const settings = {
  accounts: [{
    id: "skill-proof",
    label: "Compte preuve",
    provider: "codex",
    codexHome: `${workspace}\\.codex`,
    projectDir: workspace,
    bypass: false,
    model: "gpt-5-codex",
    reasoningEffort: "high",
  }],
  proxies: [],
  defaultAccountId: "skill-proof",
  shell: "powershell",
  codexCommand: "codex",
  autoRunCodex: false,
  proxyControlsEnabled: false,
  codexBypass: false,
  autoDiscoverAccounts: false,
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
  workspaces: [{ id: "skill-proof", label: "Preuve", path: workspace, memory: "" }],
  closedWorkspaceIds: [],
};

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "fr-FR",
    serviceWorkers: "block",
  });
  await context.addInitScript(({ workspacePath }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "skill-proof-token");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
    localStorage.removeItem("codex-switch-terminal.custom-skills.v1");
    localStorage.removeItem("codex-switch-terminal.chat-skill-buttons.v1");
  }, { workspacePath: workspace });

  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings") return route.fulfill({ json: settings });
    if (path === "/api/discussions") {
      return route.fulfill({
        json: { generatedAt: Date.now(), totalDiscussions: 0, accounts: [] },
      });
    }
    if ([
      "/api/chat/turns/active",
      "/api/limits",
      "/api/chat/models",
      "/api/autonomous-agents",
      "/api/orchestrations",
    ].includes(path)) return route.fulfill({ json: [] });
    if (path.includes("kombai") && path.includes("status")) {
      return route.fulfill({
        json: {
          running: false,
          started: false,
          port: 3000,
          command: "code-server",
          binaryAvailable: false,
          extensionId: "",
        },
      });
    }
    if (path.includes("voice") || path.includes("gpu")) {
      return route.fulfill({
        json: {
          mode: "local",
          state: "unavailable",
          stage: "idle",
          whisperReady: false,
          ollamaReachable: false,
          summaryModelLoaded: false,
          summaryModelOnGpu: false,
        },
      });
    }
    return route.fulfill({ json: {} });
  });

  // Le noeud local peut compresser le premier chargement à froid ; le délai
  // des interactions reste court, seule la navigation réseau est plus large.
  await page.goto(`${site}/?skills-proof=1`, {
    waitUntil: "domcontentloaded",
    timeout: 45_000,
  });
  await page.locator("#chatAppSidebar").waitFor({ state: "visible" });
  const skillNavigation = page.locator("#skillsToggle");
  if (!(await skillNavigation.isVisible())) {
    const more = page.locator("#chatSideMoreToggle");
    if ((await more.getAttribute("aria-expanded")) !== "true") await more.click();
  }
  await skillNavigation.click();

  await page.locator("#skillsAdd").click();
  const editor = page.locator("#skillEditorDialog");
  await editor.waitFor({ state: "visible" });
  await editor.locator("#skillEditorName").fill("Skill navigateur");
  await editor.locator("#skillEditorDescription").fill("Vérifie le parcours réel dans Chrome.");
  await editor.locator("#skillEditorTags").fill("preuve, navigateur");
  await editor.locator("#skillEditorContent").fill(
    "# Preuve\n\nContrôle le résultat dans le navigateur.",
  );
  await editor.locator("#skillEditorSave").click();
  await editor.waitFor({ state: "detached" });

  const skillId = "custom-skill-navigateur";
  const editButton = page.locator(`[data-skill-edit="${skillId}"]`);
  await editButton.waitFor({ state: "visible" });
  const pinned = await page.locator(`[data-skill-chat-button="${skillId}"]`)
    .getAttribute("aria-pressed");
  const stored = await page.evaluate(() => ({
    skills: JSON.parse(localStorage.getItem("codex-switch-terminal.custom-skills.v1") || "[]"),
    buttons: JSON.parse(localStorage.getItem("codex-switch-terminal.chat-skill-buttons.v1") || "[]"),
  }));

  await editButton.click();
  await editor.waitFor({ state: "visible" });
  const restoredName = await editor.locator("#skillEditorName").inputValue();
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await editor.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
    };
  });
  await editor.locator("[data-skill-editor-close]").first().click();

  await page.locator(`[data-skill-delete="${skillId}"]`).click();
  await editButton.waitFor({ state: "detached" });
  const afterDelete = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("codex-switch-terminal.custom-skills.v1") || "[]"));

  const result = {
    createdIds: stored.skills.map((skill) => skill.id),
    pinned,
    buttonStored: stored.buttons.includes(skillId),
    restoredName,
    mobileBounds,
    customSkillsAfterDelete: afterDelete.length,
  };
  const mobileFits = mobileBounds.left >= -1
    && mobileBounds.right <= mobileBounds.viewportWidth + 1
    && mobileBounds.top >= -1
    && mobileBounds.bottom <= mobileBounds.viewportHeight + 1;
  if (
    pinned !== "true"
    || !result.buttonStored
    || restoredName !== "Skill navigateur"
    || afterDelete.length !== 0
    || !mobileFits
  ) throw new Error(`Preuve Skills invalide : ${JSON.stringify(result)}`);

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  await context.close();
} finally {
  await browser.close();
}
