# Walkthrough Review Run

Generated: 2026-06-17T19:09:20.259Z
Run id: `cli-package-gemini-smoke`
Model: `gemini-3.5-flash`
Base: https://noderoom.live
Features: `startup-diligence-war-room`
Primary media: `docs/walkthroughs/startup-diligence-war-room.mp4`

## Commands

```bash
npm.cmd run media:gemini-judge -- --only startup-diligence-war-room --include-ignored --run-id cli-package-gemini-smoke --model gemini-3.5-flash
npm.cmd run ui:gemini-review -- --media=docs/walkthroughs/startup-diligence-war-room.mp4 --out=docs/eval/walkthrough-review/cli-package-gemini-smoke/gemini-ui-review.json --model=gemini-3.5-flash
```

## Evidence

- Media judge: [summary](../../gemini-media-judges/cli-package-gemini-smoke/summary.md)
- UI production rubric: [json](gemini-ui-review.json)

> This is a demo-media and UX-review artifact. It does not replace backend typecheck, browser E2E, provider ladder, privacy, or load-test gates.
