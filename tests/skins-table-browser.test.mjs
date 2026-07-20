import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assessSkinbaronVerification,
  calculateCaseQuantityPlan,
  calculateEconomics,
  isEligibleCs2Case,
  mergeDealHistory,
  selectPreparationCandidate,
  selectAlerts,
} from "../scripts/skins-table-browser.mjs";

const browserSource = readFileSync(
  new URL("../scripts/skins-table-browser.mjs", import.meta.url),
  "utf8",
);

const prismaDeal = {
  name: "Prisma Case",
  buyPlatform: "SKINBARON",
  referencePlatform: "STEAM ORDER",
  buyPrice: 1.1494252873563218,
  buyPriceEur: 1,
  referencePrice: 2.11,
  sitePercent: 37.38,
  feePercent: 13,
};

test("la veille peut reprendre sa session dans le conteneur VPS Linux", () => {
  assert.match(browserSource, /process\.platform === "linux"/);
  assert.match(browserSource, /\/usr\/bin\/chromium/);
  assert.match(browserSource, /process\.env\.CST_DATA_DIR/);
  assert.match(browserSource, /cst-storage-state\.json/);
  assert.match(browserSource, /sanitizeSkinsTableStorageState/);
  assert.match(browserSource, /command === "export-session"/);
  assert.match(browserSource, /--disable-dev-shm-usage/);
});

test("calcule la marge Skins-Table après les frais Steam Order", () => {
  assert.deepEqual(
    calculateEconomics({ buyPrice: prismaDeal.buyPrice, referencePrice: 2.11, feePercent: 13 }),
    {
      netReferencePrice: 1.84,
      profitUsd: 0.69,
      marginPercent: 37.38,
      roiPercent: 59.71,
    },
  );
});

test("alerte une nouvelle affaire puis déduplique une valeur inchangée", () => {
  const initial = selectAlerts([prismaDeal], {});
  assert.equal(initial.length, 1);
  assert.equal(initial[0].alertReason, "new");
  const previous = { [initial[0].alertKey]: prismaDeal };
  assert.deepEqual(selectAlerts([prismaDeal], previous), []);
});

test("ne réalerte pas une affaire inchangée après un rejet temporaire", () => {
  const history = mergeDealHistory({}, [prismaDeal]);
  const historyAfterRejectedScan = mergeDealHistory(history, []);
  assert.deepEqual(selectAlerts([prismaDeal], historyAfterRejectedScan), []);
});

test("réalerte lors d'un changement de prix significatif", () => {
  const initial = selectAlerts([prismaDeal], {});
  const previous = { [initial[0].alertKey]: prismaDeal };
  const changed = selectAlerts([{ ...prismaDeal, buyPrice: 1.13, sitePercent: 38.1 }], previous);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].alertReason, "changed");
});

test("rejette Prisma quand le prix SkinBaron tradable réel fait tomber la marge sous 30 %", () => {
  const result = assessSkinbaronVerification(prismaDeal, {
    status: "verified",
    checkedAt: "2026-07-16T11:00:00.000Z",
    detailLink: "https://skinbaron.de/en/offers/show?metaOfferId=2514665",
    tradablePriceEur: 1.16,
    tradableCount: 60_359,
    tradeLockedPriceEur: 1.11,
    tradeLockedCount: 414,
  });
  assert.equal(result.accepted, false);
  assert.equal(result.rejection.verificationReason, "verified_margin_not_above_threshold");
  assert.equal(result.rejection.sitePercent, 27.37);
  assert.equal(result.rejection.skinbaronTradablePriceEur, 1.16);
});

test("accepte seulement l'offre tradable vérifiée quand sa marge réelle reste au-dessus de 30 %", () => {
  const result = assessSkinbaronVerification(prismaDeal, {
    status: "verified",
    checkedAt: "2026-07-16T11:00:00.000Z",
    detailLink: "https://skinbaron.de/en/offers/show?metaOfferId=2514665",
    tradablePriceEur: 1,
    tradableCount: 1,
    tradeLockedPriceEur: 0.8,
    tradeLockedCount: 20,
  });
  assert.equal(result.accepted, true);
  assert.equal(result.deal.sitePercent, 37.38);
  assert.equal(result.deal.skinbaronTradableCount, 1);
});

test("ne retient que les caisses CS2 et exclut les autres conteneurs", () => {
  assert.equal(isEligibleCs2Case("Prisma Case"), true);
  assert.equal(isEligibleCs2Case("CS:GO Weapon Case"), true);
  assert.equal(isEligibleCs2Case("Paris 2023 Legends Sticker Capsule"), false);
  assert.equal(isEligibleCs2Case("Stockholm 2021 Souvenir Package"), false);
  assert.equal(isEligibleCs2Case("Case Hardened"), false);
});

test("prepare en priorite la meilleure caisse tradable au-dessus de 30 %", () => {
  const selected = selectPreparationCandidate([
    {
      ...prismaDeal,
      skinbaronTradableCount: 2,
      skinbaronTradablePriceEur: 1,
      sitePercent: 31,
    },
    {
      ...prismaDeal,
      name: "Kilowatt Case",
      skinbaronTradableCount: 1,
      skinbaronTradablePriceEur: 0.9,
      sitePercent: 36,
    },
    {
      ...prismaDeal,
      name: "Sticker Capsule",
      skinbaronTradableCount: 10,
      skinbaronTradablePriceEur: 0.2,
      sitePercent: 80,
    },
  ]);
  assert.equal(selected.name, "Kilowatt Case");
});

test("selectionne au plus 100 caisses dans les seuls paliers strictement superieurs a 30 %", () => {
  const plan = calculateCaseQuantityPlan({
    availabilityRows: [
      { price: 1, amount: 40 },
      { price: 1.2, amount: 100 },
      { price: 1.4, amount: 50 },
    ],
    tableBuyPrice: 1,
    tableBuyPriceEur: 1,
    referencePrice: 2,
    feePercent: 0,
    balanceEur: 500,
    maxQuantity: 100,
    thresholdPercent: 30,
  });
  assert.equal(plan.accepted, true);
  assert.equal(plan.quantity, 100);
  assert.equal(plan.totalCostEur, 112);
  assert.equal(plan.maximumUnitPriceEur, 1.2);
  assert.equal(plan.worstMarginPercent, 40);
  assert.deepEqual(plan.tiers.map((tier) => tier.selected), [40, 60]);
});

test("limite aussi la quantite au solde disponible", () => {
  const plan = calculateCaseQuantityPlan({
    availabilityRows: [
      { price: 1, amount: 40 },
      { price: 1.2, amount: 100 },
    ],
    tableBuyPrice: 1,
    tableBuyPriceEur: 1,
    referencePrice: 2,
    feePercent: 0,
    balanceEur: 50,
    maxQuantity: 100,
    thresholdPercent: 30,
  });
  assert.equal(plan.accepted, true);
  assert.equal(plan.quantity, 48);
  assert.equal(plan.totalCostEur, 49.6);
  assert.equal(plan.estimatedRemainingBalanceEur, 0.4);
});
