import "./tutorial.css";

export type TutorialDestination = "tutorial" | "chat" | "terminal" | "settings";

export type TutorialStep = {
  id: string;
  icon: string;
  view: TutorialDestination;
  eyebrow: string;
  title: string;
  description: string;
  tip: string;
  selectors: string[];
};

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: "welcome",
    icon: "sparkles",
    view: "chat",
    eyebrow: "Bienvenue",
    title: "Ton point de départ",
    description:
      "Switch rassemble tes conversations et tes outils dans une seule interface. Le logo te ramène toujours à la mosaïque des chats.",
    tip: "Le parcours ne crée rien et ne lance aucune commande : tu peux avancer sans risque.",
    selectors: [".chat-brand-button", ".m-title", "#chatMainWorkspace"],
  },
  {
    id: "environment",
    icon: "folders",
    view: "chat",
    eyebrow: "Étape 1",
    title: "Choisis ton environnement",
    description:
      "Un environnement correspond à un projet ou un dossier. Ses chats, ses terminaux et sa mémoire restent regroupés au même endroit.",
    tip: "Le raccourci ` ouvre aussi rapidement le sélecteur d’environnement.",
    selectors: ["#chatWsSwitcher", "[data-m='drawer']", "#chatMainWorkspace"],
  },
  {
    id: "chats",
    icon: "messages-square",
    view: "chat",
    eyebrow: "Étape 2",
    title: "Travaille avec plusieurs chats",
    description:
      "La mosaïque permet de suivre plusieurs conversations en parallèle. Ouvre un chat, décris ton objectif puis suis son état directement dans sa carte.",
    tip: "Vert signifie disponible, orange en cours, et rouge qu’une réponse de ta part est attendue.",
    selectors: ["#addExpertChat", ".expert-chat-wall", "[data-view='chat']", "#chatMainWorkspace"],
  },
  {
    id: "terminal",
    icon: "square-terminal",
    view: "terminal",
    eyebrow: "Étape 3",
    title: "Garde le terminal à portée de main",
    description:
      "Le terminal intégré travaille dans le même environnement que tes chats. Tu peux y lancer tes commandes et surveiller plusieurs sessions.",
    tip: "Changer d’environnement sépare proprement les terminaux et évite de mélanger les projets.",
    selectors: [".expert-terminal-shell", ".terminal-environment-empty", ".chat-admin-panel", "[data-view='terminal']"],
  },
  {
    id: "activity",
    icon: "panel-right-open",
    view: "chat",
    eyebrow: "Étape 4",
    title: "Retrouve l’activité du projet",
    description:
      "Le centre d’activité donne un accès direct aux messages, aux tâches, aux chats planifiés, aux prompts et à l’historique.",
    tip: "Sur mobile, ces outils sont rassemblés dans le bouton Menu de la barre inférieure.",
    selectors: ["#chatContextSidebar", "[data-m='menu']", "#chatMainWorkspace"],
  },
  {
    id: "agents",
    icon: "bot",
    view: "chat",
    eyebrow: "Étape 5",
    title: "Délègue les travaux longs",
    description:
      "Les agents autonomes poursuivent un objectif en arrière-plan. Les chats orchestrés répartissent, eux, un même objectif entre plusieurs spécialistes.",
    tip: "Tu gardes la main grâce aux comptes rendus, aux preuves et aux étapes de validation.",
    selectors: ["#autonomousToggle", "[data-view='autonomous']", "[data-m='menu']", "#chatMainWorkspace"],
  },
  {
    id: "tools",
    icon: "layout-grid",
    view: "chat",
    eyebrow: "Étape 6",
    title: "Explore les outils spécialisés",
    description:
      "Le menu Plus d’outils réunit le Studio IA, les statistiques, les limites, les skills, l’audit et le signalement automatique de bugs.",
    tip: "Chaque outil conserve son propre état : tu peux revenir aux chats sans perdre ton travail.",
    selectors: ["#chatSideMoreToggle", "[data-m='menu']", "#chatContextSidebar", "#chatMainWorkspace"],
  },
  {
    id: "settings",
    icon: "settings",
    view: "settings",
    eyebrow: "Étape 7",
    title: "Adapte Switch à ta façon de travailler",
    description:
      "Les paramètres regroupent l’apparence, les raccourcis, les notifications, les comptes et les préférences d’affichage.",
    tip: "Les réglages d’interface sont conservés sur cet appareil.",
    selectors: [".settings-panel", "#settingsToggle", "[data-view='settings']", ".chat-admin-panel"],
  },
  {
    id: "finish",
    icon: "flag",
    view: "tutorial",
    eyebrow: "Terminé",
    title: "Tu connais l’essentiel",
    description:
      "Tu peux maintenant choisir un environnement, ouvrir des chats, utiliser le terminal et retrouver les outils adaptés à chaque besoin.",
    tip: "Ce tutoriel reste disponible à tout moment dans l’onglet Tuto.",
    selectors: [".tutorial-hero", ".tutorial-panel", "#chatMainWorkspace"],
  },
] as const;

