# Gemini Media Judge

Generated: 2026-06-21T08:28:41.632Z
Model: `gemini-3.5-flash`
Run id: `live-convex-broad-proof-20260621-post-gate`

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
| `docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm` | live_browser_proof | publish | 11.4/16 | 0/0/1 | The video provides a solid, end-to-end demonstration of NodeRoom's multi-surface workspace, showcasing the document memo, sticky note wall, and financial spreadsheet with live agent traces and conflict resolution. |

## Open Defects

- **P2** `docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm` @ 00:05: The text in the trace log and chat panels is quite small and may be difficult to read on standard README displays. -> Increase the default zoom level of the browser slightly during recording to improve text legibility.

## Re-run

```bash
npm run media:gemini-judge -- --input docs/eval/live-browser-proofs/live-convex-broad-proof-20260620.webm --run-id live-convex-broad-proof-20260621-post-gate --model gemini-3.5-flash --primary-only
```
