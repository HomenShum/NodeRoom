# Notebook × NodeAgent Transformation Spec

Source research: 4-mapper + 2-designer workflow over this repo plus a
comparative study of a production graph-outliner notebook (2026-07-03). This
document is the merged, decision-complete spec.

## Implementation status (2026-07-03, this branch)

Shipped in this change (Steps 0–6 of the migration plan, condensed):

- **Step 0 — seeding fix**: `ensureNotebookDocCore` (convex/prosemirror.ts) seeds
  the synced doc from legacy `elements["doc"]` HTML via `src/notebook/seed.ts`;
  a `notebook_seeded_from_legacy` trace records it. Flag-flip no longer orphans
  content. Proven by tests/notebookAgentOutline.test.ts.
- **Step 1 — shared schema**: `src/notebook/extensions.ts` (StarterKit +
  UniqueID `blockId` + attribution attrs authorKind/runId/status/agentRoot),
  adopted by SyncedEditorInner AND the legacy Note editor (Artifact.tsx).
- **Steps 2+3 — read vertical + read-model v2**: `read_notebook` tool →
  `ConvexRoomTools.readNotebook` → `notebookAgent.readNotebookForAgent`
  (internal query, snapshot+steps replay); `extractReadModel` now prefers
  `attrs.blockId` (processor v2) so claims/mentions survive edits.
- **Steps 4+5 — engine + the /parse port**: pure `src/notebook/blockOps.ts`
  (caps, merge dedupe, honesty downgrade, exactly-once sentinel) +
  `append_notebook_outline` → `notebookAgent.applyOutlineByAgent`
  (prosemirrorSync.transform spine: anchor-in-fn, no_such_block-as-data,
  review-mode proposal via doc:agent, artifact-version bump, trace, receipt,
  dirty-event read-model refresh, elements["doc"] checkpoint mirror).
- **Step 6 — memory parity**: `InMemoryRoomTools.readNotebook/applyNotebookOutline`
  over legacy HTML (honest `legacy_doc` lane); `buildNoteContext` v2 advertises
  the block protocol when the port exists, legacy contract otherwise.
- Provider schemas (convexModel.ts) + regenerated AGENT_READY_API docs.

Second increment (this branch) — remaining pick-ups shipped:

- **`update_notebook_block`** (tool + `applyBlockEditByAgent`): hash-anchored
  CAS on ONE block; `replace`/`append_children` require agent authorship
  (`human_block_protected` steers to `annotate`, which adds an attributed
  aside after ANY block without touching it); stale hash → `block_conflict`
  with the fresh text+hash as DATA. Effects go through the shared
  `notebookWriteEffects` helper (version bump, trace, mirror, coalesced dirty
  event, receipt).
- **`plan_notebook_enrichment`** (tool + read-only internal query): deduped,
  capped (≤8) entity-mention targets with `hasExistingEnrichment`; enrichment
  itself runs through the research tools + anchored outline appends.
- **Trace Lens**: `[data-blockid]` now resolves inside the notebook surface
  (`targetRef: notebook_block:{id}`); the note editors carry
  `data-noderoom-surface="workSurface.notebook"` + `data-artifact-id`.
- **Presence overlay**: `NotebookPresenceLayer` draws the agent intent box
  over the targeted block (presenceClaims `targetKind:"notebook_block"`) —
  the notebook analog of the cell intent box.
- **Coach cue**: "Draft into notebook" in the Banker Coach header (reveal-on-
  relevance: only when the room has a notebook) dispatches a templated
  `askAgent` goal with the notebook as context artifact.
- **Memory demo intent**: `classifyDemoIntent` routes notebook/meeting-notes
  goals to a scripted plan that calls the REAL `read_notebook` +
  `append_notebook_outline` tools — including one deliberately unevidenced
  claim so the demo shows the needs_review honesty gate.

Deliberately NOT in this change: `update_wiki` retarget (it primarily serves
wiki dashboards rendered from elements["doc"], not the synced notebook lane —
retargeting would truncate long grounded bodies through outline caps; note
writes are already steered to the block tools by the context builder), and the
flag flip + prod Convex deploy (requires `npm run convex:deploy` and live-DOM
proof — convex/_generated intentionally NOT regenerated here because codegen
against a cloud deployment deploys).

## Decision

