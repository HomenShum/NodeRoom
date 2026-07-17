# Validation Log

Run: `2026-07-08-2326`

## Final Deterministic Checks

| Command | Result | Notes |
|---|---|---|
| `npm run typecheck -- --pretty false` | pass | TypeScript check completed cleanly. |
| `npm run build` | pass | `tsc --noEmit && vite build` completed; Vite emitted the existing large-main-chunk warning. |
| `npm run security:gate -- --dist` | pass | Headers, browser egress, secret scan, session policy, and provider policy passed. |
| `npx playwright test e2e/prod-remaining-fixes.spec.ts --workers=1 --timeout=120000` | pass | 4 passed, 2 production-live tests skipped locally. |
| `npx playwright test e2e/mobile-story-surfaces.spec.ts e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000` | pass | 19 passed, 3 production-live tests skipped locally. |

## Final Production Deploy

| Field | Value |
|---|---|
| Deployment id | `dpl_4YPmqoppf7XYKkeP89P54EEsEmVQ` |
| Deployment URL | `https://noderoom-paw2e5cv8-hshum2018-gmailcoms-projects.vercel.app` |
| Alias | `https://noderoom.live` |
| Inspect receipt | `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/deploy-inspect-progress.json` |
| Error logs | `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/vercel-error-logs-progress.jsonl` (0 bytes) |

Deploy command:

```bash
npx --yes vercel@50.28.0 deploy --prod --yes
```

Result: pass, aliased to `https://noderoom.live`.

## Final Production Gates

| Command | Result | Notes |
|---|---|---|
| `PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_EXPECT_MOBILE_LIVE=1 npx playwright test e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000` | pass | 9 passed, 1 local-only SSR fallback test skipped; includes export, CSP, mobile first-join, active artifact reload, and FCP gates. |
| `FIXLOOP_BASE_URL=https://noderoom.live FIXLOOP_RUN_ID=prod-rerun-boot-progress-2026-07-09 FIXLOOP_OUT_DIR=docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress node .tmp/fixloop-rerun.mjs` | pass | SSR CTA, live create, chat smoke, XLSX export, reload recovery, and mobile join snapshot passed. |

## Gemini Visual Judge

| Command | Result | Notes |
|---|---|---|
| `npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/videos/live-create-export-reload.webm --run-id prod-boot-progress-desktop-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/gemini-desktop` | pass | Verdict `publish`, score `8/16`, defects none. |
| `npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/artifacts/videos/mobile-join-snapshot.webm --run-id prod-all-remaining-mobile-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/gemini-mobile` | pass | Verdict `publish`, score `8/16`, defects none. |

## Final Evidence

- Final prod rerun receipt: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/raw-notes/fixloop-rerun-observations.json`
- Final desktop proof video: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/videos/live-create-export-reload.webm`
- Final mobile proof video: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/videos/mobile-join-snapshot.webm`
- Final exported workbook: `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/artifacts/downloads/live-create-q3-variance.xlsx`
- Final Gemini summary: `docs/qa/fixloop/2026-07-08-2326/GEMINI_VISUAL_JUDGE.md`
