# Production Deploy And Rerun Report

Run: `2026-07-09`
Target: `https://noderoom.live`
Final production deployment: `dpl_4YPmqoppf7XYKkeP89P54EEsEmVQ`
Final deployment URL: `https://noderoom-paw2e5cv8-hshum2018-gmailcoms-projects.vercel.app`
Alias verified: `https://noderoom.live`

## Deploy Result

| Field | Value |
|---|---|
| URL | `https://noderoom-paw2e5cv8-hshum2018-gmailcoms-projects.vercel.app` |
| Target | `production` |
| Status | `READY` |
| Framework | Vite |
| Alias | `https://noderoom.live` |
| Inspect receipt | `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/deploy-inspect-progress.json` |

Deploy command:

```bash
npx --yes vercel@50.28.0 deploy --prod --yes
```

## Final Production Rerun

Combined production regression:

```bash
PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_EXPECT_MOBILE_LIVE=1 npx playwright test e2e/prod-dogfood-fixes.spec.ts e2e/prod-remaining-fixes.spec.ts e2e/tour.spec.ts --workers=1 --timeout=120000
```

Result: `9 passed`, `1 skipped` (local-only SSR boot fallback test)

Broader production recorder:

```bash
FIXLOOP_BASE_URL=https://noderoom.live FIXLOOP_RUN_ID=prod-rerun-boot-progress-2026-07-09 FIXLOOP_OUT_DIR=docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress node .tmp/fixloop-rerun.mjs
```

Result: `pass`

Coverage:

- SSR Create a room CTA routes to `/?create=1...`, not `mode=memory`.
- Live production room creates successfully.
- Live boot route stays on a nonblank room-shaped progress shell.
- Public chat smoke message appears.
- XLSX export downloads `Q3_variance.xlsx`.
- Exported file is 6560 bytes with `PK` Office zip magic bytes.
- Desktop first-run onboarding is non-modal.
- Mobile first-join notice is non-modal and the dock input is usable before dismissal.
- Active artifact selection survives live room reload.
- CSP console gate found no matching violations across public and live routes.
- Landing FCP budget passed.
- Reload recovers the live room.

## Gemini Visual Judge

Final desktop result:

- Verdict: `publish`
- Score: `8/16`
- Defects: none
- Closed: active sheet reset, black-frame transition/reload flicker, and sluggish boot skeleton follow-up.

Final mobile result:

- Verdict: `publish`
- Score: `8/16`
- Defects: none

Artifacts:

- `docs/qa/fixloop/2026-07-08-2326/prod-rerun-boot-progress/gemini-desktop/latest.json`
- `docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/gemini-mobile/latest.json`
- `docs/qa/fixloop/2026-07-08-2326/GEMINI_VISUAL_JUDGE.md`

## Observability

- Production CSP console gate: pass.
- Vercel error log scan: no error entries; `prod-rerun-boot-progress/vercel-error-logs-progress.jsonl` is 0 bytes.

## Issue Status

| Issue | Status |
|---|---|
| QA-001 Create a room routes to memory | `resolved-prod` |
| QA-002 Export XLSX no download | `resolved-prod` |
| QA-003 onboarding blocks first room | `resolved-prod` |
| QA-004 CSP console errors | `resolved-prod` |
| QA-005 landing FCP | `resolved-prod` |
| GEMINI-P2-001 black-frame transition/reload flicker | `resolved-prod` |
| GEMINI-P2-002 reload active sheet reset | `resolved-prod` |
| GEMINI-P2-003 sluggish boot skeleton | `resolved-prod` |
