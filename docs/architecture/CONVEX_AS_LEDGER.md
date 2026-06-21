# Convex as the ledger — architecture boundaries

> Status: authoritative. This doc encodes the durable boundary rule for NodeRoom and is
> grounded in repository evidence (file:line) plus quoted Convex docs. Every claim is tagged
> **CONFIRMED** (already true in code), **REFINED** (true, but the rule adds needed nuance),
> **CONTRADICTED** (the rule is wrong about the code), or **NET-NEW** (does not exist yet).
> Where the rule names something the code already does, this doc says so — built things are
> not relabeled as new. Where validation contradicted the rule, it is flagged inline.

---

## 1. The rule

**Convex is the durable collaboration LEDGER — NOT the keystroke pipe, NOT the agent
scratchpad, NOT the OLAP warehouse.**

Strongest form:

- **Local workbook runtime** owns instant UX (keystrokes, selection, in-flight paint, undo/redo, and — when built — formula recalc). Typing never round-trips.
- **Convex** owns **narrow, authoritative, reactive commits**: per-element CAS values + versions, locks, drafts, proposals, agent jobs/leases, traces, proofs, messages. This is the system of record.
- **Persistent text streaming** carries **agent narration** as a durable text lane — never the cell-write path.
- **Agent branches / patch-bundles** carry long jobs; the runner rebases against current versions at publish.
- **Short commit leases** apply **only at publish**, on the exact target cells — not as a blanket hold across the whole job.
- **OLAP later** — Convex is OLTP; analytics/warehouse is a downstream concern, not this engine.

The cost model that makes this matter: **NodeRoom is on Convex, and reactive queries re-ship the
FULL result to every subscriber whenever the query's read-set changes.** Convex docs, verbatim:
"Whenever any data on which a query depends changes, the query is rerun, and client subscriptions
are updated" (docs.convex.dev/understanding). "The sync engine reruns query functions when any
input to the function changes ... then updates every app listening to the query"
(docs.convex.dev/tutorial). So the size of a query's read-set is the broadcast cost on every
write. **The whole rule reduces to: keep authoritative read-sets narrow, keep keystrokes local,
keep narration in its own text lane, and keep heavy/long work off the live commit path.**
**[CONFIRMED]** — Convex docs + repo: unbounded `.collect()` in hot read-sets (`rooms.full`
at `convex/rooms.ts:93-138`, `lockCoveringElement` at `convex/lib.ts:166-171`, `activeLocks`
at `convex/locks.ts:104`) amplifies on every change.

---

## 2. Layer map — what each layer owns and must NOT own

| Layer | Owns | Must NOT own | Status in repo |
|---|---|---|---|
| **Local workbook runtime** (live: component-local edit buffer + Convex optimistic cache; memory mode: home-grown `RoomEngine`) | Keystrokes, selection, in-flight optimistic paint, undo/redo, (future) formula recalc + range selection | Authoritative truth; cross-tab durability; agent-readable state | Keystrokes **[CONFIRMED]** local (uncontrolled input, commit on blur, `Artifact.tsx:929-955`); undo/redo **[CONFIRMED]** (`store.tsx` `undoStack`); recalc + range selection **[NET-NEW]** |
| **Convex OLTP ledger** | Per-element value+version (CAS), locks, drafts, proposals, agent jobs/leases, traces, proofs, messages | Per-keystroke state; per-token narration; OLAP rollups; uncommitted human buffer | **[CONFIRMED]** — `elements` (CAS), `locks`, `drafts`, `proposals`, `agentJobs`, `agentLeases`, `traces`, `messages` all exist |
| **Persistent text streaming** (`@convex-dev/persistent-text-streaming`) | Agent narration text: owner token stream + persisted sentence-flushed chunks, finalized to the durable `messages` row | Cell values; structured patches; anything history/export/search reads as truth | **[CONFIRMED]** — fully wired (`convex/streaming.ts`, `convex/http.ts`, `convex/streamingModel.ts`) |
| **Ephemeral relay / advisory presence** (cursors / live draft buffer) | Presence cursors, live keystroke buffer (browser-local only) | Agent context; durable state; anything committed | **[PARTIAL SHIPPED]** — spreadsheet cell presence and server-side agent intent use a bounded `presenceClaims` side table/subscription; no WebRTC, no Yjs/CRDT grid, no `streamChunks` cell table (`AGENT_SCRATCHPAD_CELL_COLLAB.md:32-35`) |
| **OLAP warehouse** | Analytics, aggregations, history rollups | Live reactive reads; commit path | **[NET-NEW / later]** — deliberately deferred |

---

## 3. Per-bottleneck prescription

For each: what to **KEEP**, what to **CHANGE**, and **already-exists (cite) vs net-new**.

### B1 — Kill `rooms.full`; split into narrow reactive queries + viewport range query

