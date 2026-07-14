import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("l'interface charge directement la grille de chats", () => {
  assert.match(main, /const renderChatFirstShell = \(\) =>/);
  assert.match(style, /\.chat-app-layout/);
});

test("la gestion des agents se trouve dans les parametres, pas dans la colonne gauche", () => {
  const settingsStart = main.indexOf("const renderSettingsPanel = (): string =>");
  const settingsEnd = main.indexOf("\nconst renderActiveAppPanel", settingsStart);
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart, "panneau Parametres introuvable");
  assert.match(main.slice(settingsStart, settingsEnd), /id="settingsAgents"/);

  const shellStart = main.indexOf("const renderChatFirstShell = () =>");
  const footerStart = main.indexOf('<footer class="chat-side-footer">', shellStart);
  const footerEnd = main.indexOf("</footer>", footerStart);
  assert.ok(shellStart >= 0 && footerStart > shellStart && footerEnd > footerStart, "pied de colonne gauche introuvable");
  const sidebarFooter = main.slice(footerStart, footerEnd);
  assert.match(sidebarFooter, /id="settingsToggle"/);
  assert.doesNotMatch(sidebarFooter, /id="manageAgents"/);
  assert.match(main, /#settingsAgents"\)\?\.addEventListener\("click", \(\) => \{\s*openAgentsModal\(\);/);
});

test("la navigation mobile reste disponible dans la coque multi-chat", () => {
  const start = main.indexOf("const renderChatFirstShell = () =>");
  const end = main.indexOf("\nconst render = () =>", start);
  assert.ok(start >= 0 && end > start, "coque multi-chat introuvable");
  assert.match(main.slice(start, end), /ensureMobileChrome\(\);/);
});

test("le retour des vues administratives porte un nom accessible", () => {
  assert.match(
    main,
    /id="adminBackChat"[^>]*title="Retour aux chats"[^>]*aria-label="Retour aux chats"/,
  );
  assert.match(main, /data-lucide="arrow-left" aria-hidden="true"/);
});

