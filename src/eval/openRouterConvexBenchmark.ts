import { existsSync, readFileSync } from "node:fs";

export type OpenRouterConvexRoute = {
  route: string;
  provider: "openrouter" | "native" | "internal_alias";
  label: string;
  promotion: string;
  suites: string[];
  notes?: string;
  evidence?: string;
  sourceTags?: string[];
};

export type OpenRouterConvexCaseStatus = "pass" | "blocked" | "missing";
export type OpenRouterConvexCaseScope = "openrouter_convex_harness" | "official_promotion";

export type OpenRouterConvexBenchmarkCase = {
  id: string;
  title: string;
  inspiredBy: Array<"SpreadsheetBench" | "SpreadsheetBench 2" | "BankerToolBench" | "NodeRoom">;
  scope: OpenRouterConvexCaseScope;
  status: OpenRouterConvexCaseStatus;
  evidence: string[];
  requiredConvexContract: string[];
  acceptance: string;
  blockers: string[];
};

export type OpenRouterConvexRoutePlan = {
  route: string;
  provider: "openrouter" | "internal_alias";
  label: string;
  role: "interactive_candidate" | "background_long_running_only" | "research_only";
  adapter: "convexModel.openrouter_chat_completions" | "convexModel.openrouter_free_auto";
  eligibleForConvexHarness: boolean;
  mustRunThroughAgentJobs: true;
  requiredContract: string[];
  evidence: string[];
  blockers: string[];
};

export type OfficialStyleSuiteId =
  | "spreadsheetbench_like"
  | "bankertoolbench_like"
  | "multi_user_conflict"
  | "provider_route_n5_p95";

export type OfficialStyleEvidenceStatus = "pass" | "blocked" | "missing" | "not_applicable";

export type OfficialStyleBenchmarkSuite = {
  id: OfficialStyleSuiteId;
  title: string;
  inspiredBy: Array<"SpreadsheetBench" | "SpreadsheetBench 2" | "BankerToolBench" | "NodeRoom">;
  status: OfficialStyleEvidenceStatus;
  acceptance: string;
  command: string;
  evidence: string[];
  metrics: Record<string, string | number | boolean>;
  blockers: string[];
};

export type RouteEvidenceCell = {
  status: OfficialStyleEvidenceStatus;
  evidence: string[];
  metrics: Record<string, string | number | boolean>;
  blockers: string[];
};

export type AgentRouteScorecard = {
  route: string;
  provider: OpenRouterConvexRoute["provider"];
  label: string;
  suites: string[];
  promotion: string;
  role: "interactive_promoted" | "interactive_candidate" | "background_long_running_only" | "research_only";
  promotionStatus: "promoted" | "candidate" | "background_only" | "blocked";
  adapter: "convexModel.openrouter_chat_completions" | "convexModel.openrouter_free_auto" | "convexModel.native_provider";
  evidence: {
    research: RouteEvidenceCell;
    collaborationLadder: RouteEvidenceCell;
    managedPathN5P95: RouteEvidenceCell;
    spreadsheetBenchN5: RouteEvidenceCell;
    bankerToolBenchLocal: RouteEvidenceCell;
    multiUserContract: RouteEvidenceCell;
  };
  blockers: string[];
};

export type OpenRouterConvexBenchmarkReport = {
  schema: 1;
  generatedAt?: string;
  summary: {
    routeCount: number;
    openRouterRouteCount: number;
    harnessCases: number;
    harnessCasesPassing: number;
    officialPromotionCases: number;
    officialPromotionCasesPassing: number;
    officialStyleSuites: number;
    officialStyleSuitesPassing: number;
    agentRouteCount: number;
    routesWithManagedN5P95: number;
    routesWithSpreadsheetN5: number;
    routesInteractivePromoted: number;
    topPaidOpenRouterRoutes: number;
    topPaidRoutesWithManagedN5P95: number;
    harnessReady: boolean;
    officialStyleSuitesReady: boolean;
    officialPromotionReady: boolean;
  };
  designPrinciples: string[];
  cases: OpenRouterConvexBenchmarkCase[];
  officialStyleSuites: OfficialStyleBenchmarkSuite[];
  routePlans: OpenRouterConvexRoutePlan[];
  routeScorecards: AgentRouteScorecard[];
};

