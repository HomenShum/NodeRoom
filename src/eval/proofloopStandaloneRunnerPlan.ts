import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  buildProofloopProdProxyLongRunPlan,
  type ProofloopProdProxyLongRunAdapterGap,
  type ProofloopProdProxyLongRunAttempt,
  type ProofloopProdProxyLongRunPlan,
} from "./proofloopProdProxyLongRun";
import {
  buildExternalAdapterBlockerReceipt,
  externalAdapterIds,
  type ExternalAdapterBlockerReceipt,
} from "./proofloopAdapterBlockers";

export type ProofloopRunnerTaskKind =
  | "capability-headless"
  | "adapter-gap"
  | "guarded-live-run-batch"
  | "official-score-gap";

export type ProofloopRunnerTaskLayer =
  | "capability-headless"
  | "browser-certification"
  | "official-scoring";

export type ProofloopRunnerTaskStatus =
  | "ready"
  | "blocked-external"
  | "guarded-spend";

export type ProofloopRunnerPlanCommand = {
  name: string;
  command: string;
  requiresSpend: boolean;
  writes?: string[];
};

export type ProofloopRunnerPlanTask = {
  id: string;
  command: string;
  estimatedCostUsd: number;
  timeoutMs?: number;
  kind: ProofloopRunnerTaskKind;
  layer: ProofloopRunnerTaskLayer;
  status: ProofloopRunnerTaskStatus;
  title: string;
  familyId?: string;
  adapterId?: string;
  priority: number;
  objective: string;
  prompt: string;
  estimatedProductSpendUsd: number;
  paidModelRequired: boolean;
  counts: {
    taskTargets?: number;
    attempts?: number;
    queuedAttempts?: number;
    blockedAttempts?: number;
  };
  commands: ProofloopRunnerPlanCommand[];
  acceptance: string[];
  evidence: string[];
  blockers: string[];
  metadata?: Record<string, unknown>;
};

export type ProofloopStandaloneRunnerPlan = {
  schema: "proofloop-runner-plan-v1";
  mode: "two-layer-certification-v1";
  generatedAt: string;
  planId: string;
  title: string;
  cwd: string;
  source: {
    sourcePlanSchema: ProofloopProdProxyLongRunPlan["schema"];
    sourceRunId: string;
    sourceMatrixDigest: string;
    longRunStatePath: string;
    longRunQueuePath: string;
    liveModelSweepsExecuted: false;
    localProofloopVendored: false;
  };
  standaloneRunner: {
    package: "proofloop";
    command: string;
    resumeCommand: string;
    budgetUsd: number;
    planPath: string;
  };
  budget: {
    capUsd: number;
    historicalMeasuredSpendUsd: number;
    queuedEstimatedProductSpendUsd: number;
    fullCurrentModelMatrixEstimatedUsd: number;
    runnableQueueFitsBudget: boolean;
    generationCostUsd: 0;
  };
  summary: {
    tasks: number;
    capabilityHeadlessTasks: number;
    browserCertificationTasks: number;
    adapterGapTasks: number;
    guardedLiveRunBatchTasks: number;
    officialScoreGapTasks: number;
    browserRequiredForAllCapabilityTasks: false;
    uniqueTaskTargets: number;
    modelTaskAttempts: number;
    queuedAttempts: number;
    blockedAdapterAttempts: number;
    currentAllTaskWinner: string | null;
    currentAdapterSmokeWinner: string | null;
  };
  resume: {
    regeneratePlanCommand: string;
    runnerCommand: string;
    runnerResumeCommand: string;
    localLongRunStatusCommand: string;
    localLongRunResumeCommand: string;
    docsPath: string;
  };
  verificationCommands: string[];
  tasks: ProofloopRunnerPlanTask[];
};

export type ProofloopRunnerDogfoodReceipt = {
  schema: "proofloop-runner-dogfood-receipt-v1";
  runId: string;
  status: string;
  budgetUsd: number;
  spentEstimatedUsd: number;
  statePath: string;
  ledgerPath: string;
  planDigest?: string;
  updatedAt?: string;
  taskCounts: Record<string, number>;
  resumedInterruptedTaskIds: string[];
};

