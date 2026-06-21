/* ============================================================================
   NodeAgent Mobile — tab screens (Capture · Inbox · Room · Coach)
   → window.NAScreens   All screens take a single `ctx` controller object.
   Ported to strict TSX. KEEP React.createElement(...) calls AS-IS.
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import * as D from "./mobileData";
import type { MobileCtx } from "./mobileTypes";
import { SkeletonRecents, SkeletonRows } from "./MobileSkeleton";
import { Tooltip } from "./MobileTooltip";
import { haptic } from "./mobileUtil";

// ── shared pill ──────────────────────────────────────────────────────────────────────────────────────────────
export function Pill({
  tone = "mute",
  children,
  icon,
}: {
  tone?: string;
  children?: React.ReactNode;
  icon?: IconName;
}): React.ReactElement {
  return React.createElement("span", { className: "na-pill " + tone }, icon && Ico(icon), children);
}

// ── CAPTURE ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Capture({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const { t, note, setNote, saveState, detected, noticed, copy } = ctx;
  const [cap, setCap] = React.useState<"note" | "detected">("note");
  const ex = ctx.extract || { groups: [] };
  const sigCount = (ex.groups || []).reduce(
    (n: number, g: { rows: unknown[] }) => n + g.rows.length,
    0,
  );
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
    // Notion-style page: icon · title · property rows
    React.createElement(
      "div",
      { className: "na-doc" },
      React.createElement("div", { className: "na-doc-icon" }, Ico("note")),
      React.createElement("h2", { className: "na-doc-title" }, ctx.isLive ? ctx.room.name : D.ROOM.event),
      React.createElement(
        "div",
        { className: "na-props" },
        React.createElement(
          "div",
          { className: "na-prop" },
          React.createElement("span", { className: "na-prop-k" }, Ico("hash"), "Room"),
          React.createElement(
            "span",
            { className: "na-prop-v" },
            React.createElement("span", { className: "na-live-dot" }),
            ctx.room.name,
            React.createElement("span", { className: "na-prop-live" }, "live"),
          ),
        ),
        !ctx.isLive &&
          React.createElement(
            "div",
            { className: "na-prop" },
            React.createElement("span", { className: "na-prop-k" }, Ico("calendar"), "Date"),
            React.createElement("span", { className: "na-prop-v" }, D.ROOM.date),
          ),
        !ctx.isLive &&
          React.createElement(
            "div",
            { className: "na-prop" },
            React.createElement("span", { className: "na-prop-k" }, Ico("pin"), "Location"),
            React.createElement("span", { className: "na-prop-v" }, D.ROOM.place),
          ),
        React.createElement(
          "div",
          { className: "na-prop" },
          React.createElement("span", { className: "na-prop-k" }, Ico(passiveIcon), "Mode"),
          React.createElement("span", { className: "na-prop-v na-prop-tag" }, passiveLabel),
        ),
      ),
    ),

    // capture tabs: Note (Notion doc) · Detected (extraction) — plain underline tabs
    React.createElement(
      "div",
      { className: "na-doctabs" },
      React.createElement(Tooltip, {
        label: "Note",
        side: "bottom",
        children: React.createElement(
          "button",
          { className: "na-doctab", "data-active": cap === "note", onClick: () => setCap("note"), title: "Note", "aria-label": "Note tab" },
          "Note",
        ),
      }),
      React.createElement(Tooltip, {
        label: "Detected",
        side: "bottom",
        children: React.createElement(
          "button",
          {
            className: "na-doctab",
            "data-active": cap === "detected",
            onClick: () => setCap("detected"),
            title: "Detected",
            "aria-label": "Detected tab",
          },
          "Detected",
          sigCount > 0 && t.passive !== "off"
            ? React.createElement("span", { className: "tcount" }, sigCount)
            : null,
        ),
      }),
    ),

    // ── NOTE TAB (Notion-like, append-as-you-go) ──
    cap === "note" &&
      React.createElement(
        React.Fragment,
        null,

        // notebook — flat Notion-style page (no card chrome)
        React.createElement(
          "div",
          { className: "na-note paper" },
          React.createElement(
            "div",
            { className: "na-block" },
            React.createElement(
              "span",
              { className: "na-block-gutter" },
              React.createElement("span", { className: "na-block-add", "aria-hidden": true }, Ico("plus")),
              React.createElement("span", { className: "na-block-grip", "aria-hidden": true }, Ico("grip")),
            ),
            React.createElement("textarea", {
              className: "na-note-area",
              value: note,
              placeholder: "Type ‘/’ for commands, or just start writing…",
              onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setNote(e.target.value),
              "aria-label": "Capture note",
            }),
          ),
          // Notion-style add-block row
          React.createElement(
            "div",
            { className: "na-cap-actions" },
            React.createElement(
              "button",
              {
                onClick: () => {
                  setNote((n: string) => (n ? n + " " : "") + "Follow up after their board meeting next week.");
                  ctx.toast("Voice note added");
                },
              },
              Ico("mic"),
              "Voice note",
            ),
            React.createElement(
              "button",
              {
                onClick: () => {
                  setNote((n: string) => (n ? n + "\n" : "") + "Source: techcrunch.com/cardionova-series-b");
                  ctx.toast("Source pasted");
                },
              },
              Ico("link"),
              "Paste source",
            ),
            React.createElement(
              "button",
              { onClick: () => ctx.toast("Photo capture — best on device") },
              Ico("image"),
              "Photo",
            ),
          ),
          React.createElement(
            "div",
            { className: "na-note-foot" },
            React.createElement("span", { className: "na-save-dot " + saveState }),
            React.createElement("span", null, copy.save),
            React.createElement("span", { className: "na-save-foot-spacer" }),
            React.createElement(
              "span",
              { className: "mono" },
              (note.trim() ? note.trim().split(/\s+/).length : 0) + " words · private",
            ),
          ),
        ),
      ),

    // ── DETECTED TAB (extraction + plan prompt) ──
    cap === "detected" &&
      React.createElement(
        React.Fragment,
        null,
        detected && t.passive !== "off" && React.createElement(ExtractCard, { ctx }),

        // NodeRoom noticed → opens the work plan
        noticed &&
          t.passive !== "off" &&
          React.createElement(
            "button",
            {
              className: "na-noticed",
              onClick: () => ctx.openSheet("plan"),
            },
            React.createElement("span", { className: "ico" }, Ico("sparkles")),
            React.createElement(
              "span",
              { className: "na-noticed-copy" },
              React.createElement("strong", null, copy.noticedTitle),
              React.createElement("span", null, copy.noticedSub),
            ),
            React.createElement("span", { className: "go" }, Ico("arrowRight")),
          ),
      ),

    // privacy footnote
    React.createElement(
      "p",
      {
        className: "na-prose",
        style: { fontSize: 11.5, color: "var(--text-tertiary)", margin: "2px 2px 0" },
      },
      t.passive === "off"
        ? "Notes stay private to you. NodeRoom won’t scan or surface anything until you turn passive intelligence on."
        : "Raw notes stay private. NodeRoom only surfaces structured signals — it never edits your note or researches without approval.",
    ),
  );
}

// ── INBOX ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Inbox({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const { resolved } = ctx;
  const [view, setView] = React.useState<"card" | "row">("card");
  const [busy, setBusy] = React.useState<Record<string, boolean>>({});
  // Live items when bound to a room (live.inboxItems), else the sample inbox.
  const open = ctx.inboxItems.filter((i: D.InboxItem) => !resolved[i.id]);
  const done = ctx.inboxItems.filter((i: D.InboxItem) => resolved[i.id]);

  const preview = (kind: string) => {
    if (kind === "deck")
      return React.createElement(
        "div",
        { className: "na-pv pv-deck" },
        React.createElement("i", null),
        React.createElement("i", null),
        React.createElement("i", null),
      );
    if (kind === "sheet")
      return React.createElement(
        "div",
        { className: "na-pv pv-sheet" },
        [0, 1, 2, 3].map((r: number) => React.createElement("span", { key: r })),
      );
    if (kind === "chat")
      return React.createElement(
        "div",
        { className: "na-pv pv-chat" },
        React.createElement("i", { className: "l" }),
        React.createElement("i", { className: "r" }),
        React.createElement("i", { className: "l" }),
      );
    return React.createElement(
      "div",
      { className: "na-pv pv-doc" },
      [0, 1, 2, 3].map((r: number) => React.createElement("i", { key: r })),
    );
  };

  // Live: approve/reject a proposal through the store (host-gated).
  // In-flight per item. Reject is optimistically removed by the store; approve
  // is NOT optimistically hidden (the backend can legitimately keep a proposal
  // pending if CAS/validation fails) — so we show a "Working…" state and let the
  // live query drive removal honestly.
  const approve = (item: D.InboxItem, ok: boolean): void => {
    if (busy[item.id]) return;
    haptic();
    setBusy((b) => ({ ...b, [item.id]: true }));
    void ctx.resolveProposalById(item.id, ok).then((r) => {
      setBusy((b) => {
        const n = { ...b };
        delete n[item.id];
        return n;
      });
      ctx.toast(r.ok ? (ok ? "Approved · change applied" : "Proposal rejected") : "Failed — " + (r.reason || "try again"));
    });
  };

  const card = (item: D.InboxItem) => {
    const fg = React.createElement(
      "div",
      { className: "na-task-fg" },
      React.createElement("span", { className: "ri", style: riStyle(item.tone) }, Ico(item.icon)),
      React.createElement(
        "div",
        { className: "na-task-main" },
        React.createElement("strong", null, item.title),
        React.createElement("span", null, item.sub),
      ),
      React.createElement(
        "div",
        { className: "na-task-meta" },
        React.createElement(Pill, { tone: item.statusTone }, item.status),
        React.createElement("span", { className: "t" }, item.time),
      ),
    );
    // In a live room, items are real proposals — give them a true approve/reject
    // footer (host-gated) instead of routing to the desktop-only detail sheet.
    if (ctx.isLive) {
      return React.createElement(
        "div",
        { key: item.id, className: "na-task", "data-tone": item.tone },
        preview(item.preview),
        React.createElement("span", { className: "na-task-rail" }),
        React.createElement("button", { className: "na-task-tap", onClick: () => ctx.openInbox(item) }, fg),
        React.createElement(
          "div",
          { className: "na-task-foot" },
          busy[item.id]
            ? React.createElement("span", { className: "na-task-await" }, Ico("clock"), "Working…")
            : ctx.canApprove
              ? React.createElement(
                  "div",
                  { className: "na-btn-row" },
                  React.createElement("button", { className: "na-btn", onClick: () => approve(item, false) }, Ico("x"), "Reject"),
                  React.createElement("button", { className: "na-btn primary", onClick: () => approve(item, true) }, Ico("check"), "Approve"),
                )
              : React.createElement("span", { className: "na-task-await" }, Ico("lock"), "Awaiting host approval"),
        ),
      );
    }
    return React.createElement(
      "button",
      {
        key: item.id,
        className: "na-task",
        "data-tone": item.tone,
        onClick: () => ctx.openInbox(item),
      },
      preview(item.preview),
      React.createElement("span", { className: "na-task-rail" }),
      fg,
    );
  };

  const row = (item: D.InboxItem) =>
    React.createElement(
      "button",
      {
        key: item.id,
        className: "na-taskrow",
        "data-tone": item.tone,
        onClick: () => ctx.openInbox(item),
      },
      React.createElement("span", { className: "na-task-rail" }),
      React.createElement("span", { className: "ri", style: riStyle(item.tone) }, Ico(item.icon)),
      React.createElement("span", { className: "na-taskrow-title" }, item.title),
      React.createElement(Pill, { tone: item.statusTone }, item.status),
      React.createElement("span", { className: "t" }, item.time),
    );

  // Live first-load: show skeleton rows while the room hydrates (never offline —
  // the sample inbox is synchronous, so this only fires on the live path).
  if (ctx.loading && ctx.isLive && open.length === 0 && done.length === 0)
    return SkeletonRows({ n: 3 });

  if (open.length === 0 && done.length === 0)
    return emptyState(
      "inbox",
      "Inbox is clear",
      "Noteworthy findings, approvals, and coach prompts land here.",
    );

  const render = view === "row" ? row : card;
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      { className: "na-inbox-head" },
      React.createElement("span", { className: "na-kicker", style: { margin: 0 } }, "Needs you"),
      React.createElement(
        "div",
        { className: "na-viewtoggle" },
        React.createElement(Tooltip, {
          label: "Card view",
          side: "bottom",
          children: React.createElement(
            "button",
            { "data-active": view === "card", onClick: () => setView("card"), title: "Card view", "aria-label": "Card view" },
            Ico("layers"),
          ),
        }),
        React.createElement(Tooltip, {
          label: "Row view",
          side: "bottom",
          children: React.createElement(
            "button",
            { "data-active": view === "row", onClick: () => setView("row"), title: "Row view", "aria-label": "Row view" },
            Ico("menu"),
          ),
        }),
      ),
    ),
    React.createElement(
      "div",
      { className: view === "row" ? "na-taskrows" : "na-tasks" },
      open.map(render),
    ),
    done.length > 0 && React.createElement("div", { className: "na-kicker" }, "Resolved"),
    React.createElement(
      "div",
      { className: view === "row" ? "na-taskrows" : "na-tasks" },
      done.map((item: D.InboxItem) =>
        view === "row"
          ? React.createElement(
              "button",
              { key: item.id, className: "na-taskrow done", onClick: () => ctx.openInbox(item) },
              React.createElement("span", { className: "ri", style: riStyle("ok") }, Ico("check")),
              React.createElement("span", { className: "na-taskrow-title" }, item.title),
              React.createElement("span", { className: "t" }, item.time),
            )
          : React.createElement(
              "div",
              { key: item.id, className: "na-task done" },
              React.createElement(
                "div",
                { className: "na-task-fg" },
                React.createElement("span", { className: "ri", style: riStyle("ok") }, Ico("check")),
                React.createElement(
                  "div",
                  { className: "na-task-main" },
                  React.createElement("strong", null, item.title),
                ),
                React.createElement("span", { className: "t" }, item.time),
              ),
            ),
      ),
    ),
  );
}

export function riStyle(tone: string): React.CSSProperties {
  const map: Record<string, [string, string]> = {
    accent: ["var(--na-accent-bg)", "var(--na-accent)"],
    warn: ["var(--na-warn-bg)", "var(--na-warn)"],
    priv: ["var(--na-priv-bg)", "var(--na-priv)"],
    ok: ["var(--na-ok-bg)", "var(--na-ok)"],
    mute: ["var(--bg-tertiary)", "var(--text-secondary)"],
  };
  const [bg, fg] = map[tone] || map.mute;
  return {
    background: bg,
    color: fg,
    width: 30,
    height: 30,
    flex: "none",
    borderRadius: 9,
    display: "grid",
    placeItems: "center",
  };
}

// ── ROOM PULSE ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Room({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const p = D.PULSE;
  return React.createElement(
    React.Fragment,
    null,
    // headline stats
    React.createElement(
      "div",
      { className: "na-stats" },
      React.createElement(
        "div",
        { className: "na-stat" },
        React.createElement("b", null, ctx.resolvedCount),
        React.createElement("span", null, "approvals waiting"),
      ),
      React.createElement(
        "div",
        { className: "na-stat" },
        React.createElement("b", { className: "mono" }, ctx.version),
        React.createElement("span", null, "sheet version"),
      ),
    ),

    React.createElement("div", { className: "na-kicker" }, "Agents"),
    React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        p.agents.map((a: D.PulseAgent, i: number) =>
          React.createElement(
            "div",
            { key: i, className: "na-row" },
            React.createElement("span", { className: "ri" }, Ico("sparkles")),
            React.createElement(
              "span",
              { className: "rm" },
              React.createElement("strong", null, a.name),
              React.createElement("span", null, a.role),
            ),
            React.createElement(
              Pill,
              { tone: ctx.runState === "running" ? "accent" : "mute" },
              ctx.runState === "running" ? "running" : "idle",
            ),
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
        p.findings.map((f: D.Finding, i: number) =>
          React.createElement(
            "div",
            { key: i, className: "na-row" },
            React.createElement("span", { className: "ri" }, Ico(f.icon)),
            React.createElement(
              "span",
              { className: "rm" },
              React.createElement("strong", null, f.title),
              React.createElement("span", null, f.sub),
            ),
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
        p.people.map((person: D.PulsePerson, i: number) =>
          React.createElement(
            "div",
            { key: i, className: "na-row" },
            React.createElement(
              "span",
              {
                className: "ri",
                style: { background: person.color, color: "#fff", fontSize: 11, fontWeight: 800 },
              },
              person.short,
            ),
            React.createElement(
              "span",
              { className: "rm" },
              React.createElement("strong", null, person.name),
              React.createElement("span", null, person.role),
            ),
            React.createElement(
              "span",
              { className: "na-live", style: { fontSize: 11, fontWeight: 600 } },
              "live",
            ),
          ),
        ),
      ),
    ),
  );
}

// ── COACH (tab landing) ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export function Coach({ ctx }: { ctx: MobileCtx }): React.ReactElement {
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
        React.createElement(
          "div",
          { className: "na-card-title" },
          React.createElement("strong", null, "Coach prompt"),
          React.createElement("span", null, "Explain-and-defend · CardioNova"),
        ),
        React.createElement(Pill, { tone: "priv" }, "private"),
      ),
      React.createElement(
        "div",
        { className: "na-card-body accent" },
        React.createElement("p", { className: "na-prose", style: { margin: 0 } }, D.COACH.topics[0].question),
        React.createElement(
          "button",
          {
            className: "na-btn primary full",
            style: { marginTop: 12 },
            onClick: () => ctx.openSheet("coach"),
          },
          Ico("coach"),
          "Start coaching",
        ),
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

// ── STRUCTURED EXTRACTION (LlamaCloud-style results) ──────────────────────────────────────────────────────────
// One object with key→value rows + per-field confidence, plus a JSON view.
function toJSON(ex: D.Extract): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  ex.groups.forEach((g: D.ExtractGroup) => {
    if (g.id === "entity") g.rows.forEach((r: D.ExtractRow) => { o[r.k] = r.v; });
    else {
      const sub: Record<string, unknown> = {};
      g.rows.forEach((r: D.ExtractRow) => { sub[r.k] = r.v; });
      o[g.id] = sub;
    }
  });
  return o;
}

function highlightJSON(obj: Record<string, unknown>): React.ReactElement[] {
  const text = JSON.stringify(obj, null, 2);
  return text.split("\n").map((line: string, i: number) => {
    const m = line.match(/^(\s*)(?:"([^"]+)"\s*:\s*)?(.*)$/);
    const indent = (m && m[1]) || "",
      key = m && m[2];
    const rest = (m && m[3]) || "";
    const nodes: React.ReactNode[] = [indent];
    if (key != null) {
      nodes.push(React.createElement("span", { key: "k", className: "jk" }, '"' + key + '"'));
      nodes.push(": ");
    }
    if (rest) {
      const trail = (rest.match(/,$/) || [""])[0];
      const core = trail ? rest.slice(0, -1) : rest;
      let cls = "jp";
      if (/^".*"$/.test(core)) cls = "js";
      else if (/^-?\d/.test(core)) cls = "jn";
      else if (/^(true|false|null)$/.test(core)) cls = "jn";
      else if (/^[{}[\]]$/.test(core)) cls = "jp";
      if (core) nodes.push(React.createElement("span", { key: "v", className: cls }, core));
      if (trail) nodes.push(trail);
    }
    return React.createElement("div", { key: i, className: "jline" }, ...nodes);
  });
}

export function ExtractCard({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const [view, setView] = React.useState<"fields" | "json">("fields");
  const ex = ctx.extract;
  const flash: string[] = ctx.flashKeys || [];
  const conf = (c: number) =>
    c <= 0
      ? { txt: "gap", cls: "gap" }
      : c < 0.9
        ? { txt: Math.round(c * 100) + "%", cls: "low" }
        : { txt: Math.round(c * 100) + "%", cls: "ok" };

  return React.createElement(
    "div",
    { className: "na-detected" },
    React.createElement(
      "div",
      { className: "na-detected-head" },
      React.createElement(
        "span",
        { className: "na-detected-cap" },
        "Detected in this note · ",
        React.createElement("b", { className: "low-key" }, "orange"),
        " = low confidence",
      ),
      React.createElement(
        "div",
        { className: "na-subtabs" },
        React.createElement(
          "button",
          {
            className: "na-subtab",
            "data-active": view === "fields" ? "true" : null,
            onClick: () => setView("fields"),
          },
          "Fields",
        ),
        React.createElement(
          "button",
          {
            className: "na-subtab",
            "data-active": view === "json" ? "true" : null,
            onClick: () => setView("json"),
          },
          "JSON",
        ),
      ),
    ),

    view === "fields"
      ? React.createElement(
          "div",
          { className: "na-extract-body" },
          ex.groups.map((g: D.ExtractGroup) =>
            React.createElement(
              "div",
              { key: g.id, className: "na-egroup" },
              React.createElement(
                "div",
                { className: "na-egroup-lab" },
                g.flag && React.createElement("span", { className: "flag" }),
                g.label,
              ),
              React.createElement(
                "div",
                { className: "na-egroup-rows" },
                g.rows.map((r: D.ExtractRow) => {
                  const c = conf(r.conf);
                  return React.createElement(
                    "div",
                    {
                      key: r.k,
                      className: "erow",
                      tabIndex: 0,
                      "data-low": c.cls === "low" ? "true" : null,
                      "data-gap": c.cls === "gap" ? "true" : null,
                      "data-flash": flash.includes(g.id + "." + r.k) ? "true" : null,
                      onClick: () => ctx.openSheet("plan"),
                      onKeyDown: (e: React.KeyboardEvent) => {
                        if (e.key === "Enter") ctx.openSheet("plan");
                      },
                    },
                    React.createElement("span", { className: "ek" }, r.k),
                    React.createElement(
                      "span",
                      { className: "ev", style: r.mono ? { fontFamily: "var(--font-mono)" } : undefined },
                      r.v,
                    ),
                    React.createElement("span", { className: "ec " + c.cls }, c.txt),
                    React.createElement(
                      "span",
                      { className: "tip", role: "tooltip" },
                      React.createElement("b", null, r.v),
                      React.createElement(
                        "i",
                        null,
                        c.cls === "gap" ? "no source yet" : "confidence " + c.txt,
                      ),
                    ),
                  );
                }),
              ),
            ),
          ),
        )
      : React.createElement(
          "div",
          { className: "na-extract-body" },
          React.createElement("div", { className: "na-json" }, highlightJSON(toJSON(ex))),
        ),
  );
}

// ── HOME (Notion-style recents + favorites, quiet) ───────────────────────────────────────────────────────────
// ── Per-type signature previews — each artifact reads as its own object ────────
function recentSignature(sig: D.RecentSig | null | undefined): React.ReactElement | null {
  if (!sig) return null;
  const h = React.createElement;
  if (sig.type === "deck") {
    // a filmstrip of slide frames; the active slide is lifted + tinted
    return h(
      "span",
      { className: "rc-sig sig-deck" },
      Array.from({ length: Math.min(sig.count || 0, 5) }).map((_, i: number) =>
        h(
          "span",
          { key: i, className: "sd-slide", "data-on": i === sig.active ? "true" : null },
          h("span", { className: "sd-bar" }),
          h("span", { className: "sd-line" }),
          h("span", { className: "sd-line short" }),
        ),
      ),
      (sig.count || 0) > 5 ? h("span", { className: "sd-more" }, "+" + ((sig.count || 0) - 5)) : null,
    );
  }
  if (sig.type === "sheet") {
    // a live micro-grid; header row tinted, flagged cells glow amber / red
    return h(
      "span",
      { className: "rc-sig sig-sheet" },
      ["h", "h", "h"].map((_, i: number) =>
        h("span", { key: "h" + i, className: "ss-cell ss-head" }),
      ),
      (sig.cells || []).map((tone: string, i: number) =>
        h("span", { key: i, className: "ss-cell", "data-tone": tone }),
      ),
    );
  }
  if (sig.type === "plan") {
    // a checklist with real check / running / queued marks
    return h(
      "span",
      { className: "rc-sig sig-plan" },
      (sig.todos || []).map((td: D.RecentTodo, i: number) =>
        h(
          "span",
          { key: i, className: "sp-row", "data-s": td.s },
          h(
            "span",
            { className: "sp-mark" },
            td.s === "done" ? Ico("check") : td.s === "run" ? h("i", { className: "sp-spin" }) : null,
          ),
          h("span", { className: "sp-tx" }, td.t),
        ),
      ),
    );
  }
  if (sig.type === "evidence") {
    // a sourced pull-quote with citation chips
    return h(
      "span",
      { className: "rc-sig sig-evid" },
      h("span", { className: "se-quote" }, "“" + sig.quote + "”"),
      h(
        "span",
        { className: "se-srcs" },
        (sig.sources || []).map((s: string, i: number) =>
          h("span", { key: i, className: "se-chip" }, Ico("link"), s),
        ),
      ),
    );
  }
  return null;
}

// the action a card/row commits to when tapped — shown as a labeled
// affordance so users know what opens before they tap (matches review rows)
function openMeta(kind: string): { icon: IconName; label: string } {
  switch (kind) {
    case "deck":
      return { icon: "layers", label: "Open deck" };
    case "sheet":
    case "row":
      return { icon: "table", label: "Open sheet" };
    case "plan":
      return { icon: "sparkles", label: "Open plan" };
    case "evidence":
      return { icon: "file", label: "Open evidence" };
    case "room":
      return { icon: "message", label: "Open room" };
    case "note":
      return { icon: "note", label: "Open note" };
    case "coach":
      return { icon: "coach", label: "Open coach" };
    default:
      return { icon: "chevR", label: "Open" };
  }
}

export function Home({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const go = (k: string) => {
    if (k === "note") ctx.setTab("capture");
    else if (k === "sheet" || k === "row") ctx.openSheet("sheetart");
    else if (k === "plan") ctx.openSheet("plan");
    else if (k === "deck") ctx.openSheet("artifact");
    else if (k === "evidence") ctx.openSheet("evidence");
    else if (k === "coach") ctx.openSheet("coach");
    else if (k === "room") ctx.setTab("room");
    else if (k === "inbox") ctx.setTab("inbox");
    else ctx.toast("Opening — best on desktop");
  };
  // Live: recents = real room artifacts; favorites/briefings are [] (no live
  // source). Each section hides when empty; all-empty → an honest empty state.
  const { recents, favorites, briefings } = ctx;
  // Live first-load: while the room hydrates and no recents have arrived yet,
  // show the recents skeleton under the kicker instead of the empty state.
  // Live-only (gate on ctx.loading && ctx.isLive) — the offline sample is
  // synchronous, so this never fires in the demo.
  if (ctx.loading && ctx.isLive && recents.length === 0)
    return React.createElement(
      React.Fragment,
      null,
      React.createElement("div", { className: "na-kicker" }, "Recents"),
      SkeletonRecents(),
    );
  if (recents.length === 0 && favorites.length === 0 && briefings.length === 0)
    return emptyState("home", "Nothing here yet", "Artifacts, favorites, and briefings from this room appear here.");
  return React.createElement(
    React.Fragment,
    null,
    // recents — each artifact type carries its own signature preview
    recents.length
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement("div", { className: "na-kicker" }, "Recents"),
          React.createElement(
            "div",
            { className: "na-recents" },
            recents.map((r: D.RecentItem) =>
              React.createElement(
                "button",
                { key: r.id, className: "na-rcard", "data-kind": r.kind, onClick: () => go(r.kind) },
                React.createElement(
                  "span",
                  { className: "rc-head" },
                  React.createElement("span", { className: "rc-ico" }, Ico(r.icon)),
                  React.createElement("span", { className: "rc-kind" }, r.kind),
                ),
                React.createElement("strong", { className: "rc-title" }, r.title),
                recentSignature(r.sig),
                (function () {
                  const o = openMeta(r.kind);
                  return React.createElement(
                    "span",
                    { className: "rc-foot" },
                    React.createElement("span", { className: "rc-meta" }, r.meta),
                    React.createElement(
                      "span",
                      { className: "na-openbtn", "data-kind": r.kind },
                      Ico(o.icon),
                      React.createElement("span", null, o.label),
                    ),
                  );
                })(),
              ),
            ),
          ),
        )
      : null,

    // favorites — each row carries its type's color + a live type signal
    favorites.length
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement("div", { className: "na-kicker" }, "Favorites"),
          React.createElement(
            "div",
            { className: "na-favs" },
            favorites.map((f: D.FavoriteItem) =>
              React.createElement(
                "button",
                { key: f.id, className: "na-favrow", "data-kind": f.kind, onClick: () => go(f.kind) },
                React.createElement("span", { className: "ri" }, Ico(f.icon)),
                React.createElement(
                  "span",
                  { className: "rm" },
                  React.createElement("strong", null, f.title),
                  React.createElement("span", null, f.meta),
                ),
                (function () {
                  const o = openMeta(f.kind);
                  return React.createElement(
                    "span",
                    { className: "na-openbtn", "data-kind": f.kind },
                    Ico(o.icon),
                    React.createElement("span", null, o.label),
                  );
                })(),
              ),
            ),
          ),
        )
      : null,

    // briefings — top coachable explanations, approachably framed
    briefings.length
      ? React.createElement(
          React.Fragment,
          null,
          React.createElement("div", { className: "na-kicker", style: { marginTop: 4 } }, "Briefings"),
          React.createElement(
            "div",
            { className: "na-favs" },
            briefings.map((b: D.BriefingItem) =>
              React.createElement(
                "button",
                { key: b.id, className: "na-favrow", onClick: () => ctx.openSheet("coach") },
                React.createElement("span", { className: "ri", style: riStyle("priv") }, Ico(b.icon)),
                React.createElement(
                  "span",
                  { className: "rm" },
                  React.createElement("strong", null, b.title),
                  React.createElement("span", null, b.meta),
                ),
                React.createElement(
                  "span",
                  { className: "na-openbtn", "data-kind": "coach" },
                  Ico("coach"),
                  React.createElement("span", null, "Open coach"),
                ),
              ),
            ),
          ),
        )
      : null,
  );
}

function emptyState(icon: IconName, title: string, sub: string): React.ReactElement {
  return React.createElement(
    "div",
    { className: "na-empty" },
    React.createElement("div", { className: "eico" }, Ico(icon)),
    React.createElement("strong", null, title),
    React.createElement("span", null, sub),
  );
}
