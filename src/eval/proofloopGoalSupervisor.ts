import { spawnSync } from "node:child_process";
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
  solveProofloopBlocker,
  type ProofloopBlockerSolveReceipt,
} from "./proofloopBlockerSolver";

export type ProofloopGoalTerminalStatus =
  | "passed"
  | "blocked_external"
  | "needs_scaffold_or_run"
  | "needs_human_approval"
  | "budget_exhausted"
  | "failed";

export type ProofloopGoalStatus = "initialized" | "running" | ProofloopGoalTerminalStatus;

export type ProofloopGoalTaskStatus =
  | "pending"
  | "running"
  | "passed"
  | "blocked_external"
  | "needs_scaffold_or_run"
  | "needs_human_approval"
  | "failed";

export type ProofloopGoalTaskKind = "command" | "external_blocker" | "human_approval";

export type ProofloopGoalTask = {
  id: string;
  title: string;
  kind: ProofloopGoalTaskKind;
  command?: string;
  required?: boolean;
  status: ProofloopGoalTaskStatus;
  evidence: string[];
  blockers: string[];
  resumeCommand?: string;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  lastExitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
};

export type ProofloopGoalState = {
  schema: "proofloop-goal-supervisor-v1";
  goalId: string;
  objective: string;
  status: ProofloopGoalStatus;
  createdAt: string;
  updatedAt: string;
  terminalReason?: string;
  tasks: ProofloopGoalTask[];
  unblockedTasksRemaining: number;
  blockedTasksRemaining: number;
  ledgerPath: string;
};

export type ProofloopGoalEvent = {
  ts: string;
  goalId: string;
  type:
    | "goal_initialized"
    | "task_started"
    | "task_passed"
    | "task_blocked_external"
    | "task_needs_scaffold_or_run"
    | "task_needs_human_approval"
    | "task_failed"
    | "goal_status"
    | "goal_gate";
  status: ProofloopGoalStatus | ProofloopGoalTaskStatus;
  taskId?: string;
  command?: string;
  exitCode?: number;
  evidence?: string[];
  blockers?: string[];
  resumeCommand?: string;
  solver?: ProofloopBlockerSolveReceipt;
  unblockedTasksRemaining?: number;
  blockedTasksRemaining?: number;
};

export type ProofloopGoalOptions = {
  root?: string;
  now?: () => Date;
};

export type ProofloopGoalInitOptions = ProofloopGoalOptions & {
  goalId: string;
  template?: "official-scores";
  objective?: string;
  tasks?: ProofloopGoalTask[];
  overwrite?: boolean;
};

export type ProofloopGoalRunResult = {
  state: ProofloopGoalState;
  task?: ProofloopGoalTask;
  event?: ProofloopGoalEvent;
};

export type ProofloopGoalLedgerTaskExport = {
  id: string;
  title: string;
  kind: ProofloopGoalTaskKind;
  required: boolean;
  status: ProofloopGoalTaskStatus;
  command?: string;
  evidence: string[];
  blockers: string[];
  resumeCommand?: string;
  attempts: number;
  startedAt?: string;
  finishedAt?: string;
  lastExitCode?: number;
};

export type ProofloopGoalBlockedReasonExport = {
  taskId: string;
  title: string;
  kind: ProofloopGoalTaskKind;
  status: ProofloopGoalTaskStatus;
  reason: string;
  evidence: string[];
  resumeCommand?: string;
};

export type ProofloopGoalLedgerGoalExport = {
  goalId: string;
  objective: string;
  status: ProofloopGoalStatus;
  createdAt: string;
  updatedAt: string;
  terminalReason?: string;
  localStatePath: string;
  localQueuePath: string;
  localBlockersPath: string;
  localLedgerPath: string;
  ledgerEvents: {
    count: number;
    latestTs?: string;
    latestType?: ProofloopGoalEvent["type"];
    latestTaskId?: string;
  };
  requiredTaskCount: number;
  unblockedTasksRemaining: number;
  blockedTasksRemaining: number;
  taskStatusCounts: Record<ProofloopGoalTaskStatus, number>;
  blockedReasons: ProofloopGoalBlockedReasonExport[];
  tasks: ProofloopGoalLedgerTaskExport[];
};

export type ProofloopGoalLedgerReceipt = {
  schema: "proofloop-goal-ledger-export-v1";
  generatedAt: string;
  exports: {
    json: string;
    markdown: string;
  };
  localStore: {
    path: ".proofloop/goals";
    rawLocalStoresCommitted: false;
    note: string;
  };
  summary: {
    goalCount: number;
    statusCounts: Record<ProofloopGoalStatus, number>;
    unblockedTasksRemaining: number;
    blockedTasksRemaining: number;
    blockedReasonCount: number;
  };
  goals: ProofloopGoalLedgerGoalExport[];
};