const CONVEX_CONTRACT = [
  "agentJobs is the durable root for every benchmark run, including /ask and /free",
  "Convex actions call providers; browser/client_action never calls OpenRouter directly",
  "agentStepJournal records model input/output hashes before replay can skip duplicate provider calls",
  "agentOperationEvents counts query/action/mutation/model/tool/scheduler steps",
  "agentLeases fence slices and prevent duplicate workers from committing the same job",
  "mutationReceipts tie every canonical cell write to a job, tool call, baseVersion, and result",
  "artifact ids remain the system of record; provider file/cache ids are adapter metadata only",
  "CAS conflicts return as data, not thrown errors, so OpenRouter models can re-read and recover",
];

export function buildOpenRouterConvexBenchmarkReport(args: {
  routes: OpenRouterConvexRoute[];
  generatedAt?: string;
}): OpenRouterConvexBenchmarkReport {
  const cases = benchmarkCases();
  const officialStyleSuites = buildOfficialStyleSuites(args.routes);
  const harnessCases = cases.filter((item) => item.scope === "openrouter_convex_harness");
  const officialCases = cases.filter((item) => item.scope === "official_promotion");
  const harnessReady = harnessCases.every((item) => item.status === "pass");
  const routePlans = args.routes
    .filter((route) => route.provider === "openrouter" || route.provider === "internal_alias")
    .map((route) => routePlan(route, harnessReady));
  const routeScorecards = buildRouteScorecards(args.routes);
  const latestCheapRoutes = new Set(args.routes.filter(isLatestCheapOpenRouterRoute).map((route) => route.route));

  return {
    schema: 1,
    generatedAt: args.generatedAt,
    summary: {
      routeCount: args.routes.length,
      openRouterRouteCount: routePlans.length,
      harnessCases: harnessCases.length,
      harnessCasesPassing: harnessCases.filter((item) => item.status === "pass").length,
      officialPromotionCases: officialCases.length,
      officialPromotionCasesPassing: officialCases.filter((item) => item.status === "pass").length,
      officialStyleSuites: officialStyleSuites.length,
      officialStyleSuitesPassing: officialStyleSuites.filter((item) => item.status === "pass").length,
      agentRouteCount: routeScorecards.length,
      routesWithManagedN5P95: routeScorecards.filter((item) => item.evidence.managedPathN5P95.status === "pass").length,
      routesWithSpreadsheetN5: routeScorecards.filter((item) => item.evidence.spreadsheetBenchN5.status === "pass").length,
      routesInteractivePromoted: routeScorecards.filter((item) => item.role === "interactive_promoted").length,
      topPaidOpenRouterRoutes: latestCheapRoutes.size,
      topPaidRoutesWithManagedN5P95: routeScorecards.filter((item) => latestCheapRoutes.has(item.route) && item.evidence.managedPathN5P95.status === "pass").length,
      harnessReady,
      officialStyleSuitesReady: officialStyleSuites.every((item) => item.status === "pass"),
      officialPromotionReady: officialCases.every((item) => item.status === "pass"),
    },
    designPrinciples: [
      "OpenRouter is a provider adapter, not the runtime owner; Convex owns durable jobs, artifacts, leases, traces, and receipts.",
      "Benchmark-shaped work is routed through deterministic tools first, then bounded model edit plans, then evidence-bearing writes.",
      "Free-auto is a long-running/background lane until ladder and p95 evidence prove it can meet interactive collaboration budgets.",
      "Official benchmark claims stay blocked until the external verifier path is wired; internal Convex benchmark readiness is separate.",
      "The scorecard includes every configured agent LLM route from llmModelCatalog.agent, curated OpenRouter routes, and the current latest-cheap OpenRouter tool-capable candidate set.",
    ],
    cases,
    officialStyleSuites,
    routePlans,
    routeScorecards,
  };
}

