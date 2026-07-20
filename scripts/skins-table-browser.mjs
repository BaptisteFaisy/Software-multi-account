import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

export const SKINS_TABLE_URL =
  "https://skins-table.com/table/?g=730&n=&pf1=0.50&pt1=&pf2=&pt2=&cif1=500&cit1=&cif2=1&cit2=&fit1=&fit2=&bd1=8&bd2=8&pf=&pt=&csd=0&csb=0&css=0&csbs=0&csm=0&ss1=SKINBARON&ss2=STEAM+ORDER&sb=ON&ob=ON&fb=OFF&stb=ON&scb=ON&nb=OFF&mi=OFF&pb=%25&cs=USD";

const browserProfilesRoot = process.platform === "win32"
  ? join(
    process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
    "CodexSwitchTerminal",
    "browser-profiles",
  )
  : join(
    process.env.CST_DATA_DIR || join(homedir(), ".local", "share", "codex-switch-terminal"),
    "browser-profiles",
  );

const APP_DIR = join(browserProfilesRoot, "skins-table-monitor");

export const PROFILE_DIR = resolve(process.env.SKINS_TABLE_PROFILE_DIR || APP_DIR);
export const SKINBARON_PROFILE_DIR = resolve(
  process.env.SKINBARON_PROFILE_DIR
    || join(dirname(APP_DIR), "skinbaron-assisted-checkout"),
);
const STATUS_PATH = join(PROFILE_DIR, "cst-session-status.json");
const MONITOR_STATE_PATH = join(PROFILE_DIR, "cst-monitor-state.json");
const SESSION_STATE_PATH = join(PROFILE_DIR, "cst-storage-state.json");
const ASSISTED_CHECKOUT_CONFIG_PATH = join(PROFILE_DIR, "cst-assisted-checkout.json");
const SKINBARON_STATUS_PATH = join(SKINBARON_PROFILE_DIR, "cst-checkout-status.json");
const SKINBARON_PENDING_PATH = join(SKINBARON_PROFILE_DIR, "cst-pending-checkout.json");
const LOGIN_TIMEOUT_MS = Number(process.env.SKINS_TABLE_LOGIN_TIMEOUT_MS || 15 * 60 * 1000);
const SKINBARON_LOGIN_TIMEOUT_MS = Number(
  process.env.SKINBARON_LOGIN_TIMEOUT_MS || 15 * 60 * 1000,
);
const SKINBARON_CONFIRMATION_TIMEOUT_MS = Number(
  process.env.SKINBARON_CONFIRMATION_TIMEOUT_MS || 10 * 60 * 1000,
);
const DEAL_THRESHOLD_PERCENT = 30;
const DEFAULT_STEAM_FEE_PERCENT = 13;
const MAX_ASSISTED_CASE_QUANTITY = 100;
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const FORBIDDEN_CASE_LABELS = /\b(?:capsule|key|package|sticker|graffiti|pass)\b/i;

const chromeCandidates = [
  process.env.CST_CHROME_PATH,
  ...(process.platform === "win32" ? [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
  ] : []),
  ...(process.platform === "linux" ? [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ] : []),
].filter(Boolean);

const executablePath = chromeCandidates.find(existsSync);

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

const nowIso = () => new Date().toISOString();

const writePrivateJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
};

const isSkinsTableDomain = (value) => {
  const domain = String(value || "").replace(/^\./, "").toLowerCase();
  return domain === "skins-table.com" || domain.endsWith(".skins-table.com");
};

const sanitizeSkinsTableStorageState = (value) => ({
  cookies: Array.isArray(value?.cookies)
    ? value.cookies.filter((cookie) => isSkinsTableDomain(cookie?.domain))
    : [],
  origins: Array.isArray(value?.origins)
    ? value.origins.filter((entry) => {
      try {
        return isSkinsTableDomain(new URL(entry?.origin).hostname);
      } catch {
        return false;
      }
    })
    : [],
});

const readSessionState = () => {
  if (!existsSync(SESSION_STATE_PATH)) return { cookies: [], origins: [] };
  try {
    return sanitizeSkinsTableStorageState(JSON.parse(readFileSync(SESSION_STATE_PATH, "utf8")));
  } catch {
    return { cookies: [], origins: [] };
  }
};

const persistSessionState = async (context) => {
  const state = sanitizeSkinsTableStorageState(await context.storageState());
  writePrivateJson(SESSION_STATE_PATH, state);
  return state;
};

const writeStatus = (value) => {
  writePrivateJson(STATUS_PATH, { ...value, updatedAt: nowIso() });
};

const writeSkinbaronStatus = (value) => {
  writePrivateJson(SKINBARON_STATUS_PATH, { ...value, updatedAt: nowIso() });
};

const readStatus = () => {
  if (!existsSync(STATUS_PATH)) return { state: "not_configured" };
  try {
    return JSON.parse(readFileSync(STATUS_PATH, "utf8"));
  } catch {
    return { state: "invalid_status" };
  }
};

const readMonitorState = () => {
  if (!existsSync(MONITOR_STATE_PATH)) return { deals: {} };
  try {
    const parsed = JSON.parse(readFileSync(MONITOR_STATE_PATH, "utf8"));
    return parsed && typeof parsed.deals === "object" ? parsed : { deals: {} };
  } catch {
    return { deals: {} };
  }
};

const writeMonitorState = (value) => {
  writePrivateJson(MONITOR_STATE_PATH, value);
};

const readAssistedCheckoutConfig = () => {
  if (!existsSync(ASSISTED_CHECKOUT_CONFIG_PATH)) return { enabled: false };
  try {
    const parsed = JSON.parse(readFileSync(ASSISTED_CHECKOUT_CONFIG_PATH, "utf8"));
    return { enabled: parsed?.enabled === true };
  } catch {
    return { enabled: false };
  }
};

const writeAssistedCheckoutConfig = (enabled) => {
  writePrivateJson(ASSISTED_CHECKOUT_CONFIG_PATH, {
    enabled,
    requireFinalUserClick: true,
    updatedAt: nowIso(),
  });
};

