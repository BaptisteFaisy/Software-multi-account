#!/usr/bin/env node

import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createGzip } from "node:zlib";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import {
  analyzeProject,
  copyBuildFiles,
  defaultHostPort,
  platformSlug,
  prepareBuildFiles,
  repositorySlug,
  resolveInside,
  validateBaseImage,
  validateContainerName,
  validateImageReference,
  writePortableMetadata,
} from "./docker-project.mjs";

const HELP = `CST Dockerize Git

Usage:
  dockerize-git <git-url> [options]

Main options:
  --ref <branch|tag|sha>       Git revision to package
  --context <directory>        Application subdirectory (monorepos)
  --dockerfile <path>          Existing Dockerfile inside the context
  --image <name:tag>           Docker image reference
  --name <container>           Container name
  --container-port <port>      Port exposed by the application
  --host-port <port>           Port published on the VPS (80 becomes 8080 by default)
  --platform <auto|linux/amd64|linux/arm64>
  --output <directory>         Portable bundle destination
  --no-export                  Keep/build the image without creating image.tar.gz
  --dry-run                    Clone, analyze and generate files without building

Deploy directly to a VPS:
  --deploy <user@host>         SSH destination
  --ssh-key <path>             Private key path
  --ssh-port <port>            SSH port (default: 22)
  --accept-new-host-key        Accept a new SSH host key after provider verification
  --env-file <path>            Runtime environment file, never included in the image
  --build-on <auto|local|remote>
  --install-docker             Install docker.io on a Debian/Ubuntu VPS when absent

Fallback for an unknown stack:
  --base-image <image>         Base image for a generated custom Dockerfile
  --install-command <command>  Dependency installation inside the image
  --build-command <command>    Build command inside the image
  --start-command <command>    Runtime command (required with --base-image)

Examples:
  npm run dockerize:git -- https://github.com/acme/api.git
  npm run dockerize:git -- https://github.com/acme/app.git --deploy ubuntu@203.0.113.10 --ssh-key ~/.ssh/id_ed25519 --install-docker
`;

const VALUE_OPTIONS = new Map([
  ["--ref", "ref"],
  ["--context", "context"],
  ["--dockerfile", "dockerfile"],
  ["--image", "image"],
  ["--name", "containerName"],
  ["--container-port", "containerPort"],
  ["--host-port", "hostPort"],
  ["--platform", "platform"],
  ["--output", "output"],
  ["--deploy", "deploy"],
  ["--ssh-key", "sshKey"],
  ["--ssh-port", "sshPort"],
  ["--env-file", "envFile"],
  ["--build-on", "buildOn"],
  ["--base-image", "baseImage"],
  ["--install-command", "installCommand"],
  ["--build-command", "buildCommand"],
  ["--start-command", "startCommand"],
]);

const BOOLEAN_OPTIONS = new Map([
  ["--dry-run", ["dryRun", true]],
  ["--no-export", ["exportImage", false]],
  ["--accept-new-host-key", ["acceptNewHostKey", true]],
  ["--install-docker", ["installDocker", true]],
  ["--help", ["help", true]],
  ["-h", ["help", true]],
]);

const integerOption = (value, label) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${label} must be between 1 and 65535.`);
  }
  return parsed;
};

const safeCommand = (value, label) => {
  if (!value || value.length > 4096 || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be a single non-empty line (4096 characters maximum).`);
  }
  return value;
};

const normalizeRelativeOption = (value, label) => {
  const normalized = String(value).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "") || ".";
  if (normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  return normalized;
};

