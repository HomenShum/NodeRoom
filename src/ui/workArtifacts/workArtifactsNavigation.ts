export const OPEN_WORK_ARTIFACTS_REVIEW_EVENT = "noderoom:open-work-artifacts-review";

export type WorkArtifactsReviewTarget = { jobId?: string };

export function openWorkArtifactsReview(target: WorkArtifactsReviewTarget = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<WorkArtifactsReviewTarget>(OPEN_WORK_ARTIFACTS_REVIEW_EVENT, { detail: target }));
}

export function onOpenWorkArtifactsReview(listener: (target: WorkArtifactsReviewTarget) => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => listener((event as CustomEvent<WorkArtifactsReviewTarget>).detail ?? {});
  window.addEventListener(OPEN_WORK_ARTIFACTS_REVIEW_EVENT, handler);
  return () => window.removeEventListener(OPEN_WORK_ARTIFACTS_REVIEW_EVENT, handler);
}
