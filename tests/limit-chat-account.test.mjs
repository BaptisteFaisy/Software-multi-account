import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  accountCatalogMatchesLimitRows,
  accountLimitRowsForDisplay,
} from "../src/chat/accounts.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
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

test("Limites supprime les profils qui partagent le meme home", () => {
  const accounts = [
    { id: "a", label: "Principal", codexHome: "/homes/shared" },
    { id: "b", label: "Secondaire", codexHome: "\\HOMES\\SHARED\\" },
    { id: "c", label: "Sans retour serveur", codexHome: "/homes/c" },
  ];
  const rows = [
    { ...accounts[0], hasTokens: true },
    { ...accounts[1], hasTokens: true },
  ];

  const displayed = accountLimitRowsForDisplay(accounts, rows, (account) => ({
    ...account,
    hasTokens: false,
  }));

  assert.deepEqual(displayed.map((row) => row.id), ["a", "c"]);
  assert.equal(displayed[1].hasTokens, false);
});

test("le backend retire les doublons de home au chargement et a la sauvegarde", () => {
  assert.match(settingsBackend, /fn deduplicate_accounts_by_home\(/);
  assert.match(
    settingsBackend,
    /merge_discovered_profiles\(&mut settings\)[\s\S]*?deduplicate_accounts_by_home\(&mut settings\)/,
  );
  assert.match(
    settingsBackend,
    /merge_persisted_account_lifecycle\(&path, &mut settings, now\);\s*deduplicate_accounts_by_home\(&mut settings\);/,
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
  assert.doesNotMatch(
    main,
    /Les quotas sont consultés ici\. Les connexions se gèrent uniquement depuis la page Comptes\./,
  );
  // La connexion reste disponible à l'endroit unique prévu pour elle.
  assert.match(main, /data-login-account="\$\{escapeAttr\(item\.id\)\}"/);
});

test("Limites utilise un tableau de bord de cartes et de jauges", () => {
  assert.match(main, /class="limits-overview/);
  assert.match(main, /class="limit-card-grid"/);
  assert.match(main, /const renderLimitMeter = \(/);
  assert.match(main, /role="progressbar"/);
  assert.match(main, /class="limit-card-unavailable"/);
  assert.match(main, /Quotas non exposés/);
  assert.doesNotMatch(main, /class="limits-table"/);
  const panelStart = main.indexOf("const renderLimitsPanel = () =>");
  const panelEnd = main.indexOf("\nconst renderLimitCards = () =>", panelStart);
  const panel = main.slice(panelStart, panelEnd);
  assert.match(panel, /limitAccountsForDisplay\(\)/);
  assert.doesNotMatch(panel, /deduplicateQuotaAccountsForDisplay/);
});

test("deux comptes occupent la meme ligne dans deux colonnes", () => {
  assert.doesNotMatch(main, /class="limit-list-head"/);
  assert.doesNotMatch(main, /<span>État<\/span>/);
  assert.doesNotMatch(main, /class="limit-card-state"/);
  assert.match(
    main,
    /class="limit-card \$\{limitBadgeClass\(account\)\} \$\{hasFiveHourWindow/,
  );
  assert.doesNotMatch(main, /class="limit-card-meters"/);
  assert.match(
    style,
    /\.limit-card-grid \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/,
  );
  assert.match(
    style,
    /\.limit-card \{[^}]*grid-template-areas:\s*"identity updated"\s*"session weekly";/,
  );
  assert.match(style, /@media \(max-width: 980px\) \{[\s\S]*?\.limit-card-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/);
});

test("la colonne 5 h disparait quand aucune fenetre 5 h n'est exposee", () => {
  assert.match(
    main,
    /const hasFiveHourWindow = displayedAccounts\.some\(accountHasFiveHourWindow\);/,
  );
  assert.match(
    main,
    /const hasFiveHourWindow = accountHasFiveHourWindow\(account\);[\s\S]*?\? renderLimitMeter\("Fenêtre 5 h", "session",[\s\S]*?: ""/,
  );
  assert.match(main, /without-five-hour-window/);
  assert.match(
    style,
    /\.limit-card\.without-five-hour-window \{\s*grid-template-areas:\s*"identity updated"\s*"weekly weekly";/,
  );
});

test("le chargement des limites fait tourner son indicateur", () => {
  assert.match(main, /data-lucide="loader-circle" class="is-spinning"/);
  assert.match(
    style,
    /\.limit-cards-state svg\.is-spinning \{[^}]*animation: limits-state-spin 850ms linear infinite;[^}]*transform-origin: center;/,
  );
  assert.match(style, /@keyframes limits-state-spin \{\s*to \{ transform: rotate\(360deg\); \}\s*\}/);
});

test("la connexion Claude Code utilise son flux auth et pas codex login", () => {
  assert.match(main, /provider === "claude" \? "auth login" : "login"/);
  assert.match(settingsBackend, /login_command: Some\("auth login"\.to_string\(\)\)/);
  assert.match(settingsBackend, /status_command: Some\("auth status"\.to_string\(\)\)/);
  assert.doesNotMatch(main, /title="Ouvrir un terminal de connexion \(codex login\)/);
});

test("Limites lit les quotas Claude sans interroger le serveur de quotas Codex", () => {
  assert.match(settingsBackend, /pub provider: Provider,/);
  // Les quotas Claude viennent de l'endpoint OAuth du CLI, jamais d'un
  // `codex app-server` lance avec un home Claude.
  assert.match(
    settingsBackend,
    /const CLAUDE_USAGE_URL: &str = "https:\/\/api\.anthropic\.com\/api\/oauth\/usage";/,
  );
  assert.match(
    settingsBackend,
    /if has_tokens && account\.provider == Provider::Claude \{[\s\S]*?read_claude_rate_limits\(account, settings\)[\s\S]*?source = "claude-usage";/,
  );
  const claudeBranch = settingsBackend.slice(
    settingsBackend.indexOf("if has_tokens && account.provider == Provider::Claude {"),
    settingsBackend.indexOf("} else if has_tokens && account.provider == Provider::OpenCode {"),
  );
  assert.doesNotMatch(claudeBranch, /read_server_rate_limits/);
  assert.match(main, /account\.source === "claude-usage"/);
  assert.match(
    main,
    /const limitRowProvider = \(account: AccountLimitView\)[\s\S]*?accountById\(account\.id\)[\s\S]*?accountProvider\(configured\)/,
  );
  assert.match(main, /provider === "claude" \? "Claude" : provider === "opencode" \? "OpenCode" : "Codex"/);
});

test("une panne de lecture Claude n'efface pas la session du compte", () => {
  // Sans reseau la mesure manque, mais le compte reste connecte : seule
  // l'erreur remonte, pour que l'UI propose une reconnexion si le token est
  // reellement revoque.
  assert.match(
    settingsBackend,
    /Err\(message\) => \{[\s\S]*?source = "authenticated";\s*error = Some\(message\);/,
  );
  assert.match(main, /account\.source === "authenticated"/);
});

test("les jauges de quota s'affichent pour Codex et Claude, pas pour OpenCode", () => {
  assert.match(
    main,
    /const providerExposesQuotas = \(provider: Provider\): boolean =>\s*provider === "codex" \|\| provider === "claude";/,
  );
  assert.match(main, /!providerExposesQuotas\(provider\)[\s\S]*?limit-card-unavailable/);
  assert.match(
    main,
    /if \(!providerExposesQuotas\(limitRowProvider\(account\)\)\) return "connected";/,
  );
  // La carte Claude ne doit plus etre court-circuitee par un test de provider.
  assert.doesNotMatch(main, /provider !== "codex"[\s\S]{0,200}limit-card-unavailable/);
});

test("Claude participe au rafraichissement de quotas en arriere-plan", () => {
  assert.match(
    settingsBackend,
    /fn provider_reads_remote_limits\(provider: Provider\) -> bool \{\s*matches!\(provider, Provider::Codex \| Provider::Claude\)/,
  );
  assert.match(
    settingsBackend,
    /fn account_limits_need_remote_refresh[\s\S]*?provider_reads_remote_limits\(row\.provider\) && row\.has_tokens/,
  );
});

test("Limites marque aussi OpenCode connecte sans appeler les quotas Codex", () => {
  assert.match(
    settingsBackend,
    /account\.provider == Provider::OpenCode[\s\S]*?source = "authenticated";/,
  );
  assert.match(main, /account\.provider === "opencode"[\s\S]*?"opencode"/);
});
