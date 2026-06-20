/* ============================================================================
   NodeAgent Mobile (Terracotta) — app controller
   Collaboration command layer: Capture · Room · Agent · Inbox · Files, a
   universal mode-aware composer with voice-to-text, and the agent control
   tower. Deep artifact work stays on desktop.

   Ported from the design prototype (na-app.jsx). The prototype's live Tweaks
   panel + iOS-device bezel were design-iteration affordances; here the canonical
   terracotta defaults are baked in and the surface renders inside a lightweight
   phone frame (full-bleed on real mobile widths). Mounted at the `#mobile`
   route — see src/ui/App.tsx.
   ============================================================================ */
import * as React from "react";
import "./mobile.css";
import "./mobileFrame.css";
import { Ico } from "./MobileIcons";
import type { IconName } from "./MobileIcons";
import * as D from "./mobileData";
import type { TabId, SheetId, ComposerMode, AgentLane, RoomMsg, AgentMsg, QuickPrompt, InboxItem, Stat } from "./mobileData";
import type { MobileCtx, TweaksConfig, SaveState, RunState, CopyTone, CopyCtx } from "./mobileTypes";
import { Capture, Inbox } from "./MobileScreens";
import { RoomChat, AgentChat, Composer, JobsSheet } from "./MobileChat";
import { PlanSheet, EvidenceSheet, CoachSheet } from "./MobileSheets";
import { Files, RowSheet } from "./MobileFiles";
import { SettingsSheet } from "./MobileSettings";
import { loadTweaks, saveTweaks } from "./mobileTweaks";

// Canonical terracotta defaults now live in mobileTweaks.ts (DEFAULT_TWEAKS); the surface
// reads user-overridable settings from localStorage via loadTweaks() and edits them in the
// Settings sheet — the designed variant matrix, shipped to users.

const TABS: Record<TabId, { icon: IconName; label: string }> = {
  capture: { icon: "pen", label: "Capture" },
  room: { icon: "room", label: "Room" },
  agent: { icon: "sparkles", label: "Agent" },
  inbox: { icon: "inbox", label: "Inbox" },
  files: { icon: "file", label: "Files" },
};
const TAB_IDS: TabId[] = ["capture", "room", "agent", "inbox", "files"];

const SCREENS: Record<TabId, React.FC<{ ctx: MobileCtx }>> = {
  capture: Capture,
  room: RoomChat,
  agent: AgentChat,
  inbox: Inbox,
  files: Files,
};

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
};

// agent reply generator → returns [{ delay, msg }]
type AgentReplyPayload =
  | { variant: "status"; text: string }
  | { variant: "text"; text: string }
  | { variant: "summary"; title: string; sub: string; stats: Stat[] };

function agentReply(text: string): { delay: number; msg: AgentReplyPayload }[] {
  const s = text.toLowerCase();
  if (/research|funding|burn|enrich|cardionova/.test(s))
    return [
      { delay: 450, msg: { variant: "status", text: "Planning a read-only run inside approved scope…" } },
      { delay: 1300, msg: { variant: "summary", title: "CardioNova diligence plan", sub: "read-only · approval required", stats: [{ v: "4", l: "reads" }, { v: "0", l: "writes" }, { v: "$0.01", l: "est. cost", mono: true }] } },
    ];
  if (/follow.?up|draft|email|maya/.test(s))
    return [
      { delay: 450, msg: { variant: "status", text: "Drafting a follow-up…" } },
      { delay: 1200, msg: { variant: "text", text: "Draft: “Hi Maya — great meeting you. Two quick things to confirm for our notes: are the hospital pilots paid, and what’s the current monthly burn? Happy to share what we’re building in return.” Want me to log it as a task?" } },
    ];
  if (/summar|today|notes/.test(s))
    return [
      { delay: 450, msg: { variant: "status", text: "Reading today’s notes…" } },
      { delay: 1200, msg: { variant: "text", text: "Today: 1 new company (CardioNova), 1 contact (Maya Chen), 1 funding signal (Series B, unverified), and 1 open source gap (paid pilots). Nothing was written to shared artifacts yet." } },
    ];
  return [{ delay: 700, msg: { variant: "text", text: "Got it. I’ll keep this scoped to what you’ve approved and propose anything before it lands." } }];
}

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

