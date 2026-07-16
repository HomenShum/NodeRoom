import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createVerifiedWorkbookWorkflowHook,
  goalRequiresVerifiedWorkbookWorkflow,
  runAgent,
  scriptedModel,
  PRODUCTION_ROOM_TOOLS,
  type AgentMessage,
  type AgentTool,
  type RoomTools,
} from "../src/nodeagent/index";

const OPERATION = { elementId: "B2", formula: "=A2*2", result: 20, numFmt: "0.00" };
const DEFAULT_TEST_BASE_VERSION = 0;

function authoritativeOperations(
  operations: Array<Record<string, unknown>>,
  versions: Record<string, number> = {},
): Array<Record<string, unknown>> {
  return operations.map((operation) => ({
    ...operation,
    baseVersion: typeof operation.baseVersion === "number"
      ? operation.baseVersion
      : versions[String(operation.elementId)] ?? DEFAULT_TEST_BASE_VERSION,
  }));
}

function boundOperations(
  operations: Array<Record<string, unknown>>,
  versions: Record<string, number> = {},
): Array<Record<string, unknown>> {
  return authoritativeOperations(operations, versions).map((operation) => ({
    ...operation,
    ...(typeof operation.formula === "string" ? { formula: operation.formula.replace(/^=/, "") } : {}),
  }));
}

function preflightResult(
  artifactId: string,
  operations: Array<Record<string, unknown>>,
  versions: Record<string, number> = {},
) {
  return {
    ok: true,
    status: "passed",
    artifactId,
    phase: "preflight",
    approvedOperations: authoritativeOperations(operations, versions),
  };
}

function workbookTools(
  writeResult: unknown = { ok: true },
  onWrite?: (args: unknown) => void,
  preflightVersions: Record<string, number> = {},
): AgentTool[] {
  return [
    {
      name: "inspect_workbook",
      description: "Inspect workbook.",
      schema: z.object({ instruction: z.string(), artifactId: z.string().optional() }),
      execute: async (args: { artifactId?: string }) => ({ ok: true, artifactId: args.artifactId ?? "sheet-1" }),
    },
    {
      name: "verify_workbook",
      description: "Verify workbook.",
      schema: z.object({
        instruction: z.string(),
        artifactId: z.string().optional(),
        operations: z.array(z.object({
          elementId: z.string(),
          baseVersion: z.number().int().optional(),
          formula: z.string().optional(),
          value: z.unknown().optional(),
          result: z.unknown().optional(),
          numFmt: z.string().optional(),
          fontColor: z.string().optional(),
        })),
        afterWrite: z.boolean().optional(),
      }),
      execute: async (args: {
        artifactId?: string;
        operations: Array<Record<string, unknown>>;
        afterWrite?: boolean;
      }) => args.afterWrite === false
        ? preflightResult(args.artifactId ?? "sheet-1", args.operations, preflightVersions)
        : {
          ok: true,
          status: "passed",
          artifactId: args.artifactId ?? "sheet-1",
          phase: "post_write",
        },
    },
    {
      name: "write_locked_cells",
      description: "Write workbook cells.",
      schema: z.object({
        artifactId: z.string().optional(),
        ops: z.array(z.object({
          elementId: z.string(),
          baseVersion: z.number().int().optional(),
          formula: z.string().optional(),
          value: z.unknown().optional(),
          result: z.unknown().optional(),
          numFmt: z.string().optional(),
          fontColor: z.string().optional(),
        })),
      }),
      execute: async (args: unknown) => {
        onWrite?.(args);
        return writeResult;
      },
    },
  ];
}

function runWorkbookAgent(args: {
  goal?: string;
  model: ReturnType<typeof scriptedModel>;
  tools?: AgentTool[];
  rt?: RoomTools;
  initialMessages?: AgentMessage[];
  maxSteps?: number;
}) {
  return runAgent({
    rt: args.rt ?? ({} as RoomTools),
    goal: args.goal ?? "Complete this SpreadsheetBench workbook formula task.",
    model: args.model,
    tools: args.tools ?? workbookTools(),
    hooks: [createVerifiedWorkbookWorkflowHook()],
    initialMessages: args.initialMessages,
    contextBuilder: async () => [{ role: "user", content: "Complete the workbook." }],
    maxSteps: args.maxSteps ?? 10,
  });
}

