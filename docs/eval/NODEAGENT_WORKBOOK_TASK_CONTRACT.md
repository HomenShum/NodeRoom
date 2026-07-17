# NodeAgent Workbook Task Contract

Captured: 2026-07-10

## Purpose

NodeAgent must behave like a careful workbook operator in NodeRoom, not like a
single-shot JSON generator. The same task loop must be observable in the live
room and testable against SpreadsheetBench-shaped held-out failures.

The certification loop remains locked. This contract changes agent and product
behavior only; it does not expose evaluator workbooks, weaken scorers, or lower
pass thresholds.

## Baseline Evidence

- SpreadsheetBench V1 model run: 89/912 exact passes, 0.335084 mean score.
- SpreadsheetBench V2 model run: 0/321 exact passes, 0.523337 mean score.
- V1 emitted no operation for 598/912 tasks.
- V2 emitted no operation for 289/321 tasks.
- The recorded full runs used four-task batches with a 12-cell, 96-character
  workbook snapshot. Large multi-sheet tasks therefore exposed roughly one
  early cell per sheet instead of the cells named by the task or anomalous
  formula regions.
- Candidate generation performed one snapshot, one model plan, one apply, and
  one hidden score. It had no agent-visible verification or repair pass.

## Failure Taxonomy

| Failure | Observable symptom | Required behavior |
|---|---|---|
| Context starvation | Named targets and their neighboring formulas are absent from the prompt | Rank task-referenced cells, ranges, formula cells, and anomalies ahead of generic samples |
| Target ambiguity | The model edits an input cell instead of the formula cell that consumes it | Separate target candidates from dependency/source references and show local neighbors |
| Empty or truncated plan | A mutating task produces zero operations or an incomplete batch object | Treat unjustified emptiness as a verification finding and run a bounded repair pass |
| Formula drift | Formula text is malformed, self-referential, or replaces a valid formula with a scalar | Normalize formula payloads, protect formulas, detect bad references/cycles, and verify the written formula |
| Unsupported workbook work | Broad format, chart, macro, or structural work is silently ignored | Report the unsupported surface honestly; never claim the workbook is repaired |
| No post-write proof | A candidate is emitted without checking the intended targets | Re-open/read changed cells and produce a verification receipt before completion |
| No repair feedback | A bad plan is scored but the model never sees actionable findings | Feed bounded, agent-visible findings into one repair attempt and verify again |
| UI dead end | Home says "Send to NodeAgent" but only copies text into chat | Submit a real room-agent job, preserve the active workbook context, and show progress/error state |

## Required Execution Loop

1. **Plan**: restate the requested outcome, identify target cells/ranges,
   dependencies, mutation scope, and completion checks.
2. **Inspect**: discover the workbook artifact; rank explicit references,
   neighboring cells, existing formulas, error values, hardcodes inside formula
   bands, and blank gaps inside formula bands.
3. **Generate**: produce explicit, bounded edits. Formula outputs must retain
   formula text and a deterministic cached value when the supported local
   evaluator can compute one.
4. **Preflight**: reject missing sheets, invalid cells, destructive
   formula-to-scalar overwrites, `#REF!`, obvious self-reference, and unjustified
   empty plans before mutation.
5. **Apply**: use NodeRoom managed locks and CAS writes. Review-mode proposals
   are successful pending work, not failures to retry.
6. **Verify**: re-read every changed target, compare expected value/formula,
   confirm formula preservation, and write a machine-readable receipt.
7. **Repair**: when verification finds an actionable issue, make at most one
   bounded repair attempt by default, then verify again. Never loop unchanged
   edits or weaken the verifier.
8. **Report**: state changed targets, verification status, proposals awaiting
   approval, and unresolved unsupported work.

## UI Contract

- A fresh user can start a workbook audit from Room Home without learning a
  command prefix.
- The Home command action starts the job; it does not merely copy text into the
  chat composer.
- The active or first workbook is attached as context.
- Chat names the plan, workbook inspection, write, verification, and repair
  steps in plain language.
- Running, completed, needs-repair, pending-approval, and failed states remain
  distinguishable.
- A successful final message names the changed cells and verification result.
- Unsupported chart, macro, and full-format repairs remain explicit gaps.

## Completion Evidence

- Pure tests for task-reference extraction, anomaly ranking, preflight checks,
  write verification, and bounded repair.
- SpreadsheetBench runner fixtures proving a starved snapshot now contains the
  named target and that an initially wrong plan is repaired without evaluator
  access.
- NodeAgent tool tests proving inspect and verify work through `RoomTools`.
- A fresh-user browser run from landing to a completed, verified workbook task.
- Focused and full typecheck/test/build gates plus the unchanged ProofLoop gate.

