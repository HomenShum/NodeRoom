# NodeRoom Current Launch State

Captured: 2026-07-12 (America/Los_Angeles)

Verdict: `BLOCKED_PENDING_TECHNICAL_PROOF_AND_APPROVAL`

## Release Boundary

- Baseline PR: `HomenShum/NodeRoom#190`, commit `77757c42a9783072efca1317ef85789557dfea3f`.
- Baseline state: open, draft, mergeable, with its GitHub, ProofLoop, design, security, and Vercel checks passing.
- Successor worktree: `codex/product-hunt-readiness`, isolated from the dirty `main` checkout. It contains the current workbook-session, spend-control, export-receipt, and first-run changes and has not been deployed.
- The baseline preview is evidence for `77757c42`, not for the successor revision. Current-revision claims require a clean proof bundle and a new authenticated deployment receipt.
- Current recommended claim: finance and VC research workroom that creates source-backed shared work artifacts. Do not claim full Excel parity or official benchmark completion.

## Deployment Coordinates

- Public URL: `https://noderoom.live`.
- Public frontend currently embeds Convex development deployment `zealous-goshawk-766`.
- Intended Convex production deployment: `aromatic-bass-102`, currently on an older function/schema surface.
- Authenticated preview: Vercel preview plus Convex `hushed-jellyfish-969`; fresh phone proof passed for the baseline revision only.
- Strict production identity: disabled.
- Known release function-spec hash: `d6890534fca6cd8a58abadf6a70f4e1e4a5a64fe1e5702a666aa92676bfa0e19`.
- No deployment contains the successor branch's `creditReservations`, `artifactExportReceipts`, `workbookSessions`, atomic `providerSpend`, or current mobile first-run contract.

## Data And Migration

- Authoritative source contains 1,998 rooms, 2,688 legacy member rows, zero users/auth accounts/auth sessions, and 13,105 stored files.
- Verified source and destination rollback archives exist locally and passed full archive tests.
- Isolated import rehearsal passed with 8,312,277 documents and 13,105 files in 1h59m45s.
- Rehearsal proves compatibility, not zero-downtime production cutover.
- Production requires an approved legacy-room policy, staffed three-hour write freeze, fresh storage-inclusive snapshots, post-import verification, and rollback authority.

## Product And Proof

- Mobile terracotta, Create/Join/Try sample, governed deck review, trace/evidence, proposal, and deterministic PPTX export are in the successor branch.
- The public sample is an instant synthetic local mode with no auth, live room, provider, credits, session, or pending-room write. It is labeled `Synthetic local sample`; it is not claimed as read-only because its local review controls remain interactive.
- Current local proof passes: 310/310 Vitest files and 2,117/2,117 tests, 29/29 product-memory browser cases, the self-contained launch-surface suite at 19/19 (8/8 fresh-user and 11/11 terracotta cases), the unchanged baseline accounting certification suite at 100/85, Notion/GTM ProofLoop 100/80, build, source/dist security, zero production dependency vulnerabilities, design audit, fresh-room receipts, and NodeAgent/Omnigent adapter smokes.
- The first full test run exposed the expired finance provider claim. That claim was pulled from launch-facing copy, preserved as historical research, and protected by copy/staleness regression tests. No current autonomous three-statement full-solve or full Excel claim remains.
- Mobile live rooms now show available, held, and spent credits plus the standard estimate and maximum hold in the first-join card, Usage sheet, NodeAgent composer, and governed deck request. Missing, paused, unenrolled, unenforced, or insufficient wallets block paid mobile work before provider egress.
- The baseline release branch's 2,035 unit tests, product-memory browser suite, authenticated phone proof, smokes, security, design, and ProofLoop receipts remain historical evidence only.
- BankerToolBench selected browser path and SpreadsheetBench V1 are covered; SpreadsheetBench V2 browser coverage and official benchmark isolation remain incomplete.
- Public claim must distinguish benchmark-faithful product proof from official benchmark scores.

## Spreadsheet Execution

- A bounded job-scoped workbook session now provides persistent scratch state, a safe `wb.*` surface, formula calculation, render/diff/verify feedback, idempotent publication, and proposal-aware governance.
- Local contracts cover session persistence, range/formula bounds, provider schema, lock/proposal behavior, runtime completion, and failure-origin classification.
- This is not full Excel compatibility. Authoritative external recomputation, broader chart/format fidelity, SpreadsheetBench V2, and an authenticated deployed read -> stage -> preview -> accept/reject -> export/reopen proof remain open.

## Private Pilot

- The successor branch is locally viable for an isolated authenticated pilot after a clean proof bundle and deployment approval.
- Pilot approval remains false.
- Local proof covers bounded room grants, atomic direct-provider admission, active hard-cap commitments, model/subagent cost aggregation, idempotent settlement, concurrency, and fail-closed launch routing.
- Before real users, deploy the exact revision and prove those controls in a browser, including cap breach, provider failure, every kill switch, issue/deletion/support path, public-data-only policy, and support ownership.
- Launch mode intentionally disables unmetered voice, direct capture, external semantic embeddings, nested provider tools, inline public provider actions, retries/fallbacks, and unapproved deep work. Deployed copy must make each restriction understandable and recoverable.
- The non-skipping deployed verifier now requires an HTTPS deployment, exact app/backend revision variables, an explicit matching Convex deployment, deployed function-spec parity, strict server identity, enforced credits, a bounded initial grant, an unpaused server posture, authenticated 390x844 proof, screenshots/video, and the extended create/credits/job/proposal/export/reload/second-user journey. It has not run because no approved current-revision deployment, Convex credentials/configuration, or coordinates exist.
- Pilot success means users return with a second real task, not merely that every feature was opened once.

## Product Hunt

- Product Hunt promotion is blocked on production cutover, strict identity, legal policy publication, spend controls, monitoring, independent taste approval, final media/links, and explicit submission/distribution approvals.
- Product Hunt visitors can see an instant synthetic local sample without provider cost, then authenticate before bounded live work. A product decision is still required if the public sample must be strictly read-only.
- No public repository, submission, distribution, or email action is authorized by the tracked approval example.

## Public Repositories

- `HomenShum/proofloop` resolves to the existing public repository `HomenShum/NodeProof`; naming and release strategy require an owner decision.
- `HomenShum/nodereach` does not currently exist.
- Local release candidates and proofs may be prepared; public creation, renaming, releases, or tags require `publicReposApproved=true`.

## Exact Resume

1. Commit the exact candidate and confirm the worktree is clean.
2. Run the full suite and `npm run proofs:staleness` to prove the expired finance claim is no longer marketed.
3. Run `npm run launch:gate:ci`, verify the generated bundle against that HEAD, and repair every reversible failure.
4. Record the legacy-room decision and owner approvals in local `.launch/approval.json` only when genuinely granted.
5. Deploy that exact commit with `VITE_APP_COMMIT` and `VITE_BACKEND_REVISION`, then run `npm run launch:proof:deployed-auth` at 390x844.
6. Run `npm run launch:gate:candidate`; this profile now requires deterministic, security, visual, trace, browser, and cost evidence.
7. Attach only semantically matching immutable verifications to the evidence ledger, then run `npm run launch:gate:pilot`.
8. Run `npm run launch:proof:prod` before any production action.
9. Run `npm run launch:gate:product-hunt` before Product Hunt submission or public distribution.
