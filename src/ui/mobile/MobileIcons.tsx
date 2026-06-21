/* ============================================================================
   NodeAgent Mobile — icon set (lucide-style, 1.75 stroke, currentColor)
   Ported verbatim from the design prototype
   (docs/visuals/noderoom-design-0618/mobile/na-icons.jsx) into a typed module.
   ============================================================================ */
import * as React from "react";

type IconProps = React.SVGProps<SVGSVGElement>;

const P = (d: string, extra?: React.SVGProps<SVGPathElement>) =>
  React.createElement("path", { d, fill: "none", ...extra });

const make =
  (...children: React.ReactNode[]) =>
  (props: IconProps): React.ReactElement =>
    React.createElement(
      "svg",
      {
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.75,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        ...props,
      },
      ...children,
    );

const ICONS = {
  pen: make(P("M12 20h9"), P("M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z")),
  inbox: make(
    P("M22 12h-6l-2 3h-4l-2-3H2"),
    P("M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"),
  ),
  room: make(P("M3 21h18"), P("M5 21V7l8-4v18"), P("M19 21V11l-6-4"), P("M9 9v.01"), P("M9 12v.01"), P("M9 15v.01")),
  coach: make(P("M12 2 2 7l10 5 10-5-10-5Z"), P("M6 9.5V15c0 1.1 2.7 3 6 3s6-1.9 6-3V9.5")),
  building: make(P("M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"), P("M10 6h4"), P("M10 10h4"), P("M10 14h4"), P("M2 22h20")),
  user: make(React.createElement("circle", { cx: 12, cy: 8, r: 4 }), P("M4 21a8 8 0 0 1 16 0")),
  signal: make(P("M2 20h.01"), P("M7 20v-4"), P("M12 20v-8"), P("M17 20V8"), P("M22 4v16")),
  gap: make(React.createElement("circle", { cx: 12, cy: 12, r: 9, strokeDasharray: "3 3" }), P("M12 8v4"), P("M12 16h.01")),
  sparkles: make(
    P("M12 3 13.9 8.6 19.5 10.5 13.9 12.4 12 18 10.1 12.4 4.5 10.5 10.1 8.6Z"),
    P("M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z"),
  ),
  arrowRight: make(P("M5 12h14"), P("M13 5l7 7-7 7")),
  arrowUp: make(P("M12 19V5"), P("M5 12l7-7 7 7")),
  check: make(P("M20 6 9 17l-5-5")),
  checkCircle: make(React.createElement("circle", { cx: 12, cy: 12, r: 9 }), P("M8.5 12.5 11 15l4.5-5")),
  x: make(P("M18 6 6 18"), P("M6 6l12 12")),
  eye: make(P("M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"), React.createElement("circle", { cx: 12, cy: 12, r: 3 })),
  eyeOff: make(
    P("M10.7 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a13.2 13.2 0 0 1-2 2.8"),
    P("M6.6 6.6A13.3 13.3 0 0 0 2 12s3.5 7 10 7a9.8 9.8 0 0 0 4-.9"),
    P("M9.9 9.9a3 3 0 0 0 4.2 4.2"),
    P("M2 2l20 20"),
  ),
  lock: make(React.createElement("rect", { x: 4, y: 11, width: 16, height: 10, rx: 2 }), P("M8 11V7a4 4 0 0 1 8 0v4")),
  shield: make(P("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z")),
  search: make(React.createElement("circle", { cx: 11, cy: 11, r: 7 }), P("M21 21l-4-4")),
  table: make(React.createElement("rect", { x: 3, y: 3, width: 18, height: 18, rx: 2 }), P("M3 9h18"), P("M3 15h18"), P("M9 3v18")),
  plus: make(P("M12 5v14"), P("M5 12h14")),
  bolt: make(P("M13 2 3 14h7l-1 8 10-12h-7l1-8Z")),
  clock: make(React.createElement("circle", { cx: 12, cy: 12, r: 9 }), P("M12 7v5l3 2")),
  dollar: make(P("M12 2v20"), P("M17 6.5C17 4.6 14.8 3.5 12 3.5S7 4.6 7 6.5 9.2 9.5 12 9.5s5 1.1 5 3-2.2 3-5 3-5-1.1-5-3")),
  route: make(
    React.createElement("circle", { cx: 6, cy: 19, r: 3 }),
    React.createElement("circle", { cx: 18, cy: 5, r: 3 }),
    P("M9 19h5a4 4 0 0 0 4-4V8"),
  ),
  history: make(P("M3 12a9 9 0 1 0 3-6.7L3 8"), P("M3 4v4h4"), P("M12 8v4l3 2")),
  file: make(P("M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"), P("M14 2v6h6")),
  note: make(P("M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z"), P("M16 3v5h5"), P("M8 13h6"), P("M8 17h4")),
  bell: make(P("M6 9a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"), P("M10.3 21a1.94 1.94 0 0 0 3.4 0")),
  quote: make(P("M7 7H4v6h6V7H7l1-3"), P("M17 7h-3v6h6V7h-3l1-3")),
  target: make(
    React.createElement("circle", { cx: 12, cy: 12, r: 9 }),
    React.createElement("circle", { cx: 12, cy: 12, r: 5 }),
    React.createElement("circle", { cx: 12, cy: 12, r: 1 }),
  ),
  refresh: make(P("M21 12a9 9 0 1 1-3-6.7"), P("M21 3v5h-5")),
  chevR: make(P("M9 18l6-6-6-6")),
  chevL: make(P("M15 18l-6-6 6-6")),
  layers: make(P("M12 2 2 7l10 5 10-5-10-5Z"), P("M2 12l10 5 10-5"), P("M2 17l10 5 10-5")),
  camera: make(
    P("M3 8a2 2 0 0 1 2-2h2l1.5-2h7L19 6h0a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"),
    React.createElement("circle", { cx: 12, cy: 13, r: 3.5 }),
  ),
  image: make(
    React.createElement("rect", { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    React.createElement("circle", { cx: 8.5, cy: 9, r: 1.8 }),
    P("M21 16l-5-5L5 20"),
  ),
  paperclip: make(P("M20 11.5 11.5 20a4.5 4.5 0 0 1-6.4-6.4l8.5-8.5a3 3 0 0 1 4.3 4.3l-8.5 8.5a1.5 1.5 0 0 1-2.1-2.1l7.8-7.8")),
  at: make(React.createElement("circle", { cx: 12, cy: 12, r: 4 }), P("M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8")),
  puzzle: make(P("M9 4a2 2 0 0 1 4 0c0 1 .8 1.5 1.5 1.5H17a1 1 0 0 1 1 1v2.5c0 .7.5 1.5 1.5 1.5a2 2 0 0 1 0 4c-1 0-1.5.8-1.5 1.5V19a1 1 0 0 1-1 1h-2.5c-.7 0-1.5-.5-1.5-1.5a2 2 0 0 0-4 0c0 1-.8 1.5-1.5 1.5H5a1 1 0 0 1-1-1v-2.5C4 15.8 3.5 15 2.5 15a2 2 0 0 1 0-4c1 0 1.5-.8 1.5-1.5V7a1 1 0 0 1 1-1h2.5C8.2 6 9 5.5 9 4.5Z")),
  voice: make(P("M3 11v2"), P("M7 7v10"), P("M11 4v16"), P("M15 8v8"), P("M19 11v2"), P("M23 10v4")),
  message: make(P("M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z")),
  diff: make(P("M12 4v6"), P("M9 7h6"), P("M9 17h6")),
  download: make(P("M12 3v12"), P("M7 10l5 5 5-5"), P("M5 21h14")),
  gauge: make(P("M5 18a8 8 0 1 1 14 0"), P("M12 14l3.5-3.5")),
  expand: make(
    P("M8 3H5a2 2 0 0 0-2 2v3"),
    P("M16 3h3a2 2 0 0 1 2 2v3"),
    P("M8 21H5a2 2 0 0 1-2-2v-3"),
    P("M16 21h3a2 2 0 0 0 2-2v-3"),
  ),
  chevD: make(P("M6 9l6 6 6-6")),
  logout: make(P("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"), P("M16 17l5-5-5-5"), P("M21 12H9")),
  home: make(P("M3 10.5 12 3l9 7.5"), P("M5 9.5V21h14V9.5")),
  calendar: make(
    React.createElement("rect", { x: 3, y: 4.5, width: 18, height: 17, rx: 2 }),
    P("M3 9h18"),
    P("M8 2.5v4"),
    P("M16 2.5v4"),
  ),
  hash: make(P("M4 9h16"), P("M4 15h16"), P("M10 3 8 21"), P("M16 3l-2 18")),
  grip: make(
    React.createElement("circle", { cx: 9, cy: 6, r: 1.2, fill: "currentColor", stroke: "none" }),
    React.createElement("circle", { cx: 15, cy: 6, r: 1.2, fill: "currentColor", stroke: "none" }),
    React.createElement("circle", { cx: 9, cy: 12, r: 1.2, fill: "currentColor", stroke: "none" }),
    React.createElement("circle", { cx: 15, cy: 12, r: 1.2, fill: "currentColor", stroke: "none" }),
    React.createElement("circle", { cx: 9, cy: 18, r: 1.2, fill: "currentColor", stroke: "none" }),
    React.createElement("circle", { cx: 15, cy: 18, r: 1.2, fill: "currentColor", stroke: "none" }),
  ),
  menu: make(P("M3 6h18"), P("M3 12h18"), P("M3 18h18")),
  compose: make(
    P("M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"),
    P("M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"),
  ),
  sliders: make(
    React.createElement("circle", { cx: 8, cy: 6, r: 2 }),
    P("M10 6h10"),
    P("M4 6h2"),
    React.createElement("circle", { cx: 16, cy: 12, r: 2 }),
    P("M18 12h2"),
    P("M4 12h10"),
    React.createElement("circle", { cx: 10, cy: 18, r: 2 }),
    P("M12 18h8"),
    P("M4 18h4"),
  ),
  users: make(
    React.createElement("circle", { cx: 9, cy: 8, r: 3.5 }),
    P("M2 21a7 7 0 0 1 14 0"),
    P("M16 4.5a3.5 3.5 0 0 1 0 7"),
    P("M22 21a7 7 0 0 0-5-6.7"),
  ),
  mic: make(React.createElement("rect", { x: 9, y: 3, width: 6, height: 11, rx: 3 }), P("M5 11a7 7 0 0 0 14 0"), P("M12 18v3")),
  link: make(P("M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"), P("M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1")),
  pin: make(P("M12 17v5"), P("M9 10.8V4h6v6.8l2 2.2H7l2-2.2Z")),
  extlink: make(
    P("M15 3h6v6"),
    P("M10 14 21 3"),
    P("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"),
  ),
  settings: make(
    React.createElement("circle", { cx: 12, cy: 12, r: 3 }),
    P("M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8.7 1.1V1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 17 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H23a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.1Z"),
  ),
};

export type IconName = keyof typeof ICONS;

// Accept `IconName | (string & {})` so data-driven icon fields (typed `string`
// in mobileData) can be passed directly; unknown names render as null.
export function NaIcon({ name, ...rest }: { name: IconName | (string & {}) } & IconProps): React.ReactElement | null {
  const C = ICONS[name as IconName];
  return C ? C(rest) : null;
}

/** Convenience helper mirroring the prototype's `Ico(name, props)`. */
export const Ico = (name: IconName | (string & {}), props?: IconProps): React.ReactElement =>
  React.createElement(NaIcon, { ...props, name });
