# Official Benchmark UI Coverage

Generated: 2026-07-05T01:18:55.574Z

This ledger answers the live-browser question directly: has NodeRoom driven official benchmark tasks through a fresh room, public @nodeagent chat, UI upload/export, downloaded artifacts, and scorer/verifier handoff?

## Summary

- Tracks covered: 2/3
- Tracks partial: 0/3
- Tracks missing: 1/3
- Required deliverable kinds: `document`, `pdf`, `presentation`, `workbook`
- Live browser fresh-room ready: no

## Policy

- A screenshot or memory-mode run is not enough for benchmark UI proof.
- Every benchmark UI run must start from a fresh live room and use the public @nodeagent lane.
- Every expected deliverable type must be exported/downloaded from the browser, reopened from disk, and passed to the benchmark scorer or verifier.
- SpreadsheetBench requires workbook export/reopen/scoring; BankerToolBench requires Excel, PowerPoint, Word, and PDF package handling.
- Runner-only evidence is useful plumbing, but it does not satisfy live-browser fresh-room coverage.

## Deliverable Types

| Kind | Label | Extensions | Required For | Validation |
|---|---|---|---|---|
| `workbook` | Excel workbook | `.xlsx`, `.xlsm` | `bankertoolbench`, `spreadsheetbench-v1`, `spreadsheetbench-v2` | download candidate workbook from the room; reopen workbook from disk; run workbook scorer, formula recompute, and format diff where applicable |
| `presentation` | PowerPoint deck | `.pptx` | `bankertoolbench` | download candidate deck from the room; reopen deck package; hand candidate deck to the BankerToolBench verifier |
| `document` | Word document | `.docx` | `bankertoolbench` | download candidate memo from the room; reopen document package; hand candidate memo to the BankerToolBench verifier |
| `pdf` | PDF | `.pdf` | `bankertoolbench` | download candidate PDF from the room; render or parse the PDF; hand candidate PDF to the BankerToolBench verifier |
| `csv` | CSV/table export | `.csv` | optional | download candidate CSV when a task requests table export; parse rows and columns; compare against task-specific scorer policy |
| `image` | Image/asset export | `.png`, `.jpg`, `.jpeg` | optional | download or inspect image assets when a task produces them; verify non-empty dimensions; include assets in verifier package manifests |

## UI Gates

- `fresh_room_join`: Create or join a fresh live room through the browser UI
- `official_fixture_upload`: Upload official benchmark input files through the UI
- `public_nodeagent_invocation`: Send the official instruction through public @nodeagent chat
- `visible_streaming_progress`: Show visible agent progress or streamed text while work runs
- `deliverable_export_download`: Export or download every expected deliverable type from the UI
- `artifact_reopen_validation`: Reopen downloaded artifacts from disk before scoring
- `official_scorer_handoff`: Hand artifacts to the official or benchmark-faithful scorer
- `trace_video_artifacts`: Persist trace, screenshot, and video evidence for each run
- `no_memory_mode_shortcut`: Do not use memory-mode demo seeds for benchmark claims

## Tracks

| Track | Status | Required Deliverables | Live-Browser Deliverables | Required Spec | Blockers |
|---|---:|---|---|---|---|
| `bankertoolbench` | covered | `workbook`, `presentation`, `document`, `pdf` | `workbook`, `presentation`, `document`, `pdf` | `e2e/benchmark-ui-bankertoolbench.spec.ts` | Live-browser fresh-room BTB run PASSED for task 0fc7bc3c-a111-4222-8333-444455556666 with .xlsx, .xlsm, .pptx, .docx, .pdf downloaded and reopened; proof: docs/eval/fresh-room/FR-020/latest.json; Gemini visual judge not run: GOOGLE_GENERATIVE_AI_API_KEY is not set; deterministic browser/download/reopen/verifier proof passed |
| `spreadsheetbench-v1` | covered | `workbook` | `workbook` | `e2e/benchmark-ui-spreadsheetbench.spec.ts` | Live-browser fresh-room run PASSED via file-export grading (gradeGolden score 1, 5/5 cells, 0 fabrications); proof: docs/eval/spreadsheetbench-live-room-proof.json |
| `spreadsheetbench-v2` | missing | `workbook` | none | `e2e/benchmark-ui-spreadsheetbench.spec.ts` | No fresh live room V2 workflow uploads official workbooks and exports the edited workbook package from the browser; Rendered chart screenshots and VLM/chart grading are not attached to a browser-run artifact package; Missing live-browser fresh-room proof for deliverables: workbook (no sheet->.xlsx export in the live room) |

### BankerToolBench live browser deliverable package

