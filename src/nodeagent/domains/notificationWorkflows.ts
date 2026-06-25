import type { DomainGateVerdict, DomainPack, DomainValidationResult } from "./types";

export const NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID = "notification-workflows" as const;
export const NOTIFICATION_WORKFLOWS_PROOF_SCHEMA = "notification-workflows.domain-proof.v1" as const;

export const NOTIFICATION_WORKFLOWS_GATE_IDS = [
  "intent_created",
  "audience_resolved",
  "privacy_redacted",
  "idempotent",
  "preference_suppressed",
  "deep_link_valid",
  "delivery_receipted",
  "failure_honest",
  "external_draft_first",
  "digest_batched",
] as const;

export type NotificationWorkflowGateId = (typeof NOTIFICATION_WORKFLOWS_GATE_IDS)[number];

export interface NotificationWorkflowGateReceipt {
  gateId: NotificationWorkflowGateId;
  verdict: DomainGateVerdict;
  evidenceRefs: string[];
  assertions?: {
    intentLinkedToTrace?: boolean;
    audiencePolicyApplied?: boolean;
    noPrivatePreviewLeak?: boolean;
    noPiiPreviewLeak?: boolean;
    idempotencyKeyPresent?: boolean;
    duplicateSuppressed?: boolean;
    optOutSuppressed?: boolean;
    quietHoursApplied?: boolean;
    deepLinkOpensTarget?: boolean;
    providerReceiptRecorded?: boolean;
    failedSendVisible?: boolean;
    externalAudienceDraftOnly?: boolean;
    digestCollapsed?: boolean;
  };
  counts?: {
    recipients?: number;
    deliveries?: number;
    duplicateSends?: number;
    suppressedDeliveries?: number;
    privateLeaks?: number;
    piiLeaks?: number;
    providerReceipts?: number;
    externalAutoSends?: number;
  };
}

export interface NotificationWorkflowsDomainProofReceipt {
  schema: typeof NOTIFICATION_WORKFLOWS_PROOF_SCHEMA;
  domainPackId: typeof NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID;
  caseId: string;
  generatedAt: string;
  roomId?: string;
  roomUrl?: string;
  gates: Partial<Record<NotificationWorkflowGateId, NotificationWorkflowGateReceipt>>;
  passed: boolean;
}

export const NOTIFICATION_WORKFLOWS_DOMAIN_PACK: DomainPack = {
  id: NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID,
  name: "Notification Workflows",
  ontology: {
    entities: [
      "RoomEvent",
      "NotificationIntent",
      "AudiencePolicy",
      "Recipient",
      "NotificationPreference",
      "NotificationDelivery",
      "ProviderReceipt",
      "TraceStep",
      "FocusBox",
      "ExternalDraft",
      "DigestBatch",
    ],
    relationships: [
      "intent_links_to_trace_step",
      "audience_policy_selects_recipients",
      "privacy_filter_redacts_preview",
      "idempotency_key_suppresses_duplicate",
      "delivery_receipt_links_provider_message",
      "deep_link_opens_focus_target",
      "external_audience_requires_draft_approval",
    ],
  },
  invariants: [
    {
      id: "audience_policy",
      description: "Every notification resolves an allowed audience before delivery rows are created.",
      severity: "blocker",
      professionalFailure: "A user or external contact receives a room update they should not have received.",
    },
    {
      id: "privacy_redaction",
      description: "Push/email previews cannot expose private notes, PII, confidential source snippets, or unapproved claims.",
      severity: "blocker",
      professionalFailure: "A lock-screen or inbox preview leaks sensitive room content.",
    },
    {
      id: "idempotency",
      description: "External provider sends require idempotency keys and duplicate suppression.",
      severity: "blocker",
      professionalFailure: "The same job-complete event spams recipients repeatedly.",
    },
    {
      id: "preference_policy",
      description: "Opt-out, channel preference, quiet-hours, and digest rules suppress or delay sends.",
      severity: "blocker",
      professionalFailure: "NodeRoom ignores user notification settings.",
    },
    {
      id: "trace_deeplink",
      description: "Every notification opens the exact room artifact, trace step, proposal, or focus target that caused it.",
      severity: "blocker",
      professionalFailure: "A recipient gets an alert but cannot inspect or act on the source event.",
    },
    {
      id: "delivery_receipt",
      description: "Provider sends record sent/failed/bounced/opened/clicked/suppressed receipts.",
      severity: "major",
      professionalFailure: "The product claims a notification succeeded without delivery evidence.",
    },
    {
      id: "external_draft_first",
      description: "External audience notifications create drafts/approval cards unless explicit consent and policy allow sending.",
      severity: "blocker",
      professionalFailure: "NodeRoom sends prospect/client outreach without human approval.",
    },
    {
      id: "digest_batching",
      description: "Low-priority repeated events batch into digests instead of notification storms.",
      severity: "major",
      professionalFailure: "Routine room activity becomes spam.",
    },
  ],
  proofGates: [
    gate("intent_created", "A room event creates exactly one trace-linked notification intent.", "intent-created-receipt.json", ["trace_deeplink"]),
    gate("audience_resolved", "Audience resolver selected recipients according to role, watch, assignee, and external policy.", "audience-resolved-receipt.json", ["audience_policy"]),
    gate("privacy_redacted", "Rendered previews passed private-content and PII redaction checks.", "privacy-redacted-receipt.json", ["privacy_redaction"]),
    gate("idempotent", "The idempotency key suppressed duplicate provider sends.", "idempotency-receipt.json", ["idempotency"]),
    gate("preference_suppressed", "Opt-out, quiet-hours, disabled channel, or digest preference suppression is honored.", "preference-suppression-receipt.json", ["preference_policy"]),
    gate("deep_link_valid", "Deep links open the exact room artifact, trace step, proposal, or focus box.", "deep-link-receipt.json", ["trace_deeplink"]),
    gate("delivery_receipted", "Provider status, message id, latency, cost, and errors are recorded.", "delivery-receipt.json", ["delivery_receipt"]),
    gate("failure_honest", "Provider failures remain visible and retriable instead of being marked sent.", "failure-honesty-receipt.json", ["delivery_receipt"]),
    gate("external_draft_first", "External audience workflow creates an approval draft, not an automatic send.", "external-draft-receipt.json", ["external_draft_first"]),
    gate("digest_batched", "Repeated low-priority events collapse into a digest batch.", "digest-batch-receipt.json", ["digest_batching"]),
  ],
  visualChecks: [
    { id: "notification_center", screenshotOrVideoRequired: true, canonicalViews: ["notification center", "delivery receipt panel"] },
    { id: "deep_link_focus", screenshotOrVideoRequired: true, canonicalViews: ["focused artifact target", "trace/focus box"] },
  ],
  regressionFixtures: [
    "duplicate-job-complete",
    "private-note-leak",
    "unsubscribed-user",
    "high-priority-spam",
    "broken-deeplink",
    "external-audience-auto-send",
  ],
};

