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

## 2026-10-15 — Review round 2: per-request tiers, call-site tests, free-auto ceiling

The long-context price tier is now chosen per provider request only (`priceRequest`,
`convexPriceRequest`, reservation, meter settlement, runtime `priceStep`). Usage summed over
several requests is priced at base-tier rates (`priceRun`, `convexPriceRun`, `creditModel`,
`proofloopModelTracking`), and the ladder sums settled dispatch costs, so two 60K requests are
no longer billed as one 120K request. `claude-haiku-5-5` carries its `$0.05` cache-read rate
above 100K. The five `DEFAULT_AGENT_MODEL` call sites (`convex/agent.ts` x2, `agentJobRunner.ts`,
`streaming.ts`, `Chat.tsx`) and the remaining judge/benchmark scripts now have tests that fail
on revert; `qaMatrix` checks both `AGENT_MODEL` fallbacks. The LangChain bridge sends
`strict: true` on the forced-choice downgrade, `probe.ts` and `providerParseSmoke.ts` send the
explicit effort, `providerParseSmoke.ts` now reaches Google for Gemini ids, and the ladder
pre-flight multiplies a free-auto route by `OPENROUTER_FREE_AUTO_LIMIT`. The merge blockers
above are unchanged.

**Commit**: the commit after `0ff118a` on this branch. **Author**: Homen Shum.

## 2026-10-15 — Review round 3: cost class preserved, unknown ids fail closed, honest failed-rung cost

Closes the round-1 findings 1 and 2 that rounds 1 and 2 left open (SPEC A.0.10), plus four round-2 defects.

- **Unknown ids fail closed.** `resolveModelAlias` now throws `UnknownModelError` for an id that is not priced, not
  declared by the alias table and not free-looking, so `model()` and `convexModel()` (and the fallback lists they read)
  throw before any request. An unknown `-free` / `:free` id resolves to `openrouter/free-auto`. Pricing and telemetry
  readers (`priceRun`, `reserveDispatch`, `creditModel`, `proofloopModelTracking`, the egress policy, `benchmark/run.ts`,
  the interop normalizer) read the lenient `lookupModelAlias`, because they must tolerate historical ids and never dispatch.
- **Free never becomes paid.** A free primary no longer falls back to a paid model: adapter `fallbackModelFor` and
  `convexModel` drop the paid candidate unless the caller sets `allowPaidFallback: true` and there is a reservation
  (adapter: a `SpendMeter`, reserved in `meteredDispatch`; Convex: a finite `maxCostUsd`, estimated per candidate by the
  failover controller). Paid -> paid and paid -> free are unchanged.
- **Failed rung cost.** `runRung`'s catch branch reports the sum of its settled dispatch costs, not `0`.
- **Alias fan-out.** `ladderRequestCeiling` / `estimateLadderUsd` resolve the route before testing for free-auto fan-out,
  so `free` and `openrouter-auto` count 8 requests per step, not 1.
- **Request shape + pricing agreement.** `probe.ts` `gpt-6.1-sol` is asserted on the wire (URL, `model`, no sampling).
  `benchmark/run.ts` pricing moved to `scripts/benchmark/pricingAtRun.ts` (run.ts runs the benchmark on import) so
  `tests/modelPricingAgreement.test.ts` runs it, and the `--dry-run` sweep script, on a dated OpenRouter `/models`
  fixture; a x1e5 conversion now fails both.
- **Tests retargeted, not loosened.** `evals/ladderBudget.test.ts` (g), `tests/convexModelFreeAutoMode.test.ts` and
  `tests/modelAliasClaude.test.ts` used never-heard-of ids that were dispatched; they now assert the refusal, and the
  original invariants (zero requests, meter untouched, terminal stop, conservative reservation) are kept on the id the
  alias table declares without a price row (`claude-sonnet-4.5`).
- **Spec discrepancies left for a human (SPEC section C), not decided here:** see the PR body.

**Commit**: the commit after `55261e8` on this branch. **Author**: Homen Shum.
