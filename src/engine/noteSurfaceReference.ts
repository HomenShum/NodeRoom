/** Shared canonical reference contract used by the engine, Convex, and UI projections. */
export const NOTE_SURFACE_REFERENCE_CONSUMPTION_V1_SCHEMA =
  "noderoom.note-surface-reference-consumption/v1" as const;
export const NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA =
  "noderoom.note-surface-reference-consumption/v2" as const;
export const MAX_NOTE_SURFACE_REFERENCE_BYTES = 256 * 1024;

export type ReferenceResult =
  | "satisfied"
  | "violated"
  | "not-observed"
  | "not-applicable";

export type NoteCaptureState = "armed" | "disarmed";
export type NoteCaptureReasonCode =
  | "NORMAL_NOTE_CONTEXT"
  | "ROOM_AUTHORITY_UNRESOLVED"
  | "PROVENANCE_REVIEW_ACTIVE"
  | "PROPOSAL_REVIEW_ACTIVE"
  | "CONFLICT_REVIEW_ACTIVE"
  | "FAILED_SAFE_ACTIVE";
export type ReferenceProjectionStatus =
  | "verified"
  | "incomplete"
  | "failed"
  | "not-evaluated";
export type NoteSurfaceId =
  | "noteworthy-inbox"
  | "notebook-digest-workbench";
export type NoteSurfaceStateId =
  | "populated-stream"
  | "empty-first-capture"
  | "provenance-expanded-review"
  | "after-submit-reload";

export interface ReferenceChainRecordRef {
  schemaVersion: string;
  idField:
    | "artifactId"
    | "attestationId"
    | "consumptionId"
    | "edgeId"
    | "observationId"
    | "receiptId"
    | "reviewContextId"
    | "ruleId"
    | "runId";
  recordId: string;
  contentDigest: string;
}

export interface ReferenceChainEdge {
  schemaVersion: "nodekit.reference-chain-edge/v1";
  edgeId: string;
  from: ReferenceChainRecordRef;
  to: ReferenceChainRecordRef;
  caseBinding: {
    caseId: string;
    stageId: string;
    caseContentHash: string;
  };
  repositoryBinding: {
    remote: string;
    commitSha: string;
    treeHash: string;
  };
  authority: {
    kind:
      | "agent-produced"
      | "deterministic"
      | "externally-observed"
      | "human-attested"
      | "nodeproof-verified";
    attestationRefs?: ReferenceChainRecordRef[];
    receiptRefs?: ReferenceChainRecordRef[];
  };
  createdAt: string;
  limitations: string[];
  contentDigest: string;
}

export interface ReferenceObservationSnapshot {
  schemaVersion: "nodekit.reference-loop-observation/v1";
  observationId: string;
  source: {
    origin: "mobbin" | "nodekit-owned" | "workspace-private" | "public-web";
    sourceUrl: string;
    sourcePolicyId: string;
    firstSeenAt: string;
    lastVerifiedAt: string;
    accessMode: "owned" | "local" | "public" | "remote-mcp";
  };
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  facts: Array<{
    factId: string;
    kind:
      | "count"
      | "measurement"
      | "relationship"
      | "timing"
      | "easing"
      | "choreography"
      | "state-transition";
    subject: string;
    relation: string;
    object: string | number;
    unit: string;
    locatorDescription: string;
  }>;
  prohibitedMaterial: {
    storedPixels: false;
    cachedSourcePayload: false;
    embeddingStored: false;
  };
  contentDigest: string;
}

export interface DesignRuleSnapshot {
  schemaVersion: "nodekit.reference-loop-design-rule/v1";
  ruleId: string;
  sourceObservationRefs: Array<{
    observationId: string;
    observationDigest: string;
    factIds: string[];
  }>;
  statement: string;
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  mechanismHypothesis: string;
  appliesWhen: string[];
  doesNotApplyWhen: string[];
  confidence: {
    observation: "low" | "medium" | "high";
    audienceFit: "low" | "medium" | "high";
    causal: "none" | "low" | "medium" | "high";
  };
  requiredEvidence: string[];
  contentDigest: string;
}

export interface ReferenceScoreReceiptSnapshot {
  schemaVersion: "nodekit.reference-score-receipt/v1";
  receiptId: string;
  profile: string;
  profileManifest: {
    path: string;
    digest: string;
  };
  trustPolicy: {
    path: "reference/trust-policy.json";
    digest: string;
  };
  candidate: {
    candidateId: string;
    renderReceiptId: string;
    renderReceiptDigest: string;
    candidateReceiptDigest: string;
    candidateCommit: string;
  };
  rules: Array<{
    ruleId: string;
    ruleDigest: string;
    result: ReferenceResult;
    factIds: string[];
    evidenceRefs: string[];
    reason?: string;
  }>;
  coverage: {
    requiredRuleCount: number;
    evaluatedRuleCount: number;
    satisfiedRuleCount: number;
    violatedRuleCount: number;
    notObservedCount: number;
    notApplicableCount: number;
  };
  verdict: "pass" | "fail" | "incomplete";
  contentDigest: string;
}

