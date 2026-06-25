/** Context compaction — unit (shrinks stale reads, preserves structure) + integration (doesn't break a run). */
import { describe, it, expect } from "vitest";
import { compactMessages, estimateChars } from "../src/nodeagent/core/contextCompactor";
import type { AgentMessage } from "../src/nodeagent/core/types";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools, ROOM_TOOLS, runAgent, scriptedModel } from "../src/nodeagent/index";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";

function syntheticHistory(reads: number): AgentMessage[] {
  const msgs: AgentMessage[] = [{ role: "user", content: "TASK + snapshot " + "x".repeat(200) }];
  for (let i = 0; i < reads; i++) {
    msgs.push({ role: "assistant", content: "", toolCalls: [{ id: "c" + i, tool: "read_range", args: { elementIds: ["r" + i] } }] });
    msgs.push({ role: "tool", toolCallId: "c" + i, toolName: "read_range", content: JSON.stringify([{ id: "r" + i, value: "", version: 1, locked: null }]) + "y".repeat(300) });
  }
  msgs.push({ role: "assistant", content: "all done" });
  return msgs;
}

describe("context compaction", () => {
  it("elides stale read_range results while preserving every message envelope", async () => {
    const msgs = syntheticHistory(10);
    const before = estimateChars(msgs);
    const r = await compactMessages(msgs, { maxChars: 800, keepRecent: 4 });

    expect(r.compacted).toBe(true);
    expect(r.after).toBeLessThan(before);          // it shrank
    expect(r.elided).toBeGreaterThan(0);           // stale reads were elided
    expect(r.messages.length).toBe(msgs.length);   // pairing preserved — no message dropped
    expect(r.messages[0]).toBe(msgs[0]);           // head (task + snapshot) kept verbatim
    expect(r.messages.at(-1)).toEqual(msgs.at(-1)); // final assistant text kept verbatim
    // an early read in the middle is now a stub, not the fat JSON array
    const earlyTool = r.messages.find((m, i) => i > 0 && i < msgs.length - 4 && m.role === "tool");
    expect(earlyTool?.content).toContain("compacted");
  });

  it("no-ops when the history is already small", async () => {
    const r = await compactMessages(syntheticHistory(1), { maxChars: 50_000 });
    expect(r.compacted).toBe(false);
  });

  it("preserves provider metadata on tool calls during compaction", async () => {
    const msgs = syntheticHistory(10);
    msgs[1] = {
      role: "assistant",
      content: "",
      toolCalls: [{
        id: "gemini-call",
        tool: "read_range",
        args: { elementIds: ["r0"] },
        providerMetadata: { geminiThoughtSignature: "sig-123" },
      }],
    };

    const r = await compactMessages(msgs, { maxChars: 800, keepRecent: 4 });

    const call = r.messages[1].toolCalls?.[0];
    expect(r.compacted).toBe(true);
    expect(call?.providerMetadata?.geminiThoughtSignature).toBe("sig-123");
  });

  it("an agent run with compaction enabled still completes and finishes the task", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    let compactions = 0;
    const r = await runAgent({
      rt, goal: "recompute variance",
      model: scriptedModel(recomputeVariancePlan({ r_rev__variance: "+24%", r_cogs__variance: "+27.5%" }, { lock: true })),
      tools: ROOM_TOOLS, maxSteps: 20,
      compaction: { maxChars: 400, keepRecent: 8 },
      onTrace: (e) => { if (e.tool === "compaction") compactions++; },
    });
    expect(r.exhausted).toBe(false);                                                  // compaction didn't break the loop
    expect(engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value).toBe("+24%"); // task still done
    expect(compactions).toBeGreaterThan(0);                                           // compaction actually fired
  });
});
