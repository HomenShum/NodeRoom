import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PYODIDE_RUNTIME_FILES = [
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "pyodide-lock.json",
  "python_stdlib.zip",
] as const;

function pyodideRuntimeAssets(): Plugin {
  const runtimeRoot = resolve(fileURLToPath(new URL("./node_modules/pyodide", import.meta.url)));
  const allowed = new Set<string>(PYODIDE_RUNTIME_FILES);
  const runtimeSource = (file: string) => {
    const source = readFileSync(resolve(runtimeRoot, file));
    if (file !== "pyodide.mjs") return source;
    // The package references a map that this application intentionally does not
    // ship. Remove only that trailing vendor annotation from the copied asset.
    return source.toString("utf8").replace(/\r?\n\/\/# sourceMappingURL=pyodide\.mjs\.map\s*$/u, "\n");
  };
  const contentType = (file: string) => file.endsWith(".wasm") ? "application/wasm"
    : file.endsWith(".mjs") ? "text/javascript; charset=utf-8"
      : file.endsWith(".json") ? "application/json; charset=utf-8"
        : "application/zip";
  return {
    name: "noderoom-pyodide-runtime-assets",
    configureServer(server) {
      server.middlewares.use("/pyodide", (request, response, next) => {
        const path = decodeURIComponent((request.url ?? "").split("?", 1)[0]);
        const file = path.split("/").filter(Boolean).at(-1) ?? "";
        if (!allowed.has(file)) return next();
        response.statusCode = 200;
        response.setHeader("Content-Type", contentType(file));
        response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        response.end(runtimeSource(file));
      });
    },
    generateBundle() {
      for (const file of PYODIDE_RUNTIME_FILES) {
        this.emitFile({ type: "asset", fileName: `pyodide/${file}`, source: runtimeSource(file) });
      }
    },
  };
}

export default defineConfig({
  plugins: [pyodideRuntimeAssets(), tailwindcss(), react()],
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
  worker: { format: "es" },
  build: {
    outDir: "dist",
    sourcemap: process.env.VITE_BUILD_SOURCEMAP === "1",
    chunkSizeWarningLimit: 1100,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        aiElementsCheck: fileURLToPath(new URL("./ai-elements-check.html", import.meta.url)),
      },
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
