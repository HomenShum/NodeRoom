/* ============================================================================
   NodeAgent Mobile — governed spreadsheet artifact workbench
   The grid twin of the deck workbench. The whole sheet is editable in place:
   tap a value to fix it by hand, or tap a flagged status to drop a sourcing
   prompt straight into the chat composer — the agent answers with a sourced
   patch you accept inline. Export (XLSX or PowerPoint) lives at the top; the
   structured, gated sheet JSON is the source of truth a deck is rendered from.
   Ported from the design prototype (na-grid.jsx).
   ============================================================================ */
import * as React from "react";
import * as ReactDOM from "react-dom";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import { Pill } from "./MobileScreens";
import * as D from "./mobileData";
import type {
  Tone,
  Sheet as SheetData,
  SheetColumn,
  SheetRow,
  SheetCell,
  Claim as SheetClaim,
  ClaimSupport as SheetClaimSupport,
  PlanTodo as SheetTodo,
  Followup as SheetFollowup,
  VersionEntry as SheetVersion,
  PatchEvidence,
} from "./mobileData";
import type { MobileCtx } from "./mobileTypes";
import { haptic } from "./mobileUtil";
import {
  GESTURE_THRESHOLDS,
  classifyRelease,
  dragOffset,
  longPressEligible,
  type Gesture,
} from "./mobileGestures";

const { useState, useRef, useEffect, useCallback } = React;

/** Gesture verbs a record card can fire. */
export interface RowGestureHandlers {
  onLongPress: () => void;
  onSwipeRight: () => void;
  onSwipeLeft: () => void;
}

/**
 * useRowGesture — binds the PURE threshold math (mobileGestures.ts) to real
 * pointer events on a record card. Returns pointer handlers + the live drag
 * offset (px) for the card transform. A committed swipe/long-press fires exactly
 * one handler; a plain tap does nothing here (the inner buttons keep their
 * onClick). The long-press timer is armed on down and re-validated against the
 * pure `longPressEligible` predicate so a drift cancels it.
 */
export function useRowGesture(handlers: RowGestureHandlers) {
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  const firedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [drag, setDrag] = useState(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const clearTimer = () => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = undefined; } };
  useEffect(() => clearTimer, []);

  const fire = (g: Gesture) => {
    if (firedRef.current) return;
    if (g === "long-press") { firedRef.current = true; handlersRef.current.onLongPress(); }
    else if (g === "swipe-right") { firedRef.current = true; handlersRef.current.onSwipeRight(); }
    else if (g === "swipe-left") { firedRef.current = true; handlersRef.current.onSwipeLeft(); }
  };

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Only track primary pointer; ignore right-click / multi-touch.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    firedRef.current = false;
    setDrag(0);
    clearTimer();
    timerRef.current = setTimeout(() => {
      // Re-validate at fire time: still down, barely moved → long-press.
      if (!start.current || firedRef.current) return;
      if (longPressEligible({ dx: drag, dy: 0, dt: GESTURE_THRESHOLDS.longPressMs })) fire("long-press");
    }, GESTURE_THRESHOLDS.longPressMs);
  }, [drag]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!start.current || firedRef.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    setDrag(dragOffset(dx, dy));
    // If the finger clearly left the long-press tolerance, cancel the timer so a
    // drag never resolves as a long-press.
    if (Math.hypot(dx, dy) > GESTURE_THRESHOLDS.longPressMoveTolerance) clearTimer();
  }, []);

  const end = useCallback((e: React.PointerEvent) => {
    clearTimer();
    const s = start.current;
    start.current = null;
    setDrag(0);
    if (!s || firedRef.current) return;
    const g = classifyRelease({ dx: e.clientX - s.x, dy: e.clientY - s.y, dt: Date.now() - s.t });
    fire(g);
  }, []);

  return {
    drag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: end,
      onPointerCancel: (e: React.PointerEvent) => { clearTimer(); start.current = null; setDrag(0); void e; },
    },
  };
}

interface Patch {
  target: string;
  before: string;
  after: string;
  note: string;
  evidence: PatchEvidence[];
}
interface CellTarget {
  rowId: string;
  colId: string;
  label: string;
}
interface PendingPatch {
  rowId: string;
  colId: string;
  patch: Patch;
}
interface EditingCell {
  rowId: string;
  colId: string;
}
interface GridChatMsg {
  id: string;
  role: "user" | "agent";
  text?: string;
  target?: string | null;
  patch?: Patch;
  tgt?: CellTarget;
  variant?: string;
  chip?: string;
}
interface PlanChatMsg {
  id: string;
  role: "user" | "agent";
  text: string;
  chip?: string;
}
interface PlanQuick {
  label: string;
  icon: IconName;
  primary?: boolean;
  text: string;
}
interface EvidenceThreadMsg {
  role: "user" | "agent";
  text: string;
}

const STATUS_LABEL: Record<string, string> = { warn: "needs review", bad: "source gap", mute: "manual" };

