export const SPREADSHEET_BENCH_CHART_CONTRACT_VERSION = 2 as const;

export const SPREADSHEET_BENCH_CHART_TYPES = [
  "line",
  "bar",
  "column",
  "pie",
  "doughnut",
  "scatter",
  "area",
  "bubble",
  "combo",
] as const;

export const SPREADSHEET_BENCH_COMBO_SERIES_TYPES = ["line", "bar", "column", "area"] as const;
export const SPREADSHEET_BENCH_LEGEND_POSITIONS = ["top", "bottom", "left", "right", "none"] as const;
export const SPREADSHEET_BENCH_CHART_GROUPINGS = ["clustered", "stacked", "percentStacked"] as const;

export type SpreadsheetBenchChartType = typeof SPREADSHEET_BENCH_CHART_TYPES[number];
export type SpreadsheetBenchComboSeriesType = typeof SPREADSHEET_BENCH_COMBO_SERIES_TYPES[number];
export type SpreadsheetBenchLegendPosition = typeof SPREADSHEET_BENCH_LEGEND_POSITIONS[number];
export type SpreadsheetBenchChartGrouping = typeof SPREADSHEET_BENCH_CHART_GROUPINGS[number];

export type SpreadsheetBenchChartSeries = {
  name: string;
  valuesRange: string;
  chartType?: SpreadsheetBenchComboSeriesType;
  xValuesRange?: string;
  sizeRange?: string;
  color?: string;
  secondaryAxis?: boolean;
};

export type SpreadsheetBenchChartOperation = {
  op: "add_chart";
  sheet: string;
  chartType: SpreadsheetBenchChartType;
  title: string;
  categoryRange: string;
  series: SpreadsheetBenchChartSeries[];
  anchor: string;
  width?: number;
  height?: number;
  legendPosition: SpreadsheetBenchLegendPosition;
  grouping?: SpreadsheetBenchChartGrouping;
  dataLabels?: boolean;
};

export type SpreadsheetBenchChartWorkbookShape = {
  sheets: ReadonlyArray<{
    name: string;
    maxRow?: number;
    maxColumn?: number;
    state?: "visible" | "hidden" | "veryHidden";
  }>;
};

export type SpreadsheetBenchParsedChartRange = {
  input: string;
  sheet: string;
  address: string;
  formula: string;
  minColumn: number;
  minRow: number;
  maxColumn: number;
  maxRow: number;
  pointCount: number;
};

export type SpreadsheetBenchValidatedChartOperation = {
  operation: SpreadsheetBenchChartOperation;
  effectiveChartType: SpreadsheetBenchChartType;
  categoryRange: SpreadsheetBenchParsedChartRange;
  seriesRanges: Array<{
    valuesRange: SpreadsheetBenchParsedChartRange;
    xValuesRange?: SpreadsheetBenchParsedChartRange;
    sizeRange?: SpreadsheetBenchParsedChartRange;
  }>;
};

export type SpreadsheetBenchChartContractIssue = {
  path: string;
  code: string;
  message: string;
};

export type SpreadsheetBenchChartContractResult =
  | { ok: true; charts: SpreadsheetBenchValidatedChartOperation[] }
  | { ok: false; issues: SpreadsheetBenchChartContractIssue[] };

export type SpreadsheetBenchChartBridgeReceipt = {
  schema: 2;
  contractVersion: 2;
  status: "applied" | "rejected";
  workbook: string;
  engine: "excel" | "openpyxl";
  appliedChartCount: number;
  operationCount: number;
  package: {
    chartObjectCountBefore: number;
    chartObjectCountAfter: number;
    chartPartCountBefore: number;
    chartPartCountAfter: number;
    drawingPartCountAfter: number;
  };
  operations: Array<{
    index: number;
    chartType: SpreadsheetBenchChartType;
    effectiveChartType: SpreadsheetBenchChartType;
    sheet: string;
    title: string;
    anchor: string;
    legendPosition: SpreadsheetBenchLegendPosition;
    chartPart: string;
    verified: boolean;
  }>;
  error?: { type: string; message: string };
};

const MAX_EXCEL_ROW = 1_048_576;
const MAX_EXCEL_COLUMN = 16_384;
const MAX_CHART_POINTS = 100_000;
const MAX_CHART_OPERATIONS = 32;
const MAX_CHART_SERIES = 12;
const DEFAULT_WIDTH = 18;
const DEFAULT_HEIGHT = 10;
const RANGE_PATTERN = /^(?:(?:'((?:[^']|'')+)'|([^'!\[\]]+))!)?\$?([A-Z]{1,3})\$?([1-9][0-9]*):\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/i;
const CELL_PATTERN = /^([A-Z]{1,3})([1-9][0-9]*)$/i;

