import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import type { Actor, CellPayload } from "../src/engine/types";
import { isWorkbookPreviewDoc, workbookPreviewArtifactFromDataUrl } from "../src/ui/panels/workbookFilePreview";

const actor: Actor = { kind: "agent", id: "agent", name: "Room NodeAgent", scope: "public" };

function payloadValue(value: unknown): unknown {
  return (value as CellPayload).value;
}

async function workbookDataUrl(): Promise<{ dataUrl: string; size: number }> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("BTB Package");
  sheet.getCell("A1").value = "label";
  sheet.getCell("B1").value = "enterprise_value";
  sheet.getCell("A2").value = "GOOGL";
  sheet.getCell("B2").value = 2430000;
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer() as ArrayBuffer);
  return {
    dataUrl: `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${buffer.toString("base64")}`,
    size: buffer.byteLength,
  };
}

describe("workbook file preview", () => {
  it("turns generated workbook data URLs into shared Sheet 1 grid artifacts", async () => {
    const { dataUrl, size } = await workbookDataUrl();
    const doc = {
      upload: true as const,
      fileName: "btb-a31173e3-googl-sum-of-the-parts-valuation.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size,
      dataUrl,
    };

    expect(isWorkbookPreviewDoc(doc)).toBe(true);
    const artifact = await workbookPreviewArtifactFromDataUrl(doc, "room1", actor, 123);

    expect(artifact).toBeTruthy();
    if (!artifact) throw new Error("expected workbook preview artifact");
    expect(artifact).toMatchObject({
      kind: "sheet",
      roomId: "room1",
      title: "btb-a31173e3-googl-sum-of-the-parts-valuation.xlsx",
      version: 1,
      updatedAt: 123,
      meta: {
        excelGrid: {
          parser: "exceljs:xlsx-grid",
          sheetName: "BTB Package",
        },
      },
    });
    expect(artifact.order).toContain("A1");
    expect(payloadValue(artifact.elements.A1.value)).toBe("label");
    expect(payloadValue(artifact.elements.B1.value)).toBe("enterprise_value");
    expect(payloadValue(artifact.elements.A2.value)).toBe("GOOGL");
    expect(payloadValue(artifact.elements.B2.value)).toBe(2430000);
  });

  it("does not treat non-workbook file documents as workbook previews", () => {
    expect(isWorkbookPreviewDoc({
      upload: true,
      fileName: "memo.pdf",
      mimeType: "application/pdf",
      size: 12,
      dataUrl: "data:application/pdf;base64,JVBERg==",
    })).toBe(false);
  });
});
