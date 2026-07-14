import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { accountCatalogMatchesLimitRows } from "../src/chat/accounts.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const settingsBackend = readFileSync(
  new URL("../src-tauri/src/settings.rs", import.meta.url),
  "utf8",
);

test("detecte un compte visible dans Limites mais absent du selecteur de chat", () => {
  const accounts = [
    { id: "a", label: "Principal", codexHome: "/homes/a" },
  ];
  assert.equal(accountCatalogMatchesLimitRows(accounts, accounts), true);
  assert.equal(
    accountCatalogMatchesLimitRows(accounts, [
      ...accounts,
      { id: "b", label: "Nouveau", codexHome: "/homes/b" },
    ]),
    false,
  );
  assert.equal(
    accountCatalogMatchesLimitRows(accounts, [
      { id: "a", label: "Principal renomme", codexHome: "/homes/a" },
    ]),
    false,
  );
  assert.equal(
    accountCatalogMatchesLimitRows(accounts, [
      { id: "a", label: "Principal", provider: "claude", codexHome: "/homes/a" },
    ]),
    false,
  );
});

test("Limites resynchronise les settings sans permettre d'ouvrir un chat", () => {
  assert.match(
    main,
    /!accountCatalogMatchesLimitRows\(settings\.accounts, limitStatus\)[\s\S]*?invoke<AppSettings>\("load_settings"\)/,
  );
  assert.doesNotMatch(main, /data-open-limit-chat/);
  assert.doesNotMatch(main, /limit-open-chat/);
  assert.doesNotMatch(main, /dataset\.openLimitChat/);
});

test("Limites est strictement consultatif et ne propose plus de connexion", () => {
  assert.doesNotMatch(main, /renderLimitProviderLoginButton/);
  assert.doesNotMatch(main, /data-limit-login-account|data-limit-login-provider/);
  assert.doesNotMatch(main, /selectLimitAccountProviderAndLogin/);
  assert.match(main, /Les connexions se gèrent uniquement depuis la page Comptes\./);
  // La connexion reste disponible à l'endroit unique prévu pour elle.
  assert.match(main, /data-login-account="\$\{escapeAttr\(item\.id\)\}"/);
});

test("Limites utilise un tableau de bord de cartes et de jauges", () => {
  assert.match(main, /class="limits-overview"/);
  assert.match(main, /class="limit-card-grid"/);
  assert.match(main, /const renderLimitMeter = \(/);
  assert.match(main, /role="progressbar"/);
  assert.match(main, /class="limit-card-unavailable"/);
  assert.match(main, /Quotas non exposés/);
  assert.doesNotMatch(main, /class="limits-table"/);
});

test("la connexion Claude Code utilise son flux auth et pas codex login", () => {
  assert.match(main, /provider === "claude" \? "auth login" : "login"/);
  assert.match(settingsBackend, /login_command: Some\("auth login"\.to_string\(\)\)/);
  assert.match(settingsBackend, /status_command: Some\("auth status"\.to_string\(\)\)/);
  assert.doesNotMatch(main, /title="Ouvrir un terminal de connexion \(codex login\)/);
});

test("Limites identifie Claude sans interroger le serveur de quotas Codex", () => {
  assert.match(settingsBackend, /pub provider: Provider,/);
  assert.match(
    settingsBackend,
    /if has_tokens && account\.provider == Provider::Claude[\s\S]*?source = "authenticated";/,
  );
  assert.match(main, /account\.source === "authenticated"/);
  assert.match(
    main,
    /const limitRowProvider = \(account: AccountLimitView\)[\s\S]*?accountById\(account\.id\)[\s\S]*?accountProvider\(configured\)/,
  );
  assert.match(main, /provider === "claude" \? "Claude" : "Codex"/);
  assert.match(main, /provider === "claude"[\s\S]*?limit-card-unavailable/);
});
