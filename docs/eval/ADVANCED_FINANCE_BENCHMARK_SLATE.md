# Advanced Finance Benchmark Slate

Status: repo-owned deterministic scorer contracts are implemented. These are not official public benchmark scores.

Run:

```bash
npm run benchmark:advanced-finance
```

Output:

```text
docs/eval/advanced-finance-benchmark-slate.json
```

## Purpose

BankerToolBench proves full investment-banking task execution and official scoring in this repo. The next useful step is not to invent vague demos, but to add hard local benchmark contracts for adjacent buyer workflows where NodeRoom can own the scorer, source contract, and blocker ledger.

This slate covers eleven BankerToolBench-level workflow families:

| Case | Contract |
|---|---|
| `sec_xbrl_audit` | XBRL/taxonomy-style semantic, relational, and numeric consistency checks |
| `sba_loan_tape_stratification` | SBA loan-status, charge-off, severity, and censoring math |
| `lendingclub_pd_model` | Default probability scoring, AUC, Brier score, and cutoff policy |
| `ma_accretion_dilution` | Pro forma EPS, financing bridge, and accretion/dilution conclusion |
| `lbo_debt_capacity` | Sources/uses, debt paydown, MOIC, IRR, and covenant headroom |
| `venture_debt_startup_banking` | Runway, debt-to-ARR, interest burden, and covenanted approval |
| `actuarial_frequency_severity` | Exposure, frequency, severity, pure premium, and reserve |
| `multi_angle_scenario_forecast` | AI-2027-style driver decomposition, branch probabilities, expected value, and backtest error |
| `data_room_qa_diligence` | Cited Q&A and missing-document gap ledger |
| `board_pack_kpi_forecast` | ARR bridge, NRR, runway, and board alert logic |
| `workstream_finance_workflow` | Multi-step finance workbook, chart, memo, and operation trace contract |

## Interpretation

The JSON receipt is allowed to claim:

- the deterministic local scorer contract passed;
- the workflow has a BTB-level shape;
- the task is ready to become a live-room or provider-run benchmark.

It is not allowed to claim:

- official FinAuditing score;
- official WorkstreamBench score;
- official SpreadsheetBench full score;
- buyer production approval authority.

The AI-2027-style case uses the public methodology pattern from AI Futures Project materials: trend extrapolation, explicit milestone/driver models, scenario branches, uncertainty ranges, and backtest/update discipline. It does not claim to reproduce or endorse AI 2027's actual forecasts.

Reference sources:

- AI 2027 scenario overview: https://ai-2027.com/
- Compute forecast supplement: https://ai-2027.com/research/compute-forecast
- Timelines forecast supplement: https://ai-2027.com/research/timelines-forecast
- Takeoff forecast supplement: https://ai-2027.com/research/takeoff-forecast

Those stay in `officialBlockers` until official task bundles, scorer parity, and adapter implementations are present.

Note: the generated ProofLoop benchmark board may still show a legacy `official score claimed` count for BankerToolBench because it consumes the existing FR-020 score-import receipt. The stricter official-readiness receipt is the promotion gate for public official-score language; it remains blocked until the official contract blockers are cleared.

## Promotion Path

For each case, the next promotion step is:

1. Generate or ingest a larger public/synthetic fixture pack.
2. Stage agent-visible inputs separately from evaluator gold.
3. Run through a fresh NodeRoom browser room.
4. Score candidate outputs with the deterministic scorer.
5. Add contamination checks so answer keys cannot leak.
6. Only then promote from local scorer contract to live product proof.
