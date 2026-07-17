# Finch Judge Disagreement Audit

This is a shadow reliability audit, not an official score. The canonical column is Finch's published GPT-5-mini judge contract; `openrouter/free` is zero-cost, capability-routed, and may resolve to a different model per request.

| Coverage | Canonical | Free-router shadow | Compared |
|---|---:|---:|---:|
| Records | 172 | 7 | 0 |
| Parse/provider errors | 0 | 7 | - |

| Result | Count | Rate |
|---|---:|---:|
| Exact pass/fail agreement | 0 | n/a |
| Canonical passes | 0 | n/a |
| Shadow passes | 0 | n/a |
| Disagreements | 0 | n/a |

## Confusion

- Both pass: 0
- Both fail: 0
- Shadow-only pass: 0
- Canonical-only pass: 0

## Resolved Models

| Free-router model | Cases | Agreement | Shadow passes |
|---|---:|---:|---:|
| _No comparable shadow responses_ | 0 | n/a | 0/0 |

## Shadow Availability Errors

- rate_limit_or_daily_quota: 2
- context_limit: 3
- no_image_capable_endpoint: 2

Promotion is structurally disabled for this artifact. Use disagreement IDs for review; do not average this result into the canonical Finch score.
