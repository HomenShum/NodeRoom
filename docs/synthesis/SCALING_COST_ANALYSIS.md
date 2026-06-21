# NodeRoom scaling & cost analysis

> **Read this first - the two modes are not comparable.**
> **MEMORY mode** (`src/engine/roomEngine.ts` via `EngineStoreProvider`) is the demo: a single in-process `RoomEngine`, state in JS `Map`s, UI subscribing via `useSyncExternalStore` over a local `rev` counter. **Zero network, zero bandwidth, zero fan-out, zero dollars.** A "query" is a synchronous local read; an "edit" notifies local listeners only. Every scaling/cost dimension in this document **does not exist** in MEMORY mode. The demo therefore *cannot surface* the at-scale failure modes - they are structurally LIVE-only.
> **LIVE mode** (`convex/*.ts` via `ConvexStoreProvider`) is the real runtime: ~9 reactive `useQuery` subscriptions per browser tab over one WebSocket, full-result re-sends per changed query, and every query re-run consuming a shared function-call budget. This is where everything below is real.
> The same `useStore()` facade and the same presentational components back both - `docs/ARCHITECTURE.md:55-56` is explicit that engine `Map`s <-> Convex tables and `engine.subscribe` <-> `useQuery` are the swap point. The measured `75ms`/`85ms` paint numbers are the **local render path both modes share** - they say nothing about the LIVE server/fan-out path.

---

## TL;DR - the 5 answers

1. **Real latency.** Hand actions feel instant in both modes because the network is off the critical path: optimistic local paint is **~75ms chat / ~85ms cell edit** offline (`docs/audit/SUB50MS_RESPONSIVENESS.md:63-64`, *measured*, mostly Playwright overhead - app-side paint is 1-2 frames ~16-33ms). Collaboration echo (your edit appearing on a peer) is **~30-150ms** (*inferred estimate, not Convex-published*, `docs/ARCHITECTURE.md:172-173`); live agent first token **~0.7-1.5s** for non-reasoning models (*inferred*, `ARCHITECTURE.md:174-176`).

2. **Users up  (per room).** Hard ceiling is **32 members/room** (`convex/rooms.ts:15`, *budget/target*) at <=10 joins/min (`rooms.ts:16`). The *comfortable* ceiling is well below 32 because one cell edit fans out the **entire room snapshot to all N subscribers** - cost per edit is `O(N x room-size)`, not `O(1)`. Treat 32 as "the number we can serve *without* the P1 fixes."

3. **Agents up .** Moving coordination from model->runtime cut model calls **7->3 (deterministic) / 5->4 (live deepseek)** and model-visible coordination calls **2->0** (`docs/eval/MANAGED_LOCK_PERF.md:31-36`, *measured, single-agent*). Durable-job concurrency is **hard-capped at 3** (`convex/agentWorkflows.ts:9`, *budget/target*); interactive `/ask` has **no concurrency cap** and is the real first-failure surface under a spike. Multi-agent *contention* cost is **inferred from mechanism, not measured.**

4. **Bandwidth.** LIVE mode is a fan-out of ~9 reactive subscriptions/tab (`src/app/store.tsx:456-467`, *measured*). Convex re-sends the **full result of any query whose read-set changed** to every subscriber - so a single cell edit re-ships the whole `rooms.full` payload (`~O(E)` bytes, all artifacts + every element) to all `U` subscribers: **`bytes/edit ~ O(E*U)`**. `messages.list` and `collab.traces` are **unbounded `.collect()`s** re-sent in full on every new row -> `O(H*U)` and growing for the room's lifetime.

5. **What slows down / costs more.** *Slows:* `rooms.full` whole-room re-serialization + zero `React.memo` (one edit re-renders the whole tree) - the #1 bottleneck. *Costs:* every LIVE agent step is a billed model call gated by three **enforced** caps - per-run **$2** / per-room-day **$10 (code) vs $3 (doc)** / global-month **$75** (`convex/agent.ts:325,102,110`, *budget/target*). Measured per-task cost ranges **$0.0000 (free route) -> $0.0009 (granite) -> $0.0020 (deepseek-v4-flash) -> $0.0096 (qwen3.7-plus)** (`docs/eval/results.json`, *measured*).

