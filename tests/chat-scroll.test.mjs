import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_SCROLL_BOTTOM_EPSILON,
  CHAT_SCROLL_SETTLE_FRAMES,
  chatIsAtBottom,
  chatScrollSettleContinues,
  createChatScrollSettleState,
  restoreChatScrollTop,
  updateChatScrollState,
} from "../src/chat/scroll.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("un chat non manipule reste colle au dernier message", () => {
  const state = { followLatest: true, scrollTop: 300 };

  updateChatScrollState(state, {
    scrollTop: 300,
    scrollHeight: 1_100,
    clientHeight: 600,
  });

  assert.equal(state.followLatest, true);
  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 300,
      scrollHeight: 1_100,
      clientHeight: 600,
    }),
    500,
  );
});

test("une remontee utilisateur fige la position pendant les nouveaux messages", () => {
  const state = { followLatest: true, scrollTop: 500 };

  updateChatScrollState(
    state,
    { scrollTop: 180, scrollHeight: 1_100, clientHeight: 600 },
    "away",
  );

  assert.equal(state.followLatest, false);
  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 180,
      scrollHeight: 1_350,
      clientHeight: 600,
    }),
    180,
  );
});

test("revenir en bas reactive automatiquement le suivi", () => {
  const state = { followLatest: false, scrollTop: 180 };
  const metrics = { scrollTop: 590, scrollHeight: 1_200, clientHeight: 600 };

  assert.equal(CHAT_SCROLL_BOTTOM_EPSILON, 12);
  assert.equal(chatIsAtBottom(metrics), true);
  updateChatScrollState(state, metrics, "toward-latest");

  assert.equal(state.followLatest, true);
  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 590,
      scrollHeight: 1_400,
      clientHeight: 600,
    }),
    800,
  );
});

test("un rendu au bas du fil ne reactive pas le suivi sans geste utilisateur", () => {
  const state = { followLatest: false, scrollTop: 180 };

  updateChatScrollState(state, {
    scrollTop: 400,
    scrollHeight: 1_000,
    clientHeight: 600,
  });

  assert.equal(state.followLatest, false);
  assert.equal(state.scrollTop, 180);
  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 400,
      scrollHeight: 1_400,
      clientHeight: 600,
    }),
    180,
  );
});

test("un fil momentanement non defilable conserve la pause utilisateur", () => {
  const state = { followLatest: false, scrollTop: 180 };

  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 0,
      scrollHeight: 600,
      clientHeight: 600,
    }),
    0,
  );
  assert.equal(state.followLatest, false);

  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 0,
      scrollHeight: 1_400,
      clientHeight: 600,
    }),
    180,
  );
});

test("le suivi est branche sur le chat principal et chaque fenetre experte", () => {
  assert.match(main, /bindChatFeedScroll\(mainChatFeed\)/);
  assert.match(main, /if \(feed\) bindChatFeedScroll\(feed, pane\)/);
  assert.match(main, /window\.requestAnimationFrame/);
  assert.match(view, /data-chat-control="feed"[^>]*tabindex="0"/);
});

// Un fil reconstruit repart de tours neufs : ceux qui portent
// `content-visibility: auto` ne pesent que leur taille de repli tant que le
// navigateur ne les a pas rendus. La hauteur mesuree est donc trop courte, la
// position visee est ecretee, et sans rattrapage le chat reste tout en haut.
test("une hauteur sous-evaluee ne fige pas la position ecretee", () => {
  const state = { followLatest: false, scrollTop: 9_000 };
  const settle = createChatScrollSettleState({
    scrollTop: 0,
    scrollHeight: 3_000,
    clientHeight: 600,
  });

  // Premier passage : le fil ne mesure que 3 000 px, on ne peut pas atteindre
  // la cible. Un nouveau passage reste necessaire.
  assert.equal(
    chatScrollSettleContinues(settle, state, {
      scrollTop: 2_400,
      scrollHeight: 3_000,
      clientHeight: 600,
    }),
    true,
  );

  // Les tours sautes se rendent, la hauteur remonte : la cible redevient
  // atteignable et la position memorisee n'a pas ete abimee entre-temps.
  assert.equal(state.scrollTop, 9_000);
  assert.equal(
    restoreChatScrollTop(state, {
      scrollTop: 2_400,
      scrollHeight: 40_000,
      clientHeight: 600,
    }),
    9_000,
  );
});

test("le rattrapage s'arrete des que la hauteur et la position sont stables", () => {
  const state = { followLatest: true, scrollTop: 800 };
  const metrics = { scrollTop: 1_400, scrollHeight: 2_000, clientHeight: 600 };
  const settle = createChatScrollSettleState(metrics);

  assert.equal(chatScrollSettleContinues(settle, state, metrics), true);
  assert.equal(chatScrollSettleContinues(settle, state, metrics), false);
});

test("le rattrapage est borne meme si la hauteur ne se stabilise jamais", () => {
  const state = { followLatest: true, scrollTop: 0 };
  const settle = createChatScrollSettleState({
    scrollTop: 0,
    scrollHeight: 1_000,
    clientHeight: 600,
  });

  let frames = 0;
  let scrollHeight = 1_000;
  while (
    chatScrollSettleContinues(settle, state, {
      scrollTop: 0,
      scrollHeight: (scrollHeight += 500),
      clientHeight: 600,
    })
  ) {
    frames += 1;
    assert.ok(frames <= CHAT_SCROLL_SETTLE_FRAMES, "le rattrapage doit rester borne");
  }
  assert.equal(frames, CHAT_SCROLL_SETTLE_FRAMES - 1);
});

test("la hauteur reelle du fil est mesurable pendant une restauration", () => {
  assert.match(style, /\.chat-feed\.is-measuring-scroll \.chat-turn \{\s*content-visibility: visible;/);
  assert.match(main, /const CHAT_FEED_MEASURING_CLASS = "is-measuring-scroll"/);
  // Le patch qui retourne le conteneur a reconstruit tout le fil.
  assert.match(main, /restoreChatFeedScroll\(feed, chatScrollState, feedPatchRoot === feed\)/);
  assert.match(main, /restoreExpertChatScroll\(pane, root, feedPatchRoot === feed\)/);
});

test("un scroll pose par le code ne passe pas pour un geste utilisateur", () => {
  assert.match(main, /chatProgrammaticScrollTops/);
  assert.match(main, /const userIntent: ChatScrollUserIntent = programmatic\s*\?\s*"none"/);
  // Un geste explicite reprend la main sur le rattrapage.
  assert.match(main, /cancelChatFeedScrollRestore\(feed\);\s*\n\s*userScrollIntent = intent;/);
});
