---
name: walkthrough-review
description: Record a live browser walkthrough, render a README-quality GIF/MP4, run Gemini video/UI review, fix defects, and update proof docs. Use when a feature needs demo evidence, README media, product walkthrough QA, or a reusable solo-founder verification loop.
---

# Walkthrough Review Skill

Use this skill when the user asks for a recorded product walkthrough, demo GIF/video,
Gemini video understanding review, README media proof, or a "prove the UX is good"
loop. The goal is not a hero screenshot. The goal is a reproducible workflow:

```text
feature spec -> browser capture -> annotated render -> Gemini judge -> defect fixes -> README proof
```

## Non-Negotiable Bar

Do not claim a walkthrough is good, optimal, README-ready, or production-quality unless
all of these exist:

- A browser-recorded walkthrough artifact: `docs/walkthroughs/<feature>.mp4` or `.gif`.
- A model-assisted review artifact from Gemini: `docs/eval/gemini-media-judges/<run>/summary.md`.
- A clear defect disposition: P0/P1 fixed before publishing; P2 either fixed or documented.
- A README or docs link that says what the clip proves and what it does not prove.

The judge should compare the interaction quality against polished professional tools
such as Notion and Linear: calm hierarchy, obvious active state, dense-but-readable
information, low step count, and no ambiguous mode changes.

## Primary Command

Run the bundled wrapper:

```bash
npm run walkthroughs:review -- startup-diligence-war-room --ui-review
```

Useful variants:

```bash
# Recapture and rejudge the two flagship startup clips.
npm run walkthroughs:review -- startup-diligence-war-room startup-diligence-live-join --ui-review

# Rejudge existing media only, without recapture/render.
npm run walkthroughs:review -- startup-diligence-war-room --skip-capture --skip-render --ui-review

# Use a specific base URL, e.g. local dev or production.
npm run walkthroughs:review -- startup-diligence-war-room --base=http://127.0.0.1:5178 --ui-review

# Intentionally judge already-rendered media even if a fresh capture skipped.
# This is advisory only; never use it for fresh evidence claims.
npm run walkthroughs:review -- startup-diligence-war-room --allow-skipped --skip-render --ui-review
```

The wrapper writes a run manifest to:

```text
docs/eval/walkthrough-review/<run-id>/README.md
```

and the media judge writes:

```text
docs/eval/gemini-media-judges/<run-id>/summary.md
```

## Capture Rules

- Prefer a fresh room for live captures unless the spec explicitly uses memory mode.
- The wrapper fails by default if a requested feature is skipped or captured with zero
  segments. Use `--allow-skipped` only when intentionally judging old media.
- Show every state: empty/before state, cursor target, loading/streaming, result.
- For collaboration, use one browser context per persona. Shared localStorage silently
  reuses the first persona and invalidates the proof.
- Keep captions short and outcome-oriented. Captions explain why the step matters, not
  just which button was clicked.
- Make active mode switches visible. Public/private, spreadsheet/note/wall, and review
  states need a visible active tab or transition beat.
- Do not hide workflow latency. If work streams or waits, capture the wait honestly.

## Gemini Review Rules

Use `gemini-3.5-flash` by default:

```bash
npm run media:gemini-judge -- --only startup-diligence --include-ignored
npm run ui:gemini-review -- --media=docs/walkthroughs/startup-diligence-war-room.mp4
```

Interpretation:

- `publish`: acceptable as README/demo evidence.
- `fix-then-publish`: fix P0/P1 before making it primary evidence.
- `rework`: rebuild the walkthrough or the product surface before using it.

The media judge is evidence for demo quality only. It does not replace Convex
typecheck, browser E2E, provider ladder, privacy, load, or cost gates.

## Iteration Loop

1. Run `npm run walkthroughs:review -- <feature> --ui-review`.
2. Read `docs/eval/gemini-media-judges/<run>/summary.md`.
3. Fix every P0/P1. Fix cheap P2s that improve legibility or mode clarity.
4. Re-run the same command with a new run id.
5. Update README only after the review artifact exists.

## Files To Edit

- Walkthrough tape: `scripts/walkthroughs/specs.ts`
- Browser capturer: `scripts/walkthroughs/capture.ts`
- Renderer: `scripts/walkthroughs/render.ts`
- Full wrapper: `scripts/walkthroughs/review.ts`
- Gemini media judge: `scripts/gemini-demo-media-judge.ts`
- Gemini production UI rubric: `scripts/gemini-ui-review.ts`
- README proof section: `README.md`

## Commit Checklist

Before committing:

```bash
npm run typecheck -- --pretty false
npx tsc --noEmit --project convex\tsconfig.json --pretty false
npm test -- --run tests/contentFluency.test.ts tests/improvementArtifacts.test.ts
npm run build
```

Track GIFs and docs. MP4s are intentionally ignored as regenerable local evidence.
