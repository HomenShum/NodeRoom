/* ============================================================================
   NodeAgent Mobile — honest skeleton placeholders (LIVE mode only).
   Pure presentational shimmer blocks used while a live Convex room hydrates.
   These NEVER render in the offline sample demo (the controller gates them on
   ctx.loading / ctx.isLive) — the sample surface must look identical to before.

   Style parity: React.createElement (NOT JSX), strict TS (CSSProperties uses
   `undefined`, never `null`). The shimmer + reduced-motion handling live in
   mobileFrame.css under `.na-skel`.
   ============================================================================ */
import * as React from "react";

const h = React.createElement;

/** Normalize a width/height/radius prop: a number becomes `${n}px`, a string passes through. */
function dim(v: number | string | undefined): string | undefined {
  if (v === undefined) return undefined;
  return typeof v === "number" ? `${v}px` : v;
}

export interface SkeletonProps {
  /** width — number → px, string passes through. Defaults to full width. */
  w?: number | string;
  /** height — number → px, string passes through. Defaults to 12px. */
  h?: number | string;
  /** border-radius — number → px, string passes through. Defaults to 6px. */
  r?: number | string;
  className?: string;
}

/** A single shimmer block. Honest placeholder — carries no real content. */
export function Skeleton({ w, h: height, r, className }: SkeletonProps): React.ReactElement {
  const style: React.CSSProperties = {
    width: dim(w) ?? "100%",
    height: dim(height) ?? "12px",
    borderRadius: dim(r) ?? "6px",
  };
  return h("span", {
    className: className ? `na-skel ${className}` : "na-skel",
    style,
    "aria-hidden": true,
  });
}

/** ~4 placeholder chat rows (avatar circle + 1–2 text bars) for a loading feed. */
export function SkeletonChat(): React.ReactElement {
  const rows = [0, 1, 2, 3];
  return h(
    "div",
    { className: "na-skel-chat", "aria-hidden": true },
    ...rows.map((i) =>
      h(
        "div",
        { key: `sk-chat-${i}`, className: "na-skel-row na-rmsg" },
        // avatar circle
        Skeleton({ w: 32, h: 32, r: 10 }),
        // text column: a short "name/time" bar + 1–2 body bars
        h(
          "div",
          { className: "na-skel-lines na-rmsg-main" },
          Skeleton({ w: "42%", h: 11, r: 5 }),
          Skeleton({ w: i % 2 === 0 ? "92%" : "78%", h: 13, r: 6 }),
          // every other row gets a second body bar for visual rhythm
          i % 2 === 0 ? Skeleton({ w: "64%", h: 13, r: 6 }) : null,
        ),
      ),
    ),
  );
}

/** 4 na-rcard-shaped skeleton cards matching the Home `.na-recents` 2-col grid. */
export function SkeletonRecents(): React.ReactElement {
  const cards = [0, 1, 2, 3];
  return h(
    "div",
    { className: "na-recents na-skel-recents", "aria-hidden": true },
    ...cards.map((i) =>
      h(
        "div",
        { key: `sk-rcard-${i}`, className: "na-skel-card" },
        // head row: small icon square + kind pill
        h(
          "div",
          { className: "na-skel-card-head" },
          Skeleton({ w: 30, h: 30, r: 9 }),
          Skeleton({ w: 46, h: 16, r: 999 }),
        ),
        // title — two lines
        Skeleton({ w: "88%", h: 14, r: 6 }),
        Skeleton({ w: "60%", h: 14, r: 6 }),
        // signature block fills the card body
        Skeleton({ w: "100%", h: 40, r: 8, className: "na-skel-sig" }),
        // foot meta
        Skeleton({ w: "52%", h: 11, r: 5 }),
      ),
    ),
  );
}

export interface SkeletonRowsProps {
  /** number of placeholder list rows (default 3). */
  n?: number;
}

/** `n` placeholder list rows for the Inbox while it hydrates. */
export function SkeletonRows({ n = 3 }: SkeletonRowsProps): React.ReactElement {
  const rows = Array.from({ length: Math.max(0, n) }, (_unused, i) => i);
  return h(
    "div",
    { className: "na-skel-rows", "aria-hidden": true },
    ...rows.map((i) =>
      h(
        "div",
        { key: `sk-row-${i}`, className: "na-skel-listrow" },
        // leading icon square
        Skeleton({ w: 34, h: 34, r: 10 }),
        // two-line text block
        h(
          "div",
          { className: "na-skel-lines" },
          Skeleton({ w: "70%", h: 13, r: 6 }),
          Skeleton({ w: "44%", h: 11, r: 5 }),
        ),
      ),
    ),
  );
}
