// Failure-memory layer (file-backed, framework-agnostic).
//
// Turns per-task proof failures into NodeMemFailurePattern records so a re-run can target ONLY the
// unresolved failures and condition the agent off known-bad paths -- the "memory -> repair" half of
// the NodeRL loop. Pure + deterministic (the CLI does file IO); no Convex dependency, so it works in
// the portable NodeRL extraction as well as in NodeRoom.
import type { NodeMemFailurePattern, NodeMemSource } from "./core/types";

export interface TaskFailure {
  taskId: string;
  reason: string;
  /** Which proof lane produced the failure. */
  lane: "live" | "isolated";
  receiptRef?: string;
  /** Optional, additive: see NodeMemSource / noderl/spec/anti-reward-hacking-doctrine.md. */
  source?: NodeMemSource;
}

export interface MemoryBackedScaffoldSuggestion {
  targetTaskId: string;
  rootCause: string;
  suggestedChange: string;
  rerunCommand: string;
  recalledPatternIds: string[];
  recalledReceiptRefs: string[];
  sourceConfidence: "grounded" | "mixed" | "synthetic_only";
}

/** Map a validation/scorer error string to a stable root-cause category for dedupe + repair routing. */
export function classifyRootCause(reason: string): string {
  const r = (reason || "").toLowerCase();
  if (/timeout|timed out|deadline/.test(r)) return "agent_timeout";
  if (/memorymode|memory mode/.test(r)) return "memory_mode_shortcut";
  if (/fresh|forbiddenpreloaded|roomcreated/.test(r)) return "room_not_fresh";
  if (/path does not exist|screenshot|video|trace/.test(r)) return "evidence_file_missing";
  if (/export|download|bytes|reopen|reopened/.test(r)) return "deliverable_export_or_reopen";
  if (/scorer|verdict/.test(r)) return "official_scorer_not_pass";
  if (/focus/.test(r)) return "focus_mode_missing";
  if (/missing required gate|missing focus mode gate|missing/.test(r)) return "proof_gate_missing";
  if (/contaminat|answer.?key|generic|materializer/.test(r)) return "answer_key_contamination";
  return "unclassified";
}

/** Suggested re-run command for a single task (actionable regression test). */
export function regressionCommand(taskId: string, lane: "live" | "isolated"): string {
  if (lane === "live") {
    return (
      `BTB_LIVE_ROOM_E2E=1 BTB_UI_TASK_ID=${taskId} ` +
      `BTB_FRESH_ROOM_PROOF_PATH=docs/eval/fresh-room/FR-020/tasks/${taskId}/latest.json ` +
      `PLAYWRIGHT_RECORD_VIDEO=1 npx playwright test --config playwright.real-flow.config.ts ` +
      `e2e/benchmark-ui-bankertoolbench.spec.ts --headed`
    );
  }
  return `npm run benchmark:bankertoolbench:nodeagent-sweep -- -MaterializerMode generic-only -ForceModelPlanner -NoFallbackPlan -Resume -TaskIds ${taskId}`;
}

const HINTS: Record<string, string> = {
  agent_timeout: "Raise per-task timeout or reduce step budget; check provider latency.",
  memory_mode_shortcut: "Ensure memoryMode is false; the run must use a fresh room, not seeded memory.",
  room_not_fresh: "Create the room AFTER run start and ensure no preloaded artifacts are present.",
  evidence_file_missing: "Persist screenshot/trace/export files to the per-task evidence dir before scoring.",
  deliverable_export_or_reopen: "Fix the deliverable writer/export path so all 5 files download and reopen.",
  official_scorer_not_pass: "Inspect the package verifier output; the deliverable package failed validation.",
  focus_mode_missing: "Enable Focus Mode + attention overlay during the artifact edit.",
  proof_gate_missing: "A required proof gate was not recorded; check the live driver emitted all gates.",
  answer_key_contamination: "Run generic-only; a family/answer-key writer must not fire.",
  unclassified: "Inspect the receipt errors; classify and add a rule to classifyRootCause.",
};

