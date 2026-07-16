// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  onOpenWorkArtifactsReview,
  openWorkArtifactsReview,
} from "../src/ui/workArtifacts/workArtifactsNavigation";

describe("work artifacts run review navigation", () => {
  it("carries the durable agent job identity to the workspace listener", () => {
    const listener = vi.fn();
    const unsubscribe = onOpenWorkArtifactsReview(listener);

    openWorkArtifactsReview({ jobId: "job-42" });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ jobId: "job-42" });
    unsubscribe();
    openWorkArtifactsReview({ jobId: "job-after-unsubscribe" });
    expect(listener).toHaveBeenCalledOnce();
  });
});
