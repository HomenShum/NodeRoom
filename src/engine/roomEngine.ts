/**
 * RoomEngine — the deterministic, in-memory implementation of the NodeRoom
 * collaboration contract (the same contract Convex implements in production;
 * see convex/schema.ts). It runs with no backend and no keys so the spike is
 * fully demoable; swapping in Convex is a transport change, not a logic change.
 *
 * What it owns (the 8 walkthrough points, in code):
 *   - rooms + anonymous join                     (point 3)
 *   - artifacts: sheet / note / wall             (point 5)
 *   - per-element version CAS                    (point 8 — optimistic concurrency)
 *   - locks on an affected range (read-only)     (point 8 — the lock tool)
 *   - drafts + smart-merge on unlock             (point 8 — draft-for-merge)
 *   - agent sessions + cross-agent awareness     (point 8 — agents aware of each other)
 *   - per-room traces/logs                       (point 8 — traces preserved)
 *   - auto-allow (auto-approve vs proposal)      (point 8 — toggle)
 *   - public + private message channels          (points 4, 6)
 *
 * Reliability: every collection bounded; every op idempotent (opId / clientMsgId);
 * CAS conflicts + lock denials returned as DATA (never thrown); deterministic
 * (injectable clock + id counter) so the engine tests are byte-stable.
 */

import { deterministicResolver } from "./merge";
import { deriveArtifactMeta } from "./artifactMeta";
import { normalizeColumns, columnIdOfElement, type ColumnInput } from "./columns";
import {
  buildSemanticConflictPacket,
  formulaOf,
  resolveSemanticConflictPacket,
  type SemanticConflictPacket,
  type SemanticResolution,
} from "../nodeagent/skills/spreadsheet/semanticRebase";
import type {
  Actor, AgentScope, AgentSession, Artifact, ArtifactKind, Channel, ChangeOp, DataframeColumn,
  Draft, EditResult, Element, Lock, LockResult, Member, MergeResolution, Message,
  Proposal, ResearchRowInput, Room, SmartResolver, ToolPart, TraceEvent, TraceType,
} from "./types";

const MAX_TRACES = 2000;
const MAX_MESSAGES = 5000;
const MEMBER_COLORS = ["#8F3F27", "#315DA8", "#2F6B44", "#6D3FB2", "#80631F", "#A34B2E"];
const RESEARCH_ROW_COLS = [
  "company", "website", "status", "tier", "intent", "owner", "crm_status",
  "summary", "funding", "headcount", "recent_signal", "source", "source2", "last_researched",
] as const;

export interface MergeOutcome {
  draftId: string;
  applied: string[];
  conflicts: MergeResolution["conflicts"];
  resolution: MergeResolution;
  semantic?: { conflictId: string; resolution: SemanticResolution; proposalIds: string[] };
}

