# First-time banker happy path — notebook default, passive inbox actions, debounce keys, walkthrough

Status: **implemented** (Tasks 1–4 and 6 shipped in this pass; P1/P2 sections below are explicitly
deferred and not built).

## Decision

**Notebook-first surface (all rooms, always).** Every NodeRoom opens center-stage on the notebook
artifact (`kind === "note"`), not the sheet. Rationale: bankers start by jotting the big idea —
structure comes later. The sheet remains the fallback if no notebook exists (legacy or partial rooms).

**Suggest, don't automate (Linear Triage model).** When the room notices something (company mention,
funding signal, runway reference), it surfaces a chip + inbox — never auto-edits the note or the
sheet. The banker chooses: Research, Add to sheet, or Dismiss. This is the Notion blank-canvas
principle applied to triage: context-sensitive suggestions, never ambient overwrite.

**Two separate debounce timers (save vs. agent).** Client keystrokes stay local; only SAVED blocks
enqueue an outbox row. The debounce is per-actor/per-block so three bankers typing in the same shared
notebook each get an independent quiet window (no whole-notebook starvation). A `maxWait` hard
deadline prevents a single slow typist from deferring their scan indefinitely.

**Deterministic capture via memory seed.** The walkthrough (`first-time-banker-capture`) uses
`setup: "memoryDemo"` with a scripted CardioNova seed so the clip is reproducible across runs
without live LLM timing. The clip is labeled "memory-mode demo" — honesty is non-negotiable.

## Current state (already built — do not re-spec)

- **Passive backend:** `convex/roomActivityOutbox` schema (`convex/schema.ts:299`),
  `convex/roomActivity.ts` (`enqueueRoomActivity`, `scanActivityRow`, dedupe via `by_dedupe`),
  `convex/noteworthy.ts` (`debounceActivityScan` wrapper, `scanActivity`). Scan creates the durable
  work ledger; downstream research worker is scaffolded only.
- **Passive UI:** `src/ui/insights/PassiveAgentChip.tsx` (chip, `data-testid="passive-agent-chip"`)
  and `src/ui/insights/NoteworthyInbox.tsx` (`data-testid="noteworthy-inbox"`,
  item `data-testid="noteworthy-item"`). Inbox previously had only an "Open" button.
- **Live feed wiring:** `src/app/store.tsx:633` `useQuery(api.roomActivity.feed)` →
  `listPassiveActivity`. Memory mode previously returned `[]`.
- **Notebook surface:** note editor in `src/ui/panels/Artifact.tsx:1496`
  (`data-testid="note-editor"`). Center-stage defaulted to `sheet`.
- **Walkthrough system:** `scripts/walkthroughs/specs.ts` + `capture.ts` (`memoryDemo` setup).
- **Spec convention:** `docs/synthesis/specs/{A,B,C,D}_*.md`.
- **Tests:** `tests/passiveIntelligence.test.tsx` (chip + inbox),
  `tests/roomActivityEvidenceAdapters.test.ts` (outbox/scan).

## Net-new work (sequenced, P0 — IMPLEMENTED)

### Task 3 — Per-actor/per-block debounce keys + maxWait (Convex)

- **Files:** `convex/schema.ts` (add `maxWaitAt?: number`), `convex/roomActivity.ts`
  (`activityDedupeKey`, `enqueueRoomActivity`, new `dismissActivity` + `ignoreActivityRow`),
  `tests/roomActivityEvidenceAdapters.test.ts` (three new cases).
- **Do:**
  - `activityDedupeKey` now includes `actorId` (= `actor.id ?? ownerId ?? "room"`) so each author
    in a shared notebook gets an independent row and quiet window.
  - `enqueueRoomActivity` persists `maxWaitAt = now + MAX_QUIET_MS` on first insert and never bumps
    it on subsequent patches; `effectiveDelay = min(quietMs, maxWaitAt - now)` caps the sliding
    window at the hard deadline.
  - New `dismissActivity` public mutation sets status to `"ignored"` after actor-proof validation;
    `ignoreActivityRow` is the internal counterpart.
