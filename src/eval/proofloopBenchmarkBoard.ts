import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listBenchmarkAdapters, validateBenchmarkAdapter, type ProofloopBenchmarkAdapter } from "./proofloopBenchmarkAdapters";
import {
  isOfficialOutputExporterBlocker,
  officialOutputManifestComplete,
  officialOutputManifestEvidence,
  readOfficialOutputManifest,
} from "./proofloopOfficialOutputManifests";

export type ProofloopBenchmarkBoardStatus =
  | "proven"
  | "ready_to_run"
  | "registered"
  | "partial"
  | "blocked"
  | "needs_scaffold_or_run"
  | "proxy_only"
  | "not_applicable"
  | "not_claimed";

export type ProofloopBenchmarkBoardScore = {
  status: ProofloopBenchmarkBoardStatus;
  scoreType: "product_path_completion" | "official_semantic_score";
  evidence: string[];
  command?: string;
  blockers: string[];
  metrics?: Record<string, number | string | boolean | null>;
};

export type ProofloopBenchmarkBoardEntry = {
  id: string;
  name: string;
  family: "official_style" | "product_suite" | "external_adapter" | "model_route_harness";
  liveUserContract: "required" | "not_applicable";
  productPathCompletion: ProofloopBenchmarkBoardScore;
  officialSemanticScore: ProofloopBenchmarkBoardScore;
  notes: string[];
};

export type ProofloopBenchmarkBoard = {
  schema: 1;
  generatedAt?: string;
  policy: string[];
  summary: {
    total: number;
    productPathProven: number;
    productPathReadyToRun: number;
    externalAdaptersRegistered: number;
    officialScoresClaimed: number;
    officialScoresNotApplicable: number;
    officialScoresBlockedOrNotClaimed: number;
  };
  entries: ProofloopBenchmarkBoardEntry[];
};

type JsonObject = Record<string, unknown>;

type ExternalAdapterBlockerReceipt = {
  status?: "ready" | "blocked_external";
  localImplementationStatus?: "ready" | "missing";
  officialScoreStatus?: "imported" | "blocked_external";
  officialScoreReceiptPath?: string;
  officialTaskBundleManifestPath?: string;
  blockers?: string[];
  missingImplementationFiles?: string[];
  officialSourceUrls?: string[];
  resumeCommands?: string[];
};

type ExternalAdapterProductProofReceipt = {
  status?: "passed" | "failed";
  taskCount?: number;
  baseUrl?: string;
  localAdapterOnly?: boolean;
  officialScoreClaim?: boolean;
  evidence?: string[];
  failedGates?: string[];
  browserProof?: {
    problemCounts?: Record<string, number | undefined>;
    roomUrl?: string;
  };
};

type BlockerAnalysisReceipt = {
  status?: "blocked_external" | "needs_scaffold_or_run" | "proxy_only" | "ready";
  artifacts?: Record<string, string>;
  remainingLocalClasses?: string[];
  remainingExternalClasses?: string[];
  blockers?: string[];
  nextCommands?: string[];
};

type TaskCoverageReceipt = {
  summary?: { strictFullCoverageReady?: boolean };
  tracks?: Array<{
    id?: string;
    officialExpectedTasks?: number;
    stagedTasks?: number;
    modelRunCases?: number;
    blockers?: string[];
  }>;
};

export function deriveExternalAdapterProductPathStatus(args: {
  btbLivePassed: boolean;
  liveRoomProofStatus?: "passed" | "failed";
  storyRouteProofStatus?: "passed" | "failed";
  readyToRun: boolean;
}): ProofloopBenchmarkBoardStatus {
  if (args.btbLivePassed || args.liveRoomProofStatus === "passed") return "proven";
  if (args.storyRouteProofStatus === "passed") return "partial";
  return args.readyToRun ? "ready_to_run" : "registered";
}

