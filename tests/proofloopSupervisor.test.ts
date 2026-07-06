import { describe, expect, it } from "vitest";
import {
  PROOFLOOP_NO_PROGRESS_AFTER_REPAIR,
  PROOFLOOP_VERIFIER_REPAIR_PREFIX,
  appendProofloopRepairMessage,
  proofloopSupervisorDecision,
} from "../src/nodeagent/core/proofloopSupervisor";
import type { AgentResult } from "../src/nodeagent/core/types";

const WRITE_GOAL = "Predict the rows and write the table into Sheet 1.";

describe("ProofLoop benchmark supervisor", () => {
  it("issues one targeted repair when a benchmark spend-budget slice has no write receipt", () => {
    const decision = proofloopSupervisorDecision({
      runtimeProfile: "benchmark_completion",
      goal: WRITE_GOAL,
      attempt: 1,
      maxAttempts: 1000,
      result: result({ trace: [{ step: 0, tool: "list_artifacts", args: {}, result: { ok: true }, ms: 1 }] }),
    });

    expect(decision.kind).toBe("repair");
    if (decision.kind === "repair") {
      expect(decision.prompt).toContain(PROOFLOOP_VERIFIER_REPAIR_PREFIX);
      expect(decision.prompt).toContain("write_locked_cells");
    }
  });

  it("fails instead of looping when the repair prompt already failed to produce a write", () => {
    const decision = proofloopSupervisorDecision({
      runtimeProfile: "benchmark_completion",
      goal: WRITE_GOAL,
      attempt: 2,
      maxAttempts: 1000,
      result: result({
        messages: [{ role: "user", content: `${PROOFLOOP_VERIFIER_REPAIR_PREFIX} repair now` }],
      }),
    });

    expect(decision).toMatchObject({
      kind: "terminal_failure",
      error: PROOFLOOP_NO_PROGRESS_AFTER_REPAIR,
    });
  });

  it("does not intervene once a room-write tool receipt exists", () => {
    const decision = proofloopSupervisorDecision({
      runtimeProfile: "benchmark_completion",
      goal: WRITE_GOAL,
      attempt: 1,
      maxAttempts: 1000,
      result: result({
        trace: [{ step: 1, tool: "write_locked_cells", args: {}, result: { ok: true }, ms: 2 }],
      }),
    });

    expect(decision.kind).toBe("none");
  });

  it("ignores non-benchmark and read-only goals", () => {
    expect(proofloopSupervisorDecision({
      runtimeProfile: undefined,
      goal: WRITE_GOAL,
      attempt: 1,
      maxAttempts: 1000,
      result: result(),
    }).kind).toBe("none");

    expect(proofloopSupervisorDecision({
      runtimeProfile: "benchmark_completion",
      goal: "Read the file and report only; do not write cells.",
      attempt: 1,
      maxAttempts: 1000,
      result: result(),
    }).kind).toBe("none");
  });

  it("appends the repair message idempotently", () => {
    const once = appendProofloopRepairMessage([], `${PROOFLOOP_VERIFIER_REPAIR_PREFIX} repair`);
    const twice = appendProofloopRepairMessage(once, `${PROOFLOOP_VERIFIER_REPAIR_PREFIX} repair again`);

    expect(once).toHaveLength(1);
    expect(twice).toHaveLength(1);
  });
});

function result(overrides: Partial<Pick<AgentResult, "stopReason" | "trace" | "messages" | "finalText" | "handoff">> = {}): Pick<AgentResult, "stopReason" | "trace" | "messages" | "finalText" | "handoff"> {
  return {
    stopReason: "spend_budget",
    trace: [],
    messages: [],
    finalText: "",
    handoff: undefined,
    ...overrides,
  };
}