export const parseArguments = (argv) => {
  const options = {
    repository: null,
    ref: null,
    context: ".",
    dockerfile: null,
    image: null,
    containerName: null,
    containerPort: null,
    hostPort: null,
    platform: "auto",
    output: null,
    deploy: null,
    sshKey: null,
    sshPort: 22,
    envFile: null,
    buildOn: "auto",
    baseImage: null,
    installCommand: null,
    buildCommand: null,
    startCommand: null,
    dryRun: false,
    exportImage: true,
    acceptNewHostKey: false,
    installDocker: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (BOOLEAN_OPTIONS.has(token)) {
      const [key, value] = BOOLEAN_OPTIONS.get(token);
      options[key] = value;
      continue;
    }
    const equals = token.startsWith("--") ? token.indexOf("=") : -1;
    const option = equals > 0 ? token.slice(0, equals) : token;
    if (VALUE_OPTIONS.has(option)) {
      const value = equals > 0 ? token.slice(equals + 1) : argv[++index];
      if (value === undefined || value === "") throw new Error(`${option} requires a value.`);
      options[VALUE_OPTIONS.get(option)] = value;
      continue;
    }
    if (token.startsWith("-")) throw new Error(`Unknown option: ${token}`);
    if (options.repository) throw new Error(`Unexpected positional argument: ${token}`);
    options.repository = token;
  }

  if (options.help) return options;
  if (!options.repository) throw new Error("A Git repository URL is required.");
  options.context = normalizeRelativeOption(options.context, "--context");
  if (options.dockerfile) options.dockerfile = normalizeRelativeOption(options.dockerfile, "--dockerfile");
  if (options.containerPort) options.containerPort = integerOption(options.containerPort, "--container-port");
  if (options.hostPort) options.hostPort = integerOption(options.hostPort, "--host-port");
  options.sshPort = integerOption(options.sshPort, "--ssh-port");
  if (!new Set(["auto", "local", "remote"]).has(options.buildOn)) {
    throw new Error("--build-on must be auto, local, or remote.");
  }
  if (!new Set(["auto", "linux/amd64", "linux/arm64"]).has(options.platform)) {
    throw new Error("--platform must be auto, linux/amd64, or linux/arm64.");
  }
  if (options.buildOn === "remote" && !options.deploy) {
    throw new Error("--build-on remote requires --deploy user@host.");
  }
  if (options.installDocker && !options.deploy) {
    throw new Error("--install-docker requires --deploy user@host.");
  }
  if (options.baseImage) validateBaseImage(options.baseImage);
  if (options.image) validateImageReference(options.image);
  if (options.containerName) validateContainerName(options.containerName);
  for (const [key, label] of [
    ["installCommand", "--install-command"],
    ["buildCommand", "--build-command"],
    ["startCommand", "--start-command"],
  ]) {
    if (options[key]) options[key] = safeCommand(options[key], label);
  }
  if (options.baseImage || options.installCommand || options.buildCommand || options.startCommand) {
    if (!options.baseImage || !options.startCommand) {
      throw new Error("Custom packaging requires --base-image and --start-command together.");
    }
  }
  validateRepository(options.repository);
  if (options.deploy) validateSshTarget(options.deploy);
  return options;
};

export const validateRepository = (repository) => {
  const value = String(repository ?? "").trim();
  if (!value || /[\0\r\n]/.test(value)) throw new Error("Invalid Git repository URL.");
  if (/^[\w.-]+@[\w.-]+:[^\s]+$/.test(value)) return value;
  if (/^(?:\.\.?[\\/]|[A-Za-z]:[\\/]|[\\/])/.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Repository must be an HTTPS/SSH Git URL or a local Git path.");
  }
  if (!["https:", "ssh:", "file:"].includes(url.protocol)) {
    throw new Error("Only HTTPS, SSH, file Git URLs, and local paths are accepted.");
  }
  if (url.search || url.hash) {
    throw new Error("Git URLs with query strings or fragments are rejected to avoid leaking credentials.");
  }
  if (url.username || url.password) {
    throw new Error("Do not put credentials in the Git URL; use an SSH agent or Git credential helper.");
  }
  return value;
};

export const safeRepositoryDisplay = (repository) => {
  try {
    const url = new URL(repository);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return repository;
  }
};

export const validateSshTarget = (target) => {
  const value = String(target ?? "");
  if (!/^[A-Za-z0-9._-]+@(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\])$/.test(value)) {
    throw new Error("SSH target must use user@host (IPv6 may be enclosed in brackets).");
  }
  return value;
};

const spawnProcess = (command, args, options = {}) => new Promise((resolvePromise, reject) => {
  const capture = options.capture === true;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    windowsHide: true,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  let stdout = "";
  let stderr = "";
  if (capture) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
  }
  child.on("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
  child.on("close", (code) => {
    if (code === 0 || options.allowFailure) {
      resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() });
    } else {
      const detail = capture && stderr ? `\n${stderr}` : "";
      reject(new Error(`${command} failed with exit code ${code}.${detail}`));
    }
  });
});

