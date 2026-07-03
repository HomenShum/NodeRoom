import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  initProofloopGoal,
  loadProofloopGoal,
  officialScoresGoalTasks,
  type ProofloopGoalState,
  type ProofloopGoalTask,
} from "../../eval/proofloopGoalSupervisor";
import { solveProofloopBlocker } from "../../eval/proofloopBlockerSolver";
import {
  proofloopCodeGraphPaths,
  queryProofloopCodeGraph,
  writeProofloopCodeGraph,
} from "../codegraph/indexer";
import { detectProofloopWorkers } from "../workers/detectWorkers";
import type {
  ProofloopOrchestratorOptions,
  ProofloopOrchestratorResult,
  ProofloopOrchestratorState,
  ProofloopOrchestratorTask,
  ProofloopOrchestratorTaskSafety,
  ProofloopOrchestratorTerminalStatus,
  ProofloopWorkerDispatch,
} from "./types";

const DEFAULT_OBJECTIVE =
  "Make official benchmark scores real, tested, shipped, and externally blocked only with durable proof.";
const SAFE_COMMAND_MARKERS = [
  "benchmark:official:task-coverage",
  "benchmark:proofloop:normalized",
  "benchmark:proofloop:company-tasks",
  "benchmark:proofloop:harness-economics",
  "proofloop -- setup",
  "benchmark:proofloop:adapter-blockers",
  "proofloop -- solve-blockers",
  "proofloop -- charts",
  "benchmark:proofloop:board",
];
const EXPENSIVE_OR_LIVE_MARKERS = [
  "bankertoolbench:fullsuite-gate",
  "benchmark:spreadsheetbench:run",
  "benchmark:proofloop:external-adapter",
  "--prod",
  "--user-emulation strict",
  "livesuite",
];

export function runProofloopOrchestrator(options: ProofloopOrchestratorOptions): ProofloopOrchestratorResult {
  const root = resolve(options.root);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const mode = options.mode ?? "run";
  const goalId = options.goalId ?? "official-scores";
  const runId = options.runId ?? `${mode}-${goalId}-${safeTimestamp(generatedAt)}`;
  const runDir = join(root, ".proofloop", "orchestrator", "runs", runId);
  const maxSteps = options.maxSteps ?? 100;
  const dryRun = options.dryRun ?? mode === "plan";
  const executeSafe = options.executeSafe ?? mode === "dogfood";
  const objective = options.objective ?? DEFAULT_OBJECTIVE;
  const paths = orchestratorPaths(root, runDir);
  mkdirSync(paths.runDir, { recursive: true });

  appendEvent(paths.events, {
    ts: generatedAt,
    type: "orchestrator_started",
    mode,
    goalId,
    dryRun,
    executeSafe,
  });

  const codeGraph = writeProofloopCodeGraph({ root, generatedAt });
  const workerInventory = detectProofloopWorkers(generatedAt);
  const sourceTasks = loadSourceTasks({ root, goalId, template: options.template, freshTemplate: options.freshTemplate });
  const tasks = sourceTasks.map((task) => orchestratorTaskFromGoalTask(task, codeGraph, root));
  const state: ProofloopOrchestratorState = {
    schema: "proofloop-orchestrator-v1",
    runId,
    mode,
    goalId,
    objective,
    generatedAt,
    updatedAt: generatedAt,
    terminalStatus: "RUNNING",
    dryRun,
    executeSafe,
    maxSteps,
    stepsUsed: 0,
    paths: {
      runDir: relativePath(root, paths.runDir),
      state: relativePath(root, paths.state),
      queue: relativePath(root, paths.queue),
      events: relativePath(root, paths.events),
      workerDispatch: relativePath(root, paths.workerDispatch),
      summary: relativePath(root, paths.summary),
      codeGraphManifest: relativePath(root, proofloopCodeGraphPaths(root).manifestPath),
    },
    workerInventory,
    tasks,
    dispatches: [],
    summary: summarizeTasks(tasks),
  };

  for (const task of tasks) {
    if (state.stepsUsed >= maxSteps) break;
    if (task.status === "passed") continue;
    state.stepsUsed += 1;
    const stepTs = timestampAfter(generatedAt, state.stepsUsed);
    processTask({
      root,
      paths,
      state,
      task,
      dryRun,
      executeSafe,
      allowWorkerLaunch: Boolean(options.allowWorkerLaunch),
      ts: stepTs,
    });
    state.updatedAt = stepTs;
    state.summary = summarizeTasks(tasks);
    writeState(paths, state);
  }

  state.terminalStatus = terminalStatusFor(state, maxSteps);
  state.updatedAt = timestampAfter(generatedAt, state.stepsUsed + 1);
  state.summary = summarizeTasks(tasks);
  writeState(paths, state);
  writeSummary(paths.summary, state);
  const publicState = redactStateForPublication(state);
  if (options.jsonOut) writeJson(resolve(root, options.jsonOut), publicState);
  if (options.mdOut) writeFileSync(resolve(root, options.mdOut), renderSummaryMarkdown(publicState), "utf8");
  appendEvent(paths.events, {
    ts: state.updatedAt,
    type: "orchestrator_finished",
    terminalStatus: state.terminalStatus,
    summary: state.summary,
  });

  return { state };
}

