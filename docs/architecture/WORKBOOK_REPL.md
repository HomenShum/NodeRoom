# Governed workbook session

NodeRoom's workbook session is a bounded patch workflow, not a general-purpose
REPL. It gives a durable NodeAgent job enough state to inspect and update one
sheet while preserving the room's lock, CAS, proposal, trace, and receipt
contracts.

## Contract

The server-only `workbook_session` tool supports five actions:

| Action | Behavior |
| --- | --- |
| `read` | Read one A1 range of at most 256 cells. |
| `stage` | Persist up to 64 unique A1 scalar/formula patches. |
| `preview` | Compare staged values and base versions with current cells. |
| `publish` | Recheck versions, acquire one managed lock, then call canonical `RoomTools.editCell` for each patch. |
| `discard` | Reject all pending patches without touching workbook cells. |

The session identity is always the durable `jobId` plus that job's primary
`artifactId`. The model cannot supply a room, job, artifact, database row, or
storage identifier. Every mutating command requires a nonnegative
`expectedRevision` and a stable `commandId`.

## Governance

Publishing does not create a new write path. `ConvexRoomTools` routes each cell
through `artifacts.applyAgentCellEdit`, which provides:

- exact-range managed locks;
- per-cell base-version CAS;
- room write-policy checks;
- host-review proposals when `autoAllow` is false;
- mutation receipts and trace provenance for applied writes;
- the existing proposal accept/reject path for proposed writes.

Publish is deliberately not described as atomic. The session records an
outcome for every attempted cell: `applied`, `proposed`, `needs_rebase`,
`locked`, or `error`. A preflight conflict prevents new writes. A failure after
one or more writes marks the staged batch `needs_rebase` so a later run cannot
claim that the whole patch landed.

## Persistence and recovery

`agentWorkbookSessions` owns the revision and active/publishing state.
`agentDraftOperations` stores command ids, staged operations, base versions,
progress, final outcomes, and resolution status. Repeating a command id returns
its recorded result. Reusing one command id for a different action is rejected.

An interrupted publish can resume the same prepared command. Recorded cell
outcomes are skipped, current versions are checked again, and the remaining
cells are processed. Lock denial leaves the stage pending and advances the
session revision with an honest retryable result.

## Security boundary

The tool accepts only finite numbers, strings, booleans, null, and formulas
supported by NodeRoom's formula parser. It has no arbitrary JavaScript or
Python evaluation, SQL, imports, packages, shell, filesystem, network, raw
Convex access, or cross-artifact addressing. Formula and string lengths,
command ids, reasons, ranges, and operation counts are bounded before durable
storage.

The browser and in-memory demo ports do not implement this capability. They
return `workbook_session_unavailable` instead of simulating a successful live
write.

## Proof commands

```bash
npm test -- --run tests/workbookSession.test.ts tests/convexCredits.test.ts tests/agentJobsRuntime.test.ts
npm test -- --run tests/harnessChangeEval.test.ts tests/nodeagentProviderToolSchema.test.ts
npm run typecheck -- --pretty false
npx tsc -p convex/tsconfig.json --noEmit --pretty false
```

Deployed launch proof must still cover an authenticated review-mode room:
stage, preview, publish to proposal, host accept and reject, trace/receipt,
reload persistence, and workbook export/reopen. Local unit proof is not a
substitute for that browser receipt.
