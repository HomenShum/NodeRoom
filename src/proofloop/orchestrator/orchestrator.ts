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
import { proofloopModelRouteForRun } from "../../eval/proofloopModelTracking";
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
  ProofloopLongRunControlPlane,
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
      heartbeats: relativePath(root, paths.heartbeats),
      workerDispatch: relativePath(root, paths.workerDispatch),
      summary: relativePath(root, paths.summary),
      dashboard: relativePath(root, paths.dashboard),
      evaluatorReceipt: relativePath(root, paths.evaluatorReceipt),
      sessionMemory: relativePath(root, paths.sessionMemory),
      codeGraphManifest: relativePath(root, proofloopCodeGraphPaths(root).manifestPath),
    },
    workerInventory,
    tasks,
    dispatches: [],
    summary: summarizeTasks(tasks),
    longRun: placeholderLongRunControlPlane({
      objective,
      generatedAt,
      maxSteps,
      paths,
      root,
      tasks,
      workerInventory,
    }),
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
    refreshLongRunState(paths, state);
    writeState(paths, state);
  }

  state.terminalStatus = terminalStatusFor(state, maxSteps);
  state.updatedAt = timestampAfter(generatedAt, state.stepsUsed + 1);
  state.summary = summarizeTasks(tasks);
  refreshLongRunState(paths, state);
  writeLongRunArtifacts(paths, state);
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
  lines.push("- The detached evaluator, verifier stack, dashboard, and session-mined rules decide completion; do not stop on a transcript summary.");
  const minedRules = state.longRun.memory.minedRules.filter((rule) => rule.evidenceTaskIds.includes(task.id));
  if (minedRules.length) {
    lines.push("", "## Session-Mined Rules");
    for (const rule of minedRules) lines.push(`- ${rule.rule}`);
  }
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
    `- Skipped/queued: ${state.summary.skipped}`,
    `- Not done: ${state.summary.notDone}`,
    "",
    "## Long-Running Control Plane",
    "",
    `- Goal contract criteria: ${state.longRun.goalContract.measurableExitCriteria.length}`,
    `- Detached evaluator: ${state.longRun.evaluator.verdict} (${state.longRun.evaluator.kind}, shared executor context: ${state.longRun.evaluator.sharesExecutorContext})`,
    `- Deterministic verifiers: ${state.longRun.verifierStack.deterministic.length}`,
    `- Expensive/live verifiers: ${state.longRun.verifierStack.expensiveOrLive.length}`,
    `- Outer loop: ${state.longRun.outerLoop.stepsUsed}/${state.longRun.outerLoop.maxSteps} steps, ${state.longRun.outerLoop.notDoneTaskIds.length} not done`,
    `- Dashboard: ${state.longRun.observability.dashboardPath}`,
    `- Session memory: ${state.longRun.memory.memoryPath}`,
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

function refreshLongRunState(paths: ReturnType<typeof orchestratorPaths>, state: ProofloopOrchestratorState): void {
  state.longRun = buildLongRunControlPlane(paths, state);
}

