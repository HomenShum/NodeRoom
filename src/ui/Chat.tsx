/** Public/private Copilot chat surfaces. Reads via useStore(). */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type DragEvent, type KeyboardEvent, type ReactNode } from "react";
import { Lock, MessageCircle, Globe, Send, Sparkles, Copy, Check, ArrowUpRight, Pencil, Paperclip, X, Timer, RefreshCw, ChevronDown, ChevronUp, ListChecks, GitBranch, ShieldCheck, Database } from "lucide-react";
import { useQuery } from "convex/react";
import { useStore, CONVEX_SITE_URL, type PrivateStreamAccess, type RoomStore } from "../app/store";
import { abortable, parseUploadedFiles, UPLOAD_TIMEOUT_MS } from "../app/uploadedArtifact";
import type { StreamId } from "@convex-dev/persistent-text-streaming";
import { api } from "../../convex/_generated/api";
import type { Actor, Channel, Message } from "../engine/types";
import {
  encodeArtifactRefLine,
  hasDraggedArtifactRef,
  parseArtifactRefMessage,
  readDraggedArtifactRef,
  type ArtifactRef,
} from "./artifactRefs";
import { IntakePlanPreview } from "./IntakePlanPreview";

const COLORS = ["#d97757", "#5b9bf5", "#7bd089", "#a78bfa", "#e4c567", "#e8845f"];
function colorFor(store: RoomStore, roomId: string, a: Actor): string {
  if (a.kind === "agent") {
    // A personal agent (acting for a member) wears that member's color; the shared Room agent stays orange.
    if (a.ownerId) return store.listMembers(roomId).find((m) => m.id === a.ownerId)?.color ?? "#d97757";
    return "#d97757";
  }
  return store.listMembers(roomId).find((m) => m.id === a.id)?.color ?? COLORS[0];
}
function initials(name: string): string {
  return name.replace(/[^A-Za-z ]/g, "").split(/[ ]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}
const clock = (ts: number) => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

type StreamStatus = "pending" | "streaming" | "done" | "error" | "timeout";
type StreamBody = { text: string; status: StreamStatus };
type PrivateStreamDriver = StreamBody & { started: boolean; listeners: Set<() => void> };

// BOUND (C1): the driver registry is a module-level singleton — it survives every component unmount
// AND room navigation, and each private agent reply mints a fresh streamId. Without a cap it grows
// for the life of the tab (memory leak under sustained agent use). We evict the oldest drivers that
// are FINISHED (terminal status) with no live listeners; active/streaming drivers and any with a
// mounted reader are never touched. The Map iterates in insertion order, so this is FIFO over idle.
const MAX_PRIVATE_STREAM_DRIVERS = 64;
const MAX_FAILED_SENDS = 50; // bound the per-room failed-send backlog (FIFO); see setFailedSends below
export const privateStreamDrivers = new Map<string, PrivateStreamDriver>();

function evictIdlePrivateStreamDrivers(): void {
  for (const [id, d] of privateStreamDrivers) {
    if (privateStreamDrivers.size <= MAX_PRIVATE_STREAM_DRIVERS) break;
    const terminal = d.status === "done" || d.status === "error" || d.status === "timeout";
    if (terminal && d.listeners.size === 0) privateStreamDrivers.delete(id);
  }
}

export function driverFor(streamId: string): PrivateStreamDriver {
  let driver = privateStreamDrivers.get(streamId);
  if (!driver) {
    driver = { text: "", status: "pending", started: false, listeners: new Set() };
    privateStreamDrivers.set(streamId, driver);
    if (privateStreamDrivers.size > MAX_PRIVATE_STREAM_DRIVERS) evictIdlePrivateStreamDrivers();
  }
  return driver;
}

function agentErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg && msg !== "[object Object]" ? `Agent request failed — ${msg}` : "Agent request failed. Try again.";
}

function notifyDriver(driver: PrivateStreamDriver, patch: Partial<StreamBody>) {
  Object.assign(driver, patch);
  for (const listener of driver.listeners) listener();
}

function startPrivateStreamDriver(streamUrl: URL | null, streamId: string, access: PrivateStreamAccess) {
  const driver = driverFor(streamId);
  if (driver.started) return;
  driver.started = true;
  if (!streamUrl) {
    notifyDriver(driver, { status: "error" });
    return;
  }
  void (async () => {
    try {
      const response = await fetch(streamUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ streamId, requester: access.requester }),
      });
      if (response.status === 205) {
        notifyDriver(driver, { status: "error" });
        return;
      }
      if (!response.ok || !response.body) {
        notifyDriver(driver, { status: "error" });
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        const text = decoder.decode(value, { stream: !done });
        if (text) notifyDriver(driver, { text: driver.text + text, status: "streaming" });
        if (done) {
          notifyDriver(driver, { status: "done" });
          return;
        }
      }
    } catch {
      notifyDriver(driver, { status: "error" });
    }
  })();
}

function usePrivateReplyStream(streamId: string, access: PrivateStreamAccess | null): StreamBody {
  const streamUrl = useMemo(() => CONVEX_SITE_URL ? new URL(`${CONVEX_SITE_URL}/stream-private-reply`) : null, []);
  const [localBody, setLocalBody] = useState<StreamBody>({ text: "", status: "pending" });
  const driven = access?.driven ?? false;
  const requester = access?.requester;

  useEffect(() => {
    if (!driven || !requester) return;
    const driver = driverFor(streamId);
    const sync = () => setLocalBody({ text: driver.text, status: driver.status });
    driver.listeners.add(sync);
    sync();
    startPrivateStreamDriver(streamUrl, streamId, { requester, driven });
    return () => { driver.listeners.delete(sync); };
  }, [driven, requester?.actor.id, requester?.token, streamId, streamUrl]);

  const persistentBody = useQuery(
    api.streaming.getStreamBody,
    access && (!access.driven || localBody.status === "error")
      ? { streamId: streamId as StreamId, requester: access.requester }
      : "skip",
  );

  if (!access) return { text: "", status: "error" };
  if (localBody.status === "error" && persistentBody?.status === "pending") return localBody;
  return persistentBody ?? localBody;
}

/** Live body of a persistent-text-streaming message. The creating tab follows the component's
 * HTTP streaming path and drains the response; other tabs use the persisted chunk query. */
