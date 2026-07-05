# Walkthrough Review Run

Generated: 2026-07-05T01:01:30.978Z
Run id: `20260705T010130Z`
Model: `gemini-3.5-flash`
Base: https://noderoom.live
Features: `notebook-agent-lane`
Primary media: `docs/walkthroughs/notebook-agent-lane.mp4`

## Commands

```bash
npx.cmd tsx scripts/walkthroughs/capture.ts notebook-agent-lane
npm.cmd run walkthroughs:render -- notebook-agent-lane
npm.cmd run media:gemini-judge -- --only notebook-agent-lane --include-ignored --run-id 20260705T010130Z --model gemini-3.5-flash
```

## Evidence

- Media judge: [summary](../../gemini-media-judges/20260705T010130Z/summary.md)
- UI production rubric: not requested for this run

> This is a demo-media and UX-review artifact. It does not replace backend typecheck, browser E2E, provider ladder, privacy, or load-test gates.
