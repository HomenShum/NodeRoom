# BankerToolBench full-suite PROOF — execution plan

> Generated 2026-06-28. Decision: **prove the full suite, don't downgrade the claim**
> (`HONESTY_DEBTS_BEFORE_PUBLISH.md`, Debt 1). This is the runbook to flip `FR-020B`
> `BLOCKED → PASSED` honestly.
>
> **STATUS 2026-06-28 — DONE for the official isolated lane.** The full-100 run already existed
> (committed full100 ledger, PR #21). The gate verified 100/100 executed + officially scored,
> clean generic-only, mean reward 0.2519, and flipped `FR-020B → passed`. No Docker re-run was
> needed. This runbook now serves re-runs, a higher-reward iteration, OR the still-open
> **live-browser-UI-for-all-100** lane (only FR-020A proves live-UI today, for one task).

## What we are earning (read this first)

The claim is **execution + scoring**, not a pass rate:

> *All 100 official BankerToolBench tasks executed end-to-end, generic-only (no answer-key
> writers), each with an official Gandalf score + trace link. Aggregate mean reward = X;
> pass-rate = Y.*

This flips `FR-020B`'s two gates (`full_suite_execution`, `aggregate_score_import`). It does
**not** claim 100% pass — current clean baseline is mean reward ~0.22–0.30. The registry keeps
"100% rubric pass rate" under `doesNotProve`. The gate enforces this in code.

## How the run is graded (run mode)

Docker **Harbor** + the Python adapter (`btb_noderoom_agent.harbor_adapter:NodeRoomNodeAgent`)
→ TS general runner → **Gandalf** verifier (Gemini-graded). This is the official lane the sweep
script drives. (A Docker-free TS golden grader exists at `src/benchmarks/golden/` for internal
gates, but the official headline must be Gandalf.)

## Generic-only enforcement (Debt 2 precondition)

Generic-only is **not** the default (`harbor_adapter.py` defaults to `replay`). It must be set,
and the sweep's `cleanCapabilityGate` rejects any task that isn't clean:

| Flag (sweep) | Harbor kwarg | Must be |
|---|---|---|
| `-MaterializerMode generic-only` | `materializer_mode=generic-only` | generic-only |
| `-ForceModelPlanner` | `force_model_planner=true` | true |
| `-NoFallbackPlan` | `allow_fallback_plan=false` | false (and `fallbackUsed=false`) |

Receipt must show `genericWriterOnly=true`, `generalFamilyMaterializersEnabled=false`,
`replayMaterializersEnabled=false`, `modelCalls>0`, boundary receipts fully supported.

**Source hardening (do before the real run):** make the `harbor_adapter.py:4717`
`is_*_task → write_*_package` dispatch *throw* when `materializer_mode != replay`, so a per-task
answer-key writer can never run under generic-only. The full-suite gate already excludes any
non-clean task, so this is belt-and-suspenders — but it closes the "trusts runner truthfulness" hole.

## Blockers / preconditions (owner: Homen)

| Precondition | Status | Needed |
|---|---|---|
| Docker + Harbor CLI | reported available | — |
| Convex secrets (OpenAI/Gemini) | available via `bankertoolbench-load-secrets-from-convex.ps1` | — |
| **`HF_TOKEN`** | NOT in Convex | Homen supplies process-scoped (fetches golden/rubrics) |
| **MCP financial tools** (sec_filings, market_data, company_logo, document_search, web_research) | `complete:false` in contract | confirm wired, or expect tool-dependent tasks to score low |
| Cost / time | ~$12 + ~8–17h (≈$0.12 + ~5min/task, sequential) | Homen approves spend + prod Convex usage |

**Live feasibility probe (2026-06-28, in the worktree shell):** `HF_TOKEN` = SET ✅,
`nodebench-ai` Convex repo = exists ✅ — but **Docker daemon = DOWN**, **harbor CLI = not on
PATH**, **BTB dataset = not staged**. Harbor runs each task in Docker, so the suite must be run on
a machine/session with Docker Desktop started, `harbor` installed (`uv tool install harbor`), and
the dataset ingested (`npm run benchmark:bankertoolbench:ingest`). Everything that does NOT need
Docker (the flip gate, ledger merge, adapter hard-gate) is built + verified.

## Command sequence

```powershell
# 0) Setup (once)
. .\scripts\bankertoolbench-d-disk-env.ps1
. .\scripts\bankertoolbench-load-secrets-from-convex.ps1 -ConvexRepo "D:\...\nodebench-ai"
$env:HF_TOKEN = "<hf-token>"           # process-scoped; do NOT commit
.\scripts\bankertoolbench-normalize-shell-scripts.ps1

# 1) SMOKE one task generic-only — prove the harness is green before the long run
npm run benchmark:bankertoolbench:nodeagent-sweep -- `
  -MaterializerMode generic-only -ForceModelPlanner -NoFallbackPlan `
  -Limit 1 -JobNamePrefix btb-smoke-generic-only `
  -SummaryOut docs/eval/btb-clean-capability-smoke.json

# 2) FULL sweep, generic-only, resumable, in 5 chunks of 20 (recover per chunk)
#    (loop offsets 0,20,40,60,80; -Resume skips already-finished tasks)
npm run benchmark:bankertoolbench:nodeagent-sweep -- `
  -MaterializerMode generic-only -ForceModelPlanner -NoFallbackPlan -Resume `
  -Offset 0 -Limit 20 -JobNamePrefix btb-full-generic-only `
  -SummaryOut docs/eval/btb-clean-capability-chunk0.json
#    ...repeat for offsets 20/40/60/80 → btb-clean-capability-chunk{1..4}.json

# 3) Merge chunk summaries into the eval ledger (existing tool)
npm run benchmark:bankertoolbench:ledger-ingest -- --all-summaries `
  --json-out docs/eval/loop-ledger/btb-ledger-import.json

# 4) GATE: decide + flip FR-020B (refuses unless all 100 are clean + scored)
#    report-only first:
npm run benchmark:bankertoolbench:fullsuite-gate -- `
  --ledger docs/eval/loop-ledger/btb-ledger-import.json --expected-count 100 `
  --receipt-out docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json
#    when eligible, flip the registry:
npm run benchmark:bankertoolbench:fullsuite-gate -- `
  --ledger docs/eval/loop-ledger/btb-ledger-import.json --expected-count 100 `
  --receipt-out docs/eval/fresh-room/FR-020/fullsuite-gate-receipt.json --write
```

Optionally pass `--expected-task-ids <ids.json>` (the 100 official ids) for set-equality instead
of a bare count, and `--assert` to make CI fail until the proof is earned.

## Acceptance criteria (the gate enforces all of these)

- 100 distinct official tasks, each with ≥1 **clean generic-only** receipt
  (`cleanGeneralProbe=true`, finite reward, `exceptions=0`).
- Every clean task carries an official Gandalf score + trace link.
- 0 contaminated, 0 unscored, 0 missing.
- Registry `FR-020B` → `passed`; `proves` records completion + mean reward; `doesNotProve` retains
  the pass-rate caveat. `summary.bankerToolBenchFullSuiteReady = true`.

## What's already built (this session)

- `src/eval/bankerToolBenchFullSuiteGate.ts` — pure `evaluateFullSuiteGate` (the promotion gate).
- `scripts/bankertoolbench-fullsuite-gate.ts` — CLI (report / `--write` flip / `--assert`).
- `tests/bankertoolbenchFullSuiteGate.test.ts` — 8 scenario tests (green): earned, partial,
  contaminated, unscored, complete-but-low-passrate, missing-ids, cross-run dedupe, empty.
- npm: `benchmark:bankertoolbench:fullsuite-gate`.

## Go / no-go

The harness, merge, and honest flip-gate are ready and tested. The full run needs Homen to:
(1) supply `HF_TOKEN`, (2) confirm the MCP financial tools are wired (or accept low scores on
tool-dependent tasks), (3) approve ~$12 + ~8–17h on prod Convex. Recommended first step: run the
**1-task smoke** (cheap) to confirm green, then kick the 5-chunk resumable sweep (can run
overnight / via a Codex loop), then the gate flips `FR-020B` automatically when earned.
