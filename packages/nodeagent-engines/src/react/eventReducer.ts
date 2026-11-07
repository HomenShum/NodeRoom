/**
 * Pure projection of a run's durable event log into the workspace view model.
 * Every field here is derived from a real NodeAgentEvent; nothing is invented.
 * `reduceRunEvents(events, prev)` folds a batch onto `prev` without mutating it
 * (copy-on-write), so the hook can apply SSE batches incrementally.
 */
import type {
  ArtifactKind,
  EngineEventBody,
  GoalItem,
  HandoffPacket,
  NodeAgentEvent,
  UsageTotals,
} from "../contract.js";

/** Every in-memory collection in the view is capped; the worker keeps the full log. */
export const VIEW_LIMITS = {
  timelineEntries: 2000,
  itemsPerGroup: 400,
  helpers: 500,
  artifacts: 1000,
  checks: 300,
  permissions: 500,
  raw: 500,
  messageChars: 100_000,
} as const;

export type SkillStage = "drafted" | "validated" | "tested" | "activated" | "rejected";
export const SKILL_STAGES: SkillStage[] = ["drafted", "validated", "tested", "activated"];

export interface ToolItem {
  kind: "tool";
  seq: number;
  callId: string;
  name: string;
  family: string;
  native: boolean;
  inputPreview: string;
  agentId?: string;
  /** "no-result": the run ended before a tool.result for this call arrived. */
  status: "running" | "ok" | "error" | "no-result";
  resultPreview?: string;
  ms?: number;
}
export interface OrphanResultItem { kind: "orphan-result"; seq: number; callId: string; ok: boolean; preview: string; agentId?: string }
export interface ToolSearchItem {
  kind: "tool-search";
  seq: number;
  query: string;
  results: string[];
  via: "native" | "node";
  agentId?: string;
  /** Result names that a later tool.loaded made callable / a later tool.call invoked. */
  loaded: string[];
  called: string[];
}
export interface ToolLoadedItem { kind: "tool-loaded"; seq: number; names: string[]; via: string; agentId?: string }
export interface SkillItem {
  kind: "skill";
  seq: number;
  event: "search" | "loaded" | "lifecycle";
  name: string;
  stage?: SkillStage;
  detail: string;
  results?: string[];
  via?: string;
  path?: string;
  agentId?: string;
}
export interface PermissionItem { kind: "permission"; seq: number; tool: string; reason: string; agentId?: string }
export interface CheckItem {
  kind: "check";
  seq: number;
  checkId: string;
  command: string;
  ok: boolean;
  passed: number;
  failed: number;
  durationMs: number;
  outputTail: string;
  independent: boolean;
}
export interface ArtifactItem { kind: "artifact"; seq: number; path: string; artifactKind: ArtifactKind; change: "created" | "modified" | "deleted"; bytes: number; agentId?: string }

export type ActivityItem = ToolItem | OrphanResultItem | ToolSearchItem | ToolLoadedItem | SkillItem | PermissionItem | CheckItem | ArtifactItem;

export interface MessageEntry { kind: "message"; key: string; seq: number; role: "assistant" | "user"; text: string; agentId?: string; streaming: boolean; truncated: boolean }
export interface GroupEntry { kind: "group"; key: string; seq: number; agentId?: string; items: ActivityItem[]; closed: boolean; droppedItems: number }
export interface CompactionEntry { kind: "compaction"; key: string; seq: number; trigger: "auto" | "manual"; preTokens: number; postTokens?: number; durationMs?: number; agentId?: string }
export interface TerminalEntry { kind: "terminal"; key: string; seq: number; status: "completed" | "failed" | "interrupted"; text: string }
export type TimelineEntry = MessageEntry | GroupEntry | CompactionEntry | TerminalEntry;