export function MobileApp() {
  const [tweaks, setTweaks] = React.useState<TweaksConfig>(() => loadTweaks());
  const t = tweaks;
  const setTweak = <K extends keyof TweaksConfig>(key: K, value: TweaksConfig[K]): void => {
    setTweaks((prev) => {
      const next = { ...prev, [key]: value } as TweaksConfig;
      saveTweaks(next);
      return next;
    });
  };

  const [tab, setTab] = React.useState<TabId>(t.navModel);
  const [note, setNote] = React.useState<string>(D.SEED_NOTE);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [detected, setDetected] = React.useState(true);
  const [noticed, setNoticed] = React.useState(true);
  const [sheet, setSheet] = React.useState<SheetId | null>(null);
  const [runState, setRunState] = React.useState<RunState>("plan");
  const [resolved, setResolved] = React.useState<Record<string, boolean>>({});
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);

  // collaboration state
  const [composerMode, setComposerMode] = React.useState<ComposerMode>("note");
  const [draft, setDraft] = React.useState<string>("");
  const [listening, setListening] = React.useState(false);
  const [agentLane, setAgentLane] = React.useState<AgentLane>("private");
  const [roomMsgs, setRoomMsgs] = React.useState<RoomMsg[]>(() => D.ROOM_CHAT.slice());
  const [agentMsgs, setAgentMsgs] = React.useState<{ private: AgentMsg[]; room: AgentMsg[] }>(() => ({
    private: D.AGENT_CHAT.private.slice(),
    room: D.AGENT_CHAT.room.slice(),
  }));

  const firstRun = React.useRef(true);
  const timers = React.useRef<ReturnType<typeof setTimeout>[]>([]);
  const toastTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const voiceTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mid = React.useRef(100);
  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // composer mode follows the chat tab
  React.useEffect(() => {
    if (tab === "room") setComposerMode("room");
    else if (tab === "agent") setComposerMode("agent");
    else if (tab === "capture") setComposerMode("note");
  }, [tab]);

  // re-run detection after the note settles
  React.useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    clearTimers();
    setSaveState("saving");
    setDetected(false);
    setNoticed(false);
    timers.current.push(setTimeout(() => setSaveState("saved"), 850));
    if (t.passive !== "off") {
      timers.current.push(setTimeout(() => setDetected(true), 1250));
      timers.current.push(setTimeout(() => setNoticed(true), 1750));
    }
  }, [note, t.passive]);

  // Apply the chosen theme at the document level so the standalone mobile route picks up the
  // app's light/dark token sets; restore the previous theme on unmount.
  React.useEffect(() => {
    const html = document.documentElement;
    const prev = html.getAttribute("data-theme");
    html.setAttribute("data-theme", t.dark ? "dark" : "light");
    return () => {
      if (prev === null) html.removeAttribute("data-theme");
      else html.setAttribute("data-theme", prev);
    };
  }, [t.dark]);

  React.useEffect(
    () => () => {
      clearTimers();
      clearTimeout(toastTimer.current);
      clearTimeout(voiceTimer.current);
    },
    [],
  );

  const toast = React.useCallback((msg: string) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(null), 1900);
  }, []);

  const openSheet = (k: SheetId) => setSheet(k);
  const closeSheet = () => setSheet(null);

  const beginRun = () => {
    setRunState("running");
    timers.current.push(
      setTimeout(() => {
        setRunState("done");
        setResolved((r) => ({ ...r, i_plan: true }));
        toast("Research complete · evidence ready");
      }, 1300),
    );
  };

  const openInbox = (item: InboxItem) => {
    if (item.kind === "plan") openSheet("plan");
    else if (item.kind === "evidence") openSheet("evidence");
    else if (item.kind === "coach") openSheet("coach");
    else toast("Trace receipt · 4 reads · 0 writes");
  };

  // ── composer / chat ─────────────────────────────────────────────────────
  const pushAgent = (lane: AgentLane, msg: DistributiveOmit<AgentMsg, "id">) =>
    setAgentMsgs((prev) => {
      const next = { id: "a" + mid.current++, ...msg } as AgentMsg;
      return {
        private: lane === "private" ? [...prev.private, next] : prev.private,
        room: lane === "room" ? [...prev.room, next] : prev.room,
      };
    });
  const pushRoom = (msg: DistributiveOmit<RoomMsg, "id">) =>
    setRoomMsgs((prev) => [...prev, { id: "m" + mid.current++, ...msg } as RoomMsg]);

  const sendAgent = (text: string, lane?: AgentLane) => {
    const ln = lane || agentLane;
    pushAgent(ln, { role: "user", text });
    if (/runway|explain|prep|coach/i.test(text)) {
      timers.current.push(
        setTimeout(() => {
          pushAgent(ln, { role: "agent", variant: "status", text: "Setting up a coach drill…" });
          openSheet("coach");
        }, 500),
      );
      return;
    }
    agentReply(text).forEach(({ delay, msg }) => timers.current.push(setTimeout(() => pushAgent(ln, { role: "agent", ...msg }), delay)));
  };

  const sendComposer = () => {
    const text = draft.trim();
    if (!text) return;
    if (composerMode === "note") {
      setNote((n) => (n ? n + "\n" + text : text));
      setTab("capture");
      toast("Added to capture");
    } else if (composerMode === "room") {
      pushRoom({ who: "homen", kind: "msg", t: "now", text });
      if (/@agent|research|agent/i.test(text)) {
        timers.current.push(setTimeout(() => pushRoom({ who: "room_na", kind: "status", t: "now", text: "Picking that up — proposing a plan to the room." }), 700));
      }
      setTab("room");
    } else {
      sendAgent(text);
      setTab("agent");
    }
    setDraft("");
  };

  const startVoice = () => {
    setListening(true);
    clearTimeout(voiceTimer.current);
    voiceTimer.current = setTimeout(() => {
      setListening(false);
      setDraft((d) => (d ? d + " " : "") + VOICE[composerMode]);
    }, 1400);
  };
  const stopVoice = () => {
    clearTimeout(voiceTimer.current);
    setListening(false);
  };

  const runQuick = (q: QuickPrompt) => {
    setTab("agent");
    setComposerMode("agent");
    if (q.kind === "coach") {
      sendAgent("Prep me to explain runway");
      return;
    }
    sendAgent(q.text);
  };

  const openRow = () => openSheet("row");
  const askAboutRow = () => {
    setTab("agent");
    setComposerMode("agent");
    sendAgent("What’s missing on the CardioNova row?", "room");
    setAgentLane("room");
    closeSheet();
  };

  const openCount = D.INBOX.filter((i) => !resolved[i.id] && i.statusTone !== "ok").length;

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
    openSheet,
    closeSheet,
    openInbox,
    approveResearch: beginRun,
    runReadOnly: beginRun,
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
    roomMsgs,
    agentMsgs,
    runQuick,
    openRow,
    askAboutRow,
  };

  const Screen = SCREENS[tab];
  const showComposer = tab === "room" || tab === "agent";
  const order: TabId[] = TAB_IDS.includes(t.navModel) ? [t.navModel, ...TAB_IDS.filter((x) => x !== t.navModel)] : TAB_IDS;

  return React.createElement(
    "div",
    { className: "na-frame-root", "data-theme": t.dark ? "dark" : "light" },
    React.createElement(
      "div",
      { className: "na-frame" },
      React.createElement(
        "div",
        {
          className: "na-app",
          "data-theme": t.dark ? "dark" : "light",
          "data-density": t.density,
          "data-accent": t.accent,
          "data-motion": t.motion,
        },
        // top chrome
        React.createElement(
          "div",
          { className: "na-top" },
          React.createElement(
            "div",
            { className: "na-room" },
            React.createElement("div", { className: "na-mark" }, "N"),
            React.createElement(
              "div",
              { className: "na-room-copy" },
              React.createElement("strong", null, D.ROOM.name),
              React.createElement(
                "span",
                null,
                React.createElement("span", { className: "mono" }, D.ROOM.code),
                React.createElement("span", { className: "na-dot" }),
                React.createElement("span", { className: "na-live" }, D.ROOM.live + " live"),
                React.createElement("span", { className: "na-dot" }),
                TABS[tab].label.toLowerCase(),
              ),
            ),
            React.createElement(
              "button",
              {
                className: "na-icon-btn",
                "aria-label": "Agent jobs",
                onClick: () => (tab === "agent" || tab === "room" ? openSheet("jobs") : openCount ? setTab("inbox") : toast("All caught up")),
              },
              Ico(tab === "agent" || tab === "room" ? "history" : "bell"),
            ),
            React.createElement(
              "button",
              { className: "na-icon-btn", "aria-label": "Settings", onClick: () => openSheet("settings") },
              Ico("settings"),
            ),
          ),
        ),

        // active screen
        React.createElement("div", { className: "na-body", key: tab, "data-composer": showComposer }, React.createElement(Screen, { ctx })),

        // universal composer (room + agent)
        showComposer && React.createElement(Composer, { ctx }),

        // bottom nav (5 tabs)
        React.createElement(
          "div",
          {
            className: "na-nav",
            "data-style": t.navStyle === "dock" ? "dock" : "tabs",
            style: { gridTemplateColumns: t.navStyle === "dock" ? undefined : "repeat(5, 1fr)" },
          },
          order.map((id) =>
            React.createElement(
              "button",
              { key: id, className: "na-nav-item", "data-active": tab === id, onClick: () => setTab(id) },
              React.createElement("div", { style: { position: "relative" } }, Ico(TABS[id].icon), id === "inbox" && openCount > 0 && React.createElement("span", { className: "badge" }, openCount)),
              React.createElement("span", null, TABS[id].label),
            ),
          ),
        ),

        // scrim + sheets
        React.createElement("div", { className: "na-scrim", "data-open": !!sheet, onClick: closeSheet }),
        React.createElement("div", { className: "na-sheet", "data-open": sheet === "plan" }, sheet === "plan" && React.createElement(PlanSheet, { ctx })),
        React.createElement("div", { className: "na-sheet", "data-open": sheet === "evidence" }, sheet === "evidence" && React.createElement(EvidenceSheet, { ctx })),
        React.createElement("div", { className: "na-sheet", "data-open": sheet === "coach" }, sheet === "coach" && React.createElement(CoachSheet, { ctx })),
        React.createElement("div", { className: "na-sheet", "data-open": sheet === "row" }, sheet === "row" && React.createElement(RowSheet, { ctx })),
        React.createElement("div", { className: "na-sheet", "data-open": sheet === "jobs" }, sheet === "jobs" && React.createElement(JobsSheet, { ctx })),
        React.createElement("div", { className: "na-sheet", "data-open": sheet === "settings" }, sheet === "settings" && React.createElement(SettingsSheet, { ctx })),

        // toast
        React.createElement("div", { className: "na-toast", "data-show": !!toastMsg }, toastMsg && Ico("checkCircle"), toastMsg),
      ),
    ),
  );
}
