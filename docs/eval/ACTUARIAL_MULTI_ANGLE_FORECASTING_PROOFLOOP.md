# Actuarial And Multi-Angle Forecasting ProofLoop

Status: implemented as a public-source and methodology proof layer. It supports credit, actuarial, and scenario-forecast work, but it does not grant production decision authority.

Run:

```bash
npm run proofloop:credit-data
```

The command writes:

```text
docs/eval/credit-actuarial-data-sources-proof.json
```

## What This Solves

The previous autonomous-credit blocker said buyer historical performance data was required. That is still true for production delegation, but public proxy data can solve a large part of the development and benchmark problem.

This proof now separates:

- public proxy data available now;
- official mortgage performance data that is usable after registration or terms acceptance;
- buyer-private data still required for production credit authority.

## Public Source Classes

| Source | Status | Main use |
|---|---|---|
| SBA 7(a) and 504 FOIA | machine-accessible | Small-business approval, status, paid-in-full, charge-off, term, and gross charge-off proxy data |
| FFIEC/CFPB HMDA | machine-accessible through the live packet | Mortgage application decision labels and fair-lending segmentation fields |
| FHFA Enterprise PUDB | machine-accessible | Mortgage acquisition, borrower income, race, sex, LTV, DTI, and tract segmentation |
| Lending Club granting-model dataset | machine-accessible through Zenodo/Figshare metadata | Consumer default / fully paid target with application-time variables |
| Freddie Mac SFLLD | access-required | Loan-level mortgage performance and actual loss data after registration and terms |
| Fannie Mae loan performance | access-required | Mortgage acquisition and monthly performance data after registration and terms |
| Home Credit Default Risk | access-required | Consumer repayment-difficulty benchmark through Kaggle terms |

## Actuarial Task Pattern

For actuarial or credit prediction work, ProofLoop should not ask one general agent to "predict risk." It should fan out into specialist receipts:

| Receipt | Purpose |
|---|---|
| `actuarial_data` | Exposure, outcome, censoring, source lineage, and data dictionary |
| `frequency_severity` | Event frequency, severity distribution, tails, and expected loss |
| `survival_default` | Time-to-event, vintage, delinquency, default, prepayment, or claim emergence |
| `scenario_forecast` | Base rates, trend extrapolation, scenario branches, and assumptions |
| `calibration_backtest` | Calibration, backtest error, holdout, and baseline comparison |
| `uncertainty_sensitivity` | Confidence intervals, stress cases, sensitivity, and thresholds |
| `forecast_red_team` | Leakage, overfit, missing-data, disagreement, and failure-mode review |

This is the same operating principle as the credit approval ProofLoop: parallel subagents produce receipts, and the final judge decides whether the loop can stop.

## AI-2027-Style Methodology

AI 2027 is useful as a pattern because it is not just a story. Its published process used trend extrapolation, tabletop exercises, expert feedback, research supplements, explicit milestone models, uncertainty ranges, alternate endings, and updateable simulation code.

The equivalent ProofLoop pattern is:

1. Define the target outcome and horizon.
2. Decompose the outcome into drivers.
3. Build a base-rate and trend model for each driver.
4. Add explicit scenario branches.
5. Attach source receipts to each assumption.
6. Run simulation or scoring with confidence intervals.
7. Collect expert/stakeholder disagreement.
8. Backtest against earlier vintages or adjacent datasets.
9. Publish a red-team ledger and update policy.

For NodeRoom buyers, this turns vague "AI prediction" into a governed forecast packet.

## What Still Requires A Buyer

Public data can support demos, benchmarks, model prototyping, actuarial method validation, and buyer discovery. It cannot replace:

- the buyer's private application and booked-loan history;
- overrides, declined applications, servicing actions, recoveries, losses, and workout history;
- buyer-approved fair-lending methodology;
- model-risk signoff;
- delegated authority limits.

That is why the autonomous-credit receipt now has a passing `public_historical_performance_proxy_data` gate and a separate external `buyer_private_performance_data` gate.