---

## Latency budget

| Stage | MEMORY mode | LIVE mode | Number & source | Kind |
|---|---|---|---|---|
| **Typing into a cell** | local React state | local React state | sub-frame; never touches store (`Artifact.tsx:759` `editing:{id,seed}`, uncontrolled `EditableCell`) | mechanism |
| **Commit a CAS edit (blur/Enter)** | `engine.applyEdit` -> CAS apply -> `emit()`, sub-frame, no network | `applyCellEdit.withOptimisticUpdate` rebuilds **whole** `rooms.full` via `local.setQuery` (`O(room)`), paints in 1 frame, server CAS confirms async | offline paint **85ms** (`SUB50MS:64`); local apply **~0ms / sub-frame** | measured / inferred |
| **Chat send** | local post | optimistic bubble, 1 frame | offline paint **75ms** (`SUB50MS:63`) | measured |
| **Collaboration echo (peer sees your edit)** | N/A (no peers) | server CAS -> `rooms.full` re-run -> push to all subscribers | **~30-150ms**, "estimate, not a Convex-published number" (`ARCHITECTURE.md:172-173`) | **inferred** |
| **Agent reply** | scripted `paced(...,140ms)` cadence, ONE message at end, no streaming | private NodeAgent **genuinely streams** token-by-token over HTTP (`http.ts:54-59`), sentence-flushed to DB (`streaming.ts:8`); `/ask` is an action with ~3 round-trips before first token | first token **~0.7-1.5s** (non-reasoning); reasoning SKU TTFT **14-108s** (avoided by design) (`ARCHITECTURE.md:174-177`) | **inferred** |
| **Cold room load** | instant (Maps already in memory) | `rooms.full` reads 6 tables incl. ALL elements across ALL artifacts (`rooms.ts:88-118`) behind a Splash | unmeasured; `O(total cells)` payload | mechanism |
| **Re-render after a reactive update** | global `rev` tick re-renders whole subscribed tree | store is **one `useMemo`** recreated on ANY of 9 query deltas -> re-renders RoomShell + both Chats + Artifact + LeftRail; **zero `React.memo` in src** | `O(room)` CPU per remote edit, every subscriber | mechanism |

**RAIL / animation budgets (targets, `SUB50MS:16-21`):** input handler <50ms -> visible response <100ms; animation cause-effect <100ms (transitions 0.12-0.15s, met); 60fps = ~10-16ms/frame, any main-thread task >50ms = "long task". **INP <200ms p75 likely green but UNMEASURED** (`SUB50MS:96`).

**The only confirmed >50ms long task:** spreadsheet upload - synchronous parse + `buildSpreadsheetSemanticIndex` with **O(n^2) `rowIds.indexOf(rowId)` inside the `rowIds` loop** (`src/app/spreadsheetIndex.ts:63`, `SUB50MS:74-76`). Fix is O(n) via a precomputed `Map<rowId,index>` + move to a Web Worker.

---

## Bandwidth model (Convex reactive)

**The rule:** Convex re-runs a query when **any document in that query's read-set changes**, then ships the **new full result of that query** to every subscribed client. The WebSocket diffs at the sync-engine level, but **the query is the granularity** - a changed read-set re-serializes and re-sends the whole returned object. `SUB50MS:70-72` (and `docs/STACK.md`) state it directly: *"`rooms.full` re-serializes the whole room (all artifacts + all elements) to every client on every cell edit - defeats Convex's delta sync at the query layer."* Confirmed against source: `convex/rooms.ts:87-126` reads members + ALL artifacts + (nested loop) ALL elements per artifact + active locks + all sessions + pending drafts into one `{ room, members, artifacts[], locks[], sessions[], drafts[] }` object.

