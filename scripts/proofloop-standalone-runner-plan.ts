import { readFileSync } from "node:fs";
import {
  buildProofloopStandaloneRunnerPlan,
  readProofloopRunnerDogfoodReceipt,
  type ProofloopStandaloneRunnerPlan,
  writeProofloopStandaloneRunnerPlanArtifacts,
} from "../src/eval/proofloopStandaloneRunnerPlan";

const args = process.argv.slice(2);
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-standalone-runner-dogfood-plan.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_STANDALONE_RUNNER_DOGFOOD.md";
const budgetUsd = numberOption("--budget-usd", 100);
const unknownAttemptCostUsd = numberOption("--unknown-attempt-cost-usd", 0.02);
const generatedAt = optionValue("--generated-at");
const planId = optionValue("--plan-id");
const baseUrl = optionValue("--base-url");
const dogfoodRunId = optionValue("--dogfood-run-id");
const fromJson = booleanOption("--from-json");
const models = optionValues("--model")
  .flatMap((value) => value.split(","))
  .concat(optionValue("--models")?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);

const plan = fromJson
  ? JSON.parse(readFileSync(jsonOut, "utf8")) as ProofloopStandaloneRunnerPlan
  : buildProofloopStandaloneRunnerPlan({
      generatedAt,
      planId,
      baseUrl,
      budgetUsd,
      unknownAttemptCostUsd,
      planPath: jsonOut,
      docsPath: mdOut,
      models: models.length ? models : undefined,
    });
const dogfoodReceipt = dogfoodRunId ? readProofloopRunnerDogfoodReceipt(process.cwd(), dogfoodRunId) : undefined;

writeProofloopStandaloneRunnerPlanArtifacts({ plan, jsonOut, mdOut, dogfoodReceipt });

console.log(`proofloop standalone runner plan: ${plan.planId}`);
console.log(`tasks: total=${plan.summary.tasks} capability_headless=${plan.summary.capabilityHeadlessTasks} browser_certification=${plan.summary.browserCertificationTasks} adapter_gaps=${plan.summary.adapterGapTasks} live_batches=${plan.summary.guardedLiveRunBatchTasks} official_score_gaps=${plan.summary.officialScoreGapTasks}`);
console.log(`runner: ${plan.standaloneRunner.command}`);
if (dogfoodRunId) {
  console.log(dogfoodReceipt ? `dogfood: ${dogfoodReceipt.runId} ${dogfoodReceipt.status}` : `dogfood: ${dogfoodRunId} not found`);
}
console.log(`wrote ${jsonOut}`);
console.log(`wrote ${mdOut}`);

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      }
    }
  }
  return values;
}

function booleanOption(name: string): boolean {
  return args.includes(name);
}

function numberOption(name: string, fallback: number): number {
  const value = Number(optionValue(name) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}