- **KEEP**: the 9 already-separate client subscriptions (`store.tsx:456-467` — `rooms.full`,
  `messages.list` ×2, `collab.traces`, `agentRuns.list`, `agentJobs.list/attempts/detail`,
  `artifacts.listProposals`). `traces`, `agent.jobs.*`, and `proposals` are **already** separate
  surfaces. **[CONFIRMED]** Do not re-invent them.
- **CHANGE**: delete the monolith. `rooms.full` (`convex/rooms.ts:93-138`) collapses 6
  collections (room + members + artifacts + **every element of every artifact** + locks +
  sessions + drafts) behind ONE subscription, so **any single-cell edit re-ships the entire
  room to every member** (N artifacts × M elements fan-out). **[CONFIRMED]** — this is the
  single biggest reactive read-set in the app. Split into: `room.meta` (`ctx.db.get(roomId)` +
  autoAllow), `members.presenceSummary`, `binder/artifact.list` **without** the inner elements
  `.collect()` loop, `locks`, `sessions`, `drafts` — each an independent subscription.
  **[CONFIRMED buildable on current schema]** — every index needed already exists
  (`artifacts.by_room`, `elements.by_artifact`, `locks.by_room_status`, `agentSessions.by_room`,
  `drafts.by_room_status`).
- **Viewport range query** — **the one genuine schema gap.** The live `elements` table is
  indexed only `by_artifact` on `[artifactId, elementId]` (`schema.ts`) with **no
  rowIndex/colIndex**, so it cannot serve a row/col range. The `by_artifact_row_col` index
  exists on `spreadsheetCells`, but that table is a sheet-only semantic/index projection, not
  the raw value+version CAS ledger. **[PARTIAL UPDATE 2026-06-20]**: `applyCellEdit`
  now schedules/coalesces `spreadsheetIndexRefreshes` instead of rebuilding the semantic
  projection inline on every cell write. Viewport indexing is still separate net-new schema:
  add `rowIndex` + `colIndex` to `elements`, add
  `.index("by_artifact_row_col", ["artifactId","rowIndex","colIndex"])`, and update only
  the structural row/column coordinates required by the live viewport path.

### B2 — Paginate FIRST (messages, traces, job attempts, op events)

- **KEEP**: the existing indexes — nothing new needed (`messages.by_room_channel` `schema.ts:171`,
  `traces.by_room` `schema.ts:189`, `agentJobAttempts.by_job`, `agentOperationEvents.by_job_sequence`).
- **CHANGE**: `messages.list` (`convex/messages.ts:79-86`) and `collab.traces` (`convex/collab.ts`)
  are unbounded `.collect()` — and `messages` is subscribed **twice** (public + private channel,
  `store.tsx:459-460`). Swap `.collect()`/`.take()` for `.paginate(paginationOpts)` +
  `usePaginatedQuery`. **[CONFIRMED]** — Convex docs: "Like other Convex queries, paginated
  queries are completely reactive" (docs.convex.dev/database/pagination).
- **Status**: **[NET-NEW code, zero schema]** — **zero** `paginate`/`usePaginatedQuery`/
  `paginationOpts` hits anywhere in source (verified: matches appear only under `docs/`). This is
  the pure-win, native, low-hanging fruit; ship it before the B1 split.
- Nuance **[REFINED]**: `collab.awareness()` (agent-context internalQuery) is **already** bounded
  via `.order("desc").take(6)` — the unbounded read is the client-facing `collab.traces`, so the
  pagination target is `collab.traces` specifically.

### B3 — Narrow queries + normalized client store + virtualization

- **KEEP**: the narrow queries that already exist (`agentJobs.list` is already `.take(20)`;
  `agentJobs.detail`, `artifacts.listProposals` are separate subscriptions). **[CONFIRMED]**
- **CHANGE**: once `rooms.full` is split (B1), the client store should key surfaces independently
  so a cell commit's optimistic write targets a small object, not the whole-room object. Today the
  optimistic commit handler reads + rebuilds the **entire** `rooms.full` object on every cell
  commit (`store.tsx:470-473`), making the commit O(room). **[CONFIRMED]** — this is the real
  scaling gap behind the "~0ms felt latency": a mechanism claim, not a measured SLA, that degrades
  as the room grows (`ARCHITECTURE.md:164-171`, `QA_FINDINGS.md` P1-8). Virtualize the grid against
  the viewport range query from B1.

### B4 — Route `/ask` through the queue + admission control

- **KEEP**: the structural boundary, which is **[CONFIRMED]** correct — the agent runtime lives in
  an **action** (`convex/agent.ts:65`) that calls providers and delegates every durable write to
  **internalMutations**. Every LLM-callable write tool is internal (`locks.proposeLock`
  `locks.ts:16`, `releaseLock` `locks.ts:67`, `artifacts.applyAgentCellEdit` `artifacts.ts:512`,
  `drafts.createDraft` `drafts.ts:26`, `messages.sendAgent` `messages.ts:31`), resolved only via
  `ctx.runMutation` from inside the action (`convexRoomTools.ts`). **Clients/LLM cannot call raw
  writes.** (Humans have their own separate *public* audited mutations — `applyCellEdit`,
  `resolveProposal`, `addResearchRows`, `createArtifact`.)
