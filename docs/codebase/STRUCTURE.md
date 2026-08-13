# Structure — where things live, and which folders you can ignore

This repository is large: 6,209 tracked files at this commit, of which **589 are
production TypeScript** (`src/` and `convex/`, excluding generated code and
tests). Most of the rest is documentation, benchmark harnesses, captured
evidence and one-off scripts.

**Read this section first: the four folders that are the product.**

| Folder | Files | What it is |
|---|---:|---|
| `src/` | 464 `.ts` + 122 `.tsx` | The browser application. |
| `convex/` | 90 | The backend: database schema, queries, mutations, actions. |
| `tests/` | 412 (393 `*.test.*`) | Vitest suites. `npm test` runs these. |
| `e2e/` | 71 | Playwright browser specs. |

Everything below that is supporting material.

## Inside `src/`

Ordered by how likely you are to need them, not alphabetically.

| Path | Files | What it is |
|---|---:|---|
| `src/landing/boot.ts` | — | **The entry point.** `index.html` loads exactly this. |
| `src/app/` | 16 | Mount (`main.tsx`), the `RoomStore` seam (`store.tsx`, 2,639 lines), spreadsheet parsing, room seeds. |
| `src/engine/` | 7 | `RoomEngine` — the in-memory room: artifacts, elements, locks, proposals, compare-and-swap edits, trace. This is the domain model. |
| `src/ui/` | 145 | Every rendered surface. `RoomShell.tsx` is the three-pane room; `Chat.tsx` is the composer and feed; `panels/` holds the artifact views; `mobile/` is a purpose-built mobile shell, not a squeezed desktop one. |
| `src/nodeagent/` | 190 | The agent. `core/runtime.ts` is the loop; `core/types.ts` defines the `RoomTools` port; `skills/` holds tools; `models/` holds provider adapters, pricing and failover. |
| `src/components/ui/`, `src/components/ai-elements/` | 13 + 7 | shadcn-style primitives and the Vercel AI Elements subset the chat actually renders. `src/design/uiLayerPolicy.ts` enforces that Radix behaviour is only wrapped here. |
| `src/eval/` | 94 | Benchmark harnesses (SpreadsheetBench, BankerToolBench, ProofLoop). **Not on the user path.** Large, self-contained, and safe to skip while learning the product. |
| `src/benchmarks/`, `src/proofloop/`, `src/noderl/`, `src/nodemem/`, `src/alwayson/`, `src/solo/`, `src/voice/`, `src/notebook/` | 22–14 each | Feature areas layered on the room. Read them only when you are working in them. |

## Everything outside those four folders

| Path | Files | Why it exists | Do you need it? |
|---|---:|---|---|
| `docs/` | 3,831 | Design notes, audits, benchmark reports, captured screenshots. Historical; append-only by convention. | The `docs/codebase/` folder you are in, plus `docs/START_HERE.md`. The rest is reference. |
| `scripts/` | 282 | One-off and CI scripts, wired to the 266 npm scripts in `package.json`. `verify-build-provenance.ts` is the one that runs on every build. | Only when a script you are running lives here. |
| `evidence/`, `promotion/`, `.qa/`, `.proofloop/`, `proofloop/`, `episodes/` | ~400 | Captured proof artifacts: screenshots, JSON readouts, loop state. `promotion/` holds the current product scorecard and defect ledger. | `promotion/PROMOTION_LOG.md` is worth reading. |
| `vendor/` | 36 | The seven `file:` dependencies. | Only when debugging one of them. |
| `backend/` | 76 | A separate Python service (`Dockerfile`, `requirements.txt`, `pytest.ini`). Not started by `npm run dev` and not needed for any journey below the live tier. | No. |
| `packages/walkthrough-review-cli/` | 7 | A local CLI/MCP tool for reviewing recorded walkthroughs. | No. |
| `remotion/` | 10 | Video composition for demo clips. | No. |
| `noderl/`, `nodekit/`, `skills/`, `packs/`, `design-dna/`, `templates/` | ~80 | Agent skill definitions and generator templates. | No. |
| Root `6-1*-2026-*.txt` / `.md` | 13 | Dated raw session transcripts from the build, ~600 KB. Kept as history. | No — and see `CONCERNS.md`. |

## Naming that tells you what a file is

- `convex/*.ts` — a server module. Its exports are `query` / `mutation` /
  `action` / `internalAction`; the client reaches them as `api.<file>.<export>`.
- `src/ui/**/*.tsx` — a rendered surface. It consumes `useStore()`; it must not
  import `RoomEngine` or `convex/_generated/api` directly.
- `src/nodeagent/skills/**` — a capability the agent can call. Registered as data
  in `ROOM_TOOLS`.
- `tests/<subject>.test.ts` — the Vitest suite for `<subject>`. There is no
  mirrored directory tree; the test file names the subject.
- `e2e/<journey>.spec.ts` — a Playwright browser journey.

## The two files that carry the most weight

If you only open two, open these:

1. `src/app/store.tsx` (2,639 lines) — the seam. Two implementations of one
   interface: in-memory and Convex. Every UI surface goes through it.
2. `src/engine/roomEngine.ts` (947 lines) — the domain rules. Locks, proposals,
   compare-and-swap, trace. `applyEdit` is the function the product is about.
