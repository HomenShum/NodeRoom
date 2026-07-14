import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";

export type SpreadsheetBenchOfficialOutputReceiptOptions = {
  track: SpreadsheetBenchTrack;
  stageRoot: string;
  stageReportPath: string;
  outputRoot: string;
  clean?: boolean;
  generatedAt?: string;
};

export type SpreadsheetBenchOfficialOutputReceiptReport = {
  schema: 1;
  verifier: "spreadsheetbench_local_proxy_output_scaffold";
  generatedAt?: string;
  track: SpreadsheetBenchTrack;
  stageRoot: string;
  outputRoot: string;
  stageReport: FileEvidence;
  expectedTaskCount: number;
  taskCount: number;
  officialScoreClaim: {
    allowed: false;
    policy: "accepted_official_scorer_receipt_required";
    reason: "local_proxy_outputs_are_not_official_scores";
  };
  coverage: {
    outputReceiptCount: number;
    candidateWorkbookCount: number;
    missingInputCount: number;
  };
  routeCostLedger: {
    policy: "free_local_proxy_output_scaffold";
    modelCalls: 0;
    inputTokens: 0;
    outputTokens: 0;
    providerCostUsd: 0;
    paidProviderCostUsd: 0;
  };
  receipts: SpreadsheetBenchOfficialOutputReceiptResult[];
  blockers: string[];
  warnings: string[];
};

export type SpreadsheetBenchOfficialOutputReceiptResult = {
  taskId: string;
  taskDir: string;
  status: "output_built_official_scoring_pending" | "missing_input";
  candidateWorkbooks: FileEvidence[];
  receipt?: FileEvidence;
  missingInputs: string[];
};

type StageReport = {
  schema?: number;
  stagedTaskCount?: number;
  tasks?: StageTask[];
};

type StageTask = {
  id?: string;
  category?: string;
  taskDir?: string;
  agentManifest?: string;
  evaluatorManifest?: string;
  agentInputFiles?: string[];
};

type LocalProxyOutputReceipt = {
  schema: 1;
  verifier: "spreadsheetbench_local_proxy_output";
  generatedAt?: string;
  track: SpreadsheetBenchTrack;
  taskId: string;
  category?: string;
  mode: "copy-input-baseline";
  candidateSource: "staged_agent_inputs";
  officialScoreClaim: {
    allowed: false;
    policy: "accepted_official_scorer_receipt_required";
    reason: "candidate output receipt is local/proxy evidence, not an official score";
  };
  officialScoring: {
    status: "pending_official_scorer_receipt";
  };
  harness: {
    evaluatorAccess: "not_opened_by_output_scaffold";
    toolPolicy: "agent_visible_files_only";
    writes: "output_root_only";
    budget: {
      modelCalls: 0;
      inputTokens: 0;
      outputTokens: 0;
      providerCostUsd: 0;
    };
  };
  agentManifest?: string;
  evaluatorManifest?: string;
  candidateWorkbooks: FileEvidence[];
};

export type FileEvidence = {
  path: string;
  sha256: string;
  bytes: number;
};

export function buildSpreadsheetBenchOfficialOutputReceipts(
  options: SpreadsheetBenchOfficialOutputReceiptOptions,
): SpreadsheetBenchOfficialOutputReceiptReport {
  const stageRoot = resolve(options.stageRoot);
  const outputRoot = resolve(options.outputRoot);
  const stageReportPath = resolve(options.stageReportPath);
  if (!existsSync(stageRoot)) throw new Error(`SpreadsheetBench stage root does not exist: ${options.stageRoot}`);
  assertSafeOutputRoot(outputRoot);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const stageReport = readJson<StageReport>(stageReportPath);
  const tasks = (stageReport.tasks ?? []).filter((task) => task.id && task.taskDir);
  const receipts = tasks.map((task) => buildTaskReceipt({
    track: options.track,
    stageRoot,
    outputRoot,
    task: task as StageTask & { id: string; taskDir: string },
    generatedAt: options.generatedAt,
  }));
  const outputReceiptCount = receipts.filter((receipt) => receipt.receipt).length;
  const candidateWorkbookCount = receipts.reduce((sum, receipt) => sum + receipt.candidateWorkbooks.length, 0);
  const missingInputCount = receipts.reduce((sum, receipt) => sum + receipt.missingInputs.length, 0);
  const expectedTaskCount = stageReport.stagedTaskCount ?? tasks.length;
  const blockers = [
    "accepted official scorer receipt is missing; local/proxy output receipts are not official scores",
    ...(outputReceiptCount < expectedTaskCount ? [`only ${outputReceiptCount}/${expectedTaskCount} local/proxy output receipt(s) were built`] : []),
    ...(missingInputCount > 0 ? [`${missingInputCount} staged agent input file(s) were missing`] : []),
  ];

  return {
    schema: 1,
    verifier: "spreadsheetbench_local_proxy_output_scaffold",
    generatedAt: options.generatedAt,
    track: options.track,
    stageRoot: basename(stageRoot),
    outputRoot: basename(outputRoot),
    stageReport: fileEvidence(process.cwd(), stageReportPath),
    expectedTaskCount,
    taskCount: receipts.length,
    officialScoreClaim: {
      allowed: false,
      policy: "accepted_official_scorer_receipt_required",
      reason: "local_proxy_outputs_are_not_official_scores",
    },
    coverage: {
      outputReceiptCount,
      candidateWorkbookCount,
      missingInputCount,
    },
    routeCostLedger: {
      policy: "free_local_proxy_output_scaffold",
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      providerCostUsd: 0,
      paidProviderCostUsd: 0,
    },
    receipts,
    blockers,
    warnings: [],
  };
}

