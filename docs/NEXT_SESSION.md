# NodeRoom next-session handoff

Last updated: 2026-07-20.

The mounted NodeSlide implementation is complete on the local integration
branch, but the package release and browser acceptance remain deliberately
open. A concurrent session published v0.2.0 before the final review fixes; it is
not an approved NodeRoom producer. Wait for the post-review immutable patch
release (expected v0.2.1) and do not bind a local development commit.

## Implemented and locally verified

- `convex/nodeslideHost.ts` maps NodeSlide reads, direct patches, proposals,
  decisions, versions, and receipts onto NodeRoom's existing artifacts,
  elements, proposals, traces, element versions, and activity authority.
- Public routes validate ActorProof, room membership, deck scope/visibility/tag,
  and host/member policy before product lookups. Receipts retain bounded opaque
  evidence and exclude bearer credentials.
- `storyboardTranslation.ts` provides the explicit loss-aware storyboard to
  `DeckSnapshot` boundary and preserves deck, slide, and element CAS clocks.
- `NodeRoomNodeSlideStudioMount.tsx` mounts the controlled `@nodeslide/react`
  shell inside the real deck workbench. Members can propose; only hosts can
  patch or decide.
- The memory journey runs a real NodeAgent tool call, host review, competing
  stale proposal, repository reread, PPTX generation/archive reopen, snapshot
  revalidation, and credential-free receipts.
- The Convex journey proves the durable authorization, CAS, proposal, reload,
  version-history, room-activity, and receipt lifecycle.
- The isolated package Convex component is mounted as `nodeslide`; NodeRoom's
  existing artifact authority remains the product source of truth.
- Six private publish-shaped runtime tarballs are vendored and content-pinned in
  `package-lock.json`. They are development inputs, not a release receipt.

## Verified gates

The final local tree passed:

- application and Convex TypeScript;
- 366 Vitest files / 2,547 tests;
- production build (7,499 modules);
- design-system, UI-layer, and UI-contract audits;
- security gate;
- production dependency audit with zero vulnerabilities; and
- bundle inspection for the literal mounted surface, NodeRoom CAS authority,
  and host/proposal command controls.

The generic mounted release verifier also fails closed when `--lock` is absent.

## Next required work

1. Wait for the NodeSlide security work to merge.
2. Regenerate the patch-release packages from final merged NodeSlide `main`, publish or
   otherwise freeze the canonical artifact set, and obtain the exact tag/SHA.
3. Add a release lock containing manifest and immutable install-upgrade proof
   digests. Run `scripts/nodeslide-mounted-release-proof.ts --lock <path>` with
   `NODESLIDE_ROOT` at that exact commit.
4. Only after step 3 passes, add the exact checkout and mounted release proof to
   bilateral CI.
5. Capture a live browser journey for mount/reload, NodeAgent proposal,
   comparison, host acceptance, presenter, PPTX export, and reopen. Keep camera
   evidence separate from deterministic test claims.

Do not reintroduce any local producer SHA, a mutable package tag, or a release
claim based only on unit/Convex/build success. Leave unrelated `.qa/` and
`.proofloop/` state uncommitted. Before changing NodeAgent, continue running the
two required smokes from `AGENTS.md`.