function placeholderLongRunControlPlane(args: {
  objective: string;
  generatedAt: string;
  maxSteps: number;
  paths: ReturnType<typeof orchestratorPaths>;
  root: string;
  tasks: ProofloopOrchestratorTask[];
  workerInventory: ProofloopOrchestratorState["workerInventory"];
}): ProofloopLongRunControlPlane {
  const summary = summarizeTasks(args.tasks);
  const notDoneTaskIds = args.tasks.filter((task) => task.status !== "passed").map((task) => task.id);
  return {
    schema: "proofloop-long-running-agent-v1",
    goalContract: goalContract(args.objective),
    evaluator: {
      schema: "proofloop-detached-evaluator-v1",
      kind: "deterministic_state_judge",
      sharesExecutorContext: false,
      verdict: summary.notDone === 0 ? "pass" : "not_done",
      checkedAt: args.generatedAt,
      reasons: summary.notDone === 0
        ? ["All queued tasks are already passed in the durable state."]
        : [`${summary.notDone} task(s) still need proof, worker execution, or accepted external receipts.`],
    },
    verifierStack: verifierStackFor(args.tasks, {
      state: relativePath(args.root, args.paths.state),
      queue: relativePath(args.root, args.paths.queue),
      dashboard: relativePath(args.root, args.paths.dashboard),
      evaluatorReceipt: relativePath(args.root, args.paths.evaluatorReceipt),
      sessionMemory: relativePath(args.root, args.paths.sessionMemory),
    }),
    outerLoop: {
      enabled: true,
      maxSteps: args.maxSteps,
      stepsUsed: 0,
      earlyStopPolicy: "terminal_status_only_after_evaluator_and_verifiers",
      retryPolicy: "resume unfinished tasks from durable queue; failed commands get repair context before retry",
      notDoneTaskIds,
    },
    orchestration: orchestrationFor(args.workerInventory, 0, args.objective),
    observability: observabilityFor(args.root, args.paths),
    memory: memoryFor(args.root, args.paths, args.tasks),
  };
}

function buildLongRunControlPlane(
  paths: ReturnType<typeof orchestratorPaths>,
  state: ProofloopOrchestratorState,
): ProofloopLongRunControlPlane {
  return {
    schema: "proofloop-long-running-agent-v1",
    goalContract: goalContract(state.objective),
    evaluator: evaluateLongRunState(state),
    verifierStack: verifierStackFor(state.tasks, state.paths),
    outerLoop: {
      enabled: true,
      maxSteps: state.maxSteps,
      stepsUsed: state.stepsUsed,
      earlyStopPolicy: "terminal_status_only_after_evaluator_and_verifiers",
      retryPolicy: "resume unfinished tasks from durable queue; failed commands get repair context before retry",
      notDoneTaskIds: state.tasks.filter((task) => task.status !== "passed").map((task) => task.id),
    },
    orchestration: orchestrationFor(state.workerInventory, state.dispatches.length, state.objective),
    observability: observabilityFor(paths.root, paths),
    memory: memoryFor(paths.root, paths, state.tasks),
  };
}

function goalContract(objective: string): ProofloopLongRunControlPlane["goalContract"] {
  return {
    objective,
    measurableExitCriteria: [
      "Every required queue task is passed, or the remaining task is blocked only by a named accepted external scorer, credential, production approval, or managed worker.",
      "Every unfinished task has a repair context or dispatch packet that names command, blockers, likely files, and resume evidence.",
      "Safe local verifier commands must be executed and recorded before terminal PASS.",
      "Official benchmark scores cannot be promoted from proxy-model or transcript-only evidence.",
      "Dashboard, detached evaluator receipt, and session-memory artifacts must be written for the run.",
    ],
    acceptedTerminalStatuses: ["PASS", "BLOCKED_EXTERNAL_AFTER_ALL_LOCAL_WORK_DONE"],
    nonGoals: [
      "Do not treat a chat transcript, model assertion, or cost-only proxy judge as an official score.",
      "Do not spend on live/prod/model-judge work without an explicit approved worker or credential path.",
      "Do not weaken locked verifier fixtures or certification-loop gates to make a run pass.",
    ],
  };
}

