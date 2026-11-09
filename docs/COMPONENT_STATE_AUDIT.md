# Component State Audit — a repeatable check → verify → fix → test flow for every component state

## What kind of workflow this is

The room_full infinite-flash diagnosis was an instance of a **find → adversarially-verify → sweep → validate-fix** review pipeline. In the Workflow taxonomy it is the *Review* shape (`dimensions → find → adversarially verify`) composed from three named quality patterns:

1. **Perspective-diverse verify** — N verifiers, each a *distinct failure lens* (React-effect/deps, Convex-query subscription, state-machine guard), each prompted to **refute** the hypothesis. Diversity catches failure modes redundancy can't.
2. **Completeness critic / sibling sweep** — after confirming one defect, find every other site that shares the same structural cause (the four throw-sites in one effect).
3. **Fix validation** — score the proposed fix on every axis (happy path, legit retry, sibling coverage) and compare against the weaker alternatives before committing.

Generalising that single-bug harness to **every component state** turns it into a **state-chart invariant sweep** (a.k.a. model-based / FSM-coverage audit): extract each component's finite-state machine, enumerate `state × transition × external-event`, check each cell against an invariant catalog, adversarially verify violations, fix the root cause, and lock it with a scenario-based regression test.

> The room_full bug was invisible to CI because this repo has **~85 logic/contract tests but zero component-render tests** (`tests/**/*.test.tsx` = ∅, no `@testing-library/react`/jsdom). The effect-loop class can only be caught by *rendering a component and observing effect re-fires*. Closing that layer is the point of this flow.

---

## The five stages

```
0. ENUMERATE   extract the FSM per component (states, transitions, effects, async commits, collections)
1. CHECK       apply the invariant catalog to every state × transition → candidate findings
2. VERIFY      refute panel per finding (2–3 distinct lenses) → confirmed | rejected, with confidence
3. FIX         smallest root-cause fix per confirmed finding (+ compare alternatives)
4. TEST        scenario-based regression test per confirmed finding, then run typecheck + test + live-DOM
```

Stages 0–2 are automated by the `component-state-audit` workflow (read-only; produces a report). Stages 3–4 are applied **per component after review** — never as an unsupervised mass edit.

---

## The invariant catalog (the "check")

Grounded against real code in this repo. Each invariant cites the reference idiom (good) and the anti-pattern (bad) already present.

### A. React render-safety (the infinite-loop class)
| ID | Invariant | Reference |
|----|-----------|-----------|
| **A1 FAILURE_LATCH** | Every effect that writes state which (directly or via a toggled flag like `busy`) re-enters its own run guard must have a terminal latch so a *failure* path cannot re-satisfy the guard. | BAD: `App.tsx` join effect (fixed). GOOD: `RoomShell.tsx:52` `tourAutoStarted` ref. |
| **A2 EFFECT_TERMINATION** | Every effect with a state-write reaches a fixpoint; no `setState` in render without a guard; `setInterval`/`setTimeout` cleared on unmount. | GOOD: `Chat.tsx:306` cleanup clears `privTimerRef`. |
| **A3 DEPS_COMPLETE** | Effect deps are exhaustive (no stale closures) OR intentionally narrowed *with a documented latch*. | — |
| **A4 UNMOUNT_SAFE** | No `setState` after unmount in async resolves — guarded by an alive-ref or AbortController. | GOOD: `Chat.tsx:304` `aliveRef` gates every `setThinking` in `.finally`. |

### B. State-machine completeness
| ID | Invariant | Reference |
|----|-----------|-----------|
| **B1 REACHABLE** | Every declared state value is reachable and exitable (no dead-end state). | — |
| **B2 TRANSITION_TOTAL** | Every `state × external event` is handled — including failure, empty, and *concurrent* arrivals. | — |
| **B3 NO_ORPHAN_ASYNC** | Multi-step async that commits external state must be idempotent/transactional — no partial-commit dead-end. | BAD: `App.tsx:142-153` create-room-then-seed (phantom room — task `f07ebfe6`). |
| **B4 BUSY_FINALLY** | Every loading/busy flag set `true` is cleared in a `finally` on *all* paths. | GOOD: `RoomShell.tsx:141-142` `collab` try/finally; `Chat.tsx:414` `jobBusy`. |

