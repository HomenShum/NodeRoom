# Passive Notebook Single-Source Fix

## The Battlefield Problem

A banker joins a room, lands in the Capture Notebook, and starts typing messy
meeting notes:

```text
CardioNova raised 18m, maybe 9 months runway, need current cash source.
```

The happy path is simple:

1. The notebook syncs live for everyone in the room.
2. The user pauses or blurs the note.
3. NodeRoom notices one noteworthy item.
4. The passive inbox offers Research, Add to sheet, Dismiss, or Coach Mode.
5. The agent does not mutate the source notebook until the user approves.

The bug broke step 3. The ProseMirror snapshot callback and the normal
NodeRoom commit mutation could both enqueue passive work. Because the two paths
used different dedupe inputs, one note could create two room-intelligence rows.
In a live diligence room that looks like noise: duplicate research prompts,
duplicate cost, and lower trust in the assistant.

## Plain-English Fix

Separate transport facts from business events.

- ProseMirror Sync is the live text transport.
- `notebookDocuments` is the registry that maps a ProseMirror document id back
  to a NodeRoom room, artifact, element, owner, and visibility.
- `onSnapshot` may update registry metadata such as hash, version, and processed
  timestamp.
- `onSnapshot` must not enqueue passive intelligence.
- In the current bridge, `applyCellEdit` is the single business commit path for
  notebook text that should trigger passive intelligence.
- In the target native architecture, an actor-authenticated dirty metadata event
  replaces blur-driven full HTML commits as the processing trigger.

In one sentence: live collaboration can say "the document changed", but only
NodeRoom's actor/policy-aware control plane can say "this room activity should
be processed".

Open the Shiki-rendered code visual:
[`docs/visuals/passive-notebook-single-source-code.html`](visuals/passive-notebook-single-source-code.html).

## Before, Bridge, And Target

### Before: snapshot sync also became an activity source

```ts
onSnapshot: async (ctx, id, snapshot, version) => {
  const row = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_prosemirror_doc", (q) => q.eq("prosemirrorDocId", id))
    .first();
  if (!row) return;

  const text = stripHtml(prosemirrorJsonToHtml(snapshot));
  const hash = await sha256(text);

  await ctx.db.patch(row._id, {
    latestSnapshotHash: hash,
    latestIndexedVersion: version,
    latestProcessedAt: Date.now(),
  });

  await enqueueRoomActivity(ctx, {
    roomId: row.roomId,
    artifactId: row.artifactId,
    elementId: row.elementId,
    eventKind: "notebook_snapshot",
    content: text,
    dedupeKey: `${row.roomId}:${row.artifactId}:${hash}`,
  });
};
```

That is too much authority for a sync callback. It knows a doc changed, but it
does not have the same actor proof, artifact write intent, base version, lock
state, and product semantics as the canonical NodeRoom mutation.

### After: snapshot sync is registry-only

```ts
onSnapshot: async (ctx, id, snapshot, version) => {
  const row = await ctx.db
    .query("notebookDocuments")
    .withIndex("by_prosemirror_doc", (q) => q.eq("prosemirrorDocId", id))
    .first();
  if (!row) return;

  const hash = await sha256(JSON.stringify(snapshot));
  await ctx.db.patch(row._id, {
    latestSnapshotHash: hash,
    latestIndexedVersion: version,
    latestProcessedAt: Date.now(),
  });
};
```

### Bridge after: the only enqueue belongs to the checked mutation path

```ts
export const applyCellEdit = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    elementId: v.string(),
    value: cellValue,
    baseVersion: v.number(),
    proof: actorProofV,
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.proof);
    const result = await applyCellEditCore(ctx, { ...args, actor });

    await enqueueRoomActivity(ctx, {
      roomId: args.roomId,
      artifactId: args.artifactId,
      elementId: args.elementId,
      actor,
      eventKind: "cell_edit",
      content: String(args.value),
    });

    return result;
  },
});
```

The production implementation is in
[`convex/prosemirror.ts`](../convex/prosemirror.ts) and
[`convex/artifacts.ts`](../convex/artifacts.ts).

### Target after: dirty metadata drives processing

