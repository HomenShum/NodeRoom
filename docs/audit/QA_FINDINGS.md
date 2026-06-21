# NodeRoom — QA Findings & Prioritized Problem List

> Staff-engineer triage of the optimistic-responsiveness and real-DOM surface.
> Every claim below is grounded in a verified `file:line` read of the source at audit time.
> Anything inferred (not directly read) is marked **[inferred]**.

---

## 2026-06-09 Update

The core diagnosis still stands, but later branch work moved the suite from
147 to 159 tests and added some Chat/job-control `data-testid` hooks. The
remaining gap is not "zero test ids"; it is "no committed real-browser E2E
harness consuming the hooks." The generated matrix now exposes this as the red
Browser E2E dogfood row.

## 2026-06-20 Supersession

The audit remains useful as history, but the browser-E2E and presence rows are
no longer zero-state. `e2e/realtime-presence.spec.ts` now consumes real test ids
against live Convex to prove non-blocking spreadsheet presence in two browser
contexts, and `presenceClaims` provides bounded advisory cell presence. The
generated matrix has moved Browser E2E dogfood from red to yellow. Product-memory
Playwright is now part of the strict local `prod:gate`; a green production
claim still requires the full clean-checkout gate plus the separate live/load
audits listed in `docs/PRODUCTION_READINESS.md`.

## 1. Executive summary — the false-confidence framing

**The green CI is real, but it proves the wrong thing.** The automated QA suite (147 vitest tests + TypeScript typecheck + Convex typecheck + `qa:matrix:check` + `ladder` + `build`) is **GREEN**, and the deep read confirmed the backend is genuinely well-guarded (see §5 Reliability). But that suite covers exactly two layers:

1. **Backend invariants** via `convex-test` (in-memory only — no browser, no reactivity, no optimism). Ground truth: `convex-test@0.0.53` cannot exercise `withOptimisticUpdate`, the atomic confirm-swap, or any rendered DOM.
2. **Eval / docs-consistency** via the ladder and `qa:matrix:check` (which only diffs generated docs against `docs/qa/production-matrix.json` — `scripts/qa-matrix.ts:91-103` — it runs zero tests and computes zero coverage).

**The actual risk lives in two uncovered places the suite is structurally blind to:**

- **The real-DOM surface.** Zero `data-testid` in `src/` (grep = 0), no Playwright, no `playwright.config.ts`, no E2E. Every flicker, key-remount, optimistic-revert, and two-client merge outcome passes all 147 tests and is only observable in a browser.
- **The optimistic-responsiveness layer.** The product's headline claim — "Linear-grade ~0ms felt responsiveness" (`docs/ARCHITECTURE.md`) — is **mechanism-true but unmeasured**, and it silently degrades at room scale because the entire engine rides one `rooms.full` whole-room subscription (`store.tsx:299`).

**False-confidence statement to internalize:** a green `qa:matrix:check` is a docs-drift gate (good, cheap, correctly scoped) — it is **not** a quality gate, and one feature row (`qa_matrix_continuity`) currently cites the drift-checker as its own evidence, a small but real process-theater seam. Treat "tests pass" as "the backend is sound and the docs are in sync," **not** as "the responsive collaborative UX works."

**Net triage:** No P0 correctness bugs found. The backend (CAS, idempotency, lease, hash-chain, channel authZ) is solid — do not invent reliability bugs. The P1s are all **honest-status / silent-failure UX gaps** on the optimistic and pending surfaces, plus the **missing real-DOM E2E** that leaves the differentiator unproven. The P2s are scale-deferred architecture (rooms.full split, message pagination) and labeling discipline.

---

## 2. Prioritized problem table

Effort: **S** ≈ <0.5d · **M** ≈ 0.5–2d · **L** ≈ >2d. "Gate" = the acceptance check that proves it fixed.

### P1 — do this session (correctness-of-UX / honest-status / unproven differentiator)

