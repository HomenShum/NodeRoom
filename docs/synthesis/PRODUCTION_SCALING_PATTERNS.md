# How production apps solve NodeRoom's scaling bottlenecks

> Reader: builder-analyst. Each bottleneck below is mapped to *how production solves it, who does it (with primary sources + confidence), and the concrete thing to do on Convex* given NodeRoom's actual code. Grounded against the live tree: `convex/rooms.ts` (`full`, L87), `convex/messages.ts` (`list`, L55), `convex/locks.ts` (`proposeLock`/`activeLockOn` loop L24, full-table sweep L120), `convex/schema.ts` indexes.

---

## TL;DR — the one-paragraph answer

Every production collaborative app converges on **two universal moves**, and NodeRoom's six bottlenecks are all special cases of failing to do them:

1. **Send deltas, not snapshots.** Make the wire unit a *single mutation* (one cell, one row, one op) keyed to the client's last-seen position, so cost is **O(change)** not **O(dataset)**. Figma sends one changed `(object, property)` value; Linear ships deltas since a global `lastSyncId`; Slack/Convex paginate history by cursor; Yjs ships a binary diff against a state vector. NodeRoom's `rooms.full` re-serializing the **whole room on every cell edit** (O(E·U)) is the *textbook anti-pattern* these systems exist to kill — it is **not a novel problem**.
2. **Separate ephemeral presence from the durable store.** Cursors / "which agent is editing" / typing indicators ride a *separate, rate-capped, never-persisted* channel (Liveblocks Presence vs Storage; Figma broadcasts cursors over WS but never journals them). NodeRoom now follows the cheap Convex version of that rule for spreadsheet cells: `presenceClaims` is a bounded side table/subscription, not part of `rooms.full` or `art.elements`.

The honest, important framing for Homen: **none of B1–B6 are novel.** They are the canonical disease that OT (Google Docs), CRDTs (Yjs/Figma), and sync engines (Linear/Replicache/Zero) were built to cure. And because NodeRoom is **already on Convex** (a server-authoritative, serializable-OCC, reactive engine), the cheapest high-leverage path is *not* "rip-and-replace with a sync engine" — it is **apply Convex's own scaling patterns** (`usePaginatedQuery`, narrow `withIndex` read-sets, per-artifact/per-range subscriptions, lean on built-in OCC) and reserve the heavyweight options (Yjs/Liveblocks CRDT, Durable-Object actors, Replicache/Zero) for the *one or two* places they actually earn their cost.

---

## Per-bottleneck mapping

> **Effort key:** S = a few hours / one query. M = a focused day or two. L = multi-day refactor. XL = new subsystem or runtime alongside Convex.

### B1 — `rooms.full` re-serializes the WHOLE room on every cell edit → O(E·U)

