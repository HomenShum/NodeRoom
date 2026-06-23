# Honest Lane (authoritative)

The honest lane is the eval lane where scores are trustworthy — not inflated
by leakage, memorization, or scoring shortcuts. This document is the
authoritative source for the rules that keep the lane honest.

## Invariants

1. **Held-out quarantine.** The held-out slice membership (task ids, prompts,
   ground-truth answers) MUST stay out of the agent's context across
   iterations. The moment the agent sees the held-out ids in its prompts,
   tools, memory, or training data, the score becomes an *answer key*, not a
   capability measurement.

2. **`cleanGeneralProbe` honesty gate.** `cleanGeneralProbe` may only stay
   `true` if `memory.markTuned` was called on the previous slice *before* a
   new slice was introduced. Skipping `markTuned` = the agent is implicitly
   carrying tuning signal forward, and the probe is no longer clean.

3. **Rotation cadence.** Rotate the held-out slice:
   - at least **quarterly**, OR
   - whenever held-out scores stop improving for **2 consecutive iterations**
     (a memorization signal — the agent has overfit the slice).

4. **No retroactive slice edits.** Once a slice is sealed, do not edit task
   ids or ground-truth answers. If a task is broken, retire it and add a
   replacement in the next rotation.

5. **Transfer probe.** Every slice rotation must include a small
   in-app-transfer probe (held-out tasks rephrased in the live app surface)
   to catch the case where the agent learned the eval harness rather than
   the capability.

## See also

- `templates/run/README.md` — the slice-rotation policy block links here.
- `.claude/skills/solo-founder-nodes/references/benchmarks.md` — the
  benchmark suite that this lane scores against.