function StreamedBody({ streamId }: { streamId: string }) {
  const store = useStore();
  const { text, status } = usePrivateReplyStream(streamId, store.privateStreamAccess(streamId));
  const live = status === "pending" || status === "streaming";
  return (
    <div className="text" data-testid="stream-body" data-stream-status={status}>
      {text}
      {live && <span className="r-stream-cursor" aria-hidden>▍</span>}
      {status === "error" && <span className="tiny" style={{ color: "var(--danger-ink)" }}> — stream error (partial reply kept)</span>}
      {status === "timeout" && <span className="tiny" style={{ color: "var(--danger-ink)" }}> — stream timed out</span>}
    </div>
  );
}
const shortMs = (ms: number) => ms >= 60_000 ? `${Math.round(ms / 1000) / 60}m` : `${Math.round(ms / 100) / 10}s`;
type OperationStreamRow = { sequence: number; kind: string; name: string; status: string; countDelta?: number; affectedIds?: string[] };
function operationStreamText(op: OperationStreamRow): string {
  const affected = op.affectedIds?.length ? ` - ${op.affectedIds.slice(0, 3).join(", ")}` : "";
  const count = op.countDelta && op.countDelta > 1 ? ` x${op.countDelta}` : "";
  return `${op.kind}: ${op.name}${count}${affected}`;
}

const SLASH_CMDS = [
  { label: "/ask", insert: "/ask ", hint: "ask the Room NodeAgent to act on the diligence artifacts" },
  { label: "/ask diligence CardioNova", insert: "/ask diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps", hint: "enrich the lead company" },
  { label: "/ask runway gaps", insert: "/ask prepare runway and milestone gaps for CardioNova and the batch watchlist", hint: "build banker follow-ups" },
  { label: "/free", insert: "/free ", hint: "force the resumable free-auto model policy" },
  { label: "/demo multi-agent", insert: "/demo multi-agent startup diligence ", hint: "show startup-banking diligence queue lanes" },
];

type DemoAgent = {
  id: string;
  name: string;
  scope: string;
  lane: string;
  color: string;
  startTick: number;
  doneTick: number;
  chunks: string[];
  commit: string;
};

type DemoGoldCase = {
  caseId: string;
  title: string;
  source: string;
  target: string;
  output: string;
  gold: string;
  evals: string[];
};

type DemoQueueItem = {
  label: string;
  startTick: number;
  doneTick: number;
};

type DemoProofItem = {
  label: string;
  value: string;
};

type DemoScenario = {
  eyebrow: string;
  title: string;
  lanes: string[];
  proofBoardLabel: string;
  queue: DemoQueueItem[];
  agents: DemoAgent[];
  claims: string[];
  cases: DemoGoldCase[];
  proof: DemoProofItem[];
};

const MULTI_AGENT_DEMO_MAX_TICK = 12;

const BENCHMARK_MULTI_AGENT_DEMO: DemoScenario = {
  eyebrow: "Public-gold work queue",
  title: "Three agents run public finance docs, exact gold checks, and no-clobber proof",
  lanes: ["child-job streams", "public source receipts", "CAS + eval gates"],
  proofBoardLabel: "Public gold proof board",
  queue: [
  { label: "Load public-gold manifest", startTick: 0, doneTick: 1 },
  { label: "Fan out TAT-DQA, FinanceBench, SEC", startTick: 1, doneTick: 3 },
  { label: "Stream source reads + tool receipts", startTick: 2, doneTick: 8 },
  { label: "Write CellPayloads through CAS", startTick: 6, doneTick: 10 },
  { label: "Run validators and seal handoff", startTick: 9, doneTick: 12 },
  ],
  agents: [
  {
    id: "agent-a",
    name: "Agent A",
    scope: "TAT-DQA PDF arithmetic",
    lane: "Owner token stream",
    color: "#7DD3FC",
    startTick: 1,
    doneTick: 9,
    chunks: [
      "Loaded public report page + OCR blocks.",
      "Claimed D7:D9 and evidence overlay.",
      "Extracted facts: 200,657 and 50,565.",
      "Wrote formula =200657-50565.",
      "Attached bbox/text refs to CellPayload.",
    ],
    commit: "D7 formula, 2 bbox refs, exact result",
  },
  {
    id: "agent-b",
    name: "Agent B",
    scope: "FinanceBench citation QA",
    lane: "Observer semantic chunks",
    color: "#A7F3D0",
    startTick: 2,
    doneTick: 10,
    chunks: [
      "Opened 3M_2018_10K benchmark row.",
      "Read cash-flow evidence page 59.",
      "Matched PP&E purchase line item.",
      "Answered $1,577.00 with citation.",
      "Queued QA memo + source page trace.",
    ],
    commit: "QA answer, page 59 citation, gold match",
  },
  {
    id: "agent-c",
    name: "Agent C",
    scope: "SEC XBRL + no-clobber",
    lane: "Artifact mutation stream",
    color: "#FDE68A",
    startTick: 3,
    doneTick: 12,
    chunks: [
      "Fetched Apple companyfacts snapshot.",
      "Filled revenue, net income, cash flow.",
      "Detected human note edit mid-run.",
      "Skipped stale write; issued review chip.",
      "Updated wiki TOC from verified evidence.",
    ],
    commit: "3 XBRL facts, 1 review chip, 1 wiki block",
  },
  ],
  claims: [
    "D7:D9 + PDF evidence claimed",
    "QA memo + source page claimed",
    "B12:D12 + wiki target claimed",
  ],
  cases: [
  {
    caseId: "tat-dqa-impairment-change",
    title: "TAT-DQA arithmetic proof",
    source: "Financial report PDF + OCR boxes",
    target: "D7",
    output: "=200657-50565 -> 150092 thousand",
    gold: "150092 thousand",
    evals: ["Formula AST PASS", "Value PASS", "Scale PASS", "bbox/text PASS"],
  },
  {
    caseId: "financebench_id_03029",
    title: "FinanceBench citation QA",
    source: "3M_2018_10K, page 59",
    target: "QA memo",
    output: "FY2018 capex = $1,577.00",
    gold: "$1577.00",
    evals: ["Answer PASS", "Evidence page PASS", "PP&E citation PASS"],
  },
  {
    caseId: "sec-aapl-fy2023-xbrl",
    title: "SEC XBRL watchlist fill",
    source: "AAPL 2023 10-K companyfacts",
    target: "B12:D12",
    output: "Revenue 383.285B; NI 96.995B; CFO 110.543B",
    gold: "Accession 0000320193-23-000106",
    evals: ["Digit PASS", "Unit PASS", "Period PASS", "filing PASS"],
  },
  {
    caseId: "noderoom-no-clobber-overlay",
    title: "Collaboration safety overlay",
    source: "Room trace + cell versions",
    target: "Human-owned note",
    output: "stale write rejected; review chip filed",
    gold: "human edit preserved",
    evals: ["CAS PASS", "Lease PASS", "Trace PASS", "Privacy PASS"],
  },
  ],
  proof: [
    { label: "Public gold", value: "4/4 cases validated" },
    { label: "No clobber", value: "human edit preserved" },
    { label: "Evidence", value: "page, bbox, XBRL refs present" },
    { label: "Runtime", value: "3 child jobs, 1 sealed handoff" },
  ],
};

