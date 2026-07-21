import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");
const settingsBackend = readFileSync(new URL("../src-tauri/src/settings.rs", import.meta.url), "utf8");

const terminalStart = main.slice(
  main.indexOf("const createNewTerminalOnce ="),
  main.indexOf("const createNewTerminal =", main.indexOf("const createNewTerminalOnce =")),
);
const apiStartTerminal = server.slice(
  server.indexOf("async fn api_start_terminal("),
  server.indexOf("fn normalize_source_chat_key", server.indexOf("async fn api_start_terminal(")),
);
const apiGetSettings = server.slice(
  server.indexOf("async fn api_get_settings("),
  server.indexOf("async fn api_put_settings(", server.indexOf("async fn api_get_settings(")),
);
const addAccountAndLogin = main.slice(
  main.indexOf("const addAccountAndLogin ="),
  main.indexOf("const addAccountFromFolder =", main.indexOf("const addAccountAndLogin =")),
);
const addSharedAccount = settingsBackend.slice(
  settingsBackend.indexOf("pub fn add_shared_account("),
  settingsBackend.indexOf("pub fn remove_account(", settingsBackend.indexOf("pub fn add_shared_account(")),
);

test("les comptes restent globaux dans les reglages renvoyes aux utilisateurs", () => {
  assert.match(apiGetSettings, /settings::load_settings\(\)/);
  assert.match(apiGetSettings, /value\.workspaces = workspaces;/);
  assert.match(apiGetSettings, /value\.closed_workspace_ids = closed_workspace_ids;/);
  assert.doesNotMatch(apiGetSettings, /value\.accounts\s*=/);
});

test("un login partage ne sauvegarde pas la vue personnelle des workspaces", () => {
  assert.match(
    terminalStart,
    /if \(!loginOnly\) \{\s*try \{\s*settings = await invoke<AppSettings>\("save_settings"/,
  );
  assert.match(
    terminalStart,
    /const savedAccount = settings\.accounts\.find\(\(candidate\) => candidate\.id === account\.id\)/,
  );
});

test("le backend ne demande aucune racine personnelle pour un terminal de login", () => {
  assert.match(
    apiStartTerminal,
    /let authorized_workspace = if request\.login_only \{\s*None/,
  );
  assert.match(
    apiStartTerminal,
    /let generated_workspaces_root = if request\.login_only \{\s*state\.config\.data_dir\.join\("workspaces"\)/,
  );
  assert.match(
    apiStartTerminal,
    /if !login_only \{[\s\S]*?claim_or_authorize_environment/,
  );
});

test("la creation distante ajoute uniquement un compte au registre partage", () => {
  assert.match(
    addAccountAndLogin,
    /const sharedAccountSettings = await invoke<AppSettings>\("add_shared_account", \{ account \}\)/,
  );
  assert.match(addAccountAndLogin, /settings\.accounts = sharedAccountSettings\.accounts;/);
  assert.doesNotMatch(
    addAccountAndLogin,
    /settings = await invoke<AppSettings>\("add_shared_account"/,
  );
  assert.match(
    platform,
    /case "add_shared_account":\s*return api<T>\("POST", "\/api\/accounts", args\.account/,
  );
  assert.match(
    server,
    /\.route\(\s*"\/accounts",\s*get\(api_get_accounts\)\.post\(api_add_shared_account\),?\s*\)/,
  );
  assert.match(server, /settings::add_shared_account\(account\)\.map\(json_response\)/);
});

test("l'ajout partage ne modifie aucun workspace personnel", () => {
  assert.match(addSharedAccount, /let mut settings = load_settings\(\)\?/);
  assert.match(addSharedAccount, /settings\.accounts\.push\(account\);/);
  assert.doesNotMatch(addSharedAccount, /settings\.workspaces/);
  assert.doesNotMatch(addSharedAccount, /workspace_access/);
});
