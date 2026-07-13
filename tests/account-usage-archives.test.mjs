import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const usage = readFileSync(
  new URL("../src-tauri/src/account_usage.rs", import.meta.url),
  "utf8",
);
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("les statistiques incluent les sessions Codex actives et archivées", () => {
  assert.match(
    usage,
    /SESSION_STORAGE_DIRS:\s*&\[&str\]\s*=\s*&\[\s*"sessions",\s*"sessions-archive",\s*"archived_sessions"\s*\]/,
  );
  assert.match(usage, /let files = collect_account_rollouts\(&home\);/);
  assert.match(main, /sessions Codex actives et archivées/);
});

test("une session copiée dans les archives n'est comptée qu'une fois", () => {
  assert.match(usage, /let mut seen = HashSet::new\(\);/);
  assert.match(usage, /if seen\.insert\(name\) \{\s*files\.push\(path\);/);
  assert.match(usage, /fn account_rollouts_include_archives_without_duplicates\(\)/);
});