const STARTUP_DILIGENCE_DEMO: DemoScenario = {
  eyebrow: "Startup diligence work queue",
  title: "Three agents turn live banking asks into a cited diligence package",
  lanes: ["company intake stream", "source-backed CellPayloads", "review + handoff gates"],
  proofBoardLabel: "Diligence proof board",
  queue: [
    { label: "Normalize CardioNova intake + five-company batch", startTick: 0, doneTick: 2 },
    { label: "Fan out research, finance runway, and source QA", startTick: 1, doneTick: 4 },
    { label: "Stream source reads, claims, and tool receipts", startTick: 2, doneTick: 8 },
    { label: "Write cited cells, chart artifact, and open questions", startTick: 6, doneTick: 10 },
    { label: "Rebase around human edit and seal handoff", startTick: 9, doneTick: 12 },
  ],
  agents: [
    {
      id: "startup-research",
      name: "Research Agent",
      scope: "CardioNova + batch diligence",
      lane: "Company source stream",
      color: "#7DD3FC",
      startTick: 1,
      doneTick: 9,
      chunks: [
        "Parsed intake: CardioNova, AI triage for hospitals.",
        "Claimed company rows and source-ref columns.",
        "Compared five-company startup banking watchlist.",
        "Wrote ICP, signal, competitors, and freshness cells.",
        "Attached source refs to every CellPayload.",
      ],
      commit: "6 company rows, 18 cited cells, 0 duplicate imports",
    },
    {
      id: "startup-finance",
      name: "Finance Agent",
      scope: "Runway and milestone chart",
      lane: "Deterministic finance tool",
      color: "#A7F3D0",
      startTick: 2,
      doneTick: 10,
      chunks: [
        "Read cash and burn assumptions from the sheet.",
        "Computed runway with deterministic math.",
        "Generated financing-risk status and milestone ticks.",
        "Drafted partner questions for top two companies.",
        "Queued chart artifact with assumption provenance.",
      ],
      commit: "runway chart, 2 milestone packs, assumptions cited",
    },
    {
      id: "startup-review",
      name: "Review Agent",
      scope: "No-clobber + handoff",
      lane: "Artifact mutation stream",
      color: "#FDE68A",
      startTick: 3,
      doneTick: 12,
      chunks: [
        "Detected analyst edit on the diligence sheet.",
        "Skipped stale write and filed a cell-local proposal.",
        "Updated workplan and open questions from verified evidence.",
        "Kept private concerns in the owner lane.",
        "Prepared Gmail, Notion, Slack, Linear, LinkedIn, and CRM drafts.",
      ],
      commit: "1 review chip, private lane preserved, drafts only",
    },
  ],
  claims: [
    "CardioNova row + batch watchlist claimed",
    "Runway chart + milestone questions claimed",
    "Human edit + downstream drafts protected",
  ],
  cases: [
    {
      caseId: "startup-cardionova-intake",
      title: "Singular company intake",
      source: "User call note + public company sources",
      target: "Company research row",
      output: "CardioNova: AI triage for hospitals; watchlist added",
      gold: "No duplicate row; source refs required",
      evals: ["Entity PASS", "Upsert PASS", "Source refs PASS"],
    },
    {
      caseId: "startup-bulk-five",
      title: "Bulk company diligence",
      source: "Startup banking list",
      target: "Research sheet",
      output: "Five companies enriched with ICP, signal, competitor, owner",
      gold: "5/5 rows complete",
      evals: ["Coverage PASS", "Freshness PASS", "CellPayload PASS"],
    },
    {
      caseId: "startup-runway-milestone",
      title: "Runway / milestone chart",
      source: "Cash, burn, and milestone assumptions",
      target: "Chart artifact",
      output: "Runway status + milestone ticks for top two targets",
      gold: "formula-driven, no guessed cash",
      evals: ["Math PASS", "Assumptions PASS", "Chart spec PASS"],
    },
    {
      caseId: "startup-no-clobber-handoff",
      title: "Collaboration safety + handoff",
      source: "Room trace + cell versions + private lane",
      target: "Proposal + drafts",
      output: "human edit preserved; downstream drafts require approval",
      gold: "no silent overwrite or OAuth side effect",
      evals: ["CAS PASS", "Privacy PASS", "Draft-only PASS"],
    },
  ],
  proof: [
    { label: "Sources", value: "18 cited cells" },
    { label: "No clobber", value: "human edit preserved" },
    { label: "Artifacts", value: "sheet, chart, workplan" },
    { label: "Handoff", value: "6 approval-gated drafts" },
  ],
};

function scenarioForDemoPrompt(prompt: string): DemoScenario {
  return /benchmark|public-gold|tat-dqa|financebench|sec\s+xbrl/i.test(prompt)
    ? BENCHMARK_MULTI_AGENT_DEMO
    : STARTUP_DILIGENCE_DEMO;
}

type ChatProps = {
  roomId: string;
  me: Actor;
  channel: Channel;
  variant: "public" | "private";
  agentName: string;
  style?: CSSProperties;
  onOpenArtifact?: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
  coach?: ReactNode;
  embedded?: boolean;
  testId?: string;
};

