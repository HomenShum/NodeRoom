/* ============================================================================
   NodeAgent Mobile — stacking overlays (Trace receipt · Source reader)
   These layer ABOVE the current bottom sheet so context isn't lost. Opened via
   ctx.openTrace(id) / ctx.openSource(src); closed via ctx.closeOverlay().
   → window.NAOverlay = { TraceOverlay, SourceOverlay }
   ============================================================================ */
import * as React from "react";
import { Ico } from "./MobileIcons";
import * as D from "./mobileData";
import type { MobileCtx } from "./mobileTypes";

// ── TRACE RECEIPT — scrollable, expandable step timeline ──────────────────
export function TraceOverlay({ id, ctx }: { id: string; ctx: MobileCtx }): React.ReactElement | null {
  const T = (D.TRACES || {})[id];
  const [openSteps, setOpenSteps] = React.useState<Record<number, boolean>>(() => {
    const o: Record<number, boolean> = {};
    if (T) T.steps.forEach((s, i) => { o[i] = s.status === "running"; });
    return o;
  });
  if (!T) return null;
  const toggle = (i: number) => setOpenSteps((o) => Object.assign({}, o, { [i]: !o[i] }));
  const doneN = T.steps.filter((s) => s.status === "done").length;

  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "na-trace-bar" },
      React.createElement("button", { className: "na-cc-back", onClick: ctx.closeOverlay, "aria-label": "Back" }, Ico("chevL")),
      React.createElement("span", { className: "na-trace-bar-label" }, Ico("history"), "Trace receipt"),
      React.createElement("button", { className: "na-close", onClick: ctx.closeOverlay, "aria-label": "Close" }, Ico("x"))),
    React.createElement("div", { className: "na-sheet-body" },
      React.createElement("div", { className: "na-trace-hero" },
        React.createElement("div", { className: "na-trace-hero-top" },
          React.createElement("span", { className: "na-trace-scope", "data-run": T.running ? "running" : "done" },
            T.running ? React.createElement("i", { className: "spin" }) : Ico("checkCircle"), T.running ? "running" : "completed"),
          React.createElement("span", { className: "na-trace-id mono" }, id)),
        React.createElement("h2", { className: "na-trace-title" }, T.title),
        React.createElement("div", { className: "na-trace-by" }, React.createElement("span", { className: "av agent" }, Ico("sparkles")), T.agent),
        React.createElement("div", { className: "na-trace-stats" },
          React.createElement("span", { className: "na-tstat" }, React.createElement("b", null, doneN + "/" + T.steps.length), "steps"),
          React.createElement("span", { className: "na-tstat" }, React.createElement("b", { className: "mono" }, T.cost), "cost"),
          React.createElement("span", { className: "na-tstat" }, React.createElement("b", { className: "mono" }, T.duration), "runtime"),
          React.createElement("span", { className: "na-tstat" }, React.createElement("b", null, T.model), "model")),
        React.createElement("div", { className: "na-trace-scope-row" }, Ico("shield"), T.scope)),

      React.createElement("div", { className: "na-timeline" },
        T.steps.map((s, i) => React.createElement("div", { key: i, className: "na-tstep", "data-status": s.status, "data-open": !!openSteps[i] },
          React.createElement("div", { className: "na-tspine" },
            React.createElement("span", { className: "na-tdot", "data-status": s.status },
              s.status === "running" ? React.createElement("i", { className: "spin" }) : s.status === "done" ? Ico("check") : null)),
          React.createElement("button", { className: "na-tstep-main", onClick: () => toggle(i) },
            React.createElement("div", { className: "na-tstep-top" },
              React.createElement("span", { className: "na-tkind", "data-kind": s.kind }, Ico(s.icon), s.kind),
              React.createElement("strong", null, s.title),
              s.meta ? React.createElement("span", { className: "na-tmeta" }, s.meta) : null,
              s.diff ? React.createElement("span", { className: "na-tdiffflag" }, Ico("diff"), s.diff.cells.length) : null,
              React.createElement("span", { className: "na-tchev", "data-open": !!openSteps[i] }, Ico("chevD"))),
            openSteps[i] ? React.createElement("div", { className: "na-tbody" },
              React.createElement("p", { className: "na-tdetail" }, s.detail),
              s.diff ? rowDiff(s.diff) : null) : null)))),

      React.createElement("p", { className: "na-ask-note", style: { textAlign: "left", padding: "12px 2px 0" } },
        "Every step is metered and reversible. Nothing is written outside the approved scope.")),

    React.createElement("div", { className: "na-sheet-foot" },
      React.createElement("div", { className: "na-quickchips" },
        React.createElement("button", { className: "na-quickchip primary", onClick: () => ctx.openFromTrace({ artifact: T.artifact, artifactName: T.artifactName, trace: id }) },
          Ico(T.artifact === "evidence" ? "file" : "table"), "Open " + (T.artifactName || "artifact")),
        React.createElement("button", { className: "na-quickchip", onClick: () => ctx.toast("Trace " + id + " copied") }, Ico("link"), "Copy trace id"))));
}

