# Walkthrough Review Run

Generated: 2026-06-17T18:55:51.418Z
Run id: `20260617T2015Z`
Model: `gemini-3.5-flash`
Base: http://127.0.0.1:5180
Features: `startup-diligence-war-room`
Primary media: `docs/walkthroughs/startup-diligence-war-room.mp4`

## Commands

```bash
npx.cmd tsx scripts/walkthroughs/capture.ts startup-diligence-war-room
npm.cmd run walkthroughs:render -- startup-diligence-war-room
npm.cmd run media:gemini-judge -- --only startup-diligence-war-room --include-ignored --run-id 20260617T2015Z --model gemini-3.5-flash
npm.cmd run ui:gemini-review -- --media=docs/walkthroughs/startup-diligence-war-room.mp4 --out=docs/eval/walkthrough-review/20260617T2015Z/gemini-ui-review.json --model=gemini-3.5-flash
```

## Evidence

- Media judge: [summary](../../gemini-media-judges/20260617T2015Z/summary.md)
- UI production rubric: [json](gemini-ui-review.json)

> This is a demo-media and UX-review artifact. It does not replace Convex typecheck, browser E2E, provider ladder, privacy, or load-test gates.
