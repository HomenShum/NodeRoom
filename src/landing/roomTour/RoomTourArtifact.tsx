/* ============================================================================
   NodeAgent Room Tour — Artifact panel: spreadsheet · note · wall + collab bar
   + room trace. Ported from room/artifact.jsx (window.RArtifact). Every change
   routes back through RoomShell so it lands in the trace + chat.
   ============================================================================ */
import * as React from "react";
import { Ico, type IconName } from "./RoomTourIcons";
import { PEOPLE, type NoteBlock as NoteBlockData, type WallNote } from "./roomTourData";

// ── editable cell ───────────────────────────────────────────────────────────
function EditableCell({
  value,
  emptyLabel,
  onCommit,
  disabled,
  align,
}: {
  value: string | null;
  emptyLabel?: string;
  onCommit: (v: string) => void;
  disabled?: boolean;
  align?: "right";
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value || "");
  React.useEffect(() => { setDraft(value || ""); }, [value]);
  if (disabled) {
    return value != null
      ? <span className="rt-val-pos">{value}</span>
      : <span className="nullcell">{emptyLabel || "null"}</span>;
  }
  if (editing) {
    return (
      <input
        className="rt-cell-input"
        autoFocus
        value={draft}
        style={align === "right" ? { textAlign: "right" } : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft.trim() !== (value || "")) onCommit(draft); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button className="rt-cell-edit" onClick={() => setEditing(true)}>
      {value != null
        ? <span className="rt-val-pos">{value}</span>
        : <span className="add-hint">{Ico("plus", { size: 11 })}{emptyLabel || "add"}</span>}
    </button>
  );
}

// ── spreadsheet ─────────────────────────────────────────────────────────────
export interface SheetDisplayRow { id: string; label: string; q2: string | null; q3: string | null }
export interface SheetCellState { variance: string | null; note: string | null }
export interface SheetOverlay { locked: string[]; draft: string[] }
export interface SheetData {
  rows: SheetDisplayRow[];
  columns: string[];
  cells: Record<string, SheetCellState>;
  version: number;
  overlay: SheetOverlay;
  pulse: Record<string, boolean>;
}

function SheetView({
  sheet,
  onEditCell,
}: {
  sheet: SheetData;
  onEditCell: (rowId: string, field: "variance" | "note", value: string) => void;
}): React.ReactElement {
  const { rows, columns, cells, version, overlay, pulse } = sheet;
  const lockSet = new Set(overlay.locked);
  const draftSet = new Set(overlay.draft);
  return (
    <div className="rt-art-body">
      <div className="rt-sheet-wrap">
        <table className="rt-sheet">
          <thead>
            <tr>
              <th style={{ width: 70 }}>row</th>
              {columns.map((c, i) => (
                <th key={c} className={(i >= 1 && i <= 3) ? "num" : ""}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const cell = cells[row.id] || { variance: null, note: null };
              const locked = lockSet.has(row.id);
              const drafting = draftSet.has(row.id);
              const vCls = "rt-cell num" + (locked ? " locked" : "") + (drafting ? " draft" : "") + (pulse[row.id + ":variance"] ? " committed" : "");
              const nCls = "rt-cell" + (pulse[row.id + ":note"] ? " committed" : "");
              return (
                <tr key={row.id}>
                  <td className="rid">{row.id}</td>
                  <td className="label">{row.label}</td>
                  <td className="num"><span className="rt-val-num">{row.q2}</span></td>
                  <td className="num"><span className="rt-val-num">{row.q3}</span></td>
                  <td className={vCls}>
                    <EditableCell
                      value={cell.variance}
                      emptyLabel="add"
                      align="right"
                      disabled={locked || drafting}
                      onCommit={(v) => onEditCell(row.id, "variance", v)}
                    />
                    {locked ? <span className="lockbadge">{Ico("lock", { size: 9 })}NA</span> : null}
                    {drafting ? <span className="lockbadge">{Ico("draft", { size: 9 })}draft</span> : null}
                  </td>
                  <td className={nCls}>
                    <EditableCell
                      value={cell.note}
                      emptyLabel="note"
                      disabled={locked}
                      onCommit={(v) => onEditCell(row.id, "note", v)}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rt-sheet-foot">
        <span className="kicker">versionedSpreadsheetSync</span>
        <span className="rt-vpill next">v{version}</span>
        <span className="grow" />
        <span className="mono tiny faint">click a Variance or Note cell to edit by hand</span>
      </div>
    </div>
  );
}

// ── note ────────────────────────────────────────────────────────────────────
type RuntimeNoteBlock = NoteBlockData & { justAccepted?: boolean };
function NoteBlock({ b, onAccept }: { b: RuntimeNoteBlock; onAccept: (id: string) => void }): React.ReactElement {
  if (b.type === "heading") return <h2 className="nb-heading">{b.text}</h2>;
  const isDraft = b.status === "draft";
  const inner = b.type === "quote"
    ? <blockquote className="nb-quote">{b.text}</blockquote>
    : <p className="nb-para">{b.text}</p>;
  return (
    <div className={"nb-block" + (isDraft ? " draft" : "") + (b.justAccepted ? " just" : "")}>
      {inner}
      <div className="nb-meta">
        {b.author === "agent" ? <span className="nb-author">{Ico("spark", { size: 11 })}NodeAgent</span> : null}
        {isDraft ? <span className="nb-chip draft">agent draft</span> : null}
        {b.sources?.map((s) => <span key={s} className="nb-src">{Ico("doc", { size: 10 })}{s}</span>)}
        <span className="grow" />
        {isDraft ? (
          <button className="nb-accept" onClick={() => onAccept(b.id)}>
            {Ico("check", { size: 13 })}Accept
          </button>
        ) : null}
      </div>
    </div>
  );
}
function NoteView({ note }: { note: { blocks: RuntimeNoteBlock[]; onAccept: (id: string) => void } }): React.ReactElement {
  return (
    <div className="rt-art-body">
      <div className="rt-note">
        {note.blocks.map((b) => <NoteBlock key={b.id} b={b} onAccept={note.onAccept} />)}
      </div>
    </div>
  );
}

// ── wall (draggable + editable post-its) ────────────────────────────────────
export interface WallData {
  notes: WallNote[];
  onMove: (id: string) => void;
  onSetPos: (id: string, x: number, y: number) => void;
  onEdit: (id: string, text: string) => void;
  onAdd: () => void;
}
function WallView({ wallData }: { wallData: WallData }): React.ReactElement {
  const { notes, onMove, onSetPos, onEdit, onAdd } = wallData;
  const drag = React.useRef<{ id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const down = (e: React.PointerEvent<HTMLDivElement>, n: WallNote): void => {
    if ((e.target as HTMLElement).isContentEditable) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    drag.current = { id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.sx;
    const dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    onSetPos(d.id, Math.max(0, d.ox + dx), Math.max(0, d.oy + dy));
  };
  const up = (): void => {
    if (drag.current && drag.current.moved) onMove(drag.current.id);
    drag.current = null;
  };
  return (
    <div className="rt-art-body">
      <div className="rt-wall-toolbar">
        <button className="rt-btn ghost" onClick={onAdd} style={{ padding: "5px 10px", fontSize: 12 }}>
          {Ico("plus", { size: 14 })}Add note
        </button>
        <span className="grow" />
        <span className="muted tiny">drag to move · click text to edit</span>
      </div>
      <div className="rt-wall" onPointerMove={move} onPointerUp={up}>
        {notes.map((n, i) => {
          const p = PEOPLE[n.by] || PEOPLE.homen;
          const style = {
            left: n.x,
            top: n.y,
            background: n.color,
            ["--rot" as string]: (i % 2 ? 1.3 : -1.5) + "deg",
          } as React.CSSProperties;
          return (
            <div
              key={n.id}
              className="rt-postit"
              onPointerDown={(e) => down(e, n)}
              style={style}
            >
              <div
                className="pt-text"
                contentEditable
                suppressContentEditableWarning
                onBlur={(e) => {
                  const t = (e.target as HTMLElement).innerText.trim();
                  if (t && t !== n.text) onEdit(n.id, t);
                }}
              >
                {n.text}
              </div>
              <div className="pby">
                <span className="pby-av" style={{ background: p.color }}>{p.short}</span>
                {p.name}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── collab control bar (collab step only) ───────────────────────────────────
export interface CollabBarProps {
  beat: number;
  desc: string;
  playing: boolean;
  onPlay: () => void;
  onReset: () => void;
  needsApprove: boolean;
  onApprove: () => void;
}
function CollabBar({ beat, desc, playing, onPlay, onReset, needsApprove, onApprove }: CollabBarProps): React.ReactElement {
  return (
    <div className="rt-collab-bar">
      <span className="rt-tag" style={{ background: "var(--accent-tint)", color: "var(--accent-ink)" }}>
        {Ico("merge", { size: 12 })}Live collab
      </span>
      <span className="rt-beat-desc grow">{desc}</span>
      {needsApprove
        ? <button className="rt-btn primary" onClick={onApprove} style={{ padding: "6px 12px", fontSize: 12 }}>{Ico("check", { size: 14 })}Approve merge</button>
        : beat >= 6
          ? <button className="rt-btn ghost" onClick={onReset} style={{ padding: "6px 12px", fontSize: 12 }}>{Ico("history", { size: 14 })}Replay</button>
          : <button className="rt-btn primary" onClick={onPlay} disabled={playing} style={{ padding: "6px 12px", fontSize: 12 }}>
              {Ico(playing ? "cpu" : "play", { size: 14 })}{playing ? "Running…" : beat === 0 ? "Run collaboration" : "Resume"}
            </button>}
    </div>
  );
}

// ── room trace ──────────────────────────────────────────────────────────────
export interface TraceEntry {
  kind: string;
  ico: IconName | string;
  tool: string;
  text: string;
  detail: string;
  src?: string;
}
function TraceStrip({ log }: { log: TraceEntry[] }): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [log.length]);
  return (
    <div className="rt-trace">
      <div className="rt-trace-head">
        {Ico("history", { size: 14, style: { color: "var(--text-muted)" } })}
        <span className="h-title" style={{ fontSize: 11.5 }}>Room trace</span>
        <span className="grow" />
        <span className="mono tiny faint">agentTraces · {log.length} steps</span>
      </div>
      <div className="rt-trace-list" ref={ref}>
        {log.length === 0
          ? <div className="tiny faint" style={{ padding: "2px 4px" }}>Edit a cell, accept a note, move a sticky, or run the collaboration — every change is recorded here.</div>
          : log.map((e, i) => (
              <div className="rt-trace-item" key={i}>
                <span className={"rt-trace-ico " + e.kind}>{Ico((e.ico as IconName) || "dot", { size: 12 })}</span>
                <div className="grow">
                  <div className="tt">{e.text}</div>
                  <div className="td"><span style={{ color: "var(--accent-ink)" }}>{e.tool}</span> · {e.detail}</div>
                </div>
              </div>
            ))}
      </div>
    </div>
  );
}

// ── shell ───────────────────────────────────────────────────────────────────
const TABS: Array<{ id: "sheet" | "note" | "wall"; label: string; ic: IconName }> = [
  { id: "sheet", label: "Spreadsheet", ic: "sheet" },
  { id: "note",  label: "Note",        ic: "note" },
  { id: "wall",  label: "Wall",        ic: "wall" },
];
export type ArtifactTab = "sheet" | "note" | "wall";
export function ArtifactPanel(props: {
  tab: ArtifactTab;
  onTab: (t: ArtifactTab) => void;
  sheet: SheetData;
  onEditCell: (rowId: string, field: "variance" | "note", value: string) => void;
  note: { blocks: RuntimeNoteBlock[]; onAccept: (id: string) => void };
  wallData: WallData;
  collabBar: CollabBarProps | null;
  trace: TraceEntry[];
}): React.ReactElement {
  const { tab, onTab, sheet, onEditCell, note, wallData, collabBar, trace } = props;
  return (
    <div className="rt-panel artifact">
      <div className="rt-panel-head">
        <div className="rt-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className="rt-tab"
              data-active={String(tab === t.id)}
              onClick={() => onTab(t.id)}
            >
              {Ico(t.ic, { size: 13 })}{t.label}
            </button>
          ))}
        </div>
        <span className="grow" />
        <span className="rt-tag public">{Ico("users", { size: 11 })}Shared</span>
      </div>
      {collabBar && tab === "sheet" ? <CollabBar {...collabBar} /> : null}
      {tab === "sheet" ? <SheetView sheet={sheet} onEditCell={onEditCell} /> : null}
      {tab === "note"  ? <NoteView note={note} /> : null}
      {tab === "wall"  ? <WallView wallData={wallData} /> : null}
      <TraceStrip log={trace} />
    </div>
  );
}
