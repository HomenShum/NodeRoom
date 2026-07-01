import ExcelJS from "exceljs";
import JSZip from "jszip";
import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { evaluateBtbDomainProof } from "../../../eval/btbTaskCoverage";

const packageRowSchema = z.object({
  label: z.string().describe("Date, period, ticker, metric, or row label."),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).describe("Column/value pairs for this row."),
});

const packageInputSchema = z.object({
  taskId: z.string().optional(),
  title: z.string().describe("Human title for the generated BankerToolBench package."),
  narrative: z.string().describe("Short banker-facing summary of the completed work."),
  rows: z.array(packageRowSchema).optional().describe("Computed data rows, such as indexed stock performance values or model outputs."),
  sourceUrls: z.array(z.string()).optional(),
  sourceArtifactIds: z.array(z.string()).optional(),
});

type PackageInput = z.infer<typeof packageInputSchema>;

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLSM_MIME = "application/vnd.ms-excel.sheet.macroEnabled.12";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PDF_MIME = "application/pdf";

export const createBtbDeliverablePackageTool: AgentTool = {
  name: "create_btb_deliverable_package",
  description: [
    "Create the final BankerToolBench deliverable package as downloadable room file artifacts.",
    "Use this only after gathering/calculating task outputs.",
    "It creates .xlsx, .xlsm, .pptx, .docx, .pdf, and manifest.json artifacts in the room binder.",
    "Pass rows for the backing workbook when available, plus source URLs/artifact ids used as evidence.",
    "Rows must include at least one computed quantitative value, not just company identity or prose metadata.",
    "Do not call this with placeholder values, needs_review statuses, or prose saying a reviewer must populate source values later.",
  ].join(" "),
  schema: packageInputSchema,
  execute: async (input: PackageInput, rt: RoomTools) => {
    if (!rt.createFileArtifacts) return { ok: false, error: "create_file_artifacts_unsupported" };
    const qualityErrors = btbPackageQualityErrors(input);
    if (qualityErrors.length) {
      return {
        ok: false,
        error: "btb_package_quality_gate_failed",
        reasons: qualityErrors,
      };
    }
    const files = await buildBtbPackageFiles(input);
    return rt.createFileArtifacts({
      files,
      summary: input.narrative,
      sourceArtifactIds: input.sourceArtifactIds,
      sourceUrls: input.sourceUrls,
    });
  },
};

const PLACEHOLDER_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "needs_review", pattern: /\bneeds?[_ -]?review\b/i },
  { code: "placeholder", pattern: /\bplaceholder\b|\btbd\b|\btodo\b/i },
  { code: "reviewer_populate", pattern: /\b(reviewer|user|analyst)\s+(can|should|must|needs?\s+to)\s+populate\b/i },
  { code: "populate_later", pattern: /\bpopulate\s+(confirmed|source|actual|input|the|all|final)\b/i },
  { code: "missing_source_values", pattern: /\b(could not|unable to|failed to)\s+(fully\s+)?(retrieve|read|extract|determine|find)\b/i },
  { code: "package_time_gap", pattern: /\b(source|cell|individual)\s+values?\s+could\s+not\s+be\s+fully\s+retrieved\b/i },
  { code: "harness_fallback", pattern: /\b(harness[- ]enforced|fallback_package|agent_work_summary)\b/i },
];

function btbPackageQualityErrors(input: PackageInput): string[] {
  const errors: string[] = [];
  if (!input.rows?.length) errors.push("rows_required");
  if (!packageRowsHaveQuantitativeValue(input.rows ?? [])) errors.push("quantitative_values_required");
  if (!(input.sourceArtifactIds?.length || input.sourceUrls?.length)) errors.push("source_provenance_required");
  errors.push(...btbDomainProofErrors(input));
  for (const finding of scanPackageStrings(input)) {
    if (isGenericPackagePlaceholder(finding)) errors.push(`generic_placeholder:${finding.path}`);
    const matched = PLACEHOLDER_PATTERNS.find(({ pattern }) => pattern.test(finding.value));
    if (matched) errors.push(`${matched.code}:${finding.path}`);
  }
  return [...new Set(errors)].slice(0, 12);
}

function isGenericPackagePlaceholder(finding: { path: string; value: string }): boolean {
  if (finding.path !== "title" && finding.path !== "narrative") return false;
  return isGenericPlaceholderText(finding.value);
}

const GENERIC_PLACEHOLDER_TOKENS = new Set(["test", "temp", "demo", "sample", "dummy", "foo", "bar", "lorem", "ipsum"]);
const PACKAGE_FILLER_TOKENS = new Set(["btb", "package", "packages", "deliverable", "deliverables", "artifact", "artifacts", "final", "output"]);

function isGenericPlaceholderText(value: string): boolean {
  const normalized = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return true;
  if (/^(test|test \d+|temp|demo|sample|dummy|foo|bar|lorem ipsum)$/i.test(normalized)) return true;
  const meaningfulTokens = normalized
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((token) => !PACKAGE_FILLER_TOKENS.has(token))
    .filter((token) => !/^[a-f0-9]{6,}$/i.test(token))
    .filter((token) => !/^\d+$/.test(token));
  if (!meaningfulTokens.length) return true;
  return meaningfulTokens.every((token) => GENERIC_PLACEHOLDER_TOKENS.has(token));
}

