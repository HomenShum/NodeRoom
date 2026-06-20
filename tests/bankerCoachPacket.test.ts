import { describe, expect, it } from "vitest";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import type { CellPayload } from "../src/engine/types";
import { buildBankerCoachPacket } from "../src/ui/bankerCoachPacket";

describe("banker coach artifact packet", () => {
  it("derives reviewable coach artifacts from live room state", () => {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);
    const research = engine.getArtifact(demo.researchId)!;
    const elementId = "rc_cardionova__summary";
    const payload: CellPayload = {
      value: "CardioNova automates hospital intake triage; deployment references still need review.",
      status: "needs_review",
      confidence: 0.76,
      evidence: [
        {
          id: "cardionova-source",
          kind: "source",
          label: "CardioNova product page",
          url: "https://cardionova.example/product",
          snippet: "AI triage workflow for hospital intake.",
          confidence: 0.76,
        },
        {
          id: "cardionova-upload",
          kind: "upload",
          label: "CardioNova deck p.12",
          sourceArtifactId: demo.noteId,
          snippet: "Cash $1.5M; burn $125k/month.",
          confidence: 0.84,
        },
      ],
    };

    engine.applyEdit({
      roomId: demo.roomId,
      actor: demo.agents.room,
      op: {
        opId: "coach-evidence",
        artifactId: demo.researchId,
        elementId,
        kind: "set",
        value: payload,
        baseVersion: research.elements[elementId].version,
      },
    });

    const packet = buildBankerCoachPacket({
      roomTitle: "JPM Startup Diligence",
      artifacts: engine.listArtifacts(demo.roomId),
      traces: engine.listTraces(demo.roomId),
    });

    expect(packet.company).toBe("CardioNova");
    expect(packet.evidenceCards[0]).toMatchObject({
      label: "CardioNova product page",
      status: "needs_review",
      targetArtifactId: demo.researchId,
      targetElementId: elementId,
    });
    expect(packet.evidenceCards.find((card) => card.label === "CardioNova deck p.12")).toMatchObject({
      sourceArtifactId: demo.noteId,
      targetArtifactId: demo.researchId,
      targetElementId: elementId,
    });
    expect(packet.cues.map((cue) => cue.id)).toContain("cue_verify_sources");
    expect(packet.runwayMilestones.map((row) => row.company)).toContain("CardioNova");
    expect(packet.reviewUpdate.subject).toContain("CardioNova");
    expect(packet.downstreamDrafts.map((draft) => draft.target)).toEqual([
      "gmail",
      "notion",
      "slack",
      "linear",
      "linkedin",
      "crm",
    ]);
  });
});
