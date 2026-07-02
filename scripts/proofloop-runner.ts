/**
 * Proof-loop runner — the shared engine for all proof-loop suites.
 *
 * Stages:
 *   1. build (if configured)
 *   2. start app (if configured)
 *   3. seed data
 *   4. run scenarios (Playwright specs or scripted checks)
 *   5. run benchmark checks
 *   6. run UI contract audit
 *   7. run visual/design judge
 *   8. export trace
 *   9. generate clips (optional)
 *  10. write scorecard
 *  11. append memory
 *  12. exit pass/fail
 *
 * Usage:
 *   npx tsx scripts/proofloop-runner.ts --config=proofloop/accounting/proofloop.accounting.config.json
 *   npx tsx scripts/proofloop-runner.ts --config=proofloop/notion/proofloop.notion.config.json
 */

import { spawnSync, spawn, type SpawnSyncOptions, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { basename, join, dirname } from "node:path";
import http from "node:http";
import { writeProofLoopArtifacts } from "../src/eval/proofloopArtifacts";
import {
  assertProofloopModelTracked,
  proofloopHarnessVersionForSuite,
  proofloopModelRouteForRun,
  type ProofloopModelRoute,
} from "../src/eval/proofloopModelTracking";

// ─── Types ────────────────────────────────────────────────────────────────

export interface ProofLoopStepConfig {
  name: string;
  cmd: string;
  required: boolean;
  timeoutMs?: number;
  /** If true, failure does not fail the run (still recorded) */
  softFail?: boolean;
}

export interface ProofLoopConfig {
  suite: string;
  minScore: number;
  steps: ProofLoopStepConfig[];
  /** Directory for run outputs */
  outputDir?: string;
  /** Memory file path */
  memoryFile?: string;
}

export interface ProofLoopStepResult {
  name: string;
  status: "pass" | "fail" | "skip" | "timeout";
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  required: boolean;
  softFail?: boolean;
}

export interface ProofLoopRunResult {
  schema: 1;
  suite: string;
  runId: string;
  generatedAt: string;
  configPath: string;
  minScore: number;
  steps: ProofLoopStepResult[];
  passed: boolean;
  score: number;
  failReasons: string[];
  outputDir: string;
  model: ProofloopModelRoute;
  harnessVersion: string;
}

// ─── Utils ────────────────────────────────────────────────────────────────

function optionValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg ? arg.split("=")[1] : undefined;
}

function timestampId(d: Date): string {
  return d.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function runStep(step: ProofLoopStepConfig, cwd: string, env?: NodeJS.ProcessEnv): ProofLoopStepResult {
  const start = Date.now();
  const opts: SpawnSyncOptions = {
    cwd,
    encoding: "utf-8",
    timeout: step.timeoutMs ?? 120_000,
    shell: true,
    env,
  };

  try {
    const result = spawnSync(step.cmd, [], opts);
    const durationMs = Date.now() - start;
    const status: ProofLoopStepResult["status"] =
      result.status === 0 ? "pass"
      : result.signal === "SIGTERM" || (result.status === null && durationMs >= (step.timeoutMs ?? 120_000)) ? "timeout"
      : "fail";

    return {
      name: step.name,
      status,
      durationMs,
      stdout: String(result.stdout ?? "").slice(-4000),
      stderr: String(result.stderr ?? "").slice(-4000),
      exitCode: result.status ?? -1,
      required: step.required,
      softFail: step.softFail,
    };
  } catch (err) {
    return {
      name: step.name,
      status: "fail",
      durationMs: Date.now() - start,
      stdout: "",
      stderr: String(err),
      exitCode: -1,
      required: step.required,
      softFail: step.softFail,
    };
  }
}

// ─── Dev server management ───────────────────────────────────────────────

let devServer: ChildProcess | null = null;
let devServerPort: string | null = null;

function startDevServer(port: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const serverUrl = `http://127.0.0.1:${port}`;
    // Check if server is already running
    http.get(serverUrl, (res) => {
      res.resume();
      console.log(`proof-loop: dev server already running at ${serverUrl}`);
      resolve();
    }).on("error", () => {
      // Server not running — start it
      console.log(`proof-loop: starting dev server on port ${port}...`);
      devServer = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", port, "--strictPort"], {
        cwd: process.cwd(),
        shell: true,
        stdio: "pipe",
        detached: false,
      });
      devServerPort = port;
      devServer.stdout?.on("data", () => {});
      devServer.stderr?.on("data", () => {});
      // Wait for server to be ready
      const maxWait = 60_000;
      const start = Date.now();
      const checkReady = () => {
        http.get(serverUrl, (res) => {
          res.resume();
          console.log(`proof-loop: dev server ready at ${serverUrl}`);
          resolve();
        }).on("error", () => {
          if (Date.now() - start > maxWait) {
            reject(new Error(`Dev server did not start within ${maxWait}ms`));
          } else {
            setTimeout(checkReady, 1000);
          }
        });
      };
      setTimeout(checkReady, 2000);
    });
  });
}