```ts
export const markNotebookDirty = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    observedSnapshotVersion: v.optional(v.number()),
    observedSnapshotHash: v.optional(v.string()),
    changedRangeHint: v.optional(v.string()),
    processingLane: v.optional(v.union(
      v.literal("passive"),
      v.literal("index"),
      v.literal("coach"),
    )),
    quietMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    const artifact = await requireArtifactInRoom(ctx, args.roomId, args.artifactId);
    if (artifact.kind !== "note") throw new Error("artifact_not_notebook");
    if (!canReadArtifact(artifact, actor)) throw new Error("artifact_not_visible");

    // The UI does not resubmit the ProseMirror capability id. The backend
    // derives it from the room/artifact registry after actor and visibility
    // checks pass.
    const doc = await notebookDocumentForArtifact(ctx, args.roomId, args.artifactId);
    const now = Date.now();
    const lane = args.processingLane ?? "passive";
    const visibility = artifact.visibility ?? doc.visibility ?? "room";
    const ownerId = visibility === "private" ? ownerIdForArtifact(artifact, actor) : undefined;

    const existing = await ctx.db
      .query("notebookDirtyEvents")
      .withIndex("by_doc_actor_lane_state", (q) =>
        q.eq("prosemirrorDocId", doc.prosemirrorDocId)
          .eq("actorId", actor.id)
          .eq("processingLane", lane)
          .eq("state", "pending"))
      .order("desc")
      .first();
    const maxWaitAt = existing?.maxWaitAt ?? now + MAX_DIRTY_WAIT_MS;
    const delay = Math.max(0, Math.min(clampQuietMs(args.quietMs), maxWaitAt - now));
    const quietUntil = now + delay;

    const dirtyEventId = existing
      ? (await ctx.db.patch(existing._id, { visibility, ownerId, quietUntil, maxWaitAt, updatedAt: now }), existing._id)
      : await ctx.db.insert("notebookDirtyEvents", {
          roomId: args.roomId,
          artifactId: args.artifactId,
          notebookDocumentId: doc._id,
          prosemirrorDocId: doc.prosemirrorDocId,
          actor,
          actorId: actor.id,
          visibility,
          ownerId,
          processingLane: lane,
          state: "pending",
          dirtyAt: now,
          quietUntil,
          maxWaitAt,
          createdAt: now,
          updatedAt: now,
        });

    await ctx.scheduler.runAfter(delay, internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId });
    return { dirtyEventId, reused: !!existing, scheduledAfterMs: delay };
  },
});
```

That mutation writes metadata only. It never trusts a client-supplied
ProseMirror document id. The processor later reads the latest
ProseMirror snapshot through the `notebookDocuments` ACL, writes a processed
read model, and creates or updates the one passive item from that model.

## Convex Language Map

Convex gives NodeRoom three different function languages. This fix depends on
keeping their responsibilities separate.

| Convex function kind | What it should do in this feature | What it must not do |
|---|---|---|
| `query` | Read authorized room/notebook state. `getNotebookDoc` returns the random ProseMirror capability only when requester proof and artifact visibility pass. | Create a document, enqueue work, call a model, or leak a capability secret. |
| `mutation` | Own durable state changes. `ensureNotebookDoc` lazily creates the registry row; bridge `applyCellEdit` owns checked source edits and the single passive enqueue; target `markNotebookDirty` owns actor/policy-aware dirty metadata. | Call external providers directly, skip actor proof/visibility/idempotency checks, or hot-write full notebook HTML into a second content store. |
| `action` | Run external work such as model calls, source capture, or long-running agent slices. Actions return to mutations for durable writes. | Mutate source surfaces directly without the checked mutation bridge. |
| `internalQuery` / `internalMutation` | Let trusted server-side agent tools read/write through the same rules without exposing raw functions to clients. | Become a second write policy that diverges from public mutations. |

The rule is practical: queries tell the UI what is true, mutations make facts
durable, and actions do expensive outside work. Passive intelligence should be
created from an actor/policy-aware source or read-model event, not by every
transport or sync callback that observes a document change.

## Target Source-Of-Truth Policy

