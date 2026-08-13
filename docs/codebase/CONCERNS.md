# Concerns — what is known to be wrong, right now

Every item here was reproduced or measured on this branch. A hunch is not a
concern. Ordered by what would bite a new engineer first.

## Product defects with reproductions

These come from `promotion/PROMOTION_LOG.md`, which is the live defect ledger.
Read that file for full reproductions; this is the index.

| # | Severity | Symptom |
|---|---|---|
| D-2 | Major | The **"Undo last applied room edit (Ctrl+Z)"** button never enables — measured `disabled` on arrival, after four agent-committed cells, and after a human edit. The one control a stranger reaches for to reverse an agent is dead. |
| D-3 | Major | Hand-editing a Variance cell **clears it**. Type text into `cell-editor`, press Enter, and `+24%` becomes `""`. Silent data loss on the surface whose promise is that edits are never silently lost. |
| D-4 | Major | The review queue reads "no pending proposals" in the keyless sample room and no control produces one, so the product's central trust claim is invisible to anyone without a Convex deployment. |
| D-5 | Major (a11y) | axe-core critical `aria-allowed-attr`: the chat `textarea` carries `aria-expanded`, which that element does not allow. Plus five serious contrast failures, worst `.r-walkdock-pace` at **1.55:1** against 4.5:1 required. |
| D-6 | Minor (a11y) | 25 consecutive Tab presses from a fresh load never leave the left binder rail, and `SKIP_LINKS` is empty. One focused input has no visible focus ring. |
| D-7 | Minor (docs) | `DEMO.md` instructs a presenter to click controls that no longer exist ("Enter the Q3 diligence room", "Run collaboration"). |

**None of these were touched by this pass.** This wave was structural reduction
and documentation; mixing defect fixes into it would have made both harder to
review.

## The test suite is red

`npm test` exits 1. Two failures, both pre-existing at the wave baseline:

- `tests/proofStaleness.test.ts` — a **deliberate decay gate**. A marketed proof
  artifact on disk is 32 days old against a 30-day window. This is the gate
  working. Re-run the proof batch or pull the claim; widening the window would be
  falsifying evidence.
- `tests/githubActionsRuntimePins.test.ts` — a CI workflow pin assertion.

Plus two suites that time out intermittently under load
(`tests/proofloopOrchestrator.test.ts` at 5s, `tests/nodebookWorkspaceProjection.test.tsx`
at 60s). They failed at baseline and passed on the verification run, on code that
did not differ in those paths. Assume flake until you see it twice idle.

Because the suite is red, **this repository does not pass the HUMAN-READY gate**
("build, typecheck, tests and browser checks pass"). Build and typecheck are
green; tests are not.

## One real import cycle

`npx dependency-cruiser@16 --validate src/landing/boot.ts convex/*.ts` reports
seven `no-circular` violations. Six of them are **type-only in at least one
direction** — the importing side uses `import type`, which is erased at compile
time, so there is no runtime cycle. They are listed by the tool because the
project's config sets `tsPreCompilationDeps: true`.

The seventh is real, and both directions are value imports:

```
src/nodeagent/core/runtime.ts        imports { executePlanAndDispatch } from ./subagentDispatcher
src/nodeagent/core/subagentDispatcher.ts  imports { runAgent } from ./runtime
```

This is deliberate mutual recursion — a parent agent dispatches subagents that
run the same loop — not an accident. It is left in place because breaking it
means injecting `runAgent` into `executePlanAndDispatch` as a parameter, which is
a change to the most important untested-at-that-seam path in the repo, and this
wave's rules forbid refactoring such a path without first adding a
characterization test. **The fix shape is recorded here so the next person does
not have to rediscover it.**

The type-only six, for completeness:

| Cycle | Type-only edge |
|---|---|
| `spreadsheetParser` ↔ `uploadedArtifact` | `import type { UploadedArtifactInput }` |
| `store.tsx` ↔ `panels/traceData` | both directions are `import type` |
| `LandingStory` ↔ `ui/App` | `import type { Session }` |
| `journal` → `types` → `evidenceReceipt` | `import type { TrustedCellEvidenceReceipt }` |
| `modelCatalog` ↔ `openRouterFreeModels` | `import type { ModelPricing }` |
| `ui/App` ↔ `ui/Landing` | `import type { Session }` |

## Dependencies knip cannot see, and one that is genuinely undeclared

`npx knip` reports these; each has been checked by hand:

| Finding | Verdict |
|---|---|
| `@homenshum/nodegraph-live` "unused" | **False positive.** Imported by `src/ui/graph/LiveGraphRail.tsx`; knip does not resolve `file:` tarball specifiers. |
| `fstream` "unused" | **False positive, and load-bearing.** It exists only to satisfy the `overrides` block that patches a known `unzipper`/`exceljs` advisory. Removing it re-opens the advisory. |
| `remotion`, `ws` "unused devDependencies" | **False positives.** Both are imported (`remotion/`, several scripts). |
| `playwright-core` imported by `src/nodeagent/capture/substrate/browserbase.ts` | **Real.** Not declared in `package.json`; it resolves today only because `@playwright/test` hoists it. That is an accident waiting to break on a lockfile change. |
| `pdfjs-dist` imported by `src/ui/panels/PdfCitation.tsx` | **Real**, same shape — it comes in transitively through `react-pdf`. |
| `archiver` imported by `tests/exceljsDependencyCompatibility.test.ts` | Test-only, arrives via the `overrides` alias. Lower risk. |
| `powershell`, `python` used as script binaries | Real, and worth knowing: several `benchmark:*` npm scripts shell out to PowerShell or Python and will not run on a plain Node install. |

## Repository ergonomics

- **The README is 2,537 lines / 193 KB.** It is the first file a stranger opens
  and it is not readable in one sitting. `docs/START_HERE.md` now exists as the
  actual front door, but the README has not been reduced — that is feature-level
  editorial work, not structural reduction, and it was out of scope for this
  wave.
- **Thirteen dated session transcripts sit at the repository root**
  (`6-14-2026-deep-review.txt` … `6-18-2026-visual-plan-review-surface.txt`,
  ~600 KB). Four are referenced from `docs/`; nine are not. They are inert, but
  they are the first thing a `ls` shows.
- **266 npm scripts.** Most are benchmark harness entry points. There is no
  grouping or index; `npm run` prints a wall.
- **201 files are unreachable from any entry point** (`npx knip`), down from 228.
  The bulk are in `scripts/` (74) and `docs/` (52) — one-off tooling, not product
  code. `src/` is down to two, both explained: `src/ui/panels/pdfVisualCheck.tsx`
  is the entry for `pdf-visual-check.html`, which `e2e/pdf-citation-box.spec.ts`
  drives, and `src/nodeagent/okf/skillCatalog/build-skill-index.mjs` is a
  documented CLI (`src/nodeagent/okf/skillCatalog/format.md`).

## Build and bundle

- `vite build` still warns that chunks exceed 1,100 kB. The largest single asset
  is `mermaid-*.js` at 1.9 MB; it is dynamically imported, so it is not on the
  first-paint path, but it is in the deployed output.
- Total `dist/` is 39.3 MB after this pass (was 48.8 MB). Most of that is
  syntax-highlighting grammars and worker bundles, not application code.

## Two implementations to keep in step

The in-memory and Convex tiers are genuinely equivalent, which is the repo's best
property — and its standing maintenance cost. Any new tool must be implemented in
both `src/nodeagent/skills/integration/noderoomAdapter.ts` and
`convex/convexRoomTools.ts`. Nothing automatically detects a tool implemented in
only one. A conformance test that asserts both classes satisfy the same
`RoomTools` surface would close that gap; it does not exist yet.
