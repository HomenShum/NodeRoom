# Handoff — 2026-07-28 · walkthroughs, CDP repair, motion-proof

Written for the next engineer. Everything below was measured, not assumed; where something
is unverified it says so. Three repos are involved, so read the **Landmines** section before
touching anything.

---

## What shipped

| Repo | PR | State |
| --- | --- | --- |
| FeatureClipStudio | [#6](https://github.com/HomenShum/FeatureClipStudio/pull/6) | **merged** 2026-07-29 |
| NodeSlide | [#110](https://github.com/HomenShum/NodeSlide/pull/110) | mergeable, waiting on one CI check |
| NodeRoom | [#244](https://github.com/HomenShum/NodeRoom/pull/244) | rebased onto main, CI re-running |

### Three product defects, all found by filming the product rather than reading it

1. **Every `FocusTrapDialog` modal rendered behind its own blur scrim.** Radix portals
   overlay and content as *siblings*; the legacy scrims (`.r-modal-backdrop`,
   `.r-room-modal-scrim`) were written to centre a *child*, and `FocusTrapDialog` passes
   `unstyled`, which drops the Tailwind fixed/translate classes. Result: dialogs rendered
   `position: static` at the end of `<body>`, under a z-95 blur — including the create-room
   dialog carrying the product's one governance question. Fixed in `src/app/styles.css` by
   positioning `[data-slot="dialog-content"]` itself, plus a real `.sr-only` (Tailwind's is
   absent from this bundle, so the fallback `DialogTitle` printed the word "Dialog" on every
   modal).
   **DOM text extraction read these dialogs correctly the whole time.** Only frame review
   caught it.

2. **CDP scripts were killing the developer's real browser.** `browser.close()` on a
   `connectOverCDP` connection closes *Chrome*, not the socket — so every script killed the
   browser the next one needed. Swept the class: 9 pure-CDP scripts drop the call;
   `scripts/motion-inventory.mjs` connects *or* falls back to `launch()`, so it tracks
   `weLaunchedIt` and closes only what it owns. Separately `scripts/chrome-cdp-up.ps1` used
   `Stop-Process -Force`, which is what produced *"Chrome didn't shut down correctly"* and lost
   tabs; it now closes gracefully with `CloseMainWindow()`.

3. **The upload verifier asserted videos that no longer exist.** `yt-verify.mjs` hardcoded two
   ids that are now Private, and matched titles on a phrase the superseded clip *and its
   replacement* both carry — so it could pass against the wrong video. Root cause was two
   copies of the roster free to disagree. Now one `scripts/yt-roster.mjs` that both the
   verifier and the privatize guard import, and the verifier checks **both directions**:
   6 published must resolve, 4 superseded must be refused.

### `skills/motion-proof` — vendored into this repo on purpose

It previously lived only in `~/.claude`, which is **not version controlled**, so it could not
be handed to anyone. It now sits beside `skills/liveflow`, `skills/probe-first`, etc.

```bash
node skills/motion-proof/motion-probe.mjs                    # the deception corpus
node skills/motion-proof/motion-probe.mjs <url> --subject "<css>" --nudge
```

An audit found this skill **inverted in practice**: its `SKILL.md` correctly names
`Element.getAnimations()` primary and the video judge advisory, but `getAnimations()` had
**zero executable callers** while six Gemini video-judge scripts shipped. `motion-probe.mjs`
is the missing primary instrument. It ships with 7 adversarial fixtures + an honest control;
the control must pass and every deception must be caught, and running it the first time
found two false positives in the probe itself.

---

## Landmines

- **`~/.claude` is not a git repo.** `skills/motion-proof` is now vendored here, but the
  *other* skills there (`design-dna`, `graph-hop`, `second-brain`, `trust-surfaces`,
  `motion-ladder`) exist on one machine with no history and no backup. If they matter,
  they need a home.
- **PR #244 was stacked on `codex/nodekit-contract-alignment`.** That branch's own PR (#241)
  fails `NodeSlide packed consumer`, `node-platform / conformance`, and `verify` — the same
  three failures #244 inherited. It has been rebased onto `main` and those failures left with
  it. **Do not re-branch from `codex/*` without checking its PR is green first.**
- **Two conflicting PRs remain open in NodeRoom** — #190 (`codex/mobile-terracotta-launch`)
  and #182 (`codex/proofloop-strict-live-official`), both `CONFLICTING`. Not touched; not mine.
- **`.qa/memory/findings.jsonl` had an unresolved stash conflict** (`UU`). Both sides were
  distinct valid records in an append-only log, so the resolution kept the **union** — 29
  records, all parsing. If you expected one side to win, check that.
- **Never render video live in a demo.** Image generation returns in seconds; video takes
  minutes and fails often.
- **Deferred boot.** `boot.ts` defers the app module until first interaction, so an
  unhydrated SSR shell is a *different page* from the React landing — different markup, and
  the join-code control is inline rather than a dialog. Any probe or capture must nudge and
  wait for a React-only element, never a timer. This is why `motion-probe` has `--nudge`.

---

## The pattern worth inheriting

The same defect appeared five times today in unrelated places: **a hand-typed value describing
a version of the artifact that no longer exists.**

- a YouTube title reading "11s walkthrough" over a 24-second video
- `METADATA.md` recording pre-recut durations
- showcase GIFs rendered from superseded captures
- the verifier's hardcoded video ids
- the roster existing twice, free to drift

Every fix was the same shape: **derive the value at write time, or keep exactly one copy.**
`yt-upload.mjs` now derives durations via `ffprobe`; `yt-roster.mjs` is the single roster.

A second, sharper version of it: **a decision recorded only in a conversation will be
re-decided by the code.** A council verdict to delete NodeSlide's Design tab as a standalone
destination is not done, is recorded nowhere in that repo, and the most recent inspector
commit reinforced the tab strip instead. Verdicts that survive must land in the repo they
govern — as a test, an invariant, or at minimum a dated note.

---

## Verification habits used here (and why)

- **Verify the claim the artifact makes, not that the artifact exists.** Frame counts, byte
  sizes and HTTP 200s all passed while the clips showed another product's URL.
- **Probe gates in both directions.** A gate only ever seen passing is not known to work. The
  privatize guard was tested by feeding it a keeper and confirming it refused, *before* it was
  aimed at real targets.
- **Verify from the public surface.** `git push` exiting 0 is not evidence; fetch the raw URL
  and grep for a content signal.
- **State coverage, don't imply it.** Artifacts carry `touched/total`, and `JOURNEYS.md`
  records 10 of 13 journeys shot with the remaining three named, one of them explicitly
  declined by the owner rather than missed.

---

## Open, not done

- NodeSlide #110 and NodeRoom #244 need a human to confirm the merge once CI is green.
  NodeSlide's repo does not allow auto-merge, and `--admin` would bypass a branch-protection
  rule that was set deliberately — so it was not used.
- ~~`ScoreReceipt` … confirm it landed~~ **DONE — see below.**
- The 7 deception fixtures are runnable but are not yet wired into CI. They should be — that
  is what turns the corpus from a demonstration into a gate.

---

## The reference corpus chain — completed, in `node-platform` (a DIFFERENT repo)

`ReferenceObservation → DesignRule → ScoreReceipt` was two-thirds real: two record types
existed with an executable gate, but **no `ScoreReceipt` was ever emitted**, and the records
declared `schemaVersion` strings with **no schema file to validate them**. Both are now closed.

Verified by running it, with real exit codes rather than piped output:

    PASS  direction (real corpus)          exit 0   3 records · 14 facts · 24 citations
    FAIL  direction (malformed fixtures)   exit 1   6 named defects, each asserted by a test
    EMPTY corpus                           exit 3   not-run is never a pass
    test/reference-corpus-gate.test.mjs    8/8

Three things in it worth inheriting:

1. **The subject I proposed was rejected, correctly.** I suggested scoring the NodeRoom
   create-room dialog. `rule-absence-is-not-zero` does not govern it — it renders no figure,
   has no unbound data source, and zero is not a value it could display; the rule's own
   `doesNotApplyWhen` excludes it outright. The rejection is recorded **on the receipt** under
   `ruleApplicability.rejectedSubjects` so nobody re-litigates it. Citing a rule at a subject
   it does not govern is the exact failure the corpus exists to prevent.
2. **`withinRuleDerivation`.** Three of the receipt's six criteria cite facts the rule does not
   stand on. That is allowed, but it is now marked, **recomputed by the gate**, and it is
   precisely what the human override disputes. A criterion quietly borrowing authority from
   outside the rule's derivation used to be invisible.
3. **The gate was wired into nothing.** No npm script and no CI job referenced
   `reference-corpus-gate.mjs` — it ran only when someone typed it. It is now reached by
   `npm test`. Schemas were proven non-vacuous against **33 dishonest mutations, 33 refused**.

### Landmine in that repo

The whole chain was swept into commit **`f60cffa0`**, whose message reads
*"fix(package): the CRLF shebang npm rewrites…"* — unrelated to any of it — on branch
`feat/close-the-loop`, already pushed. The work is not lost, but `git log` will not lead
anyone to it. That branch is **42 commits ahead of `main`** and is not mine, so the mislabelled
commit was left alone rather than rewriting pushed history on someone else's branch. If you
own that branch, consider splitting the commit before it merges.
