import {
  buildProofloopProdProxyLongRunPlan,
  executeProofloopProdProxyLongRun,
  loadLatestProofloopProdProxyLongRunPlan,
  loadProofloopProdProxyLongRunPlanByRunId,
  renderProofloopProdProxyLongRunMarkdown,
  writeProofloopProdProxyLongRunArtifacts,
} from "../src/eval/proofloopProdProxyLongRun";
import { selectOpenRouterFreeModels } from "../src/nodeagent/models/openRouterFreeModels";

const args = process.argv.slice(2);
const command = ["plan", "status", "run", "resume"].find((candidate) => args.includes(candidate)) ?? "plan";
const generatedAt = new Date().toISOString();
const baseUrl = optionValue("--base-url") ?? "https://noderoom.live";
const budgetUsd = numberOption("--budget-usd", 100);
const unknownAttemptCostUsd = numberOption("--unknown-attempt-cost-usd", 0.02);
const maxAttempts = numberOption("--max-attempts", command === "run" ? 1 : 0);
const models = optionValues("--model")
  .flatMap((value) => value.split(","))
  .concat(optionValue("--models")?.split(",") ?? [])
  .map((value) => value.trim())
  .filter(Boolean);
const runId = optionValue("--run-id");
const jsonOut = optionValue("--json-out") ?? "docs/eval/proofloop-prod-proxy-longrun-plan.json";
const mdOut = optionValue("--md-out") ?? "docs/eval/PROOFLOOP_PROD_PROXY_LONGRUN.md";

const freeOpenRouter = args.includes("--free-openrouter");
const freeModelLimit = numberOption("--free-model-limit", 4);
const resolvedModels = await resolveModels();

if (command === "status") {
  const latest = runId ? loadProofloopProdProxyLongRunPlanByRunId(runId) : loadLatestProofloopProdProxyLongRunPlan();
  if (!latest) {
    console.error(runId
      ? `proofloop prod proxy longrun: no local run state found for ${runId}.`
      : "proofloop prod proxy longrun: no local run state found.");
    process.exitCode = 2;
  } else {
    console.log(renderStatus(latest));
  }
} else if (command === "run" || command === "resume" || command === "plan") {
  const existing = command === "resume"
    ? runId
      ? loadProofloopProdProxyLongRunPlanByRunId(runId)
      : loadLatestProofloopProdProxyLongRunPlan()
    : undefined;
  if (command === "resume" && runId && !existing) {
    console.error(`proofloop prod proxy longrun: no local run state found for ${runId}.`);
    process.exit(2);
  }
  const plan = existing ?? buildProofloopProdProxyLongRunPlan({
    generatedAt,
    runId,
    baseUrl,
    models: resolvedModels.length ? resolvedModels : undefined,
    budgetUsd,
    unknownAttemptCostUsd,
  });
  writeProofloopProdProxyLongRunArtifacts({ plan, jsonOut, mdOut });
  const result = executeProofloopProdProxyLongRun({
    plan,
    execute: command === "run" || command === "resume",
    allowSpend: args.includes("--allow-spend"),
    maxAttempts,
  });
  writeProofloopProdProxyLongRunArtifacts({ plan: result.plan, jsonOut, mdOut });
  console.log(renderStatus(result.plan));
  console.log(`wrote ${jsonOut}`);
  console.log(`wrote ${mdOut}`);
  if ((command === "run" || command === "resume") && !args.includes("--allow-spend")) {
    console.log("live execution skipped: pass --allow-spend with --execute intent to spend model/API budget");
  }
} else {
  console.error(`Unknown prod proxy longrun command: ${command}`);
  console.error("Usage: npm run benchmark:proofloop:prod-proxy-longrun -- plan|status|run|resume [--allow-spend] [--max-attempts n] [--budget-usd n]");
  process.exitCode = 2;
}

function renderStatus(plan: ReturnType<typeof buildProofloopProdProxyLongRunPlan>): string {
  return [
    `proofloop prod proxy longrun: ${plan.runId}`,
    `attempts: total=${plan.summary.totalAttempts} existing_pass=${plan.summary.passedExistingAttempts} queued=${plan.summary.queuedAttempts} blocked_adapter=${plan.summary.blockedAdapterAttempts} blocked_budget=${plan.summary.blockedBudgetAttempts} failed=${plan.summary.failedAttempts}`,
    `budget: cap=$${plan.budget.capUsd.toFixed(2)} queued_est=$${plan.budget.queuedEstimatedNewSpendUsd.toFixed(4)} full_matrix_est=$${plan.budget.fullMatrixEstimatedUsd.toFixed(4)} runnable_fits=${plan.budget.runnableQueueFitsBudget}`,
    `winner: all_task=${plan.summary.currentAllTaskWinner ?? "none"} adapter_smoke=${plan.summary.currentAdapterSmokeWinner ?? "none"}`,
    `adapter gaps: ${plan.adapterGaps.map((gap) => `${gap.familyId}:${gap.attemptCount}`).join(", ") || "none"}`,
  ].join("\n");
}

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

function numberOption(name: string, fallback: number): number {
  const value = Number(optionValue(name) ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

async function resolveModels(): Promise<string[]> {
  const explicit = models.length ? [...new Set(models)] : [];
  if (!freeOpenRouter) return explicit;
  const free = await selectOpenRouterFreeModels({
    mode: "agent",
    limit: freeModelLimit,
    forceRefresh: true,
  });
  return [...new Set([...explicit, ...free.map((candidate) => candidate.id)])];
}
