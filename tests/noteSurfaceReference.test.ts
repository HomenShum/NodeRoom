import { describe, expect, it } from "vitest";
import {
  MAX_NOTE_SURFACE_REFERENCE_BYTES,
  NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA,
  canonicalJson,
  deriveNoteCaptureState,
  evaluateNoteSurfaceReferenceConsumption,
  reconcileReferenceProjection,
  referenceDigest,
  safelyEvaluateNoteSurfaceReferenceConsumption,
  verifyNoteSurfaceReferenceConsumptionBindings,
  verifyNoteSurfaceReferenceConsumptionDigest,
  type NoteSurfaceReferenceConsumption,
  type ReferenceChainEdge,
} from "../src/engine/noteSurfaceReference";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const COMMIT = "c".repeat(40);
const NOW = "2026-07-30T05:00:00.000Z";

async function fixture(roomId = "room-1", artifactId = "note-1"): Promise<NoteSurfaceReferenceConsumption> {
  const observationBody = {
    schemaVersion: "nodekit.reference-loop-observation/v1" as const,
    source: {
      origin: "mobbin" as const,
      sourceUrl: "https://mobbin.com/screens/f45a639a-28e6-4a02-82a4-ccbe15e5bc13",
      sourcePolicyId: "atlas:mobbin/v1",
      firstSeenAt: NOW,
      lastVerifiedAt: NOW,
      accessMode: "remote-mcp" as const,
    },
    problemTags: ["fast note capture"],
    intentTags: ["preserve thought before classification"],
    layoutTags: ["continuous note stream"],
    interactionTags: ["inline capture"],
    facts: [{
      factId: "fact:single-column",
      kind: "relationship" as const,
      subject: "note content",
      relation: "occupies",
      object: "one centered content column",
      unit: "layout",
      locatorDescription: "Primary note screen content region",
    }],
    prohibitedMaterial: {
      storedPixels: false as const,
      cachedSourcePayload: false as const,
      embeddingStored: false as const,
    },
  };
  const observationDigest = await referenceDigest(observationBody);
  const observation = {
    ...observationBody,
    observationId: `observation_${observationDigest.slice(0, 24)}`,
    contentDigest: observationDigest,
  };
  const ruleBody = {
    schemaVersion: "nodekit.reference-loop-design-rule/v1" as const,
    sourceObservationRefs: [{
      observationId: observation.observationId,
      observationDigest: observation.contentDigest,
      factIds: ["fact:single-column"],
    }],
    statement: "Keep capture in one continuous note stream.",
    problemTags: ["fast note capture"],
    intentTags: ["preserve thought before classification"],
    layoutTags: ["continuous note stream"],
    interactionTags: ["inline capture"],
    mechanismHypothesis: "An always-present inline entry removes navigation cost before classification.",
    appliesWhen: ["The user is capturing unstructured evidence into a note stream."],
    doesNotApplyWhen: ["A protected proposal or provenance review is open."],
    confidence: {
      observation: "high" as const,
      audienceFit: "medium" as const,
      causal: "low" as const,
    },
    requiredEvidence: ["computed-style:stream-divider"],
  };
  const ruleDigest = await referenceDigest(ruleBody);
  const rule = {
    ...ruleBody,
    ruleId: `rule_${ruleDigest.slice(0, 24)}`,
    contentDigest: ruleDigest,
  };
  const scoreBody = {
    schemaVersion: "nodekit.reference-score-receipt/v1" as const,
    profile: "noderoom-note-surface",
    profileManifest: {
      path: "reference/profiles/noderoom-note-surface.json",
      digest: HASH_A,
    },
    trustPolicy: {
      path: "reference/trust-policy.json" as const,
      digest: HASH_B,
    },
    candidate: {
      candidateId: "candidate:note-surface",
      renderReceiptId: "render:note-surface",
      renderReceiptDigest: HASH_A,
      candidateReceiptDigest: HASH_B,
      candidateCommit: COMMIT,
    },
    rules: [{
      ruleId: rule.ruleId,
      ruleDigest: rule.contentDigest,
      result: "satisfied" as const,
      factIds: ["fact:single-column"],
      evidenceRefs: ["computed-style:stream-divider"],
    }],
    coverage: {
      requiredRuleCount: 1,
      evaluatedRuleCount: 1,
      satisfiedRuleCount: 1,
      violatedRuleCount: 0,
      notObservedCount: 0,
      notApplicableCount: 0,
    },
    verdict: "pass" as const,
  };
  const scoreDigest = await referenceDigest(scoreBody);
  const scoreReceipt = {
    ...scoreBody,
    receiptId: `score_${scoreDigest.slice(0, 24)}`,
    contentDigest: scoreDigest,
  };
  const factsDigest = await referenceDigest(observation.facts);
  const externalRunSubject = {
    schemaVersion: "nodekit.external-reference-run/v1" as const,
    provider: "mobbin" as const,
    operation: "authenticated-live-inspection" as const,
    policyId: "nodekit.mobbin-remote-mcp/v1" as const,
    status: "pass" as const,
    checkedAt: NOW,
    expiresAt: "2026-08-30T05:00:00.000Z",
    sourceUrl: observation.source.sourceUrl,
    remoteObjectId: "f45a639a-28e6-4a02-82a4-ccbe15e5bc13",
    runNonce: "nonce-note-surface-20260730",
    producer: {
      tool: "mobbin/search_flows" as const,
      version: "2026-07-30",
    },
    observationId: observation.observationId,
    observationDigest: observation.contentDigest,
    factsDigest,
    prohibitedMaterial: {
      storedPixels: false as const,
      cachedSourcePayload: false as const,
      embeddingStored: false as const,
      ragIndexed: false as const,
      trainingUsed: false as const,
    },
  };
  const externalSubjectDigest = await referenceDigest(externalRunSubject);
  const externalRunBody = {
    ...externalRunSubject,
    runId: `external_run_${externalSubjectDigest.slice(0, 24)}`,
    subjectDigest: externalSubjectDigest,
    attestation: {
      schemaVersion: "nodekit.reference-service-attestation/v1" as const,
      purpose: "mobbin-external-reference-run" as const,
      keyId: "mobbin-remote-mcp:test-key",
      subjectDigest: externalSubjectDigest,
      signedAt: NOW,
      algorithm: "Ed25519" as const,
      signatureEncoding: "base64url" as const,
      signature: "test_signature_not_authority_000000000000",
    },
  };
  const externalRun = {
    ...externalRunBody,
    contentDigest: await referenceDigest(externalRunBody),
  };
  const edgeBody = {
    schemaVersion: "nodekit.reference-chain-edge/v1" as const,
    from: {
      schemaVersion: observation.schemaVersion,
      idField: "observationId" as const,
      recordId: observation.observationId,
      contentDigest: observation.contentDigest,
    },
    to: {
      schemaVersion: rule.schemaVersion,
      idField: "ruleId" as const,
      recordId: rule.ruleId,
      contentDigest: rule.contentDigest,
    },
    caseBinding: { caseId: "case:note-surface", stageId: "build", caseContentHash: HASH_A },
    repositoryBinding: { remote: "https://github.com/HomenShum/NodeRoom", commitSha: COMMIT, treeHash: HASH_B },
    authority: {
      kind: "deterministic" as const,
      receiptRefs: [{
        schemaVersion: scoreReceipt.schemaVersion,
        idField: "receiptId" as const,
        recordId: scoreReceipt.receiptId,
        contentDigest: scoreReceipt.contentDigest,
      }],
    },
    createdAt: NOW,
    limitations: ["The edge binds evidence and does not issue a verdict."],
  };
  const edgeDigest = await referenceDigest(edgeBody);
  const edge: ReferenceChainEdge = {
    ...edgeBody,
    edgeId: `reference_chain_edge_${edgeDigest.slice(0, 24)}`,
    contentDigest: edgeDigest,
  };
  const body = {
    schemaVersion: NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA,
    roomId,
    artifactId,
    externalRun,
    observation,
    rule,
    scoreReceipt,
    edge,
    candidate: { commitSha: COMMIT, renderCommitShas: [COMMIT, COMMIT] },
    review: { mode: "fresh-context" as const, claimedIndependent: false },
    surface: { requiresTrustTreatment: true, classification: "trust-surface" as const },
    computedStyleEvidenceRefs: ["computed-style:stream-divider"],
    createdAt: NOW,
  };
  const contentDigest = await referenceDigest(body);
  return {
    ...body,
    consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
    contentDigest,
  };
}

