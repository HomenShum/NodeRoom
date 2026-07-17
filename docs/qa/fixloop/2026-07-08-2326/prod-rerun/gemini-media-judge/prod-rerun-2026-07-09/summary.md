# Gemini Media Judge

Generated: 2026-07-09T07:23:45.955Z
Model: `gemini-3.5-flash`
Run id: `prod-rerun-2026-07-09`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: fix-then-publish=1
- Defects: P2=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/qa/fixloop/2026-07-08-2326/prod-rerun/artifacts/videos/live-create-export-reload.webm` | live_browser_proof | fix-then-publish | 10/16 | 0/0/1 | The clip demonstrates the NodeRoom landing page, transition to the workspace, and views of the spreadsheet and company research tables. However, there is a brief black screen flicker during reload at 00:21. |

## Open Defects

- **P2** `docs/qa/fixloop/2026-07-08-2326/prod-rerun/artifacts/videos/live-create-export-reload.webm` @ 00:21: A black frame/flicker occurs during the transition or reload of the workspace. -> Smooth out the transition or capture the reload without a blank black frame.

## Re-run

```bash
npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun/artifacts/videos/live-create-export-reload.webm --run-id prod-rerun-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun/gemini-media-judge
```