// Build a believable sourced patch for a given cell — claim-backed where we
// have evidence, otherwise a tone-appropriate proposal.
export function buildPatch(S: SheetData, row: SheetRow, col: SheetColumn, cell: SheetCell): Patch {
  const company = row.cells.company.v;
  const target = company + " · " + col.label;
  const before = cell.v;
  const claim = cell.claim && S.claims[cell.claim];
  void claim;
  if (cell.claim === "runway") return { target, before, after: "~9 months",
    note: "Derived cash ÷ burn. Burn is still a deck estimate, so it lands as a draft.",
    evidence: [{ n: "1", text: "NetSuite cash — $4.1M (Q3 close)", verified: true }, { n: "2", text: "Burn ≈ $0.45M/mo (deck p.14)", verified: false }] };
  if (cell.claim === "funding") return { target, before, after: "Series B · raising (size unconfirmed)",
    note: "Two weak signals agree on the round but not the size — proposing it flagged, not confirmed.",
    evidence: [{ n: "1", text: "“raising Series B” — deck p.12", verified: false }, { n: "2", text: "Funding rumor Mar 2026 — techcrunch.com", verified: true }] };
  if (col.id === "runway") return { target, before, after: "~14 months",
    note: "Cash ÷ burn from the latest export.", evidence: [{ n: "1", text: "Reconciled vs Q3 close export", verified: true }] };
  if (col.id === "funding") return { target, before, after: before.replace(/^Seed/, "Seed · confirmed"),
    note: "Round size matches the public record.", evidence: [{ n: "1", text: "Crunchbase round record", verified: true }] };
  if (col.id === "arr") return { target, before, after: before, note: "Already matches the Q3 close — clearing the flag, value unchanged.",
    evidence: [{ n: "1", text: "Reconciled vs Q3 close", verified: true }] };
  if (col.id === "product") return { target, before, after: before, note: "Confirmed against the company’s own materials.",
    evidence: [{ n: "1", text: "Company site + deck p.3", verified: true }] };
  if (cell.tone === "mute") return { target, before, after: before, note: "Manual cell — I’ll leave your value and just clear the flag once you confirm.", evidence: [] };
  return { target, before, after: before, note: "Confirmed against an approved source.", evidence: [{ n: "1", text: "Approved source", verified: true }] };
}

