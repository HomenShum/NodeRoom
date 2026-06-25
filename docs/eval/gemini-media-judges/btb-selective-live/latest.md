# Gemini Media Judge

Generated: 2026-06-25T04:17:26.810Z
Model: `gemini-3.5-flash`
Run id: `btb-selective-live-20260624T210509`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 3
- Judged: 3
- Errors: 0
- Verdicts: publish=2, fix-then-publish=1
- Defects: P2=3, P1=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `test-results/bankertoolbench/matrix/7b078eaa-4fe4-4780-9f53-531872b73274/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 10.8/16 | 0/0/1 | The video demonstrates NodeRoom's collaborative environment where a user uploads multiple financial spreadsheets and a task brief, triggering an AI agent that processes the data and generates a valuation comparison PDF report. |
| `test-results/bankertoolbench/matrix/9781216f-b98d-4537-9ab8-f0e62248a6ab/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 12.6/16 | 0/0/1 | The video demonstrates an end-to-end workflow where an AI agent processes uploaded financial spreadsheets and a task brief to generate a multi-entity financial metrics package. |
| `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | fix-then-publish | 8/16 | 0/1/1 | The video demonstrates an automated run of NodeAgent processing financial sheets and executing a task brief. While highly complete, the rapid execution speed and dense UI make it difficult to follow as a standard user-facing demo. |

## Open Defects

- **P2** `test-results/bankertoolbench/matrix/7b078eaa-4fe4-4780-9f53-531872b73274/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:03: The file upload sequence is repetitive and takes over a minute of screen time. -> Speed up or trim the initial file uploading phase to keep the video concise.
- **P2** `test-results/bankertoolbench/matrix/9781216f-b98d-4537-9ab8-f0e62248a6ab/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 01:55: XLSX file preview is not supported, showing a placeholder message. -> Implement basic spreadsheet preview or guide the user to download the file directly.
- **P1** `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 01:10: The execution speed is extremely fast, making it difficult for a human viewer to comprehend the agent's steps. -> Slow down the playback or add pauses during key transitions and agent decisions.
- **P2** `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 02:13: Multiple 'tool_call_rate_limit_deliverable_package_failed' errors appear in the chat log. -> Ensure the agent has sufficient rate limits or handle errors more gracefully in the UI.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-selective-live-20260624T210509 --out docs/eval/gemini-media-judges/btb-selective-live --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\7b078eaa-4fe4-4780-9f53-531872b73274\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\9781216f-b98d-4537-9ab8-f0e62248a6ab\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\a31173e3-e8aa-4ddb-b0d9-e4e7055c950b\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm"
```
