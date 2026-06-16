# Omnigent Integration

This repo treats Omnigent as an outer meta-harness and NodeAgent as the
room-native reasoning kernel.

Current Omnigent public docs describe a YAML agent spec with `executor`,
`tools`, `policies`, `os_env`, and `terminals`; they also position Omnigent as a
common layer over multiple harnesses and custom agents:

- https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- https://github.com/omnigent-ai/omnigent

## Ownership Boundary

| Layer | Owns | NodeRoom implementation |
|---|---|---|
| Omnigent | harness/model choice, session sharing, OS sandbox, terminal orchestration, policy gates, cross-agent review | `examples/omnigent/*.yaml` |
| NodeAgent | room context packs, reasoning frames, cache/freshness, evidence state, lock/CAS/draft writes, durable job ledger | `src/nodeagent`, `convex/agentJobs.ts`, `convex/schema.ts` |
| Convex | transactional source of truth, job status, receipts, cache rows, reasoning-frame rows, trace queries | `convex/*` |

Do not push NodeAgent memory into Omnigent YAML prompts. The YAML can choose who
runs and what OS access/policies apply; `agentJobs`, `agentReasoningFrames`,
`entityWorkItems`, and `entityResearchCache` remain the durable cognition layer.
The detailed NodeAgent-side decision record is
[`HARNESS_RECURSIVE_REASONING.md`](HARNESS_RECURSIVE_REASONING.md).
The minimal local adoption proof is
[`examples/nodeagent-frame-runner/minimal.ts`](../examples/nodeagent-frame-runner/minimal.ts)
and runs with `npm run nodeagent:frame:smoke`.

## Repo State

The pasted "Fable-like harness" plan maps to the current repo this way:

- Frame plan and context packs: `src/nodeagent/core/reasoningFrames.ts`
- Frame runtime above `runAgent`: `src/nodeagent/core/frameRunner.ts`
- Frame context/reducer/verifier: `src/nodeagent/core/contextPack.ts`,
  `src/nodeagent/core/frameReducer.ts`, `src/nodeagent/core/frameVerifier.ts`
- Durable frame rows: `convex/schema.ts` table `agentReasoningFrames`
- Room-work frame materialization: `convex/agentJobs.ts`
- Entity/facet cache and freshness: `entityResearchCache`
- Child work items: `entityWorkItems`
- Job detail frame visibility: `agentJobs.detail().reasoningFrames`
- Source-shape tests: `tests/agentJobsSource.test.ts`
- Job/runtime tests: `tests/agentJobsRuntime.test.ts`
- Frame-runner and UI tests: `tests/frameRunner.test.ts`,
  `tests/chatReasoningFrames.test.tsx`

## Example Runs

From the repo root, after installing Omnigent:

```bash
omnigent run examples/omnigent/nodeagent-room.yaml
omnigent run examples/omnigent/nodeagent-reviewer.yaml
```

The examples are deliberately local. They rely on the existing repo commands
instead of inventing a second agent API:

```bash
npm test -- --run tests/agentJobsSource.test.ts tests/agentJobsRuntime.test.ts tests/frameRunner.test.ts tests/chatReasoningFrames.test.tsx
npm run nodeagent:frame:smoke
npm run build
npx tsc --noEmit --project convex/tsconfig.json --pretty false
```

For live provider smoke, configure provider credentials through the existing
protected environment path before running smoke commands. Do not paste provider
keys into YAML, shell history, PR comments, or documentation.

## Policy Guidance

Use Omnigent policies for governance, not memory:

- Require approval before shell writes outside the repo.
- Cap provider spend for exploratory runs.
- Restrict network access unless running live provider smoke.
- Route code-writing and review to different harnesses when useful.
- Keep credentials in Convex env or Omnigent provider config, not in YAML.

Use NodeAgent/Convex for durable state:

- `agentReasoningFrames` stores frame lineage and phase/child status.
- `runReasoningFrame` narrows work to a frame context pack and tool allowlist,
  executes the existing NodeAgent loop, then returns a delta and verifier
  receipt for persistence/orchestration.
- `entityResearchCache` stores room-local entity/facet results with freshness.
- `agentOperationEvents` and receipts store what actually happened.
- OKF remains the portable evidence graph.

## What Not To Do

- Do not create a permanent agent per company/person/facet.
- Do not represent cache/freshness/evidence only in the Omnigent transcript.
- Do not let a meta-harness policy replace CAS, locks, draft review, or Convex
  auth checks.
- Do not claim official Omnigent compatibility beyond the checked YAML shape
  until the examples are run against the installed Omnigent version in CI.
- Do not claim Omnigent owns recursive memory; it starts/governs NodeAgent, while
  NodeAgent/Convex persist the frame/cache/evidence state.
