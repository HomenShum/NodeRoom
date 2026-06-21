# Optimistic UI Plan — NodeRoom

> Source of truth: the JUDGED decisions (adversarial judge verdicts) over the proposer's recommendations.
> Grounded against `convex` **1.40.0** (installed) and verified source reads (file:line cited throughout).
> Status legend for TARGET MODE: **optimistic** (`withOptimisticUpdate`) · **pending-indicator** (local `isPending`/disabled, honest reactive reconcile) · **reactive-only** (plain `useMutation`, no in-flight UI yet).
>
> 2026-06-20 supersession: this audit predates the `rooms.meta` /
> `artifacts.elements` split, the `presenceClaims` spreadsheet presence slice,
> and the ProseMirror-native notebook direction. Keep it as historical
> optimistic-UI reasoning; use current architecture docs for sync-path claims.

---

## 1. Thesis

Optimism is a **scalpel, not a coat of paint.** The production rubric (Linear sync-engine "be optimistic when reversible + predictable-from-input + client-authoritative + low-conflict"; Figma anti-flicker LWW "discard server echoes that conflict with unacknowledged local edits"; Remix/React-Router minimum pending states "pending → confirmed → failed+retry, never silent-revert") tells us **which quadrant each mutation lives in**, and the answer differs per feature. The headline error to avoid in NodeRoom is *not* "missing optimism" — the entire artifact edit surface (`applyCellEdit`, store.tsx:312) is **already optimistic** for notes, post-its, drags, spreadsheet cells, and element create/delete. The real, recurring, P1-grade defect is **silent failure**: optimistic and reactive mutations alike `await … then discard the {ok:false, reason}` result (store.tsx:370/373; messages.ts:50/52), so CAS conflicts, host-only rejections, and terminal-state races revert or vanish with **zero UI signal** — a direct HONEST_STATUS violation. This plan therefore (a) keeps optimism exactly where it belongs and refuses to add it where the result is server-computed (proposal approve, agent writes, create/upload/add-rows, the auto-allow *flip*), (b) closes the silent-failure gap on every path, and (c) treats the `rooms.full` whole-room subscription (rooms.ts:69–96) as the single structural coupling that makes all of the above more expensive than it needs to be at scale — deferred behind concrete triggers, not blanket-fixed now.

---

## 2. Per-feature decision table

