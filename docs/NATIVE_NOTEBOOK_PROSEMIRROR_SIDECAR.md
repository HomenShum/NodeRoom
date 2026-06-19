# Native Notebook: ProseMirror Sync + NodeRoom Sidecar

## Decision

Adopt Convex ProseMirror Sync as the target collaborative notebook substrate while keeping NodeRoom's intelligence, permissions, evidence, and agent outputs outside the live editor.

## Architecture

```text
Human-owned collaborative notebook
  Convex ProseMirror Sync + Tiptap / BlockNote

NodeRoom wrapper
  notebookDocuments registry
  actor-authenticated dirty signals

Processing adapter
  bridge: snapshot -> registry hash / version tracking
  target: dirty event -> ACL-gated snapshot processor

NodeRoom read model
  notebook blocks / claims / mentions
  future adapters may add OKF links / evidence refs
  bridge passive events come from canonical NodeRoom commits, not snapshots
  target passive events come from the processed read model

Agent sidecar
  Agent Artifacts / suggestions / scratchpad / work items / proposals / coach cues

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

Do not process every ProseMirror step as a business event. ProseMirror snapshots
may update registry hashes and versions. The current bridge uses the canonical
NodeRoom commit path for passive enqueue because that path knows the actor and
artifact policy. The target native path uses an actor-authenticated dirty
metadata mutation, then a debounced processor reads the latest snapshot through
the `notebookDocuments` ACL and writes a processed read model.

The target dirty signal is metadata only:

```text
roomId
artifactId
prosemirrorDocId
actorId
visibility
ownerId
observedSnapshotVersion
observedSnapshotHash
changedRangeHint
dirtyAt / maxWaitAt
processingLane
```

It must not write the full notebook HTML into `elements["doc"]`.

Outputs should include:

- plain text
- markdown-ish representation
- block list
- headings
- mentions/entities
- source spans
- content hash
- registry hash/version markers

## Agent Mutation Policy

Agents should not freely co-edit the live notebook. They should write sidecar proposals by default.

Allowed direct insertions require:

- explicit user command, or
- clearly labeled agent-owned block, and
- policy/visibility validation, and
- mutation receipt.

## Implementation Status

Shipped backend:

1. Current note editor remains the fallback.
2. ProseMirror Sync is available behind a feature flag.
3. `notebookDocuments` wraps ProseMirror doc ids in NodeRoom room/artifact policy.
4. Snapshots are registry-only as the safety bridge.
5. `notebookDirtyEvents` and `notebookProcessingJobs` exist for native processing.
6. The ACL-gated snapshot processor writes notebook read-model rows.
7. Passive intelligence can run from the processed read model.
8. The first Agent Artifact kind, `agent_work_plan`, is approved by exact
   `planHash`.

Remaining product proof:

1. Render Agent Artifacts for work plans, diff previews, evidence, coach
   feedback, and planned-vs-actual reports.
2. Add sidecar proposals and user-approved insertion.
3. Use Coach Mode as the first end-to-end proof.

## Source-of-truth policy

```text
ProseMirror Sync = live notebook text source of truth
notebookDocuments = metadata, visibility, artifact mapping, processing status
processed read model = agent-readable notebook semantics
Agent Artifacts = structured plans/diffs/evidence/reviews
elements["doc"] = legacy/export/checkpoint mirror only
```
