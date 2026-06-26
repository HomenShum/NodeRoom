# Gemini Media Judge

Generated: 2026-06-26T02:19:04.243Z
Model: `gemini-3.5-flash`
Run id: `btb-full-20260626-bc55-rerun`

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
| `test-results/bankertoolbench/matrix/bc55d3e8-0d59-43d6-a385-03c5330e47bf/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` | live_browser_proof | publish | 11/16 | 0/0/1 | This live browser proof successfully demonstrates the complete end-to-end workflow of creating a room, uploading financial source documents, invoking the NodeAgent, and generating a comprehensive package of financial model deliverables. |

## Open Defects

- **P2** `test-results/bankertoolbench/matrix/bc55d3e8-0d59-43d6-a385-03c5330e47bf/playwright-output/e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier/video.webm` @ 00:24: The PDF preview for the Uber 10-K document displays a loading state briefly before the user switches to another tab. -> Ensure PDF previews render fully before navigating away to demonstrate seamless document viewing.

## Re-run

```bash
npm run media:gemini-judge -- --run-id btb-full-20260626-bc55-rerun --out "docs\\eval\\gemini-media-judges\\btb-full-20260626\\bc55-rerun" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\bankertoolbench\\matrix\\bc55d3e8-0d59-43d6-a385-03c5330e47bf\\playwright-output\\e2e-benchmark-ui-bankertoo-d0047-odeagent---package-verifier\\video.webm"
```
