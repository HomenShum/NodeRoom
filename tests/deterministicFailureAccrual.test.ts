import { describe, expect, it } from "vitest";
import { z } from "zod";
import { runAgent } from "../src/nodeagent/core/runtime";
import type { AgentModel, AgentTool, RoomTools } from "../src/nodeagent/core/types";

/**
 * Regression: interleaved-success doom loop (live room NRNXCFYJK5B, 2026-07-18).
 *
 * The consecutive deterministic-failure breaker resets whenever an unrelated call
 * succeeds. The live blocked-write loop alternated write(blocked) -> inspect(ok) ->
 * verify(needs_repair), so the consecutive count never exceeded 1 and the agent
 * burned 11 turns against an identical block. The accrued breaker must trip on
 * repeats of the same failure key across turns regardless of interleaving.
 */

function minimalRoomTools(): RoomTools {
  return {
    snapshot: async () => ({ artifactId: "sheet", version: 1, kind: "sheet", rows: [] }),
    awareness: async () => ({ activeLocks: [], agents: [], recentTrace: [], autoAllow: true }),
    say: async () => undefined,
  } as unknown as RoomTools;
}

describe("deterministic failure accrual breaker", () => {
  it("terminates an interleaved blocked-tool loop instead of burning the step budget", async () => {
    let blockedCalls = 0;
    let probeCalls = 0;

    const probeTool: AgentTool = {
      name: "probe_ok",
      description: "Always succeeds.",
      schema: z.object({}),
      execute: async () => {
        probeCalls += 1;
        return { ok: true };
      },
    };
    const guardedWrite: AgentTool = {
      name: "guarded_write",
      description: "Always blocked by the workflow guardrail.",
      schema: z.object({}),
      execute: async () => {
        blockedCalls += 1;
        return {
          ok: false,
          error: "tool_blocked",
          failureKind: "permission_denied",
          reason: "verified_workbook_workflow:write_requires_preflight: A passing workbook preflight has not been executed.",
        };
      },
    };

    // Every turn: one success, then the identical blocked write — consecutive count
    // stays at 1 forever; only the accrued cap can stop this.
    const model: AgentModel = {
      name: "interleaved-doom-loop",
      async next() {
        return {
          toolCalls: [
            { id: `p${probeCalls}`, tool: "probe_ok", args: {} },
            { id: `w${blockedCalls}`, tool: "guarded_write", args: {} },
          ],
          done: false,
        };
      },
    };

    const result = await runAgent({
      rt: minimalRoomTools(),
      goal: "write the header row into the sheet",
      model,
      tools: [probeTool, guardedWrite],
      maxSteps: 40,
    });

    expect(blockedCalls).toBe(6); // DETERMINISTIC_TOOL_FAILURE_ACCRUED_TERMINAL_AFTER
    expect(blockedCalls).toBeLessThan(15); // nowhere near the step budget
    expect(result.handoff?.terminalReason).toBe("protocol_stall");
    expect(JSON.stringify(result.handoff ?? {})).toContain("guarded_write");
  });
});