export type BuildProofloopStandaloneRunnerPlanArgs = {
  root?: string;
  generatedAt?: string;
  planId?: string;
  planPath?: string;
  docsPath?: string;
  baseUrl?: string;
  budgetUsd?: number;
  unknownAttemptCostUsd?: number;
  models?: string[];
};

export type WriteProofloopStandaloneRunnerPlanArtifactsArgs = {
  root?: string;
  plan: ProofloopStandaloneRunnerPlan;
  jsonOut?: string;
  mdOut?: string;
  dogfoodReceipt?: ProofloopRunnerDogfoodReceipt;
};

const DEFAULT_PLAN_PATH = "docs/eval/proofloop-standalone-runner-dogfood-plan.json";
const DEFAULT_DOCS_PATH = "docs/eval/PROOFLOOP_STANDALONE_RUNNER_DOGFOOD.md";
const DEFAULT_BUDGET_USD = 100;
const PROOFLOOP_NPX_RUNNER = "npx --yes github:HomenShum/proofloop";

const CAPABILITY_HEADLESS_TASKS: Array<{
  id: string;
  title: string;
  command: string;
  objective: string;
  timeoutMs: number;
  evidence: string[];
}> = [
  {
    id: "capability.official-readiness-ledger",
    title: "Refresh official benchmark readiness ledger",
    command: "npm run benchmark:official:readiness",
    objective: "Keep official-score blockers explicit without relabeling proxy proof as official benchmark scores.",
    timeoutMs: 120_000,
    evidence: ["docs/eval/official-benchmark-readiness.json"],
  },
  {
    id: "capability.prod-proxy-denominator",
    title: "Refresh full prod proxy task denominator",
    command: "npm run benchmark:proofloop:prod-proxy-matrix",
    objective: "Regenerate the full proxy benchmark matrix so current task targets and all model-task attempts stay in the denominator.",
    timeoutMs: 180_000,
    evidence: ["docs/eval/proofloop-prod-proxy-benchmark-matrix.json"],
  },
  {
    id: "capability.prod-browser-adapters",
    title: "Refresh prod browser adapter ledger",
    command: "npm run benchmark:proofloop:prod-browser-adapters",
    objective: "Verify which benchmark families have runnable prod browser adapters before any live UI certification run.",
    timeoutMs: 180_000,
    evidence: ["docs/eval/proofloop-prod-browser-adapters.json"],
  },
  {
    id: "capability.free-openrouter-longrun-plan",
    title: "Refresh free-model long-run plan",
    command: "npm run benchmark:proofloop:prod-proxy-longrun -- plan --free-openrouter --free-model-limit 4 --budget-usd 0 --json-out docs/eval/proofloop-prod-proxy-longrun-free-plan.json --md-out docs/eval/PROOFLOOP_PROD_PROXY_LONGRUN_FREE.md",
    objective: "Discover current free OpenRouter routes and queue zero-budget capability probes without running broad paid sweeps.",
    timeoutMs: 240_000,
    evidence: [
      "docs/eval/proofloop-prod-proxy-longrun-free-plan.json",
      "docs/eval/PROOFLOOP_PROD_PROXY_LONGRUN_FREE.md",
    ],
  },
  {
    id: "capability.accounting-proofloop",
    title: "Run accounting proofloop harness",
    command: "npm run proofloop:accounting",
    objective: "Verify accounting task capability through the harness without spending live browser resources on every case.",
    timeoutMs: 600_000,
    evidence: [".proofloop/accounting"],
  },
  {
    id: "capability.notion-proofloop",
    title: "Run Notion SDR/BDR proofloop harness",
    command: "npm run proofloop:notion",
    objective: "Verify Notion-style task capability through the harness before browser certification.",
    timeoutMs: 600_000,
    evidence: [".proofloop/notion"],
  },
  {
    id: "capability.multi-user-coordination",
    title: "Run deterministic multi-user coordination proof",
    command: "npm run eval:multiuser-coordination",
    objective: "Verify lock, CAS, no-clobber, and conflict-resolution behavior independently of browser responsiveness checks.",
    timeoutMs: 240_000,
    evidence: ["docs/eval/multi-user-coordination-proof.json"],
  },
];

