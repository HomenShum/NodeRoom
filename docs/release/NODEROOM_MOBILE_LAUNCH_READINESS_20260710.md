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
| Full release-branch Vitest | Pass, 297 files / 2,035 tests |
| Auth/session focused tests | Pass |
| First-run + story + terracotta + live Convex Playwright | Pass, 28/28 |
| Product-memory Playwright | Pass, 29/29 |
| Deployed authenticated fresh-phone Playwright | Pass, 2/2 at 390x844 |
| Deterministic PPTX export regression | Pass; fixed-time files with no clock-stamped folder entries |
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
- Matching Vercel preview: `https://noderoom-8zygh5f55-hshum2018-gmailcoms-projects.vercel.app` (`dpl_46RsPag86vzETb9MwvBRq3rEtGT1`), built from release runtime revision `55b55a0c`.
- Fresh-phone Create proof: landing explanation, review-first consent, account creation, empty room, public message, reload persistence, sign-out, and fail-closed rejoin.
- Fresh-phone Sample proof: explicit synthetic-data consent, account creation, live governed deck, Plan to Slides to scoped request, accepted job receipt without a fabricated patch, Evidence, PPTX download, and integrity receipt.
- The deployed run found and repaired three product defects: missing governed-deck recents, review state resetting on reactive object identity, and oversized provenance requests rejected by the server.
- The final runtime repair keeps embedded job controls reachable, reveals the split control on keyboard focus, updates stale accessibility selectors, and prevents a named completed-company request from mutating unrelated pending rows.
- The named-company browser proof confirms CardioNova remains source-backed and complete while AtlasNova remains pending.

The preview is launch evidence, not a production promotion. Its temporary deployment-protection bypass was revoked after testing; the project reports an empty `protectionBypass` map.

## Rollback And Migration Rehearsal Receipt

- Authoritative source rollback: `.proofloop/rollback/zealous-goshawk-766-20260710-153059.zip`.
- Source rollback size: `5,078,797,442` bytes; `13,378` ZIP entries, including `13,106` `_storage` entries.
- Source rollback SHA-256: `CE13AF578BD4A36D660C26BCBEF58C4D7580EE6FE8414F492522169F106A2FBD`.
- Full 7-Zip test: pass; `13,378` files and `10,186,870,607` uncompressed bytes.
- Current production rollback: `.proofloop/rollback/aromatic-bass-102-20260710-175955.zip`.
- Production rollback size: `462,953` bytes; `186` ZIP entries, including `2` `_storage` entries.
- Production rollback SHA-256: `9CFC030A0BE758DE32E2A342B65C46A4CB697E7D9A25107A650C446DA306EC83`.
- Full production 7-Zip test: pass.
- Isolated rehearsal deployment: `agreeable-civet-283`, created with a one-day expiry and no public frontend.
- Clean release functions/schema deployed before import; its function-spec hash matched the authenticated preview at `d6890534fca6cd8a58abadf6a70f4e1e4a5a64fe1e5702a666aa92676bfa0e19`.
- `--replace-all` rehearsal import: pass after `1h59m45s`; `8,312,277` documents and all `13,105` stored files imported.
- Post-import checks: `1,998` rooms, `13,105` stored files, full 4,096-row samples for artifacts/messages/elements, and valid artifact-to-room, artifact-to-element, message-to-room, and upload-to-storage references.
- The rehearsal deploy key was revoked and its temporary local environment file was deleted. The deployment expires automatically.

The rollback artifact is now proven. It is intentionally gitignored and remains local because it contains room data and stored files.

## Production Auth Receipt

- A dedicated `NodeRoom Production` GitHub OAuth application was created with homepage `https://noderoom.live` and callback on the actual production Convex site.
- The first browser-exposed secret was treated as compromised, rotated, and deleted.
- The replacement client credentials and a matching JWT signing-key pair were configured directly on the production Convex deployment.
- The temporary local credential handoff file was deleted.
- `NODEROOM_REQUIRE_CONVEX_IDENTITY` remains disabled. It must not be enabled until matching backend and frontend revisions are deployed and the authenticated production journey passes.

## Fail-Closed Production Blockers

1. `noderoom.live` still serves the stale public build and points at Convex development deployment `zealous-goshawk-766`.
2. The actual Convex production deployment remains `aromatic-bass-102` with an older function/schema surface.
3. The public-facing development deployment contains `1,998` rooms and is the authoritative current data source.
4. The source snapshot contains `2,688` legacy member rows but zero `users`, `authAccounts`, or `authSessions` rows. Enabling strict account identity without an explicit legacy-room claim/disposition policy can strand existing rooms.
5. The isolated import took almost two hours. Production needs a scheduled write freeze, a fresh cutover snapshot, and post-import delta reconciliation; the verified snapshot is rollback evidence, not a zero-downtime cutover artifact.
6. No production import or identity enforcement is permitted until an owner approves the legacy anonymous-room policy and supervised maintenance window in `NODEROOM_PRODUCTION_MIGRATION_RUNBOOK_20260710.md`.
7. Vercel production still needs explicit hosted `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL`, `VITE_NODEROOM_AUTH_REQUIRED=1`, and `VITE_NODEROOM_AUTH_PROVIDER=github` configuration.
8. The independent taste gate previously remained at 5.5/6.0 and still requires its owning review before launch promotion.

## Safe Resume Sequence

1. Decide whether legacy anonymous rooms are migrated through an account-claim flow, retained temporarily without strict identity, or explicitly retired.
2. Schedule a supervised maintenance window of at least three hours and freeze writes to `zealous-goshawk-766`.
3. Capture and validate fresh source and destination snapshots immediately before cutover.
4. Follow `NODEROOM_PRODUCTION_MIGRATION_RUNBOOK_20260710.md`; verify function-spec, table, storage, and referential parity before changing Vercel production coordinates.
5. Configure the matching production frontend and GitHub auth, then test sign-in before enabling strict identity.
6. Run fresh-phone Create, invited-member Join/claim, reload recovery, proposal accept/reject, trace, and export receipt against `https://noderoom.live`.
7. Obtain the owning independent taste-gate approval.
8. Promote only when migration, authenticated production journey, rollback drill, and independent taste gate all pass.

Local clean-branch dogfood: `http://127.0.0.1:4175`
