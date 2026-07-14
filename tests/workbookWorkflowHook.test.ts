import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createVerifiedWorkbookWorkflowHook,
  goalRequiresVerifiedWorkbookWorkflow,
  runAgent,
  scriptedModel,
  type AgentMessage,
  type AgentTool,
  type RoomTools,
} from "../src/nodeagent/index";

const OPERATION = { elementId: "B2", formula: "=A2*2", result: 20, numFmt: "0.00" };

function workbookTools(writeResult: unknown = { ok: true }): AgentTool[] {
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
          formula: z.string().optional(),
          value: z.unknown().optional(),
          result: z.unknown().optional(),
          numFmt: z.string().optional(),
        })),
        afterWrite: z.boolean().optional(),
      }),
      execute: async (args: { artifactId?: string; afterWrite?: boolean }) => ({
        ok: true,
        status: "passed",
        artifactId: args.artifactId ?? "sheet-1",
        phase: args.afterWrite === false ? "preflight" : "post_write",
      }),
    },
    {
      name: "write_locked_cells",
      description: "Write workbook cells.",
      schema: z.object({
        artifactId: z.string().optional(),
        ops: z.array(z.object({
          elementId: z.string(),
          formula: z.string().optional(),
          value: z.unknown().optional(),
          result: z.unknown().optional(),
          numFmt: z.string().optional(),
        })),
      }),
      execute: async () => writeResult,
    },
  ];
}

function runWorkbookAgent(args: {
  goal?: string;
  model: ReturnType<typeof scriptedModel>;
  tools?: AgentTool[];
  initialMessages?: AgentMessage[];
  maxSteps?: number;
}) {
  return runAgent({
    rt: {} as RoomTools,
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

  it("reconstructs a pending post-write verification from durable resume messages", async () => {
    const initialMessages: AgentMessage[] = [
      { role: "user", content: "Complete this SpreadsheetBench workbook formula task." },
      { role: "assistant", content: "", toolCalls: [{ id: "inspect-1", tool: "inspect_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1" } }] },
      { role: "tool", toolCallId: "inspect-1", toolName: "inspect_workbook", content: JSON.stringify({ ok: true, artifactId: "sheet-1" }) },
      { role: "assistant", content: "", toolCalls: [{ id: "preflight-1", tool: "verify_workbook", args: { instruction: "fill formulas", artifactId: "sheet-1", operations: [OPERATION], afterWrite: false } }] },
      { role: "tool", toolCallId: "preflight-1", toolName: "verify_workbook", content: JSON.stringify({ ok: true, status: "passed", artifactId: "sheet-1", phase: "preflight" }) },
      { role: "assistant", content: "", toolCalls: [{ id: "write-1", tool: "write_locked_cells", args: { artifactId: "sheet-1", ops: [OPERATION] } }] },
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
