const CACHE_PREFIX = "codex-terminal-static-";
const BUILD_ID = new URL(self.location.href).searchParams.get("build") || "legacy";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const NAVIGATION_NETWORK_TIMEOUT_MS = 5_000;
const PRECACHE_URLS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/apple-touch-icon.png",
  "/icons/pwa-192.png",
  "/icons/pwa-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const isPrivateApplicationRequest = (url) =>
  url.pathname.startsWith("/api/")
  || url.pathname.startsWith("/ws/")
  || url.pathname === "/mcp";

const cachedStaticAsset = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
};

const networkFirstNavigation = async (request) => {
  const cache = await caches.open(CACHE_NAME);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAVIGATION_NETWORK_TIMEOUT_MS);

  try {
    const response = await fetch(request, { signal: controller.signal });
    if (response.ok) await cache.put("/", response.clone()).catch(() => undefined);
    return response;
  } catch {
    return (await cache.match("/")) ?? (await caches.match("/offline.html"));
  } finally {
    clearTimeout(timeout);
  }
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isPrivateApplicationRequest(url)) return;
  // Cette page est la porte de sortie d'un cache PWA obsolète. Si le service
  // worker la remplace par la navigation mise en cache, elle ne peut jamais
  // désinscrire l'ancien worker ni purger les caches.
  if (url.pathname === "/reset-update.html") return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (
    url.pathname.startsWith("/assets/")
    || url.pathname.startsWith("/icons/")
    || url.pathname === "/apple-touch-icon.png"
    || url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cachedStaticAsset(request));
  }
});
