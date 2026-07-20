import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractLocalAssetUrls,
  redactGitDiagnostic,
  sha256,
} from "../scripts/verify-published-build.mjs";
import { autonomousAgentTemplateById } from "../src/chat/autonomous.ts";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const verifier = readFileSync(
  new URL("../scripts/verify-published-build.mjs", import.meta.url),
  "utf8",
);

test("le publieur utilise la preuve Git et web comme validation finale", () => {
  const publisher = autonomousAgentTemplateById("build_publisher");

  assert.equal(publisher?.triggerKind, "workspace_change");
  assert.equal(publisher?.allowGitPublish, true);
  assert.equal(publisher?.testCommand, "npm run verify:published-build");
  assert.equal(
    packageJson.scripts["verify:published-build"],
    "node scripts/verify-published-build.mjs",
  );
  assert.match(verifier, /ls-remote/);
  assert.match(verifier, /refs\/heads/);
  assert.match(verifier, /\/healthz/);
  assert.match(verifier, /resolve\(distDir, "index\.html"\)/);
  assert.match(verifier, /sha256\(localAsset\).*sha256\(servedAsset\)/s);
});

test("la preuve du site controle uniquement les assets locaux references", () => {
  const urls = extractLocalAssetUrls(`
    <link href="/assets/app.css" rel="stylesheet">
    <script src="./assets/app.js"></script>
    <script src="https://cdn.example.net/vendor.js"></script>
    <img src="data:image/png;base64,AAAA">
    <a href="#section">section</a>
    <script src="./assets/app.js"></script>
  `, "http://127.0.0.1:8080/?build=abc");

  assert.deepEqual(
    urls.map((url) => url.href),
    [
      "http://127.0.0.1:8080/assets/app.css",
      "http://127.0.0.1:8080/assets/app.js",
    ],
  );
  assert.equal(
    sha256(Buffer.from("build actif")),
    "53b0c926d24a1d1e09bd1eb97bdd2adc431adc857968ef1e589321429fe4f2f4",
  );
  assert.equal(
    redactGitDiagnostic("fatal: https://user:ghp_abcd1234@example.invalid token=secret-value"),
    "fatal: https://[identifiants masques]@example.invalid token=[secret masque]",
  );
});
