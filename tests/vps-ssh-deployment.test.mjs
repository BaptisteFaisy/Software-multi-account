import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const deployScript = readFileSync(new URL("../scripts/deploy-vps.ps1", import.meta.url), "utf8");
const connectScript = readFileSync(new URL("../scripts/connect-vps.ps1", import.meta.url), "utf8");
const installScript = readFileSync(new URL("../deploy/install-vps-node.sh", import.meta.url), "utf8");
const runtimeSmoke = readFileSync(new URL("../scripts/smoke-vps-runtime.sh", import.meta.url), "utf8");
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

function typescriptSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return typescriptSources(url);
    return entry.name.endsWith(".ts") ? [url] : [];
  });
}

test("le deploiement VPS passe uniquement par SSH et garde le runtime sur loopback", () => {
  assert.match(deployScript, /& scp @scpArgs @transferFiles/);
  assert.match(deployScript, /& ssh @sshArgs \$SshTarget \$remoteCommand/);
  assert.match(deployScript, /CST_BIND=.*127\.0\.0\.1:\$RemotePort/);
  assert.match(deployScript, /CST_WORKSPACES_ROOT="\/srv\/cst\/workspaces"/);
  assert.match(deployScript, /\$publicBaseUrl = "http:\/\/127\.0\.0\.1:\$RemotePort"/);
  assert.doesNotMatch(deployScript, /CST_BIND=.*0\.0\.0\.0/);
  assert.doesNotMatch(installScript, /tailscale/i);
  assert.match(installScript, /http:\/\/127\.0\.0\.1:\$PORT\/healthz/);
  assert.match(installScript, /cd "\$HOME" && curl/);
  assert.match(installScript, /CODEX_NON_INTERACTIVE=1 sh/);
  assert.match(installScript, /"\$APP_DIR\/\.installed"/);
  assert.match(installScript, /CARGO_TARGET_DIR="\$BUILD_CACHE"/);
  assert.match(installScript, /ln -sfn "\$BUILD_CACHE" "\$SOURCE_DIR\/src-tauri\/target"/);
  assert.match(deployScript, /\[ -f \/opt\/codex-switch-terminal\/\.installed \]/);
  assert.match(deployScript, /\[switch\]\$AcceptNewHostKey/);
  assert.match(deployScript, /StrictHostKeyChecking=accept-new/);
});

test("le deploiement accepte root ou sudo et nettoie avant -Connect", () => {
  assert.match(deployScript, /if \[ "\$\(id -u\)" -eq 0 \]/);
  assert.match(deployScript, /as_root\(\)/);
  assert.match(deployScript, /sudo -n "\$@"/);
  assert.ok(
    deployScript.lastIndexOf("if ($Connect)") > deployScript.lastIndexOf("finally {"),
    "la connexion doit commencer apres le nettoyage des archives temporaires",
  );
});

test("le connecteur cree un tunnel local et le lie a la duree de vie du client", () => {
  assert.match(connectScript, /"-L", "127\.0\.0\.1:\$\{LocalPort\}:127\.0\.0\.1:\$\{remotePort\}"/);
  assert.match(connectScript, /"ExitOnForwardFailure=yes"/);
  assert.match(connectScript, /"BatchMode=yes"/);
  assert.match(connectScript, /Start-Process[^\n]+-WindowStyle Hidden -PassThru/);
  assert.match(connectScript, /Wait-Process -Id \$client\.Id/);
  assert.match(connectScript, /Stop-Process -Id \$tunnel\.Id/);
  assert.match(connectScript, /\[switch\]\$CheckOnly/);
  assert.match(connectScript, /\/api\/health/);
  assert.match(connectScript, /Authorization = "Bearer \$adminToken"/);
});

test("le profil protege le token et les mises a jour refusent une rotation implicite", () => {
  assert.match(deployScript, /ConvertFrom-SecureString -SecureString \$secure/);
  assert.match(deployScript, /tokenProtected = \(Protect-Secret \$adminToken\)/);
  assert.match(deployScript, /current_token_hash/);
  assert.match(deployScript, /exit 42/);
  assert.doesNotMatch(deployScript, /Write-Host[^\n]*\$adminToken/);
});

test("npm expose les commandes de deploiement et de connexion VPS", () => {
  assert.match(packageJson.scripts["deploy:vps"], /deploy-vps\.ps1/);
  assert.match(packageJson.scripts["connect:vps"], /connect-vps\.ps1/);
});

test("le smoke-test Linux couvre tous les types de chats distants", () => {
  assert.match(runtimeSmoke, /run_chat_turn build/);
  assert.match(runtimeSmoke, /run_chat_turn plan/);
  assert.match(runtimeSmoke, /run_chat_turn ask/);
  assert.match(runtimeSmoke, /RESUME_TURN_ID/);
  assert.match(runtimeSmoke, /\/api\/autonomous-agents/);
  assert.match(runtimeSmoke, /\/api\/orchestrations/);
  assert.match(runtimeSmoke, /ORCHESTRATION_PLAN:/);
  assert.match(runtimeSmoke, /orchestrationStatus: "completed"/);
});

test("chaque commande invoquee par l'interface possede un adaptateur distant", () => {
  const platformUrl = new URL("../src/platform.ts", import.meta.url);
  const platformSource = readFileSync(platformUrl, "utf8");
  const remoteCommands = new Set(
    [...platformSource.matchAll(/case\s+["']([^"']+)["']\s*:/g)].map((match) => match[1]),
  );
  const invokedCommands = new Set();

  for (const sourceUrl of typescriptSources(new URL("../src/", import.meta.url))) {
    if (sourceUrl.href === platformUrl.href) continue;
    const source = readFileSync(sourceUrl, "utf8");
    for (const match of source.matchAll(/\binvoke(?:<.*?>)?\s*\(\s*["']([^"']+)["']/gs)) {
      invokedCommands.add(match[1]);
    }
  }

  assert.ok(invokedCommands.size > 0, "aucune commande invoke detectee");
  assert.deepEqual(
    [...invokedCommands].filter((command) => !remoteCommands.has(command)).sort(),
    [],
  );
});
