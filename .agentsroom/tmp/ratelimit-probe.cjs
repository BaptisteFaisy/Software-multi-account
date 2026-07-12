const { spawn } = require("child_process");

// Faithful reproduction of settings.rs::read_server_rate_limits on Windows.
// The Rust app runs: cmd.exe /S /C "codex app-server --stdio" with CODEX_HOME set.
const home = process.argv[2];
console.log("CODEX_HOME =", JSON.stringify(home));

const child = spawn("cmd.exe", ["/S", "/C", "codex app-server --stdio"], {
  env: { ...process.env, CODEX_HOME: home, NO_COLOR: "1" },
  stdio: ["pipe", "pipe", "pipe"],
});

let buf = "";
const t = setTimeout(() => {
  console.log("RESULT: TIMEOUT (no id:2 within 18s)");
  try { child.kill(); } catch {}
  process.exit(0);
}, 18000);

child.stdout.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let v;
    try { v = JSON.parse(line); } catch { console.log("OUT(non-json):", line.slice(0, 200)); continue; }
    console.log("MSG id=" + JSON.stringify(v.id) + " method=" + JSON.stringify(v.method) + " keys=" + Object.keys(v).join(","));
    if (v.id === 2) {
      console.log("RESULT: GOT RESPONSE:", JSON.stringify(v).slice(0, 800));
      clearTimeout(t);
      try { child.kill(); } catch {}
      process.exit(0);
    }
  }
});
child.stderr.on("data", (d) => process.stdout.write("[ERR] " + d.toString()));
child.on("error", (e) => { console.log("SPAWN ERROR:", e.message); process.exit(0); });

const reqs = [
  { method: "initialize", id: 1, params: { clientInfo: { name: "codex_switch_terminal", title: "Codex Switch Terminal", version: "x" } } },
  { method: "initialized", params: {} },
  { method: "account/rateLimits/read", id: 2 },
];
setTimeout(() => { for (const r of reqs) child.stdin.write(JSON.stringify(r) + "\n"); }, 300);
