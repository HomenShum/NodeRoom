/* ============================================================================
   NodeAgent Room Tour — RoomShell: adaptive 1→4 panel workspace + collab engine.
   Every artifact mutation (hand OR scripted agent) flows through one path that
   updates the artifact, appends a room-trace entry, and posts a chat activity.
   Ported from room/room.jsx (window.RRoom). Hardcoded pace = 1150ms (the
   prototype's "standard"); the live tweaks panel is intentionally skipped on
   the public route.
   ============================================================================ */
import * as React from "react";
import {
  PEOPLE, FILES, PUBLIC_CHAT, PRIVATE_CHAT, SHEET, WALL, NOTE_BLOCKS, COLLAB_BEATS,
  type ChatMessage, type WallNote, type Step, type CollabBeat,
} from "./roomTourData";
import { LeftRail, CenterChat, RightAgent, type FeedItem } from "./RoomTourPanels";
import {
  ArtifactPanel, type ArtifactTab, type SheetData, type SheetCellState, type TraceEntry, type WallData, type CollabBarProps,
} from "./RoomTourArtifact";
import type { IconName } from "./RoomTourIcons";

const PEOPLE_LIST = [PEOPLE.homen, PEOPLE.priya, PEOPLE.quokka, PEOPLE.room_na];
const TRACE_ICO: Record<string, IconName> = {
  lock: "lock", read: "eye", draft: "draft", commit: "gate", merge: "merge",
  trace: "history", note: "note", wall: "wall", edit: "draft",
};
const ROW_LABEL: Record<string, string | null> = {};
SHEET.rows.forEach((r) => { ROW_LABEL[r.id] = r.cells[0]; });
const isCommit = (e: TraceEntry): boolean => e.kind === "commit" || e.kind === "merge";
const PACE_MS = 1150;

function emptyCells(): Record<string, SheetCellState> {
  const c: Record<string, SheetCellState> = {};
  SHEET.rows.forEach((r) => { c[r.id] = { variance: null, note: null }; });
  return c;
}
function buildOverlay(beat: number): { locked: string[]; draft: string[] } {
  return {
    locked: (beat >= 1 && beat <= 3) ? ["r_rev", "r_cogs"] : [],
    draft:  (beat >= 3 && beat <= 4) ? ["r_gp", "r_ni"] : [],
  };
}

type RuntimeChat = ChatMessage & { activity?: boolean; icon?: IconName };
type RuntimeNoteBlock = (typeof NOTE_BLOCKS)[number] & { justAccepted?: boolean };
type RuntimeWallNote = WallNote & { fresh?: boolean };

export interface OpenPanels { left: boolean; artifact: boolean; right: boolean }

