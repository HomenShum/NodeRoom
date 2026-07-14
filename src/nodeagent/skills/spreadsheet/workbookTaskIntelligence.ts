export type WorkbookObservedCell = {
  sheet: string;
  address: string;
  value: unknown;
  formula?: string;
  numFmt?: string;
  version?: number;
};

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

export type WorkbookTaskInspection = {
  schema: 1;
  mutatingTask: boolean;
  allowEmptyPlan: boolean;
  referencedSheets: string[];
  explicitReferences: WorkbookTaskReference[];
  targetCandidates: Array<{ sheet: string; address: string; reason: string }>;
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
  [key: string]: unknown;
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
  | "malformed_formula"
  | "duplicate_target";

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
  allowBlank?: boolean;
};

export type WorkbookValueCheckResult = WorkbookValueCheck & {
  ok: boolean;
  actualValue: unknown;
  actualFormula?: string;
  actualNumFmt?: string;
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

const A1_RE = /^\$?([A-Z]{1,3})\$?([1-9][0-9]*)$/i;
const CELL_TOKEN_RE = /\$?[A-Z]{1,3}\$?[1-9][0-9]*/gi;
const GENERIC_ELEMENT_RE = /\b[a-z][a-z0-9_]*__[a-z][a-z0-9_]*\b/gi;
const FORMULA_ERROR_RE = /#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!|CYCLE!|ERROR!)/i;
const TARGET_CONTEXT_RE = /\b(?:set|write|fill|populate|place|put|output|return|display|configure|correct|fix|repair|change|replace|calculate|formula|result|target|cells?|range|column)\b/i;
const DEPENDENCY_CONTEXT_RE = /\b(?:from|source|input|criteria|based\s+on|using|lookup|match|reference|corresponding|depends?\s+on)\b/i;
const MUTATING_TASK_RE = /\b(?:audit|fix|repair|change|set|fill|populate|write|create|add|replace|delete|configure|correct|calculate|return|display|extract|sort|filter|format|highlight|apply|complete|update)\b/i;
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
  const normalized = formula?.trim().replace(/^=/, "").replace(/\s+/g, "");
  return normalized || undefined;
}

