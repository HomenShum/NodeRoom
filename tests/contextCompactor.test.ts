import { describe, expect, it } from "vitest";
import { compactMessages, estimateChars } from "../src/nodeagent/core/contextCompactor";
import type { AgentMessage } from "../src/nodeagent/core/types";

describe("context compactor", () => {
  it("elides oversized recent read_range tool results instead of carrying them into the next slice", async () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "Run the official benchmark task." },
      { role: "assistant", content: "", toolCalls: [{ id: "read-1", tool: "read_range", args: { elementIds: ["A1"] } }] },
      { role: "tool", toolCallId: "read-1", toolName: "read_range", content: "x".repeat(50_000) },
      { role: "assistant", content: "I found the workbook data and should now create the package." },
    ];

    const before = estimateChars(messages);
    const compacted = await compactMessages(messages, { maxChars: 1_000, keepRecent: 10 });

    expect(before).toBeGreaterThan(50_000);
    expect(compacted.compacted).toBe(true);
    expect(compacted.elided).toBe(1);
    expect(compacted.after).toBeLessThan(1_000);
    expect(compacted.messages).toHaveLength(messages.length);
    expect(compacted.messages[2]).toMatchObject({
      role: "tool",
      toolCallId: "read-1",
      toolName: "read_range",
    });
    expect(compacted.messages[2]?.content).toContain("not evidence that source data is missing");
  });
});
