import { describe, expect, it } from "vitest";
import {
  buildProofloopCompanyTaskCoverageReport,
  renderProofloopCompanyTaskCoverageMarkdown,
} from "../src/eval/proofloopCompanyTaskCoverage";

describe("Proof Loop company task coverage ledger", () => {
  it("tracks company-named task archetypes without claiming closed third-party app tests", () => {
    const report = buildProofloopCompanyTaskCoverageReport({
      root: process.cwd(),
      generatedAt: "test",
    });

    expect(report.schema).toBe("proofloop-company-task-coverage-v1");
    expect(report.summary.entries).toBeGreaterThanOrEqual(7);
    expect(report.summary.taskTypesTracked).toBeGreaterThan(20);

    const ids = report.entries.map((entry) => entry.id);
    expect(ids).toEqual(expect.arrayContaining([
      "proximitty-commercial-lending",
      "generic-ai-underwriting",
      "liveflow-accounting-fpa",
      "rogo-finance-research-copilot",
      "jpm-ask-david-research-agent",
      "external-finance-benchmark-adapters",
    ]));

    const liveflow = report.entries.find((entry) => entry.id === "liveflow-accounting-fpa");
    expect(liveflow?.taskTypes).toEqual(expect.arrayContaining([
      "account reconciliation",
      "journal entry drafting",
      "spreadsheet FP&A reporting",
    ]));
    expect(liveflow?.prodBrowserProof.command).toContain("BENCH_BASE_URL=https://noderoom.live");

    const jpm = report.entries.find((entry) => entry.id === "jpm-ask-david-research-agent");
    expect(jpm?.externalTargetStatus).toBe("closed_external");
    expect(jpm?.officialOrExternalClaim.status).toBe("blocked_external");
    expect(jpm?.officialOrExternalClaim.blockers.join(" ")).toContain("internal/closed JPM system");

    const external = report.entries.find((entry) => entry.id === "external-finance-benchmark-adapters");
    expect(external?.prodBrowserProof.command).toContain("benchmark:proofloop:external-adapter");
    expect(external?.officialOrExternalClaim.blockers.join(" ")).toContain("proxy judges");

    const markdown = renderProofloopCompanyTaskCoverageMarkdown(report);
    expect(markdown).toContain("Proof Loop Company Task Coverage");
    expect(markdown).toContain("LiveFlow-style accounting");
    expect(markdown).toContain("JPM Ask David-style");
  });
});
