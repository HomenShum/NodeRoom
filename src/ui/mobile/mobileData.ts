/* ============================================================================
   NodeAgent Mobile — seed narrative (terra data foundation, strict TS)
   Same CardioNova / Q3 diligence story as the desktop room, framed for the
   mobile job: capture → triage → approve → review.

   Ported from terra/na-data.js (window.NAD). Pure data — no ctx, no React.
   Entity names are kept identical to window.NAD.* so other modules import by
   name. Cross-entity linkage (trace ids, planHash, claim keys) is preserved.
   ============================================================================ */

// ── Shared union types (consumed across mobile modules) ─────────────────────
export type Tone = "accent" | "warn" | "ok" | "bad" | "mute" | "priv";
export type CellStatus =
  | "source-backed"
  | "needs_review"
  | "partial"
  | "source gap"
  | "manual note";
export type TodoStatus = "done" | "running" | "todo";
export type TraceStepStatus = "done" | "running" | "pending";
export type TraceStepKind = "read" | "compute" | "gate" | "write";
export type SupportKind = "cite" | "gap";
export type AgentLane = "private" | "room";
export type AgentRole = "user" | "agent";
export type AgentVariant = "status" | "summary" | "text";
export type RoomChatWho = "priya" | "quokka" | "homen" | "room_na";
export type RoomChatKind = "msg" | "activity" | "summary" | "artifact" | "status";
export type ArtifactKind =
  | "deck"
  | "sheet"
  | "note"
  | "wall"
  | "source"
  | "plan"
  | "evidence"
  | "coach"
  | "done"
  | "room"
  | "draft";
export type PreviewKind = "deck" | "doc" | "sheet" | "chat";
// Was "haiku" | "sonnet" | "opus" (terra prototype days); widened to string so
// real provider model ids (e.g. "z-ai/glm-5.2") can ride through job.route +
// summary cards without a hardcoded narrowing. UI display is handled by
// `getModelLabel(id)` in src/landing/modelRegistry.ts.
export type AgentRoute = string;
export type SlideStatus = "draft" | "proposed" | "approved" | "needs_review";
export type DeckStatus = "draft" | "proposed" | "approved" | "exported";
export type ExportState = "not_started" | "ready" | "failed";

// ── UI-state unions (controller ↔ surfaces) + cross-module aliases ───────────
// Six primary tabs (Home is the terra default surface); Artifacts == files tab.
export type TabId = "home" | "capture" | "room" | "agent" | "inbox" | "files";
// Every bottom-sheet the controller can route to (settings is the shipped
// variant-matrix sheet; artifact == deck workbench, sheetart == grid workbench).
export type SheetId =
  | "rooms"
  | "pulse"
  | "plan"
  | "evidence"
  | "coach"
  | "row"
  | "jobs"
  | "artifact"
  | "sheetart"
  | "settings"
  // ── gap pack (design-reference/mobile-scale/gaps-app.jsx) ──
  | "review"
  | "trace"
  | "share"
  | "manage";
// Universal composer modes (source = capture-for-evidence).
export type ComposerMode = "note" | "room" | "agent" | "source";

/** Small stat chip used in agent summary cards (mono = monospace value). */
export interface Stat {
  v: string;
  l: string;
  mono?: boolean;
}

// Short aliases the leaf modules import by name (canonical shapes below).
export type RoomMsg = RoomChatMessage;
export type AgentMsg = AgentChatMessage;
export type Row = RowCard;
export type TraceData = Trace;
// Short extraction / roster aliases the screens import by name.
export type Extract = Extraction;
export type ExtractGroup = ExtractionGroup;
export type ExtractRow = ExtractionRow;
export type Finding = PulseFinding;
export type BriefingItem = Briefing;
export interface RecentTodo {
  t: string;
  s: string;
}

/**
 * A cited source as the SourceOverlay reads it — superset of EvidenceSupport /
 * ClaimSupport so either can be handed to ctx.openSource(). All fields optional;
 * the overlay degrades gracefully when a field is missing.
 */
export interface SourceRef {
  kind?: SupportKind;
  n?: string;
  text?: string;
  claim?: string;
  host?: string;
  verified?: boolean;
  srcType?: string;
  date?: string;
  url?: string;
  excerpt?: string;
}

// ── Interfaces ──────────────────────────────────────────────────────────────
export interface Room {
  name: string;
  code: string;
  live: number;
  people: number;
  agents: number;
  costToday: string;
  version: string;
  event: string;
  date: string;
  place: string;
}

export interface DetectedEntity {
  icon: string;
  lab: string;
  text: string;
}

export interface PlanStat {
  v: string;
  l: string;
  mono: boolean;
}

export interface Plan {
  hash: string;
  entity: string;
  willRead: string[];
  wontRead: string[];
  willCreate: string[];
  stats: PlanStat[];
}

export interface EvidenceSupport {
  kind: SupportKind;
  n?: string;
  text: string;
  host?: string;
  verified?: boolean;
  srcType?: string;
  date?: string;
  url?: string;
  excerpt?: string;
}

export interface Followup {
  match: string[];
  text: string;
}

export interface Evidence {
  claim: string;
  status: string;
  answer: string;
  support: EvidenceSupport[];
  followups: Followup[];
  fallback: string;
}

export interface CoachFeedback {
  well: string;
  missed: string;
  cite: string;
  wording: string;
}

export interface CoachTopic {
  id: string;
  label: string;
  question: string;
  howto: string[];
  feedback: CoachFeedback;
}

export interface Coach {
  topics: CoachTopic[];
}

export interface InboxItem {
  id: string;
  icon: string;
  tone: Tone;
  title: string;
  sub: string;
  status: string;
  statusTone: Tone;
  time: string;
  kind: ArtifactKind;
  preview: PreviewKind;
}

export interface PulseAgentStatus {
  label: string;
  live: boolean;
}

export interface PulseAgentDid {
  title: string;
  sub: string;
  trace: string;
  artifact?: string;
  artifactName?: string;
  live?: boolean;
}

export interface PulseAgent {
  id: string;
  name: string;
  role: string;
  kind: string;
  status: PulseAgentStatus;
  tone: Tone;
  dot: boolean;
  did: PulseAgentDid[];
}

export interface PulseFinding {
  icon: string;
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
  findings: PulseFinding[];
  people: PulsePerson[];
}

export interface RoomChatStat {
  v: string;
  l: string;
}

export interface RoomChatMessage {
  id: string;
  who: RoomChatWho | (string & {}); // widened: live member ids aren't in the fixed set
  kind: RoomChatKind;
  t: string;
  text?: string;
  stats?: RoomChatStat[];
  title?: string;
  meta?: string;
  // optimistic send (live mode): set on a locally-echoed message before the
  // server confirms it. `clientId` correlates the echo with the server row.
  pending?: boolean;
  failed?: boolean;
  clientId?: string;
}

export interface AgentChatMessage {
  id: string;
  role: AgentRole;
  text: string;
  variant?: AgentVariant;
  // summary-card variant fields (agent reply plans / found-sources cards)
  title?: string;
  sub?: string;
  stats?: Stat[];
  open?: SheetId;
  openLabel?: string;
  // optimistic send (live mode): mirrors RoomChatMessage — locally-echoed agent
  // turn before the server confirms it. `clientId` correlates the echo.
  pending?: boolean;
  failed?: boolean;
  clientId?: string;
}