const printJson = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

const isSkinsTableHost = (url) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "skins-table.com" || hostname.endsWith(".skins-table.com");
  } catch {
    return false;
  }
};

const isSteamHost = (url) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "steamcommunity.com" || hostname.endsWith(".steamcommunity.com");
  } catch {
    return false;
  }
};

const isSkinbaronHost = (url) => {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "skinbaron.de" || hostname.endsWith(".skinbaron.de");
  } catch {
    return false;
  }
};

export const isEligibleCs2Case = (name) => {
  const normalized = String(name || "").replace(/\s+/g, " ").trim();
  return /\bcase$/i.test(normalized) && !FORBIDDEN_CASE_LABELS.test(normalized);
};

const rounded = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

export const calculateEconomics = ({ buyPrice, referencePrice, feePercent }) => {
  const netReferencePrice = referencePrice * (1 - feePercent / 100);
  const profitUsd = netReferencePrice - buyPrice;
  return {
    netReferencePrice: rounded(netReferencePrice),
    profitUsd: rounded(profitUsd),
    marginPercent: netReferencePrice > 0 ? rounded((profitUsd / netReferencePrice) * 100) : null,
    roiPercent: buyPrice > 0 ? rounded((profitUsd / buyPrice) * 100) : null,
  };
};

export const calculateCaseQuantityPlan = ({
  availabilityRows,
  tableBuyPrice,
  tableBuyPriceEur,
  referencePrice,
  feePercent,
  balanceEur = Number.POSITIVE_INFINITY,
  maxQuantity = MAX_ASSISTED_CASE_QUANTITY,
  thresholdPercent = DEAL_THRESHOLD_PERCENT,
}) => {
  if (
    !Array.isArray(availabilityRows)
    || !Number.isFinite(tableBuyPrice)
    || tableBuyPrice <= 0
    || !Number.isFinite(tableBuyPriceEur)
    || tableBuyPriceEur <= 0
    || !Number.isFinite(referencePrice)
    || referencePrice <= 0
    || !Number.isFinite(feePercent)
    || !Number.isFinite(maxQuantity)
    || maxQuantity <= 0
  ) {
    return { accepted: false, reason: "invalid_quantity_plan_input" };
  }

  const normalizedBalance = Number.isFinite(balanceEur)
    ? Math.max(0, balanceEur)
    : Number.POSITIVE_INFINITY;
  const quantityLimit = Math.min(
    MAX_ASSISTED_CASE_QUANTITY,
    Math.max(1, Math.floor(maxQuantity)),
  );
  const usdPerEur = tableBuyPrice / tableBuyPriceEur;
  const tiers = [];
  let quantity = 0;
  let totalCostEur = 0;

  const sortedRows = availabilityRows
    .map((row) => ({
      priceEur: rounded(Number(row?.price), 2),
      amount: Math.floor(Number(row?.amount)),
    }))
    .filter((row) => Number.isFinite(row.priceEur) && row.priceEur > 0)
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0)
    .sort((left, right) => left.priceEur - right.priceEur);

  for (const row of sortedRows) {
    if (quantity >= quantityLimit) break;
    const economics = calculateEconomics({
      buyPrice: row.priceEur * usdPerEur,
      referencePrice,
      feePercent,
    });
    if (
      !Number.isFinite(economics.marginPercent)
      || economics.marginPercent <= thresholdPercent
    ) {
      break;
    }

    const remainingQuantity = quantityLimit - quantity;
    const remainingBalance = normalizedBalance - totalCostEur;
    const affordableQuantity = Number.isFinite(remainingBalance)
      ? Math.max(0, Math.floor((remainingBalance + 1e-8) / row.priceEur))
      : row.amount;
    const selected = Math.min(row.amount, remainingQuantity, affordableQuantity);
    if (selected <= 0) break;

    quantity += selected;
    totalCostEur = rounded(totalCostEur + selected * row.priceEur, 2);
    tiers.push({
      priceEur: row.priceEur,
      available: row.amount,
      selected,
      marginPercent: economics.marginPercent,
    });

    if (selected < row.amount) break;
  }

  if (quantity <= 0 || tiers.length === 0) {
    return { accepted: false, reason: "no_affordable_tier_above_threshold" };
  }

  const lastTier = tiers.at(-1);
  return {
    accepted: true,
    quantity,
    totalCostEur,
    maximumUnitPriceEur: lastTier.priceEur,
    worstMarginPercent: lastTier.marginPercent,
    estimatedRemainingBalanceEur: Number.isFinite(normalizedBalance)
      ? rounded(normalizedBalance - totalCostEur, 2)
      : null,
    tiers,
  };
};

const dealKey = (deal) => createHash("sha256")
  .update(`${deal.name}\n${deal.buyPlatform}\n${deal.referencePlatform}`)
  .digest("hex")
  .slice(0, 20);

const hasMeaningfulChange = (before, after) => (
  Math.abs(Number(before.buyPrice) - Number(after.buyPrice)) >= 0.01
  || Math.abs(Number(before.referencePrice) - Number(after.referencePrice)) >= 0.01
  || Math.abs(Number(before.sitePercent) - Number(after.sitePercent)) >= 0.5
);

export const selectAlerts = (deals, previousDeals = {}) => deals.flatMap((deal) => {
  const key = dealKey(deal);
  const previous = previousDeals[key];
  if (!previous) return [{ ...deal, alertReason: "new", alertKey: key }];
  if (hasMeaningfulChange(previous, deal)) {
    return [{ ...deal, alertReason: "changed", alertKey: key }];
  }
  return [];
});

export const mergeDealHistory = (previousDeals = {}, qualifyingDeals = []) => ({
  ...(previousDeals && typeof previousDeals === "object" ? previousDeals : {}),
  ...Object.fromEntries(qualifyingDeals.map((deal) => [dealKey(deal), deal])),
});

