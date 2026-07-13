import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CHAT_SCROLL_BOTTOM_EPSILON,
  chatIsAtBottom,
  restoreChatScrollTop,
  updateChatScrollState,
} from "../src/chat/scroll.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const view = readFileSync(new URL("../src/chat/view.ts", import.meta.url), "utf8");

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
    true,
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
  updateChatScrollState(state, metrics, true);

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

test("le suivi est branche sur le chat principal et chaque fenetre experte", () => {
  assert.match(main, /bindChatFeedScroll\(mainChatFeed\)/);
  assert.match(main, /if \(feed\) bindChatFeedScroll\(feed, pane\)/);
  assert.match(main, /window\.requestAnimationFrame/);
  assert.match(view, /data-chat-control="feed"[^>]*tabindex="0"/);
});