const commandAvailable = async (command, args = ["--help"]) => {
  try {
    await spawnProcess(command, args, { capture: true, allowFailure: true });
    return true;
  } catch {
    return false;
  }
};

const localDockerInvocation = () => {
  const command = process.env.CST_DOCKER_COMMAND?.trim() || "docker";
  let prefix = [];
  if (process.env.CST_DOCKER_COMMAND_ARGS) {
    try {
      const parsed = JSON.parse(process.env.CST_DOCKER_COMMAND_ARGS);
      if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) throw new Error();
      prefix = parsed;
    } catch {
      throw new Error("CST_DOCKER_COMMAND_ARGS must be a JSON array of strings.");
    }
  }
  return { command, prefix };
};

const runLocalDocker = (args, options = {}) => {
  const invocation = localDockerInvocation();
  return spawnProcess(invocation.command, [...invocation.prefix, ...args], options);
};

const shellQuote = (value) => `'${String(value).replaceAll("'", `'"'"'`)}'`;

const sshArguments = (options) => {
  const args = ["-p", String(options.sshPort), "-o", "BatchMode=yes"];
  if (options.sshKey) args.push("-i", options.sshKey);
  if (options.acceptNewHostKey) args.push("-o", "StrictHostKeyChecking=accept-new");
  return args;
};

const scpArguments = (options) => {
  const args = ["-P", String(options.sshPort), "-o", "BatchMode=yes"];
  if (options.sshKey) args.push("-i", options.sshKey);
  if (options.acceptNewHostKey) args.push("-o", "StrictHostKeyChecking=accept-new");
  return args;
};

const remoteCommand = (options, script, capture = false) => spawnProcess(
  "ssh",
  [...sshArguments(options), options.deploy, script],
  { capture },
);

const uploadFile = (options, localPath, remotePath) => spawnProcess(
  "scp",
  [...scpArguments(options), localPath, `${options.deploy}:${remotePath}`],
);

const downloadFile = (options, remotePath, localPath) => spawnProcess(
  "scp",
  [...scpArguments(options), `${options.deploy}:${remotePath}`, localPath],
);

const architecturePlatform = (architecture) => {
  const normalized = String(architecture).trim().toLowerCase();
  if (["x86_64", "amd64", "x64"].includes(normalized)) return "linux/amd64";
  if (["aarch64", "arm64"].includes(normalized)) return "linux/arm64";
  throw new Error(`Unsupported VPS architecture: ${architecture}`);
};

const localPlatform = () => process.arch === "arm64" ? "linux/arm64" : "linux/amd64";

const remotePlatform = async (options) => {
  const result = await remoteCommand(options, "uname -m", true);
  return architecturePlatform(result.stdout);
};

const cloneRepository = async (options, target) => {
  const args = ["clone", "--quiet", "--recurse-submodules", "--shallow-submodules", "--depth", "1"];
  const commitRef = options.ref && /^[0-9a-f]{7,40}$/i.test(options.ref);
  if (options.ref && !commitRef) args.push("--branch", options.ref);
  args.push(options.repository, target);
  await spawnProcess("git", args);
  if (commitRef) {
    await spawnProcess("git", ["-C", target, "fetch", "--depth", "1", "origin", options.ref]);
    await spawnProcess("git", ["-C", target, "checkout", "--detach", "FETCH_HEAD"]);
  }
};

const gitValue = async (root, ...args) => (
  await spawnProcess("git", ["-C", root, ...args], { capture: true })
).stdout;

const exportImageArchive = async (image, destination) => {
  const temporary = `${destination}.partial`;
  await rm(temporary, { force: true });
  const invocation = localDockerInvocation();
  const child = spawn(invocation.command, [...invocation.prefix, "image", "save", image], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolvePromise, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolvePromise()
      : reject(new Error(`docker image save failed with exit code ${code}.\n${stderr.trim()}`)));
  });
  try {
    await Promise.all([
      pipeline(child.stdout, createGzip({ level: 6 }), createWriteStream(temporary)),
      completed,
    ]);
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
};

const archiveIntegrity = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return {
    archiveBytes: (await stat(path)).size,
    archiveSha256: hash.digest("hex"),
  };
};

