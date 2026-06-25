import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scanBankerToolBenchBundle, type BankerToolBenchTask } from "../eval/bankerToolBenchAdapter";
import {
  freshRoomProofPath,
  readFreshRoomProofReceipt,
  validateFreshRoomProofReceipt,
  type FreshRoomProofReceipt,
} from "../eval/freshRoomProofReceipts";
import { buildSfnProofRunCommand } from "./proofCaseRegistry";

export type BtbFreshRoomMatrixOptions = {
  bundleRoot?: string;
  taskIds?: string[];
  offset?: number;
  limit?: number;
  shardIndex?: number;
  shardCount?: number;
  headed?: boolean;
  baseUrl?: string;
  verifierCommand?: string;
  agentModelMode?: string;
  agentModelPolicy?: string;
  recoverRoomCode?: string;
  recoverTracePath?: string;
  recoverFreshRoom?: boolean;
  missingOnly?: boolean;
  force?: boolean;
};

export type BtbFreshRoomMatrixTask = {
  index: number;
  taskId: string;
  harborTaskId: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  receiptPath: string;
  legacyProofPath: string;
  packageManifestPath: string;
  expectedFiles: string[];
};

export type BtbFreshRoomMatrixPlan = {
  schema: 1;
  benchmark: "bankertoolbench";
  caseId: "FR-020";
  generatedAt: string;
  bundleRoot: string;
  totalTasks: number;
  selectedTaskCount: number;
  shard?: {
    index: number;
    count: number;
  };
  offset: number;
  limit?: number;
  taskIds?: string[];
  tasks: BtbFreshRoomMatrixTask[];
};

export type BtbFreshRoomMatrixReceiptRow = {
  taskId: string;
  harborTaskId: string;
  receiptPath: string;
  source: "task_receipt" | "fr020_latest" | "missing";
  passed: boolean;
  validationErrors: string[];
  generatedAt?: string;
  roomId?: string;
  roomUrl?: string;
  model?: string;
  runtimeProfile?: string;
  exportedFileCount: number;
  reopenedFileCount: number;
  visualJudgeVerdict?: string;
};

export type BtbFreshRoomMatrixStatus = {
  schema: 1;
  benchmark: "bankertoolbench";
  caseId: "FR-020";
  generatedAt: string;
  bundleRoot: string;
  totalTasks: number;
  selectedTaskCount: number;
  provenTaskCount: number;
  failedReceiptCount: number;
  missingReceiptCount: number;
  passRate: number;
  fullBenchmarkClaim: "ready" | "not_ready";
  ledgerPath: string;
  rows: BtbFreshRoomMatrixReceiptRow[];
};

const MATRIX_ROOT = "docs/eval/fresh-room/FR-020/tasks";
const MATRIX_LEDGER_PATH = "docs/eval/fresh-room/FR-020/matrix-ledger.json";
const LIVE_PROOF_ROOT = "docs/eval/bankertoolbench/live-room";
const PACKAGE_MANIFEST_ROOT = "test-results/bankertoolbench/matrix";
const PLAYWRIGHT_OUTPUT_DIR = "playwright-output";

export function btbFreshRoomTaskReceiptPath(taskId: string): string {
  return join(MATRIX_ROOT, safeTaskId(taskId), "latest.json");
}

export function btbFreshRoomTaskLegacyProofPath(taskId: string): string {
  return join(LIVE_PROOF_ROOT, `${safeTaskId(taskId)}.json`);
}

export function btbFreshRoomTaskPackageManifestPath(taskId: string): string {
  return join(PACKAGE_MANIFEST_ROOT, safeTaskId(taskId), "package-manifest.json");
}

export function btbFreshRoomTaskPlaywrightOutputPath(taskId: string): string {
  return join(PACKAGE_MANIFEST_ROOT, safeTaskId(taskId), PLAYWRIGHT_OUTPUT_DIR);
}

