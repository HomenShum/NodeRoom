# Gemini Media Judge

Generated: 2026-07-09T07:31:55.191Z
Model: `gemini-3.5-flash`
Run id: `prod-export-focused-final-2026-07-09`

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
| `docs/qa/fixloop/2026-07-08-2326/prod-rerun-final/artifacts/videos/export-xlsx-focused.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video successfully demonstrates the 'Export XLSX' feature within the NodeRoom environment, starting from the landing page, transitioning into the room, and executing the export workflow to a completed download state. |

## Open Defects

(none reported)

## Re-run

```bash
npm run media:gemini-judge -- --input docs/qa/fixloop/2026-07-08-2326/prod-rerun-final/artifacts/videos/export-xlsx-focused.webm --run-id prod-export-focused-final-2026-07-09 --out docs/qa/fixloop/2026-07-08-2326/prod-rerun-final/gemini-export-focused
```