**Who receives what on one `applyCellEdit`:** it bumps the element row + patches the artifact row (version++) + inserts a `traces` row (`convex/artifacts.ts:274-287`). That invalidates **`rooms.full`** (element + artifact in read-set) and **`collab.traces`** (new trace) for every subscriber. Each subscriber then re-receives **ALL artifacts and ALL their elements** - not the one changed cell.

**Bytes model:**

```
bytes per cell edit       ~ O(E * U)      E = elements/room, U = subscribers
query re-runs per edit    ~ O(U)          (x edit-rate R -> O(U*R)/sec)
bytes per chat message    ~ O(H_msg * U)  full channel history re-sent (UNBOUNDED)
bytes per applied edit    ~ O(H_trace*U)  full trace history re-sent (UNBOUNDED)
```

Worked example (from findings): a **200-row x 14-col research sheet ~ 2,800 elements** (the `addResearchRows` shape, `artifacts.ts:393-396`) edited by an agent loop in a 32-member room re-ships a ~2,800-element JSON **x32 per single cell write.**

**Writer-side amplification:** the optimistic path *also* calls `local.setQuery(api.rooms.full, ...)` rebuilding the whole room object on the writer's own commit - `O(room)` work per local edit (`store.tsx:469-601`; `ARCHITECTURE.md:168-169`).

**The unbounded-result-set risk (BOUND checklist violation):** exactly **two** reactive client-held collections have **no `take()` / no pagination / no eviction**:
- **`messages.list`** (`convex/messages.ts:60`) - `.collect()` over `by_room_channel`, full history re-sent to all U on every new message. Also explicitly **excluded from retention pruning** (`convex/retention.ts:11`) - grows for the room's whole life.
- **`collab.traces`** (`convex/collab.ts:51`) - `.collect()` over `by_room`, one trace inserted per applied edit, full list re-sent on each new trace.

**Correctly-bounded counterexamples** (proof the pattern is understood elsewhere): awareness `recentTrace` is `take(6)` (`collab.ts:12`); `agentJobs.list`/`agentRuns.list` are `take(20)` (`agentJobs.ts:312`, `agentRuns.ts:117`); `agentJobs.detail` sub-queries are capped (operations `take(100)`, receipts/journal `take(50)`, leases/drafts `take(25)`, steps `take(80)`, `agentJobs.ts:333-344`). The single-mutation artifact seed is capped at **20,000 elements / 5,000,000 bytes** (`artifacts.ts:21-22`) - but that bounds *one create*, not accumulated room state nor the re-send size.

**Global ceiling:** every reactive query re-run is a Convex function call against the **1,000,000 calls/month free tier** (`docs/OPERATING_BUDGET.md:11`). Total ~ `sum_rooms (U * R * queries-invalidated-per-edit) + message/trace fan-out`. Breaching 1M is "signal #1 -> upgrade to Pro ($25)."

---

## Multi-user scaling

LIVE mode is the **only** multi-user runtime (MEMORY is single-process - no WebSocket, no second user; its "concurrency" is the same deterministic lock/CAS contract exercised in-process, proving *correctness* not *scale*).

**What grows with users-per-room N:**

| Factor | Growth | Why |
|---|---|---|
| Per single cell edit | `O(N * total_cells)` server work + `O(N * room_bytes)` egress | `rooms.full` subscribed by all N; one version bump re-serializes all elements and ships the whole snapshot to each |
| Per chat message | `O(N * M)` | `messages.list` unbounded `.collect()`; each post re-fetches all M messages for every subscriber |
| E concurrent editors (burst) | `~O(E^2)` wasted recompute | E edits each invalidate `rooms.full` for all N>=E subscribers |
| Number of rooms R | `O(R)` independent fan-out groups | rooms are isolated; the binding constraint on R is the **$75/mo agent budget**, not latency |

