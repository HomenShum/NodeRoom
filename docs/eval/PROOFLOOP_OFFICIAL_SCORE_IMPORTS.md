# ProofLoop Official Score Imports

This is the local-only readiness path for Finch and FinAuditing official-score receipts. It does not call Azure, OpenAI, OpenRouter, or any paid provider.

## Commands

```bash
npx tsx scripts/proofloop-official-score-import.ts --id finch --input docs/eval/proofloop-official-scores/finch.json --json-out docs/eval/proofloop-official-score-imports/finch.json
npx tsx scripts/proofloop-official-score-import.ts --id finauditing --input docs/eval/proofloop-official-scores/finauditing.json --json-out docs/eval/proofloop-official-score-imports/finauditing.json
npx tsx scripts/proofloop-adapter-blockers.ts --id finch --id finauditing
```

Use `--strict` on `proofloop-official-score-import.ts` only when a real upstream scorer receipt has been imported; current local receipts are expected to remain blocked.

## Claim Rules

- Finch product-path/export readiness is complete when NodeRoom has one official model-output artifact per Finch task. Official scoring still requires full `content_parts.jsonl` coverage and an accepted canonical GPT-5-mini judge receipt through the released Azure path or the recorded direct-OpenAI transport equivalent.
- FinAuditing product-path/export readiness is complete when NodeRoom has official-format FinSM, FinRE, and FinMR prediction JSONL rows. Official scoring still requires an accepted FinAuditing scorer receipt with an accepted FinMR judge result.
- Proxy and product-path receipts can guide local work, but they cannot promote an official score.
- `scoreClaim: true` is valid only with `status: "scored"` and an accepted external scorer receipt matching the benchmark-specific rule above.

## Current Status

- Finch: product/export and `content_parts` paths are complete; canonical GPT-5-mini scoring is the remaining promotion gate.
- FinAuditing: product/export path and accepted FinMR judge/scorer receipt are complete.