function routePlan(route: OpenRouterConvexRoute, harnessReady: boolean): OpenRouterConvexRoutePlan {
  const isFreeAuto = route.route === "openrouter/free-auto";
  const supportsCollaboration = route.suites.includes("collaboration");
  const role = !supportsCollaboration
    ? "research_only"
    : isFreeAuto || route.promotion === "demo_only"
      ? "background_long_running_only"
      : "interactive_candidate";
  const blockers = [
    ...(!supportsCollaboration ? ["route is not ladder-tested for collaboration writes"] : []),
    ...(!harnessReady ? ["OpenRouter-on-Convex harness cases are not all passing"] : []),
    ...(role === "background_long_running_only" ? ["route needs N>=5 p95 ladder evidence before interactive promotion"] : []),
  ];
  return {
    route: route.route,
    provider: route.provider as "openrouter" | "internal_alias",
    label: route.label,
    role,
    adapter: isFreeAuto ? "convexModel.openrouter_free_auto" : "convexModel.openrouter_chat_completions",
    eligibleForConvexHarness: harnessReady && supportsCollaboration,
    mustRunThroughAgentJobs: true,
    requiredContract: CONVEX_CONTRACT,
    evidence: [route.evidence, "src/nodeagent/models/convexModel.ts", "convex/agentJobs.ts"].filter(Boolean) as string[],
    blockers,
  };
}

function buildOfficialStyleSuites(routes: OpenRouterConvexRoute[]): OfficialStyleBenchmarkSuite[] {
  const spreadsheet = spreadsheetBenchN5Report();
  const btb = bankerToolBenchLocalReport();
  const multiUser = readJson<{ summary?: { passed?: boolean; scenarios?: number; passedScenarios?: number } }>("docs/eval/multi-user-coordination-proof.json");
  const calibration = livePathCalibrationReport();
  const routeScorecards = buildRouteScorecards(routes);
  const calibratedRoutes = routeScorecards.filter((route) => route.evidence.managedPathN5P95.status === "pass");
  const spreadsheetPass = spreadsheetPasses(spreadsheet);
  const btbPass = btb?.passRate === 1 && (btb.taskCount ?? 0) > 0;
  const multiUserPass = multiUser?.summary?.passed === true;
  const allRoutesCalibrated = calibratedRoutes.length === routeScorecards.length && routeScorecards.length > 0;

  return [
    {
      id: "spreadsheetbench_like",
      title: "SpreadsheetBench-like workbook edit-plan tasks",
      inspiredBy: ["SpreadsheetBench", "SpreadsheetBench 2"],
      status: spreadsheetPass ? "pass" : spreadsheet ? "blocked" : "missing",
      acceptance: "At least three staged spreadsheet tasks run five repeats with passRate=1, sidecar evidence, local formula cache, p95 latency, and zero contamination.",
      command: "npm run benchmark:spreadsheetbench:run -- --mode model-edit-plan --repeats 5",
      evidence: ["docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json", "docs/eval/spreadsheetbench-v1-run-3task-n5-contamination-smoke.json"],
      metrics: spreadsheet ? {
        caseCount: spreadsheet.caseCount ?? 0,
        repeats: spreadsheet.repeatCount ?? 0,
        passRate: spreadsheet.passRate ?? 0,
        p95LatencyMs: spreadsheet.stats?.latencyMs?.p95 ?? 0,
        modelCalls: spreadsheet.harness?.budget?.modelCalls ?? 0,
        providerCostUsd: spreadsheet.harness?.budget?.providerCostUsd ?? 0,
      } : {},
      blockers: spreadsheetPass ? [] : ["Need a passing N=5 model-edit-plan run with caseCount>=3, repeatCount>=5, passRate=1, and sidecar evidence."],
    },
    {
      id: "bankertoolbench_like",
      title: "BankerToolBench-like package/verifier workflow",
      inspiredBy: ["BankerToolBench"],
      status: btbPass ? "pass" : btb ? "blocked" : "missing",
      acceptance: "A staged BTB-like task emits the expected deliverable package from agent-only files before evaluator metadata opens and local weighted scoring reaches 1.0.",
      command: "npm run benchmark:bankertoolbench:run -- --mode apply-agent-output",
      evidence: ["docs/eval/bankertoolbench-run-positive-smoke.json", "docs/eval/bankertoolbench-official-contract.json"],
      metrics: btb ? {
        taskCount: btb.taskCount ?? 0,
        passRate: btb.passRate ?? 0,
        averageWeightedScore: btb.averageWeightedScore ?? 0,
        verifier: btb.harness?.verifier ?? "unknown",
      } : {},
      blockers: btbPass ? [] : ["Need a passing local BTB-style candidate package and weighted-rubric smoke."],
    },
    {
      id: "multi_user_conflict",
      title: "Multi-user and agent conflict tasks",
      inspiredBy: ["NodeRoom", "SpreadsheetBench"],
      status: multiUserPass ? "pass" : multiUser ? "blocked" : "missing",
      acceptance: "Human-vs-human, agent-vs-human, blocked lock, stale base, and finally-release scenarios all end with conflict data and zero lock leaks.",
      command: "npm run eval:multiuser-coordination -- --strict",
      evidence: ["docs/eval/multi-user-coordination-proof.json", "evals/multiUserCoordinationProof.ts"],
      metrics: multiUser?.summary ? {
        scenarios: multiUser.summary.scenarios ?? 0,
        passedScenarios: multiUser.summary.passedScenarios ?? 0,
      } : {},
      blockers: multiUserPass ? [] : ["Run the multi-user coordination proof and clear failed scenarios."],
    },
    {
      id: "provider_route_n5_p95",
      title: "Provider route N=5/p95 path stability",
      inspiredBy: ["NodeRoom", "SpreadsheetBench", "BankerToolBench"],
      status: allRoutesCalibrated ? "pass" : calibratedRoutes.length > 0 ? "blocked" : "missing",
      acceptance: "Every route promoted for interactive benchmark-shaped writes has N>=5 live managed-path evidence with p95 model/tool calls, fingerprints, and zero invalid or missing tool results.",
      command: "npm run halo:live-path:calibrate -- --real <route> --repeats 5",
      evidence: ["docs/eval/halo-live-path-calibration.json"],
      metrics: {
        agentRoutes: routeScorecards.length,
        calibratedRoutes: calibratedRoutes.length,
        latestCalibratedRoute: calibration?.providerRoute ?? "none",
        latestP95ToolCalls: calibration?.summary?.p95ToolCalls ?? 0,
        latestP95ModelCalls: calibration?.summary?.p95ModelCalls ?? 0,
      },
      blockers: allRoutesCalibrated ? [] : [`${routeScorecards.length - calibratedRoutes.length} agent route(s) still need N=5/p95 live path evidence before interactive promotion.`],
    },
  ];
}

