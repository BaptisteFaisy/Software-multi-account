import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { BUILD_ARTIFACTS, cleanBuildArtifacts } from "../scripts/clean-build-artifacts.mjs";

test("le nettoyage supprime toutes les anciennes sorties web et app connues", async () => {
  const root = await mkdtemp(fileURLToPath(new URL(".tmp-clean-", import.meta.url)));
  const artifacts = Object.values(BUILD_ARTIFACTS).flat();

  try {
    for (const artifact of artifacts) {
      const target = join(root, artifact);
      if (extname(target)) {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, "ancienne version");
      } else {
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "ancienne-version.txt"), "ancienne version");
      }
    }

    const removed = await cleanBuildArtifacts({ root, scopes: ["all"] });
    assert.deepEqual(new Set(removed), new Set(artifacts));
    await Promise.all(artifacts.map((artifact) => assert.rejects(access(join(root, artifact)))));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("les commandes de build nettoient leur ancienne sortie avant compilation", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(pkg.scripts.build, /^npm run clean:app && /);
  assert.match(pkg.scripts["build:frontend"], /^npm run clean:web && /);
});
