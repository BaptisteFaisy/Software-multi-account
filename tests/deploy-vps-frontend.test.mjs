import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const script = readFileSync(
  new URL("../scripts/deploy-vps-frontend.ps1", import.meta.url),
  "utf8",
);

test("la publication frontend accepte Tailscale SSH sans cle privee", () => {
  assert.match(script, /\$identityFile = \(\[string\]\$profileData\.identityFile\)\.Trim\(\)/);
  assert.match(script, /\$resolvedIdentityFile = ""\s+if \(\$identityFile\) \{/);
  assert.doesNotMatch(script, /\$sshArgs = @\(\s*"-i", \$identityFile/);
  assert.doesNotMatch(script, /\$scpArgs = @\(\s*"-i", \$identityFile/);
});

test("la publication conserve le mode avec cle explicite", () => {
  assert.match(
    script,
    /if \(\$resolvedIdentityFile\) \{\s*\$sshArgs = @\("-i", \$resolvedIdentityFile\) \+ \$sshArgs\s*\$scpArgs = @\("-i", \$resolvedIdentityFile\) \+ \$scpArgs/,
  );
  assert.match(script, /Test-Path -LiteralPath \$identityFile -PathType Leaf/);
  assert.match(script, /Resolve-Path -LiteralPath \$identityFile/);
});

test("la publication cible le conteneur configure sans renommer un bind mount", () => {
  assert.match(script, /\$containerName = \(\[string\]\$profileData\.containerName\)\.Trim\(\)/);
  assert.match(script, /docker inspect[^\r\n]+\$containerName/);
  assert.match(script, /docker exec -u 0 \$containerName cp -a \$activeDir\/\. \$backupDir\//);
  assert.match(script, /docker exec -u 0 \$containerName cp -a \$stageDir\/\. \$activeDir\//);
  assert.match(
    script,
    /docker exec \$containerName curl -fsS http:\/\/127\.0\.0\.1:8080\/healthz/,
  );
  assert.doesNotMatch(script, /docker exec[^\r\n]+ mv \$activeDir \$backupDir/);
});
