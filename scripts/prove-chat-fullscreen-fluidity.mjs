import { existsSync } from "node:fs";
import { chromium } from "playwright-core";

const site = process.env.CST_PROOF_URL || "http://127.0.0.1:1420";
const workspace = "C:\\Smoke\\Longue-conversation";
const accountId = "fullscreen-proof-account";
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
    id: accountId,
    label: "Compte preuve plein écran",
    provider: "codex",
    codexHome: "C:\\Smoke\\.codex-fullscreen",
    projectDir: workspace,
    bypass: true,
    model: "gpt-5-codex",
    reasoningEffort: "high",
  }],
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
    id: workspace.toLowerCase().replaceAll("\\", "/"),
    label: "Conversation longue",
    path: workspace,
    memory: "",
  }],
  closedWorkspaceIds: [],
};

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "fr-FR",
    serviceWorkers: "block",
  });
  await context.addInitScript(({ workspacePath, proofAccountId }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "preuve-plein-ecran");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
    localStorage.setItem("codex-switch-terminal.expert-open-chats.v1", JSON.stringify({
      v: 1,
      activeKey: "fullscreen-proof-pane",
      panes: [{
        key: "fullscreen-proof-pane",
        sessionId: null,
        accountId: proofAccountId,
        draft: "",
        mode: "build",
        enabledTools: [],
        pendingWorkspace: workspacePath,
      }],
    }));
  }, { workspacePath: workspace, proofAccountId: accountId });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack || String(error)));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/settings") return route.fulfill({ json: settings });
    if (path === "/api/auth/config") {
      return route.fulfill({
        json: { enabled: false, registrationEnabled: false, googleEnabled: false },
      });
    }
    if (path === "/api/discussions") {
      return route.fulfill({
        json: {
          generatedAt: Date.now(),
          totalDiscussions: 0,
          accounts: [{
            accountId,
            label: "Compte preuve plein écran",
            provider: "codex",
            codexHome: "C:\\Smoke\\.codex-fullscreen",
            hasTokens: true,
            discussionCount: 0,
            discussions: [],
          }],
        },
      });
    }
    if (
      path === "/api/limits"
      || path === "/api/chat/models"
      || path === "/api/chat/turns/active"
      || path === "/api/autonomous-agents"
      || path === "/api/orchestrations"
    ) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });

  await page.goto(`${site}/?proof=fullscreen-fluidity`, { waitUntil: "domcontentloaded" });
  const pane = page.locator(".chat-panel--expert.active").first();
  await pane.waitFor({ state: "visible" });
  // La restauration des chats est asynchrone. Mesurer seulement le DOM définitif.
  await page.waitForTimeout(1_500);

  const result = await pane.evaluate(async (root) => {
    const feed = root.querySelector(".chat-feed");
    const button = root.querySelector("[data-chat-action='fullscreen']");
    if (!feed || !button) throw new Error("Le panneau de chat est incomplet.");

    feed.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 400; index += 1) {
      const message = document.createElement("article");
      message.className = `chat-msg chat-msg--${index % 2 ? "assistant" : "user"}`;
      message.dataset.chatMessageIndex = String(index);
      const paragraph = document.createElement("p");
      paragraph.textContent = `Message ${index + 1} — ${"contenu volumineux ".repeat(12)}`;
      message.append(paragraph);
      fragment.append(message);
    }
    feed.append(fragment);
    feed.scrollTop = feed.scrollHeight;

    const enterStart = performance.now();
    button.click();
    const enterHandlerMs = performance.now() - enterStart;
    const enterIdentityPreserved = root.isConnected
      && root.querySelector(".chat-feed") === feed
      && feed.childElementCount === 400;
    await Promise.all(root.getAnimations().map((animation) =>
      animation.finished.catch(() => undefined)));
    const fullscreenRect = root.getBoundingClientRect();

    const exitStart = performance.now();
    button.click();
    const exitHandlerMs = performance.now() - exitStart;
    const exitIdentityPreserved = root.isConnected
      && root.querySelector(".chat-feed") === feed
      && feed.childElementCount === 400;
    await Promise.all(root.getAnimations().map((animation) =>
      animation.finished.catch(() => undefined)));

    return {
      enterHandlerMs,
      enterIdentityPreserved,
      exitHandlerMs,
      exitIdentityPreserved,
      fullscreenRect: {
        bottom: fullscreenRect.bottom,
        left: fullscreenRect.left,
        right: fullscreenRect.right,
        top: fullscreenRect.top,
      },
      messageNodes: feed.childElementCount,
    };
  });

  const proof = { ...result, pageErrors };
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (
    pageErrors.length
    || !result.enterIdentityPreserved
    || !result.exitIdentityPreserved
    || result.messageNodes !== 400
    || result.fullscreenRect.left !== 0
    || result.fullscreenRect.top !== 0
    || Math.abs(result.fullscreenRect.right - 1440) > 1
    || Math.abs(result.fullscreenRect.bottom - 900) > 1
  ) process.exitCode = 1;
} finally {
  await browser.close();
}
