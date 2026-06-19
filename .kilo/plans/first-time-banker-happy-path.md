# First-time banker happy path — spec + walkthrough entry + P0

## Goal

Make the first 30 seconds of a NodeRoom feel like magic: **join → land in a notebook →
type messy notes → pause → see what the room noticed → choose what to do with it**. Ship the
three artifacts that make this real and provable:

1. **P0 product changes** so the live app actually does the magic moment.
2. **A spec doc** (`E_FIRST_TIME_BANKER_HAPPY_PATH.md`) that sequences P0 and documents the
   deferred P1/P2 work.
3. **A walkthrough entry** that captures the magic moment as README-grade evidence.

Source of truth for intent: `6-18-2026-happy-path-demo-consolidation.txt` (consolidation note).
Inspiration map: `6-16-2026-uiux-top-inspirational-references.txt` (Notion blank-canvas, Linear
Triage, Figma multiplayer degradation).

## Locked decisions

- **Scope:** spec doc + walkthrough entry + the minimum P0 implementation to make the clip real.
- **Notebook default:** ALL rooms, ALWAYS land on the notebook surface (not first-visit-gated).
  Rationale (user): "regardless of project, I first go to my notebook to jot down the big idea."
- **Debounce/maxWait:** IN SCOPE now — implement per-actor/per-block dedupe keys + `maxWait` in
  the Convex scanner, with deterministic tests.
- **Deterministic capture:** the walkthrough films `memoryDemo` with a scripted passive seed, NOT
  a live nondeterministic room (live debounce timing is not film-reliable).
- **Inbox actions:** wire to real store mutations in live mode; memory mode gets deterministic
  stubs so the clip is reproducible.

## Current state (already built — do not re-build)

- **Passive backend:** `convex/roomActivityOutbox` schema (`convex/schema.ts:299`),
  `convex/roomActivity.ts` (`enqueueRoomActivity`, `scanActivityRow`, dedupe via `by_dedupe`),
  `convex/noteworthy.ts` (`debounceActivityScan` wrapper, `scanActivity`). The scan creates the
  durable work ledger; downstream research worker is still a scaffold.
- **Passive UI:** `src/ui/insights/PassiveAgentChip.tsx` (chip, `data-testid="passive-agent-chip"`)
  + `src/ui/insights/NoteworthyInbox.tsx` (`data-testid="noteworthy-inbox"`,
  item `data-testid="noteworthy-item"`). Inbox currently has ONLY an "Open" button.
- **Live feed wiring:** `src/app/store.tsx:633` `useQuery(api.roomActivity.feed)` →
  `listPassiveActivity` (`store.tsx:1212`). Memory mode returns `[]` (`store.tsx:490`).
- **Notebook surface:** note editor exists in `src/ui/panels/Artifact.tsx:1496`
  (`data-testid="note-editor"`). Center-stage artifact selection defaults to a `sheet`:
  `RoomShell.tsx:62` → `arts.find((a) => a.kind === "sheet")?.id ?? arts[0]?.id`.
- **Walkthrough system:** `scripts/walkthroughs/specs.ts` (`FeatureSpec[]`), capture in
  `scripts/walkthroughs/capture.ts` (setups: `createRoom`, `seedResearchRoom`, `startupJoinRoom`,
  `memoryDemo`), config `walkthrough-review.config.json`, media root `docs/walkthroughs/`.
- **Spec convention:** `docs/synthesis/specs/{A,B,C,D}_*.md` — Decision → Current state →
  Net-new work (sequenced, each with DoD) → Interfaces.
- **Tests:** `tests/passiveIntelligence.test.tsx` (chip+inbox),
  `tests/roomActivityEvidenceAdapters.test.ts` (outbox/scan).

## Net-new work (sequenced)

### Task 1 — Notebook-default surface (all rooms, always)
- **Files:** `src/ui/RoomShell.tsx` (~line 62, the `artId` initializer); `src/ui/panels/Artifact.tsx`
  (note empty-state placeholder); seed check for the demo/startup room artifacts.
- **Do:**
  - First, confirm the notebook artifact `kind` (grep `Artifact.tsx`/seed code for the note/memo
    kind string; likely `"note"`). Change the `artId` initializer to prefer that kind, falling back
    to `sheet`, then `arts[0]`.
  - Ensure every room (incl. the startup-diligence/demo room and fresh `createRoom`) seeds a
    notebook artifact so the default resolves. If a room has no notebook, fall back to sheet (no
    crash).
  - Add Notion-style placeholder guide text to the EMPTY note editor: "Who did you talk to? What
    company/product came up? Any funding, pricing, hiring, or runway signal? Paste links here —
    NodeRoom will organize them." Keep it as placeholder/ghost text, not a saved block.
