import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(
  new URL("../scripts/measure-server-resources.ps1", import.meta.url),
);

const collect = (child) =>
  new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`sampler exit ${code}: ${stderr}`));
    });
  });

const waitForReady = (child) => new Promise((resolve, reject) => {
  let stdout = "";
  let stderr = "";
  const timeout = setTimeout(() => {
    reject(new Error(`target readiness timeout: ${stderr}`));
  }, 15_000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("ready")) {
      clearTimeout(timeout);
      resolve();
    }
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  child.once("error", (error) => {
    clearTimeout(timeout);
    reject(error);
  });
  child.once("close", (code) => {
    clearTimeout(timeout);
    reject(new Error(`target exited before readiness (${code}): ${stderr}`));
  });
});

const killTree = (pid) => {
  if (!pid) return;
  spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
};

test(
  "le sampler produit une baseline JSON sans se compter lui-meme",
  { skip: process.platform !== "win32", timeout: 45_000 },
  async () => {
    // Le premier Add-Type peut prendre plusieurs secondes sur une petite
    // machine ou lorsque l'antivirus inspecte le compilateur C#. La cible doit
    // rester vivante pendant ce cout de demarrage, qui precede volontairement
    // la fenetre mesuree.
    const target = spawn(process.execPath, ["-e", [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { stdio: "ignore", windowsHide: true });',
      'child.once("spawn", () => process.stdout.write("ready\\n"));',
      "setTimeout(() => {}, 120000);",
    ].join("\n")], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    try {
      assert.ok(target.pid);
      await waitForReady(target);
      const sampler = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-RootProcessId",
          String(target.pid),
          "-DurationSeconds",
          "2",
          "-SampleIntervalMilliseconds",
          "250",
          "-Label",
          "automated-test",
        ],
        { windowsHide: true },
      );

      const result = JSON.parse(await collect(sampler));
      assert.equal(result.schemaVersion, 2);
      assert.equal(result.label, "automated-test");
      assert.equal(result.root.processId, target.pid);
      assert.equal(result.window.endedEarly, false);
      assert.ok(result.window.sampleCount >= 2);
      assert.equal(result.window.processTreeRefreshMilliseconds, 5000);
      assert.ok(result.window.processTreeRefreshCount >= 1);
      assert.ok(
        result.window.processTreeRefreshCount <= result.window.sampleCount,
      );
      assert.ok(result.window.observedDurationSeconds >= 2);
      assert.ok(result.aggregate.processCount.initial >= 2);
      assert.ok(
        result.aggregate.processCount.peak >= result.aggregate.processCount.initial,
      );
      assert.ok(result.aggregate.workingSetMiB.peak > 0);
      assert.ok(result.aggregate.privateMemoryMiB.peak > 0);
      assert.ok(result.aggregate.collectionMilliseconds.peak > 0);
      assert.ok(result.observedProcessNames.includes("node"));
      assert.ok(!result.observedProcessNames.includes("powershell"));
      assert.ok(result.observedProcessNames.every(Boolean));

      const node = result.byProcessName.find(
        (entry) => entry.processName === "node",
      );
      assert.ok(node);
      assert.ok(node.processCount.initial >= 1);
      assert.ok(node.workingSetMiB.peak > 0);
      assert.ok(node.privateMemoryMiB.peak > 0);
      assert.ok(node.threadCount.peak > 0);
      assert.ok(node.handleCount.peak > 0);
      assert.ok(node.cpuSeconds >= 0);

      const directNode = result.topology.rootChildrenByProcessName.find(
        (entry) => entry.processName === "node",
      );
      assert.ok(directNode);
      assert.ok(directNode.processCount.initial >= 1);
      assert.ok(directNode.processCount.peak >= directNode.processCount.initial);
    } finally {
      killTree(target.pid);
    }
  },
);
