/**
 * ArtifactPanel — tabs + Shared tag · collab bar · spreadsheet (CAS) · TipTap note
 * · dnd-kit wall · Room trace. Reads + writes through `useStore()`, so the same
 * component renders the in-memory engine OR live Convex (optimistic edits).
 */

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { DndContext, useDraggable, type DragEndEvent } from "@dnd-kit/core";
import { restrictToParentElement } from "@dnd-kit/modifiers";
import { useEditor, EditorContent, EditorProvider } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useQuery, useMutation } from "convex/react";
import { useTiptapSync } from "@convex-dev/prosemirror-sync/tiptap";
import { api } from "../../../convex/_generated/api";
import {
  Table2, FileText, StickyNote, Users, GitMerge, Play, RotateCcw, History, Search, BookOpen,
  Lock, Unlock, Ban, Pencil, Plus, Check, AlertTriangle, Eye, Circle, ChevronRight, Download, Trash2, Undo2, X, Columns2, MoreHorizontal, Mail, Hash, Layers, Linkedin, Activity, type LucideIcon,
  Sparkles,
} from "lucide-react";
import { useStore, type ActorProof, type RoomStore, type EditFeedback, type PresenceClaim } from "../../app/store";
import { formatExcelNumber } from "../../app/numberFormat";
import { columnLetters } from "../../app/spreadsheetIndex";
import { evaluateFormula, FormulaEvalError, type CellResolver, type CellValue, type FormulaResult } from "../../nodeagent/core/formulaEngine";
import { rangeBox, boxSize, cellsInBox, rangeLabel, rewriteFormulaRefs, buildTSV, parseTSV, toA1, parseA1 } from "../../shared/gridOps";
import { onStageFocus, focusStage, type StageFocusTarget } from "../stageFocus";
import { TraceSurface } from "./TraceSurface";
import { classifyEvidence } from "../traceLens/evidence";
import type { Actor, Artifact as Art, CellPayload, DataframeColumn, DocumentParseMeta, Proposal, TraceEvent, ResearchRowInput } from "../../engine/types";
import { AttentionOverlay } from "../overlay/AttentionOverlay";
import { createSpreadsheetResolver } from "../overlay/spreadsheetResolver";
import { focusBoxesForSheet, type SheetCellState } from "../overlay/focusBoxesForSheet";
import { prepareDownstreamDrafts, type PreparedDownstreamDraft } from "../../nodeagent/skills/integration/downstreamPublish";

/** Downstream handoff destinations → compact icon + short label (replaces 5 wide ghost buttons). */
const HANDOFF_ICONS: Record<string, LucideIcon> = { gmail: Mail, notion: FileText, slack: Hash, linear: Layers, linkedin: Linkedin };
const HANDOFF_SHORT: Record<string, string> = { gmail: "Gmail", notion: "Notion", slack: "Slack", linear: "Linear", linkedin: "LinkedIn" };

const WIKI_TITLE = "Agent wiki";
const RESEARCH_TITLE = "Company research";
const GENERIC_SHEET_CELL_WINDOW = 5_000;
type TabId = "wiki" | "sheet" | "research" | "note" | "wall";
const TABS: { id: TabId; label: string; Icon: LucideIcon }[] = [
  { id: "wiki", label: "Wiki", Icon: BookOpen },
  { id: "sheet", label: "Spreadsheet", Icon: Table2 },
  { id: "research", label: "Research", Icon: Search },
  { id: "note", label: "Note", Icon: FileText },
  { id: "wall", label: "Wall", Icon: StickyNote },
];
type WorkbookViewStyle = "excel" | "sheets" | "evidence";
type CollabControls = { running: boolean; done: boolean; error?: string; onRun: () => void; onConflict?: () => void };
const WORKBOOK_VIEW_STYLES: { id: WorkbookViewStyle; label: string; hint: string }[] = [
  { id: "excel", label: "Excel", hint: "file" },
  { id: "sheets", label: "Sheets", hint: "collab" },
  { id: "evidence", label: "Evidence", hint: "review" },
];
const WORKBOOK_VIEW_STORAGE_KEY = "noderoom:workbook-view-style";

