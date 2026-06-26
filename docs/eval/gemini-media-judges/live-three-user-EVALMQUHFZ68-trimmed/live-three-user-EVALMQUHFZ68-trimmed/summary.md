# Gemini Media Judge

Generated: 2026-06-26T05:34:52.502Z
Model: `gemini-3.5-flash`
Run id: `live-three-user-EVALMQUHFZ68-trimmed`

> This judges README/demo media quality only. It does not replace live Convex, browser E2E, provider ladder, parser, privacy, or load-test gates.

## Summary

- Assets: 3
- Judged: 3
- Errors: 0
- Verdicts: publish=3
- Defects: P2=4

## Asset Results

| Asset | Class | Verdict | Score | P0/P1/P2 | Main finding |
|---|---|---:|---:|---:|---|
| `test-results/live-videos/trimmed/page@77ccf51f697aa81cc013e0a02f5fd1ef.webm` | live_browser_proof | publish | 11.9/16 | 0/0/2 | The video successfully demonstrates the NodeRoom live browser benchmark proof, showing the spreadsheet loading, agent invocation, execution trace, and cell updates. |
| `test-results/live-videos/trimmed/page@8718a89c6cd456a8d9ca86a3a2d2a6ed.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | The live browser proof successfully demonstrates the NodeRoom collaborative environment, showing spreadsheet updates, agent execution, and proof generation. The video contains a brief blank screen at the start but is otherwise complete and functional. |
| `test-results/live-videos/trimmed/page@c2d2cff5bbf5c403022317f57803136b.webm` | live_browser_proof | publish | 8/16 | 0/0/1 | The video successfully demonstrates the live browser benchmark proof, showing collaborative spreadsheet edits, agent invocation, and the generation of the public room proof cell. |

## Open Defects

- **P2** `test-results/live-videos/trimmed/page@77ccf51f697aa81cc013e0a02f5fd1ef.webm` @ 00:00: Blank white screen visible for the first 4 seconds of the video. -> Trim the initial loading frames to start directly on the UI.
- **P2** `test-results/live-videos/trimmed/page@77ccf51f697aa81cc013e0a02f5fd1ef.webm` @ 01:01: The video continues running with minimal activity after the main workflow completes. -> Trim the trailing inactive portion of the video to reduce file size.
- **P2** `test-results/live-videos/trimmed/page@8718a89c6cd456a8d9ca86a3a2d2a6ed.webm` @ 00:00: The video starts with a blank white screen for the first four seconds. -> Trim the initial blank frames to start directly on the landing page.
- **P2** `test-results/live-videos/trimmed/page@c2d2cff5bbf5c403022317f57803136b.webm` @ 01:30: Long period of inactivity and idle state from 01:30 to 04:10. -> Trim the inactive middle section of the benchmark run if possible.

## Re-run

```bash
npm run media:gemini-judge -- --run-id live-three-user-EVALMQUHFZ68-trimmed --out docs/eval/gemini-media-judges/live-three-user-EVALMQUHFZ68-trimmed --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\live-videos\\trimmed\\page@8718a89c6cd456a8d9ca86a3a2d2a6ed.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\live-videos\\trimmed\\page@77ccf51f697aa81cc013e0a02f5fd1ef.webm" --input "C:\\Users\\hshum\\.codex\\worktrees\\b349\\noderoom\\test-results\\live-videos\\trimmed\\page@c2d2cff5bbf5c403022317f57803136b.webm"
```