export interface AgentChat {
  private: AgentChatMessage[];
  room: AgentChatMessage[];
}

export interface QuickPrompt {
  icon: string;
  text: string;
  kind: string;
}

export interface Job {
  id: string;
  title: string;
  sub: string;
  cost: string;
  eta?: string;
  route?: AgentRoute;
  pct?: number;
  trace?: string;
  artifact?: string;
  artifactName?: string;
}

export interface Jobs {
  running: Job[];
  queued: Job[];
  completed: Job[];
}

export interface DiffCell {
  field: string;
  before: string;
  after: string;
  delta: string;
}

export interface TraceDiff {
  row: string;
  version?: string;
  readonly?: boolean;
  cells: DiffCell[];
}

export interface TraceStep {
  icon: string;
  kind: TraceStepKind;
  title: string;
  detail: string;
  status: TraceStepStatus;
  meta?: string;
  diff?: TraceDiff;
}

export interface Trace {
  title: string;
  agent: string;
  model: AgentRoute;
  cost: string;
  duration: string;
  artifact: string;
  artifactName: string;
  scope: string;
  running?: boolean;
  steps: TraceStep[];
}

export interface FileItem {
  id: string;
  icon: string;
  name: string;
  meta: string;
  tone: Tone;
  kind: ArtifactKind;
}

export interface RowField {
  k: string;
  v: string;
  status: string;
  tone: Tone;
}

export interface RowCard {
  entity: string;
  sub: string;
  fields: RowField[];
}

export interface SheetColumn {
  id: string;
  label: string;
  w: number;
  head?: boolean;
  mono?: boolean;
}

export interface SheetCell {
  v: string;
  status?: string;
  tone?: Tone;
  claim?: string;
}

export interface SheetRow {
  id: string;
  cells: Record<string, SheetCell>;
}

export interface PlanTodo {
  text: string;
  status: TodoStatus;
}

export interface SheetPlan {
  goal: string;
  todos: PlanTodo[];
  ran: number;
  guard: string;
}

export interface PatchEvidence {
  n: string;
  text: string;
  verified: boolean;
}

export interface PatchSample {
  target: string;
  before: string;
  after: string;
  evidence: PatchEvidence[];
}

export interface ClaimSupport {
  kind: SupportKind;
  n?: string;
  text: string;
  host?: string;
  verified?: boolean;
}

export interface Claim {
  claim: string;
  answer: string;
  support: ClaimSupport[];
}

export interface Receipt {
  reads: { planned: number; actual: number };
  writes: { planned: number; actual: number };
  cost: { planned: string; actual: string };
  coverage: string;
  gaps: string[];
  files: string[];
}

export interface VersionEntry {
  v: string;
  label: string;
  t: string;
  current?: boolean;
}

export interface Sheet {
  id: string;
  title: string;
  sub: string;
  privacy: string;
  version: string;
  exportFormat: string;
  exportSize: string;
  sourceGaps: number;
  columns: SheetColumn[];
  rows: SheetRow[];
  plan: SheetPlan;
  patchSample: PatchSample;
  claims: Record<string, Claim>;
  followups: Followup[];
  fallback: string;
  receipt: Receipt;
  versions: VersionEntry[];
}

export interface ExtractionRow {
  k: string;
  v: string;
  conf: number;
  mono?: boolean;
}

export interface ExtractionGroup {
  id: string;
  label: string;
  flag?: boolean;
  rows: ExtractionRow[];
}

export interface Extraction {
  entity: string;
  groups: ExtractionGroup[];
}

export interface DeckPlan {
  goal: string;
  todos: PlanTodo[];
  ran: number;
  guard: string;
  willRead: string[];
  willCreate: string[];
  wontWrite: string[];
  stats: PlanStat[];
}

export interface Slide {
  id: string;
  index: number;
  title: string;
  status: SlideStatus;
  html: string;
  region?: boolean;
}

export interface Deck {
  id: string;
  title: string;
  audience: string;
  status: DeckStatus;
  planHash: string;
  privacy: string;
  exportState: ExportState;
  exportFormat: string;
  exportSize: string;
  sourceGaps: number;
  plan: DeckPlan;
  slides: Slide[];
  patchSample: PatchSample;
  receipt: Receipt;
  versions: VersionEntry[];
}

export interface RevisionControl {
  id: string;
  label: string;
  options: string[];
  def: number;
}

export interface RecentSig {
  type: string;
  count?: number;
  active?: number;
  status?: string;
  cells?: string[];
  todos?: Array<{ t: string; s: string }>;
  quote?: string;
  sources?: string[];
  gap?: number;
}

export interface RecentItem {
  id: string;
  icon: string;
  title: string;
  meta: string;
  kind: ArtifactKind;
  peek: string;
  sig: RecentSig;
}

export interface FavoriteSig {
  label: string;
  dot?: boolean;
  quiet?: boolean;
}

export interface FavoriteItem {
  id: string;
  icon: string;
  tone: Tone;
  title: string;
  meta: string;
  kind: ArtifactKind;
  sig: FavoriteSig;
}

export interface Briefing {
  id: string;
  icon: string;
  title: string;
  meta: string;
  level: string;
}

export interface RoomEntry {
  id: string;
  name: string;
  code: string;
  role: string;
  people: number;
  agents: number;
  live: boolean;
  pending: number;
}

export interface Person {
  short: string;
  name: string;
  color: string;
  agent?: boolean;
}

// ── Gap pack (design-reference/mobile-scale/gaps-app.jsx) ────────────────────
// Small, screen-scoped shapes for the 9 gap screens. Kept minimal on purpose:
// each maps to data the desktop already reads (pipeline bar / trace / people /
// invite code / offline queue) so the mobile screen is a re-projection, not a
// second source of truth.

/** One stage of the Intake → Evidence → Draft → Review → Export pipeline. */
export type PipelineStageState = "done" | "on" | "todo";
export interface PipelineStage {
  key: string;
  label: string;
  state: PipelineStageState;
  /** Mono caption ("1,000 rows", "agent enriching 81–120") — "" when nothing to show. */
  meta: string;
}

/** One recent trace row for the mobile Trace sheet (kind chip + text + time). */
export interface TraceRow {
  id: string;
  /** Short kind chip label ("commit", "lock", "cite", "edit"…). */
  kind: string;
  text: string;
  /** Compact time ("12:33", "5m"). */
  time: string;
}

/** A person row for Manage people, grouped by role, carrying a live-location line. */
export interface ManagedPerson {
  id: string;
  name: string;
  short: string;
  color?: string;
  role: "host" | "member" | "guest" | "agent";
  /** Live-location line ("Company research · owner") or "" when idle. */
  location: string;
}
export interface ManageGroup {
  key: ManagedPerson["role"];
  label: string;
  rows: ManagedPerson[];
}

/** Offline hold snapshot the mobile shell surfaces (mirror of OfflineQueueSnapshot). */
export interface OfflineHold {
  held: number;
  dropped: number;
  conflicts: number;
  replaying: boolean;
}

