import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Artifact as RoomArtifact } from "../src/engine/types";
import { collaborativeDeckArtifactInput, normalizeCollaborativeDeck, type DeckStoryboard } from "../src/ui/workArtifacts";

const storeRef: { current: Record<string, unknown> } = { current: {} };
vi.mock("../src/app/store", () => ({ HAS_CONVEX: false, useStore: () => storeRef.current }));
vi.mock("convex/react", () => ({
  useQuery: () => { throw new Error("memory artifact UI entered a Convex query"); },
  useMutation: () => { throw new Error("memory artifact UI entered a Convex mutation"); },
}));

import { Artifact } from "../src/ui/panels/Artifact";
import { WorkArtifactsPanel } from "../src/ui/workArtifacts/WorkArtifactsPanel";

const host: Actor = { kind: "user", id: "host", name: "Host" };

function storyboard(title = "Diligence memo", slideTitle = "Decision"): DeckStoryboard {
  return normalizeCollaborativeDeck({
    deckId: "room-1:storyboard",
    roomId: "room-1",
    title,
    audience: "board",
    objective: "Explain the decision.",
    privacy: "room",
    storyboardStatus: "draft",
    slides: [{
      slideId: "slide-1",
      title: slideTitle,
      purpose: "State the recommendation.",
      claims: [],
      sourceArtifactIds: [],
      evidenceIds: [],
      unresolvedGaps: [],
      status: "draft",
    }],
    requiredEvidence: [],
    unresolvedGaps: [],
    sourceArtifactIds: [],
    traceIds: [],
    proposalIds: [],
    planHash: "seed",
    version: 1,
  }, 1);
}

function deckArtifact(id = "artifact-deck", title = "Diligence memo", slideTitle = "Decision"): RoomArtifact {
  const input = collaborativeDeckArtifactInput(storyboard(title, slideTitle));
  return {
    id,
    roomId: "room-1",
    kind: input.kind,
    title: input.title,
    version: 1,
    elements: Object.fromEntries(input.seed.map((element) => [element.id, { id: element.id, version: 1, value: element.value, updatedAt: 1, updatedBy: host }])),
    order: input.seed.map((element) => element.id),
    updatedAt: 1,
    createdBy: host,
    visibility: "room",
    meta: input.meta,
  };
}

function wikiArtifact(): RoomArtifact {
  return {
    id: "artifact-wiki",
    roomId: "room-1",
    kind: "note",
    title: "Agent wiki",
    version: 1,
    elements: { doc: { id: "doc", version: 1, value: "Room wiki", updatedAt: 1, updatedBy: host } },
    order: ["doc"],
    updatedAt: 1,
    createdBy: host,
    visibility: "room",
  };
}

describe("collaborative deck binder routing", () => {
  beforeEach(() => {
    const artifacts = [deckArtifact(), deckArtifact("artifact-deck-2", "Pipeline review", "Pipeline decision"), wikiArtifact()];
    storeRef.current = {
      // MemoryStore returns a fresh array as subscriptions publish. Exercise
      // that identity churn so mounted-selection synchronization cannot loop.
      listArtifacts: () => [...artifacts],
      listMessages: () => [],
      listProposals: () => [],
      listTraces: () => [],
      listMembers: () => [{ id: host.id, role: "host", actor: host }],
      listSessions: () => [],
      listPresence: () => [],
      updatePresence: () => undefined,
      clearPresence: () => undefined,
      getRoom: () => ({ id: "room-1", title: "Diligence room" }),
      getArtifact: (id: string) => artifacts.find((artifact) => artifact.id === id),
      applyEdit: vi.fn(),
      applyArtifactEdits: vi.fn().mockResolvedValue({ ok: true, artifactVersion: 3, results: [] }),
      lastRun: () => null,
      lastLongFreeJob: () => null,
      lastLongFreeJobAttempts: () => [],
      lastLongFreeJobDetail: () => null,
    };
  });

  it("opens a binder-selected deck in storyboard and exits that special surface for a normal artifact", async () => {
    const onArt = vi.fn();
    const view = render(<Artifact roomId="room-1" me={host} artId="artifact-deck" onArt={onArt} />);

    expect(await screen.findByTestId("deck-storyboard-workbench")).toBeTruthy();
    expect(screen.queryByText("Loading notebook...")).toBeNull();

    view.rerender(<Artifact roomId="room-1" me={host} artId="artifact-wiki" onArt={onArt} />);
    await waitFor(() => expect(screen.queryByTestId("work-artifacts-panel")).toBeNull());
    expect(screen.getByText("Room wiki")).toBeTruthy();
  });

  it("lists same-room decks by artifact identity and remounts a dirty editor when switching", async () => {
    render(<WorkArtifactsPanel roomId="room-1" me={host} initialArtifactId="artifact-deck" onOpenArtifact={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "Diligence memo" })).toBeTruthy();
    expect(screen.getAllByTestId("work-artifact-row").filter((row) => row.getAttribute("data-kind") === "deck")).toHaveLength(2);
    expect(screen.getByLabelText("NodeSlide studio mounted in NodeRoom").getAttribute("data-nodeslide-package-version")).toBe("0.2.2");

    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Dirty deck one slide" } });
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Dirty deck one slide");

    fireEvent.click(screen.getByRole("button", { name: /Pipeline review/i }));
    await waitFor(() => expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Pipeline decision"));
    expect(screen.getByRole("heading", { name: "Pipeline review" })).toBeTruthy();
  });

  it("saves changed deck objects through one atomic bundle", async () => {
    render(<WorkArtifactsPanel roomId="room-1" me={host} initialArtifactId="artifact-deck" onOpenArtifact={vi.fn()} />);

    await screen.findByRole("heading", { name: "Diligence memo" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Updated decision" } });
    fireEvent.click(screen.getByTestId("deck-collaborative-save"));

    const applyArtifactEdits = storeRef.current.applyArtifactEdits as ReturnType<typeof vi.fn>;
    const applyEdit = storeRef.current.applyEdit as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(applyArtifactEdits).toHaveBeenCalledTimes(1));
    expect(applyEdit).not.toHaveBeenCalled();
    const call = applyArtifactEdits.mock.calls[0][0] as { artifactId: string; ops: Array<{ artifactId: string; elementId: string }> };
    expect(call.artifactId).toBe("artifact-deck");
    expect(call.ops.length).toBeGreaterThan(0);
    expect(call.ops.every((op) => op.artifactId === "artifact-deck")).toBe(true);
  });
});
