# NodeRoom Mobile Launch Readiness Receipt

Captured: 2026-07-10 (America/Los_Angeles)

Branch: `codex/mobile-terracotta-launch`

Status: authenticated preview proven; production migration blocked

Pull request: `#190` (`codex/mobile-terracotta-launch`)

## Included Release Scope

- light terracotta mobile shell and governed deck/work-artifact review;
- explicit Create, Join, and Sample first-run intents on phone and desktop;
- empty workspace versus persistent synthetic sample provenance;
- live people, jobs, artifacts, proposals, traces, storyboard, and export receipts;
- host-safe leave, idempotent join recovery, and account-bound cross-browser recovery;
- GitHub OAuth production integration through Convex Auth;
- password authentication only for isolated local or preview QA;
- fail-closed production identity authorization with no room-token fallback;
- account sign-out that invalidates auth and removes account-bound room sessions;
- a true production Convex deploy command with clean-worktree and post-deploy verification;
- concurrent workbook inspect/verify trace labels from the active work-artifact lane.

Generated benchmark receipts, videos, trace archives, and unrelated evaluation WIP are intentionally excluded from this release branch.

## Deterministic Proof

| Gate | Result |
|---|---|
| Application TypeScript | Pass |
| Convex TypeScript | Pass |
| Production Vite build | Pass; existing large-chunk advisory |
| Full release-branch Vitest | Pass, 297 files / 2,033 tests |
| Auth/session focused tests | Pass |
| First-run + story + terracotta + live Convex Playwright | Pass, 28/28 |
| Deployed authenticated fresh-phone Playwright | Pass, 2/2 at 390x844 |
| Accounting ProofLoop | Pass, 100/85 |
| Notion SDR/BDR ProofLoop | Pass, 100/80 |
| Linux + Windows mobile visual baselines | Reviewed and refreshed; local gate 3/3 |
| NodeAgent frame smoke | Pass |
| Omnigent NodeAgent smoke | Pass; outer `omni` CLI unavailable |
| Design-system audit | Pass; advisory drift remains |
| Security gate including built output | Pass |
| Production dependency audit | Pass, 0 vulnerabilities |
| QA matrix / content fluency | Pass / pass |
| ProofLoop doctor | Pass, 11/11 |

The owning shared lane separately passed 309 Vitest files / 2,073 tests and its persisted `official-scores` gate. The clean product release does not copy that lane's mutable goal ledger, so `proofloop gate --goal official-scores` correctly reports that the goal is absent here.

## Authenticated Preview Receipt

- Isolated Convex preview: `hushed-jellyfish-969`, with strict account identity enforcement enabled.
- Matching Vercel preview deployment: `dpl_2L37KLrWLmQRDnCybZKruzefWzJC`, built from release revision `7ef26a1a`.
- Fresh-phone Create proof: landing explanation, review-first consent, account creation, empty room, public message, reload persistence, sign-out, and fail-closed rejoin.
- Fresh-phone Sample proof: explicit synthetic-data consent, account creation, live governed deck, Plan to Slides to scoped request, accepted job receipt without a fabricated patch, Evidence, PPTX download, and integrity receipt.
- The deployed run found and repaired three product defects: missing governed-deck recents, review state resetting on reactive object identity, and oversized provenance requests rejected by the server.
- The final post-preview delta is confined to an honestly marked memory-mode `Create a room` entry contract, its focused test, and reviewed visual baselines; production-path behavior is unchanged.

The preview is launch evidence, not a production promotion. Its deployment protection bypass is temporary and is revoked after testing.

## Production Auth Receipt

- A dedicated `NodeRoom Production` GitHub OAuth application was created with homepage `https://noderoom.live` and callback on the actual production Convex site.
- The first browser-exposed secret was treated as compromised, rotated, and deleted.
- The replacement client credentials and a matching JWT signing-key pair were configured directly on the production Convex deployment.
- The temporary local credential handoff file was deleted.
- `NODEROOM_REQUIRE_CONVEX_IDENTITY` remains disabled. It must not be enabled until matching backend and frontend revisions are deployed and the authenticated production journey passes.

## Fail-Closed Production Blockers

1. `noderoom.live` still serves the stale public build and points at Convex development deployment `zealous-goshawk-766`.
2. The actual Convex production deployment remains `aromatic-bass-102` with an older function/schema surface.
3. The public-facing development deployment contains at least 1,000 rooms and is the authoritative current data source.
4. A storage-inclusive development export exceeded 10 minutes and produced no archive.
5. A database-only development export also exceeded 10 minutes and produced no archive.
6. No destructive import, production backend deploy, frontend promotion, or identity enforcement is permitted without a verified rollback artifact or an approved non-destructive migration.
7. Vercel production still needs explicit hosted `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_NODEROOM_AUTH_REQUIRED=1`, and `VITE_NODEROOM_AUTH_PROVIDER=github` configuration.
8. The independent taste gate previously remained at 5.5/6.0 and still requires its owning review before launch promotion.

## Safe Resume Sequence

1. Obtain a verified Convex export through the dashboard/support path, including file storage, or approve a non-destructive dual-read migration.
2. Compare development and production snapshots without exposing room codes or content.
3. Preserve the passing isolated preview receipt while production rollback work proceeds.
4. Obtain the owning independent taste-gate approval.
5. Deploy the production Convex revision and verify its function spec before changing Vercel production coordinates.
6. Deploy the matching frontend, test GitHub sign-in, then enable production identity enforcement.
7. Run fresh-phone Create, invited-member Join, reload recovery, proposal accept/reject, trace, and export receipt against `https://noderoom.live`.
8. Promote only when the production journey, rollback proof, and independent taste gate all pass.

Local clean-branch dogfood: `http://127.0.0.1:4175`