function buildRouteScorecards(routes: OpenRouterConvexRoute[]): AgentRouteScorecard[] {
  return dedupeRoutes(routes).map((route) => {
    const research = researchEvidence(route.route);
    const collaborationLadder = collaborationLadderEvidence(route.route);
    const managedPathN5P95 = managedPathEvidence(route.route);
    const spreadsheetBenchN5 = spreadsheetN5Evidence(route.route);
    const bankerToolBenchLocal = bankerToolBenchRouteEvidence(route.route);
    const multiUserContract = multiUserRouteEvidence();
    const blockers = [
      ...research.blockers,
      ...collaborationLadder.blockers,
      ...managedPathN5P95.blockers,
      ...spreadsheetBenchN5.blockers,
      ...bankerToolBenchLocal.blockers,
    ];
    const supportsCollaboration = route.suites.includes("collaboration");
    const role =
      !supportsCollaboration ? "research_only" :
      route.promotion === "demo_only" || route.route === "openrouter/free-auto" ? "background_long_running_only" :
      collaborationLadder.status === "pass" && managedPathN5P95.status === "pass" ? "interactive_promoted" :
      "interactive_candidate";
    const promotionStatus =
      role === "interactive_promoted" ? "promoted" :
      role === "background_long_running_only" ? "background_only" :
      blockers.length > 0 ? "blocked" :
      "candidate";

    return {
      route: route.route,
      provider: route.provider,
      label: route.label,
      suites: route.suites,
      promotion: route.promotion,
      role,
      promotionStatus,
      adapter: route.route === "openrouter/free-auto"
        ? "convexModel.openrouter_free_auto"
        : route.provider === "native"
          ? "convexModel.native_provider"
          : "convexModel.openrouter_chat_completions",
      evidence: {
        research,
        collaborationLadder,
        managedPathN5P95,
        spreadsheetBenchN5,
        bankerToolBenchLocal,
        multiUserContract,
      },
      blockers,
    };
  });
}