function buildTaskReceipt(args: {
  track: SpreadsheetBenchTrack;
  stageRoot: string;
  outputRoot: string;
  task: StageTask & { id: string; taskDir: string };
  generatedAt?: string;
}): SpreadsheetBenchOfficialOutputReceiptResult {
  const taskOutDir = join(args.outputRoot, safeTaskDir(args.task));
  mkdirSync(taskOutDir, { recursive: true });
  const candidateWorkbooks: FileEvidence[] = [];
  const missingInputs: string[] = [];
  for (const [index, inputFile] of (args.task.agentInputFiles ?? []).entries()) {
    const source = resolve(args.stageRoot, inputFile.replace(/\\/g, "/"));
    if (!existsSync(source)) {
      missingInputs.push(inputFile);
      continue;
    }
    const target = join(taskOutDir, `candidate-${String(index + 1).padStart(2, "0")}-${basename(inputFile)}`);
    copyFileSync(source, target);
    candidateWorkbooks.push(fileEvidence(args.outputRoot, target));
  }
  if (missingInputs.length > 0 || candidateWorkbooks.length === 0) {
    return {
      taskId: args.task.id,
      taskDir: safeTaskDir(args.task),
      status: "missing_input",
      candidateWorkbooks,
      missingInputs,
    };
  }

  const receiptPath = join(taskOutDir, "local-proxy-output-receipt.json");
  writeJson<LocalProxyOutputReceipt>(receiptPath, {
    schema: 1,
    verifier: "spreadsheetbench_local_proxy_output",
    generatedAt: args.generatedAt,
    track: args.track,
    taskId: args.task.id,
    category: args.task.category,
    mode: "copy-input-baseline",
    candidateSource: "staged_agent_inputs",
    officialScoreClaim: {
      allowed: false,
      policy: "accepted_official_scorer_receipt_required",
      reason: "candidate output receipt is local/proxy evidence, not an official score",
    },
    officialScoring: {
      status: "pending_official_scorer_receipt",
    },
    harness: {
      evaluatorAccess: "not_opened_by_output_scaffold",
      toolPolicy: "agent_visible_files_only",
      writes: "output_root_only",
      budget: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        providerCostUsd: 0,
      },
    },
    agentManifest: args.task.agentManifest,
    evaluatorManifest: args.task.evaluatorManifest,
    candidateWorkbooks,
  });
  return {
    taskId: args.task.id,
    taskDir: safeTaskDir(args.task),
    status: "output_built_official_scoring_pending",
    candidateWorkbooks,
    receipt: fileEvidence(args.outputRoot, receiptPath),
    missingInputs: [],
  };
}

function assertSafeOutputRoot(outputRoot: string) {
  const cwd = resolve(process.cwd());
  const relativePath = relative(cwd, outputRoot);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`SpreadsheetBench output root must be inside this workspace: ${outputRoot}`);
  }
}

function safeTaskDir(task: StageTask & { id: string; taskDir: string }): string {
  return task.taskDir.replace(/^tasks[\\/]/, "").replace(/\\/g, "/") || task.id.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function fileEvidence(root: string, path: string): FileEvidence {
  const content = readFileSync(path);
  const stat = statSync(path);
  return {
    path: relative(resolve(root), resolve(path)).replace(/\\/g, "/"),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: stat.size,
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson<T>(path: string, value: T) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
