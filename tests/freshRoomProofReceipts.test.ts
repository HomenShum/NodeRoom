import { describe, expect, it } from "vitest";
import {
  buildFinanceDomainReceipt,
  buildFreshRoomProofRegistry,
} from "../src/eval/freshRoomProofReceipts";

describe("fresh-room proof receipt registry", () => {
  it("keeps FR-020 finance, FR-020A selective BTB, and FR-020B full-suite claims separate", () => {
    const registry = buildFreshRoomProofRegistry({ generatedAt: "test" });
    const cases = Object.fromEntries(registry.cases.map((item) => [item.id, item]));

    expect(registry.policy.join(" ")).toContain("may not be collapsed");
    expect(registry.summary.financeDomainGatePassed).toBe(true);
    expect(registry.summary.selectiveBankerToolBenchReady).toBe(false);
    expect(registry.summary.bankerToolBenchFullSuiteReady).toBe(false);
    expect(registry.summary.liveBrowserBenchmarkReady).toBe(false);

    expect(Object.keys(cases)).toEqual(["FR-020", "FR-020A", "FR-020B"]);
    expect(cases["FR-020"]).toMatchObject({
      lane: "finance_domain_gate",
      status: "passed",
    });
    expect(cases["FR-020"].doesNotProve).toEqual(expect.arrayContaining([
      "official BankerToolBench score",
      "export/download and reopen proof",
      "full 100-task BankerToolBench suite completion",
    ]));

    expect(cases["FR-020A"]).toMatchObject({
      lane: "bankertoolbench_selective_task",
      status: "partial",
    });
    expect(cases["FR-020A"].gates.find((gate) => gate.id === "fresh_room_ui")?.status).toBe("blocked");
    expect(cases["FR-020A"].gates.find((gate) => gate.id === "official_verifier")?.status).toBe("blocked");

    expect(cases["FR-020B"]).toMatchObject({
      lane: "bankertoolbench_full_suite",
      status: "blocked",
    });
    expect(cases["FR-020B"].gates.every((gate) => gate.status === "blocked")).toBe(true);
  });

  it("documents that the FR-020 finance receipt is not a live-browser benchmark proof", () => {
    const receipt = buildFinanceDomainReceipt({ generatedAt: "test" });
    const gates = Object.fromEntries(receipt.gates.map((gate) => [gate.id, gate]));

    expect(receipt.status).toBe("passed");
    expect(receipt.claimBoundary).toContain("not a live-browser official BankerToolBench score");
    expect(gates.professional_runtime_cases.status).toBe("pass");
    expect(gates.managed_write_coordination.status).toBe("pass");
    expect(gates.live_browser.status).toBe("blocked");
    expect(gates.export_reopen.status).toBe("blocked");
    expect(gates.official_scorer.status).toBe("blocked");
  });
});
