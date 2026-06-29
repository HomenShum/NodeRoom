// Failure-memory layer (file-backed, framework-agnostic).
//
// Turns per-task proof failures into NodeMemFailurePattern records so a re-run can target ONLY the
// unresolved failures and condition the agent off known-bad paths -- the "memory -> repair" half of
// the NodeRL loop. Pure + deterministic (the CLI does file IO); no Convex dependency, so it works in
// the portable NodeRL extraction as well as in NodeRoom.
import type { NodeMemFailurePattern } from "./core/types";

export interface TaskFailure {
  taskId: string;
  reason: string;
  /** Which proof lane produced the failure. */
  lane: "live" | "isolated";
  receiptRef?: string;
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
