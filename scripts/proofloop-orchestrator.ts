#!/usr/bin/env node
import { runProofloopOrchestrator } from "../src/proofloop/orchestrator";

const args = process.argv.slice(2);

function main(): void {
  const [command = "run", ...rest] = args;
  const goalId = optionValue(rest, "--goal") ?? optionValue(rest, "--goal-id") ?? "official-scores";
  const objective = optionValue(rest, "--objective") ?? optionValue(rest, "--goal-text");
  const maxSteps = Number(optionValue(rest, "--max-steps") ?? (command === "dogfood" ? "100" : "25"));
  const dryRun = rest.includes("--dry-run") || command === "plan";
  const executeSafe = rest.includes("--execute-safe") || command === "dogfood";
  const allowWorkerLaunch = rest.includes("--allow-worker-launch");
  const jsonOut = optionValue(rest, "--json-out");
  const mdOut = optionValue(rest, "--md-out");
  const runId = optionValue(rest, "--run-id");

  if (command !== "plan" && command !== "run" && command !== "dogfood" && command !== "start") {
    usage(`unknown orchestrator command: ${command}`);
    return;
  }

  const result = runProofloopOrchestrator({
    root: process.cwd(),
    mode: command === "start" ? "run" : command,
    goalId,
    objective,
    template: goalId === "official-scores" ? "official-scores" : undefined,
    freshTemplate: rest.includes("--fresh-template") || command === "dogfood",
    maxSteps,
    executeSafe,
    dryRun,
    allowWorkerLaunch,
    runId,
    jsonOut,
    mdOut,
  });

  console.log(`proofloop orchestrator: ${result.state.terminalStatus}`);
  console.log(`proofloop orchestrator: ${result.state.summary.notDone} task(s) not done`);
  console.log(`proofloop orchestrator: ${result.state.paths.summary}`);
  if (result.state.terminalStatus === "FAILED_AFTER_MAX_RETRIES") process.exitCode = 1;
}

function usage(error?: string): void {
  if (error) console.error(`proofloop orchestrator: ${error}\n`);
  console.log(
    [
      "Usage: npm run proofloop:orchestrator -- <plan|run|dogfood|start> [args]",
      "",
      "  --goal <id>             goal id, defaults to official-scores",
      "  --objective <text>      goal text for the run",
      "  --max-steps <n>         maximum queue steps",
      "  --execute-safe          run safe local proof/scaffold commands",
      "  --dry-run               write queue/repair context without commands",
      "  --allow-worker-launch   record launch-ready worker dispatches",
      "  --json-out <path>       write a tracked JSON summary",
      "  --md-out <path>         write a tracked Markdown summary",
    ].join("\n"),
  );
  process.exitCode = error ? 1 : 0;
}

function optionValue(items: string[], name: string): string | undefined {
  const inline = items.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = items.indexOf(name);
  return index >= 0 ? items[index + 1] : undefined;
}

main();
