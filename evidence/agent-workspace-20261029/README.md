# Agent workspace proof — 2026-10-29

**Who and what:** a startup-banking analyst opens NodeRoom's agent workspace (`/#workspace`), creates a project from a synthetic data room of ten fictional SMB lenders, and asks an agent to build a cited credit-committee pack. The agent must:

- read about 45 documents;
- catch a restated ARR and a superseded statement;
- avoid restricted files;
- write tables, a notebook, per-company memos and an HTML export with tests;
- create a reusable skill, then use that skill in a later task.

**What could go wrong, and what was checked:** an agent can say "done" without doing the work. It can cite lines that don't contain the number, read files it shouldn't, lose the plan when its context is compacted, or lose the run when the browser reloads.

Every run below started from the real composer on the normal route. A real engine executed it, making real provider calls. Afterwards an **independent verifier** graded it, running outside the agent's context (`packages/nodeagent-engines/fixtures/verifiers/diligence-pack.verify.mjs`).

## Runs

| Folder | Engine (model) | Code it ran on | What happened | Independent verifier |
|---|---|---|---|---|
| `run-deep-claude/` | Claude Agent SDK (Sonnet 5.5 main, Haiku 5.5 helpers), then hand-off to Codex app-server (gpt-5.5) | after the engine fixes (`f217ce0f` + cleanup) | Deep diligence: 342 tool calls over 150 model turns, 9 helpers, **3 automatic context compactions** (72k→14k, 67k→19k, 68k→17k tokens). The tab was reloaded mid-run, then the user pressed Stop and the run resumed on its native session. It was then handed off to Codex. | Claude: 34/37. After the Codex hand-off: **36/37**. The remaining failure is `memos.citations`: 25 memo citations point at a line that lacks the cited figure, spread across the memos. |
| `run-deep-claude-attempt1-hung-on-stop/` | Claude | after the engine fixes, before the selection fix | The same deep task finished: 274 tool calls, 9 helpers, 3 compactions, **35/37**. The recording hung because a reload had silently switched the tab to another project. It is kept as the record of that bug. | 35/37 |
| `run-claude/` | Claude Agent SDK (Sonnet 5.5) | **before** the engine fixes (`bc815bb8` + working tree) | Full diligence with interrupt → resume, then the inbox update reusing the skill the first task created. Native ToolSearch loaded deferred Node tools. | 18/18, then 18/18 |
| `run-codex-app-server/` | Codex app-server (gpt-5.5) | after the engine fixes | Full diligence and the inbox update. 4 helpers in the first task, 3 in the second. The skill was created and reused. | 17/18, 17/18 |
| `run-openai-agents/` | OpenAI Agents SDK (gpt-5.5) | after the engine fixes | The same tasks with 4 overlapping helpers and the full skill lifecycle. | 17/18, 17/18 |
| `run-quickstart-consumer-adk/` | Google ADK (Gemini 3.5 Flash), served by `examples/nodeagent-workspace-quickstart` from an installed tarball | after the engine and selection fixes | Second consumer: the same tasks through the quickstart's own worker and UI. Reload restored the run and the engine choice. | 18/18, 18/18 |
| `run-google-adk/` | Google ADK (Gemini 3.5 Flash) | **before** the engine fixes | Full diligence with 4 overlapping helpers and the skill lifecycle. Its second task ran on Claude because of the selection bug, so it is not ADK evidence. | 18/18 (ADK task) |
| `run-nodeagent-universal/` | Universal loop on the AI SDK (Gemini 3.5 Flash) | **before** the engine fixes; not re-run since | Full diligence, 4 helpers, skill lifecycle. Its second task ran on Claude (same bug). | 17/18 (universal task) |
| `before/` | the room's scripted agent (`?mode=memory`) | `6f1af0f7` | Baseline. Asked for a cited table, notebook and export with tests, it answered in 9 s with an unrelated canned line. That engine is a scripted model with no provider client. No network log was captured. | — |

"Before the engine fixes" means the runs used the earlier tool catalogue. In it, core file tools were deferred behind tool search, and Claude and OpenAI Agents saw Node's `search_tools`/`load_tool` next to their native search. The fixes are listed below. Those runs are evidence for the engines and the UI, not for the final catalogue.

The one 17/18 failure shared by Codex, OpenAI Agents and the universal loop is identical. The agent cited the superseded statement's own "superseded" line in the exceptions section, and the verifier forbids any citation into a superseded document. That rule was **not** relaxed after seeing the results.

## Bugs these runs found, and the fixes (in this branch)