- **DoD (met):** three actors enqueuing on the same node get three independent rows (per-actor key
  test); a single actor typing past `MAX_WAIT_MS` collapses to delay = 1ms (maxWait cap test);
  `dismissActivity` sets status to `"ignored"` (dismiss test); all three pass in
  `roomActivityEvidenceAdapters.test.ts`.

### Task 1 — Notebook-default surface (all rooms, always)

- **Files:** `src/ui/RoomShell.tsx` (lines 62 and 99), `src/app/styles.css` (placeholder CSS),
  `scripts/walkthroughs/specs.ts` (`naive-overwrite` spec — add "open sheet" step).
- **Do:**
  - `artId` lazy initializer: `arts.find(a => a.kind === "note")?.id ?? arts.find(a => a.kind === "sheet")?.id ?? arts[0]?.id ?? ""`
  - `curArt` fallback: same preference order for async-load ticks where `artId = ""`.
  - Notion-style ghost text via CSS: `.r-note .ProseMirror.is-editor-empty > p:first-child::before`.
    Placeholder text: "Who did you talk to? What company/product came up? Any funding, pricing,
    hiring, or runway signal? Paste links here — NodeRoom will organize them." Never persists.
  - `naive-overwrite` (optIn, memoryDemo) prepends an explicit "open Q3 variance" step since
    notebook is now the default and the spec clicks sheet cells directly.
- **DoD (met):** opening any room lands on the notebook; empty note shows placeholder; a room with
  no notebook falls back to sheet; `naive-overwrite` spec explicitly opens the sheet before clicking
  cells; no tour/walkthrough regressions (`createRoom` setups already navigate to Q3 variance in
  `capture.ts:97`).

### Task 2 — Actionable Noteworthy Inbox (Research / Add to sheet / Dismiss)

- **Files:** `src/ui/insights/NoteworthyInbox.tsx`, `src/ui/insights/PassiveAgentChip.tsx`,
  `src/app/store.tsx` (interface + memory stubs + Convex live), `src/app/styles.css`,
  `tests/passiveIntelligence.test.tsx`.
- **Do:**
  - Three buttons per item with stable testids: `noteworthy-research`, `noteworthy-add`,
    `noteworthy-dismiss`.
  - `PassiveAgentChip` gains a `me: Actor` prop and passes action handlers to `NoteworthyInbox`.
  - Store interface adds `dismissActivity`, `researchActivity`, `addActivityToSheet`.
  - Memory mode: handlers mutate `memPassiveRef.current` and call `setMemPassiveRev` to trigger
    re-render. Dismiss drops the item; Research flips status to `"job_created"`.
  - Live Convex: Dismiss calls `api.roomActivity.dismissActivity`; Research calls
    `api.agentJobs.start` with a passive-research goal; Add calls `api.artifacts.addResearchRows`.
  - Research button hidden when `pill.tone === "researching"` (item already in progress).
- **DoD (met):** Dismiss removes item from chip count; Research flips pill; Add proposes a row;
  five new test cases in `passiveIntelligence.test.tsx` cover all three actions + the Research
  button hiding rule; live mutations validate actor proof.

### Task 4 — Deterministic passive seed for memory mode

- **Files:** `src/app/store.tsx` (`EngineStoreProvider` — `DEMO_PASSIVE_SEED`, `memPassiveRef`,
  `memPassiveRev`).
- **Do:** `DEMO_PASSIVE_SEED` = scripted CardioNova item (entity, reasons, facets, score, textPreview)
  returned when `roomId === demo.roomId`. Mutable via action handlers (Task 2). Non-demo memory
  rooms stay `[]`.
- **DoD (met):** `memoryDemo` setup renders the chip immediately from seed; dismiss/research mutate
  the list reactively; no live backend required.

### Task 6 — Walkthrough entry `first-time-banker-capture`

