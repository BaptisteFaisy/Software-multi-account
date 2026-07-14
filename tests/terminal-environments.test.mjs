import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const keyboardShortcuts = readFileSync(
  new URL("../src/keyboard-shortcuts.ts", import.meta.url),
  "utf8",
);
const desktop = readFileSync(
  new URL("../src-tauri/src/terminal.rs", import.meta.url),
  "utf8",
);
const server = readFileSync(
  new URL("../src-tauri/src/server.rs", import.meta.url),
  "utf8",
);

test("un menu separe est l'unique selecteur d'environnement", () => {
  for (const marker of [
    "chat-environment-selector",
    "renderTerminalEnvironmentMenu",
    "data-environment-menu-id",
    "selectEnvironment",
    "Choisir un environnement",
  ]) {
    assert.ok(main.includes(marker), `selecteur manquant: ${marker}`);
  }
  assert.doesNotMatch(main, /renderTerminalEnvironmentTabs|data-terminal-environment|Nouvel onglet/);
  assert.doesNotMatch(style, /\.terminal-environment-tab/);
});

test("la touche accent grave ouvre le menu des environnements", () => {
  assert.match(main, /keyboardShortcutMatchesAction\("toggle-environments", event\)/);
  assert.match(
    keyboardShortcuts,
    /id: "toggle-environments"[\s\S]*?defaultBinding: "Backquote"/,
  );
  assert.match(keyboardShortcuts, /event\.code === "Digit7"/);
  assert.match(main, /renderTerminalEnvironmentMenu/);
  assert.match(main, /terminalEnvironmentMenuOpen/);
  assert.match(main, /data-environment-menu-id/);
  assert.match(style, /\.terminal-environment-menu-backdrop/);
});

test("l'environnement actif contient ses propres chats", () => {
  for (const marker of [
    "expertChatPanesForCurrentEnvironment",
    "expertChatPaneEnvironmentPath",
    "Chats de cet environnement",
  ]) {
    assert.ok(main.includes(marker), `contexte d'environnement incomplet: ${marker}`);
  }
  assert.match(main, /workspaceIdForPath\(panePath\) === environmentId/);
  assert.match(main, /discussion\.folderPath = capturedWorkspace/);
});

