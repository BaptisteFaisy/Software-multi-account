import { defineConfig } from "vite";

const buildId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export default defineConfig({
  clearScreen: false,
  define: {
    __CST_BUILD_ID__: JSON.stringify(buildId),
  },
  build: {
    emptyOutDir: true,
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