/** A notification-tier row for Settings (wired to wave-2 watches when reachable). */
export interface NotifRow {
  label: string;
  mode: string;
  on: boolean;
  /** True when this row reflects a real backend value; false = honest static preview. */
  backed: boolean;
}

// ── Data ────────────────────────────────────────────────────────────────────

export const ROOM: Room = {
  name: "Q3 Diligence",
  code: "NR7K9",
  live: 6,
  people: 4,
  agents: 2,
  costToday: "$0.03",
  version: "v41",
  event: "Healthtech Mixer",
  date: "Jun 18, 2026",
  place: "San Francisco",
};

// ── Gap-pack sample data (memory mode) ──────────────────────────────────────
// These mirror the live projections MobileAppLive builds, so the offline demo
// surface renders the same 9 gap screens as a live room.

/** Bound on trace rows surfaced to the mobile Trace sheet (agentic-reliability BOUND). */
export const MOBILE_TRACE_MAX = 40;

export const PIPELINE: PipelineStage[] = [
  { key: "intake", label: "Intake", state: "done", meta: "5 companies" },
  { key: "evidence", label: "Evidence", state: "done", meta: "11 sources" },
  { key: "draft", label: "Draft", state: "on", meta: "agent enriching" },
  { key: "review", label: "Review", state: "todo", meta: "2 waiting" },
  { key: "export", label: "Export", state: "todo", meta: "" },
];

export const TRACE_ROWS: TraceRow[] = [
  { id: "tr_1", kind: "commit", text: "committed CardioNova · v42", time: "12:33" },
  { id: "tr_2", kind: "lock", text: "locked rows 81–120", time: "12:33" },
  { id: "tr_3", kind: "cite", text: "cited crunchbase.com · funding", time: "12:32" },
  { id: "tr_4", kind: "commit", text: "committed NeuroPay · v41", time: "12:31" },
  { id: "tr_5", kind: "edit", text: "edited CardioNova · Revenue", time: "12:30" },
];

export const PEOPLE_GROUPS: ManageGroup[] = [
  { key: "host", label: "Host", rows: [{ id: "homen", name: "Homen", short: "HS", color: "#D97757", role: "host", location: "Company research · owner" }] },
  { key: "member", label: "Members", rows: [{ id: "priya", name: "Priya", short: "PR", color: "#5E6AD2", role: "member", location: "Q3 variance · editing" }] },
  { key: "guest", label: "Guests", rows: [{ id: "quokka", name: "anon · quokka", short: "qk", color: "#5B8F71", role: "guest", location: "" }] },
  { key: "agent", label: "Agents", rows: [{ id: "room_na", name: "Room NodeAgent", short: "NA", color: "#C08A5E", role: "agent", location: "enriching rows 81–120" }] },
];

/** Notification tiers — honest static in memory mode (no watches backend to read). */
export const NOTIF_ROWS: NotifRow[] = [
  { label: "@mentions of you", mode: "instant", on: true, backed: false },
  { label: "Rows you watch", mode: "instant", on: true, backed: false },
  { label: "Agent run summaries", mode: "hourly", on: true, backed: false },
  { label: "Everything else", mode: "daily digest", on: false, backed: false },
];

// The note the operator dumps. Detection runs against this after a pause.
export const SEED_NOTE: string =
  "Met Maya from CardioNova at the healthtech mixer. Possible Series B. " +
  "Ask about monthly burn and whether the hospital pilots are paid.";

// Entities + signals NodeRoom surfaces from the note.
export const DETECTED: DetectedEntity[] = [
  { icon: "building", lab: "Company", text: "CardioNova" },
  { icon: "user", lab: "Person", text: "Maya Chen" },
  { icon: "signal", lab: "Signal", text: "Series B" },
  { icon: "gap", lab: "Gap", text: "paid pilots" },
];

// Agent work plan — the approval artifact.
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

// Evidence coverage for the "Series B" claim.
export const EVIDENCE: Evidence = {
  claim: "Possible Series B",
  status: "needs_review",
  answer:
    "CardioNova appears to be raising a Series B, but the round size and lead investor are both unconfirmed. The signal rests on the company’s own deck and a single press rumor — no primary filing or term sheet has been sourced.",
  support: [
    {
      kind: "cite",
      n: "1",
      text: "“raising Series B”",
      host: "CardioNova deck · p.12",
      verified: false,
      srcType: "Pitch deck",
      date: "Q2 2026",
      url: "cardionova-deck.pdf",
      excerpt:
        "Slide 12 — “We are raising a Series B to scale to ten health systems and double the clinical team.” No round size, lead, or valuation is stated anywhere in the deck.",
    },
    {
      kind: "cite",
      n: "2",
      text: "Funding rumor, Mar 2026",
      host: "techcrunch.com",
      verified: true,
      srcType: "Press",
      date: "Mar 14, 2026",
      url: "techcrunch.com/cardionova-series-b",
      excerpt:
        "TechCrunch reported that CardioNova “is said to be in early talks for a Series B,” attributing the claim to unnamed sources. No figure, lead investor, or term sheet was confirmed.",
    },
    { kind: "gap", text: "No primary source for round size or lead investor" },
  ],
  // canned agent replies for the evidence follow-up chat (matched loosely by keyword)
  followups: [
    {
      match: ["round", "size", "how much", "amount"],
      text: "No round size is sourced yet. The deck says “raising Series B” but states no target; the TechCrunch piece is a rumor with no figure. I’d mark any number draft until a term sheet or filing lands.",
    },
    {
      match: ["lead", "investor", "who"],
      text: "The lead investor is unconfirmed. Neither source names one. Closing this needs a primary signal — a term sheet, a press release, or a direct founder confirmation.",
    },
    {
      match: ["close", "gap", "fix", "verify", "how"],
      text: "To move this to verified: attach one primary source — a signed term sheet, an SEC Form D, or a dated founder email — then re-run the evidence check. I can draft a follow-up to Maya to request it.",
    },
  ],
  fallback:
    "I only have the company deck (p.12) and a March 2026 TechCrunch rumor. Both point to a Series B but neither confirms round size or lead. Want me to open a follow-up to source a primary document?",
};

// Coach prompt — review readiness. Multiple topics; the sheet switches between them.
export const COACH: Coach = {
  topics: [
    {
      id: "runway",
      label: "Runway",
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
    },
    {
      id: "variance",
      label: "Q3 variance",
      question:
        "Walk through how the Q3 revenue variance was reconciled — and why the commit is safe to defend.",
      howto: [
        "Name the figures that moved (revenue, COGS).",
        "Point to the NetSuite export as the source of truth.",
        "Show the version bump (v41 → v42) and zero overwrites.",
        "State what a reviewer can check to trust it.",
      ],
      feedback: {
        well: "You anchored the commit to the NetSuite export.",
        missed: "You didn’t mention that null cells were preserved, not deleted.",
        cite: "Reference: Run 181 — 2 rows changed, 0 overwrites.",
        wording:
          "Q3 revenue and COGS were reconciled against the NetSuite export and committed v41 → v42 — 2 rows, 0 overwrites, nulls preserved.",
      },
    },
    {
      id: "pilots",
      label: "Paid pilots",
      question: "Explain what the paid-pilot source gap blocks — and how to close it.",
      howto: [
        "State the claim that depends on pilots (revenue confidence).",
        "Name what evidence currently exists.",
        "Identify the missing primary source.",
        "Say which action unblocks the column.",
      ],
      feedback: {
        well: "You tied pilots directly to the revenue-confidence column.",
        missed: "You didn’t specify a contract or invoice as the primary source.",
        cite: "Add the signed pilot agreement (Mercy Health) as the receipt.",
        wording:
          "The revenue-confidence column is blocked until a paid-pilot contract or invoice is attached — currently only a deck mention exists.",
      },
    },
  ],
};

