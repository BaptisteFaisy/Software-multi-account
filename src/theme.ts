export type ThemeMode = "dark" | "light";

export type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

export const THEME_STORAGE_KEY = "codex-switch-terminal.theme";

export const normalizeTheme = (value: string | null | undefined): ThemeMode =>
  value === "light" ? "light" : "dark";

export const loadTheme = (
  storage: Pick<ThemeStorage, "getItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): ThemeMode => {
  try {
    return normalizeTheme(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return "dark";
  }
};

export const persistTheme = (
  theme: ThemeMode,
  storage: Pick<ThemeStorage, "setItem"> | null | undefined =
    typeof localStorage === "undefined" ? null : localStorage,
): boolean => {
  try {
    storage?.setItem(THEME_STORAGE_KEY, theme);
    return !!storage;
  } catch {
    return false;
  }
};

export const oppositeTheme = (theme: ThemeMode): ThemeMode =>
  theme === "dark" ? "light" : "dark";

export const themeColor = (theme: ThemeMode): string =>
  theme === "light" ? "#f4f6f3" : "#000000";

export const terminalThemeFor = (theme: ThemeMode) =>
  theme === "light"
    ? {
        background: "#fbfcfa",
        foreground: "#202420",
        cursor: "#111411",
        cursorAccent: "#fbfcfa",
        selectionBackground: "#cfd8d1",
        selectionInactiveBackground: "#e2e7e2",
        black: "#202420",
        red: "#b42318",
        green: "#207a3d",
        yellow: "#856000",
        blue: "#245b9e",
        magenta: "#7d3c98",
        cyan: "#0f6b78",
        white: "#4f584f",
        brightBlack: "#687068",
        brightRed: "#cf3c31",
        brightGreen: "#277b45",
        brightYellow: "#936500",
        brightBlue: "#3370b0",
        brightMagenta: "#9850b4",
        brightCyan: "#127486",
        brightWhite: "#303730",
      }
    : {
        background: "#000000",
        foreground: "#f4f4f4",
        cursor: "#ffffff",
        cursorAccent: "#000000",
        selectionBackground: "#3a3a3a",
        selectionInactiveBackground: "#242424",
        black: "#1a1a1a",
        red: "#f06f6c",
        green: "#8fd694",
        yellow: "#ffd166",
        blue: "#78a6d9",
        magenta: "#d29bd9",
        cyan: "#6ec6bd",
        white: "#f4f4f4",
        brightBlack: "#6a6a6a",
        brightRed: "#ff8a82",
        brightGreen: "#a7e9aa",
        brightYellow: "#ffe08a",
        brightBlue: "#94c1f0",
        brightMagenta: "#e7b3ef",
        brightCyan: "#8de1d7",
        brightWhite: "#ffffff",
      };

export const applyThemeToDocument = (
  theme: ThemeMode,
  target: Document | null | undefined = typeof document === "undefined" ? null : document,
): void => {
  if (!target) return;
  target.documentElement.dataset.theme = theme;
  target.documentElement.style.colorScheme = theme;
  target.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", themeColor(theme));
  target.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')
    ?.setAttribute("content", theme === "light" ? "default" : "black-translucent");
};