**The first thing to break:** not correctness (CAS holds - `MULTI_USER_COORDINATION_PROOF.md`; live N=3 converges in 1.0 min, `THREE_USER_COLLAB.md`, room EVAL-MQ7DB1BZ, *measured*) - it's the **`rooms.full` whole-room re-serialization fan-out**, the single biggest scaling defect. Combined with the single-`useMemo` store + zero `React.memo`, every subscriber pays `O(room)` CPU + the full payload per edit.

**Presence note (updated 2026-06-20):** the original audit found no per-cell
presence and no heartbeat. The spreadsheet slice now has a separate bounded
`presenceClaims` table/subscription with TTL-bound focus/edit claims, so live
"who is on this cell" feedback exists without folding presence into
`rooms.full` or `art.elements`. Keep it that way: presence is advisory,
rate-limited coordination metadata, not durable finance state.

**Realistic ceiling:** the 33rd join returns `{error:'room_full'}` (`rooms.ts:51`). The 32-cap is a deliberate blast-radius guard for the *unscaled* query path. To safely raise it toward ~300, the `rooms.full` split **and** message pagination must land first - otherwise per-edit cost is `N x room-size` and WebSocket egress dominates.

---

## Multi-agent scaling

**Coordination spine (LIVE):** (1) **Locks** - `proposeLock` inserts a row with range-expanded `elementIds` (capped `MAX_DEPENDENCY_EXPANSION=1,000`, `spreadsheetIndexLib.ts:13`) + a **5-min lease** (`LOCK_TTL_MS`, `lib.ts:153`); conflict check `.collect()`s ALL active locks for the artifact then `.find()`s in JS (`lib.ts:166-171`) - **not** an indexed point lookup. (2) **CAS/OCC** - `applyCellEditCore` (`artifacts.ts:220-318`) gates LOCK->CAS->apply, returning `{ok:false, reason:"conflict"}` **as data, not thrown** (line 250). (3) **Runtime-managed coordination** - `writeWithManagedLock` (`src/nodeagent/skills/spreadsheet/cellMutator.ts:55-189`) does propose->edit->release in a `finally`, and `createDraft` against the blocker instead of failing (draft-on-blocked). Janitor `sweepExpiredLocks` runs every 1 min (`crons.ts:12`).

| Factor | Growth | Why |
|---|---|---|
| Concurrent agents N | model calls `O(N)` independent; lock-conflict **CHECK** `O(N*L)` ~ `O(N^2)` over a burst | `lockCoveringElement` `.collect()`s all active locks per acquire (no point index on `elementId`) |
| Agents on SAME range | serialized: 1 holder, N-1 take draft path `O(N)` | overlapping ranges denied (`locks.ts:24-28`); contention -> queued drafts, **not** a thrash loop |
| CAS conflicts (same cell) | **`O(1)` per conflict - but a full extra MODEL turn** | no harness-level OCC retry loop; the model must re-read+rewrite (`runtime.ts:202`) |
| Trace/op/receipt writes | `O(N * steps)` append-only | bounded only by 30-day retention cron (`retention.ts:18`) |
| Durable job parallelism | **hard-capped at 3** | `agentWorkflows.ts:9` `maxParallelism:3` (Workpool); `MAX_WORKFLOW_SLICES=200` |

**Measured (single-agent, `MANAGED_LOCK_PERF.md:31-36`):** moving coordination model->runtime: **model calls 7->3 (deterministic), 5->4 (live deepseek-v4-flash); model-visible coordination calls 2->0** both lanes. Live free-auto smoke: single slice, 1 agent = **10,055ms, 1/1, stopReason done** (`LONG_RUNNING_AGENTS.md:283-293`).

**Lease/TTL fencing edge:** slice budget **9 min > lease TTL 5 min** -> a holder relies on **renew-on-write** (`artifacts.ts:282-285`) to keep its range lock. An agent that reads/reasons >5 min without writing loses the lock mid-task (surfaced as `lease_expired` data, `artifacts.ts:243`). *Severity low; documented tradeoff.*

