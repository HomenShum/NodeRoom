import "./benchmark/loadEnv";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { generateObject, type ModelMessage } from "ai";
import { google } from "@ai-sdk/google";
import { z } from "zod";

const args = process.argv.slice(2);
const taskId = optionValue("--task-id") ?? "Visualization/Task 126";
const sheet = optionValue("--sheet") ?? "Surprise";
const model = optionValue("--model") ?? process.env.GEMINI_MEDIA_JUDGE_MODEL ?? "gemini-3.6-flash";
const outDir = resolve(optionValue("--out-dir") ?? join("docs", "eval", "spreadsheetbench-chart-visual", "task-126"));
const tempDir = resolve(optionValue("--tmp-dir") ?? join(".tmp", "spreadsheetbench-chart-visual", "task-126"));
const jsonOut = resolve(optionValue("--json-out") ?? join(outDir, "vlm-report.json"));
const positiveCandidateWorkbook = resolve(
  optionValue("--candidate") ??
    join(".tmp", "official-benchmarks", "v2", "data_example_05_11", "Visualization", "spreadsheet", "Task 126", "Task 126_golden.xlsx"),
);
const goldWorkbook = resolve(
  optionValue("--gold") ??
    join(".tmp", "official-benchmarks", "v2", "data_example_05_11", "Visualization", "spreadsheet", "Task 126", "Task 126_golden.xlsx"),
);
const negativeWorkbook = resolve(
  optionValue("--negative-candidate") ??
    join(".tmp", "official-benchmarks", "v2", "data_example_05_11", "Visualization", "spreadsheet", "Task 126", "Task 126_input.xlsx"),
);

if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is required");
for (const workbook of [positiveCandidateWorkbook, goldWorkbook, negativeWorkbook]) {
  if (!existsSync(workbook)) throw new Error(`Workbook not found: ${workbook}`);
}

mkdirSync(outDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });

const candidateImage = renderWorkbookSheetPng({
  workbook: positiveCandidateWorkbook,
  sheet,
  stem: "candidate-oracle",
});
const goldImage = renderWorkbookSheetPng({
  workbook: goldWorkbook,
  sheet,
  stem: "gold",
});
const negativeImage = renderWorkbookSheetPng({
  workbook: negativeWorkbook,
  sheet,
  stem: "negative-input",
});

const judgeSchema = z.object({
  positive: z.object({
    accepted: z.boolean(),
    score: z.number().min(0).max(1),
    rationale: z.string(),
    differences: z.array(z.string()).default([]),
  }),
  negativeControl: z.object({
    rejected: z.boolean(),
    score: z.number().min(0).max(1),
    rationale: z.string(),
    differences: z.array(z.string()).default([]),
  }),
  summary: z.string(),
});

const messages: ModelMessage[] = [{
  role: "user",
  content: [
    {
      type: "text",
      text: [
        "You are judging SpreadsheetBench V2 chart visual grading evidence.",
        "Image 1 is the gold chart screenshot.",
        "Image 2 is a positive candidate screenshot produced from the golden workbook copied into the candidate lane.",
        "Image 3 is a negative-control screenshot produced from the raw input workbook before the requested chart work is complete.",
        "",
        "Return strict JSON. Mark positive.accepted true only if Image 2 visually matches Image 1 for the chart area, legends, axes, titles, and plotted series.",
        "Mark negativeControl.rejected true only if Image 3 is visibly incomplete or materially different from Image 1 for the requested chart task.",
        "Do not accept based on text labels alone; judge the rendered charts.",
      ].join("\n"),
    },
    { type: "file", data: readFileSync(goldImage.path), filename: basename(goldImage.path), mediaType: "image/png" },
    { type: "file", data: readFileSync(candidateImage.path), filename: basename(candidateImage.path), mediaType: "image/png" },
    { type: "file", data: readFileSync(negativeImage.path), filename: basename(negativeImage.path), mediaType: "image/png" },
  ],
}];

const result = await generateObject({
  model: google(model),
  schema: judgeSchema,
  messages,
});

