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
import { OFFICIAL_SCORE_PREFLIGHT_COMMAND } from "../src/eval/proofloopOfficialScorePreflight";

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
    expect(modelMatrix.models[0]).toMatchObject({
      id: "openrouter/free-auto",
      provider: "openrouter",
      costUsd: 0,
      costAccounting: { status: "free" },
    });
    expect(modelMatrix.models.map((model: { id: string }) => model.id)).not.toContain("deepseek/deepseek-v4-pro");
    expect(receipt.nextCommands[0]).toBe(OFFICIAL_SCORE_PREFLIGHT_COMMAND);
    expect(receipt.nextCommands.some((command) => command.includes("--model openrouter/free-auto"))).toBe(true);

    const costLedger = JSON.parse(readFileSync(join(root, ".proofloop", "lanes", "spreadsheetbench-v1", "cost-ledger.json"), "utf8"));
    expect(costLedger.policy).toBe("free_first_until_official_scorer_contract");
    expect(costLedger.models.every((model: { costUsd: number }) => model.costUsd === 0)).toBe(true);
  });

  it("keeps WorkstreamBench local-scaffold blocked now that MBABench artifacts are locked", () => {
    const root = tempRoot();
    const receipt = solveProofloopBlocker({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      task: {
        id: "workstreambench-official-score",
        title: "WorkstreamBench official score",
        blockers: [
          "workstreambench/MBABench: public ModelOff task bundle and scorer are locked, but no NodeRoom official-format MBABench case folders or ai_attempt.xlsx files exist.",
        ],
        evidence: [".proofloop/setup/workstreambench-local-setup.json"],
        resumeCommand: "generate MBABench official-format case folders",
      },
    });

    expect(receipt.status).toBe("needs_scaffold_or_run");
    expect(receipt.externalBlockClaimAllowed).toBe(false);
    expect(receipt.remainingLocalClasses).toEqual(expect.arrayContaining(["missing_output_exporter"]));
    const proxy = JSON.parse(readFileSync(join(root, ".proofloop", "lanes", "workstreambench", "proxy-score-receipt.json"), "utf8"));
    expect(proxy.proxyOnly).toBe(false);
    expect(proxy.officialScoreClaimable).toBe(false);
  });

  it("moves WorkstreamBench to external-blocked after local MBABench outputs are complete", () => {
    const root = tempRoot();
    mkdirSync(join(root, "docs", "eval", "proofloop-official-outputs"), { recursive: true });
    writeFileSync(
      join(root, "docs", "eval", "proofloop-official-outputs", "workstreambench.json"),
      `${JSON.stringify({
        schema: "proofloop-official-output-manifest-v1",
        adapterId: "workstreambench",
        status: "complete",
        officialTaskCount: 38,
        outputTaskCount: 38,
      })}\n`,
    );

    const receipt = solveProofloopBlocker({
      root,
      generatedAt: "2026-07-02T00:00:00.000Z",
      task: {
        id: "workstreambench-official-score",
        title: "WorkstreamBench official score",
        blockers: [
          "workstreambench/MBABench: public ModelOff task bundle and scorer are locked, but no NodeRoom official-format MBABench case folders or ai_attempt.xlsx files exist.",
          "MBABench official scorer receipt is missing.",
          "Provider judge credentials are missing.",
        ],
        evidence: [".proofloop/setup/workstreambench-local-setup.json"],
      },
    });

    expect(receipt.status).toBe("blocked_external");
    expect(receipt.externalBlockClaimAllowed).toBe(true);
    expect(receipt.remainingLocalClasses).not.toContain("missing_output_exporter");
    expect(receipt.remainingExternalClasses).toEqual(expect.arrayContaining([
      "missing_judge_credentials",
      "missing_official_scorer",
    ]));
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

  it("does not mistake product-quality text for a production UI failure", () => {
    const productQuality = classifyBlockers({
      id: "spreadsheetbench-v1-full-official-score",
      title: "SpreadsheetBench V1 full official score",
      blockers: ["Proxy judges can triage product quality, but 912 model outputs are missing."],
      evidence: [],
    });
    expect(productQuality).not.toContain("prod_ui_failure");

    const productionFailure = classifyBlockers({
      id: "live-room-product-proof",
      title: "Production browser proof",
      blockers: ["Production browser flow failed before the room loaded."],
      evidence: [],
    });
    expect(productionFailure).toContain("prod_ui_failure");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-solver-"));
  roots.push(root);
  mkdirSync(join(root, "docs", "eval"), { recursive: true });
  mkdirSync(join(root, "docs", "eval", "dev-audience-ready"), { recursive: true });
  writeFileSync(
    join(root, "docs", "eval", "dev-audience-ready", "free-first-router-cost-receipt.json"),
    `${JSON.stringify({
      selectedFreeAutoRoutes: [
        { id: "cohere/north-mini-code:free", name: "Cohere North Mini Code (free)", promptPrice: "0", completionPrice: "0" },
        { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA Nemotron 3 Ultra (free)", promptPrice: "0", completionPrice: "0" },
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
