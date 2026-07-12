// Runtime policy VIEW of the NodeAgent budget profiles.
//
// SINGLE SOURCE OF TRUTH is `./core/budgetProfiles.ts` (the richer spec with
// userFriction, optInOnly, step class, etc.). The policy flags below are DERIVED
// from that spec so the two can never drift again — the 2026-07-12 direction audit
// found this file hardcoded `benchmark_completion.requiresExplicitApproval: false`
// while budgetProfiles said `userFriction: "explicit_approval"`. Deriving fixes that
// to the strict, fail-closed value (a receipt-heavy, high-budget spend lane requires
// explicit approval) and reproduces every other original value exactly.
//
// Do not hardcode a policy table here; edit the spec in budgetProfiles.ts instead.
import {
  NODEAGENT_BUDGET_PROFILES,
  type NodeAgentBudgetProfile,
  type NodeAgentBudgetProfileSpec,
} from "./core/budgetProfiles";

export type { NodeAgentBudgetProfile } from "./core/budgetProfiles";

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

function policyFromSpec(spec: NodeAgentBudgetProfileSpec): NodeAgentBudgetProfilePolicy {
  return {
    id: spec.id,
    label: spec.label,
    description: spec.description,
    defaultForPublicAsk: spec.defaultForPublicAsk,
    // Opt-in-only lanes (deep_diligence, benchmark_completion) are the spend-heavy
    // lanes: they require explicit approval and count as high budget.
    requiresExplicitApproval: spec.optInOnly,
    highBudget: spec.optInOnly,
    // Lanes that must plan before spend also checkpoint and keep receipts.
    resumable: spec.requiresPlanBeforeSpend,
    receiptHeavy: spec.requiresPlanBeforeSpend,
  };
}

export const NODEAGENT_BUDGET_PROFILE_POLICIES: Record<NodeAgentBudgetProfile, NodeAgentBudgetProfilePolicy> =
  Object.fromEntries(
    (Object.keys(NODEAGENT_BUDGET_PROFILES) as NodeAgentBudgetProfile[]).map((id) => [
      id,
      policyFromSpec(NODEAGENT_BUDGET_PROFILES[id]),
    ]),
  ) as Record<NodeAgentBudgetProfile, NodeAgentBudgetProfilePolicy>;

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