export interface HelperView {
  helperId: string;
  parentId?: string;
  description: string;
  subagentType?: string;
  model?: string;
  background?: boolean;
  status: "running" | "completed" | "failed" | "stopped";
  summary?: string;
  lastTool?: string;
  /** As reported by the engine (helper.progress / helper.completed). */
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
  /** tool.call events Node observed with agentId === helperId. */
  observedToolCalls: number;
  startedSeq: number;
}

export interface ArtifactView { path: string; kind: ArtifactKind; change: "created" | "modified" | "deleted"; bytes: number; sha256: string; seq: number; writes: number }

type RunStarted = Extract<EngineEventBody, { type: "run.started" }>;

export interface RunView {
  /** Highest seq applied; 0 before any event. */
  lastSeq: number;
  eventCount: number;
  /** Events ignored because their seq was already applied (SSE replay after reconnect). */
  duplicates: number;
  /** Times a seq arrived more than one past lastSeq (events missing from this view). */
  gaps: number;
  started?: RunStarted;
  liveStatus?: "running" | "compacting" | "waiting" | "requesting";
  statusDetail?: string;
  terminal?: { status: "completed" | "failed" | "interrupted"; text: string; seq: number };
  currentAction?: string;
  goals: GoalItem[];
  goalsSource?: string;
  goalsClaimedBy?: "engine" | "node";
  helpers: HelperView[];
  timeline: TimelineEntry[];
  droppedEntries: number;
  artifacts: ArtifactView[];
  checks: CheckItem[];
  permissions: Array<{ seq: number; tool: string; decision: "allow" | "deny"; reason: string; agentId?: string }>;
  context?: { usedTokens: number; windowTokens?: number; estimated: boolean; seq: number };
  compactions: number;
  usage?: UsageTotals;
  nativeSessionId?: string;
  handoff?: HandoffPacket;
  raw: NodeAgentEvent[];
  firstTs?: string;
  lastTs?: string;
}

export function emptyRunView(): RunView {
  return {
    lastSeq: 0,
    eventCount: 0,
    duplicates: 0,
    gaps: 0,
    goals: [],
    helpers: [],
    timeline: [],
    droppedEntries: 0,
    artifacts: [],
    checks: [],
    permissions: [],
    compactions: 0,
    raw: [],
  };
}

const READ_TOOL = /(?:^|[_.:])(?:read_file|read_source)$|^read$/i;

/** True for tool names that read a workspace file or source (native Read, Node read_file/read_source). */
export function isReadTool(name: string): boolean {
  return READ_TOOL.test(name);
}

/** Pull a path-like argument out of a size-capped JSON input preview, if one is visible. */
export function previewPath(inputPreview: string): string | undefined {
  const m = /"(?:file_path|path|notebook_path|source|sourceId)"\s*:\s*"([^"]{1,300})"/.exec(inputPreview);
  return m?.[1];
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

