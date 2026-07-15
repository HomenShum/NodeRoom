/**
 * Privacy/gateway primitives (review domain 3) + exactly-once journal (durable-workflow semantics).
 */
import { describe, it, expect } from "vitest";
import { checkSpendCeiling, redactPII } from "../src/nodeagent/guardrails/gateway";
import { journalSliceKey, MapStepJournal } from "../src/nodeagent/core/journal";
import { AgentRunError, runAgent } from "../src/nodeagent/core/runtime";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import type { AgentHandoff, AgentModel } from "../src/nodeagent/core/types";
import { makeConvexStepJournal } from "../convex/agentStepJournalClient";

const CELL = "r_ni__variance";
const VAL = "+22.4%";

describe("LLM gateway — spend ceiling (per-run token/cost cap)", () => {
  it("caps a run at the token ceiling and the cost ceiling", () => {
    expect(checkSpendCeiling({ inputTokens: 500, outputTokens: 400, costUsd: 0.01 }, { maxTokens: 1000 }).ok).toBe(true);
    expect(checkSpendCeiling({ inputTokens: 600, outputTokens: 500, costUsd: 0.01 }, { maxTokens: 1000 }).ok).toBe(false);
    expect(checkSpendCeiling({ inputTokens: 10, outputTokens: 10, costUsd: 0.5 }, { maxCostUsd: 0.25 }).ok).toBe(false);
    expect(checkSpendCeiling({ inputTokens: 10, outputTokens: 10, costUsd: 0.1 }, { maxCostUsd: 0.25, maxTokens: 100 }).ok).toBe(true);
  });
});

describe("LLM gateway — outbound PII/secret firewall", () => {
  it("redacts emails, SSNs, phones, and secret-shaped tokens before the prompt leaves", () => {
    const r = redactPII("email a.user@b.com, SSN 123-45-6789, call 415-555-1234, key sk-abc1234567890abcdef1234ZZ");
    expect(r.text).not.toContain("a.user@b.com");
    expect(r.text).not.toContain("123-45-6789");
    expect(r.text).not.toContain("sk-abc1234567890abcdef1234ZZ");
    expect(r.text).toContain("[redacted-email]");
    expect(r.text).toContain("[redacted-ssn]");
    expect(r.text).toContain("[redacted-secret]");
    expect(r.redactions).toBeGreaterThanOrEqual(4);
  });
  it("leaves clean business text untouched", () => {
    expect(redactPII("Reconcile Q3 variance for Acme Robotics; +22.4%.").redactions).toBe(0);
  });
});

describe("gateway spend ceiling wired into the runtime", () => {
  it("stops a run before it blows the per-run token cap, with a resumable handoff", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    let calls = 0;
    const spender: AgentModel = {
      get name() { return "spender"; },
      next: async () => { calls++; return { text: "", toolCalls: [{ id: "x" + calls, tool: "read_range", args: { elementIds: [CELL] } }], done: false, usage: { inputTokens: 100, outputTokens: 50 } }; },
    };
    const r = await runAgent({ rt, goal: "read repeatedly", model: spender, tools: ROOM_TOOLS, maxSteps: 20, spendLimits: { maxTokens: 200 } });
    expect(r.stopReason).toBe("spend_budget");                              // stopped at the ceiling, not maxSteps
    expect(r.handoff).toBeTruthy();                                         // resumable
    expect(r.usage.inputTokens + r.usage.outputTokens).toBeLessThanOrEqual(300); // didn't run away past the cap
    expect(calls).toBeLessThanOrEqual(2);                                   // only 2 billable calls before the cap fired
  });

  it("P0-4: the DOLLAR ceiling fires via priceStep (was dead surface — costUsd hardcoded 0)", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    let calls = 0;
    const spender: AgentModel = {
      get name() { return "paid-model"; },
      next: async () => { calls++; return { text: "", toolCalls: [{ id: "c" + calls, tool: "read_range", args: { elementIds: [CELL] } }], done: false, usage: { inputTokens: 1000, outputTokens: 500 } }; },
    };
    // $0.10/step, $0.25 cap, generous token cap → the DOLLAR limit must be the binding constraint.
    const r = await runAgent({
      rt, goal: "read repeatedly", model: spender, tools: ROOM_TOOLS, maxSteps: 20,
      spendLimits: { maxCostUsd: 0.25, maxTokens: 1_000_000 },
      priceStep: () => 0.10,
    });
    expect(r.stopReason).toBe("spend_budget");   // stopped by DOLLARS, not tokens/steps
    expect(calls).toBeLessThanOrEqual(3);        // ~3 steps x $0.10 crosses $0.25; never ran to maxSteps
    expect(r.handoff).toBeTruthy();              // resumable, same as the token path
  });
});