- **Historical before June 16**: `/ask` was already observable — it created an `agentJobs` row (`runtime:'inline'`) and an
  `agentRuns` row, and has **dollar** admission control (daily `ROOM_MAX_USD_PER_DAY` `agent.ts:102-104`,
  monthly `GLOBAL_MAX_USD_PER_MONTH` `agent.ts:110-114`, in-run `spendLimits` ceiling `agent.ts:323-326`,
  fail-closed). It also has **deterministic idempotency** (`idempotency.ts:25-30`, FNV-1a over
  sorted/normalized keys; atomic claim-or-reuse via `by_idempotency`, `agentJobs.ts:79-81`) that
  dedupes the *same* goal. **[CONFIRMED]**
- **Historical before June 16**: `/ask` ran **inline + uncapped on concurrency** (`store.tsx:603,708-722` →
  `api.agent.runRoomAgent`), while `/free` enqueues a lease-guarded durable workflow
  (`store.tsx:754` → `startFreeAuto` → `freeAutoWorkflow`). **[CONFIRMED]** Add a per-room +
  global concurrency cap, OR re-route `/ask` onto the existing workflow/workpool lane so
  `maxParallelism: 3` applies. **[NET-NEW]** — verified: the **only** `maxParallelism` in the repo
  is on the workflow component (`agentWorkflows.ts:9`); there is **no** running-job counter gating
  the action. Add a **token-budget preflight** (estimate prompt+context tokens, reject before the
  model call). **[SUPERSEDED]** Public room-agent start now routes through the
  durable `agentJobs.start` lane below; remaining capacity work is queued/running
  caps and token preflight.
- **June 16 implementation update**: public room agent starts now go through
  `agentJobs.start`, not separate `/ask` and `/free` implementations. The job
  row carries `entrypoint`, `routePolicy`, `runtimePolicy`, `modelPolicy`,
  approval/evidence policy, idempotency, and an operation event. `/free` is the
  same route with `routePolicy=free_auto`; `/ask` is the same route with
  `routePolicy=fast_default`; paid benchmark jobs can use `routePolicy=top_paid`
  or `explicit`. Remaining capacity work is per-room/global queued/running caps
  plus token preflight before provider calls.
- Nuance **[REFINED]**: `agentJobs.by_status_nextRunAt` exists (`schema.ts:281`) but is **dormant
  for dispatch** — no `agentJobs` query reads it; `/free` concurrency is enforced by the workpool,
  not by polling that index. Making it the admission queue would require a net-new poller/claimer.

### B5 — Intent-claim + short commit lease + CAS + proposals (NOT blanket LWW for finance cells)

- **KEEP**: the CAS spine — per-element `version`, `drafts.baseVersion` + ops, and
  `agentMutationReceipts` before/after — is the durable no-clobber foundation. **[CONFIRMED]**
  Keep proposals as the conflict-resolution lane for human-active cells. Never use blanket
  last-write-wins on authoritative finance cells; CAS + proposals is the correct discipline.
- **CHANGE — this is where the rule genuinely CONTRADICTS current behavior.** Today a long job is
  **expected to hold a 5-minute renewing range lock across 9-minute slices**: `LOCK_TTL_MS = 5*60_000`
  with the comment "the write path RENEWS this on every successful locked write" (`lib.ts:150-153`);
  renewal on each locked write (`artifacts.ts:280-282`); the modeled long job takes
  `propose_lock` on **all** targets at turn 1 and releases at turn 4
  (`evals/financeModelLive.ts:399-402`). **[CONTRADICTED]** — this is the exact pattern the rule
  warns against. It is bounded only by TTL auto-expiry (`locks.ts:116-139`) + host "yoink" force-release
  (`locks.ts:147-171`) + CAS-absorbs-stale-writes; it is **not** a publish-only short lease.
- **CHANGE**: introduce the two-tier model. Today there are exactly two legacy lock-like things:
  (1) the **hard, dependency-expanded, renewing range lock** (`locks` table) and (2) the
  **per-slice runner write-lease** (`agentLeases`, `agentJobs.ts:512-618`, mode
  read|write|structural, expires at slice budget). **[PARTIAL SHIPPED 2026-06-20]**:
  server-side agents can now publish a bounded `agent_intent`/`commit_lease` advisory
  presence claim that does NOT block other actors. Still net-new: plan-time affected-set
  derivation, patch-bundle publish integration, and live browser proof for the full
  conflict/proposal flow.

### B6 — Agents emit patch-bundles / proposals vs a snapshot baseVersion

