/**
 * LIVE finance-model solve eval — the run the gold pack exists for.
 *
 * What scripted satisfiability (financeModelRuntime.ts) cannot prove: that a REAL model, given only
 * the test material a human candidate sees, synthesizes correctly-LINKED forecast formulas in the
 * room's sheet artifact through the lock -> read -> CAS -> release protocol.
 *
 * Leakage rule (structural, not aspirational): the agent context pack is built EXCLUSIVELY from the
 * "Test Prompt" / "Historical Data" / "Your Model" worksheets. The "Answer Key" worksheet object is
 * only ever touched by the GRADER. A post-run check additionally asserts the literal sheet name
 * never entered the message stream.
 *
 *   npx tsx evals/financeModelLive.ts --scripted                # satisfiability through the LIVE path
 *   npx tsx evals/financeModelLive.ts --real deepseek/deepseek-v4-flash
 *   (workbook path: --workbook <xlsx> or NODEAGENT_FINANCE_MODEL_GOLD_XLSX; skips honestly if absent)
 *
 * Privacy: the workbook is private gold (RareLiquid / Ben Chon). Full traces + context go to the
 * GITIGNORED docs/eval/finance-model-runs/; the committed summary carries booleans + labels only.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import ExcelJS from "exceljs";
import type { AgentMessage, AgentModel, RoomTools } from "../src/nodeagent/core/types";
import { model as realModel, priceRun } from "../src/nodeagent/models/adapter";
import { AgentRunError, runAgent } from "../src/nodeagent/core/runtime";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { RoomEngine } from "../src/engine/roomEngine";
import type { CellPayload } from "../src/engine/types";
import {
  FINANCE_MODEL_CRITICAL_FORMULAS,
  PRIVATE_FINANCE_MODEL_GOLD_ENV,
  formulaMentionsAllRefs,
  formulaMentionsAllTokens,
  type FinanceModelCriticalFormula,
} from "./financeModelGold";
import {
  financeModelSolvePlan,
  makeSyntheticFinanceModelGold,
  type FinanceModelCellResult,
  type FinanceModelGold,
  type FinanceModelGoldCell,
} from "./financeModelRuntime";
import { appendEvalRuns, computeCaseSetHash, DEFAULT_STORE, runKey, type EvalRunRecord } from "./evalStore";
import { readGitIdentity } from "./gitIdentity";

/** Cells whose expected value is derivable from material IN the context pack (historical D/E columns
 *  + assumption rows). The other critical cells reference forecast precedents outside the 16-cell
 *  slice, so their VALUE cannot honestly be demanded — formula linkage remains gated for all 16. */
const VALUE_COMPUTABLE_IN_SLICE = new Set(["F7", "G7", "F8", "F12", "F16", "F56"]);
const FINANCE_LIVE_LEVELS = ["smoke", "income", "full"] as const;
type FinanceLiveLevel = typeof FINANCE_LIVE_LEVELS[number];

/** Room-setup perturbation (Harness Hardening #6). The shipped passed-once-then-0/3 bug was
 *  exactly a single-environment overfit: the agent pattern-matched one room shape. Promotion runs
 *  rotate through these variants and no measured variant may go 0-for.
 *  - base: the clean fixture room.
 *  - distractors: extra artifacts in the room (a note + a stale scratch sheet that REUSES the
 *    target cell ids) — the agent must keep writing to the bound primary artifact only.
 *  - concurrent_edit: a human commits a non-target cell mid-run (must survive) and attempts a
 *    locked target cell (must be blocked) — the live form of the L1/L4 ladder discipline. */
export const FINANCE_ROOM_VARIANTS = ["base", "distractors", "concurrent_edit"] as const;
export type FinanceRoomVariant = typeof FINANCE_ROOM_VARIANTS[number];
const HUMAN_NOTE_CELL = "humanNote";
const HUMAN_MID_RUN_VALUE = "reviewed by analyst mid-run";

const DEFAULT_LEVEL_BUDGETS: Record<FinanceLiveLevel, { maxCostUsd: number; maxMs: number }> = {
  smoke: { maxCostUsd: 0.02, maxMs: 120_000 },
  income: { maxCostUsd: 0.06, maxMs: 240_000 },
  full: { maxCostUsd: 0.15, maxMs: 420_000 },
};

/** Above this share of provider/environment-owned attempts a batch proves nothing about the model:
 *  the verdict is "inconclusive — rerun", never "passed". Without this cap, excluding provider
 *  failures from the model's denominator would let an arbitrarily flaky route grind to a promotion. */
export const PROVIDER_INCONCLUSIVE_SHARE = 0.4;

type ContextPack = {
  instructions: string;
  assumptionLines: string[];
  modelLines: string[];
  /** Historical D/E cells seeded INTO the sheet so the world is consistent: a formula that must
   *  reference E7 can read a real E7. First live run proved models (correctly) verify the sheet
   *  over prose — an empty world sends them exploring until the deadline kills the run. */
  seedCells: Array<{ id: string; value: string | number }>;
};

type FormulaCellValue = { formula?: string; result?: unknown };

function formulaText(cell: ExcelJS.Cell): string | undefined {
  const value = cell.value;
  if (typeof value === "string" && value.trim().startsWith("=")) return value;
  if (value && typeof value === "object" && "formula" in value) return String((value as FormulaCellValue).formula ?? "");
  return undefined;
}

function cachedResult(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && "result" in value) return (value as FormulaCellValue).result;
  return value;
}

function normalizedLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function rowByLabel(sheet: import("exceljs").Worksheet): Map<string, number> {
  const out = new Map<string, number>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const label = normalizedLabel(cellText(row.getCell("B")));
    if (label && label !== "x" && !out.has(label)) out.set(label, rowNumber);
  });
  return out;
}

function remapSameSheetRefs(
  formulaOrRef: string,
  answer: import("exceljs").Worksheet,
  modelRowsByLabel: Map<string, number>,
): string {
  return formulaOrRef.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (match, colAbs: string, col: string, rowAbs: string, rowText: string, offset: number) => {
    if (formulaOrRef[offset - 1] === "!") return match;
    const answerLabel = normalizedLabel(cellText(answer.getRow(Number(rowText)).getCell("B")));
    const modelRow = answerLabel ? modelRowsByLabel.get(answerLabel) : undefined;
    return modelRow ? `${colAbs}${col}${rowAbs}${modelRow}` : match;
  });
}

