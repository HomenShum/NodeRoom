/**
 * Walkthrough specs — each feature is an ORDERED list of `capture-this-state` / `do-this-action`
 * steps. The capturer (capture.ts) executes them against the LIVE app, captures clean per-state
 * frames + cursor targets, and emits remotion/walkthrough.data.js for the Remotion composition.
 *
 * Grammar (the anti-hero-shot rule): every action step yields TWO beats — the state the cursor
 * glides over (pre-frame + cursor target + ripple) and the outcome (post-frame). Loading states
 * are first-class steps, never skipped. A viewer must always see:
 *   empty state → where the cursor clicked → the loading state → the result.
 */

export type Step =
  | { kind: "state"; caption: string; settleMs?: number; holdMs?: number }
  | { kind: "click"; sel: string; caption: string; afterCaption?: string; after?: After; holdMs?: number; afterHoldMs?: number }
  | { kind: "uploadWorkbook"; caption: string; afterCaption?: string; holdMs?: number; afterHoldMs?: number }
  | { kind: "type"; sel: string; text: string; caption: string; pressEnter?: boolean; afterCaption?: string; after?: After; afterHoldMs?: number }
  | { kind: "key"; key: string; caption: string; after?: After }
  | { kind: "loading"; sel: string; caption: string; timeoutMs?: number }
  | { kind: "waitResult"; predicate: "cellsFilled" | "chipsVisible" | "textVisible" | "textGone"; arg?: string; sel?: string; caption: string; timeoutMs?: number };

export type After =
  | { sel: string; state?: "visible" | "hidden"; timeoutMs?: number }
  | { textSel: string; includes: string; timeoutMs?: number };

export type FeatureSpec = {
  id: string;
  title: string;
  /** createRoom = fresh live room (sheet+note+wall seeded). seedResearchRoom additionally creates
   *  a Company research artifact with 3 seeded accounts via the room's own session token.
   *  memoryDemo = the deterministic in-browser demo engine at the SAME prod URL (?mode=memory) —
   *  same UI, scripted agent; used where a live-LLM step is too nondeterministic to walk through. */
  setup: "createRoom" | "seedResearchRoom" | "startupJoinRoom" | "memoryDemo" | "story" | "roomTour";
  /** Real-LLM features get retries (fresh room per attempt); deterministic ones don't need them. */
  retries?: number;
  /** Opt-in specs are SKIPPED by default runs — they need a special server (e.g. the naive
   *  failure-replay build) and only run when named explicitly: `capture.ts naive-overwrite`. */
  optIn?: boolean;
  /** seedResearchRoom only: override the seeded accounts (episodes for high-trust audiences use
   *  FICTIONAL companies — that restraint is itself the trust signal). */
  seedCompanies?: Array<{ company: string; website?: string; tier?: string; owner?: string }>;
  /** memoryDemo only: extra query params appended to `?mode=memory` (e.g.
   *  "demo=scale&name=Host" for the 1,000-row scale room, which auto-enters —
   *  no start-demo-room click). */
  demoQuery?: string;
  /** Close panels the story doesn't use — fewer panels = the feature renders larger (the judge's
   *  systemic "text too small at phone size" finding). Legacy keys map to current toggles:
   *  left = Room Binder, artifact = Work Surface, priv = Copilot. */
  closePanels?: Array<"left" | "artifact" | "priv">;
  steps: Step[];
};

const CENTER = '[data-testid="public-chat-panel"]';
const PRIVATE = '[data-testid="private-chat-panel"]';
const COMPOSER = `${CENTER} [data-testid="chat-composer"]`;
const PRIVATE_COMPOSER = `${PRIVATE} [data-testid="chat-composer"]`;