export const assessSkinbaronVerification = (
  row,
  observation,
  thresholdPercent = DEAL_THRESHOLD_PERCENT,
) => {
  const base = {
    name: row.name,
    tableBuyPrice: row.buyPrice,
    tableBuyPriceEur: row.buyPriceEur,
    tablePercent: row.sitePercent,
    verificationStatus: observation.status,
    verificationReason: observation.reason || null,
    verificationDiagnostic: observation.diagnostic || null,
    verificationLink: observation.detailLink || row.buyLink,
    skinbaronCheckedAt: observation.checkedAt || nowIso(),
    skinbaronTradablePriceEur: observation.tradablePriceEur ?? null,
    skinbaronTradableCount: observation.tradableCount ?? null,
    skinbaronTradeLockedPriceEur: observation.tradeLockedPriceEur ?? null,
    skinbaronTradeLockedCount: observation.tradeLockedCount ?? null,
  };

  if (observation.status !== "verified") {
    return { accepted: false, rejection: base };
  }
  if (!Number.isFinite(row.buyPriceEur) || row.buyPriceEur <= 0) {
    return {
      accepted: false,
      rejection: { ...base, verificationReason: "table_eur_conversion_unavailable" },
    };
  }
  if (!Number.isFinite(observation.tradablePriceEur) || observation.tradablePriceEur <= 0) {
    return {
      accepted: false,
      rejection: { ...base, verificationReason: "tradable_price_unavailable" },
    };
  }
  if (!Number.isFinite(observation.tradableCount) || observation.tradableCount <= 0) {
    return {
      accepted: false,
      rejection: { ...base, verificationReason: "no_tradable_offer" },
    };
  }

  const usdPerEur = row.buyPrice / row.buyPriceEur;
  const verifiedBuyPrice = observation.tradablePriceEur * usdPerEur;
  const economics = calculateEconomics({
    buyPrice: verifiedBuyPrice,
    referencePrice: row.referencePrice,
    feePercent: row.feePercent,
  });
  const verified = {
    ...row,
    ...base,
    buyPrice: rounded(verifiedBuyPrice, 6),
    buyCount: observation.tradableCount,
    sitePercent: economics.marginPercent,
    ...economics,
  };

  if (!Number.isFinite(economics.marginPercent) || economics.marginPercent <= thresholdPercent) {
    return {
      accepted: false,
      rejection: {
        ...verified,
        verificationReason: "verified_margin_not_above_threshold",
      },
    };
  }
  return { accepted: true, deal: verified };
};

const launchContext = async ({ headless, profileDir = PROFILE_DIR }) => {
  if (!executablePath) {
    throw new Error("Google Chrome est introuvable. Configure CST_CHROME_PATH si nécessaire.");
  }
  mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless,
    locale: "fr-FR",
    viewport: headless ? { width: 1600, height: 1000 } : null,
    acceptDownloads: false,
    args: [
      "--start-maximized",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-dev-shm-usage",
      "--disable-features=AutofillServerCommunication,PasswordManagerOnboarding",
    ],
  });
  if (profileDir === PROFILE_DIR) {
    const state = readSessionState();
    if (state.cookies.length > 0) await context.addCookies(state.cookies);
  }
  return context;
};

const activePage = (context) => context.pages().at(-1) || context.pages()[0];