function targetCellForContract(
  contract: FinanceModelCriticalFormula,
  answer: import("exceljs").Worksheet,
  modelRowsByLabel: Map<string, number>,
): { answerCell: string; modelCell: string } {
  const col = contract.period === "FY2026E" ? "G" : "F";
  const label = normalizedLabel(contract.label);
  const contractRow = Number(contract.cell.match(/\d+/)?.[0]);
  const answerLabel = Number.isFinite(contractRow)
    ? normalizedLabel(cellText(answer.getRow(contractRow).getCell("B")))
    : "";
  const modelRow = (answerLabel ? modelRowsByLabel.get(answerLabel) : undefined)
    ?? modelRowsByLabel.get(label)
    ?? contractRow;
  const answerRow = contractRow;
  if (!Number.isFinite(answerRow) || !Number.isFinite(modelRow)) {
    throw new Error(`cannot map finance model row for ${contract.cell} ${contract.label}`);
  }
  return { answerCell: `${col}${answerRow}`, modelCell: `${col}${modelRow}` };
}

function cellText(cell: ExcelJS.Cell): string {
  const v = cachedResult(cell);
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(4);
  return String(v).trim();
}

function requiredContextRows(cells: FinanceModelCriticalFormula[] = FINANCE_MODEL_CRITICAL_FORMULAS): { historical: Set<number>; model: Set<number> } {
  const historical = new Set<number>();
  const model = new Set<number>();
  for (const contract of cells) {
    const targetRow = Number(contract.cell.match(/\d+/)?.[0]);
    if (Number.isFinite(targetRow)) model.add(targetRow);
    for (const ref of contract.requiredRefs) {
      const historicalMatch = ref.match(/Historical Data'?![A-Z]+(\d+)/i);
      if (historicalMatch) {
        historical.add(Number(historicalMatch[1]));
        continue;
      }
      const modelMatch = ref.match(/[A-Z]+(\d+)/i);
      if (modelMatch) model.add(Number(modelMatch[1]));
    }
  }
  return { historical, model };
}

function compactSeedCells(cells: Array<{ id: string; value: string | number }>): Array<{ id: string; value: string | number }> {
  return [...new Map(cells.map((cell) => [cell.id, cell])).values()];
}

function normalizeRefId(ref: string): string {
  return ref.replace(/\$/g, "").toUpperCase();
}

function numericValue(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  if (raw && typeof raw === "object" && "value" in raw) return numericValue((raw as { value?: unknown }).value);
  return undefined;
}

function seedValueMap(pack: ContextPack | null | undefined): Map<string, number> {
  const values = new Map<string, number>();
  for (const cell of pack?.seedCells ?? []) {
    const numeric = numericValue(cell.value);
    if (numeric !== undefined) values.set(normalizeRefId(cell.id), numeric);
  }
  return values;
}

function rangeRefs(start: string, end: string): string[] | null {
  const a = start.match(/^(\$?)([A-Z]{1,3})(\$?)(\d+)$/i);
  const b = end.match(/^(\$?)([A-Z]{1,3})(\$?)(\d+)$/i);
  if (!a || !b || a[2].toUpperCase() !== b[2].toUpperCase()) return null;
  const first = Number(a[4]);
  const last = Number(b[4]);
  if (!Number.isFinite(first) || !Number.isFinite(last) || Math.abs(last - first) > 200) return null;
  const lo = Math.min(first, last);
  const hi = Math.max(first, last);
  const refs: string[] = [];
  for (let row = lo; row <= hi; row++) refs.push(`${a[2].toUpperCase()}${row}`);
  return refs;
}

function evaluateFormulaValue(formula: string, values: Map<string, number>): number | undefined {
  if (!formula.trim()) return undefined;
  let expr = formula.trim().replace(/^=/, "");
  let missing = false;
  expr = expr.replace(/((?:'[^']+'!)?\$?[A-Z]{1,3}\$?\d+):((?:'[^']+'!)?\$?[A-Z]{1,3}\$?\d+)/g, (_match, start: string, end: string) => {
    if (start.includes("!") || end.includes("!")) {
      const first = values.get(normalizeRefId(start));
      const second = values.get(normalizeRefId(end));
      if (first === undefined || second === undefined) { missing = true; return "0"; }
      return `${first},${second}`;
    }
    const refs = rangeRefs(start, end);
    if (!refs) { missing = true; return "0"; }
    const nums = refs.map((ref) => values.get(normalizeRefId(ref)));
    if (nums.some((value) => value === undefined)) { missing = true; return "0"; }
    return nums.join(",");
  });
  expr = expr.replace(/'[^']+'!\$?[A-Z]{1,3}\$?\d+|\$?[A-Z]{1,3}\$?\d+/g, (ref: string) => {
    const value = values.get(normalizeRefId(ref));
    if (value === undefined) { missing = true; return "0"; }
    return String(value);
  });
  if (missing) return undefined;
  expr = expr
    .replace(/\bAVERAGE\s*\(/gi, "AVG(")
    .replace(/\bSUM\s*\(/gi, "SUM(")
    .replace(/\bABS\s*\(/gi, "ABS(")
    .replace(/\bMIN\s*\(/gi, "MIN(")
    .replace(/\bMAX\s*\(/gi, "MAX(")
    .replace(/\bIF\s*\(/gi, "IF(");
  const words = expr.match(/[A-Z_]+/gi) ?? [];
  if (words.some((word) => !["ABS", "MIN", "MAX", "AVG", "SUM", "IF"].includes(word.toUpperCase()))) return undefined;
  if (!/^[0-9+\-*/().,<>=\sA-Z_]+$/i.test(expr)) return undefined;
  try {
    const ABS = Math.abs;
    const MIN = Math.min;
    const MAX = Math.max;
    const SUM = (...xs: number[]) => xs.reduce((sum, value) => sum + value, 0);
    const AVG = (...xs: number[]) => xs.length ? SUM(...xs) / xs.length : Number.NaN;
    const IF = (condition: boolean, yes: number, no: number) => condition ? yes : no;
    const out = Function("ABS", "MIN", "MAX", "SUM", "AVG", "IF", `"use strict"; return (${expr});`)(ABS, MIN, MAX, SUM, AVG, IF);
    return typeof out === "number" && Number.isFinite(out) ? out : undefined;
  } catch {
    return undefined;
  }
}

/** Build gold from the PRIVATE workbook's Answer Key — grader-side only. */
export async function loadPrivateFinanceModelGold(path: string): Promise<FinanceModelGold> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const answer = workbook.getWorksheet("Answer Key");
  const yourModel = workbook.getWorksheet("Your Model");
  if (!answer) throw new Error("workbook has no Answer Key sheet");
  if (!yourModel) throw new Error("workbook has no Your Model sheet");
  const modelRowsByLabel = rowByLabel(yourModel);
  const cells: FinanceModelGoldCell[] = FINANCE_MODEL_CRITICAL_FORMULAS.map((contract) => {
    const mapped = targetCellForContract(contract, answer, modelRowsByLabel);
    const cell = answer.getCell(mapped.answerCell);
    const formula = formulaText(cell) ?? "";
    const result = cachedResult(cell);
    return {
      ...contract,
      cell: mapped.modelCell,
      requiredRefs: contract.requiredRefs.map((ref) => remapSameSheetRefs(ref, answer, modelRowsByLabel)),
      formula: remapSameSheetRefs(formula, answer, modelRowsByLabel),
      value: typeof result === "number" ? result : String(result ?? ""),
    };
  });
  return {
    id: "finance-model-private-v1",
    title: "Private three-statement modeling test (answer-key oracle)",
    source: "private_workbook",
    sourceHash: createHash("sha256").update(readFileSync(path)).digest("hex"),
    cells,
  };
}

/** Build the agent-visible material — STRUCTURALLY without the Answer Key worksheet. */
export async function loadFinanceModelContextPack(
  path: string,
  cells: FinanceModelCriticalFormula[] = FINANCE_MODEL_CRITICAL_FORMULAS,
): Promise<ContextPack> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const prompt = workbook.getWorksheet("Test Prompt");
  const historical = workbook.getWorksheet("Historical Data");
  const yourModel = workbook.getWorksheet("Your Model");
  if (!prompt || !historical || !yourModel) throw new Error("workbook missing candidate-visible sheets");

  const instructionsParts: string[] = [];
  prompt.eachRow({ includeEmpty: false }, (row) => {
    const text = cellText(row.getCell("B"));
    // The workbook's own prompt references its answer sheet; keep those lines out of the agent's
    // world entirely (no oracle priming, and the content-based leakage gate stays clean).
    if (text && text !== "x" && !/answer\s*key/i.test(text)) instructionsParts.push(text);
  });

  // Assumption block: every Historical Data row carrying a label — address-stamped so the model can
  // write linked references exactly the way the grader's requiredRefs expect them.
  const requiredRows = requiredContextRows(cells);
  const seedCells: Array<{ id: string; value: string | number }> = [];
  const seedCellsPush = (id: string, raw: unknown) => {
    seedCells.push({ id, value: typeof raw === "number" ? raw : String(raw) });
  };
  const assumptionLines: string[] = [];
  historical.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!requiredRows.historical.has(rowNumber)) return;
    const label = cellText(row.getCell("B"));
    if (!label || label === "x") return;
    const d = cellText(row.getCell("D"));
    const e = cellText(row.getCell("E"));
    if (!d && !e) { assumptionLines.push(`  [section] ${label}`); return; }
    // Period tags are load-bearing: the assumptions block REUSES columns D/E for FY2025E/FY2026E
    // (workbook row 95 header), while the statement rows above use D/E for FY2023A/FY2024A. An
    // untagged line invites the symmetry inference "forecasts must be F/G" (iteration-5 failure).
    assumptionLines.push(`  'Historical Data'!D${rowNumber}=${d || "(blank)"} (FY2025E) | 'Historical Data'!E${rowNumber}=${e || "(blank)"} (FY2026E) | ${label}`);
    // Seed assumptions under their EXACT oracle spelling — element ids are plain strings, so the
    // cross-sheet address itself is the id. One spelling everywhere: readable via read_range,
    // citable in formulas, matched by requiredRefs. (Plain D98-style aliases would train the model
    // into references the oracle rejects.)
    const dRaw = cachedResult(row.getCell("D"));
    const eRaw = cachedResult(row.getCell("E"));
    if (dRaw !== null && dRaw !== undefined && dRaw !== "") seedCellsPush(`'Historical Data'!D${rowNumber}`, dRaw);
    if (eRaw !== null && eRaw !== undefined && eRaw !== "") seedCellsPush(`'Historical Data'!E${rowNumber}`, eRaw);
    seedCellsPush(`'Historical Data'!B${rowNumber}`, label); // row label — verifier-style models read these
  });

  const targets = new Set(cells.map((c) => c.cell));
  const modelLines: string[] = [];
  yourModel.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (!requiredRows.model.has(rowNumber)) return;
    const label = cellText(row.getCell("B"));
    if (!label || label === "x") return;
    const d = cellText(row.getCell("D"));
    const e = cellText(row.getCell("E"));
    const fTarget = targets.has(`F${rowNumber}`) ? ` | F${rowNumber}=<FILL>` : "";
    const gTarget = targets.has(`G${rowNumber}`) ? ` | G${rowNumber}=<FILL>` : "";
    modelLines.push(`  row ${rowNumber}: ${label} | D${rowNumber}=${d || "-"} | E${rowNumber}=${e || "-"}${fTarget}${gTarget}`);
    const dRaw = cachedResult(row.getCell("D"));
    const eRaw = cachedResult(row.getCell("E"));
    if (dRaw !== null && dRaw !== undefined && dRaw !== "") seedCellsPush(`D${rowNumber}`, dRaw);
    if (eRaw !== null && eRaw !== undefined && eRaw !== "") seedCellsPush(`E${rowNumber}`, eRaw);
    seedCellsPush(`B${rowNumber}`, label); // row label — verifier-style models read these before writing
  });

  return { instructions: instructionsParts.join("\n"), assumptionLines, modelLines, seedCells: compactSeedCells(seedCells) };
}

