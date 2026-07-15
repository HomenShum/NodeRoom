import { randomUUID } from "node:crypto";
import { copyFileSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import JSZip from "jszip";
import { SaxesParser, type SaxesTagNS } from "saxes";

export type SpreadsheetBenchWorkbookCellPatch = {
  sheet: string;
  address: string;
  kind: "clear" | "formula" | "value";
  formula?: string;
  hasCachedResult?: boolean;
  cachedResult?: unknown;
  value?: unknown;
  numFmt?: string;
};

type WorkbookSheetPart = {
  name: string;
  path: string;
};

type XmlNodeSpan = {
  name: string;
  local: string;
  attrs: Record<string, string>;
  start: number;
  openEnd: number;
  closeStart: number;
  end: number;
  selfClosing: boolean;
  parent?: XmlNodeSpan;
};

type XmlSplice = {
  start: number;
  end: number;
  text: string;
};

type CellCoordinate = {
  row: number;
  col: number;
};

type ColumnStyleRange = {
  min: number;
  max: number;
  style: number;
};

const BUILTIN_NUMBER_FORMATS = new Map<number, string>([
  [0, "General"],
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [11, "0.00E+00"],
  [12, "# ?/?"],
  [13, "# ??/??"],
  [14, "mm-dd-yy"],
  [15, "d-mmm-yy"],
  [16, "d-mmm"],
  [17, "mmm-yy"],
  [18, "h:mm AM/PM"],
  [19, "h:mm:ss AM/PM"],
  [20, "h:mm"],
  [21, "h:mm:ss"],
  [22, "m/d/yy h:mm"],
  [37, "#,##0 ;(#,##0)"],
  [38, "#,##0 ;[Red](#,##0)"],
  [39, "#,##0.00;(#,##0.00)"],
  [40, "#,##0.00;[Red](#,##0.00)"],
  [45, "mm:ss"],
  [46, "[h]:mm:ss"],
  [47, "mmss.0"],
  [48, "##0.0E+0"],
  [49, "@"],
]);

export async function emitSpreadsheetBenchWorkbookCandidate(args: {
  sourceWorkbookPath: string;
  candidateWorkbookPath: string;
  patches: SpreadsheetBenchWorkbookCellPatch[];
}): Promise<void> {
  if (resolve(args.sourceWorkbookPath) === resolve(args.candidateWorkbookPath)) {
    throw new Error("Workbook candidate path must not overwrite the source workbook");
  }
  if (args.patches.length === 0) {
    atomicCopyFile(args.sourceWorkbookPath, args.candidateWorkbookPath);
    return;
  }

  const zip = await JSZip.loadAsync(readFileSync(args.sourceWorkbookPath));
  const sheets = await workbookSheetParts(zip);
  const sheetsByName = new Map(sheets.map((sheet) => [sheet.name.toLowerCase(), sheet]));
  const patchesBySheet = new Map<string, SpreadsheetBenchWorkbookCellPatch[]>();
  const finalPatches = new Map<string, SpreadsheetBenchWorkbookCellPatch>();
  for (const patch of args.patches) {
    const address = normalizeAddress(patch.address);
    if (!parseAddress(address)) throw new Error(`Invalid workbook cell patch address ${patch.sheet}!${patch.address}`);
    const key = patch.sheet.toLowerCase();
    finalPatches.set(`${key}\u0000${address}`, { ...patch, address });
  }
  for (const patch of finalPatches.values()) {
    const key = patch.sheet.toLowerCase();
    const existing = patchesBySheet.get(key) ?? [];
    existing.push(patch);
    patchesBySheet.set(key, existing);
  }

  const stylesPath = "xl/styles.xml";
  const stylesFile = zip.file(stylesPath);
  if (!stylesFile) throw new Error(`Workbook package is missing ${stylesPath}`);
  const sourceStylesXml = await stylesFile.async("string");
  const styles = new WorkbookStylesEditor(sourceStylesXml);

  for (const [sheetName, patches] of patchesBySheet) {
    const sheet = sheetsByName.get(sheetName);
    if (!sheet) throw new Error(`Workbook package has no worksheet named ${JSON.stringify(patches[0]?.sheet)}`);
    const worksheet = zip.file(sheet.path);
    if (!worksheet) throw new Error(`Workbook package is missing ${sheet.path}`);
    const patchedXml = patchWorksheetCells(await worksheet.async("string"), patches, styles);
    assertWellFormedXml(patchedXml, sheet.path);
    zip.file(sheet.path, patchedXml);
  }

  const stylesXml = styles.finish();
  assertWellFormedXml(stylesXml, stylesPath);
  if (stylesXml !== sourceStylesXml) zip.file(stylesPath, stylesXml);
  await markWorkbookForFullCalculation(zip);

  atomicWriteFile(
    args.candidateWorkbookPath,
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
  );
}

class WorkbookStylesEditor {
  private readonly sourceXml: string;
  private readonly sourceXfs: string[];
  private readonly formatCodeById = new Map<number, string>(BUILTIN_NUMBER_FORMATS);
  private readonly formatIdByCode = new Map<string, number>();
  private readonly pendingNumberFormats: Array<{ id: number; code: string }> = [];
  private readonly pendingXfs: string[] = [];
  private readonly styleCache = new Map<string, number>();
  private nextNumberFormatId: number;

  constructor(xml: string) {
    this.sourceXml = xml;
    const nodes = indexXmlSpans(xml);
    const cellXfs = nodes.find((node) => node.local === "cellXfs");
    if (!cellXfs) throw new Error("Workbook styles XML is missing cellXfs");
    this.sourceXfs = nodes
      .filter((node) => node.local === "xf" && node.parent === cellXfs)
      .map((node) => xml.slice(node.start, node.end));
    if (this.sourceXfs.length === 0) throw new Error("Workbook styles XML has no cellXfs entries");

    for (const node of nodes.filter((candidate) => candidate.local === "numFmt")) {
      const id = Number(node.attrs.numFmtId);
      const code = node.attrs.formatCode;
      if (Number.isInteger(id) && code !== undefined) this.formatCodeById.set(id, code);
    }
    for (const [id, code] of this.formatCodeById) {
      if (!this.formatIdByCode.has(code)) this.formatIdByCode.set(code, id);
    }
    this.nextNumberFormatId = Math.max(164, ...this.formatCodeById.keys()) + 1;
  }

  ensureNumberFormatStyle(sourceStyleIndex: number, formatCode: string): number {
    const sourceXf = this.sourceXfs[sourceStyleIndex];
    if (!sourceXf) throw new Error(`Workbook cell references missing style index ${sourceStyleIndex}`);
    const sourceXfNode = indexXmlSpans(sourceXf).find((node) => node.local === "xf");
    if (!sourceXfNode) throw new Error(`Workbook style ${sourceStyleIndex} is malformed`);
    const sourceFormatId = Number(sourceXfNode.attrs.numFmtId ?? 0);
    if (this.formatCodeById.get(sourceFormatId) === formatCode) return sourceStyleIndex;

    const cacheKey = `${sourceStyleIndex}\u0000${formatCode}`;
    const cached = this.styleCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const formatId = this.ensureNumberFormat(formatCode);
    let nextXf = setElementAttribute(sourceXf, "numFmtId", String(formatId));
    nextXf = setElementAttribute(nextXf, "applyNumberFormat", formatId === 0 ? "0" : "1");
    const styleIndex = this.sourceXfs.length + this.pendingXfs.length;
    this.pendingXfs.push(nextXf);
    this.styleCache.set(cacheKey, styleIndex);
    return styleIndex;
  }

  finish(): string {
    let xml = this.sourceXml;
    if (this.pendingNumberFormats.length > 0) {
      const fragments = this.pendingNumberFormats
        .map((format) => `<numFmt numFmtId="${format.id}" formatCode="${escapeXmlAttribute(format.code)}"/>`)
        .join("");
      let nodes = indexXmlSpans(xml);
      const numFmts = nodes.find((node) => node.local === "numFmts");
      if (numFmts) {
        const existingCount = nodes.filter((node) => node.local === "numFmt" && node.parent === numFmts).length;
        if (numFmts.selfClosing) {
          const opening = xml.slice(numFmts.start, numFmts.openEnd).replace(/\s*\/>$/, ">");
          const expanded = `${setXmlAttribute(opening, "count", String(existingCount + this.pendingNumberFormats.length))}${fragments}</${numFmts.name}>`;
          xml = applyXmlSplices(xml, [{ start: numFmts.start, end: numFmts.end, text: expanded }]);
        } else {
          const opening = setXmlAttribute(xml.slice(numFmts.start, numFmts.openEnd), "count", String(existingCount + this.pendingNumberFormats.length));
          xml = applyXmlSplices(xml, [
            { start: numFmts.start, end: numFmts.openEnd, text: opening },
            { start: numFmts.closeStart, end: numFmts.closeStart, text: fragments },
          ]);
        }
      } else {
        nodes = indexXmlSpans(xml);
        const fonts = nodes.find((node) => node.local === "fonts");
        if (!fonts) throw new Error("Workbook styles XML is missing fonts");
        xml = applyXmlSplices(xml, [{
          start: fonts.start,
          end: fonts.start,
          text: `<numFmts count="${this.pendingNumberFormats.length}">${fragments}</numFmts>`,
        }]);
      }
    }

    if (this.pendingXfs.length > 0) {
      const nodes = indexXmlSpans(xml);
      const cellXfs = nodes.find((node) => node.local === "cellXfs");
      if (!cellXfs || cellXfs.selfClosing) throw new Error("Workbook styles XML has no writable cellXfs collection");
      const count = nodes.filter((node) => node.local === "xf" && node.parent === cellXfs).length;
      const opening = setXmlAttribute(xml.slice(cellXfs.start, cellXfs.openEnd), "count", String(count + this.pendingXfs.length));
      xml = applyXmlSplices(xml, [
        { start: cellXfs.start, end: cellXfs.openEnd, text: opening },
        { start: cellXfs.closeStart, end: cellXfs.closeStart, text: this.pendingXfs.join("") },
      ]);
    }
    return xml;
  }

  private ensureNumberFormat(formatCode: string): number {
    const existing = this.formatIdByCode.get(formatCode);
    if (existing !== undefined) return existing;
    const id = this.nextNumberFormatId++;
    this.pendingNumberFormats.push({ id, code: formatCode });
    this.formatIdByCode.set(formatCode, id);
    this.formatCodeById.set(id, formatCode);
    return id;
  }
}

function patchWorksheetCells(
  xml: string,
  patches: SpreadsheetBenchWorkbookCellPatch[],
  styles: WorkbookStylesEditor,
): string {
  const nodes = indexXmlSpans(xml);
  const sheetData = nodes.find((node) => node.local === "sheetData");
  if (!sheetData) throw new Error("Workbook worksheet XML is missing sheetData");
  const rows = nodes.filter((node) => node.local === "row" && node.parent === sheetData);
  const rowsByNumber = new Map(rows.map((row) => [Number(row.attrs.r), row]));
  const cells = nodes.filter((node) => node.local === "c" && node.parent?.local === "row");
  const cellsByAddress = new Map(cells.map((cell) => [normalizeAddress(cell.attrs.r ?? ""), cell]));
  const columnStyles = worksheetColumnStyles(nodes);
  const formulaGroupSplices = prepareFormulaGroupSplices(xml, nodes, patches);
  const rowPatches = new Map<number, SpreadsheetBenchWorkbookCellPatch[]>();
  for (const patch of patches) {
    const coordinate = parseAddress(patch.address);
    if (!coordinate) throw new Error(`Invalid workbook cell patch address ${patch.sheet}!${patch.address}`);
    const existing = rowPatches.get(coordinate.row) ?? [];
    existing.push(patch);
    rowPatches.set(coordinate.row, existing);
  }

  if (sheetData.selfClosing && rows.length === 0) {
    const content = [...rowPatches.entries()]
      .sort(([left], [right]) => left - right)
      .map(([rowNumber, rowItems]) => {
        const serialized = rowItems
          .sort((left, right) => parseAddress(left.address)!.col - parseAddress(right.address)!.col)
          .map((patch) => serializeCellPatch(
            xml,
            patch,
            undefined,
            effectiveCellStyle(undefined, undefined, parseAddress(patch.address)!.col, columnStyles),
            styles,
          ))
          .join("");
        return `<row r="${rowNumber}">${serialized}</row>`;
      })
      .join("");
    const opening = xml.slice(sheetData.start, sheetData.openEnd).replace(/\s*\/>$/, ">");
    return updateWorksheetDimension(
      applyXmlSplices(xml, [{
        start: sheetData.start,
        end: sheetData.end,
        text: `${opening}${content}</${sheetData.name}>`,
      }]),
    );
  }

  const splices: XmlSplice[] = [...formulaGroupSplices];
  const insertions = new Map<number, Array<{ col: number; text: string }>>();
  for (const [rowNumber, items] of rowPatches) {
    const row = rowsByNumber.get(rowNumber);
    if (!row) {
      const text = items
        .sort((left, right) => parseAddress(left.address)!.col - parseAddress(right.address)!.col)
        .map((patch) => serializeCellPatch(
          xml,
          patch,
          undefined,
          effectiveCellStyle(undefined, undefined, parseAddress(patch.address)!.col, columnStyles),
          styles,
        ))
        .join("");
      const nextRow = rows.find((candidate) => Number(candidate.attrs.r) > rowNumber);
      const position = nextRow?.start ?? sheetData.closeStart;
      const pending = insertions.get(position) ?? [];
      pending.push({ col: rowNumber, text: `<row r="${rowNumber}">${text}</row>` });
      insertions.set(position, pending);
      continue;
    }

    if (row.selfClosing) {
      const text = items
        .sort((left, right) => parseAddress(left.address)!.col - parseAddress(right.address)!.col)
        .map((patch) => serializeCellPatch(
          xml,
          patch,
          undefined,
          effectiveCellStyle(undefined, row, parseAddress(patch.address)!.col, columnStyles),
          styles,
        ))
        .join("");
      const opening = xml.slice(row.start, row.openEnd).replace(/\s*\/>$/, ">");
      splices.push({ start: row.start, end: row.end, text: `${opening}${text}</${row.name}>` });
      continue;
    }

    const rowCells = cells
      .filter((cell) => cell.parent === row)
      .sort((left, right) => parseAddress(left.attrs.r ?? "")!.col - parseAddress(right.attrs.r ?? "")!.col);
    for (const patch of items) {
      const coordinate = parseAddress(patch.address)!;
      const sourceCell = cellsByAddress.get(patch.address);
      if (sourceCell) {
        const sourceStyle = effectiveCellStyle(sourceCell, row, coordinate.col, columnStyles);
        splices.push({
          start: sourceCell.start,
          end: sourceCell.end,
          text: serializeCellPatch(xml, patch, sourceCell, sourceStyle, styles),
        });
        continue;
      }
      const nextCell = rowCells.find((cell) => parseAddress(cell.attrs.r ?? "")!.col > coordinate.col);
      const position = nextCell?.start ?? row.closeStart;
      const pending = insertions.get(position) ?? [];
      pending.push({
        col: coordinate.col,
        text: serializeCellPatch(
          xml,
          patch,
          undefined,
          effectiveCellStyle(undefined, row, coordinate.col, columnStyles),
          styles,
        ),
      });
      insertions.set(position, pending);
    }
  }

  for (const [position, values] of insertions) {
    splices.push({
      start: position,
      end: position,
      text: values.sort((left, right) => left.col - right.col).map((value) => value.text).join(""),
    });
  }
  return updateWorksheetDimension(applyXmlSplices(xml, splices));
}

function prepareFormulaGroupSplices(
  xml: string,
  nodes: XmlNodeSpan[],
  patches: SpreadsheetBenchWorkbookCellPatch[],
): XmlSplice[] {
  const patchAddresses = new Set(patches.map((patch) => patch.address));
  const formulaNodes = nodes.filter((node) => node.local === "f" && node.parent?.local === "c");

  for (const formula of formulaNodes.filter((node) => node.attrs.t === "array" || node.attrs.t === "dataTable")) {
    const masterAddress = normalizeAddress(formula.parent?.attrs.r ?? "");
    const range = parseCellRange(formula.attrs.ref ?? masterAddress);
    if (!range) {
      if (patchAddresses.has(masterAddress)) {
        throw new Error(`Refusing to patch malformed ${formula.attrs.t} formula group at ${patches[0]?.sheet}!${masterAddress}`);
      }
      continue;
    }
    const covered = [...patchAddresses].filter((address) => coordinateInRange(parseAddress(address), range)).length;
    if (covered > 0 && covered !== range.area) {
      throw new Error(
        `Refusing to patch ${formula.attrs.t} formula range ${patches[0]?.sheet}!${range.ref} without all ${range.area} cells`,
      );
    }
  }

  const sharedGroups = new Map<string, Array<{ cell: XmlNodeSpan; formula: XmlNodeSpan; address: string }>>();
  for (const formula of formulaNodes.filter((node) => node.attrs.t === "shared")) {
    const si = formula.attrs.si;
    const cell = formula.parent;
    const address = normalizeAddress(cell?.attrs.r ?? "");
    if (!si || !cell || !parseAddress(address)) {
      throw new Error(`Workbook contains a malformed shared formula group on ${patches[0]?.sheet}`);
    }
    const members = sharedGroups.get(si) ?? [];
    members.push({ cell, formula, address });
    sharedGroups.set(si, members);
  }

  const splices: XmlSplice[] = [];
  for (const [si, members] of sharedGroups) {
    if (!members.some((member) => patchAddresses.has(member.address))) continue;
    const master = members.find((member) => !member.formula.selfClosing
      && decodeXmlText(xml.slice(member.formula.openEnd, member.formula.closeStart)).length > 0);
    if (!master) {
      throw new Error(`Refusing to patch shared formula group ${si} on ${patches[0]?.sheet} because its master is missing`);
    }
    const masterFormula = decodeXmlText(xml.slice(master.formula.openEnd, master.formula.closeStart));
    if (!masterFormula) {
      throw new Error(`Refusing to patch shared formula group ${si} on ${patches[0]?.sheet} because its master formula is empty`);
    }
    for (const member of members) {
      if (patchAddresses.has(member.address)) continue;
      const formula = member === master
        ? masterFormula
        : slideSharedFormula(masterFormula, master.address, member.address);
      splices.push({
        start: member.formula.start,
        end: member.formula.end,
        text: `<${member.formula.name}>${escapeXmlText(formula)}</${member.formula.name}>`,
      });
    }
  }
  return splices;
}

function slideSharedFormula(formula: string, fromAddress: string, toAddress: string): string {
  const from = parseAddress(fromAddress);
  const to = parseAddress(toAddress);
  if (!from || !to) throw new Error(`Cannot translate shared formula from ${fromAddress} to ${toAddress}`);
  const candidate = /(([a-z_\-0-9]*)!)?([a-z0-9_$]{2,})([(])?/gi;
  const address = /^([$])?([a-z]+)([$])?([1-9][0-9]*)$/i;
  return formula.replace(candidate, (match, sheet: string | undefined, _sheetName: string | undefined, ref: string, call: string | undefined) => {
    if (call) return match;
    const parsed = address.exec(ref);
    if (!parsed) return match;
    const source = parseAddress(`${parsed[2]}${parsed[4]}`);
    if (!source) return match;
    const col = parsed[1] ? source.col : source.col + to.col - from.col;
    const row = parsed[3] ? source.row : source.row + to.row - from.row;
    if (col < 1 || row < 1 || col > 16_384 || row > 1_048_576) {
      throw new Error(`Shared formula translation from ${fromAddress} to ${toAddress} produced an invalid reference`);
    }
    const translated = addressFromPosition(row, col);
    const translatedMatch = /^([A-Z]+)([0-9]+)$/.exec(translated)!;
    return `${sheet ?? ""}${parsed[1] ?? ""}${translatedMatch[1]}${parsed[3] ?? ""}${translatedMatch[2]}`;
  });
}

function parseCellRange(value: string): {
  ref: string;
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  area: number;
} | undefined {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 2) return undefined;
  const start = parseAddress(parts[0]);
  const end = parseAddress(parts[1] ?? parts[0]);
  if (!start || !end) return undefined;
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  return {
    ref: `${addressFromPosition(minRow, minCol)}:${addressFromPosition(maxRow, maxCol)}`,
    minRow,
    maxRow,
    minCol,
    maxCol,
    area: (maxRow - minRow + 1) * (maxCol - minCol + 1),
  };
}

function coordinateInRange(
  coordinate: CellCoordinate | undefined,
  range: { minRow: number; maxRow: number; minCol: number; maxCol: number },
): boolean {
  return Boolean(coordinate
    && coordinate.row >= range.minRow
    && coordinate.row <= range.maxRow
    && coordinate.col >= range.minCol
    && coordinate.col <= range.maxCol);
}

function serializeCellPatch(
  xml: string,
  patch: SpreadsheetBenchWorkbookCellPatch,
  sourceCell: XmlNodeSpan | undefined,
  sourceStyleIndex: number,
  styles: WorkbookStylesEditor,
): string {
  const formulaElement = patch.kind === "formula"
    ? sourceFormulaElement(xml, sourceCell, patch)
    : { opening: "<f>", closing: "</f>" };

  const styleIndex = patch.numFmt === undefined
    ? sourceStyleIndex
    : styles.ensureNumberFormatStyle(sourceStyleIndex, patch.numFmt);
  const tagName = sourceCell?.name ?? "c";
  let opening = sourceCell ? xml.slice(sourceCell.start, sourceCell.openEnd) : `<${tagName} r="${patch.address}">`;
  opening = opening.replace(/\s*\/>$/, ">");
  opening = setXmlAttribute(opening, "r", patch.address);
  opening = removeXmlAttribute(opening, "t");
  if (patch.numFmt !== undefined) {
    opening = setXmlAttribute(opening, "s", String(styleIndex));
  }

  if (patch.kind === "clear") return opening.replace(/>$/, "/>");
  if (patch.kind === "formula") {
    if (!patch.formula) throw new Error(`Formula patch ${patch.sheet}!${patch.address} is missing formula text`);
    const cached = patch.hasCachedResult ? serializedScalar(patch.cachedResult, true) : undefined;
    if (cached?.type) opening = setXmlAttribute(opening, "t", cached.type);
    const cachedXml = cached ? `<v>${cached.valueXml}</v>` : "";
    return `${opening}${formulaElement.opening}${escapeXmlText(patch.formula.replace(/^=/, ""))}${formulaElement.closing}${cachedXml}</${tagName}>`;
  }

  const scalar = serializedScalar(patch.value, false);
  if (scalar.type) opening = setXmlAttribute(opening, "t", scalar.type);
  if (scalar.inlineString) {
    const preserve = /^\s|\s$/.test(scalar.textValue ?? "") ? ' xml:space="preserve"' : "";
    return `${opening}<is><t${preserve}>${scalar.valueXml}</t></is></${tagName}>`;
  }
  return `${opening}<v>${scalar.valueXml}</v></${tagName}>`;
}

function sourceFormulaElement(
  xml: string,
  sourceCell: XmlNodeSpan | undefined,
  patch: SpreadsheetBenchWorkbookCellPatch,
): { opening: string; closing: string } {
  if (!sourceCell) return { opening: "<f>", closing: "</f>" };
  const sourceCellXml = xml.slice(sourceCell.start, sourceCell.end);
  const formula = indexXmlSpans(sourceCellXml).find((node) => node.local === "f");
  if (!formula) return { opening: "<f>", closing: "</f>" };
  const formulaType = formula.attrs.t;
  if (formulaType === "shared" || formulaType === "dataTable") {
    return { opening: `<${formula.name}>`, closing: `</${formula.name}>` };
  }
  if (formulaType === "array") {
    const arrayRef = formula.attrs.ref?.split(":").map(normalizeAddress);
    if (!arrayRef || arrayRef.length !== 1 || arrayRef[0] !== patch.address) {
      return { opening: `<${formula.name}>`, closing: `</${formula.name}>` };
    }
    return {
      opening: sourceCellXml.slice(formula.start, formula.openEnd).replace(/\s*\/>$/, ">"),
      closing: `</${formula.name}>`,
    };
  }
  return { opening: `<${formula.name}>`, closing: `</${formula.name}>` };
}

function serializedScalar(value: unknown, formulaResult: boolean): {
  type?: string;
  valueXml: string;
  inlineString?: boolean;
  textValue?: string;
} {
  if (value === null || value === undefined) return { valueXml: "" };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Workbook patch cannot serialize non-finite number ${String(value)}`);
    return { valueXml: String(value) };
  }
  if (typeof value === "boolean") return { type: "b", valueXml: value ? "1" : "0" };
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) throw new Error("Workbook patch cannot serialize an invalid Date");
    return { valueXml: String((time - Date.UTC(1899, 11, 30)) / 86_400_000) };
  }
  const record = asRecord(value);
  if (typeof record?.error === "string") return { type: "e", valueXml: escapeXmlText(record.error) };
  const richText = Array.isArray(record?.richText)
    ? record.richText.map((part) => {
      const text = asRecord(part)?.text;
      if (typeof text !== "string") throw new Error("Workbook patch rich-text runs must contain text");
      return text;
    }).join("")
    : undefined;
  const text = typeof value === "string"
    ? value
    : typeof record?.text === "string"
      ? record.text
      : richText;
  if (text === undefined) {
    throw new Error(`Workbook patch cannot serialize ${Array.isArray(value) ? "an array" : typeof value} as a cell scalar`);
  }
  return formulaResult
    ? { type: "str", valueXml: escapeXmlText(text), textValue: text }
    : { type: "inlineStr", valueXml: escapeXmlText(text), inlineString: true, textValue: text };
}

function updateWorksheetDimension(xml: string): string {
  const nodes = indexXmlSpans(xml);
  const cells = nodes.filter((node) => node.local === "c" && parseAddress(node.attrs.r ?? ""));
  if (cells.length === 0) return xml;
  const coordinates = cells.map((cell) => parseAddress(cell.attrs.r ?? "")!);
  const minRow = Math.min(...coordinates.map((coordinate) => coordinate.row));
  const maxRow = Math.max(...coordinates.map((coordinate) => coordinate.row));
  const minCol = Math.min(...coordinates.map((coordinate) => coordinate.col));
  const maxCol = Math.max(...coordinates.map((coordinate) => coordinate.col));
  const ref = minRow === maxRow && minCol === maxCol
    ? addressFromPosition(minRow, minCol)
    : `${addressFromPosition(minRow, minCol)}:${addressFromPosition(maxRow, maxCol)}`;
  const dimension = nodes.find((node) => node.local === "dimension");
  if (!dimension) return xml;
  const opening = setXmlAttribute(xml.slice(dimension.start, dimension.openEnd), "ref", ref);
  return applyXmlSplices(xml, [{ start: dimension.start, end: dimension.openEnd, text: opening }]);
}

async function markWorkbookForFullCalculation(zip: JSZip): Promise<void> {
  const workbookPath = "xl/workbook.xml";
  const workbook = await requiredZipText(zip, workbookPath);

  const nodes = indexXmlSpans(workbook);
  const calcPr = nodes.find((node) => node.local === "calcPr");
  let nextWorkbook: string;
  if (calcPr) {
    let opening = workbook.slice(calcPr.start, calcPr.openEnd);
    opening = setXmlAttribute(opening, "calcMode", "auto");
    opening = setXmlAttribute(opening, "fullCalcOnLoad", "1");
    opening = setXmlAttribute(opening, "forceFullCalc", "1");
    opening = setXmlAttribute(opening, "calcOnSave", "1");
    nextWorkbook = applyXmlSplices(workbook, [{ start: calcPr.start, end: calcPr.openEnd, text: opening }]);
  } else {
    const workbookNode = nodes.find((node) => node.local === "workbook");
    if (!workbookNode || workbookNode.selfClosing) throw new Error("Workbook XML has no writable workbook element");
    nextWorkbook = applyXmlSplices(workbook, [{
      start: workbookNode.closeStart,
      end: workbookNode.closeStart,
      text: '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1" calcOnSave="1"/>',
    }]);
  }
  assertWellFormedXml(nextWorkbook, workbookPath);
  zip.file(workbookPath, nextWorkbook);
}

async function workbookSheetParts(zip: JSZip): Promise<WorkbookSheetPart[]> {
  const workbookPath = "xl/workbook.xml";
  const workbookXml = await requiredZipText(zip, workbookPath);
  const relsXml = await requiredZipText(zip, "xl/_rels/workbook.xml.rels");
  const relationships = new Map<string, string>();
  for (const node of indexXmlSpans(relsXml).filter((candidate) => candidate.local === "Relationship")) {
    if (!node.attrs.Id || !node.attrs.Target) continue;
    if (node.attrs.TargetMode?.toLowerCase() === "external") continue;
    if (node.attrs.Type && !node.attrs.Type.endsWith("/worksheet")) continue;
    relationships.set(node.attrs.Id, resolvePackageTarget(workbookPath, node.attrs.Target));
  }
  return indexXmlSpans(workbookXml)
    .filter((node) => node.local === "sheet")
    .flatMap((node) => {
      const path = node.attrs["r:id"] ? relationships.get(node.attrs["r:id"]) : undefined;
      return node.attrs.name && path ? [{ name: node.attrs.name, path }] : [];
    });
}

function indexXmlSpans(xml: string): XmlNodeSpan[] {
  const parser = new SaxesParser({ xmlns: true });
  const nodes: XmlNodeSpan[] = [];
  const stack: XmlNodeSpan[] = [];
  let pendingStart = 0;
  parser.on("opentagstart", (tag) => {
    pendingStart = parser.position - tag.name.length - 2;
  });
  parser.on("opentag", (tag) => {
    const node: XmlNodeSpan = {
      name: tag.name,
      local: tag.local,
      attrs: saxesAttributes(tag),
      start: pendingStart,
      openEnd: parser.position,
      closeStart: parser.position,
      end: parser.position,
      selfClosing: tag.isSelfClosing,
      ...(stack.at(-1) ? { parent: stack.at(-1) } : {}),
    };
    stack.push(node);
  });
  parser.on("closetag", () => {
    const node = stack.pop();
    if (!node) throw new Error("Malformed XML parser stack");
    node.end = parser.position;
    node.closeStart = node.selfClosing ? node.openEnd : xml.lastIndexOf("</", parser.position - 1);
    if (node.closeStart < node.openEnd) throw new Error(`Malformed closing tag for ${node.name}`);
    nodes.push(node);
  });
  parser.write(xml).close();
  return nodes;
}

function saxesAttributes(tag: SaxesTagNS): Record<string, string> {
  return Object.fromEntries(Object.values(tag.attributes).map((attribute) => [attribute.name, attribute.value]));
}

function assertWellFormedXml(xml: string, label: string): void {
  try {
    indexXmlSpans(xml);
  } catch (error) {
    throw new Error(`${label} is not well-formed after workbook patching: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function setElementAttribute(elementXml: string, name: string, value: string): string {
  const end = elementXml.indexOf(">");
  if (end < 0) throw new Error("Malformed XML element");
  return `${setXmlAttribute(elementXml.slice(0, end + 1), name, value)}${elementXml.slice(end + 1)}`;
}

function setXmlAttribute(openingTag: string, name: string, value: string): string {
  const expression = new RegExp(`(\\s${escapeRegExp(name)}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, "i");
  if (expression.test(openingTag)) {
    return openingTag.replace(expression, (_match, prefix: string) => `${prefix}"${escapeXmlAttribute(value)}"`);
  }
  return openingTag.replace(/\s*(\/?>)$/, ` ${name}="${escapeXmlAttribute(value)}"$1`);
}

function removeXmlAttribute(openingTag: string, name: string): string {
  return openingTag.replace(new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(["'])[\\s\\S]*?\\1`, "i"), "");
}

function applyXmlSplices(xml: string, splices: XmlSplice[]): string {
  const ordered = [...splices].sort((left, right) => right.start - left.start || right.end - left.end);
  let previousStart = xml.length + 1;
  let result = xml;
  for (const splice of ordered) {
    if (splice.start < 0 || splice.end < splice.start || splice.end > xml.length) throw new Error("Invalid XML splice bounds");
    if (splice.end > previousStart) throw new Error("Overlapping XML workbook patches are not allowed");
    result = `${result.slice(0, splice.start)}${splice.text}${result.slice(splice.end)}`;
    previousStart = splice.start;
  }
  return result;
}

function worksheetColumnStyles(nodes: XmlNodeSpan[]): ColumnStyleRange[] {
  return nodes
    .filter((node) => node.local === "col" && node.parent?.local === "cols")
    .flatMap((node) => {
      const min = numericAttribute(node.attrs.min);
      const max = numericAttribute(node.attrs.max);
      const style = numericAttribute(node.attrs.style);
      return min && max && min <= max && style !== undefined ? [{ min, max, style }] : [];
    });
}

function effectiveCellStyle(
  cell: XmlNodeSpan | undefined,
  row: XmlNodeSpan | undefined,
  column: number,
  columnStyles: ColumnStyleRange[],
): number {
  const direct = numericAttribute(cell?.attrs.s);
  if (direct !== undefined) return direct;
  const rowStyle = numericAttribute(row?.attrs.s);
  if (rowStyle !== undefined) return rowStyle;
  for (let index = columnStyles.length - 1; index >= 0; index -= 1) {
    const range = columnStyles[index];
    if (column >= range.min && column <= range.max) return range.style;
  }
  return 0;
}

function numericAttribute(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseAddress(value: string): CellCoordinate | undefined {
  const match = normalizeAddress(value).match(/^([A-Z]{1,3})([1-9][0-9]*)$/);
  if (!match) return undefined;
  const row = Number(match[2]);
  const col = match[1].split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
  return row <= 1_048_576 && col <= 16_384 ? { row, col } : undefined;
}

function addressFromPosition(row: number, col: number): string {
  let name = "";
  let remaining = col;
  while (remaining > 0) {
    name = String.fromCharCode(65 + ((remaining - 1) % 26)) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return `${name}${row}`;
}

function normalizeAddress(value: string): string {
  return value.trim().replace(/\$/g, "").toUpperCase();
}

async function requiredZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Workbook package is missing ${path}`);
  return file.async("string");
}

function resolvePackageTarget(ownerPartPath: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  const joined = normalizedTarget.startsWith("/")
    ? normalizedTarget
    : posix.join(posix.dirname(ownerPartPath), normalizedTarget);
  const normalized = posix.normalize(joined).replace(/^\/+/, "");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`Relationship target escapes the workbook package: ${target}`);
  }
  return normalized;
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function decodeXmlText(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (entity, token: string) => {
    const lower = token.toLowerCase();
    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return '"';
    if (lower === "apos") return "'";
    const codePoint = lower.startsWith("#x")
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10);
    return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : entity;
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function atomicCopyFile(sourcePath: string, targetPath: string): void {
  const temporaryPath = temporarySiblingPath(targetPath);
  try {
    copyFileSync(sourcePath, temporaryPath);
    renameSync(temporaryPath, targetPath);
  } catch (error) {
    tryUnlink(temporaryPath);
    throw error;
  }
}

function atomicWriteFile(targetPath: string, content: Buffer): void {
  const temporaryPath = temporarySiblingPath(targetPath);
  try {
    writeFileSync(temporaryPath, content, { flag: "wx" });
    renameSync(temporaryPath, targetPath);
  } catch (error) {
    tryUnlink(temporaryPath);
    throw error;
  }
}

function temporarySiblingPath(targetPath: string): string {
  return join(dirname(targetPath), `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`);
}

function tryUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // Best-effort cleanup after a failed atomic replace.
  }
}
