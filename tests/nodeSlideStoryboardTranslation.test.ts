import { describe, expect, it } from "vitest";
import type { Artifact } from "../src/engine/types";
import {
  NodeRoomNodeSlideCasError,
  nodeSlidePurposeElementId,
  planNodeSlidePatchForNodeRoom,
  translateNodeRoomArtifactToNodeSlide,
  validateNodeRoomNodeSlideSnapshot,
  type NodeRoomNodeSlidePatchCommand,
} from "../src/integrations/nodeslide/storyboardTranslation";
import {
  buildDeckStoryboardFromRoom,
  collaborativeDeckArtifactInput,
  deckClaimElementId,
  deckSlideElementId,
} from "../src/ui/workArtifacts";

const actor = { kind: "user" as const, id: "member:host", name: "Maya" };
const source: Artifact = {
  id: "source:research",
  roomId: "room:1",
  kind: "sheet",
  title: "Company research",
  version: 1,
  elements: {
    A1: { id: "A1", version: 1, value: "CardioNova", updatedAt: 1, updatedBy: actor },
  },
  order: ["A1"],
  updatedAt: 1,
};

function deckArtifact(): Artifact {
  const storyboard = buildDeckStoryboardFromRoom({
    roomId: "room:1",
    roomTitle: "Diligence",
    artifacts: [source],
  });
  const input = collaborativeDeckArtifactInput(storyboard);
  return {
    id: "artifact:deck",
    roomId: "room:1",
    kind: input.kind,
    title: input.title,
    version: 7,
    order: input.seed.map((entry) => entry.id),
    elements: Object.fromEntries(input.seed.map((entry, index) => [entry.id, {
      id: entry.id,
      value: entry.value,
      version: index + 2,
      updatedAt: 10 + index,
      updatedBy: actor,
    }])),
    updatedAt: 20,
    createdBy: actor,
    visibility: "room",
    meta: input.meta,
  };
}

function replaceCommand(artifact: Artifact, elementId: string, version: number): NodeRoomNodeSlidePatchCommand {
  const { snapshot } = translateNodeRoomArtifactToNodeSlide(artifact);
  const slideId = snapshot.deck.slideOrder[0];
  return {
    id: "patch:1",
    deckId: artifact.id,
    baseDeckVersion: artifact.version,
    baseSlideVersions: { [slideId]: snapshot.slides[0].version },
    baseElementVersions: { [elementId]: version },
    scope: { kind: "elements", deckId: artifact.id, slideIds: [slideId], elementIds: [elementId], operationMode: "copy" },
    operations: [{ op: "replace_text", slideId, elementId, text: "Updated source-backed claim" }],
    source: "human",
    summary: "Update one claim",
  };
}

describe("NodeRoom storyboard to NodeSlide translation", () => {
  it("emits a valid, deterministic, loss-aware NodeSlide snapshot", () => {
    const artifact = deckArtifact();
    const first = translateNodeRoomArtifactToNodeSlide(artifact);
    const second = translateNodeRoomArtifactToNodeSlide(artifact);
    expect(first).toEqual(second);
    expect(() => validateNodeRoomNodeSlideSnapshot(first.snapshot)).not.toThrow();
    expect(first.snapshot.deck).toMatchObject({
      schemaVersion: "nodeslide.slidelang/v1",
      id: artifact.id,
      projectId: artifact.roomId,
      version: artifact.version,
    });
    expect(first.receipt).toMatchObject({
      schemaVersion: "noderoom.nodeslide.translation/v1",
      artifactId: artifact.id,
      synthesized: ["theme", "text_layout", "source_labels"],
      unsupportedRoundTrips: ["freeform_geometry", "element_style", "charts", "images", "video", "math"],
    });
    expect(first.snapshot.elements.some((element) => element.role.startsWith("claim:"))).toBe(true);
  });

  it("translates one claim edit to the existing object-CAS element", () => {
    const artifact = deckArtifact();
    const mounted = translateNodeRoomArtifactToNodeSlide(artifact).snapshot;
    const slide = mounted.slides[0];
    const claim = mounted.elements.find((element) => element.slideId === slide.id && element.role.startsWith("claim:"));
    if (!claim) throw new Error("claim element missing");
    const mutation = planNodeSlidePatchForNodeRoom(artifact, replaceCommand(artifact, claim.id, claim.version));
    expect(mutation).toMatchObject({
      elementId: deckClaimElementId(decodeURIComponent(claim.id.slice("noderoom:claim:".length))),
      kind: "set",
      baseVersion: claim.version,
      nodeSlideElementId: claim.id,
      slideId: slide.id,
    });
    expect(mutation.value).toMatchObject({
      schema: 2,
      kind: "claim",
      claim: { text: "Updated source-backed claim" },
    });
  });

  it("maps purpose edits to slide objects and fails closed on stale or unsupported patches", () => {
    const artifact = deckArtifact();
    const translated = translateNodeRoomArtifactToNodeSlide(artifact).snapshot;
    const slide = translated.slides[0];
    const purposeId = nodeSlidePurposeElementId(slide.id);
    const purpose = translated.elements.find((element) => element.id === purposeId)!;
    const command = replaceCommand(artifact, purposeId, purpose.version);
    expect(planNodeSlidePatchForNodeRoom(artifact, command)).toMatchObject({
      elementId: deckSlideElementId(slide.id),
      baseVersion: purpose.version,
    });

    const stale = { ...command, baseElementVersions: { [purposeId]: purpose.version - 1 } };
    expect(() => planNodeSlidePatchForNodeRoom(artifact, stale)).toThrow(NodeRoomNodeSlideCasError);
    const unsupported = { ...command, operations: [{ ...command.operations[0], op: "update_style" }] } as unknown as NodeRoomNodeSlidePatchCommand;
    expect(() => planNodeSlidePatchForNodeRoom(artifact, unsupported)).toThrow("nodeslide_patch_unsupported_operation");
  });
});