const createContextArchive = async (root, destination) => {
  const args = [
    "-czf",
    destination,
    "--exclude=.git",
    "--exclude=.git/*",
    "--exclude=node_modules",
    "--exclude=*/node_modules",
    "--exclude=.venv",
    "--exclude=*/.venv",
    "-C",
    root,
    ".",
  ];
  await spawnProcess("tar", args);
};

const remoteDockerPrelude = (installDocker) => `
docker_cmd() {
  if [ "\${CST_DOCKER_MODE:-}" = "direct" ]; then docker "$@"; else sudo -n docker "$@"; fi
}
detect_docker() {
  if docker info >/dev/null 2>&1; then CST_DOCKER_MODE=direct; return 0; fi
  if sudo -n docker info >/dev/null 2>&1; then CST_DOCKER_MODE=sudo; return 0; fi
  return 1
}
${installDocker ? `if ! detect_docker; then
  command -v apt-get >/dev/null 2>&1 || { echo 'Docker absent et apt-get indisponible' >&2; exit 20; }
  sudo -n true || { echo 'sudo sans mot de passe est requis pour installer Docker' >&2; exit 21; }
  sudo -n apt-get update
  sudo -n apt-get install -y docker.io
fi
` : ""}detect_docker || { echo 'Docker est absent ou inaccessible sur le VPS (utilise --install-docker si applicable)' >&2; exit 22; }
`;

const remoteRunLines = ({ image, containerName, containerPort, hostPort, remoteEnv }) => `
docker_cmd rm -f ${shellQuote(containerName)} >/dev/null 2>&1 || true
${remoteEnv
    ? `docker_cmd run -d --name ${shellQuote(containerName)} --restart unless-stopped --env-file ${shellQuote(remoteEnv)} -p ${shellQuote(`${hostPort}:${containerPort}`)} ${shellQuote(image)}`
    : `docker_cmd run -d --name ${shellQuote(containerName)} --restart unless-stopped -p ${shellQuote(`${hostPort}:${containerPort}`)} ${shellQuote(image)}`}
sleep 2
test "$(docker_cmd inspect --format '{{.State.Running}}' ${shellQuote(containerName)})" = true
`;

const remoteDirectoryFor = (containerName, commit) => `.cst-projects/${containerName}/${commit.slice(0, 12)}`;

const ensureRemoteDirectory = async (options, directory) => {
  await remoteCommand(options, `set -eu; mkdir -p ${shellQuote(directory)}`);
};

const cleanRemoteDirectory = async (options, directory) => {
  if (!directory.startsWith(".cst-projects/")) return;
  await remoteCommand(options, `rm -rf ${shellQuote(directory)}`, true).catch(() => {});
};

const buildLocally = async ({ root, dockerfileRelative, image, platform }) => {
  const version = await runLocalDocker(
    ["version", "--format", "{{.Server.Version}}"],
    { capture: true, allowFailure: true },
  ).catch(() => null);
  if (!version || version.code !== 0) {
    throw new Error("A reachable Docker daemon is required for a local build. Use --deploy with --build-on remote to build on the VPS.");
  }
  await runLocalDocker([
    "build",
    "--progress",
    "plain",
    "--platform",
    platform,
    "--tag",
    image,
    "--file",
    dockerfileRelative,
    ".",
  ], { cwd: root });
  await runLocalDocker(["image", "inspect", image], { capture: true });
};

const deployLocalImage = async ({ options, archivePath, image, containerName, containerPort, hostPort, commit }) => {
  const remoteDirectory = remoteDirectoryFor(containerName, commit);
  await ensureRemoteDirectory(options, remoteDirectory);
  try {
    const remoteArchive = `${remoteDirectory}/image.tar.gz`;
    await uploadFile(options, archivePath, remoteArchive);
    let remoteEnv = null;
    if (options.envFile) {
      remoteEnv = `${remoteDirectory}/.env`;
      await uploadFile(options, options.envFile, remoteEnv);
      await remoteCommand(options, `chmod 600 ${shellQuote(remoteEnv)}`);
    }
    const script = `set -eu
cd "$HOME"
${remoteDockerPrelude(options.installDocker)}
gzip -dc ${shellQuote(remoteArchive)} | docker_cmd load
${remoteRunLines({ image, containerName, containerPort, hostPort, remoteEnv })}`;
    await remoteCommand(options, script);
  } finally {
    await cleanRemoteDirectory(options, remoteDirectory);
  }
};

