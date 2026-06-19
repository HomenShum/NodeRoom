# HALO Overnight Run

Last updated: 2026-06-11T01:20Z.

Target deadline: 2026-06-10 10:00 AM PT.

The original full-live process ran through the June 9 10:00 AM PT cutoff and
completed six cycles. The thread heartbeat now checks every 30 minutes through
June 10 and records strict status snapshots. The local supervisor has started a
deterministic continuation through the June 10 deadline.

A local supervisor is available for this same handoff policy:

```bash
npm run halo:supervise -- -Until "2026-06-10T17:00:00Z" -PollSeconds 300
```

It waits while `docs/eval/halo-runs/.active-run.json` points at a live process,
then starts `halo:overnight` with deterministic lanes through the June 10
deadline. Logs go to `docs/eval/halo-runs/supervisor.log`.

Supervisor status at this update: background PowerShell PID `31284` is alive.
It launched active deterministic runner PID `149656` / run id
`20260609T183814Z`. `halo:status --strict --require-supervisor --record` passes
using `docs/eval/halo-runs/supervisor-state.json` as the supervisor heartbeat.

## Historical Active Run

No active run lock is present in the current repo. The section below is the
historical June 2026 continuation record for run `20260609T183814Z`; later HALO
artifacts exist under `docs/eval/halo-runs/20260613T085854Z`.

Historical authoritative loop:

```bash
tsx scripts/halo-overnight.ts --until=2026-06-10T17:00:00Z --sleep-minutes=30 --skip-e2e --skip-live
```

Run id: `20260609T183814Z`

Live status:

- Status file: `docs/eval/halo-runs/20260609T183814Z/status.json`
- Step log stream: `docs/eval/halo-runs/20260609T183814Z/summary.jsonl`
- Active lock: `docs/eval/halo-runs/.active-run.json`
- Current step at this update: `sleeping` after cycle 28.
- Current wake: `2026-06-10T08:53:26.732Z`.
- Current output status: `docs/eval/free-auto-router-ladder.json` exists
  (12,291 bytes). The latest full-live router ladder completed and failed
  overall.
- Process status: the parent runner process is alive and the lock is current.
- Status command: `npm run halo:status`
- Strict status command: `npm run halo:status -- --strict --require-supervisor`
- Recorded status command: `npm run halo:status -- --strict --require-supervisor --record`
- Snapshot report command: `npm run halo:snapshots`
- Supervisor command: `npm run halo:supervise -- -Until "2026-06-10T17:00:00Z" -PollSeconds 300`

The active lock points at the currently running process. A second
`halo:overnight` runner exits before writing run artifacts while that process is
alive.

Latest active deterministic continuation evidence in `20260609T183814Z`, cycle 28:

- `typecheck`: pass
- `unit-tests`: pass, 31 files / 195 tests
- `test:e2e`: skipped by `--skip-e2e`
- `agent:improve`: pass; internal professional catalog, workflow evals,
  collaboration ladder, credit evals, eval diff, Convex boundaries, and
  architecture-budget steps all completed. It wrote
  `docs/eval/agent-improvement-loop/20260610T082310Z.json`.
- `eval:diff`: pass, 0 degraded / 0 removed / 0 improved / 5 new / 0 same
- `qa:matrix:check`: pass, 13 features / 13 model routes current at cycle time
- `convex:boundaries`: pass
- `architecture:budget`: advisory pass, but stdout still reported
  `missing behavior evidence: convex/rooms.ts`.

Cycle 27/28 recovery proof:

- `evals/evalDiff.ts` now normalizes CRLF to LF only for the append-only prefix
  comparison, preserving the committed-history rewrite guard while avoiding a
  Windows line-ending false positive.
- `npm run qa:matrix` refreshed generated QA matrix artifacts.
- `architecture:budget` now infers changed `tests/**`, `evals/**`, and
  `docs/eval/**` files as behavior evidence, which cleared the cycle-28
  `convex/rooms.ts` false positive after the prompt-injection/abuse-cap tests
  landed.
- Manual recovery commands passed after those changes: `npm run eval:diff`,
  `npm run qa:matrix:check` (now 14 features / 13 model routes),
  `npm run architecture:budget`, `npm run typecheck -- --pretty false`,
  `npx tsc --noEmit --project convex\tsconfig.json --pretty false`,
  `npm test` (33 files / 204 tests), `npm run content:fluency:check`, and
  `npm run build`.

Cycle 8 incident and recovery:

- Cycle 8 failed `typecheck` and `unit-tests` because `src/nodeagent/core/runtime.ts`
  referenced `pendingToolCalls` before the current declaration was present in
  that runner snapshot.
- Manual recovery proof after cycle 8 passed: `npm run typecheck -- --pretty
  false`, plus targeted runtime/workflow Vitest coverage (5 files / 28 tests).
- Cycle 9 then proved the recovery inside the active HALO runner.

