import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:\/)/, "$1"));
const findAvailablePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.unref();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const selectedPort = typeof address === "object" && address ? address.port : 0;
    server.close((error) => {
      if (error) reject(error);
      else resolvePort(selectedPort);
    });
  });
});

const externalBaseUrl = process.env.CST_TUTORIAL_SMOKE_URL?.replace(/\/+$/, "") || "";
const configuredPort = Number(process.env.CST_TUTORIAL_SMOKE_PORT || 0);
const port = externalBaseUrl ? 0 : configuredPort > 0 ? configuredPort : await findAvailablePort();
const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
const chromeCandidates = [
  process.env.CST_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean);
const executablePath = chromeCandidates.find(existsSync);

if (!executablePath) throw new Error("Chrome ou Chromium est introuvable.");

const workspace = "C:\\Smoke\\Tutoriel";
const accountId = "tutorial-smoke-account";
const settings = {
  accounts: [{
    id: accountId,
    label: "Compte tutoriel",
    provider: "codex",
    codexHome: "C:\\Smoke\\.codex-tutorial",
    projectDir: workspace,
    bypass: false,
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
  codexBypass: false,
  autoDiscoverAccounts: false,
  workspaces: [{ id: "tutorial/workspace", label: "Projet tutoriel", path: workspace, memory: "" }],
  closedWorkspaceIds: [],
};

const discussions = {
  generatedAt: Date.now(),
  totalDiscussions: 0,
  accounts: [{
    accountId,
    label: "Compte tutoriel",
    provider: "codex",
    codexHome: "C:\\Smoke\\.codex-tutorial",
    hasTokens: true,
    discussionCount: 0,
    discussions: [],
  }],
};

const apiResponse = (path) => {
  if (path === "/api/settings") return settings;
  if (path === "/api/discussions") return discussions;
  if (
    path === "/api/limits"
    || path === "/api/chat/models"
    || path === "/api/autonomous-agents"
    || path === "/api/orchestrations"
    || path.includes("/events")
    || path.includes("/history")
    || path.includes("skills")
  ) return [];
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

const vite = externalBaseUrl
  ? null
  : spawn(
    process.execPath,
    [resolve(root, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );

const stopVite = async () => {
  if (!vite || vite.exitCode !== null) return;
  vite.kill();
  await Promise.race([
    new Promise((resolveExit) => vite.once("exit", resolveExit)),
    new Promise((resolveDelay) => setTimeout(resolveDelay, 1_500)),
  ]);
  if (vite.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(vite.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    vite.kill("SIGKILL");
  }
};

let viteOutput = "";
vite?.stdout.on("data", (chunk) => { viteOutput += chunk.toString(); });
vite?.stderr.on("data", (chunk) => { viteOutput += chunk.toString(); });

const waitForVite = async () => {
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    if (vite && vite.exitCode !== null) throw new Error(`Vite s'est arrêté.\n${viteOutput}`);
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Le serveur n'écoute pas encore.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
  }
  throw new Error(`${externalBaseUrl ? "Le site" : "Vite"} n'a pas répondu à temps.\n${viteOutput}`);
};

const prepareContext = async (browser, options) => {
  const context = await browser.newContext({
    locale: "fr-FR",
    serviceWorkers: "block",
    ...options,
  });
  await context.addInitScript(({ workspacePath }) => {
    localStorage.setItem("codex-switch-terminal.remote.token", "tutorial-smoke-token");
    localStorage.setItem("codex-switch-terminal.workspace.path", workspacePath);
    localStorage.setItem("codex-switch-terminal.workspaces.v1", JSON.stringify([workspacePath]));
    localStorage.removeItem("codex-switch-terminal.tutorial-progress.v1");
  }, { workspacePath: workspace });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: apiResponse(path) });
  });
  await page.goto(`${baseUrl}/?tutorial-smoke=1`, { waitUntil: "domcontentloaded" });
  await page.locator("#chatAppSidebar").waitFor({ state: "attached" });
  return { context, page };
};

const assertNoHorizontalOverflow = async (page, label) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 1, `${label}: débordement horizontal de ${overflow}px`);
};