type TutorialProgress = {
  version: 1;
  currentStep: number;
  visited: string[];
  completed: boolean;
};

type TutorialRuntime = {
  currentView: TutorialDestination | string;
  navigate: (view: TutorialDestination) => void;
  rerender: () => void;
  renderIcons: (root?: ParentNode) => void;
};

const TUTORIAL_STORAGE_KEY = "codex-switch-terminal.tutorial-progress.v1";
const DEFAULT_PROGRESS: TutorialProgress = {
  version: 1,
  currentStep: 0,
  visited: [],
  completed: false,
};

let tourActive = false;
let tourStepIndex = 0;
let runtime: TutorialRuntime | null = null;
let overlayController: AbortController | null = null;
let overlayFrame = 0;
let renderedStepIndex = -1;
let returnFocus: HTMLElement | null = null;

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const clampStepIndex = (value: unknown): number => {
  const numeric = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
  return Math.min(Math.max(numeric, 0), TUTORIAL_STEPS.length - 1);
};

const readTutorialProgress = (): TutorialProgress => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TUTORIAL_STORAGE_KEY) ?? "null") as
      | Partial<TutorialProgress>
      | null;
    if (!parsed || parsed.version !== 1) return { ...DEFAULT_PROGRESS };
    const validIds = new Set(TUTORIAL_STEPS.map((step) => step.id));
    return {
      version: 1,
      currentStep: clampStepIndex(parsed.currentStep),
      visited: Array.isArray(parsed.visited)
        ? [...new Set(parsed.visited.filter((id): id is string => typeof id === "string" && validIds.has(id)))]
        : [],
      completed: parsed.completed === true,
    };
  } catch {
    return { ...DEFAULT_PROGRESS };
  }
};

const writeTutorialProgress = (progress: TutorialProgress): void => {
  try {
    localStorage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Le tutoriel reste utilisable lorsque le stockage du navigateur est bloqué.
  }
};

const progressWithVisitedStep = (stepIndex: number): TutorialProgress => {
  const previous = readTutorialProgress();
  const id = TUTORIAL_STEPS[stepIndex]?.id;
  return {
    ...previous,
    currentStep: clampStepIndex(stepIndex),
    visited: id && !previous.visited.includes(id) ? [...previous.visited, id] : previous.visited,
  };
};

const tutorialPercent = (progress: TutorialProgress): number =>
  progress.completed
    ? 100
    : Math.round((progress.visited.length / TUTORIAL_STEPS.length) * 100);

const tutorialDurationMinutes = Math.max(2, Math.round(TUTORIAL_STEPS.length / 3));

