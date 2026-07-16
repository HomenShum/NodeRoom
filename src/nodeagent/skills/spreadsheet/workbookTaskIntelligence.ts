import { normalizeSpreadsheetFontColor } from "../../../shared/spreadsheetFontColor";

export type WorkbookObservedCell = {
  sheet: string;
  address: string;
  value: unknown;
  formula?: string;
  numFmt?: string;
  fontColor?: string;
  version?: number;
};

export type WorkbookAuditFocus =
  | "incorrect_average"
  | "embedded_hardcode"
  | "color_coding"
  | "formula_errors"
  | "double_counting"
  | "index_match"
  | "cross_sheet_reference"
  | "unit_mismatch"
  | "sign_convention"
  | "relative_absolute_reference";

export type WorkbookReferenceRole = "target" | "dependency" | "ambiguous";

export type WorkbookTaskReference = {
  sheet?: string;
  start: string;
  end: string;
  sourceText: string;
  role: WorkbookReferenceRole;
};

export type WorkbookInspectionFindingKind =
  | "formula_text_match"
  | "formula_error"
  | "formula_self_reference"
  | "formula_fill_band"
  | "formula_pattern_outlier"
  | "hardcoded_in_formula_band"
  | "blank_in_formula_band"
  | "named_target_neighbor_formula"
  | "named_year_target_band"
  | "semantic_formula_target"
  | "formula_range_anomaly"
  | "font_color_anomaly"
  | "lookup_bounds_missing"
  | "implicit_assignment_target";

export type WorkbookInspectionFinding = {
  kind: WorkbookInspectionFindingKind;
  severity: "info" | "warning" | "error";
  sheet: string;
  address: string;
  relatedAddresses?: string[];
  detail: string;
  recommendedAction: string;
};

export type WorkbookTargetBand = {
  sheet: string;
  range: string;
  addresses: string[];
  source: "explicit_reference" | "named_year_range" | "implicit_value_assignment" | "formula_fill" | "semantic_relation" | "calculation_method";
  confidence: "explicit" | "high";
  reason: string;
};

export type WorkbookBlockedTarget = {
  sheet: string;
  address: string;
  reason: string;
  missingDependencies: string[];
};

export type WorkbookTaskInspection = {
  schema: 1;
  auditFocus?: {
    kind: WorkbookAuditFocus;
    source: "agent_visible_filename";
    workbookName: string;
  };
  mutatingTask: boolean;
  allowEmptyPlan: boolean;
  deterministicPlan?: {
    status: "complete";
    basis: "visible_workbook_invariants";
    auditFocus: Exclude<WorkbookAuditFocus, "formula_errors">;
    operationCount: number;
    sheets: string[];
  };
  referencedSheets: string[];
  explicitReferences: WorkbookTaskReference[];
  targetCandidates: Array<{ sheet: string; address: string; reason: string }>;
  blockedTargets: WorkbookBlockedTarget[];
  targetBands: WorkbookTargetBand[];
  dependencyCandidates: Array<{ sheet: string; address: string; reason: string }>;
  findings: WorkbookInspectionFinding[];
  formulaFillSuggestions: Array<{
    sheet: string;
    range: string;
    anchorAddress: string;
    sourceFormula: string;
    operations: Array<{ sheet: string; cell: string; formula: string }>;
  }>;
  formulaRepairSuggestions: Array<{
    kind: "fill_gap" | "replace_outlier";
    confidence: "high";
    sheet: string;
    cell: string;
    formula: string;
    evidence: string[];
  }>;
  valueSuggestions: Array<{
    confidence: "high";
    sheet: string;
    cell: string;
    value: string | number | boolean;
    numFmt?: string;
    evidence: string[];
  }>;
  styleSuggestions: Array<{
    kind: "font_color";
    confidence: "high";
    sheet: string;
    cell: string;
    fontColor: string;
    evidence: string[];
  }>;
  rankedCellKeys: string[];
  recommendedReads: Array<{ sheet: string; addresses: string[]; reason: string }>;
  completionChecks: string[];
};

export type WorkbookPlanOperation = {
  op?: string;
  sheet?: string;
  cell?: string;
  value?: unknown;
  formula?: string;
  result?: unknown;
  numFmt?: string;
  fontColor?: string;
  [key: string]: unknown;
};

export type WorkbookSuggestedPlanOperation = {
  elementId: string;
  formula?: string;
  value?: string | number | boolean;
  numFmt?: string;
  fontColor?: string;
};

export type WorkbookSuggestedPlan = {
  operations: WorkbookSuggestedPlanOperation[];
  conflicts: Array<{
    elementId: string;
    candidates: WorkbookSuggestedPlanOperation[];
  }>;
};

export type WorkbookPlanIssueKind =
  | "planner_output_error"
  | "empty_mutating_plan"
  | "missing_target_coverage"
  | "missing_sheet"
  | "invalid_cell"
  | "formula_to_scalar_overwrite"
  | "formula_ref_error"
  | "formula_self_reference"
  | "formula_semantic_mismatch"
  | "value_semantic_mismatch"
  | "font_color_semantic_mismatch"
  | "unsafe_lookup_bounds"
  | "malformed_formula"
  | "duplicate_target"
  | "overbroad_audit_plan"
  | "unsubstantiated_audit_target"
  | "audit_style_content_overwrite";

export type WorkbookPlanIssue = {
  kind: WorkbookPlanIssueKind;
  severity: "warning" | "error";
  operationIndex?: number;
  sheet?: string;
  address?: string;
  detail: string;
  repair: string;
};

export type WorkbookPlanVerification = {
  schema: 1;
  status: "passed" | "needs_repair";
  issueCount: number;
  issues: WorkbookPlanIssue[];
  checks: {
    operationCount: number;
    targetCandidateCount: number;
    coveredTargetCount: number;
    formulaProtectionChecked: boolean;
  };
};

export type WorkbookValueCheck = {
  sheet?: string;
  elementId: string;
  expectedValue?: unknown;
  expectedFormula?: string;
  expectedNumFmt?: string;
  expectedFontColor?: string;
  allowBlank?: boolean;
};

export type WorkbookValueCheckResult = WorkbookValueCheck & {
  ok: boolean;
  actualValue: unknown;
  actualFormula?: string;
  actualNumFmt?: string;
  actualFontColor?: string;
  version?: number;
  issues: string[];
};

export type WorkbookWriteVerification = {
  schema: 1;
  status: "passed" | "needs_repair";
  checkedCount: number;
  passedCount: number;
  issueCount: number;
  checks: WorkbookValueCheckResult[];
  repairPrompt?: string;
};

type CellPosition = { row: number; col: number };
type RankedCell = WorkbookObservedCell & { score: number; reasons: Set<string> };
type WorkbookSemanticFormulaRule = {
  kind: "prior_period_delta" | "average_balance";
  sheet: string;
  targetLabel: WorkbookObservedCell;
  targetAddresses: string[];
  dependencyLabels: WorkbookObservedCell[];
  operator?: "plus" | "minus";
  periodsPerYear?: number;
  endpointSummaryAddresses?: string[];
  dependencyFormulaExpectations?: Array<{ address: string; formula: string }>;
};

type WorkbookTemplateCompletion = {
  sheet: string;
  reason: string;
  formulas: Array<{ sheet: string; cell: string; formula: string }>;
  values?: WorkbookTaskInspection["valueSuggestions"];
};

type WorkbookLookupPassFailContract = {
  completions: WorkbookTemplateCompletion[];
  blockedTargets: WorkbookBlockedTarget[];
};

const A1_RE = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/i;
const CELL_TOKEN_RE = /\$?[A-Z]{1,3}\$?[1-9][0-9]*/gi;
const GENERIC_ELEMENT_RE = /\b[a-z][a-z0-9_]*__[a-z][a-z0-9_]*\b/gi;
const FORMULA_ERROR_RE = /#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!|CYCLE!|ERROR!)/i;
const TARGET_CONTEXT_RE = /\b(?:set|write|fill|populate|place|put|output|return|display|configure|correct|fix|repair|change|replace|calculate|formula|result|target|cells?|range|column)\b/i;
const DEPENDENCY_CONTEXT_RE = /\b(?:from|source|input|criteria|based\s+on|using|lookup|match|reference|corresponding|depends?\s+on)\b/i;
const MUTATING_TASK_RE = /\b(?:audit|fix|repair|change|set|fill|populate|write|create|add|replace|delete|configure|correct|calculate|return|display|extract|sort|filter|format|highlight|apply|complete|update)\b/i;
const METHOD_MUTATING_TASK_RE = /\bforecast(?:ing)?\b|\b(?:use|apply)\b[^.!?]{0,120}\b(?:method|formula|calculation|approach)\b/i;
const IMPLICIT_ASSIGNMENT_RE = /\b(?:are|is|equals?|should\s+be|must\s+be)\s+[-+$]?\d[\d,.]*\s*%?/i;
const EMPTY_PLAN_ALLOWED_RE = /\b(?:keep\b[^.]{0,80}\bunchanged|no\s+edit|read[- ]only|inspect\s+only|return\s+an?\s+empty\s+(?:operations\s+)?(?:array|plan)|when\s+no\s+safe\s+operation\s+applies)\b/i;
const FORMULA_TASK_RE = /\b(?:formula|calculation|calculate|weekday|sum|count|average|lookup|index|match|if\b|text\b|date\b)\b/i;
const TASK_TERM_STOPWORDS = new Set([
  "also", "based", "calculate", "complete", "correct", "ensure", "existing", "file", "formula", "formulas",
  "from", "model", "provided", "sheet", "throughout", "then", "using", "value", "values", "workbook", "years",
]);

export function workbookCellKey(sheet: string, address: string): string {
  return `${sheet.trim().toLowerCase()}!${normalizeAddress(address)}`;
}

export function normalizeAddress(address: string): string {
  return address.replace(/\$/g, "").trim().toUpperCase();
}

export function normalizeFormula(formula: string | undefined): string | undefined {
  const source = formula?.trim().replace(/^=/, "") ?? "";
  let normalized = "";
  let quote: "'" | '"' | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      normalized += character;
      if (character !== quote) continue;
      if (source[index + 1] === quote) {
        normalized += source[index + 1];
        index += 1;
      } else {
        quote = undefined;
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      normalized += character;
    } else if (!/\s/.test(character)) {
      normalized += character;
    }
  }
  return normalized || undefined;
}

/**
 * Materialize only the high-confidence operations already justified by a
 * workbook inspection. This is intentionally evaluator-agnostic: every target
 * comes from visible workbook structure, formulas, labels, or the user task.
 */
export function buildWorkbookSuggestedPlan(
  inspection: WorkbookTaskInspection,
  sheet: string,
): WorkbookSuggestedPlan {
  const targetSheet = sheet.trim().toLowerCase();
  const targetKeys = new Set(inspection.targetCandidates.map((target) => workbookCellKey(target.sheet, target.address)));
  const candidates = new Map<string, WorkbookSuggestedPlanOperation[]>();
  const add = (operation: WorkbookSuggestedPlanOperation) => {
    const elementId = normalizeAddress(operation.elementId);
    if (!A1_RE.test(elementId)) return;
    const normalized: WorkbookSuggestedPlanOperation = {
      elementId,
      ...(operation.formula ? { formula: operation.formula.trim().replace(/^=/, "") } : {}),
      ...(Object.prototype.hasOwnProperty.call(operation, "value") ? { value: operation.value } : {}),
      ...(operation.numFmt ? { numFmt: operation.numFmt } : {}),
      ...(operation.fontColor ? { fontColor: normalizeSpreadsheetFontColor(operation.fontColor) } : {}),
    };
    const list = candidates.get(elementId) ?? [];
    if (!list.some((candidate) => suggestedOperationsEquivalent(candidate, normalized))) list.push(normalized);
    candidates.set(elementId, list);
  };

  for (const suggestion of inspection.formulaFillSuggestions) {
    if (suggestion.sheet.trim().toLowerCase() !== targetSheet) continue;
    for (const operation of suggestion.operations) {
      if (operation.sheet.trim().toLowerCase() !== targetSheet) continue;
      add({ elementId: operation.cell, formula: operation.formula });
    }
  }
  for (const suggestion of inspection.formulaRepairSuggestions) {
    if (suggestion.confidence !== "high" || suggestion.sheet.trim().toLowerCase() !== targetSheet) continue;
    if (!targetKeys.has(workbookCellKey(suggestion.sheet, suggestion.cell))) continue;
    add({ elementId: suggestion.cell, formula: suggestion.formula });
  }
  for (const suggestion of inspection.valueSuggestions) {
    if (suggestion.confidence !== "high" || suggestion.sheet.trim().toLowerCase() !== targetSheet) continue;
    add({
      elementId: suggestion.cell,
      value: suggestion.value,
      ...(suggestion.numFmt ? { numFmt: suggestion.numFmt } : {}),
    });
  }
  for (const suggestion of inspection.styleSuggestions) {
    if (suggestion.confidence !== "high" || suggestion.sheet.trim().toLowerCase() !== targetSheet) continue;
    if (!targetKeys.has(workbookCellKey(suggestion.sheet, suggestion.cell))) continue;
    add({ elementId: suggestion.cell, fontColor: suggestion.fontColor });
  }

  const conflicts = [...candidates.entries()]
    .filter(([, values]) => values.length > 1)
    .map(([elementId, values]) => ({ elementId, candidates: values }));
  const conflictIds = new Set(conflicts.map((conflict) => conflict.elementId));
  const operations = [...candidates.entries()]
    .filter(([elementId, values]) => !conflictIds.has(elementId) && values.length === 1)
    .map(([, values]) => values[0])
    .sort((left, right) => compareAddresses(left.elementId, right.elementId));
  return { operations, conflicts };
}

function suggestedOperationsEquivalent(
  left: WorkbookSuggestedPlanOperation,
  right: WorkbookSuggestedPlanOperation,
): boolean {
  return normalizeFormula(left.formula) === normalizeFormula(right.formula)
    && valuesEquivalent(left.value, right.value)
    && (left.numFmt ?? "") === (right.numFmt ?? "")
    && (left.fontColor ?? "") === (right.fontColor ?? "");
}

export function extractWorkbookTaskReferences(instruction: string, sheetNames: string[] = []): WorkbookTaskReference[] {
  const references: WorkbookTaskReference[] = [];
  const occupied = new Set<string>();
  const sheetByLower = new Map(sheetNames.map((sheet) => [sheet.toLowerCase(), sheet]));
  const sheetPattern = /(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)(?:\s*(?::|-|\bto\b)\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*))?/gi;
  for (const match of instruction.matchAll(sheetPattern)) {
    const sourceText = match[0];
    const index = match.index ?? 0;
    if (!hasA1ReferenceBoundaries(instruction, index, sourceText.length)) continue;
    const rawSheet = (match[1] ?? match[2] ?? "").trim();
    const unescapedSheet = rawSheet.replace(/''/g, "'");
    const sheet = sheetByLower.get(unescapedSheet.toLowerCase()) ?? unescapedSheet;
    const start = normalizeAddress(match[3]);
    const end = normalizeAddress(match[4] ?? match[3]);
    references.push({ sheet, start, end, sourceText, role: referenceRole(instruction, index, sourceText.length) });
    for (let offset = index; offset < index + sourceText.length; offset += 1) occupied.add(String(offset));
  }

  const rangePattern = /(\$?[A-Z]{1,3}\$?[1-9][0-9]*)(?:\s*(:|-|\bto\b)\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*))?/gi;
  for (const match of instruction.matchAll(rangePattern)) {
    const index = match.index ?? 0;
    if (occupied.has(String(index))) continue;
    if (!hasA1ReferenceBoundaries(instruction, index, match[0].length)) continue;
    const start = normalizeAddress(match[1]);
    const end = normalizeAddress(match[3] ?? match[1]);
    if (!shouldExtractUnqualifiedA1Reference(instruction, index, match[0].length, start, end, match[2])) continue;
    references.push({ start, end, sourceText: match[0], role: referenceRole(instruction, index, match[0].length) });
  }

  for (const match of instruction.matchAll(GENERIC_ELEMENT_RE)) {
    const address = match[0];
    references.push({ start: address, end: address, sourceText: address, role: referenceRole(instruction, match.index ?? 0, address.length) });
  }

  const unique = new Map<string, WorkbookTaskReference>();
  for (const reference of references) {
    const key = `${reference.sheet?.toLowerCase() ?? ""}!${reference.start}:${reference.end}`;
    const current = unique.get(key);
    if (!current || rolePriority(reference.role) > rolePriority(current.role)) unique.set(key, reference);
  }
  return [...unique.values()];
}

function hasA1ReferenceBoundaries(instruction: string, index: number, length: number): boolean {
  const before = instruction[index - 1] ?? "";
  const after = instruction[index + length] ?? "";
  return !/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after);
}

function shouldExtractUnqualifiedA1Reference(
  instruction: string,
  index: number,
  length: number,
  start: string,
  end: string,
  separator: string | undefined,
): boolean {
  const clause = referenceClause(instruction, index, length);
  const explicitCellContext = /\b(?:cells?|ranges?|addresses?|formulas?)\b/i.test(clause);
  const formulaContext = hasFormulaReferenceContext(instruction, index, length);
  if (hasOpaqueIdLabel(instruction, index, length)) return false;

  if (start !== end) {
    const normalizedSeparator = separator?.trim().toLowerCase();
    return normalizedSeparator === ":" || normalizedSeparator === "to" || explicitCellContext || formulaContext;
  }
  if (/^Q[1-4]$/i.test(start)) {
    const local = instruction.slice(Math.max(0, index - 24), Math.min(instruction.length, index + length + 24));
    const quoted = start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const explicitQuarterCell = new RegExp(
      `(?:\\b(?:cell|address)\\s+['\"]?${quoted}\\b|\\b${quoted}['\"]?\\s+(?:cell|address)\\b)`,
      "i",
    ).test(local);
    return explicitQuarterCell || formulaContext;
  }
  if (explicitCellContext || formulaContext) return true;

  const immediate = instruction.slice(Math.max(0, index - 70), Math.min(instruction.length, index + length + 70));
  return TARGET_CONTEXT_RE.test(immediate) || DEPENDENCY_CONTEXT_RE.test(immediate);
}

function referenceClause(instruction: string, index: number, length: number): string {
  const before = instruction.slice(0, index);
  const start = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("?"),
    before.lastIndexOf("!"),
    before.lastIndexOf("\n"),
  ) + 1;
  const after = instruction.slice(index + length);
  const nextBoundary = after.search(/[.;!?\n]/);
  const end = nextBoundary === -1 ? instruction.length : index + length + nextBoundary;
  return instruction.slice(start, end);
}

