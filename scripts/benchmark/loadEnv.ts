/**
 * Side-effect module: load .env.local into process.env. MUST be imported FIRST
 * (before any @ai-sdk/* module), because providers capture env (API key, BASE_URL)
 * at module-init — a stale shell ANTHROPIC_BASE_URL=…api.anthropic.com (missing /v1)
 * otherwise 404s every Anthropic call. .env.local is authoritative by default.
 *
 * Set NODEROOM_PRESERVE_PROCESS_ENV=1 when a caller has already injected
 * deployment-owned secrets, for example from `npx convex env get ...`.
 */
import { readFileSync } from "node:fs";
try {
  const preserveProcessEnv = process.env.NODEROOM_PRESERVE_PROCESS_ENV === "1";
  for (const line of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) {
      const key = m[1];
      if (preserveProcessEnv && process.env[key]) continue;
      process.env[key] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch { /* no .env.local */ }
