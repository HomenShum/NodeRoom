import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  externalBenchmarkLocalTaskIds,
  loadExternalBenchmarkLocalTasks,
  type ExternalBenchmarkAdapterId,
} from "../../proofloop/benchmarks/common/local-tasks";

export type FullProxyBenchmarkStatus =
  | "prod_live_browser_verified"
  | "local_live_browser_verified"
  | "official_scored_not_prod_browser"
  | "staged_not_prod_browser_run"
  | "ready_to_run"
  | "blocked";

export type FullProxyBenchmarkFamily = {
  id: string;
  title: string;
  family: "official_public" | "official_subset" | "product_suite" | "external_adapter" | "internal";
  taskTargetCount: number;
  taskTargetMeaning: string;
  countedInUniqueProxyTargetTotal: boolean;
  stagedTaskCount: number;
  deterministicRunTaskCount: number;
  modelRunCaseCount: number;
  modelRunAttemptCount: number;
  prodLiveBrowserVerifiedTaskCount: number;
  localLiveBrowserVerifiedTaskCount: number;
  officialScoredTaskCount: number;
  status: FullProxyBenchmarkStatus;
  evidence: string[];
  runnableCommands: string[];
  blockers: string[];
};

export type FullProxyModelRecommendation = {
  status: "current_prod_proxy_winner" | "insufficient_full_task_evidence";
  modelId: string | null;
  basis: string;
  fullyPassingModels: Array<{
    modelId: string;
    passed: number;
    total: number;
    estimatedCostUsdAtOpenRouterList: number | null;
    measuredCostUsd: number | null;
    avgDurationMs: number | null;
  }>;
};

export type FullProxyBenchmarkSweep = {
  schema: "proofloop-full-proxy-benchmark-sweep-v1";
  generatedAt?: string;
  baseUrl: string;
  policy: string[];
  summary: {
    families: number;
    uniqueProxyTaskTargets: number;
    ledgerDeclaredTaskTargets: number;
    stagedTaskTargets: number;
    prodLiveBrowserVerifiedTaskTargets: number;
    localLiveBrowserVerifiedTaskTargets: number;
    officialScoredTaskTargets: number;
    fullProdLiveBrowserCoverageReady: boolean;
  };
  modelRecommendation: FullProxyModelRecommendation;
  families: FullProxyBenchmarkFamily[];
};

type OfficialCoverageReport = {
  summary?: {
    totalOfficialExpectedTasks?: number;
    totalStagedTasks?: number;
  };
  tracks?: Array<{
    id?: string;
    title?: string;
    officialExpectedTasks?: number;
    stagedTasks?: number;
    deterministicRunTasks?: number;
    modelRunCases?: number;
    modelRunAttempts?: number;
    passRate?: number | null;
    status?: string;
    evidence?: string[];
    blockers?: string[];
  }>;
};

type ProxyModelSweep = {
  baseUrl?: string;
  realUserMode?: boolean;
  rows?: Array<{
    modelId?: string;
    adapterId?: ExternalBenchmarkAdapterId;
    status?: "passed" | "failed";
    roomUrl?: string;
  }>;
  summary?: {
    byModel?: Array<{
      modelId?: string;
      passed?: number;
      total?: number;
      estimatedCostUsdAtOpenRouterList?: number | null;
      measuredCostUsd?: number | null;
      avgDurationMs?: number | null;
    }>;
  };
};

type LiveRoomProof = {
  passed?: boolean;
  memoryMode?: boolean;
  baseUrl?: string;
};

type BtbFullSuiteReceipt = {
  expectedCount?: number;
  executedTaskCount?: number;
  cleanScoredTaskCount?: number;
  flipEligible?: boolean;
};

type LiveConfig = {
  tasks?: Array<{ id?: string }>;
};

type ProximittyRunResult = {
  suite?: string;
  passed?: boolean;
  steps?: Array<{ name?: string; status?: string }>;
  model?: { id?: string };
};

