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
const updateRuntimeHarness = readFileSync(
  new URL("../scripts/test-update-node-runtime.mjs", import.meta.url),
  "utf8",
);
const linuxConcurrencyHarness = readFileSync(
  new URL("../scripts/test-update-node-linux-concurrency-runtime.sh", import.meta.url),
  "utf8",
);
const linuxRuntimeHarness = readFileSync(
  new URL("../scripts/test-update-node-linux-runtime.sh", import.meta.url),
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

test("l'updater Windows arrete le serveur enfant sans toucher les copies portables", () => {
  const stopTask = windowsUpdater.indexOf("Stop-ScheduledTask -TaskName $TaskName");
  const stopChild = windowsUpdater.indexOf("Stop-NodeProcesses", stopTask);
  const waitForStop = windowsUpdater.indexOf("$stopDeadline", stopTask);

  assert.ok(stopTask >= 0 && waitForStop > stopTask && stopChild > waitForStop);
  assert.match(windowsUpdater, /GetFullPath\(\$NodeHome\)/);
  assert.match(windowsUpdater, /StartsWith\(\$trustedRoot, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(windowsUpdater, /Stop-Process -Id \(\[int\]\$process\.ProcessId\) -Force/);
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

test("l'updater Windows attend aussi les tours de chat actifs", () => {
  assert.match(windowsUpdater, /function Get-ActiveWorkloadCount/);
  assert.match(windowsUpdater, /\/api\/chat\/turns\/active/);
  assert.match(windowsUpdater, /Get-ActiveWorkloadCount -Health \$h/g);
  assert.match(windowsUpdater, /mise a jour annulee sans redemarrage/);
  assert.match(updateRuntimeHarness, /wait-active-chat-turn/);
  assert.match(updateRuntimeHarness, /active-chat-drain/);
});

test("l'updater Windows echoue ferme si l'API des tours de chat est degradee", () => {
  assert.match(windowsUpdater, /\$chatTurns -isnot \[Array\]/);
  assert.match(windowsUpdater, /Reponse invalide pour les tours de chat actifs/);
  assert.match(updateRuntimeHarness, /chat-api-unavailable/);
  assert.match(updateRuntimeHarness, /chat-api-malformed/);
  assert.match(updateRuntimeHarness, /aucun drain ne doit etre arme/);
  assert.match(updateRuntimeHarness, /aucun redemarrage ne doit etre demande/);
  assert.match(updateRuntimeHarness, /current ne doit pas basculer/);
});

test("l'updater Linux attend aussi les tours de chat actifs", () => {
  assert.match(linuxUpdater, /active_chat_turn_count/);
  assert.match(linuxUpdater, /\/api\/chat\/turns\/active/);
  assert.match(linuxUpdater, /Authorization: Bearer \$ADMIN_TOKEN/);
  assert.equal(linuxUpdater.match(/active_workload_count "\$hz"/g)?.length, 3);
  assert.match(linuxUpdater, /tours de chat actifs ; mise a jour annulee sans redemarrage/);
  assert.match(linuxRuntimeHarness, /"busy_chat_checks": 4/);
  assert.match(linuxRuntimeHarness, /aucun tour de chat actif n'a ete observe apres la fin des terminaux/);
  assert.match(linuxRuntimeHarness, /le drain a commence avant la fin du tour de chat actif/);
  assert.match(linuxRuntimeHarness, /chat-api-unavailable/);
  assert.match(linuxRuntimeHarness, /chat-api-malformed/);
  assert.match(linuxRuntimeHarness, /un drain a ete arme malgre l'echec de l'API chat/);
  assert.match(linuxRuntimeHarness, /un redemarrage a eu lieu malgre l'echec de l'API chat/);
  assert.match(linuxConcurrencyHarness, /\/api\/chat\/turns\/active/);
});

test("les releases de developpement sont immuables et verifiees par commit", () => {
  assert.match(windowsUpdater, /\$releaseId = "\$version-\$safeCommit"/);
  assert.match(windowsUpdater, /-WantCommit \$commit/);
  assert.match(linuxUpdater, /RELEASE_ID="\$VERSION-\$SAFE_COMMIT"/);
  assert.match(linuxUpdater, /verify "\$VERSION" "\$COMMIT"/);
  assert.match(linuxUpdater, /CST_GIT_COMMIT="\$CST_GIT_COMMIT"/);
  assert.match(linuxUpdater, /commit demande \$CST_GIT_COMMIT mais binaire en \$COMMIT/);
});

test("la verification Linux conserve les booleens JSON a false", () => {
  assert.match(linuxUpdater, /has\(\$k\) and \.\[\$k\] != null/);
  assert.doesNotMatch(linuxUpdater, /'\.\[\$k\] \/\/ empty'/);
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
  assert.match(frontendPublisher, /\[string\]\$SourceDir\s*=\s*""/);
  assert.match(frontendPublisher, /-SourceDir exige -SkipBuild/);
  assert.match(frontendPublisher, /StaleAssetRetentionHours\s*=\s*72/);
  assert.match(frontendPublisher, /LastWriteTimeUtc\s+-ge\s+\$assetCutoff/);
  assert.match(frontendPublisher, /-RetainAssetHours \$StaleAssetRetentionHours/);
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

test("le harnais Linux exerce deux updaters, le mutex et les marqueurs de release", () => {
  assert.match(linuxConcurrencyHarness, /run_updater winner/);
  assert.match(linuxConcurrencyHarness, /run_updater contender/);
  assert.match(linuxConcurrencyHarness, /winner-locked/);
  assert.match(linuxConcurrencyHarness, /contender-cleanup-paused/);
  assert.match(linuxConcurrencyHarness, /99999999\|1/);
  assert.match(linuxConcurrencyHarness, /Release conservee car une mise a jour l'utilise/);
  assert.match(linuxConcurrencyHarness, /test "\$contender_status" -eq 4/);
  assert.match(linuxConcurrencyHarness, /flock -n "\$app\/\.update\.lock"/);
});

test("le harnais Windows exerce deux updaters, le mutex et les marqueurs de release", () => {
  assert.match(updateRuntimeHarness, /--concurrency-only/);
  assert.match(updateRuntimeHarness, /startPowerShell\(updaterArgs\(winnerCandidate, "winner"\)/);
  assert.match(updateRuntimeHarness, /updaterArgs\(contenderCandidate, "contender"\)/);
  assert.match(updateRuntimeHarness, /winner-locked/);
  assert.match(updateRuntimeHarness, /health-paused/);
  assert.match(updateRuntimeHarness, /99999999\|1/);
  assert.match(updateRuntimeHarness, /getProcessStartTicks\(contenderRun\.child\.pid\)/);
  assert.match(updateRuntimeHarness, /Une autre mise a jour effectue deja la bascule/);
  assert.match(updateRuntimeHarness, /Release conservee car une mise a jour l'utilise/);
  assert.match(updateRuntimeHarness, /concurrency-mutex-reuse/);
});

test("le harnais Windows reprend une bascule apres abandon du mutex", () => {
  assert.match(windowsUpdater, /catch \[Threading\.AbandonedMutexException\]/);
  assert.match(updateRuntimeHarness, /updaterArgs\(crashCandidate, "crash-holder"\)/);
  assert.match(updateRuntimeHarness, /child\.kill\("SIGKILL"\)/);
  assert.match(updateRuntimeHarness, /le crash doit laisser un marqueur perime/);
  assert.match(updateRuntimeHarness, /abandoned-mutex-recovery/);
  assert.match(updateRuntimeHarness, /crash-window-service-restoration/);
});

test("le harnais runtime isole la bascule, le rollback et la purge Windows", () => {
  assert.match(updateRuntimeHarness, /mkdtemp\(path\.join\(os\.tmpdir\(\), "cst-update-runtime-"\)\)/);
  assert.match(updateRuntimeHarness, /\$env:APPDATA = \$AppData/);
  assert.match(updateRuntimeHarness, /\$env:LOCALAPPDATA = \$LocalAppData/);
  assert.match(updateRuntimeHarness, /function Stop-ScheduledTask/);
  assert.match(updateRuntimeHarness, /function Start-ScheduledTask/);
  assert.match(updateRuntimeHarness, /post-switch-verification-failure/);
  assert.match(updateRuntimeHarness, /failed-release-cleanup/);
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