**The code today:** `convex/rooms.ts:87` `full()` reads members + **all** artifacts, then a nested `for` loop reads **all** elements of **each** artifact, plus locks + sessions + drafts, and returns one giant object. Because Convex re-runs a query whenever its **read-set** changes and **re-ships the FULL result to every subscriber** ([how Convex works](https://stack.convex.dev/how-convex-works), high), a single cell `patch` touches the `elements` read-set and forces the entire room object back out to *every* connected member. That is O(E cells × U users) bandwidth per edit.

**How production solves it (send a delta, shrink the unit):**
- **Figma — per-property last-writer-wins.** The server tracks "the latest value any client has sent for a given property on a given object"; only the *changed property* crosses the wire; same-property collisions resolve LWW using the server's receive-order as the implicit clock ("we don't need a timestamp because the server can define the order of events"). A spreadsheet cell *is* an (object, property). ([Figma blog](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), high; [Evan Wallace mirror](https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/), high)
- **Yjs — binary delta + state vector.** `encodeStateVector` summarizes what a client has; the peer ships only the missing ops via `diffUpdate`/`encodeStateAsUpdate(doc, remoteStateVector)`. Wire payload ∝ ops missing, never the doc. ([Yjs docs](https://docs.yjs.dev/api/document-updates), high)
- **Cell-delta channel.** PubNub's reference architecture publishes one delta `{row, col/property, old, new}` per edit instead of broadcasting the grid. ([PubNub](https://www.pubnub.com/blog/collaborative-spreadsheets-using-pubnub/), high). Google's spreadsheet patent describes per-cell mutations + OT merge of non-conflicting subfields. ([US 9,720,897](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9720897), **med** — patent describes the design; not verified as current prod).

**Convex-specific NodeRoom adoption (the highest-leverage change in the whole doc):**
1. **Delete the one-query-reads-everything pattern.** Split `rooms.full` into many *narrow* reactive queries: `room.meta` (room row only), `room.members`, `room.artifactList` (titles/versions, no elements), and crucially a **per-artifact** `artifact.elements(artifactId)` subscription. A cell edit then re-runs only the *one artifact's* element query — every other artifact's subscribers see nothing. (Effort **L**)
2. **Go per-range, not per-artifact, for large sheets.** The schema already has `spreadsheetCells.by_artifact_row_col` (`["artifactId","rowIndex","colIndex"]`, schema.ts:537). Subscribe the visible viewport as a *range query* (`withIndex(... q.gte(row, top).lte(row, bottom))`) so an edit to row 900 never invalidates the subscriber looking at rows 1–40. (Effort **L**)
3. **Hot/cold field segmentation.** Keep churny cell *values* in one row/query and stable *metadata* (format, title, order) in another, so value churn doesn't invalidate metadata readers. ([Convex "Queries that scale"](https://stack.convex.dev/queries-that-scale) names indexing + pagination + segmentation, high; [indexes & perf](https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf), high)
4. **Cell-as-property write path.** Adopt Figma's model literally: a write is `setCell(artifactId, elementId, value, baseVersion)`; the result that ships is the one changed element, ordered by Convex's serializable commit (no timestamp needed). This is also the B5 fix (below).

**Honest scope flag:** pagination/virtualization (B2/B3) do **not** fix B1 — B1 requires *read-set narrowing*, a structurally different change. Tradeoff: many small queries multiply subscriptions and risk N+1; segmentation denormalizes. That's the correct trade vs O(E·U).
**Effort: L**

---

### B2 — message + trace history do unbounded `.collect()` → O(H)

**The code today:** `convex/messages.ts:55` `list()` ends in `.collect()` on `by_room_channel`, returning **all** messages in the channel. `convex/collab.ts:51` does the same for `traces`. Every new row changes the read-set → the *entire* history re-ships to every subscriber. O(H) per message.

**How production solves it (cursor/keyset paging):**
- **Slack** migrated offset→cursor explicitly: offset "doesn't scale… the database still has to read up to offset + count rows from disk before discarding the offset," and concurrent writes dup/skip rows; cursor paging "returns a pointer… returns results after the given pointer" via an indexed keyset query. ([Slack eng](https://slack.engineering/evolving-api-pagination-at-slack/), high; [Slack docs](https://docs.slack.dev/apis/web-api/pagination/), high)
- **ElectricSQL / PowerSync** generalize: client holds an offset into an append-only log / per-bucket op-history and streams only entries past it. ([Electric shapes](https://electric-sql.com/docs/guides/shapes), high; [PowerSync sync rules](https://www.powersync.com/blog/sync-rules-from-first-principles-partial-replication-to-sqlite), high)

**Convex-specific NodeRoom adoption (this one is native and easy):**
1. Replace `.collect()` in `messages.list` with **`.paginate({ numItems, cursor })`** server-side and **`usePaginatedQuery(api.messages.list, args, { initialNumItems: 50 })`** client-side. Convex's pagination is *fully reactive* and uses the killer trick of **pinning page endpoints**: it "ignores numItems and returns all items until the end cursor," converting each page from a limit-query into a *range query* — so inserting one row re-runs only the **one affected page**, not O(H). ([Convex pagination docs](https://docs.convex.dev/database/pagination), high; ["Fully Reactive Pagination"](https://stack.convex.dev/fully-reactive-pagination), high)
2. The `messages.by_room_channel` index is already `["roomId","channel","createdAt"]` (schema.ts:176) — **`createdAt` is the stable sequential key**, so this is a drop-in: no schema change needed.
3. Add **`maximumBytesRead` / `maximumRowsRead`** caps so a pathological channel can't blow the read budget, and so a new tail row invalidates only the last page. ([pagination docs](https://docs.convex.dev/database/pagination), high)
4. Do the same for `collab.traces` (index `by_room` = `["roomId","ts"]`, schema.ts:200 — `ts` is the cursor key) and `agentSteps`.

**Tradeoff:** lose total-count and arbitrary page-jump (fine for chat/trace feeds); cursors can `InvalidCursor`→reset to page 1; ordering key must be stable+unique-ish (`createdAt`/`ts` qualify).
**Effort: S** (per query)

---

### B3 — client render storm: one store recreated on any of ~9 query deltas, no `React.memo` → whole UI re-renders per edit

**How production solves it (normalized store + fine-grained reactivity + virtualization):**
- **Linear (MobX)** makes each model's fields observable, so "only components that read a changed observable re-render" — O(observers-of-that-field), not O(UI). ([reverse-linear-sync-engine](https://github.com/wzhudev/reverse-linear-sync-engine), high; [performance.dev breakdown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), high)
- **Zero** syncs into a "local, normalized client datastore" so unrelated rows don't trigger re-renders. ([Zero](https://zero.rocicorp.dev/docs/introduction), high)
- **React primitives**: `React.memo` skips re-render when props are unchanged; `useSyncExternalStore(subscribe, getSnapshot)` with a per-component **selector** so a slice change doesn't re-render the whole tree. ([React memo](https://react.dev/reference/react/memo), high)
- **Virtualization** caps render cost at O(visible rows): TanStack Virtual ([docs](https://tanstack.com/virtual/latest), high), react-window/react-virtuoso (med), ag-Grid DOM-virtualisation ([docs](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/), high), Glide canvas grid for huge sheets ([repo](https://github.com/glideapps/glide-data-grid), high).

**Convex-specific NodeRoom adoption:**
1. **Stop recreating one global store.** The root cause of B3 is store *identity* churn: if the store object is rebuilt on any of the ~9 query deltas, `React.memo` is defeated wholesale (memo needs referentially stable props). Subscribe each UI region to its **own narrow query** (the B1 split produces exactly these) and merge into a stable, normalized client cache keyed by id — don't rebuild one blob.
2. Wrap cell components / message rows in `React.memo` with stable props, and read store slices via selectors so only the changed cell's component re-renders.
3. **Virtualize the two unbounded surfaces:** `react-virtuoso` for the chat/trace lists (it has chat-style "follow output" + reverse scroll built in); `ag-Grid` DOM-virtualisation or Glide canvas for the sheet body. Sequence: **paginate (B2) first** so the server stops *sending* unbounded data, **then virtualize** so the client stops *rendering* it.

**Tradeoff:** over-memoizing is wasted work; selector discipline + stable store identity is the *actual* fix, not sprinkling `memo`. Virtualization breaks find-in-page/a11y for off-screen rows (needs handling). Canvas grids must re-implement selection/a11y.
**Effort: M** (memo + selectors) → **L** (sheet virtualization)

---

### B4 — interactive AI `/ask` runs as an UNCAPPED server action

**How production solves it (admission control + token budget + durable execution):**
- **Job queue with hard concurrency cap.** BullMQ worker `concurrency` bounds simultaneous jobs "avoiding resource exhaustion," plus rate-limiting (max jobs / duration). NodeRoom is Node/JS, so this is directly applicable. ([BullMQ](https://docs.bullmq.io/guide/parallelism-and-concurrency), high)
- **Dual request + token buckets + backpressure.** Azure APIM `llm-token-limit` enforces TPM and notes the core hazard: token count "can't be determined until responses are received… concurrent requests can temporarily exceed the configured token limit," then blocks. Reject-fast 429 / degrade to a cheaper model / fallback when full. ([Azure APIM](https://learn.microsoft.com/en-us/azure/api-management/llm-token-limit-policy), high; [Portkey](https://portkey.ai/blog/rate-limiting-for-llm-applications/), **med**)
- **Durable execution** so a timed-out turn resumes from a checkpoint instead of re-paying for the whole turn. ([Temporal](https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal), **med**)

**Convex-specific NodeRoom adoption:** NodeRoom already has the right substrate — `agentJobs.ts` (job table with `by_status_nextRunAt`, attempts, leases via `agentLeases.by_job_status`) and `agentJobRunner.ts`. So:
1. **Route `/ask` through the existing `agentJobs` queue**, not a raw uncapped action. Add a **per-room (and global) concurrency cap**: before claiming a job, count active leases on `by_job_status`/a room index and refuse-or-queue past the cap.
2. **Pre-flight token estimate** gated against a per-room budget row; on over-budget, **degrade** (shorter context / cheaper model) or return an honest 429-equivalent discriminated result (`{ ok:false, reason:"over_capacity" }`) — never a fake success (HONEST_STATUS).
3. **Bound the queue depth** (MAX + eviction/reject) — an unbounded queue just relocates the OOM. The existing cron janitor pattern (`locks.sweepExpiredLocks`) is the model for sweeping stale jobs.
4. Lean on Convex **action retries + the durable job/attempt rows** as the "resume from checkpoint" analogue rather than adding Temporal.

**Tradeoff:** queueing adds latency + a queue to monitor; reject-fast hurts UX under sustained load; degraded fallback needs a cheaper model wired up. But it's the only thing that makes worst-case spend **O(admitted concurrency)** instead of O(concurrent users).
**Effort: M**

---

### B5 — per-range locks + OCC-CAS; lock acquisition is an O(active-locks) scan; a CAS conflict costs a full model turn

**The code today:** `convex/locks.ts:24` `proposeLock` loops over expanded `elementIds` calling `activeLockOn(ctx, artifactId, id)` per element (the O(active-locks) work, amplified by `expandElementIdsWithSpreadsheetDependencies`). `locks.ts:120` `sweepExpiredLocks` does a **full-table** `.collect()`. The conflict story is the worst quadrant: app-level **range locks** layered on Convex OCC, where an agent's CAS abort re-runs an LLM turn.

**How production solves it (shrink the conflict domain so writes don't collide):**
- **Figma per-property LWW** needs *no lock and no timestamp* — server receive-order is the total order; only same-(object,property) collides, resolved last-write-wins. Make the unit a single cell, not a range, and ordinary edits drop the lock + CAS entirely. ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), high; [Liveblocks taxonomy](https://liveblocks.io/blog/understanding-sync-engines-how-figma-linear-and-google-docs-work), high)
- **Lean on serializable OCC with bounded auto-retry**, not an app lock table — but OCC degrades under *hot-cell* contention, so per-cell granularity is the lever. NodeRoom *already runs on this*: Convex OCC "records what each transaction reads and writes, checks for conflicts at the end… rolls back and throws an OCC conflict error… can run several retries." ([Convex OCC](https://docs.convex.dev/database/advanced/occ), high; [Databricks concurrency](https://www.databricks.com/blog/concurrency-control), high; [Modern Treasury](https://www.moderntreasury.com/learn/pessimistic-locking-vs-optimistic-locking), med)
- **Single-writer actors** (Cloudflare Durable Objects, Phoenix GenServer) make serialization structural — *no lock to scan* — but you must **not** run the LLM inside the actor. ([Durable Objects state](https://developers.cloudflare.com/durable-objects/api/state/), high; [Phoenix/Fly](https://fly.io/phoenix-files/a-liveview-is-a-process/), high)
- **Op-log + rebase** auto-merges non-overlapping edits instead of a CAS-retry (LiveStore total-order log + rebase; Replicache mutators). ([LiveStore](https://docs.livestore.dev/reference/syncing/), high; [Replicache](https://doc.replicache.dev/concepts/how-it-works), high)

**Convex-specific NodeRoom adoption:**
1. **Correction (supersedes the LWW framing — see [CONVEX_AS_LEDGER.md](../architecture/CONVEX_AS_LEDGER.md) §B5):** blanket per-cell **last-writer-wins is WRONG for finance cells** — silently dropping a number with no audit trail is unacceptable in an auditable model. **Keep CAS**, and on a `baseVersion` mismatch route the losing write to a **proposal**, not a silent overwrite. What to actually drop is the *broad/long* range lock + the `O(active-locks)` scan (use a soft **intent-claim** + a **short commit-lease at publish**), not CAS itself. Reserve true LWW only for **non-finance, trivially-atomic, single-human** values (e.g. a sticky-note position). This is also B1's write path.
2. **Make the conflict domain one cell (one Convex doc), not an expanded range.** Then Convex's own OCC serializes naturally and you delete the per-element `activeLockOn` scan for the common case.
3. **Keep locks only for genuine multi-cell semantic invariants** (e.g. a formula-driver range that must update atomically), and fix the janitor: `sweepExpiredLocks` full-table `.collect()` (locks.ts:120) should query `by_room_status`/an expiry index, not scan all locks.
4. **Don't hold a lock across an LLM call.** Dispatch the agent off-path (B4 queue) and apply its result as a normal queued write — see B6.

**Tradeoff:** LWW silently drops the losing same-cell write — fine for atomic values, **wrong** for in-cell collaborative free-text (that needs a Yjs CRDT) and for true multi-field invariants (needs a server transaction). Per-cell granularity is the whole game.
**Effort: L**

---

### B6 — AI agents edit the SAME shared sheet as humans; cost/context grows with room/sheet size

**How production solves it (AI as PROPOSAL against a snapshot, never a live clobbering write):**
- **Notion suggested edits** keep "the original text intact"; AI output is a *suggestion* a human accepts/rejects — a proposal layer over the live doc. ([Notion](https://www.notion.com/help/suggested-edits), high)
- **M365 Copilot in Excel**: edits are "transparent, reviewable, and reversible," with visible reasoning + Track Changes. ([Microsoft](https://www.microsoft.com/en-us/microsoft-365/blog/2026/04/22/copilots-agentic-capabilities-in-word-excel-and-powerpoint-are-generally-available/), **med** — user-facing contract documented; internal merge not verified)
- **Cursor**: agent presents a **diff for review before write**; background agents work on a **separate branch**. An auto-apply-without-diff incident was reported as a **bug** — confirming proposal-before-write is the intended contract. ([Cursor forum](https://forum.cursor.com/t/regression-ai-edits-applying-automatically-without-diff-approval-ui/154887), **med**)
- **Anthropic guidance**: prefer a low-risk first action — "draft, suggestion, summary, or proposed fix… Do not edit anything until I approve." ([Anthropic](https://www.anthropic.com/engineering/writing-tools-for-agents), **med**)
- **Cost vs sheet size**: partial/lazy sync of the *working set* — sync only the visible slice (Linear full/local/partial bootstrap; Zero query-as-sync-boundary), and run whole-sheet operations (search, aggregates, AI-over-all-cells) as **server escape hatches**, not by loading everything. ([Linear](https://github.com/wzhudev/reverse-linear-sync-engine), high; [Zero](https://zero.rocicorp.dev/docs/introduction), high; [Convex object-sync analysis](https://stack.convex.dev/object-sync-engine), high)
- **Presence-as-signal**: surface "which agent is editing" on the ephemeral channel (B-presence), not via DB writes. ([Liveblocks why-websocket](https://liveblocks.io/blog/why-websocket-gets-hard-in-multiplayer-apps), high)

**Convex-specific NodeRoom adoption:** NodeRoom already has the bones — a `drafts`/`proposals` table (referenced in `rooms.full` and `artifacts.ts:255/347`) and `mergeBlockedDrafts`. So:
1. **Make agents emit `drafts` (proposals) against a snapshot `baseVersion`, never authoritative cell writes.** A human keystroke during agent thinking is never clobbered; at apply-time, re-validate `baseVersion` against the current cell — stale proposals are rejected **as data** (cheap), not by burning a model turn. This relocates B5's conflict-as-data CAS to the proposal boundary.
2. **For autonomous flows, swap the human accept for a programmatic gate** (eval/rubric) so the human isn't the bottleneck — fits NodeRoom's eval discipline.
3. **Bound agent context cost:** feed the agent the *working-set slice* (the range it's operating on, via `by_artifact_row_col`) + a server-side search/summary escape hatch over the full sheet — do **not** stuff the whole sheet into context. This is the per-room cost lever.
4. **Surface agent activity via presence** (see below), not by writing `agentSessions`/`traces` on every keystroke into a read-set that `rooms.full` re-ships.

**Tradeoff:** proposals add a review step + a staging layer (NodeRoom already has it); LWW-on-accept can still be stale (re-validate base version at apply). For a **finance-grade auditable** workroom this is actually the *right* default — see the strategic fork.
**Effort: M** (proposals exist; tighten base-version revalidation + context windowing)

---

### B-presence (cross-cutting amplifier for B1/B3/B6) — split ephemeral presence from durable state

Not one of the original six, but it's the multiplier. The stale failure mode is
cursor/"who's editing" churn riding the same durable read-set as cell data. The
current spreadsheet implementation avoids that by isolating advisory presence
in `presenceClaims`; keep notebook/deck presence on the same side-channel rule.

**How production solves it:** two-channel architecture — ephemeral signals (cursor, selection, viewport, "which agent is editing") on a **separate, rate-capped, never-persisted** channel; durable state on a different write path. Liveblocks Presence-vs-Storage ([client API](https://liveblocks.io/docs/api-reference/liveblocks-client), high); Figma broadcasts cursors over WS but never journals them ([Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works/), high); Phoenix.Tracker gossips join/leave **diffs** not full member lists ([Phoenix.Tracker](https://hexdocs.pm/phoenix_pubsub/Phoenix.Tracker.html), high). Throttle cursors to a fixed cadence — Liveblocks default 100ms/10Hz, tunable 16ms/60Hz ([client API](https://liveblocks.io/docs/api-reference/liveblocks-client), high); Cloudflare server-side batch every 50–100ms ([DO websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), high).

**Convex-specific adoption:** Convex has **no native ephemeral channel**
(reactive queries are durable-read-set driven). Two options: (a) **cheap** —
isolate presence into its own **throttled, separately-subscribed, bounded** table
so cursor writes never invalidate `rooms.full`/the cell read-sets; (b)
**proper** — run a separate ephemeral transport (Durable Object / PartyKit / own
WS) alongside Convex, Convex remaining source-of-truth for cells. Spreadsheet
cells have started with (a) via `presenceClaims`; do the same for notebook
blocks and deck components before considering a separate transport.
**Effort: M (a) / XL (b)**

---

## The strategic fork — build-vs-adopt

For a **finance-grade, auditable** workroom, the decision axis is not "best auto-merge" — it's **server-authoritative ordering + no-silent-clobber + evidence trail**. That biases *against* full peer-to-peer CRDT auto-merge (which can silently drop an agent's expensive result) and *toward* a server-ordered, proposal-gated model. Convex already gives you the auditable, serializable authority for free.

| Path | What it is | Earns its cost when | Cost / risk for NodeRoom |
|---|---|---|---|
| **Stay on Convex + apply its scaling patterns** *(recommended core)* | `usePaginatedQuery`, split `rooms.full` into narrow per-artifact/per-range queries, lean on built-in OCC, route `/ask` through `agentJobs`, normalized client store + memo | Always — it's the floor. Fixes B1/B2/B3/B4/B5 with no new runtime. | Low. No vendor added. Effort is the refactor (L for B1/B5). |
| **CRDT layer (Yjs / Liveblocks)** | Binary-delta CRDT for true intra-cell collaborative text + offline merge; managed backend adds presence/persistence | Only if you need **character-level co-editing inside one cell** or offline. | Second sync substrate beside Convex (duplication); CRDT metadata overhead; **silent same-cell merge** is *wrong* for finance unless gated. Reserve for rich-text cells only. |
| **Sync engine (Replicache / Zero / ElectricSQL)** | Versioned delta sync + optimistic local store + partial sync | If you outgrow Convex's full-result model and need client-defined query-as-sync-boundary at large working sets. | XL rebuild; re-implements what Convex already gives (authority, reactivity). Don't unless Convex's re-ship cost is proven binding *after* the B1 split. |
| **Actor runtime (Durable Objects / PartyKit / Phoenix)** | One in-memory single-writer per room: structural serialization + ephemeral fan-out | For the **ephemeral presence channel** (B-presence option b) and to kill the lock-scan structurally. | XL; a side-channel alongside Convex. Worth it *only* for presence/cursor fan-out at scale, not for durable cells. |

**Recommended sequence (cheapest leverage first):**
1. **B2 paginate** (`usePaginatedQuery`) — S, native, immediate. *(stop sending unbounded history)*
2. **B3 normalized store + memo + virtualize lists** — M. *(stop rendering it)*
3. **B4 route `/ask` through `agentJobs` with a concurrency + token cap** — M. *(bound cost)*
4. **B1 split `rooms.full` into per-artifact / per-range reactive queries + hot/cold segmentation** — L. *(the big bandwidth win)*
5. **B5 drop the *broad* range lock + `O(active-locks)` scan; keep CAS + intent-claim + short commit-lease + proposals (NOT blanket LWW for finance cells — see [CONVEX_AS_LEDGER.md](../architecture/CONVEX_AS_LEDGER.md) §B5)** — L. *(kill the lock scan + the CAS-conflict-as-model-turn, not CAS itself)*
6. **B6 agents emit `drafts` against a base version + working-set-windowed context + programmatic accept gate** — M.
7. **B-presence: isolate presence into its own throttled bounded table** — initial spreadsheet slice shipped; extend to notebook/deck, and graduate to a DO/PartyKit side-channel only if cursor churn is still binding.

Only graduate to Yjs/Liveblocks (intra-cell text) or Replicache/Zero (if Convex's re-ship is *still* binding after step 4) once steps 1–7 are measured. **Do not** rebuild Convex into a custom sync engine pre-emptively — that's perfectionism disguised as rigor; the B1 split + pagination is "surprisingly close" to what the heavy options buy.

---

## Sources (grouped by topic, with confidence)

**Convex (NodeRoom's own substrate) — high:**
- How Convex works / reactive read-set re-ships full result — https://stack.convex.dev/how-convex-works
- Pagination (reactive, `usePaginatedQuery`, `maximumBytesRead`) — https://docs.convex.dev/database/pagination
- Fully Reactive Pagination (pin-the-endpoints range trick) — https://stack.convex.dev/fully-reactive-pagination
- Queries that scale (index / pagination / segmentation) — https://stack.convex.dev/queries-that-scale
- Indexes & query perf — https://docs.convex.dev/database/reading-data/indexes/indexes-and-query-perf
- OCC / serializable transactions + auto-retry — https://docs.convex.dev/database/advanced/occ
- Object-sync engine analysis (Linear/Figma/Asana/Replicache, ~100MB working set) — https://stack.convex.dev/object-sync-engine

**Collaborative-doc sync (CRDT / OT / property-LWW):**
- Figma multiplayer (per-property LWW, server-ordered, presence-not-journaled) — https://www.figma.com/blog/how-figmas-multiplayer-technology-works/ (high); mirror https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/ (high)
- Liveblocks sync-engine taxonomy (property-vs-character) — https://liveblocks.io/blog/understanding-sync-engines-how-figma-linear-and-google-docs-work (high)
- Yjs document updates + state vector — https://docs.yjs.dev/api/document-updates (high); y-websocket sync+awareness — https://docs.yjs.dev/ecosystem/connection-provider/y-websocket (high); Automerge byte-format — https://docs.yjs.dev/ (**med**, asserted via Yjs's own docs, not automerge.org)
- Apache Wave OT whitepaper — https://svn.apache.org/repos/asf/incubator/wave/whitepapers/operational-transform/operational-transform.html (high); OT overview — https://en.wikipedia.org/wiki/operational_transformation (high)
- Google Sheets patent US 9,720,897 (per-cell mutation + OT subfield merge) — https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9720897 (**med** — design described, not verified as current prod)
- PubNub collaborative-spreadsheet cell-delta — https://www.pubnub.com/blog/collaborative-spreadsheets-using-pubnub/ (high)
- Liveblocks Yjs managed backend — https://liveblocks.io/docs/collaboration-features/multiplayer/sync-engine/liveblocks-yjs (high); Liveblocks Storage LSON — https://liveblocks.io/docs/ready-made-features/multiplayer/sync-engine/liveblocks-storage (**med**, delta-only not verified); BlockNote — https://www.blocknotejs.org/examples/collaboration/liveblocks (high)

**Presence / ephemeral state:**
- Liveblocks client (Presence vs Storage, throttle 16–1000ms) — https://liveblocks.io/docs/api-reference/liveblocks-client (high); rationale — https://liveblocks.io/blog/why-websocket-gets-hard-in-multiplayer-apps (high)
- Cloudflare Durable Objects (single-writer, websockets, hibernation, batching) — https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/ , https://developers.cloudflare.com/durable-objects/best-practices/websockets/ , https://developers.cloudflare.com/durable-objects/api/state/ (all high)
- PartyKit/PartyServer — https://docs.partykit.io/how-partykit-works/ (high)
- Phoenix.Tracker (CRDT join/leave diffs) — https://hexdocs.pm/phoenix_pubsub/Phoenix.Tracker.html (high); Phoenix.Presence — https://hexdocs.pm/phoenix/Phoenix.Presence.html (high); GenServer/LiveView-as-process — https://fly.io/phoenix-files/a-liveview-is-a-process/ (high)

**Pagination / virtualization (B2/B3):**
- Slack offset→cursor — https://slack.engineering/evolving-api-pagination-at-slack/ (high); Slack pagination docs — https://docs.slack.dev/apis/web-api/pagination/ (high)
- TanStack Virtual — https://tanstack.com/virtual/latest (high); react-window comparison — https://dev.to/sanamumtaz/react-virtualization-react-window-vs-react-virtuoso-8g (**med**); react-virtuoso comparison — https://www.pkgpulse.com/guides/tanstack-virtual-vs-react-window-vs-react-virtuoso-2026 (**med**)
- ag-Grid DOM virtualisation — https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/ (high); Glide Data Grid (canvas) — https://github.com/glideapps/glide-data-grid (high)
- React memo — https://react.dev/reference/react/memo (high)

**Sync engines / local-first (delta + optimistic + partial):**
- Linear reverse-engineered sync — https://github.com/wzhudev/reverse-linear-sync-engine (high); performance.dev breakdown — https://performance.dev/how-is-linear-so-fast-a-technical-breakdown (high; Redis-bus internal detail **med**, inferred)
- Replicache how-it-works (cookie+patch+lastMutationID, poke, rebase) — https://doc.replicache.dev/concepts/how-it-works (high); Row Version / CVR — https://doc.replicache.dev/strategies/row-version (high)
- Zero introduction (normalized local store, query-as-sync-boundary) — https://zero.rocicorp.dev/docs/introduction (high); Zero 1.0 IVM — https://www.infoq.com/news/2026/06/zero-version-1/ (**med**, secondary)
- ElectricSQL shapes — https://electric-sql.com/docs/guides/shapes , https://electric-sql.com/primitives/postgres-sync (high)
- PowerSync sync rules / buckets — https://www.powersync.com/blog/sync-rules-from-first-principles-partial-replication-to-sqlite , https://docs.powersync.com/sync/overview (high)
- LiveStore syncing (eventlog + rebase) — https://docs.livestore.dev/reference/syncing/ (high)
- TanStack Query optimistic updates — https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates (high)

**Concurrency / admission control / AI-on-shared-doc (B4/B5/B6):**
- Databricks concurrency control — https://www.databricks.com/blog/concurrency-control (high); Modern Treasury pessimistic-vs-optimistic — https://www.moderntreasury.com/learn/pessimistic-locking-vs-optimistic-locking (**med**)
- BullMQ concurrency — https://docs.bullmq.io/guide/parallelism-and-concurrency (high); Azure APIM llm-token-limit — https://learn.microsoft.com/en-us/azure/api-management/llm-token-limit-policy (high); Portkey rate limiting — https://portkey.ai/blog/rate-limiting-for-llm-applications/ (**med**); Temporal durable agents — https://temporal.io/blog/of-course-you-can-build-dynamic-ai-agents-with-temporal (**med**)
- Notion suggested edits — https://www.notion.com/help/suggested-edits (high); M365 Copilot Excel GA — https://www.microsoft.com/en-us/microsoft-365/blog/2026/04/22/copilots-agentic-capabilities-in-word-excel-and-powerpoint-are-generally-available/ (**med**, user-facing contract only); Cursor diff-review regression — https://forum.cursor.com/t/regression-ai-edits-applying-automatically-without-diff-approval-ui/154887 (**med**); Anthropic writing-tools-for-agents — https://www.anthropic.com/engineering/writing-tools-for-agents (**med**)

### Explicitly NOT verified (flagged uncertainty)
- **Firestore field-level deltas** — docs confirm only *per-document* `docChanges` deltas + per-doc billing; field-level-delta claim is **low** confidence.
- **Google Sheets / Google Docs current production internals** — patent US 9,720,897 and Wave whitepaper describe the *design*; whether shipped Sheets/Docs match verbatim is **med/low**, not asserted from a Google primary engineering source.
- **Discord chat-history pagination parameter specifics** — **low**; asserted from the general pattern, primary docs not fetched.
- **Liveblocks Storage strictly delta-only for all mutations** — **med**; no doc line exhaustively confirms.
- **Zero IVM internals / 1.0** — **med**; docs + InfoQ secondary, not source internals.
- **Notion / Copilot / Cursor backend merge & locking internals** — **med**; only the user-facing proposal/turn-taking contract is verified, not how their servers serialize writes.
- **Figma "process-per-document"** — from a 2019 blog; reflects the documented design *then*, not a guarantee of current internals.
