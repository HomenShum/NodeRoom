# NodeAgent Source Map

This document pins the June 2026 review tree to the implementation that now owns
the repo. `src/nodeagent/**` is the canonical source tree for agent runtime,
models, skills, prompts, and agent-facing components. Convex remains the durable
runtime for jobs, locks, streams, and writes.

## Rule

`src/nodeagent/**` is the source of truth. Legacy `src/agent/**`,
`src/shared/formulaEngine.ts`, and `src/engine/semanticRebase.ts` were removed
once the live import graph moved over. Convex still owns durable execution, but
frontend, tests, scripts, and evals now consume the nodeagent tree directly.

## Mapping

| Review path | Repo path | Runtime status |
| --- | --- | --- |
| `src/nodeagent/core/contextCompactor.ts` | `src/nodeagent/core/runtime.ts` | Canonical implementation. |
| `src/nodeagent/core/worldModel.ts` | room snapshot / awareness context builders | Canonical implementation plus surface-to-builder map. |
| `src/nodeagent/core/formulaEngine.ts` | spreadsheet evaluation in UI + engine helpers | Canonical implementation. |
| `src/nodeagent/models/openRouterClient.ts` | `src/nodeagent/models/adapter.ts`, `openRouterFreeModels.ts` | Canonical OpenRouter-facing model helpers. |
| `src/nodeagent/models/piAiAdapter.ts` | `src/nodeagent/models/adapter.ts` | Thin compatibility seam. No second Pi runtime. |
| `src/nodeagent/skills/finance/*` | runway math, runway prompts, ingest helpers | Canonical finance skill surface. |
| `src/nodeagent/skills/search/*` | bounded `fetch_source` | Canonical search skill surface. |
| `src/nodeagent/skills/spreadsheet/*` | managed write protocol, semantic rebase, algorithm artifacts | Canonical spreadsheet skill surface. |
| `src/nodeagent/skills/integration/noderoomAdapter.ts` | `convex/convexRoomTools.ts` | RoomTools adapter contract; in-memory implementation also lives here. |
| `src/nodeagent/skills/integration/downstreamPublish.ts` | UI/export workstream | Draft-builder implemented. External Gmail/Notion/Slack/Linear adapters remain explicit future adapters. |
| `src/nodeagent/guardrails/*` | provider egress, gateway spend ceilings, provider health, workbook workflow | Canonical guardrail surface. |

Removed 2026-10-29 because nothing called them: `core/orchestrator.ts`,
`core/adaptiveRouter.ts`, `core/stateBridge.ts`, `core/fanoutPlanner.ts`,
`core/memory.ts`, `core/state.ts`, `core/streamManager.ts`, the
`components/*` review-named UI stubs, and the `guardrails/approval`,
`circuitBreaker`, `dataSanitizer`, `evaluator` and `providerEgress` stubs.
The agent workspace path is `#workspace` (`src/ui/workspace/`) backed by
`packages/nodeagent-engines`.

## Non-Negotiables

- Durable state of record stays in Convex tables and mutations.
- Agent writes go through managed locks and CAS, never client-only writes.
- Public claims must point to an eval, walkthrough manifest, or this source map.
- External downstream integrations may be demonstrated only as drafts until a
  connector adapter is implemented and tested live.

