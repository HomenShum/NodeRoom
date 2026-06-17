# Gemini Media Judge

Generated: 2026-06-17T19:10:18.405Z
Model: `gemini-3.5-flash`
Run id: `cli-package-gemini-smoke`

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
| `docs/walkthroughs/startup-diligence-war-room.mp4` | readme_walkthrough | publish | 11.9/16 | 0/0/1 | A highly complete and professional walkthrough of the Startup Diligence War Room, demonstrating multi-agent research, public/private lanes, and downstream draft generation with clear UI states. |

## Open Defects

- **P2** `docs/walkthroughs/startup-diligence-war-room.mp4` @ 00:26: The text in the private agent chat pane is quite dense and small, making it slightly hard to read quickly. -> Slightly increase the font size or line height of the agent chat bubbles for better readability.

## Re-run

```bash
npm run media:gemini-judge -- --only startup-diligence-war-room --include-ignored --run-id cli-package-gemini-smoke --model gemini-3.5-flash
```
