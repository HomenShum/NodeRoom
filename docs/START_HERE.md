# START HERE — one request, followed through the code

## Who this is for

You cloned this repository today. Nobody who built it is available. You need to
run it, follow one real user action from the button to the database write, change
something, and know which test tells you whether you broke it.

This file is in **runtime order**, not architecture order. Each step is a place
the request actually passes through, in the order it passes through it.

## The one action we follow

A person is closing a deal review. The numbers live in a shared spreadsheet that
their colleagues are also editing. They open the room, type
`@nodeagent recompute the Q3 variance column` into the chat, and press Send. An
AI assistant fills the variance cells while a colleague is still typing in the
next row, and afterwards every changed cell can say who changed it and why.

That one sentence — typed message to changed cell to visible receipt — is the
path below.

## Run it first

```bash
npm install
npm run dev                     # http://127.0.0.1:5260  (port set in vite.config.ts)
```

Open `/?mode=memory` and click **Try sample room** — the keyless landing CTA,
`data-testid="start-demo-room"` (`src/ui/Landing.tsx:146`; with a Convex URL set
the same button reads "Create a room" instead). With no `.env.local` the app
runs entirely in the browser against an in-memory engine with a scripted
assistant: no keys, no database, no network. That is the tier a stranger can
reach, and it is the tier every step below is written against. Where the live
tier (a Convex deployment plus a model key) takes a different branch, the step
says so.

---

## Step 1 — The page decides whether this visit needs the app at all

**File:** `src/landing/boot.ts`
**Symbol:** `start`
**Called by:** the module's own top-level route check, or the first
`pointerdown` / `keydown` / `scroll` on the marketing page
**Calls next:** `import("../app/main")`

**Why this exists**
`index.html` serves a static marketing page to everyone, including search
crawlers. The React workspace is a large download that a visitor who is only
reading the landing copy should never pay for. This file is the one place that
decides "this visitor is going into a room" and only then loads the app.

It also owns something easy to miss: **a failed load has to look different from a
slow one.** The boot shimmer lives inside `#root`, so the only thing that removes
it is React mounting. That gave "loading" one exit and "failed" none — a rejected
chunk import left the shimmer spinning forever under "Opening room".

**Core code**
```ts
const timer = window.setTimeout(() => {
  if (settled) return;
  settled = true;
  // A hung import never rejects, so a catch alone cannot cover this.
  markBootState("failed", "The workspace took too long to load. Reload to try again.");
}, BOOT_TIMEOUT_MS);

import("../app/main").then(/* ... */);
```

**Input** — `window.location.search` and `.hash`.
**Output** — either nothing (marketing visit) or a dynamic import of the app,
plus `data-boot-state="loading" | "failed"` on `.nr-ssr-private` so a human or an
automated checker can read the state out of the DOM.
**Failure behavior** — import rejection *or* a 20-second timeout both flip the
shell to `failed`, replace the progress rail with a message, and add one
**Reload** button. `started` is reset so a retry does not need a full reload.
**Next** — Step 2.

---

## Step 2 — React mounts, and the data source is chosen once

**File:** `src/app/main.tsx`
**Symbol:** module top level
**Called by:** `start()` in Step 1
**Calls next:** `App` in `src/ui/App.tsx`

**Why this exists**
This is the only place that knows whether this session talks to a real backend.
`VITE_CONVEX_URL` set means a live Convex deployment; unset means the in-browser
engine. Everything below this line is written against one interface and does not
branch on it again.

**Core code**
```tsx
const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const client = url ? new ConvexReactClient(url) : null;
// ...
<ErrorBoundary clearSessionPrefix="noderoom:">
  {client ? <ConvexProvider client={client}>{app}</ConvexProvider> : app}
</ErrorBoundary>
```

**Input** — build-time environment.
**Output** — a mounted React tree wrapped in an error boundary.
**Failure behavior** — any render-time throw below this point is caught by
`src/app/ErrorBoundary.tsx`, which clears `noderoom:`-prefixed session storage so
a corrupt cached room cannot re-crash the app on reload.
**Next** — Step 3.

---

## Step 3 — The user types and presses Send

**File:** `src/ui/Chat.tsx`
**Symbol:** `send`
**Called by:** the composer's Send button and its Enter handler
**Calls next:** `store.postMessage`, then `store.askAgent`

**Why this exists**
This is the primary user action. Two separate things happen here and it matters
that they are separate: the message is **posted to the room** (everyone sees it,
whether or not an assistant is involved), and *then* the text is inspected to see
whether it was addressed to the assistant.