export function SheetArtifact({ ctx }: { ctx: MobileCtx }): React.ReactElement {
  const S: SheetData = D.SHEET;
  const [tab, setTab] = useState<string>("grid");
  const [rows, setRows] = useState<SheetRow[]>(S.rows);
  const [exported, setExported] = useState(false);

  // sheet-local conversation + composer
  const [chat, setChat] = useState<GridChatMsg[]>([]);                 // {id, role, text, patch?, resolved?}
  const [draft, setDraft] = useState("");
  const [target, setTarget] = useState<CellTarget | null>(null);      // {rowId, colId, label}
  const [pending, setPending] = useState<PendingPatch | null>(null);  // {rowId, colId, patch}
  const [editing, setEditing] = useState<EditingCell | null>(null);   // {rowId, colId}
  const [editVal, setEditVal] = useState("");
  const [present, setPresent] = useState(false);                      // fullscreen spreadsheet viewer
  const [planChat, setPlanChat] = useState<PlanChatMsg[]>([]);        // plan-tab conversation
  const composerRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const mid = useRef(1);
  const pmid = useRef(1);

  useEffect(() => { if (editing && editRef.current) { editRef.current.focus(); editRef.current.select(); } }, [editing]);

  const reviewCount = rows.reduce((n: number, r: SheetRow) => n + Object.values(r.cells).filter((c: SheetCell) => c.tone && c.tone !== "ok").length, 0);

  // ── inline manual edit ──────────────────────────────────────────────────
  const startEdit = (rowId: string, col: SheetColumn, cell: SheetCell) => { setEditing({ rowId, colId: col.id }); setEditVal(cell.v); };
  const commitEdit = () => {
    if (!editing) return;
    const { rowId, colId } = editing;
    const val = editVal.trim();
    setRows((prev: SheetRow[]) => prev.map((r: SheetRow) => r.id === rowId
      ? Object.assign({}, r, { cells: Object.assign({}, r.cells, { [colId]: Object.assign({}, r.cells[colId], val ? { v: val, status: "manual note", tone: "mute" } : {}) }) }) as SheetRow
      : r));
    const company = rows.find((r: SheetRow) => r.id === rowId)!.cells.company.v;
    const col = S.columns.find((c: SheetColumn) => c.id === colId)!;
    setEditing(null);
    ctx.toast("Edited " + company + " · " + col.label);
  };
  const cancelEdit = () => setEditing(null);

  // ── gap pack: record-card gestures (design gaps-app.jsx PEdit + swipe caps) ──
  //   long-press  → raise the first editable cell into edit
  //   swipe-right → watch the row (wave-2 setWatch; honest toast in memory)
  //   swipe-left  → flag needs_review (existing cell edit path; honest offline)
  const rowGesture = useCallback((r: SheetRow): RowGestureHandlers => {
    const firstEditable = S.columns.find((c: SheetColumn) => !c.head) ?? S.columns[0];
    return {
      onLongPress: () => {
        haptic();
        startEdit(r.id, firstEditable, r.cells[firstEditable.id]);
      },
      onSwipeRight: () => {
        haptic();
        const on = !ctx.isRowWatched(r.id);
        void ctx.watchRow(r.id, on).then((res) => {
          if (res.ok) ctx.toast(on ? "Watching " + r.cells.company.v + " — writes notify you" : "Stopped watching " + r.cells.company.v);
          else ctx.toast(ctx.isLive ? "Could not update watch — " + (res.reason ?? "try again") : "Watch is live-only — join a room to watch rows");
        });
      },
      onSwipeLeft: () => {
        haptic();
        void ctx.flagRowNeedsReview(r.id).then((res) => {
          if (res.ok) ctx.toast("Flagged " + r.cells.company.v + " · needs review");
          else ctx.toast(ctx.isLive ? "Could not flag — " + (res.reason ?? "try again") : "Flagging is live-only — join a room to flag rows");
        });
      },
    };
  }, [S.columns, ctx, startEdit]);

  // ── tap a flagged status → drop a sourcing prompt into the composer ──────
  const promptFix = (rowId: string, col: SheetColumn, cell: SheetCell) => {
    const company = rows.find((r: SheetRow) => r.id === rowId)!.cells.company.v;
    const label = company + " · " + col.label;
    setTarget({ rowId, colId: col.id, label });
    setDraft("Fix " + label + " — now “" + cell.v + "”. ");
    setTab("grid");
    requestAnimationFrame(() => { const el = composerRef.current; if (el) { el.focus(); const v = el.value; el.value = ""; el.value = v; } });
  };
  const clearTarget = () => { setTarget(null); setDraft(""); };

  // ── send a message → agent proposes a sourced patch for the target cell ──
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const push = (m: Omit<GridChatMsg, "id">) => setChat((c: GridChatMsg[]) => [...c, Object.assign({ id: "m" + (mid.current++) }, m) as GridChatMsg]);
    push({ role: "user", text, target: target ? target.label : null });
    setDraft("");
    let tgt = target;
    if (!tgt) { // no explicit cell — aim at the first flagged cell
      for (const r of rows) { const col = S.columns.find((c: SheetColumn) => { const cl = r.cells[c.id]; return !c.head && cl.tone && cl.tone !== "ok"; }); if (col) { tgt = { rowId: r.id, colId: col.id, label: r.cells.company.v + " · " + col.label }; break; } }
    }
    if (!tgt) { setTimeout(() => push({ role: "agent", text: "Every cell is already source-backed — nothing flagged to fix. Ask me to re-check any value and I’ll re-open it." }), 500); return; }
    const finalTgt = tgt;
    const row = rows.find((r: SheetRow) => r.id === finalTgt.rowId)!;
    const col = S.columns.find((c: SheetColumn) => c.id === finalTgt.colId)!;
    const patch = buildPatch(S, row, col, row.cells[col.id]);
    setTimeout(() => {
      push({ role: "agent", variant: "status", text: "Reading approved sources for " + finalTgt.label + "…" });
      setTimeout(() => { push({ role: "agent", patch: patch, tgt: finalTgt }); setPending({ rowId: finalTgt.rowId, colId: finalTgt.colId, patch: patch }); }, 900);
    }, 350);
    setTarget(null);
  };

  const acceptPatch = () => {
    if (!pending) return;
    const { rowId, colId, patch } = pending;
    setRows((prev: SheetRow[]) => prev.map((r: SheetRow) => r.id === rowId
      ? Object.assign({}, r, { cells: Object.assign({}, r.cells, { [colId]: Object.assign({}, r.cells[colId], { v: patch.after, status: "source-backed", tone: "ok" }) }) }) as SheetRow
      : r));
    setChat((c: GridChatMsg[]) => [...c, { id: "m" + (mid.current++), role: "agent", chip: "ok", text: "Updated " + patch.target + " and marked it source-backed." }]);
    setPending(null);
    ctx.toast("Cell updated · " + patch.target);
  };
  const rejectPatch = () => {
    if (!pending) return;
    setChat((c: GridChatMsg[]) => [...c, { id: "m" + (mid.current++), role: "agent", chip: "bad", text: "Kept the original. Logged the request without changing the cell." }]);
    setPending(null);
    ctx.toast("Kept the original");
  };

  // ── plan-tab composer: talk to the agent about the enrichment plan ───────
  const planSend = (txt?: string) => {
    const text = (txt !== undefined ? txt : draft).trim();
    if (!text) return;
    const push = (m: Omit<PlanChatMsg, "id">) => setPlanChat((c: PlanChatMsg[]) => [...c, Object.assign({ id: "p" + (pmid.current++) }, m) as PlanChatMsg]);
    push({ role: "user", text });
    setDraft("");
    const s = text.toLowerCase();
    if (/approve|run it|go ahead|sounds good|ship it/.test(s)) {
      setTimeout(() => push({ role: "agent", chip: "ok", text: "Approved — running the read-only enrichment now. I’ll propose every cell as a diff and leave your manual cells untouched." }), 420);
      ctx.toast("Enrichment approved"); return;
    }
    let reply = "Noted. I’ll keep this scoped to the approved sources and propose each cell as a diff before anything changes.";
    if (/read|source|where/.test(s)) reply = "I’ll read the NetSuite export and the cached company profiles only — nothing outside the room’s approved scope.";
    else if (/cost|much|spend|price/.test(s)) reply = "Estimated at $0.01 — four reads, zero writes. You’ll see the actual on the receipt after it runs.";
    else if (/scope|tighten|narrow|only/.test(s)) reply = "Tightened — I’ll only touch the flagged cells (runway, funding, Vitalink seed) and skip everything already source-backed.";
    setTimeout(() => push({ role: "agent", text: reply }), 520);
  };
  const PLAN_QUICK: PlanQuick[] = [
    { label: "Approve enrichment", icon: "check", primary: true, text: "Approve the enrichment plan" },
    { label: "What will you read?", icon: "shield", text: "What will you read?" },
    { label: "Tighten scope", icon: "target", text: "Tighten the scope" },
  ];

  const TABS: [string, string, IconName][] = [
    ["plan", "Plan", "sparkles"],
    ["grid", "Sheet", "table"],
    ["evidence", "Evidence", "shield"],
    ["export", "Export", "download"],
  ];

  return React.createElement(React.Fragment, null,
    present && ReactDOM.createPortal(
      React.createElement(SheetPresentOverlay, { S, rows, reviewCount, onClose: () => setPresent(false) }),
      document.querySelector(".na-app") || document.body),

    React.createElement("div", { className: "na-sheet-head" },
      React.createElement("div", { className: "st" },
        React.createElement("strong", null, S.title),
        React.createElement("span", null, S.sub)),
      React.createElement("button", { className: "na-close", onClick: ctx.closeSheet, "aria-label": "Close" }, Ico("x"))),

    React.createElement("div", { className: "na-art-tabs" },
      TABS.map(([id, label, icon]) => React.createElement("button", {
        key: id, className: "na-art-tab", "data-active": tab === id,
        onClick: () => setTab(id),
      }, Ico(icon), label,
        id === "grid" && reviewCount ? React.createElement("span", { className: "n warn" }, reviewCount) : null))),

    React.createElement("div", { className: "na-sheet-body", "data-pad": tab === "grid" ? "compose" : undefined },
      tab === "plan" && React.createElement(SheetPlanView, { S, planChat }),
      tab === "grid" && React.createElement(GridView, {
        S, rows, reviewCount, exported,
        editing, editVal, setEditVal, editRef, startEdit, commitEdit, cancelEdit,
        onFix: promptFix, onExport: () => setTab("export"), onPresent: () => setPresent(true),
        chat,
        onAccept: acceptPatch, onReject: rejectPatch,
        rowGesture, isWatched: ctx.isRowWatched,
      }),
      tab === "evidence" && React.createElement(SheetEvidence, { S, ctx }),
      tab === "export" && React.createElement(SheetExport, { S, rows, exported, onExport: (fmt: string, ver?: string) => { setExported(true); ctx.toast((ver ? ver + " · " : "") + (fmt === "pptx" ? "CardioNova_update.pptx generated" : "Q3_diligence_tracker.xlsx downloaded")); } })),

    // bottom region — a chat composer on both Plan and Sheet tabs
    (tab === "grid" || tab === "plan") && React.createElement("div", { className: "na-sheet-compose" },
      tab === "grid" && pending && React.createElement(PatchTray, { patch: pending.patch, onAccept: acceptPatch, onReject: rejectPatch }),
      tab === "grid" && target && React.createElement("div", { className: "na-compose-target" },
        Ico("table"), React.createElement("span", null, target.label),
        React.createElement("button", { onClick: clearTarget, "aria-label": "Clear" }, Ico("x"))),
      tab === "plan" && React.createElement("div", { className: "na-compose-quick" },
        PLAN_QUICK.map((q: PlanQuick) => React.createElement("button", { key: q.label, className: q.primary ? "primary" : "", onClick: () => planSend(q.text) }, Ico(q.icon), q.label))),
      React.createElement("div", { className: "na-compose-row" },
        React.createElement("span", { className: "mk" }, Ico("sparkles")),
        React.createElement("input", {
          ref: composerRef, className: "na-compose-input", value: draft, type: "text",
          placeholder: tab === "plan" ? "Reply to NodeAgent…  approve, refine, or ask" : "Ask NodeAgent to source a cell…  or tap a value to edit it",
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
          onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); tab === "plan" ? planSend() : send(); } },
        }),
        React.createElement("button", { className: "na-compose-send", disabled: !draft.trim(), onClick: () => tab === "plan" ? planSend() : send(), "aria-label": "Send" }, Ico("arrowUp"))),
      React.createElement("p", { className: "na-compose-note" }, Ico("lock"), "Read-only — the agent proposes a sourced diff; nothing changes until you approve.")));
}