export function reduceRunEvents(events: readonly NodeAgentEvent[], prev: RunView = emptyRunView()): RunView {
  if (events.length === 0) return prev;
  const owned = new WeakSet<object>();
  const view: RunView = {
    ...prev,
    helpers: prev.helpers.slice(),
    timeline: prev.timeline.slice(),
    artifacts: prev.artifacts.slice(),
    checks: prev.checks.slice(),
    permissions: prev.permissions.slice(),
    raw: prev.raw.slice(),
  };
  const own = <T extends object>(obj: T): T => {
    if (owned.has(obj)) return obj;
    const copy = Array.isArray(obj) ? (obj.slice() as T) : { ...obj };
    owned.add(copy);
    return copy;
  };
  const ownGroup = (index: number): GroupEntry => {
    const g = view.timeline[index] as GroupEntry;
    if (owned.has(g)) return g;
    const copy: GroupEntry = { ...g, items: g.items.slice() };
    owned.add(copy);
    view.timeline[index] = copy;
    return copy;
  };

  const push = (entry: TimelineEntry) => {
    owned.add(entry);
    view.timeline.push(entry);
    const over = view.timeline.length - VIEW_LIMITS.timelineEntries;
    if (over > 0) {
      view.timeline.splice(0, over);
      view.droppedEntries += over;
    }
  };

  const openGroupIndex = (agentId: string | undefined): number => {
    for (let i = view.timeline.length - 1; i >= 0; i--) {
      const t = view.timeline[i];
      if (t.kind === "group" && !t.closed && t.agentId === agentId) return i;
    }
    return -1;
  };

  const addItem = (item: ActivityItem, agentId: string | undefined, seq: number) => {
    let index = openGroupIndex(agentId);
    if (index < 0) {
      push({ kind: "group", key: `g${seq}`, seq, agentId, items: [], closed: false, droppedItems: 0 });
      index = view.timeline.length - 1;
    }
    const g = ownGroup(index);
    owned.add(item);
    g.items.push(item);
    if (g.items.length > VIEW_LIMITS.itemsPerGroup) {
      g.items.shift();
      g.droppedItems += 1;
    }
  };

  const closeGroups = (agentId: string | undefined | null) => {
    for (let i = 0; i < view.timeline.length; i++) {
      const t = view.timeline[i];
      if (t.kind === "group" && !t.closed && (agentId === null || t.agentId === agentId)) ownGroup(i).closed = true;
    }
  };

  /** Scan recent groups (newest first) for an item; returns [entryIndex, itemIndex]. */
  const findItem = (pred: (item: ActivityItem) => boolean): [number, number] | null => {
    for (let i = view.timeline.length - 1; i >= 0; i--) {
      const t = view.timeline[i];
      if (t.kind !== "group") continue;
      for (let j = t.items.length - 1; j >= 0; j--) if (pred(t.items[j])) return [i, j];
    }
    return null;
  };

  const replaceItem = (at: [number, number], patch: (item: ActivityItem) => ActivityItem) => {
    const g = ownGroup(at[0]);
    g.items[at[1]] = patch(own(g.items[at[1]]));
  };

  const helperIndex = (id: string) => view.helpers.findIndex((h) => h.helperId === id);
  const who = (agentId: string | undefined) => {
    if (!agentId) return "";
    const h = view.helpers.find((x) => x.helperId === agentId);
    return h ? `${h.description}: ` : `Helper ${agentId}: `;
  };

  for (const e of events) {
    if (e.seq <= view.lastSeq) {
      view.duplicates += 1;
      continue;
    }
    if (view.lastSeq > 0 && e.seq > view.lastSeq + 1) view.gaps += 1;
    view.lastSeq = e.seq;
    view.eventCount += 1;
    view.firstTs ??= e.ts;
    view.lastTs = e.ts;
    view.raw.push(e);
    if (view.raw.length > VIEW_LIMITS.raw) view.raw.splice(0, view.raw.length - VIEW_LIMITS.raw);

    switch (e.type) {
      case "run.started": {
        const { schema: _s, runId: _r, seq: _q, ts: _t, ...body } = e;
        view.started = body as RunStarted;
        view.liveStatus = "running";
        if (e.nativeSessionId) view.nativeSessionId = e.nativeSessionId;
        break;
      }
      case "run.status":
        view.liveStatus = e.status;
        view.statusDetail = e.detail;
        if (e.status === "compacting") view.currentAction = "Compacting context";
        break;
      case "message.delta": {
        let idx = -1;
        for (let i = view.timeline.length - 1; i >= 0; i--) {
          const t = view.timeline[i];
          if (t.kind === "message" && t.streaming && t.agentId === e.agentId) { idx = i; break; }
        }
        if (idx < 0) {
          closeGroups(e.agentId);
          push({ kind: "message", key: `m${e.seq}`, seq: e.seq, role: "assistant", text: "", agentId: e.agentId, streaming: true, truncated: false });
          idx = view.timeline.length - 1;
        }
        const m = own(view.timeline[idx] as MessageEntry);
        view.timeline[idx] = m;
        const room = VIEW_LIMITS.messageChars - m.text.length;
        if (room > 0) m.text += e.text.slice(0, room);
        if (e.text.length > room) m.truncated = true;
        break;
      }
      case "message": {
        let idx = -1;
        for (let i = view.timeline.length - 1; i >= 0; i--) {
          const t = view.timeline[i];
          if (t.kind === "message" && t.streaming && t.agentId === e.agentId) { idx = i; break; }
        }
        const text = e.text.slice(0, VIEW_LIMITS.messageChars);
        const truncated = e.text.length > VIEW_LIMITS.messageChars;
        if (idx >= 0 && e.role === "assistant") {
          const m = own(view.timeline[idx] as MessageEntry);
          view.timeline[idx] = m;
          m.text = text;
          m.truncated = truncated;
          m.streaming = false;
        } else {
          closeGroups(e.agentId);
          push({ kind: "message", key: `m${e.seq}`, seq: e.seq, role: e.role, text, agentId: e.agentId, streaming: false, truncated });
        }
        break;
      }
      case "tool.call": {
        addItem(
          { kind: "tool", seq: e.seq, callId: e.callId, name: e.name, family: e.family, native: e.native, inputPreview: e.inputPreview, agentId: e.agentId, status: "running" },
          e.agentId,
          e.seq,
        );
        if (e.agentId) {
          const hi = helperIndex(e.agentId);
          if (hi >= 0) {
            const h = own(view.helpers[hi]);
            h.observedToolCalls += 1;
            view.helpers[hi] = h;
          }
        }
        const searchAt = findItem((it) => it.kind === "tool-search" && it.agentId === e.agentId && it.results.includes(e.name) && !it.called.includes(e.name));
        if (searchAt) replaceItem(searchAt, (it) => ({ ...(it as ToolSearchItem), called: [...(it as ToolSearchItem).called, e.name] }));
        const path = previewPath(e.inputPreview);
        view.currentAction = `${who(e.agentId)}${isReadTool(e.name) ? "Reading" : "Calling"} ${isReadTool(e.name) && path ? path : e.name}${!isReadTool(e.name) && path ? ` on ${path}` : ""}`;
        break;
      }
      case "tool.result": {
        const at = findItem((it) => it.kind === "tool" && it.callId === e.callId);
        if (at) {
          replaceItem(at, (it) => ({ ...(it as ToolItem), status: e.ok ? "ok" : "error", resultPreview: e.preview, ms: e.ms }));
          const name = (view.timeline[at[0]] as GroupEntry).items[at[1]] as ToolItem;
          view.currentAction = `${who(e.agentId)}${name.name} ${e.ok ? "finished" : "failed"}`;
        } else {
          addItem({ kind: "orphan-result", seq: e.seq, callId: e.callId, ok: e.ok, preview: e.preview, agentId: e.agentId }, e.agentId, e.seq);
        }
        break;
      }
      case "tool.search":
        addItem({ kind: "tool-search", seq: e.seq, query: e.query, results: e.results.slice(0, 50), via: e.via, agentId: e.agentId, loaded: [], called: [] }, e.agentId, e.seq);
        view.currentAction = `${who(e.agentId)}Searching tools for “${e.query}”`;
        break;
      case "tool.loaded": {
        addItem({ kind: "tool-loaded", seq: e.seq, names: e.names.slice(0, 50), via: e.via, agentId: e.agentId }, e.agentId, e.seq);
        const at = findItem((it) => it.kind === "tool-search" && it.agentId === e.agentId && e.names.some((n) => it.results.includes(n)));
        if (at) {
          replaceItem(at, (it) => {
            const s = it as ToolSearchItem;
            return { ...s, loaded: [...new Set([...s.loaded, ...e.names.filter((n) => s.results.includes(n))])] };
          });
        }
        view.currentAction = `${who(e.agentId)}Loaded ${e.names.join(", ")}`;
        break;
      }
      case "skill.search":
        addItem({ kind: "skill", seq: e.seq, event: "search", name: "", detail: e.query, results: e.results.slice(0, 50), via: e.via, agentId: e.agentId }, e.agentId, e.seq);
        view.currentAction = `${who(e.agentId)}Searching skills for “${e.query}”`;
        break;
      case "skill.loaded":
        addItem({ kind: "skill", seq: e.seq, event: "loaded", name: e.name, detail: e.sha256 ? `sha256 ${e.sha256.slice(0, 12)}` : "", via: e.via, agentId: e.agentId }, e.agentId, e.seq);
        view.currentAction = `${who(e.agentId)}Loaded skill ${e.name}`;
        break;
      case "skill.lifecycle":
        addItem({ kind: "skill", seq: e.seq, event: "lifecycle", name: e.name, stage: e.stage, detail: e.detail, path: e.path }, undefined, e.seq);
        view.currentAction = `Skill ${e.name} ${e.stage}`;
        break;
      case "helper.started": {
        if (helperIndex(e.helperId) >= 0) break;
        view.helpers.push({
          helperId: e.helperId,
          parentId: e.parentId,
          description: e.description,
          subagentType: e.subagentType,
          model: e.model,
          background: e.background,
          status: "running",
          observedToolCalls: 0,
          startedSeq: e.seq,
        });
        if (view.helpers.length > VIEW_LIMITS.helpers) view.helpers.shift();
        view.currentAction = `Started helper: ${e.description}`;
        break;
      }
      case "helper.progress": {
        const hi = helperIndex(e.helperId);
        if (hi < 0) break;
        const h = own(view.helpers[hi]);
        view.helpers[hi] = h;
        if (e.summary !== undefined) h.summary = e.summary;
        if (e.lastTool !== undefined) h.lastTool = e.lastTool;
        if (e.totalTokens !== undefined) h.totalTokens = e.totalTokens;
        if (e.toolUses !== undefined) h.toolUses = e.toolUses;
        if (e.durationMs !== undefined) h.durationMs = e.durationMs;
        const what = e.summary ?? (e.lastTool ? `using ${e.lastTool}` : undefined);
        if (what) view.currentAction = `${h.description}: ${what}`;
        break;
      }
      case "helper.completed": {
        const hi = helperIndex(e.helperId);
        if (hi < 0) break;
        const h = own(view.helpers[hi]);
        view.helpers[hi] = h;
        h.status = e.status;
        h.summary = e.summary;
        if (e.totalTokens !== undefined) h.totalTokens = e.totalTokens;
        if (e.toolUses !== undefined) h.toolUses = e.toolUses;
        if (e.durationMs !== undefined) h.durationMs = e.durationMs;
        closeGroups(e.helperId);
        view.currentAction = `Helper ${e.status}: ${h.description}`;
        break;
      }
      case "context.usage":
        if (!e.agentId) view.context = { usedTokens: e.usedTokens, windowTokens: e.windowTokens, estimated: e.estimated, seq: e.seq };
        break;
      case "context.compacted":
        closeGroups(e.agentId);
        push({ kind: "compaction", key: `c${e.seq}`, seq: e.seq, trigger: e.trigger, preTokens: e.preTokens, postTokens: e.postTokens, durationMs: e.durationMs, agentId: e.agentId });
        view.compactions += 1;
        if (!e.agentId && e.postTokens !== undefined && view.context) view.context = { ...view.context, usedTokens: e.postTokens, seq: e.seq };
        view.currentAction = `${who(e.agentId)}Context compacted (${formatTokens(e.preTokens)} → ${e.postTokens === undefined ? "unknown" : formatTokens(e.postTokens)})`;
        if (view.liveStatus === "compacting") view.liveStatus = "running";
        break;
      case "goals.updated":
        view.goals = e.goals;
        view.goalsSource = e.source;
        view.goalsClaimedBy = e.goals.some((g) => g.claimedBy === "node") ? "node" : "engine";
        break;
      case "artifact.written": {
        const i = view.artifacts.findIndex((a) => a.path === e.path);
        const prior = i >= 0 ? view.artifacts.splice(i, 1)[0] : undefined;
        view.artifacts.push({ path: e.path, kind: e.kind, change: e.change, bytes: e.bytes, sha256: e.sha256, seq: e.seq, writes: (prior?.writes ?? 0) + 1 });
        if (view.artifacts.length > VIEW_LIMITS.artifacts) view.artifacts.shift();
        addItem({ kind: "artifact", seq: e.seq, path: e.path, artifactKind: e.kind, change: e.change, bytes: e.bytes, agentId: e.agentId }, e.agentId, e.seq);
        view.currentAction = `${who(e.agentId)}${e.change === "deleted" ? "Deleted" : "Wrote"} ${e.path}`;
        break;
      }
      case "check.result": {
        const item: CheckItem = {
          kind: "check",
          seq: e.seq,
          checkId: e.checkId,
          command: e.command,
          ok: e.ok,
          passed: e.passed,
          failed: e.failed,
          durationMs: e.durationMs,
          outputTail: e.outputTail,
          independent: e.independent,
        };
        view.checks.push(item);
        if (view.checks.length > VIEW_LIMITS.checks) view.checks.shift();
        // Independent verifier checks arrive as a burst after the run; they live in the
        // "Verified by Node" panel, not the agent's timeline, and are summarised as one action.
        if (e.independent) {
          const ind = view.checks.filter((c) => c.independent);
          view.currentAction = `Verified by Node: ${ind.filter((c) => c.ok).length} of ${ind.length} checks passed`;
        } else {
          addItem(item, undefined, e.seq);
          view.currentAction = `Checks ${e.checkId}: ${e.passed} passed, ${e.failed} failed`;
        }
        break;
      }
      case "permission.decision":
        view.permissions.push({ seq: e.seq, tool: e.tool, decision: e.decision, reason: e.reason, agentId: e.agentId });
        if (view.permissions.length > VIEW_LIMITS.permissions) view.permissions.shift();
        if (e.decision === "deny") {
          addItem({ kind: "permission", seq: e.seq, tool: e.tool, reason: e.reason, agentId: e.agentId }, e.agentId, e.seq);
          view.currentAction = `${who(e.agentId)}Node denied ${e.tool}`;
        }
        break;
      case "usage":
        if (!e.agentId) view.usage = e.totals;
        break;
      case "handoff.packet":
        view.handoff = e.packet;
        break;
      case "run.completed":
      case "run.failed":
      case "run.interrupted": {
        const status = e.type === "run.completed" ? "completed" : e.type === "run.failed" ? "failed" : "interrupted";
        const text = e.type === "run.completed" ? e.finalText : e.type === "run.failed" ? e.error : e.reason;
        if (e.usage) view.usage = e.usage;
        if (e.nativeSessionId) view.nativeSessionId = e.nativeSessionId;
        view.terminal = { status, text, seq: e.seq };
        view.liveStatus = undefined;
        closeGroups(null);
        for (let i = 0; i < view.timeline.length; i++) {
          const t = view.timeline[i];
          if (t.kind === "message" && t.streaming) view.timeline[i] = { ...t, streaming: false };
          if (t.kind === "group" && t.items.some((it) => it.kind === "tool" && it.status === "running")) {
            const g = ownGroup(i);
            g.items = g.items.map((it) => (it.kind === "tool" && it.status === "running" ? { ...it, status: "no-result" } : it));
          }
        }
        push({ kind: "terminal", key: `t${e.seq}`, seq: e.seq, status, text });
        view.currentAction = status === "completed" ? "Finished" : status === "failed" ? `Failed: ${text}` : `Interrupted: ${text}`;
        break;
      }
      case "engine.raw":
        break;
    }
  }
  return view;
}