function hasFormulaReferenceContext(instruction: string, index: number, length: number): boolean {
  const before = instruction.slice(Math.max(0, index - 180), index);
  const after = instruction.slice(index + length, Math.min(instruction.length, index + length + 12));
  const clauseStart = Math.max(
    before.lastIndexOf("."),
    before.lastIndexOf(";"),
    before.lastIndexOf("?"),
    before.lastIndexOf("!"),
    before.lastIndexOf("\n"),
  ) + 1;
  const formulaPrefix = before.slice(clauseStart);
  if (/=[^=;!?\n]*$/.test(formulaPrefix)) return true;
  if (/\b[A-Z][A-Z0-9_.]*\([^()]*$/i.test(formulaPrefix)) return true;
  const previous = before.match(/\S\s*$/)?.[0].trim() ?? "";
  const next = after.match(/^\s*(\S)/)?.[1] ?? "";
  return (!!previous && "=+-*/^".includes(previous)) || (!!next && "+-*/^<>=".includes(next));
}

function hasOpaqueIdLabel(instruction: string, index: number, length: number): boolean {
  const before = instruction.slice(Math.max(0, index - 60), index);
  const after = instruction.slice(index + length, Math.min(instruction.length, index + length + 60));
  const idLabel = "(?:artifact(?:\\s*id)?|artifactid|room(?:\\s*id)?|roomid|job(?:\\s*id)?|jobid|trace(?:\\s*id)?|traceid|request(?:\\s*id)?|requestid)";
  return new RegExp(`\\b${idLabel}\\s*[:=#-]?\\s*$`, "i").test(before)
    || new RegExp(`^\\s*${idLabel}\\b`, "i").test(after);
}

export function inspectWorkbookTask(args: {
  instruction: string;
  sheetNames: string[];
  cells: WorkbookObservedCell[];
  maxFindings?: number;
}): WorkbookTaskInspection {
  const maxFindings = Math.max(1, Math.min(args.maxFindings ?? 24, 100));
  const auditFocus = workbookAuditFocus(args.instruction);
  const explicitReferences = extractWorkbookTaskReferences(args.instruction, args.sheetNames);
  const referencedSheets = args.sheetNames.filter((sheet) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(sheet)}(?:$|[^a-z0-9])`, "i").test(args.instruction));
  const cellsByKey = new Map(args.cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const ranked = new Map<string, RankedCell>();
  const findings: WorkbookInspectionFinding[] = [];
  const formulaFillSuggestions: WorkbookTaskInspection["formulaFillSuggestions"] = [];
  const formulaRepairSuggestions: WorkbookTaskInspection["formulaRepairSuggestions"] = [];
  const valueSuggestions: WorkbookTaskInspection["valueSuggestions"] = [];
  const styleSuggestions: WorkbookTaskInspection["styleSuggestions"] = [];
  const blockedTargets: WorkbookBlockedTarget[] = [];
  const targetCandidates = new Map<string, { sheet: string; address: string; reason: string }>();
  const targetBands = new Map<string, WorkbookTargetBand>();
  const dependencyCandidates = new Map<string, { sheet: string; address: string; reason: string }>();

  const addRank = (cell: WorkbookObservedCell | undefined, score: number, reason: string) => {
    if (!cell) return;
    const key = workbookCellKey(cell.sheet, cell.address);
    const current = ranked.get(key) ?? { ...cell, score: 0, reasons: new Set<string>() };
    current.score = Math.max(current.score, score);
    current.reasons.add(reason);
    ranked.set(key, current);
  };
  const addCandidate = (kind: "target" | "dependency", cell: WorkbookObservedCell | undefined, reason: string) => {
    if (!cell) return;
    const key = workbookCellKey(cell.sheet, cell.address);
    (kind === "target" ? targetCandidates : dependencyCandidates).set(key, { sheet: cell.sheet, address: cell.address, reason });
  };
  const addTargetBand = (
    sheet: string,
    addresses: string[],
    source: WorkbookTargetBand["source"],
    confidence: WorkbookTargetBand["confidence"],
    reason: string,
  ) => {
    const normalized = [...new Set(addresses.map(normalizeAddress).filter((address) => A1_RE.test(address)))]
      .sort(compareAddresses);
    if (normalized.length < 2) return;
    const range = `${normalized[0]}:${normalized.at(-1)!}`;
    const key = `${sheet.toLowerCase()}!${range}`;
    const current = targetBands.get(key);
    if (!current || (confidence === "explicit" && current.confidence !== "explicit")) {
      targetBands.set(key, { sheet, range, addresses: normalized, source, confidence, reason });
    }
  };

  for (const reference of explicitReferences) {
    const matchingSheets = reference.sheet
      ? args.sheetNames.filter((sheet) => sheet.toLowerCase() === reference.sheet!.toLowerCase())
      : referencedSheets.length === 1 ? referencedSheets : args.sheetNames;
    const addresses = expandReference(reference, 256, reference.role === "target");
    for (const sheet of matchingSheets) {
      if (reference.role === "target") {
        addTargetBand(
          sheet,
          addresses,
          "explicit_reference",
          "explicit",
          `task explicitly names ${reference.sourceText} as an edit target`,
        );
      }
      for (const address of addresses) {
        const cell = cellsByKey.get(workbookCellKey(sheet, address))
          ?? (reference.role === "target" ? { sheet, address, value: "" } : undefined);
        addRank(cell, reference.role === "target" ? 210 : reference.role === "dependency" ? 170 : 190, `explicit_${reference.role}`);
        if (reference.role === "target") addCandidate("target", cell, `task names ${reference.sourceText} as an output or edit target`);
        else if (reference.role === "dependency") addCandidate("dependency", cell, `task names ${reference.sourceText} as source or criteria`);
        else {
          addCandidate("dependency", cell, `task explicitly references ${reference.sourceText}`);
          if (FORMULA_TASK_RE.test(args.instruction)) addCandidate("target", cell, `formula task explicitly references ${reference.sourceText}`);
        }
        for (const neighbor of cellNeighbors(sheet, address, cellsByKey, 1)) addRank(neighbor, 155, `neighbor_of_${address}`);
        for (const neighbor of cellNeighbors(sheet, address, cellsByKey, 2)) addRank(neighbor, 105, `near_${address}`);
      }
    }
  }

  const compactInstruction = compactFormulaText(args.instruction);
  for (const cell of args.cells) {
    const formula = normalizeFormula(cell.formula);
    if (formula && compactInstruction.includes(compactFormulaText(formula))) {
      addRank(cell, 240, "formula_text_match");
      addCandidate("target", cell, "existing formula text appears in the task description");
      findings.push({
        kind: "formula_text_match",
        severity: "info",
        sheet: cell.sheet,
        address: cell.address,
        detail: `The task quotes the existing formula in ${cell.address}.`,
        recommendedAction: `Treat ${cell.address}, not only its referenced input cells, as the likely formula repair target.`,
      });
    }
    if (formula && FORMULA_ERROR_RE.test(formula)) {
      addRank(cell, 230, "formula_ref_error");
      findings.push({
        kind: "formula_error",
        severity: "error",
        sheet: cell.sheet,
        address: cell.address,
        detail: `Formula contains an Excel error token: ${cell.formula}.`,
        recommendedAction: "Repair the broken reference before changing unrelated cells.",
      });
    } else if (FORMULA_ERROR_RE.test(displayValue(cell.value))) {
      addRank(cell, 220, "formula_result_error");
      findings.push({
        kind: "formula_error",
        severity: "error",
        sheet: cell.sheet,
        address: cell.address,
        detail: `Cell currently evaluates to ${displayValue(cell.value)}.`,
        recommendedAction: "Inspect dependencies and repair the formula or source error.",
      });
    }
    if (formula && formulaReferencesCurrentCell(formula, cell.sheet, cell.address)) {
      addRank(cell, 225, "formula_self_reference");
      findings.push({
        kind: "formula_self_reference",
        severity: "error",
        sheet: cell.sheet,
        address: cell.address,
        detail: `Formula appears to reference its own cell: ${cell.formula}.`,
        recommendedAction: "Replace the circular reference with the intended dependency cell or range.",
      });
    }
    if (formula) addRank(cell, 55, "existing_formula");
    const termScore = instructionTermScore(args.instruction, cell);
    if (termScore > 0) {
      addRank(cell, 80 + termScore, "task_term_match");
      if (termScore >= 6) {
        for (const contextCell of calculationRowContext(cell, cellsByKey, 14)) {
          addRank(contextCell, 135, `calculation_row_context_${cell.address}`);
        }
      }
    }
  }

  const weekdayTargetKeys = new Set<string>();
  if (/\b(?:weekday|day\s+name|mon\b|wed\b)\b/i.test(args.instruction)) {
    const preserveWeekdayPeers = /\b(?:only\s+(?:the\s+)?(?:anchor|named|specified|incorrect|wrong)|preserve|leave)\b[^.!?]{0,80}\b(?:other|adjacent|peer|existing)\b/i.test(args.instruction);
    const normalizeWeekdayBand = !preserveWeekdayPeers
      && /\b(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?\b/i.test(args.instruction);
    const quotedWeekdayTargets = new Set(findings
      .filter((finding) => finding.kind === "formula_text_match")
      .map((finding) => workbookCellKey(finding.sheet, finding.address)));
    for (const cell of args.cells) {
      const band = weekdayFormulaFillBand(cell, cellsByKey);
      if (band.length < 3) continue;
      const cellKey = workbookCellKey(cell.sheet, cell.address);
      if (preserveWeekdayPeers && quotedWeekdayTargets.size > 0 && !quotedWeekdayTargets.has(cellKey)) continue;
      const sourceFormula = weekdayTextFormula(cell.formula!, requestedWeekdayTextToken(args.instruction, band));
      const anchorPosition = parseAddress(cell.address)!;
      const operationBand = preserveWeekdayPeers ? [cell] : band;
      const operations = operationBand.flatMap((target) => {
        const targetPosition = parseAddress(target.address)!;
        const formula = translateRelativeFormula(sourceFormula, targetPosition.row - anchorPosition.row, targetPosition.col - anchorPosition.col);
        const shouldRepair = preserveWeekdayPeers || normalizeFormula(target.formula) !== undefined
          ? !weekdayFormulasEquivalent(target.formula!, formula)
          : isBlank(unwrapCellValue(target.value)) || normalizeWeekdayBand;
        return shouldRepair ? [{ sheet: target.sheet, cell: target.address, formula }] : [];
      });
      if (operations.length === 0) continue;
      for (const operation of operations) weekdayTargetKeys.add(workbookCellKey(operation.sheet, operation.cell));
      const operationKeys = new Set(operations.map((operation) => workbookCellKey(operation.sheet, operation.cell)));
      const operationCells = band.filter((target) => operationKeys.has(workbookCellKey(target.sheet, target.address)));
      const preservedPeers = band.length - operationCells.length;
      for (const target of operationCells) {
        addRank(target, 220, "formula_fill_band");
        addCandidate("target", target, `visible weekday examples justify a bounded formula repair anchored at ${cell.address}`);
      }
      addTargetBand(
        cell.sheet,
        operationCells.map((target) => target.address),
        "formula_fill",
        "high",
        `visible weekday examples justify a bounded formula repair anchored at ${cell.address}`,
      );
      findings.push({
        kind: "formula_fill_band",
        severity: "warning",
        sheet: cell.sheet,
        address: cell.address,
        relatedAddresses: operationCells.filter((target) => target.address !== cell.address).map((target) => target.address),
        detail: `${cell.address} sits in a ${band.length}-cell weekday row above date inputs; ${preservedPeers} populated label example(s) remain unchanged.`,
        recommendedAction: normalizeWeekdayBand
          ? `Normalize ${operations.map((operation) => operation.cell).join(", ")} with relative three-letter TEXT formulas and verify the full visible weekday row.`
          : `Repair only ${operations.map((operation) => operation.cell).join(", ")} with the relative TEXT formula and preserve populated scalar labels.`,
      });
      formulaFillSuggestions.push({
        sheet: cell.sheet,
        range: `${operationCells[0].address}:${operationCells.at(-1)!.address}`,
        anchorAddress: cell.address,
        sourceFormula,
        operations,
      });
    }
  }

  const formulaBandAnalysis = analyzeFormulaBands(args.cells, addRank);
  const compatibleFormulaSuggestions = (auditFocus
    ? formulaBandAnalysis.suggestions.filter((suggestion) => auditFocusAllowsFormulaSuggestion(
        auditFocus.kind,
        suggestion,
        cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell)),
      )).slice(0, 8)
    : formulaBandAnalysis.suggestions);
  const compatibleFormulaKeys = new Set(compatibleFormulaSuggestions
    .map((suggestion) => workbookCellKey(suggestion.sheet, suggestion.cell)));
  findings.push(...formulaBandAnalysis.findings.filter((finding) =>
    !weekdayTargetKeys.has(workbookCellKey(finding.sheet, finding.address))
    && (!auditFocus || compatibleFormulaKeys.has(workbookCellKey(finding.sheet, finding.address)))));
  const requireFormulaAnomalyRepairs = genericFormulaAuditTask(args.instruction);
  for (const suggestion of compatibleFormulaSuggestions) {
    if (weekdayTargetKeys.has(workbookCellKey(suggestion.sheet, suggestion.cell))) continue;
    formulaRepairSuggestions.push(suggestion);
    if (requireFormulaAnomalyRepairs || auditFocus) {
      addCandidate("target", cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell)) ?? {
        sheet: suggestion.sheet,
        address: suggestion.cell,
        value: "",
      }, auditFocus
        ? `${auditFocus.workbookName} identifies the audit class and two-sided workbook evidence agrees on ${suggestion.formula}`
        : `two-sided formula pattern agrees on ${suggestion.formula}`);
    }
  }

  const averageRangeAnalysis = !auditFocus || auditFocus.kind === "incorrect_average"
    ? analyzeAverageFormulaRanges(args.instruction, args.cells, addRank)
    : { findings: [], suggestions: [] as WorkbookTaskInspection["formulaRepairSuggestions"] };
  const supportedAverageKeys = new Map(compatibleFormulaSuggestions
    .filter((suggestion) => auditFocus?.kind !== "incorrect_average" || suggestion.kind === "replace_outlier")
    .map((suggestion) => [workbookCellKey(suggestion.sheet, suggestion.cell), normalizeFormula(suggestion.formula)]));
  const averageSuggestions = auditFocus?.kind === "incorrect_average"
    ? averageRangeAnalysis.suggestions.filter((suggestion) =>
        supportedAverageKeys.get(workbookCellKey(suggestion.sheet, suggestion.cell)) === normalizeFormula(suggestion.formula)
        || suggestion.evidence.some((item) => item.startsWith("locally confirmed contiguous expansion:")))
    : averageRangeAnalysis.suggestions;
  const averageSuggestionKeys = new Set(averageSuggestions.map((suggestion) => workbookCellKey(suggestion.sheet, suggestion.cell)));
  findings.push(...averageRangeAnalysis.findings.filter((finding) =>
    !auditFocus || averageSuggestionKeys.has(workbookCellKey(finding.sheet, finding.address))));
  for (const suggestion of averageSuggestions) {
    const key = workbookCellKey(suggestion.sheet, suggestion.cell);
    for (let index = formulaRepairSuggestions.length - 1; index >= 0; index -= 1) {
      const current = formulaRepairSuggestions[index];
      if (workbookCellKey(current.sheet, current.cell) === key) formulaRepairSuggestions.splice(index, 1);
    }
    formulaRepairSuggestions.push(suggestion);
    if (!auditFocus) {
      addCandidate("target", cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell)) ?? {
        sheet: suggestion.sheet,
        address: suggestion.cell,
        value: "",
      }, suggestion.evidence.join("; "));
    }
  }

  const focusedAuditAnalysis = auditFocus
    ? analyzeFocusedAuditPatterns(auditFocus.kind, args.cells)
    : {
        findings: [] as WorkbookInspectionFinding[],
        formulaSuggestions: [] as WorkbookTaskInspection["formulaRepairSuggestions"],
        valueSuggestions: [] as WorkbookTaskInspection["valueSuggestions"],
      };
  const focusedFormulaKeys = new Set<string>();
  const focusedValueKeys = new Set<string>();
  findings.push(...focusedAuditAnalysis.findings);
  for (const suggestion of focusedAuditAnalysis.formulaSuggestions) {
    const key = workbookCellKey(suggestion.sheet, suggestion.cell);
    focusedFormulaKeys.add(key);
    formulaRepairSuggestions.push(suggestion);
    const target = cellsByKey.get(key) ?? { sheet: suggestion.sheet, address: suggestion.cell, value: "" };
    addRank(target, 248, "focused_audit_formula_anomaly");
    addCandidate("target", target, suggestion.evidence.join("; "));
  }
  for (const suggestion of focusedAuditAnalysis.valueSuggestions) {
    const key = workbookCellKey(suggestion.sheet, suggestion.cell);
    focusedValueKeys.add(key);
    valueSuggestions.push(suggestion);
    const target = cellsByKey.get(key) ?? { sheet: suggestion.sheet, address: suggestion.cell, value: "" };
    addRank(target, 248, "focused_audit_value_anomaly");
    addCandidate("target", target, suggestion.evidence.join("; "));
  }

  if (auditFocus?.kind === "color_coding") {
    const colorAnalysis = analyzeFontColorAudit(args.cells);
    findings.push(...colorAnalysis.findings);
    for (const suggestion of colorAnalysis.suggestions) {
      styleSuggestions.push(suggestion);
      const target = cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell));
      addRank(target, 245, "font_color_anomaly");
      addCandidate("target", target, suggestion.evidence.join("; "));
    }
  }

  if (FORMULA_TASK_RE.test(args.instruction)) {
    for (const reference of explicitReferences) {
      if (reference.start !== reference.end || !A1_RE.test(reference.start)) continue;
      const sheets = reference.sheet ? [reference.sheet] : referencedSheets.length === 1 ? referencedSheets : args.sheetNames;
      for (const sheet of sheets) {
        const mentioned = cellsByKey.get(workbookCellKey(sheet, reference.start));
        if (!mentioned || mentioned.formula) continue;
        const neighborFormula = cellNeighbors(sheet, reference.start, cellsByKey, 1).find((cell) => !!cell.formula);
        if (!neighborFormula) continue;
        addRank(neighborFormula, 205, "named_target_neighbor_formula");
        addCandidate("target", neighborFormula, `${reference.start} is an input beside the formula-bearing cell ${neighborFormula.address}`);
        findings.push({
          kind: "named_target_neighbor_formula",
          severity: "warning",
          sheet: neighborFormula.sheet,
          address: neighborFormula.address,
          relatedAddresses: [reference.start],
          detail: `${reference.start} is mentioned, but adjacent ${neighborFormula.address} contains the formula.`,
          recommendedAction: `Inspect and repair ${neighborFormula.address}; do not overwrite the input in ${reference.start}.`,
        });
      }
    }
  }

  const namedYearBands = inferNamedYearTargetBands(args.instruction, args.sheetNames, args.cells);
  for (const band of namedYearBands) {
    addTargetBand(band.sheet, band.addresses, "named_year_range", "high", band.reason);
    addRank(cellsByKey.get(workbookCellKey(band.sheet, band.labelAddress)), 225, "named_year_target_label");
    for (const headerAddress of band.headerAddresses) {
      addRank(cellsByKey.get(workbookCellKey(band.sheet, headerAddress)), 185, "named_year_target_header");
    }
    for (const address of band.addresses) {
      const target = cellsByKey.get(workbookCellKey(band.sheet, address)) ?? { sheet: band.sheet, address, value: "" };
      addRank(target, 230, "named_year_target_band");
      addCandidate("target", target, band.reason);
    }
    findings.push({
      kind: "named_year_target_band",
      severity: "info",
      sheet: band.sheet,
      address: band.addresses[0],
      relatedAddresses: band.addresses.slice(1),
      detail: `${band.labelAddress} and the visible year headers identify ${band.addresses[0]}:${band.addresses.at(-1)!} as the requested calculation band.`,
      recommendedAction: "Return and verify one formula operation for every year in the requested band.",
    });
  }

  const semanticFormulaRules = inferWorkbookSemanticFormulaRules(args.instruction, args.cells);
  for (const rule of semanticFormulaRules) {
    const reason = rule.kind === "prior_period_delta"
      ? `${displayValue(rule.targetLabel.value)} follows the requested prior-period relationship`
      : `${displayValue(rule.targetLabel.value)} uses the requested average-balance method`;
    if (rule.targetAddresses.length > 1) {
      addTargetBand(
        rule.sheet,
        rule.targetAddresses,
        rule.kind === "prior_period_delta" ? "semantic_relation" : "calculation_method",
        "high",
        reason,
      );
    }
    addRank(rule.targetLabel, 235, "semantic_formula_target_label");
    for (const dependencyLabel of rule.dependencyLabels) {
      addRank(dependencyLabel, 215, "semantic_formula_dependency_label");
    }
    for (const address of rule.targetAddresses) {
      const target = cellsByKey.get(workbookCellKey(rule.sheet, address)) ?? { sheet: rule.sheet, address, value: "" };
      addRank(target, 240, "semantic_formula_target");
      addCandidate("target", target, reason);
      for (const dependencyAddress of semanticRuleExpectedReferences(rule, address)) {
        const dependency = cellsByKey.get(workbookCellKey(rule.sheet, dependencyAddress));
        addRank(dependency, 225, "semantic_formula_dependency");
        addCandidate("dependency", dependency, `${address} depends on ${dependencyAddress} under the requested calculation rule`);
      }
    }
    const dependencyExpectations = rule.dependencyFormulaExpectations ?? [];
    if (dependencyExpectations.length > 0) {
      const dependencyReason = `${displayValue(rule.dependencyLabels[0]?.value)} must be extended from the visible formula pattern before calculating ${displayValue(rule.targetLabel.value)}`;
      if (dependencyExpectations.length > 1) {
        addTargetBand(
          rule.sheet,
          dependencyExpectations.map((expectation) => expectation.address),
          "semantic_relation",
          "high",
          dependencyReason,
        );
      }
      for (const expectation of dependencyExpectations) {
        const target = cellsByKey.get(workbookCellKey(rule.sheet, expectation.address)) ?? {
          sheet: rule.sheet,
          address: expectation.address,
          value: "",
        };
        addRank(target, 238, "semantic_dependency_formula_target");
        addCandidate("target", target, dependencyReason);
        for (const reference of expectation.formula.match(CELL_TOKEN_RE) ?? []) {
          const dependency = cellsByKey.get(workbookCellKey(rule.sheet, reference));
          addRank(dependency, 220, "semantic_dependency_formula_source");
          addCandidate("dependency", dependency, `${expectation.address} follows the visible formula pattern from ${reference}`);
        }
      }
      findings.push({
        kind: "semantic_formula_target",
        severity: "info",
        sheet: rule.sheet,
        address: dependencyExpectations[0].address,
        relatedAddresses: dependencyExpectations.slice(1).map((expectation) => expectation.address),
        detail: `${rule.dependencyLabels[0]?.address}=${displayValue(rule.dependencyLabels[0]?.value)} identifies a required dependency formula band.`,
        recommendedAction: `Extend the visible formula pattern exactly: ${dependencyExpectations.map((expectation) => `${expectation.address}=${expectation.formula}`).join(", ")}.`,
      });
    }
    const firstTarget = rule.targetAddresses[0];
    if (firstTarget) {
      findings.push({
        kind: "semantic_formula_target",
        severity: "info",
        sheet: rule.sheet,
        address: firstTarget,
        relatedAddresses: rule.targetAddresses.slice(1),
        detail: `${rule.targetLabel.address}=${displayValue(rule.targetLabel.value)} identifies ${rule.targetAddresses.join(", ")} as formula targets.`,
        recommendedAction: semanticRuleRepair(rule, firstTarget),
      });
    }
  }

  const lookupPassFailContract = inferLookupRangePassFailContract(args.instruction, args.cells);
  for (const blocked of lookupPassFailContract.blockedTargets) {
    blockedTargets.push(blocked);
    const target = cellsByKey.get(workbookCellKey(blocked.sheet, blocked.address)) ?? {
      sheet: blocked.sheet,
      address: blocked.address,
      value: "",
    };
    addRank(target, 245, "lookup_bounds_missing");
    addCandidate("target", target, blocked.reason);
    findings.push({
      kind: "lookup_bounds_missing",
      severity: "error",
      sheet: blocked.sheet,
      address: blocked.address,
      relatedAddresses: blocked.missingDependencies,
      detail: blocked.reason,
      recommendedAction: "Do not write a Pass/Fail result until every selected key has visible numeric lower and upper bounds.",
    });
  }
  const templateCompletions = [
    ...lookupPassFailContract.completions,
    ...inferWorkbookTemplateCompletions(args.instruction, args.cells),
  ];
  for (const completion of templateCompletions) {
    const formulaAddresses = completion.formulas.map((operation) => operation.cell);
    addTargetBand(
      completion.sheet,
      formulaAddresses,
      "calculation_method",
      "high",
      completion.reason,
    );
    if (completion.formulas.length > 0) {
      const sorted = [...completion.formulas].sort((left, right) => compareAddresses(left.cell, right.cell));
      formulaFillSuggestions.push({
        sheet: completion.sheet,
        range: `${sorted[0].cell}:${sorted.at(-1)!.cell}`,
        anchorAddress: sorted[0].cell,
        sourceFormula: sorted[0].formula,
        operations: sorted,
      });
      for (const operation of sorted) {
        const target = cellsByKey.get(workbookCellKey(operation.sheet, operation.cell)) ?? {
          sheet: operation.sheet,
          address: operation.cell,
          value: "",
        };
        addRank(target, 242, "template_formula_contract");
        addCandidate("target", target, completion.reason);
      }
      findings.push({
        kind: "semantic_formula_target",
        severity: "info",
        sheet: completion.sheet,
        address: sorted[0].cell,
        relatedAddresses: sorted.slice(1).map((operation) => operation.cell),
        detail: `${completion.reason}; ${sorted.length} formula cells are required by the visible row and period structure.`,
        recommendedAction: `Use the exact formula operations in formulaFillSuggestions for ${sorted[0].cell}:${sorted.at(-1)!.cell}.`,
      });
    }
    const values = completion.values ?? [];
    if (values.length > 0) {
      valueSuggestions.push(...values);
      addTargetBand(
        completion.sheet,
        values.map((value) => value.cell),
        "implicit_value_assignment",
        "high",
        completion.reason,
      );
      for (const value of values) {
        const target = cellsByKey.get(workbookCellKey(value.sheet, value.cell)) ?? {
          sheet: value.sheet,
          address: value.cell,
          value: "",
          ...(value.numFmt ? { numFmt: value.numFmt } : {}),
        };
        addRank(target, 240, "template_value_contract");
        addCandidate("target", target, completion.reason);
      }
    }
  }

  const implicitAssignments = inferImplicitValueAssignments(args.instruction, args.cells);
  for (const assignment of implicitAssignments) {
    valueSuggestions.push(assignment);
    const target = cellsByKey.get(workbookCellKey(assignment.sheet, assignment.cell)) ?? {
      sheet: assignment.sheet,
      address: assignment.cell,
      value: "",
      ...(assignment.numFmt ? { numFmt: assignment.numFmt } : {}),
    };
    addRank(target, 235, "implicit_assignment_target");
    addCandidate("target", target, assignment.evidence.join("; "));
    findings.push({
      kind: "implicit_assignment_target",
      severity: "info",
      sheet: assignment.sheet,
      address: assignment.cell,
      detail: `${assignment.cell} is the visible row/year intersection for an explicit value assignment.`,
      recommendedAction: `Set the requested value and preserve the surrounding row and workbook structure.`,
    });
  }
  for (const [sheet, assignments] of groupByMap(implicitAssignments, (assignment) => assignment.sheet)) {
    for (const addresses of contiguousAddressBands(assignments.map((assignment) => assignment.cell))) {
      addTargetBand(
        sheet,
        addresses,
        "implicit_value_assignment",
        "high",
        "row label and visible period headers identify every requested value target",
      );
    }
  }

  for (const band of targetBands.values()) {
    const suggestion = repeatedFormulaFillSuggestion(band, cellsByKey);
    if (!suggestion) continue;
    formulaFillSuggestions.push(suggestion);
    findings.push({
      kind: "formula_fill_band",
      severity: "warning",
      sheet: band.sheet,
      address: suggestion.anchorAddress,
      relatedAddresses: band.addresses.filter((address) => address !== suggestion.anchorAddress),
      detail: `${band.range} contains a repeated relative formula pattern established by multiple visible cells.`,
      recommendedAction: `Use the established pattern for all ${band.addresses.length} targets and verify the complete band.`,
    });
  }

  for (const sheet of args.sheetNames) {
    const sheetCells = args.cells.filter((cell) => cell.sheet === sheet);
    const first = sheetCells[0];
    if (first) addRank(first, 25, "sheet_representative");
    const last = sheetCells.at(-1);
    if (last) addRank(last, 20, "sheet_extent");
  }

  const explicitTargetKeys = new Set([...targetBands.values()]
    .filter((band) => band.source === "explicit_reference")
    .flatMap((band) => band.addresses.map((address) => workbookCellKey(band.sheet, address))));
  const focusTargetKeys = new Set<string>([
    ...explicitTargetKeys,
    ...compatibleFormulaKeys,
    ...averageSuggestionKeys,
    ...focusedFormulaKeys,
    ...focusedValueKeys,
    ...styleSuggestions.map((suggestion) => workbookCellKey(suggestion.sheet, suggestion.cell)),
  ]);
  if (auditFocus?.kind === "formula_errors") {
    for (const finding of findings.filter((candidate) => candidate.kind === "formula_error" || candidate.kind === "formula_self_reference")) {
      const key = workbookCellKey(finding.sheet, finding.address);
      focusTargetKeys.add(key);
      addCandidate("target", cellsByKey.get(key), `visible workbook error at ${finding.sheet}!${finding.address}`);
    }
  }
  const rankedCells = [...ranked.values()].sort((left, right) =>
    right.score - left.score || left.sheet.localeCompare(right.sheet) || compareAddresses(left.address, right.address));
  const boundedFindings = dedupeFindings(findings)
    .filter((finding) => !auditFocus || auditFocusAllowsFinding(auditFocus.kind, finding, focusTargetKeys))
    .slice(0, maxFindings);
  const recommendedReads = recommendedReadGroups(rankedCells.slice(0, 40));
  const allowEmptyPlan = EMPTY_PLAN_ALLOWED_RE.test(args.instruction);
  const mutatingTask = (MUTATING_TASK_RE.test(args.instruction) || METHOD_MUTATING_TASK_RE.test(args.instruction) || IMPLICIT_ASSIGNMENT_RE.test(args.instruction))
    && !/\b(?:explain|describe|summari[sz]e)\s+only\b/i.test(args.instruction);

  const dedupedFormulaRepairs = dedupeFormulaRepairSuggestions(formulaRepairSuggestions).slice(0, 64);
  const focusedValueSuggestions = auditFocus
    ? valueSuggestions.filter((suggestion) => focusedValueKeys.has(workbookCellKey(suggestion.sheet, suggestion.cell)))
    : valueSuggestions;
  const deterministicAuditKinds = new Set<WorkbookAuditFocus>([
    "incorrect_average",
    "embedded_hardcode",
    "color_coding",
    "double_counting",
    "index_match",
    "cross_sheet_reference",
    "unit_mismatch",
    "sign_convention",
    "relative_absolute_reference",
  ]);
  const deterministicOperations = [
    ...dedupedFormulaRepairs.map((suggestion) => ({ sheet: suggestion.sheet, cell: suggestion.cell })),
    ...focusedValueSuggestions.map((suggestion) => ({ sheet: suggestion.sheet, cell: suggestion.cell })),
    ...styleSuggestions.map((suggestion) => ({ sheet: suggestion.sheet, cell: suggestion.cell })),
  ];
  const deterministicOperationKeys = new Set(deterministicOperations.map((operation) => workbookCellKey(operation.sheet, operation.cell)));
  const deterministicSheets = [...new Set(deterministicOperations.map((operation) => operation.sheet))].sort();

  return {
    schema: 1,
    ...(auditFocus ? { auditFocus } : {}),
    mutatingTask,
    allowEmptyPlan,
    ...(auditFocus
      && auditFocus.kind !== "formula_errors"
      && deterministicAuditKinds.has(auditFocus.kind)
      && deterministicOperationKeys.size > 0
      && blockedTargets.length === 0
      ? {
          deterministicPlan: {
            status: "complete" as const,
            basis: "visible_workbook_invariants" as const,
            auditFocus: auditFocus.kind,
            operationCount: deterministicOperationKeys.size,
            sheets: deterministicSheets,
          },
        }
      : {}),
    referencedSheets,
    explicitReferences,
    targetCandidates: [...targetCandidates.values()].filter((target) =>
      !auditFocus || focusTargetKeys.has(workbookCellKey(target.sheet, target.address))),
    blockedTargets,
    targetBands: [...targetBands.values()].filter((band) => !auditFocus || band.source === "explicit_reference"),
    dependencyCandidates: [...dependencyCandidates.values()],
    findings: boundedFindings,
    formulaFillSuggestions: auditFocus ? [] : dedupeFormulaFillSuggestions(formulaFillSuggestions),
    formulaRepairSuggestions: dedupedFormulaRepairs,
    valueSuggestions: focusedValueSuggestions,
    styleSuggestions,
    rankedCellKeys: rankedCells.map((cell) => workbookCellKey(cell.sheet, cell.address)),
    recommendedReads,
    completionChecks: [
      "Every edited cell belongs to the requested workbook scope.",
      "Existing formulas are not replaced by scalars unless the task explicitly requires it.",
      "Changed formulas contain no broken references or obvious self-reference.",
      "Every changed target is re-read and checked after the write or recorded as pending approval.",
      "Unsupported macro, validation, or full-format work is reported as unresolved; chart requests require a real chart operation rather than a prose claim.",
    ],
  };
}

function inferImplicitValueAssignments(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookTaskInspection["valueSuggestions"] {
  const valueMatch = instruction.match(/\b(?:are|is|equals?|should\s+be|must\s+be)\s+[-+$]?([\d,.]+)\s*(%?)/i);
  const yearRange = instruction.match(/\bYears?\s+(\d+)\s*[^0-9]{1,8}\s*(\d+)/i);
  if (!valueMatch || !yearRange) return [];
  const startYear = Number(yearRange[1]);
  const endYear = Number(yearRange[2]);
  if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || startYear < 1 || endYear < startYear || endYear - startYear > 20) return [];
  const rawValue = Number(valueMatch[1].replace(/,/g, ""));
  if (!Number.isFinite(rawValue)) return [];
  const percent = valueMatch[2] === "%";
  const value = percent ? rawValue / 100 : rawValue;
  const requestedYears = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
  const bySheet = groupByMap(cells, (cell) => cell.sheet);
  const candidates: Array<{
    score: number;
    sheet: string;
    label: WorkbookObservedCell;
    headers: Map<number, WorkbookObservedCell>;
  }> = [];
  for (const [sheet, sheetCells] of bySheet) {
    const labelCells = sheetCells.filter((cell) => {
      const displayed = displayValue(cell.value).trim();
      return displayed && instructionTermScore(instruction, cell) >= 5 && !!parseAddress(cell.address);
    });
    for (const label of labelCells) {
      const position = parseAddress(label.address)!;
      for (let headerRow = position.row - 1; headerRow >= Math.max(1, position.row - 10); headerRow -= 1) {
        const headers = new Map<number, WorkbookObservedCell>();
        for (const cell of sheetCells) {
          const cellPosition = parseAddress(cell.address);
          if (!cellPosition || cellPosition.row !== headerRow) continue;
          const match = displayValue(cell.value).trim().match(/^Year\s+(\d+)\b/i);
          if (match) headers.set(Number(match[1]), cell);
        }
        const coverage = requestedYears.filter((year) => headers.has(year)).length;
        if (coverage === requestedYears.length) {
          candidates.push({
            score: coverage * 1_000 + instructionTermScore(instruction, label) * 10 - (position.row - headerRow),
            sheet,
            label,
            headers,
          });
          break;
        }
      }
    }
  }
  const selected = candidates.sort((left, right) => right.score - left.score)[0];
  if (!selected) return [];
  const labelPosition = parseAddress(selected.label.address)!;
  return requestedYears.map((year) => {
    const header = selected.headers.get(year)!;
    const headerPosition = parseAddress(header.address)!;
    return {
      confidence: "high" as const,
      sheet: selected.sheet,
      cell: addressFromPosition(labelPosition.row, headerPosition.col),
      value,
      ...(percent ? { numFmt: "0.0%" } : {}),
      evidence: [`row label ${selected.label.address}=${displayValue(selected.label.value)}`, `year header ${header.address}=${displayValue(header.value)}`],
    };
  });
}

function inferNamedYearTargetBands(
  instruction: string,
  sheetNames: string[],
  cells: WorkbookObservedCell[],
): Array<{
  sheet: string;
  labelAddress: string;
  headerAddresses: string[];
  addresses: string[];
  reason: string;
}> {
  const inferred = new Map<string, {
    sheet: string;
    labelAddress: string;
    headerAddresses: string[];
    addresses: string[];
    reason: string;
  }>();
  const bySheet = groupByMap(cells, (cell) => cell.sheet);
  const yearRangePattern = /\b((?:19|20)\d{2})\s*[AE]?\s*(?:to|through|[^A-Za-z0-9]{1,12})\s*((?:19|20)\d{2})\s*[AE]?\b/gi;
  for (const match of instruction.matchAll(yearRangePattern)) {
    const startYear = Number(match[1]);
    const endYear = Number(match[2]);
    if (endYear < startYear || endYear - startYear > 20) continue;
    const sheet = activeSheetAtInstructionOffset(instruction, match.index ?? 0, sheetNames);
    if (!sheet) continue;
    const sheetCells = bySheet.get(sheet) ?? [];
    const phrase = targetPhraseBeforeOffset(instruction, match.index ?? 0);
    const labelCandidates = sheetCells
      .map((cell) => ({ cell, score: targetLabelMatchScore(phrase, cell) }))
      .filter((candidate) => candidate.score >= 5 && !!parseAddress(candidate.cell.address))
      .sort((left, right) => right.score - left.score || compareAddresses(left.cell.address, right.cell.address));
    const years = Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index);
    for (const candidate of labelCandidates) {
      const header = visibleYearHeaderBand(sheetCells, candidate.cell.address, years);
      if (!header) continue;
      const labelPosition = parseAddress(candidate.cell.address)!;
      const addresses = header.cells.map((cell) => addressFromPosition(labelPosition.row, parseAddress(cell.address)!.col));
      const range = `${addresses[0]}:${addresses.at(-1)!}`;
      const reason = `row label ${candidate.cell.address}=${displayValue(candidate.cell.value)} and visible ${startYear}-${endYear} headers identify ${range}`;
      inferred.set(`${sheet.toLowerCase()}!${range}`, {
        sheet,
        labelAddress: candidate.cell.address,
        headerAddresses: header.cells.map((cell) => cell.address),
        addresses,
        reason,
      });
      break;
    }
  }
  return [...inferred.values()];
}

function inferWorkbookSemanticFormulaRules(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookSemanticFormulaRule[] {
  return [
    ...inferPriorPeriodFormulaRules(instruction, cells),
    ...inferAverageBalanceFormulaRules(instruction, cells),
  ];
}

function inferWorkbookTemplateCompletions(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookTemplateCompletion[] {
  return [
    ...inferDebtWaterfallTemplateCompletion(instruction, cells),
    ...inferWorkingCapitalTemplateCompletion(instruction, cells),
    ...inferDeferredTaxTemplateCompletion(instruction, cells),
  ];
}

function inferLookupRangePassFailContract(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookLookupPassFailContract {
  const empty = (): WorkbookLookupPassFailContract => ({ completions: [], blockedTargets: [] });
  if (!/\bpass\b[^.!?]{0,80}\bfail\b|\bfail\b[^.!?]{0,80}\bpass\b/i.test(instruction)) return empty();
  if (!/\b(?:corresponding|lookup|dropdown|range\s+defined|minimum\s+and\s+maximum)\b/i.test(instruction)) return empty();
  const sheetNames = [...new Set(cells.map((cell) => cell.sheet))];
  const references = extractWorkbookTaskReferences(instruction, sheetNames);
  const completions: WorkbookTemplateCompletion[] = [];
  const blockedTargets: WorkbookBlockedTarget[] = [];

  for (const sheet of sheetNames) {
    const sheetCells = cells.filter((cell) => cell.sheet === sheet);
    const byAddress = new Map(sheetCells.map((cell) => [normalizeAddress(cell.address), cell]));
    const targetReference = references
      .filter((reference) => reference.role === "target" && (!reference.sheet || reference.sheet.toLowerCase() === sheet.toLowerCase()))
      .map((reference) => ({ reference, start: parseAddress(reference.start), end: parseAddress(reference.end) }))
      .find(({ start, end }) => {
        if (!start || !end || start.col !== end.col || end.row - start.row < 1 || end.row - start.row > 100) return false;
        return Array.from({ length: end.row - start.row + 1 }, (_, index) => start.row + index).every((row) => {
          const cell = byAddress.get(addressFromPosition(row, start.col));
          return !!cell && (isBlank(unwrapCellValue(cell.value)) || !!cell.formula);
        });
      });
    if (!targetReference?.start || !targetReference.end) continue;
    const targetRows = Array.from(
      { length: targetReference.end.row - targetReference.start.row + 1 },
      (_, index) => targetReference.start!.row + index,
    );
    const dependencyBands = references
      .filter((reference) => reference !== targetReference.reference
        && (!reference.sheet || reference.sheet.toLowerCase() === sheet.toLowerCase()))
      .map((reference) => ({ reference, start: parseAddress(reference.start), end: parseAddress(reference.end) }))
      .filter(({ start, end }) => start && end && start.col === end.col && start.row === targetReference.start!.row && end.row === targetReference.end!.row);
    const keyBand = dependencyBands.find(({ start }) => targetRows.every((row) => {
      const value = unwrapCellValue(byAddress.get(addressFromPosition(row, start!.col))?.value);
      return typeof value === "string" && value.trim().length > 0;
    }));
    const measureBand = dependencyBands.find(({ start }) => targetRows.every((row) => {
      const value = unwrapCellValue(byAddress.get(addressFromPosition(row, start!.col))?.value);
      return typeof value === "number" && Number.isFinite(value);
    }));
    if (!keyBand?.start || !measureBand?.start) continue;
    const selectedKeys = new Set(targetRows.map((row) => String(unwrapCellValue(byAddress.get(addressFromPosition(row, keyBand.start!.col))?.value)).trim().toLowerCase()));

    const keyColumns = groupByMap(sheetCells.filter((cell) => {
      const value = unwrapCellValue(cell.value);
      return typeof value === "string" && /^[A-Z]$/i.test(value.trim()) && !!parseAddress(cell.address);
    }), (cell) => parseAddress(cell.address)!.col);
    const lookupBand = [...keyColumns.values()]
      .map((columnCells) => [...columnCells].sort((left, right) => parseAddress(left.address)!.row - parseAddress(right.address)!.row))
      .map((columnCells) => longestContiguousKeyRun(columnCells))
      .filter((columnCells) => columnCells.length >= 2 && [...selectedKeys].every((key) => columnCells.some((cell) => displayValue(cell.value).trim().toLowerCase() === key)))
      .sort((left, right) => right.length - left.length)[0];
    if (!lookupBand) continue;
    const lookupStart = parseAddress(lookupBand[0].address)!;
    const lookupEnd = parseAddress(lookupBand.at(-1)!.address)!;

    const boundReferences = references
      .filter((reference) => reference !== targetReference.reference
        && reference.start === reference.end
        && (!reference.sheet || reference.sheet.toLowerCase() === sheet.toLowerCase()))
      .map((reference) => parseAddress(reference.start))
      .filter((position): position is CellPosition => !!position && position.row === lookupStart.row && position.col > lookupStart.col)
      .sort((left, right) => left.col - right.col);
    const adjacentBounds = boundReferences.find((position, index) =>
      boundReferences[index + 1]?.col === position.col + 1);
    if (!adjacentBounds) continue;
    const upperBoundCol = adjacentBounds.col + 1;
    const missingBounds = targetRows.flatMap((targetRow) => {
      const targetAddress = addressFromPosition(targetRow, targetReference.start!.col);
      const selectedKey = displayValue(byAddress.get(addressFromPosition(targetRow, keyBand.start!.col))?.value).trim();
      const lookupKey = lookupBand.find((cell) => displayValue(cell.value).trim().toLowerCase() === selectedKey.toLowerCase());
      if (!lookupKey) {
        return [{
          sheet,
          address: targetAddress,
          reason: `${sheet}!${targetAddress} cannot be safely classified because selected key ${JSON.stringify(selectedKey)} has no visible lookup row.`,
          missingDependencies: [addressFromPosition(lookupStart.row, lookupStart.col)],
        } satisfies WorkbookBlockedTarget];
      }
      const lookupRow = parseAddress(lookupKey.address)!.row;
      const lowerAddress = addressFromPosition(lookupRow, adjacentBounds.col);
      const upperAddress = addressFromPosition(lookupRow, upperBoundCol);
      const lower = unwrapCellValue(byAddress.get(lowerAddress)?.value);
      const upper = unwrapCellValue(byAddress.get(upperAddress)?.value);
      const lowerValid = typeof lower === "number" && Number.isFinite(lower);
      const upperValid = typeof upper === "number" && Number.isFinite(upper);
      if (lowerValid && upperValid && lower <= upper) return [];
      const missingDependencies = [
        ...(!lowerValid ? [lowerAddress] : []),
        ...(!upperValid ? [upperAddress] : []),
        ...(lowerValid && upperValid && lower > upper ? [lowerAddress, upperAddress] : []),
      ];
      return [{
        sheet,
        address: targetAddress,
        reason: `${sheet}!${targetAddress} cannot be safely classified because selected key ${JSON.stringify(selectedKey)} has missing, non-numeric, or reversed bounds at ${lowerAddress}:${upperAddress}.`,
        missingDependencies,
      } satisfies WorkbookBlockedTarget];
    });
    if (missingBounds.length > 0) {
      blockedTargets.push(...missingBounds);
      continue;
    }
    const tableRange = `$${columnNumberToName(lookupStart.col)}$${lookupStart.row}:$${columnNumberToName(upperBoundCol)}$${lookupEnd.row}`;
    const lookupIndices = `{${adjacentBounds.col - lookupStart.col + 1},${upperBoundCol - lookupStart.col + 1}}`;
    const formulas = targetRows.map((row) => ({
      sheet,
      cell: addressFromPosition(row, targetReference.start!.col),
      formula: `IF(MEDIAN(${addressFromPosition(row, measureBand.start!.col)},VLOOKUP(${addressFromPosition(row, keyBand.start!.col)},${tableRange},${lookupIndices},0))=${addressFromPosition(row, measureBand.start!.col)},"Pass","Fail")`,
    }));
    completions.push({
      sheet,
      reason: "Visible selector, measurement, lookup keys, and adjacent lower/upper bound columns define a bounded pass/fail lookup contract",
      formulas,
    });
  }
  return { completions, blockedTargets };
}

function longestContiguousKeyRun(cells: WorkbookObservedCell[]): WorkbookObservedCell[] {
  let best: WorkbookObservedCell[] = [];
  let current: WorkbookObservedCell[] = [];
  for (const cell of cells) {
    const row = parseAddress(cell.address)!.row;
    const previousRow = current.length > 0 ? parseAddress(current.at(-1)!.address)!.row : undefined;
    current = previousRow !== undefined && row === previousRow + 1 ? [...current, cell] : [cell];
    if (current.length > best.length) best = current;
  }
  return best;
}

function inferDebtWaterfallTemplateCompletion(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookTemplateCompletion[] {
  if (!/\baverage\s+balance\s+method\b/i.test(instruction) || !/\binterest\s+expense\b/i.test(instruction)) return [];
  const completions: WorkbookTemplateCompletion[] = [];
  for (const [sheet, sheetCells] of groupByMap(cells, (cell) => cell.sheet)) {
    const cashFlow = contractLabel("Cash Flow Available", sheetCells);
    const requiredCash = contractLabel("Required Operating Cash", sheetCells);
    const availableCash = contractLabel("Available for Debt Repayment", sheetCells);
    const beginningRows = contractLabels("Beginning Balance", sheetCells);
    const repaymentRows = contractLabels("Repayment", sheetCells);
    const endingRows = contractLabels("Ending Balance", sheetCells);
    const rateRows = contractLabels("Interest Rate", sheetCells);
    const interestRows = contractLabels("Interest Expense", sheetCells);
    const totalDebt = contractLabel("Total Debt Outstanding", sheetCells);
    const totalInterest = contractLabel("Total Interest Expense", sheetCells);
    const cashRemaining = contractLabel("Cash Remaining", sheetCells);
    if (!cashFlow || !requiredCash || !availableCash || !totalDebt || !totalInterest || !cashRemaining) continue;
    const trancheCount = Math.min(beginningRows.length, repaymentRows.length, endingRows.length, rateRows.length, interestRows.length);
    if (trancheCount < 2) continue;
    const periodColumns = visibleQuarterColumns(sheetCells, interestRows[0]);
    if (periodColumns.length !== 4) continue;

    const formulas: WorkbookTemplateCompletion["formulas"] = [];
    for (const col of periodColumns) {
      formulas.push(contractFormula(sheet, availableCash, col, `${contractCell(cashFlow, col)}-${contractCell(requiredCash, col)}`));
    }
    for (let tranche = 0; tranche < trancheCount; tranche += 1) {
      const beginning = beginningRows[tranche];
      const repayment = repaymentRows[tranche];
      const ending = endingRows[tranche];
      const rate = rateRows[tranche];
      const interest = interestRows[tranche];
      for (const [periodIndex, col] of periodColumns.entries()) {
        if (periodIndex > 0) {
          formulas.push(contractFormula(sheet, beginning, col, contractCell(ending, periodColumns[periodIndex - 1])));
        }
        const repaymentCapacity = [contractCell(availableCash, col), ...repaymentRows.slice(0, tranche).map((row) => contractCell(row, col))].join("+");
        const repaymentFormula = tranche === 0
          ? `-MIN(${repaymentCapacity},${contractCell(beginning, col)})`
          : `-MAX(0,MIN(${repaymentCapacity},${contractCell(beginning, col)}))`;
        formulas.push(contractFormula(sheet, repayment, col, repaymentFormula));
        formulas.push(contractFormula(sheet, ending, col, `${contractCell(beginning, col)}+${contractCell(repayment, col)}`));
        formulas.push(contractFormula(
          sheet,
          interest,
          col,
          `${contractCell(rate, col)}*AVERAGE(${contractCell(beginning, col)},${contractCell(ending, col)})`,
        ));
      }
    }
    for (const col of periodColumns) {
      formulas.push(contractFormula(sheet, totalDebt, col, endingRows.slice(0, trancheCount).map((row) => contractCell(row, col)).join("+")));
      formulas.push(contractFormula(sheet, totalInterest, col, interestRows.slice(0, trancheCount).map((row) => contractCell(row, col)).join("+")));
      formulas.push(contractFormula(
        sheet,
        cashRemaining,
        col,
        [contractCell(availableCash, col), ...repaymentRows.slice(0, trancheCount).map((row) => contractCell(row, col))].join("+"),
      ));
    }
    completions.push({
      sheet,
      reason: "Visible quarterly debt tranches require beginning, repayment, ending, average-balance interest, and summary formulas",
      formulas: dedupeContractFormulas(formulas),
    });
  }
  return completions;
}

function inferWorkingCapitalTemplateCompletion(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookTemplateCompletion[] {
  if (!/\bforecast\b/i.test(instruction) || !/\bprior\s+period\b/i.test(instruction) || !/\bworking\s+capital\b/i.test(instruction)) return [];
  const completions: WorkbookTemplateCompletion[] = [];
  for (const [sheet, sheetCells] of groupByMap(cells, (cell) => cell.sheet)) {
    const semanticRule = inferPriorPeriodFormulaRules(instruction, sheetCells)
      .find((rule) => /cash/i.test(displayValue(rule.targetLabel.value)));
    if (!semanticRule) continue;
    const revenue = contractLabel("Revenue", sheetCells);
    const growth = contractLabel("qoq growth", sheetCells);
    const cost = contractLabel("Cost of goods sold", sheetCells);
    const costRatio = contractLabel("% of revenue", sheetCells);
    const grossMargin = contractLabel("Gross Margin", sheetCells);
    const cash = contractLabel("Cash & Equivalents", sheetCells);
    const receivables = contractLabel("Accounts Receivable", sheetCells);
    const dso = contractLabel("DSO Days", sheetCells);
    const inventory = contractLabel("Inventory", sheetCells);
    const inventoryDays = contractLabel("Inventory Days", sheetCells);
    const otherCurrentAssets = contractLabel("Other Current Assets", sheetCells);
    const currentLiabilities = contractLabel("Current Liabilities", sheetCells);
    const workingCapital = contractLabel("Changes in Working Capital", sheetCells);
    const labels = [revenue, growth, cost, costRatio, grossMargin, cash, receivables, dso, inventory, inventoryDays, otherCurrentAssets, currentLiabilities, workingCapital];
    if (labels.some((label) => !label)) continue;
    const quarterColumns = visibleQuarterColumns(sheetCells, cash!);
    const targetColumns = semanticRule.targetAddresses
      .map(parseAddress)
      .filter((position): position is CellPosition => !!position)
      .map((position) => position.col);
    const endpointColumns = new Set((semanticRule.endpointSummaryAddresses ?? [])
      .map(parseAddress)
      .filter((position): position is CellPosition => !!position)
      .map((position) => position.col));
    if (quarterColumns.length !== 4 || targetColumns.length < 2 || endpointColumns.size !== 1) continue;
    const formulas: WorkbookTemplateCompletion["formulas"] = [];
    const quarterStart = quarterColumns[0];
    const quarterEnd = quarterColumns.at(-1)!;
    for (const col of targetColumns) {
      const previousCol = col - 1;
      const endpoint = endpointColumns.has(col);
      if (endpoint) {
        formulas.push(contractFormula(sheet, revenue!, col, `SUM(${contractCell(revenue!, quarterStart)}:${contractCell(revenue!, quarterEnd)})`));
        formulas.push(contractFormula(sheet, cost!, col, `SUM(${contractCell(cost!, quarterStart)}:${contractCell(cost!, quarterEnd)})`));
        formulas.push(contractFormula(sheet, costRatio!, col, `${contractCell(cost!, col)}/${contractCell(revenue!, col)}`));
        formulas.push(contractFormula(sheet, grossMargin!, col, `SUM(${contractCell(grossMargin!, quarterStart)}:${contractCell(grossMargin!, quarterEnd)})`));
        for (const pointInTime of [cash!, receivables!, inventory!, otherCurrentAssets!, currentLiabilities!]) {
          formulas.push(contractFormula(sheet, pointInTime, col, contractCell(pointInTime, previousCol)));
        }
        formulas.push(contractFormula(sheet, workingCapital!, col, `SUM(${contractCell(workingCapital!, quarterStart)}:${contractCell(workingCapital!, quarterEnd)})`));
        continue;
      }
      formulas.push(contractFormula(sheet, revenue!, col, `${contractCell(revenue!, previousCol)}*(1+${contractCell(growth!, col)})`));
      formulas.push(contractFormula(sheet, cost!, col, `${contractCell(revenue!, col)}*${contractCell(costRatio!, col)}`));
      formulas.push(contractFormula(sheet, grossMargin!, col, `${contractCell(revenue!, col)}-${contractCell(cost!, col)}`));
      formulas.push(contractFormula(sheet, cash!, col, `${contractCell(cash!, previousCol)}+${contractCell(workingCapital!, col)}`));
      formulas.push(contractFormula(sheet, receivables!, col, `(${contractCell(revenue!, col)}/90)*${contractCell(dso!, col)}`));
      formulas.push(contractFormula(sheet, inventory!, col, `(${contractCell(cost!, col)}/90)*${contractCell(inventoryDays!, col)}`));
      formulas.push(contractFormula(sheet, currentLiabilities!, col, contractCell(currentLiabilities!, previousCol)));
      formulas.push(contractFormula(
        sheet,
        workingCapital!,
        col,
        `-(${contractCell(receivables!, col)}-${contractCell(receivables!, previousCol)})-(${contractCell(inventory!, col)}-${contractCell(inventory!, previousCol)})-(${contractCell(otherCurrentAssets!, col)}-${contractCell(otherCurrentAssets!, previousCol)})+(${contractCell(currentLiabilities!, col)}-${contractCell(currentLiabilities!, previousCol)})`,
      ));
    }
    completions.push({
      sheet,
      reason: "Visible quarterly working-capital rows require upstream operating formulas before the cash recurrence and FY endpoint",
      formulas: dedupeContractFormulas(formulas),
    });
  }
  return completions;
}

function inferDeferredTaxTemplateCompletion(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookTemplateCompletion[] {
  if (!/\bdeferred\s+tax\b/i.test(instruction) || !/\byears?\s*2\s*(?:-|to|through)\s*4\b/i.test(instruction)) return [];
  const completions: WorkbookTemplateCompletion[] = [];
  for (const [sheet, sheetCells] of groupByMap(cells, (cell) => cell.sheet)) {
    const bookSection = contractLabel("Book Accounting", sheetCells);
    const taxSection = contractLabel("Tax Accounting", sheetCells);
    const bookPosition = bookSection && parseAddress(bookSection.address);
    const taxPosition = taxSection && parseAddress(taxSection.address);
    if (!bookPosition || !taxPosition) continue;
    const bookYears = visibleYearColumns(sheetCells, bookPosition.col, taxPosition.col - 1);
    const taxYears = visibleYearColumns(sheetCells, taxPosition.col, Number.POSITIVE_INFINITY);
    if (![1, 2, 3, 4].every((year) => bookYears.has(year)) || ![2, 3, 4].every((year) => taxYears.has(year))) continue;
    const revenue = contractLabel("Revenue", sheetCells);
    const operatingExpenses = contractLabel("Operating expenses", sheetCells);
    const pretaxIncome = contractLabel("Pretax income", sheetCells);
    const incomeTax = contractLabel("Income tax", sheetCells);
    const netIncome = contractLabel("Net income", sheetCells);
    const cash = contractLabel("Cash", sheetCells);
    const deferredTaxAssets = contractLabel("Deferred tax assets", sheetCells);
    const equipment = contractLabel("Equipment", sheetCells);
    const totalAssets = contractLabel("Total assets", sheetCells);
    const debt = contractLabel("Debt", sheetCells);
    const deferredRevenue = contractLabel("Deferred revenue", sheetCells);
    const deferredTaxLiabilities = contractLabel("Deferred tax liabilities", sheetCells);
    const totalLiabilities = contractLabel("Total liabilities", sheetCells);
    const commonEquity = contractLabel("Common equity", sheetCells);
    const balanceCheck = contractLabel("Balance check", sheetCells);
    const cashFlowNetIncome = contractLabels("Net income", sheetCells).at(-1);
    const changeDeferredTaxAssets = contractLabel("Change in deferred tax assets", sheetCells);
    const changeDeferredRevenue = contractLabel("Change in deferred revenue", sheetCells);
    const cashFromOperations = contractLabel("Cash from operations", sheetCells);
    const labels = [revenue, operatingExpenses, pretaxIncome, incomeTax, netIncome, cash, deferredTaxAssets, equipment, totalAssets, debt, deferredRevenue, deferredTaxLiabilities, totalLiabilities, commonEquity, balanceCheck, cashFlowNetIncome, changeDeferredTaxAssets, changeDeferredRevenue, cashFromOperations];
    if (labels.some((label) => !label)) continue;
    const taxRate = visibleTaxRate(incomeTax!);
    const annualRevenue = visibleAnnualRevenueRecognition(sheetCells);
    if (taxRate === undefined || annualRevenue === undefined) continue;
    const rateText = String(taxRate);
    const formulas: WorkbookTemplateCompletion["formulas"] = [];
    const values: NonNullable<WorkbookTemplateCompletion["values"]> = [];
    for (const year of [2, 3, 4]) {
      const col = bookYears.get(year)!;
      const previousCol = bookYears.get(year - 1)!;
      const taxCol = taxYears.get(year)!;
      values.push({
        confidence: "high",
        sheet,
        cell: contractCell(revenue!, col),
        value: annualRevenue,
        ...(cellAt(sheetCells, revenue!, col)?.numFmt ? { numFmt: cellAt(sheetCells, revenue!, col)!.numFmt } : {}),
        evidence: [`Visible narrative states ${annualRevenue} of annual GAAP revenue for years 2-4.`],
      });
      formulas.push(contractFormula(sheet, pretaxIncome!, col, `${contractCell(revenue!, col)}-${contractCell(operatingExpenses!, col)}`));
      formulas.push(contractFormula(sheet, incomeTax!, col, `${contractCell(pretaxIncome!, col)}*${rateText}`));
      formulas.push(contractFormula(sheet, netIncome!, col, `${contractCell(pretaxIncome!, col)}-${contractCell(incomeTax!, col)}`));
      formulas.push(contractFormula(
        sheet,
        cash!,
        col,
        `${contractCell(cash!, previousCol)}+${contractCell(revenue!, taxCol)}-${contractCell(operatingExpenses!, taxCol)}-(${contractCell(revenue!, taxCol)}-${contractCell(operatingExpenses!, taxCol)})*${rateText}`,
      ));
      formulas.push(contractFormula(
        sheet,
        deferredTaxAssets!,
        col,
        `${contractCell(deferredTaxAssets!, previousCol)}+((${contractCell(revenue!, taxCol)}-${contractCell(operatingExpenses!, taxCol)})-(${contractCell(revenue!, col)}-${contractCell(operatingExpenses!, col)}))*${rateText}`,
      ));
      formulas.push(contractFormula(sheet, equipment!, col, contractCell(equipment!, previousCol)));
      formulas.push(contractFormula(sheet, totalAssets!, col, `SUM(${contractCell(cash!, col)}:${contractCell(equipment!, col)})`));
      formulas.push(contractFormula(sheet, debt!, col, contractCell(debt!, previousCol)));
      formulas.push(contractFormula(sheet, deferredRevenue!, col, `${contractCell(deferredRevenue!, previousCol)}+${contractCell(revenue!, taxCol)}-${contractCell(revenue!, col)}`));
      formulas.push(contractFormula(sheet, deferredTaxLiabilities!, col, contractCell(deferredTaxLiabilities!, previousCol)));
      formulas.push(contractFormula(sheet, totalLiabilities!, col, `SUM(${contractCell(debt!, col)}:${contractCell(deferredTaxLiabilities!, col)})`));
      formulas.push(contractFormula(sheet, commonEquity!, col, `${contractCell(commonEquity!, previousCol)}+${contractCell(netIncome!, col)}`));
      formulas.push(contractFormula(sheet, balanceCheck!, col, `${contractCell(totalAssets!, col)}-${contractCell(totalLiabilities!, col)}-${contractCell(commonEquity!, col)}`));
      formulas.push(contractFormula(sheet, cashFlowNetIncome!, col, contractCell(netIncome!, col)));
      formulas.push(contractFormula(sheet, changeDeferredTaxAssets!, col, `${contractCell(deferredTaxAssets!, previousCol)}-${contractCell(deferredTaxAssets!, col)}`));
      formulas.push(contractFormula(sheet, changeDeferredRevenue!, col, `${contractCell(deferredRevenue!, col)}-${contractCell(deferredRevenue!, previousCol)}`));
      formulas.push(contractFormula(sheet, cashFromOperations!, col, `SUM(${contractCell(cashFlowNetIncome!, col)}:${contractCell(changeDeferredRevenue!, col)})`));
    }
    completions.push({
      sheet,
      reason: "Parallel book and tax year columns define the deferred-tax income statement, balance-sheet roll-forward, and cash-flow reconciliation",
      formulas: dedupeContractFormulas(formulas),
      values,
    });
  }
  return completions;
}

function contractLabel(phrase: string, cells: WorkbookObservedCell[]): WorkbookObservedCell | undefined {
  return semanticLabelCandidates(phrase, cells)[0]?.cell;
}

function contractLabels(phrase: string, cells: WorkbookObservedCell[]): WorkbookObservedCell[] {
  return semanticLabelCandidates(phrase, cells).map((candidate) => candidate.cell);
}

function contractCell(label: WorkbookObservedCell, col: number): string {
  const position = parseAddress(label.address)!;
  return addressFromPosition(position.row, col);
}

function contractFormula(
  sheet: string,
  label: WorkbookObservedCell,
  col: number,
  formula: string,
): { sheet: string; cell: string; formula: string } {
  return { sheet, cell: contractCell(label, col), formula };
}

function dedupeContractFormulas(
  formulas: WorkbookTemplateCompletion["formulas"],
): WorkbookTemplateCompletion["formulas"] {
  const byTarget = new Map<string, WorkbookTemplateCompletion["formulas"][number]>();
  for (const formula of formulas) byTarget.set(workbookCellKey(formula.sheet, formula.cell), formula);
  return [...byTarget.values()].sort((left, right) => compareAddresses(left.cell, right.cell));
}

function visibleYearColumns(cells: WorkbookObservedCell[], minCol: number, maxCol: number): Map<number, number> {
  const years = new Map<number, number>();
  for (const cell of cells) {
    const position = parseAddress(cell.address);
    if (!position || position.col < minCol || position.col > maxCol) continue;
    const match = displayValue(cell.value).trim().match(/^Year\s+([1-9][0-9]*)$/i);
    if (match) years.set(Number(match[1]), position.col);
  }
  return years;
}

function visibleTaxRate(label: WorkbookObservedCell): number | undefined {
  const match = displayValue(label.value).match(/(\d+(?:\.\d+)?)\s*%\s*rate/i);
  if (!match) return undefined;
  const value = Number(match[1]) / 100;
  return Number.isFinite(value) ? value : undefined;
}

function visibleAnnualRevenueRecognition(cells: WorkbookObservedCell[]): number | undefined {
  for (const cell of cells) {
    const text = displayValue(cell.value);
    const match = text.match(/recognizes(?:\s+revenue\s+of)?\s+\$?([\d,.]+)(?:\s+in\s+revenue)?\s+(?:per\s+year|evenly)/i);
    if (!match) continue;
    const value = Number(match[1].replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function cellAt(
  cells: WorkbookObservedCell[],
  label: WorkbookObservedCell,
  col: number,
): WorkbookObservedCell | undefined {
  const target = contractCell(label, col);
  return cells.find((cell) => cell.sheet === label.sheet && normalizeAddress(cell.address) === target);
}

function inferPriorPeriodFormulaRules(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookSemanticFormulaRule[] {
  const match = instruction.match(
    /\b(?:forecast|calculate|derive|populate|fill)\s+(.{1,80}?)\s+as\s+(?:the\s+)?(?:prior|previous)\s+(?:period|quarter|month|year)\s+(.{1,80}?)\s+(plus|minus)\s+(.{1,120}?)(?:[.!?]|$)/i,
  );
  if (!match) return [];
  const targetPhrase = match[1].trim();
  const priorPhrase = match[2].trim();
  const operator = match[3].toLowerCase() as "plus" | "minus";
  const dependencyPhrase = match[4].trim();
  const rules: WorkbookSemanticFormulaRule[] = [];
  for (const [sheet, sheetCells] of groupByMap(cells, (cell) => cell.sheet)) {
    const dependency = semanticLabelCandidates(dependencyPhrase, sheetCells)[0]?.cell;
    if (!dependency) continue;
    const target = semanticLabelCandidates(targetPhrase, sheetCells)
      .filter((candidate) => semanticLabelScore(priorPhrase, candidate.cell) >= 80)
      .map((candidate) => ({
        ...candidate,
        blankTargets: semanticCalculationTargets(sheetCells, candidate.cell, [dependency]),
      }))
      .filter((candidate) => candidate.blankTargets.length > 0)
      .sort((left, right) => right.score - left.score || right.blankTargets.length - left.blankTargets.length)[0];
    if (!target) continue;
    const endpointSummaryAddresses = inferEndpointSummaryAddresses(sheetCells, target.cell, target.blankTargets);
    rules.push({
      kind: "prior_period_delta",
      sheet,
      targetLabel: target.cell,
      targetAddresses: target.blankTargets,
      dependencyLabels: [dependency],
      operator,
      endpointSummaryAddresses,
      dependencyFormulaExpectations: inferDependencyFormulaExpectations(
        sheetCells,
        dependency,
        target.blankTargets,
        endpointSummaryAddresses,
      ),
    });
  }
  return rules;
}

function inferAverageBalanceFormulaRules(
  instruction: string,
  cells: WorkbookObservedCell[],
): WorkbookSemanticFormulaRule[] {
  const match = instruction.match(/\b(?:use|apply)\s+(?:the\s+)?average\s+balance\s+method\s+for\s+(.{1,100}?)(?:[.!?]|$)/i);
  if (!match) return [];
  const targetPhrase = match[1].trim();
  const rules: WorkbookSemanticFormulaRule[] = [];
  for (const [sheet, sheetCells] of groupByMap(cells, (cell) => cell.sheet)) {
    const normalizedTargetPhrase = normalizeSemanticLabel(targetPhrase);
    for (const target of semanticLabelCandidates(targetPhrase, sheetCells)
      .filter((candidate) => normalizeSemanticLabel(displayValue(candidate.cell.value)) === normalizedTargetPhrase)) {
      const targetPosition = parseAddress(target.cell.address);
      if (!targetPosition) continue;
      const beginning = closestPriorSemanticLabel("Beginning Balance", target.cell, sheetCells, 8);
      const ending = closestPriorSemanticLabel("Ending Balance", target.cell, sheetCells, 8);
      const rate = closestPriorSemanticLabel("Interest Rate", target.cell, sheetCells, 8);
      if (!beginning || !ending || !rate) continue;
      const targetAddresses = semanticCalculationTargets(sheetCells, target.cell, [beginning, ending, rate]);
      if (targetAddresses.length === 0) continue;
      rules.push({
        kind: "average_balance",
        sheet,
        targetLabel: target.cell,
        targetAddresses,
        dependencyLabels: [beginning, ending, rate],
        periodsPerYear: /\b(?:annual|annualized|per\s+annum)\b/i.test(instruction)
          ? inferPeriodsPerYear(sheetCells, target.cell)
          : undefined,
      });
    }
  }
  return rules;
}

function semanticLabelCandidates(
  phrase: string,
  cells: WorkbookObservedCell[],
): Array<{ cell: WorkbookObservedCell; score: number }> {
  return cells
    .map((cell) => ({ cell, score: semanticLabelScore(phrase, cell) }))
    .filter((candidate) => candidate.score >= 80 && !!parseAddress(candidate.cell.address))
    .sort((left, right) => right.score - left.score || compareAddresses(left.cell.address, right.cell.address));
}

function semanticLabelScore(phrase: string, cell: WorkbookObservedCell): number {
  if (cell.formula || typeof unwrapCellValue(cell.value) !== "string") return 0;
  const label = displayValue(cell.value).trim();
  const normalizedPhrase = normalizeSemanticLabel(phrase);
  const normalizedLabel = normalizeSemanticLabel(label);
  if (!normalizedPhrase || !normalizedLabel) return 0;
  if (normalizedPhrase === normalizedLabel) return 1_000;
  const phraseTokens = new Set(normalizedPhrase.split(" ").filter((token) => !TASK_TERM_STOPWORDS.has(token)));
  const labelTokens = new Set(normalizedLabel.split(" ").filter((token) => !TASK_TERM_STOPWORDS.has(token)));
  if (phraseTokens.size === 0 || labelTokens.size === 0) return 0;
  const matched = [...phraseTokens].filter((token) => labelTokens.has(token));
  if (matched.length !== phraseTokens.size) return 0;
  return 200 + matched.reduce((score, token) => score + Math.min(20, token.length), 0)
    + (normalizedLabel.startsWith(normalizedPhrase) ? 80 : 0);
}

function normalizeSemanticLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function closestPriorSemanticLabel(
  phrase: string,
  target: WorkbookObservedCell,
  cells: WorkbookObservedCell[],
  maxRows: number,
): WorkbookObservedCell | undefined {
  const targetPosition = parseAddress(target.address);
  if (!targetPosition) return undefined;
  return semanticLabelCandidates(phrase, cells)
    .filter(({ cell }) => {
      const position = parseAddress(cell.address)!;
      return position.row < targetPosition.row
        && targetPosition.row - position.row <= maxRows
        && position.col === targetPosition.col;
    })
    .sort((left, right) => {
      const leftPosition = parseAddress(left.cell.address)!;
      const rightPosition = parseAddress(right.cell.address)!;
      return rightPosition.row - leftPosition.row || right.score - left.score;
    })[0]?.cell;
}

function semanticCalculationTargets(
  cells: WorkbookObservedCell[],
  targetLabel: WorkbookObservedCell,
  dependencyLabels: WorkbookObservedCell[],
): string[] {
  const targetPosition = parseAddress(targetLabel.address);
  if (!targetPosition) return [];
  const dependencyRows = new Set(dependencyLabels.map((cell) => parseAddress(cell.address)?.row).filter((row): row is number => !!row));
  const dependencyColumns = new Set(cells
    .filter((cell) => dependencyRows.has(parseAddress(cell.address)?.row ?? -1))
    .map((cell) => parseAddress(cell.address)?.col)
    .filter((col): col is number => !!col));
  return cells
    .filter((cell) => {
      const position = parseAddress(cell.address);
      return !!position
        && position.row === targetPosition.row
        && position.col > targetPosition.col
        && dependencyColumns.has(position.col)
        && (!!normalizeFormula(cell.formula) || isBlank(unwrapCellValue(cell.value)));
    })
    .map((cell) => normalizeAddress(cell.address))
    .sort(compareAddresses)
    .slice(0, 64);
}

function inferPeriodsPerYear(cells: WorkbookObservedCell[], targetLabel: WorkbookObservedCell): number | undefined {
  const targetPosition = parseAddress(targetLabel.address);
  if (!targetPosition) return undefined;
  const quarterRows = new Map<number, Set<number>>();
  for (const cell of cells) {
    const position = parseAddress(cell.address);
    if (!position || position.row >= targetPosition.row) continue;
    const quarter = displayValue(cell.value).match(/\bQ([1-4])\b/i);
    if (!quarter) continue;
    const seen = quarterRows.get(position.row) ?? new Set<number>();
    seen.add(Number(quarter[1]));
    quarterRows.set(position.row, seen);
  }
  return [...quarterRows.values()].some((quarters) => quarters.size === 4) ? 4 : undefined;
}

function inferEndpointSummaryAddresses(
  cells: WorkbookObservedCell[],
  targetLabel: WorkbookObservedCell,
  targetAddresses: string[],
): string[] {
  const targetPosition = parseAddress(targetLabel.address);
  if (!targetPosition) return [];
  const targetColumns = new Set(targetAddresses.map((address) => parseAddress(address)?.col).filter((col): col is number => !!col));
  const byRow = groupByMap(cells.filter((cell) => {
    const position = parseAddress(cell.address);
    return !!position && position.row < targetPosition.row && targetColumns.has(position.col);
  }), (cell) => parseAddress(cell.address)!.row);
  const candidates: Array<{ row: number; endpointCols: number[]; quarterCount: number }> = [];
  for (const [row, rowCells] of byRow) {
    const labels = new Map(rowCells.map((cell) => [parseAddress(cell.address)!.col, displayValue(cell.value).trim()]));
    const quarterCount = [...labels.values()].filter((label) => /\bQ[1-4]\b/i.test(label)).length;
    if (quarterCount < 2) continue;
    const endpointCols = [...labels.entries()]
      .filter(([col, label]) => /\b(?:FY|LTM|TTM|ANNUAL)\b/i.test(label) && /\bQ4\b/i.test(labels.get(col - 1) ?? ""))
      .map(([col]) => col);
    if (endpointCols.length > 0) candidates.push({ row, endpointCols, quarterCount });
  }
  const selected = candidates.sort((left, right) => right.quarterCount - left.quarterCount || right.row - left.row)[0];
  return selected
    ? selected.endpointCols.map((col) => addressFromPosition(targetPosition.row, col)).filter((address) => targetAddresses.includes(address))
    : [];
}

function inferDependencyFormulaExpectations(
  cells: WorkbookObservedCell[],
  dependencyLabel: WorkbookObservedCell,
  targetAddresses: string[],
  endpointSummaryAddresses: string[],
): Array<{ address: string; formula: string }> {
  const dependencyPosition = parseAddress(dependencyLabel.address);
  const targetPositions = targetAddresses.map(parseAddress).filter((position): position is CellPosition => !!position);
  if (!dependencyPosition || targetPositions.length === 0) return [];
  const firstTargetCol = Math.min(...targetPositions.map((position) => position.col));
  const formulaCells = cells
    .filter((cell) => {
      const position = parseAddress(cell.address);
      return !!position
        && position.row === dependencyPosition.row
        && position.col < firstTargetCol
        && !!normalizeFormula(cell.formula);
    })
    .sort((left, right) => compareAddresses(left.address, right.address));
  let anchor: WorkbookObservedCell | undefined;
  for (let index = 1; index < formulaCells.length; index += 1) {
    const previous = formulaCells[index - 1];
    const current = formulaCells[index];
    const previousPosition = parseAddress(previous.address)!;
    const currentPosition = parseAddress(current.address)!;
    if (currentPosition.col !== previousPosition.col + 1) continue;
    if (formulaPattern(previous.formula!, previous.address) !== formulaPattern(current.formula!, current.address)) continue;
    anchor = current;
  }
  if (!anchor) return [];
  const quarterColumns = visibleQuarterColumns(cells, dependencyLabel);
  const endpointSet = new Set(endpointSummaryAddresses.map(normalizeAddress));
  const expectations: Array<{ address: string; formula: string }> = [];
  for (const targetAddress of targetAddresses) {
    const target = parseAddress(targetAddress)!;
    const dependencyAddress = addressFromPosition(dependencyPosition.row, target.col);
    if (endpointSet.has(normalizeAddress(targetAddress)) && quarterColumns.length === 4) {
      const start = addressFromPosition(dependencyPosition.row, quarterColumns[0]);
      const end = addressFromPosition(dependencyPosition.row, quarterColumns.at(-1)!);
      expectations.push({ address: dependencyAddress, formula: `SUM(${start}:${end})` });
      continue;
    }
    expectations.push({
      address: dependencyAddress,
      formula: translateFormulaBetweenCells(anchor.formula!, anchor.address, dependencyAddress),
    });
  }
  return expectations;
}

function visibleQuarterColumns(cells: WorkbookObservedCell[], anchor: WorkbookObservedCell): number[] {
  const anchorPosition = parseAddress(anchor.address);
  if (!anchorPosition) return [];
  const byRow = groupByMap(cells.filter((cell) => {
    const position = parseAddress(cell.address);
    return !!position && position.row < anchorPosition.row && /\bQ[1-4]\b/i.test(displayValue(cell.value));
  }), (cell) => parseAddress(cell.address)!.row);
  const candidates = [...byRow.entries()].flatMap(([row, rowCells]) => {
    const byQuarter = new Map<number, number>();
    for (const cell of rowCells) {
      const match = displayValue(cell.value).match(/\bQ([1-4])\b/i);
      const position = parseAddress(cell.address);
      if (match && position) byQuarter.set(Number(match[1]), position.col);
    }
    return byQuarter.size === 4
      ? [{ row, columns: [1, 2, 3, 4].map((quarter) => byQuarter.get(quarter)!) }]
      : [];
  });
  return candidates.sort((left, right) => right.row - left.row)[0]?.columns ?? [];
}

function semanticRuleExpectedReferences(rule: WorkbookSemanticFormulaRule, targetAddress: string): string[] {
  const target = parseAddress(targetAddress);
  if (!target) return [];
  if (rule.kind === "prior_period_delta") {
    const dependency = parseAddress(rule.dependencyLabels[0]?.address ?? "");
    if (rule.endpointSummaryAddresses?.includes(normalizeAddress(targetAddress))) {
      return [addressFromPosition(target.row, target.col - 1)];
    }
    return dependency
      ? [addressFromPosition(target.row, target.col - 1), addressFromPosition(dependency.row, target.col)]
      : [];
  }
  return rule.dependencyLabels
    .map((label) => parseAddress(label.address))
    .filter((position): position is CellPosition => !!position)
    .map((position) => addressFromPosition(position.row, target.col));
}

function semanticFormulaMismatch(
  rule: WorkbookSemanticFormulaRule,
  targetAddress: string,
  formula: string | undefined,
): string | undefined {
  if (!formula) return `${rule.sheet}!${targetAddress} must remain a formula under the requested calculation rule, not a hardcoded value.`;
  const expectedReferences = semanticRuleExpectedReferences(rule, targetAddress);
  const missingReferences = expectedReferences.filter((address) => !formulaReferencesAddress(formula, address));
  if (missingReferences.length > 0) {
    return `${rule.sheet}!${targetAddress} omits required visible dependencies ${missingReferences.join(", ")}.`;
  }
  const compact = normalizeFormula(formula) ?? "";
  if (rule.kind === "prior_period_delta") {
    if (rule.endpointSummaryAddresses?.includes(normalizeAddress(targetAddress))) {
      const samePeriodDependency = parseAddress(rule.dependencyLabels[0]?.address ?? "");
      if (samePeriodDependency && formulaReferencesAddress(formula, addressFromPosition(samePeriodDependency.row, parseAddress(targetAddress)!.col))) {
        return `${rule.sheet}!${targetAddress} is an annual endpoint after Q4 and must not add the full-year flow again.`;
      }
      return undefined;
    }
    if (rule.operator === "plus" && !compact.includes("+") && !/^SUM\(/i.test(compact)) {
      return `${rule.sheet}!${targetAddress} must add the prior-period value and the same-period dependency.`;
    }
    if (rule.operator === "minus" && !compact.includes("-")) {
      return `${rule.sheet}!${targetAddress} must subtract the same-period dependency from the prior-period value.`;
    }
    return undefined;
  }
  const averagesBalances = /\bAVERAGE\(/i.test(compact) || /\/2(?:\D|$)/.test(compact) || /\*0?\.5(?:\D|$)/.test(compact);
  if (!averagesBalances) return `${rule.sheet}!${targetAddress} does not average beginning and ending balances.`;
  if (rule.periodsPerYear && rule.periodsPerYear > 1) {
    const periodFactor = new RegExp(`/${rule.periodsPerYear}(?:\\D|$)`).test(compact)
      || (rule.periodsPerYear === 4 && /\*0?\.25(?:\D|$)/.test(compact));
    if (!periodFactor) return `${rule.sheet}!${targetAddress} does not convert the annual rate to the visible quarterly period.`;
  }
  return undefined;
}

function semanticRuleRepair(rule: WorkbookSemanticFormulaRule, targetAddress: string): string {
  const references = semanticRuleExpectedReferences(rule, targetAddress);
  if (rule.kind === "prior_period_delta") {
    if (rule.endpointSummaryAddresses?.includes(normalizeAddress(targetAddress))) {
      return `${targetAddress} is an annual endpoint immediately after Q4; carry forward the Q4 ${displayValue(rule.targetLabel.value)} balance with =${references[0]}.`;
    }
    const operator = rule.operator === "minus" ? "-" : "+";
    return `Use prior-period ${displayValue(rule.targetLabel.value)} at ${references[0]} and same-period ${displayValue(rule.dependencyLabels[0]?.value)} at ${references[1]}; for example =${references[0]}${operator}${references[1]}.`;
  }
  const periodDivisor = rule.periodsPerYear && rule.periodsPerYear > 1 ? `/${rule.periodsPerYear}` : "";
  return `Use a formula such as =AVERAGE(${references[0]},${references[1]})*${references[2]}${periodDivisor}; preserve the visible period format and verify the result.`;
}

function activeSheetAtInstructionOffset(instruction: string, offset: number, sheetNames: string[]): string | undefined {
  const prefix = instruction.slice(0, offset);
  let selected: { sheet: string; index: number; length: number } | undefined;
  for (const sheet of sheetNames) {
    const pattern = new RegExp(`(^|[^a-z0-9])(${escapeRegExp(sheet)})(?=$|[^a-z0-9])`, "ig");
    for (const match of prefix.matchAll(pattern)) {
      const index = (match.index ?? 0) + match[1].length;
      if (!selected || index > selected.index || (index === selected.index && sheet.length > selected.length)) {
        selected = { sheet, index, length: sheet.length };
      }
    }
  }
  return selected?.sheet ?? (sheetNames.length === 1 ? sheetNames[0] : undefined);
}

function targetPhraseBeforeOffset(instruction: string, offset: number): string {
  const start = Math.max(0, offset - 240);
  const window = instruction.slice(start, offset);
  const commands = [...window.matchAll(/\b(?:calculate|fill|populate|complete|set|write|derive)\b/gi)];
  const command = commands.at(-1);
  return command ? window.slice(command.index ?? 0) : window;
}

function targetLabelMatchScore(phrase: string, cell: WorkbookObservedCell): number {
  const label = displayValue(cell.value).trim();
  if (!label || visibleCalendarYear(cell.value) !== undefined) return 0;
  const labelTokens = (label.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])
    .filter((token) => !TASK_TERM_STOPWORDS.has(token));
  if (labelTokens.length === 0) return 0;
  const phraseTokens = new Set(phrase.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []);
  const matched = [...new Set(labelTokens)].filter((token) => phraseTokens.has(token));
  if (matched.length === 0) return 0;
  const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedPhrase = phrase.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const exactLabel = normalizedLabel.length >= 3 && (` ${normalizedPhrase} `).includes(` ${normalizedLabel} `);
  return matched.reduce((score, token) => score + Math.min(12, token.length), 0)
    + (matched.length === new Set(labelTokens).size ? 40 : 0)
    + (exactLabel ? 200 : 0);
}

function visibleYearHeaderBand(
  cells: WorkbookObservedCell[],
  labelAddress: string,
  years: number[],
): { cells: WorkbookObservedCell[] } | undefined {
  const label = parseAddress(labelAddress);
  if (!label) return undefined;
  const candidates: Array<{ cells: WorkbookObservedCell[]; contiguous: boolean; row: number }> = [];
  for (const [row, rowCells] of groupByMap(
    cells.filter((cell) => {
      const position = parseAddress(cell.address);
      return !!position && position.row < label.row;
    }),
    (cell) => parseAddress(cell.address)!.row,
  )) {
    const byYear = new Map<number, WorkbookObservedCell>();
    for (const cell of rowCells) {
      const year = visibleCalendarYear(cell.value);
      if (year !== undefined && !byYear.has(year)) byYear.set(year, cell);
    }
    if (!years.every((year) => byYear.has(year))) continue;
    const headerCells = years.map((year) => byYear.get(year)!);
    const columns = headerCells.map((cell) => parseAddress(cell.address)!.col);
    if (new Set(columns).size !== columns.length || columns.some((column) => column <= label.col)) continue;
    const increasing = columns.every((column, index) => index === 0 || column > columns[index - 1]);
    if (!increasing) continue;
    candidates.push({
      cells: headerCells,
      contiguous: columns.every((column, index) => index === 0 || column === columns[index - 1] + 1),
      row,
    });
  }
  return candidates
    .sort((left, right) => Number(right.contiguous) - Number(left.contiguous) || right.row - left.row)[0];
}

function visibleCalendarYear(value: unknown): number | undefined {
  const raw = unwrapCellValue(value);
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return raw.getFullYear();
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1900 && raw <= 2200) return raw;
  const match = displayValue(raw).trim().match(/^(?:FY\s*)?'?((?:19|20)\d{2})\s*[AE]?$/i);
  return match ? Number(match[1]) : undefined;
}

function contiguousAddressBands(addresses: string[]): string[][] {
  const remaining = [...new Set(addresses.map(normalizeAddress).filter((address) => !!parseAddress(address)))]
    .sort(compareAddresses);
  const bands: string[][] = [];
  while (remaining.length > 0) {
    const first = remaining.shift()!;
    const firstPosition = parseAddress(first)!;
    const horizontal = [first];
    while (remaining.length > 0) {
      const next = parseAddress(remaining[0])!;
      const previous = parseAddress(horizontal.at(-1)!)!;
      if (next.row !== firstPosition.row || next.col !== previous.col + 1) break;
      horizontal.push(remaining.shift()!);
    }
    bands.push(horizontal);
  }
  return bands;
}

function repeatedFormulaFillSuggestion(
  band: WorkbookTargetBand,
  cellsByKey: Map<string, WorkbookObservedCell>,
): WorkbookTaskInspection["formulaFillSuggestions"][number] | undefined {
  const positions = band.addresses.map(parseAddress);
  if (positions.some((position) => !position)) return undefined;
  const horizontal = positions.every((position) => position!.row === positions[0]!.row);
  const vertical = positions.every((position) => position!.col === positions[0]!.col);
  if (!horizontal && !vertical) return undefined;
  const formulaCells = band.addresses
    .map((address) => cellsByKey.get(workbookCellKey(band.sheet, address)))
    .filter((cell): cell is WorkbookObservedCell => !!normalizeFormula(cell?.formula));
  if (formulaCells.length < 2) return undefined;
  const patterns = new Set(formulaCells.map((cell) => formulaPattern(cell.formula!, cell.address)));
  if (patterns.size !== 1) return undefined;
  const anchor = formulaCells[0];
  const sourceFormula = normalizeFormula(anchor.formula)!;
  const operations = band.addresses.map((address) => ({
    sheet: band.sheet,
    cell: address,
    formula: translateFormulaBetweenCells(sourceFormula, anchor.address, address),
  }));
  if (operations.some((operation) => FORMULA_ERROR_RE.test(operation.formula) || formulaReferencesCurrentCell(operation.formula, operation.sheet, operation.cell))) {
    return undefined;
  }
  if (formulaCells.some((cell) => {
    const expected = operations.find((operation) => operation.cell === normalizeAddress(cell.address));
    return !expected || normalizeFormula(expected.formula) !== normalizeFormula(cell.formula);
  })) {
    return undefined;
  }
  return {
    sheet: band.sheet,
    range: band.range,
    anchorAddress: normalizeAddress(anchor.address),
    sourceFormula,
    operations,
  };
}

function requestedWeekdayTextToken(instruction: string, band: WorkbookObservedCell[]): "DDD" | "DDDD" {
  if (/\b(?:full|long)\s+(?:weekday|day)\s+names?\b|\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(instruction)) {
    return "DDDD";
  }
  if (/\b(?:abbreviat(?:e|ed|ion)|short)\b|\b(?:mon|tue|wed|thu|fri|sat|sun)\b/i.test(instruction)) return "DDD";
  const visibleTokens = band.flatMap((cell) => normalizeFormula(cell.formula)?.match(/TEXT\([^,]+,"(D{3,4})"\)$/i)?.[1].toUpperCase() ?? []);
  return visibleTokens.includes("DDDD") ? "DDDD" : "DDD";
}

function weekdayTextFormula(formula: string, token: "DDD" | "DDDD"): string {
  const normalized = normalizeFormula(formula) ?? formula.trim().replace(/^=/, "");
  return normalized.replace(/(TEXT\([^,]+,")(D{1,4})("\))$/i, (match, prefix: string, currentToken: string, suffix: string) =>
    currentToken.length === token.length ? match : `${prefix}${token}${suffix}`);
}

function translateRelativeFormula(formula: string, rowDelta: number, colDelta: number): string {
  return formula.replace(/(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)/gi, (match, colLock: string, colName: string, rowLock: string, rowText: string, offset: number) => {
    if (insideFormulaString(formula, offset)) return match;
    const col = columnNameToNumber(colName);
    const row = Number(rowText);
    if (!col || !Number.isInteger(row)) return match;
    const nextCol = colLock ? col : col + colDelta;
    const nextRow = rowLock ? row : row + rowDelta;
    if (nextCol < 1 || nextRow < 1) return "#REF!";
    return `${colLock}${columnNumberToName(nextCol)}${rowLock}${nextRow}`;
  });
}

function insideFormulaString(formula: string, offset: number): boolean {
  let inString = false;
  for (let index = 0; index < offset; index += 1) {
    if (formula[index] !== '"') continue;
    if (inString && formula[index + 1] === '"') {
      index += 1;
      continue;
    }
    inString = !inString;
  }
  return inString;
}

export function selectWorkbookTaskCells(args: {
  inspection: WorkbookTaskInspection;
  cells: WorkbookObservedCell[];
  maxCells: number;
  maxCellsPerSheet?: number;
}): WorkbookObservedCell[] {
  const limit = Math.max(1, Math.trunc(args.maxCells));
  const perSheetLimit = args.maxCellsPerSheet === undefined
    ? limit
    : Math.max(1, Math.trunc(args.maxCellsPerSheet));
  const byKey = new Map(args.cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const selected: WorkbookObservedCell[] = [];
  const seen = new Set<string>();
  const selectedBySheet = new Map<string, number>();
  const add = (cell: WorkbookObservedCell | undefined) => {
    if (!cell || selected.length >= limit) return;
    const key = workbookCellKey(cell.sheet, cell.address);
    if (seen.has(key)) return;
    const sheetCount = selectedBySheet.get(cell.sheet) ?? 0;
    if (sheetCount >= perSheetLimit) return;
    selected.push(cell);
    seen.add(key);
    selectedBySheet.set(cell.sheet, sheetCount + 1);
  };

  for (const finding of args.inspection.findings) {
    const key = workbookCellKey(finding.sheet, finding.address);
    if (!byKey.has(key) && (finding.kind === "blank_in_formula_band" || finding.kind === "implicit_assignment_target")) {
      byKey.set(key, { sheet: finding.sheet, address: finding.address, value: "" });
    }
  }
  for (const target of args.inspection.targetCandidates) {
    const key = workbookCellKey(target.sheet, target.address);
    if (!byKey.has(key)) byKey.set(key, { sheet: target.sheet, address: target.address, value: "" });
  }

  for (const key of args.inspection.rankedCellKeys) add(byKey.get(key));
  if (selected.length < limit) {
    for (const cell of args.cells) add(cell);
  }
  return selected.sort((left, right) => left.sheet.localeCompare(right.sheet) || compareAddresses(left.address, right.address));
}

export function verifyWorkbookPlan(args: {
  instruction: string;
  inspection: WorkbookTaskInspection;
  cells: WorkbookObservedCell[];
  sheetNames: string[];
  operations: WorkbookPlanOperation[];
  afterWrite?: boolean;
}): WorkbookPlanVerification {
  const issues: WorkbookPlanIssue[] = [];
  const sheetByLower = new Map(args.sheetNames.map((sheet) => [sheet.toLowerCase(), sheet]));
  const cellsByKey = new Map(args.cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const coveredTargets = new Set<string>();
  const seenTargets = new Map<string, number>();
  const targetKeys = new Set(args.inspection.targetCandidates.map((target) => workbookCellKey(target.sheet, target.address)));
  const blockedTargetByKey = new Map((args.inspection.blockedTargets ?? [])
    .map((target) => [workbookCellKey(target.sheet, target.address), target] as const));
  const quotedFormulaTargets = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "formula_text_match")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  const targetBandTargets = new Set((args.inspection.targetBands ?? [])
    .flatMap((band) => band.addresses.map((address) => workbookCellKey(band.sheet, address))));
  const formulaBandTargets = new Set([
    ...args.inspection.formulaFillSuggestions
      .flatMap((suggestion) => suggestion.operations.map((operation) => workbookCellKey(operation.sheet, operation.cell))),
  ]);
  const neighborFormulaTargets = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "named_target_neighbor_formula")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  const formulaRangeTargets = new Set((args.inspection.auditFocus ? [] : args.inspection.findings)
    .filter((finding) => finding.kind === "formula_range_anomaly")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  const strongTargetKeys = new Set([
    ...targetBandTargets,
    ...formulaBandTargets,
    ...quotedFormulaTargets,
    ...neighborFormulaTargets,
    ...formulaRangeTargets,
  ]);
  const requiredTargetKeys = strongTargetKeys.size > 0
    ? strongTargetKeys
    : args.inspection.auditFocus ? new Set<string>() : targetKeys;
  const semanticRuleByTarget = new Map<string, WorkbookSemanticFormulaRule>();
  const semanticDependencyFormulaByTarget = new Map<string, { rule: WorkbookSemanticFormulaRule; formula: string }>();
  const formulaRangeRepairByTarget = new Map<string, string>();
  const formulaFillByTarget = new Map<string, string>();
  const conflictingFormulaFillTargets = new Set<string>();
  const valueSuggestionByTarget = new Map<string, WorkbookTaskInspection["valueSuggestions"][number]>();
  const styleSuggestionByTarget = new Map(args.inspection.styleSuggestions
    .map((suggestion) => [workbookCellKey(suggestion.sheet, suggestion.cell), suggestion] as const));
  const formulaRepairByTarget = new Map(args.inspection.formulaRepairSuggestions
    .map((suggestion) => [workbookCellKey(suggestion.sheet, suggestion.cell), suggestion.formula] as const));
  const auditSuggestedTargetKeys = new Set([
    ...formulaRepairByTarget.keys(),
    ...styleSuggestionByTarget.keys(),
    ...args.inspection.valueSuggestions.map((suggestion) => workbookCellKey(suggestion.sheet, suggestion.cell)),
    ...args.inspection.formulaFillSuggestions.flatMap((suggestion) =>
      suggestion.operations.map((operation) => workbookCellKey(operation.sheet, operation.cell))),
  ]);
  const formulaRangeTargetKeys = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "formula_range_anomaly")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  for (const suggestion of args.inspection.formulaRepairSuggestions) {
    const key = workbookCellKey(suggestion.sheet, suggestion.cell);
    if (formulaRangeTargetKeys.has(key)) formulaRangeRepairByTarget.set(key, suggestion.formula);
  }
  for (const suggestion of args.inspection.formulaFillSuggestions) {
    for (const operation of suggestion.operations) {
      const key = workbookCellKey(operation.sheet, operation.cell);
      const current = formulaFillByTarget.get(key);
      if (current !== undefined && normalizeFormula(current) !== normalizeFormula(operation.formula)) {
        formulaFillByTarget.delete(key);
        conflictingFormulaFillTargets.add(key);
      } else if (!conflictingFormulaFillTargets.has(key)) {
        formulaFillByTarget.set(key, operation.formula);
      }
    }
  }
  for (const suggestion of args.inspection.valueSuggestions) {
    valueSuggestionByTarget.set(workbookCellKey(suggestion.sheet, suggestion.cell), suggestion);
  }
  for (const rule of inferWorkbookSemanticFormulaRules(args.instruction, args.cells)) {
    for (const address of rule.targetAddresses) semanticRuleByTarget.set(workbookCellKey(rule.sheet, address), rule);
    for (const expectation of rule.dependencyFormulaExpectations ?? []) {
      semanticDependencyFormulaByTarget.set(workbookCellKey(rule.sheet, expectation.address), {
        rule,
        formula: expectation.formula,
      });
    }
  }

  if (args.operations.length === 0 && args.inspection.mutatingTask && !args.inspection.allowEmptyPlan) {
    issues.push({
      kind: "empty_mutating_plan",
      severity: "error",
      detail: "The task requests a workbook change but the plan contains no operations.",
      repair: "Use the ranked target cells and findings to produce the smallest justified edit plan.",
    });
  }
  const hasExplicitAuditTargets = (args.inspection.targetBands ?? []).some((band) => band.source === "explicit_reference");
  if (args.inspection.auditFocus && !hasExplicitAuditTargets && args.operations.length > 8) {
    issues.push({
      kind: "overbroad_audit_plan",
      severity: "error",
      detail: `The filename identifies a ${args.inspection.auditFocus.kind.replace(/_/g, " ")} audit, but the plan proposes ${args.operations.length} writes without explicit target cells.`,
      repair: "Reduce the plan to at most eight locally verified outliers. Inspect and repair another bounded region only after post-write verification.",
    });
  }

  for (const [operationIndex, operation] of args.operations.entries()) {
    if (operation.op && operation.op !== "set_cell") continue;
    const rawSheet = typeof operation.sheet === "string" ? operation.sheet.trim().replace(/^'|'$/g, "") : "";
    const sheet = sheetByLower.get(rawSheet.toLowerCase());
    const address = typeof operation.cell === "string" ? normalizeAddress(operation.cell) : "";
    if (!sheet) {
      issues.push({
        kind: "missing_sheet",
        severity: "error",
        operationIndex,
        sheet: rawSheet,
        address,
        detail: `Operation ${operationIndex + 1} references missing sheet "${rawSheet}".`,
        repair: `Use one of the visible sheet names: ${args.sheetNames.join(", ")}.`,
      });
      continue;
    }
    if (!A1_RE.test(address) && !/^[a-z][a-z0-9_]*__[a-z][a-z0-9_]*$/i.test(address)) {
      issues.push({
        kind: "invalid_cell",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `Operation ${operationIndex + 1} has invalid cell address "${operation.cell ?? ""}".`,
        repair: "Use an A1 address or a visible structured element id.",
      });
      continue;
    }
    const key = workbookCellKey(sheet, address);
    if (requiredTargetKeys.has(key)) coveredTargets.add(key);
    if (args.afterWrite !== true && args.inspection.auditFocus && !hasExplicitAuditTargets && !auditSuggestedTargetKeys.has(key)) {
      issues.push({
        kind: "unsubstantiated_audit_target",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `${sheet}!${address} is not a locally confirmed ${args.inspection.auditFocus.kind.replace(/_/g, " ")} anomaly.`,
        repair: "Use only a high-confidence formula, value, or style suggestion returned by inspect_workbook. If none exists, report the audit as unresolved without writing a placeholder.",
      });
    }
    const blockedTarget = blockedTargetByKey.get(key);
    if (blockedTarget) {
      issues.push({
        kind: "unsafe_lookup_bounds",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: blockedTarget.reason,
        repair: `Populate and verify the visible bound dependencies first: ${blockedTarget.missingDependencies.join(", ")}.`,
      });
    }
    const priorIndex = seenTargets.get(key);
    if (priorIndex !== undefined) {
      issues.push({
        kind: "duplicate_target",
        severity: "warning",
        operationIndex,
        sheet,
        address,
        detail: `Operations ${priorIndex + 1} and ${operationIndex + 1} both write ${sheet}!${address}.`,
        repair: "Emit one final operation per target cell.",
      });
    } else {
      seenTargets.set(key, operationIndex);
    }

    const existing = cellsByKey.get(key);
    const proposedFormula = normalizeFormula(operation.formula ?? (typeof operation.value === "string" && operation.value.trim().startsWith("=") ? operation.value : undefined));
    const formulaRepairExpectation = formulaRepairByTarget.get(key);
    if (args.afterWrite !== true && args.inspection.auditFocus && formulaRepairExpectation
      && normalizeFormula(proposedFormula) !== normalizeFormula(formulaRepairExpectation)) {
      issues.push({
        kind: "formula_semantic_mismatch",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `${sheet}!${address} does not match the locally confirmed formula repair for this audit class.`,
        repair: `Use =${formulaRepairExpectation} in ${address}.`,
      });
    }
    if (existing?.formula && !proposedFormula && "value" in operation && !formulaScalarOverwriteAllowed(args.instruction)) {
      issues.push({
        kind: "formula_to_scalar_overwrite",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `${sheet}!${address} already contains a formula; the plan would replace it with a scalar.`,
        repair: "Preserve or repair the formula unless the user explicitly requests a hardcoded value.",
      });
    }
    if (proposedFormula) {
      if (FORMULA_ERROR_RE.test(proposedFormula)) {
        issues.push({
          kind: "formula_ref_error",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: `Proposed formula for ${sheet}!${address} contains an Excel error token.`,
          repair: "Replace the broken reference with a visible dependency or range.",
        });
      }
      if (formulaReferencesCurrentCell(proposedFormula, sheet, address)) {
        issues.push({
          kind: "formula_self_reference",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: `Proposed formula for ${sheet}!${address} appears self-referential.`,
          repair: "Use the intended source cell or range rather than the target itself.",
        });
      }
      if (!formulaLooksBalanced(proposedFormula)) {
        issues.push({
          kind: "malformed_formula",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: `Proposed formula for ${sheet}!${address} has unbalanced parentheses or quotes.`,
          repair: "Return a syntactically balanced Excel formula.",
        });
      }
    }
    const semanticRule = semanticRuleByTarget.get(key);
    if (semanticRule) {
      const semanticMismatch = semanticFormulaMismatch(semanticRule, address, proposedFormula);
      if (semanticMismatch) {
        issues.push({
          kind: "formula_semantic_mismatch",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: semanticMismatch,
          repair: semanticRuleRepair(semanticRule, address),
        });
      }
    }
    const dependencyExpectation = semanticDependencyFormulaByTarget.get(key);
    if (dependencyExpectation && normalizeFormula(proposedFormula) !== normalizeFormula(dependencyExpectation.formula)) {
      issues.push({
        kind: "formula_semantic_mismatch",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `${sheet}!${address} must extend the visible ${displayValue(dependencyExpectation.rule.dependencyLabels[0]?.value)} formula pattern rather than hardcode a result.`,
        repair: `Use the translated visible formula =${dependencyExpectation.formula} in ${address}.`,
      });
    }
    const formulaFillExpectation = formulaFillByTarget.get(key);
    if (formulaFillExpectation && normalizeFormula(proposedFormula) !== normalizeFormula(formulaFillExpectation)) {
      issues.push({
        kind: "formula_semantic_mismatch",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `${sheet}!${address} does not match the formula established by the visible row, header, and neighboring dependency contract.`,
        repair: `Use =${formulaFillExpectation} in ${address}.`,
      });
    }
    const valueSuggestion = valueSuggestionByTarget.get(key);
    if (valueSuggestion) {
      const proposedValue = Object.prototype.hasOwnProperty.call(operation, "value") ? operation.value : operation.result;
      if (proposedFormula || !valuesEquivalent(proposedValue, valueSuggestion.value)) {
        issues.push({
          kind: "value_semantic_mismatch",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: `${sheet}!${address} does not match the explicit value implied by visible workbook evidence.`,
          repair: `Set ${address} to ${JSON.stringify(valueSuggestion.value)} and preserve its existing number format.`,
        });
      }
    }
    const styleSuggestion = styleSuggestionByTarget.get(key);
    if (styleSuggestion) {
      const proposedFontColor = normalizeSpreadsheetFontColor(operation.fontColor);
      if (proposedFontColor !== styleSuggestion.fontColor) {
        issues.push({
          kind: "font_color_semantic_mismatch",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: `${sheet}!${address} does not match the locally supported font color for this audit class.`,
          repair: `Set only fontColor to ${styleSuggestion.fontColor} and preserve the cell's content and remaining style.`,
        });
      }
      if (args.inspection.auditFocus?.kind === "color_coding"
        && (Object.prototype.hasOwnProperty.call(operation, "value") || proposedFormula !== undefined)) {
        issues.push({
          kind: "audit_style_content_overwrite",
          severity: "error",
          operationIndex,
          sheet,
          address,
          detail: `${sheet}!${address} is a style-only color repair; the plan also proposes a content change.`,
          repair: `Set only fontColor to ${styleSuggestion.fontColor}; omit value and formula.`,
        });
      }
    }
    const rangeRepair = formulaRangeRepairByTarget.get(key);
    if (rangeRepair && normalizeFormula(proposedFormula) !== normalizeFormula(rangeRepair)) {
      issues.push({
        kind: "formula_semantic_mismatch",
        severity: "error",
        operationIndex,
        sheet,
        address,
        detail: `${sheet}!${address} still uses an average range that crosses visible non-data cells or includes the subject company in a Comparables calculation.`,
        repair: `Preserve the formula and use the visible contiguous range: =${rangeRepair}.`,
      });
    }
  }

  const missingTargets = [...requiredTargetKeys].filter((key) => !coveredTargets.has(key));
  if (missingTargets.length > 0) {
    const missingTargetRanges = formatWorkbookTargetRanges(missingTargets, args.sheetNames);
    issues.push({
      kind: "missing_target_coverage",
      severity: "error",
      detail: `The plan covers ${coveredTargets.size}/${requiredTargetKeys.size} required task targets and omits ${missingTargets.length}.`,
      repair: `Return one set_cell operation for every omitted required target: ${missingTargetRanges}.`,
    });
  }

  return {
    schema: 1,
    status: issues.some((issue) => issue.severity === "error") ? "needs_repair" : "passed",
    issueCount: issues.length,
    issues,
    checks: {
      operationCount: args.operations.length,
      targetCandidateCount: requiredTargetKeys.size,
      coveredTargetCount: coveredTargets.size,
      formulaProtectionChecked: true,
    },
  };
}

