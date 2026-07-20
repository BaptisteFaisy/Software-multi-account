import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  evaluateServerResourceCapture,
  loadServerResourceBudget,
} from "../scripts/verify-server-resource-budget.mjs";

const budgetPath = fileURLToPath(
  new URL("../config/server-idle-resource-budget.json", import.meta.url),
);
const harnessPath = new URL(
  "../scripts/measure-server-idle-resources.ps1",
  import.meta.url,
);
const budget = await loadServerResourceBudget(budgetPath);
const harness = await readFile(harnessPath, "utf8");

const distribution = (initial, peak = initial, final = initial) => ({
  initial,
  average: (initial + peak + final) / 3,
  p95: peak,
  peak,
  final,
});

const processEntry = (processName, values) => ({
  processName,
  cpuSeconds: values.cpuSeconds,
  cpuCorePercent: 0,
  cpuMachinePercent: 0,
  processCount: distribution(values.processCount),
  workingSetMiB: distribution(values.workingSetMiB),
  privateMemoryMiB: distribution(values.privateMemoryMiB),
  threadCount: distribution(values.threadCount),
  handleCount: distribution(values.handleCount),
});

const passingIdleCapture = () => ({
  schemaVersion: 2,
  label: "idle-root-isolated-test",
  root: {
    processName: "cst-server",
    processId: 1234,
    startedAtUtc: "2026-07-15T08:00:00.000Z",
  },
  window: {
    requestedDurationSeconds: 30,
    observedDurationSeconds: 30.1,
    sampleIntervalMilliseconds: 1000,
    processTreeRefreshMilliseconds: 4000,
    sampleCount: 30,
    processTreeRefreshCount: 8,
    endedEarly: false,
    endReason: "duration-complete",
  },
  aggregate: {
    cpuSeconds: 0.1,
    processCount: distribution(2),
    workingSetMiB: distribution(30, 31, 30),
    privateMemoryMiB: distribution(4),
    threadCount: distribution(20, 22, 18),
    handleCount: distribution(230),
  },
  byProcessName: [
    processEntry("cst-server", {
      cpuSeconds: 0.1,
      processCount: 1,
      workingSetMiB: 21,
      privateMemoryMiB: 3,
      threadCount: 18,
      handleCount: 110,
    }),
    processEntry("conhost", {
      cpuSeconds: 0,
      processCount: 1,
      workingSetMiB: 9,
      privateMemoryMiB: 1,
      threadCount: 4,
      handleCount: 120,
    }),
  ],
  topology: {
    rootChildrenByProcessName: [
      { processName: "conhost", processCount: distribution(1) },
    ],
  },
  observedProcessNames: ["conhost", "cst-server"],
  idleScenario: {
    isolated: true,
    establishedClientConnectionsAtStart: 0,
    serverSha256: "test",
    health: {
      ok: true,
      ready: true,
      activeTerminals: 0,
      version: "0.1.0",
      commit: "test",
    },
  },
});

test("la baseline idle isolee respecte son budget", () => {
  const report = evaluateServerResourceCapture(passingIdleCapture(), budget);

  assert.equal(report.passed, true);
  assert.equal(report.eligible, true);
  assert.equal(report.summary.failedCheckCount, 0);
  assert.ok(report.summary.checkCount >= 25);
});

test("une activite CPU ou un enfant Codex invalide le repos", () => {
  const capture = passingIdleCapture();
  capture.aggregate.cpuSeconds = budget.resources.aggregateCpuSecondsMaximum + 0.01;
  capture.byProcessName[0].cpuSeconds = budget.resources.rootCpuSecondsMaximum + 0.01;
  capture.observedProcessNames.push("codex");
  capture.topology.rootChildrenByProcessName.push({
    processName: "codex",
    processCount: distribution(1),
  });

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.ok(report.summary.failedCheckIds.includes("aggregate-cpuSeconds"));
  assert.ok(report.summary.failedCheckIds.includes("root-cpuSeconds"));
  assert.ok(
    report.summary.failedCheckIds.includes("comparable-workload-without-codex"),
  );
  assert.ok(report.summary.failedCheckIds.includes("no-root-launcher-codex"));
});

test("une connexion cliente ou un terminal rend la capture non idle", () => {
  const capture = passingIdleCapture();
  capture.idleScenario.establishedClientConnectionsAtStart = 1;
  capture.idleScenario.health.activeTerminals = 1;

  const report = evaluateServerResourceCapture(capture, budget);

  assert.equal(report.passed, false);
  assert.equal(report.eligible, false);
  assert.ok(
    report.summary.failedCheckIds.includes("idle-client-connections-at-start"),
  );
  assert.ok(report.summary.failedCheckIds.includes("idle-active-terminals"));
});

test("le harness isole son runtime et ne pilote aucun terminal existant", () => {
  assert.match(harness, /CST_ACCOUNTS_DIR[^\n]+\$null/);
  assert.match(harness, /Start-Process[\s\S]*?-WindowStyle Hidden/);
  assert.match(harness, /establishedConnections[\s\S]*?-ne 0/);
  assert.match(harness, /StartsWith\("cst-idle-baseline-"\)/);
  assert.doesNotMatch(harness, /\/api\/terminals|api_stop_terminal/);
});