export const renderTutorialPanel = (): string => {
  const progress = readTutorialProgress();
  const percent = tutorialPercent(progress);
  const resumeIndex = progress.completed ? 0 : progress.currentStep;
  const primaryLabel = progress.completed
    ? "Revoir le parcours"
    : progress.visited.length
      ? `Reprendre à l’étape ${resumeIndex + 1}`
      : "Commencer le parcours";
  const primaryIcon = progress.completed ? "rotate-ccw" : progress.visited.length ? "play" : "rocket";
  const cards = TUTORIAL_STEPS.map((step, index) => {
    const visited = progress.completed || progress.visited.includes(step.id);
    const current = !progress.completed && progress.visited.length > 0 && index === progress.currentStep;
    return `
      <button
        type="button"
        class="tutorial-step-card${visited ? " is-visited" : ""}${current ? " is-current" : ""}"
        data-tutorial-step="${index}"
        aria-label="Ouvrir ${escapeHtml(step.title)}"
      >
        <span class="tutorial-step-icon"><i data-lucide="${escapeHtml(step.icon)}"></i></span>
        <span class="tutorial-step-copy">
          <small>${escapeHtml(step.eyebrow)}</small>
          <strong>${escapeHtml(step.title)}</strong>
          <span>${escapeHtml(step.description)}</span>
        </span>
        <span class="tutorial-step-state" aria-hidden="true">
          <i data-lucide="${visited ? "circle-check" : "chevron-right"}"></i>
        </span>
      </button>`;
  }).join("");

  return `
    <div class="tutorial-panel" aria-labelledby="tutorialTitle">
      <section class="tutorial-hero">
        <div class="tutorial-hero-copy">
          <span class="tutorial-kicker"><i data-lucide="compass"></i> Bien démarrer</span>
          <h1 id="tutorialTitle">Découvre Switch,<br /><em>pas à pas.</em></h1>
          <p>Un parcours guidé de ${tutorialDurationMinutes} minutes pour comprendre les environnements, les chats, le terminal et les outils essentiels.</p>
          <div class="tutorial-hero-actions">
            <button type="button" class="tutorial-primary-action" id="tutorialStart" data-tutorial-start="${resumeIndex}">
              <i data-lucide="${primaryIcon}"></i><span>${primaryLabel}</span>
            </button>
            ${progress.visited.length ? `<button type="button" class="tutorial-secondary-action" id="tutorialReset"><i data-lucide="rotate-ccw"></i><span>Réinitialiser</span></button>` : ""}
          </div>
        </div>
        <div class="tutorial-hero-visual" aria-hidden="true">
          <span class="tutorial-orbit tutorial-orbit-one"></span>
          <span class="tutorial-orbit tutorial-orbit-two"></span>
          <span class="tutorial-visual-core"><i data-lucide="mouse-pointer-2"></i></span>
          <span class="tutorial-visual-chip tutorial-chip-chat"><i data-lucide="messages-square"></i> Chats</span>
          <span class="tutorial-visual-chip tutorial-chip-terminal"><i data-lucide="square-terminal"></i> Terminal</span>
          <span class="tutorial-visual-chip tutorial-chip-agents"><i data-lucide="bot"></i> Agents</span>
        </div>
      </section>

      <section class="tutorial-progress-card" aria-label="Progression du tutoriel">
        <div class="tutorial-progress-copy">
          <span class="tutorial-progress-mark"><i data-lucide="${progress.completed ? "trophy" : "route"}"></i></span>
          <span>
            <small>${progress.completed ? "Parcours terminé" : "Ta progression"}</small>
            <strong>${progress.completed ? "Prêt à utiliser Switch" : `${progress.visited.length} repère${progress.visited.length === 1 ? "" : "s"} découvert${progress.visited.length === 1 ? "" : "s"}`}</strong>
          </span>
        </div>
        <div class="tutorial-progress-meter" role="progressbar" aria-label="Progression" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
          <span style="width: ${percent}%"></span>
        </div>
        <strong class="tutorial-progress-value">${percent}%</strong>
      </section>

      <section class="tutorial-curriculum" aria-labelledby="tutorialCurriculumTitle">
        <div class="tutorial-section-head">
          <div>
            <span>Le parcours</span>
            <h2 id="tutorialCurriculumTitle">Les repères essentiels</h2>
          </div>
          <p>Clique sur une étape pour commencer à cet endroit.</p>
        </div>
        <div class="tutorial-step-grid">${cards}</div>
      </section>
    </div>`;
};

const visibleTarget = (selectors: readonly string[]): HTMLElement | null => {
  for (const selector of selectors) {
    const candidates = document.querySelectorAll<HTMLElement>(selector);
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      if (
        rect.width > 2
        && rect.height > 2
        && rect.right > 0
        && rect.bottom > 0
        && rect.left < window.innerWidth
        && rect.top < window.innerHeight
        && style.display !== "none"
        && style.visibility !== "hidden"
      ) {
        return candidate;
      }
    }
  }
  return null;
};

const removeTourOverlay = (): void => {
  if (overlayFrame) cancelAnimationFrame(overlayFrame);
  overlayFrame = 0;
  overlayController?.abort();
  overlayController = null;
  document.getElementById("tutorialTourLayer")?.remove();
};

const mask = (className: string, style: string): string =>
  `<span class="tutorial-tour-mask ${className}" style="${style}" aria-hidden="true"></span>`;

const positionCoach = (
  coach: HTMLElement,
  target: { left: number; top: number; right: number; bottom: number; width: number; height: number },
): void => {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const gap = 18;
  const edge = 12;
  const width = Math.min(380, viewportWidth - edge * 2);
  coach.style.width = `${width}px`;
  const height = coach.getBoundingClientRect().height;

  let left = target.right + gap;
  let top = target.top + target.height / 2 - height / 2;
  let placement = "right";

  if (viewportWidth - target.right < width + gap && target.left >= width + gap) {
    left = target.left - width - gap;
    placement = "left";
  } else if (viewportWidth - target.right < width + gap) {
    left = target.left + target.width / 2 - width / 2;
    if (viewportHeight - target.bottom >= height + gap) {
      top = target.bottom + gap;
      placement = "bottom";
    } else if (target.top >= height + gap) {
      top = target.top - height - gap;
      placement = "top";
    } else {
      left = viewportWidth - width - edge;
      top = viewportHeight - height - edge;
      placement = "overlay";
    }
  }

  coach.style.left = `${Math.max(edge, Math.min(left, viewportWidth - width - edge))}px`;
  coach.style.top = `${Math.max(edge, Math.min(top, viewportHeight - height - edge))}px`;
  coach.dataset.placement = placement;
};

