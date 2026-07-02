import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const VEGA_LITE_SCHEMA = "https://vega.github.io/schema/vega-lite/v5.json";
const CHART_PACK_SCHEMA = "proofloop-chart-pack-v1" as const;

export type ProofloopChartKind =
  | "model_performance"
  | "cost_per_pass"
  | "failure_categories"
  | "harness_version"
  | "evidence_score"
  | "latency_cost"
  | "accounting_workpaper"
  | "workflow_timeline";

export type ProofloopChartSourceBinding = {
  sourceFile: string;
  sourceField: string;
  required: boolean;
};

export type ProofloopChartEntry = {
  id: string;
  title: string;
  purpose: string;
  kind: ProofloopChartKind;
  specPath: string;
  dataPath: string;
  sourceBindings: ProofloopChartSourceBinding[];
  unavailable?: {
    reason: string;
  };
};

export type ProofloopChartPack = {
  schema: typeof CHART_PACK_SCHEMA;
  runId: string;
  suite: string;
  generatedAt: string;
  sourceRefs: {
    nodeTraceV2?: string;
    nodeEval?: string;
    costLedger?: string;
    modelComparison?: string;
    failureTaxonomy?: string;
    memory?: string;
    runResult?: string;
    meta?: string;
    laneAnalyses?: string[];
    laneCostLedgers?: string[];
    laneModelMatrices?: string[];
    laneHarnessVersions?: string[];
  };
  summary: {
    lanes: number;
    runs: number;
    models: number;
    blockerCategories: number;
    workflowItems: number;
    chartCount: number;
    unavailableCharts: number;
  };
  charts: ProofloopChartEntry[];
};

export type ProofloopChartPackBundle = {
  pack: ProofloopChartPack;
  data: Record<string, ProofloopChartRow[]>;
  specs: Record<string, VegaLiteSpec>;
  context: ProofloopChartContext;
};

export type ProofloopChartPackOutputs = {
  pack: ProofloopChartPack;
  validation: ProofloopChartValidation;
  paths: ProofloopChartOutputPaths;
};

export type ProofloopChartOutputPaths = {
  json: string;
  markdown: string;
  html: string;
  specs: Record<string, string>;
  data: Record<string, string>;
  svgs: Record<string, string>;
  runArtifacts: Array<{
    dir: string;
    json: string;
    html: string;
  }>;
};

export type ProofloopChartValidation = {
  ok: boolean;
  errors: string[];
};

export type ProofloopChartRow = Record<string, string | number | boolean | null | string[]>;

export type VegaLiteSpec = {
  $schema: string;
  title: string;
  description: string;
  data: { url: string; format: { type: "json" } };
  mark: string | Record<string, unknown>;
  encoding: Record<string, unknown>;
  transform?: Array<Record<string, unknown>>;
  usermeta: {
    proofloop: {
      chartId: string;
      sourceBindings: ProofloopChartSourceBinding[];
      unavailable?: { reason: string };
    };
  };
};

export type ModelPerformancePoint = ProofloopChartRow & {
  suite: string;
  model: string;
  provider: string;
  role: string;
  routePolicy: string;
  passed: boolean;
  score: number | null;
  costUsd: number | null;
  durationMs: number | null;
  evidenceScore: number | null;
  failureLayer: string | null;
  sourceFile: string;
  sourceField: string;
};

export type CostPerPassPoint = ProofloopChartRow & {
  suite: string;
  model: string;
  passed: boolean;
  costUsd: number | null;
  costPerPassUsd: number | null;
  score: number | null;
  sourceFile: string;
  sourceField: string;
};

export type FailureCategoryPoint = ProofloopChartRow & {
  failureCategory: string;
  count: number;
  suites: string[];
  sourceFile: string;
  sourceField: string;
};

export type HarnessVersionTrendPoint = ProofloopChartRow & {
  suite: string;
  harnessVersion: string;
  passRate: number | null;
  costUsd: number | null;
  latencyMs: number | null;
  failureCount: number;
  filesTracked: number;
  missingFiles: number;
  sourceFile: string;
  sourceField: string;
};

export type EvidenceScorePoint = ProofloopChartRow & {
  runId: string;
  suite: string;
  evidenceGrounding: number | null;
  visualScore: number | null;
  totalReward: number | null;
  sourceFile: string;
  sourceField: string;
};

export type LatencyCostFrontierPoint = ProofloopChartRow & {
  suite: string;
  model: string;
  provider: string;
  costUsd: number | null;
  durationMs: number | null;
  score: number | null;
  passed: boolean;
  sourceFile: string;
  sourceField: string;
};

export type AccountingWorkpaperPoint = ProofloopChartRow & {
  suite: string;
  metric: string;
  value: number;
  status: string;
  sourceFile: string;
  sourceField: string;
};

export type WorkflowCompletionPoint = ProofloopChartRow & {
  id: string;
  suite: string;
  status: string;
  passed: boolean;
  score: number | null;
  sourceFile: string;
  sourceField: string;
};

type ProofloopChartContext = {
  target: string;
  runId: string;
  suite: string;
  selectedRunDirs: Array<{ name: string; path: string }>;
  runArtifactDirs: string[];
};

type LaneAnalysis = {
  blockerId?: string;
  suite?: string;
  status?: string;
  classes?: string[];
};

type LaneModelMatrix = {
  suite?: string;
  models?: Array<{
    id?: string;
    provider?: string;
    role?: string;
    routePolicy?: string;
    status?: string;
    rank?: number;
    qualityScore?: number | null;
    officialScore?: number | null;
    costUsd?: number;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
  }>;
};

type LaneCostLedger = {
  suite?: string;
  models?: Array<{
    id?: string;
    provider?: string;
    costUsd?: number;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
  }>;
};

type HarnessVersion = {
  suite?: string;
  harnessVersion?: string;
  generatedAt?: string;
  files?: Array<{ exists?: boolean }>;
};

type RunMeta = {
  runId?: string;
  suite?: string;
  passed?: boolean;
  score?: number;
  durationMs?: number;
  model?: {
    id?: string;
    provider?: string;
    role?: string;
    routePolicy?: string;
    costUsd?: number;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
    selectionReason?: string;
  };
  harnessVersion?: string;
  failedGates?: string[];
};

type NodeEval = {
  suite?: string;
  runId?: string;
  verifier?: {
    hardPass?: boolean;
    score?: number;
    failReasons?: string[];
  };
  judge?: {
    failureCategories?: string[];
  };
  reward?: {
    taskCompletion?: number;
    visualQuality?: number;
    uiStateCorrectness?: number;
    evidenceGrounding?: number;
    costEfficiency?: number;
    latencySmoothness?: number;
    safety?: number;
    total?: number;
    failureCategories?: string[];
  };
};

