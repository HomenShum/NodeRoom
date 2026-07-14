import type { Actor, Artifact } from "../../engine/types";
import type { DeckSlidePlan, DeckStoryboard, DeckStoryboardClaim } from "./deckStoryboard";

export const DECK_OBJECT_SCHEMA = 2;
export const DECK_META_ELEMENT_ID = "deck:meta";
export const DECK_ORDER_ELEMENT_ID = "deck:order";
export const DECK_SLIDE_ELEMENT_PREFIX = "deck:slide:";
export const DECK_CLAIM_ELEMENT_PREFIX = "deck:claim:";
export const DECK_COMMENT_ELEMENT_PREFIX = "deck:comment:";

export type DeckStorageMode = "object-v2" | "legacy-v1";

export type DeckComment = {
  schema: 2;
  kind: "comment";
  commentId: string;
  targetObjectId: string;
  slideId: string;
  body: string;
  status: "open" | "resolved";
  author: Actor;
  createdAt: number;
  resolvedAt?: number;
  resolvedBy?: Actor;
};

type DeckMetaObject = {
  schema: 2;
  kind: "deck_meta";
  deckId: string;
  roomId: string;
  title: string;
  audience: string;
  objective: string;
  privacy: DeckStoryboard["privacy"];
  storyboardStatus: DeckStoryboard["storyboardStatus"];
  requiredEvidence: string[];
  unresolvedGaps: string[];
  sourceArtifactIds: string[];
  traceIds: string[];
  proposalIds: string[];
};

type DeckOrderObject = {
  schema: 2;
  kind: "slide_order";
  deckId: string;
  slideIds: string[];
};

export type DeckSlideObject = {
  schema: 2;
  kind: "slide";
  objectId: string;
  slideId: string;
  title: string;
  purpose: string;
  claimIds: string[];
  sourceArtifactIds: string[];
  evidenceIds: string[];
  unresolvedGaps: string[];
  speakerNote?: string;
  status: DeckSlidePlan["status"];
};

export type DeckSlidePatch = {
  schema: 2;
  kind: "slide_patch";
  objectId: string;
  slideId: string;
  changes: {
    title?: string;
    purpose?: string;
    speakerNote?: string;
    status?: DeckSlidePlan["status"];
  };
};

type DeckClaimObject = {
  schema: 2;
  kind: "claim";
  objectId: string;
  slideId: string;
  claim: DeckStoryboardClaim;
};

export type DeckObjectDocument = {
  storyboard: DeckStoryboard;
  objectVersions: Record<string, number>;
  comments: DeckComment[];
};

export type DeckObjectMutation = {
  objectId: string;
  elementId: string;
  kind: "set" | "create" | "delete";
  value?: unknown;
  baseVersion: number;
};

export function deckSlideElementId(slideId: string): string {
  return `${DECK_SLIDE_ELEMENT_PREFIX}${encodeURIComponent(slideId)}`;
}

export function deckClaimElementId(claimId: string): string {
  return `${DECK_CLAIM_ELEMENT_PREFIX}${encodeURIComponent(claimId)}`;
}

export function deckCommentElementId(commentId: string): string {
  return `${DECK_COMMENT_ELEMENT_PREFIX}${encodeURIComponent(commentId)}`;
}

export function deckObjectSeed(storyboard: DeckStoryboard): Array<{ id: string; value: unknown }> {
  return [...deckObjectValues(storyboard)].map(([id, value]) => ({ id, value }));
}

export function deckSlideObjectValue(slide: DeckSlidePlan): DeckSlideObject {
  return {
    schema: DECK_OBJECT_SCHEMA,
    kind: "slide",
    objectId: deckSlideElementId(slide.slideId),
    slideId: slide.slideId,
    title: slide.title,
    purpose: slide.purpose,
    claimIds: slide.claims.map((claim) => claim.claimId),
    sourceArtifactIds: slide.sourceArtifactIds,
    evidenceIds: slide.evidenceIds,
    unresolvedGaps: slide.unresolvedGaps,
    ...(slide.speakerNote ? { speakerNote: slide.speakerNote } : {}),
    status: slide.status,
  };
}

