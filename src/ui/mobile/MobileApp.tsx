/* ============================================================================
   NodeAgent Mobile (Terracotta) — app controller
   Collaboration command layer: Home · Capture · Room · Agent · Inbox · Artifacts,
   a contextual expandable FAB + universal mode-aware composer (with an expanded
   "Ask NodeAgent" panel + live voice mode), an agent control tower, and a
   nine-sheet bottom-sheet stack with a stacking trace/source overlay above it.
   Deep artifact work stays on desktop.

   Ported from the design prototype (terra/na-app.jsx). The prototype's live
   Tweaks panel + raw iOS bezel were design-iteration affordances; here the
   canonical terracotta defaults are baked in (mobileTweaks.ts), the variant
   matrix ships as the Settings sheet, and the surface renders inside the ported
   IOSDevice frame (full-bleed on real phone widths). The `live` prop (injected
   by MobileAppLive when bound to a Convex room) re-routes chat / agent / row /
   jobs / inbox through the real store; everything else uses the seed narrative.
   Mounted at the `#mobile` route — see src/ui/App.tsx.
   ============================================================================ */
import * as React from "react";
import "./mobile.tokens.css";
import "./mobile.css";
import "./mobileFrame.css";
import "./mobile.shell.css";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import * as D from "./mobileData";
import type {
  TabId,
  SheetId,
  ComposerMode,
  AgentLane,
  RoomMsg,
  AgentMsg,
  QuickPrompt,
  InboxItem,
  Stat,
  RoomEntry,
  Extraction,
} from "./mobileData";
import type {
  MobileCtx,
  MobileLive,
  TweaksConfig,
  SaveState,
  RunState,
  CopyTone,
  CopyCtx,
  ScopeName,
  OverlayState,
} from "./mobileTypes";
import { Home, Capture, Inbox } from "./MobileScreens";
import { RoomChat, AgentChat, JobsSheet } from "./MobileChat";
import { PlanSheet, EvidenceSheet, CoachSheet } from "./MobileSheets";
import { Files, RowSheet } from "./MobileFiles";
import { ArtifactSheet } from "./MobileDeck";
import { SheetArtifact } from "./MobileGrid";
import { TraceOverlay, SourceOverlay } from "./MobileOverlay";
import { SettingsSheet } from "./MobileSettings";
import { ReviewSheet, TraceSheet, ShareSheet, ManageSheet, FirstJoinOverlay, OfflineBanner } from "./MobileGapSheets";
import { loadTweaks, saveTweaks } from "./mobileTweaks";
import { IOSDevice, MobileStage } from "./MobileFrame";
import { MobileHeader, type MobileHeaderAction } from "./shell/MobileHeader";
import { haptic } from "./mobileUtil";
import { liveAgentCreditBlockReason } from "./mobileCredits";
import { MODEL_REGISTRY } from "../../landing/modelRegistry";
import type { AgentModelSelection } from "../../app/store";

// ── static config (ported verbatim from na-app.jsx) ─────────────────────────
const TABS: Record<TabId, { icon: IconName; label: string }> = {
  home: { icon: "home", label: "Home" },
  capture: { icon: "pen", label: "Capture" },
  room: { icon: "room", label: "Room" },
  agent: { icon: "sparkles", label: "Agent" },
  inbox: { icon: "inbox", label: "Review" },
  files: { icon: "file", label: "Files" },
};
const TAB_IDS: TabId[] = ["home", "capture", "room", "agent", "inbox", "files"];
const SCOPES: ScopeName[] = ["Private", "Room"];

interface RevActCtx {
  openInbox: (i: InboxItem) => void;
  item: InboxItem;
  beginRun: () => void;
  setResolved: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  toast: (m: string) => void;
  openSheet: (k: SheetId) => void;
  startSearch: (i?: unknown) => void;
}
interface RevType {
  type: string;
  label: string;
  primary: string | null;
  primaryIcon?: IconName;
  openIcon: IconName;
  open: string;
  primaryAct?: (c: RevActCtx) => void;
}
// distinct review types for the merged "needs your review" list (agents sheet)
const REV_TYPE: Record<string, RevType> = {
  deck: { type: "review", label: "Review", primary: null, openIcon: "layers", open: "Open deck" },
  plan: {
    type: "approve",
    label: "Approve",
    primary: "Approve",
    primaryIcon: "check",
    openIcon: "sparkles",
    open: "Review plan",
    primaryAct: ({ beginRun, setResolved, toast }) => {
      setResolved((r) => ({ ...r, i_plan: true }));
      beginRun();
      toast("Research approved");
    },
  },
  evidence: {
    type: "gap",
    label: "Source gap",
    primary: "Search sources",
    primaryIcon: "search",
    openIcon: "file",
    open: "Open evidence",
    primaryAct: ({ startSearch, item }) => startSearch(item),
  },
  coach: { type: "coach", label: "Practice", primary: null, openIcon: "coach", open: "Open coach" },
  _default: { type: "review", label: "Review", primary: null, openIcon: "chevR", open: "Open" },
};

interface ModelOpt {
  id: string;
  name: string;
  desc: string;
  icon: IconName;
}
// Mobile composer chips: room-agent asks pass this selection through the
// existing NodeRoom model route contract. Private live asks use the server
// default until the private-agent API grows explicit route selection.
const MODELS: ModelOpt[] = [
  { id: "auto", name: "Auto-route", desc: "Picks the cheapest model that can do the job", icon: "route" },
  ...MODEL_REGISTRY.map((m): ModelOpt => ({ id: m.id, name: m.displayName, desc: m.sub, icon: m.icon as IconName })),
];

export function mobileAgentModelSelection(modelId: string): AgentModelSelection {
  return modelId === "auto" ? { mode: "adaptive" } : { mode: "specific", modelPolicy: modelId };
}

export function mobileDevicePreviewRequested(): boolean {
  if (typeof window === "undefined") return false;
  const hash = window.location.hash;
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : window.location.search);
  return params.get("preview") === "device" || params.get("previewDeviceChrome") === "1";
}

export function mobileVisibilityRoute(scope: ScopeName): { composerMode: "agent"; agentLane: AgentLane } {
  return { composerMode: "agent", agentLane: scope === "Room" ? "room" : "private" };
}

interface AttachOpt {
  id: string;
  label: string;
  sub: string;
  icon: IconName;
  kind: string;
}
const ATTACH: AttachOpt[] = [
  { id: "camera", label: "Camera", sub: "Snap a doc or whiteboard", icon: "camera", kind: "file" },
  { id: "photos", label: "Photos", sub: "From your library", icon: "image", kind: "file" },
  { id: "files", label: "Files & sources", sub: "PDF, sheet, export", icon: "paperclip", kind: "file" },
  { id: "mention", label: "Mention entity", sub: "Company, person, room", icon: "at", kind: "context" },
  { id: "context", label: "Room context", sub: "Pull an artifact in", icon: "layers", kind: "context" },
  { id: "tools", label: "Tools & skills", sub: "Web, enrich, coach", icon: "puzzle", kind: "tool" },
];

function copyFor(tone: CopyTone, saveState: SaveState): CopyCtx {
  const save = {
    analyst: { saving: "Saving…", saved: "Saved · scanning after pause", idle: "Autosaves as you type" },
    calm: { saving: "Saving…", saved: "Saved automatically", idle: "Saves as you type" },
    command: { saving: "SYNC…", saved: "Saved · scan queued", idle: "Local draft" },
  }[tone];
  const noticed = {
    analyst: { t: "NodeRoom noticed CardioNova", s: "Company, person, funding signal, and a source gap." },
    calm: { t: "Found a few things", s: "A company, a person, and something worth a look." },
    command: { t: "4 signals on this capture", s: "CardioNova · Maya · Series B · source gap" },
  }[tone];
  return { save: save[saveState] || save.idle, noticedTitle: noticed.t, noticedSub: noticed.s };
}

const VOICE: Record<ComposerMode, string> = {
  note: "Met Maya from CardioNova — possible Series B, ask about burn and paid pilots.",
  room: "CardioNova still needs the paid-pilot source before we trust runway.",
  agent: "Research CardioNova’s latest funding and confirm monthly burn.",
  source: "techcrunch.com/cardionova-series-b — paid-pilot claim, needs corroboration.",
};

// agent reply generator → returns [{delay, msg}]
type AgentReplyMsg =
  | { role: "agent"; variant: "status"; text: string }
  | { role: "agent"; variant: "text"; text: string }
  | { role: "agent"; variant: "summary"; title: string; sub: string; stats: Stat[]; open?: SheetId; openLabel?: string };

