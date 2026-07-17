import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runStagedSpreadsheetBench } from "../src/eval/spreadsheetBenchRunner";
import type { AgentModel } from "../src/nodeagent/core/types";

const args = process.argv.slice(2);
const stageRoot = required("--stage-root");
const outputRoot = required("--output-root");
const taskId = required("--task-id");
const initialOutput = required("--initial-output");
const repairOutputs = values("--repair-output");
const jsonOut = required("--json-out");
const scriptedOutputs = [initialOutput, ...repairOutputs].map((path) => readFileSync(resolve(path), "utf8"));
let callIndex = 0;
const model: AgentModel = {
  name: "spreadsheetbench/no-provider-repair-replay",
  async next() {
    const text = scriptedOutputs[Math.min(callIndex, scriptedOutputs.length - 1)] ?? "";
    callIndex += 1;
    return { text, toolCalls: [], done: true, usage: { inputTokens: 0, outputTokens: 0 } };
  },
};

const report = await runStagedSpreadsheetBench({
  stageRoot,
  outputRoot,
  mode: "model-edit-plan",
  model,
  modelRepairAttempts: repairOutputs.length,
  taskIds: [taskId],
  clean: true,
  generatedAt: new Date().toISOString(),
});
const receipt = {
  schema: 1,
  kind: "no_provider_repair_replay",
  officialScore: false,
  note: "Replays supplied model text through agent-visible inspection, preflight repair, candidate verification, and the staged scorer. It is a harness regression receipt, not a new model score.",
  scriptedOutputCount: scriptedOutputs.length,
  actualModelCalls: callIndex,
  report,
};
const path = resolve(jsonOut);
mkdirSync(dirname(path), { recursive: true });
writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(`wrote ${path}`);
if (report.passCount !== report.taskCount) process.exitCode = 1;

function required(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function values(name: string): string[] {
  const out: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) out.push(args[index + 1]);
    else if (args[index].startsWith(`${name}=`)) out.push(args[index].slice(name.length + 1));
  }
  return out;
}

function option(name: string): string | undefined {
  const equal = args.find((arg) => arg.startsWith(`${name}=`));
  if (equal) return equal.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
