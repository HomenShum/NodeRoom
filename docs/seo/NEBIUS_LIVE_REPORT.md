# Nebius Live Report

Generated: 2026-07-08

## Credential Source

The live run used `NEBIUS_API_KEY` from the Convex environment. The key was injected into the local process only for each command and was not written to disk.

## Model Catalog

Command:

```bash
npm run nebius:list-models
```

Receipt:

- `docs/seo/nebius/models.latest.json`

Result:

- 25 models returned by the Nebius Token Factory model catalog.
- `MiniMaxAI/MiniMax-M2.5` is available.

## Smoke Test

Command:

```bash
npm run nebius:smoke-test -- --model nebius/MiniMaxAI/MiniMax-M2.5
```

Receipt:

- `docs/seo/nebius/smoke-test.latest.json`

Result:

- `finishReason`: `stop`
- `text`: `{"ok":true,"provider":"nebius"}`
- `hasReasoningTrace`: `true`
- `usage.total_tokens`: 269

The first live smoke used a 120-token cap and returned only reasoning tokens with `finish_reason: "length"`. The smoke script now defaults to a larger token budget and records `finishReason` plus `hasReasoningTrace` so future receipts are easier to debug.

## Endpoint Listing

Command:

```bash
npm run nebius:list-endpoints
```

Receipt:

- `docs/seo/nebius/endpoints.latest.txt`

Result:

- The configured default control-plane URL returned `404 {"detail":"Not Found"}`.
- Direct model inference is working; endpoint inventory requires the current Nebius control-plane endpoint URL to be configured through `NEBIUS_CONTROL_BASE_URL` or `NEBIUS_ENDPOINTS_URL`.
