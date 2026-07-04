import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildOfficialBenchmarkTaskCoverageReport,
  type BenchmarkTaskCoverageTrack,
} from "./officialBenchmarkTaskCoverage";
import {
  buildProofloopBenchmarkBoard,
  type ProofloopBenchmarkBoardEntry,
  type ProofloopBenchmarkBoardStatus,
} from "./proofloopBenchmarkBoard";
import { listBenchmarkAdapters, type BenchmarkAdapterId } from "./proofloopBenchmarkAdapters";
import {
  isOfficialOutputExporterBlocker,
  officialOutputManifestComplete,
  officialOutputManifestEvidence,
  readOfficialOutputManifest,
} from "./proofloopOfficialOutputManifests";

export type BenchmarkNormalizationStageStatus =
  | "proven"
  | "ready"
  | "partial"
  | "blocked"
  | "not_applicable";

export type BenchmarkNormalizationFit = "proven" | "ready" | "partial" | "blocked";

export type BenchmarkOfficialFit = "claimed" | "blocked" | "not_applicable";

export type BenchmarkNormalizationStageName =
  | "officialTaskBundle"
  | "productTaskManifest"
  | "nodeRoomRunSpec"
  | "artifactExport"
  | "officialSubmission"
  | "officialScorer";

export type BenchmarkNormalizationStage = {
  status: BenchmarkNormalizationStageStatus;
  contract: string;
  evidence: string[];
  command?: string;
  blockers: string[];
};

export type BenchmarkNormalizationEntry = {
  id: string;
  name: string;
  family: "official_style" | "product_suite" | "external_adapter" | "model_route_harness";
  sourceBenchmark: string;
  productSurface: "NodeRoom";
  taskShape: string;
  productFit: BenchmarkNormalizationFit;
  officialFit: BenchmarkOfficialFit;
  officialScorerSemantics: "preserved" | "not_applicable";
  stages: Record<BenchmarkNormalizationStageName, BenchmarkNormalizationStage>;
  nextBlockers: string[];
};

export type ProofloopBenchmarkNormalizationReport = {
  schema: "proofloop-benchmark-normalization-v1";
  generatedAt?: string;
  policy: string[];
  summary: {
    entries: number;
    productFitProven: number;
    productFitReady: number;
    productFitPartial: number;
    productFitBlocked: number;
    officialScoresClaimed: number;
    officialScoresBlocked: number;
    officialScoresNotApplicable: number;
    everyBenchmarkHasNodeRoomShape: boolean;
  };
  entries: BenchmarkNormalizationEntry[];
};

type OfficialScoreReceipt = {
  status?: "scored" | "blocked_external";
  blockers?: string[];
  scoreClaim?: boolean;
};

type OfficialTaskBundleLock = {
  status?: "locked";
};

