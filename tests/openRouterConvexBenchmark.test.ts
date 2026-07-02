import { describe, expect, it } from "vitest";
import { buildOpenRouterConvexBenchmarkReport } from "../src/eval/openRouterConvexBenchmark";
import { OPENROUTER_TOP_PAID_AGENT_ROUTES, SUPPORTED_MODEL_ROUTES, allAgentLlmRoutes, resolveRouteSet } from "../scripts/benchmark/modelEvalConfig";

describe("OpenRouter-on-Convex benchmark contract", () => {
  it("separates harness readiness from official benchmark promotion", () => {
    const report = buildOpenRouterConvexBenchmarkReport({
      routes: SUPPORTED_MODEL_ROUTES,
      generatedAt: "test",
    });

    expect(report.summary.openRouterRouteCount).toBeGreaterThan(10);
    expect(report.summary.harnessCases).toBeGreaterThanOrEqual(5);
    expect(report.summary.harnessReady).toBe(true);
    expect(report.summary.harnessCasesPassing).toBe(report.summary.harnessCases);
    expect(report.summary.officialPromotionReady).toBe(false);
    expect(report.summary.officialStyleSuites).toBe(4);
    expect(report.summary.officialStyleSuitesReady).toBe(false);
    expect(report.cases.find((item) => item.id === "docker_agent_workspace_isolation")).toMatchObject({
      scope: "official_promotion",
      status: "blocked",
    });
    expect(report.cases.find((item) => item.id === "bankertoolbench_official_verifier_path")).toMatchObject({
      scope: "official_promotion",
      status: "blocked",
    });
  });

  it("keeps OpenRouter models behind Convex jobs instead of browser/provider shortcuts", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: SUPPORTED_MODEL_ROUTES });
    const route = report.routePlans.find((item) => item.route === "deepseek/deepseek-v4-flash");

    expect(route).toMatchObject({
      provider: "openrouter",
      adapter: "convexModel.openrouter_chat_completions",
      eligibleForConvexHarness: true,
      mustRunThroughAgentJobs: true,
    });
    expect(route?.blockers).not.toContain("OpenRouter-on-Convex harness cases are not all passing");
    expect(route?.requiredContract).toEqual(expect.arrayContaining([
      expect.stringContaining("agentJobs"),
      expect.stringContaining("Convex actions call providers"),
      expect.stringContaining("mutationReceipts"),
    ]));
  });

  it("keeps free-auto in the long-running lane until p95 ladder evidence promotes it", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: SUPPORTED_MODEL_ROUTES });
    const freeAuto = report.routePlans.find((item) => item.route === "openrouter/free-auto");

    expect(freeAuto).toMatchObject({
      provider: "internal_alias",
      adapter: "convexModel.openrouter_free_auto",
      role: "background_long_running_only",
      eligibleForConvexHarness: true,
    });
    expect(freeAuto?.blockers).not.toContain("OpenRouter-on-Convex harness cases are not all passing");
    expect(freeAuto?.blockers).toContain("route needs N>=5 p95 ladder evidence before interactive promotion");
  });

  it("maps benchmark-shaped cases to concrete Convex runtime evidence", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: SUPPORTED_MODEL_ROUTES });
    const cases = Object.fromEntries(report.cases.map((item) => [item.id, item]));

    expect(cases.convex_job_journal_and_replay.requiredConvexContract).toContain("model-step hash journal");
    expect(cases.convex_l1_l7_collaboration_ladder.requiredConvexContract).toContain("cold resume after slice death");
    expect(cases.spreadsheetbench_route_contract.requiredConvexContract).toContain("formula edit plans with deterministic formula-result cache");
    expect(cases.spreadsheetbench_chart_visual_grade.requiredConvexContract).toContain("candidate/gold PNG hashes are recorded before visual acceptance");
    expect(cases.docker_agent_workspace_isolation.requiredConvexContract).toContain("evaluator gold is denied until scoring phase");
  });

  it("turns the internal harness into official-style benchmark families without claiming official scores", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: allAgentLlmRoutes(), generatedAt: "test" });
    const suites = Object.fromEntries(report.officialStyleSuites.map((item) => [item.id, item]));

    expect(suites.spreadsheetbench_like).toMatchObject({
      status: "pass",
      command: expect.stringContaining("benchmark:spreadsheetbench:run"),
    });
    expect(suites.bankertoolbench_like).toMatchObject({
      status: "pass",
      command: expect.stringContaining("benchmark:bankertoolbench:run"),
    });
    expect(suites.multi_user_conflict).toMatchObject({
      status: "pass",
    });
    expect(suites.provider_route_n5_p95).toMatchObject({
      status: "blocked",
    });
    expect(suites.provider_route_n5_p95.blockers[0]).toContain("agent route(s) still need N=5/p95");
  });

  it("includes every configured agent LLM route in the route scorecard", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: allAgentLlmRoutes() });
    const routes = report.routeScorecards.map((item) => item.route);

    expect(routes).toEqual(expect.arrayContaining([
      "z-ai/glm-5.2",
      "moonshotai/kimi-k2.7-code",
      "qwen/qwen3.7-plus",
      "minimax/minimax-m3",
      "gpt-5.4",
      "claude-sonnet-4-6",
      "gemini-3.1-pro-preview",
      "grok-4-1-fast-reasoning",
      "openrouter/free-auto",
    ]));
    expect(report.summary.agentRouteCount).toBe(routes.length);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("includes current latest-cheap OpenRouter candidates without making them the default live sweep", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: allAgentLlmRoutes() });
    const routes = report.routeScorecards.map((item) => item.route);

    expect(report.summary.topPaidOpenRouterRoutes).toBe(OPENROUTER_TOP_PAID_AGENT_ROUTES.length);
    expect(routes).toEqual(expect.arrayContaining([
      "z-ai/glm-5.2",
      "moonshotai/kimi-k2.7-code",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "qwen/qwen3.7-plus",
      "minimax/minimax-m3",
    ]));
    expect(resolveRouteSet("top-paid", "collaboration")).toContain("moonshotai/kimi-k2.7-code");
    expect(resolveRouteSet("top-paid", "collaboration")).not.toContain("anthropic/claude-opus-4.8");
    expect(resolveRouteSet("supported", "collaboration")).not.toContain("x-ai/grok-build-0.1");
  });

  it("keeps route promotion tied to route-owned N=5/p95 evidence", () => {
    const report = buildOpenRouterConvexBenchmarkReport({ routes: allAgentLlmRoutes() });
    const deepseek = report.routeScorecards.find((item) => item.route === "deepseek/deepseek-v4-flash");
    const gptNano = report.routeScorecards.find((item) => item.route === "gpt-5.4-nano");

    expect(deepseek?.evidence.managedPathN5P95).toMatchObject({
      status: "pass",
      metrics: expect.objectContaining({ runs: 5, p95ToolCalls: 3 }),
    });
    expect(deepseek?.evidence.spreadsheetBenchN5.status).toBe("missing");
    expect(gptNano?.evidence.spreadsheetBenchN5).toMatchObject({
      status: "pass",
      metrics: expect.objectContaining({ repeats: 5, passRate: 1 }),
    });
    expect(gptNano?.evidence.managedPathN5P95.status).toBe("missing");
  });
});
