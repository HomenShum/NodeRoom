import type {
  DeckSnapshot,
  PatchOperation,
  SlideElement,
  ThemeSpec,
} from "@nodeslide/contracts";
import type { NodeSlidePatchCommand } from "@nodeslide/backend";
import type { Artifact } from "../../engine/types";
import {
  readCollaborativeDeckArtifact,
  type CollaborativeDeckSnapshot,
} from "../../ui/workArtifacts/collaborativeDeck";
import {
  deckClaimElementId,
  deckSlideElementId,
  deckSlideObjectValue,
} from "../../ui/workArtifacts/deckObjectModel";
import type { DeckStoryboardClaim } from "../../ui/workArtifacts/deckStoryboard";

export const NODEROOM_NODESLIDE_TRANSLATION_VERSION =
  "noderoom.nodeslide.translation/v1" as const;
export const NODESLIDE_SCHEMA_VERSION = "nodeslide.slidelang/v1" as const;

export type NodeRoomNodeSlidePatchOperation = Extract<PatchOperation, { op: "replace_text" }>;
export type NodeRoomNodeSlidePatchCommand = NodeSlidePatchCommand;
export type NodeRoomNodeSlideSnapshot = DeckSnapshot;

export interface NodeRoomNodeSlideTranslationReceipt {
  schemaVersion: typeof NODEROOM_NODESLIDE_TRANSLATION_VERSION;
  artifactId: string;
  storyboardPlanHash: string;
  artifactVersion: number;
  objectVersions: Record<string, number>;
  preserved: readonly [
    "stable_slide_ids",
    "stable_claim_ids",
    "claim_text",
    "claim_source_ids",
    "speaker_notes",
    "per_object_cas_versions",
  ];
  synthesized: readonly ["theme", "text_layout", "source_labels"];
  unsupportedRoundTrips: readonly [
    "freeform_geometry",
    "element_style",
    "charts",
    "images",
    "video",
    "math",
  ];
  fingerprint: string;
}

export interface NodeRoomDeckObjectMutation {
  elementId: string;
  kind: "set";
  value: unknown;
  baseVersion: number;
  nodeSlideElementId: string;
  slideId: string;
}

type NodeRoomNodeSlideTheme = ThemeSpec;
type NodeRoomNodeSlideElement = SlideElement & {
  kind: "text";
  role: "title" | "purpose" | `claim:${DeckStoryboardClaim["status"]}`;
  rotation: 0;
  locked: false;
};

const THEME: NodeRoomNodeSlideTheme = {
  id: "noderoom-neutral",
  name: "NodeRoom neutral",
  mode: "light",
  colors: {
    canvas: "#F8F5EF",
    ink: "#201B18",
    muted: "#756B64",
    accent: "#8F3F27",
    accentSoft: "#EAD8CF",
    insight: "#315DA8",
    insightInk: "#FFFFFF",
    trace: "#6D3FB2",
    border: "#D9D0C8",
  },
  typography: { display: "Inter", body: "Inter", data: "ui-monospace" },
  defaultRadius: 8,
  spacingUnit: 8,
};

