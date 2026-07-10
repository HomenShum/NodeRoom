export type NotebookKernelKind = "calculation" | "sql" | "chart";
export type NotebookKernelStatus = "completed" | "blocked" | "failed";
export type NotebookKernelScalar = string | number | boolean | null;

export type NotebookKernelTable = {
  name: string;
  columns: string[];
  rows: Array<Record<string, NotebookKernelScalar>>;
};

export type NotebookKernelRequest = {
  kind: NotebookKernelKind;
  input: string;
  tables?: Record<string, NotebookKernelTable>;
};

export type NotebookKernelChart = {
  type: "line" | "bar" | "scatter";
  table: string;
  x: string;
  y: string;
  points: Array<{ x: NotebookKernelScalar; y: NotebookKernelScalar }>;
};

export type NotebookKernelResult = {
  schema: 1;
  kernelVersion: "noderoom-safe-kernel-v1";
  kind: NotebookKernelKind;
  status: NotebookKernelStatus;
  input: string;
  outputText: string;
  rows?: Array<Record<string, NotebookKernelScalar>>;
  chart?: NotebookKernelChart;
  errorCode?: string;
  receipt: {
    inputHash: string;
    outputHash: string;
    backend: "memory" | "convex" | "preview";
    executedAt: number;
    rowCount: number;
  };
};

type KernelOptions = {
  now?: number;
  backend?: NotebookKernelResult["receipt"]["backend"];
};

type Token = { kind: "number" | "op" | "paren"; value: string };

const MAX_INPUT_LENGTH = 20_000;
const MAX_TABLES = 8;
const MAX_COLUMNS = 40;
const MAX_ROWS_PER_TABLE = 500;
const MAX_RESULT_ROWS = 200;

export function executeNotebookKernel(request: NotebookKernelRequest, options: KernelOptions = {}): NotebookKernelResult {
  const input = request.input.trim();
  const backend = options.backend ?? "memory";
  const executedAt = options.now ?? Date.now();
  if (!input || input.length > MAX_INPUT_LENGTH) {
    return result(request.kind, input, "blocked", input ? "Input exceeds the safe kernel limit." : "No kernel input provided.", "invalid_input", backend, executedAt);
  }
  const tables = normalizeTables(request.tables);
  try {
    if (request.kind === "calculation") return executeCalculation(input, backend, executedAt);
    if (request.kind === "sql") return executeSql(input, tables, backend, executedAt);
    return executeChart(input, tables, backend, executedAt);
  } catch (error) {
    return result(request.kind, input, "failed", error instanceof Error ? error.message : "Kernel execution failed.", "kernel_failure", backend, executedAt);
  }
}

export function extractNotebookArithmetic(text: string): string | null {
  const afterEquals = text.match(/=\s*([0-9().+\-*/\s]{3,})/);
  const candidate = afterEquals?.[1] ?? text.match(/([0-9().+\-*/\s]*\d\s*[+\-*/]\s*\d[0-9().+\-*/\s]*)/)?.[1];
  if (!candidate) return null;
  const compact = candidate.replace(/\s+/g, " ").trim();
  return /[+\-*/]/.test(compact) ? compact : null;
}

export function evaluateNotebookArithmetic(expression: string): number | null {
  const tokens = tokenizeExpression(expression);
  return tokens ? parseArithmetic(tokens) : null;
}

function executeCalculation(input: string, backend: NotebookKernelResult["receipt"]["backend"], executedAt: number): NotebookKernelResult {
  const expression = extractNotebookArithmetic(input);
  if (!expression) return result("calculation", input, "blocked", "No safe arithmetic expression detected.", "calculation_without_expression", backend, executedAt);
  const value = evaluateNotebookArithmetic(expression);
  if (value === null) return result("calculation", expression, "blocked", "Expression could not be evaluated safely.", "calculation_parse_blocked", backend, executedAt);
  return result("calculation", expression, "completed", formatNumber(value), undefined, backend, executedAt);
}

