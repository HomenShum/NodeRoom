/**
 * PeoplePanel — the room-level rung of the presence ladder (design:
 * design-reference/scale/scale-room.jsx `.sc-ppanel`): the top-bar facepile /
 * live chip opens this right-anchored panel with everyone in the room grouped
 * by role (Host / Members / Guests / Agents), each row carrying a live-location
 * line derived from that person's freshest presence claim ("Company research ·
 * owner"), and a Follow button per human member.
 *
 * Follow is a CLIENT-SIDE camera-follow: one bounded interval polls the store's
 * reactive presence for the followed member's freshest claim and, when their
 * target moves, (a) activates the artifact tab they are on — reusing the ⌘K
 * palette's DOM-contract tab activation (`[data-testid="artifact-filetab"]`
 * click) so pinned pseudo-tabs (Trace/Home/Graph) yield — and (b) focusStage()s
 * their cell. Esc or any MANUAL tab click stops following; if the member leaves
 * the room mid-follow the pill clears honestly instead of pointing at a ghost.
 *
 * The component stays mounted while the panel is closed so an active follow
 * (and its single interval) survives dismissing the panel; everything is torn
 * down on stop/unmount.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { useStore, type PresenceClaim, type RoomStore } from "../app/store";
import { focusStage } from "./stageFocus";
import type { Actor, AgentSession, Member } from "../engine/types";
import "./people-panel.css";

/** Poll cadence for camera-follow — coarse enough to be cheap, fast enough to feel live. */
export const FOLLOW_POLL_MS = 800;
/** The "double-rAF" settle window the palette uses, expressed as a timer so fake-timer tests
 *  and jsdom drive it deterministically (two frames ≈ 32ms). */
export const FOLLOW_FRAME_MS = 32;
/** Rows shown per role group before the "Show all N" reveal (guests collapse harder — specimen). */
const GROUP_ROW_CAP: Record<PersonRole, number> = { host: 6, member: 6, guest: 4, agent: 6 };

export type PersonRole = "host" | "member" | "guest" | "agent";
export type PersonRow = {
  id: string;
  name: string;
  color?: string;
  kind: "user" | "agent";
  role: PersonRole;
};
export type PeopleGroup = { key: PersonRole; label: string; rows: PersonRow[] };

/** Group room members + agent sessions into the panel's role groups (deterministic name order,
 *  agents deduped by agentId — one session row per agent, not per status update). */
export function groupPeople(members: readonly Member[], sessions: readonly AgentSession[]): PeopleGroup[] {
  const byName = (a: PersonRow, b: PersonRow) => (a.name === b.name ? (a.id < b.id ? -1 : 1) : a.name < b.name ? -1 : 1);
  const asRow = (m: Member, role: PersonRole): PersonRow => ({ id: m.id, name: m.name, color: m.color, kind: "user", role });
  const hosts = members.filter((m) => m.role === "host").map((m) => asRow(m, "host"));
  const regulars = members.filter((m) => m.role !== "host" && !m.anon).map((m) => asRow(m, "member"));
  const guests = members.filter((m) => m.role !== "host" && m.anon).map((m) => asRow(m, "guest"));
  const agentById = new Map<string, AgentSession>();
  for (const s of sessions) {
    const prev = agentById.get(s.agentId);
    if (!prev || s.updatedAt > prev.updatedAt) agentById.set(s.agentId, s);
  }
  const agents = [...agentById.values()].map((s): PersonRow => ({ id: s.agentId, name: s.agentName, kind: "agent", role: "agent" }));
  const groups: PeopleGroup[] = [
    { key: "host", label: "Host", rows: hosts.sort(byName) },
    { key: "member", label: "Members", rows: regulars.sort(byName) },
    { key: "guest", label: "Guests", rows: guests.sort(byName) },
    { key: "agent", label: "Agents", rows: agents.sort(byName) },
  ];
  return groups.filter((g) => g.rows.length > 0);
}

export type LiveLocation = {
  artifactId: string;
  artifactTitle: string;
  targetId: string;
  mode: PresenceClaim["mode"];
  updatedAt: number;
  /** Human line for the row: "Company research · owner". */
  text: string;
};

/** "sr_0004__owner" → "owner" (the column half is the readable part of a cell key). */
export function targetLabel(targetId: string): string {
  const sep = targetId.indexOf("__");
  return sep > 0 ? targetId.slice(sep + 2) : targetId;
}

type PresenceStoreSlice = Pick<RoomStore, "listArtifacts" | "listPresence">;

/** The freshest UNEXPIRED presence claim this actor holds anywhere in the room, resolved to a
 *  location line. Deterministic: newest updatedAt wins; exact ties break on claim id. */
