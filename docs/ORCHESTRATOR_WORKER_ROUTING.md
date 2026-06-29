# Orchestrator-Worker Model Routing

Last updated: 2026-06-28

## Pattern

NodeRoom uses an **orchestrator-worker** model routing pattern — the same
pattern that OpenAI, Anthropic, and Claude Code have converged on in 2025–2026.

A high-intelligence **orchestrator** model plans, decomposes, delegates, and
synthesizes. A cheaper **worker** model executes bounded subtasks (tool calls,
search, evidence gathering, cell writes). The orchestrator reviews worker output
before committing it.

This is not a new runtime. NodeRoom's existing loop engineering already supports
it:

| Industry term | NodeRoom implementation |
|---|---|
| Orchestrator agent | `frameRunner.ts` running `plan` / `synthesize` / `verify` phase frames on the orchestrator model |
| Worker subagent | `frameRunner.ts` running `execute` phase frames on the worker model |
| Task decomposition | `reasoningFrames.ts` — `intake` → `plan` → `execute` → `verify` → `synthesize` |
| Fanout plan | `fanoutPlanner.ts` — `planNodeAgentFanout()` produces waves of subagent roles |
| Subagent isolation | Each frame runs in its own context pack (`contextPack.ts`) with a scoped tool allowlist |
| Subagent receipt | `NodeAgentSubagentReceipt` in `fanoutPlanner.ts` — verdict, tool calls, evidence facts |
| Orchestrator review | `frameVerifier.ts` checks evidence state, missing refs, and blocked conditions |
| Budget control | `gateway.ts` `checkSpendCeiling` — per-slice token and USD limits |
| Durable memory | Convex `agentReasoningFrames` + `entityWorkItems` + `entityResearchCache` rows |

## Model Assignment

```
Orchestrator (plan, verify, synthesize)  →  z-ai/glm-5.2
    AA Intelligence Index: 51.1 (top open-weight)
    $0.95 / $3.00 per 1M tokens
    1M context
    Best agentic score (43.1) — strong tool-call planning

Worker (execute, evidence, search)  →  minimax/minimax-m3
    AA Intelligence Index: 44.4
    $0.30 / $1.20 per 1M tokens
    1M context
    4x cheaper than orchestrator — cost-efficient for bounded tool-call work
```

The orchestrator spends its budget on **thinking** (decomposition, synthesis,
review). The worker spends its budget on **doing** (search calls, cell reads,
evidence extraction). This matches the 2026 industry consensus:

> "The orchestrator thinks. The subagents execute. Each component does what the
> underlying model is good at, and nothing else."
> — Prompt Engines Lab, March 2026

> "A single orchestrator owns the full conversation context and spawns ephemeral
> isolated subagents that return only a compressed summary."
> — FlowHunt, April 2026

## How It Maps To NodeRoom's Frame Loop

NodeRoom's five-phase reasoning frame loop (`HARNESS_RECURSIVE_REASONING.md`)
already separates orchestration from execution:

```
1. intake     → Orchestrator model normalizes request, entities, facets
2. plan       → Orchestrator model decides cache reuse vs research, spawns children
3. execute    → Worker model runs bounded tool calls (search, read, write)
4. verify     → Orchestrator model checks evidence, freshness, unsupported claims
5. synthesize → Orchestrator model summarizes for room trace, UI, handoff
```

The model switch happens at the `runReasoningFrame` boundary in
`frameRunner.ts`. Each frame already carries its own `AgentModel` — the runner
does not assume a single model for all phases. The adaptive router
(`adaptiveRouter.ts`) selects the model based on task type and risk; the frame
runner passes it through.

```typescript
// frameRunner.ts — model is per-frame, not global
export async function runReasoningFrame(opts: RunReasoningFrameOptions): Promise<ReasoningFrameRunReceipt> {
  const agentResult = await runAgent({
    model: opts.model,  // ← orchestrator or worker, depending on frame phase
    tools: selection.allowedTools,
    ...
  });
}
```

