import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent } from "../src/nodeagent/core/runtime";
import { buildUnifiedAgentStreamParts, type AgentStreamEventDraft, type PersistedAgentStreamEvent } from "../src/nodeagent/core/stream";
import type { AgentModel, AgentTool } from "../src/nodeagent/core/types";

describe("NodeAgent unified stream parts", () => {
  it("assembles text and tool lifecycle events into UIMessage-shaped parts", () => {
    const events: PersistedAgentStreamEvent[] = [
      { sequence: 1, kind: "message_start", status: "started", title: "Room NodeAgent", createdAt: 1 },
      { sequence: 1_000, kind: "text_delta", status: "streaming", text: "Reading the sheet. ", createdAt: 2 },
      { sequence: 1_001, kind: "tool_call_start", step: 0, toolCallId: "c1", toolName: "read_range", status: "started", input: { elementIds: ["A1"] }, createdAt: 3 },
      { sequence: 1_002, kind: "tool_call_result", step: 0, toolCallId: "c1", toolName: "read_range", status: "completed", output: { rows: 1 }, createdAt: 4 },
      { sequence: 1_003, kind: "text_delta", status: "streaming", text: "Done.", createdAt: 5 },
      { sequence: 9_000, kind: "message_done", status: "completed", createdAt: 6 },
    ];

    const parts = buildUnifiedAgentStreamParts(events, { terminal: true });

    expect(parts.map((part) => part.type)).toEqual(["text", "tool-read_range", "text"]);
    expect(parts[0]).toMatchObject({ type: "text", text: "Reading the sheet. ", state: "streaming" });
    expect(parts[1]).toMatchObject({ type: "tool-read_range", state: "output-available", toolName: "read_range", output: { rows: 1 } });
    expect(parts[2]).toMatchObject({ type: "text", text: "Done.", state: "done" });
  });

  it("emits runtime tool start/result events without changing tool execution", async () => {
    const events: AgentStreamEventDraft[] = [];
    let turn = 0;
    const model: AgentModel = {
      name: "scripted-stream-test",
      async next() {
        turn++;
        if (turn === 1) {
          return {
            text: "I will read the cell.",
            toolCalls: [{ id: "call-read", tool: "read_range", args: { elementIds: ["A1"] } }],
            done: false,
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        return { text: "The cell is ready.", toolCalls: [], done: true, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const tools: AgentTool[] = [{
      name: "read_range",
      description: "Read cells",
      schema: z.object({ elementIds: z.array(z.string()) }),
      execute: async (args) => ({ ok: true, count: args.elementIds.length }),
    }];

    const result = await runAgent({
      rt: {} as never,
      goal: "read A1",
      model,
      tools,
      maxSteps: 2,
      initialMessages: [{ role: "user", content: "read A1" }],
      onStreamEvent: (event) => { events.push(event); },
    });

    expect(result.finalText).toBe("The cell is ready.");
    expect(events.map((event) => event.kind)).toEqual(expect.arrayContaining(["step_start", "tool_call_start", "tool_call_result"]));
    expect(events.find((event) => event.kind === "tool_call_start")).toMatchObject({ toolCallId: "call-read", toolName: "read_range" });
    expect(events.find((event) => event.kind === "tool_call_result")).toMatchObject({ status: "completed", output: { ok: true, count: 1 } });
  });

  it("reconciles final text when message_done contains a longer materialized answer", () => {
    const parts = buildUnifiedAgentStreamParts([
      { sequence: 1, kind: "text_delta", text: "Partial", status: "streaming", createdAt: 1 },
      { sequence: 2, kind: "message_done", text: "Partial answer complete.", status: "completed", createdAt: 2 },
    ], { terminal: true });

    expect(parts).toEqual([{ type: "text", text: "Partial answer complete.", state: "done" }]);
  });
});