```text
ProseMirror Sync = live notebook text
notebookDocuments = metadata, visibility, artifact mapping, processing status
processed read model = agent-readable notebook semantics
Agent Artifacts = structured plans, diffs, evidence, coach feedback, reviews
elements["doc"] = legacy/export/checkpoint mirror only
```

The bridge still supports legacy blur/commit HTML without duplicate passive
rows. In the current UI, synced notebook blur/save still commits the legacy
`elements["doc"]` mirror until idle/save is wired to `markNotebookDirty`. The
shipped target backend slice adds dirty metadata, ACL-gated processing jobs,
read-model rows, and Agent Artifact approval by `planHash`, so the backend no
longer needs a hot dual content write to feed intelligence.

## Why The Capability Gate Matters

The ProseMirror document id is a random capability secret. If `getNotebookDoc`
returns it to someone who left the room or cannot see the artifact, that person
can keep syncing a document they should no longer have. The fix therefore also:

- requires requester proof for `getNotebookDoc` and `ensureNotebookDoc`;
- checks artifact visibility before returning the document id;
- rejects identity-backed ProseMirror sync reads/writes after room membership is
  revoked;
- falls back to the legacy note editor when the UI lacks proof for the sync
  path.

Token-only local/demo rooms still rely on the random document id as the
capability because the third-party ProseMirror `checkRead` / `checkWrite` hook
only receives `(ctx, id)`, not the user's requester token.

## If This Were Another Backend

The invariant is portable: keep collaborative-sync metadata separate from the
business event outbox, enforce membership before revealing the sync doc id, and
route processing through actor-authenticated dirty metadata plus a versioned
read model.

| Backend | Equivalent design |
|---|---|
| PostgreSQL + Realtime | Store `notebook_documents`, `notebook_dirty_events`, read-model tables, and `room_activity_outbox` separately. Use RLS or checked service functions for membership. Do not attach an outbox trigger to raw ProseMirror snapshot rows; enqueue after an ACL-gated processor writes the read model. |
| Supabase | Same PostgreSQL/RLS shape, plus Realtime subscriptions for authorized rows. Edge Functions may process dirty events, but source/read-model mutations still go through RLS-backed RPC functions. |
| Firestore | Keep a `notebookDocuments/{id}` registry, dirty-event documents, read-model documents, and an activity outbox. Security rules gate document id reads. Cloud Functions should listen to dirty events/read-model commits, not low-level editor snapshot documents. |
| DynamoDB | Use conditional writes for dirty-event idempotency and read-model commits. Streams may process only `eventKind=notebook_dirty` / `eventKind=read_model_committed`, never `eventKind=sync_snapshot`. Membership revocation must invalidate or deny the capability lookup path. |
| Rails/Django + SQL | Put sync state, dirty events, read-model rows, and source artifacts in separate models. Enqueue Celery/Sidekiq jobs from checked dirty-event service objects, not model callbacks for every editor snapshot save. |

## Verification

- `tests/nativeNotebookProsemirror.test.ts` proves the capability gate and that
  snapshots update registry metadata without creating `roomActivityOutbox` rows.
- `tests/nativeNotebookProsemirrorStatic.test.ts` proves
  `convex/prosemirror.ts` does not contain executable passive enqueue calls.
- The walkthrough review
  `native-notebook-single-source` demonstrates the human-facing happy path:
  capture a
  note, receive one passive inbox item, choose Research, and keep the source
  notebook human-owned. It is a UX/media review, not a replacement for backend,
  browser, privacy, or deployment gates.
- `tests/notebookProcessingTarget.test.ts` proves the shipped target backend
  slice: dirty-event dedupe by actor/lane, one read-model update, one passive
  item, active-membership recheck before processing, private read-model/feed
  isolation, and `agent_work_plan` approval by exact `planHash`.

## Connected Story

This fix is not just cleanup. It protects the core NodeRoom promise:

```text
human captures messy work
  -> the room syncs live
  -> NodeRoom notices once
  -> the agent proposes useful next steps
  -> the human approves source-of-truth changes
  -> every receipt, source, and trace remains reviewable
```

That is the real battlefield flow. The user is moving fast; the system must be
quiet, exact, and explainable.
