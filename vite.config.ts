import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { execFileSync } from "node:child_process";
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

export const UNAVAILABLE_BUILD_SHA = "unavailable";

export type BuildEnvironment = Readonly<Record<string, string | undefined>>;
export type BuildShaOptions = Readonly<{
  checkoutSha?: string | null;
  strict?: boolean;
}>;

const REPOSITORY_ROOT = fileURLToPath(new URL(".", import.meta.url));
const BUILD_SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BUILD_SHA_ENVIRONMENT_KEYS = [
  "VERCEL_GIT_COMMIT_SHA",
  "GITHUB_SHA",
  "VITE_GIT_SHA",
] as const;

function normalizeBuildSha(value: string | null | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && BUILD_SHA_PATTERN.test(normalized) ? normalized : undefined;
}

export function loadBuildEnvironment(
  mode: string,
  repositoryRoot: string = REPOSITORY_ROOT,
  runtimeEnvironment: BuildEnvironment = process.env,
): BuildEnvironment {
  // Vite gives shell/deployment variables precedence over committed env files.
  // Keep that ordering explicit while loading with an empty prefix so the
  // server-only Vercel and GitHub variables remain visible to this config.
  return {
    ...loadEnv(mode, repositoryRoot, ""),
    ...runtimeEnvironment,
  };
}

function unavailableOrThrow(strict: boolean, message: string): string {
  if (strict) throw new Error(`NodeRoom build provenance failed: ${message}`);
  return UNAVAILABLE_BUILD_SHA;
}

export function readCheckoutSha(repositoryRoot: string = REPOSITORY_ROOT): string | undefined {
  try {
    const output = execFileSync(
      "git",
      ["rev-parse", "--verify", "HEAD^{commit}"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5_000,
        windowsHide: true,
      },
    );
    return normalizeBuildSha(output);
  } catch {
    return undefined;
  }
}

export function resolveBuildSha(
  environment: BuildEnvironment = process.env,
  options: BuildShaOptions = {},
): string {
  const strict = options.strict === true;
  const providedSignals = BUILD_SHA_ENVIRONMENT_KEYS
    .filter((key) => environment[key] !== undefined)
    .map((key) => ({ key, sha: normalizeBuildSha(environment[key]) }));
  const malformedSignals = providedSignals
    .filter((signal) => signal.sha === undefined)
    .map((signal) => signal.key);
  if (malformedSignals.length > 0) {
    return unavailableOrThrow(
      strict,
      `malformed build SHA signal: ${malformedSignals.join(", ")}`,
    );
  }

  const validSignals = providedSignals as Array<{
    key: typeof BUILD_SHA_ENVIRONMENT_KEYS[number];
    sha: string;
  }>;
  const distinctSignals = new Set(validSignals.map((signal) => signal.sha));
  if (distinctSignals.size > 1) {
    return unavailableOrThrow(
      strict,
      `conflicting build SHA signals: ${validSignals.map((signal) => signal.key).join(", ")}`,
    );
  }

  const checkoutSha = normalizeBuildSha(
    options.checkoutSha === undefined ? readCheckoutSha() : options.checkoutSha,
  );
  if (!checkoutSha) {
    return unavailableOrThrow(strict, "actual Git checkout SHA is unavailable");
  }

  const signaledSha = validSignals[0]?.sha;
  if (signaledSha && signaledSha !== checkoutSha) {
    return unavailableOrThrow(
      strict,
      "build SHA signal does not match the actual Git checkout",
    );
  }

  return checkoutSha;
}

export function buildProvenanceMeta(
  environment: BuildEnvironment = process.env,
  options: BuildShaOptions = {},
) {
  const sha = resolveBuildSha(environment, options);
  return {
    tag: "meta",
    attrs: {
      name: "noderoom-build-sha",
      content: sha,
      "data-provenance": sha === UNAVAILABLE_BUILD_SHA ? "unavailable" : "commit",
    },
    injectTo: "head" as const,
  };
}

function buildProvenance(
  environment: BuildEnvironment = process.env,
  options: BuildShaOptions = {},
): Plugin {
  // Resolve while Vite creates the config so an invalid production identity
  // stops the build before Rollup transforms any application modules.
  const meta = buildProvenanceMeta(environment, options);
  return {
    name: "noderoom-build-provenance",
    transformIndexHtml() {
      return [meta];
    },
  };
}

function isTruthyEnvironmentFlag(value: string | undefined): boolean {
  return value !== undefined
    && !["", "0", "false", "no", "off"].includes(value.trim().toLowerCase());
}

export function requiresStrictBuildProvenance(
  command: "build" | "serve",
  mode: string,
  environment: BuildEnvironment = process.env,
): boolean {
  return command === "build"
    || mode === "production"
    || isTruthyEnvironmentFlag(environment.CI)
    || isTruthyEnvironmentFlag(environment.VERCEL);
}

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

export default defineConfig(({ command, mode }) => {
  const environment = loadBuildEnvironment(mode);
  return {
    plugins: [
      buildProvenance(environment, {
        checkoutSha: readCheckoutSha(),
        strict: requiresStrictBuildProvenance(command, mode, environment),
      }),
      pyodideRuntimeAssets(),
      tailwindcss(),
      react(),
    ],
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
            // Let Rollup preserve dynamic-import boundaries for expensive optional
            // renderers (Shiki, Mermaid, KaTeX) instead of pulling them into first paint.
            return undefined;
          },
        },
      },
    },
  };
});
