# NodeRoom next-session handoff

Last updated: 2026-07-20
NodeRoom product-code checkpoint before this docs-only handoff: `4a4a3c25`
(merged PR #226)
Counterpart product-code checkpoint: NodeSlide `12a8527c` (merged PR #23 and
manually deployed to production Convex); its current docs-only `main` tip is
`5d5e2035` (merged PR #24)

This is the current handoff for the NodeRoom side of the NodeSlide integration.
Older handoffs are retained for provenance, but their implementation and deploy
claims are historical; begin here and revalidate repository and production state
before acting on them.

## Current state

PR #224 merged the NodeSlide authorization-spine consumer rollout into NodeRoom.
PR #226 completed the packed-consumer proof harness's operation-v1-only cutover:
it removed the temporary legacy-v0 bridge; requires exactly one deeply frozen,
valid operation-v1 request per fixture-authorizer callback; binds proof evidence
into receipts; covers all seven repository actions; and fails closed otherwise.
It did not introduce or remove a production NodeRoom authorizer.

NodeRoom consumes NodeSlide through the built package boundary and exercises that
boundary with its existing NodeAgent runtime and a deck-tool adapter. Candidate
CI checks out NodeSlide at `main`; NodeSlide PR #23's rejected-origin replay fix
also passed that packed consumer gate and does not change the package
authorization ABI.

This is still a contract/conformance slice, not a mounted NodeSlide product
integration. The controlled UI packages are not mounted in NodeRoom, and no new
production NodeRoom storage or authorization authority was introduced.

## Recorded proof

The following deterministic evidence was recorded for exact NodeRoom
`4a4a3c25` and then-current NodeSlide code `c4fa5568` in
[NodeRoom CI run 29730336006](https://github.com/HomenShum/NodeRoom/actions/runs/29730336006):

- `npm run prod:gate` passed with 360 test files / 2,530 tests, 29 Playwright
  journeys, the production build, and the security gate green.
- `npm run nodeslide:consumer:proof` passed the operation-v1 package lifecycle and
  reported 25 host-authorization checks and
  `legacyPermissionCallback: false`.
- The consumer receipt reported
  `authorizationMode: "deterministic-preverified-fixture"` and explicitly reported:
  `actorProofValidated: false`, `roomMembershipValidated: false`, and
  `productionPolicyExecuted: false`.
- The proof covered an unapplied proposal, review/acceptance, CAS-stale
  competition, idempotent replay, direct apply, rejection, inspection of the
  in-memory receipt ledger, a `getDeck` re-read from the same memory repository,
  a JSON round-trip of the snapshot, and a NodeAgent tool invocation through the
  repository boundary. It did not prove durable receipt persistence or package
  reload.
- The latest reverse proof in
  [NodeSlide main job 88323293014](https://github.com/HomenShum/NodeSlide/actions/runs/29733297145/job/88323293014)
  checked out exact NodeRoom `9eee92dd` from exact NodeSlide `5d5e2035`; those
  tips contain product-code baselines `4a4a3c25` and `12a8527c`, respectively.
  It passed with operation-v1, 25 authorization checks, every repository action
  observed, and the legacy callback disabled.

Treat those results as evidence for the tested commit and commands, not as a live
deployment claim. Run the relevant gate again after substantive changes. The
detailed proof contract and its remaining false flags live in
[`docs/integrations/NODESLIDE_CONSUMER_PROOF.md`](./integrations/NODESLIDE_CONSUMER_PROOF.md).

## Boundaries that remain open

Do not promote the current proof into any of these claims:

- The input actor is a deterministic, preverified fixture. The proof does **not**
  execute NodeRoom `ActorProof`, room-membership validation, route policy, or the
  production write policy.
- Principal normalization is not authentication. A production server-side
  authorizer must validate the existing NodeRoom authorities before returning
  opaque policy evidence to NodeSlide.
- Controlled NodeSlide packages exist, but NodeRoom does not mount their studio,
  editor, selection, agent-thread, or presenter surfaces.
- The proof does not establish a durable production artifact, CAS authority, or
  room-activity path for NodeSlide decks, proposals, versions, and receipts.
- Memory and Convex have not been proven to preserve the same mounted-product
  lifecycle and snapshot semantics.
- Presenter, PPTX export, export/reopen revalidation, browser journeys, and the
  mounted surfaces' accessibility contracts remain unproven.
- Cross-repository CI is bilateral candidate-versus-counterpart-`main` coverage.
  It follows moving branch heads and is **not** an atomic, immutable pairing of a
  NodeRoom SHA and a NodeSlide SHA.

## Next work, in priority order

1. **Production artifact and authority path.** Map NodeSlide snapshots, proposals,
   versions, receipts, and compare-and-swap decisions onto NodeRoom's existing
   artifact/CAS authority and durable room activity. Do not add parallel tables or
   bypass `RoomTools`.
2. **Real authorization.** Implement a server-side operation-v1 authorizer that
   validates NodeRoom `ActorProof`, room membership, route policy, and write policy
   before emitting opaque authorization evidence. Add denial and replay evidence;
   never pass bearer credentials into a NodeSlide receipt.
3. **Model translation.** Define and test the explicit, loss-aware translation
   between NodeRoom's storyboard model and NodeSlide `DeckSpec`, including version
   and receipt provenance.
4. **Mounted lifecycle.** Mount the controlled/headless NodeSlide surfaces and prove
   create, manual edit, NodeAgent proposal, comparison, acceptance/rejection, stale
   handling, reload, and durable room activity end to end.
5. **Memory/Convex parity.** Run the same lifecycle and exported-snapshot
   revalidation against both repositories, with equivalent CAS and receipt
   behavior.
6. **Presenter and export journey.** Prove presenter mode, PPTX export, reopen,
   browser behavior, and accessibility contracts on the real mounted surfaces.
7. **Immutable cross-repo pairing.** Publish or pin the complete package closure by
   immutable version/digest and add an exact NodeRoom-SHA + NodeSlide-SHA gate. Keep
   the existing `main`-based bilateral jobs as compatibility coverage, not as the
   atomic release receipt.

## Working rules and commands

- Read `AGENTS.md`, `CLAUDE.md`, and the frozen scope in `docs/WEDGE.md` before
  changing product behavior.
- Fast per-change gate: `npm run floor`.
- Full pre-ship gate: `npm run prod:gate`.
- Repository-root consumer proof:
  `NODESLIDE_ROOT=../NodeSlide npm run nodeslide:consumer:proof`.
- A packed-artifact proof is also documented in
  [`docs/integrations/NODESLIDE_CONSUMER_PROOF.md`](./integrations/NODESLIDE_CONSUMER_PROOF.md).
- Keep writes behind `RoomTools`; do not mutate backend state directly from the
  NodeAgent harness.
- Do not claim done, passed, fixed, or live from a handoff, chat transcript, build
  alone, or screenshot. Require a current deterministic gate, proof receipt,
  official scorer, or live-DOM verification appropriate to the claim.
- Leave `.qa/` and generated `.proofloop/` run state uncommitted unless an explicit
  scoped instruction says otherwise.

## Suggested first move

Pull both repositories' `main`, verify the two exact SHAs, rerun the NodeSlide
consumer proof, and inspect its JSON false flags before designing the production
artifact/authorization adapter. The first implementation slice should make one
durable NodeRoom artifact lifecycle real without weakening the current fixture's
fail-closed conformance checks.
