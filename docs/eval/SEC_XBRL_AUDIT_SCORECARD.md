# SEC/XBRL Audit Benchmark — capability lane (shadow, not official)

Grader: deterministic arithmetic (no LLM judge). Items: 12 real EDGAR filings/variants. Data: SEC EDGAR companyfacts (public).

| Model | Scored | Errored | Macro-F1 | Exact-match | Injected caught |
|---|---:|---:|---:|---:|---:|
| `nvidia/nemotron-3-super-120b-a12b:free` | 12 | 0 | 0.333 | 33% | 0/8 |
| `cohere/north-mini-code:free` | 12 | 0 | 0.333 | 33% | 0/8 |

_officialScoreClaim: false — DQC-identity audit inspired by FinAuditing (arXiv:2510.08886), scored deterministically. Not the official FinAuditing LLM-judged score._