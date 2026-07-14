import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fingerprintInputs,
  measureBuildOutput,
} from "../scripts/measure-frontend-baseline.mjs";

const fixture = async () => {
  const root = await mkdtemp(join(tmpdir(), "cst-frontend-baseline-"));
  await mkdir(join(root, "src"), { recursive: true });
  await writeFile(join(root, "src", "main.ts"), "export const value = 1;\n");
  return root;
};

test("le fingerprint ignore dist mais detecte une entree modifiee", async () => {
  const root = await fixture();
  try {
    const before = await fingerprintInputs({ root, inputPaths: ["src"] });
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "noise.js"), "sortie volatile");
    const afterDist = await fingerprintInputs({ root, inputPaths: ["src"] });
    assert.deepEqual(afterDist, before);

    await writeFile(join(root, "src", "main.ts"), "export const value = 2;\n");
    const afterSource = await fingerprintInputs({ root, inputPaths: ["src"] });
    assert.notEqual(afterSource.digest, before.digest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("la mesure separe le chemin initial des imports dynamiques", async () => {
  const root = await fixture();
  try {
    await mkdir(join(root, "dist", "assets"), { recursive: true });
    await writeFile(
      join(root, "dist", "index.html"),
      '<script type="module" src="/assets/index.js"></script>'
      + '<link rel="stylesheet" href="/assets/index.css">',
    );
    await writeFile(
      join(root, "dist", "assets", "index.js"),
      'export const load = () => import("./lazy.js");\n',
    );
    await writeFile(join(root, "dist", "assets", "lazy.js"), "export default 42;\n");
    await writeFile(join(root, "dist", "assets", "index.css"), "body{margin:0}\n");

    const result = await measureBuildOutput({ root });
    assert.deepEqual(result.initial.assetPaths, [
      "assets/index.css",
      "assets/index.js",
    ]);
    assert.deepEqual(result.deferred.assetPaths, ["assets/lazy.js"]);
    assert.ok(result.initial.javascript.rawBytes > 0);
    assert.ok(result.initial.css.rawBytes > 0);
    assert.ok(result.deferred.javascript.rawBytes > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