| Feature | Current (file:line) | TARGET MODE | Grounded justification (rubric) | Convex API to use | Priority |
|---|---|---|---|---|---|
| **Chat send** | optimistic via `sendMsg.withOptimisticUpdate` (store.tsx:327–330); fire-and-forget `void sendMsg` (store.tsx:370); bubble keyed `m.id` (Chat.tsx:230) | **optimistic** (keep) + fix failure UX + stable key | Linear/chat textbook: reversible, predictable, client-authoritative; idempotent via `clientMsgId` dedup (messages.ts:21–22, `by_clientMsgId` index schema.ts:173) → atomic swap reconciles with no transient duplicate. But silent-revert on reject violates "never silent" minimum; key remount on opt→server swap breaks Figma anti-flicker for in-bubble edit state. | `useMutation(api.messages.send).withOptimisticUpdate` (already). Defer `usePaginatedQuery`/`optimisticallySendMessage`. | **P1** |
| **Cell edit** (spreadsheet) | optimistic via `applyCellEdit` (store.tsx:312–326), rides `rooms.full` | **optimistic** (keep as-is) | Reversible (server CAS artifacts.ts:211 → `{ok:false,reason:"conflict"}`, surfaced non-silently Artifact.tsx:412), predictable (sets value, bumps version+1), client-authoritative (own keystroke), well-defined merge (per-element CAS + lock). De-optimizing forfeits the headline; CRDT/LWW layer is over. Coupling cost is owned by `rooms.full`, not this decision. | `useMutation(api.artifacts.applyCellEdit).withOptimisticUpdate` (already). After rooms.full split, narrow `setQuery` to per-artifact slice (no semantics change). | **P2** |
| **Note editor** (legacy TipTap fallback) | already optimistic via `applyCellEdit` on `onBlur` commit (Artifact.tsx:583–591); `onBlur` discards `EditFeedback` (line 588) | **optimistic** (keep) + consume feedback + re-sync stale editor | Legacy whole-doc-as-one-element with one version counter; `doCommit` (532) and post-it drag (642) consume `EditFeedback` but the note (588) does **not** → on CAS reject (artifacts.ts:185–194) the note body silently reverts; `useEditor` seeds content once (585) and never re-syncs → stale `baseVersion` guaranteed on next blur. Native notebooks use ProseMirror Sync plus dirty metadata, not this HTML blur path. | Same `applyCellEdit` mutation for fallback/checkpoint behavior; wire the returned `{ok,reason}` into `editErrorMsg`; `editor.commands.setContent(...)` when unfocused+stale. | **P1** |
| **Post-it text** | already optimistic via `applyCellEdit` on `onBlur` (Artifact.tsx:688 → 401 → 366) | **optimistic** (keep, change nothing) | Same proof as cell edit; verified `commit()` is wired with `.withOptimisticUpdate`. Prior "non-optimistic" flag was a tracing error. | (already) | **P2** (verification debt only) |
| **Post-it drag** | already optimistic via `applyCellEdit` on `onDragEnd` (Artifact.tsx:642 → 401) | **optimistic** (keep, change nothing) | No-flicker follows from React 18/19 synchronous-event auto-batching (the optimistic `setQuery` of `v.x/v.y` and dnd-kit `transform→null` reset coalesce into one paint) + Convex optimistic-hold (value held until mutation result + consequent `rooms.full` update both arrive, then atomic swap). Adding manual transform/base reconciliation = gold-plating a second source of truth. | (already). Add Playwright bounding-box smoke + `data-testid` on `.r-postit`. | **P2** (verification debt only) |
| **Proposal resolve** (accept/reject) | reactive `useMutation` (store.tsx:334); wrapper discards result (store.tsx:373, typed `Promise<void>` store.tsx:105); per-row `busy` (Artifact.tsx:754), `acceptingAll` (714) | **pending-indicator** + honest failure surface | Agent-proposed + approval-gated + **server-computed** (CAS write may reject) ⇒ rubric says PENDING-INDICATOR, never optimistic. Optimistically removing the card before server confirm is *dangerous*: `resolveProposal` returns `{ok:false,reason:"conflict"}` (artifacts.ts:325→334) when `baseVersion` is stale (artifacts.ts:186–188); card disappears (pending-only `listProposals` artifacts.ts:300), host falsely believes value applied. Pure-reject path (no CAS write) is the only optimism candidate — deferred. | Plain `useMutation(api.artifacts.resolveProposal)`; change store contract to **return** `{ok,reason}`. No `withOptimisticUpdate`. | **P1** |
| **Job cancel / retry** | reactive `useMutation` (store.tsx:338–340); wrapper discards result (store.tsx:511–512); buttons no disabled state (Chat.tsx:168,173) | **pending-indicator** + disable-while-in-flight + failure surface | Server-computed state-machine transitions that fail **as data**: `cancel`→`{ok:false,reason:"terminal"}`, `retry`→`{ok:false,reason:"not_retryable"}`; `cancel` calls `cancelWorkflow(components.workflow,…)` adding real latency. Rubric: server-computed + race-prone + can-fail ⇒ pending-indicator, never fake-terminal. Status is *already reactive* (`longJob.status` Chat.tsx:166); the gap is the in-flight window + silent reject. | Plain `useMutation` (already); local `useState` per action; store wrappers must **return** `{ok,reason}`. No optimistic status, no global toast. | **P2** |
| **Auto-allow toggle** | reactive `useMutation` (store.tsx:332); fire-and-forget (store.tsx:372) | **reactive-only** (keep) | Mutation is a server-side **FLIP** `!r.autoAllow` (rooms.ts:98–108), not a SET → result is `!server_value`, predictable only when client matches server ⇒ naive optimistic flip carries the LWW/echo-bounce footgun. Host-only + host-singular (rooms.ts:104) ⇒ near-zero contention; rare room-policy switch in the "reactive-only acceptable" band; ON direction deliberately consent-gated (RoomShell.tsx:51–67). Making it instant fights the gate's intent. | Plain `useMutation` for now. If triggered: redesign to idempotent **SET** `toggleAutoAllow({roomId, next, requester})`, then `withOptimisticUpdate`. | **P2** |
| **Message edit** | reactive `useMutation` (store.tsx:333, 371); editor closes sync (Chat.tsx:293) | **optimistic** (add) + honest failure | Textbook optimistic-safe: reversible (just text), predictable (only effect is `db.patch(messageId,{text})` messages.ts:54, same `_id`, no generated field), client-authoritative (author-only, enforced messages.ts:52), LWW conflict is correct resolution. Strictly easier than shipped `sendMsg`/`applyCellEdit` — no `clientMsgId`/ID reconcile (the `_id` pre-exists). Current code has an *active* revert-then-correct flicker (Figma anti-flicker failure), not just absent polish. | `useMutation(api.messages.update).withOptimisticUpdate`; companion: make `messages.update` return discriminated `{ok}|{ok:false,reason}` (messages.ts:50,52). Plain (non-paginated) `getQuery/setQuery` form. | **P2** |
| **Create artifact / upload** | upload state machine complete (LeftRail.tsx:44/77/79/81); `createArtifact` server-insert (artifacts.ts:432); store wrapper (store.tsx:336/378–381) | **pending-indicator** (upload already correct — keep) | Server-computed ID (`ctx.db.insert` returns id, artifacts.ts:432) ⇒ optimism would LIE. Upload **already** implements pending (`setUploading(true)`, "Uploading…" line 79, disabled 77) → confirmed (`onPick(lastId)` 44) → failed (`.r-upload-error` 81). Right-sized; do not gold-plate. | Plain `useMutation(api.artifacts.createArtifact)` (already). | **P2** (no-op for upload) |
| **Add research rows** | reactive `useMutation` (store.tsx:335/374–377); `busy` disables buttons (Artifact.tsx:257,258,265); **no catch** (227–230) | **pending-indicator** + add missing failure branch | Server-computed: row slugs via `slugResearchRow` + collision-suffix loop (artifacts.ts:370–372) ⇒ no temp-id skeleton (would flicker-swap, risk discard-on-conflict per Figma). `addRows()` has `try/finally` but no `catch` → on reject the panel stays open with typed text and no error; user re-clicks → silent double-insert via the collision loop. Real root cause = missing error branch, not missing optimism. | Plain `useMutation(api.artifacts.addResearchRows)` (already); wrap in `try/catch`, reuse upload's error-surface pattern. | **P2** |
| **Agent `/ask` affordance** | client `useAction(api.agent.runRoomAgent)` in hot path (store.tsx:337); binary typing-dots (Chat.tsx:231–239); terminal-only writes (agent.ts:260,264,282) | **reactive-only** for agent writes (keep) + **pending-indicator via job model** for the affordance | Agent edits are server-computed, approval-gated, CAS-merged ⇒ rubric says NOT optimistic (NODEAGENT_ARCHITECTURE.md:502–525). But `useAction` serializes 3 round-trips (rooms.full read + 2 idempotency mutations) before the model starts — the Convex action-in-hot-path anti-pattern — and `/ask` writes land **all at once** at run end (no incremental reactive progress). The repo's own `/free` path (mutation `startFreeAuto` agentJobs.ts:216 + per-slice writes agentJobRunner.ts:182–203 + live job strip Chat.tsx:179–226) is the correct shipped shape. Converge `/ask` onto it — reuse, not new machinery. No optimistic overlay, no per-token streaming. | New `agentJobs` mutation entrypoint `public_ask` (mirror `startFreeAuto`); call via `useMutation` not `useAction`; per-slice `agentStepsRecord`; reuse job-strip component. | **P1** |

