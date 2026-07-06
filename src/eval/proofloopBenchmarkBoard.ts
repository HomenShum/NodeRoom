import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listBenchmarkAdapters, validateBenchmarkAdapter, type ProofloopBenchmarkAdapter } from "./proofloopBenchmarkAdapters";

export type ProofloopBenchmarkBoardStatus =
  | "proven"
  | "ready_to_run"
  | "registered"
  | "partial"
  | "blocked"
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
  blockers?: string[];
  missingImplementationFiles?: string[];
  officialSourceUrls?: string[];
  resumeCommands?: string[];
};

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
      "Registered external adapters are backlog inventory until their live browser scenario and verifier implementation exist.",
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
    const blocker = [...product.blockers, ...official.blockers][0] ?? "none";
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
    "",
  );

  return `${lines.join("\n")}\n`;
}

function spreadsheetBenchEntry(root: string): ProofloopBenchmarkBoardEntry {
  const live = readJson<JsonObject>(root, "docs/eval/spreadsheetbench-live-room-proof.json");
  const taskCoverage = readJson<{ summary?: { strictFullCoverageReady?: boolean } }>(root, "docs/eval/official-benchmark-task-coverage.json");
  const livePassed = live?.passed === true;
  const officialReady = taskCoverage?.summary?.strictFullCoverageReady === true;

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
      status: officialReady ? "proven" : "blocked",
      scoreType: "official_semantic_score",
      evidence: ["docs/eval/official-benchmark-task-coverage.json", "docs/eval/official-benchmark-readiness.json"],
      command: "npm run benchmark:official:task-coverage",
      blockers: officialReady ? [] : ["Full official SpreadsheetBench task coverage and scorer import are not ready."],
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
  const livePassed = live?.passed === true;
  const readyToRun = validationErrors.length === 0 && implementationMissing.length === 0;
  const btbScoreImported = btbFullSuite?.flipEligible === true;
  const btbOfficialProven = btbScoreImported && btbOfficial?.pass === true;
  const adapterBlockerEvidence = !isBtb && adapterBlocker ? [`docs/eval/proofloop-adapter-blockers/${adapter.id}.json`] : [];
  const adapterOfficialBlockers = adapterBlocker?.blockers?.length
    ? adapterBlocker.blockers
    : ["Run npm run benchmark:proofloop:adapter-blockers to produce a typed external-adapter blocker receipt."];

  return {
    id: adapter.id,
    name: String(adapter.source.name ?? adapter.id),
    family: "external_adapter",
    liveUserContract: "required",
    productPathCompletion: {
      status: livePassed ? "proven" : readyToRun ? "ready_to_run" : "registered",
      scoreType: "product_path_completion",
      evidence: [
        `proofloop/benchmarks/${adapter.id}/adapter.json`,
        ...(livePassed ? ["docs/eval/bankertoolbench-live-room-proof.json"] : []),
        ...adapterBlockerEvidence,
      ],
      command: adapter.liveUserCommand,
      blockers: [
        ...validationErrors,
        ...implementationMissing.map((file) => `${adapter.id}: missing implementation file ${file}`),
      ],
    },
    officialSemanticScore: {
      status: btbOfficialProven || btbOfficial?.pass === true ? "proven" : isBtb ? "blocked" : "blocked",
      scoreType: "official_semantic_score",
      evidence: isBtb
        ? [
          "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json",
          "docs/eval/btb-clean-capability-full100-parallel-v3-gpt41mini.json",
          "docs/eval/bankertoolbench-official-contract.json",
        ]
        : [`proofloop/benchmarks/${adapter.id}/adapter.json`, ...adapterBlockerEvidence],
      command: adapter.verifierCommand,
      blockers: isBtb
        ? btbOfficialProven
          ? []
          : btbOfficial?.blockers ?? ["BankerToolBench official contract artifact is missing."]
        : adapterOfficialBlockers,
      metrics: btbScoreImported
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
            officialSourceUrls: adapterBlocker.officialSourceUrls?.length ?? null,
            resumeCommands: adapterBlocker.resumeCommands?.length ?? null,
          }
          : undefined,
    },
    notes: isBtb
      ? btbOfficialProven
        ? ["BankerToolBench full-suite official contract passed: completion/scoring is proven separately from pass rate."]
        : ["BankerToolBench full-suite score-import exists, but official promotion remains blocked until bundle provenance, Harbor/Docker, MCP tools, and Gandalf import pass."]
      : ["Adapter registration is useful backlog inventory; it is not a live proof claim."],
  };
}

function missingImplementationFiles(adapter: ProofloopBenchmarkAdapter, root: string): string[] {
  const candidateFiles = [adapter.taskLoader, adapter.browserScenario];
  if (/\.tsx?$/.test(adapter.verifierCommand) && !adapter.verifierCommand.startsWith("npm ")) {
    candidateFiles.push(adapter.verifierCommand);
  }
  return candidateFiles.filter((file) => !existsSync(join(root, file)));
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
