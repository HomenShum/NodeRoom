/* ============================================================================
   NodeAgent Mobile — seed narrative + types
   Ported from the design prototype (docs/visuals/.../mobile/na-data.js).
   Same CardioNova / Q3 diligence story as the desktop room, framed for the
   mobile job: capture → triage → approve → review. Mock data — wiring these to
   live Convex room state is a follow-up.
   ============================================================================ */
import type { IconName } from "./MobileIcons";

// ── shared unions ───────────────────────────────────────────────────────────
export type Tone = "accent" | "ok" | "warn" | "bad" | "priv" | "mute";
export type TabId = "capture" | "room" | "agent" | "inbox" | "files";
export type SheetId = "plan" | "evidence" | "coach" | "row" | "jobs" | "settings";
export type ComposerMode = "note" | "room" | "agent";
export type AgentLane = "private" | "room";
export type PersonKey = "priya" | "quokka" | "homen" | "room_na";

export interface Stat {
  v: string;
  l: string;
  mono?: boolean;
}

// ── room ────────────────────────────────────────────────────────────────────
export interface Room {
  name: string;
  code: string;
  live: number;
  version: string;
}
export const ROOM: Room = { name: "Q3 Diligence", code: "NR7K9", live: 6, version: "v41" };

// The note the operator dumps. Detection runs against this after a pause.
export const SEED_NOTE =
  "Met Maya from CardioNova at the healthtech mixer. Possible Series B. " +
  "Ask about monthly burn and whether the hospital pilots are paid.";

// ── detected entities + signals ──────────────────────────────────────────────
export interface DetectedItem {
  icon: IconName;
  lab: string;
  text: string;
}
export const DETECTED: DetectedItem[] = [
  { icon: "building", lab: "Company", text: "CardioNova" },
  { icon: "user", lab: "Person", text: "Maya Chen" },
  { icon: "signal", lab: "Signal", text: "Series B" },
  { icon: "gap", lab: "Gap", text: "paid pilots" },
];

// ── agent work plan (approval artifact) ──────────────────────────────────────
export interface Plan {
  hash: string;
  entity: string;
  willRead: string[];
  wontRead: string[];
  willCreate: string[];
  stats: Stat[];
}
export const PLAN: Plan = {
  hash: "p_8f21",
  entity: "CardioNova",
  willRead: [
    "This capture note",
    "Existing CardioNova row in the Q3 sheet",
    "Cached company profile (refreshed < 2h)",
    "Public web sources — funding + pilots",
  ],
  wontRead: ["Your private notes & uploads", "Anything outside this room"],
  willCreate: [
    "A proposed company row (diff, not a write)",
    "Evidence cards with source receipts",
    "One follow-up task for Maya",
  ],
  stats: [
    { v: "4", l: "planned reads", mono: false },
    { v: "0", l: "writes (proposal only)", mono: false },
    { v: "$0.01", l: "est. cost", mono: true },
    { v: "~40s", l: "est. runtime", mono: true },
  ],
};

// ── evidence coverage ─────────────────────────────────────────────────────────
export type SupportItem =
  | { kind: "cite"; n: string; text: string; verified: boolean }
  | { kind: "gap"; text: string };
export interface Evidence {
  claim: string;
  status: string;
  support: SupportItem[];
}
export const EVIDENCE: Evidence = {
  claim: "Possible Series B",
  status: "needs_review",
  support: [
    { kind: "cite", n: "1", text: "Deck p.12 — “raising Series B”", verified: false },
    { kind: "cite", n: "2", text: "TechCrunch, Mar 2026 — funding rumor", verified: true },
    { kind: "gap", text: "No primary source for round size / lead" },
  ],
};

// ── coach prompt ──────────────────────────────────────────────────────────────
export interface Coach {
  question: string;
  howto: string[];
  feedback: { well: string; missed: string; cite: string; wording: string };
}
export const COACH: Coach = {
  question:
    "Explain why CardioNova’s runway is marked needs_review — and what would move it to verified.",
  howto: [
    "Name the claim and its current status.",
    "Cite the source you do have, and what it proves.",
    "State the missing primary source precisely.",
    "Say what action closes the gap.",
  ],
  feedback: {
    well: "You correctly separated the funding rumor from confirmed runway.",
    missed: "You cited the deck but not the burn figure it depends on.",
    cite: "Add the NetSuite cash balance as the runway denominator.",
    wording:
      "Runway is needs_review: we have a Series B rumor (TC, Mar 2026) but no confirmed cash balance or monthly burn.",
  },
};

