import { describe, expect, it } from "vitest";
import {
  buildWorkbookSuggestedPlan,
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

  it("does not treat a same-address reference on another sheet as circular", () => {
    const inspection = inspectWorkbookTask({
      instruction: "Audit and fix formula inconsistencies in this workbook.",
      sheetNames: ["DCF", "Exhibit 5"],
      cells: [
        { sheet: "DCF", address: "C10", value: 100, formula: "+'Exhibit 5'!C10" },
        { sheet: "DCF", address: "C11", value: 100, formula: "C11+1" },
        { sheet: "DCF", address: "C12", value: 100, formula: "DCF!C12+1" },
      ],
    });

    const circularAddresses = inspection.findings
      .filter((finding) => finding.kind === "formula_self_reference")
      .map((finding) => finding.address);
    expect(circularAddresses).toEqual(["C11", "C12"]);
  });

  it("repairs average ranges from visible contiguous data and comparable-company headers", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "DCF", address: "F15", value: "" },
      { sheet: "DCF", address: "G15", value: 0.04, formula: "G14/G9*-1" },
      { sheet: "DCF", address: "H15", value: 0.05, formula: "H14/H9*-1" },
      { sheet: "DCF", address: "I15", value: 0.03, formula: "AVERAGE($F$15:$H$15)" },
      { sheet: "WACC", address: "C6", value: "Anadarko" },
      { sheet: "WACC", address: "D6", value: "Comparables" },
      { sheet: "WACC", address: "D7", value: 0.3, formula: "AVERAGE('Exhibit 6'!D36:J36)" },
      { sheet: "WACC", address: "D14", value: 0.08, formula: "AVERAGE('Exhibit 9'!M8:M26/100)" },
      { sheet: "Exhibit 6", address: "D5", value: "Anadarko" },
      ...["D", "E", "F", "G", "H", "I", "J"].map((column, index) => ({
        sheet: "Exhibit 6",
        address: `${column}36`,
        value: 0.1 + index / 100,
      })),
      ...Array.from({ length: 15 }, (_, index) => ({
        sheet: "Exhibit 9",
        address: `M${index + 8}`,
        value: 7 + index / 10,
      })),
      { sheet: "Exhibit 9", address: "M23", value: "" },
      { sheet: "Exhibit 9", address: "M24", value: "" },
      { sheet: "Exhibit 9", address: "M25", value: 7.3 },
      { sheet: "Exhibit 9", address: "M26", value: 8.7 },
    ];
    const instruction = "Please audit and fix this file thoroughly. Agent-visible input workbook name: 01-Incorrect Average_input.xlsx";
    const inspection = inspectWorkbookTask({
      instruction,
      sheetNames: ["DCF", "WACC", "Exhibit 6", "Exhibit 9"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheet: "DCF", cell: "I15", formula: "AVERAGE($G$15:$H$15)" }),
      expect.objectContaining({ sheet: "WACC", cell: "D7", formula: "AVERAGE('Exhibit 6'!E36:J36)" }),
      expect.objectContaining({ sheet: "WACC", cell: "D14", formula: "AVERAGE('Exhibit 9'!M8:M22/100)" }),
    ]));
    expect(inspection.findings.filter((finding) => finding.kind === "formula_range_anomaly")).toHaveLength(3);

    const wrong = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["DCF", "WACC", "Exhibit 6", "Exhibit 9"],
      operations: [
        { sheet: "DCF", cell: "I15", formula: "=AVERAGE($F$15:$H$15)" },
        { sheet: "WACC", cell: "D7", formula: "=AVERAGE('Exhibit 6'!D36:J36)" },
        { sheet: "WACC", cell: "D14", formula: "=AVERAGE('Exhibit 9'!M8:M26/100)" },
      ],
    });
    expect(wrong.status).toBe("needs_repair");
    expect(wrong.issues.filter((issue) => issue.kind === "formula_semantic_mismatch")).toHaveLength(3);

    const repaired = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["DCF", "WACC", "Exhibit 6", "Exhibit 9"],
      operations: [
        { sheet: "DCF", cell: "I15", formula: "=AVERAGE($G$15:$H$15)" },
        { sheet: "WACC", cell: "D7", formula: "=AVERAGE('Exhibit 6'!E36:J36)" },
        { sheet: "WACC", cell: "D14", formula: "=AVERAGE('Exhibit 9'!M8:M22/100)" },
      ],
    });
    expect(repaired.status).toBe("passed");
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

  it("rejects shifted prior-period forecast formulas and provides the visible repair references", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "WC_Forecast", address: "B15", value: "Cash & Equivalents" },
      { sheet: "WC_Forecast", address: "C15", value: 100 },
      { sheet: "WC_Forecast", address: "D15", value: "" },
      { sheet: "WC_Forecast", address: "B30", value: "Changes in Working Capital" },
      { sheet: "WC_Forecast", address: "C30", value: -10 },
      { sheet: "WC_Forecast", address: "D30", value: 5 },
      { sheet: "WC_Forecast", address: "B28", value: "Statement of Cash Flows" },
      { sheet: "WC_Forecast", address: "C28", value: "" },
      { sheet: "WC_Forecast", address: "D28", value: "" },
      { sheet: "WC_Forecast", address: "E28", value: "" },
      { sheet: "WC_Forecast", address: "F28", value: "" },
    ];
    const instruction = "Forecast Cash as prior period Cash plus Changes in Working Capital.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["WC_Forecast"], cells });

    expect(inspection.mutatingTask).toBe(true);
    expect(inspection.targetCandidates).toContainEqual(expect.objectContaining({ address: "D15" }));
    expect(inspection.findings).toContainEqual(expect.objectContaining({
      kind: "semantic_formula_target",
      address: "D15",
    }));

    const shifted = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["WC_Forecast"],
      operations: [{ sheet: "WC_Forecast", cell: "D15", formula: "=B15+C30" }],
    });
    expect(shifted.status).toBe("needs_repair");
    expect(shifted.issues).toContainEqual(expect.objectContaining({
      kind: "formula_semantic_mismatch",
      address: "D15",
      repair: expect.stringContaining("=C15+D30"),
    }));

    const aligned = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["WC_Forecast"],
      operations: [{ sheet: "WC_Forecast", cell: "D15", formula: "=C15+D30" }],
    });
    expect(aligned.status).toBe("passed");

    const postWriteCells = cells.map((cell) => cell.address === "D15"
      ? { ...cell, value: 105, formula: "C15+D30" }
      : cell);
    const postWriteInspection = inspectWorkbookTask({ instruction, sheetNames: ["WC_Forecast"], cells: postWriteCells });
    expect(postWriteInspection.targetCandidates).toContainEqual(expect.objectContaining({ address: "D15" }));
    expect(verifyWorkbookPlan({
      instruction,
      inspection: postWriteInspection,
      cells: postWriteCells,
      sheetNames: ["WC_Forecast"],
      operations: [{ sheet: "WC_Forecast", cell: "D15", formula: "=C15+D30" }],
    }).status).toBe("passed");
  });

  it("requires quarterly average-balance formulas instead of hardcoded interest expense", () => {
    const cells: WorkbookObservedCell[] = [
      ...["Q1", "Q2", "Q3", "Q4"].map((value, index) => ({
        sheet: "DebtWaterfall",
        address: `${String.fromCharCode(66 + index)}2`,
        value,
      })),
      { sheet: "DebtWaterfall", address: "A9", value: "Beginning Balance" },
      ...[3_800, 3_000, 2_100, 1_200].map((value, index) => ({ sheet: "DebtWaterfall", address: `${String.fromCharCode(66 + index)}9`, value })),
      { sheet: "DebtWaterfall", address: "A11", value: "Ending Balance" },
      ...[3_000, 2_100, 1_200, 0].map((value, index) => ({ sheet: "DebtWaterfall", address: `${String.fromCharCode(66 + index)}11`, value })),
      { sheet: "DebtWaterfall", address: "A12", value: "Interest Rate" },
      ...Array.from({ length: 4 }, (_, index) => ({ sheet: "DebtWaterfall", address: `${String.fromCharCode(66 + index)}12`, value: 0.062 })),
      { sheet: "DebtWaterfall", address: "A13", value: "Interest Expense" },
      ...Array.from({ length: 4 }, (_, index) => ({ sheet: "DebtWaterfall", address: `${String.fromCharCode(66 + index)}13`, value: "" })),
    ];
    const instruction = "Use the average balance method for interest expense.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["DebtWaterfall"], cells });

    expect(inspection.mutatingTask).toBe(true);
    expect(inspection.targetBands).toContainEqual(expect.objectContaining({
      source: "calculation_method",
      range: "B13:E13",
    }));

    const hardcoded = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["DebtWaterfall"],
      operations: ["B", "C", "D", "E"].map((column) => ({ sheet: "DebtWaterfall", cell: `${column}13`, value: 25 })),
    });
    expect(hardcoded.status).toBe("needs_repair");
    expect(hardcoded.issues.filter((issue) => issue.kind === "formula_semantic_mismatch")).toHaveLength(4);

    const formulas = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["DebtWaterfall"],
      operations: ["B", "C", "D", "E"].map((column) => ({
        sheet: "DebtWaterfall",
        cell: `${column}13`,
        formula: `=AVERAGE(${column}9,${column}11)*${column}12/4`,
      })),
    });
    expect(formulas.status).toBe("passed");
  });

  it("treats an FY column after Q4 as the endpoint of a point-in-time forecast", () => {
    const cells: WorkbookObservedCell[] = [
      ...["Q1 2025E", "Q2 2025E", "Q3 2025E", "Q4 2025E", "FY 2025E"].map((value, index) => ({
        sheet: "WC_Forecast",
        address: `${String.fromCharCode(68 + index)}6`,
        value,
      })),
      { sheet: "WC_Forecast", address: "B15", value: "Cash & Equivalents" },
      { sheet: "WC_Forecast", address: "E15", value: 5_620 },
      { sheet: "WC_Forecast", address: "F15", value: "" },
      { sheet: "WC_Forecast", address: "G15", value: "" },
      { sheet: "WC_Forecast", address: "H15", value: "" },
      { sheet: "WC_Forecast", address: "B30", value: "Changes in Working Capital" },
      { sheet: "WC_Forecast", address: "F30", value: -1_180 },
      { sheet: "WC_Forecast", address: "G30", value: 250 },
      { sheet: "WC_Forecast", address: "H30", value: -930 },
    ];
    const instruction = "Forecast Cash as prior period Cash plus Changes in Working Capital.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["WC_Forecast"], cells });
    const baseOperations = [
      { sheet: "WC_Forecast", cell: "F15", formula: "=E15+F30" },
      { sheet: "WC_Forecast", cell: "G15", formula: "=F15+G30" },
    ];

    const doubleCounted = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["WC_Forecast"],
      operations: [...baseOperations, { sheet: "WC_Forecast", cell: "H15", formula: "=G15+H30" }],
    });
    expect(doubleCounted.status).toBe("needs_repair");
    expect(doubleCounted.issues).toContainEqual(expect.objectContaining({
      kind: "formula_semantic_mismatch",
      address: "H15",
      repair: expect.stringContaining("=G15"),
    }));

    const endpoint = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["WC_Forecast"],
      operations: [...baseOperations, { sheet: "WC_Forecast", cell: "H15", formula: "=G15" }],
    });
    expect(endpoint.status).toBe("passed");
  });

  it("extends a visible dependency formula pattern before forecasting its dependent row", () => {
    const cells: WorkbookObservedCell[] = [
      ...["Q1 2025E", "Q2 2025E", "Q3 2025E", "Q4 2025E", "FY 2025E"].map((value, index) => ({
        sheet: "WC_Forecast",
        address: `${String.fromCharCode(68 + index)}6`,
        value,
      })),
      { sheet: "WC_Forecast", address: "B15", value: "Cash & Equivalents" },
      { sheet: "WC_Forecast", address: "E15", value: 5_620 },
      ...["F15", "G15", "H15"].map((address) => ({ sheet: "WC_Forecast", address, value: "" })),
      { sheet: "WC_Forecast", address: "B30", value: "Changes in Working Capital" },
      { sheet: "WC_Forecast", address: "D30", value: -1_180, formula: "-(D17-C17)-(D20-C20)-(D23-C23)+(D25-C25)" },
      { sheet: "WC_Forecast", address: "E30", value: -4_430, formula: "-(E17-D17)-(E20-D20)-(E23-D23)+(E25-D25)" },
      ...["F30", "G30", "H30"].map((address) => ({ sheet: "WC_Forecast", address, value: "" })),
    ];
    const instruction = "Forecast Cash as prior period Cash plus Changes in Working Capital.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["WC_Forecast"], cells });

    expect(inspection.targetBands).toEqual(expect.arrayContaining([
      expect.objectContaining({ range: "F15:H15", source: "semantic_relation" }),
      expect.objectContaining({ range: "F30:H30", source: "semantic_relation" }),
    ]));

    const cashOperations = [
      { sheet: "WC_Forecast", cell: "F15", formula: "=E15+F30" },
      { sheet: "WC_Forecast", cell: "G15", formula: "=F15+G30" },
      { sheet: "WC_Forecast", cell: "H15", formula: "=G15" },
    ];
    const hardcodedDependencies = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["WC_Forecast"],
      operations: [
        ...cashOperations,
        ...["F30", "G30", "H30"].map((cell) => ({ sheet: "WC_Forecast", cell, value: 0 })),
      ],
    });
    expect(hardcodedDependencies.status).toBe("needs_repair");
    expect(hardcodedDependencies.issues.filter((issue) => issue.kind === "formula_semantic_mismatch")).toHaveLength(3);

    const completedDependencies = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["WC_Forecast"],
      operations: [
        ...cashOperations,
        { sheet: "WC_Forecast", cell: "F30", formula: "=-(F17-E17)-(F20-E20)-(F23-E23)+(F25-E25)" },
        { sheet: "WC_Forecast", cell: "G30", formula: "=-(G17-F17)-(G20-F20)-(G23-F23)+(G25-F25)" },
        { sheet: "WC_Forecast", cell: "H30", formula: "=SUM(D30:G30)" },
      ],
    });
    expect(completedDependencies.status).toBe("passed");
  });

  it("builds and enforces a complete multi-tranche debt-waterfall formula contract", () => {
    const cells: WorkbookObservedCell[] = [];
    const addRow = (row: number, label: string, values: unknown[]) => {
      cells.push({ sheet: "DebtWaterfall", address: `A${row}`, value: label });
      values.forEach((value, index) => cells.push({ sheet: "DebtWaterfall", address: `${String.fromCharCode(66 + index)}${row}`, value }));
    };
    ["Q1", "Q2", "Q3", "Q4"].forEach((value, index) => cells.push({ sheet: "DebtWaterfall", address: `${String.fromCharCode(66 + index)}2`, value }));
    addRow(4, "Cash Flow Available", [950, 1_050, 825, 980]);
    addRow(5, "Required Operating Cash", [150, 160, 155, 165]);
    addRow(6, "Available for Debt Repayment", ["", "", "", ""]);
    addRow(9, "Beginning Balance", [3_800, "", "", ""]);
    addRow(10, "Repayment", [-800, "", "", ""]);
    addRow(11, "Ending Balance", ["", "", "", ""]);
    addRow(12, "Interest Rate", [0.062, 0.062, 0.062, 0.062]);
    addRow(13, "Interest Expense", ["", "", "", ""]);
    addRow(16, "Beginning Balance", [1_200, "", "", ""]);
    addRow(17, "Repayment", ["", "", "", ""]);
    addRow(18, "Ending Balance", ["", "", "", ""]);
    addRow(19, "Interest Rate", [0.095, 0.095, 0.095, 0.095]);
    addRow(20, "Interest Expense", ["", "", "", ""]);
    addRow(23, "Total Debt Outstanding", ["", "", "", ""]);
    addRow(24, "Total Interest Expense", ["", "", "", ""]);
    addRow(25, "Cash Remaining", ["", "", "", ""]);
    const instruction = "Use the average balance method for interest expense.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["DebtWaterfall"], cells });
    const contract = inspection.formulaFillSuggestions.find((suggestion) => suggestion.operations.length === 46);
    const compactPlan = buildWorkbookSuggestedPlan(inspection, "DebtWaterfall");

    expect(contract).toBeDefined();
    expect(compactPlan).toMatchObject({ conflicts: [], operations: expect.any(Array) });
    expect(compactPlan.operations).toHaveLength(46);
    expect(contract?.operations).toEqual(expect.arrayContaining([
      { sheet: "DebtWaterfall", cell: "B6", formula: "B4-B5" },
      { sheet: "DebtWaterfall", cell: "B10", formula: "-MIN(B6,B9)" },
      { sheet: "DebtWaterfall", cell: "B13", formula: "B12*AVERAGE(B9,B11)" },
      { sheet: "DebtWaterfall", cell: "B17", formula: "-MAX(0,MIN(B6+B10,B16))" },
      { sheet: "DebtWaterfall", cell: "E25", formula: "E6+E10+E17" },
    ]));
    const operations = contract!.operations.map((operation) => ({ sheet: operation.sheet, cell: operation.cell, formula: operation.formula }));
    const complete = verifyWorkbookPlan({ instruction, inspection, cells, sheetNames: ["DebtWaterfall"], operations });
    expect(complete.status, JSON.stringify(complete.issues)).toBe("passed");
    const wrong = operations.map((operation) => operation.cell === "B13" ? { ...operation, formula: "B12*AVERAGE(B9,B11)/4" } : operation);
    expect(verifyWorkbookPlan({ instruction, inspection, cells, sheetNames: ["DebtWaterfall"], operations: wrong }).issues).toContainEqual(expect.objectContaining({
      kind: "formula_semantic_mismatch",
      address: "B13",
      repair: "Use =B12*AVERAGE(B9,B11) in B13.",
    }));
  });

  it("builds the upstream quarterly formulas required by a working-capital cash forecast", () => {
    const cells: WorkbookObservedCell[] = [];
    const addRow = (row: number, label: string, values: unknown[], formulas: Array<string | undefined> = []) => {
      cells.push({ sheet: "WC_Forecast", address: `B${row}`, value: label });
      values.forEach((value, index) => cells.push({
        sheet: "WC_Forecast",
        address: `${String.fromCharCode(68 + index)}${row}`,
        value,
        ...(formulas[index] ? { formula: formulas[index] } : {}),
      }));
    };
    ["Q1 2025E", "Q2 2025E", "Q3 2025E", "Q4 2025E", "FY 2025E"].forEach((value, index) => cells.push({
      sheet: "WC_Forecast",
      address: `${String.fromCharCode(68 + index)}6`,
      value,
    }));
    addRow(9, "Revenue", [7_120, 7_350, "", "", ""]);
    addRow(10, "qoq growth", [-0.029, 0.033, 0.033, 0.033, ""]);
    addRow(11, "Cost of goods sold (incl. Depr)", [3_305, 4_175, "", "", ""]);
    addRow(12, "% of revenue", [0.464, 0.568, 0.55, 0.55, ""]);
    addRow(13, "Gross Margin", [3_815, 3_175, "", "", ""]);
    addRow(15, "Cash & Equivalents", [6_980, 5_620, "", "", ""]);
    addRow(17, "Accounts Receivable", [5_210, 4_890, "", "", ""]);
    addRow(18, "DSO (Days)", [66, 60, 57, 60, ""]);
    addRow(20, "Inventory", [6_140, 6_390, "", "", ""]);
    addRow(21, "Inventory Days", [169, 139, 160, 165, ""]);
    addRow(23, "Other Current Assets", [2_320, 6_550, 6_849, 6_849, ""]);
    addRow(25, "Current Liabilities", [6_190, 5_920, 5_920, 5_920, ""]);
    addRow(30, "Changes in Working Capital", [-1_180, -4_430, "", "", ""], [
      "-(D17-C17)-(D20-C20)-(D23-C23)+(D25-C25)",
      "-(E17-D17)-(E20-D20)-(E23-D23)+(E25-D25)",
    ]);
    const instruction = "Forecast Cash as prior period Cash plus Changes in Working Capital.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["WC_Forecast"], cells });
    const contract = inspection.formulaFillSuggestions.find((suggestion) => suggestion.operations.length === 26);

    expect(contract).toBeDefined();
    expect(contract?.operations).toEqual(expect.arrayContaining([
      { sheet: "WC_Forecast", cell: "F9", formula: "E9*(1+F10)" },
      { sheet: "WC_Forecast", cell: "H12", formula: "H11/H9" },
      { sheet: "WC_Forecast", cell: "F17", formula: "(F9/90)*F18" },
      { sheet: "WC_Forecast", cell: "H25", formula: "G25" },
      { sheet: "WC_Forecast", cell: "H30", formula: "SUM(D30:G30)" },
    ]));
    const operations = contract!.operations.map((operation) => ({ sheet: operation.sheet, cell: operation.cell, formula: operation.formula }));
    expect(verifyWorkbookPlan({ instruction, inspection, cells, sheetNames: ["WC_Forecast"], operations }).status).toBe("passed");
    const shifted = operations.map((operation) => operation.cell === "F15" ? { ...operation, formula: "D15+E30" } : operation);
    expect(verifyWorkbookPlan({ instruction, inspection, cells, sheetNames: ["WC_Forecast"], operations: shifted }).issues).toContainEqual(expect.objectContaining({
      kind: "formula_semantic_mismatch",
      address: "F15",
      repair: "Use =E15+F30 in F15.",
    }));
  });

  it("builds and enforces a complete book-versus-tax roll-forward for years 2-4", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "DeferredTax", address: "A4", value: "A software company recognizes revenue of $120 per year evenly over years 2-4." },
      { sheet: "DeferredTax", address: "C6", value: "Book Accounting" },
      { sheet: "DeferredTax", address: "H6", value: "Tax Accounting" },
      ...["Year 1", "Year 2", "Year 3", "Year 4"].map((value, index) => ({ sheet: "DeferredTax", address: `${String.fromCharCode(67 + index)}7`, value })),
      ...["Year 2", "Year 3", "Year 4"].map((value, index) => ({ sheet: "DeferredTax", address: `${String.fromCharCode(72 + index)}7`, value })),
    ];
    const addRow = (row: number, label: string, book: unknown[], tax: unknown[] = []) => {
      cells.push({ sheet: "DeferredTax", address: `B${row}`, value: label });
      book.forEach((value, index) => cells.push({ sheet: "DeferredTax", address: `${String.fromCharCode(67 + index)}${row}`, value, numFmt: "#,##0" }));
      tax.forEach((value, index) => cells.push({ sheet: "DeferredTax", address: `${String.fromCharCode(72 + index)}${row}`, value, numFmt: "#,##0" }));
    };
    addRow(8, "Revenue", ["", "", "", ""], [180, 120, 60]);
    addRow(9, "Operating expenses", ["", 50, 50, 50], [50, 50, 50]);
    addRow(10, "Pretax income", ["", "", "", ""]);
    addRow(11, "Income tax (35% rate)", ["", "", "", ""]);
    addRow(12, "Net income", ["", "", "", ""]);
    addRow(15, "Cash", [0, "", "", ""]);
    addRow(16, "Deferred tax assets", [0, "", "", ""]);
    addRow(17, "Equipment", [75, "", "", ""]);
    addRow(18, "Total assets", ["", "", "", ""]);
    addRow(20, "Debt", [30, "", "", ""]);
    addRow(21, "Deferred revenue", [0, "", "", ""]);
    addRow(22, "Deferred tax liabilities", [0, "", "", ""]);
    addRow(23, "Total liabilities", ["", "", "", ""]);
    addRow(25, "Common equity", [45, "", "", ""]);
    addRow(26, "Balance check", ["", "", "", ""]);
    addRow(31, "Net income", ["", "", "", ""]);
    addRow(32, "Change in deferred tax assets", ["", "", "", ""]);
    addRow(33, "Change in deferred revenue", ["", "", "", ""]);
    addRow(34, "Cash from operations", ["", "", "", ""]);
    const instruction = "Complete the deferred tax analysis. Fill in all empty cells for Years 2-4. Leave Tax Accounting income statement rows and Year 1 cells unchanged.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["DeferredTax"], cells });
    const contract = inspection.formulaFillSuggestions.find((suggestion) => suggestion.operations.length === 51);
    const compactPlan = buildWorkbookSuggestedPlan(inspection, "DeferredTax");

    expect(contract).toBeDefined();
    expect(compactPlan.conflicts).toEqual([]);
    expect(compactPlan.operations).toHaveLength(54);
    expect(inspection.valueSuggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sheet: "DeferredTax", cell: "D8", value: 120 }),
      expect.objectContaining({ sheet: "DeferredTax", cell: "F8", value: 120 }),
    ]));
    expect(contract?.operations).toEqual(expect.arrayContaining([
      { sheet: "DeferredTax", cell: "D15", formula: "C15+H8-H9-(H8-H9)*0.35" },
      { sheet: "DeferredTax", cell: "F26", formula: "F18-F23-F25" },
      { sheet: "DeferredTax", cell: "F34", formula: "SUM(F31:F33)" },
    ]));
    const operations = [
      ...contract!.operations.map((operation) => ({ sheet: operation.sheet, cell: operation.cell, formula: operation.formula })),
      ...inspection.valueSuggestions.map((value) => ({ sheet: value.sheet, cell: value.cell, value: value.value })),
    ];
    expect(verifyWorkbookPlan({ instruction, inspection, cells, sheetNames: ["DeferredTax"], operations }).status).toBe("passed");
    const wrongValue = operations.map((operation) => operation.cell === "D8" ? { ...operation, value: 100 } : operation);
    expect(verifyWorkbookPlan({ instruction, inspection, cells, sheetNames: ["DeferredTax"], operations: wrongValue }).issues).toContainEqual(expect.objectContaining({
      kind: "value_semantic_mismatch",
      address: "D8",
    }));
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
