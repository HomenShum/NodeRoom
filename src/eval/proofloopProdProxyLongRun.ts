import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildProofloopProdProxyBenchmarkMatrix,
  type ProofloopProdProxyBenchmarkMatrix,
  type ProdProxyModelSummary,
  type ProdProxyTask,
} from "./proofloopProdProxyBenchmarkMatrix";
import {
  adapterSpecForFamily,
  buildProofloopProdBrowserAdapterLedger,
} from "./proofloopProdBrowserAdapters";

export type ProofloopProdProxyLongRunStatus =
  | "passed_existing"
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked_adapter"
  | "blocked_budget";

export type ProofloopProdProxyLongRunAdapterStatus =
  | "prod_browser_available"
  | "missing_generic_browser_adapter"
  | "http_only"
  | "deterministic_only"
  | "local_only";

export type ProofloopProdProxyLongRunAttempt = {
  schema: "proofloop-prod-proxy-longrun-attempt-v1";
  attemptId: string;
  familyId: string;
  taskId: string;
  modelId: string;
  title: string;
  status: ProofloopProdProxyLongRunStatus;
  adapterStatus: ProofloopProdProxyLongRunAdapterStatus;
  realUserProdUiRequired: true;
  memoryModeAllowed: false;
  officialScoreClaim: false;
  estimatedCostUsd: number;
  measuredCostUsd?: number;
  command?: {
    shell: string;
    env: Record<string, string>;
  };
  evidence: string[];
  blockers: string[];
  attempts: number;
  lease?: {
    startedAt: string;
    heartbeatAt: string;
    pid: number;
  };
  exitCode?: number;
  completedAt?: string;
};

export type ProofloopProdProxyLongRunAdapterGap = {
  familyId: string;
  taskCount: number;
  attemptCount: number;
  adapterStatus: ProofloopProdProxyLongRunAdapterStatus;
  adapterVersion?: string;
  adapterPlanPath?: string;
  firstBlocker: string;
  requiredAdapter: string;
  evidence: string[];
};

export type ProofloopProdProxyLongRunPlan = {
  schema: "proofloop-prod-proxy-longrun-v1";
  generatedAt: string;
  runId: string;
  baseUrl: string;
  root: string;
  matrixDigest: string;
  budget: {
    capUsd: number;
    unknownAttemptCostUsd: number;
    historicalMeasuredSpendUsd: number;
    queuedEstimatedNewSpendUsd: number;
    fullMatrixEstimatedUsd: number;
    fullCurrentModelMatrixFitsBudget: boolean;
    runnableQueueFitsBudget: boolean;
  };
  controlPlane: {
    goalContract: string;
    evaluator: string;
    verifiers: string[];
    outerLoop: string;
    orchestration: string[];
    observability: string[];
    memory: string[];
  };
  summary: {
    uniqueTaskTargets: number;
    modelCount: number;
    totalAttempts: number;
    passedExistingAttempts: number;
    queuedAttempts: number;
    runningAttempts: number;
    passedAttempts: number;
    failedAttempts: number;
    blockedAdapterAttempts: number;
    blockedBudgetAttempts: number;
    families: number;
    familiesWithQueuedAttempts: number;
    familiesBlockedByAdapter: number;
    currentAllTaskWinner: string | null;
    currentAdapterSmokeWinner: string | null;
  };
  modelCosts: Array<{
    modelId: string;
    prodAdapterSmokePassed: number;
    prodAdapterSmokeTotal: number;
    costBasis: "measured_and_estimated_smoke" | "estimated_smoke" | "unknown_fallback";
    estimatedCostPerAttemptUsd: number;
    fullMatrixEstimatedUsd: number;
    runnableQueueEstimatedUsd: number;
    historicalMeasuredSpendUsd: number;
  }>;
  adapterGaps: ProofloopProdProxyLongRunAdapterGap[];
  attempts: ProofloopProdProxyLongRunAttempt[];
};

type ProxyModelSweep = {
  rows?: Array<{
    modelId?: string;
    adapterId?: string;
    status?: "passed" | "failed";
    roomUrl?: string;
    measuredCostUsd?: number | null;
    estimatedCostUsdAtOpenRouterList?: number | null;
    durationMs?: number | null;
    runId?: string;
  }>;
};

export type BuildProofloopProdProxyLongRunPlanArgs = {
  root?: string;
  generatedAt?: string;
  runId?: string;
  baseUrl?: string;
  models?: string[];
  budgetUsd?: number;
  unknownAttemptCostUsd?: number;
};

export type WriteProofloopProdProxyLongRunArtifactsArgs = {
  root?: string;
  plan: ProofloopProdProxyLongRunPlan;
  stateOut?: string;
  queueOut?: string;
  dashboardOut?: string;
  budgetOut?: string;
  gapsOut?: string;
  jsonOut?: string;
  mdOut?: string;
};

export type ExecuteProofloopProdProxyLongRunArgs = {
  root?: string;
  plan: ProofloopProdProxyLongRunPlan;
  maxAttempts?: number;
  allowSpend?: boolean;
  execute?: boolean;
};