export function buildProofloopStandaloneRunnerPlan(
  args: BuildProofloopStandaloneRunnerPlanArgs = {},
): ProofloopStandaloneRunnerPlan {
  const root = resolve(args.root ?? process.cwd());
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const planId = args.planId ?? `proofloop-standalone-runner-dogfood-${timestampId(generatedAt)}`;
  const planPath = normalizePath(args.planPath ?? DEFAULT_PLAN_PATH);
  const docsPath = normalizePath(args.docsPath ?? DEFAULT_DOCS_PATH);
  const budgetUsd = args.budgetUsd ?? DEFAULT_BUDGET_USD;
  const sourcePlan = buildProofloopProdProxyLongRunPlan({
    root,
    generatedAt,
    runId: planId,
    baseUrl: args.baseUrl,
    budgetUsd,
    unknownAttemptCostUsd: args.unknownAttemptCostUsd,
    models: args.models,
  });
  const officialScoreGaps = externalAdapterIds()
    .map((id) => buildExternalAdapterBlockerReceipt({ id, root }))
    .filter((receipt) => receipt.status !== "ready")
    .sort((a, b) => a.adapterId.localeCompare(b.adapterId));
  const tasks = [
    ...capabilityHeadlessTasks(),
    ...adapterGapTasks(sourcePlan),
    ...guardedLiveRunBatchTasks(sourcePlan, budgetUsd),
    ...officialScoreGapTasks(officialScoreGaps),
  ].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  const runnerCommand = `${PROOFLOOP_NPX_RUNNER} runner run --plan ${planPath} --budget-usd ${formatBudget(budgetUsd)}`;
  const runnerResumeCommand = `${PROOFLOOP_NPX_RUNNER} runner resume --run-id latest`;

  return {
    schema: "proofloop-runner-plan-v1",
    mode: "two-layer-certification-v1",
    generatedAt,
    planId,
    title: "NodeRoom standalone ProofLoop runner dogfood plan",
    cwd: root,
    source: {
      sourcePlanSchema: sourcePlan.schema,
      sourceRunId: sourcePlan.runId,
      sourceMatrixDigest: sourcePlan.matrixDigest,
      longRunStatePath: `.proofloop/prod-proxy-longrun/${sourcePlan.runId}/state.json`,
      longRunQueuePath: `.proofloop/prod-proxy-longrun/${sourcePlan.runId}/queue.jsonl`,
      liveModelSweepsExecuted: false,
      localProofloopVendored: false,
    },
    standaloneRunner: {
      package: "proofloop",
      command: runnerCommand,
      resumeCommand: runnerResumeCommand,
      budgetUsd,
      planPath,
    },
    budget: {
      capUsd: budgetUsd,
      historicalMeasuredSpendUsd: sourcePlan.budget.historicalMeasuredSpendUsd,
      queuedEstimatedProductSpendUsd: sourcePlan.budget.queuedEstimatedNewSpendUsd,
      fullCurrentModelMatrixEstimatedUsd: sourcePlan.budget.fullMatrixEstimatedUsd,
      runnableQueueFitsBudget: sourcePlan.budget.runnableQueueFitsBudget,
      generationCostUsd: 0,
    },
    summary: {
      tasks: tasks.length,
      capabilityHeadlessTasks: tasks.filter((task) => task.layer === "capability-headless").length,
      browserCertificationTasks: tasks.filter((task) => task.layer === "browser-certification").length,
      adapterGapTasks: tasks.filter((task) => task.kind === "adapter-gap").length,
      guardedLiveRunBatchTasks: tasks.filter((task) => task.kind === "guarded-live-run-batch").length,
      officialScoreGapTasks: tasks.filter((task) => task.kind === "official-score-gap").length,
      browserRequiredForAllCapabilityTasks: false,
      uniqueTaskTargets: sourcePlan.summary.uniqueTaskTargets,
      modelTaskAttempts: sourcePlan.summary.totalAttempts,
      queuedAttempts: sourcePlan.summary.queuedAttempts,
      blockedAdapterAttempts: sourcePlan.summary.blockedAdapterAttempts,
      currentAllTaskWinner: sourcePlan.summary.currentAllTaskWinner,
      currentAdapterSmokeWinner: sourcePlan.summary.currentAdapterSmokeWinner,
    },
    resume: {
      regeneratePlanCommand: `npm run benchmark:proofloop:standalone-runner-plan -- --budget-usd ${formatBudget(budgetUsd)}`,
      runnerCommand,
      runnerResumeCommand,
      localLongRunStatusCommand: "npm run benchmark:proofloop:prod-proxy-longrun -- status",
      localLongRunResumeCommand: `npm run benchmark:proofloop:prod-proxy-longrun -- resume --allow-spend --budget-usd ${formatBudget(budgetUsd)} --max-attempts 1`,
      docsPath,
    },
    verificationCommands: [
      "npm test -- --run tests/proofloopStandaloneRunnerDogfood.test.ts",
      "npm test -- --run tests/proofloopProdProxyLongRun.test.ts tests/proofloopProdProxyBenchmarkMatrix.test.ts tests/proofloopAdapterBlockers.test.ts",
      `npm run benchmark:proofloop:standalone-runner-plan -- --budget-usd ${formatBudget(budgetUsd)} --json-out ${planPath} --md-out ${docsPath}`,
    ],
    tasks,
  };
}

