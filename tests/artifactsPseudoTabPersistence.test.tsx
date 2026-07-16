import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Artifact as RoomArtifact } from "../src/engine/types";

const storeRef = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("../src/app/store", () => ({ useStore: () => storeRef.current }));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => undefined),
}));
vi.mock("../src/ui/workArtifacts/WorkArtifactsPanel", () => ({
  WorkArtifactsPanel: ({ initialArtifactId }: { initialArtifactId?: string }) => (
    <div data-testid="work-artifacts-panel" data-initial-artifact-id={initialArtifactId ?? ""} />
  ),
}));

import { Artifact } from "../src/ui/panels/Artifact";

const host: Actor = { kind: "user", id: "host", name: "Host" };

function noteArtifact(id: string, title: string, value: string): RoomArtifact {
  return {
    id,
    roomId: "room-1",
    kind: "note",
    title,
    version: 1,
    elements: { doc: { id: "doc", version: 1, value, updatedAt: 1, updatedBy: host } },
    order: ["doc"],
    updatedAt: 1,
    createdBy: host,
    visibility: "room",
  };
}

function deckArtifact(): RoomArtifact {
  return {
    ...noteArtifact("artifact-deck", "Diligence memo", "Deck seed"),
    meta: { tags: ["noderoom:deck"] },
  };
}

describe("work artifacts pseudo-tab routing", () => {
  beforeEach(() => {
    const artifacts = [
      noteArtifact("artifact-wiki", "Agent wiki", "Room wiki"),
      noteArtifact("artifact-note", "Research notes", "Research notes"),
      deckArtifact(),
    ];
    storeRef.current = {
      listArtifacts: () => artifacts,
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
      lastRun: () => null,
      lastLongFreeJob: () => null,
      lastLongFreeJobAttempts: () => [],
      lastLongFreeJobDetail: () => null,
    };
  });

  it("preserves manual intent across normal IDs but exits a deck-routed surface for a normal artifact", async () => {
    const onArt = vi.fn();
    const view = render(<Artifact roomId="room-1" me={host} artId="artifact-wiki" onArt={onArt} />);

    fireEvent.click(screen.getByTestId("work-artifacts-tab"));
    expect(await screen.findByTestId("work-artifacts-panel")).toBeTruthy();

    view.rerender(<Artifact roomId="room-1" me={host} artId="artifact-note" onArt={onArt} />);
    expect(await screen.findByTestId("work-artifacts-panel")).toBeTruthy();
    expect(screen.getByTestId("work-artifacts-tab").getAttribute("data-active")).toBe("true");

    view.rerender(<Artifact roomId="room-1" me={host} artId="artifact-deck" onArt={onArt} />);
    await waitFor(() => expect(screen.getByTestId("work-artifacts-panel").getAttribute("data-initial-artifact-id")).toBe("artifact-deck"));

    view.rerender(<Artifact roomId="room-1" me={host} artId="artifact-wiki" onArt={onArt} />);
    await waitFor(() => expect(screen.queryByTestId("work-artifacts-panel")).toBeNull());
    expect(screen.getByText("Room wiki")).toBeTruthy();
  });
});
