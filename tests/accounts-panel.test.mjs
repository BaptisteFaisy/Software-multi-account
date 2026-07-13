import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("la vue « Comptes & pool » affiche l'editeur complet des comptes", () => {
  // Le panneau editeur (ajout / edition / suppression) doit etre reellement
  // branche : la vue pool delegue a renderAccountsAndPool, qui appelle
  // renderAccountsPanel. Regression : renderAccountsPanel etait defini mais
  // jamais appele, donc invisible.
  assert.match(main, /case "pool":\s*\n\s*return renderAccountsAndPool\(\);/);
  assert.match(main, /const renderAccountsAndPool = \(\): string =>/);
  assert.match(main, /renderAccountsPanel\(proxyOptions, proxiesEnabled\)/);
});

test("renderAccountsPanel n'est plus du code mort", () => {
  // Au moins deux occurrences : la definition + un appel effectif.
  const occurrences = main.match(/renderAccountsPanel/g) ?? [];
  assert.ok(
    occurrences.length >= 2,
    `renderAccountsPanel devrait etre appele au moins une fois (trouve ${occurrences.length} occurrence(s))`,
  );
});

test("l'editeur de comptes propose bien une option pour ajouter un compte", () => {
  // Le bouton d'ajout et son gestionnaire doivent coexister.
  assert.match(main, /<strong>Gestion des comptes<\/strong>/);
  assert.match(main, /id="addAccount"/);
  assert.match(
    main,
    /querySelector<HTMLButtonElement>\("#addAccount"\)\?\.addEventListener/,
  );
  // Le bouton doit reellement creer puis selectionner un nouveau compte.
  assert.match(main, /const label = "Nouveau compte";/);
  assert.match(main, /newAccountProfile\(label, uniqueCodexHomeForLabel\(label\)\)/);
});

test("l'editeur reste sauvegardable et supprimable", () => {
  // Save et suppression du compte selectionne restent cables.
  assert.match(main, /id="saveSettings"/);
  assert.match(main, /id="removeAccount"/);
  assert.match(
    main,
    /querySelector<HTMLButtonElement>\("#saveSettings"\)\?\.addEventListener/,
  );
});

test("creer un compte ouvre une fenetre de connexion (login)", () => {
  // « + Compte » delegue au flux qui persiste puis ouvre le terminal de login.
  assert.match(main, /const addAccountAndLogin = async \(\) =>/);
  assert.match(main, /addAccountAndLogin\(\)/);
  // Le compte est persiste (supprimable) puis un terminal de login est ouvert.
  assert.match(main, /save_settings/);
  assert.match(main, /await reloginAccount\(account\.id\)/);
});

test("reconnecter Codex supprime l'ancienne session avant le nouveau login", () => {
  // Un auth.json revoque existe encore : `codex login` seul n'est pas une
  // reconnexion fiable. Le terminal doit enchainer logout puis login.
  assert.match(main, /provider === "codex"/);
  assert.match(main, /agentSubcommand\(agent, "logout"\)/);
  assert.match(main, /shellCommandSeparator\(\)/);
  assert.match(main, /reconnectCommand,/);
});

test("la reconnexion Codex utilise la connexion classique (sans codes/device flow)", () => {
  // Retour a la connexion classique : plus d'injection --device-auth ni de
  // branche effectiveLoginSub, meme en mode remote. On ouvre le login OAuth
  // standard directement a partir de loginSub.
  assert.doesNotMatch(main, /--device-auth/);
  assert.doesNotMatch(main, /effectiveLoginSub/);
  assert.match(main, /const loginCommand = agentSubcommand\(agent, loginSub\);/);
});

test("la reconnexion utilise un terminal strictement reserve au login", () => {
  assert.match(main, /environmentPath,\s*\n\s*true,\s*\n\s*\);/);
  assert.match(main, /loginOnly,\s*\n\s*\}\);/);
  assert.match(main, /!loginOnly && settings\.autoRunCodex/);
  assert.match(main, /!loginOnly &&\s*\n\s*\(session\.resumeSessionId/);
});

