import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import {
  buildSpreadsheetBenchV2QualityGate,
  defaultSpreadsheetBenchV2QualityGateInputs,
  formatSpreadsheetBenchV2QualityGateDense,
} from "../src/eval/spreadsheetBenchV2QualityGate";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) usage(0);
if (args.includes("--json") && args.includes("--dense")) {
  console.error("--json and --dense are mutually exclusive");
  usage(2);
}

const defaults = defaultSpreadsheetBenchV2QualityGateInputs();
const officialReceiptPath = optionValue("--official-receipt") ?? defaults.officialReceiptPath;
const suppliedModelRuns = [
  ...optionValues("--model-run-receipt"),
  ...optionValues("--model-run"),
];
const modelRunReceiptPaths = suppliedModelRuns.length ? suppliedModelRuns : defaults.modelRunReceiptPaths;
const receiptRoots = optionValues("--receipt-root");
const jsonOut = optionValue("--json-out");
const jsonMode = args.includes("--json");
const strict = args.includes("--strict");

const verdict = buildSpreadsheetBenchV2QualityGate({
  officialReceiptPath,
  modelRunReceiptPaths,
  receiptRoots,
});
const json = `${JSON.stringify(verdict, null, 2)}\n`;

if (jsonOut) {
  const absolute = resolve(jsonOut);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, json, "utf8");
}

if (jsonMode) process.stdout.write(json);
else process.stdout.write(`${formatSpreadsheetBenchV2QualityGateDense(verdict)}\n`);

if (jsonOut && !jsonMode) process.stderr.write(`wrote ${rel(jsonOut)}\n`);
if (strict && !verdict.pass) process.exitCode = 1;

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const prefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(prefix)) values.push(arg.slice(prefix.length));
    else if (arg === name) {
      const value = args[index + 1];
      if (value && !value.startsWith("--")) {
        values.push(value);
        index += 1;
      }
    }
  }
  return values;
}

function usage(exitCode: number): never {
  const lines = [
    "Usage:",
    "  npx tsx scripts/spreadsheetbench-v2-quality-gate.ts [options]",
    "",
    "Options:",
    "  --official-receipt <path>     Accepted official V2 scorer receipt.",
    "  --model-run-receipt <path>    Model-run/trace receipt (repeatable; --model-run is an alias).",
    "  --receipt-root <dir>          Additional sidecar receipt root (repeatable).",
    "  --dense                       Emit one deterministic dense status line (default).",
    "  --json                        Emit the full deterministic JSON verdict.",
    "  --json-out <path>             Also write the full JSON verdict.",
    "  --strict                      Exit 1 unless every quality sub-gate passes.",
    "  --help                        Show this help.",
    "",
    "The gate is read-only and never invokes a model, provider, or scorer.",
  ];
  (exitCode === 0 ? process.stdout : process.stderr).write(`${lines.join("\n")}\n`);
  process.exit(exitCode);
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}
