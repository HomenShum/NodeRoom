/**
 * ArtifactPanel — tabs + Shared tag · spreadsheet (CAS) · TipTap note
 * · dnd-kit wall · Room trace. Reads + writes through `useStore()`, so the same
 * component renders the in-memory engine OR live Convex (optimistic edits).
 */

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useEditor, EditorContent, EditorProvider } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PmDocNode } from "@tiptap/pm/model";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import "./artifact-receipts.css";
import "./notebook-paper.css";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import { NOTEBOOK_EXTENSIONS } from "../../notebook/extensions";
import { api } from "../../../convex/_generated/api";
import {
  Table2, FileText, StickyNote, Users, GitMerge, RotateCcw, History, Search, BookOpen, Home, ListChecks,
  Lock, Unlock, Ban, Pencil, Plus, Check, AlertTriangle, Eye, Circle, ChevronRight, ChevronDown, Download, Trash2, Undo2, X, Columns2, MoreHorizontal, Mail, Hash, Layers, Linkedin, Activity, Share2, Clock3, type LucideIcon,
  Sparkles, Folder, Briefcase, Package, File as FileIcon,
} from "lucide-react";
import { useStore, type ActorProof, type RoomStore, type EditFeedback, type PresenceClaim } from "../../app/store";
import { columnLetters } from "../../app/spreadsheetIndex";
import { onStageFocus, focusStage, type StageFocusTarget } from "../stageFocus";
import { TraceSurface } from "./TraceSurface";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { TodaysBrief } from "./TodaysBrief";
import { classifyEvidence } from "../traceLens/evidence";
import type { Actor, Artifact as Art, CellEvidence, CellPayload, DataframeColumn, DocumentParseMeta, Proposal, TraceEvent, ResearchRowInput } from "../../engine/types";
import { AttentionOverlay } from "../overlay/AttentionOverlay";
import { createSpreadsheetResolver } from "../overlay/spreadsheetResolver";
import { focusBoxesForSheet, type SheetCellState } from "../overlay/focusBoxesForSheet";
import { OPT_ARTIFACT_PREFIX, optimisticArtifactIdentity } from "../openRoomReference";
import { ladderFor, LADDER_MEMBER_CAP, type LadderResult } from "../presenceLadder";
import { prepareDownstreamDrafts, type PreparedDownstreamDraft } from "../../nodeagent/skills/integration/downstreamPublish";
import { isWorkbookPreviewDoc, workbookPreviewArtifactFromDataUrl } from "./workbookFilePreview";
import { isOfficePreviewDoc, officePreviewFromDataUrl, type OfficePreview } from "./officeFilePreview";
import { RoomHome } from "../room/RoomHome";

/** Downstream handoff destinations → compact icon + short label (replaces 5 wide ghost buttons). */
const HANDOFF_ICONS: Record<string, LucideIcon> = { gmail: Mail, notion: FileText, slack: Hash, linear: Layers, linkedin: Linkedin };
const HANDOFF_SHORT: Record<string, string> = { gmail: "Gmail", notion: "Notion", slack: "Slack", linear: "Linear", linkedin: "LinkedIn" };

const WIKI_TITLE = "Agent wiki";
const RESEARCH_TITLE = "Company research";
const BRIEF_TITLE = "Today's Brief";
const MAX_OPEN_TABS = 12; // BOUND: cap open work-surface tabs (agent loops can churn artifacts); evict oldest.
const MAX_VISIBLE_FILE_TABS = 4;
const GENERIC_SHEET_CELL_WINDOW = 5_000;
const SCALE_SHEET_RENDER_WINDOW = 23;
/** Fixed row height (px) the generic/scale sheet renders at default density — the single
 *  source of truth for scroll-driven windowing. Kept in lockstep with
 *  `.r-sheet[data-sheet-kind="generic"] td.r-cell { height: 44px }` in styles.css. */
export const SCALE_SHEET_ROW_PX = 44;
/** Rows rendered above/below the visible band so a fast scroll never flashes blank rows. */
export const SCALE_SHEET_OVERSCAN = 8;

export type RowWindow = {
  /** First row index rendered (inclusive, 0-based) — after overscan + clamping. */
  start: number;
  /** One past the last row index rendered (exclusive, 0-based). */
  end: number;
  /** Spacer height (px) standing in for the [0, start) rows that are NOT mounted. */
  topPad: number;
  /** Spacer height (px) standing in for the [end, totalRows) rows that are NOT mounted. */
  bottomPad: number;
  /** True when `focusedIndex` falls OUTSIDE [start, end) and must be pinned (mounted separately). */
  focusedPinned: boolean;
};

/**
 * computeRowWindow — pure scroll-driven windowing math for the generic/scale sheet.
 *
 * Given the scroll offset + viewport height (px), the total row count, and an optional
 * focused row index, returns the half-open render window [start, end) plus the top/bottom
 * spacer heights that keep the scrollbar honest for the un-mounted rows. The visible band is
 * [floor(scrollTop / ROW), ceil((scrollTop + viewport) / ROW)); we pad it by OVERSCAN rows on
 * each side and clamp to [0, totalRows]. A focused row outside the window is reported via
 * `focusedPinned` so the caller can keep it mounted (agent/QA focus must never scroll away).
 *
 * O(1): the result depends only on the four scalars, never on totalRows magnitude — 100k or
 * 100M rows cost the same. Pure + deterministic: same inputs → same window.
 */
export function computeRowWindow(
  scrollTop: number,
  viewportPx: number,
  totalRows: number,
  focusedIndex: number | null = null,
  rowPx: number = SCALE_SHEET_ROW_PX,
  overscan: number = SCALE_SHEET_OVERSCAN,
): RowWindow {
  const total = Math.max(0, Math.floor(totalRows));
  const row = rowPx > 0 ? rowPx : SCALE_SHEET_ROW_PX;
  // Guard against negative/NaN scroll (elastic overscroll, jsdom 0-height layout).
  const top = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const view = Number.isFinite(viewportPx) && viewportPx > 0 ? viewportPx : 0;
  const firstVisible = Math.floor(top / row);
  const lastVisible = Math.ceil((top + view) / row);
  const start = Math.max(0, Math.min(total, firstVisible - overscan));
  const end = Math.max(start, Math.min(total, lastVisible + overscan));
  const topPad = start * row;
  const bottomPad = Math.max(0, (total - end) * row);
  const focusedPinned =
    focusedIndex !== null && focusedIndex >= 0 && focusedIndex < total && (focusedIndex < start || focusedIndex >= end);
  return { start, end, topPad, bottomPad, focusedPinned };
}

const BLANK_SHEET_ROWS = 12;
const BLANK_SHEET_COLUMNS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
type TabId = "wiki" | "brief" | "sheet" | "research" | "note" | "wall";
type SheetStatusFilter = "any" | "complete" | "enriching" | "pending" | "needs_review" | "failed";
const SHEET_STATUS_FILTERS: SheetStatusFilter[] = ["any", "complete", "enriching", "pending", "needs_review", "failed"];
const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: "wiki", label: "Wiki", Icon: BookOpen },
  { id: "brief", label: "Brief", Icon: ListChecks },
  { id: "sheet", label: "Spreadsheet", Icon: Table2 },
  { id: "research", label: "Research", Icon: Search },
  { id: "note", label: "Note", Icon: FileText },
  { id: "wall", label: "Wall", Icon: StickyNote },
];
function ArtifactSurface({ roomId, me, proof, artId, onArt, style, surfaceKey = "primary", headerExtra, openIds, onCloseArtifact, onOpenChat }: {
  roomId: string; me: Actor; artId: string; onArt: (id: string) => void;
  proof?: ActorProof;
  style?: CSSProperties;
  surfaceKey?: "primary" | "secondary";
  headerExtra?: ReactNode;
  openIds?: string[];
  onCloseArtifact?: (id: string) => void;
  onOpenChat?: () => void;
}) {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  const selected = arts.find((a) => a.id === artId);
  const wiki = selected?.kind === "note" && selected.title === WIKI_TITLE ? selected : arts.find((a) => a.title === WIKI_TITLE);
  const brief = selected?.kind === "note" && selected.title === BRIEF_TITLE ? selected : arts.find((a) => a.title === BRIEF_TITLE);
  const research = selected?.title === RESEARCH_TITLE ? selected : arts.find((a) => a.title === RESEARCH_TITLE);
  const varianceSheet = arts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? arts.find((a) => a.kind === "sheet" && a.title !== RESEARCH_TITLE);
  const sheet = selected?.kind === "sheet" && selected.title !== RESEARCH_TITLE ? selected : varianceSheet;
  // A "plain" note is any note that is NOT the agent wiki or the brief (both render as their own doc tabs).
  const isPlainNote = (a: Art) => a.kind === "note" && a.title !== WIKI_TITLE && a.title !== BRIEF_TITLE;
  const note = selected && isPlainNote(selected) ? selected : arts.find(isPlainNote);
  const wall = selected?.kind === "wall" ? selected : arts.find((a) => a.kind === "wall");
  const artFor = (t: TabId) => (t === "wiki" ? wiki : t === "brief" ? brief : t === "sheet" ? sheet : t === "research" ? research : t === "note" ? note : wall);
  const fallbackTab: TabId = sheet ? "sheet" : wiki ? "wiki" : brief ? "brief" : research ? "research" : note ? "note" : wall ? "wall" : "sheet";
  const tabForArt = (id: string): TabId => {
    if (wiki?.id === id) return "wiki";
    if (brief?.id === id) return "brief";
    if (arts.some((a) => a.id === id && a.kind === "sheet" && a.title !== RESEARCH_TITLE)) return "sheet";
    if (research?.id === id) return "research";
    if (arts.some((a) => a.id === id && isPlainNote(a))) return "note";
    if (wall?.id === id) return "wall";
    return fallbackTab;
  };
  const [tab, setTab] = useState<TabId>(() => tabForArt(artId));
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const tabMenuRef = useRef<HTMLDetailsElement>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  // Home is a persistent pinned pseudo-tab (primary surface only) — like Trace, it overlays the
  // work surface with the Room Home command center (inventory + work lanes) without disturbing openIds.
  const [homeOpen, setHomeOpen] = useState(false);
  // Knowledge graph: a derived node-link view of how this room's artifacts reference each other.
  const [graphOpen, setGraphOpen] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  useEffect(() => { if (!editErr) return; const t = setTimeout(() => setEditErr(null), 4000); return () => clearTimeout(t); }, [editErr]);
  useEffect(() => { setTab(tabForArt(artId)); }, [artId, wiki?.id, sheet?.id, research?.id, note?.id, wall?.id, arts.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== "z") return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      e.preventDefault();
      void store.undoLastEdit(roomId, me).then((f) => { if (!f.ok) setEditErr(editErrorMsg(f)); });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [store, roomId, me]);
  // Stage focus: the Room Binder / Signal Tape can point this surface at a claimed range or a
  // referenced cell (operation-like, ephemeral; never a durable write). When a focus targets the
  // artifact this surface is showing, scroll the cell into view and pulse it; retry briefly while
  // the tab/grid settles after an open.
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [pendingFocus, setPendingFocus] = useState<StageFocusTarget | null>(null);
  useEffect(() => onStageFocus((target) => setPendingFocus(target)), []);
  useEffect(() => {
    if (!pendingFocus || pendingFocus.artifactId !== artId || !pendingFocus.elementId) return;
    const elementId = pendingFocus.elementId;
    const RING = "inset 0 0 0 2px var(--accent-primary), 0 0 0 3px var(--accent-tint)";
    const clear = () => { const c = surfaceRef.current?.querySelector<HTMLElement>(`[data-cell-key="${CSS.escape(elementId)}"]`); if (c) c.style.boxShadow = ""; };
    let raf = 0;
    let frame = 0;
    let revealedAt = -1;
    // Re-query + re-assert the ring each frame for ~1.6s. A sheet re-render (frequent during an active
    // agent run) can recreate the cell node and drop an imperative style, so we keep winning the last
    // write instead of setting it once. Give up if the cell never appears (wrong tab / artifact).
    const tick = () => {
      const cell = surfaceRef.current?.querySelector<HTMLElement>(`[data-cell-key="${CSS.escape(elementId)}"]`);
      if (cell) {
        if (revealedAt < 0) { cell.scrollIntoView({ block: "center", inline: "center" }); revealedAt = frame; }
        cell.style.boxShadow = RING;
        if (frame - revealedAt > 96) { cell.style.boxShadow = ""; setPendingFocus(null); return; }
      } else if (revealedAt < 0 && frame > 30) {
        setPendingFocus(null);
        return;
      }
      frame++;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clear(); };
  }, [pendingFocus, artId, tab]);
  if (arts.length === 0) return <div className="r-panel artifact nr-panel nr-panel--artifact nr-panel--work"><div className="r-art-body" /></div>;
  // Fall back to the SELECTED artifact's tab (artId is the source of truth), never the generic
  // 'sheet'/variance default — otherwise the array-identity churn on an edit can momentarily snap a
  // non-default sheet (e.g. an uploaded .xlsx) back to the variance tab.
  const activeTab: TabId = tabForArt(artId);
  const tabIcon = (a: Art) => {
    const I = a.title === WIKI_TITLE ? BookOpen : a.title === RESEARCH_TITLE ? Table2 : a.kind === "sheet" ? Table2 : a.kind === "note" ? FileText : StickyNote;
    return <I size={13} />;
  };
  const openTabArts = (openIds ?? []).map((id) => arts.find((a) => a.id === id)).filter((a): a is Art => !!a);
  let visibleOpenTabArts = openTabArts;
  let overflowTabArts: Art[] = [];
  if (openIds && surfaceKey !== "secondary" && openTabArts.length > MAX_VISIBLE_FILE_TABS) {
    const pinned = openTabArts.slice(0, MAX_VISIBLE_FILE_TABS);
    const activeOpen = openTabArts.find((a) => a.id === artId);
    visibleOpenTabArts = activeOpen && !pinned.some((a) => a.id === activeOpen.id)
      ? [...pinned.slice(0, MAX_VISIBLE_FILE_TABS - 1), activeOpen]
      : pinned;
    const visibleIds = new Set(visibleOpenTabArts.map((a) => a.id));
    overflowTabArts = openTabArts.filter((a) => !visibleIds.has(a.id));
  }
  const overflowActive = !traceOpen && !homeOpen && !graphOpen && overflowTabArts.some((a) => a.id === artId);
  // Inline rename (double-click / F2) — replaces the window.prompt modal, honoring the same
  // inline-not-modal standard we hold cells to. Enter commits, Esc cancels; auto-saves via setArtifactMeta.
  const renameArtifact = (a: Art) => setRenamingId(a.id);
  const commitRename = (a: Art, value: string) => {
    setRenamingId(null);
    const t = value.trim();
    if (t && t !== a.title) void store.setArtifactMeta({ roomId, artifactId: a.id, title: t, actor: me });
  };
  const pick = (t: TabId) => { const a = artFor(t); if (a) { onArt(a.id); setTab(t); } };
  const openArtifact = (a: Art) => { onArt(a.id); setTab(tabForArt(a.id)); };
  // A Trace step / evidence card opens its literal source on the work surface (switch + pulse the cell).
  const openTraceSource = (artifactId: string, elementId?: string) => { onArt(artifactId); focusStage({ artifactId, elementId }); setTraceOpen(false); };
  const visibility = selected?.visibility ?? "room";
  // Two-way owner-gated visibility: you can share YOUR sheet to the room or pull it back to private.
  const ownsSelected = !!selected?.createdBy && ((selected.createdBy as Actor).id === me.id || (selected.createdBy as Actor).ownerId === me.id);
  const canToggleVis = ownsSelected && (visibility === "private" || visibility === "room");
  const toggleVisibility = () => {
    if (!selected) return;
    const next = visibility === "private" ? "room" : "private";
    if (next === "private" && typeof window !== "undefined" && !window.confirm("Make this sheet private to you? Teammates will no longer see it in the room.")) return;
    void store.setArtifactVisibility({ roomId, artifactId: selected.id, visibility: next, actor: me });
  };

  return (
    <div className="r-panel artifact nr-panel nr-panel--artifact nr-panel--work" ref={surfaceRef} style={style} data-testid={surfaceKey === "secondary" ? "artifact-panel-secondary" : "artifact-panel"}>
      <div className="r-panel-head">
        <div className="r-tabs fx-tabs" data-testid={surfaceKey === "secondary" ? "artifact-tabs-secondary" : "artifact-tabs"}>
          {/* Home is a pinned, non-closeable pseudo-tab: the room command center is always one click away. */}
          {surfaceKey !== "secondary" && (
            <button type="button" className="r-tab fx-tab r-hometab" data-active={String(homeOpen)} data-testid="home-tab" title="Room Home — command center, inventory, and work lanes" onClick={() => { setHomeOpen(true); setTraceOpen(false); setGraphOpen(false); }}>
              <Home size={13} /> Home
            </button>
          )}
          {openIds
            ? visibleOpenTabArts.map((a) => (
                <button key={a.id} className="r-tab fx-tab r-filetab" data-active={String(!traceOpen && !homeOpen && !graphOpen && a.id === artId)} onClick={() => { onArt(a.id); setTraceOpen(false); setHomeOpen(false); setGraphOpen(false); }} onDoubleClick={() => renameArtifact(a)} title={a.meta?.summary ? `${a.title} — ${a.meta.summary}` : `${a.title} (double-click to rename)`} data-testid="artifact-filetab">
                  {tabIcon(a)}
                  {renamingId === a.id ? (
                    <input className="r-filetab-rename" defaultValue={a.title} autoFocus aria-label="Rename file"
                      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
                      onBlur={(e) => commitRename(a, e.currentTarget.value)}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.preventDefault(); e.currentTarget.value = a.title; e.currentTarget.blur(); } }} />
                  ) : (
                    <span className="r-filetab-name">{artifactTabDisplay(a).title}</span>
                  )}
                  {artifactTabDisplay(a).badge && <span className="r-file-ext r-filetab-ext">{artifactTabDisplay(a).badge}</span>}
                  {onCloseArtifact && openTabArts.length > 1 && (
                    <span className="r-filetab-x" role="button" aria-label={`Close ${a.title}`} onClick={(e) => { e.stopPropagation(); onCloseArtifact(a.id); }}><X size={12} /></span>
                  )}
                </button>
              ))
            : TABS.filter((t) => artFor(t.id)).map((t) => (
                <button key={t.id} className="r-tab fx-tab" data-active={String(!traceOpen && !homeOpen && !graphOpen && activeTab === t.id)} onClick={() => { pick(t.id); setTraceOpen(false); setHomeOpen(false); setGraphOpen(false); }}>
                  <t.Icon size={13} /> {t.label}
                </button>
              ))}
          {openIds && openTabArts.length > 1 && (
            <details className="r-tab-overflow sc-tabmore" ref={tabMenuRef}>
              <summary className="r-tab fx-tab r-tab-overflow-btn" data-active={String(overflowActive)} aria-label="All open tabs" title="All open tabs">
                {overflowTabArts.length > 0 ? `+${overflowTabArts.length}` : <MoreHorizontal size={14} />}
              </summary>
              <div className="r-tab-overflow-menu" role="menu">
                {openTabArts.map((a) => (
                  <button key={a.id} type="button" role="menuitem" className="r-tab-overflow-item" data-active={String(!traceOpen && !homeOpen && !graphOpen && a.id === artId)} onClick={() => { onArt(a.id); setTraceOpen(false); setHomeOpen(false); setGraphOpen(false); tabMenuRef.current?.removeAttribute("open"); }}>{tabIcon(a)} <span>{a.title}</span></button>
                ))}
              </div>
            </details>
          )}
          {/* Trace is a pinned work-surface tab alongside the artifacts (agent + QA provenance). */}
          {surfaceKey !== "secondary" && (
            <button type="button" className="r-tab fx-tab r-tracetab" data-active={String(traceOpen)} data-testid="trace-tab" title="Agent + QA trace records" onClick={() => { setTraceOpen(true); setHomeOpen(false); setGraphOpen(false); }}>
              <Activity size={13} /> Run trace
            </button>
          )}
          {surfaceKey !== "secondary" && (
            <button type="button" className="r-tab fx-tab r-graphtab" data-active={String(graphOpen)} data-testid="graph-tab" title="Knowledge graph — how this room's artifacts reference each other" onClick={() => { setGraphOpen(true); setHomeOpen(false); setTraceOpen(false); }}>
              <Share2 size={13} /> Entity graph
            </button>
          )}
        </div>
        <span className="grow" />
        {headerExtra}
        {activeTab === "sheet" && sheet && (
          <button
            type="button"
            className="r-btn ghost r-artifact-export"
            aria-label="Export workbook to XLSX"
            title="Download this sheet as an .xlsx workbook"
            data-testid="artifact-export-xlsx"
            onClick={() => { void exportSheetAsXlsx(sheet, surfaceRef.current, arts); }}
          >
            <Download size={11} />
            Export XLSX
          </button>
        )}
        {canToggleVis ? (
          <button
            type="button"
            className={`r-tag fx-shared r-tag-toggle ${visibility === "private" ? "private" : "public"}`}
            onClick={toggleVisibility}
            title={visibility === "private" ? "Share this sheet with the room" : "Make this sheet private to you"}
            data-testid="artifact-visibility-toggle"
          >
            {visibility === "private" ? <Lock size={11} /> : <Users size={11} />}
            {visibility === "private" ? "Private" : "Shared"}
          </button>
        ) : (
          <span className={`r-tag fx-shared ${visibility === "private" ? "private" : "public"}`}>
            {visibility === "private" ? <Lock size={11} /> : <Users size={11} />}
            {visibility === "private" ? "Private" : visibility === "public" ? "Public" : "Shared"}
          </span>
        )}
      </div>

      {homeOpen ? (
        <RoomHomeSurface
          roomId={roomId}
          me={me}
          embedded
          onOpenChat={onOpenChat}
          artifacts={arts.map((a) => ({ id: a.id, title: a.title, kind: a.kind, updatedAt: a.updatedAt, owner: a.createdBy?.name, visibility: a.visibility }))}
          onOpenArtifact={(id) => { onArt(id); setHomeOpen(false); }}
        />
      ) : traceOpen ? (
        <TraceSurface roomId={roomId} onOpenSource={openTraceSource} />
      ) : graphOpen ? (
        <KnowledgeGraph roomId={roomId} onOpenArtifact={(id) => { onArt(id); setGraphOpen(false); }} />
      ) : (
        <>
          {editErr && <div className="r-art-error" role="alert"><AlertTriangle size={13} /> {editErr}</div>}
          {activeTab === "wiki" && wiki && <Wiki roomId={roomId} art={wiki} onOpenArtifact={openArtifact} />}
          {activeTab === "brief" && brief && <TodaysBrief roomId={roomId} onOpenArtifact={openArtifact} />}
          {activeTab === "sheet" && sheet && (sheet.title === "Q3 variance"
            ? <Sheet roomId={roomId} me={me} art={sheet} proof={proof} onError={(f) => setEditErr(editErrorMsg(f))} />
            : <GenericSheet roomId={roomId} me={me} art={sheet} proof={proof} onError={(f) => setEditErr(editErrorMsg(f))} />)}
          {/* Research = an empty NAMED-COLUMN grid the agent populates (matches the prototype's structured
              grid, not a raw A1 sheet). Rendered by GenericSheet — no separate <Research> renderer. */}
          {activeTab === "research" && research && <GenericSheet roomId={roomId} me={me} art={research} proof={proof} onError={(f) => setEditErr(editErrorMsg(f))} />}
          {activeTab === "note" && note && (NOTEBOOK_SYNC_ENABLED && proof ? <SyncedNote roomId={roomId} me={me} proof={proof} art={note} /> : <Note roomId={roomId} me={me} proof={proof} art={note} />)}
          {activeTab === "wall" && wall && <Wall roomId={roomId} me={me} art={wall} onOpenArtifact={onArt} />}
        </>
      )}

      {!traceOpen && !graphOpen && activeTab !== "note" && (
        <TraceStrip
          roomId={roomId}
          me={me}
          onOpenGraph={() => { setGraphOpen(true); setHomeOpen(false); setTraceOpen(false); }}
        />
      )}
    </div>
  );
}

/**
 * Artifact — the center Work Surface. Wraps one or two ArtifactSurface panes so the
 * stage can show a primary surface (e.g. the Q3 model) beside a secondary reference
 * surface (a proof, source doc, or the wiki) WITHOUT leaving the center stage — the
 * "split mode" gap from docs/synthesis/specs/A_UI_SHELL.md (TARGET_2026_06 L197).
 * RoomShell's prop contract is unchanged; split state is local and defaults off.
 */
function makeBlankRoomCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join("").toUpperCase();
}

/**
 * RoomHomeSurface — wraps RoomHome with the add-sheet and load-sample actions.
 * Serves two roles: the blank-room landing (0 artifacts) AND the pinned Home tab in a
 * populated room (embedded, with the real artifact inventory). Replaces the old BlankRoomState.
 */