---

## 3. OPTIMISTIC targets — TypeScript sketches

All sketches obey: **synchronous handler**, **guard `getQuery` undefined**, **immutable updates** (new arrays/objects, never mutate the immutable `localStore` results), **shape-match** the server echo so the atomic swap is flicker-free, and a **3-state (pending/confirmed/failed)** UX where the optimistic value can be rejected.

### 3.1 Chat send — keep optimism, fix the key + the failure UX (P1)

`sendMsg` (store.tsx:327–330) is already correct as an optimistic *write*. Two fixes:

**(a) Stable React key — Chat.tsx:230.** Key by `clientMsgId` so the opt→server swap (opt id `"opt-"+clientMsgId` store.tsx:330 → server Convex `_id`) preserves the bubble's identity and in-bubble edit/selection state.

```tsx
// Chat.tsx — before: key={m.id}  (remounts every just-sent bubble on swap)
{messages.map((m) => (
  <Bubble key={m.clientMsgId ?? m.id} m={m} roomId={roomId} variant={variant}
          me={me} onPromote={promote} onOpenArtifact={onOpenArtifact} />
))}
```

**(b) Stop fire-and-forget — store.tsx:370.** Track the promise, expose a per-message status, retry re-sends the SAME `clientMsgId` (idempotent dedup messages.ts:21–22 makes retry safe).