const sessionStaysOnSkinsTable = async (page) => {
  try {
    await page.goto(SKINS_TABLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await delay(4_000);
    return isSkinsTableHost(page.url());
  } catch {
    return false;
  }
};

const retainOnlySkinsTableCookies = async (context, page) => {
  const siteCookies = await context.cookies(["https://skins-table.com/"]);
  await context.clearCookies();
  if (siteCookies.length > 0) await context.addCookies(siteCookies);

  const cdp = await context.newCDPSession(page);
  for (const origin of [
    "https://steamcommunity.com",
    "https://store.steampowered.com",
    "https://login.steampowered.com",
  ]) {
    try {
      await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    } catch {
      // Chrome versions differ slightly here. Clearing every non-site cookie above
      // remains the important protection if per-origin storage cleanup is unavailable.
    }
  }
};

const retainOnlySkinbaronCookies = async (context, page) => {
  const siteCookies = await context.cookies(["https://skinbaron.de/"]);
  await context.clearCookies();
  if (siteCookies.length > 0) await context.addCookies(siteCookies);

  const cdp = await context.newCDPSession(page);
  for (const origin of [
    "https://steamcommunity.com",
    "https://store.steampowered.com",
    "https://login.steampowered.com",
  ]) {
    try {
      await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
    } catch {
      // The dedicated checkout profile keeps the SkinBaron session only. Cookie
      // clearing above remains the main protection on older Chrome versions.
    }
  }
};

const skinbaronSessionIsAuthenticated = async (page) => {
  if (!page || page.isClosed() || !isSkinbaronHost(page.url())) return false;
  try {
    await page.waitForSelector(".profile-widget", { timeout: 5_000 });
    return page.locator(".profile-widget").evaluate((widget) => (
      Boolean(widget.querySelector("img"))
      || !widget.querySelector(".profile-icon")
    ));
  } catch {
    return false;
  }
};

const waitForSkinbaronAuthentication = async (context, deadline) => {
  while (Date.now() < deadline) {
    const page = activePage(context);
    if (!page || page.isClosed()) return null;
    if (await skinbaronSessionIsAuthenticated(page)) return page;
    await delay(isSteamHost(page.url()) ? 2_000 : 3_000);
  }
  return null;
};

const loginSkinbaron = async () => {
  writeSkinbaronStatus({ state: "opening_login" });
  const context = await launchContext({
    headless: false,
    profileDir: SKINBARON_PROFILE_DIR,
  });
  try {
    const page = activePage(context);
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    await page.goto("https://skinbaron.de/en", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    writeSkinbaronStatus({
      state: "awaiting_user_login",
      instruction: "Connecte-toi manuellement avec Steam dans cette fenetre. Ne communique aucun secret au chat.",
    });

    const authenticatedPage = await waitForSkinbaronAuthentication(
      context,
      Date.now() + SKINBARON_LOGIN_TIMEOUT_MS,
    );
    if (!authenticatedPage) {
      writeSkinbaronStatus({ state: "login_incomplete" });
      throw new Error("La connexion SkinBaron n'a pas ete confirmee dans le delai imparti.");
    }

    await retainOnlySkinbaronCookies(context, authenticatedPage);
    await authenticatedPage.goto("https://skinbaron.de/en", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!await skinbaronSessionIsAuthenticated(authenticatedPage)) {
      writeSkinbaronStatus({ state: "login_incomplete" });
      throw new Error("La session SkinBaron n'est plus valide apres le nettoyage des cookies Steam.");
    }
    writeSkinbaronStatus({ state: "ready", verifiedAt: nowIso() });
    process.stdout.write("Connexion SkinBaron confirmee. Les cookies Steam ont ete retires du profil dedie.\n");
    await delay(1_500);
  } finally {
    await context.close().catch(() => {});
  }
};

const login = async () => {
  writeStatus({ state: "opening_login" });
  const context = await launchContext({ headless: false });
  let verified = false;
  try {
    let page = activePage(context);
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    await page.goto(SKINS_TABLE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
    writeStatus({
      state: "awaiting_user",
      instruction: "Termine la connexion dans la fenêtre Chrome dédiée. Ne communique aucun secret au chat.",
    });

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      page = activePage(context);
      if (!page || page.isClosed()) break;

      if (isSkinsTableHost(page.url()) && await sessionStaysOnSkinsTable(page)) {
        await retainOnlySkinsTableCookies(context, page);
        verified = await sessionStaysOnSkinsTable(page);
        if (verified) break;
      }

      await delay(isSteamHost(page.url()) ? 2_000 : 3_000);
    }

    if (!verified) {
      writeStatus({ state: "login_incomplete" });
      throw new Error("La connexion Skins-Table n'a pas été confirmée avant la fermeture ou le délai limite.");
    }

    await persistSessionState(context);
    writeStatus({ state: "ready", verifiedAt: nowIso() });
    process.stdout.write(
      "Connexion Skins-Table confirmée. Les cookies Steam ont été retirés du profil dédié.\n",
    );
    await delay(1_500);
  } finally {
    await context.close().catch(() => {});
  }
};

const exportSession = async () => {
  const context = await launchContext({ headless: true });
  try {
    const page = activePage(context);
    if (!await sessionStaysOnSkinsTable(page)) {
      printJson({ ok: false, code: "AUTH_REQUIRED", status: readStatus() });
      process.exitCode = 2;
      return;
    }
    await retainOnlySkinsTableCookies(context, page);
    if (!await sessionStaysOnSkinsTable(page)) {
      printJson({ ok: false, code: "AUTH_REQUIRED", status: readStatus() });
      process.exitCode = 2;
      return;
    }
    const state = await persistSessionState(context);
    writeStatus({ state: "ready", verifiedAt: readStatus().verifiedAt || nowIso() });
    printJson({ ok: true, code: "SESSION_EXPORTED", cookieCount: state.cookies.length });
  } finally {
    await context.close().catch(() => {});
  }
};

const inspect = async () => {
  const context = await launchContext({ headless: true });
  try {
    const page = activePage(context);
    const authenticated = await sessionStaysOnSkinsTable(page);
    if (!authenticated) {
      printJson({ ok: false, code: "AUTH_REQUIRED", status: readStatus() });
      process.exitCode = 2;
      return;
    }

    await delay(8_000);
    const diagnostic = await page.evaluate(() => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const elementInfo = (element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        className: clean(typeof element.className === "string" ? element.className : ""),
        text: clean(element.innerText).slice(0, 800),
        links: [...element.querySelectorAll("a[href]")].slice(0, 5).map((link) => ({
          text: clean(link.textContent).slice(0, 120),
          href: link.href,
        })),
      });

      const tableRows = [...document.querySelectorAll("table tr")]
        .filter((row) => clean(row.innerText))
        .slice(0, 15)
        .map(elementInfo);
      const roleRows = [...document.querySelectorAll('[role="row"]')]
        .filter((row) => clean(row.innerText))
        .slice(0, 15)
        .map(elementInfo);
      const percentElements = [...document.querySelectorAll("body *")]
        .filter((element) => element.children.length === 0 && /\d+(?:[.,]\d+)?\s*%/.test(clean(element.textContent)))
        .slice(0, 30)
        .map((element) => {
          const parent = element.closest('tr, [role="row"], [class*="row"], [class*="item"]') || element.parentElement || element;
          return elementInfo(parent);
        });

      return {
        title: document.title,
        tableCount: document.querySelectorAll("table").length,
        tableRows,
        roleRows,
        percentElements,
      };
    });
    printJson({ ok: true, ...diagnostic });
  } finally {
    await context.close().catch(() => {});
  }
};

