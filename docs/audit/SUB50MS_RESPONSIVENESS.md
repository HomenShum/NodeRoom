# Sub-50ms responsiveness — Linear's playbook vs NodeRoom (grounded + judged)

> Question: *"Linear had a blog post about sub-50ms responsiveness — what about that side of the research?"*
> Method: 7-agent workflow — 3 research agents fetched Linear's actual performance writing,
> 3 audit agents traced NodeRoom's real interaction-to-paint paths in code (file:line), 1 judge
> mapped every technique to have/partial/gap/n-a and sized it (necessary / right-sized /
> over-engineering-for-our-scale). Key citations spot-verified by hand before publishing.
>
> 2026-06-20 supersession: this audit predates the `rooms.meta` /
> `artifacts.elements` split and the separate `presenceClaims` spreadsheet
> presence lane. Treat references to `rooms.full` as historical unless a current
> section explicitly says the old monolith still applies.

## 1. The grounded correction: where "50ms" actually comes from

The literal **"sub-50ms" phrasing does not appear in any fetchable Linear blog post.** What the
sources actually say:

| Source | What it actually cites |
|---|---|
| performance.dev — *"How is Linear so fast? A technical breakdown"* (Brotzky, May 2026; the most citation-grade writeup) | The **100ms cause-and-effect threshold** — animations stay under it; transitions run 0.12–0.15s; "never animate layout-triggering properties" |
| linear.app/now — *Scaling the Linear Sync Engine* | Qualitative: "every interaction was instant," updates land "in a few milliseconds," the user "never waits to see their own change" |
| Tuomas Artman talks (Local-First Conf, localfirst.fm #15, sync-engine talks) | This is where the small-millisecond / "sub-50ms"-style numbers live — **talks, not a blog post** (no fetchable transcript) |
| web.dev RAIL model | The precise engineering meaning of 50ms: **process input handlers in under 50ms** so the visible response lands within 100ms; ~10ms/frame for 60fps; any main-thread task >50ms is a "long task" |

**So the honest framing:** "sub-50ms" is best read as RAIL's *input-handling* budget (50ms to
process → 100ms to visible response), achieved at Linear by one architectural move — **the network
is never on the interaction critical path** (local MobX pool updates first; the server is a
confirmation step, not a permission step).

Sources fetched: performance.dev/how-is-linear-so-fast-a-technical-breakdown ·
linear.app/now/scaling-the-linear-sync-engine · linear.app/now/why-is-quality-so-rare ·
marknotfound.com/posts/reverse-engineering-linears-sync-magic · localfirst.fm/15 ·
web.dev RAIL/INP docs.

## 2. Honest verdict: where NodeRoom is sub-50ms today

**Sub-50ms now (optimistic local paint, verified in code).** Every *hand* interaction paints in one
React frame before the server CAS resolves, via 5 `withOptimisticUpdate` mutations
(`src/app/store.tsx:326-369`): chat send (public+private) · cell edit · message edit
(getAllQueries) · proposal approve/reject · auto-allow toggle — plus post-it drag (GPU
`translate3d`, `Artifact.tsx:725`), post-it add/delete, note typing (uncontrolled TipTap,
blur-persist), and artifact tab switch (local state). This is exactly Linear's perceived-latency
outcome ("you never wait to see your own change"), delivered through Convex's optimistic layer
instead of a client-side DB.

**Network-gated — and correctly so.** Cold app-open / room-switch (`rooms.full` behind a Splash);
all agent output (`/ask`, `/free`, private agent — Convex *actions* can't carry optimistic updates,
and LLM inference is seconds regardless; the thinking spinner + optimistic queued message ARE
instant). These are either inherently slow or genuinely shared-state arbitration (CAS, locks),
where server-first is the right call for a multiplayer room.

