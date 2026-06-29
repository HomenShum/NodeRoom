# NodeRL — the live-browser-UI lane (FR-020C)

> Generated 2026-06-28. Answers "how does NodeRL apply to the live browser UI" — and records that
> the lane is **already proven** (100 file-backed live receipts), now aggregated by the FR-020C gate.

## Result (honest)

`FR-020C = passed`, `liveBrowserBenchmarkReady = true`. All **100** BankerToolBench tasks have a
file-backed per-task live receipt under `docs/eval/fresh-room/FR-020/tasks/<id>/latest.json`,
each strictly validated by `validateFreshRoomProofReceipt`:

- `memoryMode:false`, `passed:true`, fresh room created after run start, forbidden preloads absent
- BASE gates + Focus-Mode gates present
- screenshot + trace files **exist on disk** (committed)
- exported deliverables **downloaded, bytes>0, path exists** (.xlsx/.xlsm/.pptx/.docx/.pdf)
- reopened files `scorerResult=pass`; package proof verifier `verdict=pass`; visual judge not fail

**What it proves:** completion through the live product UI with valid, reopenable,
contamination-free deliverable packages + visual-judge pass — for all 100. **What it does NOT
prove:** a 100% rubric pass rate. Rubric scoring is the separate isolated/Harbor lane
(FR-020B, mean reward 0.2519). The two are distinct registry claims by policy.

> The 100 receipts were committed in PR #66 but never aggregated into a claim. The FR-020C gate
> (this session) is the first to validate all 100 and record the verdict the registry derives from.

## How NodeRL maps to this lane

The headless/Harbor lane (FR-020B) only used NodeEval's reward aggregation. The live lane runs the
**whole** stack:

| NodeRL piece | Role | Where |
|---|---|---|
| NodeTrace | drives + records each browser session (steps, screenshots, boxes, trace) | `e2e/benchmark-ui-bankertoolbench.spec.ts`, `src/nodeagent/capture/`, `scripts/inference-nodetrace/` |
| NodeEval | per-task 4-gate receipt + package verifier + Gemini visual judge | `src/eval/freshRoomProofReceipts.ts`, `scripts/gemini-*-judge*.ts` |
| Live-suite gate | aggregates + strictly validates all 100 → flips FR-020C | `src/eval/bankerToolBenchLiveSuiteGate.ts`, `scripts/bankertoolbench-livesuite-gate.ts` |
| NodeMem | failure-pattern store → drives repair across re-runs (BUILT, file-backed) | `src/nodemem/failureMemory.ts`; ledger `docs/eval/fresh-room/FR-020/failure-memory.json` |

This is the agentic-RL loop: the **Gemini visual judge is the frontend reward**, the coding agent
is the backend fix, and the per-task receipts are the trajectories — drive→judge→repair→rerun
until all 100 live receipts pass.

## Re-run recipe (the run is non-invasive — orchestrate the existing spec)

The live driver is the existing Playwright spec, parameterized per task. It needs a **local
build+preview at `127.0.0.1:5273`** (not Docker) + provider keys from Convex. Per task:

```bash
# per task <id> from the bundle (.tmp/official-benchmarks/btb-fixture)
BTB_LIVE_ROOM_E2E=1 \
BTB_UI_BUNDLE_ROOT=.tmp/official-benchmarks/btb-fixture \
BTB_UI_TASK_ID=<id> \
BTB_FRESH_ROOM_PROOF_PATH=docs/eval/fresh-room/FR-020/tasks/<id>/latest.json \
PLAYWRIGHT_RECORD_VIDEO=1 \
npx playwright test --config playwright.real-flow.config.ts e2e/benchmark-ui-bankertoolbench.spec.ts --headed
```

Loop over the 100 ids (resume = skip ids whose `latest.json` already validates), then:

```bash
npm run benchmark:bankertoolbench:livesuite-gate -- --write   # writes the verdict
npm run benchmark:fresh-room:proofs                           # registry derives FR-020C
```

The gate refuses to flip unless all 100 validate; `--assert` makes CI fail until earned.

## Self-repair loop (memory → repair)

The live-suite gate (`--write`) also records a **failure memory** at
`docs/eval/fresh-room/FR-020/failure-memory.json` — one `NodeMemFailurePattern` per failed task
(symptom = validation errors, `rootCause` classified, `regressionTest` = the exact per-task re-run
command, `fixSummary` = a hint). Resolved tasks (now passing) are dropped automatically.

`repairTargets(memory)` is the list of task ids to re-run — so a repair pass touches ONLY the
unresolved failures, not all 100. The loop:

```
live run → per-task receipts → live gate validates → failure-memory.json (unresolved only)
  → re-run repairTargets → re-validate → resolved patterns drop → repeat until empty
```

Today the corpus is fully passing, so failure memory is `[]` and there are 0 repair targets — the
honest empty state. The mechanism activates on any regression or new task. (`src/nodemem/failureMemory.ts`,
tested in `tests/failureMemory.test.ts`.)

## Honest boundary

NodeRL makes the live lane **provable, aggregated, and self-improving** — not free. A fresh run is
~100 live browser sessions (time + agent model cost). What's proven today is the committed corpus;
re-running produces fresh receipts the same gate re-validates.
