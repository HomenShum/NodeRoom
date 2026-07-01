import { LOOP_PATTERNS, type LoopPattern } from "./types";

export type LoopPatternMetadata = {
  id: LoopPattern;
  category: "quality" | "memory" | "planning" | "exploration" | "system_optimization";
  nodeLayer: "NodeAgent" | "NodeMem" | "NodeTrace" | "NodeEval" | "NodeRL" | "FusionRouter" | "FeatureWalkthrough";
  description: string;
};

const categories: Record<LoopPattern, LoopPatternMetadata["category"]> = {
  generate_critique_rewrite: "quality",
  score_retry: "quality",
  multi_critic: "quality",
  adversarial_critique: "quality",
  judge_ensemble: "quality",
  reflexion: "memory",
  memory_update: "memory",
  error_library: "memory",
  success_pattern: "memory",
  memory_compression: "memory",
  plan_execute_replan: "planning",
  dynamic_workflow: "planning",
  goal_decomposition: "planning",
  progress_evaluation: "planning",
  constraint_satisfaction: "planning",
  branch_explore: "exploration",
  tree_search: "exploration",
  debate: "exploration",
  prompt_optimization: "system_optimization",
  workflow_optimization: "system_optimization",
};

const nodeLayers: Record<LoopPattern, LoopPatternMetadata["nodeLayer"]> = {
  generate_critique_rewrite: "NodeAgent",
  score_retry: "NodeEval",
  multi_critic: "NodeEval",
  adversarial_critique: "NodeEval",
  judge_ensemble: "NodeEval",
  reflexion: "NodeMem",
  memory_update: "NodeMem",
  error_library: "NodeMem",
  success_pattern: "NodeMem",
  memory_compression: "NodeMem",
  plan_execute_replan: "NodeAgent",
  dynamic_workflow: "NodeAgent",
  goal_decomposition: "NodeAgent",
  progress_evaluation: "NodeTrace",
  constraint_satisfaction: "NodeEval",
  branch_explore: "NodeAgent",
  tree_search: "NodeAgent",
  debate: "NodeEval",
  prompt_optimization: "NodeRL",
  workflow_optimization: "FusionRouter",
};

export const LOOP_REGISTRY: LoopPatternMetadata[] = LOOP_PATTERNS.map((id) => ({
  id,
  category: categories[id],
  nodeLayer: nodeLayers[id],
  description: id.replace(/_/g, " "),
}));

export function getLoopPattern(id: LoopPattern): LoopPatternMetadata {
  return LOOP_REGISTRY.find((entry) => entry.id === id) ?? LOOP_REGISTRY[0];
}

export function loopsForCategory(category: LoopPatternMetadata["category"]): LoopPattern[] {
  return LOOP_REGISTRY.filter((entry) => entry.category === category).map((entry) => entry.id);
}

