import { describe, expect, it } from "vitest";
import type { Artifact } from "../src/engine/types";
import {
  researchRowStatus,
  researchRowsForGoal,
  researchRowsForInvestigation,
  researchSheetStatusCounts,
  researchSheetStatusMessage,
} from "../src/app/researchRouting";

function researchSheet(rows: Array<{ id: string; company: string; status: unknown }>): Artifact {
  const elements: Record<string, unknown> = {};
  const order: string[] = [];
  for (const row of rows) {
    for (const [column, value] of [["company", row.company], ["status", row.status]] as const) {
      const id = `${row.id}__${column}`;
      order.push(id);
      elements[id] = { id, value, version: 1, updatedAt: 1, updatedBy: { kind: "user", id: "analyst", name: "Analyst" } };
    }
  }
  return {
    id: "research",
    roomId: "room",
    kind: "sheet",
    title: "Company research",
    version: 1,
    order,
    elements,
  } as unknown as Artifact;
}

describe("research routing honesty", () => {
  it("keeps an unsealed persisted outcome in review and reruns it only when the analyst asks", () => {
    const artifact = researchSheet([
      { id: "review", company: "ReviewCo", status: { value: "complete", status: "needs_review" } },
      { id: "done", company: "DoneCo", status: { value: "complete", status: "complete" } },
      { id: "pending", company: "PendingCo", status: "pending" },
    ]);

    expect(researchRowStatus(artifact, "review")).toBe("needs_review");
    expect(researchSheetStatusCounts(artifact)).toMatchObject({
      total: 3,
      complete: 1,
      needsReview: 1,
      pending: 1,
    });
    expect(researchRowsForGoal(artifact, "@nodeagent research every pending company")).toEqual(["pending"]);
    expect(researchRowsForGoal(artifact, "@nodeagent verify all companies")).toEqual(["pending", "review"]);
    expect(researchRowsForGoal(artifact, "@nodeagent diligence ReviewCo")).toEqual(["review"]);
    expect(researchRowsForInvestigation(artifact)).toEqual(["review", "pending"]);
    expect(researchSheetStatusMessage(artifact)).toContain("1 need review");
    expect(researchSheetStatusMessage(artifact)).not.toContain("Every company");
  });

  it("uses the complete summary only when every persisted row is actually complete", () => {
    const artifact = researchSheet([
      { id: "one", company: "OneCo", status: { value: "complete", status: "complete" } },
      { id: "two", company: "TwoCo", status: "complete" },
    ]);

    expect(researchSheetStatusMessage(artifact)).toBe("Every company on the research sheet is marked complete.");
    expect(researchRowsForInvestigation(artifact)).toEqual([]);
  });
});
