import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_EXPERT_CHAT_DISPLAY_MODE,
  DEFAULT_EXPERT_CHAT_PAGE_SIZE,
  DEFAULT_EXPERT_CHAT_PAGE_SIZE_MODE,
  clampExpertChatPage,
  expertChatPageCount,
  expertChatPageForIndex,
  expertChatColumnCount,
  expertChatGridDimensions,
  expertChatRowCount,
  expertChatsForDisplay,
  expertChatsOnPage,
  normalizeExpertChatDisplayMode,
  normalizeExpertChatPageSize,
  normalizeExpertChatPageSizeMode,
  resolveExpertChatPageSize,
} from "../src/chat/expert.ts";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const style = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");

test("la grille propose 6, 9, 12 ou 16 chats par page", () => {
  assert.equal(DEFAULT_EXPERT_CHAT_PAGE_SIZE, 6);
  assert.equal(normalizeExpertChatPageSize("6"), 6);
  assert.equal(normalizeExpertChatPageSize("9"), 9);
  assert.equal(normalizeExpertChatPageSize("12"), 12);
  assert.equal(normalizeExpertChatPageSize("16"), 16);
  assert.equal(normalizeExpertChatPageSize("15"), 6);
  assert.equal(expertChatColumnCount(12), 3);
  assert.equal(expertChatColumnCount(16), 4);
  assert.equal(expertChatRowCount(6), 2);
  assert.equal(expertChatRowCount(9), 3);
  assert.equal(expertChatRowCount(12), 4);
  assert.equal(expertChatRowCount(16), 4);
});

test("le mode auto adapte la grille au nombre de chats visibles", () => {
  assert.equal(DEFAULT_EXPERT_CHAT_PAGE_SIZE_MODE, "auto");
  assert.equal(normalizeExpertChatPageSizeMode(null), "auto");
  assert.equal(normalizeExpertChatPageSizeMode("auto"), "auto");
  assert.equal(normalizeExpertChatPageSizeMode("9"), 9);
  assert.equal(resolveExpertChatPageSize("auto"), 16);

  assert.deepEqual(expertChatGridDimensions(0, "auto"), { columns: 1, rows: 1 });
  assert.deepEqual(expertChatGridDimensions(1, "auto"), { columns: 1, rows: 1 });
  assert.deepEqual(expertChatGridDimensions(2, "auto"), { columns: 2, rows: 1 });
  assert.deepEqual(expertChatGridDimensions(3, "auto"), { columns: 3, rows: 1 });
  assert.deepEqual(expertChatGridDimensions(4, "auto"), { columns: 2, rows: 2 });
  assert.deepEqual(expertChatGridDimensions(6, "auto"), { columns: 3, rows: 2 });
  assert.deepEqual(expertChatGridDimensions(10, "auto"), { columns: 3, rows: 4 });
  assert.deepEqual(expertChatGridDimensions(16, "auto"), { columns: 4, rows: 4 });
});

test("le mode d'affichage peut ne garder que les chats disponibles", () => {
  const chats = [
    { id: "new", status: "idle" },
    { id: "working", status: "running" },
    { id: "syncing", status: "finalizing" },
    { id: "done", status: "completed" },
  ];
  const isAvailable = (chat) => !["running", "finalizing"].includes(chat.status);

  assert.equal(DEFAULT_EXPERT_CHAT_DISPLAY_MODE, "all");
  assert.equal(normalizeExpertChatDisplayMode(null), "all");
  assert.equal(normalizeExpertChatDisplayMode("invalid"), "all");
  assert.equal(normalizeExpertChatDisplayMode("available"), "available");
  assert.deepEqual(expertChatsForDisplay(chats, "all", isAvailable), chats);
  assert.deepEqual(
    expertChatsForDisplay(chats, "available", isAvailable).map((chat) => chat.id),
    ["new", "done"],
  );
});

test("le reglage Disponibles pilote le mur principal et reste persistant", () => {
  assert.match(main, /id="chatDisplaySettingsTitle">Affichage de la fenêtre principale/);
  assert.match(main, /data-chat-display-mode="all"/);
  assert.match(main, /data-chat-display-mode="available"/);
  assert.match(
    main,
    /localStorage\.setItem\(EXPERT_CHAT_DISPLAY_MODE_STORAGE_KEY, nextMode\)/,
  );
  assert.match(main, /expertChatDisplayMode = loadExpertChatDisplayMode\(\)/);
  assert.match(
    main,
    /expertChatsForDisplay\(\s*expertChatPanesForCurrentEnvironment\(\),\s*expertChatDisplayMode,\s*expertChatPaneIsAvailable,?\s*\)/,
  );
});

