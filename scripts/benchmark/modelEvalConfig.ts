import { getProviderForModel, llmModelCatalog, resolveModelAlias, type LlmProvider } from "../../src/nodeagent/models/modelCatalog";

export type ModelEvalSuite = "research" | "collaboration";
export type ModelPromotion =
  | "research_champion"
  | "candidate"
  | "demo_only"
  | "compatibility";

export type SupportedModelRoute = {
  route: string;
  provider: "openrouter" | "native" | "internal_alias";
  label: string;
  promotion: ModelPromotion;
  suites: ModelEvalSuite[];
  notes: string;
  evidence?: string;
  sourceTags?: string[];
};

export type ModelEvalScenario = {
  id: string;
  suite: ModelEvalSuite;
  label: string;
  gate: string;
  source: string;
};

export type ModelEvalCommand = {
  id: string;
  suite: ModelEvalSuite;
  description: string;
  command: string;
  args: string[];
  writes: string[];
  routes: string[];
};

export type ModelEvalPlanOptions = {
  suite?: ModelEvalSuite | "all";
  routeSet?: string;
  companies?: number;
  modelTimeoutMs?: number;
  modelReserveMs?: number;
  rowHardTimeoutMs?: number;
  rungTimeoutMs?: number;
  rungReserveMs?: number;
};

export const MODEL_EVAL_SCENARIOS: ModelEvalScenario[] = [
  {
    id: "company_research_v3",
    suite: "research",
    label: "Company research v3 composite synthesis",
    gate: "fetch_row_sources -> model-authored synthesis -> write_row; 9 deterministic/judge checks",
    source: "scripts/benchmark/run.ts",
  },
  {
    id: "collaboration_l1_read",
    suite: "collaboration",
    label: "L1 read-only no mutation",
    gate: "read exact target and produce no writes",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l2_cas_edit",
    suite: "collaboration",
    label: "L2 single-cell CAS edit",
    gate: "claim exact cell, read current version, write with CAS, release",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l3_conflict",
    suite: "collaboration",
    label: "L3 conflict recovery",
    gate: "observe conflict, re-read, retry without clobbering a human edit",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l4_blocked_draft",
    suite: "collaboration",
    label: "L4 blocked range drafts instead of forcing",
    gate: "denied lock becomes a draft with the target operation; no direct write while locked",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l5_large_range",
    suite: "collaboration",
    label: "L5 large range without full snapshot",
    gate: "600-row sheet: load only the narrow window (no full-sheet read, bounded context), touch only the target cell",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l6_long_horizon",
    suite: "collaboration",
    label: "L6 long horizon under compaction + conflicts",
    gate: "5 targets with 3 injected human conflicts and compacted context; fresh read provenance for every edit, no lock shortcut",
    source: "evals/ladder.ts",
  },
  {
    id: "collaboration_l7_resume",
    suite: "collaboration",
    label: "L7 resume after slice death",
    gate: "slice 1 dies mid-task (real exhaustion + handoff); a COLD slice 2 finishes only the remaining targets — completed work untouched, a human's between-slice revision left standing",
    source: "evals/ladder.ts",
  },
];

