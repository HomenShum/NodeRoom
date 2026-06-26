import { describe, expect, it } from "vitest";
import {
  NOTIFICATION_WORKFLOWS_DOMAIN_PACK,
  NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID,
  NOTIFICATION_WORKFLOWS_GATE_IDS,
  NOTIFICATION_WORKFLOWS_PROOF_SCHEMA,
  validateNotificationWorkflowsDomainProof,
  type NotificationWorkflowGateId,
  type NotificationWorkflowGateReceipt,
  type NotificationWorkflowsDomainProofReceipt,
} from "../src/nodeagent";

function gate(gateId: NotificationWorkflowGateId): NotificationWorkflowGateReceipt {
  const base = {
    gateId,
    verdict: "pass" as const,
    evidenceRefs: [`trace:${gateId}`],
  };
  if (gateId === "privacy_redacted") {
    return {
      ...base,
      assertions: { noPrivatePreviewLeak: true, noPiiPreviewLeak: true },
      counts: { privateLeaks: 0, piiLeaks: 0 },
    };
  }
  if (gateId === "idempotent") {
    return {
      ...base,
      assertions: { idempotencyKeyPresent: true, duplicateSuppressed: true },
      counts: { duplicateSends: 0 },
    };
  }
  if (gateId === "external_draft_first") {
    return {
      ...base,
      assertions: { externalAudienceDraftOnly: true },
      counts: { externalAutoSends: 0 },
    };
  }
  if (gateId === "delivery_receipted") {
    return {
      ...base,
      assertions: { providerReceiptRecorded: true },
      counts: { providerReceipts: 1 },
    };
  }
  if (gateId === "deep_link_valid") return { ...base, assertions: { deepLinkOpensTarget: true } };
  if (gateId === "audience_resolved") return { ...base, assertions: { audiencePolicyApplied: true }, counts: { recipients: 2 } };
  if (gateId === "intent_created") return { ...base, assertions: { intentLinkedToTrace: true } };
  if (gateId === "preference_suppressed") return { ...base, assertions: { optOutSuppressed: true, quietHoursApplied: true }, counts: { suppressedDeliveries: 1 } };
  if (gateId === "failure_honest") return { ...base, assertions: { failedSendVisible: true } };
  return { ...base, assertions: { digestCollapsed: true } };
}

function goodReceipt(): NotificationWorkflowsDomainProofReceipt {
  return {
    schema: NOTIFICATION_WORKFLOWS_PROOF_SCHEMA,
    domainPackId: NOTIFICATION_WORKFLOWS_DOMAIN_PACK_ID,
    caseId: "notification-job-complete",
    generatedAt: "2026-06-25T00:00:00.000Z",
    roomId: "NRNOTIFY",
    roomUrl: "http://127.0.0.1:5273/?room=NRNOTIFY&focusMode=1",
    gates: Object.fromEntries(NOTIFICATION_WORKFLOWS_GATE_IDS.map((gateId) => [gateId, gate(gateId)])),
    passed: true,
  };
}

describe("notification workflows domain pack", () => {
  it("defines governed notification workflow invariants and proof gates", () => {
    expect(NOTIFICATION_WORKFLOWS_DOMAIN_PACK.id).toBe("notification-workflows");
    expect(NOTIFICATION_WORKFLOWS_DOMAIN_PACK.ontology.entities).toEqual(expect.arrayContaining([
      "NotificationIntent",
      "AudiencePolicy",
      "NotificationDelivery",
      "ProviderReceipt",
      "ExternalDraft",
    ]));
    expect(NOTIFICATION_WORKFLOWS_DOMAIN_PACK.invariants.map((invariant) => invariant.id)).toEqual(expect.arrayContaining([
      "audience_policy",
      "privacy_redaction",
      "idempotency",
      "external_draft_first",
    ]));
    expect(NOTIFICATION_WORKFLOWS_DOMAIN_PACK.proofGates.every((gateDef) => gateDef.blocksParentClaim)).toBe(true);
    expect(NOTIFICATION_WORKFLOWS_DOMAIN_PACK.regressionFixtures).toEqual(expect.arrayContaining([
      "duplicate-job-complete",
      "private-note-leak",
      "external-audience-auto-send",
    ]));
  });

  it("accepts a complete notification workflow proof receipt", () => {
    expect(validateNotificationWorkflowsDomainProof(goodReceipt())).toMatchObject({
      ok: true,
      errors: [],
      missingGateIds: [],
    });
  });

  it("rejects private preview leaks, duplicate sends, and external auto-sends", () => {
    const receipt = goodReceipt();
    receipt.gates.privacy_redacted = {
      ...gate("privacy_redacted"),
      assertions: { noPrivatePreviewLeak: false },
      counts: { privateLeaks: 1 },
    };
    receipt.gates.idempotent = {
      ...gate("idempotent"),
      assertions: { idempotencyKeyPresent: false },
      counts: { duplicateSends: 1 },
    };
    receipt.gates.external_draft_first = {
      ...gate("external_draft_first"),
      assertions: { externalAudienceDraftOnly: false },
      counts: { externalAutoSends: 1 },
    };

    const validation = validateNotificationWorkflowsDomainProof(receipt);

    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("privateLeaks must be 0");
    expect(validation.errors.join("\n")).toContain("idempotencyKeyPresent=true");
    expect(validation.errors.join("\n")).toContain("externalAutoSends must be 0");
  });
});
