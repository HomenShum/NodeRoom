/* ============================================================================
   NodeAgent Mobile — Files / artifacts (lightweight mobile access)
   Artifact list · CardioNova row card (cards, not a grid) · row detail sheet.
   Ported from the design prototype (na-files.jsx).
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import { Pill, riStyle } from "./MobileScreens";
import * as D from "./mobileData";
import type { MobileCtx } from "./mobileTypes";
import type { RowField } from "./mobileData";

// ── FILES TAB ─────────────────────────────────────────────────────────────
export function Files({ ctx }: { ctx: MobileCtx }) {
  return React.createElement(
    React.Fragment,
    null,
    React.createElement("div", { className: "na-kicker" }, "Open in this room"),
    React.createElement(
      "div",
      { className: "na-card" },
      React.createElement(
        "div",
        { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
        D.FILES.map((f) =>
          React.createElement(
            "div",
            {
              key: f.id,
              className: "na-row",
              style: { cursor: "pointer" },
              onClick: () => (f.kind === "sheet" ? ctx.openRow() : ctx.toast("Opening " + f.name + " — best on desktop")),
            },
            React.createElement("span", { className: "ri", style: riStyle(f.tone) }, Ico(f.icon)),
            React.createElement("span", { className: "rm" }, React.createElement("strong", null, f.name), React.createElement("span", null, f.meta)),
            React.createElement("span", { className: "chevR", style: { color: "var(--text-tertiary)" } }, Ico("chevR")),
          ),
        ),
      ),
    ),

    React.createElement("div", { className: "na-kicker" }, "Spreadsheet · row preview"),
    React.createElement(
      "button",
      { className: "na-card tap accent", style: { textAlign: "left", width: "100%", font: "inherit", color: "inherit" }, onClick: () => ctx.openRow() },
      React.createElement(
        "div",
        { className: "na-card-head accent" },
        React.createElement("div", { className: "na-card-title" }, React.createElement("strong", null, ctx.row.entity), React.createElement("span", null, ctx.row.sub)),
        React.createElement(Pill, { tone: "warn" }, "2 to review"),
      ),
      React.createElement(
        "div",
        { className: "na-card-body accent na-rowcard" },
        ctx.row.fields.slice(0, 3).map((f, i) =>
          React.createElement(
            "div",
            { key: i, className: "field" },
            React.createElement("span", { className: "k" }, f.k),
            React.createElement("span", { className: "v" }, f.v),
            React.createElement(Pill, { tone: f.tone }, f.status),
          ),
        ),
        React.createElement(
          "p",
          { className: "na-prose", style: { margin: "10px 0 0", fontSize: 12, color: "var(--text-tertiary)" } },
          "Tap to open the full row — view, ask the agent, or approve. Modeling stays on desktop.",
        ),
      ),
    ),

    React.createElement(
      "p",
      { className: "na-prose", style: { fontSize: 11.5, color: "var(--text-tertiary)", margin: "2px 2px 0" } },
      "Mobile shows artifacts as cards and lets you edit a field or approve a change. Full grids, formulas, and side-by-side sources open on desktop.",
    ),
  );
}

// ── ROW DETAIL SHEET ────────────────────────────────────────────────────
export function RowSheet({ ctx }: { ctx: MobileCtx }) {
  const row = ctx.row;
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState("");
  const saveEdit = (f: RowField) => {
    if (!f.elementId) return;
    void ctx.editRowField(f.elementId, draft, f.version ?? 0).then((r) => {
      ctx.toast(r.ok ? "Saved" : r.reason === "conflict" ? "Changed on another device — reopened with the latest" : "Edit failed");
      setEditing(null);
    });
  };
  const fieldRow = (f: RowField, i: number) =>
    React.createElement(
      "div",
      { key: i, className: "field" },
      React.createElement("span", { className: "k" }, f.k),
      ctx.isLive && f.elementId && editing === f.elementId
        ? React.createElement("input", {
            className: "na-rowedit",
            autoFocus: true,
            value: draft,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
            onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") saveEdit(f);
              if (e.key === "Escape") setEditing(null);
            },
            onBlur: () => saveEdit(f),
          })
        : ctx.isLive && f.elementId
          ? React.createElement("button", { className: "v na-roweditable", onClick: () => { setEditing(f.elementId ?? null); setDraft(f.v === "—" ? "" : f.v); } }, f.v)
          : React.createElement("span", { className: "v" }, f.v),
      React.createElement(Pill, { tone: f.tone }, f.status),
    );
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      "div",
      { className: "na-sheet-head" },
      React.createElement("div", { className: "st" }, React.createElement("strong", null, row.entity), React.createElement("span", null, row.sub)),
      React.createElement("button", { className: "na-close", onClick: ctx.closeSheet, "aria-label": "Close" }, Ico("x")),
    ),
    React.createElement(
      "div",
      { className: "na-sheet-body" },
      React.createElement(
        "div",
        { className: "na-card na-rowcard" },
        React.createElement(
          "div",
          { className: "na-card-body", style: { paddingTop: "var(--na-pad)" } },
          row.fields.map(fieldRow),
        ),
      ),
      React.createElement(
        "p",
        { className: "na-prose", style: { margin: 0, fontSize: 13 } },
        ctx.isLive
          ? "Tap a value to edit it in place — changes sync to everyone, conflict-safe (CAS)."
          : "Two fields are not source-backed yet. The agent can search inside the approved scope, or you can edit a field by hand.",
      ),
    ),
    React.createElement(
      "div",
      { className: "na-sheet-foot" },
      React.createElement(
        "div",
        { className: "na-btn-row" },
        React.createElement("button", { className: "na-btn", onClick: () => ctx.openSheet("evidence") }, Ico("file"), "Open evidence"),
        React.createElement("button", { className: "na-btn", onClick: () => ctx.askAboutRow() }, Ico("sparkles"), "Ask agent"),
      ),
      React.createElement(
        "div",
        { className: "na-btn-row" },
        React.createElement("button", { className: "na-btn", onClick: () => ctx.toast(ctx.isLive ? "Tap a value above to edit it" : "Edit one field — full row on desktop") }, Ico("pen"), "Edit row"),
        React.createElement("button", { className: "na-btn primary", onClick: () => { ctx.toast("Row proposal approved"); ctx.closeSheet(); } }, Ico("check"), "Approve"),
      ),
    ),
  );
}
