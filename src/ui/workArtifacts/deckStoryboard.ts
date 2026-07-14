import type { Artifact, CellEvidence, CellPayload, Proposal, TraceEvent } from "../../engine/types";
import type { DeckArtifactInput, DeckStoryboardSection, WorkArtifactStatus } from "./workArtifactTypes";

export type DeckClaimStatus = "verified" | "manual" | "needs_review";
export type DeckStoryboardStatus = "draft" | "approved" | "needs_review";

export interface DeckStoryboardClaim {
  claimId: string;
  text: string;
  status: DeckClaimStatus;
  sourceArtifactId?: string;
  traceId?: string;
  proposalId?: string;
  evidenceId?: string;
}

export interface DeckSlidePlan {
  slideId: string;
  title: string;
  purpose: string;
  claims: DeckStoryboardClaim[];
  sourceArtifactIds: string[];
  evidenceIds: string[];
  unresolvedGaps: string[];
  speakerNote?: string;
  status: DeckStoryboardStatus;
}

export interface DeckStoryboard {
  deckId: string;
  roomId: string;
  title: string;
  audience: string;
  objective: string;
  privacy: "room" | "private" | "public";
  storyboardStatus: DeckStoryboardStatus;
  slides: DeckSlidePlan[];
  requiredEvidence: string[];
  unresolvedGaps: string[];
  sourceArtifactIds: string[];
  traceIds: string[];
  proposalIds: string[];
  planHash: string;
  version: number;
}

export interface BuildDeckStoryboardInput {
  roomId: string;
  roomTitle?: string;
  artifacts: Artifact[];
  traces?: TraceEvent[];
  proposals?: Proposal[];
  audience?: string;
  objective?: string;
  maxSlides?: number;
}

function isCellPayload(value: unknown): value is CellPayload {
  return typeof value === "object" && value !== null && ("status" in value || "evidence" in value || "error" in value);
}

