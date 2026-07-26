import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const source = readFileSync(new URL("../src/opencode-login.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const loginModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

// Sorties reelles de `opencode auth login --provider zai` (opencode 1.18.1),
// sequences ANSI comprises : la boite clack est redessinee a chaque frappe.
const API_KEY_PROMPT =
  "[0m\r\n[90m┌[39m  Add credential\n" +
  "[?25l[90m│[39m\n" +
  "[36m◆[39m  Enter your API key\n" +
  "[36m│[39m  [7m[8m_[28m[27m\n";
const SUCCESS_TAIL =
  "[999D[4A[1B[J[32m◇[39m  Enter your API key\n" +
  "[90m│[39m  [2m▪▪▪[22m\n" +
  "[?25h[90m│[39m\n" +
  "[90m└[39m  Done\n";

test("le parseur OpenCode reconnait l'invite de cle puis la fin de la connexion", () => {
  const prompt = loginModule.parseOpenCodeLoginOutput(API_KEY_PROMPT);
  assert.equal(prompt.awaitingApiKey, true);
  assert.equal(prompt.success, false);
  assert.equal(prompt.error, null);

  const done = loginModule.parseOpenCodeLoginOutput(API_KEY_PROMPT + SUCCESS_TAIL);
  assert.equal(done.success, true);
  assert.equal(done.error, null);
});

test("une CLI OpenCode absente est detectee dans chaque shell", () => {
  const shells = [
    "bash: opencode: command not found",
    "'opencode' n’est pas reconnu en tant que commande interne ou externe",
    "opencode : Le terme «opencode» n'est pas reconnu comme nom d'applet de commande",
    "opencode : The term 'opencode' is not recognized as the name of a cmdlet",
    "CommandNotFoundException: opencode",
  ];
  for (const output of shells) {
    const parsed = loginModule.parseOpenCodeLoginOutput(output);
    assert.equal(parsed.success, false, output);
    assert.equal(parsed.error, loginModule.OPENCODE_MISSING_CLI_MESSAGE, output);
  }
});

test("une erreur de la CLI OpenCode est remontee telle quelle", () => {
  const parsed = loginModule.parseOpenCodeLoginOutput(
    "[0m\r\n┌  Add credential\nError: Unknown provider \"zai-typo\"\n",
  );
  assert.equal(parsed.success, false);
  assert.equal(parsed.error, 'OpenCode : Unknown provider "zai-typo"');
});

test("le flux OpenCode ne livre l'invite et le resultat qu'une fois", () => {
  const key = "opencode-login-test";
  assert.deepEqual(loginModule.consumeOpenCodeLoginOutput(key, "┌  Add credential\n"), {
    type: "none",
  });
  assert.equal(loginModule.openCodeLoginAwaitsApiKey(key), false);

  assert.deepEqual(loginModule.consumeOpenCodeLoginOutput(key, API_KEY_PROMPT), {
    type: "prompt",
  });
  assert.equal(loginModule.openCodeLoginAwaitsApiKey(key), true);
  assert.deepEqual(loginModule.consumeOpenCodeLoginOutput(key, "▪▪▪"), {
    type: "none",
  });

  assert.deepEqual(loginModule.consumeOpenCodeLoginOutput(key, SUCCESS_TAIL), {
    type: "success",
  });
  assert.equal(loginModule.openCodeLoginAwaitsApiKey(key), false);
  // Le shell rend la main apres la sortie du CLI : plus aucun signal ensuite.
  assert.deepEqual(loginModule.consumeOpenCodeLoginOutput(key, SUCCESS_TAIL), {
    type: "none",
  });
  loginModule.forgetOpenCodeLoginOutput(key);
});

test("la cle collee est bornee et ne peut pas injecter une autre commande", () => {
  assert.equal(loginModule.normalizeOpenCodeApiKey("  sk-abc123  "), "sk-abc123");
  assert.equal(loginModule.normalizeOpenCodeApiKey(""), null);
  assert.equal(loginModule.normalizeOpenCodeApiKey("sk-abc\nrm -rf /"), null);
  assert.equal(loginModule.normalizeOpenCodeApiKey("x".repeat(4_097)), null);
});

test("le login OpenCode se termine au lieu d'attendre indefiniment", () => {
  assert.match(main, /const applyOpenCodeLoginOutput =/);
  assert.match(main, /consumeOpenCodeLoginOutput\(session\.key, data\)/);
  assert.match(main, /applyOpenCodeLoginOutput\(session, event\.payload\.data\)/);
  // Succes : le terminal temporaire se ferme et les comptes sont relus.
  assert.match(
    main,
    /update\.type === "success"[\s\S]*?closeTerminalSession\(session\.key\)[\s\S]*?refreshLimitStatus\(true, true\)/,
  );
  // Echec (CLI absente, provider inconnu) : message explicite, pas d'attente.
  assert.match(main, /update\.type === "error"[\s\S]*?statusText = update\.message/);
  // Mode distant : le tampon est rejoue, le premier octet precede le WebSocket.
  assert.match(main, /const replayOpenCodeLoginOutput = async/);
  assert.match(main, /accountProvider\(startedAccount\) === "opencode"/);
  assert.match(main, /forgetOpenCodeLoginOutput\(session\.key\)/);
});

test("le login OpenCode expose un champ de collage de la cle API", () => {
  assert.match(main, /data-opencode-login-key-form=/);
  assert.match(main, /data-opencode-login-key-input=/);
  assert.match(main, /openCodeLoginAwaitsApiKey\(loginSession\.key\)/);
  assert.match(main, /normalizeOpenCodeApiKey\(input\.value\)/);
  assert.match(main, /invoke\("write_terminal", \{ id: terminalId, data: `\$\{key\}\\r` \}\)/);
  assert.match(style, /\.opencode-login-key-form/);
  assert.match(style, /\.folder-terminal-panel\.has-opencode-login-key/);
});

test("le champ de cle OpenCode reste dans la grille visible sur mobile", () => {
  const lastGenericGrid = style.lastIndexOf(".folder-terminal-panel {");
  const lastOpenCodeGrid = style.lastIndexOf(
    ".folder-terminal-panel.has-opencode-login-key {",
  );

  assert.ok(lastOpenCodeGrid > lastGenericGrid);
  assert.match(
    style.slice(lastOpenCodeGrid),
    /grid-template-rows:\s*auto auto auto minmax\(0, 1fr\) !important;/,
  );
});

test("l'image serveur embarque OpenCode, sinon aucun compte annexe ne peut se connecter", () => {
  assert.match(dockerfile, /opencode-ai/);
  assert.match(dockerfile, /command -v opencode >\/dev\/null/);
});
