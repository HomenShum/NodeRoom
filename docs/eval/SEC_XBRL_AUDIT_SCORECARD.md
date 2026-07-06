# SEC/XBRL Audit Benchmark - capability lane (shadow, not official)

Grader: deterministic arithmetic (no LLM judge). Items: 12 SEC EDGAR latest-10-K/variant rows. Data: SEC EDGAR companyfacts (public). Runner: direct OpenRouter chat completions, not NodeAgent tool-loop.

| Model | Scored | Errored | Macro-F1 | Exact-match | Injected exact |
|---|---:|---:|---:|---:|---:|
| `nvidia/nemotron-3-super-120b-a12b:free` | 12 | 0 | 0.333 | 33% | 0/8 |
| `cohere/north-mini-code:free` | 12 | 0 | 0.333 | 33% | 0/8 |

This checked-in scorecard is the aggregate result from the prior run. The runner now writes a per-item redacted receipt to `docs/eval/SEC_XBRL_AUDIT_RECEIPT.redacted.json` whenever `npm run benchmark:sec-xbrl` is rerun with a valid provider key.

_officialScoreClaim: false - DQC-inspired deterministic identity checks, scored arithmetically. Not arbitrary filing ingest unless `--accession` is provided, not the official XBRL-US DQC suite, and not the official FinAuditing LLM-judged score._