describe("P1-3: error-path handoff preserves unexecuted tool calls (resume-cursor integrity)", () => {
  it("a mid-turn tool throw hands off the REMAINING calls — no unpaired tool_use blocks on resume", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    const { z } = await import("zod");
    const bomb = { name: "bomb", description: "throws", schema: z.object({}), execute: () => { throw new Error("tool exploded"); } };
    // One model turn issues THREE calls; the 2nd throws → the 3rd is unexecuted.
    const model: AgentModel = {
      get name() { return "three-calls"; },
      next: async () => ({ text: "", done: false, usage: { inputTokens: 10, outputTokens: 5 }, toolCalls: [
        { id: "c1", tool: "read_range", args: { elementIds: [CELL] } },
        { id: "c2", tool: "bomb", args: {} },
        { id: "c3", tool: "read_range", args: { elementIds: [CELL] } },
      ] }),
    };
    const handoffs: AgentHandoff[] = [];
    let thrown: unknown;
    try {
      await runAgent({ rt, goal: "boom mid-turn", model, tools: [...ROOM_TOOLS, bomb], maxSteps: 4, onHandoff: (h) => handoffs.push(h) });
    } catch (e) { thrown = e; }
    const err = thrown as import("../src/nodeagent/core/runtime").AgentRunError;
    expect(err?.name).toBe("AgentRunError");
    const handoff = err.partial.handoff!;
    expect(handoff.reason).toBe("error");
    expect(handoff.remainingToolCalls.map((c) => c.id)).toEqual(["c3"]); // ← the unexecuted call rides the handoff
    expect(err.partial.trace.at(-1)?.tool).toBe("handoff");
    expect(handoffs.map((h) => h.reason)).toEqual(["error"]);
    expect(handoffs[0].remainingToolCalls.map((c) => c.id)).toEqual(["c3"]);
    // And the message stream is PAIRED: the assistant turn lists 3 calls, results exist for c1+c2
    // (the thrower records its error result), and c3's pairing completes on resume via resumeToolCalls.
    const toolResults = err.partial.messages.filter((m) => m.role === "tool").map((m) => (m as { toolCallId?: string }).toolCallId);
    expect(toolResults).toContain("c1");
    expect(toolResults).toContain("c2");
  });
});

