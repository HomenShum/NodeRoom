import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { buildProofloopBenchmarkBoard, renderProofloopBenchmarkBoardMarkdown } from "../src/eval/proofloopBenchmarkBoard";

function optionValue(name: string): string | undefined {
  const inline = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-benchmark-board.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_BENCHMARK_BOARD.md";
const board = buildProofloopBenchmarkBoard({ generatedAt: new Date().toISOString() });

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(board, null, 2)}\n`, "utf-8");
writeFileSync(mdOut, renderProofloopBenchmarkBoardMarkdown(board), "utf-8");

console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);
console.log(
  `proofloop benchmark board: product=${board.summary.productPathProven} proven, ` +
  `${board.summary.productPathReadyToRun} ready, official=${board.summary.officialScoresClaimed} claimed`,
);
