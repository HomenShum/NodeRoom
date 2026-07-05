/**
 * Always-On Rooms — shared inline icon set.
 *
 * Ported from design-reference/alwayson/ao-data.js Ic helper. Paths the
 * specimen delegated to the design-kit DIcon (shield, link, globe, eye, gate,
 * activity, lock, check) are standard feather outlines; `gate` maps to the
 * share-2 network glyph (closest available shape).
 *
 * Lives in its own module (not PublicRoomPage) ON PURPOSE: SubscribeModal is
 * statically imported by the landing gallery (src/landing/AlwaysOnCards.tsx),
 * so anything it imports rides the main bundle. Importing AoIcon from
 * PublicRoomPage would drag the whole lazy room page into the landing chunk
 * and defeat the #rooms/<slug> code split App.tsx sets up.
 */
import type { CSSProperties } from "react";

export const AO_ICON_PATHS: Record<string, string> = {
  x: "M18 6L6 18M6 6l12 12",
  mail: "M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zM22 6l-10 7L2 6",
  clock: "M12 2a10 10 0 100 20 10 10 0 000-20M12 6v6l4 2",
  hash: "M4 9h16M4 15h16M10 3L8 21M16 3l-2 18",
  rss: "M4 11a9 9 0 019 9M4 4a16 16 0 0116 16M6 19a1 1 0 100-2 1 1 0 000 2",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18",
  doc: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6",
  note: "M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z",
  alert: "M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  calendar: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  link: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71",
  globe: "M12 2a10 10 0 100 20 10 10 0 000-20M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z",
  eye: "M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 100 6 3 3 0 000-6z",
  gate: "M18 8a3 3 0 100-6 3 3 0 000 6M6 15a3 3 0 100-6 3 3 0 000 6M18 22a3 3 0 100-6 3 3 0 000 6M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  lock: "M5 11h14a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1v-8a1 1 0 011-1zM7 11V7a5 5 0 0110 0v4",
  check: "M20 6L9 17l-5-5",
};

export function AoIcon({ name, size = 15, style, strokeWidth = 1.7, className }: {
  name: string;
  size?: number;
  style?: CSSProperties;
  strokeWidth?: number;
  className?: string;
}) {
  const d = AO_ICON_PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      className={className}
      aria-hidden="true"
    >
      {d.split("M").filter(Boolean).map((s, i) => <path key={i} d={"M" + s} />)}
    </svg>
  );
}
