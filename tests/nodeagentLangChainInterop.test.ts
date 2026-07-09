import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createLangChainAgentModel,
  normalizeLangChainModelOutput,
  roomToolAsLangChainTool,
  runAgent,
  toLangChainMessages,
  type AgentTool,
  type LangChainChatModelLike,
  type RoomTools,
} from "../src/nodeagent";

describe("NodeAgent LangChain interop", () => {
  it("converts messages, tool calls, tool results, usage, and provider metadata", () => {
    const messages = toLangChainMessages("system prompt", [
      { role: "user", content: "read the source" },
      {
        role: "assistant",
        content: "calling tool",
        toolCalls: [{ id: "call-1", tool: "lookup", args: { q: "ARR" }, providerMetadata: { signature: "abc" } }],
      },
      { role: "tool", content: "{\"ok\":true}", toolCallId: "call-1", toolName: "lookup" },
    ]);

    expect(messages).toMatchObject([
      { role: "system", content: "system prompt" },
      { role: "user", content: "read the source" },
      { role: "assistant", tool_calls: [{ id: "call-1", name: "lookup", args: { q: "ARR" } }] },
      { role: "tool", tool_call_id: "call-1", name: "lookup" },
    ]);

    const step = normalizeLangChainModelOutput({
      content: [{ type: "text", text: "done" }],
      tool_calls: [{ id: "call-2", name: "write_note", args: { text: "ok" }, additional_kwargs: { provider: "fake" } }],
      usage_metadata: { input_tokens: 12, output_tokens: 4, cached_input_tokens: 3 },
    });

    expect(step).toMatchObject({
      text: "done",
      done: false,
      usage: { inputTokens: 12, outputTokens: 4, cachedInputTokens: 3 },
      toolCalls: [{ id: "call-2", tool: "write_note", args: { text: "ok" }, providerMetadata: { provider: "fake" } }],
    });
  });

  it("drives the NodeAgent loop with a fake LangChain chat model", async () => {
    const calls: unknown[] = [];
    const fakeModel: LangChainChatModelLike = {
      model: "gpt-5.4-mini",
      bindTools(tools) {
        expect(tools.map((tool) => tool.name)).toContain("echo_tool");
        return this;
      },
      async invoke(input) {
        calls.push(input);
        const messages = input as Array<{ role?: string }>;
        if (messages.some((message) => message.role === "tool")) {
          return { content: "LangChain route complete.", usage_metadata: { input_tokens: 6, output_tokens: 3 } };
        }
        return {
          content: "Using governed tool.",
          tool_calls: [{ id: "lc-call-1", name: "echo_tool", args: { text: "hello" } }],
          usage_metadata: { input_tokens: 8, output_tokens: 2 },
        };
      },
    };
    const tool: AgentTool = {
      name: "echo_tool",
      description: "Echoes text through RoomTools governance.",
      schema: z.object({ text: z.string() }),
      async execute(args) {
        return { ok: true, echoed: args.text };
      },
    };

    const result = await runAgent({
      rt: {} as RoomTools,
      goal: "Report using the echo tool.",
      model: createLangChainAgentModel(fakeModel),
      tools: [tool],
      maxSteps: 3,
      contextBuilder: async () => [{ role: "user", content: "Use echo_tool once." }],
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalText).toBe("LangChain route complete.");
    expect(result.trace.map((event) => event.tool)).toContain("echo_tool");
    expect(calls).toHaveLength(2);
  });

  it("wraps governed RoomTools-backed tools without direct mutation access", async () => {
    const tool: AgentTool = {
      name: "governed_write",
      description: "Writes only through the supplied RoomTools port.",
      schema: z.object({ value: z.string() }),
      async execute(args, rt) {
        await rt.say(`writing ${args.value}`);
        return { ok: true };
      },
    };
    const said: string[] = [];
    const wrapped = roomToolAsLangChainTool(tool, { say: async (text) => { said.push(text); } } as RoomTools);

    await wrapped.invoke?.({ value: "A1" });

    expect(said).toEqual(["writing A1"]);
  });
});