function agentReply(text: string): { delay: number; msg: AgentReplyMsg }[] {
  const s = text.toLowerCase();
  if (/search|source|pilot|gap|corroborat|verif/.test(s))
    return [
      { delay: 450, msg: { role: "agent", variant: "status", text: "Scanning approved sources for the paid-pilot claim…" } },
      {
        delay: 1600,
        msg: {
          role: "agent",
          variant: "summary",
          title: "Found 2 candidate sources",
          sub: "read-only · needs your review",
          open: "evidence",
          openLabel: "Open evidence",
          stats: [{ v: "2", l: "sources" }, { v: "1", l: "strong" }, { v: "$0.01", l: "cost", mono: true }],
        },
      },
    ];
  if (/research|funding|burn|enrich|cardionova/.test(s))
    return [
      { delay: 450, msg: { role: "agent", variant: "status", text: "Planning a read-only run inside approved scope…" } },
      {
        delay: 1300,
        msg: {
          role: "agent",
          variant: "summary",
          title: "CardioNova diligence plan",
          sub: "read-only · approval required",
          stats: [{ v: "4", l: "reads" }, { v: "0", l: "writes" }, { v: "$0.01", l: "est. cost", mono: true }],
        },
      },
    ];
  if (/follow.?up|draft|email|maya/.test(s))
    return [
      { delay: 450, msg: { role: "agent", variant: "status", text: "Drafting a follow-up…" } },
      {
        delay: 1200,
        msg: {
          role: "agent",
          variant: "text",
          text: "Draft: “Hi Maya — great meeting you. Two quick things to confirm for our notes: are the hospital pilots paid, and what’s the current monthly burn? Happy to share what we’re building in return.” Want me to log it as a task?",
        },
      },
    ];
  if (/summar|today|notes/.test(s))
    return [
      { delay: 450, msg: { role: "agent", variant: "status", text: "Reading today’s notes…" } },
      {
        delay: 1200,
        msg: {
          role: "agent",
          variant: "text",
          text: "Today: 1 new company (CardioNova), 1 contact (Maya Chen), 1 funding signal (Series B, unverified), and 1 open source gap (paid pilots). Nothing was written to shared artifacts yet.",
        },
      },
    ];
  return [{ delay: 700, msg: { role: "agent", variant: "text", text: "Got it. I’ll keep this scoped to what you’ve approved and propose anything before it lands." } }];
}

// flatten an extraction object → { "group.key": value } so we can diff scans
function flattenExtract(ex: Extraction | null | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  ((ex && ex.groups) || []).forEach((g) => g.rows.forEach((r) => { m[g.id + "." + r.k] = r.v; }));
  return m;
}
function diffExtract(prev: Extraction, next: Extraction): string[] {
  const a = flattenExtract(prev);
  const b = flattenExtract(next);
  return Object.keys(b).filter((k) => a[k] !== b[k]);
}

// ── expandable agent row (pulse · agents) — tap to reveal what the agent did ──
type AgentRowCtx = {
  openTrace: (id: string) => void;
  openFromTrace: (job: { artifact?: string; artifactName?: string; trace?: string }) => void;
  toast: (m: string) => void;
};

function AgentRow({ a, ctx }: { a: D.PulseAgent; ctx: AgentRowCtx }): React.ReactElement {
  const [open, setOpen] = React.useState(false);
  const did = a.did || [];
  const st = a.status || { label: a.dot ? "running" : "idle", live: !!a.dot };
  return (
    <div className="na-agentrow" data-open={open} data-kind={a.kind || "orch"}>
      <button className="na-agentrow-head" onClick={() => setOpen((v) => !v)}>
        <span className="av agent">{Ico("sparkles")}</span>
        <span className="rm">
          <strong>{a.name}</strong>
          <span>{a.role}</span>
        </span>
        <span className="na-agentstat" data-live={st.live ? "true" : undefined}>
          {st.live ? <span className="na-agentstat-dot" /> : null}
          {st.label}
        </span>
        <span className="na-agentrow-chev" data-open={open}>{Ico("chevD")}</span>
      </button>
      {open && (
        <div className="na-agentdid">
          {did.length ? (
            did.map((d, i) => (
              <button
                key={i}
                className="na-didrow"
                data-nav={true}
                onClick={/^r_/.test(d.trace || "") ? () => ctx.openTrace(d.trace) : () => ctx.toast(d.trace === "queued" ? "Queued — waiting on approval" : "Trace " + (d.trace || "—"))}
              >
                <span className="na-diddot" data-live={!!d.live}>{d.live ? <i className="spin" /> : null}</span>
                <span className="na-didmain">
                  <strong>{d.title}</strong>
                  <span>{d.sub}</span>
                </span>
                <span className="na-didtrace">{D.refLabel(d.trace)}</span>
                {(d.artifact || /^r_/.test(d.trace || "")) && <span className="na-didgo">{Ico("chevR")}</span>}
              </button>
            ))
          ) : (
            <p className="na-ask-note" style={{ textAlign: "left", margin: 0, padding: "4px 2px" }}>No actions yet — this agent is idle.</p>
          )}
        </div>
      )}
    </div>
  );
}

interface FabAction {
  icon: IconName;
  label: string;
  tone?: string;
  run: () => void;
  keepOpen?: boolean;
  muted?: boolean;
  active?: boolean;
  badge?: number;
}