export function liveLocationFor(actorId: string, roomId: string, store: PresenceStoreSlice, now: number = Date.now()): LiveLocation | null {
  let best: PresenceClaim | null = null;
  let bestTitle = "";
  for (const art of store.listArtifacts(roomId)) {
    for (const claim of store.listPresence(roomId, art.id)) {
      if (claim.actor?.id !== actorId) continue;
      if ((claim.expiresAt ?? Infinity) <= now) continue;
      if (!best || claim.updatedAt > best.updatedAt || (claim.updatedAt === best.updatedAt && claim.id < best.id)) {
        best = claim;
        bestTitle = art.title;
      }
    }
  }
  if (!best) return null;
  const artifactId = best.artifactId ?? "";
  return {
    artifactId,
    artifactTitle: bestTitle,
    targetId: best.targetId,
    mode: best.mode,
    updatedAt: best.updatedAt,
    text: `${bestTitle} · ${targetLabel(best.targetId)}`,
  };
}

export type PresenceStatus = "editing" | "viewing" | "running" | "idle";

/** Map a claim mode to the specimen's status vocabulary (.sc-pst editing/viewing/running/idle). */
export function statusFor(loc: LiveLocation | null): PresenceStatus {
  if (!loc) return "idle";
  if (loc.mode === "edit") return "editing";
  if (loc.mode === "focus") return "viewing";
  return "running"; // agent_intent / commit_lease — an agent actively working
}

