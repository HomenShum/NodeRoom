import { join } from "node:path";
import { parseArgs, readJson, resolveRunDir, runIdFromDir, SUITE, writeJson } from "./proximitty-utils.mjs";

const args = parseArgs();
const runDir = resolveRunDir(args.run);
const runId = runIdFromDir(runDir);
const runResult = readJson(join(runDir, "run-result.json"), {});
const comparison = readJson(join(runDir, "model-comparison.json"), {});
const verifier = readJson(join(runDir, "verifier-receipt.json"), {});
const weakPolicy = (comparison.policies ?? []).find((policy) => !policy.passed);
const failureCategories = weakPolicy?.failureLayer ? [weakPolicy.failureLayer] : [];

const reward = {
  taskCompletion: verifier.passed ? 1 : 0,
  uiStateCorrectness: verifier.checks?.screenshotsCaptured >= 4 ? 1 : 0.5,
  visualQuality: verifier.checks?.screenshotsCaptured >= 4 ? 0.92 : 0.5,
  evidenceGrounding: verifier.checks?.noUnsupportedMaterialClaims ? 0.96 : 0.4,
  costEfficiency: comparison.costSummary?.totalCostUsd <= 0.08 ? 0.93 : 0.65,
  latencySmoothness: comparison.costSummary?.maxDurationMs <= 180000 ? 0.91 : 0.6,
  safety: verifier.checks?.noRealDecisionLanguage ? 1 : 0,
  total: 0,
  failureCategories,
};
const components = [
  reward.taskCompletion,
  reward.uiStateCorrectness,
  reward.visualQuality,
  reward.evidenceGrounding,
  reward.costEfficiency,
  reward.latencySmoothness,
  reward.safety,
];
reward.total = Math.round((components.reduce((sum, value) => sum + value, 0) / components.length) * 1000) / 1000;

const nodeEval = {
  schema: 1,
  suite: SUITE,
  runId,
  generatedAt: new Date().toISOString(),
  verifier: {
    hardPass: verifier.passed === true,
    score: Math.round((verifier.score ?? reward.total) * 100),
    minScore: runResult.minScore ?? 85,
    failReasons: verifier.passed ? [] : ["Proximitty verifier failed"],
  },
  judge: {
    diagnosticSummary: verifier.passed
      ? "Proximitty underwriting Proof Loop completed through browser UI with evidence, packet, policy comparison, and receipts."
      : "Proximitty underwriting Proof Loop did not satisfy the verifier.",
    evidencePaths: [
      "node-trace-v2.json",
      "live-user-contract.json",
      "model-comparison.json",
      "verifier-receipt.json",
      "artifacts/proximitty-underwriting-packet.md",
    ],
    failureCategories,
  },
  reward,
};

writeJson(join(runDir, "node-eval.json"), nodeEval);
console.log(`node-eval: reward=${reward.total}`);
