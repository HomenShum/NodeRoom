# NodeRoom — Full-Stack Dogfood Audit (Diagnose Step)

> Produced by a grounded, judged process: parallel deep-read of every subsystem → production-pattern + Convex 1.40 SDK research (Context7 + source) → **adversarial judge** of every design decision (over- / under- / right- / stage-dependent) → design. Nothing here is asserted; each claim is grounded in a verified `file:line` or a cited source.
>
> Companion docs: [OPTIMISTIC_UI_PLAN.md](OPTIMISTIC_UI_PLAN.md) · [E2E_DOGFOOD_DESIGN.md](E2E_DOGFOOD_DESIGN.md) · [QA_FINDINGS.md](QA_FINDINGS.md)

---

## 0. The three questions, answered

**Q1 — Do we already have end-to-end QA dogfood?**
**Partial.** The backend/eval layer is strong and **green** (147 vitest tests, TS + Convex typecheck, `qa:matrix:check`, ladder, build). But it is structurally blind to the product's actual differentiator: **there is zero browser/real-DOM E2E** (no Playwright, no `playwright.config.ts`, no `data-testid` in `src/`). `convex-test@0.0.53` is backend-in-memory only — it cannot exercise `withOptimisticUpdate`, the confirm-swap, reactivity, or any rendered pixel. So a fully green CI proves *the backend is sound and docs are in sync*, **not** that the responsive collaborative UX works. → Designed in [E2E_DOGFOOD_DESIGN.md](E2E_DOGFOOD_DESIGN.md).

**Q2 — Is the UI highly optimistic across all features?**
**The core editing surface already is** — and this is the key correction to the first-pass read. A single well-designed path (`commit()` → `store.applyEdit` → `applyCellEdit.withOptimisticUpdate`, store.tsx:312/366) makes **spreadsheet cells, the note doc, post-it text, post-it drag/position, and element create/delete** all optimistic, **plus** chat send. The headline error is **not "missing optimism."** It is **silent failure**: optimistic *and* reactive mutations `await … then discard the {ok,reason}`, so CAS conflicts, host-only rejections, and terminal-state races **revert or vanish with zero UI signal** — a HONEST_STATUS violation. "Ensure highly optimistic UI" therefore means *harden the failure edges of the existing optimism + fix one scale coupling*, **not** paint optimism everywhere (which the judges showed would introduce bugs). → Plan in [OPTIMISTIC_UI_PLAN.md](OPTIMISTIC_UI_PLAN.md).

**Q3 — What are the addressable problems?**
**No P0 correctness bugs. Reliability spine is genuinely solid** (CAS, lock→draft→smart-merge, idempotency keys, leases, SHA-256 step chain — verified, partly unit-covered; do **not** invent reliability bugs). The addressable work is **8 P1 + 9 P2**, dominated by silent-failure/honest-status UX gaps and the missing real-DOM E2E. → Full table in [QA_FINDINGS.md](QA_FINDINGS.md).

---

## 1. The corrected premise (why the judged path mattered)

A deep-read agent **asserted** notes and post-its were non-optimistic and laggy. Traced to root before believing it:

```
Artifact.tsx onBlur/onDragEnd → commit() (Artifact.tsx:401) → store.applyEdit (store.tsx:366) → applyCellEdit.withOptimisticUpdate (store.tsx:312)
```

The claim was **false** — the entire artifact-element surface is optimistic. The polluted premise was corrected in the judge inputs before judging, so the verdicts and deliverables are grounded in the true picture. This is the diagnose discipline working as intended: *judge, don't assert.*

---

## 2. Judged verdicts — 16 decisions

The judges were instructed to **challenge**, not rubber-stamp. They **disagreed on 4 of 16** — and every disagreement was a deeper root cause, in *both* directions (catching an under-call **and** an over-reach).

| # | Decision | Proposer | **Judge** | Agree? | Prio |
|---|----------|----------|-----------|:------:|:----:|
| 1 | Chat send optimistic | right/keep | **stage-dependent** | ✗ | P1 |
| 2 | Cell edit optimistic (rides rooms.full) | right but coupled | **right** | ✓ | P2 |
| 3 | Note editor | right (already optimistic) | **under** | ✗ | P1 |
| 4 | Post-it text + drag | right (already optimistic) | **right** | ✓ | P2 |
| 5 | Proposal resolve mode | stage-dependent | **stage-dependent** | ✗ | P1 |
| 6 | Job cancel/retry mode | pending-indicator | **under** | ✓ | P2 |
| 7 | Auto-allow toggle | under (add optimism) | **stage-dependent** | ✗ | P2 |
| 8 | Message edit | under | **under** | ✓ | P2 |
| 9 | Create / upload / add-rows | pending-indicator | **right** | ✓ | P2 |
| 10 | Agent /ask action-in-hot-path | under | **stage-dependent** | ✓ | P1 |
| 11 | rooms.full whole-room query | under/stage-dependent | **stage-dependent** | ✓ | P1 |
| 12 | messages.list pagination | under for scale | **stage-dependent** | ✓ | P2 |
| 13 | No browser E2E | under | **under** | ✓ | P1 |
| 14 | qa:matrix:check scope | right (docs gate) | **right** | ✓ | P2 |
| 15 | No data-testids | under | **under** | ✓ | P1 |
| 16 | Responsiveness claim vs reality | over-stated | **stage-dependent** | ✓ | P2 |

### The 4 disagreements (where the easy reflex was wrong)