function buildLiveContext(pack: ContextPack, cells: FinanceModelGoldCell[]): (rt: RoomTools, goal: string) => Promise<AgentMessage[]> {
  const targetList = cells
    .map((c) => `  ${c.cell} (${c.period} ${c.label}, ${c.section})`)
    .join("\n");
  const targetCount = cells.length;
  const targetPlural = targetCount === 1 ? "cell" : "cells";
  const editPlural = targetCount === 1 ? "call" : "calls";
  const targetRequirements = cells
    .map((cell) => [
      `  ${cell.cell}: ${cell.why}`,
      `    required refs: ${cell.requiredRefs.join(", ")}`,
      cell.requiredTokens?.length ? `    required functions/tokens: ${cell.requiredTokens.join(", ")}` : "",
      `    value: ${VALUE_COMPUTABLE_IN_SLICE.has(cell.cell) ? "compute and include the numeric result" : "use null if a dependent forecast row is not visible"}`,
    ].filter(Boolean).join("\n"))
    .join("\n");
  return async (_rt, goal) => [{
    role: "user",
    content: [
      `YOUR TASK: ${goal}`,
      ``,
      `You are completing a three-statement modeling test inside a shared sheet. The sheet's element`,
      `ids are Excel cell addresses (e.g. "F7"). Fill EXACTLY these forecast cells and no others:`,
      targetList,
      ``,
      `SHEET LAYOUT: the sheet contains three kinds of readable cells: model historicals D<row>`,
      `(FY2023A) and E<row> (FY2024A); assumption cells whose ids are LITERALLY the cross-sheet`,
      `address (e.g. the element id "'Historical Data'!D98" — read_range and formulas both use that`,
      `exact string); and your blank F/G targets. Every value you need is ALREADY printed in this`,
      `message — reading cells again is allowed but never required.`,
      ``,
      `PROTOCOL (mandatory, 4 turns total — the deadline is tight):`,
      `  turn 1: propose_lock on all ${targetCount} target ${targetPlural}.`,
      `  turn 2: ONE read_range of exactly those ${targetCount} target ${targetPlural} (for baseVersions).`,
      `  turn 3: ALL ${targetCount} edit_cell ${editPlural} batched in this single turn, baseVersion from your read.`,
      `  turn 4: release_lock. Then stop.`,
      `For each edit_cell, the value MUST be`,
      `an object: { "formula": "=<linked Excel formula>", "value": <computed number or null> }.`,
      `LINK, never hardcode: formulas must reference the prior-period model cells and the`,
      `'Historical Data' assumption addresses shown below — a typed-out constant where a reference`,
      `belongs is a failing answer. Compute "value" only when every input is visible in the data`,
      `below; otherwise set it to null.`,
      ``,
      `TARGET FORMULA REQUIREMENTS (grading contract, not an answer key):`,
      targetRequirements,
      ``,
      `TEST INSTRUCTIONS (from the workbook):`,
      pack.instructions,
      ``,
      `ASSUMPTION COLUMN MAP (critical): in the assumptions block, column D holds the FY2025E`,
      `assumption and column E holds FY2026E — there are NO F/G assumption columns. Your FY2025E`,
      `formulas reference 'Historical Data'!D<row>; FY2026E formulas reference 'Historical Data'!E<row>.`,
      ``,
      `HISTORICAL DATA + ASSUMPTIONS (address = value (period) | label):`,
      ...pack.assumptionLines,
      ``,
      `YOUR MODEL (labels + historical FY2023A=D / FY2024A=E; <FILL> marks your target cells):`,
      ...pack.modelLines,
    ].join("\n"),
  }];
}

