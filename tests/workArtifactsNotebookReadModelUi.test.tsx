import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor, Artifact } from "../src/engine/types";

const mockConvex = vi.hoisted(() => ({
  args: [] as unknown[],
  rows: [] as Array<{ blockId: string; blockIndex: number; blockType: string; text: string }>,
}));
const storeRef: { current: Record<string, unknown> } = { current: {} };

vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    mockConvex.args.push(args);
    return args === "skip" ? undefined : mockConvex.rows;
  },
}));
vi.mock("../src/app/store", () => ({ useStore: () => storeRef.current }));

import { WorkArtifactsPanel } from "../src/ui/workArtifacts/WorkArtifactsPanel";

const host: Actor = { kind: "user", id: "host", name: "Host" };

function notebookArtifact(): Artifact {
  return {
    id: "artifact-notebook",
    roomId: "room-1",
    kind: "note",
    title: "Capture Notebook",
    version: 2,
    elements: {
      doc: { id: "doc", version: 2, value: "Legacy notebook copy", updatedAt: 2, updatedBy: host },
    },
    order: ["doc"],
    updatedAt: 2,
    createdBy: host,
    visibility: "room",
  };
}

describe("work artifacts notebook read-model bridge", () => {
  beforeEach(() => {
    mockConvex.args = [];
    mockConvex.rows = [{
      blockId: "typed-python",
      blockIndex: 4,
      blockType: "codeBlock",
      text: "Python: print((2400 - 1100) - 450)",
    }];
    const artifacts = [notebookArtifact()];
    storeRef.current = {
      actorProof: () => ({ actor: host, token: "test-token" }),
      listArtifacts: () => artifacts,
      listMessages: () => [],
      listProposals: () => [],
      listTraces: () => [],
      listMembers: () => [{ id: host.id, role: "host", actor: host }],
      listPresence: () => [],
      getRoom: () => ({ id: "room-1", title: "Diligence room" }),
      getArtifact: (id: string) => artifacts.find((artifact) => artifact.id === id),
      lastRun: () => null,
      lastLongFreeJob: () => null,
      lastLongFreeJobAttempts: () => [],
      lastLongFreeJobDetail: () => null,
    };
  });

  it("opens a notebook from the room bundle using its live typed blocks", async () => {
    render(<WorkArtifactsPanel roomId="room-1" me={host} onOpenArtifact={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Capture Notebook/i }));

    const workbench = await screen.findByTestId("notebook-digest-workbench");
    expect(within(workbench).getByText("Python: print((2400 - 1100) - 450)")).toBeTruthy();
    expect(within(workbench).getByTestId("notebook-execution-preview-item").getAttribute("data-kind")).toBe("python");
    expect(within(workbench).queryByText("Legacy notebook copy")).toBeNull();
    expect(mockConvex.args).toContainEqual(expect.objectContaining({
      roomId: "room-1",
      artifactId: "artifact-notebook",
      limit: 240,
    }));
  });
});
