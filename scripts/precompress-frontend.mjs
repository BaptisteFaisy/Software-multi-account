#!/usr/bin/env node

import { constants, brotliCompress, gzip } from "node:zlib";
import { promisify } from "node:util";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const brotli = promisify(brotliCompress);
const gzipAsync = promisify(gzip);
const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

const COMPRESSIBLE_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".map",
  ".svg",
  ".txt",
  ".webmanifest",
  ".xml",
]);

const collectFiles = async (directory) => {
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

export const precompressDirectory = async ({
  root = resolve(projectRoot, "dist"),
  minimumBytes = 1_024,
} = {}) => {
  const metadata = await stat(root);
  if (!metadata.isDirectory()) throw new Error(`Dossier frontend introuvable : ${root}`);

  const files = (await collectFiles(root)).filter((path) => (
    !path.endsWith(".br")
    && !path.endsWith(".gz")
    && COMPRESSIBLE_EXTENSIONS.has(extname(path).toLowerCase())
  ));
  const result = {
    sourceFiles: 0,
    sourceBytes: 0,
    brotliBytes: 0,
    gzipBytes: 0,
  };

  for (const path of files) {
    const source = await readFile(path);
    if (source.byteLength < minimumBytes) continue;
    const [brotliContent, gzipContent] = await Promise.all([
      brotli(source, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
          [constants.BROTLI_PARAM_QUALITY]: 9,
        },
      }),
      gzipAsync(source, { level: 9 }),
    ]);
    await Promise.all([
      writeFile(`${path}.br`, brotliContent),
      writeFile(`${path}.gz`, gzipContent),
    ]);
    result.sourceFiles += 1;
    result.sourceBytes += source.byteLength;
    result.brotliBytes += brotliContent.byteLength;
    result.gzipBytes += gzipContent.byteLength;
  }

  return result;
};

const isMain = process.argv[1]
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  precompressDirectory()
    .then((result) => {
      const brotliPercent = result.sourceBytes
        ? Math.round((1 - result.brotliBytes / result.sourceBytes) * 100)
        : 0;
      const gzipPercent = result.sourceBytes
        ? Math.round((1 - result.gzipBytes / result.sourceBytes) * 100)
        : 0;
      process.stdout.write(
        `Frontend precompresse : ${result.sourceFiles} fichiers, `
        + `Brotli -${brotliPercent} %, Gzip -${gzipPercent} %.\n`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
