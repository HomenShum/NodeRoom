import ExcelJS from "exceljs";
import JSZip from "jszip";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { emitSpreadsheetBenchWorkbookCandidate } from "../src/eval/spreadsheetBenchWorkbookEmitter";

const roots: string[] = [];
const WORKSHEET_PATH = "xl/customSheets/model-data.xml";
const FIXED_ZIP_DATE = new Date("2020-01-02T03:04:06.000Z");

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench workbook emitter", () => {
  it("copies the source workbook byte-for-byte when there are no patches", async () => {
    const root = tempRoot();
    const source = join(root, "source.xlsx");
    const candidate = join(root, "candidate.xlsx");
    await writeOoxmlFixture(source);

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [],
    });

    expect(readFileSync(candidate)).toEqual(readFileSync(source));
  });

  it("resolves the worksheet relationship and preserves unrelated package parts byte-for-byte", async () => {
    const root = tempRoot();
    const source = join(root, "source.xlsx");
    const candidate = join(root, "candidate.xlsx");
    await writeOoxmlFixture(source);

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{ sheet: "model", address: "$b$2", kind: "value", value: 99 }],
    });

    const [sourceZip, candidateZip] = await Promise.all([
      JSZip.loadAsync(readFileSync(source)),
      JSZip.loadAsync(readFileSync(candidate)),
    ]);
    expect(packagePartPaths(candidateZip)).toEqual(packagePartPaths(sourceZip));

    for (const path of [
      "_rels/.rels",
      "docProps/core.xml",
      "customXml/item1.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/calcChain.xml",
      "xl/customSheets/_rels/model-data.xml.rels",
      "xl/drawings/drawing7.xml",
      "xl/drawings/_rels/drawing7.xml.rels",
      "xl/charts/chart7.xml",
      "xl/media/image7.png",
    ]) {
      expect(await requiredZipBytes(candidateZip, path)).toEqual(await requiredZipBytes(sourceZip, path));
    }

    const sourceWorksheet = await requiredZipText(sourceZip, WORKSHEET_PATH);
    const candidateWorksheet = await requiredZipText(candidateZip, WORKSHEET_PATH);
    expect(candidateWorksheet).not.toBe(sourceWorksheet);
    expect(candidateWorksheet).toContain('<c r="B2" s="0"><v>99</v></c>');
  });

  it("persists patched formulas, cached values, scalar values, and source styles", async () => {
    const root = tempRoot();
    const source = join(root, "styled-source.xlsx");
    const candidate = join(root, "styled-candidate.xlsx");
    await writeStyledWorkbook(source);

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [
        {
          sheet: "Model",
          address: "B2",
          kind: "formula",
          formula: "=A1*3",
          hasCachedResult: true,
          cachedResult: 30,
          numFmt: "0.000%",
          fontColor: "FF008000",
        },
        { sheet: "Model", address: "C3", kind: "value", value: " updated " },
      ],
    });

    const emitted = new ExcelJS.Workbook();
    await emitted.xlsx.readFile(candidate);
    const sheet = emitted.getWorksheet("Model");
    expect(sheet).toBeDefined();

    const formulaCell = sheet!.getCell("B2");
    expect(formulaCell.value).toEqual({ formula: "A1*3", result: 30 });
    expect(formulaCell.numFmt).toBe("0.000%");
    expect(formulaCell.font).toMatchObject({ bold: true, color: { argb: "FF008000" } });
    expect(formulaCell.fill).toMatchObject({
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFF00" },
    });
    expect(formulaCell.border.bottom).toMatchObject({ style: "thin", color: { argb: "FF654321" } });

    const valueCell = sheet!.getCell("C3");
    expect(valueCell.value).toBe(" updated ");
    expect(valueCell.numFmt).toBe("@");
    expect(valueCell.font).toMatchObject({ italic: true });
    expect(valueCell.alignment).toMatchObject({ horizontal: "center" });

    const untouchedCell = sheet!.getCell("D4");
    expect(untouchedCell.value).toEqual({ formula: "A1+5", result: 15 });
    expect(untouchedCell.numFmt).toBe("0.00");
    expect(untouchedCell.font).toMatchObject({ underline: true });
  });

  it("changes only the style index for a font-color-only shared-formula patch", async () => {
    const root = tempRoot();
    const source = join(root, "shared-style-source.xlsx");
    const candidate = join(root, "shared-style-candidate.xlsx");
    await writeOoxmlFixture(source, {
      formulaXml: '<f t="shared" ref="B2:B3" si="0">A1*2</f>',
      extraRowsXml: '<row r="3"><c r="B3"><f t="shared" si="0"/><v>4</v></c></row>',
    });

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{ sheet: "Model", address: "B2", kind: "style", fontColor: "FF008000" }],
    });

    const [sourceZip, candidateZip] = await Promise.all([
      JSZip.loadAsync(readFileSync(source)),
      JSZip.loadAsync(readFileSync(candidate)),
    ]);
    const sourceXml = await requiredZipText(sourceZip, WORKSHEET_PATH);
    const candidateXml = await requiredZipText(candidateZip, WORKSHEET_PATH);
    const cellBody = (xml: string) => xml.match(/<c\b[^>]*\br="B2"[^>]*>([\s\S]*?)<\/c>/)?.[1];
    expect(cellBody(candidateXml)).toBe(cellBody(sourceXml));
    expect(candidateXml.match(/<c\b[^>]*\br="B2"[^>]*>/)?.[0]).toContain('s="1"');
    expect(candidateXml).toContain('<c r="B3"><f t="shared" si="0"/><v>4</v></c>');

    const stylesXml = await requiredZipText(candidateZip, "xl/styles.xml");
    expect(stylesXml).toContain('<font><sz val="11"/><name val="Calibri"/><color rgb="FF008000"/></font>');
    expect(stylesXml).toContain('fontId="1"');
    expect(stylesXml).toContain('applyFont="1"');
  });

  it("materializes an empty workbook cell for a style-only patch", async () => {
    const root = tempRoot();
    const source = join(root, "blank-style-source.xlsx");
    const candidate = join(root, "blank-style-candidate.xlsx");
    await writeStyledWorkbook(source);

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{
        sheet: "Model",
        address: "B10",
        kind: "style",
        numFmt: "0.0%",
        fontColor: "FF008000",
      }],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(candidate);
    const cell = workbook.getWorksheet("Model")!.getCell("B10");
    expect(cell.value).toBeNull();
    expect(cell.numFmt).toBe("0.0%");
    expect(cell.font.color).toEqual({ argb: "FF008000" });
  });

  it("serializes an otherwise structured model value as bounded canonical JSON text", async () => {
    const root = tempRoot();
    const source = join(root, "structured-source.xlsx");
    const candidate = join(root, "structured-candidate.xlsx");
    await writeStyledWorkbook(source);

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{
        sheet: "Model",
        address: "B10",
        kind: "value",
        value: { series: [{ values: [1, 2] }], chartType: "bar" },
      }],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(candidate);
    expect(workbook.getWorksheet("Model")!.getCell("B10").value)
      .toBe('{"chartType":"bar","series":[{"values":[1,2]}]}');
  });

  it("serializes a themed font-color patch without flattening it to RGB", async () => {
    const root = tempRoot();
    const source = join(root, "theme-style-source.xlsx");
    const candidate = join(root, "theme-style-candidate.xlsx");
    await writeOoxmlFixture(source);

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{
        sheet: "Model",
        address: "B2",
        kind: "style",
        fontColor: "FF4EA72E",
        fontColorTheme: 9,
      }],
    });

    const zip = await JSZip.loadAsync(readFileSync(candidate));
    const stylesXml = await requiredZipText(zip, "xl/styles.xml");
    expect(stylesXml).toContain('<color theme="9"/>');
    expect(stylesXml).not.toContain('rgb="FF4EA72E"');

    expect(stylesXml).toContain('fontId="1"');
    expect(stylesXml).toContain('applyFont="1"');
  });

  it("materializes untouched shared-formula members before rewriting one member", async () => {
    const root = tempRoot();
    const source = join(root, "shared-source.xlsx");
    const candidate = join(root, "shared-candidate.xlsx");
    await writeOoxmlFixture(source, {
      formulaXml: '<f t="shared" ref="B2:B3" si="0">A1*2</f>',
      extraRowsXml: '<row r="3"><c r="B3"><f t="shared" si="0"/><v>4</v></c></row>',
    });

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{ sheet: "Model", address: "B2", kind: "formula", formula: "=A1*4" }],
    });

    const zip = await JSZip.loadAsync(readFileSync(candidate));
    const worksheet = await requiredZipText(zip, WORKSHEET_PATH);
    expect(worksheet).toContain('<c r="B2" s="0"><f>A1*4</f></c>');
    expect(worksheet).toContain('<c r="B3"><f>A2*2</f><v>4</v></c>');
    expect(worksheet).not.toContain('t="shared"');
  });

  it.each([
    {
      label: "multi-cell array formula",
      formulaXml: '<f t="array" ref="B2:C2">A1*2</f>',
      row2TailXml: '<c r="C2"><v>4</v></c>',
      extraRowsXml: "",
      expectedError: "Refusing to patch array formula range Model!B2:C2 without all 2 cells",
    },
    {
      label: "data-table formula group",
      formulaXml: '<f t="dataTable" ref="B2:C3" dt2D="1"/>',
      row2TailXml: '<c r="C2"><v>4</v></c>',
      extraRowsXml: '<row r="3"><c r="B3"><v>4</v></c><c r="C3"><v>4</v></c></row>',
      expectedError: "Refusing to patch dataTable formula range Model!B2:C3 without all 4 cells",
    },
  ])("refuses to rewrite a cell inside a $label", async ({ formulaXml, row2TailXml, extraRowsXml, expectedError }) => {
    const root = tempRoot();
    const source = join(root, "grouped-source.xlsx");
    const candidate = join(root, "grouped-candidate.xlsx");
    await writeOoxmlFixture(source, { formulaXml, row2TailXml, extraRowsXml });

    await expect(emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{ sheet: "Model", address: "B2", kind: "formula", formula: "=A1*4" }],
    })).rejects.toThrow(expectedError);
  });

  it("allows a single-cell array formula rewrite while retaining its array metadata", async () => {
    const root = tempRoot();
    const source = join(root, "array-source.xlsx");
    const candidate = join(root, "array-candidate.xlsx");
    await writeOoxmlFixture(source, { formulaXml: '<f t="array" ref="B2">A1*2</f>' });

    await emitSpreadsheetBenchWorkbookCandidate({
      sourceWorkbookPath: source,
      candidateWorkbookPath: candidate,
      patches: [{
        sheet: "Model",
        address: "B2",
        kind: "formula",
        formula: "=A1*4",
        hasCachedResult: true,
        cachedResult: 8,
      }],
    });

    const zip = await JSZip.loadAsync(readFileSync(candidate));
    expect(await requiredZipText(zip, WORKSHEET_PATH)).toContain(
      '<f t="array" ref="B2">A1*4</f><v>8</v>',
    );
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-spreadsheetbench-emitter-"));
  roots.push(root);
  return root;
}

async function writeStyledWorkbook(path: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NodeRoom tests";
  workbook.created = new Date("2020-01-02T03:04:06.000Z");
  workbook.modified = new Date("2020-01-02T03:04:06.000Z");
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("A1").value = 10;

  const formulaCell = sheet.getCell("B2");
  formulaCell.value = { formula: "A1*2", result: 20 };
  formulaCell.numFmt = "$#,##0.00";
  formulaCell.font = { bold: true, color: { argb: "FF123456" } };
  formulaCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFF00" } };
  formulaCell.border = { bottom: { style: "thin", color: { argb: "FF654321" } } };

  const valueCell = sheet.getCell("C3");
  valueCell.value = "before";
  valueCell.numFmt = "@";
  valueCell.font = { italic: true };
  valueCell.alignment = { horizontal: "center" };

  const untouchedCell = sheet.getCell("D4");
  untouchedCell.value = { formula: "A1+5", result: 15 };
  untouchedCell.numFmt = "0.00";
  untouchedCell.font = { underline: true };
  await workbook.xlsx.writeFile(path);
}

async function writeOoxmlFixture(path: string, options: {
  formulaXml?: string;
  row2TailXml?: string;
  extraRowsXml?: string;
} = {}): Promise<void> {
  const zip = new JSZip();
  const add = (partPath: string, data: string | Buffer) => {
    zip.file(partPath, data, { createFolders: false, date: FIXED_ZIP_DATE });
  };
  const formulaXml = options.formulaXml ?? "<f>A1*2</f>";

  add(
    "[Content_Types].xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Default Extension="png" ContentType="image/png"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + `<Override PartName="/${WORKSHEET_PATH}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>'
      + '<Override PartName="/xl/drawings/drawing7.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      + '<Override PartName="/xl/charts/chart7.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
      + "</Types>",
  );
  add(
    "_rels/.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + "</Relationships>",
  );
  add(
    "docProps/core.xml",
    '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><cp:revision>7</cp:revision></cp:coreProperties>',
  );
  add("customXml/item1.xml", '<audit preserve="exact">relationship/chart/drawing/media</audit>');
  add(
    "xl/workbook.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="Model" sheetId="1" r:id="rIdWorksheet"/></sheets>'
      + '<calcPr calcId="191029" calcMode="manual" fullCalcOnLoad="0" forceFullCalc="0"/>'
      + "</workbook>",
  );
  add(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '<Relationship Id="rIdCalcChain" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/>'
      + '<Relationship Id="rIdWorksheet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="customSheets/model-data.xml"/>'
      + "</Relationships>",
  );
  add(
    "xl/styles.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
      + '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
      + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
      + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
      + '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
      + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
      + "</styleSheet>",
  );
  add(
    WORKSHEET_PATH,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<dimension ref="A1:B2"/><sheetData>'
      + '<row r="1"><c r="A1"><v>2</v></c></row>'
      + `<row r="2"><c r="B2" s="0">${formulaXml}<v>4</v></c>${options.row2TailXml ?? ""}</row>`
      + `${options.extraRowsXml ?? ""}</sheetData><drawing r:id="rIdDrawing"/></worksheet>`,
  );
  add(
    "xl/calcChain.xml",
    '<?xml version="1.0" encoding="UTF-8"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B2" i="1"/></calcChain>',
  );
  add(
    "xl/customSheets/_rels/model-data.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdDrawing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing7.xml"/>'
      + "</Relationships>",
  );
  add(
    "xl/drawings/drawing7.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<xdr:absoluteAnchor><xdr:ext cx="1" cy="1"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr/><xdr:xfrm/></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor>'
      + "</xdr:wsDr>",
  );
  add(
    "xl/drawings/_rels/drawing7.xml.rels",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rIdChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart7.xml"/>'
      + '<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image7.png"/>'
      + "</Relationships>",
  );
  add(
    "xl/charts/chart7.xml",
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea/></c:chart></c:chartSpace>',
  );
  add("xl/media/image7.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x7f]));

  writeFileSync(path, await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  }));
}

async function requiredZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Fixture package is missing ${path}`);
  return file.async("string");
}

async function requiredZipBytes(zip: JSZip, path: string): Promise<Buffer> {
  const file = zip.file(path);
  if (!file) throw new Error(`Fixture package is missing ${path}`);
  return file.async("nodebuffer");
}

function packagePartPaths(zip: JSZip): string[] {
  return Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
}