Prior full-live run: `20260609T060208Z` completed six cycles and ended after the
June 9 cutoff with failure status because at least one cycle contained failed
gates. After it completed, the stale lock and supervisor restart path exposed
two run-control bugs. Both have been fixed:

- `scripts/halo-overnight.ts` now releases the active lock explicitly after a
  normal `completed` status write.
- `scripts/halo-supervise-until.ps1` now calls `npm.cmd` with `--key=value`
  arguments and writes `supervisor-state.json`.
- `scripts/halo-status.ts` now uses the supervisor state file before falling
  back to process enumeration, avoiding false strict failures from flaky nested
  PowerShell process listing.

## Evidence Already Recorded

Deterministic cycle evidence in `20260609T060208Z`:

- `typecheck`: pass
- `unit-tests`: pass, 29 files / 173 tests
- `test:e2e`: pass for memory-mode chat specs; backend live specs skipped
- `agent:improve`: pass, recorded ladder/credit/workflow artifacts
- `eval:diff`: pass, no degraded checks
- `qa:matrix:check`: pass after regenerated QA/benchmark artifacts
- `convex:boundaries`: pass
- `architecture:budget`: advisory pass; still reports review-required surfaces

Live cycle evidence in `20260609T060208Z`:

- OpenRouter free-model discovery and tool smoke: pass; top resolved smoke model was `nvidia/nemotron-3-super-120b-a12b:free`
- Provider parser smoke: pass across Gemini, OpenAI, Anthropic, and OpenRouter
- Convex `/free` job smoke: pass; one attempt, resolved `nvidia/nemotron-3-super-120b-a12b:free`, completed in about 56s
- V2 multi-model benchmark: pass as a completed run, but not as promotion evidence
- Free-auto router ladder: fail after 3,823,229ms. It wrote
  `docs/eval/free-auto-router-ladder.json`; no free route cleared L1-L4.
  `openrouter/free-auto` passed L1, failed L2 by step budget despite correct
  edit/provenance, passed L3, and timed out L4.
  `nvidia/nemotron-3-super-120b-a12b:free` passed L1-L3 but timed out L4.
  The other free candidates failed due invalid JSON, provider retry errors, or
  unsafe/missing actions.

Separate UI/video evidence:

- Gemini UI review: pass against `docs/eval/ui-recordings/live-ui-walkthrough-20260608.mp4`
- Output: `docs/eval/agent-improvement-loop/gemini-ui-review.json`

## Benchmark Reading

Historical note: the June 9 low-level benchmark rows are retained as failure
analysis, not promotion evidence. The 0/9 `openrouter/free-auto` row came from
the older tool choreography and should not be used as a current model-quality
claim.

Current verified benchmark evidence is the v3 composite-synthesis contract in
`docs/eval/results.json`:

- workflow: `fetch_row_sources` then model-authored synthesis then `write_row`;
- latest scope: 2026-06-11 cheap/free OpenRouter smoke, 1 company, route
  snapshot `fabbcd520e971ec7`;
- result shape: 28 attempted routes, 21 scored work products, 7 quarantined
  provider/harness integration rows, and 18 routes clearing 9/9;
- fastest $0 full gate-clearer: `nex-agi/nex-n2-pro:free`, 9/9 checks,
  $0.0000, about 6.2s;
- cheapest paid full gate-clearer: `ibm-granite/granite-4.1-8b`, 9/9 checks,
  $0.0009, about 6.3s;
- larger-run holdover: `deepseek/deepseek-v4-flash` previously cleared the
  3-company run at $0.0034 and also cleared the latest 1-company smoke at
  $0.0020.

The older v2 single-call free-auto 9/9 trace is retained only as harness
history; review found that the deterministic tool template authored the row
fields, so the checks graded harness code rather than model synthesis. Do not
use v2 as promotion evidence. Do not use the research benchmark as evidence
that free-auto is safe for interactive shared-room editing either; that still
requires the L1-L4 lock/CAS/draft ladder, where the free routes remain
non-promotable.

## Subagent Review Findings To Preserve

Workflow QA:

- The 70-file professional workflow catalog is useful, but many GTM/finance cases still need concrete row-level fixtures.
- Priority gates: PitchBook company match/enrich, healthtech sector classification, AMO scorer, JPM joins, PII boundaries, cost reconciliation, template population, timesheet review, transaction summaries, and credit underwriting.
- README charts should stay yellow for workflow rows until fixture-backed and live-provider traces exist.

Model/router QA:

- `npm run ladder` is scripted unless `--real` is passed.
- `ladder:free` is the right live router test because it runs `openrouter/free-auto` plus current top free candidates.
- Current free-auto evidence is negative for interactive collaboration; keep it on the long-running `/free` lane.

UI/browser QA:

- Current E2E proves memory-mode chat; strict live three-user Convex/browser
  proof also passed for shared chat/edit convergence, private agent isolation,
  personal-agent room action, all-artifact tab presence, and review-mode
  proposal fan-out/inline approval (`EVAL-MQ7DB1BZ`).
