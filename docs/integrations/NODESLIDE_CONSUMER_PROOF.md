# NodeSlide consumer contract in NodeRoom

This is the first cross-repository proof of NodeSlide's injectable repository
boundary. It deliberately does **not** mount a second runtime, replace
NodeRoom's authentication, add Convex tables, or commit an absolute dependency
on an unpublished package.

The proof loads a built `@nodeslide/testing` entrypoint from either a sibling
NodeSlide checkout or an npm package tarball. It requires the `operation-v1`
repository protocol and fails closed unless the authorizer receives exactly one
well-formed, deeply frozen operation request. The deterministic host authorizer
returns opaque policy evidence that the repository binds into its receipts.

The common lifecycle then verifies:

```text
preverified fixture actor (`hostAuthVerified: true`)
  -> normalized NodeSlide principal
  -> operation-v1 frozen request + evidence-bound receipt
  -> NodeRoom's existing NodeAgent runtime + a deck tool adapter
  -> NodeAgent creates an unapplied proposal
  -> host review accepts it and advances v1 -> v2
  -> same in-memory repository re-read + portable snapshot JSON round-trip
  -> create two unapplied proposals from v1
  -> review both candidates
  -> accept one proposal and advance to v2
  -> reject the competing stale base through CAS
  -> preserve versions and trace-bound receipts
  -> replay acceptance idempotently
  -> cover direct apply and explicit rejection
  -> cover custom-receipt authorization
```

The adapter contract is compiled against the real `AgentModel`, `AgentTool`,
`RoomTools`, `AgentResult`, and `runAgent` implementation in this repository.
It is implemented at
`src/integrations/nodeslide/nodeAgentAdapter.ts`; it binds NodeSlide tools to
NodeAgent instead of introducing another model loop. The canonical ownership
and distribution decisions remain in NodeSlide's
[ECOSYSTEM.md](https://github.com/HomenShum/NodeSlide/blob/main/docs/ECOSYSTEM.md).

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
npm pack --workspace @nodeslide/contracts --pack-destination .artifacts
npm pack --workspace @nodeslide/engine --pack-destination .artifacts
npm pack --workspace @nodeslide/backend --pack-destination .artifacts
npm pack --workspace @nodeslide/testing --pack-destination .artifacts

# In NodeRoom
$env:NODESLIDE_PACKAGE_ARTIFACT = "D:\path\to\.artifacts"
npm run nodeslide:consumer:proof
```

Before the private packages are published, directory input must contain exactly
one same-version tarball for each member of the testing dependency closure:
`@nodeslide/contracts`, `@nodeslide/engine`, `@nodeslide/backend`, and
`@nodeslide/testing`. The harness rejects missing, ambiguous, unexpected, or
mixed-version NodeSlide artifacts, installs the closure together with scripts
disabled in an operating-system temp directory, records the testing artifact's
SHA-256 in the receipt, and removes that directory when the proof finishes.
Explicit testing-tarball input remains supported for environments where its
private dependencies are already resolvable.

Write a machine-readable receipt without committing generated output:

```bash
npm run nodeslide:consumer:proof -- --root ../NodeSlide --json-out .proofloop/nodeslide-consumer.json
```

## What this proves

- NodeRoom can consume the built package boundary through a backend-neutral
  repository port.
- A proposal remains unapplied until review and acceptance.
- Acceptance advances the deck exactly once and produces a trace-bound
  receipt with a nested operation-v1 authorization binding.
- A competing proposal pinned to the old base becomes stale instead of
  overwriting the accepted change.
- The deterministic fixture authorizer receives exactly one recursively frozen
  request object per callback invocation, and the proof observes all repository
  actions: `deck.read`, `patch.apply`,
  `proposal.create`, `proposal.accept`, `proposal.reject`, `versions.list`, and
  `receipt.store`. It returns only opaque policy evidence (`issuer`, `policyId`,
  `policyVersion`, and `evidenceId`), never an ActorProof or bearer credential.
- Direct-apply, proposal-create, proposal-accept, proposal-reject, stale, and
  custom receipts preserve the principal ID, deck, action, resource, and
  host-policy evidence binding created by the repository.
- A scripted model invokes a NodeSlide deck tool through NodeRoom's canonical
  `runAgent`; the tool produces an unapplied proposal, the host accepts it,
  and the accepted edit survives a same-instance in-memory repository re-read
  and portable snapshot JSON round-trip.
- NodeSlide tool names and query/mutation classifications fail closed when
  missing, duplicated, or colliding with existing NodeRoom tools.
- The NodeRoom actor/principal adapter is normalization-only. This proof starts
  from a preverified fixture and does not execute `ActorProof`, room-membership,
  route-policy, or production write-policy verification. Those checks must remain
  authoritative in a production server-side authorizer.
- No NodeRoom NodeAgent, auth, route, artifact, or Convex implementation is
  replaced by this proof.

## What remains before a mounted product integration

This is not yet a NodeSlide studio mounted in NodeRoom. Controlled UI packages
exist in the NodeSlide package slice, but this NodeRoom proof does not mount
them. The complete I7 journey still requires product wiring and proof for:

1. the remaining controlled/headless surfaces (editable canvas, selection,
   agent thread, presenter, and their accessibility contracts);
2. a production NodeRoom repository adapter mapping NodeSlide deck snapshots,
   proposals, versions, and receipts onto NodeRoom's existing artifact and CAS
   authority without parallel tables;
3. an explicit translation between NodeRoom's current deck storyboard object
   model and NodeSlide `DeckSpec`;
4. a production implementation of the `operation-v1` authorizer that validates
   NodeRoom's existing `ActorProof`, membership, and write policy server-side
   before returning opaque evidence (the proof uses a deterministic policy
   callback and never treats principal normalization as authentication);
5. a published version or immutable tarball digest for every consumed package;
6. browser proof covering mount, reload, agent proposal, comparison,
   acceptance, presenter, PPTX export, and reopen.

Until those boundaries are available, the repository-port proof is kept
explicit instead of hiding source imports behind a pretend production adapter.

The v3 proof receipt therefore reports `durableReceiptPersistence`,
`packageReload`, `productionAuthorization`, `productionCreate`,
`manualArtifactEdit`, `productionBackend`, `sameSnapshotMemoryAndConvex`,
`durableRoomActivity`, `mountedReactStudio`, `presenter`, `pptxExport`, and
`exportedSnapshotRevalidation` as `false`. A successful receipt must not be read
as evidence for those still-open I7 steps.

## Cross-repository CI

NodeRoom candidate CI checks out NodeSlide `main`, builds the package workspaces,
runs NodeSlide's packed consumer smoke, packs `@nodeslide/testing`, and runs this
same NodeRoom consumer command from the tarball. NodeSlide candidate CI checks
out NodeRoom `main` and invokes the consumer proof against the candidate
NodeSlide checkout. This is bilateral candidate-versus-counterpart-main
coverage, not an atomic gate for two simultaneous candidate SHAs. No source
copy, npm link, second Convex client, or mutable `latest` package is involved.

The staged authorization cutover completed on 2026-07-20. NodeSlide `main` now
emits operation-v1 requests, its candidate CI passed against NodeRoom `main`,
and NodeRoom CI rerun attempt 2 passed the packed consumer against NodeSlide
`11278eae82c3a86dfacf0e3d5a79a1c24de0e724` with 25 authorization checks across
all seven actions. A three-argument callback or any other call shape is now a
contract regression and must fail this proof.
