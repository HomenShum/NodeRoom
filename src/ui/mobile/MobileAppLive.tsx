/* ============================================================================
   NodeAgent Mobile — live store binding.
   Reads the live room from useStore() and reshapes it into the props MobileApp
   expects, then renders MobileApp with `live` set. This component always runs
   under a store provider (mounted by MobileRoot), so useStore() is safe here.
   Wired surfaces (this pass): room metadata + the public room chat (the wedge).
   Other panels remain sample data until their live wiring lands.
   ============================================================================ */
import { useCallback, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { FunctionReference } from "convex/server";
import { useStore, type ActorProof } from "../../app/store";
import type { Actor, Message, Member, CellStatus, Artifact, CellEvidence, CellPayload, TraceEvent } from "../../engine/types";
import type { RoomMsg, Person, AgentMsg, Row, Tone, InboxItem, Job, RecentItem, RecentSig, Plan, Evidence, EvidenceSupport, Coach, PipelineStage, TraceRow, ManageGroup, ManagedPerson, OfflineHold, NotifRow } from "./mobileData";
import { MOBILE_TRACE_MAX } from "./mobileData";
import type { MobileLive } from "./mobileTypes";
import { groupPeople, liveLocationFor } from "../PeoplePanel";
import { MobileApp } from "./MobileApp";

const AGENT_KEY = "room_na";

// convex/_generated lags until the next codegen — which must NOT be run casually
// (`npx convex codegen` against a cloud deployment DEPLOYS schema+functions).
// Same cast precedent as src/ui/NotificationsInbox.tsx watchesApi.
type WatchRowLive = { targetKind: "row" | "artifact"; targetId: string; updatedAt: number };
type RoomScopedArgs = { roomId: string; requester: ActorProof };
type SetWatchArgs = RoomScopedArgs & { targetKind: "row" | "artifact"; targetId: string; on: boolean };
const watchesApi = (api as unknown as {
  watches: {
    listWatches: FunctionReference<"query", "public", RoomScopedArgs, WatchRowLive[]>;
    setWatch: FunctionReference<"mutation", "public", SetWatchArgs, { on: boolean; changed: boolean }>;
  };
}).watches;

/** Map a room TraceEvent.type to the short chip vocabulary the mobile Trace sheet uses. */
function traceKind(type: TraceEvent["type"]): string {
  if (type === "edit_applied") return "commit";
  if (type === "edit_proposed" || type === "proposal_resolved" || type === "proposal_resolve_failed") return "proposal";
  if (type === "edit_blocked") return "blocked";
  if (type.startsWith("lock_")) return "lock";
  if (type.startsWith("agent_")) return "agent";
  if (type === "member_joined" || type === "room_created") return "room";
  if (type === "notebook_read_model") return "cite";
  return type.split("_")[0] || "event";
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function buildPeople(members: Member[]): Record<string, Person> {
  const out: Record<string, Person> = {
    [AGENT_KEY]: { short: "NA", name: "Room NodeAgent", color: "#C08A5E", agent: true },
  };
  for (const m of members) out[m.id] = { short: initials(m.name), name: m.name, color: m.color };
  return out;
}

// Live Message -> mobile RoomMsg. The rich summary/artifact card variants have no
// server shape (see the integration map's keepMock list); live messages render as
// plain chat / agent text, with agent authorship driving the agent styling.
function reshapeMessages(messages: Message[]): RoomMsg[] {
  return messages.map((m): RoomMsg => {
    // The store paints optimistic sends as "opt-<clientMsgId>" rows before the
    // server confirms — surface them as pending so the bubble reads as "sending".
    const optimistic = m.id.startsWith("opt-");
    return {
      id: m.id,
      who: m.author.kind === "agent" ? AGENT_KEY : m.author.id,
      kind: "msg",
      t: optimistic ? "now" : relTime(m.createdAt),
      text: m.text,
      ...(optimistic ? { pending: true, clientId: m.id } : {}),
    };
  });
}

// Live Message -> mobile AgentMsg (1:1 agent-convo style): user-authored -> user bubble,
// agent-authored -> agent text bubble.
function reshapeAgentMsgs(messages: Message[]): AgentMsg[] {
  return messages.map((m): AgentMsg =>
    m.author.kind === "user" ? { id: m.id, role: "user", text: m.text } : { id: m.id, role: "agent", variant: "text", text: m.text });
}

// ── live CardioNova row (the Company research sheet) ────────────────────────
const RESEARCH_ROW = "rc_cardionova";
const ROW_FIELDS: { col: string; label: string }[] = [
  { col: "intent", label: "Product" },
  { col: "funding", label: "Funding" },
  { col: "headcount", label: "Headcount" },
  { col: "owner", label: "Contact" },
];

// A cell's value is either a raw seed string or an enriched CellPayload { value, status, evidence }.
function cellPayload(value: unknown): { value: unknown; status?: CellStatus } {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return value as { value: unknown; status?: CellStatus };
  }
  return { value };
}
function fullCellPayload(value: unknown): CellPayload {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) return value as CellPayload;
  return { value };
}
function cellDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
function cellTone(s?: CellStatus): Tone {
  if (s === "complete") return "ok";
  if (s === "needs_review" || s === "running") return "warn";
  if (s === "gap" || s === "failed") return "bad";
  return "mute";
}

