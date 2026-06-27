import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { createBtbDeliverablePackageTool } from "../src/nodeagent/skills/bankerCoach/btbPackageTool";
import type { ArtifactRef, RoomTools } from "../src/nodeagent/core/types";

describe("create_btb_deliverable_package", () => {
  it("creates the required downloadable BTB package file artifacts", async () => {
    const created: Array<{ fileName: string; mimeType: string; size: number; dataUrl?: string; text?: string }> = [];
    const rt = {
      createFileArtifacts: async ({ files }) => {
        created.push(...files);
        return {
          ok: true as const,
          artifacts: files.map((file, index): ArtifactRef => ({ id: `art-${index}`, title: file.fileName, kind: "note" })),
        };
      },
    } as RoomTools;

    const result = await createBtbDeliverablePackageTool.execute({
      taskId: "btb-test",
      title: "Software stock performance",
      narrative: "Indexed performance package created from fetched source data.",
      rows: [
        { label: "2024-01", values: { ADBE: 100, MSFT: 100 } },
        { label: "2024-02", values: { ADBE: 95.2, MSFT: 104.8 } },
      ],
      sourceUrls: ["https://query1.finance.yahoo.com/v8/finance/chart/MSFT"],
      sourceArtifactIds: ["source-model"],
    }, rt);

    expect(result).toMatchObject({ ok: true });
    expect(created.map((file) => file.fileName).sort()).toEqual([
      "btb-test-software-stock-performance-manifest.json",
      "btb-test-software-stock-performance.docx",
      "btb-test-software-stock-performance.pdf",
      "btb-test-software-stock-performance.pptx",
      "btb-test-software-stock-performance.xlsm",
      "btb-test-software-stock-performance.xlsx",
    ]);
    for (const file of created.filter((item) => item.fileName !== "btb-test-software-stock-performance-manifest.json")) {
      expect(file.size, file.fileName).toBeGreaterThan(200);
      expect(file.dataUrl, file.fileName).toMatch(/^data:/);
    }
    const docx = created.find((file) => file.fileName.endsWith(".docx"));
    if (!docx?.dataUrl) throw new Error("expected generated docx data URL");
    const zip = await JSZip.loadAsync(dataUrlBuffer(docx.dataUrl));
    const documentXml = await zip.file("word/document.xml")?.async("text");
    expect(documentXml).toContain("2024-01 — ADBE: 100 · MSFT: 100");
    expect(documentXml).not.toContain("ADBE=100");
    expect(created.find((file) => file.fileName.endsWith("-manifest.json"))?.text).toContain("source-model");
  });

  it("rejects placeholder packages instead of emitting benchmark-looking files", async () => {
    const created: Array<{ fileName: string }> = [];
    const rt = {
      createFileArtifacts: async ({ files }) => {
        created.push(...files);
        return {
          ok: true as const,
          artifacts: files.map((file, index): ArtifactRef => ({ id: `art-${index}`, title: file.fileName, kind: "note" })),
        };
      },
    } as RoomTools;

    const result = await createBtbDeliverablePackageTool.execute({
      taskId: "btb-test",
      title: "DCF package",
      narrative: "Source values could not be fully retrieved; reviewer can populate confirmed values later.",
      rows: [
        { label: "WACC result", values: { status: "needs_review", value: "TBD" } },
      ],
      sourceArtifactIds: ["source-model"],
    }, rt);

    expect(result).toMatchObject({ ok: false, error: "btb_package_quality_gate_failed" });
    expect(created).toHaveLength(0);
  });

  it("rejects exact generic title and narrative placeholders", async () => {
    const created: Array<{ fileName: string }> = [];
    const rt = {
      createFileArtifacts: async ({ files }) => {
        created.push(...files);
        return {
          ok: true as const,
          artifacts: files.map((file, index): ArtifactRef => ({ id: `art-${index}`, title: file.fileName, kind: "note" })),
        };
      },
    } as RoomTools;

    const result = await createBtbDeliverablePackageTool.execute({
      taskId: "btb-test",
      title: "test",
      narrative: "test 2",
      rows: [
        { label: "DCF output", values: { wacc: "12.0%", implied_share_price: 81.26 } },
      ],
      sourceArtifactIds: ["source-model"],
    }, rt);

    expect(result).toMatchObject({
      ok: false,
      error: "btb_package_quality_gate_failed",
      reasons: expect.arrayContaining([
        "generic_placeholder:title",
        "generic_placeholder:narrative",
      ]),
    });
    expect(created).toHaveLength(0);
  });

  it("rejects composite placeholder package names that include task ids", async () => {
    const created: Array<{ fileName: string }> = [];
    const rt = {
      createFileArtifacts: async ({ files }) => {
        created.push(...files);
        return {
          ok: true as const,
          artifacts: files.map((file, index): ArtifactRef => ({ id: `art-${index}`, title: file.fileName, kind: "note" })),
        };
      },
    } as RoomTools;

    const result = await createBtbDeliverablePackageTool.execute({
      taskId: "btb-5495a5a9",
      title: "btb-5495a5a9-test",
      narrative: "btb-b957a435-temp package",
      rows: [
        { label: "DCF output", values: { wacc: "12.0%", implied_share_price: 81.26 } },
      ],
      sourceArtifactIds: ["source-model"],
    }, rt);

    expect(result).toMatchObject({
      ok: false,
      error: "btb_package_quality_gate_failed",
      reasons: expect.arrayContaining([
        "generic_placeholder:title",
        "generic_placeholder:narrative",
      ]),
    });
    expect(created).toHaveLength(0);
  });

  it("rejects packages that only contain descriptive company metadata", async () => {
    const created: Array<{ fileName: string }> = [];
    const rt = {
      createFileArtifacts: async ({ files }) => {
        created.push(...files);
        return {
          ok: true as const,
          artifacts: files.map((file, index): ArtifactRef => ({ id: `art-${index}`, title: file.fileName, kind: "note" })),
        };
      },
    } as RoomTools;

    const result = await createBtbDeliverablePackageTool.execute({
      taskId: "btb-test",
      title: "Comparable set",
      narrative: "Comparable company set assembled from source artifacts.",
      rows: [
        { label: "Comparable Company Set", values: { Company: "Adobe Inc.", Ticker: "ADBE", Sector: "Technology" } },
        { label: "Comparable Company Set", values: { Company: "Microsoft Corporation", Ticker: "MSFT", Sector: "Technology" } },
      ],
      sourceArtifactIds: ["source-model"],
    }, rt);

    expect(result).toMatchObject({
      ok: false,
      error: "btb_package_quality_gate_failed",
      reasons: expect.arrayContaining(["quantitative_values_required"]),
    });
    expect(created).toHaveLength(0);
  });

  it("rejects Alphabet BTB packages that are WACC-only instead of DCF/SOTP domain proof", async () => {
    const created: Array<{ fileName: string }> = [];
    const rt = {
      createFileArtifacts: async ({ files }) => {
        created.push(...files);
        return {
          ok: true as const,
          artifacts: files.map((file, index): ArtifactRef => ({ id: `art-${index}`, title: file.fileName, kind: "note" })),
        };
      },
    } as RoomTools;

    const result = await createBtbDeliverablePackageTool.execute({
      taskId: "btb-a31173e3",
      title: "Alphabet Inc. WACC Analysis and Valuation Framework",
      narrative: "WACC calculation for Alphabet using beta, ERP, risk-free rate, and after-tax cost of debt.",
      rows: [
        { label: "WACC", values: { beta: 1.05, erp: "4.3%", wacc: "8.6%" } },
      ],
      sourceArtifactIds: ["source-model"],
    }, rt);

    expect(result).toMatchObject({
      ok: false,
      error: "btb_package_quality_gate_failed",
      reasons: expect.arrayContaining([
        "domain_proof_missing:dcf_sotp_method",
        "domain_proof_missing:operating_model_periods",
        "domain_proof_missing:segment_level_model",
        "domain_proof_missing:valuation_output",
      ]),
    });
    expect(created).toHaveLength(0);
  });
});

function dataUrlBuffer(dataUrl: string): Buffer {
  const base64 = dataUrl.split(",", 2)[1];
  if (!base64) throw new Error("invalid data URL");
  return Buffer.from(base64, "base64");
}