test("la navigation mobile expose cinq destinations et une action adaptee au chat", () => {
  const start = main.indexOf("function ensureMobileChrome(): void");
  const end = main.indexOf("\ntype ChatWorkspaceSidebarGroup", start);
  assert.ok(start >= 0 && end > start, "coque mobile introuvable");
  const mobile = main.slice(start, end);
  assert.equal([...mobile.matchAll(/class="m-tab"/g)].length, 5);
  assert.match(mobile, /data-view="chat"/);
  assert.match(mobile, /activeView === "chat" \|\| activeView === "discussions"\) openNewChat\(\)/);
  assert.match(main, /newAction\.classList\.toggle\("is-placeholder", !available\)/);
  assert.match(main, /case "settings":\s*return "Paramètres";/);
  assert.match(style, /padding-top: calc\(var\(--m-topbar-h\)/);
  assert.match(style, /chat-panel--expert:not\(\.active\)/);
  assert.match(style, /\.chat-admin-actions \{\s*display: none !important;/);
});

test("le web active automatiquement l'unique environnement du serveur", () => {
  assert.match(main, /!currentWorkspace\(\) && byId\.size === 1/);
  assert.match(main, /setCurrentWorkspace\(onlyWorkspace\.path\)/);
});

test("l'accueil sans chat propose des actions utiles", () => {
  assert.match(main, /class="expert-chat-empty-recent" data-open-chat/);
  assert.match(main, /id="emptyNewChat"/);
  assert.match(main, /data-open-discussions class="tool-button"/);
  assert.match(style, /\.expert-chat-empty-actions/);
});

test("la colonne gauche ne propose plus de bouton nouveau chat", () => {
  assert.doesNotMatch(main, /newChatSide|chat-side-new/);
  assert.doesNotMatch(style, /\.chat-side-new/);
});

test("ouvrir une conversation referme le tiroir mobile", () => {
  assert.match(main, /const openDiscussionChat = async \(discussion:[^{]+\{\s*closeMobileOverlays\(\);/);
});

test("les fenetres gardent le focus clavier et isolent l'arriere-plan", () => {
  assert.match(main, /const syncActiveDialogAccessibility = \(\) =>/);
  assert.match(main, /layout\.inert = !!dialog/);
  assert.match(main, /window\.addEventListener\("keydown", trapActiveDialogFocus, true\)/);
  assert.match(main, /event\.key === "Escape" && workspaceModalOpen/);
  assert.match(main, /restoreDialogTrigger\(returnFocus\)/);
  assert.match(style, /\.terminal-environment-menu[\s\S]*:focus-visible/);
  assert.match(style, /body\.has-active-dialog #app/);
});

test("le pool peut etre demarre et arrete depuis sa vue", () => {
  const start = main.indexOf("const renderPoolPanel = () =>");
  const end = main.indexOf("\nconst renderLimitsPanel = () =>", start);
  assert.ok(start >= 0 && end > start, "panneau pool introuvable");
  const panel = main.slice(start, end);
  assert.match(panel, /id="poolStart"/);
  assert.match(panel, /id="poolStop"/);
  assert.match(panel, /id="poolRuntimeStatus"/);
  assert.match(panel, /Démarrer le pool/);
  assert.match(panel, /Arrêter le pool/);
  assert.match(main, /runtimeStatus\.textContent = poolRuntimeSummary\(\);/);
});

test("le tableau du pool ne pousse pas les actions hors ecran", () => {
  assert.match(main, /class="pool-table-wrap table-wrap" tabindex="0"/);
  assert.match(style, /\.pool-table-wrap \{[^}]*overflow-x: auto;/);
  assert.match(
    style,
    /\.accounts-pool-view > \.pool-panel \{[^}]*flex: 0 0 auto;[^}]*grid-template-rows: repeat\(4, auto\);/,
  );
  assert.match(
    style,
    /\.pool-add,\s*\.pool-import \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
});

test("les limites utilisent des cartes responsives sans tableau horizontal", () => {
  assert.doesNotMatch(main, /class="limits-table-wrap table-wrap"/);
  assert.doesNotMatch(main, /class="limits-table"/);
  assert.match(main, /class="limit-card-grid"/);
  assert.match(
    style,
    /@media \(max-width: 980px\) \{[\s\S]*?\.limit-card-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    style,
    /@media \(max-width: 620px\) \{[\s\S]*?\.limit-card-meters \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
});

test("le menu mobile gere son etat et le focus au clavier", () => {
  assert.match(main, /data-m="menu" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(main, /id="mobileActionSheet" aria-hidden="true" inert/);
  assert.equal([...main.matchAll(/role="menuitem"/g)].length, 13);
  assert.match(main, /role="menuitem" data-view="tasks"/);
  assert.match(main, /role="menuitem" data-view="prompts"/);
  assert.doesNotMatch(main, /role="menuitem" data-view="doctolib-lab"/);
  assert.match(main, /role="menuitem" data-view="autonomous"/);
  assert.match(main, /role="menuitem" data-view="orchestration"/);
  assert.match(main, /const syncMobileSheetAccessibility = \(open: boolean/);
  assert.match(main, /sheet\.inert = !open/);
  assert.match(main, /chrome\.addEventListener\("keydown"/);
  assert.match(main, /event\.key === "ArrowDown" \|\| event\.key === "ArrowRight"/);
  assert.match(style, /\.m-sheet-grid button:focus-visible/);
});

test("le menu mobile reste borne et defilable quand la hauteur manque", () => {
  assert.match(
    style,
    /\.m-sheet-panel \{[^}]*max-height: calc\(100dvh - var\(--m-topbar-h\) - env\(safe-area-inset-top\)\);[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: contain;[^}]*-webkit-overflow-scrolling: touch;/,
  );
});

test("le tiroir mobile est retire du clavier lorsqu'il est ferme", () => {
  assert.match(main, /data-m="drawer"[^>]*aria-expanded="false"[^>]*aria-controls="chatAppSidebar"/);
  assert.match(main, /const syncMobileDrawerAccessibility = \(open: boolean/);
  assert.match(main, /sidebar\.inert = mobile && !open/);
  assert.match(main, /#chatSidebarClose"\)\?\.focus\(\)/);
  assert.match(main, /dialogFocusableElements\(sidebar\)/);
  assert.match(main, /window\.addEventListener\("resize", refit\)/);
});

test("toutes les icones statiques ont un composant Lucide", () => {
  const start = main.indexOf("const lucideIcons = {");
  const end = main.indexOf("\n};", start);
  assert.ok(start >= 0 && end > start, "registre d'icones introuvable");
  const registry = main.slice(start, end);
  const componentName = (name) =>
    name.replace(/(\w)(\w*)(_|-|\s*)/g, (_match, first, rest) =>
      first.toUpperCase() + rest.toLowerCase());
  const names = [...main.matchAll(/data-lucide="([a-z0-9-]+)"/g)].map((match) => match[1]);
  const missing = [...new Set(names)].filter(
    (name) => !new RegExp(`\\b${componentName(name)}\\b`).test(registry),
  );
  assert.deepEqual(missing, []);
});

test("la gestion minimale des comptes reste utilisable sur mobile", () => {
  const panelStart = main.indexOf("const renderAccountsPanel =");
  const panelEnd = main.indexOf("const renderAccountsAndPool =", panelStart);
  const panel = main.slice(panelStart, panelEnd);
  assert.match(panel, /id="addAccountForm"/);
  assert.doesNotMatch(panel, /proxyUrlInput|addProxy|proxySelect/);
  assert.match(style, /@media \(max-width: 720px\) \{[\s\S]*?\.simple-account-add \{\s*grid-template-columns: 1fr;/);
  assert.match(style, /@media \(max-width: 520px\) \{[\s\S]*?\.simple-account-card \{[\s\S]*?flex-direction: column;/);
});

test("les informations d'etat visibles respectent une taille et un contraste lisibles", () => {
  assert.match(style, /--muted-2: #8a8a8a;/);
  assert.match(style, /--muted: #858585;/);
  assert.match(style, /\.chat-side-tools button \{[^}]*color: #858585;/);
  assert.match(style, /\.folder-terminal-copy small \{ color: #858585;/);
  assert.match(style, /\.audit-badge \{[^}]*color: #000;/);
  assert.match(style, /\.chat-side-search:focus-within \{[^}]*outline: 2px solid var\(--chat-accent\);/);
  assert.match(style, /\.expert-grid-control:focus-within \{[^}]*outline: 2px solid var\(--accent\);/);
  assert.match(style, /\.chat-admin-head span \{[^}]*font-size: 12px;/);
  assert.match(style, /\.chat-status-toast \{[^}]*font-size: 12px;/);
  assert.match(
    style,
    /\.chat-workspace-empty \{[^}]*color: var\(--chat-muted\);[^}]*font-size: 12px;/,
  );
  assert.match(style, /\.chat-workspace-overview-copy \{[^}]*overflow: hidden;/);
  assert.match(
    style,
    /\.chat-workspace-overview-copy strong \{[^}]*font: 600 13px[^}]*overflow-wrap: anywhere;/,
  );
  assert.match(
    style,
    /\.chat-workspace-overview-copy small \{[^}]*font-size: 12px;[^}]*overflow-wrap: anywhere;/,
  );
  assert.match(
    style,
    /\.limits-head strong,\s*\.discussions-head > div > strong \{[^}]*text-transform: none;/,
  );
  assert.match(style, /\.discussion-search input \{\s*min-height: 44px;/);
  assert.match(style, /\.account-form-grid input,[^}]*\.discussion-target \{[^}]*min-height: 44px;/);
});
