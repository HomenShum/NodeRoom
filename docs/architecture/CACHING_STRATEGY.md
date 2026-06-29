# Prompt-caching + context strategy for NodeRoom (orchestrator/worker, cheap mixed models)

Researched 2026-06-28 from primary sources (Manus, Cognition, Anthropic, OpenAI/Google/DeepSeek docs,
"Don't Break the Cache" arXiv:2601.06007). Prescriptive strategy + cost decision rule.

## The one rule all sources agree on (uncontested)

> Hold a byte-stable, static-first prefix so the KV-cache hits; push everything volatile to the end;
> externalize the rest; and measure the cache-hit rate as your #1 metric.

- Manus (Context Engineering for AI Agents): "KV-cache hit rate is the single most important metric...
  a single-token difference can invalidate the cache."
- Anthropic (Effective context engineering): "the smallest set of high-signal tokens"; static first.
- "Don't Break the Cache" (arXiv:2601.06007): dynamic content at the end -> 41-80% cost, 13-31% latency
  reduction vs naive full-context caching.
- OpenAI / Google / DeepSeek: identical structural rule (static-first, exact-prefix match).

## The one place top labs disagree - and which side we're on

Cognition ("Don't Build Multi-Agents": single thread + compaction) vs Anthropic ("orchestrator-worker
for parallel read-heavy research"). Reconciliation both now hold: parallel READERS -> one WRITER is fine;
parallel WRITERS are fragile.

- Workers do retrieval/search (read-heavy) -> Anthropic's blessed pattern -> keep the fan-out.
- Workers write the same artifact in parallel -> Cognition's fragile zone -> serialize writes through the
  orchestrator (workers propose; orchestrator commits via the artifact-version CAS we already have).
- Budget caveat: Anthropic accepts ~15x tokens "where task value is high." We're on $150/mo -> adopt
  Anthropic's architecture, Cognition's frugality (cache the orchestrator thread + smallest worker pack).

## Cost model (why the cost lens FLIPS the recall verdict for the worker tier)

A cache is per-model, per-account, prefix-keyed, TTL-bounded - never cross-model.

| surface | model | cache state | injected-context cost |
|---|---|---|---|
| Orchestrator thread | glm-5.2 | HIT on stable head | ~$0.26/M read -> a bigger window is nearly free per turn |
| Worker injected context | minimax-m3 | MISS (cross-model, per-task) | full $0.30/M x tokens x N workers, every fan-out |

So: compress what you re-pay in full (per-worker injected context -> NodeMem); let cache amortize what
repeats on one model (the orchestrator thread -> a bigger awareness window is fine there). This is the
opposite of the recall-only "just raise the window" - both are right, on different tiers.

Sourced numbers (verify vs live usage): glm-5.2 input $1.40/M ($0.95 cheapest OR route) / cache-read
$0.26/M ($0.14 routed); minimax-m3 input $0.30/M / cache-read $0.06/M (passive, no write fee). Both surface
caching via OpenRouter, but glm reports supports_implicit_caching:false -> best-effort, route-dependent.

## The playbook (mapped to code)

Orchestrator thread (glm-5.2) - src/nodeagent/models/prompts/systemPrompt.ts, adapter.ts
- [done] System head already has no timestamp/roomId/taskId (verified) - add a guard test.
- [ ] Deterministic JSON (sorted keys) anywhere we serialize state/args/the memory pack into the prompt.
- [ ] Static->dynamic order; the awareness window + memory pack sit AFTER the breakpoint, never in the head.
- [ ] Stable tool set - mask, don't remove mid-run.
- [ ] Append-only (keep errors in context).
- [ ] Pin the OpenRouter provider so the route + cache stay warm (see "next step").

Worker tier (minimax-m3) - src/nodeagent/core/fanoutPlanner.ts, src/nodemem/*
- [ ] Byte-identical shared system/tools prefix across all workers (role goes in the body, not the head).
- [ ] Warm the shared prefix with one call before fanning out (avoid N cold-write races).
- [ ] Inject the smallest relevance-ranked NodeMem pack - THIS is where NodeMem belongs, not a raw window.
- [ ] Pass identifiers (artifactId, cell range, URL), not blobs; restore on demand.
- [ ] Workers return condensed ~1-2k summaries, not raw traces.

Memory - src/nodemem/*, Convex as the external store
- [ ] Short/early thread -> raw window; long/accumulating -> NodeMem pack + Convex store. Our per-call
  accumulated room context -> NodeMem-by-default.

Measurement - src/nodeagent/models/adapter.ts, agentRuns
- [DONE] cachedInputTokens is captured in the adapter, accumulated in runtime, and persisted on agentRuns
  (commit 9461537d). Query it against run history for the real cache-hit rate - the #1 metric.
- [ ] Target: orchestrator thread >= ~70% read-token share (calibrate vs first week of real data).

## The highest-leverage next step (deferred on purpose)

Pin the OpenRouter provider for the glm-5.2 orchestrator route. Without it OpenRouter can route the same
call to a different backend with a cold cache - a silent full-price miss. Deferred until we have a day of
cachedInputTokens data, because (a) measure-first (we just added the metric), and (b) the adapter uses the
OpenAI-compatible provider (createOpenAI), which doesn't cleanly pass OpenRouter's top-level provider field
- it needs the dedicated @openrouter/ai-sdk-provider or a fetch wrapper. Pin may also force a pricier
backend (verify pinned vs floating per-token price). Reviewed follow-up once data shows it isn't caching.

## Caveats (cheap-model reality != big-lab specs - verify empirically)

glm-5.2 and minimax-m3 publish NO cache spec - no documented discount, TTL, or min-cacheable-token floor.
The big-lab numbers (Manus 10x, Anthropic 0.1x read) are hypotheses for our models, not specs. Verify: two
identical-prefix calls seconds apart -> inspect usage for a cache-read field + price drop; repeat at
T+1min/T+10min/T+1h for the TTL. If cachedInputTokens stays 0 while you expect hits, the value may live in
res.providerMetadata - probe it in adapter.ts.
