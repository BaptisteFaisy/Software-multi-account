import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/terminal-focus.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const { TerminalFocusTracker } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const platform = readFileSync(new URL("../src/platform.ts", import.meta.url), "utf8");
const productionPatcher = readFileSync(
  new URL("../scripts/patch-freebuff-production-bundle.mjs", import.meta.url),
  "utf8",
);

test("une demande de focus survit a une modale et a un focus neutre", () => {
  const tracker = new TerminalFocusTracker();
  tracker.request("freebuff-a");
  tracker.observe(null, { neutral: true });

  assert.equal(tracker.target(true), null);
  assert.deepEqual(tracker.snapshot(), {
    focusedKey: "freebuff-a",
    requestedKey: "freebuff-a",
  });
  assert.equal(tracker.target(false), "freebuff-a");

  tracker.confirm("freebuff-a");
  assert.deepEqual(tracker.snapshot(), {
    focusedKey: "freebuff-a",
    requestedKey: null,
  });
});

test("le dernier terminal focalise survit aussi a la fermeture d'une modale", () => {
  const tracker = new TerminalFocusTracker();
  tracker.observe("freebuff-a");
  tracker.observe(null, { blocked: true });

  assert.equal(tracker.target(true), null);
  assert.equal(tracker.target(false), "freebuff-a");
});

test("un clic puis une frappe changent sans ambiguite le terminal cible", () => {
  const tracker = new TerminalFocusTracker();
  tracker.request("freebuff-a");
  tracker.confirm("freebuff-a");
  tracker.request("freebuff-b");

  assert.equal(tracker.target(false), "freebuff-b");
  tracker.confirm("freebuff-b");
  assert.deepEqual(tracker.snapshot(), {
    focusedKey: "freebuff-b",
    requestedKey: null,
  });
});

test("fermer un terminal oublie toute cible de focus associee", () => {
  const tracker = new TerminalFocusTracker();
  tracker.request("freebuff-a");
  tracker.forget("freebuff-a");
  assert.equal(tracker.target(false), null);
});

test("le branchement xterm capture le clic et route onData par session", () => {
  assert.match(main, /pane\.addEventListener\("pointerdown",[\s\S]*?\}, true\);/);
  assert.match(main, /pane\.addEventListener\("focusin",[\s\S]*?terminalFocusTracker\.confirm\(session\.key\)/);
  assert.match(
    main,
    /terminal\.onData\(\(data\) => \{[\s\S]*?id: session\.ptyId, data/,
  );
  assert.doesNotMatch(
    main,
    /terminal\.onData\(\(data\) => \{[\s\S]*?activeTerminal\(\)\?\.ptyId/,
  );
  assert.match(
    main,
    /const restoreDialogTrigger[\s\S]*?terminalViewIsMounting[\s\S]*?setTimeout\(restoreWhenMounted, 100\)/,
  );
  assert.match(
    main,
    /const closeNewTerminalModal[\s\S]*?restoreMountedTerminalFocus\(\)[\s\S]*?newTerminalModalOpen = false/,
  );
  assert.match(
    main,
    /const restoreDialogTrigger[\s\S]*?terminalInput\.focus\(\{ preventScroll: true \}\);[\s\S]*?return;/,
  );
  assert.match(
    main,
    /terminalSessions\.find\(\(session\) =>[\s\S]*?session\.terminal\.element\?\.contains\(terminalInput\)/,
  );
  assert.match(productionPatcher, /switchRestoreFreebuffTerminalFocus/);
  assert.match(productionPatcher, /reprise du focus lors du retour a la vue terminal/);
  assert.match(productionPatcher, /tagName!==`TEXTAREA`/);
});

test("la reconnexion conserve les frappes jusqu'a la preuve que le PTY a disparu", () => {
  assert.match(platform, /queuePendingTerminalInput\(id, data\)/);
  assert.match(platform, /terminalInputRequiresBuffer\(/);
  assert.match(platform, /apiAt\(route, "POST", `\/api\/terminals\/\$\{id\}\/write`, \{ data: "" \}\)/);
  assert.match(platform, /if \(terminalSessionIsMissingError\(error\)\)/);
});