### C. Agentic-reliability checklist, UI-projected (Homen's 8-point)
| ID | Invariant | Reference |
|----|-----------|-----------|
| **C1 BOUND** | Every in-memory collection in component state has a MAX + eviction. | WATCH: `Chat.tsx:290` `failedSends` appends on each failed send — bounded only by user dismiss. GOOD: `Chat.tsx:326` `multiAgentTick` clamped to `MULTI_AGENT_DEMO_MAX_TICK`. |
| **C2 HONEST_STATUS** | UI never renders success state on a failure path (no fake "joined"/"sent"). | GOOD: `Chat.tsx` tracks `failedSends` instead of pretending the send worked. |
| **C4 TIMEOUT** | Long async has an abort/budget; spinners cannot hang forever. | — |
| **C7 ERROR_BOUNDARY** | Every async path has a `.catch`; rejections surface as honest error state, not silent. | — |
| **C8 DETERMINISTIC** | Derived keys/ids stable across renders (no `Math.random`/`Date.now` in render keys). | — |

(C5 SSRF / C6 BOUND_READ are backend invariants — flag only if a component fetches directly.)

---

## The "verify" layer (closing the test gap)

There are two verification depths; the flow uses the deepest one available:

1. **Component-render test** (preferred for the A/B classes) — **requires adding `@testing-library/react` + `jsdom`** to devDeps and a `*.test.tsx` env. This is the layer that would have caught room_full: render the component, drive it into the failing state, assert the mutation/effect fires a *bounded* number of times.
2. **Playwright E2E** (already wired: `test:e2e`, `scripts/live-product-gate.ts`) — drives the real DOM; the live-DOM fallback when render-test infra is absent, and the home of the "never claim shipped without a DOM signal" rule.

Every confirmed defect ships with a **scenario-based** test (per the global rule): a real persona + goal, covering happy / sad / adversarial / concurrent / degraded, and *both* burst and sustained variants. Example for A1: *"Guest joins a full room → assert `joinAnonymous` is called exactly once and the UI settles on the error state (no flash, no re-fire)."*

---

## Component inventory & rollout (don't boil the ocean)

11 stateful components, ranked by state surface (hook-site count):

| Tier | Component | Hook sites | Why |
|------|-----------|-----------:|-----|
| **1 — core, interactive** | `ui/panels/Artifact.tsx` | 41 | The collab editor — highest state surface, untested at render layer. |
| | `ui/Chat.tsx` | 24 | Streaming + async sends + `failedSends` (C1 watch) + `thinking` stuck-state risk. |
| | `ui/RoomShell.tsx` | 12 | Room container; mostly good idioms — confirm latches/finally hold. |
| **2 — medium** | `ui/App.tsx` | 9 | ✅ A1 fixed; B3 phantom-room open (task `f07ebfe6`). |
| | `ui/GuidedTour.tsx` | 6 | Tour FSM + storage. |
| | `ui/Landing.tsx` | 4 | Form entry. |
| **3 — low / presentational** | `LeftRail`, `StoryStage`, `app/store.tsx`, `LandingStory`, `LayerCard` | 2–3 | Mostly derived; quick pass. |

**Sequence:** prove the harness on Tier 1 → add render-test infra → Tier 2 → Tier 3. Fixes are applied and tested per component, reviewed, then committed.

---

## How to run

```
# Audit one or more components (read-only; emits a per-component findings report):
Workflow name="component-state-audit" args={ components: ["src/ui/Chat.tsx", "src/ui/RoomShell.tsx"] }
```

The workflow lives at `.claude/workflows/component-state-audit.js`. It pipelines each component through Enumerate → Check → Verify+Propose and returns confirmed findings with a fix sketch and a scenario-test sketch per finding. Apply fixes in a reviewed second pass.
