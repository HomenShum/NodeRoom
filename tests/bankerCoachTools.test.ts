import { describe, expect, it } from "vitest";
import {
  InMemoryRoomTools,
  MANAGED_LOCK_SYSTEM_PROMPT,
  PRODUCTION_ROOM_TOOLS,
  lastVersions,
  runAgent,
  scriptedModel,
  type AgentMessage,
} from "../src/nodeagent/index";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";

const TARGET_CELL = "r_rev__note";
const REQUIRED_TOOLS = [
  "build_evidence_cards",
  "compute_runway_milestones",
  "validate_chart_against_source_cells",
  "render_chart_artifact",
  "generate_banker_coach_cues",
  "create_review_round_update",
  "export_downstream_draft",
];

function hasToolResult(messages: AgentMessage[], toolName: string): boolean {
  return messages.some((message) => message.role === "tool" && message.toolName === toolName);
}

function toolResult<T>(messages: AgentMessage[], toolName: string): T | null {
  const message = [...messages].reverse().find((item) => item.role === "tool" && item.toolName === toolName);
  if (!message) return null;
  try {
    return JSON.parse(message.content) as T;
  } catch {
    return null;
  }
}

function bankerCoachPlanner() {
  return ({ messages }: { messages: AgentMessage[] }) => {
    const versions = lastVersions(messages);
    if (versions[TARGET_CELL] === undefined) {
      return { toolCalls: [{ tool: "read_range", args: { elementIds: [TARGET_CELL] } }] };
    }
    if (!hasToolResult(messages, "compute_runway_milestones")) {
      return {
        toolCalls: [{
          tool: "compute_runway_milestones",
          args: {
            company: "CardioNova",
            cashUsd: 1_500_000,
            monthlyBurnUsd: 125_000,
            source: "cardionova-deck.pdf#page=12",
          },
        }],
      };
    }
    if (!hasToolResult(messages, "validate_chart_against_source_cells")) {
      return {
        toolCalls: [{
          tool: "validate_chart_against_source_cells",
          args: {
            sourceCells: { cardionova__runway: 12 },
            series: [{ label: "CardioNova runway", value: 12, sourceRef: "cardionova__runway" }],
          },
        }],
      };
    }
    if (!hasToolResult(messages, "build_evidence_cards")) {
      return {
        toolCalls: [{
          tool: "build_evidence_cards",
          args: {
            evidence: [
              {
                label: "CardioNova deck p.12",
                sourceRef: "cardionova-deck.pdf#page=12",
                quote: "Cash $1.5M; burn $125k/month",
                kind: "upload",
                confidence: 0.86,
                status: "verified",
              },
            ],
          },
        }],
      };
    }
    const evidence = toolResult<{ cards: Array<Record<string, unknown>> }>(messages, "build_evidence_cards");
    if (!hasToolResult(messages, "generate_banker_coach_cues") && evidence) {
      return {
        toolCalls: [{
          tool: "generate_banker_coach_cues",
          args: {
            company: "CardioNova",
            claim: "AI triage workflow has 12.0 months runway from uploaded cash and burn assumptions.",
            evidenceCards: evidence.cards,
            runwayMonths: 12,
            status: "needs_review",
          },
        }],
      };
    }
    const runway = toolResult<{ chartSvg: string; sourceRefs: string[] }>(messages, "compute_runway_milestones");
    if (!hasToolResult(messages, "render_chart_artifact") && runway) {
      return {
        toolCalls: [{
          tool: "render_chart_artifact",
          args: {
            title: "CardioNova runway chart",
            chartSvg: runway.chartSvg,
            narrative: "12.0 months runway from uploaded cash and burn assumptions.",
            sourceRefs: runway.sourceRefs,
          },
        }],
      };
    }
    if (!hasToolResult(messages, "create_review_round_update")) {
      return {
        toolCalls: [{
          tool: "create_review_round_update",
          args: {
            roomTitle: "Startup Banking Diligence War Room",
            company: "CardioNova",
            materialChanges: ["Runway computed at 12.0 months from uploaded deck assumptions."],
            openQuestions: ["Verify current cash balance and hospital deployment references."],
            nextActions: ["Route to host review before downstream handoff."],
            sourceRefs: ["cardionova-deck.pdf#page=12"],
          },
        }],
      };
    }
    if (!hasToolResult(messages, "export_downstream_draft")) {
      return {
        toolCalls: [{
          tool: "export_downstream_draft",
          args: {
            artifact: {
              id: "cardionova-runway",
              title: "CardioNova runway diligence",
              kind: "runway_chart",
              body: "CardioNova runway: 12.0 months; host review required.",
              sourceArtifactIds: ["research-sheet", "runway-chart"],
              sourceUrls: ["cardionova-deck.pdf#page=12"],
              createdAt: 1_780_000_000_000,
            },
            destinations: ["gmail", "notion", "crm_csv"],
          },
        }],
      };
    }
    if (!hasToolResult(messages, "write_locked_cell_result")) {
      return {
        toolCalls: [{
          tool: "write_locked_cell_result",
          args: {
            elementId: TARGET_CELL,
            value: "CardioNova coach packet ready: runway, evidence, review update, and downstream drafts prepared.",
            baseVersion: versions[TARGET_CELL],
            status: "needs_review",
            confidence: 0.86,
            evidence: [{
              kind: "upload",
              label: "CardioNova deck p.12",
              source: "cardionova-deck.pdf#page=12",
              snippet: "Cash $1.5M; burn $125k/month",
            }],
            reason: "banker coach packet",
          },
        }],
      };
    }
    return { say: "Banker coach packet prepared and filed for review.", done: true };
  };
}

describe("banker coach production tools", () => {
  it("exposes banker diligence tools in the production registry", () => {
    const names = PRODUCTION_ROOM_TOOLS.map((tool) => tool.name);
    for (const name of REQUIRED_TOOLS) expect(names).toContain(name);
  });

  it("runs coach artifacts through the actual agent harness before managed CAS write", async () => {
    const engine = new RoomEngine();
    const room = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, room.roomId, room.sheetId, room.agents.room, room.sessions.room);

    const result = await runAgent({
      rt,
      goal: "Prepare a CardioNova banker coach packet with runway, evidence, review update, and downstream drafts.",
      model: scriptedModel(bankerCoachPlanner(), "banker-coach-scripted"),
      tools: PRODUCTION_ROOM_TOOLS,
      systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
      maxSteps: 14,
    });

    const traceTools = result.trace.map((event) => event.tool);
    expect(traceTools).toEqual([
      "read_range",
      "compute_runway_milestones",
      "validate_chart_against_source_cells",
      "build_evidence_cards",
      "generate_banker_coach_cues",
      "render_chart_artifact",
      "create_review_round_update",
      "export_downstream_draft",
      "write_locked_cell_result",
    ]);
    expect(result.exhausted).toBe(false);

    const value = engine.getArtifact(room.sheetId)?.elements[TARGET_CELL]?.value as { value?: string; evidence?: unknown[]; status?: string };
    expect(value.value).toContain("coach packet ready");
    expect(value.status).toBe("needs_review");
    expect(value.evidence).toHaveLength(1);
  });
});
