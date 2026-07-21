import { describe, expect, it } from "vitest";

import { engine, enterSmbLendingDeploymentRoomAsHost, handleSmbLendingLocalProposalResolution } from "../src/app/roomStore";
import { createSmbLendingConvexSeed, SMB_LENDING_EVIDENCE_PROPOSAL, SMB_LENDING_EVIDENCE_SOURCE, SMB_LENDING_PROPOSAL, SMB_LENDING_TEMPLATE, SMB_LENDING_VERIFIED_RECEIPT } from "../src/app/smbLendingRoomSeed";

describe("SMB Lending Deployment Room seed", () => {
  it("builds the live Convex template with seven artifacts and a pinned first proposal", () => {
    const live = createSmbLendingConvexSeed();
    expect(live.artifacts.map((artifact) => artifact.title)).toEqual([
      "Application notebook",
      "Evidence checklist",
      "Lending process graph",
      "Underwriting workbook",
      "Proposal review",
      "Proof receipt",
      "Human review credit packet",
    ]);
    expect(live.proposals).toHaveLength(1);
    expect(live.proposals[0]).toMatchObject({
      artifactIndex: 1,
      op: {
        opId: SMB_LENDING_PROPOSAL.id,
        elementId: `${SMB_LENDING_PROPOSAL.documentId}__status`,
        value: "requested",
        baseVersion: 1,
      },
    });
    expect(live.artifacts[1].seed.some((element) => element.id === live.proposals[0].op.elementId && element.value === "missing")).toBe(true);
  });

  it("mounts the synthetic governed lending workflow in the existing NodeRoom shell", () => {
    const session = enterSmbLendingDeploymentRoomAsHost();
    const room = engine.getRoom(session.roomId);
    const artifacts = engine.listArtifacts(session.roomId);
    const messages = engine.listMessages(session.roomId, "public");
    const traces = engine.listTraces(session.roomId);
    const proposals = engine.listProposals(session.roomId);
    const roomText = artifacts.map(artifactText).join("\n");

    expect(room?.title).toBe(SMB_LENDING_TEMPLATE.title);
    expect(artifacts.map((artifact) => artifact.title)).toEqual(expect.arrayContaining([
      "Application notebook",
      "Evidence checklist",
      "Lending process graph",
      "Underwriting workbook",
      "Proposal review",
      "Proof receipt",
    ]));
    expect(roomText).toContain("Bay Hearth Foods LLC");
    expect(roomText).toContain("Most recent three operating-bank statements");
    expect(roomText).toContain("no credit decision");
    expect(roomText).toContain(SMB_LENDING_PROPOSAL.id);
    expect(messages.some((message) => message.author.kind === "agent" && message.text.includes("version-pinned"))).toBe(true);
    expect(traces.some((trace) => trace.summary.includes("missing-bank-statements blocker"))).toBe(true);
    expect(traces.some((trace) => trace.summary.includes(SMB_LENDING_PROPOSAL.id))).toBe(true);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].op.opId).toBe(SMB_LENDING_PROPOSAL.id);
    expect(proposals[0].op.value).toBe("requested");

    const applied = engine.resolveProposal(proposals[0].id, true, session.me);
    expect(applied?.ok).toBe(true);
    handleSmbLendingLocalProposalResolution(proposals[0], true, session.me);
    const evidenceProposals = engine.listProposals(session.roomId);
    expect(evidenceProposals).toHaveLength(1);
    expect(evidenceProposals[0].op.opId).toBe(SMB_LENDING_EVIDENCE_PROPOSAL.id);
    expect(engine.getArtifact(proposals[0].artifactId)?.elements[proposals[0].op.elementId]?.value).toBe("requested");
    expect(engine.getProposal(proposals[0].id)?.status).toBe("approved");

    const evidenceApplied = engine.resolveProposal(evidenceProposals[0].id, true, session.me);
    expect(evidenceApplied?.ok).toBe(true);
    handleSmbLendingLocalProposalResolution(evidenceProposals[0], true, session.me);
    expect(engine.listProposals(session.roomId)).toHaveLength(0);

    const checklist = engine.getArtifact(proposals[0].artifactId);
    expect(checklist?.elements[`${SMB_LENDING_PROPOSAL.documentId}__status`]?.value).toBe("verified");
    expect(checklist?.elements[`${SMB_LENDING_PROPOSAL.documentId}__source`]?.value).toContain(SMB_LENDING_EVIDENCE_SOURCE.contentHash);
    expect(checklist?.elements[`${SMB_LENDING_PROPOSAL.documentId}__locator`]?.value).toBe(SMB_LENDING_EVIDENCE_SOURCE.locator);

    const finalRoomText = engine.listArtifacts(session.roomId).map(artifactText).join("\n");
    expect(finalRoomText).toContain(SMB_LENDING_VERIFIED_RECEIPT.applicationHash);
    expect(finalRoomText).toContain(SMB_LENDING_VERIFIED_RECEIPT.packetHash);
    expect(finalRoomText).toContain("Required-document blockers:</b> 0");
    expect(finalRoomText).toContain("Decision:</b> not_made");
  });
});

function artifactText(artifact: ReturnType<typeof engine.listArtifacts>[number]): string {
  const values = Object.values(artifact.elements ?? {}).map((element) => String(element.value ?? ""));
  return [artifact.title, artifact.meta?.summary, ...values].filter(Boolean).join("\n");
}