const coachGeometry = (page) => page.evaluate(() => {
  const coach = document.querySelector(".tutorial-tour-coach")?.getBoundingClientRect();
  const spotlight = document.querySelector(".tutorial-tour-spotlight")?.getBoundingClientRect();
  return {
    title: document.querySelector("#tutorialTourTitle")?.textContent?.trim() || "",
    coachInside: !!coach
      && coach.left >= 0
      && coach.top >= 0
      && coach.right <= window.innerWidth
      && coach.bottom <= window.innerHeight,
    spotlightVisible: !!spotlight && spotlight.width > 10 && spotlight.height > 10,
  };
});

const openTutorial = async (page, mobile) => {
  if (mobile) {
    await page.waitForFunction(() => !document.querySelector(".boot"));
    const mobileDiagnostic = await page.evaluate(() => {
      const chrome = document.querySelector(".m-chrome");
      return {
        width: window.innerWidth,
        mobileMedia: window.matchMedia("(max-width: 860px)").matches,
        display: chrome ? window.getComputedStyle(chrome).display : "absent",
        hasAuthGate: !!document.querySelector(".account-auth"),
        hasRemoteLogin: !!document.querySelector(".remote-login"),
      };
    });
    assert.equal(mobileDiagnostic.mobileMedia, true, `viewport mobile invalide: ${JSON.stringify(mobileDiagnostic)}`);
    assert.equal(mobileDiagnostic.display, "block", `chrome mobile masquée: ${JSON.stringify(mobileDiagnostic)}`);
    let opened = false;
    for (let attempt = 0; attempt < 4 && !opened; attempt += 1) {
      await page.locator("[data-m='menu']").click();
      try {
        const tutorialBadge = page.locator(".m-sheet [data-tutorial-nav-badge]");
        await tutorialBadge.waitFor({ state: "visible", timeout: 3_000 });
        const badgeInside = await tutorialBadge.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.width > 0
            && rect.height > 0
            && rect.left >= 0
            && rect.top >= 0
            && rect.right <= window.innerWidth
            && rect.bottom <= window.innerHeight;
        });
        assert.equal(badgeInside, true, "le repère Nouveau du Tuto est hors écran");
        await page.screenshot({ path: resolve(root, ".codex-proof/tutorial-mobile-menu.png") });
        await page.locator(".m-sheet [data-view='tutorial']").click({ timeout: 3_000 });
        opened = true;
      } catch {
        await page.waitForTimeout(250);
      }
    }
    assert.equal(opened, true, "l'entrée Tuto du menu mobile ne peut pas être activée");
  } else {
    await page.locator("#tutorialToggle").click();
  }
  await page.locator(".tutorial-panel").waitFor({ state: "visible" });
};

const runDesktop = async (browser) => {
  const { context, page } = await prepareContext(browser, { viewport: { width: 1440, height: 900 } });
  try {
    await openTutorial(page, false);
    await page.locator("#tutorialToggle .tutorial-nav-badge").waitFor({ state: "visible" });
    assert.equal(await page.locator(".tutorial-step-card").count(), 9);
    await assertNoHorizontalOverflow(page, "desktop");
    await page.screenshot({ path: resolve(root, ".codex-proof/tutorial-desktop.png") });

    await page.locator("#tutorialStart").click();
    await page.locator("#tutorialTourLayer").waitFor({ state: "visible" });
    assert.equal(await page.locator("#tutorialToggle .tutorial-nav-badge").count(), 0);
    let geometry = await coachGeometry(page);
    assert.equal(geometry.title, "Ton point de départ");
    assert.equal(geometry.coachInside, true);
    assert.equal(geometry.spotlightVisible, true);

    const expectedTitles = [
      "Choisis ton environnement",
      "Travaille avec plusieurs chats",
      "Garde le terminal à portée de main",
      "Retrouve l’activité du projet",
      "Délègue les travaux longs",
      "Explore les outils spécialisés",
      "Adapte Switch à ta façon de travailler",
      "Tu connais l’essentiel",
    ];
    for (const title of expectedTitles) {
      const previous = geometry.title;
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        ({ previousTitle, expectedTitle }) => {
          const current = document.querySelector("#tutorialTourTitle")?.textContent?.trim();
          return current !== previousTitle && current === expectedTitle;
        },
        { previousTitle: previous, expectedTitle: title },
      );
      geometry = await coachGeometry(page);
      assert.equal(geometry.coachInside, true, `${title}: coach hors écran`);
      assert.equal(geometry.spotlightVisible, true, `${title}: cible absente`);
    }
    assert.match(await page.locator(".chat-admin-head strong").textContent(), /Tuto/);
    await page.screenshot({ path: resolve(root, ".codex-proof/tutorial-tour-finish.png") });
    await page.locator("[data-tutorial-next]").click();
    await page.locator("#tutorialTourLayer").waitFor({ state: "detached" });
    assert.equal(await page.locator("[role='progressbar']").getAttribute("aria-valuenow"), "100");
    assert.match(await page.locator("#tutorialStart").textContent(), /Revoir le parcours/);

    await page.locator("#tutorialReset").click();
    await page.locator("#tutorialStart").click();
    await page.waitForFunction(() => document.querySelector("#tutorialTourTitle")?.textContent === "Ton point de départ");
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("#tutorialTourTitle")?.textContent?.includes("environnement"));
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("#tutorialTourTitle")?.textContent?.includes("plusieurs chats"));
    await page.keyboard.press("Escape");
    await page.locator(".tutorial-panel").waitFor({ state: "visible" });
    assert.match(await page.locator("#tutorialStart").textContent(), /Reprendre à l’étape 3/);
    await page.locator("#tutorialStart").click();
    await page.waitForFunction(() => document.querySelector("#tutorialTourTitle")?.textContent?.includes("plusieurs chats"));
    await page.keyboard.press("Escape");
    return { steps: expectedTitles.length + 1, resumedAt: 3 };
  } finally {
    await context.close();
  }
};

