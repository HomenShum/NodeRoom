# Live Prod ProofLoop Run Retention

This directory intentionally retains live production proof receipts from the July 6, 2026 reliability pass.

Retained runs:

- `live-prod-20260706T230532Z` is the current passing post-deploy live-prod slate. It passed QA story, HMDA underwriting, HMDA verifier, uploaded artifact rendering, public `@nodeagent`, and deterministic generic ProofLoop browser against the redeployed `https://noderoom.live`. BTB is skipped by the provider preflight receipt because `OPENROUTER_API_KEY` is not present locally.
- `live-prod-20260706T225336Z` is the prior passing live-prod slate before the final production redeploy.
- `live-prod-20260706T201917Z`, `live-prod-20260706T205336Z`, and `live-prod-20260706T224221Z` are retained as failed/partial regression evidence for the fixes: HMDA checkpoint naming, Q3 stuck-job/browser harness behavior, and wrapper partial-suite receipt handling.
- `q3-focused-*` runs are retained as focused Q3 variance repair evidence. `q3-focused-18` is the first focused passing run after the deterministic Q3 path and browser harness fixes.

These receipts are product/evaluation evidence only. They should not contain provider secrets or local `.env` material.
