import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MODEL_EVAL_SCENARIOS,
  SUPPORTED_MODEL_ROUTES,
  buildModelEvalCommands,
  resolveRouteSet,
  routesForSuite,
} from "../scripts/benchmark/modelEvalConfig";

const root = process.cwd();

describe("supported model eval matrix", () => {
  it("pins the current supported route choices without hiding aliases as provider ids", () => {
    const routes = SUPPORTED_MODEL_ROUTES.map((route) => route.route);
    expect(new Set(routes).size).toBe(routes.length);
    expect(routes).toEqual(expect.arrayContaining([
      "cohere/north-mini-code:free",
      "deepseek/deepseek-v4-flash",
      "moonshotai/kimi-k2.7-code",
      "qwen/qwen3.7-plus",
      "nvidia/nemotron-3-ultra-550b-a55b",
      "openrouter/free-auto",
    ]));
    expect(SUPPORTED_MODEL_ROUTES.find((route) => route.route === "openrouter/free-auto")?.provider).toBe("internal_alias");
  });

  it("covers research synthesis and the collaboration safety ladder as separate gates", () => {
    const scenarioIds = MODEL_EVAL_SCENARIOS.map((scenario) => scenario.id);
    expect(scenarioIds).toContain("company_research_v3");
    expect(scenarioIds).toEqual(expect.arrayContaining([
      "collaboration_l1_read",
      "collaboration_l2_cas_edit",
      "collaboration_l3_conflict",
      "collaboration_l4_blocked_draft",
    ]));
    expect(MODEL_EVAL_SCENARIOS.find((scenario) => scenario.id === "company_research_v3")?.gate).toContain("model-authored synthesis");
    expect(MODEL_EVAL_SCENARIOS.find((scenario) => scenario.id === "collaboration_l4_blocked_draft")?.gate).toContain("no direct write");
  });

  it("builds executable commands for the all-suite dry-run matrix", () => {
    const commands = buildModelEvalCommands({ suite: "all", routeSet: "supported" });
    const research = commands.find((command) => command.id === "research_v3");
    const collaboration = commands.find((command) => command.id === "collaboration_l1_l7");

    expect(research?.command).toBe("tsx");
    expect(research?.args).toEqual(expect.arrayContaining([
      "scripts/benchmark/run.ts",
      "--no-merge",
      "--companies=3",
      "--model-timeout-ms=240000",
      "--model-reserve-ms=10000",
      "--row-hard-timeout-ms=270000",
    ]));
    expect(research?.routes).toEqual(routesForSuite("research"));

    expect(collaboration?.args).toEqual(expect.arrayContaining([
      "evals/ladder.ts",
      "--real",
      "--levels=1-7", // full ladder: L1-L4 protocol + L5 scale + L6 long-horizon + L7 resume-after-slice-death
      "--json-out",
      "docs/eval/model-ladder-supported.json",
    ]));
    expect(collaboration?.routes).toEqual(routesForSuite("collaboration"));
  });

  it("keeps champion route sets scoped to the requested suite", () => {
    expect(resolveRouteSet("champions", "research")).toEqual(["deepseek/deepseek-v4-flash"]);
    expect(resolveRouteSet("champions", "collaboration")).toEqual(["deepseek/deepseek-v4-flash", "gemini-3.5-flash"]);
    expect(resolveRouteSet("free", "research")).not.toContain("gemini-3.5-flash");
  });

  it("writes a checked-in matrix plan that docs can point to", () => {
    const planPath = join(root, "docs/eval/model-eval-matrix-plan.json");
    expect(existsSync(planPath)).toBe(true);
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as { routes: string[]; scenarios: Array<{ id: string }>; commands: Array<{ id: string }> };
    expect(plan.routes).toContain("deepseek/deepseek-v4-flash");
    expect(plan.scenarios.map((scenario) => scenario.id)).toContain("company_research_v3");
    expect(plan.commands.map((command) => command.id)).toEqual(["research_v3", "collaboration_l1_l7"]);
  });
});
