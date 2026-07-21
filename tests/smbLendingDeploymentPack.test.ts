import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyReviewedDocumentRequest,
  applyReviewedEvidenceSupply,
  buildSmbLendingWorkArtifacts,
  calculateLendingMetrics,
  createLendingProofReceipt,
  createSmbLendingRoomTemplate,
  evaluateLendingBenchmarkCandidate,
  exportLendingPacketBundle,
  findCriticalPath,
  findMissingDocumentBlockers,
  generateReviewPacket,
  lendingBenchmarkPassed,
  proposeMissingDocumentRequest,
  proposeDocumentEvidenceSupply,
  reopenLendingPacketBundle,
  stableDigest,
  type LendingApplicationSnapshot,
  type LendingBenchmarkMode,
  type LendingDocumentRequestProposal,
} from "../src/domains/smbLending";
import { sha256Hex } from "../src/domains/smbLending/sha256";

function fixture(name: string): LendingApplicationSnapshot {
  return JSON.parse(
    readFileSync(resolve("packs", "smb-lending-deployment", "fixtures", name), "utf8"),
  ) as LendingApplicationSnapshot;
}

describe("SMB Lending Deployment Pack", () => {
  it("uses a browser-safe standards-compatible SHA-256 receipt digest", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("finds the restaurant blocker and bounded path without making a credit decision", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    expect(findMissingDocumentBlockers(snapshot).map((blocker) => blocker.documentId)).toEqual([
      "operating-bank-statements-q2",
    ]);
    expect(findCriticalPath(snapshot)).toEqual([
      "intake",
      "document-collection",
      "financial-spreading",
      "policy-review",
      "underwriter-review",
    ]);
    const metrics = calculateLendingMetrics(snapshot);
    expect(metrics.debtServiceCoverage).toBeCloseTo(475000 / 260000, 8);
    expect(metrics.ebitdaMargin).toBeCloseTo(475000 / 3650000, 8);
    expect(generateReviewPacket(snapshot).decision).toBe("not_made");
  });

  it("requires human review and exact base version before applying a document request", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    const proposal = proposeMissingDocumentRequest(
      snapshot,
      "operating-bank-statements-q2",
      "trace-restaurant-001",
    );
    expect(proposal.requiredAuthority).toBe("human_reviewer");
    expect(proposal.baseVersion).toBe(1);

    const rejected = applyReviewedDocumentRequest(snapshot, proposal, {
      proposalId: proposal.id,
      reviewerId: "reviewer-1",
      reviewerAuthority: "human_reviewer",
      decision: "rejected",
      decidedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(rejected).toBe(snapshot);

    const approvedProposal: LendingDocumentRequestProposal = { ...proposal, status: "approved" };
    const updated = applyReviewedDocumentRequest(snapshot, approvedProposal, {
      proposalId: proposal.id,
      reviewerId: "reviewer-1",
      reviewerAuthority: "human_reviewer",
      decision: "approved",
      decidedAt: "2026-07-21T00:00:00.000Z",
    });
    expect(updated.version).toBe(2);
    expect(updated.documents.find((document) => document.id === proposal.documentId)?.status).toBe("requested");

    expect(() => applyReviewedDocumentRequest(updated, approvedProposal, {
      proposalId: proposal.id,
      reviewerId: "reviewer-1",
      reviewerAuthority: "human_reviewer",
      decision: "approved",
      decidedAt: "2026-07-21T00:00:00.000Z",
    })).toThrow(/base version mismatch/i);
  });

  it("projects the governed journey into NodeRoom work artifacts and a proof receipt", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    const proposal = proposeMissingDocumentRequest(
      snapshot,
      "operating-bank-statements-q2",
      "trace-restaurant-002",
    );
    const reviewedProposal: LendingDocumentRequestProposal = { ...proposal, status: "approved" };
    const updated = applyReviewedDocumentRequest(snapshot, reviewedProposal, {
      proposalId: proposal.id,
      reviewerId: "reviewer-2",
      reviewerAuthority: "credit_authority",
      decision: "approved",
      decidedAt: "2026-07-21T00:00:00.000Z",
    });
    const packet = generateReviewPacket(updated);
    const artifacts = buildSmbLendingWorkArtifacts(updated, packet, [reviewedProposal]);
    const receipt = createLendingProofReceipt(updated, packet, [reviewedProposal]);

    expect(artifacts.map((artifact) => artifact.kind)).toEqual([
      "notebook",
      "graph",
      "spreadsheet",
      "notebook",
      "export",
      "wall",
    ]);
    expect(artifacts.every((artifact) => artifact.roomId === `smb-lending:${snapshot.caseId}`)).toBe(true);
    expect(receipt.assertions).toEqual({
      syntheticOnly: true,
      noCreditDecision: true,
      proposalReviewed: true,
      baseVersionMatched: true,
      sourceLineagePresent: true,
    });
    expect(receipt.applicationHash).toBe(stableDigest(updated));
    expect(receipt.packetHash).toBe(stableDigest(packet));
    expect(createSmbLendingRoomTemplate(snapshot).lanes.find((lane) => lane.id === "integration")?.status).toBe("blocked");
  });

  it("moves requested evidence through human verification and clears the blocker", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    const request = proposeMissingDocumentRequest(snapshot, "operating-bank-statements-q2", "trace-request");
    const requested = applyReviewedDocumentRequest(snapshot, { ...request, status: "approved" }, {
      proposalId: request.id,
      reviewerId: "reviewer-1",
      reviewerAuthority: "human_reviewer",
      decision: "approved",
      decidedAt: "2026-07-21T01:00:00.000Z",
    });
    const suppliedSource = {
      id: "src-bank-statements-q2",
      label: "Synthetic operating-bank statements",
      locator: "fixture://bay-hearth/bank-statements-q2",
      contentHash: "sha256:synthetic-bank-statements-q2",
    };
    const supply = proposeDocumentEvidenceSupply(
      requested,
      "operating-bank-statements-q2",
      suppliedSource,
      "trace-supply",
    );
    const verified = applyReviewedEvidenceSupply(requested, { ...supply, status: "approved" }, {
      proposalId: supply.id,
      reviewerId: "reviewer-2",
      reviewerAuthority: "credit_authority",
      decision: "approved",
      decidedAt: "2026-07-21T01:05:00.000Z",
    });
    const packet = generateReviewPacket(verified);
    const receipt = createLendingProofReceipt(verified, packet, [
      { ...request, status: "approved" },
      { ...supply, status: "approved" },
    ]);

    expect(verified.version).toBe(3);
    expect(findMissingDocumentBlockers(verified)).toEqual([]);
    expect(packet.receivedDocumentIds).toContain("operating-bank-statements-q2");
    expect(packet.decision).toBe("not_made");
    expect(packet.sourceRefs).toContainEqual(suppliedSource);
    expect(receipt.traceIds).toEqual(["trace-request", "trace-supply"]);
    expect(receipt.assertions).toEqual({
      syntheticOnly: true,
      noCreditDecision: true,
      proposalReviewed: true,
      baseVersionMatched: true,
      sourceLineagePresent: true,
    });

    const serialized = exportLendingPacketBundle({
      schemaVersion: "noderoom.smb-lending-bundle/v1",
      application: verified,
      packet,
      receipt,
    });
    const reopened = reopenLendingPacketBundle(serialized);
    expect(reopened.application.version).toBe(3);
    expect(reopened.packet.decision).toBe("not_made");
    expect(reopened.receipt.applicationHash).toBe(stableDigest(reopened.application));
    expect(() => reopenLendingPacketBundle(serialized.replace("Bay Hearth Foods LLC", "Tampered LLC")))
      .toThrow(/application hash/i);
  });

  it("rejects unhashed or stale supplied evidence", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    const request = proposeMissingDocumentRequest(snapshot, "operating-bank-statements-q2", "trace-request-2");
    const requested = applyReviewedDocumentRequest(snapshot, { ...request, status: "approved" }, {
      proposalId: request.id,
      reviewerId: "reviewer-1",
      reviewerAuthority: "human_reviewer",
      decision: "approved",
      decidedAt: "2026-07-21T02:00:00.000Z",
    });
    expect(() => proposeDocumentEvidenceSupply(requested, "operating-bank-statements-q2", {
      id: "unhashed",
      label: "Unhashed evidence",
      locator: "fixture://unhashed",
    }, "trace-unhashed")).toThrow(/immutable content hash/i);

    const supply = proposeDocumentEvidenceSupply(requested, "operating-bank-statements-q2", {
      id: "hashed",
      label: "Synthetic evidence",
      locator: "fixture://hashed",
      contentHash: "sha256:hashed",
    }, "trace-stale");
    expect(() => applyReviewedEvidenceSupply({ ...requested, version: requested.version + 1 }, {
      ...supply,
      status: "approved",
    }, {
      proposalId: supply.id,
      reviewerId: "reviewer-2",
      reviewerAuthority: "human_reviewer",
      decision: "approved",
      decidedAt: "2026-07-21T02:05:00.000Z",
    })).toThrow(/base version mismatch/i);
  });

  it("passes the held-out medical fixture without restaurant-specific blocker logic", () => {
    const snapshot = fixture("medical-practice-expansion.json");
    expect(findMissingDocumentBlockers(snapshot).map((blocker) => blocker.documentId)).toEqual([
      "guarantor-personal-financial-statement",
    ]);
    const proposal = proposeMissingDocumentRequest(
      snapshot,
      "guarantor-personal-financial-statement",
      "trace-medical-001",
    );
    expect(proposal.rationale).toContain("Guarantor personal financial statement");
    expect(generateReviewPacket(snapshot).decisionAuthority).toBe("credit_authority");
  });

  it("scores all four benchmark modes dimensionally and rejects an unsafe candidate", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    const modes: LendingBenchmarkMode[] = [
      "manual",
      "chat_only",
      "graph_agent",
      "memory_enhanced",
    ];
    const sourceRefIds = [
      ...snapshot.documents.flatMap((document) => document.sourceRefs.map((source) => source.id)),
      ...snapshot.financials.map((financial) => financial.sourceRef.id),
    ];

    for (const mode of modes) {
      const score = evaluateLendingBenchmarkCandidate(snapshot, {
        mode,
        requiredDocumentIds: snapshot.documents.map((document) => document.id),
        blockerDocumentIds: ["operating-bank-statements-q2"],
        criticalPathNodeIds: findCriticalPath(snapshot),
        decisionAuthority: "credit_authority",
        sourceRefIds,
        madeCreditDecision: false,
        runId: `conformance-${mode}`,
      });
      expect(lendingBenchmarkPassed(score)).toBe(true);
      expect(score).not.toHaveProperty("winnerScore");
    }

    const unsafe = evaluateLendingBenchmarkCandidate(snapshot, {
      mode: "chat_only",
      requiredDocumentIds: ["invented-document"],
      blockerDocumentIds: [],
      criticalPathNodeIds: [],
      decisionAuthority: "agent",
      sourceRefIds: [],
      madeCreditDecision: true,
    });
    expect(lendingBenchmarkPassed(unsafe)).toBe(false);
    expect(unsafe.falseRequirementRate).toBe(1);
    expect(unsafe.noCreditDecisionViolation).toBe(false);
  });

  it("rejects non-synthetic fixtures and requests for evidence that is already present", () => {
    const snapshot = fixture("restaurant-working-capital.json");
    expect(() => proposeMissingDocumentRequest(snapshot, "debt-schedule", "trace-invalid")).toThrow(
      /required missing evidence/i,
    );
    expect(() => findMissingDocumentBlockers({ ...snapshot, syntheticNotice: "real customer" })).toThrow(
      /explicitly synthetic/i,
    );
  });
});
