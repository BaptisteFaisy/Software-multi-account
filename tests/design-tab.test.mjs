import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const design = readFileSync(new URL("../src/design.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/design.css", import.meta.url), "utf8");
const chatBackend = readFileSync(new URL("../src-tauri/src/chat.rs", import.meta.url), "utf8");

test("l'espace Design est disponible dans les navigations desktop et mobile", () => {
  assert.match(main, /\| "design"/);
  assert.match(main, /id="designToggle" data-open-design/);
  assert.match(main, /data-view="design"[^>]*>[\s\S]*?<span>Design<\/span>/);
  assert.match(main, /type DesignModule = typeof import\("\.\/design"\)/);
  assert.match(main, /designModulePromise = import\("\.\/design"\)/);
  assert.match(main, /if \(view === "design" && !designModule\)/);
  assert.match(main, /case "design":\s*return designModule\?\.renderDesignPanel\(/);
  assert.doesNotMatch(main, /from "\.\/design";/);
  assert.doesNotMatch(main, /import "\.\/design\.css";/);
  assert.match(design, /import "\.\/design\.css";/);
});

test("la vue Design propose Claude Design intégré et Kombai sans fenêtre externe", () => {
  assert.match(design, /data-design-tool-choice="claude"/);
  assert.match(design, /data-design-tool-choice="kombai"/);
  assert.match(design, /id="claudeDesignComposer"/);
  assert.match(design, /id="claudeDesignPrompt"/);
  assert.match(design, /id="claudeDesignFeed"/);
  assert.match(design, /Intégré à cette fenêtre/);
  assert.doesNotMatch(design, /target="_blank"/);
  assert.doesNotMatch(design, /window\.open/);
  assert.doesNotMatch(design, /<iframe[^>]+claude/i);
  assert.match(main, /kombaiPanelHtml: activeDesignTool === "kombai" \? renderKombaiPanel\(\) : ""/);
});

test("Claude Design utilise le moteur Claude du site avec streaming et reprise de session", () => {
  assert.match(main, /const sendClaudeDesignMessage = async/);
  assert.match(main, /invoke<ChatTurnSnapshot>\("start_chat_turn"/);
  assert.match(main, /agentSkills: \[claudeDesignSkill\(designClaudeMode, projectDir\)\]/);
  assert.match(main, /invoke<ChatTurnSnapshot>\("chat_turn_status"/);
  assert.match(main, /DESIGN_CLAUDE_SESSIONS_STORAGE_KEY/);
  assert.match(main, /#claudeDesignComposer/);
  assert.doesNotMatch(main, /launchClaudeDesign/);
  assert.doesNotMatch(main, /openClaudeDesign/);
});

test("les livrables Claude Design sont obligatoirement sauvegardés dans le projet local", () => {
  assert.match(main, /if \(!projectDir\)[\s\S]*?dossier précis du PC/);
  assert.match(main, /Toute réalisation demandée doit être enregistrée physiquement sur le PC/);
  assert.match(main, /design-output\/<nom-du-livrable>/);
  assert.match(main, /donne les chemins locaux exacts des fichiers créés ou modifiés/);
  assert.match(design, /data-local-save="required"/);
  assert.match(design, /Sauvegarde locale obligatoire/);
  assert.match(chatBackend, /command\.current_dir\(project_dir\)/);
  assert.match(chatBackend, /ChatTurnMode::Build => \{\s*command\.arg\("--permission-mode"\)\.arg\("acceptEdits"\)/);
});

test("l'espace Design possède une mise en page responsive", () => {
  assert.match(styles, /\.design-panel\s*\{/);
  assert.match(styles, /\.design-claude-workspace\s*\{/);
  assert.match(styles, /\.design-studio-shell\s*\{/);
  assert.match(styles, /\.design-composer\s*\{/);
  assert.match(styles, /\.design-kombai-workspace\s*\{/);
  assert.match(styles, /@media \(max-width: 860px\)/);
});
