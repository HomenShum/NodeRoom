# Orchestrator-Worker Model Routing

Last updated: 2026-10-29 (rewritten to match the wired code; the June 2026
version overstated what ran)

## What is wired

A durable room-agent job (`agentJobs.startPublicAsk` → the Workflow slice
runner `convex/agentJobRunner.ts`) runs one reasoning frame per slice through
`runReasoningFrame` (`src/nodeagent/core/frameRunner.ts`). Frames carry a
phase from the five-phase loop in `src/nodeagent/core/reasoningFrames.ts`:

```
intake → plan → execute → verify → synthesize
```

Before each slice, `agentJobRunner` picks the model for the active frame's
phase with `authorizedModelForFramePhase` (`src/nodeagent/models/phaseModel.ts`):

| Phase | Model |
|---|---|
| `intake`, `plan`, `verify`, `synthesize` | `AGENT_ORCHESTRATOR_MODEL` if set, else the job's resolved model policy |
| `execute` | `AGENT_WORKER_MODEL` if set, else the job's resolved model policy |

A phase model is used only if the provider egress policy allows it for this
job (`providerEgressDecision`); otherwise the job's resolved model is kept.
Jobs with no active frame use the resolved model for the whole slice.

The resolved model policy itself comes from `defaultModelPolicyForRoute` in
`convex/agentJobs.ts` when the request did not pin one:

| Route | Default, in order |
|---|---|
| default / interactive | `AGENT_ORCHESTRATOR_MODEL` → `AGENT_MODEL` → `gemini-3.5-flash` |
| research mode | `AGENT_RESEARCH_MODEL` → `AGENT_WORKER_MODEL` → `minimax/minimax-m3` |
| top paid | `AGENT_TOP_PAID_MODEL` → `AGENT_MODEL` → `anthropic/claude-sonnet-4` |
| free | `openrouter/free-auto` |

So the orchestrator/worker split is env-driven: with neither
`AGENT_ORCHESTRATOR_MODEL` nor `AGENT_WORKER_MODEL` set, every phase runs on the
same model. No model is hard-coded as "the orchestrator". `moonshotai/kimi-k3`
is only the first entry of the OpenRouter `agent` fallback ladder in
`src/nodeagent/models/modelCatalog.ts`, used when an OpenRouter route needs a
fallback.

## Supporting pieces

| Concern | Where |
|---|---|
| Per-frame context envelope | `src/nodeagent/core/contextPack.ts` |
| Frame status/evidence receipt | `src/nodeagent/core/frameVerifier.ts` |
| Per-slice spend ceiling (`AGENT_MAX_USD_PER_SLICE`) | `spendLimitsForJob` in `convex/agentJobRunner.ts` → `runAgent` → `checkSpendCeiling` (`src/nodeagent/guardrails/gateway.ts`) |
| Daily/monthly caps (`ROOM_MAX_USD_PER_DAY`, `GLOBAL_MAX_USD_PER_MONTH`) | read in `convex/agent.ts` (the inline publish-to-room lane), not in the durable runner |
| Durable frame rows | Convex `agentReasoningFrames` table |

Cost is bounded by those caps, not by model choice. There is no checked-in
receipt comparing the cost of a split run against a single-model run, so this
doc makes no cost-savings claim.

## Nebius Token Factory provider

Models prefixed `nebius/` route to Nebius's OpenAI-compatible endpoint
(`https://api.tokenfactory.nebius.com/v1/`) in `getProviderForModel()`; the
prefix is stripped before the call. Auth is `NEBIUS_API_KEY`. Pricing and
aliases live in `src/nodeagent/models/modelCatalog.ts`; request routing in
`src/nodeagent/models/convexModel.ts`; `nebius` is in
`DEFAULT_ALLOWED_PROVIDERS` (`src/nodeagent/guardrails/egressPolicy.ts`).

## Not this

This is the routing inside the Convex room agent. It is not the agent
workspace: `#workspace` + `packages/nodeagent-engines` (`npm run agent:worker`)
runs each provider's own SDK loop, and its engines and qualified capabilities
are in `packages/nodeagent-engines/qualification/*.json`.

## Non-Goals

- No permanent subagent per entity or facet. Frames are ephemeral runs.
- No peer-to-peer subagent communication. Coordination goes through frames.
- No model-specific prompt modes. The split is a routing policy, not a prompt template.
- No bypass around Convex auth, CAS, locks, proposals, or evidence write gates.
  Execute-phase frames have the same managed-write constraints as any other frame.