- **Codex couldn't list files.** Codex shells through PowerShell on Windows, and the policy only knew POSIX read commands. Read-only cmdlets are now mapped.
- **Small models never wrote files.** Core file tools were hidden behind tool search, so they never found `write_file`. Core file tools are now always loaded.
- **Loaded tools never became callable.** Two discovery mechanisms (native and Node) were exposed at once, and only native search can make a tool callable. Each engine now gets one mechanism.
- **Source reads failed on a field name.** `read_source` took `path` while `list_sources` returned `docId`. Both are now accepted.
- **Codex concluded the folder was read-only.** `list_files {"path": ""}` was rejected as "outside the workspace". `""` now means the workspace root.
- **Codex lost `apply_patch`.** Codex models without binary metadata lose it, so the model list is now restricted.
- **A reload hijacked the view.** It dropped the viewer's project, run and engine, so another user's newer project took over the view and the engine reset to Claude. The selection now persists in the browser's storage.
- **A deep run could be graded too easily.** The verifier ran without the task's stage, so a deep run could be graded as the easier inbox stage. The stage now comes from the suggested task.

The adversarial review of this evidence (below) found more defects. They were fixed after these recordings and are listed in the PR:

- a security-policy wildcard bug;
- a hand-off packet that carried the resume boilerplate instead of the original task;
- double-counted cost on resumed Claude runs;
- `?mode=memory` reachable on every build.

In this deep run, the hand-off packet's "original task" was the resume boilerplate. Codex rebuilt the task from the workspace files.

## What each run folder contains

**Committed:**

- `manifest.json`: sha256 of every file, SDK pins, and per-run usage and counters. Its `gitHead` is the commit at packaging time, not at recording time; the table above gives the code each run used.
- `recording.json`: milestones with video offsets.
- `timeline.json`: every backend event except token deltas and raw engine frames, mapped to a video offset.
- `events/<runId>.jsonl`: the worker's durable event log, complete.
- `runs/<runId>.json`
- `verification-rerun.json`: the verifier re-run after the fact.
- `contact-sheet.png`
- `trace.zip`, where small: the Playwright action and network log.

Curated frames are in `key-screens/`.

**Local only, for size:**

- `raw-recording.webm|mp4`: unedited, 1×.
- `highlights.mp4`: labelled milestone cuts, **edited**.
- `timelapse.mp4`: the whole run sped up, with the speed factor printed in the frame.
- every milestone screenshot.

Their hashes are in each `manifest.json`. The quickstart proof was served by an earlier tarball build (sha256 `e43c859b…`). The committed tarball (`3aa403b5…`) also carries the package README, a CSS change and the adversarial-review fixes. It was checked only by a no-cost smoke test on 2026-10-30, with no keys and no run started. The installed package's integrity matched the tarball. The worker's health came back through the quickstart's proxy, and a project was created from the template. The UI settled on "No runs yet" and "Setup required … ANTHROPIC_API_KEY is not set" (`run-quickstart-consumer-adk/final-tarball-smoke.png` and `.json`). An earlier screenshot under that name showed a previous tarball build.

To replay the packaging and the independent check yourself:

```bash
node scripts/agent-workspace-proof-package.mjs evidence/agent-workspace-20261029/run-deep-claude
node packages/nodeagent-engines/fixtures/verifiers/diligence-pack.verify.mjs <workspaceDir from project.json> --json --stage deep
```

To record a new proof, start the worker with `npm run agent:worker` and serve the UI. Then run `npx playwright test --config=playwright.agent-workspace.config.ts`, setting `PLAYWRIGHT_BASE_URL`, `AGENT_PROOF_ENGINE`, `AGENT_PROOF_MODEL`, `AGENT_PROOF_FIRST_TASK` and `AGENT_PROOF_HANDOFF_ENGINE` as needed.

The proof worker ran with these defaults, recorded on each run:

- `NODE_AGENT_DEFAULT_AUTOCOMPACT_TOKENS=100000`
- `NODE_AGENT_DEFAULT_MAX_USD=40` (30 for the earlier runs)
- `NODE_AGENT_DEFAULT_MAX_WALL_MS=9000000`

## Cost

The proof worker's run records sum to **$9.72** of known provider spend across 28 runs. Treat this as an upper bound: on a resumed Claude session, the SDK's usage continued from the transcript's totals, so up to about $1.10 of that may be counted twice (fixed after these runs). Four runs, plus the two quickstart runs, used models with no verified public price (Gemini 3.5 Flash, Codex's `gpt-6-luna` helpers), so their cost is unknown.

Adapter qualification (fake host, before these runs): $0.24 Claude and $0.09 Codex measured, plus estimates that are upper bounds, not measurements: about $0.60 of earlier Codex exploration priced at assumed rates, and Gemini upper bounds of $0.24 (ADK) and $0.18 (universal).

## Not claimed

- **Full Claude Code / Codex parity.** The tested behaviours are the ones listed above.
- **Reliability across repeated runs.** Each scenario ran once per engine; the Codex and OpenAI failures before the fixes are part of the record.
- **Production or multi-tenant use.** The worker is a localhost, single-tenant developer service. Code the agent runs through allowed `node`/`npm test` commands is not sandboxed (see the package README's safety model).
- **That the deep task was fully passed.** The best result is 36/37.
- **The second task of the ADK and universal runs as evidence for those engines.** Both ran on Claude before the selection fix.
- **The `qualification/*.json` statuses as worker-path proof.** They were measured with a fake host before the fixes.
