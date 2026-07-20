import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  evaluateServerResourceCapture,
  loadServerResourceBudget,
} from "../scripts/verify-server-resource-budget.mjs";

const distribution = (initial, peak = initial, final = initial) => ({
  initial,
  average: (initial + peak + final) / 3,
  p95: peak,
  peak,
  final,
});

const processEntry = (processName, values) => ({
  processName,
  cpuSeconds: 0.5,
  cpuCorePercent: 4,
  cpuMachinePercent: 0.3,
  processCount: distribution(values.processCount),
  workingSetMiB: distribution(values.workingSetMiB),
  privateMemoryMiB: distribution(values.privateMemoryMiB),
  threadCount: distribution(values.threadCount),
  handleCount: distribution(values.handleCount),
});

const passingCapture = () => ({
  schemaVersion: 2,
  label: "native-codex-equivalent-load-test",
  root: {
    processName: "cst-server",
    processId: 1234,
    startedAtUtc: "2026-07-15T08:00:00.000Z",
  },
  window: {
    requestedDurationSeconds: 12,
    observedDurationSeconds: 12.2,
    sampleIntervalMilliseconds: 1000,
    processTreeRefreshMilliseconds: 4000,
    sampleCount: 12,
    processTreeRefreshCount: 4,
    endedEarly: false,
    endReason: "duration-complete",
  },
  aggregate: {
    processCount: distribution(31),
    workingSetMiB: distribution(850, 900, 820),
    privateMemoryMiB: distribution(870, 920, 840),
    threadCount: distribution(480, 510, 460),
    handleCount: distribution(8900, 9300, 8700),
  },
  byProcessName: [
    processEntry("cst-server", {
      processCount: 1,
      workingSetMiB: 24,
      privateMemoryMiB: 18,
      threadCount: 12,
      handleCount: 140,
    }),
    processEntry("codex", {
      processCount: 7,
      workingSetMiB: 700,
      privateMemoryMiB: 720,
      threadCount: 350,
      handleCount: 7000,
    }),
    processEntry("powershell", {
      processCount: 6,
      workingSetMiB: 100,
      privateMemoryMiB: 110,
      threadCount: 90,
      handleCount: 1600,
    }),
  ],
  topology: {
    rootChildrenByProcessName: [
      { processName: "codex", processCount: distribution(7) },
      { processName: "powershell", processCount: distribution(3) },
    ],
  },
  observedProcessNames: ["codex", "cst-server", "powershell"],
});

const budget = await loadServerResourceBudget();
const regressionScript = await readFile(
  new URL("../scripts/verify-server-resource-regression.ps1", import.meta.url),
  "utf8",
);

test("le garde-fou reste cible sur les contrats lies aux ressources", () => {
  assert.match(
    regressionScript,
    /--test-concurrency=1[\s\S]*tests\/chat-child-lifecycle\.test\.mjs[\s\S]*tests\/interface-mode\.test\.mjs[\s\S]*tests\/site-usability\.test\.mjs/,
  );
  assert.match(
    regressionScript,
    /chat::tests::official_npm_codex_uses_its_native_binary_with_safe_fallbacks/,
  );
  assert.doesNotMatch(regressionScript, /^\s*"chat::tests::"\s*$/m);
});

test("la charge native equivalente respecte les budgets et garde les terminaux", () => {
  const report = evaluateServerResourceCapture(passingCapture(), budget);

  assert.equal(report.passed, true);
  assert.equal(report.eligible, true);
  assert.equal(report.summary.failedCheckCount, 0);
  assert.ok(report.summary.checkCount >= 25);
});

test("la disparition d'un terminal persistant invalide le scenario", () => {
  const capture = passingCapture();
  capture.byProcessName = capture.byProcessName.filter(
    (entry) => entry.processName !== "powershell",
  );
  capture.topology.rootChildrenByProcessName =
    capture.topology.rootChildrenByProcessName.filter(
      (entry) => entry.processName !== "powershell",
    );
  capture.observedProcessNames = capture.observedProcessNames.filter(
    (name) => name !== "powershell",
  );

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.equal(report.eligible, false);
  assert.ok(
    report.summary.failedCheckIds.includes(
      "persistent-terminal-initial-minimum",
    ),
  );
  assert.ok(
    report.summary.failedCheckIds.includes(
      "persistent-terminal-direct-root-child-minimum",
    ),
  );
});

test("un lanceur cmd direct et des Codex non directs font echouer la topologie", () => {
  const capture = passingCapture();
  capture.observedProcessNames.push("cmd");
  capture.topology.rootChildrenByProcessName = [
    { processName: "cmd", processCount: distribution(1) },
    { processName: "codex", processCount: distribution(0) },
  ];

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.ok(
    report.summary.failedCheckIds.includes(
      "provider-processes-are-direct-root-children",
    ),
  );
  assert.ok(report.summary.failedCheckIds.includes("no-root-launcher-cmd"));
});

test("un depassement memoire echoue meme si la topologie reste native", () => {
  const capture = passingCapture();
  capture.aggregate.privateMemoryMiB.peak =
    budget.resources.aggregatePeak.privateMemoryMiB + 0.01;

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.deepEqual(report.summary.failedCheckIds, [
    "aggregate-privateMemoryMiB-peak",
  ]);
});

test("une capture moins chargee ou polluee est refusee comme non comparable", () => {
  const capture = passingCapture();
  capture.byProcessName.find((entry) => entry.processName === "codex")
    .processCount.initial = 5;
  capture.topology.rootChildrenByProcessName.find(
    (entry) => entry.processName === "codex",
  ).processCount.initial = 5;
  capture.observedProcessNames.push("node");

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.equal(report.eligible, false);
  assert.ok(report.summary.failedCheckIds.includes("provider-initial-minimum"));
  assert.ok(
    report.summary.failedCheckIds.includes("comparable-workload-without-node"),
  );
});

test("une ancienne capture sans topologie ne peut pas valider le garde-fou", () => {
  const capture = passingCapture();
  capture.schemaVersion = 1;
  delete capture.topology;

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.ok(report.summary.failedCheckIds.includes("capture-schema"));
  assert.ok(report.summary.failedCheckIds.includes("topology-present"));
  assert.ok(
    report.summary.failedCheckIds.includes(
      "provider-processes-are-direct-root-children",
    ),
  );
});
