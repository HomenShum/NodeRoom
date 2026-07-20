# NodeSlide consumer contract in NodeRoom

This is the first cross-repository proof of NodeSlide's injectable repository
boundary. It deliberately does **not** mount a second runtime, replace
NodeRoom's authentication, add Convex tables, or commit an absolute dependency
on an unpublished package.

The proof loads a built `@nodeslide/testing` entrypoint from either a sibling
NodeSlide checkout or an npm package tarball. It then verifies:

```text
host-verified NodeRoom actor
  -> normalized NodeSlide principal
  -> create two unapplied proposals from v1
  -> review both candidates
  -> accept one proposal and advance to v2
  -> reject the competing stale base through CAS
  -> preserve versions and trace-bound receipts
  -> replay acceptance idempotently
```

## Repository-root mode

Install NodeSlide dependencies first. The command builds its package
workspaces, then consumes the built package entrypoint:

```powershell
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide"
npm run nodeslide:consumer:proof
```

Portable shell/CI form:

```bash
NODESLIDE_ROOT=../NodeSlide npm run nodeslide:consumer:proof
```

Use `-- --skip-build` only when the package artifacts were already built in a
prior CI step.

## Packed-artifact mode

NodeRoom can consume a packed artifact without a sibling checkout or a
committed `file:` dependency:

```powershell
# In NodeSlide
npm run packages:build
npm pack --workspace packages/testing --pack-destination .artifacts

# In NodeRoom
$env:NODESLIDE_PACKAGE_ARTIFACT = "D:\path\to\.artifacts\nodeslide-testing-0.1.0.tgz"
npm run nodeslide:consumer:proof
```

`NODESLIDE_PACKAGE_ARTIFACT` may also name a directory containing exactly one
`nodeslide-testing-*.tgz`. The harness installs the tarball with scripts
disabled in an operating-system temp directory and removes that directory when
the proof finishes.

Write a machine-readable receipt without committing generated output:

```bash
npm run nodeslide:consumer:proof -- --root ../NodeSlide --json-out .proofloop/nodeslide-consumer.json
```

## What this proves

- NodeRoom can consume the built package boundary through a backend-neutral
  repository port.
- A proposal remains unapplied until review and acceptance.
- Acceptance advances the deck exactly once and produces a trace-bound
  receipt.
- A competing proposal pinned to the old base becomes stale instead of
  overwriting the accepted change.
- The NodeRoom actor/principal adapter is normalization-only. Existing
  `ActorProof` and room-membership verification remain authoritative.
- No NodeRoom NodeAgent, auth, route, artifact, or Convex implementation is
  replaced by this proof.

## What remains before a mounted product integration

This is not yet a NodeSlide studio mounted in NodeRoom. That requires separate,
versioned deliverables that do not exist in the current package slice:

1. a controlled/headless React package (canvas, selection, proposal review,
   presenter, and accessibility contracts);
2. a production NodeRoom repository adapter mapping NodeSlide deck snapshots,
   proposals, versions, and receipts onto NodeRoom's existing artifact and CAS
   authority without parallel tables;
3. an explicit translation between NodeRoom's current deck storyboard object
   model and NodeSlide `DeckSpec`;
4. server-side authorization that validates the existing NodeRoom
   `ActorProof`, membership, and write policy before creating the normalized
   principal;
5. a published version or immutable tarball digest for every consumed package;
6. browser proof covering mount, reload, agent proposal, comparison,
   acceptance, presenter, PPTX export, and reopen.

Until those boundaries are available, the repository-port proof is kept
explicit instead of hiding source imports behind a pretend production adapter.
