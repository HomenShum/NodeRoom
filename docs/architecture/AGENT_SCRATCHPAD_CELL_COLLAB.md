# Agent scratchpad & cell-level collaboration — the design

How a human typing in `C2` and an agent working `A1:C5` coexist without clobber, without the agent
reasoning over unaudited keystrokes, and without inventing architecture the repo doesn't have.
This is the canonical design for the **scratchpad seam**: the boundary between browser-local
uncommitted state and the versioned, auditable state agents may reason over.

Every original contract claim below was verified against the code on 2026-06-11
(file:line cited). Update 2026-06-20: the per-cell spreadsheet presence slice
and server-side agent intent heartbeat have since shipped as bounded advisory
`presenceClaims`; the remaining target is plan-time affected sets plus
patch-bundle publish, not human cell presence itself.

## Prior art

- Internal critique doc (2026-06-10) correcting an earlier whiteboard architecture — this design
  encodes its conclusions
- `convex/artifacts.ts`, `convex/locks.ts`, `convex/drafts.ts`, `convex/schema.ts` — the existing
  contract this design must not contradict
- Anthropic "Building Effective Agents" — scratchpad as working memory (`.claude/rules/scratchpad_first.md`)
- Google Docs suggesting-mode — the promote-on-explicit-action model for uncommitted text

---

## 1. The non-negotiable substrate (verified, not aspirational)

| Contract | Where it lives | Verified wording |
|---|---|---|
| **App-level CAS, not Convex OCC, is the no-clobber guarantee** | `convex/artifacts.ts:4-8` | "`applyCellEdit` is the single most important function in the whole system… Convex's built-in OCC will RETRY a transaction that loses a write race, but it will happily commit a write whose BASELINE is stale — that's the clobber. The `version` check rejects a stale write and returns the conflict as DATA" |
| **Elements are the persistence unit; spreadsheet tables are context layers** | `convex/schema.ts:521-551` | `artifacts`+`elements` carry version/CAS; `spreadsheetCells` / `spreadsheetChunks` / `spreadsheetDependencies` are coordinate/semantic indexes, not the mutation ledger |
| **Locks are dependency-expanded, not geometric** | `convex/locks.ts:4-7` | "the range is expanded through formula dependencies before the lock is granted, so a write to a driver cell also protects downstream formula cells" — the grant trace records "expanded to […] via spreadsheet dependencies" |
| **Drafts smart-merge without clobber** | `convex/drafts.ts:6-8` | "clean-apply if the element is still at the drafted baseline, no-op if it already holds the value, and FLAG-don't-apply if it diverged" |
| **Jobs already carry the policy surface** | `convex/schema.ts:36-37,221` | `approvalPolicy: read_only \| draft_first \| auto_commit_safe \| host_review` · `evidencePolicy: public_only \| private_allowed \| mixed_requires_redaction` · `idempotencyKey` · `agentLeases` with `targetKind/targetId/mode/status/expiresAt` |
| **Token streaming is a MESSAGE lane, not a cell lane** | `package.json` + `convex/streaming` usage | `@convex-dev/persistent-text-streaming` drives private NodeAgent replies; cells get **evidence-bearing `CellPayload` commits** (value, status, evidence[], confidence — `src/engine/types.ts:73-83`) through CAS |

**Explicitly NOT in this stack (and not to be invented in docs or interviews):** WebRTC data
channels, Yjs/CRDT grids, custom `streamChunks` cell tables. Convex reactive `useQuery` +
server-led mutations is the proven sync; the bounded presence lane is auxiliary
coordination metadata, never the source of truth.

## 2. The scratchpad contract — three classes of state

```
Class A — browser-local, uncommitted   (the input the human is typing in C2)
  • Renders instantly in THAT user's UI. Exists nowhere else.
  • Has passed NOTHING: no actor proof, no CAS, no trace, no privacy policy.
  • Agents NEVER read it. It is not state; it is intent-in-progress.

Class B — committed elements           (element {id, version, value} via applyCellEdit)
  • The only state agents reason over. Versioned, receipted, traced.

Class C — coordination metadata        (locks + holders, drafts, proposals, presence)
  • Agents read it to PLAN (wait / draft / propose / write elsewhere),
    never as a substitute for Class B values.
```

The policy, verbatim (the centerpiece of this design):

```
If human is actively editing C2:
  - UI may show local uncommitted text immediately.
  - Agent may read last committed C2 + lock/presence metadata.
  - Agent may wait, draft, or produce a proposal.
  - Agent should not treat browser-local keystrokes as authoritative unless
    the user explicitly snapshots/commits them.
```

**Promotion is explicit.** The ONLY ways Class A becomes Class B: the user commits (Enter/blur →
`applyCellEdit` with `baseVersion`) or explicitly snapshots ("share my draft with the agent" —
a deliberate action that routes through the same proof-checked mutation). Hot-swapping a live
keystroke buffer into an agent's context is forbidden: the agent would be reasoning over data
outside actor proof, CAS, trace, and privacy policy — an unauditable reasoning record.

## 3. Affected-set algebra (why "skip C2" is too shallow)

A write to `C2` can change formulas outside `A1:C5`; a formula inside `A1:C5` can depend on cells
outside it. The overlap question is never geometric. Before an agent job touches a sheet:

```
affectedSet = intendedReadSet
            ∪ intendedWriteSet
            ∪ formulaDependencyClosure(writeSet)     // spreadsheetDependencies, both directions
            ∪ evidence/wiki/report targets the job will update
            ∪ currently locked elements (lock holders + expiries)
            ∪ active presence / intent claims
            ∪ elements with pending proposals/drafts
```

Only after this expansion does the job choose its mode: **lock** (write lease over the closure),
**draft** (blocked by someone's lock), **proposal** (room is in review mode / policy says
host_review), **wait** (human-active on a required cell), or **CAS-commit** (clear).
`convex/locks.ts` already implements the closure expansion at grant time; the TO-BUILD piece is
running the same expansion at PLAN time and persisting it on the job (§5).

## 4. The C2 / A1:C5 walkthrough (the canonical sequence)

```
1. Human starts editing C2.
   Their UI shows the keystrokes (Class A). Committed C2 (Class B) is unchanged.

2. Agent job starts over A1:C5.
   Planner computes the expanded affected set (dependency closure included).

3. Agent only READS → reads committed values + versions + lock flags.
   With the shipped presence lane (§5), C2 is annotated "human-active — possibly stale".
   The agent's scratchpad records that annotation as PROVENANCE, not as a value.

4. Agent intends WRITES overlapping the affected set →
   acquire the dependency-expanded lock, or go draft/proposal mode.

5. C2 is human-active → the agent does not write C2. It may:
   wait | produce a proposal for C2 | draft the blocked op | CAS-commit non-overlapping cells.

6. Every commit checks baseVersion. Conflict returns AS DATA ({reason:"conflict", actual}) —
   the agent re-reads, rebases, or escalates to review. Receipts + traces record
   before/after versions and affected ids.
```

The human's eventual Enter on C2 is itself a CAS write: if the agent legitimately committed C2
first (no lock, no presence), the human gets the same honest conflict-as-data path — symmetric,
no actor is privileged.

## 5. Shipped slice and remaining gaps (honest register)

| Area | What it is | Status / notes |
|---|---|---|
| **Per-cell presence** | Bounded `presenceClaims` rows keyed by room/artifact/target/actor with TTL and focus/edit modes | **SHIPPED 2026-06-20** for spreadsheet cells. Presence is advisory metadata (Class C), never a lock and never part of `art.elements`. |
| **Server-side agent intent** | Internal-only `agent_intent` / `commit_lease` claims published by authenticated agent sessions | **SHIPPED 2026-06-20** on the normal RoomTools cell-write path and in the host-gated live conflict/proposal proof. `commit_lease` is advisory presence, not a fencing token. |
| **Plan-time affected-set** | `computeAffectedSet(job)` running the §3 algebra before the first tool call; persisted on `agentJobs` as `intendedReadSet/intendedWriteSet/expandedAffectedSet` | The closure code exists at lock-grant time; reuse it at plan time. Bounded (cap closure size; BOUND rule). |
| **Explicit snapshot action** | "Share draft with agent" — promotes Class A→B via the normal proof-checked mutation, marked `status: needs_review` | The only sanctioned uncommitted-text path. |
| **Presence-aware grid render** | Editing cell outlined in the editor's member color + name flag | **SHIPPED** in the Q3 sheet and Excel grid renderers. |
| **Two-context browser E2E** | Real two-browser spec: assert presence is visible and non-blocking while another user edits | **PARTIAL SHIPPED** in `e2e/realtime-presence.spec.ts` plus `e2e/live-broad-convex.spec.ts` for scripted server-owned agent-intent conflict/proposal proof. Normal real-provider agent intent remains covered by `test:product:live:agent --strict-review`. |

## 6. Anti-patterns (each rejected for a verified reason)

- **"Convex OCC makes collaboration safe"** — OCC retries commit stale baselines (`artifacts.ts:4-8`). CAS is the guarantee.
- **WebRTC/Yjs as the truth lane** — not in the stack; would bypass proof/CAS/trace/privacy.
- **Token-streaming authoritative cell values** — cells are evidence-bearing commits; streaming is for the message lane. A finance cell's job is citation + status, not typing animation.
- **Geometric overlap planning** — formulas make the blast radius non-rectangular; use the closure.
- **Agent reading the live keystroke buffer** — unaudited state in a reasoning record.
- **Literal "Google Sheets/Figma parity" claims**:
  claim only scoped Google Sheets/Figma-style live coediting primitive parity
  when live gates are green: multi-browser Convex state, non-blocking presence,
  advisory server-owned agent intent/commit-lease indicators, final CAS, and
  CRS/proposal fallback. Do not claim full Sheets formulas/charts, offline
  history, permissions, or full Figma canvas/vector/branching parity.

## 7. Eval gates before any new claim

1. Scripted: affected-set planner unit tests (closure correctness, caps).
2. Scripted ladder rung: human-active-C2 scenario (wait/draft/proposal each asserted).
3. Live: two-context browser E2E for agent intent + conflict/proposal flows
   beyond the shipped presence slice.
4. Walkthrough GIF/video of the C2/A1:C5 dance through the real UI, gated by the
   Gemini media judge.