export function buildProofloopBenchmarkBoard(args: {
  root?: string;
  generatedAt?: string;
} = {}): ProofloopBenchmarkBoard {
  const root = args.root ?? process.cwd();
  const adapterEntries = listBenchmarkAdapters(root).map((adapter) => adapterEntry(adapter, root));
  const entries = [
    spreadsheetBenchEntry(root),
    openRouterConvexEntry(root),
    proximittyEntry(root),
    accountingEntry(root),
    notionEntry(root),
    ...adapterEntries,
  ];

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    policy: [
      "Product-path completion is useful proof: real UI, visible progress, artifacts, verifier receipts, trace, memory, and browser evidence.",
      "Official semantic score is only claimed when the benchmark's official scorer/verifier result is imported.",
      "Docker/Harbor isolation can block official score promotion; it must not block product-path Proof Loop runs.",
      "External benchmark adapters can prove local app-agnostic product paths before official score promotion; the two claims must stay separate.",
      "Proof Loop may not call a lane external-blocked until setup, research, scaffold, doctor, resume, model, and harness receipts exist.",
    ],
    summary: {
      total: entries.length,
      productPathProven: entries.filter((entry) => entry.productPathCompletion.status === "proven").length,
      productPathReadyToRun: entries.filter((entry) => entry.productPathCompletion.status === "ready_to_run").length,
      externalAdaptersRegistered: entries.filter((entry) => entry.productPathCompletion.status === "registered").length,
      officialScoresClaimed: entries.filter((entry) => entry.officialSemanticScore.status === "proven").length,
      officialScoresNotApplicable: entries.filter((entry) => entry.officialSemanticScore.status === "not_applicable").length,
      officialScoresBlockedOrNotClaimed: entries.filter(
        (entry) => !["proven", "not_applicable"].includes(entry.officialSemanticScore.status),
      ).length,
    },
    entries,
  };
}

export function renderProofloopBenchmarkBoardMarkdown(board: ProofloopBenchmarkBoard): string {
  const lines = [
    "# Proof Loop Benchmark Board",
    "",
    `Generated: ${board.generatedAt ?? "unknown"}`,
    "",
    "This board keeps fast product proof separate from official benchmark score claims.",
    "",
    "## Policy",
    "",
    ...board.policy.map((item) => `- ${item}`),
    "",
    "## Summary",
    "",
    `- Benchmarks tracked: ${board.summary.total}`,
    `- Product-path proven: ${board.summary.productPathProven}`,
    `- Product-path ready to run: ${board.summary.productPathReadyToRun}`,
    `- External adapters registered: ${board.summary.externalAdaptersRegistered}`,
    `- Official scores claimed: ${board.summary.officialScoresClaimed}`,
    `- Official scores not applicable: ${board.summary.officialScoresNotApplicable}`,
    `- Official scores blocked/not claimed: ${board.summary.officialScoresBlockedOrNotClaimed}`,
    "",
    "## Benchmarks",
    "",
    "| Benchmark | Family | Product path | Official score | Evidence | Next blocker |",
    "|---|---|---|---|---|---|",
  ];

  for (const entry of board.entries) {
    const product = entry.productPathCompletion;
    const official = entry.officialSemanticScore;
    const evidence = [...new Set([...product.evidence, ...official.evidence])].slice(0, 4).map((item) => `\`${item}\``).join("<br>") || "none";
    const blocker = renderTableBlockers([...product.blockers, ...official.blockers]);
    lines.push(`| \`${entry.id}\` | ${entry.family} | ${product.status} | ${official.status} | ${evidence} | ${escapePipes(blocker)} |`);
  }

  lines.push(
    "",
    "## Interpretation",
    "",
    "- `proven` product path means Proof Loop has evidence for the app workflow; it is not an official leaderboard score.",
    "- `registered` means the benchmark is tracked and has an adapter contract, but it should not be sold as live-proofed yet.",
    "- `not_applicable` official score means the lane is an internal/product harness, not a public official benchmark score lane.",
    "- `blocked` official score means the scorer/verifier path is not imported, even if product-path proof exists.",
    "- `needs_scaffold_or_run` means Proof Loop found local exporter, model-run, or harness work that must be attempted before external-blocked is allowed.",
    "- `proxy_only` means local product/proxy evidence exists, but the lane still cannot claim an official score.",
    "",
  );

  return `${lines.join("\n")}\n`;
}

