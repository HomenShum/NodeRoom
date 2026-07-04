import { describe, expect, it } from "vitest";
import {
  buildExternalAdapterBlockerReceipt,
  externalAdapterIds,
} from "../src/eval/proofloopAdapterBlockers";

describe("Proof Loop external adapter blocker receipts", () => {
  it("tracks every registered external official-score adapter", () => {
    expect(externalAdapterIds()).toEqual(["finch", "finauditing", "workstreambench"]);
  });

  it("writes a typed blocker receipt for Finch official-score imports after local implementation exists", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "finch" });

    expect(receipt).toMatchObject({
      schema: "proofloop-external-adapter-blocker-v1",
      adapterId: "finch",
      status: "blocked_external",
      localImplementationStatus: "ready",
      officialScoreStatus: "blocked_external",
      verifierCommand: "npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
    });
    expect(receipt.missingImplementationFiles).toEqual([]);
    expect(receipt.blockers.join(" ")).toContain("official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external");
    expect(receipt.blockers.join(" ")).toContain("scored receipt is still required before claiming score");
    expect(receipt.blockers.join(" ")).not.toContain("official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is missing");
    expect(receipt.officialCommandPlan.join(" ")).toContain("upstream Finch");
    expect(receipt.resumeCommands).toContain("npm run benchmark:proofloop:adapter-blockers -- --id finch");
  });

  it("keeps WorkstreamBench blocked only on official bundle/scorer import", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "workstreambench" });

    expect(receipt.status).toBe("blocked_external");
    expect(receipt.localImplementationStatus).toBe("ready");
    expect(receipt.missingImplementationFiles).toEqual([]);
    expect(receipt.blockers.join(" ")).toContain("workstreambench: official scorer receipt");
    expect(receipt.blockers.join(" ")).toContain("official task bundle lock docs/eval/proofloop-official-task-bundles/workstreambench.json is missing");
    expect(receipt.blockers.join(" ")).toContain("no public official bundle/scorer/rubric URL was found");
    expect(receipt.officialCommandPlan.join(" ")).toContain("official WorkstreamBench scorer");
    expect(receipt.officialSourceUrls).toContain("https://arxiv.org/html/2605.22664v1");
  });
});