export function buildProofloopFullProxyBenchmarkSweep(args: {
  root?: string;
  generatedAt?: string;
  baseUrl?: string;
} = {}): FullProxyBenchmarkSweep {
  const root = args.root ?? process.cwd();
  const baseUrl = args.baseUrl ?? "https://noderoom.live";
  const official = readJson<OfficialCoverageReport>(root, "docs/eval/official-benchmark-task-coverage.json");
  const proxySweep = readJson<ProxyModelSweep>(root, "docs/eval/proofloop-proxy-model-sweep.json");
  const families = [
    spreadsheetFamily(root, official, "spreadsheetbench-v1-full-912", "SpreadsheetBench V1 full 912", true),
    spreadsheetFamily(root, official, "spreadsheetbench-v1-verified-400", "SpreadsheetBench Verified 400 subset", false),
    spreadsheetFamily(root, official, "spreadsheetbench-v2-full-321", "SpreadsheetBench V2 full 321", true),
    bankerToolBenchFamily(root, official),
    accountingFamily(root),
    notionFamily(root),
    proximittyFamily(root),
    ...externalAdapterFamilies(proxySweep),
    nodeRoomInternalFamily(official),
  ];
  const uniqueFamilies = families.filter((family) => family.countedInUniqueProxyTargetTotal);
  const prodLiveBrowserVerifiedTaskTargets = sum(uniqueFamilies, "prodLiveBrowserVerifiedTaskCount");
  const uniqueProxyTaskTargets = sum(uniqueFamilies, "taskTargetCount");

  return {
    schema: "proofloop-full-proxy-benchmark-sweep-v1",
    generatedAt: args.generatedAt,
    baseUrl,
    policy: [
      "Prod live-browser coverage requires a fresh room on noderoom.live, no memory mode, public @nodeagent invocation, visible progress, trace evidence, and task-specific verifier/scorer handoff.",
      "Local live-browser receipts prove product mechanics but do not satisfy the prod-live requirement.",
      "Staged official bundles and deterministic scorers do not count as model runs through the prod UI.",
      "SpreadsheetBench V1 Verified 400 is tracked but not counted in the unique total because it overlaps the full V1 912-task bundle.",
      "The current model winner can only be selected from the prod live-browser proxy tasks already run; a full all-task winner needs every family run through the same matrix.",
    ],
    summary: {
      families: families.length,
      uniqueProxyTaskTargets,
      ledgerDeclaredTaskTargets: official?.summary?.totalOfficialExpectedTasks ?? uniqueProxyTaskTargets,
      stagedTaskTargets: sum(uniqueFamilies, "stagedTaskCount"),
      prodLiveBrowserVerifiedTaskTargets,
      localLiveBrowserVerifiedTaskTargets: sum(uniqueFamilies, "localLiveBrowserVerifiedTaskCount"),
      officialScoredTaskTargets: sum(uniqueFamilies, "officialScoredTaskCount"),
      fullProdLiveBrowserCoverageReady: prodLiveBrowserVerifiedTaskTargets >= uniqueProxyTaskTargets,
    },
    modelRecommendation: modelRecommendation(proxySweep),
    families,
  };
}

