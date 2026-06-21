# Inference.ai harness trace lane

Runs **one task through the NodeRoom harness on [Inference.ai](https://inference.ai) `gpt-5.4`** —
fully traced — and turns the exact trace into a nodetrace-style slide + an animated GIF.

## Model serving: Inference.ai

- **Provider:** Inference.ai
- **Endpoint:** `https://model.service-inference.ai/v1/chat/completions` (OpenAI-compatible)
- **Model:** `gpt-5.4`

Every model call's endpoint, raw response (`id`, `model`, `usage`), and gateway headers
(`x-oneapi-request-id`, `x-new-api-version`) are recorded in **`out/inference-eval-log.json`** —
verifiable proof the evaluation ran on **Inference.ai**.

## What each run produces (`out/` happy path, `out-btb/` headline)

- `inference-eval-log.json` — Inference.ai provenance (endpoint + raw responses + headers)
- `nodetrace-state.json` — the exact 4-phase trace (plan → gather → produce → verify)
- `outputs.json` — the graded deliverable
- `slide.html` / `slide.png` — the trace slide (nodetrace visuals)
- `walkthrough.gif` / `.mp4` — the animated demo

## Runs

- **Happy path** (`run.mjs`, nb-01 company profile): Inference.ai gpt-5.4 → graded **1.0**, 5/5 verified, live formulas + citations.
- **Headline** (`run-btb.mjs`, real BankerToolBench DIS/WBD M&A model): reasons through all 13 components, but client-ready (Gandalf) ~0% — the gap.

## Reproduce

```bash
# key is PROCESS-SCOPED — never written to any file or commit
INFERENCE_API_KEY=sk-... node scripts/inference-nodetrace/run.mjs
node scripts/inference-nodetrace/slide.mjs    scripts/inference-nodetrace/out
node scripts/inference-nodetrace/shoot-gif.mjs scripts/inference-nodetrace/out
```
