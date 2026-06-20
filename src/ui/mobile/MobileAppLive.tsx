/* ============================================================================
   NodeAgent Mobile — live store binding.
   Reads the live room from useStore() and reshapes it into the props MobileApp
   expects, then renders MobileApp with `live` set. This component always runs
   under a store provider (mounted by MobileRoot), so useStore() is safe here.
   Wired surfaces (this pass): room metadata + the public room chat (the wedge).
   Other panels remain sample data until their live wiring lands.
   ============================================================================ */
import { useStore } from "../../app/store";
import type { Actor, Message, Member, CellStatus } from "../../engine/types";
import type { RoomMsg, Person, AgentMsg, Row, Tone } from "./mobileData";
import type { MobileLive } from "./mobileTypes";
import { MobileApp } from "./MobileApp";

const AGENT_KEY = "room_na";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 45) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  return Math.floor(h / 24) + "d";
}

function buildPeople(members: Member[]): Record<string, Person> {
  const out: Record<string, Person> = {
    [AGENT_KEY]: { short: "NA", name: "Room NodeAgent", color: "#C08A5E", agent: true },
  };
  for (const m of members) out[m.id] = { short: initials(m.name), name: m.name, color: m.color };
  return out;
}

// Live Message -> mobile RoomMsg. The rich summary/artifact card variants have no
// server shape (see the integration map's keepMock list); live messages render as
// plain chat / agent text, with agent authorship driving the agent styling.
function reshapeMessages(messages: Message[]): RoomMsg[] {
  return messages.map((m): RoomMsg => ({
    id: m.id,
    who: m.author.kind === "agent" ? AGENT_KEY : m.author.id,
    kind: "msg",
    t: relTime(m.createdAt),
    text: m.text,
  }));
}

// Live Message -> mobile AgentMsg (1:1 agent-convo style): user-authored -> user bubble,
// agent-authored -> agent text bubble.
function reshapeAgentMsgs(messages: Message[]): AgentMsg[] {
  return messages.map((m): AgentMsg =>
    m.author.kind === "user" ? { id: m.id, role: "user", text: m.text } : { id: m.id, role: "agent", variant: "text", text: m.text });
}

// ── live CardioNova row (the Company research sheet) ────────────────────────
const RESEARCH_ROW = "rc_cardionova";
const ROW_FIELDS: { col: string; label: string }[] = [
  { col: "intent", label: "Product" },
  { col: "funding", label: "Funding" },
  { col: "headcount", label: "Headcount" },
  { col: "owner", label: "Contact" },
];

// A cell's value is either a raw seed string or an enriched CellPayload { value, status, evidence }.
function cellPayload(value: unknown): { value: unknown; status?: CellStatus } {
  if (value && typeof value === "object" && "value" in (value as Record<string, unknown>)) {
    return value as { value: unknown; status?: CellStatus };
  }
  return { value };
}
function cellDisplay(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}
function cellTone(s?: CellStatus): Tone {
  if (s === "complete") return "ok";
  if (s === "needs_review" || s === "running") return "warn";
  if (s === "gap" || s === "failed") return "bad";
  return "mute";
}

export function MobileAppLive({ roomId, me, onLeave }: { roomId: string; me: Actor; onLeave?: () => void }) {
  const store = useStore();
  const room = store.getRoom(roomId);
  const members = store.listMembers(roomId);
  const messages = store.listMessages(roomId, "public");
  const privateMsgs = store.listMessages(roomId, { private: me.id });

  const researchSheet = store.listArtifacts(roomId).find((a) => a.kind === "sheet" && a.title === "Company research");
  const researchArt = researchSheet ? store.getArtifact(researchSheet.id) : undefined;
  const liveRow: Row = {
    entity: "CardioNova",
    sub: "healthtech · row in Company research",
    fields: researchArt
      ? ROW_FIELDS.map(({ col, label }) => {
          const elementId = `${RESEARCH_ROW}__${col}`;
          const el = researchArt.elements[elementId];
          const p = cellPayload(el?.value);
          return { k: label, v: cellDisplay(p.value), status: p.status ?? "", tone: cellTone(p.status), elementId, version: el?.version ?? 0 };
        })
      : [],
  };
  const editRowField = async (elementId: string, value: string, baseVersion: number) => {
    if (!researchSheet) return { ok: false, reason: "no_sheet" };
    return store.applyEdit({ roomId, op: { opId: crypto.randomUUID(), artifactId: researchSheet.id, elementId, kind: "set", value, baseVersion }, actor: me });
  };

  const live: MobileLive = {
    roomName: room?.title ?? "Room",
    roomCode: room?.code ?? "",
    liveCount: members.length,
    roomMsgs: reshapeMessages(messages),
    people: buildPeople(members),
    postRoomMessage: async (text: string) => {
      return store.postMessage({ roomId, channel: "public", author: me, text, clientMsgId: crypto.randomUUID(), kind: "chat" });
    },
    agentPrivate: reshapeAgentMsgs(privateMsgs),
    agentRoom: reshapeAgentMsgs(messages.filter((m) => m.author.kind === "agent" || m.author.id === me.id)),
    askPrivateAgent: async (goal: string) => {
      void store.postMessage({ roomId, channel: { private: me.id }, author: me, text: goal, clientMsgId: crypto.randomUUID(), kind: "chat" });
      try {
        await store.askPrivateAgent({ goal });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "agent_failed" };
      }
    },
    askRoomAgent: async (goal: string) => {
      void store.postMessage({ roomId, channel: "public", author: me, text: goal, clientMsgId: crypto.randomUUID(), kind: "chat" });
      try {
        await store.askAgent({ goal });
        return { ok: true };
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : "agent_failed" };
      }
    },
    row: liveRow,
    editRowField,
    onLeave,
  };

  return <MobileApp live={live} />;
}
