/* ============================================================================
   NodeAgent Room Tour — icon set (lucide-style stroke icons, 1.75px,
   currentColor). Ported from room/icons.jsx (window.RIcon). Each icon is a
   typed React component; `IconName` is the union of all keys for type-safe
   refs from siblings.
   ============================================================================ */
import * as React from "react";

type IconProps = React.SVGProps<SVGSVGElement> & { size?: number | string };

const PATHS = {
  play:    ["M6 4l13 8-13 8z"],
  plus:    ["M12 5v14", "M5 12h14"],
  arrow:   ["M5 12h14", "M13 6l6 6-6 6"],
  arrowL:  ["M19 12H5", "M11 18l-6-6 6-6"],
  send:    ["M4 12l16-7-7 16-2.5-6.5z", "M11 13l9-8"],
  check:   ["M5 12.5l4.5 4.5L19 7"],
  x:       ["M6 6l12 12", "M18 6L6 18"],
  sun:     ["M12 4V2", "M12 22v-2", "M5 5L3.5 3.5", "M20.5 20.5L19 19", "M4 12H2", "M22 12h-2", "M5 19l-1.5 1.5", "M20.5 3.5L19 5", "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  moon:    ["M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"],
  lock:    ["M6 11h12v9H6z", "M9 11V8a3 3 0 0 1 6 0v3"],
  unlock:  ["M6 11h12v9H6z", "M9 11V7a3 3 0 0 1 5.8-1"],
  users:   ["M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", "M3 20a6 6 0 0 1 12 0", "M16 4.5a3.5 3.5 0 0 1 0 7", "M18 14a6 6 0 0 1 3 6"],
  user:    ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M5 20a7 7 0 0 1 14 0"],
  sheet:   ["M3 5h18v14H3z", "M3 10h18", "M9 10v9", "M3 15h18"],
  note:    ["M14 3v5h5", "M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z", "M9 13h6", "M9 17h4"],
  wall:    ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
  doc:     ["M14 3v5h5", "M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"],
  folder:  ["M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"],
  chat:    ["M4 5h16v11H9l-5 4z"],
  spark:   ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M19 4l.7 2 .7-2 .6 2", "M5 17l.6 1.6.6-1.6.6 1.6"],
  panelL:  ["M3 4h18v16H3z", "M9 4v16"],
  panelR:  ["M3 4h18v16H3z", "M15 4v16"],
  layout:  ["M3 4h18v16H3z", "M9 4v16", "M15 4v16"],
  copy:    ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  link:    ["M9 15l6-6", "M10 6l1-1a3.5 3.5 0 0 1 5 5l-1 1", "M14 18l-1 1a3.5 3.5 0 0 1-5-5l1-1"],
  shield:  ["M12 3l8 3v5c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6z"],
  gate:    ["M4 4v16", "M20 4v16", "M9 8l3 4-3 4", "M15 8l-3 4 3 4"],
  history: ["M3 12a9 9 0 1 0 3-6.7L3 8", "M3 4v4h4", "M12 8v4l3 2"],
  dot:     ["M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2z"],
  eye:     ["M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  merge:   ["M7 4v6", "M7 10a6 6 0 0 0 6 6h4", "M7 4a2 2 0 1 0 0 0z", "M7 12a2 2 0 1 0 0 0z", "M19 14l2 2-2 2"],
  draft:   ["M4 20h16", "M14 4l4 4-9 9H5v-4z"],
  bolt:    ["M13 2L4.5 13.5H11l-1 8 8.5-11.5H12z"],
  cpu:     ["M7 7h10v10H7z", "M9 3v2", "M15 3v2", "M9 19v2", "M15 19v2", "M3 9h2", "M3 15h2", "M19 9h2", "M19 15h2"],
  globe:   ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3 12h18", "M12 3c2.5 2.5 3.5 6 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-6-3.5-9s1-6.5 3.5-9z"],
  code:    ["M9 8l-4 4 4 4", "M15 8l4 4-4 4"],
  pin:     ["M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z", "M12 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"],
} as const;

export type IconName = keyof typeof PATHS;

function makeIcon(paths: readonly string[]): React.FC<IconProps> {
  const Icon: React.FC<IconProps> = ({ size = 18, ...rest }) =>
    React.createElement(
      "svg",
      {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.75,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        ...rest,
      },
      paths.map((d, i) => React.createElement("path", { key: i, d })),
    );
  return Icon;
}

type IconMap = { [K in IconName]: React.FC<IconProps> };
const RIcon = Object.keys(PATHS).reduce<Partial<IconMap>>((acc, key) => {
  acc[key as IconName] = makeIcon(PATHS[key as IconName] as readonly string[]);
  return acc;
}, {}) as IconMap;

/** Render an icon by name (data-driven; mirrors `Ico(name)` in the prototype). */
export function Ico(name: IconName, props?: IconProps): React.ReactElement {
  const I = RIcon[name];
  return React.createElement(I, props);
}

export { RIcon };
