# Rework Ledger

This ledger keeps the lesson when an approach is replaced. Code can be deleted; the failure proof and replacement rationale should not disappear.

Source of truth: `docs/rework/rework-ledger.json`.

## Current Entries

| ID | Old Approach | What Failed | New Approach | Proof |
|---|---|---|---|---|
| `RW-001` | Empty or incomplete provider tool schemas | Fresh-room tool calls missed required args | Provider schema parity against canonical Zod surface | `tests/nodeagentProviderToolSchema.test.ts` |
| `RW-002` | Free-route file context without promotion | Uploaded-file tasks hit file-egress policy blocks | Keep egress guard, promote to file-egress-safe model | `tests/agentJobsRuntime.test.ts` |
| `RW-003` | Benchmark runs used normal small caps | Official tasks paused before capability/cost data was gathered | `benchmark_completion` runtime profile | `e2e/benchmark-ui-spreadsheetbench.spec.ts` |
| `RW-004` | Separate false Excel-paper workbook UI | Uploaded workbooks diverged from Sheet 1 and showed misleading chrome | Shared `r-sheet` work-surface grid | `e2e/excel-grid.spec.ts` |
| `RW-005` | Unclassified invalid tool arguments | Missing args looked like generic tool failure | Structured `tool_argument_error` with recovery path | `tests/agentStreamParts.test.ts` |
| `RW-006` | One-off SpreadsheetBench proof receipt | Could not scale across fresh-room matrix gates | `docs/eval/fresh-room/<case-id>/latest.json` receipts | `tests/freshRoomProofReceipts.test.ts` |