**Core code**
```ts
const cid = crypto.randomUUID();
void store.postMessage({ roomId, channel, author: me, text: messageText, clientMsgId: cid, kind: "chat" })
  .then((fb) => { if (fb && !fb.ok) setFailedSends(/* ...keep a retry affordance... */); });

const publicNodeAgentRequest = !isPrivate ? parsePublicNodeAgentRequest(t) : null;
if (publicNodeAgentRequest) {
  beginThinking();
  void store.askAgent({ goal: publicNodeAgentRequest.goal, /* ... */ }).catch(/* ... */);
}
```

**Input** — the composer text, plus any artifact references the user attached
with `@`.
**Output** — a posted chat message with a client-generated id (`clientMsgId`,
which is how a retry is de-duplicated rather than double-posting), and
optionally an agent request.
**Failure behavior** — a failed post is *not* swallowed: it is pushed onto
`failedSends`, which renders a retry control, and the list is capped at
`MAX_FAILED_SENDS` so a long offline stretch cannot grow it without bound.
**Next** — Step 4.

---

## Step 4 — The text becomes a typed request, or nothing happens

**File:** `src/ui/Chat.tsx`
**Symbol:** `parsePublicNodeAgentRequest`
**Called by:** `send`
**Calls next:** `store.askAgent`

**Why this exists**
The assistant that can edit the shared sheet is **addressable only as a leading
`@nodeagent …` directive.** Mentioning it mid-sentence does not summon it. This
is the trust boundary: below this function a string has become a `goal` that the
agent runtime is allowed to act on, and everything above it is display text.

On the live tier the same request crosses a second, stronger boundary — the
Convex mutation `startPublicAsk` in `convex/agentJobs.ts`, whose argument
validators reject anything malformed before it reaches a queue, and whose
`requireActorProof` call checks that this browser is actually a member of this
room. Never trust the client-side parse alone; it exists to decide *intent*, not
*permission*.

**Core code**
```ts
export const startPublicAsk = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV, goal: v.string(), /* ... */ },
  handler: async (ctx, a) => {
    const requester = await requireActorProof(ctx, a.roomId, a.requester);
    /* ... */
  },
});
```

**Input** — raw composer text (client) / an untrusted RPC payload (server).
**Output** — `{ goal, forceFree? }` or `null` (client); a validated, authorised
job row (server).
**Failure behavior** — a non-directive message is just a chat message; nothing
runs. On the server an invalid argument or a non-member proof throws before any
job exists.
**Next** — Step 5.

---

## Step 5 — The request enters the agent runtime

**File:** `src/app/store.tsx`
**Symbol:** `askAgent` (two implementations, one interface)
**Called by:** `send` in Step 3
**Calls next:** `runAgent` in `src/nodeagent/core/runtime.ts`

**Why this exists**
`RoomStore` is the seam between the UI and its data source. Chat, the artifact
panel and the rails call `useStore()` and never touch the engine or Convex
directly. Two providers satisfy the same interface:

- `EngineStoreProvider` — the in-memory `RoomEngine`; `askAgent` builds
  `InMemoryRoomTools` and calls the agent loop **in the browser tab**, driven by
  a scripted model so it is deterministic and needs no key.
- `ConvexStoreProvider` — live; `askAgent` calls the `startPublicAsk` mutation
  and hands off to a durable server-side job.

**Core code** (in-memory branch)
```ts
const rt = new InMemoryRoomTools(engine, roomId, workbook.id, actor, pub.id);
const result = await runHarness({
  rt,
  goal: withReferenceContext(instruction, references),
  model: paced(scriptedModel(workbookAuditPlan({ /* ... */ })), 120),
  tools: ROOM_TOOLS,
  /* ... */
});
```

**Input** — `{ goal, references, modelSelection, contextArtifactId, disposition }`.
**Output** — in memory: the agent has run and the room has changed by the time
the promise settles. Live: a `jobId`, and the room changes arrive later through
the reactive subscription.
**Failure behavior** — the caller in Step 3 catches and renders
`buildAgentFailureNotice(...)`, which turns a provider error into a sentence a
non-engineer can act on rather than a stack trace.
**Next** — Step 6.

---

## Step 6 — The agent loop, and the tools it is allowed to call

**File:** `src/nodeagent/core/runtime.ts`
**Symbol:** `runAgent`
**Called by:** `askAgent` (browser) and `convex/agentJobRunner.ts` (server)
**Calls next:** each tool's `execute`, through the `RoomTools` port

**Why this exists**
One agent loop, two hosts. The loop never touches a database or a React state
setter — it talks to `RoomTools` (`src/nodeagent/core/types.ts`), and the host
supplies the implementation: `InMemoryRoomTools` in the browser,
`ConvexRoomTools` on the server. That is why the same run can be exercised by a
fast unit test and by production.

