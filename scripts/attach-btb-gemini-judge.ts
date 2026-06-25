import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import {
  attachBtbGeminiJudgeResults,
  renderBtbGeminiJudgeAttachResult,
} from "../src/solo/btbGeminiJudgeAttach";

const args = process.argv.slice(2);

const judgePath = optionValue("--judge") ?? optionValue("--judge-path");
if (!judgePath) throw new Error("Usage: tsx scripts/attach-btb-gemini-judge.ts --judge <gemini latest.json> [--task-id <id>] [--json-out <path>]");

const result = attachBtbGeminiJudgeResults({
  judgePath,
  summaryPath: optionValue("--summary"),
  taskIds: optionValues("--task-id").flatMap((value) => value.split(",").map((item) => item.trim()).filter(Boolean)),
});

console.log(renderBtbGeminiJudgeAttachResult(result));

const jsonOut = optionValue("--json-out");
if (jsonOut) {
  const absolute = resolve(process.cwd(), jsonOut);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(result, null, 2)}\n`);
}

function optionValue(name: string): string | undefined {
  return optionValues(name)[0];
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) {
      values.push(arg.slice(inlinePrefix.length));
      continue;
    }
    const next = args[index + 1];
    if (arg === name && next && !next.startsWith("--")) {
      values.push(next);
      index += 1;
    }
  }
  return values;
}
