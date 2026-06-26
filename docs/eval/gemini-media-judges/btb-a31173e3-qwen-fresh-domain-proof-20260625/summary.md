# Gemini Media Judge

Generated: 2026-06-25T10:28:21.037Z
Model: `gemini-3.5-flash`
Run id: `btb-a31173e3-qwen-fresh-domain-proof-20260625`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 1
- Judged: 1
- Errors: 0
- Verdicts: fix-then-publish=1
- Defects: P1=1

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | fix-then-publish | 8/16 | 0/1/0 | The video demonstrates the complete workflow of NodeAgent executing a complex financial valuation task. However, database upload errors occur for the PDF files. |

## Open Defects

- **P1** `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:17: An error toast appears stating 'Failed to upload GOOG-10K-2023.pdf: Upload failed: Error: Value is too large (1.74 GB) for column 'value' in table 'room_files'.' -> Resolve the database column size constraint or optimize file upload chunking to handle standard PDF documents.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-a31173e3-qwen-fresh-domain-proof-20260625 --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\a31173e3-e8aa-4ddb-b0d9-e4e7055c950b\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --out "docs\\eval\\gemini-media-judges"
```
