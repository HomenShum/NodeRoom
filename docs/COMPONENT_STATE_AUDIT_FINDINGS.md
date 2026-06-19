# Component State Audit - first-run findings (8 components)

> Historical packet. Last cleaned: 2026-06-18. This file preserves the original
> first-run audit language, but several rows below are now resolved or partially
> guarded. Do not read every "Confirmed defects" row as still open.

Run: `component-state-audit` workflow, 54 agents. Audited 8 stateful components, raised **38 candidate findings, confirmed 21** after adversarial refute panels (17 rejected — the verify layer killed ~45%). **0 P0** (no infinite-loop/crash class beyond the App.tsx join loop already fixed) · **11 P1** · **9 P2**.

> Test-layer status: `@testing-library/react`, `jsdom`, and Vitest jsdom routing
> now exist in this repo. `tests/leftRailUpload.test.tsx` is the first RTL-style
> component guard. Remaining component findings should get focused regression
> tests when they are fixed.

## Current Status After Fixes

Resolved or guarded since the first-run audit:

- App atomic room creation now uses `rooms.createStarterRoom`; guarded by
  `tests/createRoomAtomicity.test.ts`.
- Chat bounded/error behavior has focused coverage in `tests/chatBounds.test.ts`.
- LeftRail upload behavior has RTL coverage in `tests/leftRailUpload.test.tsx`.
- The component-render test prerequisite is no longer blocked by missing
  dependencies.

Still use the ranked table below as backlog context for any row not explicitly
marked fixed.

## Confirmed defects (ranked)

| Sev | ID | Inv | Component | One-line |
|-----|----|-----|-----------|----------|
| P1 | F4 | C1 | Chat.tsx | `privateStreamDrivers` module-level Map is unbounded + survives unmount/room-nav → memory leak under sustained use |
| P1 | F5 | C1 | Chat.tsx | `failedSends` array unbounded — grows on every failed send until user dismisses |
| P1 | F1 | C7 | Chat.tsx | 3 agent dispatches (`/ask`,`/free`,private) have `.finally` but **no `.catch`** → agent error is swallowed, `thinking` clears as if success |
| P1 | F2 | C2 | Chat.tsx | same 3 dispatches render no error → dishonest "done" on failure |
| P1 | F1 | B3 | Artifact.tsx | `refreshComplete()` discards `commit()` `{ok:false}` (locked/conflict) → silent partial requeue, fake status |
| P1 | F2 | C7 | Artifact.tsx | sticky-note `onBlur` commit is a bare expression — `{ok:false}` dropped, DOM shows unsaved text as saved |
| P1 | RS-01 | C7 | RoomShell.tsx | `collab` state has no error field; `runCollab`/`drill` have `try/finally` but **no `.catch`** → failure looks like success |
| P1 | RS-02 | C2 | RoomShell.tsx | both runners write `done:true` in `finally` even on rejection |
| P1 | GT-1 | B2 | GuidedTour.tsx | guard checks `length===0` but not `i >= length` → `steps[i].placement` TypeError (render crash) when steps shrink |
| P1 | LR-1 | B3 | LeftRail.tsx | multi-file `onUpload` commits each artifact unconditionally, no rollback → partial binder on mid-batch failure |
| P1 | LR-3 | C4 | LeftRail.tsx | `onUpload` has no abort/timeout — `uploading` spinner can hang forever on a stuck file read/mutation |
| P2 | F7 | C7 | Chat.tsx | clipboard `copy()` swallows rejection |
| P2 | F9 | A2 | Chat.tsx | multi-agent demo interval — termination/reduced-motion edge |
| P2 | RS-03 | B3 | RoomShell.tsx | conflict-drill gated only by local `collab.running` — concurrent host clicks not serialized |
| P2 | RS-04 | A4 | RoomShell.tsx | both runners `setCollab` after `await` with no unmount guard |
| P2 | RS-05 | A2 | RoomShell.tsx | room-code `setTimeout(setCodeCopied false)` not cleared on unmount |
| P2 | F1 | B3 | App.tsx | create = 5 independent Convex txns, no rollback → phantom room (**fix already in repo: `rooms.createStarterRoom`**) |
| P2 | F2 | C4 | App.tsx | join/create effect has no AbortController/timeout/budget gate |
| P2 | F3 | C2 | Landing.tsx | error-surface wiring gap in live mode |
| P2 | LR-2 | A4 | LeftRail.tsx | `onUpload` sets `uploading` after await, no alive-ref |
| P2 | CE-1 | A3 | CellEditor.tsx | `draft` resync effect — prop/local-state sync edge |

