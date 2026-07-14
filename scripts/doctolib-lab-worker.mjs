import { existsSync } from "node:fs";
import process from "node:process";
import { chromium } from "playwright-core";

const DOCTOLIB_ORIGIN = "https://www.doctolib.fr";
const GOOGLE_CALENDAR_ORIGIN = "https://calendar.google.com";
const GOOGLE_CALENDAR_HOME = `${GOOGLE_CALENDAR_ORIGIN}/calendar/u/0/r`;
const DEFAULT_TIMEOUT_MS = 60_000;
const USER_ACTION_TIMEOUT_MS = 10 * 60_000;

const readInput = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) throw new Error("Requête worker vide");
  return JSON.parse(raw);
};

const emit = (value) => {
  process.stdout.write(`${JSON.stringify(value)}\n`);
};

const chromeCandidates = () => [
  process.env.CST_CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  `${process.env.LOCALAPPDATA || ""}/Google/Chrome/Application/chrome.exe`,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const findChrome = () => chromeCandidates().find((candidate) => existsSync(candidate)) || null;

const slugify = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const specialtySlug = (specialty) => {
  const normalized = slugify(specialty);
  if (normalized === "medecin-generaliste" || normalized === "generaliste") {
    return "medecin-generaliste";
  }
  throw new Error("Ce premier prototype réel prend uniquement en charge les médecins généralistes.");
};

const sectorLabel = (sector) => {
  if (sector === "contracted_1") return "Secteur 1";
  if (sector === "contracted_2") return "Secteur 2";
  if (sector === "non_contracted") return "Non conventionné";
  return "Secteur non précisé";
};

const launchContext = async ({ profileDir, headless }) => {
  const executablePath = findChrome();
  if (!executablePath) throw new Error("Google Chrome ou Chromium est introuvable.");
  return chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    viewport: headless ? { width: 1440, height: 1000 } : null,
  });
};

const firstPage = async (context) => context.pages()[0] || context.newPage();

const availabilityFor = async (page, provider, startDateTime = new Date().toISOString()) => {
  const motive = provider.matchedVisitMotive;
  const params = new URLSearchParams({
    telehealth: "false",
    limit: "5",
    start_date_time: startDateTime,
    visit_motive_id: String(motive.visitMotiveId),
    agenda_ids: motive.agendaIds.join(","),
    practice_ids: String(provider.references.practiceId),
  });
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: "include" });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(Array.isArray(body?.error) ? body.error.join(", ") : `HTTP ${response.status}`);
    }
    return body;
  }, `/search/availabilities.json?${params.toString()}`);
};

const normalizedSlots = (availability) =>
  (availability?.availabilities || [])
    .flatMap((day) => day?.slots || [])
    .map((slot) => (typeof slot === "string" ? slot : slot?.start_date || slot?.startDate))
    .filter(Boolean);

