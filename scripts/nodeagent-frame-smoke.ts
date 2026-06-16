import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runMinimalNodeAgentFrameSmoke } from "../examples/nodeagent-frame-runner/minimal";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out");

const report = await runMinimalNodeAgentFrameSmoke();

if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`nodeagent frame smoke: PASS wrote ${rel(outPath)}`);
} else {
  console.log(`nodeagent frame smoke: PASS frame=${report.frameId} status=${report.status} steps=${report.steps}`);
  console.log(`tools=${report.traceTools.join(",")}`);
  console.log(`cell=${JSON.stringify(report.finalCellValue)}`);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
