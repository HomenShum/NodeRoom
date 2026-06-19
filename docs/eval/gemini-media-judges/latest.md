# Gemini Media Judge

Generated: 2026-06-18T22:12:29.528Z
Model: `gemini-3.5-flash`
Run id: `native-notebook-single-source`

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
| `docs/walkthroughs/first-time-banker-capture.mp4` | readme_walkthrough | publish | 8/16 | 0/0/1 | A clear, well-paced walkthrough demonstrating raw note capture and subsequent automated signal extraction in the intelligence panel. |

## Open Defects

- **P2** `docs/walkthroughs/first-time-banker-capture.mp4` @ 00:04: Typo in typed text: 'pilots.Capture Notebook' lacks a space after the period. -> Re-record or accept as a minor realistic input typo.

## Re-run

```bash
npm run media:gemini-judge -- --only first-time-banker-capture --include-ignored --run-id native-notebook-single-source --model gemini-3.5-flash
```
