/** Landing (`.r-landing`) - design hero + create/join, recreated from room.css. */
import { useState } from "react";
import { Sparkles, PlayCircle, Plus, Building2, LineChart, FileCheck2 } from "lucide-react";
import { engine, demo, createFreshRoom, enterDemoRoomAsHost, joinRoomByCode } from "../app/roomStore";
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
  const live = mode === "live";
  const shownError = joinError ?? joinErr;
  const displayName = () => name.trim() || "Guest";

  const tryJoin = () => {
    setJoinErr(null);
    if (live) {
      onLiveJoin?.(join, displayName());
      return;
    }
    const s = joinRoomByCode(join, displayName());
    if (s) onEnter?.(s);
    else setJoinErr(`No room found for "${join.toUpperCase()}".`);
  };
  const enterDemo = () => {
    if (live) onLiveDemo?.(name.trim() || "Guest");
    else onEnter?.(enterDemoRoomAsHost(name));
  };
  const createRoom = () => {
    if (live) onLiveCreate?.(name.trim() || "Host");
    else onEnter?.(createFreshRoom("My room", name || "Host"));
  };

  return (
    <div className="r-app">
      <div className="r-screen">
        <div className="r-landing">
          <span className="r-eyebrow"><Sparkles size={13} /> NodeRoom - startup banking diligence room</span>
          <h1 className="r-h1">A live room for <span className="accent">banker-led diligence</span>.</h1>
          <p className="r-lede">
            Multiple users and NodeAgents gather company information, enrich source-backed grids,
            build runway and milestone artifacts, and keep every AI edit behind a
            <b> lock {"->"} proposal {"->"} review</b> path.
          </p>
          <button className="r-btn" style={{ marginBottom: 4 }} disabled={busy} onClick={() => { window.location.hash = "story"; }}>
            <PlayCircle size={15} /> See how it works - the 7-layer walkthrough
          </button>
          <label className="r-field" style={{ maxWidth: 320 }}>
            <span className="r-field-label">Display name</span>
            <input data-testid="display-name" className="r-text-input" placeholder="e.g. Priya" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="r-cta-row">
            <button data-testid="start-demo-room" className="r-btn primary" disabled={busy} onClick={enterDemo}>
              {live ? "Run startup diligence demo ->" : "Enter the diligence room ->"}
            </button>
            <div className="r-join-inline">
              <input
                placeholder="CODE"
                value={join}
                disabled={busy}
                onChange={(e) => { setJoin(e.target.value); setJoinErr(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") tryJoin(); }}
                aria-label="Room code"
                data-testid="join-room-code"
              />
              <button data-testid="join-room" className="r-btn" disabled={busy} onClick={tryJoin}>Join</button>
            </div>
            <button data-testid="create-room" className="r-btn secondary" disabled={busy} onClick={createRoom}>
              <Plus size={14} /> Create blank room
            </button>
          </div>
          {shownError && <div className="r-join-error" role="alert">{shownError}</div>}

          <div className="r-feature-grid">
            <div className="r-feature"><div className="fi"><Building2 size={16} /></div><h3>Company diligence</h3><p>Single-company or batch research lands in shared grids with owner, status, source, and freshness states.</p></div>
            <div className="r-feature"><div className="fi"><LineChart size={16} /></div><h3>Runway & milestones</h3><p>Agents turn cash, burn, hiring, pricing, and market headwinds into reviewable banker artifacts.</p></div>
            <div className="r-feature"><div className="fi"><FileCheck2 size={16} /></div><h3>Evidence & review</h3><p>Cells, charts, handoff drafts, and coach cues stay traceable before anything is shared downstream.</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}