export function translateNodeRoomArtifactToNodeSlide(artifact: Artifact): {
  snapshot: NodeRoomNodeSlideSnapshot;
  receipt: NodeRoomNodeSlideTranslationReceipt;
} {
  const mounted = requireMountedDeck(artifact);
  const { storyboard, objectVersions } = mounted;
  const elements: NodeRoomNodeSlideElement[] = [];
  const slides = storyboard.slides.map((slide) => {
    const slideObjectVersion = objectVersions[deckSlideElementId(slide.slideId)] ?? 0;
    const titleId = nodeSlideTitleElementId(slide.slideId);
    const purposeId = nodeSlidePurposeElementId(slide.slideId);
    elements.push(textElement({
      id: titleId,
      slideId: slide.slideId,
      name: `${slide.title} title`,
      role: "title",
      content: slide.title,
      bbox: { x: 0.08, y: 0.08, width: 0.84, height: 0.12 },
      sourceIds: slide.sourceArtifactIds,
      version: slideObjectVersion,
      fontSize: 30,
      fontWeight: 700,
    }));
    elements.push(textElement({
      id: purposeId,
      slideId: slide.slideId,
      name: `${slide.title} purpose`,
      role: "purpose",
      content: slide.purpose,
      bbox: { x: 0.08, y: 0.22, width: 0.84, height: 0.11 },
      sourceIds: slide.sourceArtifactIds,
      version: slideObjectVersion,
      fontSize: 15,
      fontWeight: 500,
    }));
    const claimHeight = Math.min(0.14, 0.54 / Math.max(1, slide.claims.length));
    slide.claims.forEach((claim, claimIndex) => {
      elements.push(textElement({
        id: nodeSlideClaimElementId(claim.claimId),
        slideId: slide.slideId,
        name: `${slide.title} claim ${claimIndex + 1}`,
        role: `claim:${claim.status}`,
        content: claim.text,
        bbox: {
          x: 0.1,
          y: 0.39 + claimIndex * (claimHeight + 0.025),
          width: 0.8,
          height: claimHeight,
        },
        sourceIds: [claim.sourceArtifactId, claim.evidenceId].filter((value): value is string => Boolean(value)),
        version: objectVersions[deckClaimElementId(claim.claimId)] ?? 0,
        fontSize: 16,
        fontWeight: 400,
      }));
    });
    return {
      id: slide.slideId,
      deckId: artifact.id,
      title: slide.title,
      ...(slide.speakerNote ? { notes: slide.speakerNote } : {}),
      background: THEME.colors.canvas,
      elementOrder: [
        titleId,
        purposeId,
        ...slide.claims.map((claim) => nodeSlideClaimElementId(claim.claimId)),
      ],
      version: slideObjectVersion,
    };
  });
  const snapshot: NodeRoomNodeSlideSnapshot = {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: "noderoom-storyboard-adapter/1.0.0",
      id: artifact.id,
      projectId: storyboard.roomId,
      title: storyboard.title,
      brief: {
        prompt: storyboard.objective,
        audience: storyboard.audience,
        purpose: storyboard.objective,
        successCriteria: storyboard.requiredEvidence.length
          ? storyboard.requiredEvidence
          : ["Preserve source-backed claims and stable object identities."],
      },
      theme: THEME,
      slideOrder: storyboard.slides.map((slide) => slide.slideId),
      version: artifact.version,
      status: storyboard.storyboardStatus === "approved" ? "ready" : "draft",
      createdAt: 0,
      updatedAt: artifact.updatedAt,
    },
    slides,
    elements,
    sources: storyboard.sourceArtifactIds.map((sourceId) => ({
      id: sourceId,
      deckId: artifact.id,
      title: `NodeRoom artifact ${sourceId}`,
      sourceType: "internal",
      retrievedAt: artifact.updatedAt,
      citation: `NodeRoom room artifact ${sourceId}`,
      status: "ready",
    })),
  };
  const receiptBody = {
    artifactId: artifact.id,
    storyboardPlanHash: storyboard.planHash,
    artifactVersion: artifact.version,
    objectVersions,
  };
  const receipt: NodeRoomNodeSlideTranslationReceipt = {
    schemaVersion: NODEROOM_NODESLIDE_TRANSLATION_VERSION,
    ...receiptBody,
    preserved: [
      "stable_slide_ids",
      "stable_claim_ids",
      "claim_text",
      "claim_source_ids",
      "speaker_notes",
      "per_object_cas_versions",
    ],
    synthesized: ["theme", "text_layout", "source_labels"],
    unsupportedRoundTrips: [
      "freeform_geometry",
      "element_style",
      "charts",
      "images",
      "video",
      "math",
    ],
    fingerprint: stableFingerprint(receiptBody),
  };
  validateNodeRoomNodeSlideSnapshot(snapshot);
  return { snapshot, receipt };
}

