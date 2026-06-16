# NodeRoom - Library And Convex-Component Stack

Principle: do not reinvent the wheel. Every concern below maps to a popular OSS
library or an official Convex component. NodeRoom's custom code is the lock ->
draft -> smart-merge engine, the agent harness contract, and the spreadsheet
semantic/dependency index.

## Decision Matrix

| Concern | Use | Convex-native | Replaces |
|---|---|---|---|
| Reactivity + optimistic UI | Convex `useQuery` / mutations / optimistic updates | core | `RoomEngine` mirror when backend is live |
| Collaborative note | TipTap now; future `@convex-dev/prosemirror-sync` for production prose CRDT/OT | official component | `contentEditable` blocks |
| Public + private agent chat | `@assistant-ui/react` for 1:1 agent threads; custom room feed for multi-author chat; `@convex-dev/persistent-text-streaming` for durable streams | configured component + first-party fit | bespoke private assistant thread |
| Agent run loop | Current custom bounded tool harness; future `@convex-dev/agent` where it fits | official component available | scripted-only agent |
| Durable agent runs | `agentJobs` slices wrapped by `@convex-dev/workflow` with `@convex-dev/workpool` controls | wired official components | scheduler-only continuation loops |
| Rate limiting | future `@convex-dev/rate-limiter` | official component | none |
| Schema/data migrations | future `@convex-dev/migrations` | official component | manual migrations |
| Spreadsheet/grid | current simple table; TanStack Table if true grid ergonomics are needed | works with cell rows + CAS | hand table at larger scale |
| Post-it wall | `@dnd-kit/core` + modifiers | works | hand pointer math |
| Icons | `lucide-react` | n/a | unicode glyphs |
| Document parsing | provider-first multimodal extraction; LiteParse Node fallback | Node action/worker lane | ad hoc text-only parsing |
| Notebook/wiki graph | Convex `notebooks`, `nodes`, `relations`, `relationTypes`, `wikiPages`, `wikiRevisions` plus mutation receipts | core Convex tables | client-only graph drift |
| Retrieval/embeddings | Durable `embeddingJobs` + `embeddings` tables with a queued runner and visible search query | core Convex tables/actions | blocking graph writes on vector sync |
| Eval proof ledger | JSONL eval store + professional proof ledger + live-provider catalog runner | local CI / HALO lane | describe-only feature claims |

## Wired Now

- `@convex-dev/workflow` and `@convex-dev/workpool` are installed and configured in `convex/convex.config.ts`.
- `@convex-dev/persistent-text-streaming` is installed and configured in `convex/convex.config.ts`; message history stores the final text while stream ids remain runtime metadata.
- `/ask`, `/free`, research, collaboration, and top-model jobs start through `agentJobs.start`; route/model/approval/evidence policies choose behavior while the shared workflow runs bounded `runFreeAutoJobSlice` action steps.
- `agentJobs` remains the user-facing durable system of record. Workflow ids are runtime metadata.
- Scheduler continuation remains only for legacy `runtime="scheduler"` jobs.
- Public room agent requests route through durable `agentJobs`; production code does not depend on `client_action` as the write primitive.
- Agent steps write operation events, mutation receipts, draft operations, leases, and exact-once model journals.
- Notebook/wiki graph tables and mutations are wired: create notebook, create child node, update node content, create/reorder relations, and write receipts.
- Node and wiki updates enqueue embedding jobs asynchronously; the local embedding runner writes durable vectors and exposes `searchVisible`.
- Spreadsheet artifacts now have semantic cell records, structural chunk records, and formula dependency records.
- `propose_lock` expands requested spreadsheet cells through downstream formula dependencies before granting a lock.
- Provider parser output and uploaded spreadsheets both write evidence-bearing `CellPayload`s and semantic index summaries.
- LiteParse is installed as a Node-only fallback adapter and exercised by `npm run liteparse:smoke`.
- Live provider proof is wired into evals:
  - `npm run eval:professional:live-catalog -- --real deepseek/deepseek-v4-flash --require-full` proves 21/21 professional catalog contracts for the current cheap paid champion.
  - `npm run eval:professional:live-runtime -- --strict` proves 21/21 professional catalog cases execute through the real room runtime with `deepseek/deepseek-v4-flash`, `PRODUCTION_ROOM_TOOLS`, evidence payload writes, and runtime-managed lock coordination.
  - `npm run eval:chat-intake:live -- --managed-locks` proves the chat-first GTM workflow through the real room tool runtime with a live provider using production-managed `write_locked_cell_results` / `write_locked_cells`.
  - `npm run eval:professional:proofs` separates full live-runtime, partial live-runtime, live-provider catalog, deterministic runtime, and contract-shape proof levels, and now records whether a runtime proof is `runtime_managed_lock`, `explicit_agent_lock`, or `catalog_only`.

## Still Future

- Convex File Storage as the raw-file system of record for every upload.
- Provider-specific Convex Storage -> Gemini/OpenAI/Claude Files API binary upload actions.
- Production LiteParse/OCR worker deployment for Office/image conversion at scale.
- `@convex-dev/rate-limiter`, `@convex-dev/migrations`, anonymous auth, and prosemirror sync.
- Production-grade vector retrieval for spreadsheet semantic cells/chunks. The graph/wiki embedding queue exists; spreadsheet retrieval still uses lexical ranked retrieval over durable semantic records.
- Per-case provider aborts for long-running live catalog sweeps. The free Nex route passed a one-case smoke but the full cheap/free sweep exposed timeout behavior that should not block artifact writing.

## Cautions

- Do not import AI SDK or native LiteParse modules into Convex function modules. Convex actions use the direct HTTP `convexModel` adapter; LiteParse stays in a Node worker/script lane.
- Workflow action retries are disabled for `/free` slices because provider calls can double-bill. The slice runner owns attempt accounting and retry/backoff.
- Provider file ids are cache metadata. Convex storage/artifact ids remain canonical.
- CRDT/OT is right for prose notes, not spreadsheet cells. Spreadsheet writes use app-level version CAS plus affected-range locks.
- Live-provider catalog proof is not runtime proof. It checks planning/comprehension only. The live-runtime smoke proves managed room-tool execution; richer domain claims still need their own gold runners.
- `@convex-dev/*` components are still 0.x packages. Pin versions and treat upgrades as migrations.