export type ProofloopProdProxyLongRunExecutionResult = {
  plan: ProofloopProdProxyLongRunPlan;
  attempted: number;
  passed: number;
  failed: number;
  skipped: number;
  estimatedNewSpendUsd: number;
};

const DEFAULT_BUDGET_USD = 100;
const DEFAULT_UNKNOWN_ATTEMPT_COST_USD = 0.02;
const LONGRUN_ROOT = ".proofloop/prod-proxy-longrun";

export function buildProofloopProdProxyLongRunPlan(
  args: BuildProofloopProdProxyLongRunPlanArgs = {},
): ProofloopProdProxyLongRunPlan {
  const root = resolve(args.root ?? process.cwd());
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const runId = args.runId ?? `prod-proxy-longrun-${generatedAt.replace(/[:.]/g, "-")}`;
  const baseUrl = args.baseUrl ?? "https://noderoom.live";
  const budgetUsd = args.budgetUsd ?? DEFAULT_BUDGET_USD;
  const unknownAttemptCostUsd = args.unknownAttemptCostUsd ?? DEFAULT_UNKNOWN_ATTEMPT_COST_USD;
  const matrix = buildProofloopProdProxyBenchmarkMatrix({
    root,
    generatedAt,
    baseUrl,
    models: args.models,
  });
  const adapterLedger = buildProofloopProdBrowserAdapterLedger({
    root,
    generatedAt,
    models: matrix.models,
  });
  const sweep = readJson<ProxyModelSweep>(root, "docs/eval/proofloop-proxy-model-sweep.json");
  const modelCostMap = buildModelCostMap(matrix, unknownAttemptCostUsd);
  const existingPasses = buildExistingPassMap(sweep);
  const attempts = matrix.families.flatMap((family) =>
    family.tasks.flatMap((task) =>
      matrix.models.map((modelId) =>
        buildAttempt({
          runId,
          baseUrl,
          task,
          modelId,
          estimatedCostUsd: modelCostMap.get(modelId)?.estimatedCostPerAttemptUsd ?? unknownAttemptCostUsd,
          existingPass: existingPasses.get(existingPassKey(task.familyId, modelId)),
        }),
      ),
    ),
  );

  applyBudgetGate(attempts, budgetUsd);

  const adapterGaps = buildAdapterGaps(matrix, attempts, adapterLedger);
  const historicalMeasuredSpendUsd = roundMoney(
    attempts
      .filter((attempt) => attempt.status === "passed_existing")
      .reduce((sum, attempt) => sum + (attempt.measuredCostUsd ?? 0), 0),
  );
  const queuedEstimatedNewSpendUsd = roundMoney(
    attempts
      .filter((attempt) => attempt.status === "queued")
      .reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0),
  );
  const fullMatrixEstimatedUsd = roundMoney(attempts.reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0));
  const modelCosts = matrix.modelSummaries.map((summary) => {
    const cost = modelCostMap.get(summary.modelId);
    const estimatedCostPerAttemptUsd = cost?.estimatedCostPerAttemptUsd ?? unknownAttemptCostUsd;
    return {
      modelId: summary.modelId,
      prodAdapterSmokePassed: summary.prodAdapterSmokePassed,
      prodAdapterSmokeTotal: summary.prodAdapterSmokeTotal,
      costBasis: cost?.costBasis ?? "unknown_fallback" as const,
      estimatedCostPerAttemptUsd,
      fullMatrixEstimatedUsd: roundMoney(estimatedCostPerAttemptUsd * matrix.summary.uniqueTaskTargets),
      runnableQueueEstimatedUsd: roundMoney(
        attempts
          .filter((attempt) => attempt.modelId === summary.modelId && attempt.status === "queued")
          .reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0),
      ),
      historicalMeasuredSpendUsd: roundMoney(
        attempts
          .filter((attempt) => attempt.modelId === summary.modelId && attempt.status === "passed_existing")
          .reduce((sum, attempt) => sum + (attempt.measuredCostUsd ?? 0), 0),
      ),
    };
  });

  return {
    schema: "proofloop-prod-proxy-longrun-v1",
    generatedAt,
    runId,
    baseUrl,
    root,
    matrixDigest: digestJson(matrix),
    budget: {
      capUsd: budgetUsd,
      unknownAttemptCostUsd,
      historicalMeasuredSpendUsd,
      queuedEstimatedNewSpendUsd,
      fullMatrixEstimatedUsd,
      fullCurrentModelMatrixFitsBudget: fullMatrixEstimatedUsd <= budgetUsd,
      runnableQueueFitsBudget: queuedEstimatedNewSpendUsd <= budgetUsd,
    },
    controlPlane: {
      goalContract: "Run every tracked prod proxy benchmark task through the live NodeRoom browser UI with memory mode off, score each model-task attempt, and refuse an all-task winner until the full matrix is proven.",
      evaluator: "Detached verifier receipts and scorecards decide pass/fail; model output or agent narration is not accepted as proof.",
      verifiers: [
        "real prod URL must be https://noderoom.live",
        "memoryModeAllowed=false for every attempt",
        "browser evidence must include trace/cost/verifier receipts before a pass is promoted",
        "official score claims stay false unless upstream scorer/judge artifacts are imported",
      ],
      outerLoop: [
        "state is persisted under .proofloop/prod-proxy-longrun/<runId>",
        "running attempts carry a lease and can be resumed after process/network failure",
        "budget checks run before every live attempt",
      ].join("; "),
      orchestration: [
        "cheap models are sorted first inside each runnable family",
        "expensive or unknown-cost attempts are deferred when they would exceed the budget cap",
        "blocked adapter families remain visible instead of being dropped from the denominator",
      ],
      observability: [
        "state.json",
        "queue.jsonl",
        "events.jsonl",
        "dashboard.json",
        "budget-ledger.json",
        "adapter-gaps.json",
      ],
      memory: [
        "session memory is local-only under .proofloop/prod-proxy-longrun",
        "durable lessons must be promoted separately; generated memory stores are not committed",
      ],
    },
    summary: summarizeAttempts(matrix, attempts, adapterGaps),
    modelCosts,
    adapterGaps,
    attempts,
  };
}

