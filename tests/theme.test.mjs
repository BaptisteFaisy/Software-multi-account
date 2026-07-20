import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  THEME_STORAGE_KEY,
  loadTheme,
  normalizeTheme,
  oppositeTheme,
  persistTheme,
  terminalThemeFor,
  themeColor,
} from "../src/theme.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const themeCss = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");
const deferredThemeCss = ["stats-view.css", "doctolib-lab.css", "tasks-view.css"]
  .map((file) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8"))
  .join("\n");
const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("le theme sauvegarde ne peut etre que clair ou sombre", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("system"), "dark");
  assert.equal(normalizeTheme(null), "dark");
  assert.equal(oppositeTheme("dark"), "light");
  assert.equal(oppositeTheme("light"), "dark");
});

test("le choix de theme est persistant et tolere un stockage indisponible", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };

  assert.equal(loadTheme(storage), "dark");
  assert.equal(persistTheme("light", storage), true);
  assert.equal(values.get(THEME_STORAGE_KEY), "light");
  assert.equal(loadTheme(storage), "light");
  assert.equal(loadTheme({ getItem: () => { throw new Error("bloque"); } }), "dark");
  assert.equal(persistTheme("dark", { setItem: () => { throw new Error("bloque"); } }), false);
});

test("le terminal et la barre systeme ont une palette par theme", () => {
  const light = terminalThemeFor("light");
  const dark = terminalThemeFor("dark");

  assert.equal(light.background, "#fbfcfa");
  assert.equal(light.foreground, "#202420");
  assert.equal(dark.background, "#000000");
  assert.notEqual(light.selectionBackground, dark.selectionBackground);
  assert.equal(themeColor("light"), "#f4f6f3");
  assert.equal(themeColor("dark"), "#000000");
});

test("toutes les couleurs de texte du terminal clair restent lisibles", () => {
  const theme = terminalThemeFor("light");
  const channels = (hex) => [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const luminance = (hex) => channels(hex)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const contrast = (first, second) => {
    const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (lighter + 0.05) / (darker + 0.05);
  };

  for (const key of [
    "foreground",
    "black",
    "red",
    "green",
    "yellow",
    "blue",
    "magenta",
    "cyan",
    "white",
    "brightBlack",
    "brightRed",
    "brightGreen",
    "brightYellow",
    "brightBlue",
    "brightMagenta",
    "brightCyan",
    "brightWhite",
  ]) {
    assert.ok(contrast(theme[key], theme.background) >= 4.5, `${key} manque de contraste`);
  }
});

test("la bascule est cablee avant le rendu et couvre les vues principales", () => {
  assert.match(index, /codex-switch-terminal\.theme/);
  assert.match(index, /document\.documentElement\.dataset\.theme/);
  assert.match(main, /data-theme-choice="light"/);
  assert.match(main, /id="themeToggle"/);
  assert.match(main, /createTerminalRuntime\(activeTheme\)/);
  assert.match(main, /session\.terminal\.options\.theme = terminalThemeFor\(theme\)/);

  for (const selector of [
    ".chat-app-layout",
    ".expert-terminal-wall",
    ".stats-dashboard",
    ".doctolib-lab",
    ".autonomous-panel",
    ".orchestration-panel",
    ".tasks-panel",
  ]) {
    assert.match(
      `${themeCss}\n${deferredThemeCss}`,
      new RegExp(`data-theme="light"[^{}]*\\${selector}`),
    );
  }
});
