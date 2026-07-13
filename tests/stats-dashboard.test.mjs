import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STATS_RANGE_OPTIONS,
  aggregateAccountTokenDays,
  buildAccountTokenSeries,
  recentDateKeys,
  sumTokenUsage,
} from "../src/stats.ts";

const usageDay = (date, totalTokens, inputTokens = totalTokens, outputTokens = 0) => ({
  date,
  inputTokens,
  cachedInputTokens: 0,
  outputTokens,
  totalTokens,
  costUsd: totalTokens / 1_000_000,
});

test("les périodes proposées sont aujourd'hui, 7 jours et 30 jours", () => {
  assert.deepEqual(
    STATS_RANGE_OPTIONS.map(({ days, label }) => [days, label]),
    [
      [1, "Aujourd'hui"],
      [7, "7 jours"],
      [30, "30 jours"],
    ],
  );
});

test("les tokens de tous les comptes sont additionnés par jour", () => {
  const totals = aggregateAccountTokenDays({
    accounts: [
      { days: [usageDay("2026-07-12", 100, 80, 20), usageDay("2026-07-13", 250)] },
      { days: [usageDay("2026-07-12", 400, 300, 100), usageDay("2026-07-13", 50)] },
    ],
  });

  assert.equal(totals.get("2026-07-12")?.totalTokens, 500);
  assert.equal(totals.get("2026-07-12")?.inputTokens, 380);
  assert.equal(totals.get("2026-07-12")?.outputTokens, 120);
  assert.equal(totals.get("2026-07-13")?.totalTokens, 300);
});

test("la fenêtre de 30 jours est calendaire et traverse les changements de mois", () => {
  const keys = recentDateKeys("2026-03-02", 7);
  assert.deepEqual(keys, [
    "2026-02-24",
    "2026-02-25",
    "2026-02-26",
    "2026-02-27",
    "2026-02-28",
    "2026-03-01",
    "2026-03-02",
  ]);

  const series = buildAccountTokenSeries(
    { accounts: [{ days: [usageDay("2026-02-28", 120), usageDay("2026-03-02", 80)] }] },
    "2026-03-02",
    7,
  );
  assert.equal(series.length, 7);
  assert.equal(series[1].totalTokens, 0, "les jours sans activité restent visibles");
  assert.equal(sumTokenUsage(series).totalTokens, 200);
});

test("la page branche les boutons de période sur le re-rendu de la courbe", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  assert.match(main, /data-stats-range="\$\{range\.days\}"/);
  assert.match(main, /querySelectorAll<HTMLButtonElement>\("\[data-stats-range\]"\)/);
  assert.match(main, /statsRangeDays = range;\s*render\(\);/);
  assert.doesNotMatch(main, />14 jours</);
});
