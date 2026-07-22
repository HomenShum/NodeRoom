# NodeRoom NodeGym consumer

NodeRoom consumes the dependency-free `@nodekit/gym-core` package through an
exact, vendored `npm pack` artifact. The package is pinned by SHA-256, npm
SHA-512 integrity, `package.json`, `package-lock.json`, and
`vendor/nodekit-gym-core/release-lock.json`; mutable tags and workspace links are
not accepted.

The canonical consumer journey is NodeRoom-specific. It builds a bounded matrix
for an evidence-bound diligence-room change, adapts executor receipts, verifies
three exact current/challenger harness pairs, computes diagnosis and curriculum
state, and asks the portable core for an advisory promotion decision. Because no
model-blind human preference review has occurred, the decision must remain
`hold`, `autoApply` must remain `false`, the challenger must not enter the shadow
route, and the human-owned artifact must remain unchanged.

Run the proof with:

```bash
npm run nodegym:consumer:proof
```

The command verifies the tarball and lockfile, performs a fresh install with
scripts disabled, checks the package exports, and writes
`docs/eval/node-gym-consumer-proof.json`.

This is a deterministic contract-control proof. It is not an official benchmark,
does not measure a live model, and makes no model-capability or promotion claim.
