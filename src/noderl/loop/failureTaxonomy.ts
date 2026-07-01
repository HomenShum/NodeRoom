export const LOOP_FAILURE_CATEGORIES = [
  "model_reasoning",
  "fusion_router",
  "context_pack",
  "tool_schema",
  "ui_affordance",
  "app_state",
  "artifact_generation",
  "verifier_feedback",
  "visual_design",
  "cost_budget",
  "latency",
  "memory_recall",
  "human_review_required",
] as const;

export type LoopFailureCategory = (typeof LOOP_FAILURE_CATEGORIES)[number];

export function classifyLoopFailure(text: string): LoopFailureCategory {
  const value = text.toLowerCase();
  if (/cost|budget|spend|credit/.test(value)) return "cost_budget";
  if (/timeout|latency|slow|stall/.test(value)) return "latency";
  if (/schema|tool arg|tool_call|zod/.test(value)) return "tool_schema";
  if (/context|citation|source|evidence/.test(value)) return "context_pack";
  if (/ui|browser|click|selector|focus/.test(value)) return "ui_affordance";
  if (/visual|screenshot|layout/.test(value)) return "visual_design";
  if (/artifact|export|reopen|file/.test(value)) return "artifact_generation";
  if (/memory|recall|lesson/.test(value)) return "memory_recall";
  if (/router|route|model selection/.test(value)) return "fusion_router";
  if (/approval|human|manual/.test(value)) return "human_review_required";
  if (/verifier|score|rubric|judge/.test(value)) return "verifier_feedback";
  if (/state|room|cache|backend/.test(value)) return "app_state";
  return "model_reasoning";
}

