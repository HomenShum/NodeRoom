# Finance Model Eval

> Launch status (2026-07-12): the committed June provider batch is historical,
> not a current route promotion. Its 30-day freshness window expired. The
> deterministic harness remains supported; rerun the private N=5 command below
> before restoring any live full-solve claim.

This is the professional finance-modeling eval for uploaded three-statement
workbooks. It exists because a spreadsheet agent is not proven by a validator
alone: the agent must perform the workflow through the same tools a user sees
in NodeRoom.

Uploaded XLSX workbooks render as actual Excel-coordinate grids in the room:
column letters, row numbers, formulas, and cell evidence are preserved, and the
agent can read/write the same addresses (`F7`, `G18`, etc.) that the user sees.

## What Runs Now

`npm run eval:finance-model` seeds a `Your Model` sheet and runs NodeAgent
through the real in-memory room runtime:

```text
propose_lock critical forecast cells
  -> read_range current versions
  -> edit_cell linked formula payloads with CAS
  -> release_lock
  -> grade final artifact + trace
```

The default case uses an owned synthetic gold pack so traces and README media
can be committed. The local private workbook path uses the same runtime and
writes full traces under `docs/eval/finance-model-runs/`, which is gitignored.
Only the redacted summary at `docs/eval/finance-model-live.json` is committed.

## Commands

```bash
npm run eval:finance-model
npm run eval:finance-model -- --gold "C:\path\to\modeling-test.xlsx"
npx tsx evals/financeModelLive.ts --real deepseek/deepseek-v4-flash --workbook "C:\path\to\modeling-test.xlsx" --level=full --runs=5 --timeout-ms=420000 --record
npx tsx evals/financeModelLive.ts --scripted --runs=2 --level=smoke --json-out docs/eval/finance-model-scripted-smoke.json
npm test -- tests/financeModelRuntime.test.ts
npm run workflow:trace-previews -- finance-model-solve
```

The private gold workbook can also be validated without running the agent:

```bash
npm run eval:finance-model-private -- --gold "C:\path\to\modeling-test.xlsx"
```

## Latest HALO Loop

Date: 2026-06-11.

Initial gap: the repo had a private answer-key workbook validator and a product
contract for Solve/Guide/Collaborate, but no runnable NodeAgent solve eval. That
meant we could claim the workbook was a good gold source, not that the agent
harness could actually complete the modeling workflow.

Fix:

- Added `evals/financeModelRuntime.ts` as the reusable runtime grader.
- Added `scripts/finance-model-eval.ts` and `npm run eval:finance-model`.
- Added `tests/financeModelRuntime.test.ts`.
- Added a trace-replayed GIF target, `finance-model-solve`.
- Added `evals/financeModelLive.ts` with smoke -> income -> full rungs for the
  private workbook.
- Fixed provider tool-call compatibility where blank `artifactId` should resolve
  to the primary artifact.
- Fixed the private oracle mapper: answer-key formulas are remapped by row label
  onto the actual `Your Model` sheet before the agent sees targets or the grader
  scores formulas. This prevents answer-key row drift from grading edits to
  headers or blank rows.
- Added deterministic formula-value scoring for the computable slice. The agent
  must author linked formulas; the harness computes values when all dependencies
  are visible instead of outsourcing arithmetic to the LLM.
- Added reliability aggregation to `evals/financeModelLive.ts`: `--runs N`
  records pass rate, required passes, median runtime, p95 cost, per-check pass
  counts, and a redacted attempt ledger. `--record` appends the aggregate to the
  JSONL eval store for cross-commit `eval:diff`.
- Added `withinCostBudget` / `withinTimeBudget` checks and structured
  `failureOwner` attribution so budget misses and malformed tool-call arguments
  do not get laundered as provider outages.

Rerun:

- Synthetic public solve: passed, score 1.0, trace
  `docs/eval/traces/finance-model/finance_model_solve_synthetic.json`.
- Scripted private workbook solve: passed, score 1.0, workbook hash
  `3d2f577370eaf65ca35113fc185b9e78401f853bc08df1a9697c943c8f1baca2`, trace
  under the gitignored private run directory.
