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
- `tests/nodeSlideStudioMount.test.tsx` proves host/member command gating and CAS
  clocks at the React mount.

## Immutable package release

NodeSlide releases
[`v0.1.0`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.1.0) and
[`v0.2.2`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.2.2) are
GitHub-immutable and attested. v0.2.2 is bound to exact producer commit
`a88fb57f111db82e9334d68fa7611a51ed54c3c1` and passed the public
[`v0.1.0 → v0.2.2` install/upgrade proof](https://github.com/HomenShum/NodeSlide/actions/runs/29787121559).

The complete v0.2.2 artifact set and upgrade receipt are mirrored under
`vendor/nodeslide/`; `release-lock.json` binds their digests. Run:

```powershell
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide-at-a88fb57f"
npm run nodeslide:mounted:release:proof
```

The proof rejects a mismatched producer checkout, changed manifest or upgrade
receipt, changed package bytes, mixed versions, package-lock integrity drift,
or missing controlled/component exports.

## CI

The NodeSlide consumer job reads the immutable producer SHA from the committed
release lock instead of following a moving producer branch. It then runs the
portable package proof, the complete mounted release proof, and the smallest
Memory/Convex/React mounted journeys. The main `prod:gate` continues to run the
full NodeRoom corpus.

Recorded browser/a11y media remains a separate acceptance class; deterministic
component tests must not be presented as camera proof.