const GOAL_LEDGER_JSON_EXPORT = "docs/eval/proofloop-goal-ledger.json";
const GOAL_LEDGER_MARKDOWN_EXPORT = "docs/eval/PROOFLOOP_GOAL_LEDGER.md";
const GOAL_STATUSES: ProofloopGoalStatus[] = [
  "initialized",
  "running",
  "passed",
  "blocked_external",
  "needs_scaffold_or_run",
  "needs_human_approval",
  "budget_exhausted",
  "failed",
];
const TASK_STATUSES: ProofloopGoalTaskStatus[] = [
  "pending",
  "running",
  "passed",
  "blocked_external",
  "needs_scaffold_or_run",
  "needs_human_approval",
  "failed",
];

export function officialScoresGoalTasks(): ProofloopGoalTask[] {
  return [
    commandTask({
      id: "btb-fullsuite-official-score",
      title: "BankerToolBench official full-suite score receipt",
      command:
        "npm run benchmark:bankertoolbench:fullsuite-gate -- --summary docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json --receipt-out docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json --assert",
      evidence: [
        "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json",
        "docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json",
      ],
    }),
    commandTask({
      id: "official-task-coverage-ledger",
      title: "Official benchmark task coverage ledger",
      command: "npm run benchmark:official:task-coverage",
      evidence: [
        "docs/eval/official-benchmark-task-coverage.json",
        "docs/eval/OFFICIAL_BENCHMARK_TASK_COVERAGE.md",
      ],
    }),
    commandTask({
      id: "benchmark-normalization-ledger",
      title: "Proof Loop benchmark normalization ledger",
      command: "npm run benchmark:proofloop:normalized",
      evidence: [
        "docs/eval/proofloop-normalized-benchmarks.json",
        "docs/eval/PROOFLOOP_NORMALIZED_BENCHMARKS.md",
      ],
    }),
    commandTask({
      id: "company-task-coverage-ledger",
      title: "Company/task archetype coverage ledger",
      command: "npm run benchmark:proofloop:company-tasks",
      evidence: [
        "docs/eval/proofloop-company-task-coverage.json",
        "docs/eval/PROOFLOOP_COMPANY_TASK_COVERAGE.md",
      ],
    }),
    commandTask({
      id: "harness-economics-ledger",
      title: "Harness version and OpenRouter proxy economics ledger",
      command: "npm run benchmark:proofloop:harness-economics",
      evidence: [
        "docs/eval/proofloop-harness-economics.json",
        "docs/eval/PROOFLOOP_HARNESS_ECONOMICS.md",
        "docs/eval/openrouter-top-paid-tools-snapshot.json",
      ],
    }),
    commandTask({
      id: "proofloop-npx-package-proof",
      title: "Published npx proofloop package proof",
      command: "npm run benchmark:proofloop:npx-package",
      evidence: [
        "docs/eval/proofloop-npx-package-proof.json",
        "docs/eval/PROOFLOOP_NPX_PACKAGE_PROOF.md",
      ],
    }),
    commandTask({
      id: "preprod-readiness-ledger",
      title: "ProofLoop preprod readiness release gate",
      command: "npm run benchmark:proofloop:preprod",
      evidence: [
        "docs/eval/proofloop-preprod-readiness.json",
        "docs/eval/PROOFLOOP_PREPROD_READINESS.md",
        "docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md",
      ],
    }),
    commandTask({
      id: "external-adapter-setup-doctor",
      title: "External adapter setup/doctor receipts before blocked status",
      command: [
        "npm run proofloop -- setup bankertoolbench --doctor",
        "npm run proofloop -- setup finch --doctor",
        "npm run proofloop -- setup finauditing --doctor",
        "npm run proofloop -- setup workstreambench --doctor",
      ].join(" && "),
      evidence: [
        ".proofloop/setup/bankertoolbench-local-setup.json",
        ".proofloop/setup/finch-local-setup.json",
        ".proofloop/setup/finauditing-local-setup.json",
        ".proofloop/setup/workstreambench-local-setup.json",
      ],
    }),
    commandTask({
      id: "external-adapter-local-product-proofs",
      title: "External adapter fresh-room product-path browser proofs",
      command: "npm run benchmark:proofloop:external-adapter-live-room -- --prod --user-emulation strict",
      evidence: [
        "docs/eval/proofloop-external-adapter-live-room-runs/finch.json",
        "docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json",
        "docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json",
        "docs/eval/proofloop-external-adapter-runs/finch.json",
        "docs/eval/proofloop-external-adapter-runs/finauditing.json",
        "docs/eval/proofloop-external-adapter-runs/workstreambench.json",
      ],
    }),
    commandTask({
      id: "external-adapter-blocker-receipts",
      title: "External adapter typed blocker receipts",
      command: "npm run benchmark:proofloop:adapter-blockers",
      evidence: [
        "docs/eval/proofloop-adapter-blockers/finch.json",
        "docs/eval/proofloop-adapter-blockers/finauditing.json",
        "docs/eval/proofloop-adapter-blockers/workstreambench.json",
      ],
    }),
    commandTask({
      id: "blocked-lane-solver",
      title: "Blocked official-lane research/scaffold/model-sweep solver",
      command: "npm run proofloop -- solve-blockers --goal official-scores",
      evidence: [
        ".proofloop/lanes/spreadsheetbench-v1/blocker-analysis.json",
        ".proofloop/lanes/spreadsheetbench-v2/blocker-analysis.json",
        ".proofloop/lanes/finch/blocker-analysis.json",
        ".proofloop/lanes/finauditing/blocker-analysis.json",
        ".proofloop/lanes/workstreambench/blocker-analysis.json",
      ],
    }),
    commandTask({
      id: "proofloop-chart-pack",
      title: "Proof Loop chart pack from model/task/harness ledgers",
      command: "npm run proofloop -- charts latest",
      evidence: [
        ".proofloop/runs/latest/charts/chart-pack.json",
        ".proofloop/runs/latest/charts/chart-pack.html",
        ".proofloop/runs/latest/charts/model-performance.vl.json",
        ".proofloop/runs/latest/charts/cost-per-pass.vl.json",
        ".proofloop/runs/latest/charts/failure-categories.vl.json",
        ".proofloop/runs/latest/charts/harness-version-trend.vl.json",
        ".proofloop/runs/latest/charts/evidence-score.vl.json",
        ".proofloop/runs/latest/charts/latency-cost-frontier.vl.json",
        ".proofloop/runs/latest/charts/accounting-workpaper.vl.json",
        "docs/eval/proofloop-charts/chart-pack.json",
        "docs/eval/proofloop-charts/proofloop-chart-pack.json",
        "docs/eval/proofloop-charts/chart-pack.html",
        "docs/eval/proofloop-charts/model-performance.vl.json",
        "docs/eval/proofloop-charts/cost-per-pass.vl.json",
        "docs/eval/proofloop-charts/failure-categories.vl.json",
        "docs/eval/proofloop-charts/harness-version-trend.vl.json",
        "docs/eval/proofloop-charts/evidence-score.vl.json",
        "docs/eval/proofloop-charts/latency-cost-frontier.vl.json",
        "docs/eval/proofloop-charts/accounting-workpaper.vl.json",
        "docs/eval/proofloop-charts/PROOFLOOP_CHART_PACK.md",
        "docs/eval/proofloop-charts/svg/model-performance.svg",
        "docs/eval/proofloop-charts/svg/cost-per-pass.svg",
        "docs/eval/proofloop-charts/svg/failure-categories.svg",
        "docs/eval/proofloop-charts/svg/harness-version-trend.svg",
        "docs/eval/proofloop-charts/svg/latency-cost-frontier.svg",
        "docs/eval/proofloop-charts/svg/workflow-completion.svg",
      ],
    }),
    commandTask({
      id: "proofloop-benchmark-board",
      title: "9-lane Proof Loop benchmark board",
      command: "npm run benchmark:proofloop:board",
      evidence: [
        "docs/eval/proofloop-benchmark-board.json",
        "docs/eval/PROOFLOOP_BENCHMARK_BOARD.md",
      ],
    }),
    externalBlockerTask({
      id: "spreadsheetbench-v1-full-official-score",
      title: "SpreadsheetBench V1 full 912-task official score",
      blockers: [
        "Full public 912-task SpreadsheetBench V1 bundle is staged and deterministically scored: 912/912 tasks, 2,729 agent-visible workbooks, 2,729 evaluator answer workbooks, 95/912 copy-input baseline pass.",
        "All 912 tasks need model-run evidence before strict official-score promotion; cheaper OpenRouter proxy judges can triage product quality but cannot replace the SpreadsheetBench workbook scorer for the official claim.",
      ],
      evidence: [
        "docs/eval/official-benchmark-task-coverage.json",
        "docs/eval/spreadsheetbench-v1-912-stage.json",
        "docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json",
      ],
      resumeCommand:
        "run all 912 SpreadsheetBench V1 tasks through the model runner, use npm run benchmark:proofloop:harness-economics to select cheap proxy routes for product iteration, then npm run benchmark:official:task-coverage -- --strict",
    }),
    externalBlockerTask({
      id: "spreadsheetbench-v2-full-official-score",
      title: "SpreadsheetBench V2 full 321-task official score",
      blockers: [
        "Full public SpreadsheetBench V2 bundle is staged locally: 321/321 tasks, 321 agent-visible workbooks, 321 evaluator answer workbooks, zero gold/scorer leaks.",
        "All 321 V2 tasks need model-run, workbook scorer, and rendered chart-grader evidence; proxy judges can improve candidates but cannot stand in for the V2 scorer path.",
      ],
      evidence: [
        "docs/eval/official-benchmark-task-coverage.json",
        "docs/eval/spreadsheetbench-v2-full-ingest.json",
        "docs/eval/spreadsheetbench-v2-full-stage.json",
      ],
      resumeCommand:
        "run all 321 SpreadsheetBench V2 tasks and scorer/chart grader, use npm run benchmark:proofloop:harness-economics for proxy-model routing, then npm run benchmark:official:task-coverage -- --strict",
    }),
    externalBlockerTask({
      id: "finch-official-score",
      title: "Finch / FinWorkBench official score",
      blockers: [
        "finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external; scored receipt is still required before claiming score.",
        "finch: official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is staged and NodeRoom model-output artifacts are complete in docs/eval/proofloop-official-outputs/finch.json; upstream content_parts rendering and an accepted Azure judge/scorer receipt are still required before claiming an official score. Cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.",
      ],
      evidence: [
        ".proofloop/setup/finch-local-setup.json",
        "proofloop/benchmarks/finch/adapter.json",
        "docs/eval/proofloop-external-adapter-live-room-runs/finch.json",
        "docs/eval/proofloop-external-adapter-runs/finch.json",
        "docs/eval/proofloop-adapter-blockers/finch.json",
        "docs/eval/proofloop-official-task-bundles/finch.json",
        "docs/eval/proofloop-official-scores/finch.json",
        "docs/eval/proofloop-official-outputs/finch.json",
      ],
      resumeCommand: "complete upstream Finch content_parts rendering, run/import the accepted Finch Azure scorer or judge output, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
    }),
    externalBlockerTask({
      id: "finauditing-official-score",
      title: "FinAuditing official score",
      blockers: [
        "finauditing: official scorer receipt docs/eval/proofloop-official-scores/finauditing.json is blocked_external; scored receipt is still required before claiming score.",
        "finauditing: official task bundle lock docs/eval/proofloop-official-task-bundles/finauditing.json is staged and official-format FinSM/FinRE/FinMR prediction JSONL is complete in docs/eval/proofloop-official-outputs/finauditing.json; an accepted FinMR judge path and scorer import are still required before claiming an official score. OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.",
      ],
      evidence: [
        ".proofloop/setup/finauditing-local-setup.json",
        "proofloop/benchmarks/finauditing/adapter.json",
        "docs/eval/proofloop-external-adapter-live-room-runs/finauditing.json",
        "docs/eval/proofloop-external-adapter-runs/finauditing.json",
        "docs/eval/proofloop-adapter-blockers/finauditing.json",
        "docs/eval/proofloop-official-task-bundles/finauditing.json",
        "docs/eval/proofloop-official-scores/finauditing.json",
        "docs/eval/proofloop-official-outputs/finauditing.json",
      ],
      resumeCommand: "run/import FinAuditing scorer output with an accepted FinMR judge path, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict",
    }),
    externalBlockerTask({
      id: "workstreambench-official-score",
      title: "WorkstreamBench official score",
      blockers: [
        "workstreambench: official scorer receipt docs/eval/proofloop-official-scores/workstreambench.json is blocked_external; scored receipt is still required before claiming score.",
        "workstreambench: no public official task bundle lock docs/eval/proofloop-official-task-bundles/workstreambench.json is staged because no public official bundle/scorer/rubric URL was found.",
      ],
      evidence: [
        ".proofloop/setup/workstreambench-local-setup.json",
        "proofloop/benchmarks/workstreambench/adapter.json",
        "docs/eval/proofloop-external-adapter-live-room-runs/workstreambench.json",
        "docs/eval/proofloop-external-adapter-runs/workstreambench.json",
        "docs/eval/proofloop-adapter-blockers/workstreambench.json",
        "docs/eval/proofloop-official-scores/workstreambench.json",
      ],
      resumeCommand: "obtain the official WorkstreamBench task bundle and scorer/rubric from an upstream release or authors, lock it in docs/eval/proofloop-official-task-bundles/workstreambench.json, use npm run benchmark:proofloop:harness-economics for proxy triage, import a scored receipt, then npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict",
    }),
  ];
}