export type FinanceFailureOwner = "model" | "harness" | "tool_contract" | "grader" | "environment" | "provider";

export type LiveReport = {
  caseId: string;
  mode: "scripted" | "live";
  requestedModelName?: string;
  modelName: string;
  roomVariant: FinanceRoomVariant;
  status: "passed" | "failed";
  score: number;
  checks: Record<string, boolean>;
  cellResults: FinanceModelCellResult[];
  costUsd: number;
  ms: number;
  toolCalls: number;
  failureOwner?: FinanceFailureOwner;
  failureReason?: string;
};

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

function statusCodeOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const record = error as Record<string, unknown>;
  const candidates = [record.statusCode, record.status, record.responseStatus, record.code];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return undefined;
}

export function classifyRunFailure(error: unknown): FinanceFailureOwner {
  const text = errorText(error);
  const statusCode = statusCodeOf(error);
  if (statusCode && (statusCode === 429 || statusCode >= 500)) return "provider";
  if (/invalid arguments|tool.?call|tool.?args|arguments.*json|schema/i.test(text)) return "model";
  if (/AbortError|aborted|deadline|time_budget|step_budget/i.test(text)) return "model";
  if (/APICall|provider|OpenRouter|rate.?limit|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|network|socket hang up|service unavailable/i.test(text)) return "provider";
  if (/Invalid JSON/i.test(text)) return /tool|argument|args/i.test(text) ? "model" : "provider";
  return "harness";
}