export interface ExternalReferenceRunSnapshot {
  schemaVersion: "nodekit.external-reference-run/v1";
  runId: string;
  provider: "mobbin";
  operation: "authenticated-live-inspection";
  policyId: "nodekit.mobbin-remote-mcp/v1";
  status: "pass";
  checkedAt: string;
  expiresAt: string;
  sourceUrl: string;
  remoteObjectId: string;
  runNonce: string;
  producer: {
    tool: "mobbin/search_flows";
    version: string;
  };
  observationId: string;
  observationDigest: string;
  factsDigest: string;
  prohibitedMaterial: {
    storedPixels: false;
    cachedSourcePayload: false;
    embeddingStored: false;
    ragIndexed: false;
    trainingUsed: false;
  };
  subjectDigest: string;
  attestation: {
    schemaVersion: "nodekit.reference-service-attestation/v1";
    purpose: "mobbin-external-reference-run";
    keyId: string;
    subjectDigest: string;
    signedAt: string;
    algorithm: "Ed25519";
    signatureEncoding: "base64url";
    signature: string;
  };
  contentDigest: string;
}

export interface NoteSurfaceReferenceConsumptionV1 {
  schemaVersion: typeof NOTE_SURFACE_REFERENCE_CONSUMPTION_V1_SCHEMA;
  consumptionId: string;
  roomId: string;
  artifactId: string;
  externalRun: ExternalReferenceRunSnapshot;
  observation: ReferenceObservationSnapshot;
  rule: DesignRuleSnapshot;
  scoreReceipt: ReferenceScoreReceiptSnapshot;
  edge: ReferenceChainEdge;
  candidate: {
    commitSha: string;
    renderCommitShas: string[];
  };
  review: {
    mode: "fresh-context" | "independent-model" | "independent-human";
    claimedIndependent: boolean;
  };
  surface: {
    requiresTrustTreatment: boolean;
    classification: "trust-surface" | "non-trust-surface";
  };
  computedStyleEvidenceRefs: string[];
  createdAt: string;
  contentDigest: string;
}

export interface NoteSurfaceReferenceConsumptionV2 {
  schemaVersion: typeof NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA;
  consumptionId: string;
  caseBinding: {
    caseId: string;
    stageId: string;
    caseContentHash: string;
  };
  repositoryBinding: {
    remote: string;
    commitSha: string;
    treeHash: string;
  };
  artifactBinding: {
    roomId: string;
    artifactId: string;
    ownerId: string;
    noteId?: string;
    casVersion: string;
    artifactContentHash: string;
  };
  candidateBinding: {
    candidateId: string;
    candidateContentHash: string;
    renderReceipts: Array<{
      receiptId: string;
      receiptDigest: string;
      stateId: NoteSurfaceStateId;
      viewportId: string;
    }>;
  };
  surface: {
    surfaceId: NoteSurfaceId;
    stateId: NoteSurfaceStateId;
    trustDecisionSurface: boolean;
  };
  capturePolicy: {
    expected: NoteCaptureState;
    reasonCode: NoteCaptureReasonCode;
  };
  proofProfile: {
    profileId: string;
    profileDigest: string;
  };
  snapshots: {
    externalRun: ExternalReferenceRunSnapshot;
    observations: ReferenceObservationSnapshot[];
    rules: DesignRuleSnapshot[];
    scoreReceipt: ReferenceScoreReceiptSnapshot;
    edges: ReferenceChainEdge[];
  };
  reviewBinding: {
    reviewReceiptId: string;
    reviewReceiptDigest: string;
  };
  contentDigest: string;
}

export type NoteSurfaceReferenceConsumption =
  | NoteSurfaceReferenceConsumptionV1
  | NoteSurfaceReferenceConsumptionV2;

export interface NoteSurfaceReferenceView {
  externalRun: ExternalReferenceRunSnapshot;
  observations: ReferenceObservationSnapshot[];
  rules: DesignRuleSnapshot[];
  scoreReceipt: ReferenceScoreReceiptSnapshot;
  edges: ReferenceChainEdge[];
  roomId: string;
  artifactId: string;
  candidateCommit: string;
  surfaceId: NoteSurfaceId;
  stateId: NoteSurfaceStateId;
  reviewReceiptId?: string;
  reviewReceiptDigest?: string;
}

export interface NoteCaptureContext {
  hasPendingProposal: boolean;
  provenanceExpanded: boolean;
  hasConflict: boolean;
}

export interface NoteSurfaceReferenceEvaluation {
  accepted: boolean;
  findings: string[];
  projection: ReferenceProjectionStatus;
}

const HASH = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const EDGE_ID = /^reference_chain_edge_[0-9a-f]{24}$/;
const PROHIBITED_AUTHORITY_KEYS = new Set(["pass", "passed", "approved", "verified", "verdict"]);
const PROHIBITED_CACHE_KEYS = new Set([
  "cachedscreenshotpath",
  "screenshotpath",
  "pixelcache",
  "ocrtext",
  "embedding",
  "ragpayload",
  "trainingpayload",
]);

function exactJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function inspectKeys(
  value: unknown,
  options: { rejectAuthority: boolean; rejectCaches: boolean },
  path: string[] = [],
): string[] {
  if (!value || typeof value !== "object") return [];
  const findings: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
    const location = [...path, key].join(".");
    if (options.rejectAuthority && PROHIBITED_AUTHORITY_KEYS.has(normalized)) findings.push(`caller-authority:${location}`);
    if (options.rejectCaches && PROHIBITED_CACHE_KEYS.has(normalized)) findings.push(`prohibited-cache:${location}`);
    findings.push(...inspectKeys(child, options, [...path, key]));
  }
  return findings;
}

