import assert from "node:assert/strict";
import test from "node:test";

import {
  bestQuotaAccount,
  bestQuotaAccountForNewChat,
  deduplicateQuotaAccountsForDisplay,
  isQuotaExhaustionError,
  OPEN_CHAT_QUOTA_RESERVATION_PERCENT,
  quotaAfterOpenChatReservations,
  remainingQuotaPercent,
  shouldRecoverRunningQuotaTurn,
} from "../src/chat/quota.ts";
import { readFileSync } from "node:fs";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const chatView = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");

test("reconnait les erreurs de quota sans confondre la fenetre de contexte", () => {
  assert.equal(isQuotaExhaustionError("You've hit your usage limit. Try again later."), true);
  assert.equal(isQuotaExhaustionError("rate_limit_exceeded (HTTP 429)"), true);
  assert.equal(isQuotaExhaustionError("Quota de jetons epuise"), true);
  assert.equal(isQuotaExhaustionError("Maximum context length exceeded"), false);
  assert.equal(isQuotaExhaustionError("Le prompt est trop long"), false);
});

test("le quota restant correspond a la limite la plus contraignante", () => {
  assert.equal(
    remainingQuotaPercent({
      id: "a",
      hasTokens: true,
      sessionUsedPercent: 35,
      weeklyUsedPercent: 72,
      buckets: [],
    }),
    28,
  );
  assert.equal(
    remainingQuotaPercent({
      id: "a",
      hasTokens: true,
      sessionUsedPercent: 1,
      buckets: [{ usedPercent: 2, rateLimitReachedType: "primary" }],
    }),
    0,
  );
});

test("choisit le compte compatible ayant le plus de quota", () => {
  const accounts = [
    { id: "courant", hasTokens: true, sessionUsedPercent: 100 },
    { id: "faible", hasTokens: true, sessionUsedPercent: 75, weeklyUsedPercent: 40 },
    { id: "meilleur", hasTokens: true, sessionUsedPercent: 25, weeklyUsedPercent: 35 },
    { id: "autre-provider", hasTokens: true, sessionUsedPercent: 0, weeklyUsedPercent: 0 },
  ];

  assert.deepEqual(
    bestQuotaAccount(accounts, "courant", ["faible", "meilleur"]),
    { account: accounts[2], remainingPercent: 65 },
  );
});

test("les limites visibles sont reactivees toutes les 30 secondes", () => {
  assert.match(main, /const LIMIT_POLL_INTERVAL_MS = 30_000/);
  assert.match(
    main,
    /runWhenPageVisible\(\(\) => void refreshLimitStatus\(\)\)[\s\S]*?LIMIT_POLL_INTERVAL_MS/,
  );
});

test("reserve 20 points de quota par chat deja ouvert", () => {
  assert.equal(OPEN_CHAT_QUOTA_RESERVATION_PERCENT, 20);
  assert.deepEqual(quotaAfterOpenChatReservations(86, 2), {
    effectiveRemainingPercent: 46,
    reservedPercent: 40,
  });
  assert.deepEqual(quotaAfterOpenChatReservations(50, 3), {
    effectiveRemainingPercent: 0,
    reservedPercent: 60,
  });
});

test("le nouveau chat choisit le plus gros quota apres reservation des chats ouverts", () => {
  const accounts = [
    { id: "presque-vide", hasTokens: true, sessionUsedPercent: 80 },
    { id: "occupe", hasTokens: true, sessionUsedPercent: 10 },
    { id: "libre", hasTokens: true, sessionUsedPercent: 30 },
  ];

  assert.deepEqual(
    bestQuotaAccountForNewChat(
      accounts,
      accounts.map((account) => account.id),
      ["occupe", "occupe"],
    ),
    {
      account: accounts[2],
      remainingPercent: 70,
      effectiveRemainingPercent: 70,
      openChatCount: 0,
      reservedPercent: 0,
    },
    "deux chats retranchent 40 points au compte qui avait 90 % de quota serveur",
  );
});