/** Build one failure pattern per failed task (deterministic; pass `now` for stable tests). */
export function buildFailurePatterns(failures: TaskFailure[], now: number): NodeMemFailurePattern[] {
  return failures.map((f) => {
    const rootCause = classifyRootCause(f.reason);
    return {
      id: `${f.lane}:${f.taskId}:${rootCause}`,
      symptom: f.reason.length > 300 ? `${f.reason.slice(0, 297)}...` : f.reason,
      rootCause,
      regressionTest: regressionCommand(f.taskId, f.lane),
      fixSummary: HINTS[rootCause] ?? HINTS.unclassified,
      affectedSystems: [f.taskId],
      receiptRefs: f.receiptRef ? [f.receiptRef] : [],
      createdAt: now,
      source: f.source,
    };
  });
}

/**
 * Merge incoming failures into the existing memory:
 *  - drop any pattern whose task now PASSES (resolved),
 *  - upsert incoming by id (latest wins),
 *  - keep still-unresolved prior patterns.
 */
export function mergeFailureMemory(
  existing: NodeMemFailurePattern[],
  incoming: NodeMemFailurePattern[],
  passedTaskIds: string[],
): NodeMemFailurePattern[] {
  const passed = new Set(passedTaskIds);
  const isResolved = (p: NodeMemFailurePattern) => p.affectedSystems.every((t) => passed.has(t));
  const byId = new Map<string, NodeMemFailurePattern>();
  for (const p of existing) if (!isResolved(p)) byId.set(p.id, p);
  for (const p of incoming) if (!isResolved(p)) byId.set(p.id, p);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Distinct task ids with an unresolved failure pattern = the re-run targets. */
export function repairTargets(memory: NodeMemFailurePattern[]): string[] {
  return [...new Set(memory.flatMap((p) => p.affectedSystems))].sort();
}

/**
 * Recall prior failures with the same root cause and turn them into a scaffold suggestion.
 * This is the deterministic proof that memory compounds: failure B does not start from a blank
 * prompt if failure A already taught the loop a repair pattern.
 */
export function suggestScaffoldFromFailureMemory(
  memory: NodeMemFailurePattern[],
  currentFailure: TaskFailure,
  now: number,
): MemoryBackedScaffoldSuggestion | null {
  const [current] = buildFailurePatterns([currentFailure], now);
  const matches = memory
    .filter((pattern) => pattern.rootCause === current.rootCause)
    .sort((a, b) => sourceWeight(b.source) - sourceWeight(a.source) || b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  if (!matches.length) return null;
  const grounded = matches.some((pattern) => isGroundedSource(pattern.source));
  const syntheticOnly = matches.every((pattern) => pattern.source === "synthetic_edge_case" || pattern.source === "model_generated_proposal");
  return {
    targetTaskId: currentFailure.taskId,
    rootCause: current.rootCause,
    suggestedChange: `${matches[0].fixSummary} Reuse prior failure evidence before changing verifier gates.`,
    rerunCommand: current.regressionTest,
    recalledPatternIds: matches.map((pattern) => pattern.id),
    recalledReceiptRefs: [...new Set(matches.flatMap((pattern) => pattern.receiptRefs))].sort(),
    sourceConfidence: grounded ? "grounded" : syntheticOnly ? "synthetic_only" : "mixed",
  };
}

function sourceWeight(source: NodeMemSource | undefined): number {
  if (source === "official_benchmark") return 5;
  if (source === "real_user_run" || source === "live_browser_proof") return 4;
  if (source === "human_feedback") return 3;
  if (source === "redteam_proposal") return 2;
  if (source === "synthetic_edge_case" || source === "model_generated_proposal") return 1;
  return 0;
}

function isGroundedSource(source: NodeMemSource | undefined): boolean {
  return source === "official_benchmark" || source === "real_user_run" || source === "live_browser_proof" || source === "human_feedback";
}
