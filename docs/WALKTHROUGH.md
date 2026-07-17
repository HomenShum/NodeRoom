# NodeRoom — codebase walkthrough (interview prep)

> Historical lock-lane walkthrough. It is still useful for explaining CAS,
> drafts, and smart-merge, but it should not be used as the current product
> target for fast human+agent coediting. The current direction is advisory
> presence/intent, branch or patch-bundle work, a short exact-target publish
> lease, final CAS, and CRS/proposals only on meaningful conflict. See
> [architecture/REALTIME_HUMAN_AGENT_COEDITING.md](architecture/REALTIME_HUMAN_AGENT_COEDITING.md).

A guided tour of the most important entry points, mapped 1:1 to the 8 features you
asked for. Use it to walk an interviewer through the code top-to-bottom. The
headline is **point 8** (the CAS + draft/proposal collaboration model); the
rest is the frame around it.

> **One-liner:** *A live room where humans and two NodeAgents (a public room agent
> and your private one) edit shared spreadsheet/notebook/wall surfaces. Every committed
> edit carries a version (CAS); presence and agent intent are advisory; blocked or
> stale agent work becomes a draft or proposal; and committed work is never silently
> clobbered. All of it is in a per-room trace log.*

## The fastest demo path (90 seconds)

1. **Landing** → "Enter as Priya". You're in the room (1 panel: public chat).
2. Top-right toggles: open **Artifact** (2 panels) → **Private Agent** (3) → **Files · People** (4).
3. Hit **▶ Run demo**. In this legacy proof lane, the Room Agent posts a
   `propose_lock` chip and the runway cells hatch out; Priya's private agent
   reads them as context and posts a `create_draft` chip; the Room Agent edits +
   `release_lock`; the **trace log** shows `draft_merged`. For current product
   coediting, teach the presence/intent + patch-bundle flow instead.
4. Flip **Auto-allow OFF**, edit a cell as an agent → it becomes a **proposal** you
   approve/reject in the trace panel.

## Where the truth lives

> The whole collaboration model is one pure, tested module:
> **[`src/engine/roomEngine.ts`](../src/engine/roomEngine.ts)** + **[`merge.ts`](../src/engine/merge.ts)** + **[`types.ts`](../src/engine/types.ts)**.
> The UI just renders it; the Convex schema ([`convex/schema.ts`](../convex/schema.ts)) is the same shapes for production.
> Prove it with `npm run demo` (CLI) and `npm test` (12 scenarios).

---

## The 8 points → entry points

### 1. NodeAgent UI (akin to scratchnode.live)
- **Entry:** [`src/ui/Landing.tsx`](../src/ui/Landing.tsx) → [`src/ui/App.tsx`](../src/ui/App.tsx)
- The landing (design DNA: `#151413` + terracotta `#d97757`, Manrope/JetBrains Mono) offers
  three ways in: enter the seeded demo room, create a room, or join by code.
- **Say:** "Same visual language as the NodeBench/ScratchNode lineage; the app is a single
  `App` that flips between Landing and RoomShell."

### 2. Room creation
- **Entry:** [`RoomEngine.createRoom`](../src/engine/roomEngine.ts) ← `createFreshRoom` in [`src/app/roomStore.ts`](../src/app/roomStore.ts)
- A room gets a short, human-readable `code` (the join key), a `hostId`, and an `autoAllow`
  flag. Creating a room seeds a starter sheet/note/wall.
- **Say:** "Room is the unit of everything — members, artifacts, locks, drafts, traces all
  key off `roomId`."

### 3. Host create + authenticated room join
- **Entry:** [`RoomEngine.joinRoom`](../src/engine/roomEngine.ts) ← `joinRoomByCode` in `roomStore.ts`
- `joinRoom({ code, name })` looks up the live room by `code`. Production first requires
  Convex Auth, then binds the member row to that account and the room-scoped token.
- **Say:** "The room code identifies the workspace; authentication identifies the person.
  Production requires both, while the in-memory harness can still model token-only guests."

### 4. Public chat + room NodeAgent (center)
- **Entry:** [`src/ui/Chat.tsx`](../src/ui/Chat.tsx) with `channel="public"`; messages via [`RoomEngine.postMessage`](../src/engine/roomEngine.ts)
- The public feed is **custom** (not assistant-ui) on purpose: assistant-ui's thread model is
  1:1 user↔assistant, so a multi-author room is off-label. The room agent posts with
  `kind: "agent"` and `toolParts` chips.
- **Say:** "This is the call I'd defend in the interview — use a custom Convex-reactive feed
  for the multi-author room, and reserve assistant-ui's `ExternalStoreRuntime` for the 1:1
  /ask thread (which I already built in the sibling `NodeAgent` repo)."