export function validateNotificationWorkflowsDomainProof(
  receipt: unknown,
  requiredGateIds: readonly NotificationWorkflowGateId[] = NOTIFICATION_WORKFLOWS_GATE_IDS,
): DomainValidationResult {
  const errors: string[] = [];
  const proof = receipt && typeof receipt === "object" && !Array.isArray(receipt)
    ? receipt as Partial<NotificationWorkflowsDomainProofReceipt>
    : undefined;
  if (!proof) errors.push("receipt must be an object");
  if (proof?.schema !== NOTIFICATION_WORKFLOWS_PROOF_SCHEMA) errors.push(`schema must be ${NOTIFICATION_WORKFLOWS_PROOF_SCHEMA}`);
  if (proof?.domainPackId !== NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID) errors.push(`domainPackId must be ${NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID}`);
  if (typeof proof?.caseId !== "string" || !proof.caseId.trim()) errors.push("caseId is required");
  if (typeof proof?.generatedAt !== "string" || Number.isNaN(Date.parse(proof.generatedAt))) errors.push("generatedAt must be an ISO timestamp");
  if (proof?.passed !== true) errors.push("passed must be true");

  const gates = proof?.gates ?? {};
  const missingGateIds = requiredGateIds.filter((gateId) => gates[gateId]?.verdict !== "pass");
  for (const gateId of missingGateIds) errors.push(`missing passing gate: ${gateId}`);

  const privacy = gates.privacy_redacted;
  if (privacy?.counts?.privateLeaks && privacy.counts.privateLeaks > 0) errors.push("privateLeaks must be 0");
  if (privacy?.counts?.piiLeaks && privacy.counts.piiLeaks > 0) errors.push("piiLeaks must be 0");
  if (privacy?.assertions?.noPrivatePreviewLeak !== true) errors.push("privacy_redacted requires noPrivatePreviewLeak=true");

  const idempotent = gates.idempotent;
  if (idempotent?.assertions?.idempotencyKeyPresent !== true) errors.push("idempotent requires idempotencyKeyPresent=true");
  if (idempotent?.counts?.duplicateSends && idempotent.counts.duplicateSends > 0) errors.push("duplicateSends must be 0");

  const external = gates.external_draft_first;
  if (external?.assertions?.externalAudienceDraftOnly !== true) errors.push("external_draft_first requires externalAudienceDraftOnly=true");
  if (external?.counts?.externalAutoSends && external.counts.externalAutoSends > 0) errors.push("externalAutoSends must be 0");

  return {
    ok: errors.length === 0,
    domainPackId: NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID,
    caseId: proof?.caseId,
    errors,
    missingGateIds,
  };
}

function gate(id: NotificationWorkflowGateId, description: string, requiredReceipt: string, invariantIds: string[]) {
  return {
    id,
    description,
    requiredReceipt,
    blocksParentClaim: true,
    invariantIds,
  };
}
