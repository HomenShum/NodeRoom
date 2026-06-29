# BankerToolBench NodeRoom Chat Status

Current claim (updated 2026-06-28):

```text
All 100 BankerToolBench tasks have file-backed per-task LIVE receipts through the real NodeRoom
fresh-room public @nodeagent chat path (fresh room -> upload -> public @nodeagent -> export ->
reopen -> package verifier -> visual judge). Aggregated + strictly validated by the FR-020C
live-suite gate (npm run benchmark:bankertoolbench:livesuite-gate). Registry FR-020C = passed,
liveBrowserBenchmarkReady = true. This proves COMPLETION through the live product UI, NOT a 100%
rubric pass rate. Separately, the official isolated (Harbor) generic-only lane scored all 100
(FR-020B), mean reward 0.2519.
```

> Note: the prior claim said only ONE task was proven. That was stale — the 100 per-task live
> receipts were committed in PR #66 but never aggregated into a claim until the FR-020C gate
> (this session) validated all 100 against the strict `validateFreshRoomProofReceipt`.

## Proven

| Case | Task | Path | Model | Runtime profile | Deliverables | Receipt |
|---|---|---|---|---|---|---|
| `FR-020` | `707cba99-59a7-47bd-bc4d-7f36212e99f3` / `btb-707cba99` | fresh room -> upload official inputs -> public `@nodeagent` -> streamed UI -> generated package -> download/reopen/verifier | `z-ai/glm-5.2` via OpenRouter | `benchmark_completion` | `.xlsx`, `.xlsm`, `.pptx`, `.docx`, `.pdf` | `docs/eval/fresh-room/FR-020/latest.json` |

Evidence:

```text
docs/eval/fresh-room/FR-020/latest.json
docs/eval/bankertoolbench-live-room-proof.json
test-results/bankertoolbench/package-manifest.json
```

## Not Yet Proven

The full official BankerToolBench track is 100 tasks. The current NodeRoom chat proof does not cover all 100 tasks.

Known blockers before claiming "all BTB tasks work through NodeRoom chat":

```text
1. A proof-case registry row for every BTB task or shard.
2. Headed or recorded fresh-room run per task/shard through the public @nodeagent composer.
3. Uploaded official task inputs, no seeded replay room, no memory-mode shortcut.
4. Generated and downloaded expected deliverables for each task.
5. Reopen validation for every generated file.
6. Official Gandalf/Harbor verifier import, or an explicitly labeled benchmark-faithful substitute.
7. Cost, latency, model, tool-call, trace, video, and room receipt per task.
8. Aggregate ledger that derives pass rate from receipts only.
```

The existing `sfn` command center now makes the single-case proof repeatable and the full run shardable:

```bash
npm run sfn -- noderoom run-fresh-room --case FR-020 --headed --task-id btb-707cba99
npm run sfn -- proof verify --case FR-020
npm run sfn -- noderoom watch --case FR-020
npm run sfn -- noderoom btb-status
npm run sfn -- noderoom btb-matrix --limit 5 --dry-run
npm run sfn -- noderoom run-btb-matrix --shard 1/4 --headed --max-parallel 1 --continue-on-fail
```

Full-BTB status must remain **partial** until every selected official task has a fresh-room receipt and verifier row.

Current matrix status from `npm run sfn -- noderoom btb-status`:

```text
official-shaped tasks visible locally: 100
fresh-room chat tasks proven: 1
missing receipts: 99
full BTB claim: not ready
ledger: docs/eval/fresh-room/FR-020/matrix-ledger.json
```

Matrix task receipts are written under:

```text
docs/eval/fresh-room/FR-020/tasks/<task-id>/latest.json
docs/eval/bankertoolbench/live-room/<task-id>.json
test-results/bankertoolbench/matrix/<task-id>/package-manifest.json
```
