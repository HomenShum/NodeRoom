import { describe, expect, it } from "vitest";
import {
  buildProofReleaseBundle,
  renderReadmeProofRelease,
  renderSocialProofRelease,
  type ProofReleaseInputs,
} from "../src/eval/proofReleasePublishing";

describe("proof release publishing", () => {
  it("holds README and social completion claims while an external scorer or gate is pending", () => {
    const bundle = buildProofReleaseBundle(fixture(false));
    const readme = renderReadmeProofRelease(bundle);
    const social = renderSocialProofRelease(bundle);

    expect(bundle.publication).toMatchObject({ status: "pending_external", publishable: false, gateStatus: "blocked_external" });
    expect(bundle.publication.blockers.join(" ")).toContain("Finch / FinWorkBench");
    expect(readme).toContain("70/912 official pass");
    expect(readme).toContain("candidate proxy 89/912");
    expect(readme).toContain("0/321 official pass");
    expect(readme).toContain("Not claimed");
    expect(readme).toContain("episodes/noderoom-proof-release-v1/renders/teaser.gif");
    expect(readme).toContain("Visual judge: publish, 16/16");
    expect(readme).toContain("docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md");
    expect(readme).toContain("Six-persona fresh-user dogfood: 6/6 passed");
    expect(bundle.assets).toContainEqual({
      label: "Fresh-user vertical receipt",
      path: "docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md",
    });
    expect(social).toContain("HOLD - NOT A COMPLETION RELEASE");
    expect(social).toContain("Fresh-user vertical receipt");
    expect(social).toContain("coverage is not quality");
  });

  it("becomes publishable only when exact coverage, validation, every scorer, and the gate pass", () => {
    const bundle = buildProofReleaseBundle(fixture(true));
    expect(bundle.publication).toMatchObject({ status: "certified", publishable: true, gateStatus: "passed", blockers: [] });
    expect(bundle.results.external.find((item) => item.id === "finch")).toMatchObject({
      status: "scored",
      expected: 172,
      completed: 172,
      provider: "openai",
    });
    expect(bundle.results.spreadsheets.find((item) => item.id === "spreadsheetbench-v1")).toMatchObject({
      status: "official_scored",
      measurementSource: "accepted_official_scorer_receipt",
      passCount: 70,
      cases: 912,
      candidateProxy: { passCount: 89, cases: 912 },
    });
    expect(renderSocialProofRelease(bundle)).toContain("Publication gate: **PUBLISH**");
    expect(bundle.results.personaDogfood).toMatchObject({ status: "passed", count: 6, consoleErrors: 0 });
    expect(bundle.mediaReview).toMatchObject({ verdict: "publish", score: "16/16" });
  });

  it("holds publication when a required accepted SpreadsheetBench receipt is absent", () => {
    const input = fixture(true);
    input.spreadsheetReports[0].officialReceipt = undefined;
    const bundle = buildProofReleaseBundle(input);

    expect(bundle.publication.publishable).toBe(false);
    expect(bundle.publication.blockers).toContain("SpreadsheetBench V1 accepted official scorer receipt is pending.");
  });
});