export function initProofloopGoal(options: ProofloopGoalInitOptions): ProofloopGoalState {
  const root = resolveRoot(options.root);
  const now = isoNow(options);
  const paths = goalPaths(root, options.goalId);
  if (existsSync(paths.statePath) && !options.overwrite) {
    throw new Error(`Goal already exists: ${options.goalId}`);
  }
  const tasks = cloneTasks(options.tasks ?? (options.template === "official-scores" ? officialScoresGoalTasks() : []));
  if (!tasks.length) throw new Error("Goal init requires tasks or --template official-scores.");

  const state = finalizeState({
    schema: "proofloop-goal-supervisor-v1",
    goalId: options.goalId,
    objective: options.objective ?? "Make official benchmark scores real, tested, shipped, and externally blocked only with proof.",
    status: "initialized",
    createdAt: now,
    updatedAt: now,
    tasks,
    unblockedTasksRemaining: 0,
    blockedTasksRemaining: 0,
    ledgerPath: relativePath(root, paths.ledgerPath),
  }, now);

  mkdirSync(paths.dir, { recursive: true });
  writeState(root, state);
  appendLedger(root, state.goalId, {
    ts: now,
    goalId: state.goalId,
    type: "goal_initialized",
    status: state.status,
    unblockedTasksRemaining: state.unblockedTasksRemaining,
    blockedTasksRemaining: state.blockedTasksRemaining,
  });
  return state;
}

