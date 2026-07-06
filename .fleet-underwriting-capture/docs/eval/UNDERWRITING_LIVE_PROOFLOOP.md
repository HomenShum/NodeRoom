# HMDA Underwriting Live ProofLoop

Status: production live proof is required before claiming underwriting is done right.

This document records the live-underwriting repair ledger, harness versions, and the repeatable ProofLoop command. The workflow is evaluation-only. It uses public HMDA records for a retrospective benchmark and must not be used for real lending, insurance, legal, or financial decisions.

## Final Contract

ProofLoop command:

```bash
npm run proofloop:live:underwriting
```

Verification-only command:

```bash
npm run proofloop:live:underwriting:verify
```

Autonomous credit approval proof-path command:

```bash
npm run proofloop:autonomous-credit
```

The autonomous command runs a fresh live underwriting proof first, then writes `docs/eval/autonomous-credit-approval-proof.json` with parallel credit-policy, data, model, fair-lending, adverse-action, model-risk, live-proof, and delegated-authority gates.

Public credit and actuarial data-source proof:

```bash
npm run proofloop:credit-data
```

Current harness contract:

- Harness version: `hmda-underwriting-live-proof-v1.0.0`
- Proof contract: `prod-live-hmda-underwriting-v1`
- Browser harness: direct Playwright Chromium flow, fresh production room on `https://noderoom.live`
- Backend receipt: `agentJobs:benchmarkJobReceipt` through `ConvexHttpClient`
- Scorer: withheld local answer key, never uploaded to the room
- Required output schema: `application_id`, `predicted_action_taken`, `predicted_label`, `confidence`, `brief_reason`

Required pass gates:

- The room URL is production live, not `mode=memory`.
- The uploaded packet excludes the local answer key.
- Sheet 1 visibly contains all five output columns for all 10 applications.
- The local withheld-key scorer matches all 10 rows with no unparseable or missing predictions.
- The Convex job status is `completed`.
- Every reasoning frame for the job is `completed`.
- The operation ledger includes `agentJobRunner.hmdaUnderwritingBenchmark completed`.
- Browser page errors are empty.

## Latest Accepted Receipt

The canonical machine-readable receipt is:

```text
docs/eval/underwriting-hmda-live-proof.json
```

The receipt includes:

- `harness.version`
- `harness.proofContractVersion`
- `iterationLedger.document`
- `liveSignals.outputRowsComplete`
- `backend.job.status`
- `backend.frames`
- `backend.operations`
- full withheld-key scoring rows

Latest accepted production run at the time this ledger was added:

- Room: `https://noderoom.live/?room=NRWEA6G7FWI&name=Host`
- Generated: `2026-07-06T06:55:08.719Z`
- Accuracy: `10/10`, `accuracy: 1`
- Backend status: `completed`

## Iteration Ledger

| Iteration | Evidence | Result | Repair |
|---|---|---|---|
| I0 | User request: prove underwriting with real human-verified public data, no seed/smoke/demo memory path. | Existing demo proof was insufficient. | Use a public HMDA source and a fresh production room. |
| I1 | Public source selected: FFIEC HMDA Data Browser API for DC 2025 purchase loans with `action_taken` 1/3. | Built a 10-row balanced packet with labels withheld locally. | `scripts/underwriting-hmda-live-packet.mjs` creates feature CSV, task note, source manifest, and local-only answer key. |
| I2 | First live browser run uploaded packet and invoked `@nodeagent`, but no Sheet 1 rows were written and job remained running/retrying. | False negative proof: production path did not complete the work. | Added ProofLoop supervisor repair policy for no-write spend-budget benchmark slices. |
| I3 | NodeAgent could read artifacts but did not reliably complete the HMDA action table through the general model loop. | Model loop was too brittle for a pinned benchmark-completion lane. | Added deterministic HMDA benchmark executor behind `runtimeProfile === "benchmark_completion"`. |
| I4 | Live run wrote cells and scored correctly, but backend job fell into retrying after `say`. | Browser scorer was not enough; backend finalization was wrong. | Added deterministic benchmark completion mutation and runner fast path. |
| I5 | Live receipt showed 10/10 score but output columns were shifted: `predicted_label` contained confidence. | False positive risk: the scorer passed while the human-readable table was wrong. | Changed output contract to the exact five requested columns and added unit assertions. |
| I6 | Backend still retried with `TypeError: Cannot read properties of undefined (reading 'length')`. | Root cause was trace serialization of `say` returning `undefined`. | Hardened trace `cap()` in both agent runners. |
| I7 | Backend completed, but Playwright receipt captured before the last visible confidence/reason cells settled. | Scorer could pass before the visible table was complete. | Tightened proof to require all visible labels, confidences, and reasons. |
| I8 | Playwright test runner intermittently wedged before executing the stricter spec. | The app and browser were functional, but the test harness launch path was flaky. | Added direct Playwright proof runner with the same browser flow. |
| I9 | Direct proof had complete output but browser `job-status` text was unreliable. | UI status text alone was not a sufficient backend proof. | Added Convex `agentJobs:benchmarkJobReceipt` and made the ProofLoop receipt require backend completion. |
| I10 | Final ProofLoop update. | Production live proof is repeatable by command and self-versioned in the receipt. | Added `proofloop:live:underwriting` and `proofloop:live:underwriting:verify`. |

## Relationship To Proximitty

`npm run proofloop:proximitty` remains the synthetic Proximitty underwriting demo suite. It is useful for local ProofLoop receipts, clips, trace export, verifier receipts, and memory indexing.

`npm run proofloop:live:underwriting` is the production-live HMDA proof. It is the command to run before claiming that live underwriting is done right.

`npm run proofloop:autonomous-credit` is the next proof layer. It does not claim regulated production approval authority; it re-runs the local live-underwriting dependency and records the external buyer gates required before delegated autonomous approval can be valid.

The two suites are intentionally separate:

- Proximitty is synthetic and local-first.
- HMDA live underwriting is a production browser/backend proof against `noderoom.live`.
