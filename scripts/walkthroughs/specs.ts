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
    id: "room-tour-walkthrough",
    title: "The NodeAgent room walkthrough — 8 steps from landing to live collab",
    setup: "roomTour",
    steps: [
      { kind: "state", caption: "The #room-tour dock walks you through the product — landing, create, join, then the room", holdMs: 2400 },
      {
        kind: "click", sel: '.rt-stepdot:nth-child(2)',
        caption: "Step 02 — host a room: a 6-char share code, no account",
        afterCaption: "Anyone with the code can join. The room id is keyed by host.",
        after: { sel: '.rt-modal h2', state: "visible", timeoutMs: 8_000 },
        afterHoldMs: 2600,
      },
      {
        kind: "click", sel: '.rt-modal .rt-btn.primary',
        caption: "Step 04 — “Enter room” → one panel: public chat + the room agent",
        afterCaption: "Everyone in the room sees the chat. /ask invokes the room agent.",
        after: { sel: '.rt-panel.center .rt-chat', state: "visible", timeoutMs: 8_000 },
        afterHoldMs: 2400,
      },
      {
        kind: "click", sel: '.rt-stepdot:nth-child(5)',
        caption: "Step 05 — open the artifact beside chat",
        afterCaption: "Spreadsheet · Note · Wall — the agent edits the same artifact you do.",
        after: { sel: '.rt-panel.artifact .rt-sheet', state: "visible", timeoutMs: 8_000 },
        afterHoldMs: 2400,
      },
      {
        kind: "click", sel: '.rt-stepdot:nth-child(7)',
        caption: "Step 07 — four panels: navigator · chat · artifact · your private agent",
        afterCaption: "Each panel earns its place. The private agent reads room context, output stays yours.",
        after: { sel: '.rt-panel.left .rt-file', state: "visible", timeoutMs: 8_000 },
        afterHoldMs: 2400,
      },
      {
        kind: "click", sel: '.rt-stepdot:nth-child(8)',
        caption: "Step 08 — live collab: lock → draft → commit → smart-merge",
        afterCaption: "Two agents, aware of each other. Run the drill.",
        after: { sel: '.rt-collab-bar', state: "visible", timeoutMs: 8_000 },
        afterHoldMs: 1800,
      },
      {
        kind: "click", sel: '.rt-collab-bar button:has-text("Run collaboration")',
        caption: "Room agent locks rows it’s about to write; the private agent drafts around the lock",
        afterCaption: "v41 → v43: agent commits Revenue+COGS, smart-merge applies the held Gross profit+Net income draft. No clobber.",
        after: { textSel: '.rt-vpill.next', includes: "v43", timeoutMs: 20_000 },
        afterHoldMs: 2800,
      },
      { kind: "state", caption: "All eight steps run on scripted seed data — the real product wires the same contracts in Convex", holdMs: 2400 },
    ],
  },
  {
    id: "story-seven-layers",
    title: "The seven no-clobber layers — a real grid you can drive",
    setup: "story",
    steps: [
      { kind: "state", caption: "The seven-layer story ends in a REAL grid on the in-browser engine", holdMs: 2200 },
      {
        kind: "click", sel: '[data-testid="story-lab-lease-run"]',
        caption: "Layers 7 + 4 — take a 5-min lease on a cell; NodeAgent drafts around it",
        afterCaption: "Lease blocks the agent's write; it drafts on a neighbor and smart-merges on release",
        after: { sel: '[data-testid="story-lab-lease-ttl"]', state: "visible", timeoutMs: 12_000 },
        afterHoldMs: 2800,
      },
      {
        kind: "click", sel: '[data-testid="story-lab-rebase-run"]',
        caption: "Layer 6 — a stale agent write becomes a reviewable semantic-rebase proposal",
        afterCaption: "No silent merge, no clobber — it routes to human review",
        after: { sel: '[data-testid="story-lab-rebase-proposal"]', state: "visible", timeoutMs: 12_000 },
        afterHoldMs: 2600,
      },
      {
        kind: "click", sel: '[data-testid="story-lab-rebase-approve"]',
        caption: "Approve the proposal…",
        afterCaption: "Re-applied at the CURRENT version (v3) — not the stale baseline",
        after: { sel: '[data-testid="story-lab-rebase-approved"]', state: "visible", timeoutMs: 12_000 },
        afterHoldMs: 2600,
      },
      {
        kind: "click", sel: '[data-testid="story-lab"] .sl-gridcard button.sl-btn.primary',
        caption: "Layer 5 — stage a stale edit, then run the no-clobber test",
        afterCaption: "Rejected and returned as conflict-as-data — the cell keeps the agent's value",
        after: { sel: '[data-testid="story-lab"] .sl-conflict', state: "visible", timeoutMs: 12_000 },
        afterHoldMs: 2800,
      },
      { kind: "state", caption: "Every action hit the real engine — nothing scripted", holdMs: 2400 },
    ],
  },
  {
    id: "startup-diligence-live-join",
    title: "Fresh startup diligence room + teammate join",
    setup: "startupJoinRoom",
    optIn: true,
    steps: [],
  },
  {
    id: "chat",
    closePanels: ["left", "artifact"],
    title: "Join a live room & chat",
    setup: "createRoom",
    steps: [
      { kind: "state", caption: "A brand-new room — shared spreadsheet, notes, post-it wall, and agents", holdMs: 2000 },
      { kind: "click", sel: COMPOSER, caption: "Click the room chat — Slack rules apply" },
      {
        kind: "type", sel: COMPOSER, text: "Kicking off the Q3 review — variance column first.",
        caption: "Type your message…", pressEnter: true, afterCaption: "Enter sends — it paints instantly, before the network",
        after: { textSel: `${CENTER} [data-testid="chat-feed"]`, includes: "variance column first" },
      },
      { kind: "state", caption: "Everyone in the room sees it in real time", holdMs: 2200 },
    ],
  },
  {
    id: "sheet-undo",
    closePanels: ["left", "priv"],
    title: "Edit the sheet — and take it back",
    setup: "createRoom",
    steps: [
      { kind: "state", caption: "The Q3 variance column starts empty", holdMs: 1800 },
      { kind: "click", sel: '[data-cell-key="r_opex__variance"] .r-cell-edit', caption: "Click a cell — Sheets muscle memory" },
      {
        kind: "type", sel: '[data-cell-key="r_opex__variance"] input.r-cell-input', text: "+20.5%",
        caption: "Type the variance…", pressEnter: true, afterCaption: "Enter commits — versioned and synced to the whole room",
        after: { textSel: '[data-cell-key="r_opex__variance"]', includes: "20.5" },
      },
      {
        kind: "click", sel: 'button[title*="Undo last applied"]', caption: "Changed your mind? Undo (or Ctrl+Z)",
        afterCaption: "Reverted through the same versioned edit path — no clobbering",
        after: { textSel: '[data-cell-key="r_opex__variance"]', includes: "add", timeoutMs: 12_000 },
      },
      { kind: "state", caption: "Every edit is CAS-versioned — undo is safe in a multiplayer room", holdMs: 2200 },
    ],
  },
  {
    id: "workbook-style-toggle",
    closePanels: ["priv"],
    title: "Workbook view modes",
    setup: "memoryDemo",
    steps: [
      { kind: "state", caption: "Start with the shared room; the backend contract is the same for every view", holdMs: 1600 },
      {
        kind: "uploadWorkbook",
        caption: "Upload a styled Excel workbook",
        afterCaption: "The workbook opens as Excel paper: file formats, merged cells, formula bar, and CAS receipt",
        holdMs: 1100,
        afterHoldMs: 2600,
      },
      {
        kind: "click",
        sel: '[data-testid="workbook-style-sheets"]',
        caption: "Switch the view to Sheets",
        afterCaption: "Sheets mode keeps the same selected cell and versioned write path",
        afterHoldMs: 2800,
      },
      {
        kind: "click",
        sel: '[data-testid="workbook-style-evidence"]',
        caption: "Switch to Evidence mode for agent review",
        afterCaption: "Evidence mode emphasizes provenance and review without changing data ownership",
        afterHoldMs: 3000,
      },
      { kind: "state", caption: "MVP rule: style changes are local UI; Convex versions, locks, and traces stay canonical", holdMs: 2400 },
    ],
  },
  {
    id: "ask-agent",
    closePanels: ["left"],
    title: "Ask the Room agent to do the work",
    setup: "createRoom",
    retries: 2,
    steps: [
      { kind: "state", caption: "Five variance cells to reconcile — ask the agent instead", holdMs: 1800 },
      { kind: "click", sel: COMPOSER, caption: "Agents live in the chat — no separate console" },
      {
        kind: "type", sel: COMPOSER, text: "/ask reconcile Q3 revenue and fill the variance cells",
        caption: "Plain language — /ask hands the sheet to the Room NodeAgent", pressEnter: true,
      },
      { kind: "loading", sel: `${CENTER} .r-typing`, caption: "The agent reads the sheet, locks cells, and works — live status, no dead spinner", timeoutMs: 30_000 },
      { kind: "waitResult", predicate: "cellsFilled", arg: "2", caption: "Cells filled with lock→CAS-safe edits + a summary in chat", timeoutMs: 150_000 },
      { kind: "state", caption: "Every agent step is traced — auditable, never silent", holdMs: 2400 },
    ],
  },
  {
    id: "startup-diligence-war-room",
    title: "Startup diligence war-room package",
    setup: "memoryDemo",
    closePanels: ["left"],
    steps: [
      { kind: "state", caption: "Blank room, not blank agent: the startup-banking room already has sheet, notes, wall, Copilot, and trace", holdMs: 1800 },
      {
        kind: "click",
        sel: '[data-testid="artifact-tabs"] button:has-text("Research")',
        caption: "Open the company research sheet",
        afterCaption: "This is the shared queue for CardioNova intake, batch diligence, source refs, and owner review",
        after: { sel: ".r-research", timeoutMs: 12_000 },
        afterHoldMs: 1700,
      },
      {
        kind: "click",
        sel: '[data-testid="research-enrich"]',
        caption: "Run source-backed enrichment for the startup-banking watchlist",
        afterCaption: "Rows move to complete with summaries, signals, source links, and freshness",
        after: { textSel: ".r-research-body", includes: "All complete", timeoutMs: 18_000 },
        afterHoldMs: 3300,
      },
      { kind: "click", sel: COMPOSER, caption: "Use the public room lane for shared analyst work" },
      {
        kind: "click",
        sel: '[data-testid="copilot-tab-private"]',
        caption: "Switch to the private NodeAgent lane",
        afterCaption: "The active Private tab is highlighted: work stays owner-scoped until promoted",
        after: { sel: PRIVATE, timeoutMs: 10_000 },
        afterHoldMs: 2600,
      },
      {
        kind: "type",
        sel: PRIVATE_COMPOSER,
        text: "Privately draft the partner-facing concerns for CardioNova and the top two runway-risk companies before I share anything.",
        caption: "Ask for private banker judgment without publishing it to the room",
        pressEnter: true,
        afterCaption: "The owner lane shows the private ask; nothing is promoted to the room",
        afterHoldMs: 1800,
      },
      {
        kind: "click",
        sel: '[data-testid="downstream-gmail"]',
        caption: "Downstream actions are approval-gated drafts, not silent OAuth sends",
        afterCaption: "The visible promise is honest: package Gmail, Notion, Slack, Linear, LinkedIn, and CRM drafts; a human approves",
        afterHoldMs: 2200,
      },
    ],
  },
  {
    id: "research-upsert",
    closePanels: ["left", "priv"],
    title: "GTM research import — updates, never duplicates",
    setup: "seedResearchRoom",
    steps: [
      { kind: "state", caption: "A GTM research sheet — statuses run like a CRM pipeline", holdMs: 2000 },
      { kind: "click", sel: 'button:has-text("Import accounts")', caption: "Import accounts — paste like a CRM" },
      {
        kind: "type", sel: ".r-research-import textarea", text: "Anthropic, https://anthropic.com, A, eval tooling, Maya",
        caption: "Paste company, website, tier, intent, owner…",
      },
      {
        kind: "click", sel: '.r-research-import button:has-text("Import")', caption: "One click to import",
        afterCaption: "New row lands — pending, ready to enrich",
        after: { textSel: ".r-research", includes: "Anthropic", timeoutMs: 15_000 },
      },
      { kind: "click", sel: 'button:has-text("Import accounts")', caption: "Re-import the same account…" },
      {
        kind: "type", sel: ".r-research-import textarea", text: "Anthropic, https://anthropic.com, A, eval tooling, Dev",
        caption: "Same company, new owner",
      },
      {
        // No text assertion here: the owner column lives in the click-to-expand detail row, not the
        // dense grid. The on-screen proof is the bar still reading "4 accounts" + the trace line.
        kind: "click", sel: '.r-research-import button:has-text("Import")', caption: "Import again",
        afterCaption: "The existing row UPDATES — no duplicate, sourced research preserved",
      },
      { kind: "state", caption: "Still 4 accounts — re-import = update, never a duplicate (CRM convention)", settleMs: 1400, holdMs: 2400 },
    ],
  },
  {
    id: "ic-room",
    closePanels: ["left", "priv"],
    title: "A private investment team's research room",
    // Episode capture (private-investment-room-v1, family-office audience). Fictional companies
    // only — per episodes/_audiences/family-office.yaml trust_signals_required. Not a README
    // feature demo, so optIn.
    setup: "seedResearchRoom",
    optIn: true,
    seedCompanies: [
      { company: "Meridian Robotics", website: "https://example.com/meridian", tier: "A", owner: "Principal" },
    ],
    steps: [
      { kind: "state", caption: "Monday's IC meeting — targets, owners, and status in one room", holdMs: 2200 },
      { kind: "click", sel: 'button:has-text("Import accounts")', caption: "A new opportunity arrives from an advisor" },
      {
        kind: "type", sel: ".r-research-import textarea", text: "Atlas Maritime Partners, https://example.com/atlas, A, growth equity, Principal",
        caption: "One advisor target pasted like a CRM row",
      },
      {
        kind: "click", sel: '.r-research-import button:has-text("Import")', caption: "One click to file it",
        afterCaption: "One row filed — versioned and attributed in the room trace",
        after: { textSel: ".r-research", includes: "Atlas Maritime", timeoutMs: 15_000 },
      },
      { kind: "state", caption: "Every change in this room carries provenance — that's the point", settleMs: 1200, holdMs: 2400 },
    ],
  },
  {
    id: "naive-overwrite",
    closePanels: ["left"],
    title: "Failure replay — the naive agent clobbers a human",
    // FAILURE-REPLAY (episode scene `naive-problem`). Runs ONLY against the deliberately-naive
    // build (branch demo/v0-naive-agent: agents skip locks, CAS, and traces — never merged,
    // never deployed). Start it in the worktree:  npm run dev -- --port 5274  then capture with
    //   WALKTHROUGH_BASE=http://localhost:5274 npx tsx scripts/walkthroughs/capture.ts naive-overwrite
    // Honesty: the clip labels the build on screen; memory-mode scripted agent = deterministic.
    setup: "memoryDemo",
    optIn: true,
    steps: [
      { kind: "state", caption: "The NAIVE build (demo/v0-naive-agent) — same room, agent guards removed", holdMs: 2000 },
      // Notebook is now the default surface; open Q3 variance explicitly before clicking cells.
      { kind: "click", sel: '[data-testid="artifact-tabs"] button:has-text("Q3 variance")', caption: "Open the Q3 variance sheet", after: { sel: '[data-cell-key="r_gp__variance"]', timeoutMs: 15_000 }, afterHoldMs: 600 },
      { kind: "click", sel: '[data-cell-key="r_gp__variance"] .r-cell-edit', caption: "Maya checked Gross profit by hand…" },
      {
        kind: "type", sel: '[data-cell-key="r_gp__variance"] input.r-cell-input', text: "+30.0% — Maya's manual calc",
        caption: "…and commits her own figure", pressEnter: true,
        afterCaption: "Her number is in the sheet — versioned, hers",
        after: { textSel: '[data-cell-key="r_gp__variance"]', includes: "30.0" },
      },
      { kind: "type", sel: `${CENTER} [data-testid="chat-composer"]`, text: "/ask reconcile Q3 revenue", caption: "Someone asks the agent to reconcile — it read the sheet BEFORE Maya's edit", pressEnter: true },
      {
        kind: "waitResult", predicate: "textGone", sel: '[data-cell-key="r_gp__variance"]', arg: "30.0",
        caption: "Maya's figure is GONE — no lock shown, no proposal, no trace. Silent overwrite.", timeoutMs: 30_000,
      },
      { kind: "state", caption: "This is why the room needed locks, versions, drafts, and review", holdMs: 2400 },
    ],
  },
  {
    id: "first-time-banker-capture",
    title: "First-time banker happy path — join, note, notice, choose",
    /** memoryDemo ensures deterministic passive feed (scripted CardioNova seed) — no live LLM timing.
     *  Honest label: frames include "memory-mode demo" so viewers know timing is scripted. */
    setup: "memoryDemo",
    closePanels: ["left"],
    steps: [
      // Step 1: land on the Capture Notebook (default surface after notebook-first change).
      {
        kind: "state",
        caption: "Join the room — land on the Notebook. Placeholder says what to jot.",
        holdMs: 2200,
      },
      // Step 2: type messy notes into the note editor.
      {
        kind: "type",
        sel: '[data-testid="note-editor"] .ProseMirror',
        text: "Met Maya from CardioNova. AI triage for hospitals. Possible Series B. Need to ask about burn and hospital pilots.",
        caption: "Jot what you heard — no structure needed yet",
        afterCaption: "Raw notes drafted. Click away to save the notebook edit.",
        afterHoldMs: 1400,
      },
      {
        kind: "click",
        sel: COMPOSER,
        caption: "Save the note — the notebook commits on blur",
        afterCaption: "Saved. Now pause and let the room notice what's worth returning to.",
        afterHoldMs: 1500,
      },
      // Step 3: pause — "the room is watching"
      {
        kind: "state",
        caption: "The room is watching. NodeRoom noticed signals in your notes.",
        settleMs: 600,
        holdMs: 3200,
      },
      // Step 4: wait for the passive-agent chip (deterministic in memory mode — appears after the saved note).
      {
        kind: "loading",
        sel: '[data-testid="passive-agent-chip"]',
        caption: "NodeRoom noticed — chip surfaces when there is something worth returning to",
        timeoutMs: 8_000,
      },
      // Step 5: click the chip to open the inbox.
      {
        kind: "click",
        sel: '[data-testid="passive-agent-chip"]',
        caption: "Click to open the room intelligence inbox",
        afterCaption: "CardioNova flagged: funding, runway, and hospital signals",
        after: { sel: '[data-testid="noteworthy-inbox"]', timeoutMs: 6_000 },
        afterHoldMs: 2000,
      },
      // Step 6: click Research — pill flips to Researching.
      {
        kind: "click",
        sel: '[data-testid="noteworthy-research"]',
        caption: "Click Research — you chose what to do with it",
        afterCaption: "Researching. Suggest, don't automate: you're still in control.",
        afterHoldMs: 2400,
      },
      // Step 7: final state — honest summary.
      {
        kind: "state",
        caption: "30 seconds: note → notice → choose. The room captured your intent.",
        holdMs: 3000,
      },
    ],
  },
  {
    id: "review-approve",
    closePanels: ["left"],
    title: "Review mode — approve agent edits at the cell",
    // LIVE again: the 0/3 review-mode behavior was root-caused (the model was never told review
    // mode exists, so pendingApproval results read as failures → budget-burn or wander-and-quit)
    // and fixed via the room-policy briefing in the agent context. Diag: 2/2 runs file all
    // variance proposals. Retries stay as the flake net for raw LLM slowness.
    setup: "createRoom",
    retries: 2,
    steps: [
      { kind: "state", caption: "Don't trust the agent yet? Flip off auto-allow", holdMs: 1800 },
      { kind: "click", sel: ".r-pill-auto .r-switch", caption: "Review mode ON — agents must propose, not write" },
      {
        kind: "type", sel: COMPOSER, text: "/ask reconcile Q3 revenue and fill the variance cells",
        caption: "Same ask — but now every edit needs your sign-off", pressEnter: true,
      },
      { kind: "loading", sel: `${CENTER} .r-typing`, caption: "The agent works — but writes become proposals", timeoutMs: 30_000 },
      { kind: "waitResult", predicate: "chipsVisible", caption: "Proposals appear ON the cells — like suggestions in Docs", timeoutMs: 150_000 },
      {
        // No after-wait: the agent files proposals for EVERY variance cell, so "first approve button
        // hidden" never resolves (the others remain). The optimistic update paints the approved cell
        // in the same frame; the default settle captures it.
        kind: "click", sel: '[data-testid="proposal-inline-approve"]', caption: "Approve right where the change lands",
        afterCaption: "Applied via the same no-clobber CAS path — synced to everyone",
      },
      { kind: "state", caption: "Human-in-the-loop, one click, in context", settleMs: 1200, holdMs: 2400 },
    ],
  },
];
