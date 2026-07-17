# Gemini Media Judge

Generated: 2026-07-09T08:30:23.612Z
Model: `gemini-3.5-flash`
Run id: `prod-all-remaining-desktop-2026-07-09`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: publish=1
- Defects: P2=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/artifacts/videos/live-create-export-reload.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | The video successfully demonstrates the end-to-end flow of entering a room from the landing page, navigating sheets, exporting data to XLSX, and reloading the workspace to verify state persistence. |

## Open Defects

- **P2** `docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/artifacts/videos/live-create-export-reload.webm` @ 00:15: After reloading, the active sheet resets to 'Company research' instead of preserving the user's previous selection of 'Q3 variance'. -> Preserve the active sheet state in the URL or local storage across reloads.

## Re-run

```bash
npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/artifacts/videos/live-create-export-reload.webm --run-id prod-all-remaining-desktop-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun-all-remaining/gemini-desktop
```