| # | Problem | Root cause (symptom → cause) | Evidence (file:line) | Grounded fix | Eff | Acceptance gate |
|---|---------|------------------------------|----------------------|--------------|-----|-----------------|
| P1-1 | **Chat send silently reverts on failure** | Failed send vanishes with no trace → `postMessage` fire-and-forgets `void sendMsg(...)`; rejection is swallowed, Convex discards the optimistic value, bubble disappears. No pending / failed / retry UI. Violates the minimum-states rubric (pending→confirmed→failed+retry, never silent-revert). | `store.tsx:370` (`void sendMsg`), `store.tsx:327-330` (optimistic insert), `messages.ts:21-23` (clientMsgId dedup) | Stop fire-and-forget: track the send promise; render per-message `data-state="pending"` (dimmed "sending"); on reject show a visible **failed** marker + one-tap retry that re-sends the **same** `clientMsgId` (idempotent dedup makes retry safe). | M | Forced send rejection shows a failed bubble with working retry; retry produces no duplicate row (dedup on `clientMsgId`). |
| P1-2 | **Chat bubble key-remount on confirm** | Just-sent bubbles unmount/remount on the optimistic→server swap → keyed `key={m.id}` but optimistic id is `"opt-"+clientMsgId` while server id is the Convex `_id`; the swap changes the React key. Harmless for static text today; breaks Figma anti-flicker for in-bubble edit/selection/animation and is free to fix. | `Chat.tsx:230` (`key={m.id}`), `store.tsx:330` (`opt-`+clientMsgId), `store.tsx:359` (reshape `id: m._id`) | Key bubbles by the **stable `clientMsgId`** instead of `m.id` so the optimistic→server swap preserves the React key and in-bubble state. | S | React DevTools shows no unmount/remount of a bubble across send-confirm; selection inside a just-sent bubble survives confirm. |
| P1-3 | **Legacy TipTap note edit silently reverts on conflict/lock** | Legacy TipTap fallback note edit reverts with zero feedback on a concurrent/agent write → `Note` onBlur calls `commit(...)` but **discards** the `EditFeedback` (unlike `Sheet.doCommit:532` and post-it drag:642 which consume it). The legacy HTML mirror is one coarse element with one version; a second writer loses the entire mirror body and the user sees a silent revert. Native notebooks use ProseMirror Sync + dirty metadata instead. | `Artifact.tsx:588` (onBlur drops feedback), vs `Artifact.tsx:532` (consumes it), CAS at `artifacts.ts:186-188,211-212` | Wire legacy onBlur to consume `commit`'s `EditFeedback` and show `editErrorMsg` on `!ok` (mirror :532/:642). **Also** re-sync TipTap via `setContent` when the editor is unfocused and the reactive doc value is newer than the seeded content. Native notebook tests should cover ProseMirror dirty events/read-model/proposals, not HTML blur commits. | M | Two clients edit the legacy note; the loser sees the conflict affordance (no silent revert); native notebook sync uses its own ProseMirror gate. |
| P1-4 | **Proposal approve hides a CAS conflict (false "applied")** | Host approves an agent proposal; a concurrent human edit bumped the version; the proposal flips to `approved` server-side but the cell write is **rejected** for conflict; `listProposals` (pending-only) drops the card; host believes the value applied — a false belief over canonical CRM/variance data. | `applyApprovedProposal` returns `{ok:false,reason:"conflict"}` `artifacts.ts:186-188`; surfaced via `resolveProposal` `artifacts.ts:325→334`; store **discards** result `store.tsx:373`; interface typed `Promise<void>` `store.tsx:105`; `decide()` has no failure branch `Artifact.tsx:756`; `acceptAll` loops silently `Artifact.tsx:719-726` | **Reactive-honest, NOT optimistic.** (1) Change store contract: `resolveProposal` returns `Promise<{ok:true}\|{ok:false;reason}>` (`store.tsx:105`, wrapper `:373` returns `r`). (2) Keep the card mounted via existing `busy`/`disabled` during await; on `{ok:false}` set a row-local error ("conflict — the cell changed; re-run or dismiss") with Dismiss/Retry. (3) `acceptAll` aggregates: "approved N, M conflicts." **Do NOT** optimistically remove the card — that is exactly what hides the conflict. | M | Concurrent edit + approve → card stays with a visible conflict message; `acceptAll` over a mixed batch reports the conflict count; no card silently vanishes on a rejected write. |
| P1-5 | **Agent `/ask` runs as a client action in the hot path** | `/ask` feels frozen → `useAction(runRoomAgent)` (`store.tsx:337`) serializes 3 round-trips (rooms.full read + 2 idempotency mutations) before the model starts, with no reactivity/optimism/retry. Steps are written **terminal-only** (run-end), so "render steps as they land" is not free — they all land at once. UI shows binary typing-dots only. | `store.tsx:337` (useAction); terminal-only writes `agent.ts:260,264,282`; pre-loop only `agent.ts:130,160`; contrast `/free` mutation `agentJobs.ts:216` + per-slice writes `agentJobRunner.ts:182-203` + live strip `Chat.tsx:179-226` | **Converge `/ask` onto the existing `/free` job model (reuse, not new machinery).** (1) Add an `agentJobs` mutation entrypoint for `public_ask` (mirror `startFreeAuto`: insert queued row, record event, `start()`/schedule runner, return `jobId` instantly). Call via `useMutation` from `store.askAgent`. (2) Make the `/ask` runner write **incrementally** (per-slice / per-N-steps `agentStepsRecord`). (3) Replace typing-dots with the `/free` job-strip/step-trace (`Chat.tsx:179-226`). Keep CAS + idempotency claim-or-reuse exactly as-is. **No** optimistic agent writes, **no** per-token streaming. | L | `/ask` shows an instant reactive "queued" row; step trace lands incrementally during the run, not all at end; queued→running→done/failed+retry visible; gated behind one browser smoke check (precondition below). |
| P1-6 | **No browser/real-DOM E2E — differentiator is unproven** | The headline claims (optimistic apply → no-flicker confirm-swap; CAS-conflict revert without dropping a co-editor's intent) are **unprovable** by `convex-test` (no reactivity/optimism/UI). They pass every unit test and only fail in a real browser. ARCHITECTURE.md itself admits "~0ms" is not measured live. | `convex-test@0.0.53` (backend-only); no `playwright.config.ts`; 0 `data-testid` in `src/`; client reconcile `store.tsx:312-326,366-368` | **Thin, scoped harness — not all 8 flows.** Add Playwright + real Convex (local backend). **Spec A:** client X optimistic cell edit renders instantly, then server confirms with **no flicker** (value-stability across animation frames). **Spec B:** X and Y edit the same cell concurrently → loser's UI reverts to canonical value, winner's intent preserved, non-silent failure affordance shown. Push public/private leak, job cancel/retry, proposal accept/reject **DOWN** to `convex-test` as a role×channel×op authZ matrix (cheaper, deterministic). | L | 2 two-context Playwright specs green against a live backend + an expanded `convex-test` authZ matrix; depends on P1-7 testids. |
| P1-7 | **No `data-testid` anywhere in `src/`** | Real-time UI nodes re-render on any room write and post-it/cell values **are** user content, so text/CSS/role selectors would be maximally brittle → no stable test hooks exist, blocking any reliable E2E. | grep `data-testid` in `src/` = 0; surfaces in `Chat.tsx`, `Artifact.tsx` | **Seed testids as the first commit of the P1-6 slice, not standalone.** Add to: composer input, send button, message/trace row, proposal-card + accept/reject, post-it, note editor, spreadsheet cell, job-row. Crucially add load-bearing state signals: `data-state="pending\|confirmed\|failed"` on optimistic-write targets and a deterministic `data-cell-key`. **Do not** blanket-instrument; if a testid has no consuming assertion, don't add it yet. | S | Each named surface has a stable testid consumed by a P1-6 assertion; no dead (unconsumed) testids. |
| P1-8 | **`rooms.full` whole-room query (elements split)** | Historical finding: any room write re-ran the whole-room query and re-rendered every subscriber because `full` read 6 tables incl. **all elements across all artifacts** in one query. Superseded 2026-06-20 by the `rooms.meta` + `artifacts.elements` split and separate `presenceClaims`; keep this row as the audit root cause, not as current architecture. | historical: `rooms.ts:69-96`; old optimistic God-object `store.tsx:312-326`; member `lastSeenAt` still has no heartbeat, while spreadsheet presence now uses separate `api.presence.heartbeat` | **Shipped root-cause split.** Elements are carved into per-artifact subscriptions and spreadsheet presence lives outside the artifact ledger. Future per-visible-cell windowing remains a later scale tier, not the first fix. | M | Current acceptance is covered by split query tests plus `e2e/realtime-presence.spec.ts`; broader product-memory browser coverage remains open. |

> **P1 sequencing note:** P1-1, P1-2, P1-3, P1-4 are cheap correctness fixes with **no trigger — do them this session**. P1-5 and P1-8 are larger; P1-6/P1-7 gate the verification of all of them. Do the cheap honest-status fixes first, then the harness, then the refactors.

### P2 — schedule (right-sized today; stage-gated or labeling)

| # | Problem | Root cause | Evidence (file:line) | Grounded fix | Eff | Acceptance gate |
|---|---------|-----------|----------------------|--------------|-----|-----------------|
| P2-1 | **Cell edit rides `rooms.full` (coupling)** | The optimistic cell-edit handler is **correct** (reversible + predictable + client-authoritative + CAS merge). The cost is the whole-room re-render blast radius — a property of the `rooms.full` shape, **not** the optimism choice. | `store.tsx:312-326`; CAS `artifacts.ts:197-213`; revert UX `Artifact.tsx:412` | **Keep the optimistic update exactly as-is.** Fix lives in P1-8 (elements split); after the split, add the same `if undefined → no-op` guard on the granular query. No CRDT, no de-optimize. | S | Post-P1-8: handler writes a per-artifact slice; un-loaded slice no-ops instead of throwing. |
| P2-2 | **Post-it text + drag — verification debt only** | Already optimistic via `applyCellEdit`; no-flicker follows from React 18/19 event batching (optimistic `setQuery` + dnd-kit transform-reset coalesce into one paint) + Convex optimistic-hold. The honest gap is **no visual test**, not design. | `Artifact.tsx:642,688` → `commit():401` → `applyCellEdit` `store.tsx:312` | **Change nothing in the code path.** Add ONE Playwright bounding-box test that drags a post-it and asserts no backward jump on release + a `data-testid` on `.r-postit`. **Do NOT** add manual transform/base reconciliation or drag-shadow state. | S | Bounding-box assertion across the release frame shows no back-snap. |
| P2-3 | **Job cancel/retry — silent in-flight + silent failure** | Status is already reactive (eventual feedback), but the **in-flight window** has no disable/spinner (buttons double-clickable) and the failure path is silent → `store.tsx:511-512` awaits and **discards** `{ok:false,reason}`; `Chat.tsx:168,173` onClick fire-and-forget; no toast/catch infra. Server guards (terminal/not_retryable/lease) make it data-safe → UX-honesty gap, not correctness. | `store.tsx:511-512`; `Chat.tsx:55,59-60,166,168,173,185` | **Minimal triad: pending + disable + failure-surface.** Local in-flight state per action; on click disable + spinner ("Cancelling…"/"Retrying…"); `store.tsx:511-512` must **return** the result; on `{ok:false}` show inline error reusing the `Chat.tsx:185` pattern. **No** optimistic status, **no** global toast. | S | Double-click during cancel is a no-op; cancel-on-terminal shows a visible "can't cancel: already finished." |
| P2-4 | **Auto-allow host toggle not optimistic** | Currently reactive — and that is **right-sized**. The mutation is a server-computed **flip** (`!r.autoAllow`), host-only, host-singular, rare admin policy switch; the consequential ON direction is consent-gated. A naive optimistic flip off a stale base would bounce on echo. | `rooms.ts:98-108` (server flip + host_required); consent gate `RoomShell.tsx:51-67` | **Keep reactive for now.** IF a trigger justifies it: first change the mutation to an idempotent **SET** (`{next:boolean}` writing `autoAllow:next`), then add `withOptimisticUpdate` + failed-state. ~6 lines, mirrors `applyCellEdit`. | S | Deferred; if implemented, optimistic and server values are deterministically equal (SET, not flip). |
| P2-5 | **Message edit not optimistic (flicker on save)** | On save the editor closes synchronously while the bubble renders OLD server text, then jumps to new text when `messages.list` re-runs → `editMsg` is a plain mutation (`store.tsx:333`); visible revert-then-correct flicker (Figma anti-flicker failure). Edit is optimistic-**safe**: reversible, predictable (`db.patch` same `_id`, text-only), author-gated, LWW. Easier than the optimism already shipped. | `Chat.tsx:293` (sync close); `store.tsx:333`; `messages.ts:50,52,54` | Wire `editMsg` with `withOptimisticUpdate` mirroring `sendMsg`: match by `_id` across both list refs (public + actor's private), map → replace text → `setQuery`. **Companion HONEST_STATUS fix:** `messages.update` must return `{ok}\|{ok:false,reason}` instead of silently returning `undefined` on not-author/not-found; on `!ok` revert + inline error. **No** pending spinner (under-delivers for predictable text). | S | Save paints new text instantly with no flicker; a rejected edit reverts with a visible affordance, not silently. |
| P2-6 | **`addResearchRows` silent failure + double-insert** | A server reject leaves the paste panel open with the typed text and **no error**; user re-clicks → slug-collision suffix loop silently double-inserts rows → `addRows()` has try/**finally** but **no catch**. (Upload, by contrast, is already a correct pending→confirmed→failed machine — leave it alone.) | `Artifact.tsx:223-231` (no catch); server ID gen `artifacts.ts:370-372,432`; upload reference `LeftRail.tsx:36-50,77-81` | Wrap `addRows()` in try/**catch**; on error `setPasteError` and keep panel open (don't clear `pasteText`); flip primary button to "Adding…" while busy. Reuse upload's error-surface pattern. **Do NOT** build an optimistic skeleton/temp-id row — IDs + 13 enriched columns are server-authoritative; a skeleton would flicker and risk discard-on-conflict. | S | A rejected add shows an inline error, panel stays open, no double-insert on retry. |
| P2-7 | **`messages.list` unbounded `.collect()`** | Full channel history re-downloaded on join + re-pushed on every write; optimistic handler rebuilds the whole array per send; `Chat.tsx` renders every message un-virtualized → `.collect()` is index-scoped to one room+channel (better than `rooms.full`), but unbounded, ×2 (public+private), with **no retention cron** and no cap. Benign at demo scale (eager full-context is a feature). | `messages.ts:41`; `store.tsx:302-303,330`; `Chat.tsx:230`; no `convex/crons.ts` | **Two cheap de-risks now:** (1) defensive server cap — `.order("desc").take(LIMIT≈200)` so unbounded can never silently degrade; (2) instrument channel length / alert > ~500. **Full migration** (`usePaginatedQuery` + `insertAtTop`/`optimisticallySendMessage` + `Chat.tsx` virtualization) only when the trigger fires — pagination without virtualization still grows the DOM. Retention/archival is a **separate** decision. | S (cap) / M (full) | Cap bounds payload/DOM with no UX change at small scale; full migration green only when trigger fires. |
| P2-8 | **`qa:matrix:check` could be read as a quality gate (theater risk)** | Drift-only check correctly scoped, BUT the `qa_matrix_continuity` row scores **itself green** citing `qa:matrix:check` as a `deterministicChecks` entry — the exact circularity to avoid. CI already keeps it separate from tests/typecheck/ladder/build. | `scripts/qa-matrix.ts:91-103`; `production-matrix.json:198-216`; CI `.github/workflows/ci.yml:24-39` | **Keep script as-is (drift-only).** (1) Label it everywhere as "docs-sync / drift gate," never "coverage." (2) Remove `qa:matrix:check` from the `qa_matrix_continuity` row's deterministic evidence (use `tests/qaMatrix.test.ts` only). (3) Add an assertion: no "green" row may cite `qa:matrix:check` as its primary deterministic check. **No** turning the script into a test-runner. | S | Test fails if any green row cites the drift-checker as primary evidence; docs/CI step renamed to "docs-sync." |
| P2-9 | **"Linear-grade ~0ms" claim is unmeasured + degrades at scale** | The claim is **mechanism-true** (optimistic local apply, no server round-trip on paint) and the doc already hedges ("*felt*", "estimate, not Convex-published"). But the literal number becomes false at scale: one keystroke mints a new whole-room object via `rooms.full` (`store.tsx:325`), doing O(room) work per edit. Not a measurement gap — an architectural one. | `ARCHITECTURE.md:159-163`; `store.tsx:299,312-325`; `rooms.ts:77-94` | **Two small edits, no harness.** (1) Make it mechanism-bound: "no server round-trip on local apply — sub-frame felt latency at small room size (single optimistic write path)." (2) Add a caveat tying validity to room size + pointing at the P1-8 `rooms.full` decision. **Do NOT** build a perf harness now (gold-plating pre-scale); defer measurement to the trigger. | S | ARCHITECTURE.md states the claim as a mechanism with an explicit room-size validity bound. |

---

## 3. Necessary vs Minimal vs Maximal — the contested calls

Three decisions where the judge **disagreed** with the proposer or flagged over/under-engineering. These are where the easy reflex is wrong.

### 3A. Proposal approve (P1-4) — proposer said "add optimistic card removal." That is OVER **and dangerous.**
- **Minimal (wrong / under):** do nothing — relies on the card silently disappearing = hides the conflict permanently.
- **Maximal (wrong / over + dangerous):** the proposer's "optimistically remove the card / mark applying while CAS reconciles." Removing the card before the server confirms is *precisely* what converts a 300ms dim into a permanent false "applied." The card payload (did the CAS write land?) is **server-computed and not predictable from the click** — the rubric's exact disqualifier for optimism.
- **Necessary (correct):** keep the card mounted (the `busy`/`disabled` pending indicator already exists — this was never a feedback void), thread `{ok,reason}` through, branch the UI on conflict, aggregate `acceptAll`. **Reactive-honest, zero `withOptimisticUpdate` added.** Optimistic removal is acceptable later **only** on the pure-reject path (no CAS write) if reject volume ever justifies it.

### 3B. `rooms.full` (P1-8) — proposer said unconditional UNDER + per-cell windowing. Judge: STAGE-DEPENDENT, and per-cell windowing is OVER.
- **Minimal (wrong / under at scale):** keep the God-object — fine at demo scale, but agent write-bursts amplify it.
- **Maximal (wrong / over):** per-visible-cell-window subscriptions. At audit time,
  `lastSeenAt` was never patched and commits were per-blur, so the "every
  keystroke re-renders everyone" amplifier was absent. Current spreadsheet
  presence uses separate `presenceClaims`, not `members.lastSeenAt` or
  `rooms.full`.
- **Necessary (correct):** split out **only** the one high-cardinality, high-churn table (elements) into per-artifact subscriptions; keep the five low-cardinality per-room tables as a shared `rooms.meta`. Per-cell windowing is the *next tier*, not the fix.

### 3C. No-E2E (P1-6) — proposer said "5 critical-flow specs." Judge: that is partly OVER; the irreducible gap is narrower.
- **Minimal (wrong / under):** zero E2E — leaves the core differentiator (optimistic reconcile + anti-flicker + CAS merge) entirely unproven.
- **Maximal (wrong / over):** drive public/private leak, job cancel/retry, proposal accept/reject through Playwright — these are **server-state** invariants whose root cause is a missing server guard; `convex-test` catches them deterministically at ~100× less flake/maintenance. Driving them through the DOM duplicates backend coverage.
- **Necessary (correct):** ~2 two-browser-context Playwright specs for the **irreducibly real-DOM** path (optimistic confirm-swap no-flicker + concurrent-CAS-loser revert), **plus** expand the `convex-test` authZ matrix (role × channel × op) in the same session for everything server-authoritative. The repo uses `convex-test` in only 2 of 27 test files — extending it is the cheaper, higher-value first move.

> **Honest-status sub-theme tying P1-1/3/4/5 and P2-3/5/6 together:** the recurring root cause across the non-optimistic mutations is the store wrappers **awaiting and discarding** the discriminated `{ok,reason}` result (`store.tsx:373,511-512`), typing several as `Promise<void>` (`store.tsx:105`), and the backend silently returning `undefined` on failure (`messages.ts:50,52`). The single highest-leverage refactor is to make every can-fail mutation return its result and every call site branch on it. This is a HONEST_STATUS fix, not an optimism feature.

---

## 4. Sequenced 3-wave remediation plan

### Wave 1 — cheap optimism/honest-status wins + testids (this session, mostly S)
1. **P1-2** key bubbles by `clientMsgId` (S, pure correctness).
2. **P1-1** chat send failed-state + retry (M).
3. **P1-3** note onBlur consume feedback + re-sync TipTap on stale (M).
4. **P1-4** proposal `{ok,reason}` thread + conflict surface + `acceptAll` aggregate (M).
5. **P2-5** message-edit optimism + `messages.update` honest return (S).
6. **P2-6** `addResearchRows` catch + double-insert guard (S).
7. **P2-3** job cancel/retry pending+disable+failure-surface (S).
8. **P1-7** seed `data-testid` + `data-state` on the named surfaces (S) — first commit of Wave 2.
9. **P2-8 / P2-9** labeling: docs-sync wording, `qa_matrix_continuity` evidence fix, mechanism-bound responsiveness claim (S).

### Wave 2 — E2E harness + pending indicators + `/ask` affordance (M–L)
1. **P1-6** Playwright + local-Convex harness: Spec A (optimistic confirm-swap no-flicker), Spec B (concurrent CAS-loser revert). Plus `convex-test` role×channel×op authZ matrix.
2. **P2-2** post-it drag bounding-box smoke test.
3. **P1-5** converge `/ask` onto the `/free` job model (public_ask mutation + incremental step writes + reuse the live job strip), verified by a browser smoke check.
4. **P2-7** defensive `.take()` cap on `messages.list` + channel-length instrumentation.

### Wave 3 — `rooms.full` granular-subscription refactor (when the trigger fires) (M–L)
1. **P1-8** carve **elements** into per-artifact subscriptions; keep `rooms.meta` thin. Shrink the `applyCellEdit` optimistic body to a per-artifact `setQuery`. (P2-1 resolves for free.)
2. Full `messages.list` pagination + `Chat.tsx` virtualization (`usePaginatedQuery` + `optimisticallySendMessage`/`insertAtTop`).
3. **P2-4** auto-allow SET-semantics + optimistic flip, **only** if its trigger fires.
4. Re-measure the responsiveness claim with `performance.now` around commit→render and substantiate with a real number (P2-9 revisit).

**Wave-3 triggers (any one):** a room exceeds ~2–3 concurrent editors OR an agent run is active while humans edit; total elements per room > ~1–2k; a single channel routinely > ~500–1000 messages; measured edit-to-paint p95 > ~50ms under 2 editors; or the product moves from ephemeral demo rooms to long-lived persistent rooms.

---

## 5. Reliability posture — solid, do NOT invent bugs

The deep read confirmed the backend guards are genuinely strong. Recording this so future triage does not manufacture phantom reliability findings:

- **CAS anti-clobber** — every cell write rejects a stale baseline: `actual !== baseVersion → {ok:false,reason:"conflict"}` (`artifacts.ts:211-212`); same gate inside proposal apply (`artifacts.ts:186-188`). Unit-covered ("stale CAS conflicts do not write," `agentJobsRuntime.test.ts`).
- **Idempotency** — chat send dedups on `(roomId, clientMsgId)` via `by_clientMsgId` before insert (`messages.ts:21-23`, `schema.ts:173`); agent start uses claim-or-reuse idempotency mutations (`agent.ts:130,160`); `/free` jobs carry idempotency keys (`agentJobs.ts:216`).
- **Lock gate** — a held range is read-only for non-holders (`artifacts.ts:204-207`).
- **Channel authZ** — `requireActorCanUseChannel` + `requireActorProof` on every messages/artifacts/rooms/locks/collab path (e.g. `messages.ts:20,39-40`); public/private isolation is server-enforced, not UI-enforced.
- **Host gating** — `host_required` on `toggleAutoAllow` (`rooms.ts:104`) and collab run.
- **Lease / hash-chain** — per-slice runner writes and lease checks in `agentJobRunner.ts` and the trace chain (the `qa:matrix` continuity row reflects this). **[inferred from matrix + runner read; not line-traced in this pass.]**

**The reliability gap is verification surface, not logic:** these invariants are correct and partly unit-covered; what's missing is the **client-side reconciliation** proof (P1-6) and the **honest-status plumbing** that surfaces these server rejections to the user instead of discarding them (P1-1/3/4, P2-3/5/6).

---

*Grounding index (verified this pass): `store.tsx:105,299,302-303,312-326,327-330,333,337,359,366-373,511-512`; `messages.ts:20-23,36-43,46-56`; `rooms.ts:67-108`; `artifacts.ts:180-213,370-372,432`; `Artifact.tsx:218-231,395-414,520-592,642,688,754-760`; `LeftRail.tsx:35-86`; `Chat.tsx:55,59-60,166-239,293`; `schema.ts:172-173`; `agent.ts:130,160,260-282`; `agentJobs.ts:216`; `agentJobRunner.ts:182-203`; `scripts/qa-matrix.ts:91-103`; `production-matrix.json:198-216`; `ARCHITECTURE.md:159-163`. Convex 1.40.0 optimistic semantics and absence of `playwright.config.ts` / `data-testid` / `lastSeenAt` heartbeat confirmed.*
