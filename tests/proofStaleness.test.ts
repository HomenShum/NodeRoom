/**
 * Proof staleness gate (Harness Hardening #7): a committed champion summary is evidence about the
 * route AS OF generatedAt. The last scenario here runs against the REAL registry on the REAL
 * clock — when it goes red ~30 days after the last verification, that is the gate firing as
 * designed, not a flake: rerun the proof batch (see docs/eval/FINANCE_MODEL_EVAL.md Commands) or
 * pull the claim from the marketing surfaces.
 */
import { describe, expect, it } from "vitest";
import {
  checkMarketedProofs,
  evaluateProofStaleness,
  DEFAULT_PROOF_MAX_AGE_DAYS,
  HISTORICAL_PROOFS,
  MARKETED_PROOFS,
} from "../evals/proofStaleness";

const DAY = 86_400_000;
const ENTRY = { path: "docs/eval/example.json", claim: "example claim" };

describe("proof staleness gate — proofs decay, claims follow", () => {
  it("accepts a fresh proof and reports its age", () => {
    const now = Date.parse("2026-06-11T00:00:00Z");
    const result = evaluateProofStaleness(ENTRY, { generatedAt: new Date(now - 5 * DAY).toISOString() }, now);
    expect(result.ok).toBe(true);
    expect(result.ageDays).toBeCloseTo(5, 0);
  });

  it("flags a proof one day past the window — and honors per-entry overrides", () => {
    const now = Date.parse("2026-06-11T00:00:00Z");
    const past = evaluateProofStaleness(
      ENTRY,
      { generatedAt: new Date(now - (DEFAULT_PROOF_MAX_AGE_DAYS + 1) * DAY).toISOString() },
      now,
    );
    expect(past.ok).toBe(false);
    expect(past.reason).toMatch(/stale/);

    const custom = evaluateProofStaleness(
      { ...ENTRY, maxAgeDays: 90 },
      { generatedAt: new Date(now - 45 * DAY).toISOString() },
      now,
    );
    expect(custom.ok).toBe(true);
  });

  it("treats undated or unparseable proofs as stale by definition", () => {
    const now = Date.parse("2026-06-11T00:00:00Z");
    expect(evaluateProofStaleness(ENTRY, {}, now).ok).toBe(false);
    expect(evaluateProofStaleness(ENTRY, { generatedAt: "not-a-date" }, now).ok).toBe(false);
    expect(evaluateProofStaleness(ENTRY, null, now).ok).toBe(false);
  });

  it("keeps every marketed proof on disk fresh RIGHT NOW (red here = re-verify or pull the claim)", () => {
    for (const result of checkMarketedProofs()) {
      expect(result.ok, `${result.path}: ${result.reason}`).toBe(true);
    }
    expect(HISTORICAL_PROOFS).toContainEqual(expect.objectContaining({
      path: "docs/eval/finance-model-live.json",
      status: "historical_not_marketed",
    }));
    expect(MARKETED_PROOFS.some((entry) => entry.path === "docs/eval/finance-model-live.json")).toBe(false);
  });
});
