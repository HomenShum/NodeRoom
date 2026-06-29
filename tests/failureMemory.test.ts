import { describe, it, expect } from "vitest";
import {
  classifyRootCause,
  buildFailurePatterns,
  mergeFailureMemory,
  repairTargets,
  type TaskFailure,
} from "../src/nodemem/failureMemory";

const NOW = 1_700_000_000_000;

describe("NodeMem failure memory — memory->repair half of the loop", () => {
  it("classifies validation/scorer errors into stable root causes", () => {
    expect(classifyRootCause("exported file path does not exist: x.xlsx")).toBe("evidence_file_missing");
    expect(classifyRootCause("btb-x.pptx must have downloaded=true")).toBe("deliverable_export_or_reopen");
    expect(classifyRootCause("official scorer handoff requires scorer.verdict=pass")).toBe("official_scorer_not_pass");
    expect(classifyRootCause("ui.focusModeEnabled must be true")).toBe("focus_mode_missing");
    expect(classifyRootCause("agent timed out after 20 minutes")).toBe("agent_timeout");
    expect(classifyRootCause("memoryMode must be false")).toBe("memory_mode_shortcut");
    expect(classifyRootCause("something weird")).toBe("unclassified");
  });

  it("builds one actionable pattern per failure (with a re-run regression test)", () => {
    const failures: TaskFailure[] = [
      { taskId: "btb-1", reason: "official scorer handoff requires scorer.verdict=pass", lane: "live", receiptRef: "r1" },
    ];
    const [p] = buildFailurePatterns(failures, NOW);
    expect(p.id).toBe("live:btb-1:official_scorer_not_pass");
    expect(p.rootCause).toBe("official_scorer_not_pass");
    expect(p.regressionTest).toContain("BTB_UI_TASK_ID=btb-1");
    expect(p.affectedSystems).toEqual(["btb-1"]);
    expect(p.receiptRefs).toEqual(["r1"]);
    expect(p.createdAt).toBe(NOW);
    expect(p.fixSummary.length).toBeGreaterThan(0);
  });

  it("merge drops resolved tasks, upserts new failures, dedupes by id", () => {
    const existing = buildFailurePatterns(
      [{ taskId: "btb-1", reason: "scorer.verdict=pass", lane: "live" }, { taskId: "btb-2", reason: "agent timed out", lane: "live" }],
      NOW,
    );
    // btb-1 now passes; btb-3 newly fails; btb-2 still fails.
    const incoming = buildFailurePatterns([{ taskId: "btb-3", reason: "ui.focusModeEnabled must be true", lane: "live" }], NOW + 1);
    const merged = mergeFailureMemory(existing, incoming, ["btb-1"]);
    const ids = merged.map((p) => p.affectedSystems[0]).sort();
    expect(ids).toEqual(["btb-2", "btb-3"]);
  });

  it("repairTargets returns the unresolved task ids to re-run", () => {
    const memory = buildFailurePatterns(
      [{ taskId: "btb-2", reason: "agent timed out", lane: "live" }, { taskId: "btb-3", reason: "focus", lane: "live" }],
      NOW,
    );
    expect(repairTargets(memory)).toEqual(["btb-2", "btb-3"]);
  });

  it("when everything passes, memory is empty and there are no repair targets", () => {
    const merged = mergeFailureMemory([], [], ["btb-1", "btb-2"]);
    expect(merged).toEqual([]);
    expect(repairTargets(merged)).toEqual([]);
  });
});
