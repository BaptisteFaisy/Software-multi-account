import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const worktree = readFileSync(
  new URL("../src-tauri/src/worktree.rs", import.meta.url),
  "utf8",
);

test("le lancement utilise le snapshot de home allege", () => {
  const beginStart = worktree.indexOf("fn begin(");
  const beginEnd = worktree.indexOf("struct PreparedWorkspace", beginStart);
  assert.ok(beginStart >= 0 && beginEnd > beginStart, "WorktreeManager::begin introuvable");
  const begin = worktree.slice(beginStart, beginEnd);

  assert.match(begin, /copy_home_snapshot\(canonical_home, &isolated_home,/);
  assert.doesNotMatch(begin, /copy_tree\(canonical_home, &isolated_home,/);
});

test("le snapshot ne recopie plus les donnees runtime volumineuses", () => {
  for (const directory of [
    "cache",
    "plugins",
    ".tmp",
    "archived_sessions",
    "sessions-archive",
  ]) {
    assert.ok(worktree.includes(`"${directory}"`), `exclusion manquante: ${directory}`);
  }
  assert.match(worktree, /normalized\.starts_with\("logs_"\)/);
  assert.match(worktree, /normalized\.ends_with\("\.log"\)/);
});

test("les binaires sandbox sont lies avec un repli en copie", () => {
  assert.match(worktree, /SHARED_IMMUTABLE_HOME_DIRS: &\[&str\] = &\["\.sandbox-bin"\]/);
  assert.match(worktree, /fs::hard_link\(&from, &to\)\.or_else\(\|_\| fs::copy/);
  assert.match(worktree, /isolated_home_skips_heavy_runtime_data_but_keeps_session_inputs/);
});
