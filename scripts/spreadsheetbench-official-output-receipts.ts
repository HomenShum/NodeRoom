import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  buildSpreadsheetBenchOfficialOutputReceipts,
} from "../src/eval/spreadsheetBenchOfficialOutputReceipts";
import {
  defaultSpreadsheetBenchOfficialScoreInputs,
} from "../src/eval/spreadsheetBenchOfficialScoreReadiness";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";

const args = process.argv.slice(2);
const track = (optionValue("--track") ?? "spreadsheetbench-v1") as SpreadsheetBenchTrack;
if (track !== "spreadsheetbench-v1" && track !== "spreadsheetbench-v2") usage();

const defaults = defaultSpreadsheetBenchOfficialScoreInputs(track);
const stageRoot = optionValue("--stage-root") ?? (track === "spreadsheetbench-v1"
  ? ".tmp/official-benchmarks/staged-v1-912"
  : ".tmp/official-benchmarks/staged-v2-full");
const stageReportPath = optionValue("--stage-report") ?? defaults.stageReportPath;
const outputRoot = optionValue("--output-root") ?? (track === "spreadsheetbench-v1"
  ? ".tmp/official-benchmarks/spreadsheetbench-v1-912-local-proxy-output-receipts"
  : ".tmp/official-benchmarks/spreadsheetbench-v2-321-local-proxy-output-receipts");
const jsonOut = optionValue("--json-out") ?? defaults.outputReceiptReportPath;
const clean = args.includes("--clean");

if (!stageRoot || !stageReportPath || !outputRoot || !jsonOut) usage();

const report = buildSpreadsheetBenchOfficialOutputReceipts({
  track,
  stageRoot,
  stageReportPath,
  outputRoot,
  clean,
  generatedAt: new Date().toISOString(),
});

const outPath = resolve(jsonOut);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${rel(outPath)}`);
console.log([
  `SpreadsheetBench local/proxy output receipts: ${track}`,
  `${report.coverage.outputReceiptCount}/${report.expectedTaskCount} receipts`,
  `${report.coverage.candidateWorkbookCount} candidate workbook(s)`,
  `officialClaim=${report.officialScoreClaim.allowed}`,
  `cost=$${report.routeCostLedger.providerCostUsd}`,
].join(" "));

function usage(): never {
  console.error([
    "Usage:",
    "  npx tsx scripts/spreadsheetbench-official-output-receipts.ts --track spreadsheetbench-v1 [--stage-root <dir>] [--stage-report <path>] [--output-root <dir>] [--json-out <path>] [--clean]",
    "",
    "Builds local/proxy candidate output receipts from staged agent-visible inputs.",
    "It never calls providers, never reads evaluator gold, and never allows an official score claim.",
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

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}
