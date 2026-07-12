import { evaluateFormula } from "../../core/formulaEngine";
import type { WorkbookSessionOperation, WorkbookSessionRequest, WorkbookSessionScalar } from "../../core/types";
import { boxSize, cellsInBox, parseA1, rangeBox, toA1 } from "../../../shared/gridOps";

export const WORKBOOK_SESSION_MAX_READ_CELLS = 256;
export const WORKBOOK_SESSION_MAX_STAGED_CELLS = 64;
export const WORKBOOK_SESSION_MAX_STRING_CHARS = 4_096;
export const WORKBOOK_SESSION_MAX_FORMULA_CHARS = 2_048;
export const WORKBOOK_SESSION_MAX_REASON_CHARS = 240;
export interface WorkbookAddressSpace { rows: number; columns: number }

const COMMAND_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const EXCEL_MAX_COLUMN = 16_384;
const EXCEL_MAX_ROW = 1_048_576;

export function normalizeWorkbookCoordinate(value: string): string {
  const parsed = parseA1(value);
  if (!parsed || parsed.col > EXCEL_MAX_COLUMN || parsed.row > EXCEL_MAX_ROW) {
    throw new Error(`invalid_workbook_coordinate:${value}`);
  }
  return toA1(parsed.col, parsed.row);
}

export function workbookCoordinateInAddressSpace(value: string, addressSpace: WorkbookAddressSpace): boolean {
  const parsed = parseA1(value);
  return Boolean(parsed && parsed.col <= addressSpace.columns && parsed.row <= addressSpace.rows);
}

export function expandWorkbookRange(start: string, end: string): string[] {
  const normalizedStart = normalizeWorkbookCoordinate(start);
  const normalizedEnd = normalizeWorkbookCoordinate(end);
  const box = rangeBox(normalizedStart, normalizedEnd);
  if (!box || boxSize(box) > WORKBOOK_SESSION_MAX_READ_CELLS) {
    throw new Error(`workbook_read_limit:${WORKBOOK_SESSION_MAX_READ_CELLS}`);
  }
  return cellsInBox(box);
}

export function validateWorkbookScalar(value: unknown): WorkbookSessionScalar {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_workbook_number");
    return value;
  }
  if (typeof value !== "string") throw new Error("workbook_scalar_required");
  const maxChars = value.trimStart().startsWith("=")
    ? WORKBOOK_SESSION_MAX_FORMULA_CHARS
    : WORKBOOK_SESSION_MAX_STRING_CHARS;
  if (value.length > maxChars) throw new Error(`workbook_value_too_long:${maxChars}`);
  if (value.trimStart().startsWith("=")) {
    const parsed = evaluateFormula(value, { getCell: () => 0 });
    if ("error" in parsed && (parsed.error === "#ERROR!" || parsed.error === "#NAME?" || parsed.error === "#REF!")) {
      throw new Error(`unsupported_workbook_formula:${parsed.error}`);
    }
  }
  return value;
}

export function normalizeWorkbookOperations(operations: WorkbookSessionOperation[] | undefined): WorkbookSessionOperation[] {
  if (!operations?.length || operations.length > WORKBOOK_SESSION_MAX_STAGED_CELLS) {
    throw new Error(`workbook_stage_limit:${WORKBOOK_SESSION_MAX_STAGED_CELLS}`);
  }
  const seen = new Set<string>();
  return operations.map((operation) => {
    const elementId = normalizeWorkbookCoordinate(operation.elementId);
    if (seen.has(elementId)) throw new Error(`duplicate_workbook_coordinate:${elementId}`);
    seen.add(elementId);
    return { elementId, value: validateWorkbookScalar(operation.value) };
  });
}

export function validateWorkbookSessionRequest(request: WorkbookSessionRequest): WorkbookSessionRequest {
  if (!COMMAND_ID_RE.test(request.commandId)) throw new Error("invalid_workbook_command_id");
  if (request.reason !== undefined && request.reason.length > WORKBOOK_SESSION_MAX_REASON_CHARS) {
    throw new Error(`workbook_reason_too_long:${WORKBOOK_SESSION_MAX_REASON_CHARS}`);
  }

  if (request.action === "read") {
    if (!request.range) throw new Error("workbook_read_range_required");
    const cells = expandWorkbookRange(request.range.start, request.range.end);
    return {
      action: "read",
      commandId: request.commandId,
      range: { start: cells[0], end: cells[cells.length - 1] },
    };
  }

  if (request.action === "preview") {
    return { action: "preview", commandId: request.commandId };
  }

  if (!Number.isInteger(request.expectedRevision) || (request.expectedRevision ?? -1) < 0) {
    throw new Error("workbook_expected_revision_required");
  }

  if (request.action === "stage") {
    return {
      action: "stage",
      commandId: request.commandId,
      expectedRevision: request.expectedRevision,
      operations: normalizeWorkbookOperations(request.operations),
      reason: request.reason?.trim() || "governed workbook patch",
    };
  }

  return {
    action: request.action,
    commandId: request.commandId,
    expectedRevision: request.expectedRevision,
    reason: request.reason?.trim() || undefined,
  };
}
