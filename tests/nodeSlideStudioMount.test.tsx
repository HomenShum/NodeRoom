import { fireEvent, render, screen } from "@testing-library/react";
import type { DeckSnapshot } from "@nodeslide/contracts";
import { describe, expect, it, vi } from "vitest";
import {
  NodeRoomNodeSlideStudioMount,
  NODEROOM_NODESLIDE_PACKAGE_VERSION,
} from "../src/integrations/nodeslide/NodeRoomNodeSlideStudioMount";
import {
  createNodeRoomNodeSlideReplaceTextCommand,
  nodeSlidePurposeElementId,
  nodeSlideTitleElementId,
} from "../src/integrations/nodeslide/storyboardTranslation";
import { DeckStoryboardWorkbench } from "../src/ui/workArtifacts/DeckStoryboardWorkbench";
import { normalizeCollaborativeDeck, type DeckStoryboard } from "../src/ui/workArtifacts";

const mountedTitleId = nodeSlideTitleElementId("slide:1");
const mountedPurposeId = nodeSlidePurposeElementId("slide:1");

const snapshot: DeckSnapshot = {
  deck: {
    schemaVersion: "nodeslide.slidelang/v1",
    toolchainVersion: "noderoom-test/1",
    id: "deck:mounted",
    projectId: "room:mounted",
    title: "Mounted deck",
    brief: { prompt: "Test", audience: "Reviewers", purpose: "Proof", successCriteria: ["Pass"] },
    theme: {
      id: "neutral",
      name: "Neutral",
      mode: "light",
      colors: {
        canvas: "#fff",
        ink: "#111",
        muted: "#666",
        accent: "#a40",
        accentSoft: "#fdd",
        insight: "#06c",
        insightInk: "#fff",
        trace: "#639",
        border: "#ddd",
      },
      typography: { display: "Inter", body: "Inter", data: "monospace" },
      defaultRadius: 8,
      spacingUnit: 8,
    },
    slideOrder: ["slide:1"],
    version: 3,
    status: "draft",
    createdAt: 0,
    updatedAt: 1,
  },
  slides: [{
    id: "slide:1",
    deckId: "deck:mounted",
    title: "Opening",
    background: "#fff",
    elementOrder: [mountedTitleId, mountedPurposeId],
    version: 2,
  }],
  elements: [{
    id: mountedTitleId,
    slideId: "slide:1",
    name: "Title",
    kind: "text",
    role: "title",
    bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
    rotation: 0,
    content: "Opening",
    style: {},
    sourceIds: [],
    locked: false,
    exportCapabilities: ["web_native", "pptx_editable"],
    version: 4,
  }, {
    id: mountedPurposeId,
    slideId: "slide:1",
    name: "Purpose",
    kind: "text",
    role: "purpose",
    bbox: { x: 0.1, y: 0.35, width: 0.8, height: 0.2 },
    rotation: 0,
    content: "State the recommendation.",
    style: {},
    sourceIds: [],
    locked: false,
    exportCapabilities: ["web_native", "pptx_editable"],
    version: 2,
  }],
  sources: [],
};

const patch = createNodeRoomNodeSlideReplaceTextCommand({
  snapshot,
  slideId: "slide:1",
  elementId: mountedTitleId,
  text: "Revised opening",
  source: "human",
  summary: "Revise opening",
  id: "patch:mounted",
});

