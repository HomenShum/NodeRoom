# NodeRoom Proof Release

Generated: 2026-07-12T19:24:22.630Z
Publication status: **certified**

## Claim Gate

All required receipts and the persisted ProofLoop gate pass.

## Method

1. Lock public task bundles and upstream scorer revisions before running candidates.
2. Keep exploration open, but keep certification fixtures, scorer semantics, and promotion gates immutable.
3. Require generated plans, raw model output, candidate hashes, workspace manifests, and scorer-attempt receipts for task coverage.
4. Show live product behavior and benchmark receipts together; neither screenshots nor aggregate scores substitute for the other.
5. Run analyst, researcher, finance-operator, founder, reviewer, and guest-observer workflows from fresh landing states, including mutation, conflict handling, evidence review, and export.
6. Record costs, retries, parse failures, blocked lanes, and negative results instead of publishing only successful examples.
7. Route product and exploration work free-first; reserve a pinned paid model for certification only when the benchmark defines it.
8. Keep canonical judge identity separate from API transport; direct OpenAI is the Finch certification path, Azure is optional compatibility only, and free-router or frontier judges remain non-promotable disagreement evidence.

## Results

Strict task coverage: 1739/1739; model-run cases: 1733.

| Lane | Status | Coverage | Primary metric | Candidate proxy | Cost in candidate run |
|---|---|---:|---|---|---:|
| SpreadsheetBench V1 | official_scored | 912/912 | 70/912; avg 0.096126 | 89/912; avg 0.335084 | $0.031046 |
| SpreadsheetBench Verified400 | proxy_scored | 400/400 | 14/400; avg 0.259266 | 14/400; avg 0.259266 | $0.017133 |
| SpreadsheetBench V2 | official_scored | 321/321 | 0/321; avg 0 | 0/321; avg 0.523337 | $0.054617 |
| FinAuditing | scored | 332/332 FinMR rows | FinRE macro F1: 0.162658 | n/a | $0.041812 |
| MBABench | scored | 38/38 cases | Mean score: 11.513158 | n/a | $6.67212 |
| Finch / FinWorkBench | scored | 172/172 tasks | Mean score: 0.087209 | n/a | $1.368019 |

## Findings

### coverage-is-not-quality

Full execution coverage does not imply high task performance: V1 passed 70/912 and V2 passed 0/321 under the bounded model-edit-plan route.

Implication: Publish coverage, average score, and pass count together.

### cheap-first-repair

Most spreadsheet receipts were recovered from free routes; paid fallbacks were limited to exact missing tasks with explicit caps.

Implication: Resume by task id and preserve hash-verified evidence before escalating model cost.

### external-score-boundary

Every external scorer lane has an accepted upstream receipt.

Implication: Proxy judges and no-provider smokes prove wiring, not official scores.

### product-and-benchmark-proof

Live deck, notebook, graph, and chat proof exposed integration issues that benchmark-only runs would not detect.

Implication: Ship product-state screenshots and deterministic receipts as one proof packet.

## Fixes

