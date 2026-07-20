import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".cst-docker",
  "node_modules",
  "target",
  "vendor",
  ".venv",
  "venv",
  "dist",
  "build",
  ".next",
]);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".go",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".mjs",
  ".py",
  ".rb",
  ".rs",
  ".ts",
  ".tsx",
]);

const SAFETY_DOCKERIGNORE = `
# Added by CST Dockerize Git: never send local credentials to the builder.
.git
.git/**
**/.git
**/.git/**
.env
.env.*
**/.env
**/.env.*
!.env.example
!.env.sample
!**/.env.example
!**/.env.sample
*.pem
*.key
**/*.pem
**/*.key
id_rsa*
id_ed25519*
**/id_rsa*
**/id_ed25519*
node_modules
**/node_modules
.venv
**/.venv
venv
**/venv
__pycache__
**/__pycache__
.DS_Store
!.cst-docker
!.cst-docker/**
`;

const nginxConfig = (port) => `server {
  listen ${port};
  listen [::]:${port};
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  location = /healthz {
    access_log off;
    add_header Content-Type text/plain;
    return 200 'ok';
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
`;

const fileExists = async (path) => {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
};

const directoryExists = async (path) => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};

const readText = async (path, limit = 1024 * 1024) => {
  const info = await stat(path);
  if (!info.isFile() || info.size > limit) return "";
  return readFile(path, "utf8");
};

const unixPath = (value) => value.split(sep).join("/");

export const resolveInside = (root, value = ".", label = "path") => {
  if (isAbsolute(value)) {
    throw new Error(`${label} must be relative to the cloned repository`);
  }
  const target = resolve(root, value);
  const child = relative(resolve(root), target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error(`${label} escapes the cloned repository`);
  }
  return target;
};

const collectSourceFiles = async (root, maximum = 300) => {
  const files = [];
  const pending = [root];
  while (pending.length && files.length < maximum) {
    const current = pending.shift();
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (files.length >= maximum) break;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) pending.push(fullPath);
      } else if (entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        files.push(fullPath);
      }
    }
  }
  return files;
};

const validPort = (value) => {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
};