```tsx
// store.tsx — replace `postMessage: ({channel,text,clientMsgId}) => { void sendMsg(...) }`
const [sendState, setSendState] =
  useState<Record<string, "pending" | "failed">>({}); // keyed by clientMsgId

const postMessage: RoomStore["postMessage"] = ({ channel, text, clientMsgId }) => {
  setSendState((s) => ({ ...s, [clientMsgId]: "pending" }));
  sendMsg({ roomId: rid, channel: chanStr(channel), proof, text, clientMsgId })
    .then(() => setSendState((s) => { const n = { ...s }; delete n[clientMsgId]; return n; }))
    .catch(() => setSendState((s) => ({ ...s, [clientMsgId]: "failed" })));
};
const retryMessage: RoomStore["retryMessage"] = (clientMsgId, channel, text) =>
  postMessage({ channel, text, clientMsgId }); // same clientMsgId → server dedups
```

`Bubble` renders `sendState[m.clientMsgId]`: `pending` → dimmed "sending"; `failed` → red marker + one-tap retry. **Do NOT** add `usePaginatedQuery`/`insertAtTop` yet — gold-plating at current scale.

### 3.2 Note editor — keep optimism, consume feedback + re-sync (P1)

The note already commits optimistically via `applyCellEdit`; the bug is that `onBlur` (Artifact.tsx:588) discards the `EditFeedback`, and `useEditor` (585) never re-syncs.

```tsx
// Artifact.tsx note onBlur — mirror doCommit (532) / post-it drag (642)
onBlur={async () => {
  const html = editor.getHTML();
  const r = await commit({ op: { artifactId, elementId: "doc", kind: "set",
                                 value: html, baseVersion: docEl?.version ?? 0 } });
  if (!r.ok) {
    setEditErrorMsg(r.reason === "conflict"
      ? "Your note edit was reverted — it changed elsewhere. Re-open to retry."
      : "Note edit failed — re-open to retry.");      // never silent-revert
  }
}}

// Re-sync TipTap from the reactive doc value ONLY when the editor is unfocused & stale,
// so a remote change during focus doesn't guarantee a stale-baseVersion conflict on blur.
useEffect(() => {
  if (!editor || editor.isFocused) return;            // Figma: discard echoes only when unacked
  const remote = docEl?.value ?? "";
  if (remote !== editor.getHTML()) editor.commands.setContent(remote, false);
}, [editor, docEl?.value, docEl?.version]);
```

**Do NOT** add debounced live-save or a CRDT — TipTap local state already makes typing instant; live-save would widen the conflict window on a single-version doc element.

### 3.3 Message edit — add optimism + honest failure (P2)

