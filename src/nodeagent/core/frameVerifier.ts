import type { AgentResult } from "./types";
import type { EvidenceState, FrameDelta, ReasoningFrame, ReasoningFrameStatus } from "./reasoningFrames";

export interface FrameVerification {
  status: ReasoningFrameStatus;
  reason: string;
  needsReview: boolean;
  blockedReason?: string;
  evidenceState?: EvidenceState;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeEvidence(frame: ReasoningFrame, delta: FrameDelta): EvidenceState | undefined {
  if (!frame.evidenceState) return undefined;
  const availableRefs = unique([...frame.evidenceState.availableRefs, ...delta.cacheKeysTouched, ...delta.okfConceptIdsTouched]);
  const missingRefs = frame.evidenceState.missingRefs.filter((ref) => !availableRefs.includes(ref));
  const staleRefs = frame.evidenceState.staleRefs.filter((ref) => !availableRefs.includes(ref));
  return {
    ...frame.evidenceState,
    availableRefs,
    missingRefs,
    staleRefs,
  };
}

export function verifyFrameOutcome(frame: ReasoningFrame, result: AgentResult, delta: FrameDelta): FrameVerification {
  const evidenceState = mergeEvidence(frame, delta);
  const body = `${result.finalText}\n${delta.summary}`.toLowerCase();
  const needsReview = /\b(needs[_ -]?review|unsupported|insufficient evidence|missing evidence)\b/.test(body)
    || Boolean(evidenceState?.missingRefs.length && frame.phase === "verify");

  if (result.stopReason !== "done") {
    const blockedReason = result.handoff?.summary ?? `Frame stopped with ${result.stopReason}.`;
    return {
      status: "blocked",
      reason: `Frame did not finish: ${result.stopReason}.`,
      blockedReason,
      needsReview,
      evidenceState,
    };
  }

  if (/\b(blocked|cannot proceed|no permission|approval required)\b/.test(body)) {
    return {
      status: "blocked",
      reason: "Frame reported a blocking condition.",
      blockedReason: delta.summary,
      needsReview: true,
      evidenceState,
    };
  }

  if (frame.phase === "verify" && evidenceState?.missingRefs.length) {
    return {
      status: "blocked",
      reason: "Verification frame still has missing evidence references.",
      blockedReason: evidenceState.missingRefs.join(", "),
      needsReview: true,
      evidenceState,
    };
  }

  return {
    status: "completed",
    reason: needsReview ? "Frame completed but flagged review-worthy evidence." : "Frame completed.",
    needsReview,
    evidenceState,
  };
}
