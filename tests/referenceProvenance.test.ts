import { describe, expect, it } from "vitest";
import {
  loadReferenceProvenanceDocuments,
  validateReferenceProvenanceDocuments,
} from "../scripts/reference-provenance";

describe("Investigation Mode reference provenance", () => {
  it("resolves every observation, fact, rule, score receipt, and screenshot digest", () => {
    const result = validateReferenceProvenanceDocuments(
      loadReferenceProvenanceDocuments(),
    );

    expect(result).toMatchObject({
      ok: true,
      findings: [],
      summary: {
        observations: 6,
        rules: 7,
        scoreReceipts: 1,
        citedFacts: 14,
        durableScreenshotVerified: true,
      },
    });
    expect(result.summary.facts).toBeGreaterThanOrEqual(30);
  });

  it("fails closed when a render receipt names an observation that is absent", () => {
    const documents = structuredClone(loadReferenceProvenanceDocuments());
    documents.renderReceipt.referenceProvenance.observationFacts[0].observationId =
      "obs-missing-run-details-1";

    const result = validateReferenceProvenanceDocuments(documents);

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual({
      code: "missing-observation",
      ref: "render:render-investigation-mode-2026-07-28",
      message: "obs-missing-run-details-1",
    });
  });

  it("fails closed when the render receipt names a score receipt that is absent", () => {
    const documents = structuredClone(loadReferenceProvenanceDocuments());
    documents.renderReceipt.referenceProvenance.scoreReceipt.id =
      "score-investigation-mode-missing";

    const result = validateReferenceProvenanceDocuments(documents);

    expect(result.ok).toBe(false);
    expect(result.findings).toContainEqual({
      code: "missing-score-receipt",
      ref: "render:render-investigation-mode-2026-07-28",
      message: "score-investigation-mode-missing",
    });
  });

  it("fails closed when a score cites a fact that the observation never recorded", () => {
    const documents = structuredClone(loadReferenceProvenanceDocuments());
    documents.scoreReceipts[0].criteria[0].citations[0] =
      "obs-stackai-run-details-1/f99";
    documents.scoreReceipts[0].citedFacts[8] =
      "obs-stackai-run-details-1/f99";

    const result = validateReferenceProvenanceDocuments(documents);

    expect(result.ok).toBe(false);
    expect(result.findings.some((finding) =>
      finding.code === "missing-fact" &&
      finding.message === "obs-stackai-run-details-1/f99"
    )).toBe(true);
  });
});
