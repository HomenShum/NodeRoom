import type { MobileCreditSummary } from "./mobileTypes";

export function liveAgentCreditBlockReason(credits: MobileCreditSummary | undefined): string | null {
  if (!credits) return "Live wallet unavailable. No provider request was sent.";
  if (credits.paused) return "Live work is paused for this room. No provider request was sent.";
  if (!credits.enrolled) return "This room is not enrolled for live work. No provider request was sent.";
  if (!credits.enforced) return "Credit enforcement is unavailable on this deployment. No provider request was sent.";
  if (credits.availableCredits + Number.EPSILON < credits.requiredCredits) {
    return `This request needs a hold of up to ${credits.requiredCredits.toFixed(1)} credits; ${credits.availableCredits.toFixed(1)} are available.`;
  }
  return null;
}
