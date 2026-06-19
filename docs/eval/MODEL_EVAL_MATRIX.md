# Model Eval Matrix

Last updated: 2026-06-18.

NodeRoom now treats model evaluation as a two-axis matrix:

1. **Research synthesis:** can the route read fetched evidence and write useful
   fields without the harness doing the thinking?
2. **Interactive collaboration:** can the route edit shared room state without
   clobbering humans or forcing writes through locks?

A route is not promoted by one axis alone. A cheap research winner can still be
blocked from shared-room editing until it clears the collaboration ladder.

## Curated Matrix Route Set

The source of truth is `scripts/benchmark/modelEvalConfig.ts`. This section is
the curated matrix route set, not the full OpenRouter Convex scorecard universe.
The same config also defines OpenRouter top-paid routes, and
`allAgentLlmRoutes()` expands the broader agent route set used by the Convex
benchmark docs. See `docs/eval/OPENROUTER_CONVEX_BENCHMARK.md` for that larger
scorecard.

The curated matrix separates canonical OpenRouter route IDs from NodeRoom
internal aliases:

| Route | Role | Suites |
|---|---|---|
| `nex-agi/nex-n2-pro:free` | fastest free research smoke clearer | research, collaboration candidate |
| `deepseek/deepseek-v4-flash` | prior 3-company research champion | research, collaboration candidate |
| `ibm-granite/granite-4.1-8b` | cheapest paid smoke clearer | research, collaboration candidate |
| `z-ai/glm-4.7-flash` | low-cost candidate | research, collaboration |
| `inclusionai/ring-2.6-1t` | low-cost candidate | research, collaboration |
| `xiaomi/mimo-v2.5` | candidate | research, collaboration |
| `stepfun/step-3.7-flash` | candidate | research, collaboration |
| `minimax/minimax-m3` | current MiniMax candidate | research, collaboration |
| `deepseek/deepseek-v4-pro` | higher-capability cheap candidate | research, collaboration |
| `google/gemini-3.1-flash-lite` | low-cost OpenRouter research route | research |
| `qwen/qwen3.7-plus` | candidate | research, collaboration |
| `nvidia/nemotron-3-ultra-550b-a55b` | candidate | research, collaboration |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | concrete free route | research, collaboration candidate |
| `nvidia/nemotron-3-super-120b-a12b:free` | concrete free route | research, collaboration candidate |
| `google/gemma-4-31b-it:free` | concrete free route | research |
| `openai/gpt-oss-120b:free` | concrete free route | research |
| `poolside/laguna-xs.2:free` | concrete free route | research |
| `poolside/laguna-m.1:free` | concrete free route | research |
| `openrouter/free-auto` | internal free-route alias | research, collaboration candidate |
| `gemini-3.5-flash` | current collaboration fallback | collaboration compatibility |

OpenRouter route names were checked against the live `/models` endpoint during
this pass. The 2026-06-11 cheap/free smoke attempted 28 routes from that live
catalog; 18 cleared 9/9 and the provider/harness/model failures remain in
`docs/eval/results.json`. `openrouter/free-auto` is intentionally not an
external model ID; it is NodeRoom's alias that expands to ranked free
OpenRouter routes.

## Scenario Coverage

| Scenario | Source | What It Measures |
|---|---|---|
| `company_research_v3` | `scripts/benchmark/run.ts` | `fetch_row_sources -> model-authored synthesis -> write_row`, scored by 9 checks |
| `collaboration_l1_read` | `evals/ladder.ts` | exact read, no mutation |
| `collaboration_l2_cas_edit` | `evals/ladder.ts` | exact lock/read/CAS/release |
| `collaboration_l3_conflict` | `evals/ladder.ts` | conflict observed, re-read, no clobber |
| `collaboration_l4_blocked_draft` | `evals/ladder.ts` | denied lock becomes a draft, no direct write |
| `collaboration_l5_large_range` | `evals/ladder.ts` | bounded context over a large sheet; no full-sheet read |
| `collaboration_l6_long_horizon` | `evals/ladder.ts` | compaction, repeated fresh reads, and multiple conflicts |
| `collaboration_l7_resume` | `evals/ladder.ts` | cold continuation after slice death; completed and human-revised cells untouched |

The checked-in dry-run plan is `docs/eval/model-eval-matrix-plan.json`.

## Commands

Dry-run the whole matrix:

```bash
npm run eval:model-matrix -- --json-out docs/eval/model-eval-matrix-plan.json
```

Run only the current champion research route:

```bash
npm run eval:model-matrix -- --suite=research --routes=champions --live
```

Run all supported routes live and keep going when candidate routes fail:

```bash
npm run eval:model-matrix:live
```

That live command expands to:

```bash
tsx scripts/benchmark/run.ts <research-routes> --no-merge --companies=3 --model-timeout-ms=240000 --model-reserve-ms=10000 --row-hard-timeout-ms=270000
tsx evals/ladder.ts --real <collaboration-routes> --levels=1-7 --rung-timeout-ms=540000 --reserve-ms=30000 --json-out docs/eval/model-ladder-supported.json
```

Use `--allow-failures` for bakeoffs. Candidate failures are data; promotion is
based on recorded results, not a clean shell exit across an intentionally broad
candidate pool.

## Promotion Rules

- **Background research:** route must clear v3 9/9 with fetched evidence,
  content floor, freshness, route snapshot, pricing-at-run, and trace refs.
- **Interactive collaboration:** route must clear L1-L7 in a live ladder run.
- **Default shared-room editor:** route must pass both repeated live ladder
  runs and operational budget checks.
- **Free/demo route:** route can be exposed through `/free` while still being
  blocked from default promotion.
- **Harness failure:** rows marked `environment`, `grader`, `provider`, or
  `tool_contract` do not count as model-quality failures until the failing
  owner is fixed.

This is the guardrail against the old mistake: a model pressing the right tool
button is not the same as the model understanding the workflow.
