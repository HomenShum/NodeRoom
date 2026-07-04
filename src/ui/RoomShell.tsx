/**
 * RoomShell — top bar + June 2026 shell roles: Room Binder, Work Surface,
 * Copilot, Signal Tape, and Status Strip. Reads everything through `useStore()`,
 * so it renders identically whether the data is the in-memory engine or live
 * Convex.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PanelLeft, Table2, PanelRight, Moon, Sun, LogOut, Link2, ShieldCheck, X, HelpCircle, Copy, Check, MessageCircle, Sparkles, SlidersHorizontal, Palette, Gauge, Play, ChevronLeft, ChevronRight, Crosshair } from "lucide-react";
import { useStore, type ActorProof } from "../app/store";
import { Chat } from "./Chat";
import { Artifact } from "./panels/Artifact";
import { LeftRail } from "./LeftRail";
import { GuidedTour, type TourStep } from "./GuidedTour";
import { CommandPalette, type PaletteAction } from "./CommandPalette";
import { PeoplePanel } from "./PeoplePanel";
import { NotificationsInbox, requestWatchToggle } from "./NotificationsInbox";
import { selectPublicSignalTraces, statusText as publicStatusText } from "./signalStatus";
import { focusStage } from "./stageFocus";
import { BankerCoachPanel } from "./artifacts/BankerCoachPanel";
import { TraceLensProvider } from "./traceLens/useTraceLens";
import { TraceLensPanel } from "./traceLens/TraceLensPanel";
import { PassiveAgentChip } from "./insights/PassiveAgentChip";
import { OPT_ARTIFACT_PREFIX, optimisticArtifactIdentity, resolveRoomOpenTarget } from "./openRoomReference";
import { readFocusModeClientState, persistFocusModeClientState, textEntryIsActive, type FocusModeClientState } from "./focusMode";
import type { Actor, Channel } from "../engine/types";

const AUTO_ACCEPT_PREF_KEY = "noderoom:autoAcceptConsent:v1";
const TOUR_KEY = "noderoom:tour:v1";
const WALKDOCK_KEY = "noderoom:walkdock:v1";
const NOTE_PRIORITY = ["Capture Notebook", "Note", "Diligence memo", "Open questions / workplan", "Agent wiki"];
type AccentKey = "terra" | "indigo" | "green";
type ReplayPace = "brisk" | "standard" | "cinematic";
const ACCENTS: Record<AccentKey, { label: string; primary: string; hover: string; ink: string; tint: string; border: string }> = {
  terra: { label: "Accent", primary: "#D97757", hover: "#C76648", ink: "#E59579", tint: "rgba(217,119,87,.16)", border: "rgba(217,119,87,.28)" },
  indigo: { label: "Indigo", primary: "#6574D8", hover: "#5665C8", ink: "#A7B0FF", tint: "rgba(101,116,216,.16)", border: "rgba(101,116,216,.30)" },
  green: { label: "Green", primary: "#24945F", hover: "#1F8354", ink: "#6BD49D", tint: "rgba(36,148,95,.16)", border: "rgba(36,148,95,.30)" },
};

export function roomIntroSafetyCopy(mode: "memory" | "convex"): string {
  return mode === "memory"
    ? "This memory demo is safe: nothing is sent anywhere."
    : "This live room uses the production backend: room state, edits, traces, and approvals persist for collaborators.";
}

export function preferredRoomArtifact<T extends { id: string; kind?: string; title?: string; order?: string[]; meta?: { dataframe?: { rowCount?: number }; excelGrid?: { rows?: number } } }>(arts: T[]): T | undefined {
  const scaleResearch = arts.find((a) => a.kind === "sheet" && a.title === "Company research" && artifactRowCount(a) >= 1_000);
  if (scaleResearch) return scaleResearch;
  // Default to the wall (post-it / inventory surface) so files feel like a game-item inventory.
  const wall = arts.find((a) => a.kind === "wall");
  if (wall) return wall;
  for (const title of NOTE_PRIORITY) {
    const hit = arts.find((a) => a.kind === "note" && a.title === title);
    if (hit) return hit;
  }
  return arts.find((a) => a.kind === "note") ?? arts.find((a) => a.kind === "sheet") ?? arts[0];
}

function artifactRowCount(artifact: { order?: string[]; meta?: { dataframe?: { rowCount?: number }; excelGrid?: { rows?: number } } }): number {
  if (artifact.meta?.dataframe?.rowCount) return artifact.meta.dataframe.rowCount;
  if (artifact.meta?.excelGrid?.rows) return artifact.meta.excelGrid.rows;
  const rows = new Set<string>();
  for (const id of artifact.order ?? []) rows.add(id.split("__")[0]);
  return rows.size;
}

function initials(name: string): string {
  return name.replace(/[^A-Za-z· ]/g, "").split(/[ ·]/).filter(Boolean).map((s) => s[0]).slice(0, 2).join("").toUpperCase() || "?";
}

export function inviteHrefForRoom(code: string, href = typeof window !== "undefined" ? window.location.href : "http://localhost/"): string {
  const url = new URL(href);
  url.hash = "";
  url.search = "";
  url.searchParams.set("room", code.toUpperCase());
  return url.toString();
}

export function RoomShell({ roomId, me, onLeave, proof }: { roomId: string; me: Actor; onLeave: () => void; proof?: ActorProof }) {
  const store = useStore();
  const room = store.getRoom(roomId);
  // QA P0: below 981px the side panels render as fixed overlays over chat (styles.css), so they
  // start CLOSED — chat is the default single pane and the top-bar toggles are the panel switcher.
  const isCompact = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(max-width: 980px)").matches;
  // 981-1199px is the June-target "Room button" band: the binder is summoned over the stage (overlay,
  // see styles.css) so the center Work Surface + Copilot keep full width. It starts closed; the
  // top-bar binder toggle is the Room button that opens it.
  const isMid = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(min-width: 981px) and (max-width: 1199px)").matches;
  const scaleDemo = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("demo") === "scale";
  // Panels are a VIEWPORT decision, not a role/mode decision. The old `live && !isCompact` init read
  // `live` at mount — still false on a RELOAD while Convex queries load —
  // so every returning visitor (tour already seen, nothing to force panels open) landed in a chat-only
  // layout. Caught by the walkthrough capturer's reload path; see FRICTION_LOG 2026-06-09.
  const [show, setShow] = useState({ left: scaleDemo && !isCompact, stage: true, copilot: !isCompact });
  const [codeCopied, setCodeCopied] = useState(false);
  // Default the side panels lean (binder + Copilot) so the work surface gets the width budget --
  // the contract makes it the focus, and an idle Copilot does not need 380px. Both stay inside the
  // resize clamps (left 176-380, right 280-560), so the user can widen either by dragging.
  const [layout, setLayout] = useState({ left: 232, stage: 1, right: 340 });
  const [copilotTab, setCopilotTab] = useState<"public" | "private">("public");
  const arts = store.listArtifacts(roomId);
  // Notebook-first: every room lands on the note surface — bankers start by jotting.
  // Falls back to sheet if no note exists (e.g. older rooms seeded before this change),
  // then arts[0], then "" for async-load ticks where arts is still empty.
  const [artId, setArtId] = useState(() => preferredRoomArtifact(arts)?.id ?? "");
  const [sideArtId, setSideArtId] = useState<string | null>(null);
  const [autoAcceptModal, setAutoAcceptModal] = useState(false);
  const [rememberAutoAccept, setRememberAutoAccept] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [dockStep, setDockStep] = useState(0);
  const [walkdockDismissed, setWalkdockDismissed] = useState(() => {
    if (scaleDemo) return true;
    try { return localStorage.getItem(WALKDOCK_KEY) === "dismissed"; } catch { return false; }
  });
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [accent, setAccent] = useState<AccentKey>("terra");
  const [backgroundGlow, setBackgroundGlow] = useState(true);
  const [replayPace, setReplayPace] = useState<ReplayPace>("standard");
  const [focusMode, setFocusMode] = useState<FocusModeClientState>(() => readFocusModeClientState());
  // Room-level rung of the presence ladder: facepile/live chip → PeoplePanel (role groups,
  // live location, Follow). Declared before the !room early return (stable hook count).
  const [peopleOpen, setPeopleOpen] = useState(false);
  const tourAutoStarted = useRef(false);
  const accentTheme = ACCENTS[accent];
  const shellStyle = {
    "--accent-primary": accentTheme.primary,
    "--accent-hover": accentTheme.hover,
    "--accent-ink": accentTheme.ink,
    "--accent-tint": accentTheme.tint,
    "--accent-border": accentTheme.border,
  } as CSSProperties;
  // First-run: auto-start the walkthrough once per browser. The header "?" button replays it.
  useEffect(() => {
    if (tourAutoStarted.current) return;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === "done"; } catch { /* ignore */ }
    tourAutoStarted.current = true;
    // On compact screens panels are stacked fixed overlays — opening all three would bury the chat
    // the tour is pointing at, so the tour starts from the chat-only default there.
    if (!seen && !scaleDemo) { if (!isCompact) setShow({ left: true, stage: true, copilot: true }); setTourOpen(true); }
  }, [isCompact, scaleDemo]);
  // Drop a stale split-view pin if its artifact vanished. MUST run before the `!room` early return:
  // a LIVE room mounts with room=undefined and resolves a tick later, so a hook placed AFTER the
  // return changes the hook count between those two renders ("rendered more hooks than previous").
  useEffect(() => {
    if (sideArtId && !arts.some((a) => a.id === sideArtId)) setSideArtId(null);
  }, [sideArtId, arts]);
  useEffect(() => {
    const optimistic = optimisticArtifactIdentity(artId);
    if (!optimistic) return;
    const real = arts.find((a) => !a.id.startsWith(OPT_ARTIFACT_PREFIX) && a.kind === optimistic.kind && a.title === optimistic.title);
    if (real) setArtId(real.id);
  }, [artId, arts]);
  // Slow-load affordance — only after a grace period so a normal fast load never sees it. Declared
  // here (before the early return) so hook order stays stable across the undefined→room tick.
  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (room) { setSlowLoad(false); return; }
    const t = setTimeout(() => setSlowLoad(true), 8000);
    return () => clearTimeout(t);
  }, [room]);
  const openSidebarChat = () => {
    setCopilotTab("public");
    setShow((s) => {
      if (isCompact) return { left: false, stage: false, copilot: true };
      return { ...s, stage: true, copilot: true };
    });
  };
  // Keyboard layer: "/" (and the ⌘K palette's "Jump to chat composer") summons the
  // public Copilot lane, then DOM-focuses the composer once it has rendered —
  // the double-rAF quick-command pattern from RoomHome. Chat.tsx stays untouched;
  // its `data-testid="chat-composer"` textarea is the stable contract.
  const focusChatComposer = () => {
    openSidebarChat();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.querySelector<HTMLTextAreaElement>('textarea[data-testid="chat-composer"]')?.focus();
    }));
  };
  const focusChatComposerRef = useRef(focusChatComposer);
  focusChatComposerRef.current = focusChatComposer;
  // "/" jumps to chat from anywhere. Ignored mid-typing (a "/" in a sentence or a
  // cell must stay a "/"), and never with modifiers (browser shortcuts stay intact).
  // Declared before the !room early return so the hook count stays stable.
  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (textEntryIsActive()) return;
      e.preventDefault();
      focusChatComposerRef.current();
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);
  if (!room) {
    // Honest status: a resolved-null meta means the room is gone, not "still loading".
    const notFound = store.roomState() === "notFound";
    if (notFound) {
      return (
        <div className="r-app"><div className="r-screen">
          <div style={{ margin: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", maxWidth: 320 }} className="muted">
            <div>This room isn’t available — it may have been closed, or your access was revoked.</div>
            <button className="r-iconbtn" title="Leave room" aria-label="Leave room" onClick={onLeave}><LogOut size={16} /> Leave</button>
          </div>
        </div></div>
      );
    }
    // Loading → a room-shaped skeleton (rail + work surface + chat), not a spinner on a blank screen.
    return (
      <div className="r-app"><div className="r-screen r-skel-shell" aria-busy="true" aria-label="Loading room">
        <div className="r-skel-rail">
          <span className="r-skeleton" style={{ height: 26, width: "72%" }} />
          {Array.from({ length: 6 }).map((_, i) => <span key={i} className="r-skeleton" style={{ height: 14, width: `${88 - (i % 3) * 16}%` }} />)}
        </div>
        <div className="r-skel-surface">
          <span className="r-skeleton" style={{ height: 30, width: "42%" }} />
          {Array.from({ length: 9 }).map((_, i) => <span key={i} className="r-skeleton" style={{ height: 18 }} />)}
        </div>
        <div className="r-skel-chat">
          {Array.from({ length: 5 }).map((_, i) => <span key={i} className="r-skeleton" style={{ height: i % 2 ? 42 : 24, width: i % 2 ? "86%" : "62%" }} />)}
        </div>
        {slowLoad && (
          <div className="r-skel-slow">
            <button className="r-iconbtn" onClick={() => window.location.reload()}>Reload</button>
            <button className="r-iconbtn" title="Leave room" aria-label="Leave room" onClick={onLeave}><LogOut size={16} /> Leave</button>
          </div>
        )}
      </div></div>
    );
  }

  const members = store.listMembers(roomId);
  const inviteHref = inviteHrefForRoom(room.code);
  // Shared by the top-bar invite chip and the ⌘K palette ("Copy invite code").
  // Robust copy feedback: confirm regardless of whether the async clipboard write
  // resolves (it is unavailable in some contexts) so the user always sees acknowledgement.
  const copyInvite = () => {
    try { void navigator.clipboard?.writeText(inviteHref); } catch { /* clipboard unavailable */ }
    setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1200);
  };
  const isHost = members.some((m) => m.id === me.id && m.role === "host");
  const privChannel: Channel = { private: me.id };
  const curArt = arts.find((a) => a.id === artId) ?? preferredRoomArtifact(arts);
  const openArtifact = (id: string, opts?: { split?: boolean; elementId?: string }): boolean => {
    const artifactsNow = store.listArtifacts(roomId);
    const proposalsNow = store.listProposals(roomId);
    const target = resolveRoomOpenTarget({
      id,
      artifacts: artifactsNow,
      proposals: proposalsNow,
    });
    const isPendingDirectArtifact = id.startsWith(OPT_ARTIFACT_PREFIX) || /^[a-z0-9]{20,}$/i.test(id);
    if (!target && !isPendingDirectArtifact) return false;
    const targetArtifactId = target?.artifactId ?? id;
    const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
    const compactNow = hasMatchMedia && window.matchMedia("(max-width: 980px)").matches;
    setShow((s) => compactNow ? { ...s, left: false, stage: true, copilot: false } : { ...s, stage: true });
    const canSplitNow = hasMatchMedia && window.matchMedia("(min-width: 1200px)").matches;
    if (opts?.split && canSplitNow && targetArtifactId !== artId) {
      setSideArtId(targetArtifactId);
    } else {
      setArtId(targetArtifactId);
    }
    const elementId = opts?.elementId ?? target?.elementId;
    if (elementId) requestAnimationFrame(() => focusStage({ artifactId: targetArtifactId, elementId }));
    return true;
  };

  const varianceArt = arts.find((a) => a.title === "Q3 variance") ?? arts.find((a) => a.kind === "sheet");
  // Open the tour from a clean, known layout: all panels shown + the financial grid selected, ONCE.
  // Steps then anchor only to always-visible elements, so there are no per-step side-effects to thrash.
  const startTour = () => {
    setWalkdockDismissed(false);
    try { localStorage.removeItem(WALKDOCK_KEY); } catch { /* ignore */ }
    if (varianceArt) openArtifact(varianceArt.id);
    setShow({ left: true, stage: true, copilot: true });
    setCopilotTab("public");
    setDockStep(0);
    setTourOpen(true);
  };
  const introSafetyCopy = roomIntroSafetyCopy(store.mode);
  const tourSteps: TourStep[] = [
    {
      title: "Welcome to NodeRoom",
      body: `A live diligence room where bankers, guests, and NodeAgents gather company facts, enrich shared grids, and prepare runway, milestone, and handoff artifacts without clobbering each other. ${introSafetyCopy}`,
      placement: "center",
    },
    {
      selector: '[data-testid="left-rail"]',
      title: "Room Binder",
      body: "The Binder holds company research, runway work, memos, open questions, source uploads, live people, agents, and the review queue. Open artifacts here or drag them into chat as references.",
      placement: "right",
    },
    {
      selector: '[data-testid="copilot-panel"]',
      title: "Ask Copilot",
      body: "Use public chat for room-visible work and the private lane for your own banker coach. Chat can attach artifacts, drop files, stream agent operations, and open referenced work beside the stage.",
      placement: "top",
    },
    {
      selector: '[data-testid="room-trace"]',
      title: "Everything is auditable",
      body: "Every hand edit, agent write, proposal, lock, receipt, and trace event remains inspectable, so a banker can explain how a number or claim entered the room.",
      placement: "left",
    },
    {
      selector: '[data-testid="artifact-tabs"]',
      title: "Diligence artifacts",
      body: "Switch between the financial grid, company research, diligence memo, open questions, and risk wall. Each surface is live, source-aware, and conflict-safe.",
      placement: "bottom",
    },
    {
      selector: '[data-testid="copilot-panel"]',
      title: "Public and private lanes",
      body: "Switch Copilot between the public room lane and your private NodeAgent. Private findings stay yours until you promote them into the shared review flow.",
      placement: "left",
    },
    {
      title: "Now you try",
      body: "Type @nodeagent in the chat to ask the room agent to work on any artifact — it locks cells, drafts around human edits, and merges through compare-and-swap.",
      placement: "center",
    },
  ];
  const selectDockStep = (index: number) => {
    const next = clamp(index, 0, tourSteps.length - 1);
    const selector = tourSteps[next]?.selector ?? "";
    setDockStep(next);
    if (selector.includes("left-rail")) setShow({ left: true, stage: true, copilot: !isCompact });
    else if (selector.includes("copilot-panel")) setShow({ left: !isCompact, stage: true, copilot: true });
    else if (selector.includes("artifact-tabs") || selector.includes("room-trace")) setShow((s) => ({ ...s, stage: true }));
  };

  const toggleAutoAccept = () => {
    if (!isHost) return;
    if (room.autoAllow) {
      store.toggleAutoAllow(roomId, me);
      return;
    }
    if (localStorage.getItem(AUTO_ACCEPT_PREF_KEY) === "host-consented") {
      store.toggleAutoAllow(roomId, me);
      return;
    }
    setRememberAutoAccept(false);
    setAutoAcceptModal(true);
  };
  const confirmAutoAccept = () => {
    if (rememberAutoAccept) localStorage.setItem(AUTO_ACCEPT_PREF_KEY, "host-consented");
    setAutoAcceptModal(false);
    store.toggleAutoAllow(roomId, me);
  };
  const toggleFocusMode = () => {
    setFocusMode((current) => {
      const next = { ...current, enabled: !current.enabled, paused: false };
      persistFocusModeClientState(next);
      return next;
    });
  };
  const toggleBinder = () => {
    setShow((s) => {
      // Mobile: the binder replaces the chat pane. Desktop + Room-button band (981-1199): just toggle
      // the binder — at 981-1199 it floats as an overlay (styles.css), so Copilot is never displaced.
      if (isCompact) {
        const nextLeft = !s.left;
        return { left: nextLeft, stage: !nextLeft, copilot: false };
      }
      return { ...s, left: !s.left, stage: true };
    });
  };
  const showWorkSurface = () => {
    setShow((s) => {
      if (!isCompact) return { ...s, stage: true };
      return { left: false, stage: true, copilot: false };
    });
  };
  const toggleCopilot = () => {
    setShow((s) => {
      if (!isCompact) return { ...s, stage: true, copilot: !s.copilot };
      const nextCopilot = !s.copilot;
      return { left: false, stage: !nextCopilot, copilot: nextCopilot };
    });
  };
  // Trace and Graph are pinned work-surface tabs owned by panels/Artifact.tsx
  // (their open state lives there). The palette reaches them through their stable
  // testids — the same DOM-level contract the e2e suite drives — after making
  // sure the stage is on screen, instead of duplicating that state up here.
  const openWorkSurfaceTab = (testid: "trace-tab" | "graph-tab") => {
    showWorkSurface();
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)?.click());
  };
  const paletteActions: PaletteAction[] = [
    { id: "toggle-focus-mode", label: "Toggle focus mode", hint: focusMode.enabled ? "on" : "off", run: toggleFocusMode },
    // Auto-allow is host-gated (the switch is disabled for guests); the palette
    // simply doesn't list it for non-hosts instead of offering a dead command.
    ...(isHost ? [{ id: "toggle-auto-allow", label: "Toggle auto-allow", hint: room.autoAllow ? "auto-allow" : "review", run: toggleAutoAccept } satisfies PaletteAction] : []),
    { id: "copy-invite", label: "Copy invite code", hint: room.code, run: copyInvite },
    { id: "open-trace", label: "Open Trace", hint: "tab", run: () => openWorkSurfaceTab("trace-tab") },
    { id: "open-graph", label: "Open Graph", hint: "tab", run: () => openWorkSurfaceTab("graph-tab") },
    { id: "jump-chat", label: "Jump to chat composer", hint: "/", run: focusChatComposer },
    // Watches live on the Convex notification log only — memory mode doesn't list
    // a dead command (same honest-absence rule as the host-gated auto-allow entry).
    ...(store.mode === "convex" && proof
      ? [{ id: "toggle-watch-row", label: "Toggle watch on focused row", hint: "W", run: requestWatchToggle } satisfies PaletteAction]
      : []),
  ];
  const startResize = (target: "left" | "right", startX: number) => {
    const start = layout;
    // Stage floor: cap panel drag so the center Work Surface can't be squeezed below ~760px on desktop.
    // When the floor is unachievable at the current width (narrow desktops), fall back to the normal
    // max instead of forcing horizontal overflow. The binder counts as 0 when it floats (<=1199px).
    const STAGE_FLOOR = 760, EDGES = 30;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      setLayout((cur) => {
        const vw = typeof window !== "undefined" ? window.innerWidth : 1440;
        if (target === "left") {
          const floorCap = vw - cur.right - STAGE_FLOOR - EDGES;
          const cap = floorCap >= 176 ? Math.min(380, floorCap) : 380;
          return { ...cur, left: clamp(start.left + dx, 176, cap) };
        }
        const leftInFlow = isCompact || isMid ? 0 : cur.left;
        const floorCap = vw - leftInFlow - STAGE_FLOOR - EDGES;
        const cap = floorCap >= 280 ? Math.min(560, floorCap) : 560;
        return { ...cur, right: clamp(start.right - dx, 280, cap) };
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("r-resizing");
    };
    document.body.classList.add("r-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <TraceLensProvider>
    <div className="r-app" data-bg-glow={String(backgroundGlow)} style={shellStyle}>
      <div className="r-top" data-noderoom-surface="shell.topbar">
        <div className="r-mark">N</div>
        <div className="r-brand">NodeRoom <span>· {room.title}</span></div>
        {/* The code chip LOOKS like a button, so it must be one — sharing the code is the core
            multiplayer flow (Meet/Figma mental model: click the code -> copy invite). */}
        <button className="r-roomcode" type="button" title="Copy invite link" aria-label={codeCopied ? "Invite link copied" : `Copy invite link for room ${room.code}`} aria-live="polite"
          onClick={copyInvite}>
          <Link2 size={12} /> invite <b>{room.code}</b> {codeCopied ? <Check size={11} /> : <Copy size={11} />}
        </button>
        {store.mode === "convex" && <span className="r-tag" style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}>● live convex</span>}
        <span className="r-spacer" />
        <div className="r-toggle-group">
          <button className="r-iconbtn" data-mobile-label="Room" data-on={String(show.left)} title="Room Binder" aria-label="Toggle Room Binder panel" aria-pressed={show.left} onClick={toggleBinder}><PanelLeft size={16} /></button>
          <button className="r-iconbtn" data-mobile-label="Work" data-on={String(!isCompact || show.stage)} title="Work Surface" aria-label={isCompact ? "Show Work Surface panel" : "Focus Work Surface"} aria-pressed={!isCompact || show.stage} onClick={showWorkSurface}><Table2 size={16} /></button>
          <button className="r-iconbtn" data-mobile-label="Chat" data-on={String(show.copilot)} title="Copilot" aria-label="Toggle Copilot panel" aria-pressed={show.copilot} onClick={toggleCopilot}><PanelRight size={16} /></button>
        </div>
        <div className="r-pill-auto" data-testid="agent-commit-policy">
          <span className="r-pill-auto-label">Agent commits:</span>
          <b>{room.autoAllow ? "auto-allow" : "review"}</b>
          {/* The highest-blast-radius control (gates whether agent edits apply without review):
              a real ARIA switch, not a bare button, so assistive tech reads its on/off state. */}
          <button className="r-switch" role="switch" aria-checked={room.autoAllow} aria-label="Auto-allow agent edits without host review" data-testid="auto-allow-switch" data-on={String(room.autoAllow)} disabled={!isHost} title={isHost ? "Auto-approve agent edits" : "Only the host can change auto-allow"} onClick={toggleAutoAccept} />
        </div>
        <div className="r-pill-auto r-focus-mode-control" data-testid="focus-mode-control" data-on={String(focusMode.enabled)}>
          <Crosshair size={12} />
          Focus
          <button className="r-switch" role="switch" aria-checked={focusMode.enabled} aria-label="Focus Mode follows the selected agent job" data-testid="focus-mode-switch" data-on={String(focusMode.enabled)} title="Follow the current agent job on the work surface" onClick={toggleFocusMode} />
        </div>
        {/* Facepile + live chip are ONE trigger: the room-level presence ladder opens the
            people panel (role groups · live location · Follow). Overflow avatar (+N) is the
            specimen's "facepile + overflow" state. */}
        <button
          type="button"
          className="r-people-trigger"
          data-testid="people-trigger"
          aria-haspopup="dialog"
          aria-expanded={peopleOpen}
          title={`${members.length} live room member${members.length === 1 ? "" : "s"} — open people panel`}
          aria-label={`Open people panel — ${members.length} live`}
          onClick={() => setPeopleOpen((v) => !v)}
        >
          <span className="r-avatars">
            {members.slice(0, 4).map((m) => (<span key={m.id} className="r-av" style={{ background: m.color }}>{initials(m.name)}<span className="pulse" /></span>))}
            {members.length > 4 && <span className="r-av r-people-more-av">+{members.length - 4}</span>}
            <span className="r-av agent" style={{ background: "#8F3F27" }}>◆</span>
          </span>
          <span className="r-live-count">{members.length} live</span>
        </button>
        {/* Notifications bell — live (Convex) rooms only: the in-memory engine keeps no
            notification log, so memory mode renders NOTHING here (honest absence, the
            cell-history rule). Owns the W-key watch layer + the palette toggle event. */}
        {store.mode === "convex" && proof && <NotificationsInbox roomId={roomId} requester={proof} />}
        <button className="r-iconbtn" title="Tweaks" aria-label="Open room tweaks" data-on={String(tweaksOpen)} onClick={() => setTweaksOpen((v) => !v)}><SlidersHorizontal size={16} /></button>
        <button className="r-iconbtn" title="Take the guided tour" aria-label="Take the guided tour" data-testid="tour-button" onClick={startTour}><HelpCircle size={16} /></button>
        <ThemeToggle />
        <button className="r-iconbtn" title="Leave room" aria-label="Leave room" onClick={onLeave}><LogOut size={16} /></button>
      </div>

      <div className="r-workspace" data-shell="june-2026">
        {show.left && <LeftRail roomId={roomId} me={me} artId={curArt?.id ?? artId} style={{ width: layout.left }} onPick={openArtifact} onOpenChat={openSidebarChat} />}
        {show.left && <ResizeHandle label="Resize files panel" onPointerDown={(x) => startResize("left", x)} />}
        {(!isCompact || show.stage) && <Artifact roomId={roomId} me={me} proof={proof} artId={curArt?.id ?? artId} onArt={setArtId} sideArtId={sideArtId} onSideArtChange={setSideArtId} onOpenChat={openSidebarChat} style={{ flex: layout.stage }} />}
        {show.copilot && <ResizeHandle label="Resize Copilot panel" onPointerDown={(x) => startResize("right", x)} />}
        {show.copilot && (
          <CopilotPanel
            roomId={roomId}
            me={me}
            privChannel={privChannel}
            active={copilotTab}
            onActive={setCopilotTab}
            activeArtifactId={curArt?.id ?? artId}
            onOpenArtifact={openArtifact}
            style={{ width: layout.right }}
          />
        )}
      </div>
      {!walkdockDismissed && (
        <RoomWalkthroughDock
          steps={tourSteps}
          step={dockStep}
          pace={replayPace}
          onStep={selectDockStep}
          onReplay={startTour}
          onDismiss={() => {
            setWalkdockDismissed(true);
            try { localStorage.setItem(WALKDOCK_KEY, "dismissed"); } catch { /* ignore */ }
          }}
        />
      )}
      <SignalStatusStrip roomId={roomId} me={me} focusModeEnabled={focusMode.enabled} onOpenArtifact={openArtifact} />
      <RoomTweaksPanel
        open={tweaksOpen}
        accent={accent}
        backgroundGlow={backgroundGlow}
        replayPace={replayPace}
        onAccent={setAccent}
        onBackgroundGlow={setBackgroundGlow}
        onReplayPace={setReplayPace}
        onClose={() => setTweaksOpen(false)}
      />
      {autoAcceptModal && (
        <div className="r-modal-backdrop" role="presentation">
          <div className="r-modal" role="dialog" aria-modal="true" aria-labelledby="auto-accept-title">
            <button className="r-iconbtn r-modal-x" aria-label="Close" onClick={() => setAutoAcceptModal(false)}><X size={15} /></button>
            <div className="r-modal-icon"><ShieldCheck size={20} /></div>
            <h2 id="auto-accept-title">Turn on auto-accept?</h2>
            <p>Agent edits will apply directly after the tool layer validates locks, versions, permissions, and schema. You can turn this off any time to route agent edits into host-reviewed proposals.</p>
            <label className="r-checkline">
              <input type="checkbox" checked={rememberAutoAccept} onChange={(e) => setRememberAutoAccept(e.currentTarget.checked)} />
              Remember my preference on this device
            </label>
            <div className="r-modal-actions">
              <button className="r-btn ghost" onClick={() => setAutoAcceptModal(false)}>Keep review on</button>
              <button className="r-btn primary" onClick={confirmAutoAccept}><ShieldCheck size={14} /> Turn on auto-accept</button>
            </div>
          </div>
        </div>
      )}
      <GuidedTour steps={tourSteps} open={tourOpen} onClose={() => setTourOpen(false)} storageKey={TOUR_KEY} />
      <CommandPalette roomId={roomId} actions={paletteActions} onOpenArtifact={(id) => void openArtifact(id)} />
      {/* Always mounted (open only gates the panel chrome) so an active Follow — its pill and
          single poll interval — survives dismissing the panel. */}
      <PeoplePanel roomId={roomId} me={me} open={peopleOpen} onClose={() => setPeopleOpen(false)} onOpenArtifact={openArtifact} />
      <TraceLensPanel roomId={roomId} onOpenArtifact={openArtifact} />
    </div>
    </TraceLensProvider>
  );
}

