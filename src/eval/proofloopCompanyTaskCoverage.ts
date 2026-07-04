import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CompanyTaskCoverageStatus =
  | "prod_browser_proven"
  | "prod_runtime_proven"
  | "local_browser_proven"
  | "ready_for_prod_browser"
  | "partial"
  | "blocked_external";

export type ExternalTargetStatus =
  | "own_product"
  | "same_task_archetype"
  | "permission_required"
  | "closed_external";

export type CompanyTaskCoverageEntry = {
  id: string;
  externalReference: string;
  externalTargetStatus: ExternalTargetStatus;
  taskTypes: string[];
  nodeRoomCoverage: {
    status: CompanyTaskCoverageStatus;
    productSurface: string;
    command: string;
    evidence: string[];
    blockers: string[];
  };
  prodBrowserProof: {
    status: CompanyTaskCoverageStatus;
    command: string;
    evidence: string[];
    blockers: string[];
  };
  officialOrExternalClaim: {
    status: "not_applicable" | "blocked_external";
    blockers: string[];
  };
  sourceUrls: string[];
  notes: string[];
};

export type ProofloopCompanyTaskCoverageReport = {
  schema: "proofloop-company-task-coverage-v1";
  generatedAt?: string;
  policy: string[];
  summary: {
    entries: number;
    ownProductOrSameArchetype: number;
    prodBrowserProven: number;
    prodRuntimeProven: number;
    readyForProdBrowser: number;
    partial: number;
    externalPermissionOrClosed: number;
    taskTypesTracked: number;
  };
  entries: CompanyTaskCoverageEntry[];
};

type RunResult = {
  suite?: string;
  passed?: boolean;
  score?: number;
  outputDir?: string;
  baseUrl?: string;
  taskResults?: Array<{ status?: string; taskId?: string; taskName?: string }>;
};

type LiveUserContract = {
  suite?: string;
  valid?: boolean;
  baseUrl?: string;
  productPathCompletion?: boolean;
};

type ProfessionalProofLedger = {
  summary?: {
    liveProvider?: number;
    partialLiveProvider?: number;
    allLiveRuntimeExecuted?: boolean;
    allLiveProven?: boolean;
  };
  rows?: Array<{
    caseId?: string;
    category?: string;
    proofLevel?: string;
    blockers?: string[];
    evidence?: string[];
  }>;
};

type ExternalAdapterProof = {
  status?: "passed" | "failed";
  baseUrl?: string;
  browserProof?: {
    url?: string;
    roomUrl?: string;
    problemCounts?: Record<string, number>;
  };
  evidence?: string[];
};

type LiveBrowserProofReceipt = {
  passed?: boolean;
  baseUrl?: string;
  scorer?: {
    details?: {
      taskProofs?: Array<{ taskId?: string; passed?: boolean; error?: string }>;
    };
  };
};

export function buildProofloopCompanyTaskCoverageReport(args: {
  root?: string;
  generatedAt?: string;
} = {}): ProofloopCompanyTaskCoverageReport {
  const root = args.root ?? process.cwd();
  const entries = [
    proximittyEntry(root),
    genericUnderwritingEntry(root),
    liveFlowAccountingEntry(root),
    rogoFinanceResearchEntry(root),
    jpmAskDavidEntry(root),
    notionSdrBdrEntry(root),
    externalFinanceBenchmarkEntry(root),
  ];
  const taskTypes = new Set(entries.flatMap((entry) => entry.taskTypes));

  return {
    schema: "proofloop-company-task-coverage-v1",
    generatedAt: args.generatedAt,
    policy: [
      "Track company-named requests as task archetypes unless the third-party app is explicitly consented and reachable.",
      "Prod browser proof is a separate gate from local browser proof and production API/runtime proof.",
      "A same-task-archetype proof can show NodeRoom can do the work; it must not claim the third-party product was tested.",
      "Closed or permission-gated external apps are external target blockers, not NodeRoom capability blockers.",
      "Every covered archetype should name the command that reruns its prod UI live-browser proof.",
    ],
    summary: {
      entries: entries.length,
      ownProductOrSameArchetype: entries.filter((entry) =>
        entry.externalTargetStatus === "own_product" || entry.externalTargetStatus === "same_task_archetype"
      ).length,
      prodBrowserProven: entries.filter((entry) => entry.prodBrowserProof.status === "prod_browser_proven").length,
      prodRuntimeProven: entries.filter((entry) => entry.nodeRoomCoverage.status === "prod_runtime_proven").length,
      readyForProdBrowser: entries.filter((entry) => entry.prodBrowserProof.status === "ready_for_prod_browser").length,
      partial: entries.filter((entry) =>
        entry.prodBrowserProof.status === "partial" || entry.nodeRoomCoverage.status === "partial"
      ).length,
      externalPermissionOrClosed: entries.filter((entry) =>
        entry.externalTargetStatus === "permission_required" || entry.externalTargetStatus === "closed_external"
      ).length,
      taskTypesTracked: taskTypes.size,
    },
    entries,
  };
}

