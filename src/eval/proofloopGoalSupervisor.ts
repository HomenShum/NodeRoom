import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ProofloopGoalTerminalStatus =
  | "passed"
  | "blocked_external"
  | "needs_human_approval"
  | "budget_exhausted"
  | "failed";

export type ProofloopGoalStatus = "initialized" | "running" | ProofloopGoalTerminalStatus;

export type ProofloopGoalTaskStatus =
  | "pending"
  | "running"
  | "passed"
  | "blocked_external"
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
      title: "External adapter local product-path browser proofs",
      command: "npm run benchmark:proofloop:external-adapter -- --prod --user-emulation strict",
      evidence: [
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
        "Only the public/example SpreadsheetBench V2 slice is staged locally.",
        "All 321 V2 tasks need official bundle, model-run, workbook scorer, and rendered chart-grader evidence; proxy judges can improve candidates but cannot stand in for the V2 scorer path.",
      ],
      evidence: ["docs/eval/official-benchmark-task-coverage.json"],
      resumeCommand:
        "stage the full SpreadsheetBench V2 321-task bundle, run all tasks and scorer/chart grader, use npm run benchmark:proofloop:harness-economics for proxy-model routing, then npm run benchmark:official:task-coverage -- --strict",
    }),
    externalBlockerTask({
      id: "finch-official-score",
      title: "Finch / FinWorkBench official score",
      blockers: [
        "finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external; scored receipt is still required before claiming score.",
        "finch: official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is staged, but NodeRoom still needs one official-output artifact per Finch task id and an accepted upstream judge/scorer path; Azure OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.",
      ],
      evidence: [
        ".proofloop/setup/finch-local-setup.json",
        "proofloop/benchmarks/finch/adapter.json",
        "docs/eval/proofloop-external-adapter-runs/finch.json",
        "docs/eval/proofloop-adapter-blockers/finch.json",
        "docs/eval/proofloop-official-task-bundles/finch.json",
        "docs/eval/proofloop-official-scores/finch.json",
      ],
      resumeCommand: "emit NodeRoom outputs for every official Finch task id, run/import the accepted upstream Finch scorer or judge output, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
    }),
    externalBlockerTask({
      id: "finauditing-official-score",
      title: "FinAuditing official score",
      blockers: [
        "finauditing: official scorer receipt docs/eval/proofloop-official-scores/finauditing.json is blocked_external; scored receipt is still required before claiming score.",
        "finauditing: official task bundle lock docs/eval/proofloop-official-task-bundles/finauditing.json is staged, but NodeRoom still needs official-format FinSM/FinRE/FinMR prediction JSONL and an accepted FinMR judge path; OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.",
      ],
      evidence: [
        ".proofloop/setup/finauditing-local-setup.json",
        "proofloop/benchmarks/finauditing/adapter.json",
        "docs/eval/proofloop-external-adapter-runs/finauditing.json",
        "docs/eval/proofloop-adapter-blockers/finauditing.json",
        "docs/eval/proofloop-official-task-bundles/finauditing.json",
        "docs/eval/proofloop-official-scores/finauditing.json",
      ],
      resumeCommand: "emit official-format FinSM/FinRE/FinMR predictions, run/import FinAuditing scorer output with an accepted FinMR judge path, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict",
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
    task.status = "blocked_external";
    task.finishedAt = now;
    task.attempts += 1;
    const updated = writeState(root, finalizeState(state, now));
    const event = appendLedger(root, goalId, taskEvent("task_blocked_external", updated, task, now));
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
    blockers: state.tasks.filter((task) => task.status === "blocked_external").flatMap((task) => task.blockers),
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
  return `${lines.join("\n")}\n`;
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
  const approvals = required.filter((task) => task.status === "needs_human_approval");
  const pending = required.filter((task) => task.status === "pending" || task.status === "running");
  const blockers = required.filter((task) => task.status === "blocked_external");

  if (failed.length) {
    state.status = "failed";
    state.terminalReason = `${failed.length} required task(s) failed.`;
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
  state.blockedTasksRemaining = blockers.length + required.filter((task) => task.status === "pending" && task.kind !== "command").length;
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
  writeJson(paths.statePath, state);
  writeJson(paths.queuePath, state.tasks);
  writeJson(paths.blockersPath, state.tasks.filter((task) => task.status === "blocked_external"));
  appendFileSync(paths.heartbeatsPath, `${JSON.stringify({ ts: state.updatedAt, status: state.status })}\n`, "utf8");
  return state;
}

function appendLedger(root: string, goalId: string, event: ProofloopGoalEvent): ProofloopGoalEvent {
  const path = goalPaths(root, goalId).ledgerPath;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
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
  return ["passed", "blocked_external", "needs_human_approval", "budget_exhausted", "failed"].includes(status);
}

function relativePath(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length + 1).replace(/\\/g, "/") : path;
}

function tail(value: string): string {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-40).join("\n");
}