export function renderProofloopFullProxyBenchmarkSweepMarkdown(report: FullProxyBenchmarkSweep): string {
  const lines = [
    "# ProofLoop Full Proxy Benchmark Sweep",
    "",
    `Generated: ${report.generatedAt ?? "unknown"}`,
    `Base URL required for prod proof: ${report.baseUrl}`,
    "",
    "This report is the no-shortcut ledger for adapting every tracked benchmark family to the live browser UI. It does not convert staged/offline evidence into prod live-browser proof.",
    "",
    "## Summary",
    "",
    `- Families tracked: ${report.summary.families}`,
    `- Unique proxy task targets: ${report.summary.uniqueProxyTaskTargets}`,
    `- Official coverage ledger declared targets, including overlapping subsets/internal tracks: ${report.summary.ledgerDeclaredTaskTargets}`,
    `- Staged task targets: ${report.summary.stagedTaskTargets}`,
    `- Prod live-browser verified task targets: ${report.summary.prodLiveBrowserVerifiedTaskTargets}`,
    `- Local live-browser verified task targets: ${report.summary.localLiveBrowserVerifiedTaskTargets}`,
    `- Official scored task targets: ${report.summary.officialScoredTaskTargets}`,
    `- Full prod live-browser coverage ready: ${report.summary.fullProdLiveBrowserCoverageReady ? "yes" : "no"}`,
    "",
    "## Model Recommendation",
    "",
    `- Status: ${report.modelRecommendation.status}`,
    `- Current model: ${report.modelRecommendation.modelId ?? "none"}`,
    `- Basis: ${report.modelRecommendation.basis}`,
    "",
    "| Model | Passes | Est. OpenRouter list cost | UI measured cost | Avg duration |",
    "|---|---:|---:|---:|---:|",
    ...report.modelRecommendation.fullyPassingModels.map((model) =>
      `| \`${model.modelId}\` | ${model.passed}/${model.total} | ${money(model.estimatedCostUsdAtOpenRouterList)} | ${money(model.measuredCostUsd)} | ${model.avgDurationMs == null ? "n/a" : `${Math.round(model.avgDurationMs / 1000)}s`} |`,
    ),
    "",
    "## Families",
    "",
    "| Family | Status | Targets | Staged | Prod browser | Local browser | Model cases | Official scored | Next blocker |",
    "|---|---|---:|---:|---:|---:|---:|---:|---|",
    ...report.families.map((family) =>
      [
        `\`${family.id}\``,
        family.status,
        family.countedInUniqueProxyTargetTotal ? String(family.taskTargetCount) : `${family.taskTargetCount} overlap`,
        family.stagedTaskCount,
        family.prodLiveBrowserVerifiedTaskCount,
        family.localLiveBrowserVerifiedTaskCount,
        `${family.modelRunCaseCount}/${family.modelRunAttemptCount}`,
        family.officialScoredTaskCount,
        escapePipes(family.blockers[0] ?? "none"),
      ].join(" | "),
    ).map((row) => `| ${row} |`),
    "",
    "## Detail",
    "",
  ];

  for (const family of report.families) {
    lines.push(`### ${family.title}`);
    lines.push("");
    lines.push(`- Status: ${family.status}`);
    lines.push(`- Task target: ${family.taskTargetCount} (${family.taskTargetMeaning})`);
    lines.push(`- Counted in unique total: ${family.countedInUniqueProxyTargetTotal ? "yes" : "no"}`);
    lines.push(`- Evidence: ${family.evidence.map((item) => `\`${item}\``).join(", ") || "none"}`);
    lines.push(`- Commands: ${family.runnableCommands.map((item) => `\`${item}\``).join(", ") || "none"}`);
    lines.push(`- Blockers: ${family.blockers.join("; ") || "none"}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

export function renderProofloopFullProxyBenchmarkSweepHtml(report: FullProxyBenchmarkSweep): string {
  const rows = report.families.map((family) => {
    const pct = family.taskTargetCount > 0
      ? Math.min(100, Math.round((family.prodLiveBrowserVerifiedTaskCount / family.taskTargetCount) * 100))
      : 0;
    return `<tr><td><code>${escapeHtml(family.id)}</code></td><td>${escapeHtml(family.status)}</td><td>${family.taskTargetCount}${family.countedInUniqueProxyTargetTotal ? "" : " overlap"}</td><td>${family.prodLiveBrowserVerifiedTaskCount}</td><td><div class="bar"><span style="width:${Math.max(2, pct)}%"></span></div></td><td>${escapeHtml(family.blockers[0] ?? "none")}</td></tr>`;
  }).join("\n");
  const models = report.modelRecommendation.fullyPassingModels.map((model) =>
    `<tr><td><code>${escapeHtml(model.modelId)}</code></td><td>${model.passed}/${model.total}</td><td>${money(model.estimatedCostUsdAtOpenRouterList)}</td><td>${money(model.measuredCostUsd)}</td></tr>`,
  ).join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>ProofLoop Full Proxy Benchmark Sweep</title>
<style>
body { font-family: Inter, system-ui, sans-serif; margin: 32px; color: #17201a; }
table { border-collapse: collapse; width: 100%; margin: 18px 0 28px; }
th, td { border-bottom: 1px solid #dde5dd; padding: 8px 10px; text-align: left; vertical-align: top; }
th { color: #526154; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.meta { color: #526154; }
.callout { border: 1px solid #dde5dd; background: #f8fbf8; border-radius: 6px; padding: 14px 16px; margin: 18px 0; }
.bar { width: 100%; min-width: 160px; height: 12px; border-radius: 3px; background: #eef3ef; overflow: hidden; }
.bar span { display: block; height: 100%; background: #2e9e6b; }
</style>
<h1>ProofLoop Full Proxy Benchmark Sweep</h1>
<p class="meta">Generated ${escapeHtml(report.generatedAt ?? "unknown")} for prod base ${escapeHtml(report.baseUrl)}.</p>
<div class="callout">
  <strong>${report.summary.prodLiveBrowserVerifiedTaskTargets}/${report.summary.uniqueProxyTaskTargets} unique task targets have prod live-browser proof.</strong>
  <p>Current model pick: <code>${escapeHtml(report.modelRecommendation.modelId ?? "none")}</code>. ${escapeHtml(report.modelRecommendation.basis)}</p>
</div>
<h2>Model candidates with full prod adapter-smoke passes</h2>
<table><thead><tr><th>Model</th><th>Passes</th><th>Est. list cost</th><th>UI measured cost</th></tr></thead><tbody>${models}</tbody></table>
<h2>Families</h2>
<table><thead><tr><th>Family</th><th>Status</th><th>Targets</th><th>Prod browser</th><th>Coverage</th><th>Next blocker</th></tr></thead><tbody>${rows}</tbody></table>
`;
}

function spreadsheetFamily(
  root: string,
  official: OfficialCoverageReport | undefined,
  id: string,
  fallbackTitle: string,
  counted: boolean,
): FullProxyBenchmarkFamily {
  const track = official?.tracks?.find((item) => item.id === id);
  const live = readJson<LiveRoomProof>(root, "docs/eval/spreadsheetbench-live-room-proof.json");
  const targetCount = track?.officialExpectedTasks ?? 0;
  const localLive = id.startsWith("spreadsheetbench-v1") && live?.passed === true && live.memoryMode === false ? 1 : 0;
  const prodLive = localLive && isProdUrl(live?.baseUrl) ? 1 : 0;
  const status: FullProxyBenchmarkStatus = prodLive >= targetCount && targetCount > 0
    ? "prod_live_browser_verified"
    : localLive >= targetCount && targetCount > 0
      ? "local_live_browser_verified"
      : (track?.stagedTasks ?? 0) > 0
        ? "staged_not_prod_browser_run"
        : "blocked";
  return {
    id,
    title: track?.title ?? fallbackTitle,
    family: id.includes("verified") ? "official_subset" : "official_public",
    taskTargetCount: targetCount,
    taskTargetMeaning: id.includes("verified")
      ? "overlapping verified SpreadsheetBench V1 subset"
      : "official published task count",
    countedInUniqueProxyTargetTotal: counted,
    stagedTaskCount: track?.stagedTasks ?? 0,
    deterministicRunTaskCount: track?.deterministicRunTasks ?? 0,
    modelRunCaseCount: track?.modelRunCases ?? 0,
    modelRunAttemptCount: track?.modelRunAttempts ?? 0,
    prodLiveBrowserVerifiedTaskCount: prodLive,
    localLiveBrowserVerifiedTaskCount: localLive,
    officialScoredTaskCount: 0,
    status,
    evidence: [
      ...(track?.evidence ?? []),
      ...(live ? ["docs/eval/spreadsheetbench-live-room-proof.json"] : []),
    ],
    runnableCommands: [
      "npm run benchmark:spreadsheetbench:run-chunked",
      "npm run benchmark:spreadsheetbench:score",
      "npm run benchmark:official:ui-coverage",
    ],
    blockers: [
      ...(track?.blockers ?? []),
      ...(prodLive > 0 ? [] : [`No ${id} receipt proves every task through a fresh prod browser room on noderoom.live.`]),
    ],
  };
}

function bankerToolBenchFamily(root: string, official: OfficialCoverageReport | undefined): FullProxyBenchmarkFamily {
  const track = official?.tracks?.find((item) => item.id === "bankertoolbench-full-100");
  const fullSuite = readJson<BtbFullSuiteReceipt>(root, "docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json");
  const taskReceipts = countBtbFreshRoomReceipts(root);
  const prodReceipts = countProdBtbLiveRoomReceipts(root);
  const officialScored = fullSuite?.flipEligible === true
    ? fullSuite.cleanScoredTaskCount ?? track?.modelRunCases ?? 0
    : track?.modelRunCases ?? 0;
  const status: FullProxyBenchmarkStatus = prodReceipts >= (track?.officialExpectedTasks ?? 100)
    ? "prod_live_browser_verified"
    : officialScored >= (track?.officialExpectedTasks ?? 100)
      ? "official_scored_not_prod_browser"
      : taskReceipts > 0
        ? "local_live_browser_verified"
        : "staged_not_prod_browser_run";
  return {
    id: "bankertoolbench-full-100",
    title: track?.title ?? "BankerToolBench full 100",
    family: "official_public",
    taskTargetCount: track?.officialExpectedTasks ?? fullSuite?.expectedCount ?? 100,
    taskTargetMeaning: "official BankerToolBench task count",
    countedInUniqueProxyTargetTotal: true,
    stagedTaskCount: track?.stagedTasks ?? officialScored,
    deterministicRunTaskCount: track?.deterministicRunTasks ?? 0,
    modelRunCaseCount: track?.modelRunCases ?? officialScored,
    modelRunAttemptCount: track?.modelRunAttempts ?? fullSuite?.executedTaskCount ?? 0,
    prodLiveBrowserVerifiedTaskCount: prodReceipts,
    localLiveBrowserVerifiedTaskCount: taskReceipts,
    officialScoredTaskCount: officialScored,
    status,
    evidence: [
      ...(track?.evidence ?? []),
      "docs/eval/fresh-room/FR-020/tasks",
      "docs/eval/bankertoolbench/live-room",
    ],
    runnableCommands: [
      "npm run proofloop:live:btb",
      "npm run benchmark:bankertoolbench:livesuite-gate -- --write --assert",
      "npm run benchmark:bankertoolbench:fullsuite-gate",
    ],
    blockers: prodReceipts >= (track?.officialExpectedTasks ?? 100)
      ? []
      : [`Existing BTB full-suite evidence is not a prod noderoom.live model matrix; prod receipts found ${prodReceipts}/${track?.officialExpectedTasks ?? 100}.`],
  };
}

function accountingFamily(root: string): FullProxyBenchmarkFamily {
  const configPath = "proofloop/accounting/live.accounting.config.json";
  const config = readJson<LiveConfig>(root, configPath);
  const tasks = config?.tasks?.length ?? 0;
  return {
    id: "accounting-live-proofloop",
    title: "Accounting live proof-loop",
    family: "product_suite",
    taskTargetCount: tasks,
    taskTargetMeaning: "configured live accounting product tasks",
    countedInUniqueProxyTargetTotal: true,
    stagedTaskCount: tasks,
    deterministicRunTaskCount: 0,
    modelRunCaseCount: 0,
    modelRunAttemptCount: 0,
    prodLiveBrowserVerifiedTaskCount: 0,
    localLiveBrowserVerifiedTaskCount: 0,
    officialScoredTaskCount: 0,
    status: tasks > 0 ? "ready_to_run" : "blocked",
    evidence: [configPath, "proofloop/accounting/benchmarks/benchmark-registry.json"],
    runnableCommands: ["npm run proofloop:live:accounting"],
    blockers: tasks > 0
      ? ["Current live accounting runner uses Convex HTTP, not a browser-driven prod room model matrix."]
      : ["Accounting live config has no tasks."],
  };
}

function notionFamily(root: string): FullProxyBenchmarkFamily {
  const configPath = "proofloop/notion/live.notion.config.json";
  const config = readJson<LiveConfig>(root, configPath);
  const tasks = config?.tasks?.length ?? 0;
  return {
    id: "notion-live-proofloop",
    title: "Notion SDR/BDR live proof-loop",
    family: "product_suite",
    taskTargetCount: tasks,
    taskTargetMeaning: "configured live Notion/SDR product tasks",
    countedInUniqueProxyTargetTotal: true,
    stagedTaskCount: tasks,
    deterministicRunTaskCount: 0,
    modelRunCaseCount: 0,
    modelRunAttemptCount: 0,
    prodLiveBrowserVerifiedTaskCount: 0,
    localLiveBrowserVerifiedTaskCount: 0,
    officialScoredTaskCount: 0,
    status: tasks > 0 ? "ready_to_run" : "blocked",
    evidence: [configPath],
    runnableCommands: ["npm run proofloop:live:notion"],
    blockers: tasks > 0
      ? ["Current live Notion runner uses Convex HTTP, not a browser-driven prod room model matrix."]
      : ["Notion live config has no tasks."],
  };
}

function proximittyFamily(root: string): FullProxyBenchmarkFamily {
  const latest = readJson<ProximittyRunResult>(root, ".proofloop/runs/latest/run-result.json");
  const steps = latest?.steps?.filter((step) => step.name?.startsWith("scenario-")).length ?? 4;
  const passed = latest?.suite === "proximitty-underwriting-pr0" && latest.passed === true;
  return {
    id: "proximitty-underwriting-pr0",
    title: "Proximitty underwriting PR0",
    family: "product_suite",
    taskTargetCount: steps,
    taskTargetMeaning: "configured underwriting proof-loop scenarios",
    countedInUniqueProxyTargetTotal: true,
    stagedTaskCount: steps,
    deterministicRunTaskCount: passed ? steps : 0,
    modelRunCaseCount: 0,
    modelRunAttemptCount: 0,
    prodLiveBrowserVerifiedTaskCount: 0,
    localLiveBrowserVerifiedTaskCount: passed ? steps : 0,
    officialScoredTaskCount: 0,
    status: passed ? "local_live_browser_verified" : "ready_to_run",
    evidence: ["proofloop/suites/proximitty-underwriting-pr0.json", ".proofloop/runs/latest/run-result.json"],
    runnableCommands: ["npm run proofloop:proximitty"],
    blockers: ["Latest Proximitty proof is deterministic/local; it is not a prod noderoom.live model matrix."],
  };
}

function externalAdapterFamilies(proxySweep: ProxyModelSweep | undefined): FullProxyBenchmarkFamily[] {
  return externalBenchmarkLocalTaskIds().map((adapterId) => {
    const tasks = loadExternalBenchmarkLocalTasks(adapterId);
    const rows = (proxySweep?.rows ?? []).filter((row) => row.adapterId === adapterId);
    const prodPassed = rows.some((row) => row.status === "passed" && isProdUrl(row.roomUrl));
    return {
      id: `${adapterId}-prod-proxy-task`,
      title: `${adapterId} prod live-browser proxy task`,
      family: "external_adapter",
      taskTargetCount: tasks.length,
      taskTargetMeaning: "local live-browser proxy task count, not upstream official task count",
      countedInUniqueProxyTargetTotal: true,
      stagedTaskCount: tasks.length,
      deterministicRunTaskCount: 0,
      modelRunCaseCount: rows.filter((row) => row.status === "passed").length,
      modelRunAttemptCount: rows.length,
      prodLiveBrowserVerifiedTaskCount: prodPassed ? tasks.length : 0,
      localLiveBrowserVerifiedTaskCount: 0,
      officialScoredTaskCount: 0,
      status: prodPassed ? "prod_live_browser_verified" : "ready_to_run",
      evidence: [
        `proofloop/benchmarks/${adapterId}/adapter.json`,
        `docs/eval/proofloop-external-adapter-live-room-runs/${adapterId}.json`,
        "docs/eval/proofloop-proxy-model-sweep.json",
      ],
      runnableCommands: [`npm run benchmark:proofloop:external-adapter-live-room -- --prod --id ${adapterId} --real-user`],
      blockers: prodPassed ? [] : [`${adapterId} has no passing prod live-browser model run in docs/eval/proofloop-proxy-model-sweep.json.`],
    };
  });
}

function nodeRoomInternalFamily(official: OfficialCoverageReport | undefined): FullProxyBenchmarkFamily {
  const track = official?.tracks?.find((item) => item.id === "noderoom-multi-user-conflict");
  return {
    id: "noderoom-multi-user-conflict",
    title: track?.title ?? "NodeRoom multi-user conflict suite",
    family: "internal",
    taskTargetCount: track?.officialExpectedTasks ?? 0,
    taskTargetMeaning: "internal deterministic NodeRoom conflict scenarios",
    countedInUniqueProxyTargetTotal: (track?.officialExpectedTasks ?? 0) > 0,
    stagedTaskCount: track?.stagedTasks ?? 0,
    deterministicRunTaskCount: track?.deterministicRunTasks ?? 0,
    modelRunCaseCount: track?.modelRunCases ?? 0,
    modelRunAttemptCount: track?.modelRunAttempts ?? 0,
    prodLiveBrowserVerifiedTaskCount: 0,
    localLiveBrowserVerifiedTaskCount: 0,
    officialScoredTaskCount: 0,
    status: (track?.deterministicRunTasks ?? 0) > 0 ? "staged_not_prod_browser_run" : "ready_to_run",
    evidence: track?.evidence ?? ["docs/eval/multi-user-coordination-proof.json"],
    runnableCommands: ["npm run eval:multiuser-coordination -- --strict"],
    blockers: track?.blockers ?? ["Run the internal conflict suite and attach browser proof if promoted to prod live coverage."],
  };
}

function modelRecommendation(proxySweep: ProxyModelSweep | undefined): FullProxyModelRecommendation {
  const byModel = proxySweep?.summary?.byModel ?? [];
  const fullyPassingModels = byModel
    .filter((row) => (row.total ?? 0) > 0 && row.passed === row.total)
    .map((row) => ({
      modelId: row.modelId ?? "unknown",
      passed: row.passed ?? 0,
      total: row.total ?? 0,
      estimatedCostUsdAtOpenRouterList: row.estimatedCostUsdAtOpenRouterList ?? null,
      measuredCostUsd: row.measuredCostUsd ?? null,
      avgDurationMs: row.avgDurationMs ?? null,
    }))
    .sort((a, b) => (a.estimatedCostUsdAtOpenRouterList ?? Infinity) - (b.estimatedCostUsdAtOpenRouterList ?? Infinity));
  const winner = fullyPassingModels[0] ?? null;
  return {
    status: winner ? "current_prod_proxy_winner" : "insufficient_full_task_evidence",
    modelId: winner?.modelId ?? null,
    basis: winner
      ? "Cheapest model with 100% pass rate on the current prod live-browser external-adapter proxy sweep; not yet proven across SpreadsheetBench/BTB/accounting/Notion/Proximitty full task families."
      : "No fully passing prod live-browser proxy model sweep is available.",
    fullyPassingModels,
  };
}

function countBtbFreshRoomReceipts(root: string): number {
  const tasksRoot = join(root, "docs/eval/fresh-room/FR-020/tasks");
  if (!existsSync(tasksRoot)) return 0;
  let count = 0;
  for (const entry of readdirSync(tasksRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const receipt = readJson<LiveRoomProof>(root, `docs/eval/fresh-room/FR-020/tasks/${entry.name}/latest.json`);
    if (receipt?.passed === true && receipt.memoryMode === false) count += 1;
  }
  return count;
}

function countProdBtbLiveRoomReceipts(root: string): number {
  const receiptsRoot = join(root, "docs/eval/bankertoolbench/live-room");
  if (!existsSync(receiptsRoot)) return 0;
  let count = 0;
  for (const entry of readdirSync(receiptsRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const receipt = readJson<LiveRoomProof>(root, `docs/eval/bankertoolbench/live-room/${entry.name}`);
    if (receipt?.passed === true && receipt.memoryMode === false && isProdUrl(receipt.baseUrl)) count += 1;
  }
  return count;
}

function readJson<T>(root: string, path: string): T | undefined {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return undefined;
  try {
    return JSON.parse(readFileSync(absolute, "utf8").replace(/^\uFEFF/, "").replace(/^Ã¯Â»Â¿/, "")) as T;
  } catch {
    return undefined;
  }
}

function isProdUrl(value: string | undefined): boolean {
  return typeof value === "string" && /^https:\/\/noderoom\.live(?:\/|$)/i.test(value);
}

function sum<T extends Record<string, unknown>>(items: T[], key: keyof T): number {
  return items.reduce((total, item) => {
    const value = item[key];
    return total + (typeof value === "number" && Number.isFinite(value) ? value : 0);
  }, 0);
}

function money(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "n/a";
  return `$${value.toFixed(value < 0.01 ? 6 : 4)}`;
}

function escapePipes(value: string): string {
  return value.replace(/\|/g, "/");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
