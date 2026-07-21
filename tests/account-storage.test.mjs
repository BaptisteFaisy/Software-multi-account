import assert from "node:assert/strict";
import test from "node:test";

import {
  accountScopedStorage,
  accountScopedStorageKey,
  setAccountStorageScope,
} from "../src/account-storage.ts";

const memory = new Map();
const previousWindow = globalThis.window;

globalThis.window = {
  localStorage: {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: (key) => memory.delete(key),
  },
};

test.after(() => {
  setAccountStorageScope(null);
  if (previousWindow === undefined) delete globalThis.window;
  else globalThis.window = previousWindow;
});

test("le stockage local d'un compte est invisible depuis un autre compte", () => {
  setAccountStorageScope("alice");
  accountScopedStorage.setItem("documents", "projet-secret");
  assert.equal(
    accountScopedStorageKey("documents"),
    "documents.account.alice",
  );

  setAccountStorageScope("bob");
  assert.equal(accountScopedStorage.getItem("documents"), null);
  accountScopedStorage.setItem("documents", "projet-bob");

  setAccountStorageScope("alice");
  assert.equal(accountScopedStorage.getItem("documents"), "projet-secret");
});

test("les identifiants sont echappes dans les cles de stockage", () => {
  setAccountStorageScope("compte avec/espace");
  assert.equal(
    accountScopedStorageKey("chats"),
    "chats.account.compte%20avec%2Fespace",
  );
});