- Current evidence: `src/eval/bankerToolBenchRunner.ts`, `src/eval/bankerToolBenchNodeAgentGeneral.ts`, `tests/bankerToolBenchRunner.test.ts`, `tests/bankerToolBenchNodeAgentGeneral.test.ts`, `docs/qa/browser-e2e-flow-inventory.json`, `e2e/benchmark-ui-bankertoolbench.spec.ts`, `docs/eval/fresh-room/FR-020/latest.json`, `docs/eval/bankertoolbench-live-room-proof.json`, `test-results/bankertoolbench/package-manifest.json`
- Missing deliverables: none

| Gate | Status | Evidence / blocker |
|---|---:|---|
| `fresh_room_join` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB)` |
| `official_fixture_upload` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB)` |
| `public_nodeagent_invocation` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB)` |
| `visible_streaming_progress` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB); model z-ai/glm-5.2; runtime benchmark_completion; job detail visible; room trace visible; agent live loop proven` |
| `deliverable_export_download` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB); downloaded .xlsx, .xlsm, .pptx, .docx, .pdf` |
| `artifact_reopen_validation` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB); reopened OOXML/PDF package files before scoring` |
| `official_scorer_handoff` | covered | `BankerToolBench proof verifier (npm run benchmark:bankertoolbench:proof)` |
| `trace_video_artifacts` | covered | `docs/eval/bankertoolbench-live-room-proof.json` |
| `no_memory_mode_shortcut` | covered | `e2e/benchmark-ui-bankertoolbench.spec.ts (proof: docs/eval/fresh-room/FR-020/latest.json, room NRJNGW6LELB)` |

### SpreadsheetBench V1 live browser workbook run

- Current evidence: `tests/ui-benchmark-drive.spec.ts`, `src/eval/spreadsheetBenchRunner.ts`, `src/eval/spreadsheetBenchScorer.ts`, `docs/qa/browser-e2e-flow-inventory.json`, `e2e/benchmark-ui-spreadsheetbench.spec.ts`, `docs/eval/spreadsheetbench-live-room-proof.json`
- Missing deliverables: none

| Gate | Status | Evidence / blocker |
|---|---:|---|
| `fresh_room_join` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: docs/eval/spreadsheetbench-live-room-proof.json, score 1)` |
| `official_fixture_upload` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: docs/eval/spreadsheetbench-live-room-proof.json, score 1)` |
| `public_nodeagent_invocation` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: docs/eval/spreadsheetbench-live-room-proof.json, score 1)` |
| `visible_streaming_progress` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: docs/eval/spreadsheetbench-live-room-proof.json, score 1)` |
| `deliverable_export_download` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (download: Sheet_1.xlsx, 6501 bytes, magic PK)` |
| `artifact_reopen_validation` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (reopened workbook: pass, 5/5)` |
| `official_scorer_handoff` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: docs/eval/spreadsheetbench-live-room-proof.json, score 1)` |
| `trace_video_artifacts` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (attached graded-sheet screenshot)` |
| `no_memory_mode_shortcut` | covered | `e2e/benchmark-ui-spreadsheetbench.spec.ts (proof: docs/eval/spreadsheetbench-live-room-proof.json, score 1)` |

### SpreadsheetBench 2 live browser workbook and chart workflow

- Current evidence: `tests/ui-benchmark-drive.spec.ts`, `src/eval/spreadsheetBenchRunner.ts`, `src/eval/spreadsheetBenchChartVisualProbe.ts`, `docs/qa/browser-e2e-flow-inventory.json`
- Missing deliverables: `workbook`

| Gate | Status | Evidence / blocker |
|---|---:|---|
| `fresh_room_join` | missing | e2e/benchmark-ui-spreadsheetbench.spec.ts is not implemented for spreadsheetbench-v2. |
| `official_fixture_upload` | missing | e2e/benchmark-ui-spreadsheetbench.spec.ts is not implemented for spreadsheetbench-v2. |
| `public_nodeagent_invocation` | partial | `tests/ui-benchmark-drive.spec.ts` |
| `visible_streaming_progress` | missing | e2e/benchmark-ui-spreadsheetbench.spec.ts is not implemented for spreadsheetbench-v2. |
| `deliverable_export_download` | missing | e2e/benchmark-ui-spreadsheetbench.spec.ts cannot download a workbook: the live desktop room has no sheet->.xlsx export. |
| `artifact_reopen_validation` | missing | e2e/benchmark-ui-spreadsheetbench.spec.ts has no exported file to reopen from disk; grading is cell-read. |
| `official_scorer_handoff` | missing | e2e/benchmark-ui-spreadsheetbench.spec.ts is not implemented for spreadsheetbench-v2. |
| `trace_video_artifacts` | partial | `playwright.config.ts` |
| `no_memory_mode_shortcut` | partial | Spec exists but still needs proof that it never uses ?mode=memory. |
