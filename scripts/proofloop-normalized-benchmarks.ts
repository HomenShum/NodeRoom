import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopBenchmarkNormalizationReport,
  renderProofloopBenchmarkNormalizationMarkdown,
} from "../src/eval/proofloopBenchmarkNormalization";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-normalized-benchmarks.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_NORMALIZED_BENCHMARKS.md";
const strict = args.includes("--strict");

const report = buildProofloopBenchmarkNormalizationReport({ generatedAt: new Date().toISOString() });

writeJson(jsonOut, report);
writeText(mdOut, renderProofloopBenchmarkNormalizationMarkdown(report));

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop normalized benchmarks: product proven=${report.summary.productFitProven}, ` +
  `ready=${report.summary.productFitReady}, partial=${report.summary.productFitPartial}, ` +
  `official claimed=${report.summary.officialScoresClaimed}, blocked=${report.summary.officialScoresBlocked}`,
);

if (strict && report.summary.productFitBlocked > 0) process.exitCode = 1;

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
