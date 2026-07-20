#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = resolve(dirname(scriptPath), "..");

const BUILD_INPUTS = Object.freeze([
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vite.config.ts",
  "src",
  "public",
  "scripts/clean-build-artifacts.mjs",
  "scripts/measure-frontend-baseline.mjs",
  "scripts/precompress-frontend.mjs",
]);

const VALIDATION_INPUTS = Object.freeze([
  ...BUILD_INPUTS,
  "config",
  "tests",
  "scripts",
  "deploy",
  "docs",
  ".github/workflows",
  "android/app/src",
  "android/app/build.gradle",
  "android/build.gradle",
  "android/settings.gradle",
  "android/gradle.properties",
  "ios/CodexTerminal",
  "ios/CodexTerminal.xcodeproj",
  "src-tauri/src",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/build.rs",
  "src-tauri/tauri.conf.json",
  "src-tauri/tauri.local.conf.json",
]);

const toPosix = (path) => path.split(sep).join("/");

const visitFiles = async (root, inputPaths) => {
  const files = new Set();

  const visit = async (path) => {
    let metadata;
    try {
      metadata = await stat(path);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    if (metadata.isFile()) {
      files.add(resolve(path));
      return;
    }
    if (!metadata.isDirectory()) return;

    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink() || entry.name.startsWith(".tmp-")) continue;
      await visit(resolve(path, entry.name));
    }
  };

  for (const inputPath of inputPaths) {
    await visit(resolve(root, inputPath));
  }

  return [...files].sort((left, right) =>
    toPosix(relative(root, left)).localeCompare(toPosix(relative(root, right))),
  );
};

export const fingerprintInputs = async ({
  root = projectRoot,
  inputPaths = BUILD_INPUTS,
} = {}) => {
  const normalizedRoot = resolve(root);
  const files = await visitFiles(normalizedRoot, inputPaths);
  const hash = createHash("sha256");
  let bytes = 0;

  for (const file of files) {
    let content;
    try {
      content = await readFile(file);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(
          `Entree modifiee pendant le fingerprint: ${toPosix(relative(normalizedRoot, file))}.`,
        );
      }
      throw error;
    }
    const path = toPosix(relative(normalizedRoot, file));
    bytes += content.byteLength;
    hash.update(path);
    hash.update("\0");
    hash.update(String(content.byteLength));
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }

  return {
    algorithm: "sha256",
    digest: hash.digest("hex"),
    fileCount: files.length,
    bytes,
  };
};

export const captureFingerprints = async (root = projectRoot) => ({
  build: await fingerprintInputs({ root, inputPaths: BUILD_INPUTS }),
  validation: await fingerprintInputs({ root, inputPaths: VALIDATION_INPUTS }),
});

const fingerprintsEqual = (left, right) =>
  left.build.digest === right.build.digest
  && left.validation.digest === right.validation.digest;

const copyValidationInputs = async (sourceRoot, targetRoot) => {
  const files = await visitFiles(sourceRoot, VALIDATION_INPUTS);
  for (const file of files) {
    const path = relative(sourceRoot, file);
    const target = resolve(targetRoot, path);
    await mkdir(dirname(target), { recursive: true });
    try {
      await copyFile(file, target);
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`Entree modifiee pendant la copie: ${toPosix(path)}.`);
      }
      throw error;
    }
  }
};

const createControlledSnapshot = async ({ attempts = 4 } = {}) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let root = null;
    try {
      const before = await captureFingerprints(projectRoot);
      root = await mkdtemp(join(tmpdir(), "cst-frontend-baseline-"));
      await copyValidationInputs(projectRoot, root);
      const [sourceAfterCopy, snapshot] = await Promise.all([
        captureFingerprints(projectRoot),
        captureFingerprints(root),
      ]);
      if (!fingerprintsEqual(before, sourceAfterCopy)) {
        throw new Error("Les entrees source ont change pendant la copie.");
      }
      if (!fingerprintsEqual(before, snapshot)) {
        throw new Error("La copie controlee ne correspond pas aux entrees source.");
      }

      const dependencies = resolve(projectRoot, "node_modules");
      await stat(dependencies);
      await symlink(dependencies, resolve(root, "node_modules"), "junction");
      return { root, fingerprints: snapshot, captureAttempt: attempt };
    } catch (error) {
      lastError = error;
      if (root) await rm(root, { recursive: true, force: true });
      process.stderr.write(
        `Instantane instable (tentative ${attempt}/${attempts}): `
        + `${error instanceof Error ? error.message : error}\n`,
      );
    }
  }
  throw new Error(
    `Impossible de capturer un instantane stable: `
    + `${lastError instanceof Error ? lastError.message : lastError}`,
  );
};

