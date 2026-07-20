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
  -> NodeRoom's existing NodeAgent runtime + a deck tool adapter
  -> NodeAgent creates an unapplied proposal
  -> host review accepts it and advances v1 -> v2
  -> reload + portable snapshot round-trip
  -> create two unapplied proposals from v1
  -> review both candidates
  -> accept one proposal and advance to v2
  -> reject the competing stale base through CAS
  -> preserve versions and trace-bound receipts
  -> replay acceptance idempotently
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
npm pack --workspace packages/testing --pack-destination .artifacts

# In NodeRoom
$env:NODESLIDE_PACKAGE_ARTIFACT = "D:\path\to\.artifacts\nodeslide-testing-0.1.0.tgz"
npm run nodeslide:consumer:proof
```

`NODESLIDE_PACKAGE_ARTIFACT` may also name a directory containing exactly one
`nodeslide-testing-*.tgz`. The harness installs the tarball with scripts
disabled in an operating-system temp directory, records its SHA-256 in the
receipt, and removes that directory when the proof finishes.

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
- A scripted model invokes a NodeSlide deck tool through NodeRoom's canonical
  `runAgent`; the tool produces an unapplied proposal, the host accepts it,
  and the accepted edit survives repository reload and JSON round-trip.
- NodeSlide tool names and query/mutation classifications fail closed when
  missing, duplicated, or colliding with existing NodeRoom tools.
- The NodeRoom actor/principal adapter is normalization-only. Existing
  `ActorProof` and room-membership verification remain authoritative.
- No NodeRoom NodeAgent, auth, route, artifact, or Convex implementation is
  replaced by this proof.

## What remains before a mounted product integration

This is not yet a NodeSlide studio mounted in NodeRoom. The current package
slice has a controlled viewer and proposal comparison, but the complete I7
journey still requires separate, versioned deliverables and product wiring:

1. the remaining controlled/headless surfaces (editable canvas, selection,
   agent thread, presenter, and their accessibility contracts);
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

The proof receipt therefore reports `productionCreate`, `manualArtifactEdit`,
`productionBackend`, `sameSnapshotMemoryAndConvex`, `durableRoomActivity`,
`mountedReactStudio`, `presenter`, `pptxExport`, and
`exportedSnapshotRevalidation` as `false`. A successful receipt must not be
read as evidence for those still-open I7 steps.

## Cross-repository CI

NodeRoom CI checks out NodeSlide, builds the package workspaces, runs
NodeSlide's packed consumer smoke, packs `@nodeslide/testing`, and runs this
same NodeRoom consumer command from the tarball. NodeSlide CI should invoke the
same command against the candidate NodeSlide checkout; together those jobs make
a package-boundary regression fail before either repository merges. No source
copy, npm link, second Convex client, or mutable `latest` package is involved.
