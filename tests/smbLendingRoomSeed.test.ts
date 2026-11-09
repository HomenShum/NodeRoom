import { describe, expect, it } from "vitest";

import { createSmbLendingConvexSeed, SMB_LENDING_PROPOSAL } from "../src/app/smbLendingRoomSeed";

describe("SMB Lending Deployment Room seed", () => {
  it("builds the live Convex template with eight artifacts and a pinned first proposal", () => {
    const live = createSmbLendingConvexSeed();
    expect(live.artifacts.map((artifact) => artifact.title)).toEqual([
      "Application notebook",
      "Evidence checklist",
      "Lending process graph",
      "Underwriting workbook",
      "Proposal review",
      "Proof receipt",
      "Human review credit packet",
      "Export bundle",
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
});

