import { describe, expect, it } from "vitest";
import { projectAgentJobAttemptTelemetry, projectAgentRunTelemetry } from "../src/app/store";
import { formatAgentCost } from "../src/ui/RoomShell";

const persistedRun = {
  model: "provider/known-model",
  steps: 2,
  toolCalls: 1,
  inputTokens: 120,
  outputTokens: 30,
  costUsd: 0.125,
  ms: 400,
};

describe("RoomShell cost telemetry", () => {
  it("preserves estimated run pricing through the store projection and labels it approximately", () => {
    const run = projectAgentRunTelemetry({ ...persistedRun, costKind: "estimated" });

    expect(run.costKind).toBe("estimated");
    expect(formatAgentCost(run.costUsd, run.costKind)).toBe("≈$0.125");
  });

  it("keeps exact run pricing exact-looking", () => {
    const run = projectAgentRunTelemetry({ ...persistedRun, costKind: "exact" });

    expect(run.costKind).toBe("exact");
    expect(formatAgentCost(run.costUsd, run.costKind)).toBe("$0.125");
  });

  it("treats legacy telemetry without a cost kind as estimated", () => {
    const run = projectAgentRunTelemetry(persistedRun);
    const attempt = projectAgentJobAttemptTelemetry({
      attempt: 1,
      status: "completed",
      resolvedModel: persistedRun.model,
      stopReason: "done",
      ms: persistedRun.ms,
      inputTokens: persistedRun.inputTokens,
      outputTokens: persistedRun.outputTokens,
      costUsd: persistedRun.costUsd,
    });

    expect(run.costKind).toBe("estimated");
    expect(attempt.costKind).toBe("estimated");
    expect(formatAgentCost(run.costUsd, run.costKind)).toBe("≈$0.125");
  });
});
