/* ============================================================================
   NodeAgent Mobile — Settings sheet
   Productizes the designed variant matrix (accent / theme / density / nav /
   tone / motion / passive) as a real user-facing bottom sheet. Each control is
   an on-brand segmented selector; changes apply live and persist per device.
   ============================================================================ */
import * as React from "react";
import "./mobileSettings.css";
import { Ico } from "./MobileIcons";
import type { MobileCtx, AccentName, Density, CopyTone, MotionName, NavStyle, PassiveMode } from "./mobileTypes";
import type { TabId } from "./mobileData";

function Seg({
  value,
  options,
  onChange,
}: {
  value: string;
  options: ReadonlyArray<{ v: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return React.createElement(
    "div",
    { className: "na-seg" },
    options.map((o) => React.createElement("button", { key: o.v, type: "button", "data-active": value === o.v, onClick: () => onChange(o.v) }, o.label)),
  );
}

function SetRow({ label, hint, children }: { label: string; hint?: string; children?: React.ReactNode }) {
  return React.createElement(
    "div",
    { className: "na-set-row" },
    React.createElement("div", { className: "na-set-label" }, label, hint && React.createElement("small", null, hint)),
    children,
  );
}

export function SettingsSheet({ ctx }: { ctx: MobileCtx }) {
  const t = ctx.t;
  const set = ctx.setTweak;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      { className: "na-sheet-head" },
      React.createElement("div", { className: "st" }, React.createElement("strong", null, "Settings"), React.createElement("span", null, "Make this room yours · saved on this device")),
      React.createElement("button", { className: "na-close", onClick: ctx.closeSheet, "aria-label": "Close" }, Ico("x")),
    ),
    React.createElement(
      "div",
      { className: "na-sheet-body" },

      React.createElement("div", { className: "na-kicker" }, "Appearance"),
      React.createElement(
        SetRow,
        { label: "Accent" },
        React.createElement(Seg, {
          value: t.accent,
          options: [{ v: "terracotta", label: "Terracotta" }, { v: "amber", label: "Amber" }, { v: "neutral", label: "Neutral" }],
          onChange: (v) => set("accent", v as AccentName),
        }),
      ),
      React.createElement(
        SetRow,
        { label: "Theme" },
        React.createElement(Seg, {
          value: t.dark ? "dark" : "light",
          options: [{ v: "dark", label: "Dark" }, { v: "light", label: "Light" }],
          onChange: (v) => set("dark", v === "dark"),
        }),
      ),
      React.createElement(
        SetRow,
        { label: "Density" },
        React.createElement(Seg, {
          value: t.density,
          options: [{ v: "comfortable", label: "Comfortable" }, { v: "compact", label: "Compact" }],
          onChange: (v) => set("density", v as Density),
        }),
      ),

      React.createElement("div", { className: "na-kicker" }, "Navigation"),
      React.createElement(
        SetRow,
        { label: "Nav style" },
        React.createElement(Seg, {
          value: t.navStyle,
          options: [{ v: "tabs", label: "Tabs" }, { v: "dock", label: "Dock" }],
          onChange: (v) => set("navStyle", v as NavStyle),
        }),
      ),
      React.createElement(
        SetRow,
        { label: "Default surface", hint: "Which tab opens first" },
        React.createElement(Seg, {
          value: t.navModel,
          options: [{ v: "capture", label: "Capture" }, { v: "room", label: "Room" }, { v: "agent", label: "Agent" }, { v: "inbox", label: "Inbox" }],
          onChange: (v) => set("navModel", v as TabId),
        }),
      ),

      React.createElement("div", { className: "na-kicker" }, "Voice & motion"),
      React.createElement(
        SetRow,
        { label: "Copy tone", hint: "How NodeRoom talks to you" },
        React.createElement(Seg, {
          value: t.copyTone,
          options: [{ v: "analyst", label: "Analyst" }, { v: "calm", label: "Calm" }, { v: "command", label: "Command" }],
          onChange: (v) => set("copyTone", v as CopyTone),
        }),
      ),
      React.createElement(
        SetRow,
        { label: "Motion" },
        React.createElement(Seg, {
          value: t.motion,
          options: [{ v: "expressive", label: "Expressive" }, { v: "minimal", label: "Minimal" }, { v: "reduced", label: "Reduced" }],
          onChange: (v) => set("motion", v as MotionName),
        }),
      ),

      React.createElement("div", { className: "na-kicker" }, "Intelligence"),
      React.createElement(
        SetRow,
        { label: "Passive intelligence", hint: "How forward the agent is on your notes" },
        React.createElement(Seg, {
          value: t.passive,
          options: [{ v: "off", label: "Off" }, { v: "suggest", label: "Suggest" }, { v: "index", label: "Index" }, { v: "research", label: "Research" }],
          onChange: (v) => set("passive", v as PassiveMode),
        }),
      ),
    ),
  );
}
