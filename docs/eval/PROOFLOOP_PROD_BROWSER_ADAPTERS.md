# ProofLoop Prod Browser Adapter Ledger

Generated: 2026-07-05T05:39:50.972Z
Harness version: `prod-browser-adapters-2026-07-05.1`

This ledger turns the missing prod-browser families into versioned adapter contracts. A contract is not a pass: families remain blocked until the named browser scenario exists and produces receipts.

## Summary

- Adapters tracked: 6
- Contracts scaffolded: 6
- Browser scenarios still missing: 6
- Task targets covered by contracts: 1251
- Model-task attempts covered by contracts: 5004

## Adapters

| Adapter | Family | Version | Tasks | Attempts | Contract | Browser scenario | Command shape |
|---|---|---:|---:|---:|---|---|---|
| `spreadsheetbench-v1-official-workbook-prod-browser` | `spreadsheetbench-v1-full-912` | 0.1.0 | 912 | 3648 | contract_scaffolded | missing | `npm run proofloop:live:spreadsheetbench-v1 -- --prod --task-id <taskId> --model <modelId> --real-user` |
| `spreadsheetbench-v2-workflow-chart-prod-browser` | `spreadsheetbench-v2-full-321` | 0.1.0 | 321 | 1284 | contract_scaffolded | missing | `npm run proofloop:live:spreadsheetbench-v2 -- --prod --task-id <taskId> --model <modelId> --real-user` |
| `accounting-live-config-to-prod-browser-room` | `accounting-live-proofloop` | 0.1.0 | 4 | 16 | contract_scaffolded | missing | `npm run proofloop:live:accounting:browser -- --prod --task-id <taskId> --model <modelId> --real-user` |
| `notion-live-config-to-prod-browser-room` | `notion-live-proofloop` | 0.1.0 | 4 | 16 | contract_scaffolded | missing | `npm run proofloop:live:notion:browser -- --prod --task-id <taskId> --model <modelId> --real-user` |
| `proximitty-underwriting-prod-browser-room` | `proximitty-underwriting-pr0` | 0.1.0 | 4 | 16 | contract_scaffolded | missing | `npm run proofloop:proximitty:browser -- --prod --scenario <taskId> --model <modelId> --real-user` |
| `noderoom-multi-user-conflict-prod-browser-room` | `noderoom-multi-user-conflict` | 0.1.0 | 6 | 24 | contract_scaffolded | missing | `npm run proofloop:live:multi-user-conflict -- --prod --task-id <taskId> --model <modelId> --real-user` |

## Blockers

- `spreadsheetbench-v1-official-workbook-prod-browser`: Implement generic task selection, official workbook upload, agent edit, workbook export/download, and official scorer handoff for every staged V1 task.
- `spreadsheetbench-v2-workflow-chart-prod-browser`: Implement generic V2 task selection, workbook/chart import, agent repair, workbook export, chart render capture, and official/static scorer handoff.
- `accounting-live-config-to-prod-browser-room`: Convert the current Convex HTTP live runner into a fresh-room browser scenario with model selection, trace receipts, and memory mode off.
- `notion-live-config-to-prod-browser-room`: Convert the current Convex HTTP live runner into a fresh-room browser scenario with model selection, trace receipts, and memory mode off.
- `proximitty-underwriting-prod-browser-room`: Promote deterministic underwriting scenarios into documents-in, decision-memo-out fresh-room browser tasks with verifier receipts.
- `noderoom-multi-user-conflict-prod-browser-room`: Promote deterministic multi-user conflict fixtures into two-browser prod room scenarios with trace and mutation receipts.