function benchmarkCases(): OpenRouterConvexBenchmarkCase[] {
  const latestLoop = readJson<{ steps?: Array<{ id?: string; status?: string }> }>("docs/eval/agent-improvement-loop/latest.json");
  const ladderPass = latestLoop?.steps?.some((step) => step.id === "collaboration-ladder" && step.status === "pass") === true;
  const multiUser = readJson<{ summary?: { passed?: boolean } }>("docs/eval/multi-user-coordination-proof.json");
  const v1Routes = readJson<{ taskCount?: number; routeCounts?: Record<string, number> }>("docs/eval/spreadsheetbench-v1-route-selection.json");
  const v2Routes = readJson<{ taskCount?: number; routeCounts?: Record<string, number> }>("docs/eval/spreadsheetbench-v2-route-selection.json");
  const chart = readJson<{ pass?: boolean; status?: string }>("docs/eval/spreadsheetbench-chart-visual-probe.json");
  const docker = readJson<{ pass?: boolean; status?: string }>("docs/eval/docker-sandbox-probe.json");
  const btb = readJson<{ pass?: boolean; status?: string; blockers?: string[] }>("docs/eval/bankertoolbench-official-contract.json");

  return [
    {
      id: "convex_job_journal_and_replay",
      title: "Durable model-step journaling before replay",
      inspiredBy: ["NodeRoom", "SpreadsheetBench", "BankerToolBench"],
      scope: "openrouter_convex_harness",
      status: existsSync("tests/agentJobsRuntime.test.ts") ? "pass" : "missing",
      evidence: ["tests/agentJobsRuntime.test.ts", "convex/agentStepJournal.ts", "convex/agentJobs.ts"],
      requiredConvexContract: [
        "createOrReuse idempotency",
        "model-step hash journal",
        "operation events",
        "attempt counters",
      ],
      acceptance: "A duplicate model step replays the recorded result and cannot overwrite the first output hash.",
      blockers: [],
    },
    {
      id: "convex_l1_l7_collaboration_ladder",
      title: "Lock/CAS/draft/large-range/resume ladder",
      inspiredBy: ["NodeRoom", "SpreadsheetBench"],
      scope: "openrouter_convex_harness",
      status: ladderPass ? "pass" : "blocked",
      evidence: ["docs/eval/agent-improvement-loop/latest.json", "evals/ladder.ts"],
      requiredConvexContract: [
        "read before write",
        "baseVersion CAS",
        "draft on blocked range",
        "bounded large-range context",
        "cold resume after slice death",
      ],
      acceptance: "The latest improvement loop records the collaboration ladder as PASS through L7.",
      blockers: ladderPass ? [] : ["Run npm run ladder -- --record and refresh docs/eval/agent-improvement-loop/latest.json."],
    },
    {
      id: "convex_multi_user_coordination",
      title: "Multi-user and human-vs-human coordination proof",
      inspiredBy: ["NodeRoom", "SpreadsheetBench"],
      scope: "openrouter_convex_harness",
      status: multiUser?.summary?.passed === true ? "pass" : "blocked",
      evidence: ["docs/eval/multi-user-coordination-proof.json", "evals/multiUserCoordinationProof.ts"],
      requiredConvexContract: [
        "runtime-managed range locks",
        "stale-write conflict data",
        "draft then smart-merge",
        "finally-release lock fencing",
      ],
      acceptance: "All recorded multi-user coordination scenarios pass with zero active lock leaks.",
      blockers: multiUser?.summary?.passed === true ? [] : ["Run npm run eval:multiuser-coordination."],
    },
    {
      id: "spreadsheetbench_route_contract",
      title: "SpreadsheetBench-shaped tasks route to deterministic tools or bounded model edit plans",
      inspiredBy: ["SpreadsheetBench", "SpreadsheetBench 2"],
      scope: "openrouter_convex_harness",
      status: routeReportsPass(v1Routes, v2Routes) ? "pass" : "blocked",
      evidence: [
        "docs/eval/spreadsheetbench-v1-route-selection.json",
        "docs/eval/spreadsheetbench-v2-route-selection.json",
        "src/eval/spreadsheetBenchRouteSelection.ts",
      ],
      requiredConvexContract: [
        "deterministic table transforms before model calls",
        "formula edit plans with deterministic formula-result cache",
        "format edit plans with workbook style diff evidence",
        "chart routes require rendered/VLM grade evidence",
      ],
      acceptance: "Staged route-selection reports have tasks, and blocked_chart_visual is zero.",
      blockers: routeReportsPass(v1Routes, v2Routes) ? [] : ["Regenerate SpreadsheetBench route selection and clear blocked_chart_visual."],
    },
    {
      id: "spreadsheetbench_chart_visual_grade",
      title: "Rendered chart visual grading lane",
      inspiredBy: ["SpreadsheetBench 2"],
      scope: "openrouter_convex_harness",
      status: chart?.pass === true && chart.status === "chart_visual_grade_proven" ? "pass" : "blocked",
      evidence: [
        "docs/eval/spreadsheetbench-chart-visual-probe.json",
        "docs/eval/spreadsheetbench-chart-visual/task-126/vlm-report.json",
        "scripts/spreadsheetbench-chart-visual-grade.ts",
      ],
      requiredConvexContract: [
        "workbook rendering is evaluator-side evidence",
        "Gemini/VLM judge is separate from OpenRouter candidate generation",
        "candidate/gold PNG hashes are recorded before visual acceptance",
      ],
      acceptance: "The chart visual probe records chart_visual_grade_proven with an accepted positive candidate and rejected negative control.",
      blockers: chart?.pass === true ? [] : ["Run npm run benchmark:spreadsheetbench:chart-visual:grade and probe --strict."],
    },
    {
      id: "docker_agent_workspace_isolation",
      title: "Official scorer workspace isolation",
      inspiredBy: ["SpreadsheetBench", "BankerToolBench"],
      scope: "official_promotion",
      status: docker?.pass === true && docker.status === "container_isolation_proven" ? "pass" : "blocked",
      evidence: ["docs/eval/docker-sandbox-probe.json", "src/eval/dockerSandboxProbe.ts"],
      requiredConvexContract: [
        "candidate generation sees only agent workspace mounts",
        "evaluator gold is denied until scoring phase",
        "network policy is explicit",
      ],
      acceptance: "Docker probe records container_isolation_proven with evaluator reads denied.",
      blockers: docker?.pass === true ? [] : ["Docker/Harbor isolation is required only for official score promotion; product-path Proof Loop runs stay valid without it."],
    },
    {
      id: "bankertoolbench_official_verifier_path",
      title: "BankerToolBench Harbor/MCP/Gandalf verifier path",
      inspiredBy: ["BankerToolBench"],
      scope: "official_promotion",
      status: btb?.pass === true ? "pass" : "blocked",
      evidence: ["docs/eval/bankertoolbench-official-contract.json", "src/eval/bankerToolBenchRunner.ts"],
      requiredConvexContract: [
        "official dataset manifest lock",
        "benchmark-defined MCP financial tools",
        "Harbor/Docker execution",
        "Gandalf score import",
      ],
      acceptance: "Official BTB contract imports verifier scores from the real Harbor/Gandalf path.",
      blockers: btb?.pass === true ? [] : btb?.blockers ?? ["BTB official contract artifact is missing."],
    },
  ];
}

