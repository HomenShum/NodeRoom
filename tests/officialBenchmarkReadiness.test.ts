import { describe, expect, it } from "vitest";
import {
  OFFICIAL_BENCHMARK_CONTRACTS,
  officialBenchmarkReadiness,
  officialBenchmarkSummary,
} from "../src/eval/officialBenchmarkReadiness";

describe("official benchmark readiness", () => {
  it("tracks BankerToolBench and both SpreadsheetBench targets", () => {
    expect(OFFICIAL_BENCHMARK_CONTRACTS.map((item) => item.id)).toEqual([
      "bankertoolbench",
      "spreadsheetbench-v1",
      "spreadsheetbench-v2",
    ]);
  });

  it("requires BTB-specific multi-file, MCP, Docker, and weighted-rubric capabilities", () => {
    const btb = officialBenchmarkReadiness().find((item) => item.id === "bankertoolbench");

    expect(btb?.requiredCapabilities).toEqual(expect.arrayContaining([
      "pptx_docx_pdf_outputs",
      "mcp_financial_tools",
      "docker_sandbox",
      "rubric_weighted_scoring",
      "xlsx_import_export",
      "live_browser_fresh_room_e2e",
    ]));
    expect(btb?.ready).toBe(false);
  });

  it("records BankerToolBench ingest and gold-isolated staging progress without promoting readiness", () => {
    const btb = officialBenchmarkReadiness().find((item) => item.id === "bankertoolbench");
    const ingest = btb?.capabilities.find((capability) => capability.capability === "official_task_ingest");
    const gold = btb?.capabilities.find((capability) => capability.capability === "official_gold_isolation");
    const rubric = btb?.capabilities.find((capability) => capability.capability === "rubric_weighted_scoring");
    const runner = btb?.capabilities.find((capability) => capability.capability === "official_runner_adapter");
    const xlsx = btb?.capabilities.find((capability) => capability.capability === "xlsx_import_export");
    const documentOutputs = btb?.capabilities.find((capability) => capability.capability === "pptx_docx_pdf_outputs");
    const docker = btb?.capabilities.find((capability) => capability.capability === "docker_sandbox");
    const liveBrowser = btb?.capabilities.find((capability) => capability.capability === "live_browser_fresh_room_e2e");

    expect(ingest).toMatchObject({
      state: "implemented",
      evidence: "src/eval/bankerToolBenchAdapter.ts",
    });
    expect(gold).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchStage.ts",
    });
    expect(gold?.blocker).toContain("contamination checks");
    expect(gold?.blocker).toContain("expected deliverable package metadata");
    expect(rubric).toMatchObject({
      state: "partial",
      evidence: "docs/eval/bankertoolbench-official-contract.json",
    });
    const mcp = btb?.capabilities.find((capability) => capability.capability === "mcp_financial_tools");
    expect(mcp).toMatchObject({
      state: "external",
      evidence: "docs/eval/bankertoolbench-official-contract.json",
    });
    expect(mcp?.blocker).toContain("SEC filings");
    expect(mcp?.blocker).toContain("not adapted");
    expect(runner).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
    });
    expect(runner?.blocker).toContain("agent workspaces");
    expect(runner?.blocker).toContain("semantic workbook scoring");
    expect(runner?.blocker).toContain("positive apply-agent-output smoke");
    expect(runner?.blocker).toContain("Gandalf");
    expect(xlsx).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
    });
    expect(xlsx?.blocker).toContain("semantically matching workbooks");
    expect(xlsx?.blocker).toContain("Gandalf");
    expect(documentOutputs).toMatchObject({
      state: "partial",
      evidence: "src/eval/bankerToolBenchRunner.ts",
    });
    expect(documentOutputs?.blocker).toContain("multi-file candidate packages");
    expect(documentOutputs?.blocker).toContain("official verifier");
    expect(docker).toMatchObject({
      state: "external",
      evidence: "docs/eval/docker-sandbox-probe.json",
    });
    expect(docker?.blocker).toContain("Docker/Harbor execution");
    expect(docker?.blocker).toContain("container_isolation_proven");
    expect(liveBrowser).toMatchObject({
      state: "partial",
      evidence: "docs/eval/official-benchmark-ui-coverage.json",
    });
    expect(liveBrowser?.blocker).toContain("fresh live room");
    expect(liveBrowser?.blocker).toContain("downloads every required deliverable type");
    expect(rubric?.blocker).toContain("Gandalf score-import schema");
    expect(btb?.ready).toBe(false);
    expect(btb?.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("docker_sandbox"),
      expect.stringContaining("official_runner_adapter"),
      expect.stringContaining("mcp_financial_tools"),
    ]));
  });

  it("requires SpreadsheetBench spreadsheet-native grading beyond internal finance evals", () => {
    const spreadsheet = officialBenchmarkReadiness().filter((item) => item.id.startsWith("spreadsheetbench"));

    for (const item of spreadsheet) {
      expect(item.requiredCapabilities).toEqual(expect.arrayContaining([
        "official_task_ingest",
        "official_gold_isolation",
        "official_runner_adapter",
        "xlsx_import_export",
        "live_browser_fresh_room_e2e",
        "formula_recompute",
        "format_diff",
      ]));
    }
    expect(spreadsheet.find((item) => item.id === "spreadsheetbench-v2")?.requiredCapabilities).toContain("chart_visual_grade");
  });

  it("records SpreadsheetBench local-bundle ingest progress without promoting benchmark readiness", () => {
    const spreadsheet = officialBenchmarkReadiness().filter((item) => item.id.startsWith("spreadsheetbench"));

    for (const item of spreadsheet) {
      const ingest = item.capabilities.find((capability) => capability.capability === "official_task_ingest");
      const gold = item.capabilities.find((capability) => capability.capability === "official_gold_isolation");
      const runner = item.capabilities.find((capability) => capability.capability === "official_runner_adapter");
      const format = item.capabilities.find((capability) => capability.capability === "format_diff");
      const xlsx = item.capabilities.find((capability) => capability.capability === "xlsx_import_export");
      const formula = item.capabilities.find((capability) => capability.capability === "formula_recompute");
      const chart = item.capabilities.find((capability) => capability.capability === "chart_visual_grade");

      expect(ingest).toMatchObject({
        state: "implemented",
        evidence: "src/eval/spreadsheetBenchAdapter.ts",
      });
      if (item.id === "spreadsheetbench-v1") {
        expect(gold).toMatchObject({
          state: "partial",
          evidence: "docs/eval/spreadsheetbench-v1-912-stage.json",
        });
        expect(gold?.blocker).toContain("912/912 tasks staged");
        expect(gold?.blocker).toContain("2,729 agent input workbooks");
        expect(gold?.blocker).toContain("zero agent/evaluator path overlap");
        expect(runner).toMatchObject({
          state: "partial",
          evidence: "docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json",
        });
        expect(runner?.blocker).toContain("912/912 attempted tasks");
        expect(runner?.blocker).toContain("95/912 pass");
        expect(runner?.blocker).toContain("average overall 0.335005");
        expect(runner?.blocker).toContain("official 912 input/evaluator scorer path");
        expect(runner?.blocker).toContain("full-bundle model or route-execution runs");
      } else {
        expect(gold).toMatchObject({
          state: "partial",
          evidence: "src/eval/spreadsheetBenchStage.ts",
        });
        expect(gold?.blocker).toContain("public-example");
        expect(runner).toMatchObject({
          state: "partial",
          evidence: "src/eval/spreadsheetBenchRunner.ts",
        });
        expect(runner?.blocker).toContain("model-edit-plan");
        expect(runner?.blocker).toContain("N=5");
        expect(runner?.blocker).toContain("retry-policy");
        expect(runner?.blocker).toContain("raw model output");
        expect(runner?.blocker).toContain("SUM");
        expect(runner?.blocker).toContain("workspace");
        expect(runner?.blocker).toContain("Route-selection reports");
        expect(runner?.blocker).toContain("deterministic table transforms");
        expect(runner?.blocker).toMatch(/route[- ]execution/);
        expect(runner?.blocker).not.toContain("route selection remain incomplete");
        expect(gold?.blocker).toContain("Node permission subprocess");
        expect(runner?.blocker).not.toContain("benchmark retry policy");
      }
      expect(xlsx).toMatchObject({
        state: "implemented",
        evidence: "src/eval/spreadsheetBenchRunner.ts",
      });
      expect(formula).toMatchObject({
        state: "partial",
        evidence: "src/eval/spreadsheetBenchRunner.ts",
      });
      expect(formula?.blocker).toContain("SUM/AVERAGE/MIN/MAX/COUNT");
      expect(formula?.blocker).toContain("SUMIFS/COUNTIFS/AVERAGEIFS");
      expect(formula?.blocker).toContain("MATCH/INDEX/VLOOKUP/XLOOKUP");
      expect(formula?.blocker).toContain("SUMPRODUCT");
      expect(formula?.blocker).toContain("LEFT/RIGHT/MID/LEN");
      expect(formula?.blocker).toContain("TEXT/DATE");
      expect(formula?.blocker).toContain("approximate lookup");
      expect(formula?.blocker).toContain("full Excel-compatible");
      expect(format).toMatchObject({
        state: "partial",
        evidence: "src/eval/spreadsheetBenchScorer.ts",
      });
      expect(format?.blocker).toContain("column widths");
      expect(format?.blocker).toContain("merge ranges");
      if (item.id === "spreadsheetbench-v2") {
        expect(chart).toMatchObject({
          state: "implemented",
          evidence: "docs/eval/spreadsheetbench-chart-visual-probe.json",
        });
        expect(chart?.blocker).toBeUndefined();
      }
      expect(item.ready).toBe(false);
      expect(item.blockers).toEqual(expect.arrayContaining([
        expect.stringContaining("official_runner_adapter"),
        expect.stringContaining("format_diff"),
      ]));
    }
  });

  it("summarizes blockers so HALO can target real benchmark gaps", () => {
    const summary = officialBenchmarkSummary();

    expect(summary.total).toBe(3);
    expect(summary.blocked).toBeGreaterThan(0);
    expect(summary.missingCapabilities).toEqual(expect.arrayContaining([
      "official_runner_adapter",
      "format_diff",
      "live_browser_fresh_room_e2e",
    ]));
    expect(summary.missingCapabilities).not.toContain("official_task_ingest");
  });
});
