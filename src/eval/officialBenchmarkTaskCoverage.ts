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
  passRate: number | null;
  allOfficialTasksStaged: boolean;
  allOfficialTasksRunWithModel: boolean;
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
  taskCount?: number;
  caseCount?: number;
  repeatCount?: number;
  attemptCount?: number;
  passRate?: number;
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
  const stagedTasks = stage?.stagedTaskCount ?? 0;
  const deterministicRunTasks = copyRun?.caseCount ?? copyRun?.taskCount ?? 0;
  const complete = stagedTasks >= 912 && deterministicRunTasks >= 912;

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
      ? "full public 912-task bundle staged and scored with deterministic copy-input baseline"
      : "full public 912-task bundle evidence is incomplete",
    scannedTasks: stage?.scannedTaskCount ?? 0,
    stagedTasks,
    skippedTasks: stage?.skippedTaskCount ?? 912,
    deterministicRunTasks,
    modelRunCases: 0,
    modelRunAttempts: 0,
    passRate: copyRun?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= 912,
    allOfficialTasksRunWithModel: false,
    status: complete ? "partial" : stagedTasks > 0 ? "partial" : "missing",
    evidence: [
      "docs/eval/spreadsheetbench-v1-912-stage.json",
      "docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json",
      "docs/eval/official-benchmark-readiness.json",
    ],
    blockers: [
      ...(stagedTasks >= 912 ? [] : ["Download/lock and stage the full 912-task SpreadsheetBench V1 bundle."]),
      ...(deterministicRunTasks >= 912 ? [] : ["Run all 912 staged V1 tasks through the deterministic scorer path."]),
      "Run all 912 tasks through the model runner or an approved chunked official-policy runner before claiming a model score.",
    ],
  };
}

function spreadsheetBenchV1Verified(): BenchmarkTaskCoverageTrack {
  const stage = readJson<StageReport>("docs/eval/spreadsheetbench-v1-full-stage-smoke.json");
  const copyRun = readJson<RunReport>("docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json");
  const n5Run = readJson<RunReport>("docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json");
  const stagedTasks = stage?.stagedTaskCount ?? 0;
  const modelRunCases = n5Run?.caseCount ?? 0;
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
    modelRunAttempts: n5Run?.attemptCount ?? 0,
    passRate: n5Run?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= 400,
    allOfficialTasksRunWithModel: modelRunCases >= 400,
    status: complete ? "complete" : stagedTasks >= 400 ? "partial" : "missing",
    evidence: [
      "docs/eval/spreadsheetbench-v1-full-stage-smoke.json",
      "docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json",
      "docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json",
    ],
    blockers: complete ? [] : [
      `${Math.max(0, 400 - modelRunCases)} verified task(s) still need model-run evidence; current N=5 smoke covers ${modelRunCases}/400 cases.`,
      "Full verified-score promotion still needs official scoring parity, not only local workbook scoring.",
    ],
  };
}

function spreadsheetBenchV2Full(): BenchmarkTaskCoverageTrack {
  const stage = readJson<StageReport>("docs/eval/spreadsheetbench-v2-full-stage.json")
    ?? readJson<StageReport>("docs/eval/spreadsheetbench-v2-stage-smoke.json");
  const fullStageExists = existsSync("docs/eval/spreadsheetbench-v2-full-stage.json");
  const run = readJson<RunReport>("docs/eval/spreadsheetbench-v2-run-smoke.json");
  const stagedTasks = stage?.stagedTaskCount ?? 0;
  const modelRunCases = run?.caseCount ?? run?.taskCount ?? 0;
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
    deterministicRunTasks: run?.taskCount ?? 0,
    modelRunCases,
    modelRunAttempts: run?.attemptCount ?? 0,
    passRate: run?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= 321,
    allOfficialTasksRunWithModel: modelRunCases >= 321,
    status: complete ? "complete" : stagedTasks > 0 ? "partial" : "missing",
    evidence: [
      ...(fullStageExists ? [
        "docs/eval/spreadsheetbench-v2-full-ingest.json",
        "docs/eval/spreadsheetbench-v2-full-stage.json",
      ] : []),
      "docs/eval/spreadsheetbench-v2-stage-smoke.json",
      "docs/eval/spreadsheetbench-v2-run-smoke.json",
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
    passRate: fullSuiteComplete ? fullSuite?.passRate ?? null : run?.passRate ?? null,
    allOfficialTasksStaged: stagedTasks >= expectedTasks,
    allOfficialTasksRunWithModel: modelRunCases >= expectedTasks,
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
    passRate: scenarios > 0 ? passed / scenarios : null,
    allOfficialTasksStaged: complete,
    allOfficialTasksRunWithModel: complete,
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