Keep the shipped substrate — Tiptap + `@convex-dev/prosemirror-sync` + the
`notebookDocuments` capability registry + the dirty→processor→read-model
pipeline — and adopt exactly ONE structural idea from the outliner study:
**stable per-block identity stored in the document itself**, plus the proven
agent-workflow patterns (pinned landing zone, structured-outline contract,
title-dedupe idempotency, server-minted ids). Do NOT port graph-as-storage,
per-row editor instances, or last-write-wins sync.

The agent gets a small governed notebook tool surface whose write engine is
`prosemirrorSync.transform(ctx, docId, schema, fn)` (server-side, verified
present in `@convex-dev/prosemirror-sync` 0.2.4), wrapped in the SAME
governance spine as spreadsheet cells: conflict-as-data CAS, review-mode
proposals, traces, `agentMutationReceipts`, presence intent boxes, evidence
honesty gates. Mental model: `block : cell :: blockId : elementId ::
baseTextHash : baseVersion`.

## Patterns the outliner study proves (ported as patterns, no code)

| studied pattern | port into NodeRoom |
|---|---|
| Every bullet is an addressable node with a durable id | `attrs.blockId` (uuid) on every block node via Tiptap UniqueID/GlobalAttributes; rendered as `data-block-id` |
| Pinned find-or-create roots ("Parsed outline") as agent landing zones | find-or-create heading with `attrs.agentRoot=true` ("Agent notes") — attr-matched, not fragile title-scan |
| Ask-JSON `section_bullets` structured contract | the zod args of `append_notebook_outline` ARE the contract — no separate structured-output endpoint |
| `ensureChild` per-parent title-dedupe → re-run merges instead of duplicating | merge-mode dedupe inside the transform fn |
| Server-minted UUIDs for agent-created nodes | pre-minted blockIds per call → transform retry loop becomes exactly-once |
| Streaming nodes appearing live in the outline | one transform per section, sequential; blocks stream into every client through the existing sync subscription |
| 8-target capped enrichment with dedupe | `plan_notebook_enrichment` read-only planner query |

## Anti-goals the study exposed (do not import)

- **No AI attribution in data** (agent writes authored as the user; provenance
  only by location/title convention) → we set `attrs.authorKind='agent'` +
  `runId` server-side, rendered as the NodeRoom badge.
- **No rollback / partial subtrees** on mid-stream agent failure → per-section
  receipted transforms; an interrupted run leaves N complete, attributed,
  receipted sections.
- **Last-write-wins sync** (`updateNode` has no version check) → per-block
  textHash CAS + prosemirror-sync step rebasing.
- **Fake-success cleanup stubs** (reject/delete-unconfirmed are no-ops that
  return ok) → honest status everywhere (HONEST_STATUS).
- **Graph-as-storage + one editor instance per row** → the graph stays a
  DERIVED read model (`notebookBlocks/Claims/Mentions`); one editor instance.

## Pre-existing bugs this work must fix on the way (found during mapping)

1. **Seeding gap (P0 for the lane)**: `ensureNotebookDoc` seeds an EMPTY doc;
   the comment at `convex/prosemirror.ts:193-195` claims the client seeds from
   legacy HTML but no code does. Flipping `VITE_NOTEBOOK_SYNC=prosemirror`
   orphans all existing note content.
2. **Invisible agent writes**: `update_wiki`/`edit_cell` write
   `elements["doc"]`, which the synced editor never reads — with the flag on,
   agent note output is invisible.
3. **Generated-API lag**: `createAgentWorkPlanFromNotebook` missing from
   `convex/_generated/api.d.ts` (`as any` cast at `Artifact.tsx:1654`);
   requires `npm run convex:deploy`, not codegen.
4. **Flag defaults off**: `.env.example` ships `VITE_NOTEBOOK_SYNC=` empty;
   prod almost certainly renders the legacy editor.

## Architecture

### Shared block schema (one module, four consumers)

`src/notebook/extensions.ts` — StarterKit subset + UniqueID (blockId on
paragraph/heading/listItem/taskItem/blockquote/codeBlock) + GlobalAttributes
(`authorKind`, `runId`, `status`) + renderHTML emitting `data-block-id`,
`data-author-kind`, `data-noderoom-surface="notebook-block"`.

Consumers: `SyncedEditorInner`, legacy/memory `Note`, server
`getSchema(extensions)` in `convex/notebookAgent.ts`, and `extractReadModel`.
One list so schemas can never drift. (Convex importing from `src/` is
established practice — `convex/agent.ts` imports `runAgent`.)

