// Deterministic FR-020C live-UI full-suite gate.
//
// FR-020C ("full BankerToolBench suite through the live product UI") flips blocked -> passed
// ONLY when every expected task has a passing per-task fresh-room live receipt (fresh room ->
// upload -> public @nodeagent -> export -> reopen -> official verifier + visual judge).
//
// This is the live-lane sibling of bankerToolBenchFullSuiteGate. It is pure over already-decided
// per-task pass/fail results (the CLI reads receipts and validates them with the existing
// validateFreshRoomProofReceipt), so it is trivially unit-testable. It proves COMPLETION through
// the product UI -- not a 100% rubric pass rate.

export interface LiveTaskResult {
  taskId: string;
  passed: boolean;
  reason?: string;
}

export interface LiveSuiteGateOptions {
  /** Number of official tasks the live suite must cover. Default 100. */
  expectedCount?: number;
  /** Optional exact official task-id set; when provided, set-equality is required. */
  expectedTaskIds?: string[];
}

export interface LiveSuiteGateVerdict {
  schema: "noderoom-btb-livesuite-gate-v1";
  expectedCount: number;
  /** Distinct task ids with any live receipt (pass or fail). */
  evaluatedTaskCount: number;
  /** Distinct task ids with >= 1 passing live receipt. */
  passedTaskCount: number;
  failedTaskIds: string[];
  /** Expected ids with no passing live receipt (only when expectedTaskIds given). */
  missingTaskIds: string[];
  flipEligible: boolean;
  claim: string;
}

export function evaluateLiveSuiteGate(
  results: LiveTaskResult[],
  options: LiveSuiteGateOptions = {},
): LiveSuiteGateVerdict {
  const expectedCount = options.expectedCount ?? 100;
  const expectedIds = options.expectedTaskIds?.length ? options.expectedTaskIds : null;

  // A task passes if ANY of its receipts passes (re-runs/repairs count as proven).
  const byId = new Map<string, boolean>();
  for (const r of results) {
    if (!r.taskId) continue;
    byId.set(r.taskId, (byId.get(r.taskId) ?? false) || r.passed === true);
  }

  const passedTaskIds = [...byId.entries()].filter(([, passed]) => passed).map(([id]) => id);
  const failedTaskIds = [...byId.entries()].filter(([, passed]) => !passed).map(([id]) => id).sort();
  const passedSet = new Set(passedTaskIds);

  let missingTaskIds: string[] = [];
  if (expectedIds) missingTaskIds = expectedIds.filter((id) => !passedSet.has(id)).sort();

  const flipEligible = expectedIds
    ? missingTaskIds.length === 0
    : passedTaskIds.length >= expectedCount;

  const claim = flipEligible
    ? `All ${passedTaskIds.length}/${expectedCount} BankerToolBench tasks completed through the live ` +
      `product UI with passing per-task fresh-room receipts. This proves COMPLETION through the ` +
      `product, not a 100% rubric pass rate.`
    : `Live-UI full-suite proof NOT earned: ${passedTaskIds.length}/${expectedCount} tasks have a ` +
      `passing live receipt (${failedTaskIds.length} failed` +
      `${expectedIds ? `, ${missingTaskIds.length} missing` : ""}).`;

  return {
    schema: "noderoom-btb-livesuite-gate-v1",
    expectedCount,
    evaluatedTaskCount: byId.size,
    passedTaskCount: passedTaskIds.length,
    failedTaskIds,
    missingTaskIds,
    flipEligible,
    claim,
  };
}
