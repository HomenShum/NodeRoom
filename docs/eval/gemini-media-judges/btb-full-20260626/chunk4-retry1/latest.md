# Gemini Media Judge

Generated: 2026-06-26T02:06:29.226Z
Model: `gemini-3.5-flash`
Run id: `btb-full-20260626-chunk4-retry1`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 3
- Judged: 3
- Errors: 0
- Verdicts: publish=3
- Defects: P2=2

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `test-results/bankertoolbench/matrix/e3c47ea1-cc6c-4981-9943-bc85162fc2a8/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 11.7/16 | 0/0/0 | Excellent end-to-end benchmark run showing room creation, file uploads, agent execution, and artifact generation with high fidelity. |
| `test-results/bankertoolbench/matrix/eeba6325-7212-4924-8760-91065d3b1af3/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 12.6/16 | 0/0/1 | Excellent live browser proof demonstrating the end-to-end workflow of creating a room, uploading financial spreadsheets, invoking NodeAgent, and generating a PDF report. |
| `test-results/bankertoolbench/matrix/f205ac8c-4dae-4620-b2c9-ccc44858ec70/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 11.8/16 | 0/0/1 | Excellent live browser proof showing the end-to-end workflow of creating a room, uploading financial data, invoking NodeAgent, and verifying the generated multi-format artifacts. |

## Open Defects

- **P2** `test-results/bankertoolbench/matrix/eeba6325-7212-4924-8760-91065d3b1af3/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:03: The sequential uploading of over 15 files takes a significant portion of the video duration. -> Consider batch-uploading files or pre-loading them in the benchmark harness to streamline the proof.
- **P2** `test-results/bankertoolbench/matrix/f205ac8c-4dae-4620-b2c9-ccc44858ec70/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:46: The trace log text is dense and small, making it slightly difficult to read at standard zoom. -> Increase the default font size or line height of the trace log panel for improved readability.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-full-20260626-chunk4-retry1 --out "docs\\eval\\gemini-media-judges\\btb-full-20260626\\chunk4-retry1" --input "test-results\\bankertoolbench\\matrix\\e3c47ea1-cc6c-4981-9943-bc85162fc2a8\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "test-results\\bankertoolbench\\matrix\\eeba6325-7212-4924-8760-91065d3b1af3\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "test-results\\bankertoolbench\\matrix\\f205ac8c-4dae-4620-b2c9-ccc44858ec70\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm"
```
