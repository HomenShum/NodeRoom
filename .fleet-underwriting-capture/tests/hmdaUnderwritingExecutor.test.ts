import { describe, expect, it } from "vitest";
import {
  classifyHmdaFeatureRow,
  extractHmdaRowsFromSnapshot,
  isHmdaUnderwritingBenchmarkGoal,
  tryRunHmdaUnderwritingBenchmark,
} from "../src/nodeagent/core/hmdaUnderwritingExecutor";
import type { EditOutcome, RoomSnapshot, RoomTools } from "../src/nodeagent/core/types";

const GOAL = "HMDA underwriting benchmark: predict action_taken for the uploaded HMDA rows and write the predictions into Sheet 1.";

describe("HMDA underwriting benchmark executor", () => {
  it("classifies obvious low-risk originated and high-risk denied rows from visible HMDA fields", () => {
    expect(classifyHmdaFeatureRow({
      sourceRowId: "u1",
      application_id: "LOW",
      loan_to_value_ratio: "33.56",
      income: "770",
      debt_to_income_ratio: "<20%",
    })).toMatchObject({
      application_id: "LOW",
      predicted_action_taken: "1",
      risk_bucket: "low",
    });

    expect(classifyHmdaFeatureRow({
      sourceRowId: "u2",
      application_id: "HIGH",
      loan_to_value_ratio: "100",
      income: "30",
      debt_to_income_ratio: ">60%",
    })).toMatchObject({
      application_id: "HIGH",
      predicted_action_taken: "3",
      risk_bucket: "high",
    });
  });

  it("extracts rows from uploaded dataframe snapshots by HMDA column names", () => {
    const rows = extractHmdaRowsFromSnapshot(sourceSnapshot());

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sourceRowId: "u1",
      application_id: "HMDA_LOW",
      loan_to_value_ratio: "38.363",
      debt_to_income_ratio: "<20%",
    });
  });

  it("writes predictions into Sheet 1 through RoomTools with traceable edit_cell calls", async () => {
    const rt = fakeRoomTools();
    const traceEvents: string[] = [];
    const result = await tryRunHmdaUnderwritingBenchmark({
      rt,
      goal: GOAL,
      runtimeProfile: "benchmark_completion",
      maxSteps: 200,
      reserveMs: 1000,
      onTrace: (event) => { traceEvents.push(event.tool); },
    });

    expect(result?.stopReason).toBe("done");
    expect(result?.usage.modelCalls).toBe(0);
    expect(traceEvents).toContain("list_artifacts");
    expect(traceEvents.filter((tool) => tool === "edit_cell")).toHaveLength(15);
    expect(rt.readWritten("r1__A")).toBe("application_id");
    expect(rt.readWritten("r1__B")).toBe("predicted_action_taken");
    expect(rt.readWritten("r1__C")).toBe("predicted_label");
    expect(rt.readWritten("r1__D")).toBe("confidence");
    expect(rt.readWritten("r1__E")).toBe("brief_reason");
    expect(rt.readWritten("r2__A")).toBe("HMDA_LOW");
    expect(rt.readWritten("r2__B")).toBe("1");
    expect(rt.readWritten("r2__C")).toBe("originated");
    expect(rt.readWritten("r2__D")).toMatch(/^\d\.\d{2}$/);
    expect(rt.readWritten("r2__E")).toContain("low risk");
    expect(rt.readWritten("r3__A")).toBe("HMDA_HIGH");
    expect(rt.readWritten("r3__B")).toBe("3");
    expect(rt.readWritten("r3__C")).toBe("denied");
    expect(rt.readWritten("r3__D")).toMatch(/^\d\.\d{2}$/);
    expect(rt.readWritten("r3__E")).toContain("high risk");
  });

  it("does not intercept non-HMDA or non-benchmark jobs", async () => {
    expect(isHmdaUnderwritingBenchmarkGoal(GOAL, "benchmark_completion")).toBe(true);
    expect(isHmdaUnderwritingBenchmarkGoal(
      "In this fresh live Noderoom room, use the uploaded file hmda_dc_2025_purchase_features.csv. This is a retrospective HMDA benchmark. Predict each application's HMDA action_taken and write the table into Sheet 1.",
      "benchmark_completion",
    )).toBe(true);
    expect(isHmdaUnderwritingBenchmarkGoal(GOAL, undefined)).toBe(false);
    expect(await tryRunHmdaUnderwritingBenchmark({
      rt: fakeRoomTools(),
      goal: "Summarize this room.",
      runtimeProfile: "benchmark_completion",
    })).toBeNull();
  });
});

