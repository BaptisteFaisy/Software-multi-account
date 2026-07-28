import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const settings = readFileSync(
  new URL("../src-tauri/src/settings.rs", import.meta.url),
  "utf8",
);
const provider = readFileSync(
  new URL("../src-tauri/src/provider.rs", import.meta.url),
  "utf8",
);

test("Fast mode reste desactive par defaut et traverse desktop comme VPS", () => {
  assert.match(settings, /#\[serde\(default\)\]\s+pub fast_mode: bool/);
  assert.match(main, /let poolNewAccountFastMode = false/);
  assert.match(main, /let newTerminalAccountFastMode = false/);
  assert.match(main, /fastMode:\s+accountFastModeEnabled\(account\)/);
  assert.match(platform, /fastMode: args\.fastMode \?\? false/);
  assert.match(settings, /fast_mode\.unwrap_or\(false\)/);
});

test("Codex active priority et revient reellement au mode normal", () => {
  assert.match(
    settings,
    /if fast_mode \{\s+upsert_top_level_string\(&updated, "service_tier", "priority"\)/,
  );
  assert.match(settings, /remove_top_level_key\(&updated, "service_tier"\)/);
  assert.match(settings, /fn remove_top_level_key\(content: &str, key: &str\)/);
});

test("Claude ecrit fastMode true et retire la cle a la desactivation", () => {
  assert.match(provider, /obj\.insert\("fastMode"\.to_string\(\), Value::Bool\(true\)\)/);
  assert.match(provider, /obj\.remove\("fastMode"\)/);
});

test("les controles par compte et par chat respectent la compatibilite du modele", () => {
  assert.match(main, /CODEX_FAST_MODE_FALLBACK_MODELS/);
  assert.match(main, /catalogModel\.supportsFastMode/);
  assert.match(main, /model\.toLocaleLowerCase\(\)\.includes\("opus"\)/);
  assert.match(main, /data-account-fast-mode=/);
  assert.match(view, /data-chat-control="fast-mode"/);
  assert.match(view, /!model\.supportsFastMode/);
});

test("le catalogue Codex conserve la capacite Fast officielle", () => {
  assert.match(settings, /pub supports_fast_mode: bool/);
  assert.match(settings, /get\("serviceTiers"\)/);
  assert.match(settings, /eq_ignore_ascii_case\("priority"\)/);
  assert.match(settings, /get\("additionalSpeedTiers"\)/);
  assert.match(settings, /eq_ignore_ascii_case\("fast"\)/);
});
