# Next Steps Priority

Last updated: 2026-06-16

This is the working priority order after the June 2026 benchmark and Semantic
Rebase review. The principle is simple: prove deterministic benchmark and safety
contracts before spending on broad live model runs.

## Current Goal

Make NodeRoom credible as a production agent harness for spreadsheet, banker,
GTM, and multi-user collaboration workflows by closing the gaps that are both
high-risk and testable:

1. Official benchmark task coverage.
2. BankerToolBench / SpreadsheetBench verifier parity.
3. Semantic no-clobber behavior above CAS.
4. Provider-route promotion using N=5 and p95, not single lucky runs.
5. UI/workplan surfaces that make the ledger legible to target users.
6. Live frame-claimed multi-slice evidence so recursive context is proven under
   deployed provider/runtime conditions, not only deterministic tests.

## P0 Sequence

1. **Finish official full-task staging.**
   Lock/download the full SpreadsheetBench V1 912, SpreadsheetBench V2 321, and
   BankerToolBench 100-task bundles. Stage every task with agent/evaluator
   isolation before claiming full coverage.

2. **Wire real BankerToolBench verifier replay.**
   The local runner proves package shape and weighted-rubric smoke behavior.
   Official readiness still needs Harbor/Docker/MCP/Gandalf provenance and
   score import.

3. **Promote SpreadsheetBench scoring parity before more model spend.**
   Finish official scoring parity, chart/VLM grading, static workbook scoring,
   formula/format policy, and contamination gates over the staged bundles.

4. **Add CRS runtime triggers after the policy scaffold.**
   The pure classifier exists. Next, trigger it from stale algorithm patch
   bundles, draft conflicts, and proposal approval CAS conflicts. Final writes
   must still go through managed lock/CAS.

5. **Run chunked live evidence only after deterministic gates pass.**
   Expand model-run evidence from N=5 smoke to larger held-out chunks, starting
   with verified SpreadsheetBench V1 tasks and only then broader OpenRouter
   routes.

## P1 Sequence

1. **Deal workplan UI.**
   Make `agentJobs`, reasoning frames, entity/facet work items, traces, sources,
   review rounds, and deliverables readable to a banker/GTM user without opening
   logs.

2. **Top paid OpenRouter calibration.**
   Run N=5/p95 promotion for a short list of eligible routes first, then widen
   to the paid route set. Do not promote a route from N=1.

3. **Semantic conflict review UI.**
   Extend proposals to show base/current/proposed, evidence, dependency impact,
   validator results, and why the resolution is safe or blocked.

4. **Production file parser lane.**
   Keep Convex file storage canonical. Provider file ids stay cache metadata.
   Local/OCR parsing is still needed for private and reproducible workflows
   even if Gemini/OpenAI/Claude can read files.

5. **Frame-level operations hardening.**
   Room-work admission materializes durable frames/cache/work items and the
   durable runner claims one runnable frame per slice. Next, add frame-level
   retry/cancel controls, live tiny-budget resume proof, and route/provider
   evidence.

## What Not To Claim Yet

- Full official BankerToolBench or SpreadsheetBench readiness.
- Full Semantic Rebase runtime.
- Every fast inline/private `/ask` path running through frame-claimed execution.
- Atomic multi-cell semantic commit.
- Provider route superiority from N=1 runs.
- Private-file-safe provider parsing for all document types.
- Production-scale multi-user proof beyond the checked deterministic and live
  smokes already recorded in the eval docs.

## Why This Order

Official benchmark staging and verifier parity are cheaper and more reliable
than live model sweeps. CRS policy protects the exact user pain that CAS alone
cannot answer: what should happen when two edits are both valid but represent
different business intent. Once those deterministic contracts are tight, live
OpenRouter route evaluation becomes meaningful because every run is measured
against the same isolated task, tool policy, validator, budget, and trace.
