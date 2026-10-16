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

## 2026-10-16 — Review round 5: known ids from the repo's lists, one guard per boundary, D2 for top_paid, REA/ORX

Closes the round-3 review of the refreshed ids (SPEC-v9 D1, D2, D5; A.0.4, A.0.6, A.0.10).

- **Known = named by the repo or by SPEC section 1.2 (D1).** `REPO_DECLARED_UNPRICED_IDS` now holds every
  `OPENROUTER_TOP_PAID_AGENT_ROUTES` route and every section 1.2 wire id on every transport. Before this, 9 of the 19
  top-paid routes and 18 of the 32 section 1.2 ids threw `UnknownModelError`, so `model-eval-matrix --route-set top-paid`
  broke for those routes. `tests/modelKnownIds.test.ts` now reads `resolveRouteSet(...)` for all six route sets,
  `allAgentLlmRoutes()` and the section 1.2 list (typed in the test, because the spec lives outside this repo).
- **Eval scripts stay pass-through (D1).** `model(id, { operatorSelected: true })` keeps an operator- or live-list-selected
  id as written: an unknown paid id is not refused and a concrete `:free` id is not rewritten to `openrouter/free-auto`.
  Only `scripts/benchmark/run.ts`, `scripts/proofloop-free-model-gauge.ts`, `evals/ladder.ts` (`--real`, including
  `ladder:free --free-auto-top`), `scripts/spreadsheetbench-run.ts` and `evals/chatIntakeRuntime.ts` set it. Server code
  never does. The alias table still applies.
- **PlanPreview-blocked runs record again.** `runRoomAgent` records a blocked run with the marker `modelPolicy: "not_started"`
  (no model runs). The boundary check rejected it, so the plan message and the credit settlement were never reached. The
  marker is accepted only together with `initialStatus: "blocked"`. A convex-test drives `runRoomAgent`'s blocked branch.
- **Private stream and capture fail closed.** `streamPrivateReplyText` and `aiSdkReasoner` call `resolveModelAlias` first
  (one guard each; `aiSdkReasoner` covers `capturesNode`, `captureSource` and the Firecrawl tool). Tests assert 0 fetch calls
  for an unknown `AGENT_MODEL` and for `claude-not-in-catalog-9`, `gpt-not-in-catalog`, `o3-not-in-catalog`, `claude-opus-9`.
- **Call sites driven, not grepped.** `tests/modelRefreshAgentWire.test.ts` runs `runRoomAgent` (public_ask),
  `runPrivateAgent` and `runFreeAutoJobSlice` (a claimed job with no `modelPolicy`) through a convex-test database and a
  fake `fetch`, and asserts the model in the request URL is `gemini-3.8-flash` (or the `AGENT_MODEL` override) and that no
  sampling key is sent. Reverting `modelNameForEgress` to always return the file-egress model, or the runner default to
  `gemini-3.5-flash`, fails five of its six tests.
- **D2 for `top_paid`.** `convex/agentJobs.ts` `top_paid` defaulted to the retired `anthropic/claude-sonnet-4`; round 1
  moved it to `anthropic/claude-sonnet-5.5`. No OpenRouter key exists, so under D2 it is now
  `DEFAULT_TOP_PAID_MODEL = nvidia/nemotron-3.5-super-vl:free` (`convex/modelDefaults.ts`), the newest `:free` row of the
  public list `https://openrouter.ai/api/v1/models` (fetched 2026-10-16T11:32:04Z, recorded in
  `docs/eval/openrouter-free-models-2026-10-16.json`) with `tools`, `tool_choice`, `structured_outputs`, a 1,000,000-token
  context, text output and no `expiration_date`. Newer or equal rows were skipped on the stated criteria:
  `dots-studio/dots-3-note-preview:free` and `poolside/laguna-s-2.1:free` carry an `expiration_date`; `liquid/lfm-2.5-2.6b:free`
  has 65,536 context; `nvidia/nemotron-3.5-lightning:free` and the two `thinkingmachines` rows lack `structured_outputs` or
  `tool_choice`. **Marked: live-unverified (no key, Homen 2026-10-16).** Behaviour change to expect: a free route cannot take
  an uploaded file, so a `top_paid` job in a room with a file is refused at the free-file-egress gate (or promoted to
  `z-ai/glm-4.7-flash` when the existing `FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION` opt-in is set) unless `AGENT_TOP_PAID_MODEL` or
  `AGENT_MODEL` is set; those env vars still win. The `anthropic/claude-sonnet-5.5` request-shape handling (`auto` plus
  `strict: true`) stays in `convexModel` and its test for an operator who sets that id. Merge blocker 3 (the Environment
  smoke for `claude-sonnet-5.5`) therefore no longer applies to a code default.
  - Other OpenRouter-routed rows: `providerParserLive.ts:113` only drops the unlisted `nex-agi/nex-n2-pro`; it picks no new
    target, the remaining candidates are frozen paid routes with no vendor successor (D2a), so D2 does not apply.
    `modelRegistry.ts:48` stays **defer** (`anthropic/claude-fable-5` is active, floor 2027-06-09), so D2 does not apply.
- **Docs.** The `.env.example` note on `NODEAGENT_FREE_AUTO_GOOGLE_MODEL` now says the direct Gemini leg is opt-in
  (`allowPaidFallback` plus a meter, `adapter.ts`) and that no production caller sets either.

