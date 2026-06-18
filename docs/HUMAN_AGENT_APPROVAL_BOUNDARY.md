# Human-Agent Approval Boundary

## Decision

NodeRoom should preserve a clear boundary between human-owned source surfaces and agent-owned sidecars.

The agent should usually read processed snapshots and write proposals. The human decides what becomes source-of-truth workspace state.

## Human-Owned Source Surfaces

- collaborative notebook
- spreadsheet
- uploaded files
- source captures
- research tables
- wall/sticky notes
- messages

## Agent-Owned Sidecars

- passive inbox suggestions
- scratchpads
- entity work items
- evidence cards
- coach cues
- review tasks
- proposed sheet rows
- proposed notebook insertions
- OKF concepts
- trace records

## Approval Bridge

Common actions:

- Research
- Add to sheet
- Insert into notebook
- Create task
- Append as Agent Summary
- Dismiss

## Default Rule

```text
agent reads processed snapshot
agent writes sidecar proposal
human approves mutation
system records receipt
```

## Why

Direct agent mutation of human surfaces creates risk:

- haunted document behavior
- confusing undo
- unclear provenance
- accidental private data promotion
- harder senior/client review
- lower human ownership

## Exceptions

Direct writes can be allowed when:

- user explicitly commands it
- target is visibly agent-owned
- operation is reversible and scoped
- policy allows the data class
- trace and mutation receipt are recorded

## Privacy Rule

Private-derived output remains private by default. Promotion to room/public requires explicit approval and redaction when needed.

## Product Principle

The product should say: NodeRoom noticed this may matter. Do you want to act on it?

It should not silently say: NodeRoom edited your work.
