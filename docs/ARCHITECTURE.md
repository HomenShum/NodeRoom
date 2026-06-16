# NodeRoom — architecture

> **Architecture boundaries / scaling rule:** see [architecture/CONVEX_AS_LEDGER.md](architecture/CONVEX_AS_LEDGER.md) — *Convex is the durable collaboration ledger, not the keystroke pipe, the agent scratchpad, or the OLAP warehouse.* It carries the per-bottleneck prescription (B1 split `rooms.full`, B2 paginate history, B3 narrow queries, B4 `/ask` admission control, B5 intent-claim + short commit-lease + CAS + proposals, B6 patch-bundles vs a snapshot baseVersion), the canonical C2/A1:C5 runtime, the streaming policy, and the implementation order.

## The one idea everything rests on: the uniform element model

Every artifact — spreadsheet, note, post-it wall — is a **bag of elements**, and an element is just:

```ts
interface Element { id: string; version: number; value: unknown; updatedAt: number; updatedBy: Actor }
```

A spreadsheet cell (`B2`), a note block (`n1`), and a sticky (`s1`) are all elements. That uniformity
is the whole architecture: **locks, optimistic-concurrency (CAS), drafts, and smart-merge are ONE
generic mechanism over elements**, not three per-artifact implementations.

## The collaboration lifecycle (point 8)

```
  human / agent edit
        │
        ▼
  RoomEngine.applyEdit(op{ elementId, value, baseVersion, opId })
        │
        ├─ opId already applied? ──────────────► idempotent no-op (success)
        ├─ element locked by someone else? ────► { ok:false, reason:"locked", by }   ◄── lock tool
        ├─ agent edit & auto-allow OFF? ───────► Proposal (approve/reject)            ◄── auto-allow
        └─ applyOpInternal: CAS
                 ├─ version !== baseVersion ───► { ok:false, conflict, expected, actual }  (as DATA)
                 └─ apply: value set, version++, trace "edit_applied", emit()

  ── meanwhile, a blocked agent ──────────────────────────────────────────────
  awareness(roomId)         → sees others' active locks + sessions + recent traces
  readRange(lockedIds)      → reads the locked range as CONTEXT (locked ≠ invisible)
  createDraft(ops, lockId)  → queues changes AROUND the lock, tagged blockedByLockId

  ── on releaseLock(lockId) ───────────────────────────────────────────────────
  for each pending draft blocked by / overlapping the lock:
      resolver({ draft, current, committed }) → { ops, resolution }     ◄── SmartResolver seam
          • element untouched since draft     → apply cleanly      ("clean")
          • holder made the same change       → no-op              ("clean")
          • value diverged from committed work → flag for review   ("needs_review", NOT clobbered)
      apply resolved ops (CAS) · draft.status = merged | conflict · trace
```

**Key invariant (tested):** committed work is never overwritten by a stale draft. The deterministic
`SmartResolver` ships in `merge.ts`; a real LLM resolver implements the same signature and can *merge*
two diverged values instead of flagging them.

Semantic Rebase / Compare-Reason-Swap sits above this lifecycle. CAS and
`SmartResolver` protect physical writes and stale drafts; CRS classifies the
business-meaning conflict before a risky resolution can become a proposal or a
fresh final CAS write. The current policy scaffold lives in
`src/nodeagent/skills/spreadsheet/semanticRebase.ts`; the detailed runtime plan and open gaps are in
[`architecture/SEMANTIC_REBASE_CRS.md`](architecture/SEMANTIC_REBASE_CRS.md).

## Engine ↔ Convex mapping (production)

The in-memory `RoomEngine` is the deterministic implementation of `convex/schema.ts`. Porting is a
**transport** change:

| Engine (spike) | Convex (production) |
|---|---|
| `RoomEngine` Maps | tables: `rooms`, `members`, `artifacts`, `elements`, `locks`, `drafts`, `proposals`, `agentSessions`, `messages`, `traces` |
| `engine.subscribe()` + `useSyncExternalStore` | reactive `useQuery` subscriptions (the stream) |
| `applyEdit` (CAS) | `applyCellEdit` mutation — per-element `version` check; **conflict returned as data, not a thrown `ConvexError`** (a throw rolls back the whole mutation) |
| `proposeLock` / `releaseLock` | `locks` table mutations; `releaseLock` calls deterministic `mergeBlockedDrafts` |
| `mergeDraft` → deterministic resolver | deterministic Convex mutation flow today; an LLM resolver remains a future seam |
| `opId` / `clientMsgId` idempotency | `withIndex().unique()`-then-insert (Convex has no DB unique constraint) |
| scripted agents | custom `runAgent` loop (`src/nodeagent/core/runtime.ts`, AI SDK) in a `"use node"` action; tools = `read_range` / `propose_lock` / `edit` / `create_draft`; conflicts come back as tool errors → the model re-reads + retries |

**Why app-level CAS, not just Convex OCC:** Convex's internal OCC serializes physical writes and
auto-retries low-level conflicts, but two clients that both read `v1` and write different values will
*both* succeed (last-writer-wins). The per-element `version` + the explicit CAS check is what prevents
the stale-baseline clobber — that's the correctness story.