const extractRows = async (page) => page.evaluate((defaultFeePercent) => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const numberFrom = (value) => {
    const match = clean(value).match(/-?\d+(?:[.,]\d+)?/);
    return match ? Number(match[0].replace(",", ".")) : null;
  };
  const priceFrom = (value) => {
    const match = clean(value).match(/(\d+(?:[.,]\d+)?)\s*\$/);
    return match ? Number(match[1].replace(",", ".")) : null;
  };
  const euroPriceFrom = (value) => {
    const match = clean(value).match(/(\d+(?:[.,]\d+)?)\s*\u20ac/);
    return match ? Number(match[1].replace(",", ".")) : null;
  };
  const headerText = clean(document.querySelector("table tr")?.innerText);
  const feeMatch = headerText.match(/STEAM\s+ORDER\s+(\d+(?:[.,]\d+)?)\s*%/i);
  const feePercent = feeMatch ? Number(feeMatch[1].replace(",", ".")) : defaultFeePercent;

  const rows = [...document.querySelectorAll("tr.hover")].map((row) => {
    const nameCell = row.querySelector("td[data-nameclip]");
    const priceCells = [...row.querySelectorAll("span.price")];
    const countCells = [...row.querySelectorAll("td.count")];
    const percentCell = row.querySelector('td[class*="percent"]');
    const rawPriceSource = row.querySelector(".plus_list")?.getAttribute("onclick") || "";
    const rawPrices = rawPriceSource.match(/plusAdd\(this,\s*([0-9.]+),\s*([0-9.]+)\)/i);
    const buyLink = row.querySelector("a.img_skinbaron")?.href || "";
    const referenceLink = row.querySelector("a.img_steam")?.href || "";
    const buyPrice = rawPrices ? Number(rawPrices[1]) : priceFrom(priceCells[0]?.innerText);
    const referencePrice = rawPrices ? Number(rawPrices[2]) : priceFrom(priceCells[1]?.innerText);
    const sitePercent = numberFrom(percentCell?.innerText);
    return {
      name: clean(nameCell?.dataset.nameclip || nameCell?.innerText),
      buyPlatform: "SKINBARON",
      referencePlatform: "STEAM ORDER",
      buyPrice,
      buyPriceEur: euroPriceFrom(priceCells[0]?.innerText),
      referencePrice,
      buyCount: numberFrom(countCells[0]?.innerText),
      referenceCount: numberFrom(countCells[1]?.innerText),
      sitePercent,
      feePercent,
      buyLink,
      referenceLink,
      buyPriceUpdatedAt: priceCells[0]?.dataset.time || null,
      referencePriceUpdatedAt: priceCells[1]?.dataset.time || null,
    };
  });
  return rows.filter((row) => (
    row.name
    && Number.isFinite(row.buyPrice)
    && Number.isFinite(row.referencePrice)
    && Number.isFinite(row.sitePercent)
  ));
}, DEFAULT_STEAM_FEE_PERCENT);

const isAllowedSkinbaronUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      url.hostname === "skinbaron.de" || url.hostname.endsWith(".skinbaron.de")
    );
  } catch {
    return false;
  }
};

const observeSkinbaronDetail = async (page, expectedName) => {
  await page.waitForSelector(".modal-info-box.buy-box", { timeout: 45_000 });
  return page.evaluate((nameToMatch) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const numberFrom = (value) => {
      const match = clean(value).match(/\d+(?:[.,]\d+)?/);
      return match ? Number(match[0].replace(",", ".")) : null;
    };
    const exactName = clean(document.querySelector("h1.modal-title")?.textContent);
    if (exactName.toLocaleLowerCase() !== clean(nameToMatch).toLocaleLowerCase()) {
      return { status: "rejected", reason: "detail_item_mismatch" };
    }
    const tradable = document.querySelector(".stackable-tradable");
    const tradeLocked = document.querySelector(".stackable-tradelocked");
    return {
      status: "verified",
      tradablePriceEur: numberFrom(tradable?.querySelector(".product-price-heading")?.textContent),
      tradableCount: numberFrom(tradable?.querySelector(".product-quantity-available")?.textContent),
      tradeLockedPriceEur: numberFrom(tradeLocked?.querySelector(".product-price-heading")?.textContent),
      tradeLockedCount: numberFrom(tradeLocked?.querySelector(".product-quantity-available")?.textContent),
    };
  }, expectedName);
};