// ── GRID (records as cards · inline edit · tap a status to source it) ──────
interface GridViewProps {
  S: SheetData;
  rows: SheetRow[];
  reviewCount: number;
  exported: boolean;
  editing: EditingCell | null;
  editVal: string;
  setEditVal: React.Dispatch<React.SetStateAction<string>>;
  editRef: React.RefObject<HTMLInputElement | null>;
  startEdit: (rowId: string, col: SheetColumn, cell: SheetCell) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
  onFix: (rowId: string, col: SheetColumn, cell: SheetCell) => void;
  onExport: () => void;
  onPresent: () => void;
  chat: GridChatMsg[];
  onAccept: () => void;
  onReject: () => void;
  /** Per-row gesture handlers (long-press edit / swipe watch / swipe flag). */
  rowGesture: (r: SheetRow) => RowGestureHandlers;
  /** True when a row is currently watched (drives the card's watch affordance). */
  isWatched: (rowId: string) => boolean;
}
function GridView({ S, rows, editing, editVal, setEditVal, editRef, startEdit, commitEdit, cancelEdit, onFix, onExport, onPresent, chat, rowGesture, isWatched }: GridViewProps): React.ReactElement {
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "na-sheet-actions" },
      React.createElement("span", { className: "na-sheet-count" }, rows.length + " records · " + S.columns.length + " fields"),
      React.createElement("div", { className: "na-sheet-actbtns" },
        React.createElement("button", { className: "na-sheet-export", onClick: onPresent }, Ico("expand"), "Full view"),
        React.createElement("button", { className: "na-sheet-export primary", onClick: onExport }, Ico("download"), "Export"))),
    React.createElement("div", { className: "na-srows" },
      rows.map((r: SheetRow) => React.createElement(SheetRowCard, {
        key: r.id, S, r, editing, editVal, setEditVal, editRef, startEdit, commitEdit, cancelEdit, onFix,
        gesture: rowGesture(r), watched: isWatched(r.id),
      }))),
    React.createElement("div", { className: "na-grid-legend" },
      legend("ok", "source-backed"), legend("warn", "needs review"), legend("bad", "source gap"), legend("mute", "manual")),
    chat.length ? React.createElement("div", { className: "na-zchat", style: { marginTop: 14 } },
      chat.map((m: GridChatMsg) => m.role === "user"
        ? React.createElement("div", { key: m.id, className: "na-zmsg user" },
            m.target ? React.createElement("span", { className: "na-ztarget" }, Ico("table"), m.target) : null, m.text)
        : m.patch
          ? React.createElement("div", { key: m.id, className: "na-zmsg agent" },
              React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico("sparkles")), "NodeAgent"),
              React.createElement(PatchInline, { patch: m.patch }))
          : React.createElement("div", { key: m.id, className: "na-zmsg agent" },
              React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico("sparkles")), "NodeAgent"),
              m.variant === "status"
                ? React.createElement("p", { className: "na-ztext muted" }, React.createElement("i", { className: "spin sm" }), m.text)
                : React.createElement("p", { className: "na-ztext" }, m.text),
              m.chip ? React.createElement("span", { className: "na-zchip", "data-tone": m.chip }, Ico(m.chip === "ok" ? "check" : "x"), m.chip === "ok" ? "cell updated" : "kept original") : null))) : null);
}