describe("exactly-once journal (no double-bill on slice retry)", () => {
  it("derives the same per-step accounting claim for a committed step and its crash replay", async () => {
    const stored = new Map<number, Awaited<ReturnType<AgentModel["next"]>>>();
    const calls: Array<Record<string, unknown>> = [];
    const ctx = {
      runMutation: async (_ref: unknown, args: Record<string, unknown>) => {
        if (!("result" in args)) return stored.get(Number(args.step));
        calls.push(args);
        stored.set(Number(args.step), args.result as Awaited<ReturnType<AgentModel["next"]>>);
      },
    };
    const result = {
      text: "done",
      toolCalls: [],
      done: true,
      usage: { inputTokens: 10, outputTokens: 4, modelCalls: 2, costUsd: 0.01, costKind: "exact" as const },
    };
    const fresh = makeConvexStepJournal({
      ctx,
      jobId: "job1" as never,
      leaseId: "lease-1",
      sliceKey: "slice-1",
      modelName: () => "provider/model",
    });
    await fresh.record(0, result);
    const freshClaims = fresh.accountingClaims();

    const replay = makeConvexStepJournal({
      ctx,
      jobId: "job1" as never,
      leaseId: "lease-2",
      sliceKey: "slice-1",
      modelName: () => "provider/model",
    });
    expect(await replay.get(0)).toEqual(result);

    expect(replay.accountingClaims()).toEqual(freshClaims);
    expect(freshClaims).toEqual([{ step: 0, outputHash: expect.any(String), state: "confirmed" }]);
    expect(calls[0]).toMatchObject({ leaseId: "lease-1", outputHash: expect.any(String) });
  });

  it("retains a pending claim when a journal mutation may have committed before throwing", async () => {
    const result = {
      text: "done",
      toolCalls: [],
      done: true,
      usage: { inputTokens: 10, outputTokens: 4, modelCalls: 1, costUsd: 0.01, costKind: "exact" as const },
    };
    const journal = makeConvexStepJournal({
      ctx: {
        runMutation: async () => { throw new Error("response_lost_after_commit"); },
      },
      jobId: "job1" as never,
      leaseId: "lease-1",
      sliceKey: "slice-1",
      modelName: () => "provider/model",
    });

    await expect(journal.record(0, result)).rejects.toThrow("response_lost_after_commit");
    expect(journal.accountingClaims()).toEqual([{
      step: 0,
      outputHash: expect.any(String),
      state: "pending",
    }]);
  });

  it("derives stable slice keys from semantic input, not object insertion order", () => {
    const a = journalSliceKey({ jobId: "job1", cursor: { b: 2, a: 1 }, stepBudget: 3 });
    const b = journalSliceKey({ stepBudget: 3, cursor: { a: 1, b: 2 }, jobId: "job1" });
    const c = journalSliceKey({ jobId: "job1", cursor: { a: 1, b: 3 }, stepBudget: 3 });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("a retried slice replays journaled model steps — zero new model calls, work still completes", async () => {
    const journal = new MapStepJournal();
    let modelCalls = 0;
    const run = async (eng: RoomEngine) => {
      const d = buildDemoRoom(eng);
      const rt = new InMemoryRoomTools(eng, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
      const base = scriptedModel(recomputeVariancePlan({ [CELL]: VAL }, { lock: true }));
      const counting: AgentModel = { get name() { return base.name; }, next: (i) => { modelCalls++; return base.next(i); } };
      const r = await runAgent({ rt, goal: `Set ${CELL} to ${VAL}. Lock, read, edit with CAS, release.`, model: counting, tools: ROOM_TOOLS, maxSteps: 8, journal });
      return { d, eng, r };
    };

    // Run 1: a fresh slice — every model step is journaled.
    const first = await run(new RoomEngine());
    expect(first.r.stopReason).toBe("done");
    const callsRun1 = modelCalls;
    expect(callsRun1).toBeGreaterThan(0);
    expect(journal.size).toBe(callsRun1);

    // Run 2: the crash-RETRY of the same slice (fresh engine, SAME journal) — replays every step.
    modelCalls = 0;
    const second = await run(new RoomEngine());
    expect(second.r.stopReason).toBe("done");
    expect(modelCalls).toBe(0);                                                              // ← exactly-once: NO re-call, NO re-bill
    expect(second.r.usage.modelCalls).toBe(first.r.usage.modelCalls);                        // original usage is rematerialized
    expect(String(second.eng.getArtifact(second.d.sheetId)!.elements[CELL]?.value)).toBe(VAL); // work still completed via replay
  });

  it("rematerializes journaled usage after a crash between journal commit and slice accounting", async () => {
    const eng = new RoomEngine();
    const d = buildDemoRoom(eng);
    const rt = new InMemoryRoomTools(eng, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    let stored: Awaited<ReturnType<AgentModel["next"]>> | undefined;
    let crashAfterCommit = true;
    let providerRequests = 0;
    const journal = {
      get: () => stored,
      record: (_step: number, result: Awaited<ReturnType<AgentModel["next"]>>) => {
        stored = result;
        if (crashAfterCommit) throw new Error("simulated_crash_after_journal_commit");
      },
    };
    const model: AgentModel = {
      name: "journal-accounting-model",
      async next() {
        providerRequests += 1;
        return {
          text: "done",
          toolCalls: [],
          done: true,
          usage: {
            inputTokens: 17,
            outputTokens: 5,
            cachedInputTokens: 3,
            cacheCreationInputTokens: 2,
            modelCalls: 1,
            costUsd: 0.004,
            costKind: "exact",
          },
        };
      },
    };

    const failed = await runAgent({ rt, goal: "Summarize the workbook.", model, tools: [], maxSteps: 2, journal })
      .then(() => undefined, (error: unknown) => error);
    expect(failed).toBeInstanceOf(AgentRunError);
    expect((failed as AgentRunError).message).toContain("simulated_crash_after_journal_commit");
    expect((failed as AgentRunError).partial.usage).toMatchObject({
      inputTokens: 17,
      outputTokens: 5,
      modelCalls: 1,
      costUsd: 0.004,
      costKind: "exact",
    });
    expect(providerRequests).toBe(1);

    crashAfterCommit = false;
    providerRequests = 0;
    const replay = await runAgent({ rt, goal: "Summarize the workbook.", model, tools: [], maxSteps: 2, journal });

    expect(providerRequests).toBe(0);
    expect(replay.usage).toMatchObject({
      inputTokens: 17,
      outputTokens: 5,
      cachedInputTokens: 3,
      cacheCreationInputTokens: 2,
      modelCalls: 1,
      costUsd: 0.004,
      costKind: "exact",
    });
  });
});
