import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const preflight = readFileSync(
  new URL("../scripts/check-vps-ready.ps1", import.meta.url),
  "utf8",
);
const guide = readFileSync(new URL("../docs/free-vps.md", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("le precontrole VPS reste en lecture seule et verifie la cible Linux", () => {
  assert.match(preflight, /BatchMode=yes/);
  assert.match(preflight, /StrictHostKeyChecking=accept-new/);
  assert.match(preflight, /StrictHostKeyChecking=yes/);
  assert.match(preflight, /sudo -n true/);
  assert.match(preflight, /command -v apt-get/);
  assert.match(preflight, /command -v systemctl/);
  assert.match(preflight, /x86_64\|amd64\|aarch64\|arm64/);
  assert.match(preflight, /MemTotal/);
  assert.match(preflight, /SwapTotal/);
  assert.match(preflight, /df -Pk \//);
  assert.doesNotMatch(preflight, /apt-get (?:install|update)|systemctl (?:enable|start)|curl /);
});

test("le setup gratuit recommande OCI A1 sans publier le port applicatif", () => {
  assert.match(guide, /2 OCPU Arm et 12 Go de RAM/);
  assert.match(guide, /VM\.Standard\.A1\.Flex/);
  assert.match(guide, /-Capacity 2/);
  assert.match(guide, /-SkipAccountSeed/);
  assert.match(guide, /Port 8080 \| Ne pas l'ouvrir/);
  assert.match(guide, /127\.0\.0\.1:8080/);
  assert.match(guide, /Google Cloud Free Tier/);
  assert.match(guide, /services gratuits Azure/);
  assert.match(guide, /nouveau Free Tier AWS/);
});

test("npm et le README exposent le precontrole et le guide", () => {
  assert.match(packageJson.scripts["check:vps"], /check-vps-ready\.ps1/);
  assert.match(readme, /docs\/free-vps\.md/);
});