export function writeProofloopProdProxyLongRunArtifacts(
  args: WriteProofloopProdProxyLongRunArtifactsArgs,
): void {
  const root = resolve(args.root ?? args.plan.root ?? process.cwd());
  const runRoot = join(LONGRUN_ROOT, args.plan.runId);
  const stateOut = args.stateOut ?? join(runRoot, "state.json");
  const queueOut = args.queueOut ?? join(runRoot, "queue.jsonl");
  const dashboardOut = args.dashboardOut ?? join(runRoot, "dashboard.json");
  const budgetOut = args.budgetOut ?? join(runRoot, "budget-ledger.json");
  const gapsOut = args.gapsOut ?? join(runRoot, "adapter-gaps.json");
  writeJson(root, stateOut, args.plan);
  writeText(root, queueOut, `${args.plan.attempts.map((attempt) => JSON.stringify(attempt)).join("\n")}\n`);
  writeJson(root, dashboardOut, buildDashboard(args.plan));
  writeJson(root, budgetOut, args.plan.budget);
  writeJson(root, gapsOut, args.plan.adapterGaps);
  if (args.jsonOut) writeJson(root, args.jsonOut, publicLongRunPlan(args.plan));
  if (args.mdOut) writeText(root, args.mdOut, renderProofloopProdProxyLongRunMarkdown(args.plan));
}

export function executeProofloopProdProxyLongRun(
  args: ExecuteProofloopProdProxyLongRunArgs,
): ProofloopProdProxyLongRunExecutionResult {
  const root = resolve(args.root ?? args.plan.root ?? process.cwd());
  const runRoot = join(LONGRUN_ROOT, args.plan.runId);
  const eventsPath = join(runRoot, "events.jsonl");
  const maxAttempts = args.maxAttempts ?? 0;
  const executable = args.plan.attempts.filter((attempt) => attempt.status === "queued");
  if (!args.execute || !args.allowSpend || maxAttempts <= 0) {
    appendEvent(root, eventsPath, {
      event: "execution_skipped",
      reason: !args.execute ? "execute flag not set" : !args.allowSpend ? "allowSpend flag not set" : "maxAttempts is 0",
      generatedAt: new Date().toISOString(),
      queuedAttempts: executable.length,
    });
    return {
      plan: args.plan,
      attempted: 0,
      passed: 0,
      failed: 0,
      skipped: executable.length,
      estimatedNewSpendUsd: 0,
    };
  }

  let attempted = 0;
  let passed = 0;
  let failed = 0;
  let estimatedNewSpendUsd = 0;
  for (const attempt of executable.slice(0, maxAttempts)) {
    if (!attempt.command) continue;
    attempted += 1;
    estimatedNewSpendUsd = roundMoney(estimatedNewSpendUsd + attempt.estimatedCostUsd);
    attempt.status = "running";
    attempt.attempts += 1;
    attempt.lease = {
      startedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      pid: process.pid,
    };
    appendEvent(root, eventsPath, {
      event: "attempt_started",
      attemptId: attempt.attemptId,
      command: attempt.command.shell,
      generatedAt: attempt.lease.startedAt,
    });
    writeProofloopProdProxyLongRunArtifacts({ root, plan: args.plan });

    const result = spawnSync(attempt.command.shell, {
      cwd: root,
      env: { ...process.env, ...attempt.command.env },
      shell: true,
      stdio: "inherit",
    });
    attempt.exitCode = result.status ?? 1;
    attempt.completedAt = new Date().toISOString();
    attempt.lease = undefined;
    if (attempt.exitCode === 0) {
      attempt.status = "passed";
      passed += 1;
    } else {
      attempt.status = "failed";
      failed += 1;
      attempt.blockers = uniqueStrings([...attempt.blockers, `Live command exited ${attempt.exitCode}`]);
    }
    appendEvent(root, eventsPath, {
      event: "attempt_completed",
      attemptId: attempt.attemptId,
      status: attempt.status,
      exitCode: attempt.exitCode,
      generatedAt: attempt.completedAt,
    });
    writeProofloopProdProxyLongRunArtifacts({ root, plan: args.plan });
  }

  args.plan.summary = summarizeAttemptsFromPlan(args.plan);
  writeProofloopProdProxyLongRunArtifacts({ root, plan: args.plan });
  return {
    plan: args.plan,
    attempted,
    passed,
    failed,
    skipped: Math.max(0, executable.length - attempted),
    estimatedNewSpendUsd,
  };
}