function loadSourceTasks(args: {
  root: string;
  goalId: string;
  template?: "official-scores";
  freshTemplate?: boolean;
}): ProofloopGoalTask[] {
  if (args.freshTemplate && args.template === "official-scores") return cloneTasks(officialScoresGoalTasks());
  try {
    return cloneTasks(loadProofloopGoal(args.goalId, { root: args.root }).tasks);
  } catch {
    if (args.template === "official-scores" || args.goalId === "official-scores") {
      let state: ProofloopGoalState;
      try {
        state = initProofloopGoal({
          root: args.root,
          goalId: args.goalId,
          template: "official-scores",
          objective: DEFAULT_OBJECTIVE,
        });
      } catch {
        state = loadProofloopGoal(args.goalId, { root: args.root });
      }
      return cloneTasks(state.tasks);
    }
    throw new Error(`Goal does not exist: ${args.goalId}`);
  }
}

function orchestratorTaskFromGoalTask(
  task: ProofloopGoalTask,
  codeGraph: ReturnType<typeof writeProofloopCodeGraph>,
  root: string,
): ProofloopOrchestratorTask {
  const safety = classifyTaskSafety(task);
  const initialStatus = task.status === "passed" ? "passed" : "queued";
  const query = [task.id, task.title, task.command, task.blockers.join(" "), task.resumeCommand].filter(Boolean).join(" ");
  return {
    id: task.id,
    title: task.title,
    sourceStatus: task.status,
    kind: task.kind,
    command: task.command,
    safety,
    status: initialStatus,
    evidence: [...task.evidence],
    blockers: [...task.blockers],
    resumeCommand: task.resumeCommand,
    attempts: task.attempts,
    likelyFiles: queryProofloopCodeGraph(codeGraph, query || task.id).map((hit) => ({
      ...hit,
      path: hit.path ? relativePath(root, resolve(root, hit.path)) : undefined,
    })),
  };
}

function classifyTaskSafety(task: ProofloopGoalTask): ProofloopOrchestratorTaskSafety {
  const text = `${task.command ?? ""} ${task.title} ${task.blockers.join(" ")}`.toLowerCase();
  if (task.kind === "human_approval") return "external";
  if (task.kind === "external_blocker") return "requires_worker";
  if (EXPENSIVE_OR_LIVE_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) return "expensive_or_live";
  if (SAFE_COMMAND_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) return "safe_local";
  return task.command ? "requires_worker" : "external";
}