function clone(record: NoteSurfaceReferenceConsumption): NoteSurfaceReferenceConsumption {
  return structuredClone(record);
}

async function reseal(record: NoteSurfaceReferenceConsumption): Promise<NoteSurfaceReferenceConsumption> {
  const { consumptionId: _consumptionId, contentDigest: _contentDigest, ...body } = record;
  const contentDigest = await referenceDigest(body);
  return {
    ...body,
    consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
    contentDigest,
  };
}

describe("NodeRoom note-surface reference consumption", () => {
  it("accepts one exact, immutable, authority-bound consumption record", async () => {
    const record = await fixture();
    expect(evaluateNoteSurfaceReferenceConsumption(record)).toEqual({
      accepted: true,
      findings: [],
      projection: "bound",
    });
    expect(await verifyNoteSurfaceReferenceConsumptionDigest(record)).toBe(true);
    expect(canonicalJson({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
  });

  it("fails malformed and oversized agent payloads as bounded data", async () => {
    expect(safelyEvaluateNoteSurfaceReferenceConsumption({ schemaVersion: "wrong" })).toEqual({
      accepted: false,
      findings: ["malformed-reference-consumption"],
      projection: "failed",
    });
    const record = clone(await fixture());
    record.observation.facts = Array.from({ length: 257 }, (_, index) => ({
      ...record.observation.facts[0]!,
      factId: `fact:${index}`,
    }));
    expect(safelyEvaluateNoteSurfaceReferenceConsumption(record).findings).toContain("too-many-facts");
  });

  it.each([
    ["external run NOT_RUN", (record: NoteSurfaceReferenceConsumption) => { Object.assign(record.externalRun, { status: "not-run" }); }, "external-run-not-pass"],
    ["cached Mobbin screenshot path", (record: NoteSurfaceReferenceConsumption) => { Object.assign(record, { cachedScreenshotPath: "mobbin.png" }); }, "prohibited-cache:cachedScreenshotPath"],
    ["missing mobbin_url", (record: NoteSurfaceReferenceConsumption) => { record.externalRun.sourceUrl = ""; }, "missing-mobbin-url"],
    ["changed atomic fact", (record: NoteSurfaceReferenceConsumption) => { record.observation.facts[0]!.factId = "fact:changed"; }, "atomic-fact-drift"],
    ["missing lastVerifiedAt", (record: NoteSurfaceReferenceConsumption) => { record.observation.source.lastVerifiedAt = ""; }, "missing-last-verified-at"],
    ["wrong observation digest", (record: NoteSurfaceReferenceConsumption) => { record.rule.sourceObservationRefs[0]!.observationDigest = HASH_B; }, "observation-digest-drift"],
    ["changed rule digest after consumption", (record: NoteSurfaceReferenceConsumption) => { record.rule.contentDigest = HASH_A; }, "rule-digest-drift"],
    ["N/A without reason", (record: NoteSurfaceReferenceConsumption) => { record.scoreReceipt.rules[0]!.result = "not-applicable"; }, "not-applicable-without-reason"],
    ["trust surface marked non-trust", (record: NoteSurfaceReferenceConsumption) => { record.surface.classification = "non-trust-surface"; }, "trust-surface-misclassified"],
    ["candidate commit changed in one render", (record: NoteSurfaceReferenceConsumption) => { record.candidate.renderCommitShas[1] = "e".repeat(40); }, "candidate-commit-drift"],
    ["missing computed-style evidence", (record: NoteSurfaceReferenceConsumption) => { record.computedStyleEvidenceRefs = []; }, "missing-computed-style-evidence"],
    ["fresh-context reviewer labeled independent", (record: NoteSurfaceReferenceConsumption) => { record.review.claimedIndependent = true; }, "fresh-context-claimed-independent"],
    ["caller verdict on edge", (record: NoteSurfaceReferenceConsumption) => { Object.assign(record.edge, { verdict: "pass" }); }, "caller-authority:edge.verdict"],
    ["caller approval inside edge", (record: NoteSurfaceReferenceConsumption) => { Object.assign(record.edge.authority, { approved: true }); }, "caller-authority:edge.authority.approved"],
  ])("rejects mutation: %s", async (_label, mutate, finding) => {
    const record = clone(await fixture());
    mutate(record);
    const result = evaluateNoteSurfaceReferenceConsumption(record);
    expect(result.accepted).toBe(false);
    expect(result.projection).toBe("failed");
    expect(result.findings).toContain(finding);
    expect(await verifyNoteSurfaceReferenceConsumptionDigest(record)).toBe(false);
  });

  it("rejects a resealed consumption when an atomic observation changes behind its digest", async () => {
    const record = clone(await fixture());
    record.observation.facts[0]!.object = "forged layout claim";
    const resealed = await reseal(record);
    const result = await verifyNoteSurfaceReferenceConsumptionBindings(resealed);
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("observation-content-digest");
  });

  it("rejects a resealed consumption when the score verdict is not derived from rule results", async () => {
    const record = clone(await fixture());
    record.scoreReceipt.verdict = "fail";
    const resealed = await reseal(record);
    const result = await verifyNoteSurfaceReferenceConsumptionBindings(resealed);
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("score-verdict-not-derived");
  });

  it("rejects a resealed consumption when the edge content changes behind its digest", async () => {
    const record = clone(await fixture());
    record.edge.limitations = ["This forged limitation was not part of the bound edge."];
    const resealed = await reseal(record);
    const result = await verifyNoteSurfaceReferenceConsumptionBindings(resealed);
    expect(result.accepted).toBe(false);
    expect(result.findings).toContain("edge-content-digest");
  });

  it("bounds the record by encoded UTF-8 bytes rather than UTF-16 character count", async () => {
    const record = clone(await fixture());
    Object.assign(record, { padding: "😀".repeat(100_000) });
    const resealed = await reseal(record);
    expect(JSON.stringify(resealed).length).toBeLessThan(MAX_NOTE_SURFACE_REFERENCE_BYTES);
    expect(new TextEncoder().encode(JSON.stringify(resealed)).byteLength)
      .toBeGreaterThan(MAX_NOTE_SURFACE_REFERENCE_BYTES);
    expect(evaluateNoteSurfaceReferenceConsumption(resealed).findings).toContain("record-too-large");
  });

  it("disarms capture during provenance proposal review and conflict, then rearms after reload", () => {
    expect(deriveNoteCaptureState({ hasPendingProposal: false, provenanceExpanded: false, hasConflict: false }))
      .toEqual({ state: "armed", reason: "ready" });
    expect(deriveNoteCaptureState({ hasPendingProposal: true, provenanceExpanded: true, hasConflict: false }))
      .toEqual({ state: "disarmed", reason: "reference-review" });
    expect(deriveNoteCaptureState({ hasPendingProposal: true, provenanceExpanded: true, hasConflict: true }))
      .toEqual({ state: "disarmed", reason: "conflict" });
    expect(deriveNoteCaptureState({ hasPendingProposal: false, provenanceExpanded: false, hasConflict: false }))
      .toEqual({ state: "armed", reason: "ready" });
  });

  it("fails a falsely bound inbox projection when its receipt verdict is not derived", async () => {
    const record = clone(await fixture());
    record.scoreReceipt.verdict = "fail";
    const result = reconcileReferenceProjection(record, "bound");
    expect(result).toMatchObject({ projection: "failed", repaired: true });
  });
});