// Noteworthy inbox — what triage looks like for a returning user.
// status drives the pill style: warn=action, ok=done, accent=new, mute=resolved
export const INBOX: InboxItem[] = [
  {
    id: "i_deck",
    icon: "layers",
    tone: "accent",
    title: "CardioNova investor update",
    sub: "6 slides · 1 source gap · review & export",
    status: "review",
    statusTone: "accent",
    time: "now",
    kind: "deck",
    preview: "deck",
  },
  {
    id: "i_plan",
    icon: "sparkles",
    tone: "accent",
    title: "CardioNova research plan",
    sub: "Approval needed before any web read",
    status: "approve",
    statusTone: "warn",
    time: "now",
    kind: "plan",
    preview: "doc",
  },
  {
    id: "i_gap",
    icon: "gap",
    tone: "warn",
    title: "Source gap · paid pilots",
    sub: "Blocks the revenue-confidence column",
    status: "1 gap",
    statusTone: "warn",
    time: "2m",
    kind: "evidence",
    preview: "sheet",
  },
  {
    id: "i_coach",
    icon: "coach",
    tone: "priv",
    title: "Coach prompt ready",
    sub: "Practice the CardioNova review",
    status: "review",
    statusTone: "priv",
    time: "5m",
    kind: "coach",
    preview: "chat",
  },
  {
    id: "i_done",
    icon: "checkCircle",
    tone: "ok",
    title: "NetSuite reconciliation",
    sub: "Read-only run · 4 reads · 0 writes",
    status: "done",
    statusTone: "ok",
    time: "1h",
    kind: "done",
    preview: "sheet",
  },
];

// Room pulse — live shared state.
export const PULSE: Pulse = {
  agents: [
    {
      id: "orchestrator",
      name: "Room NodeAgent",
      role: "Orchestrator",
      kind: "orch",
      status: { label: "idle", live: false },
      tone: "mute",
      dot: false,
      did: [
        {
          title: "Q3 variance commit",
          sub: "v41 → v42 · 2 rows",
          trace: "r_181",
          artifact: "sheetart",
          artifactName: "Q3 tracker",
        },
        {
          title: "NetSuite reconciliation",
          sub: "4 reads · 0 writes",
          trace: "r_182",
          artifact: "sheetart",
          artifactName: "Q3 tracker",
        },
      ],
    },
    {
      id: "research",
      name: "Research agent",
      role: "Researcher · CardioNova",
      kind: "research",
      status: { label: "running", live: true },
      tone: "accent",
      dot: true,
      did: [
        {
          title: "CardioNova research",
          sub: "read-only · running",
          trace: "r_184",
          artifact: "evidence",
          artifactName: "Funding evidence",
          live: true,
        },
        {
          title: "Enrich 3 pipeline companies",
          sub: "queued · waiting approval",
          trace: "queued",
        },
      ],
    },
  ],
  findings: [
    { icon: "table", title: "Variance committed", sub: "Revenue, COGS · v41 → v42", t: "4m" },
    { icon: "building", title: "CardioNova detected", sub: "New entity from your capture", t: "6m" },
  ],
  people: [
    { short: "HS", name: "Homen", role: "Host", color: "#D97757" },
    { short: "PR", name: "Priya", role: "Finance", color: "#5E6AD2" },
    { short: "qk", name: "anon · quokka", role: "Guest", color: "#5B8F71" },
    { short: "AV", name: "Ava", role: "Partner", color: "#B0823B" },
  ],
};

// ── Room chat (public, Slack-style multi-party feed) ────────────────────────
// who: priya | quokka | homen | room_na   kind: msg | activity | summary | artifact
export const ROOM_CHAT: RoomChatMessage[] = [
  {
    id: "m1",
    who: "priya",
    kind: "msg",
    t: "8m",
    text: "Pulling the NetSuite Q3 numbers into the variance sheet — revenue looks off vs the close.",
  },
  {
    id: "m2",
    who: "quokka",
    kind: "msg",
    t: "6m",
    text: "joined as a guest. read-only on the sheet for now?",
  },
  {
    id: "m3",
    who: "homen",
    kind: "msg",
    t: "5m",
    text: "You can edit — collaborator access is on. Getting the agent to reconcile the variance.",
  },
  {
    id: "m4",
    who: "room_na",
    kind: "status",
    t: "4m",
    text: "Reconciling Q3 revenue against the NetSuite export…",
  },
  {
    id: "m5",
    who: "room_na",
    kind: "summary",
    t: "4m",
    text: "Committed Variance for Revenue and COGS through the sync tool. Lock released.",
    stats: [
      { v: "v41→v42", l: "version" },
      { v: "2", l: "rows" },
      { v: "0", l: "overwrites" },
    ],
  },
  {
    id: "m6",
    who: "room_na",
    kind: "artifact",
    t: "4m",
    title: "Q3 variance",
    meta: "sheet · v42 · 3 collaborators",
  },
  {
    id: "m7",
    who: "priya",
    kind: "msg",
    t: "2m",
    text: "Nice. @CardioNova still needs the paid-pilot source before we trust runway.",
  },
];

// ── Agent command surface (ChatGPT-style 1:1) ───────────────────────────────
// lane: 'private' | 'room'   role: user | agent   variant: status | summary | text
export const AGENT_CHAT: AgentChat = {
  private: [
    {
      id: "a1",
      role: "user",
      text: "why should null cells survive the sync instead of being deleted?",
    },
    {
      id: "a2",
      role: "agent",
      variant: "text",
      text: "null is a real blank value, not a delete instruction. The sync tool preserves it so a retried delta can’t silently drop data. This stays private unless you promote it.",
    },
  ],
  room: [
    {
      id: "r1",
      role: "agent",
      variant: "text",
      text: "I’m the Room NodeAgent — I use room-visible context only. Ask me to research, enrich the sheet, or build evidence cards. Everything I do is proposed first.",
    },
  ],
};

export const QUICK_PROMPTS: QuickPrompt[] = [
  { icon: "search", text: "Research CardioNova funding & burn", kind: "plan" },
  { icon: "pen", text: "Draft a follow-up to Maya", kind: "draft" },
  { icon: "coach", text: "Prep me to explain runway", kind: "coach" },
  { icon: "note", text: "Summarize today’s notes", kind: "summary" },
];

