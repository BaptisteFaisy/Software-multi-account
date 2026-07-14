import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_SIDEBAR_MAX_WIDTH,
  CHAT_SIDEBAR_MIN_WIDTH,
  activeChatTurnForDiscussion,
  chatSidebarStatus,
  chatSidebarStatusLabel,
  chatSidebarMaxWidth,
  clampChatSidebarWidth,
  defaultChatSidebarWidth,
  discussionForSession,
  orderChatSidebarDiscussions,
} from "../src/chat/sidebar.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("la barre de conversations utilise une largeur lisible par defaut", () => {
  assert.equal(defaultChatSidebarWidth(1440), 312);
  assert.equal(defaultChatSidebarWidth(980), 280);
});

test("la largeur redimensionnee reste dans ses bornes", () => {
  assert.equal(clampChatSidebarWidth(-20, 1440), CHAT_SIDEBAR_MIN_WIDTH);
  assert.equal(clampChatSidebarWidth(0, 1440), 0);
  assert.equal(clampChatSidebarWidth(80, 1440), 80);
  assert.equal(clampChatSidebarWidth(900, 1440), CHAT_SIDEBAR_MAX_WIDTH);
  assert.equal(clampChatSidebarWidth(318.6, 1440), 319);
});

test("la barre de conversations peut etre entierement masquee", () => {
  assert.equal(CHAT_SIDEBAR_MIN_WIDTH, 0);
  assert.equal(clampChatSidebarWidth(0, 760), 0);
});

test("des boutons explicites permettent de masquer puis restaurer la barre laterale", () => {
  assert.match(
    main,
    /id="chatSidebarCollapse"[^>]*class="icon-button chat-sidebar-collapse"[^>]*data-toggle-chat-sidebar[^>]*aria-label="Masquer la barre latérale"/,
  );
  assert.match(
    main,
    /class="icon-button chat-sidebar-expand"[^>]*data-toggle-chat-sidebar[^>]*aria-label="Afficher la barre latérale"/,
  );
  assert.match(
    style,
    /\.chat-app-layout\.is-sidebar-collapsed \.chat-sidebar-expand\s*\{[^}]*display: inline-flex;/s,
  );
  assert.match(main, /setChatSidebarWidth\(0\)/);
  assert.match(main, /setChatSidebarWidth\(defaultChatSidebarWidth\(window\.innerWidth\)\)/);
});

test("la poignee reste collee au bord gauche quand la barre est masquee", () => {
  assert.match(
    style,
    /\.chat-app-layout\.is-sidebar-collapsed \.chat-sidebar-resizer::before,\s*\.chat-app-layout\.is-sidebar-collapsed \.chat-sidebar-resizer::after\s*\{[^}]*left:\s*0;/s,
  );
});

test("la fenetre de chat garde au moins 360 pixels", () => {
  assert.equal(chatSidebarMaxWidth(760), 400);
  assert.equal(clampChatSidebarWidth(420, 760), 400);
});

test("les pastilles de la colonne de gauche suivent le statut du chat", () => {
  assert.equal(chatSidebarStatus("running", false), "running");
  assert.equal(chatSidebarStatus("running", true), "question");
  assert.equal(chatSidebarStatus("completed", true), "question");
  assert.equal(chatSidebarStatus("finalizing", true), "question");
  assert.equal(chatSidebarStatus("finalizing", false), "running");
  assert.equal(chatSidebarStatus("completed", false), "idle");
  assert.equal(chatSidebarStatusLabel("running"), "En cours");
  assert.equal(chatSidebarStatusLabel("question"), "Question");
  assert.equal(chatSidebarStatusLabel("idle"), "Disponible");
});

test("un tour serveur actif est retrouve apres reload et a travers un fork", () => {
  const discussion = {
    accountId: "account-a",
    sessionId: "logical-session",
    rolloutId: "latest-rollout",
  };
  const turns = [
    {
      id: 4,
      accountId: "account-b",
      sessionId: "latest-rollout",
      status: "running",
      startedAt: 40,
    },
    {
      id: 5,
      accountId: "account-a",
      sessionId: "latest-rollout",
      status: "running",
      startedAt: 50,
    },
    {
      id: 6,
      accountId: "account-a",
      sessionId: "logical-session",
      status: "completed",
      startedAt: 60,
    },
  ];

  assert.equal(activeChatTurnForDiscussion(turns, discussion)?.id, 5);
  assert.equal(activeChatTurnForDiscussion(turns, { ...discussion, accountId: "missing" }), null);
});

test("un chat orchestre s'ouvre avec son rollout courant", () => {
  const discussions = [
    {
      accountId: "account-a",
      sessionId: "logical-session",
      rolloutId: "latest-rollout",
    },
    {
      accountId: "account-b",
      sessionId: "other-session",
      rolloutId: "latest-rollout",
    },
  ];

  assert.equal(
    discussionForSession(discussions, "account-a", "logical-session"),
    discussions[0],
  );
  assert.equal(
    discussionForSession(discussions, "account-a", "latest-rollout"),
    discussions[0],
  );
  assert.equal(discussionForSession(discussions, "missing", "latest-rollout"), null);
});

test("l'activite d'un chat ne change jamais sa place dans l'environnement", () => {
  const discussions = [
    { sessionId: "ancien", startedAt: 100, lastActivity: 900 },
    { sessionId: "recent-b", startedAt: 200, lastActivity: 400 },
    { sessionId: "recent-a", startedAt: 200, lastActivity: 300 },
  ];

  const initialOrder = orderChatSidebarDiscussions(discussions).map(({ sessionId }) => sessionId);
  const refreshedOrder = orderChatSidebarDiscussions([
    { ...discussions[0], lastActivity: 2_000 },
    { ...discussions[1], lastActivity: 401 },
    { ...discussions[2], lastActivity: 1_500 },
  ]).map(({ sessionId }) => sessionId);

  assert.deepEqual(initialOrder, ["recent-a", "recent-b", "ancien"]);
  assert.deepEqual(refreshedOrder, initialOrder);
  assert.deepEqual(
    discussions.map(({ sessionId }) => sessionId),
    ["ancien", "recent-b", "recent-a"],
    "le tri ne doit pas muter le snapshot recu",
  );
});

test("retirer un chat depuis la colonne de gauche utilise une modale integree", () => {
  const start = main.indexOf("const openDiscussionArchiveModal =");
  const end = main.indexOf("// Compte cible retenu", start);
  assert.ok(start >= 0 && end > start, "parcours d'archivage introuvable");
  assert.doesNotMatch(main.slice(start, end), /window\.confirm/);
  assert.match(main, /id="discussionArchiveBackdrop"/);
  assert.match(main, /aria-labelledby="discussionArchiveTitle"/);
  assert.match(main, /id="cancelDiscussionArchive" data-dialog-initial-focus/);
  assert.match(main, /if \(discussion\) openDiscussionArchiveModal\(discussion\)/);
  assert.match(style, /\.discussion-archive-modal/);
});