- **DoD:** opening any room lands center-stage on the notebook; a room with no notebook still loads
  on the sheet; placeholder shows only when the note is empty; existing RoomShell/tour tests pass
  (update tour anchor expectations if they assert sheet-first).

### Task 2 — Actionable Noteworthy Inbox ([Research] [Add to sheet] [Dismiss])
- **Files:** `src/ui/insights/NoteworthyInbox.tsx`, `src/ui/insights/PassiveAgentChip.tsx`
  (pass action handlers), `src/app/store.tsx` (expose action mutations + memory stubs),
  `tests/passiveIntelligence.test.tsx`.
- **Do:**
  - Add three buttons per item with stable testids: `noteworthy-research`, `noteworthy-add`,
    `noteworthy-dismiss`.
  - Wire handlers through `useStore()`:
    - **Research** → `startAgentJob` (already in store deps, `store.tsx:1222`) with a
      passive-research goal scoped to the item's entity; status reflects `Researching`.
    - **Add to sheet** → research-row/cell proposal path (reuse `addResearchRows` / `applyCellEdit`
      from store deps); MUST create a draft/proposal, never a silent clobber.
    - **Dismiss** → set the activity status to `ignored` (already a `QUIET_STATUSES` member in
      `PassiveAgentChip.tsx:9`), so the item leaves the actionable feed. Add a Convex mutation in
      `convex/roomActivity.ts` to set status `ignored` for the outbox row; memory mode mutates the
      seeded list locally.
  - Memory mode: provide deterministic stubs so the three actions resolve without a backend.
- **DoD:** clicking Dismiss removes the item from the chip count; Research flips the pill to
  Researching; Add produces a proposal/draft (no direct write); `passiveIntelligence.test.tsx`
  covers all three actions in memory mode; live mutations validate against actor proof.

### Task 3 — Per-actor/per-block debounce keys + maxWait (Convex)
- **Files:** `convex/schema.ts` (`roomActivityOutbox` — add `maxWaitAt?: number`, ensure
  `actorId`/session is part of the dedupe identity), `convex/roomActivity.ts`
  (`enqueueRoomActivity` dedupe-key construction + schedule logic), `convex/noteworthy.ts`
  (`scanActivity` superseded check), `tests/roomActivityEvidenceAdapters.test.ts` (+ new cases).
- **Do:**
  - Change the debounce/dedupe key from whole-notebook granularity to scoped keys:
    - Notebook block: `roomId + nodeId + authorId + editingSessionId`
    - Spreadsheet cell: `roomId + artifactId + elementId + authorId`
    - Message: `roomId + messageId`
    - Wiki paragraph: `roomId + wikiPageId + blockId + authorId`
  - Add `maxWait`: persist `firstEditAt`; compute `quietUntil = lastEditAt + QUIET_MS` and
    `forceScanAt = firstEditAt + MAX_WAIT_MS`; schedule the scan for `min(quietUntil, forceScanAt)`
    and fire when `now >= quietUntil OR now >= forceScanAt`. Suggested defaults: `QUIET_MS = 12_000`,
    `MAX_WAIT_MS = 60_000` (keep configurable).
  - Keep the scan CHEAP — classify only, no Linkup/Firecrawl/LLM in the scan path (unchanged).
- **DoD:** three users typing in the same shared notebook each get an independent quiet window
  (no whole-notebook starvation) — proven by a deterministic test; a single user typing past
  `MAX_WAIT_MS` still triggers exactly one snapshot scan; superseded scans are skipped; operation
  count scales with saved blocks × sessions, not keystrokes.

### Task 4 — Deterministic passive seed for memory mode
- **Files:** `src/app/store.tsx` (~line 490, `listPassiveActivity` for memory mode).
- **Do:** when memory mode + the startup-diligence/demo room is active, return a scripted
  `PassiveActivityItem` (entity "CardioNova", reasons: company/funding/runway signals, status
  `noteworthy`) so the chip and inbox render deterministically. Mutate this seed in response to the
  Task 2 actions (Dismiss → drop it, Research → flip status). Gate so non-demo memory rooms stay `[]`.
- **DoD:** `memoryDemo` shows the chip after the seeded note; capture is reproducible across runs;
  no live backend required.