export function readDeckObjectDocument(artifact: Artifact): DeckObjectDocument | null {
  const meta = storedValue<DeckMetaObject>(artifact, DECK_META_ELEMENT_ID);
  const order = storedValue<DeckOrderObject>(artifact, DECK_ORDER_ELEMENT_ID);
  if (!isDeckMeta(meta) || !isDeckOrder(order) || meta.deckId !== order.deckId) return null;

  const slides: DeckSlidePlan[] = [];
  for (const slideId of order.slideIds) {
    const slide = storedValue<DeckSlideObject>(artifact, deckSlideElementId(slideId));
    if (!isDeckSlide(slide) || slide.slideId !== slideId) {
      slides.push({
        slideId,
        title: "Unresolved slide object",
        purpose: "This ordered slide could not be decoded. Restore a prior object version or replace it through governed review.",
        claims: [],
        sourceArtifactIds: [],
        evidenceIds: [],
        unresolvedGaps: [`Invalid or missing object: ${deckSlideElementId(slideId)}`],
        status: "needs_review",
      });
      continue;
    }
    const claims = slide.claimIds.flatMap((claimId): DeckStoryboardClaim[] => {
      const claim = storedValue<DeckClaimObject>(artifact, deckClaimElementId(claimId));
      return isDeckClaim(claim) && claim.slideId === slideId && claim.claim.claimId === claimId ? [claim.claim] : [];
    });
    slides.push({
      slideId,
      title: slide.title,
      purpose: slide.purpose,
      claims,
      sourceArtifactIds: slide.sourceArtifactIds,
      evidenceIds: slide.evidenceIds,
      unresolvedGaps: slide.unresolvedGaps,
      ...(slide.speakerNote ? { speakerNote: slide.speakerNote } : {}),
      status: slide.status,
    });
  }
  if (slides.length === 0) return null;

  const objectVersions = Object.fromEntries(Object.entries(artifact.elements)
    .filter(([elementId]) => isDeckObjectElementId(elementId))
    .map(([elementId, element]) => [elementId, element.version]));
  const comments = Object.entries(artifact.elements)
    .filter(([elementId]) => elementId.startsWith(DECK_COMMENT_ELEMENT_PREFIX))
    .flatMap(([, element]): DeckComment[] => {
      const value = parseValue(element.value);
      return isDeckComment(value) ? [value] : [];
    })
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    storyboard: {
      deckId: meta.deckId,
      roomId: artifact.roomId,
      title: meta.title || artifact.title,
      audience: meta.audience,
      objective: meta.objective,
      privacy: meta.privacy,
      storyboardStatus: meta.storyboardStatus,
      slides,
      requiredEvidence: meta.requiredEvidence,
      unresolvedGaps: meta.unresolvedGaps,
      sourceArtifactIds: meta.sourceArtifactIds,
      traceIds: meta.traceIds,
      proposalIds: meta.proposalIds,
      planHash: "",
      version: Math.max(1, artifact.version),
    },
    objectVersions,
    comments,
  };
}

export function planDeckObjectMutations(input: {
  storageMode: DeckStorageMode;
  current: DeckStoryboard;
  objectVersions: Record<string, number>;
  next: DeckStoryboard;
}): DeckObjectMutation[] {
  const currentValues = input.storageMode === "object-v2" ? deckObjectValues(input.current) : new Map<string, unknown>();
  const nextValues = deckObjectValues(input.next);
  const creates: DeckObjectMutation[] = [];
  const updates: DeckObjectMutation[] = [];
  const orderUpdates: DeckObjectMutation[] = [];
  const deletes: DeckObjectMutation[] = [];

  for (const [elementId, value] of nextValues) {
    const existingVersion = input.objectVersions[elementId];
    if (existingVersion === undefined) {
      creates.push({ objectId: objectIdFor(elementId), elementId, kind: "create", value, baseVersion: 0 });
      continue;
    }
    if (sameValue(currentValues.get(elementId), value)) continue;
    const mutation = { objectId: objectIdFor(elementId), elementId, kind: "set" as const, value, baseVersion: existingVersion };
    if (elementId === DECK_ORDER_ELEMENT_ID) orderUpdates.push(mutation);
    else updates.push(mutation);
  }

  for (const elementId of currentValues.keys()) {
    if (nextValues.has(elementId)) continue;
    const baseVersion = input.objectVersions[elementId];
    if (baseVersion === undefined) continue;
    deletes.push({ objectId: objectIdFor(elementId), elementId, kind: "delete", baseVersion });
  }

  // New objects exist before the order exposes them. Removed objects leave the
  // order before deletion. A conflict can leave an ignored orphan, never a
  // dangling visible reference or a silent overwrite.
  creates.sort((a, b) => storagePhase(a.elementId) - storagePhase(b.elementId));
  updates.sort((a, b) => storagePhase(a.elementId) - storagePhase(b.elementId));
  return [...creates, ...updates, ...orderUpdates, ...deletes];
}

