import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  buildSpreadsheetBenchOfficialScoreReadiness,
  defaultSpreadsheetBenchOfficialScoreInputs,
} from "../src/eval/spreadsheetBenchOfficialScoreReadiness";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";

const args = process.argv.slice(2);
const track = (optionValue("--track") ?? "spreadsheetbench-v1") as SpreadsheetBenchTrack;
if (track !== "spreadsheetbench-v1" && track !== "spreadsheetbench-v2") usage();

const defaults = defaultSpreadsheetBenchOfficialScoreInputs(track);
const jsonOut = optionValue("--json-out");
const stageReportPath = optionValue("--stage-report") ?? defaults.stageReportPath;
const routeSelectionPath = optionValue("--route-selection") ?? defaults.routeSelectionPath;
const outputReceiptReportPath = optionValue("--output-receipt-report") ?? defaults.outputReceiptReportPath;
const officialScorerReceiptPath = optionValue("--official-scorer-receipt") ?? defaults.officialScorerReceiptPath;
const expectedTaskCount = numberOption("--expected-task-count") ?? defaults.expectedTaskCount;
const runReportPaths = optionValues("--run-report");
const receiptRoots = optionValues("--receipt-root");
const strict = args.includes("--strict");
const strictProxy = args.includes("--strict-proxy");

const receipt = buildSpreadsheetBenchOfficialScoreReadiness({
  track,
  expectedTaskCount,
  stageReportPath,
  runReportPaths: runReportPaths.length > 0 ? runReportPaths : defaults.runReportPaths,
  routeSelectionPath,
  outputReceiptReportPath,
  officialScorerReceiptPath,
  receiptRoots,
  generatedAt: new Date().toISOString(),
});

const content = `${JSON.stringify(receipt, null, 2)}\n`;
if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`wrote ${rel(outPath)}`);
} else {
  process.stdout.write(content);
}

console.log([
  `SpreadsheetBench official-score readiness: ${receipt.status}`,
  `${receipt.coverage.validScorerReceiptCount}/${receipt.coverage.requiredScorerReceiptCount} scorer receipts`,
  `${receipt.coverage.validOutputReceiptCount}/${receipt.coverage.requiredScorerReceiptCount} output receipts`,
  `modelRun=${receipt.officialModelRunClaim.validTaskCount}/${receipt.officialModelRunClaim.requiredTaskCount}`,
  `proxyClaim=${receipt.localProxyReceiptClaim.allowed}`,
  `proxyOutputClaim=${receipt.localProxyOutputClaim.allowed}`,
  `officialClaim=${receipt.officialScoreClaim.allowed}`,
  `cost=$${receipt.routeCostLedger.providerCostUsd}`,
  receipt.checkpoint.resumeHint ? `resume="${receipt.checkpoint.resumeHint}"` : "checkpoint=complete",
].join(" "));

if (strict && !receipt.officialScoreClaim.allowed) process.exit(1);
if (strictProxy && !(receipt.localProxyReceiptClaim.allowed || receipt.localProxyOutputClaim.allowed)) process.exit(1);

function usage(): never {
  console.error([
    "Usage:",
    "  npx tsx scripts/spreadsheetbench-official-score-readiness.ts --track spreadsheetbench-v1 [--stage-report <path>] [--run-report <path> ...] [--output-receipt-report <path>] [--receipt-root <dir> ...] [--official-scorer-receipt <path>] [--json-out <path>] [--strict|--strict-proxy]",
    "",
    "This is a deterministic gate. It reads existing SpreadsheetBench stage/run/scorer artifacts and never calls providers.",
    "It blocks official-score claims until every expected task has a validated local scorer receipt and an accepted official scorer receipt.",
    "--strict requires the official scorer receipt; --strict-proxy only requires local/proxy task receipts.",
  ].join("\n"));
  process.exit(2);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(prefix)) values.push(arg.slice(prefix.length));
    else if (arg === name && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function numberOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.floor(value);
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}