// One record as a card — value tappable to edit, flagged status tappable to source.
interface SheetRowCardProps {
  S: SheetData;
  r: SheetRow;
  editing: EditingCell | null;
  editVal: string;
  setEditVal: React.Dispatch<React.SetStateAction<string>>;
  editRef: React.RefObject<HTMLInputElement | null>;
  startEdit: (rowId: string, col: SheetColumn, cell: SheetCell) => void;
  commitEdit: () => void;
  cancelEdit: () => void;
  onFix: (rowId: string, col: SheetColumn, cell: SheetCell) => void;
  gesture: RowGestureHandlers;
  watched: boolean;
}
function SheetRowCard({ S, r, editing, editVal, setEditVal, editRef, startEdit, commitEdit, cancelEdit, onFix, gesture, watched }: SheetRowCardProps): React.ReactElement {
  const headCol = S.columns.find((c: SheetColumn) => c.head)!;
  const fields = S.columns.filter((c: SheetColumn) => !c.head);
  const flaggedCount = fields.reduce((n: number, c: SheetColumn) => { const cell = r.cells[c.id]; return n + (cell.tone && cell.tone !== "ok" ? 1 : 0); }, 0);
  const { drag, handlers: pointer } = useRowGesture(gesture);
  const dir = drag > 8 ? "right" : drag < -8 ? "left" : undefined;
  return React.createElement("div", {
    className: "na-srow",
    "data-flagged": flaggedCount > 0 ? "true" : undefined,
    "data-watched": watched ? "true" : undefined,
    "data-swipe": dir,
    "data-testid": "grid-record-card",
    style: drag ? { transform: `translateX(${drag}px)`, touchAction: "pan-y" } : { touchAction: "pan-y" },
    ...pointer,
  },
    React.createElement("div", { className: "na-srow-head" },
      React.createElement("strong", null, r.cells[headCol.id].v),
      watched ? React.createElement("span", { className: "na-pill ok", title: "Watching this row" }, Ico("eye"), "watching") : null,
      flaggedCount
        ? React.createElement("span", { className: "na-pill warn" }, flaggedCount + " to fix")
        : React.createElement("span", { className: "na-pill ok" }, Ico("check"), "all sourced")),
    React.createElement("div", { className: "na-srow-fields" },
      fields.map((c: SheetColumn) => {
        const cell = r.cells[c.id];
        const flag = cell.tone && cell.tone !== "ok";
        const isEditing = editing && editing.rowId === r.id && editing.colId === c.id;
        return React.createElement("div", { key: c.id, className: "na-sfield", "data-tone": cell.tone || "ok", "data-flag": flag ? "true" : undefined, "data-mono": c.mono ? "true" : undefined, "data-editing": isEditing ? "true" : undefined },
          React.createElement("span", { className: "k" }, c.label),
          isEditing
            ? React.createElement("input", {
                ref: editRef, className: "na-sfield-edit", value: editVal,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setEditVal(e.target.value),
                onBlur: commitEdit,
                onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); commitEdit(); } else if (e.key === "Escape") { e.preventDefault(); cancelEdit(); } },
              })
            : React.createElement("button", { className: "v", onClick: () => startEdit(r.id, c, cell), title: "Tap to edit" }, cell.v, React.createElement("span", { className: "pen" }, Ico("pen"))),
          !isEditing && (flag
            ? React.createElement("button", { className: "fix", onClick: () => onFix(r.id, c, cell), title: "Source this cell" },
                React.createElement("i", { className: "d", "data-tone": cell.tone }),
                STATUS_LABEL[cell.tone || ""] || cell.status, Ico("chevR"))
            : React.createElement("span", { className: "ok-mark" }, Ico("check"))));
      })));
}