**Realistic ceiling & first failure:** durable/free jobs are gated at **3**; the **real first-failure surface under a sudden multi-user spike is interactive `/ask`, which has NO concurrency cap** - N simultaneous `/ask` each open a ~10-min action with no admission control, over-subscribing the provider/DB. Multi-agent contention numbers are **inferred from the mechanism - no doc measures N>1 contention.**

---

## Cost / token economics

**Cost is entirely a LIVE concern.** MEMORY never bills - `scriptedModel`, no network; the ladder prints **$0.0000/rung** (`evals/ladder.ts:881`); bench/internal runs "use local in-memory tools and never touch the Convex ledger - excluded by construction" (`OPERATING_BUDGET.md`).

**$ unit:** `priceRun(modelId, inTok, outTok) = (inTok*inputPer1M + outTok*outputPer1M)/1e6` (`src/nodeagent/models/adapter.ts:77-80`), prices from `modelCatalog.ts:65-160`. The agent loop bills **1 model call per step**, re-sending system + full history + tool results each time -> input tokens grow with step depth.

| Factor | Growth | Note |
|---|---|---|
| Steps/loop per command | `O(steps)` calls; input tokens `O(steps^2)` w/o compaction | dominant $ lever; research mode <=80 steps, interactive <=24 (`agent.ts:126-127`) |
| Sheet/room size | `O(read size)` per call, **CAPPED by compaction** at ~24,000 chars (~6k tok, `compaction.ts:36`) | sub-linear on $ *if narrow `read_range` is used, not `snapshot()`* (L5 ladder enforces <4,000 chars on 600-row sheet) |
| Agents (parallel) | `O(agents)` linear; each is its own `priceRun` + telemetry row | per-run ceiling bounds ONE run, not the sum |
| Retries/fallback | `O(retries)` - up to 3 retries + 1 cross-model fallback/step | free-auto tries up to 8 (max 20) candidates/step, each $0 on free routes |
| Model route | step-function: free $0 -> granite $0.0009 -> deepseek-v4-flash $0.0020 -> deepseek-v4-pro $0.0043 -> qwen3.7-plus $0.0096 | per-lane by benchmark evidence, never price alone |

**Enforced spend gates (not just displayed):** (1) per-run/slice via `checkSpendCeiling` (`gateway.ts:14-22`) -> emits `stopReason='spend_budget'` + resumable handoff; (2) per-room rolling-24h `ROOM_MAX_USD_PER_DAY`; (3) cross-room rolling-30d `GLOBAL_MAX_USD_PER_MONTH`. The UI cost display (`IntakePlanPreview.tsx:63,128-129`) uses the **prior run's real telemetry** (`store.lastRun().costUsd`) as a display proxy - the *real* gates are server-side.

**Measured per-task cost** (v3 1-company task, `docs/eval/results.json`):

| Route | $ / task | tokens (in/out) | steps | score |
|---|---|---|---|---|
| free (`nex-n2-pro:free`) | **$0.0000** | 7,725 / 206 | 4 | 9/9 |
| granite-4.1-8b (cheapest paid) | **$0.0009** | 16,090 / 626 | 7 | 9/9 |
| deepseek-v4-flash (research default) | **$0.0020** | 16,900 / 1,766 | 7 | 9/9 |
| deepseek-v4-pro (escalation) | **$0.0043** | 7,792 / 1,089 | 4 | 9/9 |
| qwen3.7-plus (most expensive clearer) | **$0.0096** | 10,164 / 3,475 | 5 | 9/9 |
| gemini-3.5-flash (interactive lane) | **~$1.10** | - | - | ~300x deepseek-v4-flash (`agent.ts:118-119`) |

**Envelope (`OPERATING_BUDGET.md:64-67`, *inferred*):** founder power user (95 tasks/mo, 70/30 light/deep) ~ **$0.15-0.75/mo**; **$75 supports ~100-500 such users**; 200-person hackathon ~ **$0-1.30** (free routes); 500-attendee conference ~ **$40-200** only if paid routes enabled.