### Task 5 — Spec doc `E_FIRST_TIME_BANKER_HAPPY_PATH.md`
- **Files:** new `docs/synthesis/specs/E_FIRST_TIME_BANKER_HAPPY_PATH.md`.
- **Do:** follow the A/B/C/D convention. Sections:
  - **Decision:** notebook-first magic moment; suggest-don't-automate (Linear Triage); two separate
    debounces (save vs agent); deterministic capture via memory seed.
  - **Current state (already built):** the anchors listed above.
  - **Net-new work (sequenced):** Tasks 1–4 (this deliverable) + clearly-deferred sections:
    - **P1 (deferred):** batched `CellPayload` writes with payload-hash skip
      (`src/nodeagent/skills/spreadsheet/cellMutator.ts`); agent output levels
      (scratch → status → proposal → artifact) over persistent text streaming; cache-hit surfacing.
    - **P2 (deferred):** `batchScanRoomActivity` aggregator (group by entity/facet/privacy, one
      parent job + child `entityWorkItems`, single-flight dedupe); room/workspace/global cache
      scopes on `entityResearchCache`; stress harness + scenarios A–E and pass criteria from the note.
  - **Interfaces:** the new outbox fields, the inbox action handler signatures, the memory-seed shape.
- **DoD:** doc lands beside A–D, each net-new item has a DoD line, deferred work is explicitly
  labeled deferred (not implied built).

### Task 6 — Walkthrough entry `first-time-banker-capture`
- **Files:** `scripts/walkthroughs/specs.ts` (new `FeatureSpec`); confirm `memoryDemo` setup path
  in `capture.ts` reaches the notebook default; register media per `walkthrough-review.config.json`.
- **Do:** add a `FeatureSpec` (`setup: "memoryDemo"`, `closePanels: ["left"]`) with steps:
  1. `state` — land on the Capture Notebook (default surface), placeholder visible.
  2. `type` into `[data-testid="note-editor"]`: "Met Maya from CardioNova. AI triage for hospitals.
     Possible Series B. Need to ask about burn and hospital pilots."
  3. `state`/pause — "Put the phone down. The room is watching."
  4. `waitResult` `chipsVisible` on `[data-testid="passive-agent-chip"]` — "NodeRoom noticed."
  5. `click` the chip → inbox opens (`[data-testid="noteworthy-inbox"]`).
  6. `click` `[data-testid="noteworthy-research"]` → pill flips to "Researching".
  7. `state` — "Suggest, don't automate: you chose what to do with it."
- **DoD:** `npx tsx scripts/walkthroughs/capture.ts first-time-banker-capture` produces clean
  per-state frames + a rendered clip; honest labeling (memory-mode deterministic); no reliance on
  live LLM timing.

## Verification

- `npm run build`
- `npm test -- --run tests/passiveIntelligence.test.tsx`
- `npm test -- --run tests/roomActivityEvidenceAdapters.test.ts` (+ new debounce/maxWait cases)
- `npx tsx scripts/walkthroughs/capture.ts first-time-banker-capture` (frames + render)
- If any NodeAgent harness file is touched: `npm run nodeagent:frame:smoke` and
  `npm run omnigent:nodeagent:smoke` (per `AGENTS.md`), and
  `npm test -- --run tests/frameRunner.test.ts` for frame-runner edits.

## Risks & guardrails

- **Notebook-default regressions:** changing `RoomShell.tsx:62` affects every room and several
  walkthrough specs that assume sheet-first (e.g. `sheet-undo`, `ask-agent` click cells directly).
  Audit `scripts/walkthroughs/specs.ts` + tour anchors; those specs may need an explicit "open
  sheet" step. Keep the sheet fallback when no notebook artifact exists.
- **Convex op volume:** per-actor keys must come from SAVED blocks × sessions, not keystrokes —
  keep client keystrokes local; only debounced saves enqueue. Assert this in the test.
- **No silent clobber:** "Add to sheet" MUST go through proposal/draft, never a direct write.
- **Honesty:** the clip is memory-mode deterministic — label it as such; do not imply live research.
- **Scan stays cheap:** no external API in the scan path; downstream worker remains out of scope.

## Out of scope (this deliverable)

- The downstream research worker that processes `entityWorkItems` (cache → OKF → Linkup/Firecrawl
  → evidenceFacts → managed writes).
- P1 batching/streaming-levels implementation and P2 aggregator/global-cache/stress-harness
  implementation — documented in the spec as deferred, not built here.

## Handoff

This plan is implementation-ready but requires source edits and Convex schema/mutation changes —
switch to an implementation-capable agent (NodeAgent harness rules in `AGENTS.md` apply if any
`src/nodeagent/` file is touched). Suggested order: Task 3 (backend, testable in isolation) →
Task 1 → Task 2 → Task 4 → Task 6 → Task 5 (spec doc reflects final shapes).
