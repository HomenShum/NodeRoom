import {
  CREDIT_MODE_SPECS,
  DEFAULT_BUDGET_CAPS,
  estimateCostFor,
  reserveCreditsFor,
  type AgentCreditMode,
} from "../nodeagent/core/creditModel";

export type LaunchAdmissionMode = "development" | "private_pilot" | "public_launch" | "benchmark";

export type LaunchAdmissionCode =
  | "allowed"
  | "maintenance_mode"
  | "global_pause"
  | "provider_pause"
  | "approval_required"
  | "benchmark_profile_internal_only"
  | "credits_enforcement_required"
  | "credits_not_enrolled"
  | "room_paused"
  | "insufficient_credits"
  | "global_monthly_spend_cap"
  | "room_daily_spend_cap"
  | "room_monthly_spend_cap"
  | "user_daily_spend_cap"
  | "global_concurrency_cap"
  | "room_concurrency_cap"
  | "room_deep_concurrency_cap"
  | "usage_snapshot_truncated";

export type LaunchUsageSnapshot = {
  roomDailyUsd: number;
  roomMonthlyUsd: number;
  userDailyUsd: number;
  globalMonthlyUsd: number;
  activeForegroundJobsGlobal: number;
  activeForegroundJobsRoom: number;
  activeDeepJobsRoom: number;
  truncated?: boolean;
};

export type LaunchAdmissionInput = {
  launchMode: LaunchAdmissionMode;
  creditMode: AgentCreditMode;
  runtimeProfile?: "benchmark_completion";
  creditsEnforced: boolean;
  roomEnrolled: boolean;
  roomPaused: boolean;
  availableCredits: number;
  maintenanceMode: boolean;
  globalPaused: boolean;
  providerPaused: boolean;
  spendApprovalConfirmed?: boolean;
  usage: LaunchUsageSnapshot;
};

export type LaunchAdmissionDecision = {
  allowed: boolean;
  code: LaunchAdmissionCode;
  policy: "launch_budget_v1";
  launchMode: LaunchAdmissionMode;
  creditMode: AgentCreditMode;
  projectedUsd: number;
  requiredCredits: number;
  hardCapUsd: number;
};

function decision(input: LaunchAdmissionInput, code: LaunchAdmissionCode): LaunchAdmissionDecision {
  const projectedUsd = projectedExposureUsd(input.launchMode, input.creditMode);
  return {
    allowed: code === "allowed",
    code,
    policy: "launch_budget_v1",
    launchMode: input.launchMode,
    creditMode: input.creditMode,
    projectedUsd,
    requiredCredits: reserveCreditsFor(projectedUsd),
    hardCapUsd: CREDIT_MODE_SPECS[input.creditMode].hardCapUsd,
  };
}

