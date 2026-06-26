export type NodeAgentBudgetProfile =
  | "instant"
  | "standard"
  | "background"
  | "deep_diligence"
  | "benchmark_completion";

export type NodeAgentBudgetProfilePolicy = {
  id: NodeAgentBudgetProfile;
  label: string;
  description: string;
  defaultForPublicAsk: boolean;
  requiresExplicitApproval: boolean;
  resumable: boolean;
  receiptHeavy: boolean;
  highBudget: boolean;
};

export const NODEAGENT_BUDGET_PROFILE_POLICIES: Record<NodeAgentBudgetProfile, NodeAgentBudgetProfilePolicy> = {
  instant: {
    id: "instant",
    label: "Instant",
    description: "Fast, cheap, safe auto-run for small read or draft work.",
    defaultForPublicAsk: false,
    requiresExplicitApproval: false,
    resumable: false,
    receiptHeavy: false,
    highBudget: false,
  },
  standard: {
    id: "standard",
    label: "Standard",
    description: "Default public @nodeagent lane: bounded tool use, low surprise, visible result.",
    defaultForPublicAsk: true,
    requiresExplicitApproval: false,
    resumable: false,
    receiptHeavy: false,
    highBudget: false,
  },
  background: {
    id: "background",
    label: "Background",
    description: "Checkpointed continuation for safe work that is clearly still making progress.",
    defaultForPublicAsk: false,
    requiresExplicitApproval: false,
    resumable: true,
    receiptHeavy: true,
    highBudget: false,
  },
  deep_diligence: {
    id: "deep_diligence",
    label: "Deep diligence",
    description: "Host-approved long run with a cost/time estimate, resumable checkpoints, and evidence receipts.",
    defaultForPublicAsk: false,
    requiresExplicitApproval: true,
    resumable: true,
    receiptHeavy: true,
    highBudget: true,
  },
  benchmark_completion: {
    id: "benchmark_completion",
    label: "Benchmark completion",
    description: "Opt-in eval lane that runs to completion to measure model capability, cost, and latency.",
    defaultForPublicAsk: false,
    requiresExplicitApproval: false,
    resumable: true,
    receiptHeavy: true,
    highBudget: true,
  },
};

export type RuntimeProfileInferenceInput = {
  goal: string;
  explicitProfile?: NodeAgentBudgetProfile;
  benchmarkMode?: boolean;
  userApprovedDeepRun?: boolean;
};

export function runtimeProfilePolicy(profile: NodeAgentBudgetProfile): NodeAgentBudgetProfilePolicy {
  return NODEAGENT_BUDGET_PROFILE_POLICIES[profile];
}

export function inferNodeAgentBudgetProfile(input: RuntimeProfileInferenceInput): NodeAgentBudgetProfile {
  if (input.explicitProfile) return input.explicitProfile;
  if (input.benchmarkMode) return "benchmark_completion";
  const goal = input.goal.toLowerCase();
  if (/\b(benchmark|eval|scorecard|held[- ]out|spreadsheetbench|bankertoolbench|btb)\b/.test(goal)) {
    return "benchmark_completion";
  }
  if (/\b(deep diligence|diligence|full research|forensic|audit|background)\b/.test(goal)) {
    return input.userApprovedDeepRun ? "deep_diligence" : "background";
  }
  if (goal.length < 80 && !/\b(upload|export|send|delete|overwrite|approve)\b/.test(goal)) return "instant";
  return "standard";
}

export function shouldAutoRunWithoutApproval(profile: NodeAgentBudgetProfile): boolean {
  const policy = runtimeProfilePolicy(profile);
  return !policy.requiresExplicitApproval && !policy.highBudget;
}
