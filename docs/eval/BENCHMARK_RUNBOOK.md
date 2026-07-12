# Benchmark Runbook — lane x stage command matrix

> generated-by: Claude Code (script inventory verified against package.json, 250 scripts)
> date: 2026-07-12
> regen: authored doc — update when adding a benchmark lane or renaming scripts.

Answers "which command do I run for lane X at stage Y, and what does it need" without reading 250 script names. Every command below was verified to exist in `package.json` and its target file verified on disk (2026-07-12).

## Stages and cost classes

Stages: **ingest** (scan a downloaded official bundle into a manifest — never downloads, never runs models) → **stage** (split into `agent/` vs `evaluator/` dirs so golden/rubric/canary data never reaches the agent) → **run** (produce candidate outputs with a model route) → **score** (local/proxy scorer) → **official-judge** (pinned upstream judge; the only stage allowed to mint an official score) → **accept/promote** (write official receipts into `.proofloop/lanes/<id>/`) → **receipts/board** (verify receipts, render the board).

Cost classes: **free** = local, no model calls · **cheap** = free-tier/cheap model route (still needs an API key) · **paid** = paid provider spend · **Docker** = container required. Cells with no script are `—`.

All commands are `npm run <name>`; pass args after `--`.

## SpreadsheetBench v1 (912 tasks) and v2 (321 tasks)

Same script family; select with `--track spreadsheetbench-v1|spreadsheetbench-v2`. Bundle roots live under `.tmp/official-benchmarks/`.

| Stage | Command | Does | Cost | Needs |
|---|---|---|---|---|
| ingest | `benchmark:spreadsheetbench:ingest` | Scans an already-downloaded official bundle (`-- --track <t> --root <extracted-root>`) | free | extracted bundle on disk |
| stage | `benchmark:spreadsheetbench:stage` | Splits into agent/evaluator dirs (`-- --track <t> --root <r> --output-root <staged>`) | free | ingested bundle |
| stage-check | `benchmark:spreadsheetbench:stage-proof` | Verifies staged isolation (no golden leak into agent bundle) | free | staged dir |
| run | `benchmark:spreadsheetbench:run` | Small runs (`--stage-root <s> --output-root <o> --mode copy-input-baseline\|apply-agent-patch\|model-edit-plan --model <route>`) | free (baseline) / cheap-paid (model-edit-plan) | staged dir; `OPENROUTER_API_KEY` for model modes |
| run (full) | `benchmark:spreadsheetbench:run-chunked` | Full-suite chunked work queue (`--chunk-size 25`), resumable | cheap-paid | staged dir + key |
| score | `benchmark:spreadsheetbench:score` | Local TS scorer (`spreadsheetBenchScorer`) — candidate vs gold workbook compare | free | run outputs + gold |
| score (redo) | `benchmark:spreadsheetbench:rescore-existing` | Rescores existing run outputs without rerunning models | free | run outputs |
| score (formulas) | `benchmark:spreadsheetbench:refresh-excel` | Recomputes cached workbook values via local Excel COM, hash-bound receipt | free | Windows + MS Excel installed, python |
| score (charts, v2) | `benchmark:spreadsheetbench:chart-visual:grade` / `:probe` | VLM-grades rendered charts | cheap (Gemini) | `GEMINI_API_KEY`; default model gemini-3.5-flash |
| official-judge | `benchmark:spreadsheetbench:official-v1-project` / `official-v1-project-chunked` / `official-v2-project` | Projects the official-protocol score over run outputs | free | run outputs + gold bundle |
| official-judge (repair) | `benchmark:spreadsheetbench:visible-repair-replay` | Replays visible-state repair passes | cheap-paid | run outputs + key |
| accept/promote | `benchmark:spreadsheetbench:accept-official-v1` / `accept-official-v2` | Accepts a projected official score into lane receipts | free | project output |
| receipts | `benchmark:spreadsheetbench:official-output-receipts` / `:proof` | Verifies output manifests + lane proof receipts | free | lane artifacts |
| report | `benchmark:spreadsheetbench:project-model-report` / `:routes` | Per-model report / route selection | free | receipts |
| browser proof | `proofloop:live:spreadsheetbench-v1` / `-v2` | Playwright browser-lane transfer proof in the live app | free | built app + Playwright browsers |

## BankerToolBench (BTB)

Local ingest/stage/run never touch Docker; the official Gandalf verifier runs in upstream Harbor/Docker and is imported, not wrapped.