const CHART_TYPE_SET = new Set<string>(SPREADSHEET_BENCH_CHART_TYPES);
const COMBO_TYPE_SET = new Set<string>(SPREADSHEET_BENCH_COMBO_SERIES_TYPES);
const LEGEND_POSITION_SET = new Set<string>(SPREADSHEET_BENCH_LEGEND_POSITIONS);
const GROUPING_SET = new Set<string>(SPREADSHEET_BENCH_CHART_GROUPINGS);
const OPERATION_KEYS = new Set([
  "op", "sheet", "chartType", "title", "categoryRange", "series", "anchor",
  "width", "height", "legendPosition", "grouping", "dataLabels",
]);
const SERIES_KEYS = new Set([
  "name", "valuesRange", "chartType", "xValuesRange", "sizeRange", "color", "secondaryAxis",
]);

export const SPREADSHEET_BENCH_CHART_OPERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["op", "sheet", "chartType", "title", "categoryRange", "series", "anchor", "legendPosition"],
  properties: {
    op: { const: "add_chart" },
    sheet: { type: "string", minLength: 1 },
    chartType: { enum: [...SPREADSHEET_BENCH_CHART_TYPES] },
    title: { type: "string", minLength: 1, maxLength: 160 },
    categoryRange: { type: "string", description: "A one-dimensional A1 range; qualify cross-sheet sources." },
    series: {
      type: "array",
      minItems: 1,
      maxItems: MAX_CHART_SERIES,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "valuesRange"],
        properties: {
          name: { type: "string", minLength: 1, maxLength: 160 },
          valuesRange: { type: "string" },
          chartType: { enum: [...SPREADSHEET_BENCH_COMBO_SERIES_TYPES] },
          xValuesRange: { type: "string" },
          sizeRange: { type: "string" },
          color: { type: "string", pattern: "^#?[0-9A-Fa-f]{6}$" },
          secondaryAxis: { type: "boolean" },
        },
      },
    },
    anchor: { type: "string", pattern: "^[A-Za-z]{1,3}[1-9][0-9]*$" },
    width: { type: "number", minimum: 6, maximum: 36 },
    height: { type: "number", minimum: 4, maximum: 24 },
    legendPosition: { enum: [...SPREADSHEET_BENCH_LEGEND_POSITIONS] },
    grouping: { enum: [...SPREADSHEET_BENCH_CHART_GROUPINGS] },
    dataLabels: { type: "boolean" },
  },
} as const;

export const SPREADSHEET_BENCH_CHART_AGENT_INSTRUCTIONS = [
  `Chart operations use contract v${SPREADSHEET_BENCH_CHART_CONTRACT_VERSION} and op=add_chart.`,
  `Supported chartType values: ${SPREADSHEET_BENCH_CHART_TYPES.join(", ")}.`,
  "Always provide a non-empty title, an exact visible target sheet, an A1 anchor, and legendPosition (use none to omit it).",
  "Use one-dimensional, contiguous A1 source ranges. Qualify cross-sheet ranges, keep category/x/y/size point counts equal, and do not use external, union, named, or 3-D references.",
  "Scatter series require xValuesRange. Bubble series require both xValuesRange and sizeRange.",
  "Pie and doughnut charts accept exactly one series.",
  `Combo charts require at least two series; set each series.chartType to one of ${SPREADSHEET_BENCH_COMBO_SERIES_TYPES.join(", ")} and set secondaryAxis on the series that needs it.`,
  "A successful bridge call must return a receipt proving the chart part, drawing anchor, title, legend, and source formulas were persisted.",
  'Example: {"op":"add_chart","sheet":"Dashboard","chartType":"combo","title":"Revenue and Margin","categoryRange":"\'Data\'!A2:A13","series":[{"name":"Revenue","valuesRange":"\'Data\'!B2:B13","chartType":"column"},{"name":"Margin","valuesRange":"\'Data\'!C2:C13","chartType":"line","secondaryAxis":true}],"anchor":"B2","legendPosition":"bottom"}',
].join("\n");

export class SpreadsheetBenchChartContractError extends Error {
  readonly issues: SpreadsheetBenchChartContractIssue[];

  constructor(issues: SpreadsheetBenchChartContractIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "SpreadsheetBenchChartContractError";
    this.issues = issues;
  }
}

