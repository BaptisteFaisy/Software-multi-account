let activeAccountId: string | null = null;

export const setAccountStorageScope = (accountId: string | null | undefined): void => {
  const normalized = typeof accountId === "string" ? accountId.trim().slice(0, 512) : "";
  activeAccountId = normalized || null;
};

export const accountScopedStorageKey = (key: string): string =>
  activeAccountId
    ? `${key}.account.${encodeURIComponent(activeAccountId)}`
    : key;

const browserStorage = (): Storage | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

export const accountScopedStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (key) => browserStorage()?.getItem(accountScopedStorageKey(key)) ?? null,
  setItem: (key, value) => {
    browserStorage()?.setItem(accountScopedStorageKey(key), value);
  },
  removeItem: (key) => {
    browserStorage()?.removeItem(accountScopedStorageKey(key));
  },
};
