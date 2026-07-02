# Anti-reward-hacking doctrine: naming the two-loop architecture that already exists

> This document does not introduce a new promotion mechanism. Most of what a from-scratch design
> would propose (immutable-file checks, verifier-weakening detection, an accept/reject/needs-review
> verdict, a "someone outside the loop must approve" gate) **is already built and working** in
> `src/eval/scaffoldProposal.ts` and `scripts/proofloop-cli.ts`'s `regressions.json` promotion flow.
> This doc names the pattern those pieces already implement, connects them into one picture, and
> adds only the narrow fields that are genuinely missing: provenance/source typing and one real
> structural gap in how promoted state is protected. Read `anti-cheat-doctrine.md` and
> `reward-design.md` first; this doc assumes both.

## Why this exists

A self-improving loop is a mathematical optimizer. Given a score, it will find the cheapest path to
raising that score — and the cheapest path is often to change the measuring instrument, not the
thing being measured. This is Goodhart's Law: *when a measure becomes a target, it stops being a
good measure.* The doctrine's job is to make sure the objective we give a repair loop cannot be
satisfied by editing the ruler. A related risk is **model collapse**: a loop that trains its own
future behavior only on its own generated output drifts from ground truth — Proof Loop's memory must
stay anchored to real runs (see "Memory source typing" below).

## The two loops, already implemented, now named

**Certification Loop** — locked, deterministic: *did the agent complete the intended workflow,
proven against the real product UI?* This is `anti-cheat-doctrine.md` + `proof-receipt-contract.md`
(held-out split, no answer-keys, in-app transfer, gate-computed status), plus the **hard-reject**
half of `scaffoldProposal.ts`'s `evaluateScaffoldAcceptance()`:

- `touchesImmutableFile()` against `IMMUTABLE_FILES` (`scripts/proofloop.mjs`,
  `scripts/agent-improvement-loop.ts`, `tests/harnessChangeEval.test.ts`, `.github/workflows/`,
  `src/eval/evalTrustPolicy.ts`, `src/eval/architectureBudget.ts`, `evals/evalStore.ts`)
- `detectVerifierWeakening()` — regex patterns for `lower minScore`, `remove required check`,
  `skip evidence`, `hide failing`, `disable gate`, `bypass assertion`
- explicit reject patterns in `rejectScaffoldProposal()` — "edits the verifier", "edits CI gate",
  "makes the benchmark easier"

None of this is proposed here; it is real, already enforced, already covered by
`npm run scaffold:check -- --strict-immutability`.

**Exploration Loop** — open-ended, generative: *what new failure modes, edge cases, or scaffold
fixes should we try next?* This is `generateScaffoldProposals()` producing `ScaffoldProposal`
objects, and the `proofloop/scenarios/*.yaml` / `proofloop/rubrics/*.yaml` / `.proofloop/memory.jsonl`
surface `CLAUDE.md`'s "Self-Scaffolding Proof-Looping" section already scopes as editable.

**The rule that makes the split real is already coded, just not named:**
`evaluateScaffoldAcceptance()` will not return `"accepted"` unless `ctx.adversarialReviewerApproved`
is `true` — and that field is set by something *outside* the function, not asserted by the proposal
itself. That external-approval requirement **is** the "propose, don't self-promote" rule. This
doctrine's contribution is naming it, not building it:

```
Certification Loop (locked)              Exploration Loop (open-ended)
--------------------------              -----------------------------
evaluateScaffoldAcceptance()             generateScaffoldProposals()
  hard-rejects on immutable-file touch     produces ScaffoldProposal objects
  hard-rejects on verifier-weakening       these are proposals, not receipts
  requires an improvement signal
  requires adversarialReviewerApproved
    (set externally -- this IS the
    "propose, don't self-promote" rule)
→ verdict: accepted | rejected |
  needs_adversarial_review
```

