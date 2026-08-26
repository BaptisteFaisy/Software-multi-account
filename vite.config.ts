import { execSync } from "node:child_process";
import { defineConfig } from "vite";

const buildId =
  process.env.CST_BUILD_ID
  ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

// Commit git embarque dans le bundle frontend. Le serveur expose le meme commit
// via /healthz (server.rs COMMIT, lui-meme alimente par CST_GIT_COMMIT) : le
// client web compare les deux pour recharger automatiquement apres un
// deploiement. Priorite identique a src-tauri/build.rs : env CST_GIT_COMMIT,
// puis `git rev-parse --short HEAD`, puis "unknown".
const gitShortCommit = (): string | undefined => {
  try {
    const commit = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    return commit || undefined;
  } catch {
    return undefined;
  }
};

const buildCommit = process.env.CST_GIT_COMMIT?.trim() || gitShortCommit() || "unknown";

export default defineConfig({
  clearScreen: false,
  define: {
    __CST_BUILD_ID__: JSON.stringify(buildId),
    __CST_BUILD_COMMIT__: JSON.stringify(buildCommit),
  },
  build: {
    emptyOutDir: true,
    target: "es2022",
    modulePreload: { polyfill: false },
  },
  server: {
    strictPort: true,
    host: "127.0.0.1",
    port: 1420,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

