import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(root, "src-tauri", "target", "release", "cst-server.exe");
const token = "terminal-runtime-local-proof";
const dataDir = await mkdtemp(path.join(os.tmpdir(), "cst-terminal-runtime-"));
const workspace = path.join(dataDir, "workspace");
const accountHome = path.join(dataDir, "account-home");
let server;
let stderr = "";
let assertions = 0;

function check(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  assertions += 1;
}

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const { port } = listener.address();
  listener.close();
  await once(listener, "close");
  return port;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await predicate();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${label} timeout${lastError ? `: ${lastError.message}` : ""}`);
}

async function api(base, method, route, body) {
  return fetch(`${base}/api${route}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function connectTerminal(url) {
  const socket = new WebSocket(url);
  const messages = [];
  const waiters = [];
  let terminalError;

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    messages.push(message);
    for (const wake of waiters.splice(0)) wake();
  });
  socket.addEventListener("error", () => {
    terminalError = new Error("WebSocket terminal error");
    for (const wake of waiters.splice(0)) wake();
  });

  async function next(predicate, label, timeoutMs = 8_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate);
      if (index >= 0) return messages.splice(index, 1)[0];
      if (terminalError) throw terminalError;
      await Promise.race([
        new Promise((resolve) => waiters.push(resolve)),
        new Promise((resolve) => setTimeout(resolve, Math.min(100, deadline - Date.now()))),
      ]);
    }
    throw new Error(`${label} timeout; messages=${JSON.stringify(messages)}`);
  }

  return { socket, next };
}

try {
  await mkdir(workspace, { recursive: true });
  await mkdir(accountHome, { recursive: true });
  await writeFile(
    path.join(dataDir, "settings.json"),
    JSON.stringify({
      accounts: [{
        id: "runtime-account",
        label: "Runtime test",
        provider: "codex",
        codexHome: accountHome,
        projectDir: workspace,
        proxyId: null,
        startupCommand: null,
        limits: { connectedAt: null, sessionAnchorAt: null, weeklyAnchorAt: null },
        bypass: false,
        model: null,
        reasoningEffort: null,
      }],
      proxies: [],
      defaultAccountId: "runtime-account",
      shell: "powershell.exe",
      codexCommand: "codex",
      autoRunCodex: false,
      proxyControlsEnabled: false,
      codexBypass: false,
    }),
  );

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn(executable, [], {
    cwd: root,
    windowsHide: true,
    env: {
      ...process.env,
      CST_ADMIN_TOKEN: token,
      CST_BIND: `127.0.0.1:${port}`,
      CST_PUBLIC_BASE_URL: base,
      CST_ALLOWED_ORIGINS: base,
      CST_DATA_DIR: dataDir,
      CST_STATIC_DIR: path.join(root, "dist"),
      CST_WORKSPACES_ROOT: dataDir,
      CST_NODE_ID: "terminal-runtime",
      CST_NODE_LABEL: "Terminal runtime test",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  server.stderr.on("data", (chunk) => { stderr += String(chunk); });

  await waitFor(async () => (await fetch(`${base}/healthz`)).ok, 10_000, "server startup");
  const start = await api(base, "POST", "/terminals", {
    accountId: "runtime-account",
    workspacePath: workspace,
    cols: 80,
    rows: 24,
    command: "Write-Output 'CST_BOOT_READY'",
    loginOnly: false,
  });
  if (start.status !== 200) {
    throw new Error(`terminal start failed (${start.status}): ${await start.text()}`);
  }
  assertions += 1;
  const { id } = await start.json();
  check(Number.isInteger(id), "terminal id must be an integer");

  const wsUrl = `ws://127.0.0.1:${port}/ws/terminals/${id}?token=${encodeURIComponent(token)}`;
  const first = connectTerminal(wsUrl);
  const status = await first.next((message) => message.type === "status", "initial status");
  equal(status.status, "active", "terminal must connect as active");
  await first.next(
    (message) => message.type === "data" && message.data.includes("CST_BOOT_READY"),
    "initial PTY output",
  );
  assertions += 1;

  first.socket.send(JSON.stringify({ type: "ping" }));
  await first.next((message) => message.type === "pong", "websocket pong");
  assertions += 1;

  first.socket.send(JSON.stringify({ type: "resize", cols: 93, rows: 31 }));
  first.socket.send(JSON.stringify({
    type: "input",
    data: "$s=$Host.UI.RawUI.WindowSize; Write-Output ('CST_SIZE_'+$s.Width+'x'+$s.Height); Write-Output 'CST_INPUT_OK'\r",
  }));
  await first.next(
    (message) => message.type === "data" && message.data.includes("CST_SIZE_93x31"),
    "PTY resize",
  );
  await first.next(
    (message) => message.type === "data" && message.data.includes("CST_INPUT_OK"),
    "interactive input",
  );
  assertions += 2;

  const firstClosed = once(first.socket, "close");
  first.socket.close(1000, "runtime reconnect");
  await firstClosed;
  const bufferedWrite = await api(base, "POST", `/terminals/${id}/write`, {
    data: "Write-Output 'CST_RECONNECT_BUFFERED'\r",
  });
  equal(bufferedWrite.status, 200, "write while disconnected must succeed");
  await new Promise((resolve) => setTimeout(resolve, 150));

  const second = connectTerminal(wsUrl);
  await second.next((message) => message.type === "status", "reconnected status");
  await second.next(
    (message) => message.type === "data" && message.data.includes("CST_RECONNECT_BUFFERED"),
    "buffered reconnect output",
  );
  assertions += 2;
  second.socket.send(JSON.stringify({ type: "input", data: "Write-Output 'CST_AFTER_RECONNECT'\r" }));
  await second.next(
    (message) => message.type === "data" && message.data.includes("CST_AFTER_RECONNECT"),
    "input after reconnect",
  );
  assertions += 1;

  const secondClosed = once(second.socket, "close");
  second.socket.send(JSON.stringify({ type: "stop" }));
  await secondClosed;
  await waitFor(async () => {
    const health = await api(base, "GET", "/health");
    const payload = await health.json();
    return payload.activeTerminals === 0;
  }, 5_000, "terminal stop");
  assertions += 1;

  const afterStopWrite = await api(base, "POST", `/terminals/${id}/write`, { data: "ignored" });
  equal(afterStopWrite.status, 404, "stopped terminal must no longer accept input");
  const idempotentStop = await api(base, "DELETE", `/terminals/${id}`);
  equal(idempotentStop.status, 200, "terminal stop must be idempotent");

  process.stdout.write(`${JSON.stringify({
    ok: true,
    assertions,
    covered: ["connect", "initial-output", "ping", "input", "resize", "reconnect-buffer", "post-reconnect-input", "stop", "idempotent-stop"],
  })}\n`);
} finally {
  if (server && server.exitCode === null) {
    if (process.platform === "win32" && server.pid) {
      spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { windowsHide: true });
    } else {
      server.kill();
    }
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
  }
  try {
    await rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch (error) {
    process.stderr.write(`Temporary cleanup warning: ${error.message}\n`);
  }
  if (stderr.trim()) process.stderr.write(stderr);
}
