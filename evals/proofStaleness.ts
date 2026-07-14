/**
 * Proof staleness gate (Harness Hardening #7, docs/eval/FEATURE_EVAL_BACKLOG.md).
 *
 * Proofs decay: a committed champion summary is evidence about the route AS IT WAS on
 * generatedAt — providers swap weights and quantization behind stable model ids, so a proof older
 * than the window is a memory, not a claim. This module is the mechanical version of the
 * promotion-rule sentence "stale proofs are labeled, not silently trusted": every summary a
 * marketing surface cites is listed in MARKETED_PROOFS, and the gate goes red when one outlives
 * its window. Re-verify (rerun the batch) or pull the claim — those are the only two green paths.
 *
 * Runs as `npm run proofs:staleness` and inside vitest (tests/proofStaleness.test.ts), so CI
 * going red ~30 days after the last verification is the intended behavior, not a flake.
 */
import { existsSync, readFileSync } from "node:fs";

export type ProofRegistryEntry = {
  /** Repo-relative path to the committed redacted summary. */
  path: string;
  /** What marketing claim this proof carries — the thing that must be pulled if stale. */
  claim: string;
  /** Override window in days; defaults to DEFAULT_PROOF_MAX_AGE_DAYS. */
  maxAgeDays?: number;
};

export const DEFAULT_PROOF_MAX_AGE_DAYS = 30;

export const MARKETED_PROOFS: ProofRegistryEntry[] = [
  {
    path: "docs/eval/noderoom-fresh-user-vertical-proof.json",
    claim: "NodeRoom fresh-user product path, work-artifact workflows, and deterministic repository validation",
  },
];

export type ProofStalenessResult = {
  path: string;
  claim: string;
  ok: boolean;
  ageDays?: number;
  reason: string;
};

/** Pure check — injected now/json so scenarios can test the date math deterministically. */
export function evaluateProofStaleness(
  entry: ProofRegistryEntry,
  summaryJson: unknown,
  nowMs: number,
): ProofStalenessResult {
  const generatedAt = (summaryJson as { generatedAt?: unknown } | null | undefined)?.generatedAt;
  if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
    return {
      path: entry.path,
      claim: entry.claim,
      ok: false,
      reason: "no parseable generatedAt — an undated proof is stale by definition",
    };
  }
  const ageDays = (nowMs - Date.parse(generatedAt)) / 86_400_000;
  const maxAgeDays = entry.maxAgeDays ?? DEFAULT_PROOF_MAX_AGE_DAYS;
  if (ageDays > maxAgeDays) {
    return {
      path: entry.path,
      claim: entry.claim,
      ok: false,
      ageDays: Number(ageDays.toFixed(1)),
      reason: `stale: ${ageDays.toFixed(1)} days old (window ${maxAgeDays}d) — rerun the proof batch or pull the claim`,
    };
  }
  return {
    path: entry.path,
    claim: entry.claim,
    ok: true,
    ageDays: Number(ageDays.toFixed(1)),
    reason: `fresh (${ageDays.toFixed(1)}d of ${maxAgeDays}d window)`,
  };
}

/** Filesystem wrapper for the CLI and tests: missing/unreadable proof files are stale, not errors. */
export function checkMarketedProofs(
  entries: ProofRegistryEntry[] = MARKETED_PROOFS,
  nowMs: number = Date.now(),
): ProofStalenessResult[] {
  return entries.map((entry) => {
    if (!existsSync(entry.path)) {
      return { path: entry.path, claim: entry.claim, ok: false, reason: "proof file missing — the claim has no evidence behind it" };
    }
    try {
      return evaluateProofStaleness(entry, JSON.parse(readFileSync(entry.path, "utf8")), nowMs);
    } catch {
      return { path: entry.path, claim: entry.claim, ok: false, reason: "proof file is not valid JSON" };
    }
  });
}
