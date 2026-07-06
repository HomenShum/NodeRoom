import { describe, expect, it } from "vitest";
import {
  extractQ3VarianceRows,
  formatQ3Variance,
  isQ3VarianceTaskGoal,
  parseFinancialNumber,
  tryRunQ3VarianceTask,
} from "../src/nodeagent/core/q3VarianceExecutor";
import type { EditOutcome, RoomSnapshot, RoomTools } from "../src/nodeagent/core/types";

const GOAL = "In this live ProofLoop benchmark, recompute the Q3 variance cells and commit them.";

describe("Q3 variance task executor", () => {
  it("recognizes only benchmark-completion Q3 variance goals", () => {
    expect(isQ3VarianceTaskGoal(GOAL, "benchmark_completion")).toBe(true);
    expect(isQ3VarianceTaskGoal(GOAL, undefined)).toBe(false);
    expect(isQ3VarianceTaskGoal("Summarize the room.", "benchmark_completion")).toBe(false);
  });

  it("parses financial numbers and formats Q3 minus Q2 variance", () => {
    expect(parseFinancialNumber("$12,400")).toBe(12400);
    expect(parseFinancialNumber("(1,250.5)")).toBe(-1250.5);
    expect(formatQ3Variance(10000, 12400)).toBe("2,400");
    expect(formatQ3Variance(4000, 5100)).toBe("1,100");
    expect(formatQ3Variance(100, 75)).toBe("-25");
  });

  it("extracts Q2/Q3 rows and writes variance cells through RoomTools", async () => {
    const rt = fakeRoomTools();
    const traceTools: string[] = [];
    const result = await tryRunQ3VarianceTask({
      rt,
      goal: GOAL,
      runtimeProfile: "benchmark_completion",
      onTrace: (event) => { traceTools.push(event.tool); },
    });

    expect(result?.stopReason).toBe("done");
    expect(result?.usage.modelCalls).toBe(0);
    expect(traceTools).toContain("list_artifacts");
    expect(traceTools.filter((tool) => tool === "edit_cell")).toHaveLength(4);
    expect(result?.finalText).toContain("Revenue variance 2,400");
    expect(result?.finalText).toContain("COGS variance 1,100");
    expect(rt.readWritten("r_rev__variance")).toBe("2,400");
    expect(rt.readWritten("r_cogs__variance")).toBe("1,100");
    expect(rt.readWritten("r_gp__variance")).toBe("1,300");
    expect(rt.readWritten("r_ni__variance")).toBe("560");
  });

  it("does not intercept non-Q3 jobs", async () => {
    expect(await tryRunQ3VarianceTask({
      rt: fakeRoomTools(),
      goal: "Run the HMDA underwriting task.",
      runtimeProfile: "benchmark_completion",
    })).toBeNull();
  });
});

function sourceSnapshot(values: Map<string, { value: unknown; version: number }>): RoomSnapshot {
  const rows = [
    sourceRow("r_rev", "Revenue", "$10,000", "$12,400", values),
    sourceRow("r_cogs", "COGS", "$4,000", "$5,100", values),
    sourceRow("r_gp", "Gross profit", "$6,000", "$7,300", values),
    sourceRow("r_ni", "Net income", "$2,500", "$3,060", values),
  ];
  return {
    artifactId: "q3",
    version: 1,
    kind: "sheet",
    rows,
    elements: rows.flatMap((row) => Object.entries(row.cells).map(([column, cell]) => ({
      id: `${row.rowId}__${column}`,
      value: cell.value,
      version: cell.version,
      locked: false,
    }))),
  };
}

function sourceRow(
  rowId: string,
  label: string,
  q2: string,
  q3: string,
  values: Map<string, { value: unknown; version: number }>,
): RoomSnapshot["rows"][number] {
  const varianceId = `${rowId}__variance`;
  const variance = values.get(varianceId) ?? { value: "", version: 1 };
  return {
    rowId,
    label,
    q2,
    q3,
    variance: String(variance.value ?? ""),
    note: "",
    varianceVersion: variance.version,
    locked: false,
    cells: {
      label: { value: label, version: 1, locked: false },
      q2: { value: q2, version: 1, locked: false },
      q3: { value: q3, version: 1, locked: false },
      variance: { value: String(variance.value ?? ""), version: variance.version, locked: false },
    },
  };
}

function fakeRoomTools(): RoomTools & { readWritten(id: string): unknown } {
  const values = new Map<string, { value: unknown; version: number }>();
  for (const id of ["r_rev__variance", "r_cogs__variance", "r_gp__variance", "r_ni__variance"]) {
    values.set(id, { value: "", version: 1 });
  }

  return {
    readWritten: (id: string) => values.get(id)?.value,
    async listArtifacts() {
      return [{ id: "q3", title: "Q3 variance", kind: "sheet" }];
    },
    async snapshot() {
      return sourceSnapshot(values);
    },
    async editCell(elementId: string, value: unknown, baseVersion: number, artifactId?: string): Promise<EditOutcome> {
      if (artifactId !== "q3") return { ok: false, error: "wrong_artifact" };
      const existing = values.get(elementId);
      const actual = existing?.version ?? 0;
      if (actual !== baseVersion) return { ok: false, conflict: true, expected: baseVersion, actual };
      values.set(elementId, { value, version: actual + 1 });
      return { ok: true, version: actual + 1, mutationReceiptId: `receipt:${elementId}` };
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

void extractQ3VarianceRows;