export interface HelperNode { helper: HelperView; children: HelperNode[] }

/** Nest helpers by parentId; a helper whose parent is unknown is a root. */
export function buildHelperTree(helpers: readonly HelperView[]): HelperNode[] {
  const nodes = new Map<string, HelperNode>();
  for (const h of helpers) nodes.set(h.helperId, { helper: h, children: [] });
  const roots: HelperNode[] = [];
  for (const h of helpers) {
    const node = nodes.get(h.helperId)!;
    const parent = h.parentId && h.parentId !== h.helperId ? nodes.get(h.parentId) : undefined;
    if (parent && !isAncestor(nodes, h.helperId, h.parentId!)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function isAncestor(nodes: Map<string, HelperNode>, id: string, startParent: string): boolean {
  // Guards a parent cycle (A->B->A) from making both helpers unreachable.
  let cur: string | undefined = startParent;
  for (let i = 0; cur && i < nodes.size; i++) {
    if (cur === id) return true;
    cur = nodes.get(cur)?.helper.parentId;
  }
  return false;
}

export interface GroupSummary { toolCalls: number; filesRead: number; written: number; failed: number; denied: number; running: number; searches: number; skills: number; checks: number }

export function summarizeGroup(g: GroupEntry): GroupSummary {
  const read = new Set<string>();
  const written = new Set<string>();
  const s: GroupSummary = { toolCalls: 0, filesRead: 0, written: 0, failed: 0, denied: 0, running: 0, searches: 0, skills: 0, checks: 0 };
  for (const it of g.items) {
    if (it.kind === "tool") {
      s.toolCalls += 1;
      if (it.status === "error") s.failed += 1;
      if (it.status === "running") s.running += 1;
      if (isReadTool(it.name)) read.add(previewPath(it.inputPreview) ?? it.callId);
    } else if (it.kind === "artifact" && it.change !== "deleted") written.add(it.path);
    else if (it.kind === "permission") s.denied += 1;
    else if (it.kind === "tool-search") s.searches += 1;
    else if (it.kind === "skill") s.skills += 1;
    else if (it.kind === "check") s.checks += 1;
  }
  s.filesRead = read.size;
  s.written = written.size;
  return s;
}

/** "14 tool calls · 6 files read · 2 written" — only non-zero parts. */
export function groupSummaryText(s: GroupSummary): string {
  const parts: string[] = [];
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  if (s.toolCalls) parts.push(plural(s.toolCalls, "tool call"));
  if (s.filesRead) parts.push(`${plural(s.filesRead, "file")} read`);
  if (s.written) parts.push(`${s.written} written`);
  if (s.searches) parts.push(plural(s.searches, "search", "searches"));
  if (s.skills) parts.push(plural(s.skills, "skill event"));
  if (s.checks) parts.push(plural(s.checks, "check"));
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.denied) parts.push(`${s.denied} denied`);
  return parts.join(" · ") || "No tool activity";
}

/** Independent results only: Node-run checks outside the worker's context. */
export function independentChecks(view: RunView): CheckItem[] {
  return view.checks.filter((c) => c.independent);
}

/** Lifecycle stages reached per skill name, in lifecycle order (from skill.lifecycle events in view). */
export function skillStages(view: RunView): Map<string, SkillStage[]> {
  const seen = new Map<string, Set<SkillStage>>();
  for (const t of view.timeline) {
    if (t.kind !== "group") continue;
    for (const it of t.items) {
      if (it.kind !== "skill" || it.event !== "lifecycle" || !it.stage) continue;
      if (!seen.has(it.name)) seen.set(it.name, new Set());
      seen.get(it.name)!.add(it.stage);
    }
  }
  const order: SkillStage[] = [...SKILL_STAGES, "rejected"];
  return new Map([...seen].map(([name, stages]) => [name, order.filter((s) => stages.has(s))]));
}