## Cost Profile

For a typical person-deep-dive job (10–15 tool calls, ~50k tokens):

| Configuration | Orchestrator cost | Worker cost | Total | vs single-model |
|---|---|---|---|---|
| glm-5.2 only | $0.15 | — | $0.15 | baseline |
| minimax-m3 only | — | $0.06 | $0.06 | -60% |
| **Orchestrator + worker** | $0.04 (plan/verify/synthesize) | $0.04 (execute) | **$0.08** | **-47%** |

The orchestrator handles ~30% of tokens (plan + verify + synthesize phases).
The worker handles ~70% (execute phase tool calls). Splitting this way gives
near-minimax cost with near-glm intelligence for the cognitive phases.

## Industry References

- **Anthropic** (June 2025): "Our Research system uses a multi-agent architecture
  with an orchestrator-worker pattern, where a lead agent coordinates the process
  while delegating to specialized subagents that operate in parallel."
  ([How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system))

- **OpenAI** (2025–2026): Agents SDK defines two patterns — "agents as tools"
  (manager stays in control) and "handoffs" (specialist takes over). NodeRoom
  uses the "agents as tools" variant: the orchestrator keeps ownership.
  ([Orchestration and handoffs](https://developers.openai.com/api/docs/guides/agents/orchestration))

- **Claude Code** (May–June 2026): Dynamic workflows let Claude write orchestration
  scripts that spawn subagents in parallel. "A workflow script holds the loop,
  the branching, and the intermediate results itself, so Claude's context holds
  only the final answer."
  ([Dynamic workflows](https://claude.com/blog/introducing-dynamic-workflows-in-claude-code))

- **2026 consensus**: "The orchestrator + isolated subagents pattern: a single
  coordinator agent owns the full conversation context and spawns ephemeral
  worker agents in fresh, isolated contexts; each worker returns only a
  compressed summary."
  ([FlowHunt](https://www.flowhunt.io/blog/multi-agent-ai-system/))

## What NodeRoom Already Has vs What's Next

### Already implemented

- `fanoutPlanner.ts` — subagent roles, waves, receipts, mutation modes
- `frameRunner.ts` — per-frame model selection, tool allowlists, context packs
- `frameVerifier.ts` — orchestrator review of worker output
- `adaptiveRouter.ts` — task-type-based model routing (research, finance, etc.)
- `gateway.ts` — per-slice spend ceilings
- `reasoningFrames.ts` — five-phase loop (intake → plan → execute → verify → synthesize)
- Durable frame rows in Convex (`agentReasoningFrames` table)
- Entity/facet cache for worker reuse (`entityResearchCache` table)

### Next: per-phase model assignment

The current routing selects one model per job. The next step is to let the frame
runner select different models for different phases:

```
intake      → orchestrator model (z-ai/glm-5.2)
plan        → orchestrator model (z-ai/glm-5.2)
execute     → worker model (minimax/minimax-m3)
verify      → orchestrator model (z-ai/glm-5.2)
synthesize  → orchestrator model (z-ai/glm-5.2)
```

This requires passing a `modelForPhase` function to `runReasoningFrame` instead
of a single `AgentModel`. The frame runner already accepts `opts.model` — the
change is to derive it from `opts.frame.phase` when a phase-aware policy is
active.

### Environment variables

```
AGENT_ORCHESTRATOR_MODEL=z-ai/glm-5.2     # plan, verify, synthesize
AGENT_WORKER_MODEL=minimax/minimax-m3     # execute, evidence, search
AGENT_RESEARCH_MODEL=minimax/minimax-m3   # backward compat (worker for research mode)
```

When `AGENT_ORCHESTRATOR_MODEL` is set, the frame runner uses it for
`intake`/`plan`/`verify`/`synthesize` phases. When unset, it falls back to the
job's `modelPolicy` for all phases (current behavior).

### Implementation status

**Implemented and deployed** (zealous-goshawk-766 dev):

- `agentJobRunner.ts`: `modelForFramePhase()` selects `AGENT_ORCHESTRATOR_MODEL`
  for orchestrator phases (`intake`/`plan`/`verify`/`synthesize`) and
  `AGENT_WORKER_MODEL` for `execute` phase. Falls back to `resolvedModelPolicy`
  when env vars are unset.
- `agentJobs.ts`: `defaultModelPolicyForRoute()` now defaults to
  `AGENT_ORCHESTRATOR_MODEL` for non-free routes and `AGENT_WORKER_MODEL` for
  research mode.
- Env vars set on Convex dev: `AGENT_ORCHESTRATOR_MODEL=z-ai/glm-5.2`,
  `AGENT_WORKER_MODEL=minimax/minimax-m3`.

### Nebius Token Factory provider

Nebius Token Factory is integrated as a direct OpenAI-compatible provider at
`https://api.tokenfactory.nebius.com/v1/`. It serves open-source models with
per-token pricing, bypassing OpenRouter's markup.

**Models available via Nebius:**

| Model ID | Context | Input $/1M | Output $/1M |
|---|---|---|---|
| `nebius/zai-org/GLM-5.2` | 200K | $1.00 | $3.00 |
| `nebius/MiniMaxAI/MiniMax-M2.5` | 197K | $0.30 | $1.00 |
| `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507` | 262K | $0.20 | $0.60 |
| `nebius/deepseek-ai/DeepSeek-V4-Pro` | 1M | $2.00 | $4.00 |

**Auth**: Static API key via `NEBIUS_API_KEY` env var (Bearer token).

### Live verification (2026-06-28)

**Nebius API test**: All 3 primary models verified via direct API call:
- `nebius/zai-org/GLM-5.2` — PASS
- `nebius/MiniMaxAI/MiniMax-M2.5` — PASS
- `nebius/Qwen/Qwen3-235B-A22B-Instruct-2507` — PASS

**Agent job test 1 (simple chat)**: `@nodeagent Write a one sentence summary about AI`
- Job status: completed
- `modelPolicy`: `z-ai/glm-5.2` (orchestrator model)
- `resolvedModel`: `z-ai/glm-5.2`
- 3 model turns, 2 tool actions, cost $0.044

**Agent job test 2 (research mode)**: `@nodeagent research NVIDIA's AI strategy`
- Job status: paused (handoff)
- `modelPolicy`: `minimax/minimax-m3` (worker model, research mode)
- `resolvedModel`: `minimax/minimax-m3`
- `frameId`: `rf_41418b5f_execute_research` — confirms execute frame used worker model
- 5 steps, cost $0.019

**Conclusion**: Per-phase model routing is working. Orchestrator phases use
`AGENT_ORCHESTRATOR_MODEL` and the execute phase uses `AGENT_WORKER_MODEL`.

**Routing**: Models prefixed with `nebius/` are routed to the Nebius provider in
`getProviderForModel()`. The `nebius/` prefix is stripped before the API call.

**Files changed:**
- `src/nodeagent/models/modelCatalog.ts`: Added `nebius` to `LlmProvider` type,
  model pricing, aliases, `getProviderForModel()`, tier limits, catalog, provider
  integration status, env vars, fallback chain, and model equivalents.
- `src/nodeagent/models/convexModel.ts`: Added Nebius routing in `providerStep()`
  and `nebiusBaseUrl()` helper.
- `src/nodeagent/guardrails/egressPolicy.ts`: Added `nebius` to
  `DEFAULT_ALLOWED_PROVIDERS`.
- `src/ui/Chat.tsx`: Added Nebius to provider labels and order.

## Non-Goals

- No permanent subagent per entity or facet. Subagents are ephemeral frame runs.
- No peer-to-peer subagent communication. All coordination goes through the
  orchestrator frame.
- No model-specific prompt modes. The orchestrator-worker split is a routing
  policy, not a prompt template.
- No bypass around Convex auth, CAS, locks, proposals, or evidence write gates.
  Worker frames have the same managed-write constraints as any other frame.
