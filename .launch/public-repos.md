# Public Repository Readiness

## ProofLoop

`HomenShum/proofloop` currently resolves to public repository `HomenShum/NodeProof`. The existing NodeRoom codebase contains a substantial ProofLoop CLI, browser runner, deterministic gates, NodeTrace/NodeEval surfaces, local memory, reports, adapters, and CI. Before publication under the requested name, decide whether to rename NodeProof, create a separate ProofLoop repository, or keep NodeProof as the canonical package identity.

Required external proof remains: clean install from the published package, fixture app start, browser workflow, intentional failure, repair instruction, rerun to pass, uninstall, and Windows/macOS/Linux CI.

## NodeReach

`HomenShum/nodereach` does not exist publicly. A local release candidate may be built around an approved manifest, SQLite outbox, idempotency, previews, rate limits, kill command, receipts, and manual fallbacks. It must not send or create a public repository before approval.

## Publication Boundary

No repository creation, rename, tag, package publication, or public release is authorized until `.launch/approval.json.publicReposApproved` is true and the public-repository gate passes.
