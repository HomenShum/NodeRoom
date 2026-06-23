/**
 * Convex-safe rubric registry for the Docker-free golden grader.
 *
 * `src/benchmarks/golden/dataset.ts` resolves rubrics via `import.meta.glob`, which is Vite-only —
 * the Convex bundler will not resolve it. Convex's tsconfig also has `resolveJsonModule` off, so
 * we cannot `import rubric from "../../src/benchmarks/nonbtb/<id>/rubric.json"` either.
 *
 * The lowest-overhead, single-source-of-truth path is to inline the rubrics here as a typed `as const`
 * map (3 rubrics × ~10 lines each) and pin them to the on-disk fixtures with a parity assertion in the
 * smoke test (`tests/benchmarkGrade.test.ts`). Any drift between this map and `src/benchmarks/nonbtb/<id>/rubric.json`
 * fails CI, so the rubrics stay byte-for-byte equal to the corpus the Vite-side self-test already gates.
 *
 * Anything reusing the grader (`gradeGolden`) on the server should import from here, NOT from the
 * Vite dataset module.
 */
import type { GoldenRubric } from "../../src/benchmarks/golden/grader";

export const NONBTB_RUBRICS: Record<string, GoldenRubric> = {
  "nb-01-company-profile": {
    task: "nb-01-company-profile",
    deliverable: "company_profile.xlsx",
    allowed_keys: ["revenue_growth_pct", "gross_margin_2024", "gross_margin_2025", "eps_2024", "eps_2025"],
    expected: {
      revenue_growth_pct: { value: 25.0, tol: 0.1 },
      gross_margin_2024: { value: 40.0, tol: 0.1 },
      gross_margin_2025: { value: 44.0, tol: 0.1 },
      eps_2024: { value: 2.40, tol: 0.01 },
      eps_2025: { value: 3.50, tol: 0.01 },
    },
    formula_required: true,
    citations_required: true,
    sources: ["source_financials.csv", "source_shares.txt"],
  },
  "nb-02-vendor-pricing": {
    task: "nb-02-vendor-pricing",
    deliverable: "pricing.xlsx",
    allowed_keys: ["acme_total", "bolt_total", "cobalt_total", "lowest_total"],
    expected: {
      acme_total: { value: 12500, tol: 0.5 },
      bolt_total: { value: 11800, tol: 0.5 },
      cobalt_total: { value: 13200, tol: 0.5 },
      lowest_total: { value: 11800, tol: 0.5 },
    },
    formula_required: true,
    citations_required: true,
    sources: ["quotes.csv"],
  },
  "nb-03-reconciliation": {
    task: "nb-03-reconciliation",
    deliverable: "reconciliation.md",
    allowed_keys: ["inv2_amount_diff", "inv3_missing_in_bank", "inv4_missing_in_ledger", "num_discrepancies"],
    expected: {
      inv2_amount_diff: { value: 50, tol: 0.5 },
      inv3_missing_in_bank: { value: 300, tol: 0.5 },
      inv4_missing_in_ledger: { value: 300, tol: 0.5 },
      num_discrepancies: { value: 3, tol: 0 },
    },
    formula_required: false,
    citations_required: true,
    sources: ["ledger.csv", "bank.csv"],
  },
};

export type NonbtbTaskId = keyof typeof NONBTB_RUBRICS;

export const NONBTB_TASK_IDS = Object.keys(NONBTB_RUBRICS).sort() as NonbtbTaskId[];

export function getNonbtbRubric(taskId: string): GoldenRubric | undefined {
  return NONBTB_RUBRICS[taskId];
}
