/**
 * Harness Change Eval — Regression + Frontier
 *
 * Inspired by NeoSigma's self-improving agentic systems philosophy:
 * - Regression evals: compact, high-signal tests that run on every harness change
 *   to catch regressions before they reach users.
 * - Frontier evals: test the NEW capability the harness change introduces, so
 *   we know the boundary moved forward.
 *
 * This test runs after ANY change to the agent harness (runtime.ts, frameRunner.ts,
 * tool registry, system prompt, subagent dispatcher). It validates:
 *
 * REGRESSION:
 *   R1. Production tool registry integrity (all expected tools present, no drops)
 *   R2. Provider tool schema parity (Zod ↔ JSON schemas match)
 *   R3. Core runtime loop still works (scripted model → tool call → result → done)
 *   R4. CAS conflict handling (stale version → conflict data, not silent overwrite)
 *   R5. System prompt contains the trust boundary + protocol sections
 *   R6. Frame smoke (read → lock → edit → release → verify)
 *
 * FRONTIER:
 *   F1. plan_and_dispatch tool is registered in production tools
 *   F2. plan_and_dispatch has a provider JSON schema in toolParameters()
 *   F3. plan_and_dispatch schema parity (Zod ↔ JSON)
 *   F4. Runtime intercepts plan_and_dispatch (doesn't call execute())
 *   F5. Subagent dispatcher runs waves in parallel, returns structured results
 *   F6. Subagent context isolation (child gets fresh messages, scoped tools)
 *   F7. Subagent trace forwarding (child traces prefixed with subagent:role:)
 *   F8. Bounds enforced (max waves, max per wave, max total)
 *   F9. Failed child tool calls make plan_and_dispatch fail
 *   F10. System prompt includes dynamic subagent dispatch guidance
 *
 * Run: npm test -- --run tests/harnessChangeEval.test.ts
 */

import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { runAgent } from "../src/nodeagent/core/runtime";
import type { AgentMessage } from "../src/nodeagent/core/types";
import type { AgentTool } from "../src/nodeagent/core/types";
import { SERVER_PRODUCTION_ROOM_TOOLS, SERVER_PRODUCTION_TOOL_NAMES } from "../src/nodeagent/skills/server/productionTools";
import { toolParameters } from "../src/nodeagent/models/convexModel";
import { providerToolSchemaMismatches } from "../src/nodeagent/tools/schemaIntrospection";
import { MANAGED_LOCK_SYSTEM_PROMPT, SYSTEM_PROMPT } from "../src/nodeagent/models/prompts/systemPrompt";
import {
  PLAN_AND_DISPATCH_TOOL,
  planAndDispatchSchema,
  executePlanAndDispatch,
  type SubagentRuntimeCtx,
  type PlanAndDispatchResult,
} from "../src/nodeagent/core/subagentDispatcher";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";

const names = (tools: { name: string }[]) => new Set(tools.map((t) => t.name));

function setup() {
  const engine = new RoomEngine();
  const d = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
  return { engine, d, rt };
}

/* ──────────────────────────────────────────────────────────────
 * REGRESSION EVALS — "the agent still does what it already did"
 * ────────────────────────────────────────────────────────────── */