### Agent write spine — `convex/notebookAgent.ts`

Guard order copied from `applyCellEditCore` (policy copied, function not
shared):

1. `requireActorProof` + `assertDocRegistered` (registry ACL, revocation).
2. Anchor/CAS **inside the transform fn against the fresh doc**:
   missing blockId → `{ok:false, reason:"no_such_block", currentBlocks}` DATA;
   `baseTextHash` mismatch → `{reason:"conflict", expected, actual}` DATA.
   Never throw — conflict-as-data is the runtime contract (`runtime.ts:59-98`).
3. `human_block_protected`: replace/append on a block without
   `authorKind='agent'` is refused as DATA with the instruction to use
   `annotate` (v1); v2 upgrades refusal to a `proposals` row.
4. Review mode: `!room.autoAllow` → whole op becomes a `proposals` row,
   returns success-shaped `{pendingApproval:true}`; approval replays with
   re-CAS (a moved doc may legitimately fail — surface it, no fake success).
5. Honesty gate: claim-bearing bullets without `evidence[]`/`citesArtifactIds`
   get `attrs.status='needs_review'` (downgrade, never invent, never
   hard-reject). v1 checks evidence PRESENCE only — not OKF sufficiency — to
   avoid the cold-index mass-downgrade failure mode of `reviewedCellPayload`.
6. Apply via `prosemirrorSync.transform` — fn idempotent (pre-minted blockIds,
   existence check before insert; the component retries fn until synced).
7. Commit effects: artifact.version +1 (cross-kind governance clock, same as
   `define_columns`), `traces` row, `agentMutationReceipts` (sorted-key
   inputHash, affectedIds=blockIds), `evidenceFacts` rows, presenceClaims
   heartbeat (`targetKind:"notebook_block"` — already in schema) BEFORE the
   write so the intent box draws first, `markNotebookDirty(lane)`, and an HTML
   mirror into `elements["doc"]` via the checked `applyCellEdit` bridge
   (plain content mirror: no roomActivityOutbox, no per-keystroke version
   churn — preserves the single-passive-source invariant and the B1 lesson).

NO new tables.

### Tool surface (`src/nodeagent/skills/notebook/notebookTools.ts`)

All schemas reuse cellMutator hardening (tolerantArray, alias coalescing,
`z.coerce`) — the PR #39 lesson: schema strictness, not intelligence, is the
cheap-model failure mode.

1. **`read_notebook`** (query, read-only) — `{artifactId?}` →
   `{ok, docSource:'synced'|'legacy', docVersion, agentSection:{exists,blockId?},
   blocks:[{blockId, blockIndex, blockType, depth, parentBlockId?, text(≤400),
   textHash, authorKind, status?, evidenceCount}], claims, mentions,
   truncated?}` capped 200 blocks. Every string fenced as UNTRUSTED ROOM DATA
   by `buildNoteContext`. textHash is the CAS token.
2. **`append_notebook_outline`** (the /parse port) —
   `{artifactId?, title?, parentBlockId?, mode:'append'|'merge'(default merge),
   sections: tolerantArray({title≤120, bullets: tolerantArray(string |
   {text≤400, claim?, evidence?: evidenceSchema[], mention?})})}`.
   Caps: 12 sections / 120 bullets / depth 2. Default landing = agent section
   (find-or-create by attr). One transform per section (streaming feel), merge
   dedupe by normalized title, pre-minted blockIds, evidence downgrade,
   review-mode proposal. Returns `{ok, blockIds[], dedupedSections}`.
3. **`update_notebook_block`** —
   `{blockId, baseTextHash, action:'replace'|'append_children'|'annotate',
   content, reason?}`. Hash-anchored CAS on ONE block;
   `human_block_protected` guard; `annotate` inserts an agent-badged aside
   after the target instead of mutating it.
4. **`annotate_note_block`** (cite_in_file for the notebook) —
   `{blockId, quote(verbatim), evidence|citesArtifactIds}`. Server verifies the
   quote exists VERBATIM in the block's current text; paraphrase/hallucination
   → `{ok:false, reason:'unsupported'}` — a box is never faked (cited-sources
   rule). Writes an evidence anchor row; never mutates the doc; additive.
5. **`plan_notebook_enrichment`** (read-only planner) —
   `{artifactId?, maxTargets≤8}` → deduped mention targets with
   `hasExistingEnrichment` flags, sorted by blockIndex, deterministic.
   Enrichment itself = existing research tools + `append_notebook_outline`
   anchored at the target block, so it inherits every write gate.