const buildAndDeployRemotely = async ({
  options,
  root,
  temporaryRoot,
  dockerfileRelative,
  outputDirectory,
  image,
  containerName,
  containerPort,
  hostPort,
  commit,
  platform,
}) => {
  const remoteDirectory = remoteDirectoryFor(containerName, commit);
  const contextArchive = join(temporaryRoot, "context.tar.gz");
  await createContextArchive(root, contextArchive);
  await ensureRemoteDirectory(options, remoteDirectory);
  try {
    await uploadFile(options, contextArchive, `${remoteDirectory}/context.tar.gz`);
    let remoteEnv = null;
    if (options.envFile) {
      const uploadedEnv = `${remoteDirectory}/.env`;
      await uploadFile(options, options.envFile, uploadedEnv);
      await remoteCommand(options, `chmod 600 ${shellQuote(uploadedEnv)}`);
      remoteEnv = ".env";
    }
    const platformArgument = options.platform === "auto" ? "" : ` --platform ${shellQuote(platform)}`;
    const exportLine = options.exportImage
      ? `docker_cmd image save ${shellQuote(image)} | gzip -6 > image.tar.gz`
      : "";
    const script = `set -eu
cd "$HOME"/${shellQuote(remoteDirectory)}
tar -xzf context.tar.gz
rm -f context.tar.gz
${remoteDockerPrelude(options.installDocker)}
docker_cmd build --progress plain${platformArgument} --tag ${shellQuote(image)} --file ${shellQuote(dockerfileRelative)} .
docker_cmd image inspect ${shellQuote(image)} >/dev/null
${exportLine}
${remoteRunLines({ image, containerName, containerPort, hostPort, remoteEnv })}`;
    await remoteCommand(options, script);
    if (options.exportImage) {
      await downloadFile(options, `${remoteDirectory}/image.tar.gz`, join(outputDirectory, "image.tar.gz"));
    }
  } finally {
    await cleanRemoteDirectory(options, remoteDirectory);
  }
};

const verifyReadableFile = async (path, label) => {
  try {
    await access(path);
    if (!(await stat(path)).isFile()) throw new Error();
  } catch {
    throw new Error(`${label} was not found: ${path}`);
  }
};

const summaryLine = (label, value) => process.stdout.write(`${label.padEnd(18)} ${value}\n`);

