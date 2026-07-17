# NodeRoom First-Run And Mobile Execution Receipt

Captured: 2026-07-10 (America/Los_Angeles)

Status: local pass; production release blocked

## Scope Receipt

Existing lane work preserved:

- terracotta source exports, mobile shell migration, stable header, and six-tab
  navigation;
- governed storyboard/work-artifact projection and deck model;
- graph, benchmark, proofloop, desktop Cloud-token, and other dirty-tree work.

This pass added or completed:

- explicit desktop and phone Create/Join/Sample intents and review-first
  preflight before every mutation;
- empty workspace versus persistent synthetic sample provenance;
- token-idempotent join recovery, host-safe leave, and sample backfill repair;
- mobile live people, jobs, files, generic sheet rows, proposals, traces,
  plan/evidence requests, scoped deck requests, and real PPTX export receipts;
- honest unavailable states for live capture, upload, voice, historical deck
  restore, unbacked source attachment, and unprojected artifacts;
- fresh empty-room NodeAgent task, privacy/provider copy, focus trapping,
  keyboard/Escape behavior, 44px targets, reduced motion, contrast-safe
  terracotta, and narrow-phone geometry;
- XLSX receipt details and tests for duplicate/lost-response room creation.

No NodeAgent core, immutable scorer, or certification threshold was weakened.
The design audit was updated only to recognize the accessibility-approved
terracotta token and the equivalent `URLSearchParams` room route construction.

## Deterministic Proof

| Gate | Result |
|---|---|
| App TypeScript | Pass |
| Convex TypeScript | Pass |
| Production Vite build | Pass; existing large-chunk warning |
| Focused mobile/work-artifact/session Vitest | Pass, 99/99 |
| Final live-honesty/mobile adapters subset | Pass, 49/49 |
| Full Vitest | 2066/2072 pass |
| First-run + story + terracotta + live Convex Playwright | Pass, 28/28 |
| NodeAgent frame smoke | Pass |
| Omnigent NodeAgent smoke | Pass; external `omni` CLI unavailable |
| Design-system audit | Pass; advisory drift warnings remain |
| QA matrix / content fluency | Pass / pass |
| Security gate / production dependency audit | Pass / 0 vulnerabilities |
| ProofLoop doctor | Pass, 11/11 |
| ProofLoop `official-scores` gate | Pass from persisted ledger |

The six full-suite failures are confined to the existing official-score lane:

- `proofloopAdapterBlockers.test.ts` (one);
- `proofloopBenchmarkNormalization.test.ts` (two);
- `proofloopOfficialScorePreflight.test.ts` (one);
- `proofloopOfficialScoreReceipts.test.ts` (one);
- `proofloopPromoteOfficialScore.test.ts` (one).

They disagree about whether Finch/FinAuditing receipts are accepted or
externally blocked. Certification receipts were not rewritten by this pass.
The machine report is `.proofloop/full-vitest-2026-07-10.json`.

## Visual Receipts

- `.proofloop/visuals/first-run-terracotta-390x844.png`
- `.proofloop/visuals/first-run-create-preflight-390x844.png`
- `.proofloop/visuals/mobile-live-terracotta-390x844.png`
- `.proofloop/visuals/production-stale-mobile-390x844.png`

The local live capture is a real Convex development room at 390x844. The
production capture is a fresh-origin read-only inspection; this pass created no
production QA room because the deployed CTA and backend topology failed the
preconditions for an honest launch test.

## Production Blockers

1. `noderoom.live` is Vercel deployment
   `dpl_4hTRY4E5FqvYS8hrsM2B4KfvrzA2` and reports Ready, but serves the stale
   landing: `Diligence that shows its work`, no Join/Sample choice, and a Create
   link containing `surface=desktop`.
2. Vercel production reads Convex development deployment
   `dev:zealous-goshawk-766`. The actual production deployment is
   `aromatic-bass-102`; development exposes 311 functions while production has
   236. Production lacks `rooms.finishStarterRoom` and
   `rooms.ensureStarterRoomState`.
3. The current `main` checkout matched `origin/main` at `5f67d8e1` but had 306
   changed paths (189 tracked, 117 untracked) before this receipt. It is not a
   clean or reviewable deploy artifact.
4. `src/app/main.tsx` mounts plain `ConvexProvider`. There is no Clerk/Auth0 or
   equivalent adapter, so enabling `NODEROOM_REQUIRE_CONVEX_IDENTITY=1` would
   reject every first-time user instead of producing an authenticated journey.
5. The independent taste judgment remains below its ship threshold after its
   allowed three loops, despite the deterministic contract judgment passing.

## Safe Resume Sequence

1. Reconcile the six official-score expectations in their owning lane without
   changing scorer truth, then require `npm test -- --run` to pass.
2. Produce a clean reviewed `codex/` release branch that intentionally includes
   the mobile/work-artifact dependencies and excludes unrelated WIP.
3. Choose the canonical Convex production database, write and rehearse any data
   migration, and add a real production deploy command. Do not use the current
   `npm run convex:deploy`; it runs `convex dev --once`.
4. Add and test an account auth provider, then enable the production identity
   requirement only after anonymous, invited, returning, and revoked-user
   journeys have explicit policy decisions.
5. Deploy backend to an isolated preview, deploy the matching Vercel preview,
   and rerun the 28-case browser gate against that URL.
6. Promote the matched backend/frontend release, then run one authenticated
   fresh-phone Create journey, one invited-member journey, reload recovery,
   governed proposal accept/reject, trace, and export receipt. Record deployment
   IDs and screenshots before claiming launch-ready.

Local dogfood remains available at `http://127.0.0.1:4173`.
