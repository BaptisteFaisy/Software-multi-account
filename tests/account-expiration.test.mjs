import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const settingsBackend = readFileSync(
  new URL("../src-tauri/src/settings.rs", import.meta.url),
  "utf8",
);

test("les nouveaux comptes recoivent une echeance de premiere connexion de 10 minutes", () => {
  assert.match(main, /createdAt: Math\.floor\(Date\.now\(\) \/ 1_000\)/);
  assert.match(main, /const UNCONNECTED_ACCOUNT_EXPIRY_MS = 10 \* 60 \* 1_000;/);
  assert.match(main, /const scheduleUnconnectedAccountCleanup =/);
  assert.match(main, /invoke<AppSettings>\("load_settings"\)/);
  assert.match(main, /aucune connexion dans les 10 minutes/);
});

test("le backend purge a l'ouverture comme a la sauvegarde sans toucher aux anciens comptes", () => {
  assert.match(settingsBackend, /pub created_at: Option<i64>,/);
  assert.match(settingsBackend, /const UNCONNECTED_ACCOUNT_EXPIRY_SECS: i64 = 10 \* 60;/);
  assert.match(
    settingsBackend,
    /fn remove_expired_unconnected_accounts[\s\S]*?match account\.created_at[\s\S]*?Some\(created_at\)[\s\S]*?None => tombstoned_homes/,
  );
  assert.ok(
    (settingsBackend.match(/remove_expired_unconnected_accounts\(&mut settings,/g) ?? [])
      .length >= 2,
  );
});

test("un home expire ne reapparait pas par auto-detection et ses fichiers sont conserves", () => {
  assert.match(settingsBackend, /pub expired_unconnected_account_homes: Vec<String>,/);
  assert.match(settingsBackend, /if expired_homes\.contains\(&normalized\)/);
  assert.match(settingsBackend, /if Provider::Codex\.has_auth\(&path, None\)/);
  const cleanupStart = settingsBackend.indexOf("fn remove_expired_unconnected_accounts");
  const cleanupEnd = settingsBackend.indexOf(
    "fn clear_expired_home_tombstones_for_registered_accounts",
    cleanupStart,
  );
  assert.ok(cleanupStart >= 0 && cleanupEnd > cleanupStart);
  assert.doesNotMatch(settingsBackend.slice(cleanupStart, cleanupEnd), /fs::remove_dir_all/);
});