// ── inbox (triage) ────────────────────────────────────────────────────────────
export interface InboxItem {
  id: string;
  icon: IconName;
  tone: Tone;
  title: string;
  sub: string;
  status: string;
  statusTone: Tone;
  time: string;
  kind: "plan" | "evidence" | "coach" | "done";
}
export const INBOX: InboxItem[] = [
  { id: "i_plan", icon: "sparkles", tone: "accent", title: "CardioNova research plan", sub: "Approval needed before any web read", status: "approve", statusTone: "warn", time: "now", kind: "plan" },
  { id: "i_gap", icon: "gap", tone: "warn", title: "Source gap · paid pilots", sub: "Blocks the revenue-confidence column", status: "1 gap", statusTone: "warn", time: "2m", kind: "evidence" },
  { id: "i_coach", icon: "coach", tone: "priv", title: "Coach prompt ready", sub: "Practice the CardioNova review", status: "review", statusTone: "priv", time: "5m", kind: "coach" },
  { id: "i_done", icon: "checkCircle", tone: "ok", title: "NetSuite reconciliation", sub: "Read-only run · 4 reads · 0 writes", status: "done", statusTone: "ok", time: "1h", kind: "done" },
];

// ── room pulse (live shared state) ────────────────────────────────────────────
export interface PulseAgent {
  name: string;
  role: string;
  tone?: Tone;
  dot?: boolean;
}
export interface Finding {
  icon: IconName;
  title: string;
  sub: string;
  t: string;
}
export interface PulsePerson {
  short: string;
  name: string;
  role: string;
  color: string;
}
export interface Pulse {
  agents: PulseAgent[];
  findings: Finding[];
  people: PulsePerson[];
}
export const PULSE: Pulse = {
  agents: [{ name: "Room NodeAgent", role: "idle · waiting approval", tone: "mute", dot: false }],
  findings: [
    { icon: "table", title: "Variance committed", sub: "Revenue, COGS · v41 → v42", t: "4m" },
    { icon: "building", title: "CardioNova detected", sub: "New entity from your capture", t: "6m" },
  ],
  people: [
    { short: "HS", name: "Homen", role: "Host", color: "#D97757" },
    { short: "PR", name: "Priya", role: "Finance", color: "#5E6AD2" },
    { short: "qk", name: "anon · quokka", role: "Guest", color: "#5B8F71" },
  ],
};

// ── room chat (public, Slack-style multi-party feed) ──────────────────────────
export type RoomMsg =
  | { id: string; who: string; kind: "msg"; t: string; text: string }
  | { id: string; who: string; kind: "status"; t: string; text: string }
  | { id: string; who: string; kind: "summary"; t: string; text: string; stats: Stat[] }
  | { id: string; who: string; kind: "artifact"; t: string; title: string; meta: string };
export const ROOM_CHAT: RoomMsg[] = [
  { id: "m1", who: "priya", kind: "msg", t: "8m", text: "Pulling the NetSuite Q3 numbers into the variance sheet — revenue looks off vs the close." },
  { id: "m2", who: "quokka", kind: "msg", t: "6m", text: "joined as a guest. read-only on the sheet for now?" },
  { id: "m3", who: "homen", kind: "msg", t: "5m", text: "You can edit — collaborator access is on. Getting the agent to reconcile the variance." },
  { id: "m4", who: "room_na", kind: "status", t: "4m", text: "Reconciling Q3 revenue against the NetSuite export…" },
  { id: "m5", who: "room_na", kind: "summary", t: "4m", text: "Committed Variance for Revenue and COGS through the sync tool. Lock released.", stats: [{ v: "v41→v42", l: "version" }, { v: "2", l: "rows" }, { v: "0", l: "overwrites" }] },
  { id: "m6", who: "room_na", kind: "artifact", t: "4m", title: "Q3 variance", meta: "sheet · v42 · 3 collaborators" },
  { id: "m7", who: "priya", kind: "msg", t: "2m", text: "Nice. @CardioNova still needs the paid-pilot source before we trust runway." },
];

// ── agent command surface (ChatGPT-style 1:1) ─────────────────────────────────
export type AgentMsg =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "agent"; variant: "text"; text: string }
  | { id: string; role: "agent"; variant: "status"; text: string }
  | { id: string; role: "agent"; variant: "summary"; title: string; sub: string; stats: Stat[] };
