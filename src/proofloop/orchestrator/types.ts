import type { ProofloopGoalTask } from "../../eval/proofloopGoalSupervisor";
import type { ProofloopCodeGraphQueryHit } from "../codegraph/types";
import type { ProofloopWorkerInventory } from "../workers/detectWorkers";

export type ProofloopOrchestratorMode = "plan" | "run" | "dogfood";

export type ProofloopOrchestratorTerminalStatus =
  | "RUNNING"
  | "PASS"
  | "BLOCKED_EXTERNAL_AFTER_ALL_LOCAL_WORK_DONE"
  | "NEEDS_HUMAN_APPROVAL"
  | "BUDGET_EXHAUSTED"
  | "FAILED_AFTER_MAX_RETRIES";

export type ProofloopOrchestratorTaskSafety =
  | "safe_local"
  | "expensive_or_live"
  | "requires_worker"
  | "external";

export type ProofloopOrchestratorTaskStatus =
  | "queued"
  | "running"
  | "passed"
  | "failed"
  | "blocked_external"
  | "needs_scaffold_or_run"
  | "needs_worker"
  | "skipped";

export type ProofloopOrchestratorTask = {
  id: string;
  title: string;
  sourceStatus: ProofloopGoalTask["status"];
  kind: ProofloopGoalTask["kind"];
  command?: string;
  safety: ProofloopOrchestratorTaskSafety;
  status: ProofloopOrchestratorTaskStatus;
  evidence: string[];
  blockers: string[];
  resumeCommand?: string;
  attempts: number;
  exitCode?: number;
  stdoutTail?: string;
  stderrTail?: string;
  repairContextPath?: string;
  likelyFiles: ProofloopCodeGraphQueryHit[];
};

export type ProofloopWorkerDispatch = {
  taskId: string;
  workerKind: "codex" | "claude" | "manual" | "local-shell";
  status: "written" | "not_launched" | "launched";
  reason: string;
  promptPath: string;
  command?: string;
};

export type ProofloopOrchestratorState = {
  schema: "proofloop-orchestrator-v1";
  runId: string;
  mode: ProofloopOrchestratorMode;
  goalId: string;
  objective: string;
  generatedAt: string;
  updatedAt: string;
  terminalStatus: ProofloopOrchestratorTerminalStatus;
  dryRun: boolean;
  executeSafe: boolean;
  maxSteps: number;
  stepsUsed: number;
  paths: {
    runDir: string;
    state: string;
    queue: string;
    events: string;
    workerDispatch: string;
    summary: string;
    codeGraphManifest: string;
  };
  workerInventory: ProofloopWorkerInventory;
  tasks: ProofloopOrchestratorTask[];
  dispatches: ProofloopWorkerDispatch[];
  summary: {
    passed: number;
    failed: number;
    blockedExternal: number;
    needsScaffoldOrRun: number;
    needsWorker: number;
    skipped: number;
    notDone: number;
  };
};

export type ProofloopOrchestratorOptions = {
  root: string;
  mode?: ProofloopOrchestratorMode;
  goalId?: string;
  objective?: string;
  template?: "official-scores";
  freshTemplate?: boolean;
  runId?: string;
  maxSteps?: number;
  executeSafe?: boolean;
  dryRun?: boolean;
  allowWorkerLaunch?: boolean;
  generatedAt?: string;
  jsonOut?: string;
  mdOut?: string;
};

export type ProofloopOrchestratorResult = {
  state: ProofloopOrchestratorState;
};
