# Finch Judge Contract

## The Three Model Roles

1. **Candidate model or agent** produces the workbook being evaluated. NodeRoom
   uses its governed free-first router for this path where the task allows it.
2. **Canonical judge** measures the candidate against Finch's reference output
   and rubric. Finch publishes GPT-5-mini as this calibrated automated judge.
3. **Shadow judge** probes evaluator sensitivity. NodeRoom uses
   `openrouter/free` for zero-cost disagreement evidence, never for the official
   score.

These roles must not be collapsed. A stronger or newer model may be a better
candidate or a useful shadow judge while still being the wrong instrument for a
score intended to remain comparable with the published benchmark.

## NodeRoom Routing Policy

Azure OpenAI is not a NodeRoom dependency and is not the default Finch path.
NodeRoom routes model work in this order:

1. Use the governed free router for product inference, exploration, repair, and
   non-promotable shadow evaluation.
2. Invoke the pinned direct-OpenAI judge only at the Finch certification
   boundary, with explicit call and spend ceilings.
3. Keep Azure transport as optional upstream-compatibility support only. A user
   does not need an Azure resource, deployment, endpoint, or Azure billing
   account to reproduce NodeRoom's accepted Finch receipt.

`gpt-5-mini` is consequently not NodeRoom's canonical product LLM. It is the
canonical Finch measurement instrument. Product model selection and benchmark
measurement remain separate decisions.

## Why GPT-5-mini

The [ACL 2026 Finch paper](https://aclanthology.org/2026.findings-acl.523/)
reports automated evaluation with GPT-5-mini and compares it with human labels.
The paper reports 82.1% and 90.2% agreement for the two evaluated product-side
agents. It also shows that replacing GPT-5-mini with GPT-5.1 changes the measured
pass rates. Therefore:

- GPT-5-mini is the canonical measurement contract, not NodeRoom's claim about
  the best current model.
- A frontier model or multi-vote judge is useful sensitivity analysis.
- A substituted judge must not be presented as the published Finch score.

## Transport Equivalence

Finch's released `src/call_gpt_judge.py` uses `openai.AzureOpenAI`, but the
paper calibrates the judge model and rubric rather than an Azure account. The
NodeRoom direct-OpenAI path is promotable only when all of these stay fixed:

- upstream repository commit
  `95a8b8d135a528b325be003e54c55f886a22602d`;
- GPT-5-mini, resolving to `gpt-5-mini-2025-08-07`;
- current upstream prompt upgrade method and prompt-source hash;
- `chat.completions.create` request fields;
- upstream response parser;
- all 172 `content_parts.jsonl` records;
- a canonical SHA-256 for each task record, required to reuse that task under
  `--resume`;
- zero parser errors;
- retry-aware call and spend ceilings.

The only allowed delta is SDK transport:

| Released path | Equivalent path |
|---|---|
| `openai.AzureOpenAI` | `openai.OpenAI` |
| Azure deployment of GPT-5-mini | OpenAI GPT-5-mini snapshot |
| Azure endpoint/version credentials | Direct OpenAI credential |

The promotion gate validates these fields and rejects a generic OpenAI receipt
that lacks the equivalence contract.

## Free-Router Shadow

OpenRouter documents that `openrouter/free` filters for capabilities required by
the request, including image understanding, and returns the selected model in
the response. Model selection can vary by request. NodeRoom records that resolved
model for each Finch task and produces:

- canonical and shadow coverage;
- exact pass/fail agreement;
- confusion counts;
- per-resolved-model agreement;
- disagreement task IDs;
- parser/provider failures.

The shadow receipt has `official: false`, `promotionAllowed: false`, and
`officialScoreClaim: false`. Promotion tests verify that it cannot cross the
certification boundary. The shadow route caps completion at 8,192 tokens because
the released 128,000-token reserve can exceed free endpoints' total context;
the canonical route retains the released request unchanged. The current live
quota, context, and image-endpoint findings are recorded in
[FINCH_FREE_ROUTER_AVAILABILITY.md](FINCH_FREE_ROUTER_AVAILABILITY.md).
Recovery attempts, rejected spend, and the accepted run are separated in
[FINCH_RECOVERY_COST_LEDGER.md](FINCH_RECOVERY_COST_LEDGER.md).

## Reproduce

```bash
# Rebuild the upstream judge input when it is absent.
npm run benchmark:proofloop:official-outputs -- \
  --id finch --run-finch-pipeline

# Routine output refreshes are non-destructive and preserve eval_set/content_parts.
npm run benchmark:proofloop:official-outputs -- --id finch

# Canonical score, direct transport equivalent.
npm run benchmark:finch:canonical-judge -- \
  --resume --max-calls 516 --allow-provider-spend \
  --max-provider-cost-usd <approved-cap>

# Zero-cost multimodal shadow run into separate artifacts.
npm run benchmark:finch:shadow-judge -- \
  --resume --max-calls 516 --allow-provider-spend \
  --max-provider-cost-usd <failure-reserve-cap>

# Align task IDs and render disagreement evidence.
npm run benchmark:finch:judge-disagreement
```

The exporter removes only the regenerable `model-output` baseline. It must not
recursively delete Finch's rendered `eval_set`, and it preserves a promoted
score claim only when the accepted scorer receipt and adapter-specific output
coverage remain valid. `tests/finchOfficialOutputSafety.test.ts` locks both
regression boundaries. The judge additionally stores `content_record_sha256`
on every task result; provider/model identity alone is insufficient for resume.

## Claim Matrix

| Artifact | Official Finch score | Useful evidence |
|---|---:|---:|
| Full canonical GPT-5-mini receipt through accepted direct transport equivalence | Yes | Yes |
| Full canonical GPT-5-mini receipt through released Azure transport | Yes | Yes |
| OpenRouter free-router shadow receipt | No | Yes |
| Frontier-model or multi-vote shadow receipt | No | Yes |
| Product output coverage without a canonical judge | No | Yes |
