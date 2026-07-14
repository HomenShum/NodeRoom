# NodeAgent Workbook Improvement Receipt

Generated: 2026-07-10T20:47:55.999Z

Status: **passed**. This receipt does not claim an official benchmark score improvement.

## Result

NodeAgent now follows one workbook protocol in the benchmark runner and NodeRoom:

`inspect -> preflight -> managed write -> post-write verify -> repair`

The implementation adds task-aware target/dependency ranking, per-sheet context fairness, formula protection, complete target coverage, candidate re-reads, bounded replacement-plan repair, and durable sidecar receipts.

## Held-Out Findings And Fixes

- A quoted formula such as `TEXT(F4,"DD")` identifies the formula-bearing cell, not merely input `F4`.
- Self-referential plans and formula-to-scalar overwrites fail preflight.
- Explicit ranges such as `J15:J17` must be covered completely.
- A visible row of hardcoded weekday labels backed by dates is recognized as one formula-fill band.
- Formula-fill inspection generates relative `TEXT(...,"DDD")` operations for every visible target.
- Deterministic formula receipts now support `AND`, `OR`, `NOT`, direct cell comparisons, `MEDIAN`, and multi-column exact `VLOOKUP` arguments.

The real task `11276` no-provider replay used the prior failed `F4` plan. The verifier rejected that plan, rejected an incomplete one-cell repair, accepted the complete visible fill band, verified 31/31 changed cells, and scored with zero mismatches. The replay is a harness regression receipt, not a new model score.

The bounded free-router probe for `10281` and `11276` aborted before any model call: 0 calls, 0 tokens, and $0 cost. That is recorded as provider-availability evidence rather than a product or score failure.

## NodeRoom Experience

- Room Home submits directly to public chat and starts NodeAgent; it no longer only copies text into the chat composer.
- The active workbook is attached as run context.
- `Audit workbook` appears only when a sheet is available.
- The UI exposes running, sent, and error states.
- The memory sample runs the same inspect, preflight, lock/CAS, release, and verify tools as production.
- The browser proof starts from a fresh sample room, runs the audit from Home, observes the public completion, and confirms all four Q3 calculation cells changed.

## Validation

- Focused matrix: 99/99 passed.
- Full Vitest: 2,085/2,085 passed across 312 files.
- TypeScript and Convex typechecks: passed.
- Production build: passed.
- Chromium first-run/workbook matrix: 8/8 passed.
- NodeAgent frame smoke: passed.
- Omnigent NodeAgent smoke: passed; external Omnigent CLI was not installed.
- ProofLoop doctor: 11/11 passed.
- ProofLoop `official-scores` gate and dense resume: passed, no blocked tasks.
- Production dependency audit: 0 vulnerabilities.

## Evidence

- Contract: `docs/eval/NODEAGENT_WORKBOOK_TASK_CONTRACT.md`
- Machine receipt: `docs/eval/nodeagent-workbook-improvement-receipt.json`
- Free-router probe SHA-256: `49fdd6e79e0c3dc20c9dc9f267e618c0f23ff656b01e47240eb23733c19c7c4f`
- No-provider replay SHA-256: `b9619948df32ec142a23c10ab90aa130d2251c3e7f67e758647488b6dae5a8df`

## Honest Limits

- No official model-score uplift is claimed without a successful provider-produced full run and accepted official receipt.
- Task `10281` has deterministic support for its formula shape, but still needs a successful model route to measure planning quality.
- The production build retains its pre-existing large-chunk warning; this scoped change does not alter bundle partitioning.
