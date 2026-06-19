# Native Notebook (Convex ProseMirror Sync) + Evidence-Backed Coach Mode

Target architecture for NodeRoom: **human-owned collaborative notebook via Convex
ProseMirror Sync; agent-owned intelligence through the existing read-model / sidecar
layer (proposals, coach cues, evidence, structured artifacts).** Coach Mode consumes
the same processed/evidence-backed layer.

> Note: `6-18-2026-coach-mode.txt` is currently empty (0 lines). The Coach Mode design
> below is derived from the requesting conversation, not that file. If that note is later
> filled in, reconcile this plan with it before Stage 5.

## Core rule to encode (product + architecture)

> ProseMirror Sync owns collaborative text. NodeRoom owns intelligence, evidence,
> proposals, and approval. Agents may **read** the notebook through a processed snapshot
> and **write** proposals, coach cues, evidence, and structured sidecars. Agents may only
> mutate the human-owned notebook through explicit user approval **or** a clearly labeled,
> append-only agent-owned block.

## Three layers

1. **Source surfaces** (human/imported): collaborative notebook (ProseMirror), spreadsheet,
   uploads, source captures, wall, research tables.
2. **Processed read model** (canonical agent-readable): notebook blocks, entities, claims,
   questions, mentions, source spans, OKF concepts, evidence facts, cell payloads, trace
   refs, review blockers. **Already substantially built** in this repo.
3. **Agent output / proposal layer**: Noteworthy Inbox items, scratch blocks, research
   findings, evidence cards, proposed rows/insertions, coach cues, review tasks. Only
   user-approved outputs promote into source surfaces.

## Locked decisions

1. **Scope** — full architecture spec + staged roadmap, including Coach Mode design.
2. **Editor data model** — keep the existing `note` artifact kind (`convex/schema.ts:114`,
   `Note()` in `src/ui/panels/Artifact.tsx:1470`). Add a `notebookDocuments` registry mapping
   `roomId + artifactId + "doc"` → `prosemirrorDocId`. Behind `VITE_NOTEBOOK_SYNC=prosemirror`
   the `Note` component renders the Convex ProseMirror Sync editor; a quiet-window snapshot
   writes ProseMirror→HTML into `elements["doc"]` so `commit`/CAS/locks/`roomActivityOutbox`/
   `FileViewer` stay unchanged. Lazy migration: first open of a legacy note seeds a synced doc
   from the existing `docStr` HTML.
3. **Coach Mode** — ride the existing `create_coach_cue` pipeline (`convex/roomActivity.ts:671`,
   `src/ui/insights/NoteworthyInbox.tsx`). A coach cue becomes clickable into an inline
   explain-and-defend prompt + evaluator. No separate Practice surface. The advisory
   `BankerCoachPanel` (Evidence/Coach/Review/Handoff) is untouched.
4. **Agent write boundary** — proposal-first default. Agents write sidecars/proposals/cues
   and evidence/CellPayloads. One explicitly-labeled, **append-only "NodeRoom notes" region**
   in the synced doc may receive agent writes via the ProseMirror Sync API, only after a
   user-accepted insertion. The plan must solve append provenance + undo for that region.
5. **Coach evaluation backend** — evaluation runs as an `agentJob` through the NodeAgent
   harness / RoomTools, recorded via existing trace / `retrievalEvents`; outcome (score,
   mastery tags, missed evidence refs, review-readiness delta) is stored on the
   `roomActivityOutbox` row's `finding`. **No new table.** Grounding rule: every feedback item
   must cite a source / cell / trace / `evidenceFact` / OKF concept or be dropped.

## Current-state anchors (verified in repo)

- Editor: `src/ui/panels/Artifact.tsx` `Note()` — Tiptap `StarterKit`, HTML-on-blur via
  `commit(store, roomId, me, art.id, "doc", editor.getHTML())`, remote re-sync effect.
- Components mounted: `convex/convex.config.ts` (workflow, workpool, persistent-text-streaming,
  debouncer) — `app.use(prosemirrorSync)` fits the existing pattern.
