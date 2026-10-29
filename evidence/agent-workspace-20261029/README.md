# Agent workspace proof — 2026-10-29

**Who and what:** a startup-banking analyst opens NodeRoom's agent workspace (`/#workspace`), creates a project from a synthetic data room of ten fictional SMB lenders, and asks an agent to build a cited credit-committee pack. The agent must read ~45 documents, catch a restated ARR and a superseded statement, avoid restricted files, write tables, a notebook, per-company memos and an HTML export with tests, and create a reusable skill, then use that skill in a later task.

**What could go wrong, and what was checked:** an agent can say "done" without doing the work, cite lines that don't contain the number, read files it shouldn't, lose the plan when its context is compacted, or lose the run when the browser reloads. Every run below was started from the real composer on the normal route, executed by a real engine with real provider calls, and graded afterwards by an **independent verifier** that runs outside the agent's context (`packages/nodeagent-engines/fixtures/verifiers/diligence-pack.verify.mjs`).

## Runs

| Folder | Engine (model) | What happened | Independent verifier |
|---|---|---|---|
| `run-deep-claude/` | Claude Agent SDK (Sonnet 5.5 main, Haiku 5.5 helpers) → hand-off to Codex app-server (gpt-5.5) | Deep diligence. 342 tool calls over 150 model turns, 9 helpers, **3 automatic context compactions** (72k→14k, 67k→19k, 68k→17k tokens), tab reload mid-run, user Stop → native-session Resume, then a cross-engine hand-off where Codex continued from Node's portable packet. | Claude: 34/37. After the Codex hand-off: **36/37** (one memo still cites a line that lacks its number). |
| `run-claude/` | Claude Agent SDK (Sonnet 5.5) | Full diligence with interrupt → resume, then the inbox update reusing the skill the first task created. Native ToolSearch loaded deferred Node tools. | 18/18, then 18/18 |
| `run-codex-app-server/` | Codex app-server (gpt-5.5) | Full diligence + inbox update; 4 and 3 overlapping helpers; skill created and reused. | 17/18, 17/18 |
| `run-openai-agents/` | OpenAI Agents SDK (gpt-5.5) | Same tasks; 4 overlapping helpers; skill lifecycle. | 17/18, 17/18 |
| `run-google-adk/` | Google ADK (Gemini 3.5 Flash) | Full diligence with 4 overlapping helpers and the skill lifecycle. *Its second task ran on Claude because of a UI bug fixed later (see below).* | 18/18 (ADK task) |
| `run-nodeagent-universal/` | Universal loop on the AI SDK (Gemini 3.5 Flash) | Full diligence, 4 helpers, skill lifecycle. *Second task ran on Claude (same bug).* | 17/18 (universal task) |
| `run-quickstart-consumer-adk/` | Google ADK, served by **`examples/nodeagent-workspace-quickstart`** (installs only the packed tarball) | Second consumer: same tasks through the quickstart's own worker and UI, after the UI fix; reload restored the run and the engine choice. | 18/18, 18/18 |
| `run-deep-claude-attempt1-hung-on-stop/` | Claude | First deep attempt; the agent finished (274 tool calls, 9 helpers, 3 compactions) but the recording hung because a reload had silently switched the tab to another project. Kept as the record of the bug it exposed. | — |
| `before/` | today's room agent, `?mode=memory` | Baseline: asked for a cited table, notebook and export with tests, the scripted room agent replied in 9 s with an unrelated canned line and made zero provider calls. | — |

The one 17/18 failure shared by Codex, OpenAI Agents and the universal loop is identical: the agent cited the superseded statement's own "superseded" line in the exceptions section. The verifier forbids any citation into a superseded document. That rule was **not** relaxed after seeing the results.

## Bugs these runs found, and the fixes (all in this branch)

- Codex on Windows shells through PowerShell; the policy only knew POSIX read commands → read-only cmdlets mapped.
- Core file tools were hidden behind tool search; small models never found `write_file` → core file tools always loaded.
- Two tool-discovery mechanisms (native + Node) were exposed at once; only native search could make a tool callable → one mechanism per engine.
- `read_source` took `path` while `list_sources` returned `docId` → both accepted.
- `list_files {"path": ""}` was "outside the workspace", so Codex concluded the folder was read-only → `""` is the workspace root.
- Codex models without binary metadata lost `apply_patch` → model list restricted.
- A reload dropped the viewer's project/run/engine, so another user's newer project hijacked the view and the engine reset to Claude → selection persisted; the proof asserts it.
- The verifier ran without the task's stage, so a deep run could be graded as the easier inbox stage → stage passed from the suggested task.

## What each run folder contains

Committed: `manifest.json` (sha256 of every file, git head, SDK pins, per-run usage and counters), `recording.json` (milestones with video offsets), `timeline.json` (every backend event mapped to a video offset), `events/<runId>.jsonl` (the worker's durable event log), `runs/<runId>.json`, `verification-rerun.json` (verifier re-run after the fact), `contact-sheet.png`, `trace.zip` (Playwright action/network log) where small. Curated frames are in `key-screens/`.

Local only (size): `raw-recording.webm|mp4` (unedited, 1×), `highlights.mp4` (labelled milestone cuts, **edited**), `timelapse.mp4` (whole run sped up, factor printed in the frame), and every milestone screenshot. Their hashes are in each `manifest.json`.

Replay the packaging and the independent check yourself:

```bash
node scripts/agent-workspace-proof-package.mjs evidence/agent-workspace-20261029/run-deep-claude
node packages/nodeagent-engines/fixtures/verifiers/diligence-pack.verify.mjs <workspaceDir from project.json> --json --stage deep
```

To record a new proof: `npm run agent:worker`, serve the UI, then `npx playwright test --config=playwright.agent-workspace.config.ts` with `PLAYWRIGHT_BASE_URL`, `AGENT_PROOF_ENGINE`, `AGENT_PROOF_MODEL`, `AGENT_PROOF_FIRST_TASK` and `AGENT_PROOF_HANDOFF_ENGINE` as needed.

## Cost

Known provider spend for all proof runs: **$9.72** (28 runs), plus **$1.38** for adapter qualification. Four runs used models with no verified public price (Gemini 3.5 Flash, Codex's `gpt-6-luna` helpers); their cost is recorded as unknown, not $0.

## Not claimed

- Full Claude Code / Codex parity. The tested behaviours are the ones listed above.
- Reliability across repeated runs: each scenario ran once per engine; the Codex/OpenAI failures before the fixes are part of the record.
- Production or multi-tenant use. The worker is a localhost, single-tenant developer service.
- That the deep task was fully passed: the best result is 36/37.
- The ADK and universal "task 2" results as evidence for those engines (they ran on Claude before the selection fix).
