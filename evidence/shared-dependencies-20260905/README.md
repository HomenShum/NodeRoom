# NodeRoom dependency handoff proof

A developer could install this application, but its immutable mounted-package gate and production dependency audit stopped integration. This candidate restores the two declared NodeSlide root pins and uses the first patched Tiptap cohort. It has not yet passed independent final review or new-commit shared CI.

The exact candidate keeps all 30 Tiptap packages at 3.30.4, ProseMirror model 1.25.11/view 1.41.9, and the original nested uuid 14.0.1. Only 33 lock rows change: root metadata, 30 Tiptap rows, and those two ProseMirror rows. Other dependency rows, overrides, vendor packages, workflows, application code and existing tests are unchanged. [Exact lock comparison](worker/final-lock-delta.json) records all rows; [installed identities](worker/installed-identities-final.json) binds 38 installed packages.

## Actual results

- Normal `npm ci` passed; the [production audit](worker/audit-production-final.log) has zero findings at the unchanged moderate threshold. The [full audit](worker/audit-full-final.log) still has one inherited high development-only Browserslist finding. It is not a clean full audit.
- The unchanged [mounted release proof](worker/mounted-consumer-receipt.json) passed against all 11 immutable tarballs, a fresh separately npm-installed consumer, actual isolated component authorization/lifecycle calls, and four existing NodeRoom journeys. It records the existing de9 commit with dirty candidate state; this is not a new committed release certificate.
- The real installed library [before canary](worker/prototype-before-final.json) exposed inherited executable DOM attributes in 1,025 iterations; the exact [after canary](worker/prototype-after.json) rejects that path in all 1,025. Single/last malicious-object and benign later-object controls distinguish the actual helper behavior. No browser handlers were executed, and this is not proof of an exploitable NodeRoom route. The initial middle-object-only probe passed on old code; its original script/result are preserved.
- Seven unchanged notebook/export test files passed 51 tests. Both TypeScript checks and the normal build passed. The unchanged built-preview memory suite passed 29 tests. [Build log](worker/build-final.log), [scenario log](worker/notebook-and-export-tests-final.log), [memory log](worker/memory-browser-final.log).
- The unchanged notebook provenance browser spec **failed 3/3 on both before and after builds**. The 375 px missing-block error matches exactly. Desktop and 320 px hit different steps/artifacts, so the comparison does not prove absence of a notebook regression. All six actual PNGs and traces remain in [after](worker/notebook-browser/results.json) and [before](worker/notebook-browser-before/results.json); [comparison](worker/notebook-before-after-comparison.json) retains exact errors. Routes explicitly selected the desktop workbench even at narrow widths; these are not natural mobile certification or whole-UI grades.

## Fresh developer replay

Use Node22 and a clean checkout. No provider key, backend deployment, native Office, or local environment file is needed for these commands. Keep any existing local environments separate.

```powershell
npm ci
npm audit --omit=dev --audit-level=moderate
npm run nodeslide:mounted:release:proof
npx vitest run tests/notebookPaper.test.tsx tests/nativeNotebookProsemirror.test.ts tests/nativeNotebookProsemirrorStatic.test.ts tests/notebookBlockOps.test.ts tests/notebookAgentOutline.test.ts tests/mobileSampleWorkbookExport.test.ts tests/artifactXlsxExport.test.ts
npx tsc --noEmit --project convex/tsconfig.json --pretty false
npm run build
npx playwright install chromium
npm run test:product:memory
```

On Linux only, `npx playwright install --with-deps chromium` also installs missing operating-system browser prerequisites when permitted. For the library canary, create a new output directory; do not overwrite these retained results:

```powershell
$ProofDir = Join-Path (Get-Location) '.proofloop/dependency-canary-replay'
New-Item -ItemType Directory -Path $ProofDir -ErrorAction Stop
node evidence/shared-dependencies-20260905/prototype-canary.mjs (Get-Location).Path $ProofDir replay
```

The normal unchanged `floor` and `prod:gate` remain authoritative. Local selected commands do not replace them. Do not run the Windows native Office case as part of this dependency-only replay; its deadline diagnosis is separate. Run full normal gates in the ordinary shared Linux workflow before recommending integration. The currently failed notebook browser spec can be reproduced with `npx playwright test e2e/notebook-agent-notes.spec.ts --workers=1 --retries=0`; its normal development-server run is distinct from the retained built-preview run.

## Resolution history and custody

Two native incremental operations failed ERESOLVE without lock/install changes. Removing only the approved 30 stale Tiptap resolution rows let npm rebuild the peer cohort, but optional caret ranges selected two menu versions and view above the frozen target. Those rejected bytes remain. Parent-approved temporary direct constraints selected the exact three versions through native npm, then were removed before installation. Final roots are exactly original+two NodeSlide pins with six updated Tiptap ranges. There are no permanent resolver constraints, overrides, peer bypasses, compatibility aliases, fixture-row transplants, or manually invented integrity values.

[Before archive](worker/installed-and-build-before.zip) preserves and hashes 1,388 installed dependency/vendor/build files; [archive manifest](worker/installed-and-build-before.json) verifies them. The before browser served 475 old built files extracted from that archive without modifying current dist. [Current build/installed bindings](worker/built-installed-proof-bindings.json) name the after bytes. The [copy map](raw-copy-map.json) links raw payloads to their retained operator source and exact hash; historical reports may contain operator-specific paths. Those are historical context, not portable command defaults. Raw Markdown is copied as `.md.txt`. No environment/state/credential files or browser capability sessions are packaged.

## Remaining holds

Final independent review, ordinary new-commit checks and shared CI are pending. The historical de9 push-message failure remains; a conforming new commit cannot change that history. The next multi-file commit must use Change list/Verification/Known limits with every actual changed path verbatim, then run the actual-HEAD check. No history rewrite or gate change is authorized here.

The notebook browser limitation, Windows native-repair deadline, development advisory, missing nightly credential, desktop blank Account export and existing mobile reading limitations remain open. The mobile export packet still proves its original source/dependency bytes; this later dependency receipt does not rewrite it. Full visual, responsive, accessibility, performance, provider, native Office, production and human-usage grades remain unassigned. No provider call, deployment or hook activation occurred.
