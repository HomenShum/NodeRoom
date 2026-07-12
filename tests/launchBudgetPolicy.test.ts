import { describe, expect, it } from "vitest";
import {
  durableCreditReservationKey,
  evaluateLaunchAdmission,
  launchAdmissionModeFromEnv,
  providerAttemptPolicyFromEnv,
  type LaunchAdmissionInput,
} from "../src/launch/budgetPolicy";
import { DEFAULT_BUDGET_CAPS, estimateCostFor } from "../src/nodeagent/core/creditModel";

function input(overrides: Partial<LaunchAdmissionInput> = {}): LaunchAdmissionInput {
  return {
    launchMode: "public_launch",
    creditMode: "standard",
    creditsEnforced: true,
    roomEnrolled: true,
    roomPaused: false,
    availableCredits: 100,
    maintenanceMode: false,
    globalPaused: false,
    providerPaused: false,
    usage: {
      roomDailyUsd: 0,
      roomMonthlyUsd: 0,
      userDailyUsd: 0,
      globalMonthlyUsd: 0,
      activeForegroundJobsGlobal: 0,
      activeForegroundJobsRoom: 0,
      activeDeepJobsRoom: 0,
    },
    ...overrides,
  };
}

describe("launch budget admission", () => {
  it("fails closed for launch rooms without metering or enrollment", () => {
    expect(evaluateLaunchAdmission(input({ creditsEnforced: false })).code).toBe("credits_enforcement_required");
    expect(evaluateLaunchAdmission(input({ roomEnrolled: false })).code).toBe("credits_not_enrolled");
  });

  it("keeps benchmark completion out of pilot and public launch", () => {
    expect(evaluateLaunchAdmission(input({ runtimeProfile: "benchmark_completion", creditMode: "deep" })).code)
      .toBe("benchmark_profile_internal_only");
    expect(evaluateLaunchAdmission(input({ launchMode: "benchmark", runtimeProfile: "benchmark_completion", creditMode: "deep" })).allowed)
      .toBe(true);
  });

  it("honors kill switches before any spend decision", () => {
    expect(evaluateLaunchAdmission(input({ maintenanceMode: true })).code).toBe("maintenance_mode");
    expect(evaluateLaunchAdmission(input({ globalPaused: true })).code).toBe("global_pause");
    expect(evaluateLaunchAdmission(input({ providerPaused: true })).code).toBe("provider_pause");
    expect(evaluateLaunchAdmission(input({ roomPaused: true })).code).toBe("room_paused");
  });

  it("accounts for projected spend and active jobs", () => {
    const projected = estimateCostFor("standard").estimateUsdHigh;
    expect(evaluateLaunchAdmission(input({ usage: { ...input().usage, userDailyUsd: DEFAULT_BUDGET_CAPS.perUserDailyUsd - projected / 2 } })).code)
      .toBe("user_daily_spend_cap");
    expect(evaluateLaunchAdmission(input({ usage: { ...input().usage, activeForegroundJobsRoom: 2 } })).code)
      .toBe("room_concurrency_cap");
    expect(evaluateLaunchAdmission(input({ launchMode: "development", creditMode: "deep", usage: { ...input().usage, activeDeepJobsRoom: 1 } })).code)
      .toBe("room_deep_concurrency_cap");
  });

  it("uses hard-cap exposure and requires an explicit approval path for deep launch work", () => {
    const standard = evaluateLaunchAdmission(input());
    expect(standard.projectedUsd).toBeGreaterThanOrEqual(standard.hardCapUsd);
    expect(evaluateLaunchAdmission(input({ creditMode: "deep" })).code).toBe("approval_required");
  });

  it("rejects insufficient holds and truncated snapshots", () => {
    expect(evaluateLaunchAdmission(input({ availableCredits: 0 })).code).toBe("insufficient_credits");
    expect(evaluateLaunchAdmission(input({ usage: { ...input().usage, truncated: true } })).code).toBe("usage_snapshot_truncated");
  });

  it("parses explicit postures and generates stable per-attempt reservation keys", () => {
    expect(launchAdmissionModeFromEnv({ NODEAGENT_LAUNCH_MODE: "private_pilot" })).toBe("private_pilot");
    expect(launchAdmissionModeFromEnv({ NODEAGENT_LAUNCH_MODE: "unexpected" })).toBe("development");
    expect(durableCreditReservationKey("job-7", 2)).toBe("agent-job:job-7:attempt:2");
    expect(providerAttemptPolicyFromEnv({ NODEAGENT_LAUNCH_MODE: "public_launch" })).toEqual({ maxRetries: 0, allowFallback: false });
    expect(providerAttemptPolicyFromEnv({ NODEAGENT_LAUNCH_MODE: "development" })).toEqual({});
  });
});
