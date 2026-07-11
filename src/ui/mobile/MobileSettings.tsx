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
    { className: "na-seg", role: "radiogroup" },
    options.map((o) => React.createElement("button", { key: o.v, type: "button", role: "radio", "aria-checked": value === o.v, "data-active": value === o.v, onClick: () => onChange(o.v) }, o.label)),
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

export function SettingsSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const t = ctx.t;
  const set = ctx.setTweak;

  return (
    <>
      <div className="na-sheet-head">
        <div className="st">
          <strong>Settings</strong>
          <span>Room policy and device preferences</span>
        </div>
        <button className="na-close" onClick={ctx.closeSheet} aria-label="Close">{Ico("x")}</button>
      </div>
      <div className="na-sheet-body">
        <div className="na-kicker">Appearance</div>
        <SetRow label="Theme" hint="Light is the NodeRoom mobile default">
          <Seg
            value={t.dark ? "dark" : "light"}
            options={[{ v: "light", label: "Light" }, { v: "dark", label: "Dark" }]}
            onChange={(v) => set("dark", v === "dark")}
          />
        </SetRow>

        <div className="na-kicker">Agent policy</div>
        <div className="gp-set">
          <div className="cn-nrow" data-testid="gap-autoallow-row">
            Agent commits: {ctx.autoAllow ? "auto-allow" : "review"}
            <span className="grow" />
            <button
              type="button"
              className="fx-toggle"
              role="switch"
              aria-checked={ctx.autoAllow ? "true" : "false"}
              aria-label="Auto-allow agent commits"
              data-testid="gap-autoallow-toggle"
              data-on={ctx.autoAllow ? "true" : "false"}
              disabled={!ctx.canApprove}
              title={ctx.canApprove ? "Change agent edit policy" : "Only the room host can change this policy"}
              onClick={() => { if (ctx.canApprove) ctx.setAutoAllow(!ctx.autoAllow); }}
            >
              <span className={"sw" + (ctx.autoAllow ? "" : " off")} />
            </button>
          </div>
          <div className="gp-cap">
            {ctx.canApprove
              ? "Review means artifact edits wait for host approval. Agent runs can still create job, trace, provider, and chat records."
              : "Only the room host can change this policy. Review currently keeps artifact edits pending for host approval."}
          </div>
        </div>

        <div className="na-kicker">Notifications</div>
        <div className="gp-set" data-testid="gap-notif-rows">
          {ctx.notifRows.map((n) => (
            <div key={n.label} className="cn-nrow" data-testid="gap-notif-row">
              {n.label}
              <span className="grow" />
              <span className={"mode" + (n.mode === "instant" ? " instant" : "")}>{n.mode}</span>
              <span className="fx-toggle" aria-hidden="true" data-on={n.on ? "true" : "false"}>
                <span className={"sw" + (n.on ? "" : " off")} />
              </span>
            </div>
          ))}
          {!ctx.notifBacked ? (
            <div className="gp-cap" data-testid="gap-notif-caption">
              Notification tiers are preview-only here - coming with the notifications backend.
            </div>
          ) : null}
        </div>

        <details className="na-settings-advanced">
          <summary>Advanced</summary>
          <div className="na-settings-advanced-body">
            <div className="na-kicker">Visual variants</div>
            <SetRow label="Accent">
              <Seg
                value={t.accent}
                options={[{ v: "terracotta", label: "Terracotta" }, { v: "clay", label: "Clay" }, { v: "ochre", label: "Ochre" }]}
                onChange={(v) => set("accent", v as AccentName)}
              />
            </SetRow>
            <SetRow label="Density">
              <Seg
                value={t.density}
                options={[{ v: "comfortable", label: "Comfortable" }, { v: "compact", label: "Compact" }]}
                onChange={(v) => set("density", v as Density)}
              />
            </SetRow>

            <div className="na-kicker">Navigation experiments</div>
            <SetRow label="Nav style">
              <Seg
                value={t.navStyle}
                options={[{ v: "tabs", label: "Tabs" }, { v: "dock", label: "Dock" }]}
                onChange={(v) => set("navStyle", v as NavStyle)}
              />
            </SetRow>
            <SetRow label="Default surface" hint="Which tab opens first">
              <Seg
                value={t.navModel}
                options={[
                  { v: "home", label: "Home" },
                  { v: "capture", label: "Capture" },
                  { v: "room", label: "Room" },
                  { v: "agent", label: "Agent" },
                  { v: "inbox", label: "Inbox" },
                  { v: "files", label: "Files" },
                ]}
                onChange={(v) => set("navModel", v as TabId)}
              />
            </SetRow>

            <div className="na-kicker">Voice and motion</div>
            <SetRow label="Copy tone">
              <Seg
                value={t.copyTone}
                options={[{ v: "analyst", label: "Analyst" }, { v: "calm", label: "Calm" }, { v: "command", label: "Command" }]}
                onChange={(v) => set("copyTone", v as CopyTone)}
              />
            </SetRow>
            <SetRow label="Motion">
              <Seg
                value={t.motion}
                options={[{ v: "expressive", label: "Expressive" }, { v: "minimal", label: "Minimal" }, { v: "reduced", label: "Reduced" }]}
                onChange={(v) => set("motion", v as MotionName)}
              />
            </SetRow>

            <div className="na-kicker">Agent experiments</div>
            <SetRow label="Passive intelligence">
              <Seg
                value={t.passive}
                options={[{ v: "off", label: "Off" }, { v: "suggest", label: "Suggest" }, { v: "index", label: "Index" }, { v: "research", label: "Research" }]}
                onChange={(v) => set("passive", v as PassiveMode)}
              />
            </SetRow>
          </div>
        </details>
      </div>
    </>
  );
}