describe("verified workbook workflow hook", () => {
  it("blocks an unverified write and requires inspect, preflight, matching write, and post-write verification", async () => {
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [OPERATION] } }] };
      if (turn === 2) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1" } }] };
      if (turn === 3) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: false } }] };
      if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [OPERATION] } }] };
      if (turn === 5) return { say: "Workbook complete.", done: true };
      if (turn === 6) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: true } }] };
      return { say: "Verified workbook complete.", done: true };
    });

    const result = await runWorkbookAgent({ model });

    expect(result.stopReason).toBe("done");
    expect(result.trace[0]).toMatchObject({
      tool: "write_locked_cells",
      result: {
        ok: false,
        error: "tool_blocked",
        failureKind: "evidence_required",
      },
    });
    expect(result.trace.filter((event) => event.tool === "verify_workbook")).toHaveLength(2);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("POST_WRITE_VERIFICATION_REQUIRED"))).toBe(true);
    expect(result.finalText).toBe("Verified workbook complete.");
  });

  it("blocks a managed write that does not exactly match the passing preflight", async () => {
    let turn = 0;
    const wrongOperation = { ...OPERATION, elementId: "B3" };
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: false } }] };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [wrongOperation] } }] };
      if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [OPERATION] } }] };
      if (turn === 5) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: true } }] };
      return { say: "Correct plan verified.", done: true };
    });

    const result = await runWorkbookAgent({ model });
    const mismatch = result.trace.find((event) =>
      event.tool === "write_locked_cells"
      && (event.result as { reason?: string }).reason?.includes("write_plan_mismatch"));

    expect(mismatch).toBeDefined();
    expect(result.stopReason).toBe("done");
    expect(result.finalText).toBe("Correct plan verified.");
  });

  it("preserves semantic element ids while canonicalizing only genuine A1 references", async () => {
    const operations = [
      { elementId: "r_rev__variance", value: 1_300 },
      { elementId: "$b$2", value: 20 },
      { elementId: "'Q3 Variance'!$j$15:$j$17", value: "ready" },
    ];
    const writes: unknown[] = [];
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair workbook", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair workbook", artifactId: "sheet-1", operations, afterWrite: false } }] };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: operations } }] };
      if (turn === 4) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair workbook", artifactId: "sheet-1", operations, afterWrite: true } }] };
      return { say: "Identifiers verified.", done: true };
    });

    const result = await runWorkbookAgent({
      model,
      tools: workbookTools({ ok: true }, (args) => writes.push(args)),
    });

    expect(writes).toEqual([{
      artifactId: "sheet-1",
      ops: [
        { elementId: "r_rev__variance", baseVersion: 0, value: 1_300 },
        { elementId: "B2", baseVersion: 0, value: 20 },
        { elementId: "Q3 Variance!J15:J17", baseVersion: 0, value: "ready" },
      ],
    }]);
    expect(result.stopReason).toBe("done");
  });

  it("includes canonical font color in the approved workflow signature", async () => {
    const approved = { ...OPERATION, fontColor: "#aa00cc" };
    const writes: unknown[] = [];
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "style formula", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "style formula", artifactId: "sheet-1", operations: [approved], afterWrite: false } }] };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [{ ...approved, fontColor: "#00aacc" }] } }] };
      if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [{ ...approved, fontColor: "AA00CC" }] } }] };
      if (turn === 5) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "style formula", artifactId: "sheet-1", operations: [approved], afterWrite: true } }] };
      return { say: "Color plan verified.", done: true };
    });

    const result = await runWorkbookAgent({
      model,
      tools: workbookTools({ ok: true }, (args) => writes.push(args)),
    });
    const mismatch = result.trace.find((event) =>
      event.tool === "write_locked_cells"
      && (event.result as { reason?: string }).reason?.includes("write_plan_mismatch"));

    expect(mismatch).toBeDefined();
    expect(writes).toEqual([{
      artifactId: "sheet-1",
      ops: [{ ...boundOperations([approved])[0], fontColor: "FFAA00CC" }],
    }]);
    expect(result.stopReason).toBe("done");
  });

  it("binds a truncated large write to the complete preflight-approved plan", async () => {
    const operations = Array.from({ length: 46 }, (_, index) => {
      const row = index + 2;
      return { elementId: `B${row}`, formula: `=A${row}*2`, result: row * 2, numFmt: "0.00" };
    });
    const writes: unknown[] = [];
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations, afterWrite: false } }] };
      if (turn === 3) return {
        toolCalls: [{
          tool: "write_locked_cells",
          args: {
            artifactId: "sheet-1\n<tool_call>write_locked_cells<arg_key>artifactId</arg_key>",
            ops: [operations[17]],
          },
        }],
      };
      if (turn === 4) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations, afterWrite: true } }] };
      return { say: "Large plan committed and verified.", done: true };
    });

    const result = await runWorkbookAgent({
      model,
      tools: workbookTools({ ok: true }, (args) => writes.push(args)),
    });

    expect(result.stopReason).toBe("done");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ artifactId: "sheet-1", ops: boundOperations(operations) });
    expect((writes[0] as { ops: unknown[] }).ops).toHaveLength(46);
    expect(result.trace.find((event) => event.tool === "write_locked_cells")?.args).toEqual(writes[0]);
  });

  it("requires the preflight-approved baseVersion instead of accepting a silent rebase", async () => {
    const approvedOperations = [
      { ...OPERATION, baseVersion: 7 },
      { elementId: "C2", formula: "=B2+1", result: 21, numFmt: "0.00", baseVersion: 11 },
    ];
    const writes: unknown[] = [];
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: approvedOperations, afterWrite: false } }] };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [{ ...approvedOperations[0], baseVersion: 8 }] } }] };
      if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [approvedOperations[1]] } }] };
      if (turn === 5) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: approvedOperations, afterWrite: true } }] };
      return { say: "Approved CAS plan verified.", done: true };
    });

    const result = await runWorkbookAgent({
      model,
      tools: workbookTools({ ok: true }, (args) => writes.push(args)),
    });
    const mismatch = result.trace.find((event) =>
      event.tool === "write_locked_cells"
      && (event.result as { reason?: string }).reason?.includes("write_plan_mismatch"));

    expect(mismatch).toBeDefined();
    expect(writes).toEqual([{ artifactId: "sheet-1", ops: boundOperations(approvedOperations) }]);
    expect(result.stopReason).toBe("done");
  });

  it("binds model-omitted authoritative baseVersions so a concurrent human edit produces a CAS conflict", async () => {
    const artifactId = "sheet-1";
    const targetIds = ["B2", "C2"];
    const cells = new Map([
      [targetIds[0], { value: 10 as unknown, version: 7 }],
      [targetIds[1], { value: 20 as unknown, version: 11 }],
    ]);
    const before = Object.fromEntries([...cells].map(([elementId, cell]) => [elementId, { ...cell }]));
    const editCalls: Array<{ elementId: string; value: unknown; baseVersion: number }> = [];
    const rt = {
      readRange: async (elementIds: string[]) => elementIds.map((elementId) => {
        const cell = cells.get(elementId)!;
        return { id: elementId, value: cell.value, version: cell.version, locked: null };
      }),
      proposeLock: async () => ({ ok: true as const, lockId: "lock-1" }),
      releaseLock: async () => ({ ok: true, merged: [] }),
      editCell: async (elementId: string, value: unknown, baseVersion: number) => {
        const cell = cells.get(elementId)!;
        if (cell.version !== baseVersion) return { ok: false as const, conflict: true as const, expected: baseVersion, actual: cell.version };
        cell.value = value;
        cell.version += 1;
        editCalls.push({ elementId, value, baseVersion });
        return { ok: true as const, version: cell.version };
      },
    } as unknown as RoomTools;
    const operations = [
      { elementId: targetIds[0], value: "+24%" },
      { elementId: targetIds[1], value: "+27.5%" },
    ];
    const productionWrite = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cells")!;
    const authoritativeVersions = {
      [targetIds[0]]: before[targetIds[0]].version,
      [targetIds[1]]: before[targetIds[1]].version,
    };
    const tools = [
      ...workbookTools({ ok: true }, undefined, authoritativeVersions).filter((tool) => tool.name !== "write_locked_cells"),
      productionWrite,
    ];
    let humanEditApplied = false;
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "fill variances", artifactId } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill variances", artifactId, operations, afterWrite: false } }] };
      if (turn === 3) {
        const humanTarget = cells.get(targetIds[1])!;
        humanTarget.value = "+19% human";
        humanTarget.version += 1;
        humanEditApplied = true;
        return {
          toolCalls: [{
            tool: "write_locked_cells",
            args: {
              artifactId: `${artifactId}\n<tool_call>write_locked_cells<arg_key>artifactId</arg_key>`,
              ops: [operations[0]],
            },
          }],
        };
      }
      return { say: "Write encountered a conflict.", done: true };
    });

    const result = await runWorkbookAgent({ model, tools, rt, maxSteps: 4 });
    const write = result.trace.find((event) => event.tool === "write_locked_cells");

    expect(humanEditApplied).toBe(true);
    expect(write?.args).toEqual({ artifactId, ops: boundOperations(operations, authoritativeVersions) });
    expect(write?.result).toMatchObject({
      ok: false,
      conflict: true,
      coordination: { committedCount: 0, fence: "all_target_versions_before_first_write" },
    });
    expect(editCalls).toEqual([]);
    expect(cells.get(targetIds[0])!.value).toEqual(before[targetIds[0]].value);
    expect(cells.get(targetIds[1])!.value).toBe("+19% human");
  });

  it("keeps changed, out-of-plan, and empty commit attempts blocked", async () => {
    const approvedOperations = [
      OPERATION,
      { elementId: "C2", formula: "=B2+1", result: 21, numFmt: "0.00" },
    ];
    const writes: unknown[] = [];
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: approvedOperations, afterWrite: false } }] };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1\n<tool_call>write_locked_cells", ops: [{ ...OPERATION, formula: "=A2*3" }] } }] };
      if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [{ ...OPERATION, elementId: "Z99" }] } }] };
      if (turn === 5) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [] } }] };
      if (turn === 6) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [approvedOperations[1]] } }] };
      if (turn === 7) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: approvedOperations, afterWrite: true } }] };
      return { say: "Only the approved plan was committed.", done: true };
    });

    const result = await runWorkbookAgent({
      model,
      tools: workbookTools({ ok: true }, (args) => writes.push(args)),
      maxSteps: 10,
    });
    const blockedWrites = result.trace.filter((event) =>
      event.tool === "write_locked_cells"
      && (event.result as { reason?: string }).reason?.includes("write_plan_mismatch"));

    expect(blockedWrites).toHaveLength(3);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual({ artifactId: "sheet-1", ops: boundOperations(approvedOperations) });
    expect(result.stopReason).toBe("done");
  });

  it("blocks clean wrong artifacts, malformed batch entries, and excess duplicates", async () => {
    const approvedOperations = [
      OPERATION,
      { elementId: "C2", formula: "=B2+1", result: 21, numFmt: "0.00" },
    ];
    const invalidArgs = [
      { artifactId: "sheet-2", ops: [approvedOperations[0]] },
      { artifactId: "sheet-1", ops: [approvedOperations[0], null] },
      { artifactId: "sheet-1", ops: [approvedOperations[0], approvedOperations[0]] },
    ];

    for (const badArgs of invalidArgs) {
      const writes: unknown[] = [];
      let turn = 0;
      const result = await runWorkbookAgent({
        model: scriptedModel(() => {
          turn += 1;
          if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
          if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: approvedOperations, afterWrite: false } }] };
          if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: badArgs }] };
          if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [approvedOperations[1]] } }] };
          if (turn === 5) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: approvedOperations, afterWrite: true } }] };
          return { say: "Verified.", done: true };
        }),
        tools: workbookTools({ ok: true }, (args) => writes.push(args)),
      });

      expect(result.trace.filter((event) =>
        (event.result as { reason?: string }).reason?.includes("write_plan_mismatch"))).toHaveLength(1);
      expect(writes).toEqual([{ artifactId: "sheet-1", ops: boundOperations(approvedOperations) }]);
      expect(result.stopReason).toBe("done");
    }
  });

  it("persists a bound approved plan and reconstructs pending verification after a workflow slice resume", async () => {
    const operations = [
      OPERATION,
      { elementId: "C2", formula: "=B2+1", result: 21, numFmt: "0.00" },
    ];
    const initialMessages: AgentMessage[] = [
      { role: "user", content: "Complete this SpreadsheetBench workbook formula task." },
      { role: "assistant", content: "", toolCalls: [{ id: "inspect-1", tool: "inspect_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1" } }] },
      { role: "tool", toolCallId: "inspect-1", toolName: "inspect_workbook", content: JSON.stringify({ ok: true, artifactId: "sheet-1" }) },
      { role: "assistant", content: "", toolCalls: [{ id: "preflight-1", tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations, afterWrite: false } }] },
      { role: "tool", toolCallId: "preflight-1", toolName: "verify_workbook", content: JSON.stringify(preflightResult("sheet-1", operations)) },
    ];
    const writes: unknown[] = [];
    const firstSlice = await runWorkbookAgent({
      model: scriptedModel(() => ({ toolCalls: [{ tool: "write_locked_cells", args: { ops: [operations[0]] } }] })),
      initialMessages,
      tools: workbookTools({ ok: true }, (args) => writes.push(args)),
      maxSteps: 1,
    });
    let resumedTurn = 0;
    const result = await runWorkbookAgent({
      model: scriptedModel(() => {
        resumedTurn += 1;
        if (resumedTurn === 1) return { say: "Done before checking.", done: true };
        if (resumedTurn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations, afterWrite: true } }] };
        return { say: "Resumed plan committed and verified.", done: true };
      }),
      initialMessages: firstSlice.messages,
    });

    expect(writes).toEqual([{ artifactId: "sheet-1", ops: boundOperations(operations) }]);
    expect(firstSlice.messages.some((message) =>
      message.role === "assistant"
      && message.toolCalls?.some((call) => call.tool === "write_locked_cells" && (call.args.ops as unknown[])?.length === 2))).toBe(true);
    expect(result.trace.map((event) => event.tool)).toEqual(["verify_workbook"]);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("POST_WRITE_VERIFICATION_REQUIRED"))).toBe(true);
    expect(result.stopReason).toBe("done");
  });

  it("preserves exact evidence-bearing result writes unchanged", async () => {
    const resultWrite = {
      artifactId: "sheet-1",
      elementId: "B2",
      baseVersion: 7,
      formula: "=A2*2",
      result: 20,
      value: 20,
      numFmt: "0.00",
      status: "complete",
      confidence: 0.95,
      evidence: [{ source: "fixture", quote: "A2 is 10" }],
    };
    const observed: unknown[] = [];
    const resultTool: AgentTool = {
      name: "write_locked_cell_result",
      description: "Write an evidence-bearing cell result.",
      schema: z.object({
        artifactId: z.string().optional(),
        elementId: z.string(),
        baseVersion: z.number().int(),
        formula: z.string().optional(),
        result: z.unknown().optional(),
        value: z.unknown(),
        numFmt: z.string().optional(),
        status: z.string(),
        confidence: z.number().optional(),
        evidence: z.array(z.object({ source: z.string(), quote: z.string() })),
      }),
      execute: async (args: unknown) => {
        observed.push(args);
        return { ok: true };
      },
    };
    let turn = 0;
    const result = await runWorkbookAgent({
      model: scriptedModel(() => {
        turn += 1;
        if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
        if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: [{ ...OPERATION, baseVersion: 7 }], afterWrite: false } }] };
        if (turn === 3) return { toolCalls: [{ tool: "write_locked_cell_result", args: resultWrite }] };
        if (turn === 4) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: [{ ...OPERATION, baseVersion: 7 }], afterWrite: true } }] };
        return { say: "Evidence-bearing result verified.", done: true };
      }),
      tools: [...workbookTools(), resultTool],
    });

    expect(observed).toEqual([resultWrite]);
    expect(result.trace.find((event) => event.tool === "write_locked_cell_result")?.args).toEqual(resultWrite);
    expect(result.stopReason).toBe("done");
  });

  it("blocks an artifact-ambiguous subset shared by two approved plans", async () => {
    const operations = [OPERATION, { elementId: "C2", formula: "=B2+1", result: 21, numFmt: "0.00" }];
    const initialMessages: AgentMessage[] = [];
    for (const artifactId of ["sheet-1", "sheet-2"]) {
      initialMessages.push(
        { role: "assistant", content: "", toolCalls: [{ id: `inspect-${artifactId}`, tool: "inspect_workbook", args: { instruction: "fill formulas", artifactId } }] },
        { role: "tool", toolCallId: `inspect-${artifactId}`, toolName: "inspect_workbook", content: JSON.stringify({ ok: true, artifactId }) },
        { role: "assistant", content: "", toolCalls: [{ id: `preflight-${artifactId}`, tool: "verify_workbook", args: { instruction: "fill formulas", artifactId, operations, afterWrite: false } }] },
        { role: "tool", toolCallId: `preflight-${artifactId}`, toolName: "verify_workbook", content: JSON.stringify(preflightResult(artifactId, operations)) },
      );
    }

    const result = await runWorkbookAgent({
      model: scriptedModel(() => ({ toolCalls: [{ tool: "write_locked_cells", args: { ops: [operations[0]] } }] })),
      initialMessages,
      maxSteps: 1,
    });

    expect(result.trace[0]).toMatchObject({
      tool: "write_locked_cells",
      result: { ok: false, error: "tool_blocked", metadata: { stage: "write_plan_mismatch", approvedPlanCount: 2, bindingMatchCount: 2 } },
    });
  });

  it("bounds mismatch metadata for large approved plans", async () => {
    const operations = Array.from({ length: 46 }, (_, index) => ({ elementId: `B${index + 2}`, value: index + 2 }));
    let turn = 0;
    const result = await runWorkbookAgent({
      model: scriptedModel(() => {
        turn += 1;
        if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "fill values", artifactId: "sheet-1" } }] };
        if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill values", artifactId: "sheet-1", operations, afterWrite: false } }] };
        if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [{ elementId: "Z99", value: 99 }] } }] };
        if (turn === 4) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [operations[0]] } }] };
        if (turn === 5) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill values", artifactId: "sheet-1", operations, afterWrite: true } }] };
        return { say: "Verified.", done: true };
      }),
      maxSteps: 8,
    });
    const mismatch = result.trace.find((event) =>
      (event.result as { reason?: string }).reason?.includes("write_plan_mismatch"));
    const metadata = (mismatch?.result as { metadata?: Record<string, unknown> }).metadata;

    expect(metadata?.approvedTargets).toHaveLength(8);
    expect(metadata?.approvedTargetsOmitted).toBe(38);
    expect(metadata).not.toHaveProperty("approvedWrite");
    expect(result.stopReason).toBe("done");
  });

  it("reconstructs a pending post-write verification from durable resume messages", async () => {
    const initialMessages: AgentMessage[] = [
      { role: "user", content: "Complete this SpreadsheetBench workbook formula task." },
      { role: "assistant", content: "", toolCalls: [{ id: "inspect-1", tool: "inspect_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1" } }] },
      { role: "tool", toolCallId: "inspect-1", toolName: "inspect_workbook", content: JSON.stringify({ ok: true, artifactId: "sheet-1" }) },
      { role: "assistant", content: "", toolCalls: [{ id: "preflight-1", tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: false } }] },
      { role: "tool", toolCallId: "preflight-1", toolName: "verify_workbook", content: JSON.stringify(preflightResult("sheet-1", [OPERATION])) },
      { role: "assistant", content: "", toolCalls: [{ id: "write-1", tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: boundOperations([OPERATION]) } }] },
      { role: "tool", toolCallId: "write-1", toolName: "write_locked_cells", content: JSON.stringify({ ok: true }) },
    ];
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { say: "Done before checking.", done: true };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: true } }] };
      return { say: "Resume verification passed.", done: true };
    });

    const result = await runWorkbookAgent({ model, initialMessages });

    expect(result.stopReason).toBe("done");
    expect(result.trace.map((event) => event.tool)).toEqual(["verify_workbook"]);
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("POST_WRITE_VERIFICATION_REQUIRED"))).toBe(true);
  });

  it("allows proposal-only completion when room approval policy prevents an immediate commit", async () => {
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
      if (turn === 2) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: false } }] };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [OPERATION] } }] };
      return { say: "Proposal is awaiting review.", done: true };
    });

    const result = await runWorkbookAgent({
      model,
      tools: workbookTools({ ok: false, pendingApproval: true, proposalIds: ["proposal-1"] }),
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalText).toBe("Proposal is awaiting review.");
    expect(result.messages.some((message) => message.role === "user" && message.content.includes("POST_WRITE_VERIFICATION_REQUIRED"))).toBe(false);
  });

  it("does not impose the multi-step workflow on an exact one-cell scalar edit", async () => {
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      return turn === 1
        ? { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [{ elementId: "B2", value: 10 }] } }] }
        : { say: "B2 updated.", done: true };
    });

    const result = await runWorkbookAgent({ goal: "Set B2 to 10.", model });

    expect(result.stopReason).toBe("done");
    expect(result.trace[0].result).toEqual({ ok: true });
    expect(result.trace).toHaveLength(1);
  });

  it("classifies benchmark and complex workbook tasks without catching scalar edits", () => {
    expect(goalRequiresVerifiedWorkbookWorkflow("Complete SpreadsheetBench V2 task Template/02_04.")).toBe(true);
    expect(goalRequiresVerifiedWorkbookWorkflow("Repair formulas across the uploaded workbook rows.")).toBe(true);
    expect(goalRequiresVerifiedWorkbookWorkflow("Set B2 to 10.")).toBe(false);
    expect(goalRequiresVerifiedWorkbookWorkflow("Inspect the workbook without editing it.")).toBe(false);
  });

  it("normalizes provider-stringified tool arguments before enforcing the workflow", async () => {
    let turn = 0;
    const model = scriptedModel(() => {
      turn += 1;
      if (turn === 1) return { toolCalls: [{ tool: "inspect_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1" } }] };
      if (turn === 2) return {
        toolCalls: [{
          tool: "verify_workbook",
          args: JSON.stringify({ instruction: "repair formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: "false" }) as unknown as Record<string, unknown>,
        }],
      };
      if (turn === 3) return { toolCalls: [{ tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [OPERATION] } }] };
      if (turn === 4) return { toolCalls: [{ tool: "verify_workbook", args: { instruction: "repair formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: true } }] };
      return { say: "Stringified preflight recovered.", done: true };
    });

    const result = await runWorkbookAgent({ model });

    expect(result.stopReason).toBe("done");
    expect(result.trace.filter((event) => event.tool === "verify_workbook").map((event) => (event.args as { afterWrite?: boolean }).afterWrite)).toEqual([false, true]);
  });
});
