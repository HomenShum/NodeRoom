/**
 * storyTape.ts — the single source of truth for the NodeRoom story landing page.
 *
 * The landing page teaches ONE idea in seven progressively deeper layers:
 *
 *   NodeRoom feels like Excel locally, coordinates like a live room, lets agents
 *   work in branches, and commits shared truth only through evidence-backed CAS
 *   + semantic rebase.
 *
 * Everything visual is DATA-DRIVEN from this file (no per-animation React
 * spaghetti). The same `EVENT_TAPE` is the contract the brief calls Milestone 3:
 * render it into (a) this landing animation, (b) the README GIF, (c) a Remotion
 * video, and (d) an E2E visual proof. Keep it declarative.
 *
 * CLAIM DISCIPLINE — every layer is tagged `shipped` or `target`:
 *   shipped  = there is production code behind it today (audited against the repo)
 *   target   = it is the June-2026 target architecture, not yet production
 * Layers 1 (optimistic UI), 2 (spreadsheet presence), 5 (per-element CAS), and
 * 7 (commit lease / lock TTL) are shipped. Layers 3 (narration pane), 4 (agent
 * scratchpad UI), and 6 (LLM semantic rebase) are target. We do not pretend
 * otherwise — that honesty is the product story, not a footnote.
 */

export type ActorKind = "human" | "agent";

export interface Actor {
  id: string;
  name: string;
  color: string;
  kind: ActorKind;
}

/** Active-edit signal color — distinct from member identity colors so "someone is
 *  editing here" reads at a glance regardless of whose avatar it is. */
export const PRESENCE_COLOR = "#a78bfa";

/** Real demo-room members (from src/engine/demoRoom.ts). */
export const MEMBERS: Actor[] = [
  { id: "u_homen", name: "Homen", color: "#d97757", kind: "human" },
  { id: "u_priya", name: "Priya", color: "#5b9bf5", kind: "human" },
  { id: "u_guest", name: "quokka", color: "#7bd089", kind: "human" },
];

export const AGENTS: Actor[] = [
  { id: "agent_room", name: "Room NodeAgent", color: "#d97757", kind: "agent" },
  { id: "agent_priv", name: "Finance Agent", color: "#8C92E0", kind: "agent" },
];

// ── The shared artifact: the real "Q3 variance" sheet ──────────────────────────
// Columns A–E. Row 1 is the header. Values are the exact demo figures.
export const COLUMNS = ["A", "B", "C", "D", "E"] as const;

export interface GridCell {
  ref: string;
  display: string;
  formula?: string;
  numeric?: boolean;
  evidence?: string; // evidence badge label, if any
  muted?: boolean; // header / label styling
}

/** Base grid the spreadsheet scene renders. Variance column = Q3 − Q2. */
export const GRID: GridCell[][] = [
  [
    { ref: "A1", display: "Q3 model", muted: true },
    { ref: "B1", display: "Q2", muted: true, numeric: true },
    { ref: "C1", display: "Q3", muted: true, numeric: true },
    { ref: "D1", display: "Variance", muted: true, numeric: true },
    { ref: "E1", display: "Note", muted: true },
  ],
  [
    { ref: "A2", display: "Revenue" },
    { ref: "B2", display: "10,000", numeric: true },
    { ref: "C2", display: "12,400", numeric: true, evidence: "Source row 18" },
    { ref: "D2", display: "2,400", numeric: true, formula: "=C2-B2", evidence: "computed" },
    { ref: "E2", display: "" },
  ],
  [
    { ref: "A3", display: "COGS" },
    { ref: "B3", display: "4,000", numeric: true },
    { ref: "C3", display: "5,100", numeric: true },
    { ref: "D3", display: "1,100", numeric: true, formula: "=C3-B3" },
    { ref: "E3", display: "" },
  ],
  [
    { ref: "A4", display: "Gross profit" },
    { ref: "B4", display: "6,000", numeric: true },
    { ref: "C4", display: "7,300", numeric: true },
    { ref: "D4", display: "1,300", numeric: true, formula: "=C4-B4" },
    { ref: "E4", display: "" },
  ],
  [
    { ref: "A5", display: "OpEx" },
    { ref: "B5", display: "2,200", numeric: true },
    { ref: "C5", display: "2,650", numeric: true },
    { ref: "D5", display: "450", numeric: true, formula: "=C5-B5" },
    { ref: "E5", display: "" },
  ],
  [
    { ref: "A6", display: "Net income" },
    { ref: "B6", display: "3,800", numeric: true },
    { ref: "C6", display: "4,650", numeric: true },
    { ref: "D6", display: "850", numeric: true, formula: "=C6-B6" },
    { ref: "E6", display: "" },
  ],
];

// ── Per-cell overlay state a layer can apply to the grid ───────────────────────
export interface CellOverlay {
  presence?: string; // color of the active-edit ring (human intent)
  presenceLabel?: string; // e.g. "Homen editing"
  agentLane?: boolean; // part of the agent's analysis range
  editing?: boolean; // in edit mode (caret + input look)
  protectedGlow?: boolean; // human-active cell the agent must avoid
  cas?: "pass" | "conflict"; // CAS flash result
  committed?: boolean; // just committed (green pulse)
  proposed?: boolean; // routed to review (amber)
  leased?: boolean; // inside the short commit lease window
  badge?: string; // tiny badge text on the cell, e.g. "local draft", "v43"
  override?: string; // override the displayed value for this scene
}

