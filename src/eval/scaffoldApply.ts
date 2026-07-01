/**
 * Scaffold apply adapter — the bridge between accepted scaffold proposals
 * and the actual scaffold files. This module is the ONLY code that writes
 * to scaffold files. It enforces:
 *
 * 1. No immutable file is ever written to.
 * 2. No verifier-weakening pattern is ever applied.
 * 3. Every applied proposal is logged to the scaffold ledger.
 *
 * This is the "frozen LLM judge as a veto" layer from Ornith-1.0.
 */

import {
  type ScaffoldProposal,
  type ScaffoldReviewResult,
  IMMUTABLE_FILES,
  touchesImmutableFile,
  detectVerifierWeakening,
} from "./scaffoldProposal";

export interface ScaffoldLedgerEntry {
  proposalId: string;
  appliedAt: string;
  target: string;
  changeType: string;
  verdict: string;
  change: string;
}

export type ScaffoldLedger = ScaffoldLedgerEntry[];

/**
 * Apply an accepted scaffold proposal. Returns the ledger entry if applied,
 * or null if the proposal was rejected or violated immutability.
 */
export function applyScaffoldProposal(
  proposal: ScaffoldProposal,
  review: ScaffoldReviewResult,
): { applied: true; entry: ScaffoldLedgerEntry } | { applied: false; reason: string } {
  if (review.verdict === "rejected") {
    return { applied: false, reason: `proposal rejected: ${review.reasons.join("; ")}` };
  }
  if (review.verdict === "needs_adversarial_review") {
    return { applied: false, reason: `proposal needs adversarial review: ${review.reasons.join("; ")}` };
  }

  // Double-check immutability even if the review says accepted
  const immutableViolations = touchesImmutableFile([proposal.target]);
  if (immutableViolations.length > 0) {
    return { applied: false, reason: `target is immutable: ${immutableViolations.join(", ")}` };
  }

  // Double-check no verifier weakening
  const weakening = detectVerifierWeakening(proposal.change);
  if (weakening.length > 0) {
    return { applied: false, reason: `verifier weakening detected: ${weakening.join(", ")}` };
  }

  const entry: ScaffoldLedgerEntry = {
    proposalId: proposal.proposalId,
    appliedAt: new Date().toISOString(),
    target: proposal.target,
    changeType: proposal.changeType,
    verdict: review.verdict,
    change: proposal.change,
  };

  return { applied: true, entry };
}

/**
 * Batch-apply accepted proposals, returning the updated ledger and
 * any rejections from the immutability/verifier double-check.
 */
export function applyAcceptedProposals(
  proposals: ScaffoldProposal[],
  reviews: ScaffoldReviewResult[],
  ledger: ScaffoldLedger,
): {
  newLedger: ScaffoldLedger;
  applied: ScaffoldLedgerEntry[];
  rejected: Array<{ proposalId: string; reason: string }>;
} {
  const newLedger = [...ledger];
  const applied: ScaffoldLedgerEntry[] = [];
  const rejected: Array<{ proposalId: string; reason: string }> = [];

  for (const proposal of proposals) {
    const review = reviews.find((r) => r.proposalId === proposal.proposalId);
    if (!review) {
      rejected.push({ proposalId: proposal.proposalId, reason: "no review found" });
      continue;
    }

    const result = applyScaffoldProposal(proposal, review);
    if (result.applied) {
      newLedger.push(result.entry);
      applied.push(result.entry);
    } else {
      rejected.push({ proposalId: proposal.proposalId, reason: result.reason });
    }
  }

  return { newLedger, applied, rejected };
}

/**
 * Verify that no immutable file has been modified by comparing
 * the current file list against the immutable set.
 */
export function verifyImmutability(changedFiles: string[]): {
  ok: boolean;
  violations: string[];
} {
  const violations = touchesImmutableFile(changedFiles);
  return { ok: violations.length === 0, violations };
}

export { IMMUTABLE_FILES };