function renderTableBlockers(blockers: string[]): string {
  const unique = [...new Set(blockers.filter(Boolean))];
  if (unique.length === 0) return "none";
  return unique.map((blocker) => blocker.trim()).join("<br>");
}

function spreadsheetBenchEntry(root: string): ProofloopBenchmarkBoardEntry {
  const live = readJson<JsonObject>(root, "docs/eval/spreadsheetbench-live-room-proof.json");
  const taskCoverage = readJson<TaskCoverageReceipt>(root, "docs/eval/official-benchmark-task-coverage.json");
  const v1Solver = readLaneAnalysis(root, "spreadsheetbench-v1");
  const v2Solver = readLaneAnalysis(root, "spreadsheetbench-v2");
  const livePassed = live?.passed === true;
  const officialReady = taskCoverage?.summary?.strictFullCoverageReady === true;
  const solverStatus = solverAggregateStatus([v1Solver, v2Solver]);

  return {
    id: "spreadsheetbench",
    name: "SpreadsheetBench",
    family: "official_style",
    liveUserContract: "required",
    productPathCompletion: {
      status: livePassed ? "proven" : "blocked",
      scoreType: "product_path_completion",
      evidence: ["docs/eval/spreadsheetbench-live-room-proof.json"],
      command: "npm run benchmark:spreadsheetbench:proof",
      blockers: livePassed ? [] : ["Run the fresh-room SpreadsheetBench UI proof and export/reopen scorer."],
    },
    officialSemanticScore: {
      status: officialReady ? "proven" : solverStatus ?? "blocked",
      scoreType: "official_semantic_score",
      evidence: [
        "docs/eval/official-benchmark-task-coverage.json",
        "docs/eval/official-benchmark-readiness.json",
        ...(v1Solver ? [".proofloop/lanes/spreadsheetbench-v1/blocker-analysis.json"] : []),
        ...(v2Solver ? [".proofloop/lanes/spreadsheetbench-v2/blocker-analysis.json"] : []),
      ],
      command: solverStatus ? "npm run proofloop -- solve-blockers --goal official-scores" : "npm run benchmark:official:task-coverage",
      blockers: officialReady ? [] : spreadsheetBenchCoverageBlockers(taskCoverage, [v1Solver, v2Solver]),
    },
    notes: ["Workbook product proof is separate from full official task coverage."],
  };
}

function openRouterConvexEntry(root: string): ProofloopBenchmarkBoardEntry {
  const report = readJson<{ summary?: { harnessReady?: boolean; officialPromotionReady?: boolean } }>(root, "docs/eval/openrouter-convex-benchmark.json");
  const harnessReady = report?.summary?.harnessReady === true;
  const officialReady = report?.summary?.officialPromotionReady === true;

  return {
    id: "openrouter-convex",
    name: "OpenRouter on Convex",
    family: "model_route_harness",
    liveUserContract: "required",
    productPathCompletion: {
      status: harnessReady ? "proven" : "blocked",
      scoreType: "product_path_completion",
      evidence: ["docs/eval/openrouter-convex-benchmark.json"],
      command: "npm run benchmark:openrouter-convex -- --strict",
      blockers: harnessReady ? [] : ["OpenRouter-on-Convex product harness cases are not all passing."],
    },
    officialSemanticScore: {
      status: officialReady ? "proven" : "not_applicable",
      scoreType: "official_semantic_score",
      evidence: ["docs/eval/openrouter-convex-benchmark.json"],
      command: "npm run benchmark:openrouter-convex",
      blockers: officialReady ? [] : ["Model-route harness; not a public official benchmark score lane."],
    },
    notes: ["Route eligibility should depend on the Convex harness, not Docker/Harbor official-runner availability."],
  };
}

