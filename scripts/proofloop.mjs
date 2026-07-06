#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "proximitty") {
  const runResult = run("npx", ["tsx", "scripts/proofloop-runner.ts", "--config=proofloop/suites/proximitty-underwriting-pr0.json"]);
  if (runResult !== 0) process.exit(runResult);

  const runDir = latestRunDir();
  const postSteps = [
    ["node", ["proofloop/adapters/model-delta.mjs", `--run=${runDir.name}`]],
    ["node", ["proofloop/adapters/node-eval.mjs", `--run=${runDir.name}`]],
    ["node", ["proofloop/adapters/node-trace-v2-export.mjs", `--run=${runDir.name}`]],
    ["node", ["proofloop/adapters/nodemem-write.mjs", `--run=${runDir.name}`]],
    ["node", ["--no-warnings", "scripts/proofloop-memory.mjs", "compact", runDir.name]],
    ["node", ["--no-warnings", "scripts/proofloop-memory.mjs", "index"]],
    ["node", ["proofloop/adapters/generate-clips.mjs", `--run=${runDir.name}`]],
  ];
  for (const [cmd, stepArgs] of postSteps) {
    const status = run(cmd, stepArgs);
    if (status !== 0) process.exit(status);
  }
  syncLatest(runDir.path);
  const verifyStatus = run("node", ["scripts/proofloop.mjs", "verify-proximitty", runDir.name]);
  process.exit(verifyStatus);
}

if (args[0] === "verify-proximitty") {
  process.exit(verifyProximitty(args[1]));
}

if (args[0] === "underwriting-live") {
  const status = run("node", ["scripts/underwriting-hmda-live-proof.mjs"]);
  if (status !== 0) process.exit(status);
  process.exit(verifyUnderwritingLive(args[1]));
}

if (args[0] === "autonomous-credit") {
  const liveStatus = run("node", ["scripts/proofloop.mjs", "underwriting-live"]);
  if (liveStatus !== 0) process.exit(liveStatus);
  const dataStatus = run("node", ["scripts/proofloop.mjs", "credit-data"]);
  if (dataStatus !== 0) process.exit(dataStatus);
  const status = run("npx", ["tsx", "scripts/autonomous-credit-approval-proof.ts"]);
  process.exit(status);
}

if (args[0] === "credit-data") {
  const status = run("npx", ["tsx", "scripts/credit-actuarial-data-sources-proof.ts"]);
  process.exit(status);
}

if (args[0] === "verify-underwriting-live") {
  process.exit(verifyUnderwritingLive(args[1]));
}

if (args[0] === "memory") {
  const status = run("node", ["--no-warnings", "scripts/proofloop-memory.mjs", ...args.slice(1)]);
  process.exit(status);
}

if (args[0] === "--help" || args[0] === "-h") {
  const help = run("npx", ["tsx", "scripts/proofloop-cli.ts"]);
  process.exit(help);
}

const forwarded = run("npx", ["tsx", "scripts/proofloop-cli.ts", ...args]);
process.exit(forwarded);