function routeReportsPass(
  v1: { taskCount?: number; routeCounts?: Record<string, number> } | undefined,
  v2: { taskCount?: number; routeCounts?: Record<string, number> } | undefined,
): boolean {
  return Boolean(
    (v1?.taskCount ?? 0) > 0 &&
    (v2?.taskCount ?? 0) > 0 &&
    (v1?.routeCounts?.blocked_chart_visual ?? 1) === 0 &&
    (v2?.routeCounts?.blocked_chart_visual ?? 1) === 0,
  );
}

function dedupeRoutes(routes: OpenRouterConvexRoute[]): OpenRouterConvexRoute[] {
  const byRoute = new Map<string, OpenRouterConvexRoute>();
  for (const route of routes) byRoute.set(route.route, route);
  return [...byRoute.values()].sort((a, b) => providerRank(a.provider) - providerRank(b.provider) || a.route.localeCompare(b.route));
}

function providerRank(provider: OpenRouterConvexRoute["provider"]): number {
  if (provider === "openrouter") return 0;
  if (provider === "internal_alias") return 1;
  return 2;
}

function isLatestCheapOpenRouterRoute(route: OpenRouterConvexRoute): boolean {
  return route.provider === "openrouter" && (
    route.sourceTags?.includes("openrouter_latest_cheap_tools") === true ||
    route.sourceTags?.includes("openrouter_top_paid_tools") === true
  );
}

type ResearchReport = {
  models?: Array<{
    model?: string;
    requestedModel?: string;
    resolvedModel?: string;
    ok?: boolean;
    passed?: number;
    total?: number;
    ms?: number;
    costUsd?: number;
    toolCalls?: number;
    steps?: number;
    traceRef?: string;
  }>;
};

type LadderReport = {
  results?: Array<{
    requestedModel?: string;
    resolvedModel?: string;
    rung?: string;
    pass?: boolean;
    ms?: number;
    cost?: number;
    tools?: number;
    stopReason?: string;
  }>;
};