function ArtifactSurface({ roomId, me, proof, artId, onArt, collab, style, surfaceKey = "primary", headerExtra, openIds, onCloseArtifact }: {
  roomId: string; me: Actor; artId: string; onArt: (id: string) => void;
  proof?: ActorProof;
  collab?: CollabControls;
  style?: CSSProperties;
  surfaceKey?: "primary" | "secondary";
  headerExtra?: ReactNode;
  openIds?: string[];
  onCloseArtifact?: (id: string) => void;
}) {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  const selected = arts.find((a) => a.id === artId);
  const wiki = selected?.kind === "note" && selected.title === WIKI_TITLE ? selected : arts.find((a) => a.title === WIKI_TITLE);
  const research = selected?.title === RESEARCH_TITLE ? selected : arts.find((a) => a.title === RESEARCH_TITLE);
  const varianceSheet = arts.find((a) => a.kind === "sheet" && a.title === "Q3 variance") ?? arts.find((a) => a.kind === "sheet" && a.title !== RESEARCH_TITLE);
  const sheet = selected?.kind === "sheet" && selected.title !== RESEARCH_TITLE ? selected : varianceSheet;
  const note = selected?.kind === "note" && selected.title !== WIKI_TITLE ? selected : arts.find((a) => a.kind === "note" && a.title !== WIKI_TITLE);
  const wall = selected?.kind === "wall" ? selected : arts.find((a) => a.kind === "wall");
  const artFor = (t: TabId) => (t === "wiki" ? wiki : t === "sheet" ? sheet : t === "research" ? research : t === "note" ? note : wall);
  const fallbackTab: TabId = sheet ? "sheet" : wiki ? "wiki" : research ? "research" : note ? "note" : wall ? "wall" : "sheet";
  const tabForArt = (id: string): TabId => {
    if (wiki?.id === id) return "wiki";
    if (arts.some((a) => a.id === id && a.kind === "sheet" && a.title !== RESEARCH_TITLE)) return "sheet";
    if (research?.id === id) return "research";
    if (arts.some((a) => a.id === id && a.kind === "note" && a.title !== WIKI_TITLE)) return "note";
    if (wall?.id === id) return "wall";
    return fallbackTab;
  };
  const [tab, setTab] = useState<TabId>(() => tabForArt(artId));
  const [traceOpen, setTraceOpen] = useState(false);
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
  if (arts.length === 0) return <div className="r-panel artifact"><div className="r-art-body" /></div>;
  // Fall back to the SELECTED artifact's tab (artId is the source of truth), never the generic
  // 'sheet'/variance default — otherwise the array-identity churn on an edit can momentarily snap a
  // non-default sheet (e.g. an uploaded .xlsx) back to the variance tab.
  const activeTab: TabId = tabForArt(artId);
  const tabIcon = (a: Art) => {
    const I = a.title === WIKI_TITLE ? BookOpen : a.title === RESEARCH_TITLE ? Search : a.kind === "sheet" ? Table2 : a.kind === "note" ? FileText : StickyNote;
    return <I size={13} />;
  };
  const openTabArts = (openIds ?? []).map((id) => arts.find((a) => a.id === id)).filter((a): a is Art => !!a);
  const renameArtifact = (a: Art) => {
    if (typeof window === "undefined") return;
    const next = window.prompt("Rename this file", a.title);
    if (next && next.trim() && next.trim() !== a.title) void store.setArtifactMeta({ roomId, artifactId: a.id, title: next.trim(), actor: me });
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
    <div className="r-panel artifact" ref={surfaceRef} style={style} data-testid={surfaceKey === "secondary" ? "artifact-panel-secondary" : "artifact-panel"}>
      <div className="r-panel-head">
        <div className="r-tabs" data-testid={surfaceKey === "secondary" ? "artifact-tabs-secondary" : "artifact-tabs"}>
          {openIds
            ? openTabArts.map((a) => (
                <button key={a.id} className="r-tab r-filetab" data-active={String(!traceOpen && a.id === artId)} onClick={() => { onArt(a.id); setTraceOpen(false); }} onDoubleClick={() => renameArtifact(a)} title={a.meta?.summary ? `${a.title} — ${a.meta.summary}` : `${a.title} (double-click to rename)`} data-testid="artifact-filetab">
                  {tabIcon(a)}
                  <span className="r-filetab-name">{a.title}</span>
                  {onCloseArtifact && openTabArts.length > 1 && (
                    <span className="r-filetab-x" role="button" aria-label={`Close ${a.title}`} onClick={(e) => { e.stopPropagation(); onCloseArtifact(a.id); }}><X size={12} /></span>
                  )}
                </button>
              ))
            : TABS.filter((t) => artFor(t.id)).map((t) => (
                <button key={t.id} className="r-tab" data-active={String(!traceOpen && activeTab === t.id)} onClick={() => { pick(t.id); setTraceOpen(false); }}>
                  <t.Icon size={13} /> {t.label}
                </button>
              ))}
          {/* Trace is a pinned work-surface tab alongside the artifacts (agent + QA provenance). */}
          {surfaceKey !== "secondary" && (
            <button type="button" className="r-tab r-tracetab" data-active={String(traceOpen)} data-testid="trace-tab" title="Agent + QA trace records" onClick={() => setTraceOpen(true)}>
              <Activity size={13} /> Trace
            </button>
          )}
        </div>
        <span className="grow" />
        {headerExtra}
        {activeTab === "sheet" && sheet && !sheet.meta?.excelGrid && (
          <button
            type="button"
            className="r-btn ghost r-artifact-export"
            aria-label="Export workbook to XLSX"
            title="Download this sheet as an .xlsx workbook"
            data-testid="artifact-export-xlsx"
            onClick={() => { void exportSheetAsXlsx(sheet); }}
          >
            <Download size={11} />
            Export XLSX
          </button>
        )}
        {canToggleVis ? (
          <button
            type="button"
            className={`r-tag r-tag-toggle ${visibility === "private" ? "private" : "public"}`}
            onClick={toggleVisibility}
            title={visibility === "private" ? "Share this sheet with the room" : "Make this sheet private to you"}
            data-testid="artifact-visibility-toggle"
          >
            {visibility === "private" ? <Lock size={11} /> : <Users size={11} />}
            {visibility === "private" ? "Private" : "Shared"}
          </button>
        ) : (
          <span className={`r-tag ${visibility === "private" ? "private" : "public"}`}>
            {visibility === "private" ? <Lock size={11} /> : <Users size={11} />}
            {visibility === "private" ? "Private" : visibility === "public" ? "Public" : "Shared"}
          </span>
        )}
      </div>

      {traceOpen ? (
        <TraceSurface roomId={roomId} onOpenSource={openTraceSource} />
      ) : (
        <>
          {collab && activeTab === "sheet" && sheet?.title === "Q3 variance" && <CollabBar collab={collab} />}
          {editErr && <div className="r-art-error" role="alert"><AlertTriangle size={13} /> {editErr}</div>}
          {activeTab === "wiki" && wiki && <Wiki roomId={roomId} art={wiki} onOpenArtifact={openArtifact} />}
          {activeTab === "sheet" && sheet && (sheet.title === "Q3 variance"
            ? <Sheet roomId={roomId} me={me} art={sheet} onError={(f) => setEditErr(editErrorMsg(f))} />
            : sheet.meta?.excelGrid ? <ExcelGridSheet roomId={roomId} me={me} art={sheet} onError={(f) => setEditErr(editErrorMsg(f))} /> : <GenericSheet roomId={roomId} me={me} art={sheet} onError={(f) => setEditErr(editErrorMsg(f))} />)}
          {/* Research = an empty NAMED-COLUMN grid the agent populates (matches the prototype's structured
              grid, not a raw A1 sheet). Rendered by GenericSheet — no separate <Research> renderer. */}
          {activeTab === "research" && research && <GenericSheet roomId={roomId} me={me} art={research} onError={(f) => setEditErr(editErrorMsg(f))} />}
          {activeTab === "note" && note && (NOTEBOOK_SYNC_ENABLED && proof ? <SyncedNote roomId={roomId} me={me} proof={proof} art={note} /> : <Note roomId={roomId} me={me} art={note} />)}
          {activeTab === "wall" && wall && <Wall roomId={roomId} me={me} art={wall} />}
        </>
      )}

      <TraceStrip roomId={roomId} me={me} />
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
 * BlankRoomState — what a brand-new (0-artifact) room shows instead of a black void.
 * Per deep-review §0 ("A new room starts blank") the room is empty by design; this gives the
 * first-time user exactly THREE obvious starts (chat / add a surface / load the sample) rather
 * than an empty technical shell. Each CTA is a real one-click action.
 */
function BlankRoomState({ roomId, me, style, onOpenChat }: { roomId: string; me: Actor; style?: CSSProperties; onOpenChat?: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const focusChat = () => {
    onOpenChat?.();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const ta = document.querySelector<HTMLTextAreaElement>('textarea[data-testid="chat-composer"]');
        if (ta) { ta.focus(); ta.scrollIntoView({ block: "center", behavior: "smooth" }); }
      });
    });
  };
  const addSheet = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const columns: DataframeColumn[] = ["A", "B", "C"].map((label, order) => ({ id: label, label, order, mode: "manual", type: "text", agentWritable: true }));
      const seed: Array<{ id: string; value: unknown }> = [];
      for (let r = 1; r <= 8; r++) for (const c of ["A", "B", "C"]) seed.push({ id: `r${r}__${c}`, value: "" });
      await store.uploadArtifact({ roomId, actor: me, artifact: { kind: "sheet", title: "Sheet 1", seed, meta: { dataframe: { columns, rowCount: 8, sourceFile: "blank-room", parser: "blank_seed", truncated: false, warnings: [] } } } });
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
    <div className="r-panel artifact" style={style} data-testid="blank-room-state">
      <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", padding: 24, minHeight: 0 }}>
        <div style={{ maxWidth: 440, width: "100%", textAlign: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>This room is blank.</div>
          <div className="faint" style={{ fontSize: 13, marginBottom: 18, lineHeight: 1.5 }}>
            Start it your way. Everything you and your NodeAgents add stays live and conflict-safe.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "stretch" }}>
            <button className="r-btn primary" data-testid="blank-cta-chat" onClick={focusChat}>Ask the agent to build something →</button>
            <button className="r-btn" data-testid="blank-cta-sheet" disabled={busy} onClick={() => void addSheet()}><Plus size={13} /> {busy ? "Adding a sheet…" : "Add a blank sheet"}</button>
            <button className="r-btn ghost" data-testid="blank-cta-demo" onClick={loadSample}>Load the sample diligence workspace →</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Artifact(props: {
  roomId: string; me: Actor; proof?: ActorProof; artId: string; onArt: (id: string) => void;
  sideArtId?: string | null;
  onSideArtChange?: (id: string | null) => void;
  onOpenChat?: () => void;
  collab?: CollabControls;
  style?: CSSProperties;
}) {
  const { roomId, me, proof, artId, onArt, sideArtId, onSideArtChange, onOpenChat, collab, style } = props;
  const store = useStore();
  const arts = store.listArtifacts(roomId);
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
  useEffect(() => { if (artId) setOpenIds((prev) => (prev.includes(artId) ? prev : [...prev, artId])); }, [artId]);
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
  // A blank room (0 artifacts) is intentional (Loop 1) — show the onboarding starts, not a void.
  if (arts.length === 0) return <BlankRoomState roomId={roomId} me={me} style={style} onOpenChat={onOpenChat} />;
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
        collab={collab}
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
function coColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CO_COLORS[h % CO_COLORS.length];
}
function coInitials(name: string): string {
  const parts = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
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
      <input className="r-cell-input" autoFocus value={draft} style={align === "right" ? { textAlign: "right" } : undefined}
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
  const ids: string[] = [];
  for (const eid of art.order) { const r = eid.split("__")[0]; if (!ids.includes(r)) ids.push(r); }
  return ids;
}
const cellVal = (art: Art, rowId: string, col: string) => displayCellValue(art.elements[`${rowId}__${col}`]?.value);

function colsOf(art: Art): string[] {
  const cols: string[] = [];
  for (const eid of art.order) {
    const col = eid.split("__").slice(1).join("__");
    if (col && !cols.includes(col)) cols.push(col);
  }
  return cols;
}

