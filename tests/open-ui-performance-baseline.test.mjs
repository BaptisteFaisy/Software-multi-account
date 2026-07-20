import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  aggregateRequests,
  expectedPollRequestRange,
  POLL_ROUTES,
  snapshotArtifacts,
  summarizePhaseRuns,
  summarizeBrowserRuns,
  summarizeRuntimeSignalRuns,
} from "../scripts/measure-open-ui-baseline.mjs";

const distribution = (peak) => ({ initial: peak, average: peak, p95: peak, peak, final: peak });
const run = (phase, cpuSeconds, routeCounts = {}) => ({
  phase,
  forwardedRequests: Object.fromEntries(
    Object.entries(routeCounts).map(([path, count]) => [`GET ${path}`, count]),
  ),
  resources: {
    aggregate: {
      cpuSeconds,
      cpuCorePercent: cpuSeconds * 10,
      workingSetMiB: distribution(40),
    },
  },
});

test("les requetes sont bornees aux horodatages exacts du sampler", () => {
  const result = aggregateRequests([
    { at: 99, method: "GET", path: POLL_ROUTES[0] },
    { at: 100, method: "GET", path: POLL_ROUTES[0] },
    { at: 150, method: "GET", path: POLL_ROUTES[1] },
    { at: 201, method: "GET", path: POLL_ROUTES[2] },
  ], 100, 200);

  assert.deepEqual(result, {
    [`GET ${POLL_ROUTES[1]}`]: 1,
    [`GET ${POLL_ROUTES[0]}`]: 1,
  });
});

test("les plages de polls refusent une fenetre client ralentie", () => {
  assert.deepEqual(expectedPollRequestRange(POLL_ROUTES[0], 30), { minimum: 29, maximum: 31 });
  assert.deepEqual(expectedPollRequestRange(POLL_ROUTES[1], 30), { minimum: 14, maximum: 16 });
  assert.deepEqual(expectedPollRequestRange(POLL_ROUTES[2], 30), { minimum: 1, maximum: 2 });
  assert.deepEqual(expectedPollRequestRange(POLL_ROUTES[3], 30), { minimum: 3, maximum: 5 });
});

test("l'attribution soustrait la synchronisation partagee route par route", () => {
  const summary = summarizePhaseRuns([
    run("shared-sync-only", 0.2),
    run("active-turns-only", 0.35, { [POLL_ROUTES[0]]: 30 }),
    run("autonomous-agents-only", 0.25, { [POLL_ROUTES[1]]: 15 }),
    run("limits-only", 0.2, { [POLL_ROUTES[2]]: 1 }),
    run("full-interface", 0.4, {
      [POLL_ROUTES[0]]: 30,
      [POLL_ROUTES[1]]: 15,
      [POLL_ROUTES[2]]: 1,
    }),
  ]);

  assert.equal(summary.attribution.routes[POLL_ROUTES[0]].cpuSeconds, 0.15);
  assert.equal(summary.attribution.routes[POLL_ROUTES[0]].requestCount, 30);
  assert.equal(summary.attribution.routes[POLL_ROUTES[0]].cpuSecondsPerRequest, 0.005);
  assert.equal(summary.attribution.routes[POLL_ROUTES[1]].cpuSeconds, 0.05);
  assert.equal(summary.attribution.routes[POLL_ROUTES[2]].measurable, false);
  assert.equal(summary.attribution.predictedFullCpuSeconds, 0.4);
  assert.equal(summary.attribution.candidateResidualCpuSeconds, 0);
  assert.equal(summary.phases["full-interface"].routeCounts[POLL_ROUTES[0]], 30);
});

test("un delta negatif ou sans requete reste sous la resolution", () => {
  const summary = summarizePhaseRuns([
    run("shared-sync-only", 0.2),
    run("active-turns-only", 0.1, { [POLL_ROUTES[0]]: 30 }),
    run("autonomous-agents-only", 0.4),
    run("limits-only", 0.208, { [POLL_ROUTES[2]]: 1 }),
  ]);

  assert.equal(summary.attribution.routes[POLL_ROUTES[0]].cpuSeconds, null);
  assert.equal(summary.attribution.routes[POLL_ROUTES[0]].observedDeltaCpuSeconds, -0.1);
  assert.equal(summary.attribution.routes[POLL_ROUTES[0]].measurable, false);
  assert.equal(summary.attribution.routes[POLL_ROUTES[1]].requestCount, 0);
  assert.equal(summary.attribution.routes[POLL_ROUTES[1]].observedDeltaCpuSeconds, 0.2);
  assert.equal(summary.attribution.routes[POLL_ROUTES[1]].cpuSeconds, null);
  assert.equal(summary.attribution.routes[POLL_ROUTES[1]].measurable, false);
  assert.equal(summary.attribution.routes[POLL_ROUTES[2]].observedDeltaCpuSeconds, 0.008);
  assert.equal(summary.attribution.routes[POLL_ROUTES[2]].cpuSeconds, null);
  assert.equal(summary.attribution.routes[POLL_ROUTES[2]].measurable, false);
});