function weekdayFormulaFillBand(
  anchor: WorkbookObservedCell,
  cellsByKey: Map<string, WorkbookObservedCell>,
): WorkbookObservedCell[] {
  const position = parseAddress(anchor.address);
  const formula = normalizeFormula(anchor.formula);
  if (!position || !formula) return [];
  const match = formula.match(/^TEXT\(\$?([A-Z]{1,3})\$?([1-9][0-9]*),"D{2,4}"\)$/i);
  if (!match) return [];
  const dependency = parseAddress(`${match[1]}${match[2]}`);
  if (!dependency || dependency.col !== position.col || dependency.row !== position.row + 1) return [];
  const qualifies = (col: number) => {
    const target = cellsByKey.get(workbookCellKey(anchor.sheet, addressFromPosition(position.row, col)));
    const source = cellsByKey.get(workbookCellKey(anchor.sheet, addressFromPosition(dependency.row, col)));
    if (!target || !source || !dateLikeWorkbookValue(source.value)) return undefined;
    const label = displayValue(target.value).trim();
    if (!target.formula && label && !/^(?:M|MO|MON|MONDAY|TU|TUE|TUESDAY|W|WED|WEDNESDAY|TH|THU|THURSDAY|F|FRI|FRIDAY|S|SA|SAT|SATURDAY|SU|SUN|SUNDAY)$/i.test(label)) return undefined;
    return target;
  };
  let start = position.col;
  let end = position.col;
  while (start > 1 && qualifies(start - 1)) start -= 1;
  while (qualifies(end + 1)) end += 1;
  const band: WorkbookObservedCell[] = [];
  for (let col = start; col <= end; col += 1) {
    const cell = qualifies(col);
    if (cell) band.push(cell);
  }
  if (band.length < 3) return [];
  return band;
}

