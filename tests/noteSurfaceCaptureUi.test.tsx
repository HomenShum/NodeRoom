import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Proposal } from "../src/engine/types";
import { NotebookDigestWorkbench } from "../src/ui/workArtifacts/NotebookDigestWorkbench";
import { NoteworthyInbox } from "../src/ui/insights/NoteworthyInbox";
import type { NotebookArtifactStructure } from "../src/ui/workArtifacts/notebookStructure";
import { buildNoteSurfaceReferenceFixture } from "./fixtures/noteSurfaceReferenceFixture";

function structure(overrides: Partial<NotebookArtifactStructure> = {}): NotebookArtifactStructure {
  return {
    artifactId: "note-1",
    title: "Capture notebook",
    status: "ready",
    summary: "1 block",
    blockCount: 1,
    sectionCount: 0,
    agentBlockCount: 0,
    humanBlockCount: 1,
    needsReviewCount: 0,
    citationCount: 0,
    evidenceCount: 0,
    sourceIds: [],
    traceIds: [],
    proposalIds: [],
    blocks: [{
      id: "block-1",
      elementId: "doc",
      index: 0,
      kind: "paragraph",
      role: "human",
      status: "draft",
      depth: 0,
      text: "Existing thought",
      traceIds: [],
      proposalIds: [],
      sourceIds: [],
    }],
    sections: [],
    ...overrides,
  };
}

function proposal(): Proposal {
  return {
    id: "proposal-1",
    roomId: "room-1",
    artifactId: "note-1",
    author: { kind: "agent", id: "agent", name: "Room agent", scope: "public" },
    op: {
      opId: "op-1",
      artifactId: "note-1",
      elementId: "doc",
      kind: "set",
      value: "Candidate",
      baseVersion: 1,
    },
    status: "pending",
    createdAt: 1,
  };
}

describe("note-surface capture states", () => {
  it("keeps populated and empty streams armed", () => {
    const { rerender } = render(
      <NotebookDigestWorkbench
        structure={structure()}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("armed");
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-reason")).toBe("NORMAL_NOTE_CONTEXT");

    rerender(
      <NotebookDigestWorkbench
        structure={structure({ status: "empty", summary: "", blockCount: 0, humanBlockCount: 0, blocks: [] })}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("armed");
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-reason")).toBe("NORMAL_NOTE_CONTEXT");
    expect(screen.getByText(/Start the stream/i)).toBeTruthy();
  });

  it("disarms a pending proposal while provenance is collapsed and stays disarmed when details close", () => {
    render(
      <NotebookDigestWorkbench
        structure={structure({ status: "needs_review", proposalIds: ["proposal-1"] })}
        proposals={[proposal()]}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("disarmed");
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-reason")).toBe("PROPOSAL_REVIEW_ACTIVE");
    fireEvent.click(screen.getByRole("button", { name: /Reference chain/i }));
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("disarmed");
    expect(screen.getByText("Finish this review before adding another note.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Reference chain/i }));
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("disarmed");
  });

  it("disarms provenance-only review and rearms when details close", () => {
    render(
      <NotebookDigestWorkbench
        structure={structure()}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Reference chain/i }));
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-reason")).toBe("PROVENANCE_REVIEW_ACTIVE");
    fireEvent.click(screen.getByRole("button", { name: /Reference chain/i }));
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-reason")).toBe("NORMAL_NOTE_CONTEXT");
  });

  it("submits once, clears the capture, and remains armed for the next thought", async () => {
    const onCapture = vi.fn().mockResolvedValue({ ok: true });
    render(
      <NotebookDigestWorkbench
        structure={structure()}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={onCapture}
      />,
    );
    const input = screen.getByLabelText("Capture note") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "New diligence thought" } });
    fireEvent.click(screen.getByTestId("notebook-note-capture-submit"));
    await waitFor(() => expect(onCapture).toHaveBeenCalledWith("New diligence thought"));
    expect(input.value).toBe("");
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("armed");
    expect(screen.getByRole("status").textContent).toContain("Captured");
  });

  it("fails closed and stays disarmed after a stale capture conflict", async () => {
    render(
      <NotebookDigestWorkbench
        structure={structure()}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={vi.fn().mockResolvedValue({ ok: false, reason: "conflict" })}
      />,
    );
    fireEvent.change(screen.getByLabelText("Capture note"), { target: { value: "Stale thought" } });
    fireEvent.click(screen.getByTestId("notebook-note-capture-submit"));
    await waitFor(() => {
      expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-state")).toBe("disarmed");
    });
    expect(screen.getByTestId("notebook-note-capture").getAttribute("data-capture-reason")).toBe("CONFLICT_REVIEW_ACTIVE");
    expect(screen.getByRole("alert").textContent).toContain("changed while you were capturing");
  });

  it("shows V2 rule mechanism, applicability, evidence counts, and incomplete external proof", async () => {
    const referenceConsumption = await buildNoteSurfaceReferenceFixture();
    render(
      <NotebookDigestWorkbench
        structure={structure({ referenceConsumption })}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onCapture={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    expect(screen.getByText("Incomplete")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Reference chain/i }));
    expect(screen.getByTestId("notebook-reference-summary").textContent)
      .toContain("1 required rules · 1 evaluated · external proof not run");
    fireEvent.click(screen.getByText("Keep capture in one continuous note stream."));
    expect(screen.getByText(/always-present inline entry removes navigation cost/i)).toBeTruthy();
    expect(screen.getByText("computed-style:stream-divider")).toBeTruthy();
  });
});

describe("reference status projection", () => {
  it("renders canonical status as a compact inbox projection and routes to the note", () => {
    const onOpenArtifact = vi.fn();
    render(
      <NoteworthyInbox
        items={[]}
        referenceProjections={[{
          artifactId: "note-1",
          title: "Capture notebook",
          status: "incomplete",
          label: "Incomplete",
          summary: "2 required rules · 2 evaluated · external proof not run",
        }]}
        onOpenArtifact={onOpenArtifact}
        onClose={vi.fn()}
      />,
    );
    const projection = screen.getByTestId("noteworthy-reference-projections");
    expect(projection.querySelector("[data-reference-projection='incomplete']")).toBeTruthy();
    expect(screen.getByText("2 required rules · 2 evaluated · external proof not run")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Capture notebook/i }));
    expect(onOpenArtifact).toHaveBeenCalledWith("note-1");
  });
});