export function planNodeSlidePatchForNodeRoom(
  artifact: Artifact,
  patch: NodeRoomNodeSlidePatchCommand,
): NodeRoomDeckObjectMutation {
  const mounted = requireMountedDeck(artifact);
  if (patch.deckId !== artifact.id || patch.scope.deckId !== artifact.id) {
    throw new Error("nodeslide_patch_deck_mismatch");
  }
  if (patch.operations.length !== 1 || patch.operations[0]?.op !== "replace_text") {
    throw new Error("nodeslide_patch_unsupported_operation");
  }
  const operation = patch.operations[0];
  const text = canonicalText(operation.text);
  const slide = mounted.storyboard.slides.find((candidate) => candidate.slideId === operation.slideId);
  if (!slide) throw new Error("nodeslide_patch_slide_not_found");
  if (!slideElementIds(slide).includes(operation.elementId)) {
    throw new Error("nodeslide_patch_element_scope_mismatch");
  }
  if (
    patch.scope.kind === "elements" &&
    (!patch.scope.elementIds?.includes(operation.elementId) || !patch.scope.slideIds?.includes(operation.slideId))
  ) {
    throw new Error("nodeslide_patch_declared_scope_mismatch");
  }

  let elementId: string;
  let value: unknown;
  if (operation.elementId === nodeSlideTitleElementId(slide.slideId)) {
    elementId = deckSlideElementId(slide.slideId);
    value = deckSlideObjectValue({ ...slide, title: text });
  } else if (operation.elementId === nodeSlidePurposeElementId(slide.slideId)) {
    elementId = deckSlideElementId(slide.slideId);
    value = deckSlideObjectValue({ ...slide, purpose: text });
  } else {
    const claim = slide.claims.find(
      (candidate) => nodeSlideClaimElementId(candidate.claimId) === operation.elementId,
    );
    if (!claim) throw new Error("nodeslide_patch_claim_not_found");
    elementId = deckClaimElementId(claim.claimId);
    value = {
      schema: 2,
      kind: "claim",
      objectId: elementId,
      slideId: slide.slideId,
      claim: {
        ...claim,
        text,
        ...(operation.sourceIds ? { sourceArtifactId: operation.sourceIds[0] } : {}),
      },
    };
  }
  const baseVersion = mounted.objectVersions[elementId];
  if (baseVersion === undefined) throw new Error("nodeslide_patch_object_version_missing");
  const assertedVersion = patch.baseElementVersions[operation.elementId];
  if (assertedVersion === undefined || assertedVersion !== baseVersion) {
    throw new NodeRoomNodeSlideCasError(assertedVersion ?? -1, baseVersion);
  }
  return {
    elementId,
    kind: "set",
    value,
    baseVersion,
    nodeSlideElementId: operation.elementId,
    slideId: slide.slideId,
  };
}

export class NodeRoomNodeSlideCasError extends Error {
  constructor(readonly expected: number, readonly actual: number) {
    super(`nodeslide_patch_conflict:${expected}:${actual}`);
    this.name = "NodeRoomNodeSlideCasError";
  }
}

export function validateNodeRoomNodeSlideSnapshot(snapshot: NodeRoomNodeSlideSnapshot): void {
  if (snapshot.deck.schemaVersion !== NODESLIDE_SCHEMA_VERSION) throw new Error("nodeslide_snapshot_schema_invalid");
  if (new Set(snapshot.deck.slideOrder).size !== snapshot.deck.slideOrder.length) throw new Error("nodeslide_snapshot_slide_order_duplicate");
  const slides = new Map(snapshot.slides.map((slide) => [slide.id, slide]));
  const elements = new Map(snapshot.elements.map((element) => [element.id, element]));
  if (slides.size !== snapshot.slides.length || elements.size !== snapshot.elements.length) throw new Error("nodeslide_snapshot_duplicate_id");
  for (const slideId of snapshot.deck.slideOrder) {
    const slide = slides.get(slideId);
    if (!slide || slide.deckId !== snapshot.deck.id) throw new Error("nodeslide_snapshot_slide_reference_invalid");
    for (const elementId of slide.elementOrder) {
      const element = elements.get(elementId);
      if (!element || element.slideId !== slideId) throw new Error("nodeslide_snapshot_element_reference_invalid");
    }
  }
  for (const element of snapshot.elements) {
    const { x, y, width, height } = element.bbox;
    if ([x, y, width, height].some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error("nodeslide_snapshot_bbox_invalid");
    }
    if (!Number.isSafeInteger(element.version) || element.version < 0) throw new Error("nodeslide_snapshot_version_invalid");
  }
}