## Top-priority fixes (with exact patches the audit produced)

### Chat F4 — bound `privateStreamDrivers` (C1, your BOUND non-negotiable)
Module-level `Map` survives unmount + navigation; each private agent reply mints a fresh `streamId` added to the map, never evicted. Add `const MAX_DRIVERS = 64;` and an LRU evict at the single insertion chokepoint `driverFor` ([Chat.tsx:38](../src/ui/Chat.tsx#L38)) — evict the oldest entry whose `status` is terminal (`done`/`error`/`timeout`) with no listeners. **Test:** 200 private asks over a session → assert map size stays ≤ 64.

### Chat F1 / RoomShell RS-01 — `.catch` the agent dispatches (C7 + C2)
Both surfaces have `.finally(clear-busy)` but no `.catch`, so a rejected Convex action silently clears `thinking`/`done:true` as if it succeeded. Add an `agentErr`/`error` state, `.catch` that sets it, keep the `aliveRef`/finally. **Test:** mock store to reject → assert an error banner renders and busy clears (no fake "done").

### Artifact F1 — honest status in `refreshComplete` (B3 + C7)
`commit()` returns `{ok:false,reason:'locked'|'conflict'}` as **data** (engine never throws), so the `await` succeeds and the failed rows silently stay `complete`. Every other commit caller in the file routes feedback to an error surface; `refreshComplete` is the lone exception. Count failures, surface via a `editErr` banner reusing `editErrorMsg`. **Test:** agent holds a lock on 1 of 3 complete rows → assert banner names the failed count and "Enrich N pending" reflects the true count.

### App F1 — atomic create (B3) — *fix already in repo*
Swap the create branch ([App.tsx](../src/ui/App.tsx) `createRoom` + 4×`createArtifact`) for `useMutation(api.rooms.createStarterRoom)` ([rooms.ts:184](../convex/rooms.ts#L184)), which inserts room + 4 artifacts in **one** transaction (rolls back atomically). Eliminates the phantom-room dead-end. (Corroborates spawned task `f07ebfe6`.)

### GuidedTour GT-1 — clamp the step index (B2)
Guard gates `length===0` but not `i >= length`; when the steps array shrinks (mobile-gated) without closing, `steps[i]` is `undefined` → render crash. Clamp: `const safeI = Math.min(i, steps.length - 1)` at [GuidedTour.tsx:115](../src/ui/GuidedTour.tsx#L115).

### LeftRail LR-1 — transactional upload (B3)
Buffer committed ids, roll back on throw (keep the multi-file loop). Prevents a half-uploaded binder on mid-batch failure.

## Recommended sequence
1. **C1 bounds first** (Chat F4, F5) — your hard non-negotiable; unbounded Maps OOM under agent loops.
2. **C7/C2 honesty cluster** (Chat F1/F2, RoomShell RS-01/RS-02, Artifact F1, F2) — fake-success in reasoning surfaces.
3. **B3 idempotency** (App F1 → use `createStarterRoom`; LeftRail LR-1) — partial-commit dead-ends.
4. **B2 crash** (GuidedTour GT-1) — single-line clamp.
5. **C4/A4/A2/A3 P2s** — when touched.

Full per-finding mechanism + refutation + test + verify-step: raw run at the task output JSON (`tasks/w9wbp2he3.output`).