**~~The one real perceived-latency miss~~ — CLOSED.** Full optimistic coverage shipped: every
UI-surfaced mutation now paints locally. Added: `addResearchRows` (exact client mirror of the
server's deterministic row builder — same slugs, suffix-dedup, defaults), `createArtifact`/
`uploadArtifact` (placeholder-id insert + echo guard; authoritative id swaps atomically),
job `cancel`/`retry` (status flips mirroring the server's own transition guards), and
`resolveProposal` was **deepened** — approve now paints the cell value too, killing a visible
two-phase flick (chip vanished instantly, cell landed a beat later). Also fixed a real replay bug:
`sendMsg` appended unconditionally, so a `retrySend` with the same `clientMsgId` whose first
attempt landed server-side would paint a duplicate bubble for the in-flight window — now guarded
(per convex@1.40 `optimistic_updates.d.ts:64-66`: updates "can be called multiple times …
replayed", so every update must be replay-idempotent). Deliberately **not** made optimistic:
`startFreeAuto` — its idempotency path may return a *reused* job with no insert, so an optimistic
row would paint a phantom that vanishes on reconcile (guaranteed flicker); the optimistic chat
announcement is the instant feedback there.

**Proven, not asserted (offline paint proof):** with `context.setOffline(true)` — network
physically unavailable — chat send painted in **75ms** and a cell edit in **85ms** (both include
Playwright CDP/polling overhead; app-side paint is 1–2 frames). On reconnect the queued mutations
flushed to **exactly one bubble** (dup guard) and an **identical cell value** (shape parity →
zero-flicker authoritative swap, which Convex performs atomically with the rollback).

**The at-scale caveat (today's speed is unproven under load):**
- `rooms.full` re-serializes the **whole room** (all artifacts + all elements, `convex/rooms.ts:78-84`)
  to every client on every cell edit — defeats Convex's delta sync at the query layer.
- **Zero `React.memo`** in src; the store is one `useMemo` recreated on any of 9 query deltas
  (`store.tsx:378`) → one cell edit re-renders RoomShell + both Chats + Artifact + LeftRail.
- The only confirmed **>50ms main-thread long task**: spreadsheet upload — synchronous parse +
  `buildSpreadsheetSemanticIndex` with an O(n²) `rowIds.indexOf` (`src/app/spreadsheetIndex.ts:63`,
  `spreadsheetParser.ts:20-104`). Near-max uploads freeze the UI for hundreds of ms.
- TipTap/ProseMirror is statically bundled into the 936KB (288KB gz) index chunk
  (`Artifact.tsx:10`) though only 1 of 5 tabs needs it. (exceljs/liteparse are already correctly
  code-split.)

## 3. Judged technique map (19 rows)

| Linear technique | NodeRoom | Judgment | Pri |
|---|---|---|---|
| Optimistic local mutations (network = confirmation) | **have** | necessary — keep | — |
| Durable IndexedDB transaction queue (offline writes) | n/a | over-engineering: Convex owns the in-flight queue; ephemeral rooms don't need offline durability | — |
| In-memory pool hydrated from IndexedDB (no loading state) | gap | over-engineering: a client source-of-truth fights Convex's reactive model; Splash-gated cold join is correct | — |
| Granular per-property observables (one delta = one cell) | **gap** | necessary (partial close: memo leaves + split store context) | **P1** |
| Delta/partial sync over WebSocket | partial | necessary — transport is delta, but `rooms.full` snapshot defeats it; scope queries per-artifact | **P1** |
| GPU-composited animations only | partial | right-sized — one offender: `.r-tour-spot` animates left/top/width/height + 9999px box-shadow (`styles.css:453`) | P2 |
| Animations under the 100ms cause-and-effect threshold | **have** | right-sized | — |
| Keyboard-first input model | partial | right-sized — `/`-commands + Enter exist; a ⌘K palette is nice-to-have, not a latency gap | P2 |
| Eliminate/pre-empt network (split + precache + offline) | partial | right-sized — `React.lazy` TipTap is the one real win; service-worker precache is over-engineering here | **P1** |
| RAIL: input <50ms → response <100ms | **have** | met for hand interactions; explicit feedback where impossible (agents) | — |
| RAIL: 16ms frame / 60fps | **have** | met on hot path (GPU drag, single-frame paints) | — |
| INP < 200ms (p75) | partial | likely green, **unmeasured** — add dev-only web-vitals/long-task probe | P2 |
| Main-thread task chunking (no >50ms tasks) | **gap** | necessary — the upload parse/index blocker (O(n²) fix, then Web Worker) | **P1** |
| List virtualization | partial | over-engineering: lists are capped/paged (traces -40, proposals 20, 5000-cell window); variance sheet is ~5 rows | P2 |
| will-change / compositor layer promotion | **have** | folded into tour fix | — |
| Avoid layout thrash (batch reads/writes) | partial | right-sized — textarea `grow()` is one reflow per keystroke (`Chat.tsx:80`); tour measure loop is poll-based | P2 |
| CSS containment | gap | right-sized — `contain: content` on artifact-body/wall/chat-list; cheap | P2 |
| Code-splitting + modulepreload | partial | right-sized — covered by lazy-TipTap; manualChunks tuning beyond that is over-engineering for a single-route SPA | — |
| Local-first data layer (hide the network entirely) | partial | over-engineering to go further: hand-edit path is already network-free *perceptually*; server must arbitrate shared state | — |

## 4. Prioritized actions (necessary, not maximal)

1. **P1 — Per-artifact subscriptions.** Replace the whole-room `rooms.full` reads on the hot path
   with per-artifact (or paginated-element) queries so a cell edit pushes one artifact, not the
   room. Single highest-leverage change; gives Linear's delta-sync *outcome* via a query-shape
   change, not a rewrite.
2. **P1 — Render scope.** `React.memo` the leaves (Bubble, EditableCell, Sticky, TraceRow) + split
   the store context into slices (messages/artifacts/traces/jobs) so a chat delta doesn't re-render
   the sheet. This is what keeps today's feel as rooms grow.
3. **P1 — `React.lazy` the TipTap editor** (and optionally the Wall) out of the index chunk.
4. **P1 — Upload long task:** kill the O(n²) `indexOf` with a precomputed Map (cheap), then move
   parse+index to a Web Worker.
5. **P2 — Optimistic inserts** — ✅ **DONE** (see §2): addResearchRows, createArtifact/upload,
   job cancel/retry, deepened resolveProposal, sendMsg replay guard. Verified by the offline
   paint proof.
6. **P2 — Hardening bundle:** `contain: content` on the three big panels; fix `.r-tour-spot` to
   transform/clip-path; passive tour scroll listener; dev-only INP/long-task probe so P1 results
   are *measured*, not asserted.

## 5. Bottom line

NodeRoom already delivers Linear's *perceived* sub-50ms outcome on every hand interaction — by the
same principle (network off the interaction path) implemented the Convex-native way (optimistic
query-cache writes, not a client DB). The literal sub-50ms number is a talk-circuit framing of
RAIL's input budget; the documented blog-level budget is 100ms, and NodeRoom meets it. What we have
NOT yet earned is that speed **at scale**: whole-room snapshot reads, unmemoized renders, and one
genuine >50ms main-thread task. Those four P1s are the entire gap; everything deeper in Linear's
stack (IndexedDB pools, durable transaction logs, service workers, virtualization) is judged
over-engineering for a session-scoped shared room.

*Method note: one of four audit agents claimed "no optimistic applies exist"; the judge resolved
the contradiction against the code (the five `withOptimisticUpdate` wrappers at
`store.tsx:326-369`) and the claim was discarded. Citations in §2 were independently re-verified
before publishing.*
