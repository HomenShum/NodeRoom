import type { DeckStoryboard } from "./deckStoryboard";

export type DeckPatchKind = "claim_evidence" | "gap_resolution" | "proposal_review";
export type DeckPatchStatus = "needs_source" | "ready_for_review";

export interface DeckPatchItem {
  patchId: string;
  slideId: string;
  slideTitle: string;
  kind: DeckPatchKind;
  status: DeckPatchStatus;
  title: string;
  reason: string;
  beforeText: string;
  afterText: string;
  sourceArtifactIds: string[];
  evidenceIds: string[];
  claimId?: string;
  proposalId?: string;
  traceId?: string;
}

export interface DeckPatchPlan {
  patchVersion: 1;
  deckId: string;
  planHash: string;
  title: string;
  patchCount: number;
  needsSourceCount: number;
  readyForReviewCount: number;
  sourceArtifactIds: string[];
  proposalIds: string[];
  traceIds: string[];
  integrityHash: string;
  items: DeckPatchItem[];
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function simpleHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function claimPatchAfterText(args: { claimText: string; proposalId?: string; evidenceId?: string }): string {
  if (args.evidenceId) return `${args.claimText} (keep cited evidence ${args.evidenceId})`;
  if (args.proposalId) return `${args.claimText} (review and apply proposal ${args.proposalId}, then re-export)`;
  return `${args.claimText} (add cited evidence or remove before export)`;
}

export function buildDeckPatchPlan(storyboard: DeckStoryboard): DeckPatchPlan {
  const items: DeckPatchItem[] = [];

  storyboard.slides.forEach((slide, slideIndex) => {
    slide.claims
      .filter((claim) => claim.status !== "verified")
      .forEach((claim, claimIndex) => {
        const status: DeckPatchStatus = claim.proposalId ? "ready_for_review" : "needs_source";
        const kind: DeckPatchKind = claim.proposalId ? "proposal_review" : "claim_evidence";
        const claimText = compactText(claim.text);
        const sourceArtifactIds = unique([claim.sourceArtifactId, ...slide.sourceArtifactIds]);
        items.push({
          patchId: `patch-${slideIndex + 1}-${claimIndex + 1}-${stableId(claim.claimId)}`,
          slideId: slide.slideId,
          slideTitle: slide.title,
          kind,
          status,
          title: claim.proposalId ? `Review linked proposal for ${slide.title}` : `Back ${slide.title} claim with evidence`,
          reason: claim.proposalId
            ? "A pending proposal can revise or support this deck claim after host review."
            : "This deck claim is not verified by evidence yet.",
          beforeText: claimText,
          afterText: claimPatchAfterText({ claimText, proposalId: claim.proposalId, evidenceId: claim.evidenceId }),
          sourceArtifactIds,
          evidenceIds: slide.evidenceIds,
          claimId: claim.claimId,
          proposalId: claim.proposalId,
          traceId: claim.traceId,
        });
      });

    slide.unresolvedGaps.forEach((gap, gapIndex) => {
      const gapText = compactText(gap);
      items.push({
        patchId: `patch-${slideIndex + 1}-gap-${gapIndex + 1}-${stableId(gapText)}`,
        slideId: slide.slideId,
        slideTitle: slide.title,
        kind: "gap_resolution",
        status: "needs_source",
        title: `Resolve ${slide.title} gap`,
        reason: "The slide still carries an unresolved review gap.",
        beforeText: gapText,
        afterText: `Resolve with a cited claim or mark omitted: ${gapText}`,
        sourceArtifactIds: slide.sourceArtifactIds,
        evidenceIds: slide.evidenceIds,
      });
    });
  });

  const patchDigest = items.map((item) => ({
    patchId: item.patchId,
    slideId: item.slideId,
    kind: item.kind,
    status: item.status,
    beforeText: item.beforeText,
    afterText: item.afterText,
    proposalId: item.proposalId,
    traceId: item.traceId,
    sourceArtifactIds: item.sourceArtifactIds,
  }));
  const integrityHash = simpleHash({
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    patchDigest,
  });

  return {
    patchVersion: 1,
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    title: `${storyboard.title} patch plan`,
    patchCount: items.length,
    needsSourceCount: items.filter((item) => item.status === "needs_source").length,
    readyForReviewCount: items.filter((item) => item.status === "ready_for_review").length,
    sourceArtifactIds: unique(items.flatMap((item) => item.sourceArtifactIds)),
    proposalIds: unique(items.map((item) => item.proposalId)),
    traceIds: unique(items.map((item) => item.traceId)),
    integrityHash,
    items,
  };
}

export function deckPatchPlanJson(plan: DeckPatchPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function deckPatchPlanFileName(title: string, integrityHash: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "deck";
  return `${slug}-deck-patch-plan-${integrityHash}.json`;
}

export function deckPatchPlanMimeType(): string {
  return "application/json;charset=utf-8";
}
