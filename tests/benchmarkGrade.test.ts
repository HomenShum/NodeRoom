/**
 * Smoke test for the Convex-side nonbtb grader.
 *
 * Three properties pinned here:
 *   1. PARITY — every NONBTB_RUBRICS entry in `convex/lib/goldenRubrics.ts` is byte-equivalent to
 *      the on-disk `src/benchmarks/nonbtb/<id>/rubric.json`. Any drift fails CI, so the inlined
 *      Convex rubrics never silently fork from the corpus the Vite-side `tests/goldenDataset.test.ts`
 *      already gates.
 *   2. ADAPTER — `cellsToGoldenOutputs` extracts grader-ready `{ value, formula, cite }` records
 *      from a fake artifact's elements + dataframe.columns. Two cell shapes are covered:
 *        (a) nested cell payload `{ value, formula, cite }` (the agent's current write shape), and
 *        (b) bare scalar value + sibling `<key>__formula` / `<key>__cite` rows (the alternative
 *            shape supported for older artifacts).
 *   3. END-TO-END — given a fake artifact with known cell writes, the pipeline scores 1.0 for the
 *      golden-good fixture and < 0.5 with ≥1 flag for a fabricated-key / wrong-value fixture.
 *      This is the same property the on-disk `tests/goldenDataset.test.ts` pins for the Vite path —
 *      the Convex path now has the same gate.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gradeGolden } from "../src/benchmarks/golden/grader";
import {
  NONBTB_RUBRICS,
  NONBTB_TASK_IDS,
  getNonbtbRubric,
} from "../convex/lib/goldenRubrics";
import {
  cellsToGoldenOutputs,
  type CellElement,
} from "../convex/lib/cellsToGoldenOutputs";

const FIXTURE_ROOT = resolve(__dirname, "..", "src", "benchmarks", "nonbtb");

function loadJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

describe("benchmarkGrade — parity with the on-disk golden rubrics", () => {
  it.each(NONBTB_TASK_IDS)("NONBTB_RUBRICS[%s] === rubric.json on disk", (taskId) => {
    const onDisk = loadJson<unknown>(resolve(FIXTURE_ROOT, taskId, "rubric.json"));
    // Deep equality — guarantees the inlined Convex rubric matches the file the Python grader
    // reads. If this drifts, the prod Convex action would score against a forked spec.
    expect(NONBTB_RUBRICS[taskId]).toEqual(onDisk);
  });

  it("exposes exactly the three nonbtb tasks the Vite dataset already gates", () => {
    expect(NONBTB_TASK_IDS).toEqual([
      "nb-01-company-profile",
      "nb-02-vendor-pricing",
      "nb-03-reconciliation",
    ]);
    for (const id of NONBTB_TASK_IDS) expect(getNonbtbRubric(id)).toBeTruthy();
  });
});

/** Build a fake "elements" list (the shape `cellsToGoldenOutputs` consumes) that mirrors what the
 *  agent writes via `applyAgentCellEdit`: one `${rowId}__${columnId}` element per cell. We use a
 *  single row `r1` so the adapter's column extraction (split on `__`) is the only thing exercised. */
function nestedCells(
  pairs: Record<string, { value: number; formula?: string; cite?: { file: string; locator?: string } }>,
  extra: Record<string, unknown> = {},
): { meta: { dataframe: { columns: { id: string; label: string; order: number }[] } }; elements: CellElement[] } {
  const colIds = [...Object.keys(pairs), ...Object.keys(extra)];
  const columns = colIds.map((id, i) => ({ id, label: id, order: i }));
  const elements: CellElement[] = [];
  for (const [key, payload] of Object.entries(pairs)) {
    elements.push({ elementId: `r1__${key}`, value: payload });
  }
  for (const [key, value] of Object.entries(extra)) {
    elements.push({ elementId: `r1__${key}`, value });
  }
  return { meta: { dataframe: { columns } }, elements };
}