- **KEEP**: the read side is **[CONFIRMED]** correct — the agent's only sheet-state source is
  **last-committed** elements via reactive reads (`artifacts.ts:74-86` `readRange` returns
  `{value, version, locked}`; `getSheet` `artifacts.ts:123` is the read-query "snapshot";
  `convexRoomTools.ts:40-55`). The design **forbids** hot-swapping a live buffer
  (`AGENT_SCRATCHPAD_CELL_COLLAB.md:64-68,134`). Keep the working room-level rebase resolver:
  `drafts.mergeBlockedDrafts` (`drafts.ts:39-76`) does clean-apply / no-op / flag-on-divergence,
  triggered at lock release / TTL sweep / host yoink. **[CONFIRMED]**
- **CHANGE**: generalize that rebase from **lock-release-triggered** to **publish-triggered**, and
  give long jobs a frozen baseline instead of a held lock.
- **Status — mostly [NET-NEW]**:
  - Snapshot-as-branch / copy-on-write artifact fork / patch-bundle apply: **[NET-NEW]** — no
    `snapshot`/`branch`/`fork`/`patchBundle` table or function exists. In code, "snapshot" means a
    point-in-time **read**, not a forked working copy.
  - `agentDraftOperations` + `needs_rebase` job-level ledger: **[NET-NEW / unwired scaffolding]** —
    verified the `needs_rebase` literal appears **only** in the schema enum (`schema.ts:358`) and a
    **read-only** diagnostic query (`agentJobs.ts:339`) plus docs prose (`NODEAGENT_ARCHITECTURE.md:906`).
    **Zero mutations write it.** The shape exists; the producer does not.
  - Per-cell presence (the "mark C2-dependent outputs stale" annotation):
    **[PARTIAL SHIPPED]** for human spreadsheet focus/edit and server-side
    agent intent via `presenceClaims`. Dependency-aware stale annotations and
    plan-time affected-set persistence remain net-new.

---

## 4. The canonical runtime: human edits **C2** while the agent works **A1:C5**

This is the load-bearing scenario. Seven steps. Tags mark each step's current status.

1. **Human edits C2 — locally, dirty, no hard lock.** Keystrokes ride an uncontrolled DOM input;
   the value commits only on blur/Enter/Tab. C2 is "intent-in-progress," not state. **[CONFIRMED]**
   (`Artifact.tsx:929-955`, `Artifact.tsx:768,815-820`).

2. **Agent takes a snapshot + advisory intent claim over A1:C5.** Snapshot = a read of the
   **last-committed** elements (`{value, version, locked}`), never the live C2 buffer.
   Read side **[CONFIRMED]** (`artifacts.ts:74-86`, `convexRoomTools.ts:40-55`). The **advisory,
   non-blocking intent claim** is **[PARTIAL SHIPPED]** as server-only
   `presence.heartbeatForAgent`; what remains net-new is computing and persisting the
   plan-time affected set before the first tool call and proving the browser conflict path.

3. **Agent works in a branch / scratchspace, streams narration, builds a patch bundle.** Narration
   goes through persistent-text-streaming (Section 5). The branch + patch-bundle accumulation is
   **[NET-NEW]** (B6). The agent can already observe spreadsheet human focus/edit
   presence and publish server-side advisory intent through `presenceClaims`;
   dependency-aware stale annotations and plan-time affected-set persistence remain
   net-new. **Do NOT hot-swap the uncommitted C2 buffer into authoritative agent
   reasoning** — the agent reasons over committed values only. **[CONFIRMED]** by design.

4. **Human commits C2 (CAS).** A per-element compare-and-set write lands the new value+version on
   the durable `elements` row. **[CONFIRMED]** (`artifacts.ts` `applyCellEditCore`).

5. **Agent rebases against current versions.** Clean cells (still at the drafted baseline) apply;
   conflicts become **proposals**; diverged/stale rows flag `needs_rebase`. The mechanism exists at
   **room level** (`drafts.mergeBlockedDrafts`, `drafts.ts:39-76`) — **[CONFIRMED]** — but fires on
   **lock release**, not on per-cell human commit, and the **job-level** `needs_rebase` ledger is
   **[NET-NEW / unwired]** (no producer writes the enum). Generalizing the resolver to
   publish-time + wiring the producer is the highest-leverage B6 build.

6. **Short commit lease on the exact target cells — only at publish.** Acquire a short-TTL lease on
   precisely the cells being written, commit the rebased bundle via the managed
   lock/CAS path (`write_locked_cell_results`), release. **[NET-NEW]** — today commit either rides the
   long-held renewing range lock (B5) or the per-slice runner lease; neither is a publish-only
   target-scoped commit lease.

7. **Trace records read / write / skipped / proposed.** The durable `traces` table captures what the
   agent read, wrote, skipped, and proposed. **[CONFIRMED]** (`traces` table; client subscribes at
   `store.tsx:461`) — paginate it per B2.

