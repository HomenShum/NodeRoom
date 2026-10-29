import { describe, expect, it } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import {
  InMemoryRoomTools,
  ROOM_TOOLS,
  runAgent,
  scriptedModel,
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
});