function GenericSheet({ roomId, me, art, onError }: { roomId: string; me: Actor; art: Art; onError?: (f: EditFeedback) => void }) {
  const store = useStore();
  const [pages, setPages] = useState(1);
  // QA P2 perf: derive rows/columns/pageSize once per artifact snapshot, not on every render
  // (paging state changes alone shouldn't re-walk the full element order).
  const { rows, columns, pageSize } = useMemo(() => {
    const rows = rowIdsOf(art);
    const columns = columnsOf(art);
    const pageSize = Math.max(25, Math.min(250, Math.floor(GENERIC_SHEET_CELL_WINDOW / Math.max(columns.length, 1))));
    return { rows, columns, pageSize };
  }, [art]);
  const cols = columns.map((col) => col.id);
  const visibleRows = rows.slice(0, pageSize * pages);

  // Attention Overlay — SAME wiring as the variance Sheet, on the dynamic `${rid}__${col}` key space, so
  // agent_write / proposal / evidence boxes land on whatever columns the agent governed via define_columns.
  const proposals = store.listProposals(roomId).filter((p) => p.artifactId === art.id);
  const presenceRows = store.listPresence(roomId, art.id);
  const sheetWrapRef = useRef<HTMLDivElement>(null);
  const overlayResolver = useMemo(() => createSpreadsheetResolver(() => sheetWrapRef.current), []);
  const overlayCellStates = useMemo<SheetCellState[]>(() => {
    const out: SheetCellState[] = [];
    for (const rid of visibleRows) for (const col of cols) {
      const id = `${rid}__${col}`;
      const locked = !!lockedByOther(store, art.id, id, me);
      const proposed = !!proposalFor(proposals, art.id, id) || draftedFor(store, roomId, art.id, id);
      const hasEvidence = !!asCellPayload(art.elements[id]?.value)?.evidence?.length;
      if (locked || proposed || hasEvidence) out.push({ id, lockedByOther: locked, proposed, hasEvidence });
    }
    return out;
  }, [visibleRows, cols, store, roomId, art, me, proposals]);
  const overlayBoxes = useMemo(
    () => focusBoxesForSheet({ artifactId: art.id, now: Date.now(), meId: me.id, presence: presenceRows, cellStates: overlayCellStates }),
    [art.id, me.id, presenceRows, overlayCellStates],
  );
  void onError; // research grid is read-only here; signature mirrors Sheet for a uniform call site
  return (
    <>
      <div className="r-art-body">
        <div className="r-sheet-wrap" ref={sheetWrapRef}>
          <AttentionOverlay boxes={overlayBoxes} resolver={overlayResolver} mode="live" />
          <table className="r-sheet r-generic-sheet" data-noderoom-surface="workSurface.sheet" data-artifact-id={art.id}>
            <thead><tr><th className="r-corner" aria-label="row number" />{columns.map((c) => <th key={c.id}>{c.label}</th>)}</tr></thead>
            <tbody>
              {visibleRows.map((rid, i) => (
                <tr key={rid}>
                  <td className="r-rownum" title={rid}>{i + 1}</td>
                  {cols.map((col) => {
                    const raw = art.elements[`${rid}__${col}`]?.value;
                    const payload = asCellPayload(raw);
                    const value = displayCellValue(raw);
                    return (
                      <td key={col} title={payload?.evidence?.[0]?.label} data-evidence-class={classifyEvidence(payload)} data-cell-key={rid + "__" + col} data-element-id={rid + "__" + col} data-testid="sheet-cell">
                        {value || <span className="nullcell">—</span>}
                        {payload && <span className={"r-cell-meta " + (payload.status ?? "complete")}>{payload.evidence?.length ? `${payload.evidence.length} src` : payload.status}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {Array.from({ length: Math.max(0, 24 - visibleRows.length) }, (_, k) => (
                <tr key={`fill${k}`} className="r-row-empty" aria-hidden="true">
                  <td className="r-rownum">{visibleRows.length + k + 1}</td>
                  {cols.map((c) => <td key={c} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="r-sheet-foot">
        <span className="kicker">uploadedSpreadsheet</span>
        <span className="r-vpill next">v{art.version}</span>
        {visibleRows.length < rows.length && <button className="r-mini-btn" onClick={() => setPages((n) => n + 1)}>Show next {pageSize}</button>}
        <span className="grow" />
        <span className="mono tiny faint">{rows.length} rows · {cols.length} columns</span>
      </div>
    </>
  );
}

/** Dark fills need light ink — used only when the file carries no explicit font color. */
function fillNeedsLightInk(hex: string): boolean {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return false;
  const [r, g, b] = [m[1], m[2], m[3]].map((c) => parseInt(c, 16));
  return 0.299 * r + 0.587 * g + 0.114 * b < 120;
}

/** "B" -> 2 (1-based, inverse of columnLetters) */
function lettersToColIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Expand "B2:D2" merge ranges into an anchor->span map + the set of covered (skipped) cells.
 *  Pathological ranges (>1k cells) are ignored rather than expanded — render-only, BOUND. */
function expandMerges(merges: string[] | undefined): { mergeAnchor: Map<string, { colSpan: number; rowSpan: number }>; mergeCovered: Set<string> } {
  const mergeAnchor = new Map<string, { colSpan: number; rowSpan: number }>();
  const mergeCovered = new Set<string>();
  for (const range of merges ?? []) {
    const m = range.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (!m) continue;
    const c1 = lettersToColIndex(m[1]), r1 = Number(m[2]), c2 = lettersToColIndex(m[3]), r2 = Number(m[4]);
    if (c2 < c1 || r2 < r1 || (c2 - c1 + 1) * (r2 - r1 + 1) > 1_000) continue;
    mergeAnchor.set(`${m[1]}${r1}`, { colSpan: c2 - c1 + 1, rowSpan: r2 - r1 + 1 });
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue;
        mergeCovered.add(`${columnLetters(c - 1)}${r}`);
      }
    }
  }
  return { mergeAnchor, mergeCovered };
}

/**
 * Excel skin, NodeRoom skeleton. The grid is a light "paper" surface rendering the uploaded file's
 * formats/styles; every edit still travels {elementId, baseVersion} through commit() — the renderer
 * never owns truth. Collaboration states use the Sheets presence grammar: locked cells render with
 * the holder's outline + ONE name flag per lock; conflict feedback flows through the same onError
 * path as every other sheet.
 */
function ExcelGridSheet({ roomId, me, art, onError }: { roomId: string; me: Actor; art: Art; onError: (f: EditFeedback) => void }) {
  const store = useStore();
  const [pages, setPages] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const [selAnchor, setSelAnchor] = useState<string | null>(null); // other corner of a multi-cell range; null = single cell
  const [viewStyle, setViewStyle] = useState<WorkbookViewStyle>(() => {
    if (typeof window === "undefined") return "excel";
    const stored = window.localStorage.getItem(WORKBOOK_VIEW_STORAGE_KEY);
    return WORKBOOK_VIEW_STYLES.some((s) => s.id === stored) ? stored as WorkbookViewStyle : "excel";
  });
  // editing.seed: null = edit existing content (dblclick/Enter/F2); a string = type-to-replace
  // (the typed character becomes the whole draft — the Excel/Sheets keyboard model).
  const [editing, setEditing] = useState<{ id: string; seed: string | null } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const pendingMove = useRef<{ dCol: number; dRow: number } | null>(null);
  const presenceStoreRef = useRef(store);
  const presenceActorRef = useRef(me);
  presenceStoreRef.current = store;
  presenceActorRef.current = me;
  const grid = art.meta?.excelGrid;
  const presenceRows = store.listPresence(roomId, art.id);
  const selfPresenceColor = memberColor(store, roomId, me);
  const { columns, visibleRows, pageSize } = useMemo(() => {
    const columnCount = Math.max(1, grid?.columns ?? 1);
    const rowCount = Math.max(1, grid?.rows ?? 1);
    const columns = Array.from({ length: columnCount }, (_, idx) => columnLetters(idx));
    const pageSize = Math.max(25, Math.min(250, Math.floor(GENERIC_SHEET_CELL_WINDOW / Math.max(columnCount, 1))));
    const visibleRows = Array.from({ length: Math.min(rowCount, pageSize * pages) }, (_, idx) => idx + 1);
    return { columns, visibleRows, pageSize };
  }, [grid?.columns, grid?.rows, pages]);
  // Attention Overlay (the wedge): derive focus boxes from EXISTING state and paint them on the live grid.
  const overlayResolver = useMemo(() => createSpreadsheetResolver(() => gridRef.current), []);
  const overlayCellStates = useMemo<SheetCellState[]>(() => {
    const out: SheetCellState[] = [];
    for (const r of visibleRows) for (const c of columns) {
      const id = `${c}${r}`;
      const locked = !!lockedByOther(store, art.id, id, me);
      const proposed = draftedFor(store, roomId, art.id, id);
      const hasEvidence = !!asCellPayload(art.elements[id]?.value)?.evidence?.length;
      if (locked || proposed || hasEvidence) out.push({ id, lockedByOther: locked, proposed, hasEvidence });
    }
    return out;
  }, [visibleRows, columns, store, roomId, art, me]);
  const overlayBoxes = useMemo(
    () => focusBoxesForSheet({ artifactId: art.id, now: Date.now(), meId: me.id, presence: presenceRows, cellStates: overlayCellStates }),
    [art.id, me.id, presenceRows, overlayCellStates],
  );
  const { mergeAnchor, mergeCovered } = useMemo(() => expandMerges(grid?.merges), [grid?.merges]);
  // Live formula recalc: every visible formula cell is computed through the shared engine via a
  // recursive, cycle-guarded resolver (chains resolve; cycles -> #CYCLE!; upstream errors propagate).
  // Computed values are CLIENT-DERIVED only — never written to Convex — so there is zero collab fan-out.
  const computedByElementId = useMemo(() => {
    const cache = new Map<string, FormulaResult>();
    const visiting = new Set<string>();
    const cellAt = (ref: string): { formula?: string; value: CellValue } => {
      const el = art.elements[ref];
      if (!el) return { value: null };
      const p = asCellPayload(el.value);
      const raw = p ? p.value : el.value;
      const formula = p?.formula ?? (typeof raw === "string" && raw.startsWith("=") ? raw : undefined);
      const value: CellValue = typeof raw === "number" || typeof raw === "boolean" ? raw : typeof raw === "string" ? raw : raw == null ? null : String(raw);
      return { formula, value };
    };
    const compute = (ref: string): FormulaResult => {
      const key = ref.toUpperCase();
      const hit = cache.get(key);
      if (hit) return hit;
      if (visiting.has(key)) return { error: "#CYCLE!" };
      const { formula, value } = cellAt(key);
      if (formula === undefined) { const r: FormulaResult = { value }; cache.set(key, r); return r; }
      visiting.add(key);
      const r = evaluateFormula(formula, resolver);
      visiting.delete(key);
      cache.set(key, r);
      return r;
    };
    const resolver: CellResolver = { getCell: (ref) => { const r = compute(ref); if ("error" in r) throw new FormulaEvalError(r.error); return r.value; } };
    for (const rowNumber of visibleRows) for (const col of columns) {
      const id = `${col}${rowNumber}`;
      if (cellAt(id).formula !== undefined) compute(id);
    }
    return cache;
  }, [art.elements, art.version, visibleRows, columns]);
  // Keep the moved-to cell visible (Excel scrolls the viewport with the selection).
  useEffect(() => {
    if (!sel) return;
    gridRef.current?.querySelector(`[data-cell-key="${sel}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [sel]);
  useEffect(() => {
    if (!sel) return;
    const mode = editing?.id === sel ? "edit" : "focus";
    const publish = () => touchPresence(presenceStoreRef.current, roomId, art.id, presenceActorRef.current, sel, mode, selfPresenceColor);
    publish();
    const interval = window.setInterval(publish, 5_000);
    return () => window.clearInterval(interval);
  }, [art.id, editing?.id, roomId, sel, selfPresenceColor]);
  if (!grid) return null;
  const cellStyles = grid.styles ?? {};
  const numFmts = grid.numFmts ?? [];
  const doCommit = (id: string, s: string) => {
    // A typed formula persists as a CellPayload {value, formula} (durable + formula-bar after reload),
    // preserving any prior payload fields (evidence/status). And the xl-grid only seeds non-empty
    // cells, so CREATE the element when the cell is empty — otherwise typing into a blank cell is lost.
    const value: unknown = s.startsWith("=") ? { ...(asCellPayload(art.elements[id]?.value) ?? {}), value: s, formula: s } : s;
    const exists = !!art.elements[id];
    const p = exists ? commit(store, roomId, me, art.id, id, value)
      : s === "" ? Promise.resolve(null) : createElement(store, roomId, me, art.id, id, value);
    void p.then((f) => { if (f && !f.ok) onError(f); });
  };
  const selEl = sel ? art.elements[sel] : undefined;
  const selPayload = selEl ? asCellPayload(selEl.value) : null;
  const selRaw = selPayload ? selPayload.value : selEl?.value;
  const selFormula = selPayload?.formula ?? (typeof selRaw === "string" && selRaw.startsWith("=") ? selRaw : "");
  const selectedEvidence = selPayload?.evidence ?? [];
  const selectedSignal = selectedEvidence[0]?.label ?? (selFormula ? "formula" : sel ? "value" : "");
  const selMatch = sel?.match(/^([A-Z]+)(\d+)$/);
  const flaggedLocks = new Set<string>();

  /** Move the selection by a row/col delta, clamped to the rendered grid. */
  const move = (dCol: number, dRow: number) => {
    if (!selMatch) return;
    const colIdx = Math.min(Math.max(lettersToColIndex(selMatch[1]) - 1 + dCol, 0), columns.length - 1);
    const rowNum = Math.min(Math.max(Number(selMatch[2]) + dRow, 1), visibleRows.length);
    setSelAnchor(null);
    setSel(`${columns[colIdx]}${rowNum}`);
  };
  /** Shift+arrow: extend the selection from a fixed anchor (Excel range-select). */
  const extendSel = (dCol: number, dRow: number) => {
    if (!selMatch) return;
    const colIdx = Math.min(Math.max(lettersToColIndex(selMatch[1]) - 1 + dCol, 0), columns.length - 1);
    const rowNum = Math.min(Math.max(Number(selMatch[2]) + dRow, 1), visibleRows.length);
    setSelAnchor((a) => a ?? sel);
    setSel(`${columns[colIdx]}${rowNum}`);
  };
  const cellLocked = (id: string) => !!lockedByOther(store, art.id, id, me);
  const startEdit = (id: string, seed: string | null) => {
    if (cellLocked(id)) { onError({ ok: false, reason: "locked" }); return; }
    touchPresence(store, roomId, art.id, me, id, "edit", selfPresenceColor);
    setEditing({ id, seed });
  };
  const chooseViewStyle = (next: WorkbookViewStyle) => {
    setViewStyle(next);
    try { window.localStorage.setItem(WORKBOOK_VIEW_STORAGE_KEY, next); } catch { /* ignore storage failures */ }
  };
  /** Grid-level keyboard model (when NOT editing): arrows move, Enter/F2 edit, typing replaces,
   *  Tab moves right, Delete clears — the spreadsheet muscle memory. */
  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (editing || !sel) return;
    const mv = e.shiftKey ? extendSel : move; // shift+arrow extends the range
    if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { e.preventDefault(); handleFillDown(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { e.preventDefault(); void handleCopy(); }
    else if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { e.preventDefault(); void handlePaste(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mv(0, -1); }
    else if (e.key === "ArrowDown") { e.preventDefault(); mv(0, 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); mv(-1, 0); }
    else if (e.key === "ArrowRight") { e.preventDefault(); mv(1, 0); }
    else if (e.key === "Tab") { e.preventDefault(); move(e.shiftKey ? -1 : 1, 0); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); startEdit(sel, null); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (cellLocked(sel)) { onError({ ok: false, reason: "locked" }); return; }
      doCommit(sel, "");
    }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(sel, e.key); }
  };
  /** Enter/Tab/arrow commits route through ONE path (the input's blur) to guarantee exactly one
   *  CAS write: the key handler records the move + blurs; onBlur commits, then applies the move. */
  const finishEdit = (elementId: string, draft: string, current: string) => {
    store.clearPresence({ roomId, artifactId: art.id, targetKind: "cell", targetId: elementId, mode: "edit", actor: me });
    setEditing(null);
    if (draft !== current) doCommit(elementId, draft);
    const mv = pendingMove.current;
    pendingMove.current = null;
    if (mv) move(mv.dCol, mv.dRow);
    gridRef.current?.focus();
  };
  /** Ctrl/Cmd+D: fill the top row of a vertical range DOWN, rewriting relative formula refs per row.
   *  BOUND: never fills more than 500 cells; aborts before writing anything if over. */
  const handleFillDown = () => {
    if (editing || !sel || !selAnchor) { onError({ ok: false, reason: "fill_needs_range" }); return; }
    const box = rangeBox(selAnchor, sel);
    if (!box || box.r0 === box.r1) { onError({ ok: false, reason: "fill_needs_range" }); return; }
    if (boxSize(box) > 500) { onError({ ok: false, reason: "too_large" }); return; }
    for (let c = box.c0; c <= box.c1; c++) {
      const srcEl = art.elements[toA1(c, box.r0)];
      const srcP = srcEl ? asCellPayload(srcEl.value) : null;
      const srcRaw = srcP ? srcP.value : srcEl?.value;
      const srcFormula = srcP?.formula ?? (typeof srcRaw === "string" && srcRaw.startsWith("=") ? srcRaw : undefined);
      for (let r = box.r0 + 1; r <= box.r1; r++) {
        const id = toA1(c, r);
        if (mergeCovered.has(id) || cellLocked(id)) continue;
        doCommit(id, srcFormula ? rewriteFormulaRefs(srcFormula, r - box.r0, 0) : srcRaw == null ? "" : String(srcRaw));
      }
    }
  };
  /** Ctrl/Cmd+C: copy the selected range as TSV to the clipboard. */
  const handleCopy = async () => {
    if (editing || !sel) return;
    const box = rangeBox(selAnchor ?? sel, sel);
    if (!box) return;
    const rows: string[][] = [];
    for (let r = box.r0; r <= box.r1; r++) {
      const row: string[] = [];
      for (let c = box.c0; c <= box.c1; c++) { const el = art.elements[toA1(c, r)]; const p = el ? asCellPayload(el.value) : null; const raw = p ? p.value : el?.value; row.push(raw == null ? "" : String(raw)); }
      rows.push(row);
    }
    try { await navigator.clipboard.writeText(buildTSV(rows)); } catch { onError({ ok: false, reason: "clipboard" }); }
  };
  /** Ctrl/Cmd+V: paste a TSV block anchored at the active cell, clamped to the grid. BOUND 500. */
  const handlePaste = async () => {
    if (editing || !sel) return;
    const anchor = parseA1(sel);
    if (!anchor) return;
    let text = "";
    try { text = await navigator.clipboard.readText(); } catch { onError({ ok: false, reason: "clipboard" }); return; }
    const grid = parseTSV(text);
    if (!grid.length) return;
    if (grid.length * (grid[0]?.length ?? 0) > 500) { onError({ ok: false, reason: "too_large" }); return; }
    for (let i = 0; i < grid.length; i++) for (let j = 0; j < grid[i].length; j++) {
      const c = anchor.col + j, r = anchor.row + i;
      if (c > columns.length || r > visibleRows.length) continue;
      const id = toA1(c, r);
      if (mergeCovered.has(id) || cellLocked(id)) continue;
      doCommit(id, grid[i][j]);
    }
  };
  const selRangeBox = selAnchor && sel ? rangeBox(selAnchor, sel) : null;
  const rangeCells = selRangeBox ? new Set(cellsInBox(selRangeBox)) : null;
  const selLabel = sel ? (selRangeBox ? rangeLabel(selRangeBox) : sel) : "";
  return (
    <>
      <div className="r-art-body">
        <div className={`xl-paper xl-paper--${viewStyle}`} data-testid="excel-paper" data-workbook-style={viewStyle}>
          <div className="xl-modebar">
            <div className="xl-mode-copy">
              <span className="xl-mode-title">{grid.sheetName}</span>
              <span className="xl-mode-sub">{grid.rows} rows · {grid.columns} columns</span>
            </div>
            <div className="xl-mode-tabs" role="radiogroup" aria-label="Workbook visual style">
              {WORKBOOK_VIEW_STYLES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="xl-mode-tab"
                  data-active={viewStyle === s.id}
                  data-testid={`workbook-style-${s.id}`}
                  role="radio"
                  aria-checked={viewStyle === s.id}
                  onClick={() => chooseViewStyle(s.id)}
                >
                  <span>{s.label}</span>
                  <small>{s.hint}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="xl-fbar">
            <span className="xl-name" data-testid="excel-namebox">{selLabel}</span>
            <span className="xl-fx">fx</span>
            <span className="xl-ftext" data-testid="excel-formulabar">{sel ? (selFormula || String(selRaw ?? "")) : ""}</span>
            <span className="grow" />
            {selEl && <span className="xl-meta">v{selEl.version}{selPayload?.evidence?.[0]?.label ? ` · ${selPayload.evidence[0].label}` : ""}</span>}
          </div>
          {viewStyle === "evidence" && (
            <div className="xl-evidence-strip" data-testid="workbook-evidence-strip">
              <span className="xl-evidence-chip">{sel ?? "No cell"}</span>
              <span>{selEl ? `v${selEl.version}` : "unselected"}</span>
              <span>{selectedEvidence.length ? `${selectedEvidence.length} source${selectedEvidence.length === 1 ? "" : "s"}` : "no source"}</span>
              {selectedSignal && <span>{selectedSignal}</span>}
            </div>
          )}
          <div className="r-sheet-wrap xl-scroll" ref={gridRef} tabIndex={0} role="grid" aria-label={`${grid.sheetName} spreadsheet grid`} onKeyDown={onGridKeyDown}>
            <table className="xl-grid">
              <colgroup>
                <col style={{ width: 38 }} />
                {columns.map((col, i) => <col key={col} style={{ width: grid.colWidths?.[i] || 92 }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th className="xl-corner" aria-label="cell address" />
                  {columns.map((col) => <th key={col} className={"xl-col" + (selMatch?.[1] === col ? " hl" : "")}>{col}</th>)}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((rowNumber) => (
                  <tr key={rowNumber}>
                    <td className={"xl-rowhead" + (selMatch && Number(selMatch[2]) === rowNumber ? " hl" : "")}>{rowNumber}</td>
                    {columns.map((col) => {
                      const elementId = `${col}${rowNumber}`;
                      if (mergeCovered.has(elementId)) return null; // absorbed by a merge anchor's span
                      const span = mergeAnchor.get(elementId);
                      const colSpan = span ? Math.min(span.colSpan, columns.length - lettersToColIndex(col) + 1) : undefined;
                      const rowSpan = span ? Math.min(span.rowSpan, visibleRows.length - rowNumber + 1) : undefined;
                      const el = art.elements[elementId];
                      const payload = el ? asCellPayload(el.value) : null;
                      const rawVal = payload ? payload.value : el?.value;
                      const st = cellStyles[elementId];
                      // Formula cells display their COMPUTED value (or an error token); the formula bar
                      // (selFormula) still shows the formula. Non-formula cells are unchanged.
                      const cellFormula = payload?.formula ?? (typeof rawVal === "string" && rawVal.startsWith("=") ? rawVal : undefined);
                      const computed = cellFormula ? computedByElementId.get(elementId.toUpperCase()) : undefined;
                      const compError = computed && "error" in computed ? computed.error : undefined;
                      const effRaw = cellFormula ? (compError ? undefined : (computed && "value" in computed ? computed.value : undefined)) : rawVal;
                      const numCandidate = typeof effRaw === "number" ? effRaw
                        : typeof effRaw === "string" && effRaw !== "" && !effRaw.startsWith("=") && Number.isFinite(Number(effRaw.replace(/,/g, ""))) ? Number(effRaw.replace(/,/g, ""))
                        : undefined;
                      const display = compError ? compError
                        : numCandidate !== undefined ? formatExcelNumber(numCandidate, st?.f !== undefined ? numFmts[st.f] : undefined)
                        : cellFormula ? (effRaw == null ? "" : String(effRaw))
                        : displayCellValue(el?.value);
                      const lk = lockedByOther(store, art.id, elementId, me);
                      const cellPresence = presenceForCell(presenceRows, elementId, me);
                      let lockFlag: string | null = null;
                      if (lk && !flaggedLocks.has(lk.id)) { flaggedLocks.add(lk.id); lockFlag = lk.holder.name; }
                      const alignRight = numCandidate !== undefined || st?.a === "r";
                      const isEditing = editing?.id === elementId;
                      const inRange = rangeCells?.has(elementId) ?? false;
                      const cls = "xl-cell" + (alignRight ? " num" : "") + (st?.a === "c" ? " ctr" : "") + (lk ? " locked" : "") + (cellPresence ? ` presence presence-${cellPresence.mode}` : "") + (payload?.evidence?.length ? " evidence" : "") + (cellFormula ? " formula" : "") + (compError ? " cell-error" : "") + (inRange ? " range" : "") + (sel === elementId ? " sel" : "") + (isEditing ? " editing" : "");
                      const inline: Record<string, string | number> = {};
                      if (st?.bg) { inline.background = st.bg; if (!st?.fc && fillNeedsLightInk(st.bg)) inline.color = "#fff"; }
                      if (st?.fc) inline.color = st.fc; // the FILE's font color wins over the heuristic
                      if (st?.b) inline.fontWeight = 700;
                      if (st?.i) inline.fontStyle = "italic";
                      if (st?.u) inline.textDecoration = "underline";
                      if (st?.ind) inline.paddingLeft = 6 + st.ind * 12;
                      if (st?.bt) inline.borderTop = "1px solid #5f6368";
                      if (st?.bb) inline.borderBottom = "1px solid #5f6368";
                      const editText = cellFormula ?? (typeof rawVal === "string" || typeof rawVal === "number" ? String(rawVal) : "");
                      const title = [elementId, cellFormula ? `Formula: ${cellFormula}` : undefined, lk ? `locked by ${lk.holder.name}` : undefined, cellPresence ? presenceLabel(cellPresence) : undefined].filter(Boolean).join(" | ");
                      return (
                        <td
                          key={col}
                          className={cls}
                          style={{ ...inline, ...presenceStyle(cellPresence) }}
                          title={title}
                          data-cell-key={elementId}
                          data-evidence-class={classifyEvidence(payload)}
                          data-presence-mode={cellPresence?.mode}
                          data-presence-label={cellPresence ? presenceLabel(cellPresence) : undefined}
                          data-in-range={rangeCells?.has(elementId) ? "true" : undefined}
                          data-has-evidence={payload?.evidence?.length ? "true" : undefined}
                          data-has-formula={cellFormula ? "true" : undefined}
                          colSpan={colSpan}
                          rowSpan={rowSpan}
                          aria-selected={(sel === elementId || inRange) || undefined}
                          onClick={(e) => { if (e.shiftKey) setSelAnchor((a) => a ?? sel); else setSelAnchor(null); setSel(elementId); gridRef.current?.focus(); }}
                          onDoubleClick={() => startEdit(elementId, null)}
                        >
                          {isEditing ? (
                            <input
                              className="xl-input"
                              autoFocus
                              defaultValue={editing.seed ?? editText}
                              onBlur={(e) => finishEdit(elementId, e.target.value, editText)}
                              onKeyDown={(e) => {
                                const input = e.target as HTMLInputElement;
                                // Enter mode (opened by typing): arrows COMMIT + move — the most-missed
                                // spreadsheet parity detail. Edit mode (F2/dblclick): arrows move the caret.
                                const enterMode = editing.seed !== null;
                                if (e.key === "Enter") { e.preventDefault(); pendingMove.current = { dCol: 0, dRow: e.shiftKey ? -1 : 1 }; input.blur(); }
                                else if (e.key === "Tab") { e.preventDefault(); pendingMove.current = { dCol: e.shiftKey ? -1 : 1, dRow: 0 }; input.blur(); }
                                else if (e.key === "Escape") { e.preventDefault(); input.value = editText; setEditing(null); gridRef.current?.focus(); }
                                else if (enterMode && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                                  e.preventDefault();
                                  pendingMove.current = e.key === "ArrowUp" ? { dCol: 0, dRow: -1 } : e.key === "ArrowDown" ? { dCol: 0, dRow: 1 } : e.key === "ArrowLeft" ? { dCol: -1, dRow: 0 } : { dCol: 1, dRow: 0 };
                                  input.blur();
                                }
                              }}
                            />
                          ) : display ? <span>{display}</span> : <span className="nullcell">&nbsp;</span>}
                          {lockFlag && <span className="xl-flag" data-testid="lock-flag">{lockFlag}</span>}
                          {cellPresence && <span className="xl-presence-flag" data-testid="presence-flag">{presenceLabel(cellPresence)}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <AttentionOverlay boxes={overlayBoxes} resolver={overlayResolver} mode="live" />
          </div>
        </div>
      </div>
      <div className="r-sheet-foot">
        <span className="kicker">excelWorkbook</span>
        <span className="r-vpill next">v{art.version}</span>
        {visibleRows.length < grid.rows && <button className="r-mini-btn" onClick={() => setPages((n) => n + 1)}>Show next {pageSize}</button>}
        <span className="grow" />
        <span className="mono tiny faint">{grid.sheetName} | {grid.rows} rows | {grid.columns} columns</span>
      </div>
    </>
  );
}

function columnsOf(art: Art): DataframeColumn[] {
  const metaCols = art.meta?.dataframe?.columns;
  if (metaCols?.length) return [...metaCols].sort((a, b) => a.order - b.order);
  return colsOf(art).map((id, order) => ({ id, label: prettyCol(id), order }));
}

function asCellPayload(value: unknown): CellPayload | null {
  if (!value || typeof value !== "object" || !("value" in value)) return null;
  return value as CellPayload;
}

function displayCellValue(value: unknown): string {
  const payload = asCellPayload(value);
  const raw = payload ? payload.value : value;
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
 * surfaces — NOT the `.xl-sheet` ExcelGridSheet branch (that one is the xlsx-recognition surface;
 * different concern).
 *
 * TODO(mobile-export): the mobile #mobile route currently has a Download XLSX button that emits a
 * fake toast (flagged by R31). Wire it to this same path (extract into a shared helper) in a
 * follow-up PR; out of scope here.
 */
async function exportSheetAsXlsx(art: Art): Promise<void> {
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = (ExcelJSModule as { default?: typeof import("exceljs") }).default ?? (ExcelJSModule as unknown as typeof import("exceljs"));
  const workbook = new ExcelJS.Workbook();
  const sheetName = (art.title || "Sheet1").slice(0, 31); // Excel sheet name max 31 chars
  const worksheet = workbook.addWorksheet(sheetName);
  const rows = rowIdsOf(art);

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
    // Generic / blank sheet: derive columns from art.order; the SpreadsheetBench fresh-room flow
    // writes r<row>__A / r<row>__B so this preserves cell addresses exactly (A1=metric, B1=value).
    const cols = colsOf(art);
    // Single-letter column ids ("A", "B", ...) are written to their literal Excel column; multi-char
    // column ids (legacy headers) get a labeled header row and sequential Excel columns.
    const isLetterCols = cols.length > 0 && cols.every((c) => /^[A-Z]$/.test(c));
    if (isLetterCols) {
      for (const rid of rows) {
        const rowNum = parseInt(rid.replace(/^r/, ""), 10);
        if (!Number.isFinite(rowNum) || rowNum <= 0) continue;
        for (const col of cols) {
          const v = exportCellValue(art.elements[`${rid}__${col}`]?.value);
          if (v !== null) worksheet.getCell(`${col}${rowNum}`).value = v;
        }
      }
    } else {
      worksheet.addRow(cols.map((c) => prettyCol(c)));
      for (const rid of rows) {
        worksheet.addRow(cols.map((col) => exportCellValue(art.elements[`${rid}__${col}`]?.value)));
      }
    }
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
  anchor.download = `${sanitizeFilename(art.title)}.xlsx`;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Free the object URL on the next tick so Chrome/Firefox have finished the download negotiation.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function prettyCol(col: string) {
  return col.replace(/_/g, " ");
}

function Sheet({ roomId, me, art, onError }: { roomId: string; me: Actor; art: Art; onError: (f: EditFeedback) => void }) {
  const store = useStore();
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
          <table className="r-sheet" data-noderoom-surface="workSurface.sheet" data-artifact-id={art.id}>
            <thead><tr><th className="r-corner" aria-label="row number" /><th>Account</th><th className="num">Q2</th><th className="num">Q3</th><th className="num">Variance</th><th>Note</th></tr></thead>
            <tbody>
              {rows.map((rid, i) => {
                const vId = `${rid}__variance`, nId = `${rid}__note`;
                const vEl = art.elements[vId], nEl = art.elements[nId];
                const lk = lockedByOther(store, art.id, vId, me);
                const vPresence = presenceForCell(presenceRows, vId, me);
                const nPresence = presenceForCell(presenceRows, nId, me);
                const drafting = draftedFor(store, roomId, art.id, vId);
                const vProposal = proposalFor(proposals, art.id, vId);
                const nProposal = proposalFor(proposals, art.id, nId);
                const committed = !lk && vEl && vEl.version > 1 && now - vEl.updatedAt < 1500;
                const personalEditor = vEl?.updatedBy && (vEl.updatedBy as Actor).ownerId ? store.listMembers(roomId).find((mm) => mm.id === (vEl.updatedBy as Actor).ownerId) : undefined;
                const vCls = "r-cell num" + (lk ? " locked" : "") + (vPresence ? ` presence presence-${vPresence.mode}` : "") + (drafting ? " draft" : "") + (committed ? " committed" : "") + (vProposal ? " proposed" : "");
                return (
                  <tr key={rid}>
                    <td className="r-rownum" title={rid}>{i + 1}</td>
                    <td className="label">{cellVal(art, rid, "label")}</td>
                    <td className="num"><span className="r-val-num">{cellVal(art, rid, "q2")}</span></td>
                    <td className="num"><span className="r-val-num">{cellVal(art, rid, "q3")}</span></td>
                    <td className={vCls} style={presenceStyle(vPresence)} data-cell-key={vId} data-element-id={vId} data-evidence-class={classifyEvidence(asCellPayload(vEl?.value))} data-testid="sheet-cell" data-presence-mode={vPresence?.mode} onClick={() => touchPresence(store, roomId, art.id, me, vId, "focus", selfPresenceColor)}>
                      <EditableCell key={vId + ":" + (vEl?.version ?? 0)} value={String(vEl?.value ?? "")} disabled={!!lk || drafting || !!vProposal} align="right" onEditStart={() => touchPresence(store, roomId, art.id, me, vId, "edit", selfPresenceColor)} onEditEnd={() => store.clearPresence({ roomId, artifactId: art.id, targetKind: "cell", targetId: vId, mode: "edit", actor: me })} onCommit={(s) => doCommit(vId, s)} />
                      {lk && <span className="lockbadge"><Lock size={9} /> NA</span>}
                      {drafting && <span className="lockbadge"><Pencil size={9} /> draft</span>}
                      {vProposal && <InlineProposal roomId={roomId} me={me} proposal={vProposal} onResolved={(f) => { if (!f.ok) onError(f); }} />}
                      {personalEditor && <span className="r-prov-dot" style={{ background: personalEditor.color }} title={`edited by ${personalEditor.name}'s agent`} />}
                      {vPresence && <span className="presencebadge" data-testid="presence-flag">{presenceLabel(vPresence)}</span>}
                    </td>
                    <td className={"r-cell" + (nPresence ? ` presence presence-${nPresence.mode}` : "") + (nProposal ? " proposed" : "")} style={presenceStyle(nPresence)} data-cell-key={nId} data-element-id={nId} data-evidence-class={classifyEvidence(asCellPayload(nEl?.value))} data-testid="sheet-cell" data-presence-mode={nPresence?.mode} onClick={() => touchPresence(store, roomId, art.id, me, nId, "focus", selfPresenceColor)}>
                      <EditableCell key={nId + ":" + (nEl?.version ?? 0)} value={String(nEl?.value ?? "")} disabled={!!lk || !!nProposal} addLabel="note" onEditStart={() => touchPresence(store, roomId, art.id, me, nId, "edit", selfPresenceColor)} onEditEnd={() => store.clearPresence({ roomId, artifactId: art.id, targetKind: "cell", targetId: nId, mode: "edit", actor: me })} onCommit={(s) => doCommit(nId, s)} />
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
      <div className="r-sheet-foot">
        <span className="kicker">versionedSpreadsheetSync</span>
        <span className="r-vpill next">v{art.version}</span>
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

/** Collaborative notebook editor backed by Convex ProseMirror Sync. Lazily
 *  migrates a legacy `note` artifact's "doc" element to a synced doc on first
 *  open. The component owns live multiplayer text; the client blur commit is the
 *  single activity source (-> applyCellEdit -> enqueueRoomActivity), identical to
 *  the legacy Note path. Proposal-first: agents never write here.
 *
 *  Two-phase render so `useTiptapSync` only subscribes once the real (random
 *  capability-secret) doc id is known via the requester-gated getNotebookDoc —
 *  never a guessed/placeholder id. */
function SyncedNote({ roomId, me, proof, art }: { roomId: string; me: Actor; proof: ActorProof; art: Art }) {
  const docValue = art.elements["doc"]?.value;
  if (isUploadedFileDoc(docValue)) return <FileViewer doc={docValue} />;
  const store = useStore();
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const [dirtyStatus, setDirtyStatus] = useState<"idle" | "queued" | "processed">("idle");
  const dirtyTimer = useRef<number | null>(null);
  const existing = useQuery(api.prosemirror.getNotebookDoc, { roomId: roomId as never, artifactId: art.id as never, requester: proof });
  const blocks = useQuery(api.notebookProcessing.listNotebookBlocks, existing ? { roomId: roomId as never, artifactId: art.id as never, requester: proof, limit: 12 } : "skip") ?? [];
  const plans = useQuery(api.agentArtifacts.listAgentArtifacts, existing ? { roomId: roomId as never, requester: proof, kind: "agent_work_plan", limit: 12 } : "skip") ?? [];
  const ensureDoc = useMutation(api.prosemirror.ensureNotebookDoc);
  const markDirty = useMutation(api.notebookProcessing.markNotebookDirty);
  const createPlan = useMutation((api.agentArtifacts as any).createAgentWorkPlanFromNotebook); // FIXME: pre-session uncommitted convex fn, cast to unblock prod build
  const approvePlan = useMutation(api.agentArtifacts.approveAgentWorkPlan);
  const ensuredRef = useRef(false);
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
  // Phase 2: the real doc id is known — render the collaborative editor.
  return (
    <div className="r-art-body">
      {noteErr && <div className="r-wall-error" role="alert" data-testid="note-error">{noteErr}</div>}
      <SyncedEditorInner docId={existing.prosemirrorDocId} me={me} art={art} store={store} setNoteErr={setNoteErr} onDirty={queueDirty} />
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
      <AgentNotesBlock art={art} />
    </div>
  );
}

/** Inner collaborative editor — only mounted once the real doc id is known, so
 *  the `useTiptapSync` hook subscribes to a valid (registered) doc and never a
 *  guessed/placeholder id. */
function SyncedEditorInner({
  docId, me, art, store, setNoteErr, onDirty,
}: {
  docId: string; me: Actor; art: Art; store: RoomStore; setNoteErr: (e: string | null) => void; onDirty: (changedRangeHint?: string) => void;
}) {
  const locked = !!lockedByOther(store, art.id, "doc", me);
  const sync = useTiptapSync(api.prosemirror, docId);
  if (sync === undefined || sync.isLoading || sync.initialContent === null) {
    return <div data-testid="note-editor-loading">Loading notebook…</div>;
  }
  return (
    <div className="r-note" data-testid="note-editor">
      <EditorProvider
        editable={!locked}
        immediatelyRender={false}
        content={sync.initialContent}
        extensions={[StarterKit, sync.extension]}
        onUpdate={() => { onDirty("doc:idle"); }}
        onBlur={() => { onDirty("doc:blur"); setNoteErr(null); }}
      >
        <EditorContent editor={null} />
      </EditorProvider>
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
        <span className="r-tag">{dirtyStatus === "processed" ? "read model ready" : dirtyStatus === "queued" ? "indexing" : "listening"}</span>
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
            <span className="r-tag">{latestPlan.status}</span>
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
              {mentions.map((item) => <span key={item} className="r-tag">{item}</span>)}
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
 *  it is rendered through a read-only Tiptap editor whose ProseMirror StarterKit
 *  schema strips everything not in the allowed set — no <script>, no event-handler
 *  attributes, no <img onerror>. This is the same sanitizer the legacy note editor
 *  uses, with zero new dependencies. */
function AgentNotesBlock({ art }: { art: Art }) {
  const value = art.elements["doc:agent"]?.value;
  const html = typeof value === "string" ? value : "";
  const author = art.elements["doc:agent"]?.updatedBy;
  if (!html.trim()) return null;
  return (
    <div className="r-agent-notes" data-testid="agent-notes-block" data-noderoom-surface="workSurface.agentNotes">
      <div className="r-agent-notes-head">
        <span className="r-agent-notes-badge">NodeRoom</span>
        <span className="muted tiny">agent-owned · append-only · approved</span>
        {author && <span className="muted tiny">by {author.name}</span>}
      </div>
      <SanitizedHtml html={html} className="r-agent-notes-body" />
    </div>
  );
}

/** Renders untrusted HTML safely by parsing it through a read-only Tiptap editor.
 *  ProseMirror's StarterKit schema discards any node/attribute/mark not in the
 *  allowed set (so <script>, <img onerror=…>, onclick=, javascript: URIs are
 *  dropped). Reuses the existing dependency; no DOMPurify needed. */
function SanitizedHtml({ html, className }: { html: string; className?: string }) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: html,
    editable: false,
    immediatelyRender: false,
  });
  useEffect(() => {
    if (editor && editor.getHTML() !== html) editor.commands.setContent(html);
  }, [editor, html]);
  if (!editor) return <div className={className} />;
  return (
    <div className={className} data-testid="sanitized-html">
      <EditorContent editor={editor} />
    </div>
  );
}

function Note({ roomId, me, art }: { roomId: string; me: Actor; art: Art }) {
  const store = useStore();
  const docValue = art.elements["doc"]?.value;
  if (isUploadedFileDoc(docValue)) return <FileViewer doc={docValue} />;
  const locked = !!lockedByOther(store, art.id, "doc", me);
  const docStr = String(art.elements["doc"]?.value ?? "");
  const [noteErr, setNoteErr] = useState<string | null>(null);
  const editor = useEditor({
    extensions: [StarterKit],
    content: docStr,
    editable: !locked,
    immediatelyRender: false,
    // Consume the CAS feedback so a lost/conflicted note write surfaces instead of silently reverting.
    onBlur: ({ editor }) => { void commit(store, roomId, me, art.id, "doc", editor.getHTML()).then((f) => setNoteErr(f && !f.ok ? editErrorMsg(f) : null)); },
  });
  // Re-sync the editor when a remote/agent write changes the doc while we're not editing, so the next local
  // edit commits against the current version instead of a guaranteed stale-baseVersion conflict.
  useEffect(() => {
    if (!editor || editor.isFocused) return;
    if (editor.getHTML() !== docStr) editor.commands.setContent(docStr);
  }, [editor, docStr]);
  useEffect(() => { editor?.setEditable(!locked); }, [editor, locked]);
  if (!editor) return <div className="r-art-body" />;
  return (
    <div className="r-art-body">
      {noteErr && <div className="r-wall-error" role="alert" data-testid="note-error">{noteErr}</div>}
      <div className="r-note" data-testid="note-editor"><EditorContent editor={editor} /></div>
      <AgentNotesBlock art={art} />
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

function FileViewer({ doc }: { doc: UploadedFileDoc }) {
  const isImage = doc.mimeType.startsWith("image/") && doc.dataUrl;
  const isPdf = doc.mimeType === "application/pdf" && doc.dataUrl;
  return (
    <div className="r-art-body r-file-viewer">
      <div className="r-file-viewer-head">
        <div>
          <div className="r-file-viewer-title">{doc.fileName}</div>
          {doc.parse && <div className="r-file-viewer-meta">{doc.parse.parser} + {doc.parse.fallbackParser ?? "none"} {doc.parse.lane.replace("_", " ")} | {doc.parse.status.replace(/_/g, " ")}</div>}
          <div className="r-file-viewer-meta">{doc.mimeType || "file"} · {formatBytes(doc.size)}</div>
        </div>
        {doc.dataUrl && <a className="r-btn ghost" href={doc.dataUrl} download={doc.fileName}>Download</a>}
      </div>
      {isImage ? <img className="r-file-image" src={doc.dataUrl} alt={doc.fileName} />
        : isPdf ? <iframe className="r-file-pdf" title={doc.fileName} src={doc.dataUrl} />
          : doc.text !== undefined ? <pre className="r-file-text">{doc.text}</pre>
            : <div className="r-file-empty">Preview is not available for this file type.</div>}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104_857.6) / 10} MB`;
}

function Wall({ roomId, me, art }: { roomId: string; me: Actor; art: Art }) {
  const store = useStore();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!err) return; const t = setTimeout(() => setErr(null), 3500); return () => clearTimeout(t); }, [err]);
  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const v = art.elements[id]?.value as { text: string; x: number; y: number; color: string } | undefined;
    if (v) void commit(store, roomId, me, art.id, id, { ...v, x: Math.max(0, v.x + e.delta.x), y: Math.max(0, v.y + e.delta.y) }).then((f) => { if (f && !f.ok) setErr(editErrorMsg(f)); });
  };
  const addSticky = async () => {
    const colors = ["#E8C9B8", "#F2DE9B", "#BFD8D5", "#CFC7E8", "#D7E7B5"];
    const i = art.order.length;
    const id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await createElement(store, roomId, me, art.id, id, {
      text: "New note",
      x: 28 + ((i * 34) % 360),
      y: 28 + ((i * 26) % 220),
      color: colors[i % colors.length],
    });
    if (!res.ok) setErr(editErrorMsg(res));
  };
  const removeSticky = async (id: string) => {
    const res = await deleteElement(store, roomId, me, art.id, id);
    if (res && !res.ok) setErr(editErrorMsg(res));
  };
  return (
    <div className="r-art-body">
      <div className="r-wall-toolbar">
        <button className="r-mini-btn primary" data-testid="postit-add" onClick={() => void addSticky()}><Plus size={12} /> Post-it</button>
        {err && <span className="r-wall-error" role="alert">{err}</span>}
      </div>
      <div className="r-wall-toolbar"><span className="muted tiny">drag to move · click text to edit</span></div>
      <DndContext onDragEnd={onDragEnd} modifiers={[restrictToParentElement]}>
        <div className="r-wall" data-testid="wall-canvas">
          {art.order.map((id, i) => {
            const el = art.elements[id]; if (!el) return null;
            const v = el.value as { text: string; x: number; y: number; color: string };
            return <Sticky key={id} roomId={roomId} me={me} artId={art.id} id={id} v={v} locked={!!lockedByOther(store, art.id, id, me)} author={el.updatedBy.name} rot={i % 2 ? 1.3 : -1.5} onDelete={removeSticky} onError={setErr} />;
          })}
        </div>
      </DndContext>
    </div>
  );
}

function Sticky({ roomId, me, artId, id, v, locked, author, rot, onDelete, onError }: { roomId: string; me: Actor; artId: string; id: string; v: { text: string; x: number; y: number; color: string }; locked: boolean; author: string; rot: number; onDelete: (id: string) => void; onError: (msg: string) => void }) {
  const store = useStore();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled: locked });
  // QA P2 perf: the drag style is rebuilt only when its real inputs change, not on every wall render.
  const style = useMemo<CSSProperties>(() => ({
    left: v.x, top: v.y, background: v.color,
    transform: `translate3d(${transform?.x ?? 0}px, ${transform?.y ?? 0}px, 0) rotate(${rot}deg)`,
    zIndex: isDragging ? 9 : undefined, boxShadow: isDragging ? "var(--shadow-lg)" : undefined,
  }), [v.x, v.y, v.color, transform?.x, transform?.y, rot, isDragging]);
  return (
    <div ref={setNodeRef} className={"r-postit" + (locked ? " locked" : "")} {...attributes} {...listeners}
      data-testid="post-it" data-postit-id={id}
      style={style}>
      <button className="r-postit-delete" data-testid="post-it-delete" disabled={locked} aria-label="Delete post-it" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(id); }}><Trash2 size={12} /></button>
      <div className="pt-text" data-testid="post-it-text" contentEditable={!locked} suppressContentEditableWarning role="textbox" aria-label="Edit post-it text"
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => { if (e.key === "Escape") (e.currentTarget as HTMLElement).blur(); }}
        onBlur={(e) => { const t = e.currentTarget.textContent ?? ""; if (t && t !== v.text) void commit(store, roomId, me, artId, id, { ...v, text: t }).then((f) => { if (f && !f.ok) onError(editErrorMsg(f)); }); }}>{v.text}</div>
      <div className="pby">— {author}</div>
    </div>
  );
}

function CollabBar({ collab }: { collab: CollabControls }) {
  const stateLabel = collab.done ? "Collaboration run complete" : collab.running ? "Collaboration running" : "Live collaboration";
  const runLabel = collab.done ? "Replay collaboration" : collab.running ? "Collaboration running" : "Run collaboration";
  return (
    <div className="r-collab-bar" aria-label={stateLabel}>
      <span className="r-tag r-collab-state" title={stateLabel} aria-label={stateLabel} style={{ background: "var(--accent-tint)", color: "var(--accent-ink)" }}><GitMerge size={12} /></span>
      {collab.error && <span className="r-tag" role="alert" data-testid="collab-error" style={{ color: "var(--danger-ink)" }}>{collab.error}</span>}
      {collab.onConflict && (
        <button className="r-iconbtn r-iconbtn-sm" data-testid="collab-conflict" disabled={collab.running} title="Create a stale agent draft" aria-label="Create stale agent draft" onClick={collab.onConflict}>
          <AlertTriangle size={13} />
        </button>
      )}
      <button className={"r-iconbtn r-iconbtn-sm " + (collab.done ? "" : "primary")} data-testid="collab-run" disabled={collab.running} title={runLabel} aria-label={runLabel} onClick={collab.onRun}>
        {collab.done ? <RotateCcw size={13} /> : collab.running ? <Activity size={13} /> : <Play size={13} />}
      </button>
    </div>
  );
}

function TraceStrip({ roomId, me }: { roomId: string; me: Actor }) {
  const store = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const [acceptingAll, setAcceptingAll] = useState(false);
  const [resolveMsg, setResolveMsg] = useState<string | null>(null);
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
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
  const shown = log.slice(-40);
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
          <History size={14} style={{ color: "var(--text-muted)" }} />
          <span className="h-title" style={{ fontSize: 12.5 }}>Room trace</span>
          <span className="mono tiny faint">{log.length} events</span>
          {!open && proposals.length > 0 && <span className="r-trace-badge">{proposals.length} to review</span>}
        </button>
        <span className="grow" />
        {run && <span className="r-trace-tele" title={`${run.steps} steps · ${run.inputTokens.toLocaleString()} in + ${run.outputTokens.toLocaleString()} out tokens · ${run.ms}ms`}>{run.model} · {run.toolCalls} tools · ${run.costUsd.toFixed(3)}</span>}
        {host && proposals.length > 1 && <button className="r-mini-btn primary" disabled={acceptingAll} onClick={() => void acceptAll()}><Check size={12} /> Accept all</button>}
      </div>
      {open && <div className="r-trace-list" ref={ref} onScroll={onScroll} aria-live="polite" aria-label="Room activity log">
        {resolveMsg && <div className="r-wall-error" role="alert" data-testid="proposal-resolve-msg" style={{ margin: "2px 4px" }}>{resolveMsg} <button className="r-msg-act" onClick={() => setResolveMsg(null)}>Dismiss</button></div>}
        {proposals.slice(0, 20).map((p) => <ProposalRow key={p.id} roomId={roomId} me={me} proposal={p} onResolved={(fb) => setResolveMsg(fb.ok ? null : proposalErrMsg(fb.reason))} />)}
        {proposals.length > 20 && <div className="tiny faint" style={{ padding: "2px 4px" }}>+{proposals.length - 20} more pending — resolve these first (mirrors the 40-row trace cap)</div>}
        {shown.length === 0 && <div className="tiny faint" style={{ padding: "2px 4px" }}>Edit a cell, move a sticky, or run the collaboration — every change is recorded here.</div>}
        {shown.map((t) => <TraceRow key={t.id} t={t} />)}
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