function processTask(args: {
  root: string;
  paths: ReturnType<typeof orchestratorPaths>;
  state: ProofloopOrchestratorState;
  task: ProofloopOrchestratorTask;
  dryRun: boolean;
  executeSafe: boolean;
  allowWorkerLaunch: boolean;
  ts: string;
}): void {
  appendEvent(args.paths.events, {
    ts: args.ts,
    type: "task_selected",
    taskId: args.task.id,
    safety: args.task.safety,
  });

  if (args.task.safety === "safe_local" && args.task.command && args.executeSafe && !args.dryRun) {
    runSafeCommand(args);
    return;
  }

  if (args.task.kind === "external_blocker" && args.executeSafe && !args.dryRun) {
    const solver = solveProofloopBlocker({
      root: args.root,
      task: {
        id: args.task.id,
        title: args.task.title,
        blockers: args.task.blockers,
        evidence: args.task.evidence,
        resumeCommand: args.task.resumeCommand,
      },
      phase: "solve",
      generatedAt: args.ts,
    });
    args.task.status = solver.externalBlockClaimAllowed ? "blocked_external" : "needs_scaffold_or_run";
    args.task.evidence = [...new Set([...args.task.evidence, ...Object.values(solver.artifacts)])];
    args.task.resumeCommand = solver.nextCommands[0] ?? args.task.resumeCommand;
    appendEvent(args.paths.events, {
      ts: args.ts,
      type: "blocker_solver_ran",
      taskId: args.task.id,
      status: args.task.status,
      artifacts: solver.artifacts,
    });
    writeRepairContext(args);
    return;
  }

  args.task.status = statusForUnexecutedTask(args.task);
  writeRepairContext(args);
}

function runSafeCommand(args: {
  root: string;
  paths: ReturnType<typeof orchestratorPaths>;
  state: ProofloopOrchestratorState;
  task: ProofloopOrchestratorTask;
  ts: string;
  allowWorkerLaunch: boolean;
}): void {
  const leasePath = join(args.paths.leasesDir, `${args.task.id}.json`);
  writeJson(leasePath, {
    schema: "proofloop-orchestrator-lease-v1",
    taskId: args.task.id,
    command: args.task.command,
    leasedAt: args.ts,
    worker: "local-shell",
  });
  appendFileSync(
    args.paths.heartbeats,
    `${JSON.stringify({ ts: args.ts, taskId: args.task.id, status: "running", worker: "local-shell" })}\n`,
    "utf8",
  );
  args.task.status = "running";
  appendEvent(args.paths.events, { ts: args.ts, type: "command_started", taskId: args.task.id, command: args.task.command });
  const result = spawnSync(args.task.command ?? "", {
    cwd: args.root,
    shell: true,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  });
  args.task.exitCode = result.status ?? 1;
  args.task.stdoutTail = tail(result.stdout ?? "");
  args.task.stderrTail = tail(result.stderr ?? "");
  args.task.status = args.task.exitCode === 0 ? "passed" : "failed";
  appendFileSync(
    args.paths.heartbeats,
    `${JSON.stringify({ ts: args.ts, taskId: args.task.id, status: args.task.status, worker: "local-shell" })}\n`,
    "utf8",
  );
  appendEvent(args.paths.events, {
    ts: args.ts,
    type: args.task.status === "passed" ? "command_passed" : "command_failed",
    taskId: args.task.id,
    exitCode: args.task.exitCode,
  });
  if (args.task.status === "failed") writeRepairContext(args);
}

function writeRepairContext(args: {
  root: string;
  paths: ReturnType<typeof orchestratorPaths>;
  state: ProofloopOrchestratorState;
  task: ProofloopOrchestratorTask;
  ts: string;
  allowWorkerLaunch: boolean;
}): void {
  const promptPath = join(args.paths.repairContextsDir, `${args.task.id}.md`);
  const workerKind = firstAvailableAgent(args.state) ?? "manual";
  const dispatch: ProofloopWorkerDispatch = {
    taskId: args.task.id,
    workerKind,
    status: args.allowWorkerLaunch && workerKind !== "manual" ? "not_launched" : "written",
    reason: dispatchReason(args.task, args.allowWorkerLaunch, workerKind),
    promptPath: relativePath(args.root, promptPath),
    command: args.task.command,
  };
  args.state.dispatches = [...args.state.dispatches.filter((item) => item.taskId !== args.task.id), dispatch];
  args.task.repairContextPath = dispatch.promptPath;
  mkdirSync(dirname(promptPath), { recursive: true });
  writeFileSync(promptPath, renderRepairContext(args.state, args.task, dispatch), "utf8");
  writeJson(args.paths.workerDispatch, args.state.dispatches);
  appendEvent(args.paths.events, {
    ts: args.ts,
    type: "repair_context_written",
    taskId: args.task.id,
    promptPath: dispatch.promptPath,
    workerKind,
  });
}