---

## Bottleneck ranking

| # | Bottleneck | Trigger | Severity | Fix |
|---|---|---|---|---|
| 1 | **`rooms.full` re-serializes the WHOLE room** (all artifacts + every element + members + locks + sessions + drafts) -> full `O(E)` payload to all U on EVERY cell edit; defeats delta sync at the query layer | any cell/note edit, artifact upload, or agent write; worst at large E x high U x agent-driven R | **HIGH** | Split into per-artifact, range-scoped subscriptions keyed by `(artifactId, visibility, version, rowRange, colRange)`; keep room metadata in a separate small query (P1, `SUB50MS:89,107-113`; `ARCHITECTURE.md:88-90`) |
| 2 | **`collab.traces` + `messages.list` unbounded `.collect()`** - full history re-sent to all U on every new row; grows monotonically for the room's life (BOUND violation; messages also exempt from retention) | long-lived/chatty rooms, sustained agent activity (one trace per applied edit) | **HIGH** | Paginate (`usePaginatedQuery`) or `.order('desc').take(N)` - both indexes already carry `createdAt`/`ts`. Mirror the existing `take(20)` on jobs/runs |
| 3 | **Client re-render storm** - single-`useMemo` store recreated on ANY of 9 query deltas + **zero `React.memo`** -> one edit re-renders RoomShell + both Chats + Artifact + LeftRail; `O(room)` CPU per remote edit | any remote edit with multiple panels mounted; degrades as room grows | **MED** | Slice the store context (messages/artifacts/traces/jobs); `React.memo` leaves (Bubble, EditableCell, Sticky, TraceRow); virtualize threads; batch streamed deltas ~30-100ms/rAF |
| 4 | **`SignalStatusStrip` / `LeftRail` per-render full scans** - `selectPublicSignalTraces` does `.filter().sort().slice(-60)` (`O(T log T)`, T<=2000) every render, unmemoized; LeftRail does nested `members.map(locks.find)` (`O(M*L)`) | active agent run / multi-editor burst with deep trace log; paid R times/sec | **MED** | Memoize the sorted tape keyed on trace length+last id; `React.memo(SignalStatusStrip)`; build `Map<holderId,lock>` for O(1) lookups |
| 5 | **`agentJobs.detail` heavy 6-table fan-in** re-runs on every step/receipt during an active slice | watching a live agent run (`latestJobId` auto-selected) | **MED** | Caps are present (good); gate full detail to an explicitly-opened drilldown; lighter summary query for the strip |
| 6 | **`/ask` is a Convex action in the hot path** - ~3 round-trips before the model starts; writes land all-at-once with binary typing-dots | every interactive `/ask` in live mode | **MED** | Converge onto the `/free` job model: `startPublicAsk` mutation + `scheduler.runAfter(0)` returns jobId instantly; per-slice incremental writes; reuse job-strip (`OPTIMISTIC_UI_PLAN.md:238-263`) |
| 7 | **Lock-acquisition `O(active-locks)`** - `lockCoveringElement` `.collect()`+`.find()` in JS, not a point lookup; `sweepExpiredLocks` `.collect()`s the ENTIRE locks table | many agents/small ranges on the SAME artifact within a 1-min sweep window | **MED** (-> HIGH at agent scale) | Add a `(artifactId, status, elementId)` index or per-element coverage table; batch the janitor sweep |
| 8 | **Doc vs code spend-cap mismatch** - doc says slice $0.50 / room-day $3; code defaults $2 / $10. Doc numbers only hold if env vars are set in prod (Convex deploy != git push) | runaway loop on prod where tighter env vars were never set -> 4x per-run, 3.3x daily | **MED** | Verify GLOBAL/ROOM/SLICE env vars in the Convex prod deployment, or change code defaults to match the doc |
| 9 | **Spreadsheet upload O(n^2)** `rowIds.indexOf` in `buildSpreadsheetSemanticIndex` - the ONLY confirmed >50ms main-thread long task | uploading a high-row-count sheet | **LOW** (per-client, not N-coupled) | Replace with `Map<rowId,index>` (O(n)) + move parse/index to a Web Worker |
| 10 | **Parallel multi-agent fan-out width uncapped** - each run gets its own $2 ceiling; nothing bounds run *count* before the next `roomSpendSince` check | one command spawning many parallel subagents in a day | **LOW** | Daily/monthly caps are the backstop and work; add a concurrent-run width cap per room if parallel becomes primary |
| 11 | **TipTap statically bundled** in the 936KB (288KB gz) index chunk though 1/5 tabs needs it | every cold load pays editor parse even when opening a sheet | **LOW** | `React.lazy` the TipTap editor out of the index chunk |
| 12 | **Stage-focus rAF loop** re-queries DOM + re-writes `boxShadow` every frame ~1.6s/click | each Binder/Signal-Tape focus click | **LOW** | Self-terminating (frame 96 / abort frame 30), one cell, sub-ms - not jank on its own. Switch to CSS class/MutationObserver only if INP later flags it |
| 13 | **No true list virtualization** - pager mounts cumulatively (`pageSize*pages`, no recycling) | clicking "Show next" many times in one session | **LOW** | Swap pager for windowed virtualization (react-window) if large sheets become common |

