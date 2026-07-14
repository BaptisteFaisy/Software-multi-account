export type ChatAccountReference = {
  id: string;
  label: string;
  provider?: "codex" | "claude";
  codexHome: string;
};

/**
 * Les limites et les chats sont charges par deux endpoints differents.
 * Detecte qu'un ajout/suppression de compte (eventuellement fait depuis une
 * autre fenetre) impose de recharger les settings avant d'ouvrir un chat.
 */
export const accountCatalogMatchesLimitRows = (
  accounts: ChatAccountReference[],
  limitRows: ChatAccountReference[],
): boolean => {
  if (accounts.length !== limitRows.length) return false;
  const accountsById = new Map(accounts.map((account) => [account.id, account]));
  return limitRows.every((row) => {
    const account = accountsById.get(row.id);
    return (
      account?.label === row.label &&
      account.codexHome === row.codexHome &&
      (account.provider ?? "codex") === (row.provider ?? "codex")
    );
  });
};
