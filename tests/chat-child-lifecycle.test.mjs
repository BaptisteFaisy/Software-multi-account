import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const chatBackend = await readFile(
  path.join(root, "src-tauri", "src", "chat.rs"),
  "utf8",
);

const delay = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

// La creation de powershell.exe peut depasser cinq secondes sur une petite
// machine ou sous une charge multi-agent. Ce delai ne mesure pas le produit :
// le test attend seulement la preuve que son descendant factice est pret.
const PROCESS_START_TIMEOUT_MILLISECONDS = 15_000;

const waitFor = async (predicate, timeoutMilliseconds = 5_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await delay(25);
  }
  throw new Error("condition de cycle de vie non atteinte avant le timeout");
};

const exists = async (file) => {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
};

const escapePowerShellLiteral = (value) => value.replaceAll("'", "''");

const processIsAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("le chemin terminal du chat libere toujours son arbre de processus", () => {
  assert.match(
    chatBackend,
    /impl Drop for ChatTurn[\s\S]*?terminate_chat_process_tree\(child\)/,
  );
  assert.match(
    chatBackend,
    /fn wait_for_child[\s\S]*?provider_terminal_event\(turn\)[\s\S]*?PROVIDER_EXIT_GRACE[\s\S]*?terminate_chat_process_tree\(child\)[\s\S]*?child\.wait\(\)/,
  );
  assert.match(
    chatBackend,
    /let exit = wait_for_child\(&supervisor_turn\)[\s\S]*?child\.take\(\)/,
  );
  assert.match(
    chatBackend,
    /taskkill[\s\S]*?\.args\(\["\/PID", pid\.as_str\(\), "\/T", "\/F"\]\)/,
  );
});

test(
  "taskkill ferme le wrapper de chat et son descendant au lieu de l'orpheliner",
  { skip: process.platform !== "win32", timeout: 45_000 },
  async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "cst-chat-lifecycle-"));
    const started = path.join(directory, "started.txt");
    const wrapperScript = path.join(directory, "wrapper.cmd");
    const script = [
      `[IO.File]::WriteAllText('${escapePowerShellLiteral(started)}', $PID)`,
      "Start-Sleep -Seconds 30",
    ].join("; ");
    await writeFile(
      wrapperScript,
      `@echo off\r\npowershell.exe -NoProfile -NonInteractive -Command "${script}"\r\n`,
      "utf8",
    );
    const wrapper = spawn(
      "cmd.exe",
      ["/D", "/S", "/C", wrapperScript],
      { stdio: "ignore", windowsHide: true },
    );
    wrapper.unref();

    try {
      assert.ok(wrapper.pid, "le wrapper factice doit demarrer");
      await waitFor(() => exists(started), PROCESS_START_TIMEOUT_MILLISECONDS);
      const descendantPid = Number.parseInt(await readFile(started, "utf8"), 10);
      assert.ok(Number.isInteger(descendantPid) && descendantPid > 0);
      assert.equal(
        processIsAlive(descendantPid),
        true,
        "preuve avant: le descendant est vivant",
      );

      const killer = spawn(
        "taskkill.exe",
        ["/PID", String(wrapper.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.unref();
      assert.ok(killer.pid, "taskkill /T /F doit demarrer");
      await waitFor(() => !processIsAlive(descendantPid), 15_000);
      await waitFor(() => !processIsAlive(killer.pid), 5_000);
      assert.equal(
        processIsAlive(descendantPid),
        false,
        "preuve apres: le descendant a ete libere",
      );
    } finally {
      if (wrapper.pid && processIsAlive(wrapper.pid)) {
        spawnSync(
          "taskkill.exe",
          ["/PID", String(wrapper.pid), "/T", "/F"],
          { stdio: "ignore", windowsHide: true, timeout: 5_000 },
        );
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