describe("benchmarkGrade — cellsToGoldenOutputs adapter", () => {
  it("extracts nested cell payloads `{ value, formula, cite }` keyed by column id", () => {
    const rubric = NONBTB_RUBRICS["nb-01-company-profile"];
    const { meta, elements } = nestedCells({
      revenue_growth_pct: { value: 25.0, formula: "=(B3-B2)/B2*100", cite: { file: "source_financials.csv", locator: "rev" } },
    });
    const out = cellsToGoldenOutputs(rubric, meta, elements);
    expect(out.revenue_growth_pct).toEqual({
      value: 25.0,
      formula: "=(B3-B2)/B2*100",
      cite: { file: "source_financials.csv", locator: "rev" },
    });
  });

  it("merges sibling `<key>__formula` and `<key>__cite` rows onto the value cell (bare-scalar shape)", () => {
    const rubric = NONBTB_RUBRICS["nb-01-company-profile"];
    const elements: CellElement[] = [
      { elementId: "r1__revenue_growth_pct", value: 25.0 },
      { elementId: "r1__revenue_growth_pct__formula", value: "=(B3-B2)/B2*100" },
      { elementId: "r1__revenue_growth_pct__cite", value: { file: "source_financials.csv", locator: "rev" } },
    ];
    const meta = { dataframe: { columns: [{ id: "revenue_growth_pct", label: "revenue_growth_pct", order: 0 }] } };
    const out = cellsToGoldenOutputs(rubric, meta, elements);
    expect(out.revenue_growth_pct?.value).toBe(25.0);
    expect(out.revenue_growth_pct?.formula).toBe("=(B3-B2)/B2*100");
    expect(out.revenue_growth_pct?.cite).toEqual({ file: "source_financials.csv", locator: "rev" });
  });

  it("emits fabricated keys (columns NOT in allowed_keys) so the grader's fabrication branch fires", () => {
    const rubric = NONBTB_RUBRICS["nb-01-company-profile"];
    const { meta, elements } = nestedCells(
      {
        revenue_growth_pct: { value: 25.0, formula: "=x", cite: { file: "source_financials.csv" } },
      },
      { made_up_metric: { value: 99, formula: "=1", cite: { file: "nope.csv" } } },
    );
    const out = cellsToGoldenOutputs(rubric, meta, elements);
    expect(out.made_up_metric).toBeDefined();
    expect((out.made_up_metric!.value as number)).toBe(99);
  });

  it("drops empty rows (no value, no formula, no cite) so missing keys flag honestly", () => {
    const rubric = NONBTB_RUBRICS["nb-01-company-profile"];
    const meta = { dataframe: { columns: [{ id: "revenue_growth_pct", label: "revenue_growth_pct", order: 0 }] } };
    const elements: CellElement[] = [{ elementId: "r1__revenue_growth_pct", value: null }];
    const out = cellsToGoldenOutputs(rubric, meta, elements);
    expect(out.revenue_growth_pct).toBeUndefined();
  });

  it("normalizes numeric strings without losing zero at the room-cell boundary", () => {
    const rubric = NONBTB_RUBRICS["nb-03-reconciliation"];
    const meta = { dataframe: { columns: [
      { id: "inv2_amount_diff", label: "inv2_amount_diff", order: 0 },
      { id: "num_discrepancies", label: "num_discrepancies", order: 1 },
    ] } };
    const elements: CellElement[] = [
      { elementId: "r1__inv2_amount_diff", value: "0" },
      { elementId: "r1__num_discrepancies", value: { value: "3", cite: { file: "ledger.csv" } } },
    ];
    const out = cellsToGoldenOutputs(rubric, meta, elements);
    expect(out.inv2_amount_diff?.value).toBe(0);
    expect(out.num_discrepancies?.value).toBe(3);
  });
});