const finishTour = (): void => {
  const progress: TutorialProgress = {
    version: 1,
    currentStep: TUTORIAL_STEPS.length - 1,
    visited: TUTORIAL_STEPS.map((step) => step.id),
    completed: true,
  };
  writeTutorialProgress(progress);
  tourActive = false;
  renderedStepIndex = -1;
  removeTourOverlay();
  if (runtime?.currentView !== "tutorial") runtime?.navigate("tutorial");
  else runtime?.rerender();
};

const closeTour = (): void => {
  tourActive = false;
  renderedStepIndex = -1;
  removeTourOverlay();
  const focusTarget = returnFocus;
  returnFocus = null;
  if (runtime?.currentView !== "tutorial") {
    runtime?.navigate("tutorial");
    window.requestAnimationFrame(() => document.querySelector<HTMLButtonElement>("#tutorialStart")?.focus());
  } else if (focusTarget?.isConnected) {
    focusTarget.focus();
  } else {
    runtime?.rerender();
  }
};

const showCurrentStep = (): void => {
  if (!tourActive || !runtime) return;
  const step = TUTORIAL_STEPS[tourStepIndex];
  if (!step) return;
  const progress = progressWithVisitedStep(tourStepIndex);
  writeTutorialProgress(progress);

  if (runtime.currentView !== step.view) {
    removeTourOverlay();
    runtime.navigate(step.view);
    return;
  }

  removeTourOverlay();
  overlayFrame = window.requestAnimationFrame(() => {
    overlayFrame = 0;
    if (!tourActive || !runtime || runtime.currentView !== step.view) return;
    const target = visibleTarget(step.selectors) ?? document.querySelector<HTMLElement>("#chatMainWorkspace");
    if (!target) return;

    const rawRect = target.getBoundingClientRect();
    const padding = 8;
    const left = Math.max(6, rawRect.left - padding);
    const top = Math.max(6, rawRect.top - padding);
    const right = Math.min(window.innerWidth - 6, rawRect.right + padding);
    const bottom = Math.min(window.innerHeight - 6, rawRect.bottom + padding);
    const targetRect = {
      left,
      top,
      right,
      bottom,
      width: Math.max(1, right - left),
      height: Math.max(1, bottom - top),
    };
    const first = tourStepIndex === 0;
    const last = tourStepIndex === TUTORIAL_STEPS.length - 1;
    const dots = TUTORIAL_STEPS.map((candidate, index) => `
      <button
        type="button"
        class="tutorial-tour-dot${index === tourStepIndex ? " is-active" : ""}${index < tourStepIndex ? " is-done" : ""}"
        data-tutorial-jump="${index}"
        aria-label="Aller à ${escapeHtml(candidate.title)}"
        ${index === tourStepIndex ? 'aria-current="step"' : ""}
      ></button>`).join("");

    const layer = document.createElement("div");
    layer.id = "tutorialTourLayer";
    layer.className = "tutorial-tour-layer";
    layer.innerHTML = `
      ${mask("is-top", `left:0;top:0;width:100vw;height:${top}px`)}
      ${mask("is-left", `left:0;top:${top}px;width:${left}px;height:${targetRect.height}px`)}
      ${mask("is-right", `left:${right}px;top:${top}px;width:${Math.max(0, window.innerWidth - right)}px;height:${targetRect.height}px`)}
      ${mask("is-bottom", `left:0;top:${bottom}px;width:100vw;height:${Math.max(0, window.innerHeight - bottom)}px`)}
      <span class="tutorial-tour-spotlight" style="left:${left}px;top:${top}px;width:${targetRect.width}px;height:${targetRect.height}px" aria-hidden="true"></span>
      <section class="tutorial-tour-coach" role="dialog" aria-modal="true" aria-labelledby="tutorialTourTitle" aria-describedby="tutorialTourDescription">
        <header class="tutorial-tour-head">
          <span class="tutorial-tour-icon"><i data-lucide="${escapeHtml(step.icon)}"></i></span>
          <span><small>${escapeHtml(step.eyebrow)} · ${tourStepIndex + 1}/${TUTORIAL_STEPS.length}</small><strong id="tutorialTourTitle">${escapeHtml(step.title)}</strong></span>
          <button type="button" class="tutorial-tour-close" data-tutorial-close aria-label="Quitter le tutoriel"><i data-lucide="x"></i></button>
        </header>
        <p id="tutorialTourDescription">${escapeHtml(step.description)}</p>
        <div class="tutorial-tour-tip"><i data-lucide="lightbulb"></i><span>${escapeHtml(step.tip)}</span></div>
        <div class="tutorial-tour-dots" aria-label="Étapes du tutoriel">${dots}</div>
        <footer class="tutorial-tour-actions">
          <button type="button" class="tutorial-tour-back" data-tutorial-previous ${first ? "disabled" : ""}><i data-lucide="arrow-left"></i><span>Précédent</span></button>
          <button type="button" class="tutorial-tour-next" data-tutorial-next><span>${last ? "Terminer" : "Suivant"}</span><i data-lucide="${last ? "check" : "arrow-right"}"></i></button>
        </footer>
      </section>`;
    document.body.appendChild(layer);
    runtime.renderIcons(layer);
    const coach = layer.querySelector<HTMLElement>(".tutorial-tour-coach");
    if (!coach) return;
    positionCoach(coach, targetRect);

    overlayController = new AbortController();
    const { signal } = overlayController;
    layer.querySelector<HTMLButtonElement>("[data-tutorial-close]")?.addEventListener("click", closeTour, { signal });
    layer.querySelector<HTMLButtonElement>("[data-tutorial-previous]")?.addEventListener("click", () => moveTour(-1), { signal });
    layer.querySelector<HTMLButtonElement>("[data-tutorial-next]")?.addEventListener("click", () => {
      if (last) finishTour();
      else moveTour(1);
    }, { signal });
    layer.querySelectorAll<HTMLButtonElement>("[data-tutorial-jump]").forEach((button) => {
      button.addEventListener("click", () => startTutorial(Number(button.dataset.tutorialJump)), { signal });
    });
    window.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        const focusable = Array.from(
          coach.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        );
        if (!focusable.length) return;
        const current = focusable.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey
          ? current <= 0 ? focusable.length - 1 : current - 1
          : current < 0 || current === focusable.length - 1 ? 0 : current + 1;
        event.preventDefault();
        focusable[next]?.focus();
      } else if (event.key === "Escape") {
        event.preventDefault();
        closeTour();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        if (last) finishTour();
        else moveTour(1);
      } else if (event.key === "ArrowLeft" && !first) {
        event.preventDefault();
        moveTour(-1);
      }
    }, { capture: true, signal });
    const reposition = () => {
      if (overlayFrame) return;
      overlayFrame = window.requestAnimationFrame(showCurrentStep);
    };
    window.addEventListener("resize", reposition, { signal });
    window.addEventListener("scroll", reposition, { capture: true, signal });

    const shouldFocus = renderedStepIndex !== tourStepIndex;
    renderedStepIndex = tourStepIndex;
    if (shouldFocus) layer.querySelector<HTMLButtonElement>("[data-tutorial-next]")?.focus();
  });
};

