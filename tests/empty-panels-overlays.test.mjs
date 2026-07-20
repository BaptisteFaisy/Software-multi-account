import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const smoke = readFileSync(
  new URL("../scripts/smoke-overlays-responsive.mjs", import.meta.url),
  "utf8",
);

test("le navigateur de dossiers ne rend pas une liste vide pendant le chargement", () => {
  const start = main.indexOf("const renderWorkspaceModal =");
  const end = main.indexOf("const renderKombaiPanel =", start);
  const workspaceModal = main.slice(start, end);

  assert.ok(start >= 0 && end > start, "renderWorkspaceModal doit rester localisable");
  assert.match(
    workspaceModal,
    /\$\{list \|\| !workspaceBrowseLoading\s*\? `<div class="ws-list">\$\{list \|\| `<div class="empty">Aucun sous-dossier<\/div>`\}<\/div>`\s*: ""\}/,
  );
  assert.doesNotMatch(
    workspaceModal,
    /<div class="ws-list">\$\{list \|\| \(workspaceBrowseLoading \? ""/,
  );
});

test("la sonde overlays detecte les boites vides sans confondre les indicateurs", () => {
  assert.match(smoke, /const hasVisibleGlyph = \(candidate\) =>/);
  assert.match(smoke, /svg, img, canvas, video/);
  assert.match(smoke, /animationName !== "none"/);
  assert.match(smoke, /\(icon\|dot\|mark\|loader\|spinner\|shimmer\|indicator\|progress\)/);
  assert.match(smoke, /const emptyReservations =/);
  assert.match(smoke, /name: "workspace-browser-loading"/);
  assert.match(smoke, /diagnostic\.emptyReservations\.length/);
});
