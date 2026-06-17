# Gemini Media Judge

Generated: 2026-06-17T18:54:58.389Z
Model: `gemini-3.5-flash`
Run id: `20260617T2015Z`

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
| `docs/walkthroughs/startup-diligence-war-room.mp4` | readme_walkthrough | publish | 10.4/16 | 0/0/0 | Excellent walkthrough demonstrating multi-agent startup diligence with clear public/private lanes, live data enrichment, and structured outputs. |

## Open Defects

(none reported)

## Re-run

```bash
npm run media:gemini-judge -- --only startup-diligence-war-room --include-ignored --run-id 20260617T2015Z --model gemini-3.5-flash
```