function legend(tone: string, label: string): React.ReactElement {
  return React.createElement("span", { key: tone, className: "na-leg" }, React.createElement("i", { "data-tone": tone }), label);
}

// patch as an inline chat bubble (read-only record of what was proposed)
function PatchInline({ patch }: { patch: Patch }): React.ReactElement {
  return React.createElement("div", { className: "na-patch flat" },
    React.createElement("div", { className: "na-diff before" }, React.createElement("span", { className: "lbl" }, "Before"), React.createElement("p", null, patch.before)),
    React.createElement("div", { className: "na-diff after" }, React.createElement("span", { className: "lbl" }, "After"), React.createElement("p", null, patch.after)),
    patch.note ? React.createElement("p", { className: "na-patch-note" }, patch.note) : null,
    patch.evidence.length ? React.createElement("div", { className: "na-patch-ev" },
      patch.evidence.map((e: PatchEvidence) => React.createElement("span", { key: e.n, className: "na-cite" + (e.verified ? "" : " gap") },
        Ico(e.verified ? "checkCircle" : "gap"), React.createElement("sup", null, e.n), e.text))) : null);
}

// pinned accept/reject tray above the composer
function PatchTray({ patch, onAccept, onReject }: { patch: Patch; onAccept: () => void; onReject: () => void }): React.ReactElement {
  return React.createElement("div", { className: "na-patch-tray" },
    React.createElement("div", { className: "na-patch-tray-top" },
      Ico("diff"), React.createElement("strong", null, "Proposed · " + patch.target),
      React.createElement("span", { className: "arrow" }, patch.before, Ico("chevR"), React.createElement("b", null, patch.after))),
    React.createElement("div", { className: "na-btn-row" },
      React.createElement("button", { className: "na-btn sm", onClick: onReject }, Ico("x"), "Reject"),
      React.createElement("button", { className: "na-btn primary sm", onClick: onAccept }, Ico("check"), "Accept patch")));
}

// ── PLAN (z.ai-style chat transcript + live composer thread) ──────────────
function SheetPlanView({ S, planChat }: { S: SheetData; planChat: PlanChatMsg[] }): React.ReactElement {
  const P = S.plan;
  const mark = (st: string) => st === "done"
    ? React.createElement("span", { className: "na-todo-mark done" }, Ico("check"))
    : st === "running"
      ? React.createElement("span", { className: "na-todo-mark running" }, React.createElement("i", { className: "spin" }))
      : React.createElement("span", { className: "na-todo-mark" });
  const done = P.todos.filter((t: SheetTodo) => t.status === "done").length;
  return React.createElement("div", { className: "na-zchat" },
    React.createElement("div", { className: "na-zmsg user" }, P.goal),
    React.createElement("div", { className: "na-zmsg agent" },
      React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico("sparkles")), "NodeAgent"),
      React.createElement("p", { className: "na-ztext" }, "Here’s how I’ll close the gaps. I only read the approved sources and propose each cell as a diff — your manual cells stay untouched."),
      React.createElement("div", { className: "na-todos" },
        React.createElement("div", { className: "na-todos-head" }, Ico("check"), "Todos", React.createElement("span", { className: "c" }, done + " / " + P.todos.length)),
        P.todos.map((t: SheetTodo, i: number) => React.createElement("div", { key: i, className: "na-todo", "data-st": t.status },
          mark(t.status), React.createElement("span", { className: "tx" }, t.text)))),
      React.createElement("div", { className: "na-ran" }, Ico("sparkles"), "Ran " + P.ran + " commands"),
      React.createElement("div", { className: "na-guard" }, Ico("lock"), P.guard)),
    (planChat || []).map((m: PlanChatMsg) => m.role === "user"
      ? React.createElement("div", { key: m.id, className: "na-zmsg user" }, m.text)
      : React.createElement("div", { key: m.id, className: "na-zmsg agent" },
          React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico("sparkles")), "NodeAgent"),
          React.createElement("p", { className: "na-ztext" }, m.text),
          m.chip ? React.createElement("span", { className: "na-zchip", "data-tone": m.chip }, Ico(m.chip === "ok" ? "check" : "x"), m.chip === "ok" ? "approved" : "kept original") : null)));
}

// ── dense grid table (used inside the fullscreen viewer) ──────────────────
function Grid({ S, rows, big, flat, selId }: { S: SheetData; rows: SheetRow[]; big?: boolean; flat?: boolean; selId?: string | null }): React.ReactElement {
  return React.createElement("div", { className: "na-gridwrap" + (big ? " big" : "") + (flat ? " flat" : "") },
    React.createElement("table", { className: "na-grid" },
      React.createElement("thead", null,
        React.createElement("tr", null,
          S.columns.map((c: SheetColumn) => React.createElement("th", { key: c.id, className: c.head ? "rowhead" : "", style: { minWidth: c.w } }, c.label)))),
      React.createElement("tbody", null,
        rows.map((r: SheetRow) => React.createElement("tr", { key: r.id, "data-sel": selId === r.id ? "true" : undefined },
          S.columns.map((c: SheetColumn) => {
            const cell = r.cells[c.id];
            if (c.head) return React.createElement("th", { key: c.id, className: "rowhead" }, cell.v);
            const flag = cell.tone && cell.tone !== "ok";
            return React.createElement("td", { key: c.id },
              React.createElement("div", { className: "na-gcell", "data-tone": cell.tone || "ok", "data-flag": !!flag, "data-mono": !!c.mono },
                React.createElement("span", { className: "gv" }, cell.v),
                flag ? React.createElement("span", { className: "gdot", "data-tone": cell.tone }) : null));
          }))))));
}