export function parseSpreadsheetBenchChartRange(
  input: unknown,
  defaultSheet: string,
): SpreadsheetBenchParsedChartRange | undefined {
  if (typeof input !== "string") return undefined;
  const value = input.trim().replace(/^=/, "");
  if (!value || value.includes("[") || value.includes("]") || value.includes(",")) return undefined;
  const match = value.match(RANGE_PATTERN);
  if (!match) return undefined;
  const sheet = (match[1]?.replace(/''/g, "'") ?? match[2]?.trim() ?? defaultSheet).trim();
  const minColumn = columnNameToNumber(match[3]);
  const minRow = Number(match[4]);
  const maxColumn = columnNameToNumber(match[5]);
  const maxRow = Number(match[6]);
  if (!sheet || minColumn < 1 || maxColumn > MAX_EXCEL_COLUMN || minRow < 1 || maxRow > MAX_EXCEL_ROW) return undefined;
  if (minColumn > maxColumn || minRow > maxRow) return undefined;
  if (minColumn !== maxColumn && minRow !== maxRow) return undefined;
  const pointCount = (maxColumn - minColumn + 1) * (maxRow - minRow + 1);
  if (pointCount > MAX_CHART_POINTS) return undefined;
  const address = `$${columnNumberToName(minColumn)}$${minRow}:$${columnNumberToName(maxColumn)}$${maxRow}`;
  return {
    input,
    sheet,
    address,
    formula: `${quoteSheetName(sheet)}!${address}`,
    minColumn,
    minRow,
    maxColumn,
    maxRow,
    pointCount,
  };
}