export function buildProofloopBenchmarkNormalizationReport(args: {
  root?: string;
  generatedAt?: string;
} = {}): ProofloopBenchmarkNormalizationReport {
  const root = args.root ?? process.cwd();
  const board = buildProofloopBenchmarkBoard({ root, generatedAt: args.generatedAt });
  const boardEntries = new Map(board.entries.map((entry) => [entry.id, entry]));
  const coverage = buildOfficialBenchmarkTaskCoverageReport({ generatedAt: args.generatedAt });
  const coverageTracks = new Map(coverage.tracks.map((track) => [track.id, track]));

  const entries = [
    spreadsheetBenchNormalization(boardEntries.get("spreadsheetbench"), coverageTracks),
    bankerToolBenchNormalization(boardEntries.get("bankertoolbench"), coverageTracks.get("bankertoolbench-full-100")),
    productSuiteNormalization(boardEntries.get("openrouter-convex"), {
      sourceBenchmark: "NodeRoom model-route harness",
      taskShape: "model-route eval case -> NodeRoom/Convex run contract -> route receipt",
      manifestContract: "Model route cases are already expressed as NodeRoom/Convex product tasks.",
      officialReason: "Model-route harness is an internal product benchmark, not an official public scorer.",
    }),
    productSuiteNormalization(boardEntries.get("proximitty-underwriting-pr0"), {
      sourceBenchmark: "Synthetic underwriting Proof Loop suite",
      taskShape: "synthetic underwriting task -> NodeRoom proof-loop run -> local receipt bundle",
      manifestContract: "Suite config defines product tasks, traces, receipts, clips, and local-first memory.",
      officialReason: "Synthetic underwriting demo; no official finance benchmark score should be claimed.",
    }),
    productSuiteNormalization(boardEntries.get("accounting"), {
      sourceBenchmark: "Accounting Proof Loop suite",
      taskShape: "accounting benchmark registry task -> NodeRoom proof-loop run -> receipt bundle",
      manifestContract: "Accounting registry pins benchmark-family tasks into product proof-loop cases.",
      officialReason: "Accounting product runs are product-path evidence unless each upstream official scorer is imported.",
    }),
    productSuiteNormalization(boardEntries.get("notion-sdr-bdr"), {
      sourceBenchmark: "Notion SDR/BDR Proof Loop suite",
      taskShape: "sales workflow task -> NodeRoom/Notion proof-loop run -> receipt bundle",
      manifestContract: "Notion config defines product-facing workflow tasks.",
      officialReason: "Sales workflow suite is a product benchmark, not a public official scorer.",
    }),
    ...listBenchmarkAdapters(root)
      .filter((adapter): adapter is ReturnType<typeof listBenchmarkAdapters>[number] & { id: Exclude<BenchmarkAdapterId, "bankertoolbench"> } =>
        adapter.id !== "bankertoolbench")
      .map((adapter) => externalAdapterNormalization(root, adapter.id, boardEntries.get(adapter.id))),
  ];

  return {
    schema: "proofloop-benchmark-normalization-v1",
    generatedAt: args.generatedAt,
    policy: [
      "Normalize benchmark tasks into NodeRoom product-facing manifests and run specs before routing work through the current codebase.",
      "Do not normalize away official scorer semantics: official rubrics, judges, output schemas, and credentials stay benchmark-specific.",
      "A local product-path proof can be proven while official task expansion, submission export, or official scorer import remains blocked.",
      "Every blocker must name the missing stage: official bundle, product manifest, NodeRoom run spec, artifact export, official submission, or official scorer.",
    ],
    summary: {
      entries: entries.length,
      productFitProven: entries.filter((entry) => entry.productFit === "proven").length,
      productFitReady: entries.filter((entry) => entry.productFit === "ready").length,
      productFitPartial: entries.filter((entry) => entry.productFit === "partial").length,
      productFitBlocked: entries.filter((entry) => entry.productFit === "blocked").length,
      officialScoresClaimed: entries.filter((entry) => entry.officialFit === "claimed").length,
      officialScoresBlocked: entries.filter((entry) => entry.officialFit === "blocked").length,
      officialScoresNotApplicable: entries.filter((entry) => entry.officialFit === "not_applicable").length,
      everyBenchmarkHasNodeRoomShape: entries.every((entry) => entry.productFit !== "blocked"),
    },
    entries,
  };
}

