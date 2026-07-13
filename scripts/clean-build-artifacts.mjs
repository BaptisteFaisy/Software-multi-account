import { lstat, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

export const BUILD_ARTIFACTS = Object.freeze({
  web: ["dist"],
  app: [
    "src-tauri/target/debug/bundle",
    "src-tauri/target/release/bundle",
    "src-tauri/target-alt/debug/bundle",
    "src-tauri/target-alt/release/bundle",
  ],
  android: [
    "android/app/build",
    "CodexTerminal-debug.apk",
    "CodexTerminal-release.apk",
  ],
  ios: ["ios/build"],
});

const assertInsideRoot = (root, target) => {
  const pathFromRoot = relative(root, target);
  if (
    pathFromRoot === ""
    || pathFromRoot === ".."
    || pathFromRoot.startsWith(`..${sep}`)
    || isAbsolute(pathFromRoot)
  ) {
    throw new Error(`Refus de supprimer un chemin hors du projet: ${target}`);
  }
};

const expandScopes = (scopes) => {
  const requested = scopes.length === 0 ? ["all"] : scopes;
  const names = requested.includes("all") ? Object.keys(BUILD_ARTIFACTS) : requested;
  for (const name of names) {
    if (!(name in BUILD_ARTIFACTS)) {
      throw new Error(`Nettoyage inconnu: ${name}`);
    }
  }
  return [...new Set(names)];
};

export const cleanBuildArtifacts = async ({ root = projectRoot, scopes = ["all"] } = {}) => {
  const normalizedRoot = resolve(root);
  const removed = [];

  for (const scope of expandScopes(scopes)) {
    for (const artifact of BUILD_ARTIFACTS[scope]) {
      const target = resolve(normalizedRoot, artifact);
      assertInsideRoot(normalizedRoot, target);
      try {
        await lstat(target);
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      await rm(target, { force: true, recursive: true });
      removed.push(artifact);
    }
  }

  return removed;
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isMain) {
  try {
    const removed = await cleanBuildArtifacts({ scopes: process.argv.slice(2) });
    if (removed.length === 0) {
      console.log("Aucune ancienne sortie de build locale a supprimer.");
    } else {
      console.log(`Sorties de build supprimees: ${removed.join(", ")}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
