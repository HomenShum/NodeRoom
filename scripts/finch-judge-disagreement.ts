import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildFinchJudgeDisagreement,
  renderFinchJudgeDisagreement,
  type FinchJudgeRecord,
} from "../src/eval/finchJudgeDisagreement";

const args = process.argv.slice(2);
const canonicalPath = option("--canonical")
  ?? ".tmp/official-benchmarks/finch-canonical/finch-judge-results.jsonl";
const shadowPath = option("--shadow")
  ?? ".tmp/official-benchmarks/finch-shadow/finch-judge-results.jsonl";
const jsonOut = option("--json-out") ?? "docs/eval/finch-judge-disagreement.json";
const markdownOut = option("--markdown-out") ?? "docs/eval/FINCH_JUDGE_DISAGREEMENT.md";

const report = buildFinchJudgeDisagreement({
  canonical: readJsonl(canonicalPath),
  shadow: readJsonl(shadowPath),
  generatedAt: new Date().toISOString(),
});

write(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
write(markdownOut, renderFinchJudgeDisagreement(report));
console.log(`finch judge disagreement: compared=${report.coverage.comparedRecords} agreement=${report.scores.agreementRate ?? "n/a"}`);

function readJsonl(path: string): FinchJudgeRecord[] {
  return readFileSync(resolve(path), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as FinchJudgeRecord);
}

function write(path: string, value: string): void {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--")
    ? args[index + 1]
    : undefined;
}