const search = async (request) => {
  const context = await launchContext({ profileDir: request.profileDir, headless: true });
  try {
    const page = await firstPage(context);
    const searchUrl = `${DOCTOLIB_ORIGIN}/${specialtySlug(request.specialty)}/${slugify(request.location)}`;
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/patient-health-search/api/v1/hcp/search"),
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    const response = await responsePromise;
    const payload = await response.json();
    const candidates = (payload.healthcareProviders || [])
      .filter((provider) => provider?.matchedVisitMotive?.allowNewPatients === true)
      .filter((provider) => provider?.services?.includes("onlineBooking"))
      .slice(0, 10);

    const providers = [];
    for (const provider of candidates) {
      let availability;
      try {
        availability = await availabilityFor(page, provider);
        let slots = normalizedSlots(availability);
        if (!slots.length && availability?.next_slot) {
          const next = new Date(availability.next_slot);
          const withinThirtyDays = Number.isFinite(next.getTime()) &&
            next.getTime() - Date.now() <= 30 * 24 * 60 * 60 * 1000;
          if (withinThirtyDays) {
            availability = await availabilityFor(page, provider, availability.next_slot);
            slots = normalizedSlots(availability);
          }
        }
        if (!slots.length) continue;
        providers.push({
          practitionerName: [provider.title, provider.firstName, provider.name].filter(Boolean).join(" "),
          specialty: provider.speciality?.name || request.specialty,
          address: [provider.location?.address, provider.location?.zipcode, provider.location?.city]
            .filter(Boolean)
            .join(", "),
          sector: sectorLabel(provider.regulationSector),
          visitMotive: provider.matchedVisitMotive?.name || "Consultation",
          acceptsNewPatients: true,
          sourceUrl: new URL(provider.link, DOCTOLIB_ORIGIN).toString(),
          searchUrl,
          slots: slots.slice(0, 3),
        });
        if (providers.length >= 6) break;
      } catch (error) {
        process.stderr.write(`Disponibilités ignorées pour ${provider?.firstName || "un médecin"}: ${String(error)}\n`);
      }
    }

    return {
      providers,
      searchUrl,
      note: providers.length
        ? "Créneaux publics lus dans Doctolib pour de nouveaux patients. Ils peuvent disparaître à tout moment."
        : "Aucun créneau pour nouveau patient n'a été trouvé dans les premiers résultats Doctolib.",
    };
  } finally {
    await context.close().catch(() => {});
  }
};

const loginRequired = async (page) => {
  const url = page.url().toLowerCase();
  if (/sessions|sign[_-]?in|connexion|login/.test(url)) return true;
  const loginButtons = page.getByRole("button", { name: /^se connecter$/i });
  return (await loginButtons.count()) > 0 && await loginButtons.first().isVisible().catch(() => false);
};

const connect = async (request) => {
  const context = await launchContext({ profileDir: request.profileDir, headless: false });
  try {
    let page = await firstPage(context);
    await page.goto(`${DOCTOLIB_ORIGIN}/appointments`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    if (!(await loginRequired(page))) {
      return { connected: true, message: "La session Doctolib est déjà connectée." };
    }

    const deadline = Date.now() + USER_ACTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const pages = context.pages();
      if (!pages.length) break;
      page = pages.at(-1);
      if (!(await loginRequired(page)) && /doctolib\.fr/.test(page.url())) {
        await page.goto(`${DOCTOLIB_ORIGIN}/appointments`, {
          waitUntil: "domcontentloaded",
          timeout: DEFAULT_TIMEOUT_MS,
        }).catch(() => {});
        if (!(await loginRequired(page))) {
          return { connected: true, message: "Connexion Doctolib enregistrée dans le profil RDV Lab." };
        }
      }
    }
    return {
      connected: false,
      message: "Connexion non détectée. Relancez la connexion et terminez-la dans Chrome.",
    };
  } finally {
    await context.close().catch(() => {});
  }
};

