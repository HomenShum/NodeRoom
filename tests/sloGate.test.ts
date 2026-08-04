import { describe, expect, it } from "vitest";
import { computeSloReport, thresholds, type SloRun } from "../scripts/slo-gate";

function run(overrides: Partial<SloRun> = {}): SloRun {
  return {
    room: "slo-test",
    stopReason: "done",
    ms: 100,
    steps: 5,
    toolCalls: 10,
    toolErrors: 0,
    conflictsSurvived: 0,
    modelCalls: 5,
    ...overrides,
  };
}

describe("slo-gate golden metrics", () => {
  it("computes the three golden metrics by exact name on a clean sample", () => {
    const report = computeSloReport(Array.from({ length: 8 }, () => run()));
    expect(report.metrics["task-completion-rate"]).toBe(1);
    expect(report.metrics["tool-call-error-rate"]).toBe(0);
    expect(report.metrics["p99-latency-ms"]).toBe(100);
    expect(thresholds["task-completion-rate"]).toBe(0.95);
    expect(thresholds["tool-call-error-rate"]).toBe(0.001);
    expect(thresholds["p99-latency-ms"]).toBe(2500);
    expect(report.passed).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("reports p99 > p95 on a skewed latency sample", () => {
    // 20 samples: 19 fast, 1 slow tail. p95 lands on a fast sample, p99 on the tail.
    const runs = Array.from({ length: 20 }, (_, i) => run({ ms: i === 19 ? 1200 : 100 }));
    const report = computeSloReport(runs);
    expect(report.metrics.p95RunMs).toBe(100);
    expect(report.metrics["p99-latency-ms"]).toBe(1200);
    expect(report.metrics["p99-latency-ms"]).toBeGreaterThan(report.metrics.p95RunMs);
    expect(report.passed).toBe(true);
  });

  it("fails the gate by golden-metric name when thresholds are breached", () => {
    const runs = [
      run({ stopReason: "error", error: "boom", toolCalls: 0 }),
      ...Array.from({ length: 7 }, () => run({ toolErrors: 1, ms: 9000 })),
    ];
    const report = computeSloReport(runs);
    expect(report.metrics["task-completion-rate"]).toBe(0.875);
    expect(report.metrics["tool-call-error-rate"]).toBe(0.1);
    expect(report.metrics["p99-latency-ms"]).toBe(9000);
    expect(report.passed).toBe(false);
    expect(report.failures.join("\n")).toContain("task-completion-rate 0.875 < 0.95");
    expect(report.failures.join("\n")).toContain("tool-call-error-rate 0.1 > 0.001");
    expect(report.failures.join("\n")).toContain("p99-latency-ms 9000 > 2500");
  });
});
