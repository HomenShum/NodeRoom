# Testing

## Run it

```bash
npm test              # Vitest, all suites — ~8-9 minutes
npm test -- --run tests/roomEngine.test.ts     # one file
npm run floor         # typecheck (app + convex) then the suite — the per-change gate
npm run build         # tsc --noEmit + vite build + build-provenance check
npm run test:e2e      # Playwright, needs a dev server
```

**No secrets are required.** Every Vitest suite runs against the in-memory engine
or against `convex-test`, which runs the real Convex functions in-process. There
is no live deployment and no model key in the test path.

## What the numbers are right now

Measured on this branch, Windows 11, Node 22, `npm test`:

```
Test Files  2 failed | 385 passed (387)
     Tests  2 failed | 2714 passed (2716)
```

**The suite is red, and both failures are pre-existing and intentional-ish.**
Read `docs/codebase/CONCERNS.md` before you assume you broke something:

1. `tests/proofStaleness.test.ts` — a deliberate decay gate. It fails because a
   marketed proof artifact on disk is older than its 30-day window. It is the
   gate doing its job, not a broken test. Fix it by re-running the proof batch or
   pulling the claim — **never** by widening the window.
2. `tests/githubActionsRuntimePins.test.ts` — a CI workflow pin assertion.

Two further suites (`tests/proofloopOrchestrator.test.ts`,
`tests/nodebookWorkspaceProjection.test.tsx`) fail *intermittently* on a 5s / 60s
timeout when the machine is loaded. They passed on the run above and failed on
the run before it, on identical code. Treat a timeout in those two as a flake
until you see it twice on an idle machine.

## The four kinds of test here

| Kind | Environment | Example | What it is for |
|---|---|---|---|
| Domain | node | `tests/roomEngine.test.ts` | `RoomEngine` rules directly — conflict, lock, duplicate `opId` |
| Backend-real | `edge-runtime` + `convex-test` | `tests/noClobberWedge.test.ts` | The **real** Convex schema and functions, in-process, no deployment |
| Component | `jsdom` | `tests/chatReasoningFrames.test.tsx` | React surfaces via Testing Library |
| Browser | Playwright | `e2e/human-agent-concurrency.spec.ts` | The rendered app, real timing, real layout |

Environment is chosen per file with a pragma when it is not the default:

```ts
// @vitest-environment edge-runtime
```

## The test to read first

`tests/noClobberWedge.test.ts`. It is the product's headline claim as one
sequenced artifact, and its header comment explains the four beats before any
code:

1. a human edits the contested cell
2. the agent works the same block; its safe cell commits, its write to the
   contested cell carries a stale `baseVersion` and CAS rejects it
3. in review mode the rejected edit becomes a host-approvable proposal; the human
   moves the cell forward again; approval re-runs CAS and the stale proposal
   stays pending
4. the rejected clobber left **no** `edit_applied` trace entry

If you change anything on the write path and this stays green, you probably did
not break the promise. If it goes red, stop.

## How to write one here

- **Name the defect in a header comment.** `tests/demoRoomChatOrder.test.ts` is
  the model: it explains the user-visible symptom (the reply lands off-screen),
  the root cause (a fixed wall-clock timestamp), and why the clock is pinned in
  the test (so it fails at any hour, not only before breakfast).
- **Use the real thing.** For backend behaviour use `convex-test` with
  `../convex/schema` and `api` / `internal`, not a hand-written fake.
- **Pin time and randomness explicitly.** Several defects here were "works after
  lunch" bugs.
- **One file per subject**, named `tests/<subject>.test.ts`.

## Things that will bite you

- **`npm test` is slow** (~8-9 min, 387 files). Use `npm test -- --run <file>`
  while iterating; run the whole suite before you push.
- **`convex-test` suites delete some modules from the glob** before mounting, so
  Node-only actions do not get pulled into the edge runtime:
  ```ts
  const modules = import.meta.glob("../convex/**/*.ts");
  for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", /* ... */]) delete modules[m];
  ```
  Copy that block when you add a `convex-test` suite, or you will get an opaque
  import error.
- **Source-map warnings are noise.** The vendored `nodegraph-live` tarball ships
  `.js` without `.js.map`, so the run prints many "Failed to load source map"
  errors. They are not failures.
- **Playwright is not run by `npm test`.** Seven separate configs exist
  (`playwright*.config.ts`) for different suites; each needs a server.

## Validating the CodeTours

`.tours/*.tour` point at real files and line numbers, and a tour with a broken
reference is worse than no tour. This one-liner fails if any step no longer
resolves — run it after you move code:

```bash
node -e "const fs=require('fs');let bad=0;for(const f of fs.readdirSync('.tours')){const t=JSON.parse(fs.readFileSync('.tours/'+f,'utf8'));for(const s of t.steps){if(!fs.existsSync(s.file)){console.log('MISSING',s.file);bad++;continue;}const n=fs.readFileSync(s.file,'utf8').split(String.fromCharCode(10)).length;if(!s.line||s.line<1||s.line>n){console.log('BAD LINE',s.file,s.line);bad++;}}}console.log(bad?'FAIL '+bad:'OK');process.exit(bad?1:0)"
```

## What is *not* covered

- There is no coverage threshold configured, and no coverage report in CI.
- The live tier (real Convex deployment, real model) is exercised only by scripts
  under `scripts/` that need credentials; nothing in `npm test` proves it.
- Accessibility is checked by `@axe-core/playwright` in the e2e layer, not by the
  unit suite. The current axe findings are in `promotion/PROMOTION_LOG.md` and
  summarised in `CONCERNS.md`.