function stopDevServer(): void {
  if (devServer) {
    console.log("proof-loop: stopping dev server...");
    try {
      if (process.platform === "win32" && devServer.pid) {
        spawnSync("taskkill", ["/pid", String(devServer.pid), "/t", "/f"], { stdio: "ignore" });
        killWindowsListenerOnPort(devServerPort);
      } else {
        process.kill(-devServer.pid!);
      }
    } catch {
      devServer.kill("SIGTERM");
    }
    devServer = null;
    devServerPort = null;
  }
}

function killWindowsListenerOnPort(port: string | null): void {
  if (!port || !/^\d+$/.test(port)) return;
  spawnSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    `$ownerPids = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($ownerPid in $ownerPids) { Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue }`,
  ], { stdio: "ignore" });
}

// ─── Incremental output ─────────────────────────────────────────────────

function writeIncrementalOutput(
  results: ProofLoopStepResult[],
  config: ProofLoopConfig,
  runId: string,
  outputDir: string,
  configPath: string,
): void {
  const requiredSteps = results.filter((r) => r.required);
  const requiredPassed = requiredSteps.filter((r) => r.status === "pass");
  const score = Math.round((requiredPassed.length / Math.max(requiredSteps.length, 1)) * 100);
  const failReasons: string[] = [];
  for (const r of results) {
    if (r.required && r.status !== "pass" && !r.softFail) {
      failReasons.push(`Required step "${r.name}" ${r.status} (exit ${r.exitCode})`);
    }
  }
  if (score < config.minScore) {
    failReasons.push(`Score ${score} < minScore ${config.minScore}`);
  }
  const model = modelRouteForConfig(config);
  for (const failure of assertProofloopModelTracked(model)) {
    failReasons.push(`Model tracking failure: ${failure}`);
  }
  const harness = proofloopHarnessVersionForSuite(process.cwd(), config.suite, [configPath]);
  const passed = failReasons.length === 0;
  const incremental: ProofLoopRunResult = {
    schema: 1,
    suite: config.suite,
    runId,
    generatedAt: new Date().toISOString(),
    configPath: "",
    minScore: config.minScore,
    steps: results,
    passed,
    score,
    failReasons,
    outputDir,
    model,
    harnessVersion: harness.harnessVersion,
  };
  writeFileSync(join(outputDir, "run-result.json"), JSON.stringify(incremental, null, 2), "utf-8");
  exportTrace(incremental, outputDir);
  writeProofLoopArtifacts(incremental, outputDir, { baseUrl: process.env.PLAYWRIGHT_BASE_URL });
}

function modelRouteForConfig(config: ProofLoopConfig): ProofloopModelRoute {
  return proofloopModelRouteForRun({
    suite: config.suite,
    cmd: config.steps.map((step) => step.cmd).join(" && "),
    env: process.env,
  });
}

function copyToLatest(outputDir: string, latestDir: string): void {
  try {
    if (existsSync(latestDir)) rmSync(latestDir, { recursive: true, force: true });
    cpSync(outputDir, latestDir, { recursive: true });
  } catch { /* best effort */ }
}

function stepNeedsDevServer(step: ProofLoopStepConfig): boolean {
  return /playwright|visual-judge|generate-clips|browser|scenario|ui|report/i.test(`${step.name} ${step.cmd}`);
}

// ─── Scorecard ────────────────────────────────────────────────────────────