- Read model exists: `roomActivityOutbox` (`convex/schema.ts:299`) with scoped dedupe keys,
  `quietUntil`/`maxWaitAt`, visibility-scoped indexes; `convex/noteworthy.ts`
  `debounceActivityScan` → `enqueueRoomActivity`/`scanActivityRow` (`convex/roomActivity.ts`).
- Sidecars exist: `agentJobs`, `entityWorkItems`, `okf*`, `sourceCaptures`, `evidenceFacts`,
  `retrievalEvents`, `convexRoomTools.ts` OKF retrieval.
- Coach surfaces exist (advisory): `BankerCoachPanel.tsx`, `buildBankerCoachPacket`,
  evidence cards, `readiness.readyForClientUse`; scanner already emits `create_coach_cue`.

## Implementation stages

### Stage 1 — Spec / ownership rule (docs only)
- [ ] Add `docs/NATIVE_NOTEBOOK_ARCHITECTURE.md` capturing the three layers, the core rule,
      and the two-debounce model (save debounce vs passive-agent debounce).
- [ ] Record the agent write boundary and the labeled append-only block contract.
- [ ] No code in this stage.

### Stage 2 — Install ProseMirror Sync behind a flag
- [ ] Add dependency `@convex-dev/prosemirror-sync` (requires install permission).
- [ ] `app.use(prosemirrorSync)` in `convex/convex.config.ts`.
- [ ] Add minimal `convex/prosemirror.ts` exposing the component's sync API (auth-gated to
      room membership via existing `requireActorProof`/`requireActorProofV` patterns).
- [ ] Feature-flag the editor: `VITE_NOTEBOOK_SYNC=prosemirror`. When unset, keep the current
      Tiptap HTML-on-blur `Note()` path as fallback (Option A). When set, render the synced
      editor (`useTiptapSync`).
- [ ] Do not remove the legacy path.
- [ ] Smoke: editor mounts, two clients edit concurrently, content persists.

### Stage 3 — `notebookDocuments` wrapper registry + lazy migration
- [ ] Add table `notebookDocuments`: `roomId`, `artifactId`, `elementId` (`"doc"`),
      `prosemirrorDocId`, `visibility`, `ownerId`, `latestSnapshotHash`,
      `latestIndexedVersion`, `latestProcessedAt`, timestamps; indexes by room and by
      `prosemirrorDocId`.
- [ ] On first open of a `note` artifact with the flag on, create the synced doc seeded from
      existing `elements["doc"]` HTML and register the mapping (idempotent).
- [ ] Keep NodeRoom business semantics (room/artifact/visibility/owner) in the registry, never
      inside the ProseMirror Sync component.

### Stage 4 — ProseMirror → snapshot/processing adapter (feeds existing pipeline)
- [ ] Quiet-window trigger only (no per-step agent events): content-hash compare, debounce,
      `maxWaitAt` hard deadline. Reuse the existing `roomActivityOutbox` quiet-window machinery.
- [ ] Adapter functions: ProseMirror JSON → text, → markdown-ish, → block list, with block /
      source-span extraction and a stable content hash.
- [ ] On quiet window: write the HTML snapshot into `elements["doc"]` via the existing
      `commit`/CAS path, then `enqueueRoomActivity` with scoped dedupe
      (`roomId + nodeId/blockId + authorId + editingSessionId`) so a busy shared notebook never
      starves; set `quietUntil` and `maxWaitAt`.
- [ ] Feed results into existing `roomActivityOutbox` → noteworthiness → `agentJob` +
      `entityWorkItems` → OKF indexing → Noteworthy Inbox. No new parallel pipeline.
- [ ] Confirm the existing scanner stays cheap (classify only; no Linkup/Firecrawl/LLM in scan).

### Stage 5 — Coach Mode (evaluative) on the cue pipeline + labeled agent block
- [ ] Make a `create_coach_cue` item in the Noteworthy Inbox clickable into an inline
      explain-and-defend prompt: show the target artifact/cell/source + an expected-answer
      outline generated from the evidence graph + OKF concepts.
- [ ] Capture the user's typed/spoken answer; run evaluation as an `agentJob` via the NodeAgent
      harness / RoomTools. Record the run in existing trace / `retrievalEvents`.
- [ ] Store the outcome on the originating `roomActivityOutbox` row's `finding`:
      `score`, `masteryTags`, `missedEvidenceRefs`, `reviewReadinessDelta`. No new table.
