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

  it("does not mark successful tool results failed just because error is undefined", async () => {
    const events: AgentStreamEventDraft[] = [];
    const model: AgentModel = {
      name: "scripted-undefined-error-test",
      async next() {
        return {
          text: "capturing",
          toolCalls: [{ id: "call-capture", tool: "capture_source", args: { url: "https://example.com" } }],
          done: false,
          usage: { inputTokens: 1, outputTokens: 1 },
        };
      },
    };
    const tools: AgentTool[] = [{
      name: "capture_source",
      description: "Capture source",
      schema: z.object({ url: z.string() }),
      execute: async () => ({ ok: true, data: { value: 42 }, error: undefined }),
    }];

    const result = await runAgent({
      rt: {} as never,
      goal: "capture source",
      model,
      tools,
      maxSteps: 1,
      initialMessages: [{ role: "user", content: "capture source" }],
      onStreamEvent: (event) => { events.push(event); },
    });

    expect(result.stopReason).toBe("step_budget");
    expect(events.find((event) => event.kind === "tool_call_result")).toMatchObject({
      status: "completed",
      output: { ok: true, data: { value: 42 }, error: undefined },
    });
  });

  it("feeds invalid tool arguments back as recoverable structured errors", async () => {
    const events: AgentStreamEventDraft[] = [];
    let turn = 0;
    const seenToolMessages: string[] = [];
    const model: AgentModel = {
      name: "scripted-invalid-tool-recovery-test",
      async next({ messages }) {
        turn++;
        seenToolMessages.push(...messages.filter((message) => message.role === "tool").map((message) => message.content));
        if (turn === 1) {
          return {
            text: "I will search the sheet.",
            toolCalls: [{ id: "call-bad-search", tool: "search_sheet_context", args: {} }],
            done: false,
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        if (turn === 2) {
          return {
            text: "Retrying with the missing query.",
            toolCalls: [{ id: "call-good-search", tool: "search_sheet_context", args: { query: "revenue growth" } }],
            done: false,
            usage: { inputTokens: 1, outputTokens: 1 },
          };
        }
        return { text: "Recovered.", toolCalls: [], done: true, usage: { inputTokens: 1, outputTokens: 1 } };
      },
    };
    const tools: AgentTool[] = [{
      name: "search_sheet_context",
      description: "Search sheet context",
      schema: z.object({ query: z.string() }),
      execute: async (args) => ({ ok: true, query: args.query }),
    }];

    const result = await runAgent({
      rt: {} as never,
      goal: "search revenue growth",
      model,
      tools,
      maxSteps: 3,
      initialMessages: [{ role: "user", content: "search revenue growth" }],
      onStreamEvent: (event) => { events.push(event); },
    });

    expect(result.stopReason).toBe("done");
    expect(result.trace[0]?.result).toMatchObject({
      ok: false,
      error: "tool_argument_error",
      failureKind: "missing_required_arg",
      missingRequiredArgs: ["query"],
      recovery: { action: "retry_tool_call" },
    });
    expect(result.trace[1]?.result).toMatchObject({ ok: true, query: "revenue growth" });
    expect(seenToolMessages.join("\n")).toContain("tool_argument_error");
    expect(events.find((event) => event.kind === "tool_call_result" && event.toolCallId === "call-bad-search")).toMatchObject({
      status: "failed",
      output: expect.objectContaining({ failureKind: "missing_required_arg" }),
    });
  });

  it("reconciles final text when message_done contains a longer materialized answer", () => {
    const parts = buildUnifiedAgentStreamParts([
      { sequence: 1, kind: "text_delta", text: "Partial", status: "streaming", createdAt: 1 },
      { sequence: 2, kind: "message_done", text: "Partial answer complete.", status: "completed", createdAt: 2 },
    ], { terminal: true });

    expect(parts).toEqual([{ type: "text", text: "Partial answer complete.", state: "done" }]);
  });
});