const moveTour = (offset: number): void => {
  const next = clampStepIndex(tourStepIndex + offset);
  if (next === tourStepIndex) return;
  tourStepIndex = next;
  showCurrentStep();
};

export const startTutorial = (requestedStep?: number): void => {
  const progress = readTutorialProgress();
  const fallbackStep = progress.completed ? 0 : progress.currentStep;
  tourStepIndex = clampStepIndex(requestedStep ?? fallbackStep);
  tourActive = true;
  renderedStepIndex = -1;
  returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  showCurrentStep();
};

const resetTutorial = (): void => {
  writeTutorialProgress({ ...DEFAULT_PROGRESS });
  tourActive = false;
  tourStepIndex = 0;
  renderedStepIndex = -1;
  removeTourOverlay();
  runtime?.rerender();
};

export const bindTutorialUi = (options: TutorialRuntime): void => {
  runtime = options;
  document.querySelector<HTMLButtonElement>("#tutorialStart")?.addEventListener("click", (event) => {
    const index = Number((event.currentTarget as HTMLButtonElement).dataset.tutorialStart);
    startTutorial(index);
  });
  document.querySelector<HTMLButtonElement>("#tutorialReset")?.addEventListener("click", resetTutorial);
  document.querySelectorAll<HTMLButtonElement>("[data-tutorial-step]").forEach((button) => {
    button.addEventListener("click", () => startTutorial(Number(button.dataset.tutorialStep)));
  });
  if (tourActive) showCurrentStep();
  else removeTourOverlay();
};