function sourceSnapshot(): RoomSnapshot {
  return {
    artifactId: "source",
    version: 1,
    kind: "sheet",
    rows: [
      sourceRow("u1", {
        application_id: "HMDA_LOW",
        loan_to_value_ratio: "38.363",
        income: "620",
        debt_to_income_ratio: "<20%",
        lien_status: "1",
      }),
      sourceRow("u2", {
        application_id: "HMDA_HIGH",
        loan_to_value_ratio: "100",
        income: "30",
        debt_to_income_ratio: ">60%",
        lien_status: "1",
      }),
    ],
  };
}

function sourceRow(rowId: string, cells: Record<string, string>): RoomSnapshot["rows"][number] {
  return {
    rowId,
    label: "",
    q2: "",
    q3: "",
    variance: "",
    note: "",
    varianceVersion: 0,
    locked: false,
    cells: Object.fromEntries(Object.entries(cells).map(([key, value]) => [key, { value, version: 1, locked: false }])),
  };
}

function targetSnapshot(values: Map<string, { value: unknown; version: number }>): RoomSnapshot {
  const rows: RoomSnapshot["rows"] = [];
  const elements: RoomSnapshot["elements"] = [];
  for (let r = 1; r <= 12; r++) {
    const cells: RoomSnapshot["rows"][number]["cells"] = {};
    for (const col of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      const id = `r${r}__${col}`;
      const stored = values.get(id) ?? { value: "", version: 1 };
      cells[col] = { value: String(stored.value ?? ""), version: stored.version, locked: false };
      elements.push({ id, value: stored.value, version: stored.version, locked: false });
    }
    rows.push({ rowId: `r${r}`, label: "", q2: "", q3: "", variance: "", note: "", varianceVersion: 1, locked: false, cells });
  }
  return { artifactId: "target", version: 1, kind: "sheet", rows, elements };
}

function fakeRoomTools(): RoomTools & { readWritten(id: string): unknown } {
  const targetValues = new Map<string, { value: unknown; version: number }>();
  for (let r = 1; r <= 12; r++) {
    for (const col of ["A", "B", "C", "D", "E", "F", "G", "H"]) {
      targetValues.set(`r${r}__${col}`, { value: "", version: 1 });
    }
  }

  return {
    readWritten: (id: string) => targetValues.get(id)?.value,
    async listArtifacts() {
      return [
        { id: "target", title: "Sheet 1", kind: "sheet" },
        { id: "source", title: "hmda_dc_2025_purchase_features.csv", kind: "file" },
      ];
    },
    async snapshot(artifactId?: string) {
      return artifactId === "source" ? sourceSnapshot() : targetSnapshot(targetValues);
    },
    async editCell(elementId: string, value: unknown, baseVersion: number, artifactId?: string, kind?: "set" | "create"): Promise<EditOutcome> {
      if (artifactId !== "target") return { ok: false, error: "wrong_artifact" };
      const existing = targetValues.get(elementId);
      const actual = existing?.version ?? 0;
      if (actual !== baseVersion) return { ok: false, conflict: true, expected: baseVersion, actual };
      if (!existing && kind !== "create") return { ok: false, error: "missing_cell" };
      const nextVersion = actual + 1;
      targetValues.set(elementId, { value, version: nextVersion });
      return { ok: true, version: nextVersion, mutationReceiptId: `receipt:${elementId}` };
    },
    async say() {},
    async awareness() { return { activeLocks: [], agents: [], recentTrace: [], autoAllow: true }; },
    async readRange() { return []; },
    async searchSheetContext() { return []; },
    async proposeLock() { return { ok: true, lockId: "lock" }; },
    async releaseLock() { return { merged: [] }; },
    async createDraft() { return { draftId: "draft" }; },
    async fetchSource() { return { ok: false, error: "disabled" }; },
  };
}