Tools are registered as plain data in one array, `ROOM_TOOLS`. A tool is a name,
a human-readable description the model actually reads, a Zod schema, and an
`execute` that forwards to the port. Adding a capability means adding an entry
here — not editing the loop.

**Core code**
```ts
export const ROOM_TOOLS: AgentTool[] = [
  /* ... */
  {
    name: "edit_cell",
    description: "Write an element value with optimistic concurrency control. baseVersion MUST be the version you last read …",
    schema: z.object({ elementId: z.string(), value: z.any(), baseVersion: z.coerce.number().int(), /* ... */ }),
    execute: (a, rt) => rt.editCell(a.elementId, a.value, a.baseVersion, a.artifactId, a.kind),
  },
];
```

**Input** — a goal, a model, a tool list, and budget limits (`maxSteps`,
`deadlineAt`, `spendLimits`, `journal`).
**Output** — an agent result plus a stream of trace events.
**Failure behavior** — budgets are enforced *inside* the loop: a run that hits
its wall-clock deadline, step cap or spend ceiling stops with a resumable handoff
instead of being killed mid-write. `journal` makes a retried slice replay a
completed step rather than re-calling (and re-billing) the model.
**Next** — Step 7.

---

## Step 7 — The write that refuses to clobber

**File:** `src/engine/roomEngine.ts`
**Symbol:** `RoomEngine.applyEdit`
**Called by:** `InMemoryRoomTools.editCell` (and its Convex twin
`convex/convexRoomTools.ts` against the `elements` table)
**Calls next:** nothing — this is where state changes

**Why this exists**
This is the product's whole promise in one function. Three gates run in order
before any value is written, and **every rejection is returned as data, never
thrown**, because the agent has to be able to read the rejection and retry.

1. **Lock** — a locked element is read-only for everyone except the holder.
2. **Review mode** — when a room has auto-allow off, an agent edit becomes a
   pending *proposal* for a human to approve, not a write.
3. **Compare-and-swap** — if the element's current version is not the
   `baseVersion` the writer last read, the write is rejected as a conflict and
   the current version is handed back.

**Core code**
```ts
// Optimistic concurrency: stale base → conflict (returned as data, never thrown).
if (el.version !== op.baseVersion) return { ok: false, reason: "conflict", expected: op.baseVersion, actual: el.version };
```

**Input** — `{ roomId, op: ChangeOp, actor }`, where `op` carries `opId`,
`elementId`, `value` and `baseVersion`.
**Output** — `{ ok: true, element, fromVersion, toVersion }` or an `ok: false`
with a machine-readable `reason` (`conflict` / `locked` / `pending_approval` /
`formula_protected` / `duplicate` / `not_found`).
**Failure behavior** — a repeated `opId` returns the prior result instead of
applying twice, so a network retry is safe. A rejected write leaves **no**
`edit_applied` trace entry, which is what makes the trace a record of what
actually happened rather than what was attempted.
**Next** — Step 8.

---

## Step 8 — Progress reaches the screen

**File:** `src/ui/Chat.tsx` (rendering) with `src/nodeagent/core/stream.ts`
(shaping)
**Symbol:** `buildUnifiedAgentStreamParts`
**Called by:** the store, from persisted stream events
**Calls next:** the chat message renderer

**Why this exists**
The user needs to see the assistant working, not a spinner that ends in a wall of
text. Model prose, tool calls and step boundaries arrive as separate events and
are merged into one ordered part list so a single message bubble can show
reasoning, a tool call, and the answer in the order they happened.

The two tiers differ here, and the difference is the reason the code looks the
way it does:

- **In memory**, the run happens in the tab; the engine emits and React re-renders.
- **Live**, `runAgent` is given `onTextDelta` and `onStreamEvent` hooks
  (`convex/agentJobRunner.ts`). Tokens stream over HTTP to the tab that asked,
  while `@convex-dev/persistent-text-streaming` persists sentence-flushed chunks
  so **every other tab, and the same tab after a refresh, still sees the reply**.

**Input** — trace and stream events from the run.
**Output** — ordered message parts on screen, plus trace rows in the room trace.
**Failure behavior** — a dropped stream does not lose the answer; the persisted
chunks are the source of truth and the subscription re-renders from them.
**Next** — Step 9.

---

## Step 9 — Failure and recovery

**File:** `src/ui/Chat.tsx`
**Symbol:** `buildAgentFailureNotice`
**Called by:** the `.catch(...)` on `store.askAgent` inside `send` (Step 3)
**Calls next:** nothing — it renders

**Why this exists**
This is the last stop on the request path, and it is a surface where a person
decides whether to trust the assistant. A stack trace here is a defect, not a
debug aid. The function turns a provider error into a sentence a non-engineer can
act on, and carries the context needed to reproduce: which model selection was
used, what was asked, whether it was the public or private agent, and which job
id.

