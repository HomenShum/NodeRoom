# NodeRoom next-session handoff

Last updated: 2026-07-20.

NodeRoom now contains the mounted NodeSlide product integration. The immutable
producer is NodeSlide main commit
`a88fb57f111db82e9334d68fa7611a51ed54c3c1`, approved release
[`v0.2.2`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.2.2). The
public clean-install, immutable-upgrade, exact-rebuild, tamper, and mixed-release
proof passed in [run 29787121559](https://github.com/HomenShum/NodeSlide/actions/runs/29787121559).

## Shipped integration

- `convex/nodeslideHost.ts` maps NodeSlide reads, direct patches, proposals,
  decisions, versions, and receipts onto NodeRoom's existing
  `artifacts`/`elements`/`proposals`/`traces`/`elementVersions`/activity authority.
  It does not add a parallel product store.
- Every public route validates the existing `ActorProof`, room membership, and
  host/member policy server-side. Receipts retain only bounded opaque policy
  evidence; bearer credentials never cross into NodeSlide.
- `storyboardTranslation.ts` provides the explicit loss-aware storyboard to
  `DeckSnapshot` boundary and preserves deck, slide, and element CAS clocks.
- `NodeRoomNodeSlideStudioMount.tsx` mounts the packed
  `@nodeslide/react` controlled shell inside the real deck workbench. Members
  can propose; only hosts can patch or decide.
- The memory journey runs a real NodeAgent tool call, host review, competing
  stale proposal, repository reconstruction, presenter/PPTX generation, archive
  reopen, snapshot revalidation, and credential-free receipt checks.
- The Convex journey proves the same authorization, CAS, proposal, reload,
  version-history, room-activity, and receipt behavior on durable tables.
- `vendor/nodeslide/release-lock.json` binds the complete 11-package v0.2.2 set,
  the 0.1.0 to 0.2.2 upgrade receipt, and all package/manifest digests to exact
  NodeSlide main. `package-lock.json` integrity-pins the six runtime packages.
- CI reads that lock, checks out the exact NodeSlide commit, runs the legacy
  portable consumer proof, verifies the complete immutable release, and runs
  the smallest mounted Memory/Convex/React journeys.

## Deterministic gates

```powershell
npm run typecheck
npm run design:audit
npm run nodeagent:frame:smoke
npm run omnigent:nodeagent:smoke
npm test -- --run tests/nodeSlideMountedMemoryJourney.test.ts tests/nodeSlideMountedConvexJourney.test.ts tests/nodeSlideStudioMount.test.tsx
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide-at-a88fb57f"
npm run nodeslide:mounted:release:proof
npm run floor
npm run prod:gate
```

The mounted release proof is fail-closed on manifest/proof digests, every
tarball digest, lockstep versions, NodeRoom's package-lock integrities, package
exports, component governance/grant exports, and the exact producer checkout.

## Honest boundary

This closes the NodeSlide I4 host-authorizer work and the repository, runtime,
package, and CI portions of I7/I8. The tests prove the mounted React boundary and
the product workbench's command wiring; they are not a recorded real-browser
accessibility/camera acceptance. If that stronger evidence is requested, capture
it as a separate browser proof without weakening or relabeling the deterministic
journeys above.

Leave unrelated `.qa/` and `.proofloop/` state uncommitted. Before changing
NodeAgent, continue to run both required smokes from `AGENTS.md`.
