# Gemini Media Judge

Generated: 2026-06-25T04:31:25.196Z
Model: `gemini-3.5-flash`
Run id: `btb-a31173e3-after-fixes-20260624T212409`

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
| `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | The video demonstrates an end-to-end financial analysis workflow where multiple spreadsheets and PDF documents are uploaded to a collaborative room, followed by an agent executing a SOTP valuation task and generating a final PDF report. |

## Open Defects

- **P2** `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:14: PDF files show a placeholder stating 'Preview is not available for this file type' instead of rendering a document preview. -> Implement a basic PDF viewer or thumbnail preview for uploaded documents.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-a31173e3-after-fixes-20260624T212409 --out docs/eval/gemini-media-judges/btb-a31173e3-after-fixes --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\a31173e3-e8aa-4ddb-b0d9-e4e7055c950b\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm"
```
