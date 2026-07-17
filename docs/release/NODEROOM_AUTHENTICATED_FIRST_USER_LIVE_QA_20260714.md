# NodeRoom authenticated first-user live QA - 2026-07-14

## Verdict

**GO for the scoped account-and-room-code beta journey.** The production alias passed
fresh authenticated phone and desktop creation, persistence, chat, sign-out fail-closed,
the governed mobile deck proposal path, PPTX export, and a real desktop NodeAgent Tool
event. Anonymous production room creation was rejected by Convex.

This is **not** proof of verified-email identity or broad NodeAgent terminal-completion
SLA. Those remain explicit P1 follow-ups below. Do not market either capability as
complete from this receipt.

## Release identity

| Item | Receipt |
|---|---|
| Git commit under test | `0c20d9bd6b145f56c0c79075f49ce1a9172c01f8` |
| Git branches | `main` and `codex/live-first-user-ai-elements` atomically advanced to `0c20d9bd` |
| Vercel deployment | `dpl_2Aa8GWVSfdYM8syvZPBx2rNgHoYH` |
| Vercel URL | `https://noderoom-it4a873in-hshum2018-gmailcoms-projects.vercel.app` |
| Production alias | `https://noderoom.live` resolved to the deployment above before the live run |
| Convex deployment | `zealous-goshawk-766` (guard passed) |
| Convex verification | All 299 source exports live; 11 additional framework-component exports informational |
| Production identity policy | `NODEROOM_REQUIRE_CONVEX_IDENTITY=1` |

The guarded Convex deploy completed before the frontend proof. The primary dirty
worktree and unrelated SpreadsheetBench/other-lane changes were not reverted or folded
into this branch.

## Live journeys

Command:

```powershell
$env:PLAYWRIGHT_DEPLOYED_AUTH='1'
$env:PLAYWRIGHT_DEPLOYED_HOST='noderoom.live'
$env:PLAYWRIGHT_BASE_URL='https://noderoom.live'
$env:PLAYWRIGHT_REUSE_SERVER='1'
npx playwright test e2e/deployed-auth-first-user.spec.ts --project=chromium
```

Result: **4 passed in 1.1 minutes** against the production alias.

| Journey | Result | Runtime | What was proved |
|---|---:|---:|---|
| Fresh phone, 390x844 | PASS | 7.6s | First landing discloses sign-in; password account; empty room creation; review-first default; room message; reload persistence; sign-out clears session; direct room entry fails closed |
| Fresh desktop, 1440x900 | PASS | 4.5s | Same account/create/chat/reload/sign-out contract in the desktop shell |
| Governed mobile deck | PASS | 45.2s | Sample disclosure; live deck; element-scoped request; no immediate fake patch; sourced Before/Proposed review; Reject/Approve in viewport; accepted title; Evidence source rows; real `.pptx` download; integrity receipt |
| Desktop NodeAgent Tool | PASS | 9.4s | Authenticated sample room; real job state; AI Elements Tool primitive inside `.ai-scope`; nonterminal job explicitly cancelled and verified cancelled |

Each journey wrote `deployed-browser-health.json`. All four receipts contain empty
console, CSP, page-error, failed-request, and 5xx arrays with `horizontalOverflowPx: 0`.
The complete suite then passed a second time in 2.1 minutes while regenerating proof
screenshots with the desktop room-code control masked.

## Security proof

A separate unauthenticated CLI call targeted `rooms:create` directly on
`zealous-goshawk-766`. Convex returned a server error from `convex/rooms.ts` with:

```text
Uncaught Error: production_identity_required
ANONYMOUS_MUTATION_REJECTED=1
```

The call failed before room insertion. Focused auth policy tests also prove that a
signed-in client cannot retain anonymous membership semantics.

## Visual proof

- [Fresh mobile landing](proof/20260714/fresh-mobile-landing-390x844.png)
- [Fresh desktop landing](proof/20260714/fresh-desktop-landing-1440x900.png)
- [Authenticated mobile room](proof/20260714/authenticated-mobile-390x844.png)
- [Mobile sourced proposal](proof/20260714/authenticated-mobile-deck-proposal-390x844.png)
- [Mobile deck evidence](proof/20260714/authenticated-mobile-deck-390x844.png)
- [Authenticated desktop room](proof/20260714/authenticated-desktop-1440x900.png)
- [Desktop AI Elements Tool](proof/20260714/authenticated-desktop-ai-elements-tool-1440x900.png)
- [Deployment receipt](proof/20260714/deployment-receipt.json)
- [Live test summary](proof/20260714/live-test-summary.json)
- [Anonymous mutation rejection](proof/20260714/anonymous-mutation-rejection.txt)