function weekdayFormulasEquivalent(left: string, right: string): boolean {
  return normalizeFormula(left)?.toUpperCase() === normalizeFormula(right)?.toUpperCase();
}

function dateLikeWorkbookValue(value: unknown): boolean {
  const raw = unwrapCellValue(value);
  if (raw instanceof Date && Number.isFinite(raw.getTime())) return true;
  if (typeof raw === "number") return raw >= 1_000 && raw <= 100_000;
  if (typeof raw !== "string" || !raw.trim()) return false;
  return /^\d{4}-\d{1,2}-\d{1,2}(?:T.*)?$/.test(raw.trim()) || /^\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}$/.test(raw.trim());
}

export function verifyWorkbookValues(args: {
  cells: WorkbookObservedCell[];
  checks: WorkbookValueCheck[];
}): WorkbookWriteVerification {
  const byKey = new Map<string, WorkbookObservedCell>();
  for (const cell of args.cells) {
    byKey.set(workbookCellKey(cell.sheet, cell.address), cell);
    byKey.set(normalizeAddress(cell.address), cell);
  }
  const checks = args.checks.map((check): WorkbookValueCheckResult => {
    const key = check.sheet ? workbookCellKey(check.sheet, check.elementId) : normalizeAddress(check.elementId);
    const cell = byKey.get(key);
    const actualValue = unwrapCellValue(cell?.value);
    const actualFormula = normalizeFormula(cell?.formula ?? formulaFromValue(cell?.value));
    const issues: string[] = [];
    if (!cell) issues.push("target_not_found");
    if (!check.allowBlank && check.expectedValue === undefined && check.expectedFormula === undefined && isBlank(actualValue)) issues.push("unexpected_blank");
    if (check.expectedValue !== undefined && !valuesEquivalent(actualValue, check.expectedValue)) issues.push("value_mismatch");
    if (check.expectedFormula !== undefined && actualFormula !== normalizeFormula(check.expectedFormula)) issues.push("formula_mismatch");
    if (check.expectedNumFmt !== undefined && cell?.numFmt !== check.expectedNumFmt) issues.push("number_format_mismatch");
    if (check.expectedFontColor !== undefined
      && normalizeSpreadsheetFontColor(cell?.fontColor) !== normalizeSpreadsheetFontColor(check.expectedFontColor)) issues.push("font_color_mismatch");
    if (actualFormula && FORMULA_ERROR_RE.test(actualFormula)) issues.push("formula_ref_error");
    return {
      ...check,
      ok: issues.length === 0,
      actualValue,
      ...(actualFormula ? { actualFormula } : {}),
      ...(cell?.numFmt ? { actualNumFmt: cell.numFmt } : {}),
      ...(cell?.fontColor ? { actualFontColor: normalizeSpreadsheetFontColor(cell.fontColor) } : {}),
      ...(cell?.version === undefined ? {} : { version: cell.version }),
      issues,
    };
  });
  const issueCount = checks.reduce((sum, check) => sum + check.issues.length, 0);
  return {
    schema: 1,
    status: issueCount === 0 ? "passed" : "needs_repair",
    checkedCount: checks.length,
    passedCount: checks.filter((check) => check.ok).length,
    issueCount,
    checks,
    ...(issueCount > 0
      ? { repairPrompt: checks.filter((check) => !check.ok).map((check) => `${check.sheet ? `${check.sheet}!` : ""}${check.elementId}: ${check.issues.join(", ")}`).join("; ") }
      : {}),
  };
}