function statusForUnexecutedTask(task: ProofloopOrchestratorTask): ProofloopOrchestratorTask["status"] {
  if (task.safety === "external") return "blocked_external";
  if (task.safety === "expensive_or_live") return "needs_worker";
  if (task.safety === "requires_worker") return "needs_scaffold_or_run";
  return "skipped";
}

function terminalStatusFor(
  state: ProofloopOrchestratorState,
  maxSteps: number,
): ProofloopOrchestratorTerminalStatus {
  if (state.stepsUsed >= maxSteps && state.summary.notDone > 0) return "BUDGET_EXHAUSTED";
  if (state.summary.failed > 0) return "FAILED_AFTER_MAX_RETRIES";
  if (state.summary.notDone === 0) return "PASS";
  const notDone = state.tasks.filter((task) => task.status !== "passed");
  const onlyExternal = notDone.every((task) => task.status === "blocked_external");
  if (onlyExternal) return "BLOCKED_EXTERNAL_AFTER_ALL_LOCAL_WORK_DONE";
  return "NEEDS_HUMAN_APPROVAL";
}

function summarizeTasks(tasks: ProofloopOrchestratorTask[]): ProofloopOrchestratorState["summary"] {
  const passed = tasks.filter((task) => task.status === "passed").length;
  const failed = tasks.filter((task) => task.status === "failed").length;
  const blockedExternal = tasks.filter((task) => task.status === "blocked_external").length;
  const needsScaffoldOrRun = tasks.filter((task) => task.status === "needs_scaffold_or_run").length;
  const needsWorker = tasks.filter((task) => task.status === "needs_worker").length;
  const skipped = tasks.filter((task) => task.status === "skipped" || task.status === "queued").length;
  return {
    passed,
    failed,
    blockedExternal,
    needsScaffoldOrRun,
    needsWorker,
    skipped,
    notDone: tasks.length - passed,
  };
}

function renderRepairContext(
  state: ProofloopOrchestratorState,
  task: ProofloopOrchestratorTask,
  dispatch: ProofloopWorkerDispatch,
): string {
  const lines = [
    `# ProofLoop Orchestrator Repair Context: ${task.id}`,
    "",
    `Goal: ${state.goalId}`,
    `Objective: ${state.objective}`,
    `Task: ${task.title}`,
    `Status: ${task.status}`,
    `Safety: ${task.safety}`,
    `Dispatch: ${dispatch.workerKind} (${dispatch.status})`,
    "",
  ];
  if (task.command) lines.push("## Command", "", "```bash", task.command, "```", "");
  if (task.resumeCommand) lines.push("## Resume Command", "", "```bash", task.resumeCommand, "```", "");
  if (task.blockers.length) {
    lines.push("## Blockers");
    for (const blocker of task.blockers) lines.push(`- ${blocker}`);
    lines.push("");
  }
  lines.push("## Likely Files");
  for (const hit of task.likelyFiles.slice(0, 10)) {
    lines.push(`- ${hit.path ?? hit.label} (${hit.kind}, score ${hit.score}, ${hit.reasons.join(", ") || "matched"})`);
  }
  lines.push("", "## Rules");
  lines.push("- Do not weaken locked certification gates or immutable verifier fixtures.");
  lines.push("- Safe local proof/scaffold commands may run automatically; official model spend, private products, and judge credentials need explicit approval or an external managed worker.");
  lines.push("- Record every change back to the Proof Loop goal ledger, blocker lane artifacts, or orchestrator dispatch state.");
  lines.push("- Rerun the relevant proof command and update this task until it is passed or externally blocked with evidence.");
  return `${lines.join("\n")}\n`;
}

