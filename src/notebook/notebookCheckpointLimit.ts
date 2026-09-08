import { elementValueLimitViolation } from "../engine/elementValueLimits";

export type NotebookCheckpointDecision =
  | { status: "unavailable" }
  | { status: "write"; html: string }
  | { status: "skip"; reason: "value_too_large" | "value_not_serializable" };

/** Pure decision seam shared by the Convex effect and production-fidelity tests. */
export function notebookCheckpointDecision(html: string | null): NotebookCheckpointDecision {
  if (html === null) return { status: "unavailable" };
  const violation = elementValueLimitViolation(html, "set");
  return violation ? { status: "skip", reason: violation } : { status: "write", html };
}