const sessionStatus = async (request) => {
  const context = await launchContext({ profileDir: request.profileDir, headless: true });
  try {
    const page = await firstPage(context);
    await page.goto(`${DOCTOLIB_ORIGIN}/appointments`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    const connected = !(await loginRequired(page));
    return {
      connected,
      message: connected
        ? "Le profil persistant est connecté à un compte Doctolib réel."
        : "Le profil persistant doit être connecté au compte Doctolib réel.",
    };
  } finally {
    await context.close().catch(() => {});
  }
};

const googleCalendarConnected = async (page) => {
  const currentUrl = new URL(page.url());
  if (currentUrl.hostname === "accounts.google.com") return false;
  if (currentUrl.hostname !== "calendar.google.com") return false;
  if (/\/calendar\/(?:about|signup)/i.test(currentUrl.pathname)) return false;
  const signIn = page.getByRole("link", { name: /(?:se connecter|sign in)/i });
  return !((await signIn.count()) > 0 && await signIn.first().isVisible().catch(() => false));
};

const calendarSessionStatus = async (request) => {
  const context = await launchContext({ profileDir: request.profileDir, headless: true });
  try {
    const page = await firstPage(context);
    await page.goto(GOOGLE_CALENDAR_HOME, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.waitForTimeout(1_000);
    const connected = await googleCalendarConnected(page);
    return {
      connected,
      message: connected
        ? "Le profil Google Calendar est connecté et prêt à enregistrer un événement."
        : "Connectez le profil Google Calendar avant de confirmer un rendez-vous.",
    };
  } finally {
    await context.close().catch(() => {});
  }
};

const calendarConnect = async (request) => {
  const context = await launchContext({ profileDir: request.profileDir, headless: false });
  try {
    let page = await firstPage(context);
    await page.goto(GOOGLE_CALENDAR_HOME, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    if (await googleCalendarConnected(page)) {
      return { connected: true, message: "La session Google Calendar est déjà connectée." };
    }

    const deadline = Date.now() + USER_ACTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      const pages = context.pages();
      if (!pages.length) break;
      page = pages.at(-1);
      if (await googleCalendarConnected(page)) {
        return {
          connected: true,
          message: "Connexion Google Calendar enregistrée dans le profil RDV Lab.",
        };
      }
    }
    return {
      connected: false,
      message: "Connexion Google Calendar non détectée. Relancez-la et terminez les étapes dans Chrome.",
    };
  } finally {
    await context.close().catch(() => {});
  }
};

const googleCalendarDate = (date) => date.toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d{3}Z$/, "Z");

const calendarTemplateUrl = (request) => {
  const summary = String(request.summary || "").trim();
  const startsAt = new Date(request.startsAt);
  const durationMinutes = Number(request.durationMinutes || 30);
  if (!summary) throw new Error("Le titre de l'événement Google Calendar est requis.");
  if (!Number.isFinite(startsAt.getTime())) throw new Error("La date du rendez-vous est invalide.");
  if (startsAt.getTime() <= Date.now()) throw new Error("Le rendez-vous doit être dans le futur.");
  if (!Number.isFinite(durationMinutes) || durationMinutes < 5 || durationMinutes > 24 * 60) {
    throw new Error("La durée de l'événement Google Calendar est invalide.");
  }
  const endsAt = new Date(startsAt.getTime() + durationMinutes * 60_000);
  const url = new URL("/calendar/render", GOOGLE_CALENDAR_ORIGIN);
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("text", summary);
  url.searchParams.set("dates", `${googleCalendarDate(startsAt)}/${googleCalendarDate(endsAt)}`);
  url.searchParams.set("ctz", "Europe/Paris");
  if (request.location) url.searchParams.set("location", String(request.location));
  if (request.description) url.searchParams.set("details", String(request.description));
  return url.toString();
};

const calendarAdd = async (request) => {
  const eventTemplateUrl = calendarTemplateUrl(request);
  const context = await launchContext({ profileDir: request.profileDir, headless: false });
  try {
    const page = await firstPage(context);
    await page.goto(eventTemplateUrl, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    await page.waitForTimeout(1_000);
    if (!(await googleCalendarConnected(page))) {
      return {
        status: "needs_user",
        added: false,
        message: "La session Google Calendar n'est plus connectée. Reconnectez-la avant de réessayer.",
        eventUrl: null,
      };
    }

    const save = page.getByRole("button", { name: /^(?:enregistrer|save)$/i });
    await save.first().waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });
    if (!(await visibleEnabled(save))) {
      return {
        status: "failed",
        added: false,
        message: "Le bouton d'enregistrement Google Calendar n'est pas disponible.",
        eventUrl: null,
      };
    }
    await save.first().click();

    const savedNotice = page.getByText(
      /(?:événement|evenement) (?:enregistré|enregistre)|event saved|event has been saved/i,
    );
    const verified = await savedNotice.first()
      .waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!verified) {
      return {
        status: "failed",
        added: false,
        message: "Google Calendar n'a pas affiché de confirmation vérifiable après l'enregistrement.",
        eventUrl: null,
      };
    }
    return {
      status: "added",
      added: true,
      message: "Le rendez-vous a été ajouté et vérifié dans Google Calendar.",
      eventUrl: GOOGLE_CALENDAR_HOME,
    };
  } finally {
    await context.close().catch(() => {});
  }
};

