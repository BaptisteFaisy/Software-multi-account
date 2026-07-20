import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const harnessName = process.argv[2] ?? "test-update-node-linux-runtime.sh";
const allowedHarnesses = new Set([
  "test-update-node-linux-runtime.sh",
  "test-update-node-linux-concurrency-runtime.sh",
]);
if (!allowedHarnesses.has(harnessName)) {
  throw new Error(`Harnais Linux non autorise: ${harnessName}`);
}
const harness = path.join(root, "scripts", harnessName);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env },
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} a echoue (${signal ?? code}).`));
    });
  });
}

if (process.platform === "win32") {
  const distro = process.env.CST_WSL_DISTRO || "Ubuntu";
  const translated = spawnSync(
    "wsl.exe",
    ["-d", distro, "-u", "root", "--", "wslpath", "-a", harness.replaceAll("\\", "/")],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  if (translated.status !== 0 || !translated.stdout.trim()) {
    throw new Error(`Impossible de traduire le chemin WSL: ${translated.stderr || translated.error}`);
  }
  await run("wsl.exe", [
    "-d",
    distro,
    "-u",
    "root",
    "--",
    "bash",
    translated.stdout.trim(),
  ]);
} else {
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error("Le harnais Linux doit etre lance avec sudo (isolation mount namespace). ");
  }
  await run("bash", [harness]);
}
