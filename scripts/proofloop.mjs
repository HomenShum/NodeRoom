#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
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