export function renderProofloopBenchmarkNormalizationMarkdown(report: ProofloopBenchmarkNormalizationReport): string {
  const lines = [
    "# Proof Loop Benchmark Normalization",
    "",
    `Generated: ${report.generatedAt ?? "unknown"}`,
    "",
    "This ledger answers whether each benchmark is shaped for the current NodeRoom codebase while preserving its official scorer boundary.",
    "",
    "## Summary",
    "",
    `- Benchmarks normalized/tracked: ${report.summary.entries}`,
    `- Product fit proven: ${report.summary.productFitProven}`,
    `- Product fit ready: ${report.summary.productFitReady}`,
    `- Product fit partial: ${report.summary.productFitPartial}`,
    `- Product fit blocked: ${report.summary.productFitBlocked}`,
    `- Official scores claimed: ${report.summary.officialScoresClaimed}`,
    `- Official scores blocked: ${report.summary.officialScoresBlocked}`,
    `- Official scores not applicable: ${report.summary.officialScoresNotApplicable}`,
    `- Every benchmark has a NodeRoom shape: ${report.summary.everyBenchmarkHasNodeRoomShape ? "yes" : "no"}`,
    "",
    "## Policy",
    "",
    ...report.policy.map((item) => `- ${item}`),
    "",
    "## Normalized Benchmarks",
    "",
    "| Benchmark | Product fit | Official fit | Product manifest | NodeRoom run | Export | Official submission | Next blocker |",
    "|---|---:|---:|---:|---:|---:|---:|---|",
  ];

  for (const entry of report.entries) {
    const blocker = entry.nextBlockers[0] ?? "none";
    lines.push(
      `| \`${entry.id}\` | ${entry.productFit} | ${entry.officialFit} | ` +
      `${entry.stages.productTaskManifest.status} | ${entry.stages.nodeRoomRunSpec.status} | ` +
      `${entry.stages.artifactExport.status} | ${entry.stages.officialSubmission.status} | ${escapePipes(blocker)} |`,
    );
  }

  lines.push("", "## Stage Detail", "");
  for (const entry of report.entries) {
    lines.push(`### ${entry.name}`);
    lines.push("");
    lines.push(`- Source: ${entry.sourceBenchmark}`);
    lines.push(`- Product surface: ${entry.productSurface}`);
    lines.push(`- Task shape: ${entry.taskShape}`);
    lines.push(`- Official scorer semantics: ${entry.officialScorerSemantics}`);
    lines.push("");
    for (const [name, stage] of Object.entries(entry.stages) as Array<[BenchmarkNormalizationStageName, BenchmarkNormalizationStage]>) {
      lines.push(`- ${name}: ${stage.status} - ${stage.contract}`);
      if (stage.evidence.length) lines.push(`  Evidence: ${stage.evidence.map((item) => `\`${item}\``).join(", ")}`);
      if (stage.blockers.length) lines.push(`  Blockers: ${stage.blockers.join("; ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function spreadsheetBenchNormalization(
  boardEntry: ProofloopBenchmarkBoardEntry | undefined,
  coverageTracks: Map<string, BenchmarkTaskCoverageTrack>,
): BenchmarkNormalizationEntry {
  const v1 = coverageTracks.get("spreadsheetbench-v1-full-912");
  const verified = coverageTracks.get("spreadsheetbench-v1-verified-400");
  const v2 = coverageTracks.get("spreadsheetbench-v2-full-321");
  const stagedTargets = (v1?.stagedTasks ?? 0) + (verified?.stagedTasks ?? 0) + (v2?.stagedTasks ?? 0);
  const expectedTargets = (v1?.officialExpectedTasks ?? 0) + (verified?.officialExpectedTasks ?? 0) + (v2?.officialExpectedTasks ?? 0);
  const modelCases = (v1?.modelRunCases ?? 0) + (verified?.modelRunCases ?? 0) + (v2?.modelRunCases ?? 0);
  const productManifestBlockers = [v1, verified, v2].flatMap((track) =>
    track && track.allOfficialTasksStaged ? [] : [`${track?.id ?? "spreadsheetbench"} is not fully staged.`],
  );
  const officialBlockers = [v1, verified, v2].flatMap((track) => track?.blockers ?? []);
  const productProof = boardEntry?.productPathCompletion;

  return entry({
    id: "spreadsheetbench",
    name: "SpreadsheetBench",
    family: "official_style",
    sourceBenchmark: "SpreadsheetBench V1, SpreadsheetBench Verified, and SpreadsheetBench V2",
    taskShape: "official spreadsheet task -> agent/evaluator-isolated workbook manifest -> NodeRoom workbook run -> candidate workbook export -> official scorer",
    productFit: productManifestBlockers.length === 0 && modelCases >= expectedTargets ? "proven" : "partial",
    officialFit: "blocked",
    stages: {
      officialTaskBundle: stage({
        status: productManifestBlockers.length === 0 ? "proven" : v1?.stagedTasks === 912 ? "partial" : "blocked",
        contract: "Official bundles must be staged with agent-visible inputs separated from evaluator answer workbooks and scorer metadata.",
        evidence: [
          ...(v1?.evidence ?? []),
          ...(verified?.evidence ?? []),
          ...(v2?.evidence ?? []),
        ],
        blockers: productManifestBlockers,
      }),
      productTaskManifest: stage({
        status: productManifestBlockers.length === 0 ? "proven" : "partial",
        contract: `Product manifest covers ${stagedTargets}/${expectedTargets} staged task targets with agent/evaluator isolation.`,
        evidence: [
          "docs/eval/spreadsheetbench-v1-912-stage.json",
          "docs/eval/spreadsheetbench-v2-full-stage.json",
          "docs/eval/spreadsheetbench-v2-stage-smoke.json",
          "docs/eval/spreadsheetbench-v1-full-stage-smoke.json",
        ],
        blockers: productManifestBlockers,
      }),
      nodeRoomRunSpec: stage({
        status: modelCases >= expectedTargets ? "proven" : "partial",
        contract: "NodeRoom runner must execute every staged task before official score promotion.",
        evidence: [
          "docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json",
          "docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json",
          "docs/eval/spreadsheetbench-v2-run-smoke.json",
        ],
        blockers: modelCases >= expectedTargets ? [] : [`Only ${modelCases}/${expectedTargets} task targets have model-run cases.`],
        command: "npm run benchmark:spreadsheetbench:run-chunked",
      }),
      artifactExport: stage({
        status: productProof?.status === "proven" ? "proven" : "ready",
        contract: "Candidate workbook exports must be reopened/scored from agent output before evaluator access opens.",
        evidence: productProof?.evidence ?? ["docs/eval/spreadsheetbench-live-room-proof.json"],
        blockers: productProof?.blockers ?? [],
        command: productProof?.command,
      }),
      officialSubmission: stage({
        status: "blocked",
        contract: "Official submission requires full model-generated candidate workbook outputs for the published task set.",
        evidence: ["docs/eval/official-benchmark-task-coverage.json"],
        blockers: officialBlockers,
      }),
      officialScorer: stage({
        status: "partial",
        contract: "Workbook scorer path exists, but official score is not claimable until full model outputs are scored.",
        evidence: ["docs/eval/official-benchmark-readiness.json"],
        blockers: officialBlockers,
      }),
    },
  });
}

function bankerToolBenchNormalization(
  boardEntry: ProofloopBenchmarkBoardEntry | undefined,
  coverageTrack: BenchmarkTaskCoverageTrack | undefined,
): BenchmarkNormalizationEntry {
  const product = boardEntry?.productPathCompletion;
  const official = boardEntry?.officialSemanticScore;
  const officialClaimed = official?.status === "proven";
  return entry({
    id: "bankertoolbench",
    name: "BankerToolBench",
    family: "official_style",
    sourceBenchmark: "BankerToolBench full 100-task suite",
    taskShape: "official banking task -> NodeRoom fresh-room task -> generated deliverable package -> full-suite gate receipt",
    productFit: productFitFromBoard(product?.status),
    officialFit: officialClaimed ? "claimed" : "blocked",
    stages: {
      officialTaskBundle: stage({
        status: coverageTrack?.stagedTasks === coverageTrack?.officialExpectedTasks ? "proven" : "partial",
        contract: "Official task bundle is represented in the full-suite gate receipt and staged task evidence.",
        evidence: coverageTrack?.evidence ?? [],
        blockers: coverageTrack?.allOfficialTasksStaged ? [] : coverageTrack?.blockers ?? [],
      }),
      productTaskManifest: stage({
        status: product?.status === "proven" ? "proven" : "ready",
        contract: "Each official task is normalized into a NodeRoom fresh-room task with expected deliverable artifacts.",
        evidence: product?.evidence ?? [],
        blockers: product?.blockers ?? [],
        command: product?.command,
      }),
      nodeRoomRunSpec: stage({
        status: coverageTrack?.modelRunCases === coverageTrack?.officialExpectedTasks ? "proven" : "partial",
        contract: "NodeRoom run spec covers all official tasks in the full-suite receipt.",
        evidence: ["docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json"],
        blockers: coverageTrack?.allOfficialTasksRunWithModel ? [] : coverageTrack?.blockers ?? [],
        command: "npm run benchmark:bankertoolbench:fullsuite-gate",
      }),
      artifactExport: stage({
        status: product?.status === "proven" ? "proven" : "ready",
        contract: "Generated Excel, PowerPoint, Word, and PDF deliverables are packaged and reopened before scoring.",
        evidence: product?.evidence ?? [],
        blockers: product?.blockers ?? [],
      }),
      officialSubmission: stage({
        status: officialClaimed ? "proven" : "blocked",
        contract: "Full-suite gate imports the official-style scoring receipt without changing the scorer claim.",
        evidence: official?.evidence ?? [],
        blockers: officialClaimed ? [] : official?.blockers ?? [],
      }),
      officialScorer: stage({
        status: officialClaimed ? "proven" : "blocked",
        contract: "Official semantic score is only claimed from the full-suite gate receipt.",
        evidence: official?.evidence ?? [],
        blockers: officialClaimed ? [] : official?.blockers ?? [],
        command: official?.command,
      }),
    },
  });
}

function productSuiteNormalization(
  boardEntry: ProofloopBenchmarkBoardEntry | undefined,
  args: {
    sourceBenchmark: string;
    taskShape: string;
    manifestContract: string;
    officialReason: string;
  },
): BenchmarkNormalizationEntry {
  const product = boardEntry?.productPathCompletion;
  return entry({
    id: boardEntry?.id ?? "missing-product-suite",
    name: boardEntry?.name ?? "Missing product suite",
    family: boardEntry?.family ?? "product_suite",
    sourceBenchmark: args.sourceBenchmark,
    taskShape: args.taskShape,
    productFit: productFitFromBoard(product?.status),
    officialFit: "not_applicable",
    officialScorerSemantics: "not_applicable",
    stages: {
      officialTaskBundle: stage({
        status: "not_applicable",
        contract: args.officialReason,
        evidence: boardEntry?.officialSemanticScore.evidence ?? [],
        blockers: boardEntry?.officialSemanticScore.blockers ?? [],
      }),
      productTaskManifest: stage({
        status: product?.status === "proven" ? "proven" : product?.status === "ready_to_run" ? "ready" : "partial",
        contract: args.manifestContract,
        evidence: product?.evidence ?? [],
        blockers: product?.blockers ?? [],
        command: product?.command,
      }),
      nodeRoomRunSpec: stage({
        status: product?.status === "proven" ? "proven" : product?.status === "ready_to_run" ? "ready" : "partial",
        contract: "Run through the current NodeRoom Proof Loop command and receipt contract.",
        evidence: product?.evidence ?? [],
        blockers: product?.blockers ?? [],
        command: product?.command,
      }),
      artifactExport: stage({
        status: product?.status === "proven" ? "proven" : "ready",
        contract: "Product evidence exports are the suite receipt bundle, trace, scorecard, cost ledger, and verifier receipt.",
        evidence: product?.evidence ?? [],
        blockers: product?.blockers ?? [],
      }),
      officialSubmission: stage({
        status: "not_applicable",
        contract: args.officialReason,
        evidence: boardEntry?.officialSemanticScore.evidence ?? [],
        blockers: boardEntry?.officialSemanticScore.blockers ?? [],
      }),
      officialScorer: stage({
        status: "not_applicable",
        contract: args.officialReason,
        evidence: boardEntry?.officialSemanticScore.evidence ?? [],
        blockers: boardEntry?.officialSemanticScore.blockers ?? [],
      }),
    },
  });
}

function externalAdapterNormalization(
  root: string,
  adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">,
  boardEntry: ProofloopBenchmarkBoardEntry | undefined,
): BenchmarkNormalizationEntry {
  const product = boardEntry?.productPathCompletion;
  const official = boardEntry?.officialSemanticScore;
  const scoreReceiptPath = `docs/eval/proofloop-official-scores/${adapterId}.json`;
  const taskBundlePath = `docs/eval/proofloop-official-task-bundles/${adapterId}.json`;
  const scoreReceipt = readJson<OfficialScoreReceipt>(root, scoreReceiptPath);
  const taskBundle = readJson<OfficialTaskBundleLock>(root, taskBundlePath);
  const outputManifest = readOfficialOutputManifest(root, adapterId);
  const outputComplete = officialOutputManifestComplete(outputManifest);
  const taskBundleLocked = taskBundle?.status === "locked";
  const productProofPassed = product?.status === "proven";
  const officialScored = scoreReceipt?.status === "scored" && scoreReceipt.scoreClaim === true;
  const officialBlockers = official?.blockers?.length
    ? official.blockers
    : scoreReceipt?.blockers ?? [`${adapterId}: official scorer receipt is not scored.`];
  const filteredOfficialBlockers = outputComplete
    ? officialBlockers.filter((blocker) => !isOfficialOutputExporterBlocker(adapterId, blocker))
    : officialBlockers;
  const officialTaskExpansionBlocker = officialTaskExpansionBlockerFor(adapterId);

  return entry({
    id: adapterId,
    name: boardEntry?.name ?? adapterId,
    family: "external_adapter",
    sourceBenchmark: externalSourceName(adapterId),
    taskShape: externalTaskShape(adapterId),
    productFit: "partial",
    officialFit: officialScored ? "claimed" : "blocked",
    stages: {
      officialTaskBundle: stage({
        status: taskBundleLocked ? "ready" : "blocked",
        contract: "Official task bundle must be locked by repository/dataset revision before product expansion.",
        evidence: taskBundleLocked ? [taskBundlePath] : [],
        blockers: taskBundleLocked ? [] : [`${adapterId}: official task bundle lock is missing.`],
      }),
      productTaskManifest: stage({
        status: productProofPassed ? "partial" : "blocked",
        contract: "Current codebase has a local compatibility ProductTaskManifest; full official task-id expansion is still required.",
        evidence: product?.evidence ?? [],
        blockers: [
          ...(product?.blockers ?? []),
          officialTaskExpansionBlocker,
        ],
        command: product?.command,
      }),
      nodeRoomRunSpec: stage({
        status: productProofPassed ? "proven" : "ready",
        contract: "Strict prod browser run spec exists for the local compatibility task through NodeRoom.",
        evidence: product?.evidence ?? [],
        blockers: productProofPassed ? [] : product?.blockers ?? [],
        command: product?.command,
      }),
      artifactExport: stage({
        status: outputComplete ? "proven" : "blocked",
        contract: externalArtifactExportContract(adapterId),
        evidence: [
          ...(product?.evidence ?? []),
          ...officialOutputManifestEvidence(adapterId, outputManifest),
        ],
        blockers: outputComplete ? [] : [externalArtifactExportBlocker(adapterId)],
      }),
      officialSubmission: stage({
        status: officialScored ? "proven" : "blocked",
        contract: externalOfficialSubmissionContract(adapterId),
        evidence: [scoreReceiptPath].filter((path) => existsSync(join(root, path))),
        blockers: officialScored ? [] : filteredOfficialBlockers,
      }),
      officialScorer: stage({
        status: officialScored ? "proven" : "blocked",
        contract: "Upstream official scorer or judge output must be imported without changing the rubric.",
        evidence: [
          ...(official?.evidence ?? []),
          scoreReceiptPath,
        ].filter((path) => existsSync(join(root, path))),
        blockers: officialScored ? [] : filteredOfficialBlockers,
        command: official?.command,
      }),
    },
  });
}

function entry(args: {
  id: string;
  name: string;
  family: BenchmarkNormalizationEntry["family"];
  sourceBenchmark: string;
  taskShape: string;
  productFit: BenchmarkNormalizationFit;
  officialFit: BenchmarkOfficialFit;
  officialScorerSemantics?: "preserved" | "not_applicable";
  stages: Record<BenchmarkNormalizationStageName, BenchmarkNormalizationStage>;
}): BenchmarkNormalizationEntry {
  const nextBlockers = Object.values(args.stages)
    .filter((candidate) => candidate.status !== "not_applicable")
    .flatMap((candidate) => candidate.blockers);
  return {
    id: args.id,
    name: args.name,
    family: args.family,
    sourceBenchmark: args.sourceBenchmark,
    productSurface: "NodeRoom",
    taskShape: args.taskShape,
    productFit: args.productFit,
    officialFit: args.officialFit,
    officialScorerSemantics: args.officialScorerSemantics ?? "preserved",
    stages: args.stages,
    nextBlockers: [...new Set(nextBlockers)],
  };
}

function stage(args: {
  status: BenchmarkNormalizationStageStatus;
  contract: string;
  evidence?: string[];
  command?: string;
  blockers?: string[];
}): BenchmarkNormalizationStage {
  return {
    status: args.status,
    contract: args.contract,
    evidence: [...new Set(args.evidence ?? [])],
    command: args.command,
    blockers: [...new Set(args.blockers ?? [])],
  };
}

function productFitFromBoard(status: ProofloopBenchmarkBoardStatus | undefined): BenchmarkNormalizationFit {
  if (status === "proven") return "proven";
  if (status === "ready_to_run") return "ready";
  if (status === "blocked") return "blocked";
  return "partial";
}

function externalSourceName(adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">): string {
  if (adapterId === "finch") return "Finch / FinWorkBench";
  if (adapterId === "finauditing") return "FinAuditing";
  return "WorkstreamBench";
}

function externalTaskShape(adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">): string {
  if (adapterId === "finch") {
    return "official Finch workflow task -> ProductTaskManifest -> NodeRoom run -> content_parts.jsonl submission -> Azure OpenAI judge";
  }
  if (adapterId === "finauditing") {
    return "official FinSM/FinRE/FinMR row -> ProductTaskManifest -> NodeRoom run -> prediction JSONL -> official evaluator notebook";
  }
  return "official spreadsheet workstream -> ProductTaskManifest -> NodeRoom run -> structured representation -> official LLM judge";
}

function officialTaskExpansionBlockerFor(adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">): string {
  if (adapterId === "finch") return "Expand all 172 official Finch task ids into ProductTaskManifest rows.";
  if (adapterId === "finauditing") return "Expand FinSM, FinRE, and FinMR test rows into ProductTaskManifest rows.";
  return "Obtain the public official WorkstreamBench task bundle before expanding ProductTaskManifest rows.";
}

function externalArtifactExportContract(adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">): string {
  if (adapterId === "finch") return "Export one NodeRoom model-output artifact per official Finch task id.";
  if (adapterId === "finauditing") return "Export official-format prediction JSONL for FinSM, FinRE, and FinMR.";
  return "Export the official structured workstream representation expected by WorkstreamBench.";
}

function externalArtifactExportBlocker(adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">): string {
  if (adapterId === "finch") return "No NodeRoom model-output directory exists with one output artifact per official Finch task id.";
  if (adapterId === "finauditing") return "No NodeRoom prediction JSONL exists for FinSM, FinRE, or FinMR in the official evaluator format.";
  return "No official WorkstreamBench output schema is available to export against.";
}

function externalOfficialSubmissionContract(adapterId: Exclude<BenchmarkAdapterId, "bankertoolbench">): string {
  if (adapterId === "finch") return "Submit content_parts.jsonl built by upstream prompt_build_pipeline.py to call_gpt_judge.py.";
  if (adapterId === "finauditing") return "Submit official prediction JSONL rows with prediction and ground_truth fields to the evaluator notebooks.";
  return "Submit official structured representations to the released WorkstreamBench scorer/rubric.";
}

function readJson<T>(root: string, relativePath: string): T | undefined {
  const path = join(root, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