type SpreadsheetN5Report = {
  caseCount?: number;
  repeatCount?: number;
  passRate?: number;
  casePassRate?: number;
  attemptCount?: number;
  stats?: { latencyMs?: { p50?: number; p95?: number; max?: number }; failureCounts?: Record<string, number> };
  harness?: { budget?: { modelCalls?: number; inputTokens?: number; outputTokens?: number; providerCostUsd?: number } };
  results?: Array<{ model?: { name?: string; calls?: number; costUsd?: number } }>;
};

type BankerLocalReport = {
  taskCount?: number;
  passRate?: number;
  averageWeightedScore?: number;
  harness?: { verifier?: string };
};

type LivePathCalibration = {
  providerRoute?: string;
  pass?: boolean;
  status?: string;
  summary?: {
    runs?: number;
    uniqueFingerprintCount?: number;
    p95ModelCalls?: number;
    p95ToolCalls?: number;
    maxInvalidToolCalls?: number;
    maxMissingToolResults?: number;
  };
};

function researchEvidence(route: string): RouteEvidenceCell {
  const report = readJson<ResearchReport>("docs/eval/results.json");
  const row = report?.models?.find((item) => item.requestedModel === route || item.model === route || item.resolvedModel === route);
  if (!row) {
    return {
      status: "missing",
      evidence: ["docs/eval/results.json"],
      metrics: {},
      blockers: ["no company-research v3 evidence recorded for this route"],
    };
  }
  const status = row.ok === true && (row.total ?? 0) > 0 && row.passed === row.total ? "pass" : "blocked";
  return {
    status,
    evidence: ["docs/eval/results.json", row.traceRef].filter(Boolean) as string[],
    metrics: {
      passed: row.passed ?? 0,
      total: row.total ?? 0,
      ms: row.ms ?? 0,
      costUsd: row.costUsd ?? 0,
      toolCalls: row.toolCalls ?? 0,
      steps: row.steps ?? 0,
    },
    blockers: status === "pass" ? [] : ["research checks did not all pass for this route"],
  };
}

function collaborationLadderEvidence(route: string): RouteEvidenceCell {
  const report = readJson<LadderReport>("docs/eval/model-ladder-supported.json");
  const rows = report?.results?.filter((item) => item.requestedModel === route) ?? [];
  if (rows.length === 0) {
    return {
      status: "missing",
      evidence: ["docs/eval/model-ladder-supported.json"],
      metrics: {},
      blockers: ["no route-specific collaboration ladder evidence recorded"],
    };
  }
  const required = ["L1_read", "L2_edit", "L3_conflict", "L4_blocked"];
  const byRung = new Map(rows.map((row) => [row.rung, row]));
  const missing = required.filter((rung) => !byRung.has(rung));
  const failed = required.filter((rung) => byRung.get(rung)?.pass !== true);
  const status = missing.length === 0 && failed.length === 0 ? "pass" : "blocked";
  return {
    status,
    evidence: ["docs/eval/model-ladder-supported.json"],
    metrics: {
      rungs: rows.length,
      passCount: rows.filter((row) => row.pass === true).length,
      p95LatencyMs: percentile(rows.map((row) => row.ms ?? 0), 0.95),
      p95ToolCalls: percentile(rows.map((row) => row.tools ?? 0), 0.95),
      p95CostUsd: percentile(rows.map((row) => row.cost ?? 0), 0.95),
    },
    blockers: status === "pass" ? [] : [`ladder missing=${missing.join(",") || "none"} failed=${failed.join(",") || "none"}`],
  };
}

function managedPathEvidence(route: string): RouteEvidenceCell {
  const report = livePathCalibrationReport();
  if (!report || report.providerRoute !== route) {
    return {
      status: "missing",
      evidence: ["docs/eval/halo-live-path-calibration.json"],
      metrics: {},
      blockers: ["no N=5 live managed-path calibration recorded for this route"],
    };
  }
  const pass = report.pass === true && report.status === "calibrated";
  return {
    status: pass ? "pass" : "blocked",
    evidence: ["docs/eval/halo-live-path-calibration.json"],
    metrics: {
      runs: report.summary?.runs ?? 0,
      uniqueFingerprints: report.summary?.uniqueFingerprintCount ?? 0,
      p95ModelCalls: report.summary?.p95ModelCalls ?? 0,
      p95ToolCalls: report.summary?.p95ToolCalls ?? 0,
      maxInvalidToolCalls: report.summary?.maxInvalidToolCalls ?? 0,
      maxMissingToolResults: report.summary?.maxMissingToolResults ?? 0,
    },
    blockers: pass ? [] : [`managed-path calibration status is ${report.status ?? "unknown"}`],
  };
}

