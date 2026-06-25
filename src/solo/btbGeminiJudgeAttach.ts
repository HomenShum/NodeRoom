import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  freshRoomProofPath,
  readFreshRoomProofReceipt,
  writeFreshRoomProofReceipt,
  type FreshRoomProofReceipt,
} from "../eval/freshRoomProofReceipts";
import { btbFreshRoomTaskReceiptPath } from "./btbFreshRoomMatrix";

export type BtbGeminiJudgeAttachOptions = {
  judgePath: string;
  summaryPath?: string;
  taskIds?: string[];
  receiptRoot?: string;
};

export type BtbGeminiJudgeAttachRow = {
  taskId: string;
  receiptPath: string;
  videoPath: string;
  visualJudgeVerdict: "pass" | "fail";
  mediaJudgeVerdict?: string;
  score?: number;
  maxScore?: number;
  reason: string;
};

export type BtbGeminiJudgeAttachResult = {
  schema: 1;
  judgePath: string;
  summaryPath?: string;
  command?: string;
  updated: BtbGeminiJudgeAttachRow[];
  skipped: Array<{ taskId?: string; videoPath?: string; reason: string }>;
};

type MediaJudgeAggregate = {
  runId?: string;
  command?: string;
  results?: MediaJudgeResult[];
};

type MediaJudgeResult = {
  status?: "judged" | "error" | "dry-run";
  score?: number;
  maxScore?: number;
  error?: string;
  asset?: {
    path?: string;
    relPath?: string;
  };
  judge?: {
    verdict?: "publish" | "fix-then-publish" | "rework";
    summary?: string;
    defects?: Array<{ severity?: "P0" | "P1" | "P2"; observed?: string; fix?: string }>;
  };
};

export function attachBtbGeminiJudgeResults(options: BtbGeminiJudgeAttachOptions): BtbGeminiJudgeAttachResult {
  const judgePath = resolve(process.cwd(), options.judgePath);
  if (!existsSync(judgePath)) throw new Error(`Gemini judge aggregate not found: ${options.judgePath}`);
  const aggregate = JSON.parse(readFileSync(judgePath, "utf8")) as MediaJudgeAggregate;
  const summaryPath = resolveSummaryPath(judgePath, aggregate.runId, options.summaryPath);
  const wanted = options.taskIds?.length ? new Set(options.taskIds) : undefined;
  const updated: BtbGeminiJudgeAttachRow[] = [];
  const skipped: BtbGeminiJudgeAttachResult["skipped"] = [];

  for (const result of aggregate.results ?? []) {
    const videoPath = result.asset?.path ? resolve(process.cwd(), result.asset.path) : undefined;
    const taskId = videoPath ? taskIdFromBtbVideoPath(videoPath) : undefined;
    if (!videoPath || !taskId) {
      skipped.push({ videoPath, reason: "media asset is not a BTB matrix video" });
      continue;
    }
    if (wanted && !wanted.has(taskId)) {
      skipped.push({ taskId, videoPath, reason: "task not selected" });
      continue;
    }
    const receiptPath = options.receiptRoot
      ? join(options.receiptRoot, safeTaskId(taskId), "latest.json")
      : btbFreshRoomTaskReceiptPath(taskId);
    const receipt = readFreshRoomProofReceipt(receiptPath);
    if (!receipt) {
      skipped.push({ taskId, videoPath, reason: `receipt not found: ${receiptPath}` });
      continue;
    }

    const verdict = visualJudgeVerdict(result);
    const reason = visualJudgeReason(result);
    const next = attachResultToReceipt(receipt, {
      command: aggregate.command,
      summaryPath,
      videoPath,
      verdict,
      reason,
    });
    writeFreshRoomProofReceipt(next, receiptPath);
    maybeUpdateLatestReceipt(next);
    updated.push({
      taskId,
      receiptPath,
      videoPath,
      visualJudgeVerdict: verdict,
      mediaJudgeVerdict: result.judge?.verdict,
      score: result.score,
      maxScore: result.maxScore,
      reason,
    });
  }

  return {
    schema: 1,
    judgePath,
    ...(summaryPath ? { summaryPath } : {}),
    ...(aggregate.command ? { command: aggregate.command } : {}),
    updated,
    skipped,
  };
}