export function renderProofloopStandaloneRunnerPlanMarkdown(
  plan: ProofloopStandaloneRunnerPlan,
  dogfoodReceipt?: ProofloopRunnerDogfoodReceipt,
): string {
  const lines = [
    "# ProofLoop Standalone Runner Dogfood",
    "",
    `Generated: ${plan.generatedAt}`,
    `Plan ID: \`${plan.planId}\``,
    `Schema: \`${plan.schema}\``,
    `Mode: \`${plan.mode}\``,
    "",
    "This file is the NodeRoom handoff for dogfooding the standalone ProofLoop durable runner on the not-done proxy and benchmark work. It keeps the existing prod proxy long-run queue and external adapter blocker receipts, then adds the two-layer split recommended for long-running proof work.",
    "",
    "No paid model sweeps were run to generate this plan. The plan references the standalone package interface and does not vendor ProofLoop into NodeRoom.",
    "",
    "Registry note: until the package release with the two-layer `this-repo --write-runner-plan` path is published, this dogfood plan uses `npx --yes github:HomenShum/proofloop` so the command resolves to the merged main branch.",
    "",
    "## Run Or Resume",
    "",
    `- Generate/refresh plan: \`${plan.resume.regeneratePlanCommand}\``,
    `- Run with standalone runner: \`${plan.resume.runnerCommand}\``,
    `- Resume: rerun \`${plan.resume.runnerResumeCommand}\`; task IDs and evidence paths are stable for this plan file.`,
    `- Local long-run status: \`${plan.resume.localLongRunStatusCommand}\``,
    `- Local guarded live-attempt resume: \`${plan.resume.localLongRunResumeCommand}\``,
    "",
    "## Two-Layer Contract",
    "",
    "- Capability/headless lane runs harnesses, denominator refreshes, readiness ledgers, free-model planning, and deterministic multi-user checks without forcing every benchmark row through the browser.",
    "- Browser/UI certification lane runs the real prod UI with memory mode off and verifier receipts for product responsiveness, room creation/join flows, and representative benchmark adapters.",
    "- Official-scoring lane remains separate: proxy proof cannot be relabeled as an official benchmark score without the upstream scorer or judge contract.",
    `- Browser required for every capability task: ${String(plan.summary.browserRequiredForAllCapabilityTasks)}`,
    "",
    "## Summary",
    "",
    `- Runner tasks: ${plan.summary.tasks}`,
    `- Capability/headless tasks: ${plan.summary.capabilityHeadlessTasks}`,
    `- Browser-certification tasks: ${plan.summary.browserCertificationTasks}`,
    `- Adapter-gap tasks: ${plan.summary.adapterGapTasks}`,
    `- Guarded live-run batch tasks: ${plan.summary.guardedLiveRunBatchTasks}`,
    `- Official-score gap tasks: ${plan.summary.officialScoreGapTasks}`,
    `- Unique task targets: ${plan.summary.uniqueTaskTargets}`,
    `- Model-task attempts: ${plan.summary.modelTaskAttempts}`,
    `- Queued runnable attempts: ${plan.summary.queuedAttempts}`,
    `- Blocked adapter attempts: ${plan.summary.blockedAdapterAttempts}`,
    `- Queued product spend estimate: ${money(plan.budget.queuedEstimatedProductSpendUsd)}`,
    `- Full current-model matrix estimate: ${money(plan.budget.fullCurrentModelMatrixEstimatedUsd)}`,
    `- All-task winner: ${plan.summary.currentAllTaskWinner ?? "none"}`,
    `- Current adapter-smoke winner: ${plan.summary.currentAdapterSmokeWinner ?? "none"}`,
    "",
    ...renderDogfoodReceiptLines(dogfoodReceipt),
    "## Tasks",
    "",
    "| ID | Layer | Kind | Status | Scope | Attempts | Est. product spend |",
    "|---|---|---|---|---|---:|---:|",
    ...plan.tasks.map((task) =>
      `| \`${task.id}\` | ${task.layer} | ${task.kind} | ${task.status} | ${task.familyId ?? task.adapterId ?? "repo"} | ${task.counts.attempts ?? task.counts.queuedAttempts ?? task.counts.blockedAttempts ?? 0} | ${money(task.estimatedProductSpendUsd)} |`,
    ),
    "",
    "## Guardrails",
    "",
    "- Keep certification-loop assets locked; adapter repair work must not weaken verifiers or immutable fixtures.",
    "- Keep memory mode off for prod proxy attempts and require receipt evidence before promoting a pass.",
    "- Do not claim an all-task model winner until every tracked task target has prod live-browser proof.",
    "- Official benchmark scores require imported upstream scorer or judge receipts; proxy receipts are labeled as proxy proof only.",
    "",
  ];
  return lines.join("\n");
}

