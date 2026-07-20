#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
export const defaultBudgetPath = resolve(
  projectRoot,
  "config/server-resource-budget.json",
);

const normalizedName = (value) => String(value ?? "")
  .trim()
  .toLowerCase()
  .replace(/\.exe$/i, "");

const finiteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const namedEntry = (entries, processName) => {
  if (!Array.isArray(entries)) return null;
  const expected = normalizedName(processName);
  return entries.find(
    (entry) => normalizedName(entry?.processName) === expected,
  ) ?? null;
};

const distributionValue = (entry, metric, point) =>
  finiteNumber(entry?.[metric]?.[point]);

const readJson = async (path) => {
  const content = await readFile(path, "utf8");
  return JSON.parse(content.replace(/^\uFEFF/, ""));
};

export const loadServerResourceBudget = async (path = defaultBudgetPath) =>
  readJson(path);

export const evaluateServerResourceCapture = (capture, budget) => {
  const checks = [];
  const addCheck = ({ scope, id, passed, actual, expected }) => {
    checks.push({
      scope,
      id,
      passed: Boolean(passed),
      actual: actual ?? null,
      expected,
    });
  };
  const exact = (scope, id, actual, expected) => addCheck({
    scope,
    id,
    passed: actual === expected,
    actual,
    expected,
  });
  const atLeast = (scope, id, actual, expected) => addCheck({
    scope,
    id,
    passed: actual !== null && actual >= expected,
    actual,
    expected: { minimum: expected },
  });
  const atMost = (scope, id, actual, expected) => addCheck({
    scope,
    id,
    passed: actual !== null && actual <= expected,
    actual,
    expected: { maximum: expected },
  });

  const scenario = budget?.scenario ?? {};
  const resources = budget?.resources ?? {};
  const window = capture?.window ?? {};
  const processEntries = capture?.byProcessName;
  const topologyEntries = capture?.topology?.rootChildrenByProcessName;

  exact(
    "scenario",
    "capture-schema",
    finiteNumber(capture?.schemaVersion),
    finiteNumber(scenario.captureSchemaVersion),
  );
  addCheck({
    scope: "scenario",
    id: "capture-label",
    passed: typeof capture?.label === "string"
      && capture.label.startsWith(String(scenario.labelPrefix ?? "")),
    actual: capture?.label,
    expected: { prefix: scenario.labelPrefix },
  });
  exact(
    "scenario",
    "root-process",
    normalizedName(capture?.root?.processName),
    normalizedName(scenario.rootProcessName),
  );
  exact("scenario", "complete-window", window.endedEarly, false);
  exact(
    "scenario",
    "requested-duration",
    finiteNumber(window.requestedDurationSeconds),
    finiteNumber(scenario.requestedDurationSeconds),
  );
  exact(
    "scenario",
    "sample-interval",
    finiteNumber(window.sampleIntervalMilliseconds),
    finiteNumber(scenario.sampleIntervalMilliseconds),
  );
  exact(
    "scenario",
    "tree-refresh-interval",
    finiteNumber(window.processTreeRefreshMilliseconds),
    finiteNumber(scenario.processTreeRefreshMilliseconds),
  );
  atLeast(
    "scenario",
    "sample-count",
    finiteNumber(window.sampleCount),
    finiteNumber(scenario.minimumSampleCount),
  );
  atLeast(
    "scenario",
    "observed-duration",
    finiteNumber(window.observedDurationSeconds),
    finiteNumber(scenario.requestedDurationSeconds),
  );
  addCheck({
    scope: "scenario",
    id: "topology-present",
    passed: Array.isArray(topologyEntries),
    actual: Array.isArray(topologyEntries) ? "present" : "missing",
    expected: "present",
  });

  const provider = scenario.provider;
  let providerInitial = null;
  if (provider?.processName) {
    const providerEntry = namedEntry(processEntries, provider.processName);
    providerInitial = distributionValue(providerEntry, "processCount", "initial");
    const providerPeak = distributionValue(providerEntry, "processCount", "peak");
    atLeast(
      "scenario",
      "provider-initial-minimum",
      providerInitial,
      finiteNumber(provider.initialCount?.minimum),
    );
    atMost(
      "scenario",
      "provider-initial-maximum",
      providerInitial,
      finiteNumber(provider.initialCount?.maximum),
    );
    atMost(
      "scenario",
      "provider-peak-maximum",
      providerPeak,
      finiteNumber(provider.maximumPeakCount),
    );
  }

  const observedNames = new Set(
    (Array.isArray(capture?.observedProcessNames)
      ? capture.observedProcessNames
      : [])
      .map(normalizedName)
      .filter(Boolean),
  );
  for (const processName of scenario.forbiddenObservedProcessNames ?? []) {
    addCheck({
      scope: "scenario",
      id: `comparable-workload-without-${normalizedName(processName)}`,
      passed: !observedNames.has(normalizedName(processName)),
      actual: observedNames.has(normalizedName(processName)) ? "observed" : "absent",
      expected: "absent",
    });
  }

  if (provider?.processName && provider.requireEveryInitialProcessAsRootChild) {
    const directProviderEntry = namedEntry(topologyEntries, provider.processName);
    const directProviderInitial = distributionValue(
      directProviderEntry,
      "processCount",
      "initial",
    );
    addCheck({
      scope: "topology",
      id: "provider-processes-are-direct-root-children",
      passed: providerInitial !== null
        && directProviderInitial !== null
        && directProviderInitial === providerInitial,
      actual: {
        totalInitial: providerInitial,
        directRootChildrenInitial: directProviderInitial,
      },
      expected: "all initial provider processes are direct root children",
    });
  }

  const persistentTerminal = scenario.persistentTerminal;
  if (persistentTerminal?.processName) {
    const persistentTerminalEntry = namedEntry(
      processEntries,
      persistentTerminal.processName,
    );
    const persistentTerminalInitial = distributionValue(
      persistentTerminalEntry,
      "processCount",
      "initial",
    );
    atLeast(
      "scenario",
      "persistent-terminal-initial-minimum",
      persistentTerminalInitial,
      finiteNumber(persistentTerminal.minimumInitialCount),
    );
    if (persistentTerminal.requireDirectRootChild) {
      const directPersistentTerminalEntry = namedEntry(
        topologyEntries,
        persistentTerminal.processName,
      );
      const directPersistentTerminalInitial = distributionValue(
        directPersistentTerminalEntry,
        "processCount",
        "initial",
      );
      atLeast(
        "scenario",
        "persistent-terminal-direct-root-child-minimum",
        directPersistentTerminalInitial,
        finiteNumber(persistentTerminal.minimumInitialCount),
      );
    }
  }

  const idle = scenario.idle;
  if (idle) {
    if (idle.requireIsolated) {
      exact(
        "scenario",
        "idle-isolated",
        capture?.idleScenario?.isolated,
        true,
      );
    }
    const connectionMaximum = finiteNumber(
      idle.maximumEstablishedClientConnectionsAtStart,
    );
    if (connectionMaximum !== null) {
      atMost(
        "scenario",
        "idle-client-connections-at-start",
        finiteNumber(capture?.idleScenario?.establishedClientConnectionsAtStart),
        connectionMaximum,
      );
    }
    const terminalMaximum = finiteNumber(idle.maximumActiveTerminals);
    if (terminalMaximum !== null) {
      atMost(
        "scenario",
        "idle-active-terminals",
        finiteNumber(capture?.idleScenario?.health?.activeTerminals),
        terminalMaximum,
      );
    }
    if (idle.requireHealthyReadyServer) {
      exact("scenario", "idle-health-ok", capture?.idleScenario?.health?.ok, true);
      exact("scenario", "idle-health-ready", capture?.idleScenario?.health?.ready, true);
    }
  }

  for (const processName of resources.forbiddenRootChildProcessNames ?? []) {
    const entry = namedEntry(topologyEntries, processName);
    const peak = Array.isArray(topologyEntries)
      ? distributionValue(entry, "processCount", "peak") ?? 0
      : null;
    exact(
      "topology",
      `no-root-launcher-${normalizedName(processName)}`,
      peak,
      0,
    );
  }

  const aggregate = capture?.aggregate ?? {};
  const aggregateCpuMaximum = finiteNumber(resources.aggregateCpuSecondsMaximum);
  if (aggregateCpuMaximum !== null) {
    atMost(
      "resources",
      "aggregate-cpuSeconds",
      finiteNumber(aggregate.cpuSeconds),
      aggregateCpuMaximum,
    );
  }
  for (const [metric, maximum] of Object.entries(resources.aggregatePeak ?? {})) {
    atMost(
      "resources",
      `aggregate-${metric}-peak`,
      finiteNumber(aggregate?.[metric]?.peak),
      finiteNumber(maximum),
    );
  }

  const rootEntry = namedEntry(processEntries, scenario.rootProcessName);
  addCheck({
    scope: "scenario",
    id: "root-resource-entry-present",
    passed: rootEntry !== null,
    actual: rootEntry ? "present" : "missing",
    expected: "present",
  });
  const rootCpuMaximum = finiteNumber(resources.rootCpuSecondsMaximum);
  if (rootCpuMaximum !== null) {
    atMost(
      "resources",
      "root-cpuSeconds",
      finiteNumber(rootEntry?.cpuSeconds),
      rootCpuMaximum,
    );
  }
  for (const [metric, maximum] of Object.entries(resources.rootProcessPeak ?? {})) {
    atMost(
      "resources",
      `root-${metric}-peak`,
      distributionValue(rootEntry, metric, "peak"),
      finiteNumber(maximum),
    );
  }

  const failedChecks = checks.filter((check) => !check.passed);
  const scenarioChecks = checks.filter((check) => check.scope === "scenario");
  const passed = failedChecks.length === 0;
  return {
    schemaVersion: 1,
    budgetId: budget?.id ?? null,
    captureLabel: capture?.label ?? null,
    passed,
    eligible: scenarioChecks.every((check) => check.passed),
    summary: {
      checkCount: checks.length,
      passedCheckCount: checks.length - failedChecks.length,
      failedCheckCount: failedChecks.length,
      failedCheckIds: failedChecks.map((check) => check.id),
    },
    checks,
    note: resources.aggregateCpuSecondsMaximum == null
      ? "CPU is reported but has no hard budget unless the workload is identical."
      : "CPU is budgeted because this capture uses an isolated, equivalent idle workload.",
  };
};

const usage = () => [
  "Usage:",
  "  node scripts/verify-server-resource-budget.mjs --capture <capture.json>",
  "    [--budget <budget.json>]",
].join("\n");

const parseArguments = (args) => {
  const options = { capture: null, budget: defaultBudgetPath, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--capture" || argument === "--budget") {
      const value = args[index + 1];
      if (!value) throw new Error(`Valeur manquante pour ${argument}.`);
      options[argument.slice(2)] = resolve(value);
      index += 1;
    } else {
      throw new Error(`Argument inconnu: ${argument}.`);
    }
  }
  return options;
};

const main = async () => {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!options.capture) throw new Error(`${usage()}\n\n--capture est obligatoire.`);
  const [capture, budget] = await Promise.all([
    readJson(options.capture),
    loadServerResourceBudget(options.budget),
  ]);
  const report = evaluateServerResourceCapture(capture, budget);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
