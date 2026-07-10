import type { UploadedArtifactInput } from "../../app/uploadedArtifact";
import type { Artifact } from "../../engine/types";
import type { DeckSlidePlan, DeckStoryboard } from "./deckStoryboard";

export const COLLABORATIVE_DECK_TAG = "noderoom:deck";
export const DECK_STORYBOARD_ELEMENT_ID = "deck_storyboard";

export type CollaborativeDeckSnapshot = {
  artifactId: string;
  elementVersion: number;
  storyboard: DeckStoryboard;
};

export function isCollaborativeDeckArtifact(artifact: Artifact): boolean {
  return artifact.kind === "note" && (
    artifact.meta?.tags?.includes(COLLABORATIVE_DECK_TAG) === true ||
    DECK_STORYBOARD_ELEMENT_ID in artifact.elements
  );
}

export function readCollaborativeDeckArtifact(artifact: Artifact): CollaborativeDeckSnapshot | null {
  if (!isCollaborativeDeckArtifact(artifact)) return null;
  const element = artifact.elements[DECK_STORYBOARD_ELEMENT_ID];
  if (!element) return null;
  const value = parseValue(element.value);
  if (!isDeckStoryboard(value)) return null;
  return {
    artifactId: artifact.id,
    elementVersion: element.version,
    storyboard: normalizeCollaborativeDeck({
      ...value,
      roomId: artifact.roomId,
      title: value.title || artifact.title,
    }, value.version),
  };
}

export function collaborativeDeckArtifactInput(storyboard: DeckStoryboard): UploadedArtifactInput {
  const normalized = normalizeCollaborativeDeck(storyboard, Math.max(1, storyboard.version));
  return {
    kind: "note",
    title: normalized.title,
    seed: [
      { id: "doc", value: deckSummaryHtml(normalized) },
      { id: DECK_STORYBOARD_ELEMENT_ID, value: normalized },
    ],
    meta: {
      summary: `${normalized.slides.length} slide collaborative storyboard with ${normalized.requiredEvidence.length} evidence gap(s).`,
      tags: [COLLABORATIVE_DECK_TAG, "storyboard", "work-artifact"],
    },
  };
}

export function normalizeCollaborativeDeck(storyboard: DeckStoryboard, version = storyboard.version): DeckStoryboard {
  const slides = storyboard.slides.map((slide, index) => normalizeSlide(slide, index));
  const requiredEvidence = unique(slides.flatMap((slide) => slide.claims
    .filter((claim) => claim.status !== "verified")
    .map((claim) => `${slide.title}: ${claim.text}`)));
  const unresolvedGaps = unique([...slides.flatMap((slide) => slide.unresolvedGaps), ...requiredEvidence]).slice(0, 80);
  const sourceArtifactIds = unique(slides.flatMap((slide) => slide.sourceArtifactIds));
  const traceIds = unique([...storyboard.traceIds, ...slides.flatMap((slide) => slide.claims.map((claim) => claim.traceId))]);
  const proposalIds = unique([...storyboard.proposalIds, ...slides.flatMap((slide) => slide.claims.map((claim) => claim.proposalId))]);
  const storyboardStatus: DeckStoryboard["storyboardStatus"] = slides.some((slide) => slide.status === "needs_review" || slide.claims.some((claim) => claim.status !== "verified"))
    ? "needs_review"
    : storyboard.storyboardStatus === "approved"
      ? "approved"
      : "draft";
  const draft = {
    roomId: storyboard.roomId,
    title: storyboard.title.trim() || "Room readout",
    audience: storyboard.audience.trim() || "room reviewers",
    objective: storyboard.objective.trim() || "Turn room evidence into a reviewable narrative.",
    privacy: storyboard.privacy,
    storyboardStatus,
    slides,
    requiredEvidence,
    unresolvedGaps,
    sourceArtifactIds,
    traceIds,
    proposalIds,
    version: Math.max(1, version),
  };
  return {
    deckId: storyboard.deckId,
    ...draft,
    planHash: stableHash({ deckId: storyboard.deckId, ...draft }),
  };
}

export function addCollaborativeDeckSlide(storyboard: DeckStoryboard, afterSlideId?: string): DeckStoryboard {
  const next = cloneStoryboard(storyboard);
  const index = afterSlideId ? Math.max(0, next.slides.findIndex((slide) => slide.slideId === afterSlideId) + 1) : next.slides.length;
  const ordinal = next.slides.length + 1;
  next.slides.splice(index, 0, {
    slideId: uniqueSlideId(next.slides, `slide-${ordinal}-new`),
    title: `New slide ${ordinal}`,
    purpose: "Define the point this slide must prove.",
    claims: [],
    sourceArtifactIds: [],
    evidenceIds: [],
    unresolvedGaps: ["Add a source-backed claim."],
    status: "needs_review",
  });
  return normalizeCollaborativeDeck(next, next.version + 1);
}