// inline row-diff table — what a step actually changed in the sheet
export function rowDiff(diff: D.TraceDiff): React.ReactElement {
  return React.createElement("div", { className: "na-rowdiff", "data-readonly": !!diff.readonly },
    React.createElement("div", { className: "na-rowdiff-head" },
      Ico("table"), React.createElement("span", null, diff.row),
      diff.version ? React.createElement("span", { className: "na-rowdiff-ver mono" }, diff.version) : null,
      diff.readonly ? React.createElement("span", { className: "na-rowdiff-ver" }, "read-only check") : null),
    diff.cells.map((c, i) => React.createElement("div", { key: i, className: "na-rowdiff-cell" },
      React.createElement("span", { className: "fk" }, c.field),
      React.createElement("span", { className: "fb" }, c.before),
      React.createElement("span", { className: "fa-arrow" }, Ico("arrowRight")),
      React.createElement("span", { className: "fa" }, c.after),
      React.createElement("span", { className: "fd", "data-match": c.delta === "match" }, c.delta))));
}

// ── SOURCE READER — opens the actual cited source ────────────────────────
export function SourceOverlay({ src, ctx }: { src: D.SourceRef | null | undefined; ctx: MobileCtx }): React.ReactElement | null {
  if (!src) return null;
  const verified = !!src.verified;
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "na-sheet-head" },
      React.createElement("button", { className: "na-cc-back", onClick: ctx.closeOverlay, "aria-label": "Back" }, Ico("chevL")),
      React.createElement("div", { className: "st", style: { flex: 1 } },
        React.createElement("strong", null, src.host || "Source"),
        React.createElement("span", null, (src.srcType || "Source") + (src.date ? " · " + src.date : ""))),
      React.createElement("button", { className: "na-close", onClick: ctx.closeOverlay, "aria-label": "Close" }, Ico("x"))),
    React.createElement("div", { className: "na-sheet-body" },
      React.createElement("div", { className: "na-srchead" },
        React.createElement("span", { className: "na-srcv", "data-v": verified }, Ico(verified ? "checkCircle" : "clock")),
        React.createElement("span", { className: "na-srcv-label", "data-v": verified }, verified ? "Verified source" : "Unverified — corroborate before citing")),
      React.createElement("h2", { className: "na-srctitle" }, src.text || src.claim || "Cited passage"),
      React.createElement("div", { className: "na-srcdoc" },
        React.createElement("div", { className: "na-srcdoc-bar" }, Ico("file"), src.url || src.host),
        React.createElement("p", { className: "na-srcexcerpt" }, src.excerpt || "No excerpt captured for this source. Open the original to review the full context.")),
      React.createElement("div", { className: "na-srcmeta" },
        src.host ? React.createElement("div", { className: "na-srcmeta-row" }, Ico("link"), React.createElement("span", null, "Origin"), React.createElement("b", null, src.host)) : null,
        src.date ? React.createElement("div", { className: "na-srcmeta-row" }, Ico("clock"), React.createElement("span", null, "Captured"), React.createElement("b", null, src.date)) : null)),
    React.createElement("div", { className: "na-sheet-foot" },
      React.createElement("div", { className: "na-quickchips" },
        React.createElement("button", { className: "na-quickchip primary", onClick: () => ctx.toast("Opening " + (src.url || src.host) + " ↗") }, Ico("extlink"), "View original"),
        React.createElement("button", { className: "na-quickchip", onClick: () => ctx.toast("Source attached to evidence") }, Ico("plus"), "Attach to claim"))));
}
