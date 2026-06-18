# Native Notebook: ProseMirror Sync + NodeRoom Sidecar

## Decision

Adopt Convex ProseMirror Sync as the target collaborative notebook substrate while keeping NodeRoom's intelligence, permissions, evidence, and agent outputs outside the live editor.

## Architecture

```text
Human-owned collaborative notebook
  Convex ProseMirror Sync + Tiptap / BlockNote

NodeRoom wrapper
  notebookDocuments registry

Processing adapter
  snapshot -> text / markdown / blocks / entities / spans

NodeRoom read model
  nodes / relations / OKF / evidence / roomActivityOutbox

Agent sidecar
  suggestions / scratchpad / work items / proposals / coach cues

Human approval bridge
  insert / add to sheet / create task / dismiss
```

## Why

This avoids reinventing collaborative rich-text editing while keeping NodeRoom focused on:

- evidence-backed agent workflow
- safe mutation
- passive intelligence
- review readiness
- finance-specific artifacts
- human ownership

## Component Boundary

Convex ProseMirror Sync owns:

- collaborative document synchronization
- ProseMirror document state
- real-time editing mechanics

NodeRoom owns:

- room and artifact identity
- visibility and owner policy
- processed semantic read model
- agent jobs and proposals
- evidence and traces
- OKF concepts
- coach cues and review tasks

## Processing Policy

Do not process every ProseMirror step. Process snapshots after a quiet window using content hashes and version checks.

Outputs should include:

- plain text
- markdown-ish representation
- block list
- headings
- mentions/entities
- source spans
- content hash
- passive activity events

## Agent Mutation Policy

Agents should not freely co-edit the live notebook. They should write sidecar proposals by default.

Allowed direct insertions require:

- explicit user command, or
- clearly labeled agent-owned block, and
- policy/visibility validation, and
- mutation receipt.

## Implementation Plan

1. Keep current note editor as fallback.
2. Install ProseMirror Sync behind a feature flag.
3. Add `notebookDocuments` wrapper table.
4. Build snapshot adapter.
5. Feed processed snapshots into passive intelligence.
6. Add sidecar proposals and user-approved insertion.
7. Use Coach Mode as the first end-to-end proof.
