/**
 * Honesty-layer (graded evidence chain) unit tests.
 * `.tsx` extension → vitest auto-loads jsdom (see vitest.config.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { classifyEvidence, auditEvidenceCoverage, passesHonestyGate, evidenceLabel, EVIDENCE_CLASSES, summarizeRefutations, refutationLabel, REFUTATION_OUTCOMES } from "../src/ui/traceLens/evidence";
import type { CellPayload, CellEvidence } from "../src/engine/types";
import type { RefutationVerdict, RefutationOutcome } from "../src/ui/traceLens/types";

const ev = (kind: CellEvidence["kind"], label = kind): CellEvidence => ({ id: `e-${label}`, kind, label });

describe("classifyEvidence — derivation taxonomy", () => {
  it("returns 'unsourced' for null/undefined payloads", () => {
    expect(classifyEvidence(null)).toBe("unsourced");
    expect(classifyEvidence(undefined)).toBe("unsourced");
  });

  it("returns 'unsourced' for a payload with no evidence and no formula", () => {
    const p: CellPayload = { value: "42", status: "complete" };
    expect(classifyEvidence(p)).toBe("unsourced");
  });

  it("returns 'measured' for external sources (upload/source kinds)", () => {
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("upload")] })).toBe("measured");
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("source")] })).toBe("measured");
    // Mixed: as long as ONE is external-citable, it counts as measured.
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("manual"), ev("source")] })).toBe("measured");
  });

  it("returns 'rule_derived' when payload has a formula", () => {
    expect(classifyEvidence({ value: 100, status: "complete", formula: "=A1+B1" })).toBe("rule_derived");
  });

  it("returns 'rule_derived' when every evidence is computed", () => {
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("computed"), ev("computed")] })).toBe("rule_derived");
  });

  it("returns 'reconstructed' for manual-only evidence", () => {
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("manual")] })).toBe("reconstructed");
  });

  it("returns 'conjecture' for gap/failed/needs_review status", () => {
    expect(classifyEvidence({ value: null, status: "gap" })).toBe("conjecture");
    expect(classifyEvidence({ value: null, status: "failed" })).toBe("conjecture");
    expect(classifyEvidence({ value: 1, status: "needs_review", evidence: [ev("source")] })).toBe("conjecture");
  });

  it("returns 'conjecture' when confidence is below threshold with evidence", () => {
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("source")], confidence: 0.2 })).toBe("conjecture");
    // High confidence does NOT downgrade.
    expect(classifyEvidence({ value: 1, status: "complete", evidence: [ev("source")], confidence: 0.9 })).toBe("measured");
  });

  it("evidenceLabel returns a non-empty plain-English label for every class", () => {
    for (const c of EVIDENCE_CLASSES) {
      const label = evidenceLabel(c);
      expect(label).toBeTruthy();
      expect(label.length).toBeGreaterThan(3);
    }
  });
});

describe("auditEvidenceCoverage — DOM scan + zero-unsourced gate", () => {
  beforeEach(() => { document.body.innerHTML = ""; });
  afterEach(() => { document.body.innerHTML = ""; });

  it("returns total=0 and NaN ratio when no classified cells exist", () => {
    const cov = auditEvidenceCoverage(document);
    expect(cov.total).toBe(0);
    expect(Number.isNaN(cov.sourcedRatio)).toBe(true);
    expect(passesHonestyGate(cov)).toBe(false); // empty != pass
  });

  it("tallies cells by data-evidence-class and reports unsourced keys", () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr><td data-evidence-class="measured"      data-cell-key="r1__a">$1M</td></tr>
          <tr><td data-evidence-class="measured"      data-cell-key="r1__b">$2M</td></tr>
          <tr><td data-evidence-class="reconstructed" data-cell-key="r1__c">est</td></tr>
          <tr><td data-evidence-class="rule_derived"  data-cell-key="r1__d">=A+B</td></tr>
          <tr><td data-evidence-class="conjecture"    data-cell-key="r1__e">?</td></tr>
          <tr><td data-evidence-class="unsourced"     data-cell-key="r1__f">???</td></tr>
          <tr><td data-evidence-class="unsourced"     data-cell-key="r1__g"></td></tr>
        </tbody>
      </table>
    `;
    const cov = auditEvidenceCoverage(document);
    expect(cov.total).toBe(7);
    expect(cov.classes.measured).toBe(2);
    expect(cov.classes.reconstructed).toBe(1);
    expect(cov.classes.rule_derived).toBe(1);
    expect(cov.classes.conjecture).toBe(1);
    expect(cov.classes.unsourced).toBe(2);
    expect(cov.unsourced.sort()).toEqual(["r1__f", "r1__g"]);
    expect(cov.sourcedRatio).toBeCloseTo(5 / 7);
    // Gate trips because we have ANY unsourced cells — Tekton's "nothing renders without a source."
    expect(passesHonestyGate(cov)).toBe(false);
  });

  it("zero-unsourced gate PASSES when every classified cell is sourced", () => {
    document.body.innerHTML = `
      <table><tbody><tr>
        <td data-evidence-class="measured"      data-cell-key="a">1</td>
        <td data-evidence-class="rule_derived"  data-cell-key="b">2</td>
        <td data-evidence-class="reconstructed" data-cell-key="c">3</td>
      </tr></tbody></table>
    `;
    const cov = auditEvidenceCoverage(document);
    expect(cov.classes.unsourced).toBe(0);
    expect(passesHonestyGate(cov)).toBe(true);
    expect(cov.sourcedRatio).toBe(1);
  });

  it("scopes the audit to a sub-tree when given a root element", () => {
    document.body.innerHTML = `
      <div id="in"><table><tbody><tr>
        <td data-evidence-class="measured" data-cell-key="x">in</td>
      </tr></tbody></table></div>
      <div id="out"><table><tbody><tr>
        <td data-evidence-class="unsourced" data-cell-key="y">out</td>
      </tr></tbody></table></div>
    `;
    const inRoot = document.getElementById("in")!;
    const cov = auditEvidenceCoverage(inRoot);
    expect(cov.total).toBe(1);
    expect(cov.classes.measured).toBe(1);
    expect(cov.classes.unsourced).toBe(0);
    expect(passesHonestyGate(cov)).toBe(true);
  });

  it("falls back to data-element-id when data-cell-key is absent for unsourced cells", () => {
    document.body.innerHTML = `<table><tbody><tr><td data-evidence-class="unsourced" data-element-id="r__c">x</td></tr></tbody></table>`;
    const cov = auditEvidenceCoverage(document);
    expect(cov.unsourced).toEqual(["r__c"]);
  });
});

describe("summarizeRefutations — Tekton verdict roll-up", () => {
  const verdict = (o: RefutationOutcome, claimId: string, confidence: number, correctedValue?: string): RefutationVerdict => ({
    claimId, claim: `claim-${claimId}`, verdict: o, confidence, correctedValue,
    reasoning: `because ${claimId}`, refutedBy: "test verifier",
  });

  it("returns total=0 and NaN avgConfidence when undefined or empty", () => {
    expect(summarizeRefutations(undefined)).toMatchObject({ total: 0, byOutcome: { stands: 0, refuted: 0, uncertain: 0 } });
    expect(Number.isNaN(summarizeRefutations(undefined).avgConfidence)).toBe(true);
    expect(Number.isNaN(summarizeRefutations([]).avgConfidence)).toBe(true);
  });

  it("counts each outcome and averages confidence", () => {
    const s = summarizeRefutations([
      verdict("stands", "a", 0.9),
      verdict("stands", "b", 0.8),
      verdict("refuted", "c", 0.92, "corrected"),
      verdict("uncertain", "d", 0.5),
    ]);
    expect(s.total).toBe(4);
    expect(s.byOutcome.stands).toBe(2);
    expect(s.byOutcome.refuted).toBe(1);
    expect(s.byOutcome.uncertain).toBe(1);
    expect(s.avgConfidence).toBeCloseTo((0.9 + 0.8 + 0.92 + 0.5) / 4);
  });

  it("clamps confidence outside [0,1] and tolerates non-finite values", () => {
    const s = summarizeRefutations([
      verdict("stands", "high", 1.5),    // clamped to 1
      verdict("refuted", "neg", -0.3),   // clamped to 0
      verdict("uncertain", "nan", Number.NaN), // treated as 0
    ]);
    expect(s.total).toBe(3);
    expect(s.avgConfidence).toBeCloseTo((1 + 0 + 0) / 3);
  });

  it("refutationLabel + REFUTATION_OUTCOMES cover all three outcomes", () => {
    expect(REFUTATION_OUTCOMES).toEqual(["stands", "refuted", "uncertain"]);
    for (const o of REFUTATION_OUTCOMES) expect(refutationLabel(o).length).toBeGreaterThan(0);
  });

  it("scenario: agent claim is overturned by fresh-context verifier and the corrected value is preserved", () => {
    // The honest-trace doctrine: when refuted, the corrected value rides ON the verdict, NOT a fresh tuple.
    const verdicts: RefutationVerdict[] = [
      verdict("refuted", "tabular-nums-universal", 0.92, "2 of 3 surfaces use tabular-nums; blank-room is n/a"),
    ];
    const refuted = verdicts.find((v) => v.verdict === "refuted");
    expect(refuted?.correctedValue).toMatch(/2 of 3/);
    expect(summarizeRefutations(verdicts).byOutcome.refuted).toBe(1);
    // Critically: the OVERTURNED claim still appears in the ledger (failures are evidence, not blemishes).
    expect(summarizeRefutations(verdicts).total).toBe(1);
  });
});
