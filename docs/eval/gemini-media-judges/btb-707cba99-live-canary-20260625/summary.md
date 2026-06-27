# Gemini Media Judge

Generated: 2026-06-25T23:34:28.164Z
Model: `gemini-3.5-flash`
Run id: `btb-707cba99-live-canary-20260625`

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
| `test-results/bankertoolbench/matrix/707cba99-59a7-47bd-bc4d-7f36212e99f3/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 12/16 | 0/0/0 | The video demonstrates a complete end-to-end workflow of NodeAgent, from room creation and spreadsheet data upload to invoking an AI agent for financial analysis and viewing the generated PDF report. |

## Open Defects

(none reported)

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-707cba99-live-canary-20260625 --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\707cba99-59a7-47bd-bc4d-7f36212e99f3\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --out "docs\\eval\\gemini-media-judges"
```
