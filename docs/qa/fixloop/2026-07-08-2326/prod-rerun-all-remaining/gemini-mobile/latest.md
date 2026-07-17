# Gemini Media Judge

Generated: 2026-07-09T08:30:42.136Z
Model: `gemini-3.5-flash`
Run id: `prod-all-remaining-mobile-2026-07-09`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: publish=1
- Defects: none

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/artifacts/videos/mobile-join-snapshot.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video demonstrates a mobile user joining a live NodeRoom session ('Startup Diligence') with a clear transition from the join screen to the active room and a welcome modal. |

## Open Defects

(none reported)

## Re-run

```bash
npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/artifacts/videos/mobile-join-snapshot.webm --run-id prod-all-remaining-mobile-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/gemini-mobile
```
