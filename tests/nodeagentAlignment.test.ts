import { describe, expect, it } from "vitest";
import { compactMessages } from "@nodeagent/core/contextCompactor";
import { evaluateFormula } from "@nodeagent/core/formulaEngine";
import { parseBulkCompanyIngest, splitBulkCompanyRecords } from "@nodeagent/skills/finance/bulkIngest";
import { computeRunway, runwayChartSvg } from "@nodeagent/skills/finance/runwayForecaster";
import { buildDownstreamDiligenceDrafts, createDiligenceDownstreamDrafts, type DownstreamArtifact } from "@nodeagent/skills/integration/downstreamPublish";

describe("src/nodeagent review-alignment surface", () => {
  it("keeps compaction and formula engine imports wired to real implementations", async () => {
    const formula = evaluateFormula("=SUM(A1:A2)", {
      getCell: (ref) => ref === "A1" ? 2 : 3,
    });
    expect(formula).toEqual({ value: 5 });

    const compacted = await compactMessages([
      { role: "user", content: "short" },
      { role: "assistant", content: "ok" },
    ], { maxChars: 10_000 });
    expect(compacted.compacted).toBe(false);
  });

  it("parses and batches startup diligence rows", () => {
    const rows = parseBulkCompanyIngest([
      "Company, Website, Tier, Intent, Owner, CRM Status",
      "Mercury, https://mercury.com, A, startup banking, Maya, Diligence",
      "Ramp, https://ramp.com, A, finance automation, Dev, Diligence",
    ].join("\n"));
    expect(rows.map((row) => row.company)).toEqual(["Mercury", "Ramp"]);
    expect(splitBulkCompanyRecords(rows, 1)).toHaveLength(2);
  });

  it("uses deterministic runway math and chart output from the nodeagent namespace", () => {
    const result = computeRunway({ company: "Mercury", cashUsd: 1_400_000, monthlyBurnUsd: 100_000 });
    expect(result.runwayMonths).toBe(14);
    expect(runwayChartSvg(result)).toContain("Mercury");
  });

  it("creates approval-gated downstream publish drafts", () => {
    const artifact: DownstreamArtifact = {
      id: "report_1",
      title: "Finance diligence packet",
      kind: "diligence_report",
      body: "Source-backed findings",
      sourceArtifactIds: ["sheet_1"],
      sourceUrls: ["https://example.com"],
      createdAt: 1_714_000_000_000,
    };
    const drafts = createDiligenceDownstreamDrafts(artifact, ["gmail", "notion", "crm_csv"]);
    expect(drafts.map((draft) => draft.destination)).toEqual(["gmail", "notion", "crm_csv"]);
    expect(drafts.find((draft) => draft.destination === "gmail")?.approvalRequired).toBe(true);
    expect(drafts.find((draft) => draft.destination === "crm_csv")?.status).toBe("ready");
  });

  // Moved from the deleted tests/nodeagentStructure.test.ts: this is the only test of buildDownstreamDiligenceDrafts.
  it("builds draft-ready downstream diligence drafts for every target", () => {
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