// ── Agent jobs (queue + completed) ──────────────────────────────────────────
export const JOBS: Jobs = {
  running: [
    {
      id: "j1",
      title: "CardioNova research",
      sub: "read-only · by Homen",
      cost: "$0.01",
      eta: "~25s",
      route: "haiku",
      pct: 60,
      trace: "r_184",
      artifact: "evidence",
      artifactName: "Funding evidence",
    },
  ],
  queued: [
    {
      id: "j2",
      title: "Enrich 3 pipeline companies",
      sub: "waiting on approval",
      cost: "$0.04",
      eta: "queued",
      route: "sonnet",
    },
  ],
  completed: [
    {
      id: "j3",
      title: "NetSuite reconciliation",
      sub: "4 reads · 0 writes",
      cost: "$0.01",
      trace: "r_182",
      artifact: "sheetart",
      artifactName: "Q3 tracker",
    },
    {
      id: "j4",
      title: "Q3 variance commit",
      sub: "v41 → v42 · 2 rows",
      cost: "$0.01",
      trace: "r_181",
      artifact: "sheetart",
      artifactName: "Q3 tracker",
    },
  ],
};

// ── Agent run traces — step-by-step receipts (expandable + scrollable) ──────
// keyed by trace id. Each step is a discrete action with status + detail.
export const TRACES: Record<string, Trace> = {
  r_181: {
    title: "Q3 variance commit",
    agent: "Room NodeAgent",
    model: "sonnet",
    cost: "$0.01",
    duration: "18s",
    artifact: "sheetart",
    artifactName: "Q3 tracker",
    scope: "Room · approved write",
    steps: [
      {
        icon: "eye",
        kind: "read",
        title: "Read NetSuite export",
        detail: "Loaded the Q3 ledger export (read-only) — 412 rows across Revenue, COGS, OpEx.",
        status: "done",
        meta: "0.4s",
      },
      {
        icon: "table",
        kind: "read",
        title: "Matched Q3 rows to sheet",
        detail:
          "Aligned export line items to the CardioNova row in the Q3 variance sheet by account code.",
        status: "done",
        meta: "1.1s",
      },
      {
        icon: "diff",
        kind: "compute",
        title: "Computed variance",
        detail: "Revenue −$48k vs close; COGS +$12k. Two cells fall outside the ±2% tolerance.",
        status: "done",
        meta: "0.3s",
        diff: {
          row: "Q3 variance · CardioNova",
          cells: [
            { field: "Revenue", before: "$1.92M", after: "$1.87M", delta: "−$48k" },
            { field: "COGS", before: "$0.74M", after: "$0.75M", delta: "+$12k" },
          ],
        },
      },
      {
        icon: "shield",
        kind: "gate",
        title: "Proposed diff for approval",
        detail: "Surfaced v41 → v42 diff (2 rows). Held for human approval before any write.",
        status: "done",
        meta: "waited 9s",
      },
      {
        icon: "pen",
        kind: "write",
        title: "Committed 2 rows",
        detail:
          "Wrote Revenue + COGS variance. Null cells preserved, 0 overwrites. Lock released.",
        status: "done",
        meta: "0.6s",
        diff: {
          row: "Q3 variance · CardioNova",
          version: "v41 → v42",
          cells: [
            { field: "Revenue", before: "$1.92M", after: "$1.87M", delta: "−$48k" },
            { field: "COGS", before: "$0.74M", after: "$0.75M", delta: "+$12k" },
          ],
        },
      },
    ],
  },
  r_182: {
    title: "NetSuite reconciliation",
    agent: "Room NodeAgent",
    model: "haiku",
    cost: "$0.01",
    duration: "12s",
    artifact: "sheetart",
    artifactName: "Q3 tracker",
    scope: "Room · read-only",
    steps: [
      {
        icon: "link",
        kind: "read",
        title: "Connected NetSuite",
        detail: "Opened a read-only session against the Q3 close ledger.",
        status: "done",
        meta: "0.5s",
      },
      {
        icon: "eye",
        kind: "read",
        title: "Pulled 4 ledgers",
        detail: "Revenue, COGS, OpEx, Deferred — 4 reads, no writes.",
        status: "done",
        meta: "2.0s",
      },
      {
        icon: "table",
        kind: "compute",
        title: "Cross-checked the sheet",
        detail: "Compared every committed cell against the source ledger — all matched.",
        status: "done",
        meta: "1.4s",
        diff: {
          row: "Q3 variance · CardioNova",
          readonly: true,
          cells: [
            { field: "Revenue", before: "$1.87M", after: "$1.87M", delta: "match" },
            { field: "COGS", before: "$0.75M", after: "$0.75M", delta: "match" },
          ],
        },
      },
      {
        icon: "checkCircle",
        kind: "gate",
        title: "Verified 0 overwrites",
        detail: "No silent deletes; all blanks preserved as null. Produced a reconciliation report.",
        status: "done",
        meta: "0.3s",
      },
    ],
  },
  r_184: {
    title: "CardioNova research",
    agent: "Research agent",
    model: "haiku",
    cost: "$0.01",
    duration: "~25s",
    artifact: "evidence",
    artifactName: "Funding evidence",
    scope: "Room · read-only",
    running: true,
    steps: [
      {
        icon: "note",
        kind: "read",
        title: "Read capture note",
        detail: "Parsed your CardioNova note for entities and claims.",
        status: "done",
        meta: "0.4s",
      },
      {
        icon: "building",
        kind: "read",
        title: "Fetched cached profile",
        detail: "Loaded the company profile (refreshed < 2h).",
        status: "done",
        meta: "0.6s",
      },
      {
        icon: "search",
        kind: "read",
        title: "Searching public sources",
        detail: "Scanning funding + pilot coverage for primary confirmation…",
        status: "running",
        meta: "now",
      },
      {
        icon: "shield",
        kind: "gate",
        title: "Build evidence cards",
        detail: "Will attach source-backed citations and flag gaps.",
        status: "pending",
      },
      {
        icon: "diff",
        kind: "gate",
        title: "Propose row diff",
        detail: "Will surface a proposed CardioNova row — no write until approved.",
        status: "pending",
      },
    ],
  },
};

// ── Files / artifacts (lightweight mobile access) ───────────────────────────
export const FILES: FileItem[] = [
  {
    id: "deck_cn",
    icon: "layers",
    name: "CardioNova investor update",
    meta: "deck · 6 slides · proposed",
    tone: "accent",
    kind: "deck",
  },
  {
    id: "sheet_q3",
    icon: "table",
    name: "Q3 variance",
    meta: "sheet · v42 · 3 collaborators",
    tone: "mute",
    kind: "sheet",
  },
  {
    id: "note_sync",
    icon: "note",
    name: "Sync reliability",
    meta: "note · edited 2m ago",
    tone: "mute",
    kind: "note",
  },
  {
    id: "wall",
    icon: "target",
    name: "Diligence wall",
    meta: "wall · 6 notes",
    tone: "mute",
    kind: "wall",
  },
  {
    id: "doc_ns",
    icon: "file",
    name: "NetSuite export",
    meta: "source · read-only",
    tone: "mute",
    kind: "source",
  },
];