function spreadsheetN5Evidence(route: string): RouteEvidenceCell {
  const report = spreadsheetBenchN5Report();
  if (!report) {
    return {
      status: "missing",
      evidence: ["docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json"],
      metrics: {},
      blockers: ["no SpreadsheetBench-like N=5 report found"],
    };
  }
  const models = new Set((report.results ?? []).map((row) => row.model?.name).filter(Boolean));
  if (!models.has(route)) {
    return {
      status: "missing",
      evidence: ["docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json"],
      metrics: {
        recordedRoutes: [...models].join(", ") || "none",
      },
      blockers: ["no SpreadsheetBench-like N=5 model-edit evidence recorded for this route"],
    };
  }
  const pass = spreadsheetPasses(report);
  return {
    status: pass ? "pass" : "blocked",
    evidence: ["docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json"],
    metrics: {
      caseCount: report.caseCount ?? 0,
      repeats: report.repeatCount ?? 0,
      passRate: report.passRate ?? 0,
      p95LatencyMs: report.stats?.latencyMs?.p95 ?? 0,
      providerCostUsd: report.harness?.budget?.providerCostUsd ?? 0,
    },
    blockers: pass ? [] : ["SpreadsheetBench-like N=5 report exists for this route but does not meet the promotion bar"],
  };
}

function bankerToolBenchRouteEvidence(route: string): RouteEvidenceCell {
  const report = bankerToolBenchLocalReport();
  if (!report) {
    return {
      status: "missing",
      evidence: ["docs/eval/bankertoolbench-run-positive-smoke.json"],
      metrics: {},
      blockers: ["no BTB local smoke report found"],
    };
  }
  return {
    status: "missing",
    evidence: ["docs/eval/bankertoolbench-run-positive-smoke.json"],
    metrics: {
      route,
      localHarnessPassRate: report.passRate ?? 0,
      averageWeightedScore: report.averageWeightedScore ?? 0,
      verifier: report.harness?.verifier ?? "unknown",
    },
    blockers: ["BTB local smoke is harness/package evidence only; no route-owned candidate generation is recorded yet"],
  };
}

function multiUserRouteEvidence(): RouteEvidenceCell {
  const report = readJson<{ summary?: { passed?: boolean; scenarios?: number; passedScenarios?: number } }>("docs/eval/multi-user-coordination-proof.json");
  const pass = report?.summary?.passed === true;
  return {
    status: pass ? "pass" : report ? "blocked" : "missing",
    evidence: ["docs/eval/multi-user-coordination-proof.json"],
    metrics: report?.summary ? {
      scenarios: report.summary.scenarios ?? 0,
      passedScenarios: report.summary.passedScenarios ?? 0,
    } : {},
    blockers: pass ? [] : ["multi-user coordination proof is missing or failing"],
  };
}

function spreadsheetBenchN5Report(): SpreadsheetN5Report | undefined {
  return readJson<SpreadsheetN5Report>("docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json")
    ?? readJson<SpreadsheetN5Report>("docs/eval/spreadsheetbench-v1-model-edit-plan-n5-live-smoke.json");
}

function spreadsheetPasses(report: SpreadsheetN5Report | undefined): boolean {
  return Boolean(
    report &&
    (report.caseCount ?? 0) >= 3 &&
    (report.repeatCount ?? 0) >= 5 &&
    report.passRate === 1 &&
    (report.stats?.latencyMs?.p95 ?? 0) > 0 &&
    (report.harness?.budget?.modelCalls ?? 0) >= 5,
  );
}

function bankerToolBenchLocalReport(): BankerLocalReport | undefined {
  return readJson<BankerLocalReport>("docs/eval/bankertoolbench-run-positive-smoke.json");
}

function livePathCalibrationReport(): LivePathCalibration | undefined {
  return readJson<LivePathCalibration>("docs/eval/halo-live-path-calibration.json");
}

function percentile(values: number[], p: number): number {
  const clean = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (clean.length === 0) return 0;
  const index = Math.min(clean.length - 1, Math.ceil(clean.length * p) - 1);
  return clean[index];
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}
