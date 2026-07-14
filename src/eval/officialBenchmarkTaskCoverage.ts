import { existsSync, readFileSync } from "node:fs";

export type BenchmarkTaskCoverageStatus = "complete" | "partial" | "missing";

export type BenchmarkTaskCoverageTrack = {
  id: string;
  title: string;
  benchmark: "SpreadsheetBench" | "SpreadsheetBench 2" | "BankerToolBench" | "NodeRoom";
  officialExpectedTasks: number;
  officialSourceUrls: string[];
  localScope: string;
  scannedTasks: number;
  stagedTasks: number;
  skippedTasks: number;
  deterministicRunTasks: number;
  modelRunCases: number;
  modelRunAttempts: number;
  localProxyOutputReceipts: number;
  passRate: number | null;
  allOfficialTasksStaged: boolean;
  allOfficialTasksRunWithModel: boolean;
  allOfficialTasksHaveLocalProxyOutputReceipts: boolean;
  status: BenchmarkTaskCoverageStatus;
  evidence: string[];
  blockers: string[];
};

export type OfficialBenchmarkTaskCoverageReport = {
  schema: 1;
  generatedAt?: string;
  summary: {
    tracks: number;
    completeTracks: number;
    partialTracks: number;
    missingTracks: number;
    totalOfficialExpectedTasks: number;
    totalStagedTasks: number;
    totalDeterministicRunTasks: number;
    totalModelRunCases: number;
    totalModelRunAttempts: number;
    totalLocalProxyOutputReceipts: number;
    strictFullCoverageReady: boolean;
  };
  policy: string[];
  tracks: BenchmarkTaskCoverageTrack[];
};

type StageReport = {
  scannedTaskCount?: number;
  stagedTaskCount?: number;
  skippedTaskCount?: number;
};

type RunReport = {
  mode?: string;
  taskCount?: number;
  caseCount?: number;
  repeatCount?: number;
  attemptCount?: number;
  passRate?: number;
  results?: Array<{
    taskId?: string;
    mode?: string;
    candidateWorkbook?: string;
    score?: { schema?: number; taskId?: string };
    scorerReceipt?: { path?: string; sha256?: string; bytes?: number };
    sidecarEvidence?: {
      candidateManifest?: { path?: string; sha256?: string; bytes?: number };
      agentWorkspaceManifest?: { path?: string; sha256?: string; bytes?: number };
      editPlan?: { path?: string; sha256?: string; bytes?: number; kind?: string };
      rawModelOutput?: { path?: string; sha256?: string; bytes?: number };
    };
    model?: { calls?: number };
    error?: {
      phase?: "candidate_generation" | "scoring";
      message?: string;
    };
  }>;
};

export type ModelRunReceiptStats = {
  cases: number;
  attempts: number;
  taskIds: string[];
};

type OutputReceiptReport = {
  taskCount?: number;
  coverage?: {
    outputReceiptCount?: number;
  };
};

type FullSuiteGateReceipt = {
  expectedCount?: number;
  executedTaskCount?: number;
  cleanScoredTaskCount?: number;
  meanCleanReward?: number | null;
  passThreshold?: number;
  passCount?: number;
  passRate?: number | null;
  flipEligible?: boolean;
};

type MultiUserReport = {
  summary?: {
    passed?: boolean;
    scenarios?: number;
    passedScenarios?: number;
  };
};

