# Passive Classifier Production Pattern

## Decision

Use deterministic orchestration plus typed model-assisted extraction. Do not let the LLM agent manage the entire passive intelligence pipeline end to end.

## Problem

Loose reason arrays become brittle when they are used for UX, tests, routing, and audit at the same time.

A better contract separates:

- stable routing signals
- extracted entities
- evidence spans
- confidence
- display explanations
- classifier/model versions

## Pipeline

```text
Raw input
  -> normalize / strip HTML
  -> deterministic signal detector
  -> typed LLM extraction if useful or ambiguous
  -> schema validation
  -> deterministic routing
  -> sidecar proposal/read model
  -> human-approved mutation
```

## Stable Result Shape

```text
status:
  noteworthy | not_noteworthy | needs_model_review

signals:
  stable enum values

entities:
  typed extracted objects

evidenceSpans:
  source text supporting each signal/entity

confidence:
  per signal/entity

classifierVersion:
  deterministic version

modelVersion / promptVersion:
  present only when model participates
```

## Recommended Signals

- `finance_signal`
- `open_question_or_task`
- `person_or_interaction`
- `organization_candidate`
- `company_verified`
- `source_gap`
- `diligence_risk`
- `follow_up_needed`

Use broad candidates first; resolve specifics later.

## Test Strategy

Contract tests assert the durable behavior:

- HTML stripped
- status is noteworthy
- required signal exists
- evidence span is clean

Taxonomy tests assert deterministic rule behavior.

Golden semantic evals allow valid extras and assert minimum expected signals/entities.

## LLM Role

Use LLMs for semantic extraction and proposal generation. Do not use them for permissions, scheduling, idempotency, privacy routing, retries, or source-of-truth writes.

## Principle

Agents produce structured proposals. Deterministic systems authorize, route, persist, audit, and require approval.