const compressedSizes = (content) => ({
  rawBytes: content.byteLength,
  gzipBytes: gzipSync(content, { level: 9 }).byteLength,
  brotliBytes: brotliCompressSync(content, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
    },
  }).byteLength,
});

const referencedAssets = (html, relation) => {
  const paths = new Set();
  const tags = html.match(/<(?:script|link)\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const relationMatch = tag.match(/\brel=["']([^"']+)["']/i);
    const isModuleScript = /^<script\b/i.test(tag)
      && /\btype=["']module["']/i.test(tag);
    const relations = relationMatch?.[1].toLowerCase().split(/\s+/) ?? [];
    const matchesRelation = relation === "script"
      ? isModuleScript || relations.includes("modulepreload")
      : relations.includes(relation);
    if (!matchesRelation) continue;

    const attribute = relation === "script" ? "(?:src|href)" : "href";
    const pathMatch = tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"));
    if (!pathMatch) continue;
    const path = pathMatch[1].split(/[?#]/, 1)[0].replace(/^\/+/, "");
    if (path.startsWith("assets/")) paths.add(path);
  }
  return paths;
};

const staticImports = (source) => {
  const paths = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^"'()]*?\s+from\s*)?["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1].startsWith(".")) paths.add(match[1]);
    }
  }
  return paths;
};

const sumMetrics = (assets) => assets.reduce(
  (total, asset) => ({
    rawBytes: total.rawBytes + asset.rawBytes,
    gzipBytes: total.gzipBytes + asset.gzipBytes,
    brotliBytes: total.brotliBytes + asset.brotliBytes,
  }),
  { rawBytes: 0, gzipBytes: 0, brotliBytes: 0 },
);

export const measureBuildOutput = async ({ root = projectRoot } = {}) => {
  const distRoot = resolve(root, "dist");
  const html = await readFile(resolve(distRoot, "index.html"), "utf8");
  const initialJs = referencedAssets(html, "script");
  const initialCss = referencedAssets(html, "stylesheet");
  const pendingJs = [...initialJs];

  while (pendingJs.length > 0) {
    const assetPath = pendingJs.pop();
    const source = await readFile(resolve(distRoot, assetPath), "utf8");
    for (const importedPath of staticImports(source)) {
      const resolvedImport = toPosix(relative(
        distRoot,
        resolve(dirname(resolve(distRoot, assetPath)), importedPath),
      ));
      if (
        resolvedImport.startsWith("assets/")
        && extname(resolvedImport) === ".js"
        && !initialJs.has(resolvedImport)
      ) {
        initialJs.add(resolvedImport);
        pendingJs.push(resolvedImport);
      }
    }
  }

  const assetRoot = resolve(distRoot, "assets");
  const entries = await readdir(assetRoot, { withFileTypes: true });
  const assets = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;
    const extension = extname(entry.name).slice(1);
    if (extension !== "js" && extension !== "css") continue;
    const path = `assets/${entry.name}`;
    const content = await readFile(resolve(assetRoot, entry.name));
    assets.push({
      path,
      kind: extension,
      initial: extension === "js" ? initialJs.has(path) : initialCss.has(path),
      ...compressedSizes(content),
    });
  }

  const select = (kind, initial) =>
    assets.filter((asset) => asset.kind === kind && asset.initial === initial);

  return {
    initial: {
      javascript: sumMetrics(select("js", true)),
      css: sumMetrics(select("css", true)),
      assetPaths: assets.filter((asset) => asset.initial).map((asset) => asset.path),
    },
    deferred: {
      javascript: sumMetrics(select("js", false)),
      css: sumMetrics(select("css", false)),
      assetPaths: assets.filter((asset) => !asset.initial).map((asset) => asset.path),
    },
    assets,
  };
};

const run = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...process.env, ...options.env },
    shell: false,
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    process.stderr.write(chunk);
  });
  child.once("error", reject);
  child.once("close", (code) => {
    if (code === 0) resolvePromise({ stdout, stderr });
    else reject(new Error(`${command} ${args.join(" ")} a echoue (code ${code}).`));
  });
});

const runNpmScript = (script, options = {}) => {
  if (process.platform === "win32") {
    return run(
      process.env.ComSpec || "cmd.exe",
      ["/d", "/s", "/c", `npm run ${script}`],
      options,
    );
  }
  return run("npm", ["run", script], options);
};

