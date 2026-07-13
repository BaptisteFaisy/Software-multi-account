import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const windowsUpdater = readFileSync(new URL("../scripts/update-node.ps1", import.meta.url), "utf8");
const linuxUpdater = readFileSync(new URL("../deploy/update-node.sh", import.meta.url), "utf8");

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