export type LayerStatus = "shipped" | "target";

/** Which bespoke floating visual a layer overlays beside the grid. */
export type LayerVisualKind =
  | "optimistic"
  | "presence"
  | "stream"
  | "branch"
  | "cas"
  | "rebase"
  | "lease";

export interface LayerSpec {
  id: LayerVisualKind;
  index: number; // 1..7
  kicker: string; // short "Layer N — …" eyebrow
  title: string; // headline
  copy: string; // one human sentence
  status: LayerStatus;
  /** Honest one-liner on exactly what is / isn't real today. */
  truth: string;
  /** Tiny runtime diagram (behind-the-scenes caption), rendered monospace. */
  diagram: string[];
  /** Grid overlays this layer applies, keyed by cell ref. */
  cells: Record<string, CellOverlay>;
  /** Signal-tape + status-strip copy for this layer (matches the real shell). */
  tape: string;
  status_strip: { kind: "ok" | "warn" | "err"; text: string };
}

// The seven layers. Copy is grounded in the repo audit; status is honest.
export const LAYERS: LayerSpec[] = [
  {
    id: "optimistic",
    index: 1,
    kicker: "Layer 1 — Local optimistic UI",
    title: "The human never waits.",
    copy: "Type first, sync second. Your cell paints instantly while the server commits safely behind it.",
    status: "shipped",
    truth: "Shipped: Convex optimistic updates paint locally, then reconcile with the server-authoritative commit.",
    diagram: ["browser workbook", "→ local dirty overlay", "→ Convex mutation", "→ CAS commit", "→ reactive sync"],
    cells: {
      C2: { editing: true, presence: PRESENCE_COLOR, badge: "local draft", override: "12,400" },
    },
    tape: "C2 local draft",
    status_strip: { kind: "ok", text: "C2 committed v42 → v43" },
  },
  {
    id: "presence",
    index: 2,
    kicker: "Layer 2 — Ephemeral presence",
    title: "The room knows where people are.",
    copy: "Before an agent writes, it sees human intent. Soft signal, not a database lock — you keep typing.",
    status: "shipped",
    truth: "Shipped: spreadsheet focus/edit presence is a bounded, advisory runtime signal. No-clobber is still enforced by CAS (Layer 5), not presence.",
    diagram: ["active-edit signal", "→ avoid / wait / draft / propose"],
    cells: {
      // Agent is analysing the A1:C5 block; C2 is the active human cell it must avoid.
      A2: { agentLane: true }, B2: { agentLane: true },
      A3: { agentLane: true }, B3: { agentLane: true }, C3: { agentLane: true },
      A4: { agentLane: true }, B4: { agentLane: true }, C4: { agentLane: true },
      A5: { agentLane: true }, B5: { agentLane: true }, C5: { agentLane: true },
      C2: { presence: PRESENCE_COLOR, presenceLabel: "Homen editing", protectedGlow: true, agentLane: true, override: "12,400" },
    },
    tape: "Finance Agent reading A1:C5",
    status_strip: { kind: "ok", text: "Homen editing C2 · agent holding off" },
  },
  {
    id: "stream",
    index: 3,
    kicker: "Layer 3 — Persistent text streaming",
    title: "Agents feel alive, without spamming the sheet.",
    copy: "The agent streams its reasoning as tokens, persists it, and lets collaborators catch up — the grid is never rewritten token-by-token.",
    status: "target",
    truth: "Target: a dedicated narration pane (owner sees tokens, others see persisted sentences). The streaming primitive exists; the pane is target UI.",
    diagram: ["provider stream", "→ Convex HTTP action", "→ owner token stream", "→ persisted body", "→ observer chunks"],
    cells: {},
    tape: "Finance Agent · streaming",
    status_strip: { kind: "ok", text: "Agent narrating — sheet unchanged" },
  },
  {
    id: "branch",
    index: 4,
    kicker: "Layer 4 — Agent branch / scratchpad",
    title: "Agents work off to the side.",
    copy: "Long-running agent work never holds the live sheet hostage. The agent snapshots, reasons, and drafts a patch bundle in a branch.",
    status: "target",
    truth: "Target UI, built on a shipped primitive: a blocked agent already drafts around a lock and smart-merges on release. The visible branch pane is the target.",
    diagram: ["snapshot v43", "→ scratchpad", "→ patch bundle", "→ rebase later"],
    cells: {
      C2: { presence: PRESENCE_COLOR, presenceLabel: "Homen", override: "12,400" },
    },
    tape: "Agent draft branch · base v43",
    status_strip: { kind: "ok", text: "Agent drafting safe patch · human still editing" },
  },
  {
    id: "cas",
    index: 5,
    kicker: "Layer 5 — Compare-and-swap",
    title: "No stale write gets through.",
    copy: "CAS asks one narrow question: did this cell change since the agent read it? If yes, the write stops — returned as data, never a silent overwrite.",
    status: "shipped",
    truth: "Shipped & core: every element carries a per-element version. App-level CAS (not just Convex OCC) rejects a stale-baseline write and returns the conflict as data.",
    diagram: ["read version", "→ propose write", "→ compare baseVersion", "→ swap only if unchanged"],
    cells: {
      D2: { cas: "pass", committed: true, badge: "v7 → v8", override: "2,400" },
    },
    tape: "D2 committed v7 → v8 · CAS pass",
    status_strip: { kind: "ok", text: "D2 committed v7 → v8 · no clobber" },
  },
  {
    id: "rebase",
    index: 6,
    kicker: "Layer 6 — Semantic rebase",
    title: "Conflicts become reviewable judgment.",
    copy: "CAS catches the conflict; semantic rebase explains it. Both edits can be useful — here's how they fit, and what still needs review.",
    status: "target",
    truth: "Target: the conflict-packet pipeline is shipped & durable — on a stale agent write it builds a packet, classifies it deterministically (version + equality + authorship), persists it to a ledger, and routes it to a host-review proposal. The LLM resolver — semantic judgment beyond those rules — is the next chapter.",
    diagram: ["base + current + proposed", "+ task intent + evidence", "→ safe resolution proposal"],
    cells: {
      C2: { proposed: true, presence: PRESENCE_COLOR, override: "12,400" },
    },
    tape: "1 proposal awaiting review",
    status_strip: { kind: "warn", text: "1 agent proposal awaiting review" },
  },
  {
    id: "lease",
    index: 7,
    kicker: "Layer 7 — Short commit lease",
    title: "The final write window is tiny.",
    copy: "No long pessimistic locks. A short lease covers only the exact publish targets, then releases — and auto-expires if an agent ever crashes.",
    status: "shipped",
    truth: "Shipped: locks claim an affected range, write under CAS, release in finally, and carry a lease TTL so a crashed holder never blocks a cell forever.",
    diagram: ["validated patch", "→ short target lease", "→ CAS commit", "→ release", "→ trace / proof / status"],
    cells: {
      D2: { leased: true, committed: true, override: "2,400" },
      E2: { leased: true, committed: true, override: "footnote" },
    },
    tape: "commit lease · D2, E2, Memo:Risk",
    status_strip: { kind: "ok", text: "Applied · released · trace written" },
  },
];

