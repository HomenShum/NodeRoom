import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { parseSpreadsheetArtifacts } from "../src/app/spreadsheetParser";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { RoomEngine } from "../src/engine/roomEngine";
import type { Actor, CellPayload } from "../src/engine/types";

function payloadValue(value: unknown) {
  return (value as CellPayload).value;
}

describe("spreadsheet parser", () => {
  it("parses CSV into a dataframe artifact with evidence-bearing cells", async () => {
    const [artifact] = await parseSpreadsheetArtifacts({
      fileName: "accounts.csv",
      mimeType: "text/csv",
      size: 42,
      text: "Company,Score\nAcme,High\nGlobex,Medium\n",
    });

    expect(artifact.title).toBe("accounts.csv");
    expect(artifact.kind).toBe("sheet");
    expect(artifact.meta?.dataframe?.columns.map((c) => c.label)).toEqual(["Company", "Score"]);
    expect(artifact.meta?.dataframe?.rowCount).toBe(2);
    expect(payloadValue(artifact.seed.find((s) => s.id === "u1__company")?.value)).toBe("Acme");
    expect((artifact.seed.find((s) => s.id === "u1__company")?.value as CellPayload).evidence?.[0]?.kind).toBe("upload");
  });

  it("parses each XLSX worksheet into a separate Excel grid artifact with cell addresses", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("PitchBook");
    first.addRow(["Company", "PBId", "Score"]);
    first.addRow(["Acme AI", "pb-1", "High"]);
    first.getCell("E7").value = 100;
    first.getCell("F7").value = { formula: "E7*1.1", result: 110 };
    const second = workbook.addWorksheet("Rubric");
    second.addRow(["Company", "Tier"]);
    second.addRow(["Globex", "A"]);
    const buffer = await workbook.xlsx.writeBuffer();

    const artifacts = await parseSpreadsheetArtifacts({
      fileName: "corpus.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.byteLength,
      arrayBuffer: buffer,
    });

    expect(artifacts.map((a) => a.title)).toEqual(["corpus.xlsx / PitchBook", "corpus.xlsx / Rubric"]);
    expect(artifacts[0].meta?.excelGrid).toMatchObject({ sheetName: "PitchBook", rows: 7, columns: 6 });
    expect(artifacts[0].meta?.dataframe?.sheetNames).toEqual(["PitchBook", "Rubric"]);
    expect(artifacts[0].meta?.dataframe?.columns.map((c) => c.label)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(payloadValue(artifacts[0].seed.find((s) => s.id === "B2")?.value)).toBe("pb-1");
    expect(payloadValue(artifacts[1].seed.find((s) => s.id === "B2")?.value)).toBe("A");
    expect((artifacts[0].seed.find((s) => s.id === "F7")?.value as CellPayload).formula).toBe("=E7*1.1");
    expect((artifacts[0].seed.find((s) => s.id === "F7")?.value as CellPayload).evidence?.[0]?.label).toContain("PitchBook!F7");
  });

  it("keeps uploaded XLSX cells addressable to room tools as Excel coordinates", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Model");
    sheet.addRow(["Metric", "FY2025"]);
    sheet.addRow(["Revenue", 100]);
    sheet.getCell("F7").value = { formula: "B2*1.1", result: 110 };
    const buffer = await workbook.xlsx.writeBuffer();
    const [uploaded] = await parseSpreadsheetArtifacts({
      fileName: "model.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.byteLength,
      arrayBuffer: buffer,
    });

    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Finance model", hostName: "Jordan", autoAllow: true });
    const hostActor: Actor = { kind: "user", id: host.id, name: host.name };
    const artifact = engine.createArtifact({
      roomId: room.id,
      kind: uploaded.kind,
      title: uploaded.title,
      seed: uploaded.seed,
      meta: uploaded.meta,
      by: hostActor,
    });
    const agent: Actor = { kind: "agent", id: "agent", name: "NodeAgent", scope: "public" };
    const session = engine.startSession({ roomId: room.id, agentId: agent.id, agentName: agent.name, scope: "public" });
    const tools = new InMemoryRoomTools(engine, room.id, artifact.id, agent, session.id);

    const [f7] = await tools.readRange(["F7"]);
    expect(payloadValue(f7.value)).toBe(110);
    expect((f7.value as CellPayload).formula).toBe("=B2*1.1");

    const [aliasedF7] = await tools.readRange(["7__F"]);
    expect(aliasedF7.id).toBe("F7");
    expect(payloadValue(aliasedF7.value)).toBe(110);

    const hits = await tools.searchSheetContext("Revenue");
    expect(hits.some((hit) => hit.kind === "cell" && hit.elementId === "A2")).toBe(true);
  });

  it("detects headers below banner rows", async () => {
    const [artifact] = await parseSpreadsheetArtifacts({
      fileName: "accounting.csv",
      mimeType: "text/csv",
      size: 128,
      text: "Business income and expense\nWendy Liu CPA\nAccount,Amount,Note\nRevenue,1000,Stripe\nCOGS,400,Vendor\n",
    });

    expect(artifact.meta?.dataframe?.columns.map((c) => c.label)).toEqual(["Account", "Amount", "Note"]);
    expect(payloadValue(artifact.seed.find((s) => s.id === "u1__account")?.value)).toBe("Revenue");
    expect(artifact.meta?.dataframe?.warnings?.[0]).toContain("Skipped 2 banner rows");
  });

  it("caps wide CSV uploads to the Convex mutation seed budget", async () => {
    const header = Array.from({ length: 80 }, (_, i) => `Col ${i + 1}`).join(",");
    const row = Array.from({ length: 80 }, (_, i) => String(i + 1)).join(",");
    const text = [header, ...Array.from({ length: 300 }, () => row)].join("\n");
    const [artifact] = await parseSpreadsheetArtifacts({ fileName: "wide.csv", mimeType: "text/csv", size: text.length, text });

    expect(artifact.seed).toHaveLength(8_160);
    expect(artifact.seed.length).toBeLessThanOrEqual(8_192);
    expect(artifact.meta?.dataframe?.rowCount).toBe(102);
    expect(artifact.meta?.dataframe?.warnings?.join(" ")).toContain("8192 cells");
  });

  it("caps wide XLSX grid uploads before Convex array validation rejects them", async () => {
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Large model");
    const row = Array.from({ length: 80 }, (_, i) => i + 1);
    for (let i = 0; i < 300; i++) ws.addRow(row);
    const buffer = await workbook.xlsx.writeBuffer();

    const [artifact] = await parseSpreadsheetArtifacts({
      fileName: "large-model.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.byteLength,
      arrayBuffer: buffer as ArrayBuffer,
    });

    expect(artifact.seed).toHaveLength(8_160);
    expect(artifact.seed.length).toBeLessThanOrEqual(8_192);
    expect(artifact.meta?.excelGrid).toMatchObject({ rows: 102, columns: 80, truncated: true });
    expect(artifact.meta?.excelGrid?.warnings?.join(" ")).toContain("8192 cells");
  });

  it("captures the Excel style layer at upload — formats, bold, fill, widths, merges (render-only)", async () => {
    // Persona: the finance analyst whose model shows 33.7% in Excel and must NOT see 0.3374 here.
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet("Model");
    ws.getColumn(2).width = 28;
    ws.getCell("B2").value = "INCOME STATEMENT";
    ws.getCell("B2").font = { bold: true, underline: true, color: { argb: "FFFFFFFF" } };
    ws.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
    ws.getCell("D9").value = 0.3374;
    ws.getCell("D9").numFmt = "0.0%";
    ws.getCell("D15").value = 65.8;
    ws.getCell("D15").numFmt = "#,##0.0";
    ws.getCell("D15").border = { top: { style: "thin" } };
    ws.mergeCells("B2:D2");
    const buffer = await workbook.xlsx.writeBuffer();

    const [artifact] = await parseSpreadsheetArtifacts({
      fileName: "model.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size: buffer.byteLength,
      arrayBuffer: buffer as ArrayBuffer,
    });

    const grid = artifact.meta?.excelGrid;
    expect(grid?.styles?.["B2"]?.b).toBe(1);
    expect(grid?.styles?.["B2"]?.bg).toBe("#1F4E79");
    expect(grid?.styles?.["B2"]?.fc).toBe("#FFFFFF"); // file's explicit white font, not the heuristic
    expect(grid?.styles?.["B2"]?.u).toBe(1);
    expect(grid?.numFmts?.[grid?.styles?.["D9"]?.f ?? -1]).toBe("0.0%");
    expect(grid?.numFmts?.[grid?.styles?.["D15"]?.f ?? -1]).toBe("#,##0.0");
    expect(grid?.styles?.["D15"]?.bt).toBe(1);
    expect(grid?.colWidths?.[1]).toBeGreaterThan(28 * 7); // column B, chars -> px
    expect(grid?.merges).toContain("B2:D2");
    // Default cells carry NO style entry (the layer stays sparse + bounded).
    expect(grid?.styles?.["A1"]).toBeUndefined();
  });
});
