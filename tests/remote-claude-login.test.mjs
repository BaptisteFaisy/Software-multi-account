import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const terminalRuntime = readFileSync(
  new URL("../src/terminal-runtime.ts", import.meta.url),
  "utf8",
);
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const source = readFileSync(
  new URL("../src/remote-claude-login.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const loginModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const oauthUrl =
  "https://claude.com/cai/oauth/authorize?client_id=test-client&response_type=code&state=test-state";

test("le parseur Claude extrait l'URL OAuth reelle malgre le lien OSC 8", () => {
  const parsed = loginModule.parseRemoteClaudeLoginOutput(
    `Opening browser…\r\n\u001b]8;;${oauthUrl}\u0007${oauthUrl}\u001b]8;;\u0007\r\nPaste code here if prompted > `,
  );

  assert.equal(parsed.url, oauthUrl);
  assert.equal(parsed.success, false);
});

test("le parseur Claude refuse les URL ressemblantes et reconnait le succes", () => {
  const malicious = loginModule.parseRemoteClaudeLoginOutput(
    "https://claude.com.example.net/cai/oauth/authorize?state=test",
  );
  assert.equal(malicious.url, null);

  const completed = loginModule.parseRemoteClaudeLoginOutput(
    "Authentication successful",
  );
  assert.equal(completed.success, true);
});

test("le flux Claude ne livre l'URL et le succes qu'une fois", () => {
  const key = "claude-login-test";
  assert.deepEqual(
    loginModule.consumeRemoteClaudeLoginOutput(key, oauthUrl.slice(0, 35)),
    { type: "none" },
  );
  assert.deepEqual(
    loginModule.consumeRemoteClaudeLoginOutput(key, oauthUrl.slice(35)),
    { type: "ready", url: oauthUrl },
  );
  assert.deepEqual(
    loginModule.consumeRemoteClaudeLoginOutput(key, "\r\nPaste code here if prompted > "),
    { type: "none" },
  );
  assert.deepEqual(
    loginModule.consumeRemoteClaudeLoginOutput(key, "\r\nClaude Code login successful\r\n"),
    { type: "success" },
  );
  assert.deepEqual(
    loginModule.consumeRemoteClaudeLoginOutput(key, "Authentication successful"),
    { type: "none" },
  );
  loginModule.forgetRemoteClaudeLoginOutput(key);
});

test("le code Claude colle est borne et ne peut pas injecter une autre ligne", () => {
  assert.equal(loginModule.normalizeRemoteClaudeLoginCode("  code#state  "), "code#state");
  assert.equal(loginModule.normalizeRemoteClaudeLoginCode(""), null);
  assert.equal(loginModule.normalizeRemoteClaudeLoginCode("code\ncommande"), null);
  assert.equal(loginModule.normalizeRemoteClaudeLoginCode("x".repeat(4_097)), null);
});

test("le login Claude distant ouvre le navigateur mais garde le terminal pour le code", () => {
  assert.match(main, /const applyRemoteClaudeLoginOutput =/);
  assert.match(main, /consumeRemoteClaudeLoginOutput\(session\.key, data\)/);
  assert.match(main, /openExternalHttpsUrl\(update\.url\)/);
  assert.match(main, /Copie le code affiché par Claude, puis colle-le dans ce terminal/);
  assert.match(main, /const replayRemoteClaudeLoginOutput = async/);
  assert.match(main, /accountProvider\(startedAccount\) === "claude"/);
  assert.match(main, /update\.type === "success"[\s\S]*?closeTerminalSession\(session\.key\)/);
});

test("les liens HTTPS du terminal passent par l'ouvreur natif", () => {
  assert.match(terminalRuntime, /import \{ openExternalHttpsUrl \} from "\.\/platform"/);
  assert.match(terminalRuntime, /linkHandler:\s*\{/);
  assert.match(terminalRuntime, /openExternalHttpsUrl\(uri\)/);
});

test("le login Claude expose un vrai champ de collage et refocalise toujours xterm", () => {
  assert.match(main, /data-claude-login-code-form=/);
  assert.match(main, /data-claude-login-code-input=/);
  assert.match(main, /normalizeRemoteClaudeLoginCode\(input\.value\)/);
  assert.match(main, /invoke\("write_terminal", \{ id: terminalId, data: `\$\{code\}\\r` \}\)/);
  assert.match(main, /if \(session\) focusExpertSession\(session, true\);/);
  assert.match(style, /\.claude-login-code-form/);
  assert.match(style, /\.folder-terminal-panel\.has-claude-login-code/);
});

test("le champ de code Claude reste dans la grille visible sur mobile", () => {
  const lastGenericGrid = style.lastIndexOf(".folder-terminal-panel {");
  // Le selecteur est groupe avec celui du champ de cle OpenCode : on cible donc
  // le selecteur seul, sans supposer qu'il ouvre directement le bloc.
  const lastClaudeGrid = style.lastIndexOf(
    ".folder-terminal-panel.has-claude-login-code",
  );

  assert.ok(lastClaudeGrid > lastGenericGrid);
  assert.match(
    style.slice(lastClaudeGrid),
    /grid-template-rows:\s*auto auto auto minmax\(0, 1fr\) !important;/,
  );
});
