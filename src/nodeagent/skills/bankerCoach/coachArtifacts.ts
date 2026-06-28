export type EvidenceCardStatus = "verified" | "needs_review" | "manual" | "estimated" | "unsupported";

export interface EvidenceCardInput {
  label: string;
  sourceRef?: string;
  quote?: string;
  kind?: "source" | "upload" | "computed" | "manual";
  confidence?: number;
  status?: EvidenceCardStatus;
}

export interface EvidenceCard {
  id: string;
  label: string;
  sourceRef: string;
  quote: string;
  kind: "source" | "upload" | "computed" | "manual";
  confidence: number;
  status: EvidenceCardStatus;
  reviewNote?: string;
}

export interface BankerCoachCue {
  id: string;
  severity: "info" | "watch" | "risk";
  title: string;
  body: string;
  evidenceIds: string[];
  actionLabel: string;
}

export interface ReviewRoundUpdateInput {
  roomTitle: string;
  company?: string;
  materialChanges: string[];
  openQuestions?: string[];
  nextActions?: string[];
  sourceRefs?: string[];
}

export interface ReviewRoundUpdate {
  subject: string;
  body: string;
  bullets: string[];
  openQuestions: string[];
  nextActions: string[];
  sourceRefs: string[];
  status: "ready_for_review";
}

export function buildEvidenceCards(input: EvidenceCardInput[]): EvidenceCard[] {
  return input.map((item, index) => {
    // Honesty: never fabricate a confidence number for a claim with no verbatim source quote.
    const hasQuote = !!item.quote?.trim();
    const confidence = clamp(Number(item.confidence ?? (hasQuote ? 0.72 : 0)), 0, 1);
    const status = item.status ?? statusForEvidence(item.kind, confidence, item.sourceRef);
    return {
      id: `evidence_${index + 1}`,
      label: item.label.trim() || `Evidence ${index + 1}`,
      sourceRef: item.sourceRef?.trim() || "manual-room-claim",
      quote: hasQuote ? item.quote!.trim().slice(0, 280) : "No verbatim source quote captured — treat as unverified.",
      kind: item.kind ?? (item.sourceRef ? "source" : "manual"),
      confidence,
      status,
      reviewNote: reviewNoteFor(status),
    };
  });
}

export function generateBankerCoachCues(input: {
  company: string;
  claim: string;
  evidenceCards: EvidenceCard[];
  runwayMonths?: number;
  status?: string;
}): BankerCoachCue[] {
  const company = input.company.trim() || "Company";
  const evidenceIds = input.evidenceCards.map((card) => card.id);
  const weakEvidence = input.evidenceCards.filter((card) => card.status !== "verified" || card.confidence < 0.7);
  const cues: BankerCoachCue[] = [];

  if (!input.evidenceCards.length || weakEvidence.length) {
    cues.push({
      id: "cue_verify_sources",
      severity: "watch",
      title: "Verify before partner use",
      body: `${company} has ${weakEvidence.length || "no"} weak evidence item(s). Keep the claim review-only until a public source, upload row, or source page backs it.`,
      evidenceIds: weakEvidence.map((card) => card.id),
      actionLabel: "Request source backup",
    });
  }

  if (typeof input.runwayMonths === "number" && Number.isFinite(input.runwayMonths)) {
    if (input.runwayMonths < 9) {
      cues.push({
        id: "cue_runway_risk",
        severity: "risk",
        title: "Financing timing risk",
        body: `${company} has ${input.runwayMonths.toFixed(1)} months of runway. Ask for current cash, burn, signed pipeline, and financing timing before advancing.`,
        evidenceIds,
        actionLabel: "Open runway diligence",
      });
    } else if (input.runwayMonths < 18) {
      cues.push({
        id: "cue_runway_watch",
        severity: "watch",
        title: "Fundraise window watch",
        body: `${company} has ${input.runwayMonths.toFixed(1)} months of runway. Confirm milestone dates and whether treasury/banking needs are tied to the next raise.`,
        evidenceIds,
        actionLabel: "Confirm milestones",
      });
    }
  }

  cues.push({
    id: "cue_talk_track",
    severity: "info",
    title: "Banker talk track",
    body: `${company}: ${input.claim.trim() || "diligence claim pending"}. Lead with the verified source, name any manual assumptions, and close with the next review action.`,
    evidenceIds,
    actionLabel: "Use in review update",
  });

  if (input.status === "needs_review" && !cues.some((cue) => cue.id === "cue_verify_sources")) {
    cues.unshift({
      id: "cue_status_review",
      severity: "watch",
      title: "Needs review",
      body: `${company} is explicitly marked needs_review; do not present this as verified until the reviewer accepts the evidence.`,
      evidenceIds,
      actionLabel: "Route to reviewer",
    });
  }

  return cues;
}

export function prepareReviewRoundUpdate(input: ReviewRoundUpdateInput): ReviewRoundUpdate {
  const companyPrefix = input.company?.trim() ? `${input.company.trim()} - ` : "";
  const bullets = input.materialChanges.map((change) => change.trim()).filter(Boolean);
  const openQuestions = (input.openQuestions ?? []).map((question) => question.trim()).filter(Boolean);
  const nextActions = (input.nextActions ?? []).map((action) => action.trim()).filter(Boolean);
  const sourceRefs = (input.sourceRefs ?? []).map((ref) => ref.trim()).filter(Boolean);
  const body = [
    `${companyPrefix}${input.roomTitle} review update`,
    "",
    bullets.length ? `Material changes:\n${bullets.map((b) => `- ${b}`).join("\n")}` : "Material changes:\n- No material changes recorded.",
    openQuestions.length ? `\nOpen questions:\n${openQuestions.map((q) => `- ${q}`).join("\n")}` : "",
    nextActions.length ? `\nNext actions:\n${nextActions.map((a) => `- ${a}`).join("\n")}` : "",
    sourceRefs.length ? `\nSources:\n${sourceRefs.map((s) => `- ${s}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  return {
    subject: `${companyPrefix}${input.roomTitle} review round`,
    body,
    bullets,
    openQuestions,
    nextActions,
    sourceRefs,
    status: "ready_for_review",
  };
}

function statusForEvidence(kind: EvidenceCardInput["kind"], confidence: number, sourceRef?: string): EvidenceCardStatus {
  if (kind === "manual" || !sourceRef) return "manual";
  if (kind === "computed") return confidence >= 0.7 ? "verified" : "estimated";
  return confidence >= 0.75 ? "verified" : "needs_review";
}

function reviewNoteFor(status: EvidenceCardStatus): string | undefined {
  if (status === "verified") return undefined;
  if (status === "unsupported") return "Unsupported: no verbatim source quote — do not present as fact.";
  if (status === "manual") return "Manual claim; verify before public or partner-facing use.";
  if (status === "estimated") return "Estimated value; make the assumption visible in the review packet.";
  return "Needs reviewer acceptance before downstream use.";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
