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

  it("ignores quarter labels and A1-shaped fragments of opaque artifact ids", () => {
    const references = extractWorkbookTaskReferences(
      "Inspect Q1, Q2, Q3, and Q4 performance for artifact j578abc and artifact abc123-def456 in room NRAMJ5F6WHN.",
      ["Q3 variance"],
    );

    expect(references).toEqual([]);
  });

  it("does not promote Q2 or Q3 quarter labels when a later phrase mentions cells", () => {
    const references = extractWorkbookTaskReferences(
      "Inspect Q3 variance, calculate and verify every missing Variance cell, and propose only minimal changes. Each variance equals Q3 minus Q2.",
      ["Q3 variance"],
    );

    expect(references.filter((reference) => reference.start === "Q2" || reference.start === "Q3")).toEqual([]);
  });

  it("retains contextual cells, ranges, formulas, and an explicitly named quarter cell", () => {
    const references = extractWorkbookTaskReferences(
      "Write cell B2 using formula =A1*2, fill range J15:J17, and set cell Q3. Q4 performance remains unchanged.",
    );
    const addresses = references.map((reference) => `${reference.start}:${reference.end}`);

    expect(addresses).toEqual(expect.arrayContaining(["B2:B2", "A1:A1", "J15:J17", "Q3:Q3"]));
    expect(addresses).not.toContain("Q4:Q4");
  });

  it("classifies user inputs and lookup bounds as dependencies while keeping the requested output range as the target", () => {
    const instruction = "I want to configure column 'J' under 'Densities' in my Excel sheet to return 'PASS' or 'FAIL' similar to what I have set up for column 'I'. For column 'I', I've used the formula =IF(AND(G15<1.05,G15>0.95),'PASS','FAIL'). In the 'Densities' table, the user provides two inputs: they select a variable from 'A-G' in cells B15:B17, and they enter a reading in cells H15:H17. I need column J (cells J15:J17) to check the corresponding cell in column B (B15:B17), and then verify if the moisture range entered by the user falls within a specific range defined in cells 'I3' and 'J3'. In cell I15, I have a pass/fail condition. Adjust the calculation based on the user's choice from a dropdown that populates B3:B9.";
    const references = extractWorkbookTaskReferences(instruction, ["Sheet1"]);
    const roles = new Map(references.map((reference) => [`${reference.start}:${reference.end}`, reference.role]));

    expect(roles.get("G15:G15")).toBe("dependency");
    expect(roles.get("B15:B17")).toBe("dependency");
    expect(roles.get("H15:H17")).toBe("dependency");
    expect(roles.get("J15:J17")).toBe("target");
    expect(roles.get("I3:I3")).toBe("dependency");
    expect(roles.get("J3:J3")).toBe("dependency");
    expect(roles.get("I15:I15")).toBe("dependency");
    expect(roles.get("B3:B9")).toBe("dependency");
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

  it("uses populated weekday labels as evidence and repairs only the formula anchor", () => {
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
    const instruction = 'Correct only the wrong weekday formula TEXT(F4,"DD") and preserve the other existing weekday labels.';
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });

    expect(inspection.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "formula_fill_band", address: "F3", relatedAddresses: [] }),
    ]));
    expect(inspection.formulaFillSuggestions).toEqual([expect.objectContaining({
      range: "F3:F3",
      sourceFormula: 'TEXT(F4,"DDD")',
      operations: [
        { sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"DDD")' },
      ],
    })]);
    const repaired = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: [{ sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"DDD")' }],
    });
    expect(repaired.status).toBe("passed");
    expect(repaired.checks).toMatchObject({ targetCandidateCount: 1, coveredTargetCount: 1 });
  });

  it("preserves correct peer weekday formulas and repairs only the quoted anchor", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "ATTENDENCE", address: "F3", value: "21", formula: 'TEXT(F4,"DD")' },
      { sheet: "ATTENDENCE", address: "F4", value: "2015-10-21" },
      { sheet: "ATTENDENCE", address: "G3", value: "Thursday", formula: 'TEXT(G4,"DDDD")' },
      { sheet: "ATTENDENCE", address: "G4", value: "2015-10-22" },
      { sheet: "ATTENDENCE", address: "H3", value: "Friday", formula: 'TEXT(H4,"DDDD")' },
      { sheet: "ATTENDENCE", address: "H4", value: "2015-10-23" },
    ];
    const instruction = 'Correct only the wrong weekday formula TEXT(F4,"DD") and preserve the other existing weekday formulas.';
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });
    const plan = buildWorkbookSuggestedPlan(inspection, "ATTENDENCE");

    expect(plan).toEqual({
      conflicts: [],
      operations: [{ elementId: "F3", formula: 'TEXT(F4,"DDDD")' }],
    });
    expect(inspection.formulaRepairSuggestions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ cell: "F3" }),
      expect.objectContaining({ cell: "G3" }),
      expect.objectContaining({ cell: "H3" }),
    ]));
    expect(verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: [{ sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"DDDD")' }],
    }).status).toBe("passed");
  });

  it("normalizes the full visible weekday row when canonical three-letter examples are requested", () => {
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
    const instruction = 'Correct the weekday formula TEXT(F4,"DD") so weekday names display like Mon and Wed.';
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });

    expect(inspection.formulaFillSuggestions).toEqual([expect.objectContaining({
      range: "F3:I3",
      operations: ["F", "G", "H", "I"].map((column) => ({
        sheet: "ATTENDENCE",
        cell: `${column}3`,
        formula: `TEXT(${column}4,"DDD")`,
      })),
    })]);
    expect(verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["ATTENDENCE"],
      operations: [{ sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"DDD")' }],
    }).status).toBe("needs_repair");
  });

  it("fills blank weekday peers but still requires complete coverage of those blank targets", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "ATTENDENCE", address: "F3", value: "21", formula: 'TEXT(F4,"DD")' },
      { sheet: "ATTENDENCE", address: "F4", value: "2015-10-21" },
      { sheet: "ATTENDENCE", address: "G3", value: "" },
      { sheet: "ATTENDENCE", address: "G4", value: "2015-10-22" },
      { sheet: "ATTENDENCE", address: "H3", value: "" },
      { sheet: "ATTENDENCE", address: "H4", value: "2015-10-23" },
      { sheet: "ATTENDENCE", address: "I3", value: "" },
      { sheet: "ATTENDENCE", address: "I4", value: "2015-10-24" },
    ];
    const instruction = 'Correct and fill the weekday formula TEXT(F4,"DD") so weekday names display like Mon and Wed.';
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["ATTENDENCE"], cells });

    expect(inspection.formulaFillSuggestions).toEqual([expect.objectContaining({
      range: "F3:I3",
      operations: ["F", "G", "H", "I"].map((column) => ({
        sheet: "ATTENDENCE",
        cell: `${column}3`,
        formula: `TEXT(${column}4,"DDD")`,
      })),
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

  it("derives a visible lookup-range pass/fail contract without treating source inputs as write targets", () => {
    const instruction = "In the Densities table, users select a variable from A-G in cells B15:B17 and enter a reading in cells H15:H17. I need column J (cells J15:J17) to check the corresponding cell in column B (B15:B17) and verify whether the moisture falls within the range defined in cells I3 and J3. Display Pass when it is in range and Fail otherwise. The dropdown populates B3:B9.";
    const cells: WorkbookObservedCell[] = [
      ...["A", "B", "C", "D", "E", "F", "G"].map((value, index) => ({ sheet: "Sheet1", address: `A${index + 3}`, value })),
      ...Array.from({ length: 7 }, (_, index) => [
        { sheet: "Sheet1", address: `I${index + 3}`, value: 0.2 + index / 100 },
        { sheet: "Sheet1", address: `J${index + 3}`, value: 0.5 + index / 100 },
      ]).flat(),
      { sheet: "Sheet1", address: "B15", value: "a" },
      { sheet: "Sheet1", address: "B16", value: "B" },
      { sheet: "Sheet1", address: "B17", value: "a" },
      { sheet: "Sheet1", address: "H15", value: 0.44 },
      { sheet: "Sheet1", address: "H16", value: 0.3 },
      { sheet: "Sheet1", address: "H17", value: 0.18 },
      { sheet: "Sheet1", address: "J15", value: "" },
      { sheet: "Sheet1", address: "J16", value: "" },
      { sheet: "Sheet1", address: "J17", value: "" },
    ];
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Sheet1"], cells });
    const plan = buildWorkbookSuggestedPlan(inspection, "Sheet1");

    expect(inspection.targetCandidates.map((target) => target.address)).toEqual(["J15", "J16", "J17"]);
    expect(inspection.dependencyCandidates.map((dependency) => dependency.address)).toEqual(expect.arrayContaining([
      "B15", "B16", "B17", "H15", "H16", "H17", "I3", "J3",
    ]));
    expect(plan).toEqual({
      conflicts: [],
      operations: [
        { elementId: "J15", formula: 'IF(MEDIAN(H15,VLOOKUP(B15,$A$3:$J$9,{9,10},0))=H15,"Pass","Fail")' },
        { elementId: "J16", formula: 'IF(MEDIAN(H16,VLOOKUP(B16,$A$3:$J$9,{9,10},0))=H16,"Pass","Fail")' },
        { elementId: "J17", formula: 'IF(MEDIAN(H17,VLOOKUP(B17,$A$3:$J$9,{9,10},0))=H17,"Pass","Fail")' },
      ],
    });
  });

  it("does not infer pass/fail formulas when any selected lookup key has missing bounds", () => {
    const instruction = "Users select A-B in B15:B16 and enter readings in H15:H16. Fill J15:J16 with Pass or Fail using the corresponding lookup range defined by I3 and J3. The dropdown populates B3:B4.";
    const cells: WorkbookObservedCell[] = [
      { sheet: "Sheet1", address: "A3", value: "A" },
      { sheet: "Sheet1", address: "A4", value: "B" },
      { sheet: "Sheet1", address: "I3", value: 0.2 },
      { sheet: "Sheet1", address: "J3", value: 0.5 },
      { sheet: "Sheet1", address: "I4", value: "" },
      { sheet: "Sheet1", address: "J4", value: "" },
      { sheet: "Sheet1", address: "B15", value: "A" },
      { sheet: "Sheet1", address: "B16", value: "B" },
      { sheet: "Sheet1", address: "H15", value: 999 },
      { sheet: "Sheet1", address: "H16", value: 0.3 },
      { sheet: "Sheet1", address: "J15", value: "" },
      { sheet: "Sheet1", address: "J16", value: "" },
    ];
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Sheet1"], cells });

    expect(buildWorkbookSuggestedPlan(inspection, "Sheet1").operations).toEqual([]);
    expect(inspection.blockedTargets).toEqual([
      expect.objectContaining({
        sheet: "Sheet1",
        address: "J16",
        missingDependencies: ["I4", "J4"],
      }),
    ]);
    const modelSuppliedPlan = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Sheet1"],
      operations: [
        { sheet: "Sheet1", cell: "J15", formula: 'IF(MEDIAN(H15,VLOOKUP(B15,$A$3:$J$4,{9,10},0))=H15,"Pass","Fail")' },
        { sheet: "Sheet1", cell: "J16", formula: 'IF(MEDIAN(H16,VLOOKUP(B16,$A$3:$J$4,{9,10},0))=H16,"Pass","Fail")' },
      ],
    });
    expect(modelSuppliedPlan.status).toBe("needs_repair");
    expect(modelSuppliedPlan.issues).toContainEqual(expect.objectContaining({
      kind: "unsafe_lookup_bounds",
      sheet: "Sheet1",
      address: "J16",
    }));
  });

  it("does not project sheet-qualified lookup bounds onto the target sheet", () => {
    const instruction = "Users select A-G in 'Input'!B15:B17 and enter readings in 'Input'!H15:H17. Fill 'Input'!J15:J17 with Pass or Fail using the corresponding range defined in 'Rules'!I3 and 'Rules'!J3. The dropdown populates 'Input'!B3:B9.";
    const cells: WorkbookObservedCell[] = [
      ...["A", "B", "C", "D", "E", "F", "G"].map((value, index) => ({ sheet: "Input", address: `A${index + 3}`, value })),
      ...Array.from({ length: 7 }, (_, index) => [
        { sheet: "Rules", address: `I${index + 3}`, value: 0.2 + index / 100 },
        { sheet: "Rules", address: `J${index + 3}`, value: 0.5 + index / 100 },
      ]).flat(),
      { sheet: "Input", address: "B15", value: "A" },
      { sheet: "Input", address: "B16", value: "B" },
      { sheet: "Input", address: "B17", value: "C" },
      { sheet: "Input", address: "H15", value: 0.3 },
      { sheet: "Input", address: "H16", value: 0.4 },
      { sheet: "Input", address: "H17", value: 0.5 },
      { sheet: "Input", address: "J15", value: "" },
      { sheet: "Input", address: "J16", value: "" },
      { sheet: "Input", address: "J17", value: "" },
    ];
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Input", "Rules"], cells });

    expect(buildWorkbookSuggestedPlan(inspection, "Input").operations).toEqual([]);
  });

  it("does not materialize unrelated formula-band repairs for a scoped task", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "ATTENDENCE", address: "F3", value: "21", formula: 'TEXT(F4,"DD")' },
      { sheet: "ATTENDENCE", address: "F4", value: "2015-10-21" },
      { sheet: "ATTENDENCE", address: "G3", value: "TH" },
      { sheet: "ATTENDENCE", address: "G4", value: "2015-10-22" },
      { sheet: "ATTENDENCE", address: "H3", value: "F" },
      { sheet: "ATTENDENCE", address: "H4", value: "2015-10-23" },
      { sheet: "ATTENDENCE", address: "B10", value: 2, formula: "A10*2" },
      { sheet: "ATTENDENCE", address: "C10", value: "" },
      { sheet: "ATTENDENCE", address: "D10", value: 8, formula: "C10*2" },
      { sheet: "ATTENDENCE", address: "E10", value: 16, formula: "D10*2" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: 'Correct only the wrong weekday formula TEXT(F4,"DD") and preserve the other adjacent labels.',
      sheetNames: ["ATTENDENCE"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions).toContainEqual(expect.objectContaining({ cell: "C10" }));
    expect(buildWorkbookSuggestedPlan(inspection, "ATTENDENCE").operations).toEqual([
      { elementId: "F3", formula: 'TEXT(F4,"DDD")' },
    ]);
  });

  it("uses only the agent-visible filename to focus an embedded-hardcode audit", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 2, formula: "A2*2" },
      { sheet: "Model", address: "C2", value: 4 },
      { sheet: "Model", address: "D2", value: 8, formula: "C2*2" },
      { sheet: "Model", address: "F3", value: 2, formula: "E3+1" },
      { sheet: "Model", address: "G3", value: "" },
      { sheet: "Model", address: "H3", value: 4, formula: "G3+1" },
    ];
    const instruction = [
      "Audit and fix this file. Errors may include blanks, colors, averages, signs, or references.",
      "Agent-visible input workbook name: 01-Embedded Hardcodes_input.xlsx",
    ].join("\n");
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });

    expect(inspection.auditFocus).toMatchObject({ kind: "embedded_hardcode", source: "agent_visible_filename" });
    expect(inspection.formulaRepairSuggestions).toEqual([
      expect.objectContaining({ kind: "fill_gap", cell: "C2", formula: "B2*2" }),
    ]);
    expect(inspection.findings).not.toContainEqual(expect.objectContaining({ kind: "blank_in_formula_band" }));
    expect(buildWorkbookSuggestedPlan(inspection, "Model").operations).toEqual([
      { elementId: "C2", formula: "B2*2" },
    ]);
  });

  it("keeps generic audits unchanged when no known agent-visible filename is present", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 2, formula: "A2*2" },
      { sheet: "Model", address: "C2", value: "" },
      { sheet: "Model", address: "D2", value: 8, formula: "C2*2" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit and fix this workbook. Errors may include formula gaps.",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.auditFocus).toBeUndefined();
    expect(inspection.formulaRepairSuggestions).toContainEqual(expect.objectContaining({ cell: "C2" }));
  });

  it("selects only a locally confirmed relative-versus-absolute formula outlier", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 2, formula: "$A2*B$1" },
      { sheet: "Model", address: "C2", value: 3, formula: "A2*C1" },
      { sheet: "Model", address: "D2", value: 4, formula: "$A2*D$1" },
    ];
    const instruction = "Audit and fix this file.\nAgent-visible input workbook name: 01-Relative vs Absolute DIfference_input.xlsx";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });

    expect(inspection.auditFocus?.kind).toBe("relative_absolute_reference");
    expect(inspection.formulaRepairSuggestions).toEqual([
      expect.objectContaining({ kind: "replace_outlier", cell: "C2", formula: "$A2*C$1" }),
    ]);
    expect(inspection.targetBands).toEqual([]);
  });

  it("repairs cumulative double counting after the valid first period without touching ordinary translated totals", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Forecast", address: "A14", value: "Cumulative total" },
      { sheet: "Forecast", address: "B14", value: 30, formula: "SUM(B10:B12)" },
      { sheet: "Forecast", address: "C14", value: 66, formula: "B14+SUM(C10:C12)" },
      { sheet: "Forecast", address: "D14", value: 108, formula: "C14+SUM(D10:D12)" },
      { sheet: "Forecast", address: "E14", value: 156, formula: "D14+SUM(E10:E12)" },
      { sheet: "Forecast", address: "A18", value: "Ordinary period total" },
      { sheet: "Forecast", address: "B18", value: 10, formula: "SUM(B15:B17)" },
      { sheet: "Forecast", address: "C18", value: 12, formula: "SUM(C15:C17)" },
      { sheet: "Forecast", address: "D18", value: 14, formula: "SUM(D15:D17)" },
      { sheet: "Forecast", address: "E18", value: 16, formula: "SUM(E15:E17)" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Double Counting_input.xlsx",
      sheetNames: ["Forecast"],
      cells,
    });

    expect(inspection.auditFocus?.kind).toBe("double_counting");
    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "C14", formula: "SUM(C10:C12)" },
      { cell: "D14", formula: "SUM(D10:D12)" },
      { cell: "E14", formula: "SUM(E10:E12)" },
    ]);
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "B14" }));
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "B18" }));
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "C18" }));
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "D18" }));
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "E18" }));
  });

  it("replaces embedded hardcodes from a uniquely equivalent formula-backed metric band", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "A4", value: "Adjusted free cash flow" },
      { sheet: "Model", address: "B4", value: 10, formula: "B2-B3" },
      { sheet: "Model", address: "C4", value: 12, formula: "C2-C3" },
      { sheet: "Model", address: "D4", value: 14, formula: "D2-D3" },
      { sheet: "Model", address: "E4", value: 16, formula: "E2-E3" },
      { sheet: "Model", address: "A8", value: "Adjusted free cash flow" },
      { sheet: "Model", address: "B8", value: 10 },
      { sheet: "Model", address: "C8", value: 12 },
      { sheet: "Model", address: "D8", value: 14 },
      { sheet: "Model", address: "E8", value: 16 },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Embedded Hardcodes_input.xlsx",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.auditFocus?.kind).toBe("embedded_hardcode");
    expect(inspection.formulaRepairSuggestions.map(({ kind, cell, formula }) => ({ kind, cell, formula }))).toEqual([
      { kind: "fill_gap", cell: "B8", formula: "+B4" },
      { kind: "fill_gap", cell: "C8", formula: "+C4" },
      { kind: "fill_gap", cell: "D8", formula: "+D4" },
      { kind: "fill_gap", cell: "E8", formula: "+E4" },
    ]);
  });

  it("rejects downstream hardcode mirrors and selects the independent assumption band", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "A2", value: "Revenue Growth" },
      { sheet: "Model", address: "B2", value: "", formula: "CHOOSE($A$1,B3,B4)", numFmt: "0.0%" },
      { sheet: "Model", address: "C2", value: "", formula: "CHOOSE($A$1,C3,C4)", numFmt: "0.0%" },
      { sheet: "Model", address: "D2", value: "", formula: "CHOOSE($A$1,D3,D4)", numFmt: "0.0%" },
      { sheet: "Model", address: "A6", value: "% YoY Growth" },
      { sheet: "Model", address: "B6", value: "", formula: "B7/B5-1" },
      { sheet: "Model", address: "C6", value: "", formula: "C7/C5-1" },
      { sheet: "Model", address: "D6", value: "", formula: "D7/D5-1" },
      { sheet: "Model", address: "B7", value: "", formula: "B5*(1+B10)" },
      { sheet: "Model", address: "C7", value: "", formula: "C5*(1+C10)" },
      { sheet: "Model", address: "D7", value: "", formula: "D5*(1+D10)" },
      { sheet: "Model", address: "A10", value: "Revenue % YoY Growth" },
      { sheet: "Model", address: "B10", value: 0.04, fontColor: "FF7030A0", numFmt: "0.0%" },
      { sheet: "Model", address: "C10", value: 0.05, fontColor: "FF7030A0", numFmt: "0.0%" },
      { sheet: "Model", address: "D10", value: 0.06, fontColor: "FF7030A0", numFmt: "0.0%" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Embedded Hardcodes_input.xlsx",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B10", formula: "+B2" },
      { cell: "C10", formula: "+C2" },
      { cell: "D10", formula: "+D2" },
    ]);
  });

  it("links actual and projected exit multiples to their labeled controls", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "A1", value: "Entry EBITDA Multiple" },
      { sheet: "Model", address: "B1", value: "", formula: "B9" },
      { sheet: "Model", address: "A2", value: "Exit EBITDA Multiple" },
      { sheet: "Model", address: "B2", value: "", formula: "B9" },
      { sheet: "Model", address: "E4", value: "", formula: "TEXT(E$1,\"#\")&\"A\"" },
      { sheet: "Model", address: "F4", value: "", formula: "TEXT(F$1,\"#\")&\"P\"" },
      { sheet: "Model", address: "G4", value: "", formula: "TEXT(G$1,\"#\")&\"P\"" },
      { sheet: "Model", address: "D6", value: "(x) Exit Multiple" },
      { sheet: "Model", address: "E6", value: 14.2, fontColor: "FF7030A0" },
      { sheet: "Model", address: "F6", value: 14.2, fontColor: "FF7030A0" },
      { sheet: "Model", address: "G6", value: 14.2, fontColor: "FF7030A0" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Embedded Hardcodes_input.xlsx",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "E6", formula: "+B1" },
      { cell: "F6", formula: "$B$2" },
      { cell: "G6", formula: "$B$2" },
    ]);
  });

  it("replaces a repeated interest-rate literal with the uniquely related local control", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Debt", address: "A1", value: "Revolver Rate" },
      { sheet: "Debt", address: "B1", value: 0.04 },
      { sheet: "Debt", address: "A2", value: "Senior Debt Rate" },
      { sheet: "Debt", address: "B2", value: 0.04 },
      { sheet: "Debt", address: "A8", value: "Senior Secured TLB Interest Expense" },
      { sheet: "Debt", address: "B8", value: "", formula: "B6*(0.04+B7)" },
      { sheet: "Debt", address: "C8", value: "", formula: "C6*(0.04+C7)" },
      { sheet: "Debt", address: "D8", value: "", formula: "D6*(0.04+D7)" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Embedded Hardcodes_input.xlsx",
      sheetNames: ["Debt"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B8", formula: "B6*($B$2+B7)" },
      { cell: "C8", formula: "C6*($B$2+C7)" },
      { cell: "D8", formula: "D6*($B$2+D7)" },
    ]);
  });

  it("combines INDEX MATCH width repair with the uniquely matching semantic source row", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Summary", address: "A5", value: "Adjusted EBITDA margin" },
      {
        sheet: "Summary",
        address: "B5",
        value: 0.24,
        formula: "INDEX(Drivers!$D$20:$H$20,MATCH(B$2,Drivers!$C$2:$H$2,0))",
      },
      { sheet: "Drivers", address: "A15", value: "Adjusted EBITDA margin" },
      { sheet: "Drivers", address: "A20", value: "Revenue growth rate" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Index Match_input.xlsx",
      sheetNames: ["Summary", "Drivers"],
      cells,
    });

    expect(inspection.auditFocus?.kind).toBe("index_match");
    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      {
        cell: "B5",
        formula: "INDEX(Drivers!$C$15:$H$15,MATCH(B$2,Drivers!$C$2:$H$2,0))",
      },
    ]);
  });

  it("anchors a single populated control and fixed interpolation endpoints across translated bands", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Projection", address: "B6", value: 100 },
      { sheet: "Projection", address: "C6", value: 110 },
      { sheet: "Projection", address: "D6", value: 120 },
      { sheet: "Projection", address: "F2", value: 0.1 },
      { sheet: "Projection", address: "G2", value: "" },
      { sheet: "Projection", address: "H2", value: "" },
      { sheet: "Projection", address: "B10", value: 10, formula: "B6*F2" },
      { sheet: "Projection", address: "C10", value: 11, formula: "C6*G2" },
      { sheet: "Projection", address: "D10", value: 12, formula: "D6*H2" },
      { sheet: "Projection", address: "B20", value: 20, formula: "A20+(K4-G4)/3" },
      { sheet: "Projection", address: "C20", value: 30, formula: "B20+(L4-H4)/3" },
      { sheet: "Projection", address: "D20", value: 40, formula: "C20+(M4-I4)/3" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Relative vs Absolute Difference_input.xlsx",
      sheetNames: ["Projection"],
      cells,
    });

    expect(inspection.auditFocus?.kind).toBe("relative_absolute_reference");
    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B10", formula: "B6*$F$2" },
      { cell: "C10", formula: "C6*$F$2" },
      { cell: "D10", formula: "D6*$F$2" },
      { cell: "B20", formula: "A20+($K$4-$G$4)/3" },
      { cell: "C20", formula: "B20+($K$4-$G$4)/3" },
      { cell: "D20", formula: "C20+($K$4-$G$4)/3" },
    ]);
  });

  it("derives additive signs only from explicit source-row sign labels", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Bridge", address: "A4", value: "(+) Revenue" },
      { sheet: "Bridge", address: "B4", value: 100 },
      { sheet: "Bridge", address: "A5", value: "(-) Cost of sales" },
      { sheet: "Bridge", address: "B5", value: 40 },
      { sheet: "Bridge", address: "A6", value: "(+) Other income" },
      { sheet: "Bridge", address: "B6", value: 5 },
      { sheet: "Bridge", address: "A8", value: "Net result" },
      { sheet: "Bridge", address: "B8", value: 55, formula: "B4+B5-B6" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Sign Conventions_input.xlsx",
      sheetNames: ["Bridge"],
      cells,
    });

    expect(inspection.auditFocus?.kind).toBe("sign_convention");
    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B8", formula: "+B4-B5+B6" },
    ]);
  });

  it("keeps sign-convention inspection bounded when a referenced source is absent", () => {
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Sign Conventions_input.xlsx",
      sheetNames: ["Bridge"],
      cells: [
        { sheet: "Bridge", address: "A8", value: "Net result" },
        { sheet: "Bridge", address: "B8", value: 55, formula: "B4+B5" },
      ],
    });

    expect(inspection.auditFocus?.kind).toBe("sign_convention");
    expect(inspection.formulaRepairSuggestions).toEqual([]);
  });

  it("normalizes a percentage-formatted hardcode while preserving its number format", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Assumptions", address: "A4", value: "Tax rate (%)" },
      { sheet: "Assumptions", address: "B4", value: 25, numFmt: "0.0%" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Unit Mismatch_input.xlsx",
      sheetNames: ["Assumptions"],
      cells,
    });

    expect(inspection.auditFocus?.kind).toBe("unit_mismatch");
    expect(inspection.valueSuggestions.map(({ cell, value, numFmt }) => ({ cell, value, numFmt }))).toEqual([
      { cell: "B4", value: 0.25, numFmt: "0.0%" },
    ]);
    expect(inspection.formulaRepairSuggestions).toEqual([]);
  });

  it("realigns a cross-sheet period band from visible year headers", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Summary", address: "B1", value: 2026 },
      { sheet: "Summary", address: "C1", value: "", formula: "+B1+1" },
      { sheet: "Summary", address: "D1", value: "", formula: "+C1+1" },
      { sheet: "Summary", address: "A5", value: "Revenue" },
      { sheet: "Summary", address: "B5", value: "", formula: "+'Source Model'!F10" },
      { sheet: "Summary", address: "C5", value: "", formula: "+'Source Model'!G10" },
      { sheet: "Summary", address: "D5", value: "", formula: "+'Source Model'!H10" },
      { sheet: "Source Model", address: "C1", value: 2022 },
      { sheet: "Source Model", address: "D1", value: "", formula: "+C1+1" },
      { sheet: "Source Model", address: "E1", value: "", formula: "+D1+1" },
      { sheet: "Source Model", address: "F1", value: "", formula: "+E1+1" },
      { sheet: "Source Model", address: "G1", value: "", formula: "+F1+1" },
      { sheet: "Source Model", address: "H1", value: "", formula: "+G1+1" },
      { sheet: "Source Model", address: "I1", value: "", formula: "+H1+1" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Cross Sheet References_input.xlsx",
      sheetNames: ["Summary", "Source Model"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B5", formula: "+'Source Model'!G10" },
      { cell: "C5", formula: "+'Source Model'!H10" },
      { cell: "D5", formula: "+'Source Model'!I10" },
    ]);
  });

  it("moves a unit-mismatched cross-sheet band to the uniquely matching semantic row", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Summary", address: "A4", value: "Revenue" },
      { sheet: "Summary", address: "A5", value: "Company" },
      { sheet: "Summary", address: "B5", value: "", formula: "+'Source Model'!G17" },
      { sheet: "Summary", address: "C5", value: "", formula: "+'Source Model'!H17" },
      { sheet: "Summary", address: "D5", value: "", formula: "+'Source Model'!I17" },
      { sheet: "Source Model", address: "A16", value: "Recurring Software" },
      { sheet: "Source Model", address: "A17", value: "Services" },
      { sheet: "Source Model", address: "A18", value: "Total Revenue" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Unit Mismatch_input.xlsx",
      sheetNames: ["Summary", "Source Model"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B5", formula: "+'Source Model'!G18" },
      { cell: "C5", formula: "+'Source Model'!H18" },
      { cell: "D5", formula: "+'Source Model'!I18" },
    ]);
  });

  it("infers a subtractive component from a visible recomposition total", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "A4", value: "Total Revenue" },
      { sheet: "Model", address: "B4", value: "" },
      { sheet: "Model", address: "A6", value: "Recurring Software" },
      { sheet: "Model", address: "B6", value: "" },
      { sheet: "Model", address: "A7", value: "Services" },
      { sheet: "Model", address: "B7", value: "", formula: "+B4+B6" },
      { sheet: "Model", address: "A8", value: "Total Revenue" },
      { sheet: "Model", address: "B8", value: "", formula: "+SUM(B6:B7)" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Sign Conventions_input.xlsx",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B7", formula: "+B4-B6" },
    ]);
  });

  it("completes regular aggregate periods that each omit their populated terminal row", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B5", value: "", formula: "AVERAGE('Rates Data'!C8:C18)" },
      { sheet: "Model", address: "C5", value: "", formula: "AVERAGE('Rates Data'!C20:C30)" },
      { sheet: "Model", address: "D5", value: "", formula: "AVERAGE('Rates Data'!C32:C42)" },
      ...Array.from({ length: 36 }, (_, index): WorkbookObservedCell => ({
        sheet: "Rates Data",
        address: `C${8 + index}`,
        value: 0.01 + index / 10_000,
      })),
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Average_input.xlsx",
      sheetNames: ["Model", "Rates Data"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ cell, formula }) => ({ cell, formula }))).toEqual([
      { cell: "B5", formula: "AVERAGE('Rates Data'!C8:C19)" },
      { cell: "C5", formula: "AVERAGE('Rates Data'!C20:C31)" },
      { cell: "D5", formula: "AVERAGE('Rates Data'!C32:C43)" },
    ]);
  });

  it("uses repeated scenario panels to remove a transitive aggregate cycle", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "C9", value: 10 },
      { sheet: "Model", address: "D9", value: 11 },
      { sheet: "Model", address: "E9", value: 12 },
      { sheet: "Model", address: "F9", value: 13 },
      { sheet: "Model", address: "G9", value: "", formula: "CHOOSE($C$4,N9,U9,AB9)" },
      { sheet: "Model", address: "N9", value: "", formula: "+AVERAGE($C$9:$F$9)" },
      { sheet: "Model", address: "U9", value: "", formula: "+AVERAGE($C$9:$G$9)" },
      { sheet: "Model", address: "AB9", value: "", formula: "+AVERAGE($C$9:$F$9)" },
      { sheet: "Comps", address: "C15", value: "", formula: "AVERAGE(C7:C14)" },
      { sheet: "Comps", address: "D15", value: "", formula: "AVERAGE(D7:D14)" },
      { sheet: "Comps", address: "E15", value: "", formula: "AVERAGE(E7:E14)" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit this workbook.\nAgent-visible input workbook name: Incorrect Average_input.xlsx",
      sheetNames: ["Model", "Comps"],
      cells,
    });

    expect(inspection.formulaRepairSuggestions.map(({ sheet, cell, formula }) => ({ sheet, cell, formula }))).toEqual([
      { sheet: "Model", cell: "U9", formula: "+AVERAGE($C$9:$F$9)" },
    ]);
  });

  it.each([
    {
      filename: "Double Counting",
      kind: "double_counting",
      left: "SUM(A3:B3)",
      actual: "SUM(B3:D3)",
      right: "SUM(C3:D3)",
      expected: "SUM(B3:C3)",
    },
    {
      filename: "Incorrect Index Match",
      kind: "index_match",
      left: "INDEX($A$10:$A$20,MATCH(B1,$B$10:$B$20,0))",
      actual: "INDEX($A$10:$A$20,MATCH(C1,$C$10:$C$20,0))",
      right: "INDEX($A$10:$A$20,MATCH(D1,$B$10:$B$20,0))",
      expected: "INDEX($A$10:$A$20,MATCH(C1,$B$10:$B$20,0))",
    },
    {
      filename: "Incorrect Cross Sheet References",
      kind: "cross_sheet_reference",
      left: "Source!A2",
      actual: "Wrong!B2",
      right: "Source!C2",
      expected: "Source!B2",
    },
    {
      filename: "Unit Mismatch",
      kind: "unit_mismatch",
      left: "A2/1000",
      actual: "B2",
      right: "C2/1000",
      expected: "B2/1000",
    },
    {
      filename: "Incorrect Sign Conventions",
      kind: "sign_convention",
      left: "-A2",
      actual: "B2",
      right: "-C2",
      expected: "-B2",
    },
    {
      filename: "Errors",
      kind: "formula_errors",
      left: "A2*2",
      actual: "#REF!*2",
      right: "C2*2",
      expected: "B2*2",
    },
    {
      filename: "Incorrect Average",
      kind: "incorrect_average",
      left: "AVERAGE(A3:A4)",
      actual: "AVERAGE(B3:B5)",
      right: "AVERAGE(C3:C4)",
      expected: "AVERAGE(B3:B4)",
    },
  ])("filters $filename audits to the compatible local formula class", ({ filename, kind, left, actual, right, expected }) => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 1, formula: left },
      { sheet: "Model", address: "C2", value: 2, formula: actual },
      { sheet: "Model", address: "D2", value: 3, formula: right },
      { sheet: "Model", address: "B8", value: 1, formula: "A8*2" },
      { sheet: "Model", address: "C8", value: 9, formula: "Z8*9" },
      { sheet: "Model", address: "D8", value: 3, formula: "C8*2" },
    ];
    const instruction = `Audit and fix this file.\nAgent-visible input workbook name: 01-${filename}_input.xlsx`;
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });

    expect(inspection.auditFocus?.kind).toBe(kind);
    expect(inspection.formulaRepairSuggestions).toEqual([
      expect.objectContaining({ kind: "replace_outlier", cell: "C2", formula: expected }),
    ]);
  });

  it("does not authorize replacing a clean formula from a cascading cached error", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: { error: "#REF!" }, formula: "B1*2" },
      { sheet: "Model", address: "C2", value: { error: "#REF!" }, formula: "SUM(A2:B2)" },
      { sheet: "Model", address: "D2", value: { error: "#REF!" }, formula: "D1*2" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit and fix this file.\nAgent-visible input workbook name: 01-Errors_input.xlsx",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.findings).toContainEqual(expect.objectContaining({
      kind: "formula_error",
      address: "C2",
    }));
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "C2" }));
  });

  it("does not translate formulas across half-year and annual semantic columns", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "G1", value: "2H26E" },
      { sheet: "Model", address: "H1", value: "FY26E" },
      { sheet: "Model", address: "I1", value: "FY27E" },
      { sheet: "Model", address: "G2", value: 0.2, formula: "CHOOSE($C$1,O2,W2,AE2)", numFmt: "0.0%" },
      { sheet: "Model", address: "H2", value: { error: "#REF!" }, formula: "H3/#REF!", numFmt: "0.0%" },
      { sheet: "Model", address: "I2", value: 0.3, formula: "CHOOSE($C$1,Q2,Y2,AG2)", numFmt: "0.0%" },
    ];
    const inspection = inspectWorkbookTask({
      instruction: "Audit and fix this file.\nAgent-visible input workbook name: 01-Errors_input.xlsx",
      sheetNames: ["Model"],
      cells,
    });

    expect(inspection.findings).toContainEqual(expect.objectContaining({ kind: "formula_error", address: "H2" }));
    expect(inspection.formulaRepairSuggestions).not.toContainEqual(expect.objectContaining({ cell: "H2" }));
  });

  it("rejects overbroad filename-focused audit plans without making inferred targets mandatory", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 2, formula: "A2*2" },
      { sheet: "Model", address: "C2", value: 3 },
      { sheet: "Model", address: "D2", value: 8, formula: "C2*2" },
    ];
    const instruction = "Audit and fix this file.\nAgent-visible input workbook name: 01-Embedded Hardcode_input.xlsx";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });
    const minimal = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Model"],
      operations: [{ sheet: "Model", cell: "C2", formula: "B2*2" }],
    });
    const broad = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Model"],
      operations: Array.from({ length: 9 }, (_, index) => ({ sheet: "Model", cell: `A${index + 1}`, value: index })),
    });

    expect(minimal.status).toBe("passed");
    expect(broad.issues).toContainEqual(expect.objectContaining({ kind: "overbroad_audit_plan" }));
  });

  it("rejects placeholder and wrong-formula writes outside locally confirmed audit evidence", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Model", address: "B2", value: 2, formula: "A2*2" },
      { sheet: "Model", address: "C2", value: 4 },
      { sheet: "Model", address: "D2", value: 8, formula: "C2*2" },
    ];
    const instruction = "Audit and fix this file.\nAgent-visible input workbook name: 01-Embedded Hardcode_input.xlsx";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });

    const placeholder = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Model"],
      operations: [{ sheet: "Model", cell: "A1000", value: 1 }],
    });
    const wrongFormula = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Model"],
      operations: [{ sheet: "Model", cell: "C2", formula: "Z99*9" }],
    });

    expect(placeholder.status).toBe("needs_repair");
    expect(placeholder.issues).toContainEqual(expect.objectContaining({ kind: "unsubstantiated_audit_target", address: "A1000" }));
    expect(wrongFormula.status).toBe("needs_repair");
    expect(wrongFormula.issues).toContainEqual(expect.objectContaining({
      kind: "formula_semantic_mismatch",
      address: "C2",
      repair: expect.stringContaining("=B2*2"),
    }));
  });

  it("builds and verifies a style-only font-color repair from local workbook evidence", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Income Statement", address: "B6", value: "Monro", formula: "Summary!G10", fontColor: "FF000000" },
      { sheet: "Income Statement", address: "B7", value: 10, formula: "Summary!G11", fontColor: "FF008000" },
      { sheet: "Income Statement", address: "B8", value: 12, formula: "Summary!G12", fontColor: "FF008000" },
    ];
    const instruction = "Audit and fix this file.\nAgent-visible input workbook name: 01-Inconsistent Color Coding_input.xlsx";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Income Statement"], cells });
    const plan = buildWorkbookSuggestedPlan(inspection, "Income Statement");

    expect(inspection.auditFocus?.kind).toBe("color_coding");
    expect(inspection.deterministicPlan).toEqual({
      status: "complete",
      basis: "visible_workbook_invariants",
      auditFocus: "color_coding",
      operationCount: 1,
      sheets: ["Income Statement"],
    });
    expect(inspection.styleSuggestions).toEqual([
      expect.objectContaining({ cell: "B6", fontColor: "FF008000" }),
    ]);
    expect(plan.operations).toEqual([{ elementId: "B6", fontColor: "FF008000" }]);
    expect(verifyWorkbookValues({
      cells: [{ ...cells[0], fontColor: "FF008000" }],
      checks: checksForWorkbookOperations([{ sheet: "Income Statement", cell: "B6", fontColor: "FF008000" }]),
    })).toMatchObject({ status: "passed", issueCount: 0 });
    expect(verifyWorkbookValues({
      cells: [cells[0]],
      checks: checksForWorkbookOperations([{ sheet: "Income Statement", cell: "B6", fontColor: "FF008000" }]),
    }).checks[0].issues).toContain("font_color_mismatch");

    const contentOverwrite = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Income Statement"],
      operations: [{ sheet: "Income Statement", cell: "B6", value: "placeholder", fontColor: "FF008000" }],
    });
    expect(contentOverwrite.issues).toContainEqual(expect.objectContaining({ kind: "audit_style_content_overwrite" }));
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