- **#1 chat-send — I under-called it.** "Keep" hid two real defects: `void sendMsg(...)` fire-and-forget → failed send **silently reverts** (no pending/failed/retry UX); and bubbles keyed `m.id` while the optimistic id is `"opt-"+clientMsgId` ≠ server `_id` → the confirm-swap **remounts** the bubble (Figma anti-flicker break). Fix the key + failure UX now; pagination is correctly deferred.
- **#3 note-editor — I over-called it.** It *is* optimistic, but the note `onBlur` **discards** the `EditFeedback` (unlike cell/post-it paths), so a CAS-revert shows **nothing**, and TipTap never re-syncs a stale doc. Fix = consume feedback + `setContent` on stale. **Don't** add debounce/CRDT (would widen the conflict window).
- **#5 proposal-resolve — refined.** The real defect isn't latency; it's `resolveProposal` returning `void` → an approve that the server **rejects for CAS conflict** drops the (pending-only) card and the host believes a wrong value applied. Fix = thread `{ok,reason}`, keep the card, surface the conflict. Optimistic card-removal would be **dangerous** (hides the conflict).
- **#7 auto-allow — the judge stopped me from shipping a bug.** I said "add optimism." `toggleAutoAllow` is a server-side **flip** (`!autoAllow`); a naive optimistic flip computes off a possibly-stale base and **bounces on echo**. Keep reactive; only add optimism *after* converting to idempotent SET semantics.

---

## 3. Necessary, not minimal, not maximal — the contested calls

| Decision | Minimal (under) | Maximal (over) | **Necessary** |
|---|---|---|---|
| **Proposal approve** | rely on card silently vanishing (hides conflict forever) | optimistically remove card before server confirm (turns a 300ms dim into a permanent false "applied") | keep card mounted (pending state already exists), thread `{ok,reason}`, branch on conflict, aggregate `acceptAll`. Zero `withOptimisticUpdate` added. |
| **rooms.full** | keep the God-object (amplified by agent write-bursts) | per-visible-cell windowing | historical decision: split **only** the high-churn `elements` table into per-artifact subscriptions and keep the low-cardinality room tables as `rooms.meta`. Superseded by shipped split + separate `presenceClaims`; member `lastSeenAt` still has no heartbeat, but spreadsheet presence does. |

> 2026-06-20 supersession: the `rooms.meta` + per-artifact `artifacts.elements`
> split is shipped, and spreadsheet presence now uses separate `presenceClaims`.
> The `lastSeenAt` statement remains true only for member rows; it should not be
> read as "there is no presence heartbeat anywhere."
| **No E2E** | zero E2E (differentiator unproven) | drive leak/job/proposal authZ through Playwright (duplicates backend coverage at ~100× flake) | ~2 two-context Playwright specs for the **irreducibly real-DOM** path (optimistic confirm-swap no-flicker + concurrent-CAS-loser revert), **plus** expand the cheap `convex-test` authZ matrix for everything server-authoritative. |

---

## 4. Reliability posture — solid (do not invent bugs)

Verified strong and partly unit-covered: **CAS** anti-clobber (`artifacts.ts:211`), **idempotency** (`messages.ts:21` clientMsgId, `agent.ts:130/160` claim-or-reuse, `agentJobs.ts:216` `/free` keys), **lock gate** (`artifacts.ts:204`), **channel authZ** (`requireActorCanUseChannel`, server-enforced public/private isolation), **host gating** (`rooms.ts:104`), **lease + SHA-256 hash-chain**. The reliability gap is **verification surface** (real-DOM proof) and **honest-status plumbing** (surfacing these server rejections instead of discarding them) — not logic.

---

## 5. Sequenced remediation (from QA_FINDINGS §4)

- **Wave 1 — cheap honest-status / optimism wins + testids (this session, mostly S):** chat key-by-`clientMsgId` + failed-state; note feedback + re-sync; proposal `{ok,reason}` thread + conflict surface; message-edit optimism + honest return; `addResearchRows` catch + double-insert guard; job cancel/retry pending+disable+failure; seed `data-testid`/`data-state`; labeling fixes (docs-sync wording, mechanism-bound responsiveness claim).
- **Wave 2 — E2E harness + `/ask` affordance (M–L):** Playwright + local-Convex (2 specs) + `convex-test` authZ matrix; post-it drag bbox smoke; converge `/ask` onto the `/free` job model (instant queued + incremental step trace); defensive `.take()` cap on `messages.list`.
- **Wave 3 — `rooms.full` granular split (when a trigger fires):** carve `elements` into per-artifact subscriptions; full message pagination + virtualization; auto-allow SET+optimistic; measure the responsiveness claim. **Triggers:** ~2–3 concurrent editors, or agent run active during human edits, or >~1–2k elements/room, or a channel routinely >~500 messages, or edit-to-paint p95 >~50ms, or move to long-lived persistent rooms.

---

## 6. Completion traceability

**Re your request** — *"deep read to understand where we're at; see if we have end-to-end QA dogfood, if not design it, if yes run it and find addressable problems; ensure highly optimistic UI responsiveness across all features, confirmed against Convex latest SDK docs; research production patterns → judge each decision (over/under/right) → conclude":*

- **Deep read** — 5 parallel read-only agents mapped backend, UI/state, agent runtime, QA infra, HALO docs.
- **QA dogfood** — assessed (partial: strong backend/eval, no browser E2E); **ran** the existing suite (147 green); **designed** the missing harness.
- **Optimistic UI** — audited per-feature; verified the core surface is already optimistic; identified the real (silent-failure + scale) gaps; planned the fixes.
- **Convex SDK grounding** — confirmed against **convex 1.40.0 source** (`withOptimisticUpdate`, `OptimisticLocalStore`, paginated helpers) + official docs.
- **Judged** — 16 decisions adversarially judged over/under/right; 4 proposer verdicts overturned; necessary-not-minimal-not-maximal calls recorded.
