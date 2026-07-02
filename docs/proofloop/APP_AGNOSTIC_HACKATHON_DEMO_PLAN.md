# Proof Loop App-Agnostic Hackathon Demo Plan

## One-Line Position

Proof Loop proves that an agent harness completed the intended user workflow in a real app UI, records the evidence, and uses failures to improve the app or harness without letting the agent rewrite the scoreboard.

NodeRoom proves Proof Loop is real. The app-adapter interface proves Proof Loop is not only for NodeRoom.

## Decision

Build the hackathon demo as:

```text
Proof Loop core
+ generic web-app adapter
+ NodeRoom reference adapter
+ JSONL run storage
+ local proof dashboard
+ strict certification loop
+ open-ended exploration loop for proposed cases only
```

Do not build:

```text
proofloop = NodeRoom tester
```

Build:

```text
proofloop = app-agnostic web-agent workflow prover
noderoom = first serious reference adapter
```

The public-repo story should be:

> Here is Proof Loop. It can run against any browser-based agent app through an adapter and workflow spec. NodeRoom is the reference example.

## Why This Is More Than Red Teaming

Hosted confidential AI-agent red teaming is a strong wedge, but Proof Loop should not collapse into "prompt injection scanner." The larger product is workflow certification for agentic software.

Proof Loop should answer five questions:

1. Did the intended user workflow complete?
2. Did the agent use the expected UI/tool path rather than a shortcut?
3. Did the app produce durable, reopenable artifacts?
4. Did the run generate evidence strong enough for an external reviewer?
5. Did failures create memory and repairs without weakening the verifier?

Red-team tests are one input into this certification loop. They are not the whole loop.

## Focal Customer

The first focal group should be browser-based workspace agent apps:

- Agent workrooms
- Spreadsheet, document, and notebook agents
- Internal ops copilots
- Finance/accounting/underwriting workflow agents
- CRM, diligence, research, or back-office automation agents
- Tool-using agents where the intended workflow is visible in a web app

Defer voice agents and video-generation agents until the core proof contract is stable. They need different evidence types and may not fit the first browser-workflow MVP.

## Hackathon Constraints

Use these constraints from the Spencer/Kevin feedback as product guardrails:

- Reliability is non-negotiable: the intended user workflow must be completed.
- No routing unless an OSS router is already compatible and integrated.
- No heavyweight UI build; use a barebones local dashboard for demo.
- The app must run fast as it grows: map cheap unit tests separately from live browser proof.
- Early adopters are not always long-term buyers: keep the demo pointed at a focal buyer and repeatable use case.
- Proof Loop must map current UI state, cheap tests, and missing UI validation/build work.
- NodeRoom is a reference app, not the product boundary.

## Hierarchy Model

The underwriting-company screenshot idea maps well if Proof Loop organizes proof like a deal hierarchy:

```text
Organization
  Project
    App adapter
      Workflow
        Scenario
          Run
            Step
              Evidence
                Gate
                  Verdict
                    Failure memory
                      Repair proposal
                        Promotion decision
```

For a hackathon demo, the hierarchy can be rendered as:

```text
Proof Loop
  Apps
    NodeRoom
    Generic Web App
  Workflows
    Main agent task
    Artifact export/reopen
    Prompt-injection resistance
  Runs
    Browser actions
    Agent state
    Tool calls
    Artifacts
  Gates
    Live user contract
    Task verifier
    Official scorer
    Artifact reopen
    Safety/privacy
  Memory
    Raw proof log
    Compacted failure
    Proposed regression
  Decisions
    Pass
    Repair
    Blocked external
    Promote new case
```

This gives Proof Loop a business-readable shape: not "test output," but a review board of app, workflow, evidence, risk, and decision.

## Two-Loop Architecture

Proof Loop needs two loops because self-improvement and certification have different safety properties.

### 1. Certification Loop

The certification loop is strict, locked, and pass/fail.

It answers:

```text
Did the agent harness complete the intended workflow under locked evidence rules?
```

It includes:

- Locked verifier
- Locked workflow expectation
- Locked live-user contract
- Locked artifact-reopen gate
- Official scorer receipt when a public benchmark is claimed
- Browser evidence
- Machine-readable NodeTrace v2
- NodeEval reward object
- Memory write
- Scorecard

The repair agent may not weaken these.

### 2. Exploration Loop

The exploration loop is open-ended and proposal-only.

It answers:

```text
What new failures, edge cases, red-team probes, user personas, or scaffold improvements should we test next?
```

It can generate:

- Proposed user workflows
- Proposed prompt-injection attacks
- Proposed expected-tool-use checks
- Proposed UI selectors/metadata
- Proposed scaffold fixes
- Proposed regression cases
- Proposed benchmark adapters

It cannot certify itself.

Promotion requires review:

```text
proposal -> human/locked-judge review -> promoted regression -> certification loop
```

## Anti-Reward-Hacking Doctrine

Proof Loop may improve:

- App code
- Agent prompt
- Tool schema
- UI metadata
- Context pack
- Retry policy
- Routing policy, only after it is proven
- Scaffold playbook
- Test selectors, when they preserve the same user requirement

Proof Loop may not weaken:

- Verifier gates
- Held-out tests
- Evidence requirements
- Official scorer wrappers
- Live-user contract
- Min score thresholds
- Safety/privacy gates
- Artifact reopen checks
- Benchmark fixture isolation

Hard rule:

```text
The agent can repair the runner. It cannot rewrite the scoreboard.
```

## Goodhart And Model-Collapse Guardrails

The failure mode to avoid:

```text
optimize the score
-> change the harness
-> pass the test
-> call it better
```

The desired loop:

```text
run real user workflow
-> collect real evidence
-> judge against locked expectations
-> store failure memory
-> repair only allowed layers
-> rerun on held-out or external cases
-> promote only if proof improves
```

Memory must preserve source type:

```ts
type MemorySource =
  | "real_user_run"
  | "live_browser_proof"
  | "official_benchmark"
  | "human_feedback"
  | "synthetic_edge_case"
  | "model_generated_proposal";
```

Synthetic cases are useful, but must remain labeled. They cannot become the only reality the loop trains on.

## Public Repo Shape

Target structure:

```text
proofloop/
  core/
    runner.ts
    events.ts
    gates.ts
    scorecard.ts
    live-dashboard.ts
    anti-cheat.ts
  adapters/
    generic-web-app.ts
    noderoom.ts
  workflows/
    example.workflow.yaml
    noderoom.workflow.yaml
  storage/
    jsonl.ts
  reports/
    report.ts
  proposals/
    README.md
```

Current repo already has many pieces, but some are still NodeRoom-shaped or CLI-shaped:

- CLI/supervisor: [`scripts/proofloop-cli.ts`](../../scripts/proofloop-cli.ts)
- Loop artifacts: [`src/eval/proofloopArtifacts.ts`](../../src/eval/proofloopArtifacts.ts)
- Live-user contract and media artifacts: [`src/eval/proofloopLoopArtifacts.ts`](../../src/eval/proofloopLoopArtifacts.ts)
- Live browser proof: [`proofloop/live-browser-proof.spec.ts`](../../proofloop/live-browser-proof.spec.ts)
- Cockpit: [`proofloop/cockpit/server.mjs`](../../proofloop/cockpit/server.mjs), [`proofloop/cockpit/overlay.ts`](../../proofloop/cockpit/overlay.ts)
- Benchmark adapters: [`proofloop/benchmarks/README.md`](../../proofloop/benchmarks/README.md)
- NodeAgent adoption map: [`docs/NODEAGENT_ADOPTION.md`](../NODEAGENT_ADOPTION.md)
- Omnigent boundary: [`docs/OMNIGENT_INTEGRATION.md`](../OMNIGENT_INTEGRATION.md)
- Loop engineering ledger: [`docs/proofloop/LOOP_ENGINEERING_REQUIREMENTS.md`](./LOOP_ENGINEERING_REQUIREMENTS.md)