export function validateSpreadsheetBenchChartOperations(
  input: unknown,
  workbook?: SpreadsheetBenchChartWorkbookShape,
): SpreadsheetBenchChartContractResult {
  const issues: SpreadsheetBenchChartContractIssue[] = [];
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_CHART_OPERATIONS) {
    return {
      ok: false,
      issues: [{
        path: "operations",
        code: "operation_count",
        message: `expected 1-${MAX_CHART_OPERATIONS} chart operations`,
      }],
    };
  }

  const sheets = new Map(workbook?.sheets.map((sheet) => [sheet.name, sheet]) ?? []);
  const usedAnchors = new Set<string>();
  const charts: SpreadsheetBenchValidatedChartOperation[] = [];

  input.forEach((raw, index) => {
    const path = `operations[${index}]`;
    const startIssueCount = issues.length;
    if (!isRecord(raw)) {
      issues.push({ path, code: "operation_type", message: "chart operation must be an object" });
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!OPERATION_KEYS.has(key)) issues.push({ path: `${path}.${key}`, code: "unknown_field", message: "field is not part of the chart contract" });
    }

    const sheet = requiredText(raw.sheet, `${path}.sheet`, issues, 31);
    const title = requiredText(raw.title, `${path}.title`, issues, 160);
    const chartType = typeof raw.chartType === "string" && CHART_TYPE_SET.has(raw.chartType)
      ? raw.chartType as SpreadsheetBenchChartType
      : undefined;
    if (raw.op !== "add_chart") issues.push({ path: `${path}.op`, code: "invalid_op", message: "expected add_chart" });
    if (!chartType) issues.push({ path: `${path}.chartType`, code: "unsupported_chart_type", message: `expected one of ${SPREADSHEET_BENCH_CHART_TYPES.join(", ")}` });

    const targetSheet = sheet ? sheets.get(sheet) : undefined;
    if (workbook && sheet && !targetSheet) issues.push({ path: `${path}.sheet`, code: "missing_sheet", message: `workbook has no sheet named ${sheet}` });
    if (targetSheet?.state && targetSheet.state !== "visible") issues.push({ path: `${path}.sheet`, code: "hidden_target_sheet", message: "target sheet must be visible" });

    const anchor = parseAnchor(raw.anchor);
    if (!anchor) issues.push({ path: `${path}.anchor`, code: "invalid_anchor", message: "anchor must be one A1 cell within Excel bounds" });
    if (sheet && anchor) {
      const anchorKey = `${sheet.toLocaleLowerCase()}:${anchor}`;
      if (usedAnchors.has(anchorKey)) issues.push({ path: `${path}.anchor`, code: "duplicate_anchor", message: "two charts cannot share the same target anchor" });
      usedAnchors.add(anchorKey);
    }

    const legendPosition = typeof raw.legendPosition === "string" && LEGEND_POSITION_SET.has(raw.legendPosition)
      ? raw.legendPosition as SpreadsheetBenchLegendPosition
      : undefined;
    if (!legendPosition) issues.push({ path: `${path}.legendPosition`, code: "invalid_legend", message: `expected one of ${SPREADSHEET_BENCH_LEGEND_POSITIONS.join(", ")}` });
    const grouping = raw.grouping === undefined
      ? "clustered"
      : typeof raw.grouping === "string" && GROUPING_SET.has(raw.grouping)
        ? raw.grouping as SpreadsheetBenchChartGrouping
        : undefined;
    if (!grouping) issues.push({ path: `${path}.grouping`, code: "invalid_grouping", message: `expected one of ${SPREADSHEET_BENCH_CHART_GROUPINGS.join(", ")}` });
    const width = boundedDimension(raw.width, DEFAULT_WIDTH, 6, 36, `${path}.width`, issues);
    const height = boundedDimension(raw.height, DEFAULT_HEIGHT, 4, 24, `${path}.height`, issues);
    if (raw.dataLabels !== undefined && typeof raw.dataLabels !== "boolean") {
      issues.push({ path: `${path}.dataLabels`, code: "invalid_boolean", message: "dataLabels must be boolean" });
    }

    const categoryRange = sheet ? parseSpreadsheetBenchChartRange(raw.categoryRange, sheet) : undefined;
    if (!categoryRange) issues.push({ path: `${path}.categoryRange`, code: "invalid_source_range", message: "expected a bounded one-dimensional A1 range" });
    else validateRangeAgainstWorkbook(categoryRange, `${path}.categoryRange`, sheets, workbook, issues);

    const rawSeries = Array.isArray(raw.series) ? raw.series : undefined;
    if (!rawSeries || rawSeries.length < 1 || rawSeries.length > MAX_CHART_SERIES) {
      issues.push({ path: `${path}.series`, code: "series_count", message: `expected 1-${MAX_CHART_SERIES} series` });
    }

    let normalizedSeries: SpreadsheetBenchChartSeries[] = [];
    const seriesRanges: SpreadsheetBenchValidatedChartOperation["seriesRanges"] = [];
    for (const [seriesIndex, rawItem] of (rawSeries ?? []).entries()) {
      const seriesPath = `${path}.series[${seriesIndex}]`;
      if (!isRecord(rawItem)) {
        issues.push({ path: seriesPath, code: "series_type", message: "series must be an object" });
        continue;
      }
      for (const key of Object.keys(rawItem)) {
        if (!SERIES_KEYS.has(key)) issues.push({ path: `${seriesPath}.${key}`, code: "unknown_field", message: "field is not part of the chart series contract" });
      }
      const name = requiredText(rawItem.name, `${seriesPath}.name`, issues, 160);
      const valuesRange = sheet ? parseSpreadsheetBenchChartRange(rawItem.valuesRange, sheet) : undefined;
      if (!valuesRange) issues.push({ path: `${seriesPath}.valuesRange`, code: "invalid_source_range", message: "expected a bounded one-dimensional A1 range" });
      else validateRangeAgainstWorkbook(valuesRange, `${seriesPath}.valuesRange`, sheets, workbook, issues);

      const seriesChartType = rawItem.chartType === undefined
        ? undefined
        : typeof rawItem.chartType === "string" && COMBO_TYPE_SET.has(rawItem.chartType)
          ? rawItem.chartType as SpreadsheetBenchComboSeriesType
          : undefined;
      if (rawItem.chartType !== undefined && !seriesChartType) issues.push({ path: `${seriesPath}.chartType`, code: "invalid_combo_type", message: `expected one of ${SPREADSHEET_BENCH_COMBO_SERIES_TYPES.join(", ")}` });
      if (rawItem.secondaryAxis !== undefined && typeof rawItem.secondaryAxis !== "boolean") issues.push({ path: `${seriesPath}.secondaryAxis`, code: "invalid_boolean", message: "secondaryAxis must be boolean" });
      if (rawItem.color !== undefined && (typeof rawItem.color !== "string" || !/^#?[0-9a-f]{6}$/i.test(rawItem.color))) {
        issues.push({ path: `${seriesPath}.color`, code: "invalid_color", message: "color must be exactly six hexadecimal digits" });
      }

      const needsXValues = chartType === "scatter" || chartType === "bubble";
      const xInput = rawItem.xValuesRange;
      const xValuesRange = xInput !== undefined && sheet ? parseSpreadsheetBenchChartRange(xInput, sheet) : undefined;
      if (needsXValues && !xValuesRange) issues.push({ path: `${seriesPath}.xValuesRange`, code: "missing_x_range", message: "scatter and bubble series require a valid xValuesRange" });
      else if (xValuesRange) validateRangeAgainstWorkbook(xValuesRange, `${seriesPath}.xValuesRange`, sheets, workbook, issues);
      if (!needsXValues && rawItem.xValuesRange !== undefined) {
        issues.push({ path: `${seriesPath}.xValuesRange`, code: "unexpected_x_range", message: "xValuesRange is only valid for scatter and bubble charts" });
      }

      const sizeRange = rawItem.sizeRange !== undefined && sheet
        ? parseSpreadsheetBenchChartRange(rawItem.sizeRange, sheet)
        : undefined;
      if (chartType === "bubble" && !sizeRange) issues.push({ path: `${seriesPath}.sizeRange`, code: "missing_size_range", message: "bubble series require a valid sizeRange" });
      else if (sizeRange) validateRangeAgainstWorkbook(sizeRange, `${seriesPath}.sizeRange`, sheets, workbook, issues);
      if (chartType !== "bubble" && rawItem.sizeRange !== undefined) {
        issues.push({ path: `${seriesPath}.sizeRange`, code: "unexpected_size_range", message: "sizeRange is only valid for bubble charts" });
      }

      const expectedPoints = needsXValues ? xValuesRange?.pointCount : categoryRange?.pointCount;
      if (valuesRange && expectedPoints !== undefined && valuesRange.pointCount !== expectedPoints) {
        issues.push({ path: `${seriesPath}.valuesRange`, code: "point_count_mismatch", message: `expected ${expectedPoints} points, received ${valuesRange.pointCount}` });
      }
      if (sizeRange && expectedPoints !== undefined && sizeRange.pointCount !== expectedPoints) {
        issues.push({ path: `${seriesPath}.sizeRange`, code: "point_count_mismatch", message: `expected ${expectedPoints} points, received ${sizeRange.pointCount}` });
      }

      if (name && valuesRange) {
        normalizedSeries.push({
          name,
          valuesRange: valuesRange.formula,
          ...(seriesChartType ? { chartType: seriesChartType } : {}),
          ...(xValuesRange ? { xValuesRange: xValuesRange.formula } : {}),
          ...(sizeRange ? { sizeRange: sizeRange.formula } : {}),
          ...(typeof rawItem.color === "string" && /^#?[0-9a-f]{6}$/i.test(rawItem.color) ? { color: rawItem.color.replace(/^#/, "").toUpperCase() } : {}),
          ...(typeof rawItem.secondaryAxis === "boolean" ? { secondaryAxis: rawItem.secondaryAxis } : {}),
        });
        seriesRanges.push({ valuesRange, ...(xValuesRange ? { xValuesRange } : {}), ...(sizeRange ? { sizeRange } : {}) });
      }
    }

    const hasSeriesOverrides = normalizedSeries.some((series) => series.chartType || series.secondaryAxis);
    const effectiveChartType = chartType === "combo" || hasSeriesOverrides ? "combo" : chartType;
    if (effectiveChartType === "combo" && chartType !== "combo" && chartType && COMBO_TYPE_SET.has(chartType)) {
      const fallbackType = chartType as SpreadsheetBenchComboSeriesType;
      normalizedSeries = normalizedSeries.map((series) => ({ chartType: fallbackType, ...series }));
    }
    if (effectiveChartType === "combo") {
      if (normalizedSeries.length < 2) issues.push({ path: `${path}.series`, code: "combo_series_count", message: "combo charts require at least two series" });
      if (normalizedSeries.some((series) => !series.chartType)) issues.push({ path: `${path}.series`, code: "combo_series_type", message: "every explicit combo series must declare chartType" });
      if (!normalizedSeries.some((series) => !series.secondaryAxis)) issues.push({ path: `${path}.series`, code: "combo_primary_axis", message: "combo charts require at least one primary-axis series" });
      const distinctTypes = new Set(normalizedSeries.map((series) => series.chartType));
      if (distinctTypes.size < 2 && !normalizedSeries.some((series) => series.secondaryAxis)) {
        issues.push({ path: `${path}.series`, code: "not_a_combo", message: "combo charts need multiple series types or a secondary axis" });
      }
    }
    else if (normalizedSeries.some((series) => series.chartType || series.secondaryAxis)) {
      issues.push({ path: `${path}.series`, code: "unexpected_combo_metadata", message: "series chartType and secondaryAxis are only valid for combo charts" });
    }
    if ((chartType === "pie" || chartType === "doughnut") && normalizedSeries.length !== 1) {
      issues.push({ path: `${path}.series`, code: "single_series_chart", message: `${chartType} charts require exactly one series` });
    }

    if (issues.length === startIssueCount && sheet && title && chartType && anchor && legendPosition && grouping && categoryRange) {
      charts.push({
        operation: {
          op: "add_chart",
          sheet,
          chartType: effectiveChartType as SpreadsheetBenchChartType,
          title,
          categoryRange: categoryRange.formula,
          series: normalizedSeries,
          anchor,
          width,
          height,
          legendPosition,
          grouping,
          dataLabels: raw.dataLabels === true,
        },
        effectiveChartType: effectiveChartType as SpreadsheetBenchChartType,
        categoryRange,
        seriesRanges,
      });
    }
  });

  return issues.length ? { ok: false, issues } : { ok: true, charts };
}

