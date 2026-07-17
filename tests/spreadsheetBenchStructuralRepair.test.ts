import { describe, expect, it } from "vitest";
import { detectSpreadsheetBenchStructuralRepair } from "../src/eval/spreadsheetBenchStructuralRepair";
import type { WorkbookObservedCell } from "../src/nodeagent/skills/spreadsheet/workbookTaskIntelligence";

describe("SpreadsheetBench structural repair planning", () => {
  it("derives a complete missing-selector-row repair from visible workbook invariants", () => {
    const cells: WorkbookObservedCell[] = [
      { sheet: "Ex 5 - M&A", address: "B5", value: "Acme - M&A Add-On Acquisitions Target #1" },
      ...Array.from({ length: 10 }, (_value, index) => ({
        sheet: "Ex 5 - M&A",
        address: `${String.fromCharCode(67 + (index % 5))}${12 + Math.floor(index / 5) * 3}`,
        value: "#REF!",
        formula: `+CHOOSE(#REF!,J${12 + index},Q${12 + index},X${12 + index})`,
      })),
      {
        sheet: "Ex 2 - Valuation Bridge",
        address: "C4",
        value: "#REF!",
        formula: "-'[1]Ex 1 - IBO'!F27",
      },
      {
        sheet: "Ex 2 - Valuation Bridge",
        address: "C5",
        value: "#REF!",
        formula: "('[2]Ex 1 - LB0'!AC17-'Ex 1 - LBO'!X17)*'Ex 1 - LBO'!X18",
      },
    ];

    const repair = detectSpreadsheetBenchStructuralRepair({
      instruction: "Please audit and fix deleted rows. The active scenario case selector value is 3.",
      sheetNames: ["Ex 1 - LBO", "Ex 2 - Valuation Bridge", "Ex 5 - M&A"],
      cells,
    });

    expect(repair).toMatchObject({
      status: "complete",
      basis: "visible_workbook_invariants",
      kind: "insert_missing_selector_row",
      sheet: "Ex 5 - M&A",
      insertRow: 4,
      labelCell: "B4",
      label: "Case",
      selectorCell: "C4",
      selectorValue: 3,
      formulaSearch: "CHOOSE(#REF!,",
      formulaReplace: "CHOOSE($C$4,",
      expectedFormulaReplacementCount: 10,
      operationCount: 15,
    });
    expect(repair?.formulaRepairs).toEqual([
      { sheet: "Ex 2 - Valuation Bridge", cell: "C4", formula: "=-'Ex 1 - LBO'!F27" },
      {
        sheet: "Ex 2 - Valuation Bridge",
        cell: "C5",
        formula: "=('Ex 1 - LBO'!AC17-'Ex 1 - LBO'!X17)*'Ex 1 - LBO'!X18",
      },
    ]);
  });

  it("refuses to infer a structural write without a supplied selector value", () => {
    const cells = Array.from({ length: 10 }, (_value, index): WorkbookObservedCell => ({
      sheet: "Model",
      address: `C${12 + index}`,
      value: "#REF!",
      formula: `CHOOSE(#REF!,J${12 + index},Q${12 + index},X${12 + index})`,
    }));
    cells.push({ sheet: "Model", address: "B5", value: "M&A Add-On Acquisitions" });

    expect(detectSpreadsheetBenchStructuralRepair({
      instruction: "Please fix the deleted row.",
      sheetNames: ["Model"],
      cells,
    })).toBeUndefined();
  });
});
