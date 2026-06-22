/* ============================================================================
   NodeAgent Mobile — collaboration surfaces
   Room chat (Slack-style) · Agent command convo (ChatGPT-style) · universal
   mode-aware Composer with voice-to-text · Jobs sheet.
   Ported from the design prototype (na-chat.jsx). → window.NAChat
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import { Pill } from "./MobileScreens";
import * as D from "./mobileData";
import type { Person, Job, ComposerMode } from "./mobileData";
import { getModelLabel } from "../../landing/modelRegistry";
import type { MobileCtx } from "./mobileTypes";
import { SkeletonChat } from "./MobileSkeleton";
import { Tooltip } from "./MobileTooltip";

// highlight @mentions
function withMentions(text: string): React.ReactNode[] {
  return text.split(/(@\w+)/).map((part, i) =>
    part[0] === "@"
      ? React.createElement("span", { key: i, className: "mention" }, part)
      : part);
}

// ── ROOM CHAT ─────────────────────────────────────────────────────────────
export function RoomChat({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const P = D.PEOPLE as Record<string, Person | undefined>;
  const msgs = ctx.roomMsgs;

  const avatar = (who: string) => {
    const isAgent = (P[who] || {}).agent;
    const node = React.createElement("span", {
      className: "na-av", style: { background: (P[who] || {}).color || "var(--bg-hover)" },
    }, (P[who] || {}).short || "?");
    if (isAgent || !ctx.mentionPerson) return node;
    return React.createElement("button", { className: "na-av-btn", onClick: () => ctx.mentionPerson((P[who] || {}).name || who), "aria-label": "Message " + ((P[who] || {}).name || who), title: "Message " + ((P[who] || {}).name || who) }, node);
  };

  const head = (who: string, t: string) => React.createElement("div", { className: "na-rmsg-head" },
    (P[who] || {}).agent
      ? React.createElement("strong", { className: "who-agent" }, (P[who] || {}).name || who)
      : React.createElement("button", { className: "na-rmsg-name", onClick: () => ctx.mentionPerson && ctx.mentionPerson((P[who] || {}).name || who) }, (P[who] || {}).name || who),
    React.createElement("time", null, t));

  // live first-load hydration only — ctx.loading is false offline, so the
  // sample demo never shows a skeleton (renders byte-identical to before).
  if (ctx.loading && ctx.isLive && msgs.length === 0) return React.createElement("div", { className: "na-feed" }, SkeletonChat());

  return React.createElement("div", { className: "na-feed" },
    msgs.map((m) => {
      if (m.kind === "msg") return React.createElement("div", { key: m.id, className: "na-rmsg" + (m.pending ? " pending" : "") + (m.failed ? " failed" : "") },
        avatar(m.who),
        React.createElement("div", { className: "na-rmsg-main" }, head(m.who, m.t),
          React.createElement("div", { className: "na-rmsg-text" }, withMentions(m.text || "")),
          m.failed ? React.createElement("button", { className: "na-rmsg-retry", onClick: () => ctx.retryMessage(m.clientId ?? m.id), "aria-label": "Failed, retry", title: "Failed, retry" }, "Failed · Retry") : null));

      if (m.kind === "status") return React.createElement("div", { key: m.id, className: "na-rmsg agent" },
        avatar(m.who),
        React.createElement("div", { className: "na-rmsg-main" }, head(m.who, m.t),
          React.createElement("div", { className: "na-status" },
            React.createElement("span", { className: "na-pulsedot" }), m.text)));

      if (m.kind === "summary") return React.createElement("div", { key: m.id, className: "na-rmsg agent" },
        avatar(m.who),
        React.createElement("div", { className: "na-rmsg-main" }, head(m.who, m.t),
          React.createElement("div", { className: "na-rmsg-text" }, m.text),
          React.createElement("div", { className: "na-stats", style: { marginTop: 9 } },
            (m.stats || []).map((s, i) => React.createElement("div", { key: i, className: "na-stat" },
              React.createElement("b", { className: "mono", style: { fontSize: 13 } }, s.v),
              React.createElement("span", null, s.l))))));

      if (m.kind === "artifact") return React.createElement("div", { key: m.id, className: "na-rmsg agent" },
        avatar(m.who),
        React.createElement("div", { className: "na-rmsg-main" }, head(m.who, m.t),
          React.createElement("button", { className: "na-artlink", onClick: () => ctx.openSheet("sheetart") },
            React.createElement("span", { className: "ai" }, Ico("table")),
            React.createElement("span", null,
              React.createElement("strong", null, m.title),
              React.createElement("span", null, m.meta)),
            React.createElement("span", { className: "chevR" }, Ico("chevR")))));
      return null;
    }));
}

// minimal inline "running" line — reads as a continuation of the agent turn,
// cycles a whimsical gerund (Claude-Code style), taps through to the jobs sheet.
const RUN_VERBS = ["Researching", "Cross-referencing", "Reconciling", "Corroborating", "Triangulating", "Scouring sources", "Vetting claims", "Tracing receipts", "Synthesizing"];
function RunningInline({ ctx, job }: { ctx: MobileCtx; job: Job }): React.ReactElement {
  const [vi, setVi] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setVi((v) => (v + 1) % RUN_VERBS.length), 1500);
    return () => clearInterval(id);
  }, []);
  return React.createElement("button", { className: "na-running", onClick: () => ctx.openSheet("jobs"), title: job.title },
    React.createElement("span", { className: "spin" }),
    React.createElement("span", { className: "verb" }, RUN_VERBS[vi], "…"),
    React.createElement("span", { className: "meta" }, getModelLabel(job.route) + " · " + job.eta + " · " + job.cost),
    React.createElement("span", { className: "go" }, Ico("chevR")));
}

// ── AGENT CONVERSATION ──────────────────────────────────────────────────
export function AgentChat({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const lane = ctx.agentLane;
  const msgs = ctx.agentMsgs[lane];
  const J = D.JOBS;
  const running = J.running[0];

  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "na-lanes" },
      React.createElement("button", { className: "na-lane priv", "data-active": lane === "private", onClick: () => ctx.setAgentLane("private") },
        Ico("lock"), "Your agent"),
      React.createElement("button", { className: "na-lane room", "data-active": lane === "room", onClick: () => ctx.setAgentLane("room") },
        Ico("users"), "Room agent")),

    React.createElement("p", { className: "na-prose", style: { fontSize: 11.5, color: "var(--text-tertiary)", margin: "2px 2px 0" } },
      lane === "private"
        ? "Private to you. Can read your notes if allowed; output stays yours until you promote it."
        : "Shared. Uses room-visible context only and proposes every change before it lands."),

    (ctx.loading && ctx.isLive && msgs.length === 0)
      // live first-load hydration only — ctx.loading is false offline.
      ? React.createElement("div", { className: "na-conv" }, SkeletonChat())
      : React.createElement("div", { className: "na-conv" },
      msgs.map((m) => {
        if (m.role === "user") return React.createElement("div", { key: m.id, className: "na-bubble me" }, m.text);
        if (m.variant === "status") return React.createElement("div", { key: m.id, className: "na-agent-status" },
          React.createElement("span", { className: "na-pulsedot" }), m.text);
        if (m.variant === "summary") return React.createElement("div", { key: m.id, className: "na-card accent" },
          React.createElement("div", { className: "na-card-head accent" },
            React.createElement("div", { className: "na-card-title" },
              React.createElement("strong", null, m.title),
              React.createElement("span", null, m.sub)),
            React.createElement(Pill, { tone: "accent", icon: "sparkles" }, "plan")),
          React.createElement("div", { className: "na-card-body accent" },
            React.createElement("div", { className: "na-stats" },
              (m.stats || []).map((s, i) => React.createElement("div", { key: i, className: "na-stat" },
                React.createElement("b", { className: s.mono ? "mono" : "", style: { fontSize: 15 } }, s.v),
                React.createElement("span", null, s.l)))),
            React.createElement("button", { className: "na-btn primary full", style: { marginTop: 10 }, onClick: () => ctx.openSheet(m.open || "plan") },
              Ico("arrowRight"), m.openLabel || "Open work plan")));
        // text
        return React.createElement("div", { key: m.id, className: "na-bubble agent" },
          React.createElement("div", { className: "na-bubble-who" },
            React.createElement("span", { className: "na-av", style: { background: "var(--na-accent)" } }, "NA"),
            lane === "private" ? "Your NodeAgent" : "Room NodeAgent"),
          m.text);
      }),
      running && React.createElement(RunningInline, { ctx, job: running })),
  );
}

// ── UNIVERSAL COMPOSER ──────────────────────────────────────────────────
export function Composer({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const m = ctx.composerMode;
  const showQuick = ctx.tab === "agent";
  const modeMeta: Record<ComposerMode, { icon: IconName; label: string; ph: string }> = {
    note:  { icon: "pen", label: "Note", ph: "Dump a private note…" },
    room:  { icon: "room", label: "Room", ph: "Message the room…  @agent to ask" },
    agent: { icon: "sparkles", label: "Agent", ph: "Ask NodeAgent to do something…" },
    source: { icon: "link", label: "Source", ph: "Paste a URL or describe a source…" },
  };
  const MODES: ComposerMode[] = ["note", "room", "agent"];

  return React.createElement("div", { className: "na-composer" },
    showQuick && React.createElement("div", { className: "na-quick" },
      D.QUICK_PROMPTS.map((q, i) => React.createElement("button", { key: i, onClick: () => ctx.runQuick(q) },
        Ico(q.icon), q.text))),

    React.createElement("div", { className: "na-modes" },
      MODES.map((id) => React.createElement("button", {
        key: id, className: "na-mode", "data-mode": id, "data-active": m === id,
        onClick: () => ctx.setComposerMode(id),
      }, Ico(modeMeta[id].icon), modeMeta[id].label))),

    ctx.listening
      ? React.createElement("div", { className: "na-composer-row" },
          React.createElement("div", { className: "na-listening" },
            React.createElement("span", { className: "na-wave" },
              React.createElement("i", null), React.createElement("i", null), React.createElement("i", null), React.createElement("i", null), React.createElement("i", null)),
            "Listening…"),
          React.createElement(Tooltip, { label: "Stop", side: "top", children: React.createElement("button", { className: "na-mic", "data-listening": "true", onClick: ctx.stopVoice, "aria-label": "Stop", title: "Stop" }, Ico("mic")) }),
          React.createElement("button", { className: "na-send", disabled: true }, Ico("arrowRight")))
      : React.createElement("div", { className: "na-composer-row" },
          React.createElement("textarea", {
            className: "na-composer-field", rows: 1, value: ctx.draft,
            placeholder: modeMeta[m].ph,
            onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => ctx.setDraft(e.target.value),
            onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ctx.sendComposer(); } },
          }),
          React.createElement(Tooltip, { label: "Voice to text", side: "top", children: React.createElement("button", { className: "na-mic", onClick: ctx.startVoice, "aria-label": "Voice to text", title: "Voice to text" }, Ico("mic")) }),
          React.createElement(Tooltip, { label: "Send", side: "top", children: React.createElement("button", { className: "na-send", disabled: !ctx.draft.trim(), onClick: ctx.sendComposer, "aria-label": "Send", title: "Send" }, Ico("arrowRight")) })));
}

// ── JOBS SHEET ────────────────────────────────────────────────────────────
// Compact, traceable rows — status dot, title, inline trace chips. No big
// cards or action buttons; the running job carries a thin progress underline
// and a single quiet stop affordance.
export function JobsSheet({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const J = D.JOBS;
  const row = (j: Job, kind: "running" | "queued" | "completed") => React.createElement("div", { key: j.id, className: "na-jrow", "data-kind": kind, "data-nav": !!j.trace && /^r_/.test(j.trace), onClick: (j.trace && /^r_/.test(j.trace)) ? () => ctx.openTrace(j.trace as string) : undefined },
    React.createElement("span", { className: "na-jdot", "data-kind": kind },
      kind === "running" ? React.createElement("i", { className: "spin" }) : null),
    React.createElement("div", { className: "na-jmain" },
      React.createElement("div", { className: "na-jtop" },
        React.createElement("strong", null, j.title),
        React.createElement("span", { className: "na-jtrace", "data-nav": !!j.trace && /^r_/.test(j.trace) }, j.trace ? D.refLabel(j.trace) : (j.route || kind))),
      React.createElement("div", { className: "na-jsub" }, j.sub,
        j.cost ? React.createElement("span", { className: "sep" }, j.cost) : null,
        j.eta && kind !== "completed" ? React.createElement("span", { className: "sep" }, j.eta) : null,
        (j.trace && /^r_/.test(j.trace)) ? React.createElement("span", { className: "sep go" }, "View steps") : null),
      kind === "running" ? React.createElement("div", { className: "na-jprog" },
        React.createElement("i", { style: { width: (j.pct || 50) + "%" } })) : null),
    kind === "running"
      ? React.createElement(Tooltip, { label: "Stop job", side: "left", children: React.createElement("button", { className: "na-jstop", onClick: (e: React.MouseEvent) => { e.stopPropagation(); ctx.toast("Job stopped"); }, "aria-label": "Stop job", title: "Stop job" }, Ico("x")) })
      : (j.trace && /^r_/.test(j.trace))
        ? React.createElement("span", { className: "na-jstop ghost", "aria-hidden": true }, Ico("chevR"))
        : React.createElement("span", { className: "na-jwait" }, Ico("clock")));

  const group = (label: string, list: Job[], kind: "running" | "queued" | "completed") => list.length
    ? React.createElement("div", { className: "na-jgroup", key: kind },
        React.createElement("div", { className: "na-jhead" }, label, React.createElement("span", { className: "c" }, list.length)),
        list.map((j) => row(j, kind)))
    : null;

  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "na-sheet-head" },
      React.createElement("div", { className: "st" },
        React.createElement("strong", null, "Agent jobs"),
        React.createElement("span", null, "Every run is traceable")),
      React.createElement(Tooltip, { label: "Close", side: "bottom", children: React.createElement("button", { className: "na-close", onClick: ctx.closeSheet, "aria-label": "Close", title: "Close" }, Ico("x")) })),
    React.createElement("div", { className: "na-sheet-body" },
      group("Running", J.running, "running"),
      group("Queued", J.queued, "queued"),
      group("Completed", J.completed, "completed")));
}
