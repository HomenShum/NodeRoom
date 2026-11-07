# NodeAgent Review Alignment

Date: 2026-06-14

The `6-14-2026-deep-review.txt` architecture (removed from the tree; read it at
commit `6f1af0f7`) expected a signature engine under
`src/nodeagent/**`. The product runtime already existed under `src/nodeagent`,
`src/engine`, `src/shared`, and `convex`, so the alignment layer now exposes the
reviewed structure without forking the runtime.

## Source Tree Contract

`src/nodeagent/core/*` maps to the real runtime surfaces:

- `contextCompactor.ts`: message compaction re-export.
- `worldModel.ts`: context-builder selection for room, research, note, and wall surfaces.
- `formulaEngine.ts`: formula parser/evaluator re-export.

`src/nodeagent/skills/*` maps to product workflow helpers:

- `finance/*`: bulk company ingest, runway forecasting, credit ratios.
- `search/*`: bounded `fetch_source`.
- `spreadsheet/*`: CAS cell mutation, semantic rebase, and algorithm artifacts.
- `integration/*`: NodeRoom adapter and downstream publish draft helpers.

The review-named `orchestrator.ts`, `adaptiveRouter.ts` and `stateBridge.ts`
core modules, the `components/*` UI stubs, and the Linkup, milestone and
version-control skill stubs were removed on 2026-10-29: nothing in the live
runtime called them. The production room UI lives under `src/ui`.

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

- `tests/nodeagentCompatibility.test.ts`
- `tests/nodeagentAlignment.test.ts`