## App Adapter Interface

The MVP adapter should be small and boring:

```ts
export type ProofLoopAppAdapter = {
  id: string;
  name: string;
  kind: "web";

  detect(): Promise<boolean>;
  setup(): Promise<SetupResult>;
  start(): Promise<StartResult>;
  getBaseUrl(): Promise<string>;
  workflows(): ProofWorkflow[];
};

export type SetupResult = {
  status: "ready" | "needs_user_action" | "blocked";
  message: string;
  receipts: string[];
  nextCommands: string[];
};

export type StartResult = {
  status: "started" | "already_running" | "external_url";
  baseUrl: string;
  command?: string;
  pid?: number;
};
```

NodeRoom adapter responsibilities:

- Dev command
- Production/staging URL
- Fresh room route
- Focus Mode hooks
- Trace selectors
- Artifact selectors
- Benchmark workflows
- Proof receipts

Generic web app adapter responsibilities:

- Accept `baseUrl`
- Accept YAML workflow
- Run Playwright actions
- Capture console/network errors
- Capture screenshot/video/trace
- Emit the same proof artifacts as NodeRoom

## Workflow Spec

Proof Loop supports any app through workflow specs.

Example:

```yaml
id: main-agent-workflow
name: Main Agent Workflow

app:
  kind: web
  baseUrl: http://localhost:3000

steps:
  - goto: /
  - assertVisible: "text=Start"
  - click: "text=Start"
  - fill:
      selector: "[data-proofloop='task-input']"
      value: "Run the primary agent task"
  - click: "[data-proofloop='submit']"
  - waitFor: "[data-proofloop='result']"

gates:
  - noConsoleErrors
  - noNetworkErrors
  - resultVisible
  - screenshotCaptured
  - nodeTraceV2Written
  - nodeEvalWritten
```

The workflow spec must not be a hidden benchmark answer. It describes user actions and expected observable behavior. It should not include private golden outputs unless the adapter is explicitly in verifier mode and the app/agent cannot read them.

## Run Storage For Hackathon

Use JSONL now. Do not build enterprise storage during the hackathon.

MVP run directory:

```text
.proofloop/runs/<run-id>/
  events.jsonl
  scorecard.md
  live-user-contract.json
  node-trace-v2.json
  node-eval.json
  cockpit-events.jsonl
  cockpit-snapshot.json
  official-scorer-receipt.json
  verifier-receipt.json
  screenshots/
  video.webm
```

JSONL is the raw proof log, not the final memory layer.

Event schema:

```ts
export type ProofLoopEvent = {
  runId: string;
  timestamp: string;
  type:
    | "run_start"
    | "setup"
    | "browser_action"
    | "agent_state"
    | "tool_call"
    | "gate_pass"
    | "gate_fail"
    | "artifact"
    | "screenshot"
    | "verdict";

  appId?: string;
  workflowId?: string;
  stepId?: string;
  message?: string;
  data?: Record<string, unknown>;
};
```

Every event must include:

- `runId`
- `timestamp`
- `type`
- `appId` when an app adapter is active
- `workflowId` when a workflow is active
- machine-readable `data`

That makes later import into SQLite, Postgres, hosted storage, or a vector/search index straightforward.

## Later Storage Upgrade

After the hackathon:

```text
JSONL raw proof log
-> SQLite + FTS5 local index
-> compacted memory
-> searchable failures
-> scaffold memory
-> model-delta memory
-> optional hosted storage
-> enterprise customer-owned storage
```

The current local memory direction is already visible in:

- [`scripts/proofloop-cli.ts`](../../scripts/proofloop-cli.ts)
- [`src/nodemem/core/types.ts`](../../src/nodemem/core/types.ts)
- [`src/nodemem/failureMemory.ts`](../../src/nodemem/failureMemory.ts)

## Barebones Demo UI

Do not spend hackathon time on a polished product UI. Build a local dashboard with five panels:

1. Apps and workflows
2. Current run timeline
3. Gates and verdicts
4. Evidence and artifacts
5. Failure memory and next action

The demo dashboard should read local run artifacts. It should not become a second source of truth.

Minimum dashboard data:

```text
run id
app id
workflow id
base URL
status
gate list
latest screenshot
trace path
node-eval reward
failure categories
repair prompt
memory write status
next command
```

## Demo Storyboard

### Demo 1: Generic Web App

Goal: prove app agnosticism.

Flow:

1. Start a tiny local sample app or point at a local web app.
2. Run `proofloop run generic --workflow example.workflow.yaml`.
3. Show browser actions, screenshot, console/network gate, scorecard, NodeTrace, NodeEval.
4. Show dashboard reading `.proofloop/runs/<run-id>/`.

Success message:

```text
Proof Loop can prove any browser workflow that exposes stable selectors and observable outcomes.
```

### Demo 2: NodeRoom Reference Adapter

Goal: prove serious dogfood.

Flow:

1. Start NodeRoom or use `https://noderoom.live`.
2. Run strict live-user proof.
3. Show fresh room, visible agent progress, artifact state, trace/cockpit events, verifier receipt.
4. Show failure if gates are missing. Do not fake pass.

Success message:

```text
NodeRoom is not special-cased in the proof core. It is a rich adapter using the same contract.
```

### Demo 3: Confidential Agent Red-Team Certification

Goal: show the buyer wedge without making it the whole product.

Flow:

1. Treat the agent as a black box.
2. Do not ask for the core prompt.
3. Run expected tool-use tests, prompt-injection probes, and workflow-completion checks.
4. Produce a certificate-style report with evidence, risk findings, and blocked items.

Success message:

```text
Proof Loop can certify behavior without needing the customer's private prompt.
```

### Demo 4: Anti-Cheating Repair Loop

Goal: show Proof Loop improves without reward hacking.

Flow:

1. Run a failing workflow.
2. Write failure memory and repair prompt.
3. Attempt an allowed repair.
4. Gate rejects any verifier/minScore/evidence weakening.
5. Rerun and compare before/after NodeTrace and NodeEval.

Success message:

```text
The agent can repair the app or harness. It cannot lower the bar.
```

## Certification Gates

Every live proof should enforce:

- `live_or_staging_prod_url`
- `fresh_browser_context`
- `no_seeded_replay_room`
- `no_memory_mode_shortcut`
- `user_lands_on_public_ui`
- `user_creates_or_joins_fresh_workspace`
- `benchmark_inputs_uploaded_through_ui`
- `agent_invoked_through_user_visible_ui`
- `streaming_or_progress_visible`
- `trace_or_worklog_visible`
- `artifacts_generated_by_agent`
- `artifacts_exported_or_reopened`
- `verifier_or_judge_runs`
- `official_scorer_receipt_written` when claiming official benchmark score
- `visual_browser_proof_captured`
- `cost_latency_recorded`
- `node_trace_v2_exported`
- `node_eval_written`
- `proof_receipt_written`
- `no_unexpected_console_or_page_errors`

Invalid if:

- seeded final evidence room
- direct DB artifact injection as final proof
- preloaded final artifacts
- golden answer copied into agent context
- backend-only execution
- API-only task execution for a UI claim
- screenshot/video missing for UI claim
- verifier receipt missing
- official scorer missing for official benchmark claim

## Red-Team Lane

Red-team tests should be represented as workflows or sub-workflows, not as an entirely separate product.

Test families:

- Direct prompt injection
- Indirect prompt injection through documents/web pages
- Expected tool-use violation
- Sensitive information disclosure
- Excessive agency
- Unauthorized action attempt
- Retrieval/data poisoning scenario
- Refusal or non-completion of intended safe task

Each red-team result must still produce:

- Browser or API evidence, depending on the claim
- Tool-call evidence when tool behavior is tested
- Verifier receipt
- Failure category
- Suggested mitigation
- Promotion decision if it becomes a regression

## Current Repo Implementation Map