export function createDeckComment(input: {
  commentId: string;
  slideId: string;
  targetObjectId?: string;
  body: string;
  author: Actor;
  createdAt?: number;
}): DeckComment {
  return {
    schema: DECK_OBJECT_SCHEMA,
    kind: "comment",
    commentId: input.commentId,
    targetObjectId: input.targetObjectId ?? deckSlideElementId(input.slideId),
    slideId: input.slideId,
    body: input.body.trim().slice(0, 4_000),
    status: "open",
    author: input.author,
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function resolveDeckComment(comment: DeckComment, actor: Actor, resolvedAt = Date.now()): DeckComment {
  return { ...comment, status: "resolved", resolvedAt, resolvedBy: actor };
}

export function isDeckObjectElementId(elementId: string): boolean {
  return elementId === DECK_META_ELEMENT_ID || elementId === DECK_ORDER_ELEMENT_ID ||
    elementId.startsWith(DECK_SLIDE_ELEMENT_PREFIX) || elementId.startsWith(DECK_CLAIM_ELEMENT_PREFIX) ||
    elementId.startsWith(DECK_COMMENT_ELEMENT_PREFIX);
}

export function isDeckStoredObject(value: unknown): boolean {
  return isDeckMeta(value) || isDeckOrder(value) || isDeckSlide(value) || isDeckClaim(value) || isDeckComment(value);
}

export function isDeckProposalObject(value: unknown): boolean {
  return isDeckStoredObject(value) || isDeckSlidePatch(value);
}

function deckObjectValues(storyboard: DeckStoryboard): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const meta: DeckMetaObject = {
    schema: DECK_OBJECT_SCHEMA,
    kind: "deck_meta",
    deckId: storyboard.deckId,
    roomId: storyboard.roomId,
    title: storyboard.title,
    audience: storyboard.audience,
    objective: storyboard.objective,
    privacy: storyboard.privacy,
    storyboardStatus: storyboard.storyboardStatus,
    requiredEvidence: storyboard.requiredEvidence,
    unresolvedGaps: storyboard.unresolvedGaps,
    sourceArtifactIds: storyboard.sourceArtifactIds,
    traceIds: storyboard.traceIds,
    proposalIds: storyboard.proposalIds,
  };
  const order: DeckOrderObject = { schema: DECK_OBJECT_SCHEMA, kind: "slide_order", deckId: storyboard.deckId, slideIds: storyboard.slides.map((slide) => slide.slideId) };
  values.set(DECK_META_ELEMENT_ID, meta);
  for (const slide of storyboard.slides) {
    const slideObject = deckSlideObjectValue(slide);
    values.set(deckSlideElementId(slide.slideId), slideObject);
    for (const claim of slide.claims) {
      values.set(deckClaimElementId(claim.claimId), {
        schema: DECK_OBJECT_SCHEMA,
        kind: "claim",
        objectId: deckClaimElementId(claim.claimId),
        slideId: slide.slideId,
        claim,
      } satisfies DeckClaimObject);
    }
  }
  // Order is committed last by planDeckObjectMutations so partially-created
  // objects are not visible if an earlier write fails.
  values.set(DECK_ORDER_ELEMENT_ID, order);
  return values;
}

function storedValue<T>(artifact: Artifact, elementId: string): T | null {
  return parseValue(artifact.elements[elementId]?.value) as T | null;
}

function parseValue(value: unknown): unknown {
  let parsed = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof parsed === "string") {
      try {
        parsed = JSON.parse(parsed);
        continue;
      } catch {
        return null;
      }
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      if (!("schema" in record) && "value" in record) {
        parsed = record.value;
        continue;
      }
      if (!("schema" in record) && "afterValue" in record) {
        parsed = record.afterValue;
        continue;
      }
    }
    break;
  }
  return parsed;
}