function executeSql(input: string, tables: Record<string, NotebookKernelTable>, backend: NotebookKernelResult["receipt"]["backend"], executedAt: number): NotebookKernelResult {
  if (/;|\b(insert|update|delete|drop|alter|create|attach|pragma|copy|merge|grant|revoke)\b/i.test(input)) {
    return result("sql", input, "blocked", "Only one read-only SELECT statement is allowed.", "sql_write_blocked", backend, executedAt);
  }
  const match = input.match(/^\s*select\s+(.+?)\s+from\s+([a-z0-9_.-]+)(?:\s+where\s+(.+?))?(?:\s+order\s+by\s+([a-z0-9_.-]+)(?:\s+(asc|desc))?)?(?:\s+limit\s+(\d+))?\s*$/i);
  if (!match) return result("sql", input, "blocked", "Use SELECT columns FROM table with optional WHERE, ORDER BY, and LIMIT.", "sql_shape_blocked", backend, executedAt);
  const tableKey = normalizeKey(match[2]);
  const table = tables[tableKey];
  if (!table) return result("sql", input, "blocked", `Table '${match[2]}' is not available. Available: ${Object.keys(tables).join(", ") || "none"}.`, "sql_table_missing", backend, executedAt);
  const requestedColumns = match[1].trim() === "*" ? table.columns : match[1].split(",").map((column) => resolveColumn(table, column.trim())).filter((column): column is string => Boolean(column));
  if (!requestedColumns.length || requestedColumns.some((column) => !table.columns.includes(column))) {
    return result("sql", input, "blocked", "One or more selected columns are unavailable.", "sql_column_missing", backend, executedAt);
  }
  const predicate = match[3] ? parseWhere(table, match[3]) : null;
  if (match[3] && !predicate) return result("sql", input, "blocked", "WHERE supports one column comparison against a scalar value.", "sql_where_blocked", backend, executedAt);
  let rows = table.rows.filter((row) => predicate ? predicate(row) : true);
  if (match[4]) {
    const orderColumn = resolveColumn(table, match[4]);
    if (!orderColumn) return result("sql", input, "blocked", `ORDER BY column '${match[4]}' is unavailable.`, "sql_order_column_missing", backend, executedAt);
    const direction = match[5]?.toLowerCase() === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => compareScalars(a[orderColumn], b[orderColumn]) * direction);
  }
  const limit = Math.min(MAX_RESULT_ROWS, Math.max(0, Number(match[6] ?? MAX_RESULT_ROWS)));
  const projected = rows.slice(0, limit).map((row) => Object.fromEntries(requestedColumns.map((column) => [column, row[column] ?? null])));
  return result("sql", input, "completed", `${projected.length} row${projected.length === 1 ? "" : "s"} from ${table.name}.`, undefined, backend, executedAt, { rows: projected });
}

function executeChart(input: string, tables: Record<string, NotebookKernelTable>, backend: NotebookKernelResult["receipt"]["backend"], executedAt: number): NotebookKernelResult {
  const match = input.match(/\b(line|bar|scatter)\b(?:\s+chart)?\s+(?:of\s+)?([a-z0-9_.-]+)\s+(?:by|over|vs|against)\s+([a-z0-9_.-]+)(?:\s+from\s+([a-z0-9_.-]+))?/i);
  if (!match) return result("chart", input, "blocked", "Use '<line|bar|scatter> chart <y> by <x> from <table>'.", "chart_shape_blocked", backend, executedAt);
  const tableKey = normalizeKey(match[4] ?? Object.keys(tables)[0] ?? "");
  const table = tables[tableKey];
  if (!table) return result("chart", input, "blocked", "No matching room table is available for this chart.", "chart_table_missing", backend, executedAt);
  const y = resolveColumn(table, match[2]);
  const x = resolveColumn(table, match[3]);
  if (!x || !y) return result("chart", input, "blocked", "The requested chart columns are unavailable.", "chart_column_missing", backend, executedAt);
  const points = table.rows.slice(0, MAX_RESULT_ROWS).map((row) => ({ x: row[x] ?? null, y: row[y] ?? null }));
  const chart: NotebookKernelChart = { type: match[1].toLowerCase() as NotebookKernelChart["type"], table: table.name, x, y, points };
  return result("chart", input, "completed", `${chart.type} chart with ${points.length} point${points.length === 1 ? "" : "s"}: ${y} by ${x}.`, undefined, backend, executedAt, { chart });
}

function result(kind: NotebookKernelKind, input: string, status: NotebookKernelStatus, outputText: string, errorCode: string | undefined, backend: NotebookKernelResult["receipt"]["backend"], executedAt: number, extra: Pick<NotebookKernelResult, "rows" | "chart"> = {}): NotebookKernelResult {
  const payload = { kind, status, input, outputText, errorCode, rows: extra.rows, chart: extra.chart };
  return {
    schema: 1,
    kernelVersion: "noderoom-safe-kernel-v1",
    kind,
    status,
    input,
    outputText,
    ...(extra.rows ? { rows: extra.rows } : {}),
    ...(extra.chart ? { chart: extra.chart } : {}),
    ...(errorCode ? { errorCode } : {}),
    receipt: {
      inputHash: stableHash({ kind, input }),
      outputHash: stableHash(payload),
      backend,
      executedAt,
      rowCount: extra.rows?.length ?? extra.chart?.points.length ?? 0,
    },
  };
}

