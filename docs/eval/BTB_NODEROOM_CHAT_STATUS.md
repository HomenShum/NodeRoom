# BankerToolBench NodeRoom Chat Status

Current claim:

```text
One BankerToolBench task has receipt-backed proof through the real NodeRoom fresh-room public @nodeagent chat path.
The full BankerToolBench 100-task benchmark is not yet proven through NodeRoom chat.
```

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
