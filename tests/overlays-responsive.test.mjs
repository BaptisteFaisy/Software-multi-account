import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const smoke = readFileSync(
  new URL("../scripts/smoke-overlays-responsive.mjs", import.meta.url),
  "utf8",
);

test("les overlays mobiles reservent les zones sures sur chaque bord", () => {
  assert.match(
    style,
    /\.m-sheet-panel \{[^}]*padding-right: max\(14px, env\(safe-area-inset-right\)\);[^}]*padding-left: max\(14px, env\(safe-area-inset-left\)\);/s,
  );
  assert.match(
    style,
    /\.modal \{[^}]*padding-top: calc\(12px \+ env\(safe-area-inset-top\)\);[^}]*padding-right: env\(safe-area-inset-right\);[^}]*padding-bottom: calc\(12px \+ env\(safe-area-inset-bottom\)\);[^}]*padding-left: env\(safe-area-inset-left\);/s,
  );
  assert.match(
    style,
    /\.terminal-environment-menu-backdrop \{[^}]*align-items: center !important;[^}]*padding:[^;]*safe-area-inset-top[^;]*safe-area-inset-right[^;]*safe-area-inset-bottom[^;]*safe-area-inset-left[^;]*!important;/s,
  );
  assert.match(
    style,
    /\.chat-app-layout \.chat-app-sidebar \{[^}]*padding:[^;]*safe-area-inset-top[^;]*safe-area-inset-right[^;]*safe-area-inset-bottom[^;]*safe-area-inset-left[^;]*;/s,
  );
  assert.match(
    style,
    /\.chat-app-layout \.chat-app-sidebar \{[^}]*scroll-padding-top: max\(12px, env\(safe-area-inset-top\)\);[^}]*scroll-padding-bottom: max\(12px, env\(safe-area-inset-bottom\)\);/s,
  );
  assert.match(
    style,
    /\.autonomous-monitor-window \{[^}]*right: env\(safe-area-inset-right\);[^}]*left: env\(safe-area-inset-left\);[^}]*width: auto;/s,
  );
  assert.match(
    style,
    /@media \(max-width: 860px\) \{\s*\.user-profile-modal \{[^}]*padding:[^;]*safe-area-inset-top[^;]*safe-area-inset-right[^;]*safe-area-inset-bottom[^;]*safe-area-inset-left[^;]*;/s,
  );
  assert.match(
    style,
    /@media \(max-height: 700px\) \{[\s\S]*?\.chat-app-layout \.chat-app-sidebar::after \{[^}]*content: "";[^}]*flex: 0 0 calc\(env\(safe-area-inset-bottom\) \+ 16px\);/,
  );
});

test("le smoke overlays emule encoches, clavier et defilement accessible", () => {
  assert.equal([...smoke.matchAll(/safeArea: \{/g)].length, 5);
  assert.match(smoke, /Emulation\.setSafeAreaInsetsOverride/);
  assert.match(smoke, /name: "keyboard-portrait"/);
  assert.match(smoke, /name: "keyboard-landscape"/);
  assert.match(smoke, /name: "mobile-sheet"/);
  assert.match(smoke, /#chatAppSidebar[\s\S]*?getBoundingClientRect\(\)\.left/);
  assert.match(smoke, /scrollIntoView\(\{ block: "center", inline: "center" \}\)/);
  assert.match(smoke, /for \(let attempt = 1; attempt <= 2/);
});
