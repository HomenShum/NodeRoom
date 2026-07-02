import { describe, expect, it } from "vitest";
import {
  buildExternalAdapterBlockerReceipt,
  externalAdapterIds,
} from "../src/eval/proofloopAdapterBlockers";

describe("Proof Loop external adapter blocker receipts", () => {
  it("tracks every registered external official-score adapter", () => {
    expect(externalAdapterIds()).toEqual(["finch", "finauditing", "workstreambench"]);
  });

  it("writes a typed blocker receipt for missing Finch implementation files", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "finch" });

    expect(receipt).toMatchObject({
      schema: "proofloop-external-adapter-blocker-v1",
      adapterId: "finch",
      status: "blocked_external",
      verifierCommand: "npm run benchmark:proofloop:adapter-blockers -- --id finch --strict",
    });
    expect(receipt.missingImplementationFiles).toEqual([
      "proofloop/benchmarks/finch/load-tasks.ts",
      "proofloop/benchmarks/finch/browser-scenario.spec.ts",
    ]);
    expect(receipt.officialCommandPlan.join(" ")).toContain("upstream Finch");
    expect(receipt.resumeCommands).toContain("npm run benchmark:proofloop:adapter-blockers -- --id finch");
  });

  it("keeps WorkstreamBench blocked until official bundle/scorer files are implemented", () => {
    const receipt = buildExternalAdapterBlockerReceipt({ id: "workstreambench" });

    expect(receipt.status).toBe("blocked_external");
    expect(receipt.blockers.join(" ")).toContain("workstreambench: missing implementation file");
    expect(receipt.officialCommandPlan.join(" ")).toContain("official WorkstreamBench scorer");
    expect(receipt.officialSourceUrls).toContain("https://arxiv.org/html/2605.22664v1");
  });
});