export function assertSpreadsheetBenchChartOperations(
  input: unknown,
  workbook?: SpreadsheetBenchChartWorkbookShape,
): SpreadsheetBenchValidatedChartOperation[] {
  const result = validateSpreadsheetBenchChartOperations(input, workbook);
  if (!result.ok) throw new SpreadsheetBenchChartContractError(result.issues);
  return result.charts;
}

export function isSpreadsheetBenchChartBridgeReceipt(input: unknown): input is SpreadsheetBenchChartBridgeReceipt {
  if (!isRecord(input) || input.schema !== 2 || input.contractVersion !== 2) return false;
  if (input.status !== "applied" && input.status !== "rejected") return false;
  if (typeof input.workbook !== "string" || (input.engine !== "excel" && input.engine !== "openpyxl")) return false;
  if (!Number.isInteger(input.operationCount) || !Number.isInteger(input.appliedChartCount)) return false;
  if (!isRecord(input.package) || !Array.isArray(input.operations)) return false;
  return [
    input.package.chartObjectCountBefore,
    input.package.chartObjectCountAfter,
    input.package.chartPartCountBefore,
    input.package.chartPartCountAfter,
    input.package.drawingPartCountAfter,
  ].every(Number.isInteger);
}

function validateRangeAgainstWorkbook(
  range: SpreadsheetBenchParsedChartRange,
  path: string,
  sheets: Map<string, SpreadsheetBenchChartWorkbookShape["sheets"][number]>,
  workbook: SpreadsheetBenchChartWorkbookShape | undefined,
  issues: SpreadsheetBenchChartContractIssue[],
) {
  if (!workbook) return;
  const sheet = sheets.get(range.sheet);
  if (!sheet) {
    issues.push({ path, code: "missing_source_sheet", message: `workbook has no source sheet named ${range.sheet}` });
    return;
  }
  if (sheet.maxRow !== undefined && range.maxRow > sheet.maxRow) {
    issues.push({ path, code: "range_out_of_bounds", message: `range ends at row ${range.maxRow}, beyond populated row ${sheet.maxRow}` });
  }
  if (sheet.maxColumn !== undefined && range.maxColumn > sheet.maxColumn) {
    issues.push({ path, code: "range_out_of_bounds", message: `range ends at column ${range.maxColumn}, beyond populated column ${sheet.maxColumn}` });
  }
}

function requiredText(
  value: unknown,
  path: string,
  issues: SpreadsheetBenchChartContractIssue[],
  maxLength: number,
): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    issues.push({ path, code: "required_text", message: "a non-empty string is required" });
    return undefined;
  }
  const normalized = value.trim();
  if (normalized.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(normalized)) {
    issues.push({ path, code: "invalid_text", message: `text must be at most ${maxLength} characters and contain no control characters` });
    return undefined;
  }
  return normalized;
}

function boundedDimension(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  path: string,
  issues: SpreadsheetBenchChartContractIssue[],
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    issues.push({ path, code: "invalid_dimension", message: `expected a finite number from ${minimum} to ${maximum}` });
    return fallback;
  }
  return value;
}

function parseAnchor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(CELL_PATTERN);
  if (!match) return undefined;
  const column = columnNameToNumber(match[1]);
  const row = Number(match[2]);
  if (column < 1 || column > MAX_EXCEL_COLUMN || row < 1 || row > MAX_EXCEL_ROW) return undefined;
  return `${columnNumberToName(column)}${row}`;
}

function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}

function columnNameToNumber(name: string): number {
  let result = 0;
  for (const char of name.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function columnNumberToName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
