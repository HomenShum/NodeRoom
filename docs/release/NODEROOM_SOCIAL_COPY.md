# NodeRoom Social Proof Kit

Publication gate: **PUBLISH**

## Media Order

1. Storyboarded product clip: founder deck -> isolated notebook -> graph path -> analyst live receipts.
2. Six-persona fresh-user proof grid with the machine-readable interaction receipt.
3. Static benchmark scorecard with coverage and pass counts together.
4. Fix card: receipt recovery, formula JSON repair, pass-rate provenance, retry-aware cost caps.
5. Final gate card linked to the machine-readable receipt.

- README preview: `episodes/noderoom-proof-release-v1/renders/teaser.gif`
- Full video: `episodes/noderoom-proof-release-v1/renders/short.mp4`
- Storyboard: `episodes/noderoom-proof-release-v1/storyboard.yaml`
- Visual judge receipt: `episodes/noderoom-proof-release-v1/judge.md`
- Media hashes: `episodes/noderoom-proof-release-v1/media-manifest.json`
- Fresh-user vertical receipt: `docs/eval/NODEROOM_FRESH_USER_VERTICAL_PROOF.md`
- Six-persona receipt: `docs/eval/noderoom-persona-dogfood-receipt.json`
- Free-model tool-call gauge: `docs/eval/PROOFLOOP_FREE_OPENROUTER_NODEAGENT_GAUGE.md`

## LinkedIn Draft

We finished a proof release for NodeRoom.

Method: lock upstream tasks/scorers, preserve raw outputs and candidate hashes, run the product UI, score every task, and refuse to promote proxy evidence.

Results so far: 1739/1739 staged official tasks; SpreadsheetBench V1 70/912 accepted-official pass (avg 0.096126); V2 0/321 accepted-official pass (avg 0).
FinAuditing: 332/332 FinMR rows, finre macro f1 0.162658, accepted judge receipt.
MBABench: 38/38 cases, mean score 11.513158, accepted judge receipt.
Finch / FinWorkBench: 172/172 tasks, mean score 0.087209, accepted judge receipt.

The most useful finding was that coverage is not quality. Running every task exposed weak task performance, parser failures, stranded receipts, and cost-accounting gaps that a polished demo would hide. We fixed those paths and kept the negative scores visible.

Proof packet: README scorecard + raw receipts + reproducible commands + storyboarded product states + 6/6 fresh-user persona workflows.

## X / Threads Draft

1/ A proof release should show more than a GIF. We packaged NodeRoom's method, exact task coverage, measured results, failures, fixes, model versions, costs, raw receipts, and live product states.
2/ Coverage: 1739/1739 staged official tasks. That is execution coverage, not a pass claim.
3/ SpreadsheetBench accepted official scores: V1 70/912 pass, avg 0.096126. V2 0/321 pass, avg 0. The low results stay visible.
4/ Accepted external lanes: FinAuditing 332/332; MBABench 38/38; Finch / FinWorkBench 172/172.
5/ Fixes: exact-ID resume, hash-verified receipt recovery, formula-aware JSON salvage, correct pass-rate provenance, and retry-aware spend caps.
6/ Product proof: 6/6 fresh-user personas completed NodeAgent work, mutation, conflict handling, evidence review, and export; deck, notebook, graph, chat, and trace states remained live.
7/ Every required external scorer receipt is accepted and the persisted gate passes.
8/ The README is generated from receipts, and the social copy is held automatically when the gate is not certified.

## Short Draft

NodeRoom proof packet: 1739/1739 task coverage, honest pass counts, accepted scorer receipts, live deck/notebook/graph/chat proof, exact fixes, versions, costs, and reproducible commands. Status: certified.

## Alt Text

A NodeRoom proof sequence showing a founder exporting a source-backed deck, an isolated notebook kernel result, a draggable evidence graph path, and analyst live-agent receipts beside room chat; followed by a six-persona proof grid and a scorecard separating execution coverage from pass counts.

## Posting Checklist

- [x] Persisted ProofLoop gate is passed.
- [x] Every external score shown has an accepted upstream receipt.
- [x] Feature Proof Studio video judge returns publish.
- [x] README proof-block links and raw JSON receipts resolve in the repository.
- [x] The media order assigns one primary claim to each visual.

Publishing to GitHub and social platforms remains an explicit human account action; this packet does not claim those external posts already exist.
