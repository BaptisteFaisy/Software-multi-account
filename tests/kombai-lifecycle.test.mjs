import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");

test("fermer un navigateur distant n'arrete jamais le Kombai partage", () => {
  const beforeUnload = main.match(
    /window\.addEventListener\("beforeunload", \(\) => \{([\s\S]*?)\n\}\);/,
  )?.[1];

  assert.ok(beforeUnload, "gestionnaire beforeunload introuvable");
  assert.match(
    beforeUnload,
    /if \(!isRemoteMode\(\) && \(kombaiStatus\?\.running \|\| kombaiStatus\?\.started\)\) \{\s*void invoke\("kombai_stop"\)/,
  );
  assert.doesNotMatch(
    beforeUnload.replace(/if \(!isRemoteMode\(\)[\s\S]*?\n  \}/, ""),
    /invoke\("kombai_stop"\)/,
  );
});
