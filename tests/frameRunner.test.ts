import { describe, expect, it } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import {
  InMemoryRoomTools,
  ROOM_TOOLS,
  runReasoningFrame,
  scriptedModel,
  type AgentModel,
  type ReasoningFrame,
} from "../src/nodeagent/index";

function setup() {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
  return { rt };
}

function fundingFrame(overrides: Partial<ReasoningFrame> = {}): ReasoningFrame {
  return {
    frameId: "rf_test_funding",
    goal: "Resolve funding evidence for CardioNova.",
    phase: "execute",
    status: "pending",
    contextPack: {
      globalGoal: "Fill startup diligence fields.",
      parentSummary: "Plan chose one stale/missing funding facet.",
      currentArtifactDigest: "artifact:sheet_123; mode:agent_fill; entities:1; facets:1",
      relevantOkfConceptIds: ["okf:startup_funding"],
      relevantCacheKeys: ["entityResearchCache:company:cardionova:funding"],
      openQuestions: ["Missing funding for CardioNova"],
      constraints: ["Use cache and OKF before provider calls.", "Do not guess unsupported claims."],
      expectedOutputSchema: "entity_facet_result_with_evidence_v1",
    },
    toolAllowlist: ["read_range", "say", "entityResearchCache.lookup"],
    evidenceState: {
      required: ["source URL", "freshness timestamp"],
      availableRefs: [],
      missingRefs: ["entityResearchCache:company:cardionova:funding"],
      staleRefs: [],
    },
    ...overrides,
  };
}

describe("reasoning frame runner", () => {
  it("wraps runAgent with frame context and the frame tool allowlist", async () => {
    const { rt } = setup();
    const seen: { toolNames?: string[]; context?: string } = {};
    const model: AgentModel = {
      name: "capture-frame-model",
      async next(input) {
        seen.toolNames = input.tools.map((tool) => tool.name);
        seen.context = input.messages.map((message) => message.content).join("\n\n");
        return {
          text: "Funding frame completed with cited cache output.",
          toolCalls: [],
          done: true,
          usage: { inputTokens: 10, outputTokens: 6 },
        };
      },
    };

    const receipt = await runReasoningFrame({
      rt,
      frame: fundingFrame(),
      model,
      tools: ROOM_TOOLS,
      maxSteps: 1,
    });

    expect(seen.toolNames).toEqual(["read_range", "say"]);
    expect(seen.context).toContain("NODEAGENT REASONING FRAME");
    expect(seen.context).toContain("Frame ID: rf_test_funding");
    expect(seen.context).toContain("Expected output schema: entity_facet_result_with_evidence_v1");
    expect(seen.context).toContain("LIVE ROOM CONTEXT FOR THIS FRAME");
    expect(seen.context).toContain("SPREADSHEET");
    expect(receipt.missingToolNames).toEqual(["entityResearchCache.lookup"]);
    expect(receipt.status).toBe("completed");
    expect(receipt.updatedFrame.status).toBe("completed");
    expect(receipt.stateDelta.cacheKeysTouched).toContain("entityResearchCache:company:cardionova:funding");
    expect(receipt.stateDelta.okfConceptIdsTouched).toContain("okf:startup_funding");
  });

  it("classifies an unfinished frame as blocked with a resumable handoff", async () => {
    const { rt } = setup();
    const frame = fundingFrame({
      frameId: "rf_test_verify",
      phase: "verify",
      goal: "Verify funding evidence before synthesis.",
      toolAllowlist: ["read_range"],
    });

    const receipt = await runReasoningFrame({
      rt,
      frame,
      model: scriptedModel(() => ({ toolCalls: [{ tool: "read_range", args: { elementIds: ["r_rev__variance"] } }] })),
      tools: ROOM_TOOLS,
      maxSteps: 1,
    });

    expect(receipt.agentResult.stopReason).toBe("step_budget");
    expect(receipt.status).toBe("blocked");
    expect(receipt.verification.blockedReason).toContain("Paused after reaching the 1-step budget.");
    expect(receipt.stateDelta.openQuestions).toEqual(["Missing funding for CardioNova"]);
    expect(receipt.stateDelta.nextActions).toEqual(["Resume frame from step_budget handoff."]);
    expect(receipt.updatedFrame.status).toBe("blocked");
  });
});