export function buildOfficialBenchmarkTaskCoverageReport(args: {
  generatedAt?: string;
} = {}): OfficialBenchmarkTaskCoverageReport {
  const tracks = [
    spreadsheetBenchV1Full(),
    spreadsheetBenchV1Verified(),
    spreadsheetBenchV2Full(),
    bankerToolBenchFull(),
    nodeRoomMultiUserConflict(),
  ];

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    summary: {
      tracks: tracks.length,
      completeTracks: tracks.filter((track) => track.status === "complete").length,
      partialTracks: tracks.filter((track) => track.status === "partial").length,
      missingTracks: tracks.filter((track) => track.status === "missing").length,
      totalOfficialExpectedTasks: sum(tracks, "officialExpectedTasks"),
      totalStagedTasks: sum(tracks, "stagedTasks"),
      totalDeterministicRunTasks: sum(tracks, "deterministicRunTasks"),
      totalModelRunCases: sum(tracks, "modelRunCases"),
      totalModelRunAttempts: sum(tracks, "modelRunAttempts"),
      totalLocalProxyOutputReceipts: sum(tracks, "localProxyOutputReceipts"),
      strictFullCoverageReady: tracks.every((track) => track.status === "complete"),
    },
    policy: [
      "Do not collapse sampled N=5 evidence into a full official benchmark claim.",
      "A task is staged only when the agent-visible manifest is separated from evaluator gold and scorer metadata.",
      "A task is model-run only when candidate artifacts are emitted from an agent workspace before evaluator access opens.",
      "Full official coverage requires every published task for the named benchmark track, not only a verified subset or fixture.",
      "NodeRoom multi-user conflict tasks are an internal benchmark family; they complement SpreadsheetBench/BankerToolBench but do not replace them.",
    ],
    tracks,
  };
}

function spreadsheetBenchV1Full(): BenchmarkTaskCoverageTrack {
  const stage = readJson<StageReport>("docs/eval/spreadsheetbench-v1-912-stage.json");
  const copyRun = readJson<RunReport>("docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json");
  const modelRun = readJson<RunReport>("docs/eval/spreadsheetbench-v1-912-model-run.json");
  const outputReceipts = readJson<OutputReceiptReport>("docs/eval/spreadsheetbench-v1-912-local-proxy-output-receipts.json");
  const stagedTasks = stage?.stagedTaskCount ?? 0;
  const deterministicRunTasks = copyRun?.caseCount ?? copyRun?.taskCount ?? 0;
  const modelReceipts = modelRunReceiptStats(modelRun);
  const localProxyOutputReceipts = outputReceipts?.coverage?.outputReceiptCount ?? outputReceipts?.taskCount ?? 0;
  const complete = stagedTasks >= 912 && deterministicRunTasks >= 912 && modelReceipts.cases >= 912;

  return {
    id: "spreadsheetbench-v1-full-912",
    title: "SpreadsheetBench V1 full benchmark",
    benchmark: "SpreadsheetBench",
    officialExpectedTasks: 912,
    officialSourceUrls: [
      "https://github.com/RUCKBReasoning/SpreadsheetBench",
      "https://huggingface.co/datasets/KAKA22/SpreadsheetBench",
    ],
    localScope: complete
      ? "full public 912-task bundle staged and scored through the isolated model runner"
      : "full public 912-task bundle evidence is incomplete",
    scannedTasks: stage?.scannedTaskCount ?? 0,
    stagedTasks,
    skippedTasks: stage?.skippedTaskCount ?? 912,
    deterministicRunTasks,
    modelRunCases: modelReceipts.cases,
    modelRunAttempts: modelReceipts.attempts,
    localProxyOutputReceipts,
    passRate: modelRun?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= 912,
    allOfficialTasksRunWithModel: modelReceipts.cases >= 912,
    allOfficialTasksHaveLocalProxyOutputReceipts: localProxyOutputReceipts >= 912,
    status: complete ? "complete" : stagedTasks > 0 ? "partial" : "missing",
    evidence: [
      "docs/eval/spreadsheetbench-v1-912-stage.json",
      "docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json",
      "docs/eval/spreadsheetbench-v1-912-model-run.json",
      "docs/eval/spreadsheetbench-v1-912-local-proxy-output-receipts.json",
      "docs/eval/official-benchmark-readiness.json",
    ],
    blockers: [
      ...(stagedTasks >= 912 ? [] : ["Download/lock and stage the full 912-task SpreadsheetBench V1 bundle."]),
      ...(deterministicRunTasks >= 912 ? [] : ["Run all 912 staged V1 tasks through the deterministic scorer path."]),
      ...(modelReceipts.cases >= 912 ? [] : [`Run ${Math.max(0, 912 - modelReceipts.cases)} remaining V1 task(s) through the model runner with generated plan, candidate, and scorer receipts.`]),
    ],
  };
}

