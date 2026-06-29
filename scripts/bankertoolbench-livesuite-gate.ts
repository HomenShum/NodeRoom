// FR-020C live-UI full-suite gate (CLI).
//
// Reads per-task fresh-room live receipts (docs/eval/fresh-room/FR-020/tasks/<id>/latest.json),
// validates each with the existing validateFreshRoomProofReceipt, and decides whether the live
// product-UI full-suite proof (FR-020C) is earned. Writes a verdict receipt that
// buildFreshRoomProofRegistry derives FR-020C from -- it does NOT hand-edit the registry.
//
// Usage:
//   tsx scripts/bankertoolbench-livesuite-gate.ts \
//     [--tasks-dir docs/eval/fresh-room/FR-020/tasks] \
//     [--expected-count 100] [--expected-task-ids datasets/btb/task-ids.json] \
//     [--receipt-out docs/eval/fresh-room/FR-020/livesuite-gate-receipt.json] \
//     [--write] [--assert]
//
// Report-only by default. --write writes the verdict to the canonical path; then run
// `npm run benchmark:fresh-room:proofs` to regenerate the registry. --assert exits 1 if not earned.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  readFreshRoomProofReceipt,
  validateFreshRoomProofReceipt,
} from "../src/eval/freshRoomProofReceipts";
import {
  evaluateLiveSuiteGate,
  type LiveTaskResult,
  type LiveSuiteGateVerdict,
} from "../src/eval/bankerToolBenchLiveSuiteGate";
import {
  buildFailurePatterns,
  mergeFailureMemory,
  repairTargets,
} from "../src/nodemem/failureMemory";
import type { NodeMemFailurePattern } from "../src/nodemem/core/types";

const LIVESUITE_VERDICT_PATH = "docs/eval/fresh-room/FR-020/livesuite-gate-receipt.json";
const FAILURE_MEMORY_PATH = "docs/eval/fresh-room/FR-020/failure-memory.json";
const args = process.argv.slice(2);
const tasksDir = optionValue("--tasks-dir") ?? "docs/eval/fresh-room/FR-020/tasks";
const expectedCount = Number(optionValue("--expected-count") ?? "100");
const expectedTaskIdsPath = optionValue("--expected-task-ids");
const receiptOut = optionValue("--receipt-out") ?? (args.includes("--write") ? LIVESUITE_VERDICT_PATH : undefined);
const doAssert = args.includes("--assert");

const expectedTaskIds = expectedTaskIdsPath ? readTaskIds(expectedTaskIdsPath) : undefined;
const results = loadTaskResults(tasksDir);
const verdict = evaluateLiveSuiteGate(results, { expectedCount, expectedTaskIds });
printVerdict(verdict);

// Memory -> repair: record per-task failures, drop resolved ones, surface the re-run targets.
const failures = results
  .filter((r) => !r.passed)
  .map((r) => ({ taskId: r.taskId, reason: r.reason ?? "unknown", lane: "live" as const, receiptRef: join(tasksDir, r.taskId, "latest.json") }));
const passedTaskIds = results.filter((r) => r.passed).map((r) => r.taskId);
const existingMemory = readJsonOrNull<NodeMemFailurePattern[]>(FAILURE_MEMORY_PATH) ?? [];
const mergedMemory = mergeFailureMemory(existingMemory, buildFailurePatterns(failures, Date.now()), passedTaskIds);
const targets = repairTargets(mergedMemory);
console.log(`  repair targets: ${targets.length}${targets.length ? " " + preview(targets) : " (none — all resolved)"}`);

if (receiptOut) {
  writeJson(receiptOut, verdict);
  writeJson(FAILURE_MEMORY_PATH, mergedMemory);
  console.log(`wrote verdict ${receiptOut}`);
  console.log(`wrote failure memory ${FAILURE_MEMORY_PATH} (${mergedMemory.length} unresolved)`);
  console.log("Run `npm run benchmark:fresh-room:proofs` to regenerate the registry (FR-020C derives from this verdict).");
} else if (verdict.flipEligible) {
  console.log("\nFR-020C is ELIGIBLE. Re-run with --write to record the verdict, then regenerate the registry.");
} else {
  console.log("\nFR-020C remains BLOCKED (live-UI proof not earned).");
}

if (doAssert && !verdict.flipEligible) process.exit(1);

// ---------------------------------------------------------------------------

function loadTaskResults(dir: string): LiveTaskResult[] {
  const absolute = resolve(dir);
  if (!existsSync(absolute)) return [];
  const out: LiveTaskResult[] = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(dir, entry.name, "latest.json");
    const receipt = readFreshRoomProofReceipt(path);
    if (!receipt) continue;
    const validation = validateFreshRoomProofReceipt(receipt, {
      path,
      caseId: "FR-020",
      requireArtifactPlaceholderScan: true,
      requireAgentTerminalQuality: true,
      requireOfficialScorer: true,
    });
    const passed = receipt.benchmark === "bankertoolbench" && receipt.passed === true && validation.ok;
    out.push({
      taskId: receipt.taskId ?? entry.name,
      passed,
      reason: passed ? undefined : validation.errors.join("; ") || "receipt not passing",
    });
  }
  return out;
}

function printVerdict(v: LiveSuiteGateVerdict): void {
  console.log("BankerToolBench live-UI suite gate (FR-020C)");
  console.log(`  expected:      ${v.expectedCount}`);
  console.log(`  evaluated:     ${v.evaluatedTaskCount}`);
  console.log(`  passed live:   ${v.passedTaskCount}`);
  if (v.failedTaskIds.length) console.log(`  failed:        ${v.failedTaskIds.length} ${preview(v.failedTaskIds)}`);
  if (v.missingTaskIds.length) console.log(`  missing:       ${v.missingTaskIds.length} ${preview(v.missingTaskIds)}`);
  console.log(`  flipEligible:  ${v.flipEligible}`);
  console.log(`  claim:         ${v.claim}`);
}

function preview(items: string[]): string {
  const head = items.slice(0, 5).join(", ");
  return items.length > 5 ? `[${head}, ...]` : `[${head}]`;
}

function readTaskIds(path: string): string[] {
  const text = readFileSync(resolve(path), "utf8").trim();
  if (text.startsWith("[")) {
    const parsed = JSON.parse(text);
    return (Array.isArray(parsed) ? parsed : []).map((x) => String(x)).filter(Boolean);
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonOrNull<T>(path: string): T | null {
  const absolute = resolve(path);
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, "utf8")) as T;
  } catch {
    return null;
  }
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