const assertStable = (before, after, phase) => {
  for (const scope of ["build", "validation"]) {
    if (before[scope].digest !== after[scope].digest) {
      throw new Error(
        `Fingerprint ${scope} modifie pendant ${phase}: `
        + `${before[scope].digest} -> ${after[scope].digest}. Baseline refusee.`,
      );
    }
  }
};

const parseTestSummary = (output) => {
  const value = (name) => {
    const match = output.match(
      new RegExp(`^(?:#|ℹ)\\s+${name}\\s+(\\d+)\\s*$`, "m"),
    );
    return match ? Number(match[1]) : null;
  };
  return {
    tests: value("tests"),
    passed: value("pass"),
    failed: value("fail"),
  };
};

const main = async () => {
  const verify = process.argv.includes("--verify");
  const allowLiveDrift = process.argv.includes("--allow-live-drift");
  const labelIndex = process.argv.indexOf("--label");
  const label = labelIndex >= 0 && process.argv[labelIndex + 1]
    ? process.argv[labelIndex + 1]
    : "frontend-production";
  const controlled = verify ? await createControlledSnapshot() : null;
  const workingRoot = controlled?.root ?? projectRoot;
  const before = controlled?.fingerprints ?? await captureFingerprints();
  let tests = null;
  try {
    if (verify) {
      const testRun = await runNpmScript("test:frontend:baseline", {
        cwd: workingRoot,
        env: { FORCE_COLOR: "0", NO_COLOR: "1" },
      });
      tests = {
        command: "npm run test:frontend:baseline",
        ...parseTestSummary(`${testRun.stdout}\n${testRun.stderr}`),
      };
      if (
        tests.tests === null
        || tests.passed !== tests.tests
        || tests.failed !== 0
      ) {
        throw new Error("Resume TAP incomplet ou incoherent; baseline refusee.");
      }

      const afterTests = await captureFingerprints(workingRoot);
      assertStable(before, afterTests, "les tests dans l'instantane controle");
      await runNpmScript("build:frontend", {
        cwd: workingRoot,
        env: { CST_BUILD_ID: `perf-${before.build.digest.slice(0, 16)}` },
      });
    }

    const after = await captureFingerprints(workingRoot);
    assertStable(
      before,
      after,
      verify ? "la validation et le build controles" : "la mesure",
    );
    const output = await measureBuildOutput({ root: workingRoot });
    const liveAfter = verify ? await captureFingerprints(projectRoot) : after;
    const liveSourceStillMatches = {
      build: liveAfter.build.digest === before.build.digest,
      validation: liveAfter.validation.digest === before.validation.digest,
    };
    if (verify && !liveSourceStillMatches.build && !allowLiveDrift) {
      throw new Error(
        "Les entrees frontend reelles ont change apres la capture; baseline courante refusee.",
      );
    }
    const result = {
      schemaVersion: 1,
      label,
      verified: verify,
      executionMode: verify ? "controlled-snapshot" : "working-tree",
      snapshotCaptureAttempt: controlled?.captureAttempt ?? null,
      deterministicBuildId: verify ? `perf-${before.build.digest.slice(0, 16)}` : null,
      fingerprints: before,
      liveSourceStillMatches,
      liveDriftPolicy: verify
        ? allowLiveDrift
          ? "report-controlled-snapshot"
          : "require-current-build"
        : "not-applicable",
      acceptedAsCurrentBuild: liveSourceStillMatches.build,
      tests,
      output,
      methodology: [
        "Les fingerprints SHA-256 portent sur les contenus, tailles et chemins tries; dates, PID, caches et sorties de build sont exclus.",
        "Le fingerprint build couvre les seules entrees du build web; validation ajoute tests, backend, workflows, documentation et scripts inspectes par la suite frontend.",
        "La validation --verify s'execute dans une copie locale dont les contenus sont verifies avant utilisation; node_modules est reutilise par une jonction exclue du fingerprint.",
        "Une baseline est refusee si l'instantane change pendant les tests ou le build, ou si les entrees frontend reelles ne correspondent plus a la fin.",
        "Avec --allow-live-drift, un changement du depot vivant est signale sans invalider le snapshot controle; ce resultat ne doit pas etre presente comme l'etat courant.",
        "Le build verifie recoit un identifiant derive du fingerprint pour supprimer l'alea du cache PWA sans changer les builds ordinaires.",
        "La suite de baseline limite la concurrence a deux fichiers afin de rester fiable sur une petite machine ou sous charge sans rendre le harnais interminable.",
        "Les tailles gzip utilisent le niveau 9; Brotli utilise la qualite 11. Les imports dynamiques restent classes comme differes.",
      ],
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    if (controlled?.root) {
      await rm(controlled.root, { recursive: true, force: true });
    }
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(scriptPath);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
