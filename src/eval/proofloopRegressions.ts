import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ProofLoopSource } from "./scaffoldProposal";

export const PROMOTED_REGRESSIONS_RELATIVE_PATH = "proofloop/regressions/promoted-regressions.json";
export const LEGACY_LOCAL_REGRESSIONS_RELATIVE_PATH = ".proofloop/regressions.json";

export type ProofLoopRegressionEntry = {
  suite: string;
  runId: string;
  failedGates: string[];
  promotedAt: string;
  promotedBy: "human" | "locked_verifier";
  source: ProofLoopSource;
  score?: number;
  minScore?: number;
  durationMs?: number;
};

export type ProofLoopRegressionRun = {
  suite: string;
  runId: string;
  failedGates?: string[];
  score?: number;
  minScore?: number;
  durationMs?: number;
};

export type ProofLoopRegressionPromotion = {
  entry: ProofLoopRegressionEntry;
  entries: ProofLoopRegressionEntry[];
  alreadyPromoted: boolean;
  migratedLegacyCount: number;
  trackedPath: string;
  relativePath: string;
};

export function promotedRegressionsPath(root: string): string {
  return join(root, ...PROMOTED_REGRESSIONS_RELATIVE_PATH.split("/"));
}

export function legacyLocalRegressionsPath(root: string): string {
  return join(root, ...LEGACY_LOCAL_REGRESSIONS_RELATIVE_PATH.split("/"));
}

export function readPromotedRegressions(root: string): ProofLoopRegressionEntry[] {
  return readRegressionEntries(promotedRegressionsPath(root), "tracked");
}

export function promoteProofloopRegression(
  root: string,
  run: ProofLoopRegressionRun,
  options: { now?: string; source?: ProofLoopSource; promotedBy?: ProofLoopRegressionEntry["promotedBy"] } = {},
): ProofLoopRegressionPromotion {
  const trackedPath = promotedRegressionsPath(root);
  const tracked = readRegressionEntries(trackedPath, "tracked");
  const legacy = readRegressionEntries(legacyLocalRegressionsPath(root), "legacy");
  const { entries: seeded, added: migratedLegacyCount } = mergeUniqueRegressions(tracked, legacy);
  const entry: ProofLoopRegressionEntry = {
    suite: run.suite,
    runId: run.runId,
    failedGates: run.failedGates ?? [],
    promotedAt: options.now ?? new Date().toISOString(),
    promotedBy: options.promotedBy ?? "human",
    source: options.source ?? "real_user_run",
    score: run.score,
    minScore: run.minScore,
    durationMs: run.durationMs,
  };
  const alreadyPromoted = seeded.some((existing) => sameRegression(existing, entry));
  const entries = alreadyPromoted ? seeded : [...seeded, entry];
  writeJson(trackedPath, entries);
  return {
    entry,
    entries,
    alreadyPromoted,
    migratedLegacyCount,
    trackedPath,
    relativePath: PROMOTED_REGRESSIONS_RELATIVE_PATH,
  };
}

function mergeUniqueRegressions(
  primary: ProofLoopRegressionEntry[],
  secondary: ProofLoopRegressionEntry[],
): { entries: ProofLoopRegressionEntry[]; added: number } {
  const entries = [...primary];
  let added = 0;
  for (const entry of secondary) {
    if (entries.some((existing) => sameRegression(existing, entry))) continue;
    entries.push(entry);
    added++;
  }
  return { entries, added };
}

function sameRegression(a: Pick<ProofLoopRegressionEntry, "suite" | "failedGates">, b: Pick<ProofLoopRegressionEntry, "suite" | "failedGates">): boolean {
  return a.suite === b.suite && JSON.stringify(a.failedGates) === JSON.stringify(b.failedGates);
}

function readRegressionEntries(path: string, kind: "tracked" | "legacy"): ProofLoopRegressionEntry[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.map(coerceRegressionEntry).filter((entry): entry is ProofLoopRegressionEntry => Boolean(entry));
  } catch (error) {
    if (kind === "legacy") return [];
    throw new Error(`Invalid tracked Proof Loop regression ledger at ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function coerceRegressionEntry(value: unknown): ProofLoopRegressionEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.suite !== "string" || typeof record.runId !== "string") return null;
  return {
    suite: record.suite,
    runId: record.runId,
    failedGates: Array.isArray(record.failedGates) ? record.failedGates.filter((gate): gate is string => typeof gate === "string") : [],
    promotedAt: typeof record.promotedAt === "string" ? record.promotedAt : new Date(0).toISOString(),
    promotedBy: record.promotedBy === "locked_verifier" ? "locked_verifier" : "human",
    source: coerceSource(record.source),
    score: typeof record.score === "number" ? record.score : undefined,
    minScore: typeof record.minScore === "number" ? record.minScore : undefined,
    durationMs: typeof record.durationMs === "number" ? record.durationMs : undefined,
  };
}

function coerceSource(value: unknown): ProofLoopSource {
  switch (value) {
    case "live_browser_proof":
    case "official_benchmark":
    case "human_feedback":
    case "redteam_proposal":
    case "synthetic_edge_case":
    case "model_generated_proposal":
      return value;
    default:
      return "real_user_run";
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
