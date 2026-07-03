# Code-graph substrate: Graphiti-style temporal code graph for Proof Loop

> The failure→repair loop's missing retrieval layer: when a gate fails (a selector doesn't render,
> a route breaks, markdown overflows), the repair agent today gets a repair-prompt with the failed
> steps but has to re-derive *where in the codebase* the problem lives. This substrate gives it a
> blast-radius query instead: failing selector/route/file → ranked subgraph of the components,
> imports, and recently-changed files that could be responsible — cheap, deterministic, local.

## Decision

Build a **TypeScript-native, embedded-first code graph** that borrows Graphiti's design (bi-temporal
edges, episode provenance, invalidate-not-delete, hybrid keyword+graph retrieval) without depending
on Graphiti's stack. Default backend: **`node:sqlite`** (already the repo's Proof Loop memory engine
in `scripts/proofloop-memory.mjs` — FTS5, bm25, zero new dependencies). **Neo4j is an optional,
bring-your-own-server seam** plus a Cypher export path, not a requirement.

## Why (research-verified 2026-07-02, not from memory)

- **Graphiti is Python-only** (graphiti-core, Apache-2.0, actively developed). No official TS SDK —
  Zep's TS SDK is for their managed SaaS only. Official interop for non-Python = REST service or the
  MCP server (which Zep still labels experimental). Apache-2.0 explicitly permits borrowing the
  design into our own implementation.
- **Nobody prominent uses Graphiti for code-structure indexing.** Its hot use case is agent
  *conversational memory*. The code-indexing niche belongs to deterministic AST/tree-sitter tools
  (Aider repo-map, SCIP, Serena, LocAgent-style research) — LLM-extraction per episode (Graphiti's
  ingestion model) is the wrong cost profile for something derivable deterministically from source.
- **The embedded graph-DB landscape is a minefield right now**: Kuzu was archived Oct 10 2025
  (deprecated in Graphiti itself); LadybugDB (the MIT Kuzu fork, active npm) is promising but young;
  FalkorDB's embedded path runs SSPL binaries; Memgraph is BSL + server-only; LevelGraph is
  unmaintained. SQLite-as-graph (nodes/edges tables + recursive CTEs + FTS5) is the boring, safe
  default at codebase scale (tens of thousands of nodes), and the repo already ships the exact
  pattern (`.proofloop/memory/index.db`, `DatabaseSync`, FTS5 bm25).
- **Neo4j licensing**: the JS `neo4j-driver` is Apache-2.0 (safe to depend on); connecting to a
  user-installed server over Bolt is arm's-length (no copyleft exposure); **bundling the GPLv3
  server is the line not to cross**. Hence: adapter seam + Cypher export, never a bundled server.
