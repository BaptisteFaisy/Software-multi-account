import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const account = readFileSync(
  new URL("../scripts/google-cloud-account.ps1", import.meta.url),
  "utf8",
);
const installer = readFileSync(
  new URL("../scripts/install-gcloud-cli.sh", import.meta.url),
  "utf8",
);
const browserBridge = readFileSync(
  new URL("../scripts/open-windows-browser-from-wsl.sh", import.meta.url),
  "utf8",
);
const provisioner = readFileSync(
  new URL("../scripts/provision-google-trial.ps1", import.meta.url),
  "utf8",
);
const watcher = readFileSync(
  new URL("../scripts/watch-google-billing-and-provision.ps1", import.meta.url),
  "utf8",
);
const scheduler = readFileSync(
  new URL("../scripts/enable-google-autoprovision.ps1", import.meta.url),
  "utf8",
);

test("la connexion installe le CLI officiel et delegue OAuth au navigateur Google", () => {
  assert.match(installer, /https:\/\/dl\.google\.com\/dl\/cloudsdk\/channels\/rapid\/downloads\/google-cloud-cli-linux-/);
  assert.match(account, /Install-Gcloud/);
  assert.match(account, /gcloud auth login --force/);
  assert.match(account, /BROWSER=\$browser/);
  assert.match(browserBridge, /rundll32\.exe/);
  assert.match(browserBridge, /url\.dll,FileProtocolHandler "\$url"/);
});

test("le parcours ne recoit ni mot de passe Google ni carte bancaire", () => {
  assert.match(account, /https:\/\/console\.cloud\.google\.com\/freetrial/);
  assert.doesNotMatch(account, /client_secret|card_number|credit_card|cvv|password/i);
  assert.doesNotMatch(provisioner, /client_secret|card_number|credit_card|cvv|password/i);
});

test("le provisionneur cree un projet CST dedie et exige une facturation active", () => {
  assert.match(account, /labels\.cst-managed=true/);
  assert.match(provisioner, /billing", "accounts", "list", "--filter=open=true"/);
  assert.match(provisioner, /if \(\$billingRows\.Count -ne 1\)/);
  assert.match(provisioner, /cst-trial-\$\(\[guid\]::NewGuid/);
  assert.match(provisioner, /--labels=cst-managed=true,cst-stack=google-trial/);
  assert.match(provisioner, /labels\.cst-managed=true/);
  assert.match(provisioner, /"projects", "describe", \$ProjectId/);
  assert.match(provisioner, /Le projet existe mais n'est pas gere par CST/);
});

test("la VM reste en Europe et n'expose que SSH depuis l'IPv4 courante", () => {
  assert.match(provisioner, /\[ValidateSet\("europe-west1"\)\]/);
  assert.match(provisioner, /\[ValidateSet\("e2-standard-2"\)\]/);
  assert.match(provisioner, /return "\$value\/32"/);
  assert.match(provisioner, /--rules=tcp:22/);
  assert.match(provisioner, /--source-ranges=\$AllowedSshCidr/);
  assert.match(provisioner, /--no-service-account", "--no-scopes/);
  assert.match(provisioner, /"compute", "networks", "delete", "default"/);
  assert.match(provisioner, /"compute", "firewall-rules", "delete"/);
  assert.match(provisioner, /\/networks\/default\$/);
  assert.match(provisioner, /--format=json", "--verbosity=error/);
  assert.match(provisioner, /--termination-time=\$TerminationTime/);
  assert.match(provisioner, /--instance-termination-action=DELETE/);
  assert.match(provisioner, /\[ValidateRange\(1, 80\)\][\s\S]*?\$ExpirationDays = 75/);
  assert.match(provisioner, /ubuntu-2404-lts-amd64/);
});

test("la cle SSH et le runtime portable sont prepares automatiquement", () => {
  assert.match(provisioner, /ssh-keygen -q -t ed25519/);
  assert.match(provisioner, /deploy-vps-ansible\.ps1/);
  assert.match(provisioner, /Wait-CloudInit/);
  assert.match(provisioner, /SkipAccountSeed/);
});

test("une tache locale termine tout automatiquement apres validation de la carte", () => {
  assert.match(watcher, /if \(-not \$google\.billingReady\)/);
  assert.match(watcher, /-File \$ProvisionScript -Apply -Deploy/);
  assert.match(watcher, /google-trial\.json/);
  assert.match(watcher, /Disable-ScheduledTask/);
  assert.match(watcher, /Local\\CST-Google-Trial-Autoprovision/);
  assert.match(scheduler, /-MultipleInstances IgnoreNew/);
  assert.match(scheduler, /-RepetitionInterval \(New-TimeSpan -Minutes \$IntervalMinutes\)/);
  assert.match(scheduler, /-LogonType Interactive/);
});
