# NodeAgent Review Alignment

Date: 2026-06-14

The `6-14-2026-deep-review.txt` architecture (removed from the tree; read it at
commit `6f1af0f7`) expected a signature engine under
`src/nodeagent/**`. The product runtime already existed under `src/nodeagent`,
`src/engine`, `src/shared`, and `convex`, so the alignment layer now exposes the
reviewed structure without forking the runtime.

## Source Tree Contract

`src/nodeagent/core/*` maps to the real runtime surfaces:

- `orchestrator.ts`: Convex job routing and bulk batch splitting.
- `adaptiveRouter.ts`: task/risk/latency model route decisions.
- `contextCompactor.ts`: message compaction re-export.
- `worldModel.ts`: context-builder selection for room, research, note, and wall surfaces.
- `formulaEngine.ts`: formula parser/evaluator re-export.
- `stateBridge.ts`: Pi-style lifecycle event to Convex mutation/event conversion.

`src/nodeagent/skills/*` maps to product workflow helpers:

- `finance/*`: bulk company ingest, runway forecasting, milestone planning.
- `search/*`: Linkup-compatible search interface with bounded `fetch_source` fallback.
- `spreadsheet/*`: CAS cell mutation, semantic rebase, and version reads.
- `integration/*`: NodeRoom adapter and downstream publish draft helpers.

`src/nodeagent/components/*` provides review-named UI components for future
composition while the production room UI continues to live under `src/ui`.

## Convex Ledger Alignment

The schema now includes the review-named tables as first-class ledgers:

- `toolEvents`
- `cellVersions`
- `sourceRefs`
- `linkupLogs`
- `financialData`
- `semanticConflicts`
- `downstreamPublishes`

The existing runtime tables remain the source of truth for active execution:
`agentJobs`, `agentRuns`, `agentSteps`, `agentOperationEvents`,
`agentMutationReceipts`, `artifacts`, `elements`, `locks`, `drafts`, and
`proposals`.

## Product Surface

The finance research UI now exposes ready-to-export downstream drafts from the
research artifact, and Copilot includes a persistent handoff strip for Gmail,
Notion, Slack, Linear, and CRM CSV draft targets. These are draft/export surfaces;
external provider writes should still go through approval-gated adapters.

## Verification

The alignment is covered by:

- `tests/nodeagentStructure.test.ts`
- `tests/nodeagentCompatibility.test.ts`
- `tests/nodeagentAlignment.test.ts`