export function writeProofloopStandaloneRunnerPlanArtifacts(
  args: WriteProofloopStandaloneRunnerPlanArtifactsArgs,
): void {
  const root = resolve(args.root ?? args.plan.cwd ?? process.cwd());
  const jsonOut = normalizePath(args.jsonOut ?? args.plan.standaloneRunner.planPath);
  const mdOut = normalizePath(args.mdOut ?? args.plan.resume.docsPath);
  writeJson(root, jsonOut, args.plan);
  writeText(root, mdOut, renderProofloopStandaloneRunnerPlanMarkdown(args.plan, args.dogfoodReceipt));
}

export function readProofloopRunnerDogfoodReceipt(
  root: string,
  runId: string,
): ProofloopRunnerDogfoodReceipt | undefined {
  const normalizedRunId = slugRunId(runId);
  const statePath = `.proofloop/runner/runs/${normalizedRunId}/state.json`;
  const ledgerPath = `.proofloop/runner/runs/${normalizedRunId}/ledger.jsonl`;
  const absoluteStatePath = resolve(root, statePath);
  if (!existsSync(absoluteStatePath)) return undefined;

  const state = JSON.parse(readFileSync(absoluteStatePath, "utf8")) as {
    runId?: string;
    status?: string;
    budgetUsd?: number;
    spentEstimatedUsd?: number;
    planDigest?: string;
    updatedAt?: string;
    taskStates?: Array<{
      id?: string;
      status?: string;
      attempts?: number;
      error?: string;
    }>;
  };
  const taskStates = Array.isArray(state.taskStates) ? state.taskStates : [];
  return {
    schema: "proofloop-runner-dogfood-receipt-v1",
    runId: state.runId ?? normalizedRunId,
    status: state.status ?? "unknown",
    budgetUsd: finiteNumber(state.budgetUsd),
    spentEstimatedUsd: finiteNumber(state.spentEstimatedUsd),
    statePath,
    ledgerPath,
    planDigest: state.planDigest,
    updatedAt: state.updatedAt,
    taskCounts: taskStates.reduce<Record<string, number>>((counts, task) => {
      const status = task.status ?? "unknown";
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    }, {}),
    resumedInterruptedTaskIds: taskStates
      .filter((task) => (task.attempts ?? 0) > 1 || /interrupted|requeued/i.test(task.error ?? ""))
      .map((task) => task.id)
      .filter((id): id is string => Boolean(id))
      .sort(),
  };
}