function evaluateLongRunState(
  state: ProofloopOrchestratorState,
): ProofloopLongRunControlPlane["evaluator"] {
  const reasons: string[] = [];
  let verdict: ProofloopLongRunControlPlane["evaluator"]["verdict"] = "not_done";
  if (state.summary.failed > 0) {
    verdict = "failed";
    reasons.push(`${state.summary.failed} deterministic command(s) failed and need repair before continuation.`);
  } else if (state.summary.notDone === 0) {
    verdict = "pass";
    reasons.push("All queued tasks are passed in the durable orchestrator state.");
  } else if (state.stepsUsed >= state.maxSteps) {
    verdict = "budget_exhausted";
    reasons.push(`The outer loop used ${state.stepsUsed}/${state.maxSteps} steps with ${state.summary.notDone} task(s) still not done.`);
  } else {
    reasons.push(`${state.summary.notDone} task(s) still need proof, worker execution, approval, or accepted external receipts.`);
  }

  const missingRepair = state.tasks
    .filter((task) => task.status !== "passed" && task.status !== "blocked_external" && !task.repairContextPath)
    .map((task) => task.id);
  if (missingRepair.length) {
    reasons.push(`Unfinished non-external task(s) without repair context: ${missingRepair.join(", ")}.`);
  }
  const officialPromotionBlockers = state.tasks
    .filter((task) => task.id.includes("official-score") && task.status !== "passed")
    .map((task) => task.id);
  if (officialPromotionBlockers.length) {
    reasons.push(`Official score promotion remains blocked for: ${officialPromotionBlockers.join(", ")}.`);
  }

  return {
    schema: "proofloop-detached-evaluator-v1",
    kind: "deterministic_state_judge",
    sharesExecutorContext: false,
    verdict,
    checkedAt: state.updatedAt,
    reasons,
  };
}

function verifierStackFor(
  tasks: ProofloopOrchestratorTask[],
  paths: Pick<ProofloopOrchestratorState["paths"], "state" | "queue" | "dashboard" | "evaluatorReceipt" | "sessionMemory">,
): ProofloopLongRunControlPlane["verifierStack"] {
  const deterministic = new Set<string>([
    "tests/proofloopOrchestrator.test.ts",
    "npm run typecheck -- --pretty false",
  ]);
  const expensiveOrLive = new Set<string>();
  const officialPromotionBlockedBy = new Set<string>();
  const receiptPaths = new Set<string>([
    paths.state,
    paths.queue,
    paths.dashboard,
    paths.evaluatorReceipt,
    paths.sessionMemory,
  ]);

  for (const task of tasks) {
    for (const evidence of task.evidence) receiptPaths.add(evidence);
    if (task.safety === "safe_local" && task.command) deterministic.add(task.command);
    if (task.safety === "expensive_or_live" && task.command) expensiveOrLive.add(task.command);
    if (task.id.includes("official-score") && task.status !== "passed") officialPromotionBlockedBy.add(task.id);
  }

  return {
    deterministic: [...deterministic],
    expensiveOrLive: [...expensiveOrLive],
    officialPromotionBlockedBy: [...officialPromotionBlockedBy],
    receiptPaths: [...receiptPaths],
  };
}

function orchestrationFor(
  workerInventory: ProofloopOrchestratorState["workerInventory"],
  workerDispatches: number,
  objective: string,
): ProofloopLongRunControlPlane["orchestration"] {
  const availableWorkers = workerInventory.workers
    .filter((worker) => worker.available)
    .map((worker) => worker.kind);
  return {
    workerDispatches,
    availableWorkers,
    roles: [
      {
        role: "planner",
        route: proofloopModelRouteForRun({
          suite: "proofloop-orchestrator-planner",
          cmd: objective,
          role: "planner",
          env: roleEnv("PROOFLOOP_PLANNER_MODEL_ID", "deepseek/deepseek-v4-pro", "cheap long-run planning/proxy triage route; official score promotion still requires accepted scorers"),
        }),
        costPolicy: "Use cheap OpenRouter planner/proxy routes for scaffold research and capability comparison before any official scorer spend.",
        launchSurface: "worker-dispatch",
      },
      {
        role: "executor",
        route: proofloopModelRouteForRun({
          suite: "proofloop-orchestrator-executor",
          cmd: objective,
          role: "worker",
          env: roleEnv("PROOFLOOP_EXECUTOR_MODEL_ID", "local/deterministic", "safe local commands run deterministically; coding workers receive repair packets"),
        }),
        costPolicy: "Run safe local commands automatically; defer code-agent launches unless explicitly allowed.",
        launchSurface: "local-shell",
      },
      {
        role: "evaluator",
        route: proofloopModelRouteForRun({
          suite: "proofloop-orchestrator-evaluator",
          cmd: objective,
          role: "judge",
          env: roleEnv("PROOFLOOP_EVALUATOR_MODEL_ID", "local/deterministic", "detached deterministic state judge reads receipts rather than executor transcript"),
        }),
        costPolicy: "Use deterministic state judgment first; model judges are expensive verifier add-ons, not default completion authority.",
        launchSurface: "deterministic-receipt",
      },
      {
        role: "verifier",
        route: proofloopModelRouteForRun({
          suite: "proofloop-orchestrator-verifier",
          cmd: objective,
          role: "verifier",
          env: roleEnv("PROOFLOOP_VERIFIER_MODEL_ID", "local/deterministic", "strict verifier stack starts with tests, receipts, and official scorers"),
        }),
        costPolicy: "Deterministic verifiers run first; live/prod and official scorers stay explicit.",
        launchSurface: "deterministic-receipt",
      },
      {
        role: "memory_miner",
        route: proofloopModelRouteForRun({
          suite: "proofloop-orchestrator-memory",
          cmd: objective,
          role: "worker",
          env: roleEnv("PROOFLOOP_MEMORY_MODEL_ID", "local/deterministic", "session mining turns unfinished task patterns into durable rules"),
        }),
        costPolicy: "Mine rules locally from failure receipts before asking for a stronger model.",
        launchSurface: "deterministic-receipt",
      },
    ],
  };
}

