import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chooseNodeAgentRoute,
  contextBuilderForSurface,
  routeForTask,
  splitBulkCompanyBatches,
  computeRunway,
  buildDownstreamDiligenceDrafts,
  checkBaseVersion,
  toConvexMutationSpec,
} from "@nodeagent/index";

const requiredFiles = [
  "index.ts",
  "core/orchestrator.ts",
  "core/adaptiveRouter.ts",
  "core/contextCompactor.ts",
  "core/worldModel.ts",
  "core/formulaEngine.ts",
  "core/stateBridge.ts",
  "models/openRouterClient.ts",
  "models/piAiAdapter.ts",
  "skills/finance/bulkIngest.ts",
  "skills/finance/runwayForecaster.ts",
  "skills/finance/milestonePlanner.ts",
  "skills/search/linkupClient.ts",
  "skills/search/linkupTools.ts",
  "skills/spreadsheet/cellMutator.ts",
  "skills/spreadsheet/semanticRebase.ts",
  "skills/spreadsheet/versionControl.ts",
  "skills/integration/noderoomAdapter.ts",
  "skills/integration/downstreamPublish.ts",
  "skills/integration/omnigentAdapter.ts",
  "components/StreamingTerminal.tsx",
  "components/SmartGrid.tsx",
  "components/CellEditor.tsx",
  "components/RunwayChart.tsx",
  "components/LinkupSourceOverlay.tsx",
  "components/CostDashboard.tsx",
];

describe("src/nodeagent architecture surface", () => {
  it("keeps the review-requested source tree present", () => {
    for (const file of requiredFiles) {
      expect(existsSync(join(process.cwd(), "src", "nodeagent", file)), file).toBe(true);
    }
  });

  it("routes to the existing Convex-owned job runtime instead of a second runtime", () => {
    expect(routeForTask("interactive_chat").convexEntrypoint).toBe("agent.runRoomAgent");
    expect(routeForTask("free_auto_long_running").convexEntrypoint).toBe("agentJobRunner.runFreeAutoJobSlice");
    expect(splitBulkCompanyBatches(["a", "b", "c"], 2).map((b) => b.items)).toEqual([["a", "b"], ["c"]]);
  });

  it("exposes the world-model, routing, versioning, and downstream contracts", () => {
    expect(contextBuilderForSurface("company_research")).toBe("buildResearchContext");
    expect(chooseNodeAgentRoute({ task: "research", risk: "low", latency: "batch", freeAllowed: true }).model).toBe("openrouter/free-auto");
    expect(checkBaseVersion({ artifactId: "a", elementId: "c1", version: 4 }, 5)).toEqual({ ok: false, expected: 4, actual: 5 });
    expect(toConvexMutationSpec({ type: "tool.result", jobId: "j1", tool: "read_range", callId: "c1", ok: true, at: 1 }).module).toBe("agentStepJournal");
  });

  it("exposes finance diligence and downstream draft helpers", () => {
    const runway = computeRunway({ company: "Mercury", cashUsd: 1_200_000, monthlyBurnUsd: 100_000, source: "data room" });
    expect(runway.runwayMonths).toBe(12);
    const drafts = buildDownstreamDiligenceDrafts({
      company: "Mercury",
      summary: "Watch status with sourced runway assumptions.",
      evidenceUrls: ["https://example.com/source"],
      artifactIds: ["art_company_research"],
    });
    expect(drafts.map((d) => d.target)).toEqual(["csv", "gmail", "notion", "slack", "linear", "linkedin"]);
    expect(drafts[0].status).toBe("draft_ready");
  });
});
