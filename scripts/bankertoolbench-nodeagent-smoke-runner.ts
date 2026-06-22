import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  loadBankerToolBenchSourceFacts,
  runBankerToolBenchNodeAgentSmoke,
  type BankerToolBenchNodeAgentSmokeOptions,
} from "../src/eval/bankerToolBenchNodeAgentSmoke";
import {
  loadBankerToolBenchSourcePacket,
  runBankerToolBenchNodeAgentGeneral,
  type BankerToolBenchNodeAgentGeneralOptions,
} from "../src/eval/bankerToolBenchNodeAgentGeneral";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.get("mode") ?? "smoke";
  const instructionFile = requiredArg(args, "instruction-file");
  const outDir = requiredArg(args, "out-dir");
  const trajectoryOut = requiredArg(args, "trajectory-out");
  const traceOut = requiredArg(args, "trace-out");
  const instruction = await readFile(resolve(instructionFile), "utf8");

  const result = mode === "general"
    ? await runGeneral(args, instruction, outDir, trajectoryOut, traceOut)
    : await runSmoke(args, instruction, outDir, trajectoryOut, traceOut);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

async function runSmoke(
  args: Map<string, string>,
  instruction: string,
  outDir: string,
  trajectoryOut: string,
  traceOut: string,
) {
  const factsFile = requiredArg(args, "facts-file");
  const facts = await loadBankerToolBenchSourceFacts(resolve(factsFile));
  const options: BankerToolBenchNodeAgentSmokeOptions = {
    instruction,
    facts,
    outDir: resolve(outDir),
    trajectoryOut: resolve(trajectoryOut),
    traceOut: resolve(traceOut),
    nowIso: new Date().toISOString(),
  };
  return runBankerToolBenchNodeAgentSmoke(options);
}

async function runGeneral(
  args: Map<string, string>,
  instruction: string,
  outDir: string,
  trajectoryOut: string,
  traceOut: string,
) {
  const sourcePacketFile = requiredArg(args, "source-packet-file");
  const artifactPlanOut = requiredArg(args, "artifact-plan-out");
  const sourcePacket = await loadBankerToolBenchSourcePacket(resolve(sourcePacketFile));
  const options: BankerToolBenchNodeAgentGeneralOptions = {
    instruction,
    sourcePacket,
    outDir: resolve(outDir),
    artifactPlanOut: resolve(artifactPlanOut),
    trajectoryOut: resolve(trajectoryOut),
    traceOut: resolve(traceOut),
    modelId: args.get("model-id"),
    maxSteps: Number(args.get("max-steps") ?? "6"),
    plannerDeadlineMs: Number(args.get("deadline-ms") ?? "180000"),
    nowIso: new Date().toISOString(),
    allowFallbackPlan: args.get("allow-fallback-plan") !== "false",
    forceModelPlanner: args.get("force-model-planner") === "true",
  };
  return runBankerToolBenchNodeAgentGeneral(options);
}

function parseArgs(argv: string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    parsed.set(key, value);
    index += 1;
  }
  return parsed;
}

function requiredArg(args: Map<string, string>, name: string): string {
  const value = args.get(name);
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