### 5. Center artifact panel (spreadsheet / note / post-it wall)
- **Entry:** [`src/ui/panels/Artifact.tsx`](../src/ui/panels/Artifact.tsx) (tabs + `Sheet`/`Note`/`Wall`)
- All three artifacts share ONE model: an artifact is a bag of **elements** (`{ id, version,
  value }`). A cell, a note block, and a sticky are all elements — so locks/CAS/drafts/merge
  are one generic mechanism, not three. Edits commit through `commit()` → `RoomEngine.applyEdit`.
- **Say:** "The uniform element model is the design decision that makes the hard part (point 8)
  generic. Grids use cell-CAS; rich-text prose would need OT/CRDT — that's the honest boundary."

### 6. Three panels (+ private NodeAgent right)
- **Entry:** the `right` panel in [`src/ui/RoomShell.tsx`](../src/ui/RoomShell.tsx) → `Chat` with a private channel
- The private agent is a separate **channel** (`{ private: ownerId }`), so its messages are
  scoped to one user. It replies with awareness of the room's locks.
- **Say:** "Public vs private is a channel discriminator on the message; the engine keeps them
  separate (there's a test for it)."

### 7. Four panels (+ files/people left rail)
- **Entry:** [`src/ui/LeftRail.tsx`](../src/ui/LeftRail.tsx); layout in `RoomShell` (`.rail / .center / .right`)
- Files = artifacts; People = members + **agent sessions** with a live status (idle / working /
  blocked / drafting / done). The "N PANELS" badge counts open panels (1→4).
- **Say:** "The panel layout is pure flex; the interesting part of the rail is the agent
  sessions — that's the UI of cross-agent awareness."

### 8. The collaboration model — CAS + advisory coordination + smart-merge (the headline)
This is five mechanisms; here's each, with its entry point:

| Mechanism | Entry point | What to say |
|---|---|---|
| **Per-element CAS** | `applyOpInternal` (version check → `{ok:false, conflict, expected, actual}` returned as **data**, never thrown) | "Convex's internal OCC alone does NOT stop a stale-base clobber — two writers on v1 both succeed (last-writer-wins). The app-level `version` + CAS is what does." |
| **Legacy lock tool** | `proposeLock` / `lockFor` / `releaseLock` | "The legacy proof lane can claim an affected range and make it read-only for non-holders; current coedit target keeps human editing open and uses advisory intent plus short publish leases." |
| **Cross-agent awareness** | `awareness(roomId, excludeAgentId)` | "Before acting, an agent sees others' active locks + sessions + the recent trace tail — that's the input to its 'don't step on each other' reasoning." |
| **Draft for merge** | `createDraft` (a blocked agent's proposed ops, tagged `blockedByLockId`) | "Blocked agent reads the locked range, reasons around it, and queues a draft instead of waiting." |
| **Smart-merge on unlock** | `releaseLock` → `mergeDraft` → `resolver` in [`merge.ts`](../src/engine/merge.ts) | "On release, the draft resolves: ops on untouched elements apply cleanly; ops that diverged from committed work are flagged for review — committed work is **never** clobbered. The deterministic resolver ships here; a real LLM resolver implements the same `SmartResolver` signature." |

- **Auto-allow** (`toggleAutoAllow`): when OFF, agent edits become **proposals** (`resolveProposal`)
  surfaced in the trace panel; humans always apply directly.
- **Traces** (`trace` / `listTraces`): every lock/edit/draft/merge/agent-status is appended per
  room — the audit log and the live debugger in one.

**The closing line:** *"An AI agent edits the same server-authoritative cells as a human, through
the same versioned CAS and the same lock tool — so when it collides with a human's edit it gets a
`version_conflict` back as a tool error, re-reads, and retries instead of overwriting a controller's
number. I proved the no-clobber invariant with engine tests."*

---

## How to extend it to production (the next 8 hours)

1. **Port `RoomEngine` → Convex mutations/queries** (shapes already in `convex/schema.ts`).
   `applyEdit` → `applyCellEdit` mutation; `mergeDraft` → an action that calls the LLM resolver.
2. **Wire the private /ask agent to `@assistant-ui/react`** via `ExternalStoreRuntime` (the
   `NodeAgent` repo already has the Thread + tool UIs).
3. **Run the agents in a Convex `"use node"` action** with the custom `runAgent` loop (`src/nodeagent/core/runtime.ts`) on the AI SDK; tools
   = `read_range` / `propose_lock` / `edit` / `create_draft`; conflicts come back as tool errors.
4. **Idempotency** is already modeled (`opId`, `clientMsgId`); add Convex `unique()`-then-insert.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full data flow and the latency budget.
