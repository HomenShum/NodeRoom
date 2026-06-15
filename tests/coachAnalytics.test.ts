import { describe, expect, it } from "vitest";
import { setNodeRoomAnalyticsSink, type NodeRoomAnalyticsEvent } from "../src/nodeagent/analytics/coachEvents";
import { BANKER_COACH_TOOLS } from "../src/nodeagent/skills/bankerCoach/tools";

describe("coach analytics events", () => {
  it("emits structured tool events without letting observability break execution", async () => {
    const events: NodeRoomAnalyticsEvent[] = [];
    const restore = setNodeRoomAnalyticsSink((event) => {
      events.push(event);
    });
    const buildEvidence = BANKER_COACH_TOOLS.find((tool) => tool.name === "build_evidence_cards")!;

    await buildEvidence.execute({
      evidence: [{
        label: "CardioNova product page",
        sourceRef: "https://cardionova.example/product",
        quote: "Hospital intake triage",
        kind: "source",
        confidence: 0.8,
      }],
    }, undefined as never);
    restore();

    expect(events[0]).toMatchObject({
      type: "evidence_cards_built",
      toolName: "build_evidence_cards",
      ok: true,
      counts: { cards: 1 },
    });

    const restoreThrowing = setNodeRoomAnalyticsSink(() => {
      throw new Error("analytics unavailable");
    });
    await expect(buildEvidence.execute({
      evidence: [{
        label: "Manual banker note",
        quote: "Needs validation",
        kind: "manual",
      }],
    }, undefined as never)).resolves.toMatchObject({ cards: [{ status: "manual" }] });
    restoreThrowing();
  });
});
