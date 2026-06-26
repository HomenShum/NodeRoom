# NodeRoom Current State

Generated: 2026-06-26T10:05:00Z (updated after Phase 3-6)
Branch: `feat/attention-overlay` (merged with `origin/main`)
Commit: `b576bc09`

## Test Suite

- **180 test files, 1031 tests, 0 failures**
- Typecheck: clean
- Build: clean (`npm run build` exit 0)

## Fresh-Room Proof Receipts

| Case | Benchmark | Status | Evidence |
|---|---|---|---|
| FR-010 | spreadsheetbench-v1 | PASS | `docs/eval/fresh-room/FR-010/latest.json` — score 1, 5/5 cells, 0 fabrications, durable evidence paths |
| FR-020 | bankertoolbench | PASS (1/100 tasks) | `docs/eval/fresh-room/FR-020/latest.json` — task a31173e3 passed with .xlsx/.xlsm/.pptx/.docx/.pdf downloaded and reopened |
| FR-040 | collaboration | SPEC CREATED | `e2e/human-agent-concurrency.spec.ts` — two browser contexts, CAS concurrency proof, writes receipt to `docs/eval/fresh-room/FR-040/latest.json` |
| FR-030 | spreadsheetbench-v2 | SPEC CREATED | `e2e/benchmark-ui-spreadsheetbench-v2.spec.ts` — debugging task, chart grading, writes receipt to `docs/eval/fresh-room/FR-030/latest.json` |

## FR-020 Matrix Ledger

- **Total tasks**: 100
- **Proven**: 1 (task a31173e3)
- **Failed**: 99 — **ALL failures are stale evidence path failures**, not runtime failures
  - Per-task receipts point to `C:\Users\hshum\.codex\worktrees\b349\noderoom\test-results\...` (transient paths from a different machine)
  - The latest.json (a31173e3) has durable paths under `docs/eval/fresh-room/FR-020/tasks/...`
  - **Root cause**: BTB matrix was run on a Codex worktree; per-task receipts were written with absolute transient paths instead of durable `docs/eval/` paths
  - **Fix applied**: `existingPath()` in `freshRoomProofReceipts.ts` now tries relative resolution for absolute paths from other machines (extracts project-relative portion after `noderoom/` or `test-results/` markers). This makes the validator portable. The 99 stale receipts still fail honestly because the evidence files were never copied to durable paths.
  - **Fix needed**: Patch BTB e2e spec to copy evidence into `docs/eval/fresh-room/FR-020/tasks/<task-id>/evidence/` and update receipt paths

## Official Benchmark UI Coverage

- **Tracks covered**: 2/3 (bankertoolbench, spreadsheetbench-v1)
- **Tracks missing**: 1/3 (spreadsheetbench-v2)
- **Live browser fresh-room ready**: no (V2 missing)

### SpreadsheetBench V2 Status
- **Adapter**: `scanV2` in `spreadsheetBenchAdapter.ts` — implemented, parses category-scoped dataset.json
- **Runner**: `spreadsheetBenchRunner.ts` — has `copy-input-baseline` mode, missing live-browser proof
- **E2e spec**: `e2e/benchmark-ui-spreadsheetbench.spec.ts` (V1) + `e2e/benchmark-ui-spreadsheetbench-v2.spec.ts` (V2 — created this session)
- **Chart visual grading**: `chart_visual_grade` capability is `implemented` per readiness doc (probe exists)
- **Blockers**: V2 e2e spec created but not yet run against live Convex (needs `BENCH_BASE_URL`); chart screenshot/VLM attachment to browser-run artifact still needed

## Official Benchmark Readiness

- **Ready**: 0/3
- **Blocked**: 3/3

### Shared blockers across all 3 benchmarks:
1. `live_browser_fresh_room_e2e` — partial (V1 and BTB have proofs, V2 missing)
2. `official_gold_isolation` — partial (staging exists, Docker/Harbor isolation missing)
3. `official_runner_adapter` — partial (runners exist, V2 agent mode and Harbor execution missing)

### Per-benchmark missing capabilities:
- **BTB**: `mcp_financial_tools` (external), `pptx_docx_pdf_outputs` (partial), `rubric_weighted_scoring` (partial)
- **SpreadsheetBench V1**: `format_diff` (partial), `formula_recompute` (partial)
- **SpreadsheetBench V2**: `format_diff` (partial), `formula_recompute` (partial), `chart_visual_grade` (implemented)

## Human-Agent Concurrency

- **Deterministic proof**: 6/6 scenarios pass (`docs/eval/multi-user-coordination-proof.json`)
- **Live browser proof**: SPEC CREATED — `e2e/human-agent-concurrency.spec.ts` uses two browser contexts for CAS concurrency proof. Not yet run against live Convex.
- **CAS engine**: Working correctly (range locks, stale versions, smart-merge, lock release)

## UX Blockers (from prior dogfood)

1. **Runway/milestones sheet**: Previously crashed on malformed columns — FIXED with defensive guards
2. **Sheet horizontal scroll**: Previously columns were hidden — FIXED with `overflow: auto` + `table-layout: fixed`
3. **Wall as default**: Previously notes opened first — FIXED with `preferredRoomArtifact` prioritizing wall
4. **Wall inventory**: Previously raw note board — REDESIGNED as game-like inventory with clusters
5. **Active tab clarity**: Still subtle — needs stronger active/inactive visual hierarchy
6. **Right chat rail empty state**: FIXED — contextual prompts and empty state hints now respond to active artifact (Level 0 fix in `Chat.tsx`)
7. **Bottom trace/status footer**: Dense but readable — minor polish needed

## Uncommitted Generated Docs

- `docs/qa/BENCHMARK_PROOF_LEDGER.md` (new)
- `docs/qa/CURRENT_STATE_RECEIPT.md` (new)
- `docs/qa/FINAL_QA_SUMMARY.md` (new)
- `docs/qa/LIVE_DOGFOOD_RESULTS.md` (new)
- `docs/qa/NODEROOM_DOGFOOD_MATRIX.md` (new)
- `docs/qa/RELIABILITY_PROOFS.md` (new)
- `docs/qa/noderoom-dogfood-matrix.json` (new)

## Failure Classification

| Failure | Type | Action |
|---|---|---|
| FR-020 99/100 task receipts | **Stale evidence path** — receipts point to transient paths from different machine | Patch BTB spec to use durable paths; re-run missing tasks |
| SpreadsheetBench V2 missing | **Missing e2e spec** — no live-browser proof for V2 | Write V2 spec following V1 pattern |
| Official readiness 0/3 | **Missing capabilities** — Docker/Harbor, V2 agent mode, format diff | Address per-benchmark blockers |
| FR-040 missing | **SPEC CREATED** — `e2e/human-agent-concurrency.spec.ts` with two browser contexts | Run against live Convex to generate receipt |
| Active tab clarity | **UX issue** — visual hierarchy too subtle | Level 1 CSS fix |
| Chat rail empty state | **FIXED** — contextual prompts via `useMemo` on `activeArtifactId` | Receipt at `docs/qa/ui-issues/ux-chat-rail-static-chips.json` |