function renderScorecard(run: ProofLoopRunResult): string {
  const lines: string[] = [];
  lines.push(`# Proof-Loop Scorecard — ${run.suite}`);
  lines.push("");
  lines.push(`Run ID: ${run.runId}`);
  lines.push(`Generated: ${run.generatedAt}`);
  lines.push(`Config: ${run.configPath}`);
  lines.push("");
  lines.push(`**Result: ${run.passed ? "✅ PASS" : "❌ FAIL"}**`);
  lines.push(`**Score: ${run.score}/100** (min: ${run.minScore})`);
  lines.push("");
  lines.push("## Steps");
  lines.push("");
  lines.push("| Step | Status | Duration | Required | Exit |");
  lines.push("|---|---|---:|---|---:|");
  for (const step of run.steps) {
    const status = step.status === "pass" ? "✅" : step.status === "fail" ? "❌" : step.status === "timeout" ? "⏱️" : "⏭️";
    lines.push(`| ${step.name} | ${status} ${step.status} | ${(step.durationMs / 1000).toFixed(1)}s | ${step.required ? "yes" : "no"} | ${step.exitCode} |`);
  }
  lines.push("");

  if (run.failReasons.length > 0) {
    lines.push("## Fail Reasons");
    lines.push("");
    for (const reason of run.failReasons) lines.push(`- ${reason}`);
    lines.push("");
  }

  lines.push("## Verdict");
  lines.push("");
  if (run.passed) {
    lines.push(`All required steps passed and score ${run.score} >= ${run.minScore}.`);
    lines.push("");
    lines.push("> If accounting proof-looping passes, NodeRoom and NodeBench are end-to-end");
    lines.push("> ready for the covered workflows. If it does not pass, the failure tells us");
    lines.push("> whether the app is broken or proof-looping itself needs a stronger proof step.");
  } else {
    lines.push("Proof-loop FAILED. Either:");
    lines.push("1. The app is not ready — fix the failing steps.");
    lines.push("2. Proof-looping is missing a required check — update the proof gate.");
    lines.push("");
    lines.push("> Before claiming readiness, run the proof-loop again.");
    lines.push("> If it fails, do not say ready.");
  }

  return `${lines.join("\n")}\n`;
}

// ─── Memory ───────────────────────────────────────────────────────────────

interface MemoryEntry {
  runId: string;
  suite: string;
  timestamp: string;
  passed: boolean;
  score: number;
  failReasons: string[];
}