function objectIdFor(elementId: string): string {
  return elementId;
}

function storagePhase(elementId: string): number {
  if (elementId.startsWith(DECK_CLAIM_ELEMENT_PREFIX)) return 0;
  if (elementId.startsWith(DECK_SLIDE_ELEMENT_PREFIX)) return 1;
  if (elementId === DECK_META_ELEMENT_ID) return 2;
  if (elementId === DECK_ORDER_ELEMENT_ID) return 3;
  return 4;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isDeckMeta(value: unknown): value is DeckMetaObject {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DeckMetaObject>;
  return row.schema === DECK_OBJECT_SCHEMA && row.kind === "deck_meta" && typeof row.deckId === "string" &&
    typeof row.roomId === "string" && typeof row.title === "string" && typeof row.audience === "string" &&
    typeof row.objective === "string" && isDeckPrivacy(row.privacy) && isDeckStatus(row.storyboardStatus) &&
    stringArray(row.sourceArtifactIds) && stringArray(row.traceIds) &&
    stringArray(row.proposalIds) && stringArray(row.requiredEvidence) && stringArray(row.unresolvedGaps);
}

function isDeckOrder(value: unknown): value is DeckOrderObject {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DeckOrderObject>;
  return row.schema === DECK_OBJECT_SCHEMA && row.kind === "slide_order" && typeof row.deckId === "string" && stringArray(row.slideIds);
}

function isDeckSlide(value: unknown): value is DeckSlideObject {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DeckSlideObject>;
  return row.schema === DECK_OBJECT_SCHEMA && row.kind === "slide" && typeof row.objectId === "string" &&
    typeof row.slideId === "string" && typeof row.title === "string" && typeof row.purpose === "string" &&
    stringArray(row.claimIds) && stringArray(row.sourceArtifactIds) && stringArray(row.evidenceIds) && stringArray(row.unresolvedGaps) &&
    isDeckStatus(row.status) && (row.speakerNote === undefined || typeof row.speakerNote === "string");
}

function isDeckSlidePatch(value: unknown): value is DeckSlidePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<DeckSlidePatch>;
  if (String(row.schema) !== String(DECK_OBJECT_SCHEMA) || row.kind !== "slide_patch" || typeof row.objectId !== "string" ||
    typeof row.slideId !== "string" || !row.changes || typeof row.changes !== "object" || Array.isArray(row.changes)) return false;
  const changes = row.changes as Record<string, unknown>;
  const keys = Object.keys(changes);
  if (keys.length === 0 || keys.some((key) => !["title", "purpose", "speakerNote", "status"].includes(key))) return false;
  return (changes.title === undefined || typeof changes.title === "string") &&
    (changes.purpose === undefined || typeof changes.purpose === "string") &&
    (changes.speakerNote === undefined || typeof changes.speakerNote === "string") &&
    (changes.status === undefined || isDeckStatus(changes.status));
}

function isDeckClaim(value: unknown): value is DeckClaimObject {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DeckClaimObject>;
  return row.schema === DECK_OBJECT_SCHEMA && row.kind === "claim" && typeof row.objectId === "string" &&
    typeof row.slideId === "string" && !!row.claim && typeof row.claim.claimId === "string" &&
    typeof row.claim.text === "string" && isClaimStatus(row.claim.status);
}

function isDeckComment(value: unknown): value is DeckComment {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<DeckComment>;
  return row.schema === DECK_OBJECT_SCHEMA && row.kind === "comment" && typeof row.commentId === "string" &&
    typeof row.targetObjectId === "string" && typeof row.slideId === "string" && typeof row.body === "string" &&
    (row.status === "open" || row.status === "resolved") && typeof row.createdAt === "number" && !!row.author;
}

function isDeckPrivacy(value: unknown): value is DeckStoryboard["privacy"] {
  return value === "room" || value === "private" || value === "public";
}

function isDeckStatus(value: unknown): value is DeckStoryboard["storyboardStatus"] {
  return value === "draft" || value === "approved" || value === "needs_review";
}

function isClaimStatus(value: unknown): value is DeckStoryboardClaim["status"] {
  return value === "verified" || value === "manual" || value === "needs_review";
}
