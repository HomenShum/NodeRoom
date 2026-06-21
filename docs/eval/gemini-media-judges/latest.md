# Gemini Media Judge

Generated: 2026-06-21T11:42:40.601Z
Model: `gemini-3.5-flash`
Run id: `live-convex-agent-20260621T113838Z`

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
| `docs/eval/gemini-media-judges/live-convex-agent-20260621T113838Z/live-proof.webm` | live_browser_proof | fix-then-publish | 11.6/16 | 0/1/0 | The video successfully demonstrates collaborative spreadsheet editing and multi-agent execution (public and private) within the NodeRoom war room. However, it suffers from an 8-second blank white screen at the start which needs to be trimmed. |

## Open Defects

- **P1** `docs/eval/gemini-media-judges/live-convex-agent-20260621T113838Z/live-proof.webm` @ 00:00: The video starts with an empty white screen lasting approximately 8 seconds before the UI loads. -> Trim the video to start at 0:09 when the login screen appears.

## Re-run

```bash
npm run media:gemini-judge -- --input=docs/eval/gemini-media-judges/live-convex-agent-20260621T113838Z/live-proof.webm --run-id live-convex-agent-20260621T113838Z --model gemini-3.5-flash
```