- Remaining red/yellow browser-production claims: file upload/view,
  auto-accept preference/modal, full wall conflict behavior, and broader
  multi-user production load still need dedicated live fixtures.

Run-control QA:

- Duplicate full-live runners can corrupt shared artifacts, so `scripts/halo-overnight.ts` now has an active-run lock.
- `--skip-live` now skips the Gemini UI lane too.
- Lock parsing tolerates Windows PowerShell UTF-8 BOM output.
- Long steps stream child output into their step log and refresh `status.json`
  and `.active-run.json` every 30s.
- Sleeping states publish `sleepUntil` in `status.json`; `halo:status` and
  `halo:snapshots` render it when available. Latest active continuation wake:
  `2026-06-10T08:53:26.732Z`.
- `npm run halo:status` gives the lock, PID liveness, current step, latest
  events, and router ladder artifact state for each heartbeat/handoff.
- `npm run halo:status` now reports `supervisor-state.json`, latest
  `supervisor.log` lines, lock/run/deadline ages, and active runner process
  freshness; current verified supervisor PID is `31284`.
- `npm run halo:status -- --strict --require-supervisor` now exits nonzero if
  the active lock points at a dead process, no supervisor process is found, or
  more than one supervisor process is found.
- `npm run halo:status -- --strict --require-supervisor --record` appends the
  complete status report to `docs/eval/halo-runs/status-snapshots.jsonl`.
- `npm run halo:snapshots` renders the JSONL trail into
  `docs/eval/halo-runs/status-snapshots.md` for a quick morning handoff read.
  Latest generated report parses 66 snapshots. The final snapshot records the
  stopped state: active lock `20260609T183814Z`, runner PID `149656` dead,
  supervisor process list empty, and no active process tree. Earlier snapshots
  retain the duplicate/missing-supervisor anomalies that have since been closed.
- A scheduled-task fire created a second supervisor at 2026-06-09T00:05 PT.
  The duplicate was stopped, `scripts/halo-supervise-until.ps1` now exits if an
  existing supervisor process is active. Later, after the first full-live runner
  completed, the stale-lock/restart path exposed a Windows `npm` invocation bug;
  `scripts/halo-supervise-until.ps1` now uses `npm.cmd` and writes
  `supervisor-state.json`.
- `scripts/halo-cron.cmd` also checks for an existing supervisor before launching
  one, avoiding even the short-lived duplicate process during scheduled fires.
  Smoke run at 2026-06-09T00:14 PT logged `supervisor already active; skip` and
  exited `0` without creating a second supervisor.
- Latest wrapper checks: `npm run halo:status -- --json --strict --require-supervisor --record`,
  duplicate-supervisor smoke via `npm run halo:supervise -- -Until "2026-06-10T17:00:00Z" -PollSeconds 1`,
  cron wrapper skip smoke via `cmd /c scripts\halo-cron.cmd`,
  `npm run qa:matrix`,
  `npm run qa:matrix:check`,
  `npm run halo:snapshots`,
  `npx vitest run tests/qaMatrix.test.ts`,
  `npm run typecheck -- --pretty false`, targeted runtime/workflow Vitest
  coverage (5 files / 28 tests), and `git diff --check` all pass for the
  current HALO run-control changes. Cycle 9 confirmed the cycle 8
  `pendingToolCalls` recovery under the active runner; later focused checks
  also tightened error-path handoff trace/callback assertions and the phone
  responsive overlay gate.
- `scripts/halo-supervise-until.ps1` and `scripts/halo-cron.cmd` now target the
  June 10 handoff window instead of the original June 9 cutoff.

## Stopped State

The HALO runner was stopped by explicit user request on June 10, 2026 at about
01:58 PT (`2026-06-10T08:58:49Z`). The supervisor PowerShell process `31284`
and runner Node process `149656` were force-stopped, `halo:status --json
--record` confirmed the active lock points to a dead PID with no supervisor
processes, and the `halo-loop-10am-pt-handoff` automation was deleted so it
will not restart the runner.

## Next Handoff Checks

The automatic June 10 handoff loop is no longer active. If HALO is resumed
manually:

1. Read `docs/eval/halo-runs/20260609T183814Z/status.json`.
2. Run `npm run halo:status -- --json` first; strict supervisor mode is
   expected to fail while the runner is intentionally stopped.
3. If a new cycle rewrites `docs/eval/free-auto-router-ladder.json`, inspect it
   and rerun `npm run qa:matrix` plus `npm run halo:snapshots`.
4. Start a new lock-aware supervisor only after an explicit resume request:
   `npm run halo:supervise -- -Until "2026-06-10T17:00:00Z" -PollSeconds 300`.
5. Run `npm run benchmark:charts` and `npm run qa:matrix:check` after any new benchmark output.
6. Preserve red/yellow claims for live browser E2E, row-level professional fixtures, and free-auto collaboration promotion unless fresh evidence closes them.
