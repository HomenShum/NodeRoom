import { describe, expect, it } from "vitest";
import {
  NOTE_SURFACE_REFERENCE_CONSUMPTION_V1_SCHEMA,
  adaptNoteSurfaceReferenceConsumptionV1,
  canonicalJson,
  deriveNoteCaptureState,
  evaluateNoteSurfaceReferenceConsumption,
  noteSurfaceReferenceView,
  reconcileReferenceProjection,
  referenceDigest,
  safelyEvaluateNoteSurfaceReferenceConsumption,
  verifyNoteSurfaceReferenceConsumptionBindings,
  verifyNoteSurfaceReferenceConsumptionDigest,
  type NoteSurfaceReferenceConsumptionV1,
  type NoteSurfaceReferenceConsumptionV2,
  type NoteSurfaceV1AdapterBindings,
} from "../src/engine/noteSurfaceReference";
import {
  buildNoteSurfaceReferenceFixture,
  resealNoteSurfaceReferenceFixture,
} from "./fixtures/noteSurfaceReferenceFixture";

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function v1Fixture(
  suppliedV2?: NoteSurfaceReferenceConsumptionV2,
): Promise<NoteSurfaceReferenceConsumptionV1> {
  const v2 = suppliedV2 ?? await buildNoteSurfaceReferenceFixture();
  const view = noteSurfaceReferenceView(v2);
  const body = {
    schemaVersion: NOTE_SURFACE_REFERENCE_CONSUMPTION_V1_SCHEMA,
    roomId: view.roomId,
    artifactId: view.artifactId,
    externalRun: clone(view.externalRun),
    observation: clone(view.observations[0]!),
    rule: clone(view.rules[0]!),
    scoreReceipt: clone(view.scoreReceipt),
    edge: clone(view.edges[0]!),
    candidate: {
      commitSha: view.candidateCommit,
      renderCommitShas: [view.candidateCommit],
    },
    review: { mode: "fresh-context" as const, claimedIndependent: false },
    surface: { requiresTrustTreatment: true, classification: "trust-surface" as const },
    computedStyleEvidenceRefs: ["computed-style:stream-divider"],
    createdAt: "2026-07-30T05:00:00.000Z",
  };
  const contentDigest = await referenceDigest(body);
  return {
    ...body,
    consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
    contentDigest,
  };
}

function adapterBindings(v2: NoteSurfaceReferenceConsumptionV2): NoteSurfaceV1AdapterBindings {
  return {
    caseBinding: clone(v2.caseBinding),
    repositoryBinding: clone(v2.repositoryBinding),
    artifactBinding: clone(v2.artifactBinding),
    candidateBinding: clone(v2.candidateBinding),
    surface: clone(v2.surface),
    capturePolicy: clone(v2.capturePolicy),
    proofProfile: clone(v2.proofProfile),
    reviewBinding: clone(v2.reviewBinding),
  };
}