export function checksForWorkbookOperations(operations: WorkbookPlanOperation[]): WorkbookValueCheck[] {
  return operations.flatMap((operation): WorkbookValueCheck[] => {
    if (operation.op && operation.op !== "set_cell") return [];
    if (typeof operation.sheet !== "string" || typeof operation.cell !== "string") return [];
    const formula = operation.formula ?? (typeof operation.value === "string" && operation.value.trim().startsWith("=") ? operation.value : undefined);
    return [{
      sheet: operation.sheet,
      elementId: normalizeAddress(operation.cell),
      ...(formula ? { expectedFormula: formula } : "value" in operation ? { expectedValue: operation.value } : {}),
      ...(operation.numFmt ? { expectedNumFmt: operation.numFmt } : {}),
      ...(operation.fontColor ? { expectedFontColor: normalizeSpreadsheetFontColor(operation.fontColor) } : {}),
      allowBlank: operation.value === null,
    }];
  });
}

function referenceRole(instruction: string, index: number, length: number): WorkbookReferenceRole {
  const before = instruction.slice(Math.max(0, index - 180), index);
  const after = instruction.slice(index + length, Math.min(instruction.length, index + length + 180));
  const clauseBefore = before.slice(Math.max(before.lastIndexOf("."), before.lastIndexOf(";"), before.lastIndexOf("\n")) + 1);
  const clauseAfter = after.split(/[.;\n]/, 1)[0] ?? after;
  if (/=[A-Z][A-Z0-9_.]*\([^;!?\n]{0,180}$/i.test(before)) return "dependency";
  if (/\b[A-Z][A-Z0-9_.]*\([^()]{0,180}$/i.test(before)) return "dependency";
  if (/=[^=.!?;\n]{0,180}$/i.test(clauseBefore)) return "dependency";
  if (/\b(?:users?|they)\s+(?:input|enter|select|provide)\b[^.!?;\n]{0,120}\b(?:in|into)\s+(?:cells?|range|columns?)\s*['"]?$/i.test(clauseBefore)) return "dependency";
  if (/\b(?:range|limits?|bounds?)\s+(?:is|are\s+)?defined\s+in\s+(?:cells?|range|columns?)\b[^.!?;\n]{0,60}$/i.test(clauseBefore)) return "dependency";
  if (/\b(?:dropdown|selector)\b[^.!?;\n]{0,80}\b(?:populates?|fills?)\s*$/i.test(clauseBefore)) return "dependency";
  if (/\bcorresponding\s+(?:cell|value)\b[^.!?;\n]{0,80}$/i.test(clauseBefore)) return "dependency";
  if (/^\s*[,)]?\s*(?:i|we|it|which)\s+(?:have|has|uses?|contains?)\b/i.test(clauseAfter)) return "dependency";
  if (/\bi\s+(?:need|want)\b[^.!?;\n]{0,100}\b(?:cells?|range|column)\b[^.!?;\n]{0,30}$/i.test(clauseBefore)
    && /^\s*\)?\s*to\s+(?:check|show|display|return|calculate|verify|populate|contain)/i.test(clauseAfter)) return "target";
  if (/\b(?:set|write|fill|populate|place|put|output|configure|correct|fix|repair|change|replace|calculate)(?:\s+(?:cells?|range|column))?\s*$/i.test(before)) return "target";
  if (/\b(?:from|using|based\s+on|criteria\s+in|source|input)(?:\s+(?:cells?|range|column))?\s*$/i.test(before)) return "dependency";
  const immediate = `${before.slice(-55)} ${after.slice(0, 55)}`;
  const target = TARGET_CONTEXT_RE.test(immediate);
  const dependency = DEPENDENCY_CONTEXT_RE.test(immediate);
  if (target && !dependency) return "target";
  if (dependency && !target) return "dependency";
  if (/\b(?:in|into|at)\s+(?:cells?|range|column)?\s*$/i.test(before) || /^\s*(?:should|must|to)\s+(?:show|display|contain|return)/i.test(after)) return "target";
  if (/\b(?:from|using|based\s+on|criteria\s+in)\s*$/i.test(before)) return "dependency";
  return "ambiguous";
}

function rolePriority(role: WorkbookReferenceRole): number {
  return role === "target" ? 3 : role === "dependency" ? 2 : 1;
}

function expandReference(reference: WorkbookTaskReference, limit: number, preserveLinearBand = false): string[] {
  const start = parseAddress(reference.start);
  const end = parseAddress(reference.end);
  if (!start || !end) return [reference.start];
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const count = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  if (count > limit && !(preserveLinearBand && (minRow === maxRow || minCol === maxCol))) {
    return [...new Set([
      addressFromPosition(minRow, minCol),
      addressFromPosition(minRow, maxCol),
      addressFromPosition(maxRow, minCol),
      addressFromPosition(maxRow, maxCol),
    ])];
  }
  const addresses: string[] = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let col = minCol; col <= maxCol; col += 1) addresses.push(addressFromPosition(row, col));
  }
  return addresses;
}

function analyzeFormulaBands(
  cells: WorkbookObservedCell[],
  addRank: (cell: WorkbookObservedCell | undefined, score: number, reason: string) => void,
): {
  findings: WorkbookInspectionFinding[];
  suggestions: WorkbookTaskInspection["formulaRepairSuggestions"];
} {
  const findings: WorkbookInspectionFinding[] = [];
  const suggestions: WorkbookTaskInspection["formulaRepairSuggestions"] = [];
  const bySheet = groupByMap(cells, (cell) => cell.sheet);
  for (const [sheet, sheetCells] of bySheet) {
    const positions = new Map<WorkbookObservedCell, CellPosition>();
    for (const cell of sheetCells) {
      const position = parseAddress(cell.address);
      if (position) positions.set(cell, position);
    }
    const byAddress = new Map(sheetCells.map((cell) => [normalizeAddress(cell.address), cell]));
    const presentRows = new Set([...positions.values()].map((position) => position.row));
    const periodHeaders = indexPeriodHeaderKinds(sheetCells);
    const formulas = sheetCells.filter((cell) => !!normalizeFormula(cell.formula) && positions.has(cell));
    const rowGroups = groupByMap(formulas, (cell) => positions.get(cell)!.row);
    const colGroups = groupByMap(formulas, (cell) => positions.get(cell)!.col);
    for (const group of [...rowGroups.values(), ...colGroups.values()]) {
      const horizontal = group.length > 1 && positions.get(group[0])!.row === positions.get(group[1])!.row;
      const sorted = [...group].sort((left, right) => {
        const a = positions.get(left)!;
        const b = positions.get(right)!;
        return horizontal ? a.col - b.col : a.row - b.row;
      });
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const left = positions.get(sorted[index])!;
        const right = positions.get(sorted[index + 1])!;
        const gap = horizontal ? right.col - left.col : right.row - left.row;
        if (gap !== 2) continue;
        const middleAddress = horizontal
          ? addressFromPosition(left.row, left.col + 1)
          : addressFromPosition(left.row + 1, left.col);
        const middle = byAddress.get(middleAddress);
        if (middle?.formula) continue;
        if (!middle && !horizontal) {
          const middleRow = left.row + 1;
          if (!presentRows.has(middleRow)) continue;
        }
        const consensus = formulaConsensusAtTarget(byAddress, middleAddress, horizontal ? "horizontal" : "vertical");
        const agreedFormula = consensus?.formula;
        if (middle && !isBlank(unwrapCellValue(middle.value))) {
          addRank(middle, 215, "hardcoded_in_formula_band");
          findings.push({
            kind: "hardcoded_in_formula_band",
            severity: "warning",
            sheet,
            address: middleAddress,
            relatedAddresses: [sorted[index].address, sorted[index + 1].address],
            detail: `${middleAddress} is a scalar between neighboring formula cells.`,
            recommendedAction: "Check whether the scalar should be a translated formula before preserving or replacing it.",
          });
        } else {
          const blankCell = middle ?? { sheet, address: middleAddress, value: "" };
          addRank(blankCell, 210, "blank_in_formula_band");
          findings.push({
            kind: "blank_in_formula_band",
            severity: "warning",
            sheet,
            address: middleAddress,
            relatedAddresses: [sorted[index].address, sorted[index + 1].address],
            detail: `${middleAddress} is blank between neighboring formula cells.`,
            recommendedAction: "Inspect the neighboring formula pattern and fill the gap only when the row or column logic is consistent.",
          });
        }
        if (agreedFormula && !FORMULA_ERROR_RE.test(agreedFormula) && !formulaReferencesCurrentCell(agreedFormula, sheet, middleAddress)) {
          suggestions.push({
            kind: "fill_gap",
            confidence: "high",
            sheet,
            cell: middleAddress,
            formula: agreedFormula,
            evidence: consensus!.evidence,
          });
        }
      }
    }

    for (const cell of formulas) {
      const pos = positions.get(cell)!;
      const horizontalNeighbors = [byAddress.get(addressFromPosition(pos.row, pos.col - 1)), byAddress.get(addressFromPosition(pos.row, pos.col + 1))];
      if (!horizontalNeighbors[0]?.formula || !horizontalNeighbors[1]?.formula) continue;
      if (horizontalFormulaSemanticBoundary(periodHeaders, cell, horizontalNeighbors[0], horizontalNeighbors[1])) continue;
      const expected = formulaPattern(horizontalNeighbors[0].formula, horizontalNeighbors[0].address);
      const peer = formulaPattern(horizontalNeighbors[1].formula, horizontalNeighbors[1].address);
      const actual = formulaPattern(cell.formula!, cell.address);
      if (expected !== peer || actual === expected) continue;
      addRank(cell, 218, "formula_pattern_outlier");
      findings.push({
        kind: "formula_pattern_outlier",
        severity: "warning",
        sheet,
        address: cell.address,
        relatedAddresses: horizontalNeighbors.map((neighbor) => neighbor!.address),
        detail: `${cell.address} breaks the horizontal relative formula pattern shared by its two neighbors.`,
        recommendedAction: "Translate both neighboring formulas into this cell and repair only when they agree exactly.",
      });
      const consensus = formulaConsensusAtTarget(byAddress, cell.address, "horizontal");
      if (
        consensus
        && normalizeFormula(consensus.formula) !== normalizeFormula(cell.formula)
        && !FORMULA_ERROR_RE.test(consensus.formula)
        && !formulaReferencesCurrentCell(consensus.formula, sheet, cell.address)
      ) {
        suggestions.push({
          kind: "replace_outlier",
          confidence: "high",
          sheet,
          cell: cell.address,
          formula: consensus.formula,
          evidence: consensus.evidence,
        });
      }
    }
  }
  return { findings, suggestions };
}

function horizontalFormulaSemanticBoundary(
  periodHeaders: Map<number, PeriodHeader[]>,
  target: WorkbookObservedCell,
  left: WorkbookObservedCell,
  right: WorkbookObservedCell,
): boolean {
  const targetFormat = formulaBandFormatKind(target.numFmt);
  const leftFormat = formulaBandFormatKind(left.numFmt);
  const rightFormat = formulaBandFormatKind(right.numFmt);
  if (targetFormat && leftFormat && rightFormat
    && (targetFormat !== leftFormat || targetFormat !== rightFormat)) return true;

  const position = parseAddress(target.address);
  if (!position) return false;
  const roles = [-1, 0, 1].map((offset) => nearestPeriodHeaderKind(
    periodHeaders,
    position.row,
    position.col + offset,
  ));
  const targetRole = roles[1];
  return !!targetRole && roles.some((role, index) => index !== 1 && !!role && role !== targetRole);
}

function formulaBandFormatKind(numFmt: string | undefined): "percent" | "multiple" | "date" | "number" | undefined {
  if (!numFmt?.trim()) return undefined;
  if (/%/.test(numFmt)) return "percent";
  if (/(?:^|[^a-z])x(?:[^a-z]|$)/i.test(numFmt.replace(/\\/g, ""))) return "multiple";
  if (/[dmy]{2,}|(?:yyyy|mmm)/i.test(numFmt)) return "date";
  return "number";
}

type PeriodHeaderKind = "quarter" | "half" | "annual" | "ytd" | "trailing";
type PeriodHeader = { row: number; kind: PeriodHeaderKind };

function indexPeriodHeaderKinds(cells: WorkbookObservedCell[]): Map<number, PeriodHeader[]> {
  const byColumn = new Map<number, PeriodHeader[]>();
  for (const cell of cells) {
    const position = parseAddress(cell.address);
    const kind = position ? periodHeaderKind(cell) : undefined;
    if (!position || !kind) continue;
    const headers = byColumn.get(position.col) ?? [];
    headers.push({ row: position.row, kind });
    byColumn.set(position.col, headers);
  }
  for (const headers of byColumn.values()) headers.sort((left, right) => left.row - right.row);
  return byColumn;
}

function periodHeaderKind(cell: WorkbookObservedCell): PeriodHeaderKind | undefined {
  const text = `${displayValue(cell.value)} ${cell.numFmt ?? ""}`.toLowerCase();
  if (/\b(?:q[1-4]|[1-4]q|quarter)\b|-[ ]*q[1-4]/i.test(text)) return "quarter";
  if (/\b(?:[12]h|h[12])(?:\s*fy)?\s*\d{2,4}[a-z]?\b|\bhalf[- ]?year\b/i.test(text)) return "half";
  if (/\bytd\b|year[- ]to[- ]date/i.test(text)) return "ytd";
  if (/\b(?:ltm|ttm|ntm|trailing)\b/i.test(text)) return "trailing";
  if (/\bfy\s*\d{2,4}[a-z]?\b|\b(?:jun|dec)[ ]*-[ ]*\d{4}\b/i.test(text)) return "annual";
  const scalar = unwrapCellValue(cell.value);
  if (typeof scalar === "number" && scalar >= 1900 && scalar <= 2200
    && !/q[1-4]|[12]h/i.test(cell.numFmt ?? "")) return "annual";
  return undefined;
}

function nearestPeriodHeaderKind(
  periodHeaders: Map<number, PeriodHeader[]>,
  targetRow: number,
  column: number,
): PeriodHeaderKind | undefined {
  if (column < 1) return undefined;
  const headers = periodHeaders.get(column);
  if (!headers?.length) return undefined;
  let low = 0;
  let high = headers.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (headers[middle].row < targetRow) low = middle + 1;
    else high = middle;
  }
  const nearest = headers[low - 1];
  return nearest && targetRow - nearest.row <= 256 ? nearest.kind : undefined;
}

type ParsedAverageRange = {
  match: string;
  sourceSheet: string;
  sheetToken: string;
  startToken: string;
  endToken: string;
  rangeSuffix: string;
  start: string;
  end: string;
};

