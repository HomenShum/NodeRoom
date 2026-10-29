import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser talks to the worker through this proxy, so no CORS and no keys in the bundle.
const worker = `http://127.0.0.1:${process.env.NODE_AGENT_WORKER_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/agent-api": { target: worker, changeOrigin: true, rewrite: (p) => p.replace(/^\/agent-api/, "") } },
  },
});
