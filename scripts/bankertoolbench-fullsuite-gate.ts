// FR-020B full-suite flip gate (CLI).
//
// Reads BankerToolBench sweep summaries (or a prebuilt ledger), decides whether the
// proof-registry FR-020B claim has been EARNED (all expected tasks executed + officially
// scored, generic-only), and only then proposes/writes the registry flip.
//
// Usage:
//   tsx scripts/bankertoolbench-fullsuite-gate.ts \
//     [--summary docs/eval/btb-clean-capability-*.json ...] \
//     [--ledger docs/eval/loop-ledger/btb-ledger-import-preview.json] \
//     [--expected-count 100] [--expected-task-ids datasets/btb/task-ids.json] \
//     [--pass-threshold 1.0] \
//     [--registry docs/eval/fresh-room/proof-registry.json] \
//     [--receipt-out docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json] \
//     [--write] [--assert]
//
// Default behavior is REPORT ONLY. --write flips the registry iff eligible (else exits 1).
// --assert exits 1 when not eligible (use as a CI gate).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildBtbLedgerImport,
  type BankerToolBenchSweepSummary,
  type BtbLedgerImport,
} from "../src/eval/bankerToolBenchEvalLedger";
import {
  evaluateFullSuiteGate,
  type FullSuiteGateVerdict,
} from "../src/eval/bankerToolBenchFullSuiteGate";

const args = process.argv.slice(2);
const ledgerPath = optionValue("--ledger");
const summaryPaths = optionValues("--summary");
const expectedCount = Number(optionValue("--expected-count") ?? "100");
const expectedTaskIdsPath = optionValue("--expected-task-ids");
const passThreshold = Number(optionValue("--pass-threshold") ?? "1.0");
const FULLSUITE_VERDICT_PATH = "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json";
const receiptOut = optionValue("--receipt-out") ?? (args.includes("--write") ? FULLSUITE_VERDICT_PATH : undefined);
const doWrite = args.includes("--write");
const doAssert = args.includes("--assert");

const expectedTaskIds = expectedTaskIdsPath ? readTaskIds(expectedTaskIdsPath) : undefined;

const ledger: BtbLedgerImport = ledgerPath
  ? readJson<BtbLedgerImport>(ledgerPath)
  : buildBtbLedgerImport({ summaries: loadSummaries() });

const verdict = evaluateFullSuiteGate(ledger, { expectedCount, expectedTaskIds, passThreshold });

printVerdict(verdict);

if (receiptOut) {
  writeJson(receiptOut, verdict);
  console.log(`wrote receipt ${receiptOut}`);
}

if (doWrite) {
  console.log("\nRegistry derives FR-020B from this verdict on `npm run benchmark:fresh-room:proofs`.");
  if (!verdict.flipEligible) console.log("(verdict is NOT flip-eligible; FR-020B stays blocked until earned.)");
} else if (verdict.flipEligible) {
  console.log("\nFR-020B is ELIGIBLE. Re-run with --write to record the verdict, then regenerate the registry.");
} else {
  console.log("\nFR-020B remains BLOCKED (proof not earned).");
}

if (doAssert && !verdict.flipEligible) process.exit(1);

// ---------------------------------------------------------------------------

function loadSummaries(): Array<{ path: string; summary: BankerToolBenchSweepSummary }> {
  const paths = summaryPaths.length ? summaryPaths : discoverSummaryFiles();
  if (!paths.length) {
    throw new Error(
      "No BTB sweep summaries found. Pass --summary <path> (repeatable), --ledger <path>, " +
        "or place btb-clean-capability-*.json under docs/eval/.",
    );
  }
  return paths.map((path) => ({ path, summary: readJson<BankerToolBenchSweepSummary>(path) }));
}

function discoverSummaryFiles(): string[] {
  const evalDir = resolve("docs/eval");
  if (!existsSync(evalDir)) return [];
  return readdirSync(evalDir)
    .filter((name) => name.endsWith(".json"))
    .filter((name) => name.startsWith("btb-clean-capability-"))
    .filter((name) => !/dryrun/i.test(name))
    .map((name) => join(evalDir, name))
    .filter((path) => {
      try {
        const parsed = readJson<BankerToolBenchSweepSummary>(path);
        return parsed.schema === "noderoom-btb-nodeagent-full-sweep-summary-v1" && Array.isArray(parsed.tasks);
      } catch {
        return false;
      }
    })
    .sort();
}

function printVerdict(v: FullSuiteGateVerdict): void {
  console.log(`BankerToolBench full-suite gate (FR-020B)`);
  console.log(`  expected:        ${v.expectedCount}`);
  console.log(`  executed:        ${v.executedTaskCount}`);
  console.log(`  clean+scored:    ${v.cleanScoredTaskCount}`);
  console.log(`  mean reward:     ${fmtClaim(v.meanCleanReward)}`);
  console.log(`  pass-rate:       ${fmtClaim(v.passRate)} (reward >= ${v.passThreshold}, ${v.passCount} tasks)`);
  if (v.contaminatedTaskIds.length) console.log(`  contaminated:    ${v.contaminatedTaskIds.length} ${preview(v.contaminatedTaskIds)}`);
  if (v.unscoredTaskIds.length) console.log(`  unscored:        ${v.unscoredTaskIds.length} ${preview(v.unscoredTaskIds)}`);
  if (v.missingTaskIds.length) console.log(`  missing:         ${v.missingTaskIds.length} ${preview(v.missingTaskIds)}`);
  for (const g of v.subGates) console.log(`  [${g.status === "pass" ? "PASS" : "BLOCK"}] ${g.id}: ${g.reason}`);
  console.log(`  flipEligible:    ${v.flipEligible}`);
  console.log(`  claim:           ${v.claim}`);
}

function preview(ids: string[]): string {
  const head = ids.slice(0, 5).join(", ");
  return ids.length > 5 ? `[${head}, ...]` : `[${head}]`;
}

function readTaskIds(path: string): string[] {
  const text = decodeJsonBuffer(readFileSync(resolve(path)));
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    return (Array.isArray(parsed) ? parsed : []).map((x) => String(x)).filter(Boolean);
  }
  return trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function readJson<T>(path: string): T {
  return JSON.parse(decodeJsonBuffer(readFileSync(resolve(path)))) as T;
}

function writeJson(path: string, value: unknown): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fmtClaim(value: number | null): string {
  return value == null ? "n/a" : value.toFixed(4);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i++;
      }
    }
  }
  return values;
}

function decodeJsonBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^﻿/, "");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return buffer.swap16().toString("utf16le").replace(/^﻿/, "");
  }
  const sample = buffer.subarray(0, Math.min(buffer.length, 200));
  let nulBytes = 0;
  for (const byte of sample) if (byte === 0) nulBytes++;
  if (nulBytes > sample.length / 4) return buffer.toString("utf16le").replace(/^﻿/, "");
  return buffer.toString("utf8").replace(/^﻿/, "");
}