function btbDomainProofErrors(input: PackageInput): string[] {
  const instruction = btbDomainInstruction(input);
  if (!instruction) return [];
  const proof = evaluateBtbDomainProof(instruction, packageProofText(input));
  return proof.ok ? [] : proof.missingGates.map((gate) => `domain_proof_missing:${gate}`);
}

function btbDomainInstruction(input: PackageInput): string | null {
  if (input.taskId?.toLowerCase() === "btb-a31173e3") {
    return "Build a DCF Sum-of-the-Parts valuation for Alphabet Inc. (Google) with a three-statement operating model, segment-level DCF, WACC, terminal-growth assumptions, and implied upside/downside.";
  }
  const text = `${input.title}\n${input.narrative}`;
  return /alphabet|google|googl|goog/i.test(text) && /(sotp|sum[-\s]+of[-\s]+the[-\s]+parts|dcf|discounted cash flow)/i.test(text)
    ? text
    : null;
}

function packageProofText(input: PackageInput): string {
  return scanPackageStrings(input).map((item) => item.value).join("\n");
}

function scanPackageStrings(input: PackageInput): Array<{ path: string; value: string }> {
  const out: Array<{ path: string; value: string }> = [
    { path: "title", value: input.title },
    { path: "narrative", value: input.narrative },
  ];
  for (const [rowIndex, row] of (input.rows ?? []).entries()) {
    out.push({ path: `rows[${rowIndex}].label`, value: row.label });
    for (const [key, value] of Object.entries(row.values)) {
      if (typeof value === "string") out.push({ path: `rows[${rowIndex}].values.${key}`, value });
    }
  }
  return out;
}

function packageRowsHaveQuantitativeValue(rows: Array<z.infer<typeof packageRowSchema>>): boolean {
  return rows.some((row) => Object.values(row.values).some(isQuantitativePackageValue));
}

function isQuantitativePackageValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!trimmed || /^(n\/a|na|none|null|unknown)$/i.test(trimmed)) return false;
  return /[-+]?(?:\$|€|£)?\d+(?:,\d{3})*(?:\.\d+)?%?/.test(trimmed);
}

async function buildBtbPackageFiles(input: PackageInput) {
  const safeTaskId = sanitizeFilePart(input.taskId || "btb-task");
  const safeTitle = sanitizeFilePart(input.title || safeTaskId);
  const base = `${safeTaskId}-${safeTitle}`.slice(0, 96).replace(/-+$/g, "") || "btb-package";
  const rows = input.rows?.length ? input.rows : [{ label: "summary", values: { narrative: input.narrative } }];
  const sourceUrls = input.sourceUrls ?? [];
  const sourceArtifactIds = input.sourceArtifactIds ?? [];
  const manifest = {
    schema: 1,
    taskId: input.taskId,
    title: input.title,
    generatedBy: "NodeAgent create_btb_deliverable_package",
    createdAt: new Date().toISOString(),
    files: [`${base}.xlsx`, `${base}.xlsm`, `${base}.pptx`, `${base}.docx`, `${base}.pdf`],
    sourceUrls,
    sourceArtifactIds,
    rowCount: rows.length,
  };
  const workbookBytes = await workbookBuffer(input, rows, sourceUrls);
  const pptxBytes = await pptxBuffer(input, rows, sourceUrls);
  const docxBytes = await docxBuffer(input, rows, sourceUrls);
  const pdfBytes = pdfBuffer(input, rows, sourceUrls);
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");
  return [
    file(`${base}.xlsx`, XLSX_MIME, workbookBytes),
    file(`${base}.xlsm`, XLSM_MIME, workbookBytes),
    file(`${base}.pptx`, PPTX_MIME, pptxBytes),
    file(`${base}.docx`, DOCX_MIME, docxBytes),
    file(`${base}.pdf`, PDF_MIME, pdfBytes),
    {
      fileName: `${base}-manifest.json`,
      mimeType: "application/json",
      size: manifestBytes.byteLength,
      text: manifestBytes.toString("utf8"),
    },
  ];
}

