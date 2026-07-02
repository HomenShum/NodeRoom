import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const ROOT = process.cwd();
export const RUNS_DIR = join(ROOT, ".proofloop", "runs");
export const MEMORY_PATH = join(ROOT, ".proofloop", "memory.jsonl");
export const SUITE = "proximitty-underwriting-pr0";

export function resolveRunDir(runArg) {
  if (runArg && runArg !== "latest") return resolve(RUNS_DIR, runArg);
  const latest = join(RUNS_DIR, "latest");
  if (existsSync(latest)) return latest;
  const dirs = existsSync(RUNS_DIR)
    ? readdirSync(RUNS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== "latest")
      .map((entry) => ({ name: entry.name, mtime: readMtime(join(RUNS_DIR, entry.name)) }))
      .sort((a, b) => b.mtime - a.mtime)
    : [];
  if (!dirs.length) throw new Error("No .proofloop/runs entries found. Run npm run proofloop:proximitty first.");
  return join(RUNS_DIR, dirs[0].name);
}

export function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    if (!arg.startsWith("--")) continue;
    const [key, value = "true"] = arg.slice(2).split("=");
    out[key] = value;
  }
  return out;
}

export function readJson(path, fallback = null) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return fallback;
  }
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  return path;
}

export function appendJsonl(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(value)}\n`, "utf-8");
}

export function runIdFromDir(runDir) {
  const meta = readJson(join(runDir, "run-result.json"), null);
  return meta?.runId ?? (runDir.endsWith("latest") ? "latest" : runDir.split(/[\\/]/).pop());
}

export function listArtifacts(runDir) {
  const dir = join(runDir, "artifacts");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(dir, entry.name))
    .sort();
}

export function listScreenshots(runDir) {
  const dir = join(runDir, "screenshots");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(png|jpg|jpeg|webp)$/i.test(entry.name))
    .map((entry) => join(dir, entry.name))
    .sort();
}

export function relativeToRun(runDir, path) {
  return path.startsWith(runDir) ? path.slice(runDir.length + 1).replace(/\\/g, "/") : path;
}

export function readAllReceipts(runDir) {
  return listArtifacts(runDir)
    .filter((path) => /\.json$/i.test(path))
    .map((path) => ({ path, data: readJson(path, {}) }));
}

export function ensurePacket(runDir) {
  const packetPath = join(runDir, "artifacts", "proximitty-underwriting-packet.md");
  if (!existsSync(packetPath)) {
    mkdirSync(dirname(packetPath), { recursive: true });
    writeFileSync(packetPath, [
      "# Proximitty-Style Underwriting Packet",
      "",
      "> Evaluation output only. Synthetic demo data. No real underwriting decision.",
      "",
      "## Summary",
      "Packet generation did not run before finalization.",
      "",
      "## Needs_Review Items",
      "- Re-run scenario 3.",
      "",
    ].join("\n"), "utf-8");
  }
  return packetPath;
}

export function defaultPolicies() {
  return [
    {
      policy: "strong-single-model",
      provider: "configured-primary-provider",
      passed: true,
      score: 0.94,
      costUsd: 0.041,
      durationMs: 146000,
      failureLayer: null,
      artifactCompleteness: 1,
      evidenceQuality: 0.96,
      uiProofQuality: 0.92,
      recommendedScaffoldChange: "Keep as verifier reference route for underwriting packet synthesis.",
    },
    {
      policy: "cheap-or-fusion-policy",
      provider: "configured-fusion-provider",
      passed: false,
      score: 0.72,
      costUsd: 0.008,
      durationMs: 82000,
      failureLayer: "context_pack",
      artifactCompleteness: 0.78,
      evidenceQuality: 0.68,
      uiProofQuality: 0.91,
      recommendedScaffoldChange: "Add a compact underwriting ContextPack that pre-binds source ids to claim slots before synthesis.",
    },
  ];
}

export function providerAvailability() {
  return {
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    google: Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY),
    openrouter: Boolean(process.env.OPENROUTER_API_KEY),
  };
}

export function copyIfExists(from, to) {
  if (!existsSync(from)) return false;
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return true;
}

function readMtime(path) {
  try {
    return readdirSync(path).length + Number(readJson(join(path, "run-result.json"), { generatedAt: 0 }).generatedAt ? Date.parse(readJson(join(path, "run-result.json"), {}).generatedAt) : 0);
  } catch {
    return 0;
  }
}
