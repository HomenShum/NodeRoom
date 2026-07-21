# NodeRoom next-session handoff

Last updated: 2026-07-20.

NodeRoom now contains the mounted NodeSlide product integration. The immutable
producer is NodeSlide main commit
`a88fb57f111db82e9334d68fa7611a51ed54c3c1`, approved release
[`v0.2.2`](https://github.com/HomenShum/NodeSlide/releases/tag/v0.2.2). The
public clean-install, immutable-upgrade, exact-rebuild, tamper, and mixed-release
proof passed in [run 29787121559](https://github.com/HomenShum/NodeSlide/actions/runs/29787121559).
The release is bound to annotated tag object
`ec4870300e1ad7ddd74209aada3a47a26779b4bb`.

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
- `artifacts/nodeslide-mounted-ui-proof-20260720/` contains the literal browser
  camera and a11y receipt for the real Artifacts surface. It proves edit,
  persistence via **Make live**, reopen, the 0.2.2 mounted DOM boundary, command
  controls, and fail-closed memory behavior with zero local application console
  errors or warnings on the final fresh-tab pass.
- The memory journey runs a real NodeAgent tool call, host review, competing
  stale proposal, repository reconstruction, presenter/PPTX generation, archive
  reopen, snapshot revalidation, and credential-free receipt checks.
- The Convex journey proves the same authorization, CAS, proposal, reload,
  version-history, room-activity, and receipt behavior on durable tables.
- The isolated-component journey starts from real NodeRoom ActorProof and room
  membership, initializes the package namespace, computes the canonical patch
  digest, rejects substituted bytes without consuming the grant, accepts the
  exact command, rejects replay, and proves `requestDigest` never enters a
  NodeRoom receipt. It asserts semantic parity because NodeRoom intentionally
  re-derives brief/source timestamps and owns a separate slide-object clock.
- `vendor/nodeslide/release-lock.json` binds the complete 11-package v0.2.2 set,
  the public 0.1.0 to 0.2.2 upgrade receipt, and all package/manifest digests to
  exact
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
npm test -- --run tests/nodeSlideMountedMemoryJourney.test.ts tests/nodeSlideMountedConvexJourney.test.ts tests/nodeSlideMountedIsolatedComponentJourney.test.ts tests/nodeSlideStudioMount.test.tsx
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide-at-a88fb57f"
npm run nodeslide:mounted:release:proof
npm run floor
npm run prod:gate
```

The mounted release proof is fail-closed on manifest/proof digests, every
tarball digest, lockstep versions, NodeRoom's package-lock integrities, package
exports, component governance/grant exports, fresh isolated-component
digest/replay behavior, the full mounted NodeRoom journey, and the exact
producer checkout. CI uploads the JSON receipt for the exact tested SHA.

## Honest boundary

This closes the NodeSlide I4 host-authorizer work and the repository, runtime,
package, isolated-component, literal mounted-UI, and CI portions of I7/I8.
`v0.2.0` (pre-final review) and `v0.2.1` (cross-platform byte-rebuild mismatch)
remain immutable, superseded history and must not be rebound. The camera proof
is deliberately classified as a memory-room browser pass: the live Convex
deployment correctly rejected a disposable unauthenticated sample with
`production_identity_required`, and no identity check was bypassed. Do not call
the screenshots an authenticated production journey; use the deterministic
Convex and isolated-component tests for ActorProof, authorization, digest,
replay, durability, and receipt claims.

Leave unrelated `.qa/` and `.proofloop/` state uncommitted. Before changing
NodeAgent, continue to run both required smokes from `AGENTS.md`.