function proximittyEntry(root: string): ProofloopBenchmarkBoardEntry {
  const latest = readJson<{ suite?: string; passed?: boolean; score?: number; outputDir?: string }>(root, ".proofloop/runs/latest/run-result.json");
  const hasConfig = existsSync(join(root, "proofloop/suites/proximitty-underwriting-pr0.json"));
  const proven = latest?.suite === "proximitty-underwriting-pr0" && latest.passed === true;

  return {
    id: "proximitty-underwriting-pr0",
    name: "Proximitty underwriting PR0",
    family: "product_suite",
    liveUserContract: "required",
    productPathCompletion: {
      status: proven ? "proven" : hasConfig ? "ready_to_run" : "blocked",
      scoreType: "product_path_completion",
      evidence: proven
        ? [".proofloop/runs/latest/run-result.json", normalizeEvidencePath(root, latest.outputDir ?? ".proofloop/runs/latest")]
        : ["proofloop/suites/proximitty-underwriting-pr0.json"],
      command: "npm run proofloop:proximitty",
      blockers: proven || hasConfig ? [] : ["Missing Proximitty proof suite config."],
    },
    officialSemanticScore: {
      status: "not_applicable",
      scoreType: "official_semantic_score",
      evidence: ["proofloop/suites/proximitty-underwriting-pr0.json"],
      blockers: ["Synthetic underwriting suite; do not label as an official finance benchmark score."],
    },
    notes: ["Evaluation-only underwriting demo; not a real lending or credit decision."],
  };
}

function accountingEntry(root: string): ProofloopBenchmarkBoardEntry {
  const hasConfig = existsSync(join(root, "proofloop/accounting/proofloop.accounting.config.json"));
  const hasRegistry = existsSync(join(root, "proofloop/accounting/benchmarks/benchmark-registry.json"));

  return {
    id: "accounting",
    name: "Accounting proof-loop",
    family: "product_suite",
    liveUserContract: "required",
    productPathCompletion: {
      status: hasConfig && hasRegistry ? "ready_to_run" : "blocked",
      scoreType: "product_path_completion",
      evidence: ["proofloop/accounting/proofloop.accounting.config.json", "proofloop/accounting/benchmarks/benchmark-registry.json"],
      command: "npm run proofloop:accounting",
      blockers: hasConfig && hasRegistry ? [] : ["Accounting proof-loop config or benchmark registry is missing."],
    },
    officialSemanticScore: {
      status: "not_applicable",
      scoreType: "official_semantic_score",
      evidence: ["proofloop/accounting/benchmarks/benchmark-registry.json"],
      blockers: ["Accounting suite pins external benchmark families, but local proof-loop runs are product-path evidence."],
    },
    notes: ["Pinned benchmark families include Finch, BizFinBench, FinTMMBench, QuantEval, and FATURA."],
  };
}

function notionEntry(root: string): ProofloopBenchmarkBoardEntry {
  const hasConfig = existsSync(join(root, "proofloop/notion/proofloop.notion.config.json"));

  return {
    id: "notion-sdr-bdr",
    name: "Notion SDR/BDR proof-loop",
    family: "product_suite",
    liveUserContract: "required",
    productPathCompletion: {
      status: hasConfig ? "ready_to_run" : "blocked",
      scoreType: "product_path_completion",
      evidence: ["proofloop/notion/proofloop.notion.config.json"],
      command: "npm run proofloop:notion",
      blockers: hasConfig ? [] : ["Notion proof-loop config is missing."],
    },
    officialSemanticScore: {
      status: "not_applicable",
      scoreType: "official_semantic_score",
      evidence: ["proofloop/notion/proofloop.notion.config.json"],
      blockers: ["Product workflow benchmark, not an official public benchmark score."],
    },
    notes: ["Sales workflow suite used for proof-loop mechanics and memory learning."],
  };
}