function analyzeAverageFormulaRanges(
  instruction: string,
  cells: WorkbookObservedCell[],
  addRank: (cell: WorkbookObservedCell | undefined, score: number, reason: string) => void,
): {
  findings: WorkbookInspectionFinding[];
  suggestions: WorkbookTaskInspection["formulaRepairSuggestions"];
} {
  if (!genericFormulaAuditTask(instruction) || !/\baverage(?:[^a-z0-9]|$)/i.test(instruction)) {
    return { findings: [], suggestions: [] };
  }

  const findings: WorkbookInspectionFinding[] = [];
  const suggestions: WorkbookTaskInspection["formulaRepairSuggestions"] = [];
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  for (const target of cells.filter((cell) => !!cell.formula && /\bAVERAGE\s*\(/i.test(cell.formula!))) {
    const parsed = parseAverageRange(target.formula!, target.sheet);
    if (!parsed) continue;
    const sourceAddresses = expandReference({
      sheet: parsed.sourceSheet,
      start: parsed.start,
      end: parsed.end,
      sourceText: parsed.match,
      role: "dependency",
    }, 512, true);
    if (sourceAddresses.length > 512) continue;

    const evidence: string[] = [];
    let selectedAddresses = sourceAddresses.length === 1
      ? adjacentSingleCellAverageRun(target, parsed, cellsByKey)
      : longestAggregateRun(sourceAddresses, parsed.sourceSheet, cellsByKey);
    if (sourceAddresses.length === 1 && selectedAddresses.length >= 2) {
      evidence.push(
        `locally confirmed contiguous expansion: ${target.sheet}!${target.address} averages one adjacent cell, while the visible numeric/formula block continues through ${selectedAddresses.at(-1)!}`,
      );
    }
    if (selectedAddresses.length < 2) continue;
    if (sourceAddresses.length > 1) {
      if (selectedAddresses.length >= 2 && selectedAddresses.length < sourceAddresses.length) {
        const excluded = sourceAddresses.filter((address) => !selectedAddresses.includes(address));
        evidence.push(
          `${parsed.sourceSheet}!${parsed.start}:${parsed.end} crosses blank or nonnumeric cells; the longest contiguous visible aggregate block is ${selectedAddresses[0]}:${selectedAddresses.at(-1)!}`,
          `excluded cells: ${excluded.join(", ")}`,
        );
      } else {
        selectedAddresses = sourceAddresses;
      }
    }

    const comparableStart = comparableAverageStart({ target, parsed, cells, cellsByKey });
    if (comparableStart && selectedAddresses[0] === parsed.start) {
      selectedAddresses = selectedAddresses.slice(1);
      evidence.push(
        `${target.sheet}!${target.address} is labeled Comparables and ${parsed.sourceSheet}!${parsed.start} visibly names the subject company; the peer average starts at ${comparableStart}`,
      );
    }
    if (selectedAddresses.length < 2) continue;

    const repairedStart = selectedAddresses[0];
    const repairedEnd = selectedAddresses.at(-1)!;
    if (repairedStart === parsed.start && repairedEnd === parsed.end) continue;
    const repairedFormula = target.formula!.replace(
      parsed.match,
      `AVERAGE(${parsed.sheetToken}${anchoredAddress(parsed.startToken, repairedStart)}:${anchoredAddress(parsed.endToken, repairedEnd)}${parsed.rangeSuffix})`,
    );
    addRank(target, 242, "formula_range_anomaly");
    for (const address of selectedAddresses) {
      addRank(cellsByKey.get(workbookCellKey(parsed.sourceSheet, address)), 222, "formula_range_dependency");
    }
    findings.push({
      kind: "formula_range_anomaly",
      severity: "error",
      sheet: target.sheet,
      address: target.address,
      relatedAddresses: selectedAddresses,
      detail: `${target.address} averages ${parsed.sourceSheet}!${parsed.start}:${parsed.end}, but visible workbook structure supports ${repairedStart}:${repairedEnd}.`,
      recommendedAction: `Replace only the range endpoints with ${repairedStart}:${repairedEnd} and preserve the rest of the formula.`,
    });
    suggestions.push({
      kind: "replace_outlier",
      confidence: "high",
      sheet: target.sheet,
      cell: target.address,
      formula: repairedFormula,
      evidence: [target.formula!, ...evidence],
    });
  }
  return { findings, suggestions };
}

function adjacentSingleCellAverageRun(
  target: WorkbookObservedCell,
  parsed: ParsedAverageRange,
  cellsByKey: Map<string, WorkbookObservedCell>,
): string[] {
  if (parsed.start !== parsed.end || parsed.sourceSheet.toLowerCase() !== target.sheet.toLowerCase()) return [];
  const targetPosition = parseAddress(target.address);
  const sourcePosition = parseAddress(parsed.start);
  if (!targetPosition || !sourcePosition) return [];

  let rowStep = 0;
  let colStep = 0;
  if (targetPosition.row === sourcePosition.row && targetPosition.col === sourcePosition.col - 1) colStep = 1;
  else if (targetPosition.row === sourcePosition.row && targetPosition.col === sourcePosition.col + 1) colStep = -1;
  else if (targetPosition.col === sourcePosition.col && targetPosition.row === sourcePosition.row - 1) rowStep = 1;
  else if (targetPosition.col === sourcePosition.col && targetPosition.row === sourcePosition.row + 1) rowStep = -1;
  else return [];

  const addresses: string[] = [];
  for (let offset = 0; offset < 12; offset += 1) {
    const row = sourcePosition.row + rowStep * offset;
    const col = sourcePosition.col + colStep * offset;
    if (row < 1 || col < 1) break;
    const address = addressFromPosition(row, col);
    const cell = cellsByKey.get(workbookCellKey(parsed.sourceSheet, address));
    const value = unwrapCellValue(cell?.value);
    const usable = !!cell && ((!!cell.formula && !FORMULA_ERROR_RE.test(cell.formula)) || typeof value === "number");
    if (!usable) break;
    addresses.push(address);
  }
  return rowStep < 0 || colStep < 0 ? addresses.reverse() : addresses;
}

function parseAverageRange(formula: string, fallbackSheet: string): ParsedAverageRange | undefined {
  const match = formula.match(
    /\bAVERAGE\s*\(\s*((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!\s*)?(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\s*:\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)(\s*(?:[/*+-]\s*\d+(?:\.\d+)?)*)\s*\)/i,
  );
  if (!match) return undefined;
  const sheetToken = match[1] ?? "";
  const rawSheet = sheetToken.trim().replace(/!$/, "");
  const sourceSheet = rawSheet
    ? rawSheet.replace(/^'|'$/g, "").replace(/''/g, "'")
    : fallbackSheet;
  return {
    match: match[0],
    sourceSheet,
    sheetToken,
    startToken: match[2],
    endToken: match[3],
    rangeSuffix: match[4] ?? "",
    start: normalizeAddress(match[2]),
    end: normalizeAddress(match[3]),
  };
}

function longestAggregateRun(
  addresses: string[],
  sheet: string,
  cellsByKey: Map<string, WorkbookObservedCell>,
): string[] {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const address of addresses) {
    const cell = cellsByKey.get(workbookCellKey(sheet, address));
    const value = unwrapCellValue(cell?.value);
    const usable = !!cell && (
      (!!cell.formula && !FORMULA_ERROR_RE.test(cell.formula))
      || typeof value === "number"
    );
    if (usable) current.push(address);
    else if (current.length > 0) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs.sort((left, right) => right.length - left.length)[0] ?? [];
}

function comparableAverageStart(args: {
  target: WorkbookObservedCell;
  parsed: ParsedAverageRange;
  cells: WorkbookObservedCell[];
  cellsByKey: Map<string, WorkbookObservedCell>;
}): string | undefined {
  const targetPosition = parseAddress(args.target.address);
  const sourceStart = parseAddress(args.parsed.start);
  const sourceEnd = parseAddress(args.parsed.end);
  if (!targetPosition || !sourceStart || !sourceEnd || sourceStart.row !== sourceEnd.row) return undefined;
  const targetHeader = [1, 2, 3, 4]
    .map((offset) => args.cellsByKey.get(workbookCellKey(args.target.sheet, addressFromPosition(targetPosition.row - offset, targetPosition.col))))
    .find((cell) => /\bcomparables?\b/i.test(displayValue(cell?.value)));
  if (!targetHeader) return undefined;
  const headerPosition = parseAddress(targetHeader.address)!;
  const subject = args.cellsByKey.get(workbookCellKey(
    args.target.sheet,
    addressFromPosition(headerPosition.row, headerPosition.col - 1),
  ));
  const subjectName = normalizeSemanticLabel(displayValue(subject?.value));
  if (!subjectName) return undefined;
  const sourceHeader = args.cells
    .filter((cell) => {
      if (cell.sheet.toLowerCase() !== args.parsed.sourceSheet.toLowerCase()) return false;
      const position = parseAddress(cell.address);
      return !!position
        && position.col === sourceStart.col
        && position.row < sourceStart.row
        && normalizeSemanticLabel(displayValue(cell.value)) === subjectName;
    })
    .sort((left, right) => parseAddress(right.address)!.row - parseAddress(left.address)!.row)[0];
  if (!sourceHeader || sourceStart.col >= sourceEnd.col) return undefined;
  return addressFromPosition(sourceStart.row, sourceStart.col + 1);
}

function anchoredAddress(template: string, address: string): string {
  const match = template.match(/^(\$?)[A-Z]{1,3}(\$?)[1-9][0-9]*$/i);
  const position = parseAddress(address);
  if (!match || !position) return address;
  return `${match[1]}${columnNumberToName(position.col)}${match[2]}${position.row}`;
}

function formulaConsensusAtTarget(
  cellsByAddress: Map<string, WorkbookObservedCell>,
  targetAddress: string,
  axis: "horizontal" | "vertical",
): { formula: string; evidence: string[] } | undefined {
  const target = parseAddress(targetAddress);
  if (!target) return undefined;
  const candidates = new Map<string, { formula: string; evidence: string[] }>();
  for (const delta of [-2, -1, 1, 2]) {
    const peerAddress = axis === "horizontal"
      ? addressFromPosition(target.row, target.col + delta)
      : addressFromPosition(target.row + delta, target.col);
    const peer = cellsByAddress.get(peerAddress);
    if (!peer?.formula) continue;
    const translated = translateFormulaBetweenCells(peer.formula, peer.address, targetAddress);
    const normalized = normalizeFormula(translated);
    if (!normalized) continue;
    const current = candidates.get(normalized) ?? { formula: translated, evidence: [] };
    current.evidence.push(peer.address);
    candidates.set(normalized, current);
  }
  const consensus = [...candidates.values()].sort((left, right) => right.evidence.length - left.evidence.length)[0];
  if (consensus && consensus.evidence.length >= 3) return consensus;
  if (axis !== "horizontal") return undefined;
  const immediateAddresses = axis === "horizontal"
    ? [addressFromPosition(target.row, target.col - 1), addressFromPosition(target.row, target.col + 1)]
    : [addressFromPosition(target.row - 1, target.col), addressFromPosition(target.row + 1, target.col)];
  const immediate = immediateAddresses.map((address) => cellsByAddress.get(address)).filter((cell): cell is WorkbookObservedCell => !!cell?.formula);
  if (immediate.length !== 2) return undefined;
  const translated = immediate.map((cell) => translateFormulaBetweenCells(cell.formula!, cell.address, targetAddress));
  return normalizeFormula(translated[0]) === normalizeFormula(translated[1])
    ? { formula: translated[0], evidence: immediate.map((cell) => cell.address) }
    : undefined;
}

function translateFormulaBetweenCells(formula: string, fromAddress: string, toAddress: string): string {
  const from = parseAddress(fromAddress);
  const to = parseAddress(toAddress);
  if (!from || !to) return formula;
  return translateRelativeFormula(formula, to.row - from.row, to.col - from.col);
}

function dedupeFormulaFillSuggestions(
  suggestions: WorkbookTaskInspection["formulaFillSuggestions"],
): WorkbookTaskInspection["formulaFillSuggestions"] {
  const unique = new Map<string, WorkbookTaskInspection["formulaFillSuggestions"][number]>();
  for (const suggestion of suggestions) {
    const key = `${suggestion.sheet.toLowerCase()}!${suggestion.range.toUpperCase()}`;
    if (!unique.has(key)) unique.set(key, suggestion);
  }
  return [...unique.values()].sort((left, right) =>
    left.sheet.localeCompare(right.sheet) || compareAddresses(left.anchorAddress, right.anchorAddress));
}

function dedupeFormulaRepairSuggestions(
  suggestions: WorkbookTaskInspection["formulaRepairSuggestions"],
): WorkbookTaskInspection["formulaRepairSuggestions"] {
  const unique = new Map<string, WorkbookTaskInspection["formulaRepairSuggestions"][number]>();
  for (const suggestion of suggestions) {
    const key = workbookCellKey(suggestion.sheet, suggestion.cell);
    const current = unique.get(key);
    if (!current || current.formula === suggestion.formula) unique.set(key, suggestion);
    else unique.delete(key);
  }
  return [...unique.values()].sort((left, right) => left.sheet.localeCompare(right.sheet) || compareAddresses(left.cell, right.cell));
}

function formulaPattern(formula: string, fromAddress: string): string {
  const from = parseAddress(fromAddress);
  if (!from) return normalizeFormula(formula) ?? "";
  return (normalizeFormula(formula) ?? "").replace(/(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)/gi, (_match, colAbs: string, colName: string, rowAbs: string, rowText: string) => {
    const col = columnNameToNumber(colName);
    const row = Number(rowText);
    const colToken = colAbs ? `C$${col}` : `C[${col - from.col}]`;
    const rowToken = rowAbs ? `R$${row}` : `R[${row - from.row}]`;
    return `${rowToken}${colToken}`;
  });
}

function cellNeighbors(
  sheet: string,
  address: string,
  cellsByKey: Map<string, WorkbookObservedCell>,
  radius: number,
): WorkbookObservedCell[] {
  const pos = parseAddress(address);
  if (!pos) return [];
  const cells: WorkbookObservedCell[] = [];
  for (let rowOffset = -radius; rowOffset <= radius; rowOffset += 1) {
    for (let colOffset = -radius; colOffset <= radius; colOffset += 1) {
      if (rowOffset === 0 && colOffset === 0) continue;
      if (Math.abs(rowOffset) + Math.abs(colOffset) > radius) continue;
      const row = pos.row + rowOffset;
      const col = pos.col + colOffset;
      if (row < 1 || col < 1) continue;
      const cell = cellsByKey.get(workbookCellKey(sheet, addressFromPosition(row, col)));
      if (cell) cells.push(cell);
    }
  }
  return cells;
}

function recommendedReadGroups(cells: RankedCell[]): Array<{ sheet: string; addresses: string[]; reason: string }> {
  const groups = groupByMap(cells, (cell) => cell.sheet);
  return [...groups.entries()].map(([sheet, sheetCells]) => ({
    sheet,
    addresses: sheetCells.slice(0, 16).map((cell) => cell.address),
    reason: [...new Set(sheetCells.flatMap((cell) => [...cell.reasons]))].slice(0, 6).join(", "),
  }));
}

function dedupeFindings(findings: WorkbookInspectionFinding[]): WorkbookInspectionFinding[] {
  const unique = new Map<string, WorkbookInspectionFinding>();
  for (const finding of findings) {
    const key = `${finding.kind}:${finding.sheet.toLowerCase()}:${normalizeAddress(finding.address)}`;
    const current = unique.get(key);
    if (!current || severityPriority(finding.severity) > severityPriority(current.severity)) unique.set(key, finding);
  }
  return [...unique.values()].sort((left, right) =>
    severityPriority(right.severity) - severityPriority(left.severity)
    || findingPriority(right.kind) - findingPriority(left.kind)
    || left.sheet.localeCompare(right.sheet)
    || compareAddresses(left.address, right.address));
}

function findingPriority(kind: WorkbookInspectionFindingKind): number {
  if (["formula_error", "formula_self_reference", "formula_text_match", "formula_fill_band", "named_year_target_band", "implicit_assignment_target"].includes(kind)) return 5;
  if (kind === "formula_pattern_outlier" || kind === "named_target_neighbor_formula") return 4;
  if (kind === "hardcoded_in_formula_band") return 2;
  return 1;
}

function severityPriority(severity: WorkbookInspectionFinding["severity"]): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

function instructionTermScore(instruction: string, cell: WorkbookObservedCell): number {
  const tokens = (instruction.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [])
    .filter((token) => !TASK_TERM_STOPWORDS.has(token));
  const haystack = `${displayValue(cell.value)} ${cell.formula ?? ""}`.toLowerCase();
  let score = 0;
  for (const token of new Set(tokens)) if (haystack.includes(token)) score += Math.min(8, token.length);
  return Math.min(score, 40);
}

function calculationRowContext(
  anchor: WorkbookObservedCell,
  cellsByKey: Map<string, WorkbookObservedCell>,
  radius: number,
): WorkbookObservedCell[] {
  const position = parseAddress(anchor.address);
  if (!position) return [];
  const context: WorkbookObservedCell[] = [];
  for (let col = Math.max(1, position.col - 2); col <= position.col + radius; col += 1) {
    for (const row of [position.row - 1, position.row, position.row + 1]) {
      if (row < 1) continue;
      const cell = cellsByKey.get(workbookCellKey(anchor.sheet, addressFromPosition(row, col)));
      if (cell) context.push(cell);
    }
  }
  return context;
}

function formulaScalarOverwriteAllowed(instruction: string): boolean {
  return /\b(?:hardcode|hard-coded|replace\s+(?:the\s+)?formula\s+with\s+(?:a\s+)?value|paste\s+values?|convert\s+to\s+values?)\b/i.test(instruction);
}

function workbookAuditFocus(instruction: string): WorkbookTaskInspection["auditFocus"] | undefined {
  const filename = instruction.match(/^Agent-visible input workbook name:\s*([^\r\n]+)$/im)?.[1]?.trim();
  if (!filename) return undefined;
  const workbookName = filename.split(/[\\/]/).at(-1) ?? filename;
  const auditName = workbookName
    .replace(/\.xlsx$/i, "")
    .replace(/_input$/i, "")
    .replace(/^\d+[-_ ]*/, "")
    .trim()
    .toLowerCase();
  const kind: WorkbookAuditFocus | undefined =
    /incorrect\s+average|incorrect\s+average\s+formulas/.test(auditName) ? "incorrect_average"
      : /embedded\s+hardcodes?/.test(auditName) ? "embedded_hardcode"
        : /inconsistent\s+colou?r\s+coding/.test(auditName) ? "color_coding"
          : /^errors?$/.test(auditName) ? "formula_errors"
            : /double\s+counting/.test(auditName) ? "double_counting"
              : /index\s+match/.test(auditName) ? "index_match"
                : /cross\s+sheet\s+references?/.test(auditName) ? "cross_sheet_reference"
                  : /unit\s+mismatch/.test(auditName) ? "unit_mismatch"
                    : /sign\s+conventions?/.test(auditName) ? "sign_convention"
                      : /relative\s+vs\s+absolute/.test(auditName) ? "relative_absolute_reference"
                        : undefined;
  return kind ? { kind, source: "agent_visible_filename", workbookName } : undefined;
}

type FocusedAuditAnalysis = {
  findings: WorkbookInspectionFinding[];
  formulaSuggestions: WorkbookTaskInspection["formulaRepairSuggestions"];
  valueSuggestions: WorkbookTaskInspection["valueSuggestions"];
};

function analyzeFocusedAuditPatterns(
  focus: WorkbookAuditFocus,
  cells: WorkbookObservedCell[],
): FocusedAuditAnalysis {
  const analyses: FocusedAuditAnalysis[] = [];
  if (focus === "double_counting") analyses.push(analyzeDoubleCountingAudit(cells));
  if (focus === "index_match") analyses.push(analyzeIndexMatchAudit(cells));
  if (focus === "relative_absolute_reference") analyses.push(analyzeRelativeAbsoluteAudit(cells));
  if (focus === "unit_mismatch") analyses.push(analyzeUnitMismatchAudit(cells));
  if (focus === "cross_sheet_reference") analyses.push(analyzeCrossSheetReferenceAudit(cells));
  if (focus === "sign_convention") analyses.push(analyzeSignConventionAudit(cells));
  if (focus === "embedded_hardcode") analyses.push(analyzeEmbeddedHardcodeAudit(cells));
  if (focus === "incorrect_average") analyses.push(analyzeIncorrectAverageAudit(cells));
  return mergeFocusedAuditAnalyses(analyses);
}

function emptyFocusedAuditAnalysis(): FocusedAuditAnalysis {
  return { findings: [], formulaSuggestions: [], valueSuggestions: [] };
}

function mergeFocusedAuditAnalyses(analyses: FocusedAuditAnalysis[]): FocusedAuditAnalysis {
  const formulaSuggestions = new Map<string, WorkbookTaskInspection["formulaRepairSuggestions"][number]>();
  const valueSuggestions = new Map<string, WorkbookTaskInspection["valueSuggestions"][number]>();
  for (const analysis of analyses) {
    for (const suggestion of analysis.formulaSuggestions) {
      formulaSuggestions.set(workbookCellKey(suggestion.sheet, suggestion.cell), suggestion);
    }
    for (const suggestion of analysis.valueSuggestions) {
      valueSuggestions.set(workbookCellKey(suggestion.sheet, suggestion.cell), suggestion);
    }
  }
  return {
    findings: analyses.flatMap((analysis) => analysis.findings),
    formulaSuggestions: [...formulaSuggestions.values()],
    valueSuggestions: [...valueSuggestions.values()],
  };
}

function analyzeDoubleCountingAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const bySheet = groupByMap(cells.filter((cell) => !!normalizeFormula(cell.formula) && !!parseAddress(cell.address)), (cell) => cell.sheet);
  for (const [sheet, sheetCells] of bySheet) {
    const rows = groupByMap(sheetCells, (cell) => parseAddress(cell.address)!.row);
    for (const rowCells of rows.values()) {
      for (const run of contiguousCellRuns(rowCells, "horizontal")) {
        if (run.length < 3 || !/\b(?:total|cumulative)\b/i.test(displayValue(nearestLeftLabel(run[0], cellsByKey)?.value))) continue;
        const anchorPattern = formulaPattern(run[0].formula!, run[0].address);
        const repairs = run.slice(1).map((cell, index) => {
          const prior = run[index].address;
          const formula = formulaWithoutPriorAccumulator(cell.formula!, prior);
          return formula && formulaPattern(formula, cell.address) === anchorPattern ? { cell, formula, prior } : undefined;
        });
        if (repairs.length < 2 || repairs.some((repair) => !repair)) continue;
        for (const repair of repairs as Array<{ cell: WorkbookObservedCell; formula: string; prior: string }>) {
          const evidence = [
            `${run[0].address} establishes a period-only total, while ${repair.cell.address} adds prior-period total ${repair.prior}`,
            `all later cells in ${run[0].address}:${run.at(-1)!.address} repeat the same cumulative double-counting pattern`,
          ];
          analysis.formulaSuggestions.push(focusedFormulaSuggestion(repair.cell, repair.formula, evidence));
          analysis.findings.push(focusedFormulaFinding(repair.cell, repair.formula, evidence));
        }
      }
    }

    const endingBalanceRows = [...new Set(cells.flatMap((cell) => {
      if (cell.sheet !== sheet || normalizeSemanticLabel(displayValue(cell.value)) !== "ending balance") return [];
      const position = parseAddress(cell.address);
      return position ? [position.row] : [];
    }))].sort((left, right) => left - right);
    if (endingBalanceRows.length < 2) continue;
    for (const target of sheetCells) {
      const targetLabel = nearestLeftLabel(target, cellsByKey);
      if (!/^\s*\(\s*-\s*\)\s*debt\b/i.test(displayValue(targetLabel?.value))) continue;
      const reference = normalizeFormula(target.formula)?.match(/^\+?(\$?[A-Z]{1,3}\$?[1-9][0-9]*)$/i)?.[1];
      const source = reference ? cellsByKey.get(workbookCellKey(sheet, reference)) : undefined;
      const sourcePosition = reference ? parseAddress(reference) : undefined;
      if (!source || !sourcePosition || !/\bnet debt\b/i.test(displayValue(nearestLeftLabel(source, cellsByKey)?.value))) continue;
      const componentRows = endingBalanceRows.filter((row) => row < sourcePosition.row && row >= sourcePosition.row - 40);
      if (componentRows.length < 2 || componentRows.length > 6) continue;
      const column = columnNumberToName(sourcePosition.col);
      const formula = `+${componentRows.map((row) => `${column}${row}`).join("+")}`;
      const evidence = [
        `${target.address} subtracts a net-debt subtotal even though the adjacent cash row is added separately`,
        `${componentRows.map((row) => `${column}${row}`).join(", ")} are the visible ending balances that compose debt`,
      ];
      analysis.formulaSuggestions.push(focusedFormulaSuggestion(target, formula, evidence));
      analysis.findings.push(focusedFormulaFinding(target, formula, evidence));
    }
  }
  return analysis;
}

function formulaWithoutPriorAccumulator(formula: string, priorAddress: string): string | undefined {
  const normalized = normalizeFormula(formula);
  if (!normalized || !/\bSUM\s*\(/i.test(normalized)) return undefined;
  const prior = escapeRegExp(normalizeAddress(priorAddress));
  const leading = normalized.match(new RegExp(`^\\+?\\$?${prior.replace(/([A-Z]+)(\d+)/, "$1\\$?$2")}\\+(.+)$`, "i"));
  if (leading) return leading[1];
  const trailing = normalized.match(new RegExp(`^(.*?)\\+\\$?${prior.replace(/([A-Z]+)(\d+)/, "$1\\$?$2")}$`, "i"));
  return trailing?.[1] || undefined;
}

function analyzeIndexMatchAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  for (const cell of cells.filter((candidate) => /\bINDEX\s*\(/i.test(candidate.formula ?? "") && /\bMATCH\s*\(/i.test(candidate.formula ?? ""))) {
    const parsed = parseIndexMatchFormula(cell.formula!);
    if (!parsed) continue;
    let formula = cell.formula!;
    const evidence: string[] = [];
    const indexStart = parseAddress(parsed.indexStart);
    const indexEnd = parseAddress(parsed.indexEnd);
    const lookupStart = parseAddress(parsed.lookupStart);
    const lookupEnd = parseAddress(parsed.lookupEnd);
    if (!indexStart || !indexEnd || !lookupStart || !lookupEnd) continue;
    let repairedIndexStart = parsed.indexStart;

    if (indexStart.row === indexEnd.row && lookupStart.row === lookupEnd.row) {
      const indexWidth = Math.abs(indexEnd.col - indexStart.col) + 1;
      const lookupWidth = Math.abs(lookupEnd.col - lookupStart.col) + 1;
      if (indexWidth !== lookupWidth && indexEnd.col === lookupEnd.col) {
        repairedIndexStart = preserveAddressAnchors(parsed.indexStart, lookupStart.col, indexStart.row);
        formula = formula.replace(parsed.indexRange, `${parsed.indexSheetToken}${repairedIndexStart}:${parsed.indexEnd}`);
        evidence.push(`INDEX width ${indexWidth} disagrees with MATCH width ${lookupWidth}; their visible right boundary agrees at ${parsed.indexEnd}`);
      }
    }

    const lookupBase = parsed.lookupExpression.match(/^\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\s*[+-]\s*\d+(?:\.\d+)?\s*$/i)?.[1];
    if (lookupBase) {
      const lookupValue = unwrapCellValue(cellsByKey.get(workbookCellKey(cell.sheet, lookupBase))?.value);
      const lookupSheet = sheetNameFromFormulaToken(parsed.lookupSheetToken) ?? cell.sheet;
      const lookupCells = expandReference({
        sheet: lookupSheet,
        start: parsed.lookupStart,
        end: parsed.lookupEnd,
        sourceText: parsed.lookupRange,
        role: "dependency",
      }, 256, true).map((address) => cellsByKey.get(workbookCellKey(lookupSheet, address))).filter(Boolean) as WorkbookObservedCell[];
      if (lookupValue !== undefined && lookupCells.some((candidate) => valuesEquivalent(unwrapCellValue(candidate.value), lookupValue))) {
        formula = formula.replace(parsed.lookupExpression, lookupBase);
        evidence.push(`${lookupBase} already exists in the visible MATCH lookup range; the arithmetic offset selects the wrong period`);
      }
    }

    const sourceSheet = sheetNameFromFormulaToken(parsed.indexSheetToken) ?? cell.sheet;
    const semanticRow = semanticIndexSourceRow({ cell, cells, sourceSheet, sourceStartCol: indexStart.col });
    if (semanticRow && semanticRow !== indexStart.row && indexStart.row === indexEnd.row) {
      const repairedStart = replaceAddressRow(repairedIndexStart, semanticRow);
      const repairedEnd = replaceAddressRow(parsed.indexEnd, semanticRow);
      const formulaRangeMatch = formula.match(/((?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_. -]*)!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*:\$?[A-Z]{1,3}\$?[1-9][0-9]*)/i)?.[1];
      formula = formulaRangeMatch
        ? formula.replace(formulaRangeMatch, `${parsed.indexSheetToken}${repairedStart}:${repairedEnd}`)
        : formula;
      evidence.push(`nearby target and source labels align the INDEX result to row ${semanticRow}, not row ${indexStart.row}`);
    }

    if (normalizeFormula(formula) === normalizeFormula(cell.formula)) continue;
    analysis.formulaSuggestions.push(focusedFormulaSuggestion(cell, formula, evidence));
    analysis.findings.push(focusedFormulaFinding(cell, formula, evidence));
  }
  return analysis;
}

type ParsedIndexMatchFormula = {
  indexSheetToken: string;
  indexStart: string;
  indexEnd: string;
  indexRange: string;
  lookupExpression: string;
  lookupSheetToken: string;
  lookupStart: string;
  lookupEnd: string;
  lookupRange: string;
};

function parseIndexMatchFormula(formula: string): ParsedIndexMatchFormula | undefined {
  const match = formula.match(/INDEX\(\s*((?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_. -]*)!)?)(\$?[A-Z]{1,3}\$?[1-9][0-9]*):(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\s*,\s*MATCH\(\s*([^,]+?)\s*,\s*((?:(?:'[^']+'|[A-Za-z_][A-Za-z0-9_. -]*)!)?)(\$?[A-Z]{1,3}\$?[1-9][0-9]*):(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\s*,\s*0\s*\)\s*\)/i);
  if (!match) return undefined;
  return {
    indexSheetToken: match[1] ?? "",
    indexStart: match[2],
    indexEnd: match[3],
    indexRange: `${match[1] ?? ""}${match[2]}:${match[3]}`,
    lookupExpression: match[4],
    lookupSheetToken: match[5] ?? "",
    lookupStart: match[6],
    lookupEnd: match[7],
    lookupRange: `${match[5] ?? ""}${match[6]}:${match[7]}`,
  };
}

function semanticIndexSourceRow(args: {
  cell: WorkbookObservedCell;
  cells: WorkbookObservedCell[];
  sourceSheet: string;
  sourceStartCol: number;
}): number | undefined {
  const targetPosition = parseAddress(args.cell.address);
  if (!targetPosition) return undefined;
  const targetLabels = args.cells.filter((candidate) => {
    const position = candidate.sheet === args.cell.sheet ? parseAddress(candidate.address) : undefined;
    return !!position
      && position.col < targetPosition.col
      && position.row >= targetPosition.row - 2
      && position.row <= targetPosition.row
      && typeof unwrapCellValue(candidate.value) === "string";
  });
  const targetTokens = new Set(targetLabels.flatMap((label) => semanticLabelTokens(displayValue(unwrapCellValue(label.value)))));
  if (targetTokens.size < 2) return undefined;
  const candidates = args.cells.flatMap((candidate) => {
    const position = candidate.sheet === args.sourceSheet ? parseAddress(candidate.address) : undefined;
    if (!position || position.col >= args.sourceStartCol || typeof unwrapCellValue(candidate.value) !== "string") return [];
    const tokens = semanticLabelTokens(displayValue(unwrapCellValue(candidate.value)));
    const score = tokens.filter((token) => targetTokens.has(token)).length;
    return score >= 2 ? [{ row: position.row, score }] : [];
  }).sort((left, right) => right.score - left.score || left.row - right.row);
  if (!candidates[0] || (candidates[1] && candidates[1].score === candidates[0].score && candidates[1].row !== candidates[0].row)) return undefined;
  return candidates[0].row;
}

function analyzeRelativeAbsoluteAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const formulas = cells.filter((cell) => !!normalizeFormula(cell.formula) && !!parseAddress(cell.address));
  const bySheetRow = groupByMap(formulas, (cell) => `${cell.sheet}\u0000${parseAddress(cell.address)!.row}`);
  for (const rowCells of bySheetRow.values()) {
    for (const run of contiguousCellRuns(rowCells, "horizontal")) {
      if (run.length < 3) continue;
      const proposals = new Map(run.map((cell) => [workbookCellKey(cell.sheet, cell.address), { formula: cell.formula!, evidence: [] as string[] }]));
      const tokenLists = run.map((cell) => formulaCellReferences(cell.formula!));
      const tokenCount = tokenLists[0]?.length ?? 0;
      if (!run.some((cell) => cell.formula!.includes("!")) && tokenCount > 0 && tokenLists.every((tokens) => tokens.length === tokenCount)) {
        for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
          const positions = tokenLists.map((tokens) => parseAddress(tokens[tokenIndex]));
          if (positions.some((position) => !position)) continue;
          const complete = positions as CellPosition[];
          const drifts = complete.every((position, index) =>
            position.row === complete[0].row && position.col === complete[0].col + index);
          if (!drifts || tokenLists[0][tokenIndex].includes("$")) continue;
          const anchorAddress = addressFromPosition(complete[0].row, complete[0].col);
          const anchor = cellsByKey.get(workbookCellKey(run[0].sheet, anchorAddress));
          const peerCells = complete.slice(1).map((position) =>
            cellsByKey.get(workbookCellKey(run[0].sheet, addressFromPosition(position.row, position.col))));
          if (!anchor || isBlank(unwrapCellValue(anchor.value)) || peerCells.some((cell) => cell && !isBlank(unwrapCellValue(cell.value)))) continue;
          const absoluteAnchor = `$${columnNumberToName(complete[0].col)}$${complete[0].row}`;
          run.forEach((cell) => {
            const proposal = proposals.get(workbookCellKey(cell.sheet, cell.address))!;
            proposal.formula = replaceNthCellReference(proposal.formula, tokenIndex, absoluteAnchor);
            proposal.evidence.push(`only ${anchorAddress} is populated in the drifting ${anchorAddress}:${addressFromPosition(complete.at(-1)!.row, complete.at(-1)!.col)} control series`);
          });
        }
      }

      const interpolationCells = run.flatMap((cell) => {
        const match = normalizeFormula(cell.formula)?.match(/^(\+?)(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\+\((\$?[A-Z]{1,3}\$?[1-9][0-9]*)-(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\)\/(\d+)$/i);
        return match ? [{ cell, match }] : [];
      });
      for (const interpolationRun of contiguousCellRuns(interpolationCells.map(({ cell }) => cell), "horizontal")) {
        if (interpolationRun.length < 2) continue;
        const members = interpolationRun.map((cell) => interpolationCells.find((entry) => entry.cell === cell)!);
        const firstTarget = parseAddress(members[0].cell.address)!;
        const firstUpper = parseAddress(members[0].match[3]);
        const firstLower = parseAddress(members[0].match[4]);
        const denominatorsAgree = members.every(({ match }) => match[5] === members[0].match[5]);
        const priorTracksTarget = members.every(({ match }, index) => parseAddress(match[2])?.col === firstTarget.col + index - 1);
        if (!firstUpper || !firstLower || !denominatorsAgree || !priorTracksTarget) continue;
        const upper = `$${columnNumberToName(firstUpper.col)}$${firstUpper.row}`;
        const lower = `$${columnNumberToName(firstLower.col)}$${firstLower.row}`;
        for (const { cell, match } of members) {
          const proposal = proposals.get(workbookCellKey(cell.sheet, cell.address))!;
          proposal.formula = `${match[1]}${match[2]}+(${upper}-${lower})/${match[5]}`;
          proposal.evidence.push(`the visible interpolation band shares fixed endpoints ${members[0].match[4]} and ${members[0].match[3]} across ${interpolationRun[0].address}:${interpolationRun.at(-1)!.address}`);
        }
      }

      for (const cell of run) {
        const proposal = proposals.get(workbookCellKey(cell.sheet, cell.address))!;
        if (normalizeFormula(proposal.formula) === normalizeFormula(cell.formula)) continue;
        const suggestion = focusedFormulaSuggestion(cell, proposal.formula, proposal.evidence);
        analysis.formulaSuggestions.push(suggestion);
        analysis.findings.push(focusedFormulaFinding(cell, proposal.formula, proposal.evidence));
      }
    }
  }
  return analysis;
}

function analyzeUnitMismatchAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  for (const cell of cells) {
    const value = unwrapCellValue(cell.value);
    if (cell.formula || typeof value !== "number" || Math.abs(value) <= 1 || Math.abs(value) > 100) continue;
    const label = nearestLeftLabel(cell, cellsByKey);
    const labelText = displayValue(label?.value);
    const percentageIntent = /%|percent|rate/i.test(labelText)
      || (/%/.test(cell.numFmt ?? "") && !/x/i.test(cell.numFmt ?? ""));
    if (!percentageIntent) continue;
    const repairedValue = value / 100;
    const repairedNumFmt = nearestPercentageNumberFormat(cell, labelText, cellsByKey)
      ?? (cell.numFmt && /%/.test(cell.numFmt) ? cell.numFmt : cell.numFmt ? `${cell.numFmt}%` : "0.0%");
    const evidence = [`${cell.address} contains ${value} under ${labelText || "a percentage-formatted field"}; visible percentage values are stored as decimals`];
    analysis.valueSuggestions.push({
      confidence: "high",
      sheet: cell.sheet,
      cell: cell.address,
      value: repairedValue,
      numFmt: repairedNumFmt,
      evidence,
    });
    analysis.findings.push({
      kind: "hardcoded_in_formula_band",
      severity: "error",
      sheet: cell.sheet,
      address: cell.address,
      detail: evidence[0],
      recommendedAction: `Store ${repairedValue} while preserving the displayed number format.`,
    });
  }

  for (const cell of cells.filter((candidate) => !!candidate.formula && workbookFormatKind(candidate) === "percent")) {
    const reference = parseSimpleCrossSheetReference(cell.formula!);
    if (!reference) continue;
    const source = cellsByKey.get(workbookCellKey(reference.sheet, reference.address));
    const sourcePosition = parseAddress(reference.address);
    if (!source || !sourcePosition || workbookFormatKind(source) === "percent") continue;
    const candidates = [-2, -1, 1, 2].flatMap((offset) => {
      const row = sourcePosition.row + offset;
      if (row < 1) return [];
      const candidate = cellsByKey.get(workbookCellKey(reference.sheet, addressFromPosition(row, sourcePosition.col)));
      return candidate && workbookFormatKind(candidate) === "percent" ? [candidate] : [];
    });
    if (candidates.length !== 1) continue;
    const repaired = cell.formula!.replace(reference.addressText, preserveReferenceAnchors(reference.addressText, candidates[0].address));
    const evidence = [`${cell.address} is percentage-formatted, but ${reference.sheet}!${reference.address} has ${workbookFormatKind(source)} units; adjacent ${candidates[0].address} is the unique percentage-formatted source`];
    analysis.formulaSuggestions.push(focusedFormulaSuggestion(cell, repaired, evidence));
    analysis.findings.push(focusedFormulaFinding(cell, repaired, evidence));
  }
  return mergeFocusedAuditAnalyses([analysis, analyzeCrossSheetSemanticUnitAudit(cells)]);
}

function nearestPercentageNumberFormat(
  cell: WorkbookObservedCell,
  labelText: string,
  cellsByKey: Map<string, WorkbookObservedCell>,
): string | undefined {
  const position = parseAddress(cell.address);
  if (!position) return undefined;
  const rateIntent = /rate/i.test(labelText);
  const percentIntent = /%|percent/i.test(labelText);
  const candidates: Array<{ distance: number; numFmt: string }> = [];
  for (let offset = -12; offset <= 12; offset += 1) {
    if (offset === 0 || position.row + offset < 1) continue;
    const candidate = cellsByKey.get(workbookCellKey(cell.sheet, addressFromPosition(position.row + offset, position.col)));
    if (!candidate?.numFmt || !/%/.test(candidate.numFmt) || /x/i.test(candidate.numFmt)) continue;
    const candidateLabel = displayValue(nearestLeftLabel(candidate, cellsByKey)?.value);
    if (rateIntent && !/rate/i.test(candidateLabel)) continue;
    if (percentIntent && !/%|percent/i.test(candidateLabel)) continue;
    candidates.push({ distance: Math.abs(offset), numFmt: candidate.numFmt });
  }
  return candidates.sort((left, right) => left.distance - right.distance)[0]?.numFmt;
}

function analyzeCrossSheetSemanticUnitAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const stringLabelsBySheetRow = new Map<string, WorkbookObservedCell[]>();
  for (const cell of cells) {
    const position = parseAddress(cell.address);
    if (!position || typeof unwrapCellValue(cell.value) !== "string") continue;
    const key = `${cell.sheet.toLowerCase()}\u0000${position.row}`;
    const labels = stringLabelsBySheetRow.get(key) ?? [];
    labels.push(cell);
    stringLabelsBySheetRow.set(key, labels);
  }
  const parsed = cells.flatMap((cell) => {
    const reference = cell.formula ? parseSimpleCrossSheetReference(cell.formula) : undefined;
    const target = parseAddress(cell.address);
    const source = reference ? parseAddress(reference.address) : undefined;
    return reference && target && source ? [{ cell, reference, target, source }] : [];
  });
  const groups = groupByMap(parsed, ({ cell, reference, target, source }) =>
    `${cell.sheet}\u0000${target.row}\u0000${reference.sheet}\u0000${source.row}`);
  for (const entries of groups.values()) {
    const run = contiguousCellRuns(entries.map(({ cell }) => cell), "horizontal")[0] ?? [];
    if (run.length < 3 || run.length !== entries.length) continue;
    const first = entries.find((entry) => entry.cell === run[0])!;
    const targetTokens = new Set<string>();
    for (let row = first.target.row; row >= Math.max(1, first.target.row - 3); row -= 1) {
      for (let col = first.target.col - 1; col >= Math.max(1, first.target.col - 8); col -= 1) {
        const label = cellsByKey.get(workbookCellKey(first.cell.sheet, addressFromPosition(row, col)));
        if (typeof unwrapCellValue(label?.value) !== "string") continue;
        for (const token of semanticLabelTokens(displayValue(label?.value))) targetTokens.add(token);
      }
    }
    if (targetTokens.size === 0) continue;
    const candidates = [-2, -1, 0, 1, 2].flatMap((offset) => {
      const row = first.source.row + offset;
      if (row < 1) return [];
      const labels = (stringLabelsBySheetRow.get(`${first.reference.sheet.toLowerCase()}\u0000${row}`) ?? [])
        .filter((candidate) => parseAddress(candidate.address)!.col < first.source.col);
      const score = labels.flatMap((label) => semanticLabelTokens(displayValue(label.value)))
        .filter((token) => targetTokens.has(token)).length;
      return score > 0 ? [{ row, score, labels }] : [];
    }).sort((left, right) => right.score - left.score || Math.abs(left.row - first.source.row) - Math.abs(right.row - first.source.row));
    const best = candidates[0];
    const current = candidates.find((candidate) => candidate.row === first.source.row);
    if (!best || best.row === first.source.row || best.score <= (current?.score ?? 0)
      || (candidates[1] && candidates[1].score === best.score)) continue;
    for (const entry of entries) {
      const repairedAddress = preserveAddressAnchors(entry.reference.addressText, entry.source.col, best.row);
      const formula = entry.cell.formula!.replace(entry.reference.addressText, repairedAddress);
      const evidence = [`${entry.cell.address} belongs to a ${[...targetTokens].join("/")} section, while ${entry.reference.address} points at a differently labeled source row; row ${best.row} is the unique nearby semantic match`];
      analysis.formulaSuggestions.push(focusedFormulaSuggestion(entry.cell, formula, evidence));
      analysis.findings.push(focusedFormulaFinding(entry.cell, formula, evidence));
    }
  }
  return analysis;
}

function analyzeCrossSheetReferenceAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const directReferences = cells.flatMap((cell) => {
    const reference = cell.formula ? parseSimpleCrossSheetReference(cell.formula) : undefined;
    const target = parseAddress(cell.address);
    const source = reference ? parseAddress(reference.address) : undefined;
    return reference && target && source ? [{ cell, reference, target, source }] : [];
  });
  const periodBands = groupByMap(directReferences, ({ cell, reference, target, source }) =>
    `${cell.sheet}\u0000${target.row}\u0000${reference.sheet}\u0000${source.row}`);
  for (const entries of periodBands.values()) {
    for (const run of contiguousCellRuns(entries.map(({ cell }) => cell), "horizontal")) {
      if (run.length < 3) continue;
      const members = run.map((cell) => entries.find((entry) => entry.cell === cell)!);
      const yearPairs = members.map(({ cell, reference, target, source }) => ({
        cell,
        reference,
        target,
        source,
        targetYear: topmostColumnYear(cellsByKey, cell.sheet, target.col),
        sourceYear: topmostColumnYear(cellsByKey, reference.sheet, source.col),
      }));
      if (yearPairs.some(({ targetYear, sourceYear }) => !targetYear || !sourceYear)) continue;
      const offsets = new Set(yearPairs.map(({ targetYear, sourceYear }) => sourceYear! - targetYear!));
      if (offsets.size !== 1 || offsets.has(0)) continue;
      const sourceColumns = [...new Set(cells.flatMap((candidate) => {
        const position = candidate.sheet === members[0].reference.sheet ? parseAddress(candidate.address) : undefined;
        return position ? [position.col] : [];
      }))];
      const repairs = yearPairs.map(({ cell, reference, source, targetYear, sourceYear }) => {
        const matchingColumns = sourceColumns.filter((col) =>
          topmostColumnYear(cellsByKey, reference.sheet, col) === targetYear);
        if (matchingColumns.length !== 1) return undefined;
        const repairedAddress = preserveAddressAnchors(reference.addressText, matchingColumns[0], source.row);
        return {
          cell,
          formula: cell.formula!.replace(reference.addressText, repairedAddress),
          evidence: [`${sourceRunRange(run)} forms a direct-reference period band; ${cell.address} is under ${targetYear}, while ${reference.sheet}!${reference.address} is under ${sourceYear}; column ${columnNumberToName(matchingColumns[0])} is the unique matching year`],
        };
      });
      if (repairs.some((repair) => !repair)) continue;
      for (const repair of repairs as Array<{ cell: WorkbookObservedCell; formula: string; evidence: string[] }>) {
        analysis.formulaSuggestions.push(focusedFormulaSuggestion(repair.cell, repair.formula, repair.evidence));
        analysis.findings.push(focusedFormulaFinding(repair.cell, repair.formula, repair.evidence));
      }
    }
  }

  for (const cell of cells.filter((candidate) => !!candidate.formula)) {
    const reference = parseSimpleCrossSheetReference(cell.formula!);
    const targetLabel = nearestLeftLabel(cell, cellsByKey);
    const source = reference ? cellsByKey.get(workbookCellKey(reference.sheet, reference.address)) : undefined;
    const sourceLabel = source ? nearestLeftLabel(source, cellsByKey) : undefined;
    const targetLabelText = displayValue(targetLabel?.value);
    const targetLabelKey = normalizeSemanticLabel(targetLabelText);
    const sourceLabelTokens = new Set(semanticLabelTokens(displayValue(sourceLabel?.value)));
    const overlap = semanticLabelTokens(targetLabelText).filter((token) => sourceLabelTokens.has(token)).length;
    if (!reference || !source || !targetLabelKey || overlap < 2
      || normalizeSemanticLabel(displayValue(sourceLabel?.value)) === targetLabelKey) continue;
    const exactLabels = cells.filter((candidate) => candidate.sheet === reference.sheet
      && normalizeSemanticLabel(displayValue(candidate.value)) === targetLabelKey
      && !!parseAddress(candidate.address));
    const candidates = exactLabels.flatMap((label) => {
      const position = parseAddress(label.address)!;
      for (let offset = 1; offset <= 4; offset += 1) {
        const candidate = cellsByKey.get(workbookCellKey(reference.sheet, addressFromPosition(position.row, position.col + offset)));
        if (candidate && (candidate.formula || !isBlank(unwrapCellValue(candidate.value)))) return [candidate];
      }
      return [];
    });
    if (candidates.length !== 1) continue;
    let repaired = cell.formula!.replace(reference.addressText, preserveReferenceAnchors(reference.addressText, candidates[0].address));
    if (/\b(?:fees?|costs?|expenses?)\b/i.test(targetLabelText) && !/^\s*-/.test(repaired)) repaired = `-${repaired.replace(/^\+/, "")}`;
    const evidence = [`${targetLabelText} maps uniquely to ${reference.sheet}!${candidates[0].address}; ${reference.address} belongs to ${displayValue(sourceLabel?.value)}`];
    analysis.formulaSuggestions.push(focusedFormulaSuggestion(cell, repaired, evidence));
    analysis.findings.push(focusedFormulaFinding(cell, repaired, evidence));
  }

  const bridgeRows = cells.flatMap((cell) => {
    if (!cell.formula) return [];
    const label = displayValue(nearestLeftLabel(cell, cellsByKey)?.value);
    const parsed = parseCrossSheetDifferenceFormula(cell.formula);
    return parsed && /\b(?:growth|expansion)\b/i.test(label) ? [{ cell, label, parsed }] : [];
  });
  for (const growth of bridgeRows.filter((entry) => /\bgrowth\b/i.test(entry.label))) {
    const growthPosition = parseAddress(growth.cell.address)!;
    const peer = bridgeRows.find((entry) => {
      const position = parseAddress(entry.cell.address)!;
      return entry.cell.sheet === growth.cell.sheet
        && /\bexpansion\b/i.test(entry.label)
        && position.col === growthPosition.col
        && position.row > growthPosition.row
        && position.row <= growthPosition.row + 4
        && entry.parsed.sheet === growth.parsed.sheet
        && entry.parsed.lower.col === growth.parsed.lower.col;
    });
    if (!peer || peer.parsed.upper.col === growth.parsed.upper.col
      || peer.parsed.upper.row !== growth.parsed.upper.row + 1) continue;
    const repairedAddress = preserveAddressAnchors(growth.parsed.upper.raw, peer.parsed.upper.col, growth.parsed.upper.row);
    const repaired = growth.cell.formula!.replace(growth.parsed.upper.raw, repairedAddress);
    const evidence = [`${growth.cell.address} and ${peer.cell.address} are paired growth/expansion bridges with the same baseline; ${peer.parsed.upper.raw} establishes the exit-period column`];
    analysis.formulaSuggestions.push(focusedFormulaSuggestion(growth.cell, repaired, evidence));
    analysis.findings.push(focusedFormulaFinding(growth.cell, repaired, evidence));
  }

  for (const cell of cells) {
    const text = typeof unwrapCellValue(cell.value) === "string" ? displayValue(cell.value).trim().toLowerCase() : "";
    if (!/^(?:the|and|or)$/.test(text) || cell.formula) continue;
    const neighbors = cellNeighbors(cell.sheet, cell.address, cellsByKey, 1);
    if (neighbors.some((neighbor) => neighbor.formula || !isBlank(unwrapCellValue(neighbor.value)))) continue;
    const evidence = [`${cell.address} contains the isolated stopword ${JSON.stringify(text)} in an otherwise blank local region`];
    analysis.valueSuggestions.push({ confidence: "high", sheet: cell.sheet, cell: cell.address, value: "", evidence });
    analysis.findings.push({
      kind: "hardcoded_in_formula_band",
      severity: "error",
      sheet: cell.sheet,
      address: cell.address,
      detail: evidence[0],
      recommendedAction: `Clear only ${cell.address}.`,
    });
  }
  return analysis;
}

function parseCrossSheetDifferenceFormula(formula: string): {
  sheet: string;
  upper: { raw: string; col: number; row: number };
  lower: { raw: string; col: number; row: number };
} | undefined {
  const match = normalizeFormula(formula)?.match(/^\((?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_. -]*))!(\$?[A-Z]{1,3}\$?[1-9][0-9]*)-(?:'\1'|\2)!(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\)\*/i);
  if (!match) return undefined;
  const upper = parseAddress(match[3]);
  const lower = parseAddress(match[4]);
  return upper && lower ? {
    sheet: (match[1] ?? match[2]).replace(/''/g, "'").trim(),
    upper: { raw: match[3], ...upper },
    lower: { raw: match[4], ...lower },
  } : undefined;
}

function analyzeSignConventionAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  for (const cell of cells.filter((candidate) => !!candidate.formula)) {
    const terms = parseSimpleAdditiveFormula(cell.formula!);
    if (!terms || terms.length < 2) continue;
    let explicitLabelCount = 0;
    const repairedTerms = terms.map((term, index) => {
      const source = cellsByKey.get(workbookCellKey(cell.sheet, term.address));
      const label = source ? nearestLeftLabel(source, cellsByKey) : undefined;
      const sign = displayValue(label?.value).match(/^\s*\(\s*([+-])\s*\)/)?.[1] as "+" | "-" | undefined;
      if (sign) explicitLabelCount += 1;
      return { ...term, sign: sign ?? (index === 0 && !term.sign ? "+" : term.sign || "+") };
    });
    let repaired = repairedTerms.map((term) => `${term.sign}${term.rawAddress}`).join("");
    const evidence: string[] = [];
    if (explicitLabelCount > 0 && formulaWithoutLeadingPlus(repaired) !== formulaWithoutLeadingPlus(cell.formula!)) {
      evidence.push(`${explicitLabelCount} referenced row label(s) explicitly declare (+) or (-) treatment`);
    } else {
      repaired = cell.formula!;
    }

    if (normalizeFormula(repaired) === normalizeFormula(cell.formula) && terms.length === 2) {
      const targetPosition = parseAddress(cell.address)!;
      const totalLabel = nearestLeftLabel(cellsByKey.get(workbookCellKey(cell.sheet, terms[0].address))!, cellsByKey);
      for (let offset = 1; offset <= 2; offset += 1) {
        const balancingCell = cellsByKey.get(workbookCellKey(cell.sheet, addressFromPosition(targetPosition.row + offset, targetPosition.col)));
        if (!balancingCell?.formula) continue;
        const balancingTerms = parseSimpleAdditiveFormula(balancingCell.formula);
        const balancingLabel = balancingCell ? nearestLeftLabel(balancingCell, cellsByKey) : undefined;
        if (!balancingLabel || !totalLabel) continue;
        const balancingReferences = balancingTerms?.map((term) => term.address)
          ?? formulaCellReferences(balancingCell.formula);
        const referencesTarget = balancingReferences.some((address) => normalizeAddress(address) === normalizeAddress(cell.address));
        const referencesComponent = balancingReferences.some((address) => normalizeAddress(address) === normalizeAddress(terms[1].address));
        const sameTotalLabel = normalizeSemanticLabel(displayValue(balancingLabel.value)) === normalizeSemanticLabel(displayValue(totalLabel.value));
        if (!referencesTarget || !referencesComponent || !sameTotalLabel || !/total/i.test(displayValue(totalLabel.value))) continue;
        repaired = `+${terms[0].rawAddress}-${terms[1].rawAddress}`;
        evidence.push(`${balancingCell.address} recombines ${cell.address} with ${terms[1].address} to reproduce ${displayValue(totalLabel.value)}`);
        break;
      }
    }

    if (normalizeFormula(repaired) === normalizeFormula(cell.formula)) continue;
    analysis.formulaSuggestions.push(focusedFormulaSuggestion(cell, repaired, evidence));
    analysis.findings.push(focusedFormulaFinding(cell, repaired, evidence));
  }
  return analysis;
}

function formulaWithoutLeadingPlus(formula: string): string {
  return (normalizeFormula(formula) ?? "").replace(/^\+/, "");
}

function analyzeEmbeddedHardcodeAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const bySheet = groupByMap(cells.filter((cell) => !!parseAddress(cell.address)), (cell) => cell.sheet);
  for (const sheetCells of bySheet.values()) {
    const rows = groupByMap(sheetCells, (cell) => parseAddress(cell.address)!.row);
    const formulaRuns = [...rows.values()].flatMap((rowCells) => contiguousCellRuns(
      rowCells.filter((cell) => !!cell.formula),
      "horizontal",
    )).filter((run) => run.length >= 3);
    const scalarRuns = [...rows.values()].flatMap((rowCells) => contiguousCellRuns(
      rowCells.filter((cell) => !cell.formula && typeof unwrapCellValue(cell.value) === "number"),
      "horizontal",
    )).filter((run) => run.length >= 3);
    for (const targetRun of scalarRuns) {
      if (targetRun.some((cell) => normalizeSpreadsheetFontColor(cell.fontColor) === "FF0000FF")) continue;
      const targetLabel = nearestLeftLabel(targetRun[0], cellsByKey);
      const targetTokens = new Set(semanticLabelTokens(displayValue(targetLabel?.value)));
      if (targetTokens.size < 2) continue;
      const targetKeys = new Set(targetRun.map((cell) => workbookCellKey(cell.sheet, cell.address)));
      const candidates = formulaRuns.flatMap((sourceRun) => {
        if (sourceRun.length !== targetRun.length) return [];
        const valuesMatch = sourceRun.every((source, index) => focusedValuesEquivalent(unwrapCellValue(source.value), unwrapCellValue(targetRun[index].value)));
        const sourceLabel = nearestLeftLabel(sourceRun[0], cellsByKey);
        const sourceTokens = new Set(semanticLabelTokens(displayValue(sourceLabel?.value)));
        const overlap = [...sourceTokens].filter((token) => targetTokens.has(token)).length;
        const specificity = semanticLabelSpecificityScore(targetTokens, sourceTokens);
        const formatMatches = workbookFormatKind(sourceRun[0]) === workbookFormatKind(targetRun[0]);
        const dependsOnTarget = sourceRun.some((source) => formulaTransitivelyDependsOnTargets(
          source,
          targetKeys,
          cellsByKey,
        ));
        return overlap >= 2 && formatMatches && !dependsOnTarget ? [{ sourceRun, overlap, specificity, valuesMatch }] : [];
      }).sort((left, right) => Number(right.valuesMatch) - Number(left.valuesMatch)
        || right.specificity - left.specificity
        || right.overlap - left.overlap);
      if (!candidates[0] || (candidates[1]
        && candidates[1].valuesMatch === candidates[0].valuesMatch
        && candidates[1].specificity === candidates[0].specificity
        && candidates[1].overlap === candidates[0].overlap)) continue;
      targetRun.forEach((target, index) => {
        const source = candidates[0].sourceRun[index];
        const formula = `+${source.address}`;
        const evidence = [`${targetRun[0].address}:${targetRun.at(-1)!.address} duplicates the formula-backed ${sourceRunRange(candidates[0].sourceRun)} values under matching row labels`];
        analysis.formulaSuggestions.push(focusedFormulaSuggestion(target, formula, evidence, "fill_gap"));
        analysis.findings.push(focusedFormulaFinding(target, formula, evidence, "hardcoded_in_formula_band"));
      });
    }

    for (const targetRun of scalarRuns.filter((run) => run.length >= 3)) {
      const label = displayValue(nearestLeftLabel(targetRun[0], cellsByKey)?.value);
      if (!/\bexit\b.*\bmultiple\b/i.test(label)) continue;
      const labeledControls = sheetCells.flatMap((cell) => {
        if (!cell.formula || !parseAddress(cell.address)) return [];
        const controlLabel = displayValue(nearestLeftLabel(cell, cellsByKey)?.value);
        return /^\s*(?:entry|exit)\b.*\bmultiple\b/i.test(controlLabel) ? [{ cell, controlLabel }] : [];
      });
      const entry = labeledControls.filter(({ controlLabel }) => /^\s*entry\b/i.test(controlLabel));
      const entryPosition = entry.length === 1 ? parseAddress(entry[0].cell.address) : undefined;
      const exit = labeledControls.filter(({ cell, controlLabel }) => {
        const position = parseAddress(cell.address);
        return /^\s*exit\b/i.test(controlLabel) && (!entryPosition || position?.col === entryPosition.col);
      });
      if (entry.length !== 1 || exit.length !== 1) continue;
      for (const target of targetRun) {
        const position = parseAddress(target.address)!;
        const header = cellsByKey.get(workbookCellKey(target.sheet, addressFromPosition(position.row - 2, position.col)));
        const isActual = /&\s*"A"/i.test(header?.formula ?? "");
        const isProjected = /&\s*"P"/i.test(header?.formula ?? "");
        if (!isActual && !isProjected) continue;
        const source = isActual ? entry[0].cell : exit[0].cell;
        const sourcePosition = parseAddress(source.address)!;
        const formula = isActual ? `+${source.address}` : `$${columnNumberToName(sourcePosition.col)}$${sourcePosition.row}`;
        const evidence = [`${target.address} is a hardcoded ${isActual ? "actual" : "projected"} exit multiple; ${source.address} is the uniquely labeled ${isActual ? "entry" : "exit"} multiple control`];
        analysis.formulaSuggestions.push(focusedFormulaSuggestion(target, formula, evidence, "fill_gap"));
        analysis.findings.push(focusedFormulaFinding(target, formula, evidence, "hardcoded_in_formula_band"));
      }
    }
  }

  const formulaBandsByCell = new Map<string, WorkbookObservedCell[]>();
  const formulaRows = groupByMap(cells.filter((cell) => !!cell.formula && !!parseAddress(cell.address)), (cell) => {
    const position = parseAddress(cell.address)!;
    return `${cell.sheet}\u0000${position.row}`;
  });
  for (const rowCells of formulaRows.values()) {
    for (const run of contiguousCellRuns(rowCells, "horizontal").filter((candidate) => candidate.length >= 3)) {
      for (const cell of run) formulaBandsByCell.set(workbookCellKey(cell.sheet, cell.address), run);
    }
  }

  for (const cell of cells.filter((candidate) => !!candidate.formula)) {
    const normalized = normalizeFormula(cell.formula)!;
    const differenceLiteral = normalized.match(/^\(((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. -]*)!\$?[A-Z]{1,3}\$?[1-9][0-9]*)-((?:'[^']+'|[A-Za-z_][A-Za-z0-9_. -]*)!\$?[A-Z]{1,3}\$?[1-9][0-9]*)\)\*(-?\d+(?:\.\d+)?)$/i);
    if (differenceLiteral && Math.abs(Number(differenceLiteral[3])) > 1) {
      const formula = normalized.replace(differenceLiteral[3], differenceLiteral[1]);
      const evidence = [`${cell.address} multiplies a cross-sheet bridge by literal ${differenceLiteral[3]}; the upper endpoint ${differenceLiteral[1]} is the visible exit assumption`];
      analysis.formulaSuggestions.push(focusedFormulaSuggestion(cell, formula, evidence));
      analysis.findings.push(focusedFormulaFinding(cell, formula, evidence));
      continue;
    }

    const numericLiterals = [...normalized.matchAll(/(?<![A-Z0-9_.])-?\d+(?:\.\d+)?(?![A-Z0-9_.])/gi)]
      .map((match) => ({ raw: match[0], value: Number(match[0]), index: match.index ?? -1 }))
      .filter(({ value }) => Number.isFinite(value) && value !== 0 && Math.abs(value) !== 1);
    if (numericLiterals.length !== 1) continue;
    const literal = numericLiterals[0];
    if (literal.index < 0 || normalized[literal.index + literal.raw.length] === "%") continue;
    const formulaBand = formulaBandsByCell.get(workbookCellKey(cell.sheet, cell.address));
    if (!formulaBand || formulaBand.filter((peer) =>
      numericFormulaLiterals(peer.formula).some((value) => Math.abs(value - literal.value) <= 1e-9)).length < 3) continue;
    const targetTokens = new Set(semanticLabelTokens(displayValue(nearestLeftLabel(cell, cellsByKey)?.value)));
    if (targetTokens.size < 2) continue;
    const candidates = cells.flatMap((candidate) => {
      const value = unwrapCellValue(candidate.value);
      if (candidate.sheet !== cell.sheet || candidate.formula || typeof value !== "number" || Math.abs(value - literal.value) > 1e-9) return [];
      const label = nearestLeftLabel(candidate, cellsByKey);
      const sourceTokens = new Set(semanticLabelTokens(displayValue(label?.value)));
      const score = semanticControlMatchScore(targetTokens, sourceTokens);
      const sourcePosition = parseAddress(candidate.address);
      const targetPosition = parseAddress(cell.address);
      const distance = sourcePosition && targetPosition
        ? Math.abs(sourcePosition.row - targetPosition.row) + Math.abs(sourcePosition.col - targetPosition.col)
        : Number.MAX_SAFE_INTEGER;
      return score >= 3 ? [{ candidate, score, distance }] : [];
    }).sort((left, right) => right.score - left.score || left.distance - right.distance);
    if (!candidates[0] || (candidates[1]
      && candidates[1].score === candidates[0].score
      && candidates[1].distance === candidates[0].distance)) continue;
    const source = candidates[0].candidate;
    const sourcePosition = parseAddress(source.address)!;
    const replacement = `$${columnNumberToName(sourcePosition.col)}$${sourcePosition.row}`;
    const formula = normalized.replace(literal.raw, replacement);
    const evidence = [`literal ${literal.raw} in ${cell.address} matches the uniquely labeled control ${source.sheet}!${source.address}`];
    analysis.formulaSuggestions.push(focusedFormulaSuggestion(cell, formula, evidence));
    analysis.findings.push(focusedFormulaFinding(cell, formula, evidence));
  }
  return analysis;
}

type FocusedAggregateRange = {
  functionName: "AVERAGE" | "MEDIAN" | "MAX" | "MIN";
  match: string;
  sourceSheet: string;
  sheetToken: string;
  startToken: string;
  endToken: string;
  start: string;
  end: string;
};

function analyzeIncorrectAverageAudit(cells: WorkbookObservedCell[]): FocusedAuditAnalysis {
  const analysis = emptyFocusedAuditAnalysis();
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const entries = cells.flatMap((cell) => {
    const parsed = cell.formula ? parseFocusedAggregateRange(cell.formula, cell.sheet) : undefined;
    const target = parseAddress(cell.address);
    const start = parsed ? parseAddress(parsed.start) : undefined;
    const end = parsed ? parseAddress(parsed.end) : undefined;
    return parsed && target && start && end ? [{ cell, parsed, target, start, end }] : [];
  });

  const periodicGroups = groupByMap(entries.filter(({ start, end }) => start.col === end.col), ({ cell, parsed, target, start }) =>
    `${cell.sheet}\u0000${target.row}\u0000${parsed.functionName}\u0000${parsed.sourceSheet}\u0000${start.col}`);
  for (const group of periodicGroups.values()) {
    for (const run of contiguousCellRuns(group.map(({ cell }) => cell), "horizontal")) {
      if (run.length < 3) continue;
      const members = run.map((cell) => group.find((entry) => entry.cell === cell)!);
      const periodLength = members[1].start.row - members[0].start.row;
      if (periodLength < 2 || periodLength > 366) continue;
      const regularStarts = members.every((entry, index) => index === 0
        || entry.start.row - members[index - 1].start.row === periodLength);
      const oneShort = members.every(({ start, end }) => end.row - start.row + 1 === periodLength - 1);
      const terminalCells = members.map(({ parsed, end }) =>
        cellsByKey.get(workbookCellKey(parsed.sourceSheet, addressFromPosition(end.row + 1, end.col))));
      const populatedTerminals = terminalCells.every((terminal) => terminal
        && ((terminal.formula && !FORMULA_ERROR_RE.test(terminal.formula))
          || typeof unwrapCellValue(terminal.value) === "number"));
      if (!regularStarts || !oneShort || !populatedTerminals) continue;
      for (const entry of members) {
        const repairedEnd = addressFromPosition(entry.end.row + 1, entry.end.col);
        const formula = replaceFocusedAggregateRange(entry.cell.formula!, entry.parsed, entry.parsed.start, repairedEnd);
        const evidence = [
          `${sourceRunRange(run)} uses regular ${periodLength}-row source periods, but every ${entry.parsed.functionName} range is one row short`,
          `${entry.parsed.sourceSheet}!${repairedEnd} is the populated terminal row immediately before the next period boundary`,
        ];
        analysis.formulaSuggestions.push(focusedFormulaSuggestion(entry.cell, formula, evidence));
        analysis.findings.push(focusedFormulaFinding(entry.cell, formula, evidence, "formula_range_anomaly"));
      }
    }
  }

  const panelGroups = groupByMap(entries.filter(({ cell, parsed, start, end }) =>
    parsed.sourceSheet.toLowerCase() === cell.sheet.toLowerCase() && start.row === end.row), ({ cell, parsed, target, start }) =>
    `${cell.sheet}\u0000${target.row}\u0000${parsed.functionName}\u0000${parsed.sourceSheet}\u0000${start.row}`);
  for (const group of panelGroups.values()) {
    if (group.length < 3) continue;
    const ordered = [...group].sort((left, right) => left.target.col - right.target.col);
    const panelStep = ordered[1].target.col - ordered[0].target.col;
    if (panelStep < 2 || !ordered.every((entry, index) => index === 0
      || entry.target.col - ordered[index - 1].target.col === panelStep)) continue;
    const counts = new Map<string, number>();
    for (const entry of ordered) {
      const key = `${entry.parsed.start}:${entry.parsed.end}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
    if (!ranked[0] || ranked[0][1] < 2 || ranked[0][1] === ranked[1]?.[1]) continue;
    const [consensusStart, consensusEnd] = ranked[0][0].split(":");
    for (const entry of ordered.filter(({ parsed }) => `${parsed.start}:${parsed.end}` !== ranked[0][0])) {
      const targetKeys = new Set([workbookCellKey(entry.cell.sheet, entry.cell.address)]);
      const currentRangeCells: WorkbookObservedCell[] = [];
      for (let col = entry.start.col; col <= entry.end.col; col += 1) {
        const source = cellsByKey.get(workbookCellKey(entry.parsed.sourceSheet, addressFromPosition(entry.start.row, col)));
        if (source) currentRangeCells.push(source);
      }
      if (!currentRangeCells.some((source) => formulaTransitivelyDependsOnTargets(source, targetKeys, cellsByKey))) continue;
      const formula = replaceFocusedAggregateRange(entry.cell.formula!, entry.parsed, consensusStart, consensusEnd);
      const evidence = [
        `${ordered.filter(({ parsed }) => `${parsed.start}:${parsed.end}` === ranked[0][0]).map(({ cell }) => cell.address).join(" and ")} establish ${consensusStart}:${consensusEnd} across equally spaced scenario panels`,
        `${entry.parsed.start}:${entry.parsed.end} includes a formula that depends on ${entry.cell.address}, creating a transitive aggregate cycle`,
      ];
      analysis.formulaSuggestions.push(focusedFormulaSuggestion(entry.cell, formula, evidence));
      analysis.findings.push(focusedFormulaFinding(entry.cell, formula, evidence, "formula_range_anomaly"));
    }
  }
  return analysis;
}

function parseFocusedAggregateRange(formula: string, fallbackSheet: string): FocusedAggregateRange | undefined {
  const match = formula.match(
    /\b(AVERAGE|MEDIAN|MAX|MIN)\s*\(\s*((?:'(?:[^']|'')+'|[A-Za-z_][A-Za-z0-9_.]*)!\s*)?(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\s*:\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\s*\)/i,
  );
  if (!match) return undefined;
  const sheetToken = match[2] ?? "";
  const rawSheet = sheetToken.trim().replace(/!$/, "");
  return {
    functionName: match[1].toUpperCase() as FocusedAggregateRange["functionName"],
    match: match[0],
    sourceSheet: rawSheet ? rawSheet.replace(/^'|'$/g, "").replace(/''/g, "'") : fallbackSheet,
    sheetToken,
    startToken: match[3],
    endToken: match[4],
    start: normalizeAddress(match[3]),
    end: normalizeAddress(match[4]),
  };
}

function replaceFocusedAggregateRange(
  formula: string,
  parsed: FocusedAggregateRange,
  start: string,
  end: string,
): string {
  return formula.replace(
    parsed.match,
    `${parsed.functionName}(${parsed.sheetToken}${anchoredAddress(parsed.startToken, start)}:${anchoredAddress(parsed.endToken, end)})`,
  );
}

function focusedFormulaSuggestion(
  cell: WorkbookObservedCell,
  formula: string,
  evidence: string[],
  kind: "fill_gap" | "replace_outlier" = "replace_outlier",
): WorkbookTaskInspection["formulaRepairSuggestions"][number] {
  return { kind, confidence: "high", sheet: cell.sheet, cell: cell.address, formula, evidence };
}

function focusedFormulaFinding(
  cell: WorkbookObservedCell,
  formula: string,
  evidence: string[],
  kind: WorkbookInspectionFindingKind = "formula_pattern_outlier",
): WorkbookInspectionFinding {
  return {
    kind,
    severity: "error",
    sheet: cell.sheet,
    address: cell.address,
    detail: evidence.join("; "),
    recommendedAction: `Replace only ${cell.address} with ${formula} and verify the local invariant.`,
  };
}

function contiguousCellRuns(cells: WorkbookObservedCell[], direction: "horizontal" | "vertical"): WorkbookObservedCell[][] {
  const sorted = [...cells].filter((cell) => !!parseAddress(cell.address)).sort((left, right) => {
    const a = parseAddress(left.address)!;
    const b = parseAddress(right.address)!;
    return direction === "horizontal" ? a.col - b.col : a.row - b.row;
  });
  const runs: WorkbookObservedCell[][] = [];
  for (const cell of sorted) {
    const position = parseAddress(cell.address)!;
    const current = runs.at(-1);
    const previous = current?.at(-1);
    const previousPosition = previous ? parseAddress(previous.address)! : undefined;
    const contiguous = previousPosition && (direction === "horizontal"
      ? position.row === previousPosition.row && position.col === previousPosition.col + 1
      : position.col === previousPosition.col && position.row === previousPosition.row + 1);
    if (!current || !contiguous) runs.push([cell]);
    else current.push(cell);
  }
  return runs;
}

function preserveAddressAnchors(address: string, col: number, row: number): string {
  const match = address.match(/^(\$?)[A-Z]{1,3}(\$?)[1-9][0-9]*$/i);
  return `${match?.[1] ?? ""}${columnNumberToName(col)}${match?.[2] ?? ""}${row}`;
}

function replaceAddressRow(address: string, row: number): string {
  const position = parseAddress(address);
  return position ? preserveAddressAnchors(address, position.col, row) : address;
}

function preserveReferenceAnchors(template: string, address: string): string {
  const position = parseAddress(address);
  return position ? preserveAddressAnchors(template, position.col, position.row) : address;
}

function sheetNameFromFormulaToken(token: string): string | undefined {
  const cleaned = token.trim().replace(/!$/, "");
  if (!cleaned) return undefined;
  return cleaned.replace(/^'|'$/g, "").replace(/''/g, "'");
}

function semanticLabelTokens(value: string): string[] {
  const normalized = value.toLowerCase()
    .replace(/\badj\.?\b/g, "adjusted")
    .replace(/%/g, " percent ")
    .replace(/[^a-z0-9]+/g, " ");
  const stop = new Set(["the", "and", "of", "as", "to", "in", "entry", "fy", "year", "case", "amdocs", "total"]);
  return [...new Set((normalized.match(/[a-z][a-z0-9]*/g) ?? []).filter((token) => !stop.has(token) && !/^20\d{2}$/.test(token)))];
}

function focusedValuesEquivalent(left: unknown, right: unknown): boolean {
  if (typeof left === "number" && typeof right === "number") {
    return Math.abs(left - right) <= Math.max(1e-9, Math.abs(left) * 1e-9, Math.abs(right) * 1e-9);
  }
  return displayValue(left) === displayValue(right);
}

function formulaCellReferences(formula: string): string[] {
  return [...formula.matchAll(CELL_TOKEN_RE)].map((match) => match[0]);
}

function formulaTransitivelyDependsOnTargets(
  cell: WorkbookObservedCell,
  targetKeys: Set<string>,
  cellsByKey: Map<string, WorkbookObservedCell>,
  seen = new Set<string>(),
  depth = 0,
): boolean {
  if (!cell.formula || depth > 24) return false;
  const key = workbookCellKey(cell.sheet, cell.address);
  if (seen.has(key)) return false;
  seen.add(key);
  for (const reference of formulaCellReferences(cell.formula)) {
    const referenceKey = workbookCellKey(cell.sheet, reference);
    if (targetKeys.has(referenceKey)) return true;
    const dependency = cellsByKey.get(referenceKey);
    if (dependency && formulaTransitivelyDependsOnTargets(dependency, targetKeys, cellsByKey, seen, depth + 1)) return true;
  }
  return false;
}

function numericFormulaLiterals(formula: string | undefined): number[] {
  const normalized = normalizeFormula(formula) ?? "";
  return [...normalized.matchAll(/(?<![A-Z0-9_.])-?\d+(?:\.\d+)?(?![A-Z0-9_.])/gi)]
    .filter((match) => normalized[(match.index ?? -1) + match[0].length] !== "%")
    .map((match) => Number(match[0]))
    .filter((value) => Number.isFinite(value) && value !== 0 && Math.abs(value) !== 1);
}

function semanticControlMatchScore(targetTokens: Set<string>, sourceTokens: Set<string>): number {
  let score = [...sourceTokens].filter((token) => targetTokens.has(token)).length;
  if (targetTokens.has("interest") && sourceTokens.has("rate")) score += 1;
  if (sourceTokens.has("debt") && ["debt", "secured", "tlb"].some((token) => targetTokens.has(token))) score += 1;
  return score;
}

function semanticLabelSpecificityScore(targetTokens: Set<string>, sourceTokens: Set<string>): number {
  const generic = new Set(["adjusted", "revenue", "percent", "amount", "value"]);
  return [...sourceTokens]
    .filter((token) => targetTokens.has(token))
    .reduce((score, token) => score + (generic.has(token) ? 1 : 2), 0);
}

function replaceNthCellReference(formula: string, targetIndex: number, replacement: string): string {
  let index = 0;
  return formula.replace(CELL_TOKEN_RE, (match) => index++ === targetIndex ? replacement : match);
}

function nearestLeftLabel(
  cell: WorkbookObservedCell | undefined,
  cellsByKey: Map<string, WorkbookObservedCell>,
): WorkbookObservedCell | undefined {
  if (!cell) return undefined;
  const position = parseAddress(cell.address);
  if (!position) return undefined;
  for (let col = position.col - 1; col >= Math.max(1, position.col - 12); col -= 1) {
    const candidate = cellsByKey.get(workbookCellKey(cell.sheet, addressFromPosition(position.row, col)));
    if (typeof unwrapCellValue(candidate?.value) === "string" && displayValue(unwrapCellValue(candidate?.value)).trim()) return candidate;
  }
  return undefined;
}

function workbookFormatKind(cell: WorkbookObservedCell): "percent" | "currency" | "multiple" | "number" {
  const format = cell.numFmt ?? "";
  if (/%/.test(format)) return "percent";
  if (/[$£€¥]/.test(format)) return "currency";
  if (/0\.0x|\bx\b/i.test(format)) return "multiple";
  return "number";
}

type SimpleCrossSheetReference = { sheet: string; address: string; addressText: string };

function parseSimpleCrossSheetReference(formula: string): SimpleCrossSheetReference | undefined {
  const match = normalizeFormula(formula)?.match(/^\+?(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_. -]*))!(\$?[A-Z]{1,3}\$?[1-9][0-9]*)$/i);
  if (!match) return undefined;
  return {
    sheet: (match[1] ?? match[2]).replace(/''/g, "'").trim(),
    address: normalizeAddress(match[3]),
    addressText: match[3],
  };
}

function visibleYearKey(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2200) return value;
  const match = displayValue(value).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function topmostColumnYear(
  cellsByKey: Map<string, WorkbookObservedCell>,
  sheet: string,
  col: number,
): number | undefined {
  for (let row = 1; row <= 64; row += 1) {
    const year = resolvedVisibleYear(cellsByKey, sheet, addressFromPosition(row, col));
    if (year) return year;
  }
  return undefined;
}

function resolvedVisibleYear(
  cellsByKey: Map<string, WorkbookObservedCell>,
  sheet: string,
  address: string,
  seen = new Set<string>(),
): number | undefined {
  const key = workbookCellKey(sheet, address);
  if (seen.has(key) || seen.size > 24) return undefined;
  seen.add(key);
  const cell = cellsByKey.get(key);
  const direct = visibleYearKey(unwrapCellValue(cell?.value));
  if (direct) return direct;
  const predecessor = normalizeFormula(cell?.formula)?.match(/^\+?(\$?[A-Z]{1,3}\$?[1-9][0-9]*)\+1$/i)?.[1];
  if (!predecessor) return undefined;
  const base = resolvedVisibleYear(cellsByKey, sheet, predecessor, seen);
  return base ? base + 1 : undefined;
}

type SimpleAdditiveTerm = { sign: "+" | "-" | ""; address: string; rawAddress: string };

function parseSimpleAdditiveFormula(formula: string): SimpleAdditiveTerm[] | undefined {
  const normalized = normalizeFormula(formula);
  if (!normalized || !/^\+?\$?[A-Z]{1,3}\$?[1-9][0-9]*(?:[+-]\$?[A-Z]{1,3}\$?[1-9][0-9]*)+$/i.test(normalized)) return undefined;
  return [...normalized.matchAll(/([+-]?)(\$?[A-Z]{1,3}\$?[1-9][0-9]*)/gi)].map((match) => ({
    sign: (match[1] ?? "") as "+" | "-" | "",
    address: normalizeAddress(match[2]),
    rawAddress: match[2],
  }));
}

function sourceRunRange(run: WorkbookObservedCell[]): string {
  return `${run[0].address}:${run.at(-1)!.address}`;
}

function auditFocusAllowsFormulaSuggestion(
  focus: WorkbookAuditFocus,
  suggestion: WorkbookTaskInspection["formulaRepairSuggestions"][number],
  cell: WorkbookObservedCell | undefined,
): boolean {
  const actual = normalizeFormula(cell?.formula);
  const proposed = normalizeFormula(suggestion.formula);
  if (!proposed) return false;
  if (focus === "embedded_hardcode") {
    return suggestion.kind === "fill_gap" && !!cell && !cell.formula && !isBlank(unwrapCellValue(cell.value));
  }
  if (suggestion.kind !== "replace_outlier" || !actual || actual === proposed) return false;
  if (focus === "incorrect_average") return /\bAVERAGE\s*\(/i.test(actual) && /\bAVERAGE\s*\(/i.test(proposed);
  // A clean downstream formula can cache #REF! solely because one of its
  // dependencies is broken. Replacing that formula from horizontal peers
  // corrupts semantic columns such as annual totals and YTD aggregates. Only
  // authorize an outlier replacement when the formula text itself is broken.
  if (focus === "formula_errors") return FORMULA_ERROR_RE.test(actual);
  if (focus === "double_counting") return formulasDifferByRangeEndpoint(actual, proposed);
  if (focus === "index_match") return /\b(?:INDEX|MATCH)\s*\(/i.test(actual) && /\b(?:INDEX|MATCH)\s*\(/i.test(proposed);
  if (focus === "cross_sheet_reference") return formulaSheetReferences(actual).join("\u0000") !== formulaSheetReferences(proposed).join("\u0000")
    && (formulaSheetReferences(actual).length > 0 || formulaSheetReferences(proposed).length > 0);
  if (focus === "unit_mismatch") return /(?:\*|\/)(?:1,?000|1,?000,?000|10\^\d+|1e[36])/i.test(`${actual}${proposed}`);
  if (focus === "sign_convention") return formulaWithoutSigns(actual) === formulaWithoutSigns(proposed);
  if (focus === "relative_absolute_reference") return actual.replace(/\$/g, "") === proposed.replace(/\$/g, "");
  return false;
}

function auditFocusAllowsFinding(
  focus: WorkbookAuditFocus,
  finding: WorkbookInspectionFinding,
  focusTargetKeys: Set<string>,
): boolean {
  const key = workbookCellKey(finding.sheet, finding.address);
  if (focusTargetKeys.has(key)) return true;
  if (focus === "formula_errors") return finding.kind === "formula_error" || finding.kind === "formula_self_reference";
  if (focus === "embedded_hardcode") return finding.kind === "hardcoded_in_formula_band";
  if (focus === "color_coding") return finding.kind === "font_color_anomaly";
  return false;
}

function formulasDifferByRangeEndpoint(left: string, right: string): boolean {
  if (!/\bSUM\s*\(/i.test(left) || !/\bSUM\s*\(/i.test(right)) return false;
  const range = /(?:(?:'[^']+'|[A-Za-z0-9_. -]+)!\s*)?(\$?[A-Z]{1,3}\$?[1-9][0-9]*):(\$?[A-Z]{1,3}\$?[1-9][0-9]*)/g;
  const leftRanges = [...left.matchAll(range)].map((match) => [normalizeAddress(match[1]), normalizeAddress(match[2])] as const);
  const rightRanges = [...right.matchAll(range)].map((match) => [normalizeAddress(match[1]), normalizeAddress(match[2])] as const);
  return leftRanges.some((leftRange, index) => {
    const rightRange = rightRanges[index];
    return !!rightRange && (
      leftRange[0] === rightRange[0] && leftRange[1] !== rightRange[1]
      || leftRange[0] !== rightRange[0] && leftRange[1] === rightRange[1]
    );
  });
}

function formulaSheetReferences(formula: string): string[] {
  return [...formula.matchAll(/(?:'([^']+)'|([A-Za-z0-9_. -]+))!/g)]
    .map((match) => (match[1] ?? match[2]).trim().toLowerCase())
    .sort();
}

function formulaWithoutSigns(formula: string): string {
  return formula
    .replace(/\*-?1(?:\.0+)?\b/g, "")
    .replace(/\/-?1(?:\.0+)?\b/g, "")
    .replace(/[+-]/g, "")
    .replace(/\$/g, "");
}

type WorkbookFontColorRole =
  | "external_direct_formula"
  | "external_derived_formula"
  | "internal_direct_formula"
  | "calculation_formula"
  | "hardcoded_input";

type WorkbookFontColorEntry = {
  cell: WorkbookObservedCell;
  role: WorkbookFontColorRole;
  family: "external_formula" | "internal_link" | "calculation" | "hardcode";
  position: CellPosition;
  color: string;
};

function analyzeFontColorAudit(cells: WorkbookObservedCell[]): {
  findings: WorkbookInspectionFinding[];
  suggestions: WorkbookTaskInspection["styleSuggestions"];
} {
  const eligible: WorkbookFontColorEntry[] = cells.flatMap((cell) => {
    const role = workbookFontColorRole(cell);
    const position = parseAddress(cell.address);
    return role && position ? [{
      cell,
      role,
      family: workbookFontColorFamily(role),
      position,
      color: observedFontColor(cell),
    }] : [];
  });
  const cellsByKey = new Map(cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const eligibleOrder = new Map(eligible.map((entry, index) => [workbookCellKey(entry.cell.sheet, entry.cell.address), index]));
  const eligibleByPosition = new Map(eligible.map((entry) => [fontColorPositionKey(entry.cell.sheet, entry.position), entry]));
  const eligibleBySheet = groupByMap(eligible, (entry) => entry.cell.sheet.toLowerCase());
  const hardcodes = eligible.filter((entry) => entry.role === "hardcoded_input");
  const externalDirect = eligible.filter((entry) => entry.role === "external_direct_formula");
  const familyColorCounts = countFontColorEntries(eligible, (entry) => `${entry.family}\u0000${entry.color}`);
  const sheetFamilyColorCounts = countFontColorEntries(eligible, (entry) => `${entry.cell.sheet.toLowerCase()}\u0000${entry.family}\u0000${entry.color}`);
  const sheetRoleColorCounts = countFontColorEntries(eligible, (entry) => `${entry.cell.sheet.toLowerCase()}\u0000${entry.role}\u0000${entry.color}`);
  const strongestFamilyCache = new Map<string, ReturnType<typeof strongestFamilyColor>>();
  const familyColorScoreCache = new Map<string, ReturnType<typeof familyColorScore>>();
  const roleColorGroups = groupByMap(eligible, (entry) => `${entry.cell.sheet.toLowerCase()}\u0000${entry.role}\u0000${entry.color}`);
  const componentCache = new Map<string, WorkbookFontColorEntry[][]>();
  const strongestFamilyForSheet = (
    sheet: string,
    family: WorkbookFontColorEntry["family"],
  ): ReturnType<typeof strongestFamilyColor> => {
    const key = `${sheet.toLowerCase()}\u0000${family}`;
    if (!strongestFamilyCache.has(key)) {
      strongestFamilyCache.set(key, strongestFamilyColor(eligibleBySheet.get(sheet.toLowerCase()) ?? [], family));
    }
    return strongestFamilyCache.get(key);
  };
  const familyColorScoreForSheet = (
    sheet: string,
    family: WorkbookFontColorEntry["family"],
    color: string,
  ): ReturnType<typeof familyColorScore> => {
    const key = `${sheet.toLowerCase()}\u0000${family}\u0000${color}`;
    if (!familyColorScoreCache.has(key)) {
      familyColorScoreCache.set(key, familyColorScore(eligibleBySheet.get(sheet.toLowerCase()) ?? [], family, color));
    }
    return familyColorScoreCache.get(key)!;
  };
  const componentsForRoleColor = (key: string): WorkbookFontColorEntry[][] => {
    const cached = componentCache.get(key);
    if (cached) return cached;
    const components = spatialComponents(roleColorGroups.get(key) ?? []);
    componentCache.set(key, components);
    return components;
  };
  const nearbyEntries = (
    entry: WorkbookFontColorEntry,
    rowRadius: number,
    colRadius: number,
    predicate: (candidate: WorkbookFontColorEntry) => boolean,
    manhattanRadius?: number,
  ): WorkbookFontColorEntry[] => {
    const matches: WorkbookFontColorEntry[] = [];
    for (let rowOffset = -rowRadius; rowOffset <= rowRadius; rowOffset += 1) {
      for (let colOffset = -colRadius; colOffset <= colRadius; colOffset += 1) {
        if (manhattanRadius !== undefined && Math.abs(rowOffset) + Math.abs(colOffset) > manhattanRadius) continue;
        const candidate = eligibleByPosition.get(fontColorPositionKey(entry.cell.sheet, {
          row: entry.position.row + rowOffset,
          col: entry.position.col + colOffset,
        }));
        if (candidate && predicate(candidate)) matches.push(candidate);
      }
    }
    return matches.sort((left, right) =>
      (eligibleOrder.get(workbookCellKey(left.cell.sheet, left.cell.address)) ?? 0)
      - (eligibleOrder.get(workbookCellKey(right.cell.sheet, right.cell.address)) ?? 0));
  };
  const candidates = new Map<string, {
    entry: WorkbookFontColorEntry;
    expected: string;
    score: number;
    methods: Set<string>;
    evidence: string[];
    related: Set<string>;
  }>();
  const addCandidate = (
    entry: WorkbookFontColorEntry,
    expected: string,
    method: string,
    score: number,
    evidence: string,
    peers: WorkbookFontColorEntry[] = [],
  ) => {
    if (entry.color === expected || !normalizeSpreadsheetFontColor(expected)) return;
    const key = workbookCellKey(entry.cell.sheet, entry.cell.address);
    const existing = candidates.get(key);
    if (existing && existing.expected !== expected) {
      if (existing.score >= score) return;
      candidates.delete(key);
    }
    const candidate = candidates.get(key) ?? {
      entry,
      expected,
      score: 0,
      methods: new Set<string>(),
      evidence: [],
      related: new Set<string>(),
    };
    candidate.score += score;
    candidate.methods.add(method);
    if (!candidate.evidence.includes(evidence)) candidate.evidence.push(evidence);
    for (const peer of peers) candidate.related.add(peer.cell.address);
    candidates.set(key, candidate);
  };

  // A role majority is accepted only inside one sheet and only with nearby
  // corroboration. This preserves intentional color dialects between sheets.
  for (const entries of groupByMap(eligible, (entry) => `${entry.cell.sheet.toLowerCase()}\u0000${entry.role}`).values()) {
    if (entries[0]?.role === "internal_direct_formula") continue;
    const majority = colorMajority(entries);
    const hardcodes = entries[0]?.role === "hardcoded_input";
    const minimumCount = hardcodes ? 3 : 2;
    const minimumShare = hardcodes ? 0.78 : 2 / 3;
    if (!majority || majority.count < minimumCount || majority.count / entries.length < minimumShare) continue;
    const componentSizes = spatialComponentSizes(entries);
    for (const entry of entries) {
      if (entry.color === majority.color) continue;
      if (entry.role === "hardcoded_input" && entry.color !== "FF000000") continue;
      if (!hardcodes && entry.color === "FFFFFFFF") continue;
      if (!hardcodes && (componentSizes.get(workbookCellKey(entry.cell.sheet, entry.cell.address)) ?? 1) > 2) continue;
      if (!hardcodes) {
        const sameColorInputs = nearbyEntries(entry, 0, 4, (peer) => peer.cell.sheet === entry.cell.sheet
          && peer.role === "hardcoded_input"
          && peer.color === entry.color
          && peer.position.row === entry.position.row);
        if (sameColorInputs.length >= 2) continue;
      }
      const entryShape = relativeFormulaShape(entry.cell);
      const entryLabel = normalizedNearestLeftLabel(entry.cell, cellsByKey);
      const peers = entries.filter((peer) => {
        if (peer.color !== majority.color || peer.cell.address === entry.cell.address) return false;
        if (hardcodes) return manhattanDistance(peer.position, entry.position) <= 8;
        const translatedPeer = peer.position.row === entry.position.row
          && !!entryShape
          && relativeFormulaShape(peer.cell) === entryShape;
        const mirroredLabel = peer.position.row === entry.position.row
          && !!entryLabel
          && normalizedNearestLeftLabel(peer.cell, cellsByKey) === entryLabel
          && formulaTopology(peer.cell.formula) === formulaTopology(entry.cell.formula);
        const compactRoleBand = entries.length <= 5
          && (peer.position.row === entry.position.row || peer.position.col === entry.position.col)
          && manhattanDistance(peer.position, entry.position) <= 2;
        return translatedPeer || mirroredLabel || compactRoleBand;
      });
      if (peers.length === 0) continue;
      addCandidate(
        entry,
        majority.color,
        "sheet_role_consensus",
        80 + peers.length,
        `${majority.count}/${entries.length} ${entry.role.replace(/_/g, " ")} cells on this sheet use ${majority.color}; ${peers.length} are nearby`,
        peers.slice(0, 6),
      );
    }
  }

  // Learn workbook-wide direct-link conventions, but require a matching local
  // peer so neutral output links remain untouched.
  for (const role of ["external_direct_formula"] as const) {
    const entries = externalDirect;
    const majority = colorMajority(entries);
    if (!majority || majority.count < 20 || majority.count / entries.length < 0.9) continue;
    for (const entry of entries.filter((candidate) => candidate.color !== majority.color)) {
      const peers = nearbyEntries(entry, 3, 3, (peer) => peer.cell.sheet === entry.cell.sheet
        && peer.role === role
        && peer.color === majority.color
        && manhattanDistance(peer.position, entry.position) <= 3, 3);
      if (peers.length === 0) continue;
      addCandidate(
        entry,
        majority.color,
        "workbook_link_convention",
        76 + peers.length,
        `${majority.count}/${entries.length} workbook ${role.replace(/_/g, " ")} cells use ${majority.color}, with a matching local peer`,
        peers.slice(0, 6),
      );
    }
  }

  // A unique external link inside an otherwise neutral calculation panel can
  // still be locally wrong even when there are no same-role peers.
  for (const entry of externalDirect.filter((candidate) => candidate.color !== "FF000000")) {
    const sheetKey = entry.cell.sheet.toLowerCase();
    const sameColorExternal = sheetRoleColorCounts.get(`${sheetKey}\u0000external_direct_formula\u0000${entry.color}`) ?? 0;
    if (sameColorExternal > 1) continue;
    const currentHardcodes = familyColorCounts.get(`hardcode\u0000${entry.color}`) ?? 0;
    const currentExternal = familyColorCounts.get(`external_formula\u0000${entry.color}`) ?? 0;
    if (currentHardcodes <= currentExternal) continue;
    const neutralPeers = nearbyEntries(entry, 8, 8, (peer) => peer.cell.sheet === entry.cell.sheet
      && peer.role !== "hardcoded_input"
      && peer.color === "FF000000"
      && manhattanDistance(peer.position, entry.position) <= 8, 8);
    if (neutralPeers.length < 5) continue;
    addCandidate(
      entry,
      "FF000000",
      "isolated_external_link_in_neutral_panel",
      88 + neutralPeers.length,
      `${neutralPeers.length} nearby formulas establish a neutral calculation panel around this isolated external link`,
      neutralPeers.slice(0, 6),
    );
  }

  // Large monochrome components can reveal a pasted wrong convention. The
  // expected color is learned from color-to-role affinity in the same sheet.
  for (const [roleColorKey] of roleColorGroups) {
    for (const component of componentsForRoleColor(roleColorKey)) {
      if (component.length < 3) continue;
      const role = component[0].role;
      const family = component[0].family;
      if (family !== "external_formula" && family !== "internal_link") continue;
      const bounds = componentBounds(component);
      if (role === "external_direct_formula" && bounds.width < 8) continue;
      const sheetEntries = eligibleBySheet.get(component[0].cell.sheet.toLowerCase()) ?? [];
      if (role === "external_derived_formula") {
        const currentHardcodes = sheetEntries.filter((entry) => entry.family === "hardcode" && entry.color === component[0].color).length;
        if (currentHardcodes < 3) continue;
      }
      if (role === "internal_direct_formula") {
        const currentExternal = sheetEntries.filter((entry) => entry.family === "external_formula" && entry.color === component[0].color).length;
        const currentInternal = sheetEntries.filter((entry) => entry.family === "internal_link" && entry.color === component[0].color).length;
        if (currentExternal <= currentInternal) continue;
      }
      const expected = strongestFamilyForSheet(component[0].cell.sheet, family);
      if (!expected || expected.color === component[0].color || expected.support < 3 || expected.purity < 0.5) continue;
      const current = familyColorScoreForSheet(component[0].cell.sheet, family, component[0].color);
      if (expected.score < Math.max(3, current.score * 1.5)) continue;
      if (component[0].color === "FF000000") {
        const expectedRoleColorKey = `${component[0].cell.sheet.toLowerCase()}\u0000${role}\u0000${expected.color}`;
        const overlapping = componentsForRoleColor(expectedRoleColorKey)
          .filter((peer) => peer.length >= 8 && componentColumnOverlap(component, peer) >= 0.8);
        if (overlapping.length < 2) continue;
      }
      for (const entry of component) {
        addCandidate(
          entry,
          expected.color,
          "spatial_role_affinity",
          92 + component.length,
          `${component.length}-cell ${role.replace(/_/g, " ")} component uses ${entry.color}; ${expected.support} same-family cells establish ${expected.color}`,
          nearbyEntries(entry, 16, 16, (peer) => peer.cell.sheet === entry.cell.sheet
            && peer.family === family
            && peer.color === expected.color
            && manhattanDistance(peer.position, entry.position) <= 16, 16).slice(0, 6),
        );
      }
    }
  }

  // Scenario matrices often mix seed values and chained formulas. A dense
  // local rectangle with one number format supplies stronger evidence than the
  // hardcode/formula distinction alone.
  for (const entry of hardcodes) {
    const peers = nearbyEntries(entry, 1, 3, (peer) => peer.cell.sheet === entry.cell.sheet
      && (peer.cell.numFmt ?? "") === (entry.cell.numFmt ?? "")
      && Math.abs(peer.position.row - entry.position.row) <= 1
      && Math.abs(peer.position.col - entry.position.col) <= 3);
    const majority = colorMajority(peers);
    if (!majority || peers.length < 8 || majority.count / peers.length < 0.75 || majority.color === entry.color) continue;
    const distinctRows = new Set(peers.map((peer) => peer.position.row)).size;
    const distinctCols = new Set(peers.map((peer) => peer.position.col)).size;
    if (distinctRows < 2 || distinctCols < 3) continue;
    const sheetKey = entry.cell.sheet.toLowerCase();
    const expectedInputSupport = sheetFamilyColorCounts.get(`${sheetKey}\u0000hardcode\u0000${majority.color}`) ?? 0;
    const currentInputSupport = sheetFamilyColorCounts.get(`${sheetKey}\u0000hardcode\u0000${entry.color}`) ?? 0;
    if (expectedInputSupport < 3 || expectedInputSupport <= currentInputSupport) continue;
    addCandidate(
      entry,
      majority.color,
      "dense_scenario_matrix",
      98 + majority.count,
      `${majority.count}/${peers.length} nearby cells in the same formatted scenario matrix use ${majority.color}`,
      peers.filter((peer) => peer.color === majority.color).slice(0, 6),
    );
  }

  // Repeated assumption labels provide a safe vertical-block signal even when
  // their value and percentage number formats differ.
  const labeledGroups = new Map<string, WorkbookFontColorEntry[]>();
  for (const entry of eligible) {
    const label = nearestLeftLabel(entry.cell, cellsByKey);
    const tokens = displayValue(unwrapCellValue(label?.value)).toLowerCase().match(/[a-z][a-z0-9]+/g) ?? [];
    for (const token of tokens.filter((value) => /^(?:assumptions?|baseline|scenario|case|toggle)$/.test(value))) {
      const key = `${entry.cell.sheet.toLowerCase()}\u0000${entry.position.col}\u0000${token}`;
      const group = labeledGroups.get(key) ?? [];
      group.push(entry);
      labeledGroups.set(key, group);
    }
  }
  for (const entries of labeledGroups.values()) {
    const ordered = [...entries].sort((left, right) => left.position.row - right.position.row);
    const runs: WorkbookFontColorEntry[][] = [];
    for (const entry of ordered) {
      const run = runs.at(-1);
      if (!run || entry.position.row - run.at(-1)!.position.row > 2) runs.push([entry]);
      else run.push(entry);
    }
    for (const run of runs) {
      const majority = colorMajority(run);
      if (!majority || run.length < 4 || majority.count < 3 || majority.count / run.length < 0.75) continue;
      for (const entry of run.filter((candidate) => candidate.color !== majority.color)) {
        addCandidate(
          entry,
          majority.color,
          "labeled_assumption_block",
          104 + majority.count,
          `${majority.count}/${run.length} adjacent cells with the same assumption label use ${majority.color}`,
          run.filter((peer) => peer.color === majority.color),
        );
      }
    }
  }

  const ranked = [...candidates.values()]
    .sort((left, right) => right.score - left.score
      || left.entry.cell.sheet.localeCompare(right.entry.cell.sheet)
      || compareAddresses(left.entry.cell.address, right.entry.cell.address));
  return {
    findings: ranked.map((candidate) => ({
      kind: "font_color_anomaly",
      severity: "warning",
      sheet: candidate.entry.cell.sheet,
      address: candidate.entry.cell.address,
      relatedAddresses: [...candidate.related].slice(0, 6),
      detail: candidate.evidence.join("; "),
      recommendedAction: `Change only the font color to ${candidate.expected}; preserve the cell value, formula, number format, and other font attributes.`,
    })),
    suggestions: ranked.map((candidate) => ({
      kind: "font_color",
      confidence: "high",
      sheet: candidate.entry.cell.sheet,
      cell: candidate.entry.cell.address,
      fontColor: candidate.expected,
      evidence: candidate.evidence,
    })),
  };
}

function workbookFontColorRole(cell: WorkbookObservedCell): WorkbookFontColorRole | undefined {
  const formula = normalizeFormula(cell.formula);
  if (formula) {
    const direct = /^\+?(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_. -]*))!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*$/i.test(formula);
    const external = formulaSheetReferences(formula).some((sheet) => sheet !== cell.sheet.trim().toLowerCase());
    if (external && direct) return "external_direct_formula";
    if (external && pureExternalAggregateFormula(formula, cell.sheet)) return "external_derived_formula";
    return direct ? "internal_direct_formula" : "calculation_formula";
  }
  const value = unwrapCellValue(cell.value);
  return typeof value === "number" || typeof value === "boolean" || value instanceof Date ? "hardcoded_input" : undefined;
}

function pureExternalAggregateFormula(formula: string, currentSheet: string): boolean {
  if (!/^\+?(?:AVERAGE|SUM|MEDIAN|MIN|MAX)\s*\([^()]+\)$/i.test(formula)) return false;
  const references = formulaSheetReferences(formula);
  return references.length > 0 && references.every((sheet) => sheet !== currentSheet.trim().toLowerCase());
}

function workbookFontColorFamily(role: WorkbookFontColorRole): WorkbookFontColorEntry["family"] {
  if (role === "external_direct_formula" || role === "external_derived_formula") return "external_formula";
  if (role === "internal_direct_formula") return "internal_link";
  if (role === "hardcoded_input") return "hardcode";
  return "calculation";
}

function fontColorPositionKey(sheet: string, position: CellPosition): string {
  return `${sheet.toLowerCase()}\u0000${position.row}:${position.col}`;
}

function countFontColorEntries(
  entries: WorkbookFontColorEntry[],
  keyFor: (entry: WorkbookFontColorEntry) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = keyFor(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function countColors(entries: WorkbookFontColorEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.color, (counts.get(entry.color) ?? 0) + 1);
  return counts;
}

function colorMajority(entries: WorkbookFontColorEntry[]): { color: string; count: number } | undefined {
  const first = [...countColors(entries)].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  return first ? { color: first[0], count: first[1] } : undefined;
}

function manhattanDistance(left: CellPosition, right: CellPosition): number {
  return Math.abs(left.row - right.row) + Math.abs(left.col - right.col);
}

function spatialComponents(entries: WorkbookFontColorEntry[]): WorkbookFontColorEntry[][] {
  const byPosition = new Map(entries.map((entry) => [`${entry.position.row}:${entry.position.col}`, entry]));
  const seen = new Set<string>();
  const components: WorkbookFontColorEntry[][] = [];
  for (const entry of entries) {
    const origin = `${entry.position.row}:${entry.position.col}`;
    if (seen.has(origin)) continue;
    const component: WorkbookFontColorEntry[] = [];
    const queue = [entry];
    let cursor = 0;
    seen.add(origin);
    while (cursor < queue.length) {
      const current = queue[cursor++];
      component.push(current);
      for (const [row, col] of [
        [current.position.row - 1, current.position.col],
        [current.position.row + 1, current.position.col],
        [current.position.row, current.position.col - 1],
        [current.position.row, current.position.col + 1],
      ]) {
        const key = `${row}:${col}`;
        const neighbor = byPosition.get(key);
        if (!neighbor || seen.has(key)) continue;
        seen.add(key);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

function spatialComponentSizes(entries: WorkbookFontColorEntry[]): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const colorEntries of groupByMap(entries, (entry) => entry.color).values()) {
    for (const component of spatialComponents(colorEntries)) {
      for (const entry of component) sizes.set(workbookCellKey(entry.cell.sheet, entry.cell.address), component.length);
    }
  }
  return sizes;
}

function relativeFormulaShape(cell: WorkbookObservedCell): string | undefined {
  const formula = normalizeFormula(cell.formula);
  const origin = parseAddress(cell.address);
  if (!formula || !origin) return undefined;
  return formula.replace(CELL_TOKEN_RE, (token) => {
    const match = token.match(/^(\$?)([A-Z]{1,3})(\$?)([1-9][0-9]*)$/i);
    const position = parseAddress(token);
    if (!match || !position) return token.toUpperCase();
    const col = match[1] ? `$${position.col}` : String(position.col - origin.col);
    const row = match[3] ? `$${position.row}` : String(position.row - origin.row);
    return `R${row}C${col}`;
  });
}

function formulaTopology(formula: string | undefined): string | undefined {
  const normalized = normalizeFormula(formula)?.toUpperCase();
  if (!normalized) return undefined;
  return normalized
    .replace(/'(?:[^']|'')+'!/g, "SHEET!")
    .replace(/\b[A-Z_][A-Z0-9_. -]*!/g, "SHEET!")
    .replace(CELL_TOKEN_RE, "CELL")
    .replace(/\b\d+(?:\.\d+)?%?/g, "NUM")
    .replace(/\$/g, "");
}

function normalizedNearestLeftLabel(
  cell: WorkbookObservedCell,
  cellsByKey: Map<string, WorkbookObservedCell>,
): string | undefined {
  const value = displayValue(unwrapCellValue(nearestLeftLabel(cell, cellsByKey)?.value))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return value || undefined;
}

function componentBounds(entries: WorkbookFontColorEntry[]): { minCol: number; maxCol: number; width: number } {
  const cols = entries.map((entry) => entry.position.col);
  const minCol = Math.min(...cols);
  const maxCol = Math.max(...cols);
  return { minCol, maxCol, width: maxCol - minCol + 1 };
}

function componentColumnOverlap(left: WorkbookFontColorEntry[], right: WorkbookFontColorEntry[]): number {
  const a = componentBounds(left);
  const b = componentBounds(right);
  const overlap = Math.max(0, Math.min(a.maxCol, b.maxCol) - Math.max(a.minCol, b.minCol) + 1);
  return overlap / Math.max(1, Math.min(a.width, b.width));
}

function familyColorScore(
  entries: WorkbookFontColorEntry[],
  family: WorkbookFontColorEntry["family"],
  color: string,
): { color: string; support: number; purity: number; score: number } {
  const colorEntries = entries.filter((entry) => entry.color === color);
  const support = colorEntries.filter((entry) => entry.family === family).length;
  const purity = support / Math.max(1, colorEntries.length);
  return { color, support, purity, score: support * purity };
}

function strongestFamilyColor(
  entries: WorkbookFontColorEntry[],
  family: WorkbookFontColorEntry["family"],
): ReturnType<typeof familyColorScore> | undefined {
  const colors = new Set(entries.map((entry) => entry.color));
  return [...colors]
    .map((color) => familyColorScore(entries, family, color))
    .sort((left, right) => right.score - left.score || right.support - left.support || left.color.localeCompare(right.color))[0];
}

function observedFontColor(cell: WorkbookObservedCell): string {
  return normalizeSpreadsheetFontColor(cell.fontColor) ?? "FF000000";
}

function genericFormulaAuditTask(instruction: string): boolean {
  return /\b(?:audit\s+and\s+fix|audit\s+this\s+(?:file|workbook)|fix\s+(?:all\s+)?formula\s+(?:errors|inconsistencies)|repair\s+(?:all\s+)?broken\s+(?:formulas|references))\b/i.test(instruction);
}

function formulaLooksBalanced(formula: string): boolean {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < formula.length; index += 1) {
    const char = formula[index];
    if (char === '"') {
      if (inString && formula[index + 1] === '"') index += 1;
      else inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0 && !inString;
}

function formulaReferencesAddress(formula: string, address: string): boolean {
  const normalized = normalizeAddress(address);
  return [...formula.matchAll(CELL_TOKEN_RE)].some((match) => normalizeAddress(match[0]) === normalized);
}

function formulaReferencesCurrentCell(formula: string, sheet: string, address: string): boolean {
  const normalizedAddress = normalizeAddress(address);
  const normalizedSheet = sheet.trim().toLowerCase();
  for (const match of formula.matchAll(CELL_TOKEN_RE)) {
    if (normalizeAddress(match[0]) !== normalizedAddress) continue;
    const prefix = formula.slice(0, match.index ?? 0);
    if (/\[[^\]]+\][^!]*!$/.test(prefix)) continue;
    const quotedSheet = prefix.match(/'((?:[^']|'')+)'!$/);
    if (quotedSheet) {
      if (quotedSheet[1].replace(/''/g, "'").trim().toLowerCase() === normalizedSheet) return true;
      continue;
    }
    const plainSheet = prefix.match(/(?:^|[^A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_.]*)!$/);
    if (plainSheet) {
      if (plainSheet[1].trim().toLowerCase() === normalizedSheet) return true;
      continue;
    }
    return true;
  }
  return false;
}

function parseAddress(address: string): CellPosition | undefined {
  const match = normalizeAddress(address).match(A1_RE);
  if (!match) return undefined;
  return { col: columnNameToNumber(match[1]), row: Number(match[2]) };
}

function addressFromPosition(row: number, col: number): string {
  if (row < 1 || col < 1) return "";
  return `${columnNumberToName(col)}${row}`;
}

function columnNameToNumber(column: string): number {
  return column.toUpperCase().split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

function columnNumberToName(column: number): string {
  let value = "";
  let remaining = column;
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    value = String.fromCharCode(65 + modulo) + value;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return value;
}

function compareAddresses(left: string, right: string): number {
  const a = parseAddress(left);
  const b = parseAddress(right);
  if (!a || !b) return left.localeCompare(right);
  return a.row - b.row || a.col - b.col;
}

function formatWorkbookTargetRanges(keys: string[], sheetNames: string[]): string {
  const canonicalSheets = new Map(sheetNames.map((sheet) => [sheet.toLowerCase(), sheet]));
  const bySheet = new Map<string, string[]>();
  for (const key of new Set(keys)) {
    const separator = key.lastIndexOf("!");
    if (separator < 1) continue;
    const rawSheet = key.slice(0, separator);
    const address = normalizeAddress(key.slice(separator + 1));
    if (!parseAddress(address)) continue;
    const sheet = canonicalSheets.get(rawSheet.toLowerCase()) ?? rawSheet;
    const addresses = bySheet.get(sheet) ?? [];
    addresses.push(address);
    bySheet.set(sheet, addresses);
  }

  const formatted: string[] = [];
  for (const [sheet, rawAddresses] of bySheet) {
    const addresses = [...new Set(rawAddresses)].sort(compareAddresses);
    const used = new Set<string>();
    for (const rowAddresses of groupByMap(addresses, (address) => parseAddress(address)!.row).values()) {
      const sorted = [...rowAddresses].sort(compareAddresses);
      for (let index = 0; index < sorted.length;) {
        const run = [sorted[index]];
        let cursor = index + 1;
        while (cursor < sorted.length) {
          const previous = parseAddress(run.at(-1)!)!;
          const next = parseAddress(sorted[cursor])!;
          if (next.col !== previous.col + 1) break;
          run.push(sorted[cursor]);
          cursor += 1;
        }
        if (run.length > 1) {
          run.forEach((address) => used.add(address));
          formatted.push(formatSheetRange(sheet, run[0], run.at(-1)!));
        }
        index = cursor;
      }
    }

    const remaining = addresses.filter((address) => !used.has(address));
    for (const columnAddresses of groupByMap(remaining, (address) => parseAddress(address)!.col).values()) {
      const sorted = [...columnAddresses].sort(compareAddresses);
      for (let index = 0; index < sorted.length;) {
        const run = [sorted[index]];
        let cursor = index + 1;
        while (cursor < sorted.length) {
          const previous = parseAddress(run.at(-1)!)!;
          const next = parseAddress(sorted[cursor])!;
          if (next.row !== previous.row + 1) break;
          run.push(sorted[cursor]);
          cursor += 1;
        }
        run.forEach((address) => used.add(address));
        formatted.push(formatSheetRange(sheet, run[0], run.at(-1)!));
        index = cursor;
      }
    }
  }
  return formatted.join(", ");
}

function formatSheetRange(sheet: string, start: string, end: string): string {
  const sheetToken = /^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`;
  return `${sheetToken}!${start}${start === end ? "" : `:${end}`}`;
}

function compactFormulaText(value: string): string {
  return value.replace(/\s+/g, "").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
}

function displayValue(value: unknown): string {
  const unwrapped = unwrapCellValue(value);
  if (unwrapped === null || unwrapped === undefined) return "";
  if (typeof unwrapped === "string") return unwrapped;
  if (typeof unwrapped === "number" || typeof unwrapped === "boolean") return String(unwrapped);
  try { return JSON.stringify(unwrapped); } catch { return String(unwrapped); }
}

function unwrapCellValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if ("value" in record) return record.value;
  if ("result" in record) return record.result;
  return value;
}

function formulaFromValue(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const formula = (value as Record<string, unknown>).formula;
  return typeof formula === "string" ? formula : undefined;
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function valuesEquivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left === "number" && typeof right === "number") return Math.abs(left - right) <= 1e-9;
  return stableValue(left) === stableValue(right);
}

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function groupByMap<T, K>(values: T[], keyFor: (value: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}
