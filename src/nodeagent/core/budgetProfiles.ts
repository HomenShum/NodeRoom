export type NodeAgentBudgetProfile =
  | "instant"
  | "standard"
  | "background"
  | "deep_diligence"
  | "benchmark_completion";

export type NodeAgentBudgetProfileSpec = {
  id: NodeAgentBudgetProfile;
  label: string;
  userFriction: "zero_click" | "one_click" | "review_required" | "explicit_approval";
  defaultForPublicAsk: boolean;
  optInOnly: boolean;
  canAutoRunSafeReads: boolean;
  canAutoCommitCleanBlanks: boolean;
  requiresPlanBeforeSpend: boolean;
  requiresTraceReceipts: boolean;
  maxStepClass: "small" | "moderate" | "large" | "completion";
  description: string;
};

export const NODEAGENT_BUDGET_PROFILES: Record<NodeAgentBudgetProfile, NodeAgentBudgetProfileSpec> = {
  instant: {
    id: "instant",
    label: "Instant",
    userFriction: "zero_click",
    defaultForPublicAsk: false,
    optInOnly: false,
    canAutoRunSafeReads: true,
    canAutoCommitCleanBlanks: true,
    requiresPlanBeforeSpend: false,
    requiresTraceReceipts: false,
    maxStepClass: "small",
    description: "Fast, cheap, visible result for obvious safe work.",
  },
  standard: {
    id: "standard",
    label: "Standard",
    userFriction: "one_click",
    defaultForPublicAsk: true,
    optInOnly: false,
    canAutoRunSafeReads: true,
    canAutoCommitCleanBlanks: true,
    requiresPlanBeforeSpend: false,
    requiresTraceReceipts: true,
    maxStepClass: "moderate",
    description: "Default public @nodeagent lane: bounded, safe, and resumable.",
  },
  background: {
    id: "background",
    label: "Background",
    userFriction: "one_click",
    defaultForPublicAsk: false,
    optInOnly: false,
    canAutoRunSafeReads: true,
    canAutoCommitCleanBlanks: true,
    requiresPlanBeforeSpend: true,
    requiresTraceReceipts: true,
    maxStepClass: "large",
    description: "Longer safe work in slices while the user keeps working.",
  },
  deep_diligence: {
    id: "deep_diligence",
    label: "Deep diligence",
    userFriction: "explicit_approval",
    defaultForPublicAsk: false,
    optInOnly: true,
    canAutoRunSafeReads: true,
    canAutoCommitCleanBlanks: false,
    requiresPlanBeforeSpend: true,
    requiresTraceReceipts: true,
    maxStepClass: "large",
    description: "User-approved high-cost/high-depth research with checkpoints.",
  },
  benchmark_completion: {
    id: "benchmark_completion",
    label: "Benchmark completion",
    userFriction: "explicit_approval",
    defaultForPublicAsk: false,
    optInOnly: true,
    canAutoRunSafeReads: true,
    canAutoCommitCleanBlanks: false,
    requiresPlanBeforeSpend: true,
    requiresTraceReceipts: true,
    maxStepClass: "completion",
    description: "Receipt-heavy completion lane used to measure capability and cost.",
  },
};

export type NodeAgentBudgetProfileInput = {
  explicitProfile?: NodeAgentBudgetProfile;
  goal: string;
  benchmarkMode?: boolean;
  estimatedCostUsd?: number;
  touchesPrivateContext?: boolean;
  mutatesHumanAuthored?: boolean;
  downstreamSend?: boolean;
};

export function chooseNodeAgentBudgetProfile(input: NodeAgentBudgetProfileInput): NodeAgentBudgetProfile {
  if (input.explicitProfile) return input.explicitProfile;
  if (input.benchmarkMode) return "benchmark_completion";
  if (input.downstreamSend || input.touchesPrivateContext) return "deep_diligence";
  if ((input.estimatedCostUsd ?? 0) > 0.5) return "deep_diligence";
  if (input.mutatesHumanAuthored) return "standard";
  if (looksLikeLongResearch(input.goal)) return "background";
  if (looksLikeTinySafeTask(input.goal)) return "instant";
  return "standard";
}

export function budgetProfileDisplay(profile: NodeAgentBudgetProfile, estimate?: { minutes?: string; capUsd?: number }): string {
  const spec = NODEAGENT_BUDGET_PROFILES[profile];
  const parts = [`Running as ${spec.label.toLowerCase()}`];
  if (estimate?.minutes) parts.push(`estimated ${estimate.minutes}`);
  if (typeof estimate?.capUsd === "number") parts.push(`cap $${estimate.capUsd.toFixed(2)}`);
  return parts.join(" · ");
}

function looksLikeLongResearch(goal: string): boolean {
  return /\b(deep|diligence|source-backed|enrich|benchmark|compare|full proof|background)\b/i.test(goal);
}

function looksLikeTinySafeTask(goal: string): boolean {
  return /\b(read|summarize|classify|label|find|show|explain)\b/i.test(goal) && !looksLikeLongResearch(goal);
}