export function loadProofloopGoal(goalId: string, options: ProofloopGoalOptions = {}): ProofloopGoalState {
  const root = resolveRoot(options.root);
  const path = goalPaths(root, goalId).statePath;
  if (!existsSync(path)) throw new Error(`Goal does not exist: ${goalId}`);
  return JSON.parse(readFileSync(path, "utf8")) as ProofloopGoalState;
}

export function proofloopGoalLedgerReceiptPaths(root?: string): { jsonPath: string; markdownPath: string; jsonRelative: string; markdownRelative: string } {
  const resolved = resolveRoot(root);
  return {
    jsonPath: join(resolved, GOAL_LEDGER_JSON_EXPORT),
    markdownPath: join(resolved, GOAL_LEDGER_MARKDOWN_EXPORT),
    jsonRelative: GOAL_LEDGER_JSON_EXPORT,
    markdownRelative: GOAL_LEDGER_MARKDOWN_EXPORT,
  };
}

export function buildProofloopGoalLedgerReceipt(options: ProofloopGoalOptions = {}): ProofloopGoalLedgerReceipt {
  const root = resolveRoot(options.root);
  const goals = loadAllProofloopGoalStates(root).map((state) => exportGoalState(root, state));
  const updatedAtValues = goals.map((goal) => goal.updatedAt).sort();
  const generatedAt = updatedAtValues[updatedAtValues.length - 1] ?? isoNow(options);
  return {
    schema: "proofloop-goal-ledger-export-v1",
    generatedAt,
    exports: {
      json: GOAL_LEDGER_JSON_EXPORT,
      markdown: GOAL_LEDGER_MARKDOWN_EXPORT,
    },
    localStore: {
      path: ".proofloop/goals",
      rawLocalStoresCommitted: false,
      note: "Raw .proofloop goal/process stores remain gitignored. This committed receipt copies durable status, blocker reasons, resume commands, and evidence paths only.",
    },
    summary: {
      goalCount: goals.length,
      statusCounts: countStatuses(GOAL_STATUSES, goals.map((goal) => goal.status)),
      unblockedTasksRemaining: goals.reduce((sum, goal) => sum + goal.unblockedTasksRemaining, 0),
      blockedTasksRemaining: goals.reduce((sum, goal) => sum + goal.blockedTasksRemaining, 0),
      blockedReasonCount: goals.reduce((sum, goal) => sum + goal.blockedReasons.length, 0),
    },
    goals,
  };
}

