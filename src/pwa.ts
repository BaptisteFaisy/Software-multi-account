const IOS_INSTALL_HINT_DISMISSED = "codex-switch-terminal.ios-install-hint-dismissed";
const SERVICE_WORKER_URL = `/service-worker.js?build=${encodeURIComponent(__CST_BUILD_ID__)}`;

type NativeBridgeWindow = Window & {
  CstAndroid?: unknown;
  CstIOS?: unknown;
};

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

const isAppleTouchDevice = () => {
  const userAgent = navigator.userAgent;
  return /iPad|iPhone|iPod/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
};

const isInstalledWebApp = () =>
  (navigator as StandaloneNavigator).standalone === true
  || window.matchMedia("(display-mode: standalone)").matches;

const hasNativeMobileBridge = () => {
  const nativeWindow = window as NativeBridgeWindow;
  return Boolean(nativeWindow.CstIOS || nativeWindow.CstAndroid)
    || /CodexTerminaliOS/i.test(navigator.userAgent);
};

const wasInstallHintDismissed = () => {
  try {
    return localStorage.getItem(IOS_INSTALL_HINT_DISMISSED) === "1";
  } catch {
    return false;
  }
};

const dismissInstallHint = (hint: HTMLElement) => {
  hint.remove();
  try {
    localStorage.setItem(IOS_INSTALL_HINT_DISMISSED, "1");
  } catch {
    // Le mode prive peut refuser localStorage ; fermer la bannière suffit.
  }
};

const showIosInstallHint = () => {
  if (
    !isAppleTouchDevice()
    || isInstalledWebApp()
    || hasNativeMobileBridge()
    || wasInstallHintDismissed()
    || document.querySelector(".ios-install-hint")
  ) {
    return;
  }

  const hint = document.createElement("aside");
  hint.className = "ios-install-hint";
  hint.setAttribute("role", "dialog");
  hint.setAttribute("aria-label", "Installer Codex Terminal sur cet iPad");
  hint.innerHTML = `
    <div>
      <strong>Installer Codex Terminal</strong>
      <p>Dans Safari, touche <b>Partager</b>, puis <b>Sur l'ecran d'accueil</b> et active <b>Ouvrir comme app web</b>.</p>
    </div>
    <button type="button" aria-label="Fermer le conseil d'installation">&times;</button>
  `;
  hint.querySelector("button")?.addEventListener("click", () => dismissInstallHint(hint));
  document.body.appendChild(hint);
};

const registerServiceWorker = () => {
  const isWebOrigin = window.location.protocol === "https:" || window.location.protocol === "http:";
  if (
    !("serviceWorker" in navigator)
    || !isWebOrigin
    || !window.isSecureContext
    || hasNativeMobileBridge()
  ) {
    return;
  }
  void navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/",
    updateViaCache: "none",
  })
    .then((registration) => {
      // Force une verification du script a chaque chargement : un nouveau build
      // (ou une nouvelle version du worker) est ainsi detecte et installe sans
      // attendre le throttle de 24 h du navigateur. Le worker se charge ensuite
      // de purger l'index perime et de recharger l'onglet.
      void registration.update().catch(() => undefined);
    })
    .catch(() => {
      // Le serveur reste utilisable si Safari refuse le service worker.
    });
};

const scheduleServiceWorkerRegistration = () => {
  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };
  if (idleWindow.requestIdleCallback) {
    idleWindow.requestIdleCallback(registerServiceWorker, { timeout: 4_000 });
  } else {
    window.setTimeout(registerServiceWorker, 1_000);
  }
};

export const initPwaSupport = () => {
  showIosInstallHint();
  if (document.readyState === "complete") {
    scheduleServiceWorkerRegistration();
  } else {
    window.addEventListener("load", scheduleServiceWorkerRegistration, { once: true });
  }
};