**The invariant across all seven steps: never hot-swap uncommitted C2 into authoritative agent
reasoning.** The agent reads committed value + version + lock flag; the human's live buffer is the
local runtime's business until it commits. This is the codebase's stated position, not a correction.
**[CONFIRMED]**

---

## 5. Streaming policy

**Narration streams as durable text; cells commit as validated patch batches. There is NO
token-by-token cell-write path anywhere.** **[CONFIRMED]** — verified: no
`streamId`/`append`/`getStreamBody`/`chunkAppender` in the cell-write surface; the token-level
`append` callback lives **only** in `convex/streamingModel.ts` / `convex/http.ts` for the private-agent
narration reply.

The narration loop (all **[CONFIRMED]**, already shipped on the current schema):

- **Create** a persistent stream — `streamingComponent.createStream` (`streaming.ts:37`),
  `streamingComponent` from `components.persistentTextStreaming` (`streaming.ts:27`,
  `package.json:105`).
- **Placeholder** — insert an **empty-text** `messages` row carrying `streamId`
  (`streaming.ts:44-53`; `schema.ts:174`). Client renders `<StreamedBody>` only when
  `m.streamId && !m.text` (`Chat.tsx:812-813`).
- **Metadata** — capture prompt (`goal`) + room context at create time in a **server-only**
  `privateReplyStreams` table (`streaming.ts:54-63`, `schema.ts:182-191`), **never returned to
  clients**. Stronger than the rule states.
- **Owner token stream** — the creating tab POSTs to `/stream-private-reply`
  (`http.ts:54-71`) and reads SSE token deltas (`streamingModel.ts` `await append(delta)` per token).
  "Driven" = `locallyCreatedPrivateStreams.has(streamId)` (`store.tsx:737`).
- **Observers get persisted sentence-flushed chunks** — non-driven sessions fall back to
  `useQuery(api.streaming.getStreamBody)` (`Chat.tsx:108-112`). **[REFINED]**: "observers" here =
  the **owner's own** other tabs / refresh / mid-stream re-read. The private reply is
  **owner-channel-scoped** — `requireActorCanUseChannel` passes only for the owner
  (`lib.ts:142-148`), so other room members get `channel_forbidden`. **There is no public/shared
  narration stream in this path.** A cross-member shared narration stream would be **[NET-NEW]**.
- **Finalize** — patch the durable `messages.text` on completion (`streaming.ts:94-100`,
  `http.ts:70`), so "history, refs, search, and export read message.text and must never depend on
  the component's chunk store" (header comment, `streaming.ts:92-93`, verbatim).
- **Cells** commit as validated **batches** via lock/CAS tools — `write_locked_cell` /
  `write_locked_cells` / `write_locked_cell_results` / `validate_calc_artifact` (`tools.ts:203-461`).
  `validate_calc_artifact` "returns an evidence-bearing patch bundle only; it never commits."

Honesty corrections to absorb:

- **[CONTRADICTED]** NodeRoom does **not** use the library's `useStream` hook. It hand-rolls
  `usePrivateReplyStream` (`Chat.tsx:92-118`) + a module-level driver registry (`Chat.tsx:36`) +
  manual fetch driver (`Chat.tsx:52-90`) to thread its `{actor, token}` proof through both the HTTP
  POST and the `getStreamBody` query. Same end behavior, custom auth-aware implementation — net-new
  code the rule does not mention, not a defect.
- **Do NOT claim flicker is "mathematically eliminated."** Convex docs, verbatim: "try inserting a
  mistake into this update! You should see a flicker as the optimistic update is applied and then
  rolled back" (docs.convex.dev/client/react/optimistic-updates). **[CONTRADICTED]** — one repo
  **source comment** overstates this: `store.tsx:399-405` asserts "zero TEMPORAL flicker is the
  platform's guarantee" (and `store.tsx:506` "Zero-flicker deepening"). Reword to conditional:
  flicker is avoided **only** when the mutation succeeds AND the optimistic value shape-matches the
  server echo; a rejected/CAS-conflicting mutation flickers (apply-then-rollback) by design.
  **[REFINED]** the **prose docs** (`OPTIMISTIC_UI_PLAN.md`, `ARCHITECTURE.md`, `QA_FINDINGS.md`)
  are already honest/hedged ("flicker-free IF shape-matched", "mechanism-true but unmeasured") —
  credit them; the overstatement lives in the one code comment.
- Optimistic handlers correctly treat localStore results as **immutable** (`store.tsx:399-401`
  return new objects) per the Convex doc mandate. **[CONFIRMED]**

---

## 6. Algorithm artifacts — author once, rerun deterministically

The rule frames this as "the missing piece." **[CONTRADICTED on the "missing/net-new" framing]** —
the core mechanic is **already implemented and tested** in the working tree.

