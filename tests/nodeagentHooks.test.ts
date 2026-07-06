import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import {
  createFreshContextJudgeHook,
  FRESH_CONTEXT_JUDGE_MARKER,
  InMemoryRoomTools,
  planNodeAgentFanout,
  ROOM_TOOLS,
  runAgent,
  scriptedModel,
  type AgentTool,
  type NodeAgentHook,
} from "../src/nodeagent/index";

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { rt };
}

describe("nodeagent runtime hooks", () => {
  it("blocks a tool call before RoomTools execution and returns a tool receipt to the model", async () => {
    const { rt } = setup();
    const hooks: NodeAgentHook[] = [{
      preTool: async (_ctx, call) => call.tool === "read_range"
        ? {
            blocked: true,
            reason: "private source artifact is not public-room safe",
            failureKind: "private_context_blocked",
            recovery: "Use list_artifacts and request a public source ref before reading.",
          }
        : call,
    }];
    const model = scriptedModel(({ messages }) => {
      const sawBlocked = messages.some((message) => message.role === "tool" && message.content.includes("tool_blocked"));
      return sawBlocked
        ? { say: "Blocked by policy.", done: true }
        : { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_rev__variance"] } }] };
    });

    const result = await runAgent({
      rt,
      goal: "read the private source",
      model,
      tools: ROOM_TOOLS,
      hooks,
      maxSteps: 3,
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalText).toBe("Blocked by policy.");
    expect(result.trace[0]).toMatchObject({
      tool: "read_range",
      result: {
        ok: false,
        error: "tool_blocked",
        failureKind: "private_context_blocked",
      },
    });
  });

  it("runs postTool hooks after recording a successful tool result", async () => {
    const { rt } = setup();
    const observed: Array<{ tool: string; result: unknown; traceCount: number }> = [];
    const hooks: NodeAgentHook[] = [{
      postTool: async (ctx, call, result) => {
        observed.push({ tool: call.tool, result, traceCount: ctx.trace.length });
      },
    }];
    const model = scriptedModel(({ messages }) => {
      const read = messages.some((message) => message.role === "tool" && message.toolName === "read_range");
      return read
        ? { say: "Read receipt recorded.", done: true }
        : { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_rev__variance"] } }] };
    });

    const result = await runAgent({
      rt,
      goal: "read the range",
      model,
      tools: ROOM_TOOLS,
      hooks,
      maxSteps: 3,
    });

    expect(result.stopReason).toBe("done");
    expect(observed).toHaveLength(1);
    expect(observed[0].tool).toBe("read_range");
    expect(Array.isArray(observed[0].result)).toBe(true);
    expect(observed[0].traceCount).toBe(1);
  });

  it("uses the fresh-context judge to reject chat-only completion until a required tool receipt exists", async () => {
    const { rt } = setup();
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final benchmark package.",
      schema: z.object({}),
      execute: async () => ({ ok: true, artifacts: [{ title: "package.xlsx" }] }),
    };
    const model = scriptedModel(({ messages }) => {
      const sawJudge = messages.some((message) => message.role === "user" && message.content.startsWith(FRESH_CONTEXT_JUDGE_MARKER));
      const packaged = messages.some((message) => message.role === "tool" && message.toolName === "create_btb_deliverable_package");
      if (!sawJudge) return { say: "The benchmark is complete.", done: true };
      if (!packaged) return { toolCalls: [{ tool: "create_btb_deliverable_package", args: {} }] };
      return { say: "Package receipt exists.", done: true };
    });

    const result = await runAgent({
      rt,
      goal: "official proof benchmark",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      hooks: [createFreshContextJudgeHook({
        requiredTools: [{
          name: "create_btb_deliverable_package",
          reason: "official benchmark package receipt required",
        }],
      })],
      maxSteps: 4,
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalText).toBe("Package receipt exists.");
    expect(result.trace.some((event) => event.tool === "create_btb_deliverable_package")).toBe(true);
    expect(result.messages.some((message) =>
      message.role === "user" && message.content.startsWith(FRESH_CONTEXT_JUDGE_MARKER),
    )).toBe(true);
  });
});

describe("nodeagent fanout planner", () => {
  it("plans BTB fresh-room work as receipt-backed NodeRoom subagents", () => {
    const plan = planNodeAgentFanout({
      goal: "Run BankerToolBench btb-abc123 in a fresh room with visual proof",
      artifactKinds: ["sheet"],
      focusMode: true,
      maxParallel: 3,
    });
    const roles = plan.subagents.map((subagent) => subagent.role);

    expect(plan.mode).toBe("fanout");
    expect(plan.focusModeRequired).toBe(true);
    expect(roles).toEqual(expect.arrayContaining([
      "intake",
      "evidence",
      "spreadsheet",
      "formula_audit",
      "deck_memo",
      "privacy_security",
      "browser_proof",
      "fresh_context_judge",
    ]));
    expect(plan.receiptContract).toEqual(expect.arrayContaining([
      "agentJobId",
      "inputRefs",
      "toolCalls",
      "evidenceFacts",
      "mutationReceipts",
      "cost",
      "latency",
      "verdict",
    ]));
    expect(plan.waves.at(0)).toEqual(["coordinator"]);
    expect(plan.waves.at(-1)).toEqual(["fresh_context_judge"]);
  });

  it("keeps notebook subagents on proposal/read-model rails instead of direct ProseMirror mutation", () => {
    const plan = planNodeAgentFanout({
      goal: "Update the room notebook from source evidence",
      artifactKinds: ["note"],
    });
    const notebook = plan.subagents.find((subagent) => subagent.role === "notebook_proposal");

    expect(notebook?.mutationMode).toBe("proposal_only");
    expect(notebook?.goal).toContain("never mutate human-owned ProseMirror text directly");
  });

  it("plans autonomous credit approval as parallel policy, validation, compliance, and live-proof subagents", () => {
    const plan = planNodeAgentFanout({
      goal: "Get an autonomous credit approval model with delegated approval, adverse action, fair lending, and model risk receipts done",
      maxParallel: 6,
    });
    const roles = plan.subagents.map((subagent) => subagent.role);

    expect(plan.mode).toBe("fanout");
    expect(plan.reason).toContain("Autonomous credit approval requires parallel");
    expect(roles).toEqual(expect.arrayContaining([
      "credit_policy",
      "credit_data",
      "credit_features",
      "credit_model",
      "reject_inference",
      "fair_lending",
      "adverse_action",
      "model_risk_management",
      "credit_live_proof",
      "delegated_authority",
      "browser_proof",
      "fresh_context_judge",
    ]));
    expect(plan.waves.some((wave) => wave.length >= 4)).toBe(true);
    expect(plan.subagents.find((subagent) => subagent.role === "delegated_authority")?.goal).toContain("authority limits");
  });

  it("plans actuarial and multi-angle statistical prediction as parallel forecast subagents", () => {
    const plan = planNodeAgentFanout({
      goal: "Run an actuarial multi-angle statistical prediction forecast like AI-2027 with base rates, calibration, backtest, and stress tests",
      maxParallel: 5,
    });
    const roles = plan.subagents.map((subagent) => subagent.role);

    expect(plan.mode).toBe("fanout");
    expect(plan.reason).toContain("Actuarial and multi-angle statistical prediction");
    expect(roles).toEqual(expect.arrayContaining([
      "actuarial_data",
      "frequency_severity",
      "survival_default",
      "scenario_forecast",
      "calibration_backtest",
      "uncertainty_sensitivity",
      "forecast_red_team",
      "browser_proof",
      "fresh_context_judge",
    ]));
    expect(plan.subagents.find((subagent) => subagent.role === "scenario_forecast")?.goal).toContain("AI-2027-style");
  });
});
