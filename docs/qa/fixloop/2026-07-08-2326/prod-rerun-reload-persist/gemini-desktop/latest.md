# Gemini Media Judge

Generated: 2026-07-09T09:01:00.852Z
Model: `gemini-3.5-flash`
Run id: `prod-reload-persist-desktop-2026-07-09`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: publish=1
- Defects: P2=2

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/qa/fixloop/2026-07-08-2326/prod-rerun-reload-persist/artifacts/videos/live-create-export-reload.webm` | live_browser_proof | publish | 10.4/16 | 0/0/2 | The browser proof demonstrates the landing page widget, workspace navigation, and sheet rendering. It successfully verifies the reload and persistence flow, though transitions are slightly abrupt. |

## Open Defects

- **P2** `docs/qa/fixloop/2026-07-08-2326/prod-rerun-reload-persist/artifacts/videos/live-create-export-reload.webm` @ 00:15: Abrupt black frame transition between the landing page and the workspace view. -> Smooth the transition or ensure continuous recording without frame drops.
- **P2** `docs/qa/fixloop/2026-07-08-2326/prod-rerun-reload-persist/artifacts/videos/live-create-export-reload.webm` @ 00:18: Brief black screen flicker before returning to the workspace. -> Eliminate the blank frame during the reload sequence.

## Re-run

```bash
npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun-reload-persist/artifacts/videos/live-create-export-reload.webm --run-id prod-reload-persist-desktop-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun-reload-persist/gemini-desktop
```
