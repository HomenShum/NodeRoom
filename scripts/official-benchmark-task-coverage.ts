import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildOfficialBenchmarkTaskCoverageReport,
  type OfficialBenchmarkTaskCoverageReport,
} from "../src/eval/officialBenchmarkTaskCoverage";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/official-benchmark-task-coverage.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/OFFICIAL_BENCHMARK_TASK_COVERAGE.md";
const strict = args.includes("--strict");

const report = buildOfficialBenchmarkTaskCoverageReport({ generatedAt: new Date().toISOString() });

writeJson(jsonOut, report);
writeText(mdOut, renderMarkdown(report));
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `official benchmark task coverage: complete=${report.summary.completeTracks}/${report.summary.tracks} ` +
  `staged=${report.summary.totalStagedTasks}/${report.summary.totalOfficialExpectedTasks} ` +
  `modelCases=${report.summary.totalModelRunCases}`,
);

if (strict && !report.summary.strictFullCoverageReady) process.exitCode = 1;

function renderMarkdown(report: OfficialBenchmarkTaskCoverageReport): string {
  const lines: string[] = [];
  lines.push("# Official Benchmark Task Coverage");
  lines.push("");
  lines.push(`Generated: ${report.generatedAt ?? "unknown"}`);
  lines.push("");
  lines.push("This is the no-shorthand ledger for the external benchmark question: have we staged and run every published task, or only a subset/fixture? It deliberately separates full official tracks, verified subsets, and NodeRoom's internal multi-user conflict suite.");
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(`- Tracks complete: ${report.summary.completeTracks}/${report.summary.tracks}`);
  lines.push(`- Declared task targets represented in this ledger: ${report.summary.totalOfficialExpectedTasks}`);
  lines.push(`- Staged tasks: ${report.summary.totalStagedTasks}`);
  lines.push(`- Deterministic runner tasks: ${report.summary.totalDeterministicRunTasks}`);
  lines.push(`- Model-run cases: ${report.summary.totalModelRunCases}`);
  lines.push(`- Model-run attempts: ${report.summary.totalModelRunAttempts}`);
  lines.push(`- Local/proxy output receipts: ${report.summary.totalLocalProxyOutputReceipts}`);
  lines.push(`- Strict full coverage ready: ${report.summary.strictFullCoverageReady ? "yes" : "no"}`);
  lines.push("");
  lines.push("## Policy");
  lines.push("");
  for (const item of report.policy) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Coverage Tracks");
  lines.push("");
  lines.push("| Track | Status | Task Targets | Staged | Deterministic Run | Model Cases / Attempts | Proxy Output Receipts | Pass Rate | Blockers |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|---:|---|");
  for (const track of report.tracks) {
    lines.push(
      `| \`${track.id}\` | ${track.status} | ${track.officialExpectedTasks} | ${track.stagedTasks} | ` +
      `${track.deterministicRunTasks} | ${track.modelRunCases} / ${track.modelRunAttempts} | ` +
      `${track.localProxyOutputReceipts} | ` +
      `${track.passRate == null ? "n/a" : track.passRate.toFixed(3)} | ${track.blockers.join("; ") || "none"} |`,
    );
  }
  lines.push("");
  lines.push("## Evidence");
  lines.push("");
  for (const track of report.tracks) {
    lines.push(`### ${track.title}`);
    lines.push("");
    lines.push(`- Local scope: ${track.localScope}`);
    lines.push(`- Sources: ${track.officialSourceUrls.map((item) => item.startsWith("http") ? `[${item}](${item})` : `\`${item}\``).join(", ")}`);
    lines.push(`- Evidence: ${track.evidence.map((item) => `\`${item}\``).join(", ")}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}
