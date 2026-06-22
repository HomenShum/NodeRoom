/**
 * Golden dataset self-test — the Docker-free verification gate.
 *
 * This is the "fool-proof for prod" property: WITHOUT running an agent, without Python, and without
 * a Harbor/Docker container, prove that the NodeRoom-native grader (src/benchmarks/golden/grader.ts)
 *   1. ACCEPTS every golden-correct deliverable (scores exactly 1.0), and
 *   2. REJECTS every golden-bad deliverable, with each anti-cheat dimension demonstrably firing.
 *
 * If this is green, the same verifier that gates this test gates a live agent run in the UI or a
 * Convex action — there is no Docker-only path that could pass here but fail in prod, because the
 * grader and the golden corpus are bundled (import.meta.glob), not mounted into a container.
 */
import { describe, it, expect } from "vitest";
import { gradeGolden } from "../src/benchmarks/golden/grader";
import { goldenDataset } from "../src/benchmarks/golden/dataset";

const tasks = goldenDataset();

describe("golden dataset — Docker-free verifier self-test (prod gate)", () => {
  it("bundles the NodeBench tasks, each with a rubric whose expected keys are all allowed", () => {
    expect(tasks.map((t) => t.taskId)).toEqual([
      "nb-01-company-profile",
      "nb-02-vendor-pricing",
      "nb-03-reconciliation",
    ]);
    for (const t of tasks) {
      expect(t.rubric, `${t.taskId} rubric missing`).toBeTruthy();
      expect(t.good, `${t.taskId} golden-good missing`).toBeTruthy();
      expect(t.bad, `${t.taskId} golden-bad missing`).toBeTruthy();
      for (const k of Object.keys(t.rubric.expected)) {
        expect(t.rubric.allowed_keys, `${t.taskId}: expected key ${k} not in allowed_keys`).toContain(k);
      }
    }
  });

  it.each(tasks)("ACCEPTS the golden-good deliverable for $taskId (score 1.0, zero fabrications)", (t) => {
    const r = gradeGolden(t.rubric, t.good);
    expect(r.score, `unexpected flags: ${r.flags.join("; ")}`).toBe(1.0);
    expect(r.fabrication).toBe(0);
    expect(r.ok).toBe(true);
  });

  it.each(tasks)("REJECTS the golden-bad deliverable for $taskId (anti-cheat fires, score < 0.5)", (t) => {
    const r = gradeGolden(t.rubric, t.bad!);
    expect(r.ok).toBe(false);
    expect(r.score).toBeLessThan(0.5);
    expect(r.flags.length, "expected at least one failure flag").toBeGreaterThan(0);
  });

  it("nb-01 bad output trips every failure mode (wrong value, hardcoded literal, fake citation, fabricated + missing keys)", () => {
    const t = tasks.find((x) => x.taskId === "nb-01-company-profile")!;
    const r = gradeGolden(t.rubric, t.bad!);
    const f = r.flags.join("\n");
    expect(f).toMatch(/wrong value for "revenue_growth_pct"/);
    expect(f).toMatch(/"revenue_growth_pct" is a hardcoded literal/);
    expect(f).toMatch(/"revenue_growth_pct" cites non-source file "guess\.csv"/);
    expect(f).toMatch(/fabricated key "made_up_metric"/);
    expect(f).toMatch(/missing key "gross_margin_2025"/);
    // fabrication = made_up_metric (not allowed) + revenue_growth_pct (cites guess.csv) = 2 → -20%
    expect(r.fabrication).toBe(2);
  });

  it("tolerance is honored: a value just inside tol passes, just outside fails", () => {
    const rubric = tasks[0].rubric; // nb-01: revenue_growth_pct tol 0.1, gross_margin_2024 tol 0.1, etc.
    const within = gradeGolden(rubric, structuredCloneGood(tasks[0].good, "revenue_growth_pct", 25.09));
    const outside = gradeGolden(rubric, structuredCloneGood(tasks[0].good, "revenue_growth_pct", 25.2));
    expect(within.score).toBe(1.0);
    expect(outside.score).toBeLessThan(1.0);
  });
});

/** Clone a golden-good deliverable but override one key's numeric value (for the tolerance probe). */
function structuredCloneGood(
  good: ReturnType<typeof goldenDataset>[number]["good"],
  key: string,
  value: number,
) {
  const copy: typeof good = JSON.parse(JSON.stringify(good));
  if (copy[key]) (copy[key] as { value: unknown }).value = value;
  return copy;
}