function observabilityFor(
  root: string,
  paths: ReturnType<typeof orchestratorPaths>,
): ProofloopLongRunControlPlane["observability"] {
  return {
    rawEventLog: relativePath(root, paths.events),
    heartbeatLog: relativePath(root, paths.heartbeats),
    dashboardPath: relativePath(root, paths.dashboard),
    workerDispatchPath: relativePath(root, paths.workerDispatch),
    repairContextDir: relativePath(root, paths.repairContextsDir),
    summaryPath: relativePath(root, paths.summary),
    feedbackSurfaces: [
      "worker-dispatch.json for agent handoff",
      "repair-contexts/*.md for task-level continuation",
      "dashboard.json for live monitoring",
      "session-memory.json for recurring failure rules",
    ],
  };
}

function memoryFor(
  root: string,
  paths: ReturnType<typeof orchestratorPaths>,
  tasks: ProofloopOrchestratorTask[],
): ProofloopLongRunControlPlane["memory"] {
  return {
    sessionMiningPolicy: "mine_unfinished_tasks_into_rules",
    memoryPath: relativePath(root, paths.sessionMemory),
    minedRules: mineSessionRules(tasks),
    priorFailurePatterns: [...new Set(tasks
      .filter((task) => task.status !== "passed")
      .flatMap((task) => [
        task.safety,
        task.status,
        task.kind,
      ]))],
  };
}