export function renderProofloopCompanyTaskCoverageMarkdown(report: ProofloopCompanyTaskCoverageReport): string {
  const lines = [
    "# Proof Loop Company Task Coverage",
    "",
    `Generated: ${report.generatedAt ?? "unknown"}`,
    "",
    "This ledger answers whether NodeRoom covers the task types named in company comparisons, without pretending we tested closed third-party apps.",
    "",
    "## Summary",
    "",
    `- Company/task entries tracked: ${report.summary.entries}`,
    `- Own product or same-archetype entries: ${report.summary.ownProductOrSameArchetype}`,
    `- Prod browser proven entries: ${report.summary.prodBrowserProven}`,
    `- Prod runtime proven entries: ${report.summary.prodRuntimeProven}`,
    `- Ready for prod browser proof: ${report.summary.readyForProdBrowser}`,
    `- Partial entries: ${report.summary.partial}`,
    `- Permission/closed external targets: ${report.summary.externalPermissionOrClosed}`,
    `- Distinct task types tracked: ${report.summary.taskTypesTracked}`,
    "",
    "## Policy",
    "",
    ...report.policy.map((item) => `- ${item}`),
    "",
    "## Coverage",
    "",
    "| Entry | Target | NodeRoom coverage | Prod browser | External claim | Next blocker |",
    "|---|---|---:|---:|---:|---|",
  ];

  for (const entry of report.entries) {
    const blocker = entry.prodBrowserProof.blockers[0]
      ?? entry.nodeRoomCoverage.blockers[0]
      ?? entry.officialOrExternalClaim.blockers[0]
      ?? "none";
    lines.push(
      `| \`${entry.id}\` | ${entry.externalTargetStatus} | ${entry.nodeRoomCoverage.status} | ` +
      `${entry.prodBrowserProof.status} | ${entry.officialOrExternalClaim.status} | ${escapePipes(blocker)} |`,
    );
  }

  lines.push("", "## Task Detail", "");
  for (const entry of report.entries) {
    lines.push(`### ${entry.externalReference}`);
    lines.push("");
    lines.push(`- Entry id: \`${entry.id}\``);
    lines.push(`- Product surface: ${entry.nodeRoomCoverage.productSurface}`);
    lines.push(`- Task types: ${entry.taskTypes.join("; ")}`);
    lines.push(`- NodeRoom command: \`${entry.nodeRoomCoverage.command}\``);
    lines.push(`- Prod browser command: \`${entry.prodBrowserProof.command}\``);
    if (entry.nodeRoomCoverage.evidence.length) {
      lines.push(`- Evidence: ${entry.nodeRoomCoverage.evidence.map((item) => `\`${item}\``).join(", ")}`);
    }
    if (entry.prodBrowserProof.evidence.length) {
      lines.push(`- Browser evidence: ${entry.prodBrowserProof.evidence.map((item) => `\`${item}\``).join(", ")}`);
    }
    if (entry.nodeRoomCoverage.blockers.length || entry.prodBrowserProof.blockers.length || entry.officialOrExternalClaim.blockers.length) {
      lines.push(`- Blockers: ${[
        ...entry.nodeRoomCoverage.blockers,
        ...entry.prodBrowserProof.blockers,
        ...entry.officialOrExternalClaim.blockers,
      ].join("; ")}`);
    }
    lines.push(`- Sources: ${entry.sourceUrls.join(", ")}`);
    if (entry.notes.length) lines.push(`- Notes: ${entry.notes.join(" ")}`);
    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function proximittyEntry(root: string): CompanyTaskCoverageEntry {
  const localRun = readJson<RunResult>(root, ".proofloop/runs/latest/run-result.json");
  const liveContract = readJson<LiveUserContract>(root, ".proofloop/runs/latest/live-user-contract.json");
  const localPassed = localRun?.suite === "proximitty-underwriting-pr0" && localRun.passed === true;
  const prodBrowser = localPassed && liveContract?.baseUrl === "https://noderoom.live" && liveContract.valid === true;

  return {
    id: "proximitty-commercial-lending",
    externalReference: "Proximitty / commercial lending AI",
    externalTargetStatus: "own_product",
    taskTypes: [
      "document ingestion",
      "financial spreading",
      "credit analysis",
      "covenant and risk monitoring",
      "underwriting packet generation",
      "borrower servicing workplan",
    ],
    nodeRoomCoverage: {
      status: localPassed ? "local_browser_proven" : "ready_for_prod_browser",
      productSurface: "Proximitty synthetic underwriting Proof Loop suite",
      command: "npm run proofloop:proximitty",
      evidence: localPassed
        ? [".proofloop/runs/latest/run-result.json", ".proofloop/runs/latest/live-user-contract.json"]
        : ["proofloop/suites/proximitty-underwriting-pr0.json"],
      blockers: localPassed ? [] : ["Run the Proximitty proof suite before claiming product coverage."],
    },
    prodBrowserProof: {
      status: prodBrowser ? "prod_browser_proven" : "ready_for_prod_browser",
      command: "PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 npm run proofloop:proximitty",
      evidence: prodBrowser ? [".proofloop/runs/latest/live-user-contract.json"] : [],
      blockers: prodBrowser ? [] : ["Latest Proximitty live-user contract is not a noderoom.live prod-browser run."],
    },
    officialOrExternalClaim: {
      status: "not_applicable",
      blockers: ["Synthetic evaluation-only underwriting suite; do not claim a real lending, insurance, legal, or credit decision."],
    },
    sourceUrls: [
      "https://www.proximitty.ai/",
      "https://www.ycombinator.com/companies/proximitty",
    ],
    notes: ["This is our controlled product archetype for commercial-lending AI workflows."],
  };
}

function genericUnderwritingEntry(root: string): CompanyTaskCoverageEntry {
  const proximitty = proximittyEntry(root);
  return {
    id: "generic-ai-underwriting",
    externalReference: "Generic AI underwriting platform",
    externalTargetStatus: "same_task_archetype",
    taskTypes: [
      "submission intake",
      "risk attribute extraction",
      "guideline comparison",
      "third-party summary",
      "terms or memo drafting",
      "human underwriter review packet",
    ],
    nodeRoomCoverage: {
      ...proximitty.nodeRoomCoverage,
      productSurface: "NodeRoom underwriting task archetype via Proximitty suite",
    },
    prodBrowserProof: proximitty.prodBrowserProof,
    officialOrExternalClaim: {
      status: "not_applicable",
      blockers: ["A named third-party underwriting app requires permission/API/browser access before Proof Loop can test that app itself."],
    },
    sourceUrls: [
      "https://www.intellectai.com/the-rise-of-ai-expert-agents-revolutionizing-insurance-underwriting/",
      "https://www.automationanywhere.com/solutions/agentic-solutions/loan-underwriting",
    ],
    notes: ["The capability is covered as an archetype; specific vendor-app testing is permission-gated."],
  };
}

function liveFlowAccountingEntry(root: string): CompanyTaskCoverageEntry {
  const liveAccounting = readJson<RunResult>(root, ".proofloop/live/latest/run-result.json");
  const livePassed = liveAccounting?.suite === "live-accounting" && liveAccounting.passed === true;
  const browserReceipt = readJson<LiveBrowserProofReceipt>(root, "docs/eval/proofloop-live-room-proof.json");
  const prodBrowser = browserReceipt?.passed === true && browserReceipt.baseUrl === "https://noderoom.live";
  const individualReceiptPaths = [
    "docs/eval/proofloop-live-room-smoke-proof.json",
    "docs/eval/proofloop-live-room-runway-proof.json",
    "docs/eval/proofloop-live-room-memo-proof.json",
    "docs/eval/proofloop-live-room-research-proof.json",
  ];
  const individualReceipts = individualReceiptPaths
    .map((path) => ({ path, receipt: readJson<LiveBrowserProofReceipt>(root, path) }))
    .filter((entry): entry is { path: string; receipt: LiveBrowserProofReceipt } => !!entry.receipt);
  const prodIndividualReceipts = individualReceipts.filter((entry) => entry.receipt.baseUrl === "https://noderoom.live");
  const passedIndividualTaskIds = prodIndividualReceipts.flatMap((entry) =>
    entry.receipt.passed === true
      ? (entry.receipt.scorer?.details?.taskProofs ?? []).filter((task) => task.passed === true).map((task) => task.taskId ?? entry.path)
      : []
  );
  const failedIndividualTasks = prodIndividualReceipts.flatMap((entry) =>
    (entry.receipt.scorer?.details?.taskProofs ?? [])
      .filter((task) => task.passed === false)
      .map((task) => `${task.taskId ?? entry.path}: ${task.error ?? "failed"}`)
  );
  const prodBrowserStatus: CompanyTaskCoverageStatus = prodBrowser
    ? "prod_browser_proven"
    : passedIndividualTaskIds.length > 0
      ? "partial"
      : "ready_for_prod_browser";
  const browserEvidence = prodBrowser
    ? ["docs/eval/proofloop-live-room-proof.json"]
    : prodIndividualReceipts.map((entry) => entry.path);
  const browserBlockers = prodBrowser
    ? []
    : failedIndividualTasks.length > 0
      ? [`Individual prod UI receipts are ${passedIndividualTaskIds.length}/4 passed; failing tasks: ${failedIndividualTasks.join("; ")}`]
      : ["No passing prod UI live-browser receipt is checked in for the accounting task set."];

  return {
    id: "liveflow-accounting-fpa",
    externalReference: "LiveFlow-style accounting and FP&A automation",
    externalTargetStatus: "same_task_archetype",
    taskTypes: [
      "book close support",
      "account reconciliation",
      "AR follow-up",
      "journal entry drafting",
      "spreadsheet FP&A reporting",
      "consolidation and budget updates",
    ],
    nodeRoomCoverage: {
      status: livePassed ? "prod_runtime_proven" : "ready_for_prod_browser",
      productSurface: "NodeRoom accounting and live-accounting Proof Loop suites",
      command: "npm run proofloop:live:accounting",
      evidence: livePassed
        ? [".proofloop/live/latest/run-result.json", "proofloop/accounting/live.accounting.config.json"]
        : ["proofloop/accounting/proofloop.accounting.config.json", "proofloop/accounting/live.accounting.config.json"],
      blockers: livePassed ? [] : ["Run the production live accounting Proof Loop."],
    },
    prodBrowserProof: {
      status: prodBrowserStatus,
      command:
        "PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/accounting/live.accounting.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts",
      evidence: browserEvidence,
      blockers: browserBlockers,
    },
    officialOrExternalClaim: {
      status: "not_applicable",
      blockers: ["Proof Loop covers the same task type; it does not test LiveFlow's production app without permission."],
    },
    sourceUrls: [
      "https://liveflow.com/",
      "https://liveflow.com/blog/modern-financial-planning-tools-streamlining-your-finance-workflow",
    ],
    notes: [
      "The production runtime proof records real Convex jobs, resolved models, durations, and pass patterns.",
      prodBrowser
        ? "The full serial prod UI suite has a passing receipt."
        : `Individual prod UI task receipts currently pass: ${passedIndividualTaskIds.join(", ") || "none"}.`,
    ],
  };
}

function rogoFinanceResearchEntry(root: string): CompanyTaskCoverageEntry {
  const ledger = readJson<ProfessionalProofLedger>(root, "docs/eval/professional-proof-ledger.json");
  const gtmRows = ledger?.rows?.filter((row) => row.category === "gtm_company_research") ?? [];
  const liveRows = gtmRows.filter((row) => row.proofLevel === "live_provider");
  const hasRuntimeProof = (ledger?.summary?.liveProvider ?? 0) > 0 || liveRows.length > 0;

  return {
    id: "rogo-finance-research-copilot",
    externalReference: "Rogo-style finance research copilot",
    externalTargetStatus: "same_task_archetype",
    taskTypes: [
      "company research",
      "market map enrichment",
      "financial data synthesis",
      "investment memo drafting",
      "workflow orchestration over finance data sources",
    ],
    nodeRoomCoverage: {
      status: hasRuntimeProof ? "prod_runtime_proven" : "partial",
      productSurface: "NodeRoom professional GTM/company-research evals plus BankerToolBench finance tasks",
      command: "npm run eval:professional:proofs",
      evidence: [
        "docs/eval/professional-proof-ledger.json",
        "docs/eval/professional-live-runtime.json",
        "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json",
      ].filter((path) => existsSync(join(root, path))),
      blockers: hasRuntimeProof ? [] : ["Run the professional proof ledger and live runtime proof."],
    },
    prodBrowserProof: {
      status: "ready_for_prod_browser",
      command:
        "PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts",
      evidence: [],
      blockers: ["Rogo-style company research has production runtime proof, but no checked-in prod UI live-browser receipt for this exact task archetype."],
    },
    officialOrExternalClaim: {
      status: "not_applicable",
      blockers: ["Testing Rogo's actual app requires Rogo-controlled access or explicit consent."],
    },
    sourceUrls: [
      "https://rogo.ai/",
      "https://rogo.ai/product",
      "https://openai.com/index/rogo/",
    ],
    notes: ["This row is a task-type claim about NodeRoom, not a third-party app test claim."],
  };
}

function jpmAskDavidEntry(root: string): CompanyTaskCoverageEntry {
  const rogo = rogoFinanceResearchEntry(root);
  return {
    id: "jpm-ask-david-research-agent",
    externalReference: "JPM Ask David-style investment research agent",
    externalTargetStatus: "closed_external",
    taskTypes: [
      "multi-agent investment research",
      "structured data query",
      "document retrieval and synthesis",
      "portfolio or market insight generation",
      "human-in-the-loop review",
    ],
    nodeRoomCoverage: {
      ...rogo.nodeRoomCoverage,
      productSurface: "NodeRoom finance research and multi-agent task archetypes",
    },
    prodBrowserProof: rogo.prodBrowserProof,
    officialOrExternalClaim: {
      status: "blocked_external",
      blockers: ["Ask David is an internal/closed JPM system; Proof Loop cannot test that app without JPM-provided access and authorization."],
    },
    sourceUrls: [
      "https://www.jpmorganchase.com/about/technology/research/ai",
      "https://www.youtube.com/watch?v=yMalr0jiOAc",
    ],
    notes: ["NodeRoom can cover the research-agent task type; it cannot claim JPM internal app testing."],
  };
}

function notionSdrBdrEntry(root: string): CompanyTaskCoverageEntry {
  const hasConfig = existsSync(join(root, "proofloop/notion/proofloop.notion.config.json"));
  const liveConfig = existsSync(join(root, "proofloop/notion/live.notion.config.json"));
  return {
    id: "notion-sdr-bdr-workflow",
    externalReference: "Notion-style SDR/BDR workflow automation",
    externalTargetStatus: "own_product",
    taskTypes: [
      "warm intro drafting",
      "follow-up generation",
      "pipeline automation",
      "meeting prep",
      "account workplan update",
    ],
    nodeRoomCoverage: {
      status: hasConfig ? "ready_for_prod_browser" : "partial",
      productSurface: "NodeRoom Notion SDR/BDR Proof Loop suite",
      command: "npm run proofloop:notion",
      evidence: ["proofloop/notion/proofloop.notion.config.json", "proofloop/notion/live.notion.config.json"].filter((path) =>
        existsSync(join(root, path))
      ),
      blockers: hasConfig && liveConfig ? [] : ["Notion local or live Proof Loop config is missing."],
    },
    prodBrowserProof: {
      status: "ready_for_prod_browser",
      command:
        "PROOFLOOP_LIVE_BROWSER=1 PROOFLOOP_TASKS_JSON=proofloop/notion/live.notion.config.json BENCH_BASE_URL=https://noderoom.live BENCH_AGENT_MODEL_MODE=specific BENCH_AGENT_MODEL_POLICY=z-ai/glm-5.2 npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts",
      evidence: [],
      blockers: ["No checked-in prod UI live-browser receipt is dedicated to the Notion SDR/BDR task set."],
    },
    officialOrExternalClaim: {
      status: "not_applicable",
      blockers: ["Product workflow suite, not a public official benchmark score."],
    },
    sourceUrls: ["proofloop/notion/proofloop.notion.config.json"],
    notes: ["Included because prior company-task discussion covered SDR/BDR automation as a Proof Loop lane."],
  };
}

function externalFinanceBenchmarkEntry(root: string): CompanyTaskCoverageEntry {
  const adapterIds = ["finch", "finauditing", "workstreambench"] as const;
  const liveReceiptPaths = adapterIds.map((id) => `docs/eval/proofloop-external-adapter-live-room-runs/${id}.json`);
  const storyReceiptPaths = adapterIds.map((id) => `docs/eval/proofloop-external-adapter-runs/${id}.json`);
  const receipts = adapterIds.map((id) =>
    readJson<ExternalAdapterProof>(root, `docs/eval/proofloop-external-adapter-live-room-runs/${id}.json`)
  );
  const prodPassed = receipts.every((receipt) => receipt?.status === "passed" && receipt.baseUrl === "https://noderoom.live");
  const problemFree = receipts.every((receipt) =>
    Object.values(receipt?.browserProof?.problemCounts ?? {}).every((count) => count === 0)
  );
  const evidencePaths = [...liveReceiptPaths, ...storyReceiptPaths].filter((path) => existsSync(join(root, path)));

  return {
    id: "external-finance-benchmark-adapters",
    externalReference: "Finch, FinAuditing, and WorkstreamBench task archetypes",
    externalTargetStatus: "same_task_archetype",
    taskTypes: [
      "financial workflow execution",
      "financial audit prediction",
      "spreadsheet workstream representation",
      "official-output artifact export",
      "proxy judge or official scorer handoff",
    ],
    nodeRoomCoverage: {
      status: prodPassed && problemFree ? "prod_browser_proven" : "ready_for_prod_browser",
      productSurface: "NodeRoom external finance benchmark adapters",
      command: "npm run benchmark:proofloop:external-adapter-live-room -- --prod --user-emulation strict",
      evidence: evidencePaths,
      blockers: prodPassed && problemFree ? [] : ["Run external adapter fresh-room product proofs against noderoom.live."],
    },
    prodBrowserProof: {
      status: prodPassed && problemFree ? "prod_browser_proven" : "ready_for_prod_browser",
      command: "npm run benchmark:proofloop:external-adapter-live-room -- --prod --user-emulation strict",
      evidence: evidencePaths,
      blockers: prodPassed && problemFree ? [] : ["External adapter fresh-room product proof must pass against noderoom.live with zero browser problem counts."],
    },
    officialOrExternalClaim: {
      status: "blocked_external",
      blockers: [
        "Official score receipts still need official-output artifacts and/or upstream scorer material; proxy judges can be used for Proof Loop product gates but not official leaderboard claims.",
      ],
    },
    sourceUrls: [
      "proofloop/benchmarks/finch/adapter.json",
      "proofloop/benchmarks/finauditing/adapter.json",
      "proofloop/benchmarks/workstreambench/adapter.json",
    ],
    notes: ["This row is where cheaper proxy judges can keep product Proof Loop moving while official scorer imports remain separate."],
  };
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