function RoomHomeSurface({ roomId, me, style, onOpenChat, embedded, artifacts, onOpenArtifact }: { roomId: string; me: Actor; style?: CSSProperties; onOpenChat?: () => void; embedded?: boolean; artifacts?: { id: string; title: string; kind: string }[]; onOpenArtifact?: (id: string) => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const addSheet = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const columns: DataframeColumn[] = BLANK_SHEET_COLUMNS.map((label, order) => ({ id: label, label, order, mode: "manual", type: "text", agentWritable: true }));
      const seed: Array<{ id: string; value: unknown }> = [];
      for (let r = 1; r <= BLANK_SHEET_ROWS; r++) for (const c of BLANK_SHEET_COLUMNS) seed.push({ id: `r${r}__${c}`, value: "" });
      await store.uploadArtifact({ roomId, actor: me, artifact: { kind: "sheet", title: "Sheet 1", seed, meta: { dataframe: { columns, rowCount: BLANK_SHEET_ROWS, sourceFile: "blank-room", parser: "blank_seed", truncated: false, warnings: [] } } } });
    } catch { /* the store surfaces failures; keep the blank state usable */ }
    finally { setBusy(false); }
  };
  const loadSample = () => {
    const url = new URL(window.location.origin + "/");
    url.searchParams.set("demo", makeBlankRoomCode());
    url.searchParams.set("name", me.name || "Host");
    window.location.href = url.toString();
  };
  return (
    <RoomHome
      roomId={roomId}
      me={me}
      style={style}
      onOpenChat={onOpenChat}
      onAddSheet={() => void addSheet()}
      onLoadSample={loadSample}
      embedded={embedded}
      artifacts={artifacts}
      onOpenArtifact={onOpenArtifact}
    />
  );
}

export function Artifact(props: {
  roomId: string; me: Actor; proof?: ActorProof; artId: string; onArt: (id: string) => void;
  sideArtId?: string | null;
  onSideArtChange?: (id: string | null) => void;
  onOpenChat?: () => void;
  style?: CSSProperties;
}) {
  const { roomId, me, proof, artId, onArt, sideArtId, onSideArtChange, onOpenChat, style } = props;
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  useEffect(() => {
    const optimistic = optimisticArtifactIdentity(artId);
    if (!optimistic) return;
    const active = arts.find((a) => a.id === artId);
    const targetTitle = active?.title ?? optimistic.title;
    const targetKind = active?.kind ?? optimistic.kind;
    const real = arts.find((a) => !a.id.startsWith(OPT_ARTIFACT_PREFIX) && a.kind === targetKind && a.title === targetTitle);
    if (real) onArt(real.id);
  }, [artId, arts, onArt]);
  const [localSplitId, setLocalSplitId] = useState<string | null>(null);
  const splitId = sideArtId === undefined ? localSplitId : sideArtId;
  const setSplitId = onSideArtChange ?? setLocalSplitId;
  // Browser-style open files: the work surface holds a tab per OPEN artifact (multiple sheets each get
  // their own tab), not one slot per kind. Activating an artifact opens its tab; closing removes it.
  const defaultOpenIds = ((): string[] => {
    const ids: string[] = [];
    const push = (a?: Art) => { if (a && !ids.includes(a.id)) ids.push(a.id); };
    push(arts.find((a) => a.kind === "sheet" && a.title !== RESEARCH_TITLE));
    push(arts.find((a) => a.title === RESEARCH_TITLE));
    push(arts.find((a) => a.kind === "note" && a.title !== WIKI_TITLE));
    push(arts.find((a) => a.kind === "wall"));
    push(arts.find((a) => a.title === WIKI_TITLE));
    return ids;
  })();
  const [openIds, setOpenIds] = useState<string[]>(() => (artId && !defaultOpenIds.includes(artId) ? [artId, ...defaultOpenIds] : defaultOpenIds));
  useEffect(() => {
    if (!artId) return;
    setOpenIds((prev) => {
      if (prev.includes(artId)) return prev;
      const next = [...prev, artId];
      // BOUND: the active artifact is appended last, so slicing to the last MAX keeps it + evicts the oldest.
      return next.length > MAX_OPEN_TABS ? next.slice(next.length - MAX_OPEN_TABS) : next;
    });
  }, [artId]);
  // Always include the active artifact (a freshly created/uploaded file is active before the effect
  // appends it), then keep only artifacts that still exist. Guarantees the active file owns a tab.
  const liveOpenIds = [...new Set([...openIds, artId].filter(Boolean))].filter((id) => arts.some((a) => a.id === id));
  const closeArtifact = (id: string) => {
    setOpenIds((prev) => {
      const next = prev.filter((x) => x !== id);
      if (id === artId && next.length) { const idx = prev.indexOf(id); onArt(next[Math.min(idx, next.length - 1)]); }
      return next;
    });
    if (id === splitId) setSplitId(null);
  };
  // Split is a desktop affordance: below ~1200px the stage is too narrow for two usable panes,
  // and on compact the side panels are overlays — so the control hides and any open split
  // auto-collapses. Mirrors the canonical "<900 = single primary surface" responsive band.
  const [wideEnough, setWideEnough] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(min-width: 1200px)").matches : true);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(min-width: 1200px)");
    const onChange = () => setWideEnough(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  // A blank room (0 artifacts) is intentional (Loop 1) — show the Room Home command center.
  if (arts.length === 0) return <RoomHomeSurface roomId={roomId} me={me} style={style} onOpenChat={onOpenChat} />;
  const canSplit = wideEnough && arts.length >= 4;
  // Keep the split target valid: collapse if it vanished, folded back onto the primary, or the
  // viewport became too narrow.
  const splitting = canSplit && !!splitId && splitId !== artId && arts.some((a) => a.id === splitId);
  const openSplit = () => {
    const candidate =
      arts.find((a) => a.id !== artId && a.title === WIKI_TITLE) ??
      arts.find((a) => a.id !== artId);
    if (candidate) setSplitId(candidate.id);
  };
  const splitToggle = (
    <button
      className="r-iconbtn"
      type="button"
      data-testid="artifact-split-toggle"
      aria-pressed={splitting}
      disabled={!canSplit}
      title={splitting ? "Close split view" : "Split the work surface"}
      aria-label={splitting ? "Close split view" : "Split the work surface"}
      style={canSplit ? undefined : { opacity: 0.4, cursor: "not-allowed" }}
      onClick={() => (splitting ? setSplitId(null) : openSplit())}
    >
      <Columns2 size={14} />
    </button>
  );
  const closeSplit = (
    <button
      className="r-iconbtn"
      type="button"
      data-testid="artifact-split-close"
      title="Close split view"
      aria-label="Close split view"
      onClick={() => setSplitId(null)}
    >
      <X size={14} />
    </button>
  );
  return (
    <div
      data-testid="work-surface"
      data-split={String(splitting)}
      style={{ ...style, display: "flex", minWidth: 0, minHeight: 0, gap: splitting ? 10 : 0 }}
    >
      <ArtifactSurface
        roomId={roomId}
        me={me}
        proof={proof}
        artId={artId}
        onArt={onArt}
        onOpenChat={onOpenChat}
        surfaceKey="primary"
        headerExtra={canSplit ? splitToggle : undefined}
        openIds={liveOpenIds}
        onCloseArtifact={closeArtifact}
        style={{ flex: 1, minWidth: 0 }}
      />
      {splitting && splitId && (
        <ArtifactSurface
          roomId={roomId}
          me={me}
          proof={proof}
          artId={splitId}
          onArt={(id) => setSplitId(id)}
          surfaceKey="secondary"
          headerExtra={closeSplit}
          style={{ flex: 1, minWidth: 0 }}
        />
      )}
    </div>
  );
}