| Layer | Current proof | Gap for app-agnostic demo |
| --- | --- | --- |
| CLI and supervisor | [`scripts/proofloop-cli.ts`](../../scripts/proofloop-cli.ts) | Split reusable core from CLI command glue. |
| Run artifacts | [`src/eval/proofloopArtifacts.ts`](../../src/eval/proofloopArtifacts.ts) | Make schema names app-neutral. |
| Live-user contract | [`src/eval/proofloopLoopArtifacts.ts`](../../src/eval/proofloopLoopArtifacts.ts) | Keep strict gates, but route app-specific evidence through adapter. |
| NodeRoom proof | [`proofloop/live-browser-proof.spec.ts`](../../proofloop/live-browser-proof.spec.ts) | Move NodeRoom selectors into adapter/workflow file. |
| Benchmark adapters | [`proofloop/benchmarks/`](../../proofloop/benchmarks) | Add generic web-app adapter and workflow adapter loader. |
| Cockpit | [`proofloop/cockpit/`](../../proofloop/cockpit) | Make it read generic run events, not NodeRoom-specific events. |
| Memory | [`src/nodemem/`](../../src/nodemem) | Keep JSONL now, define import path to SQLite/FTS later. |
| NodeAgent harness | [`src/nodeagent/`](../../src/nodeagent) | Keep as reference inner-agent trace source, not required for all apps. |
| Supervisor ledger | `.proofloop/goals/<goal-id>/` generated by CLI | Add app/workflow labels to queue tasks and blockers. |

## Milestones

### Milestone 0: Freeze Product Claim

Outcome:

```text
Proof Loop is a production proof memory system for agent work.
```

Tasks:

- Keep wording consistent.
- Do not market as only evaluator, benchmark, optimizer, or red-team scanner.
- Put NodeRoom in docs as reference adapter.

### Milestone 1: Generic Workflow Runner

Outcome:

```text
proofloop run generic --workflow proofloop/workflows/example.workflow.yaml
```

Tasks:

- Parse workflow YAML.
- Run Playwright steps.
- Emit `events.jsonl`.
- Emit screenshot/video/trace path.
- Emit scorecard.
- Emit NodeTrace v2 and NodeEval.

### Milestone 2: Adapter Interface

Outcome:

```text
proofloop apps list
proofloop setup noderoom
proofloop run noderoom --workflow main-agent-task
```

Tasks:

- Add `ProofLoopAppAdapter`.
- Add `generic-web-app` adapter.
- Add `noderoom` adapter.
- Move app-specific selectors out of core.
- Keep benchmark adapters using the same contract.

### Milestone 3: Local Dashboard

Outcome:

```text
proofloop dashboard latest
```

Tasks:

- Read `.proofloop/runs/<run-id>/`.
- Render gate statuses.
- Render event timeline.
- Link screenshots/videos/traces.
- Show NodeEval reward.
- Show repair prompt and next command.

### Milestone 4: Certification/Exploration Split

Outcome:

```text
proofloop propose redteam --from latest
proofloop promote proposal <id>
```

Tasks:

- Store proposals in `.proofloop/proposals/`.
- Store promoted regressions in `.proofloop/regressions/`.
- Add anti-cheat checks to `proofloop gate`.
- Label synthetic/proposed cases clearly.

### Milestone 5: Confidential Certification Demo

Outcome:

```text
proofloop certify --app customer-agent --workflow onboarding --redteam prompt-injection
```

Tasks:

- Allow black-box app URL.
- Do not require core prompt.
- Test behavior through UI/tool observations.
- Produce certificate-style report.
- Mark limitations and blocked requirements.

## Hackathon Day Plan

### Day 1

- Finalize generic adapter interface.
- Add generic workflow YAML parser.
- Emit JSONL events.
- Run a trivial web workflow.

### Day 2

- Move NodeRoom workflow into adapter/workflow format.
- Reuse current strict live-user contract.
- Show NodeRoom as reference adapter.

### Day 3

