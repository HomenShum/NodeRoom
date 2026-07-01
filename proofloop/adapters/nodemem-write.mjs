import { join } from "node:path";
import {
  MEMORY_PATH,
  appendJsonl,
  parseArgs,
  readJson,
  resolveRunDir,
  runIdFromDir,
  SUITE,
} from "./proximitty-utils.mjs";

const args = parseArgs();
const runDir = resolveRunDir(args.run);
const runId = runIdFromDir(runDir);
const nodeEval = readJson(join(runDir, "node-eval.json"), {});
const comparison = readJson(join(runDir, "model-comparison.json"), {});
const verifier = readJson(join(runDir, "verifier-receipt.json"), {});
const weakPolicy = (comparison.policies ?? []).find((policy) => !policy.passed);
const priorMemory = readJson(MEMORY_PATH, null);

appendJsonl(MEMORY_PATH, {
  schema: 1,
  kind: verifier.passed ? "success_pattern" : "failure_pattern",
  taskKind: "underwriting_evaluation_demo",
  app: "NodeRoom",
  suite: SUITE,
  runId,
  modelPolicy: comparison.winner ?? "strong-single-model",
  harnessVersion: "proximitty-underwriting-pr0",
  passed: verifier.passed === true,
  score: nodeEval.reward?.total ?? verifier.score ?? null,
  cost: comparison.costSummary ?? null,
  failurePattern: weakPolicy?.failureLayer ?? null,
  scaffoldRecommendation: weakPolicy?.recommendedScaffoldChange ?? "No scaffold required.",
  priorFixes: priorMemory ? "Existing memory file present; inspect adjacent Proximitty entries before rerun." : "No prior memory file parsed.",
  proofRefs: [
    "scorecard.md",
    "live-user-contract.json",
    "node-trace-v2.json",
    "node-eval.json",
    "model-comparison.json",
    "verifier-receipt.json",
    "clips/final-proximitty-demo.mp4",
  ],
  traceRefs: ["trace.jsonl", "rl-trace.json"],
  writtenAt: new Date().toISOString(),
});

console.log(`nodemem-write: appended rich Proximitty entry to ${MEMORY_PATH}`);