| Fix | Finding | Change | Evidence |
|---|---|---|---|
| Hash-verified resumable SpreadsheetBench repair | Interrupted and cross-model runs left valid task receipts stranded in archives. | Recover exact task receipts only when candidate, raw output, manifests, and hashes verify; rerun only missing tasks. | `scripts/spreadsheetbench-run-chunked.ts`<br>`tests/spreadsheetBenchChunkedRepair.test.ts` |
| Formula-aware model JSON salvage | Nested formula quotes could make otherwise usable model plans invalid JSON. | Repair unescaped formula quotes without rewriting legitimate empty-string formula arguments. | `src/eval/spreadsheetBenchRunner.ts`<br>`tests/spreadsheetBenchRunner.test.ts` |
| Model-run pass-rate provenance | The V1 coverage ledger displayed the copy-input baseline pass rate instead of the model-run pass rate. | Bind the published pass rate to the model-run report and pin it in tests. | `src/eval/officialBenchmarkTaskCoverage.ts`<br>`tests/officialBenchmarkTaskCoverage.test.ts` |
| Retry-aware provider cost ceilings | Failed or retried judge calls could escape a success-only call counter. | Charge every provider attempt against call and reserve ceilings and reject over-cap promotion receipts. | `scripts/finch-official-judge.py`<br>`tests/finchOfficialJudgeCostGuard.test.ts`<br>`tests/proofloopPromoteOfficialScore.test.ts` |
| Canonical Finch judge without Azure lock-in | The released Finch script hard-coded Azure transport even though the paper calibrates the GPT-5-mini judge model and exact prompt/parser contract. | Use direct OpenAI as the hash-verified certification transport, keep Azure optional, route ordinary work free-first, and make OpenRouter free-auto structurally non-promotable shadow evidence. | `scripts/finch-official-judge.py`<br>`src/eval/finchJudgeDisagreement.ts`<br>`tests/finchOfficialJudgeCostGuard.test.ts`<br>`tests/proofloopPromoteOfficialScore.test.ts` |
| Non-destructive Finch scorer-input regeneration | A routine output-manifest refresh could delete rendered content_parts and demote already-accepted score claims. | Clean only regenerable model outputs, preserve eval_set, and retain a promoted claim only while accepted-receipt and full-coverage invariants still hold. | `src/eval/finchOfficialOutputSafety.ts`<br>`scripts/proofloop-official-outputs.ts`<br>`tests/finchOfficialOutputSafety.test.ts` |
| Prompt-hash-bound Finch resume | A provider/model-matched result could be resumed after its individual content record changed, allowing stale task evidence into a newly hashed aggregate receipt. | Hash each canonical task record, store that hash on the judge result, and rerun any row whose expected prompt hash does not match. | `scripts/finch-official-judge.py`<br>`tests/finchOfficialJudgeCostGuard.test.ts` |
| Free-router shadow context guard | Finch's released 128k completion reserve can exceed a free endpoint's total context before the small JSON judgment is generated. | Cap only the non-promotable OpenRouter shadow at 8,192 completion tokens while preserving the released canonical request unchanged. | `scripts/finch-official-judge.py`<br>`docs/eval/FINCH_JUDGE_CONTRACT.md`<br>`tests/finchOfficialJudgeCostGuard.test.ts` |
| Real work-artifact interiors | The shell migration did not prove deck editing, notebook execution, graph exploration, or scoped chat context. | Add CAS-backed deck state, bounded notebook kernel receipts, draggable graph clusters, and openable chat references. | `src/ui/workArtifacts/`<br>`src/notebook/notebookKernel.ts`<br>`src/ui/graph/semanticGraphClusters.ts`<br>`src/ui/artifactRefs.ts` |

## Versions

- NodeRoom: `0.1.1`
- Git commit at generation: `d6d005bef4695f445860dd3d01bb75f3cf272075`
- Candidate and judge models: `openai/gpt-oss-20b:free`, `gpt-5.4-nano`, `gpt-5.4-mini`, `nvidia/nemotron-3-super-120b-a12b:free`, `qwen/qwen3-next-80b-a3b-instruct:free`, `gpt-5-mini`, `google/gemini-3-flash-preview`
- Accepted receipt hashes: `finauditing:58a00413e181`, `workstreambench:50844fb947df`, `finch:0284b1b02e8f`

## Product Proof

- [Fresh-user vertical receipt](../eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md)
- [Six-persona dogfood receipt](../eval/noderoom-persona-dogfood-receipt.json)
- [Collaborative deck](../synthesis/proof/m24-deck-collaboration-proof.png)
- [Notebook kernel](../synthesis/proof/m25-notebook-kernel-proof.png)
- [Graph clusters](../synthesis/proof/m26-graph-cluster-drag-proof.png)
- [Scoped chat context](../synthesis/proof/m27-chat-context-proof.png)

## Vertical Dogfood

Six fresh-user personas passed 79 visible interaction steps with 0 console errors and an average NodeAgent latency of 2769 ms.

Receipt: [machine-readable persona proof](../eval/noderoom-persona-dogfood-receipt.json).

## Media Review

Visual judge: **publish, 16/16**. No unresolved visual-judge defects.

[Judge receipt](../../episodes/noderoom-proof-release-v1/judge.md)

## Reproduce

```bash
npm run benchmark:official:task-coverage -- --strict
npm run benchmark:proofloop:official-preflight -- --strict
npm run benchmark:finch:canonical-judge -- --resume --max-calls 516 --allow-provider-spend --max-provider-cost-usd <approved-cap>
npm run benchmark:finch:judge-disagreement
npm test -- --run
npm run build
npm run proofloop -- gate --goal official-scores
npm run proofs:publish:check
```

## Publication Rule

Publish completion claims only when task coverage, accepted external scorers, repository validation, six-persona dogfood, the storyboard media judge, and the persisted ProofLoop gate all pass.
