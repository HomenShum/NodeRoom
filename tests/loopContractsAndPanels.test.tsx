import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { loopAttemptIndexes, loopAttemptV } from "../convex/loopAttempts";
import { loopPolicyIndexes, loopPolicyV, boundedLoopPolicyDefaults } from "../convex/loopPolicies";
import { loopRewardIndexes, loopRewardV } from "../convex/loopRewards";
import { LoopRewardPanel } from "../src/ui/trace/LoopRewardPanel";
import { TraceStorybook, type TraceStorybookEval, type TraceStorybookTrace } from "../src/ui/trace/TraceStorybook";

const reward = {
  taskCompletion: 1,
  evidenceGrounding: 1,
  artifactCorrectness: 1,
  visualClarity: 1,
  humanAcceptance: 1,
  costEfficiency: 0.9,
  latencyEfficiency: 0.8,
  safety: 1,
  total: 0.963,
};

describe("loop Convex contracts", () => {
  it("exports loop attempt, reward, and policy validators with trace indexes", () => {
    expect(loopAttemptV).toBeDefined();
    expect(loopRewardV).toBeDefined();
    expect(loopPolicyV).toBeDefined();
    expect(loopAttemptIndexes).toContain("by_trace");
    expect(loopRewardIndexes).toContain("by_trace");
    expect(loopPolicyIndexes).toContain("by_task_kind");
    expect(boundedLoopPolicyDefaults).toMatchObject({
      maxAttemptsCeiling: 5,
      requiresMaxCost: true,
      requiresMaxTime: true,
      requiresVerifier: true,
      requiresStopCondition: true,
    });
  });
});

describe("loop trace panels", () => {
  it("renders reward fields and lagging layers", () => {
    render(<LoopRewardPanel reward={reward} failureCategories={["context_pack"]} />);
    expect(screen.getByText("LoopRewardPanel")).toBeTruthy();
    expect(screen.getByLabelText("total reward").textContent).toBe("0.963");
    expect(screen.getByText("context_pack")).toBeTruthy();
  });

  it("renders every compact trace storybook atom from NodeTrace and NodeEval data", () => {
    const trace: TraceStorybookTrace = {
      runId: "run-1",
      userGoal: "Run proofloop suite",
      outerTrace: {
        url: "https://noderoom.live",
        screenshots: [{ label: "after", path: "screenshots/after.png" }],
        uiAssertions: [{ id: "cell-a1", expected: "A1 updated", observed: "pass", passed: true }],
      },
      innerTrace: {
        steps: [{ action: "verify", observation: "ok", toolName: "proofloop", costUsd: 0, latencyMs: 20 }],
      },
      artifacts: [{ artifactId: "node-eval", exportPath: "node-eval.json", reopenPassed: true }],
      reward,
    };
    const evalResult: TraceStorybookEval = {
      verifier: { hardPass: true, score: 100, minScore: 100, failReasons: [] },
      judge: { diagnosticSummary: "All required steps passed.", evidencePaths: ["trace.jsonl"] },
      reward: { ...reward, failureCategories: [] },
    };

    render(<TraceStorybook trace={trace} evalResult={evalResult} />);

    for (const atom of [
      "RoomHeaderAtom",
      "ChatMessageAtom",
      "ArtifactTabAtom",
      "SpreadsheetCellAtom",
      "EvidenceCardAtom",
      "SourceCaptureAtom",
      "FocusBoxAtom",
      "AgentToolAtom",
      "CostBadgeAtom",
      "VerdictBadgeAtom",
    ]) {
      expect(screen.getByText(atom)).toBeTruthy();
    }
    expect(screen.getByText("PASS")).toBeTruthy();
    expect(screen.getByText("https://noderoom.live")).toBeTruthy();
  });
});