function initialsOf(name: string): string {
  return name.replace(/[^A-Za-z· ]/g, "").split(/[ ·]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function PeoplePanel({ roomId, me, open, onClose, onOpenArtifact }: {
  roomId: string;
  me: Actor;
  open: boolean;
  onClose: () => void;
  /** RoomShell.openArtifact — activates the artifact tab state (and compact-layout panes). */
  onOpenArtifact: (id: string, opts?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  const store = useStore();
  const storeRef = useRef(store);
  storeRef.current = store;
  const onOpenRef = useRef(onOpenArtifact);
  onOpenRef.current = onOpenArtifact;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Partial<Record<PersonRole, boolean>>>({});
  const [following, setFollowing] = useState<PersonRow | null>(null);
  // Camera-follow plumbing: last applied target (so we only move when THEY move), a suppress
  // flag so our own programmatic filetab click is not mistaken for manual navigation, and the
  // one frame-settle timer (cleared before re-arming — never more than one in flight).
  const lastAppliedRef = useRef<string | null>(null);
  const suppressManualStopRef = useRef(false);
  const frameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFollow = useCallback(() => {
    lastAppliedRef.current = null;
    setFollowing(null);
  }, []);

  const applyFollowTarget = useCallback((loc: LiveLocation) => {
    suppressManualStopRef.current = true;
    onOpenRef.current(loc.artifactId);
    if (frameTimerRef.current) clearTimeout(frameTimerRef.current);
    // Palette DOM-contract (RoomShell.openWorkSurfaceTab pattern): after the tab strip settles,
    // click the followed artifact's filetab by its stable testid so a pinned pseudo-tab
    // (Trace/Home/Graph) yields the surface, then point the stage at their cell.
    frameTimerRef.current = setTimeout(() => {
      frameTimerRef.current = null;
      const title = storeRef.current.getArtifact(loc.artifactId)?.title;
      if (title && typeof document !== "undefined") {
        const tabs = document.querySelectorAll<HTMLElement>('[data-testid="artifact-tabs"] [data-testid="artifact-filetab"]');
        for (const tabEl of Array.from(tabs)) {
          if (tabEl.querySelector(".r-filetab-name")?.textContent === title) { tabEl.click(); break; }
        }
      }
      focusStage({ artifactId: loc.artifactId, elementId: loc.targetId });
      suppressManualStopRef.current = false;
    }, FOLLOW_FRAME_MS);
  }, []);

  // One follow session = ONE interval + two listeners, all torn down on stop/unmount.
  useEffect(() => {
    if (!following) return;
    const target = following;
    const tick = () => {
      const s = storeRef.current;
      const stillHere = target.kind === "agent"
        ? s.listSessions(roomId).some((a) => a.agentId === target.id)
        : s.listMembers(roomId).some((m) => m.id === target.id);
      if (!stillHere) { stopFollow(); return; } // they left — clear the pill honestly
      const loc = liveLocationFor(target.id, roomId, s);
      if (!loc || !loc.artifactId) return; // idle: hold the camera, don't fake movement
      const key = `${loc.artifactId}|${loc.targetId}`;
      if (lastAppliedRef.current === key) return;
      lastAppliedRef.current = key;
      applyFollowTarget(loc);
    };
    tick();
    const interval = setInterval(tick, FOLLOW_POLL_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") stopFollow(); };
    const onDocClick = (e: MouseEvent) => {
      if (suppressManualStopRef.current) return;
      const el = e.target as Element | null;
      if (el?.closest?.('[data-testid="artifact-tabs"], [data-testid="artifact-tabs-secondary"]')) stopFollow();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onDocClick, true);
    return () => {
      clearInterval(interval);
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick, true);
      if (frameTimerRef.current) { clearTimeout(frameTimerRef.current); frameTimerRef.current = null; }
    };
  }, [following, roomId, applyFollowTarget, stopFollow]);

  // Panel dismissal: Esc closes, and a pointer-down anywhere outside the panel/trigger closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCloseRef.current(); };
    const onDocPointer = (e: MouseEvent) => {
      const el = e.target as Element | null;
      if (el?.closest?.('[data-testid="people-panel"], [data-testid="people-trigger"]')) return;
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDocPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDocPointer, true);
    };
  }, [open]);

  const now = Date.now();
  const groups = useMemo(() => {
    if (!open) return [];
    return groupPeople(store.listMembers(roomId), store.listSessions(roomId));
  }, [open, store, roomId]);
  const q = query.trim().toLowerCase();

  const startFollow = (row: PersonRow) => {
    lastAppliedRef.current = null;
    setFollowing(row);
  };

  return (
    <>
      {open && (
        <div className="r-people-panel sc-ppanel" role="dialog" aria-label="People in this room" data-testid="people-panel">
          <div className="r-people-search sc-search">
            <Search size={13} />
            <input placeholder="Find people…" aria-label="Find people" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
            {query && <button type="button" aria-label="Clear people filter" onClick={() => setQuery("")}><X size={11} /></button>}
          </div>
          {groups.map((g) => {
            const named = q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)) : g.rows;
            if (named.length === 0) return null;
            // Active people float to the top of their group (freshest claim first): the panel
            // exists for "where is everyone / follow them", so a 60-member room must not bury
            // the two live cursors behind an alphabetical "Show all". Idle rows keep name order.
            const rows = named
              .map((row) => ({ row, loc: liveLocationFor(row.id, roomId, store, now) }))
              .sort((a, b) => (b.loc?.updatedAt ?? -1) - (a.loc?.updatedAt ?? -1));
            const cap = q ? 12 : GROUP_ROW_CAP[g.key];
            const shown = expanded[g.key] ? rows : rows.slice(0, cap);
            return (
              <div key={g.key} data-testid={`people-group-${g.key}`}>
                <div className="r-people-group sc-sec">{g.label}<span className="r-people-count sc-count">{rows.length}</span></div>
                {shown.map(({ row, loc }) => {
                  const st = statusFor(loc);
                  const isMe = row.kind === "user" && row.id === me.id;
                  return (
                    <div className="r-people-row sc-prow" key={row.id} data-testid="people-row" data-person-id={row.id}>
                      <span className={row.kind === "agent" ? "a agent" : "a"} style={{ background: row.color ?? "#8F3F27" }} aria-hidden="true">
                        {row.kind === "agent" ? "◆" : initialsOf(row.name)}
                      </span>
                      <span className="tx">
                        <span className="nm">{row.name}{isMe ? " (you)" : ""}</span>
                        <span className="mt" data-testid="people-location">{loc ? loc.text : "In the room"}</span>
                      </span>
                      <span className={`r-people-st sc-pst ${st}`}>{st}</span>
                      {row.kind === "user" && !isMe && loc && (
                        <button
                          type="button"
                          className="r-people-follow"
                          data-testid="people-follow"
                          aria-label={following?.id === row.id ? `Following ${row.name}` : `Follow ${row.name}`}
                          aria-pressed={following?.id === row.id}
                          onClick={() => (following?.id === row.id ? stopFollow() : startFollow(row))}
                        >
                          {following?.id === row.id ? "Following" : "Follow"}
                        </button>
                      )}
                    </div>
                  );
                })}
                {rows.length > shown.length && (
                  <button type="button" className="r-people-more" data-testid={`people-more-${g.key}`} onClick={() => setExpanded((cur) => ({ ...cur, [g.key]: true }))}>
                    Show all {rows.length}
                  </button>
                )}
              </div>
            );
          })}
          {groups.every((g) => (q ? g.rows.filter((r) => r.name.toLowerCase().includes(q)).length : g.rows.length) === 0) && (
            <div className="r-people-empty" data-testid="people-empty">No one matches “{query.trim()}”</div>
          )}
        </div>
      )}
      {following && (
        <div className="r-people-follow-pill" data-testid="follow-pill" role="status">
          Following {following.name} — Esc to stop
          <button type="button" aria-label="Stop following" onClick={stopFollow}><X size={11} /></button>
        </div>
      )}
    </>
  );
}
