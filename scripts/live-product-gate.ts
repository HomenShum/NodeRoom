import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type EnvMap = Record<string, string>;

const ROOT = process.cwd();

function parseEnvFile(path: string): EnvMap {
  if (!existsSync(path)) return {};
  const out: EnvMap = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[match[1]] = value;
  }
  return out;
}

function mergedEnv(): EnvMap {
  const fileEnv = {
    ...parseEnvFile(resolve(ROOT, ".env")),
    ...parseEnvFile(resolve(ROOT, ".env.local")),
  };
  const env: EnvMap = { ...fileEnv };
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function requireKey(env: EnvMap, keys: string[], purpose: string): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  console.error(`live-product-gate: missing ${purpose}. Expected one of: ${keys.join(", ")}`);
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const includeAgent = args.has("--agent");
const strictReview = args.has("--strict-review");
const env = mergedEnv();
const convexUrl = requireKey(env, ["E2E_CONVEX_URL", "VITE_CONVEX_URL", "CONVEX_URL"], "Convex URL");

env.VITE_CONVEX_URL = env.VITE_CONVEX_URL?.trim() || convexUrl;
env.E2E_CONVEX_URL = env.E2E_CONVEX_URL?.trim() || env.VITE_CONVEX_URL;
env.PLAYWRIGHT_PORT = env.PLAYWRIGHT_PORT?.trim() || (includeAgent ? "5221" : "5220");
env.PLAYWRIGHT_BASE_URL = env.PLAYWRIGHT_BASE_URL?.trim() || `http://127.0.0.1:${env.PLAYWRIGHT_PORT}`;
env.PLAYWRIGHT_RECORD_VIDEO = env.PLAYWRIGHT_RECORD_VIDEO?.trim() || "1";
env.VITE_NOTEBOOK_SYNC = env.VITE_NOTEBOOK_SYNC?.trim() || "prosemirror";
env.E2E_LIVE = "1";
if (strictReview) env.E2E_REQUIRE_REVIEW_MODE = "1";

if (includeAgent) {
  requireKey(env, ["OPENROUTER_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY"], "provider key for agent E2E");
}

const specs = [
  "e2e/reactivity.backend.spec.ts",
  "e2e/semantic-rebase.backend.spec.ts",
  "e2e/realtime-presence.spec.ts",
  "e2e/notebook-workplan-live.spec.ts",
  "e2e/live-broad-convex.spec.ts",
  ...(includeAgent ? ["e2e/three-user-collab.spec.ts"] : []),
];

console.log(`live-product-gate: ${includeAgent ? "backend + agent" : "backend"} specs on ${env.PLAYWRIGHT_BASE_URL}`);
console.log(`live-product-gate: ${specs.join(", ")}`);

const result = spawnSync("npx", ["playwright", "test", ...specs, "--workers=1", "--timeout=90000"], {
  cwd: ROOT,
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
