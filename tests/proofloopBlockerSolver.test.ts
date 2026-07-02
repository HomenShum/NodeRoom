import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyBlockers,
  compareProofloopModelsForSuite,
  promoteProofloopHarnessForSuite,
  solveProofloopBlocker,
  solveProofloopBlockers,
  type ProofloopBlockerTaskLike,
} from "../src/eval/proofloopBlockerSolver";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop blocker solver", () => {
  it("classifies blockers and writes the required lane artifacts", () => {
    const root = tempRoot();
    const receipt = solveProofloopBlocker({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      task: spreadsheetV1Task(),
    });

    expect(receipt.suite).toBe("spreadsheetbench-v1");
    expect(receipt.status).toBe("needs_scaffold_or_run");
    expect(receipt.externalBlockClaimAllowed).toBe(false);
    expect(receipt.classes).toContain("missing_model_run");
    expect(receipt.stopCondition.researchAttempted).toBe(true);
    expect(receipt.stopCondition.scaffoldAttempted).toBe(true);
    expect(receipt.stopCondition.allNonExternalPartsCompleted).toBe(false);
    for (const name of [
      "blocker-analysis.json",
      "upstream-research.md",
      "scaffold-plan.md",
      "harness-version.json",
      "model-matrix.json",
      "cost-ledger.json",
      "official-output-manifest.json",
      "official-score-receipt.json",
      "proxy-score-receipt.json",
      "memory-write.json",
    ]) {
      expect(existsSync(join(root, ".proofloop", "lanes", "spreadsheetbench-v1", name))).toBe(true);
    }

    const modelMatrix = JSON.parse(readFileSync(join(root, ".proofloop", "lanes", "spreadsheetbench-v1", "model-matrix.json"), "utf8"));
    expect(modelMatrix.models.map((model: { id: string }) => model.id)).toContain("deepseek/deepseek-v4-pro");
  });

  it("marks WorkstreamBench as external only after proxy-only scaffold evidence exists", () => {
    const root = tempRoot();
    const receipt = solveProofloopBlocker({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      task: {
        id: "workstreambench-official-score",
        title: "WorkstreamBench official score",
        blockers: [
          "workstreambench: no public official task bundle lock is staged because no public official bundle/scorer/rubric URL was found.",
        ],
        evidence: [".proofloop/setup/workstreambench-local-setup.json"],
        resumeCommand: "obtain the official WorkstreamBench task bundle and scorer/rubric from upstream",
      },
    });

    expect(receipt.status).toBe("blocked_external");
    expect(receipt.externalBlockClaimAllowed).toBe(true);
    expect(receipt.remainingExternalClasses).toEqual(expect.arrayContaining(["no_public_upstream_release"]));
    const proxy = JSON.parse(readFileSync(join(root, ".proofloop", "lanes", "workstreambench", "proxy-score-receipt.json"), "utf8"));
    expect(proxy.proxyOnly).toBe(true);
    expect(proxy.officialScoreClaimable).toBe(false);
  });

  it("solves multiple blockers and exposes compare/promote helpers", () => {
    const root = tempRoot();
    const receipts = solveProofloopBlockers({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      tasks: [spreadsheetV1Task()],
    });
    expect(receipts).toHaveLength(1);

    const matrixPath = compareProofloopModelsForSuite({ root, suite: "finch", generatedAt: "2026-07-02T00:00:00.000Z" });
    const harnessPath = promoteProofloopHarnessForSuite({ root, suite: "finch", generatedAt: "2026-07-02T00:00:00.000Z" });
    expect(existsSync(matrixPath)).toBe(true);
    expect(existsSync(harnessPath)).toBe(true);
    expect(JSON.parse(readFileSync(harnessPath, "utf8")).harnessVersion).toContain("finch-harness-");
    const analysis = JSON.parse(readFileSync(join(root, ".proofloop", "lanes", "finch", "blocker-analysis.json"), "utf8"));
    expect(analysis.remainingLocalClasses).toEqual(expect.arrayContaining([
      "missing_official_scorer",
      "missing_output_exporter",
    ]));
    expect(analysis.remainingExternalClasses).toContain("missing_judge_credentials");
  });

  it("classifies output exporter and judge credential blockers separately", () => {
    const classes = classifyBlockers({
      id: "finauditing-official-score",
      title: "FinAuditing official score",
      blockers: ["No official-format FinSM/FinRE/FinMR prediction JSONL exists and OPENAI_API_KEY is missing."],
      evidence: [],
    });
    expect(classes).toEqual(expect.arrayContaining(["missing_output_exporter", "missing_judge_credentials"]));
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-solver-"));
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

function spreadsheetV1Task(): ProofloopBlockerTaskLike {
  return {
    id: "spreadsheetbench-v1-full-official-score",
    title: "SpreadsheetBench V1 full 912-task official score",
    blockers: ["All 912 tasks need model-run evidence before strict official-score promotion."],
    evidence: ["docs/eval/spreadsheetbench-v1-912-stage.json"],
    resumeCommand: "run all 912 SpreadsheetBench V1 tasks through the model runner",
  };
}
