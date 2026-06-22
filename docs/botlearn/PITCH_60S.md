# Solo Founder Nodes — 60-second pitch

> Spoken version. ~150 words. ~60 seconds at a calm pace.

---

For one-person companies whose AI agent demos beautifully but collapses on a real benchmark task, **Solo Founder Nodes** is the portable Agent Skill suite that turns your coding agent into a benchmark-driven engineer. The anti-cheat IS the product.

Here's the worked example, live right now on **noderoom.live**. Open `/#frontier`. The Frontier Observations Panel renders an 8-row Convex-backed ledger — testids `frontier-observations-panel` and `frontier-observations-runs`, verdict cells in the `.frontier-observations__table`. Eight documented model-capability ceilings, one URL, no auth. That's the honest loop terminating in public.

Then `/#story`. The seven-layer no-clobber walkthrough, with a live engine-backed grid — not a screenshot, an actual working surface — and ten `story-lab*` testids you can grep for.

The journey is the proof. We shipped a benchmark dispatcher v1 — thirteen of thirteen cells across nb-01, nb-02, nb-03 — and then the audit loop caught that "type `@bench:` in a special route and grade the result" is a paint-by-numbers shortcut. In **PR #36** we deleted the dispatcher: about 1,644 lines, including the `convex/modelProxy` action and the `#bench` route. The honest replacement is `tests/real-room-cheap-e2e.spec.ts` — a real user joins a fresh room, the cheap default model fills the visible sheet, and the test grades the rendered cells against a server-side rubric the model never sees. The live-browser benchmark UI lane lands next.

Four non-negotiables: held-out splits with no answer keys in the harness, **live-DOM verification** instead of trusting a green build, publish the frontier don't hide it, and the anti-cheat baked into a real-user-flow Playwright run.

It ships as `SKILL.md` — one master plus seven phase playbooks — at **github.com/HomenShum/solo-founder-nodes**, MIT. Clone it, point your coding agent at your own app. The skill is the artifact. The webapp is the proof. The fact that the loop ate its own dispatcher is the proof the loop works.
