/* ============================================================================
   NodeAgent Mobile — tab screens (Capture · Inbox · Room · Coach)
   Ported from the design prototype (na-screens.jsx). Every screen takes a
   single `ctx` controller object (MobileCtx).
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import * as D from "./mobileData";
import type { Tone, InboxItem } from "./mobileData";
import type { MobileCtx } from "./mobileTypes";

// ── shared pill ───────────────────────────────────────────────────────────
export function Pill({
  tone = "mute",
  children,
  icon,
}: {
  tone?: Tone;
  children?: React.ReactNode;
  icon?: IconName;
}) {
  return React.createElement("span", { className: "na-pill " + tone }, icon && Ico(icon), children);
}

// ── shared round-icon style ─────────────────────────────────────────────────
export function riStyle(tone: Tone): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    accent: ["var(--na-accent-bg)", "var(--na-accent)"],
    warn: ["var(--na-warn-bg)", "var(--na-warn)"],
    priv: ["var(--na-priv-bg)", "var(--na-priv)"],
    ok: ["var(--na-ok-bg)", "var(--na-ok)"],
    mute: ["var(--bg-tertiary)", "var(--text-secondary)"],
  };
  const [bg, fg] = map[tone] || map.mute;
  return { background: bg, color: fg, width: 30, height: 30, flex: "none", borderRadius: 9, display: "grid", placeItems: "center" };
}

function emptyState(icon: IconName, title: string, sub: string) {
  return React.createElement(
    "div",
    { className: "na-empty" },
    React.createElement("div", { className: "eico" }, Ico(icon)),
    React.createElement("strong", null, title),
    React.createElement("span", null, sub),
  );
}

// ── CAPTURE ─────────────────────────────────────────────────────────────
export function Capture({ ctx }: { ctx: MobileCtx }) {
  const { t, note, setNote, saveState, detected, noticed, copy } = ctx;
  const passiveLabel = {
    off: "Passive intelligence off",
    suggest: "Suggest only",
    index: "Auto-index room notes",
    research: "Auto-research room notes",
  }[t.passive];
  const passiveIcon: IconName = t.passive === "off" ? "eyeOff" : "eye";

  return React.createElement(
    React.Fragment,
    null,
    // mode indicator
    React.createElement("div", { className: "na-modepill" }, Ico(passiveIcon), "Mode · ", React.createElement("b", null, passiveLabel)),

    // notebook
    React.createElement(
      "div",
      { className: "na-card accent na-note" },
      React.createElement("textarea", {
        className: "na-note-area",
        value: note,
        placeholder: "Type who you met, what they said, or paste a source…",
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value),
        "aria-label": "Capture note",
      }),
      React.createElement(
        "div",
        { className: "na-note-foot" },
        React.createElement("span", { className: "na-save-dot " + saveState }),
        React.createElement("span", null, copy.save),
        React.createElement("span", { className: "na-save-foot-spacer" }),
        React.createElement("span", { className: "mono" }, (note.trim() ? note.trim().split(/\s+/).length : 0) + " words · private"),
      ),
    ),

    // detected entities
    detected &&
      t.passive !== "off" &&
      React.createElement(
        React.Fragment,
        null,
        React.createElement("div", { className: "na-kicker" }, "Detected in this note"),
        React.createElement(
          "div",
          { className: "na-chips" },
          D.DETECTED.map((d, i) =>
            React.createElement(
              "button",
              { key: i, className: "na-chip live", style: { animationDelay: i * 70 + "ms" }, onClick: () => ctx.openSheet("plan") },
              Ico(d.icon),
              React.createElement("span", { className: "lab" }, d.lab),
              d.text,
            ),
          ),
        ),
      ),

    // NodeRoom noticed → opens the work plan
    noticed &&
      t.passive !== "off" &&
      React.createElement(
        "button",
        { className: "na-noticed", onClick: () => ctx.openSheet("plan") },
        React.createElement("span", { className: "ico" }, Ico("sparkles")),
        React.createElement(
          "span",
          { className: "na-noticed-copy" },
          React.createElement("strong", null, copy.noticedTitle),
          React.createElement("span", null, copy.noticedSub),
        ),
        React.createElement("span", { className: "go" }, Ico("arrowRight")),
      ),

    // privacy footnote
    React.createElement(
      "p",
      { className: "na-prose", style: { fontSize: 11.5, color: "var(--text-tertiary)", margin: "2px 2px 0" } },
      t.passive === "off"
        ? "Notes stay private to you. NodeRoom won’t scan or surface anything until you turn passive intelligence on."
        : "Raw notes stay private. NodeRoom only surfaces structured signals — it never edits your note or researches without approval.",
    ),
  );
}

// ── INBOX ───────────────────────────────────────────────────────────────
export function Inbox({ ctx }: { ctx: MobileCtx }) {
  const { resolved } = ctx;
  const open = D.INBOX.filter((i) => !resolved[i.id]);
  const done = D.INBOX.filter((i) => resolved[i.id]);

  const card = (item: InboxItem) =>
    React.createElement(
      "button",
      {
        key: item.id,
        className: "na-card tap accent",
        "data-accent-rule": item.tone === "accent" ? null : item.tone,
        onClick: () => ctx.openInbox(item),
      },
      React.createElement(
        "div",
        { className: "na-card-head accent" },
        React.createElement(
          "div",
          { className: "na-card-title", style: { display: "flex", gap: 10, alignItems: "center" } },
          React.createElement("span", { className: "ri", style: riStyle(item.tone) }, Ico(item.icon)),
          React.createElement(
            "span",
            { style: { minWidth: 0 } },
            React.createElement("strong", null, item.title),
            React.createElement("span", { style: { display: "block", marginTop: 2, fontSize: "var(--na-fs-sm)", color: "var(--text-muted)" } }, item.sub),
          ),
        ),
        React.createElement(
          "div",
          { style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 } },
          React.createElement(Pill, { tone: item.statusTone }, item.status),
          React.createElement("span", { style: { fontSize: 10, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)" } }, item.time),
        ),
      ),
    );

  if (open.length === 0 && done.length === 0)
    return emptyState("inbox", "Inbox is clear", "Noteworthy findings, approvals, and coach prompts land here.");

  return React.createElement(
    React.Fragment,
    null,
    open.length > 0 && React.createElement("div", { className: "na-kicker" }, "Needs you"),
    open.map(card),
    done.length > 0 && React.createElement("div", { className: "na-kicker" }, "Resolved"),
    done.map((item) =>
      React.createElement(
        "div",
        { key: item.id, className: "na-card", style: { opacity: 0.6 } },
        React.createElement(
          "div",
          { className: "na-card-head" },
          React.createElement(
            "div",
            { className: "na-card-title", style: { display: "flex", gap: 10, alignItems: "center" } },
            React.createElement("span", { className: "ri", style: riStyle("ok") }, Ico("check")),
            React.createElement("span", null, React.createElement("strong", null, item.title)),
          ),
          React.createElement(Pill, { tone: "ok" }, "resolved"),
        ),
      ),
    ),
  );
}

// ── ROOM PULSE ────────────────────────────────────────────────────────────
export function Room({ ctx }: { ctx: MobileCtx }) {
  const p = D.PULSE;
  return React.createElement(
    React.Fragment,
    null,
    // headline stats
    React.createElement(
      "div",
      { className: "na-stats" },
      React.createElement("div", { className: "na-stat" }, React.createElement("b", null, ctx.resolvedCount), React.createElement("span", null, "approvals waiting")),
      React.createElement("div", { className: "na-stat" }, React.createElement("b", { className: "mono" }, ctx.version), React.createElement("span", null, "sheet version")),
    ),

    React.createElement("div", { className: "na-kicker" }, "Agents"),
    React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        p.agents.map((a, i) =>
          React.createElement(
            "div",
            { key: i, className: "na-row" },
            React.createElement("span", { className: "ri" }, Ico("sparkles")),
            React.createElement("span", { className: "rm" }, React.createElement("strong", null, a.name), React.createElement("span", null, a.role)),
            React.createElement(Pill, { tone: ctx.runState === "running" ? "accent" : "mute" }, ctx.runState === "running" ? "running" : "idle"),
          ),
        ),
      ),
    ),

    React.createElement("div", { className: "na-kicker" }, "Recent findings"),
    React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        p.findings.map((f, i) =>
          React.createElement(
            "div",
            { key: i, className: "na-row" },
            React.createElement("span", { className: "ri" }, Ico(f.icon)),
            React.createElement("span", { className: "rm" }, React.createElement("strong", null, f.title), React.createElement("span", null, f.sub)),
            React.createElement("span", { className: "rt" }, f.t),
          ),
        ),
      ),
    ),

    React.createElement("div", { className: "na-kicker" }, "In the room · " + p.people.length),
    React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        p.people.map((person, i) =>
          React.createElement(
            "div",
            { key: i, className: "na-row" },
            React.createElement("span", { className: "ri", style: { background: person.color, color: "#fff", fontSize: 11, fontWeight: 800 } }, person.short),
            React.createElement("span", { className: "rm" }, React.createElement("strong", null, person.name), React.createElement("span", null, person.role)),
            React.createElement("span", { className: "na-live", style: { fontSize: 11, fontWeight: 600 } }, "live"),
          ),
        ),
      ),
    ),
  );
}

// ── COACH (tab landing) ─────────────────────────────────────────────────
export function Coach({ ctx }: { ctx: MobileCtx }) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("div", { className: "na-kicker" }, "Review readiness"),
    React.createElement(
      "div",
      { className: "na-card accent", "data-accent-rule": "priv" },
      React.createElement(
        "div",
        { className: "na-card-head accent" },
        React.createElement("div", { className: "na-card-title" }, React.createElement("strong", null, "Coach prompt"), React.createElement("span", null, "Explain-and-defend · CardioNova")),
        React.createElement(Pill, { tone: "priv" }, "private"),
      ),
      React.createElement(
        "div",
        { className: "na-card-body accent" },
        React.createElement("p", { className: "na-prose", style: { margin: 0 } }, D.COACH.question),
        React.createElement("button", { className: "na-btn primary full", style: { marginTop: 12 }, onClick: () => ctx.openSheet("coach") }, Ico("coach"), "Start coaching"),
      ),
    ),

    React.createElement("div", { className: "na-kicker" }, "Why this matters"),
    React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        React.createElement(
          "p",
          { className: "na-prose", style: { margin: 0 } },
          "Coach turns each saved finding into a quick rehearsal: ",
          React.createElement("b", null, "state the claim, cite the source, name the gap, close it."),
          " It’s how a capture becomes a defensible brief.",
        ),
      ),
    ),
  );
}