function adapterEntry(adapter: ProofloopBenchmarkAdapter, root: string): ProofloopBenchmarkBoardEntry {
  const validationErrors = validateBenchmarkAdapter(adapter);
  const implementationMissing = missingImplementationFiles(adapter, root);
  const isBtb = adapter.id === "bankertoolbench";
  const live = isBtb ? readJson<JsonObject>(root, "docs/eval/bankertoolbench-live-room-proof.json") : undefined;
  const btbOfficial = isBtb ? readJson<{ pass?: boolean; blockers?: string[] }>(root, "docs/eval/bankertoolbench-official-contract.json") : undefined;
  const btbFullSuite = isBtb
    ? readJson<{
      flipEligible?: boolean;
      expectedCount?: number;
      executedTaskCount?: number;
      cleanScoredTaskCount?: number;
      meanCleanReward?: number | null;
      passThreshold?: number;
      passCount?: number;
      passRate?: number | null;
      claim?: string;
    }>(root, "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json")
    : undefined;
  const adapterBlocker = !isBtb
    ? readJson<ExternalAdapterBlockerReceipt>(root, `docs/eval/proofloop-adapter-blockers/${adapter.id}.json`)
    : undefined;
  const adapterProductProof = !isBtb
    ? readJson<ExternalAdapterProductProofReceipt>(root, `docs/eval/proofloop-external-adapter-runs/${adapter.id}.json`)
    : undefined;
  const adapterLiveRoomProof = !isBtb
    ? readJson<ExternalAdapterProductProofReceipt>(root, `docs/eval/proofloop-external-adapter-live-room-runs/${adapter.id}.json`)
    : undefined;
  const blockerAnalysis = !isBtb ? readLaneAnalysis(root, adapter.id) : undefined;
  const outputManifest = !isBtb ? readOfficialOutputManifest(root, adapter.id) : undefined;
  const outputManifestComplete = officialOutputManifestComplete(outputManifest);
  const livePassed = live?.passed === true;
  const readyToRun = validationErrors.length === 0 && implementationMissing.length === 0;
  const adapterProductProofPassed = adapterProductProof?.status === "passed";
  const adapterLiveRoomProofPassed = adapterLiveRoomProof?.status === "passed";
  const adapterProductPathStatus = deriveExternalAdapterProductPathStatus({
    btbLivePassed: livePassed,
    liveRoomProofStatus: adapterLiveRoomProof?.status,
    storyRouteProofStatus: adapterProductProof?.status,
    readyToRun,
  });
  const btbOfficialProven = btbFullSuite?.flipEligible === true;
  const adapterBlockerEvidence = !isBtb && adapterBlocker ? [`docs/eval/proofloop-adapter-blockers/${adapter.id}.json`] : [];
  const adapterOfficialEvidence = !isBtb && adapterBlocker
    ? [
      adapterBlocker.officialScoreReceiptPath,
      adapterBlocker.officialTaskBundleManifestPath,
    ].filter((item): item is string => typeof item === "string" && existsSync(join(root, item)))
    : [];
  const adapterProductProofEvidence = !isBtb && adapterProductProof ? [`docs/eval/proofloop-external-adapter-runs/${adapter.id}.json`] : [];
  const adapterLiveRoomProofEvidence = !isBtb && adapterLiveRoomProof ? [`docs/eval/proofloop-external-adapter-live-room-runs/${adapter.id}.json`] : [];
  const rawAdapterOfficialBlockers = adapterBlocker?.blockers?.length
    ? adapterBlocker.blockers
    : ["Run npm run benchmark:proofloop:adapter-blockers to produce a typed external-adapter blocker receipt."];
  const adapterOfficialBlockers = outputManifestComplete
    ? rawAdapterOfficialBlockers.filter((blocker) => !isOfficialOutputExporterBlocker(adapter.id, blocker))
    : rawAdapterOfficialBlockers;
  const rawSolverBlockers = !isBtb ? solverBlockers([blockerAnalysis], adapterOfficialBlockers) : [];
  const adapterScoreBlockers = outputManifestComplete
    ? rawSolverBlockers.filter((blocker) => !isOfficialOutputExporterBlocker(adapter.id, blocker))
    : rawSolverBlockers;

  return {
    id: adapter.id,
    name: String(adapter.source.name ?? adapter.id),
    family: "external_adapter",
    liveUserContract: "required",
    productPathCompletion: {
      status: adapterProductPathStatus,
      scoreType: "product_path_completion",
      evidence: [
        `proofloop/benchmarks/${adapter.id}/adapter.json`,
        ...(livePassed ? ["docs/eval/bankertoolbench-live-room-proof.json"] : []),
        ...adapterLiveRoomProofEvidence,
        ...adapterProductProofEvidence,
        ...adapterBlockerEvidence,
      ],
      command: adapter.liveUserCommand,
      blockers: [
        ...validationErrors,
        ...implementationMissing.map((file) => `${adapter.id}: missing implementation file ${file}`),
        ...(adapterLiveRoomProof?.status === "failed" ? adapterLiveRoomProof.failedGates ?? [`${adapter.id}: external adapter live-room proof failed`] : []),
        ...(adapterProductProof?.status === "failed" ? adapterProductProof.failedGates ?? [`${adapter.id}: external adapter product proof failed`] : []),
        ...(adapterProductProofPassed && !adapterLiveRoomProof ? [`${adapter.id}: fresh live-room browser proof has not run`] : []),
      ],
    },
    officialSemanticScore: {
      status: btbOfficialProven || btbOfficial?.pass === true
        ? "proven"
        : isBtb
          ? "blocked"
          : blockerAnalysis?.status === "needs_scaffold_or_run" || blockerAnalysis?.status === "proxy_only"
            ? blockerAnalysis.status
            : "blocked",
      scoreType: "official_semantic_score",
      evidence: isBtb
        ? [
          "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json",
          "docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json",
          "docs/eval/bankertoolbench-official-contract.json",
        ]
        : [
          `proofloop/benchmarks/${adapter.id}/adapter.json`,
          ...adapterBlockerEvidence,
          ...adapterOfficialEvidence,
          ...officialOutputManifestEvidence(adapter.id, outputManifest),
          ...(blockerAnalysis ? [`.proofloop/lanes/${adapter.id}/blocker-analysis.json`] : []),
        ],
      command: adapter.verifierCommand,
      blockers: isBtb
        ? btbOfficialProven
          ? []
          : btbOfficial?.blockers ?? ["BankerToolBench official contract artifact is missing."]
        : adapterScoreBlockers,
      metrics: btbOfficialProven
        ? {
          expectedCount: btbFullSuite?.expectedCount ?? null,
          executedTaskCount: btbFullSuite?.executedTaskCount ?? null,
          cleanScoredTaskCount: btbFullSuite?.cleanScoredTaskCount ?? null,
          meanCleanReward: btbFullSuite?.meanCleanReward ?? null,
          passThreshold: btbFullSuite?.passThreshold ?? null,
          passCount: btbFullSuite?.passCount ?? null,
          passRate: btbFullSuite?.passRate ?? null,
          claim: btbFullSuite?.claim ?? "",
        }
        : !isBtb && adapterBlocker
          ? {
            missingImplementationFiles: adapterBlocker.missingImplementationFiles?.length ?? null,
            localAdapterTasks: adapterLiveRoomProof?.taskCount ?? adapterProductProof?.taskCount ?? null,
            liveRoomProductProof: adapterLiveRoomProofPassed,
            storyRouteProductProof: adapterProductProofPassed,
            liveRoomBaseUrl: adapterLiveRoomProof?.baseUrl ?? null,
            localAdapterOnly: adapterLiveRoomProof?.localAdapterOnly ?? adapterProductProof?.localAdapterOnly ?? null,
            officialScoreClaim: adapterLiveRoomProof?.officialScoreClaim ?? adapterProductProof?.officialScoreClaim ?? null,
            officialSourceUrls: adapterBlocker.officialSourceUrls?.length ?? null,
            resumeCommands: adapterBlocker.resumeCommands?.length ?? null,
            officialOutputManifestComplete: outputManifestComplete,
          }
          : undefined,
    },
    notes: isBtb
      ? btbOfficialProven
        ? ["BankerToolBench full-suite official scoring is imported: completion/scoring is proven separately from pass rate."]
        : ["BankerToolBench product-path proof can pass while Harbor/Gandalf official score import remains blocked."]
      : [
        adapterLiveRoomProofPassed
          ? "Fresh live-room Proof Loop adapter proof passed; official score is still blocked on upstream scorer import."
          : adapterProductProofPassed
            ? "Story-route adapter proof passed, but the stronger fresh live-room proxy proof has not passed yet."
            : "Adapter registration is useful backlog inventory until its local browser proof has run.",
      ],
  };
}