export function nodeSlideTitleElementId(slideId: string): string {
  return `noderoom:title:${encodeURIComponent(slideId)}`;
}

export function nodeSlidePurposeElementId(slideId: string): string {
  return `noderoom:purpose:${encodeURIComponent(slideId)}`;
}

export function nodeSlideClaimElementId(claimId: string): string {
  return `noderoom:claim:${encodeURIComponent(claimId)}`;
}

/**
 * Builds the narrow command accepted by NodeRoom's mounted production adapter.
 * All CAS clocks come from the translated snapshot; callers cannot invent a
 * version while moving a visible edit through the controlled React surface.
 */
export function createNodeRoomNodeSlideReplaceTextCommand(input: {
  snapshot: NodeRoomNodeSlideSnapshot;
  slideId: string;
  elementId: string;
  text: string;
  source: "human" | "agent";
  summary: string;
  id?: string;
  traceId?: string;
}): NodeRoomNodeSlidePatchCommand {
  const slide = input.snapshot.slides.find((candidate) => candidate.id === input.slideId);
  const element = input.snapshot.elements.find((candidate) => candidate.id === input.elementId);
  if (!slide || !element || element.slideId !== slide.id || !slide.elementOrder.includes(element.id)) {
    throw new Error("nodeslide_patch_element_scope_mismatch");
  }
  const text = canonicalText(input.text);
  return {
    id: input.id ?? crypto.randomUUID(),
    deckId: input.snapshot.deck.id,
    baseDeckVersion: input.snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [element.id]: element.version },
    scope: {
      kind: "elements",
      deckId: input.snapshot.deck.id,
      slideIds: [slide.id],
      elementIds: [element.id],
      operationMode: "copy",
    },
    operations: [{
      op: "replace_text",
      slideId: slide.id,
      elementId: element.id,
      text,
      ...(element.sourceIds.length > 0 ? { sourceIds: [...element.sourceIds] } : {}),
    }],
    source: input.source,
    summary: canonicalText(input.summary),
    ...(input.traceId ? { traceId: input.traceId } : {}),
  };
}

function requireMountedDeck(artifact: Artifact): CollaborativeDeckSnapshot {
  const mounted = readCollaborativeDeckArtifact(artifact);
  if (!mounted) throw new Error("nodeslide_collaborative_deck_required");
  if (mounted.storageMode !== "object-v2") throw new Error("nodeslide_object_v2_required");
  return mounted;
}

function slideElementIds(slide: CollaborativeDeckSnapshot["storyboard"]["slides"][number]): string[] {
  return [
    nodeSlideTitleElementId(slide.slideId),
    nodeSlidePurposeElementId(slide.slideId),
    ...slide.claims.map((claim) => nodeSlideClaimElementId(claim.claimId)),
  ];
}

function textElement(input: {
  id: string;
  slideId: string;
  name: string;
  role: NodeRoomNodeSlideElement["role"];
  content: string;
  bbox: NodeRoomNodeSlideElement["bbox"];
  sourceIds: string[];
  version: number;
  fontSize: number;
  fontWeight: number;
}): NodeRoomNodeSlideElement {
  return {
    id: input.id,
    slideId: input.slideId,
    name: input.name,
    kind: "text",
    role: input.role,
    bbox: input.bbox,
    rotation: 0,
    content: input.content,
    style: {
      color: THEME.colors.ink,
      fontFamily: THEME.typography.body,
      fontSize: input.fontSize,
      fontWeight: input.fontWeight,
      lineHeight: 1.2,
      padding: 4,
    },
    sourceIds: input.sourceIds,
    locked: false,
    exportCapabilities: ["web_native", "pptx_editable", "google_importable"],
    version: input.version,
  };
}

function canonicalText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > 4_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw new Error("nodeslide_patch_text_invalid");
  }
  return text;
}

function stableFingerprint(value: unknown): string {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
