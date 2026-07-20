# NodeSlide consumer and mounted-product proof

NodeRoom keeps two complementary proof surfaces. Neither replaces NodeRoom's
authentication, NodeAgent runtime, artifact storage, object CAS, proposals,
traces, or room activity.

## Portable repository contract

`npm run nodeslide:consumer:proof` consumes `@nodeslide/testing` from either a
NodeSlide checkout or a same-version packed contracts/engine/backend/testing
closure. It proves the operation-v1 repository protocol, frozen authorization
request, unapplied proposal review, CAS-stale competition, idempotent replay,
receipt binding, and a NodeAgent tool invocation.

Its actor is deliberately a preverified fixture. The v3 receipt therefore keeps
production authorization, durable backend, mounted React, presenter, and export
claims false; a successful fixture receipt must not be relabeled as mounted or
production evidence.

```powershell
$env:NODESLIDE_ROOT = "D:\path\to\NodeSlide"
npm run nodeslide:consumer:proof
```

## Mounted NodeRoom product boundary

The mounted implementation is separate from that fixture proof:

- `convex/nodeslideHost.ts` verifies the existing `ActorProof`, room
  membership, artifact scope/visibility/tag, route policy, and host/member write
  policy before reading or mutating product data.
- Reads, direct patches, proposals, decisions, versions, receipts, traces, and
  activity use NodeRoom's existing artifact and object-CAS authority. No
  parallel product tables were added.
- `storyboardTranslation.ts` maps the collaborative storyboard into real
  `@nodeslide/contracts` snapshots. Its writable reverse boundary accepts one
  text replacement with deck, slide, and element CAS clocks.
- `NodeRoomNodeSlideStudioMount.tsx` literally mounts the controlled
  `@nodeslide/react` shell around NodeRoom's richer storyboard workbench.
  Members may propose; only hosts may directly patch or resolve.
- The package Convex component is mounted under the isolated `nodeslide`
  namespace for independent component consumers and migrations. It is not the
  source of truth for NodeRoom's mounted product path.
- The memory journey runs NodeRoom's actual NodeAgent model/tool loop, leaves
  its proposal unapplied, requires host acceptance, and rejects a competing
  stale base. The Convex journey proves durable authorization, CAS, proposal,
  reload, history, activity, and credential-free receipt behavior.

## Private development package closure

The mounted branch currently vendors only the six publish-shaped 0.2.0 runtime
tarballs required to compile and test the boundary: contracts, engine, backend,
react-headless, react, and convex. `package-lock.json` pins every file dependency
by npm SHA-512 integrity.

These bytes are a private development closure, not a public release receipt.
They intentionally carry no producer commit, tag, or immutable-release claim.
The concurrently published v0.2.0 predates the final review fixes and is not an
approved NodeRoom producer. Do not add a release lock or exact-producer CI pin
until the post-review immutable patch release is generated from merged
NodeSlide `main`.

`scripts/nodeslide-mounted-release-proof.ts` implements the final fail-closed
consumer gate. It requires `--lock <path>` explicitly and verifies manifest and
upgrade-proof digests, every package digest, lockstep versions, clean install,
NodeRoom lockfile pins, package exports, component governance/grant exports,
and an exact NodeSlide checkout. It must continue to reject execution when the
canonical lock is absent.

## Remaining evidence boundary

The deterministic implementation and tests do not prove a recorded browser or
live-production journey. Still required after the canonical package release:

1. bind the final post-review NodeSlide patch tag/SHA and immutable artifact set;
2. run and retain the bilateral install-upgrade/tamper/mixed-release proof;
3. add the exact producer checkout and mounted proof to CI; and
4. capture browser evidence covering mount, reload, NodeAgent proposal, visible
   comparison, host acceptance, presenter, PPTX export, and reopen.

The existing cross-repository portable CI may continue following the agreed
candidate/main policy until that immutable release lock exists. Never substitute
a local development commit or mutable `latest` package for the final gate.