const verifySkinbaronCandidate = async (page, row) => {
  const checkedAt = nowIso();
  if (!isAllowedSkinbaronUrl(row.buyLink)) {
    return { status: "rejected", reason: "invalid_skinbaron_link", checkedAt };
  }

  try {
    const response = await page.goto(row.buyLink, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!response || response.status() >= 400) {
      return {
        status: "unavailable",
        reason: `skinbaron_http_${response?.status() || "unknown"}`,
        checkedAt,
      };
    }
    await page.waitForSelector("a.offer-card", { timeout: 45_000 });

    const cardIndex = await page.locator("a.offer-card").evaluateAll((cards, expectedName) => {
      const normalizedExpected = String(expectedName || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
      return cards.findIndex((card) => {
        const name = String(card.querySelector(".lName.big")?.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .toLocaleLowerCase();
        return name === normalizedExpected;
      });
    }, row.name);

    if (cardIndex < 0) {
      return { status: "rejected", reason: "exact_item_not_found", checkedAt };
    }

    const card = page.locator("a.offer-card").nth(cardIndex);
    const detailHref = await card.getAttribute("href");
    const detailLink = detailHref ? new URL(detailHref, page.url()).href : "";
    if (!isAllowedSkinbaronUrl(detailLink)) {
      return { status: "rejected", reason: "invalid_skinbaron_detail_link", checkedAt };
    }

    await page.goto(detailLink, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const observation = await observeSkinbaronDetail(page, row.name);
    return { ...observation, detailLink: page.url(), checkedAt };
  } catch (error) {
    return {
      status: "unavailable",
      reason: "skinbaron_verification_failed",
      checkedAt,
      diagnostic: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    };
  }
};

export const selectPreparationCandidate = (deals) => [...deals]
  .filter((deal) => isEligibleCs2Case(deal.name))
  .filter((deal) => Number(deal.skinbaronTradableCount) > 0)
  .filter((deal) => Number(deal.sitePercent) > DEAL_THRESHOLD_PERCENT)
  .sort((left, right) => (
    Number(right.sitePercent) - Number(left.sitePercent)
    || Number(left.skinbaronTradablePriceEur) - Number(right.skinbaronTradablePriceEur)
  ))[0] || null;

const readJsonFile = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
};

const activeCheckoutIsRecent = () => {
  const status = readJsonFile(SKINBARON_STATUS_PATH, {});
  const activeStates = new Set([
    "opening_browser",
    "awaiting_user_login",
    "verifying_offer",
    "waiting_for_site_interaction",
    "awaiting_user_confirmation",
  ]);
  const updatedAt = Date.parse(status.updatedAt || "");
  const maximumAge = SKINBARON_LOGIN_TIMEOUT_MS + SKINBARON_CONFIRMATION_TIMEOUT_MS + 60_000;
  return activeStates.has(status.state)
    && Number.isFinite(updatedAt)
    && Date.now() - updatedAt < maximumAge;
};

const queueAssistedCheckout = (deals) => {
  const deal = selectPreparationCandidate(deals);
  if (!deal) return { state: "no_eligible_case" };
  if (activeCheckoutIsRecent()) {
    return { state: "busy", name: deal.name };
  }

  writePrivateJson(SKINBARON_PENDING_PATH, {
    queuedAt: nowIso(),
    deal,
  });
  writeSkinbaronStatus({ state: "queued", name: deal.name });

  const child = spawn(process.execPath, [SCRIPT_PATH, "prepare-checkout"], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.once("error", (error) => {
    writeSkinbaronStatus({
      state: "launch_failed",
      name: deal.name,
      diagnostic: error.message.slice(0, 240),
    });
  });
  child.unref();
  return { state: "queued", name: deal.name, processId: child.pid };
};

const cartIndicatorCount = async (page) => page.evaluate(() => {
  const widget = document.querySelector("sb-shopping-cart-widget");
  if (!widget) return null;
  const candidates = [...widget.querySelectorAll("span, [class*='badge'], [class*='count']")];
  for (const candidate of candidates) {
    const text = String(candidate.textContent || "").trim();
    if (/^\d+$/.test(text)) return Number(text);
  }
  return 0;
});

const metaOfferIdFrom = (value) => {
  try {
    const parsed = Number(new URL(value).searchParams.get("metaOfferId"));
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const loadAssistedMarketData = async (page, metaOfferId) => page.evaluate(async (id) => {
  const readJson = async (url) => {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`${new URL(url, location.href).pathname}:${response.status}`);
    return response.json();
  };
  const [availability, summary, cart] = await Promise.all([
    readJson(`/api/v2/Browsing/StackableAvailabilityTable?metaOfferId=${encodeURIComponent(id)}`),
    readJson("/api/v2/Profile/Summary"),
    readJson("/api/v2/ShoppingCart"),
  ]);
  return {
    availabilityRows: Array.isArray(availability?.rows) ? availability.rows : null,
    accountBalanceEur: Number(summary?.accountBalance),
    cart: {
      itemCount: (Array.isArray(cart?.items) ? cart.items.length : 0)
        + (Array.isArray(cart?.physicalItems) ? cart.physicalItems.length : 0),
      itemTotal: Number(cart?.itemTotal),
      totalWithFees: Number(cart?.totalWithFees),
    },
  };
}, metaOfferId);

const loadCartVerification = async (page, expectedName) => page.evaluate(async (nameToMatch) => {
  const response = await fetch("/api/v2/ShoppingCart", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`shopping_cart:${response.status}`);
  const cart = await response.json();
  const items = [
    ...(Array.isArray(cart?.items) ? cart.items : []),
    ...(Array.isArray(cart?.physicalItems) ? cart.physicalItems : []),
  ];
  const normalizedExpected = String(nameToMatch || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const normalizedNames = items.map((item) => (
    String(item?.name || "").replace(/\s+/g, " ").trim().toLocaleLowerCase()
  ));
  return {
    rawItemCount: items.length,
    quantity: items.reduce((total, item) => (
      total + (item?.stackable ? Math.max(0, Math.floor(Number(item?.count))) : 1)
    ), 0),
    itemTotal: Number(cart?.itemTotal),
    totalWithFees: Number(cart?.totalWithFees),
    hasTradeLockedItem: items.some((item) => item?.tradeLocked === true),
    containsOnlyExpectedName: normalizedNames.length > 0
      && normalizedNames.every((name) => name === normalizedExpected),
  };
}, expectedName);

const cartContainsOnlyExpectedItem = async (page, expectedName) => page.evaluate((nameToMatch) => {
  const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const expected = clean(nameToMatch);
  const selectors = [
    "sb-shopping-cart",
    "[class*='shopping-cart']",
    "[class*='cart-content']",
    "[class*='cart-modal']",
    "[class*='cart-drawer']",
  ];
  const visibleContainers = [...document.querySelectorAll(selectors.join(","))].filter((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  });
  return visibleContainers.some((element) => clean(element.innerText).includes(expected));
}, expectedName);

const waitForNaturalClick = async (locator, onBlocked) => {
  const deadline = Date.now() + 2 * 60 * 1000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      await locator.click({ timeout: 3_000 });
      return;
    } catch (error) {
      lastError = error;
      await onBlocked(error);
      await delay(2_000);
    }
  }
  throw lastError || new Error("Le controle SkinBaron n'est pas accessible.");
};

const prepareAssistedCheckout = async () => {
  const pending = readJsonFile(SKINBARON_PENDING_PATH, null);
  const deal = pending?.deal;
  const queuedAt = Date.parse(pending?.queuedAt || "");
  if (!deal || !Number.isFinite(queuedAt) || Date.now() - queuedAt > 15 * 60 * 1000) {
    writeSkinbaronStatus({ state: "rejected", reason: "missing_or_stale_request" });
    return;
  }
  if (!readAssistedCheckoutConfig().enabled) {
    writeSkinbaronStatus({ state: "disabled", name: deal.name });
    return;
  }
  if (!isEligibleCs2Case(deal.name) || !isAllowedSkinbaronUrl(deal.verificationLink)) {
    writeSkinbaronStatus({ state: "rejected", name: deal.name, reason: "invalid_case_or_link" });
    return;
  }

  writeSkinbaronStatus({ state: "opening_browser", name: deal.name });
  const context = await launchContext({
    headless: false,
    profileDir: SKINBARON_PROFILE_DIR,
  });
  let finalState = "confirmation_window_expired";
  try {
    let page = activePage(context);
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}));
    await page.goto(deal.verificationLink, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    if (!await skinbaronSessionIsAuthenticated(page)) {
      writeSkinbaronStatus({
        state: "awaiting_user_login",
        name: deal.name,
        instruction: "Connecte-toi manuellement a SkinBaron dans cette fenetre.",
      });
      const authenticatedPage = await waitForSkinbaronAuthentication(
        context,
        Date.now() + SKINBARON_LOGIN_TIMEOUT_MS,
      );
      if (!authenticatedPage) {
        finalState = "login_incomplete";
        return;
      }
      page = authenticatedPage;
      await retainOnlySkinbaronCookies(context, page);
    }

    writeSkinbaronStatus({ state: "verifying_offer", name: deal.name });
    const response = await page.goto(deal.verificationLink, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    if (!response || response.status() >= 400) {
      finalState = `skinbaron_http_${response?.status() || "unknown"}`;
      return;
    }

    const observation = {
      ...await observeSkinbaronDetail(page, deal.name),
      detailLink: page.url(),
      checkedAt: nowIso(),
    };
    const assessment = assessSkinbaronVerification({
      ...deal,
      buyPrice: deal.tableBuyPrice,
      buyPriceEur: deal.tableBuyPriceEur,
      sitePercent: deal.tablePercent,
      buyLink: deal.verificationLink,
    }, observation);
    if (!assessment.accepted || !isEligibleCs2Case(assessment.deal.name)) {
      finalState = assessment.rejection?.verificationReason || "offer_no_longer_eligible";
      return;
    }
    if (!readAssistedCheckoutConfig().enabled) {
      finalState = "disabled_before_cart_change";
      return;
    }

    const metaOfferId = metaOfferIdFrom(deal.verificationLink);
    if (!metaOfferId) {
      finalState = "meta_offer_id_unavailable";
      return;
    }
    const marketData = await loadAssistedMarketData(page, metaOfferId);
    if (
      !Array.isArray(marketData.availabilityRows)
      || !Number.isFinite(marketData.accountBalanceEur)
      || marketData.accountBalanceEur < 0
    ) {
      finalState = "availability_or_balance_unavailable";
      return;
    }
    if (
      marketData.cart.itemCount !== 0
      || (Number.isFinite(marketData.cart.itemTotal) && marketData.cart.itemTotal > 0)
    ) {
      finalState = "existing_cart_not_empty";
      return;
    }

    const quantityPlan = calculateCaseQuantityPlan({
      availabilityRows: marketData.availabilityRows,
      tableBuyPrice: deal.tableBuyPrice,
      tableBuyPriceEur: deal.tableBuyPriceEur,
      referencePrice: deal.referencePrice,
      feePercent: deal.feePercent,
      balanceEur: marketData.accountBalanceEur,
      maxQuantity: MAX_ASSISTED_CASE_QUANTITY,
      thresholdPercent: DEAL_THRESHOLD_PERCENT,
    });
    if (!quantityPlan.accepted) {
      finalState = quantityPlan.reason;
      return;
    }

    const cartCountBefore = await cartIndicatorCount(page);
    if (cartCountBefore !== 0) {
      finalState = cartCountBefore === null ? "cart_state_unavailable" : "existing_cart_not_empty";
      return;
    }

    const quantityInput = page.locator(".stackable-tradable input.product-quantity");
    if (await quantityInput.count() !== 1) {
      finalState = "tradable_quantity_input_unavailable";
      return;
    }
    await quantityInput.fill(String(quantityPlan.quantity));
    await quantityInput.blur();
    if (Number(await quantityInput.inputValue()) !== quantityPlan.quantity) {
      finalState = "tradable_quantity_not_applied";
      return;
    }

    const tradableBuyButton = page.locator(".stackable-tradable button.btn-buy");
    if (await tradableBuyButton.count() !== 1) {
      finalState = "tradable_buy_button_unavailable";
      return;
    }
    await waitForNaturalClick(tradableBuyButton, async (error) => {
      writeSkinbaronStatus({
        state: "waiting_for_site_interaction",
        name: deal.name,
        instruction: "Une interaction du site (par exemple le consentement aux cookies) doit etre terminee manuellement.",
        diagnostic: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    });
    await delay(1_500);

    const cartButton = page.locator("#open-cart-button");
    if (await cartButton.count() !== 1) {
      finalState = "cart_button_unavailable";
      return;
    }
    await waitForNaturalClick(cartButton, async (error) => {
      writeSkinbaronStatus({
        state: "waiting_for_site_interaction",
        name: deal.name,
        instruction: "Termine l'interaction visible du site pour ouvrir le panier.",
        diagnostic: error instanceof Error ? error.message.slice(0, 180) : String(error).slice(0, 180),
      });
    });
    await delay(1_000);

    const cartVerification = await loadCartVerification(page, deal.name);
    const cartTotalMatches = Number.isFinite(cartVerification.itemTotal)
      && Math.abs(cartVerification.itemTotal - quantityPlan.totalCostEur) <= 0.02;
    const balanceCoversCart = !Number.isFinite(cartVerification.totalWithFees)
      || cartVerification.totalWithFees <= marketData.accountBalanceEur + 0.001;
    const cartIsValid = cartVerification.quantity === quantityPlan.quantity
      && cartVerification.containsOnlyExpectedName
      && !cartVerification.hasTradeLockedItem
      && cartTotalMatches
      && balanceCoversCart
      && await cartContainsOnlyExpectedItem(page, deal.name);
    if (!cartIsValid) {
      await page.bringToFront();
      writeSkinbaronStatus({
        state: "manual_cart_review_required",
        name: deal.name,
        plannedQuantity: quantityPlan.quantity,
        observedQuantity: cartVerification.quantity,
        plannedTotalEur: quantityPlan.totalCostEur,
        observedTotalEur: cartVerification.itemTotal,
        instruction: "Ne confirme aucun achat. Verifie puis vide le panier : son contenu ne correspond pas exactement au plan valide.",
      });
      finalState = await Promise.race([
        new Promise((resolveClosed) => context.once("close", () => resolveClosed("manual_review_window_closed"))),
        delay(SKINBARON_CONFIRMATION_TIMEOUT_MS).then(() => "manual_review_window_expired"),
      ]);
      return;
    }

    await page.bringToFront();
    writeSkinbaronStatus({
      state: "awaiting_user_confirmation",
      name: deal.name,
      quantity: quantityPlan.quantity,
      totalCostEur: quantityPlan.totalCostEur,
      maximumUnitPriceEur: quantityPlan.maximumUnitPriceEur,
      worstMarginPercent: quantityPlan.worstMarginPercent,
      estimatedRemainingBalanceEur: quantityPlan.estimatedRemainingBalanceEur,
      priceTiers: quantityPlan.tiers,
      detailLink: page.url(),
      instruction: "Verifie le recapitulatif puis effectue toi-meme l'unique clic final. Le script ne clique jamais sur le paiement.",
    });

    finalState = await Promise.race([
      new Promise((resolveClosed) => context.once("close", () => resolveClosed("window_closed_unverified"))),
      delay(SKINBARON_CONFIRMATION_TIMEOUT_MS).then(() => "confirmation_window_expired"),
    ]);
  } catch (error) {
    finalState = "preparation_failed";
    writeSkinbaronStatus({
      state: finalState,
      name: deal.name,
      diagnostic: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
    return;
  } finally {
    await context.close().catch(() => {});
    const current = readJsonFile(SKINBARON_STATUS_PATH, {});
    if (current.state !== "preparation_failed") {
      writeSkinbaronStatus({ state: finalState, name: deal.name });
    }
  }
};

const scan = async ({ dryRun }) => {
  const context = await launchContext({ headless: true });
  try {
    const page = activePage(context);
    const authenticated = await sessionStaysOnSkinsTable(page);
    if (!authenticated) {
      writeStatus({ state: "authentication_required" });
      printJson({ ok: false, code: "AUTH_REQUIRED", message: "Relance la commande login." });
      process.exitCode = 2;
      return;
    }

    try {
      await page.waitForFunction(
        () => document.querySelectorAll("tr.hover").length > 0,
        undefined,
        { timeout: 45_000 },
      );
    } catch {
      printJson({ ok: false, code: "NO_DATA", message: "La table authentifiée ne contient aucune ligne exploitable." });
      process.exitCode = 3;
      return;
    }
    await delay(3_000);

    const rows = await extractRows(page);
    const scannedAt = nowIso();
    const eligibleCaseRows = rows.filter((row) => isEligibleCs2Case(row.name));
    const tableCandidates = eligibleCaseRows.filter(
      (row) => row.sitePercent > DEAL_THRESHOLD_PERCENT,
    );
    const verificationPage = await context.newPage();
    const qualifyingDeals = [];
    const rejectedDeals = [];
    try {
      for (const row of tableCandidates) {
        const observation = await verifySkinbaronCandidate(verificationPage, row);
        const assessment = assessSkinbaronVerification(row, observation);
        if (assessment.accepted) {
          qualifyingDeals.push({ ...assessment.deal, detectedAt: scannedAt });
        } else {
          rejectedDeals.push(assessment.rejection);
        }
      }
    } finally {
      await verificationPage.close().catch(() => {});
    }

    const previousState = readMonitorState();
    const alerts = selectAlerts(qualifyingDeals, previousState.deals);
    const nextDeals = mergeDealHistory(previousState.deals, qualifyingDeals);
    if (!dryRun) {
      writeMonitorState({ scannedAt, deals: nextDeals });
      await persistSessionState(context);
      writeStatus({ state: "ready", verifiedAt: readStatus().verifiedAt || scannedAt, lastScanAt: scannedAt });
    }

    const assistedCheckout = !dryRun && readAssistedCheckoutConfig().enabled
      ? queueAssistedCheckout(alerts)
      : { state: dryRun ? "dry_run" : "disabled" };

    printJson({
      ok: true,
      dryRun,
      scannedAt,
      threshold: { operator: ">", percent: DEAL_THRESHOLD_PERCENT },
      platforms: { buy: "SKINBARON", reference: "STEAM ORDER" },
      totalRows: rows.length,
      eligibleCaseCount: eligibleCaseRows.length,
      excludedNonCaseCount: rows.length - eligibleCaseRows.length,
      tableCandidateCount: tableCandidates.length,
      qualifyingCount: qualifyingDeals.length,
      rejectedCount: rejectedDeals.length,
      rejectedDeals,
      alertCount: alerts.length,
      alerts,
      assistedCheckout,
    });
  } finally {
    await context.close().catch(() => {});
  }
};

const status = () => printJson({
  profileDir: PROFILE_DIR,
  skinbaronProfileDir: SKINBARON_PROFILE_DIR,
  assistedCheckout: readAssistedCheckoutConfig(),
  skinbaronCheckout: readJsonFile(SKINBARON_STATUS_PATH, { state: "not_configured" }),
  ...readStatus(),
});

const main = async () => {
  const command = process.argv[2] || "status";
  if (command === "login") return login();
  if (command === "export-session") return exportSession();
  if (command === "skinbaron-login") return loginSkinbaron();
  if (command === "inspect") return inspect();
  if (command === "scan") return scan({ dryRun: process.argv.includes("--dry-run") });
  if (command === "enable-assisted-checkout") {
    writeAssistedCheckoutConfig(true);
    return status();
  }
  if (command === "disable-assisted-checkout") {
    writeAssistedCheckoutConfig(false);
    return status();
  }
  if (command === "prepare-checkout") return prepareAssistedCheckout();
  if (command === "status") return status();
  throw new Error(
    `Commande inconnue : ${command}. Utilise login, export-session, skinbaron-login, inspect, scan, enable-assisted-checkout, disable-assisted-checkout ou status.`,
  );
};

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  main().catch((error) => {
    writeStatus({ state: "error", message: error instanceof Error ? error.message : String(error) });
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