- **Prior art says the extraction layer should be the TypeScript Compiler API, not tree-sitter**,
  for a TS-only monorepo: exact import specifiers and JSX component usage beat tree-sitter's
  syntax-only heuristics (Aider's known weakness on barrel re-exports / same-name collisions), and
  `typescript` is already a repo dependency. Aider's transferable lesson is the *ranking* idea
  (graph rank beats embeddings for code localization), not its extraction layer. GitHub stack-graphs
  is archived (Sep 2025) — prior art only.

## What Graphiti-style means here, concretely

| Graphiti concept | Code-graph translation |
|---|---|
| Episode | An index run (`indexRunId`), keyed to a git commit |
| Entity node | file, symbol (function/component/export), route, selector (`data-testid`) |
| Fact edge | imports, exports, renders (JSX usage), route→component, component→selector |
| Bi-temporal validity | `validFromCommit` / `invalidatedAtCommit` (event time) + `firstIndexedAt` / `lastIndexedAt` (ingestion time) |
| Invalidate-not-delete | Re-index marks edges missing from the new parse as invalidated at the current commit — never deleted. "What imported this file two commits ago?" stays answerable. |
| Episode provenance | Every node/edge carries `indexRunId` + `source` (same provenance discipline as the anti-reward-hacking doctrine's `ProofLoopSource` / `NodeMemSource`) |
| Hybrid retrieval | FTS5 bm25 over names/paths + BFS graph expansion + recency overlay (git changes since the last index commit). No embeddings in v0. |

## Architecture

```
src/proofloop/codegraph/           # pure graph core plus ProofLoop compatibility surface
  core/types.ts                    # nodes, edges, bi-temporal + provenance fields
  core/indexer.ts                  # TS Compiler API extraction (imports/exports/JSX/data-testid/routes)
  core/query.ts                    # blastRadius, searchSymbols, dependentsOf (backend-agnostic)
  ports/backend.ts                 # GraphBackend interface
  adapters/sqliteBackend.ts        # default: node:sqlite (DatabaseSync) + FTS5, .proofloop/codegraph/index.db
  adapters/cypherExport.ts         # exportToCypher(): .cypher file loadable into Neo4j/Graphiti today
  indexer.ts                       # orchestrator wrapper: manifest + SQLite index + likely-files query
  index.ts
src/eval/proofloopCodeGraph.ts     # CLI feature module (repo's proofloop<Feature>.ts pattern)
src/proofloop/orchestrator/         # consumes writeProofloopCodeGraph/queryProofloopCodeGraph for repair packets
scripts/proofloop-cli.ts           # + case "graph": index | blast-radius | search | export-cypher
```

**The loop seam** (the point of all of this): `src/eval/proofloopArtifacts.ts`'s
`renderRepairPrompt()` gains an optional "## Blast radius (code graph)" section. When
`.proofloop/codegraph/index.db` exists, the loop-artifacts writer queries blast-radius for each
failed step's selector/route and injects the ranked file/symbol list into `repair-prompt.md` — so
the repair agent starts from ~10 exact files instead of a repo-wide search. This is additive: no
graph DB → no section → existing behavior unchanged.

**UI/UX failure coverage** (the original ask): `data-testid` is the repo's dominant selector
convention (279 occurrences vs 16 `data-noderoom-surface`), so selector nodes index it as primary.
A "text overflow on /redesign/chat" failure resolves: selector/route → rendering components → their
CSS-module/import neighborhood → ranked, small, accurate context pack.

## Doctrine compliance (noderl/spec/anti-reward-hacking-doctrine.md)

The graph is a **retrieval substrate for the Exploration Loop**. It informs repair proposals; it
never touches verifiers, gates, thresholds, or held-out fixtures. Its output lands in
`repair-prompt.md` (agent context), not in any scorer. Provenance-typed by construction: every fact
traces to an index run + commit — a deterministic parse of the user's own source tree
(`source: "live_browser_proof"`-grade trust, not `model_generated_proposal`).

**Substrate-ablation tie-in (external repo, cited honestly):** the NodeRL repo's
`experiments/Substrate-Ablation-v0.md` (not in this repo — it lives in the separate noderl checkout)
defines "codebase graph" as one of the ablated substrate arms with hypotheses H1 (fewer tokens
re-deriving structure) and H2 (fewer retries-to-pass). This substrate is that arm made real, which
means the claim "the graph makes repair cheaper" is *testable* under that experiment's design rather
than asserted.

## v0 scope vs deferred

**v0 (this PR):** unified ProofLoop-owned graph package, indexer
(imports/exports/JSX/data-testid/routes), SQLite backend with bi-temporal invalidation,
blast-radius + FTS search queries, CLI subcommand, Cypher export, repair-prompt injection seam,
orchestrator likely-file retrieval, scenario tests. Deterministic ranking: BFS depth decay × degree
— no PageRank yet.

**Deferred, in order of likely value:** personalized PageRank ranking (Aider-style, seeded on
failing selectors); `neo4j-driver` live adapter (Apache-2.0, safe — deferred because bring-your-own-
server users can already load the Cypher export); Graphiti MCP interop (their server is officially
experimental); LadybugDB embedded-Cypher adapter (young fork — watch, don't depend);
embeddings/semantic layer (only if FTS+graph proves insufficient on real repair runs).

## Known limitations found during the v0 build (honest ledger)

- **Partial `--include` runs skip bi-temporal invalidation** (guarded + tested in scenario 8): a
  partial index didn't visit the rest of the tree, so "missing from this run" ≠ "gone". Only a full
  `graph index` expires stale edges. Without this guard, a partial run would have falsely expired
  every edge outside the include set.
- **Route coverage is thin in this repo specifically**: only 1 route node found live, because
  NodeRoom uses hash routing rather than react-router `path=` props. Route-seeded blast radius
  rarely fires here until a hash-route pattern is added; selector-seeded (`data-testid`) is the
  primary, well-covered entry point (240 selector nodes indexed live).
- **Repair-prompt seed extraction is regex-based** and can pull false "routes" from stack-trace
  URLs in failure text — bounded (≤5 seeds, empty results dropped, fully try/catch-wrapped), so the
  worst case is a noisy section, never a crash or behavior change.
- Locally-defined same-file JSX components are recorded as unresolved symbol nodes (spec-literal);
  shared-node provenance records the first file in sorted order (deterministic but arbitrary).

## Research sources checked

- Graphiti repo and license/MCP surface: https://github.com/getzep/graphiti
- Graphiti MCP server experimental status: https://github.com/getzep/graphiti/blob/main/mcp_server/README.md and https://help.getzep.com/graphiti/getting-started/mcp-server
- Neo4j JavaScript driver and Apache-2.0 license: https://github.com/neo4j/neo4j-javascript-driver and https://github.com/neo4j/neo4j-javascript-driver/blob/6.x/LICENSE
- Kuzu archive status and Graphiti Kuzu issue: https://github.com/kuzudb/kuzu/issues and https://github.com/getzep/graphiti/issues/1132

## Risks

- `node:sqlite` needs Node ≥22.5 (repo has no engines pin; `proofloop-memory.mjs` already took this
  bet; local runtime is v22.x). Same-boat risk, not new risk.
- Barrel re-exports (`export * from`) resolve one hop at a time in v0 — a deep barrel chain
  understates blast radius. Documented limitation; the recency overlay compensates in practice.
- Windows path length: index paths are repo-relative and normalized to forward slashes; the store
  lives in `.proofloop/` (gitignored) so the git-worktree path-length failure mode seen elsewhere
  this project doesn't apply.
- Young-fork temptation: keep LadybugDB/FalkorDB out until they earn a pin; the `GraphBackend`
  interface is the insurance policy.
