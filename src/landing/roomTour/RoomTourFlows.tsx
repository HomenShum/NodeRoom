/* ============================================================================
   NodeAgent Room Tour — Landing / Create modal / Join modal / shared Avatar.
   Ported from room/flows.jsx (window.RFlows). Class namespace renamed r- → rt-
   to avoid collision with the real room app at src/app/styles.css.
   ============================================================================ */
import * as React from "react";
import { Ico, type IconName } from "./RoomTourIcons";
import { makeRoomCode, type Person } from "./roomTourData";

export function Avatar({ p, size }: { p: Person; size?: "sm" | "md" | "lg" }): React.ReactElement {
  const cls = "rt-avatar" + (size ? " " + size : "") + (p.kind === "agent" ? " agent" : "");
  return React.createElement("span", { className: cls, style: { background: p.color } }, p.short);
}

// ── Landing (scratchnode.live-style) ─────────────────────────────────────────
export function Landing({
  onCreate,
  onJoin,
}: {
  onCreate: () => void;
  onJoin: (code: string) => void;
}): React.ReactElement {
  const [code, setCode] = React.useState("");
  const features: Array<{ ic: IconName; h: string; p: string }> = [
    { ic: "globe",  h: "Public by default",   p: "One room URL. Share a 6-char code and anyone can join — no account, just a display name." },
    { ic: "layout", h: "Up to four panels",   p: "Files & people · public chat + room agent · a live artifact · your own private agent. Open only what you need." },
    { ic: "lock",   h: "Locks, not collisions", p: "When an agent works a range it locks it — read-only for others, still readable. Drafts smart-merge on unlock." },
  ];
  return (
    <div className="rt-screen">
      <div className="rt-landing">
        <div className="rt-eyebrow">
          <span className="rt-dot-live" />
          NodeAgent · live collaborative rooms
        </div>
        <h1 className="rt-h1">
          Bring people and <span className="accent">agents</span> into the same room.
        </h1>
        <p className="rt-lede">
          Chat, a shared workspace, and NodeAgents that edit alongside you — public for the room, private for you.
          The agent proposes; bounded tools commit.
        </p>
        <div className="rt-cta-row">
          <button
            className="rt-btn primary"
            data-testid="create-room"
            onClick={onCreate}
            style={{ padding: "11px 18px", fontSize: 14 }}
          >
            {Ico("plus", { size: 17 })}
            Create a room
          </button>
          <div className="rt-join-inline">
            <input
              value={code}
              maxLength={7}
              placeholder="ENTER CODE"
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => { if (e.key === "Enter" && code.length >= 6) onJoin(code); }}
            />
            <button className="rt-btn" onClick={() => onJoin(code || "Q3X-7K")}>
              Join {Ico("arrow", { size: 15 })}
            </button>
          </div>
        </div>
        <div className="rt-feature-grid">
          {features.map((f) => (
            <div className="rt-feature" key={f.h}>
              <div className="fi">{Ico(f.ic, { size: 18 })}</div>
              <h3>{f.h}</h3>
              <p>{f.p}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared code peek block (lightweight static syntax highlight) ─────────────
export function CodePeek({ file, children }: { file: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="rt-codepeek">
      <div className="cp-head">{Ico("code", { size: 12 })}{file}</div>
      <pre>{children}</pre>
    </div>
  );
}
const sp = (cls: string, t: string) => React.createElement("span", { className: cls }, t);

// ── Create room modal ───────────────────────────────────────────────────────
export function CreateModal({
  onClose,
  onEnter,
}: {
  onClose: () => void;
  onEnter: (code: string, title: string) => void;
}): React.ReactElement {
  const [title, setTitle] = React.useState("Q3 diligence");
  const [code] = React.useState(() => makeRoomCode());
  const [copied, setCopied] = React.useState(false);
  const copy = (): void => {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div
      className="rt-modal-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rt-modal">
        <div className="rt-modal-head">
          <div className="row between">
            <span className="kicker">Host a room</span>
            <button className="rt-iconbtn" onClick={onClose}>{Ico("x", { size: 16 })}</button>
          </div>
          <h2>Create a room</h2>
          <p className="sub">You’ll own this room. It mints a room id and a share code — anyone with the code can join.</p>
        </div>
        <div className="rt-modal-body">
          <div className="rt-field">
            <label>Room title</label>
            <input className="rt-text-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="rt-codecard">
            <div className="lbl">Share code</div>
            <div className="code">{code}</div>
            <button
              className="rt-btn ghost"
              onClick={copy}
              style={{ margin: "8px auto 0" }}
            >
              {Ico(copied ? "check" : "copy", { size: 14 })}
              {copied ? "Copied" : "Copy code"}
            </button>
          </div>
          <CodePeek file="convex/schema.ts · mutation createRoom">
            {sp("cm", "// host owns the room; everything is keyed by roomId\n")}
            {sp("kw", "const")} roomId = {sp("fn", "makeRoomId")}();  {sp("cm", "// \"room_a1b2c3\"")}{"\n"}
            {sp("kw", "const")} code   = {sp("fn", "makeRoomCode")}();  {sp("cm", "// \"")}{sp("str", code)}{sp("cm", "\"")}{"\n"}
            {sp("kw", "await")} db.{sp("fn", "insert")}({sp("str", "'rooms'")}, {"{ roomId, title, "}{sp("pr", "hostId")}{", code });"}
          </CodePeek>
          <button
            className="rt-btn primary"
            data-testid="create-room-submit"
            onClick={() => onEnter(code, title)}
            style={{ width: "100%", justifyContent: "center", marginTop: 16, padding: "11px" }}
          >
            Enter room {Ico("arrow", { size: 16 })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Anonymous join modal ────────────────────────────────────────────────────
export function JoinModal({
  code,
  onClose,
  onEnter,
}: {
  code: string;
  onClose: () => void;
  onEnter: (displayName: string) => void;
}): React.ReactElement {
  const [name, setName] = React.useState("");
  const display = name.trim() || "quokka";
  return (
    <div
      className="rt-modal-scrim"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rt-modal">
        <div className="rt-modal-head">
          <div className="row between">
            <span className="kicker">Join a room</span>
            <button className="rt-iconbtn" onClick={onClose}>{Ico("x", { size: 16 })}</button>
          </div>
          <h2>Join anonymously</h2>
          <p className="sub">No account needed. Pick a display name — you’ll get an ephemeral guest identity scoped to this room.</p>
        </div>
        <div className="rt-modal-body">
          <div className="rt-field">
            <label>Room code</label>
            <input className="rt-text-input mono" value={code} readOnly />
          </div>
          <div className="rt-field">
            <label>Display name</label>
            <input
              className="rt-text-input"
              value={name}
              placeholder="quokka"
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          <CodePeek file="rooms · anonymous identity">
            {sp("cm", "// guest gets an ephemeral, room-scoped identity\n")}
            {sp("kw", "const")} me = {"{ "}{sp("pr", "id")}: {sp("str", "'anon_'")} + nanoid(),{"\n"}
            {"            "}{sp("pr", "name")}: {sp("str", "\"anon · ")}{sp("str", display)}{sp("str", "\"")}, {sp("pr", "anon")}: {sp("kw", "true")} {"};"}{"\n"}
            {sp("kw", "await")} {sp("fn", "joinRoom")}({"{ code: "}{sp("str", "\"")}{sp("str", code)}{sp("str", "\"")}{", identity: me });"}
          </CodePeek>
          <button
            className="rt-btn primary"
            onClick={() => onEnter(display)}
            style={{ width: "100%", justifyContent: "center", marginTop: 16, padding: "11px" }}
          >
            Join as guest {Ico("arrow", { size: 16 })}
          </button>
        </div>
      </div>
    </div>
  );
}