function missingImplementationFiles(adapter: ProofloopBenchmarkAdapter, root: string): string[] {
  const candidateFiles = [adapter.taskLoader, adapter.browserScenario];
  if (/\.tsx?$/.test(adapter.verifierCommand) && !adapter.verifierCommand.startsWith("npm ")) {
    candidateFiles.push(adapter.verifierCommand);
  }
  return candidateFiles.filter((file) => !existsSync(join(root, file)));
}

function readLaneAnalysis(root: string, suite: string): BlockerAnalysisReceipt | undefined {
  return readJson<BlockerAnalysisReceipt>(root, `.proofloop/lanes/${suite}/blocker-analysis.json`);
}

function solverAggregateStatus(receipts: Array<BlockerAnalysisReceipt | undefined>): ProofloopBenchmarkBoardStatus | undefined {
  const statuses = receipts.map((receipt) => receipt?.status).filter(Boolean);
  if (statuses.includes("needs_scaffold_or_run")) return "needs_scaffold_or_run";
  if (statuses.includes("proxy_only")) return "proxy_only";
  if (statuses.includes("blocked_external")) return "blocked";
  if (statuses.includes("ready")) return "ready_to_run";
  return undefined;
}

function solverBlockers(receipts: Array<BlockerAnalysisReceipt | undefined>, fallback: string[]): string[] {
  const blockers = receipts.flatMap((receipt) => {
    if (!receipt) return [];
    const local = receipt.remainingLocalClasses ?? [];
    const external = receipt.remainingExternalClasses ?? [];
    const original = receipt.blockers ?? [];
    const next = receipt.nextCommands?.[0];
    const parts = [
      ...local.map((item) => `${blockerClassLabel(item)} remains before external-blocked can be claimed`),
      ...external.map((item) => `${blockerClassLabel(item)} remains before official score can be claimed`),
      ...original,
      ...(next ? [`next: ${next}`] : []),
    ];
    return parts.length ? parts : [`solver status: ${receipt.status ?? "unknown"}`];
  });
  return blockers.length ? [...new Set(blockers)] : fallback;
}

