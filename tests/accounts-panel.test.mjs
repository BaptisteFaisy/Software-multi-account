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
  assert.match(main, /invoke<AppSettings>\("remove_account", \{ accountId: id, deleteFiles: false \}\)/);
});