test("un chat masque reste suivi et le mur est rerendu a la fin du tour", () => {
  assert.match(
    main,
    /expertChatDisplayMode === "available"\s*&& currentEnvironmentPanes\.has\(pane\)/,
  );
  assert.match(main, /refreshExpertChatDisplayAfterAvailabilityChange/);
  assert.match(
    main,
    /const wasAvailable = expertChatPaneIsAvailable\(pane\);[\s\S]*?pane\.turn = \{[\s\S]*?status: "running"[\s\S]*?refreshExpertChatDisplayAfterAvailabilityChange\(\s*pane,\s*wasAvailable,?\s*\)/,
  );
  assert.match(main, /Ils réapparaîtront automatiquement ici dès que leur tâche sera terminée/);
});

test("une taille fixe conserve sa grille meme si la page est incomplete", () => {
  assert.deepEqual(expertChatGridDimensions(1, 6), { columns: 3, rows: 2 });
  assert.deepEqual(expertChatGridDimensions(2, 9), { columns: 3, rows: 3 });
  assert.deepEqual(expertChatGridDimensions(3, 16), { columns: 4, rows: 4 });
});

test("l'interface expose et persiste le mode auto", () => {
  assert.match(main, /<option value="auto"[^>]*>Auto<\/option>/);
  assert.match(
    main,
    /expertChatGridDimensions\(\s*pagePanes\.length,\s*expertChatPageSizeMode,?\s*\)/,
  );
  assert.match(
    main,
    /localStorage\.setItem\(EXPERT_CHATS_PER_PAGE_STORAGE_KEY, String\(expertChatPageSizeMode\)\)/,
  );
});

test("le bandeau superieur des chats peut etre masque puis restaure", () => {
  assert.match(main, /id="expertChatToolbarHide"/);
  assert.match(main, /id="expertChatToolbarShow"/);
  assert.match(
    main,
    /localStorage\.setItem\(EXPERT_CHAT_TOOLBAR_HIDDEN_STORAGE_KEY, String\(hidden\)\)/,
  );
  assert.match(main, /expertChatToolbarHidden = loadExpertChatToolbarHidden\(\)/);
  assert.match(
    style,
    /\.expert-chat-workspace\.is-toolbar-hidden \.expert-chat-toolbar\s*\{[^}]*height:\s*0;[^}]*visibility:\s*hidden;/,
  );
  assert.match(
    style,
    /\.expert-chat-workspace\.is-toolbar-hidden \.expert-chat-toolbar-restore\s*\{[^}]*display:\s*grid;/,
  );
});

test("les controles de pagination sont centres dans le bandeau des chats", () => {
  assert.match(
    style,
    /\.expert-chat-count\s*\{[^}]*align-items:\s*center;[^}]*justify-content:\s*center;/,
  );
  assert.match(
    style,
    /\.expert-chat-pagination > span\s*\{[^}]*align-items:\s*center;/,
  );
  assert.match(
    style,
    /\.expert-chat-toolbar-actions > \.expert-chat-count,[\s\S]*?\.expert-chat-toolbar-actions > \.expert-chat-pagination\s*\{[^}]*height:\s*38px;[^}]*min-height:\s*38px;/,
  );
});

test("les chats sont pagines sans limite et gardent leur ordre", () => {
  const chats = Array.from({ length: 100 }, (_, index) => index + 1);

  assert.equal(expertChatPageCount(chats.length, 6), 17);
  assert.deepEqual(expertChatsOnPage(chats, 0, 6), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(expertChatsOnPage(chats, 1, 6), [7, 8, 9, 10, 11, 12]);
  assert.deepEqual(expertChatsOnPage(chats, 16, 6), [97, 98, 99, 100]);

  assert.equal(expertChatPageCount(chats.length, 9), 12);
  assert.deepEqual(expertChatsOnPage(chats, 11, 9), [100]);
  assert.equal(expertChatPageCount(chats.length, 12), 9);
  assert.equal(expertChatPageCount(chats.length, 16), 7);
  assert.equal(expertChatPageCount(chats.length, "auto"), 7);
  assert.deepEqual(expertChatsOnPage(chats, 0, "auto"), chats.slice(0, 16));
  assert.deepEqual(expertChatsOnPage(chats, 6, "auto"), [97, 98, 99, 100]);
});

test("un nouveau chat est place sur la page suivante", () => {
  assert.equal(expertChatPageForIndex(5, 6), 0);
  assert.equal(expertChatPageForIndex(6, 6), 1);
  assert.equal(expertChatPageForIndex(8, 9), 0);
  assert.equal(expertChatPageForIndex(9, 9), 1);
  assert.equal(expertChatPageForIndex(11, 12), 0);
  assert.equal(expertChatPageForIndex(12, 12), 1);
  assert.equal(expertChatPageForIndex(15, 16), 0);
  assert.equal(expertChatPageForIndex(16, 16), 1);
});

test("la page courante reste toujours valide", () => {
  assert.equal(clampExpertChatPage(-4, 12, 6), 0);
  assert.equal(clampExpertChatPage(8, 12, 6), 1);
  assert.equal(clampExpertChatPage(3, 0, 9), 0);
});
