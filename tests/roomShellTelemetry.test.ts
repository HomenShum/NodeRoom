import { describe, expect, it } from "vitest";
import {
  projectAgentJobAttemptTelemetry,
  projectAgentRunTelemetry,
  selectAgentRunTelemetryForJob,
  type AgentJobTelemetry,
} from "../src/app/store";
import { formatAgentCost, selectedJobSignalTelemetry } from "../src/ui/RoomShell";

const persistedRun = {
  model: "provider/known-model",
  steps: 2,
  toolCalls: 1,
  inputTokens: 120,
  outputTokens: 30,
  costUsd: 0.125,
  ms: 400,
};

function durableJob(overrides: Partial<AgentJobTelemetry> = {}): AgentJobTelemetry {
  return {
    id: "job-selected",
    status: "running",
    attempts: 1,
    maxAttempts: 3,
    modelPolicy: "openrouter/free-auto",
    updatedAt: 100,
    ...overrides,
  };
}

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

describe("RoomShell selected-job telemetry", () => {
  it("displays the selected job's run when a different concurrent job owns the room's newest run", () => {
    const selectedRun = {
      ...persistedRun,
      _id: "run-selected",
      jobId: "job-selected",
      model: "provider/selected-model",
      toolCalls: 3,
      costUsd: 0.031,
      costKind: "exact" as const,
    };
    const otherRun = {
      ...persistedRun,
      _id: "run-other",
      jobId: "job-other",
      model: "provider/other-model",
      toolCalls: 9,
      costUsd: 0.909,
      costKind: "exact" as const,
    };
    const job = durableJob({ latestRunId: "run-selected" });

    const run = selectAgentRunTelemetryForJob([otherRun, selectedRun], job);

    expect(run).toMatchObject({ model: "provider/selected-model", toolCalls: 3, costUsd: 0.031 });
    expect(selectedJobSignalTelemetry(job, run)).toEqual({
      evalValue: "provider/selected-model | 3 tools",
      costValue: "$0.031",
    });
  });

  it("uses selected-job detail when its latest run has fallen outside the bounded room run list", () => {
    const detailRun = {
      ...persistedRun,
      _id: "run-selected",
      jobId: "job-selected",
      model: "provider/detail-model",
      costKind: "estimated" as const,
    };
    const job = durableJob({ latestRunId: "run-selected" });

    const run = selectAgentRunTelemetryForJob([
      { ...persistedRun, _id: "run-other", jobId: "job-other", model: "provider/other-model" },
    ], job, {
      job: { _id: "job-selected", latestRunId: "run-selected" },
      latestRun: detailRun,
    });

    expect(run).toMatchObject({ model: "provider/detail-model", costKind: "estimated" });
  });

  it("accepts a legacy run without jobId only when latestRunId provides the durable link", () => {
    const job = durableJob({ latestRunId: "run-legacy" });

    const run = selectAgentRunTelemetryForJob([
      { ...persistedRun, _id: "run-legacy", model: "provider/legacy-model" },
    ], job);

    expect(run?.model).toBe("provider/legacy-model");
  });

  it("withholds uncorrelated legacy telemetry and reports only selected-job aggregate data", () => {
    const job = durableJob({
      latestRunId: undefined,
      modelPolicy: "openrouter/free-auto",
      toolCallCount: 4,
      costUsd: 0.2,
    });
    const unrelatedLegacyRun = { ...persistedRun, _id: "run-unknown", model: "provider/unrelated-model" };

    const run = selectAgentRunTelemetryForJob([unrelatedLegacyRun], job, {
      job: { _id: "job-other", latestRunId: "run-unknown" },
      latestRun: unrelatedLegacyRun,
    });

    expect(run).toBeNull();
    expect(selectedJobSignalTelemetry(job, run)).toEqual({
      evalValue: "route openrouter/free-auto | 4 tools total",
      costValue: "≈$0.200 job total",
    });
  });

  it("labels selected-job telemetry as not reported when legacy counters are missing", () => {
    const job = durableJob({ modelPolicy: "legacy/policy", latestRunId: undefined });

    expect(selectedJobSignalTelemetry(job, null)).toEqual({
      evalValue: "route legacy/policy",
      costValue: "not reported",
    });
  });
});
