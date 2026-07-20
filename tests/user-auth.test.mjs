import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = readFileSync(new URL("../src-tauri/src/auth.rs", import.meta.url), "utf8");
const server = readFileSync(new URL("../src-tauri/src/server.rs", import.meta.url), "utf8");
const frontend = readFileSync(new URL("../src/user-auth.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("les comptes locaux utilisent Argon2 et des sessions non stockees en clair", () => {
  assert.match(backend, /Argon2::default\(\)[\s\S]*?\.hash_password/);
  assert.match(backend, /token_hash: hash_token\(&token\)/);
  assert.match(backend, /HttpOnly; SameSite=Lax; Max-Age=/);
  assert.match(backend, /SESSION_DURATION_SECS: i64 = 30 \* 24 \* 60 \* 60/);
});

test("le flux Google verifie state, PKCE et l'adresse e-mail", () => {
  assert.match(backend, /code_challenge_method", "S256"/);
  assert.match(backend, /OAUTH_STATE_COOKIE/);
  assert.match(backend, /openid email profile/);
  assert.match(backend, /google_user\.email_verified/);
  assert.match(backend, /https:\/\/openidconnect\.googleapis\.com\/v1\/userinfo/);
  assert.match(backend, /google_login_url: Option<String>/);
  assert.match(frontend, /href="\$\{escapeAttr\(googleLoginUrl\(\)\)\}"/);
});

test("les routes d'authentification et le profil sont exposes", () => {
  assert.match(backend, /\.route\("\/register", post\(api_register\)\)/);
  assert.match(backend, /\.route\("\/login", post\(api_login\)\)/);
  assert.match(backend, /\.route\("\/profile", put\(api_update_profile\)\)/);
  assert.match(server, /\.nest\("\/api\/auth", auth::router\(user_auth\)\)/);
  assert.match(backend, /mot de passe actuel est requis/);
});

test("l'interface bloque l'application jusqu'a la connexion puis expose le profil", () => {
  assert.match(frontend, /Créer votre compte/);
  assert.match(frontend, /Continuer avec Google/);
  assert.match(frontend, /id="userProfileForm"/);
  assert.match(main, /renderUserAuthGate\(app, boot\)/);
  assert.match(main, /renderUserAccountButton\(\)/);
  assert.match(main, /renderUserProfileModal\(\)/);
  assert.match(platform, /credentials: "include"/);
});

test("une erreur Failed to fetch propose une reparation automatique", () => {
  assert.match(main, /id="remoteRepairConnection"/);
  assert.match(frontend, /id="accountAuthRepairConnection"/);
  assert.match(main, /Reparer la connexion/);
  assert.match(frontend, /Reparer la connexion/);
  assert.match(main, /await repairRemoteConnection\(\)/);
  assert.match(frontend, /await repairRemoteConnection\(\)/);
  assert.match(frontend, /const state = await initializeUserAuth\(\)/);
  assert.match(main, /if \(isRemoteMode\(\)\) \{\s*renderRemoteLogin\(String\(error\)\)/);
  assert.match(platform, /localStorage\.setItem\(REMOTE_BASE_URL_KEY, baseUrl\)/);
  assert.match(platform, /fetch\(`\$\{baseUrl\}\/api\/health`/);
  assert.match(platform, /key\.startsWith\("codex-terminal-static-"\)/);
  assert.match(styles, /\.remote-login-repair/);
  assert.match(styles, /\.account-auth-repair/);
});

test("l'inscription reste accessible dans une petite fenetre", () => {
  assert.match(
    styles,
    /\.account-auth\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*align-items:\s*safe center;[^}]*overflow-y:\s*auto;/,
  );
  assert.match(styles, /@media \(max-height: 900px\)/);
  assert.match(
    styles,
    /@media \(max-height: 560px\) and \(min-width: 560px\)[\s\S]*?\.account-auth-form\[data-mode="register"\]\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
  );
});
