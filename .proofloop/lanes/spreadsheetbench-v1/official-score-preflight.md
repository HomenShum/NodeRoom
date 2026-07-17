# ProofLoop Official Score Preflight

Generated: 2026-07-09T09:49:42.656Z
Status: pass
Paid provider calls: no
Official benchmark score claim: no

This receipt is the cost and claim-boundary guard for the `official-scores` goal. Run it before any lane command that could spend model or judge budget.

## Commands

- Strict preflight: `npm run benchmark:proofloop:official-preflight -- --strict`
- Refresh receipts without paid model calls: `npm run openrouter:free -- --limit=8 --json-out docs/eval/openrouter-free-model-discovery.json && npm run benchmark:proofloop:free-model-gauge -- --skip-live --strict && npm run benchmark:proofloop:harness-economics -- --strict && npm run benchmark:proofloop:official-preflight -- --strict`

## Checks

| Check | Status | Detail | Evidence |
|---|---:|---|---|
| `free-discovery-receipt-present` | pass | 8 tool-capable free route(s) discovered. | `docs/eval/openrouter-free-model-discovery.json` |
| `free-gauge-zero-provider-spend` | pass | Free gauge estimated cost is $0.000000. | `docs/eval/proofloop-free-openrouter-nodeagent-gauge.json` |
| `free-gauge-not-official-score` | pass | Free model gauge is labeled as non-official benchmark evidence. | `docs/eval/proofloop-free-openrouter-nodeagent-gauge.json` |
| `free-gauge-has-usable-route-or-safe-skip` | pass | Gauge passed=0, skipped=4, failed=0. | `docs/eval/proofloop-free-openrouter-nodeagent-gauge.json` |
| `harness-economics-receipt-present` | pass | Harness economics tracks 25 file(s), missing 0; proxy candidates 8. | `docs/eval/proofloop-harness-economics.json` |
| `official-claim-boundary-preserved` | pass | Every official score lane still requires an accepted scorer or accepted judge contract before a claim. | `docs/eval/proofloop-harness-economics.json` |
| `expensive-lanes-have-preflight-next-command` | pass | 6 lane checklist(s) start with the official preflight command. | `docs/eval/proofloop-official-score-preflight.json` |

## Blocker Checklist

| Lane | Blocked When | Safe Next Command | Checklist |
|---|---|---|---|
| `bankertoolbench` | Full-suite scored receipt or Gandalf/Harbor official execution evidence is missing. | `npm run benchmark:proofloop:official-preflight -- --strict && npm run benchmark:bankertoolbench:fullsuite-gate -- --assert` | Keep BTB official score claims tied to full-suite gate or accepted Gandalf/Harbor receipts.<br>Do not use proxy/free model sweeps as leaderboard score evidence. |
| `spreadsheetbench-v1` | Full 912-task model-run output and SpreadsheetBench scorer receipt are missing. | `npm run benchmark:proofloop:official-preflight -- --strict && npm run benchmark:official:task-coverage -- --strict` | Confirm the 912-task stage and contamination receipts before model spend.<br>Use free/proxy routes for iteration only; official claim requires SpreadsheetBench scorer output. |
| `spreadsheetbench-v2` | Full V2 run artifacts, workbook scorer, or chart grader receipt are missing. | `npm run benchmark:proofloop:official-preflight -- --strict && npm run benchmark:official:task-coverage -- --strict` | Confirm the 321-task stage and chart-grader path before model spend.<br>Keep rendered chart grading separate from proxy judge triage. |
| `finch` | Upstream Finch content_parts rendering or accepted Azure judge/scorer receipt is missing. | `npm run benchmark:proofloop:official-preflight -- --strict && npm run benchmark:proofloop:adapter-blockers -- --id finch --strict` | Refresh the typed adapter blocker receipt after importing upstream scorer output.<br>Do not label OpenRouter proxy judge evidence as Finch official score evidence. |
| `finauditing` | Accepted FinMR judge path or official scorer import is missing. | `npm run benchmark:proofloop:official-preflight -- --strict && npm run benchmark:proofloop:adapter-blockers -- --id finauditing --strict` | Refresh the typed adapter blocker receipt after importing accepted scorer output.<br>OpenAI or other judge credentials block official promotion only, not local output export proof. |
| `workstreambench` | Upstream official task bundle, rubric, or scorer package is not available. | `npm run benchmark:proofloop:official-preflight -- --strict && npm run benchmark:proofloop:adapter-blockers -- --id workstreambench --strict` | Keep local proof as proxy-only until upstream bundle/scorer evidence exists.<br>Refresh the typed adapter blocker receipt after locking any author-provided package. |

## Policy

- Run this preflight before any official-score lane command that could spend model or judge budget.
- The preflight itself does not call paid providers; the free model gauge is invoked with --skip-live by the official-scores goal.
- Free/proxy routes can support product iteration and blocker triage, but they cannot become official benchmark score claims without accepted scorer receipts.
- Official claims stay gated by benchmark scorer receipts or explicitly accepted judge contracts.
