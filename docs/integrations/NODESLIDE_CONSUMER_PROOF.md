# NodeSlide consumer and mounted-product proof

NodeRoom keeps two complementary proofs.

## Portable repository contract

`npm run nodeslide:consumer:proof` consumes `@nodeslide/testing` from either an
exact NodeSlide checkout or a same-version packed contracts/engine/backend/testing
closure. It proves the operation-v1 repository protocol, frozen authorization
request, unapplied proposal review, CAS-stale competition, idempotent replay,
receipt binding, and a NodeAgent tool invocation. Its actor is deliberately a
preverified fixture, so its v3 receipt continues to report production and
durability claims as false.

```powershell
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide"
npm run nodeslide:consumer:proof
```

## Mounted NodeRoom product

The product implementation is separate from that fixture proof:

- `convex/nodeslideHost.ts` executes NodeRoom ActorProof/membership and write
  policy before using existing artifact/CAS/proposal/trace/activity storage.
- `src/integrations/nodeslide/nodeRoomArtifactRepository.ts` provides the Memory
  authority with the same governed repository semantics.
- `src/integrations/nodeslide/storyboardTranslation.ts` maps NodeRoom's
  storyboard into real `@nodeslide/contracts` snapshots and patch commands.
- `src/integrations/nodeslide/NodeRoomNodeSlideStudioMount.tsx` mounts the packed
  controlled React shell into `DeckStoryboardWorkbench`.
- `tests/nodeSlideMountedMemoryJourney.test.ts` and
  `tests/nodeSlideMountedConvexJourney.test.ts` prove the two authorities.
- `tests/nodeSlideMountedIsolatedComponentJourney.test.ts` mounts the packaged
  component under real NodeRoom ActorProof/membership authorization. It proves
  the one-time request digest rejects substituted command bytes before grant
  consumption, accepts the exact command, rejects replay, and keeps
  `requestDigest` out of NodeRoom receipts.
- `tests/nodeSlideStudioMount.test.tsx` proves host/member command gating and CAS
  clocks at the React mount.
- `artifacts/nodeslide-mounted-ui-proof-20260720/` records a literal browser and
  accessibility-tree pass through NodeRoom's real Artifacts surface: edit,
  **Make live**, reopen, mounted package/authority DOM attributes, command
  controls, fail-closed memory write, and a clean local application console.

## Immutable package release

NodeRoom consumes the GitHub-immutable
[`v0.2.2`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.2.2), bound to
annotated tag object `ec4870300e1ad7ddd74209aada3a47a26779b4bb` and exact
producer commit `a88fb57f111db82e9334d68fa7611a51ed54c3c1`.
[`v0.2.0`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.2.0) remains
immutable but was published before the final review gate. `v0.2.1` remains
immutable but its public Windows assets did not reproduce byte-for-byte on
Linux. Both are preserved as superseded history and are not NodeRoom inputs.

The complete v0.2.2 artifact set and public workflow receipt from
[run 29787121559](https://github.com/HomenShum/NodeSlide/actions/runs/29787121559)
are mirrored under `vendor/nodeslide/`; `release-lock.json` binds their
digests. Run:

```powershell
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide-at-a88fb57f"
npm run nodeslide:mounted:release:proof
```

The proof rejects a mismatched producer checkout, changed manifest or upgrade
receipt, changed package bytes, mixed versions, package-lock integrity drift,
or missing controlled/component exports. The same command fresh-installs the
runtime packages plus the proof-only testing package, mounts the isolated
component, exercises digest substitution/exact/replay, and runs the real
Memory/Convex/React NodeRoom journey suite.

## CI

The NodeSlide consumer job checks out the exact NodeRoom event SHA, reads the
immutable producer SHA from the committed release lock instead of following a
moving producer branch, and checks out that exact NodeSlide commit. It runs the
portable package proof and the complete mounted release/journey proof, then
uploads the machine-readable receipt. The main `prod:gate` continues to run the
full NodeRoom corpus.

The recorded browser/a11y media remains a separate acceptance class from the
deterministic component proof. Its camera uses the memory sample because the
live Convex deployment correctly required production identity; it does not
claim an authenticated production camera. The mounted ActorProof, authorization,
digest, replay, durability, reload, and receipt claims come from the separate
Convex/repository/component journeys and must not be inferred from screenshots.