test("la modale peut ouvrir directement avec le compte le plus disponible", () => {
  assert.match(main, /id="confirmBestQuotaNewChat"/);
  assert.match(main, /const confirmNewChatWithBestQuota = async/);
  assert.match(
    main,
    /bestQuotaAccountForNewChat\([\s\S]*?openChatAccountIdsForQuotaSelection\(\)/,
  );
  assert.match(main, /void confirmNewChatWithBestQuota\(\)/);
});

test("n'affiche qu'une limite pour plusieurs profils partageant le meme home", () => {
  const rows = [
    {
      id: "copie-ancienne",
      provider: "codex",
      codexHome: "%CST_DATA_DIR%\\codex-homes\\compte",
      hasTokens: false,
      source: "unavailable",
      error: "lecture impossible",
      refreshedAt: 10,
    },
    {
      id: "principal",
      provider: "codex",
      codexHome: "%cst_data_dir%/codex-homes/compte/",
      hasTokens: true,
      source: "server",
      refreshedAt: 20,
    },
    {
      id: "claude-separe",
      provider: "claude",
      codexHome: "%CST_DATA_DIR%/codex-homes/compte",
      hasTokens: true,
      source: "authenticated",
      refreshedAt: 20,
    },
  ];

  assert.deepEqual(
    deduplicateQuotaAccountsForDisplay(rows).map((row) => row.id),
    ["principal", "claude-separe"],
  );
});

test("recupere un tour running quand son compte atteint reellement zero", () => {
  const exhausted = {
    id: "epuise",
    hasTokens: true,
    weeklyUsedPercent: 100,
    buckets: [{ rateLimitReachedType: "rate_limit_reached" }],
  };
  const available = {
    id: "disponible",
    hasTokens: true,
    weeklyUsedPercent: 72,
    buckets: [],
  };

  assert.equal(
    shouldRecoverRunningQuotaTurn(
      { id: 10, accountId: "epuise", status: "running" },
      [exhausted, available],
    ),
    true,
    "une commande sans sortie ne doit pas maintenir le tour indefiniment",
  );
  assert.equal(
    shouldRecoverRunningQuotaTurn(
      { id: 10, accountId: "disponible", status: "running" },
      [exhausted, available],
    ),
    false,
  );
  assert.equal(
    shouldRecoverRunningQuotaTurn(
      { id: 0, accountId: "epuise", status: "running" },
      [exhausted],
    ),
    false,
    "le demarrage optimiste attend encore son identifiant backend",
  );
  assert.equal(
    shouldRecoverRunningQuotaTurn(
      { id: 10, accountId: "epuise", status: "completed" },
      [exhausted],
    ),
    false,
  );
});

test("un quota epuise transfere automatiquement la discussion sans bouton", () => {
  const start = main.indexOf("const automaticallyTransferQuotaExhaustedDiscussion =");
  const end = main.indexOf("\nconst readChatPreferences", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const automaticTransfer = main.slice(start, end);

  assert.match(automaticTransfer, /await refreshQuotaAlternatives\(\)/);
  assert.match(automaticTransfer, /quotaSuggestionFor\(currentTurn, currentDiscussion\)/);
  assert.match(
    automaticTransfer,
    /await continueDiscussionWith\(currentDiscussion, suggestion\.accountId, pane\)/,
  );
  assert.ok(
    (main.match(/automaticallyTransferQuotaExhaustedDiscussion\(/g) ?? []).length >= 5,
    "les echecs immediats et suivis des deux vues doivent lancer le transfert",
  );
  assert.match(chatView, /Transfert automatique vers/);
  assert.doesNotMatch(chatView, /data-chat-action="quota-switch"/);
});

test("le polling de quota arrete une commande bloquee avant le transfert", () => {
  const refreshStart = main.indexOf("const refreshLimitStatus =");
  const refreshEnd = main.indexOf("\n// Ouvre un terminal interactif", refreshStart);
  const automaticStart = main.indexOf("const automaticallyTransferQuotaExhaustedDiscussion =");
  const automaticEnd = main.indexOf("\nconst readChatPreferences", automaticStart);
  assert.notEqual(refreshStart, -1);
  assert.notEqual(refreshEnd, -1);
  assert.notEqual(automaticStart, -1);
  assert.notEqual(automaticEnd, -1);

  const refresh = main.slice(refreshStart, refreshEnd);
  const automaticTransfer = main.slice(automaticStart, automaticEnd);
  assert.match(refresh, /recoverQuotaExhaustedChatTurns\(\)/);
  assert.match(automaticTransfer, /shouldRecoverRunningQuotaTurn\(currentTurn, limitStatus\)/);
  assert.match(automaticTransfer, /"stop_chat_turn"/);
  assert.ok(
    automaticTransfer.indexOf('"stop_chat_turn"') <
      automaticTransfer.indexOf("continueDiscussionWith(currentDiscussion, suggestion.accountId, pane)"),
    "la commande source doit etre terminee avant de copier et reprendre la discussion",
  );
});

test("la fenetre source ferme seulement apres l'archivage reussi", () => {
  const closeStart = main.indexOf("const closeTransferredDiscussionSource =");
  const archiveStart = main.indexOf("const archiveTransferredDiscussion =", closeStart);
  const archiveEnd = main.indexOf("\nconst transferredDiscussionStatus", archiveStart);
  assert.notEqual(closeStart, -1);
  assert.notEqual(archiveStart, -1);
  assert.notEqual(archiveEnd, -1);

  const closeSource = main.slice(closeStart, archiveStart);
  const archiveSource = main.slice(archiveStart, archiveEnd);
  assert.match(closeSource, /candidate\.accountId === discussion\.accountId/);
  assert.match(closeSource, /stopExpertChatSync\(pane\)/);
  assert.match(closeSource, /expertChatPanes = expertChatPanes\.filter/);
  assert.ok(
    archiveSource.indexOf('invoke<{ count?: number }>("delete_discussion"') <
      archiveSource.indexOf("closeTransferredDiscussionSource(discussion)"),
    "la source ne doit fermer qu'apres la confirmation du backend",
  );
  assert.match(
    main,
    /return snapshot\.status !== "failed" && snapshot\.status !== "cancelled"/,
  );
});