// Live room artifacts -> Home recents. Real titles/kinds/edit-times; the sheet
// signature samples the first cells' tones (elements are already loaded).
function buildRecents(artifacts: Artifact[]): RecentItem[] {
  return artifacts.slice(0, 8).map((a): RecentItem => {
    const icon = a.kind === "sheet" ? "table" : a.kind === "wall" ? "layers" : "note";
    const count = a.order?.length ?? Object.keys(a.elements).length;
    const sig: RecentSig =
      a.kind === "sheet"
        ? { type: "sheet", cells: Object.values(a.elements).slice(0, 12).map((e) => cellTone(cellPayload(e.value).status)) }
        : { type: a.kind };
    return {
      id: a.id,
      icon,
      title: a.title,
      meta: relTime(a.updatedAt) + " · " + count + (a.kind === "sheet" ? " cells" : " blocks"),
      kind: a.kind,
      peek: "Opens on desktop",
      sig,
    };
  });
}

function sourceHost(e: CellEvidence): string | undefined {
  const raw = e.url || e.source;
  if (!raw) return undefined;
  try { return new URL(raw).hostname.replace(/^www\./, ""); } catch { return raw.replace(/^https?:\/\//, "").split(/[/?#]/)[0]; }
}

function supportFromEvidence(e: CellEvidence, idx: number, claim: string, status?: CellStatus): EvidenceSupport {
  return {
    kind: "cite",
    n: String(idx + 1),
    text: e.label || e.snippet || claim,
    host: sourceHost(e),
    verified: status === "complete" || (e.confidence ?? 0) >= 0.72,
    srcType: e.kind,
    url: e.url,
    excerpt: e.snippet,
  };
}

function buildLiveEvidence(artifacts: Artifact[]): Evidence {
  const support: EvidenceSupport[] = [];
  const gaps: EvidenceSupport[] = [];
  for (const artifact of artifacts) {
    for (const id of artifact.order.length ? artifact.order : Object.keys(artifact.elements)) {
      const el = artifact.elements[id];
      const payload = fullCellPayload(el?.value);
      const value = cellDisplay(payload.value);
      const claim = `${artifact.title} ${id}: ${value}`.slice(0, 120);
      for (const ev of (payload.evidence ?? []).slice(0, 2)) {
        if (support.length < 6) support.push(supportFromEvidence(ev, support.length, claim, payload.status));
      }
      if ((payload.status === "gap" || payload.status === "needs_review" || payload.status === "failed") && gaps.length < 4) {
        gaps.push({ kind: "gap", text: `${artifact.title} ${id} is ${payload.status}${value !== "-" ? `: ${value}` : ""}`.slice(0, 140) });
      }
      if (support.length >= 6 && gaps.length >= 4) break;
    }
    if (support.length >= 6 && gaps.length >= 4) break;
  }
  const total = support.length;
  const gapCount = gaps.length;
  const supportList: EvidenceSupport[] = total ? [...support, ...gaps] : [{ kind: "gap", text: "No source-backed cells are present in this room yet." }];
  return {
    claim: total ? "Live room evidence" : "No evidence yet",
    status: gapCount ? "needs_review" : total ? "source-backed" : "empty",
    answer: total
      ? `${total} cited source${total === 1 ? "" : "s"} found across the room. ${gapCount ? `${gapCount} item${gapCount === 1 ? "" : "s"} still need review.` : "No flagged gaps found in the sampled cells."}`
      : "Upload a source, run NodeAgent, or fill source-backed cells to populate this evidence sheet.",
    support: supportList,
    followups: [
      { match: ["source", "cite", "citation"], text: total ? "Open any source row above to inspect the citation. Desktop can show the source side by side with the work surface." : "There are no citations yet. Start with a source upload or a read-only agent run." },
      { match: ["gap", "missing", "review"], text: gapCount ? gaps.map((g) => g.text).join(" ") : "No sampled evidence gaps are currently flagged." },
      { match: ["close", "fix"], text: "Close gaps by attaching a primary source, rerunning evidence extraction, then approving the proposed change from the review queue." },
    ],
    fallback: "This evidence sheet is derived from the live room artifacts, not the standalone sample data.",
  };
}

function buildLivePlan(artifacts: Artifact[], proposals: InboxItem[], job: { status?: string; entrypoint?: string; modelPolicy?: string } | null | undefined): Plan {
  const readable = artifacts.slice(0, 5).map((a) => `${a.title} (${a.kind})`);
  const pending = proposals.length;
  const running = job && !["completed", "failed", "cancelled", "blocked", "paused"].includes(job.status ?? "");
  return {
    hash: `live-${artifacts.length}-${pending}`,
    entity: artifacts.find((a) => a.title.includes("Company"))?.title ?? "this room",
    willRead: readable.length ? readable : ["Room chat and any uploaded source files"],
    wontRead: ["Private agent lanes", "External data not explicitly fetched", "Anything outside this room"],
    willCreate: [
      pending ? `Resolve ${pending} pending proposal${pending === 1 ? "" : "s"}` : "Propose source-backed changes before writing",
      running ? `Track ${job?.entrypoint ?? "agent job"} until completion` : "Keep evidence and trace receipts attached",
    ],
    stats: [
      { v: String(artifacts.length), l: "artifacts", mono: true },
      { v: String(pending), l: "reviews", mono: true },
      { v: job?.modelPolicy ?? "room", l: running ? "running" : "scope", mono: false },
    ],
  };
}

function buildLiveCoach(evidence: Evidence, artifacts: Artifact[], proposals: InboxItem[]): Coach {
  const gap = evidence.support.find((s) => s.kind === "gap")?.text;
  const topic = gap || (proposals.length ? "pending agent edit" : artifacts[0]?.title ?? "room evidence");
  return {
    topics: [
      {
        id: "live-evidence",
        label: "Evidence defense",
        question: `Explain the current evidence status for ${topic}.`,
        howto: [
          "Name the claim or artifact.",
          "State which source supports it.",
          "Call out any missing primary source.",
          "Say the action that would move it to verified.",
        ],
        feedback: {
          well: "You anchored the answer to the live room evidence.",
          missed: gap ? "Be precise about the missing source: " + gap : "Mention the exact artifact or citation you inspected.",
          cite: evidence.support.find((s) => s.kind === "cite")?.text ?? "Attach a primary source before calling the claim verified.",
          wording: evidence.status === "source-backed" ? "This claim is source-backed in the room and can be defended with the cited artifact." : "This claim remains needs_review until the missing source is attached and the evidence check reruns.",
        },
      },
    ],
  };
}

export function MobileAppLive({ roomId, me, proof, onLeave }: { roomId: string; me: Actor; proof?: ActorProof; onLeave?: () => void }) {
  const store = useStore();
  const room = store.getRoom(roomId);
  // First-load signal: in the Convex store getRoom() is the ONLY accessor that
  // returns undefined until the first server round-trip (every other accessor
  // coalesces to []). Memory mode is synchronous so room is never undefined and
  // loading stays false. Anti-blank guard: meta is reactive and can transiently
  // flip back to undefined on re-subscribe (room switch / token refresh); hold
  // the last non-undefined room in a ref and only report loading on the genuine
  // first load (no cached data yet), never on a transient undefined mid-session.
  const lastRoom = useRef(room);
  if (room !== undefined) lastRoom.current = room;
  const loading = lastRoom.current === undefined;
  const members = store.listMembers(roomId);
  const messages = store.listMessages(roomId, "public");
  const privateMsgs = store.listMessages(roomId, { private: me.id });

  const artifacts = store.listArtifacts(roomId);
  const researchSheet = artifacts.find((a) => a.kind === "sheet" && a.title === "Company research");
  const researchArt = researchSheet ? store.getArtifact(researchSheet.id) : undefined;
  const liveRow: Row = useMemo(() => ({
    entity: "CardioNova",
    sub: "healthtech · row in Company research",
    fields: researchArt
      ? ROW_FIELDS.map(({ col, label }) => {
          const elementId = `${RESEARCH_ROW}__${col}`;
          const el = researchArt.elements[elementId];
          const p = cellPayload(el?.value);
          return { k: label, v: cellDisplay(p.value), status: p.status ?? "", tone: cellTone(p.status), elementId, version: el?.version ?? 0 };
        })
      : [],
  }), [researchArt]);
  const editRowField = async (elementId: string, value: string, baseVersion: number) => {
    if (!researchSheet) return { ok: false, reason: "no_sheet" };
    return store.applyEdit({ roomId, op: { opId: crypto.randomUUID(), artifactId: researchSheet.id, elementId, kind: "set", value, baseVersion }, actor: me });
  };

  const proposals = store.listProposals(roomId);
  const job = store.lastLongFreeJob();
  const isHost = members.some((m) => m.id === me.id && m.role === "host");
  const inboxItems: InboxItem[] = useMemo(() => proposals.map((p): InboxItem => ({
    id: p.id,
    icon: "sparkles",
    tone: "accent",
    title: "Agent edit proposed",
    sub: "Cell " + p.op.elementId + " · approve before it lands",
    status: "approve",
    statusTone: "warn",
    time: relTime(p.createdAt),
    kind: "plan",
    preview: "doc",
  })), [proposals]);
  const jobs: { running: Job[]; queued: Job[]; completed: Job[] } = useMemo(() => {
    const oneJob: Job | null = job
      ? { id: job.id, title: job.entrypoint ?? "Agent job", sub: job.status + (job.error ? " · " + job.error : ""), cost: "", route: job.modelPolicy as Job["route"], trace: job.id }
      : null;
    const out: { running: Job[]; queued: Job[]; completed: Job[] } = { running: [], queued: [], completed: [] };
    if (job && oneJob) {
      const s = job.status;
      const bucket = s === "running" ? "running" : s === "queued" || s === "paused" || s === "blocked" || s === "retrying" ? "queued" : "completed";
      out[bucket].push(oneJob);
    }
    return out;
  }, [job]);
  const liveEvidence = useMemo(() => buildLiveEvidence(artifacts), [artifacts]);
  const livePlan = useMemo(() => buildLivePlan(artifacts, inboxItems, job), [artifacts, inboxItems, job]);
  const liveCoach = useMemo(() => buildLiveCoach(liveEvidence, artifacts, inboxItems), [liveEvidence, artifacts, inboxItems]);

  // ── gap pack: pipeline (same live data the desktop pipeline bar reads) ──
  // Intake = any artifact rows exist; Evidence = any source-backed cell; Draft =
  // an agent job is running; Review = pending proposals; Export = nothing left
  // to review and something to export. Honest states, no faked completion.
  const sessions = store.listSessions(roomId);
  const pipeline: PipelineStage[] = useMemo(() => {
    const sheet = artifacts.find((a) => a.kind === "sheet");
    const rowCount = sheet ? (sheet.order.length ? sheet.order.length : Object.keys(sheet.elements).length) : 0;
    let cited = 0, review = 0;
    for (const a of artifacts) {
      for (const id of a.order.length ? a.order : Object.keys(a.elements)) {
        const p = fullCellPayload(a.elements[id]?.value);
        if ((p.evidence?.length ?? 0) > 0) cited += 1;
        if (p.status === "needs_review" || p.status === "gap" || p.status === "failed") review += 1;
      }
    }
    const running = job && !["completed", "failed", "cancelled", "blocked", "paused"].includes(job.status ?? "");
    const pending = inboxItems.length;
    const intakeDone = rowCount > 0;
    const evidenceDone = cited > 0;
    return [
      { key: "intake", label: "Intake", state: intakeDone ? "done" : "on", meta: rowCount ? `${rowCount} rows` : "waiting" },
      { key: "evidence", label: "Evidence", state: evidenceDone ? "done" : intakeDone ? "on" : "todo", meta: cited ? `${cited} sourced` : "" },
      { key: "draft", label: "Draft", state: running ? "on" : evidenceDone ? "done" : "todo", meta: running ? "agent working" : "" },
      { key: "review", label: "Review", state: pending ? "on" : "todo", meta: pending ? `${pending} waiting` : review ? `${review} flagged` : "0 waiting" },
      { key: "export", label: "Export", state: intakeDone && pending === 0 ? "on" : "todo", meta: "" },
    ];
  }, [artifacts, job, inboxItems.length]);

  // ── gap pack: recent trace rows (bounded — agentic-reliability BOUND) ──
  const traceRows: TraceRow[] = useMemo(() => {
    const events = store.listTraces(roomId);
    return events
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, MOBILE_TRACE_MAX)
      .map((e): TraceRow => ({ id: e.id, kind: traceKind(e.type), text: e.summary, time: relTime(e.ts) }));
  }, [store, roomId]);

  // ── gap pack: role-grouped people + live location (same as desktop PeoplePanel) ──
  const peopleGroups: ManageGroup[] = useMemo(() => {
    const groups = groupPeople(members, sessions);
    return groups.map((g): ManageGroup => ({
      key: g.key,
      label: g.label,
      rows: g.rows.map((r): ManagedPerson => {
        const loc = r.kind === "user" ? liveLocationFor(r.id, roomId, store) : null;
        return {
          id: r.id,
          name: r.name,
          short: initials(r.name),
          color: r.color,
          role: g.key,
          location: loc?.text ?? "",
        };
      }),
    }));
  }, [members, sessions, roomId, store]);

  // ── gap pack: offline hold snapshot (store owns the real queue) ──
  const offline: OfflineHold | undefined = store.offlineEditQueue ? store.offlineEditQueue() : undefined;

  // ── gap pack: auto-allow (real room flag; toggle hits the store) ──
  const autoAllow = room?.autoAllow ?? false;
  const setAutoAllow = useCallback((next: boolean) => {
    // toggleAutoAllow flips; only fire when the desired state differs from current.
    if (next !== (room?.autoAllow ?? false)) store.toggleAutoAllow(roomId, me);
  }, [store, roomId, me, room?.autoAllow]);

  // ── gap pack: watches (wave-2 backend via typed-cast) ──
  const watchArgs = proof ? { roomId: roomId as never, requester: proof } : "skip";
  const watchRowsQ = useQuery(watchesApi.listWatches, watchArgs) ?? [];
  const setWatchMut = useMutation(watchesApi.setWatch);
  const watchedRowIds = useMemo(
    () => new Set(watchRowsQ.filter((w) => w.targetKind === "row").map((w) => w.targetId)),
    [watchRowsQ],
  );
  const notifBacked = !!proof;
  const notifRows: NotifRow[] = useMemo(() => {
    const watching = watchedRowIds.size;
    return [
      { label: "@mentions of you", mode: "instant", on: true, backed: false },
      { label: "Rows you watch", mode: "instant", on: watching > 0, backed: notifBacked },
      { label: "Agent run summaries", mode: "hourly", on: true, backed: false },
      { label: "Everything else", mode: "daily digest", on: false, backed: false },
    ];
  }, [watchedRowIds, notifBacked]);

  // Per-render reshapes memoized so re-renders that don't change the underlying
  // store data (e.g. a sibling state toggle) don't recompute identical arrays.
  // Results are byte-identical to the inline calls; deps are the exact inputs.
  const roomMsgs = useMemo(() => reshapeMessages(messages), [messages]);
  const people = useMemo(() => buildPeople(members), [members]);
  const recents = useMemo(() => buildRecents(artifacts), [artifacts]);
  const agentPrivate = useMemo(() => reshapeAgentMsgs(privateMsgs), [privateMsgs]);
  const agentRoom = useMemo(
    () => reshapeAgentMsgs(messages.filter((m) => m.author.kind === "agent" || m.author.id === me.id)),
    [messages, me.id],
  );

  const live: MobileLive = {
    roomName: room?.title ?? "Room",
    roomCode: room?.code ?? "",
    liveCount: members.length,
    roomMsgs,
    people,
    recents,
    plan: livePlan,
    evidence: liveEvidence,
    coach: liveCoach,
    postRoomMessage: async (text: string) => {
      return store.postMessage({ roomId, channel: "public", author: me, text, clientMsgId: crypto.randomUUID(), kind: "chat" });
    },
    agentPrivate,
    agentRoom,
    askPrivateAgent: async (goal: string) => {
      void store.postMessage({ roomId, channel: { private: me.id }, author: me, text: goal, clientMsgId: crypto.randomUUID(), kind: "chat" });
      try {
        await store.askPrivateAgent({ goal });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "agent_failed" };
      }
    },
    askRoomAgent: async (goal: string) => {
      void store.postMessage({ roomId, channel: "public", author: me, text: goal, clientMsgId: crypto.randomUUID(), kind: "chat" });
      try {
        await store.askAgent({ goal });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "agent_failed" };
      }
    },
    row: liveRow,
    editRowField,
    inboxItems,
    jobs,
    canApprove: isHost,
    resolveProposalById: async (id, approve) => {
      try {
        const r = await store.resolveProposal(id, approve, me);
        return r.ok ? { ok: true } : { ok: false, reason: r.reason };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "approve_failed" };
      }
    },
    jobAct: async (id, action) => {
      const r = action === "cancel" ? await store.cancelLongFreeJob(id) : await store.retryLongFreeJob(id);
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    },
    onLeave,
    loading,

    // ── gap pack ──
    pipeline,
    traceRows,
    peopleGroups,
    inviteCode: room?.code ?? "",
    offline,
    acknowledgeOfflineConflicts: store.acknowledgeOfflineConflicts,
    autoAllow,
    setAutoAllow,
    notifRows,
    notifBacked,
    watchRow: async (rowId: string, on: boolean) => {
      if (!proof) return { ok: false, reason: "no_proof" };
      try {
        await setWatchMut({ roomId: roomId as never, requester: proof, targetKind: "row", targetId: rowId, on });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "watch_failed" };
      }
    },
    isRowWatched: (rowId: string) => watchedRowIds.has(rowId),
    flagRowNeedsReview: async (rowId: string) => {
      // Route through the existing CAS edit path: set the row's status column to
      // needs_review. Uses the research sheet the row belongs to when present.
      if (!researchSheet) return { ok: false, reason: "no_sheet" };
      const elementId = `${rowId}__status`;
      const el = researchArt?.elements[elementId];
      const baseVersion = el?.version ?? 0;
      return store.applyEdit({
        roomId,
        op: { opId: crypto.randomUUID(), artifactId: researchSheet.id, elementId, kind: "set", value: "needs_review", baseVersion },
        actor: me,
      });
    },
  };

  return <MobileApp live={live} />;
}