export const SUPPORTED_MODEL_ROUTES: SupportedModelRoute[] = [
  {
    route: "cohere/north-mini-code:free",
    provider: "openrouter",
    label: "Cohere North Mini Code free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/openrouter-free-model-discovery.json",
    notes: "Latest concrete $0 OpenRouter tool-capable route discovered from the live Models API; needs route-owned collaboration ladder evidence before shared-room promotion.",
  },
  {
    route: "deepseek/deepseek-v4-flash",
    provider: "openrouter",
    label: "DeepSeek V4 Flash",
    promotion: "research_champion",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Prior 3-company v3 research champion and still a cheap paid fallback; must clear the live collaboration ladder before interactive promotion.",
  },
  {
    route: "ibm-granite/granite-4.1-8b",
    provider: "openrouter",
    label: "IBM Granite 4.1 8B",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Cheapest paid route clearing the 2026-06-11 cheap/free smoke; test collaboration before write routing.",
  },
  {
    route: "z-ai/glm-4.7-flash",
    provider: "openrouter",
    label: "GLM 4.7 Flash",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Very low-cost OpenRouter candidate; cleared research smoke, still needs collaboration ladder evidence.",
  },
  {
    route: "inclusionai/ring-2.6-1t",
    provider: "openrouter",
    label: "inclusionAI Ring 2.6 1T",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Low-cost OpenRouter candidate that cleared the 2026-06-11 research smoke.",
  },
  {
    route: "xiaomi/mimo-v2.5",
    provider: "openrouter",
    label: "Xiaomi MiMo V2.5",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "OpenRouter live route candidate for low-cost research and agentic editing.",
  },
  {
    route: "stepfun/step-3.7-flash",
    provider: "openrouter",
    label: "StepFun Step 3.7 Flash",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Recent low-cost OpenRouter route that cleared the cheap/free research smoke.",
  },
  {
    route: "moonshotai/kimi-k2.7-code",
    provider: "openrouter",
    label: "Kimi K2.7 Code",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "Current cheap coding-focused OpenRouter route; evaluate source-grounded tool behavior before interactive promotion.",
  },
  {
    route: "minimax/minimax-m3",
    provider: "openrouter",
    label: "MiniMax M3",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Current MiniMax low-cost route replacing the older M2.7 candidate.",
  },
  {
    route: "deepseek/deepseek-v4-pro",
    provider: "openrouter",
    label: "DeepSeek V4 Pro",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Cheap higher-capability DeepSeek route; cleared research smoke but costs more than V4 Flash.",
  },
  {
    route: "google/gemini-3.1-flash-lite",
    provider: "openrouter",
    label: "Gemini 3.1 Flash Lite via OpenRouter",
    promotion: "candidate",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Low-cost OpenRouter route; research-only until collaboration tool behavior is proven.",
  },
  {
    route: "qwen/qwen3.7-plus",
    provider: "openrouter",
    label: "Qwen 3.7 Plus",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "OpenRouter live route candidate; evaluate synthesis quality and blocked-range behavior before use.",
  },
  {
    route: "nvidia/nemotron-3-ultra-550b-a55b",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Ultra",
    promotion: "candidate",
    suites: ["research", "collaboration"],
    notes: "High-capability OpenRouter route; include to test whether higher capability justifies latency/cost.",
  },
  {
    route: "nvidia/nemotron-3-ultra-550b-a55b:free",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Ultra free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/results.json",
    notes: "Free concrete route that cleared research smoke; live collaboration ladder still blocks interactive promotion.",
  },
  {
    route: "nvidia/nemotron-3-super-120b-a12b:free",
    provider: "openrouter",
    label: "NVIDIA Nemotron 3 Super free",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/free-auto-router-ladder.json",
    notes: "Free concrete route that clears research smoke but times out on blocked-range collaboration behavior.",
  },
  {
    route: "google/gemma-4-26b-a4b-it:free",
    provider: "openrouter",
    label: "Gemma 4 26B A4B free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Current free route from the live OpenRouter list; research-only until collaboration is tested.",
  },
  {
    route: "openai/gpt-oss-120b:free",
    provider: "openrouter",
    label: "GPT OSS 120B free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared research smoke; keep out of interactive writes until ladder-tested.",
  },
  {
    route: "poolside/laguna-xs.2:free",
    provider: "openrouter",
    label: "Poolside Laguna XS.2 free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared the cheap/free research smoke; research-only until ladder-tested.",
  },
  {
    route: "poolside/laguna-m.1:free",
    provider: "openrouter",
    label: "Poolside Laguna M.1 free",
    promotion: "demo_only",
    suites: ["research"],
    evidence: "docs/eval/results.json",
    notes: "Free route that cleared research smoke but was slower than the XS route.",
  },
  {
    route: "openrouter/free-auto",
    provider: "internal_alias",
    label: "OpenRouter free-auto alias",
    promotion: "demo_only",
    suites: ["research", "collaboration"],
    evidence: "docs/eval/free-auto-router-ladder.json",
    notes: "Internal NodeRoom alias that expands to current free routes; opt-in demo/background lane until it clears both gates.",
  },
  {
    route: "gemini-3.5-flash",
    provider: "native",
    label: "Gemini 3.5 Flash",
    promotion: "compatibility",
    suites: ["collaboration"],
    evidence: "docs/qa/production-matrix.json",
    notes: "Current Convex fallback route with recorded L1-L4 safety; keep as compatibility coverage.",
  },
];