async function workbookBuffer(input: PackageInput, rows: z.infer<typeof packageRowSchema>[], sourceUrls: string[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NodeAgent";
  workbook.created = new Date();
  workbook.modified = new Date();
  const sheet = workbook.addWorksheet("BTB Package");
  const keys = Array.from(new Set(rows.flatMap((row) => Object.keys(row.values))));
  sheet.addRow(["Title", input.title]);
  sheet.addRow(["Narrative", input.narrative]);
  sheet.addRow([]);
  sheet.addRow(["label", ...keys]);
  for (const row of rows) sheet.addRow([row.label, ...keys.map((key) => row.values[key] ?? "")]);
  sheet.addRow([]);
  sheet.addRow(["Sources", ...sourceUrls]);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(4).font = { bold: true };
  sheet.columns.forEach((column) => { column.width = Math.min(Math.max(column.width ?? 14, 14), 42); });
  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

async function docxBuffer(input: PackageInput, rows: z.infer<typeof packageRowSchema>[], sourceUrls: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`));
  zip.file("_rels/.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`));
  zip.file("docProps/core.xml", coreProps(input.title));
  zip.file("docProps/app.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NodeRoom</Application></Properties>`));
  const body = [
    para(input.title, true),
    para(input.narrative),
    para(`Rows: ${rows.length}`),
    ...rows.slice(0, 40).map((row) => para(formatPackageRow(row))),
    ...(sourceUrls.length ? [para(`Sources: ${sourceUrls.join(", ")}`)] : []),
  ].join("");
  zip.file("word/document.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`));
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

async function pptxBuffer(input: PackageInput, rows: z.infer<typeof packageRowSchema>[], sourceUrls: string[]): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`));
  zip.file("_rels/.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`));
  zip.file("docProps/core.xml", coreProps(input.title));
  zip.file("docProps/app.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NodeRoom</Application><Slides>1</Slides></Properties>`));
  zip.file("ppt/_rels/presentation.xml.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
</Relationships>`));
  zip.file("ppt/presentation.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId2"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`));
  zip.file("ppt/slides/_rels/slide1.xml.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`));
  zip.file("ppt/slides/slide1.xml", slideXml(input, rows, sourceUrls));
  zip.file("ppt/slideLayouts/_rels/slideLayout1.xml.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`));
  zip.file("ppt/slideLayouts/slideLayout1.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld></p:sldLayout>`));
  zip.file("ppt/slideMasters/_rels/slideMaster1.xml.rels", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`));
  zip.file("ppt/slideMasters/slideMaster1.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles/></p:sldMaster>`));
  zip.file("ppt/theme/theme1.xml", xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="NodeRoom"><a:themeElements><a:clrScheme name="NodeRoom"><a:dk1><a:srgbClr val="111418"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:accent1><a:srgbClr val="E36E4A"/></a:accent1></a:clrScheme><a:fontScheme name="NodeRoom"><a:majorFont><a:latin typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="NodeRoom"><a:fillStyleLst/><a:lnStyleLst/><a:effectStyleLst/><a:bgFillStyleLst/></a:fmtScheme></a:themeElements></a:theme>`));
  return Buffer.from(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

function pdfBuffer(input: PackageInput, rows: z.infer<typeof packageRowSchema>[], sourceUrls: string[]): Buffer {
  const lines = [
    input.title,
    "",
    input.narrative,
    "",
    `Rows: ${rows.length}`,
    ...rows.slice(0, 30).map((row) => formatPackageRow(row)),
    "",
    `Sources: ${sourceUrls.join(", ")}`,
  ];
  const escaped = lines.map((line) => `(${escapePdf(line).slice(0, 220)}) Tj`).join("\n0 -16 Td\n");
  const content = `BT /F1 11 Tf 54 760 Td ${escaped} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "utf8")} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

function slideXml(input: PackageInput, rows: z.infer<typeof packageRowSchema>[], sourceUrls: string[]): string {
  const bullets = [
    input.narrative,
    `Rows in backup workbook: ${rows.length}`,
    ...rows.slice(0, 8).map((row) => formatPackageRow(row, 6)),
    sourceUrls.length ? `Sources: ${sourceUrls.slice(0, 4).join(", ")}` : "",
  ].filter(Boolean);
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${shape(2, 500000, 300000, 11200000, 900000, input.title, 3200, true)}${shape(3, 650000, 1450000, 10800000, 4700000, bullets.join("\n"), 1550, false)}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
}

function shape(id: number, x: number, y: number, cx: number, cy: number, text: string, fontSize: number, bold: boolean): string {
  const paras = text.split(/\r?\n/).map((line) => `<a:p><a:r><a:rPr lang="en-US" sz="${fontSize}"${bold ? ' b="1"' : ""}/><a:t>${escapeXml(line)}</a:t></a:r></a:p>`).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Text ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square"/><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

function file(fileName: string, mimeType: string, bytes: Buffer) {
  return { fileName, mimeType, size: bytes.byteLength, dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}` };
}

function sanitizeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "package";
}

function formatPackageRow(row: z.infer<typeof packageRowSchema>, maxFields = 12): string {
  const fields = Object.entries(row.values)
    .slice(0, maxFields)
    .map(([key, value]) => `${titleCase(key)}: ${String(value)}`);
  return fields.length ? `${row.label} — ${fields.join(" · ")}` : row.label;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function para(value: string, bold = false): string {
  return `<w:p><w:r><w:rPr>${bold ? "<w:b/>" : ""}</w:rPr><w:t>${escapeXml(value)}</w:t></w:r></w:p>`;
}

function coreProps(title: string): string {
  return xml(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(title)}</dc:title><dc:creator>NodeAgent</dc:creator></cp:coreProperties>`);
}

function xml(value: string): string {
  return value.trim();
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
