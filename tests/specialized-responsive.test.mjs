import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const forumStyle = readFileSync(new URL("../src/forum.css", import.meta.url), "utf8");
const videoStyle = readFileSync(new URL("../src/video.css", import.meta.url), "utf8");
const smoke = readFileSync(
  new URL("../scripts/smoke-admin-responsive.mjs", import.meta.url),
  "utf8",
);

test("la coque mobile réserve aussi les zones sûres latérales", () => {
  assert.match(
    style,
    /\.chat-app-layout \{[^}]*padding-right: env\(safe-area-inset-right\) !important;[^}]*padding-left: env\(safe-area-inset-left\) !important;/s,
  );
  assert.match(
    style,
    /\.m-bottomnav \{[^}]*padding-right: env\(safe-area-inset-right\);[^}]*padding-left: env\(safe-area-inset-left\);/s,
  );
  assert.match(
    style,
    /\.m-topbar \{[^}]*padding: env\(safe-area-inset-top\) max\(8px, env\(safe-area-inset-right\)\) 0\s+max\(8px, env\(safe-area-inset-left\)\);/s,
  );
});

test("le détail Forum partage un seul défilement en faible hauteur", () => {
  assert.match(
    forumStyle,
    /@media \(max-width: 860px\) and \(max-height: 700px\) \{[\s\S]*?\.forum-detail \{[^}]*overflow-y: auto;[^}]*overscroll-behavior-y: contain;[\s\S]*?\.forum-thread \{[^}]*display: block;[^}]*min-height: 100%;[\s\S]*?\.forum-thread-feed \{[^}]*overflow: visible;/,
  );
});

test("la modale de comptes créatifs reste dans la hauteur et les encoches utiles", () => {
  assert.match(
    videoStyle,
    /\.creative-account-overlay \{[^}]*padding:[^;]*safe-area-inset-top[^;]*safe-area-inset-right[^;]*safe-area-inset-bottom[^;]*safe-area-inset-left[^;]*;/s,
  );
  assert.match(
    videoStyle,
    /\.creative-account-modal \{[^}]*max-height:[^;]*100dvh[^;]*safe-area-inset-top[^;]*safe-area-inset-bottom[^;]*;/s,
  );
  assert.match(
    videoStyle,
    /@media \(max-width: 760px\) \{[\s\S]*?\.creative-account-overlay \{[^}]*padding:[^;]*safe-area-inset-top[^;]*safe-area-inset-right[^;]*safe-area-inset-bottom[^;]*safe-area-inset-left[^;]*;/,
  );
});

test("le smoke spécialisé couvre les cinq états avec clavier et zones sûres", () => {
  for (const state of [
    "forum-detail",
    "forum-compose",
    "prompt-editor",
    "vps-options",
    "creative-accounts",
  ]) assert.match(smoke, new RegExp(`name: "${state}"`));

  assert.match(smoke, /CST_ADMIN_SPECIALIZED_STATES/);
  assert.match(smoke, /CST_ADMIN_STATES/);
  assert.match(smoke, /name: "keyboard-portrait"/);
  assert.match(smoke, /name: "keyboard-landscape"/);
  assert.match(smoke, /Emulation\.setSafeAreaInsetsOverride/);
  assert.match(smoke, /requiredControls/);
  assert.match(smoke, /unsafeHorizontalContent/);
  assert.match(smoke, /scrollRegions/);
});