- Build barebones dashboard.
- Add red-team workflow example.
- Add anti-cheat gate checks for verifier/minScore/evidence changes.

### Day 4

- Polish demo scripts.
- Record one passing generic run.
- Record one failing NodeRoom or benchmark run with honest blocker.
- Write final README section and source appendix.

## Demo Commands

Current commands already available or near-term:

```bash
npm run proofloop -- init
npm run proofloop -- setup bankertoolbench --allow-download --limit 1
npm run proofloop -- setup bankertoolbench --allow-download --limit 1 --verify-official-contract
npm run proofloop -- run bankertoolbench
npm run proofloop -- memory doctor
npm run proofloop -- memory index
npm run proofloop -- goal init proofloop-main --max-hours 168 --budget-usd 50
npm run proofloop -- supervise --goal proofloop-main
npm run proofloop -- gate --goal proofloop-main
```

Proposed hackathon commands:

```bash
npm run proofloop -- apps list
npm run proofloop -- setup generic-web-app --base-url http://localhost:3000
npm run proofloop -- run generic-web-app --workflow proofloop/workflows/example.workflow.yaml
npm run proofloop -- run noderoom --workflow proofloop/workflows/noderoom.workflow.yaml --prod --user-emulation strict
npm run proofloop -- dashboard latest
npm run proofloop -- propose redteam --from latest
npm run proofloop -- promote proposal <proposal-id>
```

## Acceptance Checklist

The hackathon demo is acceptable only if:

- A generic app workflow can run without NodeRoom-specific code.
- NodeRoom can run as a reference adapter.
- Every run writes `events.jsonl`, `scorecard.md`, `node-trace-v2.json`, and `node-eval.json`.
- Live-user claims include browser evidence.
- Red-team claims include behavior evidence and are not only prompt text.
- Memory writes distinguish real, official, human, synthetic, and model-generated sources.
- A failing run produces a repair prompt.
- A verifier/gate weakening attempt is detected.
- The dashboard reads run artifacts rather than inventing state.
- The docs say clearly that official benchmark score is separate from product-path completion.

## Competitive Positioning

Proof Loop competes in a hard product space: AI evals, observability, red teaming, CI, and internal QA all overlap.

The differentiator should be:

```text
Proof Loop proves full user workflows inside real app UIs, then turns the trace into repair memory.
```

This is different from:

- LLM tracing only
- Prompt evals only
- Red-team scanners only
- Browser test runners only
- Product analytics only
- Model leaderboards only

Proof Loop combines:

- Browser proof
- Agent trace
- Tool trace
- Artifact state
- Verifier receipt
- Reward object
- Failure memory
- Repair loop
- Promotion gate

## Source Appendix

### Existing Repo Sources

- Proof Loop source texts and ledger: [`docs/proofloop/LOOP_ENGINEERING_REQUIREMENTS.md`](./LOOP_ENGINEERING_REQUIREMENTS.md)
- NodeRL/Proof Loop source text: [`docs/proofloop/source-texts/noderl-loop-engineering-source.txt`](./source-texts/noderl-loop-engineering-source.txt)
- Accounting/router source text: [`docs/proofloop/source-texts/accounting-profile-router-source.txt`](./source-texts/accounting-profile-router-source.txt)
- NodeAgent adoption checklist: [`docs/NODEAGENT_ADOPTION.md`](../NODEAGENT_ADOPTION.md)
- Omnigent integration boundary: [`docs/OMNIGENT_INTEGRATION.md`](../OMNIGENT_INTEGRATION.md)
- Proof Loop CLI: [`scripts/proofloop-cli.ts`](../../scripts/proofloop-cli.ts)
- Proof Loop loop artifacts: [`src/eval/proofloopLoopArtifacts.ts`](../../src/eval/proofloopLoopArtifacts.ts)
- Proof Loop base artifacts: [`src/eval/proofloopArtifacts.ts`](../../src/eval/proofloopArtifacts.ts)
- Live browser proof: [`proofloop/live-browser-proof.spec.ts`](../../proofloop/live-browser-proof.spec.ts)
- Benchmark adapter contracts: [`proofloop/benchmarks/`](../../proofloop/benchmarks)
- Scaffold anti-cheat rubric: [`proofloop/rubrics/scaffold-rubric.yaml`](../../proofloop/rubrics/scaffold-rubric.yaml)

