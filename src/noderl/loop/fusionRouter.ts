import type { FusionRoutePlan, LoopPolicy, RoutingFeatures } from "./types";

export function routeFusionTask(features: RoutingFeatures, policy?: LoopPolicy): FusionRoutePlan {
  const bankerGrade = features.evidenceStrictness === "banker_grade" || features.privacyLevel !== "public";
  const needsStrongReasoning = features.formulaComplexity === "high" || features.contextSizeTokens > 64_000 || bankerGrade;
  const spreadsheet = features.outputTargets.includes("spreadsheet");
  const tools: FusionRoutePlan["tools"] = ["deterministic_parser"];
  if (features.sourceTypes.includes("html")) tools.push("linkup_search", "firecrawl_capture");
  if (features.sourceTypes.includes("image") || bankerGrade) tools.push("browser_bbox_capture");
  if (spreadsheet) tools.push("spreadsheet_formula_engine");
  if (features.sourceTypes.includes("xbrl") || features.taskKind === "xbrl_tagging") tools.push("xbrl_parser");

  const cheapViable = features.budgetRemainingUsd < 1.5 && !needsStrongReasoning;
  const maxCostUsd = Math.min(policy?.maxCostUsd ?? features.budgetRemainingUsd, features.budgetRemainingUsd);
  return {
    plannerModel: needsStrongReasoning ? "strong-model" : "cheap-model",
    extractorModel: cheapViable ? "cheap-model" : "structured-extractor",
    reasoningModel: needsStrongReasoning ? "strong-model" : "balanced-model",
    verifierModel: "deterministic",
    visualJudgeModel: features.outputTargets.includes("graph") || features.outputTargets.includes("spreadsheet") ? "vision-model" : undefined,
    tools: [...new Set(tools)],
    maxCostUsd,
    maxAttempts: policy?.maxAttempts ?? 2,
    escalationPolicy: [
      { ifFailure: "evidence_grounding_failure", thenRoute: { extractorModel: "strong-model", maxAttempts: 1 } },
      { ifFailure: "visual_design", thenRoute: { visualJudgeModel: "vision-model" } },
      { ifFailure: "cost_budget", thenRoute: { plannerModel: "cheap-model", reasoningModel: "balanced-model", maxAttempts: 1 } },
      { ifFailure: "verifier_feedback", thenRoute: { reasoningModel: "strong-model", verifierModel: "deterministic" } },
    ],
  };
}