export interface AgentChatSeed {
  private: AgentMsg[];
  room: AgentMsg[];
}
export const AGENT_CHAT: AgentChatSeed = {
  private: [
    { id: "a1", role: "user", text: "why should null cells survive the sync instead of being deleted?" },
    { id: "a2", role: "agent", variant: "text", text: "null is a real blank value, not a delete instruction. The sync tool preserves it so a retried delta can’t silently drop data. This stays private unless you promote it." },
  ],
  room: [
    { id: "r1", role: "agent", variant: "text", text: "I’m the Room NodeAgent — I use room-visible context only. Ask me to research, enrich the sheet, or build evidence cards. Everything I do is proposed first." },
  ],
};

export interface QuickPrompt {
  icon: IconName;
  text: string;
  kind: "plan" | "draft" | "coach" | "summary";
}
export const QUICK_PROMPTS: QuickPrompt[] = [
  { icon: "search", text: "Research CardioNova funding & burn", kind: "plan" },
  { icon: "pen", text: "Draft a follow-up to Maya", kind: "draft" },
  { icon: "coach", text: "Prep me to explain runway", kind: "coach" },
  { icon: "note", text: "Summarize today’s notes", kind: "summary" },
];

// ── agent jobs (queue + completed) ────────────────────────────────────────────
export interface Job {
  id: string;
  title: string;
  sub: string;
  cost: string;
  eta?: string;
  route?: string;
  trace?: string;
  pct?: number;
}
export interface Jobs {
  running: Job[];
  queued: Job[];
  completed: Job[];
}
export const JOBS: Jobs = {
  running: [{ id: "j1", title: "CardioNova research", sub: "read-only · by Homen", cost: "$0.01", eta: "~25s", route: "haiku", pct: 60 }],
  queued: [{ id: "j2", title: "Enrich 3 pipeline companies", sub: "waiting on approval", cost: "$0.04", eta: "queued", route: "sonnet" }],
  completed: [
    { id: "j3", title: "NetSuite reconciliation", sub: "4 reads · 0 writes", cost: "$0.01", trace: "r_182" },
    { id: "j4", title: "Q3 variance commit", sub: "v41 → v42 · 2 rows", cost: "$0.01", trace: "r_181" },
  ],
};

// ── files / artifacts (lightweight mobile access) ─────────────────────────────
export interface FileItem {
  id: string;
  icon: IconName;
  name: string;
  meta: string;
  tone: Tone;
  kind: "sheet" | "note" | "wall" | "source";
}
export const FILES: FileItem[] = [
  { id: "sheet_q3", icon: "table", name: "Q3 variance", meta: "sheet · v42 · 3 collaborators", tone: "accent", kind: "sheet" },
  { id: "note_sync", icon: "note", name: "Sync reliability", meta: "note · edited 2m ago", tone: "mute", kind: "note" },
  { id: "wall", icon: "target", name: "Diligence wall", meta: "wall · 6 notes", tone: "mute", kind: "wall" },
  { id: "doc_ns", icon: "file", name: "NetSuite export", meta: "source · read-only", tone: "mute", kind: "source" },
];

// CardioNova row card — the mobile spreadsheet pattern (cards, not a grid)
export interface RowField {
  k: string;
  v: string;
  status: string;
  tone: Tone;
  /** Live cell address + CAS baseline — present only for live rows (enables in-place edit). */
  elementId?: string;
  version?: number;
}
export interface Row {
  entity: string;
  sub: string;
  fields: RowField[];
}
export const ROW: Row = {
  entity: "CardioNova",
  sub: "healthtech · row in Q3 variance",
  fields: [
    { k: "Product", v: "AI triage for hospitals", status: "partial", tone: "warn" },
    { k: "Funding", v: "Possible Series B", status: "needs_review", tone: "warn" },
    { k: "Runway", v: "Unknown", status: "source gap", tone: "bad" },
    { k: "Contact", v: "Maya Chen", status: "manual note", tone: "mute" },
  ],
};

// ── people / avatars ──────────────────────────────────────────────────────────
export interface Person {
  short: string;
  name: string;
  color: string;
  agent?: boolean;
}
export const PEOPLE: Record<PersonKey, Person> = {
  priya: { short: "PR", name: "Priya", color: "#5E6AD2" },
  quokka: { short: "qk", name: "anon · quokka", color: "#5B8F71" },
  homen: { short: "HS", name: "Homen", color: "#D97757" },
  room_na: { short: "NA", name: "Room NodeAgent", color: "#C08A5E", agent: true },
};