| Stage | Command | Does | Cost | Needs |
|---|---|---|---|---|
| ingest | `benchmark:bankertoolbench:ingest` | Scans local BTB data root; no HF download, no Docker, no rubric leak | free | BTB data root on disk |
| stage | `benchmark:bankertoolbench:stage` | agent/ vs evaluator/ split (`-- --root <r> --output-root <s>`); evaluator keeps canary/rubric/golden | free | ingested data |
| run (sim) | `benchmark:bankertoolbench:run` | Local heuristic run — no Docker, no MCP tools, no official verifier | free | staged dir |
| run (real) | `benchmark:bankertoolbench:nodeagent-sweep` (PS1, parallel) / `nodeagent-clean-parallel` / `nodeagent-clean-sequential` | Full NodeAgent model sweeps over staged tasks | cheap-paid | staged dir + `OPENROUTER_API_KEY`; PowerShell for the .ps1 pair |
| run (ledger) | `benchmark:bankertoolbench:ledger-ingest` | Ingests sweep run ledgers into lane records | free | sweep outputs |
| score | `benchmark:bankertoolbench:fullsuite-gate` (`-- --assert`) / `livesuite-gate` | Full-suite / live-suite pass-fail gates over ledgers | free | ledgers |
| official-judge | `benchmark:bankertoolbench:official-contract` | Records the official judge contract JSON (actual Gandalf verifier = upstream Harbor) | free (contract) / Docker (verifier, external) | — |
| accept/promote | `benchmark:bankertoolbench:manifest-lock` | Locks the official output manifest | free | outputs |
| receipts | `benchmark:bankertoolbench:proof` | Lane proof-check | free | lane artifacts |
| browser proof | `proofloop:live:btb` | Playwright browser-lane proof | free | built app + Playwright |

## Finch / FinAuditing / MBABench / WorkstreamBench (judge-import lanes)

These lanes stage via the proofloop CLI and export predictions with the shared exporter; only the judge step differs. WorkstreamBench converts the locked ModelOff dataset into MBABench judge case folders — its official judge IS the MBABench judge.

| Stage | Command | Does | Cost | Needs |
|---|---|---|---|---|
| ingest/stage (all four) | `proofloop -- setup <finch\|finauditing\|workstreambench\|bankertoolbench> --doctor` | Prepares local fixtures/adapters for the lane | free | lane dataset under `.tmp/official-benchmarks/` |
| run/export (all) | `benchmark:proofloop:official-outputs -- --id <lane>` | Exports official-format predictions (e.g. FinMR `predictions.jsonl`, `ai_attempt.xlsx`) | free | staged fixtures + prior model runs |
| fixture repair (Finch) | `benchmark:finch:content-parts` | Rebuilds Finch content_parts from the model-output manifest (python) | free | Finch manifest |
| score/proxy (Finch) | `benchmark:finch:shadow-judge` | Judge via openrouter/free at $0 (proxy, NOT official) | cheap ($0 route) | `OPENROUTER_API_KEY` |
| score check (Finch) | `benchmark:finch:judge-disagreement` | Diffs shadow vs official judge verdicts | free | both judge outputs |
| official-judge (Finch) | `benchmark:finch:official-judge` / `canonical-judge` (gpt-5-mini) | Pinned Finch judge | paid | `OPENAI_API_KEY` or `AZURE_OPENAI_*` |
| official-judge (FinAuditing) | `benchmark:finauditing:official-judge` | Pinned FinMR judge notebook; `--max-provider-cost-usd` is REQUIRED | paid | `OPENAI_API_KEY`, FinAuditing StartKit repo at `.tmp/official-benchmarks/finauditing-repo`, predictions.jsonl |
| official-judge (MBABench + WorkstreamBench) | `benchmark:mbabench:official-judge -- --judge-root <upstream-judge-checkout>` | Launches the pinned BizBench/MBABench judge | paid | judge repo checkout + `BIZBENCHJUDGE_KEYS_*` env |
| judge sweep (MBABench) | `benchmark:mbabench:official-sweep` | Sweeps the official judge across case folders | paid | same as above |
| accept/promote (Finch, FinAuditing, WorkstreamBench) | `benchmark:proofloop:promote-official-score -- --id <lane> --judge-receipt <path>` | Writes the official score receipt into `.proofloop/lanes/<id>/` | free | accepted judge receipt |
| receipts (all) | `benchmark:proofloop:adapter-blockers -- --id <lane> [--strict]` | Verifies lane blocker/receipt state; `--strict` fails closed | free | lane dir |

## Proximitty / Accounting / Notion proofloops (product-path lanes)

