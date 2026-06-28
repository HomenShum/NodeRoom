# Solo Founder Nodes — state scorecard & next-increment checklist

> The R/reality + iterate-phase **anchor** the `solo-founder-agent-builder` framework asks for
> (`docs/eval/solo-founder-nodes-scorecard.md`). Generated 2026-06-27 from a 5-agent parallel audit of
> this repo against the 7-node loop (discover → benchmark → setup → build → adapter → iterate → verify),
> the RALPH anchors, and the anti-shallow QA gate. Honest by construction: `done` = built **and** has
> evidence in-repo; `partial` = engine exists, surface/coverage incomplete; `missing` = not present.

## Headline

NodeRoom is the **dogfooded origin** the framework was distilled from — every "Reuse" asset the playbooks
cite resolves to a real path. The loop is authored and the verification gates are real and runnable. The
two real debts are **(1)** a known answer-key contamination in the BTB harness (flagged by the repo's own
diagnostic, not yet reverted) and **(2)** the wedge's headline "Today's Brief" surface exists only as an
engine, not a first-class view.

This increment shipped the **demo lane**: a full end-to-end "live analyst room" episode with **TTS + a music
bed**, verified two ways (deterministic ffmpeg + Gemini VLM), plus a one-command episode build.

## Checklist — where everything is

### Framework compliance (7-node loop + RALPH + anti-shallow QA)
- [x] **done** — 7-node loop authored: `.claude/skills/solo-founder-nodes/` (MASTER_SKILL + nodes/1-7 + references). Order matches the brief.
- [x] **done** — Adapter honest-baseline switch (general-only / materializers-OFF): `btb_noderoom_agent/harbor_adapter.py:34,57-64` (`materializer_mode` enum + provenance).
- [x] **done** — Iterate honesty instrument: deterministic grader `docs/eval/nonbtb/grade.py` + `_selftest_good/_selftest_bad`; mirrored in TS (`src/benchmarks/golden/`, `tests/goldenDataset.test.ts`).
- [x] **done** — Anti-shallow QA gate is real & runnable: `playwright.config.ts` + 30 e2e specs (incl. in-app transfer); design floor `scripts/design-qa/floor.ts` (blank-render hard-fail, exit-code ship bar); eval gate `.claude/skills/eval-gate/` (codegen→tsc→vitest→ladder→credit→diff).
- [ ] **missing — P0** — NO-ANSWER-KEYS non-negotiable **violated** in the BTB adapter: `harbor_adapter.py` still has the `is_*_task → write_*_package` dispatch (incl. `write_comcast_take_private_teaser_package`, `write_greenbrier_cim_package`, `write_coty_trading_comps_package`). The repo's own `docs/eval/BTB_GENERALIZATION_DIAGNOSTIC.md` names `harbor_adapter.py:4717` as "the contamination to revert."
- [ ] **missing** — RALPH machine-readable anchors: no `docs/system-map.graph.json`, no `.solo/anchors/`, no `capability-spec.md` / `benchmark-choice.md` / `SETUP.md`. (Intent lives in prose: `docs/ARCHITECTURE.md`, `docs/WEDGE.md`.) This file is the first scorecard anchor.
- [~] **partial** — Phase-6 honest headline (held-out-OFF / non-BTB-OFF) recorded only as a single-model point (`meanReward 0.2519`, n=1, gpt-4.1-mini); the held-out/non-BTB OFF cells in the diagnostic are still `?`.