- **Authored artifact shape exists** — `AlgorithmArtifact` (`src/nodeagent/skills/spreadsheet/algorithmArtifacts.ts:38-52`):
  `inputs[{id, elementId, label}]`, `outputs[{id, elementId, expression, format}]`, `constraints`,
  `evidencePolicy`, `tests[]` (`:23-28`). The rule's "inputs B2,C2; formula =C2-B2; output D2;
  evidence; tests" maps 1:1. **[CONTRADICTED — already built]**
- **Tests gate commit** — `runArtifactTests` (`:301-318`) evaluates expression vs `expected` within
  tolerance; failing tests return `{ok:false}` and no bundle is produced. **[CONFIRMED]**
- **Deterministic rerun without re-LLM** — `runAlgorithmArtifact` is a pure fn over a snapshot
  (`:117`); the test "reruns from a changed snapshot without another model plan" recomputes from new
  values with the same `artifactHash` (`tests/algorithmArtifacts.test.ts:78-95`). Deterministic
  constraints enforced (`:230-233`); stable FNV-1a hash over sorted keys (matches the sorted-key CAS
  rule). **[CONFIRMED]**
- **Author / runner / harness separation** — `run_algorithm_artifact` is in the model-facing
  `ROOM_TOOLS` catalog (`tools.ts:417`); `commitPolicy` is `patch_bundle_only_runtime_must_cas`
  (`:70-75`) so the run **never commits** — it returns a patch bundle, then `write_locked_cell_results`
  commits through managed CAS. **[CONFIRMED]** — exactly "LLM authors workflow, runner executes,
  harness commits," consistent with THE RULE (runtime is the authoritative committer).
- **Evidence-bearing output** — `buildEvidence` emits one `computed` + one `source` per input ref;
  `proof.inputRefs` carry version + valueHash, `outputRefs` carry baseVersion + expression
  (`:86-104`, `:330-352`). **[CONFIRMED]**

Two honesty caveats:

- **[REFINED]** It is **uncommitted working-tree** code (untracked `src/nodeagent/skills/spreadsheet/algorithmArtifacts.ts`,
  `tests/algorithmArtifacts.test.ts`, `scripts/algorithm-artifact-smoke.ts`,
  `docs/eval/algorithm-artifact-smoke.json`; modified `tools.ts`/`README.md`/`package.json`; no git
  history). Against the last commit it reads as net-new even though it physically exists and passes
  tests. **Land it.**
- **[NET-NEW]** "Rerun over future **rows/sheets**" is **not** yet true. Today the runner reruns the
  **same** cells on a changed snapshot (or a different sheet via `artifactId`); it does **not**
  iterate one template across N rows by remapping B2/C2/D2 → B3/C3/D3. The row/range apply-down layer
  is the one genuine net-new build, and it sits on the existing runner with **no new Convex schema**.
  A durable artifact registry (a Convex table keyed by `algorithmId` + `artifactHash`) is **optional**
  — only needed for cross-session reuse, and is the only part that would touch the schema.

---

## 7. Implementation order

Sequenced by leverage and dependency. Size = S/M/L. Each tagged already-have vs net-new.