// CardioNova row card — the mobile spreadsheet pattern (cards, not a grid)
export const ROW: RowCard = {
  entity: "CardioNova",
  sub: "healthtech · row in Q3 variance",
  fields: [
    { k: "Product", v: "AI triage for hospitals", status: "partial", tone: "warn" },
    { k: "Funding", v: "Possible Series B", status: "needs_review", tone: "warn" },
    { k: "Runway", v: "Unknown", status: "source gap", tone: "bad" },
    { k: "Contact", v: "Maya Chen", status: "manual note", tone: "mute" },
  ],
};

// ── Governed spreadsheet artifact (the grid twin of the deck workbench) ────
// Full grid · tap-a-cell to comment · agent proposes a sourced cell patch ·
// evidence per claim · planned-vs-actual export. Status drives the cell tone:
//   ok = source-backed · warn = needs_review/partial · bad = source gap · mute = manual
export const SHEET: Sheet = {
  id: "sheet_q3",
  title: "Q3 diligence tracker",
  sub: "sheet · v42 · Room",
  privacy: "Room",
  version: "v42",
  exportFormat: "XLSX",
  exportSize: "1.1 MB",
  sourceGaps: 2,
  columns: [
    { id: "company", label: "Company", w: 132, head: true },
    { id: "product", label: "Product", w: 196 },
    { id: "funding", label: "Funding", w: 150 },
    { id: "runway", label: "Runway", w: 104 },
    { id: "arr", label: "Q3 ARR", w: 96, mono: true },
    { id: "contact", label: "Contact", w: 124 },
  ],
  rows: [
    {
      id: "r_cardio",
      cells: {
        company: { v: "CardioNova" },
        product: { v: "AI triage for hospitals", status: "partial", tone: "warn" },
        funding: { v: "Possible Series B", status: "needs_review", tone: "warn", claim: "funding" },
        runway: { v: "Unknown", status: "source gap", tone: "bad", claim: "runway" },
        arr: { v: "$1.2M", status: "source-backed", tone: "ok" },
        contact: { v: "Maya Chen", status: "manual note", tone: "mute" },
      },
    },
    {
      id: "r_meridian",
      cells: {
        company: { v: "Meridian Health" },
        product: { v: "Remote cardiac monitoring", status: "source-backed", tone: "ok" },
        funding: { v: "Series A · $14M", status: "source-backed", tone: "ok" },
        runway: { v: "18 mo", status: "source-backed", tone: "ok" },
        arr: { v: "$3.4M", status: "source-backed", tone: "ok" },
        contact: { v: "Devon Park", status: "source-backed", tone: "ok" },
      },
    },
    {
      id: "r_vitalink",
      cells: {
        company: { v: "Vitalink" },
        product: { v: "EHR integration layer", status: "source-backed", tone: "ok" },
        funding: { v: "Seed · $3M", status: "needs_review", tone: "warn" },
        runway: { v: "Unknown", status: "source gap", tone: "bad" },
        arr: { v: "$0.4M", status: "partial", tone: "warn" },
        contact: { v: "Lena Ortiz", status: "manual note", tone: "mute" },
      },
    },
  ],
  // agent's read-only plan to enrich the sheet
  plan: {
    goal: "Fill the source gaps in the Q3 tracker without overwriting anyone’s manual cells.",
    todos: [
      { text: "Read the NetSuite export + cached company profiles", status: "done" },
      { text: "Reconcile Q3 ARR against the close (v41 → v42)", status: "done" },
      { text: "Propose CardioNova runway from cash ÷ burn", status: "running" },
      { text: "Source Vitalink seed round size & lead", status: "todo" },
      { text: "Flag every unsourced cell for review", status: "todo" },
    ],
    ran: 4,
    guard: "Read-only run · proposes diffs, never writes a cell without approval.",
  },
  // localized patch the agent proposes when you comment on a flagged cell
  patchSample: {
    target: "CardioNova · Runway",
    before: "Unknown",
    after: "~9 months",
    evidence: [
      { n: "1", text: "NetSuite cash balance — $4.1M, Q3 close", verified: true },
      { n: "2", text: "Monthly burn ≈ $0.45M (deck p.14)", verified: false },
    ],
  },
  // per-claim evidence (sourced answers, perplexity-style)
  claims: {
    funding: {
      claim: "CardioNova · Possible Series B",
      answer:
        "CardioNova appears to be raising a Series B, but the round size and lead are unconfirmed — the signal rests on the company’s own deck and a single press rumor.",
      support: [
        {
          kind: "cite",
          n: "1",
          text: "“raising Series B”",
          host: "CardioNova deck · p.12",
          verified: false,
        },
        { kind: "cite", n: "2", text: "Funding rumor, Mar 2026", host: "techcrunch.com", verified: true },
        { kind: "gap", text: "No primary source for round size or lead investor" },
      ],
    },
    runway: {
      claim: "CardioNova · Runway",
      answer:
        "Runway can be derived as cash ÷ burn: ~$4.1M ÷ ~$0.45M ≈ 9 months. The cash figure is confirmed from NetSuite; the burn rate is still a deck estimate, so the result is a draft until burn is sourced.",
      support: [
        {
          kind: "cite",
          n: "1",
          text: "NetSuite cash balance — $4.1M",
          host: "Q3 close export",
          verified: true,
        },
        {
          kind: "cite",
          n: "2",
          text: "Monthly burn ≈ $0.45M",
          host: "CardioNova deck · p.14",
          verified: false,
        },
        { kind: "gap", text: "No confirmed monthly burn — figure is a deck estimate" },
      ],
    },
  },
  followups: [
    {
      match: ["burn", "monthly"],
      text: "The only burn figure is a deck estimate (~$0.45M/mo, p.14). To confirm it I’d need the NetSuite P&L for the trailing quarter — want me to open a follow-up to request it?",
    },
    {
      match: ["round", "size", "lead", "investor"],
      text: "Neither source names a round size or lead. Closing this needs a primary signal — a term sheet, an SEC Form D, or a direct founder confirmation.",
    },
    {
      match: ["close", "gap", "fix", "verify", "how"],
      text: "To clear the gaps: attach the NetSuite P&L for burn and a primary funding document for the round. I can draft both requests and re-run the check inside the approved scope.",
    },
  ],
  fallback:
    "I’m working from the NetSuite export and the cached company profiles only. Two cells stay flagged until a primary source lands — ask me to source either one.",
  receipt: {
    reads: { planned: 5, actual: 6 },
    writes: { planned: 0, actual: 0 },
    cost: { planned: "$0.01", actual: "$0.02" },
    coverage: "12 / 18 cells source-backed",
    gaps: ["CardioNova runway — needs confirmed burn", "Vitalink seed round — size & lead"],
    files: ["Q3_diligence_tracker.xlsx (1.1 MB)", "CSV export (18 rows)"],
  },
  versions: [
    { v: "v42", label: "Q3 ARR reconciled vs close", t: "just now", current: true },
    { v: "v41", label: "CardioNova row added", t: "12m ago" },
    { v: "v40", label: "Imported NetSuite export", t: "1h ago" },
  ],
};

