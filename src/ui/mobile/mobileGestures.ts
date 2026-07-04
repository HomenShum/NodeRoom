/* ============================================================================
   NodeAgent Mobile — pure gesture threshold math (no React, no DOM).
   The design's gap pack calls for three verbs on a record card
   (design-reference/mobile-scale/gaps.css `.gp-cap` "swipe left … swipe right …"
   + PEdit "long-press raises the cell into edit"):

     • long-press          → raise the cell into edit
     • swipe-right (→)      → watch the row      (wave-2 setWatch)
     • swipe-left  (←)      → flag needs_review  (existing cell edit path)

   Extracted here so the threshold decision is UNIT-TESTABLE in isolation and
   the same constants drive the card component and the tests. Everything is a
   pure function of pointer deltas + elapsed time — a test can assert the exact
   boundary conditions (just-under vs just-over) without a jsdom pointer
   simulation, which jsdom cannot faithfully drive.
   ============================================================================ */

/** Resolved gesture. "tap" = a short, still press that should behave like a click. */
export type Gesture = "long-press" | "swipe-right" | "swipe-left" | "tap" | "none";

export interface GestureThresholds {
  /** Horizontal travel (px) that commits a swipe. */
  swipeDistance: number;
  /** Max |dy|/|dx| ratio for a move to still count as horizontal (rejects diagonal scroll). */
  swipeMaxSlope: number;
  /** Press must stay within this radius (px) to be eligible for a long-press. */
  longPressMoveTolerance: number;
  /** Press must last at least this long (ms) to be a long-press. */
  longPressMs: number;
  /** A press shorter than this and within tolerance is a "tap" (click passthrough). */
  tapMaxMs: number;
}

/** Design-tuned defaults. Touch UIs commonly use ~48–64px swipe commits and a
 *  ~500ms long-press; these sit in that band and are exported so the card and
 *  the tests share one source of truth. */
export const GESTURE_THRESHOLDS: GestureThresholds = {
  swipeDistance: 56,
  swipeMaxSlope: 0.6,
  longPressMoveTolerance: 10,
  longPressMs: 500,
  tapMaxMs: 250,
};

export interface PointerSample {
  /** Signed horizontal travel from press origin (right = +). */
  dx: number;
  /** Signed vertical travel from press origin (down = +). */
  dy: number;
  /** Elapsed ms since press start. */
  dt: number;
}

/** True when a move is "horizontal enough" to be a swipe (not a diagonal scroll). */
export function isHorizontal(dx: number, dy: number, maxSlope: number): boolean {
  const ax = Math.abs(dx);
  if (ax === 0) return false;
  return Math.abs(dy) / ax <= maxSlope;
}

/** Euclidean distance from the press origin. */
export function moveDistance(dx: number, dy: number): number {
  return Math.hypot(dx, dy);
}

/**
 * Decide the gesture at pointer-UP time from the final sample.
 *
 * Priority (a release resolves exactly one verb):
 *   1. committed horizontal swipe (distance + slope)   → swipe-right | swipe-left
 *   2. long, still press                               → long-press
 *   3. short, still press                              → tap
 *   4. otherwise (moved but not a clean swipe)         → none  (treated as scroll/cancel)
 *
 * Note: a long press that ALSO drifted past the swipe distance resolves as the
 * swipe — the finger clearly travelled, so honor the travel over the timer.
 */
export function classifyRelease(
  sample: PointerSample,
  thresholds: GestureThresholds = GESTURE_THRESHOLDS,
): Gesture {
  const { dx, dy, dt } = sample;
  const dist = moveDistance(dx, dy);

  // 1 · committed swipe (horizontal, past the distance gate)
  if (Math.abs(dx) >= thresholds.swipeDistance && isHorizontal(dx, dy, thresholds.swipeMaxSlope)) {
    return dx > 0 ? "swipe-right" : "swipe-left";
  }

  const still = dist <= thresholds.longPressMoveTolerance;

  // 2 · long-press (held long enough AND barely moved)
  if (still && dt >= thresholds.longPressMs) return "long-press";

  // 3 · tap (quick + still)
  if (still && dt <= thresholds.tapMaxMs) return "tap";

  // 4 · ambiguous move / medium hold with drift → let the surface scroll
  return "none";
}

/**
 * Should the long-press TIMER fire while the finger is still down?
 * (The component arms a setTimeout on press; before firing it re-checks the
 * press has not drifted out of tolerance.) Pure so tests pin the exact radius.
 */
export function longPressEligible(
  sample: Pick<PointerSample, "dx" | "dy" | "dt">,
  thresholds: GestureThresholds = GESTURE_THRESHOLDS,
): boolean {
  return moveDistance(sample.dx, sample.dy) <= thresholds.longPressMoveTolerance && sample.dt >= thresholds.longPressMs;
}

/**
 * Live drag offset for the card's transform while the finger moves — clamped so
 * the card never slides further than one full swipe past the commit point
 * (keeps the reveal bounded and the affordance readable). Only tracks
 * horizontal, and only once the move is clearly horizontal (else 0, so a
 * vertical scroll doesn't wobble the card).
 */
export function dragOffset(
  dx: number,
  dy: number,
  thresholds: GestureThresholds = GESTURE_THRESHOLDS,
): number {
  if (!isHorizontal(dx, dy, thresholds.swipeMaxSlope)) return 0;
  const max = thresholds.swipeDistance * 1.5;
  return Math.max(-max, Math.min(max, dx));
}