Mirror `sendMsg`, but match by `_id` (the editor only holds `m.id`; the `_id` pre-exists so reconcile is automatic and flicker-free for a text-only patch). Patch **both** channel query refs that could contain the message (public + the actor's private channel).

```tsx
// store.tsx:333 — replace plain useMutation
const editMsg = useMutation(api.messages.update).withOptimisticUpdate((local, args) => {
  for (const channel of ["public", me.id]) {                 // pub + this actor's private
    const q = { roomId: rid, channel, requester: proof };
    const cur = local.getQuery(api.messages.list, q);
    if (!cur) continue;                                       // guard undefined slice
    if (!cur.some((m) => m._id === args.messageId)) continue; // only the holding channel
    local.setQuery(api.messages.list, q,
      cur.map((m) => (m._id === args.messageId ? { ...m, text: args.text } : m)));
  }
});

// store.tsx editMessage wrapper — close editor optimistically, surface failure
editMessage: async (id, text) => {
  const r = await editMsg({ messageId: id as never, text, requester: proof });
  return r?.ok === false ? { ok: false, reason: r.reason } : { ok: true };
},
```

Companion (messages.ts:50,52): return `{ok:false, reason:"not_found"|"not_author"}` instead of silently `return`, so the UI can revert the draft to server text and show an inline "edit failed" + retry. **Do NOT** add a spinner — under-delivers for a fully-predictable text edit. Keep the plain (non-paginated) form until `messages.list` is paginated.

### 3.4 Auto-allow toggle — sketch ONLY if a revisit trigger fires (P2, deferred)

Do **not** bolt optimism onto the current FLIP semantics. The root-cause version requires changing the mutation to an idempotent SET first:

```ts
// convex/rooms.ts — change FLIP → SET so optimistic & server values are deterministically equal
export const toggleAutoAllow = mutation({
  args: { roomId: v.id("rooms"), next: v.boolean(), requester: actorProofV },
  handler: async (ctx, { roomId, next, requester }) => {
    const r = await ctx.db.get(roomId); if (!r) return { ok: false, reason: "not_found" };
    const actor = await requireActorProof(ctx, roomId, requester);
    if (String(r.hostId) !== actor.id) return { ok: false, reason: "host_required" };
    await ctx.db.patch(roomId, { autoAllow: next });
    await ctx.db.insert("traces", { roomId, ts: Date.now(), actor,
      type: "auto_allow_toggled", summary: `${actor.name} turned auto-allow ${next ? "on" : "off"}` });
    return { ok: true };
  },
});
```
```tsx
// store.tsx — only after the SET redesign above
const toggle = useMutation(api.rooms.toggleAutoAllow).withOptimisticUpdate((local, args) => {
  const q = { roomId: rid, requester: proof };
  const cur = local.getQuery(api.rooms.full, q);
  if (!cur) return;                                          // guard undefined
  local.setQuery(api.rooms.full, q,
    { ...cur, room: { ...cur.room, autoAllow: args.next } }); // shape-match server echo
});
// on rejection (host_required/network): surface failed; reactive room.autoAllow re-asserts — never silent.
```

---

## 4. PENDING-INDICATOR targets — React state pattern

The contract for **all** of these: local `isPending`/disabled + spinner/label during the await; **never** fake the server-computed result; on `{ok:false}` show an explicit, non-silent failure affordance; on `{ok:true}` let the reactive query reconcile.

### 4.1 Proposal resolve (P1) — fix the silent failure, NOT the latency

The card already has `busy`/`acceptingAll`; keep the card mounted and branch on the result.

```ts
// store.tsx:105 contract change — was Promise<void>
resolveProposal: (proposalId: string, approve: boolean) =>
  Promise<{ ok: true } | { ok: false; reason: "conflict" | "not_pending" | "not_found" | "host_required" }>;
// store.tsx:373 wrapper — RETURN r, do not discard
resolveProposal: async (proposalId, approve) =>
  resolveProposalMutation({ proposalId: proposalId as never, approve, requester: proof }),
```
```tsx
// Artifact.tsx ProposalRow.decide (756–760)
const decide = async (approve: boolean) => {
  setBusy(true); setRowErr(null);
  try {
    const r = await store.resolveProposal(p.id, approve);
    if (!r.ok) setRowErr(r.reason === "conflict"
      ? "Conflict — the cell changed; re-run or dismiss." : `Couldn't apply (${r.reason}).`);
    // on ok: keep card mounted; reactive listProposals (pending-only, artifacts.ts:300) removes it
  } finally { setBusy(false); }
};
// Render: buttons disabled while busy; on rowErr show inline error + Dismiss/Retry.
```
```tsx
// acceptAll (719–726) — aggregate, never loop silently
let ok = 0, conflicts = 0;
for (const p of pending) { const r = await store.resolveProposal(p.id, true); r.ok ? ok++ : conflicts++; }
setBatchSummary(`Approved ${ok}, ${conflicts} conflict${conflicts === 1 ? "" : "s"}.`);
```
No `withOptimisticUpdate` on this path. The reject-only optimism is explicitly out of scope (see revisit trigger).

### 4.2 Job cancel / retry (P2) — the minimal triad: pending + disable + failure-surface

Status is already reactive (`longJob.status` Chat.tsx:166); add only the in-flight window.

```tsx
// Chat.tsx — local in-flight + inline failure (reuse the longJob.error span pattern at :185)
const [pending, setPending] = useState<{ cancel?: boolean; retry?: boolean }>({});
const [jobErr, setJobErr] = useState<string | null>(null);