function classifyFinanceFailure(args: {
  checks: Record<string, boolean>;
  stopReason?: string;
  exhausted?: boolean;
  trace: unknown[];
  runError?: AgentRunError;
}): { owner: FinanceFailureOwner; reason: string } | undefined {
  if (args.runError) {
    return { owner: classifyRunFailure(args.runError.cause), reason: errorText(args.runError.cause).slice(0, 240) };
  }
  const failingChecks = Object.entries(args.checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (!failingChecks.length) return undefined;
  if (args.checks.noAnswerKeyLeakage === false) {
    return { owner: "harness", reason: "answer-key content reached the candidate-visible context" };
  }
  if (args.exhausted || args.stopReason === "time_budget" || args.stopReason === "step_budget") {
    return { owner: "model", reason: `agent exhausted before completing protocol (${args.stopReason ?? "unknown"})` };
  }
  const traceText = JSON.stringify(args.trace).slice(0, 20_000);
  if (/unknown tool|invalid arguments/i.test(traceText)) {
    return { owner: "model", reason: "model emitted an unknown tool or invalid tool arguments" };
  }
  if (/"error"\s*:/i.test(traceText)) {
    return { owner: "tool_contract", reason: `tool error while grading: ${failingChecks.join(", ")}` };
  }
  return { owner: "model", reason: `failed checks: ${failingChecks.join(", ")}` };
}

export async function runFinanceModelLiveSolve(options: {
  gold: FinanceModelGold;
  pack: ContextPack | null; // null => scripted mode (plan needs no context pack)
  agent: AgentModel;
  modelName: string;
  maxSteps?: number;
  deadlineMs?: number;
  maxCostUsd?: number;
  maxMs?: number;
  roomVariant?: FinanceRoomVariant;
}): Promise<LiveReport & { trace: unknown[]; messages: AgentMessage[] }> {
  const { gold, pack, agent, modelName } = options;
  const variant: FinanceRoomVariant = options.roomVariant ?? "base";
  const engine = new RoomEngine();
  const { room, host } = engine.createRoom({ title: "Finance modeling eval room", hostName: "Analyst", autoAllow: true });
  const artifact = engine.createArtifact({
    roomId: room.id,
    kind: "sheet",
    title: "Your Model",
    by: { kind: "user", id: host.id, name: host.name },
    seed: [
      { id: HUMAN_NOTE_CELL, value: "analyst working notes" },
      ...(options.pack?.seedCells ?? []),
      ...gold.cells.map((cell) => ({ id: cell.cell, value: "" })),
    ],
  });
  const humanActor = { kind: "user" as const, id: host.id, name: host.name };
  const distractorArtifacts = variant === "distractors"
    ? [
      engine.createArtifact({
        roomId: room.id, kind: "note", title: "Q3 close checklist (not part of the test)",
        by: humanActor, seed: [{ id: "doc", value: "Working notes for the close — not part of the modeling test." }],
      }),
      // Deliberately reuses the target cell ids: an agent that drifts off the bound artifact
      // (or trusts a title match over the artifact id) lands here and fails distractorsUntouched.
      engine.createArtifact({
        roomId: room.id, kind: "sheet", title: "Your Model (stale scratch copy)",
        by: humanActor, seed: [{ id: "B7", value: "Revenue" }, ...gold.cells.map((cell) => ({ id: cell.cell, value: "stale-draft" }))],
      }),
    ]
    : [];
  const distractorBaseline = distractorArtifacts.map((d) => ({
    id: d.id,
    versions: Object.fromEntries(Object.entries(d.elements).map(([eid, el]) => [eid, el.version])),
  }));
  const session = engine.startSession({ roomId: room.id, agentId: "nodeagent-finance-model", agentName: "NodeAgent", scope: "private", ownerId: host.id });
  const rt = new InMemoryRoomTools(engine, room.id, artifact.id,
    { kind: "agent", id: "nodeagent-finance-model", name: "NodeAgent", scope: "private", ownerId: host.id }, session.id);

  // concurrent_edit: on the agent's SECOND model turn (lock already claimed by a protocol-following
  // agent), a human commits the non-target note cell and attempts a locked target cell. Injected at
  // the model seam so it lands mid-protocol, not before or after the run.
  let humanMidRun: { editApplied: boolean; lockBlocked: boolean } | undefined;
  let modelCalls = 0;
  const agentModel: AgentModel = variant !== "concurrent_edit" ? agent : {
    name: agent.name,
    next: (input) => {
      modelCalls += 1;
      if (modelCalls === 2 && !humanMidRun) {
        const sheet = engine.getArtifact(artifact.id);
        const edit = engine.applyEdit({
          roomId: room.id,
          op: { opId: crypto.randomUUID(), artifactId: artifact.id, elementId: HUMAN_NOTE_CELL, kind: "set", value: HUMAN_MID_RUN_VALUE, baseVersion: sheet?.elements[HUMAN_NOTE_CELL]?.version ?? 0 },
          actor: humanActor,
        });
        const firstTarget = gold.cells[0]?.cell;
        const blocked = firstTarget
          ? engine.applyEdit({
            roomId: room.id,
            op: { opId: crypto.randomUUID(), artifactId: artifact.id, elementId: firstTarget, kind: "set", value: "human-overwrite-attempt", baseVersion: sheet?.elements[firstTarget]?.version ?? 0 },
            actor: humanActor,
          })
          : { ok: true as const };
        humanMidRun = { editApplied: !!edit.ok, lockBlocked: !blocked.ok && (blocked as { reason?: string }).reason === "locked" };
      }
      return agent.next(input);
    },
  };

  const t0 = Date.now();
  let runError: AgentRunError | undefined;
  const result = await runAgent({
    rt,
    goal: "Complete the three-statement modeling test by filling the listed forecast cells with LINKED formulas.",
    model: agentModel,
    tools: ROOM_TOOLS,
    contextBuilder: pack ? buildLiveContext(pack, gold.cells) : undefined,
    // Steps are cheap in-memory; the wall-clock deadline is the honest budget. 24 starved
    // verifier-style models (gemini burned its cap on label reads before writing anything).
    maxSteps: options.maxSteps ?? 60,
    deadlineAt: options.deadlineMs ? t0 + options.deadlineMs : undefined,
    reserveMs: 10_000,
  }).catch((error: unknown) => {
    if (error instanceof AgentRunError) {
      runError = error;
      return error.partial;
    }
    throw error;
  });
  const ms = Date.now() - t0;

  const finalArtifact = engine.getArtifact(artifact.id);
  const formulaValues = seedValueMap(options.pack);
  const cellResults = gold.cells.map((cell): FinanceModelCellResult => {
    let payload = finalArtifact?.elements[cell.cell]?.value as CellPayload | string | undefined;
    // Postel grading: models routinely double-encode nested tool args — a JSON string holding the
    // payload object is the SAME answer and must grade the same (iteration-3 lesson: 14 correct
    // formulas scored 0% on shape alone, which is grader dishonesty, not model failure).
    if (typeof payload === "string" && payload.trim().startsWith("{")) {
      try { payload = JSON.parse(payload) as CellPayload; } catch { /* keep the string */ }
    }
    const actualFormula = typeof payload === "object" && payload && typeof payload.formula === "string"
      ? payload.formula
      : typeof payload === "string" && payload.trim().startsWith("=") ? payload.trim() : "";
    const actualValue = typeof payload === "object" && payload ? payload.value : payload;
    const computedValue = actualFormula ? evaluateFormulaValue(actualFormula, formulaValues) : undefined;
    if (computedValue !== undefined) formulaValues.set(normalizeRefId(cell.cell), computedValue);
    const valueForScoring = actualValue ?? computedValue;
    const valueGated = VALUE_COMPUTABLE_IN_SLICE.has(cell.cell);
    const numeric = numericValue(valueForScoring);
    const valueOk = !valueGated
      || (typeof cell.value === "number"
        ? numeric !== undefined && Math.abs(numeric - cell.value) <= Math.max(0.05, Math.abs(cell.value) * 0.005)
        : String(valueForScoring ?? "").trim() === String(cell.value).trim());
    return {
      cell: cell.cell,
      label: cell.label,
      formulaOk: Boolean(actualFormula)
        && formulaMentionsAllRefs(actualFormula, cell.requiredRefs)
        && formulaMentionsAllTokens(actualFormula, cell.requiredTokens),
      valueOk,
      expectedFormula: cell.formula,
      actualFormula,
      expectedValue: cell.value,
      actualValue,
      computedValue,
      valueSource: actualValue !== null && actualValue !== undefined && actualValue !== "" ? "agent" : computedValue !== undefined ? "formula_eval" : "none",
    };
  });

  const trace = result.trace;
  const resolvedName = agent.name || modelName;
  const costUsd = result.usage ? priceRun(resolvedName, result.usage.inputTokens, result.usage.outputTokens) : 0;
  const targetIds = new Set(gold.cells.map((cell) => cell.cell));
  const editedIds = trace.filter((e) => e.tool === "edit_cell").map((e) => String((e.args as { elementId?: unknown }).elementId ?? ""));
  const firstLock = trace.findIndex((e) => e.tool === "propose_lock");
  const firstEdit = trace.findIndex((e) => e.tool === "edit_cell");
  // Leakage gate — CONTENT-based: no oracle formula may appear in the candidate-visible context.
  // (A phrase match is wrong twice over: the workbook's own prompt benignly says "answer key", and
  // an attacker could leak formulas without ever using the phrase.)
  const preRunContext = JSON.stringify(pack ?? {}).toUpperCase().replace(/[\s$']/g, "");
  const oracleLeaked = gold.cells.some((cell) => {
    const normalized = cell.formula.toUpperCase().replace(/[\s$'=]/g, "");
    return normalized.length > 6 && preRunContext.includes(normalized);
  });
  const checks: Record<string, boolean> = {
    stoppedCleanly: !result.exhausted && result.stopReason !== "error",
    lockedBeforeWrite: firstLock > -1 && (firstEdit === -1 || firstLock < firstEdit),
    writesOnlyForecastCells: editedIds.every((id) => targetIds.has(id)),
    allTargetsWritten: gold.cells.every((cell) => editedIds.includes(cell.cell)),
    everyFormulaLinked: cellResults.every((cell) => cell.formulaOk),
    valueTieOutComputable: cellResults.every((cell) => cell.valueOk),
    releasedLock: trace.some((e) => e.tool === "release_lock"),
    noAnswerKeyLeakage: !oracleLeaked,
    withinCostBudget: options.maxCostUsd === undefined || costUsd < options.maxCostUsd,
    withinTimeBudget: options.maxMs === undefined || ms < options.maxMs,
    // Variant invariants — vacuously true outside their variant so the check vector stays uniform
    // across a mixed-variant batch (the aggregate compares per-check pass counts).
    distractorsUntouched: variant !== "distractors" || distractorBaseline.every(({ id, versions }) => {
      const after = engine.getArtifact(id);
      return !!after
        && Object.keys(after.elements).length === Object.keys(versions).length
        && Object.entries(versions).every(([eid, v]) => after.elements[eid]?.version === v);
    }),
    humanEditSurvived: variant !== "concurrent_edit"
      || (humanMidRun?.editApplied === true && finalArtifact?.elements[HUMAN_NOTE_CELL]?.value === HUMAN_MID_RUN_VALUE),
    lockHeldAgainstMidRunWrite: variant !== "concurrent_edit" || humanMidRun?.lockBlocked === true,
  };
  const passed = Object.values(checks).every(Boolean);
  const failure = passed ? undefined : classifyFinanceFailure({
    checks,
    stopReason: result.stopReason,
    exhausted: result.exhausted,
    trace,
    runError,
  });
  return {
    caseId: gold.id,
    mode: pack ? "live" : "scripted",
    requestedModelName: modelName,
    modelName: resolvedName,
    roomVariant: variant,
    status: passed ? "passed" : "failed",
    score: Object.values(checks).filter(Boolean).length / Object.values(checks).length,
    checks,
    cellResults,
    costUsd,
    ms,
    toolCalls: trace.length,
    failureOwner: failure?.owner,
    failureReason: failure?.reason,
    trace,
    messages: result.messages,
  };
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const inline = process.argv.find((a) => a.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  const next = process.argv[idx + 1];
  return idx !== -1 && next && !next.startsWith("--") ? next : undefined;
}

function selectedFinanceLevel(): FinanceLiveLevel {
  const raw = optionValue("--level") ?? "full";
  if ((FINANCE_LIVE_LEVELS as readonly string[]).includes(raw)) return raw as FinanceLiveLevel;
  throw new Error(`invalid --level=${raw}; expected ${FINANCE_LIVE_LEVELS.join("|")}`);
}

function selectFinanceModelCells(gold: FinanceModelGold, level: FinanceLiveLevel, explicitCells?: string): FinanceModelGold {
  const wanted = explicitCells
    ? explicitCells.split(",").map((cell) => cell.trim().toUpperCase()).filter(Boolean)
    : level === "smoke"
      ? ["F7", "G7", "F8"]
      : level === "income"
        ? FINANCE_MODEL_CRITICAL_FORMULAS.filter((cell) => cell.section === "income_statement").map((cell) => cell.cell)
        : gold.cells.map((cell) => cell.cell);
  const cells = gold.cells.filter((cell) => wanted.includes(cell.cell));
  if (!cells.length) throw new Error(`no finance-model target cells selected for level=${level} cells=${explicitCells ?? "(default)"}`);
  const missing = wanted.filter((cell) => !cells.some((candidate) => candidate.cell === cell));
  if (missing.length) throw new Error(`finance-model target cells not found in gold pack: ${missing.join(", ")}`);
  return {
    ...gold,
    id: `${gold.id}-${explicitCells ? "custom" : level}`,
    title: `${gold.title} (${explicitCells ? "custom" : level})`,
    cells,
  };
}

export type FinanceLiveAttemptSummary = {
  run: number;
  roomVariant: FinanceRoomVariant;
  status: LiveReport["status"];
  score: number;
  checks: Record<string, boolean>;
  costUsd: number;
  ms: number;
  toolCalls: number;
  modelName: string;
  requestedModelName?: string;
  failureOwner?: FinanceFailureOwner;
  failureReason?: string;
  traceRef?: string;
};

export type FinanceLiveAggregate = {
  generatedAt: string;
  caseId: string;
  mode: LiveReport["mode"];
  requestedModelName?: string;
  modelName: string;
  level: string;
  targetCells: string[];
  status: LiveReport["status"];
  /** The richer signal: "inconclusive" = provider noise dominated the batch — rerun, never promote.
   *  status stays passed|failed for store compatibility (inconclusive maps to skip in the store). */
  verdict: "passed" | "failed" | "inconclusive";
  score: number;
  runsRequested: number;
  runsCompleted: number;
  passCount: number;
  requiredPasses: number;
  passRate: number;
  /** passCount / modelOwnedRuns — provider/environment attempts prove nothing about the model. */
  modelOwnedPassRate: number;
  modelOwnedRuns: number;
  providerOwnedRuns: number;
  /** providerOwnedRuns / runsCompleted; above PROVIDER_INCONCLUSIVE_SHARE the batch is inconclusive. */
  providerFailureShare: number;
  medianMs: number;
  p95CostUsd: number;
  totalCostUsd: number;
  perCheckPassCounts: Record<string, number>;
  /** Per room variant, over model-owned attempts. No measured variant may go 0-for (gate below). */
  variantStats: Record<string, { runs: number; passes: number }>;
  aggregateChecks: Record<string, boolean>;
  cells: Array<{ cell: string; label: string; formulaOk: boolean; valueOk: boolean }>;
  attempts: FinanceLiveAttemptSummary[];
  goldSourceHash?: string;
};

function positiveIntOption(name: string, fallback: number): number {
  const raw = optionValue(name);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid ${name}=${raw}; expected positive integer`);
  return n;
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function requiredPassesFor(runsRequested: number, minPassRate?: number): number {
  if (minPassRate !== undefined) return Math.ceil(runsRequested * minPassRate);
  return runsRequested >= 5 ? Math.ceil(runsRequested * 0.8) : runsRequested;
}

export function aggregateFinanceLiveReports(args: {
  reports: LiveReport[];
  runsRequested: number;
  level: string;
  targetCells: string[];
  cells: FinanceModelGoldCell[];
  goldSourceHash?: string;
  minPassRate?: number;
}): FinanceLiveAggregate {
  const { reports, runsRequested } = args;
  const passCount = reports.filter((r) => r.status === "passed").length;
  // Provider/environment-owned attempts are excluded from the model's denominator (a 429 or a bad
  // key is not a model failure) — but never silently: above PROVIDER_INCONCLUSIVE_SHARE the whole
  // batch is "inconclusive", never "passed". This closes both doors at once: unfairly failing a
  // model for transport noise, AND grinding a flaky route to a promotion on a tiny clean subset.
  const modelOwned = reports.filter((r) => r.failureOwner !== "provider" && r.failureOwner !== "environment");
  const providerOwnedRuns = reports.length - modelOwned.length;
  const providerFailureShare = reports.length ? providerOwnedRuns / reports.length : 0;
  const modelOwnedPassRate = modelOwned.length ? passCount / modelOwned.length : 0;
  const requiredPasses = requiredPassesFor(modelOwned.length, args.minPassRate);
  const allCheckNames = [...new Set(reports.flatMap((r) => Object.keys(r.checks)))].sort();
  // Per-check counts over MODEL-OWNED attempts (raw per-attempt checks stay in attempts[]).
  const perCheckPassCounts = Object.fromEntries(
    allCheckNames.map((name) => [name, modelOwned.filter((r) => r.checks[name]).length]),
  );
  const variantStats: Record<string, { runs: number; passes: number }> = {};
  for (const r of modelOwned) {
    const v = r.roomVariant ?? "base";
    variantStats[v] = variantStats[v] ?? { runs: 0, passes: 0 };
    variantStats[v].runs += 1;
    if (r.status === "passed") variantStats[v].passes += 1;
  }
  const aggregateChecks: Record<string, boolean> = {
    passThresholdMet: modelOwned.length > 0 && passCount >= requiredPasses,
    allRunsCompleted: reports.length === runsRequested,
    providerNoiseBounded: providerFailureShare <= PROVIDER_INCONCLUSIVE_SHARE,
  };
  // Harness Hardening #6: a variant the batch measured may not go 0-for — passing only the clean
  // room while failing every distractor/concurrent-edit run is the passed-once-then-0/3 bug again.
  for (const [v, s] of Object.entries(variantStats)) {
    aggregateChecks[`variant:${v}`] = s.passes >= 1;
  }
  for (const name of allCheckNames) {
    aggregateChecks[`check:${name}`] = (perCheckPassCounts[name] ?? 0) >= requiredPasses;
  }
  const score = runsRequested ? passCount / runsRequested : 0;
  const verdict: FinanceLiveAggregate["verdict"] =
    providerFailureShare > PROVIDER_INCONCLUSIVE_SHARE || modelOwned.length === 0
      ? "inconclusive"
      : Object.values(aggregateChecks).every(Boolean) ? "passed" : "failed";
  const status: LiveReport["status"] = verdict === "passed" ? "passed" : "failed";
  const representative = [...reports].reverse().find((r) => r.status === "passed") ?? reports.at(-1);
  return {
    generatedAt: new Date().toISOString(),
    caseId: representative?.caseId ?? args.cells[0]?.cell ?? "finance-model",
    mode: representative?.mode ?? "live",
    requestedModelName: representative?.requestedModelName,
    modelName: representative?.modelName ?? representative?.requestedModelName ?? "unknown",
    level: args.level,
    targetCells: args.targetCells,
    status,
    verdict,
    score,
    runsRequested,
    runsCompleted: reports.length,
    passCount,
    requiredPasses,
    passRate: score,
    modelOwnedPassRate: Number(modelOwnedPassRate.toFixed(4)),
    modelOwnedRuns: modelOwned.length,
    providerOwnedRuns,
    providerFailureShare: Number(providerFailureShare.toFixed(4)),
    medianMs: median(reports.map((r) => r.ms)),
    p95CostUsd: percentile(reports.map((r) => r.costUsd), 0.95),
    totalCostUsd: reports.reduce((sum, r) => sum + r.costUsd, 0),
    perCheckPassCounts,
    variantStats,
    aggregateChecks,
    cells: (representative?.cellResults ?? []).map((c) => ({
      cell: c.cell,
      label: c.label,
      formulaOk: c.formulaOk,
      valueOk: c.valueOk,
    })),
    attempts: reports.map((r, index) => ({
      run: index + 1,
      roomVariant: r.roomVariant ?? "base",
      status: r.status,
      score: r.score,
      checks: r.checks,
      costUsd: r.costUsd,
      ms: r.ms,
      toolCalls: r.toolCalls,
      modelName: r.modelName,
      requestedModelName: r.requestedModelName,
      failureOwner: r.failureOwner,
      failureReason: r.failureReason,
    })),
    goldSourceHash: args.goldSourceHash,
  };
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "run";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function writePrivateFinanceTrace(report: LiveReport & { trace: unknown[]; messages: AgentMessage[] }, run: number): string {
  mkdirSync("docs/eval/finance-model-runs", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  const file = join("docs", "eval", "finance-model-runs", `${stamp}-run${run}-${safeSegment(report.modelName)}.json`);
  writeFileSync(file, JSON.stringify({ ...report }, null, 2));
  return normalizePath(relative(process.cwd(), file));
}

function recordFinanceAggregateToStore(aggregate: FinanceLiveAggregate, summaryPath: string): void {
  if (!process.argv.includes("--record")) return;
  const identity = readGitIdentity();
  const ts = Date.now();
  const store = optionValue("--eval-store") ?? DEFAULT_STORE;
  const caseId = `finance-model:${aggregate.caseId}:${aggregate.requestedModelName ?? aggregate.modelName}:${aggregate.level}`;
  const failureSummary = aggregate.verdict === "passed"
    ? undefined
    : [
      `verdict=${aggregate.verdict}`,
      `passRate=${aggregate.passCount}/${aggregate.modelOwnedRuns} model-owned (provider-owned ${aggregate.providerOwnedRuns}/${aggregate.runsCompleted})`,
      ...aggregate.attempts
        .filter((a) => a.status !== "passed" || a.failureOwner)
        .map((a) => `run${a.run}:${a.failureOwner ?? "unknown"}:${a.failureReason ?? "failed"}`),
    ].join(" | ");
  const failureOwner = aggregate.attempts.find((a) => a.failureOwner)?.failureOwner;
  const record: EvalRunRecord = {
    ts,
    commitSha: identity.commitSha,
    worktreeHash: identity.worktreeHash,
    gitDirty: identity.gitDirty,
    caseSetHash: computeCaseSetHash([caseId]),
    suite: "finance-model",
    caseId,
    model: aggregate.modelName,
    // inconclusive -> skip: a provider-noise batch is "not measured", not a model failure.
    status: aggregate.verdict === "passed" ? "pass" : aggregate.verdict === "inconclusive" ? "skip" : "fail",
    score: aggregate.modelOwnedPassRate,
    checks: aggregate.aggregateChecks,
    failureOwner,
    failureSummary,
    traceRef: normalizePath(summaryPath),
    harnessVersion: "finance-model-live-v2-reliability",
  };
  appendEvalRuns([record], store);
  console.log(`recorded finance aggregate to ${store} (${runKey(record)}). Diff: npm run eval:diff`);
}

async function main(): Promise<void> {
  await import("../scripts/benchmark/loadEnv").catch(() => undefined);
  const workbook = optionValue("--workbook") ?? process.env[PRIVATE_FINANCE_MODEL_GOLD_ENV];
  const scripted = process.argv.includes("--scripted");
  const route = optionValue("--real") ?? "deepseek/deepseek-v4-flash";
  const level = selectedFinanceLevel();
  const explicitCells = optionValue("--cells");
  const runs = positiveIntOption("--runs", 1);
  const minPassRateRaw = optionValue("--min-pass-rate");
  const minPassRate = minPassRateRaw ? Number(minPassRateRaw) : undefined;
  if (minPassRate !== undefined && (!Number.isFinite(minPassRate) || minPassRate <= 0 || minPassRate > 1)) {
    throw new Error(`invalid --min-pass-rate=${minPassRateRaw}; expected 0 < value <= 1`);
  }

  let gold: FinanceModelGold;
  let pack: ContextPack | null = null;
  if (workbook && existsSync(workbook)) {
    gold = selectFinanceModelCells(await loadPrivateFinanceModelGold(workbook), level, explicitCells);
    pack = scripted ? null : await loadFinanceModelContextPack(workbook, gold.cells);
    console.log(`gold: private workbook (${gold.sourceHash?.slice(0, 12)}…), ${gold.cells.length} critical cells`);
  } else if (scripted) {
    gold = selectFinanceModelCells(makeSyntheticFinanceModelGold(), level, explicitCells);
    console.log("gold: synthetic (no workbook provided)");
  } else {
    console.log(JSON.stringify({ status: "skipped", reason: `live mode needs the private workbook: set --workbook or ${PRIVATE_FINANCE_MODEL_GOLD_ENV}` }));
    return;
  }
  console.log(`finance live level=${explicitCells ? "custom" : level}; target cells=${gold.cells.map((cell) => cell.cell).join(",")}`);

  const deadlineMs = Number(optionValue("--timeout-ms") ?? 720_000);
  const defaults = DEFAULT_LEVEL_BUDGETS[level];
  const maxCostUsd = Number(optionValue("--max-cost-usd") ?? defaults.maxCostUsd);
  const maxMs = Number(optionValue("--max-ms") ?? Math.min(deadlineMs, defaults.maxMs));
  // Room-variant rotation (Harness Hardening #6): multi-run promotion batches rotate through the
  // perturbed rooms by default; single dev runs stay on the clean fixture unless asked.
  const variantsRaw = optionValue("--variants");
  const variantCycle: FinanceRoomVariant[] = variantsRaw
    ? variantsRaw.split(",").map((v) => v.trim()).filter((v): v is FinanceRoomVariant => (FINANCE_ROOM_VARIANTS as readonly string[]).includes(v))
    : runs >= 3 ? [...FINANCE_ROOM_VARIANTS] : ["base"];
  if (variantsRaw && !variantCycle.length) {
    throw new Error(`invalid --variants=${variantsRaw}; expected csv of ${FINANCE_ROOM_VARIANTS.join("|")}`);
  }
  const reports: Array<LiveReport & { trace: unknown[]; messages: AgentMessage[] }> = [];
  const traceRefs: string[] = [];

  for (let run = 1; run <= runs; run++) {
    const agent = scripted ? scriptedModel(financeModelSolvePlan(gold), `scripted-finance-solver-${run}`) : realModel(route);
    const roomVariant = variantCycle[(run - 1) % variantCycle.length];
    const report = await runFinanceModelLiveSolve({
      gold, pack, agent,
      modelName: scripted ? "scripted" : route,
      // The human test allots 60 minutes; the CLI budget remains explicit and rung-level checks gate promotion.
      deadlineMs,
      maxCostUsd,
      maxMs,
      roomVariant,
    });
    reports.push(report);
    traceRefs.push(writePrivateFinanceTrace(report, run));
    const requested = report.requestedModelName ?? report.modelName;
    const routeLabel = report.modelName !== requested ? `${requested} -> ${report.modelName}` : report.modelName;
    console.log(`\nrun ${run}/${runs} ${report.mode.toUpperCase()} - ${routeLabel} - room=${report.roomVariant} - ${report.status.toUpperCase()} (${(report.score * 100).toFixed(0)}%) - $${report.costUsd.toFixed(4)} - ${(report.ms / 1000).toFixed(1)}s - ${report.toolCalls} tools`);
    if (report.failureOwner) console.log(`  failureOwner=${report.failureOwner} reason=${report.failureReason ?? "(none)"}`);
    for (const [name, ok] of Object.entries(report.checks)) console.log(`  ${ok ? "ok " : "X  "} ${name}`);
    const failing = report.cellResults.filter((c) => !c.formulaOk || !c.valueOk);
    for (const c of failing) console.log(`  cell ${c.cell} (${c.label}): formulaOk=${c.formulaOk} valueOk=${c.valueOk} actual="${String(c.actualFormula).slice(0, 80)}"`);
  }

  const aggregate = aggregateFinanceLiveReports({
    reports,
    runsRequested: runs,
    level: explicitCells ? "custom" : level,
    targetCells: gold.cells.map((cell) => cell.cell),
    cells: gold.cells,
    goldSourceHash: gold.sourceHash?.slice(0, 16),
    minPassRate,
  });
  aggregate.attempts = aggregate.attempts.map((attempt, index) => ({ ...attempt, traceRef: traceRefs[index] }));

  const summaryPath = optionValue("--json-out") ?? (scripted
    ? "docs/eval/finance-model-scripted-smoke.json"
    : "docs/eval/finance-model-live.json");
  // Committed summary: booleans + labels only. No workbook formulas or values leave the machine.
  writeFileSync(summaryPath, JSON.stringify(aggregate, null, 2));
  recordFinanceAggregateToStore(aggregate, summaryPath);
  console.log(`\nwrote ${summaryPath} (redacted aggregate) + private traces in docs/eval/finance-model-runs/`);
  console.log(`aggregate ${aggregate.verdict.toUpperCase()} passRate=${aggregate.passCount}/${aggregate.modelOwnedRuns} model-owned (provider-owned ${aggregate.providerOwnedRuns}/${aggregate.runsCompleted}) required=${aggregate.requiredPasses} median=${(aggregate.medianMs / 1000).toFixed(1)}s p95Cost=$${aggregate.p95CostUsd.toFixed(4)}`);
  if (aggregate.runsCompleted === 1 && aggregate.verdict === "passed") {
    console.log("  NOTE: single pass — reliability unmeasured; promotion needs --runs 5 (>= 4/5 model-owned).");
  }
  if (aggregate.verdict === "inconclusive") {
    console.log("  INCONCLUSIVE: provider-owned failures dominate this batch — rerun; it proves nothing about the model.");
  }
  if (aggregate.verdict !== "passed") process.exitCode = 1;
}

const isCli = process.argv[1]?.replace(/\\/g, "/").endsWith("financeModelLive.ts");
if (isCli) await main();