describe("benchmarkGrade — pipeline (artifact cells → adapter → grader)", () => {
  function gradeArtifact(taskId: string, fixture: ReturnType<typeof nestedCells>) {
    const rubric = NONBTB_RUBRICS[taskId];
    const outputs = cellsToGoldenOutputs(rubric, fixture.meta, fixture.elements);
    return gradeGolden(rubric, outputs);
  }

  it("ACCEPTS a golden-good artifact (score 1.0, zero fabrications)", () => {
    const fixture = nestedCells({
      revenue_growth_pct: { value: 25.0, formula: "=(B3-B2)/B2*100", cite: { file: "source_financials.csv", locator: "rev" } },
      gross_margin_2024: { value: 40.0, formula: "=(B2-C2)/B2*100", cite: { file: "source_financials.csv", locator: "2024" } },
      gross_margin_2025: { value: 44.0, formula: "=(B3-C3)/B3*100", cite: { file: "source_financials.csv", locator: "2025" } },
      eps_2024: { value: 2.40, formula: "=D2/Shares", cite: { file: "source_shares.txt", locator: "shares" } },
      eps_2025: { value: 3.50, formula: "=D3/Shares", cite: { file: "source_shares.txt", locator: "shares" } },
    });
    const r = gradeArtifact("nb-01-company-profile", fixture);
    expect(r.score, `unexpected flags: ${r.flags.join("; ")}`).toBe(1.0);
    expect(r.fabrication).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("REJECTS a fabricated / wrong-value artifact (score < 0.5, ≥1 flag, fabrication fires)", () => {
    const fixture = nestedCells(
      {
        // wrong value (rubric expects 25.0 ±0.1, we wrote 30.0)
        revenue_growth_pct: { value: 30.0, formula: "25.0", cite: { file: "guess.csv", locator: "x" } },
        // wrong value (rubric expects 40.0 ±0.1, we wrote 55.0); hardcoded literal (no leading "=")
        gross_margin_2024: { value: 55.0, formula: "40", cite: { file: "source_financials.csv", locator: "2024" } },
        // missing: gross_margin_2025, eps_2025
        eps_2024: { value: 2.40, formula: "=D2/E1", cite: { file: "source_shares.txt", locator: "shares" } },
      },
      { made_up_metric: { value: 99, formula: "=1", cite: { file: "nope.csv", locator: "invented" } } }, // fabricated key
    );
    const r = gradeArtifact("nb-01-company-profile", fixture);
    expect(r.ok).toBe(false);
    expect(r.score).toBeLessThan(0.5);
    expect(r.flags.length).toBeGreaterThan(0);
    const f = r.flags.join("\n");
    expect(f).toMatch(/wrong value for "revenue_growth_pct"/);
    expect(f).toMatch(/"revenue_growth_pct" is a hardcoded literal/);
    expect(f).toMatch(/"revenue_growth_pct" cites non-source file "guess\.csv"/);
    expect(f).toMatch(/fabricated key "made_up_metric"/);
    expect(f).toMatch(/missing key "gross_margin_2025"/);
    // made_up_metric (not allowed) + revenue_growth_pct (cites guess.csv) = 2 fabrications
    expect(r.fabrication).toBe(2);
  });

  it("honors tolerance at the boundary", () => {
    const within = nestedCells({
      revenue_growth_pct: { value: 25.09, formula: "=x", cite: { file: "source_financials.csv" } },
      gross_margin_2024: { value: 40.0, formula: "=x", cite: { file: "source_financials.csv" } },
      gross_margin_2025: { value: 44.0, formula: "=x", cite: { file: "source_financials.csv" } },
      eps_2024: { value: 2.40, formula: "=x", cite: { file: "source_shares.txt" } },
      eps_2025: { value: 3.50, formula: "=x", cite: { file: "source_shares.txt" } },
    });
    const outside = nestedCells({
      revenue_growth_pct: { value: 25.2, formula: "=x", cite: { file: "source_financials.csv" } },
      gross_margin_2024: { value: 40.0, formula: "=x", cite: { file: "source_financials.csv" } },
      gross_margin_2025: { value: 44.0, formula: "=x", cite: { file: "source_financials.csv" } },
      eps_2024: { value: 2.40, formula: "=x", cite: { file: "source_shares.txt" } },
      eps_2025: { value: 3.50, formula: "=x", cite: { file: "source_shares.txt" } },
    });
    expect(gradeArtifact("nb-01-company-profile", within).score).toBe(1.0);
    expect(gradeArtifact("nb-01-company-profile", outside).score).toBeLessThan(1.0);
  });
});
