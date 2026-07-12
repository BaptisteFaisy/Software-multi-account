import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_EXPERT_CHAT_PAGE_SIZE,
  clampExpertChatPage,
  expertChatPageCount,
  expertChatPageForIndex,
  expertChatRowCount,
  expertChatsOnPage,
  normalizeExpertChatPageSize,
} from "../src/chat/expert.ts";

test("le mode expert propose 6 ou 9 chats par page", () => {
  assert.equal(DEFAULT_EXPERT_CHAT_PAGE_SIZE, 6);
  assert.equal(normalizeExpertChatPageSize("6"), 6);
  assert.equal(normalizeExpertChatPageSize("9"), 9);
  assert.equal(normalizeExpertChatPageSize("16"), 6);
  assert.equal(expertChatRowCount(6), 2);
  assert.equal(expertChatRowCount(9), 3);
});

test("les chats sont pagines sans limite et gardent leur ordre", () => {
  const chats = Array.from({ length: 100 }, (_, index) => index + 1);

  assert.equal(expertChatPageCount(chats.length, 6), 17);
  assert.deepEqual(expertChatsOnPage(chats, 0, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(expertChatsOnPage(chats, 1, 6), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(expertChatsOnPage(chats, 16, 6), [97, 98, 99, 100]);

  assert.equal(expertChatPageCount(chats.length, 9), 12);
  assert.deepEqual(expertChatsOnPage(chats, 11, 9), [100]);
});

test("un nouveau chat est place sur la page suivante", () => {
  assert.equal(expertChatPageForIndex(5, 6), 0);
  assert.equal(expertChatPageForIndex(6, 6), 1);
  assert.equal(expertChatPageForIndex(8, 9), 0);
  assert.equal(expertChatPageForIndex(9, 9), 1);
});

test("la page courante reste toujours valide", () => {
  assert.equal(clampExpertChatPage(-4, 12, 6), 0);
  assert.equal(clampExpertChatPage(8, 12, 6), 1);
  assert.equal(clampExpertChatPage(3, 0, 9), 0);
});