describe("NodeRoom note-surface reference consumption V2", () => {
  it("accepts an exact V2 envelope but remains incomplete without external NodeProof", async () => {
    const record = await buildNoteSurfaceReferenceFixture();
    expect(evaluateNoteSurfaceReferenceConsumption(record)).toEqual({
      accepted: true,
      findings: [],
      projection: "incomplete",
    });
    expect(await verifyNoteSurfaceReferenceConsumptionDigest(record)).toBe(true);
  });

  it("serializes one V2 envelope identically across 100 runs", async () => {
    const record = await buildNoteSurfaceReferenceFixture();
    const serializations = Array.from({ length: 100 }, () => canonicalJson(clone(record)));
    expect(new Set(serializations).size).toBe(1);
  });

  it("normalizes V1 deterministically only when canonical missing bindings are supplied", async () => {
    const v2 = await buildNoteSurfaceReferenceFixture();
    const v1 = await v1Fixture(v2);
    const bindings = adapterBindings(v2);
    const normalized = await Promise.all(
      Array.from({ length: 100 }, () => adaptNoteSurfaceReferenceConsumptionV1(v1, bindings)),
    );
    expect(new Set(normalized.map(canonicalJson)).size).toBe(1);
    expect(normalized[0]).toEqual(v2);
  });

  it("rejects case and stage binding drift", async () => {
    const record = clone(await buildNoteSurfaceReferenceFixture());
    record.caseBinding.stageId = "prove";
    const resealed = await resealNoteSurfaceReferenceFixture(record);
    const result = evaluateNoteSurfaceReferenceConsumption(resealed);
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("edge-case-binding-drift");
  });

  it("rejects repository remote, commit, or tree drift", async () => {
    const record = clone(await buildNoteSurfaceReferenceFixture());
    record.repositoryBinding.treeHash = "d".repeat(64);
    const resealed = await resealNoteSurfaceReferenceFixture(record);
    const result = evaluateNoteSurfaceReferenceConsumption(resealed);
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("edge-repository-binding-drift");
  });

  it("rejects proof-profile digest drift", async () => {
    const record = clone(await buildNoteSurfaceReferenceFixture());
    record.proofProfile.profileDigest = "d".repeat(64);
    const resealed = await resealNoteSurfaceReferenceFixture(record);
    expect(evaluateNoteSurfaceReferenceConsumption(resealed).findings)
      .toContain("proof-profile-drift");
  });

  it("does not let an envelope override a mutated embedded rule", async () => {
    const record = clone(await buildNoteSurfaceReferenceFixture());
    record.snapshots.rules[0]!.statement = "Forged rule";
    const resealed = await resealNoteSurfaceReferenceFixture(record);
    const result = await verifyNoteSurfaceReferenceConsumptionBindings(resealed);
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("rule-content-digest");
  });

  it("does not leave the feed verified after a mutated score", async () => {
    const record = clone(await buildNoteSurfaceReferenceFixture());
    record.snapshots.scoreReceipt.verdict = "fail";
    const resealed = await resealNoteSurfaceReferenceFixture(record);
    const result = await verifyNoteSurfaceReferenceConsumptionBindings(resealed);
    expect(result.projection).toBe("failed");
    expect(result.findings).toContain("score-verdict-not-derived");
  });

  it("invalidates the candidate when a render receipt changes", async () => {
    const record = clone(await buildNoteSurfaceReferenceFixture());
    record.candidateBinding.renderReceipts[0]!.receiptDigest = "d".repeat(64);
    const resealed = await resealNoteSurfaceReferenceFixture(record);
    expect(evaluateNoteSurfaceReferenceConsumption(resealed).findings)
      .toContain("render-receipt-drift");
  });

  it("keeps populated note context armed with the exact reason code", () => {
    expect(deriveNoteCaptureState({
      hasPendingProposal: false,
      provenanceExpanded: false,
      hasConflict: false,
    })).toEqual({ state: "armed", reason: "NORMAL_NOTE_CONTEXT" });
  });

  it("keeps empty first capture armed with the exact reason code", () => {
    expect(deriveNoteCaptureState({
      hasPendingProposal: false,
      provenanceExpanded: false,
      hasConflict: false,
    })).toEqual({ state: "armed", reason: "NORMAL_NOTE_CONTEXT" });
  });

  it("disarms a pending proposal even when provenance is collapsed", () => {
    expect(deriveNoteCaptureState({
      hasPendingProposal: true,
      provenanceExpanded: false,
      hasConflict: false,
    })).toEqual({ state: "disarmed", reason: "PROPOSAL_REVIEW_ACTIVE" });
  });

  it("disarms a conflict with the exact reason code", () => {
    expect(deriveNoteCaptureState({
      hasPendingProposal: true,
      provenanceExpanded: true,
      hasConflict: true,
    })).toEqual({ state: "disarmed", reason: "CONFLICT_REVIEW_ACTIVE" });
  });

  it("does not represent a fresh-context V1 review as independent", async () => {
    const record = await v1Fixture();
    record.review.claimedIndependent = true;
    const { consumptionId: _id, contentDigest: _digest, ...body } = record;
    const contentDigest = await referenceDigest(body);
    const resealed: NoteSurfaceReferenceConsumptionV1 = {
      ...body,
      consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
      contentDigest,
    };
    expect(evaluateNoteSurfaceReferenceConsumption(resealed).findings)
      .toContain("fresh-context-claimed-independent");
  });

  it("repairs any caller claim of bound or verified to Incomplete without NodeProof", async () => {
    const record = await buildNoteSurfaceReferenceFixture();
    expect(reconcileReferenceProjection(record, "bound")).toMatchObject({
      projection: "incomplete",
      repaired: true,
    });
    expect(reconcileReferenceProjection(record, "verified")).toMatchObject({
      projection: "incomplete",
      repaired: true,
    });
  });

  it("fails all 20 adversarial attempts to add a second semantic truth", async () => {
    const semanticAliases = [
      "ruleStatement", "applicability", "edgeKind", "verdict", "approved",
      "verified", "requiredEvidence", "observationFact", "candidateStatus", "reviewStatus",
      "caseStatus", "repositoryStatus", "artifactStatus", "surfaceStatus", "proofStatus",
      "captureStatus", "scoreStatus", "runtimeEvidence", "authorityStatus", "shipmentStatus",
    ];
    for (const alias of semanticAliases) {
      const record = clone(await buildNoteSurfaceReferenceFixture()) as NoteSurfaceReferenceConsumptionV2 & Record<string, unknown>;
      record[alias] = alias === "approved" || alias === "verified" ? true : "forged";
      const resealed = await resealNoteSurfaceReferenceFixture(record);
      const result = evaluateNoteSurfaceReferenceConsumption(resealed);
      expect(result.accepted, alias).toBe(false);
      expect(result.findings, alias).toContain(`unknown-key:record.${alias}`);
    }
  });

  it("fails malformed payloads as bounded data", () => {
    expect(safelyEvaluateNoteSurfaceReferenceConsumption({ schemaVersion: "wrong" })).toEqual({
      accepted: false,
      findings: ["malformed-reference-consumption"],
      projection: "failed",
    });
  });
});
