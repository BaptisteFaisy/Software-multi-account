import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const access = readFileSync(
  new URL("../src-tauri/src/workspace_access.rs", import.meta.url),
  "utf8",
);
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("le navigateur de dossiers reste strictement dans la racine personnelle", () => {
  const start = access.indexOf("pub(crate) fn authorize_browse_path");
  const end = access.indexOf("/// Valide un chemin de travail", start);
  const implementation = access.slice(start, end);

  assert.match(implementation, /let personal_root = self\.personal_root\(identity\)\?/);
  assert.match(implementation, /requested\.starts_with\(&personal_root\)/);
  assert.match(implementation, /Err\(WorkspaceAccessError::not_found\(\)\)/);
  assert.doesNotMatch(implementation, /user_can_access|members|matching_environment/);
  assert.match(main, /await loadWorkspaceDir\(null\)/);
  assert.match(main, /workspaceId === browseRootId \|\| workspaceId\.startsWith/);
});

test("un compte cree un environnement directement dans son espace", () => {
  assert.match(
    server,
    /\.route\(\s*"\/workspaces",\s*get\(api_workspaces\)\.post\(api_create_workspace\),?\s*\)/,
  );
  assert.match(server, /\.create_environment\(&identity, &request\.name\)/);
  assert.match(access, /let personal_root = self\.personal_root\(identity\)\?/);
  assert.match(access, /let directory = personal_root\.join\(new_environment_directory_name\(&label\)\)/);
  assert.match(platform, /case "create_workspace":\s*return api<T>\("POST", "\/api\/workspaces", \{ name: args\.name \}\)/);
  assert.match(main, /id="createPersonalWorkspaceForm"/);
  assert.match(main, /openWorkspacePicker\("create"\)/);
  assert.match(main, /Créer un autre environnement/);
  assert.match(style, /\.ws-create-environment-form/);
});

test("un import GitHub exige un compte et rejoint uniquement son espace personnel", () => {
  const start = server.indexOf("async fn api_create_git_docker_environment");
  const end = server.indexOf("async fn api_delete_workspace", start);
  const implementation = server.slice(start, end);

  assert.match(implementation, /require_user_actor\(&state, &headers\)/);
  assert.match(implementation, /personal_root\(&identity\)/);
  assert.match(implementation, /claim_or_authorize_environment\(&identity/);
  assert.doesNotMatch(implementation, /RequestActor::Administrator|PROJECTS_DIRECTORY/);
  assert.match(main, /id="createWorkspaceFromGitHub"/);
  assert.match(main, /Créer un environnement depuis GitHub/);
  assert.match(style, /\.ws-create-github-option/);
});

test("un partage accepte ne devient pas une porte d'entree du navigateur", () => {
  assert.match(
    access,
    /authorize_existing_environment\(&guest,[\s\S]*?\.is_ok\(\)[\s\S]*?authorize_browse_path\(&guest,[\s\S]*?\.is_err\(\)/,
  );
});
