/**
 * RoomShell — top bar + June 2026 shell roles: Room Binder, Work Surface,
 * Copilot, Signal Tape, and Status Strip. Reads everything through `useStore()`,
 * so it renders identically whether the data is the in-memory engine or live
 * Convex. The collaboration "Run" button calls `store.runCollab()` — the scripted
 * demo in-memory, the real `runRoomAgent` Convex action when live.
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { PanelLeft, Table2, PanelRight, Moon, Sun, LogOut, Link2, ShieldCheck, X, HelpCircle, Copy, Check, MessageCircle, Sparkles } from "lucide-react";
import { useStore, type ActorProof } from "../app/store";
import { Chat } from "./Chat";
import { Artifact } from "./panels/Artifact";
import { LeftRail } from "./LeftRail";
import { GuidedTour, type TourStep } from "./GuidedTour";
import { selectPublicSignalTraces, statusText as publicStatusText } from "./signalStatus";
import { focusStage } from "./stageFocus";
import { BankerCoachPanel } from "./artifacts/BankerCoachPanel";
import { TraceLensProvider } from "./traceLens/useTraceLens";
import { TraceLensPanel } from "./traceLens/TraceLensPanel";
import { PassiveAgentChip } from "./insights/PassiveAgentChip";
import { resolveRoomOpenTarget } from "./openRoomReference";
import type { Actor, Channel } from "../engine/types";

const AUTO_ACCEPT_PREF_KEY = "noderoom:autoAcceptConsent:v1";
const TOUR_KEY = "noderoom:tour:v1";
const NOTE_PRIORITY = ["Capture Notebook", "Note", "Diligence memo", "Open questions / workplan", "Agent wiki"];

export function preferredRoomArtifact<T extends { id: string; kind?: string; title?: string }>(arts: T[]): T | undefined {
  for (const title of NOTE_PRIORITY) {
    const hit = arts.find((a) => a.kind === "note" && a.title === title);
    if (hit) return hit;
  }
  return arts.find((a) => a.kind === "note") ?? arts.find((a) => a.kind === "sheet") ?? arts[0];
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
  // Panels are a VIEWPORT decision, not a role/mode decision. The old `live && !isCompact` init read
  // `live` (= isHost via canRunCollab) at mount — still false on a RELOAD while Convex queries load —
  // so every returning visitor (tour already seen, nothing to force panels open) landed in a chat-only
  // layout. Caught by the walkthrough capturer's reload path; see FRICTION_LOG 2026-06-09.
  const [show, setShow] = useState({ left: false, stage: true, copilot: !isCompact });
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
  const [collab, setCollab] = useState<{ running: boolean; done: boolean; error?: string }>({ running: false, done: false });
  const [autoAcceptModal, setAutoAcceptModal] = useState(false);
  const [rememberAutoAccept, setRememberAutoAccept] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const tourAutoStarted = useRef(false);
  const collabAlive = useRef(true);
  useEffect(() => {
    collabAlive.current = true;
    return () => { collabAlive.current = false; };
  }, []);
  // First-run: auto-start the walkthrough only in the deterministic in-memory demo. Live Convex
  // rooms now include fresh room-create and teammate-join flows; an auto-modal there blocks the
  // actual collaboration proof. The header "?" button still replays the tour everywhere.
  const shouldAutoStartTour = store.mode === "memory" && arts.some((a) => a.title === "Q3 variance");
  useEffect(() => {
    if (tourAutoStarted.current || !shouldAutoStartTour) return;
    let seen = false;
    try { seen = localStorage.getItem(TOUR_KEY) === "done"; } catch { /* ignore */ }
    tourAutoStarted.current = true;
    // On compact screens panels are stacked fixed overlays — opening all three would bury the chat
    // the tour is pointing at, so the tour starts from the chat-only default there.
    if (!seen) { if (!isCompact) setShow({ left: true, stage: true, copilot: true }); setTourOpen(true); }
  }, [shouldAutoStartTour, isCompact]);
  // Drop a stale split-view pin if its artifact vanished. MUST run before the `!room` early return:
  // a LIVE room mounts with room=undefined and resolves a tick later, so a hook placed AFTER the
  // return changes the hook count between those two renders ("rendered more hooks than previous").
  useEffect(() => {
    if (sideArtId && !arts.some((a) => a.id === sideArtId)) setSideArtId(null);
  }, [sideArtId, arts]);
  if (!room) return <div className="r-app"><div className="r-screen"><div style={{ margin: "auto" }} className="muted">Loading room…</div></div></div>;

  const members = store.listMembers(roomId);
  const inviteHref = inviteHrefForRoom(room.code);
  const isHost = members.some((m) => m.id === me.id && m.role === "host");
  const privChannel: Channel = { private: me.id };
  const curArt = arts.find((a) => a.id === artId) ?? preferredRoomArtifact(arts);
  const openArtifact = (id: string, opts?: { split?: boolean; elementId?: string }): boolean => {
    const target = resolveRoomOpenTarget({
      id,
      artifacts: store.listArtifacts(roomId),
      proposals: store.listProposals(roomId),
    });
    if (!target) return false;
    const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";
    const compactNow = hasMatchMedia && window.matchMedia("(max-width: 980px)").matches;
    setShow((s) => compactNow ? { ...s, left: false, stage: true, copilot: false } : { ...s, stage: true });
    const canSplitNow = hasMatchMedia && window.matchMedia("(min-width: 1200px)").matches;
    if (opts?.split && canSplitNow && target.artifactId !== artId) {
      setSideArtId(target.artifactId);
    } else {
      setArtId(target.artifactId);
    }
    const elementId = opts?.elementId ?? target.elementId;
    if (elementId) requestAnimationFrame(() => focusStage({ artifactId: target.artifactId, elementId }));
    return true;
  };

  const varianceArt = arts.find((a) => a.title === "Q3 variance") ?? arts.find((a) => a.kind === "sheet");
  // Open the tour from a clean, known layout: all panels shown + the financial grid selected, ONCE.
  // Steps then anchor only to always-visible elements, so there are no per-step side-effects to thrash.
  const startTour = () => {
    if (varianceArt) openArtifact(varianceArt.id);
    setShow({ left: true, stage: true, copilot: true });
    setCopilotTab("public");
    setTourOpen(true);
  };
  const tourSteps: TourStep[] = [
    {
      title: "Welcome to NodeRoom",
      body: "A live diligence room where bankers, guests, and NodeAgents gather company facts, enrich shared grids, and prepare runway, milestone, and handoff artifacts without clobbering each other. This memory demo is safe: nothing is sent anywhere.",
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
      selector: '[data-testid="collab-run"]',
      title: "Human + agent, no clobbering",
      body: "Click Run collaboration to watch the agent lock a range, draft around human edits, and merge through compare-and-swap. This is the trust primitive behind evidence-bearing diligence cells.",
      placement: "left",
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
      body: "Type /ask diligence CardioNova or run /demo multi-agent startup diligence to show the room moving from intake to evidence, review, runway gaps, and downstream drafts.",
      placement: "center",
    },
  ];

  const collabErrText = (e: unknown) => (e instanceof Error && e.message ? `Couldn't run the collaboration — ${e.message}` : "Couldn't run the collaboration. Try again.");
  const runCollab = async () => {
    if (collab.running) return;
    setShow({ left: true, stage: true, copilot: true });
    setCopilotTab("public");
    setCollab({ running: true, done: false });
    // C7/C2: a rejected runRoomAgent must surface honestly — not flip done:true as if it succeeded.
    try {
      await store.runCollab();
      if (collabAlive.current) setCollab({ running: false, done: true });
    } catch (e) {
      if (collabAlive.current) setCollab({ running: false, done: false, error: collabErrText(e) });
    }
  };
  const runSemanticConflictDrill = async () => {
    if (collab.running || !store.runSemanticConflictDrill) return;
    setShow({ left: true, stage: true, copilot: true });
    setCopilotTab("public");
    setCollab({ running: true, done: false });
    try {
      await store.runSemanticConflictDrill();
      if (collabAlive.current) setCollab({ running: false, done: true });
    } catch (e) {
      if (collabAlive.current) setCollab({ running: false, done: false, error: collabErrText(e) });
    }
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
  const openSidebarChat = () => {
    setCopilotTab("public");
    setShow((s) => {
      if (isCompact) return { left: false, stage: false, copilot: true };
      return { ...s, stage: true, copilot: true };
    });
  };
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
    <div className="r-app">
      <div className="r-top" data-noderoom-surface="shell.topbar">
        <div className="r-mark">N</div>
        <div className="r-brand">NodeRoom <span>· {room.title}</span></div>
        {/* The code chip LOOKS like a button, so it must be one — sharing the code is the core
            multiplayer flow (Meet/Figma mental model: click the code -> copy invite). */}
        <button className="r-roomcode" type="button" title="Copy invite link" aria-label={codeCopied ? "Invite link copied" : `Copy invite link for room ${room.code}`} aria-live="polite"
          onClick={() => {
            // Robust copy feedback: confirm regardless of whether the async clipboard write
            // resolves (it is unavailable in some contexts) so the user always sees acknowledgement.
            try { void navigator.clipboard?.writeText(inviteHref); } catch { /* clipboard unavailable */ }
            setCodeCopied(true); setTimeout(() => setCodeCopied(false), 1200);
          }}>
          <Link2 size={12} /> invite <b>{room.code}</b> {codeCopied ? <Check size={11} /> : <Copy size={11} />}
        </button>
        {store.mode === "convex" && <span className="r-tag" style={{ background: "var(--bg-secondary)", color: "var(--text-muted)" }}>● live convex</span>}
        {store.mode === "memory" && <span className="r-tag r-demo-badge" title="Scripted demo — no backend or API keys needed; everything runs locally and offline.">● demo</span>}
        <span className="r-spacer" />
        <div className="r-toggle-group">
          <button className="r-iconbtn" data-mobile-label="Room" data-on={String(show.left)} title="Room Binder" aria-label="Toggle Room Binder panel" aria-pressed={show.left} onClick={toggleBinder}><PanelLeft size={16} /></button>
          <button className="r-iconbtn" data-mobile-label="Work" data-on={String(!isCompact || show.stage)} title="Work Surface" aria-label={isCompact ? "Show Work Surface panel" : "Focus Work Surface"} aria-pressed={!isCompact || show.stage} onClick={showWorkSurface}><Table2 size={16} /></button>
          <button className="r-iconbtn" data-mobile-label="Chat" data-on={String(show.copilot)} title="Copilot" aria-label="Toggle Copilot panel" aria-pressed={show.copilot} onClick={toggleCopilot}><PanelRight size={16} /></button>
        </div>
        <div className="r-pill-auto">
          Auto-allow
          {/* The highest-blast-radius control (gates whether agent edits apply without review):
              a real ARIA switch, not a bare button, so assistive tech reads its on/off state. */}
          <button className="r-switch" role="switch" aria-checked={room.autoAllow} aria-label="Auto-allow agent edits without host review" data-testid="auto-allow-switch" data-on={String(room.autoAllow)} disabled={!isHost} title={isHost ? "Auto-approve agent edits" : "Only the host can change auto-allow"} onClick={toggleAutoAccept} />
        </div>
        <div className="r-avatars">
          {members.slice(0, 4).map((m) => (<span key={m.id} className="r-av" style={{ background: m.color }}>{initials(m.name)}<span className="pulse" /></span>))}
          <span className="r-av agent" style={{ background: "#8F3F27" }}>◆</span>
        </div>
        <span className="r-live-count" title={`${members.length} live room member${members.length === 1 ? "" : "s"}`}>{members.length} live</span>
        <button className="r-iconbtn" title="Take the guided tour" aria-label="Take the guided tour" data-testid="tour-button" onClick={startTour}><HelpCircle size={16} /></button>
        <ThemeToggle />
        <button className="r-iconbtn" title="Leave room" aria-label="Leave room" onClick={onLeave}><LogOut size={16} /></button>
      </div>

      <div className="r-workspace" data-shell="june-2026">
        {show.left && <LeftRail roomId={roomId} me={me} artId={curArt?.id ?? artId} style={{ width: layout.left }} onPick={openArtifact} onOpenChat={openSidebarChat} />}
        {show.left && <ResizeHandle label="Resize files panel" onPointerDown={(x) => startResize("left", x)} />}
        {(!isCompact || show.stage) && <Artifact roomId={roomId} me={me} proof={proof} artId={curArt?.id ?? artId} onArt={setArtId} sideArtId={sideArtId} onSideArtChange={setSideArtId} onOpenChat={openSidebarChat} style={{ flex: layout.stage }} collab={store.canRunCollab ? { ...collab, onRun: runCollab, onConflict: store.runSemanticConflictDrill ? runSemanticConflictDrill : undefined } : undefined} />}
        {show.copilot && <ResizeHandle label="Resize Copilot panel" onPointerDown={(x) => startResize("right", x)} />}
        {show.copilot && (
          <CopilotPanel
            roomId={roomId}
            me={me}
            privChannel={privChannel}
            active={copilotTab}
            onActive={setCopilotTab}
            onOpenArtifact={openArtifact}
            style={{ width: layout.right }}
          />
        )}
      </div>
      <SignalStatusStrip roomId={roomId} me={me} onOpenArtifact={openArtifact} />
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
  onOpenArtifact,
  style,
}: {
  roomId: string;
  me: Actor;
  privChannel: Channel;
  active: "public" | "private";
  onActive: (tab: "public" | "private") => void;
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
            <Chat roomId={roomId} me={me} channel="public" variant="public" agentName="Room NodeAgent" embedded testId="public-chat-panel" onOpenArtifact={onOpenArtifact} />
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

function SignalStatusStrip({ roomId, me, onOpenArtifact }: { roomId: string; me: Actor; onOpenArtifact: (id: string) => void }) {
  const store = useStore();
  const traces = selectPublicSignalTraces(store.listTraces(roomId));
  const proposals = store.listProposals(roomId);
  const sessions = store.listSessions(roomId);
  const run = store.lastRun();
  const job = store.lastLongFreeJob();
  const latest = traces.at(-1);
  const status = publicStatusText(latest, proposals.length, job?.status);
  const jobStatus = job?.status ?? "";
  const jobRisk = ["failed", "blocked", "cancelled", "paused"].includes(jobStatus);
  const jobLive = !!job && !["completed", "failed", "cancelled", "blocked", "paused"].includes(jobStatus);
  const signals = [
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

  return (
    <div className="r-shell-bottom" data-testid="shell-bottom" data-noderoom-surface="shell.statusStrip">
      <ProgressSpine roomId={roomId} />
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