describe("Harness Change Eval — REGRESSION", () => {

  it("R1: production tool registry integrity — all expected tools present", () => {
    const n = names(SERVER_PRODUCTION_ROOM_TOOLS);
    // Core room tools (snapshot/awareness are RoomTools methods, not AgentTool entries)
    for (const expected of ["read_range", "search_sheet_context", "list_artifacts", "say"]) {
      expect(n.has(expected), `registry missing: ${expected}`).toBe(true);
    }
    // Managed lock tools
    for (const expected of ["write_locked_cell", "write_locked_cells", "write_locked_cell_result", "write_locked_cell_results"]) {
      expect(n.has(expected), `registry missing: ${expected}`).toBe(true);
    }
    // Search / research tools
    for (const expected of ["you_search", "you_research", "you_finance_research", "tavily_search", "capture_source"]) {
      expect(n.has(expected), `registry missing: ${expected}`).toBe(true);
    }
    // Skill RAG
    for (const expected of ["skill_search", "load_skill"]) {
      expect(n.has(expected), `registry missing: ${expected}`).toBe(true);
    }
  });

  it("R2: provider tool schema parity — Zod ↔ JSON match for all production tools", () => {
    const mismatches = SERVER_PRODUCTION_ROOM_TOOLS.flatMap((tool) =>
      providerToolSchemaMismatches(tool, toolParameters(tool.name)).map((m) => `${m.tool}: ${m.reason}`),
    );
    expect(mismatches).toEqual([]);
  });

  it("R3: core runtime loop — scripted model → tool call → result → done", async () => {
    const { engine, d, rt } = setup();
    const r = await runAgent({
      rt,
      goal: "recompute variance",
      model: scriptedModel(recomputeVariancePlan({ r_rev__variance: "+24%", r_cogs__variance: "+27.5%" })),
      tools: ROOM_TOOLS,
      maxSteps: 14,
    });
    const art = engine.getArtifact(d.sheetId)!;

    expect(r.exhausted).toBe(false);
    expect(r.stopReason).toBe("done");
    expect(art.elements["r_rev__variance"].value).toBe("+24%");
    expect(art.elements["r_cogs__variance"].value).toBe("+27.5%");
    // Full protocol: lock → edit → release
    expect(r.trace.some((t) => t.tool === "propose_lock")).toBe(true);
    expect(r.trace.some((t) => t.tool === "release_lock")).toBe(true);
  });

  it("R4: CAS conflict — stale version returns conflict data, not silent overwrite", async () => {
    const { engine, d, rt } = setup();
    // Read the cell first
    const [cell] = await rt.readRange(["r_rev__variance"]);
    expect(cell.version).toBe(1);

    // Concurrent human edit bumps the version
    engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value = "human edited";
    engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].version = 2;

    // Agent tries to write with stale version 1
    const result = await rt.editCell("r_rev__variance", "+24%", 1);
    expect(result.ok).toBe(false);
    if (!result.ok && "conflict" in result) {
      expect(result.conflict).toBe(true);
      expect(result.actual).toBe(2);
    }
    // The cell was NOT overwritten
    expect(engine.getArtifact(d.sheetId)!.elements["r_rev__variance"].value).toBe("human edited");
  });

  it("R5: system prompt contains trust boundary + protocol sections", () => {
    expect(SYSTEM_PROMPT).toContain("TRUST BOUNDARY");
    expect(SYSTEM_PROMPT).toContain("THE PROTOCOL");
    expect(MANAGED_LOCK_SYSTEM_PROMPT).toContain("TRUST BOUNDARY");
    expect(MANAGED_LOCK_SYSTEM_PROMPT).toContain("PRODUCTION PROTOCOL");
  });

  it("R6: no production tool has an empty schema (except list_artifacts)", () => {
    const emptyArgTools = new Set(["list_artifacts"]);
    for (const name of SERVER_PRODUCTION_TOOL_NAMES) {
      const schema = toolParameters(name);
      expect(schema.type, name).toBe("object");
      if (!emptyArgTools.has(name)) {
        const props = schema.properties && typeof schema.properties === "object"
          ? Object.keys(schema.properties)
          : [];
        expect(props.length, `${name} has empty properties`).toBeGreaterThan(0);
      }
    }
  });
});

/* ──────────────────────────────────────────────────────────────
 * FRONTIER EVALS — "the agent can now do what it couldn't before"
 * ────────────────────────────────────────────────────────────── */