### External Product And Tool Sources

- [Playwright Trace Viewer](https://playwright.dev/docs/trace-viewer): backing source for local browser replay, DOM snapshots, action timelines, console/network inspection, and shareable traces.
- [Playwright tracing API](https://playwright.dev/docs/api/class-tracing): backing source for capturing trace artifacts from browser runs.
- [Playwright videos](https://playwright.dev/docs/videos): backing source for optional video evidence.
- [LangSmith observability](https://docs.langchain.com/langsmith/observability): backing source for trace viewing, monitoring, feedback, and automations in LLM apps.
- [LangSmith observability concepts](https://docs.langchain.com/langsmith/observability-concepts): backing source for projects, traces, runs/spans, threads, metadata, and feedback.
- [Langfuse observability overview](https://langfuse.com/docs/observability/overview): backing source for open-source LLM app tracing, latency/cost tracking, sessions, and trace IDs.
- [Langfuse data model](https://langfuse.com/docs/observability/data-model): backing source for traces, nested observations, sessions, attributes, and OpenTelemetry alignment.
- [AgentOps traces](https://docs.agentops.ai/v2/concepts/traces): backing source for trace state and agent observability concepts.
- [AgentOps recording operations](https://docs.agentops.ai/v2/usage/recording-operations): backing source for tracking operations, tools, agents, and trace decorators.
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/): backing source for recording LLM generations, tool calls, handoffs, guardrails, and custom events during agent runs.
- [OpenAI Agents guide](https://developers.openai.com/api/docs/guides/agents): backing source for Agents SDK concepts, tools, guardrails, human review, MCP, and observability integration.
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector): backing source for interactive MCP server testing/debugging.
- [MCP Inspector GitHub](https://github.com/modelcontextprotocol/inspector): backing source for local inspector/proxy ports and `npx @modelcontextprotocol/inspector` usage.
- [Promptfoo LLM red teaming](https://www.promptfoo.dev/docs/red-team/): backing source for simulated adversarial inputs and LLM red-team workflow framing.
- [Promptfoo red-team guide](https://www.promptfoo.dev/docs/guides/llm-redteaming/): backing source for automatically generated adversarial tests across RAG, agents, privacy, security, and access control.
- [OWASP LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/): backing source for direct and indirect prompt-injection risk framing.
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/): backing source for LLM app risk categories including prompt injection, insecure output handling, training data poisoning, model denial of service, and supply-chain vulnerabilities.

### External Research Sources

- [DeepMind, Specification gaming: the flip side of AI ingenuity](https://deepmind.google/blog/specification-gaming-the-flip-side-of-ai-ingenuity/): backing source for the risk that agents find shortcuts that maximize reward without satisfying designer intent.
- [Goodhart's Law summary](https://www.cna.org/analyses/2022/09/goodharts-law): backing source for the "measure becomes target" risk and why Proof Loop must not let the agent optimize the grader.
- [AI models collapse when trained on recursively generated data, Nature](https://www.nature.com/articles/s41586-024-07566-y): backing source for model-collapse risk when recursively generated model output pollutes future training data.
- [POET paper, arXiv](https://arxiv.org/abs/1901.01753): backing source for open-ended systems that generate new challenges while solving them.
- [Enhanced POET paper, arXiv](https://arxiv.org/abs/2003.08536): backing source for open-ended challenge generation and the need to avoid convergent-only optimization.

## Final Product Rule

Proof Loop should be self-improving, but not self-grading.

The certification loop decides whether a claim is true.

The exploration loop proposes what to test next.

The public demo should show both:

```text
reliability proof
+ honest failure memory
+ no reward hacking
+ app-agnostic adapter boundary
```