export const FEATURES: FeatureSpec[] = [
  {
    id: "chat",
    closePanels: ["left", "artifact"],
    title: "Join a live room & chat",
    setup: "createRoom",
    steps: [
      { kind: "state", caption: "A fresh room — company research, diligence memo, risk wall, and agents", holdMs: 2000 },
      { kind: "click", sel: COMPOSER, caption: "Click the room chat — Slack rules apply" },
      {
        kind: "type", sel: COMPOSER, text: "Starting diligence on CardioNova — enrich the research sheet first.",
        caption: "Type your message…", pressEnter: true, afterCaption: "Enter sends — it paints instantly, before the network",
        after: { textSel: `${CENTER} [data-testid="chat-feed"]`, includes: "CardioNova" },
      },
      { kind: "state", caption: "Everyone in the room sees it in real time", holdMs: 2200 },
    ],
  },
  {
    id: "sheet-undo",
    closePanels: ["left", "priv"],
    title: "Edit the diligence memo — and take it back",
    setup: "createRoom",
    steps: [
      { kind: "state", caption: "The diligence memo — a shared note the room can edit", holdMs: 1800 },
      { kind: "click", sel: '[data-testid="artifact-tabs"] button:has-text("Diligence memo")', caption: "Open the diligence memo" },
      { kind: "click", sel: '[data-testid="note-editor"] .ProseMirror', caption: "Click the note — start typing" },
      {
        kind: "type", sel: '[data-testid="note-editor"] .ProseMirror', text: "CardioNova: Series B likely — verifying burn rate and hospital pilots.",
        caption: "Type your notes…", afterCaption: "Auto-saved — versioned and synced to the whole room",
        after: { textSel: '[data-testid="note-editor"]', includes: "Series B", timeoutMs: 12_000 },
      },
      {
        kind: "key", key: "Control+z", caption: "Changed your mind? Undo (Ctrl+Z) — reverted through the same versioned edit path",
        after: { sel: '[data-testid="note-editor"]', timeoutMs: 8_000 },
      },
      { kind: "state", caption: "Every edit is CAS-versioned — undo is safe in a multiplayer room", holdMs: 2200 },
    ],
  },
  {
    id: "ask-agent",
    closePanels: ["left"],
    title: "Ask the Room agent to enrich companies",
    setup: "createRoom",
    retries: 2,
    steps: [
      { kind: "state", caption: "CardioNova is pending — ask the agent to enrich with sourced facts", holdMs: 1800 },
      { kind: "click", sel: COMPOSER, caption: "Agents live in the chat — no separate console" },
      {
        kind: "type", sel: COMPOSER, text: "@nodeagent enrich CardioNova with sourced facts",
        caption: "Plain language — @nodeagent hands the research to the Room NodeAgent", pressEnter: true,
      },
      { kind: "waitResult", predicate: "textVisible", arg: "needs attention", caption: "The agent reads the sheet, researches, and writes — sourced facts land in the sheet", timeoutMs: 180_000 },
      { kind: "state", caption: "Every agent step is traced — auditable, never silent", holdMs: 2400 },
    ],
  },
  {
    id: "review-approve",
    closePanels: ["left"],
    title: "Review mode — approve agent edits at the cell",
    setup: "createRoom",
    retries: 2,
    steps: [
      { kind: "state", caption: "Don't trust the agent yet? Flip off auto-allow", holdMs: 1800 },
      { kind: "click", sel: '[data-testid="auto-allow-switch"]', caption: "Review mode ON — agents must propose, not write" },
      {
        kind: "type", sel: COMPOSER, text: "@nodeagent set CardioNova's status to researching and tier to B",
        caption: "Same ask — but now every edit needs your sign-off", pressEnter: true,
      },
      { kind: "waitResult", predicate: "chipsVisible", caption: "The agent works — proposals appear as reviewable cards", timeoutMs: 180_000 },
      {
        kind: "click", sel: '[data-testid="proposal-approve"]', caption: "Approve right where the change lands",
        afterCaption: "Applied via the same no-clobber CAS path — synced to everyone",
      },
      { kind: "state", caption: "Human-in-the-loop, one click, in context", settleMs: 1200, holdMs: 2400 },
    ],
  },
  {
    id: "room-home",
    closePanels: ["left", "priv"],
    title: "Room Home — the pinned command center",
    setup: "memoryDemo",
    steps: [
      { kind: "state", caption: "A populated deal room — artifacts open as tabs", holdMs: 2000 },
      {
        kind: "click", sel: '[data-testid="home-tab"]', caption: "A pinned Home tab — always one click away",
        afterCaption: "Room Home: command bar, inventory, and quick actions",
        after: { sel: '[data-testid="room-home-surface"]', state: "visible" },
      },
      { kind: "state", caption: "The full inventory — every artifact, even unopened ones", holdMs: 2200 },
      {
        kind: "click", sel: '[data-testid="room-home-artifact"]:has-text("Runway")', caption: "Dive into any artifact",
        afterCaption: "It opens as a tab — Home steps aside",
        after: { textSel: '[data-testid="artifact-tabs"]', includes: "Runway" },
      },
      { kind: "state", caption: "Your command center, never buried in tabs", settleMs: 1200, holdMs: 2400 },
    ],
  },
  {
    id: "brief",
    closePanels: ["left", "priv"],
    title: "Today's Brief — ranked next actions, each with a source",
    setup: "memoryDemo",
    steps: [
      { kind: "state", caption: "A populated deal room — the agent has done the research", holdMs: 1600 },
      {
        kind: "click", sel: '[data-testid="home-tab"]', caption: "Open Room Home",
        afterCaption: "The full inventory — every artifact, including Today's Brief",
        after: { sel: '[data-testid="room-home-surface"]', state: "visible" },
      },
      {
        kind: "click", sel: '[data-testid="room-home-artifact"]:has-text("Brief")', caption: "Open Today's Brief — it's just another notebook artifact",
        afterCaption: "A document: ranked next actions, risk first, each backed by a source",
        after: { sel: '[data-testid="brief-surface"]', state: "visible" },
      },
      { kind: "state", caption: "Reads like the wiki — a short, ranked memo of what to do next", holdMs: 2400 },
      {
        kind: "click", sel: '[data-testid="brief-handoff-gmail"]', caption: "Hand it off — draft the update",
        afterCaption: "A ready-to-send draft, assembled from the room's own sources",
        after: { sel: '[data-testid="brief-draft"]', state: "visible" },
      },
      { kind: "state", caption: "Messy context in, a sourced next action out", settleMs: 1000, holdMs: 2400 },
    ],
  },
  {
    id: "notebook-agent-lane",
    title: "The notebook agent lane — governed notes, attributed output",
    // Deterministic memory demo: the scripted "notes" intent drives the REAL
    // read_notebook + append_notebook_outline tools — no LLM, no backend.
    setup: "memoryDemo",
    closePanels: ["left"],
    steps: [
      { kind: "state", caption: "A live room — notes, sheets, and a room agent", holdMs: 2000 },
      {
        kind: "click", sel: '[data-testid="artifact-filetab"]:has-text("Capture Notebook")',
        caption: "Open the Capture Notebook",
        afterCaption: "The notebook is paper — ink on parchment",
        after: { sel: '[data-testid="notebook-paper-frame"]', state: "visible" }, afterHoldMs: 2200,
      },
      {
        kind: "type", sel: COMPOSER, text: "@nodeagent summarize my meeting notes", pressEnter: true,
        caption: "Ask the agent to structure the notes",
      },
      {
        // The scripted plan's intermediate says are harness-internal; the
        // OBSERVABLE beats are the agent's completion message in chat and the
        // report heading landing in the notebook — wait on those, never on
        // text the UI doesn't render.
        kind: "waitResult", predicate: "textVisible", arg: "Report written under",
        caption: "The agent reads, then writes — one governed pass", timeoutMs: 60_000,
      },
      {
        kind: "waitResult", predicate: "textVisible", arg: "Report: Notebook summary",
        caption: "A structured report lands under Agent notes", timeoutMs: 60_000,
      },
      { kind: "state", caption: "Agent blocks carry the NodeRoom mark — attributed ink", settleMs: 1000, holdMs: 2400 },
      { kind: "state", caption: "The unverified claim is flagged, never asserted", settleMs: 400, holdMs: 2400 },
    ],
  },
  {
    id: "parity-tour",
    title: "Design parity tour — receipts, palette, paper notebook, run trace",
    // The 1,000-row scale room: deterministic, auto-enters, every parity
    // surface seeded (mixed status chips, lock rows, receipts in chat).
    setup: "memoryDemo",
    demoQuery: "demo=scale&name=Host",
    steps: [
      { kind: "state", caption: "1,000 rows under calm mode — dot statuses, lock rows, honest filter counts", holdMs: 2400 },
      {
        kind: "click", sel: '[data-testid="grid-cite-chip"]', caption: "Every sourced cell carries its receipts",
        afterCaption: "Hover a cite chip — the quoted source, checked time, and confidence",
        after: { sel: '[data-testid="evidence-popover"]', state: "visible" }, afterHoldMs: 2200,
      },
      {
        kind: "key", key: "Control+k", caption: "One keystroke to anywhere — the command palette",
        after: { sel: '[data-testid="command-palette"]', state: "visible" },
      },
      {
        kind: "type", sel: '[data-testid="command-palette-input"]', text: "Capture", pressEnter: true,
        caption: "Jump to the Capture Notebook",
        afterCaption: "The notebook is paper — ink on parchment inside the dark room",
        after: { sel: '[data-testid="notebook-paper-frame"]', state: "visible" }, afterHoldMs: 2600,
      },
      {
        kind: "click", sel: '[data-testid="trace-tab"]', caption: "Every agent action leaves a trace",
        after: { sel: '[data-testid="trace-view-runs"]', state: "visible" },
      },
      {
        kind: "click", sel: '[data-testid="trace-view-runs"]', caption: "Runs view — one agent run as a span tree",
        afterCaption: "Context, retrieval, writes — durations honest, failures kept as evidence",
        after: { sel: '[data-testid="trace-runs"]', state: "visible" }, afterHoldMs: 2400,
      },
      {
        kind: "click", sel: '[data-testid="people-trigger"]', caption: "62 people and agents, live",
        afterCaption: "Role groups, live location, and Follow — see the room through anyone's eyes",
        after: { sel: '[data-testid="people-panel"]', state: "visible" }, afterHoldMs: 2400,
      },
      { kind: "state", caption: "Diligence that shows its work", settleMs: 800, holdMs: 2000 },
    ],
  },
];