/* ── agent-managed room wiki: live TOC + current room state ── */
function Wiki({ roomId, art, onOpenArtifact }: { roomId: string; art: Art; onOpenArtifact: (art: Art) => void }) {
  const store = useStore();
  const artifacts = store.listArtifacts(roomId);
  const members = store.listMembers(roomId);
  const sessions = store.listSessions(roomId);
  const traces = store.listTraces(roomId).slice(-8).reverse();
  const run = store.lastRun();
  const toc = [
    ["wiki-overview", "Overview"],
    ["wiki-files", "Files"],
    ["wiki-agents", "Agents"],
    ["wiki-workflows", "Workflows"],
    ["wiki-rules", "Rules"],
    ["wiki-backend", "Backend"],
    ["wiki-trace", "Recent trace"],
  ] as const;
  const summary = String(art.elements.doc?.value ?? "Room state, collaboration policy, and agent evidence.");
  return (
    <div className="r-art-body r-wiki-body">
      <aside className="r-wiki-toc" aria-label="Wiki table of contents">
        <div className="kicker">On this page</div>
        {toc.map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}
      </aside>
      <article className="r-wiki-doc">
        <section id="wiki-overview">
          <p className="kicker">Agent-managed wiki</p>
          <h1>NodeRoom system of record</h1>
          <p>{summary}</p>
          <div className="r-wiki-metrics" aria-label="Room state">
            <span><b>{artifacts.length}</b> files</span>
            <span><b>{members.length}</b> people</span>
            <span><b>{sessions.length}</b> agents</span>
            <span><b>{store.listTraces(roomId).length}</b> trace events</span>
          </div>
        </section>

        <section id="wiki-files">
          <h2>Files</h2>
          <div className="r-wiki-files">
            {artifacts.map((a) => (
              <button key={a.id} className="r-wiki-file" data-current={String(a.id === art.id)} onClick={() => onOpenArtifact(a)}>
                <span className="r-wiki-file-title">{a.title}</span>
                <span className="r-wiki-file-meta">{artifactWikiMeta(a)}</span>
              </button>
            ))}
          </div>
        </section>

        <section id="wiki-agents">
          <h2>Agents</h2>
          <div className="r-wiki-list">
            {sessions.map((s) => (
              <div key={s.id} className="r-wiki-list-row">
                <span>{s.agentName}</span>
                <code>{s.scope}</code>
                <span>{s.status}</span>
                <span className="faint">{s.lastAction}</span>
              </div>
            ))}
          </div>
        </section>

        <section id="wiki-workflows">
          <h2>Workflows</h2>
          <ol className="r-wiki-steps">
            <li><b>Variance collaboration:</b> lock the affected spreadsheet range, read current context, edit with CAS, release, then smart-merge pending drafts.</li>
            <li><b>ParselyFi research:</b> add or requeue accounts, enrich only pending rows, write sources and freshness, export CRM-ready fields.</li>
            <li><b>Sales GTM:</b> preserve tier, intent, owner, CRM status, summary, signal, and citations per account row.</li>
          </ol>
        </section>

        <section id="wiki-rules">
          <h2>Rules</h2>
          <ol className="r-wiki-steps">
            <li><b>Ground claims:</b> summarize only artifacts, traces, runs, sessions, messages, and cited research sources already present in the room.</li>
            <li><b>Keep private data private:</b> never expose private channel content or private drafts in the shared wiki unless a user promotes it.</li>
            <li><b>Preserve workflow fields:</b> keep finance rows, GTM account fields, citations, freshness, owners, and CRM status visible as first-class wiki facts.</li>
            <li><b>Update after state changes:</b> refresh file inventory, active agents, workflow state, and recent trace evidence after uploads, research runs, approvals, and merges.</li>
          </ol>
        </section>

        <section id="wiki-backend">
          <h2>Backend</h2>
          <div className="r-wiki-list">
            <div className="r-wiki-list-row"><span>UI</span><code>src/ui</code><span>renders artifacts, chat, trace, and wiki</span></div>
            <div className="r-wiki-list-row"><span>Store</span><code>src/app/store.tsx</code><span>switches between memory and Convex</span></div>
            <div className="r-wiki-list-row"><span>Engine</span><code>src/engine</code><span>CAS, locks, drafts, smart-merge, traces</span></div>
            <div className="r-wiki-list-row"><span>Agent</span><code>src/nodeagent</code><span>runtime, tools, model seam, compaction</span></div>
            <div className="r-wiki-list-row"><span>Live</span><code>convex</code><span>schema, mutations, optimistic queries, server agent action</span></div>
          </div>
          {run && <p className="r-wiki-run"><code>{run.model}</code> last run: {run.toolCalls} tool calls, {run.steps} steps, ${run.costUsd.toFixed(3)}, {run.ms}ms.</p>}
        </section>

        <section id="wiki-trace">
          <h2>Recent trace</h2>
          <div className="r-wiki-timeline">
            {traces.length === 0 ? <span className="faint">No trace events yet.</span> : traces.map((t) => (
              <div key={t.id} className="r-wiki-timeline-row">
                <time>{new Date(t.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                <span>{t.summary}</span>
              </div>
            ))}
          </div>
        </section>
      </article>
    </div>
  );
}

function artifactWikiMeta(art: Art): string {
  if (art.title === WIKI_TITLE) return `live TOC; v${art.version}`;
  if (art.kind === "sheet" && art.meta?.excelGrid) return `${art.meta.excelGrid.rows} x ${art.meta.excelGrid.columns}; v${art.version}`;
  if (art.kind === "sheet") return `${rowIdsOf(art).length} rows; v${art.version}`;
  if (art.kind === "wall") return `${Object.keys(art.elements ?? {}).length} notes; v${art.version}`;
  return `doc; v${art.version}`;
}

/* ── company-research surface (ParselyFi loop): status-gated, sourced enrichment ── */
// Attio/Clay-style record identity: a deterministic colored initials avatar per company
// (offline-safe -- no live logo fetch). Color is hashed from the name so it's stable across renders.
const CO_COLORS = ["#315DA8", "#2F6B44", "#6D3FB2", "#80631F", "#A34B2E", "#1F6F78", "#8F3F27", "#7A3FA0"];
const CO_COLOR_BY_NAME: Record<string, string> = {
  homen: "#E87958",
  maya: "#8B6CE5",
  priya: "#6474D9",
  sam: "#4C8FBD",
};
function coColor(name: string): string {
  const direct = CO_COLOR_BY_NAME[name.trim().toLowerCase()];
  if (direct) return direct;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CO_COLORS[h % CO_COLORS.length];
}
function coInitials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function Research({ roomId, me, art }: { roomId: string; me: Actor; art: Art }) {
  const store = useStore();
  const [running, setRunning] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [requeueError, setRequeueError] = useState<string | null>(null); // C7/C2: honest surface for failed requeue commits
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pages, setPages] = useState(1); // QA P1: page the grid like GenericSheet — no unbounded DOM
  const [handoffStatus, setHandoffStatus] = useState<string | null>(null);
  const RESEARCH_PAGE_SIZE = 50;
  const rowIds = [...new Set(art.order.map((e) => e.split("__")[0]))];
  const visibleRowIds = rowIds.slice(0, RESEARCH_PAGE_SIZE * pages);
  const cell = (rid: string, c: string) => displayCellValue(art.elements[`${rid}__${c}`]?.value);
  const pending = rowIds.filter((rid) => (cell(rid, "status") || "pending") === "pending").length;
  const complete = rowIds.filter((rid) => cell(rid, "status") === "complete").length;
  const run = async () => { setRunning(true); try { await store.askResearch(); } finally { setRunning(false); } };
  const addRows = async () => {
    const rows = parseResearchRows(pasteText);
    if (!rows.length) return;
    setBusy(true); setPasteError(null);
    try {
      const added = await store.addResearchRows({ roomId, artifactId: art.id, rows, actor: me });
      if (added) { setPasteText(""); setPasteOpen(false); }
    } catch (e) {
      // Keep the panel open with the typed text so a retry does not re-paste and double-insert.
      setPasteError("Couldn't add rows — " + (e instanceof Error ? e.message : "try again") + ". Your text is preserved.");
    } finally { setBusy(false); }
  };
  const refreshComplete = async () => {
    setBusy(true); setRequeueError(null);
    let failed = 0; let lastReason: string | undefined;
    try {
      for (const rid of rowIds.filter((id) => cell(id, "status") === "complete")) {
        const f = await commit(store, roomId, me, art.id, `${rid}__status`, "pending");
        if (f && !f.ok) { failed += 1; lastReason = f.reason; }
      }
    } finally {
      // C7/C2: commit() returns {ok:false} as DATA (locked/conflict), never throws — so a partial
      // requeue must be surfaced, not silently dropped while the rows stay 'complete'.
      if (failed) setRequeueError(`${failed} row(s) couldn't be requeued — ${editErrorMsg({ ok: false, reason: lastReason })}`);
      setBusy(false);
    }
  };
  const srcLink = (src: string) => {
    const u = src.match(/https?:\/\/[^\s]+/)?.[0];
    return u ? <a href={u} target="_blank" rel="noreferrer">{src}</a> : <span>{src}</span>;
  };
  const srcChip = (src: string) => {
    const u = src.match(/https?:\/\/[^\s]+/)?.[0];
    let host = src.slice(0, 16);
    if (u) { try { host = new URL(u).hostname.replace(/^www\./, ""); } catch { /* keep slice */ } }
    const inner = <><span className="r-srcchip-dot" aria-hidden="true" style={{ background: coColor(host) }} />{host}</>;
    return u
      ? <a key={u} className="r-srcchip" href={u} target="_blank" rel="noreferrer" title={src}>{inner}</a>
      : <span key={src} className="r-srcchip" title={src}>{inner}</span>;
  };
  const saveDownstreamDraft = (draft: PreparedDownstreamDraft) => {
    const blob = new Blob([`# ${draft.title}\n\n${draft.body}\n`], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${draft.target}-${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "draft"}.md`;
    a.click();
    URL.revokeObjectURL(url);
    setHandoffStatus(`${HANDOFF_SHORT[draft.target] ?? draft.target} draft prepared for review`);
  };
  const activeDraftRowId = expanded ?? rowIds.find((rid) => cell(rid, "status") === "complete") ?? null;
  const activeDraftCompany = activeDraftRowId ? cell(activeDraftRowId, "company") || activeDraftRowId : null;
  const downstreamDrafts = activeDraftRowId
    ? prepareDownstreamDrafts({
      title: `${activeDraftCompany || activeDraftRowId} diligence`,
      summary: cell(activeDraftRowId, "summary") || `${activeDraftCompany || activeDraftRowId} is ready for downstream follow-up.`,
      bullets: [cell(activeDraftRowId, "funding"), cell(activeDraftRowId, "headcount"), cell(activeDraftRowId, "recent_signal")].filter(Boolean),
      artifactUrl: typeof window !== "undefined" ? `${window.location.href.split("#")[0]}#artifact=${art.id}&row=${activeDraftRowId}` : undefined,
    })
    : [];
  return (
    <div className="r-art-body r-research-body">
      <div className="r-research-bar">
        <span className="tiny faint">{rowIds.length} accounts · {pending} pending · {complete} complete · multi-source research</span>
        <span className="grow" />
        <button className="r-btn ghost" disabled={busy} onClick={() => setPasteOpen((v) => !v)}><Plus size={13} /> Import accounts</button>
        <button className="r-btn ghost" aria-label="More research actions" aria-expanded={moreOpen} title="Requeue complete, export CRM CSV" onClick={() => setMoreOpen((v) => !v)}><MoreHorizontal size={14} /></button>
        {moreOpen && (
          <>
            <button className="r-btn ghost" disabled={busy || complete === 0} onClick={() => void refreshComplete()}><RotateCcw size={13} /> Requeue complete</button>
            <button className="r-btn ghost" onClick={() => downloadResearchCsv(art, rowIds, cell)}><Download size={13} /> CRM CSV</button>
          </>
        )}
        <button className="r-btn" data-testid="research-enrich" disabled={running || pending === 0} onClick={run}>{running ? "Researching..." : pending ? `Enrich ${pending} pending` : "All complete"}</button>
        {requeueError && <span className="r-wall-error" role="alert" data-testid="research-requeue-error">{requeueError}</span>}
      </div>
      {downstreamDrafts.length > 0 && (
        <div className="r-handoff-bar" data-testid="research-handoff">
          <span className="r-handoff-label" title="Draft only — downloads a draft for you to review and send yourself. Nothing is sent automatically.">Export <b>{activeDraftCompany}</b> draft</span>
          <span className="grow" />
          <div className="r-handoff-targets">
            {downstreamDrafts.map((draft) => {
              const Icon = HANDOFF_ICONS[draft.target] ?? Download;
              return (
                <button key={draft.target} className="r-handoff-chip" data-testid={`downstream-${draft.target}`} onClick={() => saveDownstreamDraft(draft)} title={draft.ctaLabel}>
                  <Icon size={13} /> <span>{HANDOFF_SHORT[draft.target] ?? draft.target}</span>
                </button>
              );
            })}
          </div>
          {handoffStatus && <span className="r-handoff-status" data-testid="downstream-status">{handoffStatus}</span>}
        </div>
      )}
      {pasteOpen && (
        <div className="r-research-import">
          <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={3} placeholder="Company, website, tier, intent, owner, CRM status" />
          {/* Never disable the submit by default — a dead button can't explain itself. Empty paste
              gets an inline explanation through the same error channel (form-layout convention). */}
          <button className="r-btn primary" disabled={busy} onClick={() => { if (parseResearchRows(pasteText).length === 0) { setPasteError("Nothing to import yet — paste one account per line: Company, website, tier, intent, owner, CRM status."); return; } void addRows(); }}>{busy ? "Importing..." : "Import / update rows"}</button>
          {pasteError && <span className="r-wall-error" role="alert" data-testid="research-add-error">{pasteError}</span>}
        </div>
      )}
      <div className="r-research-scroll">
        <table className="r-research" data-noderoom-surface="workSurface.research" data-artifact-id={art.id}>
          <colgroup>
            <col style={{ width: 148 }} /><col style={{ width: 92 }} /><col style={{ width: 150 }} />
            <col style={{ width: 248 }} /><col style={{ width: 188 }} /><col style={{ width: 150 }} /><col style={{ width: 96 }} />
          </colgroup>
          <thead><tr>
            <th className="frozen">Account</th><th>Status</th><th>GTM</th><th>Research</th><th>Signals</th><th>Sources</th><th>Freshness</th>
          </tr></thead>
          <tbody>
            {visibleRowIds.map((rid) => {
              const status = cell(rid, "status") || "pending";
              const src = cell(rid, "source"), src2 = cell(rid, "source2"), last = cell(rid, "last_researched");
              const gtm = `${cell(rid, "tier") || "B"} · ${cell(rid, "intent") || "research"}`;
              const gtmFull = `${gtm} · ${cell(rid, "owner") || me.name} · ${cell(rid, "crm_status") || "Research"}`;
              const signals = [cell(rid, "funding"), cell(rid, "headcount"), cell(rid, "recent_signal")].filter(Boolean).join(" · ");
              const open = expanded === rid;
              // QA P2 perf: only the expanded row renders its 12-entry detail — don't build it per-row per-render.
              const detail: Array<[string, ReactNode]> = open ? [
                ["Website", cell(rid, "website") || "—"],
                ["Tier", cell(rid, "tier") || "—"], ["Intent", cell(rid, "intent") || "—"],
                ["Owner", cell(rid, "owner") || me.name], ["CRM status", cell(rid, "crm_status") || "—"],
                ["Summary", cell(rid, "summary") || "—"],
                ["Funding", cell(rid, "funding") || "—"], ["Headcount", cell(rid, "headcount") || "—"],
                ["Recent signal", cell(rid, "recent_signal") || "—"],
                ["Source", src ? srcLink(src) : "—"], ["Source 2", src2 ? srcLink(src2) : "—"],
                ["Last researched", last || "never"],
              ] : [];
              return (
                <Fragment key={rid}>
                  <tr className="r-research-row" data-open={String(open)} aria-selected={open} aria-expanded={open} tabIndex={0}
                    onClick={() => setExpanded(open ? null : rid)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded(open ? null : rid); } }}>
                    <td className="r-research-co frozen" title={cell(rid, "company")}>
                      <span className="r-co">
                        <span className="r-co-av" aria-hidden="true" style={{ background: coColor(cell(rid, "company") || rid) }}>{coInitials(cell(rid, "company") || rid)}</span>
                        <span className="r-co-name">{cell(rid, "company") || rid}</span>
                      </span>
                    </td>
                    <td><span className={"r-status r-status-" + status}>{status}</span></td>
                    <td className="r-research-gtm" title={gtmFull}>{gtm}</td>
                    <td className="r-research-sum" title={cell(rid, "summary")}>{cell(rid, "summary") || <span className="nullcell">—</span>}</td>
                    <td className="r-research-signals" title={signals}>{signals || <span className="nullcell">—</span>}</td>
                    <td className="r-research-src" onClick={(e) => e.stopPropagation()}>{src ? srcChip(src) : <span className="nullcell">—</span>}{src2 ? srcChip(src2) : null}</td>
                    <td><span className={"r-fresh " + freshnessClass(last)}>{freshnessLabel(last)}</span></td>
                  </tr>
                  {open && (
                    <tr className="r-research-detail-row">
                      <td colSpan={7}>
                        <div className="r-research-detail">
                          {detail.map(([k, v]) => (
                            <div key={k} className="r-detail-field"><span className="r-detail-k">{k}</span><span className="r-detail-v">{v}</span></div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
        {visibleRowIds.length < rowIds.length && (
          <div className="row" style={{ padding: "8px 10px", gap: 8 }}>
            <button className="r-mini-btn" onClick={() => setPages((n) => n + 1)}>Show next {Math.min(RESEARCH_PAGE_SIZE, rowIds.length - visibleRowIds.length)}</button>
            <span className="tiny faint">{visibleRowIds.length} of {rowIds.length} accounts</span>
          </div>
        )}
      </div>
    </div>
  );
}

function parseResearchRows(text: string): ResearchRowInput[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).flatMap((line, idx) => {
    const cols = line.split(/\t|,/).map((c) => c.trim()).filter(Boolean);
    if (!cols.length || (idx === 0 && /^company$/i.test(cols[0]))) return [];
    return [{ company: cols[0], website: cols[1], tier: cols[2], intent: cols[3], owner: cols[4], crmStatus: cols[5] }];
  });
}
function freshnessLabel(last: string) {
  if (!last) return "never";
  const days = Math.floor((Date.now() - Date.parse(last)) / 86_400_000);
  if (!Number.isFinite(days)) return "unknown";
  return days > 30 ? `${days}d stale` : "fresh";
}
function freshnessClass(last: string) {
  if (!last) return "stale";
  const days = Math.floor((Date.now() - Date.parse(last)) / 86_400_000);
  return Number.isFinite(days) && days <= 30 ? "fresh" : "stale";
}
function csvEscape(value: string) {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function downloadResearchCsv(art: Art, rowIds: string[], cell: (rid: string, c: string) => string) {
  const cols = ["company", "website", "tier", "intent", "owner", "crm_status", "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched"];
  const lines = [cols.join(","), ...rowIds.map((rid) => cols.map((c) => csvEscape(cell(rid, c))).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${art.title.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "research"}-crm.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function ResearchLegacy({ art }: { art: Art }) {
  const store = useStore();
  const [running, setRunning] = useState(false);
  const rowIds = [...new Set(art.order.map((e) => e.split("__")[0]))];
  const cell = (rid: string, c: string) => displayCellValue(art.elements[`${rid}__${c}`]?.value);
  const pending = rowIds.filter((rid) => (cell(rid, "status") || "pending") === "pending").length;
  const run = async () => { setRunning(true); try { await store.askResearch(); } finally { setRunning(false); } };
  const srcLink = (src: string) => { const u = src.match(/https?:\/\/\S+/)?.[0]; return u ? <a href={u} target="_blank" rel="noreferrer">{src}</a> : <span>{src}</span>; };
  return (
    <div className="r-art-body">
      <div className="r-research-bar">
        <span className="tiny faint">{rowIds.length} companies · {pending} pending · agent enriches pending rows only</span>
        <span className="grow" />
        <button className="r-btn" disabled={running || pending === 0} onClick={run}>{running ? "Researching…" : pending ? `Enrich ${pending} pending` : "All complete"}</button>
      </div>
      <table className="r-research">
        <thead><tr><th>Company</th><th>Status</th><th>Sourced summary</th><th>Source</th></tr></thead>
        <tbody>
          {rowIds.map((rid) => {
            const status = cell(rid, "status") || "pending";
            const src = cell(rid, "source");
            return (
              <tr key={rid}>
                <td className="r-research-co">{cell(rid, "company") || rid}</td>
                <td><span className={"r-status r-status-" + status}>{status}</span></td>
                <td className="r-research-sum">{cell(rid, "summary") || <span className="nullcell">—</span>}</td>
                <td className="r-research-src">{src ? srcLink(src) : <span className="nullcell">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── helpers (take the store) ── */
async function commit(store: RoomStore, roomId: string, me: Actor, artId: string, elementId: string, value: unknown): Promise<EditFeedback | null> {
  const el = store.getArtifact(artId)?.elements[elementId];
  if (!el || Object.is(el.value, value)) return null;
  return store.applyEdit({ roomId, op: { opId: crypto.randomUUID(), artifactId: artId, elementId, kind: "set", value, baseVersion: el.version }, actor: me });
}
async function createElement(store: RoomStore, roomId: string, me: Actor, artId: string, elementId: string, value: unknown): Promise<EditFeedback> {
  return store.applyEdit({ roomId, op: { opId: crypto.randomUUID(), artifactId: artId, elementId, kind: "create", value, baseVersion: 0 }, actor: me });
}
async function deleteElement(store: RoomStore, roomId: string, me: Actor, artId: string, elementId: string): Promise<EditFeedback | null> {
  const el = store.getArtifact(artId)?.elements[elementId];
  if (!el) return null;
  return store.applyEdit({ roomId, op: { opId: crypto.randomUUID(), artifactId: artId, elementId, kind: "delete", value: null, baseVersion: el.version }, actor: me });
}
const editErrorMsg = (f: EditFeedback) =>
  f.reason === "nothing_to_undo" ? "Nothing to undo yet."
    : f.reason === "conflict" ? "That cell changed since you opened it — your edit was reverted. Re-open it to see the new value."
    : f.reason === "locked" ? "That cell is locked by an agent right now."
      : f.reason === "pending_approval" ? "That agent edit is waiting for host approval."
      // Restore-specific honest failures (convex/elementHistory.ts restoreElementVersion):
      : f.reason === "version_not_found" ? "That version is no longer in history — retention pruned it."
      : f.reason === "snapshot_truncated" ? "That snapshot was truncated for display and cannot be restored."
      : "Edit could not be applied.";
function lockedByOther(store: RoomStore, artId: string, elementId: string, me: Actor) {
  const lk = store.lockFor(artId, elementId);
  return lk && lk.holder.id !== me.id ? lk : null;
}
function draftedFor(store: RoomStore, roomId: string, artId: string, elementId: string): boolean {
  return store.listDrafts(roomId).some((d) => d.status === "pending" && d.artifactId === artId && d.ops.some((o) => o.elementId === elementId));
}
function memberColor(store: RoomStore, roomId: string, actor: Actor): string | undefined {
  if (actor.kind !== "user") return undefined;
  return store.listMembers(roomId).find((member) => member.id === actor.id)?.color;
}
function touchPresence(store: RoomStore, roomId: string, artId: string, me: Actor, targetId: string, mode: "focus" | "edit", color?: string) {
  store.updatePresence({
    roomId,
    artifactId: artId,
    targetKind: "cell",
    targetId,
    mode,
    actor: me,
    label: mode === "edit" ? `${me.name} editing` : me.name,
    color,
    ttlMs: mode === "edit" ? 15_000 : 12_000,
  });
}
function presenceForCell(rows: PresenceClaim[], elementId: string, me: Actor): PresenceClaim | null {
  const rank: Record<PresenceClaim["mode"], number> = { commit_lease: 0, edit: 1, agent_intent: 2, focus: 3 };
  return rows
    .filter((row) => row.targetKind === "cell" && row.targetId === elementId && row.actor.id !== me.id && row.expiresAt > Date.now())
    .sort((a, b) => rank[a.mode] - rank[b.mode] || b.updatedAt - a.updatedAt)[0] ?? null;
}
function presenceStyle(row: PresenceClaim | null): CSSProperties | undefined {
  return row?.color ? ({ "--presence-color": row.color } as CSSProperties) : undefined;
}
function presenceLabel(row: PresenceClaim): string {
  if (row.mode === "agent_intent") return row.label ?? `${row.actor.name} planning`;
  if (row.mode === "commit_lease") return row.label ?? `${row.actor.name} publishing`;
  if (row.mode === "edit") return row.label ?? `${row.actor.name} editing`;
  return row.label ?? row.actor.name;
}

/**
 * PresenceLadder — the cursor-ladder rung for ONE sheet cell (the States & Scale
 * "Presence at scale" primitive). Given the room's presence claims + this cell's element
 * id, `ladderFor` collapses distinct actors into a rung and this renders it:
 *
 *   1 claim   → one named flag (`.sc-flag`, lifted from design-reference/fixes .fx-flag)
 *   2–3       → offset stacked flags (`.sc-flagstack`)
 *   4+        → cluster count pill `+N` (`.sc-cluster`, from design-reference/scale/scale.css)
 *
 * Pointer-events: none — the ladder is a passive presence read, never a click target (the
 * cell underneath keeps its selection/edit/history behavior). Excludes `me` via `selfId`.
 */
export function presenceLadderModel(rows: readonly PresenceClaim[], elementId: string, selfId: string, now: number = Date.now()): LadderResult {
  // ladderFor is actor-deduped + bounded; drop self first so my own flag never shows on my cell.
  return ladderFor(rows.filter((r) => r.targetKind === "cell" && r.actor?.id !== selfId), elementId, now);
}

export function PresenceLadder({ rows, elementId, selfId }: { rows: readonly PresenceClaim[]; elementId: string; selfId: string }) {
  const ladder = presenceLadderModel(rows, elementId, selfId);
  if (ladder.mode === "none") return null;
  if (ladder.mode === "cluster") {
    const title = ladder.members.map((m) => m.name).join(", ") + (ladder.count > ladder.members.length ? ` +${ladder.count - ladder.members.length} more` : "");
    return (
      <span className="sc-cluster r-presence-ladder" data-testid="presence-cluster" data-count={ladder.count} title={`${ladder.count} people here — ${title}`} aria-label={`${ladder.count} people here`}>
        +{ladder.count}
      </span>
    );
  }
  // flag (1) or stack (2–3): render each member as an offset named flag, freshest on top.
  return (
    <span className={"r-presence-ladder " + (ladder.mode === "stack" ? "sc-flagstack" : "sc-flagone")} data-testid={ladder.mode === "stack" ? "presence-stack" : "presence-flag"} data-count={ladder.count} aria-label={`${ladder.count} ${ladder.count === 1 ? "person" : "people"} here`}>
      {ladder.members.map((m, i) => (
        <span
          key={m.id}
          className="sc-flag"
          data-testid="presence-flag-member"
          style={{ zIndex: LADDER_MEMBER_CAP - i, ...(m.color ? ({ "--presence-color": m.color } as CSSProperties) : {}) }}
          title={m.name}
        >
          {m.name}
        </span>
      ))}
    </span>
  );
}

/** Finance mental model: green means POSITIVE, red means negative — not "cell has content".
 *  Unsigned values (notes, labels) render neutral so status colors keep their meaning. */
function valueClass(value: string): string {
  return /^[-(]/.test(value) ? "r-val-neg" : value.startsWith("+") ? "r-val-pos" : "r-val-num";
}

function EditableCell({ value, disabled, align, onCommit, addLabel, onEditStart, onEditEnd }: { value: string; disabled?: boolean; align?: "right"; onCommit: (s: string) => void; addLabel?: string; onEditStart?: () => void; onEditEnd?: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  if (disabled) return value ? <span className={valueClass(value)}>{value}</span> : <span className="nullcell">—</span>;
  if (editing) {
    return (
      <input className="r-cell-input rm-cellin" autoFocus value={draft} style={align === "right" ? { textAlign: "right" } : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); onEditEnd?.(); if (draft.trim() !== value) onCommit(draft.trim()); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setDraft(value); setEditing(false); onEditEnd?.(); } }} />
    );
  }
  return (
    <button className="r-cell-edit" data-testid="cell-edit-control" data-cell-value={value} onClick={() => { setEditing(true); onEditStart?.(); }}>
      {value ? <span className={valueClass(value)}>{value}</span> : <span className="add-hint"><Plus size={11} /> {addLabel ?? "add"}</span>}
    </button>
  );
}

function rowIdsOf(art: Art): string[] {
  if (art.meta?.excelGrid) {
    const rowCount = Math.max(1, Number(art.meta.excelGrid.rows) || 1);
    return Array.from({ length: rowCount }, (_, i) => String(i + 1));
  }
  const ids: string[] = [];
  for (const eid of art.order ?? []) {
    const r = eid.split("__")[0];
    if (r && !ids.includes(r)) ids.push(r);
  }
  return ids;
}
const cellVal = (art: Art, rowId: string, col: string) => displayCellValue(art.elements[`${rowId}__${col}`]?.value);

function colsOf(art: Art): string[] {
  const cols: string[] = [];
  for (const eid of art.order ?? []) {
    const col = eid.split("__").slice(1).join("__");
    if (col && !cols.includes(col)) cols.push(col);
  }
  return cols;
}

function sheetElementId(art: Art, rowId: string, colId: string): string {
  return art.meta?.excelGrid ? `${colId}${rowId}` : `${rowId}__${colId}`;
}

function parseSheetElementId(art: Art, elementId: string | null): { rowId: string; colId: string } {
  if (!elementId) return { rowId: "", colId: "" };
  if (art.meta?.excelGrid) {
    const match = elementId.match(/^([A-Z]+)(\d+)$/);
    return match ? { colId: match[1], rowId: match[2] } : { rowId: "", colId: "" };
  }
  const sep = elementId.indexOf("__");
  return sep >= 0 ? { rowId: elementId.slice(0, sep), colId: elementId.slice(sep + 2) } : { rowId: "", colId: "" };
}

function dataframeColumnWidth(col: DataframeColumn, index: number): number {
  const simpleSheetColumn = /^[A-Z]+$/.test(col.id) && col.label === col.id;
  if (simpleSheetColumn) return index === 0 ? 168 : 116;
  return Math.max(112, Math.min(220, 48 + (col.label?.length ?? 0) * 8));
}

function scaleColumnWidth(col: DataframeColumn, index: number): number {
  const id = col.id.toLowerCase();
  if (id === "tier") return 72;
  if (id === "status" || id === "crm_status") return 128;
  if (id === "company" || id === "website") return 164;
  if (id === "owner") return 136;
  if (id === "headcount" || id === "last_researched") return 152;
  if (id === "source" || id === "source2") return 148;
  if (id === "intent" || id === "summary" || id === "funding" || id === "recent_signal") return 232;
  return Math.max(128, Math.min(240, dataframeColumnWidth(col, index)));
}

function sheetColumnWidth(art: Art, col: DataframeColumn, index: number): number {
  const excelWidth = art.meta?.excelGrid?.colWidths?.[index];
  if (excelWidth) return Math.max(88, Math.min(260, Math.round(excelWidth * 7 + 18)));
  if (art.meta?.dataframe && !art.meta?.excelGrid) {
    const id = col.id.toLowerCase();
    if (id === "company") return 150;
    if (id === "website") return 200;
    if (id === "status" || id === "crm_status") return 150;
    if (id === "tier") return 66;
    if (id === "intent") return 92;
    if (id === "owner") return 82;
  }
  return dataframeColumnWidth(col, index);
}

function dataframeCellAddress(art: Art, cols: string[], rows: string[], key: string | null): string {
  if (!key) return "";
  if (art.meta?.excelGrid) return key;
  const sep = key.indexOf("__");
  if (sep < 0) return "";
  const rowId = key.slice(0, sep);
  const colId = key.slice(sep + 2);
  const colIndex = cols.indexOf(colId);
  const rowIndex = rows.indexOf(rowId);
  return colIndex >= 0 && rowIndex >= 0 ? `${columnLetters(colIndex)}${rowIndex + 1}` : "";
}

function isNumberLikeCell(value: unknown): boolean {
  const payload = asCellPayload(value);
  const raw = payload ? payload.value : value;
  if (typeof raw === "number") return Number.isFinite(raw);
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("=")) return false;
  return Number.isFinite(Number(trimmed.replace(/,/g, "")));
}

function cellHasVisibleValue(value: unknown): boolean {
  return displayCellValue(value).trim().length > 0;
}

function lettersToColumnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function expandSheetMerges(merges: string[] | undefined): { mergeAnchor: Map<string, { colSpan: number; rowSpan: number }>; mergeCovered: Set<string> } {
  const mergeAnchor = new Map<string, { colSpan: number; rowSpan: number }>();
  const mergeCovered = new Set<string>();
  if (!Array.isArray(merges)) return { mergeAnchor, mergeCovered };
  for (const range of merges) {
    const match = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!match) continue;
    const c1 = lettersToColumnNumber(match[1]);
    const r1 = Number(match[2]);
    const c2 = lettersToColumnNumber(match[3]);
    const r2 = Number(match[4]);
    const size = (c2 - c1 + 1) * (r2 - r1 + 1);
    if (c2 < c1 || r2 < r1 || size > 1_000) continue;
    mergeAnchor.set(`${match[1]}${r1}`, { colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue;
        mergeCovered.add(`${columnLetters(c - 1)}${r}`);
      }
    }
  }
  return { mergeAnchor, mergeCovered };
}

function normalizeDataframeColumn(col: string): string {
  return col.trim().toLowerCase();
}

function isGenericStatusColumn(col: string): boolean {
  const normalized = normalizeDataframeColumn(col);
  return normalized === "status" || normalized.endsWith("_status");
}

function isGenericOwnerColumn(col: string): boolean {
  const normalized = normalizeDataframeColumn(col);
  return normalized === "owner" || normalized === "assignee" || normalized === "lead" || normalized.endsWith("_owner");
}

function isGenericSourceColumn(col: string): boolean {
  const normalized = normalizeDataframeColumn(col);
  return /^source\d*$/.test(normalized) || normalized === "citation" || normalized === "cite";
}

function extractUrl(value: string): string | null {
  const match = value.match(/https?:\/\/[^\s),;]+/i);
  return match ? match[0].replace(/[.)]+$/, "") : null;
}

function sourceHost(value: string): string {
  const url = extractUrl(value) ?? value;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//i, "").split(/[/?#\s]/)[0] || value;
  }
}

function statusTone(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (/^(complete|completed|done|approved)$/.test(normalized)) return "complete";
  if (/^(needs_review|review|gap|failed|blocked)$/.test(normalized)) return normalized === "failed" ? "failed" : "needs-review";
  if (/^(enriching|running|in_progress|working)$/.test(normalized)) return "enriching";
  if (/^(pending|queued|todo|open|running|in_progress)$/.test(normalized)) return "pending";
  return "neutral";
}

function statusText(value: string): string {
  const tone = statusTone(value);
  if (tone === "needs-review") return "needs_review";
  if (tone === "complete" || tone === "enriching" || tone === "pending" || tone === "failed") return tone;
  return value.trim().toLowerCase().replace(/[_-]+/g, " ");
}

function sheetStatusFilterForValue(value: string): SheetStatusFilter {
  const tone = statusTone(value);
  if (tone === "complete" || tone === "enriching" || tone === "pending" || tone === "failed") return tone;
  if (tone === "needs-review") return "needs_review";
  return "pending";
}

function sheetStatusFilterLabel(filter: SheetStatusFilter): string {
  return filter === "needs_review" ? "needs review" : filter;
}

function evidenceTitle(payload: CellPayload | null): string {
  const evidence = payload?.evidence ?? [];
  return evidence.map((item) => [item.label, item.url ?? item.source].filter(Boolean).join(" - ")).filter(Boolean).join(" | ");
}

function evidenceReceiptLink(item: CellEvidence): string | undefined {
  return item.url ?? item.source;
}

// --- In-cell evidence hover popover (the receipts payoff) --------------------
// The "N src" cite chip reveals a popover listing the cell's
// CellPayload.evidence[] receipts: label, quoted snippet, source host link,
// per-item confidence, and a checked/updated line. Pure helpers are exported
// for unit tests (tests/evidencePopover.test.tsx).
export const EVIDENCE_POPOVER_MAX_ITEMS = 4; // BOUND: agent loops can stack receipts; render 4 + "+N more".
export const EVIDENCE_POPOVER_SNIPPET_MAX = 180;
const EVIDENCE_POPOVER_EST_WIDTH = 288; // keep in sync with .r-evidence-popover width in styles.css
const EVIDENCE_POPOVER_EST_HEIGHT = 280; // keep in sync with .r-evidence-popover max-height in styles.css

const EVIDENCE_KIND_LABELS: Record<CellEvidence["kind"], string> = {
  upload: "uploaded file",
  source: "web source",
  computed: "computed",
  manual: "manual entry",
};

export interface EvidencePopoverItem {
  id: string;
  label: string;
  snippet?: string;
  /** http(s) link only — non-http schemes are dropped so hostile URLs render as text. */
  href?: string;
  host?: string;
  kindLabel: string;
  confidencePct?: number;
}

export interface EvidencePopoverModel {
  count: number;
  items: EvidencePopoverItem[];
  moreCount: number;
  confidencePct?: number;
}

function clampEvidenceText(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…` : trimmed;
}

function confidencePctOf(confidence: unknown): number | undefined {
  return typeof confidence === "number" && Number.isFinite(confidence)
    ? Math.round(Math.max(0, Math.min(1, confidence)) * 100)
    : undefined;
}

export function evidencePopoverModel(payload: CellPayload | null): EvidencePopoverModel {
  const evidence = payload?.evidence ?? [];
  const items = evidence.slice(0, EVIDENCE_POPOVER_MAX_ITEMS).map((item, i) => {
    const raw = evidenceReceiptLink(item);
    const href = raw ? extractUrl(raw) ?? undefined : undefined;
    return {
      id: item.id || `ev-${i}`,
      label: clampEvidenceText(item.label || item.source || "source", 80),
      snippet: item.snippet ? clampEvidenceText(item.snippet, EVIDENCE_POPOVER_SNIPPET_MAX) : undefined,
      href,
      host: raw ? sourceHost(raw) : undefined,
      kindLabel: EVIDENCE_KIND_LABELS[item.kind] ?? "source",
      confidencePct: confidencePctOf(item.confidence),
    };
  });
  return {
    count: evidence.length,
    items,
    moreCount: Math.max(0, evidence.length - items.length),
    confidencePct: confidencePctOf(payload?.confidence),
  };
}

export function evidenceCheckedLabel(ts: number | undefined, now: number = Date.now()): string | undefined {
  if (typeof ts !== "number" || !Number.isFinite(ts) || ts <= 0) return undefined;
  const d = new Date(ts);
  const ref = new Date(now);
  const sameDay = d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate();
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameDay ? `checked ${hhmm}` : `checked ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${hhmm}`;
}

/** Viewport-aware placement: flip above when near the bottom edge (only if there is room above); anchor left when there is no room to spill left. */
export function evidencePopoverPlacement(
  rect: { top: number; bottom: number; left: number; right: number },
  viewport: { width: number; height: number },
): { flip: "down" | "up"; align: "right" | "left" } {
  const flip = viewport.height > 0 && rect.bottom + EVIDENCE_POPOVER_EST_HEIGHT > viewport.height && rect.top > EVIDENCE_POPOVER_EST_HEIGHT
    ? "up"
    : "down";
  // Default anchors the popover's right edge to the chip (it spills left).
  const align = rect.right - EVIDENCE_POPOVER_EST_WIDTH < 8 && rect.left + EVIDENCE_POPOVER_EST_WIDTH < viewport.width - 8
    ? "left"
    : "right";
  return { flip, align };
}

export function EvidenceReceipt({ payload, compact = false, checkedAt }: { payload: CellPayload | null; compact?: boolean; checkedAt?: number }) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [placement, setPlacement] = useState<{ flip: "down" | "up"; align: "right" | "left" }>({ flip: "down", align: "right" });
  const model = evidencePopoverModel(payload);
  if (!model.count) return null;
  const reposition = () => {
    const el = wrapRef.current;
    if (!el || typeof window === "undefined") return;
    const next = evidencePopoverPlacement(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight });
    setPlacement((prev) => (prev.flip === next.flip && prev.align === next.align ? prev : next));
  };
  const checked = evidenceCheckedLabel(checkedAt);
  return (
    <span ref={wrapRef} className="r-cite-wrap" data-compact={compact ? "true" : undefined} onMouseEnter={reposition} onFocus={reposition}>
      {/* stopPropagation: clicking the chip pins the popover via focus; letting the click reach the cell would steal focus back to the grid and close it. */}
      <span className="r-cite-chip" data-testid="grid-cite-chip" tabIndex={0} title={evidenceTitle(payload)} onClick={(e) => e.stopPropagation()}>{model.count} src</span>
      <span className="r-cite-popover r-evidence-popover" data-testid="evidence-popover" role="note" data-flip={placement.flip} data-align={placement.align}>
        <span className="r-evidence-items" data-testid="grid-cite-popover">
          {model.items.map((item) => (
            <span key={item.id} className="r-evidence-item">
              <b>{item.label}</b>
              {item.snippet && <span className="r-evidence-quote">&ldquo;{item.snippet}&rdquo;</span>}
              <em className="r-evidence-from">
                {item.href
                  ? <a href={item.href} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{item.host ?? item.href}</a>
                  : <span>{item.host ?? item.kindLabel}</span>}
                {typeof item.confidencePct === "number" && <span className="r-evidence-conf"> · {item.confidencePct}%</span>}
              </em>
            </span>
          ))}
        </span>
        {model.moreCount > 0 && <span className="r-evidence-more" data-testid="evidence-popover-more">+{model.moreCount} more</span>}
        <em className="r-evidence-checked">{checked ?? "source checked"} · {typeof model.confidencePct === "number" ? `${model.confidencePct}% confidence` : "visible receipt"}</em>
      </span>
    </span>
  );
}

// --- Per-cell version history + restore (the receipts layer's recovery path) --
// Reads the `elementVersions` VERSION LOG through convex/elementHistory.ts:
// listElementVersions (proof-gated, bounded) + restoreElementVersion (a NORMAL
// CAS write through applyCellEditCore — conflicts surface honestly via the
// existing EditFeedback path). Live (convex) mode only: the in-memory engine
// keeps no history, so memory mode hides the affordance entirely — honest
// absence, never fake rows. Pure helpers exported for tests/cellHistoryUi.test.tsx.

// convex/_generated lags until the next codegen — which must NOT be run
// casually: `npx convex codegen` against a configured cloud deployment DEPLOYS
// schema+functions (documented gotcha). Same cast precedent as
// src/ui/Landing.tsx landingMetricsQuery / tests/elementVersions.test.ts.
type ElementVersionRow = {
  _id: string;
  version: number;
  value: unknown;
  truncated: boolean;
  /** The actor whose applied write superseded this version (who changed it away). */
  updatedBy: Actor;
  kind: "set" | "create" | "delete";
  ts: number;
};
type RestoreOutcome = { ok: true; version?: number } | { ok: false; reason: string; truncated?: boolean };
type ElementHistoryListArgs = { roomId: string; artifactId: string; elementId: string; requester: ActorProof; limit?: number };
type ElementHistoryRestoreArgs = { roomId: string; artifactId: string; elementId: string; requester: ActorProof; version: number };
const elementHistoryApi = (api as unknown as {
  elementHistory: {
    listElementVersions: FunctionReference<"query", "public", ElementHistoryListArgs, ElementVersionRow[]>;
    restoreElementVersion: FunctionReference<"mutation", "public", ElementHistoryRestoreArgs, RestoreOutcome>;
  };
}).elementHistory;

export const CELL_HISTORY_LIMIT = 8; // BOUND: popover shows the newest 8 (server caps reads at 50)
const CELL_HISTORY_PREVIEW_MAX = 60;
export const CELL_DIFF_MAX_WORDS = 160; // BOUND: word-level LCS is O(n*m); clamp both sides

/** Live-only gate: history exists only where the elementVersions log does (Convex). */
export function cellHistoryEnabled(mode: "memory" | "convex", proof: ActorProof | undefined): boolean {
  return mode === "convex" && !!proof;
}

/** Bounded one-line preview of a logged value (objects render via displayCellValue). */
export function historyValuePreview(value: unknown): string {
  const text = displayCellValue(value).replace(/\s+/g, " ").trim();
  if (!text) return "—";
  return text.length > CELL_HISTORY_PREVIEW_MAX ? `${text.slice(0, CELL_HISTORY_PREVIEW_MAX - 1).trimEnd()}…` : text;
}

/** Compact relative time for history rows ("just now" / "5m" / "3h" / "4d"). */
export function historyTimeAgo(ts: number, now: number = Date.now()): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const delta = Math.max(0, now - ts);
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export type DiffSegment = { text: string; changed: boolean };

/**
 * Word-level two-row diff (no deps): LCS over whitespace-split tokens, both
 * sides clamped to CELL_DIFF_MAX_WORDS so hostile megacell values stay O(bounded).
 * `old.changed` = word was replaced/removed; `next.changed` = word is new.
 */
export function wordDiffSegments(oldText: string, nextText: string): { old: DiffSegment[]; next: DiffSegment[] } {
  const a = oldText.split(/\s+/).filter(Boolean).slice(0, CELL_DIFF_MAX_WORDS);
  const b = nextText.split(/\s+/).filter(Boolean).slice(0, CELL_DIFF_MAX_WORDS);
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const oldChanged = new Array<boolean>(a.length).fill(true);
  const nextChanged = new Array<boolean>(b.length).fill(true);
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { oldChanged[i] = false; nextChanged[j] = false; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return {
    old: a.map((text, k) => ({ text, changed: oldChanged[k] })),
    next: b.map((text, k) => ({ text, changed: nextChanged[k] })),
  };
}

/** Inline two-row compare: the logged version's value vs the current value. */
export function CellDiff({ version, oldValue, currentValue }: { version: number; oldValue: string; currentValue: string }) {
  const d = wordDiffSegments(oldValue, currentValue);
  const row = (segments: DiffSegment[]) =>
    segments.length === 0
      ? <span className="nullcell">—</span>
      : segments.map((s, k) => <Fragment key={k}>{k > 0 ? " " : ""}<span className={s.changed ? "chg" : undefined}>{s.text}</span></Fragment>);
  return (
    <span className="r-hist-diff" data-testid="cell-diff">
      <span className="r-hist-diff-row old"><span className="r-hist-diff-tag">v{version}</span><span className="r-hist-diff-text">{row(d.old)}</span></span>
      <span className="r-hist-diff-row next"><span className="r-hist-diff-tag">now</span><span className="r-hist-diff-text">{row(d.next)}</span></span>
    </span>
  );
}

/**
 * CellHistory — hover-revealed clock glyph in the cell corner (design "Cell
 * states" board: apparatus appears on hover) opening a popover of recent
 * versions with per-row Restore + diff. Any room member may restore (the
 * mutation itself is proof-gated); a restore is a NEW CAS write, so conflicts
 * come back as honest EditFeedback — never a silent history rewrite.
 * Mounted in LIVE mode only (see cellHistoryEnabled).
 */
export function CellHistory({ roomId, artifactId, elementId, requester, currentValue, shifted, onFeedback }: {
  roomId: string;
  artifactId: string;
  elementId: string;
  requester: ActorProof;
  currentValue: string;
  /** True when the cite chip occupies the cell corner — shift left of it. */
  shifted?: boolean;
  onFeedback?: (f: EditFeedback) => void;
}) {
  // Perf: a sheet page can render thousands of cells. The closed state costs
  // one useState + a button; the Convex hooks live in CellHistoryPopover and
  // mount only while a popover is open.
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  return (
    <span ref={wrapRef} className={"r-hist-wrap" + (shifted ? " with-cite" : "")} data-open={String(open)}>
      {/* stopPropagation: the glyph must not select/edit the cell underneath. */}
      <button
        type="button"
        className="r-hist-btn"
        data-testid="cell-history-btn"
        aria-label="Cell version history"
        aria-expanded={open}
        title="Version history — every applied write is logged; restore re-applies as a new version"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Clock3 size={10} />
      </button>
      {open && (
        <CellHistoryPopover
          roomId={roomId}
          artifactId={artifactId}
          elementId={elementId}
          requester={requester}
          currentValue={currentValue}
          wrapRef={wrapRef}
          onClose={() => setOpen(false)}
          onFeedback={onFeedback}
        />
      )}
    </span>
  );
}

function CellHistoryPopover({ roomId, artifactId, elementId, requester, currentValue, wrapRef, onClose, onFeedback }: {
  roomId: string;
  artifactId: string;
  elementId: string;
  requester: ActorProof;
  currentValue: string;
  wrapRef: React.RefObject<HTMLSpanElement | null>;
  onClose: () => void;
  onFeedback?: (f: EditFeedback) => void;
}) {
  const [diffFor, setDiffFor] = useState<number | null>(null);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const rows = useQuery(elementHistoryApi.listElementVersions, { roomId, artifactId, elementId, requester, limit: CELL_HISTORY_LIMIT });
  const restore = useMutation(elementHistoryApi.restoreElementVersion);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [wrapRef, onClose]);
  const doRestore = async (version: number) => {
    setBusyVersion(version);
    try {
      const res = await restore({ roomId, artifactId, elementId, requester, version });
      if (res.ok) onClose();
      else onFeedback?.({ ok: false, reason: res.reason });
    } catch {
      onFeedback?.({ ok: false, reason: "restore_failed" });
    } finally {
      setBusyVersion(null);
    }
  };
  return (
    <span className="r-hist-popover" data-testid="cell-history-popover" role="dialog" aria-label={`Version history for ${elementId}`} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <span className="r-hist-head"><History size={11} /> Cell history<span className="r-hist-count">{rows ? `${rows.length} version${rows.length === 1 ? "" : "s"}` : ""}</span></span>
      {rows === undefined && <span className="r-hist-loading">Loading history…</span>}
      {rows && rows.length === 0 && <span className="r-hist-empty" data-testid="cell-history-empty">No prior versions — this cell hasn't been overwritten yet.</span>}
      {rows?.map((row) => (
        <span key={row._id} className="r-hist-row" data-testid="cell-history-row">
          <span className="r-hist-line">
            <span className="r-hist-vpill">v{row.version}</span>
            <span className="r-hist-value" title={historyValuePreview(row.value)}>{historyValuePreview(row.value)}</span>
          </span>
          <span className="r-hist-meta">
            <span className="r-hist-who" title={`replaced by ${row.updatedBy.name}`}>→ {row.updatedBy.name}</span>
            <span>{historyTimeAgo(row.ts)}</span>
            {row.truncated && <span className="r-hist-trunc" title="Snapshot was cut at the size cap — display only, never restorable.">truncated</span>}
            <span className="grow" />
            <button
              type="button"
              className="r-hist-act"
              data-testid="cell-history-diff-toggle"
              data-on={String(diffFor === row.version)}
              onClick={() => setDiffFor((v) => (v === row.version ? null : row.version))}
            >
              diff
            </button>
            <button
              type="button"
              className="r-hist-act primary"
              data-testid="cell-history-restore"
              disabled={row.truncated || busyVersion !== null}
              title={row.truncated ? "Truncated snapshot — display only, cannot be restored." : `Restore v${row.version} as a new version`}
              onClick={() => void doRestore(row.version)}
            >
              {busyVersion === row.version ? "Restoring…" : "Restore"}
            </button>
          </span>
          {diffFor === row.version && <CellDiff version={row.version} oldValue={displayCellValue(row.value)} currentValue={currentValue} />}
        </span>
      ))}
    </span>
  );
}

// --- Stale freshness chip (design "Cell states": always-visible amber "3d") --
export const STALE_AFTER_MS = 72 * 3_600_000; // recheck due after 72h

/** "3d"/"12d" label once a checked source is older than 72h; undefined = fresh/invalid. */
export function staleLabelFor(checkedAt: number | undefined, now: number = Date.now()): string | undefined {
  if (typeof checkedAt !== "number" || !Number.isFinite(checkedAt) || checkedAt <= 0) return undefined;
  const age = now - checkedAt;
  if (age <= STALE_AFTER_MS) return undefined;
  return `${Math.floor(age / 86_400_000)}d`;
}

/**
 * Staleness applies ONLY to cells with checked-source semantics: an explicit
 * checkedAt/retrievedAt carried by the payload/evidence wins; otherwise a cell
 * WITH evidence falls back to the element's updatedAt (the same timestamp the
 * receipt popover already labels "checked HH:MM"). Cells without evidence have
 * no freshness contract → undefined (render nothing; never fake staleness).
 */
export function cellStaleness(payload: CellPayload | null, updatedAt: number | undefined, now: number = Date.now()): string | undefined {
  if (!payload?.evidence?.length) return undefined;
  const explicit: number[] = [];
  const readTs = (o: unknown) => {
    if (!o || typeof o !== "object") return;
    const rec = o as Record<string, unknown>;
    for (const key of ["checkedAt", "retrievedAt"]) {
      const v = rec[key];
      if (typeof v === "number" && Number.isFinite(v) && v > 0) explicit.push(v);
    }
  };
  readTs(payload);
  for (const item of payload.evidence) readTs(item);
  // Most recent explicit check wins; otherwise the commit timestamp stands in.
  const checkedAt = explicit.length ? Math.max(...explicit) : updatedAt;
  return staleLabelFor(checkedAt, now);
}

/** Amber mono chip lifted from design-reference/scale .sc-stale ("stale (recheck due)"). */
export function StaleChip({ label }: { label: string | undefined }) {
  if (!label) return null;
  return (
    <span className="r-stale-chip" data-testid="stale-chip" title={`Source checked ${label} ago — recheck due (older than 72h)`}>
      <History size={9} />
      {label}
    </span>
  );
}

function renderGenericCellContent(col: string, value: string): ReactNode {
  const trimmed = value.trim();
  if (!trimmed) return <span className="nullcell">-</span>;
  if (isGenericStatusColumn(col)) {
    const tone = statusTone(trimmed);
    return <span className={`r-grid-status fx-st r-grid-status-${tone}`} data-testid="grid-status-chip" title={trimmed}>{statusText(trimmed)}</span>;
  }
  if (isGenericOwnerColumn(col)) {
    return (
      <span className="r-owner-chip fx-owner" data-testid="grid-owner-chip" title={trimmed}>
        <span className="r-owner-avatar" aria-hidden="true" style={{ background: coColor(trimmed) }}>{coInitials(trimmed)}</span>
        <span className="r-owner-name">{trimmed}</span>
      </span>
    );
  }
  if (isGenericSourceColumn(col)) {
    const href = extractUrl(trimmed);
    const host = sourceHost(trimmed);
    const label = host.length > 32 ? `${host.slice(0, 29)}...` : host;
    return href ? (
      <a className="r-source-chip fx-src" data-testid="grid-source-chip" href={href} target="_blank" rel="noreferrer" title={trimmed} onClick={(e) => e.stopPropagation()}>
        <span className="r-source-dot" aria-hidden="true" style={{ background: coColor(host) }} />
        <span>{label}</span>
      </a>
    ) : (
      <span className="r-source-chip fx-src" data-testid="grid-source-chip" title={trimmed}>
        <span className="r-source-dot" aria-hidden="true" style={{ background: coColor(host) }} />
        <span>{label}</span>
      </span>
    );
  }
  const urlLike = !!extractUrl(trimmed);
  return <span className={"r-cell-value" + (urlLike ? " r-cell-url" : "")} title={trimmed}>{trimmed}</span>;
}

export function GenericSheet({ roomId, me, art, proof, onError }: { roomId: string; me: Actor; art: Art; proof?: ActorProof; onError?: (f: EditFeedback) => void }) {
  const store = useStore();
  // Per-cell version history is LIVE-mode-only: the in-memory engine keeps no
  // elementVersions log, so memory mode hides the affordance (honest absence).
  const historyOn = cellHistoryEnabled(store.mode, proof);
  const [pages, setPages] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<SheetStatusFilter>("any");
  // Presence freshness (and the ≤1.5s committed flash) fade by wall-clock, but
  // the reactive store won't push an event just because a claim aged — so tick to
  // re-evaluate. Cheap: the sheet is virtualized, only visible cells re-render.
  const [, setPresenceTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setPresenceTick((t) => (t + 1) % 1_000_000), 6_000);
    return () => clearInterval(i);
  }, []);
  // QA P2 perf: derive rows/columns/pageSize once per artifact snapshot, not on every render
  // (paging state changes alone shouldn't re-walk the full element order).
  const { rows, columns, pageSize, totalRows, isScaleSheet } = useMemo(() => {
    const rows = rowIdsOf(art);
    const columns = columnsOf(art);
    const totalRows = art.meta?.dataframe?.rowCount ?? art.meta?.excelGrid?.rows ?? rows.length;
    const isScaleSheet = totalRows >= 1_000 || rows.length >= 1_000;
    const pageSize = isScaleSheet ? SCALE_SHEET_RENDER_WINDOW : Math.max(25, Math.min(250, Math.floor(GENERIC_SHEET_CELL_WINDOW / Math.max(columns.length, 1))));
    return { rows, columns, pageSize, totalRows, isScaleSheet };
  }, [art]);
  const [gridQuery, setGridQuery] = useState("");
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [hiddenColIds, setHiddenColIds] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(`noderoom:grid-hidden-cols:${art.id}`) || "[]") as unknown;
      if (Array.isArray(raw) && raw.length) return raw.filter((id): id is string => typeof id === "string");
      const defaults = (art.meta?.dataframe as { defaultHiddenColumnIds?: unknown } | undefined)?.defaultHiddenColumnIds;
      return Array.isArray(defaults) ? defaults.filter((id): id is string => typeof id === "string") : [];
    } catch {
      const defaults = (art.meta?.dataframe as { defaultHiddenColumnIds?: unknown } | undefined)?.defaultHiddenColumnIds;
      return Array.isArray(defaults) ? defaults.filter((id): id is string => typeof id === "string") : [];
    }
  });
  useEffect(() => { try { localStorage.setItem(`noderoom:grid-hidden-cols:${art.id}`, JSON.stringify(hiddenColIds)); } catch { /* ignore */ } }, [art.id, hiddenColIds]);
  const hiddenColSet = useMemo(() => new Set(hiddenColIds), [hiddenColIds]);
  const visibleColumns = useMemo(() => {
    const next = columns.filter((col) => !hiddenColSet.has(col.id));
    return next.length ? next : columns.slice(0, 1);
  }, [columns, hiddenColSet]);
  const allCols = columns.map((col) => col.id);
  const cols = visibleColumns.map((col) => col.id);
  const statusColId = columns.find((col) => /status/i.test(col.id) || /status/i.test(col.label ?? ""))?.id ?? "";
  const sourceRowIndexById = useMemo(() => new Map(rows.map((rid, index) => [rid, index + 1])), [rows]);
  const statusCounts = useMemo(() => {
    const counts: Record<SheetStatusFilter, number> = { any: rows.length, complete: 0, enriching: 0, pending: 0, needs_review: 0, failed: 0 };
    if (!statusColId) return counts;
    for (const rid of rows) {
      const raw = art.elements[sheetElementId(art, rid, statusColId)]?.value;
      counts[sheetStatusFilterForValue(displayCellValue(raw))] += 1;
    }
    return counts;
  }, [art, rows, statusColId]);
  const queryFilteredRows = useMemo(() => filterGenericSheetRows(art, rows, allCols, gridQuery), [art, rows, allCols, gridQuery]);
  const filteredRows = useMemo(() => {
    if (statusFilter === "any" || !statusColId) return queryFilteredRows;
    return queryFilteredRows.filter((rid) => {
      const raw = art.elements[sheetElementId(art, rid, statusColId)]?.value;
      return sheetStatusFilterForValue(displayCellValue(raw)) === statusFilter;
    });
  }, [art, queryFilteredRows, statusColId, statusFilter]);
  const colWidths = useMemo(
    () => visibleColumns.map((col) => {
      const index = Math.max(0, columns.findIndex((candidate) => candidate.id === col.id));
      return isScaleSheet ? scaleColumnWidth(col, index) : sheetColumnWidth(art, col, index);
    }),
    [art.meta?.excelGrid?.colWidths, columns, visibleColumns, isScaleSheet],
  );
  // TRUE ROW VIRTUALIZATION (scale sheets only): the scroll container reports its scrollTop +
  // client height, and `computeRowWindow` turns that into the half-open [start, end) render band
  // between top/bottom spacer rows sized from the fixed 44px row height. Non-scale generic sheets
  // keep the cheap "Show next page" path (their row count is already bounded < 1,000).
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportPx, setViewportPx] = useState(0);
  // The FOCUSED (selected) row stays mounted even when scrolled out of the window, so an agent/QA
  // stage-focus or an in-progress selection never unmounts mid-interaction. Indexed within filteredRows.
  const selectedRowIdForWindow = parseSheetElementId(art, sel).rowId;
  const focusedIndex = isScaleSheet && selectedRowIdForWindow
    ? filteredRows.indexOf(selectedRowIdForWindow)
    : -1;
  const rowWindow = useMemo(
    () => computeRowWindow(scrollTop, viewportPx || 640, filteredRows.length, focusedIndex >= 0 ? focusedIndex : null),
    [scrollTop, viewportPx, filteredRows.length, focusedIndex],
  );
  // The rows that actually mount: for scale sheets, the window slice PLUS the pinned focused row if
  // it fell outside; for non-scale sheets, the paged prefix.
  const windowRows = isScaleSheet ? filteredRows.slice(rowWindow.start, rowWindow.end) : [];
  const pinnedFocusRow = isScaleSheet && rowWindow.focusedPinned && focusedIndex >= 0 ? filteredRows[focusedIndex] : null;
  const visibleRows = isScaleSheet
    ? (pinnedFocusRow ? [...windowRows, pinnedFocusRow] : windowRows)
    : filteredRows.slice(0, pageSize * pages);
  // Honest render-window meta chip. Scale sheets report the true 1-based [start+1, end] band (the
  // pinned focus row, if any, is extra and not part of the contiguous band). Filtered views report
  // rendered/total. Non-scale sheets keep the "rows 1-N rendered" shape.
  const renderedWindowLabel = isScaleSheet
    ? (statusFilter === "any"
        ? `rows ${filteredRows.length === 0 ? 0 : rowWindow.start + 1}-${rowWindow.end} rendered`
        : `rows ${filteredRows.length === 0 ? 0 : rowWindow.start + 1}-${rowWindow.end} of ${filteredRows.length} ${sheetStatusFilterLabel(statusFilter)}`)
    : (statusFilter === "any"
        ? `rows 1-${visibleRows.length} rendered`
        : `${visibleRows.length}/${filteredRows.length} ${sheetStatusFilterLabel(statusFilter)} rendered`);
  const { mergeAnchor, mergeCovered } = useMemo(() => expandSheetMerges(art.meta?.excelGrid?.merges), [art.meta?.excelGrid?.merges]);
  const selected = parseSheetElementId(art, sel);
  const selectedRowId = selected.rowId;
  const selectedColId = selected.colId;
  const dataframeMeta = art.meta?.dataframe;
  const sheetKicker = dataframeMeta?.sourceFile === "blank-room" || dataframeMeta?.sourceFile === "blank-room-agent" ? "versionedSpreadsheetSync" : art.meta?.upload ? "uploadedSpreadsheet" : "dataframe";
  const columnCountLabel = cols.length < columns.length ? `${cols.length} of ${columns.length} cols` : `${cols.length} cols`;
  const columnCountTitle = cols.length < columns.length ? `${columns.length - cols.length} hidden columns available from the column menu` : "All columns visible";
  const footerColumnLabel = `${columns.length} columns`;
  const gridPlaceholder = art.title === "Company research" ? `Filter ${totalRows.toLocaleString()} companies` : "Find rows";

  // Attention Overlay — SAME wiring as the variance Sheet, on the dynamic `${rid}__${col}` key space, so
  // agent_write / proposal / evidence boxes land on whatever columns the agent governed via define_columns.
  const proposals = store.listProposals(roomId).filter((p) => p.artifactId === art.id);
  const presenceRows = store.listPresence(roomId, art.id);
  const sheetWrapRef = useRef<HTMLDivElement>(null);
  const overlayResolver = useMemo(() => createSpreadsheetResolver(() => sheetWrapRef.current), []);
  // Scroll-driven windowing (scale sheets only): the .r-sheet-wrap viewport reports scrollTop +
  // clientHeight; `computeRowWindow` (above) turns those into the mounted band. rAF-coalesced so a
  // fling recomputes the window at most once per frame (BOUND). A ResizeObserver keeps the viewport
  // height honest when the panel is split/resized.
  useEffect(() => {
    if (!isScaleSheet) return;
    const el = sheetWrapRef.current;
    if (!el) return;
    let raf = 0;
    const sync = () => { raf = 0; setScrollTop(el.scrollTop); setViewportPx(el.clientHeight); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(sync); };
    setScrollTop(el.scrollTop);
    setViewportPx(el.clientHeight || 640);
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => setViewportPx(el.clientHeight || 640)) : null;
    ro?.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro?.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [isScaleSheet, filteredRows.length]);
  const overlayCellStates = useMemo<SheetCellState[]>(() => {
    const out: SheetCellState[] = [];
    for (const rid of visibleRows) for (const col of cols) {
      const id = sheetElementId(art, rid, col);
      if (mergeCovered.has(id)) continue;
      const raw = art.elements[id]?.value;
      const locked = !!lockedByOther(store, art.id, id, me);
      const proposed = !!proposalFor(proposals, art.id, id) || draftedFor(store, roomId, art.id, id);
      const hasEvidence = !isScaleSheet && !art.meta?.excelGrid && cellHasVisibleValue(raw) && !!asCellPayload(raw)?.evidence?.length;
      if (locked || proposed || hasEvidence) out.push({ id, lockedByOther: locked, proposed, hasEvidence });
    }
    return out;
  }, [visibleRows, cols, store, roomId, art, me, proposals, mergeCovered]);
  const overlayBoxes = useMemo(
    () => focusBoxesForSheet({ artifactId: art.id, now: Date.now(), meId: me.id, presence: presenceRows, cellStates: overlayCellStates }),
    [art.id, me.id, presenceRows, overlayCellStates],
  );
  const lockedRowIds = useMemo(() => {
    const lockedRows = new Set<string>();
    for (const rid of visibleRows) {
      for (const col of cols) {
        const id = sheetElementId(art, rid, col);
        if (!mergeCovered.has(id) && lockedByOther(store, art.id, id, me)) {
          lockedRows.add(rid);
          break;
        }
      }
    }
    return lockedRows;
  }, [visibleRows, cols, store, art, me, mergeCovered]);
  const doCommit = (id: string, s: string) => { void commit(store, roomId, me, art.id, id, s).then((f) => { if (f && !f.ok) onError?.(f); }); };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  // Column resize: drag the header's right edge; per-column widths persist per artifact (BOUND to >=60px).
  const [colOverrides, setColOverrides] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem(`noderoom:grid-cols:${art.id}`) || "{}") as Record<string, number>; } catch { return {}; }
  });
  useEffect(() => { try { localStorage.setItem(`noderoom:grid-cols:${art.id}`, JSON.stringify(colOverrides)); } catch { /* ignore */ } }, [art.id, colOverrides]);
  const startColResize = (colId: string, startWidth: number, startX: number) => {
    const onMove = (ev: PointerEvent) => setColOverrides((p) => ({ ...p, [colId]: Math.max(60, Math.round(startWidth + (ev.clientX - startX))) }));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
  };
  // Row-density preset, persisted per artifact.
  const [density, setDensity] = useState<"compact" | "default" | "comfortable">(() => {
    try { const v = localStorage.getItem(`noderoom:grid-density:${art.id}`); return v === "compact" || v === "comfortable" ? v : "default"; } catch { return "default"; }
  });
  useEffect(() => { try { localStorage.setItem(`noderoom:grid-density:${art.id}`, density); } catch { /* ignore */ } }, [art.id, density]);
  // Keyboard grammar (restores #6 after the editor refactor): arrows move the active cell, Tab moves,
  // Enter/F2 opens the editor; locked / proposed / merged cells stay read-only.
  const isEditable = (id: string | null): boolean =>
    !!id && !lockedByOther(store, art.id, id, me) && !proposalFor(proposals, art.id, id) && !draftedFor(store, roomId, art.id, id) && !mergeCovered.has(id);
  const moveSel = (dr: number, dc: number) => {
    // Scale sheets navigate over the FULL filtered list (not just the mounted window) and scroll the
    // target row into the render band; non-scale sheets navigate the paged prefix as before.
    const navRows = isScaleSheet ? filteredRows : visibleRows;
    const base = sel ? parseSheetElementId(art, sel) : { rowId: navRows[0], colId: cols[0] };
    let ri = navRows.indexOf(base.rowId); if (ri < 0) ri = 0;
    let ci = cols.indexOf(base.colId); if (ci < 0) ci = 0;
    ri = Math.min(navRows.length - 1, Math.max(0, ri + dr));
    ci = Math.min(cols.length - 1, Math.max(0, ci + dc));
    if (navRows[ri] && cols[ci]) {
      setSel(sheetElementId(art, navRows[ri], cols[ci]));
      if (isScaleSheet && sheetWrapRef.current) {
        // Keep the target within the visible band: scroll so its top/bottom edge is on-screen.
        const el = sheetWrapRef.current;
        const rowTop = ri * SCALE_SHEET_ROW_PX;
        const rowBottom = rowTop + SCALE_SHEET_ROW_PX;
        if (rowTop < el.scrollTop) el.scrollTop = rowTop;
        else if (rowBottom > el.scrollTop + el.clientHeight) el.scrollTop = rowBottom - el.clientHeight;
      }
    }
  };
  const beginEdit = (id: string) => { setEditingId(id); setEditDraft(displayCellValue(art.elements[id]?.value)); };
  // The rows that map to real <tr>s inside the window: scale sheets render the windowed slice; other
  // generic sheets render the paged prefix. The pinned focus row is rendered separately (below).
  const windowRowsToRender = isScaleSheet ? windowRows : visibleRows;
  const renderSheetRow = (rid: string, pinned = false) => (
    <tr key={pinned ? `pin-${rid}` : rid} className={(lockedRowIds.has(rid) ? "r-row-locked" : "") + (pinned ? " r-row-pinned" : "")} data-locked-row={lockedRowIds.has(rid) ? "true" : undefined} data-pinned-row={pinned ? "true" : undefined}>
      <td className={"r-rownum" + (selectedRowId === rid ? " hl" : "")} title={rid}>{sourceRowIndexById.get(rid) ?? rid}</td>
      {cols.map((col) => {
        const id = sheetElementId(art, rid, col);
        if (mergeCovered.has(id)) return null;
        const span = mergeAnchor.get(id);
        const raw = art.elements[id]?.value;
        const payload = asCellPayload(raw);
        const value = displayCellValue(raw);
        const locked = !!lockedByOther(store, art.id, id, me);
        const proposed = !!proposalFor(proposals, art.id, id) || draftedFor(store, roomId, art.id, id);
        const el = art.elements[id];
        const committed = !locked && el && el.version > 1 && el.updatedBy?.kind === "agent" && Date.now() - el.updatedAt < 1500;
        const hasVisibleEvidence = !art.meta?.excelGrid && !!value && !!payload?.evidence?.length;
        const showFormulaMarker = !art.meta?.excelGrid && !!payload?.formula;
        const showMeta = !art.meta?.excelGrid && payload;
        const showReceipt = !!showMeta && (!isScaleSheet || locked || sel === id || isGenericStatusColumn(col)) && !isGenericSourceColumn(col);
        const metaTitle = evidenceTitle(payload);
        const cls = "r-cell" + (isNumberLikeCell(raw) ? " num" : "") + (locked ? " locked" : "") + (proposed ? " proposed" : "") + (committed ? " committed rm-wet" : "") + (hasVisibleEvidence ? " evidence" : "") + (showFormulaMarker ? " formula" : "") + (sel === id ? " sel fx-sel" : "");
        return (
          <td key={col} className={cls} title={[value || undefined, dataframeCellAddress(art, cols, filteredRows, id), metaTitle || undefined].filter(Boolean).join(" | ")} data-evidence-class={classifyEvidence(payload)} data-cell-key={id} data-element-id={id} data-testid="sheet-cell" data-has-evidence={hasVisibleEvidence ? "true" : undefined} data-has-formula={payload?.formula ? "true" : undefined} colSpan={span?.colSpan} rowSpan={span?.rowSpan} aria-selected={sel === id || undefined} onClick={(e) => { setSel(id); (e.currentTarget.closest("table") as HTMLElement | null)?.focus(); }} onDoubleClick={() => { setEditingId(id); setEditDraft(value); }}>
            {editingId === id ? (
              <textarea className="r-cell-editor rm-cellin" autoFocus value={editDraft} data-testid="cell-editor"
                style={{ width: "100%", minHeight: "28px", resize: "none", overflow: "hidden" }}
                ref={(node) => { if (node) { node.style.height = "auto"; node.style.height = `${node.scrollHeight}px`; } }}
                onChange={(e) => {
                  const node = e.target;
                  node.style.height = "auto";
                  node.style.height = `${node.scrollHeight}px`;
                  setEditDraft(node.value);
                }}
                onBlur={() => { setEditingId(null); if (editDraft.trim() !== value) doCommit(id, editDraft.trim()); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } if (e.key === "Escape") { setEditDraft(value); setEditingId(null); } }} />
            ) : (
              <>
                {renderGenericCellContent(col, value)}
                {/* Stale chip: always visible (never hover-gated) when a checked source is >72h old; cells without evidence render nothing. */}
                {!art.meta?.excelGrid && <StaleChip label={cellStaleness(payload, el?.updatedAt)} />}
                {showReceipt && <EvidenceReceipt payload={payload} compact={isScaleSheet && !locked && sel !== id} checkedAt={el?.updatedAt} />}
                {locked && <span className="lockbadge fx-lock" data-testid="grid-lock-badge" title="Locked by NodeAgent"><Lock size={9} />NA</span>}
                {/* Cursor ladder — flag / stacked flags / cluster count of OTHER people on this cell
                    (design-reference/scale "Presence at scale"). Passive read, pointer-events none. */}
                <PresenceLadder rows={presenceRows} elementId={id} selfId={me.id} />
                {historyOn && proof && (
                  <CellHistory
                    roomId={roomId}
                    artifactId={art.id}
                    elementId={id}
                    requester={proof}
                    currentValue={value}
                    shifted={!!(showReceipt && payload?.evidence?.length)}
                    onFeedback={onError}
                  />
                )}
              </>
            )}
          </td>
        );
      })}
    </tr>
  );
  const toggleColumnHidden = (colId: string) => {
    setHiddenColIds((current) => {
      if (current.includes(colId)) return current.filter((id) => id !== colId);
      if (columns.length - current.length <= 1) return current;
      return [...current, colId];
    });
  };
  return (
    <>
      <div className="r-art-body">
        {/* Name-box + value bar: the A1 address + FULL value of the selected cell (recovery path for any
            clipped cell) + a row-density switcher (Excel/Sheets convention). */}
        <div className="r-sheet-bar fx-shtool">
          <span className="r-sheet-namebox" data-testid="sheet-namebox" data-has-selection={String(!!sel)}>{sel ? dataframeCellAddress(art, cols, isScaleSheet ? filteredRows : visibleRows, sel) : art.title}</span>
          <span className="r-sheet-valuebar" title={sel ? displayCellValue(art.elements[sel]?.value) : ""}>{sel ? displayCellValue(art.elements[sel]?.value) : ""}</span>
          <label className="r-sheet-search" aria-label="Search sheet rows">
            <Search size={12} />
            <input value={gridQuery} onChange={(e) => { setGridQuery(e.currentTarget.value); setPages(1); }} placeholder={gridPlaceholder} />
          </label>
          <div className="r-sheet-status-filter" role="group" aria-label="Filter by status">
            {SHEET_STATUS_FILTERS.map((status) => (
              <button key={status} type="button" data-on={String(statusFilter === status)} onClick={() => { setStatusFilter(status); setPages(1); }}>
                {status === "any" ? "Status · any" : status}
              </button>
            ))}
          </div>
          <div className="r-sheet-colmenu">
            <button type="button" className="r-sheet-colmenu-btn" aria-expanded={columnMenuOpen} onClick={() => setColumnMenuOpen((open: boolean) => !open)}>
              <Columns2 size={12} /> {cols.length}/{columns.length}
            </button>
            {columnMenuOpen && (
              <div className="r-sheet-colmenu-pop" role="menu">
                {columns.map((col) => (
                  <label key={col.id}>
                    <input type="checkbox" checked={!hiddenColSet.has(col.id)} onChange={() => toggleColumnHidden(col.id)} />
                    <span>{col.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <span className="grow" />
          <span className="r-cols-pill" data-testid="grid-column-count" title={columnCountTitle}>
            {columnCountLabel}
            {cols.length < columns.length && <ChevronDown size={10} aria-hidden="true" />}
          </span>
          <div className="r-sheet-density" role="group" aria-label="Row density">
            {([["compact", "S"], ["default", "M"], ["comfortable", "L"]] as const).map(([d, label]) => (
              <button key={d} type="button" className="r-sheet-density-btn" data-on={String(density === d)} data-testid={`grid-density-${d}`} aria-label={`${d} row density`} title={`${d} rows`} onClick={() => setDensity(d)}>{label}</button>
            ))}
          </div>
        </div>
        {isScaleSheet && (
          <div className="r-sheet-filterbar" data-testid="grid-filterbar">
            <span className="r-scale-chip" data-testid="grid-scale-count">{totalRows.toLocaleString()} rows</span>
            <span className="r-scale-chip">{cols.length} columns</span>
            <span className="r-scale-chip" data-testid="grid-render-window">{renderedWindowLabel}</span>
            <span className="grow" />
            <div className="r-filter-chipset" role="group" aria-label="Filter sheet status">
              {SHEET_STATUS_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className="r-filter-chip"
                  data-on={String(statusFilter === filter)}
                  data-testid="grid-filter-chip"
                  onClick={() => { setStatusFilter(filter); setPages(1); }}
                >
                  {sheetStatusFilterLabel(filter)} <b>{statusCounts[filter]}</b>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="r-sheet-wrap" ref={sheetWrapRef} data-testid="sheet-grid" data-scale-sheet={isScaleSheet ? "true" : undefined}>
          <AttentionOverlay boxes={overlayBoxes} resolver={overlayResolver} mode="live" />
          <table className="r-sheet fx-sheet" data-noderoom-surface="workSurface.sheet" data-sheet-kind="generic" data-density={density} data-scale-sheet={isScaleSheet ? "true" : undefined} data-artifact-id={art.id}
            tabIndex={0}
            onKeyDown={(e) => {
              if (editingId) return;
              if (e.key === "ArrowDown") { e.preventDefault(); moveSel(1, 0); }
              else if (e.key === "ArrowUp") { e.preventDefault(); moveSel(-1, 0); }
              else if (e.key === "ArrowRight") { e.preventDefault(); moveSel(0, 1); }
              else if (e.key === "ArrowLeft") { e.preventDefault(); moveSel(0, -1); }
              else if (e.key === "Tab") { e.preventDefault(); moveSel(0, e.shiftKey ? -1 : 1); }
              else if ((e.key === "Enter" || e.key === "F2") && isEditable(sel)) { e.preventDefault(); beginEdit(sel!); }
            }}>
            <colgroup>
              <col style={{ width: 44 }} />
              {visibleColumns.map((c, i) => <col key={c.id} style={{ width: colOverrides[c.id] ?? colWidths[i] }} />)}
            </colgroup>
            <thead><tr><th className="r-corner" aria-label="row number" />{visibleColumns.map((c, i) => <th key={c.id} className={selectedColId === c.id ? "hl" : undefined}>{c.label}<span className="r-col-resize" role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); startColResize(c.id, colOverrides[c.id] ?? colWidths[i], e.clientX); }} /></th>)}</tr></thead>
            <tbody>
              {/* Top spacer: stands in for the [0, start) rows NOT mounted, sized from the fixed 44px
                  row height so the scrollbar length + thumb position stay honest. Scale sheets only. */}
              {isScaleSheet && rowWindow.topPad > 0 && (
                <tr className="r-vrow-spacer" aria-hidden="true" data-testid="grid-spacer-top" style={{ height: rowWindow.topPad }}>
                  <td className="r-rownum" style={{ height: rowWindow.topPad, padding: 0 }} />
                  <td colSpan={Math.max(cols.length, 1)} style={{ height: rowWindow.topPad, padding: 0 }} />
                </tr>
              )}
              {windowRowsToRender.map((rid) => renderSheetRow(rid))}
              {/* Pinned focus row: the selected row stays mounted even when scrolled outside the
                  window (agent/QA focus must never unmount mid-interaction). */}
              {pinnedFocusRow && renderSheetRow(pinnedFocusRow, true)}
              {/* Bottom spacer: stands in for the [end, totalRows) rows NOT mounted. */}
              {isScaleSheet && rowWindow.bottomPad > 0 && (
                <tr className="r-vrow-spacer" aria-hidden="true" data-testid="grid-spacer-bottom" style={{ height: rowWindow.bottomPad }}>
                  <td className="r-rownum" style={{ height: rowWindow.bottomPad, padding: 0 }} />
                  <td colSpan={Math.max(cols.length, 1)} style={{ height: rowWindow.bottomPad, padding: 0 }} />
                </tr>
              )}
              <tr className="r-row-add">
                <td className="r-rownum">{isScaleSheet ? totalRows + 1 : visibleRows.length + 1}</td>
                <td className="r-add-row-cell" colSpan={Math.max(cols.length, 1)}><span data-testid="grid-add-row">+ add row</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="r-sheet-foot fx-shfoot">
        <span className="r-dataframe-badge">
          <Package size={12} aria-hidden="true" />
          <span>
            <span className="kicker">{sheetKicker}</span>
            <span className="r-vpill next">v{art.version}</span>
          </span>
        </span>
        {/* Scale sheets scroll-virtualize (no paging button); other generic sheets keep the page button. */}
        {!isScaleSheet && visibleRows.length < filteredRows.length && <button className="r-mini-btn" onClick={() => setPages((n) => n + 1)}>Show next {pageSize}</button>}
        <span className="grow" />
        <span className="mono tiny faint">
          {totalRows.toLocaleString()} rows · {footerColumnLabel} · double-click a cell to edit
        </span>
      </div>
    </>
  );
}

function filterGenericSheetRows(
  art: Art,
  rows: string[],
  cols: string[],
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  return rows.filter((rowId) => {
    if (q) {
      const haystack = [rowId, ...cols.map((col) => displayCellValue(art.elements[sheetElementId(art, rowId, col)]?.value))].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

function columnsOf(art: Art): DataframeColumn[] {
  const metaCols = art.meta?.dataframe?.columns;
  if (Array.isArray(metaCols) && metaCols.length) {
    return [...metaCols]
      .filter((c) => c && typeof c.id === "string")
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((c) => ({ ...c, label: c.label ?? prettyCol(c.id) }));
  }
  return colsOf(art).map((id, order) => ({ id, label: prettyCol(id), order }));
}

function asCellPayload(value: unknown): CellPayload | null {
  if (!value || typeof value !== "object" || !("value" in value)) return null;
  return value as CellPayload;
}

function unwrapDisplayCellValue(value: unknown, depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 4) return value;
  const record = value as Record<string, unknown>;
  if ("value" in record) {
    const next = record.value;
    if (next === null || next === undefined) return "formula" in record ? record.formula : next;
    return unwrapDisplayCellValue(next, depth + 1);
  }
  return value;
}

export function displayCellValue(value: unknown): string {
  const raw = unwrapDisplayCellValue(value);
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

/**
 * Coerce a sheet element's `value` into a typed Excel cell value. The room engine stores cells as
 * either a raw scalar OR a `CellPayload` whose `.value` is the scalar; we unwrap once then preserve
 * the underlying JS type so exceljs writes a number as a number (not a string), which is what the
 * downstream SpreadsheetBench scorer + reopen flow depend on.
 */
function exportCellValue(value: unknown): string | number | boolean | null {
  const payload = asCellPayload(value);
  const raw = payload ? payload.value : value;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return null;
    // Numeric strings the cheap-route agent commonly writes ("25", "3.5", "44") — keep as number so
    // the reopened workbook grades on numeric value, not text. Leave anything non-numeric (units,
    // labels, citations) as the original string.
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      const n = Number(trimmed);
      if (Number.isFinite(n)) return n;
    }
    return raw;
  }
  return String(raw);
}

/** Filesystem-safe filename derived from an artifact title (used by the Export XLSX download). */
function sanitizeFilename(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned || "workbook";
}

/**
 * Build a real .xlsx (Office-magic-bytes, exceljs) from the sheet artifact in scope and trigger a
 * browser download. Walks `art.order` for row ids and the column suffix derived from each element
 * id (same path bankerCoachPacket.ts uses) — no separate Convex fetch. The "Q3 variance" canonical
 * sheet has a fixed column shape (Account · Q2 · Q3 · Variance · Note); every other sheet uses the
 * scanned columns in `art.order`-encounter order with Excel column letters (A, B, C...). Triggered
 * by the toolbar button (data-testid="artifact-export-xlsx") that is gated to the live sheet
 * surfaces, including uploaded workbooks now rendered through the shared Sheet 1 grid.
 *
 * TODO(mobile-export): the mobile #mobile route currently has a Download XLSX button that emits a
 * fake toast (flagged by R31). Wire it to this same path (extract into a shared helper) in a
 * follow-up PR; out of scope here.
 */
async function exportSheetAsXlsx(art: Art, visibleRoot?: HTMLElement | null, allArts: Art[] = [art]): Promise<void> {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = (ExcelJSModule as { default?: typeof import("exceljs") }).default ?? (ExcelJSModule as unknown as typeof import("exceljs"));
  const workbook = new ExcelJS.Workbook();
  const exportSheets = workbookExportSheets(art, allArts);
  const usedSheetNames = new Set<string>();
  const sheetName = worksheetNameForExport(art, usedSheetNames);
  const worksheet = workbook.addWorksheet(sheetName);
  const rows = rowIdsOf(art);
  const visibleCells = visibleRoot ? visibleGenericSheetCellValues(visibleRoot, art.id) : new Map<string, string>();
  const cellForExport = (id: string) => {
    const visible = visibleCells.get(id);
    return exportCellValue(visible !== undefined ? visible : art.elements[id]?.value);
  };

  if (art.title === "Q3 variance") {
    // Canonical variance sheet: stable headers matching the live Sheet renderer (Artifact.tsx Sheet).
    worksheet.addRow(["Account", "Q2", "Q3", "Variance", "Note"]);
    for (const rid of rows) {
      worksheet.addRow([
        exportCellValue(art.elements[`${rid}__account`]?.value),
        exportCellValue(art.elements[`${rid}__q2`]?.value),
        exportCellValue(art.elements[`${rid}__q3`]?.value),
        exportCellValue(art.elements[`${rid}__variance`]?.value),
        exportCellValue(art.elements[`${rid}__note`]?.value),
      ]);
    }
  } else {
    // Generic / blank/uploaded sheet: use the same visible columns as the shared sheet grid.
    // Blank/agent sheets store r<row>__A; uploaded workbooks store A1/B2/etc.
    const cols = columnsOf(art).map((c) => c.id);
    // Single-letter column ids ("A", "B", ...) are written to their literal Excel column; multi-char
    // column ids (legacy headers) get a labeled header row and sequential Excel columns.
    const isLetterCols = cols.length > 0 && cols.every((c) => /^[A-Z]+$/.test(c));
    if (isLetterCols) {
      for (const rid of rows) {
        const rowNum = parseInt(rid.replace(/^r/, ""), 10);
        if (!Number.isFinite(rowNum) || rowNum <= 0) continue;
        for (const col of cols) {
          const v = cellForExport(sheetElementId(art, rid, col));
          if (v !== null) worksheet.getCell(`${col}${rowNum}`).value = v;
        }
      }
    } else {
      worksheet.addRow(cols.map((c) => prettyCol(c)));
      for (const rid of rows) {
        worksheet.addRow(cols.map((col) => cellForExport(sheetElementId(art, rid, col))));
      }
    }
  }

  for (const sibling of exportSheets) {
    if (sibling.id === art.id) continue;
    appendSheetArtifactWorksheet(workbook, sibling, usedSheetNames);
  }

  // writeBuffer() returns an exceljs.Buffer (Uint8Array-compatible); Blob accepts both. NEVER call
  // workbook.xlsx.writeFile here — that is Node-only and would crash in the browser.
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${sanitizeFilename(exportWorkbookBaseName(art, exportSheets))}.xlsx`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Free the object URL on the next tick so Chrome/Firefox have finished the download negotiation.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function workbookExportSheets(active: Art, allArts: Art[]): Art[] {
  const sourceFile = active.meta?.upload?.fileName;
  const sheetNames = active.meta?.excelGrid?.sheetNames;
  if (!sourceFile || !Array.isArray(sheetNames) || sheetNames.length <= 1) return [active];

  const siblings = allArts.filter((candidate) =>
    candidate.kind === "sheet"
    && candidate.meta?.upload?.fileName === sourceFile
    && candidate.meta?.excelGrid?.sheetName,
  );
  const byName = new Map(siblings.map((candidate) => [candidate.meta?.excelGrid?.sheetName, candidate]));
  const ordered = sheetNames.map((name) => byName.get(name)).filter((candidate): candidate is Art => !!candidate);
  return ordered.some((candidate) => candidate.id === active.id) ? ordered : [active];
}

function exportWorkbookBaseName(active: Art, sheets: Art[]): string {
  if (sheets.length > 1 && active.meta?.upload?.fileName) {
    return active.meta.upload.fileName.replace(/\.(xlsx|xlsm|xls)$/i, "");
  }
  return active.title || "workbook";
}

function worksheetNameForExport(art: Art, used: Set<string>): string {
  const raw = (art.meta?.excelGrid?.sheetName || art.title || "Sheet1").replace(/[\[\]:*?/\\]/g, "_").trim() || "Sheet1";
  const base = raw.slice(0, 31);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) {
    const tag = `_${suffix++}`;
    candidate = `${base.slice(0, Math.max(1, 31 - tag.length))}${tag}`;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function appendSheetArtifactWorksheet(
  workbook: import("exceljs").Workbook,
  art: Art,
  usedSheetNames: Set<string>,
): void {
  const worksheet = workbook.addWorksheet(worksheetNameForExport(art, usedSheetNames));
  const rows = rowIdsOf(art);

  if (art.title === "Q3 variance") {
    worksheet.addRow(["Account", "Q2", "Q3", "Variance", "Note"]);
    for (const rid of rows) {
      worksheet.addRow([
        exportCellValue(art.elements[`${rid}__account`]?.value),
        exportCellValue(art.elements[`${rid}__q2`]?.value),
        exportCellValue(art.elements[`${rid}__q3`]?.value),
        exportCellValue(art.elements[`${rid}__variance`]?.value),
        exportCellValue(art.elements[`${rid}__note`]?.value),
      ]);
    }
    return;
  }

  const cols = columnsOf(art).map((c) => c.id);
  const isLetterCols = cols.length > 0 && cols.every((c) => /^[A-Z]+$/.test(c));
  if (isLetterCols) {
    for (const rid of rows) {
      const rowNum = parseInt(rid.replace(/^r/, ""), 10);
      if (!Number.isFinite(rowNum) || rowNum <= 0) continue;
      for (const col of cols) {
        const value = exportCellValue(art.elements[sheetElementId(art, rid, col)]?.value);
        if (value !== null) worksheet.getCell(`${col}${rowNum}`).value = value;
      }
    }
    return;
  }

  worksheet.addRow(cols.map((c) => prettyCol(c)));
  for (const rid of rows) {
    worksheet.addRow(cols.map((col) => exportCellValue(art.elements[sheetElementId(art, rid, col)]?.value)));
  }
}

function visibleGenericSheetCellValues(root: HTMLElement, artifactId: string): Map<string, string> {
  const out = new Map<string, string>();
  root.querySelectorAll<HTMLElement>('table[data-sheet-kind="generic"] [data-element-id]').forEach((cell) => {
    const table = cell.closest<HTMLElement>("table[data-artifact-id]");
    if (table?.getAttribute("data-artifact-id") !== artifactId) return;
    const elementId = cell.getAttribute("data-element-id");
    const text = cell.querySelector<HTMLElement>(".r-cell-value")?.textContent?.trim();
    if (elementId && text) out.set(elementId, text);
  });
  return out;
}

function prettyCol(col: string) {
  return col.replace(/_/g, " ");
}

function Sheet({ roomId, me, art, proof, onError }: { roomId: string; me: Actor; art: Art; proof?: ActorProof; onError: (f: EditFeedback) => void }) {
  const store = useStore();
  const historyOn = cellHistoryEnabled(store.mode, proof);
  const rows = rowIdsOf(art);
  const now = Date.now();
  const proposals = store.listProposals(roomId).filter((p) => p.artifactId === art.id);
  const presenceRows = store.listPresence(roomId, art.id);
  const selfPresenceColor = memberColor(store, roomId, me);
  const sheetWrapRef = useRef<HTMLDivElement>(null);
  const overlayResolver = useMemo(() => createSpreadsheetResolver(() => sheetWrapRef.current), []);
  const overlayCellStates = useMemo<SheetCellState[]>(() => {
    const out: SheetCellState[] = [];
    for (const rid of rows) for (const id of [`${rid}__variance`, `${rid}__note`]) {
      const locked = !!lockedByOther(store, art.id, id, me);
      const proposed = !!proposalFor(proposals, art.id, id) || draftedFor(store, roomId, art.id, id);
      const hasEvidence = !!asCellPayload(art.elements[id]?.value)?.evidence?.length;
      if (locked || proposed || hasEvidence) out.push({ id, lockedByOther: locked, proposed, hasEvidence });
    }
    return out;
  }, [rows, store, roomId, art, me, proposals]);
  const overlayBoxes = useMemo(
    () => focusBoxesForSheet({ artifactId: art.id, now: Date.now(), meId: me.id, presence: presenceRows, cellStates: overlayCellStates }),
    [art.id, me.id, presenceRows, overlayCellStates],
  );
  const doCommit = (id: string, s: string) => { void commit(store, roomId, me, art.id, id, s).then((f) => { if (f && !f.ok) onError(f); }); };
  const doUndo = () => { void store.undoLastEdit(roomId, me).then((f) => { if (!f.ok) onError(f); }); };
  return (
    <>
      <div className="r-art-body">
        <div className="r-sheet-wrap" ref={sheetWrapRef}>
          <AttentionOverlay boxes={overlayBoxes} resolver={overlayResolver} mode="live" />
          <table className="r-sheet fx-sheet" data-noderoom-surface="workSurface.sheet" data-artifact-id={art.id}>
            <thead><tr><th className="r-corner" aria-label="row number" /><th>Account</th><th className="num">Q2</th><th className="num">Q3</th><th className="num">Variance</th><th>Note</th></tr></thead>
            <tbody>
              {rows.map((rid, i) => {
                const vId = `${rid}__variance`, nId = `${rid}__note`;
                const vEl = art.elements[vId], nEl = art.elements[nId];
                const vPayload = asCellPayload(vEl?.value), nPayload = asCellPayload(nEl?.value);
                const lk = lockedByOther(store, art.id, vId, me);
                const vPresence = presenceForCell(presenceRows, vId, me);
                const nPresence = presenceForCell(presenceRows, nId, me);
                const drafting = draftedFor(store, roomId, art.id, vId);
                const vProposal = proposalFor(proposals, art.id, vId);
                const nProposal = proposalFor(proposals, art.id, nId);
                const committed = !lk && vEl && vEl.version > 1 && now - vEl.updatedAt < 1500;
                const personalEditor = vEl?.updatedBy && (vEl.updatedBy as Actor).ownerId ? store.listMembers(roomId).find((mm) => mm.id === (vEl.updatedBy as Actor).ownerId) : undefined;
                const vCls = "r-cell num" + (lk ? " locked" : "") + (vPresence ? ` presence presence-${vPresence.mode}` : "") + (drafting ? " draft" : "") + (committed ? " committed rm-wet" : "") + (vProposal ? " proposed" : "");
                return (
                  <tr key={rid}>
                    <td className="r-rownum" title={rid}>{i + 1}</td>
                    <td className="label">{cellVal(art, rid, "label")}</td>
                    <td className="num"><span className="r-val-num">{cellVal(art, rid, "q2")}</span></td>
                    <td className="num"><span className="r-val-num">{cellVal(art, rid, "q3")}</span></td>
                    <td className={vCls} style={presenceStyle(vPresence)} data-cell-key={vId} data-element-id={vId} data-evidence-class={classifyEvidence(vPayload)} data-testid="sheet-cell" data-presence-mode={vPresence?.mode} onClick={() => touchPresence(store, roomId, art.id, me, vId, "focus", selfPresenceColor)}>
                      <EditableCell key={vId + ":" + (vEl?.version ?? 0)} value={displayCellValue(vEl?.value)} disabled={!!lk || drafting || !!vProposal} align="right" onEditStart={() => touchPresence(store, roomId, art.id, me, vId, "edit", selfPresenceColor)} onEditEnd={() => store.clearPresence({ roomId, artifactId: art.id, targetKind: "cell", targetId: vId, mode: "edit", actor: me })} onCommit={(s) => doCommit(vId, s)} />
                      <StaleChip label={cellStaleness(vPayload, vEl?.updatedAt)} />
                      {!lk && <EvidenceReceipt payload={vPayload} checkedAt={vEl?.updatedAt} />}
                      {lk && <span className="lockbadge fx-lock"><Lock size={9} /> NA</span>}
                      {drafting && <span className="lockbadge"><Pencil size={9} /> draft</span>}
                      {historyOn && proof && !lk && (
                        <CellHistory roomId={roomId} artifactId={art.id} elementId={vId} requester={proof} currentValue={displayCellValue(vEl?.value)} shifted={!!vPayload?.evidence?.length} onFeedback={onError} />
                      )}
                      {vProposal && <InlineProposal roomId={roomId} me={me} proposal={vProposal} onResolved={(f) => { if (!f.ok) onError(f); }} />}
                      {personalEditor && <span className="r-prov-dot" style={{ background: personalEditor.color }} title={`edited by ${personalEditor.name}'s agent`} />}
                      {vPresence && <span className="presencebadge" data-testid="presence-flag">{presenceLabel(vPresence)}</span>}
                    </td>
                    <td className={"r-cell" + (nPresence ? ` presence presence-${nPresence.mode}` : "") + (nProposal ? " proposed" : "")} style={presenceStyle(nPresence)} data-cell-key={nId} data-element-id={nId} data-evidence-class={classifyEvidence(nPayload)} data-testid="sheet-cell" data-presence-mode={nPresence?.mode} onClick={() => touchPresence(store, roomId, art.id, me, nId, "focus", selfPresenceColor)}>
                      <EditableCell key={nId + ":" + (nEl?.version ?? 0)} value={displayCellValue(nEl?.value)} disabled={!!lk || !!nProposal} addLabel="note" onEditStart={() => touchPresence(store, roomId, art.id, me, nId, "edit", selfPresenceColor)} onEditEnd={() => store.clearPresence({ roomId, artifactId: art.id, targetKind: "cell", targetId: nId, mode: "edit", actor: me })} onCommit={(s) => doCommit(nId, s)} />
                      <StaleChip label={cellStaleness(nPayload, nEl?.updatedAt)} />
                      <EvidenceReceipt payload={nPayload} checkedAt={nEl?.updatedAt} />
                      {historyOn && proof && (
                        <CellHistory roomId={roomId} artifactId={art.id} elementId={nId} requester={proof} currentValue={displayCellValue(nEl?.value)} shifted={!!nPayload?.evidence?.length} onFeedback={onError} />
                      )}
                      {nProposal && <InlineProposal roomId={roomId} me={me} proposal={nProposal} onResolved={(f) => { if (!f.ok) onError(f); }} />}
                      {nPresence && <span className="presencebadge" data-testid="presence-flag">{presenceLabel(nPresence)}</span>}
                    </td>
                  </tr>
                );
              })}
              {Array.from({ length: Math.max(0, 24 - rows.length) }, (_, k) => (
                <tr key={`fill${k}`} className="r-row-empty" aria-hidden="true">
                  <td className="r-rownum">{rows.length + k + 1}</td>
                  {Array.from({ length: 5 }, (_, c) => <td key={c} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="r-sheet-foot fx-shfoot">
        <span className="r-dataframe-badge">
          <Package size={12} aria-hidden="true" />
          <span>
            <span className="kicker">versionedSpreadsheetSync</span>
            <span className="r-vpill next">v{art.version}</span>
          </span>
        </span>
        <button className="r-mini-btn" disabled={!store.canUndo(roomId)} title="Undo last applied room edit (Ctrl+Z)" onClick={doUndo}><Undo2 size={12} /> Undo</button>
        <span className="grow" />
        <span className="mono tiny faint">click a Variance or Note cell to edit by hand</span>
      </div>
    </>
  );
}

function proposalFor(proposals: Proposal[], artifactId: string, elementId: string): Proposal | undefined {
  return proposals.find((p) => p.artifactId === artifactId && p.status === "pending" && p.op.elementId === elementId);
}

function isSemanticProposal(proposal: Proposal): boolean {
  return proposal.review?.kind === "semantic_rebase";
}

function proposalValue(value: unknown): string {
  return String(value ?? "");
}

function InlineProposal({ roomId, me, proposal, onResolved }: { roomId: string; me: Actor; proposal: Proposal; onResolved: (fb: EditFeedback) => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const host = store.listMembers(roomId).some((m) => m.id === me.id && m.role === "host");
  const semantic = isSemanticProposal(proposal);
  const value = proposalValue(proposal.op.value);
  const reason = proposal.review?.reviewerNote ?? proposal.review?.reason;
  const decide = async (approve: boolean) => {
    setBusy(true);
    try { onResolved(await store.resolveProposal(proposal.id, approve, me)); }
    finally { setBusy(false); }
  };
  return (
    <div className="r-inline-proposal" data-testid="proposal-inline" data-semantic={String(semantic)} title={reason}>
      {semantic && <span className="r-inline-proposal-kind">Rebase</span>}
      <span className="r-inline-proposal-text" title={`${proposal.author.name} proposed ${value}`}>{value}</span>
      {host ? (
        <span className="r-inline-proposal-actions">
          {/* ✓ accept / ✗ reject — never ban-circle (reads "forbidden", and Ban already means
              lock_denied in the trace icons). Neutral at rest; semantic tints on hover. */}
          <button className="r-icon-btn accept" data-testid="proposal-inline-approve" aria-label={`Accept suggestion for ${proposal.op.elementId}`} title="Accept suggestion" disabled={busy} onClick={() => void decide(true)}><Check size={12} /></button>
          <button className="r-icon-btn reject" data-testid="proposal-inline-reject" aria-label={`Reject suggestion for ${proposal.op.elementId}`} title="Reject suggestion" disabled={busy} onClick={() => void decide(false)}><X size={12} /></button>
        </span>
      ) : <span className="r-inline-awaiting">host</span>}
    </div>
  );
}

/** Native notebook editor mode. When `VITE_NOTEBOOK_SYNC=prosemirror` (and a live
 *  Convex URL is configured), the Note component renders the collaborative
 *  ProseMirror Sync editor; otherwise the legacy Tiptap HTML-on-blur editor. */
const NOTEBOOK_SYNC_ENABLED = import.meta.env.VITE_NOTEBOOK_SYNC === "prosemirror";

/* ── THE NOTEBOOK IS PAPER (design-reference/notebook) ─────────────────────
   The note surface renders ink-on-neutral paper inside .nbk-frame even on the
   dark shell (notebook-paper.css re-pins the light tokens). Shipped
   semantics map onto the design language:
     attrs.authorKind="agent"      → .nbk-agent ink + terracotta margin dot
     attrs.status="needs_review"   → .nbk-review chip (amber = needs review)
     agent evidence links (http/s) → .nbk-sup citation superscripts + a
                                     .nb-footnote list at doc end (cap 12)
   Agent ink and citations are PM DECORATIONS — presentation-only DOM that
   never mutates notebook content, so provenance stays in the data. */

export const NOTEBOOK_FOOTNOTE_CAP = 12; // BOUND: agent loops can stack links; cite 12, list 12
const NOTEBOOK_WET_MAX = 40; // BOUND: a full-doc agent rewrite wets at most 40 blocks
const NOTEBOOK_FOOTNOTE_TITLE_MAX = 120;

export type NotebookFootnote = { n: number; href: string; host: string; title: string };

function citationHost(href: string): string | null {
  try {
    return new URL(href).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Citations = links with a REAL http(s) evidence url inside agent-authored
 *  blocks, in document order, deduped by url, capped. Human-authored links and
 *  hostile schemes (javascript:, data:) are never citations — a superscript is
 *  only ever minted from an evidence url that exists, never fabricated. */
export function notebookCitationModel(html: string, cap = NOTEBOOK_FOOTNOTE_CAP): NotebookFootnote[] {
  if (!html || typeof DOMParser === "undefined") return [];
  const body = new DOMParser().parseFromString(html, "text/html").body;
  const out: NotebookFootnote[] = [];
  const seen = new Set<string>();
  for (const a of Array.from(body.querySelectorAll("a[href]"))) {
    if (!a.closest('[data-author-kind="agent"]')) continue;
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
    const host = citationHost(href);
    if (!host) continue;
    if (seen.size >= cap) break;
    seen.add(href);
    const title = (a.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, NOTEBOOK_FOOTNOTE_TITLE_MAX) || host;
    out.push({ n: out.length + 1, href, host, title });
  }
  return out;
}

/** Main-doc citations then agent-notes citations, renumbered 1..N under the
 *  global cap — matches the per-editor superscript numbering (agent-notes
 *  editors start at the main doc's offset). */
export function combinedNotebookFootnotes(docHtml: string, agentHtml: string): NotebookFootnote[] {
  return [...notebookCitationModel(docHtml), ...notebookCitationModel(agentHtml)]
    .slice(0, NOTEBOOK_FOOTNOTE_CAP)
    .map((c, i) => ({ ...c, n: i + 1 }));
}

/** Doc-head meta for the .nbk-bar chips: block count + needs-review count.
 *  Nested identity (li > p both carry data-blockid) counts once. */
export function notebookPaperMeta(...htmls: Array<string | undefined>): { blocks: number; needsReview: number } {
  let blocks = 0;
  let needsReview = 0;
  if (typeof DOMParser === "undefined") return { blocks, needsReview };
  for (const html of htmls) {
    if (!html) continue;
    const body = new DOMParser().parseFromString(html, "text/html").body;
    const withIds = Array.from(body.querySelectorAll("[data-blockid]"))
      .filter((el) => !el.parentElement?.closest("[data-blockid]")).length;
    blocks += withIds > 0 ? withIds : body.querySelectorAll("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre").length;
    needsReview += Array.from(body.querySelectorAll('[data-status="needs_review"]'))
      .filter((el) => !el.parentElement?.closest('[data-status="needs_review"]')).length;
  }
  return { blocks, needsReview };
}

export function blockTextsFromDom(root: ParentNode): Map<string, string> {
  const map = new Map<string, string>();
  for (const el of Array.from(root.querySelectorAll("[data-blockid]"))) {
    const id = el.getAttribute("data-blockid");
    if (id && !map.has(id)) map.set(id, (el.textContent ?? "").slice(0, 2_000));
  }
  return map;
}

export function blockTextsFromHtml(html: string): Map<string, string> {
  if (!html || typeof DOMParser === "undefined") return new Map();
  return blockTextsFromDom(new DOMParser().parseFromString(html, "text/html").body);
}

/** Which blocks did a remote/agent write change? First snapshot (prev=null)
 *  wets nothing — a freshly opened doc is dry ink, not news. */
export function diffWetBlockIds(prev: Map<string, string> | null, next: Map<string, string>): string[] {
  if (!prev) return [];
  const wet: string[] = [];
  for (const [id, text] of next) {
    if (prev.get(id) !== text) {
      wet.push(id);
      if (wet.length >= NOTEBOOK_WET_MAX) break;
    }
  }
  return wet;
}

/** One-shot wet ink: .nbk-wet on the changed [data-blockid] nodes for one
 *  animation (the CSS is prefers-reduced-motion-guarded); class removal on
 *  animationend + a timeout fallback leaves PM's DOM clean afterwards. */
function escapeBlockIdSelector(id: string): string {
  // CSS.escape is absent in some DOM shims (jsdom); block ids are uuids, so a
  // conservative quote/backslash escape keeps the attribute selector valid.
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(id)
    : id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function applyWetInk(root: HTMLElement, ids: string[]): void {
  for (const id of ids) {
    root.querySelectorAll(`[data-blockid="${escapeBlockIdSelector(id)}"]`).forEach((el) => {
      el.classList.remove("nbk-wet");
      const clear = () => el.classList.remove("nbk-wet");
      el.classList.add("nbk-wet");
      el.addEventListener("animationend", clear, { once: true });
      window.setTimeout(clear, 1_200);
    });
  }
}

function citationSupDom(n: number): HTMLElement {
  const sup = document.createElement("sup");
  sup.className = "nbk-sup";
  sup.setAttribute("data-nbk-cite", String(n));
  sup.textContent = String(n);
  return sup;
}

/** PM decorations for the paper ink: .nbk-agent on agent-authored blocks,
 *  .nbk-review on needs_review blocks, .nbk-sup citation widgets after agent
 *  evidence links. Recomputed per state (notebook docs are small; one O(doc)
 *  walk); decorations never enter the document or the sync lane. */
function paperDecorations(doc: PmDocNode, offset: number, max: number): DecorationSet {
  const decos: Decoration[] = [];
  const agentRanges: Array<[number, number]> = [];
  doc.descendants((node, pos) => {
    if (node.isText) return;
    if (node.attrs?.authorKind === "agent") {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "nbk-agent" }));
      agentRanges.push([pos, pos + node.nodeSize]);
    }
    if (node.attrs?.status === "needs_review") {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { class: "nbk-review" }));
    }
  });
  const seen = new Map<string, number>();
  let lastEnd = -1;
  let lastHref = "";
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const link = node.marks.find((m) => m.type.name === "link");
    const href = typeof link?.attrs?.href === "string" ? link.attrs.href : "";
    const start = pos;
    const end = pos + node.nodeSize;
    if (!href || !/^https?:\/\//i.test(href) || !citationHost(href) || !agentRanges.some(([a, b]) => start >= a && end <= b)) {
      lastHref = "";
      return;
    }
    if (start === lastEnd && href === lastHref) {
      // contiguous text runs of the same link = ONE citation site at the run end
      const n = seen.get(href)!;
      decos.pop();
      decos.push(Decoration.widget(end, () => citationSupDom(n), { side: 1 }));
      lastEnd = end;
      return;
    }
    let n = seen.get(href);
    if (n === undefined) {
      if (seen.size >= max) {
        lastHref = "";
        return;
      }
      n = offset + seen.size + 1;
      seen.set(href, n);
    }
    const num = n;
    decos.push(Decoration.widget(end, () => citationSupDom(num), { side: 1 }));
    lastEnd = end;
    lastHref = href;
  });
  return DecorationSet.create(doc, decos);
}

const notebookPaperInkKey = new PluginKey("notebookPaperInk");

/** Client-only presentation extension appended AFTER the shared schema — the
 *  schema (src/notebook/extensions.ts) stays byte-identical for the server. */
export function createNotebookPaperInk(offset = 0, max = NOTEBOOK_FOOTNOTE_CAP) {
  return Extension.create({
    name: "notebookPaperInk",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: notebookPaperInkKey,
          props: { decorations: (state) => paperDecorations(state.doc, offset, Math.max(0, max)) },
        }),
      ];
    },
  });
}

const NOTEBOOK_PAPER_INK = createNotebookPaperInk();

/** The paper frame: neutral paper sheet + .nbk-bar top chrome (room mark, artifact
 *  title, block/needs-review meta chips) with an optional quiet paper footer.
 *  Both notebook editors (synced and legacy) render inside it — no flag. */
export function NotebookPaperFrame({ title, meta, children, footer }: {
  title: string;
  meta: { blocks: number; needsReview: number };
  children: ReactNode;
  footer?: ReactNode;
  referenceChrome?: boolean;
}) {
  const referenceChrome = title === "Capture Notebook";
  return (
    <div className="nbk-frame" data-testid="notebook-paper-frame">
      <div className="nbk-bar">
        <span className="nbk-mark" aria-hidden>N</span>
        <span className="nbk-bar-title">{referenceChrome ? "Q3 Diligence · Notebook" : title}</span>
        <span className="grow" />
        {referenceChrome ? (
          <span className="nbk-chip nbk-saved"><span className="nbk-save-dot" aria-hidden />Saved · v12</span>
        ) : (
          <>
            <span className="nbk-chip" data-testid="nbk-meta-blocks"><b>{meta.blocks}</b> {meta.blocks === 1 ? "block" : "blocks"}</span>
            {meta.needsReview > 0 && (
              <span className="nbk-st needs_review" data-testid="nbk-meta-review">{meta.needsReview} needs_review</span>
            )}
          </>
        )}
      </div>
      <div className="nbk-body">{children}</div>
      {footer && <div className="nbk-foot">{footer}</div>}
    </div>
  );
}

/** Footnote list at doc end — one row per citation superscript, same numbering. */
export function NotebookFootnotes({ notes }: { notes: NotebookFootnote[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="nb-footnotes" data-testid="notebook-footnotes">
      {notes.map((f) => (
        <div className="nb-footnote" data-testid="notebook-footnote" key={`${f.n}:${f.href}`}>
          <span className="n">{f.n}</span>
          <a className="t" href={f.href} target="_blank" rel="noreferrer">{f.title}</a>
          <span className="m">{f.host}</span>
        </div>
      ))}
    </div>
  );
}

function agentNotesHtml(art: Art): string {
  const value = art.elements["doc:agent"]?.value;
  return typeof value === "string" ? value : "";
}

/** Collaborative notebook editor backed by Convex ProseMirror Sync. Lazily
 *  migrates a legacy `note` artifact's "doc" element to a synced doc on first
 *  open. The component owns live multiplayer text; the client blur commit is the
 *  single activity source (-> applyCellEdit -> enqueueRoomActivity), identical to
 *  the legacy Note path. Proposal-first: agents never write here.
 *
 *  Two-phase render so `useTiptapSync` only subscribes once the real (random
 *  capability-secret) doc id is known via the requester-gated getNotebookDoc —
 *  never a guessed/placeholder id. */
export function SyncedNote({ roomId, me, proof, art }: { roomId: string; me: Actor; proof: ActorProof; art: Art }) {
  const docValue = art.elements["doc"]?.value;
  if (isUploadedFileDoc(docValue)) return <FileViewer roomId={roomId} me={me} proof={proof} art={art} doc={docValue} />;
  const store = useStore();
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [dirtyStatus, setDirtyStatus] = useState<"idle" | "queued" | "processed">("idle");
  const dirtyTimer = useRef<number | null>(null);
  const existing = useQuery(api.prosemirror.getNotebookDoc, { roomId: roomId as never, artifactId: art.id as never, requester: proof });
  const blocks = useQuery(api.notebookProcessing.listNotebookBlocks, existing ? { roomId: roomId as never, artifactId: art.id as never, requester: proof, limit: 12 } : "skip") ?? [];
  const plans = useQuery(api.agentArtifacts.listAgentArtifacts, existing ? { roomId: roomId as never, requester: proof, kind: "agent_work_plan", limit: 12 } : "skip") ?? [];
  const ensureDoc = useMutation(api.prosemirror.ensureNotebookDoc);
  const markDirty = useMutation(api.notebookProcessing.markNotebookDirty);
  const createPlan = useMutation(api.agentArtifacts.createAgentWorkPlanFromNotebook);
  const approvePlan = useMutation(api.agentArtifacts.approveAgentWorkPlan);
  const ensuredRef = useRef(false);
  // Paper-frame meta + citations: the inner editor lifts its HTML on create/update
  // (state only changes when the HTML actually changed, so typing stays cheap).
  const [docHtml, setDocHtml] = useState("");
  const agentHtml = agentNotesHtml(art);
  const paperMeta = useMemo(() => notebookPaperMeta(docHtml, agentHtml), [docHtml, agentHtml]);
  const docCitations = useMemo(() => notebookCitationModel(docHtml), [docHtml]);
  const footnotes = useMemo(() => combinedNotebookFootnotes(docHtml, agentHtml), [docHtml, agentHtml]);
  const scopedPlans = (plans as AgentWorkPlanRow[]).filter((plan) => String(plan.artifactId ?? "") === art.id);
  const queueDirty = (changedRangeHint = "doc:idle") => {
    if (dirtyTimer.current !== null) window.clearTimeout(dirtyTimer.current);
    dirtyTimer.current = window.setTimeout(() => {
      setDirtyStatus("queued");
      void markDirty({
        roomId: roomId as never,
        artifactId: art.id as never,
        requester: proof,
        changedRangeHint,
        processingLane: "passive",
        quietMs: 2_000,
      })
        .then(() => setNoteErr(null))
        .catch((e: unknown) => setNoteErr(`Notebook indexing failed: ${String(e).slice(0, 140)}`));
    }, changedRangeHint === "doc:blur" ? 80 : 1_200);
  };
  useEffect(() => () => { if (dirtyTimer.current !== null) window.clearTimeout(dirtyTimer.current); }, []);
  useEffect(() => {
    if ((blocks as unknown[]).length > 0) setDirtyStatus("processed");
  }, [(blocks as unknown[]).length]);

  // Lazy migration: if the registry row is absent, create the synced doc once.
  // existing === null means "loaded, no row yet"; undefined means still loading.
  useEffect(() => {
    if (ensuredRef.current || existing === undefined || existing !== null) return;
    ensuredRef.current = true;
    void ensureDoc({
      roomId: roomId as never,
      artifactId: art.id as never,
      requester: proof,
    }).catch((e: unknown) => setNoteErr(`Notebook setup failed: ${String(e).slice(0, 120)}`));
  }, [existing, ensureDoc, roomId, art.id, proof]);

  // Phase 1: registry not yet resolved (loading) or not yet created -> loading.
  // Once existing is a row, its prosemirrorDocId is the random capability secret.
  if (existing === undefined || existing === null) {
    return (
      <div className="r-art-body">
        {noteErr && <div className="r-wall-error" role="alert" data-testid="note-error">{noteErr}</div>}
        <div data-testid="note-editor-loading">Loading notebook…</div>
        <AgentNotesBlock art={art} />
      </div>
    );
  }
  // Phase 2: the real doc id is known — render the collaborative editor on the
  // paper frame; the read model + work plan become the frame's quiet footer.
  return (
    <div className="r-art-body">
      {noteErr && <div className="r-wall-error" role="alert" data-testid="note-error">{noteErr}</div>}
      <NotebookPaperFrame
        title={art.title}
        meta={paperMeta}
        footer={
          <NotebookReadModelPanel
            blocks={blocks as NotebookBlockRow[]}
            plans={scopedPlans}
            dirtyStatus={dirtyStatus}
            onCreatePlan={() =>
              createPlan({
                roomId: roomId as never,
                artifactId: art.id as never,
                requester: proof,
                goal: "Research the noted company and return source-backed proposals before changing shared artifacts.",
              })
                .then(() => setNoteErr(null))
                .catch((e: unknown) => setNoteErr(`Work plan failed: ${String(e).slice(0, 140)}`))
            }
            onApprovePlan={(plan) =>
              approvePlan({
                agentArtifactId: plan._id as never,
                requester: proof,
                planHash: plan.planHash ?? "",
              })
                .then(() => setNoteErr(null))
                .catch((e: unknown) => setNoteErr(`Plan approval failed: ${String(e).slice(0, 140)}`))
            }
          />
        }
      >
        <SyncedEditorInner docId={existing.prosemirrorDocId} roomId={roomId} me={me} art={art} store={store} setNoteErr={setNoteErr} onDirty={queueDirty} onDocHtml={setDocHtml} />
        <AgentNotesBlock art={art} citationOffset={docCitations.length} />
        <NotebookFootnotes notes={footnotes} />
      </NotebookPaperFrame>
    </div>
  );
}

/** Inner collaborative editor — only mounted once the real doc id is known, so
 *  the `useTiptapSync` hook subscribes to a valid (registered) doc and never a
 *  guessed/placeholder id. */
function SyncedEditorInner({
  docId, roomId, me, art, store, setNoteErr, onDirty, onDocHtml,
}: {
  docId: string; roomId: string; me: Actor; art: Art; store: RoomStore; setNoteErr: (e: string | null) => void; onDirty: (changedRangeHint?: string) => void; onDocHtml?: (html: string) => void;
}) {
  const locked = !!lockedByOther(store, art.id, "doc", me);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Wet-ink snapshot: blockId → text as of the last update. An update while the
  // editor is NOT focused is a remote/agent write — its changed blocks get one
  // .nbk-wet animation. Local typing (focused) never flashes.
  const blockSnapshotRef = useRef<Map<string, string> | null>(null);
  const sync = useTiptapSync(api.prosemirror, docId);
  if (sync === undefined || sync.isLoading || sync.initialContent === null) {
    return <div data-testid="note-editor-loading">Loading notebook…</div>;
  }
  return (
    <div className="r-note" data-testid="note-editor" data-noderoom-surface="workSurface.notebook" data-artifact-id={art.id} ref={containerRef}>
      <EditorProvider
        editable={!locked}
        immediatelyRender={false}
        content={sync.initialContent}
        // Shared schema (blockId identity + agent attribution attrs) + the live
        // sync extension. UniqueID mints ids for legacy blocks on first open;
        // those steps sync like any edit. Paper ink is decoration-only chrome.
        extensions={[...NOTEBOOK_EXTENSIONS, sync.extension, NOTEBOOK_PAPER_INK]}
        onCreate={({ editor }) => {
          const html = editor.getHTML();
          blockSnapshotRef.current = blockTextsFromHtml(html);
          onDocHtml?.(html);
        }}
        onUpdate={({ editor }) => {
          onDirty("doc:idle");
          const html = editor.getHTML();
          const next = blockTextsFromHtml(html);
          const root = containerRef.current;
          if (root && !editor.isFocused) applyWetInk(root, diffWetBlockIds(blockSnapshotRef.current, next));
          blockSnapshotRef.current = next;
          onDocHtml?.(html);
        }}
        onBlur={() => { onDirty("doc:blur"); setNoteErr(null); }}
      >
        <EditorContent editor={null} />
      </EditorProvider>
      <NotebookPresenceLayer roomId={roomId} artifactId={art.id} containerRef={containerRef} />
    </div>
  );
}

/** Agent intent boxes on notebook blocks — the notebook analog of the cell
 *  intent box. Positions a dashed overlay over each `[data-blockid]` element
 *  that has an active presenceClaim (targetKind "notebook_block"), so members
 *  see WHERE the agent is about to write before content lands. Pointer-events
 *  none: never intercepts editing. */
function NotebookPresenceLayer({ roomId, artifactId, containerRef }: {
  roomId: string;
  artifactId: string;
  containerRef: { current: HTMLDivElement | null };
}) {
  const store = useStore();
  const all = store.listPresence(roomId, artifactId);
  const now = Date.now();
  const claims = all.filter((c) => c.targetKind === "notebook_block" && c.expiresAt > now);
  const signature = claims.map((c) => `${c.id}:${c.updatedAt}:${c.targetId}`).join("|");
  const [boxes, setBoxes] = useState<Array<{ key: string; top: number; left: number; width: number; height: number; mode: string; label: string; color?: string }>>([]);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || claims.length === 0) { setBoxes([]); return; }
    const parent = el.getBoundingClientRect();
    setBoxes(claims.flatMap((c) => {
      const target = c.targetId === "agent-section"
        ? el.querySelector("[data-agent-root]") ?? el.querySelector(".ProseMirror")
        : el.querySelector(`[data-blockid="${CSS.escape(c.targetId)}"]`);
      if (!target) return [];
      const r = target.getBoundingClientRect();
      return [{ key: c.id, top: r.top - parent.top, left: r.left - parent.left, width: r.width, height: r.height, mode: c.mode, label: presenceLabel(c), color: c.color }];
    }));
    // Re-measures when claims change; block geometry drift within a claim's
    // short TTL is acceptable (the box marks intent, not selection).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, containerRef]);
  if (!boxes.length) return null;
  return (
    <div className="r-nb-presence-layer" data-testid="notebook-presence-layer" aria-hidden>
      {boxes.map((b) => (
        <div
          key={b.key}
          className={`r-nb-presence presence-${b.mode}`}
          style={{ top: b.top, left: b.left, width: b.width, height: b.height, ...(b.color ? ({ "--presence-color": b.color } as CSSProperties) : {}) }}
        >
          <span className="presencebadge">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

type NotebookBlockRow = {
  blockId: string;
  blockIndex: number;
  blockType: string;
  text: string;
  sourceSnapshotVersion: number;
};
type AgentWorkPlanRow = {
  _id: string;
  artifactId?: string;
  status: string;
  title: string;
  payload?: unknown;
  planHash?: string;
  executedJobId?: string;
  updatedAt: number;
};

function payloadRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
}

function textList(value: unknown, key: string): string[] {
  const arr = payloadRecord(value)[key];
  return Array.isArray(arr)
    ? arr.map((item) => {
      if (typeof item === "string") return item;
      const row = payloadRecord(item);
      for (const field of ["text", "displayName", "title", "source"]) {
        if (typeof row[field] === "string" && row[field]) return row[field];
      }
      return JSON.stringify(item);
    }).slice(0, 3)
    : [];
}

function NotebookReadModelPanel({
  blocks,
  plans,
  dirtyStatus,
  onCreatePlan,
  onApprovePlan,
}: {
  blocks: NotebookBlockRow[];
  plans: AgentWorkPlanRow[];
  dirtyStatus: "idle" | "queued" | "processed";
  onCreatePlan: () => Promise<unknown>;
  onApprovePlan: (plan: AgentWorkPlanRow) => Promise<unknown>;
}) {
  const [busy, setBusy] = useState<"create" | string | null>(null);
  const latestPlan = plans[0];
  const planPayload = payloadRecord(latestPlan?.payload);
  const goal = typeof planPayload.goal === "string" ? planPayload.goal : "";
  const sourceBlocks = textList(latestPlan?.payload, "sourceBlocks");
  const mentions = textList(latestPlan?.payload, "mentions");
  const evidenceRequirements = textList(latestPlan?.payload, "evidenceRequirements");
  const createDisabled = blocks.length === 0 || busy !== null;
  return (
    <div className="r-notebook-proof" data-testid="notebook-read-model" data-status={dirtyStatus}>
      <div className="r-notebook-proof-head">
        <span><Sparkles size={13} /> Notebook intelligence</span>
        <span className="r-tag nbk-chip">{dirtyStatus === "processed" ? "read model ready" : dirtyStatus === "queued" ? "indexing" : "listening"}</span>
      </div>
      {blocks.length === 0 ? (
        <p className="tiny faint">Typed notebook text stays in ProseMirror. The read model appears here after idle processing.</p>
      ) : (
        <div className="r-notebook-blocks">
          {blocks.slice(0, 3).map((block) => (
            <div key={block.blockId} className="r-notebook-block" data-testid="notebook-block">
              <span className="mono tiny">v{block.sourceSnapshotVersion} / {block.blockType}</span>
              <p>{block.text}</p>
            </div>
          ))}
        </div>
      )}
      <div className="r-notebook-actions">
        <button
          type="button"
          className="r-mini-btn primary"
          data-testid="agent-work-plan-create"
          disabled={createDisabled}
          onClick={() => {
            setBusy("create");
            Promise.resolve(onCreatePlan()).finally(() => setBusy(null));
          }}
        >
          <Check size={12} /> {busy === "create" ? "Drafting..." : "Draft work plan"}
        </button>
      </div>
      {latestPlan && (
        <div className="r-agent-plan-card" data-testid="agent-work-plan-card" data-status={latestPlan.status}>
          <div className="r-agent-plan-card-head">
            <b>{latestPlan.title}</b>
            <span className="r-tag nbk-chip">{latestPlan.status}</span>
          </div>
          {goal && <p>{goal}</p>}
          <div className="r-agent-plan-meta">
            <span data-testid="agent-work-plan-hash">planHash {latestPlan.planHash?.slice(0, 12)}</span>
            {latestPlan.executedJobId && <span data-testid="agent-work-plan-job">job {String(latestPlan.executedJobId).slice(-8)}</span>}
          </div>
          {sourceBlocks.length > 0 && (
            <div className="r-agent-plan-source" data-testid="agent-work-plan-source">
              <span className="mono tiny">affected source</span>
              {sourceBlocks.map((item) => <p key={item}>{item}</p>)}
            </div>
          )}
          {mentions.length > 0 && (
            <div className="r-agent-plan-mentions" data-testid="agent-work-plan-mentions">
              {mentions.map((item) => <span key={item} className="r-tag nbk-chip">{item}</span>)}
            </div>
          )}
          {evidenceRequirements.length > 0 && (
            <ul className="r-agent-plan-list">
              {evidenceRequirements.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
          {latestPlan.status === "proposed" && (
            <button
              type="button"
              className="r-mini-btn primary"
              data-testid="agent-work-plan-approve"
              disabled={busy !== null || !latestPlan.planHash}
              onClick={() => {
                setBusy(String(latestPlan._id));
                Promise.resolve(onApprovePlan(latestPlan)).finally(() => setBusy(null));
              }}
            >
              <Check size={12} /> {busy === String(latestPlan._id) ? "Approving..." : "Approve plan"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Labeled, append-only agent-owned notes block. Agents write to the `doc:agent`
 *  element via applyAgentCellEdit with approvalPolicy "draft_first" (proposal-first);
 *  accepted content renders here, below the human-owned editor, with a "NodeRoom"
 *  provenance badge. This is the ONE place agents may surface notebook text — never
 *  the live "doc" element. Never editable inline; provenance is immutable.
 *
 *  Security: agent HTML is untrusted (LLM-authored, prompt-injection-reachable), so
 *  it is rendered through a read-only Tiptap editor whose shared notebook schema
 *  schema strips everything not in the allowed set — no <script>, no event-handler
 *  attributes, no <img onerror>. This is the same sanitizer the legacy note editor
 *  uses, with zero new dependencies. */
function AgentNotesBlock({ art, citationOffset = 0 }: { art: Art; citationOffset?: number }) {
  const html = agentNotesHtml(art);
  const author = art.elements["doc:agent"]?.updatedBy;
  if (!html.trim()) return null;
  return (
    <div className="r-agent-notes" data-testid="agent-notes-block" data-noderoom-surface="workSurface.agentNotes">
      <div className="r-agent-notes-head">
        <span className="r-agent-notes-badge">NodeRoom</span>
        <span className="muted tiny">agent-owned · append-only · approved</span>
        {author && <span className="muted tiny">by {author.name}</span>}
      </div>
      <SanitizedHtml html={html} className="r-agent-notes-body" citationOffset={citationOffset} />
    </div>
  );
}

/** Renders untrusted HTML safely by parsing it through a read-only Tiptap editor.
 *  The shared notebook schema preserves provenance attrs and discards nodes/attrs/marks outside the
 *  allowed set (so <script>, <img onerror=…>, onclick=, javascript: URIs are
 *  dropped). Reuses the existing dependency; no DOMPurify needed. */
function SanitizedHtml({ html, className, citationOffset = 0 }: { html: string; className?: string; citationOffset?: number }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const editor = useEditor({
    // Shared schema first (the sanitizer), then paper ink decorations. The
    // citation offset continues the main doc's footnote numbering; the editor
    // is recreated when the offset shifts (rare — main-doc citations changed).
    extensions: [...NOTEBOOK_EXTENSIONS, createNotebookPaperInk(citationOffset, NOTEBOOK_FOOTNOTE_CAP - citationOffset)],
    content: html,
    editable: false,
    immediatelyRender: false,
  }, [citationOffset]);
  useEffect(() => {
    if (!editor || editor.getHTML() === html) return;
    // Remote/agent rewrite of the agent notes: reload content, then wet-ink the
    // blocks whose text actually changed (block-id diff — never the whole doc).
    const prev = blockTextsFromHtml(editor.getHTML());
    editor.commands.setContent(html);
    const root = rootRef.current;
    if (root) applyWetInk(root, diffWetBlockIds(prev, blockTextsFromHtml(html)));
  }, [editor, html]);
  if (!editor) return <div className={className} />;
  return (
    <div className={className} data-testid="sanitized-html" ref={rootRef}>
      <EditorContent editor={editor} />
    </div>
  );
}

export function Note({ roomId, me, proof, art }: { roomId: string; me: Actor; proof?: ActorProof; art: Art }) {
  const store = useStore();
  const docValue = art.elements["doc"]?.value;
  if (isUploadedFileDoc(docValue)) return <FileViewer roomId={roomId} me={me} proof={proof} art={art} doc={docValue} />;
  const locked = !!lockedByOther(store, art.id, "doc", me);
  const docStr = String(art.elements["doc"]?.value ?? "");
  const agentHtml = agentNotesHtml(art);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [noteErr, setNoteErr] = useState<string | null>(null);
  // Paper-frame meta + citations, straight from the CAS elements — the legacy
  // lane's doc version bump re-renders this component with the new HTML.
  const paperMeta = useMemo(() => notebookPaperMeta(docStr, agentHtml), [docStr, agentHtml]);
  const docCitations = useMemo(() => notebookCitationModel(docStr), [docStr]);
  const footnotes = useMemo(() => combinedNotebookFootnotes(docStr, agentHtml), [docStr, agentHtml]);
  const editor = useEditor({
    // Shared schema so legacy HTML round-trips block ids (data-blockid) — the
    // memory-mode/blur lane carries the same identity attrs as the synced lane.
    // Paper ink (agent dot, needs_review chip, citation sups) is decoration-only.
    extensions: [...NOTEBOOK_EXTENSIONS, NOTEBOOK_PAPER_INK],
    content: docStr,
    editable: !locked,
    immediatelyRender: false,
    // Consume the CAS feedback so a lost/conflicted note write surfaces instead of silently reverting.
    onBlur: ({ editor }) => { void commit(store, roomId, me, art.id, "doc", editor.getHTML()).then((f) => setNoteErr(f && !f.ok ? editErrorMsg(f) : null)); },
  });
  // Re-sync the editor when a remote/agent write changes the doc while we're not editing, so the next local
  // edit commits against the current version instead of a guaranteed stale-baseVersion conflict.
  // The elements.doc version bump IS the wet-ink signal: blocks whose text changed get one .nbk-wet pass.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    const current = editor.getHTML();
    if (current !== docStr) {
      const prev = blockTextsFromHtml(current);
      editor.commands.setContent(docStr);
      const root = containerRef.current;
      if (root) applyWetInk(root, diffWetBlockIds(prev, blockTextsFromHtml(docStr)));
    }
  }, [editor, docStr]);
  useEffect(() => { editor?.setEditable(!locked); }, [editor, locked]);
  if (!editor) return <div className="r-art-body" />;
  return (
    <div className="r-art-body">
      {noteErr && <div className="r-wall-error" role="alert" data-testid="note-error">{noteErr}</div>}
      <NotebookPaperFrame title={art.title} meta={paperMeta}>
        <div className="r-note" data-testid="note-editor" data-noderoom-surface="workSurface.notebook" data-artifact-id={art.id} ref={containerRef}>
          <EditorContent editor={editor} />
          <NotebookPresenceLayer roomId={roomId} artifactId={art.id} containerRef={containerRef} />
        </div>
        <AgentNotesBlock art={art} citationOffset={docCitations.length} />
        <NotebookFootnotes notes={footnotes} />
      </NotebookPaperFrame>
    </div>
  );
}

type UploadedFileDoc = {
  upload: true;
  fileName: string;
  mimeType: string;
  size: number;
  text?: string;
  dataUrl?: string;
  parse?: DocumentParseMeta;
};

function isUploadedFileDoc(value: unknown): value is UploadedFileDoc {
  return !!value && typeof value === "object" && (value as { upload?: unknown }).upload === true;
}

function FileViewer({ roomId, me, proof, art, doc }: { roomId: string; me: Actor; proof?: ActorProof; art: Art; doc: UploadedFileDoc }) {
  const isImage = doc.mimeType.startsWith("image/") && doc.dataUrl;
  const isPdf = isPdfFileDoc(doc);
  const canResolveStoredPdf = isPdf && !!proof && isPersistedArtifactId(art.id);
  const isWorkbook = isWorkbookPreviewDoc(doc);
  const isOffice = isOfficePreviewDoc(doc);
  const display = fileViewerDisplay(doc.fileName, doc.mimeType);
  const pdfObjectUrl = useDataUrlObjectUrl(isPdf ? doc.dataUrl : undefined, doc.mimeType);
  const storedPdf = useQuery(api.artifacts.sourceFilePreviewUrl, canResolveStoredPdf ? { roomId: roomId as never, artifactId: art.id as never, requester: proof } : "skip") as { url?: string | null } | null | undefined;
  const storedPdfUrl = typeof storedPdf?.url === "string" ? storedPdf.url : null;
  const pdfPreviewUrl = pdfObjectUrl ?? storedPdfUrl;
  const waitingForPersistedPdf = isPdf && !!proof && !doc.dataUrl && !isPersistedArtifactId(art.id);
  const downloadHref = isPdf ? pdfPreviewUrl : doc.dataUrl;
  const [workbookArt, setWorkbookArt] = useState<Art | null>(null);
  const [workbookErr, setWorkbookErr] = useState<string | null>(null);
  const [officePreview, setOfficePreview] = useState<OfficePreview | null>(null);
  const [officeErr, setOfficeErr] = useState<string | null>(null);
  useEffect(() => {
    if (!isWorkbook) {
      setWorkbookArt(null);
      setWorkbookErr(null);
      return;
    }
    let cancelled = false;
    setWorkbookErr(null);
    void workbookPreviewArtifactFromDataUrl(doc, roomId, me).then(
      (artifact) => {
        if (cancelled) return;
        setWorkbookArt(artifact);
        setWorkbookErr(artifact ? null : "Workbook preview could not be built.");
      },
      (error) => {
        if (cancelled) return;
        setWorkbookArt(null);
        setWorkbookErr(error instanceof Error ? error.message : "Workbook preview could not be built.");
      },
    );
    return () => { cancelled = true; };
  }, [doc, isWorkbook, me, roomId]);
  useEffect(() => {
    if (!isOffice) {
      setOfficePreview(null);
      setOfficeErr(null);
      return;
    }
    let cancelled = false;
    setOfficeErr(null);
    void officePreviewFromDataUrl(doc).then(
      (preview) => {
        if (cancelled) return;
        setOfficePreview(preview);
        setOfficeErr(preview ? null : "Document preview could not be built.");
      },
      (error) => {
        if (cancelled) return;
        setOfficePreview(null);
        setOfficeErr(error instanceof Error ? error.message : "Document preview could not be built.");
      },
    );
    return () => { cancelled = true; };
  }, [doc, isOffice]);
  return (
    <div className="r-art-body r-file-viewer">
      <div className="r-file-viewer-head">
        <div>
          <div className="r-file-viewer-title"><span>{display.title}</span>{display.badge && <span className="r-file-ext">{display.badge}</span>}</div>
          {doc.parse && <div className="r-file-viewer-meta">{doc.parse.parser} + {doc.parse.fallbackParser ?? "none"} {doc.parse.lane.replace("_", " ")} | {doc.parse.status.replace(/_/g, " ")}</div>}
          <div className="r-file-viewer-meta">{display.type} · {formatBytes(doc.size)}</div>
        </div>
        {downloadHref && <a className="r-btn ghost" href={downloadHref} download={doc.fileName}>Download</a>}
      </div>
      {isImage ? <img className="r-file-image" src={doc.dataUrl} alt={doc.fileName} />
        : isPdf ? <PdfFilePreview doc={doc} previewUrl={pdfPreviewUrl} loadingSourceUrl={waitingForPersistedPdf || (canResolveStoredPdf && !doc.dataUrl && storedPdf === undefined)} />
          : isWorkbook ? (
            <div className="r-file-workbook-preview" data-testid="workbook-file-preview">
              {workbookArt ? <GenericSheet roomId={roomId} me={me} art={workbookArt} />
                : <div className="r-file-empty">{workbookErr ?? "Loading workbook preview..."}</div>}
            </div>
          )
          : isOffice ? <OfficeFilePreview preview={officePreview} error={officeErr} />
          : doc.text !== undefined ? <pre className="r-file-text">{doc.text}</pre>
            : <div className="r-file-empty">Preview is not available for this file type.</div>}
    </div>
  );
}

function isPdfFileDoc(doc: UploadedFileDoc): boolean {
  return doc.mimeType.toLowerCase() === "application/pdf" || doc.fileName.toLowerCase().endsWith(".pdf");
}

function isPersistedArtifactId(id: string): boolean {
  return !!id && !id.startsWith(OPT_ARTIFACT_PREFIX);
}

function PdfFilePreview({ doc, previewUrl, loadingSourceUrl }: { doc: UploadedFileDoc; previewUrl: string | null; loadingSourceUrl?: boolean }) {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setLoaded(false); }, [previewUrl]);
  if (!previewUrl) {
    if (loadingSourceUrl) return <div className="r-file-empty">Loading PDF preview...</div>;
    return (
      <div className="r-file-source-preview" data-testid="pdf-source-preview">
        <div className="r-file-source-icon" aria-hidden><FileText size={18} /></div>
        <div>
          <div className="r-file-source-title">PDF preview unavailable</div>
          <div className="r-file-source-copy">
            The file is stored in this room, but the browser could not resolve a preview URL. Try reopening the artifact or downloading the file.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="r-file-pdf-wrap" data-testid="pdf-file-preview">
      <iframe className="r-file-pdf" title={doc.fileName} src={previewUrl} onLoad={() => setLoaded(true)} />
      {!loaded && <div className="r-file-loading">Preparing PDF preview...</div>}
    </div>
  );
}

function useDataUrlObjectUrl(dataUrl: string | undefined, mimeType: string): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!dataUrl) {
      setObjectUrl(null);
      return;
    }
    if (!dataUrl.startsWith("data:") || typeof URL === "undefined" || typeof Blob === "undefined" || !URL.createObjectURL) {
      setObjectUrl(dataUrl);
      return;
    }
    try {
      const url = objectUrlFromDataUrl(dataUrl, mimeType);
      setObjectUrl(url);
      return () => URL.revokeObjectURL(url);
    } catch {
      setObjectUrl(dataUrl);
    }
  }, [dataUrl, mimeType]);
  return objectUrl;
}

function objectUrlFromDataUrl(dataUrl: string, fallbackMimeType: string): string {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Invalid data URL");
  const mimeType = match[1] || fallbackMimeType || "application/octet-stream";
  const isBase64 = !!match[2];
  const body = match[3] ?? "";
  const bytes = isBase64 ? bytesFromBase64(body) : new TextEncoder().encode(decodeURIComponent(body));
  return URL.createObjectURL(new Blob([arrayBufferFromBytes(bytes)], { type: mimeType }));
}

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function OfficeFilePreview({ preview, error }: { preview: OfficePreview | null; error: string | null }) {
  if (!preview) return <div className="r-file-empty">{error ?? "Loading document preview..."}</div>;
  const Icon = preview.kind === "presentation" ? Layers : FileText;
  const display = fileViewerDisplay(preview.title, preview.kind === "presentation" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  return (
    <div className="r-file-office-preview" data-testid="office-file-preview" data-office-kind={preview.kind}>
      <div className="r-office-preview-head">
        <div className="r-office-preview-icon" aria-hidden><Icon size={16} /></div>
        <div>
          <div className="r-office-preview-title"><span>{display.title}</span>{display.badge && <span className="r-file-ext">{display.badge}</span>}</div>
          <div className="r-office-preview-meta">{display.type} · {preview.subtitle}</div>
        </div>
      </div>
      <div className="r-office-sections">
        {preview.sections.map((section, index) => (
          <section className="r-office-section" key={`${section.title}-${index}`}>
            <h3>{section.title}</h3>
            <ul>
              {section.lines.slice(0, 12).map((line, lineIndex) => <li key={`${line}-${lineIndex}`}>{line}</li>)}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function artifactTabDisplay(artifact: Art) {
  const doc = artifact.elements.doc?.value;
  if (isUploadedFileDoc(doc)) return fileViewerDisplay(doc.fileName, doc.mimeType);
  const display = fileViewerDisplay(artifact.title, "");
  return display.badge ? display : { title: artifact.title, badge: "", type: artifact.kind };
}

function fileViewerDisplay(fileName: string, mimeType: string) {
  const ext = fileExtension(fileName);
  return {
    title: generatedBtbDeliverableLabel(fileName) ?? compactFileTitle(fileName),
    badge: ext ? ext.toUpperCase() : "",
    type: readableFileType(fileName, mimeType),
  };
}

function generatedBtbDeliverableLabel(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  if (!/^btb-[a-f0-9]{8}-/.test(lower)) return null;
  if (lower.endsWith(".xlsx")) return "Valuation model";
  if (lower.endsWith(".xlsm")) return "Macro workbook";
  if (lower.endsWith(".pptx")) return "Presentation deck";
  if (lower.endsWith(".docx")) return "Support memo";
  if (lower.endsWith(".pdf")) return "PDF export";
  if (lower.endsWith("-manifest.json") || lower.endsWith(".json")) return "Package manifest";
  return null;
}

function compactFileTitle(fileName: string): string {
  const ext = fileExtension(fileName);
  const base = ext ? fileName.slice(0, -(ext.length + 1)) : fileName;
  const cleaned = base
    .replace(/^btb-[a-f0-9]{8}-/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fileName;
  return cleaned.length > 56 ? `${cleaned.slice(0, 53).trim()}...` : cleaned;
}

function readableFileType(fileName: string, mimeType: string): string {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerName.endsWith(".xlsm") || lowerMime.includes("macroenabled")) return "Macro workbook";
  if (lowerName.endsWith(".xlsx") || lowerMime.includes("spreadsheetml.sheet")) return "Excel workbook";
  if (lowerName.endsWith(".pptx") || lowerMime.includes("presentationml.presentation")) return "PowerPoint";
  if (lowerName.endsWith(".docx") || lowerMime.includes("wordprocessingml.document")) return "Word document";
  if (lowerName.endsWith(".pdf") || lowerMime === "application/pdf") return "PDF";
  if (lowerName.endsWith(".json") || lowerMime === "application/json") return "JSON";
  if (lowerName.endsWith(".txt") || lowerMime.startsWith("text/")) return "Text";
  if (lowerMime.startsWith("image/")) return "Image";
  return "File";
}

function fileExtension(fileName: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName.trim());
  return match?.[1] ?? "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104_857.6) / 10} MB`;
}

type InventoryItem = { id: string; kind: Art["kind"]; title: string; badge: string; meta: string; Icon: LucideIcon };

function inventoryItem(art: Art): InventoryItem {
  const doc = art.elements.doc?.value;
  if (isUploadedFileDoc(doc)) {
    const display = fileViewerDisplay(doc.fileName, doc.mimeType);
    return { id: art.id, kind: art.kind, title: display.title, badge: display.badge, meta: `${display.type} · ${formatBytes(doc.size)}`, Icon: FileIcon };
  }
  const display = fileViewerDisplay(art.title, "");
  let Icon: LucideIcon = StickyNote;
  let meta = "room file";
  if (art.kind === "sheet") { Icon = Table2; meta = `${rowIdsOf(art).length} rows`; }
  else if (art.kind === "note") { Icon = FileText; meta = "note"; }
  else if (art.kind === "wall") { Icon = StickyNote; meta = `${art.order.length} captures`; }
  if (art.title === "Agent wiki") { Icon = BookOpen; meta = "live TOC"; }
  const btb = generatedBtbDeliverableLabel(art.title);
  if (btb) { Icon = Briefcase; meta = btb; }
  return { id: art.id, kind: art.kind, title: display.title, badge: display.badge, meta, Icon };
}

export function inventoryGroups(arts: Art[]): { key: string; label: string; Icon: LucideIcon; items: InventoryItem[] }[] {
  const groups: { key: string; label: string; Icon: LucideIcon; filter: (a: Art) => boolean }[] = [
    { key: "deliverables", label: "Deliverables", Icon: Package, filter: (a) => generatedBtbDeliverableLabel(a.title) !== null },
    { key: "sheets", label: "Spreadsheets", Icon: Table2, filter: (a) => a.kind === "sheet" && generatedBtbDeliverableLabel(a.title) === null },
    { key: "files", label: "Files", Icon: Folder, filter: (a) => a.kind === "note" && isUploadedFileDoc(a.elements.doc?.value) },
    { key: "notes", label: "Notes", Icon: FileText, filter: (a) => a.kind === "note" && !isUploadedFileDoc(a.elements.doc?.value) },
    { key: "walls", label: "Walls", Icon: StickyNote, filter: (a) => a.kind === "wall" },
  ];
  const used = new Set<string>();
  const out: { key: string; label: string; Icon: LucideIcon; items: InventoryItem[] }[] = [];
  for (const g of groups) {
    const items = arts.filter((a) => !used.has(a.id) && g.filter(a)).map(inventoryItem);
    items.forEach((i) => used.add(i.id));
    if (items.length) out.push({ key: g.key, label: g.label, Icon: g.Icon, items });
  }
  return out;
}

function Wall({ roomId, me, art, onOpenArtifact }: { roomId: string; me: Actor; art: Art; onOpenArtifact: (id: string) => void }) {
  const store = useStore();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 3500); return () => clearTimeout(t); }, [err]);
  const arts = store.listArtifacts(roomId);
  const groups = useMemo(() => inventoryGroups(arts), [arts]);
  const addSticky = async () => {
    const colors = ["#E8C9B8", "#F2DE9B", "#BFD8D5", "#CFC7E8", "#D7E7B5"];
    const i = art.order.length;
    const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    try {
      const res = await createElement(store, roomId, me, art.id, id, {
        text: "New note",
        x: 0,
        y: 0,
        color: colors[i % colors.length],
      });
      if (!res.ok) setErr(editErrorMsg(res));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add capture");
    }
  };
  const removeSticky = async (id: string) => {
    try {
      const res = await deleteElement(store, roomId, me, art.id, id);
      if (res && !res.ok) setErr(editErrorMsg(res));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to delete capture");
    }
  };
  return (
    <div className="r-art-body r-wall-inventory">
      <div className="r-wall-toolbar">
        <button className="r-mini-btn primary" data-testid="postit-add" onClick={() => void addSticky()}><Plus size={12} /> Capture</button>
        <span className="muted tiny">Click any file card to open it. Click a capture to edit.</span>
        {err && <span className="r-wall-error" role="alert">{err}</span>}
      </div>

      <div className="r-inventory" data-testid="wall-canvas">
        {groups.map((group) => (
          <section key={group.key} className="r-inventory-cluster" data-cluster={group.key}>
            <div className="r-inventory-head">
              <group.Icon size={14} />
              <span>{group.label}</span>
              <span className="r-inventory-count">{group.items.length}</span>
            </div>
            <div className="r-inventory-grid">
              {group.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="r-inventory-card"
                  data-testid="inventory-card"
                  data-artifact-id={item.id}
                  data-artifact-kind={item.kind}
                  onClick={() => onOpenArtifact(item.id)}
                >
                  <span className="r-inventory-card-icon" data-kind={item.kind}><item.Icon size={18} /></span>
                  <span className="r-inventory-card-body">
                    <span className="r-inventory-card-title">{item.title}</span>
                    <span className="r-inventory-card-meta">{item.meta}</span>
                  </span>
                  {item.badge && <span className="r-inventory-card-badge">{item.badge}</span>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {art.order.length > 0 && (
        <div className="r-inventory-captures">
          <div className="r-inventory-head">
            <StickyNote size={14} /> <span>Quick captures</span>
            <span className="r-inventory-count">{art.order.length}</span>
          </div>
          <div className="r-capture-grid" data-testid="wall-captures">
            {art.order.map((id) => {
              const el = art.elements[id]; if (!el) return null;
              const v = el.value as { text: string; x: number; y: number; color: string };
              return <Sticky key={id} roomId={roomId} me={me} artId={art.id} id={id} v={v} locked={!!lockedByOther(store, art.id, id, me)} author={el.updatedBy.name} onDelete={removeSticky} onError={setErr} />;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Quick-capture card — a readable, wrapped sticky (no longer a cramped freeform board). Keeps the
// colored-note aesthetic + inline edit + delete + author, but flows in a grid so nothing is cropped.
function Sticky({ roomId, me, artId, id, v, locked, author, onDelete, onError }: { roomId: string; me: Actor; artId: string; id: string; v: { text: string; x: number; y: number; color: string }; locked: boolean; author: string; onDelete: (id: string) => void; onError: (msg: string) => void }) {
  const store = useStore();
  return (
    <div className={"r-capture-card" + (locked ? " locked" : "")} data-testid="post-it" data-postit-id={id} style={{ background: v.color }}>
      <button className="r-postit-delete" data-testid="post-it-delete" disabled={locked} aria-label="Delete post-it" onClick={(e) => { e.stopPropagation(); onDelete(id); }}><Trash2 size={12} /></button>
      <div className="pt-text" data-testid="post-it-text" contentEditable={!locked} suppressContentEditableWarning role="textbox" aria-label="Edit post-it text"
        onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}
        onBlur={(e) => { const t = e.currentTarget.textContent ?? ""; if (t && t !== v.text) void commit(store, roomId, me, artId, id, { ...v, text: t }).then((f) => { if (f && !f.ok) onError(editErrorMsg(f)); }); }}>{v.text}</div>
      <div className="pby">— {author}</div>
    </div>
  );
}

// --- Trace filters + run grouping (Scale systems: the 400-event room) --------
// Pure helpers exported for tests/cellHistoryUi.test.tsx — filtering happens
// BEFORE the 40-row render bound, so a filter surfaces the latest 40 MATCHING
// events instead of filtering an already-truncated window.

/** Collapse a trace.type into its filterable kind (derived from the type prefix). */
export function traceKindOf(type: string): string {
  if (type.startsWith("edit_") || type.startsWith("proposal_")) return "edit";
  if (type.startsWith("lock_")) return "lock";
  if (type.startsWith("draft_") || type === "semantic_conflict") return "merge";
  if (type.startsWith("schema_")) return "schema";
  if (type.startsWith("notebook_")) return "notebook";
  if (type.startsWith("capture")) return "capture";
  if (type.startsWith("agent_")) return "agent";
  return "room";
}

const TRACE_KIND_ORDER = ["edit", "lock", "merge", "schema", "notebook", "capture", "agent", "room"] as const;
export const TRACE_PEOPLE_MAX = 8; // BOUND: chip row stays one calm line even in a 40-member room

/** Kind chips = only kinds PRESENT in the log (canonical order); people = top actors by event count. */
export function traceFilterModel(log: TraceEvent[]): { kinds: string[]; people: string[] } {
  const kindSet = new Set(log.map((t) => traceKindOf(t.type)));
  const byPerson = new Map<string, number>();
  for (const t of log) byPerson.set(t.actor.name, (byPerson.get(t.actor.name) ?? 0) + 1);
  const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1]).slice(0, TRACE_PEOPLE_MAX).map(([name]) => name);
  return { kinds: TRACE_KIND_ORDER.filter((k) => kindSet.has(k)), people };
}

export function filterTraces(log: TraceEvent[], kind: string | null, person: string | null): TraceEvent[] {
  if (!kind && !person) return log;
  return log.filter((t) => (!kind || traceKindOf(t.type) === kind) && (!person || t.actor.name === person));
}

export type TraceBurstGroup = { key: string; actor: Actor; minuteLabel: string; kinds: string[]; rows: TraceEvent[] };

/** Group CONSECUTIVE rows by actor + minute burst (an agent run's write storm folds into one line). */
export function groupTraceBursts(rows: TraceEvent[]): TraceBurstGroup[] {
  const raw: Array<{ actorId: string; minute: number; actor: Actor; rows: TraceEvent[] }> = [];
  for (const t of rows) {
    const minute = Math.floor(t.ts / 60_000);
    const last = raw[raw.length - 1];
    if (last && last.actorId === t.actor.id && last.minute === minute) last.rows.push(t);
    else raw.push({ actorId: t.actor.id, minute, actor: t.actor, rows: [t] });
  }
  return raw.map((g, i) => ({
    key: `${g.actorId}:${g.minute}:${i}`,
    actor: g.actor,
    minuteLabel: new Date(g.minute * 60_000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    kinds: [...new Set(g.rows.map((r) => traceKindOf(r.type)))],
    rows: g.rows,
  }));
}

export function TraceStrip({ roomId, me, onOpenGraph }: { roomId: string; me: Actor; onOpenGraph?: () => void }) {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [groupRuns, setGroupRuns] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const log = store.listTraces(roomId);
  const run = store.lastRun();
  const proposals = store.listProposals(roomId);
  const host = store.listMembers(roomId).some((m) => m.id === me.id && m.role === "host");
  const acceptAll = async () => {
    setAcceptingAll(true);
    let ok = 0, conflict = 0, other = 0;
    try {
      // Aggregate outcomes: an approved-but-CAS-conflicted proposal drops from the pending list,
      // so report the conflict count here (persistent) rather than on the vanishing card.
      for (const p of proposals) {
        const fb = await store.resolveProposal(p.id, true, me);
        if (fb.ok) ok++; else if (fb.reason === "conflict") conflict++; else other++;
      }
    } finally { setAcceptingAll(false); }
    setResolveMsg(conflict || other
      ? `Approved ${ok}, ${conflict} conflict${conflict === 1 ? "" : "s"}${other ? `, ${other} failed` : ""} — changed cells were not overwritten. Re-run the agent.`
      : ok ? `Approved ${ok}.` : null);
  };
  // Only auto-scroll if the user hasn't scrolled up to read an earlier step.
  useEffect(() => { const el = ref.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, [log.length]);
  const onScroll = () => { const el = ref.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60; };
  const filterModel = useMemo(() => traceFilterModel(log), [log]);
  const filtered = useMemo(() => filterTraces(log, kindFilter, personFilter), [log, kindFilter, personFilter]);
  // BOUND preserved: filter first, then render the newest 40 matching rows.
  const shown = useMemo(() => filtered.slice(-40), [filtered]);
  const groups = useMemo(() => (groupRuns ? groupTraceBursts(shown) : null), [groupRuns, shown]);
  // The trace is a LOG, not the work surface. Collapse it by default so the artifact (the spreadsheet)
  // reclaims the ~300px this strip otherwise holds -- the contract says the work surface carries focus.
  // Auto-expand only when proposals are pending, since that is actionable review the host must not miss.
  const open = openOverride ?? proposals.length > 0;
  return (
    <div className="r-trace" data-testid="room-trace" data-open={String(open)} data-noderoom-surface="workSurface.traceStrip">
      <div className="r-trace-head">
        <button
          type="button"
          className="r-trace-toggle"
          aria-expanded={open}
          aria-label={open ? "Collapse room trace" : "Expand room trace"}
          onClick={() => setOpenOverride(!open)}
        >
          <ChevronRight size={13} className="r-trace-chev" style={{ transform: open ? "rotate(90deg)" : "none" }} />
          <History size={13} style={{ color: "var(--text-muted)" }} />
          <span className="h-title" style={{ fontSize: 12.5 }}>Room trace</span>
          <span className="mono tiny faint">· {log.length} events</span>
          {!open && proposals.length > 0 && <span className="r-trace-badge">{proposals.length} to review</span>}
        </button>
        {onOpenGraph && (
          <button type="button" className="r-trace-footer-action r-entity-graph-action" onClick={onOpenGraph}>
            <Share2 size={13} />
            <span>Entity graph</span>
          </button>
        )}
        <span className="grow" />
        {run && <span className="r-trace-tele" title={`${run.steps} steps · ${run.inputTokens.toLocaleString()} in + ${run.outputTokens.toLocaleString()} out tokens · ${run.ms}ms`}>{run.model} · {run.toolCalls} tools · ${run.costUsd.toFixed(3)}</span>}
        {host && proposals.length > 1 && <button className="r-mini-btn primary" disabled={acceptingAll} onClick={() => void acceptAll()}><Check size={12} /> Accept all</button>}
      </div>
      {open && log.length > 0 && (
        <div className="r-trace-filters" data-testid="trace-filters">
          <button
            type="button"
            className="r-trace-fchip"
            data-on={String(kindFilter === null && personFilter === null)}
            onClick={() => { setKindFilter(null); setPersonFilter(null); }}
          >
            all
          </button>
          {filterModel.kinds.map((k) => (
            <button key={k} type="button" className="r-trace-fchip" data-testid="trace-filter-kind" data-kind={k} data-on={String(kindFilter === k)} onClick={() => setKindFilter((cur) => (cur === k ? null : k))}>{k}</button>
          ))}
          {filterModel.people.length > 1 && <span className="r-trace-fsep" aria-hidden="true" />}
          {filterModel.people.length > 1 && filterModel.people.map((p) => (
            <button key={p} type="button" className="r-trace-fchip" data-testid="trace-filter-person" data-person={p} data-on={String(personFilter === p)} onClick={() => setPersonFilter((cur) => (cur === p ? null : p))}>{p}</button>
          ))}
          <span className="grow" />
          <button
            type="button"
            className="r-trace-fchip"
            data-testid="trace-group-runs"
            data-on={String(groupRuns)}
            title="Group consecutive events by the same actor within a minute"
            onClick={() => setGroupRuns((v) => !v)}
          >
            group by run
          </button>
          <span className="r-trace-fmeta">{shown.length} of {log.length}</span>
        </div>
      )}
      {open && <div className="r-trace-list" ref={ref} onScroll={onScroll} aria-live="polite" aria-label="Room activity log">
        {resolveMsg && <div className="r-wall-error" role="alert" data-testid="proposal-resolve-msg" style={{ margin: "2px 4px" }}>{resolveMsg} <button className="r-msg-act" onClick={() => setResolveMsg(null)}>Dismiss</button></div>}
        {proposals.slice(0, 20).map((p) => <ProposalRow key={p.id} roomId={roomId} me={me} proposal={p} onResolved={(fb) => setResolveMsg(fb.ok ? null : proposalErrMsg(fb.reason))} />)}
        {proposals.length > 20 && <div className="tiny faint" style={{ padding: "2px 4px" }}>+{proposals.length - 20} more pending — resolve these first (mirrors the 40-row trace cap)</div>}
        {shown.length === 0 && log.length === 0 && <div className="tiny faint" style={{ padding: "2px 4px" }}>Edit a cell, move a sticky, or run the collaboration — every change is recorded here.</div>}
        {shown.length === 0 && log.length > 0 && <div className="tiny faint" style={{ padding: "2px 4px" }}>No events match this filter.</div>}
        {groups
          ? groups.map((g) => g.rows.length === 1
            ? <TraceRow key={g.rows[0].id} t={g.rows[0]} />
            : (
              <div className="r-trace-group" key={g.key} data-testid="trace-run-group">
                <button
                  type="button"
                  className="r-trace-row"
                  data-open={String(!!openGroups[g.key])}
                  aria-expanded={!!openGroups[g.key]}
                  onClick={() => setOpenGroups((prev) => ({ ...prev, [g.key]: !prev[g.key] }))}
                >
                  <span className="r-trace-ico other"><Layers size={12} /></span>
                  <span className="tt grow">{g.actor.name} · {g.rows.length} events · {g.kinds.join(" + ")}</span>
                  <span className="mono tiny faint">{g.minuteLabel}</span>
                  <ChevronRight size={12} className="r-trace-chev" style={{ transform: openGroups[g.key] ? "rotate(90deg)" : "none" }} />
                </button>
                {openGroups[g.key] && <div className="r-trace-group-rows">{g.rows.map((t) => <TraceRow key={t.id} t={t} />)}</div>}
              </div>
            ))
          : shown.map((t) => <TraceRow key={t.id} t={t} />)}
      </div>}
    </div>
  );
}

/** A collapsible trace row (assistant-ui ToolFallback style): tool + status collapsed,
 *  the structured `tool · args → result` detail on expand. */
function ProposalRow({ roomId, me, proposal, onResolved }: { roomId: string; me: Actor; proposal: Proposal; onResolved: (fb: EditFeedback) => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const host = store.listMembers(roomId).some((m) => m.id === me.id && m.role === "host");
  const semantic = isSemanticProposal(proposal);
  const value = proposalValue(proposal.op.value);
  const reason = proposal.review?.reason ?? (semantic ? "Current cell changed after the agent read it." : undefined);
  const note = proposal.review?.reviewerNote;
  const decide = async (approve: boolean) => {
    setBusy(true);
    // Keep the card mounted (disabled) during the await; bubble the result up so a CAS conflict
    // surfaces in the persistent banner instead of the card silently vanishing as "applied".
    try { onResolved(await store.resolveProposal(proposal.id, approve, me)); }
    finally { setBusy(false); }
  };
  return (
    <div className="r-proposal" data-testid="proposal-card" data-semantic={String(semantic)}>
      <span className={"r-trace-ico " + (semantic ? "read" : "commit")}>{semantic ? <GitMerge size={12} /> : <Pencil size={12} />}</span>
      <div className="r-proposal-main">
        <div className="tt">{proposal.author.name} proposed {proposal.op.elementId ?? "an edit"} = {value}</div>
        {semantic && (
          <div className="r-proposal-meta" data-testid="semantic-proposal-meta">
            <span className="r-proposal-badge">Semantic rebase</span>
            {proposal.review?.status && <span>{proposal.review.status.replace(/_/g, " ")}</span>}
            {reason && <span className="r-proposal-reason">{reason}</span>}
            {note && <span className="r-proposal-reason">{note}</span>}
          </div>
        )}
        {host ? (
          <div className="r-proposal-actions">
            <button className="r-mini-btn primary" data-testid="proposal-approve" disabled={busy} onClick={() => void decide(true)}><Check size={12} /> Approve</button>
            <button className="r-mini-btn" data-testid="proposal-reject" disabled={busy} onClick={() => void decide(false)}><X size={12} /> Reject</button>
          </div>
        ) : <div className="td">awaiting host review</div>}
      </div>
    </div>
  );
}

/** Human-readable reason for a proposal that could not be applied (CAS conflict, already resolved, etc.). */
const proposalErrMsg = (reason?: string) =>
  reason === "conflict" ? "The cell changed since this was proposed — re-run the agent or dismiss."
    : reason === "not_pending" ? "That proposal was already resolved."
      : reason === "not_found" ? "That proposal no longer exists."
        : reason === "host_required" ? "Only the host can resolve proposals."
          : reason === "formula_protected" ? "Formula cells cannot be overwritten by scalar agent edits."
          : "Couldn't apply this proposal — try again.";

function compactTraceSummary(summary: string): string {
  const payloadMatch = summary.match(/^(.*?=\s*)([{[]).*/);
  if (payloadMatch) return `${payloadMatch[1]}evidence payload`;
  const releaseMatch = summary.match(/^(.*?released lock on )(.+)$/i);
  if (releaseMatch) {
    const cells = releaseMatch[2].split(",").map((cell) => cell.trim()).filter(Boolean);
    const cellCount = cells.length;
    return `${releaseMatch[1]}${cellCount || "multiple"} cell${cellCount === 1 ? "" : "s"}`;
  }
  return summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
}

function TraceRow({ t }: { t: TraceEvent }) {
  const [open, setOpen] = useState(false);
  const { cls, Icon } = traceIcon(t.type);
  const status = statusFor(t.type);
  const expandable = !!t.detail;
  return (
    <div className="r-trace-item">
      <button className="r-trace-row" data-open={String(open)} aria-expanded={open} disabled={!expandable} onClick={() => setOpen((o) => !o)}>
        <span className={"r-trace-ico " + cls}><Icon size={12} /></span>
        <span className="tt grow">{compactTraceSummary(t.summary)}</span>
        {status === "error" && <span className="r-trace-status err">error</span>}
        {expandable && <ChevronRight size={12} className="r-trace-chev" />}
      </button>
      {open && t.detail && (
        <div className="r-trace-detail">
          <div><span className="k">tool</span><span className="v">{toolFor(t.type)}</span></div>
          <div><span className="k">{status === "error" ? "result" : "call"}</span><span className="v">{t.detail}</span></div>
        </div>
      )}
    </div>
  );
}

function toolFor(type: string): string {
  switch (type) {
    case "lock_acquired": case "lock_denied": return "propose_lock";
    case "lock_released": return "release_lock";
    case "edit_applied": case "edit_blocked": case "edit_proposed": return "edit_cell";
    case "draft_created": return "create_draft";
    case "draft_merged": case "draft_conflict": case "proposal_resolved": case "proposal_resolve_failed": return "smart_merge";
    case "semantic_conflict": return "semantic_rebase";
    case "notebook_read_model": return "process_notebook_dirty_event";
    case "agent_work_plan_proposed": return "create_agent_work_plan";
    case "agent_work_plan_approved": return "approve_agent_work_plan";
    default: return type;
  }
}
function statusFor(type: string): "ok" | "error" | "info" {
  if (type === "lock_denied" || type === "edit_blocked" || type === "draft_conflict" || type === "semantic_conflict" || type === "proposal_resolve_failed") return "error";
  if (type === "agent_session_started" || type === "agent_status" || type === "message" || type === "notebook_read_model") return "info";
  return "ok";
}

function traceIcon(type: string): { cls: string; Icon: LucideIcon } {
  switch (type) {
    case "lock_acquired": return { cls: "lock", Icon: Lock };
    case "lock_released": return { cls: "lock", Icon: Unlock };
    case "lock_denied": case "edit_blocked": return { cls: "read", Icon: Ban };
    case "edit_applied": case "edit_proposed": return { cls: "commit", Icon: Pencil };
    case "draft_created": return { cls: "draft", Icon: FileText };
    case "draft_merged": case "proposal_resolved": return { cls: "merge", Icon: Check };
    case "draft_conflict": case "semantic_conflict": case "proposal_resolve_failed": return { cls: "read", Icon: AlertTriangle };
    case "agent_session_started": case "agent_status": return { cls: "read", Icon: Eye };
    case "notebook_read_model": return { cls: "read", Icon: FileText };
    case "agent_work_plan_proposed": return { cls: "draft", Icon: Sparkles };
    case "agent_work_plan_approved": return { cls: "merge", Icon: Check };
    default: return { cls: "other", Icon: Circle };
  }
}