function stableValueKey(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function samePendingProposal(p: Proposal, roomId: string, op: ChangeOp, actor: Actor): boolean {
  return p.status === "pending"
    && p.roomId === roomId
    && p.artifactId === op.artifactId
    && p.author.kind === actor.kind
    && p.author.id === actor.id
    && p.op.elementId === op.elementId
    && p.op.kind === op.kind
    && p.op.baseVersion === op.baseVersion
    && stableValueKey(p.op.value) === stableValueKey(op.value);
}

export class RoomEngine {
  private rooms = new Map<string, Room>();
  private membersByRoom = new Map<string, Member[]>();
  private artifacts = new Map<string, Artifact>();
  private readonly LOCK_TTL_MS = 5 * 60_000; // lease TTL — a crashed holder's lock auto-expires (no cell blocks forever)
  private locks = new Map<string, Lock>();
  private drafts = new Map<string, Draft>();
  private semanticConflicts = new Map<string, SemanticConflictPacket>();
  private sessions = new Map<string, AgentSession>();
  private proposals = new Map<string, Proposal>();
  private appliedOps = new Set<string>();
  private seenClientMsg = new Set<string>();
  private traces: TraceEvent[] = [];
  private messages: Message[] = [];

  private idc = 0;
  private clock: () => number;
  private resolver: SmartResolver;
  private listeners = new Set<() => void>();

  constructor(opts?: { now?: () => number; resolver?: SmartResolver; startId?: number }) {
    // Deterministic clock by default (tests). UI passes Date.now.
    let t = 1_750_000_000_000;
    this.clock = opts?.now ?? (() => (t += 1000));
    this.resolver = opts?.resolver ?? deterministicResolver;
    this.idc = opts?.startId ?? 0;
  }

  /* ───────── reactivity (mirrors a Convex subscription) ───────── */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() { for (const fn of this.listeners) fn(); }
  private now() { return this.clock(); }
  private id(prefix: string) { return `${prefix}_${++this.idc}`; }

  /* ───────── rooms + people (points 2, 3) ───────── */
  createRoom(args: { title: string; hostName: string; autoAllow?: boolean }): { room: Room; host: Member } {
    const now = this.now();
    const roomId = this.id("room");
    const code = this.makeCode();
    const room: Room = {
      id: roomId, code, title: args.title, hostId: "", autoAllow: args.autoAllow ?? false,
      status: "live", createdAt: now,
    };
    const host: Member = {
      id: this.id("mem"), roomId, name: args.hostName, role: "host", anon: false,
      color: MEMBER_COLORS[0], lastSeenAt: now,
    };
    room.hostId = host.id;
    this.rooms.set(roomId, room);
    this.membersByRoom.set(roomId, [host]);
    this.trace(roomId, actorOf(host), "room_created", `${args.hostName} created "${args.title}"`, { code });
    this.emit();
    return { room, host };
  }

  /** Anonymous join by code — no account required (point 3). */
  joinRoom(args: { code: string; name: string; anon?: boolean }): { room: Room; member: Member } | null {
    const room = [...this.rooms.values()].find((r) => r.code === args.code && r.status === "live");
    if (!room) return null;
    const members = this.membersByRoom.get(room.id)!;
    const member: Member = {
      id: this.id("mem"), roomId: room.id, name: args.name, role: "member",
      anon: args.anon ?? true, color: MEMBER_COLORS[members.length % MEMBER_COLORS.length], lastSeenAt: this.now(),
    };
    members.push(member);
    this.trace(room.id, actorOf(member), "member_joined", `${args.name} joined${member.anon ? " (anon)" : ""}`);
    this.emit();
    return { room, member };
  }

  toggleAutoAllow(roomId: string, by: Actor): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;
    room.autoAllow = !room.autoAllow;
    this.trace(roomId, by, "auto_allow_toggled", `Auto-allow ${room.autoAllow ? "ON" : "OFF"}`);
    this.emit();
    return room.autoAllow;
  }

  getRoom(roomId: string) { return this.rooms.get(roomId); }
  listMembers(roomId: string): Member[] { return this.membersByRoom.get(roomId) ?? []; }

  /* ───────── artifacts (point 5) ───────── */
  createArtifact(args: { roomId: string; kind: ArtifactKind; title: string; seed?: Array<{ id: string; value: unknown }>; meta?: Artifact["meta"]; by: Actor; visibility?: Artifact["visibility"] }): Artifact {
    const now = this.now();
    const id = this.id("art");
    const elements: Record<string, Element> = {};
    const order: string[] = [];
    for (const s of args.seed ?? []) {
      elements[s.id] = { id: s.id, version: 1, value: s.value, updatedAt: now, updatedBy: args.by };
      order.push(s.id);
    }
    const art: Artifact = { id, roomId: args.roomId, kind: args.kind, title: args.title, version: 1, elements, order, updatedAt: now, createdBy: args.by, visibility: args.visibility ?? "room", meta: args.meta };
    // Agent-managed topic + metadata from content (feeds the OKF/RAG embedding); never leaves a raw filename.
    const derived = deriveArtifactMeta(art);
    if (derived.title) art.title = derived.title;
    if (derived.summary || derived.tags) art.meta = { ...art.meta, ...(derived.summary ? { summary: derived.summary } : {}), ...(derived.tags ? { tags: derived.tags } : {}) };
    this.artifacts.set(id, art);
    this.emit();
    return art;
  }
  /** Owner-gated visibility toggle (private <-> room). Mirrors convex/artifacts.setArtifactVisibility. */
  setArtifactVisibility(args: { roomId: string; artifactId: string; visibility: "private" | "room"; by: Actor }): { ok: boolean; error?: string } {
    const art = this.artifacts.get(args.artifactId);
    if (!art || art.roomId !== args.roomId) return { ok: false, error: "not_found" };
    const owns = !!art.createdBy && (art.createdBy.id === args.by.id || art.createdBy.ownerId === args.by.id);
    if (!owns || art.visibility === "public") return { ok: false, error: "forbidden" };
    art.visibility = args.visibility;
    art.updatedAt = this.now();
    this.emit();
    return { ok: true };
  }
  /** Owner-gated topic/metadata edit. Mirrors convex/artifacts.setArtifactMeta. */
  setArtifactMeta(args: { roomId: string; artifactId: string; title?: string; summary?: string; tags?: string[]; by: Actor }): { ok: boolean; error?: string } {
    const art = this.artifacts.get(args.artifactId);
    if (!art || art.roomId !== args.roomId) return { ok: false, error: "not_found" };
    const owns = !!art.createdBy && (art.createdBy.id === args.by.id || art.createdBy.ownerId === args.by.id);
    if (!owns && args.by.kind !== "agent") return { ok: false, error: "forbidden" };
    if (args.title && args.title.trim()) art.title = args.title.trim().slice(0, 120);
    if (args.summary !== undefined || args.tags !== undefined) {
      art.meta = { ...art.meta, ...(args.summary !== undefined ? { summary: args.summary } : {}), ...(args.tags !== undefined ? { tags: args.tags } : {}) };
    }
    art.updatedAt = this.now();
    this.emit();
    return { ok: true };
  }

  /**
   * Agent-governed SCHEMA edit, CAS-guarded on the ARTIFACT VERSION (the schema's CAS token, exactly
   * like a cell's per-element version). A version mismatch is returned as a tool RESULT — never thrown —
   * so the runtime's existing re-read/retry loop handles it. Mirrors convex/artifacts.setColumnsByAgent.
   */
  setColumns(args: {
    roomId: string; artifactId: string; baseVersion: number;
    mode?: "replace" | "merge"; columns: ColumnInput[]; by: Actor;
  }):
    | { ok: true; version: number; columns: DataframeColumn[] }
    | { ok: false; conflict?: true; expected?: number; actual?: number; error?: string } {
    const art = this.artifacts.get(args.artifactId);
    if (!art || art.roomId !== args.roomId) return { ok: false, error: "not_found" };
    if (art.kind !== "sheet") return { ok: false, error: "not_a_sheet" };
    if (art.version !== args.baseVersion) return { ok: false, conflict: true, expected: args.baseVersion, actual: art.version };
    const mode = args.mode ?? "merge";
    const cols = normalizeColumns(args.columns, art.meta?.dataframe?.columns ?? [], mode);
    if (mode === "replace") {
      // orphan rule = delete: drop cells whose column id is no longer declared, then trim art.order
      const keep = new Set(cols.map((c) => c.id));
      for (const id of [...art.order]) {
        const col = columnIdOfElement(id);
        if (col && !keep.has(col)) delete art.elements[id];
      }
      art.order = art.order.filter((id) => { const col = columnIdOfElement(id); return !col || keep.has(col); });
    }
    const df = art.meta?.dataframe;
    art.meta = { ...art.meta, dataframe: { rowCount: df?.rowCount ?? 0, ...df, columns: cols } };
    art.version++;
    art.updatedAt = this.now();
    this.trace(args.roomId, args.by, "schema_changed",
      `${args.by.name} set ${cols.length} column(s) on ${art.title}`,
      { artifactId: art.id },
      `define_columns(${mode}) · ${cols.map((c) => c.id).join(", ")} → v${art.version}`);
    this.emit();
    return { ok: true, version: art.version, columns: cols };
  }
  getArtifact(id: string) { return this.artifacts.get(id); }
  listArtifacts(roomId: string): Artifact[] { return [...this.artifacts.values()].filter((a) => a.roomId === roomId); }

  addResearchRows(args: { roomId: string; artifactId: string; rows: ResearchRowInput[]; by: Actor }): string[] {
    const art = this.artifacts.get(args.artifactId);
    if (!art || art.roomId !== args.roomId) return [];
    const now = this.now();
    const rowIds: string[] = [];
    let added = 0;
    let updated = 0;
    let changed = false;
    for (const row of args.rows) {
      const company = row.company.trim();
      if (!company) continue;
      const { rowId, existing } = this.researchRowIdForImport(art, row);
      rowIds.push(rowId);
      const vals: Record<(typeof RESEARCH_ROW_COLS)[number], string> = {
        company,
        website: row.website?.trim() || this.defaultResearchWebsite(company),
        status: existing ? displayResearchValue(art, rowId, "status") || "pending" : "pending",
        tier: row.tier?.trim() || "B",
        intent: row.intent?.trim() ?? "",
        owner: row.owner?.trim() ?? args.by.name,
        crm_status: row.crmStatus?.trim() || "Research",
        summary: existing ? displayResearchValue(art, rowId, "summary") : "",
        funding: existing ? displayResearchValue(art, rowId, "funding") : "",
        headcount: existing ? displayResearchValue(art, rowId, "headcount") : "",
        recent_signal: existing ? displayResearchValue(art, rowId, "recent_signal") : "",
        source: existing ? displayResearchValue(art, rowId, "source") : "",
        source2: existing ? displayResearchValue(art, rowId, "source2") : "",
        last_researched: existing ? displayResearchValue(art, rowId, "last_researched") : "",
      };
      const writableCols = existing ? ["company", "website", "tier", "intent", "owner", "crm_status"] as const : RESEARCH_ROW_COLS;
      for (const col of writableCols) {
        const elementId = `${rowId}__${col}`;
        const prev = art.elements[elementId];
        if (prev) {
          if (Object.is(prev.value, vals[col])) continue;
          prev.value = vals[col];
          prev.version++;
          prev.updatedAt = now;
          prev.updatedBy = args.by;
        } else {
          art.elements[elementId] = { id: elementId, version: 1, value: vals[col], updatedAt: now, updatedBy: args.by };
          art.order.push(elementId);
        }
        changed = true;
      }
      if (!existing) {
        added++;
        for (const col of RESEARCH_ROW_COLS) {
          const elementId = `${rowId}__${col}`;
          if (art.elements[elementId]) continue;
          art.elements[elementId] = { id: elementId, version: 1, value: vals[col], updatedAt: now, updatedBy: args.by };
          art.order.push(elementId);
        }
        changed = true;
      } else {
        updated++;
      }
    }
    if (rowIds.length && changed) {
      art.version++;
      art.updatedAt = now;
      this.trace(args.roomId, args.by, "edit_applied", `${args.by.name} imported ${rowIds.length} research row(s)`, { artifactId: art.id }, `add_research_rows added=${added} updated=${updated} rows=${rowIds.join(", ")}`);
      this.emit();
    }
    return rowIds;
  }

  /** Read element values — works even for LOCKED elements (locked = read-only, still readable as context). */
  readRange(artifactId: string, elementIds: string[]): Record<string, Element> {
    const art = this.artifacts.get(artifactId);
    const out: Record<string, Element> = {};
    if (!art) return out;
    for (const eid of elementIds) if (art.elements[eid]) out[eid] = { ...art.elements[eid] };
    return out;
  }

  /* ───────── locks: the affected-range lock tool (point 8) ───────── */
  /** A lock past its lease TTL is treated as gone (the holder crashed/abandoned it) — no cell blocks forever. */
  lockFor(artifactId: string, elementId: string): Lock | undefined {
    const now = this.now();
    return [...this.locks.values()].find(
      (l) => l.status === "active" && (l.expiresAt === undefined || l.expiresAt > now) && l.artifactId === artifactId && l.elementIds.includes(elementId),
    );
  }

  proposeLock(args: { roomId: string; artifactId: string; elementIds: string[]; holder: Actor; sessionId: string; reason: string }): LockResult {
    const conflicting: Array<{ elementId: string; by: Actor; lockId: string }> = [];
    for (const eid of args.elementIds) {
      const existing = this.lockFor(args.artifactId, eid);
      if (existing && !sameActor(existing.holder, args.holder)) {
        conflicting.push({ elementId: eid, by: existing.holder, lockId: existing.id });
      }
    }
    if (conflicting.length) {
      this.trace(args.roomId, args.holder, "lock_denied", `Lock denied on ${conflicting.length} element(s) (held by others)`, { artifactId: args.artifactId }, `propose_lock · [${args.elementIds.join(", ")}] → DENIED · ${conflicting.length} element(s) held by others`);
      this.emit();
      return { ok: false, reason: "conflict", conflicting };
    }
    const lock: Lock = {
      id: this.id("lock"), roomId: args.roomId, artifactId: args.artifactId, elementIds: [...args.elementIds],
      holder: args.holder, sessionId: args.sessionId, reason: args.reason, status: "active", createdAt: this.now(),
      expiresAt: this.now() + this.LOCK_TTL_MS,
    };
    this.locks.set(lock.id, lock);
    if (args.holder.kind === "agent") this.patchSessionByAgent(args.holder, { status: "working", heldLockId: lock.id, lastAction: `locked ${args.elementIds.join(",")}` });
    this.trace(args.roomId, args.holder, "lock_acquired", `${args.holder.name} locked ${args.elementIds.join(", ")} — ${args.reason}`, { lockId: lock.id, artifactId: args.artifactId, cell: args.elementIds[0], elementId: args.elementIds[0] }, `propose_lock · [${args.elementIds.join(", ")}] · reason: "${args.reason}" → ok`);
    this.emit();
    return { ok: true, lock };
  }

  /** Release a lock → trigger smart-merge of pending drafts blocked by it. */
  releaseLock(lockId: string, actor: Actor): { ok: boolean; reason?: "not_active" | "not_holder"; merged: MergeOutcome[] } {
    const lock = this.locks.get(lockId);
    if (!lock || lock.status !== "active") return { ok: false, reason: "not_active", merged: [] };
    if (!sameActor(lock.holder, actor)) {
      this.trace(lock.roomId, actor, "lock_denied", `${actor.name} tried to release a lock held by ${lock.holder.name}`, { lockId }, `release_lock · ${lockId} → DENIED · not holder`);
      return { ok: false, reason: "not_holder", merged: [] };
    }
    lock.status = "released";
    lock.releasedAt = this.now();
    if (lock.holder.kind === "agent") this.patchSessionByAgent(lock.holder, { status: "idle", heldLockId: undefined, lastAction: "released lock" });
    this.trace(lock.roomId, lock.holder, "lock_released", `${lock.holder.name} released lock on ${lock.elementIds.join(", ")}`, { lockId, artifactId: lock.artifactId, cell: lock.elementIds[0], elementId: lock.elementIds[0] }, `release_lock · ${lockId} → smart-merge waiting drafts`);

    // Merge every pending draft that was waiting on this lock (or overlaps its range).
    const merged: MergeOutcome[] = [];
    for (const d of this.drafts.values()) {
      if (d.status !== "pending") continue;
      if (d.artifactId !== lock.artifactId) continue;
      const overlaps = d.blockedByLockId === lockId || d.ops.some((o) => lock.elementIds.includes(o.elementId));
      if (!overlaps) continue;
      merged.push(this.mergeDraft(d.id));
    }
    this.emit();
    return { ok: true, merged };
  }

  listLocks(roomId: string): Lock[] { return [...this.locks.values()].filter((l) => l.roomId === roomId); }
  activeLocks(roomId: string): Lock[] { return this.listLocks(roomId).filter((l) => l.status === "active"); }

  /* ───────── edits: CAS + lock check + auto-allow (point 8) ───────── */
  applyEdit(args: { roomId: string; op: ChangeOp; actor: Actor }): EditResult {
    const { op, actor, roomId } = args;
    if (this.appliedOps.has(op.opId)) {
      const el = this.artifacts.get(op.artifactId)?.elements[op.elementId];
      return el ? { ok: true, element: { ...el }, fromVersion: el.version, toVersion: el.version } : { ok: false, reason: "duplicate" };
    }
    // Lock check — locked elements are read-only for everyone except the holder.
    const lock = this.lockFor(op.artifactId, op.elementId);
    if (lock && !sameActor(lock.holder, actor)) {
      this.trace(roomId, actor, "edit_blocked", `${actor.name}'s edit on ${op.elementId} blocked (locked by ${lock.holder.name})`, { lockId: lock.id }, `edit_cell · ${op.elementId} → BLOCKED (locked by ${lock.holder.name})`);
      this.emit();
      return { ok: false, reason: "locked", by: lock.holder, lockId: lock.id };
    }
    // Auto-allow: agent edits become proposals when auto-allow is OFF.
    const room = this.rooms.get(roomId);
    if (actor.kind === "agent" && room && !room.autoAllow) {
      const existing = [...this.proposals.values()].find((p) => samePendingProposal(p, roomId, op, actor));
      if (existing) return { ok: false, reason: "pending_approval", proposalId: existing.id };
      const proposal: Proposal = { id: this.id("prop"), roomId, artifactId: op.artifactId, op, author: actor, status: "pending", createdAt: this.now() };
      this.proposals.set(proposal.id, proposal);
      this.trace(roomId, actor, "edit_proposed", `${actor.name} proposed an edit to ${op.elementId} (awaiting approval)`, { proposalId: proposal.id });
      this.emit();
      return { ok: false, reason: "pending_approval", proposalId: proposal.id };
    }
    const res = this.applyOpInternal(op, actor);
    this.emit();
    return res;
  }

  /** Raw CAS apply — used by applyEdit, proposal approval, and merge. */
  private applyOpInternal(op: ChangeOp, actor: Actor): EditResult {
    const art = this.artifacts.get(op.artifactId);
    if (!art) return { ok: false, reason: "not_found" };
    // Declare-then-fill: once a sheet has a governed schema, an agent may only write DECLARED columns.
    // Undeclared-column writes would otherwise land as invisible orphans (the columns the UI never renders).
    if (actor.kind === "agent" && (op.kind === "set" || op.kind === "create")) {
      const declared = art.meta?.dataframe?.columns;
      const col = declared && declared.length ? columnIdOfElement(op.elementId) : null;
      if (col && !declared!.some((c) => c.id === col)) {
        this.trace(art.roomId, actor, "edit_blocked", `${actor.name}'s write to undeclared column "${col}" was rejected`, { artifactId: art.id, elementId: op.elementId }, `edit_cell · ${op.elementId} → no_such_column (call define_columns first)`);
        return { ok: false, reason: "no_such_column" };
      }
    }
    const el = art.elements[op.elementId];
    const now = this.now();

    if (op.kind === "create") {
      if (el) return { ok: false, reason: "duplicate" };
      const created: Element = { id: op.elementId, version: 1, value: op.value, updatedAt: now, updatedBy: actor };
      art.elements[op.elementId] = created;
      art.order.push(op.elementId);
      art.version++; art.updatedAt = now; this.appliedOps.add(op.opId);
      this.trace(art.roomId, actor, "edit_applied", `${actor.name} created ${op.elementId}`, { artifactId: art.id });
      return { ok: true, element: { ...created }, fromVersion: 0, toVersion: 1 };
    }
    if (!el) return { ok: false, reason: "not_found" };
    // Optimistic concurrency: stale base → conflict (returned as data, never thrown).
    if (el.version !== op.baseVersion) return { ok: false, reason: "conflict", expected: op.baseVersion, actual: el.version };
    if (op.kind === "set" && actor.kind === "agent" && formulaOf(el.value) && !formulaOf(op.value)) {
      this.trace(art.roomId, actor, "semantic_conflict", `${actor.name}'s edit to ${op.elementId} was blocked because it would overwrite a formula with a scalar`, { artifactId: art.id, elementId: op.elementId });
      return { ok: false, reason: "formula_protected" };
    }

    const from = el.version;
    if (op.kind === "delete") {
      delete art.elements[op.elementId];
      art.order = art.order.filter((x) => x !== op.elementId);
      art.version++; art.updatedAt = now; this.appliedOps.add(op.opId);
      this.trace(art.roomId, actor, "edit_applied", `${actor.name} deleted ${op.elementId}`, { artifactId: art.id });
      return { ok: true, element: { ...el }, fromVersion: from, toVersion: from };
    }
    el.value = op.value;
    el.version = from + 1;
    el.updatedAt = now;
    el.updatedBy = actor;
    art.version++; art.updatedAt = now; this.appliedOps.add(op.opId);
    this.trace(
      art.roomId,
      actor,
      "edit_applied",
      `${actor.name} set ${op.elementId} = ${fmt(op.value)}`,
      { artifactId: art.id, cell: op.elementId, elementId: op.elementId },
      `edit_cell · ${op.elementId} = ${fmt(op.value)} · v${from} → v${el.version}`,
    );
    return { ok: true, element: { ...el }, fromVersion: from, toVersion: el.version };
  }

  /* ───────── proposals (auto-allow OFF) ───────── */
  resolveProposal(proposalId: string, approve: boolean, by: Actor): EditResult | null {
    const p = this.proposals.get(proposalId);
    if (!p || p.status !== "pending") return null;
    let res: EditResult | null = null;
    if (approve) {
      res = this.applyOpInternal(p.op, p.author);
      if (!res.ok) {
        this.trace(p.roomId, by, "proposal_resolved", `${by.name} tried to approve ${p.author.name}'s edit to ${p.op.elementId}, but final CAS/policy rejected it`, { proposalId, reason: res.reason });
        this.emit();
        return res;
      }
    }
    p.status = approve ? "approved" : "rejected";
    p.resolvedAt = this.now();
    this.trace(p.roomId, by, "proposal_resolved", `${by.name} ${approve ? "approved" : "rejected"} ${p.author.name}'s edit to ${p.op.elementId}`, { proposalId });
    this.emit();
    return res;
  }
  listProposals(roomId: string): Proposal[] { return [...this.proposals.values()].filter((p) => p.roomId === roomId && p.status === "pending"); }
  listSemanticConflicts(roomId: string): SemanticConflictPacket[] { return [...this.semanticConflicts.values()].filter((p) => p.roomId === roomId); }

  /* ───────── drafts + smart-merge (point 8) ───────── */
  createDraft(args: { roomId: string; artifactId: string; author: Actor; ops: ChangeOp[]; note: string; blockedByLockId?: string }): Draft {
    const art = this.artifacts.get(args.artifactId);
    const base: Draft["base"] = {};
    for (const op of args.ops) {
      const el = art?.elements[op.elementId];
      base[op.elementId] = { value: el?.value, version: el?.version ?? 0, updatedBy: el?.updatedBy };
    }
    const draft: Draft = {
      id: this.id("draft"), roomId: args.roomId, artifactId: args.artifactId, author: args.author,
      ops: args.ops, base, note: args.note, blockedByLockId: args.blockedByLockId, status: "pending", createdAt: this.now(),
    };
    this.drafts.set(draft.id, draft);
    if (args.author.kind === "agent") this.patchSessionByAgent(args.author, { status: "drafting", lastAction: `drafted ${args.ops.length} change(s) around the locked range` });
    this.trace(args.roomId, args.author, "draft_created", `${args.author.name} drafted ${args.ops.length} change(s) for merge — ${args.note}`, { draftId: draft.id }, `create_draft · ${args.ops.length} ops · blockedBy ${args.blockedByLockId ?? "—"}`);
    this.emit();
    return draft;
  }

  /** Resolve a draft via the smart resolver (deterministic in the spike; LLM in prod). */
  mergeDraft(draftId: string): MergeOutcome {
    const draft = this.drafts.get(draftId)!;
    const art = this.artifacts.get(draft.artifactId)!;
    const { ops, resolution } = this.resolver({ draft, current: art.elements, committed: [], now: this.now() });
    for (const op of ops) this.applyOpInternal(op, draft.author);
    draft.status = resolution.verdict === "needs_review" ? "conflict" : "merged";
    draft.resolution = resolution;
    draft.resolvedAt = this.now();
    const type: TraceType = draft.status === "conflict" ? "draft_conflict" : "draft_merged";
    this.trace(draft.roomId, draft.author, type, `Smart-merge: ${resolution.note}`, { draftId }, `smart_merge · ${resolution.applied.length} applied, ${resolution.conflicts.length} flagged → ${resolution.verdict}`);
    const semantic = resolution.conflicts.length ? this.openSemanticConflict(draft, art, resolution.conflicts) : undefined;
    if (draft.author.kind === "agent") this.patchSessionByAgent(draft.author, { status: "done", lastAction: `draft ${draft.status}` });
    this.emit();
    return { draftId, applied: resolution.applied, conflicts: resolution.conflicts, resolution, semantic };
  }
  listDrafts(roomId: string): Draft[] { return [...this.drafts.values()].filter((d) => d.roomId === roomId); }

  private openSemanticConflict(draft: Draft, artifact: Artifact, conflicts: MergeResolution["conflicts"]): MergeOutcome["semantic"] {
    const conflictId = this.id("semconf");
    const packet = buildSemanticConflictPacket({ conflictId, draft, artifact, conflicts, createdAt: this.now() });
    const resolution = resolveSemanticConflictPacket(packet);
    packet.status = resolution.decision === "reject" ? "rejected" : "needs_review";
    this.semanticConflicts.set(conflictId, packet);

    const proposalIds: string[] = [];
    if (draft.author.scope !== "private") {
      for (const resolved of resolution.resolvedOps) {
        if (resolved.kind !== "create_proposal") continue;
        const original = packet.proposed.ops.find((op) => op.elementId === resolved.targetRef);
        if (!original) continue;
        const proposal: Proposal = {
          id: this.id("prop"),
          roomId: draft.roomId,
          artifactId: artifact.id,
          op: {
            ...original,
            opId: this.id("semop"),
            baseVersion: resolved.baseVersion ?? packet.current.versions[resolved.targetRef] ?? 0,
            value: resolved.value,
          },
          author: draft.author,
          status: "pending",
          createdAt: this.now(),
          review: {
            kind: "semantic_rebase",
            conflictId,
            reviewerNote: resolution.reviewerNote,
            reason: resolved.comment,
            status: resolved.status === "rejected" ? "needs_review" : resolved.status,
          },
        };
        this.proposals.set(proposal.id, proposal);
        proposalIds.push(proposal.id);
      }
    }

    this.trace(
      draft.roomId,
      draft.author,
      "semantic_conflict",
      `Semantic rebase opened ${conflicts.length} conflict(s); ${proposalIds.length} review proposal(s) created`,
      { draftId: draft.id, conflictId },
      `semantic_rebase - decision=${resolution.decision} - proposals=${proposalIds.length} - ${resolution.reason}`,
    );
    return { conflictId, resolution, proposalIds };
  }

  /* ───────── agent sessions + awareness (point 8) ───────── */
  startSession(args: { roomId: string; agentId: string; agentName: string; scope: AgentScope; ownerId?: string }): AgentSession {
    const s: AgentSession = {
      id: this.id("sess"), roomId: args.roomId, agentId: args.agentId, agentName: args.agentName,
      scope: args.scope, ownerId: args.ownerId, status: "idle", lastAction: "joined", updatedAt: this.now(),
    };
    this.sessions.set(s.id, s);
    this.trace(args.roomId, { kind: "agent", id: args.agentId, name: args.agentName, scope: args.scope, ownerId: args.ownerId }, "agent_session_started", `${args.agentName} (${args.scope}) session started`);
    this.emit();
    return s;
  }
  updateSession(sessionId: string, patch: Partial<Pick<AgentSession, "status" | "heldLockId" | "lastAction">>) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    Object.assign(s, patch, { updatedAt: this.now() });
    this.trace(s.roomId, { kind: "agent", id: s.agentId, name: s.agentName, scope: s.scope, ownerId: s.ownerId }, "agent_status", `${s.agentName}: ${patch.status ?? s.status}${patch.lastAction ? " — " + patch.lastAction : ""}`);
    this.emit();
  }
  private patchSessionByAgent(actor: Actor, patch: Partial<Pick<AgentSession, "status" | "heldLockId" | "lastAction">>) {
    const s = [...this.sessions.values()].find((x) => x.agentId === actor.id);
    if (s) Object.assign(s, patch, { updatedAt: this.now() });
  }
  listSessions(roomId: string): AgentSession[] { return [...this.sessions.values()].filter((s) => s.roomId === roomId); }

  /**
   * What an agent sees about EVERYONE ELSE before it acts — the input to its
   * "be aware of each other's work session" reasoning: who holds which range,
   * the other live sessions, and the recent trace tail.
   */
  awareness(roomId: string, excludeAgentId?: string): { activeLocks: Lock[]; sessions: AgentSession[]; recentTraces: TraceEvent[] } {
    return {
      activeLocks: this.activeLocks(roomId).filter((l) => l.holder.id !== excludeAgentId),
      sessions: this.listSessions(roomId).filter((s) => s.agentId !== excludeAgentId),
      recentTraces: this.listTraces(roomId).slice(-12),
    };
  }

  /* ───────── messages: public + private channels (points 4, 6) ───────── */
  postMessage(args: { roomId: string; channel: Channel; author: Actor; text: string; clientMsgId: string; kind?: Message["kind"]; toolParts?: ToolPart[] }): Message | null {
    if (this.seenClientMsg.has(args.clientMsgId)) return null; // idempotent send / optimistic reconcile
    this.seenClientMsg.add(args.clientMsgId);
    const msg: Message = {
      id: this.id("msg"), roomId: args.roomId, channel: args.channel, author: args.author, text: args.text,
      clientMsgId: args.clientMsgId, kind: args.kind ?? "chat", toolParts: args.toolParts, createdAt: this.now(),
    };
    this.messages.push(msg);
    if (this.messages.length > MAX_MESSAGES) this.messages.splice(0, this.messages.length - MAX_MESSAGES);
    this.emit();
    return msg;
  }
  /** Update an in-place streaming agent message (the "stream via row mutation" pattern). */
  updateMessage(messageId: string, patch: { text?: string; toolParts?: ToolPart[] }) {
    const m = this.messages.find((x) => x.id === messageId);
    if (!m) return;
    if (patch.text !== undefined) m.text = patch.text;
    if (patch.toolParts !== undefined) m.toolParts = patch.toolParts;
    this.emit();
  }
  listMessages(roomId: string, channel: Channel): Message[] {
    return this.messages.filter((m) => m.roomId === roomId && channelEq(m.channel, channel));
  }

  /* ───────── traces (point 8) ───────── */
  trace(roomId: string, actor: Actor, type: TraceType, summary: string, refs?: Record<string, string>, detail?: string) {
    this.traces.push({ id: this.id("tr"), roomId, ts: this.now(), actor, type, summary, refs, detail });
    if (this.traces.length > MAX_TRACES) this.traces.splice(0, this.traces.length - MAX_TRACES);
  }
  listTraces(roomId: string): TraceEvent[] { return this.traces.filter((t) => t.roomId === roomId); }

  /* ───────── helpers ───────── */
  private makeCode(): string {
    // Deterministic, readable room code derived from the id counter.
    const n = this.idc + 7;
    return `r-${n.toString(36)}${((n * 31) % 1296).toString(36).padStart(2, "0")}`;
  }

  private researchRowIdForImport(art: Artifact, row: ResearchRowInput): { rowId: string; existing: boolean } {
    const company = row.company.trim();
    const existing = this.findResearchRowId(art, company, row.website);
    if (existing) return { rowId: existing, existing: true };
    const base = researchRowSlug(company);
    let rowId = base === "rc_" ? this.id("rc") : base;
    let suffix = 1;
    while (art.order.some((id) => id.startsWith(`${rowId}__`))) rowId = `${base}_${suffix++}`;
    return { rowId, existing: false };
  }

  private findResearchRowId(art: Artifact, company: string, website?: string): string | null {
    const wantedCompany = normalizeResearchIdentity(company);
    const wantedDomain = normalizeResearchDomain(website);
    const rowIds = [...new Set(art.order.map((id) => id.split("__")[0]))];
    return rowIds.find((rid) => {
      const existingCompany = normalizeResearchIdentity(displayResearchValue(art, rid, "company"));
      if (wantedCompany && existingCompany === wantedCompany) return true;
      const existingDomain = normalizeResearchDomain(displayResearchValue(art, rid, "website"));
      return !!wantedDomain && existingDomain === wantedDomain;
    }) ?? null;
  }

  private defaultResearchWebsite(company: string): string {
    const host = company.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 32);
    return host ? `https://www.${host}.com` : "";
  }
}

function actorOf(m: Member): Actor { return { kind: "user", id: m.id, name: m.name }; }
function sameActor(a: Actor, b: Actor): boolean { return a.kind === b.kind && a.id === b.id; }
function channelEq(a: Channel, b: Channel): boolean {
  if (a === "public" || b === "public") return a === b;
  return a.private === b.private;
}
function fmt(v: unknown): string {
  if (v && typeof v === "object") return JSON.stringify(v).slice(0, 40);
  return String(v).slice(0, 40);
}

function researchRowSlug(company: string): string {
  return "rc_" + company.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28);
}

function normalizeResearchIdentity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalizeResearchDomain(value?: string): string {
  if (!value) return "";
  const raw = value.trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
  }
}

function displayResearchValue(art: Artifact, rowId: string, col: string): string {
  const raw = art.elements[`${rowId}__${col}`]?.value;
  if (raw === null || raw === undefined) return "";
  return typeof raw === "string" ? raw : String(raw);
}
