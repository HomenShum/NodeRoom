# Anti-cheat doctrine

> Generalized + redacted from the originating product's BankerToolBench anti-cheat doctrine.
> "The number went up" must mean "the agent got better," not "I overfit."

The doctrine is the product. A benchmark you can only pass by hardcoding is the wrong benchmark —
or it is being used dishonestly.

## The four non-negotiables (implemented today)

1. **HELD-OUT.** Carve a held-out + off-distribution split *before* building. Never tune on it.
2. **NO ANSWER-KEYS.** No per-task detectors, no `is_<task> → write_<task>_package` dispatch, no
   hardcoded outputs. Fixes go to the *smallest shared component*, not to a task.
3. **IN-APP TRANSFER.** A harness score counts only when the same task through the real product UI
   reproduces it, browser-verified.
4. **HONEST PROVENANCE.** Every number traces to a recorded run. Unverified numbers are flagged,
   not reported.

## Enforcement primitives

- **Materializer toggle.** Per-task writers, if present, run only in a diagnostic mode and are
  never the reported number. The headline is always **generic-only** (writers OFF).
- **Deterministic grader.** No LLM on the scored path. Any LLM judge is triage-only.
- **Promotion gate.** Keep a fix only if held-out **and** off-distribution hold or rise. If
  held-out rises but off-distribution drops, you found an answer-key — revert.
- **Proof receipt.** Status is computed from gates (`proof-receipt-contract.md`), not asserted.

## The harder substrate (spec only — NOT yet implemented)

A stronger anti-cheat layer is specified but not built. NodeRL ships it as a **spec**, clearly
labeled, so adopters know the boundary:

- derive gate from independent evidence (not payload labels)
- provenance by bytes/AST, not by trust
- signed transport ledger, sealed split
- content-gated memory + taint-from-recall
- adversarial verifier + replay detection

Shipping these as "done" would itself violate HONEST PROVENANCE. They are the roadmap, not a claim.
