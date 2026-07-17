# NodeRoom Fix Loop Report

Run: `2026-07-08-2326`
Original production audit: `docs/qa/prod-dogfood/2026-07-08-2039/QA_REPORT.md`
Production verification: passed on `https://noderoom.live`
Final production deployment: `dpl_4YPmqoppf7XYKkeP89P54EEsEmVQ`

## Outcome

The fix loop resolves QA-001 through QA-005 and all Gemini follow-up defects in production.

| Issue | Before | After |
|---|---|---|
| QA-001 Create a room CTA | Root SSR fallback linked to `/?mode=memory&surface=desktop`. | SSR fallback links to `/?create=1&surface=desktop&name=Host&title=Startup%20diligence`; production no-JS regression passes. |
| QA-002 Export XLSX | Export click did not emit a download or visible error. | Export emits `Q3_variance.xlsx`, shows success/error state, and production download proof has `PK` magic. |
| QA-003 onboarding | Desktop opened the guided-tour overlay; mobile showed a blocking `Got it` card. | Desktop opens a non-modal walkthrough dock; mobile first-join notice is non-modal and dock input remains usable before dismissal. |
| QA-004 CSP | Production QA reported CSP console violations. | Production CSP console gate across public and live routes reports no matching violations. |
| QA-005 FCP | Landing FCP was slow in QA. | Font CSS requests were merged and the production FCP budget gate passes. |
| GEMINI-P2-001 black-frame flicker | Gemini reported black frames around workspace navigation and reload. | Private-route SSR and hydrated live boot shells keep the route nonblank; final Gemini reports no defects. |
| GEMINI-P2-002 active sheet reset | Reload returned to `Company research` after working in `Q3 variance`. | Active artifact is persisted per room and restored after reload; production Playwright and Gemini verify closure. |
| GEMINI-P2-003 sluggish boot skeleton | Follow-up Gemini run said the fresh-room boot skeleton felt sluggish. | Staged startup progress was added; final Gemini reports no defects. |

## Fixes Applied

- `index.html`: live create SSR CTA, combined Google Fonts stylesheet, private-route SSR workspace boot shell, current CSP-compatible inline route guard.
- `vercel.json`: production CSP script hashes updated for the current inline JSON-LD and private-route guard.
- `src/ui/App.tsx`: live create/join/demo routes render a room-shaped progress boot shell until the live session is ready.
- `src/app/styles.css`: staged live-room boot progress styles.
- `src/ui/panels/Artifact.tsx`: XLSX export busy/error/success state, duplicate-click guard, explicit download dispatch, delayed blob URL revoke.
- `src/ui/RoomShell.tsx`: first-run desktop path opens the non-modal walkthrough dock and keeps the full guided tour behind explicit replay/settings actions; active artifact persists per room.
- `src/ui/mobile/MobileGapSheets.tsx` and `src/ui/mobile/mobile.css`: mobile first-join message changed from modal dialog/scrim to anchored non-modal notice.
- Regression coverage added or updated in `e2e/prod-dogfood-fixes.spec.ts`, `e2e/prod-remaining-fixes.spec.ts`, `e2e/tour.spec.ts`, and `e2e/mobile-story-surfaces.spec.ts`.

## Validation

Primary production gate:

```bash
PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_EXPECT_MOBILE_LIVE=1 npx playwright test e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000
```

Result: `9 passed`, `1 skipped` (local-only SSR boot fallback test)

Broader production recorder:

```bash
FIXLOOP_BASE_URL=https://noderoom.live FIXLOOP_RUN_ID=prod-rerun-boot-progress-2026-07-09 FIXLOOP_OUT_DIR=docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress node .tmp/fixloop-rerun.mjs
```

Result: `pass`

Other checks:

- `npm run typecheck -- --pretty false`: pass
- `npm run build`: pass
- `npm run security:gate -- --dist`: pass
- `npx playwright test e2e/mobile-story-surfaces.spec.ts e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000`: pass locally, `19 passed`, `3 skipped`

## Evidence

- Issue ledger: `docs/qa/fixloop/2026-07-08-2326/issues-after.json`
- Validation log: `docs/qa/fixloop/2026-07-08-2326/VALIDATION_LOG.md`
- Fix summary: `docs/qa/fixloop/2026-07-08-2326/FIX_SUMMARY.md`
- Production deploy report: `docs/qa/fixloop/2026-07-08-2326/PROD_DEPLOY_RERUN_REPORT.md`
- Final rerun receipt: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/raw-notes/fixloop-rerun-observations.json`
- Final desktop video: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/videos/live-create-export-reload.webm`
- Final mobile video: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/videos/mobile-join-snapshot.webm`
- Final exported workbook: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/downloads/live-create-q3-variance.xlsx`

## Gemini Visual Judge

Desktop:

- Verdict: `publish`
- Score: `8/16`
- Defects: none

Mobile:

- Verdict: `publish`
- Score: `8/16`
- Defects: none

Summary: `docs/qa/fixloop/2026-07-08-2326/GEMINI_VISUAL_JUDGE.md`

## Remaining Work

None tracked in this fix loop.
