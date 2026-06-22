/**
 * tests/playwright.benchmark.config.ts — anti-cheat helper for the UI benchmark driver.
 *
 * This is NOT a Playwright runner config (the runner config lives at the repo root in
 * `playwright.benchmark.config.ts`). This file exists in tests/ because the user-facing
 * task asked for a single helper colocated with the benchmark spec, so the spec can
 * import it with a short relative path.
 *
 * The helper enforces the R6-iteration honest-FAIL pattern as a hard invariant:
 *
 *   The "scripted seed" values for the Q3 variance recompute live in
 *   src/engine/demoRoom.ts. They are the canonical demo output:
 *
 *     r_rev__variance   → "+24%"
 *     r_cogs__variance  → "+27.5%"
 *     r_gp__variance    → "+21.7%"
 *     r_ni__variance    → "+22.4%"
 *
 *   These four strings appear verbatim in demoRoom.ts (lines ~231–238) as
 *   `applyEdit(...)` writes the demo scene seeds onto the sheet. They are also
 *   the canonical expected values for the Q3 variance recompute test in
 *   ui-benchmark-drive.spec.ts — that test is LEGITIMATE because the in-app
 *   memory-mode agent literally re-emits those edits via store.askAgent ->
 *   runHarness({ rt: InMemoryRoomTools, model: scriptedModel(recomputeVariancePlan...) }).
 *
 *   But for ANY OTHER task (NB-01, NB-02, NB-03, …) the same four strings would
 *   mean the test was reading pre-seeded demo data instead of a real agent
 *   computation — i.e. the cheat R6 caught. The helper below makes that class
 *   of regression impossible: if the expected map for a non-variance task ends
 *   up exactly equal to the scripted seed set, assertNotCheating throws.
 *
 *   modelId is informational only (it does not select which model actually
 *   ran — the in-app memory-mode harness is scripted). So we explicitly ignore
 *   it for the cheat check, BUT we still pass it through so the failure message
 *   names the model that was claimed.
 */

/** The canonical scripted-seed values for the Q3 variance demo, mirrored from
 *  src/engine/demoRoom.ts. These are the EXACT strings re-emitted by the
 *  scripted recompute plan; any non-variance task that ends up with this
 *  expected map is, by construction, a cheat. */
export const SCRIPTED_VARIANCE_SEED: Readonly<Record<string, string>> = Object.freeze({
  r_rev__variance: "+24%",
  r_cogs__variance: "+27.5%",
  r_gp__variance: "+21.7%",
  r_ni__variance: "+22.4%",
});

/** Shape of an expected-values entry as written in rubric.json / EXPECTED_VALUES. */
export type ExpectedSpec = { value: string | number; tol?: number };
export type ExpectedMap = Record<string, ExpectedSpec>;

/** Normalise an ExpectedMap to a plain `{key: stringValue}` shape for comparison. */
function normaliseExpected(expected: ExpectedMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(expected)) {
    out[k] = typeof v.value === "string" ? v.value.trim() : String(v.value);
  }
  return out;
}

/** Deep-equal across two `{key:value}` maps (order-insensitive). */
function sameMap(a: Record<string, string>, b: Record<string, string>): boolean {
  const ak = Object.keys(a).sort();
  const bk = Object.keys(b).sort();
  if (ak.length !== bk.length) return false;
  for (let i = 0; i < ak.length; i += 1) if (ak[i] !== bk[i]) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
}

/**
 * Throw if `expected` exactly equals the known scripted seed AND modelId is
 * informational only (always true in memory mode — the harness is scripted).
 *
 * Use this at the TOP of every UI benchmark test case that is NOT the legit
 * Q3 variance recompute. The variance test is exempt because the seed IS the
 * expected output for that scripted recompute — see the explicit exempt-tag
 * in ui-benchmark-drive.spec.ts.
 *
 * @param expected      The expected map for this task (derived from rubric.json).
 * @param scriptedSeed  The known-cheat seed (defaults to SCRIPTED_VARIANCE_SEED).
 * @param modelId       Informational only — included in the error message.
 */
export function assertNotCheating(args: {
  expected: ExpectedMap;
  scriptedSeed?: Readonly<Record<string, string>>;
  modelId: string;
}): void {
  const seed = args.scriptedSeed ?? SCRIPTED_VARIANCE_SEED;
  const normExpected = normaliseExpected(args.expected);
  const normSeed: Record<string, string> = {};
  for (const [k, v] of Object.entries(seed)) normSeed[k] = String(v).trim();

  if (sameMap(normExpected, normSeed)) {
    const msg =
      `[anti-cheat] expected values exactly match the scripted variance seed from ` +
      `src/engine/demoRoom.ts (keys: ${Object.keys(normSeed).sort().join(", ")}). ` +
      `modelId="${args.modelId}" is informational only in memory mode, so the test ` +
      `would have appeared to PASS by reading pre-seeded demo data instead of a real ` +
      `agent computation. This is the regression R6 caught — refusing to run.`;
    throw new Error(msg);
  }
}

/** Helper to load and parse a rubric.json from disk and project it into the
 *  EXPECTED_VALUES shape that ui-benchmark-drive.spec.ts consumes. Kept here so
 *  the spec and the helper agree on the projection. */
export function expectedFromRubric(rubric: unknown): ExpectedMap {
  if (!rubric || typeof rubric !== "object") {
    throw new Error("[anti-cheat] rubric.json is not an object");
  }
  const r = rubric as { expected?: unknown };
  if (!r.expected || typeof r.expected !== "object") {
    throw new Error("[anti-cheat] rubric.json missing `expected` field");
  }
  const out: ExpectedMap = {};
  for (const [k, raw] of Object.entries(r.expected as Record<string, unknown>)) {
    if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
      const v = raw as { value: unknown; tol?: unknown };
      const value =
        typeof v.value === "string" || typeof v.value === "number" ? v.value : String(v.value);
      const tol = typeof v.tol === "number" ? v.tol : undefined;
      out[k] = tol === undefined ? { value } : { value, tol };
    } else if (typeof raw === "string" || typeof raw === "number") {
      out[k] = { value: raw };
    } else {
      throw new Error(`[anti-cheat] rubric.json expected[${k}] is malformed`);
    }
  }
  return out;
}