| # | Step | Size | Status |
|---|---|---|---|
| 1 | **Bound the reactive history reads** — `collab.traces` → recent 200, `messages.list` → recent 500 | S | **B2 — ✅ SHIPPED + verified** (`convex/collab.ts`, `convex/messages.ts`; array shape preserved → zero consumer breakage, durable history intact; proven by `tests/historyFeedWindow.test.ts`, 3 convex-test cases). |
| 1b | **Load-older cursor** — `usePaginatedQuery` for scroll-back beyond the window (job attempts/op events too) | M | **Follow-on / NET-NEW** (B2). Shape change → store-interface migration + Chat consumer; needs a live Convex backend (`E2E_CONVEX_URL`) to prove reactivity, so deferred from the window-bound. |
| 2 | **Split `rooms.full`** → `rooms.meta` (room shell, NO cell elements) + `artifacts.elements` (per-artifact) | M | **B1 — ✅ SERVER SPLIT shipped + proven** (`convex/rooms.ts` `meta`, `convex/artifacts.ts` `elements`; `rooms.full` kept for back-compat; pushed to dev via `npx convex dev` on 2026-06-13 (codegen only regenerates TYPES; it does NOT deploy functions — the dev deployment had silently lagged, caught by live verification)). Proven by `tests/roomsFullSplit.test.ts` (3 convex-test cases): `meta` < 1/3 of `full` bytes & carries no elements; per-artifact scoping; **read-set proof** — a cell edit at the ELEMENT level leaves `meta` byte-identical while only the edited artifact's elements change. CAVEAT (found 2026-06-13): the real `applyCellEditCore` ALSO bumps the artifact row (version+updatedAt) on every edit, so `meta` re-ships the small SHELL per edit too — that is the Phase 1 vs Phase 2 split (Phase 2 = stop the per-`set` artifact-row bump so `meta` goes fully stable). |
| 2b | **Client migration** — store subscribes to `rooms.meta` + `artifacts.elements(openArtifactId)` (+ split-secondary + wiki) instead of `rooms.full`; merge into the `Artifact[]` interface | M | **SHIPPED + LIVE-VERIFIED 2026-06-13 (commit ac8be24)** (B1 **Phase 1**) — store.tsx subscribes to `rooms.meta` + one `ArtifactElementsSubscriber` per artifact (materializer merges shell+cells; all 5 optimistic writebacks split across the two caches). Live-verified on Q3DEMO: room loads, cells render, a hand edit paints optimistically + persists server-side + bumps the artifact version (v30->v32), zero console errors / no render loop. Measured per-edit re-ship dropped from ~64.5 KB whole-room → edited-artifact only. Risk: non-subscribed artifacts lose their cells (wiki/split consumers) → subscribe their elements too. Needs the live app (dev now has the queries) for single-client verification; multi-client fan-out drop is Convex-guaranteed by the read-set split. **Blast radius (measured): ~40 `art.elements` read-sites** — `store.tsx` optimistic-CAS core / demo collab / research / undo, all of `Artifact.tsx` renderers, `LeftRail`, and `agent/roomTools` (engine-backed → unaffected). The store interface is **shared with memory mode**, which keeps elements embedded, so **the memory e2e suite cannot catch live-mode breakage from this refactor** — it must be migrated **live-incrementally, surface by surface**, verified against the live dev app (confirmed healthy 2026-06-13 with the deployed bounds), not blind one-shot. (RESOLVED 2026-06-13: implemented in one isolated git-worktree pass + typecheck gate + atomic land on main + live verification. The "subscribe ALL room artifacts via one subscriber each" design made the ~40-site blast radius a non-issue — closed-artifact row counts read `order` from `meta`, not elements. The memory-mode e2e stayed green as predicted, so live verification against the dev app was the real gate; it also caught the un-pushed dev deployment.) **Phase 2 (NET-NEW, separate):** stop `applyCellEditCore` bumping the artifact row on a `set` so `meta` stops re-shipping per edit — gets the remaining -74% to -93%; higher blast radius (core write path), needs its own convex-test + version-display check. |
| 3 | **Branch / patch-bundle / publish-time rebase layer** — generalize `mergeBlockedDrafts` to publish-triggered; **wire** the `agentDraftOperations` + `needs_rebase` producer | L | **NET-NEW** (B5/B6); CAS spine (`elements.version`, `drafts.baseVersion`, `agentMutationReceipts`) already exists as the foundation. |
| 4 | **Generalize streams** — only if cross-member shared narration is wanted (a public stream distinct from the owner-scoped private reply) | M | **NET-NEW** (Section 5); owner-scoped path already shipped. |
| 5 | **PlanPreview scheduler / admission control** — route `/ask` onto the workpool lane (or add per-room+global running-job gate) + token preflight | M | **NET-NEW code on sufficient schema** (B4); dollar caps + idempotency already exist. |
| 6 | **C2 / A1:C5 eval** — an eval case that authors-then-reruns through the canonical 7-step flow (incl. soft intent-claim + publish-lease) | M | **NET-NEW**; `financeModelLive` exists but holds the long range lock (the anti-pattern). |
| 7 | **Algorithm artifacts** — **commit** the existing feature; build the **row/range apply-down** extension; add a finance/professional eval lane | S (land) + M (row layer) | Core **already built & tested** (Section 6); row template + eval lane are **NET-NEW**. |
| 8 | **Measure before WebRTC** — instrument reactive read-set sizes + felt latency at room scale before adding any ephemeral relay / WebRTC | S | **NET-NEW**; ephemeral relay is deliberately out of scope until measured. |
| — | **Net-new schema** (do alongside #2): add `rowIndex`/`colIndex` + `by_artifact_row_col` to **`elements`** for the viewport range query; (later) `cellPresence` for human-active/stale | M | **NET-NEW SCHEMA** (B1/B6) — the only schema changes the whole roadmap needs. |

---

## 8. Already true vs net-new (summary)

| Capability | Status | Evidence |
|---|---|---|
| Persistent-text-streaming narration loop (create → placeholder → owner token stream → persisted chunks → finalize) | **CONFIRMED (shipped)** | `streaming.ts:27,37,44-100`, `http.ts:54-71`, `streamingModel.ts` |
| Cells commit as validated batches; no token-by-token cell write | **CONFIRMED** | `tools.ts:203-461`; token `append` quarantined to narration |
| Agent reads last-committed elements only; no hot-swap of live buffer | **CONFIRMED** | `artifacts.ts:74-86`, `AGENT_SCRATCHPAD_CELL_COLLAB.md:64-68` |
| Room-level rebase resolver (clean / no-op / flag) | **CONFIRMED** | `drafts.ts:39-76` |
| Keystrokes local (uncontrolled input, commit on blur); undo/redo | **CONFIRMED** | `Artifact.tsx:929-955`; `store.tsx undoStack` |
| Agent runtime = action; all agent writes are internalMutations | **CONFIRMED** | `agent.ts:65`; `locks/artifacts/drafts/messages` internalMutations |
| `/ask` dollar caps + deterministic idempotency | **CONFIRMED** | `agent.ts:102-114,323-326`; `idempotency.ts:25-30` |
| Algorithm artifacts (author / deterministic rerun / test-gated / evidence-bearing / harness commits) | **CONFIRMED (working tree, uncommitted)** | `src/nodeagent/skills/spreadsheet/algorithmArtifacts.ts`, `tests/algorithmArtifacts.test.ts` |
| "Extend home-grown engine, not adopt Univer" | **CONFIRMED** | `docs/synthesis/specs/C_UNIVER_RUNTIME.md` |
| Reactive queries re-ship full results on read-set change | **CONFIRMED** | Convex docs + `rooms.full`, `lib.ts:166-171`, `locks.ts:104` |
| `useStream` hook used | **CONTRADICTED** — hand-rolled for `{actor,token}` proof | `Chat.tsx:36-118` |
| "Flicker mathematically eliminated" (source comment) | **CONTRADICTED** — Convex docs say flicker on rollback | `store.tsx:399-405`; docs.convex.dev |
| Long job holds short publish-only lease | **CONTRADICTED** — holds 5-min renewing range lock across slices | `lib.ts:150-153`, `artifacts.ts:280-282`, `financeModelLive.ts:399-402` |
| Viewport range query buildable on current schema | **CONTRADICTED** — `by_artifact_row_col` only on the wrong table (`spreadsheetCells`, dead index); `elements` has no row/col | `schema.ts:99,527-537` |
| Pagination (`.paginate`/`usePaginatedQuery`) | **NET-NEW** — zero source hits | grep: docs-only |
| Per-room/global concurrency cap on `/ask`; token preflight | **NET-NEW** | only `maxParallelism:3` on workflow (`agentWorkflows.ts:9`) |
| Snapshot/branch/patch-bundle storage | **NET-NEW** — "snapshot" in code = a read | no such table/fn |
| `agentDraftOperations` + `needs_rebase` job-level ledger | **NET-NEW / unwired** — enum + read-only diagnostic, zero producers | `schema.ts:358`, `agentJobs.ts:339` |
| Soft advisory intent claim (distinct from hard lock) | **PARTIAL SHIPPED** | human spreadsheet focus/edit and server-side agent intent exist via `presenceClaims`; plan-time affected sets and browser/live agent-intent conflict flows still net-new |
| Per-cell presence for stale annotation | **PARTIAL SHIPPED** | spreadsheet presence rows exist; formula/dependency stale annotation and notebook/deck presence still next |
| Live formula recalc + range selection | **NET-NEW** | `roomEngine.ts` has zero recalc; single-cell `sel` only |
| Cross-member shared narration stream | **NET-NEW** | private reply is owner-channel-scoped (`lib.ts:147`) |
| Algorithm-artifact rerun over future rows/sheets | **NET-NEW** | runner reruns same cells on changed snapshot only |

---

## 9. Open decisions

1. **Viewport source**: extend `elements` with row/col + range index (correct, CAS-backed, net-new
   schema) **vs** activate the dead `by_artifact_row_col` on `spreadsheetCells` as a read-only,
   lagging, sheet-only viewport. Recommend extending `elements`.
2. **`/ask` admission**: re-route onto the existing workflow/workpool lane (reuses `maxParallelism:3`)
   **vs** add a standalone per-room+global running-job gate at action entry. Re-routing is less code
   but changes `/ask` latency semantics (inline → queued).
3. **Does "observers" include cross-member room participants?** If yes, a shared/public narration
   stream is net-new; if no (current design), the owner-channel scope stands and nothing is needed.
4. **Artifact persistence**: keep algorithm artifacts ephemeral (tool-call payloads) **vs** add a
   durable Convex registry keyed by `algorithmId`+`artifactHash` for cross-session reuse — the only
   algorithm-artifact item that touches the schema.
5. **Intent-claim semantics**: how soft is "advisory"? Pure presence hint (no enforcement) **vs**
   a weak reservation that downgrades to a proposal on conflict.
6. **Stream cleanup**: no `deleteStream` wiring today; persisted chunks linger until the component's
   ~20-min cron. Finalize already copies text to the durable row (no correctness issue), but consider
   `streamingComponent.deleteStream` after finalize to bound chunk storage.
7. **When to measure before WebRTC**: define the read-set-size / p95 thresholds that would justify an
   ephemeral relay, so the "OLAP/WebRTC later" deferral has an explicit trigger.
