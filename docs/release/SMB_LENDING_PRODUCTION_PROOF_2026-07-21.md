# SMB Lending Deployment Room production proof

- Date: 2026-07-21
- Public application: https://noderoom.live
- Reviewed merge commit: `631c53089a1bd3dc8354e21b20b31bfa880f5020`
- Merged pull request: https://github.com/HomenShum/NodeRoom/pull/238
- Final clean-tree Vercel deployment: `dpl_4mnkzEvigrAZLcu2brhmc1KS3gaj`
Convex deployment: `zealous-goshawk-766`

## Verdict

PASS for the native NodeRoom SMB lending template lifecycle.

The test used a fresh production room under an authenticated profile. The invite code is
intentionally omitted because it grants editor access. The fixture is synthetic and the
workflow makes no credit decision.

## Release gates

- `npm run prod:gate` passed from the reviewed merge tree.
- Audit reported zero vulnerabilities.
- Both TypeScript targets passed.
- The full repository suite passed: 370 files and 2,563 tests.
- The production build passed.
- Convex reported all 313 exported functions live.
- The final Vercel build came from a clean detached worktree at the exact merge commit.
- The served runtime bundle resolves `VITE_CONVEX_URL` to
  `https://zealous-goshawk-766.convex.cloud`.

## Browser journey

1. Opened `https://noderoom.live/#smb-lending` in authenticated Chrome.
2. Created a fresh canonical Convex room containing eight binder artifacts and one
   version-pinned pending proposal.
3. Approved the document-request proposal.
4. Observed CAS transition `missing -> requested` and creation of the sequential
   evidence-verification proposal.
5. Approved the evidence-verification proposal.
6. Observed CAS transition `requested -> verified` with source
   `src-bank-statements-q2`, locator `fixture://bay-hearth/bank-statements-q2`, and
   immutable digest `sha256:synthetic-bank-statements-q2`.
7. Observed atomic regeneration of Proposal review, Proof receipt, Human review credit
   packet, and Export bundle.
8. Ran `Export + reopen proof`; the UI independently reopened and verified both hashes.
9. Reloaded the production room and observed the same verified state and proof receipt.
10. Reloaded again after the final clean-tree Vercel deployment and observed the same
    receipt, proving backend state survived frontend replacement.

## NodeProof receipt

- Application version: `3`
- Application hash:
  `6cf83646c22f4dae8cb922d5aa222f0c3fa33b58786f5078cb77eff76953306d`
- Packet hash:
  `59cdd91e4b4b2f71a6ff984c0b108f2317b50ef2dd5dc2aefc645e3260db44dc`
- Proposal reviewed: `true`
- Base versions matched: `true`
- Source lineage present: `true`
- No credit decision: `true`

## Deployment defect found by the proof run

The first browser attempt stalled because the Vercel production bundle was compiled
against the repository fallback deployment (`happy-otter-123`) while the reviewed Convex
functions were deployed to `zealous-goshawk-766`. HTTP health checks alone did not expose
the split.

The Vercel production values for `VITE_CONVEX_URL` and `VITE_CONVEX_SITE_URL` were updated
to the reviewed deployment. The exact clean commit was then redeployed and the served
runtime bundle was inspected before rerunning the browser journey. This failure is now
part of the release evidence: frontend/backend binding must be verified from the served
bundle, not inferred from a successful deployment command.

## Evidence handling

Two browser screenshots were captured locally: the verified evidence checklist and the
NodeProof receipt. They are not committed because the application header contains the
unlisted room invite code. The hashes and deterministic receipt fields above are the
portable public evidence.

## Remaining boundary

The native template uses synthetic evidence and a governed evidence-supply proposal. A
separate production test should upload actual fixture bytes through the browser, attach
their content digest, and prove export/reopen from that upload. That is additional upload
coverage, not a failure of the certified proposal/CAS/receipt lifecycle.