function storyboard(): DeckStoryboard {
  return normalizeCollaborativeDeck({
    deckId: "deck:mounted",
    roomId: "room:mounted",
    title: "Mounted deck",
    audience: "Reviewers",
    objective: "Proof",
    privacy: "room",
    storyboardStatus: "draft",
    slides: [{
      slideId: "slide:1",
      title: "Opening",
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
    planHash: "mounted",
    version: 3,
  }, 3);
}

describe("NodeRoom mounted NodeSlide studio boundary", () => {
  it("mounts the packed controlled shell and routes host commands", () => {
    const onPatch = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <NodeRoomNodeSlideStudioMount
        snapshot={snapshot}
        selection={{ slideId: "slide:1", elementIds: [] }}
        isHost
        onSelectionChange={onSelectionChange}
        onPatch={onPatch}
        onPropose={vi.fn()}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onExport={vi.fn()}
      >
        {(actions) => (
          <>
            <button type="button" onClick={() => actions.patch(patch)}>Patch</button>
            <button type="button" onClick={() => actions.select({ slideId: "slide:1", elementIds: [mountedTitleId] })}>Select</button>
          </>
        )}
      </NodeRoomNodeSlideStudioMount>,
    );

    const mount = screen.getByLabelText("NodeSlide studio mounted in NodeRoom");
    expect(mount.getAttribute("data-nodeslide-package-version")).toBe(NODEROOM_NODESLIDE_PACKAGE_VERSION);
    expect(mount.getAttribute("data-nodeslide-authority")).toBe("noderoom-artifact-cas");
    fireEvent.click(screen.getByText("Patch"));
    fireEvent.click(screen.getByText("Select"));
    expect(onPatch).toHaveBeenCalledWith(patch);
    expect(onSelectionChange).toHaveBeenCalledWith({ slideId: "slide:1", elementIds: [mountedTitleId] });
  });

  it("fails closed for member direct writes while preserving proposal access", () => {
    const onPatch = vi.fn();
    const onPropose = vi.fn();
    render(
      <NodeRoomNodeSlideStudioMount
        snapshot={snapshot}
        selection={{ slideId: "slide:1", elementIds: [] }}
        isHost={false}
        onSelectionChange={vi.fn()}
        onPatch={onPatch}
        onPropose={onPropose}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onExport={vi.fn()}
      >
        {(actions) => (
          <>
            <button type="button" onClick={() => actions.patch(patch)}>Patch as member</button>
            <button type="button" onClick={() => actions.propose(patch)}>Propose as member</button>
          </>
        )}
      </NodeRoomNodeSlideStudioMount>,
    );

    fireEvent.click(screen.getByText("Patch as member"));
    fireEvent.click(screen.getByText("Propose as member"));
    expect(onPatch).not.toHaveBeenCalled();
    expect(onPropose).toHaveBeenCalledWith(patch);
  });

  it("keeps mounted commands separate from the legacy dirty draft and preserves CAS clocks", () => {
    const mountedPatch = vi.fn();
    const mountedPropose = vi.fn();
    render(
      <DeckStoryboardWorkbench
        storyboard={storyboard()}
        onClose={vi.fn()}
        onOpenArtifact={vi.fn()}
        onSaveStoryboard={vi.fn().mockResolvedValue({ ok: true })}
        nodeSlideMount={{
          snapshot,
          busy: false,
          actions: {
            selection: { slideId: "slide:1", elementIds: [] },
            canPatch: true,
            canPropose: true,
            canAccept: false,
            canReject: false,
            canExport: true,
            patch: mountedPatch,
            propose: mountedPropose,
            select: vi.fn(),
            accept: vi.fn(),
            reject: vi.fn(),
            exportDeck: vi.fn(),
          },
        }}
      />,
    );

    fireEvent.change(screen.getByLabelText("NodeSlide title command"), {
      target: { value: "Evidence-backed opening" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply title through NodeSlide" }));
    const command = mountedPatch.mock.calls[0][0];
    expect(command.operations[0]).toMatchObject({
      op: "replace_text",
      elementId: mountedTitleId,
      text: "Evidence-backed opening",
    });
    expect(command.baseDeckVersion).toBe(3);
    expect(command.baseElementVersions[mountedTitleId]).toBe(4);
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("Opening");

    fireEvent.change(screen.getByLabelText("NodeSlide purpose proposal"), {
      target: { value: "Ask the board for a decision." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Propose purpose for review" }));
    expect(mountedPropose.mock.calls[0][0].operations[0]).toMatchObject({
      elementId: mountedPurposeId,
      text: "Ask the board for a decision.",
    });
  });
});