export function loadLatestProofloopProdProxyLongRunPlan(root = process.cwd()): ProofloopProdProxyLongRunPlan | undefined {
  const absoluteRoot = resolve(root);
  const dir = join(absoluteRoot, LONGRUN_ROOT);
  if (!existsSync(dir)) return undefined;
  const latest = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(LONGRUN_ROOT, entry.name, "state.json"))
    .filter((path) => existsSync(join(absoluteRoot, path)))
    .sort()
    .at(-1);
  return latest ? readJson<ProofloopProdProxyLongRunPlan>(absoluteRoot, latest) : undefined;
}

export function loadProofloopProdProxyLongRunPlanByRunId(
  runId: string,
  root = process.cwd(),
): ProofloopProdProxyLongRunPlan | undefined {
  if (!runId || runId.includes("/") || runId.includes("\\") || runId.includes("..")) return undefined;
  const absoluteRoot = resolve(root);
  const path = join(LONGRUN_ROOT, runId, "state.json");
  if (!existsSync(join(absoluteRoot, path))) return undefined;
  return readJson<ProofloopProdProxyLongRunPlan>(absoluteRoot, path);
}

export function renderProofloopProdProxyLongRunMarkdown(plan: ProofloopProdProxyLongRunPlan): string {
  const lines = [
    "# ProofLoop Prod Proxy Long-Run Plan",
    "",
    `Generated: ${plan.generatedAt}`,
    `Run ID: \`${plan.runId}\``,
    `Base URL: ${plan.baseUrl}`,
    "",
    "This is the durable attempt queue for the full prod-browser proxy benchmark matrix. It tracks model-task attempts, not only task families, and it keeps blocked adapters in the denominator.",
    "",
    "## Summary",
    "",
    `- Unique task targets: ${plan.summary.uniqueTaskTargets}`,
    `- Models: ${plan.summary.modelCount}`,
    `- Model-task attempts: ${plan.summary.totalAttempts}`,
    `- Existing prod browser attempt passes: ${plan.summary.passedExistingAttempts}`,
    `- Queued runnable attempts: ${plan.summary.queuedAttempts}`,
    `- Blocked by missing browser adapters: ${plan.summary.blockedAdapterAttempts}`,
    `- Blocked by budget: ${plan.summary.blockedBudgetAttempts}`,
    `- Failed attempts: ${plan.summary.failedAttempts}`,
    `- All-task winner: ${plan.summary.currentAllTaskWinner ?? "none"}`,
    `- Current adapter-smoke winner: ${plan.summary.currentAdapterSmokeWinner ?? "none"}`,
    "",
    "## Budget",
    "",
    `- Budget cap: ${money(plan.budget.capUsd)}`,
    `- Historical measured spend already recorded: ${money(plan.budget.historicalMeasuredSpendUsd)}`,
    `- Queued new spend estimate: ${money(plan.budget.queuedEstimatedNewSpendUsd)}`,
    `- Full current-model matrix estimate if every adapter existed: ${money(plan.budget.fullMatrixEstimatedUsd)}`,
    `- Runnable queue fits budget: ${plan.budget.runnableQueueFitsBudget ? "yes" : "no"}`,
    `- Full current-model matrix fits budget: ${plan.budget.fullCurrentModelMatrixFitsBudget ? "yes" : "no"}`,
    "",
    "## Model Costs",
    "",
    "| Model | Smoke pass | Est. cost / attempt | Runnable queue est. | Full matrix est. | Basis |",
    "|---|---:|---:|---:|---:|---|",
    ...plan.modelCosts.map((model) =>
      `| \`${model.modelId}\` | ${model.prodAdapterSmokePassed}/${model.prodAdapterSmokeTotal} | ${money(model.estimatedCostPerAttemptUsd)} | ${money(model.runnableQueueEstimatedUsd)} | ${money(model.fullMatrixEstimatedUsd)} | ${model.costBasis} |`,
    ),
    "",
    "## Adapter Gaps",
    "",
    "| Family | Tasks | Attempts | Adapter status | Adapter version | Required adapter | First blocker |",
    "|---|---:|---:|---|---:|---|---|",
    ...plan.adapterGaps.map((gap) =>
      `| \`${gap.familyId}\` | ${gap.taskCount} | ${gap.attemptCount} | ${gap.adapterStatus} | ${gap.adapterVersion ?? "n/a"} | ${gap.requiredAdapter} | ${gap.firstBlocker} |`,
    ),
    "",
    ...(plan.summary.failedAttempts > 0 ? [
      "## Failed Attempts",
      "",
      "| Attempt | Family | Task | Model | Exit | First blocker |",
      "|---|---|---|---|---:|---|",
      ...plan.attempts
        .filter((attempt) => attempt.status === "failed")
        .slice(0, 20)
        .map((attempt) =>
          `| \`${attempt.attemptId}\` | \`${attempt.familyId}\` | \`${attempt.taskId}\` | \`${attempt.modelId}\` | ${attempt.exitCode ?? "n/a"} | ${attempt.blockers.at(-1) ?? "unknown"} |`,
        ),
      "",
    ] : []),
    "## Commands",
    "",
    "- Plan without spend: `npm run benchmark:proofloop:prod-proxy-longrun -- plan`",
    "- Resume/status: `npm run benchmark:proofloop:prod-proxy-longrun -- status`",
    "- Execute guarded live attempts: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd 100 --max-attempts <n>`",
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function buildAttempt(args: {
  runId: string;
  baseUrl: string;
  task: ProdProxyTask;
  modelId: string;
  estimatedCostUsd: number;
  existingPass?: ExistingProxyPass;
}): ProofloopProdProxyLongRunAttempt {
  const adapterStatus = adapterStatusForTask(args.task);
  const attemptId = stableAttemptId(args.task.familyId, args.task.taskId, args.modelId);
  const existingPass = args.existingPass;
  const status: ProofloopProdProxyLongRunStatus = existingPass
    ? "passed_existing"
    : args.task.runner.available
      ? "queued"
      : "blocked_adapter";
  const command = status === "queued"
    ? commandForTask({
      runId: args.runId,
      baseUrl: args.baseUrl,
      task: args.task,
      modelId: args.modelId,
      attemptId,
    })
    : undefined;
  return {
    schema: "proofloop-prod-proxy-longrun-attempt-v1",
    attemptId,
    familyId: args.task.familyId,
    taskId: args.task.taskId,
    modelId: args.modelId,
    title: args.task.title,
    status,
    adapterStatus,
    realUserProdUiRequired: true,
    memoryModeAllowed: false,
    officialScoreClaim: false,
    estimatedCostUsd: args.estimatedCostUsd,
    ...(existingPass?.measuredCostUsd !== undefined ? { measuredCostUsd: existingPass.measuredCostUsd } : {}),
    ...(command ? { command } : {}),
    evidence: uniqueStrings([
      ...args.task.evidence,
      ...(existingPass?.evidence ?? []),
    ]),
    blockers: status === "blocked_adapter"
      ? uniqueStrings([
        ...args.task.blockers,
        missingAdapterMessage(args.task),
      ])
      : status === "queued"
        ? args.task.blockers
        : [],
    attempts: 0,
  };
}

function commandForTask(args: {
  runId: string;
  baseUrl: string;
  task: ProdProxyTask;
  modelId: string;
  attemptId: string;
}): ProofloopProdProxyLongRunAttempt["command"] | undefined {
  const receiptDir = join(LONGRUN_ROOT, args.runId, "receipts").replace(/\\/g, "/");
  const baseEnv = {
    BENCH_BASE_URL: args.baseUrl,
    PLAYWRIGHT_BASE_URL: args.baseUrl,
    PLAYWRIGHT_REUSE_SERVER: "1",
    PLAYWRIGHT_RETRIES: "0",
    PLAYWRIGHT_OUTPUT_DIR: join(receiptDir, "playwright", args.attemptId).replace(/\\/g, "/"),
    BENCH_AGENT_MODEL_MODE: "specific",
    BENCH_AGENT_MODEL_POLICY: args.modelId,
    PROOFLOOP_REAL_USER_MODE: "1",
    PROOFLOOP_FOCUS_MODE: "0",
    PROOFLOOP_NODEAGENT_RUNTIME_PROFILE: "",
    PROOFLOOP_RUN_ID: `${args.runId}-${args.attemptId}`,
    PROOFLOOP_CASE_ID: args.attemptId,
    PROOFLOOP_FRESH_ROOM_ROOT: join(receiptDir, "fresh-room").replace(/\\/g, "/"),
    PROOFLOOP_SUITE_PROOF_PATH: join(receiptDir, `${args.attemptId}.json`).replace(/\\/g, "/"),
  };

  const externalAdapterId = externalAdapterIdFromFamily(args.task.familyId);
  if (externalAdapterId) {
    return {
      shell: `npm run benchmark:proofloop:external-adapter-live-room -- --prod --id ${externalAdapterId} --real-user --model ${quoteShell(args.modelId)} --model-mode specific --json-out-dir ${quoteShell(receiptDir)}`,
      env: baseEnv,
    };
  }

  if (args.task.familyId === "bankertoolbench-full-100") {
    return {
      shell: "npm run proofloop:live:btb",
      env: {
        ...baseEnv,
        BTB_LIVE_ROOM_E2E: "1",
        BTB_UI_BUNDLE_ROOT: args.task.runner.env?.BTB_UI_BUNDLE_ROOT ?? ".tmp/official-benchmarks/btb-fixture",
        BTB_UI_TASK_ID: args.task.taskId,
        BTB_UI_VERIFIER_COMMAND: "npm run benchmark:bankertoolbench:proof",
        BTB_LIVE_ROOM_PROOF_PATH: join(receiptDir, `${args.attemptId}.json`).replace(/\\/g, "/"),
      },
    };
  }

  if (args.task.familyId === "spreadsheetbench-v1-full-912" || args.task.familyId === "spreadsheetbench-v2-full-321") {
    const track = args.task.familyId === "spreadsheetbench-v1-full-912" ? "spreadsheetbench-v1" : "spreadsheetbench-v2";
    const stageRoot = args.task.runner.env?.SPREADSHEETBENCH_STAGE_ROOT
      ?? (track === "spreadsheetbench-v1" ? ".tmp/official-benchmarks/staged-v1-912" : ".tmp/official-benchmarks/staged-v2-full");
    return {
      shell: args.task.runner.command ?? `npm run proofloop:live:${track}`,
      env: {
        ...baseEnv,
        SPREADSHEETBENCH_TRACK: track,
        SPREADSHEETBENCH_STAGE_ROOT: stageRoot,
        SPREADSHEETBENCH_TASK_ID: args.task.taskId,
        SPREADSHEETBENCH_LIVE_PROOF_PATH: join(receiptDir, `${args.attemptId}.json`).replace(/\\/g, "/"),
      },
    };
  }

  if (!args.task.runner.command) return undefined;
  return {
    shell: args.task.runner.command,
    env: {
      ...baseEnv,
      ...(args.task.runner.env ?? {}),
    },
  };
}

function buildModelCostMap(
  matrix: ProofloopProdProxyBenchmarkMatrix,
  unknownAttemptCostUsd: number,
): Map<string, { costBasis: ProofloopProdProxyLongRunPlan["modelCosts"][number]["costBasis"]; estimatedCostPerAttemptUsd: number }> {
  const map = new Map<string, { costBasis: ProofloopProdProxyLongRunPlan["modelCosts"][number]["costBasis"]; estimatedCostPerAttemptUsd: number }>();
  for (const model of matrix.modelSummaries) {
    if (isFreeOpenRouterModelId(model.modelId)) {
      map.set(model.modelId, {
        costBasis: "estimated_smoke",
        estimatedCostPerAttemptUsd: 0,
      });
      continue;
    }
    const smokeTotal = Math.max(0, model.prodAdapterSmokeTotal);
    const conservativeTotal = conservativeCostTotal(model);
    if (smokeTotal > 0 && conservativeTotal != null) {
      map.set(model.modelId, {
        costBasis: model.measuredCostUsd != null ? "measured_and_estimated_smoke" : "estimated_smoke",
        estimatedCostPerAttemptUsd: roundMoney(conservativeTotal / smokeTotal),
      });
    } else {
      map.set(model.modelId, {
        costBasis: "unknown_fallback",
        estimatedCostPerAttemptUsd: unknownAttemptCostUsd,
      });
    }
  }
  return map;
}

function conservativeCostTotal(model: ProdProxyModelSummary): number | null {
  const candidates = [model.measuredCostUsd, model.estimatedCostUsdAtOpenRouterList]
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return candidates.length ? Math.max(...candidates) : null;
}

type ExistingProxyPass = {
  measuredCostUsd?: number;
  evidence: string[];
};

function buildExistingPassMap(sweep: ProxyModelSweep | undefined): Map<string, ExistingProxyPass> {
  const map = new Map<string, ExistingProxyPass>();
  for (const row of sweep?.rows ?? []) {
    if (row.status !== "passed" || !isProdUrl(row.roomUrl) || !row.adapterId || !row.modelId) continue;
    map.set(`${row.adapterId}:${row.modelId}`, {
      ...(typeof row.measuredCostUsd === "number" ? { measuredCostUsd: row.measuredCostUsd } : {}),
      evidence: uniqueStrings([
        "docs/eval/proofloop-proxy-model-sweep.json",
        ...(row.runId ? [`docs/eval/proofloop-proxy-model-sweep-runs/proxy-model-sweep-2026-07-04-live/${sanitizePathPart(row.modelId)}/${row.adapterId}.json`] : []),
        ...(row.roomUrl ? [row.roomUrl] : []),
      ]),
    });
  }
  return map;
}

function existingPassKey(familyId: string, modelId: string): string {
  const adapterId = externalAdapterIdFromFamily(familyId);
  return adapterId ? `${adapterId}:${modelId}` : `${familyId}:${modelId}`;
}

function applyBudgetGate(attempts: ProofloopProdProxyLongRunAttempt[], budgetUsd: number): void {
  let plannedSpend = 0;
  const queued = attempts
    .filter((attempt) => attempt.status === "queued")
    .sort((a, b) =>
      a.estimatedCostUsd - b.estimatedCostUsd ||
      a.familyId.localeCompare(b.familyId) ||
      a.taskId.localeCompare(b.taskId) ||
      a.modelId.localeCompare(b.modelId)
    );
  for (const attempt of queued) {
    if (plannedSpend + attempt.estimatedCostUsd > budgetUsd) {
      attempt.status = "blocked_budget";
      attempt.blockers = uniqueStrings([
        ...attempt.blockers,
        `Attempt deferred because estimated spend would exceed budget cap ${money(budgetUsd)}.`,
      ]);
      delete attempt.command;
    } else {
      plannedSpend = roundMoney(plannedSpend + attempt.estimatedCostUsd);
    }
  }
}

function buildAdapterGaps(
  matrix: ProofloopProdProxyBenchmarkMatrix,
  attempts: ProofloopProdProxyLongRunAttempt[],
  adapterLedger: ReturnType<typeof buildProofloopProdBrowserAdapterLedger>,
): ProofloopProdProxyLongRunAdapterGap[] {
  return matrix.families
    .map((family) => {
      const familyAttempts = attempts.filter((attempt) => attempt.familyId === family.id);
      const blocked = familyAttempts.filter((attempt) => attempt.status === "blocked_adapter");
      if (!blocked.length) return undefined;
      const first = blocked[0];
      const adapter = adapterSpecForFamily(adapterLedger, family.id);
      return {
        familyId: family.id,
        taskCount: family.taskCount,
        attemptCount: blocked.length,
        adapterStatus: first.adapterStatus,
        ...(adapter ? {
          adapterVersion: adapter.version,
          adapterPlanPath: "docs/eval/proofloop-prod-browser-adapters.json",
        } : {}),
        firstBlocker: first.blockers[0] ?? "Missing prod browser adapter.",
        requiredAdapter: adapter?.id ?? requiredAdapterForFamily(family.id),
        evidence: uniqueStrings([
          ...(adapter ? ["docs/eval/proofloop-prod-browser-adapters.json"] : []),
          ...family.tasks.flatMap((task) => task.evidence).slice(0, 8),
        ]),
      };
    })
    .filter((gap): gap is ProofloopProdProxyLongRunAdapterGap => !!gap);
}

function summarizeAttempts(
  matrix: ProofloopProdProxyBenchmarkMatrix,
  attempts: ProofloopProdProxyLongRunAttempt[],
  adapterGaps: ProofloopProdProxyLongRunAdapterGap[],
): ProofloopProdProxyLongRunPlan["summary"] {
  const base = summarizeAttemptsOnly(attempts);
  return {
    ...base,
    uniqueTaskTargets: matrix.summary.uniqueTaskTargets,
    modelCount: matrix.summary.modelCount,
    families: matrix.families.length,
    familiesWithQueuedAttempts: new Set(attempts.filter((attempt) => attempt.status === "queued").map((attempt) => attempt.familyId)).size,
    familiesBlockedByAdapter: adapterGaps.length,
    currentAllTaskWinner: matrix.recommendation.allTaskWinner,
    currentAdapterSmokeWinner: matrix.recommendation.currentProdAdapterSmokeWinner,
  };
}

function summarizeAttemptsFromPlan(plan: ProofloopProdProxyLongRunPlan): ProofloopProdProxyLongRunPlan["summary"] {
  const base = summarizeAttemptsOnly(plan.attempts);
  return {
    ...base,
    uniqueTaskTargets: plan.summary.uniqueTaskTargets,
    modelCount: plan.summary.modelCount,
    families: plan.summary.families,
    familiesWithQueuedAttempts: new Set(plan.attempts.filter((attempt) => attempt.status === "queued").map((attempt) => attempt.familyId)).size,
    familiesBlockedByAdapter: plan.adapterGaps.length,
    currentAllTaskWinner: plan.summary.currentAllTaskWinner,
    currentAdapterSmokeWinner: plan.summary.currentAdapterSmokeWinner,
  };
}

function summarizeAttemptsOnly(attempts: ProofloopProdProxyLongRunAttempt[]): Omit<
  ProofloopProdProxyLongRunPlan["summary"],
  "uniqueTaskTargets" | "modelCount" | "families" | "familiesWithQueuedAttempts" | "familiesBlockedByAdapter" | "currentAllTaskWinner" | "currentAdapterSmokeWinner"
> {
  return {
    totalAttempts: attempts.length,
    passedExistingAttempts: attempts.filter((attempt) => attempt.status === "passed_existing").length,
    queuedAttempts: attempts.filter((attempt) => attempt.status === "queued").length,
    runningAttempts: attempts.filter((attempt) => attempt.status === "running").length,
    passedAttempts: attempts.filter((attempt) => attempt.status === "passed").length,
    failedAttempts: attempts.filter((attempt) => attempt.status === "failed").length,
    blockedAdapterAttempts: attempts.filter((attempt) => attempt.status === "blocked_adapter").length,
    blockedBudgetAttempts: attempts.filter((attempt) => attempt.status === "blocked_budget").length,
  };
}

function buildDashboard(plan: ProofloopProdProxyLongRunPlan): Record<string, unknown> {
  return {
    schema: "proofloop-prod-proxy-longrun-dashboard-v1",
    generatedAt: new Date().toISOString(),
    runId: plan.runId,
    baseUrl: plan.baseUrl,
    summary: plan.summary,
    budget: plan.budget,
    modelCosts: plan.modelCosts,
    adapterGaps: plan.adapterGaps.map((gap) => ({
      familyId: gap.familyId,
      taskCount: gap.taskCount,
      attemptCount: gap.attemptCount,
      adapterStatus: gap.adapterStatus,
      firstBlocker: gap.firstBlocker,
    })),
  };
}

function publicLongRunPlan(plan: ProofloopProdProxyLongRunPlan): Omit<ProofloopProdProxyLongRunPlan, "attempts"> & {
  attemptsOmitted: {
    reason: string;
    localStatePath: string;
    queuePath: string;
    totalAttempts: number;
    sample: ProofloopProdProxyLongRunAttempt[];
  };
} {
  const { attempts, ...rest } = plan;
  return {
    ...rest,
    attemptsOmitted: {
      reason: "Tracked docs/eval JSON omits the full attempt queue; durable resumable state is written under .proofloop/prod-proxy-longrun/.",
      localStatePath: `${LONGRUN_ROOT}/${plan.runId}/state.json`,
      queuePath: `${LONGRUN_ROOT}/${plan.runId}/queue.jsonl`,
      totalAttempts: attempts.length,
      sample: [
        ...attempts.filter((attempt) => attempt.status === "failed").slice(0, 4),
        ...attempts.filter((attempt) => attempt.status === "queued").slice(0, 2),
        ...attempts.filter((attempt) => attempt.status === "blocked_adapter").slice(0, 2),
        ...attempts.filter((attempt) => attempt.status === "passed_existing").slice(0, 2),
      ],
    },
  };
}

function adapterStatusForTask(task: ProdProxyTask): ProofloopProdProxyLongRunAdapterStatus {
  if (task.runner.available) return "prod_browser_available";
  if (task.localLiveBrowserOnly) return "local_only";
  if (task.familyId.includes("accounting") || task.familyId.includes("notion")) return "http_only";
  if (task.familyId.includes("proximitty")) return "deterministic_only";
  return "missing_generic_browser_adapter";
}

function missingAdapterMessage(task: ProdProxyTask): string {
  if (task.familyId.startsWith("spreadsheetbench-v1")) {
    return "Implement generic SpreadsheetBench V1 workbook upload -> NodeAgent edit -> export -> official scorer browser adapter.";
  }
  if (task.familyId.startsWith("spreadsheetbench-v2")) {
    return "Implement generic SpreadsheetBench V2 bundle upload -> workflow execution -> workbook/chart scorer browser adapter.";
  }
  if (task.familyId.includes("accounting")) {
    return "Promote the accounting HTTP proof-loop into a normal prod browser room flow with model selection and memory mode off.";
  }
  if (task.familyId.includes("notion")) {
    return "Promote the Notion HTTP proof-loop into a normal prod browser room flow with model selection and memory mode off.";
  }
  if (task.familyId.includes("proximitty")) {
    return "Promote Proximitty deterministic scenarios into a prod browser underwriting memo workflow with model selection and receipts.";
  }
  if (task.familyId.includes("multi-user")) {
    return "Promote internal multi-user conflict fixtures into prod browser real-user coordination tasks.";
  }
  return "Implement a generic prod browser adapter for this benchmark family.";
}

function requiredAdapterForFamily(familyId: string): string {
  if (familyId.startsWith("spreadsheetbench-v1")) return "spreadsheetbench-v1-official-workbook-prod-browser";
  if (familyId.startsWith("spreadsheetbench-v2")) return "spreadsheetbench-v2-workflow-chart-prod-browser";
  if (familyId.includes("accounting")) return "accounting-live-config-to-prod-browser-room";
  if (familyId.includes("notion")) return "notion-live-config-to-prod-browser-room";
  if (familyId.includes("proximitty")) return "proximitty-underwriting-prod-browser-room";
  if (familyId.includes("multi-user")) return "noderoom-multi-user-conflict-prod-browser-room";
  return `${familyId}-prod-browser-adapter`;
}

function isFreeOpenRouterModelId(modelId: string): boolean {
  const normalized = modelId.toLowerCase().trim();
  return normalized === "openrouter/free-auto" || normalized === "openrouter/free" || normalized.endsWith(":free");
}

function externalAdapterIdFromFamily(familyId: string): string | undefined {
  const match = /^(finch|finauditing|workstreambench)-prod-proxy-task$/.exec(familyId);
  return match?.[1];
}

function stableAttemptId(familyId: string, taskId: string, modelId: string): string {
  const readable = `${sanitizePathPart(familyId)}--${sanitizePathPart(taskId)}--${sanitizePathPart(modelId)}`.slice(0, 120);
  const digest = createHash("sha256").update(`${familyId}\n${taskId}\n${modelId}`).digest("hex").slice(0, 10);
  return `${readable}--${digest}`;
}

function sanitizePathPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function digestJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function appendEvent(root: string, path: string, value: Record<string, unknown>): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  appendFileSync(absolute, `${JSON.stringify(value)}\n`, "utf8");
}

function writeJson(root: string, path: string, value: unknown): void {
  writeText(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root: string, path: string, value: string): void {
  const absolute = resolve(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, "utf8");
}

function readJson<T>(root: string, path: string): T | undefined {
  const absolute = resolve(root, path);
  if (!existsSync(absolute)) return undefined;
  try {
    return JSON.parse(readFileSync(absolute, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function isProdUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^https:\/\/noderoom\.live(?:\/|$|\?)/i.test(value);
}

function roundMoney(value: number): number {
  return Number(value.toFixed(6));
}

function money(value: number): string {
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function quoteShell(value: string): string {
  return /[\s"'$]/.test(value) ? JSON.stringify(value) : value;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