const portFromText = (text) => {
  const patterns = [
    /(?:^|\b)(?:PORT|port)\s*[:=]\s*["']?(\d{2,5})\b/m,
    /\.listen\s*\(\s*(?:(?:process\.env\.)?PORT\s*(?:\|\||\?\?)\s*)?(\d{2,5})\b/m,
    /(?:port|PORT)\s*=\s*(\d{2,5})\b/m,
    /(?:ListenAndServe|Run)\s*\(\s*["']:(\d{2,5})/m,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const port = validPort(match?.[1]);
    if (port) return port;
  }
  return null;
};

const inferPort = async (root, fallback) => {
  for (const file of [".env.example", ".env.sample"]) {
    const path = join(root, file);
    if (await fileExists(path)) {
      const port = portFromText(await readText(path, 128 * 1024));
      if (port) return port;
    }
  }
  for (const path of await collectSourceFiles(root)) {
    const port = portFromText(await readText(path, 512 * 1024));
    if (port) return port;
  }
  return fallback;
};

const dockerfilePort = (content) => {
  for (const match of content.matchAll(/^\s*EXPOSE\s+([^\r\n#]+)/gim)) {
    for (const token of match[1].trim().split(/\s+/)) {
      const port = validPort(token.replace(/\/(?:tcp|udp)$/i, ""));
      if (port) return port;
    }
  }
  return null;
};

const composePort = async (root) => {
  for (const name of ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"]) {
    const path = join(root, name);
    if (!(await fileExists(path))) continue;
    const content = await readText(path, 512 * 1024);
    const match = content.match(/["']?\d{1,5}:([1-9]\d{0,4})(?:\/(?:tcp|udp))?["']?/);
    const port = validPort(match?.[1]);
    if (port) return port;
  }
  return null;
};

const environmentVariableNames = async (root) => {
  const names = new Set();
  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    const path = join(root, name);
    if (!(await fileExists(path))) continue;
    const content = await readText(path, 256 * 1024);
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (match) names.add(match[1]);
    }
  }
  return [...names].sort();
};

const packageManagerFor = async (root) => {
  if (await fileExists(join(root, "bun.lockb")) || await fileExists(join(root, "bun.lock"))) {
    return "bun";
  }
  if (await fileExists(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (await fileExists(join(root, "yarn.lock"))) return "yarn";
  return "npm";
};

const nodeInstallCommand = (manager) => {
  if (manager === "bun") return "bun install --frozen-lockfile";
  if (manager === "pnpm") return "corepack enable && pnpm install --frozen-lockfile";
  if (manager === "yarn") return "corepack enable && yarn install --frozen-lockfile";
  return "if [ -f package-lock.json ] || [ -f npm-shrinkwrap.json ]; then npm ci; else npm install; fi";
};

const nodeScriptCommand = (manager, script) => {
  if (manager === "bun") return `bun run ${script}`;
  if (manager === "pnpm") return `corepack enable && pnpm run ${script}`;
  if (manager === "yarn") return `corepack enable && yarn ${script}`;
  return `npm run ${script}`;
};

const requestedNodeMajor = (packageJson) => {
  const range = typeof packageJson.engines?.node === "string" ? packageJson.engines.node : "";
  const major = Number(range.match(/\d{2}/)?.[0]);
  if (major >= 24) return 24;
  if (major >= 22) return 22;
  if (major >= 20) return 20;
  return 22;
};

const nodeRuntimeBase = (manager, packageJson) => manager === "bun"
  ? "oven/bun:1"
  : `node:${requestedNodeMajor(packageJson)}-bookworm-slim`;

const packageManagerSetup = (manager, packageJson) => {
  if (manager !== "npm") return null;
  const declared = typeof packageJson.packageManager === "string"
    ? packageJson.packageManager.match(/^npm@(.+)$/)?.[1]
    : null;
  const requested = declared ?? (typeof packageJson.engines?.npm === "string" ? packageJson.engines.npm : null);
  return requested && /^[A-Za-z0-9.*+_-]+$/.test(requested)
    ? `npm install --global ${JSON.stringify(`npm@${requested}`)}`
    : null;
};

const detectNode = async (root, requestedPort) => {
  const packagePath = join(root, "package.json");
  const content = await readText(packagePath, 2 * 1024 * 1024);
  let packageJson;
  try {
    packageJson = JSON.parse(content);
  } catch (error) {
    throw new Error(`package.json is invalid: ${error.message}`);
  }
  const scripts = packageJson.scripts && typeof packageJson.scripts === "object"
    ? packageJson.scripts
    : {};
  const dependencies = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };
  const manager = await packageManagerFor(root);
  const installCommand = nodeInstallCommand(manager);
  const managerSetupCommand = packageManagerSetup(manager, packageJson);
  const runtimeBase = nodeRuntimeBase(manager, packageJson);
  const buildCommand = scripts.build ? nodeScriptCommand(manager, "build") : null;
  const evidence = ["package.json", manager === "npm" ? "npm" : manager];
  const warnings = [];
  if (packageJson.workspaces) {
    warnings.push("Workspace Node detected; use --context when the runnable application is a sub-package.");
  }

  const staticResult = async (framework, outputDirectory, fallbackPort = 80) => ({
    kind: "node-static",
    stack: "node",
    framework,
    packageManager: manager,
    packageManagerSetupCommand: managerSetupCommand,
    installCommand,
    buildCommand: buildCommand ?? nodeScriptCommand(manager, "build"),
    startCommand: null,
    outputDirectory,
    runtimeBase,
    port: requestedPort ?? fallbackPort,
    evidence,
    warnings,
  });

  if (dependencies.next) {
    return {
      kind: "node-server",
      stack: "node",
      framework: "Next.js",
      packageManager: manager,
      packageManagerSetupCommand: managerSetupCommand,
      installCommand,
      buildCommand: buildCommand ?? nodeScriptCommand(manager, "build"),
      startCommand: scripts.start
        ? nodeScriptCommand(manager, "start")
        : "./node_modules/.bin/next start",
      runtimeBase,
      port: requestedPort ?? await inferPort(root, 3000),
      evidence: [...evidence, "next"],
      warnings,
    };
  }
  if (dependencies.nuxt || dependencies.nuxt3) {
    return {
      kind: "node-server",
      stack: "node",
      framework: "Nuxt",
      packageManager: manager,
      packageManagerSetupCommand: managerSetupCommand,
      installCommand,
      buildCommand: buildCommand ?? nodeScriptCommand(manager, "build"),
      startCommand: "node .output/server/index.mjs",
      runtimeBase,
      port: requestedPort ?? await inferPort(root, 3000),
      evidence: [...evidence, "nuxt"],
      warnings,
    };
  }
  if (dependencies["@sveltejs/kit"] && dependencies["@sveltejs/adapter-static"]) {
    return staticResult("SvelteKit (static)", "build");
  }
  if (dependencies["@sveltejs/kit"] && dependencies["@sveltejs/adapter-node"]) {
    return {
      kind: "node-server",
      stack: "node",
      framework: "SvelteKit (Node adapter)",
      packageManager: manager,
      packageManagerSetupCommand: managerSetupCommand,
      installCommand,
      buildCommand: buildCommand ?? nodeScriptCommand(manager, "build"),
      startCommand: "node build",
      runtimeBase,
      port: requestedPort ?? await inferPort(root, 3000),
      evidence: [...evidence, "@sveltejs/adapter-node"],
      warnings,
    };
  }
  if (dependencies.vite) return staticResult("Vite", "dist");
  if (dependencies["react-scripts"]) return staticResult("Create React App", "build");
  if (dependencies["@vue/cli-service"]) return staticResult("Vue CLI", "dist");
  if (dependencies.astro && !dependencies["@astrojs/node"]) return staticResult("Astro (static)", "dist");
  if (dependencies.astro && dependencies["@astrojs/node"]) {
    return {
      kind: "node-server",
      stack: "node",
      framework: "Astro (Node adapter)",
      packageManager: manager,
      packageManagerSetupCommand: managerSetupCommand,
      installCommand,
      buildCommand: buildCommand ?? nodeScriptCommand(manager, "build"),
      startCommand: "node ./dist/server/entry.mjs",
      runtimeBase,
      port: requestedPort ?? await inferPort(root, 4321),
      evidence: [...evidence, "@astrojs/node"],
      warnings,
    };
  }

  let startCommand = null;
  if (scripts.start) startCommand = nodeScriptCommand(manager, "start");
  else if (typeof packageJson.main === "string" && packageJson.main.trim()) {
    startCommand = `node ${JSON.stringify(packageJson.main.trim())}`;
  }
  if (!startCommand) {
    throw new Error(
      "Node project detected, but no supported web framework or start script was found. Add a start script or pass --base-image and --start-command.",
    );
  }
  return {
    kind: "node-server",
    stack: "node",
    framework: "Node.js",
    packageManager: manager,
    packageManagerSetupCommand: managerSetupCommand,
    installCommand,
    buildCommand,
    startCommand,
    runtimeBase,
    port: requestedPort ?? await inferPort(root, 3000),
    evidence,
    warnings,
  };
};

const pythonModule = (root, path) => unixPath(relative(root, path))
  .replace(/\.py$/i, "")
  .replace(/\/__init__$/i, "")
  .replaceAll("/", ".");

const detectPython = async (root, requestedPort) => {
  const evidence = [];
  for (const name of ["pyproject.toml", "requirements.txt", "Pipfile"]) {
    if (await fileExists(join(root, name))) evidence.push(name);
  }
  const procfile = join(root, "Procfile");
  if (await fileExists(procfile)) {
    const command = (await readText(procfile, 128 * 1024))
      .split(/\r?\n/)
      .map((line) => line.match(/^web:\s*(.+)$/)?.[1]?.trim())
      .find(Boolean);
    if (command) {
      return {
        kind: "python",
        stack: "python",
        framework: "Procfile web process",
        startCommand: command,
        extraPackage: null,
        port: requestedPort ?? await inferPort(root, 8000),
        evidence: [...evidence, "Procfile"],
        warnings: [],
      };
    }
  }

  const pythonFiles = (await collectSourceFiles(root)).filter((path) => extname(path) === ".py");
  for (const path of pythonFiles) {
    const content = await readText(path, 512 * 1024);
    const match = content.match(/([A-Za-z_]\w*)\s*=\s*FastAPI\s*\(/);
    if (match) {
      const port = requestedPort ?? await inferPort(root, 8000);
      return {
        kind: "python",
        stack: "python",
        framework: "FastAPI",
        startCommand: `python -m uvicorn ${pythonModule(root, path)}:${match[1]} --host 0.0.0.0 --port \${PORT:-${port}}`,
        extraPackage: "uvicorn",
        port,
        evidence: [...evidence, unixPath(relative(root, path))],
        warnings: [],
      };
    }
  }
  for (const path of pythonFiles) {
    const content = await readText(path, 512 * 1024);
    const match = content.match(/([A-Za-z_]\w*)\s*=\s*Flask\s*\(/);
    if (match) {
      const port = requestedPort ?? await inferPort(root, 8000);
      return {
        kind: "python",
        stack: "python",
        framework: "Flask",
        startCommand: `python -m gunicorn ${pythonModule(root, path)}:${match[1]} --bind 0.0.0.0:\${PORT:-${port}}`,
        extraPackage: "gunicorn",
        port,
        evidence: [...evidence, unixPath(relative(root, path))],
        warnings: [],
      };
    }
  }
  const wsgi = pythonFiles.find((path) => basename(path).toLowerCase() === "wsgi.py");
  if (wsgi) {
    const port = requestedPort ?? await inferPort(root, 8000);
    return {
      kind: "python",
      stack: "python",
      framework: "Django",
      startCommand: `python -m gunicorn ${pythonModule(root, wsgi)}:application --bind 0.0.0.0:\${PORT:-${port}}`,
      extraPackage: "gunicorn",
      port,
      evidence: [...evidence, unixPath(relative(root, wsgi))],
      warnings: [],
    };
  }
  throw new Error(
    "Python project detected, but no FastAPI, Flask, Django WSGI, or Procfile web entry point was found. Pass --base-image and --start-command.",
  );
};

const goMainTarget = async (root) => {
  const rootFiles = (await readdir(root, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".go"));
  for (const entry of rootFiles) {
    if (/^\s*package\s+main\b/m.test(await readText(join(root, entry.name), 512 * 1024))) return ".";
  }
  const cmdRoot = join(root, "cmd");
  if (!(await directoryExists(cmdRoot))) return null;
  const candidates = [];
  for (const entry of await readdir(cmdRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const directory = join(cmdRoot, entry.name);
    for (const file of await readdir(directory, { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith(".go")
        && /^\s*package\s+main\b/m.test(await readText(join(directory, file.name), 512 * 1024))) {
        candidates.push(`./cmd/${entry.name}`);
        break;
      }
    }
  }
  return candidates.length === 1 ? candidates[0] : null;
};

const detectGo = async (root, requestedPort) => {
  const goMod = await readText(join(root, "go.mod"), 512 * 1024);
  const target = await goMainTarget(root);
  if (!target) {
    throw new Error("Go module detected, but its runnable main package is ambiguous. Use --context for the command directory.");
  }
  const version = goMod.match(/^go\s+(\d+\.\d+)/m)?.[1] ?? "1.24";
  return {
    kind: "go",
    stack: "go",
    framework: "Go",
    goVersion: version,
    buildTarget: target,
    port: requestedPort ?? await inferPort(root, 8080),
    evidence: ["go.mod", target],
    warnings: [],
  };
};

const cargoPackageValue = (content, key) => {
  const section = content.match(/(?:^|\n)\[package\]\s*\n([\s\S]*?)(?=\n\s*\[|$)/)?.[1] ?? "";
  return section.match(new RegExp(`^\\s*${key}\\s*=\\s*["']([^"']+)["']`, "m"))?.[1] ?? null;
};

const detectRust = async (root, requestedPort) => {
  const cargo = await readText(join(root, "Cargo.toml"), 1024 * 1024);
  const binary = cargoPackageValue(cargo, "default-run") ?? cargoPackageValue(cargo, "name");
  if (!binary || !/^[A-Za-z0-9_.-]+$/.test(binary)) {
    throw new Error("Rust workspace detected without an unambiguous package binary. Use --context for the runnable crate.");
  }
  return {
    kind: "rust",
    stack: "rust",
    framework: "Rust",
    binary,
    locked: await fileExists(join(root, "Cargo.lock")),
    port: requestedPort ?? await inferPort(root, 8080),
    evidence: ["Cargo.toml", binary],
    warnings: [],
  };
};

const detectJava = async (root, requestedPort, buildSystem) => ({
  kind: "java",
  stack: "java",
  framework: buildSystem === "maven" ? "Java / Maven" : "Java / Gradle",
  buildSystem,
  port: requestedPort ?? await inferPort(root, 8080),
  evidence: [buildSystem === "maven" ? "pom.xml" : "build.gradle"],
  warnings: [],
});

const discoverCandidateContexts = async (root) => {
  const manifests = new Set([
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
  ]);
  const results = [];
  const pending = [{ path: root, depth: 0 }];
  while (pending.length) {
    const current = pending.shift();
    for (const entry of await readdir(current.path, { withFileTypes: true })) {
      if (entry.isFile() && manifests.has(entry.name)) {
        results.push(unixPath(relative(root, current.path)) || ".");
      } else if (entry.isDirectory() && current.depth < 2 && !IGNORED_DIRECTORIES.has(entry.name)) {
        pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
    }
  }
  return [...new Set(results)].slice(0, 12);
};

const customAnalysis = (options) => {
  if (!options.baseImage || !options.startCommand) {
    throw new Error("Custom packaging requires both --base-image and --start-command.");
  }
  return {
    kind: "custom",
    stack: "custom",
    framework: `Custom (${options.baseImage})`,
    baseImage: options.baseImage,
    installCommand: options.installCommand ?? null,
    buildCommand: options.buildCommand ?? null,
    startCommand: options.startCommand,
    port: options.containerPort ?? 8080,
    evidence: ["CLI overrides"],
    warnings: ["Custom commands are executed inside the Docker build or container."],
  };
};

export const analyzeProject = async (root, options = {}) => {
  const requestedPort = options.containerPort ? validPort(options.containerPort) : null;
  if (options.containerPort && !requestedPort) throw new Error("Container port must be between 1 and 65535.");
  if (options.baseImage || options.startCommand || options.installCommand || options.buildCommand) {
    return {
      ...customAnalysis({ ...options, containerPort: requestedPort }),
      environmentVariables: await environmentVariableNames(root),
      generated: true,
    };
  }

  const dockerfileName = options.dockerfile ?? "Dockerfile";
  const dockerfilePath = resolveInside(root, dockerfileName, "Dockerfile path");
  if (await fileExists(dockerfilePath)) {
    const content = await readText(dockerfilePath, 2 * 1024 * 1024);
    const port = requestedPort ?? dockerfilePort(content) ?? await composePort(root) ?? 8080;
    const warnings = ["The repository Dockerfile is reused verbatim; review it before building an untrusted repository."];
    if (!requestedPort && !dockerfilePort(content) && !(await composePort(root))) {
      warnings.push("No exposed port was detected; defaulting to container port 8080.");
    }
    return {
      kind: "dockerfile",
      stack: "docker",
      framework: "Existing Dockerfile",
      sourceDockerfile: unixPath(relative(root, dockerfilePath)),
      port,
      evidence: [unixPath(relative(root, dockerfilePath))],
      warnings,
      environmentVariables: await environmentVariableNames(root),
      generated: false,
    };
  }
  if (options.dockerfile) {
    throw new Error(`Requested Dockerfile was not found: ${options.dockerfile}`);
  }

  const signals = [];
  if (await fileExists(join(root, "package.json"))) signals.push("node");
  if (await fileExists(join(root, "pyproject.toml"))
    || await fileExists(join(root, "requirements.txt"))
    || await fileExists(join(root, "Pipfile"))) signals.push("python");
  if (await fileExists(join(root, "go.mod"))) signals.push("go");
  if (await fileExists(join(root, "Cargo.toml"))) signals.push("rust");
  if (await fileExists(join(root, "pom.xml"))) signals.push("maven");
  if (await fileExists(join(root, "build.gradle"))
    || await fileExists(join(root, "build.gradle.kts"))) signals.push("gradle");

  if (signals.length > 1) {
    throw new Error(
      `Several runnable stacks exist in the selected context (${signals.join(", ")}). Add a Dockerfile or choose a sub-project with --context.`,
    );
  }
  let analysis;
  if (signals[0] === "node") analysis = await detectNode(root, requestedPort);
  else if (signals[0] === "python") analysis = await detectPython(root, requestedPort);
  else if (signals[0] === "go") analysis = await detectGo(root, requestedPort);
  else if (signals[0] === "rust") analysis = await detectRust(root, requestedPort);
  else if (signals[0] === "maven") analysis = await detectJava(root, requestedPort, "maven");
  else if (signals[0] === "gradle") analysis = await detectJava(root, requestedPort, "gradle");
  else if (await fileExists(join(root, "index.html"))) {
    analysis = {
      kind: "static",
      stack: "static",
      framework: "Static site",
      port: requestedPort ?? 80,
      evidence: ["index.html"],
      warnings: [],
    };
  } else {
    const contexts = await discoverCandidateContexts(root);
    const hint = contexts.length ? ` Candidate contexts: ${contexts.join(", ")}.` : "";
    throw new Error(
      `No supported application stack was detected. Add a Dockerfile, choose --context, or pass custom build commands.${hint}`,
    );
  }
  return {
    ...analysis,
    environmentVariables: await environmentVariableNames(root),
    generated: true,
  };
};

const jsonInstruction = (instruction, command) => `${instruction} ${JSON.stringify(["sh", "-lc", command])}`;

export const renderDockerfile = (analysis) => {
  if (analysis.kind === "node-static") {
    const setup = analysis.packageManagerSetupCommand
      ? `${jsonInstruction("RUN", analysis.packageManagerSetupCommand)}\n`
      : "";
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
FROM ${analysis.runtimeBase} AS build
ENV CI=true
WORKDIR /app
COPY . .
${setup}${jsonInstruction("RUN", analysis.installCommand)}
${jsonInstruction("RUN", analysis.buildCommand)}

FROM nginx:1.27-alpine AS runtime
COPY .cst-docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/${analysis.outputDirectory} /usr/share/nginx/html
EXPOSE ${analysis.port}
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:${analysis.port}/healthz >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;
  }
  if (analysis.kind === "node-server") {
    const setup = analysis.packageManagerSetupCommand
      ? `${jsonInstruction("RUN", analysis.packageManagerSetupCommand)}\n`
      : "";
    const build = analysis.buildCommand ? `${jsonInstruction("RUN", analysis.buildCommand)}\n` : "";
    const user = analysis.packageManager === "bun" ? "bun" : "node";
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
FROM ${analysis.runtimeBase} AS runtime
ENV CI=true
WORKDIR /app
COPY . .
${setup}${jsonInstruction("RUN", analysis.installCommand)}
${build}ENV NODE_ENV=production PORT=${analysis.port} HOST=0.0.0.0
RUN chown -R ${user}:${user} /app
USER ${user}
EXPOSE ${analysis.port}
${jsonInstruction("CMD", analysis.startCommand)}
`;
  }
  if (analysis.kind === "python") {
    const extra = analysis.extraPackage
      ? `RUN python -m pip install --no-cache-dir ${analysis.extraPackage}\n`
      : "";
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=${analysis.port}
WORKDIR /app
RUN groupadd --system app && useradd --system --gid app --home /app app
COPY --chown=app:app . .
RUN if [ -f requirements.txt ]; then python -m pip install --no-cache-dir -r requirements.txt; fi \\
 && if [ -f pyproject.toml ]; then python -m pip install --no-cache-dir .; fi \\
 && if [ -f Pipfile ] && [ ! -f requirements.txt ] && [ ! -f pyproject.toml ]; then python -m pip install --no-cache-dir pipenv && pipenv requirements > /tmp/requirements.txt && python -m pip install --no-cache-dir -r /tmp/requirements.txt; fi
${extra}USER app
EXPOSE ${analysis.port}
${jsonInstruction("CMD", analysis.startCommand)}
`;
  }
  if (analysis.kind === "go") {
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
FROM golang:${analysis.goVersion}-bookworm AS build
WORKDIR /src
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/app ${analysis.buildTarget}

FROM alpine:3.21 AS runtime
RUN apk add --no-cache ca-certificates tzdata && adduser -D -H -u 10001 app
COPY --from=build /out/app /usr/local/bin/app
USER app
EXPOSE ${analysis.port}
ENTRYPOINT ["/usr/local/bin/app"]
`;
  }
  if (analysis.kind === "rust") {
    const locked = analysis.locked ? " --locked" : "";
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
FROM rust:1-bookworm AS build
WORKDIR /src
COPY . .
RUN cargo build --release${locked} --bin ${analysis.binary}

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libssl3 \\
 && rm -rf /var/lib/apt/lists/* \\
 && useradd --system --uid 10001 --no-create-home app
COPY --from=build /src/target/release/${analysis.binary} /usr/local/bin/app
USER app
EXPOSE ${analysis.port}
ENTRYPOINT ["/usr/local/bin/app"]
`;
  }
  if (analysis.kind === "java") {
    const builder = analysis.buildSystem === "maven"
      ? `FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY . .
RUN mvn -B -DskipTests package
RUN set -eu; jar="$(find target -maxdepth 1 -type f -name '*.jar' ! -name 'original-*' ! -name '*-sources.jar' ! -name '*-javadoc.jar' | head -n 1)"; test -n "$jar"; cp "$jar" /tmp/app.jar`
      : `FROM gradle:8-jdk21 AS build
WORKDIR /src
COPY . .
RUN if [ -f gradlew ]; then chmod +x gradlew && ./gradlew --no-daemon build -x test; else gradle --no-daemon build -x test; fi
RUN set -eu; jar="$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' ! -name '*-sources.jar' | head -n 1)"; test -n "$jar"; cp "$jar" /tmp/app.jar`;
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
${builder}

FROM eclipse-temurin:21-jre AS runtime
RUN useradd --system --uid 10001 --no-create-home app
COPY --from=build /tmp/app.jar /app.jar
USER app
EXPOSE ${analysis.port}
ENTRYPOINT ["java", "-jar", "/app.jar"]
`;
  }
  if (analysis.kind === "static") {
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git.
FROM alpine:3.21 AS content
WORKDIR /site
COPY . .
RUN rm -rf .cst-docker

FROM nginx:1.27-alpine AS runtime
COPY .cst-docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=content /site /usr/share/nginx/html
EXPOSE ${analysis.port}
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD wget -qO- http://127.0.0.1:${analysis.port}/healthz >/dev/null || exit 1
CMD ["nginx", "-g", "daemon off;"]
`;
  }
  if (analysis.kind === "custom") {
    const install = analysis.installCommand ? `${jsonInstruction("RUN", analysis.installCommand)}\n` : "";
    const build = analysis.buildCommand ? `${jsonInstruction("RUN", analysis.buildCommand)}\n` : "";
    return `# syntax=docker/dockerfile:1.7
# Generated by CST Dockerize Git from explicit commands.
FROM ${analysis.baseImage} AS runtime
WORKDIR /app
COPY . .
${install}${build}EXPOSE ${analysis.port}
${jsonInstruction("CMD", analysis.startCommand)}
`;
  }
  throw new Error(`No Dockerfile renderer exists for ${analysis.kind}.`);
};

export const prepareBuildFiles = async (root, analysis) => {
  const generatedDirectory = join(root, ".cst-docker");
  await mkdir(generatedDirectory, { recursive: true });
  const dockerfilePath = join(generatedDirectory, "Dockerfile");
  if (analysis.kind === "dockerfile") {
    await copyFile(resolveInside(root, analysis.sourceDockerfile, "Dockerfile path"), dockerfilePath);
  } else {
    await writeFile(dockerfilePath, renderDockerfile(analysis), "utf8");
  }
  const existingIgnore = await fileExists(join(root, ".dockerignore"))
    ? await readText(join(root, ".dockerignore"), 2 * 1024 * 1024)
    : "";
  const ignorePath = join(generatedDirectory, "Dockerfile.dockerignore");
  await writeFile(ignorePath, `${existingIgnore.trimEnd()}\n${SAFETY_DOCKERIGNORE.trimStart()}`, "utf8");
  let nginxPath = null;
  if (["node-static", "static"].includes(analysis.kind)) {
    nginxPath = join(generatedDirectory, "nginx.conf");
    await writeFile(nginxPath, nginxConfig(analysis.port), "utf8");
  }
  return {
    directory: generatedDirectory,
    dockerfilePath,
    dockerfileRelative: ".cst-docker/Dockerfile",
    ignorePath,
    nginxPath,
  };
};

export const copyBuildFiles = async (buildFiles, outputDirectory) => {
  await mkdir(outputDirectory, { recursive: true });
  await copyFile(buildFiles.dockerfilePath, join(outputDirectory, "Dockerfile"));
  await copyFile(buildFiles.ignorePath, join(outputDirectory, "Dockerfile.dockerignore"));
  if (buildFiles.nginxPath) await copyFile(buildFiles.nginxPath, join(outputDirectory, "nginx.conf"));
};

export const repositorySlug = (repository) => {
  const normalized = String(repository).replace(/[\\/]+$/, "");
  const tail = normalized.split(/[\\/:]/).filter(Boolean).at(-1)?.replace(/\.git$/i, "") ?? "project";
  return tail.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "project";
};

export const platformSlug = (platform) => String(platform || "auto").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");

export const defaultHostPort = (containerPort) => containerPort === 80 ? 8080 : containerPort;

export const renderCompose = ({ image, containerName, containerPort, hostPort }) => `services:
  app:
    image: ${image}
    container_name: ${containerName}
    restart: unless-stopped
    ports:
      - "\${HOST_PORT:-${hostPort}}:${containerPort}"
`;

export const renderRunScript = ({ image, containerName, containerPort, hostPort, archive = "image.tar.gz" }) => `#!/bin/sh
set -eu
cd "$(dirname "$0")"
gzip -dc '${archive}' | docker load
docker rm -f '${containerName}' >/dev/null 2>&1 || true
if [ -f .env ]; then
  docker run -d --name '${containerName}' --restart unless-stopped --env-file .env -p "\${HOST_PORT:-${hostPort}}:${containerPort}" '${image}'
else
  docker run -d --name '${containerName}' --restart unless-stopped -p "\${HOST_PORT:-${hostPort}}:${containerPort}" '${image}'
fi
docker inspect --format '{{.State.Status}}' '${containerName}'
`;

export const writePortableMetadata = async (outputDirectory, manifest, options = {}) => {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(outputDirectory, "compose.yaml"), renderCompose(manifest.run), "utf8");
  if (options.includeRunScript !== false) {
    await writeFile(join(outputDirectory, "run.sh"), renderRunScript(manifest.run), { encoding: "utf8", mode: 0o755 });
  }
};

export const validateBaseImage = (value) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/.test(value ?? "")) {
    throw new Error("Base image contains unsupported characters.");
  }
  return value;
};

export const validateImageReference = (value) => {
  if (!/^[a-z0-9][a-z0-9._/-]*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/.test(value ?? "")) {
    throw new Error("Image reference must use a lowercase repository name and a valid Docker tag.");
  }
  return value;
};

export const validateContainerName = (value) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value ?? "")) {
    throw new Error("Container name contains unsupported characters.");
  }
  return value;
};