function payloadEvidence(value: unknown): CellEvidence[] {
  return isCellPayload(value) && Array.isArray(value.evidence) ? value.evidence : [];
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "-")
    .replace(/&ndash;/g, "-")
    .replace(/&middot;/g, "·")
    .replace(/&hellip;/g, "...")
    .replace(/&lsquo;|&rsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, "\"")
    .replace(/&bull;/g, "•")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(html: string): string {
  return decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function valueText(value: unknown): string {
  if (typeof value === "string") {
    const text = value.trim();
    return text.startsWith("<") ? stripHtml(text) : decodeHtml(text);
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isCellPayload(value)) return valueText(value.value);
  if (typeof value === "object" && value !== null && "text" in value && typeof value.text === "string") return decodeHtml(value.text.trim());
  return "";
}

function artifactTextSignals(artifact: Artifact, cap = 4): string[] {
  const ids = artifact.order.length ? artifact.order : Object.keys(artifact.elements);
  const seen = new Set<string>();
  const values: string[] = [];
  for (const id of ids) {
    const text = valueText(artifact.elements[id]?.value).replace(/\s+/g, " ").trim();
    if (!text || text.length < 4 || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    values.push(text.slice(0, 140));
    if (values.length >= cap) break;
  }
  return values;
}

function artifactEvidence(artifact: Artifact): CellEvidence[] {
  return Object.values(artifact.elements).flatMap((element) => payloadEvidence(element.value));
}

function artifactGaps(artifact: Artifact): string[] {
  return Object.values(artifact.elements)
    .map((element) => {
      const text = valueText(element.value);
      const status = isCellPayload(element.value) ? element.value.status : undefined;
      if (status === "needs_review" || status === "gap" || status === "failed") return text || `${element.id} needs review`;
      if (/\b(needs[_\s-]?review|todo|tbd|unknown|gap|missing source|unsupported)\b/i.test(text)) return text;
      return "";
    })
    .filter(Boolean)
    .slice(0, 8);
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "item";
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
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

function claimFromArtifact(args: {
  artifact: Artifact;
  text: string;
  evidence?: CellEvidence;
  trace?: TraceEvent;
  proposal?: Proposal;
  index: number;
}): DeckStoryboardClaim {
  const status: DeckClaimStatus = args.evidence ? "verified" : args.proposal ? "needs_review" : "manual";
  return {
    claimId: `claim-${stableId(args.artifact.id)}-${args.index}`,
    text: args.text,
    status,
    sourceArtifactId: args.artifact.id,
    traceId: args.trace?.id,
    proposalId: args.proposal?.id,
    evidenceId: args.evidence?.id,
  };
}

function slideStatus(claims: DeckStoryboardClaim[], gaps: string[]): DeckStoryboardStatus {
  if (gaps.length > 0 || claims.some((claim) => claim.status === "needs_review")) return "needs_review";
  return "draft";
}

function deckStatusFromSlides(slides: DeckSlidePlan[]): DeckStoryboardStatus {
  return slides.some((slide) => slide.status === "needs_review" || slide.claims.some((claim) => claim.status !== "verified")) ? "needs_review" : "draft";
}

export function buildDeckStoryboardFromRoom(input: BuildDeckStoryboardInput): DeckStoryboard {
  const traces = input.traces ?? [];
  const proposals = input.proposals ?? [];
  const artifacts = input.artifacts;
  const slideLimit = Math.max(1, input.maxSlides ?? 5);
  const sourceArtifacts = artifacts.slice(0, slideLimit);

  const slides: DeckSlidePlan[] = sourceArtifacts.map((artifact, artifactIndex) => {
    const evidence = artifactEvidence(artifact);
    const gaps = artifactGaps(artifact);
    const relatedTrace = traces.find((trace) => trace.refs?.artifactId === artifact.id);
    const relatedProposal = proposals.find((proposal) => proposal.artifactId === artifact.id);
    const signals = artifactTextSignals(artifact, 3);
    const claims = (signals.length ? signals : [artifact.meta?.summary ?? `${artifact.title} is part of the room evidence.`])
      .map((text, index) => claimFromArtifact({
        artifact,
        text,
        evidence: evidence[index],
        trace: relatedTrace,
        proposal: relatedProposal,
        index,
      }));

    return {
      slideId: `slide-${artifactIndex + 1}-${stableId(artifact.title)}`,
      title: artifact.title,
      purpose: artifact.kind === "sheet"
        ? "Summarize structured findings and unresolved cells."
        : artifact.kind === "note"
          ? "Convert written analysis into presentation narrative."
          : "Summarize room decisions and open work.",
      claims,
      sourceArtifactIds: [artifact.id],
      evidenceIds: unique(evidence.map((item) => item.id)),
      unresolvedGaps: gaps,
      speakerNote: relatedTrace?.summary,
      status: slideStatus(claims, gaps),
    };
  });

  if (slides.length === 0) {
    slides.push({
      slideId: "slide-1-empty-room",
      title: "Room readout",
      purpose: "Capture the room objective before evidence is available.",
      claims: [],
      sourceArtifactIds: [],
      evidenceIds: [],
      unresolvedGaps: ["No artifacts are available yet."],
      status: "needs_review",
    });
  }

  const requiredEvidence = slides.flatMap((slide) =>
    slide.claims
      .filter((claim) => claim.status !== "verified")
      .map((claim) => `${slide.title}: ${claim.text}`),
  );
  const unresolvedGaps = unique([...slides.flatMap((slide) => slide.unresolvedGaps), ...requiredEvidence]).slice(0, 12);
  const sourceArtifactIds = unique(slides.flatMap((slide) => slide.sourceArtifactIds));
  const traceIds = unique([...traces.map((trace) => trace.id), ...slides.flatMap((slide) => slide.claims.map((claim) => claim.traceId))]);
  const proposalIds = unique([...proposals.map((proposal) => proposal.id), ...slides.flatMap((slide) => slide.claims.map((claim) => claim.proposalId))]);
  const storyboardStatus = deckStatusFromSlides(slides);
  const draft = {
    roomId: input.roomId,
    title: `${input.roomTitle ?? "NodeRoom"} readout`,
    slides,
    sourceArtifactIds,
    traceIds,
    proposalIds,
    unresolvedGaps,
  };

  return {
    deckId: `${input.roomId}:storyboard`,
    roomId: input.roomId,
    title: `${input.roomTitle ?? "NodeRoom"} readout`,
    audience: input.audience ?? "room reviewers",
    objective: input.objective ?? "Turn room evidence into a reviewable, source-backed narrative.",
    privacy: "room",
    storyboardStatus,
    slides,
    requiredEvidence,
    unresolvedGaps,
    sourceArtifactIds,
    traceIds,
    proposalIds,
    planHash: simpleHash(draft),
    version: 1,
  };
}

export function deckArtifactInputFromStoryboard(storyboard: DeckStoryboard): DeckArtifactInput {
  const sections: DeckStoryboardSection[] = storyboard.slides.map((slide) => ({
    id: slide.slideId,
    title: slide.title,
    claimCount: slide.claims.length,
    evidenceCount: slide.evidenceIds.length,
    unresolvedCount: slide.unresolvedGaps.length + slide.claims.filter((claim) => claim.status !== "verified").length,
  }));
  const status: WorkArtifactStatus = storyboard.storyboardStatus === "needs_review" || storyboard.requiredEvidence.length > 0 ? "needs_review" : "ready";
  return {
    id: storyboard.deckId,
    roomId: storyboard.roomId,
    title: storyboard.title,
    status,
    version: storyboard.version,
    storyboardStatus: storyboard.storyboardStatus,
    sections,
    traceIds: storyboard.traceIds,
    sourceIds: storyboard.sourceArtifactIds,
    proposalIds: storyboard.proposalIds,
  };
}
