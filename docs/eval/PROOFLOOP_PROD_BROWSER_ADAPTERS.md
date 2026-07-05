# ProofLoop Prod Browser Adapter Ledger

Generated: 2026-07-05T07:41:37.109Z
Harness version: `prod-browser-adapters-2026-07-05.3`

This ledger turns the missing prod-browser families into versioned adapter contracts. A contract is not a pass: families remain blocked until the named browser scenario exists and produces receipts.

## Summary

- Adapters tracked: 6
- Contracts scaffolded: 2
- Browser scenarios still missing: 2
- Task targets covered by contracts: 1251
- Model-task attempts covered by contracts: 5004

## Adapters

| Adapter | Family | Version | Tasks | Attempts | Contract | Browser scenario | Command shape |
|---|---|---:|---:|---:|---|---|---|
| `spreadsheetbench-v1-official-workbook-prod-browser` | `spreadsheetbench-v1-full-912` | 0.2.0 | 912 | 3648 | browser_scenario_ready | ready | `SPREADSHEETBENCH_TASK_ID=<taskId> BENCH_AGENT_MODEL_POLICY=<modelId> npm run proofloop:live:spreadsheetbench-v1` |
| `spreadsheetbench-v2-workflow-chart-prod-browser` | `spreadsheetbench-v2-full-321` | 0.2.0 | 321 | 1284 | browser_scenario_ready | ready | `SPREADSHEETBENCH_TASK_ID=<taskId> BENCH_AGENT_MODEL_POLICY=<modelId> npm run proofloop:live:spreadsheetbench-v2` |
| `accounting-live-config-to-prod-browser-room` | `accounting-live-proofloop` | 0.2.0 | 4 | 16 | browser_scenario_ready | ready | `npm run proofloop:live:accounting:browser -- --prod --task-id <taskId> --model <modelId> --real-user` |
| `notion-live-config-to-prod-browser-room` | `notion-live-proofloop` | 0.2.0 | 4 | 16 | browser_scenario_ready | ready | `npm run proofloop:live:notion:browser -- --prod --task-id <taskId> --model <modelId> --real-user` |
| `proximitty-underwriting-prod-browser-room` | `proximitty-underwriting-pr0` | 0.1.0 | 4 | 16 | contract_scaffolded | missing | `npm run proofloop:proximitty:browser -- --prod --scenario <taskId> --model <modelId> --real-user` |
| `noderoom-multi-user-conflict-prod-browser-room` | `noderoom-multi-user-conflict` | 0.1.0 | 6 | 24 | contract_scaffolded | missing | `npm run proofloop:live:multi-user-conflict -- --prod --task-id <taskId> --model <modelId> --real-user` |

## Blockers

- `spreadsheetbench-v1-official-workbook-prod-browser`: No passing prod receipts are recorded for every staged V1 task/model yet; run the long-run queue to replace this with score evidence.
- `spreadsheetbench-v2-workflow-chart-prod-browser`: No passing prod receipts are recorded for every staged V2 task/model yet; run the long-run queue to replace this with score evidence.
- `accounting-live-config-to-prod-browser-room`: No passing prod receipts are recorded for every accounting task/model yet; run the long-run queue to replace this with score evidence.
- `notion-live-config-to-prod-browser-room`: No passing prod receipts are recorded for every Notion task/model yet; run the long-run queue to replace this with score evidence.
- `proximitty-underwriting-prod-browser-room`: Promote deterministic underwriting scenarios into documents-in, decision-memo-out fresh-room browser tasks with verifier receipts.
- `noderoom-multi-user-conflict-prod-browser-room`: Promote deterministic multi-user conflict fixtures into two-browser prod room scenarios with trace and mutation receipts.