export function buildBtbFreshRoomMatrixPlan(options: BtbFreshRoomMatrixOptions = {}): BtbFreshRoomMatrixPlan {
  const baseRun = buildSfnProofRunCommand("FR-020", {
    headed: options.headed,
    baseUrl: options.baseUrl,
    bundleRoot: options.bundleRoot,
    verifierCommand: options.verifierCommand,
    agentModelMode: options.agentModelMode,
    agentModelPolicy: options.agentModelPolicy,
  });
  const bundleRoot = baseRun.env.BTB_UI_BUNDLE_ROOT;
  const report = scanBankerToolBenchBundle(resolve(process.cwd(), bundleRoot), { includeTasks: true, sampleLimit: 0 });
  const allTasks = report.tasks ?? [];
  const latest = options.missingOnly ? readFreshRoomProofReceipt(freshRoomProofPath("FR-020")) : null;
  const selected = selectTasks(allTasks, options, latest);
  const tasks = selected.map(({ task, index }) => {
    const receiptPath = btbFreshRoomTaskReceiptPath(task.id);
    const legacyProofPath = btbFreshRoomTaskLegacyProofPath(task.id);
    const packageManifestPath = btbFreshRoomTaskPackageManifestPath(task.id);
    const playwrightOutputPath = btbFreshRoomTaskPlaywrightOutputPath(task.id);
    const run = buildSfnProofRunCommand("FR-020", {
      headed: options.headed,
      baseUrl: options.baseUrl,
      bundleRoot,
      verifierCommand: options.verifierCommand,
      taskId: task.id,
      agentModelMode: options.agentModelMode,
      agentModelPolicy: options.agentModelPolicy,
    });
    return {
      index,
      taskId: task.id,
      harborTaskId: task.harborTaskId,
      command: run.command,
      args: [...run.args, "--output", playwrightOutputPath],
      env: {
        ...run.env,
        BTB_FRESH_ROOM_PROOF_PATH: receiptPath,
        BTB_LIVE_ROOM_PROOF_PATH: legacyProofPath,
        BTB_PACKAGE_MANIFEST_PATH: packageManifestPath,
        BTB_UI_MATRIX_TASK_INDEX: String(index),
        BTB_UI_MATRIX_TASK_COUNT: String(allTasks.length),
        ...(options.recoverRoomCode ? { BTB_RECOVER_ROOM_CODE: options.recoverRoomCode } : {}),
        ...(options.recoverTracePath ? { BTB_RECOVER_TRACE_PATH: options.recoverTracePath } : {}),
        ...(options.recoverRoomCode ? { BTB_RECOVER_FRESH_ROOM: options.recoverFreshRoom === false ? "0" : "1" } : {}),
      },
      receiptPath,
      legacyProofPath,
      packageManifestPath,
      expectedFiles: [receiptPath, legacyProofPath, packageManifestPath],
    };
  });

  return {
    schema: 1,
    benchmark: "bankertoolbench",
    caseId: "FR-020",
    generatedAt: new Date().toISOString(),
    bundleRoot,
    totalTasks: allTasks.length,
    selectedTaskCount: tasks.length,
    ...(options.shardCount && options.shardCount > 1 && options.shardIndex !== undefined
      ? { shard: { index: options.shardIndex, count: options.shardCount } }
      : {}),
    offset: Math.max(0, options.offset ?? 0),
    ...(options.limit !== undefined ? { limit: Math.max(0, options.limit) } : {}),
    ...(options.taskIds?.length ? { taskIds: options.taskIds } : {}),
    tasks,
  };
}

export function readBtbFreshRoomMatrixStatus(options: BtbFreshRoomMatrixOptions = {}): BtbFreshRoomMatrixStatus {
  const plan = buildBtbFreshRoomMatrixPlan(options);
  const latest = readFreshRoomProofReceipt(freshRoomProofPath("FR-020"));
  const rows = plan.tasks.map((task) => receiptRowForTask(task, latest));
  const provenTaskCount = rows.filter((row) => row.passed).length;
  const missingReceiptCount = rows.filter((row) => row.source === "missing").length;
  const failedReceiptCount = rows.filter((row) => row.source !== "missing" && !row.passed).length;
  return {
    schema: 1,
    benchmark: "bankertoolbench",
    caseId: "FR-020",
    generatedAt: new Date().toISOString(),
    bundleRoot: plan.bundleRoot,
    totalTasks: plan.totalTasks,
    selectedTaskCount: plan.selectedTaskCount,
    provenTaskCount,
    failedReceiptCount,
    missingReceiptCount,
    passRate: plan.selectedTaskCount > 0 ? provenTaskCount / plan.selectedTaskCount : 0,
    fullBenchmarkClaim: plan.totalTasks > 0 && plan.selectedTaskCount === plan.totalTasks && provenTaskCount === plan.totalTasks ? "ready" : "not_ready",
    ledgerPath: MATRIX_LEDGER_PATH,
    rows,
  };
}