test("une reconnexion ne peut ouvrir qu'un terminal ephemere a la fois", () => {
  // Le login ne restaure pas implicitement les terminaux de travail et ne sera
  // lui-meme jamais sauvegarde pour une restauration ulterieure.
  assert.match(
    main,
    /if \(!loginOnly \|\| terminalRestoreAttempted\) \{\s*await ensureTerminalsRestored\(\);/,
  );
  assert.match(main, /session\.loginOnly = loginOnly;/);
  assert.match(
    main,
    /\.filter\(\(session\) => session\.status !== "Ferme" && !session\.loginOnly\)/,
  );
  assert.match(main, /if \(!terminalRestoreAttempted\) return;/);

  // Deux declenchements concurrents pour le meme compte reutilisent la meme
  // promesse au lieu de reserver puis demarrer deux PTY.
  assert.match(
    main,
    /const loginTerminalCreations = new Map<string, Promise<TerminalSession \| null>>\(\);/,
  );
  assert.match(main, /const inFlightLogin = loginTerminalCreations\.get\(accountId\);/);
  assert.match(main, /if \(inFlightLogin\) \{[\s\S]*?return inFlightLogin;/);
  assert.match(main, /loginTerminalCreations\.set\(accountId, creation\);/);
  assert.match(main, /loginTerminalCreations\.delete\(accountId\);/);
});

test("le login depuis Nouveau terminal persiste aussi dans le home du compte", () => {
  const handlerStart = main.indexOf(
    'querySelector<HTMLButtonElement>("#loginNewTerminal")?.addEventListener',
  );
  const handlerEnd = main.indexOf(
    'querySelector<HTMLButtonElement>("#poolTerminal")?.addEventListener',
    handlerStart,
  );
  assert.ok(handlerStart >= 0 && handlerEnd > handlerStart, "gestionnaire login introuvable");
  const handler = main.slice(handlerStart, handlerEnd);

  // Le meme logout + login est utilise, et loginOnly=true force le backend a
  // exposer le CODEX_HOME permanent plutot que la copie jetable du workspace.
  assert.match(handler, /reconnectCommandForAccount\(account, agent\)/);
  assert.match(handler, /newTerminalWorkspacePath,\s*\n\s*true,\s*\n\s*\);/);
});

test("une erreur d'auth reste prioritaire sur les limites locales en cache", () => {
  assert.match(main, /account\.error && AUTH_LIMIT_ERROR\.test\(account\.error\)/);
  assert.match(main, /return "session expiree"/);
});

test("l'editeur expose un bouton « Se connecter » par compte", () => {
  assert.match(main, /id="loginAccount"/);
  assert.match(
    main,
    /querySelector<HTMLButtonElement>\("#loginAccount"\)\?\.addEventListener/,
  );
  // Le bouton capture les modifs en cours puis ouvre le login du compte choisi.
  assert.match(main, /void reloginAccount\(selectedAccountId\)/);
});

test("la suppression persiste vraiment (backend + repli)", () => {
  // La suppression passe par une fonction dediee, pas un simple filtre local.
  assert.match(main, /const deleteSelectedAccount = async \(\) =>/);
  assert.match(
    main,
    /querySelector<HTMLButtonElement>\("#removeAccount"\)\?\.addEventListener\(\s*"click",\s*\(\)\s*=>\s*\{\s*\n\s*void deleteSelectedAccount\(\);/,
  );
  // Suppression backend (compte persiste) avec repli save_settings (compte neuf).
  assert.match(main, /invoke<AppSettings>\("remove_account", \{ accountId: id, deleteFiles \}\)/);
});

test("la suppression tient compte de l'auto-detection (sinon le compte revient)", () => {
  // Avec l'auto-detection active, on propose d'effacer aussi les fichiers, sinon
  // le compte est re-decouvert au prochain chargement.
  assert.match(main, /if \(settings\.autoDiscoverAccounts && target\)/);
  assert.match(main, /deleteFiles = window\.confirm\(/);
});

test("le re-rendu preserve le scroll des vues admin (ne fait plus remonter)", () => {
  // render() capture puis restaure le scrollTop de .chat-admin-panel autour du
  // remplacement complet du DOM.
  assert.match(main, /const adminScrollTop =\s*\n?\s*document\.querySelector<HTMLElement>\("\.chat-admin-panel"\)\?\.scrollTop \?\? 0;/);
  assert.match(main, /restoredAdminPanel\.scrollTop = adminScrollTop;/);
});
