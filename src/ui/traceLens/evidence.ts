/**
 * Evidence-class taxonomy — the graded honesty layer (Tekton's evidence chain, NodeRoom variant).
 *
 * Derived purely from existing CellPayload fields. NO schema migration. Additive only.
 *
 * - measured       — anchored to an external citable source (kind: "upload"|"source")
 * - reconstructed  — human design judgment (kind: "manual") with evidence attached
 * - rule_derived   — computed from a rule/formula (kind: "computed" or payload.formula)
 * - conjecture     — uncertain: needs_review, low confidence, OR status=gap with no evidence
 * - unsourced      — no payload, no evidence, no status: a hole in the chain
 *
 * Honesty doctrine: "nothing renders without a source." Unsourced cells flunk the gate.
 */

import type { CellPayload } from "../../engine/types";
import type { RefutationVerdict, RefutationOutcome } from "./types";

export type EvidenceClass = "measured" | "reconstructed" | "rule_derived" | "conjecture" | "unsourced";

export const EVIDENCE_CLASSES: readonly EvidenceClass[] = [
  "measured", "reconstructed", "rule_derived", "conjecture", "unsourced",
];

/** Banker-facing label for one class. Plain English, no jargon. */
export function evidenceLabel(c: EvidenceClass): string {
  switch (c) {
    case "measured":      return "Measured (cited source)";
    case "reconstructed": return "Reconstructed (human design)";
    case "rule_derived":  return "Rule-derived (formula/computed)";
    case "conjecture":    return "Conjecture (uncertain)";
    case "unsourced":     return "Unsourced (no provenance)";
  }
}

/** Confidence threshold below which a "complete" cell with low confidence becomes conjecture. */
const CONJECTURE_CONFIDENCE = 0.35;

/** Derive the evidence class from a CellPayload (or null/undefined). */
export function classifyEvidence(payload: CellPayload | null | undefined): EvidenceClass {
  if (!payload) return "unsourced";
  const status = payload.status;
  const evidence = payload.evidence ?? [];
  const conf = payload.confidence;
  const hasEv = evidence.length > 0;

  // Explicit gaps + failures are conjecture, not unsourced — the agent marked them.
  if (status === "gap" || status === "failed") return "conjecture";
  if (status === "needs_review") return "conjecture";
  if (typeof conf === "number" && conf < CONJECTURE_CONFIDENCE && hasEv) return "conjecture";

  // Formula or "computed" kind → rule-derived.
  if (payload.formula) return "rule_derived";
  if (hasEv && evidence.every((e) => e.kind === "computed")) return "rule_derived";

  // External citable sources → measured.
  if (hasEv && evidence.some((e) => e.kind === "upload" || e.kind === "source")) return "measured";

  // Manual entry with evidence → human design judgment.
  if (hasEv && evidence.every((e) => e.kind === "manual")) return "reconstructed";

  // Complete but no evidence whatsoever → unsourced. This is the honesty gate.
  return "unsourced";
}

export interface EvidenceCoverage {
  total: number;
  classes: Record<EvidenceClass, number>;
  /** opaque cell keys (data-cell-key) of cells classified as `unsourced`. */
  unsourced: string[];
  /** ratio of sourced cells (anything not "unsourced") over total. NaN if total === 0. */
  sourcedRatio: number;
}

/**
 * Audit every cell with `[data-evidence-class]` inside `root` (defaults to document).
 * Used by the Trace tab toolbar + the honesty gate test.
 */
export function auditEvidenceCoverage(root: ParentNode | null = typeof document !== "undefined" ? document : null): EvidenceCoverage {
  const classes: Record<EvidenceClass, number> = {
    measured: 0, reconstructed: 0, rule_derived: 0, conjecture: 0, unsourced: 0,
  };
  const unsourced: string[] = [];
  if (!root) return { total: 0, classes, unsourced, sourcedRatio: NaN };
  const cells = root.querySelectorAll<HTMLElement>("[data-evidence-class]");
  cells.forEach((el) => {
    const c = (el.getAttribute("data-evidence-class") || "unsourced") as EvidenceClass;
    if (c in classes) classes[c]++;
    if (c === "unsourced") {
      const key = el.getAttribute("data-cell-key") || el.getAttribute("data-element-id") || "";
      if (key) unsourced.push(key);
    }
  });
  const total = cells.length;
  const sourced = total - classes.unsourced;
  return { total, classes, unsourced, sourcedRatio: total === 0 ? NaN : sourced / total };
}

/** Zero-unsourced gate: pass iff every cell with provenance metadata has a class != "unsourced". */
export function passesHonestyGate(coverage: EvidenceCoverage): boolean {
  return coverage.total > 0 && coverage.classes.unsourced === 0;
}

/* ────────── Adversarial-refutation helpers (Tekton verdict pattern) ────────── */

export const REFUTATION_OUTCOMES: readonly RefutationOutcome[] = ["stands", "refuted", "uncertain"];

/** Banker-facing label for a verdict outcome. */
export function refutationLabel(o: RefutationOutcome): string {
  switch (o) {
    case "stands":    return "Stands";
    case "refuted":   return "Refuted";
    case "uncertain": return "Uncertain";
  }
}

export interface RefutationSummary {
  total: number;
  byOutcome: Record<RefutationOutcome, number>;
  /** Average verifier confidence across all verdicts (NaN when empty). */
  avgConfidence: number;
}

/** Roll up a list of verdicts for the trace toolbar / record header. */
export function summarizeRefutations(verdicts: readonly RefutationVerdict[] | undefined): RefutationSummary {
  const byOutcome: Record<RefutationOutcome, number> = { stands: 0, refuted: 0, uncertain: 0 };
  if (!verdicts || verdicts.length === 0) {
    return { total: 0, byOutcome, avgConfidence: NaN };
  }
  let confSum = 0;
  for (const v of verdicts) {
    if (v.verdict in byOutcome) byOutcome[v.verdict]++;
    confSum += Number.isFinite(v.confidence) ? Math.max(0, Math.min(1, v.confidence)) : 0;
  }
  return { total: verdicts.length, byOutcome, avgConfidence: confSum / verdicts.length };
}