export function MobileApp({ live }: { live?: MobileLive } = {}): React.ReactElement {
  const [tweaks, setTweaks] = React.useState<TweaksConfig>(() => loadTweaks());
  const previewDeviceChrome = React.useMemo(mobileDevicePreviewRequested, []);
  const t = tweaks;
  const setTweak = <K extends keyof TweaksConfig>(key: K, value: TweaksConfig[K]): void => {
    setTweaks((prev) => ({ ...prev, [key]: value }) as TweaksConfig);
  };

  const [tab, setTab] = React.useState<TabId>(t.navModel);
  const [fabOpen, setFabOpen] = React.useState(false);
  const [headerScrolled, setHeaderScrolled] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [note, setNote] = React.useState<string>(() => live ? "" : D.SEED_NOTE);
  const [saveState, setSaveState] = React.useState<SaveState>(live ? "idle" : "saved");
  const [detected, setDetected] = React.useState(!live);
  const [noticed, setNoticed] = React.useState(!live);
  const [extract, setExtract] = React.useState<Extraction>(() => D.deriveExtraction(live ? "" : D.SEED_NOTE));
  const [flashKeys, setFlashKeys] = React.useState<string[]>([]);
  const extractRef = React.useRef<Extraction>(extract);
  const [sheet, setSheet] = React.useState<SheetId | null>(null);
  const [sheetStack, setSheetStack] = React.useState<SheetId[]>([]);
  const [runState, setRunState] = React.useState<RunState>("plan");
  const [resolved, setResolved] = React.useState<Record<string, boolean>>({});
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  // collaboration state
  const [composerMode, setComposerMode] = React.useState<ComposerMode>(live ? "agent" : "note");
  const [draft, setDraft] = React.useState<string>("");
  const [listening, setListening] = React.useState(false);
  const [agentLane, setAgentLane] = React.useState<AgentLane>("private");
  const [roomMsgs, setRoomMsgs] = React.useState<RoomMsg[]>(() => D.ROOM_CHAT.slice());
  const [agentMsgs, setAgentMsgs] = React.useState<{ private: AgentMsg[]; room: AgentMsg[] }>(() => ({
    private: D.AGENT_CHAT.private.slice(),
    room: D.AGENT_CHAT.room.slice(),
  }));
  const [scope, setScope] = React.useState<ScopeName>("Private");
  const [roomId, setRoomId] = React.useState<string>("q3");
  const [askOpen, setAskOpen] = React.useState(false);
  const dockInputRef = React.useRef<HTMLInputElement | null>(null);
  const [attachMenu, setAttachMenu] = React.useState(false);
  const [modelMenu, setModelMenu] = React.useState(false);
  const [model, setModel] = React.useState<string>("auto");
  const [attachments, setAttachments] = React.useState<AttachOpt[]>([]);
  const [voiceLive, setVoiceLive] = React.useState(false);
  const [pinned, setPinned] = React.useState<string[]>([]);
  const [overlay, setOverlay] = React.useState<OverlayState>(null);
  const [flashSheet, setFlashSheet] = React.useState<SheetId | null>(null);
  const [pulseView, setPulseView] = React.useState<"people" | "agents" | "cost">("people");
  const [openRev, setOpenRev] = React.useState<string | null>(null);
  const sheetReturnFocus = React.useRef<HTMLElement | null>(null);

  // ── gap pack: memory-mode-local state (live values override via `live`) ──
  // In a live room, auto-allow is the room's flag and toggling it hits the store;
  // offline these are device-local so the Settings screen is still interactive.
  const [memAutoAllow, setMemAutoAllow] = React.useState(true);
  // Notification tiers have no local backend to write, so memory mode shows them
  // static + honest (backed:false surfaces the "coming with backend" caption).
  const memNotifRows = D.NOTIF_ROWS;
  // Rows the user swiped-right in memory mode (live mode uses ctx.isRowWatched).
  const [memWatched, setMemWatched] = React.useState<Set<string>>(() => new Set());
  // First-join welcome: shown once per session for live rooms (never in memory).
  const [firstJoinSeen, setFirstJoinSeen] = React.useState(false);
  React.useEffect(() => {
    if (!live) { setFirstJoinSeen(true); return; }
    if (live.loading) return; // wait for hydration so the counts are real
    try {
      const key = "noderoom:mobileFirstJoin:" + (live.inviteCode || live.roomName || "room");
      if (typeof window !== "undefined" && window.sessionStorage.getItem(key) === "1") setFirstJoinSeen(true);
    } catch { /* sessionStorage unavailable — overlay shows once in memory */ }
  }, [live, live?.loading, live?.inviteCode, live?.roomName]);
  const dismissFirstJoin = React.useCallback(() => {
    setFirstJoinSeen(true);
    try {
      if (live && typeof window !== "undefined") {
        window.sessionStorage.setItem("noderoom:mobileFirstJoin:" + (live.inviteCode || live.roomName || "room"), "1");
      }
    } catch { /* ignore */ }
  }, [live]);

  const firstRun = React.useRef(true);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voiceTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const flashTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mid = React.useRef(100);
  const clearTimers = (): void => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  const toast = React.useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 1900);
  }, []);

  // ── derived room descriptor + honest live rosters ──
  // In a live room, presence / people / agents come from real members; cost and
  // a multi-room list aren't wired, so those surfaces show real data or an
  // honest "not available" state — never the sample narrative (HONEST_STATUS).
  const sampleRoom: RoomEntry = D.ROOMS.find((r) => r.id === roomId) || D.ROOMS[0];
  const liveMembers = live ? Object.values(live.people) : [];
  const liveHumans = liveMembers.filter((p) => !p.agent);
  const liveAgents = liveMembers.filter((p) => p.agent);
  const room: RoomEntry = live
    ? { id: "live", name: live.roomName, code: live.roomCode, role: live.canApprove ? "Host" : "Member", people: live.liveCount, agents: liveAgents.length, live: true, pending: live.inboxItems.length }
    : sampleRoom;
  const rosterPeople: { short: string; name: string; role: string; color: string }[] = live
    ? liveHumans.map((p) => ({ short: p.short, name: p.name, role: "In the room", color: p.color }))
    : D.PULSE.people;
  const roomList: RoomEntry[] = live ? [room] : D.ROOMS;
  const jobCount = live ? live.jobs.running.length + live.jobs.queued.length + live.jobs.completed.length : 0;

  const closeSheet = React.useCallback((): void => {
    setSheet(null);
    setSheetStack([]);
  }, []);
  const openSheet = (k: SheetId): void => {
    setSheet((cur) => {
      if (cur && cur !== k) setSheetStack((s) => [...s, cur]);
      return k;
    });
  };
  const backSheet = (): void => {
    setSheetStack((stk) => {
      if (stk.length) {
        setSheet(stk[stk.length - 1]);
        return stk.slice(0, -1);
      }
      setSheet(null);
      return [];
    });
  };

  React.useEffect(() => {
    if (!sheet) {
      const target = sheetReturnFocus.current;
      sheetReturnFocus.current = null;
      requestAnimationFrame(() => target?.focus());
      return;
    }

    if (!sheetReturnFocus.current && document.activeElement instanceof HTMLElement) {
      sheetReturnFocus.current = document.activeElement;
    }
    const node = document.querySelector<HTMLElement>('.na-sheet[data-open="true"]');
    if (!node) return;
    node.setAttribute("role", "dialog");
    node.setAttribute("aria-modal", "true");
    node.setAttribute("aria-label", node.querySelector(".na-sheet-head strong")?.textContent?.trim() || "NodeRoom panel");
    node.tabIndex = -1;

    const focusable = (): HTMLElement[] => Array.from(node.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    )).filter((element) => !element.hasAttribute("aria-hidden"));
    if (!node.contains(document.activeElement)) requestAnimationFrame(() => (focusable()[0] ?? node).focus());

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeSheet();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        node.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    node.addEventListener("keydown", onKeyDown);
    return () => {
      node.removeEventListener("keydown", onKeyDown);
      node.removeAttribute("role");
      node.removeAttribute("aria-modal");
      node.removeAttribute("aria-label");
      node.removeAttribute("tabindex");
    };
  }, [closeSheet, sheet]);

  const openTrace = (id: string): void => setOverlay({ type: "trace", id });
  const openSource = (src: D.SourceRef): void => setOverlay({ type: "source", src });
  const closeOverlay = (): void => setOverlay(null);
  const togglePin = (name: string): void => setPinned((xs) => (xs.includes(name) ? xs.filter((n) => n !== name) : [...xs, name]));

  // navigate from a job's trace receipt to the finished artifact, then pulse it
  const openFromTrace = (job: { artifact?: string; artifactName?: string; trace?: string }): void => {
    const target = (job.artifact || "row") as SheetId;
    setOverlay(null);
    setSheet(target);
    toast("Opened " + (job.artifactName || "artifact") + " · " + (job.trace || "trace"));
    clearTimeout(flashTimer.current);
    setFlashSheet(target);
    flashTimer.current = setTimeout(() => setFlashSheet(null), 1700);
  };

  const applyVisibilityScope = (next: ScopeName): void => {
    const route = mobileVisibilityRoute(next);
    setScope(next);
    setComposerMode(route.composerMode);
    setAgentLane(route.agentLane);
  };
  const cycleScope = (): void => applyVisibilityScope(SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length]);
  const toggleScope = (): void => applyVisibilityScope(scope === "Private" ? "Room" : "Private");
  const switchRoom = (id: string): void => {
    // Live mode is bound to exactly one room — tapping it just closes the sheet.
    if (live) {
      closeSheet();
      return;
    }
    setRoomId(id);
    closeSheet();
    toast("Switched to " + ((D.ROOMS.find((r) => r.id === id) || { name: "room" }).name));
  };
  const joinRoom = (): void => {
    if (live?.onLeave) {
      live.onLeave();
      return;
    }
    closeSheet();
    toast("Enter a room code to join");
  };
  const leaveRoom = (): void => {
    if (live?.onLeave) {
      live.onLeave();
      return;
    }
    closeSheet();
    toast("Left " + room.name);
  };
  const setAskMode = (mode: ComposerMode): void => {
    setComposerMode(mode);
    if (mode === "room") {
      setScope("Room");
      setAgentLane("room");
      setModelMenu(false);
    } else if (mode === "note" || mode === "source") {
      setScope("Private");
      setModelMenu(false);
    } else if (scope === "Room") {
      setAgentLane("room");
    }
  };
  const openAsk = (mode?: ComposerMode): void => {
    if (mode) setAskMode(mode);
    setAskOpen(true);
  };
  const closeAsk = (): void => setAskOpen(false);
  const mentionPerson = (name: string): void => {
    const handle = "@" + (name || "").split(/[ ·]/)[0];
    closeSheet();
    setTab("room");
    setComposerMode("room");
    setAgentLane("room");
    setScope("Room");
    setDraft(handle + " ");
    openAsk("room");
  };
  const openPulse = (v: "people" | "agents" | "cost"): void => {
    setPulseView(v);
    setSheet("pulse");
  };
  const toggleRev = (id: string): void => setOpenRev((v) => (v === id ? null : id));

  // ── effects ──────────────────────────────────────────────────────────────
  React.useEffect(() => { setTab(t.navModel); }, [t.navModel]);
  // contextual FAB collapses whenever the screen changes underneath it
  React.useEffect(() => { setFabOpen(false); }, [tab]);
  React.useEffect(() => { setHeaderScrolled(false); }, [tab]);
  // composer mode follows the chat tab
  React.useEffect(() => {
    if (tab === "room") setComposerMode("room");
    else if (tab === "agent") setComposerMode("agent");
    else if (tab === "capture") setComposerMode(live ? "agent" : "note");
    else if (tab === "home" && live) setComposerMode("agent");
  }, [live, tab]);

  // re-run detection after the note settles (silent rescan → flash changed rows)
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const ids: ReturnType<typeof setTimeout>[] = [];
    setSaveState("saving");
    ids.push(setTimeout(() => setSaveState("saved"), 850));
    if (t.passive !== "off") {
      setDetected(true);
      setNoticed(true);
      ids.push(
        setTimeout(() => {
          const next = D.deriveExtraction(note);
          const changed = diffExtract(extractRef.current, next);
          extractRef.current = next;
          setExtract(next);
          if (changed.length) {
            setFlashKeys(changed);
            ids.push(setTimeout(() => setFlashKeys([]), 1500));
          }
        }, 1100),
      );
    } else {
      setDetected(false);
      setNoticed(false);
    }
    return () => ids.forEach(clearTimeout);
  }, [note, t.passive]);

  // Apply the chosen theme at the document level so the standalone mobile route
  // picks up the app's light/dark token sets; restore on unmount.
  React.useEffect(() => {
    const html = document.documentElement;
    const prev = html.getAttribute("data-theme");
    html.setAttribute("data-theme", t.dark ? "dark" : "light");
    return () => {
      if (prev === null) html.removeAttribute("data-theme");
      else html.setAttribute("data-theme", prev);
    };
  }, [t.dark]);

  // persist tweaks as a side effect (not inside the setState updater)
  React.useEffect(() => { saveTweaks(tweaks); }, [tweaks]);

  React.useEffect(
    () => () => {
      clearTimers();
      clearTimeout(toastTimer.current);
      clearTimeout(voiceTimer.current);
      clearTimeout(flashTimer.current);
    },
    [],
  );

  // ── attachments ──
  const addAttachment = (a: AttachOpt): void => {
    if (live) {
      setAttachMenu(false);
      toast(`${a.label} was not attached. Mobile upload and context attachments are not wired yet.`);
      return;
    }
    setAttachments((xs) => (xs.find((x) => x.label === a.label) ? xs : [...xs, a]));
    setAttachMenu(false);
    toast(a.label + " added");
  };
  const removeAttachment = (label: string): void => setAttachments((xs) => xs.filter((x) => x.label !== label));

  const beginRun = (): void => {
    if (live) {
      toast("This local sample plan cannot run in a live room. Ask NodeAgent from the Agent tab instead.");
      return;
    }
    setRunState("running");
    timers.current.push(
      setTimeout(() => {
        setRunState("done");
        setResolved((r) => ({ ...r, i_plan: true }));
        toast("Research complete · evidence ready");
      }, 1300),
    );
  };

  const openInbox = (item: InboxItem): void => {
    if (live && item.status === "approve") {
      setTab("inbox");
      closeSheet();
      toast("Review this live proposal with Approve or Reject.");
    }
    else if (item.kind === "plan") openSheet("plan");
    else if (item.kind === "evidence") openSheet("evidence");
    else if (item.kind === "coach") openSheet("coach");
    else if (item.kind === "deck") openSheet("artifact");
    else if (live) {
      setTab("inbox");
      toast("Open the live proposal or trace from Inbox.");
    } else toast("Trace receipt · 4 reads · 0 writes");
  };

  // ── composer / chat (mock) ──────────────────────────────────────────────
  const pushAgent = (lane: AgentLane, msg: AgentReplyMsg | { role: "user"; text: string }): void =>
    setAgentMsgs((prev) => ({ ...prev, [lane]: [...prev[lane], { id: "a" + mid.current++, text: "", ...msg }] }));
  const pushRoom = (msg: Omit<RoomMsg, "id">): void =>
    setRoomMsgs((prev) => [...prev, { id: "m" + mid.current++, ...msg }]);

  const agentCreditBlockReason = live ? liveAgentCreditBlockReason(live.credits) : null;
  const requestLiveRoomAgent = (goal: string) => {
    if (!live) return Promise.resolve({ ok: false, reason: "offline_sample" });
    if (agentCreditBlockReason) return Promise.resolve({ ok: false, reason: agentCreditBlockReason });
    return live.askRoomAgent(goal, mobileAgentModelSelection(model));
  };
  const sendAgent = (text: string, lane?: AgentLane): boolean => {
    const ln = lane || agentLane;
    if (live) {
      if (agentCreditBlockReason) {
        toast(agentCreditBlockReason);
        return false;
      }
      // Live: route through the room/private agent; replies stream back via the store.
      const request = ln === "room"
        ? requestLiveRoomAgent(text)
        : live.askPrivateAgent(text);
      void request.then((r) => { if (!r.ok) toast("Agent error — " + (r.reason ?? "try again")); });
      return true;
    }
    pushAgent(ln, { role: "user", text });
    if (/runway|explain|prep|coach/i.test(text)) {
      timers.current.push(
        setTimeout(() => {
          pushAgent(ln, { role: "agent", variant: "status", text: "Setting up a coach drill…" });
          openSheet("coach");
        }, 500),
      );
      return true;
    }
    agentReply(text).forEach(({ delay, msg }) => timers.current.push(setTimeout(() => pushAgent(ln, msg), delay)));
    return true;
  };

  const sendComposer = (): boolean => {
    const text = draft.trim();
    if (!text) return false;
    haptic();
    if (composerMode === "note") {
      if (live) {
        toast("Live capture is not connected on mobile yet. Nothing was saved or sent.");
        return false;
      }
      setNote((n) => (n ? n + "\n" + text : text));
      setTab("capture");
      toast("Added to capture");
    } else if (composerMode === "room") {
      if (live) {
        void live.postRoomMessage(text).then((r) => {
          if (!r.ok) {
            toast("Message failed — " + (r.reason ?? "try again"));
            return; // keep the draft so nothing typed is lost
          }
          setTab("room");
          setDraft("");
        });
        return true;
      }
      pushRoom({ who: "homen", kind: "msg", t: "now", text });
      if (/@agent|research|agent/i.test(text)) {
        timers.current.push(setTimeout(() => pushRoom({ who: "room_na", kind: "status", t: "now", text: "Picking that up — proposing a plan to the room." }), 700));
      }
      setTab("room");
    } else if (composerMode === "source") {
      if (live) {
        toast("Source capture is not wired on mobile yet. Nothing was uploaded.");
        return false;
      }
      toast("Source captured for evidence");
    } else {
      if (!sendAgent(text)) return false;
      setTab("agent");
    }
    setDraft("");
    return true;
  };
  const sendAsk = (): void => {
    const had = draft.trim();
    const sent = sendComposer();
    if (had && sent) setAskOpen(false);
  };

  // Retry a failed optimistic send (re-posts the message text). Reachable only
  // when a message carries failed=true; the live store auto-reverts optimistic
  // rows on error today, so this is a forward-looking, side-effect-safe hook.
  const retryMessage = (id: string): void => {
    const list = live ? live.roomMsgs : roomMsgs;
    const msg = list.find((m) => m.kind === "msg" && (m.clientId === id || m.id === id) && m.failed);
    if (!msg || !msg.text) return;
    if (live) void live.postRoomMessage(msg.text);
    else pushRoom({ who: "homen", kind: "msg", t: "now", text: msg.text });
  };

  const startVoice = (): void => {
    if (live) {
      toast("Voice input is not connected on mobile yet. Nothing was recorded.");
      return;
    }
    setListening(true);
    clearTimeout(voiceTimer.current);
    voiceTimer.current = setTimeout(() => {
      setListening(false);
      setDraft((d) => (d ? d + " " : "") + VOICE[composerMode]);
    }, 1400);
  };
  const stopVoice = (): void => {
    clearTimeout(voiceTimer.current);
    setListening(false);
  };

  const runQuick = (q: QuickPrompt): void => {
    setTab("agent");
    setComposerMode("agent");
    if (q.kind === "coach") {
      sendAgent(q.text);
      return;
    }
    sendAgent(q.text);
  };

  const openRow = (): void => openSheet("row");
  const askAboutRow = (): void => {
    setTab("agent");
    setComposerMode("agent");
    sendAgent(`What's missing on the ${live?.row.entity ?? D.ROW.entity} row?`, "room");
    setAgentLane("room");
    closeSheet();
  };

  // "Search sources" — spins up a read-only research run (vs "Open evidence")
  const startSearch = (_item?: unknown): void => {
    const claim = live?.evidence.claim ?? D.EVIDENCE.claim;
    if (!sendAgent(`Search approved room sources for this unresolved claim: ${claim}. Return a source-backed proposal and trace any gaps.`, "room")) return;
    closeSheet();
    setTab("agent");
    setComposerMode("agent");
    setAgentLane("room");
    toast("Searching sources · read-only run");
  };

  // ── inbox source (live items when bound, else the sample inbox) ──
  const inboxSource: InboxItem[] = live ? live.inboxItems : D.INBOX;
  const pendingItems = inboxSource.filter((i) => !resolved[i.id] && i.statusTone !== "ok");
  const openCount = pendingItems.length;
  const firstPending = pendingItems[0];

  // ── contextual expandable FAB ──────────────────────────────────────────
  const askAgent = (): void => {
    setComposerMode("agent");
    setTab("agent");
    setAgentLane("room");
    setScope("Room");
    openAsk("agent");
  };
  const fab = ((): { hero: IconName; actions: FabAction[] } => {
    const a: FabAction[] = [];
    let hero: IconName = "plus";
    if (tab === "home") {
      hero = "sparkles";
      a.push({ icon: "pen", label: "New capture", run: () => setTab("capture") });
      a.push({ icon: "sparkles", label: "Ask NodeAgent", run: askAgent });
      a.push({ icon: "building", label: "Switch room", run: () => openSheet("rooms") });
    } else if (tab === "capture") {
      hero = "sparkles";
      if (live) {
        a.push({ icon: "message", label: "Open room chat", run: () => setTab("room") });
        a.push({ icon: "sparkles", label: "Ask NodeAgent", run: askAgent });
      } else {
        a.push({ icon: "sparkles", label: "Extract fields", run: () => { setComposerMode("note"); setTab("capture"); toast("Re-running extraction"); } });
        a.push({ icon: "arrowUp", label: "Send to agent", run: askAgent });
        a.push({ icon: "pen", label: "New capture", run: () => { setNote(""); toast("Blank capture"); } });
      }
    } else if (tab === "room") {
      hero = "pen";
      a.push({ icon: "pen", label: "Message room", run: () => { setComposerMode("room"); setAgentLane("room"); setScope("Room"); openAsk("room"); } });
      a.push({ icon: "history", label: "Agent jobs", run: () => openSheet("jobs") });
      a.push({ icon: "building", label: "Switch room", run: () => openSheet("rooms") });
    } else if (tab === "agent") {
      hero = "sparkles";
      a.push({ icon: "sparkles", label: "Ask NodeAgent", run: askAgent });
      a.push({ icon: "search", label: "Search sources", run: () => startSearch(D.EVIDENCE) });
      a.push({ icon: "history", label: "Job history", run: () => openSheet("jobs") });
    } else if (tab === "inbox") {
      hero = "checkCircle";
      if (firstPending) a.push({ icon: "check", label: "Review next", tone: "warn", run: () => openInbox(firstPending) });
      a.push({ icon: "sparkles", label: "Ask NodeAgent", run: askAgent });
      a.push({ icon: "building", label: "Switch room", run: () => openSheet("rooms") });
    } else {
      hero = "sparkles";
      a.push({ icon: "sparkles", label: "Ask NodeAgent", run: askAgent });
      a.push({ icon: "building", label: "Switch room", run: () => openSheet("rooms") });
    }
    return { hero, actions: a };
  })();

  const headerActions: MobileHeaderAction[] = [
    { id: "jobs", icon: "history", label: "Agent jobs", meta: jobCount ? String(jobCount) : undefined, onSelect: () => openSheet("jobs") },
    { id: "people", icon: "users", label: "People", meta: String(room.people), onSelect: () => openSheet("manage") },
    { id: "activity", icon: "sparkles", label: "Room activity", meta: String(room.agents), onSelect: () => openPulse("agents") },
    { id: "usage", icon: "signal", label: "Usage", meta: live?.credits ? `${live.credits.availableCredits.toFixed(1)} cr` : undefined, onSelect: () => openPulse("cost") },
    { id: "trace", icon: "history", label: "Trace", onSelect: () => openSheet("trace") },
    { id: "share", icon: "link", label: "Share", onSelect: () => openSheet("share") },
    { id: "settings", icon: "settings", label: "Settings", onSelect: () => openSheet("settings") },
  ];

  // ── ctx prop bag (every screen / sheet receives this) ──
  const ctx: MobileCtx = {
    t,
    setTweak,
    tab,
    note,
    setNote,
    saveState,
    detected,
    noticed,
    copy: copyFor(t.copyTone, saveState),
    extract,
    flashKeys,
    openSheet,
    closeSheet,
    backSheet,
    canBack: sheetStack.length > 0,
    openInbox,
    startSearch,
    approveResearch: beginRun,
    runReadOnly: beginRun,
    openFromTrace,
    openTrace,
    openSource,
    closeOverlay,
    overlay,
    mentionPerson,
    togglePin,
    pinned,
    runState,
    resolved,
    resolvedCount: openCount,
    version: runState === "done" ? "v42" : D.ROOM.version,
    toast,
    composerMode,
    setComposerMode,
    draft,
    setDraft,
    sendComposer,
    listening,
    startVoice,
    stopVoice,
    agentLane,
    setAgentLane,
    roomMsgs: live ? live.roomMsgs : roomMsgs,
    agentMsgs: live ? { private: live.agentPrivate, room: live.agentRoom } : agentMsgs,
    people: live?.people ?? D.PEOPLE,
    isLive: !!live,
    runQuick,
    requestRoomAgent: requestLiveRoomAgent,
    openRow,
    askAboutRow,
    row: live?.row ?? D.ROW,
    editRowField: live?.editRowField ?? (async () => ({ ok: false, reason: "offline" })),
    inboxItems: inboxSource,
    jobs: live ? live.jobs : D.JOBS,
    canApprove: live ? live.canApprove : true,
    resolveProposalById: live ? live.resolveProposalById : async () => ({ ok: false, reason: "offline" }),
    jobAct: live ? live.jobAct : async () => ({ ok: false, reason: "offline" }),
    loading: live ? live.loading : false,
    retryMessage,
    setTab,
    scope,
    cycleScope,
    toggleScope,
    openAsk,
    closeAsk,
    sendAsk,
    askOpen,
    room,
    roomId,
    switchRoom,
    joinRoom,
    leaveRoom,
    // Home: live artifacts as recents; favorites/briefings have no live source yet.
    recents: live ? live.recents : D.RECENTS,
    favorites: live ? [] : D.FAVORITES,
    briefings: live ? [] : D.BRIEFINGS,
    livePlan: live?.plan,
    liveEvidence: live?.evidence,
    liveCoach: live?.coach,
    credits: live?.credits,
    liveDeck: live?.deck,
    recordDeckExportReceipt: live?.recordDeckExportReceipt ?? (async () => ({ ok: false, reason: "offline" })),

    // ── gap pack: live projections override the memory-mode samples ──
    pipeline: live ? live.pipeline : D.PIPELINE,
    traceRows: live ? live.traceRows : D.TRACE_ROWS,
    peopleGroups: live ? live.peopleGroups : D.PEOPLE_GROUPS,
    inviteCode: live ? live.inviteCode : D.ROOM.code,
    offline: live?.offline,
    acknowledgeOfflineConflicts: live?.acknowledgeOfflineConflicts,
    autoAllow: live ? live.autoAllow : memAutoAllow,
    setAutoAllow: (on: boolean) => {
      if (live) { live.setAutoAllow(on); }
      else { setMemAutoAllow(on); toast(on ? "Agent commits auto-allow on" : "Agent commits now wait in Review"); }
    },
    notifRows: live ? live.notifRows : memNotifRows,
    notifBacked: live ? live.notifBacked : false,
    watchRow: async (rowId: string, on: boolean) => {
      if (live) return live.watchRow(rowId, on);
      setMemWatched((prev) => { const next = new Set(prev); if (on) next.add(rowId); else next.delete(rowId); return next; });
      return { ok: true };
    },
    isRowWatched: (rowId: string) => (live ? live.isRowWatched(rowId) : memWatched.has(rowId)),
    flagRowNeedsReview: (rowId: string) => (live ? live.flagRowNeedsReview(rowId) : Promise.resolve({ ok: false, reason: "offline" })),
  };

  const SCREENS: Record<TabId, React.FC<{ ctx: MobileCtx }>> = {
    home: Home,
    capture: Capture,
    room: RoomChat,
    agent: AgentChat,
    inbox: Inbox,
    files: Files,
  };
  const Screen = SCREENS[tab] || Home;
  const activeModel = MODELS.find((m) => m.id === model) || MODELS[0];
  const modelRoutingAvailable = composerMode === "agent" && (!live || agentLane === "room");
  const visibleModel = modelRoutingAvailable ? activeModel : MODELS[0];
  const askModeMeta: Record<ComposerMode, { ph: string; ctx: string }> = {
    note: { ph: "Capture a thought, paste a source…", ctx: "Current note" },
    room: { ph: "Message the room…  @agent to ask", ctx: room.name },
    agent: { ph: "Ask NodeAgent to research, draft, or check…", ctx: "Room context" },
    source: { ph: "Paste a URL or describe a source…", ctx: "New source" },
  };
  const mentions = Array.from(new Set((draft.match(/@[\w·]+/g) || []).map((x) => x.replace(/[·]+$/, "")))).filter((x) => x.length > 1);

  const fanActions: FabAction[] = fab.actions;

  return (
    <MobileStage dark={t.dark} previewDeviceChrome={previewDeviceChrome}>
      <IOSDevice dark={t.dark} width={402} height={874} previewDeviceChrome={previewDeviceChrome}>
        <div
          className="na-app"
          data-theme={t.dark ? "dark" : "light"}
          data-density={t.density}
          data-accent={t.accent}
          data-motion={t.motion}
          data-ask={askOpen ? "true" : undefined}
        >
          <MobileHeader
            roomName={room.name}
            roomLive={room.live}
            reviewCount={openCount}
            scrolled={headerScrolled}
            onSwitchRoom={() => openSheet("rooms")}
            onOpenReview={() => setTab("inbox")}
            secondaryActions={headerActions}
          />

          {live?.experience === "sample" ? (
            <div className="gp-sample-banner" data-testid="mobile-sample-banner" role="status">
              {Ico("shield", { width: 13, height: 13 })}
              <span>
                <strong>{live.starterBackfill === "pending" ? "Sample still loading." : "Sample workspace."}</strong>{" "}
                Companies, sources, messages, and traces are synthetic{live.starterBackfill === "pending" ? "; missing sample artifacts retry automatically" : ""}.
              </span>
            </div>
          ) : null}

          {/* ── offline hold banner: held edits are visible, never lost ── */}
          <OfflineBanner ctx={ctx} />

          {/* active screen */}
          <div
            className="na-body"
            key={tab}
            onScroll={(event) => setHeaderScrolled(event.currentTarget.scrollTop > 0)}
          >
            <Screen ctx={ctx} />
          </div>

          {/* ── first-join welcome (live rooms only; once per session) ── */}
          {live && !firstJoinSeen && !live.loading && (
            <FirstJoinOverlay people={liveHumans.length} agents={liveAgents.length} sample={live.experience === "sample"} credits={live.credits} onDismiss={dismissFirstJoin} />
          )}

          {/* ── command dock: contextual expandable FAB + direct text bar ── */}
          <div className="na-bottom-shell">
            <div className="na-dock">
            <div className="na-fab" data-open={fabOpen ? "true" : undefined} data-mode="actions">
              {fabOpen && (
                <div className="na-fab-fan">
                  {fanActions.map((ac, idx) => (
                    <button
                      key={ac.label}
                      className={"na-fab-act" + (ac.tone ? " " + ac.tone : "") + (ac.muted ? " muted" : "") + (ac.active ? " active" : "")}
                      style={{ "--d": idx * 30 + "ms" } as React.CSSProperties}
                      onClick={() => { haptic(); if (!ac.keepOpen) setFabOpen(false); ac.run(); }}
                    >
                      <span className="fa-ic">{Ico(ac.icon)}{ac.badge ? <span className="fa-badge">{ac.badge}</span> : null}</span>
                      <span className="fa-lbl">{ac.label}{ac.active ? <span className="fa-dot" /> : null}</span>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="na-fab-btn"
                aria-label={fabOpen ? "Close menu" : "Quick actions"}
                aria-expanded={fabOpen ? "true" : "false"}
                title={fabOpen ? "Close menu" : "Quick actions"}
                onClick={() => { haptic(); setAddOpen(false); setFabOpen((v) => !v); }}
              >
                <span className="fb-ic">{Ico(fabOpen ? "x" : fab.hero)}</span>
              </button>
            </div>
            <div className="na-dock-bar">
              {attachments.length > 0 && (
                <div className="na-dock-chips">
                  {attachments.map((a) => (
                    <span key={a.label} className="na-dock-chip" data-kind={a.kind}>
                      {Ico(a.icon)}<span>{a.label}</span>
                      <button onClick={() => removeAttachment(a.label)} aria-label={"Remove " + a.label}>{Ico("x")}</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="na-dock-row">
                <div className="na-add" data-open={addOpen ? "true" : undefined}>
                  {addOpen && (
                    <div className="na-add-fan">
                      <div className="na-add-cap">Add to message</div>
                      {ATTACH.map((a, idx) => (
                        <button
                          key={a.id}
                          className="na-add-act"
                          style={{ "--d": (ATTACH.length - 1 - idx) * 26 + "ms" } as React.CSSProperties}
                          onClick={() => { setAddOpen(false); addAttachment(a); }}
                        >
                          <span className="fa-ic" data-kind={a.kind}>{Ico(a.icon)}</span>
                          <span className="fa-lbl"><strong>{a.label}</strong><span className="sub">{a.sub}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    className="na-dock-add"
                    data-on={addOpen ? "true" : undefined}
                    aria-label={addOpen ? "Close add menu" : "Add to message"}
                    onClick={() => { setFabOpen(false); setAddOpen((v) => !v); }}
                  >
                    {Ico(addOpen ? "x" : "plus")}
                  </button>
                </div>
                <input
                  ref={dockInputRef}
                  className="na-dock-input"
                  aria-label={tab === "room" ? "Message everyone in this room" : "Ask NodeAgent"}
                  value={draft}
                  type="text"
                  placeholder={tab === "room" ? "Message the room…" : live || tab === "agent" ? "Ask NodeAgent…" : "Ask NodeAgent or capture…"}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendComposer(); } }}
                />
                {draft.trim() ? (
                  <button className="na-dock-send" onClick={sendComposer} aria-label="Send">{Ico("arrowUp")}</button>
                ) : null}
              </div>
            </div>
          </div>
            <nav className="na-nav" data-style={t.navStyle} data-testid="mobile-bottom-nav" aria-label="Primary mobile navigation">
              {TAB_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="na-nav-item"
                  data-active={tab === id ? "true" : undefined}
                  data-testid={`mobile-nav-${id}`}
                  aria-current={tab === id ? "page" : undefined}
                  aria-label={TABS[id].label}
                  onClick={() => setTab(id)}
                >
                  {Ico(TABS[id].icon, { "aria-hidden": true })}
                  <span>{TABS[id].label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* scrims for the FAB fan + bottom sheets */}
          <div className="na-fab-scrim" data-open={fabOpen || addOpen ? "true" : undefined} onClick={() => { setFabOpen(false); setAddOpen(false); }} />
          <div className="na-scrim" data-open={!!sheet} onClick={closeSheet} />

          {/* ── rooms switcher ── */}
          <div className="na-sheet" data-open={sheet === "rooms"}>
            <div className="na-handle" />
            {sheet === "rooms" && (
              <>
                <div className="na-sheet-head">
                  <div className="st">
                    <strong>Rooms</strong>
                    <span>{live ? "Connected to this room" : "You’re in " + D.ROOMS.length + " rooms"}</span>
                  </div>
                  <button className="na-close" onClick={closeSheet} aria-label="Close">{Ico("x")}</button>
                </div>
                <div className="na-sheet-body">
                  <div className="na-rooms">
                    {roomList.map((r) => (
                      <button key={r.id} className="na-roomrow" data-active={live ? true : r.id === roomId} onClick={() => switchRoom(r.id)}>
                        <span className="rdot" data-live={r.live} />
                        <span className="rm">
                          <strong>{r.name}</strong>
                          <span className="meta">{r.role + " · " + r.people + " people · " + r.agents + " agents" + (r.live ? "" : " · idle")}</span>
                        </span>
                        {r.pending > 0 && <span className="na-pill warn">{r.pending}</span>}
                        {live || r.id === roomId ? <span className="rcheck">{Ico("check")}</span> : <span className="chevR">{Ico("chevR")}</span>}
                      </button>
                    ))}
                  </div>
                  <div className="na-room-actions">
                    <button className="na-btn primary" onClick={joinRoom}>{Ico("plus")}Join a room</button>
                    <button
                      className="na-btn danger"
                      onClick={leaveRoom}
                      disabled={Boolean(live?.canApprove)}
                      title={live?.canApprove ? "Host transfer is required before leaving" : undefined}
                    >
                      {Ico("logout")}{live?.canApprove ? "Host owns this room" : "Leave " + room.name}
                    </button>
                    {live?.onSignOut && <button className="na-btn" onClick={live.onSignOut}>{Ico("logout")}Sign out of NodeRoom</button>}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* ── pulse roster (people / agents / cost) ── */}
          <div className="na-sheet" data-open={sheet === "pulse"}>
            <div className="na-handle" />
            {sheet === "pulse" && (() => {
              const heads: Record<string, [string, string]> = {
                people: ["People", room.people + " in " + room.name],
                agents: ["Agents", room.agents + " agents · " + (openCount ? openCount + " to review" : "all caught up")],
                cost: ["Usage and limits", (live?.credits ? `${live.credits.availableCredits.toFixed(1)} credits available` : live ? "Wallet unavailable" : D.ROOM.costToday) + " · " + room.name],
              };
              const h = heads[pulseView];
              return (
                <>
                  <div className="na-sheet-head">
                    <div className="st"><strong>{h[0]}</strong><span>{h[1]}</span></div>
                    <button className="na-close" onClick={closeSheet} aria-label="Close">{Ico("x")}</button>
                  </div>
                  <div className="na-sheet-body">
                    {pulseView === "people" && (
                      <div className="na-roster people">
                        {rosterPeople.length === 0 ? (
                          <p className="na-ask-note" style={{ textAlign: "left", padding: "10px 2px" }}>Just you so far — share the room code to bring others in.</p>
                        ) : null}
                        {rosterPeople
                          .slice()
                          .sort((a, b) => (pinned.includes(b.name) ? 1 : 0) - (pinned.includes(a.name) ? 1 : 0))
                          .map((p) => (
                            <div key={p.name} className="na-roster-row" data-pinned={pinned.includes(p.name)} style={{ "--idc": p.color } as React.CSSProperties}>
                              <button className="na-roster-msg" onClick={() => mentionPerson(p.name)}>
                                <span className="av" style={{ background: p.color }}>{p.short}</span>
                                <span className="rm">
                                  <strong>{p.name}{pinned.includes(p.name) && <span className="na-pinmark">{Ico("pin")}</span>}</strong>
                                  <span>{p.role}</span>
                                </span>
                                <span className="na-roster-cta">{Ico("message")}@</span>
                              </button>
                              <button className="na-pinbtn" data-on={pinned.includes(p.name)} onClick={() => togglePin(p.name)} aria-label={pinned.includes(p.name) ? "Unpin" : "Pin"}>{Ico("pin")}</button>
                            </div>
                          ))}
                      </div>
                    )}
                    {pulseView === "agents" && (
                      <>
                        {openCount ? <div className="na-kicker" style={{ marginTop: 0 }}>Needs your review</div> : null}
                        {openCount ? (
                          <div className="na-revlist">
                            {pendingItems.map((i) => {
                              const TM = REV_TYPE[i.kind] || REV_TYPE._default;
                              const menuOpen = openRev === i.id;
                              const actions: { label: string; icon: IconName; run: () => void }[] = [];
                              if (live) {
                                actions.push({
                                  label: "Review proposal",
                                  icon: "chevR",
                                  run: () => { setTab("inbox"); closeSheet(); },
                                });
                              } else if (TM.primary) {
                                actions.push({
                                  label: TM.primary,
                                  icon: TM.primaryIcon || "chevR",
                                  run: () => { if (TM.primaryAct) TM.primaryAct({ openInbox, item: i, beginRun, setResolved, toast, openSheet, startSearch }); else openInbox(i); },
                                });
                              }
                              if (!live) actions.push({ label: TM.open, icon: TM.openIcon, run: () => openInbox(i) });
                              const lead = actions[0];
                              const single = actions.length === 1;
                              return (
                                <div key={i.id} className="na-revrow" data-type={TM.type} data-open={menuOpen}>
                                  <button className="na-revrow-head" onClick={() => openInbox(i)}>
                                    <span className="rv-ico" data-type={TM.type}>{Ico(i.icon as IconName)}</span>
                                    <span className="rv-main"><strong>{i.title}</strong><span className="rv-sub">{i.sub}</span></span>
                                  </button>
                                  <div className="na-revact">
                                    <button
                                      className="na-revact-btn"
                                      data-type={TM.type}
                                      data-on={menuOpen}
                                      onClick={(e) => { e.stopPropagation(); if (single) lead.run(); else toggleRev(i.id); }}
                                    >
                                      {Ico(lead.icon)}<span>{lead.label}</span>
                                      {!single && <span className="cv" data-open={menuOpen}>{Ico("chevD")}</span>}
                                    </button>
                                    {menuOpen && !single && (
                                      <div className="na-revmenu" role="menu">
                                        {actions.map((a, ai) => (
                                          <button key={ai} className="na-revmenu-row" data-primary={ai === 0} onClick={(e) => { e.stopPropagation(); setOpenRev(null); a.run(); }}>
                                            {Ico(a.icon)}{a.label}
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                        <div className="na-kicker" style={{ marginTop: openCount ? 6 : 0 }}>Agents in this room</div>
                        {live ? (
                          <>
                            <div className="na-roster">
                              {liveAgents.length ? (
                                liveAgents.map((p) => (
                                  <div key={p.name} className="na-roster-row">
                                    <button className="na-roster-msg" onClick={() => openSheet("jobs")}>
                                      <span className="av agent" style={{ background: p.color }}>{p.short}</span>
                                      <span className="rm"><strong>{p.name}</strong><span>Room agent</span></span>
                                      <span className="na-roster-cta">{Ico("history")}Jobs</span>
                                    </button>
                                  </div>
                                ))
                              ) : (
                                <p className="na-ask-note" style={{ textAlign: "left", padding: "10px 2px 0" }}>No agents have joined this room yet.</p>
                              )}
                            </div>
                            <p className="na-ask-note" style={{ textAlign: "left", padding: "10px 2px 0" }}>Open Jobs for live agent runs and their traces.</p>
                          </>
                        ) : (
                          <>
                            <div className="na-roster">
                              {D.PULSE.agents.map((a) => (
                                <AgentRow key={a.id || a.name} a={a} ctx={{ openFromTrace, openTrace, toast }} />
                              ))}
                            </div>
                            <p className="na-ask-note" style={{ textAlign: "left", padding: "10px 2px 0" }}>Tap an agent to see what it did — every action carries a trace you can open.</p>
                          </>
                        )}
                      </>
                    )}
                    {pulseView === "cost" && (live ? (live.credits ? (
                      <>
                        <div className="na-spend" data-testid="mobile-live-credit-summary">
                          {[
                            ["Available", `${live.credits.availableCredits.toFixed(1)} credits`, `$${live.credits.availableUsd.toFixed(2)}`],
                            ["Held now", `${live.credits.reservedCredits.toFixed(1)} credits`, `$${live.credits.reservedUsd.toFixed(2)}`],
                            ["Spent in this room", `${live.credits.lifetimeSpentCredits.toFixed(1)} credits`, "settled"],
                            ["Standard estimate", `$${live.credits.estimateUsdLow.toFixed(2)}-$${live.credits.estimateUsdHigh.toFixed(2)}`, "before run"],
                            ["Maximum standard hold", `${live.credits.requiredCredits.toFixed(1)} credits`, `$${live.credits.hardCapUsd.toFixed(2)} cap`],
                          ].map((r) => (
                            <div key={r[0]} className="na-spend-row">
                              <span className="rm"><strong>{r[0]}</strong><span>{r[1]}</span></span>
                              <span className="amt mono">{r[2]}</span>
                            </div>
                          ))}
                        </div>
                        <p className="na-ask-note" style={{ textAlign: "left", padding: "8px 2px 0" }} data-testid="mobile-live-credit-status">
                          {live.credits.paused
                            ? "Live work is paused for this room."
                            : !live.credits.enrolled
                              ? "This room is not enrolled for live work."
                              : live.credits.enforced
                                ? "The hold is reserved before provider egress. Unused credit is released after idempotent settlement."
                                : "This deployment reports credits but does not enforce them; it is not launch-ready."}
                        </p>
                      </>
                    ) : (
                      <p className="na-ask-note" style={{ textAlign: "left", padding: "10px 2px" }}>
                        This deployment is not returning a live wallet. Do not start paid work until credits and limits are available.
                      </p>
                    )) : (
                      <>
                        <div className="na-spend">
                          {[["Research runs", "2 runs", "$0.018"], ["Web searches", "3 searches", "$0.006"], ["Captures + enrich", "4 items", "$0.004"], ["Coach drills", "1 drill", "$0.002"]].map((r) => (
                            <div key={r[0]} className="na-spend-row">
                              <span className="rm"><strong>{r[0]}</strong><span>{r[1]}</span></span>
                              <span className="amt mono">{r[2]}</span>
                            </div>
                          ))}
                        </div>
                        <div className="na-spend-total"><span>Total today</span><span className="mono">{D.ROOM.costToday}</span></div>
                        <p className="na-ask-note" style={{ textAlign: "left", padding: "8px 2px 0" }}>Every agent action is metered. Approvals show an estimate before anything runs.</p>
                      </>
                    ))}
                  </div>
                </>
              );
            })()}
          </div>

          {/* ── leaf sheets ── */}
          <div className="na-sheet" data-open={sheet === "plan"}><div className="na-handle" />{sheet === "plan" && <PlanSheet ctx={ctx} />}</div>
          <div className="na-sheet" data-open={sheet === "evidence"} data-flash={flashSheet === "evidence"}><div className="na-handle" />{sheet === "evidence" && <EvidenceSheet ctx={ctx} />}</div>
          <div className="na-sheet" data-open={sheet === "coach"}><div className="na-handle" />{sheet === "coach" && <CoachSheet ctx={ctx} />}</div>
          <div className="na-sheet" data-open={sheet === "row"} data-flash={flashSheet === "row"}><div className="na-handle" />{sheet === "row" && <RowSheet ctx={ctx} />}</div>
          <div className="na-sheet" data-open={sheet === "jobs"}><div className="na-handle" />{sheet === "jobs" && <JobsSheet ctx={ctx} />}</div>
          <div className="na-sheet tall" data-open={sheet === "artifact"}><div className="na-handle" />{sheet === "artifact" && <ArtifactSheet ctx={ctx} />}</div>
          <div className="na-sheet tall" data-open={sheet === "sheetart"} data-flash={flashSheet === "sheetart"}><div className="na-handle" />{sheet === "sheetart" && <SheetArtifact ctx={ctx} />}</div>
          <div className="na-sheet" data-open={sheet === "settings"}><div className="na-handle" />{sheet === "settings" && <SettingsSheet ctx={ctx} />}</div>

          {/* ── gap pack sheets (design-reference/mobile-scale/gaps-app.jsx) ── */}
          <div className="na-sheet tall" data-open={sheet === "review"}><div className="na-handle" />{sheet === "review" && <ReviewSheet ctx={ctx} />}</div>
          <div className="na-sheet tall" data-open={sheet === "trace"}><div className="na-handle" />{sheet === "trace" && <TraceSheet ctx={ctx} />}</div>
          <div className="na-sheet tall" data-open={sheet === "share"}><div className="na-handle" />{sheet === "share" && <ShareSheet ctx={ctx} />}</div>
          <div className="na-sheet tall" data-open={sheet === "manage"}><div className="na-handle" />{sheet === "manage" && <ManageSheet ctx={ctx} />}</div>

          {/* ── stacking overlay (trace receipt / source reader) — above any sheet ── */}
          <div className="na-scrim na-scrim-top" data-open={!!overlay} onClick={closeOverlay} />
          <div className="na-sheet tall na-overlay-sheet" data-open={!!overlay}>
            <div className="na-handle" />
            {overlay && overlay.type === "trace" && <TraceOverlay id={overlay.id} ctx={ctx} />}
            {overlay && overlay.type === "source" && <SourceOverlay src={overlay.src} ctx={ctx} />}
          </div>

          {/* ── expanded Ask NodeAgent composer ── */}
          <div className="na-ask-wrap" data-open={askOpen} onClick={(e) => { if (e.target === e.currentTarget) closeAsk(); }}>
            <div className="na-ask">
              <button className="na-ask-grab" onClick={closeAsk} aria-label="Close">{Ico("chevD")}</button>
              <div className="na-ask-head">
                <span className="av">{Ico("sparkles")}</span>
                <strong>NodeAgent</strong>
                <button className="na-ask-scope" onClick={toggleScope} aria-label="Toggle visibility">
                  {Ico(scope === "Room" ? "users" : "lock")}
                  <span>{scope === "Room" ? "Everyone in this room" : "Private in NodeRoom"}</span>
                </button>
              </div>
              <div className="na-ask-card">
                {attachments.length > 0 && (
                  <div className="na-ask-chips">
                    {attachments.map((a) => (
                      <span key={a.label} className="na-attach-chip" data-kind={a.kind}>
                        {Ico(a.icon)}{a.label}
                        <button onClick={() => removeAttachment(a.label)} aria-label="Remove">{Ico("x")}</button>
                      </span>
                    ))}
                  </div>
                )}
                {listening ? (
                  <div className="na-listening" style={{ margin: "2px 0 4px" }}>
                    <span className="na-wave"><i /><i /><i /><i /><i /></span>Listening… tap mic to stop
                  </div>
                ) : (
                  <textarea
                    className="na-ask-field"
                    rows={2}
                    value={draft}
                    autoFocus
                    placeholder={askModeMeta[composerMode].ph}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAsk(); } }}
                  />
                )}
                <div className="na-ask-foot">
                  <div className="na-ask-pop">
                    <button className="na-ask-ic" data-on={attachMenu ? "true" : undefined} onClick={() => { setAttachMenu((v) => !v); setModelMenu(false); }} aria-label="Add">{Ico("plus")}</button>
                    {attachMenu && (
                      <div className="na-menu" role="menu">
                        {ATTACH.map((a) => (
                          <button key={a.id} className="na-menu-row" onClick={() => addAttachment(a)}>
                            <span className="mi">{Ico(a.icon)}</span>
                            <span className="mt"><strong>{a.label}</strong><span>{a.sub}</span></span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="na-ask-pop">
                    <button
                      className="na-model-chip"
                      data-on={modelMenu && modelRoutingAvailable ? "true" : undefined}
                      disabled={!modelRoutingAvailable}
                      onClick={() => { setModelMenu((v) => !v); setAttachMenu(false); }}
                      aria-label={modelRoutingAvailable ? "Model route" : "Model route unavailable"}
                      title={modelRoutingAvailable ? "Model route for room agent asks" : "Model routing applies to room-agent asks"}
                    >
                      {Ico(visibleModel.icon)}<span>{visibleModel.name}</span>{modelRoutingAvailable && Ico("chevD")}
                    </button>
                    {modelMenu && modelRoutingAvailable && (
                      <div className="na-menu" role="menu">
                        {MODELS.map((m) => (
                          <button key={m.id} className="na-menu-row" data-active={model === m.id} onClick={() => { setModel(m.id); setModelMenu(false); toast(m.name + " selected"); }}>
                            <span className="mi">{Ico(m.icon)}</span>
                            <span className="mt"><strong>{m.name}</strong><span>{m.desc}</span></span>
                            {model === m.id && <span className="mc">{Ico("check")}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="sp" />
                  <button className="na-ask-mic" onClick={listening ? stopVoice : startVoice} data-listening={listening ? "true" : undefined} aria-label={live ? "Voice input unavailable in live mobile" : "Dictate"} title={live ? "Voice input is unavailable until live mobile metering is certified" : "Dictate"}>{Ico("mic")}</button>
                  {draft.trim() ? (
                    <button
                      className="na-ask-send"
                      disabled={Boolean(live && ((composerMode === "agent" && agentCreditBlockReason) || composerMode === "note" || composerMode === "source"))}
                      onClick={sendAsk}
                      aria-label="Send"
                    >{Ico("arrowUp")}</button>
                  ) : (
                    <button className="na-ask-voice" disabled={!!live} onClick={() => { if (!live) { setAttachMenu(false); setModelMenu(false); setVoiceLive(true); } }} aria-label={live ? "Voice mode unavailable in live mobile" : "Voice mode"} title={live ? "Voice mode is unavailable until live mobile metering is certified" : "Voice mode"}>{Ico("voice")}</button>
                  )}
                </div>
              </div>
              <div className="na-ask-modes">
                {(["note", "room", "agent", "source"] as ComposerMode[]).map((id) => (
                  <button key={id} className="na-mode" data-mode={id} data-active={composerMode === id} onClick={() => setAskMode(id)}>
                    {Ico(({ note: "pen", room: "room", agent: "sparkles", source: "link" } as Record<ComposerMode, IconName>)[id])}
                    {id[0].toUpperCase() + id.slice(1)}
                  </button>
                ))}
              </div>
              {mentions.length ? (
                <div className="na-ask-mention">
                  <span className="mi">{Ico("at")}</span>
                  <span className="mt">
                    <strong>{mentions.join(", ")}</strong>
                    {" " + (mentions.length > 1 ? "are" : "is") + " notified — this message is shared with them in the room" + (scope === "Room" ? "." : ", even though the rest stays private to you.")}
                  </span>
                </div>
              ) : null}
              <p className="na-ask-note" data-testid={composerMode === "agent" && live ? "mobile-agent-cost-estimate" : undefined}>
                {composerMode === "agent" && live
                  ? agentCreditBlockReason ?? `Standard work estimates $${live.credits!.estimateUsdLow.toFixed(2)}-$${live.credits!.estimateUsdHigh.toFixed(2)}. Up to ${live.credits!.requiredCredits.toFixed(1)} credits ($${live.credits!.hardCapUsd.toFixed(2)}) may be held before provider egress; unused credit is released after settlement.`
                  : composerMode === "note" && live
                    ? "Live capture is unavailable on mobile. Nothing typed here will be saved or sent."
                    : composerMode === "source" && live
                      ? "Live source upload is unavailable on mobile. Nothing typed here will be uploaded."
                  : composerMode === "agent"
                    ? "NodeAgent proposes a work plan before it reads the web or writes anything."
                  : composerMode === "source"
                    ? "Captured for the Evidence Accountant — never auto-trusted."
                    : "Raw text stays " + scope.toLowerCase() + ". Only structured signals surface."}
              </p>
            </div>
          </div>

          {/* ── live voice mode ── */}
          <div className="na-voice" data-open={voiceLive}>
            {voiceLive && (
              <>
                <div className="na-voice-top">
                  <span className="na-voice-scope">{Ico(scope === "Room" ? "users" : "lock")}{scope === "Room" ? "Everyone in this room" : "Private in NodeRoom"}</span>
                  <span className="na-voice-model">{Ico(visibleModel.icon)}{visibleModel.name}</span>
                </div>
                <div className="na-voice-mid">
                  <div className="na-orb"><span /><span /><span /></div>
                  <div className="na-voice-status">Listening…</div>
                  <div className="na-voice-hint">Speak naturally. NodeAgent proposes a plan before it acts.</div>
                </div>
                <div className="na-voice-actions">
                  <button className="na-voice-mute" aria-label="Mute">{Ico("mic")}</button>
                  <button className="na-voice-end" onClick={() => setVoiceLive(false)}>{Ico("x")}End</button>
                  <button className="na-voice-kb" onClick={() => setVoiceLive(false)} aria-label="Keyboard">{Ico("pen")}</button>
                </div>
              </>
            )}
          </div>

          {/* toast */}
          <div className="na-toast" data-show={!!toastMsg} role="status" aria-live="polite">{toastMsg && Ico("checkCircle")}{toastMsg}</div>
        </div>
      </IOSDevice>
    </MobileStage>
  );
}