test("les deux routes de messagerie ont chacune une phase attribuable", () => {
  const summary = summarizePhaseRuns([
    run("shared-sync-only", 0.1),
    run("private-message-users-only", 0.14, { [POLL_ROUTES[3]]: 4 }),
    run("private-message-conversations-only", 0.12, { [POLL_ROUTES[4]]: 4 }),
    run("full-interface", 0.16, {
      [POLL_ROUTES[3]]: 4,
      [POLL_ROUTES[4]]: 4,
    }),
  ]);

  assert.equal(summary.attribution.routes[POLL_ROUTES[3]].requestCount, 4);
  assert.equal(summary.attribution.routes[POLL_ROUTES[3]].cpuSeconds, 0.04);
  assert.equal(summary.attribution.routes[POLL_ROUTES[4]].requestCount, 4);
  assert.equal(summary.attribution.routes[POLL_ROUTES[4]].cpuSeconds, 0.02);
});

test("la preuve runtime exige zero poll tours-agents-messagerie et un socket stable", () => {
  const stableRun = {
    ...run("full-interface", 0.05, {
      [POLL_ROUTES[2]]: 1,
    }),
    websocket: {
      runtimeConnectionOpenBeforeWindow: true,
      runtimeEventsDuringWindow: { received: 2, sent: 2, close: 0 },
    },
  };
  const summary = summarizeRuntimeSignalRuns([stableRun]);

  assert.equal(summary.runtimeSignal.stable, true);
  assert.equal(summary.runtimeSignal.periodicGetCount, 1);
  assert.deepEqual(summary.runtimeSignal.removedRouteCounts, {
    [POLL_ROUTES[0]]: 0,
    [POLL_ROUTES[1]]: 0,
    [POLL_ROUTES[3]]: 0,
    [POLL_ROUTES[4]]: 0,
  });

  const fallbackRun = {
    ...stableRun,
    forwardedRequests: { ...stableRun.forwardedRequests, [`GET ${POLL_ROUTES[0]}`]: 30 },
  };
  assert.equal(summarizeRuntimeSignalRuns([fallbackRun]).runtimeSignal.stable, false);
});

test("l'empreinte navigateur agrege les repetitions de l'arbre Chrome", () => {
  const browserResources = (cpuSeconds, peakWorkingSetMiB, peakProcessCount) => ({
    aggregate: {
      cpuSeconds,
      cpuCorePercent: cpuSeconds,
      workingSetMiB: { peak: peakWorkingSetMiB },
      privateMemoryMiB: { peak: peakWorkingSetMiB / 2 },
      processCount: { peak: peakProcessCount },
    },
  });
  const summary = summarizeBrowserRuns([
    { browserResources: browserResources(0.2, 120, 7) },
    { browserResources: browserResources(0.4, 140, 8) },
  ]);

  assert.deepEqual(summary, {
    repetitions: 2,
    cpuSeconds: 0.3,
    cpuCorePercent: 0.3,
    peakWorkingSetMiB: 130,
    peakPrivateMemoryMiB: 65,
    peakProcessCount: 8,
  });
});

test("les artefacts mesures restent immuables pendant un build concurrent", async () => {
  const root = await mkdtemp(join(tmpdir(), "cst-open-ui-snapshot-test-"));
  const source = join(root, "source");
  const snapshotRoot = join(root, "snapshot");
  const server = join(source, "cst-server.exe");
  const frontend = join(source, "dist");
  try {
    await mkdir(frontend, { recursive: true });
    await writeFile(server, "serveur-v1");
    await writeFile(join(frontend, "index.html"), "interface-v1");
    const snapshot = await snapshotArtifacts(server, frontend, snapshotRoot);

    await writeFile(server, "serveur-v2");
    await writeFile(join(frontend, "index.html"), "interface-v2");

    assert.equal(await readFile(snapshot.serverPath, "utf8"), "serveur-v1");
    assert.equal(await readFile(join(snapshot.staticDir, "index.html"), "utf8"), "interface-v1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
