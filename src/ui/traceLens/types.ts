/**
 * Trace Lens — "click any visible surface to see source, ownership, code path, and agent trace."
 * (6-15 deep-review + 6-16 §7.)
 *
 * SECURITY (from the workflow's adversarial critique, approved:false on the naive plan):
 * - The CLIENT only ever holds OPAQUE surface ids + banker-facing labels. NO file paths, no
 *   Convex fn names, no schema tables, no skill paths live in the client bundle.
 * - `data-noderoom-surface` carries only the opaque surfaceId (a coarse semantic label the guest
 *   can already see visually) -- never a component/file/mutation name.
 * - Builder Mode (code provenance) is server-gated: it requires a server-verified `builderCapable`
 *   that is ORTHOGONAL to host/auth (the host of a diligence room may be the external counterparty).
 *   Until that server query exists, builderCapable defaults to FALSE and the Code region never renders.
 */

export type LensMode = "review" | "builder";

/** Client-safe surface descriptor: NO code references. */
export interface SurfaceMeta {
  /** opaque dotted id, e.g. "workSurface.sheet" */
  id: string;
  /** banker-facing label */
  label: string;
  /** does this surface carry inspectable business proof (cell evidence / coach / source)? */
  proofAvailable: boolean;
  /** one-line plain-English description of what the surface is */
  about: string;
}

/** A resolved click: the surface plus any in-scope artifact/element/ref the DOM node carried. */
export interface SurfaceHit {
  surfaceId: string;
  artifactId?: string;
  elementId?: string;
  targetRef?: string;
}

export interface TraceLensState {
  open: boolean;
  hit: SurfaceHit | null;
  mode: LensMode;
  /** server-verified; false for everyone until convex/traceLens viewerCapabilities ships */
  builderCapable: boolean;
}

/**
 * Adversarial-refutation verdict — Tekton's `adversarial-verification.json` shape, ported.
 *
 * Doctrine: a claim made by an agent run is re-tested by an INDEPENDENT verifier whose context
 * does NOT include the builder's reasoning. The verifier tries to REFUTE the claim — defaulting
 * to "refuted" when uncertain. Surviving claims earn `stands`; overturned claims earn `refuted`
 * with a `correctedValue`. Honest UI keeps the failures: "fail→revise→pass is evidence of
 * autonomy, not a blemish."
 *
 * Client-safe: opaque ids + plain-English text only. No skill paths, no Convex fn names.
 */
export type RefutationOutcome = "stands" | "refuted" | "uncertain";

export interface RefutationVerdict {
  /** Opaque per-record claim id. Banker-readable when possible (e.g. "revenue-q3-2024"). */
  claimId: string;
  /** Plain-English claim the verifier tried to refute. */
  claim: string;
  verdict: RefutationOutcome;
  /** Verifier's confidence in the verdict itself (0..1), NOT in the original claim. */
  confidence: number;
  /** If verdict === "refuted", the value the verifier proposes instead. */
  correctedValue?: string;
  /** Verifier's plain-English reasoning. The honest paper trail. */
  reasoning: string;
  /** Banker-facing label of the verifier (e.g. "Independent verifier · fresh context"). */
  refutedBy?: string;
  /** ISO-ish timestamp string (display only). */
  refutedAt?: string;
}
