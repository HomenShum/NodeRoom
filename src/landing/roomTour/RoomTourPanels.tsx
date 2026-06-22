/* ============================================================================
   NodeAgent Room Tour — left rail (files + people), center public chat,
   right private agent. Ported from room/panels.jsx (window.RPanels).
   Class namespace renamed r- → rt-.
   ============================================================================ */
import * as React from "react";
import { Ico, type IconName } from "./RoomTourIcons";
import { Avatar } from "./RoomTourFlows";
import { PEOPLE, type ChatMessage, type FileItem, type Person, type ArtifactKind } from "./roomTourData";

const FILE_ICON: Record<ArtifactKind, IconName> = { sheet: "sheet", note: "note", wall: "wall", doc: "doc" };

// Some messages can be "activity" rows (lock/unlock/commit beats). Optional.
export interface ActivityMessage {
  id: string;
  activity: true;
  icon?: IconName;
  text: string;
  t: string;
}
export type FeedItem = ChatMessage | ActivityMessage;

function isActivity(m: FeedItem): m is ActivityMessage {
  return (m as ActivityMessage).activity === true;
}

// ── Left rail: files + people ───────────────────────────────────────────────
export function LeftRail({
  files,
  activeFile,
  onSelectFile,
  people,
}: {
  files: FileItem[];
  activeFile: string;
  onSelectFile: (id: string) => void;
  people: Person[];
}): React.ReactElement {
  return (
    <div className="rt-panel left">
      <div className="rt-panel-head">
        {Ico("folder", { size: 15, style: { color: "var(--text-muted)" } })}
        <span className="h-title">Room</span>
      </div>
      <div className="rt-rail">
        <div className="rt-rail-section kicker">Files</div>
        {files.map((f) => (
          <button
            key={f.id}
            className="rt-file"
            data-active={String(activeFile === f.id)}
            onClick={() => onSelectFile(f.id)}
          >
            <span className="fi">{Ico(FILE_ICON[f.kind], { size: 15 })}</span>
            <span className="grow">
              <div className="fn">{f.name}</div>
              <div className="fm">{f.meta}</div>
            </span>
          </button>
        ))}
        <div className="rt-rail-section kicker" style={{ marginTop: 8 }}>People · 3 live</div>
        {people.map((p) => (
          <div key={p.id} className="rt-person">
            <Avatar p={p} size="sm" />
            <span className="grow">
              <div className="pn">{p.name}</div>
              <div className="pr">{p.role}</div>
            </span>
            {p.kind === "human" ? <span className="rt-dot-live" /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── A single chat message (regular or activity) ─────────────────────────────
export function Message({
  m,
  people,
}: {
  m: FeedItem;
  people: Record<string, Person>;
}): React.ReactElement {
  if (isActivity(m)) {
    return (
      <div className="rt-activity">
        <span className="rt-activity-ico">{Ico(m.icon ?? "dot", { size: 12 })}</span>
        <span className="rt-activity-text">{m.text}</span>
        <span className="rt-activity-time">{m.t}</span>
      </div>
    );
  }
  const p = people[m.who] || PEOPLE[m.who];
  const isAgent = p && p.kind === "agent";
  return (
    <div className={"rt-msg" + (isAgent ? " agent" : "")}>
      <Avatar p={p} size="sm" />
      <div className="body">
        <div className="meta">
          <span className="who" style={isAgent ? { color: "var(--accent-ink)" } : undefined}>{p.name}</span>
          {isAgent ? <span className="rt-tag agent">agent</span> : null}
          <span className="time">{m.t}</span>
        </div>
        {m.ask
          ? <div className="rt-bubble-ask">{m.text}</div>
          : <div className="text">{m.text}</div>}
      </div>
    </div>
  );
}

// ── Typing indicator row ────────────────────────────────────────────────────
function Typing({ p }: { p: Person }): React.ReactElement {
  return (
    <div className="rt-msg agent">
      <Avatar p={p} size="sm" />
      <div className="body">
        <div className="meta">
          <span className="who" style={{ color: "var(--accent-ink)" }}>{p.name}</span>
        </div>
        <div className="rt-typing">
          <i /><i /><i />
        </div>
      </div>
    </div>
  );
}

// ── Center: public chat + room agent ────────────────────────────────────────
export function CenterChat({
  messages,
  people,
  onSend,
  typing,
}: {
  messages: FeedItem[];
  people: Record<string, Person>;
  onSend: (text: string) => void;
  typing?: boolean;
}): React.ReactElement {
  const [val, setVal] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);
  const submit = (): void => {
    const v = val.trim();
    if (!v) return;
    onSend(v);
    setVal("");
  };
  return (
    <div className="rt-panel center">
      <div className="rt-panel-head">
        {Ico("chat", { size: 15, style: { color: "var(--text-muted)" } })}
        <span className="h-title">Public chat</span>
        <span className="rt-tag public">{Ico("globe", { size: 11 })}Everyone</span>
        <span className="grow" />
        <Avatar p={PEOPLE.room_na} size="sm" />
        <span className="h-sub">Room NodeAgent</span>
      </div>
      <div className="rt-chat" ref={scrollRef}>
        {messages.map((m) => <Message key={m.id} m={m} people={people} />)}
        {typing ? <Typing p={PEOPLE.room_na} /> : null}
      </div>
      <div className="rt-composer">
        <div className="rt-input-wrap">
          <input
            value={val}
            placeholder="Message the room…  try /ask"
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <button className="rt-send" onClick={submit}>{Ico("send", { size: 15 })}</button>
        </div>
        <div className="rt-composer-hint">
          <span className="rt-chip">/ask reconcile Q3 revenue</span>
          <span className="rt-chip">/ask flag variance &gt; 15%</span>
        </div>
      </div>
    </div>
  );
}

// ── Right: your private agent ───────────────────────────────────────────────
export function RightAgent({
  messages,
  people,
  onSend,
  typing,
}: {
  messages: FeedItem[];
  people: Record<string, Person>;
  onSend: (text: string) => void;
  typing?: boolean;
}): React.ReactElement {
  const [val, setVal] = React.useState("");
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);
  const submit = (): void => {
    const v = val.trim();
    if (!v) return;
    onSend(v);
    setVal("");
  };
  return (
    <div className="rt-panel right">
      <div className="rt-panel-head">
        <Avatar p={PEOPLE.my_na} size="sm" />
        <span className="h-title">Your NodeAgent</span>
        <span className="grow" />
        <span className="rt-tag private">{Ico("lock", { size: 11 })}Private</span>
      </div>
      <div className="rt-private-banner">
        {Ico("eye", { size: 13 })}
        Reads room context · output stays yours until you promote it
      </div>
      <div className="rt-chat" ref={scrollRef} style={{ padding: "12px 12px 6px" }}>
        {messages.map((m) => <Message key={m.id} m={m} people={people} />)}
        {typing ? <Typing p={PEOPLE.my_na} /> : null}
      </div>
      <div className="rt-composer">
        <div className="rt-input-wrap">
          <input
            value={val}
            placeholder="Ask privately…"
            onChange={(e) => setVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          />
          <button className="rt-send" onClick={submit}>{Ico("send", { size: 15 })}</button>
        </div>
      </div>
    </div>
  );
}
