import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const discussions = readFileSync(new URL("../src-tauri/src/discussions.rs", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");

test("un chat peut etre renomme depuis les discussions et la barre laterale", () => {
  assert.match(main, /data-rename-session=/);
  assert.match(main, /class="chat-side-rename"/);
  assert.match(main, /invoke<DiscussionSummary>\("rename_discussion"/);
  assert.match(main, /laissez vide pour restaurer le titre automatique/);
});

test("le renommage distant est route et le titre est conserve hors transcript", () => {
  assert.match(platform, /case "rename_discussion":/);
  assert.match(platform, /\/api\/discussions\/rename/);
  assert.match(server, /\.route\("\/discussions\/rename", post\(api_rename_discussion\)\)/);
  assert.match(discussions, /const CUSTOM_TITLES_FILE: &str = "\.cst-discussion-titles\.json"/);
  assert.match(discussions, /atomic_write\(&custom_titles_path\(&home\), serialized\)/);
  assert.match(discussions, /apply_custom_titles\(&home, &mut discussions\)/);
});
