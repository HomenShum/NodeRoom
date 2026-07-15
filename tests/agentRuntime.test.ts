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
import { AgentRunError, InMemoryRoomTools, ROOM_TOOLS, lastVersions, runAgent, scriptedModel, type AgentMessage, type AgentModel, type AgentTool, type ToolCall } from "../src/nodeagent/index";
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

it("repairs a complete stringified tool argument object with provider spillover", async () => {
  const { rt } = setup();
  let observed: number | undefined;
  const recordTool: AgentTool = {
    name: "record_value",
    description: "Record one numeric value.",
    schema: z.object({ value: z.number() }),
    execute: async ({ value }: { value: number }) => {
      observed = value;
      return { ok: true, value };
    },
  };
  let turn = 0;
  const model: AgentModel = {
    name: "stringified-tool-args",
    async next() {
      turn += 1;
      if (turn > 1) return { text: "Recorded.", toolCalls: [], done: true };
      return {
        toolCalls: [{
          id: "record-1",
          tool: "record_value",
          args: '{"value":42}]\n' as unknown as Record<string, unknown>,
        }],
        done: false,
      };
    },
  };

  const result = await runAgent({ rt, goal: "record 42", model, tools: [recordTool], maxSteps: 2 });

  expect(observed).toBe(42);
  expect(result.trace[0]).toMatchObject({ tool: "record_value", args: { value: 42 }, result: { ok: true } });
  const repairedCall = result.messages
    .find((message) => message.role === "assistant" && message.toolCalls?.length)
    ?.toolCalls?.[0];
  expect(repairedCall?.providerMetadata).toMatchObject({ argumentRepair: "stringified_json_object" });
});

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

  it("stops after a terminal say tool for read/report-only goals", async () => {
    const { rt } = setup();
    let turns = 0;
    const answerWithSayTool = scriptedModel(() => {
      turns += 1;
      return { toolCalls: [{ tool: "say", args: { text: "Room artifact count: 21" } }] };
    });

    const r = await runAgent({ rt, goal: "report the room artifact count", model: answerWithSayTool, tools: ROOM_TOOLS, maxSteps: 8 });

    expect(r.exhausted).toBe(false);
    expect(r.stopReason).toBe("done");
    expect(r.finalText).toBe("Room artifact count: 21");
    expect(r.steps).toBe(1);
    expect(turns).toBe(1);
    expect(r.trace.filter((t) => t.tool === "say")).toHaveLength(1);
  });

  it("withholds repeated say calls until a write-required goal makes artifact progress", async () => {
    const { rt } = setup();
    const offeredToolNames: string[][] = [];
    let turn = 0;
    const model: AgentModel = {
      name: "pre-write-say-loop",
      async next({ tools }) {
        offeredToolNames.push(tools.map((tool) => tool.name));
        turn += 1;
        if (turn === 1) return {
          toolCalls: [{ id: "say-before-write", tool: "say", args: { text: "I am still working." } }],
          done: false,
        };
        return { text: "No write performed.", toolCalls: [], done: true };
      },
    };

    const result = await runAgent({ rt, goal: "fill the sheet cells", model, tools: ROOM_TOOLS, maxSteps: 2 });

    expect(offeredToolNames[0]).toContain("say");
    expect(offeredToolNames[1]).not.toContain("say");
    expect(result.trace.filter((event) => event.tool === "say")).toHaveLength(1);
    expect(result.messages.some((message) => message.content?.includes("say tool is now withheld"))).toBe(true);
    expect(result.stopReason).toBe("step_budget");
  });

  it("does not steer read-only report answers into the BTB package tool", async () => {
    const { rt } = setup();
    let packageCalls = 0;
    let turn = 0;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => {
        packageCalls += 1;
        return { ok: false, error: "btb_package_quality_gate_failed" };
      },
    };
    const model = {
      name: "read-only-report",
      async next() {
        turn += 1;
        if (turn === 1) {
          return { toolCalls: [{ id: "read-1", tool: "read_range", args: { elementIds: ["r_rev__variance"] } }], done: false };
        }
        return { text: "Room artifact count: 1", toolCalls: [], done: true };
      },
    };

    const r = await runAgent({
      rt,
      goal: "UI budget smoke: list the room artifacts and report the count only. Do not create or edit artifacts.",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 8,
    });

    expect(r.stopReason).toBe("done");
    expect(r.exhausted).toBe(false);
    expect(r.finalText).toBe("Room artifact count: 1");
    expect(packageCalls).toBe(0);
    expect(r.trace.some((t) => t.tool === "create_btb_deliverable_package")).toBe(false);
    expect(r.messages.some((message) => message.content?.includes("this run cannot be complete"))).toBe(false);
  });

  it("does not complete an empty no-op model response before any work", async () => {
    const { rt } = setup();
    const emptyDone = scriptedModel(() => ({ done: true, toolCalls: [] }));
    const r = await runAgent({ rt, goal: "write the variance cells", model: emptyDone, tools: ROOM_TOOLS, maxSteps: 2 });

    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.handoff?.summary).toContain("2/4 required-tool misses");
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

  it.each([
    "audit and fix this workbook thoroughly",
    "repair the broken formulas in the sheet",
    "complete the financial model",
    "calculate the forecast formulas in the workbook",
    "Forecast Cash as prior period Cash plus Changes in Working Capital.",
    "Forecasting cash for Years 2-4 in the workbook.",
    "Use the average balance method for interest expense.",
    "Please apply this formula to the forecast cells.",
    "Could you use this calculation across the selected range?",
  ])("requires tool use for workbook mutation phrasing: %s", async (goal) => {
    const { rt } = setup();
    const choices: Array<string | undefined> = [];
    const model: AgentModel = {
      name: "write-intent-probe",
      async next({ toolChoice }) {
        choices.push(toolChoice);
        return { text: "No changes made.", toolCalls: [], done: true };
      },
    };

    await runAgent({ rt, goal, model, tools: ROOM_TOOLS, maxSteps: 1 });

    expect(choices).toEqual(["required"]);
  });

  it.each([
    "Compare forecasting methods and report the best approach.",
    "Explain how to apply the average balance method.",
    "The candidate will apply for a forecasting role.",
    "Forecasting is useful for planning.",
    "Use this approach to explain the existing forecast.",
  ])("does not overclassify read-only or non-spreadsheet phrasing as a write: %s", async (goal) => {
    const { rt } = setup();
    const choices: Array<string | undefined> = [];
    const model: AgentModel = {
      name: "read-intent-probe",
      async next({ toolChoice }) {
        choices.push(toolChoice);
        return { text: "Read-only response.", toolCalls: [], done: true };
      },
    };

    await runAgent({ rt, goal, model, tools: ROOM_TOOLS, maxSteps: 1 });

    expect(choices).toEqual(["auto"]);
  });

  it.each([
    "fix this workbook thoroughly",
    "Forecast Cash as prior period Cash plus Changes in Working Capital.",
    "Use the average balance method for interest expense.",
  ])("does not count a rejected write tool call as completed workbook work: %s", async (goal) => {
    const { rt } = setup();
    let turn = 0;
    const model: AgentModel = {
      name: "rejected-write-probe",
      async next() {
        turn += 1;
        if (turn === 1) {
          return { toolCalls: [{ id: "bad-write", tool: "edit_cell", args: {} }], done: false };
        }
        return { text: "The workbook is fixed.", toolCalls: [], done: true };
      },
    };

    const result = await runAgent({
      rt,
      goal,
      model,
      tools: ROOM_TOOLS,
      maxSteps: 2,
    });

    expect(result.stopReason).toBe("step_budget");
    expect(result.exhausted).toBe(true);
    expect(result.trace.find((event) => event.tool === "edit_cell")?.result).toMatchObject({ ok: false });
  });

  it("withholds broad reads after the bounded pre-write evidence budget is exhausted", async () => {
    const { rt } = setup();
    const offeredToolNames: string[][] = [];
    const model: AgentModel = {
      name: "bounded-read-loop",
      async next({ tools }) {
        const names = tools.map((tool) => tool.name);
        offeredToolNames.push(names);
        if (names.includes("read_range")) {
          return { toolCalls: [{ id: `read-${offeredToolNames.length}`, tool: "read_range", args: { elementIds: ["r_rev__variance"] } }], done: false };
        }
        return { text: "No write performed.", toolCalls: [], done: true };
      },
    };

    const result = await runAgent({ rt, goal: "complete the financial model", model, tools: ROOM_TOOLS, maxSteps: 6 });

    expect(offeredToolNames).toHaveLength(6);
    expect(offeredToolNames[4]).toContain("read_range");
    expect(offeredToolNames[5]).not.toContain("read_range");
    expect(offeredToolNames[5]).not.toContain("say");
    expect(result.trace.filter((event) => event.tool === "read_range")).toHaveLength(5);
    expect(result.messages.some((message) => message.content?.includes("pre-write read budget is exhausted"))).toBe(true);
    expect(result.stopReason).toBe("step_budget");
  });

  it("keeps mandatory workbook inspection available after exploratory reads are withheld", async () => {
    const { rt } = setup();
    const offeredToolNames: string[][] = [];
    const inspectTool: AgentTool = {
      name: "inspect_workbook",
      description: "Required workbook workflow inspection gate.",
      schema: z.object({}),
      execute: async () => ({ ok: true, inspection: { schema: 1 } }),
    };
    const model: AgentModel = {
      name: "bounded-read-inspection-gate",
      async next({ tools }) {
        const names = tools.map((tool) => tool.name);
        offeredToolNames.push(names);
        if (offeredToolNames.length <= 5) {
          return { toolCalls: [{ id: `read-${offeredToolNames.length}`, tool: "read_range", args: { elementIds: ["r_rev__variance"] } }], done: false };
        }
        return { toolCalls: [{ id: "inspect-required", tool: "inspect_workbook", args: {} }], done: false };
      },
    };

    const result = await runAgent({
      rt,
      goal: "complete the financial model",
      model,
      tools: [
        ...ROOM_TOOLS.filter((tool) => tool.name !== "inspect_workbook"),
        inspectTool,
      ],
      maxSteps: 6,
    });

    expect(offeredToolNames[5]).not.toContain("read_range");
    expect(offeredToolNames[5]).toContain("inspect_workbook");
    expect(result.trace.find((event) => event.tool === "inspect_workbook")).toMatchObject({
      tool: "inspect_workbook",
      result: { ok: true },
    });
  });

  it("steers read-looping BTB runs toward the deliverable package tool", async () => {
    const { rt } = setup();
    let sawPackageNudge = false;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const readOnly = scriptedModel(({ messages }) => {
      sawPackageNudge ||= messages.some((message) =>
        message.role === "user" && !!message.content?.includes("create_btb_deliverable_package"));
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_rev__variance"] } }] };
    });

    await runAgent({
      rt,
      goal: "create BankerToolBench deliverable package btb-test",
      model: readOnly,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 4,
    });

    expect(sawPackageNudge).toBe(true);
  });

  it("limits oversized BTB read batches before forcing the package tool", async () => {
    const { rt } = setup();
    const streamEvents: Array<{ title?: string; text?: string }> = [];
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const model = {
      name: "bulk-read-then-package",
      async next({ tools }: { tools: AgentTool[] }) {
        const names = tools.map((tool) => tool.name);
        if (names.length === 1 && names[0] === "create_btb_deliverable_package") {
          return { toolCalls: [{ id: "pkg", tool: "create_btb_deliverable_package", args: {} }], done: false };
        }
        return {
          toolCalls: Array.from({ length: 80 }, (_, index) => ({
            id: `read-${index}`,
            tool: "read_range",
            args: { elementIds: ["r_rev__variance"] },
          })),
          done: false,
        };
      },
    };

    const r = await runAgent({
      rt,
      goal: "create BankerToolBench deliverable package btb-123abc",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 3,
      onStreamEvent: (event) => {
        streamEvents.push({ title: event.title, text: event.text });
      },
    });

    expect(r.trace.filter((event) => event.tool === "read_range")).toHaveLength(24);
    expect(r.trace.some((event) => event.tool === "create_btb_deliverable_package")).toBe(true);
    expect(streamEvents.some((event) => event.title === "BTB read batch limited" && event.text?.includes("56"))).toBe(true);
    expect(r.messages.some((message) =>
      message.role === "user" && !!message.content?.includes("skipped 56 excess read-only calls"))).toBe(true);
  });

  it("restricts overdue BTB runs to the package tool after the package contract is issued", async () => {
    const { rt } = setup();
    const seenToolLists: string[][] = [];
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const model = {
      name: "package-only-inspector",
      async next({ tools }: { tools: AgentTool[] }) {
        const names = tools.map((tool) => tool.name);
        seenToolLists.push(names);
        if (names.length === 1 && names[0] === "create_btb_deliverable_package") {
          return { toolCalls: [{ id: "pkg", tool: "create_btb_deliverable_package", args: {} }], done: false };
        }
        return { toolCalls: [{ id: `read-${seenToolLists.length}`, tool: "read_range", args: { elementIds: ["r_rev__variance"] } }], done: false };
      },
    };

    const r = await runAgent({
      rt,
      goal: "create BankerToolBench deliverable package btb-test",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 5,
    });

    expect(seenToolLists).toContainEqual(["create_btb_deliverable_package"]);
    expect(r.trace.some((event) => event.tool === "create_btb_deliverable_package")).toBe(true);
  });

  it("does not fabricate a fallback package when a package-only BTB model still returns no tool call", async () => {
    const { rt } = setup();
    let packageArgs: Record<string, unknown> | undefined;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({
        taskId: z.string().optional(),
        title: z.string(),
        narrative: z.string(),
        rows: z.array(z.any()).optional(),
        sourceArtifactIds: z.array(z.string()).optional(),
      }),
      execute: async (args) => {
        packageArgs = args;
        return { ok: true };
      },
    };
    const model = scriptedModel(({ messages }) => {
      const packageContractIssued = messages.some((message) => message.role === "user" && message.content?.startsWith("BTB PACKAGE CONTRACT:"));
      if (packageContractIssued) return { say: "I have the answer but I am still not calling the tool.", done: true };
      return { toolCalls: [{ tool: "read_range", args: { artifactId: "source-1", elementIds: ["r_rev__variance"] } }] };
    });

    const r = await runAgent({
      rt,
      goal: "create BankerToolBench deliverable package btb-test123",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 4,
    });

    expect(r.stopReason).toBe("step_budget");
    expect(r.exhausted).toBe(true);
    expect(r.trace.some((event) => event.tool === "create_btb_deliverable_package")).toBe(false);
    expect(packageArgs).toBeUndefined();
  });

  it("does not accept a text-only BTB completion before the package tool runs", async () => {
    const { rt } = setup();
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const textOnlyDone = scriptedModel(() => ({ say: "The BTB task is complete.", done: true }));

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model: textOnlyDone,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 2,
    });

    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.messages.some((message) =>
      message.role === "user" && !!message.content?.includes("tool_required_no_call"),
    )).toBe(true);
    expect(r.handoff?.terminalReason).toBeUndefined();
    expect(r.handoff?.summary).toContain("2/4 required-tool misses");
  });

  it("requires provider tool calls while a BTB package is still missing", async () => {
    const { rt } = setup();
    const choices: Array<string | undefined> = [];
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const model = {
      name: "tool-choice-inspector",
      async next({ toolChoice }: { toolChoice?: string }) {
        choices.push(toolChoice);
        return { toolCalls: [{ id: "read-1", tool: "read_range", args: { elementIds: ["r_rev__variance"] } }], done: false };
      },
    };

    await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 1,
    });

    expect(choices[0]).toBe("required");
  });

  it("recovers from a required-tool no-call before failing the BTB run", async () => {
    const { rt } = setup();
    const choices: Array<string | undefined> = [];
    let turns = 0;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const model = {
      name: "one-no-tool-provider",
      async next({ toolChoice }: { toolChoice?: string }) {
        choices.push(toolChoice);
        turns += 1;
        if (turns === 1) {
          return { text: "I need to call the package tool next.", toolCalls: [], done: true };
        }
        if (turns === 2) {
          return { toolCalls: [{ id: "pkg", tool: "create_btb_deliverable_package", args: {} }], done: false };
        }
        return { text: "Package complete.", toolCalls: [], done: true };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 3,
      initialMessages: [
        { role: "user", content: "YOUR TASK: Run official BankerToolBench task btb-test." },
        {
          role: "user",
          content: "HARNESS NOTE: the user asked for a BTB deliverable package, so a text-only answer is not complete - no package artifacts were created.",
        },
      ],
    });

    expect(choices).toEqual(["required", "required"]);
    expect(r.stopReason).toBe("done");
    expect(r.exhausted).toBe(false);
    expect(r.trace.some((event) => event.tool === "create_btb_deliverable_package")).toBe(true);
  });

  it("terminates repeated no-tool BTB provider output without exposing a raw terminal marker", async () => {
    const { rt } = setup();
    const choices: Array<string | undefined> = [];
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const model = {
      name: "no-tool-provider",
      async next({ toolChoice }: { toolChoice?: string }) {
        choices.push(toolChoice);
        return { text: "I need to read the files first.", toolCalls: [], done: true };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 5,
      initialMessages: [
        { role: "user", content: "YOUR TASK: Run official BankerToolBench task btb-test." },
        {
          role: "user",
          content: "HARNESS NOTE: the user asked for a BTB deliverable package, so a text-only answer is not complete - no package artifacts were created.",
        },
      ],
    });

    expect(choices[0]).toBe("required");
    expect(choices.length).toBe(4);
    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.handoff?.terminalReason).toBe("protocol_stall");
    expect(r.handoff?.summary).toContain("stopped");
    expect(r.handoff?.summary).not.toContain("checkpointed");
    expect(r.handoff?.summary).not.toContain("tool_required_no_call_terminal");
    expect(r.trace.at(-1)?.result).toMatchObject({
      terminalReason: "protocol_stall",
      remainingToolCalls: [],
    });
  });

  it("carries required-tool misses across one-step slices and terminates exactly on the fourth provider call", async () => {
    const { rt } = setup();
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    let providerCalls = 0;
    const model: AgentModel = {
      name: "durable-no-tool-provider",
      async next() {
        providerCalls += 1;
        return {
          text: "I will call the package tool next.",
          toolCalls: [],
          done: true,
          usage: { inputTokens: 3, outputTokens: 2, modelCalls: 1 },
        };
      },
    };
    let initialMessages: AgentMessage[] | undefined;
    let result: Awaited<ReturnType<typeof runAgent>> | undefined;
    let persistedModelCalls = 0;
    for (let slice = 1; slice <= 4; slice += 1) {
      result = await runAgent({
        rt,
        goal: "Run official BankerToolBench task btb-test and create deliverable package",
        model,
        tools: [...ROOM_TOOLS, packageTool],
        maxSteps: 1,
        initialMessages,
      });
      persistedModelCalls += result.usage.modelCalls;
      initialMessages = result.messages;
      if (slice < 4) {
        expect(result.handoff?.terminalReason).toBeUndefined();
        expect(result.handoff?.summary).toContain(`${slice}/4 required-tool misses`);
      }
    }

    expect(providerCalls).toBe(4);
    expect(persistedModelCalls).toBe(4);
    expect(result?.handoff?.terminalReason).toBe("protocol_stall");
    expect(result?.handoff?.summary).toContain("after 4 required tool-use turns");
  });

  it("terminates four identical blocked tool calls without checkpointing a queued call", async () => {
    const { rt } = setup();
    let turns = 0;
    let executions = 0;
    const writeTool: AgentTool = {
      name: "write_locked_cells",
      description: "Write cells.",
      schema: z.object({ ops: z.array(z.object({ elementId: z.string(), value: z.unknown() })) }),
      execute: async () => {
        executions += 1;
        return { ok: true };
      },
    };
    const result = await runAgent({
      rt,
      goal: "Fill the spreadsheet cells with the requested values.",
      model: {
        name: "blocked-tool-provider",
        async next() {
          turns += 1;
          return {
            toolCalls: [
              { id: `blocked-${turns}`, tool: "write_locked_cells", args: { ops: [{ elementId: "B2", value: 10 }] } },
              ...(turns === 4
                ? [{ id: "poisoned-blocked-call", tool: "write_locked_cells", args: { ops: [{ elementId: "B3", value: 20 }] } }]
                : []),
            ],
            done: false,
          };
        },
      },
      tools: [writeTool],
      hooks: [{
        preTool: () => ({
          blocked: true as const,
          reason: "verified_workbook_workflow:write_plan_mismatch: blocked",
          failureKind: "evidence_required" as const,
        }),
      }],
      maxSteps: 10,
    });

    expect(turns).toBe(4);
    expect(executions).toBe(0);
    expect(result.handoff?.terminalReason).toBe("protocol_stall");
    expect(result.handoff?.remainingToolCalls).toEqual([]);
    expect(result.messages.flatMap((message) => message.toolCalls ?? []).map((call) => call.id))
      .not.toContain("poisoned-blocked-call");
    expect(result.trace.filter((event) => event.tool === "write_locked_cells")).toHaveLength(4);
  });

  it("terminates four identical tool argument errors without checkpointing a queued call", async () => {
    const { rt } = setup();
    let turns = 0;
    let executions = 0;
    const strictTool: AgentTool = {
      name: "strict_tool",
      description: "Requires an id.",
      schema: z.object({ id: z.string() }),
      execute: async () => {
        executions += 1;
        return { ok: true };
      },
    };
    const result = await runAgent({
      rt,
      goal: "Process the record with strict_tool.",
      model: {
        name: "invalid-argument-provider",
        async next() {
          turns += 1;
          return {
            toolCalls: [
              { id: `invalid-${turns}`, tool: "strict_tool", args: {} },
              ...(turns === 4
                ? [{ id: "poisoned-argument-call", tool: "strict_tool", args: { id: "must-not-replay" } }]
                : []),
            ],
            done: false,
          };
        },
      },
      tools: [strictTool],
      maxSteps: 10,
    });

    expect(turns).toBe(4);
    expect(executions).toBe(0);
    expect(result.handoff?.terminalReason).toBe("protocol_stall");
    expect(result.handoff?.remainingToolCalls).toEqual([]);
    expect(result.messages.flatMap((message) => message.toolCalls ?? []).map((call) => call.id))
      .not.toContain("poisoned-argument-call");
    expect(result.trace.filter((event) => event.tool === "strict_tool")).toHaveLength(4);
  });

  it("does not count failed BTB package attempts as a completed package", async () => {
    const { rt } = setup();
    let offeredTools: string[] = [];
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: false, error: "btb_package_quality_gate_failed" }),
    };
    const textOnlyDone = {
      name: "failed-package-recovery",
      async next({ tools }: { tools: AgentTool[] }) {
        offeredTools = tools.map((tool) => tool.name);
        return { say: "The package is complete.", toolCalls: [], done: true };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model: textOnlyDone,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 1,
      initialMessages: [
        { role: "user", content: "YOUR TASK: Run official BankerToolBench task btb-test." },
        {
          role: "assistant",
          content: "Trying to package.",
          toolCalls: [{ id: "pkg-1", tool: "create_btb_deliverable_package", args: {} }],
        },
        {
          role: "tool",
          toolCallId: "pkg-1",
          toolName: "create_btb_deliverable_package",
          content: JSON.stringify({ ok: false, error: "btb_package_quality_gate_failed" }),
        },
      ],
    });

    expect(offeredTools).toEqual(["create_btb_deliverable_package"]);
    expect(r.exhausted).toBe(true);
    expect(r.stopReason).toBe("step_budget");
    expect(r.trace.at(-1)?.tool).toBe("handoff");
  });

  it("forces a package-only retry after a BTB package tool rejection", async () => {
    const { rt } = setup();
    const offeredToolLists: string[][] = [];
    let packageCalls = 0;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => {
        packageCalls += 1;
        return packageCalls === 1
          ? { ok: false, error: "btb_package_quality_gate_failed" }
          : { ok: true };
      },
    };
    const model = {
      name: "package-retry-after-rejection",
      async next({ tools }: { tools: AgentTool[] }) {
        const names = tools.map((tool) => tool.name);
        offeredToolLists.push(names);
        return { toolCalls: [{ id: `pkg-${offeredToolLists.length}`, tool: "create_btb_deliverable_package", args: {} }], done: false };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 3,
    });

    expect(packageCalls).toBe(2);
    expect(offeredToolLists.at(-1)).toEqual(["create_btb_deliverable_package"]);
    expect(r.stopReason).toBe("done");
    expect(r.trace.filter((event) => event.tool === "create_btb_deliverable_package")).toHaveLength(2);
  });

  it("rejects partial multi-company BTB package calls before files are created", async () => {
    const { rt } = setup();
    let executeCount = 0;
    let turn = 0;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({
        taskId: z.string().optional(),
        title: z.string(),
        narrative: z.string(),
        rows: z.array(z.object({
          label: z.string(),
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        })).optional(),
        sourceArtifactIds: z.array(z.string()).optional(),
      }),
      execute: async () => {
        executeCount += 1;
        return { ok: true };
      },
    };
    const model = {
      name: "btb-coverage-retry",
      async next({ messages }: { messages: AgentMessage[] }) {
        turn += 1;
        const sawCoverageFailure = messages.some((message) =>
          message.role === "tool" && !!message.content?.includes("btb_package_task_coverage_gate_failed"));
        if (!sawCoverageFailure) {
          return {
            toolCalls: [{
              id: "pkg-partial",
              tool: "create_btb_deliverable_package",
              args: {
                taskId: "btb-test",
                title: "ORCL trading comps",
                narrative: "ORCL package created from Oracle source files.",
                rows: [{ label: "ORCL", values: { revenue: 100 } }],
                sourceArtifactIds: ["orcl-source"],
              },
            }],
            done: false,
          };
        }
        if (turn === 2) {
          return {
            toolCalls: [{
              id: "pkg-full",
              tool: "create_btb_deliverable_package",
              args: {
                taskId: "btb-test",
                title: "Software peer trading comps",
                narrative: "Peer package covers ADBE, AMZN, CRM, GOOGL, INTC, META, MSFT, NVDA, and ORCL.",
                rows: [
                  { label: "ADBE", values: { revenue: 100 } },
                  { label: "AMZN", values: { revenue: 100 } },
                  { label: "CRM", values: { revenue: 100 } },
                  { label: "GOOGL", values: { revenue: 100 } },
                  { label: "INTC", values: { revenue: 100 } },
                  { label: "META", values: { revenue: 100 } },
                  { label: "MSFT", values: { revenue: 100 } },
                  { label: "NVDA", values: { revenue: 100 } },
                  { label: "ORCL", values: { revenue: 100 } },
                ],
                sourceArtifactIds: ["peer-source"],
              },
            }],
            done: false,
          };
        }
        return { text: "Package complete.", toolCalls: [], done: true };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task for Adobe, Amazon, Salesforce, Google, Intel, Meta, Microsoft, Nvidia, and Oracle and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 4,
    });

    const packageEvents = r.trace.filter((event) => event.tool === "create_btb_deliverable_package");
    expect(packageEvents[0]?.result).toMatchObject({
      ok: false,
      error: "btb_package_task_coverage_gate_failed",
      missingTickers: expect.arrayContaining(["ADBE", "AMZN", "CRM", "GOOGL"]),
    });
    expect(packageEvents[1]?.result).toMatchObject({ ok: true });
    expect(executeCount).toBe(1);
    expect(r.stopReason).toBe("done");
    expect(r.exhausted).toBe(false);
  });

  it("uses a successful BTB package tool result as the terminal final text", async () => {
    const { rt } = setup();
    let turn = 0;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({
        taskId: z.string(),
        title: z.string(),
        narrative: z.string(),
        rows: z.array(z.object({
          label: z.string(),
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        })),
        sourceArtifactIds: z.array(z.string()),
      }),
      execute: async () => ({
        ok: true,
        artifacts: [
          { id: "xlsx", title: "btb-test-package.xlsx", kind: "note" },
          { id: "xlsm", title: "btb-test-package.xlsm", kind: "note" },
          { id: "pptx", title: "btb-test-package.pptx", kind: "note" },
          { id: "docx", title: "btb-test-package.docx", kind: "note" },
          { id: "pdf", title: "btb-test-package.pdf", kind: "note" },
        ],
      }),
    };
    const model = {
      name: "btb-package-final-text",
      async next() {
        turn += 1;
        if (turn === 1) {
          return {
            text: "I still need to read the files.",
            toolCalls: [{
              id: "pkg",
              tool: "create_btb_deliverable_package",
              args: {
                taskId: "btb-test",
                title: "LVS valuation package",
                narrative: "Package covers LVS, REGAL, and XYZ with DCF outputs.",
                rows: [{ label: "LVS", values: { equityValue: 123 } }],
                sourceArtifactIds: ["source-1"],
              },
            }],
            done: false,
          };
        }
        return { text: "", toolCalls: [], done: true };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test for LVS, REGAL, and XYZ and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 2,
    });

    expect(r.stopReason).toBe("done");
    expect(r.finalText).toContain("BTB task btb-test complete.");
    expect(r.finalText).toContain("Deliverable package created: LVS valuation package.");
    expect(r.finalText).toContain("btb-test-package.xlsx");
    expect(r.finalText).not.toMatch(/still need|let me read/i);
    expect(turn).toBe(1);
  });

  it("rejects malformed BTB task ids with provider tool-call spillover before files are created", async () => {
    const { rt } = setup();
    let executeCount = 0;
    let sawTaskIdMismatch = false;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({
        taskId: z.string(),
        title: z.string(),
        narrative: z.string(),
        rows: z.array(z.object({
          label: z.string(),
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        })),
        sourceArtifactIds: z.array(z.string()),
      }),
      execute: async () => {
        executeCount += 1;
        return {
          ok: true,
          artifacts: [{ id: "xlsx", title: "btb-test-package.xlsx", kind: "note" }],
        };
      },
    };
    const model = {
      name: "btb-malformed-task-id",
      async next({ messages }: { messages: AgentMessage[] }) {
        sawTaskIdMismatch ||= messages.some((message) =>
          message.role === "tool" && !!message.content?.includes("btb_package_task_id_mismatch"));
        if (!sawTaskIdMismatch) {
          return {
            toolCalls: [{
              id: "pkg-bad",
              tool: "create_btb_deliverable_package",
              args: {
                taskId: "btb-707cba99\n<tool_call>read_range<arg_key>artifactId</arg_key>",
                title: "LVS DCF",
                narrative: "Package covers LVS, REGAL, and XYZ.",
                rows: [{ label: "LVS", values: { equityValue: 123 } }],
                sourceArtifactIds: ["source-1"],
              },
            }],
            done: false,
          };
        }
        return {
          toolCalls: [{
            id: "pkg-good",
            tool: "create_btb_deliverable_package",
            args: {
              taskId: "btb-707cba99",
              title: "LVS DCF",
              narrative: "Package covers LVS, REGAL, and XYZ.",
              rows: [{ label: "LVS", values: { equityValue: 123 } }],
              sourceArtifactIds: ["source-1"],
            },
          }],
          done: false,
        };
      },
    };

    const r = await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-707cba99 for LVS, REGAL, and XYZ and create deliverable package",
      model,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 3,
    });

    expect(sawTaskIdMismatch).toBe(true);
    expect(executeCount).toBe(1);
    expect(r.stopReason).toBe("done");
    expect(r.finalText).toContain("BTB task btb-707cba99 complete.");
  });

  it("adds a BTB package contract immediately when resuming an un-packaged run", async () => {
    const { rt } = setup();
    let sawResumeContract = false;
    const packageTool: AgentTool = {
      name: "create_btb_deliverable_package",
      description: "Create the final BTB package.",
      schema: z.object({}),
      execute: async () => ({ ok: true }),
    };
    const readOnly = scriptedModel(({ messages }) => {
      sawResumeContract ||= messages.some((message) =>
        message.role === "user" && !!message.content?.startsWith("BTB PACKAGE CONTRACT:"));
      return { toolCalls: [{ tool: "read_range", args: { elementIds: ["r_rev__variance"] } }] };
    });

    await runAgent({
      rt,
      goal: "Run official BankerToolBench task btb-test and create deliverable package",
      model: readOnly,
      tools: [...ROOM_TOOLS, packageTool],
      maxSteps: 1,
      initialMessages: [
        { role: "user", content: "YOUR TASK: Run official BankerToolBench task btb-test." },
        {
          role: "assistant",
          content: "Reading the sources.",
          toolCalls: [{ id: "read-1", tool: "read_range", args: { elementIds: ["r_rev__variance"] } }],
        },
        { role: "tool", toolCallId: "read-1", toolName: "read_range", content: JSON.stringify([{ id: "r_rev__variance", value: "5", version: 1, locked: null }]) },
      ],
    });

    expect(sawResumeContract).toBe(true);
  });

  it("accounts for two provider failover calls and exact cost from one logical model turn", async () => {
    const { rt } = setup();
    let logicalModelCalls = 0;
    let fallbackPriceCalls = 0;
    const model: AgentModel = {
      name: "mixed-route-failover",
      async next() {
        logicalModelCalls += 1;
        return {
          text: "Summary complete.",
          toolCalls: [],
          done: true,
          usage: {
            inputTokens: 22,
            outputTokens: 14,
            cachedInputTokens: 3,
            modelCalls: 2,
            costUsd: 0.125,
          },
        };
      },
    };

    const result = await runAgent({
      rt,
      goal: "summarize the current room",
      model,
      tools: [],
      maxSteps: 1,
      priceStep: () => {
        fallbackPriceCalls += 1;
        return 999;
      },
    });

    expect(logicalModelCalls).toBe(1);
    expect(fallbackPriceCalls).toBe(0);
    expect(result.usage).toMatchObject({
      inputTokens: 22,
      outputTokens: 14,
      cachedInputTokens: 3,
      modelCalls: 2,
      costUsd: 0.125,
    });
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

  it("time budget settles even when the model adapter ignores its abort signal", async () => {
    const { rt } = setup();
    const neverSettles: AgentModel = {
      name: "ignores-abort",
      next: async () => new Promise(() => undefined),
    };
    const startedAt = Date.now();

    const r = await runAgent({
      rt,
      goal: "bound a provider that never settles",
      model: neverSettles,
      tools: ROOM_TOOLS,
      maxSteps: 1,
      deadlineAt: Date.now() + 30,
      reserveMs: 0,
    });

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(r.stopReason).toBe("time_budget");
    expect(r.handoff?.reason).toBe("time_budget");
    expect(r.usage).toMatchObject({ modelCalls: 0, costKind: "estimated" });
  });

  it("time budget waits briefly for provider usage and route cooldowns to settle", async () => {
    const { rt } = setup();
    const cooldownUntil = Date.now() + 60_000;
    const routeState = { preferredModelId: "fallback", cooldownUntil: {} as Record<string, number> };
    const model: AgentModel = {
      name: "abort-aware-provider",
      routeState: () => routeState,
      next: async ({ signal }) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          setTimeout(() => {
            routeState.cooldownUntil.primary = cooldownUntil;
            reject(Object.assign(new Error("provider aborted after reporting usage"), {
              usage: {
                inputTokens: 23,
                outputTokens: 7,
                cachedInputTokens: 5,
                cacheCreationInputTokens: 2,
                modelCalls: 1,
                costUsd: 0.015,
                costKind: "exact",
              },
            }));
          }, 5);
        }, { once: true });
      }),
    };

    const result = await runAgent({
      rt,
      goal: "capture partial provider usage before handoff",
      model,
      tools: ROOM_TOOLS,
      maxSteps: 1,
      deadlineAt: Date.now() + 30,
      reserveMs: 0,
    });

    expect(result.stopReason).toBe("time_budget");
    expect(result.usage).toMatchObject({
      inputTokens: 23,
      outputTokens: 7,
      cachedInputTokens: 5,
      cacheCreationInputTokens: 2,
      modelCalls: 1,
      costUsd: 0.015,
      costKind: "exact",
    });
    expect(result.modelRouteState).toMatchObject({
      preferredModelId: "fallback",
      cooldownUntil: { primary: cooldownUntil },
    });
  });

  it("time budget settles and signals a tool that ignores cancellation", async () => {
    const { rt } = setup();
    let seenSignal: AbortSignal | undefined;
    const hangingTool: AgentTool = {
      name: "hang_tool",
      description: "never settles",
      schema: z.object({}),
      execute: async (_args, _rt, context) => {
        seenSignal = context?.signal;
        return new Promise(() => undefined);
      },
    };
    const model = scriptedModel(() => ({ toolCalls: [{ tool: "hang_tool", args: {} }] }), "hanging-tool-model");
    const startedAt = Date.now();

    let thrown: unknown;
    try {
      await runAgent({
        rt,
        goal: "bound a tool that never settles",
        model,
        tools: [hangingTool],
        maxSteps: 1,
        deadlineAt: Date.now() + 30,
        reserveMs: 0,
      });
    } catch (error) {
      thrown = error;
    }

    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(seenSignal?.aborted).toBe(true);
    expect(thrown).toBeInstanceOf(AgentRunError);
    expect((thrown as AgentRunError).partial.trace[0]).toMatchObject({
      tool: "hang_tool",
      result: { ok: false, error: expect.stringContaining("time budget") },
    });
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
    expect(first.handoff?.terminalReason).toBeUndefined();
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

  it("feeds provider argument validation exceptions back as recoverable tool results", async () => {
    const { rt } = setup();
    let sawRecoverable = false;
    const invalidArgTool: AgentTool = {
      name: "source_open_literal",
      description: "source row reader",
      schema: z.object({ artifactId: z.string(), row: z.number() }),
      execute: async () => {
        throw new Error('ArgumentValidationError: Value does not match validator. Path: .artifactId Validator: v.id("artifacts")');
      },
    };
    const model = {
      name: "recoverable-arg-error",
      async next({ messages }: { messages: AgentMessage[] }) {
        sawRecoverable ||= messages.some((message) =>
          message.role === "tool" && !!message.content?.includes("Retry source_open_literal with clean argument values"));
        if (!sawRecoverable) {
          return {
            toolCalls: [{ id: "bad-source", tool: "source_open_literal", args: { artifactId: "filename.xlsx\", \"", row: 2 } }],
            done: false,
          };
        }
        return { text: "Recovered from invalid source argument.", toolCalls: [], done: true };
      },
    };

    const result = await runAgent({
      rt,
      goal: "read source row",
      model,
      tools: [invalidArgTool],
      maxSteps: 2,
    });

    expect(sawRecoverable).toBe(true);
    expect(result.stopReason).toBe("done");
    expect(result.trace[0]).toMatchObject({
      tool: "source_open_literal",
      result: { ok: false, error: "tool_argument_error", failureKind: "invalid_arg_type" },
    });
  });
});
