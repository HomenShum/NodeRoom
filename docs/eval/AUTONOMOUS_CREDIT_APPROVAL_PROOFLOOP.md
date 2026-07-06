# Autonomous Credit Approval ProofLoop

Status: implemented as an evaluation proof path. It does not claim regulated production authority.

This layer sits above the production-live HMDA underwriting proof. Its job is to turn "underwriting done right" into a buyer-auditable path toward delegated autonomous credit approval by forcing policy, data, model, compliance, live proof, and authority work into parallel NodeAgent fanout roles with receipts.

## Command

Run:

```bash
npm run proofloop:autonomous-credit
```

The command first verifies the latest live HMDA underwriting receipt:

```bash
npm run proofloop:live:underwriting
```

Then it writes:

```text
docs/eval/autonomous-credit-approval-proof.json
```

It also runs the public credit/actuarial data-source receipt:

```bash
npm run proofloop:credit-data
```

## Current Level

- Target level: `L4-bank-delegated-autonomous-approval`
- Current achieved level when gates pass: `L3-guarded-evaluation-autonomy`
- Production autonomy claim: `false`
- Evaluation-only flag: `true`

The difference matters. NodeRoom can prove a live underwriting workflow completed correctly against the public HMDA packet and can plan the parallel credit approval work. It cannot fabricate a bank's private loan history, fair-lending signoff, model-risk approval, or delegated lending authority.

## Parallel Fanout Roles

The planner now expands autonomous credit goals into these specialist receipts:

| Role | Required output |
|---|---|
| `credit_policy` | Executable credit box, hard stops, review rules, exceptions, approval criteria |
| `credit_data` | Data lineage, label definition, leakage checks, external-data blockers |
| `credit_features` | Borrower, cash-flow, collateral, covenant, exposure, and explainable feature map |
| `credit_model` | PD/LGD or approval model plan with calibration, cutoff, uncertainty, monitoring |
| `reject_inference` | Treatment for declined or missing performance observations |
| `fair_lending` | Protected-class proxy plan, disparity checks, sample-size limits, signoff blockers |
| `adverse_action` | ECOA/FCRA-style reason-code contract and decline explanation checks |
| `model_risk_management` | Validation pack, challenger model, sensitivity checks, monitoring, versioning |
| `credit_live_proof` | Fresh room, browser/backend/scorer receipts, no demo or memory path |
| `delegated_authority` | Authority limits, human override points, approval matrix, governance blockers |

The planner still includes the normal `browser_proof` and `fresh_context_judge` roles, so dynamic fanout is not treated as a sequential human timeline.

## Gate Contract

The receipt has three classes of gates.

Passing gates prove the local system is doing the work it can control:

| Gate | Meaning |
|---|---|
| `parallel_credit_fanout_plan` | Required credit roles are planned in fanout waves |
| `production_live_underwriting_dependency` | Latest HMDA live proof passed, used production room, and completed visible output |
| `backend_completion_receipt` | Convex job, frames, and operation ledger completed |
| `withheld_score_gate` | Withheld local answer key scored every row correctly |
| `adverse_action_reason_gate` | Decline rows include confidence and reason text |
| `credit_policy_box_defined` | The evaluation credit box is pinned and documented |
| `model_risk_pack_scaffolded` | The model-risk, fairness, reason-code, and authority workstreams exist |
| `public_historical_performance_proxy_data` | Public SBA, HMDA, FHFA, and Lending Club style proxy data exists for development and benchmark work |

External-required gates are blockers for a real buyer deployment:

| Gate | Why it cannot be solved inside the public repo |
|---|---|
| `buyer_private_performance_data` | Requires buyer application, booking, repayment, default, loss, override, and decline history |
| `fair_lending_production_validation` | Requires buyer-approved proxy methodology, segmentation, sample-size review, and compliance signoff |
| `delegated_credit_authority` | Requires the buyer's credit policy owner and governance process to grant authority limits |

The proof command first runs a fresh production-live browser/backend/scorer proof. It fails on local proof failures. It does not fail because private buyer materials are absent; instead those are written as explicit `external_required` gates so sales and implementation teams cannot hide them.

## Buyer Explanation

For middle market banking, startup banking, investment banking, M&A, de novo, and venture workflows, this should be sold as an underwriting workbench and validation harness before it is sold as an approval authority.

What the score proves:

- The agent completed the live underwriting workflow in a real NodeRoom room.
- The workflow used a public human-reported HMDA benchmark packet with labels withheld locally.
- The output schema was complete and scored against an answer key that was never uploaded to the room.
- The backend job, reasoning frames, and operation ledger completed.
- Declines carried reason text and confidence fields.

What the score does not prove yet:

- That a bank should delegate final approval authority.
- That the model is calibrated on the buyer's actual losses, defaults, or recoveries.
- That fair-lending, model-risk, and adverse-action reviews are approved for the buyer's portfolio.
- That the same policy applies across middle-market C&I, startup lending, M&A financing, venture debt, or de novo banking.

The correct buyer promise is: "NodeRoom can run a live, receipt-backed underwriting proof and expose the remaining governance gates required for autonomous approval."

## Regulatory Anchors

Use current buyer counsel and compliance review before production use. The repo references these public anchors for methodology framing:

- CFPB Circular 2022-03 on adverse-action notices for complex algorithms: https://www.consumerfinance.gov/compliance/circulars/circular-2022-03-adverse-action-notification-requirements-in-connection-with-credit-decisions-based-on-complex-algorithms/
- FTC business guidance on FCRA adverse action and risk-based pricing notices: https://www.ftc.gov/business-guidance/resources/using-consumer-reports-credit-decisions-what-know-about-adverse-action-risk-based-pricing-notices
- OCC model-risk management guidance: https://www.occ.gov/news-issuances/bulletins/2026/bulletin-2026-13.html
- Federal Reserve SR 26-2 model-risk management guidance: https://www.federalreserve.gov/supervisionreg/srletters/SR2602.htm

## Version Ledger

| Version | Change |
|---|---|
| `autonomous-credit-approval-proof-v0.1.0` | Adds autonomous credit proof receipt, dynamic fanout roles, local pass gates, and external-required L4 blockers |
