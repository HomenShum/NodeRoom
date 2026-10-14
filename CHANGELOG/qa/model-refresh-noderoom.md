# Model default refresh (NodeRoom)

Append-only lane for the 2026-10 refresh of NodeRoom's default model ids
(model-defaults SPEC Part A, section A.2.9).

## 2026-10-14 — Refresh stale model defaults and fix Claude 5.5 request shapes

Google deprecated `gemini-3.5-flash` on 2026-10-08 and OpenRouter drops
`google/gemini-2.5-*` on 2026-10-20, so the agent default moves to one constant,
`DEFAULT_AGENT_MODEL` (`convex/modelDefaults.ts`, `gemini-3.8-flash`). Claude
defaults move to the 5.5 ids, the dotted-id regex in `resolveModelAlias` becomes
an explicit table, forced `tool_choice` is downgraded to `auto` for Sonnet/Opus
5.5, and `evals/ladder.ts` now refuses a `--real` run without a dollar cap and
reserves cost at every provider dispatch. Merge waits for the L1-L4 ladder
receipt `docs/eval/ladder/model-refresh-noderoom.json`; until it exists
`tests/qaMatrix.test.ts` stays red on purpose, and the fast lane in
`adaptiveRouter.ts` stays on `gemini-3.5-flash`.

**Commit**: `922fdb6`. **Author**: Homen Shum.

## 2026-10-14 — Review round 1: merge blockers, receipt fields, tiered pricing

PR 261 is a draft and carries the `needs-live-eval` label; both stay until the three
live checks below exist (SPEC A.0.3: the label is a block, not a note):

1. the L1-L4 ladder receipt `docs/eval/ladder/model-refresh-noderoom.json`;
2. the manual listen check of `gemini-3.8-flash-tts` (`convex/http.ts:36`, A.0.7);
3. the observed Environment smoke that OpenRouter accepts `anthropic/claude-sonnet-5.5`
   for `top_paid` with `tool_choice: auto` and `strict: true` tool definitions.

Fixes: the `--json-out` report now carries `command`, `candidateIds`, `echoedModels`,
per-dispatch `rows` (provider-echoed model, usage, cost, `fallbackUsed`), `environment`
and `budget.requestCeiling`, so a receipt can be judged against A.0.3. The echoed model is
read from the raw response body (`modelVersion` / `model`) because the AI SDK's
`response.modelId` is the requested id for Google. A refused reservation is terminal for the
meter: no retry, fallback model or candidate may dispatch after it, and the provider-neutral
Google fallback honours `crossModelFallback: false`. `claude-haiku-5-5` is priced
tier-aware (`longContext`, $0.50/$2.50 above 100K prompt tokens) in every cost and
reservation path. Sonnet/Opus 5.5 send `strict: true` tool definitions wherever a forced
`tool_choice` is downgraded to `auto`; the AI-SDK capture reasoner and provider parser send
the explicit §1.3 effort. `.env.example` copies of the changed defaults now match the code.

**Commit**: the commit after `71a1f15` on this branch. **Author**: Homen Shum.
