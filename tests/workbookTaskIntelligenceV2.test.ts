import { describe, expect, it } from "vitest";
import {
  inspectWorkbookTask,
  selectWorkbookTaskCells,
  verifyWorkbookPlan,
  type WorkbookObservedCell,
} from "../src/nodeagent/skills/spreadsheet/workbookTaskIntelligence";

describe("workbook task intelligence V2 recovery", () => {
  it("rejects an empty mutating plan even when inspection finds no candidate or anomaly", () => {
    const instruction = "Complete the workbook calculations.";
    const cells: WorkbookObservedCell[] = [{ sheet: "Model", address: "A1", value: "Inputs" }];
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Model"], cells });

    expect(inspection).toMatchObject({ mutatingTask: true, allowEmptyPlan: false });
    expect(inspection.targetCandidates).toHaveLength(0);
    expect(inspection.findings).toHaveLength(0);

    const verification = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Model"],
      operations: [],
    });

    expect(verification.status).toBe("needs_repair");
    expect(verification.issues).toContainEqual(expect.objectContaining({ kind: "empty_mutating_plan" }));
  });

  it("keeps every operation in an explicit repeated formula band beyond eight cells", () => {
    const headers: WorkbookObservedCell[] = Array.from({ length: 10 }, (_, index) => ({
      sheet: "Plan",
      address: `${String.fromCharCode(66 + index)}1`,
      value: 2020 + index,
    }));
    const cells: WorkbookObservedCell[] = [
      ...headers,
      { sheet: "Plan", address: "A2", value: "Metric" },
      { sheet: "Plan", address: "B2", value: 2, formula: "B1*2" },
      { sheet: "Plan", address: "C2", value: 4, formula: "C1*2" },
    ];
    const instruction = "On Plan, fill B2:K2 with the established formula pattern.";
    const inspection = inspectWorkbookTask({ instruction, sheetNames: ["Plan"], cells });
    const suggestion = inspection.formulaFillSuggestions.find((candidate) => candidate.range === "B2:K2");

    expect(inspection.targetBands).toContainEqual(expect.objectContaining({
      sheet: "Plan",
      range: "B2:K2",
      addresses: ["B2", "C2", "D2", "E2", "F2", "G2", "H2", "I2", "J2", "K2"],
      source: "explicit_reference",
    }));
    expect(inspection.targetCandidates).toHaveLength(10);
    expect(suggestion?.operations).toHaveLength(10);
    expect(suggestion?.operations.at(-1)).toEqual({ sheet: "Plan", cell: "K2", formula: "K1*2" });
    expect(selectWorkbookTaskCells({ inspection, cells, maxCells: 20 }).map((cell) => cell.address)).toContain("K2");

    const partial = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Plan"],
      operations: suggestion!.operations.slice(0, 8),
    });
    expect(partial.status).toBe("needs_repair");
    expect(partial.checks).toMatchObject({ targetCandidateCount: 10, coveredTargetCount: 8 });
    expect(partial.issues).toContainEqual(expect.objectContaining({
      kind: "missing_target_coverage",
      repair: expect.stringContaining("Plan!J2:K2"),
    }));

    const complete = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames: ["Plan"],
      operations: suggestion!.operations,
    });
    expect(complete.status).toBe("passed");
  });

  it("infers and requires every named financial row and year intersection", () => {
    const incomeYears = Array.from({ length: 9 }, (_, index): WorkbookObservedCell => ({
      sheet: "Income Statement",
      address: `${String.fromCharCode(67 + index)}3`,
      value: 2019 + index,
    }));
    const synergyYears = Array.from({ length: 5 }, (_, index): WorkbookObservedCell => ({
      sheet: "Synergies and Intgn Exp",
      address: `${String.fromCharCode(71 + index)}4`,
      value: 2023 + index,
    }));
    const cells: WorkbookObservedCell[] = [
      ...incomeYears,
      ...synergyYears,
      { sheet: "Income Statement", address: "B34", value: "EBITDA" },
      { sheet: "Income Statement", address: "B52", value: "Retained Earnings" },
      { sheet: "Synergies and Intgn Exp", address: "B23", value: "Total Europe New Headcount" },
    ];
    const instruction = [
      "In the Synergies and Intgn Exp sheet, calculate Total Europe New Headcount for 2023E-2027E.",
      "In the Income Statement sheet, calculate EBITDA for 2019A-2027E, then calculate Retained Earnings for 2019A-2027E.",
    ].join(" ");
    const sheetNames = ["Income Statement", "Synergies and Intgn Exp"];
    const inspection = inspectWorkbookTask({ instruction, sheetNames, cells });

    expect(inspection.targetBands.map((band) => `${band.sheet}!${band.range}`)).toEqual([
      "Synergies and Intgn Exp!G23:K23",
      "Income Statement!C34:K34",
      "Income Statement!C52:K52",
    ]);
    expect(inspection.targetCandidates).toHaveLength(23);
    expect(inspection.findings.filter((finding) => finding.kind === "named_year_target_band")).toHaveLength(3);
    expect(selectWorkbookTaskCells({ inspection, cells, maxCells: 40 }).map((cell) => `${cell.sheet}!${cell.address}`))
      .toContain("Income Statement!K52");

    const completeOperations = inspection.targetCandidates.map((target) => ({
      sheet: target.sheet,
      cell: target.address,
      formula: "=1",
    }));
    const partial = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames,
      operations: completeOperations.filter((operation) => operation.cell !== "K52"),
    });
    expect(partial.status).toBe("needs_repair");
    expect(partial.checks).toMatchObject({ targetCandidateCount: 23, coveredTargetCount: 22 });
    expect(partial.issues).toContainEqual(expect.objectContaining({
      kind: "missing_target_coverage",
      repair: expect.stringContaining("'Income Statement'!K52"),
    }));

    const complete = verifyWorkbookPlan({
      instruction,
      inspection,
      cells,
      sheetNames,
      operations: completeOperations,
    });
    expect(complete.status).toBe("passed");
  });
});
