# Work Artifacts Baseline Receipt

Date: 2026-07-09

Scope: baseline before implementing `docs/synthesis/WORK_ARTIFACTS_IMPLEMENTATION_AND_DOGFOOD_PLAN.md`.

## Repository State

- Branch: `main`
- Upstream: `origin/main`
- Working tree: dirty before this implementation slice.
- Notable pre-existing dirty areas:
  - `.proofloop/lanes/**`
  - `docs/eval/**`
  - `scripts/proofloop-*`
  - `src/eval/proofloop*`
  - `src/ui/App.tsx`
  - `src/ui/RoomShell.tsx`
  - `src/ui/panels/Artifact.tsx`
  - mobile and e2e files

This receipt does not claim those changes. New implementation work should stay isolated unless a touched file is required for the artifact layer.

## Baseline Commands

| Command | Status | Notes |
| --- | --- | --- |
| `npm run typecheck -- --pretty false` | pass | TypeScript baseline clean. |
| `npm run nodeagent:frame:smoke` | pass | Frame smoke completed with `rf_adopt_minimal_write_note`. |
| `npm run omnigent:nodeagent:smoke` | pass | YAML compatibility checks pass; outer Omnigent CLI is not installed locally. |
| `npm run proofloop -- doctor --json` | pass | 11 pass, 0 warn, 0 fail. |
| `npm run proofloop -- manifest --dense` | pass | Manifest reports `official-scores:needs_scaffold_or_run`. |
| `npm run proofloop -- ui contract --dense` | pass | Stable UI selector contract printed. |
| `npm test -- --run` | fail | 291 test files passed, 4 failed; 1980 tests passed, 4 failed. |

## Baseline Test Failures

These failures existed before new work-artifact implementation code was added in this slice:

- `tests/multiUserCoordinationProof.test.ts`
  - Assertion: `proof.summary.passed` expected `true`, received `false`.
- `tests/proofloopChartPack.test.ts`
  - Assertion: model-performance data expected to include `deepseek/deepseek-v4-pro`; received current free-route model set plus policy rows.
- `tests/proofloopCi.test.ts`
  - Assertion: repo should not contain `.github/workflows/proofloop-gate.yml`; current repo does contain it.
- `tests/workflowEvals.test.ts`
  - Assertion: `runAgent` stop reason expected `done`, received `step_budget`.

## High-Risk Areas

Avoid broad edits here unless a specific feature slice requires them:

- `convex/**`: backend schema, auth, mutation, query, and workflow behavior.
- `src/nodeagent/core/**`: canonical NodeAgent runtime/frame behavior.
- `src/nodeagent/traces/**`: trace workpaper contract and replay receipts.
- `src/engine/**`: room engine state and artifact mutation semantics.
- `.proofloop/**`: generated proofloop state and locked certification outputs.
- existing dirty files from the current worktree unless the diff is reviewed first.

## Initial Implementation Guardrails

- Add adapters/wrappers first.
- Preserve existing props, callbacks, mutations, and state transitions.
- Keep new artifact code read-only until explicitly wired to existing proposal/review actions.
- Add deterministic unit tests for artifact mapping before UI integration.
- Treat full `npm test -- --run` failures as baseline until a new slice touches the failing area.