export function duplicateCollaborativeDeckSlide(storyboard: DeckStoryboard, slideId: string): DeckStoryboard {
  const next = cloneStoryboard(storyboard);
  const index = next.slides.findIndex((slide) => slide.slideId === slideId);
  if (index < 0) return storyboard;
  const source = next.slides[index];
  const copy = cloneSlide(source);
  copy.slideId = uniqueSlideId(next.slides, `${source.slideId}-copy`);
  copy.title = `${source.title} copy`;
  copy.claims = copy.claims.map((claim, claimIndex) => ({ ...claim, claimId: `${copy.slideId}-claim-${claimIndex + 1}` }));
  next.slides.splice(index + 1, 0, copy);
  return normalizeCollaborativeDeck(next, next.version + 1);
}

export function deleteCollaborativeDeckSlide(storyboard: DeckStoryboard, slideId: string): DeckStoryboard {
  if (storyboard.slides.length <= 1) return storyboard;
  const next = cloneStoryboard(storyboard);
  next.slides = next.slides.filter((slide) => slide.slideId !== slideId);
  return normalizeCollaborativeDeck(next, next.version + 1);
}

export function moveCollaborativeDeckSlide(storyboard: DeckStoryboard, slideId: string, direction: -1 | 1): DeckStoryboard {
  const next = cloneStoryboard(storyboard);
  const index = next.slides.findIndex((slide) => slide.slideId === slideId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= next.slides.length) return storyboard;
  [next.slides[index], next.slides[target]] = [next.slides[target], next.slides[index]];
  return normalizeCollaborativeDeck(next, next.version + 1);
}

export function cloneStoryboard(storyboard: DeckStoryboard): DeckStoryboard {
  return JSON.parse(JSON.stringify(storyboard)) as DeckStoryboard;
}

function normalizeSlide(slide: DeckSlidePlan, index: number): DeckSlidePlan {
  const slideId = slide.slideId || `slide-${index + 1}`;
  const claims = slide.claims.map((claim, claimIndex) => ({
    ...claim,
    claimId: claim.claimId || `${slideId}-claim-${claimIndex + 1}`,
    text: claim.text.trim(),
  })).filter((claim) => claim.text.length > 0);
  const unresolvedGaps = unique(slide.unresolvedGaps.map((gap) => gap.trim()).filter(Boolean));
  return {
    ...slide,
    slideId,
    title: slide.title.trim() || `Slide ${index + 1}`,
    purpose: slide.purpose.trim() || "Define the point this slide must prove.",
    claims,
    sourceArtifactIds: unique(slide.sourceArtifactIds),
    evidenceIds: unique(slide.evidenceIds),
    unresolvedGaps,
    status: unresolvedGaps.length > 0 || claims.some((claim) => claim.status !== "verified") ? "needs_review" : slide.status,
  };
}

function cloneSlide(slide: DeckSlidePlan): DeckSlidePlan {
  return JSON.parse(JSON.stringify(slide)) as DeckSlidePlan;
}

function uniqueSlideId(slides: DeckSlidePlan[], base: string): string {
  const ids = new Set(slides.map((slide) => slide.slideId));
  let candidate = base;
  let suffix = 2;
  while (ids.has(candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function deckSummaryHtml(storyboard: DeckStoryboard): string {
  const slides = storyboard.slides.map((slide, index) => `<li><strong>${escapeHtml(String(index + 1))}. ${escapeHtml(slide.title)}</strong> - ${escapeHtml(slide.purpose)}</li>`).join("");
  return `<h1>${escapeHtml(storyboard.title)}</h1><p>${escapeHtml(storyboard.objective)}</p><h2>Storyboard</h2><ol>${slides}</ol><p>This note carries a governed collaborative deck in its deck_storyboard element.</p>`;
}

function parseValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

function isDeckStoryboard(value: unknown): value is DeckStoryboard {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeckStoryboard>;
  return typeof candidate.deckId === "string" &&
    typeof candidate.roomId === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.audience === "string" &&
    typeof candidate.objective === "string" &&
    Array.isArray(candidate.slides) &&
    candidate.slides.every((slide) => Boolean(slide) && typeof slide.slideId === "string" && Array.isArray(slide.claims));
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}