- **Files:** `scripts/walkthroughs/specs.ts` (new `FeatureSpec`).
- **Do:** `setup: "memoryDemo"`, `closePanels: ["left"]`, seven steps:
  1. State — land on notebook, placeholder visible.
  2. Type into `[data-testid="note-editor"] .ProseMirror` — the banker's notes.
  3. State — "The room is watching."
  4. Loading — wait for `[data-testid="passive-agent-chip"]` (deterministic from seed).
  5. Click chip → inbox opens.
  6. Click `[data-testid="noteworthy-research"]` → pill flips to Researching.
  7. State — "Suggest, don't automate: you chose what to do with it."
- **DoD (met):** spec is registered; `npx tsx scripts/walkthroughs/capture.ts first-time-banker-capture`
  will produce clean per-state frames; honest labeling (memory-mode deterministic).

## Deferred work (P1 — DO NOT BUILD in this deliverable)

### P1 — Batched `CellPayload` writes with payload-hash skip

- **File:** `src/nodeagent/skills/spreadsheet/cellMutator.ts`
- **Why deferred:** requires changes to the agent loop's write-path; no walkthrough spec depends on it.

### P1 — Agent output levels (scratch → status → proposal → artifact)

- Persistent text streaming over a single message would replace the current one-shot reply model.
  Required for multi-step research narration; deferred until the streaming substrate stabilizes.

### P1 — Cache-hit surfacing

- `entityResearchCache` hit results should surface in the inbox alongside new research results.
  Currently the cache is read only by the downstream worker (scaffolded, out of scope).

## Deferred work (P2 — DO NOT BUILD in this deliverable)

### P2 — `batchScanRoomActivity` aggregator

- Group by entity/facet/privacy into one parent job + child `entityWorkItems`; single-flight dedupe.
  Required before high-volume production use; out of scope for the magic-moment demo.

### P2 — Room/workspace/global cache scopes on `entityResearchCache`

- Current cache is per-room only. Workspace and global scopes would let two rooms share research
  on the same entity without redundant LLM calls. Deferred until the cache schema stabilizes.

### P2 — Stress harness + scenarios A–E

- Scenarios (burst edits, concurrent writers, stale cache, privacy boundary, large note) and pass
  criteria from the consolidation note. Required before production scaling; out of scope here.

## Interfaces

### Outbox schema additions (`convex/schema.ts`)

```ts
maxWaitAt?: v.optional(v.number()), // hard scan deadline = createdAt + MAX_QUIET_MS (60s)
dismissedBy?: v.optional(v.string()), // actor.id of the member who dismissed (audit trail)
```

### Per-actor dedupe key (`convex/roomActivity.ts`)

```ts
activityDedupeKey({ roomId, sourceKind, sourceId, eventKind, actorId, ownerId })
// key = "activity:roomId:sourceKind:sourceId:eventKind:(actorId ?? ownerId ?? 'room')"
```

### Server-side action mutations (`convex/roomActivity.ts`)

```ts
// Scope derived from the STORED outbox row's visibility — never client-supplied.
researchActivity(activityId, roomId, requester): Promise<{ ok: boolean; reason?: string }>
// Sets status to "ignored" + records dismissedBy for audit.
dismissActivity(activityId, roomId, requester): Promise<{ ok: boolean; reason?: string }>
```

### Inbox action handler signatures (`src/app/store.tsx`)

```ts
dismissActivity(activityId: string, actor: Actor): Promise<void>;
researchActivity(item: PassiveActivityItem, actor: Actor): Promise<void>;
addActivityToSheet(item: PassiveActivityItem, actor: Actor): Promise<void>;
```

### Memory seed shape (one `PassiveActivityItem`)

```ts
{
  id: "mem-passive-cardionova-1",
  sourceKind: "node",
  sourceId: "mem-node-1",
  eventKind: "content_committed",
  status: "noteworthy",           // actionable (not in QUIET_STATUSES)
  visibility: "room",
  entityNames: ["CardioNova"],
  facets: ["funding", "runway_inputs"],
  reasons: ["company_mention", "finance_signal", "research_signal"],
  score: 0.82,
  action: "start_research_job",
  textPreview: "Met Maya from CardioNova. AI triage for hospitals. Possible Series B. Need to ask about burn and hospital pilots.",
}
```
