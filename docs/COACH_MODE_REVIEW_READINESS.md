# Coach Mode / Review Readiness

## Decision

Coach Mode should turn every NodeRoom artifact into a review drill: the system asks the user to explain the work, compares the answer against evidence and rubric, shows what was understood or missed, and links every gap back to exact sources, cells, traces, or coach cues.

## Product Principle

Coach Mode should not only tell the user what the agent did. It should test whether the user can explain and defend it.

In finance, the output is not useful until the human can answer:

- Where did this number come from?
- Why did it change?
- What evidence supports it?
- What is manual, estimated, or needs review?
- What would a VP, MD, or client challenge?
- What should I say live?

## UX Names

Junior-friendly:

- Coach Mode
- Practice Answer
- What went well
- What to improve

Senior-friendly:

- Review Readiness
- Explanation Check
- Source Coverage
- Client-Ready Blockers

## Core Loop

```text
Artifact / evidence / model output
  -> how a banker should explain it
  -> user's explanation / talk track
  -> evidence-grounded feedback
  -> missed sources / weak reasoning / next action
```

## Rubric

Evaluate:

- factual accuracy
- source grounding
- uncertainty handling
- calculation understanding
- cross-artifact consistency
- business judgment
- senior/client talk track
- next action

## Evidence Sources

Feedback must be grounded in:

- OKF concepts
- evidence facts
- source captures
- cell payload evidence
- spreadsheet formulas
- chart dependencies
- agent traces
- proposal history
- review tasks

No feedback claim should be shown unless it can point to a source, cell, trace, evidence fact, or OKF concept.

## Runtime Sequence

Current shipped practice path: the passive inbox can submit practice from a
noteworthy activity row in live mode, and the result is recorded as `coachEval`
on activity/job state. Memory mode is deliberately no-op for practice. A
first-class durable `CoachFeedbackArtifact` remains product/backend work.

```text
User opens Coach Mode
  -> load artifact, evidence, OKF, trace state
  -> generate question and expected answer outline
  -> user writes answer
  -> evaluator checks claims and rubric
  -> store coachEval on the activity/job path
  -> show gaps with source links
```

Target state: Coach feedback becomes an Agent Artifact. The rendered feedback
card is a review surface; the structured payload stores question, expected
outline, user answer, score, missed evidence refs, mastery tags, and follow-up
task refs.

## Cost Control

Do not evaluate while typing.

Use tiers:

```text
deterministic checks first
cheap model for coverage/clarity
stronger model for client-ready reasoning
cache when question + answer + evidence graph are unchanged
```

## P0 Demo

Use CardioNova runway / source gap / needs_review.

Question example:

```text
Your VP asks why runway is marked needs_review. Explain.
```

Expected answer:

- runway depends on cash and monthly burn
- source is manual or partial
- chart is estimate until verified
- next action is to ask management for current cash and burn

## Strategic Value

Coach Mode turns NodeRoom from an AI work generator into an AI workroom + human learning + review-readiness system.
