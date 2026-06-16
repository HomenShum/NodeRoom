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
