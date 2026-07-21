import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const popup = readFileSync(new URL("../src/remote-login-window.ts", import.meta.url), "utf8");

const compiledPopup = ts.transpileModule(popup, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const popupModule = await import(
  `data:text/javascript;base64,${Buffer.from(compiledPopup).toString("base64")}`
);

test("la connexion Codex distante ouvre directement OpenAI dans un nouvel onglet", () => {
  assert.match(main, /provider === "codex" && isRemoteMode\(\)/);
  assert.match(main, /openRemoteCodexLoginWindow\(account\.id, account\.label\)/);
  assert.match(
    main,
    /const popupPrepared =[\s\S]*?openRemoteCodexLoginWindow\(account\.id, account\.label\)[\s\S]*?await invoke<AppSettings>\("save_settings"/,
  );
  assert.match(
    popup,
    /window\.open\(CODEX_DEVICE_VERIFICATION_URL, "_blank"\)/,
  );
  assert.doesNotMatch(popup, /popup=yes|width=560|height=720/);
});

test("la fenetre extrait uniquement le lien appareil OpenAI et son code", () => {
  assert.match(popup, /https:\\\/\\\/auth\\\.openai\\\.com\\\/codex\\\/device/);
  assert.match(popup, /\[A-Z0-9\]\{4\}-\[A-Z0-9\]\{4,5\}/);
  assert.match(popup, /stripRemoteLoginControlSequences/);
  assert.match(popup, /CODEX_DEVICE_VERIFICATION_URL/);
});

test("le parseur reconnait la sortie reelle du CLI meme avec des sequences terminal", () => {
  const parsed = popupModule.parseRemoteCodexLoginOutput(`
    \u001b[1mFollow these steps\u001b[0m\r
    https://auth.openai.com/codex/device\r
    Enter this one-time code: HT2W-2WYBH\r
  `);
  assert.equal(parsed.url, "https://auth.openai.com/codex/device");
  assert.equal(parsed.userCode, "HT2W-2WYBH");
  assert.equal(parsed.success, false);

  const completed = popupModule.parseRemoteCodexLoginOutput("Successfully logged in");
  assert.equal(completed.success, true);
});

test("le code est copie des qu'il est recu pendant que l'onglet OpenAI est ouvert", () => {
  assert.match(popup, /const renderReady =[^]*?copyDeviceCode\(state\.userCode\)/);
  assert.match(popup, /state\.popup\.focus\(\)/);
  assert.match(main, /code \$\{update\.userCode\} copié, collez-le pour continuer/);
});

test("le terminal de login reste en arriere-plan et est ferme apres validation", () => {
  assert.match(
    main,
    /const backgroundLogin =[\s\S]*?remoteCodexLoginWindowIsOpen\(accountId\)/,
  );
  assert.match(main, /if \(!backgroundLogin\) activeView = "terminal";/);
  assert.match(main, /applyRemoteCodexLoginOutput\(session, event\.payload\.data\)/);
  assert.match(main, /consumeRemoteCodexLoginOutput\(session\.accountId, data\)/);
  assert.match(main, /update\.type === "success"[\s\S]*?closeTerminalSession\(session\.key\)/);
});

test("un popup bloque conserve le terminal comme solution de repli", () => {
  assert.match(popup, /if \(!popupIsUsable\(popup\)\) return false;/);
  assert.match(
    main,
    /statusText = popupOpened[\s\S]*?: `Ouverture de la connexion/,
  );
});

test("la sortie initiale du terminal est tamponnee puis rejouee dans la fenetre", () => {
  assert.match(platform, /const remoteTerminalOutput = new Map<number, string>\(\)/);
  assert.match(platform, /emitRemoteTerminalData\(message\.id, message\.data\)/);
  assert.match(platform, /case "terminal_output_snapshot":/);
  assert.match(main, /const replayRemoteCodexLoginOutput = async/);
  assert.match(main, /invoke<string>\("terminal_output_snapshot", \{ id: terminalId \}\)/);
  assert.match(main, /applyRemoteCodexLoginOutput\(session, delta\)/);
  assert.match(main, /remoteCodexLoginWindowNeedsCode\(session\.accountId\)/);
});

test("une connexion sans code ne peut plus charger indefiniment", () => {
  assert.match(main, /const deadline = Date\.now\(\) \+ 12_000;/);
  assert.match(main, /Le code OpenAI n’a pas été reçu/);
  assert.match(main, /failRemoteCodexLoginWindow\(session\.accountId, message\)/);
  assert.match(main, /await closeTerminalSession\(session\.key\)/);
});