function appendMemory(memoryFile: string, entry: MemoryEntry): void {
  const dir = dirname(memoryFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(memoryFile, JSON.stringify(entry) + "\n", "utf-8");
}

// ─── Trace export ─────────────────────────────────────────────────────────

function exportTrace(run: ProofLoopRunResult, outputDir: string): void {
  const traceLines = run.steps.map((step, i) =>
    JSON.stringify({
      step: i + 1,
      name: step.name,
      status: step.status,
      durationMs: step.durationMs,
      exitCode: step.exitCode,
      timestamp: new Date().toISOString(),
    }),
  );
  writeFileSync(join(outputDir, "trace.jsonl"), traceLines.join("\n") + "\n", "utf-8");

  const rlTrace = {
    runId: run.runId,
    suite: run.suite,
    passed: run.passed,
    score: run.score,
    steps: run.steps.map((s, i) => ({
      step: i + 1,
      name: s.name,
      reward: s.status === "pass" ? 1 : 0,
      durationMs: s.durationMs,
    })),
    totalReward: run.steps.filter((s) => s.status === "pass").length,
    maxReward: run.steps.length,
  };
  writeFileSync(join(outputDir, "rl-trace.json"), JSON.stringify(rlTrace, null, 2), "utf-8");
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
const configPath = optionValue("config");
if (!configPath) {
  console.error("Usage: npx tsx scripts/proofloop-runner.ts --config=<path>");
  process.exit(1);
}

const configFullPath = join(process.cwd(), configPath);
if (!existsSync(configFullPath)) {
  console.error(`Config not found: ${configFullPath}`);
  process.exit(1);
}

const config: ProofLoopConfig = JSON.parse(readFileSync(configFullPath, "utf-8"));
const runId = timestampId(new Date());
const outputDir = config.outputDir
  ? join(process.cwd(), config.outputDir, runId)
  : join(process.cwd(), ".proofloop", "runs", runId);
const latestDir = join(dirname(outputDir), "latest");

mkdirSync(outputDir, { recursive: true });

console.log(`proof-loop: suite=${config.suite} runId=${runId}`);
console.log(`proof-loop: ${config.steps.length} steps configured`);
console.log(`proof-loop: output=${outputDir}`);
console.log("");

// Start dev server before running steps (so both Playwright and adapters can use it)
const port = process.env.PLAYWRIGHT_PORT ?? "5173";
try {
  await startDevServer(port);
  // Tell Playwright to reuse the running server
  process.env.PLAYWRIGHT_REUSE_SERVER = "1";
} catch (err) {
  console.error(`proof-loop: failed to start dev server: ${err}`);
  console.error("proof-loop: continuing — Playwright will try to start its own server");
}

// Run all steps
const results: ProofLoopStepResult[] = [];
for (const step of config.steps) {
  console.log(`proof-loop: running "${step.name}"...`);
  if (stepNeedsDevServer(step)) {
    try {
      await startDevServer(port);
      process.env.PLAYWRIGHT_REUSE_SERVER = "1";
    } catch (err) {
      console.error(`proof-loop: dev server unavailable before "${step.name}": ${err}`);
    }
  }
  // Set env var so adapter steps can find the current run output dir
  const stepEnv = { ...process.env, PROOFLOOP_OUTPUT_DIR: outputDir };
  const result = runStep(step, process.cwd(), stepEnv);
  results.push(result);
  const icon = result.status === "pass" ? "✅" : result.status === "timeout" ? "⏱️" : result.status === "skip" ? "⏭️" : "❌";
  console.log(`  ${icon} ${result.name}: ${result.status} (${(result.durationMs / 1000).toFixed(1)}s)`);
  if (result.status !== "pass" && result.stderr) {
    console.log(`  stderr: ${result.stderr.slice(0, 200)}`);
  }
  // Write incremental run-result and trace so adapters can read them
  writeIncrementalOutput(results, config, runId, outputDir, configPath);
  // Copy to latest after each step so adapters using latest also work
  copyToLatest(outputDir, latestDir);
}

// Calculate score
const requiredSteps = results.filter((r) => r.required);
const requiredPassed = requiredSteps.filter((r) => r.status === "pass");
const softFailSteps = results.filter((r) => r.softFail && r.status !== "pass");
const score = Math.round((requiredPassed.length / Math.max(requiredSteps.length, 1)) * 100);

// Determine pass/fail
const failReasons: string[] = [];
for (const r of results) {
  if (r.required && r.status !== "pass" && !r.softFail) {
    failReasons.push(`Required step "${r.name}" ${r.status} (exit ${r.exitCode})`);
  }
}
if (score < config.minScore) {
  failReasons.push(`Score ${score} < minScore ${config.minScore}`);
}
const model = modelRouteForConfig(config);
for (const failure of assertProofloopModelTracked(model)) {
  failReasons.push(`Model tracking failure: ${failure}`);
}
const harness = proofloopHarnessVersionForSuite(process.cwd(), config.suite, [configPath]);

const passed = failReasons.length === 0;

const runResult: ProofLoopRunResult = {
  schema: 1,
  suite: config.suite,
  runId,
  generatedAt: new Date().toISOString(),
  configPath: configPath,
  minScore: config.minScore,
  steps: results,
  passed,
  score,
  failReasons,
  outputDir,
  model,
  harnessVersion: harness.harnessVersion,
};

// Write outputs
writeFileSync(join(outputDir, "scorecard.md"), renderScorecard(runResult), "utf-8");
writeFileSync(join(outputDir, "run-result.json"), JSON.stringify(runResult, null, 2), "utf-8");
exportTrace(runResult, outputDir);
const artifactPaths = writeProofLoopArtifacts(runResult, outputDir, { baseUrl: process.env.PLAYWRIGHT_BASE_URL });

// Copy to latest
copyToLatest(outputDir, latestDir);

// Append memory
const memoryFile = config.memoryFile ?? join(process.cwd(), ".proofloop", "memory.jsonl");
appendMemory(memoryFile, {
  runId,
  suite: config.suite,
  timestamp: runResult.generatedAt,
  passed,
  score,
  failReasons,
});

// Print summary
console.log("");
console.log(`proof-loop: ${passed ? "✅ PASS" : "❌ FAIL"} — score ${score}/${config.minScore}`);
if (failReasons.length > 0) {
  console.log("proof-loop: fail reasons:");
  for (const r of failReasons) console.log(`  - ${r}`);
}
console.log(`proof-loop: scorecard at ${join(outputDir, "scorecard.md")}`);
console.log(`proof-loop: trace at ${join(outputDir, "trace.jsonl")}`);
console.log(`proof-loop: node trace at ${artifactPaths.nodeTracePath}`);
console.log(`proof-loop: node eval at ${artifactPaths.nodeEvalPath}`);
console.log(`proof-loop: repair prompt at ${artifactPaths.repairPromptPath}`);
console.log(`proof-loop: storybook at ${artifactPaths.storybookPath}`);
console.log(`proof-loop: memory appended to ${memoryFile}`);

// Stop dev server
stopDevServer();

process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error("proof-loop: fatal error", err);
  stopDevServer();
  process.exit(1);
});
