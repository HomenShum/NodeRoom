# Live Collaboration Sequences

This is the detailed runtime map behind the README architecture diagram. The
short version: NodeRoom treats Convex as the room source of truth, not the
browser. Human edits can paint optimistically, but durable state changes go
through Convex mutations; NodeAgent actions call providers and tools, then write
through the same checked mutation path as humans.

## Current Production Shape

```mermaid
sequenceDiagram
  autonumber
  participant Host as "Host browser"
  participant Peer as "Peer browser"
  participant Store as "React useStore"
  participant Queries as "Convex reactive queries"
  participant Mutations as "Convex mutations"
  participant Action as "NodeAgent action"
  participant Workflow as "Workflow / Workpool continuation"
  participant Provider as "LLM provider"
  participant DB as "Convex DB"

  Host->>Queries: subscribe rooms.meta, artifact elements, presence, messages, agentJobs, attempts
  Peer->>Queries: subscribe same room with member proof
  Queries->>DB: read room shell, artifacts, scoped elements, presence claims, locks, proposals, traces
  DB-->>Queries: initial snapshot
  Queries-->>Host: render shared files, sheet, note, wall, trace
  Queries-->>Peer: render same authorized state

  Host->>Store: edit cell locally
  Store-->>Host: optimistic paint
  Store->>Mutations: presence.heartbeat(target cell, focus/edit)
  Mutations->>DB: upsert advisory TTL-bound presence claim
  DB-->>Queries: presence invalidation only
  Queries-->>Peer: show colored cell/name flag without disabling edit
  Store->>Mutations: artifacts.applyCellEdit(elementId, baseVersion, value)
  Mutations->>DB: check member proof, lock, CAS version
  alt lock free and version current
    Mutations->>DB: write element, increment version, receipt
    DB-->>Queries: reactive invalidation
    Queries-->>Host: confirmed canonical state
    Queries-->>Peer: same edit streams live
  else locked or stale version
    Mutations-->>Store: locked/conflict as data
    Store-->>Host: show proposal/conflict path, no silent overwrite
  end

  Host->>Mutations: messages.send("/ask reconcile Q3 revenue")
  Mutations->>DB: append public message
  Host->>Mutations: agentJobs.start(entrypoint=public_ask, routePolicy=fast_default)
  Mutations->>DB: create durable job root, policy fields, operation event
  Mutations->>Workflow: start shared sliced workflow
  Workflow->>Action: run bounded job slice
  Action->>DB: claimSlice(jobId, leaseId)
  Action->>DB: query room context through Convex
  Action->>Action: fence untrusted room data, compact context
  Action->>DB: check agentModelStepJournal(sliceKey, step)
  alt journal miss
    Action->>Provider: model call with tools and bounded budget
    Provider-->>Action: assistant text and tool calls
    Action->>DB: record model-step journal
  else journal hit
    DB-->>Action: replay stored model output
  end

  Action->>Mutations: tool: propose_lock / read_range / edit_cell / release_lock
  Mutations->>DB: permission, schema, lock, CAS, evidence checks
  alt auto-allow on and write is safe
    Mutations->>DB: commit artifact element + trace receipt
  else review required or blocked
    Mutations->>DB: create proposal or draft operation
  end
  DB-->>Queries: stream artifact, proposal, trace, job updates
  Queries-->>Host: inline chips, trace, status
  Queries-->>Peer: same public evidence, private data redacted

  alt slice finishes the job
    Action->>Mutations: agentJobs.finishSlice(completed)
    Mutations->>DB: final run, steps, counters, cost, release lease
  else time or step budget hit
    Action->>Mutations: agentJobs.finishSlice(handoff, cursor, nextRunAt)
    Mutations->>DB: checkpoint cursor and release lease
    Workflow->>Action: run next bounded slice later
    Action->>DB: hydrate cursor and continue from journaled state
  end
```

The continuation workflow is historically named `freeAutoWorkflow`, because it
started as the `/free` runner. In current code it is the shared durable workflow
for `/ask`, `/free`, research, collaboration, and top-model jobs. The job row's
route/model/approval/evidence policies decide behavior; workflow ids are runtime
metadata.

