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
- AgentTool exposure for `okf_*` and `source_*` tools.

Not yet production-grade:

- Persistent Convex OKF tables.
- Background embedding/outbox lane.
- External vector/full-text engine.
- ClickHouse retrieval analytics.
- OKF graph visualizer artifact.