function inspectExactKeys(
  value: unknown,
  expectedKeys: readonly string[],
  path: string,
): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`invalid-object:${path}`];
  const expected = new Set(expectedKeys);
  return Object.keys(value as Record<string, unknown>)
    .filter((key) => !expected.has(key))
    .map((key) => `unknown-key:${path}.${key}`);
}

function recordRefMatches(
  ref: ReferenceChainRecordRef,
  schemaVersion: string,
  idField: ReferenceChainRecordRef["idField"],
  recordId: string,
  contentDigest: string,
): boolean {
  return ref.schemaVersion === schemaVersion
    && ref.idField === idField
    && ref.recordId === recordId
    && ref.contentDigest === contentDigest;
}

function isCanonicalInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function canonicalJsonValue(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("reference records require finite numbers");
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (typeof value !== "object" || value === undefined) {
    throw new Error("reference records require JSON values");
  }
  if (seen.has(value)) throw new Error("reference records cannot contain cycles");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Object.keys(value);
      if (
        keys.length !== value.length
        || keys.some((key, index) => key !== String(index))
      ) {
        throw new Error("reference record arrays cannot be sparse or carry named properties");
      }
      return `[${value.map((entry) => canonicalJsonValue(entry, seen)).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("reference records require plain JSON objects");
    }
    const record = value as Record<string, unknown>;
    if (Object.values(record).some((child) => child === undefined)) {
      throw new Error("reference records cannot contain undefined values");
    }
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => `${JSON.stringify(key)}:${canonicalJsonValue(record[key], seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJson(value: unknown): string {
  return canonicalJsonValue(value, new Set());
}

export async function referenceDigest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function isNoteSurfaceReferenceConsumptionV2(
  record: NoteSurfaceReferenceConsumption,
): record is NoteSurfaceReferenceConsumptionV2 {
  return record.schemaVersion === NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA;
}

export function noteSurfaceReferenceView(
  record: NoteSurfaceReferenceConsumption,
): NoteSurfaceReferenceView {
  if (isNoteSurfaceReferenceConsumptionV2(record)) {
    return {
      externalRun: record.snapshots.externalRun,
      observations: record.snapshots.observations,
      rules: record.snapshots.rules,
      scoreReceipt: record.snapshots.scoreReceipt,
      edges: record.snapshots.edges,
      roomId: record.artifactBinding.roomId,
      artifactId: record.artifactBinding.artifactId,
      candidateCommit: record.repositoryBinding.commitSha,
      surfaceId: record.surface.surfaceId,
      stateId: record.surface.stateId,
      reviewReceiptId: record.reviewBinding.reviewReceiptId,
      reviewReceiptDigest: record.reviewBinding.reviewReceiptDigest,
    };
  }
  return {
    externalRun: record.externalRun,
    observations: [record.observation],
    rules: [record.rule],
    scoreReceipt: record.scoreReceipt,
    edges: [record.edge],
    roomId: record.roomId,
    artifactId: record.artifactId,
    candidateCommit: record.candidate.commitSha,
    surfaceId: "notebook-digest-workbench",
    stateId: "populated-stream",
  };
}

export interface NoteSurfaceV1AdapterBindings {
  caseBinding: NoteSurfaceReferenceConsumptionV2["caseBinding"];
  repositoryBinding: NoteSurfaceReferenceConsumptionV2["repositoryBinding"];
  artifactBinding: NoteSurfaceReferenceConsumptionV2["artifactBinding"];
  candidateBinding: NoteSurfaceReferenceConsumptionV2["candidateBinding"];
  surface: NoteSurfaceReferenceConsumptionV2["surface"];
  capturePolicy: NoteSurfaceReferenceConsumptionV2["capturePolicy"];
  proofProfile: NoteSurfaceReferenceConsumptionV2["proofProfile"];
  reviewBinding: NoteSurfaceReferenceConsumptionV2["reviewBinding"];
}

/**
 * Compatibility is explicit: V1 did not carry durable Caseflow, owner, CAS,
 * render-state, proof-profile, or review identities, so callers must supply
 * those bindings from canonical records. The adapter never fabricates them.
 */
export async function adaptNoteSurfaceReferenceConsumptionV1(
  record: NoteSurfaceReferenceConsumptionV1,
  bindings: NoteSurfaceV1AdapterBindings,
): Promise<NoteSurfaceReferenceConsumptionV2> {
  const body = {
    schemaVersion: NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA,
    caseBinding: structuredClone(bindings.caseBinding),
    repositoryBinding: structuredClone(bindings.repositoryBinding),
    artifactBinding: structuredClone(bindings.artifactBinding),
    candidateBinding: structuredClone(bindings.candidateBinding),
    surface: structuredClone(bindings.surface),
    capturePolicy: structuredClone(bindings.capturePolicy),
    proofProfile: structuredClone(bindings.proofProfile),
    snapshots: {
      externalRun: structuredClone(record.externalRun),
      observations: [structuredClone(record.observation)],
      rules: [structuredClone(record.rule)],
      scoreReceipt: structuredClone(record.scoreReceipt),
      edges: [structuredClone(record.edge)],
    },
    reviewBinding: structuredClone(bindings.reviewBinding),
  };
  const contentDigest = await referenceDigest(body);
  return {
    ...body,
    consumptionId: `note_surface_consumption_${contentDigest.slice(0, 24)}`,
    contentDigest,
  };
}

function scoreCoverage(rules: ReferenceScoreReceiptSnapshot["rules"]): ReferenceScoreReceiptSnapshot["coverage"] {
  return {
    requiredRuleCount: rules.length,
    evaluatedRuleCount: rules.length,
    satisfiedRuleCount: rules.filter((rule) => rule.result === "satisfied").length,
    violatedRuleCount: rules.filter((rule) => rule.result === "violated").length,
    notObservedCount: rules.filter((rule) => rule.result === "not-observed").length,
    notApplicableCount: rules.filter((rule) => rule.result === "not-applicable").length,
  };
}

function scoreVerdict(coverage: ReferenceScoreReceiptSnapshot["coverage"]): ReferenceScoreReceiptSnapshot["verdict"] {
  if (coverage.violatedRuleCount > 0) return "fail";
  if (
    coverage.requiredRuleCount === 0
    || coverage.evaluatedRuleCount !== coverage.requiredRuleCount
    || coverage.notObservedCount > 0
  ) return "incomplete";
  return "pass";
}

async function verifyDerivedRecord(
  record: Record<string, unknown>,
  idField: string,
  prefix: string,
  finding: string,
): Promise<string[]> {
  const { [idField]: suppliedId, contentDigest: suppliedDigest, ...body } = record;
  const digest = await referenceDigest(body);
  const expectedId = `${prefix}_${digest.slice(0, 24)}`;
  return suppliedDigest === digest && suppliedId === expectedId ? [] : [finding];
}

export function deriveNoteCaptureState(context: NoteCaptureContext): {
  state: NoteCaptureState;
  reason: NoteCaptureReasonCode;
} {
  if (context.hasConflict) return { state: "disarmed", reason: "CONFLICT_REVIEW_ACTIVE" };
  if (context.hasPendingProposal) {
    return { state: "disarmed", reason: "PROPOSAL_REVIEW_ACTIVE" };
  }
  if (context.provenanceExpanded) {
    return { state: "disarmed", reason: "PROVENANCE_REVIEW_ACTIVE" };
  }
  return { state: "armed", reason: "NORMAL_NOTE_CONTEXT" };
}

function evaluateNoteSurfaceReferenceConsumptionV1(
  record: NoteSurfaceReferenceConsumptionV1,
  expected?: {
    roomId: string;
    artifactId: string;
    ownerId?: string;
    casVersion?: string;
    observation?: ReferenceObservationSnapshot;
    rule?: DesignRuleSnapshot;
    scoreReceipt?: ReferenceScoreReceiptSnapshot;
    edge?: ReferenceChainEdge;
  },
): NoteSurfaceReferenceEvaluation {
  const findings: string[] = [];
  const serialized = JSON.stringify(record);
  if (new TextEncoder().encode(serialized).byteLength > MAX_NOTE_SURFACE_REFERENCE_BYTES) {
    findings.push("record-too-large");
  }
  if (record.observation.facts.length > 256) findings.push("too-many-facts");
  if (record.rule.sourceObservationRefs.length > 64) findings.push("too-many-observation-refs");
  if (record.scoreReceipt.rules.length > 64) findings.push("too-many-rule-results");
  if (record.candidate.renderCommitShas.length > 48) findings.push("too-many-render-commits");
  if (record.computedStyleEvidenceRefs.length > 128) findings.push("too-many-style-evidence-refs");
  if (
    (record.edge.authority.attestationRefs?.length ?? 0) > 32
    || (record.edge.authority.receiptRefs?.length ?? 0) > 32
    || record.edge.limitations.length > 32
  ) findings.push("edge-bounds");
  if (record.schemaVersion !== NOTE_SURFACE_REFERENCE_CONSUMPTION_V1_SCHEMA) findings.push("schema-version");
  if (!record.consumptionId.trim()) findings.push("consumption-id");
  if (!isCanonicalInstant(record.createdAt)) findings.push("created-at");
  if (!HASH.test(record.contentDigest)) findings.push("content-digest");
  if (record.externalRun.status !== "pass") findings.push("external-run-not-pass");
  if (
    record.externalRun.provider !== "mobbin"
    || record.externalRun.operation !== "authenticated-live-inspection"
    || record.externalRun.policyId !== "nodekit.mobbin-remote-mcp/v1"
    || record.externalRun.producer.tool !== "mobbin/search_flows"
  ) findings.push("external-run-contract");
  if (
    !isCanonicalInstant(record.externalRun.checkedAt)
    || !isCanonicalInstant(record.externalRun.expiresAt)
    || !isCanonicalInstant(record.externalRun.attestation.signedAt)
    || Date.parse(record.externalRun.checkedAt) >= Date.parse(record.externalRun.expiresAt)
  ) findings.push("external-run-time");
  if (
    record.externalRun.attestation.purpose !== "mobbin-external-reference-run"
    || record.externalRun.attestation.algorithm !== "Ed25519"
    || record.externalRun.attestation.signatureEncoding !== "base64url"
    || record.externalRun.attestation.subjectDigest !== record.externalRun.subjectDigest
    || !/^[A-Za-z0-9_-]{16,}$/.test(record.externalRun.attestation.signature)
  ) findings.push("external-run-attestation");
  if (!record.externalRun.sourceUrl || !/^https:\/\/mobbin\.com\//.test(record.externalRun.sourceUrl)) {
    findings.push("missing-mobbin-url");
  }
  if (!record.observation.source.lastVerifiedAt || !isCanonicalInstant(record.observation.source.lastVerifiedAt)) {
    findings.push("missing-last-verified-at");
  }
  if (record.observation.source.sourceUrl !== record.externalRun.sourceUrl) findings.push("source-url-drift");
  if (
    record.observation.source.origin !== "mobbin"
    || record.observation.source.sourcePolicyId !== "atlas:mobbin/v1"
    || record.observation.source.accessMode !== "remote-mcp"
  ) findings.push("source-policy");
  if (
    record.externalRun.observationId !== record.observation.observationId
    || record.externalRun.observationDigest !== record.observation.contentDigest
  ) findings.push("external-run-observation-drift");
  if (
    record.observation.prohibitedMaterial.storedPixels !== false
    || record.observation.prohibitedMaterial.cachedSourcePayload !== false
    || record.observation.prohibitedMaterial.embeddingStored !== false
  ) findings.push("prohibited-material");
  if (
    record.externalRun.prohibitedMaterial.storedPixels !== false
    || record.externalRun.prohibitedMaterial.cachedSourcePayload !== false
    || record.externalRun.prohibitedMaterial.embeddingStored !== false
    || record.externalRun.prohibitedMaterial.ragIndexed !== false
    || record.externalRun.prohibitedMaterial.trainingUsed !== false
  ) findings.push("external-run-prohibited-material");
  findings.push(...inspectKeys(record, { rejectAuthority: false, rejectCaches: true }));
  findings.push(...inspectKeys(record.edge, { rejectAuthority: true, rejectCaches: true }, ["edge"]));

  const observationRef = record.rule.sourceObservationRefs.find(
    (ref) => ref.observationId === record.observation.observationId,
  );
  if (!observationRef || observationRef.observationDigest !== record.observation.contentDigest) {
    findings.push("observation-digest-drift");
  }
  const factIds = new Set(record.observation.facts.map((fact) => fact.factId));
  if (!observationRef || observationRef.factIds.some((factId) => !factIds.has(factId))) {
    findings.push("atomic-fact-drift");
  }
  const scoreRule = record.scoreReceipt.rules.find((candidate) => candidate.ruleId === record.rule.ruleId);
  if (!scoreRule || scoreRule.ruleDigest !== record.rule.contentDigest) findings.push("rule-digest-drift");
  if (
    scoreRule?.result === "not-applicable"
    && (!scoreRule.reason || scoreRule.reason.trim().length === 0)
  ) findings.push("not-applicable-without-reason");
  const derivedCoverage = scoreCoverage(record.scoreReceipt.rules);
  if (!exactJson(record.scoreReceipt.coverage, derivedCoverage)) findings.push("score-coverage-not-derived");
  if (record.scoreReceipt.verdict !== scoreVerdict(derivedCoverage)) findings.push("score-verdict-not-derived");
  if (record.surface.requiresTrustTreatment && record.surface.classification !== "trust-surface") {
    findings.push("trust-surface-misclassified");
  }
  if (record.review.mode === "fresh-context" && record.review.claimedIndependent) {
    findings.push("fresh-context-claimed-independent");
  }
  if (record.computedStyleEvidenceRefs.length === 0) findings.push("missing-computed-style-evidence");
  if (!COMMIT.test(record.candidate.commitSha)) findings.push("candidate-commit");
  if (
    record.scoreReceipt.candidate.candidateCommit !== record.candidate.commitSha
    || record.edge.repositoryBinding.commitSha !== record.candidate.commitSha
    || record.candidate.renderCommitShas.some((commit) => commit !== record.candidate.commitSha)
  ) findings.push("candidate-commit-drift");
  if (!EDGE_ID.test(record.edge.edgeId) || !HASH.test(record.edge.contentDigest)) findings.push("edge-identity");
  if (!recordRefMatches(
    record.edge.from,
    record.observation.schemaVersion,
    "observationId",
    record.observation.observationId,
    record.observation.contentDigest,
  )) findings.push("edge-source-drift");
  if (!recordRefMatches(
    record.edge.to,
    record.rule.schemaVersion,
    "ruleId",
    record.rule.ruleId,
    record.rule.contentDigest,
  )) findings.push("edge-target-drift");
  if ((record.edge.authority.attestationRefs?.length ?? 0) + (record.edge.authority.receiptRefs?.length ?? 0) === 0) {
    findings.push("edge-authority-evidence");
  }

  if (expected) {
    if (record.roomId !== expected.roomId || record.artifactId !== expected.artifactId) findings.push("artifact-binding-drift");
    if (expected.observation && !exactJson(record.observation, expected.observation)) findings.push("canonical-observation-drift");
    if (expected.rule && !exactJson(record.rule, expected.rule)) findings.push("canonical-rule-drift");
    if (expected.scoreReceipt && !exactJson(record.scoreReceipt, expected.scoreReceipt)) findings.push("canonical-score-drift");
    if (expected.edge && !exactJson(record.edge, expected.edge)) findings.push("canonical-edge-drift");
  }

  const accepted = findings.length === 0;
  const projection: ReferenceProjectionStatus = !accepted ? "failed" : "incomplete";
  return { accepted, findings: [...new Set(findings)].sort(), projection };
}

function evaluateNoteSurfaceReferenceConsumptionV2(
  record: NoteSurfaceReferenceConsumptionV2,
  expected?: {
    roomId: string;
    artifactId: string;
    observation?: ReferenceObservationSnapshot;
    rule?: DesignRuleSnapshot;
    scoreReceipt?: ReferenceScoreReceiptSnapshot;
    edge?: ReferenceChainEdge;
    caseBinding?: NoteSurfaceReferenceConsumptionV2["caseBinding"];
    repositoryBinding?: NoteSurfaceReferenceConsumptionV2["repositoryBinding"];
    proofProfile?: NoteSurfaceReferenceConsumptionV2["proofProfile"];
    ownerId?: string;
    casVersion?: string;
  },
): NoteSurfaceReferenceEvaluation {
  const findings: string[] = [];
  const encodedBytes = new TextEncoder().encode(JSON.stringify(record)).byteLength;
  if (encodedBytes > MAX_NOTE_SURFACE_REFERENCE_BYTES) findings.push("record-too-large");
  if (record.schemaVersion !== NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA) findings.push("schema-version");
  if (!record.consumptionId.trim()) findings.push("consumption-id");
  if (!HASH.test(record.contentDigest)) findings.push("content-digest");

  const { observations, rules, scoreReceipt, edges, externalRun } = record.snapshots;
  if (observations.length === 0) findings.push("missing-observations");
  if (rules.length === 0) findings.push("missing-rules");
  if (observations.length > 64) findings.push("too-many-observations");
  if (rules.length > 64) findings.push("too-many-rules");
  if (scoreReceipt.rules.length > 64) findings.push("too-many-rule-results");
  if (edges.length === 0 || edges.length > 128) findings.push("edge-bounds");
  if (record.candidateBinding.renderReceipts.length === 0) findings.push("missing-render-receipts");
  if (record.candidateBinding.renderReceipts.length > 48) findings.push("too-many-render-receipts");
  if (!record.surface.trustDecisionSurface) findings.push("trust-surface-misclassified");
  findings.push(...inspectExactKeys(record, [
    "schemaVersion",
    "consumptionId",
    "caseBinding",
    "repositoryBinding",
    "artifactBinding",
    "candidateBinding",
    "surface",
    "capturePolicy",
    "proofProfile",
    "snapshots",
    "reviewBinding",
    "contentDigest",
  ], "record"));
  findings.push(...inspectExactKeys(record.caseBinding, [
    "caseId", "stageId", "caseContentHash",
  ], "record.caseBinding"));
  findings.push(...inspectExactKeys(record.repositoryBinding, [
    "remote", "commitSha", "treeHash",
  ], "record.repositoryBinding"));
  findings.push(...inspectExactKeys(record.artifactBinding, [
    "roomId", "artifactId", "ownerId", "noteId", "casVersion", "artifactContentHash",
  ], "record.artifactBinding"));
  findings.push(...inspectExactKeys(record.candidateBinding, [
    "candidateId", "candidateContentHash", "renderReceipts",
  ], "record.candidateBinding"));
  findings.push(...inspectExactKeys(record.surface, [
    "surfaceId", "stateId", "trustDecisionSurface",
  ], "record.surface"));
  findings.push(...inspectExactKeys(record.capturePolicy, [
    "expected", "reasonCode",
  ], "record.capturePolicy"));
  findings.push(...inspectExactKeys(record.proofProfile, [
    "profileId", "profileDigest",
  ], "record.proofProfile"));
  findings.push(...inspectExactKeys(record.snapshots, [
    "externalRun", "observations", "rules", "scoreReceipt", "edges",
  ], "record.snapshots"));
  findings.push(...inspectExactKeys(record.reviewBinding, [
    "reviewReceiptId", "reviewReceiptDigest",
  ], "record.reviewBinding"));
  for (const [index, receipt] of record.candidateBinding.renderReceipts.entries()) {
    findings.push(...inspectExactKeys(receipt, [
      "receiptId", "receiptDigest", "stateId", "viewportId",
    ], `record.candidateBinding.renderReceipts.${index}`));
  }

  const expectedCaptureState = record.capturePolicy.reasonCode === "NORMAL_NOTE_CONTEXT"
    ? "armed"
    : "disarmed";
  if (record.capturePolicy.expected !== expectedCaptureState) findings.push("capture-policy-drift");

  if (
    !record.caseBinding.caseId.trim()
    || !record.caseBinding.stageId.trim()
    || !HASH.test(record.caseBinding.caseContentHash)
  ) findings.push("case-binding");
  if (
    !record.repositoryBinding.remote.trim()
    || !COMMIT.test(record.repositoryBinding.commitSha)
    || !HASH.test(record.repositoryBinding.treeHash)
  ) findings.push("repository-binding");
  if (
    !record.artifactBinding.roomId.trim()
    || !record.artifactBinding.artifactId.trim()
    || !record.artifactBinding.ownerId.trim()
    || !record.artifactBinding.casVersion.trim()
    || !HASH.test(record.artifactBinding.artifactContentHash)
  ) findings.push("artifact-binding");
  if (
    !record.candidateBinding.candidateId.trim()
    || !HASH.test(record.candidateBinding.candidateContentHash)
  ) findings.push("candidate-binding");
  if (
    !record.reviewBinding.reviewReceiptId.trim()
    || !HASH.test(record.reviewBinding.reviewReceiptDigest)
  ) findings.push("review-binding");
  if (!record.proofProfile.profileId.trim() || !HASH.test(record.proofProfile.profileDigest)) {
    findings.push("proof-profile");
  }

  if (
    scoreReceipt.profile !== record.proofProfile.profileId
    || scoreReceipt.profileManifest.digest !== record.proofProfile.profileDigest
  ) findings.push("proof-profile-drift");
  if (
    scoreReceipt.candidate.candidateId !== record.candidateBinding.candidateId
    || scoreReceipt.candidate.candidateReceiptDigest !== record.candidateBinding.candidateContentHash
    || scoreReceipt.candidate.candidateCommit !== record.repositoryBinding.commitSha
  ) findings.push("candidate-binding-drift");
  const scoreRender = record.candidateBinding.renderReceipts.find(
    (receipt) => receipt.receiptId === scoreReceipt.candidate.renderReceiptId,
  );
  if (!scoreRender || scoreRender.receiptDigest !== scoreReceipt.candidate.renderReceiptDigest) {
    findings.push("render-receipt-drift");
  }

  if (
    externalRun.status !== "pass"
    || externalRun.provider !== "mobbin"
    || externalRun.operation !== "authenticated-live-inspection"
    || externalRun.policyId !== "nodekit.mobbin-remote-mcp/v1"
    || externalRun.producer.tool !== "mobbin/search_flows"
  ) findings.push("external-run-contract");
  if (!externalRun.sourceUrl || !/^https:\/\/mobbin\.com\//.test(externalRun.sourceUrl)) {
    findings.push("missing-mobbin-url");
  }
  if (
    !isCanonicalInstant(externalRun.checkedAt)
    || !isCanonicalInstant(externalRun.expiresAt)
    || !isCanonicalInstant(externalRun.attestation.signedAt)
    || Date.parse(externalRun.checkedAt) >= Date.parse(externalRun.expiresAt)
  ) findings.push("external-run-time");

  findings.push(...inspectKeys(record, { rejectAuthority: false, rejectCaches: true }));
  for (const edge of edges) {
    findings.push(...inspectKeys(edge, { rejectAuthority: true, rejectCaches: true }, ["snapshots", "edges", edge.edgeId]));
    if (!exactJson(edge.caseBinding, record.caseBinding)) findings.push("edge-case-binding-drift");
    if (!exactJson(edge.repositoryBinding, record.repositoryBinding)) findings.push("edge-repository-binding-drift");
    if ((edge.authority.attestationRefs?.length ?? 0) + (edge.authority.receiptRefs?.length ?? 0) === 0) {
      findings.push("edge-authority-evidence");
    }
  }

  const observationsById = new Map(observations.map((observation) => [observation.observationId, observation]));
  const rulesById = new Map(rules.map((rule) => [rule.ruleId, rule]));
  for (const rule of rules) {
    for (const ref of rule.sourceObservationRefs) {
      const observation = observationsById.get(ref.observationId);
      if (!observation || observation.contentDigest !== ref.observationDigest) {
        findings.push("observation-digest-drift");
        continue;
      }
      const factIds = new Set(observation.facts.map((fact) => fact.factId));
      if (ref.factIds.some((factId) => !factIds.has(factId))) findings.push("atomic-fact-drift");
    }
    const scored = scoreReceipt.rules.find((candidate) => candidate.ruleId === rule.ruleId);
    if (!scored || scored.ruleDigest !== rule.contentDigest) findings.push("rule-digest-drift");
  }
  if (scoreReceipt.rules.some((scored) => !rulesById.has(scored.ruleId))) findings.push("score-rule-not-canonical");
  const derivedCoverage = scoreCoverage(scoreReceipt.rules);
  if (!exactJson(scoreReceipt.coverage, derivedCoverage)) findings.push("score-coverage-not-derived");
  if (scoreReceipt.verdict !== scoreVerdict(derivedCoverage)) findings.push("score-verdict-not-derived");

  if (expected) {
    if (
      record.artifactBinding.roomId !== expected.roomId
      || record.artifactBinding.artifactId !== expected.artifactId
    ) findings.push("artifact-binding-drift");
    if (expected.ownerId && record.artifactBinding.ownerId !== expected.ownerId) {
      findings.push("artifact-owner-binding-drift");
    }
    if (expected.casVersion && record.artifactBinding.casVersion !== expected.casVersion) {
      findings.push("artifact-cas-binding-drift");
    }
    if (expected.caseBinding && !exactJson(record.caseBinding, expected.caseBinding)) findings.push("case-binding-drift");
    if (expected.repositoryBinding && !exactJson(record.repositoryBinding, expected.repositoryBinding)) {
      findings.push("repository-binding-drift");
    }
    if (expected.proofProfile && !exactJson(record.proofProfile, expected.proofProfile)) {
      findings.push("proof-profile-drift");
    }
    if (expected.observation && !observations.some((value) => exactJson(value, expected.observation))) {
      findings.push("canonical-observation-drift");
    }
    if (expected.rule && !rules.some((value) => exactJson(value, expected.rule))) findings.push("canonical-rule-drift");
    if (expected.scoreReceipt && !exactJson(scoreReceipt, expected.scoreReceipt)) findings.push("canonical-score-drift");
    if (expected.edge && !edges.some((value) => exactJson(value, expected.edge))) findings.push("canonical-edge-drift");
  }

  const accepted = findings.length === 0;
  return {
    accepted,
    findings: [...new Set(findings)].sort(),
    // NodeProof is an external barrier. This compatibility envelope intentionally
    // cannot self-assert that barrier, so a structurally valid record is incomplete.
    projection: accepted ? "incomplete" : "failed",
  };
}

export function evaluateNoteSurfaceReferenceConsumption(
  record: NoteSurfaceReferenceConsumption,
  expected?: Parameters<typeof evaluateNoteSurfaceReferenceConsumptionV2>[1],
): NoteSurfaceReferenceEvaluation {
  if (isNoteSurfaceReferenceConsumptionV2(record)) {
    return evaluateNoteSurfaceReferenceConsumptionV2(record, expected);
  }
  return evaluateNoteSurfaceReferenceConsumptionV1(record, expected);
}

export function safelyEvaluateNoteSurfaceReferenceConsumption(
  record: unknown,
  expected?: Parameters<typeof evaluateNoteSurfaceReferenceConsumption>[1],
): NoteSurfaceReferenceEvaluation {
  try {
    return evaluateNoteSurfaceReferenceConsumption(
      record as NoteSurfaceReferenceConsumption,
      expected,
    );
  } catch {
    return {
      accepted: false,
      findings: ["malformed-reference-consumption"],
      projection: "failed",
    };
  }
}

export async function verifyNoteSurfaceReferenceConsumptionDigest(
  record: NoteSurfaceReferenceConsumption,
): Promise<boolean> {
  return (await verifyNoteSurfaceReferenceConsumptionBindings(record)).accepted;
}

export async function verifyNoteSurfaceReferenceConsumptionBindings(
  record: NoteSurfaceReferenceConsumption,
  expected?: Parameters<typeof evaluateNoteSurfaceReferenceConsumption>[1],
): Promise<NoteSurfaceReferenceEvaluation> {
  const structural = safelyEvaluateNoteSurfaceReferenceConsumption(record, expected);
  if (!structural.accepted) return structural;
  const findings = [...structural.findings];
  try {
    const view = noteSurfaceReferenceView(record);
    const {
      runId: _runId,
      subjectDigest: _subjectDigest,
      contentDigest: _contentDigest,
      attestation: _attestation,
      ...externalSubject
    } = view.externalRun;
    const expectedSubjectDigest = await referenceDigest(externalSubject);
    if (view.externalRun.subjectDigest !== expectedSubjectDigest) {
      findings.push("external-run-subject-digest");
    }
    if (view.externalRun.runId !== `external_run_${expectedSubjectDigest.slice(0, 24)}`) {
      findings.push("external-run-id");
    }
    const { contentDigest: _externalContentDigest, ...externalBody } = view.externalRun;
    if (view.externalRun.contentDigest !== await referenceDigest(externalBody)) {
      findings.push("external-run-content-digest");
    }
    for (const observation of view.observations) {
      findings.push(...await verifyDerivedRecord(
        observation as unknown as Record<string, unknown>,
        "observationId",
        "observation",
        "observation-content-digest",
      ));
    }
    for (const rule of view.rules) {
      findings.push(...await verifyDerivedRecord(
        rule as unknown as Record<string, unknown>,
        "ruleId",
        "rule",
        "rule-content-digest",
      ));
    }
    findings.push(...await verifyDerivedRecord(
      view.scoreReceipt as unknown as Record<string, unknown>,
      "receiptId",
      "score",
      "score-content-digest",
    ));
    for (const edge of view.edges) {
      findings.push(...await verifyDerivedRecord(
        edge as unknown as Record<string, unknown>,
        "edgeId",
        "reference_chain_edge",
        "edge-content-digest",
      ));
    }
    findings.push(...await verifyDerivedRecord(
      record as unknown as Record<string, unknown>,
      "consumptionId",
      "note_surface_consumption",
      "consumption-content-digest",
    ));
  } catch {
    findings.push("malformed-reference-digest");
  }
  const uniqueFindings = [...new Set(findings)].sort();
  const accepted = uniqueFindings.length === 0;
  return {
    accepted,
    findings: uniqueFindings,
    projection: accepted ? "incomplete" : "failed",
  };
}

export function referenceProjectionLabel(status: ReferenceProjectionStatus): string {
  if (status === "verified") return "Verified";
  if (status === "incomplete") return "Incomplete";
  if (status === "not-evaluated") return "Not evaluated";
  return "Failed";
}

export function reconcileReferenceProjection(
  record: NoteSurfaceReferenceConsumption,
  claimed: ReferenceProjectionStatus | "bound" | "needs-review",
): {
  projection: ReferenceProjectionStatus;
  repaired: boolean;
  findings: string[];
} {
  const evaluation = safelyEvaluateNoteSurfaceReferenceConsumption(record);
  return {
    projection: evaluation.projection,
    repaired: claimed !== evaluation.projection,
    findings: evaluation.findings,
  };
}
