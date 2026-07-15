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
  | "named_year_target_band"
  | "semantic_formula_target"
  | "formula_range_anomaly"
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
  mutatingTask: boolean;
  allowEmptyPlan: boolean;
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

export type WorkbookSuggestedPlanOperation = {
  elementId: string;
  formula?: string;
  value?: string | number | boolean;
  numFmt?: string;
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
  | "unsafe_lookup_bounds"
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
  const normalized = formula?.trim().replace(/^=/, "").replace(/\s+/g, "");
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
    && (left.numFmt ?? "") === (right.numFmt ?? "");
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
  findings.push(...formulaBandAnalysis.findings.filter((finding) =>
    !weekdayTargetKeys.has(workbookCellKey(finding.sheet, finding.address))));
  const requireFormulaAnomalyRepairs = genericFormulaAuditTask(args.instruction);
  for (const suggestion of formulaBandAnalysis.suggestions) {
    if (weekdayTargetKeys.has(workbookCellKey(suggestion.sheet, suggestion.cell))) continue;
    formulaRepairSuggestions.push(suggestion);
    if (requireFormulaAnomalyRepairs) {
      addCandidate("target", cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell)) ?? {
        sheet: suggestion.sheet,
        address: suggestion.cell,
        value: "",
      }, `two-sided formula pattern agrees on ${suggestion.formula}`);
    }
  }

  const averageRangeAnalysis = analyzeAverageFormulaRanges(args.instruction, args.cells, addRank);
  findings.push(...averageRangeAnalysis.findings);
  for (const suggestion of averageRangeAnalysis.suggestions) {
    const key = workbookCellKey(suggestion.sheet, suggestion.cell);
    for (let index = formulaRepairSuggestions.length - 1; index >= 0; index -= 1) {
      const current = formulaRepairSuggestions[index];
      if (workbookCellKey(current.sheet, current.cell) === key) formulaRepairSuggestions.splice(index, 1);
    }
    formulaRepairSuggestions.push(suggestion);
    addCandidate("target", cellsByKey.get(workbookCellKey(suggestion.sheet, suggestion.cell)) ?? {
      sheet: suggestion.sheet,
      address: suggestion.cell,
      value: "",
    }, suggestion.evidence.join("; "));
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

  const rankedCells = [...ranked.values()].sort((left, right) =>
    right.score - left.score || left.sheet.localeCompare(right.sheet) || compareAddresses(left.address, right.address));
  const boundedFindings = dedupeFindings(findings).slice(0, maxFindings);
  const recommendedReads = recommendedReadGroups(rankedCells.slice(0, 40));
  const allowEmptyPlan = EMPTY_PLAN_ALLOWED_RE.test(args.instruction);
  const mutatingTask = (MUTATING_TASK_RE.test(args.instruction) || METHOD_MUTATING_TASK_RE.test(args.instruction) || IMPLICIT_ASSIGNMENT_RE.test(args.instruction))
    && !/\b(?:explain|describe|summari[sz]e)\s+only\b/i.test(args.instruction);

  return {
    schema: 1,
    mutatingTask,
    allowEmptyPlan,
    referencedSheets,
    explicitReferences,
    targetCandidates: [...targetCandidates.values()],
    blockedTargets,
    targetBands: [...targetBands.values()],
    dependencyCandidates: [...dependencyCandidates.values()],
    findings: boundedFindings,
    formulaFillSuggestions: dedupeFormulaFillSuggestions(formulaFillSuggestions),
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
  const formulaRangeTargets = new Set(args.inspection.findings
    .filter((finding) => finding.kind === "formula_range_anomaly")
    .map((finding) => workbookCellKey(finding.sheet, finding.address)));
  const strongTargetKeys = new Set([
    ...targetBandTargets,
    ...formulaBandTargets,
    ...quotedFormulaTargets,
    ...neighborFormulaTargets,
    ...formulaRangeTargets,
  ]);
  const requiredTargetKeys = strongTargetKeys.size > 0 ? strongTargetKeys : targetKeys;
  const semanticRuleByTarget = new Map<string, WorkbookSemanticFormulaRule>();
  const semanticDependencyFormulaByTarget = new Map<string, { rule: WorkbookSemanticFormulaRule; formula: string }>();
  const formulaRangeRepairByTarget = new Map<string, string>();
  const formulaFillByTarget = new Map<string, string>();
  const conflictingFormulaFillTargets = new Set<string>();
  const valueSuggestionByTarget = new Map<string, WorkbookTaskInspection["valueSuggestions"][number]>();
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
    if (sourceAddresses.length < 2 || sourceAddresses.length > 512) continue;

    let selectedAddresses = longestAggregateRun(
      sourceAddresses,
      parsed.sourceSheet,
      cellsByKey,
    );
    const evidence: string[] = [];
    if (selectedAddresses.length >= 2 && selectedAddresses.length < sourceAddresses.length) {
      const excluded = sourceAddresses.filter((address) => !selectedAddresses.includes(address));
      evidence.push(
        `${parsed.sourceSheet}!${parsed.start}:${parsed.end} crosses blank or nonnumeric cells; the longest contiguous visible aggregate block is ${selectedAddresses[0]}:${selectedAddresses.at(-1)!}`,
        `excluded cells: ${excluded.join(", ")}`,
      );
    } else {
      selectedAddresses = sourceAddresses;
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