function CopilotPanel({
  roomId,
  me,
  privChannel,
  active,
  onActive,
  activeArtifactId,
  onOpenArtifact,
  style,
}: {
  roomId: string;
  me: Actor;
  privChannel: Channel;
  active: "public" | "private";
  onActive: (tab: "public" | "private") => void;
  activeArtifactId?: string;
  onOpenArtifact: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
  style?: CSSProperties;
}) {
  // The chat lanes are peer tabs (Room/Private). The Banker Coach is a MODE inside Private (Chat|Coach),
  // not a third top-level tab — so a chat lane stays pure chat and the coach never crowds the rail.
  const [privateMode, setPrivateMode] = useState<"chat" | "coach">("chat");
  return (
    <div className="r-panel right r-copilot" style={style} data-testid="copilot-panel">
      <div className="r-panel-head r-copilot-head">
        <PanelRight size={14} />
        <span className="grow" />
        <div className="r-copilot-tabs" role="tablist" aria-label="Copilot tabs">
          <button type="button" role="tab" aria-selected={active === "public"} data-on={String(active === "public")} data-testid="copilot-tab-public" onClick={() => onActive("public")}>
            <MessageCircle size={12} /> Room
          </button>
          <button type="button" role="tab" aria-selected={active === "private"} data-on={String(active === "private")} data-testid="copilot-tab-private" onClick={() => onActive("private")}>
            <ShieldCheck size={12} /> Private
          </button>
        </div>
      </div>
      <div className="r-copilot-body">
        {active === "public" ? (
          <div className="r-copilot-chatframe">
            <Chat roomId={roomId} me={me} channel="public" variant="public" agentName="Room NodeAgent" activeArtifactId={activeArtifactId} embedded testId="public-chat-panel" onOpenArtifact={onOpenArtifact} />
          </div>
        ) : (
          <>
            {/* Coach is a MODE inside Private (Cluely-style, non-stealthy), not a top-level tab. */}
            <div className="r-private-modes" role="tablist" aria-label="Private modes">
              <button type="button" role="tab" aria-selected={privateMode === "chat"} data-on={String(privateMode === "chat")} data-testid="private-mode-chat" onClick={() => setPrivateMode("chat")}>
                <MessageCircle size={11} /> Chat
              </button>
              <button type="button" role="tab" aria-selected={privateMode === "coach"} data-on={String(privateMode === "coach")} data-testid="private-mode-coach" onClick={() => setPrivateMode("coach")}>
                <Sparkles size={11} /> Coach
              </button>
            </div>
            {privateMode === "coach" ? (
              <BankerCoachPanel roomId={roomId} onOpenArtifact={onOpenArtifact} />
            ) : (
              <div className="r-copilot-chatframe">
                <Chat roomId={roomId} me={me} channel={privChannel} variant="private" agentName="Your NodeAgent" embedded testId="private-chat-panel" onOpenArtifact={onOpenArtifact} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RoomWalkthroughDock({
  steps,
  step,
  pace,
  onStep,
  onReplay,
  onDismiss,
}: {
  steps: TourStep[];
  step: number;
  pace: ReplayPace;
  onStep: (step: number) => void;
  onReplay: () => void;
  onDismiss: () => void;
}) {
  const current = steps[step] ?? steps[0];
  if (!current) return null;
  return (
    <div className="r-walkdock" data-testid="walkthrough-dock">
      <div className="r-walkdock-dots" aria-label="Walkthrough steps">
        {steps.map((s, i) => (
          <button key={`${s.title}-${i}`} type="button" className="r-walkdock-dot" data-on={String(i === step)} aria-label={`Show step ${i + 1}`} onClick={() => onStep(i)} />
        ))}
      </div>
      <button className="r-iconbtn r-iconbtn-sm" type="button" aria-label="Previous walkthrough step" disabled={step === 0} onClick={() => onStep(step - 1)}>
        <ChevronLeft size={14} />
      </button>
      <div className="r-walkdock-main">
        <span>{String(step + 1).padStart(2, "0")} - {current.title}</span>
        <strong>{current.body}</strong>
      </div>
      <span className="r-walkdock-pace"><Gauge size={11} /> {pace}</span>
      <button className="r-iconbtn r-iconbtn-sm" type="button" aria-label="Next walkthrough step" disabled={step === steps.length - 1} onClick={() => onStep(step + 1)}>
        <ChevronRight size={14} />
      </button>
      <button className="r-btn ghost r-walkdock-replay" type="button" onClick={onReplay}>
        <Play size={13} /> Replay
      </button>
      <button className="r-iconbtn r-iconbtn-sm r-walkdock-close" type="button" aria-label="Dismiss walkthrough dock" data-testid="walkthrough-dock-dismiss" onClick={onDismiss}>
        <X size={13} />
      </button>
    </div>
  );
}

function RoomTweaksPanel({
  open,
  accent,
  backgroundGlow,
  replayPace,
  onAccent,
  onBackgroundGlow,
  onReplayPace,
  onClose,
}: {
  open: boolean;
  accent: AccentKey;
  backgroundGlow: boolean;
  replayPace: ReplayPace;
  onAccent: (accent: AccentKey) => void;
  onBackgroundGlow: (on: boolean) => void;
  onReplayPace: (pace: ReplayPace) => void;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="r-tweaks" data-testid="room-tweaks">
      <div className="r-tweaks-head">
        <span>Tweaks</span>
        <button className="r-iconbtn r-iconbtn-sm" type="button" aria-label="Close tweaks" onClick={onClose}><X size={13} /></button>
      </div>
      <div className="r-tweaks-section">
        <span className="r-tweaks-label"><Palette size={12} /> Theme</span>
        <div className="r-tweak-swatches" role="radiogroup" aria-label="Accent theme">
          {(Object.keys(ACCENTS) as AccentKey[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={accent === key}
              className="r-tweak-swatch"
              data-on={String(accent === key)}
              style={{ background: ACCENTS[key].primary }}
              title={ACCENTS[key].label}
              onClick={() => onAccent(key)}
            >
              {accent === key ? <Check size={13} /> : null}
            </button>
          ))}
        </div>
      </div>
      <label className="r-tweak-line">
        <span>Background glow</span>
        <button className="r-switch" type="button" role="switch" aria-checked={backgroundGlow} data-on={String(backgroundGlow)} onClick={() => onBackgroundGlow(!backgroundGlow)} />
      </label>
      <div className="r-tweaks-section">
        <span className="r-tweaks-label"><Gauge size={12} /> Replay pace</span>
        <div className="r-tweak-segment" role="radiogroup" aria-label="Replay pace">
          {(["brisk", "standard", "cinematic"] as ReplayPace[]).map((pace) => (
            <button key={pace} type="button" role="radio" aria-checked={replayPace === pace} data-on={String(replayPace === pace)} onClick={() => onReplayPace(pace)}>
              {pace}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ProgressSpine({ roomId }: { roomId: string }) {
  const store = useStore();
  const artifacts = store.listArtifacts(roomId);
  const proposals = store.listProposals(roomId);
  const drafts = store.listDrafts(roomId);
  const hasContent = artifacts.some((a) =>
    Object.values(a.elements ?? {}).some((el) => {
      const v = (el as { value?: unknown }).value;
      return v != null && v !== "";
    }),
  );
  let stage = 0;
  if (artifacts.length > 0) stage = 1;
  if (hasContent) stage = 2;
  if (proposals.length > 0 || drafts.length > 0) stage = 3;
  const spine = ["Intake", "Evidence", "Draft", "Review", "Export"];
  return (
    <div className="r-spine" data-testid="progress-spine" aria-label="Workflow progress" data-noderoom-surface="shell.progressSpine">
      {spine.map((label, i) => (
        <span key={label} className="r-spine-step" data-state={i < stage ? "done" : i === stage ? "now" : "next"}>
          {i < stage ? <Check size={11} /> : <span className="r-spine-dot" />}
          {label}
        </span>
      ))}
    </div>
  );
}

function SignalStatusStrip({
  roomId,
  me,
  focusModeEnabled,
  onOpenArtifact,
}: {
  roomId: string;
  me: Actor;
  focusModeEnabled: boolean;
  onOpenArtifact: (id: string) => void;
}) {
  const store = useStore();
  const traces = selectPublicSignalTraces(store.listTraces(roomId));
  const proposals = store.listProposals(roomId);
  const sessions = store.listSessions(roomId);
  const run = store.lastRun();
  const job = store.lastLongFreeJob();
  const latest = traces.at(-1);
  const lastFollowedTrace = useRef<string | null>(null);
  const status = publicStatusText(latest, proposals.length, job?.status);
  const jobStatus = job?.status ?? "";
  const jobRisk = ["failed", "blocked", "cancelled", "paused"].includes(jobStatus);
  const jobLive = !!job && !["completed", "failed", "cancelled", "blocked", "paused"].includes(jobStatus);
  const credit = store.creditBalance?.();
  const signals = [
    ...(credit && credit.enforced
      ? [{ k: "Credits", v: `${credit.availableCredits.toFixed(0)}${credit.reservedCredits ? ` (${credit.reservedCredits.toFixed(0)} held)` : ""}${credit.demo ? " demo" : ""}` }]
      : []),
    ...(proposals.length ? [{ k: "Review", v: `${proposals.length} pending` }] : []),
    ...(jobRisk ? [{ k: "Run", v: jobStatus }] : []),
    ...(jobLive
      ? [
          { k: "Agents", v: `${sessions.length} active` },
          { k: "Eval", v: run ? `${run.model} | ${run.toolCalls} tools` : "running" },
          { k: "Cost", v: run ? `$${run.costUsd.toFixed(3)}` : job ? job.modelPolicy : "-" },
        ]
      : []),
  ];
  // Click-through (TARGET L87): a Signal Tape / Status item opens its referenced artifact on the
  // stage and pulses the cell. It never fabricates a target; only renders a button when one exists.
  const openProposal = () => {
    const p = proposals[0];
    if (!p) return;
    onOpenArtifact(p.artifactId);
    focusStage({ artifactId: p.artifactId, elementId: (p.op as { elementId?: string }).elementId });
  };
  const latestArt = latest?.refs?.artifactId;
  const openLatest = () => {
    if (!latestArt) return;
    onOpenArtifact(latestArt);
    focusStage({ artifactId: latestArt, elementId: latest?.refs?.cell ?? latest?.refs?.elementId });
  };
  useEffect(() => {
    if (!focusModeEnabled || !latest || !latestArt) return;
    if (lastFollowedTrace.current === latest.id) return;
    if (textEntryIsActive()) return;
    lastFollowedTrace.current = latest.id;
    onOpenArtifact(latestArt);
    const elementId = latest.refs?.cell ?? latest.refs?.elementId;
    if (elementId) requestAnimationFrame(() => focusStage({ artifactId: latestArt, elementId }));
  }, [focusModeEnabled, latest, latestArt, onOpenArtifact]);

  return (
    <div className="r-shell-bottom" data-testid="shell-bottom" data-noderoom-surface="shell.statusStrip">
      <ProgressSpine roomId={roomId} />
      <div
        className="r-focus-status"
        data-testid="focus-mode-status"
        data-on={String(focusModeEnabled)}
        aria-label={`Attention overlay ${focusModeEnabled ? "following agent work" : "idle"}`}
        title={`Attention overlay ${focusModeEnabled ? "following agent work" : "idle"}`}
      >
        <Crosshair size={11} />
      </div>
      <div className="r-status-strip" data-testid="status-strip" role="status" aria-live="polite">
        <span className="r-status-dot" data-kind={status.kind} />
        {latestArt ? (
          <button className="r-status-main" data-testid="status-open" style={{ border: "none", background: "transparent", color: "inherit", font: "inherit", padding: 0, textAlign: "left", cursor: "pointer" }} title="Open the referenced artifact on the stage" onClick={openLatest}>
            {status.text}
          </button>
        ) : (
          <span className="r-status-main">{status.text}</span>
        )}
        {latest && <span className="r-status-meta">{latest.actor.name} · {latest.type}</span>}
      </div>
      {signals.length > 0 && (
        <div className="r-signal-tape" data-testid="signal-tape" aria-label="Signal Tape" data-noderoom-surface="shell.signalTape">
          {signals.map((s) =>
            s.k === "Review" && proposals.length > 0 ? (
              <button key={s.k} className="r-signal-chip" data-testid="signal-review" style={{ border: "none", cursor: "pointer" }} title="Open the pending proposal on the stage" onClick={openProposal}>
                <b>{s.k}</b>{s.v}
              </button>
            ) : s.k === "Credits" ? (
              <span key={s.k} className="r-signal-chip r-credit-chip" data-testid="signal-credits" title="Demo credits — 1 credit = $0.25. The live wallet meters real spend (not metered until the credit backend deploys).">
                <b>{s.k}</b>{s.v}
              </span>
            ) : (
              <span key={s.k} className="r-signal-chip"><b>{s.k}</b>{s.v}</span>
            ),
          )}
          <PassiveAgentChip roomId={roomId} me={me} onOpenArtifact={onOpenArtifact} />
        </div>
      )}
      {signals.length === 0 && (
        <PassiveAgentChip roomId={roomId} me={me} onOpenArtifact={onOpenArtifact} />
      )}
    </div>
  );
}

function ResizeHandle({ label, onPointerDown }: { label: string; onPointerDown: (clientX: number) => void }) {
  return (
    <button
      className="r-resize"
      aria-label={label}
      title={label}
      onPointerDown={(e) => { e.preventDefault(); onPointerDown(e.clientX); }}
    />
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function ThemeToggle() {
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme ?? "dark") === "dark");
  return (
    <button className="r-iconbtn" title="Toggle light / dark" aria-label={dark ? "Switch to light theme" : "Switch to dark theme"} aria-pressed={dark} onClick={() => { const n = dark ? "light" : "dark"; document.documentElement.dataset.theme = n; setDark(!dark); }}>
      {dark ? <Moon size={16} /> : <Sun size={16} />}
    </button>
  );
}
