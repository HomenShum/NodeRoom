import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PresenceClaim } from "../src/app/store";
import type { Actor } from "../src/engine/types";
import { DeckStoryboardWorkbench } from "../src/ui/workArtifacts/DeckStoryboardWorkbench";
import { createDeckComment, deckSlideElementId, normalizeCollaborativeDeck, type DeckStoryboard } from "../src/ui/workArtifacts";

const host: Actor = { kind: "user", id: "host", name: "Host" };
const maya: Actor = { kind: "user", id: "maya", name: "Maya" };

function storyboard(): DeckStoryboard {
  return normalizeCollaborativeDeck({
    deckId: "deck-1",
    roomId: "room-1",
    title: "Board readout",
    audience: "board",
    objective: "Explain the diligence decision.",
    privacy: "room",
    storyboardStatus: "needs_review",
    slides: [{
      slideId: "slide-1",
      title: "Decision",
      purpose: "State the recommendation.",
      claims: [{ claimId: "claim-1", text: "Revenue reconciles.", status: "verified", sourceArtifactId: "sheet-1" }],
      sourceArtifactIds: ["sheet-1"],
      evidenceIds: ["evidence-1"],
      unresolvedGaps: ["Verify runway."],
      status: "needs_review",
    }],
    requiredEvidence: ["Decision: Verify runway."],
    unresolvedGaps: ["Verify runway."],
    sourceArtifactIds: ["sheet-1"],
    traceIds: ["trace-1"],
    proposalIds: [],
    planHash: "seed",
    version: 1,
  }, 1);
}

function presence(): PresenceClaim {
  return {
    id: "presence-maya",
    roomId: "room-1",
    artifactId: "artifact-deck",
    targetKind: "deck_component",
    targetId: deckSlideElementId("slide-1"),
    mode: "edit",
    actor: maya,
    label: "Editing deck object",
    updatedAt: 10,
    expiresAt: Date.now() + 60_000,
  };
}

describe("granular deck collaboration UI", () => {
  it("edits a slide, exposes object presence, saves, and comments on the stable object id", async () => {
    const onSaveStoryboard = vi.fn().mockResolvedValue({ ok: true });
    const onAddComment = vi.fn().mockResolvedValue({ ok: true });
    render(
      <DeckStoryboardWorkbench
        storyboard={storyboard()}
        artifactId="artifact-deck"
        collaboratorCount={2}
        presences={[presence()]}
        onClose={() => undefined}
        onOpenArtifact={() => undefined}
        onSaveStoryboard={onSaveStoryboard}
        onAddComment={onAddComment}
      />,
    );

    expect(screen.getByTestId("deck-active-editors").textContent).toContain("Maya");
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Investment decision" } });
    fireEvent.click(screen.getByTestId("deck-collaborative-save"));
    await waitFor(() => expect(onSaveStoryboard).toHaveBeenCalledTimes(1));
    expect(onSaveStoryboard.mock.calls[0][0].slides[0].title).toBe("Investment decision");

    fireEvent.change(screen.getByPlaceholderText("Comment on this slide..."), { target: { value: "Verify the bridge source." } });
    fireEvent.click(screen.getByRole("button", { name: "Add comment" }));
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith("slide-1", "Verify the bridge source.", deckSlideElementId("slide-1")));
  });

  it("resolves comments and surfaces partial object conflicts honestly", async () => {
    const comment = createDeckComment({ commentId: "comment-1", slideId: "slide-1", body: "Check this.", author: host, createdAt: 10 });
    const onResolveComment = vi.fn().mockResolvedValue({ ok: true });
    const onSaveStoryboard = vi.fn().mockResolvedValue({ ok: false, reason: "conflict_after_1_objects" });
    render(
      <DeckStoryboardWorkbench
        storyboard={storyboard()}
        artifactId="artifact-deck"
        comments={[comment]}
        onClose={() => undefined}
        onOpenArtifact={() => undefined}
        onSaveStoryboard={onSaveStoryboard}
        onResolveComment={onResolveComment}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(onResolveComment).toHaveBeenCalledWith(comment));
    fireEvent.change(screen.getByLabelText("Purpose"), { target: { value: "Updated purpose" } });
    fireEvent.click(screen.getByTestId("deck-collaborative-save"));
    expect((await screen.findByTestId("deck-collaboration-status")).textContent).toContain("collaborator changed one of these deck objects");
    expect(screen.getByRole("button", { name: "Reload latest" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reload latest" }));
    expect((screen.getByLabelText("Purpose") as HTMLTextAreaElement).value).toBe("State the recommendation.");
  });
});