The equivalent flow for a failed *proof run* (not a scaffold change) is `proofloop-cli.ts`'s
`cmdPromote()`, which appends `{ suite, runId, failedGates, promotedAt }` to `.proofloop/regressions.json`
when a human runs `proofloop promote`. Same pattern, different surface: a human, not the loop, decides
what becomes a tracked regression.

## What's genuinely missing (the real gap, narrowed)

Three things, not a whole new mechanism:

### 1. Source/provenance typing

Neither `ScaffoldProposal` nor the `regressions.json` entry shape nor
`src/nodemem/failureMemory.ts`'s `TaskFailure`/`NodeMemFailurePattern` records *where a
proposal/failure/regression originated* — a real user run, an official benchmark, a red-team
proposal, or a model-generated synthetic case. Without this, a scaffold-delta suggestion generated
from a synthetic edge case is indistinguishable from one grounded in a real live-user failure, which
is exactly the model-collapse risk (training the loop's future behavior on its own invented cases as
if they were equally trustworthy as real ones).

Additive, optional fields (nothing here breaks the existing shapes):

```ts
type ProofLoopSource =
  | "real_user_run"
  | "live_browser_proof"
  | "official_benchmark"
  | "human_feedback"
  | "redteam_proposal"
  | "synthetic_edge_case"
  | "model_generated_proposal";

// ScaffoldProposal (src/eval/scaffoldProposal.ts) — add:
source?: ProofLoopSource;

// regressions.json entry (scripts/proofloop-cli.ts cmdPromote) — add:
promotedBy?: "human" | "locked_verifier";
source?: ProofLoopSource;

// TaskFailure / NodeMemFailurePattern (src/nodemem/failureMemory.ts) — add:
source?: ProofLoopSource;
```

When weighing scaffold-delta suggestions, prefer `real_user_run`, `official_benchmark`,
`live_browser_proof`, `human_feedback`; downweight `synthetic_edge_case` and
`model_generated_proposal` — useful for coverage, not a substitute for ground truth.

### 2. Reward provenance

`reward-design.md`'s `NodeRewardSummary` reports signals (`taskSuccess`, `evidenceGrounding`, etc.)
as bare numbers with no record of *how* each was computed. Add a sibling object so a reward can be
audited back to its source, not just trusted at face value:

```ts
interface NodeRewardProvenance {
  deterministic: boolean;   // computed by a non-LLM scorer
  officialScorer: boolean;  // ran the real benchmark verifier, not a stand-in
  visualJudge: boolean;
  humanFeedback: boolean;
  syntheticOnly: boolean;   // true only for Exploration Loop dry-runs; must be false for anything promoted
}
```

### 3. A real structural gap: promoted state is gitignored

`.gitignore` excludes `.proofloop/regressions.json`, `.proofloop/memory.jsonl`,
`.proofloop/memory/`, and `.proofloop/live/` from version control (by design — they're local
runtime state, not source). This means `scaffold-check.ts`'s `IMMUTABLE_FILES` check — which works
by diffing *git-tracked* files against a base branch — **structurally cannot** detect a repair pass
silently deleting or rewriting a promoted regression in `regressions.json`, because git has no
history for an untracked file to diff against. This is not a bug to silently patch; it is a real
limit of a git-diff-based immutability check that any adopter of this doctrine should know about
before assuming "immutable files are protected" covers promoted regressions too. Two honest options,
neither implemented here:

- commit a periodic snapshot/checksum ledger of `regressions.json` so drift is git-diffable, or
- move promoted regressions to a git-tracked location and keep only in-flight/local state gitignored.

## The one-line summary

Proof Loop should be self-improving, but not self-grading. `evaluateScaffoldAcceptance()` already
enforces that — the agent can repair the runner, but not accept its own repair. This doctrine names
that pattern, adds provenance typing so real and synthetic signal don't get mixed silently, and
flags the one place (gitignored promoted state) where the existing protection genuinely doesn't
reach yet.
