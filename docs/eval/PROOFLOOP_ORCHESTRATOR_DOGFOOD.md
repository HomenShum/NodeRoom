# ProofLoop Orchestrator Dogfood

Run: dogfood-official-scores-2026-07-03T22-15-12-870Z
Goal: official-scores
Terminal status: NEEDS_HUMAN_APPROVAL
Safe execution: enabled
Steps used: 16/100

## Summary

- Passed: 9
- Failed: 0
- Needs scaffold/model run: 4
- Needs worker/approval: 2
- External-blocked: 1
- Not done: 7

## Long-Running Control Plane

- Goal contract criteria: 5
- Detached evaluator: not_done (deterministic_state_judge, shared executor context: false)
- Deterministic verifiers: 11
- Expensive/live verifiers: 2
- Outer loop: 16/100 steps, 7 not done
- Dashboard: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/dashboard.json
- Session memory: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/session-memory.json

## Not Done

### btb-fullsuite-official-score

Status: needs_worker
Safety: expensive_or_live
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/btb-fullsuite-official-score.md

### external-adapter-local-product-proofs

Status: needs_worker
Safety: expensive_or_live
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/external-adapter-local-product-proofs.md

### spreadsheetbench-v1-full-official-score

Status: needs_scaffold_or_run
Safety: requires_worker
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/spreadsheetbench-v1-full-official-score.md
Resume: `run all 912 SpreadsheetBench V1 tasks through the model runner, use npm run benchmark:proofloop:harness-economics to select cheap proxy routes for product iteration, then npm run benchmark:official:task-coverage -- --strict`
- Full public 912-task SpreadsheetBench V1 bundle is staged and deterministically scored: 912/912 tasks, 2,729 agent-visible workbooks, 2,729 evaluator answer workbooks, 95/912 copy-input baseline pass.
- All 912 tasks need model-run evidence before strict official-score promotion; cheaper OpenRouter proxy judges can triage product quality but cannot replace the SpreadsheetBench workbook scorer for the official claim.

### spreadsheetbench-v2-full-official-score

Status: needs_scaffold_or_run
Safety: requires_worker
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/spreadsheetbench-v2-full-official-score.md
Resume: `stage the full SpreadsheetBench V2 321-task bundle, run all tasks and scorer/chart grader, use npm run benchmark:proofloop:harness-economics for proxy-model routing, then npm run benchmark:official:task-coverage -- --strict`
- Only the public/example SpreadsheetBench V2 slice is staged locally.
- All 321 V2 tasks need official bundle, model-run, workbook scorer, and rendered chart-grader evidence; proxy judges can improve candidates but cannot stand in for the V2 scorer path.

### finch-official-score

Status: needs_scaffold_or_run
Safety: requires_worker
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/finch-official-score.md
Resume: `emit NodeRoom outputs for every official Finch task id, run/import the accepted upstream Finch scorer or judge output, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`
- finch: official scorer receipt docs/eval/proofloop-official-scores/finch.json is blocked_external; scored receipt is still required before claiming score.
- finch: official task bundle lock docs/eval/proofloop-official-task-bundles/finch.json is staged, but NodeRoom still needs one official-output artifact per Finch task id and an accepted upstream judge/scorer path; Azure OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.

### finauditing-official-score

Status: needs_scaffold_or_run
Safety: requires_worker
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/finauditing-official-score.md
Resume: `emit official-format FinSM/FinRE/FinMR predictions, run/import FinAuditing scorer output with an accepted FinMR judge path, use npm run benchmark:proofloop:harness-economics for proxy triage, then npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict`
- finauditing: official scorer receipt docs/eval/proofloop-official-scores/finauditing.json is blocked_external; scored receipt is still required before claiming score.
- finauditing: official task bundle lock docs/eval/proofloop-official-task-bundles/finauditing.json is staged, but NodeRoom still needs official-format FinSM/FinRE/FinMR prediction JSONL and an accepted FinMR judge path; OpenAI credentials are one path, while cheaper OpenRouter proxy judges are product-gate evidence only unless accepted upstream.

### workstreambench-official-score

Status: blocked_external
Safety: requires_worker
Repair context: .proofloop/orchestrator/runs/dogfood-official-scores-2026-07-03T22-15-12-870Z/repair-contexts/workstreambench-official-score.md
Resume: `obtain the official WorkstreamBench task bundle and scorer/rubric from an upstream release or authors, lock it in docs/eval/proofloop-official-task-bundles/workstreambench.json, use npm run benchmark:proofloop:harness-economics for proxy triage, import a scored receipt, then npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict`
- workstreambench: official scorer receipt docs/eval/proofloop-official-scores/workstreambench.json is blocked_external; scored receipt is still required before claiming score.
- workstreambench: no public official task bundle lock docs/eval/proofloop-official-task-bundles/workstreambench.json is staged because no public official bundle/scorer/rubric URL was found.

## Worker Inventory

- codex: [local-path-redacted]
- claude: [local-path-redacted]
- cursor: missing
- windsurf: missing
- node: [local-path-redacted]
- npm: [local-path-redacted]
- git: [local-path-redacted]