Pixel review found no overlap or horizontal clipping. The mobile proposal actions are in
the first review viewport. The Evidence sheet says five sources are scoped to eleven deck
claims while zero claims are verified and preserves `needs_review`. The desktop Tool title
truncates at narrow rail width but does not overlap controls. Authenticated desktop proof
captures mask `.r-roomcode`, so the packet does not publish code-access credentials.

## Deterministic gates

| Gate | Result |
|---|---|
| Focused second-candidate Vitest | PASS - 5 files, 46 tests |
| `npm run floor` | PASS again on the proof-hardened tree in 98.1s - 322 files, 2,148 tests, app and Convex typechecks |
| `npm run prod:gate` | PASS again on the proof-hardened tree in 400.2s - security/design/content/readiness gates, 2,148 tests, 29 product-memory Playwright tests, build, and dist security gate |
| `npm run nodeagent:frame:smoke` | PASS |
| `npm run omnigent:nodeagent:smoke` | PASS for YAML compatibility and frame execution; optional outer Omnigent CLI unavailable |
| `npm run proofloop -- doctor --json` | PASS - 11/11 checks |
| Convex deploy verify | PASS - 299/299 source exports live |
| Live deployed first-user suite | PASS - 4/4 |

No persisted ProofLoop goal ID was created for this repair, so this receipt does not
misrepresent a `proofloop gate --goal` result. Completion evidence is the deterministic
repo gate, guarded deploy receipts, production browser suite, browser-health JSON, and
screenshots above.

## Repair loop

1. The first production candidate aligned server membership and launch copy with required
   Convex identity.
2. Its live phone test failed because the mobile first viewport did not contain the same
   sign-in disclosure expected on desktop. Browser health remained clean; the failure was
   a real disclosure gap, not a rendering or network failure.
3. `0c20d9bd` added `Sign-in required` to server-rendered and hydrated first-run surfaces,
   clarified account-plus-code mobile join copy, and added source-contract assertions.
4. Focused tests, `floor`, and the full `prod:gate` were rerun on that exact tree before
   guarded Convex deploy and Vercel publication.
5. The final production suite passed all four journeys.
6. The proof harness was hardened to mask room access codes, and all four journeys passed
   again while producing the redacted artifacts committed with this receipt.

## Acceptance checklist

- [x] Mobile first viewport uses the terracotta launch design and names sign-in before CTA.
- [x] Fresh phone account, room creation, chat, reload, sign-out, and fail-closed re-entry live-tested.
- [x] Fresh desktop account, room creation, chat, reload, sign-out, and fail-closed re-entry live-tested.
- [x] Governed deck path live-tested from plan/preview through scoped request, sourced proposal, approval, evidence, export, and receipt.
- [x] No immediate/sample-only patch is accepted as live success.
- [x] Sample workspace remains visibly labeled synthetic.
- [x] Anonymous production room mutation fails closed server-side.
- [x] AI Elements Tool composes into the real NodeAgent progress card without surrendering existing receipts/status behavior.
- [x] Other-lane work preserved; no destructive reset or blanket dirty-tree commit.
- [x] Convex and Vercel production targets synchronized.
- [ ] Verified-email ownership.
- [ ] Direct visible `jobId` from agent run to proposal.
- [ ] Broad NodeAgent terminal-completion and reload-recovery SLA.
- [ ] Durable server-side export receipt rather than browser-local download receipt.
- [ ] Full light/dark/tablet/reduced-motion accessibility matrix for the authenticated room.

## Open P1s

1. **Password account assurance:** the current password flow authenticates an account but
   does not verify ownership of the entered email. Add a verification challenge or label
   the identifier as unverified and document the launch threat model.
2. **Proposal lineage:** proposal cards show artifact sources and context traces but no
   direct canonical producing `jobId`. Persist and render that relationship.
3. **Long-running agent completion:** the broad evidence-gap prompt emitted a real Tool
   event but was still running in the captured state. Add checkpoint/reload proof and a
   bounded terminal-state SLA. The deck-specific governed proposal did complete.

Additional limitations: PPTX success is a client download/integrity receipt, not a durable
server export ledger; Convex Auth remains a beta dependency; GitHub OAuth is not configured;
the optional outer Omnigent CLI is unavailable; the design audit still reports 560 existing
guidance warnings and a missing canonical token file.

## Resume commands

```powershell
cd 'D:\VSCode Projects\cafecorner_nodebench\nodebench_ai4\noderoom-live-first-user'
node 'C:\Users\hshum\.codex\skills\agentic-ui-qa\scripts\qa-memory.mjs' regressions --dir .qa/memory
node 'C:\Users\hshum\.codex\skills\agentic-ui-qa\scripts\qa-memory.mjs' open --dir .qa/memory
npm run floor
npm run prod:gate
```

Before another release, rerun the four fixed regression fingerprints in `.qa/memory` and
append status changes rather than rewriting the ledger.