function renderSummaryMarkdown(state: ProofloopOrchestratorState): string {
  const lines = [
    "# ProofLoop Orchestrator Dogfood",
    "",
    `Run: ${state.runId}`,
    `Goal: ${state.goalId}`,
    `Terminal status: ${state.terminalStatus}`,
    `Safe execution: ${state.executeSafe && !state.dryRun ? "enabled" : "not executed"}`,
    `Steps used: ${state.stepsUsed}/${state.maxSteps}`,
    "",
    "## Summary",
    "",
    `- Passed: ${state.summary.passed}`,
    `- Failed: ${state.summary.failed}`,
    `- Needs scaffold/model run: ${state.summary.needsScaffoldOrRun}`,
    `- Needs worker/approval: ${state.summary.needsWorker}`,
    `- External-blocked: ${state.summary.blockedExternal}`,
    `- Not done: ${state.summary.notDone}`,
    "",
    "## Not Done",
    "",
  ];
  for (const task of state.tasks.filter((candidate) => candidate.status !== "passed")) {
    lines.push(`### ${task.id}`);
    lines.push("");
    lines.push(`Status: ${task.status}`);
    lines.push(`Safety: ${task.safety}`);
    if (task.repairContextPath) lines.push(`Repair context: ${task.repairContextPath}`);
    if (task.resumeCommand) lines.push(`Resume: \`${task.resumeCommand}\``);
    for (const blocker of task.blockers.slice(0, 4)) lines.push(`- ${blocker}`);
    lines.push("");
  }
  lines.push("## Worker Inventory", "");
  for (const worker of state.workerInventory.workers) {
    lines.push(`- ${worker.kind}: ${worker.available ? worker.resolvedPath ?? "available" : "missing"}`);
  }
  return `${lines.join("\n")}\n`;
}

function redactStateForPublication(state: ProofloopOrchestratorState): ProofloopOrchestratorState {
  return {
    ...state,
    workerInventory: {
      ...state.workerInventory,
      workers: state.workerInventory.workers.map((worker) => ({
        ...worker,
        resolvedPath: worker.available ? "[local-path-redacted]" : undefined,
      })),
    },
  };
}

function writeSummary(path: string, state: ProofloopOrchestratorState): void {
  writeFileSync(path, renderSummaryMarkdown(state), "utf8");
}

function writeState(paths: ReturnType<typeof orchestratorPaths>, state: ProofloopOrchestratorState): void {
  writeJson(paths.state, state);
  writeJson(paths.queue, state.tasks);
  writeJson(paths.workerDispatch, state.dispatches);
}

function orchestratorPaths(root: string, runDir: string) {
  return {
    runDir,
    state: join(runDir, "orchestrator-state.json"),
    queue: join(runDir, "task-queue.json"),
    events: join(runDir, "events.jsonl"),
    heartbeats: join(runDir, "heartbeats.jsonl"),
    workerDispatch: join(runDir, "worker-dispatch.json"),
    summary: join(runDir, "summary.md"),
    repairContextsDir: join(runDir, "repair-contexts"),
    leasesDir: join(runDir, "leases"),
    root,
  };
}

function firstAvailableAgent(state: ProofloopOrchestratorState): "codex" | "claude" | undefined {
  if (state.workerInventory.workers.find((worker) => worker.kind === "codex" && worker.available)) return "codex";
  if (state.workerInventory.workers.find((worker) => worker.kind === "claude" && worker.available)) return "claude";
  return undefined;
}

function dispatchReason(
  task: ProofloopOrchestratorTask,
  allowWorkerLaunch: boolean,
  workerKind: ProofloopWorkerDispatch["workerKind"],
): string {
  if (!allowWorkerLaunch) return "Worker launch was not allowed for this orchestrator run; dispatch packet was written for resume.";
  if (workerKind === "manual") return "No local Codex/Claude CLI was detected; dispatch packet requires an external managed agent or human operator.";
  if (task.safety === "expensive_or_live") return "Task touches live/expensive proof paths and needs explicit spend or production approval before launch.";
  return "Dispatch packet is ready for the detected coding worker.";
}

function appendEvent(path: string, event: Record<string, unknown>): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, "utf8");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function tail(value: string): string {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-40).join("\n");
}

function cloneTasks(tasks: ProofloopGoalTask[]): ProofloopGoalTask[] {
  return JSON.parse(JSON.stringify(tasks)) as ProofloopGoalTask[];
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

function timestampAfter(base: string, seconds: number): string {
  const date = new Date(base);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  date.setUTCSeconds(date.getUTCSeconds() + seconds);
  return date.toISOString();
}

function relativePath(root: string, path: string): string {
  const normalizedRoot = normalizeSlash(resolve(root));
  const normalizedPath = normalizeSlash(resolve(path));
  return normalizedPath.startsWith(normalizedRoot)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}
