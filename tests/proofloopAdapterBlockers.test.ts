import { describe, expect, it } from "vitest";
import {
  buildExternalAdapterBlockerReceipt,
  externalAdapterIds,
} from "../src/eval/proofloopAdapterBlockers";

describe("Proof Loop external adapter blocker receipts", () => {
  it("tracks every registered external official-score adapter", () => {
    expect(externalAdapterIds()).toEqual(["finch", "finauditing", "workstreambench"]);
  });

  it("writes ready Finch status after the hash-bound canonical judge receipt is imported", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "finch" });

    expect(receipt).toMatchObject({
      schema: "proofloop-external-adapter-blocker-v1",
      adapterId: "finch",
      status: "ready",
      localImplementationStatus: "ready",
      officialScoreStatus: "imported",
      verifierCommand: "npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
    });
    expect(receipt.missingImplementationFiles).toEqual([]);
    expect(receipt.blockers).toEqual([]);
    expect(receipt.officialCommandPlan.join(" ")).toContain("upstream Finch");
    expect(receipt.resumeCommands).toContain("npm run benchmark:proofloop:adapter-blockers -- --id finch");
    expect(receipt.officialScoreReadiness?.boundary).toMatchObject({
      productPath: {
        status: "complete",
        officialScoreClaim: false,
      },
      proxy: {
        status: "proxy_only",
        officialScoreClaim: false,
      },
      officialScorer: {
        status: "accepted",
        officialScoreClaim: true,
      },
    });
    expect(receipt.officialScoreReadiness?.officialScoreClaimable).toBe(true);
    expect(receipt.officialScoreReadiness?.acceptedExternalScorerKind).toBe("finch_canonical_judge");
    expect(receipt.officialScoreReadiness?.blockers).toEqual([]);
  });

  it("writes ready FinAuditing status after the accepted full FinMR judge receipt", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "finauditing" });

    expect(receipt).toMatchObject({
      schema: "proofloop-external-adapter-blocker-v1",
      adapterId: "finauditing",
      status: "ready",
      localImplementationStatus: "ready",
      officialScoreStatus: "imported",
    });
    expect(receipt.missingImplementationFiles).toEqual([]);
    expect(receipt.officialScoreReadiness?.boundary.productPath.status).toBe("complete");
    expect(receipt.officialScoreReadiness?.boundary.proxy.status).toBe("proxy_only");
    expect(receipt.officialScoreReadiness?.boundary.officialScorer.status).toBe("accepted");
    expect(receipt.officialScoreReadiness?.officialScoreClaimable).toBe(true);
    expect(receipt.officialScoreReadiness?.blockers).toEqual([]);
    expect(receipt.officialCommandPlan.join(" ")).toContain("FinMR");
  });

  it("writes ready WorkstreamBench status after all 38 MBABench judge receipts are imported", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "workstreambench" });

    expect(receipt.status).toBe("ready");
    expect(receipt.localImplementationStatus).toBe("ready");
    expect(receipt.officialScoreStatus).toBe("imported");
    expect(receipt.missingImplementationFiles).toEqual([]);
    expect(receipt.blockers).toEqual([]);
    expect(receipt.officialCommandPlan.join(" ")).toContain("official MBABench judge");
    expect(receipt.officialSourceUrls).toEqual(expect.arrayContaining([
      "https://arxiv.org/abs/2605.22664",
      "https://github.com/namkoong-lab/MBABench",
      "https://huggingface.co/datasets/namkoong-lab/mbabench-modeloff",
      "https://mbabench.org",
    ]));
    expect(receipt.evidence).toContain("docs/eval/proofloop-official-task-bundles/workstreambench.json");
    expect(receipt.evidence).toContain("docs/eval/proofloop-official-outputs/workstreambench.json");
  });
});