const normalizeText = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[.\s]+/g, " ")
  .trim()
  .toLowerCase();

const targetDateParts = (iso) => {
  const date = new Date(iso);
  const dateLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  return { dateLabel: normalizeText(dateLabel), timeLabel };
};

const findExactSlot = async (container, startsAt) => {
  const target = targetDateParts(startsAt);
  const buttons = container.locator('[data-test-id="slot-button"]');
  for (let index = 0; index < await buttons.count(); index += 1) {
    const button = buttons.nth(index);
    const details = await button.evaluate((element) => {
      const ids = (element.getAttribute("aria-labelledby") || "").split(/\s+/).filter(Boolean);
      return {
        time: (element.textContent || "").trim(),
        labels: ids.map((id) => document.getElementById(id)?.textContent || "").join(" "),
      };
    });
    if (details.time === target.timeLabel && normalizeText(details.labels).includes(target.dateLabel)) {
      return button;
    }
  }
  return null;
};

const visibleEnabled = async (locator) =>
  (await locator.count()) > 0 &&
  await locator.first().isVisible().catch(() => false) &&
  await locator.first().isEnabled().catch(() => false);

const verificationCodeFrom = (page, body) => {
  const reference = body.match(/(?:référence|reference|n°|numéro)\s*[:#]?\s*([A-Z0-9-]{5,})/i)?.[1];
  if (reference) return reference;
  const pathPart = new URL(page.url()).pathname.split("/").filter(Boolean).at(-1);
  return pathPart && /\d/.test(pathPart) ? pathPart : null;
};

const waitForConfirmation = async (context, request) => {
  const deadline = Date.now() + USER_ACTION_TIMEOUT_MS;
  let finalConfirmationClicked = false;
  const target = targetDateParts(request.startsAt);
  const practitioner = normalizeText(request.practitionerName);
  while (Date.now() < deadline) {
    const pages = context.pages();
    if (!pages.length) {
      return { status: "failed", verified: false, message: "La fenêtre Chrome a été fermée avant la confirmation.", verificationCode: null, sourceUrl: request.sourceUrl };
    }
    const page = pages.at(-1);
    const body = await page.locator("body").innerText().catch(() => "");
    const normalizedBody = normalizeText(body);
    const confirmedText = /rendez-vous (?:est )?confirme|confirmation de votre rendez-vous|rendez-vous a bien ete/.test(normalizedBody);
    const appointmentUrl = /\/appointments?\//.test(page.url()) && !/sessions/.test(page.url());
    const exactAppointmentVisible = appointmentUrl &&
      normalizedBody.includes(practitioner) &&
      normalizedBody.includes(target.dateLabel) &&
      normalizedBody.includes(target.timeLabel);
    if (finalConfirmationClicked && (confirmedText || exactAppointmentVisible)) {
      return {
        status: "confirmed",
        verified: true,
        message: "Doctolib affiche le rendez-vous comme confirmé.",
        verificationCode: verificationCodeFrom(page, body),
        sourceUrl: page.url(),
      };
    }

    const finalButton = page.getByRole("button", {
      name: /confirmer(?: définitivement)?(?: le)? rendez-vous|confirmer ma réservation|prendre ce rendez-vous/i,
    });
    if (await visibleEnabled(finalButton)) {
      await finalButton.first().click();
      finalConfirmationClicked = true;
      await page.waitForTimeout(1_500);
      continue;
    }

    // Les écrans purement récapitulatifs peuvent avancer seuls. Dès qu'un choix
    // patient/médical est visible, le navigateur reste ouvert pour que la
    // personne réponde elle-même ; le worker reprend ensuite automatiquement.
    const unansweredControls = page.locator(
      'input[type="radio"]:not(:checked), input[type="checkbox"][required]:not(:checked), select[required]',
    );
    const continueButton = page.getByRole("button", { name: /^(continuer|suivant|valider)$/i });
    if ((await unansweredControls.count()) === 0 && await visibleEnabled(continueButton)) {
      await continueButton.first().click();
      await page.waitForTimeout(1_000);
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  return {
    status: "needs_user",
    verified: false,
    message: "Le délai a expiré avant que Doctolib affiche une confirmation vérifiable.",
    verificationCode: null,
    sourceUrl: request.sourceUrl,
  };
};

const confirm = async (request) => {
  const context = await launchContext({ profileDir: request.profileDir, headless: false });
  try {
    const page = await firstPage(context);
    await page.goto(`${DOCTOLIB_ORIGIN}/appointments`, {
      waitUntil: "domcontentloaded",
      timeout: DEFAULT_TIMEOUT_MS,
    });
    if (await loginRequired(page)) {
      return {
        status: "needs_user",
        verified: false,
        message: "Connectez d'abord le profil Doctolib avec le bouton « Connecter Doctolib », puis relancez la recherche.",
        verificationCode: null,
        sourceUrl: request.sourceUrl,
      };
    }

    await page.goto(request.searchUrl, { waitUntil: "domcontentloaded", timeout: DEFAULT_TIMEOUT_MS });
    const path = new URL(request.sourceUrl).pathname;
    const practitionerLink = page.locator(`a[href^="${path}"]`).first();
    await practitionerLink.waitFor({ state: "attached", timeout: DEFAULT_TIMEOUT_MS });
    await practitionerLink.scrollIntoViewIfNeeded();
    const card = practitionerLink.locator('xpath=ancestor::div[contains(@class,"flex flex-row")][1]');
    const availability = card.locator('[data-test-id="availabilities-container"]');
    await availability.waitFor({ state: "visible", timeout: DEFAULT_TIMEOUT_MS });

    let slot = null;
    for (let pageIndex = 0; pageIndex < 7 && !slot; pageIndex += 1) {
      await availability.locator('[data-test-id="slot-button"]').first()
        .waitFor({ state: "attached", timeout: 12_000 })
        .catch(() => {});
      slot = await findExactSlot(availability, request.startsAt);
      if (slot) break;
      const next = availability.getByRole("button", { name: /prochaines disponibilités/i });
      if (!(await visibleEnabled(next))) break;
      await next.first().click();
      await page.waitForTimeout(1_200);
    }
    if (!slot) {
      return {
        status: "failed",
        verified: false,
        message: "Le créneau n'est plus disponible. Relancez la recherche pour obtenir une proposition à jour.",
        verificationCode: null,
        sourceUrl: request.sourceUrl,
      };
    }

    await slot.click();
    await page.waitForTimeout(1_200);
    return await waitForConfirmation(context, request);
  } finally {
    await context.close().catch(() => {});
  }
};

const main = async () => {
  const request = await readInput();
  if (request.action === "probe") {
    const chromePath = findChrome();
    emit({ ready: Boolean(chromePath), chromePath });
    return;
  }
  if (!request.profileDir) throw new Error("profileDir est requis");
  if (request.action === "search") {
    emit(await search(request));
    return;
  }
  if (request.action === "connect") {
    emit(await connect(request));
    return;
  }
  if (request.action === "session") {
    emit(await sessionStatus(request));
    return;
  }
  if (request.action === "calendar_session") {
    emit(await calendarSessionStatus(request));
    return;
  }
  if (request.action === "calendar_connect") {
    emit(await calendarConnect(request));
    return;
  }
  if (request.action === "calendar_add") {
    emit(await calendarAdd(request));
    return;
  }
  if (request.action === "confirm") {
    emit(await confirm(request));
    return;
  }
  throw new Error(`Action worker inconnue : ${request.action}`);
};

main().catch((error) => {
  process.stderr.write(`${error?.stack || String(error)}\n`);
  process.exitCode = 1;
});