function spreadsheetBenchV1Verified(): BenchmarkTaskCoverageTrack {
  const stage = readJson<StageReport>("docs/eval/spreadsheetbench-v1-full-stage-smoke.json");
  const copyRun = readJson<RunReport>("docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json");
  const modelRunPath = existsSync("docs/eval/spreadsheetbench-v1-verified-400-model-run.json")
    ? "docs/eval/spreadsheetbench-v1-verified-400-model-run.json"
    : "docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json";
  const modelRun = readJson<RunReport>(modelRunPath);
  const stagedTasks = stage?.stagedTaskCount ?? 0;
  const modelReceipts = modelRunReceiptStats(modelRun);
  const modelRunCases = modelReceipts.cases;
  const complete = stagedTasks >= 400 && modelRunCases >= 400;

  return {
    id: "spreadsheetbench-v1-verified-400",
    title: "SpreadsheetBench Verified 400 subset",
    benchmark: "SpreadsheetBench",
    officialExpectedTasks: 400,
    officialSourceUrls: [
      "https://github.com/RUCKBReasoning/SpreadsheetBench",
      "https://shortcut.ai/blog/posts/spreadsheetbench-verified",
    ],
    localScope: "verified-400 expert annotated subset",
    scannedTasks: stage?.scannedTaskCount ?? 0,
    stagedTasks,
    skippedTasks: stage?.skippedTaskCount ?? 400,
    deterministicRunTasks: copyRun?.taskCount ?? 0,
    modelRunCases,
    modelRunAttempts: modelReceipts.attempts,
    localProxyOutputReceipts: 0,
    passRate: modelRun?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= 400,
    allOfficialTasksRunWithModel: modelRunCases >= 400,
    allOfficialTasksHaveLocalProxyOutputReceipts: false,
    status: complete ? "complete" : stagedTasks >= 400 ? "partial" : "missing",
    evidence: [
      "docs/eval/spreadsheetbench-v1-full-stage-smoke.json",
      "docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json",
      modelRunPath,
    ],
    blockers: complete ? [] : [
      `${Math.max(0, 400 - modelRunCases)} verified task(s) still need generated plan, candidate, and scorer receipts; current evidence covers ${modelRunCases}/400 cases.`,
      "Full verified-score promotion still needs official scoring parity, not only local workbook scoring.",
    ],
  };
}