type ModelComparison = {
  suite?: string;
  runId?: string;
  policies?: Array<{
    policy?: string;
    provider?: string;
    passed?: boolean;
    score?: number;
    costUsd?: number;
    durationMs?: number;
    failureLayer?: string | null;
    evidenceQuality?: number;
    uiProofQuality?: number;
  }>;
};

type CostLedger = {
  suite?: string;
  runId?: string;
  totalCostUsd?: number;
  policies?: Array<{
    policy?: string;
    provider?: string;
    costUsd?: number;
    durationMs?: number;
    passed?: boolean;
    score?: number;
  }>;
  models?: Array<{
    id?: string;
    provider?: string;
    role?: string;
    routePolicy?: string;
    costUsd?: number;
    tokensIn?: number;
    tokensOut?: number;
    latencyMs?: number;
  }>;
};

const CHART_DEFS: Array<{
  id: string;
  file: string;
  title: string;
  purpose: string;
  kind: ProofloopChartKind;
  emptyReason: string;
  sourceBindings: ProofloopChartSourceBinding[];
  spec: (dataPath: string, unavailable?: { reason: string }) => VegaLiteSpec;
}> = [
  {
    id: "model-performance",
    file: "model-performance",
    title: "Model Performance",
    purpose: "Which model or fusion policy actually passes this task, with score, cost, latency, and evidence quality.",
    kind: "model_performance",
    emptyReason: "No model route, model-comparison, or model-matrix rows were found.",
    sourceBindings: [
      { sourceFile: "model-comparison.json", sourceField: "policies[].score", required: false },
      { sourceFile: "model-matrix.json", sourceField: "models[].qualityScore", required: false },
      { sourceFile: "meta.json", sourceField: "model", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("model-performance", "Model Performance", "bar", dataPath, {
      x: nominal("model", "Model / route", "-y"),
      y: quantitative("score", "Score"),
      color: nominal("passed", "Passed"),
      tooltip: tooltip(["suite", "model", "provider", "score", "costUsd", "durationMs", "evidenceScore", "failureLayer", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "cost-per-pass",
    file: "cost-per-pass",
    title: "Cost Per Pass",
    purpose: "How much it costs to get one successful proof run for each route.",
    kind: "cost_per_pass",
    emptyReason: "No passed route with backed cost was found.",
    sourceBindings: [
      { sourceFile: "cost-ledger.json", sourceField: "policies[].costUsd", required: false },
      { sourceFile: "meta.json", sourceField: "model.costUsd", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("cost-per-pass", "Cost Per Pass", "bar", dataPath, {
      x: nominal("model", "Model / route", "-y"),
      y: quantitative("costPerPassUsd", "Cost per pass (USD)"),
      color: nominal("passed", "Passed"),
      tooltip: tooltip(["suite", "model", "costUsd", "costPerPassUsd", "score", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "failure-categories",
    file: "failure-categories",
    title: "Failure Categories",
    purpose: "What is actually breaking across proof runs and benchmark lanes.",
    kind: "failure_categories",
    emptyReason: "No failure categories were found in lane analyses or node-eval receipts.",
    sourceBindings: [
      { sourceFile: "blocker-analysis.json", sourceField: "classes[]", required: false },
      { sourceFile: "node-eval.json", sourceField: "reward.failureCategories[]", required: false },
      { sourceFile: "model-comparison.json", sourceField: "policies[].failureLayer", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("failure-categories", "Failure Categories", "bar", dataPath, {
      x: nominal("failureCategory", "Failure category", "-y"),
      y: quantitative("count", "Count"),
      color: nominal("failureCategory", "Failure category"),
      tooltip: tooltip(["failureCategory", "count", "suites", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "harness-version-trend",
    file: "harness-version-trend",
    title: "Harness Version Trend",
    purpose: "Whether newer harness versions improve pass rate, cost, latency, and failure count.",
    kind: "harness_version",
    emptyReason: "No harness-version receipts were found.",
    sourceBindings: [
      { sourceFile: "harness-version.json", sourceField: "harnessVersion", required: false },
      { sourceFile: "meta.json", sourceField: "harnessVersion", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("harness-version-trend", "Harness Version Trend", { type: "line", point: true }, dataPath, {
      x: nominal("harnessVersion", "Harness version"),
      y: quantitative("passRate", "Pass rate"),
      color: nominal("suite", "Suite"),
      tooltip: tooltip(["suite", "harnessVersion", "passRate", "costUsd", "latencyMs", "failureCount", "filesTracked", "missingFiles", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "evidence-score",
    file: "evidence-score",
    title: "Evidence Grounding",
    purpose: "How strongly the proof run is grounded in recorded evidence and visual/verifier receipts.",
    kind: "evidence_score",
    emptyReason: "No node-eval reward evidence metrics were found.",
    sourceBindings: [
      { sourceFile: "node-eval.json", sourceField: "reward.evidenceGrounding", required: false },
      { sourceFile: "model-comparison.json", sourceField: "policies[].evidenceQuality", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("evidence-score", "Evidence Grounding", "bar", dataPath, {
      x: nominal("runId", "Run"),
      y: quantitative("evidenceGrounding", "Evidence grounding"),
      color: nominal("suite", "Suite"),
      tooltip: tooltip(["runId", "suite", "evidenceGrounding", "visualScore", "totalReward", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "latency-cost-frontier",
    file: "latency-cost-frontier",
    title: "Latency / Cost Frontier",
    purpose: "Which route is cheapest and fastest without losing proof score.",
    kind: "latency_cost",
    emptyReason: "No route rows had backed cost or latency fields.",
    sourceBindings: [
      { sourceFile: "cost-ledger.json", sourceField: "policies[].durationMs", required: false },
      { sourceFile: "model-matrix.json", sourceField: "models[].latencyMs", required: false },
      { sourceFile: "meta.json", sourceField: "durationMs", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("latency-cost-frontier", "Latency / Cost Frontier", "point", dataPath, {
      x: quantitative("costUsd", "Cost (USD)"),
      y: quantitative("durationMs", "Duration / latency (ms)"),
      size: quantitative("score", "Score"),
      color: nominal("passed", "Passed"),
      tooltip: tooltip(["suite", "model", "provider", "costUsd", "durationMs", "score", "passed", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "accounting-workpaper",
    file: "accounting-workpaper",
    title: "Accounting Workpaper",
    purpose: "Finance/accounting proof metrics such as tie-outs, debit-credit balance, aging buckets, and variance waterfalls.",
    kind: "accounting_workpaper",
    emptyReason: "The selected proof target did not include accounting workpaper metrics.",
    sourceBindings: [
      { sourceFile: "node-eval.json", sourceField: "reward.taskCompletion", required: false },
      { sourceFile: "verifier-receipt.json", sourceField: "accounting", required: false },
      { sourceFile: "run-result.json", sourceField: "accounting", required: false },
    ],
    spec: (dataPath, unavailable) => baseSpec("accounting-workpaper", "Accounting Workpaper", "bar", dataPath, {
      x: nominal("metric", "Metric"),
      y: quantitative("value", "Value"),
      color: nominal("status", "Status"),
      tooltip: tooltip(["suite", "metric", "value", "status", "sourceFile", "sourceField"]),
    }, unavailable),
  },
  {
    id: "workflow-completion",
    file: "workflow-completion",
    title: "Workflow Completion",
    purpose: "Latest proof state by run and benchmark lane.",
    kind: "workflow_timeline",
    emptyReason: "No proof workflow rows were found.",
    sourceBindings: [
      { sourceFile: "blocker-analysis.json", sourceField: "status", required: false },
      { sourceFile: "meta.json", sourceField: "passed", required: false },
      { sourceFile: "node-eval.json", sourceField: "verifier.hardPass", required: false },
    ],
    spec: (dataPath, unavailable) => ({
      ...baseSpec("workflow-completion", "Workflow Completion", "bar", dataPath, {
        x: nominal("status", "Status", "-y"),
        y: { aggregate: "count", type: "quantitative", title: "Count" },
        color: nominal("status", "Status"),
        tooltip: tooltip(["status", "suite", "id", "score", "sourceFile", "sourceField"]),
      }, unavailable),
      transform: [{ aggregate: [{ op: "count", as: "count" }], groupby: ["status"] }],
    }),
  },
];

export function buildProofloopChartPack(args: {
  root?: string;
  target?: string;
  generatedAt?: string;
} = {}): ProofloopChartPack {
  return buildProofloopChartPackBundle(args).pack;
}

export function buildProofloopChartPackBundle(args: {
  root?: string;
  target?: string;
  generatedAt?: string;
} = {}): ProofloopChartPackBundle {
  const root = resolve(args.root ?? process.cwd());
  const context = resolveChartContext(root, args.target ?? "latest");
  const rows = collectProofloopChartRows(root, context);
  const generatedAt = args.generatedAt ?? new Date().toISOString();
  const charts: ProofloopChartEntry[] = CHART_DEFS.map((def) => {
    const data = rows[def.id] ?? [];
    const unavailable = data.length ? undefined : { reason: def.emptyReason };
    return {
      id: def.id,
      title: def.title,
      purpose: def.purpose,
      kind: def.kind,
      specPath: `${def.file}.vl.json`,
      dataPath: `data/${def.file}.data.json`,
      sourceBindings: def.sourceBindings,
      ...(unavailable ? { unavailable } : {}),
    };
  });
  const specs = Object.fromEntries(
    CHART_DEFS.map((def) => {
      const chart = charts.find((candidate) => candidate.id === def.id);
      return [def.id, def.spec(`data/${def.file}.data.json`, chart?.unavailable)];
    }),
  );
  const pack: ProofloopChartPack = {
    schema: CHART_PACK_SCHEMA,
    runId: context.runId,
    suite: context.suite,
    generatedAt,
    sourceRefs: collectSourceRefs(root, context),
    summary: {
      lanes: listDirs(join(root, ".proofloop", "lanes")).length,
      runs: context.selectedRunDirs.length,
      models: rows["model-performance"].length,
      blockerCategories: rows["failure-categories"].length,
      workflowItems: rows["workflow-completion"].length,
      chartCount: charts.length,
      unavailableCharts: charts.filter((chart) => chart.unavailable).length,
    },
    charts,
  };
  return { pack, data: rows, specs, context };
}

export function writeProofloopChartPack(args: {
  root?: string;
  target?: string;
  outDir?: string;
  generatedAt?: string;
  writeRunArtifacts?: boolean;
} = {}): ProofloopChartPackOutputs {
  const root = resolve(args.root ?? process.cwd());
  const bundle = buildProofloopChartPackBundle({ root, target: args.target, generatedAt: args.generatedAt });
  const outDir = resolve(root, args.outDir ?? "docs/eval/proofloop-charts");
  const primary = writeChartBundleToDir(root, outDir, bundle);
  const runArtifacts = args.writeRunArtifacts === false
    ? []
    : bundle.context.runArtifactDirs.map((runDir) => writeChartBundleToDir(root, join(runDir, "charts"), bundle));
  const validation = validateProofloopChartBundle(bundle, root);
  const htmlValidation = validateWrittenChartBundle(outDir, bundle);
  validation.errors.push(...htmlValidation.errors);
  validation.ok = validation.ok && htmlValidation.ok;
  return {
    pack: bundle.pack,
    validation,
    paths: {
      ...primary,
      runArtifacts: runArtifacts.map((artifact) => ({
        dir: rel(root, dirname(artifact.json)),
        json: artifact.json,
        html: artifact.html,
      })),
    },
  };
}

export function validateProofloopChartPackArtifacts(args: {
  root?: string;
  outDir?: string;
} = {}): ProofloopChartValidation {
  const root = resolve(args.root ?? process.cwd());
  const outDir = resolve(root, args.outDir ?? "docs/eval/proofloop-charts");
  const pack = readJson<ProofloopChartPack>(join(outDir, "chart-pack.json")) ?? readJson<ProofloopChartPack>(join(outDir, "proofloop-chart-pack.json"));
  if (!pack) return { ok: false, errors: [`missing chart-pack.json in ${rel(root, outDir)}`] };
  const errors: string[] = [];
  for (const chart of pack.charts) {
    const spec = readJson<VegaLiteSpec>(join(outDir, chart.specPath));
    const data = readJson<ProofloopChartRow[]>(join(outDir, chart.dataPath));
    if (!spec) errors.push(`${chart.id}: missing or invalid spec ${chart.specPath}`);
    if (!Array.isArray(data)) errors.push(`${chart.id}: missing or invalid data ${chart.dataPath}`);
    if (Array.isArray(data) && data.length === 0 && !chart.unavailable) errors.push(`${chart.id}: empty data without unavailable reason`);
    if (spec && spec.$schema !== VEGA_LITE_SCHEMA) errors.push(`${chart.id}: invalid Vega-Lite schema`);
    if (spec && !spec.usermeta?.proofloop?.sourceBindings?.length) errors.push(`${chart.id}: missing proofloop source bindings`);
  }
  if (!existsSync(join(outDir, "chart-pack.html"))) errors.push("missing chart-pack.html");
  return { ok: errors.length === 0, errors };
}

export function renderProofloopChartPackMarkdown(pack: ProofloopChartPack, outDir = "docs/eval/proofloop-charts"): string {
  const lines = [
    "# Proof Loop Chart Pack",
    "",
    `Generated: ${pack.generatedAt}`,
    `Run: \`${pack.runId}\``,
    `Suite: \`${pack.suite}\``,
    "",
    "## Summary",
    "",
    `- Lanes: ${pack.summary.lanes}`,
    `- Runs: ${pack.summary.runs}`,
    `- Model rows: ${pack.summary.models}`,
    `- Failure categories: ${pack.summary.blockerCategories}`,
    `- Workflow items: ${pack.summary.workflowItems}`,
    `- Charts: ${pack.summary.chartCount}`,
    `- Unavailable charts: ${pack.summary.unavailableCharts}`,
    "",
    "## Chart Artifacts",
    "",
    "| Chart | Kind | Spec | Data | Source bindings |",
    "|---|---|---|---|---|",
    ...pack.charts.map((chart) => [
      `| ${chart.title}${chart.unavailable ? ` (${chart.unavailable.reason})` : ""}`,
      `\`${chart.kind}\``,
      `\`${join(outDir, chart.specPath).replace(/\\/g, "/")}\``,
      `\`${join(outDir, chart.dataPath).replace(/\\/g, "/")}\``,
      chart.sourceBindings.map((binding) => `\`${binding.sourceFile}:${binding.sourceField}\``).join("<br>"),
      "|",
    ].join(" | ")),
    "",
    "## Source Refs",
    "",
    "```json",
    JSON.stringify(pack.sourceRefs, null, 2),
    "```",
    "",
    "> Chart values are generated only from proof artifacts. Empty charts must be explicitly marked unavailable.",
    "",
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}

function collectProofloopChartRows(root: string, context: ProofloopChartContext): Record<string, ProofloopChartRow[]> {
  const modelPerformance: ModelPerformancePoint[] = [];
  const costPerPass: CostPerPassPoint[] = [];
  const failureAccumulator = new Map<string, { count: number; suites: Set<string>; sourceFile: string; sourceField: string }>();
  const harnessVersionTrend: HarnessVersionTrendPoint[] = [];
  const evidenceScore: EvidenceScorePoint[] = [];
  const latencyCostFrontier: LatencyCostFrontierPoint[] = [];
  const accountingWorkpaper: AccountingWorkpaperPoint[] = [];
  const workflowCompletion: WorkflowCompletionPoint[] = [];
  const laneStatusBySuite = new Map<string, { status: string; classes: string[] }>();

  const lanesRoot = join(root, ".proofloop", "lanes");
  for (const laneDir of listDirs(lanesRoot)) {
    const lanePath = join(lanesRoot, laneDir.name);
    const analysisPath = join(lanePath, "blocker-analysis.json");
    const matrixPath = join(lanePath, "model-matrix.json");
    const costPath = join(lanePath, "cost-ledger.json");
    const harnessPath = join(lanePath, "harness-version.json");
    const analysis = readJson<LaneAnalysis>(analysisPath);
    const matrix = readJson<LaneModelMatrix>(matrixPath);
    const laneCost = readJson<LaneCostLedger>(costPath);
    const harness = readJson<HarnessVersion>(harnessPath);
    const suite = analysis?.suite ?? matrix?.suite ?? laneCost?.suite ?? harness?.suite ?? laneDir.name;
    const status = analysis?.status ?? "unknown";
    const classes = analysis?.classes ?? [];
    laneStatusBySuite.set(suite, { status, classes });

    workflowCompletion.push({
      id: analysis?.blockerId ?? laneDir.name,
      suite,
      status,
      passed: status === "ready" || status === "passed",
      score: status === "ready" || status === "passed" ? 100 : null,
      sourceFile: rel(root, analysisPath),
      sourceField: "status",
    });

    if (classes.length) {
      classes.forEach((category, index) => addFailureCategory(failureAccumulator, {
        category,
        suite,
        sourceFile: rel(root, analysisPath),
        sourceField: `classes[${index}]`,
      }));
    } else if (status !== "ready" && status !== "passed") {
      addFailureCategory(failureAccumulator, {
        category: status,
        suite,
        sourceFile: rel(root, analysisPath),
        sourceField: "status",
      });
    }

    for (const [index, model] of (matrix?.models ?? []).entries()) {
      const score = percentOrNull(model.qualityScore ?? model.officialScore);
      const row: ModelPerformancePoint = {
        suite,
        model: model.id ?? "unknown",
        provider: model.provider ?? "unknown",
        role: model.role ?? "unknown",
        routePolicy: model.routePolicy ?? "unknown",
        passed: model.status === "passed",
        score,
        costUsd: nullableNumber(model.costUsd),
        durationMs: nullableNumber(model.latencyMs),
        evidenceScore: null,
        failureLayer: model.status && model.status !== "passed" ? model.status : null,
        sourceFile: rel(root, matrixPath),
        sourceField: `models[${index}]`,
      };
      modelPerformance.push(row);
      latencyCostFrontier.push({
        suite,
        model: row.model,
        provider: row.provider,
        costUsd: nullableNumber(model.costUsd),
        durationMs: nullableNumber(model.latencyMs),
        score,
        passed: row.passed,
        sourceFile: row.sourceFile,
        sourceField: `models[${index}].latencyMs`,
      });
    }

    for (const [index, model] of (laneCost?.models ?? []).entries()) {
      costPerPass.push({
        suite,
        model: model.id ?? "unknown",
        passed: false,
        costUsd: nullableNumber(model.costUsd),
        costPerPassUsd: null,
        score: null,
        sourceFile: rel(root, costPath),
        sourceField: `models[${index}].costUsd`,
      });
    }

    if (harness?.harnessVersion) {
      const files = harness.files ?? [];
      harnessVersionTrend.push({
        suite,
        harnessVersion: harness.harnessVersion,
        passRate: status === "ready" || status === "passed" ? 1 : 0,
        costUsd: sumNumbers((laneCost?.models ?? []).map((model) => model.costUsd)),
        latencyMs: averageNumbers((laneCost?.models ?? []).map((model) => model.latencyMs)),
        failureCount: classes.length,
        filesTracked: files.length,
        missingFiles: files.filter((file) => file.exists === false).length,
        sourceFile: rel(root, harnessPath),
        sourceField: "harnessVersion",
      });
    }
  }

  for (const runDir of context.selectedRunDirs) {
    const runPath = runDir.path;
    const metaPath = join(runPath, "meta.json");
    const nodeEvalPath = join(runPath, "node-eval.json");
    const comparisonPath = join(runPath, "model-comparison.json");
    const costLedgerPath = join(runPath, "cost-ledger.json");
    const runResultPath = join(runPath, "run-result.json");
    const verifierPath = join(runPath, "verifier-receipt.json");
    const meta = readJson<RunMeta>(metaPath);
    const nodeEval = readJson<NodeEval>(nodeEvalPath);
    const comparison = readJson<ModelComparison>(comparisonPath);
    const costLedger = readJson<CostLedger>(costLedgerPath);
    const runId = meta?.runId ?? nodeEval?.runId ?? comparison?.runId ?? costLedger?.runId ?? runDir.name;
    const suite = meta?.suite ?? nodeEval?.suite ?? comparison?.suite ?? costLedger?.suite ?? runDir.name;
    const score = percentOrNull(meta?.score ?? nodeEval?.verifier?.score ?? nodeEval?.reward?.total);
    const passed = meta?.passed ?? nodeEval?.verifier?.hardPass ?? false;
    const durationMs = nullableNumber(meta?.durationMs);

    workflowCompletion.push({
      id: runId,
      suite,
      status: passed ? "passed" : "failed",
      passed,
      score,
      sourceFile: existsSync(metaPath) ? rel(root, metaPath) : rel(root, nodeEvalPath),
      sourceField: existsSync(metaPath) ? "passed" : "verifier.hardPass",
    });

    if (meta?.model) {
      const model = meta.model;
      modelPerformance.push({
        suite,
        model: model.id ?? "unknown",
        provider: model.provider ?? "unknown",
        role: model.role ?? "unknown",
        routePolicy: model.routePolicy ?? "unknown",
        passed,
        score,
        costUsd: nullableNumber(model.costUsd),
        durationMs,
        evidenceScore: percentOrNull(nodeEval?.reward?.evidenceGrounding),
        failureLayer: (meta.failedGates ?? [])[0] ?? null,
        sourceFile: rel(root, metaPath),
        sourceField: "model",
      });
      costPerPass.push({
        suite,
        model: model.id ?? "unknown",
        passed,
        costUsd: nullableNumber(model.costUsd),
        costPerPassUsd: passed ? nullableNumber(model.costUsd) : null,
        score,
        sourceFile: rel(root, metaPath),
        sourceField: "model.costUsd",
      });
      latencyCostFrontier.push({
        suite,
        model: model.id ?? "unknown",
        provider: model.provider ?? "unknown",
        costUsd: nullableNumber(model.costUsd),
        durationMs,
        score,
        passed,
        sourceFile: rel(root, metaPath),
        sourceField: "durationMs",
      });
    }

    if (meta?.harnessVersion) {
      harnessVersionTrend.push({
        suite,
        harnessVersion: meta.harnessVersion,
        passRate: passed ? 1 : 0,
        costUsd: nullableNumber(meta.model?.costUsd),
        latencyMs: durationMs,
        failureCount: meta.failedGates?.length ?? 0,
        filesTracked: 0,
        missingFiles: 0,
        sourceFile: rel(root, metaPath),
        sourceField: "harnessVersion",
      });
    }

    for (const [index, policy] of (comparison?.policies ?? []).entries()) {
      const policyScore = percentOrNull(policy.score);
      const row: ModelPerformancePoint = {
        suite,
        model: policy.policy ?? "unknown-policy",
        provider: policy.provider ?? "unknown",
        role: policy.policy?.includes("fusion") ? "fusion" : "reasoning",
        routePolicy: policy.policy ?? "unknown",
        passed: policy.passed === true,
        score: policyScore,
        costUsd: nullableNumber(policy.costUsd),
        durationMs: nullableNumber(policy.durationMs),
        evidenceScore: percentOrNull(policy.evidenceQuality),
        failureLayer: policy.failureLayer ?? null,
        sourceFile: rel(root, comparisonPath),
        sourceField: `policies[${index}].score`,
      };
      modelPerformance.push(row);
      costPerPass.push({
        suite,
        model: row.model,
        passed: row.passed,
        costUsd: row.costUsd,
        costPerPassUsd: row.passed ? row.costUsd : null,
        score: policyScore,
        sourceFile: row.sourceFile,
        sourceField: `policies[${index}].costUsd`,
      });
      latencyCostFrontier.push({
        suite,
        model: row.model,
        provider: row.provider,
        costUsd: row.costUsd,
        durationMs: row.durationMs,
        score: policyScore,
        passed: row.passed,
        sourceFile: row.sourceFile,
        sourceField: `policies[${index}].durationMs`,
      });
      if (policy.failureLayer) {
        addFailureCategory(failureAccumulator, {
          category: policy.failureLayer,
          suite,
          sourceFile: rel(root, comparisonPath),
          sourceField: `policies[${index}].failureLayer`,
        });
      }
      if (typeof policy.evidenceQuality === "number") {
        evidenceScore.push({
          runId,
          suite,
          evidenceGrounding: percentOrNull(policy.evidenceQuality),
          visualScore: percentOrNull(policy.uiProofQuality),
          totalReward: policyScore,
          sourceFile: rel(root, comparisonPath),
          sourceField: `policies[${index}].evidenceQuality`,
        });
      }
    }

    for (const [index, policy] of (costLedger?.policies ?? []).entries()) {
      if ((comparison?.policies ?? []).some((candidate) => candidate.policy === policy.policy)) continue;
      const policyScore = percentOrNull(policy.score);
      costPerPass.push({
        suite,
        model: policy.policy ?? "unknown-policy",
        passed: policy.passed === true,
        costUsd: nullableNumber(policy.costUsd),
        costPerPassUsd: policy.passed === true ? nullableNumber(policy.costUsd) : null,
        score: policyScore,
        sourceFile: rel(root, costLedgerPath),
        sourceField: `policies[${index}].costUsd`,
      });
      latencyCostFrontier.push({
        suite,
        model: policy.policy ?? "unknown-policy",
        provider: policy.provider ?? "unknown",
        costUsd: nullableNumber(policy.costUsd),
        durationMs: nullableNumber(policy.durationMs),
        score: policyScore,
        passed: policy.passed === true,
        sourceFile: rel(root, costLedgerPath),
        sourceField: `policies[${index}].durationMs`,
      });
    }

    if (nodeEval?.reward) {
      evidenceScore.push({
        runId,
        suite,
        evidenceGrounding: percentOrNull(nodeEval.reward.evidenceGrounding),
        visualScore: percentOrNull(nodeEval.reward.visualQuality ?? nodeEval.reward.uiStateCorrectness),
        totalReward: percentOrNull(nodeEval.reward.total),
        sourceFile: rel(root, nodeEvalPath),
        sourceField: "reward.evidenceGrounding",
      });
      for (const [index, category] of (nodeEval.reward.failureCategories ?? []).entries()) {
        addFailureCategory(failureAccumulator, {
          category,
          suite,
          sourceFile: rel(root, nodeEvalPath),
          sourceField: `reward.failureCategories[${index}]`,
        });
      }
    }
    for (const [index, category] of (nodeEval?.judge?.failureCategories ?? []).entries()) {
      addFailureCategory(failureAccumulator, {
        category,
        suite,
        sourceFile: rel(root, nodeEvalPath),
        sourceField: `judge.failureCategories[${index}]`,
      });
    }

    accountingWorkpaper.push(...extractAccountingRows(root, {
      suite,
      nodeEval,
      nodeEvalPath,
      runResultPath,
      verifierPath,
    }));
  }

  const failureCategories: FailureCategoryPoint[] = [...failureAccumulator.entries()]
    .map(([failureCategory, value]) => ({
      failureCategory,
      count: value.count,
      suites: [...value.suites].sort(),
      sourceFile: value.sourceFile,
      sourceField: value.sourceField,
    }))
    .sort((a, b) => b.count - a.count || a.failureCategory.localeCompare(b.failureCategory));

  return {
    "model-performance": modelPerformance,
    "cost-per-pass": costPerPass.filter((point) => point.costPerPassUsd !== null),
    "failure-categories": failureCategories,
    "harness-version-trend": harnessVersionTrend,
    "evidence-score": evidenceScore,
    "latency-cost-frontier": latencyCostFrontier.filter((point) => point.costUsd !== null || point.durationMs !== null),
    "accounting-workpaper": accountingWorkpaper,
    "workflow-completion": workflowCompletion,
  };
}

function extractAccountingRows(root: string, args: {
  suite: string;
  nodeEval: NodeEval | null;
  nodeEvalPath: string;
  runResultPath: string;
  verifierPath: string;
}): AccountingWorkpaperPoint[] {
  const rows: AccountingWorkpaperPoint[] = [];
  const suiteIsAccounting = /\b(accounting|reconciliation|ar-|ap-|trial-balance|cash-flow|workpaper)\b/i.test(args.suite);
  if (!suiteIsAccounting) return rows;
  if (typeof args.nodeEval?.reward?.taskCompletion === "number") {
    rows.push({
      suite: args.suite,
      metric: "task completion",
      value: percentValue(args.nodeEval.reward.taskCompletion),
      status: args.nodeEval.verifier?.hardPass ? "passed" : "needs_review",
      sourceFile: rel(root, args.nodeEvalPath),
      sourceField: "reward.taskCompletion",
    });
  }
  const verifier = readJson<Record<string, unknown>>(args.verifierPath);
  const runResult = readJson<Record<string, unknown>>(args.runResultPath);
  for (const [source, sourceFile] of [
    [verifier, args.verifierPath],
    [runResult, args.runResultPath],
  ] as Array<[Record<string, unknown> | null, string]>) {
    const accounting = source?.accounting;
    if (!accounting || typeof accounting !== "object") continue;
    for (const [key, value] of Object.entries(accounting as Record<string, unknown>)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      rows.push({
        suite: args.suite,
        metric: key,
        value,
        status: "recorded",
        sourceFile: rel(root, sourceFile),
        sourceField: `accounting.${key}`,
      });
    }
  }
  return rows;
}

function resolveChartContext(root: string, target: string): ProofloopChartContext {
  const runsRoot = join(root, ".proofloop", "runs");
  const selectedRunDirs = selectRunDirs(runsRoot, target);
  const firstRun = selectedRunDirs[0];
  const meta = firstRun ? readJson<RunMeta>(join(firstRun.path, "meta.json")) : null;
  const nodeEval = firstRun ? readJson<NodeEval>(join(firstRun.path, "node-eval.json")) : null;
  const comparison = firstRun ? readJson<ModelComparison>(join(firstRun.path, "model-comparison.json")) : null;
  const costLedger = firstRun ? readJson<CostLedger>(join(firstRun.path, "cost-ledger.json")) : null;
  const runId = meta?.runId ?? nodeEval?.runId ?? comparison?.runId ?? costLedger?.runId ?? firstRun?.name ?? target;
  const suite = meta?.suite ?? nodeEval?.suite ?? comparison?.suite ?? costLedger?.suite ?? "aggregate";
  const runArtifactDirs = new Set<string>();
  for (const runDir of selectedRunDirs) runArtifactDirs.add(runDir.path);
  const canonicalRunDir = join(runsRoot, runId);
  if (existsSync(canonicalRunDir)) runArtifactDirs.add(canonicalRunDir);
  return {
    target,
    runId,
    suite,
    selectedRunDirs,
    runArtifactDirs: [...runArtifactDirs],
  };
}

function selectRunDirs(runsRoot: string, target: string): Array<{ name: string; path: string }> {
  const dirs = listDirs(runsRoot);
  if (!dirs.length) return [];
  if (target === "all") return dirs.filter((dir) => dir.name !== "latest");
  if (target && target !== "latest") return dirs.filter((dir) => dir.name === target);
  const latest = dirs.find((dir) => dir.name === "latest");
  if (latest) return [latest];
  return dirs.filter((dir) => dir.name !== "latest").sort((a, b) => mtimeMs(b.path) - mtimeMs(a.path)).slice(0, 1);
}

function collectSourceRefs(root: string, context: ProofloopChartContext): ProofloopChartPack["sourceRefs"] {
  const runDir = context.selectedRunDirs[0]?.path;
  const sourceRefs: ProofloopChartPack["sourceRefs"] = {};
  if (runDir) {
    assignIfExists(sourceRefs, "nodeTraceV2", root, join(runDir, "node-trace-v2.json"));
    assignIfExists(sourceRefs, "nodeEval", root, join(runDir, "node-eval.json"));
    assignIfExists(sourceRefs, "costLedger", root, join(runDir, "cost-ledger.json"));
    assignIfExists(sourceRefs, "modelComparison", root, join(runDir, "model-comparison.json"));
    assignIfExists(sourceRefs, "runResult", root, join(runDir, "run-result.json"));
    assignIfExists(sourceRefs, "meta", root, join(runDir, "meta.json"));
  }
  assignIfExists(sourceRefs, "memory", root, join(root, ".proofloop", "memory.jsonl"));
  const lanesRoot = join(root, ".proofloop", "lanes");
  sourceRefs.laneAnalyses = listExistingLaneFiles(root, lanesRoot, "blocker-analysis.json");
  sourceRefs.laneCostLedgers = listExistingLaneFiles(root, lanesRoot, "cost-ledger.json");
  sourceRefs.laneModelMatrices = listExistingLaneFiles(root, lanesRoot, "model-matrix.json");
  sourceRefs.laneHarnessVersions = listExistingLaneFiles(root, lanesRoot, "harness-version.json");
  sourceRefs.failureTaxonomy = sourceRefs.laneAnalyses[0];
  return sourceRefs;
}

function writeChartBundleToDir(root: string, outDir: string, bundle: ProofloopChartPackBundle): Omit<ProofloopChartOutputPaths, "runArtifacts"> {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, "data"), { recursive: true });
  mkdirSync(join(outDir, "svg"), { recursive: true });
  const jsonPath = join(outDir, "chart-pack.json");
  const legacyJsonPath = join(outDir, "proofloop-chart-pack.json");
  const markdownPath = join(outDir, "PROOFLOOP_CHART_PACK.md");
  const htmlPath = join(outDir, "chart-pack.html");
  writeJson(jsonPath, bundle.pack);
  writeJson(legacyJsonPath, bundle.pack);
  writeText(markdownPath, renderProofloopChartPackMarkdown(bundle.pack, rel(root, outDir)));
  writeText(htmlPath, renderProofloopChartPackHtml(bundle));

  const specs: Record<string, string> = {};
  const data: Record<string, string> = {};
  const svgs: Record<string, string> = {};
  for (const def of CHART_DEFS) {
    const specPath = join(outDir, `${def.file}.vl.json`);
    const dataPath = join(outDir, "data", `${def.file}.data.json`);
    const svgPath = join(outDir, "svg", `${def.file}.svg`);
    writeJson(specPath, bundle.specs[def.id]);
    writeJson(dataPath, bundle.data[def.id] ?? []);
    writeText(svgPath, renderChartSvg(def.title, bundle.data[def.id] ?? []));
    specs[def.id] = rel(root, specPath);
    data[def.id] = rel(root, dataPath);
    svgs[def.id] = rel(root, svgPath);
  }
  return {
    json: rel(root, jsonPath),
    markdown: rel(root, markdownPath),
    html: rel(root, htmlPath),
    specs,
    data,
    svgs,
  };
}

function validateProofloopChartBundle(bundle: ProofloopChartPackBundle, root: string): ProofloopChartValidation {
  const errors: string[] = [];
  if (bundle.pack.schema !== CHART_PACK_SCHEMA) errors.push("invalid chart-pack schema");
  if (!bundle.pack.runId.trim()) errors.push("missing runId");
  for (const [key, value] of Object.entries(bundle.pack.sourceRefs)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!existsSync(resolve(root, item))) errors.push(`sourceRefs.${key} missing ${item}`);
      }
    } else if (typeof value === "string" && value && !existsSync(resolve(root, value))) {
      errors.push(`sourceRefs.${key} missing ${value}`);
    }
  }
  for (const chart of bundle.pack.charts) {
    const rows = bundle.data[chart.id] ?? [];
    const spec = bundle.specs[chart.id];
    if (!chart.sourceBindings.length) errors.push(`${chart.id}: missing source bindings`);
    if (!spec) errors.push(`${chart.id}: missing Vega-Lite spec`);
    if (spec && spec.$schema !== VEGA_LITE_SCHEMA) errors.push(`${chart.id}: invalid Vega-Lite schema`);
    if (spec && spec.usermeta.proofloop.chartId !== chart.id) errors.push(`${chart.id}: spec usermeta chart id mismatch`);
    if (!rows.length && !chart.unavailable) errors.push(`${chart.id}: empty data without unavailable reason`);
    for (const [index, row] of rows.entries()) {
      if (!row.sourceFile || typeof row.sourceFile !== "string") errors.push(`${chart.id}[${index}]: missing sourceFile`);
      if (!row.sourceField || typeof row.sourceField !== "string") errors.push(`${chart.id}[${index}]: missing sourceField`);
      if (typeof row.sourceFile === "string" && row.sourceFile && !existsSync(resolve(root, row.sourceFile))) {
        errors.push(`${chart.id}[${index}]: sourceFile does not exist: ${row.sourceFile}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateWrittenChartBundle(outDir: string, bundle: ProofloopChartPackBundle): ProofloopChartValidation {
  const errors: string[] = [];
  for (const chart of bundle.pack.charts) {
    if (!existsSync(join(outDir, chart.specPath))) errors.push(`${chart.id}: missing written spec`);
    if (!existsSync(join(outDir, chart.dataPath))) errors.push(`${chart.id}: missing written data`);
  }
  const html = join(outDir, "chart-pack.html");
  if (!existsSync(html)) errors.push("missing written chart-pack.html");
  else {
    const text = readFileSync(html, "utf8");
    if (!text.includes("vegaEmbed")) errors.push("chart-pack.html missing Vega renderer");
    if (!text.includes(bundle.pack.runId)) errors.push("chart-pack.html missing run id");
  }
  return { ok: errors.length === 0, errors };
}

function baseSpec(
  id: string,
  title: string,
  mark: string | Record<string, unknown>,
  dataPath: string,
  encoding: Record<string, unknown>,
  unavailable?: { reason: string },
): VegaLiteSpec {
  const def = CHART_DEFS.find((chart) => chart.id === id);
  return {
    $schema: VEGA_LITE_SCHEMA,
    title,
    description: def?.purpose ?? title,
    data: { url: dataPath, format: { type: "json" } },
    mark,
    encoding,
    usermeta: {
      proofloop: {
        chartId: id,
        sourceBindings: def?.sourceBindings ?? [],
        ...(unavailable ? { unavailable } : {}),
      },
    },
  };
}

function nominal(field: string, title: string, sort?: string): Record<string, unknown> {
  return { field, type: "nominal", title, ...(sort ? { sort } : {}) };
}

function quantitative(field: string, title: string): Record<string, unknown> {
  return { field, type: "quantitative", title };
}

function tooltip(fields: string[]): Array<Record<string, string>> {
  return fields.map((field) => ({ field, type: field.endsWith("Usd") || field.endsWith("Ms") || field === "score" || field === "count" ? "quantitative" : "nominal" }));
}

function renderProofloopChartPackHtml(bundle: ProofloopChartPackBundle): string {
  const chartDivs = bundle.pack.charts.map((chart) => {
    const unavailable = chart.unavailable ? `<p class="unavailable">${escapeHtml(chart.unavailable.reason)}</p>` : "";
    return `<section><h2>${escapeHtml(chart.title)}</h2><p>${escapeHtml(chart.purpose)}</p>${unavailable}<div id="chart-${escapeHtml(chart.id)}"></div><p class="source">Spec: <code>${escapeHtml(chart.specPath)}</code> Data: <code>${escapeHtml(chart.dataPath)}</code></p></section>`;
  }).join("\n");
  const embeds = bundle.pack.charts.map((chart) => `vegaEmbed("#chart-${escapeJs(chart.id)}", ${JSON.stringify(chart.specPath)}, { actions: false }).catch((error) => {
  document.querySelector("#chart-${escapeJs(chart.id)}").innerHTML = "<pre>" + String(error).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])) + "</pre>";
});`).join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Proof Loop Chart Pack - ${escapeHtml(bundle.pack.runId)}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 0; color: #0f172a; background: #f8fafc; }
    header, section { max-width: 1120px; margin: 0 auto; padding: 24px; }
    header { border-bottom: 1px solid #cbd5e1; background: #ffffff; }
    section { background: #ffffff; border-bottom: 1px solid #e2e8f0; }
    h1, h2 { margin: 0 0 8px; }
    p { color: #475569; }
    code { background: #f1f5f9; padding: 2px 4px; border-radius: 4px; }
    .unavailable { color: #92400e; }
    .source { font-size: 12px; }
  </style>
  <script src="https://cdn.jsdelivr.net/npm/vega@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-lite@5"></script>
  <script src="https://cdn.jsdelivr.net/npm/vega-embed@6"></script>
</head>
<body>
  <header>
    <h1>Proof Loop Chart Pack</h1>
    <p>Run <code>${escapeHtml(bundle.pack.runId)}</code> / suite <code>${escapeHtml(bundle.pack.suite)}</code>. Generated ${escapeHtml(bundle.pack.generatedAt)}.</p>
  </header>
  ${chartDivs}
  <script>
${embeds}
  </script>
</body>
</html>
`;
}

function renderChartSvg(title: string, rows: ProofloopChartRow[]): string {
  const chartRows = rows.slice(0, 12).map((row, index) => {
    const label = String(row.model ?? row.failureCategory ?? row.harnessVersion ?? row.runId ?? row.metric ?? row.status ?? row.suite ?? `row ${index + 1}`);
    const numeric = firstNumeric(row, ["score", "costPerPassUsd", "count", "passRate", "evidenceGrounding", "durationMs", "value"]) ?? 0;
    const color = row.passed === true ? "#0F766E" : row.passed === false ? "#64748B" : "#2563EB";
    return { label, value: numeric, color };
  });
  return renderBarSvg({
    title,
    subtitle: rows.length ? "Backed by Proof Loop chart data rows" : "Unavailable: no backed proof data rows",
    rows: chartRows,
  });
}

function renderBarSvg(args: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; value: number; color: string }>;
}): string {
  const rows = args.rows.length ? args.rows : [{ label: "unavailable", value: 0, color: "#94A3B8" }];
  const width = 980;
  const rowHeight = 34;
  const top = 78;
  const height = top + rows.length * rowHeight + 34;
  const labelWidth = 300;
  const max = Math.max(...rows.map((row) => Math.abs(row.value)), 1);
  const plotWidth = width - labelWidth - 90;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(args.title)}">`,
    `<rect width="${width}" height="${height}" fill="#F8FAFC"/>`,
    `<text x="28" y="34" fill="#0F172A" font-size="22" font-family="Arial, sans-serif" font-weight="700">${escapeXml(args.title)}</text>`,
    `<text x="28" y="56" fill="#475569" font-size="13" font-family="Arial, sans-serif">${escapeXml(args.subtitle)}</text>`,
  ];
  rows.forEach((row, index) => {
    const y = top + index * rowHeight;
    const barWidth = Math.max(2, (Math.abs(row.value) / max) * plotWidth);
    lines.push(`<text x="28" y="${y + 20}" fill="#334155" font-size="12" font-family="Arial, sans-serif">${escapeXml(row.label.slice(0, 42))}</text>`);
    lines.push(`<rect x="${labelWidth}" y="${y + 5}" width="${barWidth.toFixed(1)}" height="18" rx="3" fill="${row.color}"/>`);
    lines.push(`<text x="${labelWidth + barWidth + 8}" y="${y + 19}" fill="#334155" font-size="12" font-family="Arial, sans-serif">${escapeXml(formatNumber(row.value))}</text>`);
  });
  lines.push("</svg>");
  return `${lines.join("\n")}\n`;
}

function addFailureCategory(map: Map<string, { count: number; suites: Set<string>; sourceFile: string; sourceField: string }>, args: {
  category: string;
  suite: string;
  sourceFile: string;
  sourceField: string;
}): void {
  const current = map.get(args.category) ?? { count: 0, suites: new Set<string>(), sourceFile: args.sourceFile, sourceField: args.sourceField };
  current.count += 1;
  current.suites.add(args.suite);
  map.set(args.category, current);
}

function listExistingLaneFiles(root: string, lanesRoot: string, fileName: string): string[] {
  return listDirs(lanesRoot)
    .map((dir) => join(dir.path, fileName))
    .filter((path) => existsSync(path))
    .map((path) => rel(root, path));
}

function assignIfExists<T extends Record<string, unknown>>(target: T, key: keyof T, root: string, path: string): void {
  if (existsSync(path)) target[key] = rel(root, path) as T[keyof T];
}

function listDirs(path: string): Array<{ name: string; path: string }> {
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJson(path: string, value: unknown): void {
  writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return percentValue(value);
}

function percentValue(value: number): number {
  return Math.abs(value) <= 1 ? Number((value * 100).toFixed(4)) : Number(value.toFixed(4));
}

function sumNumbers(values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return null;
  return Number(numbers.reduce((sum, value) => sum + value, 0).toFixed(6));
}

function averageNumbers(values: unknown[]): number | null {
  const numbers = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!numbers.length) return null;
  return Number((numbers.reduce((sum, value) => sum + value, 0) / numbers.length).toFixed(4));
}

function firstNumeric(row: ProofloopChartRow, keys: string[]): number | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function mtimeMs(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function rel(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeJs(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeXml(value: string): string {
  return escapeHtml(value);
}

function formatNumber(value: number): string {
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(3).replace(/\.?0+$/, "");
}