function normalizeTables(input: Record<string, NotebookKernelTable> | undefined): Record<string, NotebookKernelTable> {
  const entries = Object.entries(input ?? {}).slice(0, MAX_TABLES);
  const output: Record<string, NotebookKernelTable> = {};
  for (const [key, raw] of entries) {
    const columns = [...new Set(raw.columns.map((column) => String(column).trim()).filter(Boolean))].slice(0, MAX_COLUMNS);
    const rows = raw.rows.slice(0, MAX_ROWS_PER_TABLE).map((row) => Object.fromEntries(columns.map((column) => [column, scalar(row[column])])));
    output[normalizeKey(key)] = { name: raw.name || key, columns, rows };
  }
  return output;
}

function parseWhere(table: NotebookKernelTable, raw: string): ((row: Record<string, NotebookKernelScalar>) => boolean) | null {
  const match = raw.trim().match(/^([a-z0-9_.-]+)\s*(=|!=|<>|>=|<=|>|<)\s*(.+)$/i);
  if (!match) return null;
  const column = resolveColumn(table, match[1]);
  if (!column) return null;
  const expected = parseLiteral(match[3]);
  if (expected === undefined) return null;
  return (row) => {
    const comparison = compareScalars(row[column], expected);
    if (match[2] === "=") return comparison === 0;
    if (match[2] === "!=" || match[2] === "<>") return comparison !== 0;
    if (match[2] === ">") return comparison > 0;
    if (match[2] === "<") return comparison < 0;
    if (match[2] === ">=") return comparison >= 0;
    return comparison <= 0;
  };
}

function parseLiteral(raw: string): NotebookKernelScalar | undefined {
  const value = raw.trim();
  if (/^'.*'$|^".*"$/.test(value)) return value.slice(1, -1);
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === "true";
  if (/^null$/i.test(value)) return null;
  return undefined;
}

function resolveColumn(table: NotebookKernelTable, requested: string): string | undefined {
  const normalized = normalizeKey(requested);
  return table.columns.find((column) => normalizeKey(column) === normalized);
}

function compareScalars(a: NotebookKernelScalar | undefined, b: NotebookKernelScalar | undefined): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a ?? "").localeCompare(String(b ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function scalar(value: unknown): NotebookKernelScalar {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value && typeof value === "object" && "value" in value) return scalar((value as { value?: unknown }).value);
  return value === undefined ? null : JSON.stringify(value).slice(0, 500);
}

function tokenizeExpression(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (/[()+\-*/]/.test(char)) {
      tokens.push({ kind: char === "(" || char === ")" ? "paren" : "op", value: char });
      index += 1;
      continue;
    }
    const match = input.slice(index).match(/^\d+(?:\.\d+)?/);
    if (!match) return null;
    tokens.push({ kind: "number", value: match[0] });
    index += match[0].length;
  }
  return tokens.length ? tokens : null;
}

function parseArithmetic(tokens: Token[]): number | null {
  let index = 0;
  const peek = () => tokens[index];
  const consume = () => tokens[index++];
  const factor = (): number | null => {
    const token = consume();
    if (!token) return null;
    if (token.kind === "op" && token.value === "-") { const value = factor(); return value === null ? null : -value; }
    if (token.kind === "number") return Number(token.value);
    if (token.kind === "paren" && token.value === "(") {
      const value = expression();
      const close = consume();
      return close?.kind === "paren" && close.value === ")" ? value : null;
    }
    return null;
  };
  const term = (): number | null => {
    let value = factor();
    while (value !== null && peek()?.kind === "op" && (peek().value === "*" || peek().value === "/")) {
      const op = consume().value;
      const right = factor();
      if (right === null || (op === "/" && right === 0)) return null;
      value = op === "*" ? value * right : value / right;
    }
    return value;
  };
  function expression(): number | null {
    let value = term();
    while (value !== null && peek()?.kind === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = consume().value;
      const right = term();
      if (right === null) return null;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }
  const value = expression();
  return value !== null && index === tokens.length && Number.isFinite(value) ? value : null;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/g, "").replace(/\.$/, "");
}

function normalizeKey(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function stableHash(value: unknown): string {
  const text = stableStringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) { hash ^= text.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
