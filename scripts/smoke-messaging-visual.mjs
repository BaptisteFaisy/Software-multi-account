import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const baseUrl = process.env.CST_MESSAGING_SMOKE_URL?.replace(/\/+$/, "");
const sessionCookie = process.env.CST_MESSAGING_SMOKE_COOKIE;
const desktopProof = process.env.CST_MESSAGING_DESKTOP_PROOF;
const mobileProof = process.env.CST_MESSAGING_MOBILE_PROOF;
const uploadFixture = fileURLToPath(new URL("../public/icons/pwa-512.png", import.meta.url));

if (!baseUrl || !sessionCookie || !desktopProof || !mobileProof) {
  throw new Error(
    "CST_MESSAGING_SMOKE_URL, CST_MESSAGING_SMOKE_COOKIE et les deux chemins de preuve sont requis.",
  );
}

const executablePath = [
  process.env.CST_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
].filter(Boolean).find(existsSync);

if (!executablePath) throw new Error("Chrome ou Chromium est introuvable.");

const browser = await chromium.launch({ executablePath, headless: true });

const openMessaging = async ({
  viewport,
  mobile,
  proofPath,
  uploadImage,
  expectedMessages,
  expectedImages,
}) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.addCookies([{
    name: "cst_session",
    value: sessionCookie,
    url: baseUrl,
  }]);
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

  const navigation = mobile
    ? page.locator('.m-tab[data-view="messaging"]')
    : page.locator("#messagingToggle");
  await navigation.waitFor({ state: "visible" });
  await navigation.click();
  await page.locator("#messagingPanel").waitFor({ state: "visible" });
  await page.locator(".messaging-conversation-row").first().waitFor({ state: "visible" });

  if (mobile) await page.locator(".messaging-conversation-row").first().click();
  const form = page.locator("#privateMessageForm");
  await form.waitFor({ state: "visible" });
  if (uploadImage) {
    const textarea = form.locator("#privateMessageBody");
    if (await textarea.inputValue()) throw new Error("Le test d'image seule exige un brouillon vide.");
    await form.locator("#privateMessageImages").setInputFiles(uploadFixture);
    await form.locator(".messaging-draft-images img").waitFor({ state: "visible" });
    await form.evaluate((element) => element.requestSubmit());
    await page.waitForFunction(
      (count) => document.querySelectorAll(".messaging-message").length === count,
      expectedMessages,
    );
    const lastOwnMessage = page.locator(".messaging-message.mine").last();
    if (await lastOwnMessage.locator(".messaging-message-bubble > p").count()) {
      throw new Error("Le message envoye depuis le selecteur devait contenir uniquement une image.");
    }
  }

  await page.waitForFunction(
    (count) => document.querySelectorAll(".messaging-message-image").length === count,
    expectedImages,
  );
  const messageImage = page.locator(".messaging-message-image img").last();
  await messageImage.waitFor({ state: "visible" });
  await messageImage.evaluate((image) => new Promise((resolve, reject) => {
    if (image.complete && image.naturalWidth > 0) {
      resolve(true);
      return;
    }
    image.addEventListener("load", () => resolve(true), { once: true });
    image.addEventListener("error", () => reject(new Error("L'image privee ne peut pas etre decodee.")), { once: true });
  }));

  const title = (await page.locator("#messagingPanelTitle").textContent())?.trim();
  const messages = await page.locator(".messaging-message").count();
  const images = await page.locator(".messaging-message-image").count();
  const envelopeVisible = await navigation.locator("svg").isVisible();
  const attachmentIconVisible = await page.locator(".messaging-attach-image svg").isVisible();
  const noHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );

  if (title !== "Messagerie") throw new Error(`Titre inattendu : ${title}`);
  if (messages !== expectedMessages) throw new Error(`Nombre de messages visible inattendu : ${messages}`);
  if (images !== expectedImages) throw new Error(`Nombre d'images visible inattendu : ${images}`);
  if (!envelopeVisible) throw new Error("L'icone enveloppe n'est pas visible.");
  if (!attachmentIconVisible) throw new Error("L'icone d'ajout d'image n'est pas visible.");
  if (!noHorizontalOverflow) throw new Error("Un debordement horizontal est visible.");

  await messageImage.click();
  await page.locator(".messaging-image-viewer img").waitFor({ state: "visible" });
  await page.locator("[data-messaging-close-image]").click();
  await messageImage.scrollIntoViewIfNeeded();

  await page.screenshot({ path: proofPath, fullPage: true });
  await context.close();
  return { viewport, title, messages, images, envelopeVisible, attachmentIconVisible, noHorizontalOverflow };
};

try {
  const desktop = await openMessaging({
    viewport: { width: 1_440, height: 900 },
    mobile: false,
    proofPath: desktopProof,
    uploadImage: true,
    expectedMessages: 3,
    expectedImages: 2,
  });
  const mobile = await openMessaging({
    viewport: { width: 390, height: 844 },
    mobile: true,
    proofPath: mobileProof,
    uploadImage: false,
    expectedMessages: 3,
    expectedImages: 2,
  });
  process.stdout.write(`${JSON.stringify({ desktop, mobile }, null, 2)}\n`);
} finally {
  await browser.close();
}