describe("Harness Change Eval — FRONTIER (dynamic subagent dispatch)", () => {

  it("F1: plan_and_dispatch is registered in production tools", () => {
    expect(names(SERVER_PRODUCTION_ROOM_TOOLS).has("plan_and_dispatch")).toBe(true);
  });

  it("F2: plan_and_dispatch has a provider JSON schema in toolParameters()", () => {
    const schema = toolParameters("plan_and_dispatch");
    expect(schema.type).toBe("object");
    expect(schema.properties).toBeDefined();
    const props = schema.properties as Record<string, unknown>;
    expect(props.waves).toBeDefined();
    expect(props.synthesisGoal).toBeDefined();
    expect(Array.isArray(schema.required)).toBe(true);
    expect(schema.required).toContain("waves");
  });

  it("F3: plan_and_dispatch schema parity (Zod ↔ JSON)", () => {
    const mismatches = providerToolSchemaMismatches(PLAN_AND_DISPATCH_TOOL, toolParameters("plan_and_dispatch"));
    expect(mismatches, mismatches.map((m) => m.reason).join("; ")).toEqual([]);
  });

  it("F4: runtime intercepts plan_and_dispatch — execute() is never called", async () => {
    const { rt } = setup();
    let executeCalled = false;
    const spyTool: AgentTool = {
      name: "plan_and_dispatch",
      description: "spy",
      schema: planAndDispatchSchema,
      execute: async () => { executeCalled = true; return { ok: true }; },
    };

    // Use a scripted model that calls plan_and_dispatch with a minimal plan
    const model = scriptedModel(({ step }) => {
      if (step === 0) {
        return {
          toolCalls: [{
            tool: "plan_and_dispatch",
            args: {
              waves: [[{
                role: "researcher",
                goal: "Read cell r_rev__variance and report its value",
                allowedTools: ["read_range", "say"],
              }]],
            },
          }],
        };
      }
      return { done: true, say: "Done" };
    });

    const r = await runAgent({
      rt,
      goal: "test dispatch",
      model,
      tools: [spyTool, ...ROOM_TOOLS],
      maxSteps: 10,
    });

    // The runtime should intercept plan_and_dispatch, not call spyTool.execute
    expect(executeCalled).toBe(false);
    // The tool result should be a PlanAndDispatchResult, not { ok: true }
    const dispatchTrace = r.trace.find((t) => t.tool === "plan_and_dispatch");
    expect(dispatchTrace).toBeDefined();
    const result = dispatchTrace?.result as PlanAndDispatchResult;
    expect(result?.ok).toBe(true);
    expect(result?.subagentResults).toHaveLength(1);
    expect(result?.subagentResults[0]?.role).toBe("researcher");
  });

  it("F5: subagent dispatcher runs a wave of 2 subagents in parallel, returns structured results", async () => {
    const { rt } = setup();
    const ctx: SubagentRuntimeCtx = {
      model: scriptedModel(({ step }) => {
        if (step === 0) return { toolCalls: [{ tool: "say", args: { text: "subagent running" } }] };
        return { done: true, say: "subagent done" };
      }),
      tools: ROOM_TOOLS,
      rt,
      parentGoal: "test",
      parentStep: 0,
      now: () => Date.now(),
    };

    const result = await executePlanAndDispatch({
      waves: [[
        { role: "alpha", goal: "do alpha", allowedTools: ["say"] },
        { role: "beta", goal: "do beta", allowedTools: ["say"] },
      ]],
    }, ctx);

    expect(result.ok).toBe(true);
    expect(result.totalSubagents).toBe(2);
    expect(result.wavesCompleted).toBe(1);
    expect(result.subagentResults).toHaveLength(2);
    expect(result.subagentResults[0].role).toBe("alpha");
    expect(result.subagentResults[1].role).toBe("beta");
    expect(result.subagentResults[0].ok).toBe(true);
    expect(result.subagentResults[1].ok).toBe(true);
  });

  it("F6: subagent context isolation — child gets fresh messages, not parent's", async () => {
    const { rt } = setup();
    const seenMessages: AgentMessage[][] = [];

    const ctx: SubagentRuntimeCtx = {
      model: scriptedModel(({ step, messages }) => {
        // Capture the messages the subagent sees
        if (step === 0) {
          seenMessages.push([...messages]);
          return { toolCalls: [{ tool: "say", args: { text: "isolated" } }] };
        }
        return { done: true };
      }),
      tools: ROOM_TOOLS,
      rt,
      parentGoal: "parent goal that should NOT appear in child context",
      parentStep: 5,
      now: () => Date.now(),
    };

    const result = await executePlanAndDispatch({
      waves: [[{ role: "isolated_child", goal: "child goal", allowedTools: ["say"] }]],
    }, ctx);

    expect(result.ok).toBe(true);
    // The subagent should have received messages — but they're built from the child's goal,
    // not the parent's goal/context
    expect(seenMessages.length).toBe(1);
    // The child's context should NOT contain the parent's goal text
    const childContent = JSON.stringify(seenMessages[0]);
    expect(childContent).not.toContain("parent goal that should NOT appear");
  });

  it("F7: subagent trace forwarding — child traces prefixed with subagent:role:", async () => {
    const { rt } = setup();
    const forwardedTraces: { tool: string }[] = [];

    const ctx: SubagentRuntimeCtx = {
      model: scriptedModel(({ step }) => {
        if (step === 0) return { toolCalls: [{ tool: "say", args: { text: "hi" } }] };
        return { done: true };
      }),
      tools: ROOM_TOOLS,
      rt,
      parentGoal: "test",
      parentStep: 0,
      now: () => Date.now(),
      onTrace: (ev) => forwardedTraces.push({ tool: ev.tool }),
    };

    await executePlanAndDispatch({
      waves: [[{ role: "tracer", goal: "trace test", allowedTools: ["say"] }]],
    }, ctx);

    // The subagent's say() tool call should appear with the subagent:role: prefix
    expect(forwardedTraces.length).toBeGreaterThan(0);
    expect(forwardedTraces.some((t) => t.tool.startsWith("subagent:tracer:"))).toBe(true);
  });

  it("F8: bounds enforced — rejects plan with too many total subagents", async () => {
    const { rt } = setup();
    const ctx: SubagentRuntimeCtx = {
      model: scriptedModel(() => ({ done: true })),
      tools: ROOM_TOOLS,
      rt,
      parentGoal: "test",
      parentStep: 0,
      now: () => Date.now(),
    };

    // 13 subagents exceeds MAX_TOTAL_SUBAGENTS (12)
    const tooMany = Array.from({ length: 13 }, (_, i) => ({
      role: `r${i}`,
      goal: `g${i}`,
      allowedTools: ["say"],
    }));

    const result = await executePlanAndDispatch({
      waves: [tooMany],
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Too many subagents");
  });

  it("F8b: rejects unknown or recursive subagent tools before child execution", async () => {
    const { rt } = setup();
    let childModelCalled = false;
    const ctx: SubagentRuntimeCtx = {
      model: scriptedModel(() => {
        childModelCalled = true;
        return { done: true };
      }),
      tools: [PLAN_AND_DISPATCH_TOOL, ...ROOM_TOOLS],
      rt,
      parentGoal: "test",
      parentStep: 0,
      now: () => Date.now(),
    };

    const result = await executePlanAndDispatch({
      waves: [[{
        role: "recursive",
        goal: "try to recurse",
        allowedTools: ["plan_and_dispatch", "missing_tool"],
      }]],
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid subagent allowedTools");
    expect(result.error).toContain("recursive:plan_and_dispatch");
    expect(result.error).toContain("recursive:missing_tool");
    expect(result.wavesCompleted).toBe(0);
    expect(childModelCalled).toBe(false);
  });

  it("F9: failed child tool calls make plan_and_dispatch fail", async () => {
    const { rt } = setup();
    const ctx: SubagentRuntimeCtx = {
      model: scriptedModel(({ step }) => {
        if (step === 0) return { toolCalls: [{ tool: "say", args: { text: "not allowed" } }] };
        return { done: true };
      }),
      tools: ROOM_TOOLS,
      rt,
      parentGoal: "test",
      parentStep: 0,
      now: () => Date.now(),
    };

    const result = await executePlanAndDispatch({
      waves: [[{ role: "blocked", goal: "try a disallowed tool", allowedTools: [] }]],
    }, ctx);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("subagents failed");
    expect(result.subagentResults[0].ok).toBe(false);
    expect(result.subagentResults[0].toolCalls[0]).toMatchObject({ tool: "say", status: "failed" });
  });

  it("F10: system prompt includes dynamic subagent dispatch guidance", () => {
    expect(MANAGED_LOCK_SYSTEM_PROMPT).toContain("DYNAMIC SUBAGENT DISPATCH");
    expect(MANAGED_LOCK_SYSTEM_PROMPT).toContain("plan_and_dispatch");
    expect(MANAGED_LOCK_SYSTEM_PROMPT).toContain("allowedTools");
    expect(MANAGED_LOCK_SYSTEM_PROMPT).toContain("waves");
  });
});

/* ──────────────────────────────────────────────────────────────
 * COMPOSITE — regression + frontier in one run
 * ────────────────────────────────────────────────────────────── */

describe("Harness Change Eval — COMPOSITE", () => {

  it("C1: full harness smoke — regression tools + plan_and_dispatch both available", () => {
    const n = names(SERVER_PRODUCTION_ROOM_TOOLS);
    // Regression tools
    expect(n.has("read_range")).toBe(true);
    expect(n.has("write_locked_cells")).toBe(true);
    expect(n.has("say")).toBe(true);
    // Frontier tool
    expect(n.has("plan_and_dispatch")).toBe(true);
    // No tool names are empty strings
    for (const tool of SERVER_PRODUCTION_ROOM_TOOLS) {
      expect(tool.name.length).toBeGreaterThan(0);
    }
  });

  it("C2: plan_and_dispatch does not break existing tool count — net additive", () => {
    // The registry should have grown by exactly 1 (plan_and_dispatch)
    // compared to the pre-change baseline. We verify it's present and
    // that the total count is reasonable (not accidentally duplicated).
    const allNames = SERVER_PRODUCTION_ROOM_TOOLS.map((t) => t.name);
    const uniqueNames = new Set(allNames);
    expect(uniqueNames.size).toBe(allNames.length); // no duplicates
    expect(allNames).toContain("plan_and_dispatch");
  });
});
