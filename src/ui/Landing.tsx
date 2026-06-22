/** Landing (`.r-landing`) - design hero + create/join, recreated from room.css. */
import { useState } from "react";
import { ArrowRight, Building2, Code2, FileCheck2, LineChart, PlayCircle, Plus, Sparkles, X } from "lucide-react";
import { engine, demo, createFreshRoom, enterDemoRoomAsHost, joinRoomByCode } from "../app/roomStore";
import { NodeReveal } from "./motion/NodeReveal";
import { NodeCount } from "./motion/NodeCount";
import { NodeTextReveal } from "./motion/NodeTextReveal";
import type { Session } from "./App";

type LandingProps = {
  onEnter?: (s: Session) => void;
  mode?: "memory" | "live";
  defaultCode?: string;
  busy?: boolean;
  joinError?: string | null;
  onLiveDemo?: (name: string) => void;
  onLiveJoin?: (code: string, name: string) => void;
  onLiveCreate?: (name: string) => void;
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
  const code = engine.getRoom(demo.roomId)?.code ?? "";
  const [join, setJoin] = useState(defaultCode ?? code);
  const [name, setName] = useState("");
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joinDialogCode, setJoinDialogCode] = useState<string | null>(null);
  const live = mode === "live";
  const shownError = joinError ?? joinErr;
  const displayName = (fallback = "Guest") => name.trim() || fallback;

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
    if (live) onLiveCreate?.(displayName("Host"));
    else onEnter?.(createFreshRoom("My room", name || "Host"));
  };
  const confirmLiveJoin = () => {
    if (!joinDialogCode) return;
    onLiveJoin?.(joinDialogCode, displayName());
    setJoinDialogCode(null);
  };

  return (
    <div className="r-app">
      <div className="r-screen">
        <div className="r-landing">
          <span className="r-eyebrow"><Sparkles size={13} /> NodeRoom - startup banking diligence room</span>
          <h1 className="r-h1">
            <NodeTextReveal text="A live room for banker-led diligence." />
          </h1>
          <NodeReveal delay={200} distance={8}>
            <p className="r-lede">
              Multiple users and NodeAgents gather company information, enrich source-backed grids,
              build runway and milestone artifacts, and keep every AI edit behind a
              <b> lock {"->"} proposal {"->"} review</b> path.
            </p>
          </NodeReveal>
          <NodeReveal delay={350} distance={8}>
            <button className="r-btn" style={{ marginBottom: 4 }} disabled={busy} onClick={() => { window.location.hash = "story"; }}>
              <PlayCircle size={15} /> See how it works - the 7-layer walkthrough
            </button>
          </NodeReveal>
          {!live && (
            <label className="r-field" style={{ maxWidth: 320 }}>
              <span className="r-field-label">Display name</span>
              <input data-testid="display-name" className="r-text-input" placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <div className="r-cta-row" data-live={String(live)}>
            {live ? (
              <button data-testid="create-room" className="r-btn primary" disabled={busy} onClick={createRoom}>
                <Plus size={17} /> Create a room
              </button>
            ) : (
              <button data-testid="start-demo-room" className="r-btn primary" disabled={busy} onClick={enterDemo}>
                Enter the diligence room <ArrowRight size={15} />
              </button>
            )}
            <div className="r-join-inline">
              <input
                placeholder={live ? "ENTER CODE" : "CODE"}
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
            {live ? (
              <button data-testid="start-demo-room" className="r-btn ghost r-demo-room" disabled={busy} onClick={enterDemo}>
                <PlayCircle size={15} /> Run startup diligence demo <ArrowRight size={15} />
              </button>
            ) : (
              <button data-testid="create-room" className="r-btn secondary" disabled={busy} onClick={createRoom}>
                <Plus size={14} /> Create blank room
              </button>
            )}
          </div>
          {shownError && <div className="r-join-error" role="alert">{shownError}</div>}

          <NodeReveal delay={500} distance={10}>
            <div className="r-proof-grid" data-testid="proof-metrics">
              <div className="r-proof"><NodeCount value={1240} suffix="+" /><span className="r-proof-label">sources captured</span></div>
              <div className="r-proof"><NodeCount value={8600} suffix="+" /><span className="r-proof-label">evidence facts</span></div>
              <div className="r-proof"><NodeCount value={420} suffix="+" /><span className="r-proof-label">no-clobber checks</span></div>
              <div className="r-proof"><NodeCount value={99} suffix="%" /><span className="r-proof-label">cache hits</span></div>
            </div>
          </NodeReveal>

          <div className="r-feature-grid">
            <NodeReveal delay={600} distance={10}><div className="r-feature"><div className="fi"><Building2 size={16} /></div><h3>Company diligence</h3><p>Single-company or batch research lands in shared grids with owner, status, source, and freshness states.</p></div></NodeReveal>
            <NodeReveal delay={700} distance={10}><div className="r-feature"><div className="fi"><LineChart size={16} /></div><h3>Runway & milestones</h3><p>Agents turn cash, burn, hiring, pricing, and market headwinds into reviewable banker artifacts.</p></div></NodeReveal>
            <NodeReveal delay={800} distance={10}><div className="r-feature"><div className="fi"><FileCheck2 size={16} /></div><h3>Evidence & review</h3><p>Cells, charts, handoff drafts, and coach cues stay traceable before anything is shared downstream.</p></div></NodeReveal>
          </div>
        </div>
        {live && joinDialogCode && (
          <div
            className="r-room-modal-scrim"
            onMouseDown={(e) => { if (e.target === e.currentTarget) setJoinDialogCode(null); }}
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
      </div>
    </div>
  );
}
