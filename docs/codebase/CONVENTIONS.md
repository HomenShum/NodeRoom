# Conventions

Rules that are actually enforced here, each with the file that enforces it or the
failure that produced it. Style preferences that nothing checks are not listed.

## Boundaries the code enforces

### 1. UI surfaces go through the store, never around it

A component in `src/ui/` calls `useStore()`. It does not import `RoomEngine`, and
it does not import `convex/_generated/api`. This is the rule that keeps both
tiers (in-memory and Convex) working from one set of surfaces.

Stated at the top of `src/app/store.tsx`:

> The presentational components (Chat, Artifact, LeftRail, RoomShell) call
> `useStore()` and never touch the engine or Convex directly.

### 2. Radix behaviour is wrapped in one place

Radix primitives may only be imported inside `src/components/ui/`. Everything
else consumes those wrappers.

**Enforced by** `src/design/uiLayerPolicy.ts` (`auditUiLayerImports`), tested in
`tests/uiLayerPolicy.test.ts`. The same file restricts motion libraries (GSAP,
Lenis, Vanta/three, `motion`) to `src/motion/` and a small set of reviewed
boundaries. There is exactly one recorded exception, named in the file.

### 3. The agent writes only through `RoomTools`

From `AGENTS.md`: "Keep writes behind `RoomTools`; do not mutate engine/backend
state directly." The loop in `src/nodeagent/core/runtime.ts` has no database
client and no React import. Adding a capability means adding a tool, not reaching
past the port.

### 4. No barrel imports into the client bundle from `nodeagent`

`src/app/store.tsx` imports specific modules, never `src/nodeagent/index.ts`, and
says why on line 19:

```ts
// Specific imports (NOT the nodeagent barrel) so Node-only model adapters never reach the client bundle.
```

This is a real bug class here, not hygiene: the barrel pulls Node-only provider
adapters into a browser build.

## Failure handling

### Rejections are data, not exceptions

`RoomEngine` returns `{ ok: false, reason: "conflict" | "locked" |
"pending_approval" | ... }`. It does not throw on a lost race. The reason: the
agent must be able to *read* the rejection and retry with the current version.
Anything on the write path that throws instead of returning a reason is a defect.

### Every in-memory list has a cap

`failedSends` in `src/ui/Chat.tsx` is capped at `MAX_FAILED_SENDS`. Agent runs
carry `maxSteps`, `deadlineAt`, `spendLimits` and `compaction`. An unbounded
collection on an agent path fills memory in minutes, because agents loop.

### A failed thing must not render as a slow thing

`src/landing/boot.ts` sets `data-boot-state="failed"` and swaps the progress rail
for a message and a Reload button. The comment above it records the defect that
forced this: a rejected chunk import left the shimmer running forever under
"Opening room" — a failure wearing a loading state.

## Idempotency and identity

- Chat messages carry a client-generated `clientMsgId` so a retry updates rather
  than duplicates.
- Edits carry an `opId`; `RoomEngine.applyEdit` returns the earlier result for a
  repeated `opId` instead of applying twice.
- Writes carry `baseVersion`; a stale base is a conflict, never a silent
  overwrite.

## Comments

Comments here explain **why**, and very often name the defect that forced the
code. Follow that: a comment restating the code is noise, a comment naming the
bug is the most useful line in the file. Examples worth imitating:

- `src/landing/boot.ts` — "A hung import never rejects, so a catch alone cannot
  cover this."
- `src/engine/roomEngine.ts` — "Optimistic concurrency: stale base → conflict
  (returned as data, never thrown)."
- `convex/convex.config.ts` — why a second workflow component exists
  (`maxParallelism = 1` so passive jobs cannot starve foreground jobs).

## Tool descriptions are user-facing text

A tool's `description` in `ROOM_TOOLS` is read by a language model at runtime.
Write it as instructions to a capable colleague who cannot see your code: state
the protocol ("`baseVersion` MUST be the version you last read"), state what a
non-obvious result means ("`pendingApproval: true` — that is SUCCESS, do NOT
retry"), and state the failure mode you keep seeing. Treat a change to a
description as a behaviour change, because it is.

## Tests

- One file per subject: `tests/<subject>.test.ts`. There is no mirrored directory
  tree.
- A test that needs the real backend uses `convex-test` with the real schema and
  real functions (see `tests/noClobberWedge.test.ts`), not a hand-written stub.
- Environment is chosen per file with a pragma when it is not the default —
  `// @vitest-environment edge-runtime`, or `jsdom` for component tests.
- Tests state the defect they guard in a header comment
  (`tests/demoRoomChatOrder.test.ts` is the model).

## Documentation

`docs/` is append-only by convention: superseded findings stay, with the
measurement that killed them, because the list of things that turned out to be
wrong is more useful to the next reader than the current values alone. Do not
quietly edit a number — add the new measurement and say what it replaced.

## Commands you are expected to run

| Command | When |
|---|---|
| `npm run floor` | fast per-change gate — typecheck (app + convex) then tests |
| `npm test` | the full Vitest suite |
| `npm run build` | typecheck + Vite build + build-provenance verification |
| `npm run prod:gate` | full pre-ship gate (audit, security, design, QA matrix) |