const onCancel = async () => {
  setPending((p) => ({ ...p, cancel: true })); setJobErr(null);
  const r = await store.cancelLongFreeJob(longJob.id);     // wrapper must RETURN {ok,reason}
  if (!r.ok) setJobErr(r.reason === "terminal" ? "Can't cancel: already finished." : "Cancel failed.");
  setPending((p) => ({ ...p, cancel: false }));
};
// Button: disabled={pending.cancel} + label "Cancelling…" / spinner; retry mirrors with "not_retryable".
```
```ts
// store.tsx:511–512 — RETURN the result instead of discarding
cancelLongFreeJob: (jobId) => cancelFreeAutoJob({ jobId: jobId as never, requester: proof }),
retryLongFreeJob:  (jobId) => retryFreeAutoJob({ jobId: jobId as never, requester: proof }),
```
No optimistic status, no global toast. Double-fire is data-safe (server terminal/not_retryable/lease guards), so this is UX-honesty, not correctness.

### 4.3 Add research rows (P2) — add the missing catch + labeled pending

Upload is already complete (LeftRail.tsx:77/79/81) — **leave it.** For `addRows()` only (Artifact.tsx:227–230):

```tsx
const addRows = async () => {
  setBusy(true); setPasteError(null);
  try {
    const n = await store.addResearchRows({ artifactId, rows: parsed });
    setPasteText(""); setPastePanelOpen(false);            // clear ONLY on success
  } catch (e) {
    setPasteError(humanize(e));                             // KEEP panel open + typed text
    // do NOT clear pasteText → user fixes & retries; avoids slug-collision double-insert loop
  } finally { setBusy(false); }
};
// Primary button: disabled while busy (already) + label "Adding…". Reuse upload's .r-upload-error CSS.
```
**Do NOT** build an optimistic skeleton/temp-id row — IDs + 13 enriched columns are server-authoritative (artifacts.ts:370–372,432); a skeleton would flicker-swap and risk discard-on-conflict.

### 4.4 Agent `/ask` affordance (P1) — converge onto the `/free` job model

Reuse, don't invent. Mirror `startFreeAuto` (agentJobs.ts:216): a mutation that inserts a queued job and `start()`s the workflow, returning `jobId` instantly.

```ts
// convex/agentJobs.ts — new entrypoint mirroring startFreeAuto
export const startPublicAsk = mutation({
  args: { roomId: v.id("rooms"), prompt: v.string(), idempotencyKey: v.string(), requester: actorProofV },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const jobId = await ctx.db.insert("agentJobs", {
      roomId: a.roomId, entrypoint: "public_ask", status: "queued",
      idempotencyKey: a.idempotencyKey, /* …mirror startFreeAuto fields… */ });
    await recordOperation(ctx, jobId, "queued");
    await ctx.scheduler.runAfter(0, internal.agentJobRunner.run, { jobId });  // return instantly
    return { jobId };
  },
});
```
```tsx
// store.tsx:337 — replace useAction(runRoomAgent) on the interactive path
const startPublicAsk = useMutation(api.agentJobs.startPublicAsk);
askAgent: async (prompt) => (await startPublicAsk({
  roomId: rid, prompt, idempotencyKey: crypto.randomUUID(), requester: proof })).jobId,
