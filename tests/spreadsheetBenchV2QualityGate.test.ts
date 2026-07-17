import { describe, expect, it } from "vitest";
import {
  SPREADSHEETBENCH_V2_ACCEPTED_BASELINES,
  SPREADSHEETBENCH_V2_CATEGORIES,
  SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS,
  buildSpreadsheetBenchV2QualityGate,
  evaluateSpreadsheetBenchV2QualityGate,
  formatSpreadsheetBenchV2QualityGateDense,
  type SpreadsheetBenchV2Category,
  type SpreadsheetBenchV2OfficialResultAudit,
  type SpreadsheetBenchV2QualityGateInput,
  type SpreadsheetBenchV2TaskReceiptAudit,
} from "../src/eval/spreadsheetBenchV2QualityGate";

const HASH = "a".repeat(64);

describe("SpreadsheetBench V2 fail-closed quality gate", () => {
  it("passes only with authentic scoring, exact 321 receipt coverage, improved categories, and real VLM passes", () => {
    const verdict = evaluateSpreadsheetBenchV2QualityGate(passingInput());

    expect(verdict.pass).toBe(true);
    expect(verdict.scorerAuthenticity).toMatchObject({ status: "pass", authentic: true });
    expect(verdict.coverage).toMatchObject({
      status: "pass",
      officialScoredTaskCount: 321,
      uniqueModelRunTaskCount: 321,
      traceReceiptCount: 321,
      candidateReceiptCount: 321,
      scorerReceiptCount: 321,
    });
    expect(verdict.provenance.status).toBe("pass");
    expect(verdict.performance.status).toBe("pass");
    expect(verdict.gates.every((gate) => gate.status === "pass")).toBe(true);
  });

  it("keeps scorer authenticity separate from performance at the accepted baseline", () => {
    const input = passingInput();
    const receipt = receiptFrom(input);
    const audits = input.officialResultAudits!;
    for (const category of ["Debugging", "Financial_Model", "Template"] as const) {
      const baseline = SPREADSHEETBENCH_V2_ACCEPTED_BASELINES[category];
      const metric = categoryMetric(receipt, category);
      metric.passCount = 0;
      metric.accuracy = 0;
      metric.modificationAccuracy = baseline.modificationAccuracy;
      metric.regressionAccuracy = baseline.regressionAccuracy;
      const audit = auditFor(audits, category);
      audit.exactPassCount = 0;
      audit.modificationAccuracy = baseline.modificationAccuracy;
      audit.regressionAccuracy = baseline.regressionAccuracy;
    }
    const visualMetric = categoryMetric(receipt, "Visualization");
    visualMetric.passCount = 0;
    visualMetric.accuracy = 0;
    visualMetric.evaluatedByVlm = 0;
    const visualAudit = auditFor(audits, "Visualization");
    visualAudit.exactPassCount = 0;
    visualAudit.evaluatedByVlm = 0;
    visualAudit.realVlmPassCount = 0;
    metricRoot(receipt).visualJudgeCalls = 0;
    syncAggregateScore(receipt);

    const verdict = evaluateSpreadsheetBenchV2QualityGate(input);

    expect(verdict.scorerAuthenticity.status).toBe("pass");
    expect(verdict.coverage.status).toBe("pass");
    expect(verdict.performance.status).toBe("blocked");
    expect(verdict.performance.categories.Debugging.modificationImprovementPass).toBe(false);
    expect(verdict.performance.visualization.realVlmPassesPass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  it("blocks malformed scorer identity even when measured performance is high", () => {
    const input = passingInput();
    receiptFrom(input).verifier = "local_proxy_scorer";

    const verdict = evaluateSpreadsheetBenchV2QualityGate(input);

    expect(verdict.scorerAuthenticity.status).toBe("blocked");
    expect(verdict.performance.status).toBe("pass");
    expect(verdict.provenance.status).toBe("pass");
    expect(verdict.blockers).toContain("scorer_authenticity");
  });

  it("requires exact 321/321 category coverage", () => {
    const input = passingInput();
    input.taskReceiptAudits = input.taskReceiptAudits!.slice(0, -1);

    const verdict = evaluateSpreadsheetBenchV2QualityGate(input);

    expect(verdict.coverage.status).toBe("blocked");
    expect(verdict.coverage.uniqueModelRunTaskCount).toBe(320);
    expect(verdict.coverage.categoryTaskCounts.Visualization).toBe(23);
    expect(verdict.gates.find((gate) => gate.id === "official_coverage")?.status).toBe("blocked");
  });

  it("requires per-task trace, candidate, and scorer receipts", () => {
    const input = passingInput();
    input.taskReceiptAudits![0] = {
      ...input.taskReceiptAudits![0],
      traceReceiptValid: false,
      candidateReceiptValid: false,
      scorerReceiptValid: false,
      errors: ["hash mismatch"],
    };

    const verdict = evaluateSpreadsheetBenchV2QualityGate(input);

    expect(verdict.coverage).toMatchObject({
      traceReceiptCount: 320,
      candidateReceiptCount: 320,
      scorerReceiptCount: 320,
    });
    expect(verdict.provenance.status).toBe("blocked");
    expect(verdict.provenance.invalidTaskIds).toContain(input.taskReceiptAudits![0].taskId);
  });

  it("blocks unexplained empty editing plans but accepts a substantive structured explanation", () => {
    const unexplained = passingInput();
    unexplained.taskReceiptAudits![0] = {
      ...unexplained.taskReceiptAudits![0],
      editPlanOperationCount: 0,
      emptyPlanExplained: false,
    };
    const blocked = evaluateSpreadsheetBenchV2QualityGate(unexplained);
    expect(blocked.provenance.unexplainedEmptyEditingPlanIds).toEqual([unexplained.taskReceiptAudits![0].taskId]);
    expect(blocked.gates.find((gate) => gate.id === "editing_plan_integrity")?.status).toBe("blocked");

    const explained = passingInput();
    explained.taskReceiptAudits![0] = {
      ...explained.taskReceiptAudits![0],
      editPlanOperationCount: 0,
      emptyPlanExplained: true,
    };
    const passed = evaluateSpreadsheetBenchV2QualityGate(explained);
    expect(passed.provenance).toMatchObject({
      status: "pass",
      emptyEditingPlanCount: 1,
      explainedEmptyEditingPlanCount: 1,
      unexplainedEmptyEditingPlanIds: [],
    });
  });

  it("enforces strict modification improvement, no regression decline, and nonzero exact passes", () => {
    const input = passingInput();
    const receipt = receiptFrom(input);
    const audits = input.officialResultAudits!;

    categoryMetric(receipt, "Debugging").modificationAccuracy = SPREADSHEETBENCH_V2_ACCEPTED_BASELINES.Debugging.modificationAccuracy;
    auditFor(audits, "Debugging").modificationAccuracy = SPREADSHEETBENCH_V2_ACCEPTED_BASELINES.Debugging.modificationAccuracy;
    categoryMetric(receipt, "Financial_Model").regressionAccuracy = SPREADSHEETBENCH_V2_ACCEPTED_BASELINES.Financial_Model.regressionAccuracy - 0.0001;
    auditFor(audits, "Financial_Model").regressionAccuracy = SPREADSHEETBENCH_V2_ACCEPTED_BASELINES.Financial_Model.regressionAccuracy - 0.0001;
    categoryMetric(receipt, "Template").passCount = 0;
    categoryMetric(receipt, "Template").accuracy = 0;
    auditFor(audits, "Template").exactPassCount = 0;
    syncAggregateScore(receipt);

    const verdict = evaluateSpreadsheetBenchV2QualityGate(input);

    expect(verdict.scorerAuthenticity.status).toBe("pass");
    expect(verdict.performance.categories.Debugging.modificationImprovementPass).toBe(false);
    expect(verdict.performance.categories.Financial_Model.regressionNoDeclinePass).toBe(false);
    expect(verdict.performance.categories.Template.exactPassesPass).toBe(false);
    expect(verdict.gates.find((gate) => gate.id === "category_performance")?.status).toBe("blocked");
  });

  it("rejects visualization pass claims without successful VLM checklist evidence", () => {
    const input = passingInput();
    const visualAudit = auditFor(input.officialResultAudits!, "Visualization");
    visualAudit.realVlmPassCount = 0;
    visualAudit.valid = false;
    visualAudit.errors = ["claimed pass has no VLM checklist details"];

    const verdict = evaluateSpreadsheetBenchV2QualityGate(input);

    expect(verdict.scorerAuthenticity.status).toBe("blocked");
    expect(verdict.performance.visualization.exactPassesPass).toBe(true);
    expect(verdict.performance.visualization.realVlmPassesPass).toBe(false);
    expect(verdict.gates.find((gate) => gate.id === "visualization_vlm")?.status).toBe("blocked");
  });

  it("emits deterministic dense and JSON-ready verdicts and fails closed on missing files", () => {
    const verdict = evaluateSpreadsheetBenchV2QualityGate(passingInput());
    const first = formatSpreadsheetBenchV2QualityGateDense(verdict);
    const second = formatSpreadsheetBenchV2QualityGateDense(verdict);
    expect(second).toBe(first);
    expect(first).toContain("status=PASS");
    expect(first).toContain("coverage=321/321");
    expect(JSON.parse(JSON.stringify(verdict))).toEqual(verdict);

    const missing = buildSpreadsheetBenchV2QualityGate({
      cwd: process.cwd(),
      officialReceiptPath: "does-not-exist/official.json",
      modelRunReceiptPaths: ["does-not-exist/model-run.json"],
    });
    expect(missing.status).toBe("blocked");
    expect(missing.scorerAuthenticity.status).toBe("blocked");
    expect(missing.provenance.status).toBe("blocked");
  });
});

function passingInput(): SpreadsheetBenchV2QualityGateInput {
  const metrics = {
    Debugging: deterministicMetric(100, 0.2682, 0.998),
    Financial_Model: deterministicMetric(100, 0.1016, 0.9499),
    Template: deterministicMetric(97, 0.0391, 0.9998),
    Visualization: {
      taskCount: 24,
      passCount: 1,
      accuracy: 1 / 24,
      averageChecklistScore: 0.75,
      evaluatedByVlm: 2,
      errorsScoredAsZero: 22,
      judgeCalls: 2,
    },
  };
  const passCount = 4;
  const passRate = passCount / 321;
  const officialReceipt = {
    schema: 1,
    verifier: "spreadsheetbench_official_scorer",
    track: "spreadsheetbench-v2",
    accepted: true,
    score: {
      averageOverall: passRate,
      passRate,
      passCount,
      scoredTaskCount: 321,
    },
    metric: {
      primary: "official_task_accuracy",
      categoryMetrics: metrics,
      visualAccThreshold: 0.7,
      visualJudgeModel: "z-ai/glm-4.6v",
      visualJudgeCalls: 2,
    },
    source: {
      kind: "upstream_official_evaluators",
      repository: "https://github.com/RUCKBReasoning/SpreadsheetBench-2",
      commit: "b".repeat(40),
      deterministicEvaluator: "upstream/evaluation.py",
      deterministicEvaluatorSha256: HASH,
      visualEvaluator: "upstream/run_visual_vlm_checklist_eval.py",
      visualEvaluatorSha256: HASH,
      projectionReceipt: "receipts/projection.json",
      projectionReceiptSha256: HASH,
      caseManifestSha256: HASH,
      refreshReceipt: "receipts/refresh.json",
      refreshReceiptSha256: HASH,
      results: SPREADSHEETBENCH_V2_CATEGORIES.map((category) => ({
        category,
        path: `results/${category}.json`,
        sha256: HASH,
      })),
    },
  };

  return {
    officialReceipt,
    officialResultAudits: [
      deterministicAudit("Debugging", 100, 0.2682, 0.998),
      deterministicAudit("Financial_Model", 100, 0.1016, 0.9499),
      deterministicAudit("Template", 97, 0.0391, 0.9998),
      {
        category: "Visualization",
        valid: true,
        taskCount: 24,
        uniqueTaskCount: 24,
        exactPassCount: 1,
        evaluatedByVlm: 2,
        realVlmPassCount: 1,
        errors: [],
      },
    ],
    taskReceiptAudits: taskAudits(),
  };
}

function deterministicMetric(taskCount: number, modificationAccuracy: number, regressionAccuracy: number) {
  return {
    taskCount,
    passCount: 1,
    accuracy: 1 / taskCount,
    regressionAccuracy,
    modificationAccuracy,
  };
}

function deterministicAudit(
  category: Exclude<SpreadsheetBenchV2Category, "Visualization">,
  taskCount: number,
  modificationAccuracy: number,
  regressionAccuracy: number,
): SpreadsheetBenchV2OfficialResultAudit {
  return {
    category,
    valid: true,
    taskCount,
    uniqueTaskCount: taskCount,
    exactPassCount: 1,
    modificationAccuracy,
    regressionAccuracy,
    errors: [],
  };
}

function taskAudits(): SpreadsheetBenchV2TaskReceiptAudit[] {
  return SPREADSHEETBENCH_V2_CATEGORIES.flatMap((category) =>
    Array.from({ length: SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category] }, (_, index) => ({
      taskId: `${category}/${String(index + 1).padStart(3, "0")}`,
      category,
      traceReceiptValid: true,
      candidateReceiptValid: true,
      scorerReceiptValid: true,
      editPlanOperationCount: 1,
      emptyPlanExplained: false,
      errors: [],
    })),
  );
}

function receiptFrom(input: SpreadsheetBenchV2QualityGateInput): Record<string, any> {
  return input.officialReceipt as Record<string, any>;
}

function metricRoot(receipt: Record<string, any>): Record<string, any> {
  return receipt.metric;
}

function categoryMetric(receipt: Record<string, any>, category: SpreadsheetBenchV2Category): Record<string, any> {
  return receipt.metric.categoryMetrics[category];
}

function auditFor(
  audits: SpreadsheetBenchV2OfficialResultAudit[],
  category: SpreadsheetBenchV2Category,
): SpreadsheetBenchV2OfficialResultAudit {
  return audits.find((audit) => audit.category === category)!;
}

function syncAggregateScore(receipt: Record<string, any>): void {
  const passCount = SPREADSHEETBENCH_V2_CATEGORIES.reduce(
    (sum, category) => sum + receipt.metric.categoryMetrics[category].passCount,
    0,
  );
  receipt.score.passCount = passCount;
  receipt.score.passRate = passCount / 321;
  receipt.score.averageOverall = passCount / 321;
}
