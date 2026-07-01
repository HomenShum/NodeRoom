import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Single React instance — @xyflow/react can pull a nested copy, which triggers "Invalid hook call".
    dedupe: ["react", "react-dom"],
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@engine": fileURLToPath(new URL("./src/engine", import.meta.url)),
      "@ui": fileURLToPath(new URL("./src/ui", import.meta.url)),
      "@agents": fileURLToPath(new URL("./src/agents", import.meta.url)),
      "@nodeagent": fileURLToPath(new URL("./src/nodeagent", import.meta.url)),
    },
  },
  server: {
    port: 5260,
    open: false,
    watch: {
      ignored: [
        "**/.tmp/**",
        "**/test-results/**",
        "**/playwright-report/**",
        "**/nodetrace/.tmp/**",
      ],
    },
  },
  optimizeDeps: { include: ["exceljs", "@xyflow/react"] },
  build: {
    outDir: "dist",
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === "1",
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return "react-vendor";
          if (id.includes("@tiptap") || id.includes("prosemirror")) return "editor-vendor";
          if (id.includes("@xyflow")) return "graph-vendor";
          if (id.includes("exceljs") || id.includes("jszip")) return "workbook-vendor";
          if (id.includes("react-pdf") || id.includes("pdfjs-dist")) return "pdf-vendor";
          if (id.includes("convex") || id.includes("@convex-dev")) return "convex-vendor";
          if (id.includes("lucide-react")) return "icons-vendor";
          return "vendor";
        },
      },
    },
  },
});
