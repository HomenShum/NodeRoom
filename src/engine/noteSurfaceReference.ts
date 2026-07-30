/** Shared canonical reference contract used by the engine, Convex, and UI projections. */
export const NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA =
  "noderoom.note-surface-reference-consumption/v1" as const;
export const MAX_NOTE_SURFACE_REFERENCE_BYTES = 256 * 1024;

export type ReferenceResult =
  | "satisfied"
  | "violated"
  | "not-observed"
  | "not-applicable";

export type NoteCaptureState = "armed" | "disarmed";
export type ReferenceProjectionStatus = "bound" | "needs-review" | "failed";

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

export interface NoteSurfaceReferenceConsumption {
  schemaVersion: typeof NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA;
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
  reason: "ready" | "reference-review" | "conflict";
} {
  if (context.hasConflict) return { state: "disarmed", reason: "conflict" };
  if (context.provenanceExpanded) {
    return { state: "disarmed", reason: "reference-review" };
  }
  return { state: "armed", reason: "ready" };
}

export function evaluateNoteSurfaceReferenceConsumption(
  record: NoteSurfaceReferenceConsumption,
  expected?: {
    roomId: string;
    artifactId: string;
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
  if (record.schemaVersion !== NOTE_SURFACE_REFERENCE_CONSUMPTION_SCHEMA) findings.push("schema-version");
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
  const projection: ReferenceProjectionStatus = !accepted
    ? "failed"
    : record.scoreReceipt.verdict === "pass"
      ? "bound"
      : "needs-review";
  return { accepted, findings: [...new Set(findings)].sort(), projection };
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
    const {
      runId: _runId,
      subjectDigest: _subjectDigest,
      contentDigest: _contentDigest,
      attestation: _attestation,
      ...externalSubject
    } = record.externalRun;
    const expectedSubjectDigest = await referenceDigest(externalSubject);
    if (record.externalRun.subjectDigest !== expectedSubjectDigest) {
      findings.push("external-run-subject-digest");
    }
    if (record.externalRun.runId !== `external_run_${expectedSubjectDigest.slice(0, 24)}`) {
      findings.push("external-run-id");
    }
    const { contentDigest: _externalContentDigest, ...externalBody } = record.externalRun;
    if (record.externalRun.contentDigest !== await referenceDigest(externalBody)) {
      findings.push("external-run-content-digest");
    }
    findings.push(...await verifyDerivedRecord(
      record.observation as unknown as Record<string, unknown>,
      "observationId",
      "observation",
      "observation-content-digest",
    ));
    findings.push(...await verifyDerivedRecord(
      record.rule as unknown as Record<string, unknown>,
      "ruleId",
      "rule",
      "rule-content-digest",
    ));
    findings.push(...await verifyDerivedRecord(
      record.scoreReceipt as unknown as Record<string, unknown>,
      "receiptId",
      "score",
      "score-content-digest",
    ));
    findings.push(...await verifyDerivedRecord(
      record.edge as unknown as Record<string, unknown>,
      "edgeId",
      "reference_chain_edge",
      "edge-content-digest",
    ));
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
    projection: !accepted
      ? "failed"
      : record.scoreReceipt.verdict === "pass"
        ? "bound"
        : "needs-review",
  };
}

export function referenceProjectionLabel(status: ReferenceProjectionStatus): string {
  if (status === "bound") return "Reference chain bound";
  if (status === "needs-review") return "Reference review incomplete";
  return "Reference chain failed";
}

export function reconcileReferenceProjection(
  record: NoteSurfaceReferenceConsumption,
  claimed: ReferenceProjectionStatus,
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