function spreadsheetBenchV2Full(): BenchmarkTaskCoverageTrack {
  const stage = readJson<StageReport>("docs/eval/spreadsheetbench-v2-full-stage.json")
    ?? readJson<StageReport>("docs/eval/spreadsheetbench-v2-stage-smoke.json");
  const fullStageExists = existsSync("docs/eval/spreadsheetbench-v2-full-stage.json");
  const deterministicRun = readJson<RunReport>("docs/eval/spreadsheetbench-v2-full-copy-input-run.json")
    ?? readJson<RunReport>("docs/eval/spreadsheetbench-v2-run-smoke.json");
  const modelRunPath = existsSync("docs/eval/spreadsheetbench-v2-321-model-run.json")
    ? "docs/eval/spreadsheetbench-v2-321-model-run.json"
    : "docs/eval/spreadsheetbench-v2-run-smoke.json";
  const modelRun = readJson<RunReport>(modelRunPath);
  const outputReceipts = readJson<OutputReceiptReport>("docs/eval/spreadsheetbench-v2-321-local-proxy-output-receipts.json");
  const stagedTasks = stage?.stagedTaskCount ?? 0;
  const modelReceipts = modelRunReceiptStats(modelRun);
  const modelRunCases = modelReceipts.cases;
  const localProxyOutputReceipts = outputReceipts?.coverage?.outputReceiptCount ?? outputReceipts?.taskCount ?? 0;
  const complete = stagedTasks >= 321 && modelRunCases >= 321;
  const fullBundleStaged = stagedTasks >= 321;

  return {
    id: "spreadsheetbench-v2-full-321",
    title: "SpreadsheetBench 2 full workflow benchmark",
    benchmark: "SpreadsheetBench 2",
    officialExpectedTasks: 321,
    officialSourceUrls: [
      "https://spreadsheetbench.github.io/",
      "https://huggingface.co/datasets/KAKA22/SpreadsheetBench-v2",
    ],
    localScope: fullBundleStaged ? "full public 321-task bundle staged with evaluator isolation" : "public example bundle only",
    scannedTasks: stage?.scannedTaskCount ?? 0,
    stagedTasks,
    skippedTasks: stage?.skippedTaskCount ?? 321,
    deterministicRunTasks: deterministicRun?.taskCount ?? 0,
    modelRunCases,
    modelRunAttempts: modelReceipts.attempts,
    localProxyOutputReceipts,
    passRate: modelRun?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= 321,
    allOfficialTasksRunWithModel: modelRunCases >= 321,
    allOfficialTasksHaveLocalProxyOutputReceipts: localProxyOutputReceipts >= 321,
    status: complete ? "complete" : stagedTasks > 0 ? "partial" : "missing",
    evidence: [
      ...(fullStageExists ? [
        "docs/eval/spreadsheetbench-v2-full-ingest.json",
        "docs/eval/spreadsheetbench-v2-full-stage.json",
      ] : []),
      "docs/eval/spreadsheetbench-v2-stage-smoke.json",
      modelRunPath,
      "docs/eval/spreadsheetbench-v2-321-local-proxy-output-receipts.json",
      "docs/eval/spreadsheetbench-chart-visual-probe.json",
    ],
    blockers: complete ? [] : [
      ...(fullBundleStaged ? [] : [
        `${Math.max(0, 321 - stagedTasks)} SpreadsheetBench 2 task(s) still need staging from the full official bundle.`,
      ]),
      "Run every staged V2 task through the model runner, static workbook scorer, and rendered/VLM chart grader where applicable.",
    ],
  };
}

export function modelRunReceiptStats(report: RunReport | undefined): ModelRunReceiptStats {
  const taskIds = new Set<string>();
  let attempts = 0;
  for (const result of report?.results ?? []) {
    const sidecar = result.sidecarEvidence;
    const scorerAttempted = !result.error || result.error.phase === "scoring";
    const valid = result.mode === "model-edit-plan" &&
      scorerAttempted &&
      (result.model?.calls ?? 0) > 0 &&
      Boolean(result.taskId) &&
      Boolean(result.candidateWorkbook) &&
      validFileReceipt(sidecar?.candidateManifest) &&
      validFileReceipt(sidecar?.agentWorkspaceManifest) &&
      sidecar?.editPlan?.kind === "generated" &&
      validFileReceipt(sidecar.editPlan) &&
      validFileReceipt(sidecar.rawModelOutput) &&
      (validFileReceipt(result.scorerReceipt) || Boolean(result.score) || result.error?.phase === "scoring");
    if (!valid) continue;
    attempts += 1;
    taskIds.add(result.taskId!);
  }
  return { cases: taskIds.size, attempts, taskIds: [...taskIds].sort() };
}

function validFileReceipt(receipt: { path?: string; sha256?: string; bytes?: number } | undefined): boolean {
  return Boolean(receipt?.path && receipt.sha256 && typeof receipt.bytes === "number" && receipt.bytes > 0);
}