function adapterGapTasks(plan: ProofloopProdProxyLongRunPlan): ProofloopRunnerPlanTask[] {
  return plan.adapterGaps
    .slice()
    .sort((a, b) => a.familyId.localeCompare(b.familyId))
    .map((gap, index) => adapterGapTask(plan, gap, index));
}

function capabilityHeadlessTasks(): ProofloopRunnerPlanTask[] {
  return CAPABILITY_HEADLESS_TASKS.map((task, index) => ({
    id: task.id,
    command: task.command,
    estimatedCostUsd: 0,
    timeoutMs: task.timeoutMs,
    kind: "capability-headless",
    layer: "capability-headless",
    status: "ready",
    title: task.title,
    priority: 10 + index,
    objective: task.objective,
    prompt: [
      task.objective,
      "Run this as a headless capability check; do not substitute a screenshot or transcript for the command receipt.",
      "If it fails, use ProofLoop repair/resume outputs to narrow the fix before spending browser/model budget.",
    ].join("\n"),
    estimatedProductSpendUsd: 0,
    paidModelRequired: false,
    counts: {},
    commands: [
      {
        name: "run",
        command: task.command,
        requiresSpend: false,
        writes: task.evidence,
      },
    ],
    acceptance: [
      "The command exits 0 under the durable runner.",
      "The evidence paths are refreshed or an explicit blocker is recorded.",
      "No prod browser or paid model sweep is required for this capability proof.",
    ],
    evidence: task.evidence,
    blockers: [],
  }));
}

function adapterGapTask(
  plan: ProofloopProdProxyLongRunPlan,
  gap: ProofloopProdProxyLongRunAdapterGap,
  index: number,
): ProofloopRunnerPlanTask {
  const id = `adapter-gap.${slugId(gap.familyId)}`;
  return {
    id,
    command: "npm run benchmark:proofloop:prod-browser-adapters",
    estimatedCostUsd: 0,
    timeoutMs: 120_000,
    kind: "adapter-gap",
    layer: "browser-certification",
    status: "ready",
    title: `Implement prod browser adapter for ${gap.familyId}`,
    familyId: gap.familyId,
    priority: 100 + index,
    objective: `Close the ${gap.requiredAdapter} gap without changing locked certification fixtures or weakening proof gates.`,
    prompt: [
      `Implement the missing prod browser adapter for ${gap.familyId}.`,
      `Required adapter: ${gap.requiredAdapter}.`,
      `First blocker: ${gap.firstBlocker}`,
      "Use real NodeRoom prod-browser flows with model selection, memory mode off, exported evidence, and verifier receipts.",
      "Do not edit immutable proof-loop assets or promote failures without an external approval path.",
    ].join("\n"),
    estimatedProductSpendUsd: 0,
    paidModelRequired: false,
    counts: {
      taskTargets: gap.taskCount,
      blockedAttempts: gap.attemptCount,
      attempts: gap.attemptCount,
    },
    commands: [
      {
        name: "refresh-prod-browser-adapter-ledger",
        command: "npm run benchmark:proofloop:prod-browser-adapters",
        requiresSpend: false,
        writes: ["docs/eval/proofloop-prod-browser-adapters.json"],
      },
      {
        name: "refresh-prod-proxy-longrun-plan",
        command: `npm run benchmark:proofloop:prod-proxy-longrun -- plan --budget-usd ${formatBudget(plan.budget.capUsd)}`,
        requiresSpend: false,
        writes: ["docs/eval/proofloop-prod-proxy-longrun-plan.json"],
      },
    ],
    acceptance: [
      "A real prod browser adapter exists for the family and is reflected in docs/eval/proofloop-prod-browser-adapters.json.",
      "The prod proxy long-run plan moves the family out of blocked_adapter without dropping it from the denominator.",
      "Relevant deterministic proofloop tests pass.",
    ],
    evidence: gap.evidence,
    blockers: [gap.firstBlocker],
    metadata: {
      adapterStatus: gap.adapterStatus,
      adapterVersion: gap.adapterVersion,
      adapterPlanPath: gap.adapterPlanPath,
      requiredAdapter: gap.requiredAdapter,
      sourceMatrixDigest: plan.matrixDigest,
    },
  };
}

