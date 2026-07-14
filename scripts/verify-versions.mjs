import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const defaultProjectRoot = resolve(dirname(scriptPath), "..");
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const packageVersionFromCargo = (source) => {
  let inPackage = false;

  for (const line of source.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)]\s*$/);
    if (section) {
      inPackage = section[1] === "package";
      continue;
    }

    if (!inPackage) continue;
    const version = line.match(/^\s*version\s*=\s*"([^"]+)"\s*$/);
    if (version) return version[1];
  }

  throw new Error("Version introuvable dans [package] de src-tauri/Cargo.toml.");
};

export const readProjectVersions = async (projectRoot = defaultProjectRoot) => {
  const [packageSource, lockSource, tauriSource, cargoSource] = await Promise.all([
    readFile(resolve(projectRoot, "package.json"), "utf8"),
    readFile(resolve(projectRoot, "package-lock.json"), "utf8"),
    readFile(resolve(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"),
    readFile(resolve(projectRoot, "src-tauri", "Cargo.toml"), "utf8"),
  ]);

  const packageJson = JSON.parse(packageSource);
  const packageLock = JSON.parse(lockSource);
  const tauriConfig = JSON.parse(tauriSource);

  return {
    "package.json": packageJson.version,
    "package-lock.json": packageLock.packages?.[""]?.version ?? packageLock.version,
    "src-tauri/tauri.conf.json": tauriConfig.version,
    "src-tauri/Cargo.toml": packageVersionFromCargo(cargoSource),
  };
};

export const validateProjectVersions = (versions, releaseTag = "") => {
  const entries = Object.entries(versions);
  if (entries.length === 0) throw new Error("Aucune version a verifier.");

  for (const [source, version] of entries) {
    if (typeof version !== "string" || !semverPattern.test(version)) {
      throw new Error(`Version invalide dans ${source}: ${String(version)}`);
    }
  }

  const expectedVersion = entries[0][1];
  const mismatches = entries.filter(([, version]) => version !== expectedVersion);
  if (mismatches.length > 0) {
    const details = entries.map(([source, version]) => `${source}=${version}`).join(", ");
    throw new Error(`Versions incoherentes: ${details}`);
  }

  if (releaseTag) {
    const tagVersion = releaseTag.startsWith("v") ? releaseTag.slice(1) : releaseTag;
    if (tagVersion !== expectedVersion) {
      throw new Error(
        `Le tag ${releaseTag} ne correspond pas a la version ${expectedVersion}.`,
      );
    }
  }

  return expectedVersion;
};

export const releaseTagFromContext = ({ args = [], env = process.env } = {}) => {
  const explicitIndex = args.findIndex((arg) => arg === "--tag");
  if (explicitIndex >= 0) {
    const value = args[explicitIndex + 1];
    if (!value) throw new Error("Valeur manquante apres --tag.");
    return value;
  }

  const explicitInline = args.find((arg) => arg.startsWith("--tag="));
  if (explicitInline) return explicitInline.slice("--tag=".length);

  if (env.GITHUB_REF_TYPE === "tag" && env.GITHUB_REF_NAME) {
    return env.GITHUB_REF_NAME;
  }
  if (env.GITHUB_REF?.startsWith("refs/tags/")) {
    return env.GITHUB_REF.slice("refs/tags/".length);
  }
  return "";
};

export const verifyProjectVersions = async ({
  projectRoot = defaultProjectRoot,
  releaseTag = "",
} = {}) => {
  const versions = await readProjectVersions(projectRoot);
  const version = validateProjectVersions(versions, releaseTag);
  return { version, versions, releaseTag };
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isMain) {
  try {
    const releaseTag = releaseTagFromContext({ args: process.argv.slice(2) });
    const result = await verifyProjectVersions({ releaseTag });
    const tagDetail = result.releaseTag ? `, tag ${result.releaseTag}` : "";
    console.log(`Versions coherentes: ${result.version}${tagDetail}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