function spreadsheetBenchCoverageBlockers(
  coverage: TaskCoverageReceipt | undefined,
  solverReceipts: Array<BlockerAnalysisReceipt | undefined>,
): string[] {
  const tracks = coverage?.tracks ?? [];
  if (tracks.length === 0) {
    return solverBlockers(solverReceipts, ["Full official SpreadsheetBench task coverage and scorer import are not ready."]);
  }

  const blockers = tracks
    .filter((track) => /^spreadsheetbench-/i.test(String(track.id ?? "")))
    .flatMap((track) => {
      const fullyStaged =
        typeof track.stagedTasks === "number" &&
        typeof track.officialExpectedTasks === "number" &&
        track.stagedTasks >= track.officialExpectedTasks;
      return (track.blockers ?? []).filter((blocker) => {
        const text = blocker.toLowerCase();
        const stagingOnly =
          /need staging|needs staging|need staging from|still need staging|download\/lock and stage|stage the full|bundle evidence is incomplete/.test(text);
        return !fullyStaged || !stagingOnly;
      });
    });

  if (blockers.length) return [...new Set(blockers)];
  return ["Full official SpreadsheetBench model outputs and scorer import are not ready."];
}

function blockerClassLabel(value: string): string {
  return value
    .replace(/^local_/, "")
    .replace(/^external_/, "")
    .replace(/_/g, " ");
}

function readJson<T>(root: string, relativePath: string): T | undefined {
  const path = join(root, relativePath);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(stripJsonBom(readFileSync(path, "utf-8"))) as T;
  } catch {
    return undefined;
  }
}

function stripJsonBom(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/^ï»¿/, "");
}

function normalizeEvidencePath(root: string, value: string): string {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedValue = value.replace(/\\/g, "/");
  return normalizedValue.startsWith(`${normalizedRoot}/`)
    ? normalizedValue.slice(normalizedRoot.length + 1)
    : normalizedValue;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "\\|");
}