**Core code**
```ts
}).catch((e) => {
  if (aliveRef.current) {
    setAgentErr(buildAgentFailureNotice(e, { selection: modelSelection, requestText: t, source: "public", jobId: longJob?.id }));
    setThinking(false);
  }
});
```

**Input** — the thrown error, plus the request context.
**Output** — a rendered failure notice; on the live tier the long-running job
also exposes `cancelJob` and `retryJob`.
**Failure behavior** — `aliveRef` guards the update, so a user who left the room
before the failure arrived does not get state written into a stale component.
**Next** — Step 10.

**The other three failures on this path**, each with its own owner:

| What fails | Where it is handled | What the user sees |
|---|---|---|
| App bundle never loads | `src/landing/boot.ts` — a 20s timeout *and* a rejection handler both set `data-boot-state="failed"` | "Could not open the room" and a **Reload** button |
| A render throws | `src/app/ErrorBoundary.tsx` — clears `noderoom:` session keys | An error surface, and a reload that is not poisoned by cached state |
| A chat post fails | `src/ui/Chat.tsx` — `failedSends` (capped at `MAX_FAILED_SENDS`), retried with the same `clientMsgId` | The message with a retry control; retry cannot double-post |

---

## Step 10 — The tests that prove this flow

**File:** `tests/noClobberWedge.test.ts`
**Symbol:** `describe("The no-clobber wedge: human + agent on the same live cell")`
**Called by:** `npm test`
**Calls next:** the real Convex functions, in-process, via `convex-test`

**Why this exists**
Steps 3 through 7 make one promise — a write never silently overwrites another —
and that promise is only meaningful if the whole beat is run in sequence with the
human's contested cell held throughout. The sub-parts are covered elsewhere; this
is the sequence.

**Core code** (the beats, from the file's own header)
```
BEAT 1  human edits the contested cell C2
BEAT 2  agent's write to C2 carries a STALE baseVersion -> CAS REJECTS it
BEAT 3  in review mode that edit becomes a proposal; approval RE-RUNS CAS
TRACE   the rejected clobber left NO edit_applied trace
```

**Input** — a seeded room in the in-process Convex deployment.
**Output** — pass/fail. No deployment, no key, no network.
**Failure behavior** — if this goes red after a change to the write path, stop
and read `docs/codebase/CONCERNS.md` before continuing.
**Next** — nothing; this is the end of the path.

**The rest of the suite that holds this flow:**

| Test | What it pins |
|---|---|
| `tests/roomEngine.test.ts`, `tests/roomEngineAtomicEdits.test.ts` | Step 7's gates directly — conflict, lock, duplicate `opId`, atomic bundles |
| `tests/agentRuntime.test.ts`, `tests/agentReliability.test.ts` | Step 6: budgets, handoffs, journal replay, tool-failure handling |
| `tests/demoRoomChatOrder.test.ts` | Step 3's ordering: the seeded transcript must sort before anything a visitor sends, at any hour |
| `tests/buildProvenance.test.ts` | Step 1's shipped HTML carries the commit it was built from |
| `e2e/human-agent-concurrency.spec.ts` | The same story in a real browser, with a human and the agent editing at once |

**Before you trust a green run:** `npm test` currently exits **1** on this commit,
with two pre-existing failures that are not yours. `docs/codebase/CONCERNS.md`
names them and explains why one of them is a gate doing its job.

---

## Where you would add one adjacent capability

**A new thing the assistant can do** (say, "export this sheet to PDF"): add one
entry to `ROOM_TOOLS` in `src/nodeagent/skills/spreadsheet/cellMutator.ts`, add
the matching method to the `RoomTools` interface in
`src/nodeagent/core/types.ts`, then implement it twice — once in
`src/nodeagent/skills/integration/noderoomAdapter.ts` (memory) and once in
`convex/convexRoomTools.ts` (live). The loop in `runtime.ts` does not change.
Prove it with a test next to `tests/agentRuntime.test.ts`.

**A new surface in the room**: it consumes `useStore()`; it does not import
`RoomEngine` or `convex/api` directly. That rule is what keeps both tiers
working, and `src/design/uiLayerPolicy.ts` enforces the related rule for UI
primitives.

## Then read

- `docs/codebase/ARCHITECTURE.md` — the two tiers and why they exist
- `docs/codebase/CONCERNS.md` — what is known to be wrong right now
- `docs/SIMPLIFICATION_REPORT.md` — what this pass deleted and what it measured
- `.tours/` — the same walk, clickable, in VS Code with the CodeTour extension