function bankerToolBenchFull(): BenchmarkTaskCoverageTrack {
  const fullSuite = readJson<FullSuiteGateReceipt>("docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json");
  const stage = readJson<StageReport>("docs/eval/bankertoolbench-stage-smoke.json");
  const run = readJson<RunReport>("docs/eval/bankertoolbench-run-positive-smoke.json");
  const expectedTasks = fullSuite?.expectedCount ?? 100;
  const cleanScoredTasks = fullSuite?.cleanScoredTaskCount ?? 0;
  const executedTasks = fullSuite?.executedTaskCount ?? 0;
  const fullSuiteComplete = fullSuite?.flipEligible === true && cleanScoredTasks >= expectedTasks;
  const stagedTasks = fullSuiteComplete ? cleanScoredTasks : stage?.stagedTaskCount ?? 0;
  const modelRunCases = fullSuiteComplete ? cleanScoredTasks : run?.taskCount ?? 0;
  const modelRunAttempts = fullSuiteComplete ? executedTasks : modelRunCases;
  const complete = stagedTasks >= expectedTasks && modelRunCases >= expectedTasks;

  return {
    id: "bankertoolbench-full-100",
    title: "BankerToolBench full investment-banking benchmark",
    benchmark: "BankerToolBench",
    officialExpectedTasks: expectedTasks,
    officialSourceUrls: [
      "https://github.com/Handshake-AI-Research/bankertoolbench",
      "https://huggingface.co/datasets/handshake-ai-research/bankertoolbench",
    ],
    localScope: fullSuiteComplete ? "full official 100-task clean generic-only full-suite receipt" : "one-task local fixture",
    scannedTasks: fullSuiteComplete ? executedTasks : stage?.scannedTaskCount ?? 0,
    stagedTasks,
    skippedTasks: fullSuiteComplete ? Math.max(0, expectedTasks - cleanScoredTasks) : stage?.skippedTaskCount ?? 99,
    deterministicRunTasks: 0,
    modelRunCases,
    modelRunAttempts,
    localProxyOutputReceipts: 0,
    passRate: fullSuiteComplete ? fullSuite?.passRate ?? null : run?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= expectedTasks,
    allOfficialTasksRunWithModel: modelRunCases >= expectedTasks,
    allOfficialTasksHaveLocalProxyOutputReceipts: false,
    status: complete ? "complete" : stagedTasks > 0 ? "partial" : "missing",
    evidence: [
      "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json",
      "docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json",
      "docs/eval/bankertoolbench-stage-smoke.json",
      "docs/eval/bankertoolbench-run-positive-smoke.json",
      "docs/eval/bankertoolbench-official-contract.json",
    ],
    blockers: complete ? [] : [
      `${Math.max(0, expectedTasks - stagedTasks)} BankerToolBench task(s) still need staging from the official bundle.`,
      "Wire Harbor/MCP/Gandalf verifier replay before claiming an official BTB score.",
    ],
  };
}

function nodeRoomMultiUserConflict(): BenchmarkTaskCoverageTrack {
  const proof = readJson<MultiUserReport>("docs/eval/multi-user-coordination-proof.json");
  const scenarios = proof?.summary?.scenarios ?? 0;
  const passed = proof?.summary?.passedScenarios ?? 0;
  const complete = proof?.summary?.passed === true && scenarios > 0 && passed === scenarios;

  return {
    id: "noderoom-multi-user-conflict",
    title: "NodeRoom multi-user conflict suite",
    benchmark: "NodeRoom",
    officialExpectedTasks: scenarios,
    officialSourceUrls: ["evals/multiUserCoordinationProof.ts"],
    localScope: "internal deterministic conflict suite",
    scannedTasks: scenarios,
    stagedTasks: scenarios,
    skippedTasks: 0,
    deterministicRunTasks: scenarios,
    modelRunCases: 0,
    modelRunAttempts: 0,
    localProxyOutputReceipts: 0,
    passRate: scenarios > 0 ? passed / scenarios : null,
    allOfficialTasksStaged: complete,
    allOfficialTasksRunWithModel: complete,
    allOfficialTasksHaveLocalProxyOutputReceipts: false,
    status: complete ? "complete" : scenarios > 0 ? "partial" : "missing",
    evidence: ["docs/eval/multi-user-coordination-proof.json", "evals/multiUserCoordinationProof.ts"],
    blockers: complete ? [] : ["Run npm run eval:multiuser-coordination -- --strict and clear every conflict scenario."],
  };
}

function sum<T extends Record<string, unknown>>(items: T[], key: keyof T): number {
  return items.reduce((total, item) => total + numberValue(item[key]), 0);
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(stripJsonBom(readFileSync(path, "utf8"))) as T;
  } catch {
    return undefined;
  }
}

function stripJsonBom(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/^ï»¿/, "");
}