```
Then: (2) the `/ask` runner writes incrementally like `agentJobRunner` (per-slice `agentStepsRecord` + operation event, not just terminal writes at agent.ts:260/264/282); (3) replace the binary typing-dots (Chat.tsx:231–239) with the **existing** job-strip/step-trace component (Chat.tsx:179–226), keyed to the returned `jobId`, states queued → running(step N) → done/failed+retry. Keep the CAS + idempotency claim-or-reuse layer (agent.ts:69/130/160) **exactly as-is.** No optimistic overlay, no SSE, no per-token streaming.

---

## 5. `rooms.full` coupling caveat + granular-subscription migration

**Historical coupling.** At audit time, `store.tsx:299` routed the entire engine
through ONE `useQuery(api.rooms.full)`, and `rooms.full` read 6 tables in one
query. That was the property of the `rooms.full` shape, not of the choice to be
optimistic. Current code has moved to `rooms.meta` + per-artifact
`artifacts.elements`, with spreadsheet presence isolated in `presenceClaims`.

**Why it is NOT a P0 today (verified mitigants).** At audit time, `lastSeenAt`
was written at join but never patched afterward. Current spreadsheet presence
uses separate `api.presence.heartbeat` rows, so the old `members.lastSeenAt`
statement remains true but no longer means "no presence exists." Presence writes
must stay outside the artifact ledger/read-set.

**The smallest root-cause split (P1, behind triggers).**

1. **Carve elements out of `rooms.full`** into a per-artifact subscription — one `useQuery(api.artifacts.elements, { artifactId })` per **open** artifact, keyed by the existing `by_artifact` index. A cell edit then invalidates only that artifact's subscribers, and the optimistic `setQuery` targets that small object (the `applyCellEdit` body shrinks to a per-artifact `setQuery` with **no change to its optimism semantics**). Keep `members + locks + sessions + drafts + room` as a thin shared `rooms.meta` query (low per-room cardinality — splitting these further is gold-plating until measured). After the split, re-add the `getQuery(undefined)` early-return guard on the granular query so an un-loaded slice silently no-ops.
2. **Paginate `messages.list`** with `usePaginatedQuery` on the `by_room_channel` index (currently an unbounded `.collect()`, messages.ts:41) + Convex `insertAtTop`/`optimisticallySendMessage` so the optimistic send composes correctly. Pair with **list virtualization** in Chat.tsx:230 — pagination of the query without windowing the render still grows the DOM unbounded. *Cheap interim (do now):* add a defensive server cap — `.order("desc").take(200)` returning newest-N — to convert "unbounded forever" into "bounded window" in one line, plus a coarse metric (alert when any room+channel `collect()` returns > ~500 rows). Retention/archival is a **separate** decision; pagination bounds the live read-set, not storage.
3. **Do NOT** add per-visible-cell-window subscriptions yet — that is the next tier, not the necessary fix.

**Responsiveness-claim honesty (P2, docs-only — no harness).** ARCHITECTURE.md:159 should make the number a **mechanism** claim, not a literal SLA: change "~0ms, sub-frame" → "no server round-trip on local apply — sub-frame felt latency at small room size, via the single optimistic write path (`applyCellEdit`)", and add one caveat: "This holds while the room fits one `rooms.full` subscription; it degrades as element count / concurrent-editor echo grows, because each optimistic edit re-keys the whole-room object (store.tsx:325)." A bespoke perf harness is gold-plating for a pre-scale demo.

**Revisit triggers.** Escalate the **elements split** to P0/do-now when ANY of: (a) a single room exceeds ~2–3 concurrent editors OR an agent run is active while humans edit (agent write bursts across locks/sessions/drafts/elements then re-render all panels); (b) total elements per room exceed ~1–2k cells; (c) measured human edit-to-paint p95 under 2 editors exceeds ~50ms. Escalate **messages pagination** independently when any room+channel routinely exceeds ~500–1000 messages, or `kind:"agent"`/`"system"` traffic pushes a long-lived room past that, or initial-room-load payload becomes a noticeable fraction of room load, or chat scroll jank appears. Until then, the shared `rooms.meta` query + index-scoped `.collect()` with a defensive `.take()` cap is right-sized.

---

## 6. Testing strategy (route by root cause, not by surface)

There is **no browser/real-DOM E2E** today (no `playwright.config.ts`, no `data-testid` in `src/`; `convex-test` 0.0.53 is backend-in-memory only — no reactivity/optimism/UI; `vitest` 2.1.8, Browser Mode stable is vitest 4). Route the gap:

- **CLASS A — server-authoritative (push DOWN to `convex-test`, deterministic, cheap):** public/private channel leak (`requireActorCanUseChannel`/`requireActorProof`), job cancel/retry transitions, proposal accept/reject CAS effects. Add a **role × channel × op authorization matrix** in `convex-test` rather than driving these through a browser (~100× the flake/maintenance cost). Real API surface: `rooms.byCode`, `rooms.joinAnonymous`, `messages.send`, `agentJobs.startFreeAuto`, `artifacts.listProposals/resolveProposal/applyCellEdit`, `collab.traces`, `agentRuns.list`.
- **CLASS B — irreducible real-DOM + real-backend (P1, the headline-risk gap):** add a **thin Playwright + real-Convex** harness scoped to ~2 specs only:
  - **Spec A (anti-flicker):** client X optimistic cell edit renders instantly, server confirms, value persists with **no flicker/intermediate empty frame** (assert value stability across animation frames).
  - **Spec B (CAS-merge):** clients X and Y edit the same cell concurrently; the CAS loser's UI reverts to canonical value **without silent data-loss of the winner** and shows a non-silent failure affordance.
  - First commit of this slice: seed `data-testid` on the named surfaces (composer input, send button, message/trace row, proposal-card + accept/reject, post-it `.r-postit`, note editor, spreadsheet cell + `data-cell-key`, job-row) and a `data-state="pending|confirmed|failed"` on optimistic-write targets. **No `data-testid` without a consuming assertion** (dead markup is its own micro-over-engineering).
- **`qa:matrix:check` scope (P2, labeling discipline):** keep it drift-only (scripts/qa-matrix.ts:91–103); describe it everywhere as a **docs-sync / drift gate**, never "coverage" or "QA gate"; remove `qa:matrix:check` from the `qa_matrix_continuity` row's `deterministicChecks` (production-matrix.json:198–216) and add one assertion in `tests/qaMatrix.test.ts` that no "green" row cites `qa:matrix:check` as its primary deterministic check.

---

## 7. Ordered implementation checklist

### P0 — none
No crash/SSRF/false-data defect rises to P0 at current scale (verified mitigants in §5). The dangerous *latent* item (proposal silent-success on conflict) is fixed at P1 below.

### P1 — this session (correctness + honest-status + headline-risk)
1. **Chat send key + failure UX.** Key bubbles by `clientMsgId` (Chat.tsx:230); stop fire-and-forget at store.tsx:370 → track promise, render pending/failed + retry (re-send same `clientMsgId`). *(§3.1)*
2. **Note editor honest failure + re-sync.** Consume `EditFeedback` in the note `onBlur` (Artifact.tsx:588) → `setEditErrorMsg` on `!ok`; add unfocused-stale `setContent` re-sync (useEditor seeded once at 585). *(§3.2)*
3. **Proposal resolve honest failure.** Change store contract `Promise<void>` → discriminated `{ok,reason}` (store.tsx:105, return at 373); branch `decide` (Artifact.tsx:756–760) + aggregate `acceptAll` (719–726); keep card mounted until server confirm. *(§4.1)*
4. **Agent `/ask` convergence onto `/free` job model.** Add `agentJobs.startPublicAsk` mutation (mirror agentJobs.ts:216); switch store.tsx:337 from `useAction` → `useMutation`; per-slice writes in the runner; reuse job-strip (Chat.tsx:179–226). Precondition before merge: one browser smoke (`data-testid` job strip, queued→running→done). *(§4.4)*
5. **Browser E2E slice (Class B).** Playwright + real-Convex harness, seed `data-testid` + `data-state`, write Spec A (anti-flicker) + Spec B (CAS-merge two-context). Extend the `convex-test` authZ matrix (Class A) in the same session. *(§6)*

### P2 — same session if time, else next (right-sized polish + deferred structure)
6. **Message edit optimism.** `editMsg.withOptimisticUpdate` matching by `_id` across pub+private (store.tsx:333); `messages.update` returns `{ok,reason}` (messages.ts:50,52); revert+inline error on `!ok`. No spinner. *(§3.3)*
7. **Job cancel/retry triad.** Local in-flight `useState` + disabled + label in Chat.tsx:168/173; store wrappers return `{ok,reason}` (store.tsx:511–512); inline failure reusing the longJob.error span (Chat.tsx:185). *(§4.2)*
8. **Add-rows failure branch.** `try/catch` around `addRows()` (Artifact.tsx:227–230); keep panel open + typed text on error; "Adding…" label; reuse upload error CSS. Leave upload untouched. *(§4.3)*
9. **Post-it verification debt.** Playwright bounding-box smoke on drag release (no back-snap) + `data-testid` on `.r-postit`. No code change to the drag path. *(table)*
10. **Responsiveness-claim wording.** Two edits to ARCHITECTURE.md:159 (mechanism-bound claim + rooms.full caveat). No harness. *(§5)*
11. **`qa:matrix:check` labeling.** Docs-sync wording; drop self-reference from `qa_matrix_continuity`; add the green-row assertion to `tests/qaMatrix.test.ts`. *(§6)*
12. **`messages.list` defensive cap.** `.order("desc").take(200)` (messages.ts:41) + collect()-length metric. Full pagination + virtualization deferred to trigger. *(§5)*
13. **`rooms.full` elements split (deferred — execute when §5 trigger fires).** Per-artifact `artifacts.elements` query; thin `rooms.meta`; narrow optimistic `setQuery`; re-add undefined guard. *(§5)*
14. **Auto-allow toggle (deferred — execute when §2 trigger fires).** FLIP→SET redesign (rooms.ts:98–108), then `withOptimisticUpdate`. *(§3.4)*

---

### Convex 1.40.0 API quick-reference (used above)
- `useMutation(api.x).withOptimisticUpdate((localStore, args) => { … })` — synchronous handler; `localStore` results are **immutable**; match query refs by **exact name + args**.
- `localStore.getQuery(api.q, args)` / `setQuery(api.q, args, value)` / `getAllQueries(api.q)`.
- Paginated helpers (chat migration): `optimisticallyUpdateValueInPaginatedQuery`, `insertAtTop`, `insertAtPosition`, `insertAtBottomIfLoaded`, `optimisticallySendMessage`.
- Convex holds the optimistic value until **both** the mutation result **and** the consequent query update arrive, then performs an **atomic swap** — shape-match the echo for zero flicker.
- Actions (`useAction`) are **non-reactive, non-optimistic, no auto-retry** — schedule from a mutation (`ctx.scheduler.runAfter`) instead of running in the hot path.
