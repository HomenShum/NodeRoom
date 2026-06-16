import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@agents": fileURLToPath(new URL("./src/agents", import.meta.url)),
      "@nodeagent": fileURLToPath(new URL("./src/nodeagent", import.meta.url)),
    },
  },
  server: { port: 5260, open: false },
  optimizeDeps: { include: ["exceljs"] },
  build: { outDir: "dist", sourcemap: process.env.VITE_BUILD_SOURCEMAP === "1" },
});