// ── Final proof board ──────────────────────────────────────────────────────────
export interface ProofRow {
  source: string;
  output: string;
  proof: string;
}

export const PROOF_ROWS: ProofRow[] = [
  { source: "Q3 Revenue 12,400", output: "C2 = 12,400", proof: "Exact digits" },
  { source: "Q2 Revenue 10,000", output: "D2 = C2-B2 = 2,400", proof: "Formula" },
  { source: "Source row 18", output: "Evidence badge", proof: "Citation" },
  { source: "Human edited C2", output: "C2 preserved", proof: "No clobber · CAS" },
  { source: "Agent branch v43", output: "Patch committed v47", proof: "Trace" },
];

// ── Canonical event tape (Milestone 3 contract) ────────────────────────────────
// One declarative timeline. Render it into the landing animation, the README GIF,
// a Remotion video, and an E2E visual proof — one source of truth, four surfaces.
export type LandingEvent =
  | { t: number; kind: "select_cell"; cell: string; actor: string }
  | { t: number; kind: "type_local"; cell: string; value: string }
  | { t: number; kind: "presence"; cell: string; actor: string; state: "editing" }
  | { t: number; kind: "agent_stream"; text: string }
  | { t: number; kind: "branch_patch"; target: string; value: string }
  | { t: number; kind: "cas_check"; cell: string; base: number; current: number; result: "pass" | "conflict" }
  | { t: number; kind: "semantic_resolution"; summary: string }
  | { t: number; kind: "commit_lease"; cells: string[]; ms: number }
  | { t: number; kind: "status"; text: string };

export const EVENT_TAPE: LandingEvent[] = [
  { t: 0.0, kind: "select_cell", cell: "C2", actor: "u_homen" },
  { t: 0.4, kind: "type_local", cell: "C2", value: "12,400" },
  { t: 0.8, kind: "status", text: "C2 committed v42 → v43" },
  { t: 1.2, kind: "presence", cell: "C2", actor: "u_homen", state: "editing" },
  { t: 1.6, kind: "agent_stream", text: "Reading Q3 source rows…" },
  { t: 2.0, kind: "agent_stream", text: "Checking formula dependencies…" },
  { t: 2.4, kind: "agent_stream", text: "Drafting variance explanation…" },
  { t: 2.8, kind: "branch_patch", target: "D2", value: "2,400" },
  { t: 3.2, kind: "cas_check", cell: "D2", base: 7, current: 7, result: "pass" },
  { t: 3.6, kind: "semantic_resolution", summary: "Keep human edit, add agent value to upside, mark needs_review" },
  { t: 4.0, kind: "commit_lease", cells: ["D2", "E2", "Memo:Risk"], ms: 428 },
  { t: 4.4, kind: "status", text: "Applied · released · trace written" },
];
