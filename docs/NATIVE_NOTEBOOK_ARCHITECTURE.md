# Native Notebook Architecture

## Core rule

> ProseMirror Sync owns collaborative text.
> NodeRoom owns intelligence, evidence, proposals, and approval.
>
> Agents may **read** the notebook through a processed snapshot.
> Agents may **write** proposals, coach cues, evidence, and structured sidecars.
> Agents may only mutate the human-owned notebook through explicit user approval
> **or** a clearly labeled, append-only agent-owned block.

## Three layers

### 1. Source surfaces (human/imported)

These are human-owned or imported inputs. NodeRoom stores them but does not
allow agents to freely overwrite them.

- Collaborative notebook (ProseMirror Sync)
- Spreadsheet
- Uploaded PDFs / source captures
- Wall / sticky notes
- Research table

### 2. Processed read model (canonical agent-readable)

The agent-readable layer derived from source surfaces. This is where agents
reason before generating output.

Built from existing infrastructure:
- `roomActivityOutbox` — passive scan results, noteworthiness findings
- `entityWorkItems` — per-entity/facet work ledger
- `entityResearchCache` — freshness-aware research cache
- `okfConcepts` / `okfChunks` / `okfEdges` — portable room knowledge
- `sourceCaptures` / `evidenceFacts` — banker-grade evidence
- `retrievalEvents` — OKF retrieval audit trail
- Notebook snapshot text (extracted from ProseMirror JSON on quiet window)

### 3. Agent output/proposal layer

Agents write here by default. Outputs are staged, not committed directly to
source surfaces.

- `roomActivityOutbox` findings — passive inbox items, coach cues
- Proposals (draft-first) — require user accept before touching human-owned artifacts
- `entityWorkItems` — queued research tasks
- Evidence cards — source-backed claims
- Proposed CellPayloads — sheet enrichment needing approval
- Review tasks
- Labeled agent-owned append block in notebook (post-acceptance only)

Only user-approved outputs promote into source surfaces.

## Editor: ProseMirror Sync + existing artifact model

### Feature flag

`VITE_NOTEBOOK_SYNC=prosemirror` — when set, renders the live collaborative
ProseMirror editor. When unset, keeps the existing Tiptap HTML-on-blur editor
(Option A fallback).

### Data model: backing `note` artifacts, not replacing them

The existing `note` artifact kind (`convex/schema.ts:114`) is preserved.

The `notebookDocuments` registry maps:
```
(roomId, artifactId, elementId="doc") → prosemirrorDocId
```

The ProseMirror Sync component owns live collaborative text state. On every
quiet window (after user stops typing), the editor:
1. Extracts plain text from the ProseMirror doc.
2. Writes the HTML snapshot into `elements["doc"]` via the existing `commit()` /
   CAS path — so locks, proposals, `readSourceText`, and the OKF snapshot pipeline
   are unchanged.
3. Calls `enqueueRoomActivity` with scoped dedupe key
   `activity:{roomId}:artifact_element:{artId}:doc:content_committed:{actorId}`
   so per-actor/per-block quiet windows never starve each other.

### Lazy migration

On first open of a legacy `note` artifact with `VITE_NOTEBOOK_SYNC=prosemirror`:
1. Check `notebookDocuments` for an existing `prosemirrorDocId`.
2. If none exists, create a new synced doc seeded from the current HTML in
   `elements["doc"]`, then register the mapping.
3. Subsequent opens use the synced doc directly.

### Agent write boundary

Default: **proposal-first**. Agents write to proposals / inbox items / evidence
cards. They do not call `useTiptapSync`'s API directly.

The one exception: a labeled, append-only **agent notes block** stored in
`elements["doc:agent"]`. This is a separate element from the live ProseMirror
"doc" — agents write to it via the standard `applyAgentCellEdit` path with
`approvalPolicy: "draft_first"`. The user accepts or rejects in the Noteworthy
Inbox / proposals panel. When accepted, the block is displayed below the main
editor with a "NodeRoom" provenance badge.

## Two debounce layers (never conflated)

### Layer A — save debounce (protect UX + DB write volume)

Goal: keep the user's text saved and shared.

Timing:
- 300–1000 ms after typing pause (local editor debounce)
- Immediate on blur
- Immediate on `pagehide` / phone lock
- Immediate on manual save

This layer only saves content. It never calls an LLM, Firecrawl, or Linkup.