## Production layer by access pattern

NodeRoom should not store every kind of data in one place. The production
architecture separates the system by access pattern:

| Layer | Owns | Does not own |
|---|---|---|
| Realtime DB / Convex | canonical room state, messages, artifacts, elements, versions, locks, drafts, proposals, traces, permissions | large raw file bytes, public CDN caching, ephemeral presence-only state |
| Object storage | uploaded XLSX/CSV/PDF/image files, generated exports, screenshots, trace bundles, benchmark artifacts | live spreadsheet cell state, locks, version counters, private chat state |
| Hot cache / KV | presence, room tail, recent version-keyed sheet ranges, semantic answer cache, idempotency windows, rate-limit counters | canonical finance data or private notes without version and visibility keys; durable entity/facet cache is `entityResearchCache` in Convex |
| Serverless actions / workers | parsing, OCR/layout extraction, retrieval, model calls, embeddings, eval runs, export generation | long-lived truth without database checkpoints |
| CDN / edge | static assets, public docs, public screenshots, explicitly published read-only artifacts | active private rooms, authenticated spreadsheet data, private agent chats |

The short version: CDN delivers, object storage holds blobs, Convex/realtime DB
holds truth, hot cache holds version-keyed ephemeral state, and serverless
compute runs bursty side effects. Add explicit load balancing only when the
system owns custom websocket gateways, MCP servers, or long-running worker
fleets.

For spreadsheet artifacts, this matters. The uploaded workbook can live in
object storage, but the collaborative working model is structured state: rows,
cells, versions, formula dependency records, locks, drafts, and append-only
operation traces. Cache ranges, not entire private workbooks, and key every
range by artifact id, visibility, version, row range, and column range.

## Long-running job lifecycle

Long-running execution is a policy on `agentJobs`, not a separate agent
implementation. Durable public room requests (`/ask`, `/free`, research,
collaboration buttons, and top-model jobs) enter through `agentJobs.start`.
The row carries `entrypoint`, `routePolicy`, `runtimePolicy`, `modelPolicy`,
`approvalPolicy`, `evidencePolicy`, and `traceLevel`. Private read-only advise
is still a one-call private reply path until it needs mutation, resumability, or
room-visible trace accounting.

```text
agentJobs.start mutation
  -> insert agentJobs row
  -> choose model/approval/evidence behavior from route policy
  -> start freeAutoWorkflow (historical name for the shared slice workflow)
  -> workflow sleeps until nextRunAt
  -> Workpool runs one runFreeAutoJobSlice action
  -> claimSlice(jobId, leaseId)
  -> runAgent with the job entrypoint + modelPolicy
  -> finishSlice records agentJobAttempts + cursor/handoff + nextRunAt
  -> workflow polls state and resumes, or terminal status stops it
```

Built guarantees:

- Each slice uses a default 9-minute budget under Convex's 10-minute cap, with
  a 30-second reserve and a lease that outlives the slice.
- `finishSlice` records attempts and checkpoints in the mutation that updates
  job state; legacy scheduler continuation is only used for old
  `runtime="scheduler"` jobs.
- A lease prevents two workers from running the same job at the same time.
- `agentJobs.start` dedupes by idempotency key; `startFreeAuto` is only a
  compatibility wrapper that calls it with `routePolicy="free_auto"`.
- The provider-step journal replays completed model steps after
  crash-after-response/before-checkpoint failures.

Important production distinction:

- A lease is not provider request idempotency. The journal prevents replaying a
  completed recorded model step, but providers that support request
  idempotency should still receive stable request ids.
- Model calls receive deadline abort signals; tools are checked before
  execution, but stricter production cap-safety should thread deadline signals
  through tool implementations too.

## NodeAgent job contract

The `/ask` and `/free` split has converged on one durable NodeAgent contract:
every durable public or Room-lane request first creates or reuses an
`agentJobs` row, then the first action slice either completes quickly or
checkpoints into the same Workflow/Workpool continuation path. The detailed target
design, including `NodeAgentRequest`, `NodeAgentResult`, notebook graph tables,
the action/query/mutation operation ledger, leases, tool permissions, mutation
receipts, and embedding sync, lives in
[`docs/NODEAGENT_ARCHITECTURE.md`](NODEAGENT_ARCHITECTURE.md). The concrete
import/source map for the review-requested `src/nodeagent/**` tree lives in
[`docs/NODEAGENT_SOURCE_MAP.md`](NODEAGENT_SOURCE_MAP.md); that tree is now the
canonical agent source tree while Convex remains the durable runtime.

The recursive-reasoning add-on keeps the same boundary: `reasoningFrames.ts`
builds the phase/child plan, `agentReasoningFrames` persists it,
`entityWorkItems` records selective child work, and `entityResearchCache` stores
room-local entity/facet freshness. OKF remains the portable evidence graph;
Omnigent remains an optional outer meta-harness, not the state store.

## OpenRouter-on-Convex benchmark contract

OpenRouter is the primary model marketplace for NodeRoom routes, but it is only
a provider adapter. The durable benchmark runtime is still Convex:

```text
benchmark task / room goal
  -> agentJobs.createOrReuse(idempotencyKey, modelPolicy)
  -> Convex action slice
  -> convexModel(modelPolicy) -> OpenRouter chat-completions compatible call
  -> agentStepJournal(inputHash/outputHash)
  -> RoomTools / internal mutations
  -> mutationReceipts + agentOperationEvents + artifact evidence
  -> checkpoint / handoff / resume, or terminal result
```

The contract is now executable as `npm run benchmark:openrouter-convex`. It is
NodeRoom's benchmark, inspired by SpreadsheetBench, SpreadsheetBench 2, and
BankerToolBench, for the product shape we actually ship: model routes working
through Convex-owned jobs, leases, journals, receipts, and artifact evidence.
The report has two layers: the strict OpenRouter-on-Convex harness gate, and a
closer official-style scorecard across every configured `llmModelCatalog.agent`
route plus the curated OpenRouter routes. The strict gate may pass while route
promotion and official benchmark readiness remain blocked, because the claims
are intentionally separate:

- **OpenRouter-on-Convex harness ready:** the runtime can safely run
  benchmark-shaped spreadsheet/banker work through `agentJobs` and
  `convexModel`, with CAS/no-clobber, L1-L7 resume, multi-user coordination,
  route selection, chart visual evidence, and Docker workspace isolation.
- **Official-style route scorecard:** SpreadsheetBench-like N=5 workbook edits,
  BankerToolBench-like package/verifier tasks, multi-user conflict tasks, and
  provider-route N=5/p95 path stability are normalized route by route. The
  latest report covers 53 agent LLM routes, including 41 OpenRouter/internal
  alias routes and 25 current top-paid OpenRouter tool-capable candidates from
  `npm run openrouter:paid`. Only routes that own repeated live evidence are
  eligible for interactive promotion.
- **Official benchmark promoted:** the external benchmark adapters have run
  official held-out tasks with verifier-owned scoring. BankerToolBench still
  needs Harbor/MCP/Gandalf execution before NodeRoom can claim an official
  score.
- **Full task coverage:** `npm run benchmark:official:task-coverage` records
  whether every published task has been staged and model-run. The current
  ledger is intentionally red/yellow: SpreadsheetBench Verified has 400/400
  staged, but full SpreadsheetBench V1, SpreadsheetBench 2, and BankerToolBench
  are not complete official-task runs yet.

Free and demo-only OpenRouter routes use the same Convex adapter, but stay on
the background/long-running lane until N>=5 p95 ladder evidence proves they are
fast and reliable enough for interactive writes.

## UI layer

- **Runtime mirror:** `src/app/roomStore.ts` exposes the engine via `useEngineRev()` (a
  `useSyncExternalStore` over `engine.subscribe`) — the local stand-in for a Convex reactive query.
- **June 2026 shell:** `RoomShell` composes the target roles directly: left = stable Room/Deal Binder
  context, center = primary Work Surface, right = Copilot conversation/orchestration, and bottom =
  ambient Signal Tape plus authoritative Status Strip. The binder is navigational, not operational;
  agent streams, queues, and steering stay in Copilot or center-stage proof artifacts. Remaining target
  work is live/Convex shell proof, center source/proof split mode, and richer status drilldowns.
  Canonical target: [`docs/TARGET_2026_06.md`](TARGET_2026_06.md).
- **Chats:** the **public room feed is custom** (assistant-ui's thread model is 1:1 user↔assistant, so
  a multi-author room is off-label). The **private `/ask` thread** is where `@assistant-ui/react`'s
  `ExternalStoreRuntime` + tool UIs fit — already built in the sibling **NodeAgent** repo.

## Latency posture (mechanism verified; numbers unmeasured)

For the live (Convex-wired) version, grounded in current sources:

- **Human-driven actions** (type, send, optimistic cell edit) → **~0ms, sub-frame** via optimistic
  local patch — Linear-grade *felt* responsiveness (Linear publishes no numeric SLA; its goal is "a
  synchronous experience with asynchronous data", and its mechanism is local-first).
  - *Validity bound (unmeasured):* the ~0ms is a **mechanism** claim (no server round-trip on local
    apply), not a measured number. It holds at small room size. Today the optimistic cell/note/post-it
    edit `setQuery`s the whole `rooms.full` object (O(room) work per commit), so the felt latency
    degrades as a room grows — revisit with the granular-subscription split. See
    [docs/audit/QA_FINDINGS.md](audit/QA_FINDINGS.md) (P1-8) for the measurement + refactor trigger.
- **Collaboration echo** (your edit visible to others) → **~30–150ms** same-region (estimate, not a
  Convex-published number) — "live", not "instant".
- **Agent `/ask`** → first token **~0.7–1.5s** (non-reasoning models; *never* a reasoning/thinking SKU,
  which blows TTFT to 14–108s) — LLM-category latency made legible by `isRunning` + streaming, not by
  being fast.

**The hardening that makes it real:** batch streamed deltas (~30–100ms / rAF), memoize message
conversion + stable keys, virtualize long threads, and reconcile optimistic messages by a stable
`clientMsgId` (never by text).
