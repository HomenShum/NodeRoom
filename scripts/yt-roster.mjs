/**
 * yt-roster.mjs — the single source of truth for which uploads are current.
 *
 * WHY THIS EXISTS. yt-verify.mjs kept its own hardcoded target list, and that
 * list went stale the moment the clips were re-shot: it was still asserting
 * YUpSMEkkK4Q and q1CL1hCO_0Q, which are now Private. Worse, it matched titles
 * on "review every agent change" — a phrase the superseded clip and its
 * replacement BOTH carry — so it could have passed against the wrong video and
 * reported health. A verifier pointing at superseded artifacts is not a
 * verifier.
 *
 * Two hand-lists that can disagree is the bug. One list that both the guard
 * (yt-privatize) and the verifier (yt-verify) import cannot.
 *
 * `expect` must be DISTINGUISHING, not merely present: both narrated titles
 * contain "the full walkthrough, narrated", so each expect carries its product.
 */

export const PUBLISHED = [
  { id: "3N7sBxFLFOc", key: "NodeRoom · drills",     expect: "NodeRoom — review every agent change" },
  { id: "qpzHP5-pWvw", key: "NodeRoom · fresh-user", expect: "NodeRoom — from landing to a room" },
  { id: "uvXf7e4hwt4", key: "NodeRoom · narrated",   expect: "NodeRoom — the full walkthrough, narrated" },
  { id: "M9cc5Gj1pQE", key: "NodeSlide · deck",      expect: "NodeSlide — decks that stay editable" },
  { id: "5FnzEKmm9fw", key: "NodeSlide · narrated",  expect: "NodeSlide — the full walkthrough, narrated" },
  { id: "eCMEWKoq5C0", key: "NodeSlide · extras",    expect: "NodeSlide — the other five doors" },
];

/** Re-shot and replaced. Set Private 2026-07-28 — reachable only by the owner. */
export const SUPERSEDED = [
  { id: "YUpSMEkkK4Q", why: "NodeRoom v1 — wrong product URL burned into every frame" },
  { id: "q1CL1hCO_0Q", why: "NodeSlide v1 — same wrong URL; captioned a deck never on screen" },
  { id: "qgltieHPCQM", why: "NodeRoom v2 — URL fixed, but landing-only: 0 of 6 drills run" },
  { id: "8sOEbjYiBQk", why: "NodeSlide v2 — superseded by the 8-step deck + audit cut" },
];

export const KEEPERS = new Set(PUBLISHED.map((v) => v.id));

// An id in both lists would mean the guard protects something the cleanup is
// also trying to hide. Fail loudly at import rather than behave surprisingly.
const overlap = SUPERSEDED.filter((s) => KEEPERS.has(s.id));
if (overlap.length) {
  throw new Error(`yt-roster: id in BOTH published and superseded: ${overlap.map((o) => o.id).join(", ")}`);
}