function attachResultToReceipt(
  receipt: FreshRoomProofReceipt,
  result: {
    command?: string;
    summaryPath?: string;
    videoPath: string;
    verdict: "pass" | "fail";
    reason: string;
  },
): FreshRoomProofReceipt {
  const gates = new Set(receipt.gatesProven);
  if (result.verdict === "pass") gates.add("visual_judge_handoff");
  const videoPaths = new Set([...(receipt.ui.videoPaths ?? []), result.videoPath]);
  return {
    ...receipt,
    ui: {
      ...receipt.ui,
      videoPaths: [...videoPaths],
    },
    visualJudge: {
      ...(result.command ? { command: result.command } : {}),
      verdict: result.verdict,
      ...(result.summaryPath ? { scorecardPath: result.summaryPath } : {}),
      reason: result.reason,
    },
    gatesProven: [...gates],
  };
}

function maybeUpdateLatestReceipt(receipt: FreshRoomProofReceipt): void {
  const latestPath = freshRoomProofPath(receipt.caseId);
  const latest = readFreshRoomProofReceipt(latestPath);
  if (!latest) return;
  if (latest.benchmark !== receipt.benchmark || latest.taskId !== receipt.taskId) return;
  writeFreshRoomProofReceipt(receipt, latestPath);
}

function visualJudgeVerdict(result: MediaJudgeResult): "pass" | "fail" {
  if (result.status !== "judged") return "fail";
  if (!result.judge) return "fail";
  if (result.judge.verdict === "rework") return "fail";
  const blockingDefect = (result.judge.defects ?? []).some((defect) => defect.severity === "P0" || defect.severity === "P1");
  return blockingDefect ? "fail" : "pass";
}

function visualJudgeReason(result: MediaJudgeResult): string {
  if (result.status !== "judged") return `Gemini media judge ${result.status ?? "unknown"}: ${result.error ?? "no structured result"}`;
  const defects = result.judge?.defects ?? [];
  const counts = {
    P0: defects.filter((defect) => defect.severity === "P0").length,
    P1: defects.filter((defect) => defect.severity === "P1").length,
    P2: defects.filter((defect) => defect.severity === "P2").length,
  };
  const score = result.score === undefined ? "score unavailable" : `${result.score}/${result.maxScore}`;
  return `Gemini media judge ${result.judge?.verdict ?? "unknown"} (${score}); defects P0/P1/P2=${counts.P0}/${counts.P1}/${counts.P2}. ${result.judge?.summary ?? ""}`.trim();
}

function resolveSummaryPath(judgePath: string, runId: string | undefined, override: string | undefined): string | undefined {
  if (override) return resolve(process.cwd(), override);
  const root = dirname(judgePath);
  const candidate = runId ? join(root, runId, "summary.md") : join(root, "summary.md");
  return existsSync(candidate) ? candidate : undefined;
}

function taskIdFromBtbVideoPath(videoPath: string): string | undefined {
  const normalized = videoPath.replace(/\\/g, "/");
  const marker = "/test-results/bankertoolbench/matrix/";
  const index = normalized.indexOf(marker);
  if (index === -1) return undefined;
  const rest = normalized.slice(index + marker.length);
  const taskId = rest.split("/")[0];
  return taskId || undefined;
}

function safeTaskId(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160);
}

export function renderBtbGeminiJudgeAttachResult(result: BtbGeminiJudgeAttachResult): string {
  const lines = [
    "BTB Gemini visual judge attachment",
    `  judge: ${relative(process.cwd(), result.judgePath)}`,
    `  summary: ${result.summaryPath ? relative(process.cwd(), result.summaryPath) : "missing"}`,
    `  updated receipts: ${result.updated.length}`,
    `  skipped assets: ${result.skipped.length}`,
  ];
  for (const row of result.updated) {
    lines.push(`  - ${row.taskId}: ${row.visualJudgeVerdict} (${row.mediaJudgeVerdict ?? "unknown"}; ${row.score ?? "-"}/${row.maxScore ?? "-"})`);
  }
  for (const row of result.skipped.slice(0, 8)) {
    lines.push(`  skipped: ${row.taskId ?? basename(row.videoPath ?? "unknown")} - ${row.reason}`);
  }
  if (result.skipped.length > 8) lines.push(`  ... ${result.skipped.length - 8} more skipped`);
  return lines.join("\n");
}
