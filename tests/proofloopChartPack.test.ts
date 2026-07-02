import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { solveProofloopBlocker } from "../src/eval/proofloopBlockerSolver";
import {
  buildProofloopChartPackBundle,
  validateProofloopChartPackArtifacts,
  writeProofloopChartPack,
} from "../src/eval/proofloopChartPack";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop chart pack", () => {
  it("builds schema-backed Vega-Lite chart specs from proof data only", () => {
    const root = tempRoot();
    solveProofloopBlocker({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      task: {
        id: "finauditing-official-score",
        title: "FinAuditing official score",
        blockers: ["No official-format prediction JSONL exists and OPENAI_API_KEY is missing."],
        evidence: [".proofloop/setup/finauditing-local-setup.json"],
        resumeCommand: "emit official-format predictions",
      },
    });
    writeLatestRun(root);

    const bundle = buildProofloopChartPackBundle({
      root,
      target: "latest",
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(bundle.pack).toMatchObject({
      schema: "proofloop-chart-pack-v1",
      runId: "proximitty-run-1",
      suite: "proximitty-underwriting-pr0",
    });
    expect(bundle.pack.summary.chartCount).toBe(8);
    expect(bundle.pack.charts.map((chart) => chart.id)).toEqual(expect.arrayContaining([
      "model-performance",
      "cost-per-pass",
      "failure-categories",
      "harness-version-trend",
      "evidence-score",
      "latency-cost-frontier",
      "accounting-workpaper",
    ]));
    expect(bundle.pack.charts.find((chart) => chart.id === "accounting-workpaper")?.unavailable?.reason).toContain("accounting workpaper");
    expect(bundle.pack.charts.find((chart) => chart.id === "model-performance")?.sourceBindings[0]).toMatchObject({
      sourceFile: "model-comparison.json",
      sourceField: "policies[].score",
    });

    expect(bundle.specs["model-performance"].$schema).toContain("vega-lite");
    expect(bundle.specs["model-performance"].usermeta.proofloop.sourceBindings.length).toBeGreaterThan(0);
    expect(bundle.data["model-performance"].map((point) => point.model)).toEqual(expect.arrayContaining([
      "strong-single-model",
      "cheap-or-fusion-policy",
      "deepseek/deepseek-v4-pro",
    ]));
    expect(bundle.data["failure-categories"].map((point) => point.failureCategory)).toEqual(expect.arrayContaining([
      "context_pack",
      "missing_judge_credentials",
    ]));
    expect(bundle.data["evidence-score"].some((point) => point.sourceField === "reward.evidenceGrounding")).toBe(true);
    for (const rows of Object.values(bundle.data)) {
      for (const row of rows) {
        expect(row.sourceFile).toEqual(expect.any(String));
        expect(row.sourceField).toEqual(expect.any(String));
      }
    }
  });

  it("writes JSON, Vega-Lite, data, HTML, Markdown, SVG, and run-local chart artifacts", () => {
    const root = tempRoot();
    solveProofloopBlocker({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      task: {
        id: "workstreambench-official-score",
        title: "WorkstreamBench official score",
        blockers: ["No public official bundle/scorer/rubric URL was found."],
        evidence: [".proofloop/setup/workstreambench-local-setup.json"],
      },
    });
    writeLatestRun(root);

    const result = writeProofloopChartPack({
      root,
      target: "latest",
      outDir: "docs/eval/proofloop-charts",
      generatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(result.validation).toMatchObject({ ok: true });
    expect(existsSync(join(root, result.paths.json))).toBe(true);
    expect(existsSync(join(root, "docs", "eval", "proofloop-charts", "proofloop-chart-pack.json"))).toBe(true);
    expect(existsSync(join(root, result.paths.markdown))).toBe(true);
    expect(existsSync(join(root, result.paths.html))).toBe(true);
    expect(readFileSync(join(root, result.paths.html), "utf8")).toContain("vegaEmbed");
    for (const path of Object.values(result.paths.specs)) {
      expect(existsSync(join(root, path))).toBe(true);
      expect(JSON.parse(readFileSync(join(root, path), "utf8")).usermeta.proofloop.sourceBindings.length).toBeGreaterThan(0);
    }
    for (const path of Object.values(result.paths.data)) {
      expect(existsSync(join(root, path))).toBe(true);
    }
    for (const path of Object.values(result.paths.svgs)) {
      expect(existsSync(join(root, path))).toBe(true);
      expect(readFileSync(join(root, path), "utf8")).toContain("<svg");
    }
    expect(result.paths.runArtifacts.map((artifact) => artifact.json)).toContain(".proofloop/runs/latest/charts/chart-pack.json");
    expect(existsSync(join(root, ".proofloop", "runs", "latest", "charts", "model-performance.vl.json"))).toBe(true);
    expect(validateProofloopChartPackArtifacts({ root, outDir: "docs/eval/proofloop-charts" })).toMatchObject({ ok: true });
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-chart-pack-"));
  roots.push(root);
  mkdirSync(join(root, "docs", "eval"), { recursive: true });
  writeFileSync(
    join(root, "docs", "eval", "openrouter-top-paid-tools-snapshot.json"),
    `${JSON.stringify({
      models: [
        { id: "deepseek/deepseek-v4-pro", supportsTools: true, supportsStructuredOutputs: true },
        { id: "z-ai/glm-5.2", supportsTools: true, supportsStructuredOutputs: true },
      ],
    })}\n`,
  );
  return root;
}

function writeLatestRun(root: string): void {
  const runDir = join(root, ".proofloop", "runs", "latest");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(
    join(runDir, "node-eval.json"),
    `${JSON.stringify({
      schema: 1,
      suite: "proximitty-underwriting-pr0",
      runId: "proximitty-run-1",
      verifier: { hardPass: true, score: 94, failReasons: [] },
      judge: { failureCategories: ["context_pack"] },
      reward: {
        taskCompletion: 1,
        visualQuality: 0.92,
        evidenceGrounding: 0.96,
        total: 0.96,
        failureCategories: ["context_pack"],
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(runDir, "model-comparison.json"),
    `${JSON.stringify({
      schema: 1,
      suite: "proximitty-underwriting-pr0",
      runId: "proximitty-run-1",
      policies: [
        {
          policy: "strong-single-model",
          provider: "configured-primary-provider",
          passed: true,
          score: 0.94,
          costUsd: 0.041,
          durationMs: 146000,
          failureLayer: null,
          evidenceQuality: 0.96,
          uiProofQuality: 0.92,
        },
        {
          policy: "cheap-or-fusion-policy",
          provider: "configured-fusion-provider",
          passed: false,
          score: 0.72,
          costUsd: 0.008,
          durationMs: 82000,
          failureLayer: "context_pack",
          evidenceQuality: 0.68,
          uiProofQuality: 0.91,
        },
      ],
    }, null, 2)}\n`,
  );
  writeFileSync(
    join(runDir, "cost-ledger.json"),
    `${JSON.stringify({
      schema: 1,
      suite: "proximitty-underwriting-pr0",
      runId: "proximitty-run-1",
      policies: [
        { policy: "strong-single-model", provider: "configured-primary-provider", costUsd: 0.041, durationMs: 146000, passed: true, score: 0.94 },
      ],
    }, null, 2)}\n`,
  );
  writeFileSync(join(runDir, "node-trace-v2.json"), `${JSON.stringify({ schema: 1, runId: "proximitty-run-1" })}\n`);
}