// ── FULL VIEW — fullscreen spreadsheet viewer, scaled to fit, with numbered
//    record selection (the sheet's answer to the deck's slide viewer). ─────
function SheetPresentOverlay({ S, rows, reviewCount, onClose }: { S: SheetData; rows: SheetRow[]; reviewCount: number; onClose: () => void }): React.ReactElement {
  const [sel, setSel] = useState(0);
  const [fit, setFit] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null), tableRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  React.useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current, tbl = tableRef.current;
      if (!stage || !tbl) return;
      const aw = stage.clientWidth - 28, ah = stage.clientHeight - 28;
      setScale(fit ? Math.min(1, aw / tbl.scrollWidth, ah / tbl.scrollHeight) : 1);
    };
    measure(); window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [fit, rows]);
  const selId = rows[sel] && rows[sel].id;
  return React.createElement("div", { className: "na-present" },
    React.createElement("div", { className: "na-present-bar" },
      React.createElement("div", { className: "pt" },
        React.createElement("strong", null, S.title),
        React.createElement("span", null, rows.length + " records · " + S.columns.length + " fields" + (reviewCount ? " · " + reviewCount + " to review" : ""))),
      React.createElement("button", { className: "na-present-btn", "data-on": !fit, onClick: () => setFit((v: boolean) => !v), "aria-label": "Toggle fit" }, Ico(fit ? "search" : "expand")),
      React.createElement("button", { className: "na-present-btn", onClick: onClose, "aria-label": "Close" }, Ico("x"))),
    React.createElement("div", { className: "na-gridstage" + (fit ? " fit" : ""), ref: stageRef },
      React.createElement("div", { ref: tableRef, className: "na-gridscale", style: { transform: "scale(" + scale + ")", transformOrigin: fit ? "center center" : "top left" } },
        React.createElement(Grid, { S, rows, big: true, flat: true, selId: selId }))),
    React.createElement("div", { className: "na-present-recs" },
      rows.map((r: SheetRow, k: number) => React.createElement("button", { key: r.id, className: "na-present-rec", "data-on": k === sel, onClick: () => setSel(k) },
        React.createElement("span", { className: "ri" }, k + 1),
        r.cells[S.columns.find((c: SheetColumn) => c.head)!.id].v))));
}

// ── EVIDENCE (sourced answers per flagged claim + follow-up chat) ─────────
function SheetEvidence({ S, ctx }: { S: SheetData; ctx: MobileCtx }): React.ReactElement {
  const claims = Object.values(S.claims);
  const [thread, setThread] = useState<EvidenceThreadMsg[]>([]);
  const [draft, setDraft] = useState("");
  const reply = (q: string) => {
    const s = q.toLowerCase();
    const hit = (S.followups || []).find((f: SheetFollowup) => f.match.some((m: string) => s.includes(m)));
    return hit ? hit.text : S.fallback;
  };
  const send = () => {
    const q = draft.trim(); if (!q) return;
    setThread((t: EvidenceThreadMsg[]) => [...t, { role: "user", text: q }, { role: "agent", text: reply(q) }]);
    setDraft("");
  };
  const openSource = (ctx as unknown as { openSource?: (s: SheetClaimSupport) => void }).openSource;
  return React.createElement(React.Fragment, null,
    claims.map((E: SheetClaim, ci: number) => React.createElement(ClaimBlock, { key: ci, E, onOpen: (s: SheetClaimSupport) => openSource && openSource(s) })),
    thread.length ? React.createElement("div", { className: "na-zchat", style: { marginTop: 14 } },
      thread.map((m: EvidenceThreadMsg, i: number) => m.role === "user"
        ? React.createElement("div", { key: i, className: "na-zmsg user" }, m.text)
        : React.createElement("div", { key: i, className: "na-zmsg agent" },
            React.createElement("div", { className: "na-zhead" }, React.createElement("span", { className: "av" }, Ico("sparkles")), "NodeAgent"),
            React.createElement("p", { className: "na-ztext" }, m.text)))) : null,
    React.createElement("div", { className: "na-zcompose" },
      React.createElement("span", { className: "mk" }, Ico("sparkles")),
      React.createElement("input", {
        className: "na-zinput", value: draft, type: "text",
        placeholder: "Ask a follow-up about a flagged cell…",
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value),
        onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); send(); } },
      }),
      React.createElement("button", { className: "na-zsend", disabled: !draft.trim(), onClick: send, "aria-label": "Send" }, Ico("arrowUp"))));
}