## Provider File And Evidence Flow

```mermaid
sequenceDiagram
  autonumber
  participant User as "User"
  participant UI as "Room UI"
  participant Storage as "Convex File Storage"
  participant Artifacts as "NodeRoom artifacts"
  participant Adapter as "Provider parser adapter"
  participant Provider as "Gemini / OpenAI / Claude / OpenRouter"
  participant DB as "Convex DB"

  User->>UI: upload spreadsheet, PDF, DOCX, PPTX, image, or screenshot
  UI->>Storage: store raw file first
  Storage-->>UI: raw Convex file id
  UI->>Artifacts: create durable file/artifact row
  Artifacts->>DB: room-visible file metadata and permissions
  Adapter->>Storage: read raw file when policy allows
  Adapter->>Provider: upload/cache provider file or inline multimodal input
  Provider-->>Adapter: extracted text, layout, tables, boxes, citations
  Adapter->>DB: write provider file id as cache metadata only
  Adapter->>Artifacts: write CellPayload/evidence objects
  Artifacts->>DB: source artifact id, page/sheet/row/box, confidence, value
```

Raw Convex file ids and NodeRoom artifact ids are durable. Provider file ids are
cache handles that can expire or be rebuilt. Mixing those identities would break
permissions, retention, and provenance.

## Why Not Keep The Client-Side GraphStore Pattern?

The old client-side GraphStore shape was useful for a single browser: a server
streamed `client_action` events over SSE, and the browser's in-memory store
executed local CRUD. In a shared room, that creates drift: one user's browser
becomes the hidden source of truth while other users subscribe to stale or
reconstructed state.

NodeRoom keeps the domain lessons from GraphStore but moves the durable
business logic into Convex mutations:

```text
legacy client_action event
  -> NodeAgent tool proposal
  -> permission + schema + version + lock check
  -> Convex mutation or draft operation
  -> mutation receipt + trace + reactive query update
```

## Architecture Choices Compared

| Architecture | Best fit | What breaks for NodeRoom | NodeRoom choice |
|---|---|---|---|
| Client-side SSE + in-memory GraphStore | Single-user document builders, demos, local-first prototypes | Other users cannot trust or observe the same state; retries can replay client actions differently; provider/tool work is hard to audit | Keep only as historical reference and import/eval compatibility label |
| REST CRUD + polling | Simple admin panels, low-collaboration apps | Poor live collaboration feel, higher stale-read risk, extra polling state, weak room trace continuity | Use Convex reactive queries instead |
| CRDT/local-first document | Rich offline text/canvas editing with peer merges | Great for text shapes, weaker for evidence-bearing finance/GTM operations that require server-side provider calls, spend limits, role checks, and audit trails | Could complement future rich notes; not the current source of truth |
| Queue worker fleet | Heavy parsing, ETL, exports, batch enrichment | Strong for throughput, but adds separate auth, progress, and result streaming layers | Use workers for local parser/OCR lanes when needed; keep `agentJobs` as the user-facing root |
| Convex action + mutation + Workflow/Workpool | Multi-user rooms with reactive state, server-side tools, transactional writes, durable continuations | Requires discipline: actions cannot be the source of truth; every side effect needs a mutation receipt and idempotency story | Current production shape |

## Readiness Gate

This diagram is not itself proof. The corresponding gates are:

- deterministic runtime tests for CAS, locks, drafts, idempotency, journals, and
  privacy;
- browser E2E for public/private chat, files, spreadsheet, wall, proposals, and
  multi-user state;
- live provider ladders before a model is promoted to interactive collaboration;
- live Convex smoke for `/ask`, `/free`, workflow continuation, and parser/file
  adapters;
- Gemini media review for the actual GIF/MP4 evidence shown in the README.

The open production gaps remain tracked in
[`GAPS_NOT_DONE.md`](GAPS_NOT_DONE.md); this page is the sequence map those gaps
must satisfy.