The ProseMirror Sync component handles step-level sync; this layer is
the HTML snapshot write into `elements["doc"]`.

### Layer B — passive agent debounce (protect cost + avoid noise)

Goal: wait until the note/cell is stable enough to inspect.

Timing:
- 8–20 seconds after quiet period (`DEFAULT_QUIET_MS = 12_000` in roomActivity.ts)
- Hard deadline: `maxWaitAt = firstEditAt + 60_000` (MAX_QUIET_MS)
- Batch aggregation for high-volume rooms

Implemented via `enqueueRoomActivity` / `debounceActivityScan` in
`convex/roomActivity.ts` and `convex/noteworthy.ts`. The debounce key is
scoped per actor/source so a shared notebook with many active users never
produces debounce starvation.

## Coach Mode: evaluative layer on the cue pipeline

The existing **advisory** Banker Coach (`BankerCoachPanel`, evidence/coach/
review/handoff tabs) is unchanged.

### What's new: evaluative cues

The passive noteworthiness scanner emits `create_coach_cue` for items scoring
0.55–0.75 (`classifyNoteworthy` in `convex/roomActivity.ts:671`).

Evaluative enhancement: a coach cue in the Noteworthy Inbox becomes **clickable
into an inline explain-and-defend prompt**:

1. Show the target artifact/cell/source + an expected-answer outline derived
   from the evidence graph + OKF concepts.
2. User types/speaks their answer.
3. An `agentJob` (entrypoint `"room_work"`, mode `"coach_eval"`) runs the
   evaluation via the NodeAgent harness / RoomTools.
4. The result is stored on the originating `roomActivityOutbox` row's `finding`:
   `score`, `masteryTags`, `missedEvidenceRefs`, `reviewReadinessDelta`.

**Grounding rule**: every feedback item must cite a source / cell / trace /
`evidenceFact` / OKF concept. Ungrounded claims are dropped before writing.

The `reviewReadinessDelta` feeds into `buildBankerCoachPacket` readiness, which
in turn controls `readyForClientUse` in the BankerCoachPanel.

### Coach eval agentJob shape

```ts
{
  entrypoint: "room_work",
  mode: "coach_eval",
  request: {
    coachEval: {
      activityId: string,       // roomActivityOutbox row
      artifactRef: string,      // artifactId:elementId being evaluated
      userAnswer: string,       // user's typed answer
      expectedOutline: string,  // generated from OKF + evidence
    }
  }
}
```

Outcome written to `roomActivityOutbox.finding`:
```ts
{
  coachEval: {
    score: number,             // 0–1
    masteryTags: string[],     // e.g. ["understands_runway", "weak_on_burn"]
    missedEvidenceRefs: string[], // sourceCaptureId / evidenceFactId
    reviewReadinessDelta: number, // +/- delta to apply to readiness
  }
}
```

## Guardrails

- ProseMirror is the collaborative text substrate, NOT the knowledge database.
  The graph (nodes/relations/OKF/evidence/claims/tasks/cell payloads/traces)
  stays NodeRoom-owned.
- Do not process every ProseMirror step as an agent event. Snapshot debounce
  + quiet window + content-hash + `maxWaitAt` only.
- Agents do not freely edit the live notebook. Proposal-first, plus the one
  labeled append-only block.
- Coach Mode is artifact-grounded: no feedback without an evidence/source/
  cell/trace/OKF concept ref.
- Batch agent outputs: one patch bundle with payload-hash skip, not one mutation
  per fact.
- Observers get sentence-level / summary updates; only focused artifact/range
  subscribers get detailed patches.

## References

- Convex ProseMirror Sync: https://www.convex.dev/components/prosemirror-sync
- GitHub: https://github.com/get-convex/prosemirror-sync
- Convex Components: https://docs.convex.dev/components/using
- `convex/roomActivity.ts` — `enqueueRoomActivity`, `classifyNoteworthy`
- `convex/noteworthy.ts` — `debounceActivityScan`, `scanActivity`
- `src/ui/panels/Artifact.tsx` — `Note()` (legacy), `SyncedNote()` (new)
- `src/ui/insights/NoteworthyInbox.tsx` — passive inbox, coach cue pill
- `src/ui/artifacts/BankerCoachPanel.tsx` — advisory coach (unchanged)
- `convex/schema.ts` — `notebookDocuments`, `roomActivityOutbox`
