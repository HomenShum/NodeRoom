import { describe, expect, it } from "vitest";
import {
  checksForWorkbookOperations,
  extractWorkbookTaskReferences,
  inspectWorkbookTask,
  selectWorkbookTaskCells,
  verifyWorkbookPlan,
  verifyWorkbookValues,
  type WorkbookObservedCell,
} from "../src/nodeagent/skills/spreadsheet/workbookTaskIntelligence";

describe("workbook task intelligence", () => {
  it("extracts bounded targets and dependencies from a formula task", () => {
    const references = extractWorkbookTaskReferences(
      "Fill J15:J17 with PASS/FAIL using B15:B17 and the moisture limits in I3 and J3 on Sheet1.",
      ["Sheet1"],
    );

    expect(references.map((reference) => `${reference.start}:${reference.end}`)).toEqual(expect.arrayContaining([
      "J15:J17",
      "B15:B17",
      "I3:I3",
      "J3:J3",
    ]));
    expect(references.find((reference) => reference.start === "J15")?.role).toBe("target");
  });

  it("selects the quoted formula cell and its input even under a starved snapshot cap", () => {
    const cells: WorkbookObservedCell[] = [
      ...Array.from({ length: 20 }, (_, index) => ({ sheet: "ATTENDENCE", address: `${String.fromCharCode(65 + index)}2`, value: "period" })),
      { sheet: "ATTENDENCE", address: "F3", value: 21, formula: 'TEXT(F4,"DD")' },
      { sheet: "ATTENDENCE", address: "F4", value: "2015-10-20" },
      { sheet: "ATTENDENCE", address: "G3", value: "TU" },
      { sheet: "ATTENDENCE", address: "G4", value: "2015-10-21" },
    ];
    const instruction = "The wrong formula is TEXT(F4,\"DD\"). Correct it so the weekday appears like the adjacent cells.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });
    const selected = selectWorkbookTaskCells({ inspection, cells, maxCells: 4 });

    expect(inspection.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "formula_text_match", sheet: "ATTENDENCE", address: "F3" }),
    ]));
    expect(selected.map((cell) => cell.address)).toContain("F3");
    expect(selected.map((cell) => cell.address)).toContain("F4");
  });

  it("expands a requested financial metric into its year-band calculation context", () => {
    const cells: WorkbookObservedCell[] = [
      ...Array.from({ length: 30 }, (_, index) => ({ sheet: "Valuation", address: `A${index + 1}`, value: `unrelated ${index}` })),
      { sheet: "Valuation", address: "B40", value: "Year" },
      { sheet: "Valuation", address: "C40", value: "2026E" },
      { sheet: "Valuation", address: "D40", value: "2027E" },
      { sheet: "Valuation", address: "B41", value: "Terminal Value" },
      { sheet: "Valuation", address: "C41", value: 100, formula: "C39*(1+$C$5)/($C$4-$C$5)" },
      { sheet: "Valuation", address: "D41", value: 110, formula: "D39*(1+$C$5)/($C$4-$C$5)" },
      { sheet: "Valuation", address: "B42", value: "Present Value" },
      { sheet: "Valuation", address: "C42", value: 90, formula: "C41*C38" },
      { sheet: "Valuation", address: "D42", value: 95, formula: "D41*D38" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "In the Valuation sheet, calculate Terminal Value and Present Value for 2026E-2027E.",
      sheetNames: ["Valuation"],
      cells,
    });
    const selected = selectWorkbookTaskCells({ inspection, cells, maxCells: 9 });

    expect(selected.map((cell) => cell.address)).toEqual(expect.arrayContaining(["B41", "C41", "D41", "B42", "C42", "D42"]));
    expect(inspection.recommendedReads[0]?.reason).toContain("calculation_row_context");
  });

  it("finds hardcodes, blanks, and relative formula outliers inside formula bands", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 2, formula: "A2*2" },
      { sheet: "Model", address: "C2", value: 999 },
      { sheet: "Model", address: "D2", value: 6, formula: "C2*2" },
      { sheet: "Model", address: "E2", value: 12, formula: "D2*2" },
      { sheet: "Model", address: "B4", value: 4, formula: "A4*2" },
      { sheet: "Model", address: "D4", value: 8, formula: "C4*2" },
      { sheet: "Model", address: "E4", value: 16, formula: "D4*2" },
      { sheet: "Model", address: "B6", value: 4, formula: "A6*2" },
      { sheet: "Model", address: "C6", value: 400, formula: "A1*100" },
      { sheet: "Model", address: "D6", value: 8, formula: "C6*2" },
      { sheet: "Model", address: "E6", value: 16, formula: "D6*2" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit and fix formula inconsistencies in this workbook.",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "hardcoded_in_formula_band", address: "C2" }),
      expect.objectContaining({ kind: "blank_in_formula_band", address: "C4" }),
      expect.objectContaining({ kind: "formula_pattern_outlier", address: "C6" }),
    ]));
    expect(inspection.formulaRepairSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "fill_gap", cell: "C2", formula: "B2*2", evidence: ["B2", "D2", "E2"] }),
      expect.objectContaining({ kind: "fill_gap", cell: "C4", formula: "B4*2", evidence: ["B4", "D4", "E4"] }),
      expect.objectContaining({ kind: "replace_outlier", cell: "C6", formula: "B6*2", evidence: ["B6", "D6", "E6"] }),
    ]));
  });

  it("uses two-sided horizontal consensus without treating semantic rows as vertical outliers", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 20, formula: "B1*2" },
      { sheet: "Model", address: "C2", value: 999, formula: "A1*100" },
      { sheet: "Model", address: "D2", value: 40, formula: "D1*2" },
      { sheet: "Model", address: "C1", value: 10, formula: "CHOOSE($A$1,C5,C6,C7)" },
      { sheet: "Model", address: "C3", value: 30, formula: "CHOOSE($A$1,C8,C9,C10)" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit and fix formula inconsistencies in this workbook.",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions).toContainEqual(expect.objectContaining({
      kind: "replace_outlier",
      cell: "C2",
      formula: "C1*2",
      evidence: ["B2", "D2"],
    }));
    expect(inspection.findings.filter((finding) => finding.kind === "formula_pattern_outlier")).toHaveLength(1);
  });

  it("binds an implicit percentage assignment to a named row and visible year headers", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Revenue_Projection", address: "B30", value: "Line Item" },
      { sheet: "Revenue_Projection", address: "D30", value: "Year 1" },
      { sheet: "Revenue_Projection", address: "E30", value: "Year 2" },
      { sheet: "Revenue_Projection", address: "F30", value: "Year 3" },
      { sheet: "Revenue_Projection", address: "G30", value: "Year 4" },
      { sheet: "Revenue_Projection", address: "H30", value: "Year 5" },
      { sheet: "Revenue_Projection", address: "B34", value: "Concessions" },
      { sheet: "Revenue_Projection", address: "C34", value: "Calculated" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Concessions are 0% in Years 3-5.",
      sheetNames: ["Revenue_Projection"],
      cells,
    });
    const selected = selectWorkbookTaskCells({ inspection, cells, maxCells: 12 });

    expect(inspection.mutatingTask).toBe(true);
    expect(inspection.valueSuggestions).toEqual([
      expect.objectContaining({ sheet: "Revenue_Projection", cell: "F34", value: 0, numFmt: "0.0%" }),
      expect.objectContaining({ sheet: "Revenue_Projection", cell: "G34", value: 0, numFmt: "0.0%" }),
      expect.objectContaining({ sheet: "Revenue_Projection", cell: "H34", value: 0, numFmt: "0.0%" }),
    ]);
    expect(inspection.targetCandidates.map((target) => target.address)).toEqual(["F34", "G34", "H34"]);
    expect(selected.map((cell) => cell.address)).toEqual(expect.arrayContaining(["F34", "G34", "H34"]));
  });

  it("rejects a plausible but wrong input-cell edit and accepts the formula-cell repair", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "ATTENDENCE", address: "F3", value: 21, formula: 'TEXT(F4,"DD")' },
      { sheet: "ATTENDENCE", address: "F4", value: "2015-10-20" },
      { sheet: "ATTENDENCE", address: "G3", value: "TU" },
    ];
    const instruction = "The wrong formula is TEXT(F4,\"DD\"). Correct it to return a weekday abbreviation.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });

    const wrong = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: [{ sheet: "ATTENDENCE", cell: "F4", formula: 'TEXT(F4,"ddd")' }],
    });
    expect(wrong.status).toBe("needs_repair");
    expect(wrong.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining(["formula_self_reference", "missing_target_coverage"]));

    const repaired = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: [{ sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"ddd")', result: "Tue" }],
    });
    expect(repaired.status).toBe("passed");
  });

  it("protects existing formulas from scalar overwrite unless explicitly requested", () => {
    const cells: WorkbookObservedCell[] = [{ sheet: "Model", address: "C2", value: 20, formula: "A2+B2" }];
    const instruction = "Audit and fix calculation errors in C2.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });
    const verification = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Model"],
      operations: [{ sheet: "Model", cell: "C2", value: 20 }],
    });

    expect(verification.status).toBe("needs_repair");
    expect(verification.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "formula_to_scalar_overwrite", address: "C2" }),
    ]));
  });

  it("requires complete coverage of a visible weekday formula-fill band", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "ATTENDENCE", address: "F3", value: "21", formula: 'TEXT(F4,"DD")' },
      { sheet: "ATTENDENCE", address: "F4", value: "2015-10-21" },
      { sheet: "ATTENDENCE", address: "G3", value: "TH" },
      { sheet: "ATTENDENCE", address: "G4", value: "2015-10-22" },
      { sheet: "ATTENDENCE", address: "H3", value: "F" },
      { sheet: "ATTENDENCE", address: "H4", value: "2015-10-23" },
      { sheet: "ATTENDENCE", address: "I3", value: "S" },
      { sheet: "ATTENDENCE", address: "I4", value: "2015-10-24" },
    ];
    const instruction = 'Correct the weekday formula TEXT(F4,"DD") so the weekday names display like Mon and Wed.';
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });

    expect(inspection.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "formula_fill_band", address: "F3", relatedAddresses: ["G3", "H3", "I3"] }),
    ]));
    expect(inspection.formulaFillSuggestions).toEqual([expect.objectContaining({
      range: "F3:I3",
      sourceFormula: 'TEXT(F4,"DDD")',
      operations: [
        { sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"DDD")' },
        { sheet: "ATTENDENCE", cell: "G3", formula: 'TEXT(G4,"DDD")' },
        { sheet: "ATTENDENCE", cell: "H3", formula: 'TEXT(H4,"DDD")' },
        { sheet: "ATTENDENCE", cell: "I3", formula: 'TEXT(I4,"DDD")' },
      ],
    })]);
    const partial = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: [{ sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"DDD")' }],
    });
    expect(partial.status).toBe("needs_repair");
    expect(partial.checks).toMatchObject({ targetCandidateCount: 4, coveredTargetCount: 1 });

    const complete = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: ["F", "G", "H", "I"].map((column) => ({
        sheet: "ATTENDENCE",
        cell: `${column}3`,
        formula: `TEXT(${column}4,"DDD")`,
      })),
    });
    expect(complete.status).toBe("passed");
  });

  it("re-reads value, formula, and number format checks into a repair receipt", () => {
    const operations = [{ sheet: "Model", cell: "C2", formula: "A2+B2", result: 30, numFmt: "$#,##0" }];
    const passed = verifyWorkbookValues({
      cells: [{ sheet: "Model", address: "C2", value: 30, formula: "A2+B2", numFmt: "$#,##0", version: 2 }],
      checks: checksForWorkbookOperations(operations),
    });
    expect(passed).toMatchObject({ status: "passed", checkedCount: 1, passedCount: 1, issueCount: 0 });

    const failed = verifyWorkbookValues({
      cells: [{ sheet: "Model", address: "C2", value: 30, formula: "A2-B2", numFmt: "General", version: 2 }],
      checks: checksForWorkbookOperations(operations),
    });
    expect(failed.status).toBe("needs_repair");
    expect(failed.repairPrompt).toContain("formula_mismatch");
    expect(failed.repairPrompt).toContain("number_format_mismatch");
  });
});
