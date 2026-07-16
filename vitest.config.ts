import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@agents": fileURLToPath(new URL("./src/agents", import.meta.url)),
      "@nodeagent": fileURLToPath(new URL("./src/nodeagent", import.meta.url)),
    },
  },
  test: {
    maxWorkers: 2,
    setupFiles: ["tests/setup/dom.ts"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          pool: "forks",
          include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          pool: "forks",
          include: ["tests/**/*.test.tsx", "src/**/*.test.tsx"],
        },
      },
    ],
  },
});