const runMobile = async (browser) => {
  const { context, page } = await prepareContext(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    await openTutorial(page, true);
    assert.equal(await page.locator(".tutorial-step-card").count(), 9);
    await assertNoHorizontalOverflow(page, "mobile");
    const tutorialChrome = await page.evaluate(() => ({
      width: window.innerWidth,
      layoutClass: document.querySelector(".chat-app-layout")?.className || "",
      headerCount: document.querySelectorAll(".chat-admin-head").length,
      headerLayoutClass: document.querySelector(".chat-admin-head")
        ?.closest(".chat-app-layout")?.className || "",
      adminHeaderDisplay: document.querySelector(".chat-admin-head")
        ? window.getComputedStyle(document.querySelector(".chat-admin-head")).display
        : "absent",
      matchingRules: (() => {
        const matches = [];
        const visit = (rules) => {
          for (const rule of rules) {
            if (rule.cssRules) visit(rule.cssRules);
            else if (rule.cssText.includes("is-tutorial") && rule.cssText.includes("chat-admin-head")) {
              matches.push(rule.cssText);
            }
          }
        };
        for (const sheet of document.styleSheets) {
          try { visit(sheet.cssRules); } catch { /* feuille externe */ }
        }
        return matches;
      })(),
    }));
    assert.match(tutorialChrome.layoutClass, /is-tutorial/);
    assert.equal(tutorialChrome.adminHeaderDisplay, "none", JSON.stringify(tutorialChrome));
    const panelInside = await page.locator(".tutorial-panel").evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1;
    });
    assert.equal(panelInside, true);
    await page.screenshot({ path: resolve(root, ".codex-proof/tutorial-mobile.png") });

    await page.locator("#tutorialStart").click();
    await page.locator("#tutorialTourLayer").waitFor({ state: "visible" });
    await page.locator("[data-tutorial-nav-badge]").waitFor({ state: "hidden" });
    let geometry = await coachGeometry(page);
    assert.equal(geometry.coachInside, true);
    assert.equal(geometry.spotlightVisible, true);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector("#tutorialTourTitle")?.textContent?.includes("environnement"));
    geometry = await coachGeometry(page);
    assert.equal(geometry.coachInside, true);
    await page.screenshot({ path: resolve(root, ".codex-proof/tutorial-tour-mobile.png") });
    await page.keyboard.press("Escape");
    await page.locator(".tutorial-panel").waitFor({ state: "visible" });
    return { viewport: "390x844", coachInside: true };
  } finally {
    await context.close();
  }
};

mkdirSync(resolve(root, ".codex-proof"), { recursive: true });
let browser;
try {
  await waitForVite();
  browser = await chromium.launch({ executablePath, headless: true });
  const desktop = await runDesktop(browser);
  const mobile = await runMobile(browser);
  process.stdout.write(`${JSON.stringify({ desktop, mobile }, null, 2)}\n`);
} finally {
  if (browser) await browser.close();
  await stopVite();
}
