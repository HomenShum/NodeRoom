/**
 * Attention Overlay — the locked TraceFocusBox contract (see docs/traces/ATTENTION_OVERLAY_STANDARD.md).
 * Pure types; no React, no Convex. The ONE primitive every artifact surface reuses to draw a focus box.
 *
 * Vetted by the design workflow + two adversarial critics. Critic-driven decisions baked in here:
 *  - explicit `kind` discriminant on TargetLocator (exhaustive, TS-narrowable).
 *  - ResolvedRect is viewport_px (NOT %) — %-of-offsetParent drifts inside a scrollable grid; px + scroll
 *    re-resolve is scroll-safe and works for the fixed PDF canvas too.
 *  - engineKind→overlayKind map: the running store's ArtifactKind is 'sheet'|'note'|'wall'; the overlay
 *    namespace is 'spreadsheet'|'pdf'|… — without this bridge canResolve() never matches a live artifact.
 */
import type { NormBox } from "../../nodeagent/capture/types"; // {x,y,w,h,page?} 0..1, top-left, y-down

/** What kind of attention this box represents. Drives color + icon + a11y label (never color alone). */
export type FocusKind =
  | "user_focus" // blue   — a human is here
  | "agent_read" // amber  — an agent is reading/reasoning over this
  | "agent_write" // amber — an agent is actively writing here
  | "citation" // green   — a cited source location
  | "evidence" // green    — this output is evidence-backed
  | "proposal" // purple   — a proposed change awaiting review
  | "conflict" // red      — overlaps a human-held lock; deflected
  | "needs_review" // red  — flagged for human check
  | "coach_prompt"; // teal — Coach Mode is asking about this region

/** Who/what produced the attention. Orthogonal to focusKind (a human can cite; an agent can flag review). */
export type ActorKind = "human" | "agent" | "system";

/** Durability tier — maps 1:1 onto existing Convex stores (NO new tables). */
export type FocusDurability = "ephemeral" | "trace_persisted" | "evidence_persisted";

/** The overlay namespace for artifact kinds (distinct from the engine's 'sheet'|'note'|'wall'). */
export type ArtifactKind =
  | "spreadsheet" | "pdf" | "html" | "json" | "research" | "notebook"
  | "app_ui" | "image" | "chart";

/** Bridge the running store's engine ArtifactKind ('sheet'|'note'|'wall') to the overlay namespace. */
export function engineKindToOverlay(kind: string): ArtifactKind {
  switch (kind) {
    case "sheet": return "spreadsheet";
    case "note": return "notebook";
    case "wall": return "app_ui";
    default: return (kind as ArtifactKind);
  }
}

/**
 * Polymorphic logical target. Renderers never see these — a per-surface FocusTargetResolver turns one
 * into viewport-pixel rects. Discriminated by the explicit `kind` tag.
 */
export type TargetLocator = { artifactId: string; artifactKind: ArtifactKind } & (
  | { kind: "cellRange"; cellRange: string } //            "C2" | "A1:C5" -> td[data-cell-key|data-element-id]
  | { kind: "pdfBox"; pageNumber: number; bboxNorm: NormBox } // PDF/image/screenshot -> % overlay (exists)
  | { kind: "domSelector"; domSelector: string; bboxNorm?: NormBox } // html/app_ui -> getBoundingClientRect
  | { kind: "testId"; testId: string } //                  app_ui/Playwright -> [data-testid]
  | { kind: "jsonPointer"; jsonPointer: string } //        "/companies/0/funding" -> row rect
  | { kind: "block"; blockId: string } //                  notebook block -> data-element-id
);

/** The ONE primitive every surface reuses. */
export interface TraceFocusBox {
  id: string;
  traceId?: string;
  stepId?: string;
  /** Source row id in its durability store (presenceClaims._id | captureRecords._id | evidenceFacts._id). */
  sourceRef?: string;

  actorId?: string;
  actorKind: ActorKind;
  focusKind: FocusKind;

  target: TargetLocator;

  label: string; // banker-facing; also the aria-label stem
  description?: string; // hover detail (reason / quote / "Suggestion available")
  confidence?: number; // 0..1

  visibility: "private" | "room" | "public";
  durability: FocusDurability;

  createdAt: number;
  expiresAt?: number; // ephemeral only; the box is pruned + faded past this
}

/** A resolved rect in viewport pixels, relative to the resolver's viewportRef (scroll-safe). */
export interface ResolvedRect { x: number; y: number; w: number; h: number; space: "viewport_px" }

export interface ResolvedFocus {
  /** The position:relative element to overlay into. null = not currently mountable (off-screen / wrong tab). */
  viewportRef: HTMLElement | null;
  /** One logical target can yield N rects (multi-cell range, wrapped line). Empty = paint nothing (honest). */
  rects: ResolvedRect[];
}

/** Every artifact renderer implements ONE adapter: logical target -> viewport-px rects. */
export interface FocusTargetResolver {
  artifactKind: ArtifactKind;
  canResolve(t: TargetLocator): boolean;
  resolve(t: TargetLocator): ResolvedFocus;
}

/** Priority for BOUND eviction + paint hierarchy (higher wins clicks/overlap, evicted last). */
export const FOCUS_PRIORITY: Record<FocusKind, number> = {
  citation: 10,
  evidence: 10,
  proposal: 20,
  conflict: 30,
  needs_review: 30,
  agent_read: 40,
  agent_write: 40,
  user_focus: 50,
  coach_prompt: 60,
};

/** Hard cap on simultaneously-painted boxes (BOUND rule — agent loops can flood claims). */
export const MAX_FOCUS_BOXES = 200;
