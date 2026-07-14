import { describe, expect, it } from "vitest";
import {
  buildOfficialScorePreflightReceipt,
  OFFICIAL_SCORE_PREFLIGHT_COMMAND,
  OFFICIAL_SCORE_PREFLIGHT_REFRESH_COMMAND,
  renderOfficialScorePreflightMarkdown,
} from "../src/eval/proofloopOfficialScorePreflight";

describe("ProofLoop official-score preflight", () => {
  it("requires a free-first economics receipt before expensive official lane runs", () => {
    const receipt = buildOfficialScorePreflightReceipt({
      root: process.cwd(),
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(receipt.schema).toBe("proofloop-official-score-preflight-v1");
    expect(receipt.status).toBe("pass");
    expect(receipt.paidProviderCalls).toBe(false);
    expect(receipt.preflightExecution).toEqual({
      providerCallsAttempted: false,
      paidProviderCalls: false,
      providerSpendUsd: 0,
    });
    expect(receipt.acceptedOfficialScoreReceipts.count).toBeGreaterThanOrEqual(3);
    expect(receipt.acceptedOfficialScoreReceipts.paidProviderCalls).toBe(true);
    expect(receipt.acceptedOfficialScoreReceipts.providerSpendUsd).toBeGreaterThan(7);
    expect(receipt.acceptedOfficialScoreReceipts.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ adapterId: "finch", provider: "openai", judgeModel: "gpt-5-mini" }),
      ]),
    );
    expect(receipt.officialBenchmarkScoreClaim).toBe(false);
    expect(receipt.requiredBeforeExpensiveLaneRuns).toBe(true);
    expect(receipt.command).toBe(OFFICIAL_SCORE_PREFLIGHT_COMMAND);
    expect(receipt.refreshCommand).toBe(OFFICIAL_SCORE_PREFLIGHT_REFRESH_COMMAND);
    expect(receipt.refreshCommand).toContain("free-model-gauge -- --skip-live --strict");
    expect(receipt.summary.freeGaugeEstimatedCostUsd).toBe(0);
    expect(receipt.summary.freeRoutesDiscovered).toBeGreaterThan(0);
    expect(receipt.summary.proxyJudgeCandidates).toBeGreaterThan(0);
    expect(receipt.checks.every((check) => check.status === "pass")).toBe(true);

    const finch = receipt.lanes.find((lane) => lane.lane === "finch");
    expect(finch?.safeNextCommand).toBe(`${OFFICIAL_SCORE_PREFLIGHT_COMMAND} && npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`);
    expect(finch?.checklist.join(" ")).toContain("proxy judge evidence");

    const markdown = renderOfficialScorePreflightMarkdown(receipt);
    expect(markdown).toContain("Preflight paid provider calls: no");
    expect(markdown).toContain("Accepted scorer receipt spend:");
    expect(markdown).toContain("Accepted Scorer Receipts");
    expect(markdown).toContain("Blocker Checklist");
    expect(markdown).toContain(OFFICIAL_SCORE_PREFLIGHT_COMMAND);
  });
});