| Stage | Command | Does | Cost | Needs |
|---|---|---|---|---|
| seed | `proofloop:accounting:seed` / `proofloop:notion:seed` | Seeds synthetic datasets (Proximitty: — , data is built-in synthetic) | free | — |
| run | `proofloop:proximitty` / `proofloop:accounting` / `proofloop:notion` | Runs the suite: build + Playwright scenario steps against min-score gate | free | Playwright browsers; app builds |
| run (live) | `proofloop:live:underwriting` / `proofloop:live:accounting` / `proofloop:live:notion` | Live-app runner variants (starter-room tasks) | cheap-paid | running app + provider keys in Convex env |
| score/models | `proofloop:proximitty:models` | Model-delta report over the latest proximitty run | free | latest run in `.proofloop/runs` |
| verify | `proofloop:live:underwriting:verify` / `proofloop:credit-data` | Verifies live underwriting artifacts / credit data fixtures | free | prior live run |
| browser proof | `proofloop:proximitty:browser` / `proofloop:live:accounting:browser` / `proofloop:live:notion:browser` | Playwright browser-lane proofs | free | built app + Playwright |
| clips | `proofloop:proximitty:clips` | Renders demo clips from the latest run | free | latest run |
| official-judge / promote | — | Product-path lanes have completion proof only; never an official semantic score | — | — |

## SEC-XBRL

| Stage | Command | Does | Cost | Needs |
|---|---|---|---|---|
| ingest | `benchmark:sec-xbrl:ingest` | Pulls filings from SEC EDGAR | free (network) | internet; EDGAR reachable |
| run+score | `benchmark:sec-xbrl` | Runs the XBRL audit bench end-to-end | cheap | `OPENROUTER_API_KEY` |
| stage / official-judge / promote / board | — | No separate scripts; single-script lane | — | — |

## Cross-lane commands (any lane)

| Purpose | Command | Cost |
|---|---|---|
| Preflight before official work | `benchmark:proofloop:official-preflight` (alias `proofloop:official-preflight` = same + `--strict`) | free |
| Task/UI coverage gates | `benchmark:official:task-coverage [-- --strict]` / `benchmark:official:ui-coverage` / `benchmark:official:readiness` | free |
| Contamination check | `benchmark:contamination` | free |
| Proxy-route economics (pick cheap routes) | `benchmark:proofloop:harness-economics` / `free-model-gauge` / `proxy-model-sweep` / `full-proxy-sweep` / `prod-proxy-matrix` | free-cheap |
| Board + receipts render | `benchmark:proofloop:board` (writes the benchmark board) / `benchmark:proofloop:normalized` | free |
| Fresh-room proof receipts | `fresh-room:proofs` (verify) vs `benchmark:fresh-room:proofs` (registry) — different scripts, see sprawl notes | free |

## Sprawl notes

**Byte-identical npm script bodies** — RESOLVED 2026-07-12: `omniagent:nodeagent:smoke` and `previews:render` were deleted; the survivors are `omnigent:nodeagent:smoke` and `workflow:trace-previews`.

**Same target file, different args** (intentional variants, but easy to confuse):
- `benchmark:proofloop:standalone-runner-plan` vs `benchmark:proofloop:two-layer-plan` (same script, second adds `--json-out/--md-out`).
- `proofloop:orchestrator` vs `benchmark:proofloop:orchestrator-longrun` (same script; longrun adds dogfood args).
- `benchmark:finch:official-judge` vs `:canonical-judge` vs `:shadow-judge` (same python judge; provider/model flags differ — only the first two can mint official scores).
- `benchmark` vs `benchmark:free` (same runner; `:free` pins openrouter/free-auto + timeouts).

**Ambiguous name pairs** (different scripts despite similar names):
- Three "charts": `proofloop:charts` (proofloop CLI `charts latest` — charts a proofloop run) vs `benchmark:proofloop:charts` (`scripts/proofloop-charts.ts` — lane benchmark charts) vs `benchmark:charts` (`scripts/benchmark/charts.ts` — model benchmark suite charts).
- `walkthroughs*` family (`scripts/walkthroughs/` capture/render/review/episode pipeline) vs `walkthrough-review` + `walkthrough-review:mcp` (separate CLI in `packages/walkthrough-review-cli/`). "walkthroughs:review" and "walkthrough-review" are NOT the same tool.
- `fresh-room:proofs` (`scripts/fresh-room-proof-verify.ts`, part of `prod:gate`) vs `benchmark:fresh-room:proofs` (`scripts/fresh-room-proof-registry.ts`).
- `eval` (`evals/runEval.ts`, agent eval harness) vs `benchmark` (`scripts/benchmark/run.ts`, model benchmark suite).
- `proofloop:gate/resume` are hardwired to `--goal official-scores`; for other goals call `proofloop -- gate --goal <id>` directly.

**Dead scripts:** none — every npm script target file resolved on disk (verified 2026-07-12).

**Orphan script file (no npm alias):** `scripts/proofloop-official-score-import.ts` — invoke as `tsx scripts/proofloop-official-score-import.ts` if you need judge-receipt import; consider adding an npm alias or deleting.
