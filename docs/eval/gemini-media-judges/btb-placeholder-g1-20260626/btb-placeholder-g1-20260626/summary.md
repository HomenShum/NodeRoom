# Gemini Media Judge

Generated: 2026-06-26T03:15:56.161Z
Model: `gemini-3.5-flash`
Run id: `btb-placeholder-g1-20260626`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 2
- Judged: 2
- Errors: 0
- Verdicts: publish=2
- Defects: P2=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `test-results/bankertoolbench/matrix/5495a5a9-1087-4fd9-97f9-d677dd856e24/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | Excellent benchmark run showing file uploads, agent execution, and verification of generated financial artifacts. |
| `test-results/bankertoolbench/matrix/b957a435-13bf-469b-b4de-fa55e3b15edd/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video demonstrates a complete end-to-end benchmark run where multiple financial data files are uploaded, a task brief is loaded, and NodeAgent is executed to generate a comprehensive valuation model package including spreadsheets, a presentation, and a PDF report. |

## Open Defects

- **P2** `test-results/bankertoolbench/matrix/5495a5a9-1087-4fd9-97f9-d677dd856e24/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:00: Initial 1-second black screen before the landing page loads. -> Trim the first second of the video.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-placeholder-g1-20260626 --out "docs\\eval\\gemini-media-judges\\btb-placeholder-g1-20260626" --input "test-results\\bankertoolbench\\matrix\\5495a5a9-1087-4fd9-97f9-d677dd856e24\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "test-results\\bankertoolbench\\matrix\\b957a435-13bf-469b-b4de-fa55e3b15edd\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm"
```