export function renderProofloopGoalLedgerMarkdown(receipt: ProofloopGoalLedgerReceipt): string {
  const lines = [
    "# ProofLoop Goal Ledger Receipt",
    "",
    `Generated: ${receipt.generatedAt}`,
    "",
    "This committed receipt summarizes local `.proofloop/goals` process state. Raw `.proofloop` stores stay gitignored; blocker reasons, resume commands, and evidence paths are copied here so blocked claims survive local disk cleanup.",
    "",
    `JSON receipt: \`${receipt.exports.json}\``,
    "",
    "## Summary",
    "",
    `- Goals: ${receipt.summary.goalCount}`,
    `- Unblocked tasks remaining: ${receipt.summary.unblockedTasksRemaining}`,
    `- Blocked tasks remaining: ${receipt.summary.blockedTasksRemaining}`,
    `- Blocked reasons recorded: ${receipt.summary.blockedReasonCount}`,
    `- Raw local stores committed: ${receipt.localStore.rawLocalStoresCommitted}`,
    "",
  ];

  for (const goal of receipt.goals) {
    lines.push(
      `## Goal: ${goal.goalId}`,
      "",
      `- Status: ${goal.status}`,
      `- Objective: ${goal.objective}`,
      `- Updated: ${goal.updatedAt}`,
      `- Local ledger: \`${goal.localLedgerPath}\` (${goal.ledgerEvents.count} event(s))`,
      `- Required tasks: ${goal.requiredTaskCount}`,
      `- Unblocked tasks remaining: ${goal.unblockedTasksRemaining}`,
      `- Blocked tasks remaining: ${goal.blockedTasksRemaining}`,
    );
    if (goal.terminalReason) lines.push(`- Terminal reason: ${goal.terminalReason}`);
    lines.push("", "### Blocked Reasons", "");
    if (goal.blockedReasons.length === 0) {
      lines.push("No blocker reasons recorded.", "");
    } else {
      lines.push("| Task | Status | Reason | Evidence | Resume |", "| --- | --- | --- | --- | --- |");
      for (const blocker of goal.blockedReasons) {
        lines.push(
          `| ${md(blocker.taskId)} | ${md(blocker.status)} | ${md(blocker.reason)} | ${md(blocker.evidence.join("<br>"))} | ${md(blocker.resumeCommand ?? "")} |`,
        );
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function writeProofloopGoalLedgerReceipt(options: ProofloopGoalOptions = {}): ProofloopGoalLedgerReceipt {
  const root = resolveRoot(options.root);
  const receipt = buildProofloopGoalLedgerReceipt({ ...options, root });
  const paths = proofloopGoalLedgerReceiptPaths(root);
  writeJson(paths.jsonPath, receipt);
  mkdirSync(dirname(paths.markdownPath), { recursive: true });
  writeFileSync(paths.markdownPath, renderProofloopGoalLedgerMarkdown(receipt), "utf8");
  return receipt;
}

export function runNextProofloopGoalTask(goalId: string, options: ProofloopGoalOptions = {}): ProofloopGoalRunResult {
  const root = resolveRoot(options.root);
  const now = isoNow(options);
  const state = loadProofloopGoal(goalId, { root });
  if (isTerminal(state.status)) return { state };

  const task = state.tasks.find((candidate) => candidate.status === "pending");
  if (!task) {
    const finalized = writeState(root, finalizeState(state, now));
    return { state: finalized };
  }

  if (task.kind === "external_blocker") {
    const solver = solveProofloopBlocker({
      root,
      task: {
        id: task.id,
        title: task.title,
        blockers: task.blockers,
        evidence: task.evidence,
        resumeCommand: task.resumeCommand,
      },
      phase: "solve",
      generatedAt: now,
    });
    task.status = solver.externalBlockClaimAllowed ? "blocked_external" : "needs_scaffold_or_run";
    task.finishedAt = now;
    task.attempts += 1;
    task.evidence = [...new Set([...task.evidence, ...Object.values(solver.artifacts)])];
    task.resumeCommand = solver.nextCommands[0] ?? task.resumeCommand;
    const updated = writeState(root, finalizeState(state, now));
    const event = appendLedger(root, goalId, {
      ...taskEvent(
        task.status === "blocked_external" ? "task_blocked_external" : "task_needs_scaffold_or_run",
        updated,
        task,
        now,
      ),
      solver,
    });
    return { state: updated, task, event };
  }

  if (task.kind === "human_approval") {
    task.status = "needs_human_approval";
    task.finishedAt = now;
    task.attempts += 1;
    const updated = writeState(root, finalizeState(state, now));
    const event = appendLedger(root, goalId, taskEvent("task_needs_human_approval", updated, task, now));
    return { state: updated, task, event };
  }

  if (!task.command) throw new Error(`Command task ${task.id} has no command.`);
  task.status = "running";
  task.startedAt = now;
  task.attempts += 1;
  writeState(root, finalizeState(state, now));
  appendLedger(root, goalId, taskEvent("task_started", state, task, now));

  const result = spawnSync(task.command, {
    cwd: root,
    shell: true,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  const finishedAt = isoNow(options);
  task.status = (result.status ?? 1) === 0 ? "passed" : "failed";
  task.finishedAt = finishedAt;
  task.lastExitCode = result.status ?? 1;
  task.stdoutTail = tail(result.stdout ?? "");
  task.stderrTail = tail(result.stderr ?? "");
  const updated = writeState(root, finalizeState(state, finishedAt));
  const event = appendLedger(root, goalId, taskEvent(task.status === "passed" ? "task_passed" : "task_failed", updated, task, finishedAt));
  return { state: updated, task, event };
}

export function superviseProofloopGoal(goalId: string, options: ProofloopGoalOptions & { maxSteps?: number } = {}): ProofloopGoalState {
  const maxSteps = options.maxSteps ?? 100;
  let state = loadProofloopGoal(goalId, options);
  for (let i = 0; i < maxSteps; i++) {
    if (isTerminal(state.status)) return state;
    if (!state.tasks.some((task) => task.status === "pending")) break;
    state = runNextProofloopGoalTask(goalId, options).state;
  }
  return writeState(resolveRoot(options.root), finalizeState(state, isoNow(options)));
}

export function blockProofloopGoal(goalId: string, args: {
  taskId: string;
  reason: string;
  evidence?: string[];
  resumeCommand?: string;
}, options: ProofloopGoalOptions = {}): ProofloopGoalState {
  const root = resolveRoot(options.root);
  const now = isoNow(options);
  const state = loadProofloopGoal(goalId, { root });
  let task = state.tasks.find((candidate) => candidate.id === args.taskId);
  if (!task) {
    task = externalBlockerTask({
      id: args.taskId,
      title: args.taskId,
      blockers: [args.reason],
      evidence: args.evidence ?? [],
      resumeCommand: args.resumeCommand,
    });
    state.tasks.push(task);
  }
  task.kind = "external_blocker";
  task.status = "blocked_external";
  task.blockers = [args.reason];
  task.evidence = args.evidence ?? task.evidence;
  task.resumeCommand = args.resumeCommand ?? task.resumeCommand;
  task.finishedAt = now;
  task.attempts += 1;
  const updated = writeState(root, finalizeState(state, now));
  appendLedger(root, goalId, taskEvent("task_blocked_external", updated, task, now));
  return updated;
}

export function gateProofloopGoal(goalId: string, options: ProofloopGoalOptions = {}): ProofloopGoalState {
  const root = resolveRoot(options.root);
  const state = writeState(root, finalizeState(loadProofloopGoal(goalId, { root }), isoNow(options)));
  appendLedger(root, goalId, {
    ts: state.updatedAt,
    goalId,
    type: "goal_gate",
    status: state.status,
    blockers: state.tasks
      .filter((task) => task.status === "blocked_external" || task.status === "needs_scaffold_or_run")
      .flatMap((task) => task.blockers),
    unblockedTasksRemaining: state.unblockedTasksRemaining,
    blockedTasksRemaining: state.blockedTasksRemaining,
  });
  return state;
}

export function formatProofloopGoalStatus(state: ProofloopGoalState): string {
  const lines = [
    `Proof Loop goal: ${state.goalId}`,
    `Status: ${state.status}`,
    `Objective: ${state.objective}`,
    `Unblocked tasks remaining: ${state.unblockedTasksRemaining}`,
    `Blocked tasks remaining: ${state.blockedTasksRemaining}`,
    "",
    "Tasks:",
  ];
  for (const task of state.tasks) {
    lines.push(`  - ${task.id}: ${task.status} (${task.kind})`);
    if (task.command) lines.push(`    command: ${task.command}`);
    if (task.blockers.length) lines.push(`    blocker: ${task.blockers.join("; ")}`);
    if (task.resumeCommand) lines.push(`    resume: ${task.resumeCommand}`);
  }
  if (state.terminalReason) lines.push("", `Terminal reason: ${state.terminalReason}`);
  return `${lines.join("\n")}\n`;
}

export function formatProofloopGoalResume(state: ProofloopGoalState): string {
  const pending = state.tasks.find((task) => task.status === "pending");
  const blocked = state.tasks.filter((task) => task.status === "blocked_external");
  const scaffold = state.tasks.filter((task) => task.status === "needs_scaffold_or_run");
  const lines = [
    `Proof Loop resume: ${state.goalId}`,
    `Current status: ${state.status}`,
    `Ledger: ${state.ledgerPath}`,
    "",
  ];
  if (pending) {
    lines.push(`Next task: ${pending.id}`);
    if (pending.command) lines.push(`Run: ${pending.command}`);
    if (pending.resumeCommand) lines.push(`Resume command: ${pending.resumeCommand}`);
  } else {
    lines.push("No unblocked pending task remains.");
  }
  if (blocked.length) {
    lines.push("", "External blockers:");
    for (const task of blocked) {
      lines.push(`  - ${task.id}: ${task.blockers.join("; ")}`);
      if (task.resumeCommand) lines.push(`    resume: ${task.resumeCommand}`);
    }
  }
  if (scaffold.length) {
    lines.push("", "Scaffold/model-run work:");
    for (const task of scaffold) {
      lines.push(`  - ${task.id}: ${task.blockers.join("; ")}`);
      if (task.resumeCommand) lines.push(`    next: ${task.resumeCommand}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function loadAllProofloopGoalStates(root: string): ProofloopGoalState[] {
  const goalsDir = join(root, ".proofloop", "goals");
  if (!existsSync(goalsDir)) return [];
  return readdirSync(goalsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => JSON.parse(readFileSync(join(goalsDir, entry.name, "state.json"), "utf8")) as ProofloopGoalState)
    .sort((a, b) => a.goalId.localeCompare(b.goalId));
}

function exportGoalState(root: string, state: ProofloopGoalState): ProofloopGoalLedgerGoalExport {
  const paths = goalPaths(root, state.goalId);
  const tasks = state.tasks.map((task): ProofloopGoalLedgerTaskExport => ({
    id: task.id,
    title: task.title,
    kind: task.kind,
    required: task.required !== false,
    status: task.status,
    command: task.command,
    evidence: [...task.evidence],
    blockers: [...task.blockers],
    resumeCommand: task.resumeCommand,
    attempts: task.attempts,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    lastExitCode: task.lastExitCode,
  }));
  const blockedReasons = state.tasks.flatMap((task) =>
    task.blockers.map((reason): ProofloopGoalBlockedReasonExport => ({
      taskId: task.id,
      title: task.title,
      kind: task.kind,
      status: task.status,
      reason,
      evidence: [...task.evidence],
      resumeCommand: task.resumeCommand,
    })),
  );
  return {
    goalId: state.goalId,
    objective: state.objective,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    terminalReason: state.terminalReason,
    localStatePath: relativePath(root, paths.statePath),
    localQueuePath: relativePath(root, paths.queuePath),
    localBlockersPath: relativePath(root, paths.blockersPath),
    localLedgerPath: relativePath(root, paths.ledgerPath),
    ledgerEvents: ledgerEventStats(paths.ledgerPath),
    requiredTaskCount: state.tasks.filter((task) => task.required !== false).length,
    unblockedTasksRemaining: state.unblockedTasksRemaining,
    blockedTasksRemaining: state.blockedTasksRemaining,
    taskStatusCounts: countStatuses(TASK_STATUSES, state.tasks.map((task) => task.status)),
    blockedReasons,
    tasks,
  };
}

function ledgerEventStats(path: string): ProofloopGoalLedgerGoalExport["ledgerEvents"] {
  if (!existsSync(path)) return { count: 0 };
  const events = readFileSync(path, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const latest = events.length ? JSON.parse(events[events.length - 1]) as Partial<ProofloopGoalEvent> : undefined;
  return {
    count: events.length,
    latestTs: latest?.ts,
    latestType: latest?.type,
    latestTaskId: latest?.taskId,
  };
}

function countStatuses<T extends string>(keys: readonly T[], values: T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
  for (const value of values) counts[value] += 1;
  return counts;
}

function md(value: string): string {
  return value.replace(/\r?\n/g, "<br>").replace(/\|/g, "\\|");
}

function commandTask(args: { id: string; title: string; command: string; evidence: string[] }): ProofloopGoalTask {
  return {
    id: args.id,
    title: args.title,
    kind: "command",
    command: args.command,
    required: true,
    status: "pending",
    evidence: args.evidence,
    blockers: [],
    attempts: 0,
  };
}

function externalBlockerTask(args: { id: string; title: string; blockers: string[]; evidence: string[]; resumeCommand?: string }): ProofloopGoalTask {
  return {
    id: args.id,
    title: args.title,
    kind: "external_blocker",
    required: true,
    status: "pending",
    evidence: args.evidence,
    blockers: args.blockers,
    resumeCommand: args.resumeCommand,
    attempts: 0,
  };
}

function finalizeState(state: ProofloopGoalState, now: string): ProofloopGoalState {
  const required = state.tasks.filter((task) => task.required !== false);
  const failed = required.filter((task) => task.status === "failed");
  const scaffold = required.filter((task) => task.status === "needs_scaffold_or_run");
  const approvals = required.filter((task) => task.status === "needs_human_approval");
  const pending = required.filter((task) => task.status === "pending" || task.status === "running");
  const blockers = required.filter((task) => task.status === "blocked_external");

  if (failed.length) {
    state.status = "failed";
    state.terminalReason = `${failed.length} required task(s) failed.`;
  } else if (scaffold.length && pending.length === 0) {
    state.status = "needs_scaffold_or_run";
    state.terminalReason = `${scaffold.length} required task(s) still need local scaffold or model-run work before external-blocked can be claimed.`;
  } else if (approvals.length && pending.length === 0) {
    state.status = "needs_human_approval";
    state.terminalReason = `${approvals.length} required task(s) need human approval.`;
  } else if (pending.length > 0) {
    state.status = state.tasks.some((task) => task.status !== "pending") ? "running" : "initialized";
    state.terminalReason = undefined;
  } else if (blockers.length) {
    state.status = "blocked_external";
    state.terminalReason = `${blockers.length} required task(s) blocked by external requirements.`;
  } else {
    state.status = "passed";
    state.terminalReason = "All required tasks passed from persisted proof ledger state.";
  }

  state.unblockedTasksRemaining = required.filter((task) => task.status === "pending" && task.kind === "command").length;
  state.blockedTasksRemaining =
    blockers.length +
    scaffold.length +
    required.filter((task) => task.status === "pending" && task.kind !== "command").length;
  state.updatedAt = now;
  return state;
}

function taskEvent(type: ProofloopGoalEvent["type"], state: ProofloopGoalState, task: ProofloopGoalTask, ts: string): ProofloopGoalEvent {
  return {
    ts,
    goalId: state.goalId,
    type,
    status: task.status,
    taskId: task.id,
    command: task.command,
    exitCode: task.lastExitCode,
    evidence: task.evidence,
    blockers: task.blockers,
    resumeCommand: task.resumeCommand,
    unblockedTasksRemaining: state.unblockedTasksRemaining,
    blockedTasksRemaining: state.blockedTasksRemaining,
  };
}

function writeState(root: string, state: ProofloopGoalState): ProofloopGoalState {
  const paths = goalPaths(root, state.goalId);
  mkdirSync(paths.dir, { recursive: true });
  state.ledgerPath = relativePath(root, paths.ledgerPath);
  writeJson(paths.statePath, state);
  writeJson(paths.queuePath, state.tasks);
  writeJson(paths.blockersPath, state.tasks.filter((task) => task.status === "blocked_external"));
  appendFileSync(paths.heartbeatsPath, `${JSON.stringify({ ts: state.updatedAt, status: state.status })}\n`, "utf8");
  writeProofloopGoalLedgerReceipt({ root });
  return state;
}

function appendLedger(root: string, goalId: string, event: ProofloopGoalEvent): ProofloopGoalEvent {
  const path = goalPaths(root, goalId).ledgerPath;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
  writeProofloopGoalLedgerReceipt({ root });
  return event;
}

function goalPaths(root: string, goalId: string) {
  const safeGoalId = goalId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const dir = join(root, ".proofloop", "goals", safeGoalId);
  return {
    dir,
    statePath: join(dir, "state.json"),
    queuePath: join(dir, "queue.json"),
    blockersPath: join(dir, "blockers.json"),
    ledgerPath: join(dir, "ledger.jsonl"),
    heartbeatsPath: join(dir, "heartbeats.jsonl"),
  };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveRoot(root?: string): string {
  return resolve(root ?? process.env.PROOFLOOP_ROOT ?? process.cwd());
}

function isoNow(options: ProofloopGoalOptions): string {
  return (options.now?.() ?? new Date()).toISOString();
}

function cloneTasks(tasks: ProofloopGoalTask[]): ProofloopGoalTask[] {
  return JSON.parse(JSON.stringify(tasks)) as ProofloopGoalTask[];
}

function isTerminal(status: ProofloopGoalStatus): status is ProofloopGoalTerminalStatus {
  return ["passed", "blocked_external", "needs_scaffold_or_run", "needs_human_approval", "budget_exhausted", "failed"].includes(status);
}

function relativePath(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path;
}

function tail(value: string): string {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-40).join("\n");
}