function fixture(certified: boolean): ProofReleaseInputs {
  const modelResult = (taskId: string, model: string, costUsd = 0) => ({
    taskId,
    model: { name: model, calls: 1, usage: { inputTokens: 10, outputTokens: 2 }, costUsd },
  });
  return {
    generatedAt: "2026-07-10T00:00:00.000Z",
    packageVersion: "0.1.1",
    gitCommit: "abc123",
    goalLedger: { goals: [{ goalId: "official-scores", status: certified ? "passed" : "blocked_external" }] },
    coverage: {
      schema: 1,
      summary: {
        strictFullCoverageReady: true,
        totalOfficialExpectedTasks: 1739,
        totalStagedTasks: 1739,
        totalModelRunCases: 1733,
        completeTracks: 5,
        tracks: 5,
      },
    },
    spreadsheetReports: [
      {
        id: "spreadsheetbench-v1", title: "SpreadsheetBench V1", path: "v1.json", officialRequired: true,
        officialReceiptPath: "v1-official.json",
        officialReceipt: spreadsheetOfficialReceipt("spreadsheetbench-v1", { averageOverall: 0.09612573, passRate: 0.07675439, passCount: 70, scoredTaskCount: 912 }),
        report: { caseCount: 912, passCount: 89, passRate: 0.097588, averageOverall: 0.335084, results: [modelResult("1", "free")] },
      },
      { id: "spreadsheetbench-verified-400", title: "SpreadsheetBench Verified400", path: "v400.json", report: { caseCount: 400, passCount: 14, passRate: 0.035, averageOverall: 0.259266, results: [modelResult("1", "free")] } },
      {
        id: "spreadsheetbench-v2", title: "SpreadsheetBench V2", path: "v2.json", officialRequired: true,
        officialReceiptPath: "v2-official.json",
        officialReceipt: spreadsheetOfficialReceipt("spreadsheetbench-v2", { averageOverall: 0, passRate: 0, passCount: 0, scoredTaskCount: 321 }),
        report: { caseCount: 321, passCount: 0, passRate: 0, averageOverall: 0.523337, results: [modelResult("1", "paid", 0.01)] },
      },
    ],
    officialScores: [
      {
        id: "finauditing", title: "FinAuditing", path: "fin.json", expectedCount: 332, unit: "FinMR rows", output: { outputTaskCount: 1102, officialTaskCount: 1102 },
        receipt: { schema: "score-v1", status: "scored", scoreClaim: true, acceptedExternalScorerReceipt: { accepted: true, provider: "openai", judgeModel: "gpt-5-mini", receiptSha256: "a", finMr: { judgedRows: 332 } }, scores: { FinRE: { macro_f1: 0.16 }, FinMR: { usage: { estimatedProviderCostUsd: 0.04 } } } },
      },
      {
        id: "workstreambench", title: "MBABench", path: "mba.json", expectedCount: 38, unit: "cases", output: { outputTaskCount: 38, officialTaskCount: 38 },
        receipt: { schema: "score-v1", status: "scored", scoreClaim: true, acceptedExternalScorerReceipt: { accepted: true, provider: "google", judgeModel: "gemini", receiptSha256: "b", completedCases: 38 }, officialMetrics: { meanScore: 11.5, providerCostUsd: 6.67 } },
      },
      {
        id: "finch", title: "Finch / FinWorkBench", path: "finch.json", expectedCount: 172, unit: "tasks", output: { outputTaskCount: 172, officialTaskCount: 172 },
        receipt: certified
          ? { schema: "score-v1", status: "scored", scoreClaim: true, acceptedExternalScorerReceipt: { accepted: true, provider: "openai", judgeModel: "gpt-5-mini", receiptSha256: "c", taskCount: 172 }, scores: { meanScore: 0.8, providerCostUsd: 1 } }
          : { schema: "score-v1", status: "blocked_external", scoreClaim: false, blockers: ["Canonical judge pending"] },
      },
    ],
    validation: { schema: "validation-v1", status: "passed", tests: { files: 305, cases: 2055 }, build: "passed" },
    personaDogfood: {
      schemaVersion: 1,
      personas: ["analyst", "researcher", "finance-operator", "founder", "reviewer", "guest-observer"].map((persona) => ({
        persona,
        label: persona,
        freshLanding: true,
        route: "scripted/test",
        userVisibleSteps: 10,
        agentLatencyMs: 1000,
        export: { kind: "json" },
        screenshot: `docs/release/media/persona-${persona}.png`,
        consoleErrors: [],
      })),
      gates: {
        freshLanding: "passed",
        nodeAgent: "passed",
        mutation: "passed",
        conflictHandling: "passed",
        evidenceReview: "passed",
        export: "passed",
        consoleErrors: 0,
      },
    },
    mediaJudge: {
      verdict: "publish",
      defects: [],
      scores: Object.fromEntries(["state_clarity", "caption_sync", "pacing", "audio", "legibility", "proof_feel", "safety", "restraint"].map((id) => [id, { score: 2, evidence: "passed" }])),
    },
  };
}

function spreadsheetOfficialReceipt(track: string, score: Record<string, number>) {
  return {
    schema: 1,
    verifier: "spreadsheetbench_official_scorer",
    track,
    accepted: true,
    score,
  };
}