function guardedLiveRunBatchTasks(
  plan: ProofloopProdProxyLongRunPlan,
  budgetUsd: number,
): ProofloopRunnerPlanTask[] {
  return [...groupQueuedAttempts(plan.attempts).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([familyId, attempts], index) => liveRunBatchTask(plan, familyId, attempts, budgetUsd, index));
}

function liveRunBatchTask(
  plan: ProofloopProdProxyLongRunPlan,
  familyId: string,
  attempts: ProofloopProdProxyLongRunAttempt[],
  budgetUsd: number,
  index: number,
): ProofloopRunnerPlanTask {
  const sortedAttempts = attempts.slice().sort(compareAttempts);
  const modelIds = uniqueStrings(sortedAttempts.map((attempt) => attempt.modelId));
  const taskIds = uniqueStrings(sortedAttempts.map((attempt) => attempt.taskId));
  const sample = sortedAttempts[0];
  return {
    id: `live-run.${slugId(familyId)}`,
    command: "npm run benchmark:proofloop:prod-proxy-longrun -- status",
    estimatedCostUsd: 0,
    timeoutMs: 120_000,
    kind: "guarded-live-run-batch",
    layer: "browser-certification",
    status: "guarded-spend",
    title: `Run guarded prod proxy attempts for ${familyId}`,
    familyId,
    priority: 300 + index,
    objective: `Execute the queued real-user prod browser attempts for ${familyId} under the standalone runner budget guard.`,
    prompt: [
      `Run the queued prod proxy attempts for ${familyId} through https://noderoom.live with memory mode off.`,
      "Start with max-attempts 1, refresh the long-run plan after every attempt, and stop if receipts or budget accounting are missing.",
      "Do not run broad paid model sweeps; only execute the queued attempts covered by this plan and the runner budget.",
      `Models in this batch: ${modelIds.join(", ")}.`,
    ].join("\n"),
    estimatedProductSpendUsd: roundMoney(sortedAttempts.reduce((sum, attempt) => sum + attempt.estimatedCostUsd, 0)),
    paidModelRequired: true,
    counts: {
      taskTargets: taskIds.length,
      queuedAttempts: sortedAttempts.length,
      attempts: sortedAttempts.length,
    },
    commands: [
      {
        name: "status",
        command: "npm run benchmark:proofloop:prod-proxy-longrun -- status",
        requiresSpend: false,
      },
      {
        name: "single-guarded-attempt",
        command: `npm run benchmark:proofloop:prod-proxy-longrun -- run --execute --allow-spend --budget-usd ${formatBudget(budgetUsd)} --max-attempts 1`,
        requiresSpend: true,
        writes: [
          `.proofloop/prod-proxy-longrun/${plan.runId}/state.json`,
          `.proofloop/prod-proxy-longrun/${plan.runId}/events.jsonl`,
          `.proofloop/prod-proxy-longrun/${plan.runId}/receipts/`,
        ],
      },
    ],
    acceptance: [
      "Every attempted row writes a verifier receipt, cost evidence, and updated state before it can be marked passed.",
      "Memory mode remains disabled for the prod UI run.",
      "The all-task winner remains null until every tracked task target has prod browser proof.",
    ],
    evidence: uniqueStrings(sortedAttempts.flatMap((attempt) => attempt.evidence).slice(0, 12)),
    blockers: uniqueStrings(sortedAttempts.flatMap((attempt) => attempt.blockers)),
    metadata: {
      modelIds,
      sampleAttemptId: sample?.attemptId,
      sampleTaskId: sample?.taskId,
      sampleCommand: sample?.command?.shell,
      sampleEnv: sample?.command?.env,
      sourceMatrixDigest: plan.matrixDigest,
    },
  };
}

