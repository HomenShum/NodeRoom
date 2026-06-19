# Agent Privacy and Security Architecture

## Purpose

This document defines the privacy and security model for NodeRoom's agent runtime and shared collaboration surfaces.

## Core Model

NodeRoom uses one shared NodeAgent runtime pattern with many durable jobs. It is not a permanent agent swarm.

```text
One NodeAgent runtime/harness
  -> many agentJobs
  -> each job has requester, roomId, artifactId, scope, policies
  -> workflow/workpool slices execute durable work
```

`agentSessions` represent public/private lanes and presence. `agentJobs` are the durable execution primitive.

## Policy Fields

Each meaningful job should be governed by:

- `scope`: `public_room`, `private_user`, or `team`
- `entrypoint`: `public_ask`, `private_agent`, `free`, `system`, `automation`, `provider_parser`, or `room_work`
- `evidencePolicy`: `public_only`, `private_allowed`, or `mixed_requires_redaction`
- `approvalPolicy`: `read_only`, `draft_first`, `auto_commit_safe`, or `host_review`

## Public Room Jobs

Public jobs may read only room-visible/public resources and may write only room-visible/public outputs by default.

They must not consume private artifacts, private notebook snapshots, private messages, private evidence, private OKF chunks, or private cache rows.

## Private User Jobs

Private jobs may read:

- room-visible/public resources
- private resources owned by the requester

They may not read another user's private resources.

Private-derived outputs must remain private unless explicitly redacted and promoted.

## Mandatory Rules

1. No public job can read private data.
2. Private jobs can read public plus own-private only.
3. Private-derived output stays private by default.
4. Private-to-public promotion requires explicit approval.
5. Traces inherit the maximum sensitivity of their inputs.
6. Model egress follows data classification.
7. Retrieval filters must include privacy constraints.
8. Shared channels must never carry private payloads.

## Shared Surfaces Covered

The privacy model applies to:

- messages
- agent jobs/runs/steps
- operation events
- model journals
- mutation receipts
- traces
- source captures
- evidence facts
- OKF concepts/chunks
- embeddings and vector indexes
- entity research cache
- room activity outbox
- agent artifacts and rendered artifact exports
- ProseMirror documents
- streaming chunks
- file processing jobs
- coach cues and feedback
- exports, analytics, and logs

## ProseMirror Boundary

Convex ProseMirror Sync may own collaborative document sync, but NodeRoom must own access control.

A NodeRoom wrapper must map each `prosemirrorDocId` to:

```text
roomId
artifactId
elementId
visibility
ownerId
```

No raw component document should be exposed without this wrapper policy.

## Agent Artifact Boundary

Agent Artifacts inherit the maximum sensitivity of their inputs. A rendered
React/MDX/HTML view must be permission-filtered before display or export.

```text
private input -> private Agent Artifact -> redacted rendering -> approved promotion
```

Public jobs and room-visible renderings may see only room/public refs. Private
source refs, private notebook snippets, and private evidence cards remain
owner-only unless explicitly redacted and promoted.

## Hardening Plan

- Centralize authorization in an `authz` layer.
- Add visibility and owner fields to all content-bearing rows.
- Build policy-driven context packs for model calls.
- Record context manifests using refs, hashes, and redaction status.
- Add privacy regression tests for every shared surface.
- Add egress tests for model/provider policy.
- Add redaction tests for traces, receipts, journals, and exports.
- Add Agent Artifact rendering tests for private ref redaction and planHash
  approval.

## Product Promise

Agents may help users work faster, but they never decide who can see private
data. The shipped backend subset already enforces this on private feed indexes,
notebook dirty-event processing, read-model queries, and Agent Artifact
visibility. The target requirement is broader: every read, model call, write,
rendered artifact, trace, receipt, journal, and export must pass through the
same privacy/redaction boundary before it reaches another user or provider.