function ClaimBlock({ E, onOpen }: { E: SheetClaim; onOpen: (s: SheetClaimSupport) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const cites = E.support.filter((s: SheetClaimSupport) => s.kind === "cite");
  const gaps = E.support.filter((s: SheetClaimSupport) => s.kind === "gap");
  const answerNodes = [
    React.createElement("span", { key: "a" }, E.answer + " "),
    ...cites.map((c: SheetClaimSupport) => React.createElement("sup", { key: "c" + c.n, className: "na-inlinecite", "data-v": c.verified }, c.n)),
  ];
  return React.createElement("div", { className: "na-claimblock" },
    React.createElement("div", { className: "na-srcbar" },
      React.createElement("button", { className: "na-srctoggle", onClick: () => setOpen((v: boolean) => !v) },
        Ico("shield"), "Used " + cites.length + " sources",
        React.createElement("span", { className: "cx", "data-open": open }, Ico("chevD"))),
      React.createElement("span", { className: "na-srcclaim" }, E.claim)),
    open ? React.createElement("div", { className: "na-srclist" },
      cites.map((s: SheetClaimSupport) => React.createElement("button", { key: s.n, className: "na-srcrow", onClick: () => onOpen && onOpen(s) },
        React.createElement("span", { className: "n" }, s.n),
        React.createElement("span", { className: "na-srctext" },
          React.createElement("strong", null, s.text),
          React.createElement("span", { className: "h" }, s.host)),
        React.createElement("span", { className: "na-srcv", "data-v": s.verified }, Ico(s.verified ? "checkCircle" : "clock")),
        React.createElement("span", { className: "na-srcopen" }, Ico("extlink"))))) : null,
    React.createElement("p", { className: "na-answer" }, answerNodes),
    gaps.map((g: SheetClaimSupport, i: number) => React.createElement("div", { key: i, className: "na-srcgap" }, Ico("gap"), g.text)));
}

// ── EXPORT — XLSX or PowerPoint, both rendered from the gated sheet JSON ───
function SheetExport({ S, rows, exported, onExport }: { S: SheetData; rows: SheetRow[]; exported: boolean; onExport: (fmt: string, ver?: string) => void }): React.ReactElement {
  const [fmt, setFmt] = useState("xlsx");
  const isPptx = fmt === "pptx";
  const file = isPptx ? "CardioNova_update.pptx" : "Q3_diligence_tracker.xlsx";
  const meta = isPptx ? (rows.length + 1) + " slides · 7.7 MB" : rows.length + " rows · " + S.exportSize;
  return React.createElement(React.Fragment, null,
    React.createElement("div", { className: "na-seg", style: { marginBottom: 12 } },
      React.createElement("button", { "data-active": !isPptx, onClick: () => setFmt("xlsx") }, Ico("table"), "Spreadsheet"),
      React.createElement("button", { "data-active": isPptx, onClick: () => setFmt("pptx") }, Ico("layers"), "PowerPoint")),
    React.createElement("div", { className: "na-export" },
      React.createElement("div", { className: "na-export-ico" }, Ico(isPptx ? "layers" : "download")),
      React.createElement("div", { className: "na-export-main" },
        React.createElement("strong", null, exported ? file : (isPptx ? "PowerPoint deck ready" : S.exportFormat + " export ready")),
        React.createElement("span", null, meta)),
      React.createElement(Pill, { tone: (exported ? "ok" : "accent") as Tone }, exported ? "exported" : "ready")),
    React.createElement("button", { className: "na-btn primary full", onClick: () => onExport(fmt) }, Ico(isPptx ? "layers" : "download"), isPptx ? (exported ? "Generate again" : "Generate deck") : (exported ? "Download again" : "Download XLSX")),
    React.createElement("div", { className: "na-export-prov" },
      Ico("shield"),
      React.createElement("div", null,
        React.createElement("strong", null, "Rendered from the gated sheet JSON"),
        React.createElement("span", null, isPptx
          ? "The deck is generated from the same structured records — source-tracing and the honesty gate run once on the data, so slides can’t introduce a claim the sheet can’t back."
          : "Every exported value carries its source. Flagged cells export with their review status so nothing reads as confirmed before it is."))),
    isPptx ? React.createElement("div", { className: "na-export-flow" },
      React.createElement("span", { className: "fl" }, "sheet JSON", React.createElement("em", null, "source of truth · gated")),
      Ico("chevR"),
      React.createElement("span", { className: "fl" }, "HTML", React.createElement("em", null, "preview · comment-edit")),
      Ico("chevR"),
      React.createElement("span", { className: "fl" }, "PPTX / PDF", React.createElement("em", null, "export"))) : null,
    React.createElement("div", { className: "na-kicker", style: { marginTop: 8 } }, "Past versions"),
    React.createElement("div", { className: "na-vers" },
      S.versions.map((v: SheetVersion, i: number) => React.createElement("div", { key: i, className: "na-ver", "data-cur": !!v.current },
        React.createElement("span", { className: "vtag" }, v.v),
        React.createElement("span", { className: "vmain" },
          React.createElement("strong", null, v.label),
          React.createElement("span", { className: "vt" }, v.t)),
        React.createElement("div", { className: "na-ver-acts" },
          !v.current && React.createElement("button", { className: "na-ver-act", onClick: () => {} }, "Restore"),
          React.createElement("button", { className: "na-ver-dl", onClick: () => onExport(fmt, v.v), "aria-label": "Download " + v.v, title: "Download " + v.v }, Ico("download")))))));
}