const judged = result.object;
const pass = judged.positive.accepted && judged.positive.score >= 0.95 && judged.negativeControl.rejected;
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  verifier: "spreadsheetbench_chart_visual_vlm",
  status: "judged",
  pass,
  verdict: pass ? "accept" : "fix-then-publish",
  model,
  taskId,
  sheet,
  candidateKind: "golden-oracle-candidate",
  sources: {
    candidateWorkbook: rel(positiveCandidateWorkbook),
    goldWorkbook: rel(goldWorkbook),
    negativeControlWorkbook: rel(negativeWorkbook),
  },
  renderedImages: {
    candidate: imageEvidence(candidateImage.path),
    gold: imageEvidence(goldImage.path),
    negativeControl: imageEvidence(negativeImage.path),
  },
  positive: judged.positive,
  negativeControl: judged.negativeControl,
  summary: judged.summary,
};

mkdirSync(dirname(jsonOut), { recursive: true });
writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
console.log(`wrote ${rel(jsonOut)}`);
console.log(`SpreadsheetBench chart visual grade: ${pass ? "pass" : "fail"} (${judged.summary})`);
if (!pass) process.exitCode = 1;

function renderWorkbookSheetPng(input: { workbook: string; sheet: string; stem: string }): { path: string } {
  const pdfPath = join(tempDir, `${input.stem}.pdf`);
  const pngBase = join(outDir, input.stem);
  const pngPath = `${pngBase}.png`;
  exportSheetPdfWithExcel(input.workbook, input.sheet, pdfPath);
  runRequired("pdftoppm", ["-png", "-singlefile", "-r", "144", pdfPath, pngBase]);
  if (!existsSync(pngPath)) throw new Error(`pdftoppm did not produce ${pngPath}`);
  return { path: pngPath };
}

function exportSheetPdfWithExcel(workbook: string, sheetName: string, pdfPath: string): void {
  if (process.platform !== "win32") {
    throw new Error("This live renderer currently requires Windows Excel COM automation.");
  }
  const psPath = join(tempDir, "export-sheet-pdf.ps1");
  writeFileSync(psPath, powershellExporter());
  const result = spawnSync("powershell", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    psPath,
    "-Workbook",
    workbook,
    "-Sheet",
    sheetName,
    "-Pdf",
    pdfPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`Excel export failed (${result.status}): ${preview(result.stderr || result.stdout || result.error?.message)}`);
  }
  if (!existsSync(pdfPath)) throw new Error(`Excel export did not produce ${pdfPath}`);
}

function powershellExporter(): string {
  return [
    "param([string]$Workbook,[string]$Sheet,[string]$Pdf)",
    "$ErrorActionPreference = 'Stop'",
    "$excel = $null",
    "$workbookObject = $null",
    "try {",
    "  $excel = New-Object -ComObject Excel.Application",
    "  $excel.Visible = $false",
    "  $excel.DisplayAlerts = $false",
    "  $excel.AutomationSecurity = 3",
    "  $workbookObject = $excel.Workbooks.Open($Workbook, 0, $true)",
    "  $worksheet = $workbookObject.Worksheets.Item($Sheet)",
    "  $worksheet.PageSetup.Zoom = $false",
    "  $worksheet.PageSetup.FitToPagesWide = 1",
    "  $worksheet.PageSetup.FitToPagesTall = 1",
    "  $worksheet.ExportAsFixedFormat(0, $Pdf)",
    "} finally {",
    "  if ($workbookObject -ne $null) { $workbookObject.Close($false) | Out-Null; [System.Runtime.InteropServices.Marshal]::ReleaseComObject($workbookObject) | Out-Null }",
    "  if ($excel -ne $null) { $excel.Quit() | Out-Null; [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null }",
    "}",
  ].join("\n");
}

function runRequired(command: string, commandArgs: string[]): void {
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${preview(result.stderr || result.stdout || result.error?.message)}`);
  }
}

function imageEvidence(path: string): { path: string; sha256: string; bytes: number } {
  const content = readFileSync(path);
  return {
    path: rel(path),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: statSync(path).size,
  };
}

function optionValue(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}

function preview(value: string | Buffer | Error | null | undefined): string {
  const raw = value instanceof Error ? value.message : typeof value === "string" ? value : value?.toString("utf8") ?? "";
  return raw.replace(/\s+/g, " ").trim().slice(0, 500);
}
