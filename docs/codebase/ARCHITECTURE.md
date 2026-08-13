# Architecture

## The problem this shape solves

Two people and an AI assistant edit the same spreadsheet at the same time. The
assistant must be able to change cells without ever silently overwriting the row
a colleague just fixed, and afterwards anyone must be able to point at a number
and see who put it there.

Everything structural in this repository follows from that sentence.

## Three layers, one direction

```
  browser surfaces          src/ui/**          ← rendering only
        │  useStore()
        ▼
  the store seam            src/app/store.tsx  ← one interface, two providers
        │
        ├──── in-memory ───► src/engine/roomEngine.ts   (no keys, no network)
        └──── live ────────► convex/**                  (database + durable jobs)

  the agent                 src/nodeagent/core/runtime.ts
        │  RoomTools port (src/nodeagent/core/types.ts)
        ├──── in-memory ───► src/nodeagent/skills/integration/noderoomAdapter.ts
        └──── live ────────► convex/convexRoomTools.ts
```

The arrows only point down. A UI component never imports `RoomEngine` or
`convex/_generated/api`; the agent loop never imports React or a database client.

## The two tiers, and why both exist

`src/app/main.tsx` picks a tier once, from `VITE_CONVEX_URL`:

| | **Memory tier** (no env) | **Live tier** (Convex URL + model key) |
|---|---|---|
| Room state | `RoomEngine`, in the tab | Convex tables (`artifacts`, `elements`, `proposals`, `locks`, `traces`) |
| Agent runs | in the tab, synchronously | as a durable Convex workflow job |
| Model | `scripted.ts` — deterministic, no key | a real provider through the AI SDK |
| Reply delivery | React re-render | `@convex-dev/persistent-text-streaming` |
| Reachable by | anyone who clones the repo | anyone with a deployment |

This is not a mock. Both tiers satisfy the same `RoomStore` interface and the
same `RoomTools` port, and both run the same agent loop and the same tool
definitions. The memory tier is what makes it possible to demo, test and debug
the product with no secrets — and it is the tier every test in `tests/` that does
not use `convex-test` runs against.

The cost of that choice is honest and worth knowing: **two implementations must
be kept in step.** When you add a tool, you implement it twice (see
`docs/START_HERE.md`, "Where you would add one adjacent capability").

## The invariant: no write silently clobbers another

`RoomEngine.applyEdit` (`src/engine/roomEngine.ts:403`) is the whole product in
one function. Three gates, in order, and **every rejection is returned as data,
never thrown**, because the agent has to read the rejection and retry:

1. **Duplicate op** — a repeated `opId` returns the earlier result. A network
   retry is therefore safe.
2. **Lock** — a locked element is read-only for everyone but the holder. A denied
   lock is a `lock_denied` trace entry, not an exception.
3. **Review mode** — when a room has auto-allow off, an agent edit becomes a
   pending proposal for a human, not a write.
4. **Compare-and-swap** — `if (el.version !== op.baseVersion) return { ok: false,
   reason: "conflict", expected, actual }`. The writer sent the version it last
   read; if the element has moved on, the write loses and the writer is told the
   current version.
5. **Formula protection** — an agent may not replace a formula with a scalar.

A rejected write leaves **no `edit_applied` trace entry**. That is what makes the
room trace a record of what happened rather than what was attempted.

The Convex side enforces the same rules against the `elements` table
(`convex/convexRoomTools.ts`, `convex/rooms.ts`). `tests/noClobberWedge.test.ts`
runs the whole sequence against the real Convex functions.

## The agent: a loop that owns no state

`runAgent` (`src/nodeagent/core/runtime.ts:496`) takes a goal, a model, a tool
list and a set of budgets, and returns a result plus a stream of trace events. It
reaches the world only through `RoomTools`.

Budgets are first-class parameters, not ambient config:

- `maxSteps` — tool-call ceiling
- `deadlineAt` + `reserveMs` — wall-clock stop, leaving time to persist the trace
  before a Convex action's 10-minute cap
- `spendLimits` + `priceStep` — token *and* dollar ceiling; `priceStep` is
  required for the dollar half to work at all
- `journal` — on a retried slice, replay a completed step instead of re-calling
  (and re-paying for) the model
- `compaction` — bound the context on long runs

A run that hits a budget stops with a **resumable handoff**, not a failure.

Tools are data (`ROOM_TOOLS` in
`src/nodeagent/skills/spreadsheet/cellMutator.ts:1738`): name, description, Zod
schema, `execute`. The descriptions are written for the model to read — they
state the concurrency protocol ("`baseVersion` MUST be the version you last
read"; "Never ignore a conflict") because that protocol is the thing a model most
easily gets wrong.

## Durable jobs on the live tier

A public agent request on the live tier is not an HTTP call that must survive.
`startPublicAsk` (`convex/agentJobs.ts:2782`) writes a job row and returns a
`jobId` immediately; `convex/agentJobRunner.ts` executes it as a
`@convex-dev/workflow` slice, checkpointing after each step. A slice that runs
out of budget hands off; the next slice resumes from the journal.

Two workflow components are mounted (`convex/convex.config.ts`) so that passive
background jobs run in a workpool with `maxParallelism = 1` and cannot starve
foreground work.

## What is *not* on this path

`src/eval/` (94 files) and `src/benchmarks/` are benchmark harnesses —
SpreadsheetBench, BankerToolBench, ProofLoop. They reuse the same agent runtime
but are reached from npm scripts, never from the room. When you are learning the
product, skip them.
