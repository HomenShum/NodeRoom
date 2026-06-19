# Walkthrough Review Run

Generated: 2026-06-18T22:10:18.440Z
Run id: `native-notebook-single-source`
Model: `gemini-3.5-flash`
Base: http://127.0.0.1:5275
Features: `first-time-banker-capture`
Primary media: `docs/walkthroughs/first-time-banker-capture.mp4`

## Commands

```bash
npx.cmd tsx scripts/walkthroughs/capture.ts first-time-banker-capture
npm.cmd run walkthroughs:render -- first-time-banker-capture
npm.cmd run media:gemini-judge -- --only first-time-banker-capture --include-ignored --run-id native-notebook-single-source --model gemini-3.5-flash
npm.cmd run ui:gemini-review -- --media=docs/walkthroughs/first-time-banker-capture.mp4 --out=docs/eval/walkthrough-review/native-notebook-single-source/gemini-ui-review.json --model=gemini-3.5-flash
```

## Evidence

- Media judge: [summary](../../gemini-media-judges/native-notebook-single-source/summary.md)
- UI production rubric: [json](gemini-ui-review.json)

> This is a demo-media and UX-review artifact. It does not replace backend typecheck, browser E2E, provider ladder, privacy, or load-test gates.