### REA (how mature references do the same thing) and ORX (primary sources), fetched 2026-10-16

REA reads the mechanisms this PR touches: an explicit alias table instead of a regex, a known-id registry that fails
closed, tiered per-request pricing, a spend meter. Facts, with what was adopted or rejected.

| Reference (fetched) | Fact observed | Adopted | Rejected |
|---|---|---|---|
| LiteLLM `model_prices_and_context_window.json` (raw.githubusercontent.com/BerriAI/litellm/main, 4,194 entries, 2026-10-16T14:44Z) | One flat map keyed by provider-prefixed wire id (`gemini/gemini-3.8-flash`, `vertex_ai/gemini-3.8-flash`, `claude-haiku-5-5`, `bedrock_mantle/anthropic.claude-haiku-5-5`). Tier prices are separate keys on the same row (`input_cost_per_token_above_100k_tokens`, `*_above_200k_tokens`, `cache_read_input_token_cost_above_100k_tokens`); `claude-haiku-5-5` carries 5e-07 / 2.5e-06 / 5e-08 above 100K. `deprecation_date` is per row and differs by transport (`azure_ai/claude-sonnet-5` 2027-06-30, `vertex_ai/claude-sonnet-5` 2026-12-24, native `claude-sonnet-5` null). `max_output_tokens` is 128000 for `claude-haiku-5-5`. | An id is looked up by its exact wire string per transport (the explicit table, no regex); the tier is a field of the price row and is chosen per request; a lifecycle date belongs to the transport, not to the model name (SPEC B.1). Our Haiku 5.5 tier ($0.50 / $2.50 / cache read $0.05 above 100K) equals LiteLLM's. | A single unified id space across transports; regional multipliers (`us.anthropic.*` rows at 1.1x) and batch keys, which no NodeRoom path uses. |
| models.dev `https://models.dev/api.json` (231 providers, 2026-10-16T14:44Z) | `anthropic/claude-haiku-5-5`: cost 0.1 / 0.5, `cache_read` 0.01, `cache_write` 0.125, one `tiers` entry `{type: "context", size: 100000}` at 0.5 / 2.5 / 0.05 / 0.625; `limit.output` 128000; `release_date` 2026-10-07; `tool_call` and `structured_output` true. Resellers re-price the same model (`poe/google/gemini-3.8-flash` input 0.7576 against 0.75 at the vendor). | The tier boundary (100K prompt tokens, per request) and the vendor rates cross-check our table; `release_date` agrees with the spec. | Reseller rows as a price source: prices come from the vendor page, never an aggregator. |
| OpenRouter `GET /api/v1/models` (public, no key; 465 rows, 2026-10-16T11:32:04Z; earlier reads 2026-10-10 and 2026-10-14 in the spec) | Each row has `id`, `created`, `context_length`, per-token string `pricing`, `supported_parameters` (`tools`, `tool_choice`, `structured_outputs`) and `expiration_date`; 18 of 465 rows carry an `expiration_date`, including two of the newest `:free` rows. | Capability selection from `supported_parameters`, the `expiration_date` exclusion and `created` ordering for D2; the per-token to per-1M conversion is already pinned by `tests/modelPricingAgreement.test.ts`. | Treating absence from the list as a vendor retirement (it is "unlisted on this transport", SPEC 1.1). |
| Vercel AI SDK `@ai-sdk/anthropic` 3.0.120 (installed source, `dist/index.mjs` `getModelCapabilities`, read 2026-10-16) | Capabilities are matched by substring. `claude-haiku-5-5` matches no 5.x branch (only `claude-opus-5-5`, `claude-opus-5` and `claude-sonnet-5` do), so it falls into the generic `claude-` branch: `maxOutputTokens` 128000, `isKnownModel: false`. The SDK reports the flag and still dispatches. | The `isKnownModel` idea, enforced instead of reported: `resolveModelAlias` throws `UnknownModelError`, and `modelMaxOutputTokens` keeps its own 2048 floor and caps for the 5.5 ids rather than trusting the SDK fallback. | Substring matching (it is how `claude-haiku-5-5` ended up in the fallback branch). |

ORX, primary sources behind the ids, prices and dates in this PR (ids and prices were not taken from recall):

- Claude ids, prices and floors: `frontier.json` (read 2026-10-10, which cites `platform.claude.com/docs/en/models/overview`
  and the release notes); the Anthropic deprecations page re-read live 2026-10-14 (stored copy
  `_scratch/anthropic-deprecations-2026-10-14-v8.html` in the model-defaults workspace): `claude-haiku-4-5-20251001` Active,
  floor 2026-10-15; `claude-sonnet-4-5-20250929` deprecated, retires 2026-11-30.
- Gemini ids, prices and the `gemini-3.5-flash` deprecation (2026-10-08) and `gemini-3.1-flash-tts-preview` shutdown
  (2026-11-17): `frontier.json` (read 2026-10-10), Google's deprecations table as quoted in SPEC 1.1.
- OpenAI ids and the 2026-10-14 GPT-4-series notice (removal 2027-01-14): OpenAI deprecations page re-read live 2026-10-14.
- OpenRouter ids, `expiration_date` and the D2 selection: the public list above, recorded in
  `docs/eval/openrouter-free-models-2026-10-16.json` (all 15 `:free` rows with the criteria columns).
- Not verified by a request: no provider call was made. Every `:free` route and the Claude 5.5 ids over OpenRouter are
  request-shape tested against a fake transport only.