export function extractWorkbookTaskReferences(instruction: string, sheetNames: string[] = []): WorkbookTaskReference[] {
  const references: WorkbookTaskReference[] = [];
  const occupied = new Set<string>();
  const sheetByLower = new Map(sheetNames.map((sheet) => [sheet.toLowerCase(), sheet]));
  const sheetPattern = /(?:'([^']+)'|([A-Za-z0-9_. -]+))!\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*)(?:\s*(?::|-|\bto\b)\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*))?/gi;
  for (const match of instruction.matchAll(sheetPattern)) {
    const sourceText = match[0];
    const rawSheet = (match[1] ?? match[2] ?? "").trim();
    const sheet = sheetByLower.get(rawSheet.toLowerCase()) ?? rawSheet;
    const start = normalizeAddress(match[3]);
    const end = normalizeAddress(match[4] ?? match[3]);
    references.push({ sheet, start, end, sourceText, role: referenceRole(instruction, match.index ?? 0, sourceText.length) });
    for (let index = match.index ?? 0; index < (match.index ?? 0) + sourceText.length; index += 1) occupied.add(String(index));
  }

  const rangePattern = /(\$?[A-Z]{1,3}\$?[1-9][0-9]*)(?:\s*(?::|-|\bto\b)\s*(\$?[A-Z]{1,3}\$?[1-9][0-9]*))?/gi;
  for (const match of instruction.matchAll(rangePattern)) {
    const index = match.index ?? 0;
    if (occupied.has(String(index))) continue;
    const start = normalizeAddress(match[1]);
    const end = normalizeAddress(match[2] ?? match[1]);
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

export function inspectWorkbookTask(args: {
  instruction: string;
  sheetNames: string[];
  cells: WorkbookObservedCell[];
  maxFindings?: number;
}): WorkbookTaskInspection {
  const maxFindings = Math.max(1, Math.min(args.maxFindings ?? 24, 100));
  const explicitReferences = extractWorkbookTaskReferences(args.instruction, args.sheetNames);
  const referencedSheets = args.sheetNames.filter((sheet) => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(sheet)}(?:$|[^a-z0-9])`, "i").test(args.instruction));
  const cellsByKey = new Map(args.cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const ranked = new Map<string, RankedCell>();
  const findings: WorkbookInspectionFinding[] = [];
  const formulaFillSuggestions: WorkbookTaskInspection["formulaFillSuggestions"] = [];
  const formulaRepairSuggestions: WorkbookTaskInspection["formulaRepairSuggestions"] = [];
  const valueSuggestions: WorkbookTaskInspection["valueSuggestions"] = [];
  const targetCandidates = new Map<string, { sheet: string; address: string; reason: string }>();
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

  for (const reference of explicitReferences) {
    const matchingSheets = reference.sheet
      ? args.sheetNames.filter((sheet) => sheet.toLowerCase() === reference.sheet!.toLowerCase())
      : referencedSheets.length === 1 ? referencedSheets : args.sheetNames;
    const addresses = expandReference(reference, 256);
    for (const sheet of matchingSheets) {
      for (const address of addresses) {
        const cell = cellsByKey.get(workbookCellKey(sheet, address));
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
    if (formula && formulaReferencesAddress(formula, cell.address)) {
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

  if (/\b(?:weekday|day\s+name|mon\b|wed\b)\b/i.test(args.instruction)) {
    for (const cell of args.cells) {
      const band = weekdayFormulaFillBand(cell, cellsByKey);
      if (band.length < 3) continue;
      for (const target of band) {
        addRank(target, 220, "formula_fill_band");
        addCandidate("target", target, `visible weekday labels form a contiguous formula-fill band anchored at ${cell.address}`);
      }
      findings.push({
        kind: "formula_fill_band",
        severity: "warning",
        sheet: cell.sheet,
        address: cell.address,
        relatedAddresses: band.filter((target) => target.address !== cell.address).map((target) => target.address),
        detail: `${cell.address} and ${band.length - 1} adjacent weekday-label cells sit directly above date inputs.`,
        recommendedAction: `Repair the anchor formula and fill the same relative TEXT formula across ${band[0].address}:${band.at(-1)!.address}; verify every target.`,
      });
      const sourceFormula = weekdayTextFormula(cell.formula!);
      const anchorPosition = parseAddress(cell.address)!;
      formulaFillSuggestions.push({
        sheet: cell.sheet,
        range: `${band[0].address}:${band.at(-1)!.address}`,
        anchorAddress: cell.address,
        sourceFormula,
        operations: band.map((target) => {
          const targetPosition = parseAddress(target.address)!;
          return {
            sheet: target.sheet,
            cell: target.address,
            formula: translateRelativeFormula(sourceFormula, targetPosition.row - anchorPosition.row, targetPosition.col - anchorPosition.col),
          };
        }),
      });
    }
  }

  const formulaBandAnalysis = analyzeFormulaBands(args.cells, addRank);
  findings.push(...formulaBandAnalysis.findings);
  const requireFormulaAnomalyRepairs = genericFormulaAuditTask(args.instruction);
  for (const suggestion of formulaBandAnalysis.suggestions) {
    formulaRepairSuggestions.push(suggestion);
    if (requireFormulaAnomalyRepairs) {
      addCandidate("target", cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell)) ?? {
        sheet: suggestion.sheet,
        address: suggestion.cell,
        value: "",
      }, `two-sided formula pattern agrees on ${suggestion.formula}`);
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

  for (const sheet of args.sheetNames) {
    const sheetCells = args.cells.filter((cell) => cell.sheet === sheet);
    const first = sheetCells[0];
    if (first) addRank(first, 25, "sheet_representative");
    const last = sheetCells.at(-1);
    if (last) addRank(last, 20, "sheet_extent");
  }

  const rankedCells = [...ranked.values()].sort((left, right) =>
    right.score - left.score || left.sheet.localeCompare(right.sheet) || compareAddresses(left.address, right.address));
  const boundedFindings = dedupeFindings(findings).slice(0, maxFindings);
  const recommendedReads = recommendedReadGroups(rankedCells.slice(0, 40));
  const allowEmptyPlan = EMPTY_PLAN_ALLOWED_RE.test(args.instruction);
  const mutatingTask = (MUTATING_TASK_RE.test(args.instruction) || IMPLICIT_ASSIGNMENT_RE.test(args.instruction))
    && !/\b(?:explain|describe|summari[sz]e)\s+only\b/i.test(args.instruction);

  return {
    schema: 1,
    mutatingTask,
    allowEmptyPlan,
    referencedSheets,
    explicitReferences,
    targetCandidates: [...targetCandidates.values()],
    dependencyCandidates: [...dependencyCandidates.values()],
    findings: boundedFindings,
    formulaFillSuggestions,
    formulaRepairSuggestions: dedupeFormulaRepairSuggestions(formulaRepairSuggestions).slice(0, 64),
    valueSuggestions,
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

function weekdayTextFormula(formula: string): string {
  const normalized = normalizeFormula(formula) ?? formula.trim().replace(/^=/, "");
  return normalized.replace(/(TEXT\([^,]+,")D{1,2}("\))$/i, "$1DDD$2");
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
}): WorkbookPlanVerification {
  const issues: WorkbookPlanIssue[] = [];
  const sheetByLower = new Map(args.sheetNames.map((sheet) => [sheet.toLowerCase(), sheet]));
  const cellsByKey = new Map(args.cells.map((cell) => [workbookCellKey(cell.sheet, cell.address), cell]));
  const coveredTargets = new Set<string>();
  const seenTargets = new Map<string, number>();
  const targetKeys = new Set(args.inspection.targetCandidates.map((target) => workbookCellKey(target.sheet, target.address)));
  const quotedFormulaTargets = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "formula_text_match")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  const formulaBandTargets = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "formula_fill_band")
    .flatMap((finding) => [finding.address, ...(finding.relatedAddresses ?? [])]
      .map((address) => workbookCellKey(finding.sheet, address))));
  const neighborFormulaTargets = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "named_target_neighbor_formula")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  const requiredTargetKeys = formulaBandTargets.size > 0
    ? formulaBandTargets
    : quotedFormulaTargets.size > 0
      ? quotedFormulaTargets
      : neighborFormulaTargets.size > 0 ? neighborFormulaTargets : targetKeys;

  if (args.operations.length === 0 && args.inspection.mutatingTask && !args.inspection.allowEmptyPlan && (targetKeys.size > 0 || args.inspection.findings.length > 0)) {
    issues.push({
      kind: "empty_mutating_plan",
      severity: "error",
      detail: "The task requests a workbook change but the plan contains no operations.",
      repair: "Use the ranked target cells and findings to produce the smallest justified edit plan.",
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
      if (formulaReferencesAddress(proposedFormula, address)) {
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
  }

  const missingTargets = [...requiredTargetKeys].filter((key) => !coveredTargets.has(key));
  if (missingTargets.length > 0 && args.operations.some((operation) => !operation.op || operation.op === "set_cell")) {
    issues.push({
      kind: "missing_target_coverage",
      severity: "error",
      detail: `The plan covers ${coveredTargets.size}/${requiredTargetKeys.size} required task targets and omits ${missingTargets.length}.`,
      repair: formulaBandTargets.size > 0
        ? `Return a complete replacement plan for the visible formula-fill band: ${missingTargets.slice(0, 16).join(", ")}${missingTargets.length > 16 ? ` and ${missingTargets.length - 16} more` : ""}.`
        : quotedFormulaTargets.size > 0
        ? `The task quotes the formula currently stored at ${args.inspection.findings.filter((finding) => finding.kind === "formula_text_match").map((finding) => `${finding.sheet}!${finding.address}`).join(", ")}; repair that formula cell rather than its input.`
        : `Inspect these target candidates before retrying: ${args.inspection.targetCandidates.slice(0, 8).map((target) => `${target.sheet}!${target.address}`).join(", ")}.`,
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
    if (!target.formula && !/^(?:M|MO|MON|MONDAY|TU|TUE|TUESDAY|W|WED|WEDNESDAY|TH|THU|THURSDAY|F|FRI|FRIDAY|S|SA|SAT|SATURDAY|SU|SUN|SUNDAY)$/i.test(label)) return undefined;
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
  if (band.filter((cell) => cell.address !== anchor.address && !cell.formula).length < 2) return [];
  return band;
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
    if (actualFormula && FORMULA_ERROR_RE.test(actualFormula)) issues.push("formula_ref_error");
    return {
      ...check,
      ok: issues.length === 0,
      actualValue,
      ...(actualFormula ? { actualFormula } : {}),
      ...(cell?.numFmt ? { actualNumFmt: cell.numFmt } : {}),
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
      allowBlank: operation.value === null,
    }];
  });
}

function referenceRole(instruction: string, index: number, length: number): WorkbookReferenceRole {
  const before = instruction.slice(Math.max(0, index - 90), index);
  const after = instruction.slice(index + length, Math.min(instruction.length, index + length + 90));
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

function expandReference(reference: WorkbookTaskReference, limit: number): string[] {
  const start = parseAddress(reference.start);
  const end = parseAddress(reference.end);
  if (!start || !end) return [reference.start];
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const count = (maxRow - minRow + 1) * (maxCol - minCol + 1);
  if (count > limit) {
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
    const byAddress = new Map(sheetCells.map((cell) => [normalizeAddress(cell.address), cell]));
    const formulas = sheetCells.filter((cell) => !!normalizeFormula(cell.formula) && !!parseAddress(cell.address));
    const rowGroups = groupByMap(formulas, (cell) => parseAddress(cell.address)!.row);
    const colGroups = groupByMap(formulas, (cell) => parseAddress(cell.address)!.col);
    for (const group of [...rowGroups.values(), ...colGroups.values()]) {
      const horizontal = group.length > 1 && parseAddress(group[0].address)!.row === parseAddress(group[1].address)!.row;
      const sorted = [...group].sort((left, right) => {
        const a = parseAddress(left.address)!;
        const b = parseAddress(right.address)!;
        return horizontal ? a.col - b.col : a.row - b.row;
      });
      for (let index = 0; index < sorted.length - 1; index += 1) {
        const left = parseAddress(sorted[index].address)!;
        const right = parseAddress(sorted[index + 1].address)!;
        const gap = horizontal ? right.col - left.col : right.row - left.row;
        if (gap !== 2) continue;
        const middleAddress = horizontal
          ? addressFromPosition(left.row, left.col + 1)
          : addressFromPosition(left.row + 1, left.col);
        const middle = byAddress.get(middleAddress);
        if (middle?.formula) continue;
        if (!middle && !horizontal) {
          const middleRow = parseAddress(middleAddress)!.row;
          if (!sheetCells.some((candidate) => parseAddress(candidate.address)?.row === middleRow)) continue;
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
        if (agreedFormula && !FORMULA_ERROR_RE.test(agreedFormula) && !formulaReferencesAddress(agreedFormula, middleAddress)) {
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
      const pos = parseAddress(cell.address)!;
      const horizontalNeighbors = [byAddress.get(addressFromPosition(pos.row, pos.col - 1)), byAddress.get(addressFromPosition(pos.row, pos.col + 1))];
      if (!horizontalNeighbors[0]?.formula || !horizontalNeighbors[1]?.formula) continue;
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
        && !formulaReferencesAddress(consensus.formula, cell.address)
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
  if (["formula_error", "formula_self_reference", "formula_text_match", "formula_fill_band", "implicit_assignment_target"].includes(kind)) return 5;
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
