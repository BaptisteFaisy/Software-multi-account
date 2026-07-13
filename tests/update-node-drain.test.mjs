import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const windowsUpdater = readFileSync(new URL("../scripts/update-node.ps1", import.meta.url), "utf8");
const linuxUpdater = readFileSync(new URL("../deploy/update-node.sh", import.meta.url), "utf8");
const frontendPublisher = readFileSync(
  new URL("../scripts/publish-local-frontend.ps1", import.meta.url),
  "utf8",
);
const localServerStarter = readFileSync(
  new URL("../scripts/start-local-server.ps1", import.meta.url),
  "utf8",
);

test("l'updater Windows annule le drain si le redemarrage n'a pas eu lieu", () => {
  const drainOn = windowsUpdater.indexOf("Set-DrainState -Draining $true");
  const armed = windowsUpdater.indexOf("$drainArmed = $true", drainOn);
  const cleanup = windowsUpdater.indexOf("finally {", armed);
  const drainOff = windowsUpdater.indexOf("Set-DrainState -Draining $false", cleanup);

  assert.ok(drainOn >= 0 && armed > drainOn, "le cleanup doit etre arme apres le drain");
  assert.ok(cleanup > armed && drainOff > cleanup, "le finally doit retirer le drain");
  assert.doesNotMatch(windowsUpdater, /laisse EN DRAIN/i);
});

test("l'updater Linux annule le drain sur erreur, timeout ou interruption", () => {
  const trap = linuxUpdater.indexOf("trap cleanup EXIT");
  const drainOn = linuxUpdater.indexOf("set_drain true", trap);
  const armed = linuxUpdater.indexOf("DRAIN_ARMED=1", drainOn);
  const restart = linuxUpdater.indexOf('systemctl restart "$SERVICE"', armed);
  const disarmed = linuxUpdater.indexOf("DRAIN_ARMED=0", restart);

  assert.ok(trap >= 0, "le cleanup EXIT doit etre installe");
  assert.ok(drainOn > trap && armed > drainOn, "le cleanup doit etre arme apres le drain");
  assert.ok(restart > armed && disarmed > restart, "le cleanup reste arme jusqu'au redemarrage");
  assert.match(linuxUpdater, /if set_drain false/);
  assert.doesNotMatch(linuxUpdater, /LAISSE EN DRAIN/i);
});

test("les updaters attendent sans drain puis utilisent une lease bornee", () => {
  const windowsWait = windowsUpdater.indexOf("Attente NON BLOQUANTE");
  const windowsDrain = windowsUpdater.indexOf("Set-DrainState -Draining $true", windowsWait);
  const linuxWait = linuxUpdater.indexOf("Attente NON BLOQUANTE");
  const linuxDrain = linuxUpdater.indexOf("set_drain true", linuxWait);

  assert.ok(windowsWait >= 0 && windowsDrain > windowsWait);
  assert.ok(linuxWait >= 0 && linuxDrain > linuxWait);
  assert.match(windowsUpdater, /ttlSeconds\s*=\s*if \(\$Draining\)/);
  assert.match(linuxUpdater, /ttlSeconds[^\r\n]*DRAIN_LEASE/);
  assert.match(windowsUpdater, /sans avoir draine ni bloque le noeud/);
  assert.match(linuxUpdater, /sans avoir draine ni bloque le noeud/);
});

test("les releases de developpement sont immuables et verifiees par commit", () => {
  assert.match(windowsUpdater, /\$releaseId = "\$version-\$safeCommit"/);
  assert.match(windowsUpdater, /-WantCommit \$commit/);
  assert.match(linuxUpdater, /RELEASE_ID="\$VERSION-\$SAFE_COMMIT"/);
  assert.match(linuxUpdater, /verify "\$VERSION" "\$COMMIT"/);
});

test("la publication frontend ne bloque jamais le serveur 8080", () => {
  const build = frontendPublisher.indexOf("npm run build:frontend");
  const lock = frontendPublisher.indexOf("$mutex.WaitOne", build);
  const copy = frontendPublisher.indexOf("Copy-TreeEntry -Source", lock);
  const replace = frontendPublisher.indexOf("[IO.File]::Replace", copy);
  const prune = frontendPublisher.indexOf("$staleCount = Remove-StaleTreeEntries", replace);
  const unlock = frontendPublisher.indexOf("$mutex.ReleaseMutex()", prune);
  const verify = frontendPublisher.indexOf("Invoke-WebRequest", unlock);

  assert.ok(build >= 0 && lock > build, "le build doit rester hors mutex");
  assert.ok(copy > lock && replace > copy, "les assets doivent preceder l'index atomique");
  assert.ok(prune > replace && unlock > prune, "les anciens assets doivent etre retires avant le deverrouillage");
  assert.ok(verify > unlock, "la verification HTTP doit etre hors mutex");
  assert.doesNotMatch(frontendPublisher, /Set-DrainState|Stop-ScheduledTask|Stop-Process/);
});

test("les anciennes releases web/app sont purgees seulement apres verification", () => {
  const windowsVerify = windowsUpdater.indexOf("if (Test-NodeBack -WantVersion $version -WantCommit $commit)");
  const windowsPrune = windowsUpdater.indexOf("Remove-ObsoleteLocalReleases -Keep $releaseDir", windowsVerify);
  const linuxVerify = linuxUpdater.indexOf('if verify "$VERSION" "$COMMIT"');
  const linuxPrune = linuxUpdater.indexOf('prune_obsolete_releases "$RELEASE_DIR"', linuxVerify);

  assert.ok(windowsVerify >= 0 && windowsPrune > windowsVerify);
  assert.ok(linuxVerify >= 0 && linuxPrune > linuxVerify);
  assert.match(windowsUpdater, /\.update-in-progress/);
  assert.match(windowsUpdater, /Test-ReleaseUpdateInProgress/);
  assert.match(linuxUpdater, /\.update-in-progress/);
  assert.match(linuxUpdater, /release_update_in_progress/);
});

test("le serveur local refuse de republier un checkout connu comme obsolete", () => {
  const guard = localServerStarter.indexOf("Assert-CheckoutIsNotStale");
  const guardCall = localServerStarter.indexOf("Assert-CheckoutIsNotStale", guard + 1);
  const firstMutation = localServerStarter.indexOf("New-Item", guardCall);
  const launch = localServerStarter.indexOf("& $ServerExe", firstMutation);

  assert.ok(guard >= 0 && guardCall > guard, "le garde doit etre defini puis appele");
  assert.ok(firstMutation > guardCall, "le garde doit preceder toute preparation locale");
  assert.ok(launch > firstMutation, "le lancement doit rester apres le garde");
  assert.match(localServerStarter, /merge-base --is-ancestor \$head \$originMain/);
  assert.match(localServerStarter, /git pull --ff-only origin main/);
});