export function evaluateLaunchAdmission(input: LaunchAdmissionInput): LaunchAdmissionDecision {
  const deny = (code: Exclude<LaunchAdmissionCode, "allowed">) => decision(input, code);
  const projectedUsd = projectedExposureUsd(input.launchMode, input.creditMode);

  if (input.maintenanceMode) return deny("maintenance_mode");
  if (input.globalPaused) return deny("global_pause");
  if (input.providerPaused) return deny("provider_pause");
  if (input.runtimeProfile === "benchmark_completion" && input.launchMode !== "benchmark" && input.launchMode !== "development") {
    return deny("benchmark_profile_internal_only");
  }
  if (input.roomPaused) return deny("room_paused");

  const launchCreditsRequired = input.launchMode === "private_pilot" || input.launchMode === "public_launch";
  if (launchCreditsRequired && CREDIT_MODE_SPECS[input.creditMode].requiresApproval && !input.spendApprovalConfirmed) {
    return deny("approval_required");
  }
  if (launchCreditsRequired && !input.creditsEnforced) return deny("credits_enforcement_required");
  if (launchCreditsRequired && !input.roomEnrolled) return deny("credits_not_enrolled");
  if (input.creditsEnforced && input.roomEnrolled && input.availableCredits < reserveCreditsFor(projectedUsd)) {
    return deny("insufficient_credits");
  }

  // Dedicated benchmark deployments use their own explicit benchmark ceilings. They still honor
  // all kill switches and room-wallet state above, but do not consume the public-launch envelope.
  if (input.launchMode === "benchmark") return decision(input, "allowed");
  if (input.usage.truncated) return deny("usage_snapshot_truncated");
  if (input.usage.globalMonthlyUsd + projectedUsd > DEFAULT_BUDGET_CAPS.globalMonthlyUsd) return deny("global_monthly_spend_cap");
  if (input.usage.roomDailyUsd + projectedUsd > DEFAULT_BUDGET_CAPS.perRoomDailyUsd) return deny("room_daily_spend_cap");
  if (input.usage.roomMonthlyUsd + projectedUsd > DEFAULT_BUDGET_CAPS.perRoomMonthlyUsd) return deny("room_monthly_spend_cap");
  if (input.usage.userDailyUsd + projectedUsd > DEFAULT_BUDGET_CAPS.perUserDailyUsd) return deny("user_daily_spend_cap");
  if (input.usage.activeForegroundJobsGlobal >= DEFAULT_BUDGET_CAPS.concurrentForegroundJobsGlobal) return deny("global_concurrency_cap");
  if (input.usage.activeForegroundJobsRoom >= DEFAULT_BUDGET_CAPS.concurrentForegroundJobsPerRoom) return deny("room_concurrency_cap");
  if (input.creditMode === "deep" && input.usage.activeDeepJobsRoom >= DEFAULT_BUDGET_CAPS.concurrentDeepJobsPerRoom) {
    return deny("room_deep_concurrency_cap");
  }
  return decision(input, "allowed");
}

function projectedExposureUsd(launchMode: LaunchAdmissionMode, creditMode: AgentCreditMode): number {
  const estimate = estimateCostFor(creditMode);
  return launchMode === "private_pilot" || launchMode === "public_launch"
    ? Math.max(estimate.estimateUsdHigh, CREDIT_MODE_SPECS[creditMode].hardCapUsd)
    : estimate.estimateUsdHigh;
}

export function launchAdmissionModeFromEnv(env: Record<string, string | undefined>): LaunchAdmissionMode {
  const raw = env.NODEAGENT_LAUNCH_MODE?.trim().toLowerCase();
  if (raw === "private_pilot" || raw === "public_launch" || raw === "benchmark") return raw;
  return "development";
}

export function booleanEnv(env: Record<string, string | undefined>, name: string): boolean {
  const value = env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function creditsEnforcedFromEnv(env: Record<string, string | undefined>): boolean {
  return booleanEnv(env, "CREDITS_ENFORCED");
}

export function providerAttemptPolicyFromEnv(env: Record<string, string | undefined>): {
  maxRetries?: number;
  allowFallback?: boolean;
} {
  const mode = launchAdmissionModeFromEnv(env);
  return mode === "private_pilot" || mode === "public_launch"
    ? { maxRetries: 0, allowFallback: false }
    : {};
}

export function launchPauseStateFromEnv(env: Record<string, string | undefined>) {
  return {
    maintenanceMode: booleanEnv(env, "NODEAGENT_MAINTENANCE_MODE"),
    globalPaused: booleanEnv(env, "NODEAGENT_GLOBAL_PAUSED"),
    providerPaused: booleanEnv(env, "NODEAGENT_PROVIDER_PAUSED"),
  };
}

export function creditModeForJob(input: { creditMode?: AgentCreditMode; runtimeProfile?: "benchmark_completion"; mode?: string }): AgentCreditMode {
  if (input.runtimeProfile === "benchmark_completion") return "deep";
  if (input.creditMode) return input.creditMode;
  if (input.mode === "research") return "deep";
  return "standard";
}

export function durableCreditReservationKey(jobId: unknown, attempt: number): string {
  return `agent-job:${String(jobId)}:attempt:${Math.max(1, Math.floor(attempt))}`;
}