export function RoomShell({
  step,
  openPanels,
  autoAllow,
}: {
  step: Step;
  openPanels: OpenPanels;
  autoAllow: boolean;
}): React.ReactElement {
  const [pub, setPub] = React.useState<RuntimeChat[]>(() => PUBLIC_CHAT.slice());
  const [priv, setPriv] = React.useState<RuntimeChat[]>(() => PRIVATE_CHAT.slice());
  const [pubTyping, setPubTyping] = React.useState(false);
  const [privTyping, setPrivTyping] = React.useState(false);
  const [activeFile, setActiveFile] = React.useState("sheet_q3");
  const [tab, setTab] = React.useState<ArtifactTab>("sheet");

  const [cells, setCells] = React.useState<Record<string, SheetCellState>>(emptyCells);
  const [blocks, setBlocks] = React.useState<RuntimeNoteBlock[]>(() => NOTE_BLOCKS.map((b) => ({ ...b })));
  const [wall, setWall] = React.useState<RuntimeWallNote[]>(() => WALL.map((w) => ({ ...w })));
  const [trace, setTrace] = React.useState<TraceEntry[]>([]);
  const [pulse, setPulse] = React.useState<Record<string, boolean>>({});

  const [beat, setBeat] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [needsApprove, setNeedsApprove] = React.useState(false);
  const timer = React.useRef<number | undefined>(undefined);
  const pulseTimer = React.useRef<number | undefined>(undefined);
  const mid = React.useRef(100);
  const onCollab = step.id === "collab";

  React.useEffect(
    () => () => { window.clearTimeout(timer.current); window.clearTimeout(pulseTimer.current); },
    [],
  );
  React.useEffect(() => { if (onCollab) setTab("sheet"); }, [onCollab]);

  const pushPub = (who: string, text: string, extra?: Partial<RuntimeChat>): void =>
    setPub((m) => [...m, { id: "x" + mid.current++, who, text, t: "now", ...(extra || {}) } as RuntimeChat]);
  const pushPriv = (who: string, text: string, extra?: Partial<RuntimeChat>): void =>
    setPriv((m) => [...m, { id: "y" + mid.current++, who, text, t: "now", ...(extra || {}) } as RuntimeChat]);
  const activity = (icon: IconName, text: string, who?: string): void =>
    pushPub(who || "homen", text, { activity: true, icon });

  const firePulse = (keys: string[]): void => {
    const next: Record<string, boolean> = {};
    keys.forEach((k) => { next[k] = true; });
    setPulse(next);
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulse({}), 1500);
  };

  // Append a commit/merge entry, computing v{from}→v{to} from current trace.
  const appendVersioned = (
    make: (from: number, to: number) => TraceEntry,
    src?: string,
  ): void =>
    setTrace((prev) => {
      const v = 41 + prev.filter(isCommit).length;
      return [...prev, { ...make(v, v + 1), src: src || "manual" }];
    });
  const appendTrace = (e: TraceEntry, src?: string): void =>
    setTrace((prev) => [...prev, { ...e, src: src || "manual" }]);

  // ── hand edit: spreadsheet cell ───────────────────────────────────────────
  const editCell = (rowId: string, field: "variance" | "note", value: string): void => {
    const v = (value || "").trim();
    setCells((c) => ({ ...c, [rowId]: { ...c[rowId], [field]: v || null } }));
    firePulse([rowId + ":" + field]);
    if (!v) return;
    appendVersioned((from, to) => ({
      kind: "commit", ico: "gate", tool: "nodeagent.apply_spreadsheet_delta",
      text: "You set " + ROW_LABEL[rowId] + " · " + field + " = " + v + " · v" + from + " → v" + to,
      detail: "set_cell · stable row id " + rowId + " · null preserved",
    }));
    activity("sheet", "You edited " + ROW_LABEL[rowId] + " · " + field + " → " + v);
  };

  // ── hand edit: accept a drafted note block ────────────────────────────────
  const acceptBlock = (id: string): void => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, status: "accepted", justAccepted: true } : b)));
    appendTrace({ kind: "note", ico: "note", tool: "nodeagent.accept_block", text: "You accepted a drafted note block", detail: "notebookBlocks · status draft → accepted" });
    activity("note", "You accepted a drafted note block — now part of the note");
  };

  // ── hand edit: wall ───────────────────────────────────────────────────────
  const moveNote = (_id: string): void => {
    appendTrace({ kind: "wall", ico: "wall", tool: "nodeagent.move_wall_notes", text: "You moved a sticky on the wall", detail: "optimistic transform · one commit on pointerup" });
    activity("wall", "You moved a sticky on the wall");
  };
  const setNotePos = (id: string, x: number, y: number): void =>
    setWall((w) => w.map((n) => (n.id === id ? { ...n, x, y } : n)));
  const editNote = (id: string, text: string): void => {
    setWall((w) => w.map((n) => (n.id === id ? { ...n, text } : n)));
    appendTrace({ kind: "wall", ico: "wall", tool: "nodeagent.edit_wall_note", text: "You edited a sticky", detail: "wall note " + id });
    activity("wall", "You edited a sticky on the wall");
  };
  const addNote = (): void => {
    const id = "w" + mid.current++;
    setWall((w) => [...w, { id, x: 60 + (w.length % 3) * 60, y: 60 + Math.floor(w.length / 3) * 40, text: "New idea…", color: "#CBD2F0", by: "homen", fresh: true }]);
    appendTrace({ kind: "wall", ico: "wall", tool: "nodeagent.add_wall_note", text: "You added a sticky", detail: "wall note " + id });
    activity("wall", "You added a sticky to the wall");
  };

  // ── free chat ────────────────────────────────────────────────────────────
  const sendPublic = (text: string): void => {
    const ask = text.trim().startsWith("/ask");
    pushPub("homen", text, ask ? { ask: true } : undefined);
    if (ask) {
      setPubTyping(true);
      window.setTimeout(() => {
        setPubTyping(false);
        pushPub("room_na", "Gathering room context, then proposing a versioned delta through the sync tool. Open the spreadsheet and run the collaboration to watch me lock, commit, and release.", { agent: true });
      }, 1300);
    }
  };
  const sendPrivate = (text: string): void => {
    pushPriv("homen", text, { private: true });
    setPrivTyping(true);
    window.setTimeout(() => {
      setPrivTyping(false);
      pushPriv("my_na", "Reading the room context for that. This stays private to you — say “promote” and I’ll post it to the public chat.", { agent: true, private: true });
    }, 1200);
  };

  // ── collaboration engine (lock → read → draft → commit → merge) ──────────
  const applyBeat = (n: number): void => {
    const log = COLLAB_BEATS[n] && COLLAB_BEATS[n].log;
    if (n === 4 && log) {
      setCells((c) => ({
        ...c,
        r_rev:  { ...c.r_rev,  variance: "+24%"  },
        r_cogs: { ...c.r_cogs, variance: "+27.5%" },
      }));
      firePulse(["r_rev:variance", "r_cogs:variance"]);
      appendVersioned(
        (from, to) => ({ kind: "commit", ico: "gate", tool: log.tool, text: "Room NodeAgent commits Variance for Revenue, COGS · v" + from + " → v" + to, detail: log.detail }),
        "collab",
      );
      pushPub("room_na", "Committed Variance for Revenue and COGS through the sync tool. Lock released.", { agent: true });
    } else if (n === 5 && log) {
      setCells((c) => ({
        ...c,
        r_gp: { ...c.r_gp, variance: "+21.7%" },
        r_ni: { ...c.r_ni, variance: "+22.4%" },
      }));
      firePulse(["r_gp:variance", "r_ni:variance"]);
      appendVersioned(
        (from, to) => ({ kind: "merge", ico: "merge", tool: log.tool, text: "Smart-merge applies the held draft · v" + from + " → v" + to, detail: log.detail }),
        "collab",
      );
      pushPriv("my_na", "Smart-merged my drafted Variance for Gross profit and Net income on top of canonical state.", { agent: true, private: true });
    } else if (log) {
      appendTrace({ kind: log.kind, ico: TRACE_ICO[log.kind] || "dot", tool: log.tool, text: log.text, detail: log.detail }, "collab");
    }
  };
  const advance = React.useCallback((n: number, forced?: boolean): void => {
    if (n > 6) { setPlaying(false); return; }
    if (n === 5 && !autoAllow && !forced) { setNeedsApprove(true); setPlaying(false); return; }
    setBeat(n);
    applyBeat(n);
    if (n >= 6) { setPlaying(false); return; }
    timer.current = window.setTimeout(() => advance(n + 1), PACE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAllow]);

  const play = (): void => { setPlaying(true); advance(beat + 1); };
  const approve = (): void => { setNeedsApprove(false); setPlaying(true); advance(5, true); };
  const reset = (): void => {
    window.clearTimeout(timer.current);
    setBeat(0);
    setPlaying(false);
    setNeedsApprove(false);
    setTrace((t) => t.filter((e) => e.src !== "collab"));
    setCells((c) => ({
      ...c,
      r_rev:  { ...c.r_rev,  variance: null },
      r_cogs: { ...c.r_cogs, variance: null },
      r_gp:   { ...c.r_gp,   variance: null },
      r_ni:   { ...c.r_ni,   variance: null },
    }));
  };

  const overlay = onCollab ? buildOverlay(beat) : { locked: [], draft: [] };
  const version = 41 + trace.filter(isCommit).length;

  const sheet: SheetData = {
    rows: SHEET.rows.map((r) => ({ id: r.id, label: r.cells[0] || "", q2: r.cells[1], q3: r.cells[2] })),
    columns: SHEET.columns,
    cells,
    version,
    overlay,
    pulse,
  };
  const collabBar: CollabBarProps | null = onCollab ? {
    beat,
    desc: (COLLAB_BEATS[beat] as CollabBeat).desc,
    playing,
    onPlay: play,
    onReset: reset,
    needsApprove,
    onApprove: approve,
  } : null;

  const wallData: WallData = {
    notes: wall,
    onMove: moveNote,
    onSetPos: setNotePos,
    onEdit: editNote,
    onAdd: addNote,
  };
  const pubFeed: FeedItem[] = pub as FeedItem[];
  const privFeed: FeedItem[] = priv as FeedItem[];

  return (
    <div className="rt-workspace">
      {openPanels.left ? (
        <LeftRail
          key="left"
          files={FILES}
          activeFile={activeFile}
          onSelectFile={setActiveFile}
          people={PEOPLE_LIST}
        />
      ) : null}
      <CenterChat key="center" messages={pubFeed} people={PEOPLE} onSend={sendPublic} typing={pubTyping} />
      {openPanels.artifact ? (
        <ArtifactPanel
          key="art"
          tab={tab}
          onTab={setTab}
          sheet={sheet}
          onEditCell={editCell}
          note={{ blocks, onAccept: acceptBlock }}
          wallData={wallData}
          collabBar={collabBar}
          trace={trace}
        />
      ) : null}
      {openPanels.right ? (
        <RightAgent
          key="right"
          messages={privFeed}
          people={PEOPLE}
          onSend={sendPrivate}
          typing={privTyping}
        />
      ) : null}
    </div>
  );
}
