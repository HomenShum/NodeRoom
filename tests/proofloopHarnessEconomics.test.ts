import { describe, expect, it } from "vitest";
import {
  buildProofloopHarnessEconomicsLedger,
  renderProofloopHarnessEconomicsMarkdown,
} from "../src/eval/proofloopHarnessEconomics";

describe("Proof Loop harness economics ledger", () => {
  it("tracks harness versions and separates proxy judges from official score claims", () => {
    const ledger = buildProofloopHarnessEconomicsLedger({
      root: process.cwd(),
      generatedAt: "test",
    });

    expect(ledger.schema).toBe("proofloop-harness-economics-v1");
    expect(ledger.summary.missingHarnessFiles).toBe(0);
    expect(ledger.summary.openRouterCandidates).toBeGreaterThan(0);
    expect(ledger.summary.proxyJudgeCandidates).toBeGreaterThan(0);
    expect(ledger.summary.cheaperProxyRoutesAvailable).toBe(true);
    expect(ledger.summary.acceptedOfficialScorerStillRequiredForOfficialClaims).toBe(true);
    expect(ledger.summary.officialJudgeCredentialsStillRequiredForOfficialClaims).toBe(false);

    expect(ledger.harnessFiles.map((file) => file.path)).toEqual(expect.arrayContaining([
      "scripts/proofloop.mjs",
      "scripts/proofloop-harness-economics.ts",
      "proofloop/cockpit/playwrightOverlay.ts",
      "src/eval/proofloopCompanyTaskCoverage.ts",
      "src/eval/proofloopHarnessEconomics.ts",
    ]));

    expect(ledger.openRouterSnapshot.deepseekV4Pro?.id).toBe("deepseek/deepseek-v4-pro");
    expect(ledger.openRouterSnapshot.deepseekV4Pro?.supportsTools).toBe(true);

    const lanes = ledger.officialScoreBoundaries.map((boundary) => boundary.lane);
    expect(lanes).toEqual(expect.arrayContaining([
      "spreadsheetbench-v1",
      "spreadsheetbench-v2",
      "finch",
      "finauditing",
      "workstreambench",
    ]));
    for (const boundary of ledger.officialScoreBoundaries) {
      expect(boundary.proxyJudgeAllowedForProofLoop).toBe(true);
      expect(boundary.proxyJudgeCannotClaimOfficialScore).toBe(true);
      expect(boundary.recommendedProxyRoute).toBeTruthy();
    }

    expect(ledger.policy.join(" ")).toContain("Proxy judges can keep product Proof Loop moving");
    expect(ledger.recommendations.join(" ")).toContain("Do not block product iteration on Azure/OpenAI judge credentials");

    const markdown = renderProofloopHarnessEconomicsMarkdown(ledger);
    expect(markdown).toContain("DeepSeek V4 Pro");
    expect(markdown).toContain("Official Score Boundaries");
    expect(markdown).toContain("Accepted official scorer still required");
  });
});