- Live income rung: `nex-agi/nex-n2-pro:free` passed 6/6 targets in 74.1s at
  $0.0000. It is promoted for income-statement smoke/income demos only.
- Live full rung — **measured promotion batch (2026-06-11)**:
  `deepseek/deepseek-v4-flash` passed **5/5 model-owned runs** with room
  variants rotating (base x2, distractors x2, concurrent_edit x1 — every
  variant cleared), 16/16 linked targets each run, zero provider-owned
  failures, median 105.0s, p95 $0.1068/run, $0.4424 total. Verdict `passed`,
  promotion bar (>= 4/5) exceeded. Redacted aggregate with the per-attempt
  ledger: `docs/eval/finance-model-live.json`; recorded to the eval store for
  `eval:diff` champion-regression tracking. The earlier single-pass result
  (174.8s, $0.0792) is superseded by this batch.
- Live full route boundary: `nex-agi/nex-n2-pro:free` is not promoted for full
  solve yet; one run wrote all 16 linked formulas but failed a then-overstrict
  value gate, and the corrected rerun hit an OpenRouter invalid-JSON provider
  response after lock/read. That is failure owner `provider`, not a promoted
  full-solve pass.
- Focused test: `tests/financeModelRuntime.test.ts` passed.
- Typecheck: `npm run typecheck -- --pretty false` passed.

## What It Grades

- `stoppedCleanly`: the agent finishes without exhausting the step budget.
- `lockedBeforeWrite`: the forecast cells are locked before any write.
- `writesOnlyForecastCells`: only critical forecast cells are touched.
- `allTargetsWritten`: every target forecast cell is written.
- `everyFormulaLinked`: formulas mention the required driver/assumption refs and
  required functions/tokens.
- `valueTieOutComputable`: outputs match the answer key within tolerance only
  for cells whose dependencies are visible in the compact context.
- `releasedLock`: the range is released after the write batch.
- `noAnswerKeyLeakage`: candidate-visible context never contains answer-key
  formulas.
- `withinCostBudget` / `withinTimeBudget`: per-rung budgets are checks, not
  recordings — a run that only passes by blowing the budget fails.

## Reliability verdicts (multi-run)

`--runs N` aggregates attempts into a committed summary with a three-way
verdict. Pass rate is measured over **model-owned** runs only — a provider 429
or a bad key is not a model failure — but provider noise is never silently
excluded: above a 40% provider-owned share (`PROVIDER_INCONCLUSIVE_SHARE`) the
verdict is `inconclusive` ("rerun; this batch proves nothing about the
model"), never `passed`. Failure attribution prefers structure over message
text: a model emitting malformed JSON tool arguments is `model`-owned even
though its error message says "Invalid JSON". Promotion requires >= 4/5
model-owned passes; a single pass is labeled passed-but-unmeasured. Scenario
coverage: `tests/financeModelReliability.test.ts` and
`tests/financeModelLive.test.ts`.

## What Remains

- Guide mode: coach a user through the model with zero writes to answer cells.
- Collaborate mode: split income statement, cash flow statement, and balance
  sheet sections across teammates with draft-on-lock behavior.
- Route matrix: keep `deepseek/deepseek-v4-flash` as the full-solve champion
  until another cheap/free route clears the same full rung. Free routes can be
  used for smoke/income previews, not the full feature promise.
- ~~Reliability proof: add `--runs N` aggregation~~ **Landed 2026-06-11**:
  model-owned pass rate, provider-share inconclusive verdict, budget gates,
  per-attempt failureOwner ledger, `--record` into the eval store for
  cross-commit `eval:diff`. Room-variant rotation also landed (`--variants`,
  default rotation on multi-run batches: base / distractors that reuse the
  target cell ids / concurrent human edit mid-run; no measured variant may go
  0-for), plus the proof staleness gate (`npm run proofs:staleness`, 30-day
  window, enforced in vitest). What remains is keeping the committed aggregate
  current — the staleness gate now enforces that mechanically.
