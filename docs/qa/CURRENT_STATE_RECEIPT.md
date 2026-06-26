# NodeRoom Current-State Receipt

Generated: 2026-06-26 (live QA campaign)

## Git

- Branch: `feat/attention-overlay`
- HEAD: `b576bc09` (merged with origin/main)
- Modified files (uncommitted): styles.css, RoomShell.tsx, Artifact.tsx, passiveIntelligence.test.tsx, privacy-job-wall-proposal.spec.ts, state-captures, workflow-previews gif

## Deterministic Suite

| Gate | Result |
|---|---|
| `tsc --noEmit` | PASS |
| `npm test -- --run` | 1029/1031 passed (2 pre-existing failures) |
| `npm run build` | PASS (15.54s) |
| `npm run nodeagent:frame:smoke` | PASS (5 steps, 4 tools) |
| `npm run omnigent:nodeagent:smoke` | PASS (5/5 commands, frame smoke PASS) |
| `npm run fresh-room:proofs` | PASS (FR-010, FR-020) |

### Pre-existing test failures (not caused by current changes)

1. `tests/skillRag.test.ts` — powerpoint skill body no longer contains "BankerToolBench" string
2. `tests/officialBenchmarkTaskCoverage.test.ts` — multi-user conflict task shape mismatch

## Benchmark Status

| Metric | Value |
|---|---|
| BTB full sweep (100 tasks) | 100/100 completed, 0 errored, 0 missing, meanReward 0.2519 |
| BTB clean capability gate | 100 accepted, generic-only, no fallback |
| Official UI coverage | 2/3 (SpreadsheetBench V2 missing) |
| Official readiness | 0/3 (Harbor/Gandalf/verifier parity not wired) |
| Official task coverage | 1/5 complete, 410/1739 staged, 7 model cases |
| Fresh-room proofs | FR-010 PASS, FR-020 PASS (selective task), FR-020B BLOCKED (full suite) |

## Recent UI Changes (this branch, uncommitted)

1. **Runway / milestones crash fix**: defensive guards in `columnsOf`, `colsOf`, `rowIdsOf`, `expandSheetMerges`, `dataframeColumnWidth`
2. **Diligence memo alignment**: notebook read-model panel CSS
3. **Wall-first default**: `preferredRoomArtifact` prioritizes wall kind
4. **Inventory wall redesign**: clusters by Deliverables / Spreadsheets / Files / Notes / Walls with clickable cards
5. **Sheet horizontal scroll**: `.r-sheet-wrap` overflow auto fix (in progress)

## Known Remaining Gaps

- SpreadsheetBench V2: no live-browser fresh-room proof
- Official readiness: Harbor/Gandalf/verifier parity blocked
- FR-020B: full BTB suite execution blocked
- 2 pre-existing test failures (skillRag, officialBenchmarkTaskCoverage)
