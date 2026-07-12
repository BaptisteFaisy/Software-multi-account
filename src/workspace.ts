export type WorkspaceProfile = {
  id: string;
  label: string;
  path: string;
};

/**
 * Identite stable d'un workspace. Les chemins Windows et UNC sont compares
 * sans tenir compte de la casse, contrairement aux chemins Unix distants.
 */
export const normalizeWorkspacePath = (path: string): string => {
  const normalized = path.trim().replace(/[\\/]+$/, "").replaceAll("\\", "/");
  return /^[a-zA-Z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
};

export const workspaceIdForPath = (path: string): string => normalizeWorkspacePath(path);

export const workspaceBaseName = (path: string): string =>
  (path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path).replace(/\.git$/i, "");

export type MergedWorkspaceProfiles = {
  workspaces: WorkspaceProfile[];
  changed: boolean;
};

/**
 * Recalcule toujours l'id depuis le chemin puis fusionne les doublons. Garder
 * la premiere occurrence preserve son chemin d'affichage et son libelle, tout
 * en donnant une identite commune aux chats et aux terminaux rattaches.
 */
export const mergeWorkspaceProfiles = (
  profiles: readonly WorkspaceProfile[],
): MergedWorkspaceProfiles => {
  const byId = new Map<string, WorkspaceProfile>();
  let changed = false;

  profiles.forEach((profile) => {
    const path = profile.path.trim();
    if (!path) {
      changed = true;
      return;
    }

    const id = workspaceIdForPath(path);
    const label = profile.label.trim() || workspaceBaseName(path);
    if (byId.has(id)) {
      changed = true;
      return;
    }

    if (profile.id !== id || profile.label !== label || profile.path !== path) {
      changed = true;
    }
    byId.set(id, { id, label, path });
  });

  return { workspaces: [...byId.values()], changed };
};