export function writeBtbFreshRoomMatrixLedger(status: BtbFreshRoomMatrixStatus, path = MATRIX_LEDGER_PATH): void {
  const absolute = resolve(process.cwd(), path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(status, null, 2)}\n`);
}

export function existingBtbFreshRoomTaskReceiptIds(root = MATRIX_ROOT): string[] {
  const absolute = resolve(process.cwd(), root);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(absolute, entry.name, "latest.json")))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function selectTasks(
  allTasks: BankerToolBenchTask[],
  options: BtbFreshRoomMatrixOptions,
  latest: FreshRoomProofReceipt | null = null,
): Array<{ task: BankerToolBenchTask; index: number }> {
  const indexed = allTasks.map((task, index) => ({ task, index }));
  const requested = options.taskIds?.length
    ? options.taskIds.flatMap((id) => indexed.filter((item) => item.task.id === id || item.task.harborTaskId === id))
    : indexed;
  const sharded = options.shardCount && options.shardCount > 1
    ? requested.filter((item) => item.index % options.shardCount! === (options.shardIndex ?? 0))
    : requested;
  const missingFiltered = options.missingOnly
    ? sharded.filter(({ task }) => !hasPassingBtbFreshRoomReceipt(task, latest))
    : sharded;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit === undefined ? undefined : Math.max(0, options.limit);
  return limit === undefined ? missingFiltered.slice(offset) : missingFiltered.slice(offset, offset + limit);
}

function receiptRowForTask(task: BtbFreshRoomMatrixTask, latest: FreshRoomProofReceipt | null): BtbFreshRoomMatrixReceiptRow {
  const taskReceipt = readFreshRoomProofReceipt(task.receiptPath);
  const latestMatches = latest?.benchmark === "bankertoolbench" && (latest.taskId === task.taskId || latest.taskId === task.harborTaskId);
  const receipt = taskReceipt ?? (latestMatches ? latest : null);
  const source = taskReceipt ? "task_receipt" : latestMatches ? "fr020_latest" : "missing";
  const validation = receipt
    ? validateFreshRoomProofReceipt(receipt, {
      caseId: "FR-020",
      requireOfficialScorer: receipt.gatesProven.includes("official_scorer_handoff"),
      requireArtifactPlaceholderScan: true,
      requireAgentTerminalQuality: true,
    })
    : { ok: false, errors: ["missing receipt"] };
  const taskMatches = receipt?.taskId === task.taskId || receipt?.taskId === task.harborTaskId;
  const validationErrors = [
    ...validation.errors,
    ...(receipt && !taskMatches ? [`receipt taskId ${receipt.taskId ?? "(missing)"} does not match ${task.taskId}`] : []),
    ...btbTaskCoverageReceiptErrors(receipt),
  ];
  return {
    taskId: task.taskId,
    harborTaskId: task.harborTaskId,
    receiptPath: source === "fr020_latest" ? freshRoomProofPath("FR-020") : task.receiptPath,
    source,
    passed: Boolean(receipt?.passed) && validationErrors.length === 0,
    validationErrors,
    generatedAt: receipt?.generatedAt,
    roomId: receipt?.roomId,
    roomUrl: receipt?.roomUrl,
    model: receipt?.model?.resolved,
    runtimeProfile: receipt?.model?.runtimeProfile,
    exportedFileCount: receipt?.artifacts.exportedFiles?.length ?? 0,
    reopenedFileCount: receipt?.artifacts.reopenedFiles?.length ?? 0,
    visualJudgeVerdict: receipt?.visualJudge?.verdict,
  };
}

function hasPassingBtbFreshRoomReceipt(task: BankerToolBenchTask, latest: FreshRoomProofReceipt | null): boolean {
  const taskReceipt = readFreshRoomProofReceipt(btbFreshRoomTaskReceiptPath(task.id));
  const receipt = taskReceipt ?? (latest?.benchmark === "bankertoolbench" && (latest.taskId === task.id || latest.taskId === task.harborTaskId) ? latest : null);
  if (!receipt?.passed) return false;
  if (receipt.taskId !== task.id && receipt.taskId !== task.harborTaskId) return false;
  const validation = validateFreshRoomProofReceipt(receipt, {
    caseId: "FR-020",
    requireOfficialScorer: receipt.gatesProven.includes("official_scorer_handoff"),
    requireArtifactPlaceholderScan: true,
    requireAgentTerminalQuality: true,
  });
  return validation.ok && btbTaskCoverageReceiptErrors(receipt).length === 0;
}

export function btbTaskCoverageReceiptErrors(receipt: FreshRoomProofReceipt | null): string[] {
  if (!receipt || receipt.benchmark !== "bankertoolbench") return [];
  const coverage = objectRecord(receipt.scorer?.details?.taskCoverage);
  if (!coverage) return ["missing BTB task coverage result"];
  const requiredTickers = stringArray(coverage.requiredTickers);
  const missingTickers = stringArray(coverage.missingTickers);
  const detail = typeof coverage.detail === "string" ? coverage.detail : "";
  if (coverage.ok !== true) {
    return [`BTB task coverage gate failed${detail ? `: ${detail}` : ""}`];
  }
  if (requiredTickers.length > 1 && missingTickers.length > 0) {
    return [`BTB task coverage missing requested tickers/entities: ${missingTickers.join(", ")}`];
  }
  if (requiredTickers.length > 1 && !detail) {
    return ["BTB task coverage result must include detail for multi-entity tasks"];
  }
  return [];
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function safeTaskId(taskId: string): string {
  return taskId.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160);
}
