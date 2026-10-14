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