---

## Honest gaps (inferred, NOT measured)

These are the load-bearing claims with **no measured number** behind them - flag before quoting as fact:

- **Collaboration echo ~30-150ms** - *"estimate, not a Convex-published number"* (`ARCHITECTURE.md:172-173`). The only measured latencies (`75ms`/`85ms`) are **single-client optimistic local paint with `context.setOffline(true)`** - they measure the local query-cache write, **NOT** the server fan-out under N users, which the doc explicitly flags **"unproven under load"** (`SUB50MS:68-69`).
- **Human-driven local apply ~0ms / sub-frame** - explicitly a **MECHANISM claim, "not a measured number... holds at small room size"** (`ARCHITECTURE.md:164-171`).
- **Agent first-token ~0.7-1.5s** (non-reasoning) and **14-108s** (reasoning SKU, avoided by design) - *inferred*, `ARCHITECTURE.md:174-177`.
- **Multi-agent contention ceiling** - the `MANAGED_LOCK_PERF` numbers are **single-agent** in both a deterministic (mocked model) and a live deepseek lane. They quantify per-agent coordination savings (7->3 / 5->4) but **do NOT measure N>1 contention** - the `O(N*L)` lock-scan and `O(N^2)` burst cost are inferred from the mechanism only.
- **`O(E*U)` bandwidth at scale** - the mechanism is proven by code (`rooms.ts:87-126`) and named in the audit, but **no doc measures actual bytes/edit or function-call burn under N concurrent users**. The 1M-call ceiling is a budget target, not an observed breach.
- **INP <200ms p75** - *"likely green but UNMEASURED"* - there is **no web-vitals / long-task probe** shipped (`SUB50MS:96,121`). Add the dev-only INP/long-task probe before optimizing bottlenecks #4 and #12.
- **`listProposals` / `listTraces` server bound** - flagged **BOUND_READ to verify**: the client `listTraces`/`listProposals` mapping (`store.tsx`) does not confirm a server `.take()` cap; `AUDIT_SUMMARY.md:85` calls for a defensive `.take()` on `messages.list` that is **still deferred** (`OPTIMISTIC_UI_PLAN.md:317`).
- **Compaction token estimate** - `char/4` proxy (`compaction.ts:36-40`), not a real tokenizer. The **spend gate uses real provider usage tokens (honest)**, but the *compaction trigger* and pre-flight fit check can under-count on dense numeric/CJK content, letting a prompt exceed budget before compaction fires.
- **Doc vs code cap divergence** (bottleneck #8) is itself an unverified-in-prod gap: which numbers are real depends on env vars set in the Convex deployment, not on anything in the repo.