const OPENROUTER_TOP_PAID_SOURCE =
  "OpenRouter Models API, 2026-06-24, latest cheap paid text routes with tools+tool_choice and input<=1.25/output<=4 USD per 1M tokens";

export const OPENROUTER_TOP_PAID_AGENT_ROUTES: SupportedModelRoute[] = [
  ["z-ai/glm-5.2", "GLM 5.2"],
  ["moonshotai/kimi-k2.7-code", "Kimi K2.7 Code"],
  ["nvidia/nemotron-3-ultra-550b-a55b", "NVIDIA Nemotron 3 Ultra"],
  ["qwen/qwen3.7-plus", "Qwen 3.7 Plus"],
  ["minimax/minimax-m3", "MiniMax M3"],
  ["stepfun/step-3.7-flash", "StepFun Step 3.7 Flash"],
  ["qwen/qwen3.7-max", "Qwen 3.7 Max"],
  ["x-ai/grok-build-0.1", "xAI Grok Build 0.1"],
  ["inclusionai/ring-2.6-1t", "inclusionAI Ring 2.6 1T"],
  ["google/gemini-3.1-flash-lite", "Gemini 3.1 Flash Lite via OpenRouter"],
  ["x-ai/grok-4.3", "Grok 4.3"],
  ["ibm-granite/granite-4.1-8b", "IBM Granite 4.1 8B"],
  ["poolside/laguna-xs.2", "Poolside Laguna XS.2"],
  ["poolside/laguna-m.1", "Poolside Laguna M.1"],
  ["qwen/qwen3.5-plus-20260420", "Qwen 3.5 Plus 20260420"],
  ["qwen/qwen3.6-flash", "Qwen 3.6 Flash"],
  ["qwen/qwen3.6-35b-a3b", "Qwen 3.6 35B A3B"],
  ["qwen/qwen3.6-27b", "Qwen 3.6 27B"],
  ["deepseek/deepseek-v4-pro", "DeepSeek V4 Pro"],
].map(([route, label]) => ({
  route,
  provider: "openrouter" as const,
  label,
  promotion: "candidate" as const,
  suites: ["research", "collaboration"],
  evidence: "docs/eval/openrouter-top-paid-tools-snapshot.json",
  sourceTags: ["openrouter_top_paid_tools", "openrouter_latest_cheap_tools"],
  notes: `${OPENROUTER_TOP_PAID_SOURCE}. Included in the scorecard and opt-in top-paid route set; not default-promoted until route-owned N=5/p95 and task-suite evidence pass.`,
}));

export const DEFAULT_RESEARCH_MODEL_ROUTES = [
  "cohere/north-mini-code:free",
  "qwen/qwen3.7-plus",
  "z-ai/glm-5.2",
  "moonshotai/kimi-k2.7-code",
];

export function allAgentLlmRoutes(): SupportedModelRoute[] {
  const byRoute = new Map<string, SupportedModelRoute>();
  for (const route of SUPPORTED_MODEL_ROUTES) byRoute.set(route.route, route);
  for (const route of OPENROUTER_TOP_PAID_AGENT_ROUTES) {
    const existing = byRoute.get(route.route);
    if (!existing) {
      byRoute.set(route.route, route);
    } else {
      byRoute.set(route.route, {
        ...existing,
        sourceTags: unique([...(existing.sourceTags ?? []), ...(route.sourceTags ?? [])]),
        notes: `${existing.notes} ${route.notes}`,
      });
    }
  }

  for (const provider of Object.keys(llmModelCatalog) as LlmProvider[]) {
    for (const rawModel of llmModelCatalog[provider].agent) {
      const route = resolveModelAlias(rawModel);
      if (byRoute.has(route)) continue;
      const resolvedProvider = getProviderForModel(route);
      byRoute.set(route, {
        route,
        provider: route === "openrouter/free-auto"
          ? "internal_alias"
          : provider === "openrouter" || resolvedProvider === "openrouter" && route.includes("/")
            ? "openrouter"
            : "native",
        label: `${provider} agent model: ${route}`,
        promotion: provider === "openrouter" ? "candidate" : "compatibility",
        suites: ["collaboration"],
        notes: "Included from llmModelCatalog.agent so the official-style scorecard covers every configured agent LLM route, not only the curated smoke set.",
      });
    }
  }

  return [...byRoute.values()];
}

