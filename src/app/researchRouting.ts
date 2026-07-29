import type { Artifact } from "../engine/types";

export type ResearchSheetStatusCounts = {
  total: number;
  complete: number;
  needsReview: number;
  pending: number;
  running: number;
  failedOrGap: number;
  other: number;
};

export function researchRowIds(artifact: Artifact): string[] {
  const ids: string[] = [];
  for (const elementId of artifact.order) {
    const rowId = elementId.split("__")[0];
    if (rowId && !ids.includes(rowId)) ids.push(rowId);
  }
  return ids;
}

export function researchRowStatus(artifact: Artifact, rowId: string): string {
  const raw = artifact.elements[`${rowId}__status`]?.value;
  if (raw && typeof raw === "object") {
    const payload = raw as Record<string, unknown>;
    if (typeof payload.status === "string") return payload.status.toLowerCase();
    if (typeof payload.value === "string") return payload.value.toLowerCase();
  }
  return String(raw ?? "pending").toLowerCase();
}

export function researchSheetStatusCounts(artifact: Artifact): ResearchSheetStatusCounts {
  const counts: ResearchSheetStatusCounts = {
    total: 0,
    complete: 0,
    needsReview: 0,
    pending: 0,
    running: 0,
    failedOrGap: 0,
    other: 0,
  };
  for (const rowId of researchRowIds(artifact)) {
    counts.total += 1;
    switch (researchRowStatus(artifact, rowId)) {
      case "complete": counts.complete += 1; break;
      case "needs_review": counts.needsReview += 1; break;
      case "pending": counts.pending += 1; break;
      case "running": counts.running += 1; break;
      case "failed":
      case "gap": counts.failedOrGap += 1; break;
      default: counts.other += 1;
    }
  }
  return counts;
}

export function researchSheetStatusMessage(artifact: Artifact): string {
  const counts = researchSheetStatusCounts(artifact);
  if (!counts.total) return "The research sheet has no company rows.";
  if (counts.complete === counts.total) return "Every company on the research sheet is marked complete.";
  const parts = [
    counts.complete ? `${counts.complete} complete` : "",
    counts.needsReview ? `${counts.needsReview} need review` : "",
    counts.pending ? `${counts.pending} pending` : "",
    counts.running ? `${counts.running} running` : "",
    counts.failedOrGap ? `${counts.failedOrGap} failed or missing evidence` : "",
    counts.other ? `${counts.other} with another status` : "",
  ].filter(Boolean);
  const reviewInstruction = counts.needsReview
    ? " Review-required rows are not complete; ask NodeAgent to recheck or verify them."
    : "";
  return `No research rows were selected. Current sheet: ${parts.join(", ")}.${reviewInstruction}`;
}

export function researchRowsForGoal(artifact: Artifact, goal: string): string[] {
  const allRows = researchRowIds(artifact);
  const normalizedGoal = goal.toLowerCase();
  const wantsAll = /\b(all|every|batch|watchlist|bulk|each|companies)\b/.test(normalizedGoal);
  const pendingRows = allRows.filter((rowId) => researchRowStatus(artifact, rowId) === "pending");
  const reviewRows = allRows.filter((rowId) => researchRowStatus(artifact, rowId) === "needs_review");
  const namedRows = wantsAll ? [] : allRows.filter((rowId) => {
    const raw = artifact.elements[`${rowId}__company`]?.value;
    const company = raw && typeof raw === "object" && "value" in raw
      ? String((raw as { value?: unknown }).value ?? "").toLowerCase()
      : String(raw ?? "").toLowerCase();
    return company.length > 1 && normalizedGoal.includes(company);
  });
  if (namedRows.length) return namedRows;
  const explicitlyRequestsReview = /\b(recheck|verify|retry|rerun|refresh|review)\b|re-?research/.test(normalizedGoal);
  const includeReview = explicitlyRequestsReview || (wantsAll && !/\bpending\b/.test(normalizedGoal));
  return [...new Set([...pendingRows, ...(includeReview ? reviewRows : [])])];
}

export function researchRowsForInvestigation(artifact: Artifact): string[] {
  return researchRowIds(artifact).filter((rowId) => {
    const status = researchRowStatus(artifact, rowId);
    return status === "pending" || status === "needs_review";
  });
}