export const main = async (argv = process.argv.slice(2)) => {
  const options = parseArguments(argv);
  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (!(await commandAvailable("git", ["--version"]))) throw new Error("Git is required.");
  if (options.deploy && !(await commandAvailable("ssh", ["-V"]))) throw new Error("OpenSSH is required for VPS deployment.");
  if (options.deploy && !(await commandAvailable("scp"))) throw new Error("SCP is required for VPS deployment.");
  if (options.sshKey) {
    options.sshKey = resolve(options.sshKey);
    await verifyReadableFile(options.sshKey, "SSH private key");
  }
  if (options.envFile) {
    options.envFile = resolve(options.envFile);
    await verifyReadableFile(options.envFile, "Environment file");
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "cst-dockerize-"));
  const cloneRoot = join(temporaryRoot, "repository");
  try {
    process.stdout.write(`Clonage de ${safeRepositoryDisplay(options.repository)}…\n`);
    await cloneRepository(options, cloneRoot);
    const contextRoot = resolveInside(cloneRoot, options.context, "Build context");
    if (!(await stat(contextRoot)).isDirectory()) throw new Error(`Build context is not a directory: ${options.context}`);
    const commit = await gitValue(cloneRoot, "rev-parse", "HEAD");
    const shortCommit = commit.slice(0, 12);
    const sourceReference = await gitValue(cloneRoot, "rev-parse", "--abbrev-ref", "HEAD");
    const analysis = await analyzeProject(contextRoot, options);
    const buildFiles = await prepareBuildFiles(contextRoot, analysis);

    const buildOn = options.buildOn === "auto" ? (options.deploy ? "remote" : "local") : options.buildOn;
    let platform = options.platform;
    if (platform === "auto") {
      platform = options.deploy && !options.dryRun ? await remotePlatform(options) : localPlatform();
    }
    if (buildOn === "remote" && !options.deploy) throw new Error("A remote build requires --deploy.");

    const slug = repositorySlug(options.repository);
    const containerName = validateContainerName(options.containerName ?? slug);
    const image = validateImageReference(
      options.image ?? `cst/${slug}:${shortCommit}-${platformSlug(platform).replace(/^linux-/, "")}`,
    );
    const containerPort = analysis.port;
    const hostPort = options.hostPort ?? defaultHostPort(containerPort);
    const outputDirectory = resolve(
      options.output ?? join(".cst-images", slug, `${shortCommit}-${platformSlug(platform)}`),
    );
    const archiveName = options.exportImage && !options.dryRun ? "image.tar.gz" : null;
    await mkdir(outputDirectory, { recursive: true });
    // Reusing an explicit output directory must never leave a stale archive or
    // launcher that contradicts a new dry run / --no-export manifest.
    await rm(join(outputDirectory, "image.tar.gz"), { force: true });
    await rm(join(outputDirectory, "run.sh"), { force: true });
    await copyBuildFiles(buildFiles, outputDirectory);

    const manifest = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      source: {
        repository: safeRepositoryDisplay(options.repository),
        requestedRef: options.ref,
        resolvedRef: sourceReference,
        commit,
        context: options.context,
      },
      analysis,
      build: {
        mode: options.dryRun ? "dry-run" : buildOn,
        platform,
        dockerfile: "Dockerfile",
        reusedDockerfile: !analysis.generated,
      },
      image: {
        reference: image,
        archive: archiveName,
        status: options.dryRun ? "planned" : "pending",
      },
      run: {
        image,
        archive: archiveName,
        containerName,
        containerPort,
        hostPort,
      },
      deployment: options.deploy ? {
        target: options.deploy,
        status: options.dryRun ? "planned" : "pending",
      } : null,
    };
    await writePortableMetadata(outputDirectory, manifest, { includeRunScript: options.exportImage && !options.dryRun });

    summaryLine("Projet", slug);
    summaryLine("Détection", analysis.framework);
    summaryLine("Dockerfile", analysis.generated ? "généré" : `réutilisé (${analysis.sourceDockerfile})`);
    summaryLine("Port", `${hostPort} -> ${containerPort}`);
    summaryLine("Plateforme", platform);
    summaryLine("Image", image);
    if (analysis.environmentVariables.length) {
      summaryLine("Variables", analysis.environmentVariables.join(", "));
    }
    for (const warning of analysis.warnings) process.stdout.write(`Attention: ${warning}\n`);

    if (options.dryRun) {
      summaryLine("Résultat", `analyse prête dans ${outputDirectory}`);
      return;
    }

    if (buildOn === "local") {
      await buildLocally({
        root: contextRoot,
        dockerfileRelative: buildFiles.dockerfileRelative,
        image,
        platform,
      });
      const needsArchive = options.exportImage || Boolean(options.deploy);
      let archivePath = null;
      if (needsArchive) {
        archivePath = options.exportImage
          ? join(outputDirectory, "image.tar.gz")
          : join(temporaryRoot, "image.tar.gz");
        await exportImageArchive(image, archivePath);
      }
      if (options.deploy) {
        await deployLocalImage({
          options,
          archivePath,
          image,
          containerName,
          containerPort,
          hostPort,
          commit,
        });
      }
    } else {
      await buildAndDeployRemotely({
        options,
        root: contextRoot,
        temporaryRoot,
        dockerfileRelative: buildFiles.dockerfileRelative,
        outputDirectory,
        image,
        containerName,
        containerPort,
        hostPort,
        commit,
        platform,
      });
    }

    if (options.exportImage) {
      Object.assign(manifest.image, await archiveIntegrity(join(outputDirectory, "image.tar.gz")));
    }
    manifest.image.status = "built";
    if (manifest.deployment) manifest.deployment.status = "running";
    manifest.completedAt = new Date().toISOString();
    await writePortableMetadata(outputDirectory, manifest, { includeRunScript: options.exportImage });
    summaryLine("Paquet", outputDirectory);
    if (options.deploy) {
      const host = options.deploy.slice(options.deploy.indexOf("@") + 1);
      summaryLine("VPS", `conteneur actif sur http://${host}:${hostPort}`);
    } else if (options.exportImage) {
      summaryLine("Lancement", `copier le dossier puis exécuter sh run.sh`);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
};

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    process.stderr.write(`Erreur: ${error.message}\n`);
    process.exitCode = 1;
  });
}