export function Chat({ roomId, me, channel, variant, agentName, style, onOpenArtifact, coach, embedded = false, testId }: ChatProps) {
  const store = useStore();
  const [text, setText] = useState("");
  const [refs, setRefs] = useState<ArtifactRef[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [jobDetailsOpen, setJobDetailsOpen] = useState(false);
  const [failedSends, setFailedSends] = useState<Array<{ cid: string; text: string }>>([]);
  const [jobBusy, setJobBusy] = useState<null | "cancel" | "retry">(null);
  const [jobErr, setJobErr] = useState<string | null>(null);
  const [agentErr, setAgentErr] = useState<string | null>(null); // C7/C2: honest surface for failed agent dispatches
  const [refOpenErr, setRefOpenErr] = useState<string | null>(null);
  const [roomLane, setRoomLane] = useState(false); // private panel: false = whisper to me, true = act in the room
  const [multiAgentDemoStarted, setMultiAgentDemoStarted] = useState(false);
  const [multiAgentScenario, setMultiAgentScenario] = useState<DemoScenario>(STARTUP_DILIGENCE_DEMO);
  const [multiAgentTick, setMultiAgentTick] = useState(0);
  const feedRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const thinkingStartCount = useRef(0);
  // Room-switch safety: an /ask or private-agent call is fire-and-forget. If the user leaves this room
  // before it resolves, the server action still finishes on its OWN room (every mutation is roomId-scoped,
  // so no cross-room bleed) — but the client must NOT setState or post into an unmounted/stale channel.
  // aliveRef gates those; privTimerRef cancels the memory-mode reply timer on unmount.
  const aliveRef = useRef(true);
  const privTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; if (privTimerRef.current) clearTimeout(privTimerRef.current); };
  }, []);
  const messages = store.listMessages(roomId, channel);
  const isPrivate = variant === "private";
  const longJob = isPrivate ? null : store.lastLongFreeJob();
  const longJobAttempts = isPrivate ? [] : store.lastLongFreeJobAttempts();
  const longJobDetail = isPrivate ? null : store.lastLongFreeJobDetail();
  const liveOperationStream = (!isPrivate && thinking ? (longJobDetail?.operations ?? []).filter((op) => op.sequence >= 1_000).slice(-4) : []) as OperationStreamRow[];
  const hasQ3DemoSeed = !isPrivate && store.listArtifacts(roomId).some((a) => a.kind === "sheet" && a.title === "Q3 variance");
  const slashOptions = useMemo(() => SLASH_CMDS.filter((c) => store.mode === "memory" || c.label !== "/demo multi-agent"), [store.mode]);
  const latestAttempt = longJobAttempts.at(-1);
  const canCancelLongJob = !!longJob && !["completed", "failed", "cancelled"].includes(longJob.status);
  const canRetryLongJob = !!longJob && ["failed", "blocked", "cancelled", "paused", "retrying"].includes(longJob.status);
  const beginThinking = () => { thinkingStartCount.current = messages.length; setAgentErr(null); setThinking(true); };

  useEffect(() => { const el = feedRef.current; if (el && nearBottom.current) el.scrollTop = el.scrollHeight; }, [messages.length, thinking, liveOperationStream.length, multiAgentDemoStarted, multiAgentTick]);
  useEffect(() => {
    setMultiAgentDemoStarted(false);
    setMultiAgentScenario(STARTUP_DILIGENCE_DEMO);
    setMultiAgentTick(0);
  }, [roomId, channel]);
  useEffect(() => {
    if (!multiAgentDemoStarted) return;
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setInterval(() => {
      setMultiAgentTick((tick) => Math.min(MULTI_AGENT_DEMO_MAX_TICK, tick + 1));
    }, prefersReducedMotion ? 1 : 650);
    return () => window.clearInterval(timer);
  }, [multiAgentDemoStarted]);
  useEffect(() => {
    if (!thinking) return;
    if (messages.slice(thinkingStartCount.current).some((m) => m.author.kind === "agent")) setThinking(false);
  }, [messages, thinking]);
  const onScroll = () => { const el = feedRef.current; if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const grow = () => { const el = taRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 120) + "px"; } };

  const send = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t && refs.length === 0) return;
    const messageRefs = refs;
    const messageText = refs.length ? `${encodeArtifactRefLine(refs)}${t ? "\n\n" + t : ""}` : t;
    const cid = crypto.randomUUID();
    void store.postMessage({ roomId, channel, author: me, text: messageText, clientMsgId: cid, kind: "chat" })
      .then((fb) => { if (fb && !fb.ok) setFailedSends((f) => { if (f.some((x) => x.cid === cid)) return f; const next = [...f, { cid, text: messageText }]; return next.length > MAX_FAILED_SENDS ? next.slice(-MAX_FAILED_SENDS) : next; }); });
    setText(""); setRefs([]); setSlashOpen(false); setSlashIndex(0);
    requestAnimationFrame(grow);

    if (!isPrivate && store.mode === "memory" && /^\/demo\s+multi-agent\b/i.test(t)) {
      setMultiAgentTick(0);
      setMultiAgentScenario(scenarioForDemoPrompt(t));
      setMultiAgentDemoStarted(true);
      return;
    }

    if (!isPrivate && /^\/ask\b/i.test(t)) {
      const goal = t.replace(/^\/ask\s*/i, "").trim() || "Diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps.";
      beginThinking();
      void store.askAgent({ goal, references: messageRefs }).catch((e) => { if (aliveRef.current) setAgentErr(agentErrorText(e)); }).finally(() => { if (aliveRef.current) setThinking(false); });
      return;
    }

    if (!isPrivate && /^\/free\b/i.test(t)) {
      const goal = t.replace(/^\/free\s*/i, "").trim() || "Diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps.";
      beginThinking();
      void store.startLongFreeAgent({ goal, references: messageRefs }).catch((e) => { if (aliveRef.current) setAgentErr(agentErrorText(e)); }).finally(() => { if (aliveRef.current) setThinking(false); });
      return;
    }

    if (isPrivate && store.mode === "memory") {
      const reduced = window.matchMedia?.("(prefers-reduced-motion:reduce)").matches ?? false;
      beginThinking();
      privTimerRef.current = setTimeout(() => {
        privTimerRef.current = null;
        if (!aliveRef.current) return; // user left the room — don't post into a stale channel
        setThinking(false);
        const aware = store.awareness(roomId, "agent_priv");
        store.postMessage({
          roomId,
          channel,
          author: { kind: "agent", id: "agent_priv", name: agentName, scope: "private", ownerId: me.id },
          text: aware.activeLocks.length
            ? `I see ${aware.activeLocks.length} active lock(s). I'll read those ranges as context and draft around them. This stays private until you promote it.`
            : "Reading the room context for that. This stays private to you until you promote it.",
          clientMsgId: crypto.randomUUID(),
          kind: "agent",
        });
      }, reduced ? 0 : 900);
    }

    if (isPrivate && store.mode === "convex" && t) {
      // Live private NodeAgent. Private lane → replies only to you. Room lane → acts in the shared room
      // (edits the sheet + posts public chat) as your personal agent, attributed to you.
      beginThinking();
      void store.askPrivateAgent({ goal: t, references: messageRefs }, { publish: roomLane }).catch((e) => { if (aliveRef.current) setAgentErr(agentErrorText(e)); }).finally(() => { if (aliveRef.current) setThinking(false); });
    }
  };

  const promote = (t: string) => {
    void store.postMessage({ roomId, channel: "public", author: me, text: `Sharing from my NodeAgent - ${t}`, clientMsgId: crypto.randomUUID(), kind: "chat" });
  };
  const retrySend = (cid: string, text: string) => {
    void store.postMessage({ roomId, channel, author: me, text, clientMsgId: cid, kind: "chat" })
      .then((fb) => { if (fb && fb.ok) setFailedSends((f) => f.filter((x) => x.cid !== cid)); });
  };
  const dismissFailed = (cid: string) => setFailedSends((f) => f.filter((x) => x.cid !== cid));
  const jobReason = (reason?: string) =>
    reason === "terminal" ? "Can't cancel — the job already finished."
      : reason === "not_retryable" ? "Can't retry — the job is completed or still running."
        : reason === "job_not_found" ? "That job no longer exists."
          : "Action failed — try again.";
  const cancelJob = () => {
    if (!longJob || jobBusy) return;
    setJobBusy("cancel"); setJobErr(null);
    void store.cancelLongFreeJob(longJob.id).then((fb) => { if (!fb.ok) setJobErr(jobReason(fb.reason)); }).finally(() => setJobBusy(null));
  };
  const retryJob = () => {
    if (!longJob || jobBusy) return;
    setJobBusy("retry"); setJobErr(null);
    void store.retryLongFreeJob(longJob.id).then((fb) => { if (!fb.ok) setJobErr(jobReason(fb.reason)); }).finally(() => setJobBusy(null));
  };

  const applySlash = (insert: string) => { setText(insert); setSlashOpen(false); setSlashIndex(0); requestAnimationFrame(() => { grow(); taRef.current?.focus(); }); };
  const addRef = (ref: ArtifactRef) => {
    const art = store.listArtifacts(roomId).find((a) => a.id === ref.id);
    if (!art) return;
    const canonical = { id: art.id, title: art.title, kind: art.kind };
    setRefs((cur) => cur.some((r) => r.id === canonical.id) ? cur : [...cur, canonical]);
  };
  const appendRefs = (nextRefs: ArtifactRef[]) => {
    setRefs((cur) => {
      const seen = new Set(cur.map((r) => r.id));
      const additions = nextRefs.filter((r) => !seen.has(r.id));
      return additions.length ? [...cur, ...additions] : cur;
    });
  };
  const removeRef = (id: string) => setRefs((cur) => cur.filter((r) => r.id !== id));
  const openComposerRef = (ref: ArtifactRef) => {
    const opened = onOpenArtifact?.(ref.id, { split: true });
    if (opened === false) setRefOpenErr(`Couldn't open ${ref.title}. The artifact or proposal no longer exists.`);
    else setRefOpenErr(null);
  };
  const uploadDroppedFiles = async (files: FileList) => {
    if (!files.length || uploadingFiles) return;
    setUploadingFiles(true);
    setUploadError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(new Error("Upload timed out - try fewer or smaller files.")), UPLOAD_TIMEOUT_MS);
    try {
      const parsed = await parseUploadedFiles(files, controller.signal);
      const uploadedRefs: ArtifactRef[] = [];
      let committed = 0;
      try {
        for (const artifact of parsed) {
          const id = await abortable(store.uploadArtifact({ roomId, artifact, actor: me, visibility: isPrivate ? "private" : "room" }), controller.signal);
          uploadedRefs.push({ id, title: artifact.title, kind: artifact.kind });
          committed += 1;
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "please try again";
        throw new Error(committed > 0 ? `Uploaded ${committed} of ${parsed.length} item(s), then failed - ${reason}` : `Upload failed - ${reason}`);
      }
      if (aliveRef.current) appendRefs(uploadedRefs);
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (e) {
      if (aliveRef.current) setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      window.clearTimeout(timer);
      if (aliveRef.current) setUploadingFiles(false);
    }
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedArtifactRef(e.dataTransfer) && !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    if (!isNode(e.relatedTarget) || !e.currentTarget.contains(e.relatedTarget)) setDropActive(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    if (!hasDraggedArtifactRef(e.dataTransfer) && !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    setDropActive(false);
    if (hasDraggedArtifactRef(e.dataTransfer)) {
      const ref = readDraggedArtifactRef(e.dataTransfer);
      if (ref) addRef(ref);
    } else if (e.dataTransfer.files.length) {
      void uploadDroppedFiles(e.dataTransfer.files);
    }
    requestAnimationFrame(() => taRef.current?.focus());
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value; setText(v); grow();
    const open = !isPrivate && v.trimStart() === "/";
    setSlashOpen(open);
    if (open) setSlashIndex(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashOptions.length) % slashOptions.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySlash(slashOptions[slashIndex]?.insert ?? slashOptions[0].insert);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    else if (e.key === "Escape") { if (slashOpen) setSlashOpen(false); else taRef.current?.blur(); }
  };
  const canSend = !uploadingFiles && (text.trim().length > 0 || refs.length > 0);
  const rootClass = embedded ? `r-chat-embedded ${isPrivate ? "private" : "public"}` : `r-panel ${isPrivate ? "right" : "center"}`;

  return (
    <div
      className={rootClass}
      style={style}
      data-drop={String(dropActive)}
      data-testid={testId ?? (isPrivate ? "private-chat-panel" : "public-chat-panel")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="r-panel-head">
        {isPrivate ? <Lock size={14} /> : <MessageCircle size={14} />}
        <span className="h-title">{isPrivate ? "Your NodeAgent" : "Public chat"}</span>
        <span className={"r-tag " + (isPrivate ? "private" : "public")}>{isPrivate ? <><Lock size={10} /> Private</> : <><Globe size={10} /> Everyone</>}</span>
        <span className="grow" />
        {!isPrivate && <span className="r-tag agent" style={{ gap: 6 }}><span className="r-avatar agent sm" style={{ background: "#d97757", width: 18, height: 18, fontSize: 9 }}>N</span>Room NodeAgent</span>}
        {longJob && (() => { const bad = ["failed", "blocked"].includes(longJob.status); return (
          <span className={"r-tag" + (bad ? " danger" : "")} role={bad ? "status" : undefined} title="Latest long-running free-auto job"><Timer size={10} /> {longJob.status} {longJob.attempts}/{longJob.maxAttempts}</span>
        ); })()}
        {canCancelLongJob && (
          <button className="r-iconbtn r-iconbtn-sm" title={jobBusy === "cancel" ? "Cancelling…" : "Cancel long-running job"} aria-label="Cancel long-running job" data-testid="job-cancel" disabled={jobBusy !== null} onClick={cancelJob}>
            <X size={13} />
          </button>
        )}
        {canRetryLongJob && (
          <button className="r-iconbtn r-iconbtn-sm" title={jobBusy === "retry" ? "Retrying…" : "Retry long-running job"} aria-label="Retry long-running job" data-testid="job-retry" disabled={jobBusy !== null} onClick={retryJob}>
            <RefreshCw size={13} />
          </button>
        )}
        {jobErr && <span className="r-tag" role="alert" data-testid="job-error" style={{ color: "var(--danger-ink)" }}>{jobErr}</span>}
      </div>
      {isPrivate && <div className="r-private-banner"><Sparkles size={12} /> Reads room context; output stays yours until you promote it</div>}
      {!isPrivate && longJob && (
        <div className="r-job-strip">
          <Timer size={12} />
          <span>{longJob.modelPolicy}</span>
          {latestAttempt && <span>attempt {latestAttempt.attempt}: {latestAttempt.resolvedModel} · {latestAttempt.stopReason} · {shortMs(latestAttempt.ms)}</span>}
          {longJob.nextRunAt && longJob.status !== "completed" && <span>next {clock(longJob.nextRunAt)}</span>}
          {longJob.error && <span>{longJob.error}</span>}
          <button className="r-job-detail-toggle" type="button" onClick={() => setJobDetailsOpen((open) => !open)} aria-expanded={jobDetailsOpen}>
            {jobDetailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Details
          </button>
        </div>
      )}
      {!isPrivate && longJob && jobDetailsOpen && (
        <div className="r-job-detail" aria-label="Agent job details">
          <div className="r-job-grid">
            <span>Runtime</span><b>{longJob.runtime ?? "inline"}</b>
            <span>Policy</span><b>{longJob.approvalPolicy ?? "n/a"}</b>
            <span>Slices</span><b>{longJob.actionSliceCount ?? 0}</b>
            <span>Model calls</span><b>{longJob.modelCallCount ?? 0}</b>
            <span>Tool calls</span><b>{longJob.toolCallCount ?? 0}</b>
            <span>Mutations</span><b>{longJob.mutationCount ?? 0}</b>
            <span>Receipts</span><b>{longJob.receiptCount ?? 0}</b>
            <span>Scheduler</span><b>{longJob.schedulerHandoffCount ?? 0}</b>
          </div>
          {longJobAttempts.length > 0 && (
            <div className="r-job-list">
              <span className="r-job-list-title">Attempts</span>
              {longJobAttempts.slice(-4).map((attempt) => (
                <span key={`${attempt.attempt}-${attempt.status}`}>{attempt.attempt}. {attempt.status} - {attempt.resolvedModel} - {shortMs(attempt.ms)}</span>
              ))}
            </div>
          )}
          {longJobDetail && (
            <div className="r-job-list">
              <span className="r-job-list-title">Trace</span>
              {longJobDetail.operations.slice(-4).map((op) => (
                <span key={`op-${op.sequence}`}>{op.sequence}. {op.kind}:{op.name} - {op.status}{op.countDelta ? ` x${op.countDelta}` : ""}</span>
              ))}
              {longJobDetail.receipts.slice(0, 3).map((receipt) => (
                <span key={`receipt-${receipt.id}`}>receipt {receipt.mutationName} - {receipt.affectedIds.join(", ")}</span>
              ))}
              {longJobDetail.latestSteps.slice(-3).map((step) => (
                <span key={`step-${step.idx}`}>step {step.idx}: {step.tool} - {step.status}{step.elementId ? ` (${step.elementId})` : ""}</span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="r-chat" ref={feedRef} onScroll={onScroll} aria-live="polite" data-testid="chat-feed">
        {messages.length === 0 && failedSends.length === 0 && <div className="tiny faint" style={{ margin: "auto", textAlign: "center", maxWidth: 260, lineHeight: 1.5 }}>{isPrivate ? "Ask your NodeAgent privately, or press / for commands." : "No messages yet. Ask the room agent, or press / for commands."}</div>}
        {agentErr && <div className="r-msg" role="alert" data-testid="agent-error" data-state="failed"><div className="body tiny" style={{ color: "var(--danger-ink)" }}>{agentErr}</div></div>}
        {messages.map((m) => <Bubble key={m.clientMsgId || m.id} m={m} roomId={roomId} variant={variant} me={me} onPromote={promote} onOpenArtifact={onOpenArtifact} />)}
        {failedSends.map((f) => (
          <div className="r-msg" key={"fail-" + f.cid} data-testid="chat-failed" data-state="failed">
            <span className="r-avatar sm" style={{ background: colorFor(store, roomId, me) }}>{initials(me.name)}</span>
            <div className="body">
              <div className="meta"><span className="who">{me.name}</span><span className="r-tag" style={{ color: "var(--danger-ink)", padding: "1px 5px", fontSize: 9 }}>failed to send</span></div>
              <div className="text" style={{ opacity: 0.75 }}>{parseArtifactRefMessage(f.text).body || f.text}</div>
              <div className="r-msg-actions" style={{ opacity: 1 }}>
                <button className="r-msg-act promote" data-testid="chat-retry" onClick={() => retrySend(f.cid, f.text)}><RefreshCw size={12} /> Retry</button>
                <button className="r-msg-act" onClick={() => dismissFailed(f.cid)}>Dismiss</button>
              </div>
            </div>
          </div>
        ))}
        {!isPrivate && multiAgentDemoStarted && <MultiAgentWorkbenchDemo tick={multiAgentTick} scenario={multiAgentScenario} />}
        {thinking && (
          <div className="r-msg agent" aria-label={`${agentName} is thinking`}>
            <span className="r-avatar agent sm" style={{ background: "#d97757" }}>N</span>
            <div className="body">
              <div className="meta"><span className="who">{agentName}</span><span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>thinking</span></div>
              {liveOperationStream.length ? (
                <div className="r-agent-stream" data-testid="agent-operation-stream" aria-label="Live agent operation stream">
                  {liveOperationStream.map((op) => (
                    <span key={`live-${op.sequence}`} data-status={op.status}>
                      <b>{op.status}</b>{operationStreamText(op)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="r-typing"><i /><i /><i /></div>
              )}
            </div>
          </div>
        )}
        {!isPrivate && coach}
      </div>

      <div className="r-composer">
        {isPrivate && store.mode === "convex" && (
          <div className="r-lane" role="group" aria-label="Where your agent acts">
            <button type="button" className="r-lane-btn" data-on={String(!roomLane)} data-testid="lane-private" onClick={() => setRoomLane(false)} title="Private: your agent reads the room and replies only to you">
              <Lock size={11} /> Private
            </button>
            <button type="button" className="r-lane-btn" data-on={String(roomLane)} data-testid="lane-room" onClick={() => setRoomLane(true)} title="Room: your agent acts in the shared room — edits the sheet + posts to public chat, attributed to you">
              <Globe size={11} /> Room
            </button>
          </div>
        )}
        {slashOpen && (
          <div className="r-slash" role="listbox" aria-label="Commands">
            {slashOptions.map((c, i) => (
              <button key={c.label} className="r-slash-item" role="option" aria-selected={i === slashIndex} onMouseEnter={() => setSlashIndex(i)} onMouseDown={(e) => { e.preventDefault(); applySlash(c.insert); }}>
                <span className="cmd">{c.label}</span><span className="hint">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        {refs.length > 0 && (
          <div className="r-ref-composer" aria-label="Message references">
            {refs.map((ref) => (
              <span key={ref.id} className="r-ref-chip">
                <button className="r-ref-open" type="button" onClick={() => openComposerRef(ref)}>
                  <Paperclip size={12} /> {ref.title}
                </button>
                <button className="r-ref-remove" type="button" aria-label={`Remove ${ref.title}`} onClick={() => removeRef(ref.id)}><X size={11} /></button>
              </span>
            ))}
          </div>
        )}
        {refOpenErr && <div className="r-upload-error" role="alert" data-testid="artifact-ref-open-error">{refOpenErr}</div>}
        {uploadingFiles && <div className="r-upload-error" role="status" data-testid="chat-upload-status">Uploading files...</div>}
        {uploadError && <div className="r-upload-error" role="alert" data-testid="chat-upload-error">{uploadError}</div>}
        <div className="r-intake-preview-slot">
          {text.trim().length > 0 && <IntakePlanPreview roomId={roomId} text={text} targetArtifacts={refs.map((r) => r.id)} />}
        </div>
        <div className="r-input-wrap">
          <textarea ref={taRef} rows={1} value={text} onChange={onChange} onKeyDown={onKeyDown}
            placeholder={isPrivate ? (roomLane ? "Tell your agent to act in the room…" : "Ask privately…") : "Message the room... type / for commands"}
            data-testid="chat-composer"
            aria-label={isPrivate ? "Ask privately" : "Message the room"} />
          {/* The send button reflects the composer state — muted + disabled on empty input,
              not a live accent button that does nothing (state-honesty). */}
          <button className="r-send" onClick={() => send()} disabled={!canSend} data-testid="chat-send" aria-label="Send message"><Send size={15} /></button>
        </div>
        {!isPrivate && !slashOpen && (
          <div className="r-composer-hint">
            {hasQ3DemoSeed && (
              <>
                <button className="r-chip" onClick={() => applySlash(SLASH_CMDS[1].insert)}>/ask diligence CardioNova</button>
                <button className="r-chip" onClick={() => applySlash(SLASH_CMDS[2].insert)}>/ask runway gaps</button>
                {store.mode === "memory" && <button className="r-chip" onClick={() => applySlash(SLASH_CMDS[4].insert)}>/demo multi-agent</button>}
              </>
            )}
            <span className="r-composer-kbd" aria-hidden="true">{hasQ3DemoSeed ? "Enter sends; Shift+Enter newline; / commands" : "Type a request, drop files, or press / for commands"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function statusForTick(startTick: number, doneTick: number, tick: number) {
  if (tick >= doneTick) return "done";
  if (tick >= startTick) return "running";
  return "queued";
}

function pctForTick(startTick: number, doneTick: number, tick: number) {
  if (tick <= startTick) return tick >= startTick ? 12 : 0;
  if (tick >= doneTick) return 100;
  return Math.max(12, Math.round(((tick - startTick) / Math.max(1, doneTick - startTick)) * 100));
}

function MultiAgentWorkbenchDemo({ tick, scenario }: { tick: number; scenario: DemoScenario }) {
  const complete = tick >= MULTI_AGENT_DEMO_MAX_TICK;
  return (
    <div className="r-agent-workbench" data-testid="multi-agent-workbench" aria-label="Multi-agent work queue demo">
      <div className="r-agent-workbench-head">
        <div>
          <span className="r-agent-eyebrow"><GitBranch size={13} /> {scenario.eyebrow}</span>
          <strong>{scenario.title}</strong>
        </div>
        <span className="r-agent-proof-pill" data-done={String(complete)}>{complete ? "HANDOFF SEALED" : "streaming"}</span>
      </div>

      <div className="r-agent-lanes" aria-label="Stream lanes">
        <span><Sparkles size={12} /> {scenario.lanes[0]}</span>
        <span><Database size={12} /> {scenario.lanes[1]}</span>
        <span><ShieldCheck size={12} /> {scenario.lanes[2]}</span>
      </div>

      <div className="r-command-queue" aria-label="Command queue">
        {scenario.queue.map((item) => {
          const status = statusForTick(item.startTick, item.doneTick, tick);
          return (
            <div className="r-command-item" data-status={status} key={item.label}>
              <ListChecks size={13} />
              <span>{item.label}</span>
              <b>{status}</b>
            </div>
          );
        })}
      </div>

      <div className="r-agent-grid">
        {scenario.agents.map((agent) => {
          const status = statusForTick(agent.startTick, agent.doneTick, tick);
          const pct = pctForTick(agent.startTick, agent.doneTick, tick);
          const visibleCount = Math.max(1, Math.min(agent.chunks.length, Math.floor(Math.max(0, tick - agent.startTick) / 2) + 1));
          const chunks = agent.chunks.slice(0, visibleCount);
          const active = status === "running";
          return (
            <div className="r-agent-card" data-status={status} data-testid={`multi-agent-${agent.id}`} key={agent.id} style={{ "--agent-color": agent.color } as CSSProperties}>
              <div className="r-agent-card-head">
                <span className="r-agent-dot" />
                <span>
                  <strong>{agent.name}</strong>
                  <small>{agent.scope}</small>
                </span>
                <b>{status}</b>
              </div>
              <div className="r-agent-progress" aria-label={`${agent.name} progress`}>
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="r-agent-stream" aria-label={`${agent.name} stream`}>
                <em>{agent.lane}</em>
                {chunks.map((chunk, idx) => (
                  <span key={`${agent.id}-${idx}`}>{chunk}{active && idx === chunks.length - 1 ? <i aria-hidden="true">|</i> : null}</span>
                ))}
              </div>
              <div className="r-agent-commit">
                <span>{agent.commit}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="r-agent-claims" aria-label="Claimed ranges">
        {scenario.claims.map((claim, index) => (
          <span key={claim} style={{ "--claim-color": ["#7DD3FC", "#A7F3D0", "#FDE68A"][index] ?? "#CBD5E1" } as CSSProperties}>{claim}</span>
        ))}
      </div>

      <div className="r-agent-stream-strip" aria-label="Concurrent stream summary">
        {scenario.agents.map((agent) => {
          const status = statusForTick(agent.startTick, agent.doneTick, tick);
          const visibleCount = Math.max(1, Math.min(agent.chunks.length, Math.floor(Math.max(0, tick - agent.startTick) / 2) + 1));
          const latest = status === "done" ? agent.commit : agent.chunks[visibleCount - 1];
          return (
            <span key={`${agent.id}-strip`} data-status={status} style={{ "--agent-color": agent.color } as CSSProperties}>
              <i />
              <b>{agent.name}</b>
              <em>{latest}</em>
            </span>
          );
        })}
      </div>

      <div className="r-gold-board" aria-label={scenario.proofBoardLabel}>
        <div className="r-gold-board-head">
          <span>Source document</span>
          <span>NodeRoom output</span>
          <span>Gold / eval</span>
        </div>
        {scenario.cases.map((goldCase, index) => {
          const active = tick >= Math.max(2, index + 4);
          return (
            <div className="r-gold-row" data-active={String(active)} key={goldCase.caseId}>
              <div>
                <b>{goldCase.title}</b>
                <em>{goldCase.source}</em>
                <code>{goldCase.caseId}</code>
              </div>
              <div>
                <b>{goldCase.target}</b>
                <em>{active ? goldCase.output : "waiting for child receipt"}</em>
              </div>
              <div className="r-gold-evals">
                <b>{goldCase.gold}</b>
                {goldCase.evals.map((item) => <span key={item}>{active ? item : "queued"}</span>)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="r-agent-proof-grid" data-testid={complete ? "multi-agent-complete" : undefined}>
        {scenario.proof.map((item) => (
          <span key={item.label}><b>{item.label}</b><em>{item.value}</em></span>
        ))}
      </div>
    </div>
  );
}

function Bubble({ m, roomId, variant, me, onPromote, onOpenArtifact }: { m: Message; roomId: string; variant: "public" | "private"; me: Actor; onPromote: (t: string) => void; onOpenArtifact?: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void }) {
  const store = useStore();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.text);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [openErr, setOpenErr] = useState<string | null>(null);
  const parsed = parseArtifactRefMessage(m.text);
  const agent = m.author.kind === "agent";
  const viaOwner = agent && m.author.ownerId ? store.listMembers(roomId).find((x) => x.id === m.author.ownerId)?.name : null;
  const ask = !agent && parsed.body.trim().startsWith("/ask");
  const mine = !agent && m.author.id === me.id;
  const canPromote = agent && variant === "private";
  const pending = String(m.id).startsWith("opt-"); // optimistic, not yet confirmed by the server
  // QA P2 perf: the avatar style depends only on the author's color — don't rebuild per feed render.
  const avatarStyle = useMemo(() => ({ background: colorFor(store, roomId, m.author) }), [store, roomId, m.author]);
  const copy = () => { void navigator.clipboard?.writeText(m.text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }); };
  const saveEdit = () => {
    const t = draft.trim();
    if (t && t !== m.text) {
      setEditing(false); // optimistic update paints the new text instantly
      void store.editMessage(m.id, t, me).then((fb) => { setEditErr(fb.ok ? null : "Couldn't save your edit — it was reverted."); });
    } else setEditing(false);
  };
  const openRef = (ref: ArtifactRef) => {
    const opened = onOpenArtifact?.(ref.id, { split: true });
    if (opened === false) setOpenErr(`Couldn't open ${ref.title}. The artifact or proposal no longer exists.`);
    else setOpenErr(null);
  };

  return (
    <div className={"r-msg" + (agent ? " agent" : "")} data-testid="chat-message" data-clientmsgid={m.clientMsgId} data-state={pending ? "pending" : "confirmed"} style={pending ? { opacity: 0.6 } : undefined}>
      <span className={"r-avatar sm" + (agent ? " agent" : "")} style={avatarStyle}>{agent ? "N" : initials(m.author.name)}</span>
      <div className="body">
        <div className="meta">
          <span className="who">{m.author.name}</span>
          {agent && <span className="r-tag agent" style={{ padding: "1px 5px", fontSize: 9 }}>agent</span>}
          {viaOwner && <span className="r-tag" data-testid="agent-via" style={{ padding: "1px 5px", fontSize: 9 }}>via {viaOwner}</span>}
          {pending && <span className="r-tag" data-testid="chat-pending" style={{ padding: "1px 5px", fontSize: 9 }}>sending…</span>}
          <span className="time">{clock(m.createdAt)}</span>
        </div>
        {editing ? (
          <div className="r-input-wrap" style={{ marginTop: 4 }}>
            <textarea autoFocus rows={1} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); saveEdit(); } else if (e.key === "Escape") { setDraft(m.text); setEditing(false); } }}
              aria-label="Edit message" />
          </div>
        ) : (
          <>
            {parsed.refs.length > 0 && (
              <div className="r-msg-refs">
                {parsed.refs.map((ref) => (
                  <button key={ref.id} className="r-msg-ref" type="button" onClick={() => openRef(ref)}>
                    <Paperclip size={11} /> {ref.title}
                  </button>
                ))}
              </div>
            )}
            {m.streamId && !m.text ? (
              <StreamedBody streamId={m.streamId} />
            ) : (
              parsed.body && (ask ? <span className="r-bubble-ask">{parsed.body}</span> : <div className="text">{parsed.body}</div>)
            )}
          </>
        )}

        {editErr && <div className="tiny" role="alert" data-testid="chat-edit-error" style={{ color: "var(--danger-ink)", marginTop: 2 }}>{editErr}</div>}
        {openErr && <div className="tiny" role="alert" data-testid="chat-ref-error" style={{ color: "var(--danger-ink)", marginTop: 2 }}>{openErr}</div>}
        {editing ? (
          <div className="r-msg-actions" style={{ opacity: 1 }}>
            <button className="r-msg-act promote" data-testid="chat-edit-save" onClick={saveEdit}>Save</button>
            <button className="r-msg-act" onClick={() => { setDraft(m.text); setEditErr(null); setEditing(false); }}>Cancel</button>
          </div>
        ) : (
          <div className="r-msg-actions">
            <button className="r-msg-act" onClick={copy} aria-label="Copy message">{copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}</button>
            {mine && <button className="r-msg-act" data-testid="chat-edit" onClick={() => { setDraft(m.text); setEditErr(null); setEditing(true); }} aria-label="Edit message"><Pencil size={12} /> Edit</button>}
            {canPromote && <button className="r-msg-act promote" onClick={() => onPromote(m.text)} aria-label="Promote to the public chat"><ArrowUpRight size={12} /> Promote to public</button>}
          </div>
        )}
      </div>
    </div>
  );
}

function isNode(value: EventTarget | null): value is Node {
  return value instanceof Node;
}

function hasDraggedFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files") || dataTransfer.files.length > 0;
}