test("un nouveau chat s'ouvre via une fenetre de choix du compte", () => {
  // La fenetre "nouveau chat" (compte + modele + mode) remplace le selecteur
  // d'agent inline de la barre d'outils.
  assert.doesNotMatch(main, /id="newChatAgent"/);
  assert.match(main, /const renderNewChatModal =/);
  assert.match(main, /data-new-chat-account/);
  assert.match(main, /id="newChatModel"/);
  assert.match(main, /id="newChatMode"/);
  // Tous les points d'entree "nouveau chat" passent par la fenetre.
  assert.match(main, /const openNewChat = \(\) => \{\s*openNewChatModal\(\);/);
  assert.match(main, /#addExpertChat"\)\?\.addEventListener\("click", \(\) => \{\s*openNewChatModal\(\);/);
  // La fenetre cree le pane avec le compte, le modele et le mode choisis.
  assert.match(main, /addExpertChatPane\(account\.id, \{ mode, pendingWorkspace \}\)/);
  assert.match(main, /accountId: accountId \?\?/);
  assert.match(style, /\.new-chat-account-option/);
});

test("le choix du compte affiche son pourcentage d'utilisation", () => {
  assert.match(main, /const newChatAccountUsageFor =/);
  assert.match(main, /Math\.round\(100 - status\.remainingPercent\)/);
  assert.match(main, /data-new-chat-account-usage=/);
  assert.match(main, /syncNewChatAccountUsageUi\(\)/);
  assert.match(
    main,
    /newChatModalOpen = true;[\s\S]*?render\(\);\s*void refreshLimitStatus\(true\);/,
  );
  assert.match(style, /\.new-chat-account-usage/);
});

test("un environnement vide ne recoit jamais de chat de base", () => {
  assert.doesNotMatch(main, /createExpertChatPane\(\s*\)/);
  assert.doesNotMatch(
    main,
    /!expertChatPanes\.length\)[^\n]*createExpertChatPane/,
  );
  assert.match(main, /Commencez une nouvelle conversation/);
  assert.match(main, /id="emptyNewChat"/);
  assert.match(main, /Dernière discussion/);
});

test("le choix d'environnement propose un explorateur de dossiers navigable", () => {
  for (const marker of [
    "Parcourir les dossiers",
    "workspacePathBreadcrumbs",
    "workspaceFolderSearch",
    "ws-quick-access",
    "data-ws-dir",
    "Choisir ce dossier",
  ]) {
    assert.ok(main.includes(marker), `explorateur incomplet: ${marker}`);
  }
  assert.match(style, /\.workspace-browser-modal/);
  assert.match(style, /\.ws-breadcrumb/);
  assert.match(style, /\.ws-folder-toolbar/);
});

test("les dossiers choisis sont utilises directement", () => {
  assert.match(main, /userEnvironmentPath\(stored\)/);
  assert.match(main, /userEnvironmentPath\(discussion\?\.folderPath\)/);
  assert.match(desktop, /provider\.home_env_var\(\)/);
  assert.match(desktop, /builder\.cwd\(project_dir\.as_os_str\(\)\)/);
});

test("un environnement peut etre retire depuis son menu sans effacer ses fichiers", () => {
  assert.match(main, /data-delete-environment-id/);
  assert.match(main, /Supprimer l'environnement/);
  assert.match(main, /Le repertoire et ses fichiers resteront sur le disque/);
  assert.match(main, /closeWorkspace\(workspace, true\)/);
  assert.match(main, /!workspaceIsClosed\(path\)/);
  assert.match(style, /\.terminal-environment-menu-delete/);
});

test("la creation exige un environnement avant tout appel PTY", () => {
  assert.match(main, /const environmentPath = userEnvironmentPath\(folderPath\)/);
  assert.match(main, /Creation bloquee: choisis d'abord un environnement/);
  assert.match(main, /Environnement de ce terminal \/ session \(obligatoire\)/);
  assert.match(main, /aria-required="true"/);
});

test("un chat actif sans discussion listee reste visible dans la barre laterale", () => {
  // Regression : un nouveau chat (ou un chat dont le dossier n'est pas resolu)
  // apparait dans la grille mais disparaissait de « Chats de cet environnement ».
  // La barre laterale doit unir les discussions persistees et les panes ouverts.
  assert.match(main, /draftEnvironmentChatPanes\(\s*\n?\s*expertChatPanesForCurrentEnvironment\(\)/);
  // Le compteur additionne les brouillons aux discussions persistees.
  assert.match(main, /discussions\.length \+ draftPanes\.length/);
  // Chaque brouillon est focalisable et fermable par cle de pane.
  assert.ok(main.includes("data-open-pane"), "bouton d'ouverture de pane manquant");
  assert.ok(main.includes("data-close-pane"), "bouton de fermeture de pane manquant");
  assert.match(
    main,
    /expertChatPanes\.find\(\(item\) => item\.key === button\.dataset\.openPane\)/,
  );
  assert.match(
    main,
    /expertChatPanes\.find\(\(item\) => item\.key === button\.dataset\.closePane\)/,
  );
});

test("le chat actif n'est pas entoure d'un cadre de selection", () => {
  assert.doesNotMatch(
    style,
    /\.expert-chat-wall\s+\.chat-panel\.active\s*\{[^}]*\bborder(?:-color)?\s*:/,
  );
});

test("les backends desktop et serveur refusent un environnement implicite", () => {
  const error = "Environnement obligatoire avant d'ouvrir un terminal";
  assert.ok(desktop.includes(error));
  assert.ok(server.includes(error));
  assert.doesNotMatch(server, /prepare_local\(&agent_id, &canonical_home, None\)/);
});

test("le terminal temporaire de login reste dans le home du compte sans projet", () => {
  assert.match(
    desktop,
    /let project_dir = if login_only \{\s*account_home\.clone\(\)\s*\} else \{\s*resolve_terminal_environment/,
  );
  assert.match(
    server,
    /if request\.login_only \{[\s\S]*?workspace_id_for_dir\(&canonical_home\)[\s\S]*?canonical_home\.clone\(\)/,
  );
});
