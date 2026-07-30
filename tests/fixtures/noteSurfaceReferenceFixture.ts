import {
  NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA,
  referenceDigest,
  type NoteSurfaceReferenceConsumption,
  type NoteSurfaceReferenceConsumptionV2,
  type ReferenceChainEdge,
} from "../../src/engine/noteSurfaceReference";

export const NOTE_REFERENCE_HASH_A = "a".repeat(64);
export const NOTE_REFERENCE_TRUST_POLICY_JSON = JSON.stringify({
  schemaVersion: "nodekit.reference-trust-policy/v1",
  credentials: {
    "mobbin-remote-mcp:test-key": {
      publicKey: "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAmbPp1sZw8E4W5eE8Mdn5JUm4WwJC2eH5U1ds7g2lHyc=\n-----END PUBLIC KEY-----\n",
      algorithm: "Ed25519",
      assurance: "S2",
      purposes: ["mobbin-external-reference-run"],
      producers: ["mobbin/search_flows@2026-07-30"],
    },
  },
});
export const NOTE_REFERENCE_TRUST_POLICY_DIGEST = "0e246045316ac2010582b043c83e8620ffa4e4125386a54e37349cff0e191e91";
export const NOTE_REFERENCE_HASH_B = "b".repeat(64);
const COMMIT = "c".repeat(40);
const NOW = "2026-07-30T05:00:00.000Z";

export async function buildNoteSurfaceReferenceFixture(
  roomId = "room-1",
  artifactId = "note-1",
  ownerId = "user:test-owner",
  casVersion = "1",
): Promise<NoteSurfaceReferenceConsumptionV2> {
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
      digest: NOTE_REFERENCE_HASH_A,
    },
    trustPolicy: {
      path: "reference/trust-policy.json" as const,
      digest: NOTE_REFERENCE_TRUST_POLICY_DIGEST,
    },
    candidate: {
      candidateId: "candidate:note-surface",
      renderReceiptId: "render:note-surface",
      renderReceiptDigest: NOTE_REFERENCE_HASH_A,
      candidateReceiptDigest: NOTE_REFERENCE_HASH_B,
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
    expiresAt: "2026-08-06T05:00:00.000Z",
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
      signature: "d7v8dkSuBCkD1p1o8YrDFDIs7qoK7ex3uIXcXVbokff0o9F_qBmoarXC0OKdlr7ULVzb557y9dQztToXHiY-AA",
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
    caseBinding: {
      caseId: "case:note-surface",
      stageId: "build",
      caseContentHash: NOTE_REFERENCE_HASH_A,
    },
    repositoryBinding: {
      remote: "https://github.com/HomenShum/NodeRoom",
      commitSha: COMMIT,
      treeHash: NOTE_REFERENCE_HASH_B,
    },
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
    caseBinding: structuredClone(edge.caseBinding),
    repositoryBinding: structuredClone(edge.repositoryBinding),
    artifactBinding: {
      roomId,
      artifactId,
      ownerId,
      noteId: artifactId,
      casVersion,
      artifactContentHash: NOTE_REFERENCE_HASH_A,
    },
    candidateBinding: {
      candidateId: scoreReceipt.candidate.candidateId,
      candidateContentHash: scoreReceipt.candidate.candidateReceiptDigest,
      renderReceipts: [{
        receiptId: scoreReceipt.candidate.renderReceiptId,
        receiptDigest: scoreReceipt.candidate.renderReceiptDigest,
        stateId: "populated-stream" as const,
        viewportId: "desktop-1440x900",
      }],
    },
    surface: {
      surfaceId: "notebook-digest-workbench" as const,
      stateId: "populated-stream" as const,
      trustDecisionSurface: true,
    },
    capturePolicy: {
      expected: "armed" as const,
      reasonCode: "NORMAL_NOTE_CONTEXT" as const,
    },
    proofProfile: {
      profileId: scoreReceipt.profile,
      profileDigest: scoreReceipt.profileManifest.digest,
    },
    snapshots: {
      externalRun,
      observations: [observation],
      rules: [rule],
      scoreReceipt,
      edges: [edge],
    },
    reviewBinding: {
      reviewReceiptId: "review:note-surface:fresh-context",
      reviewReceiptDigest: NOTE_REFERENCE_HASH_B,
    },
  };
  const contentDigest = await referenceDigest(body);
  return {
    ...body,
    consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
    contentDigest,
  };
}

export async function resealNoteSurfaceReferenceFixture<T extends NoteSurfaceReferenceConsumption>(
  record: T,
): Promise<T> {
  const { consumptionId: _consumptionId, contentDigest: _contentDigest, ...body } = record;
  const contentDigest = await referenceDigest(body);
  return {
    ...body,
    consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
    contentDigest,
  } as T;
}
