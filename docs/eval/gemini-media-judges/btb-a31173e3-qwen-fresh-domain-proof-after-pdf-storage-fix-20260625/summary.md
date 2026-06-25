# Gemini Media Judge

Generated: 2026-06-25T10:39:48.199Z
Model: `gemini-3.5-flash`
Run id: `btb-a31173e3-qwen-fresh-domain-proof-after-pdf-storage-fix-20260625`

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
| `test-results/bankertoolbench/matrix/a31173e3-e8aa-4ddb-b0d9-e4e7055c950b/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 8/16 | 0/0/0 | The video demonstrates NodeAgent executing a DCF SOTP valuation for Alphabet Inc. inside NodeRoom, covering room creation, document uploads, live agent execution with trace logs, and final artifact generation. |

## Open Defects

(none reported)

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-a31173e3-qwen-fresh-domain-proof-after-pdf-storage-fix-20260625 --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\a31173e3-e8aa-4ddb-b0d9-e4e7055c950b\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm" --out "docs\\eval\\gemini-media-judges"
```