// Structured extraction derived from the note — one object, not loose chips.
// Re-derived on each rescan so the panel can diff + swap only what changed.
export function deriveExtraction(note: string): Extraction {
  const s = (note || "").toLowerCase();
  const groups: ExtractionGroup[] = [];
  groups.push({
    id: "entity",
    label: "Entity",
    rows: [
      { k: "company", v: "CardioNova", conf: 0.98 },
      { k: "person", v: "Maya Chen", conf: 0.92 },
      { k: "sector", v: "healthtech", conf: 0.86 },
    ],
  });
  if (/series b|funding|raise|raising|round/.test(s))
    groups.push({
      id: "funding",
      label: "Funding signal",
      flag: true,
      rows: [
        { k: "round", v: "Series B", conf: 0.64 },
        { k: "status", v: "needs_review", conf: 0.6, mono: true },
        { k: "source", v: "deck p.12", conf: 0.55 },
      ],
    });
  const open: ExtractionRow[] = [];
  if (/burn/.test(s)) open.push({ k: "monthly burn", v: "unknown", conf: 0 });
  if (/pilot/.test(s)) open.push({ k: "paid pilots", v: "unknown", conf: 0 });
  if (/next week|follow.?up|following up/.test(s))
    open.push({ k: "follow-up", v: "next week", conf: 0.8 });
  if (open.length) groups.push({ id: "open", label: "Open questions", flag: true, rows: open });
  return { entity: "CardioNova", groups };
}

// ── Governed deck artifact (the workroom vertical slice) ───────────────────
// Structured deck plan is the source of truth; the html below is a *render*.
export const slideDoc = (body: string): string =>
  '<!doctype html><html><head><meta charset="utf-8">' +
  "<style>" +
  '@import url("https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=DM+Serif+Display&display=swap");' +
  "*{margin:0;box-sizing:border-box}" +
  "html,body{width:960px;height:600px;overflow:hidden}" +
  'body{font-family:"DM Sans",system-ui,sans-serif;background:#FBF4E7;color:#2B1D14;padding:58px 64px;display:flex;flex-direction:column;-webkit-font-smoothing:antialiased}' +
  ".k{font-size:18px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#C56A3C}" +
  'h1{font-family:"DM Serif Display",Georgia,serif;font-weight:400;letter-spacing:-.5px;line-height:1.04}' +
  ".big{font-size:92px}.mid{font-size:56px}" +
  "p{font-size:27px;line-height:1.5;color:#5C4938}" +
  ".spacer{flex:1}" +
  ".foot{font-size:18px;color:#A89378;display:flex;gap:10px;align-items:center}" +
  ".dot{width:5px;height:5px;border-radius:50%;background:#C8B89E}" +
  ".badge{display:inline-flex;align-items:center;gap:8px;font-size:18px;font-weight:700;padding:7px 15px;border-radius:999px}" +
  ".nr{background:#FBEFD8;color:#9C6418;border:1px solid #F0CB8E}" +
  ".ok{background:#EEF3E0;color:#4A6128;border:1px solid #C5D89E}" +
  '.stat{font-family:"DM Serif Display",serif;font-size:68px;color:#2B1D14}' +
  ".row{display:flex;gap:40px}" +
  ".cite{font-size:18px;color:#C56A3C;font-weight:700;vertical-align:super}" +
  "ul{margin:0;padding-left:26px}li{font-size:27px;line-height:1.65;color:#5C4938}" +
  "</style></head><body>" +
  body +
  "</body></html>";

export const DECK: Deck = {
  id: "deck_cn",
  title: "CardioNova investor update",
  audience: "Investor",
  status: "proposed", // draft | proposed | approved | exported
  planHash: "p_8f21",
  privacy: "Room",
  exportState: "ready", // not_started | ready | failed
  exportFormat: "PPTX",
  exportSize: "7.7 MB",
  sourceGaps: 1,
  plan: {
    goal: "Turn the Q3 diligence room into an investor-ready CardioNova update.",
    todos: [
      { text: "Read capture notebook + CardioNova row", status: "done" },
      { text: "Pull evidence cards & public source captures", status: "done" },
      { text: "Draft investor deck preview (6 slides)", status: "running" },
      { text: "Attach source-backed case-study slide", status: "todo" },
      { text: "Generate planned-vs-actual receipt", status: "todo" },
    ],
    ran: 4,
    guard: "Read-only run · won’t edit notebook text or sheet cells without approval.",
    willRead: ["Capture notebook", "CardioNova row · Q3 sheet", "Evidence cards", "Public source captures"],
    willCreate: ["10-slide HTML deck preview", "Source-backed case-study slide", "Planned-vs-actual receipt"],
    wontWrite: ["Human-owned notebook text", "Sheet cells without approval"],
    stats: [
      { v: "4", l: "planned reads", mono: false },
      { v: "0", l: "writes (preview only)", mono: false },
      { v: "$0.01", l: "est. cost", mono: true },
      { v: "10", l: "slides", mono: false },
    ],
  },
  slides: [
    {
      id: "s01",
      index: 1,
      title: "Cover",
      status: "approved",
      html: slideDoc(
        '<div class="k">Investor update · Q3 2026</div><div class="spacer"></div>' +
          '<h1 class="big">CardioNova</h1><p style="margin-top:14px;max-width:80%">AI triage that gives emergency departments back their first golden hour.</p>' +
          '<div class="spacer"></div><div class="foot"><span>Prepared by NodeRoom</span><span class="dot"></span><span>Confidential</span></div>',
      ),
    },
    {
      id: "s02",
      index: 2,
      title: "Problem",
      status: "approved",
      html: slideDoc(
        '<div class="k">The problem</div><div class="spacer"></div>' +
          '<h1 class="mid">ED triage still runs on gut feel and paper.</h1>' +
          '<ul style="margin-top:18px"><li>Median time-to-triage: 38 minutes</li><li>Mis-prioritization drives avoidable admissions</li><li>Nurses re-key the same vitals 3× per visit</li></ul><div class="spacer"></div>',
      ),
    },
    {
      id: "s03",
      index: 3,
      title: "Traction",
      status: "approved",
      html: slideDoc(
        '<div class="k">Traction</div><div class="spacer"></div>' +
          '<div class="row"><div><div class="stat">2</div><p>paid hospital pilots</p></div><div><div class="stat">31%</div><p>faster triage</p></div><div><div class="stat">2</div><p>systems in procurement</p></div></div>' +
          '<div class="spacer"></div><span class="badge ok">source-backed</span>',
      ),
    },
    {
      id: "s04",
      index: 4,
      title: "Funding",
      status: "needs_review",
      html: slideDoc(
        '<div class="k">Funding</div><div class="spacer"></div>' +
          '<h1 class="mid">Raising a Series B<span class="cite">1</span></h1>' +
          '<p style="margin-top:14px">Round size and lead investor are unconfirmed. Runway depends on a monthly burn figure we have not yet sourced.</p>' +
          '<div class="spacer"></div><span class="badge nr">needs_review · 1 source gap</span>',
      ),
    },
    {
      id: "s05",
      index: 5,
      title: "Case study",
      status: "draft",
      region: true,
      html: slideDoc(
        '<div class="k">Founder story</div><div class="spacer"></div>' +
          '<h1 class="mid" id="region">AI triage that hospitals love — a generational platform shift.</h1>' +
          '<p style="margin-top:14px">Maya started CardioNova after watching triage fail her own family in an overcrowded ED.</p>' +
          '<div class="spacer"></div><span class="badge nr">draft · not source-backed</span>',
      ),
    },
    {
      id: "s06",
      index: 6,
      title: "The ask",
      status: "approved",
      html: slideDoc(
        '<div class="k">The ask</div><div class="spacer"></div>' +
          '<h1 class="mid">Partner with us on the next two health systems.</h1>' +
          '<ul style="margin-top:18px"><li>Confirm Series B terms by end of Q3</li><li>Intro to two academic medical centers</li><li>Operating support for procurement</li></ul><div class="spacer"></div>',
      ),
    },
  ],
  // localized patch the agent proposes for the founder-story region
  patchSample: {
    target: "Slide 5 · headline",
    before: "AI triage that hospitals love — a generational platform shift.",
    after: "Cut ED triage time 31% across two paid pilots (Mercy Health, Q1–Q2 2026); two systems now in procurement.",
    evidence: [
      { n: "1", text: "Pilot report — Mercy Health, Apr 2026", verified: true },
      { n: "2", text: "Procurement thread, May 2026", verified: false },
    ],
  },
  // planned-vs-actual receipt produced after the run
  receipt: {
    reads: { planned: 4, actual: 5 },
    writes: { planned: 0, actual: 0 },
    cost: { planned: "$0.01", actual: "$0.02" },
    coverage: "8 / 10 claims source-backed",
    gaps: ["Runway denominator — monthly burn", "Series B round size & lead"],
    files: ["10 HTML slide previews", "CardioNova_update.pptx (7.7 MB)"],
  },
  versions: [
    { v: "v3", label: "Source-backed case study added", t: "just now", current: true },
    { v: "v2", label: "Funding slide flagged needs_review", t: "12m ago" },
    { v: "v1", label: "Initial 6-slide draft", t: "34m ago" },
  ],
};

