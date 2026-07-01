/**
 * RL Trace Export — converts proof-loop run results into NodeRL-format traces.
 *
 * Usage:
 *   npx tsx proofloop/adapters/export-rl-trace.ts --suite=accounting
 *   npx tsx proofloop/adapters/export-rl-trace.ts --suite=notion
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const suite = process.argv.find((a) => a.startsWith("--suite="))?.split("=")[1] ?? "accounting";
const outputDir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");

interface RLStep {
  step: number;
  name: string;
  reward: number;
  durationMs: number;
}

interface RLTrace {
  runId: string;
  suite: string;
  timestamp: string;
  passed: boolean;
  score: number;
  steps: RLStep[];
  totalReward: number;
  maxReward: number;
}

function exportTrace(): void {
  console.log(`export-rl-trace: suite=${suite}`);

  // Try to load the run result from the latest run
  const runResultPath = join(outputDir, "run-result.json");
  const tracePath = join(outputDir, "trace.jsonl");
  const rlTracePath = join(outputDir, "rl-trace.json");

  // If rl-trace.json already exists (from runner), just validate it
  if (existsSync(rlTracePath)) {
    const existing = JSON.parse(readFileSync(rlTracePath, "utf-8"));
    console.log(`export-rl-trace: ✅ rl-trace.json already exists (score=${existing.score}, passed=${existing.passed})`);
    process.exit(0);
  }

  // Otherwise, build from run-result.json or trace.jsonl
  let steps: RLStep[] = [];
  let passed = false;
  let score = 0;
  let runId = "unknown";

  if (existsSync(runResultPath)) {
    const run = JSON.parse(readFileSync(runResultPath, "utf-8"));
    runId = run.runId;
    passed = run.passed;
    score = run.score;
    steps = run.steps.map((s: { name: string; status: string; durationMs: number }, i: number) => ({
      step: i + 1,
      name: s.name,
      reward: s.status === "pass" ? 1 : 0,
      durationMs: s.durationMs,
    }));
  } else if (existsSync(tracePath)) {
    const lines = readFileSync(tracePath, "utf-8").trim().split("\n");
    steps = lines.map((line, i) => {
      const entry = JSON.parse(line);
      return {
        step: i + 1,
        name: entry.name,
        reward: entry.status === "pass" ? 1 : 0,
        durationMs: entry.durationMs,
      };
    });
  } else {
    console.error("export-rl-trace: no run-result.json or trace.jsonl found");
    process.exit(1);
  }

  const trace: RLTrace = {
    runId,
    suite,
    timestamp: new Date().toISOString(),
    passed,
    score,
    steps,
    totalReward: steps.filter((s) => s.reward === 1).length,
    maxReward: steps.length,
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(rlTracePath, JSON.stringify(trace, null, 2), "utf-8");

  console.log(`export-rl-trace: ✅ written to ${rlTracePath}`);
  console.log(`export-rl-trace: totalReward=${trace.totalReward}/${trace.maxReward} score=${score} passed=${passed}`);

  process.exit(0);
}

exportTrace();
