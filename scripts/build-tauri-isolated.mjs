import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");
const tauriRoot = resolve(projectRoot, "src-tauri");
const snapshotRoot = resolve(tauriRoot, "target", "tauri-frontend");

const nodeScripts = Object.freeze({
  tsc: resolve(projectRoot, "node_modules", "typescript", "bin", "tsc"),
  vite: resolve(projectRoot, "node_modules", "vite", "bin", "vite.js"),
  tauri: resolve(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
});

const toConfigPath = (path) => path.split(sep).join("/");

export const createTauriFrontendOverride = ({ snapshotDir, configRoot = tauriRoot }) => {
  const relativeSnapshot = relative(resolve(configRoot), resolve(snapshotDir));
  if (
    relativeSnapshot === ""
    || relativeSnapshot === ".."
    || relativeSnapshot.startsWith(`..${sep}`)
  ) {
    throw new Error("Le snapshot frontend Tauri doit rester dans src-tauri.");
  }

  return {
    build: {
      beforeBuildCommand: "",
      frontendDist: toConfigPath(relativeSnapshot),
    },
  };
};

const runNodeScript = (script, args) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
    windowsHide: true,
  });

  child.once("error", rejectRun);
  child.once("exit", (code, signal) => {
    if (code === 0) {
      resolveRun();
      return;
    }
    rejectRun(new Error(
      signal
        ? `${script} interrompu par ${signal}.`
        : `${script} a echoue avec le code ${code}.`,
    ));
  });
});

export const buildTauriIsolated = async ({ tauriArgs = process.argv.slice(2) } = {}) => {
  await mkdir(snapshotRoot, { recursive: true });
  const snapshotDir = await mkdtemp(join(snapshotRoot, "build-"));

  try {
    await runNodeScript(nodeScripts.tsc, []);
    await runNodeScript(nodeScripts.vite, ["build", "--outDir", snapshotDir]);

    const isolatedConfig = JSON.stringify(createTauriFrontendOverride({ snapshotDir }));
    await runNodeScript(nodeScripts.tauri, [
      "build",
      ...tauriArgs,
      "--config",
      isolatedConfig,
    ]);
  } finally {
    await rm(snapshotDir, { force: true, recursive: true });
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isMain) {
  try {
    await buildTauriIsolated();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