function officialScoreGapTasks(receipts: ExternalAdapterBlockerReceipt[]): ProofloopRunnerPlanTask[] {
  return receipts.map((receipt, index) => ({
    id: `official-score.${slugId(receipt.adapterId)}`,
    command: "npm run benchmark:proofloop:adapter-blockers",
    estimatedCostUsd: 0,
    timeoutMs: 120_000,
    kind: "official-score-gap",
    layer: "official-scoring",
    status: "blocked-external",
    title: `Import official score receipt for ${receipt.adapterId}`,
    adapterId: receipt.adapterId,
    priority: 500 + index,
    objective: `Resolve the external official-score blocker for ${receipt.name} without relabeling proxy proof as an official score.`,
    prompt: [
      `Resolve the official scorer blocker for ${receipt.adapterId}.`,
      "Use the upstream scorer or judge contract named in the adapter receipt.",
      "If credentials or upstream bundles are unavailable, keep the blocker explicit and refresh the receipt; do not self-grade or accept a proxy score as official.",
    ].join("\n"),
    estimatedProductSpendUsd: 0,
    paidModelRequired: false,
    counts: {},
    commands: receipt.resumeCommands.filter(isShellCommand).map((command, commandIndex) => ({
      name: `resume-${commandIndex + 1}`,
      command,
      requiresSpend: command.includes("--real-user") || command.includes("live-room"),
    })),
    acceptance: [
      `${receipt.officialScoreReceiptPath} has a scored receipt from the upstream official scorer, or the blocker remains explicitly external.`,
      `${receipt.officialTaskBundleManifestPath} records the locked official task bundle when available.`,
      "The adapter blocker receipt is refreshed after any import or blocker change.",
    ],
    evidence: receipt.evidence,
    blockers: receipt.blockers,
    metadata: {
      name: receipt.name,
      officialScoreStatus: receipt.officialScoreStatus,
      localImplementationStatus: receipt.localImplementationStatus,
      officialCommandPlan: receipt.officialCommandPlan,
      resumeSteps: receipt.resumeCommands,
      officialScoreReceiptPath: receipt.officialScoreReceiptPath,
      officialTaskBundleManifestPath: receipt.officialTaskBundleManifestPath,
    },
  }));
}

function groupQueuedAttempts(
  attempts: ProofloopProdProxyLongRunAttempt[],
): Map<string, ProofloopProdProxyLongRunAttempt[]> {
  const groups = new Map<string, ProofloopProdProxyLongRunAttempt[]>();
  for (const attempt of attempts) {
    if (attempt.status !== "queued") continue;
    const group = groups.get(attempt.familyId) ?? [];
    group.push(attempt);
    groups.set(attempt.familyId, group);
  }
  return groups;
}

function compareAttempts(a: ProofloopProdProxyLongRunAttempt, b: ProofloopProdProxyLongRunAttempt): number {
  return a.estimatedCostUsd - b.estimatedCostUsd ||
    a.familyId.localeCompare(b.familyId) ||
    a.taskId.localeCompare(b.taskId) ||
    a.modelId.localeCompare(b.modelId);
}

function writeJson(root: string, relativePath: string, value: unknown): void {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(root: string, relativePath: string, value: string): void {
  const path = resolve(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf-8");
}

function renderDogfoodReceiptLines(receipt: ProofloopRunnerDogfoodReceipt | undefined): string[] {
  if (!receipt) return [];
  const taskCounts = Object.entries(receipt.taskCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([status, count]) => `${status}=${count}`)
    .join(", ");
  const resumeProof = receipt.resumedInterruptedTaskIds.length
    ? receipt.resumedInterruptedTaskIds.map((id) => `\`${id}\``).join(", ")
    : "none";
  return [
    "## Dogfood Receipt",
    "",
    `- Runner run ID: \`${receipt.runId}\``,
    `- Status: ${receipt.status}`,
    `- Updated: ${receipt.updatedAt ?? "unknown"}`,
    `- State: \`${receipt.statePath}\``,
    `- Ledger: \`${receipt.ledgerPath}\``,
    `- Runner normalized plan digest: \`${receipt.planDigest ?? "unknown"}\``,
    `- Budget: cap=${money(receipt.budgetUsd)}, spent_est=${money(receipt.spentEstimatedUsd)}`,
    `- Tasks: ${taskCounts || "none"}`,
    `- Resume proof: ${resumeProof}`,
    "",
  ];
}

function timestampId(value: string): string {
  return value.replace(/[:.]/g, "-").replace(/[^0-9A-Za-z-]/g, "").slice(0, 24);
}

function slugId(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function slugRunId(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function roundMoney(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function finiteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function money(value: number): string {
  return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ".00")}`;
}

function formatBudget(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isShellCommand(value: string): boolean {
  return /^(npm|node|npx|tsx|pnpm|yarn|powershell|pwsh)\b/.test(value);
}
