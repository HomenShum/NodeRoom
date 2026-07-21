# SMB Lending Deployment Room: remaining checklist

This is the execution ledger for the Casca-inspired NodeRoom vertical. Checked items
are backed by code, tests, or the linked local proof receipt. Unchecked items must not
be described publicly as complete.

## Completed foundation

- [x] Make NodeRoom the product/runtime; keep the standalone Casca lab as reference material.
- [x] Define the reusable SMB lending pack and two synthetic fixtures.
- [x] Enforce the human credit-authority boundary and prohibit agent credit decisions.
- [x] Implement deterministic document blockers, critical path, EBITDA margin, and DSCR.
- [x] Implement version-pinned document-request proposals and stale-write rejection.
- [x] Implement hashed evidence-supply proposals and human verification.
- [x] Regenerate a decision-free review packet after verification.
- [x] Export and reopen a hash-checked packet bundle; reject tampering.
- [x] Implement a four-mode dimensional benchmark evaluator without an opaque winner score.
- [x] Exercise the restaurant primary fixture and medical held-out fixture.
- [x] Mount the restaurant case as a native NodeRoom route and artifact set.
- [x] Complete a local browser proposal approval and CAS application journey.
- [x] Capture desktop, tablet, and mobile screenshots with zero console errors or overflow.
- [x] Pass root and Convex typechecks, 2,558 repository tests, and the production build.

## Remaining golden-slice product proof

- [x] Surface the evidence-supply proposal as a second native NodeRoom browser operation.
- [x] Approve supplied evidence in the browser and show `requested -> verified` after CAS.
- [x] Regenerate the review packet and proof receipt visibly in the room.
- [x] Export the packet bundle from the UI, reopen it, and independently verify its hashes.
- [x] Reload the room and prove the verified state and receipt persist in the explicitly local demo profile.

The local reload proof uses browser storage and is not a substitute for the unchecked
Convex production certification below.

## Remaining benchmark work

- [x] Run manual, chat-only, graph-agent, and memory-enhanced variants through real run IDs.
- [x] Repeat model-backed variants at least three times on locked inputs.
- [x] Run the medical-practice fixture as held-out data with the evaluator inaccessible to the agent.
- [x] Record runtime, human interventions, tool calls, cost availability, failures, and repair cycles honestly.
- [x] Publish dimensional results and raw receipts; do not publish a universal winner claim.

Live benchmark receipt: `docs/eval/smb-lending/20260721-four-mode/benchmark-receipt.json`.
All ten runs passed the locked dimensional evaluator. The direct OpenAI response did not
include billed cost, so cost remains `n/a` rather than an estimate.

## Remaining production certification

- [ ] Replace the local `EngineStoreProvider` route with an authenticated Convex room-template entrypoint while preserving the local deterministic profile.
- [ ] Seed the lending artifact bundle atomically through the existing `rooms.create.seedArtifacts` contract; do not create a parallel room backend.
- [ ] Drive both governed proposal transitions through canonical Convex proposal/CAS mutations and persist their traces and receipts.
- [ ] Persist the regenerated packet and exported-bundle identity in canonical room state so reload proof does not depend on browser storage.
- [ ] Review and merge this change through the normal NodeRoom PR path.
- [ ] Deploy the exact reviewed frontend/backend commit through the repository runbook.
- [ ] Use a fresh authenticated production identity and workspace.
- [ ] Complete upload, proposal, approval, verification, export, reopen, and reload in production.
- [ ] Capture deployment identity, public URL, screenshots, traces, hashes, and final NodeProof verdict.
- [ ] Run `npm run prod:gate` before any production-ready claim.

## Optional graph-depth extension

- [ ] Project the approved NodeGraph document into Neo4j/Aura as a tenant-scoped read model.
- [ ] Run bounded blocker, neighborhood, and shortest-path queries with result caps and timeouts.
- [ ] Prove that Neo4j failure cannot corrupt or block canonical NodeRoom state.

## Casca-facing evidence package

- [ ] Write a clean-room case study that clearly disclaims Casca affiliation.
- [ ] Separate bank-specific configuration, reusable platform capability, and remaining platform gaps.
- [ ] Produce an editable proof deck and short walkthrough from the same receipts.
- [ ] Verify every claim against the exact release commit and proof bundle.
- [ ] Publish only after the production journey passes; describe earlier output as a prototype.