// Revision constraint sliders (segmented controls) — privacy comes from scope pill.
export const REVISION_CONTROLS: RevisionControl[] = [
  { id: "tone", label: "Tone", options: ["Analyst", "VP", "Client"], def: 1 },
  { id: "evidence", label: "Evidence", options: ["Draft", "Source-backed", "Client-ready"], def: 1 },
  { id: "density", label: "Density", options: ["Concise", "Detailed"], def: 0 },
  { id: "risk", label: "Risk", options: ["Conservative", "Balanced", "Aggressive"], def: 1 },
];

// ── Home: recents + favorites (Notion-style library) ───────────────────────
export const RECENTS: RecentItem[] = [
  {
    id: "r_deck",
    icon: "layers",
    title: "CardioNova investor update",
    meta: "deck · 6 slides · review",
    kind: "deck",
    peek: "AI triage that gives EDs back their first golden hour.",
    sig: { type: "deck", count: 6, active: 2, status: "review" },
  },
  {
    id: "r_sheet",
    icon: "table",
    title: "CardioNova sheet",
    meta: "v42 · 2 to review",
    kind: "sheet",
    peek: "Funding · Series B (needs_review) · Runway · unknown",
    sig: { type: "sheet", cells: ["ok", "ok", "ok", "ok", "warn", "ok", "ok", "ok", "gap"] },
  },
  {
    id: "r_plan",
    icon: "sparkles",
    title: "CardioNova work plan",
    meta: "Read-only · est. $0.01",
    kind: "plan",
    peek: "Will read 4 · write 0 · propose row + evidence",
    sig: {
      type: "plan",
      todos: [
        { t: "Read 4 approved sources", s: "done" },
        { t: "Propose Runway cell", s: "run" },
        { t: "Attach evidence", s: "todo" },
      ],
    },
  },
  {
    id: "r_evid",
    icon: "file",
    title: "Funding evidence",
    meta: "2 sources · 1 gap",
    kind: "evidence",
    peek: "“raising Series B” — deck p.12 · TechCrunch Mar 2026",
    sig: { type: "evidence", quote: "raising Series B", sources: ["deck p.12", "TechCrunch · Mar 2026"], gap: 1 },
  },
];

export const FAVORITES: FavoriteItem[] = [
  {
    id: "f_room",
    icon: "room",
    tone: "accent",
    title: "Q3 Diligence room",
    meta: "6 live · 2 agents",
    kind: "room",
    sig: { label: "6 live", dot: true },
  },
  {
    id: "f_co",
    icon: "table",
    tone: "mute",
    title: "CardioNova company sheet",
    meta: "v42 · 2 fields to review",
    kind: "sheet",
    sig: { label: "2 review" },
  },
  {
    id: "f_deck",
    icon: "layers",
    tone: "accent",
    title: "CardioNova investor update",
    meta: "deck · 6 slides · proposed",
    kind: "deck",
    sig: { label: "proposed" },
  },
  {
    id: "f_ev",
    icon: "file",
    tone: "warn",
    title: "Funding evidence card",
    meta: "2 sources · 1 gap",
    kind: "evidence",
    sig: { label: "1 gap" },
  },
  {
    id: "f_note",
    icon: "note",
    tone: "mute",
    title: "Sync reliability note",
    meta: "edited 2m ago",
    kind: "note",
    sig: { label: "2m", quiet: true },
  },
];

// ── Briefings: top coachable explanations (approachable framing) ───────────
export const BRIEFINGS: Briefing[] = [
  { id: "b_runway", icon: "coach", title: "Why CardioNova runway is needs_review", meta: "funding · 2 min", level: "Sharpen" },
  { id: "b_variance", icon: "coach", title: "Defending the Q3 variance commit", meta: "reconciliation · 3 min", level: "Ready" },
  { id: "b_pilots", icon: "coach", title: "What the paid-pilot gap blocks", meta: "revenue · 2 min", level: "Sharpen" },
];

export const ROOMS: RoomEntry[] = [
  { id: "q3", name: "Q3 Diligence", code: "NR7K9", role: "Host", people: 4, agents: 2, live: true, pending: 4 },
  { id: "cardio", name: "CardioNova deal", code: "CN4B2", role: "Member", people: 6, agents: 1, live: true, pending: 1 },
  { id: "fund", name: "Fund ops", code: "FO8X1", role: "Member", people: 3, agents: 1, live: false, pending: 0 },
];

// Turn an internal trace/plan id into a human-facing label.
//   r_184 → "Run 184"   ·   queued → "Queued"   ·   p_8f21 → "Plan 8f21"
export function refLabel(id: string | null | undefined): string {
  if (!id) return "—";
  const m = /^r_(\d+)$/.exec(id);
  if (m) return "Run " + m[1];
  if (id === "queued") return "Queued";
  const p = /^p_([a-z0-9]+)$/i.exec(id);
  if (p) return "Plan " + p[1];
  return id;
}

// People directory (keyed by chat author id).
export const PEOPLE: Record<string, Person> = {
  priya: { short: "PR", name: "Priya", color: "#5E6AD2" },
  quokka: { short: "qk", name: "anon · quokka", color: "#5B8F71" },
  homen: { short: "HS", name: "Homen", color: "#D97757" },
  room_na: { short: "NA", name: "Room NodeAgent", color: "#C08A5E", agent: true },
};
