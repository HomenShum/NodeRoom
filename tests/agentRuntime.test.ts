/**
 * Agent harness — scenario tests. Each starts from a real room + a real goal and
 * drives the REAL runtime (context → tool → result → next) with the scripted
 * model, so we test the harness + the tool backend + the engine together — the
 * way it runs in production, minus the LLM's nondeterminism.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { AgentRunError, InMemoryRoomTools, ROOM_TOOLS, lastVersions, runAgent, scriptedModel, type AgentMessage, type AgentTool, type ToolCall } from "../src/nodeagent/index";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";

const TARGETS = { r_rev__variance: "+24%", r_cogs__variance: "+27.5%" };
const conflictsIn = (r: { trace: { tool: string; result: unknown }[] }) =>
  r.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { engine, d, rt };
}

describe("agent runtime — collaboration under concurrency", () => {
  it("happy path: claim → read → CAS edit → release commits both cells with no conflicts", async () => {
    const { engine, d, rt } = setup();
    const r = await runAgent({ rt, goal: "recompute variance", model: scriptedModel(recomputeVariancePlan(TARGETS)), tools: ROOM_TOOLS, maxSteps: 14 });
    const art = engine.getArtifact(d.sheetId)!;

    expect(r.exhausted).toBe(false);
    expect(art.elements["r_rev__variance"].value).toBe("+24%");
    expect(art.elements["r_cogs__variance"].value).toBe("+27.5%");
    expect(conflictsIn(r)).toBe(0);
    expect(engine.lockFor(d.sheetId, "r_rev__variance")).toBeUndefined(); // released
    // it claimed a lock, edited, and released — the full protocol
    expect(r.trace.some((t) => t.tool === "propose_lock")).toBe(true);
    expect(r.trace.some((t) => t.tool === "release_lock")).toBe(true);
  });

  it("treats a blank artifactId like the primary artifact for provider tool calls", async () => {
    const { engine, d, rt } = setup();
    const [before] = await rt.readRange(["r_rev__variance"], "");
    expect(before.version).toBe(1);

    const lock = await rt.proposeLock(["r_rev__variance"], "provider supplied blank artifact id", "");
    expect(lock.ok).toBe(true);
    const edit = await rt.editCell("r_rev__variance", "+24%", before.version, "");
    expect(edit.ok).toBe(true);
    if (lock.ok) await rt.releaseLock(lock.lockId);

    expect(engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value).toBe("+24%");
  });

  it("review mode creates one proposal per target, then releases the lock without duplicate retries", async () => {
    const { engine, d, rt } = setup();
    engine.toggleAutoAllow(d.roomId, d.members.homen);

    const r = await runAgent({ rt, goal: "recompute variance for host review", model: scriptedModel(recomputeVariancePlan(TARGETS)), tools: ROOM_TOOLS, maxSteps: 14 });
    const proposals = engine.listProposals(d.roomId);
    const proposedCells = proposals.map((p) => p.op.elementId).sort();

    expect(r.exhausted).toBe(false);
    expect(r.finalText).toContain("Waiting for host approval");
    expect(proposedCells).toEqual(["r_cogs__variance", "r_rev__variance"]);
    expect(r.trace.filter((t) => t.tool === "edit_cell" && (t.result as { pendingApproval?: boolean })?.pendingApproval)).toHaveLength(2);
    expect(engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value).toBe("");
    expect(engine.getArtifact(d.sheetId)!.elements["r_cogs__variance"].value).toBe("");
    expect(engine.lockFor(d.sheetId, "r_rev__variance")).toBeUndefined();
  });

  it("CAS conflict (no lock): a concurrent human edit forces a re-read + retry — the stale write is rejected, not clobbered", async () => {
    const { engine, d, rt } = setup();
    let injected = false;
    const onTrace = (e: { tool: string; args: unknown }) => {
      const ids = (e.args as { elementIds?: string[] }).elementIds ?? [];
      if (!injected && e.tool === "read_range" && ids.includes("r_rev__variance")) {
        injected = true;
        const v = engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].version;
        const res = engine.applyEdit({ roomId: d.roomId, op: { opId: "human", artifactId: d.sheetId, elementId: "r_rev__variance", kind: "set", value: "+19%", baseVersion: v }, actor: d.members.priya });
        expect(res.ok).toBe(true); // no lock held → the human's write LANDS (sets up the conflict)
      }
    };
    // lock:false → pure CAS, no lock to prevent the race
    const r = await runAgent({ rt, goal: "recompute variance", model: scriptedModel(recomputeVariancePlan(TARGETS, { lock: false })), tools: ROOM_TOOLS, maxSteps: 16, onTrace });
    const cell = engine.getArtifact(d.sheetId)!.elements["r_rev__variance"];

    expect(injected).toBe(true);
    expect(conflictsIn(r)).toBeGreaterThanOrEqual(1); // the stale write WAS rejected
    expect(cell.value).toBe("+24%");                  // the agent re-read and committed its value
    expect(cell.version).toBeGreaterThanOrEqual(3);   // seed(1) → human(2) → agent(3)
    expect(r.exhausted).toBe(false);                  // it still finished within budget
  });

  it("lock prevents the race: while the agent holds the lock, a concurrent human write is BLOCKED (no conflict needed)", async () => {
    const { engine, d, rt } = setup();
    let humanBlocked = false;
    const onTrace = (e: { tool: string; args: unknown }) => {
      const ids = (e.args as { elementIds?: string[] }).elementIds ?? [];
      if (!humanBlocked && e.tool === "read_range" && ids.includes("r_rev__variance")) {
        const v = engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].version;
        const res = engine.applyEdit({ roomId: d.roomId, op: { opId: "human", artifactId: d.sheetId, elementId: "r_rev__variance", kind: "set", value: "+19%", baseVersion: v }, actor: d.members.priya });
        humanBlocked = !res.ok && res.reason === "locked";
      }
    };
    const r = await runAgent({ rt, goal: "recompute variance", model: scriptedModel(recomputeVariancePlan(TARGETS, { lock: true })), tools: ROOM_TOOLS, maxSteps: 16, onTrace });

    expect(humanBlocked).toBe(true);          // the lock blocked the human's concurrent write
    expect(conflictsIn(r)).toBe(0);           // so the agent never even hit a CAS conflict
    expect(engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value).toBe("+24%");
  });

  it("locked range → draft → smart-merge: a blocked agent drafts instead of waiting, and never clobbers", async () => {
    const { engine, d } = setup();
    // Agent A claims the range (and does NOT edit it yet).
    const aLock = engine.proposeLock({ roomId: d.roomId, artifactId: d.sheetId, elementIds: ["r_rev__variance", "r_cogs__variance"], holder: d.agents.room, sessionId: d.sessions.room, reason: "A is working" });
    expect(aLock.ok).toBe(true);

    // Agent B (the private agent) tries the same range → denied → drafts.
    const rtB = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.priv, d.sessions.priv);
    const rB = await runAgent({ rt: rtB, goal: "recompute variance", model: scriptedModel(recomputeVariancePlan(TARGETS)), tools: ROOM_TOOLS, maxSteps: 14 });

    expect(rB.trace.some((t) => t.tool === "create_draft" && (t.result as { draftId?: string }).draftId)).toBe(true);
    expect(rB.trace.some((t) => t.tool === "edit_cell" && (t.result as { ok?: boolean }).ok)).toBe(false); // B never edited a locked cell
    expect(engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value).toBe(""); // unchanged while locked

    // A releases → B's draft smart-merges onto the (untouched) cells.
    if (aLock.ok) {
      const rel = engine.releaseLock(aLock.lock.id, d.agents.room);
      expect(rel.merged.length).toBe(1);
    }
    const art = engine.getArtifact(d.sheetId)!;
    expect(art.elements["r_rev__variance"].value).toBe("+24%");
    expect(art.elements["r_cogs__variance"].value).toBe("+27.5%");
  });

  it("step budget: a non-terminating model is bounded, not infinite", async () => {
    const { rt } = setup();
    const loopy = scriptedModel(() => ({ toolCalls: [{ tool: "read_range", args: { elementIds: ["r_rev__variance"] } }] }));
    const r = await runAgent({ rt, goal: "loop forever", model: loopy, tools: ROOM_TOOLS, maxSteps: 3 });
    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.handoff?.nextGoal).toBe("loop forever");
    expect(r.trace.at(-1)?.tool).toBe("handoff");
    expect(r.steps).toBe(3);
  });

  it("does not complete an empty no-op model response before any work", async () => {
    const { rt } = setup();
    const emptyDone = scriptedModel(() => ({ done: true, toolCalls: [] }));
    const r = await runAgent({ rt, goal: "write the variance cells", model: emptyDone, tools: ROOM_TOOLS, maxSteps: 2 });

    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.finalText).toContain("Paused");
    expect(r.trace.at(-1)?.tool).toBe("handoff");
  });

  it("does not complete a text-only answer for a write-intent goal before any write", async () => {
    const { rt } = setup();
    const textOnlyDone = scriptedModel(() => ({ say: "I computed the values but did not write them.", done: true }));
    const r = await runAgent({ rt, goal: "fill the sheet cells", model: textOnlyDone, tools: ROOM_TOOLS, maxSteps: 2 });

    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.trace.at(-1)?.tool).toBe("handoff");
  });

  it("time budget: stops with a resumable handoff before another model turn", async () => {
    const { rt } = setup();
    let modelCalls = 0;
    const neverCalled = scriptedModel(() => {
      modelCalls++;
      return { say: "should not run", done: true };
    });

    const r = await runAgent({
      rt,
      goal: "respect the action budget",
      model: neverCalled,
      tools: ROOM_TOOLS,
      maxSteps: 3,
      deadlineAt: 1_000,
      reserveMs: 0,
      now: () => 1_000,
    });

    expect(modelCalls).toBe(0);
    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("time_budget");
    expect(r.handoff?.reason).toBe("time_budget");
    expect(r.trace.at(-1)?.tool).toBe("handoff");
  });

  it("resumes a long-running job across multiple step-budget slices", async () => {
    const { engine, d, rt } = setup();
    const cell = "r_ni__variance";
    const slicedModel = () => scriptedModel(({ messages }) => {
      const edited = messages.some((m) => m.role === "tool" && m.toolName === "edit_cell" && m.content.includes("\"ok\":true"));
      if (edited) return { say: "completed from checkpoint", done: true };
      const versions = lastVersions(messages);
      if (versions[cell] !== undefined) {
        return { toolCalls: [{ tool: "edit_cell", args: { elementId: cell, value: "+22.4%", baseVersion: versions[cell] } }] };
      }
      return { toolCalls: [{ tool: "read_range", args: { elementIds: [cell] } }] };
    }, "sliced-scripted");

    let cursor: { messages: AgentMessage[]; remainingToolCalls?: ToolCall[] } | undefined;
    let finalText = "";
    for (let i = 0; i < 4; i++) {
      const r = await runAgent({
        rt,
        goal: "set net income variance",
        model: slicedModel(),
        tools: ROOM_TOOLS,
        maxSteps: 1,
        initialMessages: cursor?.messages,
        resumeToolCalls: cursor?.remainingToolCalls,
      });
      finalText = r.finalText;
      if (r.stopReason === "done") break;
      cursor = { messages: r.messages, remainingToolCalls: r.handoff?.remainingToolCalls };
    }

    expect(finalText).toBe("completed from checkpoint");
    expect(engine.getArtifact(d.sheetId)!.elements[cell].value).toBe("+22.4%");
  });

  it("resumes remaining tool calls when a slice hands off mid-turn", async () => {
    const { rt } = setup();
    let now = 0;
    let executed = 0;
    const markTool: AgentTool = {
      name: "mark",
      description: "record a marker",
      schema: z.object({ id: z.string() }),
      execute: async (a: { id: string }) => {
        executed++;
        if (a.id === "first") now = 10;
        return { ok: true, id: a.id };
      },
    };
    const makeModel = () => scriptedModel(({ messages }) => {
      const toolResults = messages.filter((m) => m.role === "tool" && m.toolName === "mark").length;
      if (toolResults >= 2) return { say: "done after remaining tool", done: true };
      return {
        toolCalls: [
          { tool: "mark", args: { id: "first" } },
          { tool: "mark", args: { id: "second" } },
        ],
      };
    }, "remaining-tool-scripted");

    const first = await runAgent({
      rt,
      goal: "execute both markers",
      model: makeModel(),
      tools: [markTool],
      maxSteps: 3,
      deadlineAt: 10,
      reserveMs: 0,
      now: () => now,
    });

    expect(first.stopReason).toBe("time_budget");
    expect(executed).toBe(1);
    expect(first.handoff?.remainingToolCalls.map((c) => c.args.id)).toEqual(["second"]);

    const resumed = await runAgent({
      rt,
      goal: "execute both markers",
      model: makeModel(),
      tools: [markTool],
      maxSteps: 3,
      initialMessages: first.messages,
      resumeToolCalls: first.handoff?.remainingToolCalls,
    });

    expect(executed).toBe(2);
    expect(resumed.stopReason).toBe("done");
    expect(resumed.finalText).toBe("done after remaining tool");
  });

  it("tool exceptions carry a partial trace for durable failure telemetry", async () => {
    const { rt } = setup();
    const throwingTool: AgentTool = {
      name: "throw_tool",
      description: "throws",
      schema: z.object({}),
      execute: async () => { throw new Error("boom"); },
    };
    const model = scriptedModel(() => ({ toolCalls: [{ tool: "throw_tool", args: {} }] }));

    const handoffs: unknown[] = [];
    let thrown: unknown;
    try {
      await runAgent({ rt, goal: "fail with trace", model, tools: [throwingTool], maxSteps: 1, onHandoff: (h) => handoffs.push(h) });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentRunError);
    const error = thrown as AgentRunError;
    expect(error.partial.steps).toBe(1);
    expect(error.partial.trace).toHaveLength(2);
    expect(error.partial.trace[0].tool).toBe("throw_tool");
    expect((error.partial.trace[0].result as { error?: string }).error).toContain("boom");
    expect(error.partial.trace[1].tool).toBe("handoff");
    expect(error.partial.handoff?.reason).toBe("error");
    expect(handoffs).toHaveLength(1);
  });
});
