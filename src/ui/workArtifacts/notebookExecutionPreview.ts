import type { NotebookArtifactStructure, NotebookBlockDigest } from "./notebookStructure";
import { classifyNotebookTypedBlocks, type NotebookTypedBlockKind } from "./notebookTypedBlocks";

export type NotebookExecutionPreviewKind = Extract<NotebookTypedBlockKind, "calculation" | "sql" | "chart" | "python">;
export type NotebookExecutionPreviewStatus = "ready" | "blocked";

export interface NotebookExecutionPreviewItem {
  id: string;
  blockId: string;
  elementId: string;
  index: number;
  kind: NotebookExecutionPreviewKind;
  status: NotebookExecutionPreviewStatus;
  input: string;
  result: string;
  reason: string;
  sourceIds: string[];
  traceIds: string[];
  proposalIds: string[];
}

export interface NotebookExecutionPreview {
  previewVersion: 1;
  artifactId: string;
  executableCount: number;
  readyCount: number;
  blockedCount: number;
  items: NotebookExecutionPreviewItem[];
}

type Token = { kind: "number" | "op" | "paren"; value: string };

function tokenizeExpression(input: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
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
    if (token.kind === "op" && token.value === "-") {
      const value = factor();
      return value === null ? null : -value;
    }
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
      if (right === null) return null;
      if (op === "/" && right === 0) return null;
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

  const result = expression();
  return result !== null && index === tokens.length && Number.isFinite(result) ? result : null;
}

function extractArithmetic(text: string): string | null {
  const afterEquals = text.match(/=\s*([0-9().+\-*/\s]{3,})/);
  const candidate = afterEquals?.[1] ?? text.match(/([0-9().+\-*/\s]*\d\s*[+\-*/]\s*\d[0-9().+\-*/\s]*)/)?.[1];
  if (!candidate) return null;
  const compact = candidate.replace(/\s+/g, " ").trim();
  return /[+\-*/]/.test(compact) ? compact : null;
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4).replace(/0+$/g, "").replace(/\.$/, "");
}

function calculationPreview(block: NotebookBlockDigest): Omit<NotebookExecutionPreviewItem, "id" | "blockId" | "elementId" | "index" | "kind" | "sourceIds" | "traceIds" | "proposalIds"> {
  const expression = extractArithmetic(block.text);
  if (!expression) {
    return {
      status: "blocked",
      input: block.text,
      result: "No safe arithmetic expression detected.",
      reason: "calculation_without_expression",
    };
  }
  const tokens = tokenizeExpression(expression);
  const result = tokens ? parseArithmetic(tokens) : null;
  if (result === null) {
    return {
      status: "blocked",
      input: expression,
      result: "Expression needs review before execution.",
      reason: "calculation_parse_blocked",
    };
  }
  return {
    status: "ready",
    input: expression,
    result: formatNumber(result),
    reason: "safe_arithmetic_preview",
  };
}

function sqlPreview(block: NotebookBlockDigest): Omit<NotebookExecutionPreviewItem, "id" | "blockId" | "elementId" | "index" | "kind" | "sourceIds" | "traceIds" | "proposalIds"> {
  const match = block.text.match(/\bselect\s+(.+?)\s+from\s+([a-z0-9_.-]+)/i);
  if (!match) {
    return {
      status: "blocked",
      input: block.text,
      result: "SQL preview requires a SELECT ... FROM ... query.",
      reason: "sql_shape_blocked",
    };
  }
  const columns = match[1].split(",").map((item) => item.trim()).filter(Boolean);
  const table = match[2];
  return {
    status: "ready",
    input: match[0],
    result: `Parsed ${columns.length || 1} column${columns.length === 1 ? "" : "s"} from ${table}.`,
    reason: "sql_intent_parsed",
  };
}

function chartPreview(block: NotebookBlockDigest): Omit<NotebookExecutionPreviewItem, "id" | "blockId" | "elementId" | "index" | "kind" | "sourceIds" | "traceIds" | "proposalIds"> {
  const text = block.text.toLowerCase();
  const chartType = text.includes("bar") ? "bar" : text.includes("scatter") ? "scatter" : text.includes("line") || text.includes("trend") ? "line" : "chart";
  const hasSeries = /\b(by|vs|over|against)\b/.test(text) || block.sourceIds.length > 0;
  return {
    status: hasSeries ? "ready" : "blocked",
    input: block.text,
    result: hasSeries ? `${chartType} chart intent with ${block.sourceIds.length} source reference${block.sourceIds.length === 1 ? "" : "s"}.` : "Chart intent needs series/source context.",
    reason: hasSeries ? "chart_intent_parsed" : "chart_series_blocked",
  };
}

function pythonPreview(block: NotebookBlockDigest): Omit<NotebookExecutionPreviewItem, "id" | "blockId" | "elementId" | "index" | "kind" | "sourceIds" | "traceIds" | "proposalIds"> {
  const fenced = block.text.match(/```python\s*([\s\S]*?)```/i)?.[1];
  const prefixed = block.text.match(/^\s*python\s*:\s*([\s\S]+)/i)?.[1];
  const input = (fenced ?? prefixed ?? "").trim();
  return input ? {
    status: "ready",
    input,
    result: "Ready for isolated Pyodide execution with network denied.",
    reason: "pyodide_worker_required",
  } : {
    status: "blocked",
    input: block.text,
    result: "Python execution requires a fenced python block or a Python: prefix.",
    reason: "python_shape_blocked",
  };
}

function itemPreview(kind: NotebookExecutionPreviewKind, block: NotebookBlockDigest) {
  if (kind === "calculation") return calculationPreview(block);
  if (kind === "sql") return sqlPreview(block);
  if (kind === "python") return pythonPreview(block);
  return chartPreview(block);
}

export function buildNotebookExecutionPreview(structure: NotebookArtifactStructure): NotebookExecutionPreview {
  const typed = classifyNotebookTypedBlocks(structure);
  const blocksById = new Map(structure.blocks.map((block) => [block.id, block]));
  const executableKinds = new Set<NotebookTypedBlockKind>(["calculation", "sql", "chart", "python"]);
  const items = typed
    .filter((block) => executableKinds.has(block.type))
    .map((typedBlock) => {
      const block = blocksById.get(typedBlock.id);
      if (!block) return null;
      const kind = typedBlock.type as NotebookExecutionPreviewKind;
      const preview = itemPreview(kind, block);
      return {
        id: `exec-${block.index + 1}-${block.id}`,
        blockId: block.blockId ?? block.id,
        elementId: block.elementId,
        index: block.index,
        kind,
        sourceIds: block.sourceIds,
        traceIds: block.traceIds,
        proposalIds: block.proposalIds,
        ...preview,
      };
    })
    .filter((item): item is NotebookExecutionPreviewItem => Boolean(item));

  return {
    previewVersion: 1,
    artifactId: structure.artifactId,
    executableCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    blockedCount: items.filter((item) => item.status === "blocked").length,
    items,
  };
}