function run(cmd, stepArgs) {
  const result = spawnSync(cmd, stepArgs, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  return result.status ?? 1;
}

function latestRunDir() {
  const runsRoot = join(root, ".proofloop", "runs");
  const dirs = readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "latest")
    .map((entry) => {
      const path = join(runsRoot, entry.name);
      return { name: entry.name, path, mtime: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  if (!dirs.length) throw new Error("No proofloop run directory found.");
  return dirs[0];
}

function syncLatest(runPath) {
  const latest = join(root, ".proofloop", "runs", "latest");
  rmSync(latest, { recursive: true, force: true });
  cpSync(runPath, latest, { recursive: true });
}

function verifyProximitty(runId) {
  const runName = runId && runId !== "latest" ? runId : latestRunDir().name;
  const runDir = join(root, ".proofloop", "runs", runName);
  const required = [
    "scorecard.md",
    "live-user-contract.json",
    "node-trace-v2.json",
    "node-eval.json",
    "rl-trace.json",
    "model-comparison.json",
    "model-delta.md",
    "cost-ledger.json",
    "verifier-receipt.json",
    "cockpit-events.jsonl",
    "trace-storybook.html",
    "artifacts/proximitty-underwriting-packet.md",
    "clips/01-intake.mp4",
    "clips/02-risk-research.mp4",
    "clips/03-underwriting-packet.mp4",
    "clips/04-model-comparison.mp4",
    "clips/05-lagging-layer.mp4",
    "clips/final-proximitty-demo.mp4",
    "videos/final-proximitty-demo.mp4",
  ];
  const missing = required.filter((file) => !existsSync(join(runDir, file)));
  if (missing.length) {
    console.error(`proofloop: Proximitty acceptance missing ${missing.length} file(s):`);
    for (const file of missing) console.error(`  - ${file}`);
    return 1;
  }
  if (!existsSync(join(root, ".proofloop", "memory.jsonl"))) {
    console.error("proofloop: .proofloop/memory.jsonl was not updated");
    return 1;
  }
  if (!existsSync(join(root, ".proofloop", "memory", "index.db"))) {
    console.error("proofloop: .proofloop/memory/index.db was not updated");
    return 1;
  }
  if (!existsSync(join(root, ".proofloop", "memory", "compacted", "episodes.jsonl"))) {
    console.error("proofloop: compacted Proof Loop memory was not updated");
    return 1;
  }
  console.log(`proofloop: Proximitty acceptance PASS (${runName})`);
  return 0;
}

function verifyUnderwritingLive(receiptPath = "docs/eval/underwriting-hmda-live-proof.json") {
  const fullPath = join(root, receiptPath);
  if (!existsSync(fullPath)) {
    console.error(`proofloop: HMDA live underwriting receipt missing: ${fullPath}`);
    return 1;
  }
  const receipt = JSON.parse(readFileSync(fullPath, "utf8"));
  const failures = [];
  const harness = receipt.harness ?? {};
  const scoring = receipt.scoring ?? {};
  const backend = receipt.backend ?? {};
  const liveSignals = receipt.liveSignals ?? {};
  const uploadedFiles = Array.isArray(receipt.uploadedFiles) ? receipt.uploadedFiles : [];
  const outputColumns = Array.isArray(harness.outputColumns) ? harness.outputColumns : [];
  const requiredColumns = ["application_id", "predicted_action_taken", "predicted_label", "confidence", "brief_reason"];

  if (receipt.passed !== true) failures.push("receipt.passed must be true");
  if (receipt.memoryMode !== false) failures.push("memoryMode must be false");
  if (harness.version !== "hmda-underwriting-live-proof-v1.0.0") failures.push("harness.version must be hmda-underwriting-live-proof-v1.0.0");
  if (harness.proofContractVersion !== "prod-live-hmda-underwriting-v1") failures.push("proof contract must be prod-live-hmda-underwriting-v1");
  if (!requiredColumns.every((column) => outputColumns.includes(column))) failures.push("harness output columns must match final HMDA contract");
  if (uploadedFiles.some((file) => /answer[_-]?key|local/i.test(String(file)))) failures.push("uploadedFiles must not include the local answer key");
  if (liveSignals.outputRowsComplete !== true) failures.push("visible Sheet 1 output must be complete");
  if (Array.isArray(liveSignals.pageErrors) && liveSignals.pageErrors.length > 0) failures.push("pageErrors must be empty");
  if (backend.ok !== true) failures.push("backend receipt query must succeed");
  if (backend.job?.status !== "completed") failures.push("backend job status must be completed");
  if (!Array.isArray(backend.frames) || backend.frames.some((frame) => frame.status !== "completed")) failures.push("all backend reasoning frames must be completed");
  if (!Array.isArray(backend.operations) || !backend.operations.some((op) => op.name === "agentJobRunner.hmdaUnderwritingBenchmark completed" && op.status === "completed")) {
    failures.push("backend operations must include deterministic underwriting completion checkpoint");
  }
  if (scoring.matchedRows !== scoring.n) failures.push("scoring matchedRows must equal n");
  if (scoring.correct !== scoring.n) failures.push("scoring correct must equal n for the pinned live HMDA packet");
  if (scoring.incorrect !== 0) failures.push("scoring incorrect must be zero");
  if (scoring.unparseable !== 0) failures.push("scoring unparseable must be zero");
  if (scoring.accuracy !== 1) failures.push("scoring accuracy must be 1 for the pinned live HMDA packet");

  if (failures.length) {
    console.error("proofloop: HMDA live underwriting proof FAILED:");
    for (const failure of failures) console.error(`  - ${failure}`);
    console.error(`proofloop: receipt at ${fullPath}`);
    return 1;
  }
  console.log(`proofloop: HMDA live underwriting acceptance PASS (${receipt.roomUrl})`);
  return 0;
}
