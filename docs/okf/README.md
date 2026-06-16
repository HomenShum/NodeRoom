# NodeRoom OKF Layer

OKF is now represented in the repo as a first-class NodeAgent layer:

- `src/nodeagent/okf/` parses, validates, serializes, and produces OKF concepts.
- `src/nodeagent/retrieval/` builds the hybrid retrieval toolbelt over those concepts.
- `src/nodeagent/retrieval/tools/okfTools.ts` exposes the OKF/search/source tools to the same agent harness that already owns spreadsheet writes.
- `scripts/retrieval-eval.ts` compares room-context-only answering against OKF-backed retrieval.

The product thesis:

> Convex is the live room ledger. OKF is the portable knowledge bundle. Hybrid retrieval is how NodeAgent finds the right evidence. Managed CAS/proposals are how the agent safely changes shared artifacts.

This follows Google's OKF framing: a knowledge bundle is just Markdown files with YAML frontmatter, queryable fields such as `type`, `title`, `description`, `resource`, `tags`, and `timestamp`, and ordinary Markdown links/citations for graph traversal and source support.

Current P0:

- OKF concept parser/writer.
- Bundle validator.
- Generated `index.md` and `log.md`.
- Metadata/full-text/semantic-ish/path/regex/backlink retrieval.
- Literal source open and citation resolution.
- Claim-vs-evidence comparison.
- Evidence sufficiency classification.
- Diverse candidate slates plus `EvidenceMemo` output, so weighted search scores generate inspection candidates instead of deciding truth.
- AgentTool exposure for `okf_*` and `source_*` tools.
- Convex-side embedding job/outbox primitives for notebook/wiki/artifact sources; the current runner uses local deterministic `hashing-v1` vectors for testable plumbing before provider embeddings are promoted.

Not yet production-grade:

- Persistent Convex OKF tables.
- Gemini Embedding 2 / provider embedding runner for multimodal PDF/image/audio/video-derived chunks.
- Native Convex vector indexes over OKF chunks; the existing embedding table is a plumbing step, not the final OKF chunk index.
- External vector/full-text engine. This is not P0; add it only if Convex-native vector/full-text retrieval misses scale, latency, faceting, or cross-tenant requirements.
- ClickHouse retrieval analytics.
- OKF graph visualizer artifact.

## Retrieval Policy

NodeRoom should not let hardcoded hybrid weights decide final answers. The current policy is:

1. Generate candidates from deterministic retrievers: OKF semantic/full-text/filter/backlink, sheet search, trace search, source-open, and external search fallback when allowed.
2. Normalize them into a `CandidateSlate` with source, concept id, path, snippet, visibility, status, confidence, and why it matched.
3. Dedupe and diversify the slate across source/company/cell/metric/chart/trace concepts.
4. Inspect literal evidence and emit an `EvidenceMemo` with supported claims, missing evidence, and a recommended action.
5. Let the final agent write only from evidence memos and current cell versions; weak evidence becomes `needs_review`.

Convex remains the P0 retrieval substrate because it already owns live room state, full-text/searchable records, durable jobs, and permissions. External vector DBs, Gemini File Search, and ClickHouse are adapters after measured retrieval evals prove they are needed.