6. **`update_wiki` retargeted**: when a `notebookDocuments` row exists,
   compiles to `append_notebook_outline(position:end)` + structured Sources
   block — kills the invisible-write divergence at the source. Legacy/memory
   path unchanged until parity ships.

### RoomTools seam

Three optional methods on `RoomTools` (`src/nodeagent/core/types.ts:181`,
same optionality pattern as `setColumns?`/`citeInFile?`):
`readNotebook` / `applyNotebookOutline` / `applyNotebookBlockEdit`.
`ConvexRoomTools` → `notebookAgent.*`. `InMemoryRoomTools` → a pure
`src/notebook/blockOps.ts` engine (`applyBlockOps(docJson, ops) →
{doc, results}`) shared with the server transform fn body — ports-and-adapters,
parity-tested. Memory notes upgrade `elements["doc"]` to PM JSON (legacy HTML
auto-upgraded via `generateJSON` on load) so blockIds exist in demo docs and
scripted plans can target them.

### Context & routing

- `buildNoteContext` (`worldModel.ts:230`) rewritten: advertise
  `read_notebook` → block tools when the port supports them; keep whole-doc
  guidance only for legacy notes without a registry row.
- No new chat syntax: `@nodeagent` with the Note tab active already passes
  `contextArtifactId`; `agent.ts:586` kind-router already routes note → note
  context.
- Coach: BankerCoachPanel cues gain a "Draft into notebook" action dispatching
  a templated `askAgent` goal.
- Memory: `classifyDemoIntent` gains a notes/parse intent whose scripted plan
  calls the real tools through `InMemoryRoomTools`.
- Reverse bridge already shipped: notebook → `createAgentWorkPlanFromNotebook`
  → planHash approval → `agentJobs` — approved plans now write results back
  under the agent section with evidence, closing the loop.

### Provenance / attention overlay

Anchor shape `{artifactId, anchor:{kind:"notebook_block", blockId, quote?}}`.
Blocks emit `data-block-id` + `data-noderoom-surface` so Trace Lens Cmd-click
resolution works with the existing resolver pattern. A small
`NotebookAnchorOverlay` subscribes to presenceClaims(notebook_block) +
evidence anchors and draws the existing `.r-tracevu-box` positioned from
`[data-block-id]` rects. Dangling anchors re-resolve by verbatim quote, else
degrade to a "source block removed" chip — never a faked box. This is the
notebook instantiation of docs/traces/ATTENTION_OVERLAY_STANDARD.md.

## Migration steps (each independently shippable)

0. **Seeding fix (ships alone, P0)**: `ensureNotebookDoc` seeds from legacy
   `elements["doc"]` HTML via `generateJSON` + shared extensions; delete the
   false comment; convex-test: legacy content visible after flag flip; trace
   row on lossy conversion (text-hash compare).
1. **Shared extensions**: `src/notebook/extensions.ts`; adopt in
   SyncedEditorInner + legacy Note; badge + needs_review chip CSS; fix the
   SyncedNote hooks-before-early-return hazard while touching. Ids silently
   start appearing.
2. **Read vertical**: `notebookAgent.readNotebook` query + RoomTools method +
   `read_notebook` tool + `buildNoteContext` v2. Ships alone — structured
   reads while writes stay on legacy path.
3. **Read-model v2**: `extractReadModel` prefers `attrs.blockId` (fallback to
   derived `b{index}-{hash}`); additive `parentBlockId`/`depth`/`orderIndex`
   on notebookBlocks; `processorVersion: notebook-read-model-v2`. Claims and
   mentions now survive edits; work plans pin real blocks.
4. **Pure engine**: `src/notebook/blockOps.ts` + scenario tests (concurrent
   human edit → hash conflict; block deleted mid-run; block split; duplicate
   ids from paste; re-applied op idempotency; 500-block doc; sustained-typing
   long-run).
5. **The /parse port**: `notebookAgent.applyOutline` +
   `append_notebook_outline` + MANAGED_LOCK_SYSTEM_PROMPT notebook paragraph.
   convex-tests with the registered prosemirror-sync component: happy path,
   run-twice → zero duplicates, no_such_block, evidence downgrade, review-mode
   proposal, private-pullback revocation, concurrent-steps rebase.