function mineSessionRules(tasks: ProofloopOrchestratorTask[]): ProofloopLongRunControlPlane["memory"]["minedRules"] {
  const rules: ProofloopLongRunControlPlane["memory"]["minedRules"] = [];
  const byPredicate = (predicate: (task: ProofloopOrchestratorTask) => boolean) => tasks.filter(predicate).map((task) => task.id);
  const notDone = byPredicate((task) => task.status !== "passed");
  const needsScaffold = byPredicate((task) => task.status === "needs_scaffold_or_run");
  const needsWorker = byPredicate((task) => task.status === "needs_worker" || task.safety === "expensive_or_live");
  const officialBlocked = byPredicate((task) => task.id.includes("official-score") && task.status !== "passed");
  const failed = byPredicate((task) => task.status === "failed");

  if (notDone.length) {
    rules.push({
      id: "do-not-stop-while-not-done",
      rule: "A ProofLoop run is not complete while any durable queue task is not passed or accepted as externally blocked.",
      evidenceTaskIds: notDone,
    });
  }
  if (needsScaffold.length) {
    rules.push({
      id: "scaffold-blockers-into-runnable-receipts",
      rule: "Convert each blocker into a concrete scaffold, command, receipt path, and repair context before asking for completion.",
      evidenceTaskIds: needsScaffold,
    });
  }
  if (needsWorker.length) {
    rules.push({
      id: "approval-for-live-expensive-work",
      rule: "Live/prod, expensive model, and coding-worker launches require an explicit approved dispatch path.",
      evidenceTaskIds: needsWorker,
    });
  }
  if (officialBlocked.length) {
    rules.push({
      id: "proxy-judges-do-not-promote-official-scores",
      rule: "Cheap proxy judges can triage product quality, but official-score claims require accepted upstream scorer or judge receipts.",
      evidenceTaskIds: officialBlocked,
    });
  }
  if (failed.length) {
    rules.push({
      id: "repair-failed-local-command-first",
      rule: "A failed deterministic command must be repaired and rerun before spending on downstream live or model-judge work.",
      evidenceTaskIds: failed,
    });
  }
  if (!rules.length) {
    rules.push({
      id: "persist-receipts-before-pass",
      rule: "Terminal PASS requires durable state, dashboard, evaluator, verifier, and memory receipts.",
      evidenceTaskIds: tasks.map((task) => task.id),
    });
  }
  return rules;
}

function writeLongRunArtifacts(paths: ReturnType<typeof orchestratorPaths>, state: ProofloopOrchestratorState): void {
  writeJson(paths.dashboard, {
    schema: "proofloop-orchestrator-dashboard-v1",
    runId: state.runId,
    goalId: state.goalId,
    objective: state.objective,
    terminalStatus: state.terminalStatus,
    updatedAt: state.updatedAt,
    metrics: state.summary,
    notDone: state.tasks
      .filter((task) => task.status !== "passed")
      .map((task) => ({
        id: task.id,
        status: task.status,
        safety: task.safety,
        repairContextPath: task.repairContextPath,
        resumeCommand: task.resumeCommand,
      })),
    controlPlane: state.longRun,
  });
  writeJson(paths.evaluatorReceipt, {
    schema: "proofloop-orchestrator-evaluator-v1",
    runId: state.runId,
    goalId: state.goalId,
    checkedAt: state.longRun.evaluator.checkedAt,
    executorContextIncluded: false,
    detachedInputs: {
      state: state.paths.state,
      queue: state.paths.queue,
      events: state.paths.events,
      workerDispatch: state.paths.workerDispatch,
    },
    evaluator: state.longRun.evaluator,
    terminalStatus: state.terminalStatus,
  });
  writeJson(paths.sessionMemory, {
    schema: "proofloop-orchestrator-session-memory-v1",
    runId: state.runId,
    goalId: state.goalId,
    minedAt: state.updatedAt,
    policy: state.longRun.memory.sessionMiningPolicy,
    rules: state.longRun.memory.minedRules,
    priorFailurePatterns: state.longRun.memory.priorFailurePatterns,
  });
  appendEvent(paths.events, {
    ts: state.updatedAt,
    type: "long_run_control_plane_written",
    artifacts: {
      dashboard: state.paths.dashboard,
      evaluatorReceipt: state.paths.evaluatorReceipt,
      sessionMemory: state.paths.sessionMemory,
    },
  });
}

function roleEnv(modelEnvName: string, defaultModel: string, reason: string): NodeJS.ProcessEnv {
  const selectedModel = process.env[modelEnvName]?.trim() || process.env.PROOFLOOP_MODEL_ID?.trim() || defaultModel;
  return {
    ...process.env,
    PROOFLOOP_MODEL_ID: selectedModel,
    PROOFLOOP_MODEL_SELECTION_REASON: process.env.PROOFLOOP_MODEL_SELECTION_REASON ?? reason,
  };
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
    dashboard: join(runDir, "dashboard.json"),
    evaluatorReceipt: join(runDir, "evaluator-receipt.json"),
    sessionMemory: join(runDir, "session-memory.json"),
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
