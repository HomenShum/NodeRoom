import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const IO_TIMEOUT_MS = 15_000;

type ReadSummary = {
  sheetNames: string[];
  rowCount: number;
  header: unknown[];
  lastRow: unknown[];
};

function withTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} exceeded ${IO_TIMEOUT_MS}ms`)), IO_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function writeStreamingWorkbook(label: string, dataRows: number): Promise<Buffer> {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
    stream: output,
    useSharedStrings: true,
    useStyles: true,
    zip: { zlib: { level: 6 } },
  });
  const sheet = workbook.addWorksheet("Credit model");
  sheet.addRow(["Facility", "Current", "Prior", "Change"]).commit();

  for (let index = 0; index < dataRows; index += 1) {
    const rowNumber = index + 2;
    const row = sheet.addRow([
      `${label} - borrower ${index}`,
      1_000_000 + index,
      900_000 + index,
      { formula: `B${rowNumber}-C${rowNumber}`, result: 100_000 },
    ]);
    row.getCell(2).numFmt = "$#,##0";
    row.getCell(3).numFmt = "$#,##0";
    row.getCell(4).numFmt = "$#,##0";
    row.commit();
  }

  await withTimeout(workbook.commit(), `streaming XLSX write (${label})`);
  return Buffer.concat(chunks);
}

async function readStreamingWorkbook(buffer: Buffer): Promise<ReadSummary> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from(buffer), {
    worksheets: "emit",
    sharedStrings: "cache",
    styles: "cache",
    hyperlinks: "ignore",
    entries: "ignore",
  });
  const summary: ReadSummary = { sheetNames: [], rowCount: 0, header: [], lastRow: [] };

  for await (const sheet of reader) {
    summary.sheetNames.push((sheet as unknown as { name: string }).name);
    for await (const row of sheet) {
      summary.rowCount += 1;
      const values = Array.from(row.values as unknown[]);
      if (row.number === 1) summary.header = values;
      summary.lastRow = values;
    }
  }

  return summary;
}

async function readLoadedWorkbook(buffer: Buffer): Promise<ReadSummary> {
  const workbook = new ExcelJS.Workbook();
  await withTimeout(workbook.xlsx.load(Uint8Array.from(buffer).buffer), "loaded XLSX read");
  const sheet = workbook.getWorksheet("Credit model");
  if (!sheet) throw new Error("Credit model worksheet is missing");

  return {
    sheetNames: workbook.worksheets.map((worksheet) => worksheet.name),
    rowCount: sheet.rowCount,
    header: Array.from(sheet.getRow(1).values as unknown[]),
    lastRow: Array.from(sheet.getRow(sheet.rowCount).values as unknown[]),
  };
}

describe("ExcelJS security dependency compatibility", () => {
  it("streams a sustained finance workbook through the hardened archive writer and reader", async () => {
    const dataRows = 1_024;
    const workbook = await writeStreamingWorkbook("sustained", dataRows);
    const summary = await withTimeout(readStreamingWorkbook(workbook), "streaming XLSX read");

    expect(workbook.subarray(0, 4).toString("hex")).toBe("504b0304");
    expect(summary.sheetNames).toEqual(["Credit model"]);
    expect(summary.rowCount).toBe(dataRows + 1);
    expect(summary.header.slice(1)).toEqual(["Facility", "Current", "Prior", "Change"]);
    expect(summary.lastRow[1]).toBe(`sustained - borrower ${dataRows - 1}`);
    expect(summary.lastRow[4]).toMatchObject({
      formula: `B${dataRows + 1}-C${dataRows + 1}`,
      result: 100_000,
    });
  });

  it("keeps concurrent workbook writes isolated across sustained application-reader bursts", async () => {
    for (let wave = 0; wave < 16; wave += 1) {
      const labels = Array.from({ length: 4 }, (_, index) => `wave-${wave}-stream-${index}`);
      const workbooks = await Promise.all(
        labels.map((label) => writeStreamingWorkbook(label, 64)),
      );
      const summaries = await Promise.all(
        workbooks.map((workbook) => readLoadedWorkbook(workbook)),
      );

      summaries.forEach((summary, index) => {
        expect(summary.lastRow[1]).toBe(`${labels[index]} - borrower 63`);
      });
      expect(new Set(workbooks.map((workbook) => workbook.toString("base64"))).size).toBe(4);
    }
  });

  it("fails closed and within budget when a workbook stream is truncated", async () => {
    const workbook = await writeStreamingWorkbook("truncated", 32);
    const truncated = workbook.subarray(0, Math.floor(workbook.length / 2));

    await expect(
      withTimeout(readStreamingWorkbook(truncated), "truncated XLSX read"),
    ).rejects.toThrow();
  });

  it("resolves the pinned archive writer and the parse-only extraction boundary", () => {
    const excelRoot = dirname(require.resolve("exceljs/package.json"));
    const archiver = JSON.parse(
      readFileSync(require.resolve("archiver/package.json", { paths: [excelRoot] }), "utf8"),
    ) as { name: string; version: string };
    const unzipperPackagePath = require.resolve("unzipper/package.json", { paths: [excelRoot] });
    const unzipperRoot = dirname(unzipperPackagePath);
    const unzipper = JSON.parse(readFileSync(unzipperPackagePath, "utf8")) as {
      name: string;
      version: string;
    };
    const fstreamPackagePath = require.resolve("fstream/package.json", { paths: [unzipperRoot] });
    const fstream = JSON.parse(readFileSync(fstreamPackagePath, "utf8")) as {
      name: string;
      version: string;
    };
    const Fstream = require(require.resolve("fstream", { paths: [unzipperRoot] })) as {
      Reader: new () => unknown;
    };

    expect(archiver).toMatchObject({ name: "@excel.js/archiver", version: "0.0.5" });
    expect(unzipper).toMatchObject({ name: "unzipper", version: "0.10.14" });
    expect(fstream).toMatchObject({
      name: "fstream",
      version: "1.0.12+noderoom.fail-closed.1",
    });
    expect(() => new Fstream.Reader()).toThrow(
      "fstream extraction is unavailable: NodeRoom permits ExcelJS streaming parse only",
    );
  });
});