6. **Memory parity + demo**: `InMemoryRoomTools` methods over blockOps.ts;
   demoRoom seeds gain blockIds; scripted parse plan; memory-mode Playwright
   spec (standing rule: `npx playwright test` stays green).
7. **Block edit + annotate**: `update_notebook_block` + `annotate_note_block`
   + Trace Lens resolver for `data-block-id` + NotebookAnchorOverlay.
8. **Enrichment + coach**: `plan_notebook_enrichment`; "Draft into notebook"
   coach cue; extend e2e vertical (type note → read model → plan → approve →
   job writes back under agent section).
9. **Coherence + deploy + proof**: retarget `update_wiki`; onSnapshot-scheduled
   HTML checkpoint mirror (plain db.patch, no outbox, no version bump);
   regenerate `_generated` (fixes the `as any`); `npm run convex:deploy`
   (deploy ≠ git push); flip `VITE_NOTEBOOK_SYNC=prosemirror` in .env.example +
   Vercel env; live-DOM verify on noderoom.live: served HTML contains
   `data-author-kind="agent"` + `data-block-id` after a real agent run —
   before using the word "shipped".
10. **Deferred (resist scope gravity)**: proposal-routed human-block edits
    (v2 of human_block_protected), @tiptap/extension-mention chips →
    real-entity notebookMentions → backlinks panel, remaining agentArtifact
    kinds rendered in the notebook panel. Explicitly NOT: reviving the
    quarantined `notebookGraph` tables (architectureBudget gate stands).

## Dependencies

New (both MIT, Tiptap v3 line matching installed 3.26):
`@tiptap/extension-unique-id`, `@tiptap/html`. Everything else is already
installed (`@convex-dev/prosemirror-sync` 0.2.4 incl. server `getDoc`/
`transform`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm`).

New code ≈ 800–1000 LOC total: extensions (~80), blockOps engine (~250),
notebookAgent.ts (~300, mostly guard plumbing copied from the cell path),
tools (~250), overlay (~100), plus tests.

## Risks & mitigations

- **Transform retry duplication**: fn re-runs until synced → pre-minted
  blockIds + existence check are load-bearing; dedicated retry-replay test
  injecting concurrent steps between getDoc and transform.
- **Block races under active typing**: split/merge invalidates blockId or
  textHash → bounded conflict-as-data retries; quote-based re-locate fallback;
  presence intent box warns the human first.
- **UniqueID edge cases**: paste can transiently duplicate ids; split leaves
  the id on one half → write path rejects ambiguous duplicates as DATA;
  overlay only draws on verbatim-quote resolution; repair pass re-mints dupes.
- **Mirror discipline**: elements["doc"] checkpoint must never re-enter the
  passive pipeline or bump artifact.version per keystroke → plain db.patch;
  extend the static source-guard test (nativeNotebookProsemirrorStatic
  pattern) to notebookAgent.ts and the mirror mutation.
- **Convex bundle size**: StarterKit in a default-runtime mutation → minimal
  schema-only extension list; bundle check before Step 5 merges.
- **Seeding fidelity**: generateJSON drops unknown nodes → hash-compare trace
  + raw HTML preserved in the mirror element.
- **Deploy sequencing**: two-target deploy (Vercel + `npm run convex:deploy`);
  generated-API lag already bit once; live-DOM grep is the only accepted
  "shipped" proof.
- **Cheap-model nested schema**: sections/bullets is deeper than any current
  tool args → validate against glm-flash-class models before defaulting the
  free-auto ladder to notebook goals.
- **Prompt injection**: block text is member-authored → fenceUntrusted on
  every block/claim/mention string in context.
- **Review replay honesty**: approval after doc movement may fail CAS → the
  approval UI surfaces the failure; no 2xx-on-failure.

## Study summary (architecture of the compared outliner, for context)

The compared notebook stores every bullet as a graph node row (content = a
flat typed-chip array), models nesting/order as first-class relation rows with
fractional indexing, mounts one rich-text editor instance per visible row, and
syncs via optimistic client transactions batched to a REST endpoint with
last-write-wins overwrites. Its agent layer routes slash commands to a
structured-outline LLM contract, persists results under pinned find-or-create
landing sections, dedupes re-runs by normalized title, and applies agent tool
calls through the same client transaction layer as human edits with
server-minted node ids. Those workflow patterns ported here as patterns; the
storage model, per-row editors, and LWW sync deliberately did not.
