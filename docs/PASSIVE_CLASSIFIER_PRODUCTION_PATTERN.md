# Passive Classifier Production Pattern

## Decision

Use deterministic orchestration now, with typed model-assisted extraction as the
upgrade path for ambiguous or high-value cases. Do not let the LLM agent manage
the entire passive intelligence pipeline end to end.

## Problem

Loose reason arrays become brittle when they are used for UX, tests, routing, and audit at the same time.

A better contract separates:

- stable routing signals
- extracted entities
- evidence spans
- confidence
- display explanations
- classifier/model versions

## Current Production Shape

Today the durable classifier path is deterministic. It normalizes text, strips
HTML, extracts rule-based `signals`, `entities`, `facets`, and
`evidenceSpans`, assigns `classifierVersion`, and routes by score/action. There
is no current `needs_model_review` status and no model/prompt version unless a
future extractor participates.

## Target Pipeline

```text
Processed notebook blocks / checked sheet edits / source text
  -> normalize text, spans, hash, visibility
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
  noteworthy | not_noteworthy

target status when model extraction lands:
  needs_model_review

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

## Native Notebook Input Rule

For ProseMirror-native notebooks, the classifier consumes processed read-model
rows, not raw ProseMirror steps and not a hot `elements["doc"]` HTML mirror.

```text
actor-authenticated dirty metadata
  -> ACL-gated snapshot processor
  -> notebook blocks / claims / mentions
  -> classifier
  -> Agent Artifact / passive inbox item
```

This preserves actor attribution, privacy lane, and idempotency while avoiding
duplicate work from server snapshot observers.

## Test Strategy

Contract tests assert the durable behavior:

- HTML stripped
- status is noteworthy
- required signal exists
- evidence span is clean

Taxonomy tests assert deterministic rule behavior.

Golden semantic evals allow valid extras and assert minimum expected signals/entities.

## LLM Role

Use LLMs for semantic extraction and proposal generation after the deterministic
classifier has produced a stable envelope. Do not use them for permissions,
scheduling, idempotency, dirty-event attribution, privacy routing, retries, or
source-of-truth writes.

## Principle

Agents produce structured proposals. Deterministic systems authorize, route, persist, audit, and require approval.
