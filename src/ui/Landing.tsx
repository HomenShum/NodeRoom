/** Landing (`.r-landing`) - design hero + create/join, recreated from room.css. */
import { useState } from "react";
import { ArrowLeft, ArrowRight, Code2, Globe2, LayoutGrid, Lock, Moon, Plus, Sparkles, X } from "lucide-react";
import { createFreshRoom, enterDemoRoomAsHost, joinRoomByCode } from "../app/roomStore";
import { NodeReveal } from "./motion/NodeReveal";
import type { Session } from "./App";

type LandingProps = {
  onEnter?: (s: Session) => void;
  mode?: "memory" | "live";
  defaultCode?: string;
  busy?: boolean;
  joinError?: string | null;
  onLiveDemo?: (name: string) => void;
  onLiveJoin?: (code: string, name: string) => void;
  onLiveCreate?: (name: string, title?: string, code?: string) => void;
};

export function Landing({
  onEnter,
  mode = "memory",
  defaultCode,
  busy = false,
  joinError,
  onLiveDemo,
  onLiveJoin,
  onLiveCreate,
}: LandingProps) {
  const [join, setJoin] = useState(defaultCode ?? "");
  const [name, setName] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joinDialogCode, setJoinDialogCode] = useState<string | null>(null);
  const [createDialogCode, setCreateDialogCode] = useState<string | null>(null);
  const [createTitle, setCreateTitle] = useState("Blank NodeRoom");
  const live = mode === "live";
  const shownError = joinError ?? joinErr;
  const displayName = (fallback = "Guest") => name.trim() || fallback;
  const toggleTheme = () => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.theme = root.dataset.theme === "dark" ? "light" : "dark";
  };

  const tryJoin = () => {
    setJoinErr(null);
    if (live) {
      const roomCode = join.trim();
      if (!roomCode) {
        setJoinErr("Enter a 6-12 character room code.");
        return;
      }
      setJoinDialogCode(roomCode);
      return;
    }
    const s = joinRoomByCode(join, displayName());
    if (s) onEnter?.(s);
    else setJoinErr(`No room found for "${join.toUpperCase()}".`);
  };
  const enterDemo = () => {
    if (live) onLiveDemo?.(displayName("Host"));
    else onEnter?.(enterDemoRoomAsHost(name));
  };
  const createRoom = () => {
    if (live) {
      setCreateTitle("Blank NodeRoom");
      setCreateDialogCode(makeLandingRoomCode());
    } else onEnter?.(createFreshRoom("My room", name || "Host"));
  };
  const confirmLiveJoin = () => {
    if (!joinDialogCode) return;
    onLiveJoin?.(joinDialogCode, displayName());
    setJoinDialogCode(null);
  };
  const confirmLiveCreate = () => {
    if (!createDialogCode) return;
    onLiveCreate?.(displayName("Host"), createTitle.trim() || "Blank NodeRoom", createDialogCode);
    setCreateDialogCode(null);
  };

  return (
    <div className="r-app">
      <div className="r-screen">
        <div className="r-landing-shell">
          <header className="r-landing-top">
            <button className="r-landing-brand" type="button" onClick={() => { window.location.hash = ""; }} aria-label="NodeAgent home">
              <span className="r-mark">N</span>
              <span>NodeAgent</span>
            </button>
            <button className="r-iconbtn" type="button" aria-label="Toggle light / dark" title="Toggle light / dark" onClick={toggleTheme}>
              <Moon size={16} />
            </button>
          </header>

          <main className="r-landing">
            <span className="r-eyebrow"><Sparkles size={13} /> NodeAgent · live collaborative rooms</span>
            <h1 className="r-h1">
              Bring people and <span className="accent">agents</span> into the same room.
            </h1>
            <NodeReveal delay={140} distance={8}>
              <p className="r-lede">
                Chat, a shared workspace, and NodeAgents that edit alongside you — public for the room,
                private for you. The agent proposes; bounded tools commit.
              </p>
            </NodeReveal>
            <div className="r-cta-row" data-live={String(live)}>
              <button data-testid={live ? "create-room" : "start-demo-room"} className="r-btn primary" disabled={busy} onClick={live ? createRoom : enterDemo}>
                <Plus size={17} /> Create a room
              </button>
              <div className="r-join-inline">
                <input
                  placeholder="ENTER CODE"
                  value={join}
                  disabled={busy}
                  maxLength={14}
                  onChange={(e) => { setJoin(live ? e.target.value.toUpperCase() : e.target.value); setJoinErr(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") tryJoin(); }}
                  aria-label="Room code"
                  data-testid="join-room-code"
                />
                <button data-testid="join-room" className="r-btn" disabled={busy} onClick={tryJoin}>
                  Join <ArrowRight size={15} />
                </button>
              </div>
            </div>
            {shownError && <div className="r-join-error" role="alert">{shownError}</div>}

            <div className="r-feature-grid">
              <NodeReveal delay={280} distance={10}><div className="r-feature"><div className="fi"><Globe2 size={16} /></div><h3>Public by default</h3><p>One room URL. Share a 6-char code and anyone can join — no account, just a display name.</p></div></NodeReveal>
              <NodeReveal delay={360} distance={10}><div className="r-feature"><div className="fi"><LayoutGrid size={16} /></div><h3>Up to four panels</h3><p>Files &amp; people · public chat + room agent · a live artifact · your own private agent. Open only what you need.</p></div></NodeReveal>
              <NodeReveal delay={440} distance={10}><div className="r-feature"><div className="fi"><Lock size={16} /></div><h3>Locks, not collisions</h3><p>When an agent works a range it locks it — read-only for others, still readable. Drafts smart-merge on unlock.</p></div></NodeReveal>
            </div>
          </main>

          <div className="r-story-tape" aria-label="Product story">
            <div className="r-story-meta">
              <span>01 · SURFACE</span>
              <strong>The public surface</strong>
            </div>
            <div className="r-story-actions">
              <button className="r-iconbtn" type="button" aria-label="Previous story step" title="Previous story step">
                <ArrowLeft size={15} />
              </button>
              <button className="r-iconbtn" type="button" aria-label="Open product story" title="Open product story" onClick={() => { window.location.hash = "story"; }}>
                <ArrowRight size={15} />
              </button>
            </div>
            <span className="r-story-command">apps/web · scratchnode.live shell</span>
          </div>
        </div>
        {live && joinDialogCode && (
          <div
            className="r-room-modal-scrim"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setJoinDialogCode(null); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setJoinDialogCode(null); } }}
          >
            <div className="r-room-modal" role="dialog" aria-modal="true" aria-labelledby="join-room-title">
              <div className="r-room-modal-head">
                <div className="row between">
                  <span className="kicker">Join a room</span>
                  <button className="r-iconbtn" type="button" aria-label="Close" onClick={() => setJoinDialogCode(null)}>
                    <X size={16} />
                  </button>
                </div>
                <h2 id="join-room-title">Join anonymously</h2>
                <p className="sub">No account needed. Pick a display name - you will get an ephemeral guest identity scoped to this room.</p>
              </div>
              <div className="r-room-modal-body">
                <label className="r-room-field">
                  <span>Room code</span>
                  <input className="r-text-input mono" value={joinDialogCode} readOnly />
                </label>
                <label className="r-room-field">
                  <span>Display name</span>
                  <input
                    data-testid="display-name"
                    className="r-text-input"
                    placeholder="quokka"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmLiveJoin(); }}
                    autoFocus
                  />
                </label>
                <div className="r-room-codepeek">
                  <div className="cp-head"><Code2 size={12} /> rooms - anonymous identity</div>
                  <pre>
                    <span className="cm">// guest gets an ephemeral, room-scoped identity{"\n"}</span>
                    <span className="kw">const</span> me = {"{ "}<span className="pr">id</span>: <span className="str">'anon_'</span> + nanoid(),{"\n"}
                    {"            "}<span className="pr">name</span>: <span className="str">"anon - {displayName()}"</span>, <span className="pr">anon</span>: <span className="kw">true</span> {"};\n"}
                    <span className="kw">await</span> <span className="fn">joinRoom</span>({"{ code: "}<span className="str">"{joinDialogCode}"</span>{", identity: me });"}
                  </pre>
                </div>
                <button className="r-btn primary r-room-modal-submit" disabled={busy} onClick={confirmLiveJoin}>
                  Join as guest <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
        {live && createDialogCode && (
          <div
            className="r-room-modal-scrim"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setCreateDialogCode(null); }}
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setCreateDialogCode(null); } }}
          >
            <div className="r-room-modal" role="dialog" aria-modal="true" aria-labelledby="create-room-title">
              <div className="r-room-modal-head">
                <div className="row between">
                  <span className="kicker">Create a room</span>
                  <button className="r-iconbtn" type="button" aria-label="Close" onClick={() => setCreateDialogCode(null)}>
                    <X size={16} />
                  </button>
                </div>
                <h2 id="create-room-title">Host a live room</h2>
                <p className="sub">Start with a named room and a shareable code. Guests can join anonymously after the room opens.</p>
              </div>
              <div className="r-room-modal-body">
                <label className="r-room-field">
                  <span>Room title</span>
                  <input
                    className="r-text-input"
                    placeholder="Startup diligence room"
                    value={createTitle}
                    maxLength={80}
                    onChange={(e) => setCreateTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmLiveCreate(); }}
                    autoFocus
                  />
                </label>
                <label className="r-room-field">
                  <span>Display name</span>
                  <input
                    data-testid="create-display-name"
                    className="r-text-input"
                    placeholder="Priya"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") confirmLiveCreate(); }}
                  />
                </label>
                <div className="r-room-codepeek">
                  <div className="cp-head"><Code2 size={12} /> rooms - host identity</div>
                  <pre>
                    <span className="cm">// host creates the room, then shares this code{"\n"}</span>
                    <span className="kw">const</span> room = <span className="kw">await</span> <span className="fn">createRoom</span>({"{"}<span className="pr">code</span>: <span className="str">"{createDialogCode}"</span>,{"\n"}
                    {"       "}<span className="pr">title</span>: <span className="str">"{createTitle.trim() || "Blank NodeRoom"}"</span>, <span className="pr">host</span>: <span className="str">"{displayName("Host")}"</span>{"});"}
                  </pre>
                </div>
                <button className="r-btn primary r-room-modal-submit" data-testid="create-room-submit" aria-label="Create room" disabled={busy} onClick={confirmLiveCreate}>
                  Create room <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function makeLandingRoomCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (b) => (b % 36).toString(36)).join("").toUpperCase();
  return `NR${suffix}${Date.now().toString(36).toUpperCase().slice(-4)}`.slice(0, 12);
}
