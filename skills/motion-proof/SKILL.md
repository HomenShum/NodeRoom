---
name: motion-proof
description: Verify that shipped motion does what its spec claims — rubric-driven video judgment plus the knockout test — instead of accepting "the animation works" as a vibe. Use after any motion change (motion-ladder rung 2+), before claiming an interaction "feels right", when a demo recording exists or should, or when reduced-motion compliance needs proof. Extends the feature-walkthrough-gif pipeline and the Gemini video judge with a rubric derived from the declared tokens, and refuses to pass motion that was never observed running.
---

# motion-proof

A motion claim without a runtime observation is a screenshot of a dance. CSS can be grepped and
still never fire; a timeline can compile and be dead; reduced-motion can "exist" in a media query
that no browser was ever asked to evaluate. This skill is the gate that makes motion claims cost
something.

Sibling of motion-ladder: **the ladder decides what motion may exist; this proves the motion that
exists does what was declared.**

## Instrument hierarchy — deterministic FIRST, video judge SECOND

Corrected 2026-07-28 by council (NK-Mom's-Biz). The first draft of this skill made the video judge
the primary instrument. That was wrong: **it is the correct perceptual secondary judge, and not the
strongest primary instrument.** A video is a re-observation of something the browser already knows
precisely.

**Primary — deterministic, and they decide pass/fail:**

    Element.getAnimations()            what is actually animating, right now, with real timings
    Web Animations API timing          declared vs effective duration/easing/delay
    animationstart/end, transitionrun/end   did it fire at all
    PerformanceObserver + long-task observer, rAF sampling   frame cost
    DOM mutation timeline · focus event timeline
    GSAP adapter callbacks · Three.js renderer statistics
    Playwright trace · final DOM/state hashes

`Element.getAnimations()` is the instrument that answers "did the animation actually run" without
a single frame of video, and it is the one this skill should reach for first.

**Secondary — the judge answers only what deterministic tools answer badly:**
does the sequence communicate causality · does the transition feel discontinuous · does motion
compete with the primary task · is the authored motion coherent across the page · does a slide
build reveal the argument in the intended order.

**The judge must never override** a trust-surface violation, a missing reduced-motion state, a
performance failure, a wrong choreography order, an absent animation, or a failed knockout. Those
are deterministic verdicts and a compliment does not outrank them.

**Never emit one blended "motion score."** A receipt reports the layers separately:

    Deterministic proof:  PASS
    Video semantic judge: 3/4
    Human review:         pending

A single number hides which layer failed, which is the same defect as a coverage percentage that
cannot say what was never run.

## Run it — `motion-probe.mjs` is the primary instrument

Added 2026-07-28. Until then this section did not exist and `Element.getAnimations()` had **zero
executable callers** — three hits in the whole tree, all of them prose in markdown — while six
working Gemini video-judge scripts shipped. The instrument this skill calls secondary was the only
one that ran. A skill documenting rigour it does not perform is a vacuous pass about vacuous passes.

```bash
node ~/.claude/skills/motion-proof/motion-probe.mjs                    # run the deception corpus
node ~/.claude/skills/motion-proof/motion-probe.mjs <url> --subject "<css>" --nudge
```

- `--subject` declares what is under test. Animations are bound to it, because a page-wide count is
  exactly what the off-screen-decoy fixture defeats. Real products do not carry `[data-subject]`.
- `--nudge` scrolls once before sampling, for deferred-boot apps that serve an SSR shell until first
  interaction — probing that shell and reporting "no motion" is a true statement about the wrong page.
- `--knockout` is **opt-in**: `?knockout=scrub` is a convention the subject must implement. Firing it
  at a product that never heard of it navigates nowhere and reports a timeout as a motion finding.
- An unrecognised flag **throws**. A runner that silently skips a typo'd instruction produces a clean
  report of something it never did.
- Playwright resolves from the consuming repository, never from `~/.claude`, and a missing browser
  **fails closed**. Not-run is never a pass.

Hidden and off-subject animations are counted and reported **separately**, never folded into the
total — `getComputedStyle` reports `animationName` inside `display:none` subtrees.

The corpus is self-testing: the control must PASS and every deception must be CAUGHT. Running it the
first time found two false positives in the probe itself — it rejected the honest control because
enter animations start at `opacity: 0` (so opacity is not a paint test), and because it compared
`transform: none` against the identity matrix as if they were different final states. A corpus with
no honest control only proves an instrument can say no.

## The rubric rule (what makes the judge honest)

The video judge is only as good as its question. "Does this look good?" returns a compliment. The
rubric is **derived mechanically from the motion spec**, so every question is checkable:

    declared: modal-enter 240ms ease-out-expo, opacity + 8px translate
    rubric:   1. Does the modal enter in a single motion ≤300ms?
              2. Does it move up (not down, not scale)?
              3. Is there any content flash before the motion starts?

    declared: list stagger 35ms/item bottom-up
    rubric:   4. Do list items appear in sequence, not simultaneously?
              5. Is the order bottom-up?

If a question cannot be derived from a declared token or choreography line, it does not go to the
judge — it goes back to the spec as a gap.

## Floor

1. Capture the flow with the feature-walkthrough-gif pipeline (its 13 capture lessons apply
   unchanged — timing, viewport, settle-waits).
2. Derive the rubric from the motion spec / declared tokens.
3. Run the video judge with the rubric. Every answer cites a timestamp.
4. **Reduced-motion pass:** re-capture with `prefers-reduced-motion` emulated in the real browser.
   Verify it collapses to the FINAL state — per motion-ladder, a reduced-motion path that shows a
   different design is a failure, not a variant.
5. Verdict per rubric line: pass / fail / not-observed. **not-observed is never pass.**

## Ceiling — the knockout test (causality, not correlation)

Borrowed from NodeSlide's knockout gate: remove the thing, re-render, and require the difference
to be the *claimed* difference.

**The obvious implementation is a gaming route — do not use it.** The first draft of this skill
specified GSAP `timeScale(0)` + jump-to-end. Council (Slide-AI, the thread that designs adversarial
gates) named that as a known deception: **a knockout that jumps to the end falsely passes**, because
the final state is exactly what the un-knocked-out run also produces. The knockout must remove the
*mechanism*, not fast-forward it — prevent the timeline from being constructed at all (stub the
adapter, refuse the import, unmount the driver), then observe.

- Re-run the capture with the timeline **never constructed** — adapter stubbed at the seam, not
  scrubbed to its end state.
- Diff the two recordings. The delta must be exactly the declared motion — if the page looks the
  same, the motion never ran (dead code passing review); if MORE differs than declared, something
  undeclared is animating (an unnamed owner, which motion-ladder forbids).
- Perceptual thresholds on canary pixels for the imperceptible-change and no-op routes — the two
  gaming routes the OOXML gates deliberately left to a runtime instrument. The web is where that
  instrument is cheap.

## The Motion Deception Corpus (fixtures this skill must beat)

Named by council 2026-07-28. Every gate needs the list of things built to beat it, or it is a gate
nobody attacked. Each of these passes a naive motion check. **All seven are now runnable pages in
`fixtures/`, plus an honest control** — until 2026-07-28 this was a list of seven strings and zero
files, which is a specification of an adversarial suite nobody built:

    00-honest-control.html                    the control — motion that is real, on the declared subject
    01-exists-but-never-mounts.html           perfect CSS, element never inserted
    02-offscreen-decoy.html                   getAnimations() returns 1; it belongs to nothing visible
    03-clock-only-diff.html                   pixel-diff passes on a ticking clock; nothing animated
    04-trust-surface-toward-approval.html     undecided proposal animates into the language of acceptance
    05-reduced-motion-different-design.html   query honoured, but a second design is rendered
    06-knockout-jumps-to-end.html             timeline scrubbed to end instead of never constructed
    07-video-shows-absent-motion.html         the GIF shows a shimmer; the page has no animations at all

Note the fourth and the sixth. The fourth is the trust-surfaces violation in its most dangerous
form — motion that moves *toward* apparent approval. The sixth was a defect in this skill's own
first draft, which is the argument for keeping the corpus: the gate's author is not exempt from it.

**These are instances of the vacuous pass** — a green result from an instrument that measured
nothing. The general tell, which catches routes not yet in the corpus:

> Ask of any green result: **what would this have reported if the subject did not exist?**
> If the answer is "the same thing," the check is vacuous and its green is worth nothing.

Two more from the same class, outside motion, worth guarding against in any runner this skill
drives: `getComputedStyle` reports `animationName` for elements inside `display:none` subtrees, so
filter for **painted** visibility and report hidden counts separately rather than folding them in;
and an **unrecognised instruction must fail, never no-op** — a capture runner that silently skips a
typo'd action produces a recording of a frozen viewport that looks exactly like a successful one.

## `profiles/genjutsu.yaml` — the adversarial profile

Genjutsu is an illusion technique, and that is exactly the failure this profile hunts: **motion
that produces a persuasive visual impression of progress, causality, or completion without the
underlying state actually changing.** Named by council 2026-07-28, which ruled it should be a
profile here rather than a sixth overlapping system — the vocabulary without the architecture.

Checks in the profile:

- **timeline knockout** — disable it, re-render, diff must equal the claimed difference
- **frozen-frame comparison** — first and last frames against the declared start/final states
- **reversed choreography** — if reversing the order changes nothing a user can name, the order
  was never carrying information
- **reduced-motion equivalence** — same final state, not a second design
- **removal of decorative layers** — does comprehension survive without them
- **task completion with and without motion** — the strongest signal available
- **apparent progress with no state transition** — a spinner, sweep, or fill that animates while
  nothing behind it advanced. This is the trust-surfaces class in motion form: a failure that
  animates like a loading state is lying about which state the system is in.

## Forbidden-surface sweep

One structural check per run, independent of the rubric: **no motion on trust-decision surfaces**
(`proposal`, `conflict`, `failed_safe`, any diff/review surface). A transition found there is a
correctness finding at any duration, per motion-ladder — it can make a not-yet-accepted change
feel accepted.

## What this refuses

- Passing motion nobody watched run ("the CSS is correct" is a spec claim, not a proof).
- A rubric written from taste instead of the spec.
- Reduced-motion verified by grep.
- A single recording standing in for both motion and reduced-motion paths.

## Composes with

- **motion-ladder** — proves the rung's claims; PROOF.md for rung 6 cites these runs.
- **easier-to-read-submissions** — the demo recording it already requires becomes the capture.
- **agentic-ui-qa** — persona runs double as capture sessions.
- **before-after-proof** — the before-capture is the baseline the knockout diffs against.