- [ ] Enforce the grounding rule: drop any feedback item that cannot cite a
      source/cell/trace/`evidenceFact`/OKF concept. Surface missed refs as click-through links.
- [ ] Feed `reviewReadinessDelta` into `buildBankerCoachPacket` readiness so Coach Mode raises
      or blocks `readyForClientUse`.
- [ ] Labeled agent-owned append block: define a single append-only "NodeRoom notes" region in
      the synced doc; agent writes go through the ProseMirror Sync API only after a user-accepted
      insertion; tag provenance and keep undo scoped to that region. Default remains
      proposal-first; inline/cursor insertions are out of scope.
- [ ] P0 demo: user writes a CardioNova/runway note → passive pipeline flags a source gap →
      coach cue "Practice explaining why runway is needs_review" → user answers → evaluator
      scores against evidence/cell/source → feedback links missed items back to exact refs.

## Guardrails (what to avoid)
- ProseMirror is the collaborative text substrate, **not** the knowledge database; the graph
  (nodes/relations/OKF/evidence/claims/tasks/cell payloads/traces) stays NodeRoom-owned.
- Do not turn every ProseMirror step into an agent event; snapshot debounce + quiet window +
  content-hash + block diff + `maxWaitAt` only.
- Agents do not freely edit the live notebook; proposal-first, plus the one labeled append-only
  block.
- Coach Mode is artifact-grounded; no feedback without an evidence/source/cell/trace/OKF ref.
- Batch agent outputs: one patch bundle with payload-hash skip, not one mutation per fact.
- Observers get sentence-level / summary updates; only focused artifact/range subscribers get
  detailed patches.

## Validation
- Run after harness changes (per `AGENTS.md`): `npm run nodeagent:frame:smoke`,
  `npm run omnigent:nodeagent:smoke`, and `npm test -- --run tests/frameRunner.test.ts` if the
  frame runner is touched.
- Editor: flag off → legacy Tiptap path unchanged; flag on → two-client concurrent edit persists.
- Adapter: typing in a shared notebook by multiple authors still produces per-author/per-block
  scans (no whole-notebook starvation); `maxWaitAt` forces a snapshot under continuous typing.
- Pipeline: snapshot enqueues `roomActivityOutbox`, scanner stays cheap, dedupe prevents
  duplicate jobs for the same source/hash.
- Coach: cue → prompt → `agentJob` eval → `finding` carries score/masteryTags/missedEvidenceRefs/
  readiness delta; ungrounded feedback is dropped; readiness reflects the delta.
- No user-owned cell/note silently overwritten (existing no-clobber/proposal tests still pass).

### Stress scenarios to script (Stage 4–5 hardening)
- A: 20 users type in one public notebook 5 min → per-user/block scans still fire.
- B: 50 users mention the same company in separate notes → one entity/facet job, cache hit.
- C: 5 agents stream long responses, 30 observers → owner fast stream, observers sentence-level,
  no spreadsheet token writes.
- D: agent fills 200 cells → one/few batch mutations, unchanged cells skipped by payload hash.
- E: human edits C2 while agent processes A1:C5 → C2 preserved, overlap becomes proposal,
  no retry storm.

## Permissions / handoff
- Stages 2–5 require source edits, a new dependency install, and Convex schema/function changes.
  This planning agent cannot perform them. Switch to an implementation-capable agent to execute,
  stage by stage, keeping writes behind `RoomTools` and durable memory in frames/cache/job rows
  (per `AGENTS.md`).

## Open items to confirm during implementation
- Whether `@convex-dev/prosemirror-sync` snapshot/read API exposes block-level structure
  server-side, or whether the block extraction must run client-side before snapshot enqueue.
- Exact dedupe key granularity for ProseMirror blocks (stable block id vs node id) given the
  component's document model.
- Fill or supersede the empty `6-18-2026-coach-mode.txt` so Coach Mode design has a canonical
  source of truth.

## References
- Convex ProseMirror Sync component: https://www.convex.dev/components/prosemirror-sync
- GitHub README: https://github.com/get-convex/prosemirror-sync
- Convex Components docs: https://docs.convex.dev/components/using