### Agent layer + benchmarks
- [x] **done** — Tool registry (ROOM_TOOLS + managed-lock + server superset); CAS-guarded cell mutators + no-clobber `reconcile_cell` + `define_columns`/`set_artifact_meta`; SSRF guard + bounded capture + honest-status pipeline; anti-cheat gates (clean-capability, contamination scan, docker isolation probe); Convex eval+memory ledger with held-out quarantine; real SpreadsheetBench + BankerToolBench scorers/adapters/runners.
- [ ] **missing** — OFFICIAL benchmarks end-to-end: 0/3 (honestly self-reported in `docs/eval/OFFICIAL_BENCHMARK_READINESS.md`). BTB: 5 MCP tool servers not adapted; SpreadsheetBench: 912-task corpus not vendored.
- [~] **partial** — pptx/docx/pdf deliverable **generation** wired into the runner (shape validated; generation not routed; the `powerpoint` honest-deck skill exists but isn't in the BTB lane).

### Wedge UX — Capture → Research → Brief → Evidence → Handoff
- [x] **done** — **Capture**: composer upload/drop/@-mention + RoomHome command bar → `askAgent` (`src/ui/Chat.tsx`, `RoomHome.tsx`).
- [~] **partial** — unified "drop messy signals" intake (email/CRM/links) — spread across composer + command bar, no dedicated drop zone / connectors.
- [x] **done** — **Research**: real bounded agent loop populating a named-column grid (`store.askAgent`→`runtime.ts`, GenericSheet).
- [~] **partial** — Research generalizes beyond the 2 seeded sheets (unrecognized goal dead-ends at "staged next", `store.tsx:946`).
- [x] **done** — **Evidence** (strongest stage): Trace tab + unified AttentionOverlay/citation box + click-through to source cell (`TraceSurface.tsx`, inline + replay).
- [x] **done** — **Brief** *engine*: `buildBankerCoachPacket` (evidence/cues/runway/review/handoff/readiness) + ranked NoteworthyInbox.
- [x] **done** — **Brief** *surface*: first-class "Today's Brief" pinned work-surface tab — ranked actions (risk→watch→info), readiness rollup, evidence click-through (`src/ui/panels/BriefSurface.tsx`, wired into `Artifact.tsx`). Verified live in memory mode (`specs.ts#brief`).
- [x] **done** — **Handoff**: sheet → XLSX export (`Artifact.tsx:203`).
- [x] **done** — **Handoff** draft-body generation wired to UI: the Brief surface calls `buildDownstreamHandoffDraft(target, …)` on click and renders the copy-able draft (resolves the dead-code gap). _(The Coach panel's Handoff tab remains a dry-run preview — lower priority.)_

### Demo / walkthrough pipeline
- [x] **done** — TTS: `voiceover.ts` (ElevenLabs **or** OpenAI fallback) + ffprobe timing reconcile.
- [x] **done** — **Music bed** (this increment): `assets/audio/episode-bed.mp3` (original ffmpeg pad, level-normalized) staged by `episode.ts`, mixed under narration in `remotion/Episode.tsx` (`MUSIC_VOL`, eased in/out).
- [x] **done** — Episode assembler + Remotion compositions + Gemini video judge (now robust to fenced JSON).
- [x] **done** — **Full end-to-end "live analyst room" episode** (this increment): `episodes/noderoom-analyst-room-v1/` walks Capture→Research→Brief→Evidence→Handoff. Verified: ffmpeg music 6/6 audible + voice on top; Gemini judge **15/16, "publish"** (audio 2/2).
- [x] **done** — Episode-lane npm scripts (this increment): `episode`, `episode:voiceover|assemble|render|judge`.

## What's needed next (prioritized)

1. **P0 — revert the answer-key contamination** in `harbor_adapter.py` (disable the `is_*_task → write_*_package` dispatch) so general-only mode emits only general-agent output. Do not present BTB numbers as honest capability until then.
2. ~~Wedge surface — ship a first-class "Today's Brief"~~ — **DONE** (`src/ui/panels/BriefSurface.tsx`, pinned tab, verified live; the demo's Brief scene is now live footage, not a claim card).
3. ~~Wedge handoff — wire `buildDownstreamHandoffDraft`~~ — **DONE** (the Brief surface generates copy-able drafts on click).
4. **Phase-6 honest number** — run held-out + non-BTB with materializers OFF; fill the `?` cells in `BTB_GENERALIZATION_DIAGNOSTIC.md` and emit the per-slice scorecard.
5. **Backfill cheap RALPH anchors** — `capability-spec.md` / `benchmark-choice.md` / `SETUP.md` from existing prose; decide if `docs/system-map.graph.json` is in scope.
6. **Demo follow-up** — once (2)+(3) land, author `episodes/noderoom-action-brief-v1` with *live* Brief/Handoff footage; meanwhile a P2 on the current episode: add a zoom/crop to the `capture` scene for mobile legibility (`remotion/Episode.tsx` `videoScale`).