export function routesForSuite(suite: ModelEvalSuite): string[] {
  return SUPPORTED_MODEL_ROUTES
    .filter((route) => route.suites.includes(suite))
    .map((route) => route.route);
}

export function resolveRouteSet(routeSet = "supported", suite: ModelEvalSuite | "all" = "all"): string[] {
  const selected = routeSet.trim();
  const eligible = (route: SupportedModelRoute) => suite === "all" || route.suites.includes(suite);
  if (selected === "supported" || selected === "all") {
    const suites = suite === "all" ? ["research", "collaboration"] as const : [suite];
    return unique(suites.flatMap((s) => routesForSuite(s)));
  }
  if (selected === "research") return routesForSuite("research");
  if (selected === "collaboration") return routesForSuite("collaboration");
  if (selected === "champions") {
    return SUPPORTED_MODEL_ROUTES
      .filter((route) => eligible(route) && (route.promotion === "research_champion" || route.promotion === "compatibility"))
      .map((route) => route.route);
  }
  if (selected === "free") {
    return SUPPORTED_MODEL_ROUTES
      .filter((route) => eligible(route) && route.promotion === "demo_only")
      .map((route) => route.route);
  }
  if (selected === "top-paid" || selected === "openrouter-top-paid") {
    return OPENROUTER_TOP_PAID_AGENT_ROUTES
      .filter(eligible)
      .map((route) => route.route);
  }
  return unique(selected.split(",").map((route) => route.trim()).filter(Boolean));
}

export function scenariosForSuite(suite: ModelEvalSuite | "all" = "all"): ModelEvalScenario[] {
  return suite === "all" ? MODEL_EVAL_SCENARIOS : MODEL_EVAL_SCENARIOS.filter((scenario) => scenario.suite === suite);
}

export function buildModelEvalCommands(options: ModelEvalPlanOptions = {}): ModelEvalCommand[] {
  const suite = options.suite ?? "all";
  const commands: ModelEvalCommand[] = [];
  const researchRoutes = suite === "collaboration" ? [] : resolveRouteSet(options.routeSet ?? "supported", "research");
  const collaborationRoutes = suite === "research" ? [] : resolveRouteSet(options.routeSet ?? "supported", "collaboration");
  if (researchRoutes.length > 0) {
    commands.push({
      id: "research_v3",
      suite: "research",
      description: "Run the v3 company-research synthesis benchmark across selected routes.",
      command: "tsx",
      args: [
        "scripts/benchmark/run.ts",
        researchRoutes.join(","),
        "--no-merge",
        `--companies=${options.companies ?? 3}`,
        `--model-timeout-ms=${options.modelTimeoutMs ?? 240_000}`,
        `--model-reserve-ms=${options.modelReserveMs ?? 10_000}`,
        `--row-hard-timeout-ms=${options.rowHardTimeoutMs ?? 270_000}`,
      ],
      writes: ["docs/eval/results.json", "docs/eval/traces/benchmark/"],
      routes: researchRoutes,
    });
  }
  if (collaborationRoutes.length > 0) {
    commands.push({
      id: "collaboration_l1_l7",
      suite: "collaboration",
      description: "Run the live L1-L7 collaboration ladder (lock/CAS/draft + scale, long-horizon, and resume-after-slice-death) across selected routes.",
      command: "tsx",
      args: [
        "evals/ladder.ts",
        "--real",
        collaborationRoutes.join(","),
        "--levels=1-7",
        `--rung-timeout-ms=${options.rungTimeoutMs ?? 540_000}`,
        `--reserve-ms=${options.rungReserveMs ?? 30_000}`,
        "--json-out",
        "docs/eval/model-ladder-supported.json",
      ],
      writes: ["docs/eval/model-ladder-supported.json"],
      routes: collaborationRoutes,
    });
  }
  return commands;
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}
